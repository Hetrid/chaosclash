// Legend Arena — shared math, RNG, collision queries, spatial grid.
// Pure JS: safe in browser, Node server, and tests. No DOM usage.

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist2 = (ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay; return dx * dx + dy * dy; };
export const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));
export const angleTo = (ax, ay, bx, by) => Math.atan2(by - ay, bx - ax);
export function angleLerp(a, b, t) { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return a + d * t; }
export const moveToward = (x, y, tx, ty, maxStep) => {
  const d = dist(x, y, tx, ty);
  if (d <= maxStep || d === 0) return [tx, ty, true];
  return [x + ((tx - x) / d) * maxStep, y + ((ty - y) / d) * maxStep, false];
};

// Deterministic RNG (mulberry32). Sim uses one instance; clients never roll gameplay RNG locally.
export function makeRng(seed) {
  let z = seed >>> 0;
  const f = () => { z |= 0; z = (z + 0x6D2B79F5) | 0; let t = Math.imul(z ^ (z >>> 15), 1 | z); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  return { f, range: (a, b) => a + f() * (b - a), int: (a, b) => Math.floor(a + f() * (b - a + 1)), chance: p => f() < p, pick: arr => arr[Math.floor(f() * arr.length) % arr.length] };
}

// Distance from point P to segment AB.
export function segPointDist2(ax, ay, bx, by, px, py) {
  const abx = bx - ax, aby = by - ay;
  const len2 = abx * abx + aby * aby;
  if (len2 === 0) return dist2(ax, ay, px, py);
  let t = ((px - ax) * abx + (py - ay) * aby) / len2;
  t = clamp(t, 0, 1);
  return dist2(ax + abx * t, ay + aby * t, px, py);
}

// Swept segment vs AABB test (Liang-Barsky). Returns true if the moving segment crosses the box.
export function segAabbHit(ax, ay, bx, by, rx, ry, rw, rh) {
  const minX = rx, minY = ry, maxX = rx + rw, maxY = ry + rh;
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  const p = [-dx, dx, -dy, dy];
  const q = [ax - minX, maxX - ax, ay - minY, maxY - ay];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

// Segment vs circle: closest approach of segment to circle center <= r.
export function segCircleHit(ax, ay, bx, by, cx, cy, r) {
  return segPointDist2(ax, ay, bx, by, cx, cy) <= r * r;
}

// Find earliest t in [0,1] where segment enters circle (for projectile ordering).
export function segCircleEnterT(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax, dy = by - ay;
  const fx = ax - cx, fy = ay - cy;
  const a = dx * dx + dy * dy;
  if (a === 0) return (fx * fx + fy * fy) <= r * r ? 0 : -1;
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  let disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  disc = Math.sqrt(disc);
  const t1 = (-b - disc) / (2 * a);
  if (t1 >= 0 && t1 <= 1) return t1;
  const t2 = (-b + disc) / (2 * a);
  if (t2 >= 0 && t2 <= 1) return t2;
  return -1;
}

// Uniform spatial hash grid for radius queries. Rebuilt each tick from the live unit list.
export class SpatialGrid {
  constructor(worldSize, cell = 256) {
    this.cell = cell; this.n = Math.ceil(worldSize / cell);
    this.buckets = new Array(this.n * this.n);
    this.units = [];
  }
  clear() { const b = this.buckets; for (let i = 0; i < b.length; i++) if (b[i]) b[i].length = 0; this.units.length = 0; }
  _idx(x, y) {
    const cx = clamp((x / this.cell) | 0, 0, this.n - 1), cy = clamp((y / this.cell) | 0, 0, this.n - 1);
    return cy * this.n + cx;
  }
  insert(u) {
    this.units.push(u);
    const i = this._idx(u.x, u.y);
    (this.buckets[i] || (this.buckets[i] = [])).push(u);
  }
  // Visit units within radius of (x,y). cb(unit) -> true stops the search.
  query(x, y, r, cb) {
    const c = this.cell, n = this.n;
    const x0 = clamp(((x - r) / c) | 0, 0, n - 1), x1 = clamp(((x + r) / c) | 0, 0, n - 1);
    const y0 = clamp(((y - r) / c) | 0, 0, n - 1), y1 = clamp(((y + r) / c) | 0, 0, n - 1);
    const r2 = r * r;
    for (let gy = y0; gy <= y1; gy++) {
      const row = gy * n;
      for (let gx = x0; gx <= x1; gx++) {
        const bucket = this.buckets[row + gx];
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const u = bucket[i];
          if (dist2(x, y, u.x, u.y) <= r2) { if (cb(u)) return; }
        }
      }
    }
  }
}

// Resolve a circle against a list of AABB walls with axis sliding. Returns [x,y,hitWall].
export function slideCircle(x, y, r, walls) {
  let hit = false;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i];
    const cx = clamp(x, w.x, w.x + w.w), cy = clamp(y, w.y, w.y + w.h);
    const dx = x - cx, dy = y - cy;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    hit = true;
    if (d2 > 1e-9) {
      const d = Math.sqrt(d2);
      x = cx + (dx / d) * r; y = cy + (dy / d) * r;
    } else {
      // Center inside the box: push out along the smallest axis.
      const l = x - w.x, rr = w.x + w.w - x, t = y - w.y, b = w.y + w.h - y;
      const m = Math.min(l, rr, t, b);
      if (m === l) x = w.x - r; else if (m === rr) x = w.x + w.w + r;
      else if (m === t) y = w.y - r; else y = w.y + w.h + r;
    }
  }
  return [x, y, hit];
}
