// Systems e2e: surrender vote UI, recall bar, buy/sell in fountain, dev panel.
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://127.0.0.1:8077/index.html';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 480 } });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('#screen-menu:not(.hidden)');
await page.click('#btn-play');
await page.waitForSelector('#screen-role:not(.hidden)');
await page.click('.role-card:nth-child(1)');
await page.click('#btn-role-next');
await page.waitForSelector('#screen-hero:not(.hidden)');
await page.click('.hero-card:nth-child(1)');
await page.click('#btn-hero-lock');
await page.waitForSelector('#screen-match:not(.hidden)');
await page.waitForTimeout(2500);

// 1) recall bar appears while channeling
await page.evaluate(() => window.__LA.driver.applyInput({ recall: 1 }));
await page.waitForSelector('#recall-bar:not(.hidden)', { timeout: 3000 });
await page.evaluate(() => window.__LA.driver.applyInput({ move: { x: 1300, y: 5300 } })); // move cancels
await page.waitForFunction(() => document.getElementById('recall-bar').classList.contains('hidden'), { timeout: 3000 });

// 2) surrender vote: fresh match so bot votes can't race us
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('#screen-menu:not(.hidden)');
await page.click('#btn-play');
await page.waitForSelector('#screen-role:not(.hidden)');
await page.click('.role-card:nth-child(1)');
await page.click('#btn-role-next');
await page.waitForSelector('#screen-hero:not(.hidden)');
await page.click('.hero-card:nth-child(1)');
await page.click('#btn-hero-lock');
await page.waitForSelector('#screen-match:not(.hidden)');
await page.waitForTimeout(2000);
await page.evaluate(() => { window.__LA.driver.sim.t = 500; window.__LA.driver.applyInput({ surrenderStart: 1 }); });
await page.waitForSelector('#surrender-modal:not(.hidden)', { timeout: 3000 });
await page.screenshot({ path: 'tests/playwright/shots/30-surrender.png' });
// all bot teammates vote NO immediately → deterministic reject
await page.evaluate(() => {
  const d = window.__LA.driver;
  for (const h of d.sim.heroes.filter(x => x.team === 0 && x.controller === 'bot')) d.sim.surrender.vote(d.sim, h, false);
});
await page.waitForFunction(() => document.getElementById('surrender-modal').classList.contains('hidden'), { timeout: 8000 });
const surState = await page.evaluate(() => ({ active: window.__LA.driver.sim.surrState.active, over: !!window.__LA.driver.sim.matchOver }));
if (surState.over) errors.push('surrender reject unexpectedly ended the match');

// 3) fountain shop buy + sell
await page.evaluate(() => {
  const d = window.__LA.driver;
  const me = d.sim.heroes.find(h => h.controller === 'local');
  me.x = 620; me.y = 5760; me.gold = 3000; // teleport to fountain, grant gold
});
await page.click('#btn-shop');
await page.waitForTimeout(300);
await page.click('.shop-tab[data-tab="attack"]');
await page.waitForTimeout(200);
const before = await page.evaluate(() => window.__LA.driver.sim.heroes.find(h => h.controller === 'local').items.length);
await page.evaluate(() => { [...document.querySelectorAll('.item-card')].find(c => c.textContent.includes('Emberstrike'))?.click(); });
await page.waitForTimeout(300);
const after = await page.evaluate(() => window.__LA.driver.sim.heroes.find(h => h.controller === 'local').items.length);
if (after !== before + 1) errors.push('buy failed: items ' + before + '->' + after);
await page.click('#shop-sell');
await page.waitForTimeout(300);
const afterSell = await page.evaluate(() => window.__LA.driver.sim.heroes.find(h => h.controller === 'local').items.length);
if (afterSell !== before) errors.push('sell failed');
await page.click('#shop-close');

// 4) dev panel present with ?dev=1 (reload)
await page.goto(url + '?dev=1', { waitUntil: 'load' });
await page.waitForTimeout(1500);
// menu again → quick match
await page.click('#btn-play'); await page.click('.role-card:nth-child(1)'); await page.click('#btn-role-next');
await page.waitForSelector('#screen-hero:not(.hidden)');
await page.click('.hero-card:nth-child(1)'); await page.click('#btn-hero-lock');
await page.waitForSelector('#screen-match:not(.hidden)');
const devVisible = await page.evaluate(() => !document.getElementById('dev-panel').classList.contains('hidden'));
if (!devVisible) errors.push('dev panel not visible with ?dev=1');

console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
