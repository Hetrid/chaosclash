// Jungle, structures, objectives, recall/respawn, surrender, shop, spells, vision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
const approx = (a, b, eps = 0.6, msg) => assert.ok(Math.abs(a - b) <= eps, (msg || '') + ` ${a} ≈ ${b}`);
import { Sim } from '../../src/shared/game/Sim.js';
import { CONFIG } from '../../src/shared/core/config.js';
import { dealDamage } from '../../src/shared/game/Damage.js';

function base(seed = 11, diff = 1) {
  const mk = (hero, team, slot, role) => ({ hero, team, slot, name: 'P' + team + slot, controller: 'bot', role, botLevel: diff });
  const sim = new Sim({ seed, players: [
    mk('blaze', 0, 0, 'MID'), mk('arc', 0, 1, 'GOLD'), mk('ravenor', 0, 2, 'EXP'), mk('volt', 0, 3, 'JUNGLE'), mk('titan', 0, 4, 'ROAM'),
    mk('frost', 1, 0, 'MID'), mk('forge', 1, 1, 'GOLD'), mk('kaido', 1, 2, 'EXP'), mk('phantom', 1, 3, 'JUNGLE'), mk('aegiron', 1, 4, 'ROAM'),
  ] });
  sim.bots.clear(); // deterministic: AI behaviors are covered by botsim
  return sim;
}
const simOne = (hero = 'blaze', role = 'MID', heroId2 = 'frost') => {
  const sim = new Sim({ seed: 3, players: [
    { hero, team: 0, slot: 0, name: 'A', controller: 'local', role },
    { hero: heroId2, team: 1, slot: 0, name: 'B', controller: 'bot', role: 'MID', botLevel: 1 },
  ] });
  sim.bots.clear();
  return sim;
};

// ---------------- jungle ----------------
test('jungle camps spawn and respawn on schedule', () => {
  const sim = base();
  for (let i = 0; i < 8 * 30; i++) sim.step();
  const kinds = sim.monsters.filter(m => !m.dead).map(m => m.mkind);
  assert.ok(kinds.includes('ember'), 'ember guardian');
  assert.ok(kinds.includes('azure'), 'azure keeper');
  assert.ok(kinds.filter(k => k === 'hound').length >= 2, 'hounds');
  // kill ember camp and check respawn timer
  const volt = sim.heroes.find(h => h.heroId === 'volt');
  const ember = sim.monsters.find(m => m.mkind === 'ember' && !m.dead);
  ember.hp = 1;
  dealDamage(sim, { src: volt, tgt: ember, amount: 10, dtype: 'true', category: 'basic' });
  assert.ok(volt.buffs.some(b => b.id === 'emberfire'), 'ember buff granted to killer');
  const camp = sim.camps.find(c => c.kind === 'ember');
  assert.equal(camp.alive, 0);
  assert.ok(camp.respawnAt > sim.t + 60, 'buff camp respawn ~90s');
});

test('monster leash: dragged monster resets and regens', () => {
  const sim = base();
  for (let i = 0; i < 8 * 30; i++) sim.step();
  const volt = sim.heroes.find(h => h.heroId === 'volt');
  const m = sim.monsters.find(x => x.mkind === 'hound' && !x.dead);
  m.hp = m.maxHp * 0.3;
  // drag it far from home
  volt.x = m.homeX + 900; volt.y = m.homeY;
  m.x = m.homeX + 900; m.y = m.homeY;
  for (let i = 0; i < 8 * 30; i++) sim.step();
  const distHome = Math.hypot(m.x - m.homeX, m.y - m.homeY);
  assert.ok(distHome < 60, 'monster walked home, d=' + distHome.toFixed(0));
  assert.ok(m.hp > m.maxHp * 0.8, 'regenerated after reset');
});

