// Legend Arena — original item ecosystem with component build paths.
// Stats flow through computeStats(); uniques are flags consumed by Damage/kits/systems.
export const ITEMS = {
  // ---- components ----
  broadsword: { n: 'Broadsword', cat: 'attack', cost: 480, stats: { physAtk: 20 }, comp: true },
  wand:       { n: 'Blasting Wand', cat: 'magic', cost: 480, stats: { magPower: 22 }, comp: true },
  ruby:       { n: 'Ruby Crystal', cat: 'defense', cost: 460, stats: { maxHp: 190 }, comp: true },
  vest:       { n: 'Leather Vest', cat: 'defense', cost: 480, stats: { physDef: 24 }, comp: true },
  charm:      { n: 'Warding Charm', cat: 'defense', cost: 480, stats: { magDef: 24 }, comp: true },
  dagger:     { n: 'Swift Dagger', cat: 'attack', cost: 420, stats: { aspd: 0.14 }, comp: true },
  boots:      { n: 'Boots', cat: 'move', cost: 500, stats: { ms: 45 }, comp: true },
  vampshard:  { n: 'Vampiric Shard', cat: 'attack', cost: 950, stats: { lifesteal: 0.14 }, comp: true },
  haste:      { n: 'Glyph of Haste', cat: 'magic', cost: 850, stats: { cdr: 0.10 }, comp: true },
  sapphire:   { n: 'Sapphire Pendant', cat: 'magic', cost: 380, stats: { maxMana: 150, manaRegen: 0.6 }, comp: true },

  // ---- ATTACK ----
  swiftbow:  { n: 'Swiftfeather Bow', cat: 'attack', cost: 1700, from: ['dagger', 'dagger'], stats: { aspd: 0.38, ms: 24 } },
  saber:     { n: 'Emberstrike Saber', cat: 'attack', cost: 2150, from: ['broadsword', 'broadsword'], stats: { physAtk: 48, critChance: 0.15 } },
  bloodpiercer: { n: 'Bloodpiercer', cat: 'attack', cost: 2050, from: ['vampshard', 'broadsword'], stats: { physAtk: 26, lifesteal: 0.20 } },
  tempest:   { n: 'Tempest Glaive', cat: 'attack', cost: 2450, from: ['dagger', 'broadsword', 'dagger'], stats: { physAtk: 30, aspd: 0.45 }, flags: { tempestExec: 1 }, unique: 'Basic attacks deal +12% damage to enemies below 50% HP.' },
  dawnedge:  { n: 'Dawnedge', cat: 'attack', cost: 2650, from: ['saber', 'broadsword'], stats: { physAtk: 70, critChance: 0.20 }, flags: { dawnedgeHeal: 1 }, unique: 'Critical hits heal you for 2.5% max HP.' },
  stormpike: { n: 'Stormpike', cat: 'attack', cost: 2400, from: ['broadsword', 'haste'], stats: { physAtk: 42, cdr: 0.12, physPen: 14 } },

  // ---- ATTACK (tier 2/3) ----
  duskblade:  { n: 'Duskblade', cat: 'attack', cost: 2300, from: ['saber', 'haste'], stats: { physAtk: 52, cdr: 0.10 } },
  waraxe:     { n: 'Reaver Waraxe', cat: 'attack', cost: 2600, from: ['broadsword', 'dagger', 'vampshard'], stats: { physAtk: 40, aspd: 0.22, lifesteal: 0.10 } },
  skypiercer: { n: 'Skypiercer', cat: 'attack', cost: 3010, from: ['saber', 'dagger'], stats: { physAtk: 45, critChance: 0.25, physPen: 16 }, unique: 'Critical hits pierce 15% of the target armor.' },
  titanlayer: { n: 'Titanlayer Bow', cat: 'attack', cost: 2250, from: ['dagger', 'dagger', 'broadsword'], stats: { aspd: 0.35, critChance: 0.18, ms: 20 } },

  // ---- MAGIC ----
  codex:     { n: 'Crystal Codex', cat: 'magic', cost: 1950, from: ['wand', 'wand'], stats: { magPower: 52, maxMana: 220 } },
  voidscepter: { n: 'Void Scepter', cat: 'magic', cost: 2400, from: ['wand', 'sapphire'], stats: { magPower: 55, magPenPct: 0.18 } },
  emberheart:{ n: 'Emberheart Orb', cat: 'magic', cost: 2200, from: ['wand', 'vampshard'], stats: { magPower: 40, spellVamp: 0.12 } },
  frostlens: { n: 'Frostlens Staff', cat: 'magic', cost: 2550, from: ['wand', 'wand', 'haste'], stats: { magPower: 58, cdr: 0.08 }, flags: { chill: 1 }, unique: 'Your skills chill targets: 15% slow for 1s.' },
  stormtome: { n: 'Stormcaller Tome', cat: 'magic', cost: 2750, from: ['codex', 'wand'], stats: { magPower: 75, cdr: 0.12, maxMana: 200 } },

  astralrod:  { n: 'Astral Rod', cat: 'magic', cost: 2100, from: ['wand', 'sapphire'], stats: { magPower: 48, manaRegen: 1.2, cdr: 0.08 } },
  voidflare:  { n: 'Voidflare', cat: 'magic', cost: 2900, from: ['voidscepter', 'wand'], stats: { magPower: 62, magPenPct: 0.28 } },
  icecrystal: { n: 'Glacier Orb', cat: 'magic', cost: 2350, from: ['wand', 'charm'], stats: { magPower: 45, maxHp: 300 }, flags: { chill: 1 }, unique: 'Your skills chill targets: 15% slow for 1s.' },

  // ---- DEFENSE ----
  ironbark:  { n: 'Ironbark Plate', cat: 'defense', cost: 1950, from: ['vest', 'vest'], stats: { physDef: 64, maxHp: 450 } },
  runeward:  { n: 'Runeward Mantle', cat: 'defense', cost: 1950, from: ['charm', 'charm'], stats: { magDef: 64, maxHp: 380 } },
  colossus:  { n: 'Colossus Hide', cat: 'defense', cost: 2850, from: ['ironbark', 'ruby'], stats: { maxHp: 850, physDef: 30, magDef: 30, hpRegen: 12 } },
  bramble:   { n: 'Bramble Aegis', cat: 'defense', cost: 2350, from: ['ironbark', 'vest'], stats: { physDef: 55, maxHp: 520 }, flags: { thorns: 42 }, unique: 'Melee basic attackers take 42 magic damage.' },
  phoenix:   { n: 'Phoenix Feather', cat: 'defense', cost: 2750, from: ['runeward', 'ruby', 'haste'], stats: { maxHp: 420, magDef: 52, cdr: 0.08 }, flags: { phoenix: 1 }, unique: 'Once per 180s: survive a fatal blow, revive at 25% HP.' },

  wintercrown:{ n: 'Winterpact Crown', cat: 'defense', cost: 2400, from: ['charm', 'haste', 'ruby'], stats: { magDef: 55, cdr: 0.10, maxHp: 300 }, flags: { chill: 1 }, unique: 'Your skills chill targets: 15% slow for 1s.' },
  aegisdawn:  { n: 'Aegis of Dawn', cat: 'defense', cost: 2550, from: ['vest', 'charm', 'ruby'], stats: { physDef: 42, magDef: 42, maxHp: 400 } },
  guardianhelm:{ n: 'Guardian Helm', cat: 'defense', cost: 2150, from: ['ruby', 'vest'], stats: { maxHp: 620, hpRegen: 18 } },
  curseblade: { n: 'Cursed Bladeguard', cat: 'defense', cost: 2650, from: ['ironbark', 'vampshard'], stats: { physDef: 48, maxHp: 350, lifesteal: 0.10 } },

  // ---- MOVEMENT ----
  arcanetreads: { n: 'Arcane Treads', cat: 'move', cost: 750, from: ['boots', 'sapphire'], stats: { ms: 65, cdr: 0.10, maxMana: 150 } },
  greaves:   { n: 'Warrior Greaves', cat: 'move', cost: 750, from: ['boots', 'vest'], stats: { ms: 65, physDef: 20 } },
  stoneguard:{ n: 'Stoneguard Sandals', cat: 'move', cost: 750, from: ['boots', 'charm'], stats: { ms: 65, tenacity: 0.22 } },
  gale:      { n: 'Gale Striders', cat: 'move', cost: 800, from: ['boots', 'dagger'], stats: { ms: 90, aspd: 0.08 } },

  // ---- JUNGLE (jungle role only) ----
  talon:     { n: 'Beastclaw Talon', cat: 'jungle', cost: 1100, from: ['dagger', 'broadsword'], stats: { physAtk: 18, aspd: 0.10, monsterDmgAmp: 0.18 }, flags: { campBonus: 0.20, huntCdReduce: 10 }, role: 'JUNGLE' },
  predator:  { n: "Predator's Fang", cat: 'jungle', cost: 2100, from: ['talon', 'broadsword'], stats: { physAtk: 40, monsterDmgAmp: 0.25 }, flags: { campBonus: 0.20, huntCdReduce: 10, fangHeal: 1 }, role: 'JUNGLE', unique: 'Monster kills restore 8% max HP.' },

  // ---- ROAM (roam role only) ----
  compass:   { n: "Wayfarer's Compass", cat: 'roam', cost: 900, from: ['boots', 'sapphire'], stats: { ms: 55, maxMana: 100 }, flags: { roamPact: 1 }, role: 'ROAM', unique: '+2.2 gold/s. Allied last-hits near you pay you 60% of their value.' },
  sentineloath: { n: "Sentinel's Oath", cat: 'roam', cost: 1800, from: ['compass', 'ruby'], stats: { maxHp: 420, physDef: 30, magDef: 30, ms: 30 }, flags: { roamPact: 1, sentinel: 1 }, role: 'ROAM', unique: 'Allies you shield or heal gain +10% defenses for 3s.' },
};

export const ITEM_IDS = Object.keys(ITEMS);
export const isComponent = id => !!ITEMS[id]?.comp;

// value of owned components credited when buying a final item
export function buildPathValue(id, owned) {
  const item = ITEMS[id];
  if (!item?.from) return 0;
  let v = 0;
  for (const c of item.from) if (owned.includes(c)) v += ITEMS[c].cost;
  return v;
}

export function recommendedBuild(heroDef) {
  return heroDef.build.slice();
}
