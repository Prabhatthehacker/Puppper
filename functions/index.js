// OPTIONAL. Deletes expired statuses (and their photos) every hour so they can never be listed.
// Needs the Firebase Blaze (pay-as-you-go) plan. The app works without it; see README step "Optional extras".
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');

initializeApp();

exports.cleanupStatuses = onSchedule('every 60 minutes', async () => {
  const db = getFirestore();
  const snap = await db.collection('statuses').where('expiresAt', '<', Timestamp.now()).limit(400).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
});