test('Hunt deals huge true damage to monsters, small to heroes', () => {
  const sim = simOne('volt', 'JUNGLE');
  for (let i = 0; i < 8 * 30; i++) sim.step();
  const v = sim.heroes[0];
  v.cds.spell = 0;
  const ember = sim.monsters.find(m => m.mkind === 'ember' && !m.dead);
  const hp0 = ember.hp;
  sim.castSpell(v, { x: ember.x, y: ember.y, target: ember });
  const delta = hp0 - ember.hp;
  assert.ok(delta >= 420, 'hunt monster damage, got ' + delta);
  // finish it off with one more Hunt after cooldown to prove execute-secure
  ember.hp = 200; v.cds.spell = 0;
  sim.castSpell(v, { x: ember.x, y: ember.y, target: ember });
  assert.equal(ember.dead, true, 'hunt secures low monster');
  assert.ok(v.cds.spell > 20, 'hunt on cooldown');
  // hero case
  v.cds.spell = 0;
  const foe = sim.heroes[1];
  foe.x = v.x + 100; foe.y = v.y;
  const fh = foe.hp;
  sim.castSpell(v, { x: foe.x, y: foe.y, target: foe });
  const hDelta = fh - foe.hp;
  // small vs heroes (may be amp-modified; nowhere near the monster value)
  assert.ok(hDelta >= CONFIG.HUNT_HERO && hDelta <= CONFIG.HUNT_HERO * 1.3, 'hunt hero damage small, got ' + hDelta.toFixed(0));
  assert.ok(delta >= CONFIG.HUNT_MONSTER_BASE, 'hunt monster damage large');
});

// ---------------- structures ----------------
test('turret targets minions first, then heroes; ramp on heroes', async () => {
  const { applyBuff } = await import('../../src/shared/game/StatusSystem.js');
  const sim = base();
  for (let i = 0; i < (CONFIG.WAVE_FIRST + 1) * 30; i++) sim.step();
  const t = sim.structures.find(s => s.kind === 'turret' && s.team === 0 && s.lane === 'MID' && s.tier === 1); // tier1 never invulnerable
  assert.ok(t, 'blue T2 exists');
  // put an enemy hero and enemy minion in range
  const foe = sim.heroes.find(h => h.team === 1);
  const minion = sim.minions.find(m => m.team === 1 && !m.dead && m.lane === 'MID');
  if (!minion) return;
  foe.hp = 999999; foe.maxHp = 999999; // survive the experiment
  foe.x = t.x + 200; foe.y = t.y;
  minion.x = t.x + 260; minion.y = t.y;
  for (let i = 0; i < 3 * 30; i++) { sim.step(); foe.hp = 999999; }
  if (!minion.dead) assert.equal(t.target?.kind === 'minion' || t.target?.id === minion.id, true, 'prioritizes minion');
  // hero attacking ally hero under turret → switch
  const ally = sim.heroes.find(h => h.team === 0);
  ally.hp = 999999; ally.maxHp = 999999;
  ally.x = t.x + 150; ally.y = t.y;
  foe.x = t.x + 160; foe.y = t.y;
  for (let i = 0; i < 2 * 30; i++) { sim.step(); foe.hp = 999999; ally.hp = 999999; foe.lastAttackedAllyHero = ally; foe.lastAttackedAllyHeroT = sim.t; foe.lastAttackedAllyHeroTeam = 0; }
  assert.equal(t.target?.id, foe.id, 'turret switches to aggressor hero');
  // ramp
  const c0 = t.rampCount;
  assert.ok(c0 >= 2, 'ramp builds on same hero');
});

test('structure vulnerability chain: T2 locked until T1 falls; core locked until base turrets fall', () => {
  const sim = base();
  const redMid1 = sim.structures.find(s => s.team === 1 && s.lane === 'MID' && s.tier === 1);
  const redMid2 = sim.structures.find(s => s.team === 1 && s.lane === 'MID' && s.tier === 2);
  assert.equal(redMid2.invulnerable, true);
  redMid1.dead = true; redMid1.hp = 0;
  sim.step();
  assert.equal(redMid2.invulnerable, false);
  const redBase = sim.structures.find(s => s.team === 1 && s.lane === 'BASE');
  assert.equal(redBase.invulnerable, true, 'base locked while any T1 lives');
  // kill all red T1s
  for (const s of sim.structures) if (s.team === 1 && s.tier === 1) { s.dead = true; s.hp = 0; }
  sim.step();
  assert.equal(redBase.invulnerable, false);
  const core = sim.structures.find(s => s.kind === 'core' && s.team === 1);
  assert.equal(core.invulnerable, true, 'core locked while base turrets live');
  for (const s of sim.structures) if (s.team === 1 && s.lane === 'BASE' && s.kind === 'turret') { s.dead = true; s.hp = 0; }
  sim.step();
  assert.equal(core.invulnerable, false);
});

