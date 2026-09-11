// Legend Arena — neutral jungle monsters & major objectives.
// Camp spawner/leash/reset lives in systems/JungleSystem.js; this file is the entity + AI.
import { CONFIG } from '../core/config.js';
import { nextId } from './Hero.js';
import { dist, moveToward } from '../core/math.js';
import { dealDamage, heal } from '../game/Damage.js';

export const MONSTER_DEFS = {
  hound:  { name: 'Ridge Hound',  hp: 880,  dmg: 52, range: 90,  aspd: 0.9,  ms: 170, r: 34, gold: 44, xp: 92,  aggro: 240, leash: CONFIG.JUNGLE_LEASH, },
  sprite: { name: 'Grove Sprite', hp: 800,  dmg: 46, range: 240, aspd: 0.8,  ms: 150, r: 32, gold: 42, xp: 88,  aggro: 260, leash: CONFIG.JUNGLE_LEASH, magic: true },
  ember:  { name: 'Ember Crest Guardian', hp: 1500, dmg: 74, range: 110, aspd: 0.75, ms: 165, r: 44, gold: 72, xp: 175, aggro: 300, leash: CONFIG.JUNGLE_LEASH, buff: 'emberfire' },
  azure:  { name: 'Azure Mindkeeper', hp: 1500, dmg: 66, range: 250, aspd: 0.7, ms: 160, r: 44, gold: 72, xp: 175, aggro: 300, leash: CONFIG.JUNGLE_LEASH, buff: 'aetherflow', magic: true },
  wisp:   { name: 'River Wisp',   hp: 720,  dmg: 40, range: 200, aspd: 0.9,  ms: 190, r: 30, gold: 56, xp: 95,  aggro: 260, leash: CONFIG.JUNGLE_LEASH, buff: 'wispsight', magic: true },
  shell:  { name: 'Ancient Shell', hp: 2900, dmg: 96, range: 130, aspd: 0.62, ms: 130, r: 62, gold: 60, xp: 130, aggro: 360, leash: CONFIG.JUNGLE_LEASH, objective: 'shell' },
  colossus: { name: 'War Colossus', hp: 5600, dmg: 130, range: 150, aspd: 0.55, ms: 120, r: 72, gold: 90, xp: 210, aggro: 400, leash: CONFIG.JUNGLE_LEASH, objective: 'colossus' },
};

export function createMonster(world, kind, x, y, campId, opts = {}) {
  const d = MONSTER_DEFS[kind];
  const scale = 1 + (world.t / 60) * (opts.scalePerMin ?? 0.035);
  return {
    world,
    id: nextId(), kind: 'monster', mkind: kind, campId,
    name: d.name, x, y, homeX: x, homeY: y, r: d.r,
    hp: Math.round(d.hp * scale), maxHp: Math.round(d.hp * scale),
    physDef: kind === 'colossus' || kind === 'shell' ? 22 : 15, magDef: 15,
    dmg: d.dmg * scale, range: d.range, aspd: d.aspd, ms: d.ms,
    gold: d.gold, xp: d.xp, aggroR: d.aggro, leashR: d.leash,
    magic: !!d.magic, buff: d.buff || null, objective: d.objective || null,
    target: null, atkCd: 0, aggroT: 0, dead: false, aggroBy: null,
    facing: world.rng.f() * Math.PI * 2, hitFlash: 0,
  };
}

export function tickMonster(world, m, dt) {
  if (m.dead) return;
  m.atkCd = Math.max(0, m.atkCd - dt);
  m.hitFlash = Math.max(0, m.hitFlash - dt * 4);

  const distHome = dist(m.x, m.y, m.homeX, m.homeY);
  const t = m.target;

  // leash reset
  const attackerGone = !t || t.dead || dist(m.x, m.y, t.x, t.y) > m.leashR * 1.35;
  if (attackerGone || distHome > m.leashR) {
    if (t && (attackerGone || distHome > m.leashR)) { m.target = null; }
  }

  if (!m.target && !m.resetting) {
    // find attacker (a resetting monster ignores aggro until home)
    let best = null, bd = 1e9;
    if (m.aggroBy && !m.aggroBy.dead && dist(m.x, m.y, m.aggroBy.x, m.aggroBy.y) < m.aggroR + 200) { best = m.aggroBy; }
    if (!best) {
      world.grid.query(m.x, m.y, m.aggroR, u => {
        if (u.kind !== 'hero' || u.dead) return;
        const d = dist(m.x, m.y, u.x, u.y);
        if (d < bd) { bd = d; best = u; }
      });
    }
    if (best) m.target = best;
  }

  if (m.target && !m.target.dead) {
    const t = m.target;
    // reset if dragged too far from home
    if (dist(m.x, m.y, m.homeX, m.homeY) > m.leashR) {
      m.target = null;
      m.resetting = true;
    } else {
      m.resetting = false;
      const d = dist(m.x, m.y, t.x, t.y) - (t.r || 40);
      if (d <= m.range) {
        if (m.atkCd <= 0) {
          m.atkCd = 1 / m.aspd;
          dealDamage(world, { src: m, tgt: t, amount: m.dmg, dtype: m.magic ? 'magic' : 'phys', category: 'monster', kindLabel: m.mkind, melee: m.range < 140 });
          world.emit({ type: 'monsterAtk', x: m.x, y: m.y, id: m.id, mkind: m.mkind, tx: t.x, ty: t.y });
        }
      } else if (!m.resetting) {
        const [nx, ny] = moveToward(m.x, m.y, t.x, t.y, m.ms * dt);
        m.x = nx; m.y = ny;
        m.facing = Math.atan2(t.y - m.y, t.x - m.x);
      }
    }
  }

  if (!m.target || m.target.dead) {
    m.target = null;
    if (distHome > 4 || m.resetting) {
      const [nx, ny] = moveToward(m.x, m.y, m.homeX, m.homeY, m.ms * 1.3 * dt);
      m.x = nx; m.y = ny;
      if (dist(m.x, m.y, m.homeX, m.homeY) < 6) {
        m.resetting = false;
        if (m.hp < m.maxHp) heal(world, m, m.maxHp * 0.5, 'campRegen'); // camps recover fast at home
      }
    }
    if (m.hp < m.maxHp) heal(world, m, m.maxHp * 0.02 * dt, 'campRegen');
  }
}
