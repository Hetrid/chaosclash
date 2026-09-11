// Legend Arena — authoritative fixed-timestep simulation.
// Runs identically in-browser (local/practice), on the Node match server, and in tests.
import { CONFIG } from '../core/config.js';
import { makeRng, dist, clamp, angleTo, moveToward, SpatialGrid, slideCircle, segAabbHit } from '../core/math.js';
import { MAP } from '../map/MapData.js';
import { NAV } from '../map/Nav.js';
import { createHero, tickHero, refreshMax, respawnHero } from '../entities/Hero.js';
import { createMinion, tickMinion, lanePath } from '../entities/Minion.js';
import { createMonster, tickMonster } from '../entities/Monster.js';
import { createStructures, tickTurret, updateStructureVulnerability, updateBackdoor } from '../entities/Turret.js';
import { tickProjectile, createProjectile } from '../entities/Projectile.js';
import { dealDamage, heal, addShield, addGold, tickShields } from './Damage.js';
import { computeStats } from './Stats.js';
import { applyCC, applyBuff, canAct, canMove, canCast, isCCd, ccSlowPct, startRecall, cancelRecall, tickRecall } from './StatusSystem.js';
import { WaveSystem } from '../systems/WaveSystem.js';
import { GoldSystem } from '../systems/GoldSystem.js';
import { XPSystem } from '../systems/XPSystem.js';
import { JungleSystem } from '../systems/JungleSystem.js';
import { ObjectiveSystem } from '../systems/ObjectiveSystem.js';
import { ShopSystem } from '../systems/ShopSystem.js';
import { SurrenderSystem } from '../systems/SurrenderSystem.js';
import { computeVisibility } from '../systems/Vision.js';
import { HEROES, riftBlink } from '../heroes/HeroRegistry.js';
import { kit } from '../heroes/kits.js';
import { BotController } from '../ai/BotController.js';
import { isHero, isMinion, isMonster, isStructure } from '../entities/kinds.js';

const SPELLS = {
  flicker: { name: 'Flicker', cd: 75, desc: 'Blink a short distance toward your target direction.' },
  sprint: { name: 'Sprint', cd: 60, desc: '+42% movement speed for 4s.' },
  vitality: { name: 'Vitality', cd: 75, desc: 'Heal 25% of your max HP and nearby allies for 15%.' },
  purify: { name: 'Purify', cd: 75, desc: 'Remove all crowd control and gain 1s of CC immunity.' },
  hunt: { name: 'Hunt', cd: CONFIG.HUNT_CD, desc: 'Deal massive true damage to a jungle monster or objective. Weaker against heroes.', jungle: true },
};

export class Sim {
  constructor(matchConfig) {
    const seed = matchConfig.seed ?? 1337;
    this.rng = makeRng(seed);
    this.map = MAP;
    this.t = 0; this.tickN = 0; this.dt = CONFIG.SIM_DT;
    this.heroes = []; this.minions = []; this.monsters = []; this.summons = []; this.colossi = [];
    this.projectiles = []; this.areas = []; this.events = [];
    this.grid = new SpatialGrid(CONFIG.WORLD, 256);
    this.structures = createStructures(this);
    this.unitMap = new Map();
    this.matchOver = null;
    this.dynamicWalls = []; // active wall zones (rects)
    this.gold = GoldSystem; this.xp = XPSystem; this.jungle = JungleSystem;
    this.objectives = ObjectiveSystem; this.shop = ShopSystem; this.surrender = SurrenderSystem;
    this.bots = new Map();
    this.snapshotAcc = 0;
    this.dotAcc = 0;

    this.jungle.init(this);
    this.objectives.init(this);
    this.surrender.init(this);
    WaveSystem.init(this);

    NAV.init();

    // spawn heroes
    let i = 0;
    for (const pc of matchConfig.players) {
      const h = createHero(this, {
        heroId: pc.hero, team: pc.team, slot: pc.slot, name: pc.name,
        controller: pc.controller, uid: pc.uid, botLevel: pc.botLevel ?? 2, role: pc.role,
      });
      h.world = this;
      h.spell = pc.spell || (pc.role === 'JUNGLE' ? 'hunt' : 'flicker');
      h.spellDef = SPELLS[h.spell];
      h.cds.spell = 0;
      if (h.spell === 'hunt') h.cds.spell = 5; // small early grace
      this.heroes.push(h);
      this.unitMap.set(h.id, h);
      if (pc.controller === 'bot') this.bots.set(h.id, new BotController(this, h, pc.botLevel ?? 2));
      i++;
    }
    for (const s of this.structures) { s.world = this; this.unitMap.set(s.id, s); }
    updateStructureVulnerability(this);
  }

