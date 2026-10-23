package com.pupper.app

import android.util.Log
import com.google.firebase.FirebaseNetworkException
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseAuthException
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.UserProfileChangeRequest
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.DocumentSnapshot.ServerTimestampBehavior
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.firestore.SetOptions
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.tasks.await

/** All Firestore/Storage access. Document shapes match the website exactly (see firestore.rules). */
object Repo {
    private const val TAG = "Repo"
    val auth: FirebaseAuth get() = FirebaseAuth.getInstance()
    private val db: FirebaseFirestore get() = FirebaseFirestore.getInstance()

    // ------------------------------------------------------------ helpers
    private fun DocumentSnapshot.ms(field: String): Long =
        getTimestamp(field, ServerTimestampBehavior.ESTIMATE)?.toDate()?.time ?: System.currentTimeMillis()

    @Suppress("UNCHECKED_CAST")
    private fun DocumentSnapshot.strings(field: String): List<String> =
        (get(field) as? List<*>)?.filterIsInstance<String>() ?: emptyList()

    private fun Query.snapshots(): Flow<QuerySnapshot> = callbackFlow {
        val reg = addSnapshotListener { s, e ->
            if (e != null) Log.w(TAG, "listener error: ${e.code}") else if (s != null) trySend(s)
        }
        awaitClose { reg.remove() }
    }

    private fun doc(path: String) = db.document(path)

    // ------------------------------------------------------------ auth
    fun authState(): Flow<FirebaseUser?> = callbackFlow {
        val l = FirebaseAuth.AuthStateListener { trySend(it.currentUser) }
        auth.addAuthStateListener(l)
        awaitClose { auth.removeAuthStateListener(l) }
    }

    fun authMessage(e: Throwable): String = when {
        e is FirebaseNetworkException -> "Cannot reach the server. Check your connection."
        e is FirebaseAuthException -> when (e.errorCode) {
            "ERROR_INVALID_EMAIL" -> "That email address is not valid."
            "ERROR_WEAK_PASSWORD" -> "Choose a password with at least 6 characters."
            "ERROR_EMAIL_ALREADY_IN_USE" -> "An account with this email already exists. Sign in instead."
            "ERROR_INVALID_CREDENTIAL", "ERROR_USER_NOT_FOUND", "ERROR_WRONG_PASSWORD" -> "Email or password is incorrect."
            "ERROR_TOO_MANY_REQUESTS" -> "Too many attempts. Wait a few minutes and try again."
            "ERROR_REQUIRES_RECENT_LOGIN" -> "For safety, sign out, sign in again, then retry."
            "ERROR_OPERATION_NOT_ALLOWED" -> "Email/password sign-in is not enabled in the Firebase Console."
            else -> "Something went wrong. Please try again."
        }
        e is IllegalArgumentException && e.message != null -> e.message!!
        else -> e.message?.takeIf { e is UserFacingException } ?: "Something went wrong. Please try again."
    }

    class UserFacingException(message: String) : Exception(message)
    private fun fail(msg: String): Nothing = throw UserFacingException(msg)

    suspend fun register(name: String, email: String, password: String) {
        if (name.isBlank()) fail("Enter your name.")
        val user = auth.createUserWithEmailAndPassword(email.trim(), password).await().user!!
        user.updateProfile(UserProfileChangeRequest.Builder().setDisplayName(name.trim()).build()).await()
        ensureAccount(user.uid, name.trim())
    }
    suspend fun login(email: String, password: String) { auth.signInWithEmailAndPassword(email.trim(), password).await() }
    suspend fun resetPassword(email: String) { auth.sendPasswordResetEmail(email.trim()).await() }
    fun logout() = auth.signOut()

    // ------------------------------------------------------------ profile
    fun profile(uid: String): Flow<Profile?> = callbackFlow {
        val reg = doc("users/$uid").addSnapshotListener { s, _ ->
            trySend(if (s != null && s.exists()) Profile(uid, s.getString("displayName") ?: "Me", s.getString("phone")) else null)
        }
        awaitClose { reg.remove() }
    }

    private val profileCache = HashMap<String, Profile>()
    suspend fun profiles(uids: Collection<String>): List<Profile> = uids.map { uid ->
        profileCache[uid] ?: runCatching {
            val s = doc("users/$uid").get().await()
            Profile(uid, s.getString("displayName") ?: "Unknown", s.getString("phone"))
        }.getOrElse { Profile(uid, "Unknown", null) }.also { profileCache[uid] = it }
    }

