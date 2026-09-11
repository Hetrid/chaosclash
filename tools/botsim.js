// Legend Arena — deterministic headless bot-vs-bot match runner.
// Usage: node tools/botsim.js [--seed N] [--minutes N] [--diff 1|2|3] [--quiet]
// Used by CI/tests to prove: waves, farming, jungle, objectives, turrets, win conditions.
import { Sim } from '../src/shared/game/Sim.js';
import { HERO_LIST } from '../src/shared/heroes/HeroRegistry.js';

const args = process.argv.slice(2);
const arg = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const seed = parseInt(arg('--seed', '7'));
const maxMin = parseFloat(arg('--minutes', '25'));
const diff = parseInt(arg('--diff', '2'));
const quiet = args.includes('--quiet');

const ROLES = ['MID', 'GOLD', 'EXP', 'JUNGLE', 'ROAM'];
function pickRoster(rng) {
  const pool = [...HERO_LIST];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  return pool;
}
const rngSeq = (() => { let z = seed >>> 0; return () => { z |= 0; z = (z + 0x6D2B79F5) | 0; let t = Math.imul(z ^ (z >>> 15), 1 | z); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
const roster = pickRoster(rngSeq);

const players = [];
for (let i = 0; i < 5; i++) players.push({ hero: roster[i], team: 0, slot: i, name: 'Blue' + (i + 1), controller: 'bot', role: ROLES[i], botLevel: diff });
for (let i = 0; i < 5; i++) players.push({ hero: roster[5 + i], team: 1, slot: i, name: 'Red' + (i + 1), controller: 'bot', role: ROLES[i], botLevel: diff });

const sim = new Sim({ seed, players });
const maxSteps = maxMin * 60 * 30;
let steps = 0;
const stats = { minionDeaths: 0, heroKills: 0, turretKills: 0, monsterKills: 0, objKills: 0, hunts: 0, campsCleared: 0 };
let lastEvents = [];
while (!sim.matchOver && steps < maxSteps) {
  sim.step();
  steps++;
  for (const e of sim.drainEvents()) {
    if (e.type === 'kill') stats.heroKills++;
    if (e.type === 'death' && e.kind === 'minion') stats.minionDeaths++;
    if (e.type === 'turretKilled') stats.turretKills++;
    if (e.type === 'monsterKilled') { stats.monsterKills++; if (e.buff) stats.campsCleared++; }
    if (e.type === 'objectiveKill') stats.objKills++;
    if (e.type === 'hunt') stats.hunts++;
  }
}
const winner = sim.matchOver?.winner ?? -1;
const duration = sim.t;
if (!quiet) {
  console.log('=== Legend Arena bot-vs-bot ===');
  console.log('seed', seed, 'diff', diff, '| result:', sim.matchOver ? `team ${winner} wins (${sim.matchOver.reason})` : 'TIMEOUT (no result)');
  console.log('duration:', Math.floor(duration / 60) + ':' + String(Math.floor(duration % 60)).padStart(2, '0'), '| steps:', steps);
  console.log('stats:', JSON.stringify(stats));
  for (const team of [0, 1]) {
    const heroes = sim.heroes.filter(h => h.team === team);
    const gold = heroes.reduce((a, h) => a + h.goldEarned, 0);
    const k = heroes.reduce((a, h) => a + h.kills, 0), d = heroes.reduce((a, h) => a + h.deaths, 0), a = heroes.reduce((a, h) => a + h.assists, 0);
    const lv = (heroes.reduce((s, h) => s + h.level, 0) / 5).toFixed(1);
    const items = heroes.reduce((s, h) => s + h.items.length, 0);
    console.log(`team${team}: lv${lv} kda ${k}/${d}/${a} gold ${gold} items ${items} | ` + heroes.map(h => `${h.heroId}(${h.level})`).join(' '));
  }
  const s0 = sim.structures.filter(s => s.team === 0 && s.dead).length;
  const s1 = sim.structures.filter(s => s.team === 1 && s.dead).length;
  console.log('structures destroyed: blue', s0, '| red', s1);
}
// machine-readable exit line for tests
console.log(JSON.stringify({ ok: !!sim.matchOver, winner, duration, stats, levels: sim.heroes.map(h => h.level), items: sim.heroes.map(h => h.items.length) }));
process.exit(sim.matchOver ? 0 : 2);
