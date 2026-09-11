// Legend Arena — gold economy: passive income, last-hit rewards, assists,
// lane role bonuses (GOLD lane / EXP lane), roam pact, shutdowns.
import { CONFIG } from '../core/config.js';
import { dist } from '../core/math.js';
import { addGold } from '../game/Damage.js';
import { laneIdNear } from '../map/MapData.js';
import { isHero } from '../entities/kinds.js';

export const GoldSystem = {
  tick(world, dt) {
    for (const h of world.heroes) {
      if (h.dead) { /* income continues */ }
      let income = CONFIG.GOLD_PASSIVE;
      if (h.stats?.roamPact) income += 2.2;
      addGold(world, h, income * dt, 'income');
    }
  },

  // minion died: last-hit gold + roam share + lane bonuses
  onMinionKilled(world, m, src) {
    const t = world.t;
    const killers = [];
    if (isHero(src) && !src.dead) killers.push(src);
    const lastHero = recentKillerHero(world, m);
    if (lastHero && !killers.includes(lastHero)) killers.push(lastHero);

    // XP share handled by XPSystem; here: gold.
    const goldLane = laneIdNear(m.x, m.y);
    for (const k of killers) {
      let g = m.gold;
      // early-game lane bonuses
      if (t < 240) {
        if (goldLane === 'BOT' && k.aiRole === 'GOLD') g *= 1.25;
      }
      // roam pact: reduced last-hit gold
      if (k.stats?.roamPact) g *= 0.6;
      addGold(world, k, g, 'minion');
    }

    // roam pact share: allied heroes with roamPact near the kill get 60% of value
    if (killers.length) {
      for (const h of world.heroes) {
        if (h.dead || !h.stats?.roamPact || killers.includes(h)) continue;
        if (dist(h.x, h.y, m.x, m.y) < 700 && killers[0].team === h.team) {
          addGold(world, h, m.gold * 0.6, 'roamShare');
        }
      }
    } else if (lastHero == null) {
      // nobody last-hit: nearest enemy hero in radius gets 50%
      let best = null, bd = 800;
      for (const h of world.heroes) {
        if (h.team === m.team || h.dead) continue;
        const d = dist(h.x, h.y, m.x, m.y);
        if (d < bd) { bd = d; best = h; }
      }
      if (best) addGold(world, best, m.gold * 0.5, 'minion');
    }
  },

  onTurretKilledReward(world, turret, destroyer) {
    for (const h of world.heroes) if (h.team !== turret.team) addGold(world, h, CONFIG.TURRET_GOLD_TEAM, 'turret');
    if (isHero(destroyer)) addGold(world, destroyer, 60, 'turretBonus');
  },
};

function recentKillerHero(world, m) {
  const log = m.dmgLog || [];
  for (let i = log.length - 1; i >= 0; i--) {
    if (world.t - log[i].t > 6) break;
    const u = world.unitById(log[i].srcId);
    if (u && u.kind === 'hero' && !u.dead) return u;
  }
  return null;
}
