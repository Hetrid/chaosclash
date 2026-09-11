// Legend Arena — HeroRegistry: 20 original heroes (16 reworked Chaos Clash agents + 4 new).
// Kits compose primitives from kits.js. Roles: JUNGLE/ROAM/EXP/GOLD/MID.
import { kit, scaleAmt } from './kits.js';
import { applyCC, applyBuff, hasBuff, getBuff, removeBuff, applyCC as cc } from '../game/StatusSystem.js';
import { dealDamage, heal, addShield } from '../game/Damage.js';
import { dist, clamp, angleTo } from '../core/math.js';

const M = (h, base, per, ratio = 0) => scaleAmt(h, base, per, 'magPower', ratio);
const P = (h, base, per, ratio = 0) => scaleAmt(h, base, per, 'physAtk', ratio);
const HP = (h, frac) => h.maxHp * frac;

// shorthand casters -----------------------------------------------
function line(world, h, aim, o) {
  const a = Math.atan2(aim.y - h.y, aim.x - h.x);
  h.aim = a;
  return kit.proj(world, h, { aim: a, ...o });
}

// =================================================================
export const HEROES = {

  // ---------------- MID / MAGES ----------------
  blaze: {
    n: 'Blaze', title: 'The Cinderborn', archetype: 'mage', resource: 'mana',
    primaryRole: 'MID', secondaryRole: null, recommendedLane: 'MID', difficulty: 2,
    c1: '#ff5a36', c2: '#ffc23d',
    portrait: { skin: '#e8a06b', helm: 'horned', hair: '#3a2418', cape: '#8a2a1a', emblem: 'flame' },
    hp: 610, mana: 430, manaRegen: 3.4, hpRegen: 1.5, physAtk: 52, magPerLevel: 0,
    physDef: 16, magDef: 16, aspd: 0.82, ms: 238, range: 420,
    atk: { proj: { speed: 1050, color: '#ff8a50', size: 1 }, kindLabel: 'basic' },
    passive: { name: 'Ember Ignition', desc: 'Skills scorch targets, burning for magic damage over 2s.' },
    abilities: {
      q: { name: 'Cinderbolt', desc: 'Hurl a bolt that scorches and slows.', cd: 5.5, mana: 55, range: 720, aim: 'dir',
        cast(w, h, aim) {
          const a = Math.atan2(aim.y - h.y, aim.x - h.x); h.aim = a;
          kit.proj(w, h, { aim: a, speed: 1150, range: 720, dmg: M(h, 120, 26, 0.55), dtype: 'magic', kindLabel: 'cinderbolt', radius: 20,
            onHit(w2, p, t) { applyCC(w2, t, 'slow', 1.0, { pct: 0.2 }); ignite(w2, h, t); } });
        } },
      e: { name: 'Flame Dash', desc: 'Dash forward, leaving a burning trail.', cd: 9, mana: 60, range: 280, aim: 'dir',
        cast(w, h, aim) {
          const a = Math.atan2(aim.y - h.y, aim.x - h.x); h.aim = a;
          kit.dash(w, h, { aim: a, dist: 280, dur: 0.24, onEnd(w2, hh) {
            kit.zone(w2, hh, hh.x, hh.y, 85, 2.5, { dmg: 0, every: 0.5, visual: 'firetrail', per(w3, src, t) {
              dealDamage(w3, { src: src, tgt: t, amount: M(hh, 22, 5, 0.16), dtype: 'magic', category: 'dot', kindLabel: 'firetrail' }); ignite(w3, hh, t);
            } });
          } });
        } },
      r: { name: 'Cataclysm', desc: 'Call down a meteor after a delay, leaving a burning crater.', cd: 42, mana: 110, range: 850, aim: 'point', ult: true,
        cast(w, h, aim) {
          kit.delayedAoe(w, h, aim.x, aim.y, 250, M(h, 300, 55, 0.9), 1.05, { dtype: 'magic', kindLabel: 'cataclysm', stun: 0.5, visual: 'meteor', onDetonate(w2, hh, x, y, r) {
            kit.zone(w2, hh, x, y, 240, 3, { every: 0.5, visual: 'firetrail', per(w3, s, t) { dealDamage(w3, { src: s, tgt: t, amount: M(hh, 24, 5, 0.14), dtype: 'magic', category: 'dot', kindLabel: 'cataclysm' }); } });
          } });
        } },
    },
    hooks: {}, build: ['arcanetreads', 'codex', 'stormtome', 'voidscepter', 'frostlens', 'colossus'],
    ai: { style: 'mage', combo: ['q', 'r', 'e'], keepRange: 380 },
  },

  frost: {
    n: 'Frost', title: 'Warden of the White Vale', archetype: 'mage', resource: 'mana',
    primaryRole: 'MID', secondaryRole: 'ROAM', recommendedLane: 'MID', difficulty: 2,
    c1: '#43d6f0', c2: '#b8f4ff',
    portrait: { skin: '#dfe8f2', helm: 'circlet', hair: '#cfeaf5', cape: '#2b6f8f', emblem: 'snow' },
    hp: 620, mana: 460, manaRegen: 3.5, hpRegen: 1.5, physAtk: 50,
    physDef: 17, magDef: 16, aspd: 0.8, ms: 236, range: 430,
    atk: { proj: { speed: 1000, color: '#9fe8ff', size: 1 } },
    passive: { name: 'Frostbite', desc: 'Skills chill enemies. 3 stacks within 4s freeze them briefly.', },
    abilities: {
      q: { name: 'Frost Lance', desc: 'Piercing shard that chills.', cd: 5, mana: 50, range: 780, aim: 'dir',
        cast(w, h, aim) { line(w, h, aim, { speed: 1150, range: 780, dmg: M(h, 105, 22, 0.5), dtype: 'magic', kindLabel: 'frostlance', radius: 18, pierce: 1, hitOnce: false,
          onHit(w2, p, t) { applyCC(w2, t, 'slow', 1.5, { pct: 0.3 }); addFrost(w2, h, t); } }); } },
      e: { name: 'Glacier Wall', desc: 'Raise a wall of ice that blocks movement and projectiles.', cd: 13, mana: 70, range: 420, aim: 'point',
        cast(w, h, aim) {
          const a = Math.atan2(aim.y - h.y, aim.x - h.x) + Math.PI / 2;
          const cx = clamp(aim.x, 80, 6320), cy = clamp(aim.y, 80, 6320);
          const len = 170;
          kit.wall(w, h, cx + Math.cos(a) * len, cy + Math.sin(a) * len, cx - Math.cos(a) * len, cy - Math.sin(a) * len, 3.2, { color: '#bdefff' });
        } },
      r: { name: 'Absolute Zero', desc: 'After a delay, flash-freeze a large area.', cd: 46, mana: 110, range: 800, aim: 'point', ult: true,
        cast(w, h, aim) { kit.delayedAoe(w, h, aim.x, aim.y, 300, M(h, 230, 42, 0.8), 1.0, { dtype: 'magic', kindLabel: 'absolutezero', freeze: 1.4, visual: 'iceNova' }); } },
    },
    build: ['arcanetreads', 'codex', 'frostlens', 'stormtome', 'voidscepter', 'runeward'],
    ai: { style: 'mage', combo: ['q', 'r'], keepRange: 390 },
  },

  nova: {
    n: 'Nova', title: 'Star of Ruin', archetype: 'mage', resource: 'mana',
    primaryRole: 'MID', secondaryRole: null, recommendedLane: 'MID', difficulty: 2,
    c1: '#ff6b9d', c2: '#ffd166',
    portrait: { skin: '#f2c9a0', helm: 'none', hair: '#ff9db8', cape: '#7a2a52', emblem: 'star' },
    hp: 600, mana: 470, manaRegen: 3.6, hpRegen: 1.4, physAtk: 48,
    physDef: 15, magDef: 16, aspd: 0.8, ms: 238, range: 440,
    atk: { proj: { speed: 1080, color: '#ffa8c5', size: 1 } },
    passive: { name: 'Supernova Echo', desc: 'Each enemy hit by a skill reduces your other cooldowns by 0.75s.' },
    abilities: {
      q: { name: 'Supernova', desc: 'Detonate a star at a location.', cd: 6, mana: 60, range: 800, aim: 'point',
        cast(w, h, aim) { kit.delayedAoe(w, h, aim.x, aim.y, 180, M(h, 150, 30, 0.65), 0.5, { dtype: 'magic', kindLabel: 'supernova', visual: 'star' }); } },
      e: { name: 'Gravity Well', desc: 'A well that drags enemies to its center.', cd: 12, mana: 75, range: 750, aim: 'point',
        cast(w, h, aim) { kit.zone(w, h, aim.x, aim.y, 210, 2.2, { every: 0.25, visual: 'gravity', pull: 260, dmg: M(h, 14, 3, 0.1), dtype: 'magic', kindLabel: 'gravitywell' }); } },
      r: { name: 'Starfall', desc: 'Three waves of falling stars.', cd: 44, mana: 110, range: 850, aim: 'point', ult: true,
        cast(w, h, aim) {
          for (let i = 0; i < 3; i++) {
            const px = aim.x + (w.rng.f() - 0.5) * 120, py = aim.y + (w.rng.f() - 0.5) * 120;
            w.areas.push({ kind: 'area', shape: 'circle', x: px, y: py, r: 210, team: h.team, src: h, until: w.t + 0.6 + i * 0.55, armAt: w.t + 0.6 + i * 0.55, color: h.def.c1, telegraph: true, visual: 'star', hero: 'nova',
              onArm(w2, a) { kit.aoe(w2, h, px, py, 210, M(h, 110, 22, 0.42), { dtype: 'magic', kindLabel: 'starfall', slow: 0.25, slowDur: 1 }); } });
          }
        } },
    },
    build: ['arcanetreads', 'codex', 'voidscepter', 'stormtome', 'frostlens', 'colossus'],
    ai: { style: 'mage', combo: ['e', 'q', 'r'], keepRange: 400 },
  },

  siren: {
    n: 'Siren', title: 'Voice of the Deep', archetype: 'mage', resource: 'mana',
    primaryRole: 'MID', secondaryRole: 'ROAM', recommendedLane: 'MID', difficulty: 3,
    c1: '#2ec4d6', c2: '#9be8e0',
    portrait: { skin: '#9fd8cf', helm: 'none', hair: '#1f8a99', cape: '#0f5e6e', emblem: 'wave' },
    hp: 615, mana: 465, manaRegen: 3.6, hpRegen: 1.5, physAtk: 48,
    physDef: 16, magDef: 17, aspd: 0.8, ms: 238, range: 430,
    atk: { proj: { speed: 1040, color: '#7fe0dc', size: 1 } },
    passive: { name: 'Resonance', desc: 'Skills mark enemies with Echo. A second Echo detonates and briefly silences.' },
    abilities: {
      q: { name: 'Sonic Burst', desc: 'Cone of force that damages and shoves back.', cd: 6.5, mana: 60, range: 430, aim: 'dir',
        cast(w, h, aim) {
          const a = Math.atan2(aim.y - h.y, aim.x - h.x); h.aim = a;
          const targets = coneTargets(w, h, a, 430, Math.PI / 3);
          for (const t of targets) {
            dealDamage(w, { src: h, tgt: t, amount: M(h, 105, 20, 0.5), dtype: 'magic', category: 'skill', kindLabel: 'sonicburst' });
            kit.knock(w, t, h.x, h.y, 0.25, 150);
            addEcho(w, h, t);
          }
          w.emit({ type: 'cone', x: h.x, y: h.y, a, len: 430, spread: Math.PI / 3, color: h.def.c1, hero: 'siren' });
        } },
      e: { name: 'Mute Field', desc: 'A zone that silences enemies inside.', cd: 14, mana: 75, range: 700, aim: 'point',
        cast(w, h, aim) { kit.zone(w, h, aim.x, aim.y, 200, 2.5, { every: 0.5, visual: 'mute', silence: 0.6, dmg: M(h, 16, 3, 0.1), dtype: 'magic', kindLabel: 'mutefield' }); } },
      r: { name: 'Siren Song', desc: 'Channel, then unleash a wave that drags enemies in and silences them.', cd: 48, mana: 110, range: 460, aim: 'self', ult: true, channel: 1.1,
        cast(w, h, aim) {
          h.channeling = { t: 0, ends: w.t + 1.1, label: 'sirensong',
            interrupt: () => true,
            finish(w2, hh) {
              const targets = kit.enemiesInRadius(w2, hh, hh.x, hh.y, 460, {});
              for (const t of targets) {
                kit.pullToward(w2, t, hh.x, hh.y, 520, 0.45);
                dealDamage(w2, { src: hh, tgt: t, amount: M(hh, 140, 26, 0.55), dtype: 'magic', category: 'skill', kindLabel: 'sirensong' });
                applyCC(w2, t, 'silence', 1.2, {});
              }
              w2.emit({ type: 'aoe', x: hh.x, y: hh.y, r: 460, color: hh.def.c1, hero: 'siren', shape: 'ring' });
            } };
        } },
    },
    build: ['arcanetreads', 'codex', 'stormtome', 'frostlens', 'voidscepter', 'runeward'],
    ai: { style: 'mage', combo: ['e', 'r', 'q'], keepRange: 380 },
  },

  chrono: {
    n: 'Chrono', title: 'Keeper of Hours', archetype: 'support', resource: 'mana',
    primaryRole: 'ROAM', secondaryRole: 'MID', recommendedLane: 'ROAM', difficulty: 3,
    c1: '#70a1ff', c2: '#c8d8ff',
    portrait: { skin: '#e6c39c', helm: 'hood', hair: '#8fa8d8', cape: '#31417f', emblem: 'hourglass' },
    hp: 660, mana: 480, manaRegen: 3.8, hpRegen: 1.7, physAtk: 50,
    physDef: 18, magDef: 17, aspd: 0.8, ms: 240, range: 410,
    atk: { proj: { speed: 1000, color: '#a8c4ff', size: 1 } },
    passive: { name: 'Temporal Echo', desc: 'Your heals and shields also grant the target +20% movement speed for 1.5s.' },
    abilities: {
      q: { name: 'Time Rift', desc: 'A rift that slows and erodes enemies.', cd: 7, mana: 55, range: 720, aim: 'point',
        cast(w, h, aim) { kit.zone(w, h, aim.x, aim.y, 190, 2.5, { every: 0.5, visual: 'time', slow: 0.45, slowDur: 0.7, dmg: M(h, 22, 4, 0.14), dtype: 'magic', kindLabel: 'timerift' }); } },
      e: { name: 'Rewind', desc: 'Heal an ally based on their missing HP and cleanse their slows.', cd: 12, mana: 80, range: 600, aim: 'ally',
        cast(w, h, aim) {
          const t = aim.ally || h;
          const missing = t.maxHp - t.hp;
          heal(w, t, missing * 0.3 + M(h, 40, 8, 0.2), 'rewind', h);
          for (let i = t.buffs.length - 1; i >= 0; i--) if (t.buffs[i].id === 'huntSlow') t.buffs.splice(i, 1);
          delete t.cc.slow;
          applyBuff(w, t, { id: 'tempoEcho', until: w.t + 1.5 });
          w.emit({ type: 'healFx', x: t.x, y: t.y, id: t.id });
        } },
      r: { name: 'Stasis Field', desc: 'After a delay, freeze all enemies in a large area.', cd: 50, mana: 110, range: 780, aim: 'point', ult: true,
        cast(w, h, aim) { kit.delayedAoe(w, h, aim.x, aim.y, 300, M(h, 110, 20, 0.4), 0.9, { dtype: 'magic', kindLabel: 'stasis', freeze: 1.5, visual: 'stasis' }); } },
    },
    build: ['arcanetreads', 'compass', 'sentineloath', 'codex', 'colossus', 'runeward'],
    ai: { style: 'support', combo: ['q', 'r'], keepRange: 360, peelAlly: true },
  },

  // ---------------- MARKSMEN (GOLD) ----------------
  arc: {
    n: 'Arc', title: 'The Longshot', archetype: 'marksman', resource: 'mana',
    primaryRole: 'GOLD', secondaryRole: null, recommendedLane: 'GOLD', difficulty: 2,
    c1: '#38bdf8', c2: '#e0f2fe',
    portrait: { skin: '#e8b48a', helm: 'visor', hair: '#7c4a21', cape: '#155e86', emblem: 'arrow' },
    hp: 640, mana: 330, manaRegen: 2.6, hpRegen: 1.5, physAtk: 58,
    physDef: 17, magDef: 16, aspd: 0.92, ms: 242, range: 460,
    atk: { proj: { speed: 1250, color: '#bfe8ff', size: 0.9 } },
    passive: { name: 'Longshot', desc: 'Standing still for 1s extends your attack range, up to +270, until you move.' },
    abilities: {
      q: { name: 'Piercing Lance', desc: 'A lance that pierces every enemy in a line.', cd: 8, mana: 55, range: 900, aim: 'dir',
        cast(w, h, aim) { line(w, h, aim, { speed: 1350, range: 900, dmg: P(h, 110, 22, 0.7), dtype: 'phys', category: 'skill', kindLabel: 'piercinglance', radius: 16, pierce: 5, hitOnce: false, canCrit: true }); } },
      e: { name: 'Recoil Roll', desc: 'Roll backward; your next basic attack is instant and stronger.', cd: 10, mana: 40, range: 0, aim: 'self',
        cast(w, h, aim) {
          const a = h.aim + Math.PI;
          kit.dash(w, h, { aim: a, dist: 230, dur: 0.2 });
          applyBuff(w, h, { id: 'recoil', until: w.t + 3, data: { nextBasicAmp: 0.25 } });
        } },
      r: { name: 'Deadeye', desc: 'For 6s: greatly increased range and attack speed.', cd: 45, mana: 90, range: 0, aim: 'self', ult: true,
        cast(w, h) { applyBuff(w, h, { id: 'deadeye', until: w.t + 6, stats: { attackRange: 130, aspd: 0.5 }, icon: 'deadeye' }); w.emit({ type: 'buffFx', id: h.id, hero: 'arc', buff: 'deadeye' }); } },
    },
    build: ['swiftbow', 'greaves', 'saber', 'bloodpiercer', 'tempest', 'dawnedge'],
    ai: { style: 'marksman', combo: ['q', 'e'], keepRange: 430 },
  },

  forge: {
    n: 'Forge', title: 'Master of Cogs', archetype: 'marksman', resource: 'mana',
    primaryRole: 'GOLD', secondaryRole: null, recommendedLane: 'GOLD', difficulty: 3,
    c1: '#f59e0b', c2: '#fde68a',
    portrait: { skin: '#dba678', helm: 'goggles', hair: '#4a3520', cape: '#7c4e10', emblem: 'gear' },
    hp: 650, mana: 350, manaRegen: 2.8, hpRegen: 1.6, physAtk: 56,
    physDef: 18, magDef: 16, aspd: 0.88, ms: 240, range: 440,
    atk: { proj: { speed: 1150, color: '#ffd28a', size: 1 } },
    passive: { name: 'Field Engineer', desc: 'Your sentries scale with you, and their kills pay you 40% of the bounty.' },
    abilities: {
      q: { name: 'Deploy Sentry', desc: 'Place an auto-firing sentry.', cd: 11, mana: 60, range: 440, aim: 'point',
        cast(w, h, aim) { kit.summonSentry(w, h, aim.x, aim.y, { life: 7, range: 430 }); } },
      e: { name: 'Plating', desc: 'Gain a shield and a burst of attack speed.', cd: 12, mana: 50, range: 0, aim: 'self',
        cast(w, h) { addShield(w, h, P(h, 80, 15, 0.3), 2.8, 'plating'); applyBuff(w, h, { id: 'plating', until: w.t + 3, stats: { aspd: 0.2 } }); h.cds.q = Math.max(0, h.cds.q - 1.5); } },
      r: { name: 'Overwatch', desc: 'Deploy two heavy sentries; all sentries gain damage and range for 8s.', cd: 46, mana: 100, range: 500, aim: 'point', ult: true,
        cast(w, h, aim) {
          applyBuff(w, h, { id: 'overwatch', until: w.t + 8 });
          kit.summonSentry(w, h, aim.x - 70, aim.y, { life: 8, range: 500, dmgMul: 1.6 });
          kit.summonSentry(w, h, aim.x + 70, aim.y, { life: 8, range: 500, dmgMul: 1.6 });
        } },
    },
    build: ['greaves', 'saber', 'swiftbow', 'stormpike', 'bloodpiercer', 'colossus'],
    ai: { style: 'marksman', combo: ['q', 'e'], keepRange: 420, summon: 'q' },
  },

  // ---------------- ASSASSINS (JUNGLE) ----------------
  volt: {
    n: 'Volt', title: 'The Living Storm', archetype: 'assassin', resource: 'mana',
    primaryRole: 'JUNGLE', secondaryRole: 'MID', recommendedLane: 'JUNGLE', difficulty: 3,
    c1: '#ffd32a', c2: '#fff9c4',
    portrait: { skin: '#e8c07a', helm: 'spikes', hair: '#fff176', cape: '#8d6e08', emblem: 'bolt' },
    hp: 660, mana: 330, manaRegen: 2.6, hpRegen: 1.7, physAtk: 62,
    physDef: 18, magDef: 16, aspd: 0.95, ms: 252, range: 120,
    atk: { melee: true, kindLabel: 'basic' },
    passive: { name: 'Static Charge', desc: 'Every 3rd basic attack chains lightning to a nearby enemy.' },
    abilities: {
      q: { name: 'Thunder Step', desc: 'Blink and shock the landing area.', cd: 7, mana: 50, range: 400, aim: 'point',
        cast(w, h, aim) { kit.blink(w, h, aim.x, aim.y, 400); kit.aoe(w, h, h.x, h.y, 160, P(h, 85, 17, 0.45), { dtype: 'phys', category: 'skill', kindLabel: 'thunderstep', slow: 0.25, slowDur: 0.8 }); } },
      e: { name: 'Arc Chain', desc: 'Lightning leaps between up to 3 enemies.', cd: 8, mana: 55, range: 440, aim: 'target',
        cast(w, h, aim) {
          let from = h; const hit = new Set();
          for (let i = 0; i < 3; i++) {
            const t = kit.nearestEnemy(w, from, i === 0 ? 440 : 300, u => !hit.has(u.id) && u.kind !== 'minion' || i > 0);
            if (!t) break;
            hit.add(t.id);
            dealDamage(w, { src: h, tgt: t, amount: P(h, 95, 19, 0.42), dtype: 'phys', category: 'skill', kindLabel: 'arcchain' });
            w.emit({ type: 'chain', x1: from.x, y1: from.y, x2: t.x, y2: t.y, color: '#fff176', hero: 'volt' });
            from = t;
          }
          if (!hit.size) return false;
        } },
      r: { name: 'Stormform', desc: 'For 5s gain speed and your basics chain to nearby enemies.', cd: 40, mana: 90, range: 0, aim: 'self', ult: true,
        cast(w, h) { applyBuff(w, h, { id: 'stormform', until: w.t + 5, stats: { ms: 55, aspd: 0.4 }, data: { bounce: 2 }, icon: 'stormform' }); w.emit({ type: 'buffFx', id: h.id, hero: 'volt', buff: 'stormform' }); } },
    },
    hooks: { onBasicHit: (w, h, t) => voltChain(w, h, t) },
    build: ['talon', 'greaves', 'saber', 'stormpike', 'tempest', 'colossus'],
    ai: { style: 'assassin', combo: ['q', 'e', 'r'], keepRange: 110, gapClose: 'q' },
  },

  phantom: {
    n: 'Phantom', title: 'Whisper in the Dark', archetype: 'assassin', resource: 'mana',
    primaryRole: 'JUNGLE', secondaryRole: null, recommendedLane: 'JUNGLE', difficulty: 3,
    c1: '#a55eea', c2: '#e2c8ff',
    portrait: { skin: '#cbb4d8', helm: 'mask', hair: '#5f27cd', cape: '#341a5e', emblem: 'ghost' },
    hp: 640, mana: 320, manaRegen: 2.5, hpRegen: 1.6, physAtk: 64,
    physDef: 16, magDef: 16, aspd: 0.94, ms: 250, range: 110,
    atk: { melee: true },
    passive: { name: 'Nightstalker', desc: 'From bush or veil, your next basic deals +40% damage and slows.' },
    abilities: {
      q: { name: 'Veil', desc: 'Vanish for 2.2s and gain speed. Attacking breaks the veil.', cd: 12, mana: 45, range: 0, aim: 'self',
        cast(w, h) { applyBuff(w, h, { id: 'veil', until: w.t + 2.2, stats: { ms: 40 } }); w.emit({ type: 'stealth', id: h.id, on: true }); } },
      e: { name: 'Shadowstep', desc: 'Dash through the shadows. Passing near an enemy hero refunds the dash once.', cd: 9, mana: 45, range: 320, aim: 'dir',
        cast(w, h, aim) {
          const a = Math.atan2(aim.y - h.y, aim.x - h.x); h.aim = a;
          kit.dash(w, h, { aim: a, dist: 320, dur: 0.22, onProgress(w2, hh, k) {
            if (hh.custom.stepRefund) return;
            for (const t of kit.enemiesInRadius(w2, hh, hh.x, hh.y, 110, { heroesOnly: true })) {
              if (k > 0.15 && k < 0.9) { hh.custom.stepRefund = true; hh.cds.e = 0; w2.emit({ type: 'stepRefund', id: hh.id }); }
            }
          }, onEnd(w2, hh) { setTimeout(() => hh.custom.stepRefund = false, 50); } });
        } },
      r: { name: 'Death Mark', desc: 'Mark a hero. A portion of the damage you deal to them detonates at the end.', cd: 44, mana: 90, range: 520, aim: 'target', ult: true,
        cast(w, h, aim) {
          const t = aim.target || kit.nearestEnemy(w, h, 520, u => u.kind === 'hero');
          if (!t) return false;
          applyBuff(w, t, { id: 'deathmark', until: w.t + 4, data: { owner: h.id, startHp: t.hp, dealt: 0 } });
          w.emit({ type: 'deathmark', id: t.id, by: h.id });
        } },
    },
    hooks: {
      onDealtDamage(w, h, t, amt, ev) {
        const mark = t.kind === 'hero' && getBuff(t, 'deathmark');
        if (mark && mark.data.owner === h.id) mark.data.dealt += amt;
      },
      onBasicHit(w, h, t) {
        if (hasBuff(h, 'veil') || h.inBush) {
          removeBuff(h, 'veil');
          w.emit({ type: 'stealth', id: h.id, on: false });
          dealDamage(w, { src: h, tgt: t, amount: P(h, 30, 6, 0.25), dtype: 'phys', category: 'basic', kindLabel: 'nightstalker' });
          applyCC(w, t, 'slow', 1.0, { pct: 0.3 });
        }
      },
    },
    build: ['talon', 'greaves', 'saber', 'stormpike', 'dawnedge', 'colossus'],
    ai: { style: 'assassin', combo: ['q', 'e', 'r'], keepRange: 105, gapClose: 'e' },
  },

  shadow: {
    n: 'Shadow', title: 'The Hollow Trickster', archetype: 'assassin', resource: 'mana',
    primaryRole: 'JUNGLE', secondaryRole: 'MID', recommendedLane: 'JUNGLE', difficulty: 3,
    c1: '#8c62e8', c2: '#3d2a63',
    portrait: { skin: '#b7a6d3', helm: 'hood', hair: '#2c2c54', cape: '#241a3d', emblem: 'moon' },
    hp: 645, mana: 340, manaRegen: 2.6, hpRegen: 1.6, physAtk: 62,
    physDef: 16, magDef: 16, aspd: 0.95, ms: 250, range: 115,
    atk: { melee: true },
    passive: { name: 'Shadow Echoes', desc: 'Skills leave an echo that detonates shortly after.' },
    abilities: {
      q: { name: 'Decoy', desc: 'Send a decoy forward; it detonates on contact.', cd: 8, mana: 50, range: 460, aim: 'dir',
        cast(w, h, aim) {
          const a = Math.atan2(aim.y - h.y, aim.x - h.x); h.aim = a;
          const p = kit.proj(w, h, { aim: a, speed: 620, range: 460, radius: 26, dmg: 0, dtype: 'true', category: 'skill', kindLabel: 'decoy', color: '#8c62e8', size: 1.6,
            onEnd(w2, pp, x, y) { kit.delayedAoe(w2, h, x, y, 160, P(h, 95, 19, 0.5), 0.05, { dtype: 'phys', category: 'skill', kindLabel: 'decoy', slow: 0.3, slowDur: 1, visual: 'shadow' }); } });
          p.noDamage = true;
        } },
      e: { name: 'Snare Trap', desc: 'Place a hidden trap that roots the first hero to trigger it.', cd: 12, mana: 45, range: 420, aim: 'point',
        cast(w, h, aim) {
          w.areas.push({ kind: 'area', shape: 'circle', trap: true, x: aim.x, y: aim.y, r: 90, team: h.team, src: h, until: w.t + 30, color: h.def.c1, visual: 'trap', hero: 'shadow',
            check: (w2, a) => {
              const t = kit.enemiesInRadius(w2, h, a.x, a.y, 90, { heroesOnly: true })[0];
              if (t) {
                applyCC(w2, t, 'root', 1.1, {});
                dealDamage(w2, { src: h, tgt: t, amount: P(h, 80, 16, 0.4), dtype: 'phys', category: 'skill', kindLabel: 'snare' });
                a.until = 0;
                w2.emit({ type: 'trapTrigger', x: a.x, y: a.y });
              }
            } });
        } },
      r: { name: 'Legion of Night', desc: 'Summon two shadow mimics that fight beside you.', cd: 50, mana: 100, range: 0, aim: 'self', ult: true,
        cast(w, h) {
          for (let i = 0; i < 2; i++) {
            const a = h.aim + (i ? 1 : -1) * 0.8;
            const mimic = { world: w, id: Math.random().toString(36).slice(2), kind: 'summon', subtype: 'mimic', owner: h, team: h.team,
              x: h.x + Math.cos(a) * 50, y: h.y + Math.sin(a) * 50, r: 34,
              hp: h.hp * 0.5, maxHp: h.maxHp * 0.5, dmg: (h.stats?.physAtk || 60) * 0.4, range: 110, aspd: 1, atkCd: 0.4, life: 6, target: null, retarget: 0, dead: false, melee: true };
            w.summons.push(mimic);
            w.grid.insert(mimic);
            w.register(mimic);
            w.emit({ type: 'summon', id: 'm' + i + h.id, x: h.x, y: h.y, hero: 'shadow', subtype: 'mimic', life: 6 });
          }
        } },
    },
    build: ['talon', 'greaves', 'saber', 'stormpike', 'tempest', 'colossus'],
    ai: { style: 'assassin', combo: ['e', 'q', 'r'], keepRange: 110, gapClose: 'q' },
  },

  rift: {
    n: 'Rift', title: 'Walker Between', archetype: 'assassin', resource: 'mana',
    primaryRole: 'JUNGLE', secondaryRole: null, recommendedLane: 'JUNGLE', difficulty: 3,
    c1: '#c084fc', c2: '#7c3aed',
    portrait: { skin: '#d8c8ef', helm: 'none', hair: '#c084fc', cape: '#4c1d95', emblem: 'rift' },
    hp: 635, mana: 330, manaRegen: 2.6, hpRegen: 1.6, physAtk: 63,
    physDef: 16, magDef: 16, aspd: 0.96, ms: 252, range: 118,
    atk: { melee: true },
    passive: { name: 'Phase Edge', desc: 'After casting a skill, your next basic within 3s deals +30% damage.' },
    abilities: {
      q: { name: 'Phase Strike', desc: 'Blink a short distance and slash the landing area.', cd: 6.5, mana: 45, range: 360, aim: 'point',
        cast(w, h, aim) { kit.blink(w, h, aim.x, aim.y, 360); kit.aoe(w, h, h.x, h.y, 140, P(h, 70, 14, 0.4), { dtype: 'phys', category: 'skill', kindLabel: 'phasestrike' }); phaseEdge(w, h); } },
      e: { name: 'Rift Bomb', desc: 'A delayed blast that slows.', cd: 9, mana: 50, range: 520, aim: 'point',
        cast(w, h, aim) { kit.delayedAoe(w, h, aim.x, aim.y, 180, P(h, 105, 21, 0.5), 0.8, { dtype: 'phys', category: 'skill', kindLabel: 'riftbomb', slow: 0.4, slowDur: 1.5, visual: 'rift' }); phaseEdge(w, h); } },
      r: { name: 'Riftwalker', desc: 'Three rapid blinks with slashes. Hero hits extend the window.', cd: 42, mana: 90, range: 320, aim: 'point', ult: true,
        cast(w, h, aim) {
          h.custom.rift = { charges: 3, until: w.t + 6 };
          riftBlink(w, h, aim);
        } },
    },
    build: ['talon', 'greaves', 'saber', 'stormpike', 'dawnedge', 'colossus'],
    ai: { style: 'assassin', combo: ['q', 'e', 'r'], keepRange: 112, gapClose: 'q' },
  },

  luxa: {
    n: 'Luxa', title: 'Dancer of Pulses', archetype: 'assassin', resource: 'mana',
    primaryRole: 'JUNGLE', secondaryRole: 'MID', recommendedLane: 'JUNGLE', difficulty: 3,
    c1: '#f472b6', c2: '#fbcfe8',
    portrait: { skin: '#f4d0b8', helm: 'ribbon', hair: '#f9a8d4', cape: '#be185d', emblem: 'note' },
    hp: 630, mana: 360, manaRegen: 2.8, hpRegen: 1.6, physAtk: 52, magPerLevel: 2.2,
    physDef: 16, magDef: 16, aspd: 0.86, ms: 252, range: 380,
    atk: { proj: { speed: 1150, color: '#f9a8d4', size: 0.9 } },
    passive: { name: 'Rhythm', desc: 'Skills mark enemies with Rhythm. Dashing through marked enemies consumes the mark for bonus magic damage and refunds cooldown.', },
    abilities: {
      q: { name: 'Pulse Bolt', desc: 'A resonating bolt that marks.', cd: 4.5, mana: 40, range: 700, aim: 'dir',
        cast(w, h, aim) { line(w, h, aim, { speed: 1250, range: 700, dmg: M(h, 120, 24, 0.55), dtype: 'magic', kindLabel: 'pulsebolt', radius: 18, onHit(w2, p, t) { addRhythm(w2, h, t); } }); } },
      e: { name: 'Step Through', desc: 'Dash; crossing an enemy hero marks and slows them.', cd: 7, mana: 40, range: 340, aim: 'dir',
        cast(w, h, aim) {
          const a = Math.atan2(aim.y - h.y, aim.x - h.x); h.aim = a;
          kit.dash(w, h, { aim: a, dist: 340, dur: 0.2, onProgress(w2, hh, k) {
            for (const t of kit.enemiesInRadius(w2, hh, hh.x, hh.y, 95, { heroesOnly: true })) {
              if (!t.custom._luxaStepped) {
                t.custom._luxaStepped = true;
                setTimeout(() => t.custom._luxaStepped = false, 80);
                addRhythm(w2, hh, t);
                applyCC(w2, t, 'slow', 1.2, { pct: 0.3 });
              }
            }
          } });
        } },
      r: { name: 'Encore', desc: 'For 6s your dashes are free and rapid, and each emits a damaging pulse.', cd: 46, mana: 100, range: 0, aim: 'self', ult: true,
        cast(w, h) { applyBuff(w, h, { id: 'encore', until: w.t + 6, icon: 'encore' }); w.emit({ type: 'buffFx', id: h.id, hero: 'luxa', buff: 'encore' }); } },
    },
    build: ['talon', 'arcanetreads', 'codex', 'voidscepter', 'stormtome', 'colossus'],
    ai: { style: 'assassin', combo: ['q', 'e'], keepRange: 300, gapClose: 'e' },
  },

  // ---------------- FIGHTERS (EXP) ----------------
  venom: {
    n: 'Venom', title: 'The Marsh Fang', archetype: 'fighter', resource: 'mana',
    primaryRole: 'EXP', secondaryRole: 'JUNGLE', recommendedLane: 'EXP', difficulty: 2,
    c1: '#2ed573', c2: '#7bed9f',
    portrait: { skin: '#a8c8a0', helm: 'mask', hair: '#1e7a44', cape: '#14532d', emblem: 'fang' },
    hp: 760, mana: 300, manaRegen: 2.4, hpRegen: 2.0, physAtk: 66,
    physDef: 24, magDef: 19, aspd: 0.88, ms: 246, range: 115,
    atk: { melee: true },
    passive: { name: 'Toxin', desc: 'Attacks and skills stack Venom. At 4 stacks the toxin bursts, damaging and healing you.' },
    abilities: {
      q: { name: 'Toxic Pool', desc: 'A pool that damages and slows.', cd: 8, mana: 55, range: 560, aim: 'point',
        cast(w, h, aim) { kit.zone(w, h, aim.x, aim.y, 175, 4, { every: 0.5, visual: 'poison', slow: 0.25, slowDur: 0.6, dmg: M(h, 22, 4, 0.15), dtype: 'magic', kindLabel: 'toxicpool', per: (w2, src, t) => addVenom(w2, h, t) }); } },
      e: { name: 'Fang Lunge', desc: 'Lunge and bite, healing for a portion of damage.', cd: 9, mana: 45, range: 280, aim: 'dir',
        cast(w, h, aim) {
          const a = Math.atan2(aim.y - h.y, aim.x - h.x); h.aim = a;
          kit.dash(w, h, { aim: a, dist: 250, dur: 0.2, onEnd(w2, hh) {
            const t = kit.nearestEnemy(w2, hh, 130);
            if (t) {
              const dealt = kit.hit(w2, hh, t, P(hh, 85, 17, 0.5), { dtype: 'phys', kindLabel: 'fanglunge' });
              heal(w2, hh, dealt * 0.5, 'fanglunge', hh);
              addVenom(w2, hh, t); addVenom(w2, hh, t);
              w2.emit({ type: 'biteFx', x: t.x, y: t.y });
            }
          } });
        } },
      r: { name: 'Miasma', desc: 'A vast toxic cloud that melts enemies and feeds you.', cd: 44, mana: 90, range: 0, aim: 'self', ult: true,
        cast(w, h) {
          kit.zone(w, h, h.x, h.y, 310, 5, { every: 0.5, visual: 'miasma', slow: 0.3, slowDur: 0.8, dmg: M(h, 28, 6, 0.16), dtype: 'magic', kindLabel: 'miasma',
            follow: h, per: (w2, src, t) => { addVenom(w2, h, t); } });
          applyBuff(w, h, { id: 'venomFeast', until: w.t + 5, data: { lifesteal: 0.15 } });
        } },
    },
    hooks: {},
    build: ['greaves', 'talon', 'saber', 'colossus', 'bramble', 'stormpike'],
    ai: { style: 'fighter', combo: ['q', 'e'], keepRange: 100 },
  },

  ember: {
    n: 'Ember', title: 'The Undying Hearth', archetype: 'fighter', resource: 'mana',
    primaryRole: 'EXP', secondaryRole: 'ROAM', recommendedLane: 'EXP', difficulty: 1,
    c1: '#ff9f43', c2: '#ffd8a8',
    portrait: { skin: '#e8b088', helm: 'none', hair: '#c85a1a', cape: '#8a3e10', emblem: 'sun' },
    hp: 780, mana: 300, manaRegen: 2.4, hpRegen: 2.2, physAtk: 64,
    physDef: 25, magDef: 20, aspd: 0.86, ms: 244, range: 110,
    atk: { melee: true },
    passive: { name: 'Phoenix Heart', desc: 'Below 40% HP, regenerate rapidly.' },
    abilities: {
      q: { name: 'Life Bloom', desc: 'Heal and scorch nearby enemies.', cd: 8, mana: 50, range: 0, aim: 'self',
        cast(w, h) { heal(w, h, HP(h, 0.06) + M(h, 70, 12, 0.3), 'lifebloom', h); kit.aoe(w, h, h.x, h.y, 160, M(h, 60, 10, 0.25), { dtype: 'magic', kindLabel: 'lifebloom', color: '#ffd8a8' }); w.emit({ type: 'healFx', x: h.x, y: h.y, id: h.id }); } },
      e: { name: 'Solar Thorns', desc: 'For 3.5s take reduced damage and burn melee attackers.', cd: 13, mana: 60, range: 0, aim: 'self',
        cast(w, h) {
          applyBuff(w, h, { id: 'thorns', until: w.t + 3.5, stats: { dmgReduction: 0.25 }, data: { reflect: 40 + h.level * 8 }, icon: 'thorns' });
        } },
      r: { name: 'Rebirth', desc: 'For 8s, death instead reignites you at 35% HP with a burning nova.', cd: 75, mana: 100, range: 0, aim: 'self', ult: true,
        cast(w, h) {
          applyBuff(w, h, { id: 'rebirth', until: w.t + 8, icon: 'rebirth' });
          w.emit({ type: 'buffFx', id: h.id, hero: 'ember', buff: 'rebirth' });
        } },
    },
    hooks: {
      tick(w, h) {
        if (h.hp / h.maxHp < 0.4 && !h.dead) heal(w, h, h.maxHp * 0.012, 'phoenixheart');
      },
      onDamaged(w, h, src, amt, ev) {
        const th = getBuff(h, 'thorns');
        if (th && ev.category === 'basic' && ev.melee && src && src.team !== h.team && !src.dead) {
          dealDamage(w, { src: h, tgt: src, amount: th.data.reflect, dtype: 'magic', category: 'dot', kindLabel: 'solarthorns' });
        }
      },
      onDeathIntercept(w, h) {
        if (hasBuff(h, 'rebirth')) {
          removeBuff(h, 'rebirth');
          h.dead = false; h.hp = h.maxHp * 0.35;
          h.invulnUntil = w.t + 1.0;
          kit.aoe(w, h, h.x, h.y, 250, M(h, 200, 35, 0.4), { dtype: 'magic', kindLabel: 'rebirth', slow: 0.3, slowDur: 1.2 });
          w.emit({ type: 'phoenixRevive', id: h.id, x: h.x, y: h.y });
          return true; // intercepted death
        }
        return false;
      },
    },
    build: ['greaves', 'colossus', 'bramble', 'saber', 'runeward', 'stormpike'],
    ai: { style: 'fighter', combo: ['q', 'e'], keepRange: 95 },
  },

  verity: {
    n: 'Verity', title: 'Judge of Truth', archetype: 'fighter', resource: 'mana',
    primaryRole: 'EXP', secondaryRole: null, recommendedLane: 'EXP', difficulty: 3,
    c1: '#facc15', c2: '#fef08a',
    portrait: { skin: '#e8c39a', helm: 'blindfold', hair: '#e5d47a', cape: '#854d0e', emblem: 'scales' },
    hp: 745, mana: 320, manaRegen: 2.5, hpRegen: 2.0, physAtk: 68,
    physDef: 23, magDef: 19, aspd: 0.9, ms: 246, range: 120,
    atk: { melee: true },
    passive: { name: 'Pressure', desc: 'Attacks and skills build Pressure. A fully-pressured strike hits much harder.' },
    abilities: {
      q: { name: 'Snap', desc: 'Consume all Pressure in a stunning shockwave.', cd: 7, mana: 45, range: 0, aim: 'self',
        cast(w, h) {
          const stacks = h.custom.pressure || 0;
          h.custom.pressure = 0;
          kit.aoe(w, h, h.x, h.y, 190, P(h, 40, 8, 0.25) + stacks * 14, { dtype: 'phys', category: 'skill', kindLabel: 'snap', slow: 0.3, slowDur: 1 });
          w.emit({ type: 'pressureNova', x: h.x, y: h.y, stacks, hero: 'verity' });
        } },
      e: { name: 'Composure', desc: 'Consume Pressure for shield and speed; or store a little if empty.', cd: 10, mana: 40, range: 0, aim: 'self',
        cast(w, h) {
          const stacks = h.custom.pressure || 0;
          const use = Math.min(stacks, 4);
          h.custom.pressure = stacks - use;
          if (use > 0) { addShield(w, h, 22 * use + h.level * 4, 3, 'composure'); applyBuff(w, h, { id: 'composure', until: w.t + 1.5, stats: { ms: 50 } }); }
          else { h.custom.pressure = 1; applyCC(w, h, 'slow', 0.8, { pct: 0.15 }); }
        } },
      r: { name: 'Trial by Combat', desc: 'Mark a champion: you deal more damage to them and heal from it. The verdict detonates when the trial ends.', cd: 52, mana: 90, range: 420, aim: 'target', ult: true,
        cast(w, h, aim) {
          const t = aim.target || kit.nearestEnemy(w, h, 420, u => u.kind === 'hero');
          if (!t) return false;
          applyBuff(w, t, { id: 'trial', until: w.t + 6, data: { owner: h.id, dealt: 0 } });
          applyBuff(w, h, { id: 'trialist', until: w.t + 6, mult: { dmgAmp: 0.15 }, stats: { lifesteal: 0.15 }, icon: 'trial' });
          w.emit({ type: 'trialStart', id: t.id, by: h.id });
        } },
    },
    hooks: {
      onBasicHit(w, h, t) {
        const p = (h.custom.pressure = Math.min(8, (h.custom.pressure || 0) + 1));
        if (p >= 5 && !h.custom.pressureSpent) {
          h.custom.pressureSpent = true; h.custom.pressure = p - 3;
          setTimeout(() => h.custom.pressureSpent = false, 60);
          w.emit({ type: 'pressureStrike', x: t.x, y: t.y });
          return 0.5; // damage multiplier hook
        }
      },
      onDealtDamage(w, h, t, amt, ev) {
        const trial = t.kind === 'hero' && getBuff(t, 'trial');
        if (trial && trial.data.owner === h.id) trial.data.dealt += amt;
      },
      tick(w, h) {
        const trialT = h.custom._trialT || 0;
        // detonate expired trials handled in tickTrial below (registered by Sim)
      },
    },
    build: ['greaves', 'saber', 'colossus', 'stormpike', 'bramble', 'dawnedge'],
    ai: { style: 'fighter', combo: ['q', 'e'], keepRange: 100 },
  },

  ravenor: {
    n: 'Ravenor', title: 'Herald of Corruption', archetype: 'fighter', resource: 'rage',
    primaryRole: 'EXP', secondaryRole: 'JUNGLE', recommendedLane: 'EXP', difficulty: 3,
    c1: '#dc2645', c2: '#7f1d2d',
    portrait: { skin: '#c98a6a', helm: 'horns', hair: '#450a0a', cape: '#450a0a', emblem: 'skull', glow: '#dc2645' },
    hp: 790, mana: 0, manaRegen: 0, hpRegen: 2.1, physAtk: 70,
    physDef: 25, magDef: 19, aspd: 0.9, ms: 248, range: 120,
    atk: { melee: true },
    passive: { name: 'Corruption', desc: 'Dealing and taking damage builds Rage. Higher Rage stages sharpen Ravenor. Skills corrupt, wounding over time.' },
    abilities: {
      q: { name: 'Ruinous Cleave', desc: 'Cleave enemies ahead. Spends Rage for bonus damage and armor shred.', cd: 5.5, mana: 0, range: 0, aim: 'dir',
        cast(w, h, aim) {
          const a = Math.atan2(aim.y - h.y, aim.x - h.x); h.aim = a;
          const rage = h.custom.rage || 0;
          const spend = rage >= 30 ? 30 : 0;
          h.custom.rage = rage - spend;
          const targets = coneTargets(w, h, a, 300, Math.PI * 0.42);
          for (const t of targets) {
            dealDamage(w, { src: h, tgt: t, amount: P(h, 85, 16, 0.6) + spend * 1.1, dtype: 'phys', category: 'skill', kindLabel: 'ruinouscleave' });
            corrupt(w, h, t);
            if (spend) applyBuff(w, t, { id: 'shred', until: w.t + 3, stats: { physDef: -Math.round((t.stats?.physDef || 0) * 0.15) } });
          }
          w.emit({ type: 'cone', x: h.x, y: h.y, a, len: 300, spread: Math.PI * 0.42, color: h.def.c1, hero: 'ravenor' });
        } },
      e: { name: 'Dread Pounce', desc: 'Pounce forward; striking a hero builds Rage and shreds armor.', cd: 9, mana: 0, range: 300, aim: 'dir',
        cast(w, h, aim) {
          const a = Math.atan2(aim.y - h.y, aim.x - h.x); h.aim = a;
          kit.dash(w, h, { aim: a, dist: 290, dur: 0.22, onEnd(w2, hh) {
            for (const t of kit.enemiesInRadius(w2, hh, hh.x, hh.y, 150, {})) {
              dealDamage(w2, { src: hh, tgt: t, amount: P(hh, 70, 13, 0.45), dtype: 'phys', category: 'skill', kindLabel: 'dreadpounce' });
              corrupt(w2, hh, t);
              if (t.kind === 'hero') {
                hh.custom.rage = clamp((hh.custom.rage || 0) + 22, 0, 100);
                applyBuff(w2, t, { id: 'shred', until: w2.t + 2.5, stats: { physDef: -Math.round((t.stats?.physDef || 0) * 0.1) } });
              }
            }
          } });
        } },
      r: { name: 'Carnage Verdict', desc: 'Leap to a hero and execute: bonus damage scales with their missing HP. Kills refresh half the cooldown and grant full Rage.', cd: 50, mana: 0, range: 440, aim: 'target', ult: true,
        cast(w, h, aim) {
          const t = aim.target || kit.nearestEnemy(w, h, 440, u => u.kind === 'hero');
          if (!t) return false;
          kit.blink(w, h, t.x - Math.cos(h.aim) * 60, t.y - Math.sin(h.aim) * 60, 460);
          const missing = 1 - t.hp / t.maxHp;
          const dmg = P(h, 130, 26, 0.7) + missing * t.maxHp * 0.12;
          dealDamage(w, { src: h, tgt: t, amount: dmg, dtype: 'phys', category: 'skill', kindLabel: 'carnageverdict', melee: true });
          corrupt(w, h, t);
          applyCC(w, t, 'slow', 1.2, { pct: 0.3 });
          w.emit({ type: 'executeFx', x: t.x, y: t.y, hero: 'ravenor' });
          h.custom.verdictTarget = t.id;
        } },
    },
    hooks: {
      onDealtDamage(w, h, t, amt, ev) {
        if (ev.category === 'basic' || ev.category === 'skill') h.custom.rage = clamp((h.custom.rage || 0) + (ev.category === 'basic' ? 6 : 9), 0, 100);
        if (h.custom.verdictTarget === t?.id && t.dead) { h.cds.r = Math.max(h.cds.r, 0); h.cds.r *= 0.5; h.custom.rage = 100; h.custom.verdictTarget = null; }
      },
      onDamaged(w, h, src, amt, ev) {
        if (src && src.team !== h.team && (ev.category === 'basic' || ev.category === 'skill')) h.custom.rage = clamp((h.custom.rage || 0) + 7, 0, 100);
      },
      tick(w, h) {
        const rage = h.custom.rage || 0;
        // rage stage buffs
        if (rage >= 60) applyBuff(w, h, { id: 'frenzied', until: w.t + 0.5, stats: { physPen: 8 }, mult: { dmgAmp: 0.06 }, icon: 'rage' });
        else if (rage >= 25) applyBuff(w, h, { id: 'fueled', until: w.t + 0.5, stats: { ms: 15 }, icon: 'rage' });
      },
    },
    build: ['greaves', 'talon', 'saber', 'colossus', 'stormpike', 'bramble'],
    ai: { style: 'fighter', combo: ['q', 'e', 'r'], keepRange: 100 },
  },

  kaido: {
    n: 'Kaido', title: 'Fist of the Flowing River', archetype: 'fighter', resource: 'none',
    primaryRole: 'EXP', secondaryRole: 'JUNGLE', recommendedLane: 'EXP', difficulty: 3,
    c1: '#f43f5e', c2: '#fecdd3',
    portrait: { skin: '#e0a878', helm: 'band', hair: '#1f2937', cape: '#7f1d1d', emblem: 'fist' },
    hp: 770, mana: 0, manaRegen: 0, hpRegen: 2.2, physAtk: 68,
    physDef: 24, magDef: 19, aspd: 0.92, ms: 248, range: 115,
    atk: { melee: true },
    passive: { name: 'Flow State', desc: 'Skills build Tempo. At 3 Tempo your next skill is Empowered: stronger with a bonus effect.' },
    abilities: {
      q: { name: 'Comet Fist', desc: 'Dash-punch. Empowered: knocks up.', cd: 5, mana: 0, range: 280, aim: 'dir',
        cast(w, h, aim) {
          const emp = takeTempo(h);
          const a = Math.atan2(aim.y - h.y, aim.x - h.x); h.aim = a;
          kit.dash(w, h, { aim: a, dist: 260, dur: 0.18, onEnd(w2, hh) {
            for (const t of kit.enemiesInRadius(w2, hh, hh.x, hh.y, 140, {})) {
              dealDamage(w2, { src: hh, tgt: t, amount: P(hh, 78, 14, 0.55) * (emp ? 1.4 : 1), dtype: 'phys', category: 'skill', kindLabel: 'cometfist', melee: true });
              if (emp) applyCC(w2, t, 'knockup', 0.6, {});
            }
            if (emp) w2.emit({ type: 'empowerFx', x: hh.x, y: hh.y, hero: 'kaido', skill: 'q' });
            addTempo(w2, h);
          } });
        } },
      e: { name: 'Whirl Kick', desc: 'Spinning kick. Empowered: drags enemies inward.', cd: 7, mana: 0, range: 0, aim: 'self',
        cast(w, h) {
          const emp = takeTempo(h);
          const targets = kit.enemiesInRadius(w, h, h.x, h.y, 180, {});
          for (const t of targets) {
            dealDamage(w, { src: h, tgt: t, amount: P(h, 68, 12, 0.45) * (emp ? 1.4 : 1), dtype: 'phys', category: 'skill', kindLabel: 'whirlkick', melee: true });
            if (emp) kit.pullToward(w, t, h.x, h.y, 300, 0.35);
          }
          if (emp) w.emit({ type: 'empowerFx', x: h.x, y: h.y, hero: 'kaido', skill: 'e' });
          addTempo(w, h);
        } },
      r: { name: 'Thousand Streams', desc: 'A flurry of strikes weaving between nearby enemies, finishing with a shockwave.', cd: 48, mana: 0, range: 0, aim: 'self', ult: true,
        cast(w, h) {
          h.custom.flurry = { hits: 0, next: w.t, end: w.t + 2.4 };
          w.emit({ type: 'flurryStart', id: h.id, hero: 'kaido' });
        } },
    },
    hooks: {
      tick(w, h) { tickFlurry(w, h); },
    },
    build: ['greaves', 'saber', 'colossus', 'dawnedge', 'bramble', 'stormpike'],
    ai: { style: 'fighter', combo: ['q', 'e', 'q'], keepRange: 100 },
  },

  // ---------------- TANKS / ROAM ----------------
  titan: {
    n: 'Titan', title: 'The Mountain That Walks', archetype: 'tank', resource: 'mana',
    primaryRole: 'ROAM', secondaryRole: 'EXP', recommendedLane: 'ROAM', difficulty: 1,
    c1: '#ff5e57', c2: '#ffc2c0',
    portrait: { skin: '#d8a080', helm: 'great-helm', hair: '#5a2e22', cape: '#7f1d1d', emblem: 'mountain' },
    hp: 880, mana: 300, manaRegen: 2.2, hpRegen: 2.4, physAtk: 58,
    physDef: 30, magDef: 22, aspd: 0.78, ms: 238, range: 105,
    atk: { melee: true },
    passive: { name: 'Bedrock', desc: 'Taking hero damage grants Stone stacks, each granting defenses.' },
    abilities: {
      q: { name: 'Seismic Slam', desc: 'Slam the ground, knocking enemies up.', cd: 8, mana: 55, range: 0, aim: 'self',
        cast(w, h) { kit.aoe(w, h, h.x, h.y, 185, P(h, 70, 12, 0.3) + HP(h, 0.04), { dtype: 'phys', kindLabel: 'seismicslam', knockup: 0.75, category: 'skill' }); w.emit({ type: 'quake', x: h.x, y: h.y, r: 185, hero: 'titan' }); } },
      e: { name: 'Bulwark Oath', desc: 'Shield yourself and nearby allies; they gain tenacity.', cd: 12, mana: 65, range: 0, aim: 'self',
        cast(w, h) {
          const allies = kit.alliesInRadius(w, h, h.x, h.y, 420, true);
          const amt = HP(h, 0.045) + 80 + h.level * 12;
          kit.shield(w, h, allies, amt, 2.8);
          kit.buff(w, h, allies, { id: 'bulwark', until: w.t + 3, stats: { tenacity: 0.15 }, icon: 'bulwark' });
        } },
      r: { name: 'Colossus Charge', desc: 'Charge forward, seizing the first hero hit and dragging them to a devastating stop.', cd: 52, mana: 100, range: 0, aim: 'dir', ult: true,
        cast(w, h, aim) {
          const a = Math.atan2(aim.y - h.y, aim.x - h.x); h.aim = a;
          h.custom.chargeDrag = null;
          kit.dash(w, h, { aim: a, dist: 480, dur: 0.5, onProgress(w2, hh, k) {
            if (!hh.custom.chargeDrag) {
              const t = kit.enemiesInRadius(w2, hh, hh.x, hh.y, 120, { heroesOnly: true })[0];
              if (t) { hh.custom.chargeDrag = t; applyCC(w2, t, 'stun', 1.4, {}); w2.emit({ type: 'grabFx', id: t.id, by: hh.id }); }
            }
            if (hh.custom.chargeDrag) { const t = hh.custom.chargeDrag; t.x = hh.x + Math.cos(hh.aim) * 70; t.y = hh.y + Math.sin(hh.aim) * 70; }
          }, onEnd(w2, hh) {
            const t = hh.custom.chargeDrag;
            kit.aoe(w2, hh, hh.x, hh.y, 220, P(hh, 110, 20, 0.4) + HP(hh, 0.05), { dtype: 'phys', kindLabel: 'colossuscharge', stun: t ? 1.0 : 0.6, category: 'skill' });
            hh.custom.chargeDrag = null;
            w2.emit({ type: 'quake', x: hh.x, y: hh.y, r: 220, hero: 'titan' });
          } });
        } },
    },
    hooks: {
      onDamaged(w, h, src, amt, ev) {
        if (src && src.kind === 'hero' && src.team !== h.team) {
          const stacks = Math.min(5, (h.custom.stone || 0) + 1);
          h.custom.stone = stacks;
          applyBuff(w, h, { id: 'bedrock', until: w.t + 5, stats: { physDef: 8 * stacks, magDef: 4 * stacks }, icon: 'bedrock' });
        }
      },
    },
    build: ['greaves', 'colossus', 'ironbark', 'bramble', 'runeward', 'sentineloath'],
    ai: { style: 'tank', combo: ['r', 'q'], keepRange: 90, initiator: true },
  },

  warden: {
    n: 'Warden', title: 'Shield of the Vale', archetype: 'tank', resource: 'mana',
    primaryRole: 'ROAM', secondaryRole: null, recommendedLane: 'ROAM', difficulty: 2,
    c1: '#22d3ee', c2: '#a5f3fc',
    portrait: { skin: '#d8b490', helm: 'great-helm', hair: '#155e75', cape: '#164e63', emblem: 'shield' },
    hp: 850, mana: 340, manaRegen: 2.4, hpRegen: 2.2, physAtk: 56,
    physDef: 28, magDef: 22, aspd: 0.8, ms: 240, range: 130,
    atk: { melee: true },
    passive: { name: 'Aegis Oath', desc: 'Nearby allies gain bonus defenses.' },
    abilities: {
      q: { name: 'Shield Bash', desc: 'Bash enemies back with your aegis.', cd: 7.5, mana: 50, range: 0, aim: 'dir',
        cast(w, h, aim) {
          const a = Math.atan2(aim.y - h.y, aim.x - h.x); h.aim = a;
          const targets = coneTargets(w, h, a, 240, Math.PI * 0.5);
          for (const t of targets) { dealDamage(w, { src: h, tgt: t, amount: P(h, 65, 12, 0.3) + HP(h, 0.03), dtype: 'phys', category: 'skill', kindLabel: 'shieldbash', melee: true }); kit.knock(w, t, h.x, h.y, 0.3, 200); }
          w.emit({ type: 'cone', x: h.x, y: h.y, a, len: 240, spread: Math.PI * 0.5, color: h.def.c1, hero: 'warden' });
        } },
      e: { name: 'Rally', desc: 'Shield nearby allies and hasten them.', cd: 11, mana: 60, range: 0, aim: 'self',
        cast(w, h) {
          const allies = kit.alliesInRadius(w, h, h.x, h.y, 420, true);
          kit.shield(w, h, allies, HP(h, 0.04) + 70 + h.level * 10, 2.5);
          kit.buff(w, h, allies, { id: 'rally', until: w.t + 2, stats: { ms: 40 } });
        } },
      r: { name: 'Sanctuary', desc: 'Consecrate ground: allies inside take less damage; enemies are slowed.', cd: 55, mana: 100, range: 500, aim: 'point', ult: true,
        cast(w, h, aim) {
          kit.zone(w, h, aim.x, aim.y, 280, 4, { every: 0.5, visual: 'sanctuary', slow: 0.3, slowDur: 0.7, dmg: M(h, 10, 2, 0.08), dtype: 'magic', kindLabel: 'sanctuary',
            per: (w2, src, t) => { if (t.team === h.team) applyBuff(w2, t, { id: 'sanctuary', until: w2.t + 0.8, mult: { dmgReduction: 0.25 } }); } });
        } },
    },
    hooks: {
      tick(w, h) {
        for (const o of kit.alliesInRadius(w, h, h.x, h.y, 450, false)) applyBuff(w, o, { id: 'aegis', until: w.t + 0.6, stats: { physDef: 12, magDef: 12 } });
      },
    },
    build: ['stoneguard', 'colossus', 'ironbark', 'runeward', 'bramble', 'sentineloath'],
    ai: { style: 'tank', combo: ['q', 'r'], keepRange: 95, initiator: true, peelAlly: true },
  },

  aegiron: {
    n: 'Aegiron', title: 'Anchor of the Deep', archetype: 'tank', resource: 'mana',
    primaryRole: 'ROAM', secondaryRole: 'EXP', recommendedLane: 'ROAM', difficulty: 2,
    c1: '#0ea5e9', c2: '#7dd3fc',
    portrait: { skin: '#8fb8c9', helm: 'crown', hair: '#075985', cape: '#0c4a6e', emblem: 'anchor', glow: '#38bdf8' },
    hp: 890, mana: 320, manaRegen: 2.3, hpRegen: 2.4, physAtk: 57,
    physDef: 31, magDef: 23, aspd: 0.76, ms: 236, range: 110,
    atk: { melee: true },
    passive: { name: 'Deep Currents', desc: 'Every 8s your next skill is Tideborne: 30% larger and shields 40% more.' },
    abilities: {
      q: { name: 'Tidebreaker Slam', desc: 'A rising wave knocks enemies up.', cd: 8.5, mana: 55, range: 0, aim: 'self',
        cast(w, h) {
          const tide = takeTideborne(w, h);
          const r = tide ? 250 : 190;
          kit.aoe(w, h, h.x, h.y, r, P(h, 60, 11, 0.28) + HP(h, 0.035), { dtype: 'phys', kindLabel: 'tidebreaker', knockup: 0.8, category: 'skill' });
          w.emit({ type: 'quake', x: h.x, y: h.y, r, hero: 'aegiron', tide });
        } },
      e: { name: 'Riptide Barrier', desc: 'Raise a current wall that blocks movement and projectiles. Allies behind it surge forward.', cd: 13, mana: 65, range: 450, aim: 'point',
        cast(w, h, aim) {
          const tide = takeTideborne(w, h);
          const a = Math.atan2(aim.y - h.y, aim.x - h.x) + Math.PI / 2;
          const len = tide ? 220 : 170;
          const cx = clamp(aim.x, 80, 6320), cy = clamp(aim.y, 80, 6320);
          kit.wall(w, h, cx + Math.cos(a) * len, cy + Math.sin(a) * len, cx - Math.cos(a) * len, cy - Math.sin(a) * len, 2.8, { color: '#7dd3fc' });
        } },
      r: { name: 'Maelstrom Anchor', desc: 'Hurl your anchor; after a moment the current converges, dragging all enemies to it.', cd: 55, mana: 100, range: 520, aim: 'point', ult: true,
        cast(w, h, aim) {
          w.areas.push({ kind: 'area', shape: 'circle', x: aim.x, y: aim.y, r: 340, team: h.team, src: h, until: w.t + 1.6, armAt: w.t + 0.8, color: h.def.c1, telegraph: true, visual: 'maelstrom', hero: 'aegiron',
            onArm(w2, a) {
              const targets = kit.enemiesInRadius(w2, h, aim.x, aim.y, 340, {});
              for (const t of targets) {
                kit.pullToward(w2, t, aim.x, aim.y, 620, 0.5);
                applyCC(w2, t, 'stun', 1.0, {});
                dealDamage(w2, { src: h, tgt: t, amount: P(h, 100, 18, 0.35) + HP(h, 0.04), dtype: 'phys', category: 'skill', kindLabel: 'maelstrom' });
              }
              w2.emit({ type: 'aoe', x: aim.x, y: aim.y, r: 340, color: h.def.c1, hero: 'aegiron', shape: 'ring' });
            } });
        } },
    },
    build: ['stoneguard', 'colossus', 'ironbark', 'runeward', 'bramble', 'sentineloath'],
    ai: { style: 'tank', combo: ['r', 'q'], keepRange: 90, initiator: true },
  },

  // remaining originals reworked from the Chaos Clash roster
};

