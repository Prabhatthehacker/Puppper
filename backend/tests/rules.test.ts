import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, initializeTestEnvironment, RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, addDoc, collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore';

let env: RulesTestEnvironment;
const hour = 3600_000;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-pupper',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});
afterAll(async () => { await env.cleanup(); });

beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'conversations/c1'), {
      type: 'direct', members: ['alice', 'bob'], createdBy: 'alice', unread: {}, updatedAt: Timestamp.now(),
    });
    await setDoc(doc(db, 'conversations/g1'), {
      type: 'group', name: 'Team', members: ['alice', 'bob', 'carol'], admins: ['alice'],
      createdBy: 'alice', unread: {}, updatedAt: Timestamp.now(),
    });
    await setDoc(doc(db, 'conversations/c1/messages/m1'), {
      senderId: 'alice', senderName: 'Alice', kind: 'text', text: 'hi', createdAt: Timestamp.now(), readBy: ['alice'],
    });
    await setDoc(doc(db, 'statuses/expired'), {
      authorId: 'alice', authorName: 'Alice', kind: 'text', text: 'old', viewers: ['bob'],
      createdAt: Timestamp.fromMillis(Date.now() - 30 * hour), expiresAt: Timestamp.fromMillis(Date.now() - 6 * hour),
    });
    await setDoc(doc(db, 'statuses/live'), {
      authorId: 'alice', authorName: 'Alice', kind: 'text', text: 'new', viewers: ['bob'],
      createdAt: Timestamp.now(), expiresAt: Timestamp.fromMillis(Date.now() + 20 * hour),
    });
    await setDoc(doc(db, 'calls/call1'), {
      callerId: 'alice', participants: ['alice', 'bob'], conversationId: 'c1', type: 'voice', state: 'ringing',
    });
  });
});

const as = (uid: string) => env.authenticatedContext(uid).firestore();

describe('conversations & messages', () => {
  it('denies unauthenticated reads', async () => {
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'conversations/c1')));
  });
  it('lets members read and denies non-members', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), 'conversations/c1/messages/m1')));
    await assertFails(getDoc(doc(as('mallory'), 'conversations/c1/messages/m1')));
    await assertFails(getDoc(doc(as('mallory'), 'conversations/c1')));
  });
  const msg = (senderId: string) => ({
    senderId, senderName: 'X', kind: 'text', text: 'hello', createdAt: serverTimestamp(), readBy: [senderId],
  });
  it('lets a member send and blocks spoofed senders and non-members', async () => {
    await assertSucceeds(addDoc(collection(as('bob'), 'conversations/c1/messages'), msg('bob')));
    await assertFails(addDoc(collection(as('bob'), 'conversations/c1/messages'), msg('alice')));
    await assertFails(addDoc(collection(as('mallory'), 'conversations/c1/messages'), msg('mallory')));
  });
  it('rejects oversize text and non-giphy GIF hosts', async () => {
    await assertFails(addDoc(collection(as('bob'), 'conversations/c1/messages'), { ...msg('bob'), text: 'x'.repeat(4001) }));
    await assertFails(addDoc(collection(as('bob'), 'conversations/c1/messages'),
      { ...msg('bob'), kind: 'gif', url: 'https://evil.example/x.gif' }));
  });
  it('accepts photo/video links only from the file host', async () => {
    const col = () => collection(as('bob'), 'conversations/c1/messages');
    const media = (kind: string, url?: string) => {
      const { text: _text, ...rest } = msg('bob');
      return { ...rest, kind, ...(url ? { url } : {}) };
    };
    await assertSucceeds(addDoc(col(), media('image', 'https://files.catbox.moe/abc123.png')));
    await assertSucceeds(addDoc(col(), media('video', 'https://files.catbox.moe/abc123.mp4')));
    await assertFails(addDoc(col(), media('image', 'https://evil.example/a.png')));
    await assertFails(addDoc(col(), media('image', 'http://files.catbox.moe/a.png')));
    await assertFails(addDoc(col(), media('video')));
    await assertFails(addDoc(col(), media('file', 'https://files.catbox.moe/abc123.pdf')));
  });
  it('allows only own uid in readBy', async () => {
    const ref = doc(as('bob'), 'conversations/c1/messages/m1');
    await assertSucceeds(updateDoc(ref, { readBy: ['alice', 'bob'] }));
    await assertFails(updateDoc(ref, { readBy: ['alice', 'bob', 'carol'] }));
    await assertFails(updateDoc(ref, { text: 'edited' }));
  });
  it('never allows deleting conversations or messages', async () => {
    await assertFails(deleteDoc(doc(as('alice'), 'conversations/c1')));
    await assertFails(deleteDoc(doc(as('alice'), 'conversations/c1/messages/m1')));
  });
});

