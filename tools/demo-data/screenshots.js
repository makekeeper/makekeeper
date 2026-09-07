/**
 * Screenshots of a running instance, for the landing page and release notes.
 *
 * Authenticates by planting the session in `localStorage` (the same keys the app
 * uses), so no login form is driven: pass `DEMO_TOKEN`, and `DEMO_SESSION_KEY`
 * too if the shots must show anything that depends on a decrypted secret — the
 * assistant panel shows "connected" only when the provider key can be unwrapped.
 *
 * Whose account the token belongs to decides what lands in the picture. A token
 * for an account holding ONLY the demo dataset is the safe choice for anything
 * public.
 *
 *   DEMO_TOKEN=… DEMO_SESSION_KEY=… node tools/demo-data/screenshots.js ./shots
 *
 * Environment: BASE_URL (default http://localhost:8080), CHROMIUM (path to a
 * browser binary — needed when playwright-core's bundled revision is not the one
 * installed in the cache).
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');

const BASE = process.env.BASE_URL ?? 'http://localhost:8080';
const OUT = process.argv[2] ?? './shots';
const TOKEN = process.env.DEMO_TOKEN;
const SESSION_KEY = process.env.DEMO_SESSION_KEY ?? '';

// Sections worth showing, each opened directly in the state that reads best —
// a category with properties, a storage cell with parts in it.
const PAGES = [
  ['dashboard', '/'],
  ['projects', '/projects'],
  ['project-detail', '/projects/demo_pr_lamp'],
  ['inventory', '/inventory'],
  ['categories', '/inventory/categories?id=demo_cat_res'],
  ['storages', '/storages?storageId=demo_st_shelf&row=1&col=0'],
  ['logistics', '/logistics'],
  ['stats', '/stats'],
];

(async () => {
  if (!TOKEN) {
    console.error('DEMO_TOKEN is required (POST /api/auth/login returns one).');
    process.exit(1);
  }
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}),
    args: ['--no-sandbox', '--disable-gpu'],
  });
  for (const theme of ['dark', 'light']) {
    const ctx = await browser.newContext({
      viewport: { width: 1728, height: 1000 },
      deviceScaleFactor: 2,
      locale: 'en-US',
    });
    await ctx.addInitScript(
      ({ token, sessionKey, theme }) => {
        localStorage.setItem('auth.token', token);
        if (sessionKey) localStorage.setItem('auth.sessionKey', sessionKey);
        localStorage.setItem('theme', theme);
        localStorage.setItem('uxMode', 'advanced');
        localStorage.setItem('sidebar', 'open');
      },
      { token: TOKEN, sessionKey: SESSION_KEY, theme },
    );
    const page = await ctx.newPage();
    for (const [name, url] of PAGES) {
      await page.goto(BASE + url, { waitUntil: 'domcontentloaded' });
      await page
        .waitForSelector('h1', { timeout: 15000 })
        .catch(() => console.warn(`  ${name}: no heading appeared`));
      await page.waitForTimeout(1200);
      // The first run drops an info toast about simple mode; it is a hint to a
      // new user, not part of the interface being photographed.
      await page.evaluate(() => {
        document
          .querySelectorAll(
            '[data-toast], .toast, [role="status"], [role="alert"]',
          )
          .forEach((n) => n.remove());
      });
      // Let photographs, charts and the entry animations settle.
      await page.waitForTimeout(2500);
      fs.mkdirSync(OUT, { recursive: true });
      const file = path.join(OUT, `${theme}-${name}.png`);
      await page.screenshot({ path: file });
      console.log(`${file}  ${(fs.statSync(file).size / 1024).toFixed(0)} kB`);
    }
    await ctx.close();
  }
  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
