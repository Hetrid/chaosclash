// Legend Arena — hero entity: creation, per-tick lifecycle (regen, recall, respawn, timers).
import { CONFIG } from '../core/config.js';
import { dist } from '../core/math.js';
import { computeStats } from '../game/Stats.js';
import { tickStatuses, tickRecall } from '../game/StatusSystem.js';
import { tickShields } from '../game/Damage.js';
import { HEROES } from '../heroes/HeroRegistry.js';

let NEXT_ID = 1;
export const nextId = () => NEXT_ID++;

export function createHero(world, { heroId, team, slot, name, controller, uid, botLevel = 1, role }) {
  const def = HEROES[heroId];
  if (!def) throw new Error('unknown hero ' + heroId);
  const [fx, fy] = world.map.fountain[team];
  const h = {
    id: nextId(), kind: 'hero', heroId, def, team, slot, name: name || def.n,
    controller, uid: uid || null, aiRole: role || def.recommendedLane,
    x: fx, y: fy, r: 40, aim: team === 0 ? -Math.PI / 4 : Math.PI * 0.75,
    level: 1, xp: 0, gold: CONFIG.GOLD_START, goldEarned: 0,
    hp: 1, maxHp: 1, mana: 0, maxMana: 1, shield: 0, shields: [],
    items: [], buffs: [], cc: {}, ccImmuneUntil: 0, invulnUntil: 0,
    dead: false, hpHidden: false, deathT: 0, respawnAt: 0,
    kills: 0, deaths: 0, assists: 0, streak: 0, streakAtDeath: 0,
    atkCd: 0, castLock: 0, casting: null, channeling: null, dashing: null,
    recall: null, moveIntent: null, lastCombat: -99, dmgLog: [],
    cds: { q: 0, e: 0, r: 0, spell: 0 },
    stats: null, dmgDealt: 0, dmgTaken: 0, healDone: 0,
    lastMoveT: 0, botLevel, custom: {}, rankRole: role || def.recommendedLane,
  };
  h.onDealtDamage = (w, tgt, amt, ev) => def.hooks?.onDealtDamage?.(w, h, tgt, amt, ev);
  h.onDamaged = (w, src, amt, ev) => def.hooks?.onDamaged?.(w, h, src, amt, ev);
  h.onKill = (w, victim) => def.hooks?.onKill?.(w, h, victim);
  refreshMax(h);
  h.hp = h.maxHp; h.mana = h.maxMana;
  return h;
}

export function refreshMax(h) {
  h.stats = computeStats(h);
  const oldMax = h.maxHp;
  h.maxHp = Math.round(h.stats.maxHp);
  if (h.maxHp > oldMax) h.hp += h.maxHp - oldMax;
  h.hp = Math.min(h.hp, h.maxHp);
  h.maxMana = Math.round(h.stats.maxMana) || 0;
  h.mana = h.maxMana ? Math.min(h.mana || h.maxMana, h.maxMana) : 0;
}

export function grantXpLevels(world, h) { world.xp.checkLevel(world, h); }

// per-tick hero lifecycle (movement handled by Movement system)
export function tickHero(world, h, dt) {
  h.stats = h.stats || computeStats(h);
  tickStatuses(world, h, dt);
  tickShields(world, h);

  if (h.dead) {
    if (world.t >= h.respawnAt) respawnHero(world, h);
    return;
  }

  // regen
  const inFountain = inFountainArea(world, h);
  h.hp = Math.min(h.maxHp, h.hp + h.maxHp * (inFountain ? CONFIG.FOUNTAIN_HEAL : 0) * dt + h.stats.hpRegen * dt);
  if (h.maxMana) h.mana = Math.min(h.maxMana, h.mana + h.maxMana * (inFountain ? CONFIG.FOUNTAIN_MANA : 0) * dt + h.stats.manaRegen * dt);
  if (inFountain) h.invulnUntil = Math.max(h.invulnUntil, 0); // fountain does not grant immunity

  // cast lock / attack cooldowns
  h.atkCd = Math.max(0, h.atkCd - dt);
  h.castLock = Math.max(0, h.castLock - dt);
  for (const k of ['q', 'e', 'r', 'spell']) h.cds[k] = Math.max(0, h.cds[k] - dt);

  // channels
  if (h.channeling) {
    h.channeling.t += dt;
    h.channeling.tick?.(world, h, dt);
    if (h.channeling && world.t >= h.channeling.ends) { const c = h.channeling; h.channeling = null; c.finish?.(world, h); }
  }
  tickRecall(world, h);

  // dash progress
  if (h.dashing) {
    const d = h.dashing;
    d.t += dt;
    const k = Math.min(1, d.t / d.dur);
    const nx = d.x0 + (d.x1 - d.x0) * k, ny = d.y0 + (d.y1 - d.y0) * k;
    h.x = nx; h.y = ny; h.aim = d.aim;
    h.dashing.k = k;
    if (d.onProgress) d.onProgress(world, h, k);
    if (k >= 1) { const dash = h.dashing; h.dashing = null; dash.onEnd?.(world, h); }
  }

  if (h.phoenixUsed && world.t > (h.phoenixCdUntil || 0)) h.phoenixUsed = false;
  // out-of-combat tracker
  if (world.t - h.lastCombat > 5 && h.combatDirty) { h.combatDirty = false; }
}
export { tickShields };

export function inFountainArea(world, h) {
  const [fx, fy] = world.map.fountain[h.team];
  return dist(h.x, h.y, fx, fy) < 420;
}

export function nearShop(world, h) {
  const [fx, fy] = world.map.fountain[h.team];
  return !h.dead && dist(h.x, h.y, fx, fy) < CONFIG.SHOP_RADIUS;
}

export function respawnHero(world, h) {
  const [fx, fy] = world.map.fountain[h.team];
  h.dead = false;
  h.x = fx + (world.rng.f() - 0.5) * 60;
  h.y = fy + (world.rng.f() - 0.5) * 60;
  h.hp = h.maxHp; h.mana = h.maxMana;
  h.invulnUntil = world.t + CONFIG.SPAWN_SHIELD_S;
  h.streak = 0;
  h.atkCd = 0.5; h.castLock = 0;
  world.emit({ type: 'respawn', id: h.id });
}
