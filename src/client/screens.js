// LEGEND ARENA — screen flow: menu → role select → hero select → loading → match → results.
// Team comp rules: one hero per team max; enemy may mirror. Role select shows missing roles.
import { HERO_LIST, HEROES } from '../shared/heroes/HeroRegistry.js';
import { ROLES } from './net.js';
import { SPELLS } from '../shared/game/Sim.js';
import { drawPortrait } from './render.js';

const $ = id => document.getElementById(id);
const ROLE_ICONS = { EXP: '⚔', JUNGLE: '🌿', MID: '✨', GOLD: '🏹', ROAM: '🛡' };
const ROLE_BLURB = { EXP: 'Solo side lane. Tanky fighters.', JUNGLE: 'Camps + Hunt spell + ganks.', MID: 'Center lane burst/control.', GOLD: 'Farm lane. Carry damage.', ROAM: 'Support the map.' };

export const TIPS = [
  'Last-hitting minions pays the most gold — time your basics.',
  'The Ancient Shell grants team gold and a protective buff.',
  'The War Colossus joins your push late game. Contest it!',
  'Junglers: your Hunt spell executes monsters. Use it to secure objectives.',
  'Turrets hit harder each consecutive shot — don\'t tank them alone.',
  'Recall channels back to base. Taking damage cancels it.',
  'Bushes hide you — but attacking reveals you briefly.',
  'Red buff (Ember Crest) amps damage. Blue buff (Azure Mind) speeds cooldowns.',
  'You can surrender after 8 minutes — it takes a team majority.',
  'Enemy turrets are invulnerable until the outer turret of that lane falls.',
];

export class Screens {
  constructor({ startMatch }) {
    this.startMatch = startMatch; // callback(me, allies, enemies, diff)
    this.sel = { role: null, spell: null, hero: null };
    this.diff = 2;
    this.bind();
  }

  show(id) {
    for (const s of document.querySelectorAll('.screen')) s.classList.add('hidden');
    $(id).classList.remove('hidden');
    this.current = id;
  }

  bind() {
    $('btn-play').addEventListener('click', () => { this.buildRoleGrid(); this.show('screen-role'); });
    $('btn-howto').addEventListener('click', () => this.show('screen-howto'));
    for (const b of document.querySelectorAll('[data-back]')) b.addEventListener('click', () => this.show('screen-menu'));
    $('btn-role-next').addEventListener('click', () => { this.buildHeroGrid(); this.show('screen-hero'); });
    $('btn-hero-lock').addEventListener('click', () => this.lockIn());
    $('btn-again').addEventListener('click', () => { this.buildRoleGrid(); this.show('screen-role'); });
    $('btn-menu').addEventListener('click', () => this.show('screen-menu'));
  }

  buildRoleGrid() {
    const grid = $('role-grid');
    grid.innerHTML = '';
    for (const role of ROLES) {
      const c = document.createElement('div');
      c.className = 'role-card' + (this.sel.role === role ? ' sel' : '');
      c.innerHTML = `<span class="r-ico">${ROLE_ICONS[role]}</span>${role}<small>${ROLE_BLURB[role]}</small>`;
      c.addEventListener('click', () => {
        this.sel.role = role;
        // default spell: Hunt for jungle, Flicker otherwise
        this.sel.spell = role === 'JUNGLE' ? 'hunt' : 'flicker';
        this.buildRoleGrid();
        $('btn-role-next').disabled = false;
      });
      grid.appendChild(c);
    }
    const row = $('spell-row');
    row.innerHTML = '';
    for (const [key, sp] of Object.entries(SPELLS)) {
      const locked = key === 'hunt' && this.sel.role !== 'JUNGLE';
      const chip = document.createElement('button');
      chip.className = 'spell-chip' + (this.sel.spell === key ? ' sel' : '') + (key === 'hunt' ? ' rec' : '');
      chip.innerHTML = `${sp.name}${key === 'hunt' ? ' ★' : ''}<small>${sp.desc}</small>`;
      if (locked) { chip.disabled = true; chip.style.opacity = 0.35; chip.title = 'Jungle role only'; }
      else chip.addEventListener('click', () => { this.sel.spell = key; this.buildRoleGrid(); });
      row.appendChild(chip);
    }
    $('btn-role-next').disabled = !this.sel.role;
  }

  buildHeroGrid() {
    const grid = $('hero-grid');
    grid.innerHTML = '';
    const myRole = this.sel.role;
    for (const id of HERO_LIST) {
      const d = HEROES[id];
      const rec = d.recommendedLane === myRole || d.primaryRole === myRole;
      const card = document.createElement('div');
      card.className = 'hero-card' + (rec ? ' rec' : '') + (this.sel.hero === id ? ' sel' : '');
      card.innerHTML = `<canvas class="h-portrait" width="48" height="48"></canvas><span class="h-name">${d.n}</span><span class="h-role">${d.primaryRole}</span>`;
      card.addEventListener('click', () => { this.sel.hero = id; this.buildHeroGrid(); this.showDetail(id); $('btn-hero-lock').disabled = false; });
      grid.appendChild(card);
      drawPortrait(card.querySelector('canvas').getContext('2d'), id, 24, 24, 22);
    }
    this.renderCompBar();
    $('hero-detail').classList.add('hidden');
    $('btn-hero-lock').disabled = !this.sel.hero;
  }