  // ---------------- event bus ----------------
  emit(ev) { ev.t = this.t; this.events.push(ev); if (this.events.length > 600) this.events.splice(0, this.events.length - 600); }
  drainEvents() { const e = this.events; this.events = []; return e; }
  unitById(id) { return this.unitMap.get(id) || null; }

  register(u) { this.unitMap.set(u.id, u); }

  spawnProjectile(o) {
    const p = createProjectile(this, o);
    this.projectiles.push(p);
    this.emit({ type: 'proj', id: p.id, x: p.x, y: p.y, aim: p.aim, speed: p.speed, range: p.range, color: p.color, size: p.size, hero: o.hero || null, kind: o.kindLabel || 'proj' });
    return p;
  }

  // ---------------- main step ----------------
  step() {
    if (this.matchOver) return;
    const dt = this.dt;
    this.t += dt; this.tickN++;
    this.dt = dt;

    this.grid.clear();
    for (const h of this.heroes) if (!h.dead) this.grid.insert(h);
    for (const m of this.minions) if (!m.dead) this.grid.insert(m);
    for (const m of this.monsters) if (!m.dead) this.grid.insert(m);
    for (const s of this.summons) if (!s.dead) this.grid.insert(s);
    for (const c of this.colossi) if (!c.dead) this.grid.insert(c);

    WaveSystem.tick(this);
    JungleSystem.tick(this, dt);

    // heroes
    for (const h of this.heroes) {
      if (h.def.hooks?.tick) h.def.hooks.tick(this, h, dt);
      tickResource(this, h, dt);
      tickHero(this, h, dt);
      tickBush(this, h);
      this.moveHero(h, dt);
      this.combatTick(h, dt);
    }

    // minions / monsters
    for (const m of this.minions) if (!m.dead) tickMinion(this, m, dt, this.grid);
    for (const m of this.monsters) if (!m.dead) tickMonster(this, m, dt);

    // summons (sentries/mimics)
    this.tickSummons(dt);

    // colossus siege pets
    ObjectiveSystem.tick(this);

    // movement + separation for non-hero units
    for (const m of this.minions) if (!m.dead) this.moveUnit(m, dt);
    for (const m of this.monsters) if (!m.dead) this.moveUnit(m, dt);

    // bots
    for (const bot of this.bots.values()) bot.tick();

    // structures
    for (const s of this.structures) {
      if (s.kind === 'turret') tickTurret(this, s, dt);
      else if (s.kind === 'core' && !s.dead) tickTurret(this, s, dt);
    }
    updateStructureVulnerability(this);
    updateBackdoor(this);

    // projectiles
    for (const p of this.projectiles) tickProjectile(this, p, dt);
    this.projectiles = this.projectiles.filter(p => !p.dead);

    // areas (zones, walls, telegraphs, traps)
    this.tickAreas(dt);

    // economy
    GoldSystem.tick(this, dt);
    this.dotAcc += dt;
    if (this.dotAcc >= 0.5) { this.tickDoTs(); this.dotAcc = 0; }

    // fountain safety laser
    for (const h of this.heroes) {
      if (h.dead) continue;
      for (const team of [0, 1]) {
        if (h.team === team) continue;
        const [fx, fy] = MAP.fountain[team];
        if (dist(h.x, h.y, fx, fy) < 400) dealDamage(this, { src: null, tgt: h, amount: CONFIG.FOUNTAIN_DPS * dt, dtype: 'true', category: 'fountain', kindLabel: 'fountain', noOnHit: true });
      }
    }

    // cleanup dead
    if (this.tickN % 10 === 0) this.reapDead();

    // surrender
    SurrenderSystem.tick(this);

    // win check
    if (!this.matchOver) {
      const core0 = this.structures.find(s => s.kind === 'core' && s.team === 0);
      const core1 = this.structures.find(s => s.kind === 'core' && s.team === 1);
      if (core0?.dead) this.matchOver = { winner: 1, reason: 'core' };
      else if (core1?.dead) this.matchOver = { winner: 0, reason: 'core' };
    }
  }

