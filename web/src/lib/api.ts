import {
  arrayUnion, collection, deleteDoc, doc, getDoc, increment, limit, onSnapshot, orderBy, query,
  serverTimestamp, setDoc, Timestamp, updateDoc, where, writeBatch, type DocumentData, type Unsubscribe,
} from 'firebase/firestore';
import { createUserWithEmailAndPassword, deleteUser, sendPasswordResetEmail, signInWithEmailAndPassword, signOut, updateProfile, type User } from 'firebase/auth';
import { auth, db } from './firebase';
import { generateNumber, normalizeNumber } from './number';
import { HOSTED_URL } from './media';
import { ms, type Contact, type Conversation, type Message, type MessageKind, type Profile, type Status } from './types';

// ---------------------------------------------------------------- auth
export function authMessage(err: unknown): string {
  const code = (err as { code?: string })?.code ?? '';
  const map: Record<string, string> = {
    'auth/invalid-email': 'That email address is not valid.',
    'auth/missing-password': 'Enter your password.',
    'auth/weak-password': 'Choose a password with at least 6 characters.',
    'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
    'auth/invalid-credential': 'Email or password is incorrect.',
    'auth/user-not-found': 'Email or password is incorrect.',
    'auth/wrong-password': 'Email or password is incorrect.',
    'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
    'auth/network-request-failed': 'Cannot reach the server. Check your connection.',
    'auth/requires-recent-login': 'For safety, sign out, sign in again, then retry.',
    'auth/operation-not-allowed': 'Email/password sign-in is not enabled in the Firebase Console.',
  };
  return map[code] ?? 'Something went wrong. Please try again.';
}

export async function register(name: string, email: string, password: string): Promise<void> {
  const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(cred.user, { displayName: name.trim() });
  await ensureAccount(cred.user.uid, name.trim());
}
export const login = (email: string, password: string) => signInWithEmailAndPassword(auth, email.trim(), password);
export const logout = () => signOut(auth);
export const resetPassword = (email: string) => sendPasswordResetEmail(auth, email.trim());

// ---------------------------------------------------------------- profile & assigned number
export function watchProfile(uid: string, cb: (p: Profile | null) => void): Unsubscribe {
  return onSnapshot(doc(db, 'users', uid), (s) => cb(s.exists() ? { uid, displayName: s.data().displayName, phone: s.data().phone ?? null } : null), () => cb(null));
}
const profileCache = new Map<string, Profile>();
export async function fetchProfiles(uids: string[]): Promise<Profile[]> {
  return Promise.all(uids.map(async (uid) => {
    const hit = profileCache.get(uid);
    if (hit) return hit;
    const s = await getDoc(doc(db, 'users', uid));
    const p: Profile = { uid, displayName: s.exists() ? s.data().displayName : 'Unknown', phone: s.exists() ? s.data().phone ?? null : null };
    profileCache.set(uid, p);
    return p;
  }));
}
export const dropProfileCache = (uid: string) => profileCache.delete(uid);

/**
 * Gives the account its permanent Pupper number (only if it has none yet).
 * A random number is tried; phoneIndex is create-only, so a taken number makes the batch fail and we retry.
 */
export async function ensureAccount(uid: string, name: string): Promise<string> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 12; attempt++) {
    // Re-read each time: another tab/request may have assigned the number meanwhile.
    const existing = await getDoc(doc(db, 'users', uid));
    if (existing.exists() && existing.data().phone) return existing.data().phone as string;
    const number = generateNumber();
    const batch = writeBatch(db);
    batch.set(doc(db, 'phoneIndex', number), { uid });
    if (existing.exists()) batch.set(doc(db, 'users', uid), { phone: number }, { merge: true });
    else batch.set(doc(db, 'users', uid), { displayName: name, phone: number, createdAt: serverTimestamp() });
    try {
      await batch.commit();
      dropProfileCache(uid);
      return number;
    } catch (e) {
      lastError = e;
      if ((e as { code?: string }).code !== 'permission-denied') throw e; // network etc.: stop and report
    }
  }
  throw lastError ?? new Error('Could not create your number. Please try again.');
}

