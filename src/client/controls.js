// LEGEND ARENA — controls: floating joystick (touch), WASD+mouse (desktop),
// drag-aim with cancel, MLBB-style hold-to-preview (range + radius + description),
// pinch zoom + minimap/map peek, target lock, layout editing (persisted).
import { HEROES } from '../shared/heroes/HeroRegistry.js';

const MOVE_KEYS = { KeyW: [0, -1], KeyA: [-1, 0], KeyS: [0, 1], KeyD: [1, 0] };

export const IS_DESKTOP = typeof window !== 'undefined' && window.matchMedia
  && window.matchMedia('(pointer: fine)').matches && !window.matchMedia('(pointer: coarse)').matches;

export class Controls {
  constructor({ canvas, driver, renderer, hud }) {
    this.canvas = canvas; this.driver = driver; this.renderer = renderer; this.hud = hud;
    this.mode = 'lane';
    this.joy = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
    this.aiming = null;           // drag state {slot, sx, sy, x, y, range, radius}
    this.holdTimer = null;        // hold-to-preview timer
    this.held = null;             // currently held slot (preview)
    this.keys = new Set();
    this.editMode = false;
    this.layout = this.loadLayout();
    this.pinch = null;            // {d0, z0}
    this.pan = null;              // {id, sx, sy}
    this.mouse = null;
    this.lastSpellDir = null;     // {x,y} world dir for flicker etc
    this.bind();
    this.applyLayout();
    if (IS_DESKTOP) {
      document.body.classList.add('desktop');
      const hints = document.getElementById('desktop-hints');
      if (hints) hints.classList.remove('hidden');
    }
  }

  // ---------- persistence ----------
  loadLayout() { try { return JSON.parse(localStorage.getItem('la_layout') || '{}'); } catch { return {}; } }
  saveLayout() { try { localStorage.setItem('la_layout', JSON.stringify(this.layout)); } catch { } }
  applyLayout() {
    for (const [key, l] of Object.entries(this.layout)) {
      const el = document.getElementById(key);
      if (!el) continue;
      if (l.x != null) { el.style.left = l.x + 'px'; el.style.top = l.y + 'px'; el.style.right = 'auto'; el.style.bottom = 'auto'; }
      if (l.s) el.style.transform = `scale(${l.s})`;
    }
  }
  setEditMode(on) {
    this.editMode = on;
    document.body.classList.toggle('layout-edit', on);
    if (on) {
      const done = document.createElement('button');
      done.id = 'btn-layout-done'; done.className = 'btn btn-primary';
      done.textContent = 'DONE: drag buttons · slider resizes selected';
      const slider = document.createElement('input');
      slider.type = 'range'; slider.min = '0.6'; slider.max = '1.6'; slider.step = '0.05'; slider.value = '1';
      slider.id = 'layout-scale'; slider.style.cssText = 'position:fixed;top:70px;left:50%;transform:translateX(-50%);z-index:60;width:220px;';
      done.onclick = () => { this.setEditMode(false); done.remove(); slider.remove(); };
      slider.oninput = () => {
        const hovered = document.querySelector('.skill-btn.editting, #joy-base.editting');
        if (!hovered) return;
        hovered.style.transform = `scale(${slider.value})`;
        (this.layout[hovered.id] ??= {}).s = +slider.value;
        this.saveLayout();
      };
      document.body.append(done, slider);
    }
  }

  emit(input) { this.driver && this.driver.applyInput(input); }

