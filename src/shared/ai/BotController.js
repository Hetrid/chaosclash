// Legend Arena — bot AI: role-based state machines with difficulty tiers.
// Bots think at a low rate; movement execution happens every sim tick.
import { LANES, MAP } from '../map/MapData.js';
import { NAV } from '../map/Nav.js';
import { dist, clamp, angleTo } from '../core/math.js';
import { kit } from '../heroes/kits.js';
import { hasBuff } from '../game/StatusSystem.js';
import { CONFIG } from '../core/config.js';

const DIFF = {
  1: { think: 0.55, aimErr: 70, react: 0.65, skill: 0.55, retreat: 0.46, predict: 0, dive: 0.2, obj: 0.4, huntMargin: 0.55 },
  2: { think: 0.35, aimErr: 34, react: 0.35, skill: 0.85, retreat: 0.38, predict: 0.5, dive: 0.5, obj: 0.75, huntMargin: 0.85 },
  3: { think: 0.22, aimErr: 12, react: 0.15, skill: 1.0, retreat: 0.3, predict: 1, dive: 0.8, obj: 0.95, huntMargin: 1.05 },
};

export class BotController {
  constructor(world, hero, level = 2) {
    this.world = world; this.h = hero; this.lv = level;
    this.d = DIFF[clamp(level, 1, 3)];
    this.state = 'LANE';
    this.nextThink = world.t + world.rng.f() * 0.3;
    this.lane = this.roleLane();
    this.path = null; this.pathI = 0;
    this.retreatUntil = 0; this.reactUntil = 0;
    this.jungleRoute = this.buildJungleRoute();
    this.routeI = 0;
    this.campFocus = null;
    this.voteRoll = world.rng.f();
    this.lastSkillAt = 0;
    this.repathAt = 0;
  }
  roleLane() {
    return { MID: 'MID', GOLD: 'BOT', EXP: 'TOP', JUNGLE: 'MID', ROAM: 'BOT' }[this.h.aiRole] || 'MID';
  }
  buildJungleRoute() {
    const my = this.h.team;
    const camps = MAP.camps.filter(c => c.team === my);
    const order = ['ember', 'hound', 'azure', 'sprite'];
    const pts = [];
    for (const kind of order) { const c = camps.find(x => x.kind === kind); if (c) pts.push([c.x, c.y, c.id]); }
    return pts;
  }

  think() {
    const w = this.world, h = this.h;
    if (h.dead) { this.state = 'DEAD'; return; }
    this.state = this.evaluateState();
    const enemies = this.enemiesNear(900);
    const allies = this.alliesNear(900);

    switch (this.state) {
      case 'DEFEND': this.doDefend(); break;
      case 'FIGHT': this.doFight(enemies, allies); break;
      case 'RETREAT': this.doRetreat(); break;
      case 'OBJECTIVE': this.doObjective(); break;
      case 'GANK': this.doGank(); break;
      case 'JUNGLE': this.doJungle(); break;
      case 'RECALL': this.doRecall(); break;
      case 'PUSH': this.doPush(); break;
      case 'GROUP': this.doGroup(); break;
      case 'TURRETFLEE': this.doTurretFlee(); break;
      default: this.doLane();
    }
  }

