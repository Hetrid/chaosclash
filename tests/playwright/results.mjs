// Match-end flow: force the sim into matchOver (the same signal the driver watches),
// verify results screen + scoreboard render, and Play Again returns to role select.
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
await page.waitForTimeout(3000);

// destroy enemy core via the sim's real kill path (dealDamage), not by hand-setting matchOver
await page.evaluate(async () => {
  const { driver } = window.__LA;
  const { dealDamage } = await import('./src/shared/game/Damage.js');
  const core = driver.sim.structures.find(s => s.kind === 'core' && s.team === 1);
  const me = driver.sim.heroes.find(h => h.controller === 'local');
  core.invulnerable = false;
  for (let i = 0; i < 40 && !driver.sim.matchOver; i++) {
    dealDamage(driver.sim, { src: me, tgt: core, amount: 500, dtype: 'true', category: 'skill', kindLabel: 'dev' });
  }
});
await page.waitForSelector('#screen-results:not(.hidden)', { timeout: 15000 });
await page.screenshot({ path: 'tests/playwright/shots/20-results.png' });
const banner = await page.textContent('#results-banner');
if (!/VICTORY|DEFEAT/.test(banner)) errors.push('results banner wrong: ' + banner);
await page.click('#btn-again');
await page.waitForSelector('#screen-role:not(.hidden)');
console.log(JSON.stringify({ ok: errors.length === 0, banner, errors }, null, 2));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
