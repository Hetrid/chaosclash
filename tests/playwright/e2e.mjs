// E2E smoke: boot → menu → role select → hero select → lock → match runs → no console errors.
// Run: node tests/playwright/e2e.mjs [url]
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:8077/index.html';
const errors = [];

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 480 }, hasTouch: true });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(1500);

// menu
await page.waitForSelector('#screen-menu:not(.hidden)', { timeout: 15000 });
await page.screenshot({ path: 'tests/playwright/shots/01-menu.png' });

// role select
await page.click('#btn-play');
await page.waitForSelector('#screen-role:not(.hidden)');
await page.click('.role-card:nth-child(3)'); // MID
await page.screenshot({ path: 'tests/playwright/shots/02-role.png' });
await page.click('#btn-role-next');

// hero select
await page.waitForSelector('#screen-hero:not(.hidden)');
await page.click('.hero-card:nth-child(1)');
await page.waitForTimeout(200);
await page.screenshot({ path: 'tests/playwright/shots/03-hero.png' });
await page.click('#btn-hero-lock');

// loading → match
await page.waitForSelector('#screen-match:not(.hidden)', { timeout: 10000 });
await page.waitForTimeout(6000); // let the match run: waves spawn, bots act
await page.screenshot({ path: 'tests/playwright/shots/04-match.png' });

// sanity: canvas has pixels, HUD counters exist, shop opens
const canvasPixels = await page.evaluate(() => {
  const cv = document.getElementById('game');
  const g = cv.getContext('2d');
  const d = g.getImageData(0, 0, cv.width, cv.height).data;
  let lit = 0;
  for (let i = 0; i < d.length; i += 40) if (d[i] + d[i + 1] + d[i + 2] > 40) lit++;
  return lit;
});
if (canvasPixels < 100) errors.push('canvas appears black (pixels lit: ' + canvasPixels + ')');

await page.click('#btn-shop');
await page.waitForTimeout(400);
await page.screenshot({ path: 'tests/playwright/shots/05-shop.png' });
await page.click('#shop-close');
await page.click('#btn-scoreboard');
await page.waitForTimeout(300);
await page.screenshot({ path: 'tests/playwright/shots/06-scoreboard.png' });

console.log(JSON.stringify({ ok: errors.length === 0, canvasPixels, errors }, null, 2));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
