// Legend Arena — THE authoritative damage/heal/shield/kill pipeline.
// Projectiles, DoTs, turrets, minions, monsters, items, abilities and objectives
// all funnel through dealDamage(). No other code may modify hp directly.
import { CONFIG } from '../core/config.js';
import { clamp, dist } from '../core/math.js';
import { mitigate, effectiveDef } from './Stats.js';
import { cancelRecall, applyBuff } from './StatusSystem.js';
import { isHero } from '../entities/kinds.js';

export function addShield(world, u, amount, dur, id = 'shield') {
  const cap = (u.maxHp || u.hp) * (u.stats?.maxShieldFrac ?? 0.4);
  const cur = u.shield || 0;
  const gain = Math.max(0, Math.min(amount, cap - cur));
  if (gain <= 0) return 0;
  u.shield = cur + gain;
  const until = world.t + dur;
  const ex = (u.shields || (u.shields = [])).find(s => s.id === id);
  if (ex) { ex.amount += gain; ex.until = Math.max(ex.until, until); }
  else u.shields.push({ id, amount: gain, until });
  world.emit({ type: 'shieldGain', id: u.id, amount: gain });
  return gain;
}

function tickShields(world, u) {
  if (!u.shields || !u.shields.length) return;
  let total = 0, dirty = false;
  for (let i = u.shields.length - 1; i >= 0; i--) {
    const s = u.shields[i];
    if (s.until <= world.t || s.amount <= 0) { u.shields.splice(i, 1); dirty = true; }
    else total += s.amount;
  }
  if (dirty) u.shield = total;
}