  reapDead() {
    this.minions = this.minions.filter(m => !m.dead);
    this.summons = this.summons.filter(s => !s.dead);
    this.colossi = this.colossi.filter(c => !c.dead);
    // monsters stay (corpse VFX time) then removed
    this.monsters = this.monsters.filter(m => !m.dead || this.t - m.deathT < 1.5);
    for (const m of this.monsters) if (m.dead) this.unitMap.delete(m.id);
  }

  // ---------------- movement ----------------
  walls() { return this.dynamicWalls.length ? this.dynamicWalls : null; }

  moveHero(h, dt) {
    if (h.dead) return;
    if (h.dashing) return; // dash system in tickHero moves
    if (isCCd(h, 'stun', 'freeze', 'knockup', 'root')) { this.knockMove(h, dt); return; }
    this.knockMove(h, dt);
    if (h.cc.knock) return;
    if (!h.moveIntent || !canMove(h)) return;
    const slow = ccSlowPct(h);
    let ms = (h.stats?.ms || 240) * (1 - slow);
    // recall is cancelled by movement
    if (h.recall) cancelRecall(this, h, 'move');
    const [tx, ty] = h.moveIntent;
    if (dist(h.x, h.y, tx, ty) < 6) { h.moveIntent = null; return; }
    h.aim = angleTo(h.x, h.y, tx, ty);
    let [nx, ny] = moveToward(h.x, h.y, tx, ty, ms * dt);
    [nx, ny] = this.collide(h, nx, ny);
    h.x = nx; h.y = ny;
    h.lastMoveT = this.t;
  }

  knockMove(u, dt) {
    const k = u.cc?.knock;
    if (!k) return;
    const remain = (k.until - this.t);
    const total = 0.45;
    const step = k.dist * (dt / total);
    let nx = u.x + k.dirX * step, ny = u.y + k.dirY * step;
    [nx, ny] = this.collide(u, nx, ny);
    u.x = nx; u.y = ny;
  }

  collide(u, nx, ny) {
    const dyn = this.dynamicWalls;
    const walls = dyn.length ? [...MAP.walls, ...dyn] : MAP.walls;
    const [x1, y1] = slideCircle(nx, ny, u.r, walls);
    // world bounds
    return [clamp(x1, u.r + 8, CONFIG.WORLD - u.r - 8), clamp(y1, u.r + 8, CONFIG.WORLD - u.r - 8)];
  }

  moveUnit(u, dt) {
    if (u.dead) return;
    const t = u.moveTarget;
    if (t) {
      let ms = u.ms * (1 - 0); // minions/monsters not slowed (keeps sim cheap)
      let [nx, ny] = moveToward(u.x, u.y, t[0], t[1], ms * dt);
      [nx, ny] = this.collide(u, nx, ny);
      u.x = nx; u.y = ny;
    }
    // soft separation vs neighbors
    let px = 0, py = 0, n = 0;
    this.grid.query(u.x, u.y, u.r + 26, o => {
      if (o === u || o.dead || o.kind === 'monster') return;
      const d2v = (u.x - o.x) * (u.x - o.x) + (u.y - o.y) * (u.y - o.y);
      const min = u.r + o.r;
      if (d2v < min * min && d2v > 0.01) {
        const d = Math.sqrt(d2v);
        px += (u.x - o.x) / d * (min - d); py += (u.y - o.y) / d * (min - d); n++;
      }
    });
    if (n) {
      const [sx, sy] = this.collide(u, u.x + px * 0.35, u.y + py * 0.35);
      u.x = sx; u.y = sy;
    }
  }

  // soft separation so units don't stack
  separate() {
    // applied for minions only every few ticks from step() when needed — omitted for perf (grid push handles visuals)
  }

  // ---------------- combat ----------------
  combatTick(h, dt) {
    if (h.dead || !canAct(h)) return;
    let target = h.attackTarget;
    // auto acquire
    const range = (h.stats?.attackRange || 120);
    if (!target || target.dead || dist(h.x, h.y, target.x, target.y) - (target.r || 30) > range + 20 || target.invulnUntil > this.t) {
      target = this.acquireAttackTarget(h, range);
      h.attackTarget = target;
    }
    if (!target) return;
    const d = dist(h.x, h.y, target.x, target.y) - (target.r || 30);
    h.aim = angleTo(h.x, h.y, target.x, target.y);
    if (d > range) return;
    if (h.atkCd > 0 || h.castLock > 0 || h.dashing || h.channeling) return;
    this.basicAttack(h, target);
  }

