// LEGEND ARENA — HUD: status bars, shop, scoreboard, death recap, surrender UI,
// announcements (text + SFX + TTS), results board. Consumes snapshots + events only.
// NOTE: death recap reads driver.sim dmgLog — LOCAL ONLY; the remote driver (P4) must
// include a recap payload in its death event instead (TODO P4).
import { ITEMS } from '../shared/systems/Items.js';
import { HEROES } from '../shared/heroes/HeroRegistry.js';
import { SPELLS } from '../shared/game/Sim.js';
import { xpForLevel } from '../shared/systems/XPSystem.js';
import { MAP } from '../shared/map/MapData.js';
import { CONFIG } from '../shared/core/config.js';
import { drawPortrait, makeAbilityIcon, makeSpellIcon, makeItemIcon } from './render.js';
import { sfx, announce } from './sfx.js';
import { IS_DESKTOP } from './controls.js';

const $ = id => document.getElementById(id);
const MULTIS = { 2: 'DOUBLE KILL', 3: 'TRIPLE KILL', 4: 'QUADRA KILL', 5: 'PENTA KILL' };

export class HUD {
  constructor({ driver, renderer, controls }) {
    this.driver = driver; this.renderer = renderer; this.controls = controls;
    this.meId = driver.heroId;
    this.tab = 'rec';
    this.selected = null;
    this.firstBlood = false;
    this.coreHpLast = [1, 1];
    this.deathAt = null; this.respawnDur = 0; this.recallStart = null;
    this.overHandled = false;
    this.buildShop();
    this.bindStatic();
  }

  // ---------------- shop ----------------
  buildShop() {
    const tabs = [['rec', 'Recommended'], ['attack', 'Attack'], ['magic', 'Magic'], ['defense', 'Defense'], ['move', 'Movement'], ['jungle', 'Jungle'], ['roam', 'Roam']];
    $('shop-tabs').innerHTML = tabs.map(([k, n]) => `<button class="shop-tab ${k === 'rec' ? 'active' : ''}" data-tab="${k}">${n}</button>`).join('');
    for (const b of document.querySelectorAll('.shop-tab')) {
      b.addEventListener('click', () => {
        document.querySelectorAll('.shop-tab').forEach(x => x.classList.remove('active'));
        b.classList.add('active'); this.tab = b.dataset.tab;
        this.renderShop();
      });
    }
    $('shop-close').addEventListener('click', () => this.toggleShop(false));
    $('shop-sell').addEventListener('click', () => {
      if (this.selected != null) {
        const slot = this.myItems().indexOf(this.selected);
        if (slot >= 0) { this.driver.applyInput({ shopSell: slot }); sfx('gold'); }
        this.selected = null; this.renderShop();
      }
    });
  }
  renderShop() {
    const grid = $('shop-grid');
    const me = this.mySnap(); if (!me) return;
    const def = HEROES[me.hi];
    const inFountain = this.inFountain();
    let ids;
    if (this.tab === 'rec') ids = (def && def.build) || [];
    else ids = Object.keys(ITEMS).filter(k => ITEMS[k].cat === this.tab);
    grid.innerHTML = '';
    for (const id of ids) {
      const it = ITEMS[id]; if (!it) continue;
      const owned = this.myItems().includes(id);
      const stats = Object.entries(it.stats || {}).map(([k, v]) => `${STAT_NAMES[k] || k} ${typeof v === 'number' && v < 1 && /pct|chance|lifesteal|vamp|cdr/i.test(k) ? '+' + Math.round(v * 100) + '%' : '+' + v}`).join(', ');
      const afford = me.g >= it.cost;
      const card = document.createElement('div');
      card.className = `item-card ${afford ? '' : 'poor'} ${this.selected === id ? 'sel-item' : ''}`;
      const icon = makeItemIcon(id, 44);
      card.innerHTML = `<div class="it-head"><img class="it-icon" src="${icon.toDataURL()}" alt=""><div><div class="it-name">${it.n}</div><div class="it-cost">🪙 ${it.cost}</div></div></div>
        <div class="it-stats">${stats}</div>
        ${it.unique ? `<div class="it-unique">★ ${it.unique}</div>` : ''}
        ${it.from ? `<div class="it-from">Builds from: ${it.from.map(f => ITEMS[f]?.n || f).join(' + ')}</div>` : ''}`;
      card.addEventListener('click', () => {
        if (!inFountain) { this.toast('Walk to your fountain to shop'); return; }
        if (!afford) { this.toast('Not enough gold'); sfx('hit'); return; }
        this.driver.applyInput({ shopBuy: { item: id } });
        sfx('buy');
        this.selected = id;
        $('shop-sell').classList.remove('hidden');
        this.renderShop();
      });
      grid.appendChild(card);
    }
    $('shop-hint').textContent = 'Tap an item to buy — shopping works anywhere on the map.';
    const myItems = this.myItems();
    $('shop-sell').classList.toggle('hidden', !(this.selected && myItems.includes(this.selected)));
  }
  myItems() {
    const me = this.mySimHero();
    if (me) return me.items || [];
    const snap = this.mySnap();
    return (snap && snap.it) || [];
  }

