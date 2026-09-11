// Legend Arena — jungle camps: respawning buffs, small camps, river wisps.
// Monster entity AI lives in entities/Monster.js; this owns camps, rewards and buffs.
import { CONFIG } from '../core/config.js';
import { createMonster } from '../entities/Monster.js';
import { dist } from '../core/math.js';
import { addGold, heal, dealDamage } from '../game/Damage.js';
import { applyBuff, applyCC } from '../game/StatusSystem.js';
import { isHero } from '../entities/kinds.js';

export const JungleSystem = {
  init(world) {
    this.world = world;
    world.camps = world.map.camps.map(c => ({
      id: c.id, kind: c.kind, team: c.team, x: c.x, y: c.y, r: c.r, count: c.count || 1,
      alive: 0, respawnAt: c.kind === 'wisp' ? 15 : 5, // wisps spawn a bit later
    }));
  },

  tick(world, dt) {
    for (const camp of world.camps) {
      if (camp.alive < camp.count && world.t >= camp.respawnAt) {
        const m = createMonster(world, camp.kind, camp.x + (world.rng.f() - 0.5) * 60, camp.y + (world.rng.f() - 0.5) * 60, camp.id);
        world.monsters.push(m);
        world.grid.insert(m);
        world.register(m);
        camp.alive++;
        world.emit({ type: 'campSpawn', camp: camp.id, x: m.x, y: m.y, kind: camp.kind });
      }
    }
  },

  onMonsterDamaged(world, m, src) {
    if (isHero(src)) m.aggroBy = src;
  },

  onMonsterKilled(world, m, src) {
    const camp = world.camps.find(c => c.id === m.campId);
    if (camp) {
      camp.alive = Math.max(0, camp.alive - 1);
      const resp = camp.kind === 'ember' || camp.kind === 'azure' ? CONFIG.CAMP_RESPAWN_BUFF
        : camp.kind === 'wisp' ? CONFIG.CAMP_RESPAWN_WISP : CONFIG.CAMP_RESPAWN_SMALL;
      camp.respawnAt = world.t + resp;
    }

    const killer = isHero(src) ? src : this.lastHeroNear(world, m);
    // gold: killer + nearby allies (jungle share)
    if (killer) {
      const team = killer.team;
      for (const h of world.heroes) {
        if (h.team !== team || h.dead) continue;
        const near = dist(h.x, h.y, m.x, m.y) <= CONFIG.XP_RADIUS + 200;
        if (h === killer) addGold(world, h, m.gold * (killer.stats?.campBonus ? 1 + killer.stats.campBonus : 1), 'monster');
        else if (near) addGold(world, h, m.gold * 0.45, 'monster');
      }
      if (killer.stats?.fangHeal) heal(world, killer, killer.maxHp * 0.08, 'fang');
      world.xp.onMonsterKilled(world, m, killer);
    }

    // buff grants — buff transfers to the killer, steals included
    if (killer && m.buff) this.grantBuff(world, killer, m.buff);
    world.emit({ type: 'monsterKilled', id: m.id, x: m.x, y: m.y, mkind: m.mkind, killerId: killer?.id ?? -1, killerTeam: killer?.team ?? -1, buff: m.buff });
    if (m.objective) world.objectives.onObjectiveKilled(world, m, killer);
  },

  grantBuff(world, hero, buffId) {
    const now = world.t;
    if (buffId === 'emberfire') {
      applyBuff(world, hero, { id: 'emberfire', until: now + CONFIG.BUFF_DURATION, icon: 'emberfire',
        mult: { dmgAmp: 0.08 }, data: { burn: 8 + hero.level * 2 } });
    } else if (buffId === 'aetherflow') {
      applyBuff(world, hero, { id: 'aetherflow', until: now + CONFIG.BUFF_DURATION, icon: 'aetherflow',
        stats: { cdr: 0.12, manaRegen: 2.4 }, mult: { spellAmp: 0.06 } });
    } else if (buffId === 'wispsight') {
      applyBuff(world, hero, { id: 'wispsight', until: now + 45, icon: 'wispsight', data: { visionBonus: 260 } });
    }
  },

  lastHeroNear(world, m) {
    let best = null, bd = 500;
    for (const h of world.heroes) {
      if (h.dead) continue;
      const d = dist(h.x, h.y, m.x, m.y);
      if (d < bd) { bd = d; best = h; }
    }
    return best;
  },

  // Hunt battle spell: massive true damage to monsters, weak vs heroes.
  castHunt(world, hero, tgt) {
    const reduce = hero.stats?.huntCdReduce || 0;
    hero.cds.spell = CONFIG.HUNT_CD - reduce;
    if (tgt && (tgt.kind === 'monster')) {
      const dmg = CONFIG.HUNT_MONSTER_BASE + CONFIG.HUNT_MONSTER_PER_LEVEL * hero.level;
      dealDamage(world, { src: hero, tgt, amount: dmg, dtype: 'true', category: 'skill', kindLabel: 'hunt' });
      heal(world, hero, hero.maxHp * 0.10, 'hunt');
      world.emit({ type: 'hunt', id: hero.id, x: tgt.x, y: tgt.y, monster: true, amount: dmg });
    } else if (tgt && tgt.kind === 'hero' && tgt.team !== hero.team) {
      dealDamage(world, { src: hero, tgt, amount: CONFIG.HUNT_HERO, dtype: 'true', category: 'skill', kindLabel: 'hunt' });
      applyCC(world, tgt, 'slow', 1.0, { pct: 0.3 });
      world.emit({ type: 'hunt', id: hero.id, x: tgt.x, y: tgt.y, monster: false });
    } else {
      // whiffed: 50% refund
      hero.cds.spell = (CONFIG.HUNT_CD - reduce) * 0.5;
      world.emit({ type: 'hunt', id: hero.id, x: hero.x, y: hero.y, monster: false, whiff: true });
    }
  },
};