// ev: {src, tgt, amount, dtype:'phys'|'magic'|'true', category:'basic'|'skill'|'dot'|'summon'|'minion'|'monster'|'turret'|'fountain'|'true', canCrit, kindLabel, noOnHit}
export function dealDamage(world, ev) {
  const { src, tgt } = ev;
  if (!tgt || tgt.dead || tgt.hp <= 0) return 0;
  if (ev.src && ev.src.dead && ev.category !== 'dot') { /* dying-source DoTs still tick */ }
  if (tgt.invulnUntil > world.t) { world.emit({ type: 'immune', x: tgt.x, y: tgt.y, id: tgt.id }); return 0; }
  if (src && (src === tgt || src.team === tgt.team)) return 0; // no friendly fire / self-damage

  const srcStats = src && src.stats ? src.stats : null;
  let amount = ev.amount;
  let crit = false;

  // crit (basic attacks only)
  if (ev.canCrit && srcStats && srcStats.critChance > 0 && world.rng.chance(srcStats.critChance)) {
    amount *= srcStats.critDmg || CONFIG.CRIT_DMG; crit = true;
    if (srcStats.dawnedgeHeal && isHero(src)) heal(world, src, src.maxHp * 0.025, 'dawnedge');
  }
  // global amps
  if (srcStats) amount *= 1 + (srcStats.dmgAmp || 0);
  if (srcStats && ev.category === 'basic' && srcStats.tempestExec && tgt.maxHp && tgt.hp / tgt.maxHp < 0.5) amount *= 1.12; // Tempest Glaive
  if (srcStats && tgt.kind === 'monster') amount *= 1 + (srcStats.monsterDmgAmp || 0);
  if (srcStats && (tgt.kind === 'turret' || tgt.kind === 'core')) amount *= 1 + (srcStats.structDmgAmp || 0);
  amount = Math.max(1, amount);

  // mitigation
  let dealt = amount;
  if (ev.dtype !== 'true') {
    const def = effectiveDef(tgt, ev.dtype === 'magic' ? 'magic' : 'phys', srcStats);
    dealt = mitigate(amount, def);
  }
  if (tgt.kind === 'turret' || tgt.kind === 'core') {
    // backdoor protection: hero-sourced damage reduced without allied wave nearby
    if ((ev.category === 'basic' || ev.category === 'skill' || ev.category === 'summon') && isHero(src) && tgt.backdoorProtected) {
      // the deeper the game, the weaker backdoor armor gets (symmetric closer, never a timer)
      let bdMult = CONFIG.BACKDOOR_HERO_MULT;
      if (world.t > 20 * 60) bdMult = 0.7; else if (world.t > 15 * 60) bdMult = 0.45;
      dealt *= bdMult;
    }
    if (tgt.invulnerable) return 0;
  }

  // shields absorb first
  let shieldDmg = 0;
  if (tgt.shield > 0 && ev.dtype !== 'trueIgnoreShield') {
    shieldDmg = Math.min(tgt.shield, dealt);
    tgt.shield -= shieldDmg;
    const left = shieldDmg;
    for (const s of tgt.shields || []) { const take = Math.min(s.amount, left); s.amount -= take; }
    dealt -= shieldDmg;
  }

  tgt.hp = Math.max(0, tgt.hp - dealt);
  const actual = dealt + shieldDmg;

  // Phoenix Feather: cheat death (once per life, cooldown-gated)
  if (tgt.hp <= 0 && isHero(tgt) && tgt.stats?.phoenix && !tgt.phoenixUsed && !(tgt.phoenixCdUntil > world.t)) {
    tgt.phoenixUsed = true;
    tgt.phoenixCdUntil = world.t + 180;
    tgt.hp = tgt.maxHp * 0.25;
    tgt.invulnUntil = world.t + 1.5;
    world.emit({ type: 'phoenixRevive', id: tgt.id, x: tgt.x, y: tgt.y });
  }

  // damage log for kill credit/assists + scoreboard accumulation
  if (src && isHero(src)) {
    src.dmgDealt = (src.dmgDealt || 0) + actual;
    if (isHero(tgt)) tgt.dmgTaken = (tgt.dmgTaken || 0) + actual;
  }
  if (src && isHero(src) && src.team !== tgt.team) {
    (tgt.dmgLog || (tgt.dmgLog = [])).push({ srcId: src.id, heroId: src.heroId, team: src.team, t: world.t, amount: actual });
  }

  // sustain
  if (srcStats && src.team !== tgt.team) {
    if (ev.category === 'basic' && srcStats.lifesteal > 0) heal(world, src, actual * srcStats.lifesteal, 'lifesteal');
    else if ((ev.category === 'skill' || ev.category === 'dot') && srcStats.spellVamp > 0) heal(world, src, actual * srcStats.spellVamp, 'vamp');
  }

  // thorns
  if (!ev.noOnHit && isHero(tgt) && tgt.stats?.thorns > 0 && ev.category === 'basic' && src &&
      (ev.melee || (src.def?.range || 0) <= 140) && src.team !== tgt.team) {
    dealDamage(world, { src: tgt, tgt: src, amount: tgt.stats.thorns, dtype: 'magic', category: 'dot', kindLabel: 'thorns', noOnHit: true });
  }

  // recall break
  if (isHero(tgt) && tgt.recall && actual > 0) cancelRecall(world, tgt, 'damage');
  // turret-aggro bookkeeping: bots use this to flee tower fire
  if (isHero(tgt) && ev.category === 'turret') tgt.lastTurretHitT = world.t;
  // spawn shield break on acting
  if (isHero(tgt) && tgt.invulnUntil > world.t) { /* handled by invuln check above */ }

  world.emit({ type: 'dmg', x: tgt.x, y: tgt.y, amount: Math.round(actual), hp: tgt.hp, maxHp: tgt.maxHp, dtype: ev.dtype, crit, srcId: src?.id ?? -1, tgtId: tgt.id, shieldDmg: Math.round(shieldDmg), kind: ev.kindLabel || ev.category, team: tgt.team });

  // passive hooks (both sides)
  if (!ev.noOnHit) {
    src?.onDealtDamage?.(world, tgt, actual, ev);
    tgt.onDamaged?.(world, src, actual, ev);
  }

  if (tgt.hp <= 0) {
    // hero death intercepts (e.g. Ember's Rebirth)
    if (isHero(tgt) && tgt.def?.hooks?.onDeathIntercept?.(world, tgt)) return actual;
    onKilled(world, tgt, src, ev);
  }
  return actual;
}

export function heal(world, u, amount, label = 'heal', healer = null) {
  if (!u || u.dead || amount <= 0) return 0;
  const amp = u.stats?.healAmp ?? 1;
  const gain = Math.min(amount * amp, u.maxHp - u.hp);
  if (gain <= 0.5) return 0;
  u.hp += gain;
  if (healer && healer !== u && healer.stats?.sentinel && isHero(u)) {
    applyBuff(world, u, { id: 'sentinelOath', until: world.t + 3, stats: { physDef: 0.10 * u.stats.physDef, magDef: 0.10 * u.stats.magDef } });
  }
  if (healer) healer.healDone += gain;
  world.emit({ type: 'heal', x: u.x, y: u.y, amount: Math.round(gain), id: u.id, label });
  return gain;
}

export function giveMana(world, u, amount) {
  if (!u || u.dead || !u.maxMana) return 0;
  const gain = Math.min(amount, u.maxMana - u.mana);
  u.mana += gain;
  return gain;
}

function spendMana(u, cost) {
  if (!cost) return true;
  if (u.mana < cost) return false;
  u.mana -= cost;
  return true;
}

