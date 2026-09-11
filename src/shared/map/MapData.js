// Legend Arena — "The Sundered Vale" map data.
// Blue team = corner (BL), red = corner (TR). River runs along the y=x diagonal.
// Geometry is generated from ONE authored jungle quadrant + symmetric transforms,
// guaranteeing competitive fairness. All walls are axis-aligned rects.
import { segAabbHit } from '../core/math.js';

export const W = 6400;

// ---------- transforms ----------
const rot180 = (x, y) => [W - x, W - y];
const reflYX = (x, y) => [y, x];
const rectR180 = r => ({ ...r, x: W - r.x - r.w, y: W - r.y - r.h });
const rectYX = r => ({ x: r.y, y: r.x, w: r.h, h: r.w });

// ---------- authored quadrant: BLUE UPPER jungle (west of mid, south of top lane) ----------
const qWalls = [
  // Ember Crest camp ring (opening south-west)
  { x: 1240, y: 2980, w: 640, h: 56 },           // north
  { x: 1824, y: 2980, w: 56, h: 400 },           // east
  { x: 1560, y: 3624, w: 320, h: 56 },           // south (gap x 1240..1560)
  { x: 1240, y: 2980, w: 56, h: 700 },           // west
  // lane separators / corridors
  { x: 940, y: 2160, w: 56, h: 420 },
  { x: 940, y: 2860, w: 420, h: 56 },
  { x: 2100, y: 2450, w: 56, h: 420 },
  { x: 1180, y: 1700, w: 380, h: 56 },
  { x: 2480, y: 3140, w: 56, h: 360 },
  { x: 2340, y: 1560, w: 56, h: 340 },
  { x: 1740, y: 2450, w: 300, h: 56 },
];
const qBushes = [
  { x: 800, y: 2620, w: 260, h: 170 },   // top-lane bush near blue T1
  { x: 2210, y: 3560, w: 220, h: 240 },  // mid-lane bush
  { x: 1900, y: 1960, w: 220, h: 180 },  // jungle path bush
  { x: 1300, y: 3560, w: 240, h: 200 },  // camp-mouth bush (Ember opening)
];
const qSmallCamp = { id: 'hound', x: 2560, y: 3820, count: 2 };
const qBuffCamp = { id: 'ember', x: 1560, y: 3300 };
const qBushRiver = { x: 2060, y: 1300, w: 220, h: 180 };

// derive the other three quadrants
const q2Walls = qWalls.map(rectYX);            // blue lower
const q3Walls = q2Walls.map(rectR180);         // red upper
const q4Walls = qWalls.map(rectR180);          // red lower
const q2Bushes = qBushes.map(rectYX);
const q3Bushes = q2Bushes.map(rectR180);
const q4Bushes = qBushes.map(rectR180);

// ---------- bases ----------
function baseWalls(corner) {
  // corner = 'bl' | 'tr'
  if (corner === 'bl') return [
    { x: 1880, y: 4100, w: 60, h: 220 },   // mid wall upper
    { x: 1880, y: 4820, w: 60, h: 520 },   // mid wall lower
    { x: 900, y: 4460, w: 900, h: 60 },    // top wall right (pulled back from mid gate corner)
    { x: 200, y: 4460, w: 240, h: 60 },    // top wall stub (gap x 440..900 = top-lane gate)
  ];
  return [
    { x: W - 1880 - 60, y: W - 4100 - 220, w: 60, h: 220 },
    { x: W - 1880 - 60, y: W - 4820 - 520, w: 60, h: 520 },
    rectR180({ x: 900, y: 4460, w: 900, h: 60 }),
    rectR180({ x: 200, y: 4460, w: 240, h: 60 }),
  ];
}

// ---------- river pits ----------
function pitWalls(cx, cy, s) {
  const o = s / 2, t = 52;
  return [
    { x: cx - o, y: cy - o, w: s, h: t },                    // north
    { x: cx - o, y: cy - o, w: t, h: s },                    // west
    { x: cx - o, y: cy + o - t, w: s, h: t },                // south
    { x: cx + o - t, y: cy - o, w: t, h: s - 320 },          // east partial → entrance
  ];
}

