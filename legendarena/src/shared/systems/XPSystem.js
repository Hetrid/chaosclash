// Legend Arena — experience: shared minion XP, level curve, jungle/objective XP,
// EXP-lane bonus, level-up effects.
import { CONFIG } from '../core/config.js';
import { dist } from '../core/math.js';
import { laneIdNear } from '../map/MapData.js';
import { refreshMax } from '../entities/Hero.js';

export function xpForLevel(l) { // xp needed to go from l -> l+1
  return Math.round(130 + (l - 1) * 95 + (l - 1) * (l - 1) * 7);
}

export const XPSystem = {
  grantXp(world, hero, amount) {
    if (!hero || hero.dead && false) { /* dead heroes still bank */ }
    if (world.t < 240 && hero.aiRole === 'EXP') {
      const lane = laneIdNear(hero.x, hero.y);
      if (lane === 'TOP') amount *= 1.25; // EXP lane early bonus
    }
    hero.xp += amount;
    this.checkLevel(world, hero);
  },

  onMinionKilled(world, m, src) {
    for (const h of world.heroes) {
      if (h.team === m.team || h.dead) continue;
      if (dist(h.x, h.y, m.x, m.y) <= CONFIG.XP_RADIUS) {
        this.grantXp(world, h, m.xp);
      }
    }
  },

  onMonsterKilled(world, monster, killer) {
    // shared to nearby allies of the killer
    const team = killer ? killer.team : 0;
    let any = false;
    for (const h of world.heroes) {
      if (h.team !== team || h.dead) continue;
      if (dist(h.x, h.y, monster.x, monster.y) <= CONFIG.XP_RADIUS + 200) {
        let amount = monster.xp;
        if (killer?.stats?.campBonus && h === killer) amount *= 1 + killer.stats.campBonus;
        this.grantXp(world, h, amount);
        any = true;
      }
    }
    if (!any && killer) this.grantXp(world, killer, monster.xp);
  },

  checkLevel(world, h) {
    while (h.level < CONFIG.LEVELS && h.xp >= xpForLevel(h.level)) {
      h.xp -= xpForLevel(h.level);
      h.level++;
      refreshMax(h);
      h.hp = Math.min(h.maxHp, h.hp + h.maxHp * 0.12); // small level-up heal
      world.emit({ type: 'levelup', id: h.id, level: h.level, x: h.x, y: h.y });
    }
  },
};