  evaluateState() {
    const w = this.world, h = this.h;
    const hpPct = h.hp / h.maxHp;
    const enemies = this.enemiesNear(820);
    const allyCount = this.alliesNear(820).length;
    // snowballing teams push through turret fire instead of dancing at the line
    const myKills = w.heroes.filter(x => x.team === h.team).reduce((a, x) => a + x.kills, 0);
    const theirKills = w.heroes.filter(x => x.team !== h.team).reduce((a, x) => a + x.kills, 0);
    const snowball = myKills - theirKills >= 12;
    // base / turret defense override
    const [cx, cy] = MAP.core[h.team];
    if (this.enemyNearPoint(cx, cy, 1100) && enemies.length) return 'DEFEND';
    if (this.allyTurretUnderThreat() && enemies.length) return 'DEFEND';
    // hard anti-dive: never stand alone under enemy turret fire; back off when chewed even with a wave
    {
      const et = this.turretNear(h.x, h.y, 1 - h.team, CONFIG.TURRET_RANGE);
      if (et) {
        const wave = w.minions.filter(m => !m.dead && m.team === h.team && dist(m.x, m.y, et.x, et.y) < 560).length;
        const beingShot = h.lastTurretHitT !== undefined && w.t - h.lastTurretHitT < 0.9;
        const diveOk = snowball || this.d.dive >= 0.7;
        if ((wave === 0 && !diveOk) || (beingShot && hpPct < 0.45 && !snowball)) return 'TURRETFLEE';
      }
    }
    // shopping rotation (healthy, safe, rich)
    if (this.shopNeeded() && !enemies.length && hpPct > 0.45 && !h.recall) return 'RECALL';
    // team objective focus window
    if (w.objectiveFocus && w.t < w.objectiveFocus.until) {
      const m = w.unitById(w.objectiveFocus.monsterId);
      if (m && !m.dead && w.rng.chance(this.d.obj * 0.8)) return 'OBJECTIVE';
    }
    // retreat
    const fighting = enemies.length > 0;
    const brave = h.aiRole === 'ROAM' || h.def.archetype === 'tank' ? 0.1 : 0;
    if (hpPct < this.d.retreat + brave && (fighting || this.threatNear())) return 'RETREAT';
    if (hpPct < 0.3 && !fighting) return 'RECALL';
    // ace → push
    const enemiesAllDead = w.heroes.every(e => e.team === h.team || e.dead);
    if (enemiesAllDead) return 'PUSH';
    // late game: group and siege
    if (this.lateGame() && !h.recall) return 'GROUP';
    // objective contest
    const obj = this.objectiveOpportunity();
    if (obj) return 'OBJECTIVE';
    // team fight (don't brawl while hurt unless we outnumber)
    if (enemies.length >= 2 && allyCount >= 1 && (hpPct > 0.55 || allyCount > enemies.length)) return 'FIGHT';
    if (h.aiRole === 'JUNGLE') return 'JUNGLE';
    // push with wave advantage
    if (this.waveAdvantage() && !enemies.length) return 'PUSH';
    // or siege an enemy turret my wave is already hitting, when the lane is clear
    if (!enemies.length && hpPct > 0.55) {
      const st = w.structures.find(s2 => s2.team !== h.team && !s2.dead && !s2.invulnerable && s2.kind !== 'core'
        && dist(h.x, h.y, s2.x, s2.y) < 760
        && w.minions.filter(m => !m.dead && m.team === h.team && dist(m.x, m.y, s2.x, s2.y) < CONFIG.BACKDOOR_RADIUS).length >= 3);
      if (st) return 'PUSH';
    }
    return 'LANE';
  }
  lateGame() {
    const w = this.world, h = this.h;
    if (w.t > 14 * 60) return true;
    // or when ahead on structures
    const mine = w.structures.filter(s2 => s2.team !== h.team && s2.dead).length;
    const theirs = w.structures.filter(s2 => s2.team === h.team && s2.dead).length;
    return mine - theirs >= 3;
  }
  groupTarget() {
    // push the most-open enemy lane: structures destroyed there, then lowest remaining tier
    const w = this.world, h = this.h;
    const alive = w.structures.filter(s2 => s2.team !== h.team && !s2.dead && !s2.invulnerable);
    if (!alive.length) {
      const core = w.structures.find(s2 => s2.kind === 'core' && s2.team !== h.team);
      return core;
    }
    let best = null, bs = -1e9;
    for (const s2 of alive) {
      const opened = w.structures.filter(x => x.team !== h.team && x.dead && x.lane === s2.lane).length;
      let wave = 0;
      w.grid.query(s2.x, s2.y, CONFIG.BACKDOOR_RADIUS, u => { if (u.kind === 'minion' && u.team === h.team) wave++; });
      const tierScore = s2.tier === 1 ? 70 : s2.tier === 2 ? 45 : 20;
      const score = opened * 130 + tierScore + wave * 2 - dist(h.x, h.y, s2.x, s2.y) * 0.03;
      if (score > bs) { bs = score; best = s2; }
    }
    return best;
  }
  allyTurretUnderThreat() {
    const w = this.world;
    for (const s of w.structures) {
      if (s.kind !== 'turret' || s.team !== this.h.team || s.dead) continue;
      if (s.hp < s.maxHp * 0.92 && this.enemyNearPoint(s.x, s.y, 800)) return true;
    }
    return false;
  }

