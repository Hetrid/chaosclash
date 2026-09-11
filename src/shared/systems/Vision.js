// Legend Arena — vision & fog: bushes conceal, attacking reveals, allied units grant sight.
// Computes per-team visibility each snapshot tick. Never globally reveals enemies.
import { dist } from '../core/math.js';
import { bushAt } from '../map/MapData.js';
import { isHero, isMinion, isTurret, isStructure } from '../entities/kinds.js';

export const VISION_R = { hero: 560, minion: 400, turret: 620, core: 620, summon: 380, monster: 0, colossus: 420 };

export function computeVisibility(world) {
  // mark all enemy units invisible to each team, then reveal by sight sources
  const vis = { 0: new Set(), 1: new Set() };
  const units = [...world.heroes, ...world.minions, ...world.monsters, ...world.summons, ...world.colossi].filter(u => u && !u.dead);

  for (const team of [0, 1]) {
    // sight sources: own units
    const sources = [];
    for (const u of units) if (u.team === team) sources.push(u);
    for (const s of world.structures) if (!s.dead && s.team === team) sources.push(s);

    for (const u of units) {
      if (u.team === team) { vis[team].add(u.id); continue; }
      // enemy unit: check sight
      const targetBush = u.inBush ? u.bushId : null;
      let seen = false;
      for (const src of sources) {
        const r = (VISION_R[src.kind] || 380) + (src.buffs?.some(b => b.id === 'wispsight') ? 200 : 0);
        const d = dist(src.x, src.y, u.x, u.y);
        if (d > r) continue;
        // bush rule: concealed target only seen if observer shares the bush, or observer is a true-sight source with wisp buff close by
        if (targetBush) {
          const srcInBush = src.inBush && src.bushId === targetBush;
          const trueSight = src.kind === 'hero' && src.buffs?.some(b => b.id === 'wispsight') && d < 300;
          if (!srcInBush && !trueSight) continue;
        }
        seen = true; break;
      }
      // attacking from a bush reveals (recent basic/skill within 1.2s)
      if (!seen && u.kind === 'hero' && world.t - (u.lastRevealAt || -99) < 1.2) seen = true;
      if (seen) vis[team].add(u.id);
    }
  }
  return vis;
}

export function unitSight(world, u) {
  // called each tick: remember bush occupancy & attack reveal
  const b = bushAt(u.x, u.y);
  u.inBush = !!b;
  u.bushId = b ? b.id : null;
}
