// LEGEND ARENA — net layer seam.
// The renderer/HUD/controls NEVER touch the Sim directly; they consume snapshot-shaped
// data from a Driver. Today: LocalDriver (browser runs the authoritative sim locally —
// this is the GitHub Pages / vs-bots path). Tomorrow: RemoteDriver speaks WebSocket to
// the Node server (P4/P5) with the exact same surface, so no client code changes.
//
// TODO(P4): if the page is opened via file:// (no http server), dynamic import of the
// gstatic Firebase SDK still works, but auth popups/redirects may be blocked by the
// browser. The client degrades to OFFLINE local play gracefully — that is intentional.
import { Sim } from '../shared/game/Sim.js';
import { HERO_LIST, HEROES } from '../shared/heroes/HeroRegistry.js';

export const SIM_HZ = 30;
export const SIM_DT = 1 / 30;

export const ROLES = ['EXP', 'JUNGLE', 'MID', 'GOLD', 'ROAM'];

// Build the 10-player config for a local vs-bots match.
// me: {hero, role, spell, name}; allyPicks: heroIds to force onto your team (optional);
// enemyPicks: heroIds to force onto enemy team (optional). One hero per team max;
// the enemy MAY mirror your picks.
export function buildMatchConfig(me, allyPicks = [], enemyPicks = [], diff = 2) {
  const usedAlly = new Set([me.hero, ...allyPicks]);
  const allyRoles = ROLES.filter(r => r !== me.role);
  const allies = [];
  for (const role of allyRoles) {
    const cand = HERO_LIST.filter(id => !usedAlly.has(id));
    const pref = cand.filter(id => HEROES[id].recommendedLane === role);
    const list = pref.length ? pref : cand;
    const pick = list[Math.floor(Math.random() * list.length)];
    usedAlly.add(pick);
    allies.push(pick);
  }
  const usedEnemy = new Set(enemyPicks);
  const enemies = [...enemyPicks];
  while (enemies.length < 5) {
    const cand = HERO_LIST.filter(id => !usedEnemy.has(id)); // distinct within team 1
    const pick = cand[Math.floor(Math.random() * cand.length)];
    usedEnemy.add(pick);
    enemies.push(pick);
  }
  const players = [
    { hero: me.hero, team: 0, slot: 0, name: me.name || 'You', controller: 'local', role: me.role, spell: me.spell },
    ...allies.map((h, i) => ({ hero: h, team: 0, slot: i + 1, name: 'Ally' + (i + 1), controller: 'bot', role: allyRoles[i], botLevel: diff })),
    ...enemies.map((h, i) => ({ hero: h, team: 1, slot: i, name: 'Foe' + (i + 1), controller: 'bot', role: ROLES[i], botLevel: diff })),
  ];
  return players;
}

export class LocalDriver {
  // players: full 10-player config (see buildMatchConfig)
  constructor({ players, seed }) {
    this.sim = new Sim({ seed: seed ?? (Math.random() * 1e9) | 0, players });
    this.me = this.sim.heroes.find(h => h.controller === 'local') || this.sim.heroes[0];
    this.acc = 0;
    this.last = null; this.prev = null;   // interpolated snapshot pair
    this.over = false;
    this.listeners = { over: [] };
  }
  get heroId() { return this.me.id; }
  applyInput(input) { this.sim.applyInput(this.me, input); }
  // advance sim with fixed timestep; call once per animation frame with dt seconds
  update(dt) {
    if (this.over) return;
    this.acc = Math.min(this.acc + dt, 0.25); // clamp: never spiral after tab-away
    let stepped = false;
    while (this.acc >= SIM_DT) {
      this.sim.step();
      this.acc -= SIM_DT;
      stepped = true;
      if (this.sim.matchOver) { this.over = true; this.emitOver(); break; }
    }
    if (stepped) { this.prev = this.last; this.last = this.sim.snapshot(0); }
  }
  // snapshot pair for render interpolation; alpha in [0,1)
  view() { return { prev: this.prev, cur: this.last, alpha: this.acc / SIM_DT }; }
  onOver(cb) { this.listeners.over.push(cb); }
  emitOver() { for (const cb of this.listeners.over) cb(this.sim.matchOver); }
}

// ---------------- Firebase relay multiplayer (the Chaos Clash method) ----------------
// Works from ANY https page (GitHub Pages on iPad) because Firebase is the server.
// Traffic ceiling: 10 Hz input batches + 10 Hz snapshots — never 60 Hz writes.
// Paths: queue/{uid}, matches/{id}/{meta,snap,in/0,in/1,over}, results/{id}.

export const RELAY_HZ = 10;