// =================================================================
// shared mini-helpers used by kits above
function ignite(w, h, t) {
  applyBuff(w, t, { id: 'scorched', until: w.t + 2, data: { tickAt: 0, dmg: 6 + h.level * 2 + (h.stats?.magPower || 0) * 0.06, owner: h.id } });
}
function addFrost(w, h, t) {
  const b = getBuff(t, 'frostbite');
  const stacks = b ? (b.stacks || 0) + 1 : 1;
  if (stacks >= 3) {
    removeBuff(t, 'frostbite');
    applyCC(w, t, 'freeze', 1.0, {});
    dealDamage(w, { src: h, tgt: t, amount: 40 + h.level * 8 + (h.stats?.magPower || 0) * 0.15, dtype: 'magic', category: 'skill', kindLabel: 'frostbite' });
    w.emit({ type: 'freezeFx', x: t.x, y: t.y });
  } else applyBuff(w, t, { id: 'frostbite', until: w.t + 4, stacks, maxStacks: 3 });
}
function addEcho(w, h, t) {
  const b = getBuff(t, 'echo');
  const stacks = b ? (b.stacks || 0) + 1 : 1;
  if (stacks >= 2) {
    removeBuff(t, 'echo');
    dealDamage(w, { src: h, tgt: t, amount: 70 + h.level * 14 + (h.stats?.magPower || 0) * 0.4, dtype: 'magic', category: 'skill', kindLabel: 'resonance' });
    applyCC(w, t, 'silence', 0.6, {});
    w.emit({ type: 'echoDetonate', x: t.x, y: t.y });
  } else applyBuff(w, t, { id: 'echo', until: w.t + 5, stacks, maxStacks: 2 });
}
function addVenom(w, h, t) {
  const b = getBuff(t, 'venomstack');
  const stacks = b ? (b.stacks || 0) + 1 : 1;
  if (stacks >= 4) {
    removeBuff(t, 'venomstack');
    const dmg = 60 + h.level * 12 + (h.stats?.physAtk || 0) * 0.3;
    dealDamage(w, { src: h, tgt: t, amount: dmg, dtype: 'magic', category: 'skill', kindLabel: 'venomburst' });
    heal(w, h, dmg, 'venomburst', h);
    w.emit({ type: 'venomBurst', x: t.x, y: t.y });
  } else applyBuff(w, t, { id: 'venomstack', until: w.t + 4, stacks, maxStacks: 4 });
}
function addRhythm(w, h, t) { applyBuff(w, t, { id: 'rhythm', until: w.t + 4, data: { owner: h.id } }); }
function corrupt(w, h, t) {
  applyBuff(w, t, { id: 'corruption', until: w.t + 2, stacks: Math.min(3, (getBuff(t, 'corruption')?.stacks || 0) + 1), maxStacks: 3,
    data: { owner: h.id, dmg: 12 + h.level * 3, tickAt: 0 } });
}
function voltChain(w, h, t) {
  h.custom.staticN = ((h.custom.staticN || 0) + 1);
  if (h.custom.staticN % 3 !== 0) return;
  const o = kit.nearestEnemy(w, t, 320, u => u !== t);
  if (o) {
    dealDamage(w, { src: h, tgt: o, amount: (h.stats?.physAtk || 50) * 0.5, dtype: 'magic', category: 'basic', kindLabel: 'staticcharge' });
    w.emit({ type: 'chain', x1: t.x, y1: t.y, x2: o.x, y2: o.y, color: '#fff176', hero: 'volt' });
  }
  if (hasBuff(h, 'stormform')) {
    let from = t;
    for (let i = 0; i < 2; i++) {
      const o2 = kit.nearestEnemy(w, from, 300, u => u !== t && u !== o);
      if (!o2) break;
      dealDamage(w, { src: h, tgt: o2, amount: (h.stats?.physAtk || 50) * 0.4, dtype: 'magic', category: 'basic', kindLabel: 'stormform' });
      w.emit({ type: 'chain', x1: from.x, y1: from.y, x2: o2.x, y2: o2.y, color: '#fff176', hero: 'volt' });
      from = o2;
    }
  }
}
function phaseEdge(w, h) { applyBuff(w, h, { id: 'phaseedge', until: w.t + 3, data: { amp: 0.3 } }); }
export function riftBlink(w, h, aim) {
  const st = h.custom.rift;
  if (!st || st.charges <= 0 || w.t > st.until) return false;
  st.charges--;
  kit.blink(w, h, aim.x, aim.y, 320);
  kit.aoe(w, h, h.x, h.y, 150, P(h, 60, 12, 0.35), { dtype: 'phys', category: 'skill', kindLabel: 'riftwalker' });
  phaseEdge(w, h);
  w.emit({ type: 'riftBlink', id: h.id, x: h.x, y: h.y, charges: st.charges });
  if (st.charges <= 0) h.custom.rift = null;
  return true;
}
function addTempo(w, h) {
  h.custom.tempo = Math.min(3, (h.custom.tempo || 0) + 1);
  h.custom.tempoUntil = h.world.t + 6;
}
function takeTempo(h) {
  if ((h.custom.tempo || 0) >= 3 && h.world.t < (h.custom.tempoUntil ?? Infinity)) {
    h.custom.tempo = 0;
    const ab = h.def.abilities;
    for (const k of ['q', 'e']) h.cds[k] = Math.max(h.cds[k] * 0.8, 0);
    return true;
  }
  return false;
}
function takeTideborne(w, h) {
  if ((h.custom.tideAt || 0) <= w.t) { h.custom.tideAt = w.t + 8; return true; }
  return false;
}
export function tickFlurry(w, h) {
  const f = h.custom.flurry;
  if (!f) return;
  if (w.t > f.end) {
    if (f.hits >= 5) {
      kit.aoe(w, h, h.x, h.y, 220, P(h, 60, 10, 0.3), { dtype: 'phys', category: 'skill', kindLabel: 'thousandstreams', slow: 0.3, slowDur: 1 });
      w.emit({ type: 'quake', x: h.x, y: h.y, r: 220, hero: 'kaido' });
    }
    h.custom.flurry = null;
    return;
  }
  if (w.t >= f.next) {
    const t = kit.nearestEnemy(w, h, 200, u => u.kind === 'hero' || u.kind === 'monster');
    if (t) {
      kit.blink(w, h, t.x + (w.rng.f() - 0.5) * 60, t.y + (w.rng.f() - 0.5) * 60, 260);
      dealDamage(w, { src: h, tgt: t, amount: P(h, 45, 8, 0.3), dtype: 'phys', category: 'skill', kindLabel: 'thousandstreams', melee: true });
      addTempo(w, h);
      f.hits++;
      f.next = w.t + 0.28;
      w.emit({ type: 'flurryHit', id: h.id, x: t.x, y: t.y, hits: f.hits });
    } else f.next = w.t + 0.15;
  }
}
function coneTargets(w, h, a, len, spread) {
  const out = [];
  const ex = h.x + Math.cos(a) * len, ey = h.y + Math.sin(a) * len;
  w.grid.query((h.x + ex) / 2, (h.y + ey) / 2, len, u => {
    if (u.dead || u.team === h.team || u.invulnUntil > w.t) return;
    if (!['hero', 'minion', 'monster', 'summon', 'colossus'].includes(u.kind)) return;
    const d = dist(h.x, h.y, u.x, u.y) - (u.r || 30);
    if (d > len) return;
    let da = Math.abs(Math.atan2(u.y - h.y, u.x - h.x) - a);
    while (da > Math.PI) da = Math.PI * 2 - da;
    if (da <= spread / 2 + Math.atan2(u.r || 30, Math.max(40, d))) out.push(u);
  });
  return out;
}
export { coneTargets, ignite, addFrost, addEcho, addVenom, addRhythm, corrupt, addTempo, takeTempo };
export const HERO_LIST = Object.keys(HEROES);

// ---- periodic DoT buffers (scorched/corruption tick) processed by Sim ----
export const DOT_BUFFS = {
  scorched: { interval: 0.5, magic: true },
  corruption: { interval: 0.5, magic: false, phys: true },
};
