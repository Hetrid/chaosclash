// LEGEND ARENA — touch controls + desktop fallback.
// Left joystick moves. Right cluster: Basic / S1 / S2 / ULT / Spell / Recall.
// Tap = quick cast (aim assist), drag = precise aim, drag into ✕ = cancel.
// All buttons repositionable/resizable via layout-edit mode (persisted localStorage).
import { HEROES } from '../shared/heroes/HeroRegistry.js';

const MOVE_KEYS = { KeyW: [0, -1], KeyA: [-1, 0], KeyS: [0, 1], KeyD: [1, 0] };

export class Controls {
  constructor({ canvas, driver, renderer, hud }) {
    this.canvas = canvas; this.driver = driver; this.renderer = renderer; this.hud = hud;
    this.mode = 'lane';            // target-lock: hero | lane | turret
    this.joy = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
    this.aiming = null;            // {slot, startX, startY, x, y, aimRadius, range}
    this.keys = new Set();
    this.editMode = false;
    this.layout = this.loadLayout();
    this.bind();
    this.applyLayout();
  }

  // ---------- persistence ----------
  loadLayout() {
    try { return JSON.parse(localStorage.getItem('la_layout') || '{}'); } catch { return {}; }
  }
  saveLayout() { try { localStorage.setItem('la_layout', JSON.stringify(this.layout)); } catch { /* private mode */ } }
  applyLayout() {
    for (const [key, l] of Object.entries(this.layout)) {
      const el = document.getElementById(key);
      if (!el) continue;
      if (l.x != null) { el.style.left = l.x + 'px'; el.style.top = l.x != null ? l.y + 'px' : ''; el.style.right = 'auto'; el.style.bottom = 'auto'; }
      if (l.s) el.style.transform = `scale(${l.s})`;
    }
  }
  setEditMode(on) {
    this.editMode = on;
    document.body.classList.toggle('layout-edit', on);
    if (on) {
      const done = document.createElement('button');
      done.id = 'btn-layout-done'; done.className = 'btn btn-primary';
      done.textContent = 'DONE: drag buttons · pinch/slider to resize';
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

  // ---------- input plumbing ----------
  emit(input) { this.driver && this.driver.applyInput(input); }

  bind() {
    const cv = this.canvas;
    cv.addEventListener('touchstart', e => this.onTouch(e, 'start'), { passive: false });
    cv.addEventListener('touchmove', e => this.onTouch(e, 'move'), { passive: false });
    cv.addEventListener('touchend', e => this.onTouch(e, 'end'), { passive: false });
    cv.addEventListener('touchcancel', e => this.onTouch(e, 'end'), { passive: false });

    // skill buttons
    for (const slot of ['q', 'e', 'r']) {
      const el = document.getElementById('btn-' + slot);
      el.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); this.aimStart(slot, e.touches[0]); }, { passive: false });
      el.addEventListener('touchmove', e => { e.preventDefault(); e.stopPropagation(); this.aimMove(slot, e.touches[0]); }, { passive: false });
      el.addEventListener('touchend', e => { e.preventDefault(); e.stopPropagation(); this.aimEnd(slot, e.changedTouches[0]); }, { passive: false });
      // desktop
      el.addEventListener('mousedown', e => { e.preventDefault(); this.quickCast(slot); });
    }
    const basic = document.getElementById('btn-basic');
    basic.addEventListener('touchstart', e => { e.preventDefault(); e.stopPropagation(); this.basicTap(e.touches[0]); }, { passive: false });
    basic.addEventListener('mousedown', e => { e.preventDefault(); this.basicTap(); });

    document.getElementById('btn-spell').addEventListener('pointerdown', e => { e.preventDefault(); this.emit({ spell: {} }); });
    document.getElementById('btn-recall').addEventListener('pointerdown', e => {
      e.preventDefault();
      const me = this.myHero();
      this.emit({ recall: me && me.recall ? 0 : 1, stopRecall: me && me.recall ? true : undefined });
    });
    for (const b of document.querySelectorAll('.lock-btn')) {
      b.addEventListener('click', () => {
        document.querySelectorAll('.lock-btn').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        this.mode = b.dataset.mode;
        this.emit({ targetMode: this.mode });
      });
    }

