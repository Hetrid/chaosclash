// Legend Arena — turrets & the Core: targeting priority, aggro ramp, backdoor protection.
import { CONFIG } from '../core/config.js';
import { nextId } from './Hero.js';
import { dist } from '../core/math.js';
import { dealDamage } from '../game/Damage.js';
import { TURRETS } from '../map/MapData.js';

export function createStructures(world) {
  const list = [];
  for (const t of TURRETS) {
    list.push({
      world,
      id: nextId(), kind: 'turret', structId: t.id, team: t.team, lane: t.lane, tier: t.tier,
      x: t.x, y: t.y, r: 58,
      maxHp: t.tier === 3 ? 6000 : t.tier === 2 ? 5500 : 5000,
      hp: t.tier === 3 ? 6000 : t.tier === 2 ? 5500 : 5000,
      range: CONFIG.TURRET_RANGE, dmgHero: CONFIG.TURRET_VS_HERO + (t.tier - 1) * 15,
      physDef: 18, magDef: 18,
      dmgMinion: CONFIG.TURRET_VS_MINION,
      aspd: t.tier === 3 ? 0.9 : 0.83, atkCd: 0,
      target: null, rampTarget: null, rampCount: 0,
      dead: false, invulnerable: false, backdoorProtected: false,
      aggroScan: 0, lastAllyDefender: null, lastAllyDefenderT: -99,
    });
  }
  for (let team = 0; team < 2; team++) {
    const [x, y] = world.map.core[team];
    list.push({ world, id: nextId(), kind: 'core', structId: 'core' + team, team, lane: 'BASE', tier: 4, x, y, r: 74, maxHp: 8500, hp: 8500, physDef: 20, magDef: 20, range: CONFIG.TURRET_RANGE + 60, dmgHero: 210, dmgMinion: 240, aspd: 0.8, atkCd: 0, target: null, rampTarget: null, rampCount: 0, dead: false, invulnerable: true, backdoorProtected: false, aggroScan: 0 });
  }
  return list;
}

// Turret vulnerability chain: lane turrets must fall in order; core opens after base turrets fall.
export function updateStructureVulnerability(world) {
  for (const team of [0, 1]) {
    const mine = world.structures.filter(s => s.team === team);
    const laneTurrets = lane => mine.filter(s => s.kind === 'turret' && s.lane === lane);
    for (const lane of ['TOP', 'MID', 'BOT']) {
      const [t2, t1] = [laneTurrets(lane).find(s => s.tier === 2), laneTurrets(lane).find(s => s.tier === 1)];
      if (t1) t1.invulnerable = false;
      if (t2) t2.invulnerable = t1 ? !t1.dead : false;
    }
    const baseT = mine.filter(s => s.kind === 'turret' && s.lane === 'BASE');
    const anyBaseAlive = baseT.some(s => !s.dead);
    const allLanesOpen = ['TOP', 'MID', 'BOT'].every(lane => {
      const t1 = laneTurrets(lane).find(s => s.tier === 1);
      return !t1 || t1.dead;
    });
    for (const b of baseT) b.invulnerable = !allLanesOpen;
    const core = mine.find(s => s.kind === 'core');
    if (core) core.invulnerable = baseT.some(s => !s.dead);
  }
}

// backdoor protection: enemy structure is protected when NO allied minion within radius
export function updateBackdoor(world) {
  for (const s of world.structures) {
    if (s.kind === 'core') { s.backdoorProtected = false; continue; }
    let waveNear = false;
    world.grid.query(s.x, s.y, CONFIG.BACKDOOR_RADIUS, u => {
      if (u.kind === 'minion' && u.team === s.team) { waveNear = true; return true; }
    });
    const was = s.backdoorProtected;
    s.backdoorProtected = !waveNear;
    if (s.backdoorProtected && s.hp > 0 && !s.dead) {
      s.hp = Math.min(s.maxHp, s.hp + s.maxHp * CONFIG.BACKDOOR_REGEN * world.dt);
    }
    if (s.backdoorProtected !== was) world.emit({ type: 'structProtect', id: s.id, protected: s.backdoorProtected });
  }
}

export function tickTurret(world, s, dt) {
  if (s.dead) return;
  s.atkCd = Math.max(0, s.atkCd - dt);
  s.aggroScan -= dt;

  const hasTarget = s.target && !s.target.dead && dist(s.x, s.y, s.target.x, s.target.y) <= s.range + (s.target.r || 0);

  // ---- aggro evaluation (4 Hz) ----
  if (s.aggroScan <= 0 || !hasTarget) {
    s.aggroScan = 0.25;
    let best = null, bestScore = -1e9;
    // 1) hero attacking allied hero under turret → highest priority
    world.grid.query(s.x, s.y, s.range + 60, u => {
      if (u.dead || u.team === s.team || u.invulnUntil > world.t) return;
      const d = dist(s.x, s.y, u.x, u.y) - (u.r || 0);
      if (d > s.range) return;
      let score;
      if (u.kind === 'hero' && u.lastAttackedAllyHero && world.t - u.lastAttackedAllyHeroT < 1.2 && u.lastAttackedAllyHeroTeam === s.team) score = 1000 - d;
      else if (u.kind === 'minion') score = 500 - d;
      else if (u.kind === 'summon') score = 400 - d;
      else if (u.kind === 'hero') score = 300 - d;
      else return;
      if (score > bestScore) { bestScore = score; best = u; }
    });
    if (best && best !== s.target) {
      if (best.kind === 'hero' || !s.target || s.target.kind === 'hero' || true) {
        // switching to a hero target resets ramp only if previous ramp target differs
        if (s.rampTarget !== best.id) { s.rampCount = 0; s.rampTarget = best.id; }
        s.target = best;
        world.emit({ type: 'turretAggro', id: s.id, tgtId: best.id, team: s.team });
      }
    } else if (!best) s.target = null;
  }

  const t = s.target;
  if (!t || t.dead) { s.target = null; return; }

  if (s.atkCd <= 0 && dist(s.x, s.y, t.x, t.y) <= s.range + (t.r || 0)) {
    s.atkCd = 1 / s.aspd;
    const isHero = t.kind === 'hero';
    if (isHero) {
      if (s.rampTarget !== t.id) { s.rampTarget = t.id; s.rampCount = 0; }
      const mult = 1 + Math.min(s.rampCount, CONFIG.TURRET_RAMP_MAX - 1) * CONFIG.TURRET_RAMP;
      s.rampCount++;
      const dmg = s.dmgHero * mult;
      world.spawnProjectile({ src: s, tgtId: t.id, x: s.x, y: s.y - 40, aim: Math.atan2(t.y - s.y, t.x - s.x), speed: 900, range: s.range + 200, radius: 18, dmg, dtype: 'phys', category: 'turret', kindLabel: 'turret', homing: t.id });
      world.emit({ type: 'turretShot', id: s.id, tgtId: t.id, team: s.team });
    } else {
      const dmg = t.kind === 'minion' ? s.dmgMinion : s.dmgHero * 0.8;
      world.spawnProjectile({ src: s, tgtId: t.id, x: s.x, y: s.y - 40, aim: Math.atan2(t.y - s.y, t.x - s.x), speed: 900, range: s.range + 200, radius: 16, dmg, dtype: 'phys', category: 'turret', kindLabel: 'turret', homing: t.id });
      world.emit({ type: 'turretShot', id: s.id, tgtId: t.id, team: s.team });
    }
  }
}
