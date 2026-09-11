// Legend Arena — buffs, debuffs and crowd control with tenacity.
// CC kinds: stun | freeze | root | silence | slow | knockup | knock | pull
// All durations are reduced by target tenacity; knock distances by half of it.
import { clamp } from '../core/math.js';
import { computeStats } from './Stats.js';
import { CONFIG } from '../core/config.js';

export function applyCC(world, tgt, kind, dur, opts = {}) {
  if (!tgt || tgt.dead) return false;
  if (!tgt.cc) tgt.cc = {};
  if ((tgt.invulnUntil || 0) > world.t) return false;
  if (tgt.ccImmuneUntil > world.t && kind !== 'slow') return false;
  const ten = tgt.stats ? clamp(tgt.stats.tenacity || 0, 0, 0.8) : 0;
  const d = dur * (1 - ten);
  if (d <= 0.05) return false;
  const now = world.t;
  const cur = tgt.cc[kind];
  // refresh if longer
  if (!cur || cur.until < now + d) tgt.cc[kind] = { until: now + d, pct: opts.pct ?? 0, src: opts.src ?? null, dir: opts.dir };
  else if (opts.pct !== undefined) cur.pct = Math.max(cur.pct || 0, opts.pct);
  if (tgt.recall) cancelRecall(world, tgt, 'cc');
  return true;
}

export function isCCd(u, ...kinds) {
  for (const k of kinds) { const c = u.cc?.[k]; if (c && c.until > u.world.t) return true; }
  return false;
}
export function ccSlowPct(u) {
  const s = u.cc?.slow;
  return s && s.until > u.world.t ? clamp(s.pct || 0, 0, 0.85) : 0;
}
export function canAct(u) { return !u.dead && !isCCd(u, 'stun', 'freeze', 'knockup'); }
export function canMove(u) { return canAct(u) && !isCCd(u, 'root'); }
export function canCast(u) { return canAct(u) && !isCCd(u, 'silence'); }

// Buff: {id, until, stats?, mult?, multPct?, stacks?, data?, icon?}
export function applyBuff(world, tgt, buff) {
  if (!tgt || tgt.dead) return;
  if (!tgt.buffs) tgt.buffs = [];
  const now = world.t;
  const existing = tgt.buffs.find(b => b.id === buff.id);
  if (existing) {
    if ((buff.until ?? 0) >= existing.until) {
      existing.until = buff.until ?? existing.until;
      existing.stats = buff.stats ?? existing.stats;
      existing.mult = buff.mult ?? existing.mult;
      existing.multPct = buff.multPct ?? existing.multPct;
      existing.data = buff.data ?? existing.data;
      if (buff.stacks) existing.stacks = Math.min(buff.maxStacks || 99, (existing.stacks || 0) + buff.stacks);
    }
  } else {
    tgt.buffs.push({ ...buff, stacks: buff.stacks || 0 });
  }
  if (tgt.kind === 'hero') tgt.stats = computeStats(tgt);
}

export function removeBuff(u, buffId) {
  if (!u?.buffs) return;
  const i = u.buffs.findIndex(b => b.id === buffId);
  if (i >= 0) { u.buffs.splice(i, 1); if (u.kind === 'hero') u.stats = computeStats(u); }
}
export function hasBuff(u, id) { return !!u?.buffs && u.buffs.some(b => b.id === id && b.until > u.world.t); }
export function getBuff(u, id) { return u?.buffs ? (u.buffs.find(b => b.id === id && b.until > u.world.t) || null) : null; }

export function tickStatuses(world, u, dt) {
  const now = world.t;
  let dirty = false;
  for (let i = u.buffs.length - 1; i >= 0; i--) {
    const b = u.buffs[i];
    if (b.until !== undefined && b.until <= now) { u.buffs.splice(i, 1); dirty = true; }
  }
  if (dirty && u.kind === 'hero') u.stats = computeStats(u);
  for (const k in u.cc) if (u.cc[k].until <= now) delete u.cc[k];
}

export function purgeCC(world, u) {
  for (const k in u.cc) if (k !== 'knock' || true) delete u.cc[k];
  u.ccImmuneUntil = world.t + 1.0;
}

// ---- Recall ----
export function startRecall(world, u) {
  if (u.dead || !canAct(u)) return false;
  u.recall = { started: world.t, ends: world.t + CONFIG.RECALL_TIME };
  return true;
}
export function cancelRecall(world, u, reason = 'action') {
  if (!u.recall) return false;
  u.recall = null;
  world.emit({ type: 'recallCancel', id: u.id, reason });
  return true;
}
export function tickRecall(world, u) {
  if (!u.recall) return;
  if (world.t >= u.recall.ends) {
    const [fx, fy] = world.map.fountain[u.team];
    u.x = fx; u.y = fy;
    u.recall = null;
    world.emit({ type: 'recallDone', id: u.id });
  }
}
