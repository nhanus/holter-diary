import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';


async function settings(page: Page, section: string) {
  if (!await page.locator('#dialog').isVisible()) await page.locator('#settings').click();
  const panel = page.locator('#' + section);
  if (!await panel.evaluate((el: HTMLDetailsElement) => el.open)) await panel.locator(':scope > summary').click();
}
async function language(page: Page, value: string) {
  await settings(page, 'language-settings'); await page.locator('#language').selectOption(value); await page.locator('#close-dialog').click();
}
async function setupIdentity(page: Page) {
  if (!await page.locator('#setup-identity').evaluate((el: HTMLDetailsElement) => el.open)) await page.locator('#setup-identity > summary').click();
}
async function exportRows(page: Page) {
  await page.locator('#export').click();
  const download = page.waitForEvent('download');
  await page.locator('#download-pdf').click();
  const task = getDocument({ data: new Uint8Array(await readFile((await (await download).path())!)), standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json'))) });
  try {
    const document = await task.promise;
    const text = [];
    for (let number = 1; number <= document.numPages; number++) {
      const content = await (await document.getPage(number)).getTextContent();
      text.push(...content.items.flatMap(item => 'str' in item ? [item] : []));
    }
    return text;
  } finally { await task.destroy(); await page.locator('#close-dialog').click(); }
}
function rowStamp(text: Awaited<ReturnType<typeof exportRows>>, note: string, clock = 'EKG-Gerätezeit') {
  const item = text.find(item => item.str === note)!;
  const heading = text.find(item => item.str === clock)!;
  expect(item && heading).toBeTruthy();
  return text.filter(candidate => candidate.str.trim() && candidate.transform[4] === heading.transform[4] &&
    candidate.transform[5] === item.transform[5]).map(item => item.str);
}
function rowTime(text: Awaited<ReturnType<typeof exportRows>>, note: string, clock = 'EKG-Gerätezeit') {
  return rowStamp(text, note, clock).map(stamp => stamp.slice(-8));
}
async function rawEntries(page: Page) {
  return page.evaluate(() => new Promise<unknown[]>((resolve, reject) => {
    const request = indexedDB.open('holter-diary');
    request.onsuccess = () => {
      const db = request.result;
      const get = db.transaction('entries').objectStore('entries').getAll();
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => reject(get.error);
    };
  }));
}

test('export warns about an unsaved entry and returns to the intact draft', async ({ page }) => {
  await page.goto('');
  await page.locator('#start-diary').click();
  await expect(page.locator('#feedback')).toHaveText('Tagebuch begonnen');

  const note = page.locator('#note');
  await note.fill('Spaziergang');
  await page.locator('#save-entry').click();
  await expect(page.locator('#feedback')).toHaveText('Eintrag auf diesem Gerät gespeichert.');
  await note.fill('Letzte Notiz zur Messung');
  const timestamp = await page.locator('.time-stamp').textContent();
  const reportWithDraft = (await exportRows(page)).map(item => item.str);
  expect(reportWithDraft).toContain('Spaziergang');
  expect(reportWithDraft).not.toContain('Letzte Notiz zur Messung');

  await page.locator('#export').click();
  await expect(page.locator('#dialog')).toHaveAccessibleDescription(/ungespeicherten Eintrag/);
  await expect(page.locator('#download-pdf')).toBeEnabled();
  await page.getByRole('button', { name: 'Zur Notiz zurück' }).click();
  await expect(note).toBeFocused();
  await expect(note).toHaveValue('Letzte Notiz zur Messung');
  await expect(page.locator('.time-stamp')).toHaveText(timestamp!);
  await expect(page.locator('.entry')).toHaveCount(1);

  await page.locator('#save-entry').click();
  await expect(page.locator('.entry')).toHaveCount(2);
  await page.locator('#export').click();
  await expect(page.locator('#export-draft-warning')).toHaveCount(0);
  await page.locator('#close-dialog').click();
  const reportAfterSave = (await exportRows(page)).map(item => item.str);
  expect(reportAfterSave).toContain('Letzte Notiz zur Messung');
});

test('later positive and negative calibration shifts actual PDF rows, including midnight, without rewriting entries', async ({ page }) => {
  await page.clock.install();
  await page.clock.setFixedTime(new Date('2030-12-31T22:58:00Z'));
  await page.goto(''); await page.locator('#start-diary').click();
  await page.locator('#note').fill('Automatic activity'); await page.locator('#save-entry').click();
  await page.locator('#mark-symptom').click();
  await page.locator('.entry-button').filter({ hasText: 'Details später' }).click();
  await page.locator('#note').fill('Automatic symptom'); await page.locator('#save-entry').click();
  const original = await rawEntries(page);
  const initialReport = await exportRows(page);
  expect(rowTime(initialReport, 'Automatic activity', 'Uhrzeit (Referenz)')).toEqual(['23:58:00']);
  expect(initialReport.some(item => item.str === 'EKG-Gerätezeit')).toBe(false);
  expect(initialReport.some(item => item.str === 'Kein Zeitvergleich mit dem EKG-Gerät eingetragen.')).toBe(true);
  for (const [reading, expected, offset] of [
    ['2031-01-01T00:01:00', '00:01:00', '+180 s'],
    ['2030-12-31T23:54:00', '23:54:00', '-240 s'],
  ]) {
    await page.locator('#settings').click();
    await settings(page, 'clock-settings');
    await page.locator('#capture-time').click();
    await page.locator('#monitor-reading').fill(reading.replace(/:00$/, '')); // Chromium normalizes zero seconds in datetime-local values.
    await page.locator('#save-clock').click(); await page.locator('#close-dialog').click();
    await expect(page.locator('.entry-time strong')).toHaveText([expected, expected]);
    const report = await exportRows(page);
    expect(rowTime(report, 'Automatic activity')).toEqual([expected]);
    expect(rowTime(report, 'Automatic symptom')).toEqual([expected]);
    const expectedDate = `${reading.slice(8, 10)}.${reading.slice(5, 7)}.${reading.slice(0, 4)}`;
    for (const note of ['Automatic activity', 'Automatic symptom']) {
      expect(rowStamp(report, note)).toEqual([`${expectedDate} ${expected}`]);
      expect(rowStamp(report, note, 'Uhrzeit (Referenz)')).toEqual(['31.12.2030 23:58:00']);
    }
    expect(report.some(item => item.str.includes(offset))).toBe(true);
    expect(await rawEntries(page)).toEqual(original);
  }
  await page.locator('#settings').click();
  await settings(page, 'clock-settings');
  await page.locator('#reset-clock').click();
  await page.locator('#save-clock').click(); await page.locator('#close-dialog').click();
  const resetReport = await exportRows(page);
  expect(resetReport.some(item => item.str === 'EKG-Gerätezeit')).toBe(false);
  expect(rowTime(resetReport, 'Automatic activity', 'Uhrzeit (Referenz)')).toEqual(['23:58:00']);
  expect(await rawEntries(page)).toEqual(original);
});

test('setup calibration converts automatic timestamps once; manual input already specifies monitor time', async ({ page }) => {
  await page.clock.install();
  await page.clock.setFixedTime(new Date('2030-12-31T12:30:00Z'));
  await page.goto('');
  await page.getByText('EKG-Uhrzeit abgleichen', { exact: true }).click();
  await page.locator('#capture-time').click();
  await page.locator('#monitor-reading').fill('2030-12-31T13:28');
  await page.locator('#start-diary').click();
  await page.locator('#note').fill('Automatic entry'); await page.locator('#save-entry').click();
  await page.locator('#note').fill('Manual monitor time');
  await page.getByText('Zeit ändern', { exact: true }).click();
  await page.locator('#entry-time').fill('2030-12-31T13:30');
  await page.locator('#save-entry').click();
  const report = await exportRows(page);
  expect(rowTime(report, 'Automatic entry')).toEqual(['13:28:00']);
  expect(rowTime(report, 'Automatic entry', 'Uhrzeit (Referenz)')).toEqual(['13:30:00']);
  expect(rowTime(report, 'Manual monitor time')).toEqual(['13:30:00']);
  expect(rowTime(report, 'Manual monitor time', 'Uhrzeit (Referenz)')).toEqual(['13:32:00']);
  expect(report.some(item => item.str.includes('-120 s'))).toBe(true);
});


test('an explicitly equal recorder clock keeps one timestamp column', async ({ page }) => {
  await page.clock.install();
  await page.clock.setFixedTime(new Date('2030-12-31T12:30:00Z'));
  await page.goto('');
  await page.getByText('EKG-Uhrzeit abgleichen', { exact: true }).click();
  await page.locator('#capture-time').click();
  await page.locator('#monitor-reading').fill('2030-12-31T13:30');
  await page.locator('#start-diary').click();
  await page.locator('#note').fill('Equal clock example');
  await page.locator('#save-entry').click();
  const report = await exportRows(page);
  expect(rowTime(report, 'Equal clock example', 'Uhrzeit (Referenz)')).toEqual(['13:30:00']);
  expect(report.some(item => item.str === 'EKG-Gerätezeit')).toBe(false);
  expect(report.some(item => item.str.includes('Eingetragener Zeitvergleich: Abweichung 0 s'))).toBe(true);
});


test('patient details survive reload, update existing reports, and can be omitted or reset', async ({ page }) => {
  await page.goto('');
  await setupIdentity(page);
  await page.locator('#setup-name').fill('Alexandra Beispiel');
  await page.locator('#setup-birth-date').fill('1980-02-29');
  await language(page, 'en');
  await expect(page.getByLabel('Date of birth (optional)')).toHaveValue('1980-02-29');
  await page.locator('#start-diary').click();
  await page.locator('#note').fill('Synthetic observation'); await page.locator('#save-entry').click();
  await expect(page.locator('.entry-note')).toHaveText('Synthetic observation');
  await page.reload();
  const report = await exportRows(page);
  expect(report.map(item => item.str.replace(/\s+/g, ' '))).toContain('Name: Alexandra Beispiel | Date of birth: 1980-02-29');
  await settings(page, 'identity-settings');
  await expect(page.locator('#settings-birth-date')).toHaveValue('1980-02-29');
  await page.locator('#settings-name').fill('Alexandra Muster');
  await page.locator('#settings-birth-date').fill('1981-03-01');
  await page.locator('#save-identity').click(); await page.locator('#close-dialog').click();
  const updated = await exportRows(page);
  expect(updated.map(item => item.str.replace(/\s+/g, ' '))).toContain('Name: Alexandra Muster | Date of birth: 1981-03-01');
  await settings(page, 'identity-settings');
  await page.locator('#settings-name').fill(''); await page.locator('#settings-birth-date').fill('');
  await page.locator('#save-identity').click(); await page.locator('#close-dialog').click();
  const anonymous = await exportRows(page);
  expect(anonymous.some(item => /Name:|Date of birth:|Not provided/.test(item.str))).toBe(false);
  await page.locator('#settings').click();
  await page.locator('#reset-diary').click(); await page.locator('#confirm-reset').click();
  await expect(page.locator('#setup-name')).toHaveValue('');
  await expect(page.locator('#setup-birth-date')).toHaveValue('');
});
