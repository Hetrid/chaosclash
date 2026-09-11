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

// ---------- boot ----------
async function boot() {
  screens = new Screens({ startMatch });
  // VS BOTS must never touch the network
  $('btn-play').addEventListener('click', () => { screens.online = false; }, { capture: true });
  // MULTIPLAYER: real connect modal (no prompt dialogs)
  $('btn-multiplayer').disabled = false;
  $('btn-multiplayer').addEventListener('click', () => openMpModal());
  $('mp-cancel').addEventListener('click', () => $('mp-modal').classList.add('hidden'));
  $('mp-connect').addEventListener('click', () => mpConnect());
  $('mp-url').addEventListener('keydown', e => { if (e.key === 'Enter') mpConnect(); });
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

// ---------- multiplayer connect modal ----------
function defaultWsUrl() {
  try { const saved = localStorage.getItem('la_ws'); if (saved) return saved; } catch { }
  if (location.protocol === 'http:' || location.protocol === 'ws:') return location.origin.replace(/^http/, 'ws') + '/ws';
  return 'ws://localhost:8787/ws';
}
function openMpModal(errText) {
  // drop any stale pre-connection
  if (window.__laRemote && !window.__laRemote.joined) { try { window.__laRemote.ws.close(); } catch { } window.__laRemote = null; }
  $('mp-url').value = defaultWsUrl();
  $('mp-error').textContent = errText || '';
  $('mp-connect').disabled = false;
  $('mp-connect').textContent = 'CONNECT';
  $('mp-modal').classList.remove('hidden');
}
async function mpConnect() {
  const url = $('mp-url').value.trim();
  if (!url) { $('mp-error').textContent = 'Enter a server address.'; return; }
  $('mp-connect').disabled = true;
  $('mp-connect').textContent = 'CONNECTING…';
  $('mp-error').textContent = '';
  try {
    const rd = new RemoteDriver({ wsUrl: url, me: { hero: null, role: null, spell: null, name: 'You' } });
    await rd._open;
    try { localStorage.setItem('la_ws', url); } catch { }
    window.__laRemote = rd;
    screens.online = true;
    $('mp-modal').classList.add('hidden');
    screens.buildRoleGrid();
    screens.show('screen-role');
  } catch (e) {
    openMpModal('Cannot reach server at ' + url + ' — start it with "npm start" (see steps above).');
  }
}

async function startMatch(me, plannedAllies, enemyPicks, diff) {
  if (screens.online && window.__laRemote) {
    const rd = window.__laRemote;
    window.__laRemote = null;
    screens.show('screen-loading');
    $('load-team0').innerHTML = ''; $('load-team1').innerHTML = '';
    $('loading-fill').style.width = '30%';
    $('loading-tip').textContent = 'Joining server match…';
    try {
      await rd.join({ name: 'You', hero: me.hero, role: me.role, spell: me.spell, diff });
      $('loading-tip').textContent = 'Waiting for an opponent (a bot will fill in)…';
      $('loading-fill').style.width = '60%';
      await rd.waitForStart(30000);
      $('loading-fill').style.width = '100%';
    } catch (e) {
      try { rd.ws.close(); } catch { }
      screens.online = false;
      screens.show('screen-menu');
      openMpModal('Matchmaking failed: ' + e.message);
      return;
    }
    driver = rd;
    screens.show('screen-match');
    renderer = new Renderer($('game'), $('minimap'));
    renderer.me = { id: rd.heroId, heroId: me.hero };
    hud = new HUD({ driver, renderer, controls: null });
    controls = new Controls({ canvas: $('game'), driver, renderer, hud });
    hud.controls = controls;
    wireMatchClient();
    return;
  }
  screens.online = false;
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