    /**
     * Gives the account its permanent Pupper number (only if it has none yet).
     * phoneIndex is create-only, so a taken number makes the batch fail and we retry with another random number.
     */
    suspend fun ensureAccount(uid: String, name: String): String {
        var last: Exception? = null
        repeat(12) {
            val existing = doc("users/$uid").get().await()   // re-read: another request may have assigned it
            existing.getString("phone")?.let { return it }
            val number = ChatNumber.generate()
            val batch = db.batch()
            batch.set(doc("phoneIndex/$number"), mapOf("uid" to uid))
            if (existing.exists()) batch.set(doc("users/$uid"), mapOf("phone" to number), SetOptions.merge())
            else batch.set(doc("users/$uid"), mapOf("displayName" to name, "phone" to number, "createdAt" to FieldValue.serverTimestamp()))
            try {
                batch.commit().await(); profileCache.remove(uid); return number
            } catch (e: Exception) {
                last = e
                val denied = (e as? com.google.firebase.firestore.FirebaseFirestoreException)?.code == com.google.firebase.firestore.FirebaseFirestoreException.Code.PERMISSION_DENIED
                if (!denied) throw e
            }
        }
        throw last ?: UserFacingException("Could not create your number. Please try again.")
    }

    suspend fun updateName(uid: String, name: String) {
        if (name.isBlank()) fail("Enter your name.")
        doc("users/$uid").set(mapOf("displayName" to name.trim()), SetOptions.merge()).await()
        auth.currentUser?.updateProfile(UserProfileChangeRequest.Builder().setDisplayName(name.trim()).build())?.await()
        profileCache.remove(uid)
    }

    // ------------------------------------------------------------ contacts
    fun contacts(uid: String): Flow<List<Contact>> = db.collection("users/$uid/contacts").snapshots().map { s ->
        s.documents.mapNotNull { d -> d.getString("number")?.let { Contact(it, d.getString("name") ?: it) } }
    }
    suspend fun saveContact(uid: String, number: String, name: String) {
        if (name.isBlank()) fail("Enter a name.")
        doc("users/$uid/contacts/$number").set(mapOf("number" to number, "name" to name.trim(), "createdAt" to FieldValue.serverTimestamp())).await()
    }
    suspend fun deleteContact(uid: String, number: String) { doc("users/$uid/contacts/$number").delete().await() }

    // ------------------------------------------------------------ conversations
    private fun conv(d: DocumentSnapshot): Conversation {
        val last = d.get("lastMessage") as? Map<*, *>
        val unread = (d.get("unread") as? Map<*, *>)?.entries?.mapNotNull { (k, v) -> (k as? String)?.let { it to ((v as? Number)?.toLong() ?: 0L) } }?.toMap() ?: emptyMap()
        return Conversation(
            id = d.id, type = d.getString("type") ?: "direct", members = d.strings("members"), admins = d.strings("admins"),
            name = d.getString("name"),
            lastText = last?.get("text") as? String, lastSender = last?.get("senderId") as? String,
            updatedAt = d.ms("updatedAt"), unread = unread,
        )
    }

    fun conversations(uid: String): Flow<List<Conversation>> =
        db.collection("conversations").whereArrayContains("members", uid).snapshots().map { s ->
            s.documents.map(::conv).sortedByDescending { it.updatedAt }
        }

    fun cleared(uid: String): Flow<Map<String, Long>> =
        db.collection("users/$uid/cleared").snapshots().map { s -> s.documents.associate { it.id to it.ms("at") } }

    suspend fun startChatWithNumber(me: Profile, raw: String): String {
        val number = ChatNumber.normalize(raw) ?: fail("Enter a 10-digit Pupper number.")
        if (number == me.phone) fail("That is your own number.")
        val idx = doc("phoneIndex/$number").get().await()
        if (!idx.exists()) fail("No Pupper account has this number. Check it and try again.")
        val peer = idx.getString("uid") ?: fail("No Pupper account has this number. Check it and try again.")
        val cid = "d_" + listOf(me.uid, peer).sorted().joinToString("_")
        val ref = doc("conversations/$cid")
        if (!ref.get().await().exists()) {
            ref.set(mapOf(
                "type" to "direct", "members" to listOf(me.uid, peer), "createdBy" to me.uid,
                "unread" to emptyMap<String, Long>(), "updatedAt" to FieldValue.serverTimestamp(),
            )).await()
        }
        runCatching { doc("users/${me.uid}/cleared/$cid").delete().await() }
        return cid
    }

