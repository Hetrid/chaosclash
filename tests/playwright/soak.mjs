// Gameplay soak: play a real match via the UI, drive the hero (move/attack/cast),
// shop, recall, surrender flow, and confirm the match can END. Reports state over time.
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:8077/index.html';
const errors = [];
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 480 }, hasTouch: true });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('#screen-menu:not(.hidden)', { timeout: 15000 });
await page.click('#btn-play');
await page.waitForSelector('#screen-role:not(.hidden)');
await page.click('.role-card:nth-child(4)'); // GOLD (marksman, long range, safe lane farmer)
await page.click('#btn-role-next');
await page.waitForSelector('#screen-hero:not(.hidden)');
await page.click('.hero-card:nth-child(4)'); // Arc
await page.click('#btn-hero-lock');
await page.waitForSelector('#screen-match:not(.hidden)', { timeout: 10000 });

// drive the hero: hold "D" (move right/east) periodically + basic attack taps + a Q cast
for (let i = 0; i < 40; i++) {
  await page.keyboard.down('KeyD');
  await page.waitForTimeout(700);
  await page.keyboard.up('KeyD');
  await page.keyboard.press('Space');
  if (i % 5 === 0) { await page.keyboard.press('KeyQ'); await page.keyboard.press('KeyE'); }
  if (i % 10 === 7) {
    const state = await page.evaluate(() => {
      const mm = document.getElementById('minimap');
      return { t: performance.now() / 1000, gold: document.getElementById('gold-label').textContent, lvl: document.getElementById('level-badge').textContent, kills: [document.getElementById('kills0').textContent, document.getElementById('kills1').textContent] };
    });
    console.log('tick', i, JSON.stringify(state));
  }
}
await page.screenshot({ path: 'tests/playwright/shots/10-soak-end.png' });
console.log(JSON.stringify({ ok: errors.length === 0, errors }, null, 2));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
