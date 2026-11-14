import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

async function start(page: Page) { await page.goto(''); await page.locator('#start-diary').click(); }
async function section(page: Page, id: string) {
  if (!await page.locator('#dialog').isVisible()) await page.locator('#settings').click();
  const panel = page.locator('#' + id);
  if (!await panel.evaluate((el: HTMLDetailsElement) => el.open)) await panel.locator(':scope > summary').click();
}
async function abortWrite(page: Page, name: string) {
  await page.evaluate(name => {
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      const request = put.apply(this, args);
      if (this.name === name) { IDBObjectStore.prototype.put = put; request.addEventListener('success', () => this.transaction.abort()); }
      return request;
    };
  }, name);
}
async function rows(page: Page, name = 'entries') {
  return page.evaluate(name => new Promise<Array<Record<string, any>>>((resolve, reject) => {
    const open = indexedDB.open('holter-diary'); open.onerror = () => reject(open.error);
    open.onsuccess = () => { const db = open.result; const request = db.transaction(name).objectStore(name).getAll(); request.onsuccess = () => { db.close(); resolve(request.result); }; request.onerror = () => reject(request.error); };
  }), name);
}
async function timeField(page: Page, value: string) {
  const details = page.locator('#entry-time-details');
  if (!await details.evaluate((el: HTMLDetailsElement) => el.open)) await details.locator('summary').click();
  await page.locator('#entry-time').fill(value);
}

test('new-note draft survives editor failure, save, cancel and deletion with its manual timestamp', async ({ page }) => {
  await start(page); await page.locator('#note').fill('Existing record'); await page.locator('#save-entry').click();
  await page.locator('#note').fill('New draft remains'); await timeField(page, '2028-02-03T10:17');
  await page.locator('.entry-button').click(); await page.locator('#note').fill('Edited record');
  await abortWrite(page, 'entries'); await page.locator('#save-entry').click();
  await expect(page.locator('#dialog-error')).toContainText('Speichern fehlgeschlagen');
  await expect(page.locator('#note')).toHaveValue('Edited record');
  await page.locator('#save-entry').click(); await expect(page.locator('#note')).toHaveValue('New draft remains');
  await expect(page.locator('#entry-time')).toHaveValue('2028-02-03T10:17');
  await page.locator('.entry-button').click(); await page.locator('#note').fill('Do not keep');
  page.once('dialog', d => d.dismiss()); await page.locator('#close-dialog').click();
  await expect(page.locator('#note')).toHaveValue('Do not keep');
  page.once('dialog', d => d.accept()); await page.locator('#close-dialog').click();
  await expect(page.locator('.entry-button')).toBeFocused();
  await expect(page.locator('#note')).toHaveValue('New draft remains');
  await page.locator('.entry-button').click(); page.once('dialog', d => d.accept()); await page.locator('#delete-entry').click();
  await expect(page.locator('#note')).toHaveValue('New draft remains');
  await expect(page.locator('#note')).toBeFocused();
  await page.locator('#save-entry').click(); const saved = await rows(page);
  expect(saved).toHaveLength(1); expect(saved[0].note).toBe('New draft remains'); expect(saved[0].eventAtMs).toBe(Date.parse('2028-02-03T09:17:00Z'));
});

test('independent settings saves retain the other section and failed writes remain retryable', async ({ page }) => {
  await page.clock.install({ time: new Date('2028-01-10T12:00:00Z') }); await page.clock.setFixedTime(new Date('2028-01-10T12:00:00Z')); await start(page);
  await section(page, 'identity-settings'); await page.locator('#settings-name').fill('Synthetic person');
  await section(page, 'clock-settings'); await page.locator('#capture-time').click(); await page.locator('#monitor-reading').fill('2028-01-10T13:03');
  await expect(page.locator('#clock-impact')).toContainText('+180 s');
  await abortWrite(page, 'sessions'); await page.locator('#save-identity').click();
  await expect(page.locator('#dialog-error')).toContainText('Speichern fehlgeschlagen');
  expect((await rows(page, 'sessions'))[0].revision).toBe(1);
  await expect(page.locator('#settings-name')).toHaveValue('Synthetic person'); await expect(page.locator('#monitor-reading')).toHaveValue('2028-01-10T13:03');
  await page.locator('#save-identity').click(); expect((await rows(page, 'sessions'))[0].calibration.offsetMs).toBe(0);
  await expect(page.locator('#monitor-reading')).toHaveValue('2028-01-10T13:03');
  page.once('dialog', d => d.dismiss()); await page.locator('#close-dialog').click(); await expect(page.locator('#dialog')).toBeVisible();
  await page.locator('#save-clock').click(); expect((await rows(page, 'sessions'))[0].calibration.offsetMs).toBe(180000);
  await expect(page.locator('#clock-settings-feedback')).toBeInViewport();
  expect(await page.locator('#dialog').evaluate(el => el.scrollTop)).toBeGreaterThan(100);
  await page.locator('#settings-name').fill('Another synthetic person');
  await page.locator('#capture-time').click(); await page.locator('#monitor-reading').fill('2028-01-10T12:58');
  await page.locator('#save-clock').click(); await expect(page.locator('#settings-name')).toHaveValue('Another synthetic person');
  expect((await rows(page, 'sessions'))[0].name).toBe('Synthetic person');
  await page.locator('#save-identity').click(); await page.locator('#close-dialog').click();
  const session = (await rows(page, 'sessions'))[0]; expect(session.name).toBe('Another synthetic person'); expect(session.calibration.offsetMs).toBe(-120000);
});

