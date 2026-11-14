// Capture the selected app with fictional entries; never use a personal profile.
// First build the app, then run this script from the repository root.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
const version = JSON.parse(await readFile('website/app-release.json', 'utf8')).version;
const appDir = process.argv[2] ?? 'dist';
const actual = JSON.parse(await readFile(`${appDir}/app/version.json`, 'utf8')).version;
if (actual !== version) throw new Error('Capture the selected app release.');
const server = spawn(process.execPath, ['scripts/serve-static.mjs', '--dir', appDir, '--port', '4178'], { stdio: ['ignore', 'pipe', 'pipe'] });
let browser;
try {
  await Promise.race([
    once(server.stdout, 'data'),
    once(server, 'exit').then(() => { throw new Error('Screenshot server could not start; check port 4178.'); }),
    once(server, 'error').then(([error]) => { throw error; }),
  ]);
  browser = await chromium.launch();
  await mkdir('website/screenshots', { recursive: true });
  for (const lang of ['de', 'en']) {
    const context = await browser.newContext({ viewport: { width: 393, height: 1000 }, deviceScaleFactor: 2, locale: lang === 'de' ? 'de-DE' : 'en-GB', timezoneId: 'Europe/Berlin' });
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-11-14T09:40:00Z'));
    await page.goto(`http://127.0.0.1:4178/holter-diary/app/?lang=${lang}`);
    await page.locator('#start-diary').click();
    const notes = lang === 'de' ? ['Spaziergang, etwa 20 Minuten', 'Treppe gestiegen, kurz Herzstolpern'] : ['A walk, about 20 minutes', 'Climbed stairs, briefly noticed palpitations'];
    for (const [index, time] of ['09:10', '10:24'].entries()) {
      await page.locator('#note').fill(notes[index]);
      if (index === 1) await page.locator('#entry-kind').check();
      if (!await page.locator('#entry-time-details').evaluate(el => el.open)) await page.locator('#entry-time-details > summary').click();
      await page.locator('#entry-time').fill(`2026-11-14T${time}`);
      await page.locator('#save-entry').click();
      await expect(page.locator('.entry')).toHaveCount(index + 1);
    }
    await page.reload();
    await expect(page.locator('#offline-badge')).toHaveText(lang === 'de' ? 'Für Offline-Nutzung bereit' : 'Ready to use offline');
    await expect(page.locator('.entry')).toHaveCount(2);
    await expect(page.locator('#note')).toHaveValue('');
    await page.evaluate(() => { document.activeElement?.blur(); scrollTo(0, 0); });
    await page.screenshot({ path: `website/screenshots/diary-${lang}-${version}.png` });
    await context.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
