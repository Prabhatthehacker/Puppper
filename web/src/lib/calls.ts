import { addDoc, collection, doc, onSnapshot, query, serverTimestamp, setDoc, updateDoc, where, type Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import { ms, type CallDoc } from './types';

export type CallState = 'calling' | 'ringing' | 'connecting' | 'connected' | 'reconnecting' | 'ended' | 'rejected' | 'missed' | 'failed';

export function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  const url = import.meta.env.VITE_TURN_URL as string | undefined;
  if (url) servers.push({ urls: url, username: import.meta.env.VITE_TURN_USERNAME as string, credential: import.meta.env.VITE_TURN_CREDENTIAL as string });
  return servers;
}

export const RING_TIMEOUT_MS = 45_000;

export function watchIncomingCalls(uid: string, cb: (c: CallDoc) => void): Unsubscribe {
  const q = collectionQuery(uid);
  return onSnapshot(q, (s) => {
    s.docChanges().forEach((ch) => {
      if (ch.type !== 'added') return;
      const c = toCall(ch.doc.id, ch.doc.data({ serverTimestamps: 'estimate' }));
      if (c.callerId !== uid && c.state === 'ringing' && Date.now() - c.createdAt < RING_TIMEOUT_MS) cb(c);
    });
  }, () => undefined);
}
function collectionQuery(uid: string) {
  return query(collection(db, 'calls'), where('participants', 'array-contains', uid), where('state', '==', 'ringing'));
}
function toCall(id: string, d: Record<string, unknown>): CallDoc {
  return { id, ...(d as object), createdAt: ms(d.createdAt as never) } as CallDoc;
}

/** One WebRTC call. Signaling goes through Firestore (calls/{id} + calls/{id}/candidates). */
export class CallSession {
  pc: RTCPeerConnection;
  local: MediaStream | null = null;
  remote = new MediaStream();
  private unsubs: Unsubscribe[] = [];
  private queued: RTCIceCandidateInit[] = [];
  private timer?: ReturnType<typeof setTimeout>;
  private done = false;

  constructor(
    public callId: string, private me: string, private video: boolean,
    private onState: (s: CallState) => void, private onStreams: () => void,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: iceServers() });
    this.pc.ontrack = (e) => { e.streams[0]?.getTracks().forEach((t) => this.remote.addTrack(t)); this.onStreams(); };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if (s === 'connected') this.onState('connected');
      else if (s === 'disconnected') this.onState('reconnecting');
      else if (s === 'failed') { this.onState('failed'); void this.end('ended'); }
    };
    this.pc.onicecandidate = (e) => {
      if (!e.candidate) return;
      const j = e.candidate.toJSON();
      void addDoc(collection(db, 'calls', this.callId, 'candidates'), {
        from: this.me, candidate: j.candidate, sdpMid: j.sdpMid ?? null, sdpMLineIndex: j.sdpMLineIndex ?? 0, createdAt: serverTimestamp(),
      });
    };
  }

  private async media() {
    // Throws NotAllowedError / NotFoundError; the caller shows a helpful message.
    this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: this.video ? { facingMode: 'user' } : false });
    this.local.getTracks().forEach((t) => this.pc.addTrack(t, this.local!));
    this.onStreams();
  }

  private listenCandidates() {
    this.unsubs.push(onSnapshot(collection(db, 'calls', this.callId, 'candidates'), (s) => s.docChanges().forEach((ch) => {
      if (ch.type !== 'added') return;
      const d = ch.doc.data();
      if (d.from === this.me) return;
      const init: RTCIceCandidateInit = { candidate: d.candidate, sdpMid: d.sdpMid, sdpMLineIndex: d.sdpMLineIndex };
      if (this.pc.remoteDescription) void this.pc.addIceCandidate(init).catch(() => undefined); else this.queued.push(init);
    })));
  }
  private async flush() { for (const c of this.queued.splice(0)) await this.pc.addIceCandidate(c).catch(() => undefined); }

  static async start(me: string, peer: string, conversationId: string, video: boolean, onState: (s: CallState) => void, onStreams: () => void) {
    const callId = doc(collection(db, 'calls')).id;
    const s = new CallSession(callId, me, video, onState, onStreams);
    onState('calling');
    try {
      await s.media();
      const offer = await s.pc.createOffer();
      await s.pc.setLocalDescription(offer);
      await setDoc(doc(db, 'calls', callId), {
        callerId: me, participants: [me, peer], conversationId, type: video ? 'video' : 'voice', state: 'ringing',
        offer: { type: offer.type, sdp: offer.sdp }, createdAt: serverTimestamp(),
      });
    } catch (e) { s.cleanup(); throw e; }
    s.listenCandidates();
    s.unsubs.push(onSnapshot(doc(db, 'calls', callId), async (snap) => {
      const d = snap.data(); if (!d) return;
      if (d.answer && !s.pc.currentRemoteDescription) {
        await s.pc.setRemoteDescription(d.answer); await s.flush(); onState('connecting');
      }
      if (['rejected', 'ended', 'missed'].includes(d.state)) { onState(d.state); s.cleanup(); }
    }));
    s.timer = setTimeout(() => { if (!s.pc.currentRemoteDescription) { onState('missed'); void s.end('missed'); } }, RING_TIMEOUT_MS);
    return s;
  }

  static async answer(me: string, call: CallDoc, onState: (s: CallState) => void, onStreams: () => void) {
    const s = new CallSession(call.id, me, call.type === 'video', onState, onStreams);
    onState('connecting');
    try {
      await s.media();
      await s.pc.setRemoteDescription(call.offer as RTCSessionDescriptionInit);
      const answer = await s.pc.createAnswer();
      await s.pc.setLocalDescription(answer);
      await updateDoc(doc(db, 'calls', call.id), { answer: { type: answer.type, sdp: answer.sdp }, state: 'accepted' });
    } catch (e) { s.cleanup(); await updateDoc(doc(db, 'calls', call.id), { state: 'ended' }).catch(() => undefined); throw e; }
    s.listenCandidates();
    await s.flush();
    s.unsubs.push(onSnapshot(doc(db, 'calls', call.id), (snap) => {
      const st = snap.data()?.state; if (['ended', 'missed'].includes(st)) { onState('ended'); s.cleanup(); }
    }));
    return s;
  }

  static reject(callId: string) { return updateDoc(doc(db, 'calls', callId), { state: 'rejected' }); }

  setMuted(m: boolean) { this.local?.getAudioTracks().forEach((t) => (t.enabled = !m)); }
  setCameraOff(off: boolean) { this.local?.getVideoTracks().forEach((t) => (t.enabled = !off)); }

  async end(state: 'ended' | 'missed' = 'ended') {
    await updateDoc(doc(db, 'calls', this.callId), { state }).catch(() => undefined);
    this.cleanup();
  }
  cleanup() {
    if (this.done) return; this.done = true;
    clearTimeout(this.timer);
    this.unsubs.forEach((u) => u());
    this.local?.getTracks().forEach((t) => t.stop());
    this.pc.close();
  }
}