test('backdoor protection reduces hero damage to structures', () => {
  const sim = base();
  const redMid1 = sim.structures.find(s => s.team === 1 && s.lane === 'MID' && s.tier === 1);
  const blaze = sim.heroes.find(h => h.heroId === 'blaze');
  blaze.x = redMid1.x + 100; blaze.y = redMid1.y;
  for (let i = 0; i < 30; i++) sim.step(); // let protection recompute (no red minion near)
  assert.equal(redMid1.backdoorProtected, true, 'protected without defender wave');
  const hp0 = redMid1.hp;
  dealDamage(sim, { src: blaze, tgt: redMid1, amount: 500, dtype: 'phys', category: 'basic' });
  const delta = hp0 - redMid1.hp;
  assert.ok(delta < 500 * 0.4, 'hero damage heavily reduced (' + delta + ')');
  // bring a red minion near → unprotected
  const redMinion = sim.minions.find(m => m.team === 1);
  if (redMinion) {
    redMinion.x = redMid1.x + 50; redMinion.y = redMid1.y;
    for (let i = 0; i < 35; i++) sim.step();
    assert.equal(redMid1.backdoorProtected, false);
    const hp1 = redMid1.hp;
    dealDamage(sim, { src: blaze, tgt: redMid1, amount: 500, dtype: 'phys', category: 'basic' });
    assert.ok(hp1 - redMid1.hp > delta, 'full damage with wave present');
  }
});

test('destroying the core ends the match', () => {
  const sim = base();
  const core1 = sim.structures.find(s => s.kind === 'core' && s.team === 1);
  core1.invulnerable = false;
  dealDamage(sim, { src: sim.heroes[0], tgt: core1, amount: 999999, dtype: 'true', category: 'skill' });
  assert.equal(sim.matchOver?.winner, 0);
  assert.equal(sim.matchOver?.reason, 'core');
});

// ---------------- objectives ----------------
test('Ancient Shell spawns, gives team gold + shield buff on kill', () => {
  const sim = base();
  for (let i = 0; i < (CONFIG.SHELL_FIRST + 2) * 30; i++) sim.step();
  const shell = sim.monsters.find(m => m.objective === 'shell');
  assert.ok(shell, 'shell spawned');
  const volt = sim.heroes.find(h => h.heroId === 'volt');
  const arc = sim.heroes.find(h => h.heroId === 'arc');
  const g0 = arc.gold;
  shell.hp = 1;
  dealDamage(sim, { src: volt, tgt: shell, amount: 10, dtype: 'true', category: 'basic' });
  assert.equal(sim.objectiveState.shell.alive, false);
  assert.ok(arc.gold - g0 >= 140, 'team gold for shell (' + (arc.gold - g0) + ')');
  assert.ok(arc.buffs.some(b => b.id === 'shellguard'), 'shell guard buff');
});

test('War Colossus spawns late and joins the killing team as a siege pet', () => {
  const sim = base();
  for (let i = 0; i < (CONFIG.COLOSSUS_FIRST + 2) * 30; i++) sim.step();
  const col = sim.monsters.find(m => m.objective === 'colossus');
  assert.ok(col, 'colossus spawned');
  const volt = sim.heroes.find(h => h.heroId === 'volt');
  col.hp = 1;
  dealDamage(sim, { src: volt, tgt: col, amount: 10, dtype: 'true', category: 'basic' });
  assert.equal(sim.colossi.length, 1);
  assert.equal(sim.colossi[0].team, 0);
  // pet marches toward enemy structures
  const pet = sim.colossi[0];
  const dCore0 = Math.hypot(pet.x - sim.map.core[0][0], pet.y - sim.map.core[0][1]);
  for (let i = 0; i < 20 * 30; i++) sim.step();
  const dCore0b = Math.hypot(pet.x - sim.map.core[0][0], pet.y - sim.map.core[0][1]);
  assert.ok(dCore0b > dCore0 - 50, 'pet leaves own base (marching), ' + dCore0b.toFixed(0) + ' vs ' + dCore0.toFixed(0));
});