test('stale settings writes fail without overwriting either section and offer accessible recovery', async ({ page, context }) => {
  await start(page); const other = await context.newPage(); await other.goto('');
  await section(page, 'identity-settings'); await page.locator('#settings-name').fill('Committed name'); await page.locator('#save-identity').click();
  await section(other, 'identity-settings'); await other.locator('#settings-name').fill('Stale name');
  await section(other, 'clock-settings'); await other.locator('#capture-time').click();
  const reading = await other.locator('#monitor-reading').inputValue();
  await other.locator('#save-identity').click(); await expect(other.locator('#dialog-error')).toContainText('anderen Fenster');
  await expect(other.locator('#settings-name')).toHaveValue('Stale name'); await expect(other.locator('#monitor-reading')).toHaveValue(reading);
  await other.locator('#save-clock').click(); await expect(other.locator('#dialog-error')).toContainText('anderen Fenster');
  expect((await rows(page, 'sessions'))[0].name).toBe('Committed name');
  other.once('dialog', d => d.dismiss()); await other.locator('#reload-data').click(); await expect(other.locator('#settings-name')).toHaveValue('Stale name');
  other.once('dialog', d => d.accept()); await other.locator('#reload-data').click(); await expect(other.locator('#dialog')).toHaveCount(0);
  await section(other, 'identity-settings'); await expect(other.locator('#settings-name')).toHaveValue('Committed name');
});

test('calibration rebases display without changing draft instants and preserves invalid input', async ({ page }) => {
  await page.clock.install({ time: new Date('2028-01-10T12:00:00Z') }); await page.clock.setFixedTime(new Date('2028-01-10T12:00:00Z')); await start(page);
  await page.locator('#note').fill('Fixed draft'); await timeField(page, '2028-01-10T13:10');
  await section(page, 'clock-settings'); await page.locator('#capture-time').click(); await page.locator('#monitor-reading').fill('2028-01-10T13:03');
  await page.locator('#save-clock').click(); await page.locator('#close-dialog').click();
  await expect(page.locator('#entry-time')).toHaveValue('2028-01-10T13:13'); await expect(page.locator('.time-stamp')).toContainText('EKG-Uhrzeit');
  await page.locator('#save-entry').click(); const saved = (await rows(page))[0];
  expect(saved.eventAtMs).toBe(Date.parse('2028-01-10T12:10:00Z')); expect(saved.capturedAtMs).toBe(Date.parse('2028-01-10T12:00:00Z'));
  await page.locator('#note').fill('Invalid input retained'); await timeField(page, '');
  await section(page, 'clock-settings'); await page.locator('#reset-clock').click(); await page.locator('#save-clock').click(); await page.locator('#close-dialog').click();
  await expect(page.locator('#entry-time')).toHaveValue(''); await expect(page.locator('#note')).toHaveValue('Invalid input retained');
  await page.locator('#save-entry').click(); await expect(page.locator('#error')).toContainText('gültiges Datum'); expect(await rows(page)).toHaveLength(1);
});

test('waiting update is guarded by every settings section, manual time and symptom-only drafts', async ({ page }) => {
  const workerPath = 'dist/sw.js'; const original = await readFile(workerPath, 'utf8');
  try {
    await start(page); await expect(page.locator('#offline-badge')).toContainText('bereit');
    await writeFile(workerPath, original+'\n// Synthetic unified settings update\n');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect(page.locator('#update-notice')).toBeVisible();
    await section(page, 'update-settings'); await expect(page.locator('#apply-update')).toBeEnabled();
    await section(page, 'identity-settings'); await page.locator('#settings-name').fill('Unsaved identity'); await expect(page.locator('#apply-update')).toBeDisabled();
    await page.locator('#save-identity').click(); await expect(page.locator('#apply-update')).toBeEnabled();
    await section(page, 'clock-settings'); await page.locator('#capture-time').click(); await expect(page.locator('#apply-update')).toBeDisabled();
    await page.locator('#save-clock').click(); await expect(page.locator('#apply-update')).toBeEnabled();
    await page.locator('#close-dialog').click(); await page.locator('#entry-kind').check();
    await section(page, 'update-settings'); await expect(page.locator('#apply-update')).toBeDisabled(); await page.locator('#return-note').click();
    page.once('dialog', d => d.accept()); await page.locator('#cancel-edit').click(); await timeField(page, '2028-01-10T13:10');
    await section(page, 'update-settings'); await expect(page.locator('#apply-update')).toBeDisabled();
  } finally { await writeFile(workerPath, original); }
});