// ---------- lanes ----------
export const LANES = {
  TOP: [[1080, 5320], [900, 5060], [620, 4620], [620, 4200], [620, 2950], [620, 1500], [940, 1120], [1560, 620], [2950, 620], [4200, 620], [5060, 700], [5320, 1080]],
  MID: [[1080, 5320], [1960, 4440], [2740, 3660], [3200, 3200], [3660, 2740], [4440, 1960], [5320, 1080]],
  BOT: [[1080, 5320], [1340, 5700], [2200, 5780], [3450, 5780], [5100, 5780], [5780, 5100], [5780, 4200], [5780, 2950], [5780, 1500], [5680, 1340], [5320, 1080]],
};

export const FOUNTAIN = [[620, 5760], [5780, 640]];
export const CORE = [[1080, 5320], [5320, 1080]];

// turret ids: lane tier. team 0 = blue, team 1 = red
export const TURRETS = [
  // team 0 — outer (T1), inner (T2)
  { id: 't0_top1', team: 0, lane: 'TOP', tier: 1, x: 620, y: 2950 },
  { id: 't0_top2', team: 0, lane: 'TOP', tier: 2, x: 620, y: 4200 },
  { id: 't0_mid1', team: 0, lane: 'MID', tier: 1, x: 2740, y: 3660 },
  { id: 't0_mid2', team: 0, lane: 'MID', tier: 2, x: 1960, y: 4440 },
  { id: 't0_bot1', team: 0, lane: 'BOT', tier: 1, x: 3450, y: 5780 },
  { id: 't0_bot2', team: 0, lane: 'BOT', tier: 2, x: 2200, y: 5780 },
  { id: 't0_basA', team: 0, lane: 'BASE', tier: 3, x: 1720, y: 4620 },
  { id: 't0_basB', team: 0, lane: 'BASE', tier: 3, x: 680, y: 4760 },
  { id: 't0_basC', team: 0, lane: 'BASE', tier: 3, x: 1720, y: 5800 },
  // team 1 — mirrored across y=x (river reflection) and center
  { id: 't1_top1', team: 1, lane: 'TOP', tier: 1, x: 2950, y: 620 },
  { id: 't1_top2', team: 1, lane: 'TOP', tier: 2, x: 4200, y: 620 },
  { id: 't1_mid1', team: 1, lane: 'MID', tier: 1, x: 3660, y: 2740 },
  { id: 't1_mid2', team: 1, lane: 'MID', tier: 2, x: 4440, y: 1960 },
  { id: 't1_bot1', team: 1, lane: 'BOT', tier: 1, x: 5780, y: 3450 },
  { id: 't1_bot2', team: 1, lane: 'BOT', tier: 2, x: 5780, y: 2200 },
  { id: 't1_basA', team: 1, lane: 'BASE', tier: 3, x: 4680, y: 1780 },
  { id: 't1_basB', team: 1, lane: 'BASE', tier: 3, x: 5720, y: 1640 },
  { id: 't1_basC', team: 1, lane: 'BASE', tier: 3, x: 4680, y: 600 },
];

// ---------- jungle camps (all) ----------
export const CAMPS = [
  { id: 'c0_ember', team: 0, kind: 'ember', x: 1560, y: 3300, r: 300 },
  { id: 'c0_hound', team: 0, kind: 'hound', x: 2560, y: 3820, r: 280, count: 2 },
  { id: 'c0_azure', team: 0, kind: 'azure', x: 3300, y: 4840, r: 300 },
  { id: 'c0_sprite', team: 0, kind: 'sprite', x: 1260, y: 4360, r: 280, count: 2 },
  { id: 'c1_ember', team: 1, kind: 'ember', x: 4840, y: 3300, r: 300 },
  { id: 'c1_hound', team: 1, kind: 'hound', x: 3840, y: 2560, r: 280, count: 2 },
  { id: 'c1_azure', team: 1, kind: 'azure', x: 4840 - 1740, y: 1560, r: 300 }, // (3100,1560)
  { id: 'c1_sprite', team: 1, kind: 'sprite', x: 2040, y: 1560, r: 280, count: 2 },
  // river wisps
  { id: 'wisp_a', team: -1, kind: 'wisp', x: 2450, y: 2450, r: 240 },
  { id: 'wisp_b', team: -1, kind: 'wisp', x: 3950, y: 3950, r: 240 },
];