    data class Resolved(val uids: List<String>, val missing: List<String>)
    suspend fun resolveNumbers(numbers: List<String>, self: String): Resolved {
        val uids = mutableListOf<String>(); val missing = mutableListOf<String>()
        for (raw in numbers.map { it.trim() }.filter { it.isNotEmpty() }) {
            val number = ChatNumber.normalize(raw)
            if (number == null) { missing += raw; continue }
            val idx = doc("phoneIndex/$number").get().await()
            val uid = if (idx.exists()) idx.getString("uid") else null
            if (uid == null) missing += raw else if (uid != self && uid !in uids) uids += uid
        }
        return Resolved(uids, missing)
    }

    suspend fun createGroup(me: Profile, name: String, numbers: List<String>): Pair<String, List<String>> {
        if (name.isBlank()) fail("Enter a group name.")
        val r = resolveNumbers(numbers, me.uid)
        val ref = db.collection("conversations").document()
        ref.set(mapOf(
            "type" to "group", "name" to name.trim(), "members" to listOf(me.uid) + r.uids, "admins" to listOf(me.uid),
            "createdBy" to me.uid, "unread" to emptyMap<String, Long>(), "updatedAt" to FieldValue.serverTimestamp(),
        )).await()
        return ref.id to r.missing
    }

    suspend fun addMembers(c: Conversation, numbers: List<String>, self: String): Pair<Int, List<String>> {
        val r = resolveNumbers(numbers, self)
        val add = r.uids.filter { it !in c.members }
        if (add.isNotEmpty()) doc("conversations/${c.id}").update(mapOf("members" to c.members + add, "updatedAt" to FieldValue.serverTimestamp())).await()
        return add.size to r.missing
    }
    suspend fun renameGroup(cid: String, name: String) {
        if (name.isBlank()) fail("Enter a group name.")
        doc("conversations/$cid").update(mapOf("name" to name.trim(), "updatedAt" to FieldValue.serverTimestamp())).await()
    }
    suspend fun leaveGroup(c: Conversation, uid: String) {
        doc("conversations/${c.id}").update(mapOf(
            "members" to c.members - uid, "admins" to c.admins - uid, "updatedAt" to FieldValue.serverTimestamp(),
        )).await()
    }
    /** Per-user: hides history for you only. Saved contacts and other members are untouched. */
    suspend fun clearConversation(uid: String, cid: String) { doc("users/$uid/cleared/$cid").set(mapOf("at" to FieldValue.serverTimestamp())).await() }
    suspend fun markConversationRead(cid: String, uid: String) { doc("conversations/$cid").update("unread.$uid", 0).await() }

    // ------------------------------------------------------------ messages (text and GIFs)
    fun messages(cid: String, limit: Int, after: Long?): Flow<List<Message>> {
        var q: Query = db.collection("conversations/$cid/messages")
        if (after != null) q = q.whereGreaterThan("createdAt", Timestamp(after / 1000, ((after % 1000) * 1_000_000).toInt()))
        q = q.orderBy("createdAt", Query.Direction.DESCENDING).limit(limit.toLong())
        return q.snapshots().map { s ->
            s.documents.map { d ->
                Message(
                    id = d.id, senderId = d.getString("senderId") ?: "", senderName = d.getString("senderName") ?: "", kind = d.getString("kind") ?: "text",
                    text = d.getString("text"), url = d.getString("url"), createdAt = d.ms("createdAt"), readBy = d.strings("readBy"),
                )
            }.reversed()
        }
    }

    fun newMessageId(cid: String): String = db.collection("conversations/$cid/messages").document().id

    data class Outgoing(
        val id: String, val kind: String, val text: String? = null, val url: String? = null,
        val uri: android.net.Uri? = null, val info: Media.Info? = null,
    )

    /** Returns only after the server accepted the write; throws otherwise so the UI shows "failed". */
    suspend fun sendMessage(c: Conversation, me: Profile, m: Outgoing) {
        val body = mutableMapOf<String, Any?>(
            "senderId" to me.uid, "senderName" to me.displayName, "kind" to m.kind,
            "createdAt" to FieldValue.serverTimestamp(), "readBy" to listOf(me.uid),
        )
        if (m.kind == "text") {
            val t = m.text?.trim().orEmpty()
            if (t.isEmpty() || t.length > 4000) fail("Messages must be 1–4000 characters.")
            body["text"] = t
        } else {
            if (m.kind != "gif" && (m.url == null || !Media.hostedUrl.matches(m.url))) fail("The photo or video is not uploaded yet.")
            body["url"] = m.url
        }
        val preview = when (m.kind) { "gif" -> "GIF"; "image" -> "Photo"; "video" -> "Video"; else -> (body["text"] as String).take(120) }
        val batch = db.batch()
        batch.set(doc("conversations/${c.id}/messages/${m.id}"), body)
        val upd = mutableMapOf<String, Any>(
            "lastMessage" to mapOf("text" to preview, "senderId" to me.uid), "updatedAt" to FieldValue.serverTimestamp(),
        )
        c.members.filter { it != me.uid }.forEach { upd["unread.$it"] = FieldValue.increment(1) }
        batch.update(doc("conversations/${c.id}"), upd)
        batch.commit().await()
    }

