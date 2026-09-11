// Legend Arena — unified combat stat pipeline.
// Every combatant's effective stats are computed here from: base + level growth + items + buffs.
import { CONFIG } from '../core/config.js';
import { clamp } from '../core/math.js';
import { ITEMS } from '../systems/Items.js';

// Hero archetype growth tables (per level, applied at each level-up)
export const GROWTH = {
  mage:     { hp: 74,  hpRegen: 0.14, mana: 42,  manaRegen: 0.32, physAtk: 4.5, magPower: 0, physDef: 3.0, magDef: 3.0, aspdPct: 0.014, ms: 0 },
  marksman: { hp: 84,  hpRegen: 0.13, mana: 30,  manaRegen: 0.26, physAtk: 9.5, magPower: 0, physDef: 3.2, magDef: 3.0, aspdPct: 0.030, ms: 0 },
  assassin: { hp: 88,  hpRegen: 0.15, mana: 34,  manaRegen: 0.28, physAtk: 8.5, magPower: 0, physDef: 3.6, magDef: 3.0, aspdPct: 0.026, ms: 0 },
  fighter:  { hp: 112, hpRegen: 0.20, mana: 30,  manaRegen: 0.24, physAtk: 8.0, magPower: 0, physDef: 4.4, magDef: 3.4, aspdPct: 0.022, ms: 0 },
  tank:     { hp: 148, hpRegen: 0.24, mana: 28,  manaRegen: 0.22, physAtk: 6.0, magPower: 0, physDef: 4.8, magDef: 3.6, aspdPct: 0.016, ms: 0 },
  support:  { hp: 96,  hpRegen: 0.18, mana: 40,  manaRegen: 0.34, physAtk: 5.5, magPower: 0, physDef: 3.6, magDef: 3.2, aspdPct: 0.016, ms: 0 },
};

export const emptyStats = () => ({
  maxHp: 0, hpRegen: 0, maxMana: 0, manaRegen: 0,
  physAtk: 0, magPower: 0, physDef: 0, magDef: 0,
  aspd: 0, cdr: 0, ms: 0, critChance: 0, critDmg: CONFIG.CRIT_DMG,
  physPen: 0, physPenPct: 0, magPen: 0, magPenPct: 0,
  lifesteal: 0, spellVamp: 0, attackRange: 0, tenacity: 0,
  dmgAmp: 0, dmgReduction: 0, healAmp: 1, monsterDmgAmp: 0, structDmgAmp: 0,
  thorns: 0, maxShieldFrac: 0.4,
});

export function addStats(into, src, mult = 1) {
  for (const k in src) {
    const v = src[k];
    if (typeof v !== 'number') continue;
    into[k] = (into[k] || 0) + v * mult;
  }
}

// Buff entries may carry flat stat adds and/or multiplicative amps:
// buff.stats = { physAtk: +20 } (flat), buff.mult = { dmgAmp: 0.15 } (fractional adds)
export function computeStats(u) {
  const s = emptyStats();
  const def = u.def;
  const lv = (u.level || 1) - 1;
  const g = GROWTH[def.archetype] || GROWTH.fighter;

  s.maxHp = def.hp + g.hp * lv;
  s.hpRegen = def.hpRegen + g.hpRegen * lv;
  s.maxMana = def.mana ? def.mana + g.mana * lv : 0;
  s.manaRegen = def.mana ? (def.manaRegen ?? 3.2) + g.manaRegen * lv : 0;
  s.physAtk = def.physAtk + g.physAtk * lv;
  s.magPower = (def.magPower || 0) + (def.magPerLevel || 0) * lv;
  s.physDef = def.physDef + g.physDef * lv;
  s.magDef = def.magDef + g.magDef * lv;
  s.aspd = def.aspd * (1 + (g.aspdPct || 0) * lv);
  s.ms = def.ms;
  s.attackRange = def.range;
  s.critChance = def.critChance || 0;

  // items
  for (const iid of u.items || []) {
    const item = ITEMS[iid];
    if (!item) continue;
    addStats(s, item.stats || {});
    if (item.flags) for (const k in item.flags) s[k] = (s[k] || 0) + item.flags[k];
  }

  // active buffs
  for (const b of u.buffs || []) {
    if (b.stats) for (const k in b.stats) s[k] = (s[k] || 0) + b.stats[k];
    if (b.mult) for (const k in b.mult) s[k] = (s[k] || 0) + b.mult[k];
    if (b.multPct) for (const k in b.multPct) s[k] = (s[k] || 0) + (baseStat(s, k)) * b.multPct[k];
  }

  // role/trinket passives injected as pseudo-buffs by systems (roam pact etc. arrive as buffs)
  s.cdr = clamp(s.cdr, 0, CONFIG.CDR_CAP);
  s.tenacity = clamp(s.tenacity, 0, CONFIG.TENACITY_CAP);
  s.aspd = clamp(s.aspd, 0.25, CONFIG.ASPD_CAP);
  s.critChance = clamp(s.critChance, 0, 1);
  s.lifesteal = clamp(s.lifesteal, 0, 1);
  s.spellVamp = clamp(s.spellVamp, 0, 1);
  return s;
}

function baseStat(s, k) { return s[k] || 0; }

// Damage mitigation curve: 100/(100+effDef) ⇒ 100 def = 50% reduction.
export function mitigate(amount, effDef) {
  return amount * 100 / (100 + Math.max(0, effDef));
}

export function effectiveDef(u, dtype, srcStats) {
  let def;
  if (dtype === 'magic') {
    def = (u.magDef ?? 0);
    if (srcStats) { def = Math.max(0, def - (srcStats.magPen || 0)); def *= 1 - clamp(srcStats.magPenPct || 0, 0, 0.8); }
  } else {
    def = (u.physDef ?? 0);
    if (srcStats) { def = Math.max(0, def - (srcStats.physPen || 0)); def *= 1 - clamp(srcStats.physPenPct || 0, 0, 0.8); }
  }
  return def;
}
