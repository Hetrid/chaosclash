// Legend Arena — global tunables. All timings in seconds unless noted.
export const CONFIG = {
  WORLD: 6400,
  SIM_DT: 1 / 30,               // authoritative simulation step (client renders/interpolates at 60fps)
  TICK_RATE: 30,
  SNAP_HZ: 10,                  // network snapshot rate (host → clients)
  INPUT_HZ: 10,                 // client input send rate (batched)

  FOUNTAIN_HEAL: 0.11,          // % maxHP per second at fountain
  FOUNTAIN_MANA: 0.14,
  FOUNTAIN_DPS: 420,            // anti-dive laser
  SHOP_RADIUS: 760,
  RECALL_TIME: 3.5,
  RESPAWN_BASE: 5, RESPAWN_PER_LEVEL: 2.2, RESPAWN_CAP: 42,
  SPAWN_SHIELD_S: 2.5,          // post-respawn immunity that breaks on acting

  LEVELS: 15,
  XP_RADIUS: 900,               // hero XP share radius from dying minions/monsters
  GOLD_MINION_MELEE: 30, GOLD_MINION_RANGED: 26, GOLD_MINION_SIEGE: 66,
  XP_MINION_MELEE: 42, XP_MINION_RANGED: 38, XP_MINION_SIEGE: 82,
  GOLD_PASSIVE: 3.2,            // gold/sec baseline income
  GOLD_START: 400,
  ASSIST_WINDOW: 10,
  ASSIST_SHARE: 0.45,

  MINION_VS_HERO: 0.32,         // lane minions chip heroes, never shred them
  SHOP_ANYWHERE: true,          // MLBB-style: buy/sell from anywhere on the map
  WAVE_INTERVAL: 24, WAVE_FIRST: 3,
  WAVE_MELEE: 3, WAVE_RANGED: 2, WAVE_SIEGE_EVERY: 3,
  MINION_SCALE_PER_MIN: 0.042,  // hp/dmg growth per minute

  TURRET_RANGE: 470,
  TURRET_VS_HERO: 185,
  TURRET_RAMP: 0.24, TURRET_RAMP_MAX: 5,
  TURRET_VS_MINION: 210,
  TURRET_GOLD_TEAM: 135,
  BACKDOOR_RADIUS: 820,
  BACKDOOR_HERO_MULT: 0.25,     // hero → structure damage without allied wave nearby
  BACKDOOR_REGEN: 0.004,        // %maxHP/s while protected

  JUNGLE_LEASH: 760,
  CAMP_RESPAWN_SMALL: 50, CAMP_RESPAWN_BUFF: 90, CAMP_RESPAWN_WISP: 60,

  HUNT_CD: 40, HUNT_MONSTER_BASE: 420, HUNT_MONSTER_PER_LEVEL: 60, HUNT_HERO: 70,

  SHELL_FIRST: 115, SHELL_RESPAWN: 150,       // Ancient Shell
  COLOSSUS_FIRST: 360, COLOSSUS_RESPAWN: 210, // War Colossus
  BUFF_DURATION: 60,

  SURRENDER_MIN_TIME: 180, SURRENDER_VOTE_TIME: 15, SURRENDER_COOLDOWN: 180,

  ASPD_CAP: 2.5, CDR_CAP: 0.4, TENACITY_CAP: 0.6,
  CRIT_DMG: 2.0,
  SHIELD_DECAY: 0,              // shields expire via their own durations

  MAX_MINIONS_PER_TEAM: 42,     // hard safety cap for perf
  PROJECTILE_POOL: 320,
};
