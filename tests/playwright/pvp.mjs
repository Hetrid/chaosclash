// P4 e2e: two browser clients join the authoritative server and play a match via ws.
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://127.0.0.1:8790/index.html';
const errors = [];
const browser = await chromium.launch();

async function join(page, name, roleCard) {
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForSelector('#screen-menu:not(.hidden)');
  await page.evaluate(n => { window.__LA_NAME = n; window.prompt = () => 'ws://127.0.0.1:8790/ws'; }, name);
  await page.click('#btn-multiplayer');
  await page.waitForSelector('#screen-role:not(.hidden)');
  await page.click('.role-card:nth-child(' + roleCard + ')');
  await page.click('#btn-role-next');
  await page.waitForSelector('#screen-hero:not(.hidden)');
  await page.click('.hero-card:nth-child(1)');
  await page.click('#btn-hero-lock');
}

const pageA = await (await browser.newContext({ viewport: { width: 900, height: 480 } })).newPage();
const pageB = await (await browser.newContext({ viewport: { width: 900, height: 480 } })).newPage();
for (const p of [pageA, pageB]) {
  p.on('pageerror', e => errors.push('pageerror: ' + e.message));
  p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
}
await Promise.all([join(pageA, 'Alice', 1), join(pageB, 'Bob', 3)]);
// both should reach the match screen within 20s (matchmaking pairs them)
await pageA.waitForSelector('#screen-match:not(.hidden)', { timeout: 25000 });
await pageB.waitForSelector('#screen-match:not(.hidden)', { timeout: 25000 });
await pageA.waitForTimeout(4000);
const stateA = await pageA.evaluate(() => ({
  heroId: window.__LA.driver.heroId,
  hasSnap: !!window.__LA.driver.view().cur,
  heroes: window.__LA.driver.view().cur ? window.__LA.driver.view().cur.heroes.length : 0,
}));
const stateB = await pageB.evaluate(() => ({
  heroId: window.__LA.driver.heroId,
  hasSnap: !!window.__LA.driver.view().cur,
}));
if (!stateA.hasSnap || !stateB.hasSnap) errors.push('no snapshots');
if (stateA.heroId === stateB.heroId) errors.push('both clients got the same hero id');
if (stateA.heroes !== 10) errors.push('expected 10 heroes, got ' + stateA.heroes);
// drive client A: inputs must reach the server and move its hero
const x0 = await pageA.evaluate(() => window.__LA.driver.view().cur.heroes.find(h => h.i === window.__LA.driver.heroId).x);
for (let i = 0; i < 12; i++) { await pageA.keyboard.down('KeyD'); await pageA.waitForTimeout(80); await pageA.keyboard.up('KeyD'); }
await pageA.waitForTimeout(700);
const x1 = await pageA.evaluate(() => window.__LA.driver.view().cur.heroes.find(h => h.i === window.__LA.driver.heroId).x);
if (!(x1 > x0 + 40)) errors.push('hero did not move via server (' + x0 + ' -> ' + x1 + ')');
console.log(JSON.stringify({ ok: errors.length === 0, stateA, stateB, moved: [x0, x1], errors }, null, 2));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