  // ---------- helpers ----------
  enemiesNear(r) {
    const out = [];
    for (const u of [...this.world.heroes]) {
      if (u.team === this.h.team || u.dead) continue;
      if (dist(this.h.x, this.h.y, u.x, u.y) < r) out.push(u);
    }
    return out;
  }
  alliesNear(r) {
    return this.world.heroes.filter(u => u.team === this.h.team && u !== this.h && !u.dead && dist(this.h.x, this.h.y, u.x, u.y) < r);
  }
  enemyNearPoint(x, y, r) {
    return this.world.heroes.some(u => u.team !== this.h.team && !u.dead && dist(u.x, u.y, x, y) < r);
  }
  threatNear() {
    for (const t of [...this.world.heroes, ...this.world.structures]) {
      if (t.team === this.h.team || t.dead) continue;
      if (dist(this.h.x, this.h.y, t.x, t.y) < (t.range || 300) + 140) return true;
    }
    return false;
  }
  shopNeeded() {
    const next = this.world.shop.nextPurchase(this.world, this.h);
    return !!next && this.h.gold > 900 && this.h.items.length < 6;
  }
  objectiveOpportunity() {
    const w = this.world, h = this.h;
    for (const which of ['shell', 'colossus']) {
      const st = w.objectiveState[which];
      if (!st.alive || !st.monsterId) continue;
      const m = w.unitById(st.monsterId);
      if (!m || m.dead) continue;
      const d = dist(h.x, h.y, m.x, m.y);
      if (h.aiRole === 'JUNGLE') {
        if (w.rng.chance(this.d.obj * 0.9) && d < 3400) return m;
        continue;
      }
      const alliesOnIt = w.heroes.filter(x => x.team === h.team && x !== h && !x.dead && dist(x.x, x.y, m.x, m.y) < 1000).length;
      if (w.rng.f() > this.d.obj) continue;
      if (alliesOnIt >= 2 || (alliesOnIt >= 1 && d < 1200)) {
        const myHp = this.teamHp(h.team), enHp = this.teamHp(1 - h.team);
        if (myHp > enHp * 0.75) return m;
      }
    }
    return null;
  }
  teamStrength(x, y, team) {
    return this.world.heroes.filter(h2 => h2.team === team && !h2.dead && dist(h2.x, h2.y, x, y) < 1400).length;
  }
  teamHp(team) {
    let s = 0;
    for (const h2 of this.world.heroes) if (h2.team === team && !h2.dead) s += h2.hp / h2.maxHp;
    return s;
  }
  waveAdvantage() {
    const w = this.world;
    let mine = 0, theirs = 0;
    for (const m of w.minions) {
      if (m.dead) continue;
      if (dist(m.x, m.y, this.h.x, this.h.y) > 900) continue;
      m.team === this.h.team ? mine++ : theirs++;
    }
    return mine >= theirs + 2 && mine >= 3;
  }
  moveTo(x, y, repath = 0.5) {
    const h = this.h;
    if (this.repathAt > this.world.t && this.goal && dist(this.goal[0], this.goal[1], x, y) < 60) { /* keep path */ }
    else { this.goal = [x, y]; this.path = NAV.findPath(h.x, h.y, x, y); this.pathI = 0; this.repathAt = this.world.t + repath; }
    h.moveIntent = this.nextPathPoint(x, y);
  }
  nextPathPoint(fx, fy) {
    if (!this.path || !this.path.length) return [fx, fy];
    while (this.pathI < this.path.length - 1 && dist(this.h.x, this.h.y, this.path[this.pathI][0], this.path[this.pathI][1]) < 70) this.pathI++;
    return this.path[Math.min(this.pathI, this.path.length - 1)];
  }
  laneFront() {
    // position near the friendly wave frontline on the assigned lane
    const w = this.world, team = this.h.team;
    const path = LANES[this.lane];
    let best = null, bestD = 1e9;
    for (const m of w.minions) {
      if (m.dead || m.team !== team || m.lane !== this.lane) continue;
      const d = dist(m.x, m.y, MAP.core[1 - team][0], MAP.core[1 - team][1]);
      if (d < bestD) { bestD = d; best = m; }
    }
    if (best) return [best.x, best.y];
    const mid = path[Math.floor(path.length / 2)];
    return [mid[0], mid[1]];
  }