// Deterministic pairing with a matched-handshake so the guest can never go blind:
// - host (older entry; tie: lower uid) derives matchId from sorted uids, writes meta in
//   startMatch, then marks its OWN queue entry {matched: matchId} and removes the guest's.
// - guest sees the host's matched entry (or derives the id from any peer entry) and joins.
export async function firebaseMatchmake(fb, myInfo, { onStatus = () => { } } = {}) {
  const uid = fb.uid;
  const myEntry = { ...myInfo, at: fb.now() };
  await fb.set(`queue/${uid}`, myEntry);
  fb.onDisconnectRemove(`queue/${uid}`).catch?.(() => { });
  return new Promise((resolve, reject) => {
    let done = false;
    const t0 = Date.now();
    const finish = async (role, matchId, otherUid, other) => {
      done = true;
      try { unsub && unsub(); } catch { }
      try { await fb.remove(`queue/${uid}`); } catch { }
      resolve({ role, matchId, other: { uid: otherUid, ...other }, myEntry });
    };
    const unsub = fb.onValue('queue', async q => {
      if (done) return;
      const mine = (q || {})[uid];
      if (mine && mine.matched) { // someone paired with me first — join their match
        await finish('guest', mine.matched, mine.matchedBy || null, mine);
        return;
      }
      const others = Object.entries(q || {})
        .filter(([k, v]) => k !== uid && v && v.hero && v.at && Date.now() - v.at < 45000)
        .sort((a, b) => a[1].at - b[1].at || (a[0] < b[0] ? -1 : 1));
      if (!others.length) {
        onStatus(Date.now() - t0 > 4000 ? 'Searching for an opponent…' : 'Contacting arena…');
        return;
      }
      const [otherUid, other] = others[0];
      const [a, b] = [uid, otherUid].sort();
      const matchId = `m_${a.slice(0, 8)}_${b.slice(0, 8)}`;
      if (other.matched && other.matched.includes(uid.slice(0, 8))) {
        await finish('guest', other.matched, otherUid, other);
        return;
      }
      const iAmHost = other.at > myEntry.at || (other.at === myEntry.at && uid < otherUid);
      if (iAmHost) {
        done = true;
        try { unsub(); } catch { }
        try { await fb.remove(`queue/${otherUid}`); } catch { }
        await fb.set(`queue/${uid}`, { ...myEntry, matched: matchId, matchedBy: otherUid }).catch(() => { });
        resolve({ role: 'host', matchId, other: { uid: otherUid, ...other }, myEntry });
        return;
      }
      onStatus('Opponent found — connecting…'); // guest: wait for the host's matched flag
    });
    setTimeout(() => { if (!done) { done = true; try { unsub && unsub(); } catch { } reject(new Error('Matchmaking timed out')); } }, 45000);
  });
}

// Attach to an existing queued entry when rejoining (helper for refresh mid-queue).
export async function cancelFirebaseQueue(fb) { try { await fb.remove(`queue/${fb.uid}`); } catch { } }

// HOST: runs the authoritative sim locally and relays snapshots to the guest.
export class FirebaseRelayHost {
  constructor(fb, driver, matchId, guestUid) {
    this.fb = fb; this.driver = driver; this.matchId = matchId;
    this.timer = null; this.stopped = false;
    this.guestHero = driver.sim.heroes.find(h => h.controller === 'remote');
    driver.onOver(over => this.finish(over));
    this.start();
  }
  async start() {
    // clear stale channels, then stream
    await this.fb.remove(`matches/${this.matchId}/in/1`).catch(() => { });
    this.fb.onValue(`matches/${this.matchId}/in/1`, async batch => {
      if (!batch || !this.guestHero) return;
      for (const input of batch.b || []) this.driver.sim.applyInput(this.guestHero, input);
      await this.fb.remove(`matches/${this.matchId}/in/1`).catch(() => { });
    });
    this.timer = setInterval(async () => {
      if (this.stopped) return;
      try {
        const snap = this.driver.sim.snapshot(0);
        await this.fb.set(`matches/${this.matchId}/snap`, snap);
        // keep our presence fresh so the guest sees us online
      } catch { }
    }, 1000 / RELAY_HZ);
  }
  async finish(over) {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    try {
      // final snapshot carries the result so the guest sees it immediately
      await this.fb.set(`matches/${this.matchId}/snap`, { ...this.driver.sim.snapshot(0), over });
      await this.fb.set(`matches/${this.matchId}/over`, over);
      const heroes = this.driver.sim.heroes.map(h => ({ hero: h.heroId, team: h.team, k: h.kills, d: h.deaths, lvl: h.level }));
      await this.fb.set(`results/${this.matchId}`, { when: this.fb.now(), winner: over && over.winner, reason: over && over.reason, t: Math.round(this.driver.sim.t), heroes });
      await this.fb.set(`matches/${this.matchId}/state`, 'done');
    } catch { }
  }
  stop() { this.stopped = true; clearInterval(this.timer); }
}