    // keyboard (desktop dev)
    window.addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (e.code === 'KeyQ') this.quickCast('q');
      if (e.code === 'KeyE') this.quickCast('e');
      if (e.code === 'KeyR') this.quickCast('r');
      if (e.code === 'KeyF') this.emit({ spell: {} });
      if (e.code === 'KeyB') this.emit({ recall: 1 });
      if (e.code === 'Space') { e.preventDefault(); this.basicTap(); }
      if (e.code === 'KeyP') this.hud && this.hud.toggleShop();
      if (e.code === 'Tab') { e.preventDefault(); this.hud && this.hud.toggleScoreboard(true); }
    });
    window.addEventListener('keyup', e => { this.keys.delete(e.code); this.hud && e.code === 'Tab' && this.hud.toggleScoreboard(false); });

    // minimap peek + ping
    const mm = document.getElementById('minimap');
    mm.addEventListener('pointerdown', e => {
      const r = mm.getBoundingClientRect();
      const wx = (e.clientX - r.left) / r.width * 6400, wy = (e.clientY - r.top) / r.height * 6400;
      this.renderer.cam.x = wx; this.renderer.cam.y = wy;
      this.renderer.pings.push({ x: wx, y: wy, t: this.renderer.time });
      this.emit({ aim: { x: wx, y: wy } });
    });
  }

  myHero() {
    const v = this.driver && this.driver.view();
    return v && v.cur ? v.cur.heroes.find(h => h.i === this.driver.heroId) : null;
  }

  // ---------- joystick ----------
  onTouch(e, phase) {
    e.preventDefault();
    if (this.editMode) return;
    const joyBase = document.getElementById('joy-base');
    for (const t of phase === 'end' ? e.changedTouches : e.changedTouches || e.touches) {
      if (phase === 'start') {
        const r = joyBase.getBoundingClientRect();
        const inJoy = t.clientX >= r.left - 30 && t.clientX <= r.right + 30 && t.clientY >= r.top - 30 && t.clientY <= r.bottom + 30;
        if (inJoy && !this.joy.active) {
          this.joy = { active: true, id: t.identifier, ox: r.left + r.width / 2, oy: r.top + r.height / 2, dx: 0, dy: 0 };
        }
      } else if (this.joy.active && t.identifier === this.joy.id) {
        if (phase === 'move') {
          const dx = t.clientX - this.joy.ox, dy = t.clientY - this.joy.oy;
          const d = Math.hypot(dx, dy), max = 56;
          const k = d > max ? max / d : 1;
          this.joy.dx = dx * k; this.joy.dy = dy * k;
          document.getElementById('joy-stick').style.transform = `translate(calc(-50% + ${this.joy.dx}px), calc(-50% + ${this.joy.dy}px))`;
        } else {
          this.joy = { active: false, id: null, ox: 0, oy: 0, dx: 0, dy: 0 };
          document.getElementById('joy-stick').style.transform = 'translate(-50%,-50%)';
          this.emit({ move: null });
        }
      }
    }
  }

  keyboardMove() {
    let x = 0, y = 0;
    for (const k of this.keys) if (MOVE_KEYS[k]) { x += MOVE_KEYS[k][0]; y += MOVE_KEYS[k][1]; }
    return [x, y];
  }

  // called every frame by main loop
  tick() {
    if (this.editMode) return;
    const me = this.myHero();
    if (!me) return;
    if (this.joy.active && (this.joy.dx || this.joy.dy)) {
      const mag = Math.min(1, Math.hypot(this.joy.dx, this.joy.dy) / 56);
      const wx = me.x + (this.joy.dx / 56) * 520 * mag, wy = me.y + (this.joy.dy / 56) * 520 * mag;
      this.emit({ move: { x: wx, y: wy } });
    } else {
      const [kx, ky] = this.keyboardMove();
      if (kx || ky) this.emit({ move: { x: me.x + kx * 420, y: me.y + ky * 420 } });
    }
    // desktop aim with mouse position (renderer tracks last mouse)
    if (this.renderer.mouse) {
      const [wx, wy] = this.renderer.screenToWorld(this.renderer.mouse[0], this.renderer.mouse[1]);
      this.emit({ aim: { x: wx, y: wy } });
    }
  }

  // ---------- skills ----------
  abilityMeta(slot) {
    const me = this.myHero();
    if (!me) return { range: 600, radius: 0, aim: 'point' };
    const def = HEROES[me.hi];
    const ab = def && def.abilities && def.abilities[slot];
    return { range: (ab && ab.range) || 500, radius: ab && ab.radius ? ab.radius : (slot === 'r' ? 150 : 120), aim: (ab && ab.aim) || 'point' };
  }

  aimStart(slot, t) {
    if (this.editMode) return;
    document.getElementById('btn-' + slot).classList.add('aiming');
    document.getElementById('cancel-zone').classList.remove('hidden');
    const me = this.myHero();
    const meta = this.abilityMeta(slot);
    this.aiming = { slot, sx: t.clientX, sy: t.clientY, x: t.clientX, y: t.clientY, ...meta, fromX: me ? me.x : 0, fromY: me ? me.y : 0 };
  }
  aimMove(slot, t) {
    if (!this.aiming || this.aiming.slot !== slot) return;
    this.aiming.x = t.clientX; this.aiming.y = t.clientY;
    // world aim for renderer preview
    const [wx, wy] = this.renderer.screenToWorld(t.clientX, t.clientY);
    this.renderer.aim = { x: wx, y: wy, range: this.aiming.range, radius: this.aiming.radius };
    // cancel zone hit test
    const cz = document.getElementById('cancel-zone');
    const r = cz.getBoundingClientRect();
    const hot = t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom;
    cz.classList.toggle('hot', hot);
  }
  aimEnd(slot, t) {
    document.getElementById('btn-' + slot).classList.remove('aiming');
    document.getElementById('cancel-zone').classList.add('hidden');
    this.renderer.aim = null;
    if (!this.aiming || this.aiming.slot !== slot) return;
    const a = this.aiming; this.aiming = null;
    const drag = Math.hypot(t.clientX - a.sx, t.clientY - a.sy);
    const cz = document.getElementById('cancel-zone');
    const r = cz.getBoundingClientRect();
    if (t.clientX >= r.left && t.clientX <= r.right && t.clientY >= r.top && t.clientY <= r.bottom) return; // cancelled
    if (drag < 18) { this.quickCast(slot); return; }
    const [wx, wy] = this.renderer.screenToWorld(t.clientX, t.clientY);
    this.emit({ cast: { slot, x: wx, y: wy } });
  }

  // quick cast with aim assist: nearest visible enemy in range, else straight ahead
  quickCast(slot) {
    const v = this.driver.view(); if (!v.cur) return;
    const me = v.cur.heroes.find(h => h.i === this.driver.heroId);
    if (!me || me.d) return;
    const meta = this.abilityMeta(slot);
    let best = null, bd = 1e9;
    for (const h of v.cur.heroes) {
      if (h.tm === me.tm || h.d) continue;
      if (!(v.cur.vis[0] || []).includes(h.i)) continue;
      const d = Math.hypot(h.x - me.x, h.y - me.y);
      if (d < bd && d <= meta.range + 80) { bd = d; best = h; }
    }
    const aim = best ? { x: best.x, y: best.y } : { x: me.x + Math.cos(me.a || 0) * meta.range, y: me.y + Math.sin(me.a || 0) * meta.range };
    this.emit({ cast: { slot, ...aim } });
  }

  basicTap(touch) {
    const v = this.driver.view(); if (!v.cur) return;
    const me = v.cur.heroes.find(h => h.i === this.driver.heroId);
    if (!me || me.d) return;
    // pick target per lock mode: nearest enemy hero / minion / turret
    let best = null, bd = 1e9;
    const kindOk = (kind) => this.mode === 'hero' ? kind === 'hero' : this.mode === 'turret' ? kind === 'turret' : kind !== 'hero' || false;
    for (const h of v.cur.heroes) {
      if (h.tm === me.tm || h.d) continue;
      if (!(v.cur.vis[0] || []).includes(h.i)) continue;
      if (this.mode !== 'hero') continue;
      const d = Math.hypot(h.x - me.x, h.y - me.y);
      if (d < bd) { bd = d; best = { id: h.i, d }; }
    }
    if (this.mode !== 'hero') {
      // minions/structures via sim-level assist: send attack move; sim auto-acquires
      best = null;
    }
    if (best) this.emit({ attackTargetId: best.id, autoAttack: true });
    else {
      // attack-move toward tap direction
      let wx = me.x, wy = me.y;
      if (touch) [wx, wy] = this.renderer.screenToWorld(touch.clientX, touch.clientY);
      this.emit({ move: { x: wx, y: wy }, autoAttack: true });
    }
  }
}
