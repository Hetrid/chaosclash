// Legend Arena — dump all hero/item/monster tunables to docs/balance.json (P7 deliverable seed).
import { writeFileSync } from 'node:fs';
import { HERO_LIST, HEROES } from '../src/shared/heroes/HeroRegistry.js';
import { ITEMS } from '../src/shared/systems/Items.js';
import { CONFIG } from '../src/shared/core/config.js';
import { MONSTER_DEFS } from '../src/shared/entities/Monster.js';
import { TURRETS, CAMPS } from '../src/shared/map/MapData.js';

const strip = (o) => JSON.parse(JSON.stringify(o, (k, v) => typeof v === 'function' ? '[fn]' : v));
const out = {
  generatedAt: new Date().toISOString(),
  config: strip(CONFIG),
  heroes: Object.fromEntries(HERO_LIST.map(id => {
    const d = HEROES[id];
    return [id, strip({ n: d.n, title: d.title, archetype: d.archetype, resource: d.resource, roles: d.roles, recommendedLane: d.recommendedLane, abilities: d.abilities, build: d.build, ai: d.ai })];
  })),
  items: strip(ITEMS),
  monsters: strip(MONSTER_DEFS),
  turrets: TURRETS,
  camps: CAMPS,
};
writeFileSync(new URL('../docs/balance.json', import.meta.url), JSON.stringify(out, null, 2));
console.log('balance.json written:', Object.keys(out.heroes).length, 'heroes,', Object.keys(ITEMS).length, 'items');
