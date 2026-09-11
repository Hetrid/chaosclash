// Legend Arena — lane minions: melee / ranged / siege with waypoint march, aggro and bounty.
import { CONFIG } from '../core/config.js';
import { nextId } from './Hero.js';
import { dist, moveToward } from '../core/math.js';
import { LANES } from '../map/MapData.js';

const BASE = {
  melee:  { hp: 520, dmg: 44, range: 60,  aspd: 1.0, ms: 158, r: 30, gold: CONFIG.GOLD_MINION_MELEE, xp: CONFIG.XP_MINION_MELEE },
  ranged: { hp: 350, dmg: 50, range: 250, aspd: 0.85, ms: 158, r: 28, gold: CONFIG.GOLD_MINION_RANGED, xp: CONFIG.XP_MINION_RANGED },
  siege:  { hp: 1050, dmg: 92, range: 500, aspd: 0.55, ms: 140, r: 38, gold: CONFIG.GOLD_MINION_SIEGE, xp: CONFIG.XP_MINION_SIEGE }, // outranges turrets: cannon breaks stalemates
};

export function createMinion(world, team, lane, mtype, waveNum) {
  const b = BASE[mtype];
  const scale = 1 + waveNum * CONFIG.MINION_SCALE_PER_MIN * (CONFIG.WAVE_INTERVAL / 60) * 2.2;
  const [cx, cy] = world.map.core[team];
  return {
    world,
    id: nextId(), kind: 'minion', mtype, team, lane,
    x: cx + (world.rng.f() - 0.5) * 90, y: cy + (world.rng.f() - 0.5) * 90, r: b.r,
    hp: Math.round(b.hp * scale), maxHp: Math.round(b.hp * scale),
    physDef: mtype === 'siege' ? 20 : 12, magDef: mtype === 'siege' ? 20 : 12,
    dmg: b.dmg * scale, range: b.range, aspd: b.aspd, ms: b.ms,
    atkCd: 0, wp: 1, target: null, retarget: 0,
    gold: b.gold, xp: b.xp, dead: false,
  };
}

// waypoint list per team+lane: walk the lane polyline from own base to enemy core
export function lanePath(team, lane) {
  const pts = LANES[lane];
  return team === 0 ? pts : [...pts].reverse();
}

export function tickMinion(world, m, dt, grid) {
  if (m.dead) return;
  m.atkCd = Math.max(0, m.atkCd - dt);
  m.retarget -= dt;

  // --- target acquisition (every 0.4s) ---
  if (m.retarget <= 0 || !validTarget(world, m, m.target)) {
    m.retarget = 0.4;
    m.target = acquireTarget(world, m, grid);
  }
  const t = m.target;

  if (t) {
    const d = dist(m.x, m.y, t.x, t.y) - (t.r || 30);
    if (d <= m.range) {
      m.moveTarget = null;
      if (m.atkCd <= 0) {
        m.atkCd = 1 / m.aspd;
        const isRanged = m.range > 100;
        if (isRanged) world.spawnProjectile({ src: m, tgtId: t.id, x: m.x, y: m.y, aim: Math.atan2(t.y - m.y, t.x - m.x), speed: 760, range: d + 80, radius: 14, dmg: m.dmg, dtype: 'phys', category: 'minion', kindLabel: 'minion', homing: t.id });
        else dealMelee(world, m, t);
        world.emit({ type: 'minionAtk', x: m.x, y: m.y, id: m.id, team: m.team, ranged: isRanged, tx: t.x, ty: t.y });
      }
    } else {
      m.moveTarget = [t.x, t.y];
    }
  } else {
    // march along lane
    const path = lanePath(m.team, m.lane);
    let wp = path[Math.min(m.wp, path.length - 1)];
    if (dist(m.x, m.y, wp[0], wp[1]) < 90 && m.wp < path.length - 1) { m.wp++; wp = path[Math.min(m.wp, path.length - 1)]; }
    m.moveTarget = [wp[0], wp[1]];
  }
}

function validTarget(world, m, t) {
  return t && !t.dead && t.hp > 0 && dist(m.x, m.y, t.x, t.y) < 620 && t.invulnUntil < world.t;
}

// MOBA minion priority: enemy hero attacking allied hero nearby > enemy minion > enemy hero > structure
function acquireTarget(world, m, grid) {
  const vis = 460;
  let best = null, bestScore = -1;
  const consider = (u) => {
    if (u.dead || u.team === m.team || u.invulnUntil > world.t) return;
    const d = dist(m.x, m.y, u.x, u.y);
    if (d > vis + (u.r || 0)) return;
    let score;
    const wounded = 1 - u.hp / u.maxHp; // focus fire resolves wave clashes into pushes
    if (u.kind === 'hero' && u.lastAttackedAllyHero && world.t - u.lastAttackedAllyHeroT < 1.5 && u.lastAttackedAllyHeroTeam === m.team) score = 400 - d + wounded * 60;
    else if (u.kind === 'minion') score = 300 - d + wounded * 140;
    else if (u.kind === 'summon') score = 250 - d + wounded * 100;
    else if (u.kind === 'hero') score = 200 - d + wounded * 60;
    else if (u.kind === 'turret' || u.kind === 'core') score = 50 - d;
    else return;
    if (score > bestScore) { bestScore = score; best = u; }
  };
  grid.query(m.x, m.y, vis, consider);
  // structures (not in unit grid): nearby enemy turret/core on our lane
  if (!best || best.kind !== 'hero') {
    for (const s of world.structures) {
      if (s.team === m.team || s.dead) continue;
      const d = dist(m.x, m.y, s.x, s.y);
      if (d < vis + 40 && (!best || dist(m.x, m.y, best.x, best.y) > d)) {
        if (!best || best.kind !== 'minion' || true) {
          if (!best) best = s;
          else if (best.kind === 'hero') { /* keep hero */ }
          else best = s;
        }
      }
    }
  }
  return best;
}

import { dealDamage } from '../game/Damage.js';
function dealMelee(world, m, t) {
  dealDamage(world, { src: m, tgt: t, amount: m.dmg, dtype: 'phys', category: 'minion', kindLabel: 'minion', melee: true });
}
