// Desktop UI: no joystick (pointer:fine), hints visible, ability icons + kbds present.
// Mobile UI (touch): joystick visible, hints hidden.
import { chromium } from 'playwright';
const url = process.argv[2] || 'http://127.0.0.1:8077/index.html';
const errors = [];
const browser = await chromium.launch();
async function boot(contextOpts) {
  const ctx = await browser.newContext(contextOpts);
  const page = await ctx.newPage();
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
  await page.waitForTimeout(1200);
  return page;
}
const desktop = await boot({ viewport: { width: 1280, height: 720 } });
const d = await desktop.evaluate(() => ({
  bodyClass: document.body.classList.contains('desktop'),
  joystickDisplay: getComputedStyle(document.getElementById('joy-base')).display,
  hints: !document.getElementById('desktop-hints').classList.contains('hidden'),
  icons: [...document.querySelectorAll('.skill-btn img.sk-icon')].length,
  kbds: document.querySelectorAll('.skill-btn i.kbd').length,
}));
if (!d.bodyClass) errors.push('desktop class missing');
if (d.joystickDisplay !== 'none' && d.joystickDisplay === '') errors.push('joystick visible on desktop: ' + d.joystickDisplay);
if (!d.hints) errors.push('desktop hints missing');
if (d.icons < 4) errors.push('ability icons missing: ' + d.icons);
if (d.kbds < 4) errors.push('keyboard labels missing: ' + d.kbds);
await desktop.screenshot({ path: 'tests/playwright/shots/40-desktop.png' });
await desktop.close();

const mobile = await boot({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true });
const m = await mobile.evaluate(() => ({
  bodyClass: document.body.classList.contains('desktop'),
  joystickDisplay: getComputedStyle(document.getElementById('joy-base')).display,
  hintsHidden: document.getElementById('desktop-hints').classList.contains('hidden'),
}));
if (m.bodyClass) errors.push('desktop class on mobile');
if (m.joystickDisplay === 'none') errors.push('joystick hidden on mobile');
if (!m.hintsHidden) errors.push('desktop hints shown on mobile');
await mobile.screenshot({ path: 'tests/playwright/shots/41-mobile.png' });
await mobile.close();
console.log(JSON.stringify({ ok: errors.length === 0, d, m, errors }, null, 2));
await browser.close();
process.exit(errors.length === 0 ? 0 : 1);