  // ---------- states ----------
  doLane() {
    const h = this.h, w = this.world;
    if (h.aiRole === 'ROAM') return this.doRoam();
    const [fx, fy] = this.laneFront();
    const enemies = this.enemiesNear(700);
    const enemyTurret = this.turretNear(fx, fy, 1 - h.team, CONFIG.TURRET_RANGE + 160);
    // hold behind wave / farm position
    let tx = fx, ty = fy;
    const ranged = (h.def.range || 0) > 200;
    if (ranged && !enemies.length) {
      // stand slightly behind minions
      const [cx, cy] = MAP.core[h.team];
      const dx = cx - fx, dy = cy - fy, d = Math.hypot(dx, dy) || 1;
      tx = fx + dx / d * 140; ty = fy + dy / d * 140;
    }
    if (enemyTurret && dist(h.x, h.y, enemyTurret.x, enemyTurret.y) < CONFIG.TURRET_RANGE + 60) {
      const [cx, cy] = MAP.core[h.team];
      const dx = cx - enemyTurret.x, dy = cy - enemyTurret.y, d = Math.hypot(dx, dy) || 1;
      tx = enemyTurret.x + dx / d * (CONFIG.TURRET_RANGE + 130); ty = enemyTurret.y + dy / d * (CONFIG.TURRET_RANGE + 130);
    }
    this.moveTo(tx, ty);
    this.tryFarm();
    this.tryPoke();
  }
  doRoam() {
    const h = this.h, w = this.world;
    // follow the weakest-allied carry or rotate with mid
    const carry = w.heroes.filter(x => x.team === h.team && x !== h && !x.dead).sort((a, b) => (a.def.primaryRole === 'GOLD' ? -1 : 1) - (b.def.primaryRole === 'GOLD' ? -1 : 1))[0];
    const buddy = carry || null;
    if (buddy && dist(h.x, h.y, buddy.x, buddy.y) > 380) this.moveTo(buddy.x, buddy.y);
    else {
      const enemies = this.enemiesNear(600);
      if (enemies.length) { this.doFight(enemies, this.alliesNear(600)); return; }
      const [fx, fy] = this.laneFront();
      this.moveTo(fx, fy);
    }
    this.tryFarm();
    this.tryCastUltimate();
  }
  doJungle() {
    const h = this.h, w = this.world;
    // next camp with a living monster
    let target = null;
    for (let i = 0; i < this.jungleRoute.length; i++) {
      const [cx, cy, id] = this.jungleRoute[(this.routeI + i) % this.jungleRoute.length];
      const monsters = w.monsters.filter(m => !m.dead && m.campId === id);
      if (monsters.length) { target = monsters[0]; this.routeI = (this.routeI + i) % this.jungleRoute.length; break; }
    }
    // gank if a lane enemy is overextended & ult nearby
    if (w.rng.chance(0.25)) {
      const gank = this.gankOpportunity();
      if (gank) { this.state = 'GANK'; this.gankTarget = gank; return; }
    }
    if (!target) { // rotate mid farm
      const [fx, fy] = this.laneFront();
      this.moveTo(fx, fy);
      this.tryFarm();
      return;
    }
    const d = dist(h.x, h.y, target.x, target.y);
    if (d > 140) this.moveTo(target.x, target.y);
    else {
      h.moveIntent = null;
      this.attackTarget(target);
      this.tryHunt(target);
      this.trySkillsOn(target);
    }
  }
  gankOpportunity() {
    const w = this.world, h = this.h;
    const cd = w.rng.chance(this.d.dive);
    if (!cd) return null;
    for (const lane of ['TOP', 'MID', 'BOT']) {
      const enemies = w.heroes.filter(e => e.team !== h.team && !e.dead && e.hp / e.maxHp < 0.55);
      for (const e of enemies) {
        const friends = this.teamStrength(e.x, e.y, h.team);
        const foes = this.teamStrength(e.x, e.y, e.team);
        if (friends >= 1 && friends >= foes && dist(h.x, h.y, e.x, e.y) < 1600 && !this.inEnemyTurret(e.x, e.y)) return e;
      }
    }
    return null;
  }
  inEnemyTurret(x, y) {
    return this.world.structures.some(s => s.kind === 'turret' && !s.dead && s.team !== this.h.team && dist(x, y, s.x, s.y) < CONFIG.TURRET_RANGE + 90);
  }
  doGank() {
    const e = this.gankTarget;
    if (!e || e.dead) { this.state = 'LANE'; return; }
    const h = this.h;
    this.moveTo(e.x, e.y);
    this.trySkillsOn(e, true);
    this.tryCastUltimate(e);
    this.attackTarget(e);
    if (dist(h.x, h.y, e.x, e.y) > 1900 || e.dead) { this.state = 'JUNGLE'; }
  }
  doObjective() {
    const w = this.world, h = this.h;
    let obj = null;
    if (w.objectiveFocus && w.t < w.objectiveFocus.until) obj = w.unitById(w.objectiveFocus.monsterId);
    if (!obj || obj.dead) obj = this.objectiveOpportunity();
    if (!obj || obj.dead) { this.state = 'LANE'; return; }
    const d = dist(h.x, h.y, obj.x, obj.y);
    const enemies = w.heroes.filter(e => e.team !== h.team && !e.dead && dist(e.x, e.y, obj.x, obj.y) < 800);
    if (enemies.length && this.teamHp(h.team) < this.teamHp(1 - h.team) * 0.8) { this.moveTo(MAP.core[h.team][0], MAP.core[h.team][1]); return; }
    if (d > 150) this.moveTo(obj.x, obj.y);
    else {
      h.moveIntent = null;
      this.attackTarget(obj);
      this.tryHunt(obj);
      this.trySkillsOn(obj);
    }
    // fight whoever shows up
    const near = this.enemiesNear(300);
    if (near.length) this.trySkillsOn(near[0], true);
  }
  doFight(enemies, allies) {
    const h = this.h, w = this.world;
    const style = h.def.ai?.style || 'fighter';
    const target = this.pickFightTarget(enemies);
    if (!target) { this.state = 'LANE'; return; }
    const d = dist(h.x, h.y, target.x, target.y);
    const keep = h.def.ai?.keepRange ?? 110;
    if (style === 'marksman' || style === 'mage') {
      // kite: maintain range, back off if too close
      if (d < keep * 0.7) {
        const [cx, cy] = MAP.core[h.team];
        const a = angleTo(target.x, target.y, cx, cy);
        this.moveTo(h.x + Math.cos(a) * 220, h.y + Math.sin(a) * 220, 0.3);
      } else if (d > keep * 1.1) this.moveTo(target.x, target.y, 0.4);
      else h.moveIntent = null;
    } else if (style === 'tank') {
      // engage the clump
      if (d > 160) this.moveTo(target.x, target.y);
      else h.moveIntent = null;
      this.tryCastUltimate(target);
    } else {
      if (d > keep * 1.2) this.moveTo(target.x, target.y, 0.35);
      else h.moveIntent = null;
    }
    this.trySkillsOn(target, true);
    this.tryCastUltimate(target);
    this.attackTarget(target);
  }
  pickFightTarget(enemies) {
    const h = this.h;
    const style = h.def.ai?.style || 'fighter';
    let best = null, bs = -1e9;
    for (const e of enemies) {
      let score = 1000 - e.hp / e.maxHp * 600 - dist(h.x, h.y, e.x, e.y) * 0.4;
      if (style === 'assassin') score += e.def.archetype === 'marksman' || e.def.archetype === 'mage' ? 260 : 0;
      if (style === 'tank') score += e.def.archetype === 'marksman' || e.def.archetype === 'mage' ? 120 : -60;
      if (e.hp / e.maxHp < 0.3) score += 200;
      if (score > bs) { bs = score; best = e; }
    }
    return best;
  }
  doRetreat() {
    const h = this.h;
    const [cx, cy] = MAP.core[h.team];
    if (this.world.t > this.retreatUntil) {
      this.retreatUntil = this.world.t + 1.2;
      // heal spell if available
      if (h.spell === 'vitality' && h.cds.spell <= 0 && h.hp / h.maxHp < 0.4) this.world.castSpell(h, { x: h.x, y: h.y });
      if (h.spell === 'sprint' && h.cds.spell <= 0) this.world.castSpell(h, { x: h.x, y: h.y });
    }
    this.moveTo(cx, cy);
    if (dist(h.x, h.y, cx, cy) < 500 && h.hp / h.maxHp > 0.85) this.state = 'LANE';
  }
  doRecall() {
    const h = this.h;
    const [fx, fy] = MAP.fountain[h.team];
    const atBase = dist(h.x, h.y, fx, fy) < 400;
    if (atBase) {
      h.recall = null;
      const next = this.world.shop.nextRecommended(this.world, h);
      if (next) this.world.shop.buy(this.world, h, next);
      if (h.hp / h.maxHp > 0.9) { this.state = 'LANE'; }
      return;
    }
    if (!h.recall && !this.enemiesNear(700).length) this.world.startRecall(h);
    if (h.recall) { h.moveIntent = null; return; }
    // interrupted → head home on foot if still safe
    this.moveTo(fx, fy, 1.0);
  }
  doPush() {
    const h = this.h, w = this.world;
    // target enemy structure on lane with minion support
    const struct = w.structures.filter(s => s.team !== h.team && !s.dead && !s.invulnerable)
      .sort((a, b) => dist(h.x, h.y, a.x, a.y) - dist(h.x, h.y, b.x, b.y))[0];
    if (!struct) { this.state = 'LANE'; return; }
    const hasWave = w.minions.some(m => !m.dead && m.team === h.team && dist(m.x, m.y, struct.x, struct.y) < CONFIG.BACKDOOR_RADIUS);
    const d = dist(h.x, h.y, struct.x, struct.y);
    if (hasWave) {
      if (d > (h.def.range || 120) * 0.9) this.moveTo(struct.x, struct.y, 0.8);
      else { h.moveIntent = null; this.attackTarget(struct); }
    } else {
      // wait for wave / push lane midpoint
      const [fx, fy] = this.laneFront();
      this.moveTo(fx, fy);
    }
    const near = this.enemiesNear(500);
    if (near.length) { this.state = 'FIGHT'; }
  }
  doGroup() {
    const h = this.h, w = this.world;
    const target = this.groupTarget();
    if (!target) { this.state = 'PUSH'; return; }
    const d = dist(h.x, h.y, target.x, target.y);
    const siegeRange = (h.stats?.attackRange || 120);
    // tanks lead, carries follow at their range
    const lead = h.def.ai?.style === 'tank';
    const stand = lead ? 120 : siegeRange * 0.8;
    if (d > stand) this.moveTo(target.x, target.y, 0.8);
    else h.moveIntent = null;
    // fight interlopers
    const enemies = this.enemiesNear(520);
    if (enemies.length >= 1) {
      const t = this.pickFightTarget(enemies);
      if (t) { this.trySkillsOn(t, true); this.tryCastUltimate(t); this.attackTarget(t); return; }
    }
    // siege when safe (wave or allies present to tank)
    const alliesNear = this.alliesNear(650).length;
    const waveNear = this.waveNearStructure(target);
    if (waveNear || alliesNear >= 2 || h.def.archetype === 'tank') this.attackTarget(target);
  }
  waveNearStructure(st) {
    let wave = 0;
    this.world.grid.query(st.x, st.y, CONFIG.BACKDOOR_RADIUS, u => { if (u.kind === 'minion' && u.team === this.h.team) wave++; });
    return wave >= 1;
  }
  doDefend() {
    const h = this.h, w = this.world;
    const [cx, cy] = MAP.core[h.team];
    const threat = w.heroes.filter(e => e.team !== h.team && !e.dead && dist(e.x, e.y, cx, cy) < 1300)
      .sort((a, b) => dist(h.x, h.y, a.x, a.y) - dist(h.x, h.y, b.x, b.y))[0];
    if (!threat) { this.state = 'LANE'; return; }
    this.moveTo(threat.x, threat.y, 0.4);
    this.tryCastUltimate(threat);
    this.trySkillsOn(threat, true);
    this.attackTarget(threat);
  }