  acquireAttackTarget(h, range) {
    if (h.autoAttack === false) return null;
    let best = null, bs = -1e9;
    const wantHeroes = h.targetMode !== 'minion';
    this.grid.query(h.x, h.y, range + 60, u => {
      if (u.dead || u.team === h.team || u.invulnUntil > this.t) return;
      const d = dist(h.x, h.y, u.x, u.y) - (u.r || 30);
      if (d > range) return;
      let score = -d;
      if (u.kind === 'hero') score += wantHeroes ? 500 : 150;
      else if (u.kind === 'minion') score += wantHeroes ? -200 : 100;
      else if (u.kind === 'summon') score += wantHeroes ? -150 : 50;
      else if (u.kind === 'monster') score += wantHeroes ? 0 : 40;
      if (score > bs) { bs = score; best = u; }
    });
    // structures when in range and mode allows
    if (h.targetMode !== 'minion') {
      for (const s of this.structures) {
        if (s.dead || s.team === h.team || s.invulnerable) continue;
        const d = dist(h.x, h.y, s.x, s.y) - s.r;
        if (d > range) continue;
        const score = (h.targetMode === 'turret' ? 800 : -300) - d;
        if (score > bs) { bs = score; best = s; }
      }
    }
    return best;
  }

  basicAttack(h, target) {
    const s = h.stats;
    h.atkCd = 1 / s.aspd;
    let dmg = s.physAtk;
    // amp hooks
    let mult = 1;
    const buff = h.buffs.find(b => b.data?.nextBasicAmp);
    if (buff) { mult += buff.data.nextBasicAmp; buff.data.nextBasicAmp = 0; }
    if (h.buffs.some(b => b.id === 'phaseedge')) { mult += 0.3; this.removeBuffById(h, 'phaseedge'); }
    if (h.buffs.some(b => b.id === 'deadeye')) mult += 0;
    // verity pressure
    const press = h.def.hooks?.onBasicHit?.(this, h, target);
    if (typeof press === 'number') mult += press;
    // phantom nightstalker handled via hook (adds separate damage)
    const dealt = dealDamage(this, {
      src: h, tgt: target, amount: dmg * mult, dtype: 'phys', category: 'basic',
      canCrit: true, kindLabel: 'basic', melee: !h.def.atk?.proj,
    });
    h.def.hooks?.onBasicHit2?.(this, h, target);
    h.lastRevealAt = this.t; // attacking reveals bush campers
    // aggro bookkeeping (minion/turret defense rules)
    if (target.kind === 'hero') { target.lastAttackedAllyHero = h; target.lastAttackedAllyHeroT = this.t; target.lastAttackedAllyHeroTeam = h.team; }
    h.lastCombat = this.t; if (target.lastCombat !== undefined) { target.lastCombat = this.t; }
    if (h.def.atk?.proj) {
      kit.proj(this, h, {
        aim: angleTo(h.x, h.y, target.x, target.y), x: h.x, y: h.y - 12,
        speed: h.def.atk.proj.speed, range: d_range(h, target), radius: 14,
        dmg: 0, dtype: 'phys', category: 'projVisual', kindLabel: 'basic', color: h.def.atk.proj.color, size: h.def.atk.proj.size || 1,
        homing: target.id, canCrit: false,
      });
      // visual projectile deals no damage (damage already applied instantly for responsiveness);
      // homing visual only. Melee applies instantly above.
    } else {
      this.emit({ type: 'meleeAtk', x: h.x, y: h.y, tx: target.x, ty: target.y, id: h.id });
    }
    // track deal for lifesteal timing consistency: lifesteal applied inside dealDamage
    h.lastCombat = this.t;
  }

  removeBuffById(u, id) {
    const i = u.buffs.findIndex(b => b.id === id);
    if (i >= 0) u.buffs.splice(i, 1);
  }