// GUEST: renders host snapshots, sends 10 Hz input batches. Same driver surface.
export class FirebaseRelayGuest {
  constructor(fb, matchId, myInfo) {
    this.fb = fb; this.matchId = matchId; this.meInfo = myInfo;
    this.heroId = null; this.mySnap = null;
    this.prev = null; this.last = null; this.alpha = 0; this.acc = 0;
    this.pending = [];
    this.over = false;
    this.listeners = { over: [] };
    this._batchTimer = setInterval(() => this._flush(), 1000 / RELAY_HZ);
    this._started = new Promise(resolve => {
      fb.onValue(`matches/${this.matchId}/snap`, snap => {
        if (!snap || this.over) return;
        this.prev = this.last; this.last = snap;
        this.alpha = 0;
        if (!this.heroId) {
          const me = (snap.heroes || []).find(h => h.tm === 1 && h.sl === 0);
          this.heroId = me ? me.i : (snap.heroes && snap.heroes[0] && snap.heroes[0].i);
        }
        if (snap.over && !this.over) { this.over = true; for (const cb of this.listeners.over) cb(snap.over); }
        resolve();
      });
    });
  }
  async waitForSnap(ms = 30000) {
    const to = setTimeout(() => { if (!this.last) throw new Error('Host did not start the match'); }, ms);
    await this._started;
    clearTimeout(to);
  }
  applyInput(input) { this.pending.push(input); }
  _flush() {
    if (!this.pending.length) return;
    const batch = this.pending.splice(0, this.pending.length);
    this.fb.set(`matches/${this.matchId}/in/1`, { b: batch, t: this.fb.now() }).catch(() => { });
  }
  update(dt) {
    if (!this.last) return;
    this.acc = Math.min(this.acc + dt, 0.3);
    this.alpha = Math.min(1.35, this.acc / 0.1);
    if (this.alpha >= 1) this.acc = 0;
  }
  view() { return { prev: this.prev, cur: this.last, alpha: Math.max(0, Math.min(1, this.alpha)) }; }
  onOver(cb) { this.listeners.over.push(cb); }
}

// RemoteDriver — speaks WebSocket to the authoritative Node server (P4).
// Server steps the sim; client receives 10 Hz snapshots per viewer team, interpolates,
// and sends input batches at 10 Hz. Same surface as LocalDriver.
export class RemoteDriver {
  constructor({ wsUrl, me, diff = 2 }) {
    this.meInfo = me; // {hero, role, spell, name}
    this.ws = new WebSocket(wsUrl);
    this.heroId = null;
    this.team = 0;
    this.pending = [];            // inputs awaiting the next batch
    this.snaps = [];              // buffered snapshots (ordered)
    this.last = null; this.prev = null;
    this.alpha = 0; this.acc = 0;
    this.over = false;
    this.listeners = { over: [], start: [] };
    this._open = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = () => rej(new Error('Cannot reach server at ' + wsUrl)); });
    this.ws.onmessage = ev => this._onMessage(JSON.parse(ev.data));
    this.ws.onclose = () => { if (!this.over) console.warn('Server connection closed'); };
    this._batchTimer = setInterval(() => this._flushBatch(), 100); // 10 Hz input batches
    this.diff = diff;
  }
  async join(info) {
    if (info) this.meInfo = info;
    await this._open;
    this.joined = true;
    this.ws.send(JSON.stringify({ t: 'join', name: this.meInfo.name, hero: this.meInfo.hero, role: this.meInfo.role, spell: this.meInfo.spell, diff: this.diff }));
  }
  waitForStart(ms = 30000) {
    return new Promise((res, rej) => {
      const to = setTimeout(() => rej(new Error('Matchmaking timed out — is the server running?')), ms);
      this.listeners.start.push(() => { clearTimeout(to); res(); });
    });
  }
  _onMessage(m) {
    if (m.t === 'start') {
      this.heroId = m.you;
      this.team = m.team;
      for (const cb of this.listeners.start) cb(m);
    } else if (m.t === 'snap') {
      this.prev = this.last;
      this.last = m.s;
      this.alpha = 0;
      if (m.s.over && !this.over) { this.over = true; for (const cb of this.listeners.over) cb(m.s.over); }
    } else if (m.t === 'reject') {
      console.warn('Server rejected:', m.why);
    }
  }
  _flushBatch() {
    if (!this.ws || this.ws.readyState !== 1) return;
    if (this.heroId == null) return;
    if (this.pending.length) {
      this.ws.send(JSON.stringify({ t: 'in', batch: this.pending }));
      this.pending = [];
    }
  }
  applyInput(input) { this.pending.push(input); }
  update(dt) {
    if (!this.last) return;
    this.acc = Math.min(this.acc + dt, 0.3);
    // interpolate across 100ms of snapshot spacing
    this.alpha = Math.min(1.35, this.acc / 0.1);
    if (this.alpha >= 1) this.acc = 0;
  }
  view() { return { prev: this.prev, cur: this.last, alpha: Math.max(0, Math.min(1, this.alpha)) }; }
  onOver(cb) { this.listeners.over.push(cb); }
}