export async function updateDisplayName(uid: string, name: string) {
  if (!name.trim()) throw new Error('Enter your name.');
  await setDoc(doc(db, 'users', uid), { displayName: name.trim() }, { merge: true });
  if (auth.currentUser) await updateProfile(auth.currentUser, { displayName: name.trim() });
  dropProfileCache(uid);
}

// ---------------------------------------------------------------- contacts
export function watchContacts(uid: string, cb: (c: Contact[]) => void): Unsubscribe {
  return onSnapshot(collection(db, 'users', uid, 'contacts'), (s) => cb(s.docs.map((d) => ({ number: d.data().number, name: d.data().name }))), () => cb([]));
}
export async function saveContact(uid: string, number: string, name: string) {
  if (!name.trim()) throw new Error('Enter a name.');
  await setDoc(doc(db, 'users', uid, 'contacts', number), { number, name: name.trim(), createdAt: serverTimestamp() });
}
export const deleteContact = (uid: string, number: string) => deleteDoc(doc(db, 'users', uid, 'contacts', number));

// ---------------------------------------------------------------- conversations
const toConv = (id: string, d: DocumentData): Conversation => ({
  id, type: d.type, members: d.members ?? [], admins: d.admins, name: d.name,
  lastMessage: d.lastMessage ? { text: d.lastMessage.text, senderId: d.lastMessage.senderId } : undefined,
  updatedAt: ms(d.updatedAt), unread: d.unread ?? {},
});

export function watchConversations(uid: string, cb: (c: Conversation[]) => void): Unsubscribe {
  return onSnapshot(query(collection(db, 'conversations'), where('members', 'array-contains', uid)),
    (s) => cb(s.docs.map((d) => toConv(d.id, d.data({ serverTimestamps: 'estimate' }))).sort((a, b) => b.updatedAt - a.updatedAt)),
    () => cb([]));
}
export function watchCleared(uid: string, cb: (m: Map<string, number>) => void): Unsubscribe {
  return onSnapshot(collection(db, 'users', uid, 'cleared'),
    (s) => cb(new Map(s.docs.map((d) => [d.id, ms(d.data({ serverTimestamps: 'estimate' }).at)]))), () => cb(new Map()));
}

/** Start (or reopen) a direct chat using someone's Pupper number. Returns the conversation id. */
export async function startChatWithNumber(me: Profile, raw: string): Promise<string> {
  const number = normalizeNumber(raw);
  if (!number) throw new Error('Enter a 10-digit Pupper number.');
  if (number === me.phone) throw new Error('That is your own number.');
  const idx = await getDoc(doc(db, 'phoneIndex', number));
  if (!idx.exists()) throw new Error('No Pupper account has this number. Check it and try again.');
  const peerUid = idx.data().uid as string;
  const cid = `d_${[me.uid, peerUid].sort().join('_')}`;
  const cref = doc(db, 'conversations', cid);
  if (!(await getDoc(cref)).exists()) {
    await setDoc(cref, { type: 'direct', members: [me.uid, peerUid], createdBy: me.uid, unread: {}, updatedAt: serverTimestamp() });
  }
  await deleteDoc(doc(db, 'users', me.uid, 'cleared', cid)).catch(() => undefined);
  return cid;
}

export async function resolveNumbers(numbers: string[], self: string) {
  const uids: string[] = []; const missing: string[] = [];
  for (const raw of numbers.map((n) => n.trim()).filter(Boolean)) {
    const number = normalizeNumber(raw);
    if (!number) { missing.push(raw); continue; }
    const idx = await getDoc(doc(db, 'phoneIndex', number));
    const uid: string | undefined = idx.exists() ? idx.data().uid : undefined;
    if (!uid) missing.push(raw); else if (uid !== self && !uids.includes(uid)) uids.push(uid);
  }
  return { uids, missing };
}