    suspend fun markMessagesRead(cid: String, uid: String, msgs: List<Message>) {
        val todo = msgs.filter { it.senderId != uid && uid !in it.readBy }.take(400)
        if (todo.isEmpty()) return
        val batch = db.batch()
        todo.forEach { batch.update(doc("conversations/$cid/messages/${it.id}"), "readBy", FieldValue.arrayUnion(uid)) }
        batch.commit().await()
    }

    // ------------------------------------------------------------ status
    private fun status(d: DocumentSnapshot) = Status(
        d.id, d.getString("authorId") ?: "", d.getString("authorName") ?: "", "text", d.getString("text"),
        d.ms("createdAt"), d.ms("expiresAt"), d.strings("viewers"),
    )

    fun statuses(uid: String): Flow<List<Status>> = combine(
        db.collection("statuses").whereArrayContains("viewers", uid).limit(100).snapshots(),
        db.collection("statuses").whereEqualTo("authorId", uid).limit(50).snapshots(),
    ) { a, b ->
        (a.documents + b.documents).map(::status).distinctBy { it.id }
            .filter { it.expiresAt > System.currentTimeMillis() }.sortedByDescending { it.createdAt }
    }

    suspend fun publishStatus(me: Profile, viewers: List<String>, text: String) {
        val t = text.trim()
        if (t.isEmpty()) fail("Write something to share.")
        db.collection("statuses").document().set(mapOf(
            "authorId" to me.uid, "authorName" to me.displayName, "kind" to "text", "text" to t.take(700),
            "viewers" to viewers.filter { it != me.uid }.take(500), "createdAt" to FieldValue.serverTimestamp(),
            "expiresAt" to Timestamp((System.currentTimeMillis() + 24 * 3600_000L) / 1000, 0),
        )).await()
    }
    suspend fun deleteStatus(s: Status) { doc("statuses/${s.id}").delete().await() }
    suspend fun markStatusViewed(sid: String, uid: String) { runCatching { doc("statuses/$sid/views/$uid").set(mapOf("at" to FieldValue.serverTimestamp())).await() } }
    fun statusViews(sid: String): Flow<Int> = db.collection("statuses/$sid/views").snapshots().map { it.size() }

    // ------------------------------------------------------------ account deletion
    /** Removes profile, number, contacts, cleared markers and the sign-in. Sent messages remain (see README). */
    suspend fun deleteAccount(profile: Profile) {
        val user = auth.currentUser ?: return
        for (sub in listOf("contacts", "cleared")) {
            db.collection("users/${user.uid}/$sub").get().await().documents.forEach { it.reference.delete().await() }
        }
        profile.phone?.let { runCatching { doc("phoneIndex/$it").delete().await() } }
        doc("users/${user.uid}").delete().await()
        user.delete().await()
    }

    // ------------------------------------------------------------ call signaling
    fun incomingCalls(uid: String): Flow<List<CallDoc>> =
        db.collection("calls").whereArrayContains("participants", uid).whereEqualTo("state", "ringing").snapshots().map { s ->
            s.documents.map(::callDoc).filter { it.callerId != uid && System.currentTimeMillis() - it.createdAt < 45_000 }
        }
    fun callDoc(d: DocumentSnapshot): CallDoc {
        val offer = d.get("offer") as? Map<*, *>
        return CallDoc(d.id, d.getString("callerId") ?: "", d.strings("participants"), d.getString("conversationId") ?: "",
            d.getString("type") ?: "voice", d.getString("state") ?: "", offer?.get("type") as? String, offer?.get("sdp") as? String, d.ms("createdAt"))
    }
    fun callRef(id: String) = doc("calls/$id")
    fun candidates(id: String) = db.collection("calls/$id/candidates")
    fun newCallId(): String = db.collection("calls").document().id
}
