// Legend Arena — projectiles with swept wall collision, pierce, and homing.
import { nextId } from './Hero.js';
import { segAabbHit, segCircleEnterT, dist, clamp } from '../core/math.js';
import { dealDamage } from '../game/Damage.js';
import { MAP } from '../map/MapData.js';
import { isHero, isMonster, isSummon } from './kinds.js';

export function createProjectile(world, o) {
  return {
    id: nextId(), kind: 'proj', src: o.src, team: o.src.team,
    x: o.x, y: o.y, aim: o.aim,
    vx: Math.cos(o.aim) * o.speed, vy: Math.sin(o.aim) * o.speed,
    speed: o.speed, range: o.range, traveled: 0,
    radius: o.radius || 16, dmg: o.dmg, dtype: o.dtype || 'phys',
    category: o.category || 'skill', kindLabel: o.kindLabel,
    pierce: o.pierce || 0, hitSet: o.hitSet || new Set(),
    homing: o.homing ?? null, canCrit: !!o.canCrit, melee: false,
    color: o.color || null, size: o.size || 1, trail: o.trail || null,
    onHit: o.onHit || null, onEnd: o.onEnd || null, hitOnce: o.hitOnce !== false,
    dead: false,
  };
}

export function tickProjectile(world, p, dt) {
  if (p.dead) return;
  const step = p.speed * dt;
  const nx = p.x + p.vx * dt, ny = p.y + p.vy * dt;

  // homing steer
  if (p.homing != null) {
    const t = world.unitById(p.homing);
    if (t && !t.dead) {
      const want = Math.atan2(t.y - p.y, t.x - p.x);
      const cur = Math.atan2(p.vy, p.vx);
      let d = want - cur;
      while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      const turn = clamp(d, -8 * dt, 8 * dt);
      p.vx = Math.cos(cur + turn) * p.speed; p.vy = Math.sin(cur + turn) * p.speed;
      p.aim = cur + turn;
    } else p.homing = null;
  }

  // --- wall sweep (segment vs walls, static + dynamic) ---
  let hitT = 1, hitWall = false;
  const allWalls = world.dynamicWalls && world.dynamicWalls.length ? MAP.walls.concat(world.dynamicWalls) : MAP.walls;
  for (let i = 0; i < allWalls.length; i++) {
    const w = allWalls[i];
    if (segAabbHit(p.x, p.y, nx, ny, w.x, w.y, w.w, w.h)) {
      // binary refine for impact point
      let lo = 0, hi = 1;
      for (let k = 0; k < 6; k++) {
        const mid = (lo + hi) / 2;
        const mx = p.x + (nx - p.x) * mid, my = p.y + (ny - p.y) * mid;
        const inside = allWalls.some(ww => segAabbHit(p.x, p.y, mx, my, ww.x, ww.y, ww.w, ww.h));
        if (inside) hi = mid; else lo = mid;
      }
      if (hi < hitT) { hitT = hi; hitWall = true; }
    }
  }

  // --- unit hits ---
  const hits = [];
  const p2 = (px, py) => px * px;
  world.grid.query(p.x, p.y, step + p.radius + 80, u => {
    if (u.dead || u.team === p.team) return;
    if (u.invulnUntil > world.t) return;
    if (p.hitSet.has(u.id)) return;
    if (u.kind === 'proj') return;
    const t = segCircleEnterT(p.x, p.y, nx, ny, u.x, u.y, (u.r || 30) + p.radius);
    if (t >= 0 && t < hitT) hits.push([t, u]);
  });
  // structures are hit by projectiles too
  for (const s of world.structures) {
    if (s.dead || s.team === p.team || p.hitSet.has(s.id)) continue;
    if (s.invulnerable) continue;
    const t = segCircleEnterT(p.x, p.y, nx, ny, s.x, s.y, (s.r || 40) + p.radius);
    if (t >= 0 && t < hitT) hits.push([t, s]);
  }
  hits.sort((a, b) => a[0] - b[0]);

  for (const [t, u] of hits) {
    p.hitSet.add(u.id);
    impact(world, p, u);
    if (p.hitOnce) { killProjectile(world, p, u.x, u.y); return; }
    if (p.pierce <= 0) { killProjectile(world, p, u.x, u.y); return; }
    p.pierce--;
  }

  if (hitWall && hits.length === 0) {
    const wx = p.x + (nx - p.x) * hitT, wy = p.y + (ny - p.y) * hitT;
    killProjectile(world, p, wx, wy, true);
    return;
  }

  p.x = nx; p.y = ny;
  p.traveled += step;
  if (p.traveled >= p.range) killProjectile(world, p, p.x, p.y);
}

function impact(world, p, u) {
  if (p.dmg > 0 && p.category !== 'projVisual' && !p.noDamage) {
    dealDamage(world, { src: p.src, tgt: u, amount: p.dmg, dtype: p.dtype, category: p.category, kindLabel: p.kindLabel, canCrit: p.canCrit, melee: p.melee });
  }
  p.onHit?.(world, p, u);
}

function killProjectile(world, p, x, y, wall = false) {
  p.dead = true;
  p.onEnd?.(world, p, x, y, wall);
  world.emit({ type: 'projEnd', id: p.id, x, y, wall, color: p.color, size: p.size });
}
