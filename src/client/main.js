// LEGEND ARENA — client entry. Boot → Firebase (graceful) → menu → match loop.
// 60 FPS render loop decoupled from the fixed-timestep sim (30 Hz) via the Driver seam.
import { initAudio } from './sfx.js';
import { LocalDriver, RemoteDriver, buildMatchConfig } from './net.js';
import { Renderer } from './render.js';
import { Controls } from './controls.js';
import { HUD } from './hud.js';
import { Screens } from './screens.js';
import { FIREBASE_CONFIG, FIREBASE_SDK_BASE } from './firebaseConfig.js';

const $ = id => document.getElementById(id);

let renderer = null, controls = null, hud = null, driver = null, screens = null;
let lastFrame = 0;
let ONLINE_WS = null; // set when the player chooses multiplayer

// ---------- boot ----------
async function boot() {
  screens = new Screens({ startMatch });
  // multiplayer (P4): needs the Node server. Pages-hosted clients can point at any server URL.
  $('btn-multiplayer').disabled = false;
  $('btn-multiplayer').addEventListener('click', () => {
    const def = (location.protocol.startsWith('http') && !location.hostname.includes('github.io')) ? location.origin.replace(/^http/, 'ws') + '/ws' : '';
    const url = prompt('Legend Arena server WebSocket URL:\n(run "npm start" on a host, e.g. ws://localhost:8787/ws)', def || 'ws://localhost:8787/ws');
    if (!url) return;
    ONLINE_WS = url;
    window.__LA_NAME = 'You';
    screens.buildRoleGrid();
    screens.show('screen-role');
  });
  screens.show('screen-boot');
  const status = $('boot-status');
  status.textContent = 'Preparing arena…';
  // warm module graph (shared sim imports) by building nothing yet — first match constructs it.
  // Firebase: connect for auth/presence only. Offline/file:// → stay in local mode.
  try {
    const fb = await connectFirebase();
    if (fb) {
      $('profile-name').textContent = fb.name;
      $('profile-net').textContent = 'ONLINE';
      $('profile-net').className = 'net-badge online';
    }
  } catch { /* offline: local-only */ }
  status.textContent = 'Ready';
  setTimeout(() => screens.show('screen-menu'), 400);
}

async function connectFirebase() {
  try {
    const appMod = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-app.js');
    const authMod = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-auth.js');
    const dbMod = await import(/* @vite-ignore */ FIREBASE_SDK_BASE + 'firebase-database.js');
    const app = appMod.initializeApp(FIREBASE_CONFIG);
    const auth = authMod.getAuth(app);
    const cred = await authMod.signInAnonymously(auth);
    const db = dbMod.getDatabase(app);
    // presence
    const uid = cred.user.uid;
    const ref = dbMod.ref(db, `presence/${uid}`);
    await dbMod.set(ref, { at: Date.now(), screen: 'menu' });
    dbMod.onDisconnect(ref).remove();
    return { name: 'Guest-' + uid.slice(0, 5), app, auth, db, mods: { authMod, dbMod } };
  } catch (e) {
    console.info('Firebase unavailable — continuing in local mode.', e && e.message);
    return null;
  }
}

// ---------- match ----------
function wireMatchClient() {
  // dev/e2e handle (not used by normal gameplay)
  window.__LA = { driver, get renderer() { return renderer; }, get hud() { return hud; }, get controls() { return controls; } };
  renderer.resize();
  hud.initCdMaxes();
  driver.onOver(over => {
    if (hud.overHandled) return;
    hud.overHandled = true;
    setTimeout(() => {
      screens.show('screen-results');
      hud.showResults(over);
      if (driver instanceof RemoteDriver) { try { driver.ws.close(); } catch { } clearInterval(driver._batchTimer); }
      driver = null;
    }, 2600); // let the core-explosion moment breathe
  });
  if (new URLSearchParams(location.search).get('dev') === '1' && driver.sim) hud.buildDevPanel();
  lastFrame = performance.now();
  requestAnimationFrame(loop);
}

async function startMatch(me, plannedAllies, enemyPicks, diff) {
  if (ONLINE_WS) {
    // P4 path: server-authoritative match over WebSocket
    try {
      const rd = new RemoteDriver({ wsUrl: ONLINE_WS, me: { ...me, name: window.__LA_NAME || 'You' }, diff });
      driver = rd;
      driver.onOver(over => {
        if (hud) { hud.overHandled || setTimeout(() => { screens.show('screen-results'); hud.showResults(over); }, 2200); return; }
      });
      await rd.join();
      await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('Matchmaking timed out')), 20000);
        rd.listeners.start.push(() => { clearTimeout(to); res(); });
      });
      driver.me = null; // heroId resolved from server
      screens.show('screen-match');
      renderer = new Renderer($('game'), $('minimap'));
      renderer.me = { id: driver.heroId, heroId: me.hero };
      hud = new HUD({ driver, renderer, controls: null });
      controls = new Controls({ canvas: $('game'), driver, renderer, hud });
      hud.controls = controls;
      wireMatchClient();
    } catch (e) {
      alert('Multiplayer unavailable: ' + e.message + '\nStart the server with: npm start');
      ONLINE_WS = null;
      screens.show('screen-menu');
    }
    return;
  }
  const players = buildMatchConfig(me, plannedAllies, enemyPicks, diff);
  driver = new LocalDriver({ players, seed: (Math.random() * 1e9) | 0 });
  screens.show('screen-match');
  renderer = new Renderer($('game'), $('minimap'));
  renderer.resize();
  renderer.me = { id: driver.heroId, heroId: me.hero };
  hud = new HUD({ driver, renderer, controls: null });
  controls = new Controls({ canvas: $('game'), driver, renderer, hud });
  hud.controls = controls;
  wireMatchClient();
}

function loop(now) {
  const dt = Math.min(0.05, (now - lastFrame) / 1000);
  lastFrame = now;
  if (!driver) return;
  if (renderer.me && driver.heroId != null && renderer.me.id !== driver.heroId) renderer.me.id = driver.heroId;
  driver.update(dt);
  const v = driver.view();
  if (v.cur && v.cur.ev) hud.processEvents(v.cur.ev);
  controls.tick();
  renderer.setSnapshots(v);
  renderer.draw(dt);
  hud.update(dt);
  initAudioOnce();
  requestAnimationFrame(loop);
}
let audioBooted = false;
function initAudioOnce() {
  if (audioBooted) return;
  audioBooted = true;
  initAudio();
}

// resume audio on first interaction (mobile policy)
window.addEventListener('pointerdown', () => { if (!audioBooted) { audioBooted = true; initAudio(); } }, { once: true });

boot();