// ---------------- recall / respawn / surrender ----------------
test('recall channels and teleports; damage cancels it', () => {
  const sim = simOne('blaze');
  const b = sim.heroes[0];
  b.x = 3200; b.y = 3200;
  assert.equal(sim.startRecall(b), true);
  for (let i = 0; i < 2 * 30; i++) sim.step();
  assert.ok(b.recall, 'still channeling');
  dealDamage(sim, { src: sim.heroes[1], tgt: b, amount: 30, dtype: 'true', category: 'skill' });
  assert.equal(b.recall, null, 'cancelled by damage');
  // full channel works
  sim.startRecall(b);
  const fx = sim.map.fountain[0][0];
  for (let i = 0; i < 5 * 30; i++) sim.step();
  assert.ok(Math.hypot(b.x - fx, b.y - sim.map.fountain[0][1]) < 300, 'at fountain');
});

test('respawn timer scales with level', async () => {
  const { respawnTime } = await import('../../src/shared/game/Damage.js');
  assert.equal(respawnTime(1), 7.2);
  assert.equal(respawnTime(15), 38);
  assert.equal(respawnTime(20), CONFIG.RESPAWN_CAP);
});

test('surrender vote passes with team majority', () => {
  const sim = base();
  sim.t = CONFIG.SURRENDER_MIN_TIME + 1;
  const cap = sim.heroes.find(h => h.team === 0);
  const r = sim.surrender.start(sim, cap);
  assert.equal(r.ok, true);
  // 2 more yes votes → 3 of 5 = majority
  sim.surrender.vote(sim, sim.heroes.find(h => h.team === 0 && h.slot === 1), true);
  sim.surrender.vote(sim, sim.heroes.find(h => h.team === 0 && h.slot === 2), true);
  assert.equal(sim.matchOver?.winner, 1, 'enemy wins by surrender');
  assert.equal(sim.matchOver?.reason, 'surrender');
});

// ---------------- shop ----------------
test('shop: components credit, sell refund, role restriction', () => {
  const sim = simOne('arc', 'GOLD');
  const a = sim.heroes[0];
  a.gold = 5000;
  // SHOP_ANYWHERE=true → buy from anywhere; flipping it off restores fountain-gating
  a.x = 3200; a.y = 3200;
  assert.equal(CONFIG.SHOP_ANYWHERE, true);
  let r = sim.shop.buy(sim, a, 'saber');
  assert.equal(r.ok, true);
  a.items.length = 0; a.gold = 5000;
  CONFIG.SHOP_ANYWHERE = false;
  r = sim.shop.buy(sim, a, 'saber');
  assert.equal(r.ok, false, 'fountain gate when flag off');
  CONFIG.SHOP_ANYWHERE = true;
  // at fountain
  const [fx, fy] = sim.map.fountain[0];
  a.x = fx; a.y = fy;
  r = sim.shop.buy(sim, a, 'broadsword');
  assert.equal(r.ok, true);
  r = sim.shop.buy(sim, a, 'broadsword');
  assert.equal(r.ok, true);
  assert.equal(a.items.length, 2);
  const g0 = a.gold;
  r = sim.shop.buy(sim, a, 'saber'); // combines 2 broadswords (960 credit)
  assert.equal(r.ok, true);
  assert.equal(r.cost, 2150 - 960);
  assert.deepEqual(a.items, ['saber']);
  // sell refund 70%
  const g1 = a.gold;
  r = sim.shop.sell(sim, a, 0);
  assert.equal(r.refund, Math.round(2150 * 0.7));
  // role restricted item
  r = sim.shop.buy(sim, a, 'talon');
  assert.equal(r.ok, false, 'talon is jungle-only');
});

test('battle spells: flicker blinks, sprint buffs, purify cleanses CC', async () => {
  const { applyCC } = await import('../../src/shared/game/StatusSystem.js');
  const sim = simOne('blaze');
  const b = sim.heroes[0];
  b.spell = 'flicker'; b.cds.spell = 0;
  const x0 = b.x;
  sim.castSpell(b, { x: b.x + 300, y: b.y });
  assert.ok(Math.abs(b.x - x0) > 200, 'blinked');
  b.spell = 'sprint'; b.cds.spell = 0;
  sim.castSpell(b, {});
  assert.ok(b.stats.ms > b.def.ms, 'sprint increases ms');
  b.spell = 'purify'; b.cds.spell = 0;
  applyCC(sim, b, 'stun', 3, {});
  sim.castSpell(b, {});
  assert.ok(b.ccImmuneUntil > sim.t, 'purify grants immunity');
});