  showDetail(id) {
    const d = HEROES[id];
    const ab = d.abilities;
    const line = (slot, a) => a ? `<div class="ab-line"><b>${slot.toUpperCase()} · ${a.name}</b> <small>(${a.cd}s${a.mana ? `, ${a.mana} mp` : ''}) — ${a.desc}</small></div>` : '';
    $('hero-detail').innerHTML = `
      <h3>${d.n} — ${d.title}</h3>
      <div class="ab-line"><b>PASSIVE · ${d.passive.name}</b> <small>— ${d.passive.desc}</small></div>
      ${line('1', ab.q)}${line('2', ab.e)}${line('ULT', ab.r)}
      <div class="ab-line"><small>Recommended build: ${(d.build || []).map(b => b).join(' → ')}</small></div>`;
    $('hero-detail').classList.remove('hidden');
    this.renderCompBar();
  }

  renderCompBar() {
    const bar = $('comp-bar');
    const myHero = this.sel.hero;
    const plannedAllies = this.planAllies(myHero);
    bar.innerHTML = '';
    const mk = (label, heroId, enemy, filled) => {
      const s = document.createElement('div');
      s.className = `comp-slot ${enemy ? 'enemy' : ''} ${filled ? 'filled' : ''}`;
      s.innerHTML = (filled && heroId)
        ? `<canvas class="cs-portrait" width="34" height="34"></canvas><span class="cs-hero">${HEROES[heroId].n}</span>`
        : `— ${label} —`;
      bar.appendChild(s);
      if (filled && heroId) drawPortrait(s.querySelector('canvas').getContext('2d'), heroId, 17, 17, 15);
    };
    mk(myRoleLabel(this.sel.role), myHero, false, !!myHero);
    plannedAllies.forEach((h, i) => mk(this.allyRole(this.sel.role, i), h.hero, false, !!h.hero));
    // enemy preview: unknown until match start — show placeholders
    for (let i = 0; i < 5; i++) mk('ENEMY', null, true, false);
    // missing roles hint
    const missing = this.missingRoles(myHero, plannedAllies);
    if (missing.length) {
      const hint = document.createElement('div');
      hint.className = 'comp-slot';
      hint.style.gridColumn = '1 / -1';
      hint.innerHTML = `Team still needs: <b style="color:var(--gold)">${missing.join(', ')}</b> (bots will fill)`;
      bar.appendChild(hint);
    }
  }

  allyRole(myRole, i) {
    const rest = ROLES.filter(r => r !== myRole);
    return rest[i];
  }
  planAllies(myHero) {
    // deterministic preview of bot ally picks so the comp bar is stable while browsing
    const rest = ROLES.filter(r => r !== this.sel.role);
    const used = new Set([myHero].filter(Boolean));
    return rest.map(role => {
      const cand = HERO_LIST.filter(id => !used.has(id) && HEROES[id].recommendedLane === role);
      const pick = cand[0] || HERO_LIST.find(id => !used.has(id));
      if (pick) used.add(pick);
      return { hero: pick, role };
    });
  }
  missingRoles(myHero, allies) {
    const covered = new Set([this.sel.role, ...allies.map(a => a.role)]);
    return ROLES.filter(r => !covered.has(r));
  }

  lockIn() {
    if (!this.sel.hero) return;
    const me = { hero: this.sel.hero, role: this.sel.role, spell: this.sel.spell, name: 'You' };
    const planned = this.planAllies(me.hero).map(a => a.hero);
    this.show('screen-loading');
    let pct = 0;
    $('loading-tip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
    // loading screen roster
    const fill = (el, ids, enemy) => {
      el.innerHTML = '';
      ids.forEach(id => {
        const r = document.createElement('div');
        r.className = 'lt-row';
        r.innerHTML = `<canvas class="lt-portrait" width="26" height="26"></canvas><span>${id ? HEROES[id].n : '???'}</span>`;
        el.appendChild(r);
        if (id) drawPortrait(r.querySelector('canvas').getContext('2d'), id, 13, 13, 12);
      });
    };
    fill($('load-team0'), [me.hero, ...planned]);
    // pick enemies now (visual), the driver will reuse them
    this.enemyPicks = [];
    const usedE = new Set();
    while (this.enemyPicks.length < 5) {
      const id = HERO_LIST[Math.floor(Math.random() * HERO_LIST.length)];
      if (usedE.has(id)) continue;
      usedE.add(id); this.enemyPicks.push(id);
    }
    fill($('load-team1'), this.enemyPicks);
    const t0 = performance.now();
    const iv = setInterval(() => {
      pct = Math.min(100, ((performance.now() - t0) / 1400) * 100);
      $('loading-fill').style.width = pct + '%';
      if (pct >= 100) {
        clearInterval(iv);
        this.startMatch(me, planned, this.enemyPicks, this.diff);
      }
    }, 100);
  }
}

function myRoleLabel(role) { return role || 'YOUR PICK'; }
