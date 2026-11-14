import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function records(page: Page, store: string) {
  return page.evaluate(store => new Promise<Array<Record<string, any>>>((resolve, reject) => {
    const open = indexedDB.open('holter-diary'); open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, read = db.transaction(store).objectStore(store).getAll();
      read.onsuccess = () => { db.close(); resolve(read.result); }; read.onerror = () => reject(read.error);
    };
  }), store);
}
async function clockSettings(page: Page) {
  if (!await page.locator('#dialog').isVisible()) await page.locator('#settings').click();
  const panel = page.locator('#clock-settings');
  if (!await panel.evaluate((el: HTMLDetailsElement) => el.open)) await panel.locator(':scope > summary').click();
}

for (const lang of ['de', 'en']) test(`readable clock comparisons preserve precision and report access (${lang})`, async ({ page }) => {
  await page.clock.install({ time: new Date('2028-01-10T12:00:00.456Z') });
  await page.clock.setFixedTime(new Date('2028-01-10T12:00:00.456Z'));
  await page.goto(`?lang=${lang}`); await page.locator('#start-diary').click();
  await expect(page.locator('#export')).toBeDisabled();
  await page.locator('#note').fill('Synthetic clock display record'); await page.locator('#save-entry').click();
  const original = await records(page, 'entries');
  for (const width of [320, 393]) for (const large of [false, true]) {
    await page.setViewportSize({ width, height: 852 });
    await page.evaluate(large => document.documentElement.style.fontSize = large ? '24px' : '16px', large);
    await page.evaluate(() => scrollTo(0, 0));
    const report = page.getByRole('button', { name: lang === 'de' ? 'Protokoll exportieren' : 'Export report' });
    await expect(report).toBeInViewport();
    const box = await report.boundingBox(); expect(box!.height).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(report).toContainText(lang === 'de' ? 'Protokoll' : 'Report');
    await report.click(); await expect(page.locator('#download-pdf')).toBeVisible(); await page.locator('#close-dialog').click();
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await page.evaluate(() => document.documentElement.style.fontSize = '16px');
  await clockSettings(page);
  await page.locator('#capture-time').click(); await page.locator('#monitor-reading').fill('2028-01-10T14:05');
  const positive = lang === 'de' ? '1 Std. 5 Min. voraus' : '1 h 5 min ahead';
  await expect(page.locator('#clock-impact')).toContainText(positive);
  await page.locator('#save-clock').click();
  await expect(page.locator('#clock-settings > summary')).toContainText(positive);
  expect((await records(page, 'sessions'))[0].calibration.offsetMs).toBe(3899544);
  expect(await records(page, 'entries')).toEqual(original);
  await page.reload(); await clockSettings(page);
  await expect(page.locator('#clock-settings > summary')).toContainText(positive);
  await expect(page.locator('#clock-settings')).not.toContainText('3899.544');
  for (const [reading, offset, de, en] of [
    ['2028-01-10T12:15', -2700456, '45 Min. zurück', '45 min behind'],
    ['2028-01-10T13:00', -456, 'weniger als 1 Sek. zurück', 'less than 1 s behind'],
  ] as const) {
    await page.locator('#capture-time').click(); await page.locator('#monitor-reading').fill(reading);
    await expect(page.locator('#clock-impact')).toContainText(lang === 'de' ? de : en);
    await page.locator('#save-clock').click();
    await expect(page.locator('#clock-settings > summary')).toContainText(lang === 'de' ? de : en);
    expect((await records(page, 'sessions'))[0].calibration.offsetMs).toBe(offset);
    expect(await records(page, 'entries')).toEqual(original);
  }
  await page.locator('#reset-clock').click();
  await expect(page.locator('#clock-impact')).toContainText(lang === 'de' ? 'keine Abweichung' : 'no difference');
  await page.locator('#save-clock').click();
  await expect(page.locator('#clock-settings > summary')).toContainText(lang === 'de' ? 'Handyzeit · keine Korrektur' : 'Phone time · no correction');
  expect((await records(page, 'sessions'))[0].calibration.offsetMs).toBe(0);
  expect(await records(page, 'entries')).toEqual(original);
});
