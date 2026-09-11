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
  async join() {
    await this._open;
    this.ws.send(JSON.stringify({ t: 'join', name: this.meInfo.name, hero: this.meInfo.hero, role: this.meInfo.role, spell: this.meInfo.spell, diff: this.diff }));
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
