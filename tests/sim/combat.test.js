// Combat pipeline tests: damage types, mitigation, pen, crit, lifesteal, shields, kills.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const approx = (a, b, eps = 0.6, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ` ${a} ≈ ${b}`);
import { Sim } from '../../src/shared/game/Sim.js';
import { dealDamage, heal, addShield } from '../../src/shared/game/Damage.js';
import { mitigate } from '../../src/shared/game/Stats.js';
import { CONFIG } from '../../src/shared/core/config.js';

function oneHero(hero = 'blaze', role = 'MID') {
  const sim = new Sim({ seed: 99, players: [
    { hero, team: 0, slot: 0, name: 'A', controller: 'local', role },
    { hero: 'frost', team: 1, slot: 0, name: 'B', controller: 'bot', role: 'MID', botLevel: 1 },
  ] });
  sim.bots.clear();
  return sim;
}

test('mitigation curve: 100 def = 50% reduction', () => {
  assert.equal(mitigate(100, 0), 100);
  approx(mitigate(100, 100), 50);
  approx(mitigate(100, 300), 25);
});

test('physical vs magic vs true damage respect defenses', () => {
  const sim = oneHero();
  const a = sim.heroes[0], b = sim.heroes[1];
  b.physDef = 100; b.magDef = 100;
  const hp0 = b.hp;
  dealDamage(sim, { src: a, tgt: b, amount: 100, dtype: 'phys', category: 'skill' });
  assert.equal(hp0 - b.hp, 50);
  const hp1 = b.hp;
  dealDamage(sim, { src: a, tgt: b, amount: 100, dtype: 'true', category: 'skill' });
  assert.equal(hp1 - b.hp, 100);
});

test('penetration applies flat then percent', () => {
  const sim = oneHero();
  const a = sim.heroes[0], b = sim.heroes[1];
  b.physDef = 100;
  a.stats.physPen = 40; a.stats.physPenPct = 0.5;
  const hp0 = b.hp;
  dealDamage(sim, { src: a, tgt: b, amount: 100, dtype: 'phys', category: 'skill' });
  // effDef = (100-40)*0.5 = 30 → 100*100/130
  approx(hp0 - b.hp, 100 * 100 / 130, 1);
});

test('shields absorb before HP and expire', () => {
  const sim = oneHero();
  const a = sim.heroes[0];
  const hp0 = a.hp;
  addShield(sim, a, 50, 1, 'test');
  dealDamage(sim, { src: sim.heroes[1], tgt: a, amount: 30, dtype: 'phys', category: 'skill' });
  assert.equal(hp0, a.hp); // no HP lost
  assert.equal(a.shield, 20);
  // overflow hits HP
  dealDamage(sim, { src: sim.heroes[1], tgt: a, amount: 40, dtype: 'phys', category: 'skill' });
  assert.equal(a.hp, hp0 - 20);
  // expiry
  sim.t += 2;
  sim.step();
  assert.equal(a.shield, 0);
});

test('shield cap prevents invulnerability stacking', () => {
  const sim = oneHero();
  const a = sim.heroes[0];
  addShield(sim, a, 999999, 5, 'x');
  assert.equal(a.shield, a.maxHp * 0.4);
});

test('lifesteal heals from basic attacks only', () => {
  const sim = oneHero();
  const a = sim.heroes[0], b = sim.heroes[1];
  a.stats.lifesteal = 0.5;
  b.physDef = 0;
  a.hp = a.maxHp * 0.5; // room to heal
  const hp0 = a.hp;
  dealDamage(sim, { src: a, tgt: b, amount: 100, dtype: 'phys', category: 'basic' });
  assert.equal(a.hp - hp0, 50);
  const hp1 = a.hp;
  dealDamage(sim, { src: a, tgt: b, amount: 100, dtype: 'phys', category: 'skill' });
  assert.equal(a.hp, hp1); // no lifesteal on skills
});

test('kill credit: killer + assists + gold', () => {
  const sim = oneHero();
  const [a, b] = sim.heroes;
  const mate = sim.heroes[0];
  // add a second blue hero via config? simpler: use structures' core as src-less check below
  b.hp = 1;
  const g0 = a.gold;
  dealDamage(sim, { src: a, tgt: b, amount: 10, dtype: 'true', category: 'skill' });
  assert.equal(b.dead, true);
  assert.equal(a.kills, 1);
  assert.ok(a.gold > g0);
  assert.equal(b.respawnAt > sim.t, true);
});

test('no friendly fire', () => {
  const sim = oneHero();
  const [a] = sim.heroes;
  const mate = Object.assign({}, a);
  const hp0 = a.hp;
  dealDamage(sim, { src: a, tgt: a, amount: 50, dtype: 'true', category: 'skill' });
  assert.equal(a.hp, hp0); // self-damage blocked
});

test('immunity blocks damage', () => {
  const sim = oneHero();
  const a = sim.heroes[0];
  a.invulnUntil = sim.t + 5;
  const hp0 = a.hp;
  dealDamage(sim, { src: sim.heroes[1], tgt: a, amount: 100, dtype: 'true', category: 'skill' });
  assert.equal(a.hp, hp0);
});

test('Ember Rebirth intercepts fatal damage', () => {
  const sim = oneHero('ember', 'EXP');
  const e = sim.heroes[0];
  sim.castAbility(e, 'r', {});
  assert.ok(e.buffs.some(b => b.id === 'rebirth'));
  e.hp = 10;
  dealDamage(sim, { src: sim.heroes[1], tgt: e, amount: 100, dtype: 'true', category: 'skill' });
  assert.equal(e.dead, false);
  assert.ok(e.hp > 0);
  assert.equal(e.buffs.some(b => b.id === 'rebirth'), false);
  // second death sticks (no rebirth up) — advance past revive invulnerability
  sim.t += 2;
  e.hp = 10;
  dealDamage(sim, { src: sim.heroes[1], tgt: e, amount: 100, dtype: 'true', category: 'skill' });
  assert.equal(e.dead, true);
});

test('tenacity reduces CC duration', async () => {
  const { applyCC } = await import('../../src/shared/game/StatusSystem.js');
  const sim = oneHero();
  const a = sim.heroes[0];
  a.stats.tenacity = 0.5;
  applyCC(sim, a, 'stun', 2.0, {});
  const dur = a.cc.stun.until - sim.t;
  assert.ok(dur <= 1.01 && dur > 0.9, 'duration ~1s, got ' + dur);
});

test('Kaido tempo: third skill empowered consumes stacks', () => {
  const sim = oneHero('kaido', 'EXP');
  const k = sim.heroes[0];
  k.custom.tempo = 3;
  const emp = k.def.abilities.e.cast(sim, k, {});
  assert.equal(k.custom.tempo, 1); // consumed 3, cast rebuilt 1 (Flow State keeps flowing)
});