  // ---------------- casting ----------------
  castAbility(h, slot, aim = {}) {
    if (this.matchOver) return false;
    if (h.dead || !canCast(h)) return false;
    if (h.castLock > 0 || h.dashing) return false;
    // luxa encore: free dashes
    const ab = h.def.abilities[slot];
    if (!ab) return false;
    if (slot === 'e' && h.heroId === 'luxa' && h.buffs.some(b => b.id === 'encore')) {
      if ((h.custom.encoreNext || 0) > this.t) return false;
      h.custom.encoreNext = this.t + 0.8;
    } else {
      if (h.cds[slot] > 0) return false;
      if (ab.mana && h.mana < ab.mana) return false;
    }
    // rift recast window
    if (h.heroId === 'rift' && slot === 'r' && h.custom.rift && h.custom.rift.charges > 0 && this.t < h.custom.rift.until) {
      if (!riftBlink(this, h, aim)) return false;
      return true;
    }
    // validate aim
    const range = ab.range || 500;
    let ax = aim.x ?? h.x, ay = aim.y ?? h.y;
    if (ab.aim === 'target' || ab.aim === 'ally') {
      const t = ab.aim === 'ally' ? (aim.ally || h) : (aim.target || this.nearestHeroEnemy(h, range));
      if (!t || t.dead) return false;
      if (ab.aim === 'target' && dist(h.x, h.y, t.x, t.y) > range * 1.15) return false;
      aim.target = t; aim.ally = t;
      ax = t.x; ay = t.y;
    } else if (ab.aim !== 'self') {
      const d = dist(h.x, h.y, ax, ay);
      if (ab.aim === 'dir') { if (d < 30) { ax = h.x + Math.cos(h.aim) * 100; ay = h.y + Math.sin(h.aim) * 100; } }
      else if (d > range) { const k = range / d; ax = h.x + (ax - h.x) * k; ay = h.y + (ay - h.y) * k; }
    }
    const result = ab.cast(this, h, { ...aim, x: ax, y: ay });
    if (result === false) return false;
    if (ab.mana) h.mana -= ab.mana;
    // cooldown (rift charges window keeps r ready)
    if (!(h.heroId === 'rift' && slot === 'r' && h.custom.rift && h.custom.rift.charges > 0)) {
      h.cds[slot] = ab.cd * (1 - (h.stats?.cdr || 0));
    } else {
      h.cds[slot] = 0.3;
    }
    h.castLock = slot === 'r' ? 0.22 : 0.12;
    h.recall = null;
    h.lastCombat = this.t;
    h.lastRevealAt = this.t;
    this.emit({ type: 'cast', id: h.id, hero: h.heroId, slot, x: h.x, y: h.y, tx: ax, ty: ay });
    return true;
  }