  // ---------- binding ----------
  bind() {
    // joystick zone: dedicated element so canvas never fights it
    const zone = document.getElementById('hud-bottom-left');
    const joyBase = document.getElementById('joy-base');
    zone.addEventListener('touchstart', e => {
      e.preventDefault();
      if (this.editMode || this.joy.active) return;
      const t = e.changedTouches[0];
      // floating joystick: origin where the finger lands
      const r = zone.getBoundingClientRect();
      const ox = Math.max(r.left + 64, Math.min(t.clientX, r.right - 64));
      const oy = Math.max(r.top + 64, Math.min(t.clientY, r.bottom - 64));
      this.joy = { active: true, id: t.identifier, ox, oy, dx: 0, dy: 0 };
      joyBase.classList.add('floating');
      joyBase.style.left = (ox - r.left - 64) + 'px';
      joyBase.style.top = (oy - r.top - 64) + 'px';
      joyBase.style.bottom = 'auto';
    }, { passive: false });
    const joyMove = e => {
      for (const t of e.changedTouches) {
        if (this.joy.active && t.identifier === this.joy.id) {
          e.preventDefault();
          const dx = t.clientX - this.joy.ox, dy = t.clientY - this.joy.oy;
          const d = Math.hypot(dx, dy), max = 56;
          const k = d > max ? max / d : 1;
          this.joy.dx = dx * k; this.joy.dy = dy * k;
          document.getElementById('joy-stick').style.transform =
            `translate(calc(-50% + ${this.joy.dx}px), calc(-50% + ${this.joy.dy}px))`;
        }
      }
    };
    const joyEnd = e => {
      for (const t of e.changedTouches) {
        if (this.joy.active && t.identifier === this.joy.id) {
          e.preventDefault();
          this.joy = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
          const joyBase = document.getElementById('joy-base');
          joyBase.classList.remove('floating');
          joyBase.style.left = ''; joyBase.style.top = ''; joyBase.style.bottom = '';
          document.getElementById('joy-stick').style.transform = 'translate(-50%,-50%)';
          this.emit({ move: null });
        }
      }
    };
    zone.addEventListener('touchmove', joyMove, { passive: false });
    zone.addEventListener('touchend', joyEnd, { passive: false });
    zone.addEventListener('touchcancel', joyEnd, { passive: false });

    // skill buttons (touch + desktop)
    for (const slot of ['q', 'e', 'r']) {
      const el = document.getElementById('btn-' + slot);
      el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); this.pressStart(slot, e.touches[0]); }, { passive: false });
      el.addEventListener('touchmove', e => { e.preventDefault(); e.stopPropagation(); this.pressMove(slot, e.touches[0]); }, { passive: false });
      el.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); this.pressEnd(slot, e.changedTouches[0]); }, { passive: false });
      el.addEventListener('mousedown', e => { e.preventDefault(); this.pressStart(slot); });
      el.addEventListener('mouseup', e => { e.preventDefault(); this.pressEnd(slot); });
      el.addEventListener('mouseleave', () => { if (this.held === slot && !this.aiming) this.pressEnd(slot); });
    }
    const basic = document.getElementById('btn-basic');
    basic.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); this.renderer.attackRangeUntil = this.renderer.time + 5; this.basicTap(); }, { passive: false });
    basic.addEventListener('touchend', () => { this.renderer.attackRangeUntil = this.renderer.time + 0.6; });
    basic.addEventListener('mousedown', e => { e.preventDefault(); this.renderer.attackRangeUntil = this.renderer.time + 5; this.basicTap(); });
    basic.addEventListener('mouseup', () => { this.renderer.attackRangeUntil = this.renderer.time + 0.6; });

    const spellBtn = document.getElementById('btn-spell');
    spellBtn.addEventListener('pointerdown', e => { e.preventDefault(); this.castSpellAimed(); });
    document.getElementById('btn-recall').addEventListener('pointerdown', e => {
      e.preventDefault();
      const me = this.myHero();
      this.emit(me && me.rc ? { recall: 0, stopRecall: true } : { recall: 1 });
    });
    for (const b of document.querySelectorAll('.lock-btn')) {
      b.addEventListener('click', () => {
        document.querySelectorAll('.lock-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.mode = b.dataset.mode;
        this.emit({ targetMode: this.mode });
      });
    }

    // canvas: pan (peek) + pinch zoom (touch), mouse aim + wheel zoom (desktop)
    this.canvas.addEventListener('touchstart', e => {
      if (e.touches.length === 2) {
        const [a, b] = e.touches;
        this.pinch = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), z0: this.renderer.userZoom };
      } else if (e.touches.length === 1 && !this.joy.active) {
        const t = e.touches[0];
        this.pan = { id: t.identifier, sx: t.clientX, sy: t.clientY, camx: this.renderer.cam.x, camy: this.renderer.cam.y, moved: false };
      }
    }, { passive: true });
    this.canvas.addEventListener('touchmove', e => {
      if (this.pinch && e.touches.length === 2) {
        const [a, b] = e.touches;
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        this.renderer.userZoom = Math.max(0.55, Math.min(2.1, this.pinch.z0 * d / Math.max(1, this.pinch.d0)));
      } else if (this.pan && e.touches.length === 1) {
        for (const t of e.touches) if (t.identifier === this.pan.id) {
          const z = this.renderer.zoom;
          const dx = (t.clientX - this.pan.sx) / z, dy = (t.clientY - this.pan.sy) / z;
          if (Math.hypot(t.clientX - this.pan.sx, t.clientY - this.pan.sy) > 14) {
            this.pan.moved = true;
            this.renderer.peek = { x: this.pan.camx - dx, y: this.pan.camy - dy, until: this.renderer.time + 0.6 };
          }
        }
      }
    }, { passive: true });
    const endCanvas = e => {
      if (e.touches.length < 2) this.pinch = null;
      if (this.pan && ![...e.touches].some(t => t.identifier === this.pan.id)) this.pan = null;
    };
    this.canvas.addEventListener('touchend', endCanvas, { passive: true });
    this.canvas.addEventListener('touchcancel', endCanvas, { passive: true });

    // minimap peek (hold to look)
    const mm = document.getElementById('minimap');
    const mmPeek = e => {
      const r = mm.getBoundingClientRect();
      const wx = (e.clientX - r.left) / r.width * 6400, wy = (e.clientY - r.top) / r.height * 6400;
      this.renderer.peek = { x: wx, y: wy, until: this.renderer.time + 0.8 };
    };
    mm.addEventListener('pointerdown', e => { e.preventDefault(); mmPeek(e); mm.setPointerCapture(e.pointerId); this._mmDown = true; });
    mm.addEventListener('pointermove', e => { if (this._mmDown) mmPeek(e); });
    mm.addEventListener('pointerup', () => { this._mmDown = false; });

    // desktop: mouse aim + wheel zoom
    this.canvas.addEventListener('mousemove', e => {
      this.mouse = [e.clientX, e.clientY];
      this.renderer.mouse = this.mouse;
    });
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.renderer.userZoom = Math.max(0.55, Math.min(2.1, this.renderer.userZoom * (e.deltaY > 0 ? 0.9 : 1.1)));
    }, { passive: false });

    // keyboard
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyQ') this.quickCast('q');
      if (e.code === 'KeyE') this.quickCast('e');
      if (e.code === 'KeyR') this.quickCast('r');
      if (e.code === 'KeyF') this.castSpellAimed();
      if (e.code === 'KeyB') this.emit({ recall: 1 });
      if (e.code === 'Space') { e.preventDefault(); this.renderer.attackRangeUntil = this.renderer.time + 1.2; this.basicTap(); }
      if (e.code === 'KeyP') this.hud && this.hud.toggleShop();
      if (e.code === 'Tab') { e.preventDefault(); this.hud && this.hud.toggleScoreboard(true); }
    });
    window.addEventListener('keyup', e => { this.keys.delete(e.code); this.hud && e.code === 'Tab' && this.hud.toggleScoreboard(false); });
  }

  myHero() {
    const v = this.driver && this.driver.view();
    return v && v.cur ? v.cur.heroes.find(h => h.i === this.driver.heroId) : null;
  }

  keyboardMove() {
    let x = 0, y = 0;
    for (const k of this.keys) if (MOVE_KEYS[k]) { x += MOVE_KEYS[k][0]; y += MOVE_KEYS[k][1]; }
    return [x, y];
  }

  // per-frame
  tick() {
    if (this.editMode) return;
    const me = this.myHero();
    if (!me) return;
    if (this.joy.active && (this.joy.dx || this.joy.dy)) {
      const mag = Math.min(1, Math.hypot(this.joy.dx, this.joy.dy) / 56);
      const wx = me.x + (this.joy.dx / 56) * 520 * mag, wy = me.y + (this.joy.dy / 56) * 520 * mag;
      this.lastSpellDir = { x: wx, y: wy };
      this.emit({ move: { x: wx, y: wy } });
    } else {
      const [kx, ky] = this.keyboardMove();
      if (kx || ky) {
        const wx = me.x + kx * 420, wy = me.y + ky * 420;
        this.lastSpellDir = { x: wx, y: wy };
        this.emit({ move: { x: wx, y: wy } });
      }
    }
    if (this.mouse) {
      const [wx, wy] = this.renderer.screenToWorld(this.mouse[0], this.mouse[1]);
      this.emit({ aim: { x: wx, y: wy } });
    }
  }

  // ---------- skills ----------
  abilityMeta(slot, me) {
    me = me || this.myHero();
    if (!me) return { range: 600, radius: 0, aim: 'point' };
    const def = HEROES[me.hi];
    const ab = def && def.abilities && def.abilities[slot];
    return { range: (ab && ab.range) || 500, radius: (ab && (ab.radius || (ab.aim === 'dir' ? 70 : 130))) || 130, aim: (ab && ab.aim) || 'point' };
  }

  // hold on button: preview range ring + radius at facing dir + description tooltip
  pressStart(slot, t) {
    if (this.editMode) return;
    this.held = slot;
    const me = this.myHero();
    const meta = this.abilityMeta(slot, me);
    if (t) {
      this.aiming = { slot, sx: t.clientX, sy: t.clientY, x: t.clientX, y: t.clientY, ...meta };
    } else {
      this.aiming = null;
    }
    this.renderer.aimHold = { slot, ...meta };
    document.getElementById('btn-' + slot).classList.add('aiming');
    document.getElementById('cancel-zone').classList.remove('hidden');
    this.showTooltip(slot, meta);
    clearTimeout(this.holdTimer);
  }
  pressMove(slot, t) {
    if (!this.aiming || this.aiming.slot !== slot) return;
    this.aiming.x = t.clientX; this.aiming.y = t.clientY;
    const [wx, wy] = this.renderer.screenToWorld(t.clientX, t.clientY);
    this.renderer.aim = { x: wx, y: wy, range: this.aiming.range, radius: this.aiming.radius };
    const cz = document.getElementById('cancel-zone');
    const r = cz.getBoundingClientRect();
    const hot = t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom;
    cz.classList.toggle('hot', hot);
  }
  pressEnd(slot, t) {
    document.getElementById('btn-' + slot).classList.remove('aiming');
    document.getElementById('cancel-zone').classList.add('hidden');
    this.hideTooltip();
    this.renderer.aim = null;
    this.renderer.aimHold = null;
    if (this.held !== slot) return;
    this.held = null;
    const a = this.aiming; this.aiming = null;
    if (!a) { this.quickCast(slot); return; } // desktop click / tap without move data
    const drag = Math.hypot(t.clientX - a.sx, t.clientY - a.sy);
    const cz = document.getElementById('cancel-zone');
    const r = cz.getBoundingClientRect();
    if (t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom) return; // cancelled
    if (drag < 18) { this.quickCast(slot); return; }
    const [wx, wy] = this.renderer.screenToWorld(t.clientX, t.clientY);
    this.emit({ cast: { slot, x: wx, y: wy } });
  }

  showTooltip(slot, meta) {
    const me = this.myHero();
    if (!me) return;
    const def = HEROES[me.hi];
    const ab = def && def.abilities[slot];
    if (!ab) return;
    let tip = document.getElementById('ability-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'ability-tooltip';
      document.getElementById('hud-bottom-right').appendChild(tip);
    }
    tip.innerHTML = `<b>${ab.name}</b><span class="tt-meta">${ab.cd}s · ${ab.mana || 0} mp · range ${Math.round(meta.range)}</span><p>${ab.desc}</p>`;
    tip.classList.add('show');
  }
  hideTooltip() {
    const tip = document.getElementById('ability-tooltip');
    if (tip) tip.classList.remove('show');
  }

  castSpellAimed() {
    const me = this.myHero();
    if (!me) return;
    // aim point: last move direction, else facing
    const dir = this.lastSpellDir || { x: me.x + Math.cos(me.a || 0) * 360, y: me.y + Math.sin(me.a || 0) * 360 };
    this.emit({ spell: { x: dir.x, y: dir.y } });
  }

  quickCast(slot) {
    const v = this.driver.view(); if (!v.cur) return;
    const me = v.cur.heroes.find(h => h.i === this.driver.heroId);
    if (!me || me.d) return;
    const meta = this.abilityMeta(slot, me);
    let best = null, bd = 1e9;
    for (const h of v.cur.heroes) {
      if (h.tm === me.tm || h.d) continue;
      if (!(v.cur.vis[0] || []).includes(h.i)) continue;
      const d = Math.hypot(h.x - me.x, h.y - me.y);
      if (d < bd && d <= meta.range + 80) { bd = d; best = h; }
    }
    const aim = best ? { x: best.x, y: best.y } : (this.lastSpellDir || { x: me.x + Math.cos(me.a || 0) * meta.range, y: me.y + Math.sin(me.a || 0) * meta.range });
    this.emit({ cast: { slot, ...aim } });
  }

  basicTap(touch) {
    const v = this.driver.view(); if (!v.cur) return;
    const me = v.cur.heroes.find(h => h.i === this.driver.heroId);
    if (!me || me.d) return;
    let best = null, bd = 1e9;
    if (this.mode === 'hero') {
      for (const h of v.cur.heroes) {
        if (h.tm === me.tm || h.d) continue;
        if (!(v.cur.vis[0] || []).includes(h.i)) continue;
        const d = Math.hypot(h.x - me.x, h.y - me.y);
        if (d < bd) { bd = d; best = h; }
      }
    }
    if (best) this.emit({ attackTargetId: best.id, autoAttack: true });
    else {
      let wx = me.x, wy = me.y;
      if (touch) [wx, wy] = this.renderer.screenToWorld(touch.clientX, touch.clientY);
      else if (this.lastSpellDir) { wx = this.lastSpellDir.x; wy = this.lastSpellDir.y; }
      this.emit({ move: { x: wx, y: wy }, autoAttack: true });
    }
  }
}
