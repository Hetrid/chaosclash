// LEGEND ARENA — Firebase access layer (project: legendarena).
// Used ONLY for: anonymous auth, presence, matchmaking queue, relay matches, results.
// Never 60Hz match traffic: relay runs at 10 Hz input batches / 10 Hz snapshots.
// The Chaos Clash method: Firebase IS the server, so any https page (GitHub Pages on
// iPad, phones, PCs) can play multiplayer with zero extra hosting.
import { FIREBASE_CONFIG, FIREBASE_SDK_BASE } from './firebaseConfig.js';

// A minimal, framework-agnostic API surface so tests can stub it.
// api: { uid, r(path), set(path, val), remove(path), onValue(path, cb)->unsub,
//        onDisconnectRemove(path), now() }
export async function ensureFirebase() {
  if (typeof window !== 'undefined' && window.__LA_FB_STUB) {
    return wrapStub(window.__LA_FB_STUB);
  }
  try {
    const appMod = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-app.js');
    const authMod = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-auth.js');
    const dbMod = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-database.js');
    const app = appMod.initializeApp(FIREBASE_CONFIG);
    const auth = authMod.getAuth(app);
    const cred = await authMod.signInAnonymously(auth);
    const db = dbMod.getDatabase(app);
    const api = {
      kind: 'live',
      uid: cred.user.uid,
      r: p => dbMod.ref(db, p),
      set: (p, v) => dbMod.set(dbMod.ref(db, p), v),
      update: (p, v) => dbMod.update(dbMod.ref(db, p), v),
      remove: p => dbMod.remove(dbMod.ref(db, p)),
      onValue: (p, cb) => dbMod.onValue(dbMod.ref(db, p), s => cb(s.val())),
      onDisconnectRemove: p => dbMod.onDisconnect(dbMod.ref(db, p)).remove(),
      now: () => Date.now(),
    };
    return api;
  } catch (e) {
    console.info('Firebase unavailable:', e && e.message);
    return null;
  }
}

// Test stub contract: window.__LA_FB_STUB provides the same fns directly.
function wrapStub(stub) {
  return {
    kind: 'stub',
    uid: stub.uid(),
    r: p => stub.r(p),
    set: (p, v) => stub.set(p, v),
    update: (p, v) => stub.update(p, v),
    remove: p => stub.remove(p),
    onValue: (p, cb) => stub.onValue(p, cb),
    onDisconnectRemove: p => stub.onDisconnectRemove(p),
    now: () => Date.now(),
  };
}

// presence heartbeat (P5)
export async function startPresence(fb, screenFn) {
  if (!fb) return;
  const write = () => fb.set(`presence/${fb.uid}`, { at: fb.now(), screen: screenFn() }).catch(() => { });
  await write().catch(() => { });
  fb.onDisconnectRemove(`presence/${fb.uid}`).catch?.(() => { });
  setInterval(write, 45000);
}