export async function createGroup(me: Profile, name: string, numbers: string[]) {
  if (!name.trim()) throw new Error('Enter a group name.');
  const { uids, missing } = await resolveNumbers(numbers, me.uid);
  const ref = doc(collection(db, 'conversations'));
  await setDoc(ref, {
    type: 'group', name: name.trim(), members: [me.uid, ...uids], admins: [me.uid], createdBy: me.uid,
    unread: {}, updatedAt: serverTimestamp(),
  });
  return { id: ref.id, missing };
}

export async function addMembers(cid: string, current: string[], numbers: string[], self: string) {
  const { uids, missing } = await resolveNumbers(numbers, self);
  const add = uids.filter((u) => !current.includes(u));
  if (add.length) await updateDoc(doc(db, 'conversations', cid), { members: [...current, ...add], updatedAt: serverTimestamp() });
  return { added: add.length, missing };
}
export const renameGroup = (cid: string, name: string) => updateDoc(doc(db, 'conversations', cid), { name: name.trim(), updatedAt: serverTimestamp() });
export async function leaveGroup(c: Conversation, uid: string) {
  await updateDoc(doc(db, 'conversations', c.id), {
    members: c.members.filter((m) => m !== uid), admins: (c.admins ?? []).filter((m) => m !== uid), updatedAt: serverTimestamp(),
  });
}
/** Per-user: hides history for you only. Saved contacts and other members are untouched. */
export const clearConversation = (uid: string, cid: string) => setDoc(doc(db, 'users', uid, 'cleared', cid), { at: serverTimestamp() });
export const markConversationRead = (cid: string, uid: string) => updateDoc(doc(db, 'conversations', cid), { [`unread.${uid}`]: 0 });

// ---------------------------------------------------------------- messages (text and GIFs)
const toMsg = (id: string, d: DocumentData): Message => ({
  id, senderId: d.senderId, senderName: d.senderName, kind: d.kind, text: d.text, url: d.url,
  createdAt: ms(d.createdAt), readBy: d.readBy ?? [], state: 'sent',
});

export function watchMessages(cid: string, pageSize: number, after: number | undefined, cb: (m: Message[]) => void): Unsubscribe {
  const base = collection(db, 'conversations', cid, 'messages');
  const q = after
    ? query(base, where('createdAt', '>', Timestamp.fromMillis(after)), orderBy('createdAt', 'desc'), limit(pageSize))
    : query(base, orderBy('createdAt', 'desc'), limit(pageSize));
  return onSnapshot(q, (s) => cb(s.docs.map((d) => toMsg(d.id, d.data({ serverTimestamps: 'estimate' }))).reverse()), () => cb([]));
}

export interface OutgoingMessage { id: string; kind: MessageKind; text?: string; url?: string }
export const newMessageId = (cid: string) => doc(collection(db, 'conversations', cid, 'messages')).id;

const previewOf = (m: OutgoingMessage, text?: string) =>
  m.kind === 'gif' ? 'GIF' : m.kind === 'image' ? 'Photo' : m.kind === 'video' ? 'Video' : (text ?? '').slice(0, 120);

/** Resolves only after the server accepted the write; throws otherwise so the UI can show "failed". */
export async function sendMessage(conv: Conversation, me: Profile, m: OutgoingMessage) {
  const body: Record<string, unknown> = {
    senderId: me.uid, senderName: me.displayName, kind: m.kind, createdAt: serverTimestamp(), readBy: [me.uid],
  };
  if (m.kind === 'text') {
    const text = (m.text ?? '').trim();
    if (!text || text.length > 4000) throw new Error('Messages must be 1–4000 characters.');
    body.text = text;
  } else {
    if (m.kind !== 'gif' && !(m.url && HOSTED_URL.test(m.url))) throw new Error('The photo or video is not uploaded yet.');
    body.url = m.url;
  }
  const batch = writeBatch(db);
  batch.set(doc(db, 'conversations', conv.id, 'messages', m.id), body);
  const unread: Record<string, unknown> = {};
  for (const member of conv.members) if (member !== me.uid) unread[`unread.${member}`] = increment(1);
  batch.update(doc(db, 'conversations', conv.id), {
    lastMessage: { text: previewOf(m, body.text as string | undefined), senderId: me.uid },
    updatedAt: serverTimestamp(), ...unread,
  });
  await batch.commit();
}

