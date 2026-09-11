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

// RemoteDriver placeholder — implemented in P4 when the ws server lands.
// It must expose: update(dt), view(), applyInput(input), heroId, onOver(cb).
export class RemoteDriver {
  constructor() { throw new Error('Multiplayer requires the Legend Arena server (npm start). See README.'); }
}
