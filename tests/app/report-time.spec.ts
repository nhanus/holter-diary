import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

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
    await page.getByText('EKG-Uhrzeit abgleichen', { exact: true }).click();
    await page.locator('#capture-time').click();
    await page.locator('#monitor-reading').fill(reading);
    await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
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
  await page.locator('#reset-clock').click();
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
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
  await page.locator('#monitor-reading').fill('2030-12-31T13:28:00');
  await page.locator('#start-diary').click();
  await page.locator('#note').fill('Automatic entry'); await page.locator('#save-entry').click();
  await page.locator('#note').fill('Manual monitor time');
  await page.getByText('Zeit ändern', { exact: true }).click();
  await page.locator('#entry-time').fill('2030-12-31T13:30:00');
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
  await page.locator('#monitor-reading').fill('2030-12-31T13:30:00');
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
  await page.locator('#setup-name').fill('Alexandra Beispiel');
  await page.locator('#setup-birth-date').fill('1980-02-29');
  await page.locator('#language').selectOption('en');
  await expect(page.getByLabel('Date of birth (optional)')).toHaveValue('1980-02-29');
  await page.locator('#start-diary').click();
  await page.locator('#note').fill('Synthetic observation'); await page.locator('#save-entry').click();
  await expect(page.locator('.entry-note')).toHaveText('Synthetic observation');
  await page.reload();
  const report = await exportRows(page);
  expect(report.map(item => item.str.replace(/\s+/g, ' '))).toContain('Name: Alexandra Beispiel | Date of birth: 1980-02-29');
  await page.locator('#settings').click();
  await expect(page.locator('#settings-birth-date')).toHaveValue('1980-02-29');
  await page.locator('#settings-name').fill('Alexandra Muster');
  await page.locator('#settings-birth-date').fill('1981-03-01');
  await page.getByRole('button', { name: 'Save settings' }).click();
  const updated = await exportRows(page);
  expect(updated.map(item => item.str.replace(/\s+/g, ' '))).toContain('Name: Alexandra Muster | Date of birth: 1981-03-01');
  await page.locator('#settings').click();
  await page.locator('#settings-name').fill(''); await page.locator('#settings-birth-date').fill('');
  await page.getByRole('button', { name: 'Save settings' }).click();
  const anonymous = await exportRows(page);
  expect(anonymous.some(item => /Name:|Date of birth:|Not provided/.test(item.str))).toBe(false);
  await page.locator('#settings').click();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#reset-diary').click();
  await expect(page.locator('#setup-name')).toHaveValue('');
  await expect(page.locator('#setup-birth-date')).toHaveValue('');
});
