// Legend Arena — ability kit primitives. Every hero ability composes these effects,
// which keeps 80+ abilities data-driven, testable and bot-scriptable.
import { dealDamage, heal, addShield } from '../game/Damage.js';
import { applyCC, applyBuff, canCast, isCCd } from '../game/StatusSystem.js';
import { createProjectile } from '../entities/Projectile.js';
import { dist, clamp, angleTo } from '../core/math.js';
import { MAP } from '../map/MapData.js';
import { isHero } from '../entities/kinds.js';

export const scaleAmt = (hero, base, perLvl, ratioKey, ratio) => {
  const s = hero.stats;
  return base + perLvl * (hero.level - 1) + (ratio && s ? (s[ratioKey] || 0) * ratio : 0);
};

export const kit = {
  // ---- targeting helpers ----
  nearestEnemy(world, h, range, filter) {
    let best = null, bd = range * range;
    world.grid.query(h.x, h.y, range, u => {
      if (u.dead || u.team === h.team || u.invulnUntil > world.t) return;
      if (u.kind !== 'hero' && u.kind !== 'monster' && u.kind !== 'minion' && u.kind !== 'summon' && u.kind !== 'colossus') return;
      if (filter && !filter(u)) return;
      const d = dist(h.x, h.y, u.x, u.y);
      if (d * d <= bd) { bd = d * d; best = u; }
    });
    return best;
  },
  enemiesInRadius(world, h, x, y, r, opts = {}) {
    const out = [];
    world.grid.query(x, y, r + 40, u => {
      if (u.dead || u.invulnUntil > world.t) return;
      if (opts.enemiesOnly !== false && u.team === h.team) return;
      if (!['hero', 'minion', 'monster', 'summon', 'colossus'].includes(u.kind)) return;
      if (opts.heroesOnly && u.kind !== 'hero') return;
      if (dist(x, y, u.x, u.y) <= r + (u.r || 30) * 0.5) out.push(u);
    });
    return out;
  },
  alliesInRadius(world, h, x, y, r, includeSelf = true) {
    const out = [];
    if (includeSelf && !h.dead) out.push(h);
    for (const o of world.heroes) {
      if (o === h || o.team !== h.team || o.dead) continue;
      if (dist(x, y, o.x, o.y) <= r) out.push(o);
    }
    return out;
  },

  // ---- damage delivery ----
  proj(world, h, o) {
    const p = createProjectile(world, {
      src: h, x: o.x ?? h.x, y: o.y ?? (h.y - 14), aim: o.aim, speed: o.speed || 1000,
      range: o.range || 600, radius: o.radius || 18, dmg: o.dmg,
      dtype: o.dtype || 'phys', category: o.category || 'skill', kindLabel: o.kind || h.heroId,
      pierce: o.pierce || 0, canCrit: !!o.canCrit, color: o.color || h.def.c1, size: o.size || 1,
      hitOnce: o.hitOnce !== false, homing: o.homing ?? null, onHit: o.onHit, onEnd: o.onEnd, trail: o.trail,
    });
    world.projectiles.push(p);
    world.emit({ type: 'proj', id: p.id, x: p.x, y: p.y, aim: p.aim, speed: p.speed, range: p.range, color: p.color, size: p.size, hero: h.heroId, kind: o.kind || 'skill' });
    return p;
  },
  hit(world, h, tgt, dmg, o = {}) {
    return dealDamage(world, { src: h, tgt, amount: dmg, dtype: o.dtype || 'magic', category: o.category || 'skill', kindLabel: o.kind || h.heroId, canCrit: o.canCrit, melee: o.melee });
  },
  aoe(world, h, x, y, r, dmg, o = {}) {
    const targets = kit.enemiesInRadius(world, h, x, y, r, o);
    for (const t of targets) {
      dealDamage(world, { src: h, tgt: t, amount: dmg, dtype: o.dtype || 'magic', category: o.category || 'skill', kindLabel: o.kind || h.heroId });
      if (o.slow) applyCC(world, t, 'slow', o.slowDur || 1.2, { pct: o.slow });
      if (o.stun) applyCC(world, t, 'stun', o.stun);
      if (o.root) applyCC(world, t, 'root', o.root);
      if (o.silence) applyCC(world, t, 'silence', o.silence);
      if (o.knockup) applyCC(world, t, 'knockup', o.knockup);
      if (o.knock) knock(world, t, x, y, o.knock, o.knockDist || 180);
      if (o.pullTo) pullToward(world, t, o.pullTo.x, o.pullTo.y, o.pullStrength || 300, o.pullDur || 0.4);
      o.perTarget?.(world, h, t);
    }
    if (o.delay === undefined) world.emit({ type: 'aoe', x, y, r, color: o.color || h.def.c1, hero: h.heroId, shape: o.shape });
    return targets;
  },
  delayedAoe(world, h, x, y, r, dmg, delay, o = {}) {
    world.areas.push({
      kind: 'area', shape: 'circle', x, y, r, team: h.team, src: h,
      until: world.t + delay, armAt: world.t + delay, color: o.color || h.def.c1,
      telegraph: true, hero: h.heroId, visual: o.visual || 'blast',
      onArm: (world, a) => { kit.aoe(world, h, x, y, r, dmg, { ...o, delay: undefined }); o.onDetonate?.(world, h, x, y, r); },
    });
  },
  zone(world, h, x, y, r, dur, o = {}) {
    const z = {
      kind: 'area', shape: o.shape || 'circle', zone: true, x, y, r, team: h.team, src: h,
      until: world.t + dur, born: world.t, color: o.color || h.def.c1, hero: h.heroId,
      every: o.every || 0.5, next: 0, visual: o.visual || (o.heal ? 'healzone' : 'zone'),
      slow: o.slow, slowDur: o.slowDur || 0.6, dmg: o.dmg, dtype: o.dtype || 'magic',
      heal: o.heal, shield: o.shield, pull: o.pull, sil: o.silence, per: o.per, onExpire: o.onExpire,
      follow: o.follow, wall: o.wall || null, blocksProjectiles: o.blocksProjectiles, anchor: o.anchor,
    };
    world.areas.push(z);
    world.emit({ type: 'zone', id: z.until + '' + (world.areas.length), x, y, r, dur, color: z.color, hero: h.heroId, visual: z.visual, team: h.team });
    return z;
  },
  wall(world, h, x1, y1, x2, y2, dur, o = {}) {
    const w = { x1, y1, x2, y2, until: world.t + dur, blocksProjectiles: o.blocksProjectiles !== false, team: h.team, src: h, color: o.color || h.def.c1, hero: h.heroId, kind: 'wallzone' };
    // axis-aligned rect representation for collision
    const pad = 16;
    w.rect = { x: Math.min(x1, x2) - pad, y: Math.min(y1, y2) - pad, w: Math.abs(x2 - x1) + pad * 2, h: Math.abs(y2 - y1) + pad * 2 };
    world.areas.push({ kind: 'area', wall: true, ...w, until: world.t + dur, shape: 'wall' });
    world.emit({ type: 'wallZone', x1, y1, x2, y2, dur, color: w.color, hero: h.heroId });
    return w;
  },

  // ---- movement ----
  dash(world, h, o) {
    const distWant = o.dist || 300;
    const aim = o.aim ?? h.aim;
    let tx = o.tx ?? h.x + Math.cos(aim) * distWant;
    let ty = o.ty ?? h.y + Math.sin(aim) * distWant;
    if (!o.throughWalls) [tx, ty] = kit.clampDash(world, h, tx, ty, distWant);
    h.dashing = { x0: h.x, y0: h.y, x1: tx, y1: ty, t: 0, dur: o.dur || Math.max(0.12, dist(h.x, h.y, tx, ty) / (o.speed || 1100)), aim, onEnd: o.onEnd, onProgress: o.onProgress, throughWalls: !!o.throughWalls };
    h.recall = null;
    world.emit({ type: 'dash', id: h.id, x: h.x, y: h.y, tx, ty, dur: h.dashing.dur, hero: h.heroId });
    return h.dashing;
  },
  clampDash(world, h, tx, ty, maxDist) {
    // walk the ray until a wall blocks; stop short of walls
    const dx = tx - h.x, dy = ty - h.y;
    const d = Math.hypot(dx, dy);
    if (d === 0) return [h.x, h.y];
    const ux = dx / d, uy = dy / d;
    const steps = Math.ceil(d / 16);
    let lastGood = 0;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = h.x + ux * d * t, py = h.y + uy * d * t;
      const blocked = worldBlockedAt(world, px, py, h.r);
      if (blocked) break;
      lastGood = t;
    }
    const tt = lastGood;
    return [h.x + ux * d * tt, h.y + uy * d * tt];
  },
  blink(world, h, tx, ty, maxDist = 360) {
    const d = dist(h.x, h.y, tx, ty);
    if (d > maxDist) { const k = maxDist / d; tx = h.x + (tx - h.x) * k; ty = h.y + (ty - h.y) * k; }
    const [cx, cy] = kit.clampDash(world, h, tx, ty, maxDist);
    world.emit({ type: 'blink', id: h.id, x: h.x, y: h.y, tx: cx, ty: cy, hero: h.heroId });
    h.x = cx; h.y = cy;
    h.recall = null;
  },
  knock(world, t, fromX, fromY, dur = 0.3, distWant = 180) {
    if (!t || t.dead) return;
    if (!t.cc) t.cc = {};
    const a = angleTo(fromX, fromY, t.x, t.y);
    const ten = t.stats?.tenacity || 0;
    const d = distWant * (1 - ten * 0.5);
    t.cc.knock = { until: world.t + dur, dirX: Math.cos(a), dirY: Math.sin(a), dist: d, traveled: 0 };
    if (t.recall) t.recall = null;
  },
  pullToward(world, t, tx, ty, strength = 300, dur = 0.4) {
    if (!t || t.dead) return;
    if (!t.cc) t.cc = {};
    const a = angleTo(t.x, t.y, tx, ty);
    const ten = t.stats?.tenacity || 0;
    t.cc.knock = { until: world.t + dur, dirX: Math.cos(a), dirY: Math.sin(a), dist: strength * dur * (1 - ten * 0.5), traveled: 0 };
    if (t.recall) t.recall = null;
  },

  // ---- support ----
  heal(world, h, targets, amount, dur = 0) {
    for (const t of targets) heal(world, t, amount, 'skill', h);
  },
  shield(world, h, targets, amount, dur = 2.5) {
    for (const t of targets) addShield(world, t, amount, dur, h.heroId + 'shield');
  },
  buff(world, h, targets, buff) {
    for (const t of targets) applyBuff(world, t, buff);
  },

  // ---- summon (Forge sentry) ----
  summonSentry(world, h, x, y, o = {}) {
    const s = {
      world,
      id: Math.random().toString(36).slice(2), kind: 'summon', subtype: 'sentry', owner: h, team: h.team,
      x, y, r: 26, hp: o.hp || (200 + h.level * 30), maxHp: o.hp || (200 + h.level * 30),
      dmg: o.dmg || (18 + h.level * 5 + (h.stats?.physAtk || 0) * 0.25), range: o.range || 420,
      aspd: 0.9, atkCd: 0.5, life: o.life || 7, target: null, retarget: 0, dead: false, magic: !!o.magic,
    };
    world.summons.push(s);
    world.grid.insert(s);
    world.register(s);
    world.emit({ type: 'summon', id: s.id, x, y, hero: h.heroId, subtype: 'sentry', life: s.life });
    return s;
  },
};

export function worldBlockedAt(world, x, y, r) {
  const walls = world.dynamicWalls.length ? [...MAP.walls, ...world.dynamicWallsRects()] : MAP.walls;
  for (const w of walls) {
    const cx = clamp(x, w.x, w.x + w.w), cy = clamp(y, w.y, w.y + w.h);
    const dx = x - cx, dy = y - cy;
    if (dx * dx + dy * dy < r * r) return true;
  }
  return false;
}

export function canCastAbility(world, h, slot) {
  if (h.dead || !canCast(h)) return false;
  if (h.castLock > 0 || h.cds[slot] > 0) return false;
  const ab = h.def.abilities[slot];
  if (!ab) return false;
  if (ab.mana && h.maxMana && h.mana < ab.mana) return false;
  if (h.dashing) return false;
  return true;
}

// generic resource tick: rage decay for rage heroes
export function tickResource(world, h, dt) {
  const res = h.def.resource;
  if (res === 'rage') {
    const c = h.custom;
    if (world.t - h.lastCombat > 4) c.rage = Math.max(0, (c.rage || 0) - 14 * dt);
    c.rage = clamp(c.rage || 0, 0, 100);
  }
}
