// Map sanity checker: lanes walkable, camps reachable via A*, no lane/wall overlaps.
import { MAP, LANES, CAMPS, OBJECTIVES, FOUNTAIN, CORE } from '../src/shared/map/MapData.js';
import { segAabbHit, dist } from '../src/shared/core/math.js';

const CELL = 64, N = Math.ceil(MAP.size / CELL);
const walk = new Uint8Array(N * N);
const R = 30; // hero radius margin

function wallBlocks(cx, cy) {
  const x0 = cx * CELL, y0 = cy * CELL;
  for (const w of MAP.walls) {
    if (x0 + R < w.x || x0 + CELL - R > w.x + w.w || y0 + R < w.y || y0 + CELL - R > w.y + w.h) continue;
    // overlap of cell center region with wall inflated by R
    const wx0 = w.x - R, wy0 = w.y - R, wx1 = w.x + w.w + R, wy1 = w.y + w.h + R;
    if (x0 + CELL > wx0 && x0 < wx1 && y0 + CELL > wy0 && y0 < wy1) {
      // check center point within inflated rect
      if (cx * CELL + CELL / 2 > wx0 && cx * CELL + CELL / 2 < wx1 && cy * CELL + CELL / 2 > wy0 && cy * CELL + CELL / 2 < wy1) return true;
    }
  }
  return false;
}
for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) walk[y * N + x] = wallBlocks(x, y) ? 0 : 1;

let fails = 0;
const fail = msg => { fails++; console.log('  ✗ ' + msg); };
const ok = msg => console.log('  ✓ ' + msg);

// 1. lane polylines must not cross walls
for (const [id, pts] of Object.entries(LANES)) {
  let hit = null;
  for (let i = 0; i < pts.length - 1 && !hit; i++) {
    // sample the segment densely
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const d = dist(ax, ay, bx, by), steps = Math.ceil(d / 24);
    for (let s = 0; s <= steps; s++) {
      const x = ax + (bx - ax) * s / steps, y = ay + (by - ay) * s / steps;
      const w = MAP.walls.find(w => x > w.x - R && x < w.x + w.w + R && y > w.y - R && y < w.y + w.h + R);
      if (w) { hit = { id, seg: i, x: Math.round(x), y: Math.round(y), wall: w }; break; }
    }
  }
  hit ? fail(`lane ${id} crosses wall ${JSON.stringify(hit.wall)} at (${hit.x},${hit.y}) seg ${hit.seg}`) : ok(`lane ${id} clear (${pts.length} pts)`);
}

// 2. A* from each camp/objective to nearest lane midpoint, and lanes to each other
function toCell(x, y) { return [Math.min(N - 1, Math.max(0, (x / CELL) | 0)), Math.min(N - 1, Math.max(0, (y / CELL) | 0))]; }
function nearestWalkable(cx, cy) {
  for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = cx + dx, y = cy + dy;
    if (x >= 0 && y >= 0 && x < N && y < N && walk[y * N + x]) return [x, y];
  }
  return null;
}
function astar(sx, sy, tx, ty) {
  const start = nearestWalkable(...toCell(sx, sy)), goal = nearestWalkable(...toCell(tx, ty));
  if (!start || !goal) return null;
  const key = (x, y) => y * N + x;
  const open = [[start[0], start[1]]], g = new Map([[key(...start), 0]]), came = new Map();
  const h = (x, y) => Math.abs(x - goal[0]) + Math.abs(y - goal[1]);
  const f = new Map([[key(...start), h(...start)]]);
  const closed = new Set();
  while (open.length) {
    let bi = 0; for (let i = 1; i < open.length; i++) if ((f.get(key(...open[i])) ?? 1e9) < (f.get(key(...open[bi])) ?? 1e9)) bi = i;
    const [cx, cy] = open.splice(bi, 1)[0];
    const ck = key(cx, cy);
    if (cx === goal[0] && cy === goal[1]) {
      const path = [[cx, cy]]; let k = ck;
      while (came.has(k)) { k = came.get(k); path.push([k % N, (k / N) | 0]); }
      return path.reverse();
    }
    if (closed.has(ck)) continue; closed.add(ck);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N || !walk[ny * N + nx]) continue;
      if (dx && dy && (!walk[cy * N + nx] || !walk[ny * N + cx])) continue;
      const nk = key(nx, ny), ng = (g.get(ck) ?? 1e9) + (dx && dy ? 1.414 : 1);
      if (ng < (g.get(nk) ?? 1e9)) { g.set(nk, ng); f.set(nk, ng + h(nx, ny)); came.set(nk, ck); open.push([nx, ny]); }
    }
  }
  return null;
}
const laneMids = { TOP: [620, 2400], MID: [2740, 3660], BOT: [3450, 5780] };
const probes = [
  ...CAMPS.map(c => [c.id, c.x, c.y]),
  ...Object.values(OBJECTIVES).map(o => [o.id, o.x, o.y]),
  ['fountain0', FOUNTAIN[0][0], FOUNTAIN[0][1]], ['fountain1', FOUNTAIN[1][0], FOUNTAIN[1][1]],
  ['core0', CORE[0][0], CORE[0][1]], ['core1', CORE[1][0], CORE[1][1]],
];
for (const [id, x, y] of probes) {
  let best = null, bestLen = 1e9;
  for (const [lid, [lx, ly]] of Object.entries(laneMids)) {
    const p = astar(x, y, lx, ly);
    if (p && p.length < bestLen) { bestLen = p.length; best = lid; }
  }
  best ? ok(`${id} connected (via ${best}, ${bestLen} cells)`) : fail(`${id} NOT connected to any lane`);
}
// lanes mutually reachable
const lids = Object.keys(laneMids);
for (let i = 0; i < lids.length; i++) for (let j = i + 1; j < lids.length; j++) {
  astar(...laneMids[lids[i]], ...laneMids[lids[j]]) ? ok(`lane ${lids[i]}↔${lids[j]} connected`) : fail(`lane ${lids[i]}↔${lids[j]} disconnected`);
}
// turrets reachable from their lane
for (const t of MAP.turrets) {
  const laneMid = laneMids[t.lane === 'BASE' ? 'MID' : t.lane];
  astar(t.x, t.y, ...laneMid) ? 0 : fail(`turret ${t.id} unreachable`);
}
ok('turrets checked');
console.log(fails === 0 ? '\nMAP OK' : `\nMAP FAILURES: ${fails}`);
process.exit(fails === 0 ? 0 : 1);
