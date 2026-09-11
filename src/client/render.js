// LEGEND ARENA — canvas renderer. Draws snapshot-shaped view data (net-seam safe),
// interpolates between snapshots, caches terrain to an offscreen layer, pools FX.
// No per-frame gradients on entity paths, no shadowBlur in hot loops (mobile perf).
import { MAP } from '../shared/map/MapData.js';
import { HEROES } from '../shared/heroes/HeroRegistry.js';
import { ITEMS } from '../shared/systems/Items.js';
import { CONFIG } from '../shared/core/config.js';

const W = CONFIG.WORLD;
const TEAMCOL = { 0: '#3f8cff', 1: '#ff4d5e' };
const TEAMCOL_D = { 0: '#1c4488', 1: '#7c1f2c' };

// ---------- procedural icon painters (cached) ----------
const iconCache = new Map();
function abilityGlyphKind(heroId, slot) {
  const d = HEROES[heroId]; if (!d) return 'star';
  const ab = d.abilities && d.abilities[slot]; if (!ab) return 'star';
  const txt = `${ab.name} ${ab.desc}`.toLowerCase();
  if (txt.includes('blink') || txt.includes('teleport')) return 'flash';
  if (txt.includes('dash') || txt.includes('charge') || txt.includes('lunge') || txt.includes('leap') || txt.includes('surge forward') || txt.includes('forward')) return 'dash';
  if (txt.includes('shield') || txt.includes('barrier')) return 'shield';
  if (txt.includes('heal') || txt.includes('restore') || txt.includes('regenerat')) return 'heal';
  if (txt.includes('summon') || txt.includes('totem') || txt.includes('sentry')) return 'summon';
  if (txt.includes('nova') || txt.includes('radius') || txt.includes('around') || txt.includes('area') || txt.includes('erupt') || txt.includes('slam')) return 'burst';
  if (txt.includes('chain') || txt.includes('bolt') || txt.includes('bolt')) return 'bolt';
  if (ab.aim === 'dir') return 'proj';
  return 'star';
}
export function makeAbilityIcon(heroId, slot, size = 64) {
  const key = `ab:${heroId}:${slot}:${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const d = HEROES[heroId] || {};
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  // backdrop
  const grad = g.createRadialGradient(r * 0.7, r * 0.7, r * 0.15, r, r, r);
  grad.addColorStop(0, d.c1 || '#5a7cae'); grad.addColorStop(1, shade(d.c1 || '#5a7cae', -0.62));
  g.fillStyle = grad; g.beginPath(); g.arc(r, r, r - 2, 0, Math.PI * 2); g.fill();
  g.lineWidth = size * 0.055; g.strokeStyle = 'rgba(230,240,255,0.85)'; g.stroke();
  const kind = slot === 'basic' ? 'sword' : abilityGlyphKind(heroId, slot);
  drawGlyph(g, kind, r, r, size * 0.62, d.c2 || '#ffe9ad');
  iconCache.set(key, c);
  return c;
}
export function makeSpellIcon(spellKey, size = 64) {
  const key = `sp:${spellKey}:${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const r = size / 2;
  const grad = g.createRadialGradient(r * 0.7, r * 0.7, r * 0.15, r, r, r);
  grad.addColorStop(0, '#4d8aff'); grad.addColorStop(1, '#182c54');
  g.fillStyle = grad; g.beginPath(); g.arc(r, r, r - 2, 0, Math.PI * 2); g.fill();
  g.lineWidth = size * 0.055; g.strokeStyle = 'rgba(230,240,255,0.8)'; g.stroke();
  const glyphs = { flicker: 'flash', sprint: 'dash', vitality: 'heal', purify: 'shield', hunt: 'fang' };
  drawGlyph(g, glyphs[spellKey] || 'star', r, r, size * 0.6, '#ffe9ad');
  iconCache.set(key, c);
  return c;
}
export function makeItemIcon(itemId, size = 52) {
  const key = `it:${itemId}:${size}`;
  if (iconCache.has(key)) return iconCache.get(key);
  const it = ITEMS[itemId] || {};
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const catCol = { attack: '#ff7a5a', magic: '#7ab0ff', defense: '#7ee0a0', move: '#e0d08a', jungle: '#c0ff70', roam: '#d9a0ff' }[it.cat] || '#cccccc';
  const r = size / 2;
  g.fillStyle = 'rgba(10,18,32,0.9)'; g.beginPath(); g.arc(r, r, r - 1, 0, Math.PI * 2); g.fill();
  g.strokeStyle = catCol; g.lineWidth = 2; g.stroke();
  const kind = { attack: 'sword', magic: 'orb', defense: 'shield', move: 'boot', jungle: 'fang', roam: 'banner' }[it.cat] || 'orb';
  drawGlyph(g, kind, r, r, size * 0.6, catCol);
  // tier pips for final items with build path
  if (it.from && it.from.length) { g.fillStyle = '#ffe9ad'; g.beginPath(); g.arc(size - 7, 7, 3, 0, Math.PI * 2); g.fill(); }
  iconCache.set(key, c);
  return c;
}
function drawGlyph(g, kind, x, y, s, col) {
  g.save(); g.translate(x, y); g.scale(s / 40, s / 40);
  g.strokeStyle = col; g.fillStyle = col; g.lineWidth = 3.4; g.lineCap = 'round'; g.lineJoin = 'round';
  switch (kind) {
    case 'sword':
      g.beginPath(); g.moveTo(-10, 12); g.lineTo(8, -6); g.stroke();
      g.beginPath(); g.moveTo(4, -12); g.lineTo(12, -4); g.lineTo(6, 2); g.lineTo(-2, -6); g.closePath(); g.fill();
      g.beginPath(); g.moveTo(-14, 6); g.lineTo(-6, 14); g.stroke();
      g.beginPath(); g.moveTo(-13, 9); g.lineTo(-9, 13); g.stroke();
      break;
    case 'dash':
      g.beginPath(); g.moveTo(-14, 0); g.lineTo(8, 0); g.stroke();
      g.beginPath(); g.moveTo(4, -9); g.lineTo(14, 0); g.lineTo(4, 9); g.closePath(); g.fill();
      g.globalAlpha = 0.55; g.beginPath(); g.moveTo(-18, -6); g.lineTo(-10, -6); g.moveTo(-18, 6); g.lineTo(-10, 6); g.stroke(); g.globalAlpha = 1;
      break;
    case 'flash':
      g.beginPath(); g.moveTo(2, -16); g.lineTo(-8, 2); g.lineTo(-1, 2); g.lineTo(-3, 16); g.lineTo(9, -3); g.lineTo(2, -3); g.closePath(); g.fill();
      break;
    case 'shield':
      g.beginPath(); g.moveTo(0, -14); g.lineTo(11, -9); g.lineTo(11, 2);
      g.quadraticCurveTo(11, 11, 0, 15); g.quadraticCurveTo(-11, 11, -11, 2); g.lineTo(-11, -9); g.closePath(); g.fill();
      break;
    case 'heal':
      g.fillRect(-4, -13, 8, 26); g.fillRect(-13, -4, 26, 8);
      break;
    case 'burst':
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; g.beginPath(); g.moveTo(Math.cos(a) * 6, Math.sin(a) * 6); g.lineTo(Math.cos(a) * 15, Math.sin(a) * 15); g.stroke(); }
      g.beginPath(); g.arc(0, 0, 4.5, 0, Math.PI * 2); g.fill();
      break;
    case 'bolt':
      g.beginPath(); g.moveTo(-12, -12); g.lineTo(4, -4); g.lineTo(-2, 2); g.lineTo(12, 12); g.stroke();
      break;
    case 'proj':
      g.beginPath(); g.arc(6, 6, 5, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.6; g.beginPath(); g.moveTo(2, 2); g.quadraticCurveTo(-8, -2, -14, -12); g.quadraticCurveTo(-4, -8, 2, 2); g.fill(); g.globalAlpha = 1;
      break;
    case 'summon':
      g.beginPath(); g.arc(0, 4, 7, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(-8, -6, 4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(0, -9, 4, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(8, -6, 4, 0, Math.PI * 2); g.fill();
      break;
    case 'fang':
      g.beginPath(); g.moveTo(-10, -12); g.quadraticCurveTo(0, 2, 0, 14); g.quadraticCurveTo(0, 2, 10, -12); g.quadraticCurveTo(0, -4, -10, -12); g.fill();
      break;
    case 'orb':
      g.beginPath(); g.arc(0, 0, 11, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.arc(-4, -4, 3.4, 0, Math.PI * 2); g.fill();
      break;
    case 'boot':
      g.beginPath(); g.moveTo(-8, -13); g.lineTo(-2, -13); g.lineTo(-2, 2); g.lineTo(10, 6); g.lineTo(10, 12); g.lineTo(-8, 12); g.closePath(); g.fill();
      break;
    case 'banner':
      g.beginPath(); g.moveTo(-9, -14); g.lineTo(-9, 14); g.stroke();
      g.beginPath(); g.moveTo(-9, -12); g.lineTo(12, -8); g.lineTo(-9, -1); g.closePath(); g.fill();
      break;
    default: // star
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + i / 5 * Math.PI * 2, a2 = a + Math.PI / 5;
        g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a) * 14, Math.sin(a) * 14); g.lineTo(Math.cos(a2) * 6, Math.sin(a2) * 6); g.closePath(); g.fill();
      }
  }
  g.restore();
}

export function drawPortrait(g, heroId, x, y, r) {
  const d = HEROES[heroId] || {};
  const c1 = d.c1 || '#888';
  const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
  grad.addColorStop(0, c1); grad.addColorStop(1, shade(c1, -0.55));
  g.fillStyle = grad;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#0a1420'; g.lineWidth = Math.max(1.5, r * 0.08); g.stroke();
  g.fillStyle = d.c2 || '#ccc'; g.globalAlpha = 0.9;
  g.font = `900 ${Math.round(r * 1.05)}px sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText((d.n || heroId || '?')[0], x, y + r * 0.05);
  g.globalAlpha = 1;
}
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r + 255 * amt)));
  gg = Math.max(0, Math.min(255, Math.round(gg + 255 * amt)));
  b = Math.max(0, Math.min(255, Math.round(b + 255 * amt)));
  return `rgb(${r},${gg},${b})`;
}

export class Renderer {
  constructor(canvas, minimap) {
    this.cv = canvas; this.g = canvas.getContext('2d');
    this.mm = minimap; this.mg = minimap.getContext('2d');
    this.cam = { x: W / 2, y: W / 2 };
    this.userZoom = 1;
    this.peek = null;             // {x, y, until}
    this.prev = null; this.cur = null; this.alpha = 0;
    this.me = null;
    this.particles = [];
    this.texts = [];
    this.pings = [];
    this.shake = 0;
    this.time = 0;
    this.showHitboxes = false;
    this.aim = null;              // {x,y,range,radius} drag-aim
    this.aimHold = null;          // {slot} hold-on-button preview
    this.attackRangeUntil = 0;    // basic-attack range ring
    this.terrain = null;
    this.buildTerrain();
  }

  // ---------- terrain cache (full map art rework) ----------
  buildTerrain() {
    const S = 2048, k = S / W;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    const rnd = (() => { let z = 1234567; return () => (z = (z * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
    // base grass with tonal patches
    g.fillStyle = '#16301e'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * S, y = rnd() * S, rr = 40 + rnd() * 160;
      g.fillStyle = ['#183421', '#142c1c', '#1a3826', '#122818'][i % 4];
      g.globalAlpha = 0.5;
      g.beginPath(); g.ellipse(x, y, rr, rr * 0.6, rnd() * 3, 0, Math.PI * 2); g.fill();
    }
    g.globalAlpha = 1;
    // subtle mottling
    for (let i = 0; i < 900; i++) {
      g.fillStyle = rnd() > 0.5 ? 'rgba(30,60,40,0.25)' : 'rgba(12,24,16,0.25)';
      g.fillRect(rnd() * S, rnd() * S, 6 + rnd() * 18, 4 + rnd() * 10);
    }
    // ---- river (organic curve along the anti-diagonal) ----
    const river = (width, col, alpha) => {
      g.strokeStyle = col; g.globalAlpha = alpha; g.lineWidth = width; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(S * 1.02, S * -0.02);
      g.bezierCurveTo(S * 0.72, S * 0.22, S * 0.6, S * 0.42, S * 0.5, S * 0.5);
      g.bezierCurveTo(S * 0.4, S * 0.58, S * 0.26, S * 0.8, S * -0.02, S * 1.02);
      g.stroke(); g.globalAlpha = 1;
    };
    river(150 * k * 2.4, '#27506b', 0.9);   // bank
    river(110 * k * 2.4, '#2f6a8c', 0.95);  // water
    river(60 * k * 2.4, '#3f83a8', 0.7);    // highlight
    // river sparkles
    for (let i = 0; i < 70; i++) {
      const t = rnd(); const bx = S * (1 - t), by = S * t;
      const x = bx + (rnd() - 0.5) * 90 * k * 2, y = by + (rnd() - 0.5) * 90 * k * 2;
      g.fillStyle = 'rgba(180,220,240,0.18)'; g.fillRect(x, y, 10 + rnd() * 20, 3);
    }
    // ---- lanes: dirt with wear + center line ----
    for (const lane of ['TOP', 'MID', 'BOT']) {
      const pts = MAP.lanes[lane];
      const trace = () => { g.beginPath(); pts.forEach(([x, y], i) => i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k)); };
      g.lineCap = 'round'; g.lineJoin = 'round';
      trace(); g.strokeStyle = '#4a3f28'; g.lineWidth = 130 * k; g.stroke();
      trace(); g.strokeStyle = '#5c4f33'; g.lineWidth = 100 * k; g.stroke();
      trace(); g.strokeStyle = '#6b5c3c'; g.lineWidth = 66 * k; g.stroke();
      // wear specks
      for (let i = 0; i < pts.length - 1; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        for (let j = 0; j < 14; j++) {
          const t = rnd(); const x = (x1 + (x2 - x1) * t) * k + (rnd() - 0.5) * 60 * k, y = (y1 + (y2 - y1) * t) * k + (rnd() - 0.5) * 60 * k;
          g.fillStyle = rnd() > 0.5 ? 'rgba(90,76,48,0.5)' : 'rgba(52,44,28,0.5)';
          g.fillRect(x, y, 5 + rnd() * 12, 4 + rnd() * 8);
        }
      }
    }
    // ---- objective pits ----
    for (const o of [MAP.objectives.shell, MAP.objectives.colossus]) {
      g.fillStyle = 'rgba(18,28,44,0.85)'; g.beginPath(); g.arc(o.x * k, o.y * k, 360 * k, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(140,160,200,0.25)'; g.lineWidth = 6; g.stroke();
      for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2; g.fillStyle = 'rgba(70,88,116,0.5)'; g.beginPath(); g.arc(o.x * k + Math.cos(a) * 330 * k, o.y * k + Math.sin(a) * 330 * k, 16 * k, 0, Math.PI * 2); g.fill(); }
    }
    // ---- camps: ground markings ----
    for (const cp of MAP.camps) {
      g.strokeStyle = 'rgba(120,140,110,0.28)'; g.lineWidth = 4;
      g.beginPath(); g.arc(cp.x * k, cp.y * k, cp.r * k, 0, Math.PI * 2); g.setLineDash([14, 12]); g.stroke(); g.setLineDash([]);
    }
    // ---- base platforms + fountains ----
    for (const team of [0, 1]) {
      const [fx, fy] = MAP.fountain[team];
      const [cx, cy] = MAP.core[team];
      const col = TEAMCOL[team], colD = TEAMCOL_D[team];
      // platform
      g.fillStyle = colD; g.globalAlpha = 0.35;
      g.beginPath(); g.arc(cx * k, cy * k, 700 * k, 0, Math.PI * 2); g.fill(); g.globalAlpha = 1;
      g.strokeStyle = col; g.globalAlpha = 0.5; g.lineWidth = 8;
      g.beginPath(); g.arc(cx * k, cy * k, 700 * k, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
      // fountain disc
      g.fillStyle = 'rgba(40,70,120,0.5)'; g.beginPath(); g.arc(fx * k, fy * k, 330 * k, 0, Math.PI * 2); g.fill();
      g.strokeStyle = col; g.lineWidth = 6; g.globalAlpha = 0.8;
      g.beginPath(); g.arc(fx * k, fy * k, 330 * k, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
      g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 2;
      g.beginPath(); g.arc(fx * k, fy * k, 220 * k, 0, Math.PI * 2); g.stroke();
    }
    // ---- walls as rock ridges (body + top highlight + rim) ----
    for (const w of MAP.walls) {
      const x = w.x * k, y = w.y * k, ww = w.w * k, hh = w.h * k;
      g.fillStyle = '#0b150c';
      g.fillRect(x + 3 * k, y + 5 * k, ww, hh); // drop
      g.fillStyle = '#1e3322';
      g.fillRect(x, y, ww, hh);
      g.fillStyle = '#2c4830';
      g.fillRect(x, y, ww, Math.min(7 * k, hh * 0.4)); // top face
      g.strokeStyle = 'rgba(90,130,90,0.35)'; g.lineWidth = 2;
      g.strokeRect(x, y, ww, hh);
      // rock speckle
      for (let i = 0; i < Math.max(2, (ww * hh) / (5200 * k * k)); i++) {
        g.fillStyle = rnd() > 0.5 ? 'rgba(60,92,62,0.5)' : 'rgba(16,28,18,0.6)';
        g.fillRect(x + rnd() * ww, y + rnd() * hh, 4 + rnd() * 7, 3 + rnd() * 5);
      }
    }
    // ---- decorative rocks (jungle props) ----
    for (let i = 0; i < 90; i++) {
      const x = 260 * k + rnd() * (S - 520 * k), y = 260 * k + rnd() * (S - 520 * k);
      // skip if near lanes / bases / pits
      let ok = true;
      for (const lane of ['TOP', 'MID', 'BOT']) for (const [lx, ly] of MAP.lanes[lane]) if (Math.hypot(lx * k - x, ly * k - y) < 260 * k) ok = false;
      for (const [bx, by] of [...MAP.core, ...MAP.fountain]) if (Math.hypot(bx * k - x, by * k - y) < 900 * k) ok = false;
      for (const o of [MAP.objectives.shell, MAP.objectives.colossus]) if (Math.hypot(o.x * k - x, o.y * k - y) < 500 * k) ok = false;
      for (const w of MAP.walls) if (x > w.x * k - 40 && x < (w.x + w.w) * k + 40 && y > w.y * k - 40 && y < (w.y + w.h) * k + 40) ok = false;
      if (!ok) continue;
      const rr = 14 + rnd() * 34;
      g.fillStyle = 'rgba(10,18,12,0.5)';
      g.beginPath(); g.ellipse(x, y + rr * 0.4, rr * 1.2, rr * 0.5, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = ['#3a4c3e', '#44584a', '#31413a'][i % 3];
      polyPath(g, x, y, rr, 5 + (i % 3), rnd() * 3); g.fill();
      g.fillStyle = 'rgba(255,255,255,0.10)';
      polyPath(g, x - rr * 0.15, y - rr * 0.25, rr * 0.6, 5, 0); g.fill();
    }
    // ---- map boundary: dark border + hazard trim + glow line ----
    const B = 44 * k;
    g.fillStyle = '#05080d';
    g.fillRect(0, 0, S, B); g.fillRect(0, S - B, S, B); g.fillRect(0, 0, B, S); g.fillRect(S - B, 0, B, S);
    g.strokeStyle = 'rgba(232,178,61,0.5)'; g.lineWidth = 5;
    g.strokeRect(B, B, S - 2 * B, S - 2 * B);
    g.strokeStyle = 'rgba(232,178,61,0.16)'; g.lineWidth = 22;
    g.strokeRect(B + 14, B + 14, S - 2 * (B + 14), S - 2 * (B + 14));
    // corner plates
    for (const [cx2, cy2] of [[B, B], [S - B, B], [B, S - B], [S - B, S - B]]) {
      g.fillStyle = 'rgba(232,178,61,0.75)';
      polyPath(g, cx2, cy2, 26, 4, Math.PI / 4); g.fill();
    }
    this.terrain = c;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.cv.clientWidth || window.innerWidth, h = this.cv.clientHeight || window.innerHeight;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.vw = w; this.vh = h;
  }
  get zoom() { return Math.max(0.4, Math.min(1.15, Math.min(this.vw, this.vh) / 1000)) * this.userZoom; }

  setSnapshots(view) { this.prev = view.prev; this.cur = view.cur; this.alpha = view.alpha; }

  worldToScreen(x, y) { const z = this.zoom; return [(x - this.cam.x) * z + this.vw / 2, (y - this.cam.y) * z + this.vh / 2]; }
  screenToWorld(sx, sy) { const z = this.zoom; return [(sx - this.vw / 2) / z + this.cam.x, (sy - this.vh / 2) / z + this.cam.y]; }

  lerpUnit(prevList, cur, id, fields = ['x', 'y']) {
    const p = prevList && prevList.find(u => u.i === id);
    const out = { ...cur };
    if (p) for (const f of fields) out[f] = p[f] + (cur[f] - p[f]) * this.alpha;
    return out;
  }

  applyEvents(evs) {
    for (const e of evs) {
      switch (e.type) {
        case 'dmg': {
          if (this.me && (e.srcId === this.me.id || e.tgtId === this.me.id)) {
            const big = (e.amount || 0) > 220;
            this.floatText(e.x, e.y, `${e.amount}`, e.srcId === this.me.id ? (big ? '#ffd75e' : '#ffe9a8') : '#ff7a86', big ? 26 : 17);
            if (big) this.burst(e.x, e.y, '#ffd75e', 6);
          }
          break;
        }
        case 'kill': this.burst(e.x ?? 0, e.y ?? 0, '#ff5a66', 14); this.shake = Math.max(this.shake, 5); break;
        case 'aoe': this.ring(e.x, e.y, e.r || 120, e.tm === 0 ? '#7fb2ff' : '#ff8a94'); break;
        case 'levelup': this.burst(e.x, e.y, '#ffe27a', 10); break;
        case 'blink': case 'riftBlink': this.ring(e.x, e.y, 70, '#b48aff'); break;
        case 'phoenixRevive': this.ring(e.x, e.y, 110, '#ffb14d'); this.floatText(e.x, e.y - 40, 'PHOENIX', '#ffb14d', 20); break;
        case 'turretKilled': this.burst(e.x ?? 0, e.y ?? 0, '#ffcf6a', 22); this.shake = 10; break;
        case 'coreDestroyed': this.shake = 18; break;
        case 'objectiveKill': this.burst(e.x ?? 0, e.y ?? 0, '#8ad7ff', 26); break;
        case 'objectiveSpawn': this.burst(e.x, e.y, '#ffe27a', 24); this.ring(e.x, e.y, 260, '#ffe27a'); break;
        case 'hunt': this.burst(e.x ?? 0, e.y ?? 0, '#e6ffe0', 8); break;
        case 'cast': if (e.x !== undefined) this.ring(e.x, e.y, 40, '#cfe2ff'); break;
        case 'ping': this.pings.push({ x: e.x, y: e.y, t: this.time }); break;
      }
    }
  }

  burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = 60 + Math.random() * 260;
      this.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.3, t: 0, color, r: 3 + Math.random() * 5 });
    }
  }
  ring(x, y, r, color) { this.particles.push({ ring: true, x, y, r0: r * 0.2, r1: r, life: 0.45, t: 0, color }); }
  floatText(x, y, txt, color, size) { this.texts.push({ x, y, txt, color, size, t: 0, life: 0.9 }); }

  // ---------- main draw ----------
  draw(dt) {
    this.time += dt;
    const g = this.g;
    this.resizeIf();
    const z = this.zoom;
    // camera follow self unless peeking
    const peeking = this.peek && this.time < this.peek.until;
    const me = this.meUnit();
    if (!peeking) {
      if (me) { this.cam.x += (me.x - this.cam.x) * Math.min(1, dt * 6); this.cam.y += (me.y - this.cam.y) * Math.min(1, dt * 6); }
    } else {
      this.cam.x += (this.peek.x - this.cam.x) * Math.min(1, dt * 10);
      this.cam.y += (this.peek.y - this.cam.y) * Math.min(1, dt * 10);
    }
    // clamp inside map
    const halfW = this.vw / 2 / z, halfH = this.vh / 2 / z;
    this.cam.x = Math.max(Math.min(halfW, W / 2), Math.min(this.cam.x, W - Math.min(halfW, W / 2)));
    this.cam.y = Math.max(Math.min(halfH, W / 2), Math.min(this.cam.y, W - Math.min(halfH, W / 2)));
    if (this.shake > 0) { this.cam.x += (Math.random() - 0.5) * this.shake * 6; this.cam.y += (Math.random() - 0.5) * this.shake * 6; this.shake = Math.max(0, this.shake - dt * 26); }

    g.fillStyle = '#05080d'; g.fillRect(0, 0, this.vw, this.vh);
    if (!this.cur) return;

    // terrain
    const [tx, ty] = this.worldToScreen(0, 0);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.terrain, tx, ty, W * z, W * z);

    const visSet = new Set((this.cur.vis && this.cur.vis[0]) || []);
    const viewR = 1200 / z + 400;
    const inView = (x, y) => Math.abs(x - this.cam.x) < viewR && Math.abs(y - this.cam.y) < viewR * (this.vh / this.vw + 0.4);

    // ---- range rings (own hero): attack range + held-ability range ----
    if (me) {
      if (this.time < this.attackRangeUntil || this.aimHold?.slot === 'basic') {
        const def = HEROES[me.hi];
        const rng = (def && def.range || 300) * 1.0;
        this.dashedCircle(me.x, me.y, rng, 'rgba(232,178,61,0.5)');
      }
      if (this.aimHold && this.aimHold.slot !== 'basic') {
        this.dashedCircle(me.x, me.y, this.aimHold.range, 'rgba(232,178,61,0.65)');
      }
    }

    // areas under units
    for (const a of this.cur.areas || []) {
      if (!inView(a.x, a.y)) continue;
      const [ax, ay] = this.worldToScreen(a.x, a.y);
      const r = (a.r || 60) * z;
      g.globalAlpha = Math.min(0.4, 0.12 + (a.u || 1) * 0.1);
      g.fillStyle = a.tm === 0 ? 'rgba(90,150,255,0.5)' : 'rgba(255,110,120,0.5)';
      if (a.v === 'wall') g.fillStyle = 'rgba(200,160,255,0.55)';
      if (a.v === 'trap') g.fillStyle = 'rgba(120,255,170,0.4)';
      g.beginPath(); g.arc(ax, ay, r, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.7; g.strokeStyle = g.fillStyle; g.lineWidth = 2;
      g.beginPath(); g.arc(ax, ay, r, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }

    // ---- structures ----
    for (const s of this.cur.structs || []) {
      const def = structDefById(s.i);
      if (!def) continue;
      if (!inView(def.x, def.y)) continue;
      if (def.kind === 'core') this.drawCore(s, def, z);
      else this.drawTurret(s, def, z);
    }

    // ---- objectives (turtle / lord) with spawn countdowns ----
    for (const key of ['shell', 'colossus']) {
      const o = MAP.objectives[key];
      const state = this.cur.obj ? this.cur.obj[key] : 0;
      const alive = state === 1;
      if (!alive && state > 0 && inView(o.x, o.y)) {
        // spawn countdown at the pit
        const [sx, sy] = this.worldToScreen(o.x, o.y);
        const label = (key === 'shell' ? 'TURTLE' : 'LORD') + ' ' + Math.ceil(state) + 's';
        g.globalAlpha = 0.75 + Math.sin(this.time * 3) * 0.15;
        g.fillStyle = 'rgba(10,16,28,0.85)';
        g.beginPath(); g.arc(sx, sy, 46 * z, 0, Math.PI * 2); g.fill();
        g.strokeStyle = '#e8b23d'; g.lineWidth = 3; g.stroke();
        label2(g, label, sx, sy, '#e8b23d', Math.max(11, 15 * z));
        g.globalAlpha = 1;
      }
    }
    for (const m of this.cur.monsters || []) {
      const isObj = m.obj || m.k === 'shell' || m.k === 'colossus';
      if (!isObj && !visSet.has(m.i)) continue;
      if (!inView(m.x, m.y)) continue;
      const u = this.lerpUnit(this.prev?.monsters, m, m.i);
      this.drawMonster(u, z, isObj);
    }

    // ---- minions (detailed) ----
    for (const m of this.cur.minions || []) {
      if (!inView(m.x, m.y)) continue;
      const u = this.lerpUnit(this.prev?.minions, m, m.i);
      this.drawMinion(u, z);
    }

    // summons
    for (const s of this.cur.summons || []) {
      if (!inView(s.x, s.y)) continue;
      const [sx, sy] = this.worldToScreen(s.x, s.y);
      g.fillStyle = TEAMCOL[s.tm] || '#b48aff';
      polyPath(g, sx, sy, 11 * z, 4, this.time); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1.5; g.stroke();
    }

    // colossus pets
    for (const c of this.cur.cols || []) {
      const u = this.lerpUnit(this.prev?.cols, c, c.i);
      if (!inView(u.x, u.y)) continue;
      const [sx, sy] = this.worldToScreen(u.x, u.y);
      const r = 46 * z;
      g.fillStyle = shade(TEAMCOL[u.tm], -0.2);
      polyPath(g, sx, sy, r, 6, Math.PI / 6); g.fill();
      g.strokeStyle = TEAMCOL[u.tm]; g.lineWidth = 3; g.stroke();
      barWithBorder(g, sx, sy - r - 12, r * 2, 7, u.hp / u.mhp, TEAMCOL[u.tm]);
    }

    // projectiles
    for (const p of this.cur.projs || []) {
      if (!inView(p.x, p.y)) continue;
      const u = this.lerpUnit(this.prev?.projs, p, p.i);
      const [sx, sy] = this.worldToScreen(u.x, u.y);
      g.fillStyle = p.c || '#fff';
      g.beginPath(); g.arc(sx, sy, Math.max(2.5, (p.s || 8) * z * 0.6), 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.35;
      g.beginPath(); g.arc(sx, sy, Math.max(4, (p.s || 8) * z), 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }

    // heroes
    for (const h of this.cur.heroes || []) {
      const isEnemy = h.tm !== 0;
      if (isEnemy && !visSet.has(h.i)) continue;
      if (!inView(h.x, h.y)) continue;
      const u = this.lerpUnit(this.prev?.heroes, h, h.i);
      this.drawHero(u, h, visSet, z);
    }

    // ---- bushes drawn OVER units: concealment feel ----
    for (const b of MAP.bushes) {
      if (!inView(b.x + b.w / 2, b.y + b.h / 2)) continue;
      const [bx, by] = this.worldToScreen(b.x, b.y);
      const me = this.meUnit();
      const meInside = me && me.x >= b.x && me.x <= b.x + b.w && me.y >= b.y && me.y <= b.y + b.h;
      g.globalAlpha = meInside ? 0.72 : 0.9;
      // leaf clusters
      const cols = ['#2f6b34', '#3a7d3f', '#27582c'];
      const rnd = (() => { let z2 = b.x * 31 + b.y * 17; return () => (z2 = (z2 * 16807) % 2147483647) / 2147483647; })();
      const n = Math.max(3, Math.round(b.w * b.h / 26000));
      for (let i = 0; i < n; i++) {
        const px = bx + (0.12 + rnd() * 0.76) * b.w * z, py = by + (0.12 + rnd() * 0.76) * b.h * z;
        const rr = (16 + rnd() * 22) * z;
        g.fillStyle = cols[i % 3];
        g.beginPath(); g.arc(px, py, rr, 0, Math.PI * 2); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.07)';
        g.beginPath(); g.arc(px - rr * 0.3, py - rr * 0.3, rr * 0.5, 0, Math.PI * 2); g.fill();
      }
      if (meInside) { g.strokeStyle = 'rgba(232,178,61,0.6)'; g.lineWidth = 2; roundRectPath(g, bx, by, b.w * z, b.h * z, 10 * z); g.stroke(); }
      g.globalAlpha = 1;
    }

    // particles / texts
    this.drawParticles(dt, g);
    this.drawTexts(dt, g);

    // ---- aim indicator (drag) ----
    if (this.aim && me) {
      const [mx, my] = this.worldToScreen(me.x, me.y);
      const len = Math.hypot(this.aim.x - me.x, this.aim.y - me.y);
      const ang = Math.atan2(this.aim.y - me.y, this.aim.x - me.x);
      const range = (this.aim.range || 600) * z;
      g.strokeStyle = 'rgba(232,178,61,0.85)'; g.lineWidth = 3;
      g.setLineDash([10, 8]);
      g.beginPath(); g.moveTo(mx, my);
      const ex = mx + Math.cos(ang) * Math.min(range, len * z), ey = my + Math.sin(ang) * Math.min(range, len * z);
      g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
      g.beginPath(); g.arc(ex, ey, 9, 0, Math.PI * 2); g.stroke();
      if (this.aim.radius) { g.globalAlpha = 0.25; g.beginPath(); g.arc(ex, ey, this.aim.radius * z, 0, Math.PI * 2); g.fillStyle = '#e8b23d'; g.fill(); g.globalAlpha = 1; }
    }
    // ---- hold-on-button: preview radius at max range (MLBB style) ----
    if (this.aimHold && this.aimHold.slot !== 'basic' && me) {
      const ang = (me.a || 0);
      const [mx, my] = this.worldToScreen(me.x, me.y);
      const ex = mx + Math.cos(ang) * this.aimHold.range * z, ey = my + Math.sin(ang) * this.aimHold.range * z;
      g.globalAlpha = 0.22;
      g.fillStyle = '#e8b23d';
      g.beginPath(); g.arc(ex, ey, (this.aimHold.radius || 130) * z, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.8; g.strokeStyle = '#e8b23d'; g.lineWidth = 2; g.stroke();
      g.globalAlpha = 1;
    }

    // hitbox viz (DEV)
    if (this.showHitboxes) {
      g.strokeStyle = 'rgba(255,80,255,0.8)'; g.lineWidth = 1;
      for (const h of this.cur.heroes || []) { if (!visSet.has(h.i) && h.tm !== 0) continue; const [sx, sy] = this.worldToScreen(h.x, h.y); g.strokeRect(sx - 26 * z, sy - 26 * z, 52 * z, 52 * z); }
    }

    // vignette
    const vg = g.createRadialGradient(this.vw / 2, this.vh / 2, Math.min(this.vw, this.vh) * 0.42, this.vw / 2, this.vh / 2, Math.max(this.vw, this.vh) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(2,6,12,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, this.vw, this.vh);

    this.drawMinimap(visSet);
  }

  dashedCircle(wx, wy, rWorld, style) {
    const g = this.g, z = this.zoom;
    const [sx, sy] = this.worldToScreen(wx, wy);
    g.strokeStyle = style; g.lineWidth = 2.5;
    g.setLineDash([12, 9]);
    g.beginPath(); g.arc(sx, sy, rWorld * z, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 0.08; g.fillStyle = '#e8b23d';
    g.beginPath(); g.arc(sx, sy, rWorld * z, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  }

  // ---------- structure art ----------
  drawTurret(s, def, z) {
    const g = this.g;
    const [sx, sy] = this.worldToScreen(def.x, def.y);
    const col = TEAMCOL[def.team], colD = TEAMCOL_D[def.team];
    const R = 40 * z;
    if (s.d) {
      // rubble
      g.fillStyle = '#232a33';
      polyPath(g, sx, sy, R * 0.8, 6, 0.4); g.fill();
      g.fillStyle = '#161c24';
      polyPath(g, sx + R * 0.2, sy + R * 0.15, R * 0.4, 5, 1.2); g.fill();
      return;
    }
    // ground shadow
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.beginPath(); g.ellipse(sx, sy + R * 0.5, R * 1.25, R * 0.5, 0, 0, Math.PI * 2); g.fill();
    // stone platform (octagon)
    g.fillStyle = '#3a4353';
    polyPath(g, sx, sy, R * 1.35, 8, Math.PI / 8); g.fill();
    g.strokeStyle = '#20293a'; g.lineWidth = 3; g.stroke();
    // tower body (tapered)
    g.fillStyle = '#556179';
    g.beginPath();
    g.moveTo(sx - R * 0.62, sy + R * 0.55);
    g.lineTo(sx - R * 0.42, sy - R * 0.75);
    g.lineTo(sx + R * 0.42, sy - R * 0.75);
    g.lineTo(sx + R * 0.62, sy + R * 0.55);
    g.closePath(); g.fill();
    g.strokeStyle = '#2b3345'; g.lineWidth = 2; g.stroke();
    // stone bands
    g.strokeStyle = 'rgba(20,28,42,0.6)'; g.lineWidth = 2;
    for (const t of [0.45, 0.05, -0.35]) {
      const yy = sy + R * t;
      const wHalf = R * (0.56 + t * 0.12);
      g.beginPath(); g.moveTo(sx - wHalf, yy); g.lineTo(sx + wHalf, yy); g.stroke();
    }
    // team banner band
    g.fillStyle = col;
    g.fillRect(sx - R * 0.5, sy - R * 0.28, R, R * 0.2);
    // crenellation ring
    g.fillStyle = '#6b7791';
    for (let i = -2; i <= 2; i++) g.fillRect(sx + i * R * 0.24 - R * 0.08, sy - R * 0.95, R * 0.16, R * 0.22);
    // crystal (pulsing)
    const pulse = 1 + Math.sin(this.time * 3 + def.x) * 0.08;
    g.fillStyle = col;
    polyPath(g, sx, sy - R * 1.12, R * 0.3 * pulse, 4, Math.PI / 4); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 1.5; g.stroke();
    g.globalAlpha = 0.3;
    g.beginPath(); g.arc(sx, sy - R * 1.12, R * 0.55 * pulse, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
    // tier pips
    for (let i = 0; i < (def.tier || 1); i++) {
      g.fillStyle = '#ffe9ad';
      polyPath(g, sx - R * 0.5 + i * R * 0.34, sy + R * 0.75, R * 0.1, 4, Math.PI / 4); g.fill();
    }
    if (s.inv) {
      g.strokeStyle = 'rgba(210,230,255,0.85)'; g.lineWidth = 2.5;
      polyPath(g, sx, sy - R * 0.2, R * 1.5, 6, Math.PI / 6); g.stroke();
      g.globalAlpha = 0.12; g.fillStyle = '#cfe0ff';
      polyPath(g, sx, sy - R * 0.2, R * 1.5, 6, Math.PI / 6); g.fill();
      g.globalAlpha = 1;
    }
    barWithBorder(g, sx, sy - R * 1.7, R * 2.3, 7, s.hp / s.mhp, col);
  }

  drawCore(s, def, z) {
    const g = this.g;
    const [sx, sy] = this.worldToScreen(def.x, def.y);
    const col = TEAMCOL[def.team], colD = TEAMCOL_D[def.team];
    const R = 74 * z;
    if (s.d) {
      g.fillStyle = '#22262e';
      polyPath(g, sx, sy, R, 8, Math.PI / 8); g.fill();
      g.fillStyle = '#141821';
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; polyPath(g, sx + Math.cos(a) * R * 0.5, sy + Math.sin(a) * R * 0.5, R * 0.2, 4, a); g.fill(); }
      return;
    }
    // platform
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.beginPath(); g.ellipse(sx, sy + R * 0.4, R * 1.5, R * 0.6, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = colD; g.globalAlpha = 0.55;
    polyPath(g, sx, sy, R * 1.5, 8, Math.PI / 8); g.fill(); g.globalAlpha = 1;
    g.strokeStyle = col; g.lineWidth = 4; g.stroke();
    // rotating crystal shells
    const rot = this.time * 0.7;
    g.fillStyle = shade(col, -0.25);
    polyPath(g, sx, sy, R * 0.85, 6, rot); g.fill();
    g.strokeStyle = col; g.lineWidth = 3; g.stroke();
    g.fillStyle = shade(col, 0.3);
    polyPath(g, sx, sy, R * 0.55, 6, -rot * 1.6 + Math.PI / 6); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 2; g.stroke();
    // core heart
    const pulse = 1 + Math.sin(this.time * 4) * 0.1;
    g.fillStyle = '#ffffff';
    g.globalAlpha = 0.85;
    polyPath(g, sx, sy, R * 0.22 * pulse, 6, rot * 2); g.fill();
    g.globalAlpha = 1;
    // shield ring when invulnerable
    if (s.inv) {
      g.strokeStyle = 'rgba(210,230,255,0.8)'; g.lineWidth = 3;
      g.setLineDash([16, 10]);
      g.beginPath(); g.arc(sx, sy, R * 1.8, this.time, this.time + Math.PI * 2); g.stroke();
      g.setLineDash([]);
    }
    barWithBorder(g, sx, sy - R * 1.7, R * 2.6, 9, s.hp / s.mhp, col);
    label2(g, 'CORE', sx, sy - R * 1.7 - 10, col, Math.max(10, 13 * z));
  }

  // ---------- creature art ----------
  drawMonster(u, z, isObj) {
    const g = this.g;
    const [sx, sy] = this.worldToScreen(u.x, u.y);
    if (u.k === 'shell') { // turtle
      const R = 52 * z;
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.beginPath(); g.ellipse(sx, sy + R * 0.5, R * 1.2, R * 0.45, 0, 0, Math.PI * 2); g.fill();
      // head + flippers
      g.fillStyle = '#5d8a6a';
      g.beginPath(); g.ellipse(sx + R * 0.95, sy - R * 0.1, R * 0.32, R * 0.24, 0, 0, Math.PI * 2); g.fill();
      for (const [dx, dy] of [[-0.55, -0.75], [-0.55, 0.75], [0.45, -0.85], [0.45, 0.85]]) {
        g.beginPath(); g.ellipse(sx + R * dx, sy + R * dy, R * 0.22, R * 0.14, 0, 0, Math.PI * 2); g.fill();
      }
      // shell dome
      g.fillStyle = '#3f6b52';
      g.beginPath(); g.ellipse(sx, sy, R, R * 0.82, 0, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2b4c3a'; g.lineWidth = 3; g.stroke();
      // hex plates
      g.strokeStyle = 'rgba(220,240,220,0.28)'; g.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * Math.PI * 2;
        polyPath(g, sx + Math.cos(a) * R * 0.45, sy + Math.sin(a) * R * 0.36, R * 0.26, 6, a); g.stroke();
      }
      polyPath(g, sx, sy, R * 0.3, 6, 0.4); g.stroke();
      barWithBorder(g, sx, sy - R - 18, R * 2.6, 9, u.hp / u.mhp, '#6fae8f');
      label2(g, 'ANCIENT SHELL', sx, sy - R - 30, '#8ad7b0', Math.max(9, 12 * z));
      return;
    }
    if (u.k === 'colossus') { // lord
      const R = 60 * z;
      g.fillStyle = 'rgba(0,0,0,0.45)';
      g.beginPath(); g.ellipse(sx, sy + R * 0.6, R * 1.15, R * 0.42, 0, 0, Math.PI * 2); g.fill();
      // body
      g.fillStyle = '#6e4a38';
      polyPath(g, sx, sy - R * 0.1, R, 6, Math.PI / 6); g.fill();
      g.strokeStyle = '#40291e'; g.lineWidth = 3; g.stroke();
      // shoulder slabs
      g.fillStyle = '#8a5f47';
      for (const sgn of [-1, 1]) {
        polyPath(g, sx + sgn * R * 0.95, sy - R * 0.45, R * 0.34, 4, sgn * 0.5); g.fill();
        g.strokeStyle = '#40291e'; g.lineWidth = 2; g.stroke();
      }
      // head + glowing eye
      g.fillStyle = '#8a5f47';
      polyPath(g, sx, sy - R * 1.05, R * 0.34, 5, Math.PI / 5); g.fill();
      g.fillStyle = '#ffd75e';
      g.beginPath(); g.arc(sx, sy - R * 1.05, R * 0.1 * (1 + Math.sin(this.time * 5) * 0.2), 0, Math.PI * 2); g.fill();
      // rune chest
      g.strokeStyle = '#ffcf6a'; g.lineWidth = 2;
      polyPath(g, sx, sy + R * 0.05, R * 0.28, 3, -Math.PI / 2); g.stroke();
      barWithBorder(g, sx, sy - R * 1.7, R * 2.6, 9, u.hp / u.mhp, '#e8b23d');
      label2(g, 'WAR COLOSSUS', sx, sy - R * 1.7 - 10, '#ffd75e', Math.max(9, 12 * z));
      return;
    }
    // small camps
    const r = (u.k === 'ember' || u.k === 'azure' ? 34 : 24) * z;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(sx, sy + r * 0.6, r, r * 0.4, 0, 0, Math.PI * 2); g.fill();
    if (u.k === 'hound') {
      g.fillStyle = '#8a7364';
      polyPath(g, sx, sy, r, 5, Math.PI / 5); g.fill();
      g.fillStyle = '#6b564a';
      polyPath(g, sx - r * 0.5, sy - r * 0.8, r * 0.3, 3, 0); g.fill();
      polyPath(g, sx + r * 0.5, sy - r * 0.8, r * 0.3, 3, 0); g.fill();
      g.fillStyle = '#ffd75e'; g.beginPath(); g.arc(sx - r * 0.25, sy - r * 0.1, r * 0.1, 0, Math.PI * 2); g.arc(sx + r * 0.25, sy - r * 0.1, r * 0.1, 0, Math.PI * 2); g.fill();
    } else if (u.k === 'sprite') {
      g.fillStyle = '#8fd0a8';
      g.beginPath(); g.arc(sx, sy, r * 0.7, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.5; g.fillStyle = '#c0f0d8';
      g.beginPath(); g.ellipse(sx - r * 0.7, sy - r * 0.4, r * 0.5, r * 0.24, -0.6, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.ellipse(sx + r * 0.7, sy - r * 0.4, r * 0.5, r * 0.24, 0.6, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    } else if (u.k === 'ember') {
      g.fillStyle = '#b0512c';
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
      const fl = 1 + Math.sin(this.time * 6 + u.i) * 0.12;
      g.fillStyle = '#e8813f';
      polyPath(g, sx, sy - r * 0.4, r * 0.62 * fl, 5, -Math.PI / 2); g.fill();
      g.fillStyle = '#ffd28a';
      g.beginPath(); g.arc(sx, sy, r * 0.3, 0, Math.PI * 2); g.fill();
    } else if (u.k === 'azure') {
      g.fillStyle = '#2c5a9e';
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#5a9ae0';
      polyPath(g, sx, sy, r * 0.7, 6, this.time * 0.8); g.fill();
      g.fillStyle = '#cfe8ff';
      g.beginPath(); g.arc(sx, sy, r * 0.28, 0, Math.PI * 2); g.fill();
    } else { // wisp
      g.fillStyle = '#8ad7c0';
      g.globalAlpha = 0.85;
      g.beginPath(); g.arc(sx, sy, r * 0.6, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.3;
      g.beginPath(); g.arc(sx, sy, r * (0.9 + Math.sin(this.time * 4 + u.i) * 0.15), 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
    if (u.k === 'ember' || u.k === 'azure') barWithBorder(g, sx, sy - r - 12, r * 2, 5.5, u.hp / u.mhp, '#e8b23d');
  }

  // ---------- minion art (detailed) ----------
  drawMinion(u, z) {
    const g = this.g;
    const [sx, sy] = this.worldToScreen(u.x, u.y);
    const col = TEAMCOL[u.tm], colD = TEAMCOL_D[u.tm];
    const type = u.mt === 'm' ? 'melee' : u.mt === 'r' ? 'ranged' : 'siege';
    const R = (type === 'siege' ? 21 : type === 'ranged' ? 16 : 15) * z;
    // team shadow ring
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(sx, sy + R * 0.7, R, R * 0.4, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = colD;
    g.beginPath(); g.arc(sx, sy, R * 1.15, 0, Math.PI * 2); g.fill();
    if (type === 'melee') {
      g.fillStyle = '#9aa7bd';
      roundRectPath(g, sx - R * 0.7, sy - R * 0.7, R * 1.4, R * 1.4, R * 0.35); g.fill();
      g.strokeStyle = col; g.lineWidth = 2; g.stroke();
      // little sword
      g.strokeStyle = '#e6edf6'; g.lineWidth = 2.4;
      g.beginPath(); g.moveTo(sx + R * 0.2, sy + R * 0.3); g.lineTo(sx + R * 1.05, sy - R * 0.65); g.stroke();
    } else if (type === 'ranged') {
      g.fillStyle = '#8291ab';
      g.beginPath(); g.arc(sx, sy, R * 0.75, 0, Math.PI * 2); g.fill();
      g.strokeStyle = col; g.lineWidth = 2; g.stroke();
      // staff + orb
      g.strokeStyle = '#5a4a32'; g.lineWidth = 2.2;
      g.beginPath(); g.moveTo(sx + R * 0.3, sy + R * 0.5); g.lineTo(sx + R * 1.0, sy - R * 0.7); g.stroke();
      g.fillStyle = col; g.beginPath(); g.arc(sx + R * 1.05, sy - R * 0.78, R * 0.24, 0, Math.PI * 2); g.fill();
    } else { // siege cart
      g.fillStyle = '#6b7688';
      roundRectPath(g, sx - R, sy - R * 0.62, R * 2, R * 1.24, R * 0.24); g.fill();
      g.strokeStyle = col; g.lineWidth = 2.4; g.stroke();
      // wheels
      g.fillStyle = '#39424f';
      g.beginPath(); g.arc(sx - R * 0.5, sy + R * 0.7, R * 0.3, 0, Math.PI * 2); g.arc(sx + R * 0.5, sy + R * 0.7, R * 0.3, 0, Math.PI * 2); g.fill();
      // barrel
      g.fillStyle = '#4d5766';
      g.fillRect(sx - R * 0.16, sy - R * 1.5, R * 0.32, R * 0.95);
      g.fillStyle = col;
      g.fillRect(sx - R, sy - R * 0.16, R * 2, R * 0.2);
    }
    // facing tick
    g.fillStyle = 'rgba(255,255,255,0.65)';
    g.beginPath(); g.arc(sx, sy - R * 1.05, Math.max(1.5, 2.5 * z), 0, Math.PI * 2); g.fill();
    // always-on HP bar
    barWithBorder(g, sx, sy - R * 1.7 - 3, R * 2.1, 4.5, u.hp / u.mhp, u.tm === 0 ? '#46d05e' : '#ff4d5e');
  }

  drawHero(u, snap, visSet, z) {
    const g = this.g;
    const def = HEROES[snap.hi] || {};
    const [sx, sy] = this.worldToScreen(u.x, u.y);
    const r = 30 * z;
    const col = TEAMCOL[snap.tm];
    const isMe = this.me && snap.i === this.me.id;
    if (snap.ib) g.globalAlpha = 0.5; // hiding in bush
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(sx, sy + r * 0.75, r * 0.9, r * 0.4, 0, 0, Math.PI * 2); g.fill();
    // team ring plate
    g.fillStyle = 'rgba(10,16,26,0.6)';
    g.beginPath(); g.arc(sx, sy, r * 1.18, 0, Math.PI * 2); g.fill();
    // body
    const grad = g.createRadialGradient(sx - r * 0.3, sy - r * 0.3, r * 0.25, sx, sy, r);
    grad.addColorStop(0, def.c1 || '#9aa8bf'); grad.addColorStop(1, shade(def.c1 || '#9aa8bf', -0.5));
    g.fillStyle = grad;
    g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
    g.lineWidth = isMe ? 3.5 : 2.5;
    g.strokeStyle = col; g.stroke();
    // facing wedge
    const a = snap.a || 0;
    g.fillStyle = def.c2 || '#fff';
    g.beginPath();
    g.moveTo(sx + Math.cos(a) * r * 1.25, sy + Math.sin(a) * r * 1.25);
    g.lineTo(sx + Math.cos(a + 2.6) * r * 0.7, sy + Math.sin(a + 2.6) * r * 0.7);
    g.lineTo(sx + Math.cos(a - 2.6) * r * 0.7, sy + Math.sin(a - 2.6) * r * 0.7);
    g.closePath(); g.fill();
    // bars
    const bw = r * 2.6, bh = 7 * z + 3;
    barWithBorder(g, sx, sy - r - 16, bw, bh, snap.hp / snap.mhp, snap.tm === 0 ? '#46d05e' : '#ff4d5e');
    if (snap.mp !== undefined) {
      g.fillStyle = 'rgba(10,16,26,0.8)'; g.fillRect(sx - bw / 2 - 1, sy - r - 16 + bh + 1, bw + 2, 5);
      g.fillStyle = '#3fa0e8'; g.fillRect(sx - bw / 2, sy - r - 16 + bh + 2, bw * Math.max(0, Math.min(1, snap.mp / (snap.mhp * 0.7 || 1))), 3);
    }
    if (snap.sh > 0) { g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, r + 4, 0, Math.PI * 2); g.stroke(); }
    // level chip
    g.fillStyle = 'rgba(8,14,24,0.9)';
    g.beginPath(); g.arc(sx - bw / 2 - 7, sy - r - 16 + bh / 2, 8.5, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffe9ad'; g.lineWidth = 1; g.stroke();
    label2(g, String(snap.lv), sx - bw / 2 - 7, sy - r - 16 + bh / 2 + 0.5, '#ffe9ad', 9);
    if (snap.rc) {
      g.strokeStyle = '#e8b23d'; g.lineWidth = 3;
      g.beginPath(); g.arc(sx, sy, r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ((this.time % 3) / 3)); g.stroke();
    }
    if (snap.ch) { g.strokeStyle = '#b48aff'; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, r + 12, 0, Math.PI * 2); g.stroke(); }
    if (isMe) label2(g, 'YOU', sx, sy - r - 30, '#fff', 10);
    else if (snap.tm === 0) label2(g, def.n || snap.hi, sx, sy - r - 28, '#9cc4ff', 9);
    g.globalAlpha = 1;
  }

  drawParticles(dt, g) {
    const keep = [];
    for (const p of this.particles) {
      p.t += dt;
      if (p.t >= p.life) continue;
      keep.push(p);
      const k = p.t / p.life;
      if (p.ring) {
        const [sx, sy] = this.worldToScreen(p.x, p.y);
        g.globalAlpha = 1 - k;
        g.strokeStyle = p.color; g.lineWidth = 3;
        g.beginPath(); g.arc(sx, sy, (p.r0 + (p.r1 - p.r0) * k) * this.zoom, 0, Math.PI * 2); g.stroke();
      } else {
        p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92;
        const [sx, sy] = this.worldToScreen(p.x, p.y);
        g.globalAlpha = 1 - k;
        g.fillStyle = p.color;
        g.fillRect(sx - p.r / 2, sy - p.r / 2, p.r, p.r);
      }
      g.globalAlpha = 1;
    }
    this.particles = keep.slice(-160);
  }
  drawTexts(dt, g) {
    const keep = [];
    for (const t of this.texts) {
      t.t += dt;
      if (t.t >= t.life) continue;
      keep.push(t);
      const [sx, sy] = this.worldToScreen(t.x, t.y - t.t * 60);
      g.globalAlpha = 1 - t.t / t.life;
      label2(g, t.txt, sx, sy, t.color, t.size);
      g.globalAlpha = 1;
    }
    this.texts = keep.slice(-40);
  }

  // ---------- minimap ----------
  drawMinimap(visSet) {
    const g = this.mg, S = 200, k = S / W;
    if (!this.cur) return;
    g.clearRect(0, 0, S, S);
    g.drawImage(this.terrain, 0, 0, S, S);
    g.globalAlpha = 0.32; g.fillStyle = '#060b14'; g.fillRect(0, 0, S, S);
    g.globalAlpha = 1;
    const dot = (x, y, c, r = 3) => { g.fillStyle = c; g.beginPath(); g.arc(x * k, y * k, r, 0, Math.PI * 2); g.fill(); };
    for (const s of this.cur.structs || []) {
      const def = structDefById(s.i);
      if (!def) continue;
      g.fillStyle = s.d ? '#333c46' : TEAMCOL[def.team];
      const size = def.kind === 'core' ? 8 : 5;
      g.fillRect(def.x * k - size / 2, def.y * k - size / 2, size, size);
      if (def.kind === 'core' && !s.d) { g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1; g.strokeRect(def.x * k - size / 2 - 1, def.y * k - size / 2 - 1, size + 2, size + 2); }
    }
    // objective countdowns on minimap
    for (const key of ['shell', 'colossus']) {
      const o = MAP.objectives[key];
      const st = this.cur.obj ? this.cur.obj[key] : 0;
      if (st === 1) dot(o.x, o.y, key === 'shell' ? '#6fae8f' : '#e8b23d', 5.5);
      else if (st > 0) {
        label2(g, Math.ceil(st) + 's', o.x * k, o.y * k, '#e8b23d', 11);
        g.strokeStyle = 'rgba(232,178,61,0.6)'; g.lineWidth = 1.5;
        g.beginPath(); g.arc(o.x * k, o.y * k, 6, 0, Math.PI * 2); g.stroke();
      }
    }
    for (const m of this.cur.minions || []) if (m.tm === 0) dot(m.x, m.y, 'rgba(120,180,255,0.8)', 1.6);
    for (const h of this.cur.heroes || []) {
      if (h.tm !== 0 && !visSet.has(h.i)) continue;
      if (h.d) continue;
      const isMe = this.me && h.i === this.me.id;
      dot(h.x, h.y, h.tm === 0 ? '#5fa0ff' : '#ff5a66', isMe ? 4.4 : 3.4);
      if (isMe) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(h.x * k, h.y * k, 6, 0, Math.PI * 2); g.stroke(); }
    }
    this.pings = this.pings.filter(p => this.time - p.t < 2.4);
    for (const p of this.pings) {
      const k2 = (this.time - p.t) / 2.4;
      g.strokeStyle = `rgba(232,178,61,${1 - k2})`; g.lineWidth = 2;
      g.beginPath(); g.arc(p.x * k, p.y * k, 3 + k2 * 12, 0, Math.PI * 2); g.stroke();
    }
    const [cx, cy] = [this.cam.x * k, this.cam.y * k];
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
    g.strokeRect(cx - (this.vw / this.zoom) * k / 2, cy - (this.vh / this.zoom) * k / 2, (this.vw / this.zoom) * k, (this.vh / this.zoom) * k);
  }

  resizeIf() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.cv.clientWidth || window.innerWidth, h = this.cv.clientHeight || window.innerHeight;
    if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) this.resize();
  }

  meUnit() {
    if (!this.cur || !this.me) return null;
    return (this.cur.heroes || []).find(h => h.i === this.me.id && !h.d);
  }
}

// ---------- shared draw helpers ----------
function barWithBorder(g, cx, cy, w, h, pct, color) {
  pct = Math.max(0, Math.min(1, pct));
  g.fillStyle = 'rgba(10,16,26,0.9)';
  g.fillRect(cx - w / 2 - 1.5, cy - 1.5, w + 3, h + 3);
  g.fillStyle = color;
  g.fillRect(cx - w / 2, cy, w * pct, h);
}
function label2(g, txt, x, y, color, size = 10) {
  if (!txt) return;
  g.font = `800 ${size}px system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 3; g.strokeStyle = 'rgba(5,10,18,0.85)';
  g.strokeText(txt, x, y);
  g.fillStyle = color;
  g.fillText(txt, x, y);
}
function polyPath(g, x, y, r, n, rot = 0) {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + i / n * Math.PI * 2;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath();
}
function roundRectPath(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// structure defs by snapshot id (positions are static map data)
import { TURRETS } from '../shared/map/MapData.js';
const STRUCT_INDEX = new Map();
for (const t of TURRETS) STRUCT_INDEX.set(t.id, { ...t, kind: 'turret' });
for (const team of [0, 1]) {
  const [x, y] = MAP.core[team];
  STRUCT_INDEX.set('core' + team, { id: 'core' + team, team, kind: 'core', x, y, tier: 4 });
}
function structDefById(id) { return STRUCT_INDEX.get(id); }