// ---------------- death & credit ----------------
function recentHeroDamager(tgt, world, window = 5) {
  const log = tgt.dmgLog || [];
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i];
    if (world.t - e.t <= window) { const h = world.unitById(e.srcId); if (h && !h.dead) return h; }
  }
  return null;
}

export function onKilled(world, tgt, src, ev) {
  tgt.dead = true;
  tgt.hp = 0;
  tgt.deathT = world.t;
  world.emit({ type: 'death', x: tgt.x, y: tgt.y, id: tgt.id, kind: tgt.kind, team: tgt.team });

  switch (tgt.kind) {
    case 'hero': heroKilled(world, tgt, src); break;
    case 'minion': minionKilled(world, tgt, src); break;
    case 'monster': world.jungle.onMonsterKilled(world, tgt, src); break;
    case 'turret': world.objectives.onTurretKilled(world, tgt, src); break;
    case 'core': world.objectives.onCoreKilled(world, tgt); break;
    case 'summon': world.emit({ type: 'summonEnd', id: tgt.id }); break;
  }
  tgt.dmgLog = [];
}

function heroKilled(world, victim, src) {
  const victimLevel = victim.level;
  let killer = src && isHero(src) ? src : recentHeroDamager(victim, world);
  const executed = !killer;

  // assists: heroes on killer's team that damaged victim recently
  const assists = [];
  const seen = new Set();
  for (const e of victim.dmgLog || []) {
    if (seen.has(e.srcId)) continue;
    seen.add(e.srcId);
    if (world.t - e.t > CONFIG.ASSIST_WINDOW) continue;
    const h = world.unitById(e.srcId);
    if (h && !h.dead && h !== killer && h.team === victim.team * -1 + victim.team) { /* noop */ }
    if (h && !h.dead && h !== killer && h.team !== victim.team) assists.push(h);
  }

  victim.deaths++; victim.streak = 0;
  const killGoldBase = 110 + 12 * victimLevel;
  const shutdown = victim.streak >= 3 ? Math.min(250, victim.streak * 32) : 0;
  const killXp = 120 + 25 * victimLevel;

  if (!executed) {
    killer.kills++;
    killer.streak++;
    killer.streakAtDeath = killer.streak;
    let gold = killGoldBase + shutdown;
    // roam-style share handled by GoldSystem role passives
    addGold(world, killer, gold, 'kill');
    world.xp.grantXp(world, killer, killXp);
    killer.onKill?.(world, victim);
    world.emit({ type: 'kill', killerId: killer.id, killerName: killer.name, killerHero: killer.heroId, victimId: victim.id, victimName: victim.name, victimHero: victim.heroId, victimTeam: victim.team, killerTeam: killer.team, streak: killer.streak, shutdown, assists: assists.map(a => ({ id: a.id, name: a.name, hero: a.heroId })) });
  } else {
    world.emit({ type: 'kill', killerId: -1, killerName: 'the lane', killerHero: null, victimId: victim.id, victimName: victim.name, victimHero: victim.heroId, victimTeam: victim.team, killerTeam: victim.team === 0 ? 1 : 0, streak: 0, shutdown: 0, executed: true, assists: assists.map(a => ({ id: a.id, name: a.name, hero: a.heroId })) });
    for (const a of assists) addGold(world, a, killGoldBase * 0.5, 'kill');
  }

  // assist rewards
  for (const a of assists) {
    a.assists++;
    addGold(world, a, (killGoldBase * CONFIG.ASSIST_SHARE) / Math.max(1, assists.length), 'assist');
    world.xp.grantXp(world, a, killXp * 0.5);
  }

  // bounty streak bookkeeping for victim shutdown value
  victim.streakAtDeath = 0;
  victim.respawnAt = world.t + respawnTime(victimLevel);
  victim.buffs.length = 0;
  victim.cc = {};
  victim.shield = 0; victim.shields = [];
  victim.recall = null;
  victim.casting = null;
  victim.dashing = null;
  victim.channeling = null;
}

export function respawnTime(level) {
  return clamp(CONFIG.RESPAWN_BASE + CONFIG.RESPAWN_PER_LEVEL * level, 6, CONFIG.RESPAWN_CAP);
}

function minionKilled(world, m, src) {
  world.gold.onMinionKilled(world, m, src);
  world.xp.onMinionKilled(world, m, src);
}

export function addGold(world, hero, amount, label = 'misc') {
  if (!hero || hero.dead) { /* dead heroes still bank income */ }
  hero.gold += amount;
  hero.goldEarned += Math.max(0, amount);
  world.emit({ type: 'gold', id: hero.id, amount: Math.round(amount), label });
}

export { spendMana, tickShields };