describe('assigned numbers', () => {
  const claim = (uid: string, number: string) => {
    const db = as(uid); const b = writeBatch(db);
    b.set(doc(db, 'phoneIndex', number), { uid });
    b.set(doc(db, 'users', uid), { displayName: 'New', phone: number, createdAt: serverTimestamp() });
    return b.commit();
  };
  it('lets a new user claim a free 10-digit number', async () => {
    await assertSucceeds(claim('dave', '4815162342'));
  });
  it('refuses a number that is already taken', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => { await setDoc(doc(ctx.firestore(), 'phoneIndex/4815162342'), { uid: 'someone' }); });
    await assertFails(claim('dave', '4815162342'));
  });
  it('refuses malformed numbers and numbers claimed for another uid', async () => {
    await assertFails(claim('dave', '0123456789'));
    await assertFails(claim('dave', '12345'));
    const db = as('dave'); const b = writeBatch(db);
    b.set(doc(db, 'phoneIndex', '5555555555'), { uid: 'eve' });
    b.set(doc(db, 'users', 'dave'), { displayName: 'D', phone: '5555555555', createdAt: serverTimestamp() });
    await assertFails(b.commit());
  });
  it('never lets the number change or be listed', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'users/dave'), { displayName: 'D', phone: '4815162342', createdAt: Timestamp.now() });
      await setDoc(doc(ctx.firestore(), 'phoneIndex/4815162342'), { uid: 'dave' });
    });
    await assertFails(updateDoc(doc(as('dave'), 'users/dave'), { phone: '1111111111' }));
    await assertSucceeds(updateDoc(doc(as('dave'), 'users/dave'), { displayName: 'Dave' }));
    await assertFails(updateDoc(doc(as('mallory'), 'phoneIndex/4815162342'), { uid: 'mallory' }));
    await assertFails(deleteDoc(doc(as('mallory'), 'phoneIndex/4815162342')));
    await assertSucceeds(getDoc(doc(as('mallory'), 'phoneIndex/4815162342')));
  });
});

describe('groups', () => {
  it('lets only admins rename and add members', async () => {
    await assertFails(updateDoc(doc(as('bob'), 'conversations/g1'), { name: 'Hacked', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as('alice'), 'conversations/g1'), { name: 'Renamed', updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as('alice'), 'conversations/g1'),
      { members: ['alice', 'bob', 'carol', 'dave'], updatedAt: serverTimestamp() }));
  });
  it('blocks an admin removing other members but lets a member leave', async () => {
    await assertFails(updateDoc(doc(as('alice'), 'conversations/g1'), { members: ['alice'], updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(as('carol'), 'conversations/g1'),
      { members: ['alice', 'bob'], admins: ['alice'], updatedAt: serverTimestamp() }));
  });
});

describe('status', () => {
  it('hides expired statuses on direct reads and non-audience users', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), 'statuses/live')));
    await assertFails(getDoc(doc(as('bob'), 'statuses/expired')));
    await assertFails(getDoc(doc(as('mallory'), 'statuses/live')));
  });
  const status = (expiresInMs: number) => ({
    authorId: 'alice', authorName: 'Alice', kind: 'text', text: 'hey', viewers: ['bob'],
    createdAt: serverTimestamp(), expiresAt: Timestamp.fromMillis(Date.now() + expiresInMs),
  });
  it('forces a ~24h lifetime on creation', async () => {
    await assertSucceeds(setDoc(doc(as('alice'), 'statuses/s1'), status(24 * hour)));
    await assertFails(setDoc(doc(as('alice'), 'statuses/s2'), status(72 * hour)));
    await assertFails(setDoc(doc(as('alice'), 'statuses/s3'), status(1 * hour)));
  });
  it('lets only the author delete', async () => {
    await assertFails(deleteDoc(doc(as('bob'), 'statuses/live')));
    await assertSucceeds(deleteDoc(doc(as('alice'), 'statuses/live')));
  });
});

describe('call signaling', () => {
  it('is visible to participants only', async () => {
    await assertSucceeds(getDoc(doc(as('bob'), 'calls/call1')));
    await assertFails(getDoc(doc(as('mallory'), 'calls/call1')));
    await assertFails(setDoc(doc(as('mallory'), 'calls/call1/candidates/x'), { from: 'mallory', candidate: 'c' }));
  });
  it('only allows calls between members of a conversation', async () => {
    const base = { callerId: 'alice', type: 'voice', state: 'ringing', conversationId: 'c1' };
    await assertSucceeds(setDoc(doc(as('alice'), 'calls/ok'), { ...base, participants: ['alice', 'bob'] }));
    await assertFails(setDoc(doc(as('alice'), 'calls/bad'), { ...base, participants: ['alice', 'mallory'] }));
  });
});