  nearestHeroEnemy(h, range) {
    let best = null, bd = range;
    for (const e of this.heroes) {
      if (e.team === h.team || e.dead) continue;
      const d = dist(h.x, h.y, e.x, e.y);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  castSpell(h, aim = {}) {
    if (this.matchOver || h.dead || h.cds.spell > 0) return false;
    const sp = h.spell;
    if (sp !== 'purify' && !canCast(h)) return false;
    switch (sp) {
      case 'flicker': {
        let tx = aim.x ?? h.x, ty = aim.y ?? h.y;
        kit.blink(this, h, tx, ty, 360);
        break;
      }
      case 'sprint': applyBuff(this, h, { id: 'sprint', until: this.t + 4, stats: { ms: h.stats.ms * 0.42 }, icon: 'sprint' }); break;
      case 'vitality': {
        heal(this, h, h.maxHp * 0.25, 'vitality', h);
        for (const a of this.heroes) if (a.team === h.team && a !== h && !a.dead && dist(a.x, a.y, h.x, h.y) < 520) heal(this, a, a.maxHp * 0.15, 'vitality', h);
        break;
      }
      case 'purify': {
        for (const k in h.cc) delete h.cc[k];
        h.ccImmuneUntil = this.t + 1.0;
        this.emit({ type: 'purify', id: h.id });
        break;
      }
      case 'hunt': {
        const t = aim.target || this.nearestMonsterNear(aim.x ?? h.x, aim.y ?? h.y, 300);
        JungleSystem.castHunt(this, h, t);
        this.emit({ type: 'castSpell', id: h.id, spell: sp, x: h.x, y: h.y });
        return true;
      }
    }
    h.cds.spell = (SPELLS[sp]?.cd || 60) * (1 - (h.stats?.cdr || 0) * 0.5);
    this.emit({ type: 'castSpell', id: h.id, spell: sp, x: h.x, y: h.y });
    return true;
  }

  nearestMonsterNear(x, y, r) {
    let best = null, bd = r;
    for (const m of this.monsters) {
      if (m.dead || !m.objective && m.campId?.startsWith('obj')) continue;
      const d = dist(x, y, m.x, m.y);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }

  startRecall(h) { return startRecall(this, h); }

  // ---------------- areas ----------------
  tickAreas(dt) {
    const now = this.t;
    for (let i = this.areas.length - 1; i >= 0; i--) {
      const a = this.areas[i];
      if (a.wall) {
        if (now >= a.until) { this.areas.splice(i, 1); this.rebuildDynamicWalls(); }
        continue;
      }
      if (a.trap) { a.check?.(this, a); if (now >= a.until) this.areas.splice(i, 1); continue; }
      if (a.armAt !== undefined && now >= a.armAt && !a.armed) {
        a.armed = true;
        a.onArm?.(this, a);
        if (!a.zone) { this.areas.splice(i, 1); continue; }
      }
      if (a.zone) {
        if (a.follow) { a.x = a.follow.x; a.y = a.follow.y; }
        if (now >= a.next) {
          a.next = now + (a.every || 0.5);
          this.zonePulse(a);
        }
        if (now >= a.until) { a.onExpire?.(this, a); this.areas.splice(i, 1); }
      } else if (now >= a.until) this.areas.splice(i, 1);
    }
  }

  zonePulse(a) {
    const src = a.src;
    if (a.dmg) {
      for (const t of kit.enemiesInRadius(this, src || { team: a.team, x: a.x, y: a.y, dead: false }, a.x, a.y, a.r, {})) {
        if (t.invulnUntil > this.t || t.team === a.team) continue;
        dealDamage(this, { src: src || null, tgt: t, amount: a.dmg, dtype: a.dtype || 'magic', category: 'dot', kindLabel: a.hero + 'zone', noOnHit: false });
        if (a.slow) applyCC(this, t, 'slow', a.slowDur || 0.6, { pct: a.slow });
        if (a.sil) applyCC(this, t, 'silence', a.sil, {});
        if (a.pull) kit.pullToward(this, t, a.x, a.y, a.pull * (a.every || 0.5), a.every || 0.5);
        a.per?.(this, src, t);
      }
    }
    if (a.heal || a.shield) {
      for (const o of this.heroes) {
        if (o.team !== a.team || o.dead) continue;
        if (dist(o.x, o.y, a.x, a.y) > a.r) continue;
        if (a.heal) heal(this, o, a.heal, 'zone', src);
        if (a.shield) addShield(this, o, a.shield, 1.5, 'zone');
      }
    }
  }

  rebuildDynamicWalls() {
    this.dynamicWalls = this.areas.filter(a => a.wall && this.t < a.until).map(a => a.rect);
  }

  tickSummons(dt) {
    for (const s of this.summons) {
      if (s.dead) continue;
      s.life -= dt;
      s.atkCd = Math.max(0, s.atkCd - dt);
      s.retarget -= dt;
      if (s.life <= 0) { s.dead = true; this.emit({ type: 'summonEnd', id: s.id }); continue; }
      if (s.retarget <= 0) {
        s.retarget = 0.4;
        s.target = null;
        let bd = s.range + 60;
        this.grid.query(s.x, s.y, bd, u => {
          if (u.dead || u.team === s.team || u.invulnUntil > this.t) return;
          const d = dist(s.x, s.y, u.x, u.y);
          if (d < bd) { bd = d; s.target = u; }
        });
      }
      const t = s.target;
      if (t && !t.dead) {
        const d = dist(s.x, s.y, t.x, t.y) - (t.r || 30);
        if (d <= s.range) {
          if (s.atkCd <= 0) {
            s.atkCd = 1 / s.aspd;
            if (s.melee) dealDamage(this, { src: s, tgt: t, amount: s.dmg, dtype: s.magic ? 'magic' : 'phys', category: 'summon', kindLabel: s.subtype, melee: true });
            else {
              kit.proj(this, s.owner || { def: { c1: '#f59e0b' }, team: s.team, id: s.id }, { aim: angleTo(s.x, s.y, t.x, t.y), x: s.x, y: s.y, speed: 900, range: s.range + 100, radius: 12, dmg: 0, dtype: 'phys', category: 'projVisual', kindLabel: 'sentry', color: '#fbbf24', size: 0.7, homing: t.id });
              dealDamage(this, { src: s, tgt: t, amount: s.dmg, dtype: s.magic ? 'magic' : 'phys', category: 'summon', kindLabel: s.subtype });
            }
          }
        } else if (!s.stationary) {
          const [nx, ny] = moveToward(s.x, s.y, t.x, t.y, 200 * dt);
          const [cx, cy] = this.collide(s, nx, ny);
          s.x = cx; s.y = cy;
        }
      } else if (s.owner && !s.stationary && dist(s.x, s.y, s.owner.x, s.owner.y) > 500) {
        const [nx, ny] = moveToward(s.x, s.y, s.owner.x, s.owner.y, 220 * dt);
        const [cx, cy] = this.collide(s, nx, ny);
        s.x = cx; s.y = cy;
      }
      if (s.hp <= 0 && !s.dead) { s.dead = true; this.emit({ type: 'summonEnd', id: s.id }); }
    }
    this.summons = this.summons.filter(s => !s.dead);
  }

  // ---------------- damage over time buffs ----------------
  tickDoTs() {
    for (const u of [...this.heroes, ...this.minions, ...this.monsters, ...this.summons]) {
      if (u.dead || !u.buffs) continue;
      for (const b of u.buffs) {
        if (b.id === 'scorched' && this.t >= (b.data.tickAt || 0)) {
          b.data.tickAt = this.t + 0.5;
          const src = this.unitById(b.data.owner);
          if (src) dealDamage(this, { src, tgt: u, amount: b.data.dmg * 0.5, dtype: 'magic', category: 'dot', kindLabel: 'scorched' });
        }
        if (b.id === 'corruption' && this.t >= (b.data.tickAt || 0)) {
          b.data.tickAt = this.t + 0.5;
          const src = this.unitById(b.data.owner);
          if (src) dealDamage(this, { src, tgt: u, amount: b.data.dmg * 0.5, dtype: 'phys', category: 'dot', kindLabel: 'corruption' });
        }
      }
    }
  }

  // ---------------- input application (clients/host) ----------------
  applyInput(hero, input) {
    if (!hero || hero.dead) return;
    if (input.move) hero.moveIntent = [clamp(input.move.x, 40, CONFIG.WORLD - 40), clamp(input.move.y, 40, CONFIG.WORLD - 40)];
    else if (input.move === null) hero.moveIntent = null;
    if (input.aim) hero.aim = Math.atan2(input.aim.y - hero.y, input.aim.x - hero.x);
    if (input.attackTargetId !== undefined) {
      const t = this.unitById(input.attackTargetId) || this.structures.find(s => s.id === input.attackTargetId);
      if (t) hero.attackTarget = t;
    }
    if (input.targetMode) hero.targetMode = input.targetMode;
    if (input.cast) this.castAbility(hero, input.cast.slot, input.cast);
    if (input.spell) this.castSpell(hero, input.spell);
    if (input.recall) this.startRecall(hero);
    if (input.stopRecall) hero.recall = null;
    if (input.autoAttack !== undefined) hero.autoAttack = input.autoAttack;
    if (input.shopBuy && input.shopBuy.ok !== false) ShopSystem.buy(this, hero, input.shopBuy.item);
    if (input.shopSell !== undefined) ShopSystem.sell(this, hero, input.shopSell);
    if (input.surrenderStart) SurrenderSystem.start(this, hero);
    if (input.surrenderVote !== undefined) SurrenderSystem.vote(this, hero, input.surrenderVote);
  }

  // ---------------- snapshots (network) ----------------
  snapshot(viewerTeam) {
    const vis = computeVisibility(this);
    const packHero = h => ({
      i: h.id, hi: h.heroId, tm: h.team, x: Math.round(h.x), y: Math.round(h.y), a: +h.aim.toFixed(2),
      hp: Math.round(h.hp), mhp: h.maxHp, sh: Math.round(h.shield), lv: h.level,
      d: h.dead ? 1 : 0, sl: h.slot, nm: h.name, k: h.kills, de: h.deaths, as: h.assists,
      g: Math.round(h.gold), rg: h.custom.rage ?? undefined, mp: h.maxMana ? Math.round(h.mana) : undefined,
      cds: [+(h.cds.q).toFixed(1), +(h.cds.e).toFixed(1), +(h.cds.r).toFixed(1), +(h.cds.spell).toFixed(1)],
      rc: h.recall ? 1 : 0, dash: h.dashing ? [Math.round(h.dashing.x1), Math.round(h.dashing.y1)] : undefined,
      ch: h.channeling ? 1 : undefined, b: h.buffs.map(b => b.id).slice(0, 8),
    });
    const snap = {
      tick: this.tickN, t: +this.t.toFixed(2), ev: this.drainEvents(),
      heroes: this.heroes.map(packHero),
      minions: this.minions.filter(m => !m.dead).slice(0, 120).map(m => ({ i: m.id, x: Math.round(m.x), y: Math.round(m.y), tm: m.team, hp: Math.round(m.hp), mhp: m.maxHp, mt: m.mtype[0] })),
      projs: this.projectiles.filter(p => !p.dead && p.category !== 'projVisual').slice(0, 80).map(p => ({ i: p.id, x: Math.round(p.x), y: Math.round(p.y), tm: p.team, c: p.color, s: p.size })),
      monsters: this.monsters.filter(m => !m.dead).map(m => ({ i: m.id, x: Math.round(m.x), y: Math.round(m.y), k: m.mkind, hp: Math.round(m.hp), mhp: m.maxHp, obj: m.objective || undefined })),
      summons: this.summons.filter(s => !s.dead).map(s => ({ i: s.id, x: Math.round(s.x), y: Math.round(s.y), tm: s.team, st: s.subtype })),
      cols: this.colossi.filter(c => !c.dead).map(c => ({ i: c.id, x: Math.round(c.x), y: Math.round(c.y), tm: c.team, hp: Math.round(c.hp), mhp: c.maxHp })),
      areas: this.areas.slice(0, 60).map(a => ({ x: Math.round(a.x || 0), y: Math.round(a.y || 0), r: a.r || 0, u: +(a.until - this.t).toFixed(1), tm: a.team, v: a.visual || (a.wall ? 'wall' : a.trap ? 'trap' : 'zone'), c: a.color })),
      structs: this.structures.map(s => ({ i: s.id, hp: Math.round(s.hp), mhp: s.maxHp, d: s.dead ? 1 : 0, inv: s.invulnerable ? 1 : 0, prot: s.backdoorProtected ? 1 : 0 })),
      obj: {
        shell: this.objectiveState.shell.alive ? 1 : (this.objectiveState.shell.nextAt - this.t > 0 ? +Math.max(0, this.objectiveState.shell.nextAt - this.t).toFixed(0) : 0),
        colossus: this.objectiveState.colossus.alive ? 1 : +Math.max(0, this.objectiveState.colossus.nextAt - this.t).toFixed(0),
      },
      vis: { [0]: [...vis[0]], [1]: [...vis[1]] },
      sur: this.surrState.active ? { team: this.surrState.team, by: this.surrState.by, endsAt: +this.surrState.endsAt.toFixed(1), yes: Object.values(this.surrState.votes).filter(Boolean).length } : null,
      over: this.matchOver || null,
      waves: this.waveNum || 0, nextWave: +Math.max(0, this.nextWaveAt - this.t).toFixed(0),
    };
    return snap;
  }
}

// helpers -----------------------------------------------------------------
function d_range(h, target) { return Math.max(200, dist(h.x, h.y, target.x, target.y) + 80); }

function tickBush(world, h) {
  const b = bushAtPos(h.x, h.y);
  h.inBush = !!b;
  h.bushId = b ? b.id : null;
}
let BUSHES = null;
function bushAtPos(x, y) {
  if (!BUSHES) BUSHES = MAP.bushes;
  for (let i = 0; i < BUSHES.length; i++) {
    const b = BUSHES[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
  }
  return null;
}

function tickResource(world, h, dt) {
  if (h.def.resource === 'rage') {
    const c = h.custom;
    if (world.t - h.lastCombat > 4) c.rage = Math.max(0, (c.rage || 0) - 16 * dt);
    c.rage = clamp(c.rage || 0, 0, 100);
  }
}



export { SPELLS };
