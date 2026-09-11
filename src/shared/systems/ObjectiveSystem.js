// Legend Arena — major neutral objectives: Ancient Shell (early team objective)
// and War Colossus (late siege objective that joins the killing team's push).
import { CONFIG } from '../core/config.js';
import { createMonster } from '../entities/Monster.js';
import { addGold } from '../game/Damage.js';
import { applyBuff } from '../game/StatusSystem.js';
import { refreshMax } from '../entities/Hero.js';
import { dist } from '../core/math.js';
import { isHero } from '../entities/kinds.js';
import { LANES } from '../map/MapData.js';

export const ObjectiveSystem = {
  init(world) {
    world.objectiveState = {
      shell: { alive: false, nextAt: CONFIG.SHELL_FIRST, id: null },
      colossus: { alive: false, nextAt: CONFIG.COLOSSUS_FIRST, id: null },
    };
  },

  tick(world) {
    const st = world.objectiveState;
    if (!st.shell.alive && world.t >= st.shell.nextAt) this.spawnObjective(world, 'shell');
    if (!st.colossus.alive && world.t >= st.colossus.nextAt) this.spawnObjective(world, 'colossus');
    // colossus siege pets march
    for (const pet of world.colossi) this.tickColossusPet(world, pet);
  },

  spawnObjective(world, which) {
    const def = world.map.objectives[which];
    const m = createMonster(world, which, def.x, def.y, 'obj_' + which, { scalePerMin: which === 'shell' ? 0.03 : 0.05 });
    world.monsters.push(m);
    world.grid.insert(m);
    world.register(m);
    const st = world.objectiveState[which];
    st.alive = true; st.id = m.id; st.monsterId = m.id;
    world.objectiveFocus = { which, monsterId: m.id, until: world.t + (which === 'shell' ? 55 : 70) };
    world.emit({ type: 'objectiveSpawn', which, x: def.x, y: def.y, id: m.id });
  },

  onObjectiveKilled(world, m, killer) {
    if (m.objective === 'shell') {
      const st = world.objectiveState.shell;
      st.alive = false; st.nextAt = world.t + CONFIG.SHELL_RESPAWN;
      const team = killer ? killer.team : 0;
      for (const h of world.heroes) {
        if (h.team !== team) continue;
        addGold(world, h, 150, 'shell');
        world.xp.grantXp(world, h, 120);
        applyBuff(world, h, { id: 'shellguard', until: world.t + 60, icon: 'shellguard', data: { shieldPct: 0.10 + h.level * 0.02 } });
      }
      // instant team shield
      for (const h of world.heroes) {
        if (h.team === team && !h.dead) addShield(world, h, 120 + 25 * h.level, 60, 'shellguard');
      }
      world.emit({ type: 'objectiveKill', which: 'shell', team, x: m.x, y: m.y });
    } else if (m.objective === 'colossus') {
      const st = world.objectiveState.colossus;
      st.alive = false; st.nextAt = world.t + CONFIG.COLOSSUS_RESPAWN;
      const team = killer ? killer.team : 0;
      for (const h of world.heroes) {
        if (h.team !== team) continue;
        addGold(world, h, 200, 'colossus');
        world.xp.grantXp(world, h, 250);
      }
      this.spawnColossusPet(world, team, m);
      world.emit({ type: 'objectiveKill', which: 'colossus', team, x: m.x, y: m.y });
    }
  },

  spawnColossusPet(world, team, fromMonster) {
    // A siege golem joins the winning team's MID push.
    const [cx, cy] = world.map.core[team];
    const scale = 1 + (world.t / 60) * 0.04;
    const pet = {
      world,
      id: Math.random().toString(36).slice(2), kind: 'colossus', team,
      x: cx, y: cy, r: 70,
      hp: Math.round(5200 * scale), maxHp: Math.round(5200 * scale),
      physDef: 25, magDef: 25,
      dmg: 190 * scale, range: 160, aspd: 0.6, ms: 132, atkCd: 0,
      path: LANES.MID.slice(), wp: 1, target: null, retarget: 0, dead: false,
      buffOwner: team,
    };
    world.colossi.push(pet);
    world.grid.insert(pet);
    world.register(pet);
  },

  tickColossusPet(world, pet) {
    if (pet.dead) return;
    pet.atkCd = Math.max(0, pet.atkCd - dt_of(world));
    pet.retarget -= dt_of(world);
    if (pet.retarget <= 0) {
      pet.retarget = 0.5;
      pet.target = null;
      let bd = 420;
      // structures first
      for (const s of world.structures) {
        if (s.dead || s.team === pet.team) continue;
        const d = dist(pet.x, pet.y, s.x, s.y);
        if (d < bd) { bd = d; pet.target = s; }
      }
      // nearby defenders override if very close
      world.grid.query(pet.x, pet.y, 260, u => {
        if (u.dead || u.team === pet.team) return;
        const d = dist(pet.x, pet.y, u.x, u.y);
        if (d < Math.min(bd, 240)) { bd = d; pet.target = u; }
      });
    }
    const t = pet.target;
    if (t && !t.dead) {
      const d = dist(pet.x, pet.y, t.x, t.y) - (t.r || 30);
      if (d <= pet.range) {
        if (pet.atkCd <= 0) {
          pet.atkCd = 1 / pet.aspd;
          dealDamageColossus(world, pet, t);
        }
      } else {
        const wp = t;
        const dx = wp.x - pet.x, dy = wp.y - pet.y, dd = Math.hypot(dx, dy) || 1;
        pet.x += dx / dd * pet.ms * dt_of(world); pet.y += dy / dd * pet.ms * dt_of(world);
      }
    } else {
      const wp = pet.path[Math.min(pet.wp, pet.path.length - 1)];
      const d = dist(pet.x, pet.y, wp[0], wp[1]);
      if (d < 100 && pet.wp < pet.path.length - 1) pet.wp++;
      const dx = wp[0] - pet.x, dy = wp[1] - pet.y, dd = Math.hypot(dx, dy) || 1;
      pet.x += dx / dd * pet.ms * dt_of(world); pet.y += dy / dd * pet.ms * dt_of(world);
    }
  },

  onTurretKilled(world, turret, src) {
    this.gold?.();
    world.gold.onTurretKilledReward(world, turret, src);
    world.emit({ type: 'turretKilled', id: turret.id, team: turret.team, lane: turret.lane, tier: turret.tier, x: turret.x, y: turret.y, byTeam: src?.team ?? -1 });
    updateStructureVulnerabilitySafe(world);
  },

  onCoreKilled(world, core) {
    world.matchOver = { winner: core.team === 0 ? 1 : 0, reason: 'core' };
    world.emit({ type: 'coreDestroyed', team: core.team, winner: world.matchOver.winner });
  },
};

// small helpers to avoid circular imports at module load
import { dealDamage, addShield } from '../game/Damage.js';
import { updateStructureVulnerability } from '../entities/Turret.js';
function dealDamageColossus(world, pet, t) {
  dealDamage(world, { src: pet, tgt: t, amount: pet.dmg, dtype: 'phys', category: 'summon', kindLabel: 'colossus', melee: true });
}
function updateStructureVulnerabilitySafe(world) { updateStructureVulnerability(world); }
function dt_of(world) { return world.dt || 1 / 30; }