  // ---------------- static bindings ----------------
  bindStatic() {
    $('btn-shop').addEventListener('click', () => this.toggleShop());
    $('btn-scoreboard').addEventListener('click', () => this.toggleScoreboard());
    $('sur-yes').addEventListener('click', () => this.driver.applyInput({ surrenderVote: true }));
    $('sur-no').addEventListener('click', () => this.driver.applyInput({ surrenderVote: false }));
    $('sur-initiate').addEventListener('click', () => this.driver.applyInput({ surrenderStart: 1 }));
  }

  toggleShop(force) {
    const p = $('shop-panel');
    const show = force !== undefined ? force : p.classList.contains('hidden');
    p.classList.toggle('hidden', !show);
    if (show) this.renderShop();
  }
  toggleScoreboard(force) {
    const p = $('scoreboard-panel');
    const show = force !== undefined ? force : p.classList.contains('hidden');
    p.classList.toggle('hidden', !show);
    if (show) this.renderScoreboard();
  }

  toast(txt) {
    const t = $('center-toast');
    t.textContent = txt;
    t.classList.remove('hidden');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.add('hidden'), 1200);
  }

  announceLine(txt, cls = 'gold', big = false, sfxKey = null) {
    const el = document.createElement('div');
    el.className = `announce ${cls} ${big ? 'big' : ''}`;
    el.textContent = txt;
    $('announce-stack').appendChild(el);
    setTimeout(() => el.remove(), 2700);
    if (sfxKey) sfx(sfxKey);
  }

  // ---------------- per-frame update ----------------
  update(dt) {
    const v = this.driver.view(); const cur = v.cur;
    if (!cur) return;
    const me = cur.heroes.find(h => h.i === this.meId);
    // top bar
    $('kills0').textContent = cur.heroes.filter(h => h.tm === 0).reduce((a, h) => a + h.k, 0);
    $('kills1').textContent = cur.heroes.filter(h => h.tm === 1).reduce((a, h) => a + h.k, 0);
    for (const team of [0, 1]) {
      const core = structHp(cur, 'core' + team);
      const el = $('core-hp' + team).firstElementChild || (() => { const i = document.createElement('i'); $('core-hp' + team).appendChild(i); return i; })();
      const pct = core ? core.hp / core.mhp : 0;
      el.style.transform = `scaleX(${pct})`;
      if (team === 0 && this.coreHpLast[0] > 0.02 && pct < this.coreHpLast[0] - 0.02 && core) {
        announce('baseAtk', 'Your base is under attack!', { cd: 18 }); sfx('hitBig');
      }
      this.coreHpLast[team] = pct;
    }
    // self bars
    if (me) {
      $('self-hp').style.width = `${(me.hp / me.mhp) * 100}%`;
      $('self-hp-txt').textContent = `${Math.ceil(me.hp)} / ${me.mhp}${me.sh ? ` (+${me.sh})` : ''}`;
      $('self-mp').style.width = me.mp !== undefined ? `${(me.mp / Math.max(1, me.mhp * 0.7)) * 100}%` : '100%';
      $('level-badge').textContent = me.lv;
      const cds = me.cds || [0, 0, 0, 0];
      this.setCd('btn-q', cds[0]); this.setCd('btn-e', cds[1]); this.setCd('btn-r', cds[2]); this.setCd('btn-spell', cds[3]);
      $('gold-label').textContent = me.g;
      // recall bar (track start client-side; snapshots carry only the flag)
      if (me.rc) {
        if (this.recallStart == null) this.recallStart = cur.t;
        $('recall-bar').classList.remove('hidden');
        $('recall-fill').style.width = `${Math.min(100, ((cur.t - this.recallStart) / CONFIG.RECALL_TIME) * 100)}%`;
      } else { $('recall-bar').classList.add('hidden'); this.recallStart = null; }
      // death overlay
      if (me.d && this.deathAt == null) this.onDeath();
      if (!me.d && this.deathAt != null) { this.deathAt = null; $('death-overlay').classList.add('hidden'); }
      if (this.deathAt != null) {
        const rem = Math.max(0, this.respawnDur - (cur.t - this.deathAt));
        $('respawn-count').textContent = Math.ceil(rem);
      }
      // surrender modal
      this.updateSurrender(cur, me);
      // MLBB-style next-item popup (auto build)
      this.updateBuildPopup(cur, me);
    }
    if (!$('scoreboard-panel').classList.contains('hidden')) this.renderScoreboard();
  }

  updateBuildPopup(cur, me) {
    const el = $('build-popup');
    const sim = this.driver.sim, h = this.mySimHero();
    if (!el || !sim || !h || h.dead) { el && el.classList.add('hidden'); return; }
    if (this._buildCheckAt && cur.t - this._buildCheckAt < 0.4) { el.classList.toggle('hidden', !this._buildVisible); return; }
    this._buildCheckAt = cur.t;
    const id = sim.shop.nextPurchase(sim, h);
    const check = id ? sim.shop.wantsToBuy(sim, h, id) : { ok: false };
    if (!id || !check.ok || me.g < check.cost) { this._buildVisible = false; el.classList.add('hidden'); return; }
    if (this._buildId !== id) {
      this._buildId = id;
      const it = ITEMS[id];
      el.innerHTML = `<img src="${makeItemIcon(id, 46).toDataURL()}" alt=""><div class="bp-txt"><b>${it.n}</b><span>🪙 ${check.cost} · TAP TO BUY</span></div>`;
      el.onclick = () => {
        this.driver.applyInput({ shopBuy: { item: id } });
        sfx('buy');
        this._buildId = null; this._buildVisible = false;
        el.classList.add('hidden');
        if (!$('shop-panel').classList.contains('hidden')) this.renderShop();
      };
    }
    this._buildVisible = true;
    el.classList.remove('hidden');
  }

  setCd(id, remaining) {
    const el = $(id); if (!el) return;
    const ab = el.dataset.max;
    const max = this.cdMax[id] || (ab ? +ab : 20);
    const pct = Math.max(0, Math.min(100, (remaining / max) * 100));
    el.querySelector('.cd-ov').style.setProperty('--cd', pct);
  }
  cdMax = {};

  initCdMaxes() {
    let me = this.mySimHero();
    if (!me && this.driver.meInfo) {
      // remote driver: build from the picked hero definition (cds come via snapshot)
      const heroId = this.driver.meInfo.hero;
      const def = HEROES[heroId];
      if (def) me = { def, heroId, spell: this.driver.meInfo.spell, level: 1 };
    }
    if (!me || !me.def) return;
    for (const slot of ['q', 'e', 'r']) {
      const ab = me.def.abilities[slot];
      const el = $('btn-' + slot);
      this.cdMax['btn-' + slot] = ab.cd;
      el.dataset.max = ab.cd;
      // icon replaces text label
      let img = el.querySelector('img.sk-icon');
      if (!img) {
        img = document.createElement('img');
        img.className = 'sk-icon';
        el.insertBefore(img, el.firstChild);
      }
      img.src = makeAbilityIcon(me.heroId, slot, 64).toDataURL();
      img.alt = ab.name;
      el.dataset.name = ab.name;
      el.title = `${ab.name}: ${ab.desc}`;
      $('mana-' + slot).textContent = ab.mana ? `${ab.mana}` : '';
    }
    // basic attack icon
    {
      const el = $('btn-basic');
      let img = el.querySelector('img.sk-icon');
      if (!img) { img = document.createElement('img'); img.className = 'sk-icon'; el.insertBefore(img, el.firstChild); }
      img.src = makeAbilityIcon(me.heroId, 'basic', 72).toDataURL();
    }
    if (IS_DESKTOP) {
      const keys = { 'btn-q': 'Q', 'btn-e': 'E', 'btn-r': 'R', 'btn-spell': 'F', 'btn-basic': 'SPACE' };
      for (const [id, k] of Object.entries(keys)) {
        const el = $(id);
        if (el && !el.querySelector('.kbd')) { const b = document.createElement('i'); b.className = 'kbd'; b.textContent = k; el.appendChild(b); }
      }
    }
    const sp = SPELLS[me.spell];
    if (sp) {
      this.cdMax['btn-spell'] = sp.cd; $('btn-spell').dataset.max = sp.cd;
      let img = $('btn-spell').querySelector('img.sk-icon');
      if (!img) { img = document.createElement('img'); img.className = 'sk-icon'; $('btn-spell').insertBefore(img, $('spell-label')); }
      img.src = makeSpellIcon(me.spell, 56).toDataURL();
      $('btn-spell').title = `${sp.name}: ${sp.desc}`;
    }
  }

  updateSurrender(cur, me) {
    const sur = cur.sur;
    const modal = $('surrender-modal');
    if (sur) {
      modal.classList.remove('hidden');
      const myVote = sur.team === me.tm;
      $('sur-info').textContent = myVote
        ? `${sur.by} proposed surrender. ${sur.yes}/5 YES so far — ${Math.max(0, Math.ceil(sur.endsAt - cur.t))}s left`
        : 'Other team is voting…';
      $('sur-actions').classList.toggle('hidden', !myVote);
      // hide YES/NO once I've voted? snapshot doesn't carry my vote; rely on repeat being harmless
    } else {
      if (!modal.classList.contains('hidden')) modal.classList.add('hidden');
      $('sur-initiate').classList.toggle('hidden', cur.t < CONFIG.SURRENDER_MIN_TIME);
    }
  }

  onDeath() {
    this.deathAt = this.driver.view().cur.t;
    const meSim = this.mySimHero();
    const lvl = meSim ? meSim.level : 1;
    this.respawnDur = Math.max(6, Math.min(CONFIG.RESPAWN_CAP, 5 + 2.2 * lvl));
    $('death-overlay').classList.remove('hidden');
    sfx('death');
    // recap from local sim log
    const rows = [];
    if (meSim && meSim.dmgLog) {
      const t0 = this.driver.sim.t - 12;
      const byHero = new Map();
      for (const e of meSim.dmgLog) {
        if (e.t < t0) continue;
        const src = this.driver.sim.unitById(e.srcId);
        const key = src ? (src.name || src.heroId || 'Minion') : 'Minions';
        byHero.set(key, (byHero.get(key) || 0) + e.amount);
      }
      for (const [k, v] of [...byHero.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)) rows.push(`<div class="dr-row"><span>${k}</span><b>${Math.round(v)}</b></div>`);
    }
    $('death-recap').innerHTML = `<div style="color:#7d92b8;margin-bottom:4px">Damage taken (last 12s):</div>${rows.join('') || '<div class="dr-row"><span>Structures / minions</span></div>'}`;
  }

  // ---------------- events → announcements ----------------
  processEvents(evs) {
    const cur = this.driver.view().cur;
    for (const e of evs) {
      switch (e.type) {
        case 'kill': {
          const mine = e.killerTeam === 0;
          if (!this.firstBlood) {
            this.firstBlood = true;
            this.announceLine('FIRST BLOOD', e.killerTeam === 0 ? 'blue' : 'red', true, 'firstblood');
            announce('fb', 'First blood!', { force: true });
            break;
          }
          if (e.executed) break;
          const multi = MULTIS[Math.min(5, e.streak || 0)];
          if (multi && e.killerId === this.meId) { this.announceLine(multi, 'gold', true, 'kill'); announce('multi' + e.streak, multi, { force: true }); }
          else {
            this.announceLine(`${e.killerName} slew ${e.victimName}`, mine ? 'blue' : 'red', false, 'kill');
            if (e.streak >= 3) announce('streak', `${e.killerName} is on a killing spree`, { cd: 20 });
            if (e.shutdown > 0) announce('shut', `${e.killerName} got a shutdown!`, { cd: 20 });
          }
          if (e.victimId === this.meId) this.onDeath();
          break;
        }
        case 'turretKilled': {
          const fellTeam = e.team !== undefined ? e.team : (e.structId && e.structId[1] === '0' ? 0 : 1);
          const mine = fellTeam === 1; // enemy structure fell
          this.announceLine(mine ? 'ENEMY TURRET DESTROYED' : 'OUR TURRET WAS DESTROYED', mine ? 'blue' : 'red', false, 'turretDown');
          announce('turret' + (mine ? 'g' : 'l'), mine ? 'Enemy turret destroyed' : 'Your turret has fallen', { cd: 6 });
          break;
        }
        case 'objectiveSpawn': {
          const which = (e.which || '').toLowerCase();
          const name = which.includes('shell') ? 'Ancient Shell' : which.includes('colossus') ? 'War Colossus' : 'Objective';
          this.announceLine(`${name.toUpperCase()} HAS SPAWNED`, 'gold', true, 'objective');
          announce('spawn' + which, `The ${name} has spawned`, { force: true });
          break;
        }
        case 'objectiveKill': {
          const which = (e.which || '').toLowerCase();
          const name = which.includes('shell') ? 'Ancient Shell' : 'War Colossus';
          const mine = e.team === 0 || e.killerTeam === 0;
          this.announceLine(`${name.toUpperCase()} SLAIN${mine ? '' : ' BY THE ENEMY'}`, mine ? 'blue' : 'red', true, 'objective');
          announce('obj' + which, mine ? `Your team slew the ${name}` : `The enemy team took the ${name}`, { force: true });
          if (e.stolen) announce('steal', `${name} was stolen!`, { force: true });
          break;
        }
        case 'coreDestroyed': {
          const won = e.team === 1;
          this.announceLine(won ? 'ENEMY CORE DESTROYED' : 'OUR CORE HAS FALLEN', won ? 'blue' : 'red', true, 'turretDown');
          break;
        }
        case 'levelup': if (e.id === this.meId) sfx('levelup'); break;
        case 'gold': {
          // passive income ticks (small amounts) stay silent — no background ticking
          if (e.id === this.meId && e.amount >= 15) {
            const now = performance.now() / 1000;
            if (!this._goldSfxAt || now - this._goldSfxAt > 0.5) { this._goldSfxAt = now; sfx('gold'); }
          }
          break;
        }
        case 'hunt': sfx('hunt'); break;
        case 'surrenderEnd': {
          if (e.passed) { this.announceLine('SURRENDER PASSED', 'red', true); announce('surP', 'Your team has surrendered', { force: true }); }
          else this.announceLine('SURRENDER REJECTED', 'gold');
          break;
        }
        case 'respawn': if (e.id === this.meId) { this.deathAt = null; $('death-overlay').classList.add('hidden'); } break;
      }
    }
    // feed events to renderer FX
    this.renderer.applyEvents(evs);
  }

  // ---------------- scoreboard & results ----------------
  renderScoreboard() {
    const cur = this.driver.view().cur; if (!cur) return;
    const rows = tm => cur.heroes.filter(h => h.tm === tm).sort((a, b) => b.g - a.g).map(h => {
      const def = HEROES[h.hi];
      return `<div class="sb-row ${h.i === this.meId ? 'me' : ''}">
        <canvas class="sb-portrait" width="28" height="28" data-hero="${h.hi}"></canvas>
        <span>${h.nm} <small style="color:#7d92b8">Lv${h.lv}</small></span>
        <span>${h.k}/${h.de}/${h.as}</span><span>${h.g}</span>
        <span>${(h.items || []).length}/6</span>
        <span>${def ? def.n : h.hi}</span>
      </div>`;
    }).join('');
    $('scoreboard-panel').innerHTML = `
      <div class="sb-team-title" style="color:var(--blue)">BLUE TEAM</div>
      <div class="sb-row sb-head"><span></span><span>HERO</span><span>K/D/A</span><span>GOLD</span><span>ITEMS</span><span></span></div>
      ${rows(0)}
      <div class="sb-team-title" style="color:var(--red)">RED TEAM</div>
      ${rows(1)}`;
    for (const c of document.querySelectorAll('.sb-portrait')) {
      const g = c.getContext('2d');
      drawPortrait(g, c.dataset.hero, 14, 14, 13);
    }
  }

  showResults(over) {
    const won = over.winner === 0;
    const banner = $('results-banner');
    banner.textContent = won ? 'VICTORY' : 'DEFEAT';
    banner.className = won ? 'win' : 'lose';
    $('results-sub').textContent = over.reason === 'surrender' ? (won ? 'ENEMIES SURRENDERED' : 'YOUR TEAM SURRENDERED') : 'CORE DESTROYED';
    sfx(won ? 'victory' : 'defeat');
    announce('end', won ? 'Victory!' : 'Defeat', { force: true });
    const cur = this.driver.view().cur;
    const rows = tm => cur.heroes.filter(h => h.tm === tm).sort((a, b) => (b.k + b.as) - (a.k + a.as)).map(h => {
      const def = HEROES[h.hi];
      const items = this.myItemsFor(h);
      return `<div class="sb-row ${h.i === this.meId ? 'me' : ''}">
        <canvas class="sb-portrait" width="28" height="28" data-hero="${h.hi}"></canvas>
        <span>${h.nm} <small style="color:#7d92b8">${def ? def.n : h.hi} · Lv${h.lv}</small></span>
        <span>${h.k}/${h.de}/${h.as}</span><span>${h.g}g</span>
        <span>${items.length}/6</span><span></span></div>`;
    }).join('');
    $('results-board').innerHTML = `
      <div class="sb-team-title" style="color:var(--blue)">BLUE TEAM</div>${rows(0)}
      <div class="sb-team-title" style="color:var(--red)">RED TEAM</div>${rows(1)}`;
    for (const c of document.querySelectorAll('#results-board .sb-portrait')) {
      drawPortrait(c.getContext('2d'), c.dataset.hero, 14, 14, 13);
    }
    document.dispatchEvent(new CustomEvent('la-results'));
  }
  myItemsFor(h) { // local driver: pull from sim; remote: count from snapshot when provided
    const sim = this.driver.sim;
    if (sim) { const s = sim.heroes.find(x => x.id === h.i); return s ? s.items || [] : []; }
    return [];
  }

  // ---------------- dev panel (?dev=1, LOCAL ONLY) ----------------
  buildDevPanel() {
    const p = $('dev-panel');
    p.classList.remove('hidden');
    p.innerHTML = `<h4>DEV PANEL (local)</h4>
      <div class="dev-grid">
        <button data-dev="gold">+1000 gold</button>
        <button data-dev="level">+1 level</button>
        <button data-dev="heal">Full heal</button>
        <button data-dev="cds">Reset CDs</button>
        <button data-dev="hit">Hitboxes</button>
        <button data-dev="tp">TP Mid</button>
      </div>
      <label>Server-authorized cheats only in production (no name/password). This panel exists in local/dev builds.</label>`;
    p.querySelectorAll('[data-dev]').forEach(b => b.addEventListener('click', () => {
      const sim = this.driver.sim; if (!sim) return;
      const me = sim.heroes.find(h => h.controller === 'local');
      switch (b.dataset.dev) {
        case 'gold': me.gold += 1000; break;
        case 'level': sim.xp.grantXp(sim, me, xpForLevel(me.level)); break;
        case 'heal': me.hp = me.maxHp; me.mana = me.maxMana; break;
        case 'cds': me.cds.q = me.cds.e = me.cds.r = me.cds.spell = 0; break;
        case 'hit': this.renderer.showHitboxes = !this.renderer.showHitboxes; break;
        case 'tp': me.x = 3200; me.y = 3200; break;
      }
      sfx('ping');
    }));
  }

  // ---------------- helpers ----------------
  mySnap() { const cur = this.driver.view().cur; return cur && cur.heroes.find(h => h.i === this.meId); }
  mySimHero() { return this.driver.sim ? this.driver.sim.heroes.find(h => h.id === this.meId) : null; }
  inFountain() {
    const me = this.mySnap(); if (!me) return false;
    const [fx, fy] = MAP.fountain[0];
    return Math.hypot(me.x - fx, me.y - fy) < 520;
  }
}

const STAT_NAMES = {
  physAtk: 'P.Atk', magPower: 'M.Power', maxHp: 'HP', physDef: 'P.Def', magDef: 'M.Def',
  aspd: 'AS', ms: 'MS', cdr: 'CDR', lifesteal: 'Lifesteal', spellVamp: 'Spell Vamp',
  critChance: 'Crit', physPen: 'Phys Pen', magPenPct: 'Magic Pen %', hpRegen: 'HP Regen',
  maxMana: 'Mana', manaRegen: 'Mana Regen',
};

function structHp(cur, id) { return (cur.structs || []).find(s => s.i === id); }