test('long history keeps quick capture reachable and separates connection from offline readiness', async ({ page, context }) => {
  await start(page);
  for (let index = 0; index < 12; index++) { await page.locator('#note').fill(`Synthetic ${index}`); await page.locator('#save-entry').click(); await expect(page.locator('.entry')).toHaveCount(index + 1); }
  await page.locator('.entry').last().scrollIntoViewIfNeeded(); await expect(page.locator('#quick-actions')).toBeVisible();
  await expect(page.locator('#settings')).toBeInViewport(); await page.locator('#quick-symptom').click();
  await expect(page.locator('.entry')).toHaveCount(13); await expect(page.locator('#marker-details')).toBeVisible();
  await page.locator('.entry').last().scrollIntoViewIfNeeded(); await page.locator('#new-note').click(); await expect(page.locator('#note')).toBeFocused();
  await expect(page.locator('#note')).toBeInViewport();
  await context.setOffline(true); await expect(page.locator('#offline-badge')).toHaveText('Ohne Internet · Offline-Nutzung bereit');
  await page.evaluate(async () => { const cache = await caches.open((await caches.keys()).find(n => n.startsWith('holter-diary:'))!); await cache.delete(new URL('icon-192.png', location.href).href); });
  await section(page, 'storage-settings'); await expect(page.locator('#storage-settings [data-offline-status]').first()).toContainText('unvollständig');
  await page.locator('#close-dialog').click(); await expect(page.locator('#offline-badge')).toContainText('unvollständig');
});

test('reset offers cancel and export before explicit deletion without discarding a draft', async ({ page }) => {
  await start(page); await page.locator('#note').fill('Saved entry'); await page.locator('#save-entry').click(); await page.locator('#note').fill('Unsaved note');
  await page.locator('#settings').click(); await page.locator('#reset-diary').click();
  await expect(page.locator('#dialog')).toContainText('1 Einträge'); await page.locator('#close-dialog').click(); await page.locator('#close-dialog').click();
  await expect(page.locator('#note')).toHaveValue('Unsaved note'); expect(await rows(page)).toHaveLength(1);
  await page.locator('#settings').click(); await page.locator('#reset-diary').click(); await page.locator('#export-before-reset').click();
  const downloaded = page.waitForEvent('download'); await page.locator('#download-pdf').click(); await downloaded; await page.locator('#close-dialog').click();
  await expect(page.locator('#note')).toHaveValue('Unsaved note');
  await page.locator('#settings').click(); await page.locator('#reset-diary').click();
  await page.evaluate(() => {
    const remove = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = function (...args: Parameters<IDBObjectStore['delete']>) {
      const request = remove.apply(this, args);
      if (this.name === 'entries') { IDBObjectStore.prototype.delete = remove; request.addEventListener('success', () => this.transaction.abort()); }
      return request;
    };
  });
  await page.locator('#confirm-reset').click(); await expect(page.locator('#dialog-error')).toBeVisible();
  expect(await rows(page)).toHaveLength(1); expect(await rows(page, 'sessions')).toHaveLength(1);
  await page.locator('#close-dialog').click(); await page.locator('#close-dialog').click();
  await expect(page.locator('#note')).toHaveValue('Unsaved note');
  await page.locator('#settings').click(); await page.locator('#reset-diary').click(); await page.locator('#confirm-reset').click();
  await expect(page.locator('#start-diary')).toBeVisible(); expect(await rows(page)).toHaveLength(0);
});

test('discarding an editor after another tab resets the diary leaves setup free of phantom drafts', async ({ page, context }) => {
  const workerPath = 'dist/sw.js'; const original = await readFile(workerPath, 'utf8');
  try {
    await start(page); await page.locator('#note').fill('Original entry'); await page.locator('#save-entry').click();
    await expect(page.locator('#offline-badge')).toContainText('bereit');
    await writeFile(workerPath, original+'\n// Synthetic conflict recovery update\n');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update()); await expect(page.locator('#update-notice')).toBeVisible();
    await page.locator('.entry-button').click(); await page.locator('#note').fill('Stale editor');
    const other = await context.newPage(); await other.goto(''); await other.locator('#settings').click(); await other.locator('#reset-diary').click(); await other.locator('#confirm-reset').click();
    await page.locator('#save-entry').click(); await expect(page.locator('#dialog-error')).toContainText('anderen Fenster');
    page.once('dialog', d => d.accept()); await page.locator('#reload-data').click(); await expect(page.locator('#start-diary')).toBeVisible();
    await section(page, 'update-settings'); await expect(page.locator('#apply-update')).toBeEnabled();
    await page.locator('#close-dialog').click(); await page.locator('#start-diary').click(); await expect(page.locator('#note')).toHaveValue('');
    expect(await rows(page)).toHaveLength(0);
  } finally { await writeFile(workerPath, original); }
});
