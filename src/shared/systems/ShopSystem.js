// Legend Arena — in-match shop: buy/sell with component credit, slot limits,
// role-restricted categories, recommended builds & next-affordable logic.
import { CONFIG } from '../core/config.js';
import { ITEMS, buildPathValue } from './Items.js';
import { nearShop } from '../entities/Hero.js';
import { refreshMax } from '../entities/Hero.js';

export const MAX_SLOTS = 6;

export const ShopSystem = {
  // like canBuy but ignores distance-to-fountain (used by bots to DECIDE to go shopping)
  wantsToBuy(world, hero, itemId) {
    const item = ITEMS[itemId];
    if (!item) return { ok: false, why: 'unknown item' };
    if (item.role && hero.aiRole !== item.role) return { ok: false, why: 'role' };
    if (hero.items.filter(i => i === itemId).length >= (item.unique ? 1 : 2)) return { ok: false, why: 'owned' };
    const pathValue = buildPathValue(itemId, hero.items);
    const cost = item.cost - pathValue;
    if (hero.gold < cost) return { ok: false, why: 'gold', cost };
    const finalSlots = hero.items.length - (item.from || []).filter(c => hero.items.includes(c)).length;
    if (finalSlots >= MAX_SLOTS) return { ok: false, why: 'full', cost };
    return { ok: true, cost };
  },

  nextPurchase(world, hero) {
    const build = hero.def.build.filter(id => ITEMS[id]);
    for (const id of build) {
      const item = ITEMS[id];
      if (hero.items.includes(id)) continue;
      const check = this.wantsToBuy(world, hero, id);
      if (check.ok) return id;
      if (item.from) for (const c of item.from) {
        if (hero.items.includes(c)) continue;
        if (this.wantsToBuy(world, hero, c).ok) return c;
      }
    }
    return null;
  },

  canBuy(world, hero, itemId) {
    const item = ITEMS[itemId];
    if (!item) return { ok: false, why: 'unknown item' };
    if (item.role && hero.aiRole !== item.role) return { ok: false, why: `${item.role} role only` };
    if (hero.items.filter(i => i === itemId).length >= (item.unique ? 1 : 2)) return { ok: false, why: 'already owned' };
    const pathValue = buildPathValue(itemId, hero.items);
    const cost = item.cost - pathValue;
    if (hero.gold < cost) return { ok: false, why: 'need ' + cost + 'g', cost };
    if (!CONFIG.SHOP_ANYWHERE && !nearShop(world, hero)) return { ok: false, why: 'return to base to shop', cost };
    // slots: buying a final item frees its components
    const finalSlots = hero.items.length - (item.from || []).filter(c => hero.items.includes(c)).length;
    if (finalSlots >= MAX_SLOTS) return { ok: false, why: 'inventory full', cost };
    return { ok: true, cost };
  },

  buy(world, hero, itemId) {
    const check = this.canBuy(world, hero, itemId);
    if (!check.ok) return check;
    const item = ITEMS[itemId];
    // consume components
    if (item.from) for (const c of item.from) {
      const idx = hero.items.indexOf(c);
      if (idx >= 0) hero.items.splice(idx, 1);
    }
    hero.items.push(itemId);
    hero.gold -= check.cost;
    refreshMax(hero);
    world.emit({ type: 'buy', id: hero.id, item: itemId, cost: check.cost });
    return { ok: true, cost: check.cost };
  },

  sell(world, hero, slot) {
    if (slot < 0 || slot >= hero.items.length) return { ok: false, why: 'empty slot' };
    if (!CONFIG.SHOP_ANYWHERE && !nearShop(world, hero)) return { ok: false, why: 'return to base to sell' };
    const id = hero.items[slot];
    const refund = Math.round(ITEMS[id].cost * 0.7);
    hero.items.splice(slot, 1);
    hero.gold += refund;
    refreshMax(hero);
    world.emit({ type: 'sell', id: hero.id, item: id, refund });
    return { ok: true, refund };
  },

  // next recommended item the hero can afford (full item or any component)
  nextRecommended(world, hero) {
    const build = hero.def.build.filter(id => !hero.items.includes(id) || ITEMS[id].comp);
    for (const id of build) {
      const item = ITEMS[id];
      if (!item) continue;
      const owned = hero.items.includes(id);
      if (owned && !item.comp) continue;
      if (owned && item.comp && hero.items.filter(x => x === id).length >= 1 && !this._needsForLater(build, hero, id)) continue;
      const check = this.canBuy(world, hero, id);
      if (check.ok) return id;
      // if final unaffordable, try its components
      if (item.from) {
        for (const c of item.from) {
          if (hero.items.includes(c)) continue;
          const cc = this.canBuy(world, hero, c);
          if (cc.ok) return c;
        }
      }
    }
    return null;
  },

  _needsForLater(build, hero, compId) {
    return build.some(id => ITEMS[id]?.from?.includes(compId) && !hero.items.includes(id));
  },
};
