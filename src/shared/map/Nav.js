// Legend Arena — nav grid + A* pathfinding for bots (shared sim/client/server).
import { MAP } from './MapData.js';

const CELL = 64;
export const NAV = {
  n: 0, walk: null,

  init() {
    if (this.walk) return;
    const n = this.n = Math.ceil(MAP.size / CELL);
    const walk = this.walk = new Uint8Array(n * n);
    const R = 34; // unit radius margin
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const cx = x * CELL + CELL / 2, cy = y * CELL + CELL / 2;
      walk[y * n + x] = this._blocked(cx, cy, R) ? 0 : 1;
    }
  },
  _blocked(x, y, R) {
    for (const w of MAP.walls) {
      if (x > w.x - R && x < w.x + w.w + R && y > w.y - R && y < w.y + w.h + R) return true;
    }
    return false;
  },
  walkable(x, y) {
    this.init();
    const cx = (x / CELL) | 0, cy = (y / CELL) | 0;
    if (cx < 0 || cy < 0 || cx >= this.n || cy >= this.n) return false;
    return !!this.walk[cy * this.n + cx];
  },
  nearestWalkable(x, y) {
    this.init();
    let cx = Math.min(this.n - 1, Math.max(0, (x / CELL) | 0));
    let cy = Math.min(this.n - 1, Math.max(0, (y / CELL) | 0));
    if (this.walk[cy * this.n + cx]) return [cx * CELL + CELL / 2, cy * CELL + CELL / 2];
    for (let r = 1; r < 10; r++) {
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this.n || ny >= this.n) continue;
        if (this.walk[ny * this.n + nx]) return [nx * CELL + CELL / 2, ny * CELL + CELL / 2];
      }
    }
    return [x, y];
  },

  // A* (octile). Returns array of world points or null. Limited node budget.
  findPath(sx, sy, tx, ty, budget = 2600) {
    this.init();
    const n = this.n;
    let [scx, scy] = [Math.min(n - 1, Math.max(0, (sx / CELL) | 0)), Math.min(n - 1, Math.max(0, (sy / CELL) | 0))];
    let [tcx, tcy] = [Math.min(n - 1, Math.max(0, (tx / CELL) | 0)), Math.min(n - 1, Math.max(0, (ty / CELL) | 0))];
    if (!this.walk[scy * n + scx]) { const p = this.nearestWalkable(sx, sy); scx = (p[0] / CELL) | 0; scy = (p[1] / CELL) | 0; }
    if (!this.walk[tcy * n + tcx]) { const p = this.nearestWalkable(tx, ty); tcx = (p[0] / CELL) | 0; tcy = (p[1] / CELL) | 0; }
    const start = scy * n + scx, goal = tcy * n + tcx;
    if (start === goal) return [[tx, ty]];
    const g = new Float32Array(n * n).fill(Infinity);
    const came = new Int32Array(n * n).fill(-1);
    const open = [start]; g[start] = 0;
    const hf = i => { const dx = Math.abs((i % n) - tcx), dy = Math.abs(((i / n) | 0) - tcy); return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy); };
    const f = new Float32Array(n * n).fill(Infinity); f[start] = hf(start);
    const closed = new Uint8Array(n * n);
    let nodes = 0;
    const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (open.length && nodes < budget) {
      // binary-heap-less: pick min (open is small in practice; bots repath infrequently)
      let bi = 0, bf = f[open[0]];
      for (let i = 1; i < open.length; i++) if (f[open[i]] < bf) { bf = f[open[i]]; bi = i; }
      const cur = open.splice(bi, 1)[0];
      if (cur === goal) {
        const pts = [];
        let c = cur;
        while (c !== -1) { pts.push([(c % n) * CELL + CELL / 2, ((c / n) | 0) * CELL + CELL / 2]); c = came[c]; }
        pts.reverse();
        pts[pts.length - 1] = [tx, ty];
        return this.smooth(pts);
      }
      nodes++;
      closed[cur] = 1;
      const cx = cur % n, cy = (cur / n) | 0;
      for (const [dx, dy, cost] of D) {
        const nx2 = cx + dx, ny2 = cy + dy;
        if (nx2 < 0 || ny2 < 0 || nx2 >= n || ny2 >= n) continue;
        const ni = ny2 * n + nx2;
        if (!this.walk[ni] || closed[ni]) continue;
        if (dx && dy && (!this.walk[cy * n + nx2] || !this.walk[ny2 * n + cx])) continue; // no corner cutting
        const ng = g[cur] + cost;
        if (ng < g[ni]) { g[ni] = ng; came[ni] = cur; f[ni] = ng + hf(ni); open.push(ni); }
      }
    }
    return null;
  },

  smooth(pts) {
    // string-pulling via wall LOS
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = pts.length - 1;
      for (; j > i + 1; j--) {
        if (!this.losBlocked(pts[i][0], pts[i][1], pts[j][0], pts[j][1])) break;
      }
      out.push(pts[j]); i = j;
    }
    return out;
  },
  losBlocked(ax, ay, bx, by) {
    const d = Math.hypot(bx - ax, by - ay);
    const steps = Math.ceil(d / 40);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      if (!this.walkable(x, y)) return true;
    }
    return false;
  },
};