export async function markMessagesRead(cid: string, uid: string, msgs: Message[]) {
  const todo = msgs.filter((m) => m.state === 'sent' && m.senderId !== uid && !m.readBy.includes(uid)).slice(0, 400);
  if (!todo.length) return;
  const batch = writeBatch(db);
  todo.forEach((m) => batch.update(doc(db, 'conversations', cid, 'messages', m.id), { readBy: arrayUnion(uid) }));
  await batch.commit();
}

// ---------------------------------------------------------------- status (text only)
const toStatus = (id: string, d: DocumentData): Status => ({
  id, authorId: d.authorId, authorName: d.authorName, kind: 'text', text: d.text ?? '',
  createdAt: ms(d.createdAt), expiresAt: ms(d.expiresAt), viewers: d.viewers ?? [],
});

export function watchStatuses(uid: string, cb: (s: Status[]) => void): Unsubscribe {
  const merge = new Map<string, Status[]>();
  const emit = () => {
    const all = [...merge.values()].flat();
    const seen = new Set<string>();
    cb(all.filter((s) => s.expiresAt > Date.now() && !seen.has(s.id) && seen.add(s.id)).sort((a, b) => b.createdAt - a.createdAt));
  };
  const mk = (key: string, q: ReturnType<typeof query>) => onSnapshot(q,
    (s) => { merge.set(key, s.docs.map((d) => toStatus(d.id, d.data({ serverTimestamps: 'estimate' })))); emit(); },
    () => { merge.set(key, []); emit(); });
  const a = mk('viewer', query(collection(db, 'statuses'), where('viewers', 'array-contains', uid), limit(100)));
  const b = mk('mine', query(collection(db, 'statuses'), where('authorId', '==', uid), limit(50)));
  return () => { a(); b(); };
}

export async function publishStatus(me: Profile, viewers: string[], text: string) {
  const t = text.trim();
  if (!t) throw new Error('Write something to share.');
  const id = doc(collection(db, 'statuses')).id;
  await setDoc(doc(db, 'statuses', id), {
    authorId: me.uid, authorName: me.displayName, kind: 'text', text: t.slice(0, 700),
    viewers: viewers.filter((v) => v !== me.uid).slice(0, 500),
    createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + 24 * 3600_000),
  });
}
export const deleteStatus = (s: Status) => deleteDoc(doc(db, 'statuses', s.id));
export const markStatusViewed = (sid: string, uid: string) => setDoc(doc(db, 'statuses', sid, 'views', uid), { at: serverTimestamp() }).catch(() => undefined);
export function watchStatusViews(sid: string, cb: (n: number) => void): Unsubscribe {
  return onSnapshot(collection(db, 'statuses', sid, 'views'), (s) => cb(s.size), () => cb(0));
}

// ---------------------------------------------------------------- account deletion
/** Removes the profile, number, contacts and cleared markers, then the sign-in.
 *  Messages you sent remain in conversations (other members' history); see README. */
export async function deleteAccount(user: User, profile: Profile) {
  const uid = user.uid;
  for (const name of ['contacts', 'cleared'] as const) {
    const docs = await new Promise<{ id: string }[]>((res) => { const u = onSnapshot(collection(db, 'users', uid, name), (s) => { u(); res(s.docs); }, () => res([])); });
    await Promise.all(docs.map((d) => deleteDoc(doc(db, 'users', uid, name, d.id))));
  }
  if (profile.phone) await deleteDoc(doc(db, 'phoneIndex', profile.phone)).catch(() => undefined);
  await deleteDoc(doc(db, 'users', uid));
  await deleteUser(user);
}
