// Lane economy & wave tests: spawning, pathing, last-hit gold, XP share, lane bonuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const approx = (a, b, eps = 0.6, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ` ${a} ≈ ${b}`);
import { Sim } from '../../src/shared/game/Sim.js';
import { CONFIG } from '../../src/shared/core/config.js';
import { dealDamage } from '../../src/shared/game/Damage.js';

function base(seed = 5) {
  const mk = (hero, team, slot, role) => ({ hero, team, slot, name: 'P' + team + slot, controller: 'bot', role, botLevel: 1 });
  return new Sim({ seed, players: [
    mk('blaze', 0, 0, 'MID'), mk('arc', 0, 1, 'GOLD'), mk('ravenor', 0, 2, 'EXP'), mk('volt', 0, 3, 'JUNGLE'), mk('titan', 0, 4, 'ROAM'),
    mk('frost', 1, 0, 'MID'), mk('forge', 1, 1, 'GOLD'), mk('kaido', 1, 2, 'EXP'), mk('phantom', 1, 3, 'JUNGLE'), mk('aegiron', 1, 4, 'ROAM'),
  ] });
}

test('first wave spawns 3 melee + 2 ranged per lane per team', () => {
  const sim = base();
  for (let i = 0; i < (CONFIG.WAVE_FIRST + 0.5) * 30; i++) sim.step();
  for (const team of [0, 1]) {
    for (const lane of ['TOP', 'MID', 'BOT']) {
      const ms = sim.minions.filter(m => m.team === team && m.lane === lane);
      assert.equal(ms.filter(m => m.mtype === 'melee').length, 3, lane + ' melee');
      assert.equal(ms.filter(m => m.mtype === 'ranged').length, 2, lane + ' ranged');
    }
  }
});

test('siege minion joins every 3rd wave', () => {
  const sim = base();
  const steps = (CONFIG.WAVE_FIRST + CONFIG.WAVE_INTERVAL * 3 + 0.5) * 30;
  for (let i = 0; i < steps; i++) sim.step();
  const sieges = sim.minions.filter(m => m.mtype === 'siege');
  assert.ok(sieges.length >= 2, 'siege minions present, got ' + sieges.length);
});

test('minions advance along their lane toward the enemy base', () => {
  const sim = base();
  for (let i = 0; i < 20 * 30; i++) sim.step();
  const blueMid = sim.minions.filter(m => m.team === 0 && m.lane === 'MID' && !m.dead);
  assert.ok(blueMid.length > 0);
  const core = sim.map.core[1];
  for (const m of blueMid) {
    const dNow = Math.hypot(m.x - core[0], m.y - core[1]);
    assert.ok(dNow < 5300, 'mid minion progressing, d=' + dNow);
  }
});

test('last-hit gold goes to the killing hero', () => {
  const sim = base();
  const arc = sim.heroes.find(h => h.heroId === 'arc');
  for (let i = 0; i < (CONFIG.WAVE_FIRST + 2) * 30; i++) sim.step();
  const m = sim.minions.find(x => x.team === 1 && !x.dead);
  assert.ok(m, 'enemy minion exists');
  arc.x = m.x + 60; arc.y = m.y;
  const g0 = arc.gold;
  m.hp = 5;
  dealDamage(sim, { src: arc, tgt: m, amount: 50, dtype: 'phys', category: 'basic' });
  assert.equal(m.dead, true);
  assert.equal(arc.gold - g0, m.gold);
});

test('XP is shared to nearby enemy heroes', () => {
  const sim = base();
  const blaze = sim.heroes.find(h => h.heroId === 'blaze');
  const titan = sim.heroes.find(h => h.heroId === 'titan');
  for (let i = 0; i < (CONFIG.WAVE_FIRST + 2) * 30; i++) sim.step();
  const m = sim.minions.find(x => x.team === 1 && !x.dead);
  blaze.x = m.x; blaze.y = m.y;
  titan.x = m.x + 100; titan.y = m.y;
  const xp0 = blaze.xp, xpT = titan.xp;
  m.hp = 1;
  dealDamage(sim, { src: blaze, tgt: m, amount: 10, dtype: 'true', category: 'basic' });
  assert.ok(blaze.xp > xp0);
  assert.ok(titan.xp > xpT);
});

test('far heroes get no minion XP', () => {
  const sim = base();
  const blaze = sim.heroes.find(h => h.heroId === 'blaze');
  for (let i = 0; i < (CONFIG.WAVE_FIRST + 2) * 30; i++) sim.step();
  const m = sim.minions.find(x => x.team === 1 && !x.dead);
  blaze.x = 400; blaze.y = 400; // away from any dying wave? ensure far
  blaze.x = sim.map.core[1][0] - 100; blaze.y = sim.map.core[1][1] - 100;
  const far = sim.heroes.find(h => h.heroId === 'frost');
  far.x = sim.map.core[0][0]; far.y = sim.map.core[0][1]; // far from the dying minion
  const m2 = sim.minions.find(x => x.team === 0 && !x.dead && Math.hypot(x.x - far.x, x.y - far.y) > CONFIG.XP_RADIUS + 200);
  if (!m2) return; // skip if all minions are near (small map states)
  const xp0 = far.xp;
  m2.hp = 1;
  dealDamage(sim, { src: blaze, tgt: m2, amount: 10, dtype: 'true', category: 'basic' });
  assert.equal(far.xp, xp0);
});
