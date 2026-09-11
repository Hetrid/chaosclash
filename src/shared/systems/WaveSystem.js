// Legend Arena — lane minion wave scheduling & spawning.
import { CONFIG } from '../core/config.js';
import { createMinion } from '../entities/Minion.js';

export const WaveSystem = {
  init(world) {
    world.waveNum = 0;
    world.nextWaveAt = CONFIG.WAVE_FIRST;
  },
  tick(world) {
    if (world.t < world.nextWaveAt) return;
    world.nextWaveAt += CONFIG.WAVE_INTERVAL;
    this.spawnWave(world);
  },
  spawnWave(world) {
    world.waveNum++;
    const late = world.t > 720; // after 12 min waves escalate to close games
    const siege = world.waveNum % (late ? 2 : CONFIG.WAVE_SIEGE_EVERY) === 0;
    for (const team of [0, 1]) {
      for (const lane of ['TOP', 'MID', 'BOT']) {
        const n = world.minions.filter(m => !m.dead && m.team === team).length;
        if (n > CONFIG.MAX_MINIONS_PER_TEAM) return; // perf safety
        const add = t => { const m = createMinion(world, team, lane, t, world.waveNum); world.minions.push(m); world.grid.insert(m); };
        for (let i = 0; i < CONFIG.WAVE_MELEE + (late ? 1 : 0); i++) add('melee');
        for (let i = 0; i < CONFIG.WAVE_RANGED + (late ? 1 : 0); i++) add('ranged');
        if (siege) add('siege');
      }
    }
    world.emit({ type: 'wave', num: world.waveNum, siege });
  },
};
