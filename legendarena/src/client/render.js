// LEGEND ARENA — canvas renderer. Draws snapshot-shaped view data (net-seam safe),
// interpolates between snapshots, caches terrain to an offscreen layer, pools FX.
// No per-frame gradients on entity paths, no shadowBlur in hot loops (mobile perf).
import { MAP } from '../shared/map/MapData.js';
import { HEROES } from '../shared/heroes/HeroRegistry.js';
import { CONFIG } from '../shared/core/config.js';

const W = CONFIG.WORLD;
const TEAMCOL = { 0: '#3f8cff', 1: '#ff4d5e' };
const EMBLEMS = ['◆', '✦', '▲', '⬢', '✚', '☾', '⚡', '❋', ' ✧', '▣', '☾', '✶'];

export function drawPortrait(g, heroId, x, y, r) {
  const d = HEROES[heroId] || {};
  const c1 = d.c1 || '#888', c2 = d.c2 || '#ccc';
  const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.2, x, y, r);
  grad.addColorStop(0, c1); grad.addColorStop(1, shade(c1, -0.55));
  g.fillStyle = grad;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#0a1420'; g.lineWidth = Math.max(1.5, r * 0.08); g.stroke();
  // sigil
  g.fillStyle = c2; g.globalAlpha = 0.9;
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
    this.cam = { x: W / 2, y: W / 2, zoom: 0.35 };
    this.prev = null; this.cur = null; this.alpha = 0;
    this.me = null; // {id, heroId}
    this.particles = [];
    this.texts = [];
    this.pings = [];
    this.shake = 0;
    this.time = 0;
    this.showHitboxes = false;
    this.terrain = null;
    this.buildTerrain();
  }

  // ---------- terrain cache ----------
  buildTerrain() {
    const S = 1024, k = S / W;
    const c = document.createElement('canvas'); c.width = c.height = S;
    const g = c.getContext('2d');
    // base grass
    g.fillStyle = '#17301f'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#1b3624';
    for (let i = 0; i < 42; i++) { const x = (i * 997) % S, y = (i * 613) % S; g.fillRect(x, y, 90, 60); }
    // river along anti-diagonal
    g.strokeStyle = 'rgba(52,110,150,0.55)'; g.lineWidth = 74 * k * 2.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, S); g.lineTo(S, 0); g.stroke();
    g.strokeStyle = 'rgba(90,160,205,0.25)'; g.lineWidth = 30 * k * 2.2;
    g.beginPath(); g.moveTo(0, S); g.lineTo(S, 0); g.stroke();
    // lanes
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (const lane of ['TOP', 'MID', 'BOT']) {
      g.strokeStyle = 'rgba(150,130,88,0.5)'; g.lineWidth = 120 * k;
      g.beginPath();
      MAP.lanes[lane].forEach(([x, y], i) => i ? g.lineTo(x * k, y * k) : g.moveTo(x * k, y * k));
      g.stroke();
      g.strokeStyle = 'rgba(190,168,116,0.35)'; g.lineWidth = 76 * k; g.stroke();
    }
    // pits
    for (const [x, y] of [MAP.objectives.shell, MAP.objectives.colossus].map(o => [o.x, o.y])) {
      g.fillStyle = 'rgba(30,44,70,0.8)'; g.beginPath(); g.arc(x * k, y * k, 340 * k, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(120,140,180,0.3)'; g.lineWidth = 3; g.stroke();
    }
    // walls
    for (const w of MAP.walls) {
      g.fillStyle = '#0d1a10';
      g.fillRect(w.x * k, w.y * k, w.w * k, w.h * k);
      g.fillStyle = 'rgba(70,110,70,0.25)';
      g.fillRect(w.x * k, w.y * k, w.w * k, Math.min(4 * k, w.h * k));
    }
    // bushes
    for (const b of MAP.bushes) {
      g.fillStyle = 'rgba(80,170,90,0.4)';
      roundRect(g, b.x * k, b.y * k, b.w * k, b.h * k, 8 * k); g.fill();
    }
    // fountains
    for (const [x, y] of MAP.fountain) {
      g.fillStyle = 'rgba(90,120,190,0.35)'; g.beginPath(); g.arc(x * k, y * k, 180 * k, 0, Math.PI * 2); g.fill();
    }
    this.terrain = c;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.cv.clientWidth || window.innerWidth, h = this.cv.clientHeight || window.innerHeight;
    this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.vw = w; this.vh = h;
    // show ~1800 world units across the smaller screen axis (mobile MOBA standard)
    this.cam.zoom = Math.max(0.5, Math.min(0.9, Math.min(w, h) / 950));
  }

  setSnapshots(view) { this.prev = view.prev; this.cur = view.cur; this.alpha = view.alpha; }

  worldToScreen(x, y) {
    return [(x - this.cam.x) * this.cam.zoom + this.vw / 2, (y - this.cam.y) * this.cam.zoom + this.vh / 2];
  }
  screenToWorld(sx, sy) {
    return [(sx - this.vw / 2) / this.cam.zoom + this.cam.x, (sy - this.vh / 2) / this.cam.zoom + this.cam.y];
  }

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
    // camera follow self
    const me = this.meUnit();
    if (me) { this.cam.x += (me.x - this.cam.x) * Math.min(1, dt * 6); this.cam.y += (me.y - this.cam.y) * Math.min(1, dt * 6); }
    // keep the viewport inside the map (no void bands at the edges)
    const halfW = this.vw / 2 / this.cam.zoom, halfH = this.vh / 2 / this.cam.zoom;
    this.cam.x = Math.max(Math.min(halfW, W / 2), Math.min(this.cam.x, W - Math.min(halfW, W / 2)));
    this.cam.y = Math.max(Math.min(halfH, W / 2), Math.min(this.cam.y, W - Math.min(halfH, W / 2)));
    if (this.shake > 0) { this.cam.x += (Math.random() - 0.5) * this.shake * 6; this.cam.y += (Math.random() - 0.5) * this.shake * 6; this.shake = Math.max(0, this.shake - dt * 26); }

    g.fillStyle = '#0a1420'; g.fillRect(0, 0, this.vw, this.vh);
    if (!this.cur) return;

    // terrain
    const [tx, ty] = this.worldToScreen(0, 0);
    const ts = this.cam.zoom * (W / 1024) * 1024 / 1024; // terrain drawn at zoom * (W/1024)
    const tsz = W * this.cam.zoom;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.terrain, tx, ty, tsz, tsz);

    const visSet = new Set((this.cur.vis && this.cur.vis[0]) || []);
    const viewR = 1200 / this.cam.zoom + 400;
    const inView = (x, y) => Math.abs(x - this.cam.x) < viewR && Math.abs(y - this.cam.y) < viewR * (this.vh / this.vw + 0.4);

    // areas under units
    for (const a of this.cur.areas || []) {
      if (!inView(a.x, a.y)) continue;
      const [ax, ay] = this.worldToScreen(a.x, a.y);
      const r = (a.r || 60) * this.cam.zoom;
      g.globalAlpha = Math.min(0.4, 0.12 + (a.u || 1) * 0.1);
      g.fillStyle = a.tm === 0 ? 'rgba(90,150,255,0.5)' : 'rgba(255,110,120,0.5)';
      if (a.v === 'wall') g.fillStyle = 'rgba(200,160,255,0.55)';
      if (a.v === 'trap') g.fillStyle = 'rgba(120,255,170,0.4)';
      g.beginPath(); g.arc(ax, ay, r, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 0.7; g.strokeStyle = g.fillStyle; g.lineWidth = 2;
      g.beginPath(); g.arc(ax, ay, r, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }

    // structures
    for (const s of this.cur.structs || []) {
      const def = structDefById(s.i);
      if (!def) continue;
      if (!inView(def.x, def.y)) continue;
      const [sx, sy] = this.worldToScreen(def.x, def.y);
      const team = def.team, col = TEAMCOL[team];
      if (def.kind === 'core') {
        const r = 74 * this.cam.zoom;
        g.fillStyle = s.d ? '#25303c' : shade(col, -0.35);
        poly(g, sx, sy, r, 8, Math.PI / 8); g.fill();
        g.strokeStyle = col; g.lineWidth = 3; g.stroke();
        if (!s.d) {
          g.fillStyle = shade(col, 0.25);
          poly(g, sx, sy, r * 0.55, 8, Math.PI / 8 + this.time * 0.5); g.fill();
          hpBar(g, sx, sy - r - 16, r * 2.2, 8, s.hp / s.mhp, col);
        }
      } else {
        const r = 30 * this.cam.zoom;
        if (s.d) { g.fillStyle = '#20262e'; g.beginPath(); g.arc(sx, sy, r * 0.7, 0, Math.PI * 2); g.fill(); continue; }
        g.fillStyle = shade(col, -0.4);
        g.fillRect(sx - r, sy - r, r * 2, r * 2);
        g.fillStyle = col;
        g.beginPath(); g.arc(sx, sy, r * 0.62, 0, Math.PI * 2); g.fill();
        // tier pips
        g.fillStyle = '#ffe9ad';
        for (let i = 0; i < (def.tier || 1); i++) g.fillRect(sx - r + i * 8 * this.cam.zoom, sy - r - 8 * this.cam.zoom, 5 * this.cam.zoom, 5 * this.cam.zoom);
        if (s.inv) { g.strokeStyle = 'rgba(200,220,255,0.7)'; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, r * 1.3, 0, Math.PI * 2); g.stroke(); }
        hpBar(g, sx, sy - r - 12, r * 2.4, 6, s.hp / s.mhp, col);
      }
    }

    // monsters (objectives always shown, camps only when visible — neutral)
    for (const m of this.cur.monsters || []) {
      const isObj = m.obj || m.k === 'shell' || m.k === 'colossus';
      if (!isObj && !visSet.has(m.i)) continue;
      if (!inView(m.x, m.y)) continue;
      const u = this.lerpUnit(this.prev?.monsters, m, m.i);
      const [sx, sy] = this.worldToScreen(u.x, u.y);
      const big = u.k === 'shell' || u.k === 'colossus';
      const r = (big ? 56 : u.k === 'ember' || u.k === 'azure' ? 40 : 26) * this.cam.zoom;
      g.fillStyle = u.k === 'shell' ? '#6fae8f' : u.k === 'colossus' ? '#b06a4a' : u.k === 'ember' ? '#e08a4a' : u.k === 'azure' ? '#5a8ae0' : u.k === 'wisp' ? '#8ad7c0' : '#9a8fb0';
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = 'rgba(10,16,26,0.8)'; g.lineWidth = 2; g.stroke();
      if (big) { hpBar(g, sx, sy - r - 18, r * 2.6, 9, u.hp / u.mhp, '#e8b23d'); label(g, big ? (u.k === 'shell' ? 'ANCIENT SHELL' : 'WAR COLOSSUS') : '', sx, sy - r - 26, '#e8b23d'); }
      else if (u.k === 'ember' || u.k === 'azure') hpBar(g, sx, sy - r - 10, r * 1.8, 5, u.hp / u.mhp, '#e8b23d');
    }

    // minions
    for (const m of this.cur.minions || []) {
      if (!inView(m.x, m.y)) continue;
      const u = this.lerpUnit(this.prev?.minions, m, m.i);
      const [sx, sy] = this.worldToScreen(u.x, u.y);
      const r = (u.mt === 's' ? 20 : 15) * this.cam.zoom;
      g.fillStyle = TEAMCOL[u.tm];
      g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
      g.fillStyle = 'rgba(8,14,24,0.55)';
      g.beginPath(); g.arc(sx, sy, r * 0.45, 0, Math.PI * 2); g.fill();
      if (u.hp < u.mhp) hpBar(g, sx, sy - r - 7, r * 2.2, 4, u.hp / u.mhp, u.tm === 0 ? '#46d05e' : '#ff4d5e');
    }

    // summons
    for (const s of this.cur.summons || []) {
      if (!inView(s.x, s.y)) continue;
      const [sx, sy] = this.worldToScreen(s.x, s.y);
      g.fillStyle = TEAMCOL[s.tm] || '#b48aff';
      poly(g, sx, sy, 10 * this.cam.zoom, 4, this.time); g.fill();
    }

    // colossus pets
    for (const c of this.cur.cols || []) {
      const u = this.lerpUnit(this.prev?.cols, c, c.i);
      if (!inView(u.x, u.y)) continue;
      const [sx, sy] = this.worldToScreen(u.x, u.y);
      const r = 44 * this.cam.zoom;
      g.fillStyle = shade(TEAMCOL[u.tm], -0.2);
      poly(g, sx, sy, r, 6, Math.PI / 6); g.fill();
      g.strokeStyle = TEAMCOL[u.tm]; g.lineWidth = 3; g.stroke();
      hpBar(g, sx, sy - r - 12, r * 2, 6, u.hp / u.mhp, TEAMCOL[u.tm]);
    }

    // projectiles
    for (const p of this.cur.projs || []) {
      if (!inView(p.x, p.y)) continue;
      const u = this.lerpUnit(this.prev?.projs, p, p.i);
      const [sx, sy] = this.worldToScreen(u.x, u.y);
      g.fillStyle = p.c || '#fff';
      g.beginPath(); g.arc(sx, sy, Math.max(2.5, (p.s || 8) * this.cam.zoom * 0.6), 0, Math.PI * 2); g.fill();
    }

    // heroes
    for (const h of this.cur.heroes || []) {
      const isEnemy = h.tm !== 0;
      if (isEnemy && !visSet.has(h.i)) continue;
      if (!inView(h.x, h.y)) continue;
      const u = this.lerpUnit(this.prev?.heroes, h, h.i);
      this.drawHero(u, h, visSet);
    }

    // particles / texts
    this.drawParticles(dt, g);
    this.drawTexts(dt, g);

    // aim indicator (set by controls)
    if (this.aim) {
      const me = this.meUnit();
      if (me) {
        const [mx, my] = this.worldToScreen(me.x, me.y);
        const len = Math.hypot(this.aim.x - me.x, this.aim.y - me.y);
        const ang = Math.atan2(this.aim.y - me.y, this.aim.x - me.x);
        const range = (this.aim.range || 600) * this.cam.zoom;
        g.strokeStyle = 'rgba(232,178,61,0.85)'; g.lineWidth = 3;
        g.setLineDash([10, 8]);
        g.beginPath(); g.moveTo(mx, my);
        const ex = mx + Math.cos(ang) * Math.min(range, len * this.cam.zoom), ey = my + Math.sin(ang) * Math.min(range, len * this.cam.zoom);
        g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
        g.beginPath(); g.arc(ex, ey, 9, 0, Math.PI * 2); g.stroke();
        if (this.aim.radius) { g.globalAlpha = 0.25; g.beginPath(); g.arc(ex, ey, this.aim.radius * this.cam.zoom, 0, Math.PI * 2); g.fillStyle = '#e8b23d'; g.fill(); g.globalAlpha = 1; }
      }
    }

    // hitbox viz (DEV)
    if (this.showHitboxes) {
      g.strokeStyle = 'rgba(255,80,255,0.8)'; g.lineWidth = 1;
      for (const h of this.cur.heroes || []) { if (!visSet.has(h.i) && h.tm !== 0) continue; const [sx, sy] = this.worldToScreen(h.x, h.y); g.strokeRect(sx - 26 * this.cam.zoom, sy - 26 * this.cam.zoom, 52 * this.cam.zoom, 52 * this.cam.zoom); }
    }

    // vignette
    const vg = g.createRadialGradient(this.vw / 2, this.vh / 2, Math.min(this.vw, this.vh) * 0.42, this.vw / 2, this.vh / 2, Math.max(this.vw, this.vh) * 0.72);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(2,6,12,0.55)');
    g.fillStyle = vg; g.fillRect(0, 0, this.vw, this.vh);

    this.drawMinimap(visSet);
  }

  drawHero(u, snap, visSet) {
    const g = this.g;
    const def = HEROES[snap.hi] || {};
    const [sx, sy] = this.worldToScreen(u.x, u.y);
    const r = 34 * this.cam.zoom;
    const col = TEAMCOL[snap.tm];
    const isMe = this.me && snap.i === this.me.id;
    // shadow
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.beginPath(); g.ellipse(sx, sy + r * 0.75, r * 0.9, r * 0.4, 0, 0, Math.PI * 2); g.fill();
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
    // dead → skip bars
    if (snap.d) { g.globalAlpha = 0.35; }
    // hp/mana bars
    const bw = r * 2.6, bh = 7 * this.cam.zoom + 3;
    hpBar(g, sx, sy - r - 14, bw, bh, snap.hp / snap.mhp, snap.tm === 0 ? '#46d05e' : '#ff4d5e');
    if (snap.mp !== undefined) {
      g.fillStyle = '#14243f'; g.fillRect(sx - bw / 2, sy - r - 14 + bh + 1, bw, 3.5);
      g.fillStyle = '#3fa0e8'; g.fillRect(sx - bw / 2, sy - r - 14 + bh + 1, bw * Math.max(0, Math.min(1, snap.mp / (snap.mhp * 0.7 || 1))), 3.5);
    }
    if (snap.sh > 0) { g.strokeStyle = 'rgba(255,255,255,0.75)'; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, r + 4, 0, Math.PI * 2); g.stroke(); }
    // level chip
    g.fillStyle = 'rgba(8,14,24,0.85)';
    g.beginPath(); g.arc(sx - bw / 2 - 6, sy - r - 14 + bh / 2, 8, 0, Math.PI * 2); g.fill();
    label(g, String(snap.lv), sx - bw / 2 - 6, sy - r - 14 + bh / 2 + 0.5, '#ffe9ad', 9);
    // recall ring
    if (snap.rc) {
      g.strokeStyle = '#e8b23d'; g.lineWidth = 3;
      g.beginPath(); g.arc(sx, sy, r + 8, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ((this.time % 3) / 3)); g.stroke();
    }
    // channel ring
    if (snap.ch) { g.strokeStyle = '#b48aff'; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, r + 12, 0, Math.PI * 2); g.stroke(); }
    g.globalAlpha = 1;
    if (isMe) label(g, 'YOU', sx, sy - r - 26, '#fff', 10);
    else if (snap.tm === 0) label(g, def.n || snap.hi, sx, sy - r - 24, '#9cc4ff', 9);
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
        g.beginPath(); g.arc(sx, sy, (p.r0 + (p.r1 - p.r0) * k) * this.cam.zoom, 0, Math.PI * 2); g.stroke();
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
      label(g, t.txt, sx, sy, t.color, t.size);
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
    g.globalAlpha = 0.35; g.fillStyle = '#060b14'; g.fillRect(0, 0, S, S);
    g.globalAlpha = 1;
    const dot = (x, y, c, r = 3) => { g.fillStyle = c; g.beginPath(); g.arc(x * k, y * k, r, 0, Math.PI * 2); g.fill(); };
    // structures
    for (const s of this.cur.structs || []) {
      const def = structDefById(s.i);
      if (!def) continue;
      g.fillStyle = s.d ? '#333c46' : TEAMCOL[def.team];
      const size = def.kind === 'core' ? 7 : 4.5;
      g.fillRect(def.x * k - size / 2, def.y * k - size / 2, size, size);
    }
    // monsters (objectives always)
    for (const m of this.cur.monsters || []) {
      if (m.obj || m.k === 'shell' || m.k === 'colossus') dot(m.x, m.y, m.k === 'shell' ? '#6fae8f' : '#b06a4a', 5);
    }
    // minions
    for (const m of this.cur.minions || []) if (m.tm === 0) dot(m.x, m.y, 'rgba(120,180,255,0.8)', 1.6);
    // heroes
    for (const h of this.cur.heroes || []) {
      if (h.tm !== 0 && !visSet.has(h.i)) continue;
      if (h.d) continue;
      const isMe = this.me && h.i === this.me.id;
      dot(h.x, h.y, h.tm === 0 ? '#5fa0ff' : '#ff5a66', isMe ? 4.4 : 3.4);
      if (isMe) { g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.beginPath(); g.arc(h.x * k, h.y * k, 6, 0, Math.PI * 2); g.stroke(); }
    }
    // pings
    this.pings = this.pings.filter(p => this.time - p.t < 2.4);
    for (const p of this.pings) {
      const k2 = (this.time - p.t) / 2.4;
      g.strokeStyle = `rgba(232,178,61,${1 - k2})`; g.lineWidth = 2;
      g.beginPath(); g.arc(p.x * k, p.y * k, 3 + k2 * 12, 0, Math.PI * 2); g.stroke();
    }
    // camera rect
    const [cx, cy] = [this.cam.x * k, this.cam.y * k];
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 1;
    g.strokeRect(cx - (this.vw / this.cam.zoom) * k / 2, cy - (this.vh / this.cam.zoom) * k / 2, (this.vw / this.cam.zoom) * k, (this.vh / this.cam.zoom) * k);
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
function hpBar(g, cx, cy, w, h, pct, color) {
  pct = Math.max(0, Math.min(1, pct));
  g.fillStyle = 'rgba(10,16,26,0.85)';
  g.fillRect(cx - w / 2 - 1, cy - 1, w + 2, h + 2);
  g.fillStyle = color;
  g.fillRect(cx - w / 2, cy, w * pct, h);
}
function label(g, txt, x, y, color, size = 10) {
  if (!txt) return;
  g.font = `800 ${size}px system-ui, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 3; g.strokeStyle = 'rgba(5,10,18,0.85)';
  g.strokeText(txt, x, y);
  g.fillStyle = color;
  g.fillText(txt, x, y);
}
function poly(g, x, y, r, n, rot = 0) {
  g.beginPath();
  for (let i = 0; i < n; i++) {
    const a = rot + i / n * Math.PI * 2;
    const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    i ? g.lineTo(px, py) : g.moveTo(px, py);
  }
  g.closePath();
}
function roundRect(g, x, y, w, h, r) {
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
  const [x, y] = team === 0 ? MAP.core[0] : MAP.core[1];
  STRUCT_INDEX.set('core' + team, { id: 'core' + team, team, kind: 'core', x, y, tier: 4 });
}
function structDefById(id) { return STRUCT_INDEX.get(id); }
