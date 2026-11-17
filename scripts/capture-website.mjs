// Capture the selected app and its PDF export with fictional entries.
// First build the app, then run this script from the repository root.
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const version = JSON.parse(await readFile('website/app-release.json', 'utf8')).version;
const appDir = process.argv[2] ?? 'dist';
const actual = JSON.parse(await readFile(`${appDir}/app/version.json`, 'utf8')).version;
if (actual !== version) throw new Error('Capture the selected app release.');
const origin = 'http://127.0.0.1:4178';
const rendererURL = origin + '/report-preview/';
const pdfjsDir = new URL('./', import.meta.resolve('pdfjs-dist/package.json'));
const server = spawn(process.execPath, ['scripts/serve-static.mjs', '--dir', appDir, '--port', '4178'], { stdio: ['ignore', 'pipe', 'pipe'] });

async function captureReport(page, lang) {
  await page.locator('#export').click();
  await page.locator('#report-language').selectOption(lang);
  const download = page.waitForEvent('download');
  await page.locator('#download-pdf').click();
  const bytes = await readFile(await (await download).path());

  const renderer = await page.context().newPage();
  await renderer.route(rendererURL + '**', route => {
    const asset = route.request().url().slice(rendererURL.length);
    if (!asset) return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Sample report</title>' });
    if (asset === 'pdf.mjs' || asset === 'pdf.worker.mjs') {
      return route.fulfill({ contentType: 'text/javascript', path: fileURLToPath(new URL('build/' + asset, pdfjsDir)) });
    }
    if (/^standard_fonts\/[\w.-]+$/.test(asset)) {
      return route.fulfill({ path: fileURLToPath(new URL(asset, pdfjsDir)) });
    }
    return route.abort();
  });
  await renderer.goto(rendererURL);
  await renderer.evaluate(async data => {
    const pdfjs = await import('./pdf.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = './pdf.worker.mjs';
    const task = pdfjs.getDocument({ data: new Uint8Array(data), standardFontDataUrl: './standard_fonts/' });
    try {
      const pdf = await task.promise;
      if (pdf.numPages !== 1) throw new Error('The sample report must fit on a single page.');
      const page = await pdf.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      document.body.append(canvas);
      await page.render({ canvas, viewport }).promise;
    } finally {
      await task.destroy();
    }
  }, [...bytes]);
  await renderer.locator('canvas').screenshot({ path: `website/screenshots/report-${lang}-${version}.png`, scale: 'css' });
  await renderer.close();
}

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
    await page.clock.setFixedTime(new Date('2026-11-14T08:00:00Z'));
    await page.goto(`${origin}/holter-diary/app/?lang=${lang}`);
    await page.locator('#start-diary').click();
    await page.clock.setFixedTime(new Date('2026-11-14T09:40:00Z'));
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
    await page.clock.setFixedTime(new Date('2026-11-14T10:10:00Z'));
    await captureReport(page, lang);
    await context.close();
  }
} finally {
  await browser?.close();
  server.kill();
}