  // ---------- combat micro ----------
  attackTarget(t) {
    const h = this.h;
    if (!t || t.dead) return;
    const d = dist(h.x, h.y, t.x, t.y) - (t.r || 30);
    const range = (h.stats?.attackRange || 120);
    h.aim = angleTo(h.x, h.y, t.x, t.y);
    h.attackTarget = t; // combat system performs the actual attack when in range
  }
  tryFarm() {
    const h = this.h, w = this.world;
    // last-hit: lowest allied... enemy minion below kill threshold
    let best = null, bd = 1e9;
    const range = h.stats?.attackRange || 120;
    for (const m of w.minions) {
      if (m.dead || m.team === h.team) continue;
      const d = dist(h.x, h.y, m.x, m.y) - m.r;
      if (d > range) continue;
      if (m.hp <= (h.stats?.physAtk || 50) * 1.15 && d < bd) { bd = d; best = m; }
    }
    if (best) { this.attackTarget(best); return; }
    if (h.def.ai?.style === 'marksman' || h.def.ai?.style === 'mage') {
      // otherwise poke nearest minion
      let near = null, nd = 1e9;
      for (const m of w.minions) { if (m.dead || m.team === h.team) continue; const d = dist(h.x, h.y, m.x, m.y) - m.r; if (d < range && d < nd) { nd = d; near = m; } }
      if (near) this.attackTarget(near);
    }
  }
  tryPoke() {
    const h = this.h;
    const enemies = this.enemiesNear((h.stats?.attackRange || 120) + 220);
    if (!enemies.length) return;
    if (this.world.t - this.lastSkillAt < 1.4) return;
    if (!this.world.rng.chance(this.d.skill)) return;
    this.trySkillsOn(enemies[0], false);
  }
  trySkillsOn(t, aggressive) {
    const h = this.h, w = this.world;
    if (!t || t.dead) return;
    if (w.t - this.lastSkillAt < this.d.react * 1.2) return;
    if (!w.rng.chance(this.d.skill)) return;
    const combo = h.def.ai?.combo || ['q'];
    for (const slot of combo) {
      const ab = h.def.abilities[slot];
      if (!ab || h.cds[slot] > 0) continue;
      if (ab.mana && h.mana < ab.mana) continue;
      if (slot === 'r' && !aggressive && !this.ultWorthy(t)) continue;
      const range = ab.range || 400;
      const d = dist(h.x, h.y, t.x, t.y);
      if (d > range * 1.05) continue;
      // aim with prediction
      const lead = this.d.predict * 0.28;
      let ax = t.x, ay = t.y;
      if (ab.aim === 'dir' && lead) { ax += Math.cos(t.aim || 0) * 150 * lead * (t.moveIntent ? 1 : 0); ay += Math.sin(t.aim || 0) * 150 * lead * (t.moveIntent ? 1 : 0); }
      const err = this.d.aimErr;
      ax += (w.rng.f() - 0.5) * err * 2; ay += (w.rng.f() - 0.5) * err * 2;
      if (ab.aim === 'target' || ab.aim === 'ally') {
        w.castAbility(h, slot, { x: t.x, y: t.y, target: t, ally: ab.aim === 'ally' ? (this.hurtAlly() || h) : null });
      } else {
        w.castAbility(h, slot, { x: ax, y: ay, target: t });
      }
      this.lastSkillAt = w.t;
      return;
    }
  }
  ultWorthy(t) {
    if (!t || t.kind !== 'hero') return false;
    const h = this.h;
    const allies = this.alliesNear(500).length;
    const enemies = this.enemiesNear(600).length;
    return (t.hp / t.maxHp < 0.75 && d2(h, t) < 500) || allies >= 1 || enemies >= 2;
    function d2(a, b) { return dist(a.x, a.y, b.x, b.y); }
  }
  hurtAlly() {
    const h = this.h;
    let best = null, bs = 1;
    for (const a of this.world.heroes) {
      if (a.team !== h.team || a.dead) continue;
      const pct = a.hp / a.maxHp;
      if (pct < bs) { bs = pct; best = a; }
    }
    return best;
  }
  tryCastUltimate(t) {
    const h = this.h, w = this.world;
    if (h.cds.r > 0 || !t || t.dead) return;
    if (!w.rng.chance(this.d.skill * 0.8)) return;
    const ab = h.def.abilities.r;
    if (!ab) return;
    const d = dist(h.x, h.y, t.x, t.y);
    if (d > (ab.range || 500)) return;
    if (ab.aim === 'target') w.castAbility(h, 'r', { x: t.x, y: t.y, target: t });
    else if (ab.aim === 'point') w.castAbility(h, 'r', { x: t.x + (w.rng.f() - 0.5) * this.d.aimErr, y: t.y + (w.rng.f() - 0.5) * this.d.aimErr, target: t });
    else w.castAbility(h, 'r', { x: t.x, y: t.y, target: t });
    this.lastSkillAt = w.t;
  }
  tryHunt(monster) {
    const h = this.h, w = this.world;
    if (h.spell !== 'hunt' || h.cds.spell > 0) return;
    const huntDmg = CONFIG.HUNT_MONSTER_BASE + CONFIG.HUNT_MONSTER_PER_LEVEL * h.level;
    if (monster.hp < huntDmg * this.d.huntMargin) w.castSpell(h, { x: monster.x, y: monster.y, target: monster });
  }
  doTurretFlee() {
    const h = this.h;
    const et = this.turretNear(h.x, h.y, 1 - h.team, CONFIG.TURRET_RANGE + 140);
    if (!et) { this.state = 'LANE'; return; }
    const dx = h.x - et.x, dy = h.y - et.y, d = Math.hypot(dx, dy) || 1;
    this.moveTo(h.x + dx / d * 300, h.y + dy / d * 300);
  }
  turretNear(x, y, team, r) {
    let best = null, bd = r;
    for (const s of this.world.structures) {
      if (s.team !== team || s.dead) continue;
      const d = dist(x, y, s.x, s.y);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  tick() {
    const w = this.world, h = this.h;
    if (w.t >= this.nextThink) {
      this.nextThink = w.t + this.d.think * (0.8 + w.rng.f() * 0.4);
      this.think();
      this.botVote();
    }
    // shop whenever near fountain with gold
    if (!h.dead && dist(h.x, h.y, MAP.fountain[h.team][0], MAP.fountain[h.team][1]) < CONFIG.SHOP_RADIUS && h.gold > 700) {
      const next = w.shop.nextRecommended(w, h);
      if (next) w.shop.buy(w, h, next);
    }
  }
  botVote() {
    const w = this.world, s = w.surrState;
    if (!s.active || s.team !== this.h.team || s.votes[this.h.id] !== undefined) return;
    // assess deficit
    const myGold = w.heroes.filter(h => h.team === this.h.team).reduce((a, h) => a + h.goldEarned, 0);
    const enGold = w.heroes.filter(h => h.team !== this.h.team).reduce((a, h) => a + h.goldEarned, 0);
    const losing = enGold > myGold * 1.25;
    const structs = w.structures.filter(st => st.kind !== 'core');
    const myS = structs.filter(st => st.team === this.h.team && !st.dead).length;
    const enS = structs.filter(st => st.team !== this.h.team && !st.dead).length;
    const behind = enS < myS - 2 || losing;
    const yes = behind ? this.voteRoll < 0.75 : this.voteRoll < 0.12;
    w.surrender.vote(w, this.h, yes);
  }
}