export const OBJECTIVES = {
  shell: { id: 'shell', name: 'Ancient Shell', x: 1420, y: 1420, r: 330, pit: 620 },
  colossus: { id: 'colossus', name: 'War Colossus', x: 4980, y: 4980, r: 340, pit: 640 },
};

// ---------- assemble ----------
const border = 40;
const walls = [
  // map borders
  { x: 0, y: 0, w: W, h: border }, { x: 0, y: W - border, w: W, h: border },
  { x: 0, y: 0, w: border, h: W }, { x: W - border, y: 0, w: border, h: W },
  ...baseWalls('bl'), ...baseWalls('tr'),
  ...qWalls, ...q2Walls, ...q3Walls, ...q4Walls,
  ...pitWalls(OBJECTIVES.shell.x, OBJECTIVES.shell.y, OBJECTIVES.shell.pit),
  ...pitWalls(OBJECTIVES.colossus.x, OBJECTIVES.colossus.y, OBJECTIVES.colossus.pit),
];
const bushes = [
  ...qBushes, ...q2Bushes, ...q3Bushes, ...q4Bushes,
  rectYX(qBushRiver), rectR180(rectYX(qBushRiver)),
  // mid-river flank bushes near center
  { x: 2620, y: 3560, w: 220, h: 180 }, { x: 3560, y: 2620, w: 180, h: 220 },
  // base-mouth bushes
  { x: 2620, y: 4300, w: 220, h: 170 }, { x: 4300, y: 2620, w: 170, h: 220 },
  { x: 1060, y: 2160, w: 200, h: 160 }, { x: 2160, y: 1060, w: 160, h: 200 },
  { x: 5040, y: 4040, w: 200, h: 160 }, { x: 4040, y: 5040, w: 160, h: 200 },
];

export const MAP = {
  name: 'The Sundered Vale',
  size: W,
  walls,
  bushes: bushes.map((b, i) => ({ id: 'b' + i, ...b })),
  lanes: LANES,
  fountain: FOUNTAIN,
  core: CORE,
  turrets: TURRETS,
  camps: CAMPS,
  objectives: OBJECTIVES,
};

// ---------- helpers ----------
export function laneIdNear(x, y, maxDist = 720) {
  let best = null, bd = maxDist * maxDist;
  for (const id of ['TOP', 'MID', 'BOT']) {
    const pts = LANES[id];
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
      const abx = bx - ax, aby = by - ay;
      const l2 = abx * abx + aby * aby;
      let t = ((x - ax) * abx + (y - ay) * aby) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const dx = ax + abx * t - x, dy = ay + aby * t - y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; best = id; }
    }
  }
  return best;
}

export function inBaseOf(x, y, team) {
  return team === 0 ? (x < 1940 && y > 4460 - 60) : (x > W - 1940 && y < W - 4460 + 60);
}

export function bushAt(x, y) {
  const bs = MAP.bushes;
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

// Does the segment cross any wall? (used by projectiles, vision lines, nav smoothing)
export function segHitsWall(ax, ay, bx, by, wallsArr = MAP.walls) {
  for (let i = 0; i < wallsArr.length; i++) {
    const w = wallsArr[i];
    if (segAabbHit(ax, ay, bx, by, w.x, w.y, w.w, w.h)) return w;
  }
  return null;
}
