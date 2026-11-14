import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

async function start(page: Page) {
  await page.goto('');
  await page.getByRole('button', { name: 'Tagebuch beginnen' }).click();
  await expect(page.getByRole('heading', { name: 'Dein Tagebuch' })).toBeVisible();
}
async function note(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Notiz', exact: true }).fill(text);
  await page.getByRole('button', { name: 'Eintrag speichern' }).click();
  await expect(page.locator('.entry-note').filter({ hasText: text })).toBeVisible();
}
async function savedEntries(page: Page) {
  return page.evaluate(() => new Promise<Array<{ id: string; revision: number; note: string; eventAtMs: number; capturedAtMs: number }>>((resolve, reject) => {
    const req = indexedDB.open('holter-diary');
    req.onsuccess = () => {
      const db = req.result; const get = db.transaction('entries').objectStore('entries').getAll();
      get.onsuccess = () => { db.close(); resolve(get.result); }; get.onerror = () => reject(get.error);
    }; req.onerror = () => reject(req.error);
  }));
}

test('quick capture, marker preserves draft, editing, language and confirmed deletion', async ({ page }) => {
  await start(page);
  const text = page.getByRole('textbox', { name: 'Notiz', exact: true });
  await text.fill('Spaziergang über die Brücke');
  await page.getByRole('button', { name: 'Beschwerden jetzt' }).click();
  await expect(page.locator('.entry')).toHaveCount(1);
  await expect(text).toHaveValue('Spaziergang über die Brücke');
  await page.getByRole('button', { name: 'Eintrag speichern' }).click();
  await expect(page.locator('.entry')).toHaveCount(2);
  await page.locator('.entry-button').filter({ hasText: 'Spaziergang' }).click();
  await text.fill('Spaziergang, danach Pause');
  await page.getByText('Zeit ändern', { exact: true }).click();
  await page.locator('#entry-time').fill('2028-01-10T13:20');
  await expect(page.locator('.time-stamp')).toHaveText('13:20:00');
  await page.getByRole('button', { name: 'Eintrag speichern' }).click();
  await expect(page.locator('.entry-button').filter({ hasText: 'Spaziergang' })).toContainText('13:20:00');
  await page.locator('#language').focus();
  await page.locator('#language').selectOption('en');
  await expect(page.getByRole('heading', { name: 'Your diary' })).toBeVisible();
  await expect(page.locator('#language')).toBeFocused();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings')).toBeFocused();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your diary' })).toBeVisible();
  await expect(page.locator('.entry-note').filter({ hasText: 'Spaziergang, danach Pause' })).toBeVisible();
  await page.locator('.entry-button').filter({ hasText: 'Spaziergang' }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Delete entry' }).click();
  await expect(page.locator('.entry')).toHaveCount(2);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Delete entry' }).click();
  await expect(page.locator('.entry')).toHaveCount(1);
});

test('aborted transaction retains draft and frozen time; a retry saves exactly once', async ({ page }) => {
  await page.setViewportSize({width:320,height:420});
  await start(page);
  await page.getByRole('textbox', { name: 'Notiz', exact: true }).fill('Nicht verlieren');
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
      const req = original.apply(this, args);
      if (this.name === 'entries') { IDBObjectStore.prototype.add = original; req.addEventListener('success', () => this.transaction.abort()); }
      return req;
    };
  });
  const time = await page.locator('.time-stamp').textContent();
  await page.getByRole('button', { name: 'Eintrag speichern' }).click();
  await expect(page.locator('#error')).toContainText('Speichern fehlgeschlagen');
  await expect(page.locator('#error')).toBeInViewport();
  await expect(page.getByRole('textbox', { name: 'Notiz', exact: true })).toHaveValue('Nicht verlieren');
  await expect(page.locator('.time-stamp')).toHaveText(time!);
  expect(await savedEntries(page)).toHaveLength(0);
  await page.getByRole('button', { name: 'Eintrag speichern' }).click();
  await expect(page.locator('#feedback')).toContainText('gespeichert');
  expect(await savedEntries(page)).toHaveLength(1);
  await expect(page.locator('#feedback')).toBeInViewport();
  await expect(page.locator('#save-entry')).toBeFocused();
});

test('first input refreshes an idle form time; subsequent typing freezes it', async ({ page }) => {
  await page.clock.install({ time: new Date('2028-01-10T12:00:00Z') });
  await start(page);
  await page.clock.setFixedTime(new Date('2028-01-10T12:30:00Z'));
  await page.getByRole('textbox', { name: 'Notiz', exact: true }).fill('Erster Satz');
  await expect(page.locator('.time-stamp')).toHaveText('13:30:00');
  await page.clock.setFixedTime(new Date('2028-01-10T12:31:00Z'));
  await page.getByRole('textbox', { name: 'Notiz', exact: true }).fill('Erster Satz, ergänzt');
  await expect(page.locator('.time-stamp')).toHaveText('13:30:00');
  await page.getByRole('button', { name: 'Eintrag speichern' }).click();
  expect((await savedEntries(page))[0].eventAtMs).toBe(Date.parse('2028-01-10T12:30:00Z'));
});

test('same-tab settings preserve editable draft; stale tabs cannot overwrite edits', async ({ page, context }) => {
  await start(page);
  await note(page, 'Original');
  const other = await context.newPage(); await other.goto('');
  await other.locator('.entry-button').click();
  await other.getByRole('textbox', { name: 'Notiz', exact: true }).fill('Veraltete Änderung');
  await page.locator('.entry-button').click();
  await page.getByRole('textbox', { name: 'Notiz', exact: true }).fill('Aktuelle Änderung');
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.locator('#settings-name').fill('Beispielperson');
  await page.getByRole('button', { name: 'Einstellungen speichern' }).click();
  await page.getByRole('button', { name: 'Eintrag speichern' }).click();
  await expect(page.locator('#feedback')).toContainText('gespeichert');
  await other.getByRole('button', { name: 'Eintrag speichern' }).click();
  await expect(other.locator('#error')).toContainText('anderen Fenster');
  await expect(other.getByRole('textbox', { name: 'Notiz', exact: true })).toHaveValue('Veraltete Änderung');
  expect((await savedEntries(page))[0].note).toBe('Aktuelle Änderung');
});

test('offline reload keeps entries, accepts another note and exports PDF', async ({ page, context }) => {
  await start(page); await note(page, 'Treppe gestiegen');
  await expect(page.locator('#offline-badge')).toHaveText('Für Offline-Nutzung bereit');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await context.setOffline(true); await page.reload();
  await expect(page.locator('.entry-note')).toHaveText('Treppe gestiegen');
  await note(page, 'Pause ohne Internet');
  await page.getByRole('button', { name: 'Protokoll exportieren' }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'PDF herunterladen' }).click();
  const file = await downloaded;
  const bytes = await readFile((await file.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  await expect(page.locator('#dialog-feedback')).toContainText('PDF bereit');
});

test('unsupported PDF glyphs never disappear silently; text export retains them', async ({ page }) => {
  await start(page); await note(page, 'Pause 🙂 心');
  await page.getByRole('button', { name: 'Protokoll exportieren' }).click();
  await page.getByRole('button', { name: 'PDF herunterladen' }).click();
  await expect(page.locator('#dialog-error')).toContainText('Textdatei');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Textdatei herunterladen' }).click();
  const file = await downloaded;
  expect(await readFile((await file.path())!, 'utf8')).toContain('Pause 🙂 心');
});

test('notes render as text and phone layouts have no horizontal overflow', async ({ page }) => {
  await start(page); await note(page, '<img src=x onerror="document.title=123"> ' + 'abcdefghij'.repeat(30));
  expect(await page.title()).toBe('Holter Diary');
  expect(await page.locator('.entry-note img').count()).toBe(0);
  for (const width of [320, 393, 768]) {
    await page.setViewportSize({ width, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.addStyleTag({ content: ':root{font-size:24px}input,textarea,button{font-size:24px}' });
  await page.setViewportSize({ width: 393, height: 850 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('worker update waits, preserves another tab draft, and keeps saved records', async ({ page, context }) => {
  const workerPath = 'dist/sw.js'; const original = await readFile(workerPath, 'utf8');
  try {
    await start(page); await note(page, 'Vor dem Update gespeichert');
    await expect(page.locator('#offline-badge')).toHaveText('Für Offline-Nutzung bereit');
    const other = await context.newPage(); await other.goto('');
    await other.getByRole('textbox', { name: 'Notiz', exact: true }).fill('Entwurf im zweiten Fenster');
    await page.getByRole('textbox', { name: 'Notiz', exact: true }).fill('Offener Entwurf');
    await writeFile(workerPath, original + '\n// Synthetic update test\n');
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.getRegistration(); await registration!.update(); });
    await page.waitForFunction(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting);
    await expect(page.getByRole('textbox', { name: 'Notiz', exact: true })).toHaveValue('Offener Entwurf');
    await expect(page.locator('#update-notice')).toBeVisible();
    await expect(page.locator('#update-announcement')).toHaveText('Update verfügbar');
    await page.locator('#update-notice').click();
    await expect(page.getByRole('heading', { name: 'App & Speicherung' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Jetzt aktualisieren' })).toBeDisabled();
    await expect(page.locator('#update-blocked')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#update-notice')).toBeFocused();
    await expect(page.getByRole('textbox', { name: 'Notiz', exact: true })).toHaveValue('Offener Entwurf');
    await page.getByRole('button', { name: 'Eintrag speichern' }).click();
    await page.locator('#update-notice').click();
    await expect(page.getByRole('button', { name: 'Jetzt aktualisieren' })).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Jetzt aktualisieren' })).toBeInViewport();
    await page.getByRole('button', { name: 'Jetzt aktualisieren' }).click();
    await expect(page.locator('.entry-note')).toContainText(['Offener Entwurf', 'Vor dem Update gespeichert']);
    await expect(page.getByRole('textbox', { name: 'Notiz', exact: true })).toHaveValue('');
    await expect(other.getByRole('textbox', { name: 'Notiz', exact: true })).toHaveValue('Entwurf im zweiten Fenster');
    await other.getByRole('button', { name: 'Eintrag speichern' }).click();
    await expect(other.locator('.entry-note').filter({ hasText: 'Entwurf im zweiten Fenster' })).toBeVisible();
    await other.reload();
    await expect(other.locator('.entry')).toHaveCount(3);
  } finally { await writeFile(workerPath, original); }
});

test('denied persistence is visible and does not prevent real database saves', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { value: async () => false });
    Object.defineProperty(navigator.storage, 'persisted', { value: async () => false });
  });
  await start(page);
  await expect(page.locator('main [data-storage-status]')).toHaveCount(0);
  await page.getByRole('button', { name: 'App & Speicherung', exact: true }).click();
  await expect(page.locator('[data-storage-status]')).toContainText('nicht freigegeben');
  await page.keyboard.press('Escape');
  await note(page, 'Gespeichert trotz abgelehnter Freigabe');
  await page.reload();
  await expect(page.locator('.entry-note')).toHaveText('Gespeichert trotz abgelehnter Freigabe');
  await page.getByRole('button', { name: 'App & Speicherung', exact: true }).click();
  await expect(page.locator('[data-storage-status]')).toContainText('nicht bestätigt');
});

test('document language and description follow the interface and saved preference', async ({ page, browser }) => {
  await page.goto('');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('html')).toHaveAttribute('translate', 'no');
  await expect(page.locator('meta[name="google"]')).toHaveAttribute('content', 'notranslate');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Langzeit-EKG/);
  await page.locator('#language').selectOption('en');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Holter recording/);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Start my diary' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Holter recording/);
  await page.locator('#language').selectOption('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Tagebuch beginnen' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  const english = await browser.newContext({ locale: 'en-US' });
  try {
    const fresh = await english.newPage();
    await fresh.goto(page.url());
    await expect(fresh.getByRole('button', { name: 'Start my diary' })).toBeVisible();
    await expect(fresh.locator('html')).toHaveAttribute('lang', 'en');
    await expect(fresh.locator('meta[name="description"]')).toHaveAttribute('content', /Holter recording/);
  } finally { await english.close(); }
});

test('the loading shell stays neutral until the saved language is available', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    const page = await context.newPage();
    await page.goto(baseURL!);
    await page.locator('#language').selectOption('de');
    await expect(page.getByRole('button', { name: 'Tagebuch beginnen' })).toBeVisible();
    await page.addInitScript(() => {
      const open = indexedDB.open.bind(indexedDB);
      indexedDB.open = (...args: Parameters<IDBFactory['open']>) => {
        const request = open(...args);
        request.addEventListener('success', event => {
          event.stopImmediatePropagation();
          (window as Window & { releaseDiaryOpen?: () => void }).releaseDiaryOpen = () => request.dispatchEvent(new Event('success'));
        }, { once: true });
        return request;
      };
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => typeof (window as Window & { releaseDiaryOpen?: () => void }).releaseDiaryOpen === 'function');
    await expect(page.locator('html')).toHaveAttribute('lang', '');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', '');
    await page.evaluate(() => (window as Window & { releaseDiaryOpen?: () => void }).releaseDiaryOpen!());
    await expect(page.getByRole('button', { name: 'Tagebuch beginnen' })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', /Langzeit-EKG/);
  } finally { await context.close(); }
});

test('storage check reports repeated denial, API failure and actual grant separately from offline readiness', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator.storage, 'persist', { configurable: true, value: async () => {
      await new Promise(resolve => setTimeout(resolve, 300)); return false;
    } });
    Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => false });
  });
  await start(page);
  await note(page, 'Synthetische gespeicherte Notiz');
  await expect(page.locator('#offline-badge')).toHaveText('Für Offline-Nutzung bereit');
  await page.getByRole('button', { name: 'App & Speicherung', exact: true }).click();
  await page.getByText('Was bedeutet Speicherschutz?', { exact: true }).click();
  const check = page.getByRole('button', { name: 'Dauerhaften Speicher prüfen' });
  const result = page.locator('#dialog [data-storage-check]');
  for (let i = 0; i < 2; i++) {
    await check.click();
    await expect(result).toHaveText('Speicherschutz wird geprüft …');
    await expect(check).toBeDisabled();
    await expect(result).toHaveText('Prüfung abgeschlossen: Der Browser hat dauerhaften Speicher nicht freigegeben.');
    await expect(page.locator('#dialog [data-offline-status]')).toHaveText('Für Offline-Nutzung bereit');
  }
  await page.evaluate(() => Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => { throw new Error('Synthetic failure'); } }));
  await check.click();
  await expect(result).toHaveText('Prüfung abgeschlossen: Speicherfreigabe konnte nicht geprüft werden.');
  await page.evaluate(() => Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => true }));
  await check.click();
  await expect(result).toHaveText('Prüfung abgeschlossen: Dauerhafter Speicher bestätigt.');
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await page.locator('#language').selectOption('en');
  await page.getByRole('button', { name: 'App & storage', exact: true }).click();
  await page.getByText('What does storage protection mean?', { exact: true }).click();
  await page.evaluate(() => Object.defineProperty(navigator.storage, 'persisted', { configurable: true, value: async () => false }));
  await page.getByRole('button', { name: 'Check persistent storage' }).click();
  await expect(result).toHaveText('Checking storage protection…');
  await expect(result).toHaveText('Check complete: The browser has not granted persistent storage.');
  await page.reload();
  await expect(page.locator('.entry-note')).toHaveText('Synthetische gespeicherte Notiz');
});

test('failed marker retries its original time and can be discarded after a diary reset elsewhere', async ({ page, context }) => {
  await start(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
      const req = original.apply(this, args);
      if (this.name === 'entries') { IDBObjectStore.prototype.add = original; req.addEventListener('success', () => this.transaction.abort()); }
      return req;
    };
  });
  await page.getByRole('button', { name: 'Beschwerden jetzt' }).click();
  await expect(page.locator('#retry-marker')).toBeVisible();
  const originalTime = await page.locator('#pending-marker strong').textContent();
  await page.locator('#retry-marker').click();
  await expect(page.locator('.entry')).toHaveCount(1);
  await expect(page.locator('.entry-time strong')).toHaveText(originalTime!.slice(11));
  // Fail a second marker, then replace the diary in a separate tab.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
      const req = original.apply(this, args);
      if (this.name === 'entries') { IDBObjectStore.prototype.add = original; req.addEventListener('success', () => this.transaction.abort()); }
      return req;
    };
  });
  await page.getByRole('button', { name: 'Beschwerden jetzt' }).click();
  await expect(page.locator('#retry-marker')).toBeVisible();
  const other = await context.newPage(); await other.goto('');
  await other.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  other.once('dialog', dialog => dialog.accept());
  await other.getByRole('button', { name: 'Neues Tagebuch beginnen' }).click();
  await page.locator('#retry-marker').click();
  await page.locator('#reload-data').click();
  await expect(page.locator('#pending-marker')).toBeVisible();
  await expect(page.locator('#retry-marker')).toBeDisabled();
  await other.getByRole('button', { name: 'Tagebuch beginnen', exact: true }).click();
  await page.getByRole('button', { name: 'Tagebuch beginnen', exact: true }).click();
  await page.locator('#reload-data').click();
  await expect(page.locator('#discard-marker')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#discard-marker').click();
  await page.getByRole('button', { name: 'Beschwerden jetzt' }).click();
  await expect(page.locator('.entry')).toHaveCount(1);
  expect(await savedEntries(page)).toHaveLength(1);
});

test('missing cached asset withdraws offline readiness and repairs online without touching diary data', async ({ page, context }) => {
  await start(page); await note(page, 'Daten bleiben erhalten');
  await expect(page.locator('#offline-badge')).toHaveText('Für Offline-Nutzung bereit');
  await page.evaluate(async () => {
    const name = (await caches.keys()).find(name => name.startsWith('holter-diary:'))!;
    const cache = await caches.open(name);
    await cache.delete(new URL('icon-192.png', location.href).href);
  });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'App & Speicherung', exact: true }).click();
  await expect(page.locator('#retry-offline')).toBeVisible();
  await page.locator('#retry-offline').click();
  await expect(page.locator('[data-offline-status]')).toContainText('unvollständig');
  await context.setOffline(false);
  const path = 'dist/icon-192.png'; const original = await readFile(path);
  try {
    await writeFile(path, Buffer.concat([original, Buffer.from('synthetic different release')]));
    await page.locator('#retry-offline').click();
    await expect(page.locator('[data-offline-status]')).toContainText('unvollständig');
  } finally { await writeFile(path, original); }
  await page.locator('#retry-offline').click();
  await expect(page.locator('[data-offline-status]')).toContainText('bereit');
  expect((await savedEntries(page))[0].note).toBe('Daten bleiben erhalten');
});

test('calibration captures the reference moment, not later form submission; reset keeps language', async ({ page }) => {
  await page.clock.install({ time: new Date('2028-01-10T12:00:00Z') });
  await page.goto('');
  await page.getByText('EKG-Uhrzeit abgleichen', { exact: true }).click();
  await page.clock.setFixedTime(new Date('2028-01-10T12:00:00Z'));
  await page.getByRole('button', { name: 'Zeitpunkt festhalten' }).click();
  await page.locator('#monitor-reading').fill('2028-01-10T12:58');
  await page.clock.setFixedTime(new Date('2028-01-10T12:01:00Z'));
  await page.getByRole('button', { name: 'Tagebuch beginnen' }).click();
  await note(page, 'Kalibrierter Eintrag');
  await expect(page.locator('.entry-time strong')).toHaveText('12:59:00');
  await page.locator('#language').focus();
  await page.locator('#language').selectOption('en');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Start a new diary' }).click();
  expect(await savedEntries(page)).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Start my diary' })).toBeVisible();
  await page.reload();
  await expect(page.locator('#language')).toHaveValue('en');
});

test('resume refreshes only untouched drafts and rapid double tap saves one marker', async ({ page }) => {
  await page.clock.install({ time: new Date('2028-01-10T12:00:00Z') });
  await page.clock.setFixedTime(new Date('2028-01-10T12:00:00Z'));
  await start(page);
  await page.getByRole('textbox', { name: 'Notiz', exact: true }).fill('Entwurf bleibt');
  await page.clock.setFixedTime(new Date('2028-01-10T12:30:00Z'));
  const resume = () => page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await resume();
  await expect(page.locator('.time-stamp')).toHaveText('13:00:00');
  await expect(page.locator('#note')).toHaveValue('Entwurf bleibt');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('#cancel-edit').click();
  await page.clock.setFixedTime(new Date('2028-01-10T12:40:00Z'));
  await resume();
  await expect(page.locator('.time-stamp')).toHaveText('13:40:00');
  await page.locator('#mark-symptom').evaluate(button => { (button as HTMLButtonElement).click(); (button as HTMLButtonElement).click(); });
  await expect(page.locator('.entry')).toHaveCount(1);
  await expect(page.locator('.entry-time strong')).toHaveText('13:40:00');
  expect(await savedEntries(page)).toHaveLength(1);
});

test('export stays above a long history and is reachable from the top', async ({ page }) => {
  await start(page);
  for (let index = 0; index < 12; index++) await note(page, `Synthetic observation ${index + 1}`);
  await page.evaluate(() => scrollTo(0, 0));
  const exportButton = page.getByRole('button', { name: 'Protokoll exportieren' });
  await expect(exportButton).toBeInViewport();
  const exportBox = await exportButton.boundingBox();
  const historyBox = await page.locator('.history').boundingBox();
  expect(exportBox!.y + exportBox!.height).toBeLessThan(historyBox!.y);
  await exportButton.click();
  await expect(page.getByRole('button', { name: 'PDF herunterladen' })).toBeVisible();
});

test('success confirmations expire after four seconds without hiding a newer error', async ({ page }) => {
  await page.clock.install();
  await start(page);
  await expect(page.locator('#feedback')).toBeVisible();
  await page.clock.fastForward(4100);
  await expect(page.locator('#feedback')).toBeHidden();
  await note(page, 'Notice test');
  await page.clock.fastForward(2000);
  await page.locator('#save-entry').click();
  await expect(page.locator('#error')).toContainText('Bitte schreibe eine Notiz');
  await page.clock.fastForward(5000);
  await expect(page.locator('#error')).toBeVisible();
  await note(page, 'Second notice');
  await expect(page.locator('#feedback')).toBeVisible();
  await page.clock.fastForward(4100);
  await expect(page.locator('#feedback')).toBeHidden();
  await expect(page.locator('#save-entry')).toBeFocused();
});


test('diary settings protect edits and app maintenance stays separate and usable on narrow screens', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await start(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tagebuch-Einstellungen' })).toBeVisible();
  await expect(page.locator('#check-storage')).toHaveCount(0);
  await expect(page.locator('#apply-update')).toHaveCount(0);
  await page.locator('#settings-name').fill('Synthetic edited name');
  page.once('dialog', dialog => dialog.dismiss());
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings-name')).toHaveValue('Synthetic edited name');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(page.locator('#settings')).toBeFocused();
  await page.locator('#settings').click();
  await expect(page.locator('#settings-name')).toHaveValue('');
  await page.locator('.clock-settings > summary').click();
  await page.locator('#capture-time').click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.keyboard.press('Escape');
  await expect(page.locator('#monitor-reading')).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'App & Speicherung', exact: true }).click();
  await expect(page.locator('#dialog-title')).toBeFocused();
  await expect(page.locator('#settings-name')).toHaveCount(0);
  await expect(page.locator('#apply-update')).toBeHidden();
  await expect(page.locator('[data-offline-status]')).toHaveText('Für Offline-Nutzung bereit');
  await expect(page.locator('#retry-offline')).toBeHidden();
  await page.getByText('Was bedeutet Speicherschutz?', { exact: true }).click();
  await page.addStyleTag({ content: 'body { font-size: 24px } .help,button,summary,.status-line { font-size: 24px !important }' });
  await page.locator('#check-storage').focus();
  await page.locator('#check-storage').evaluate(el => el.scrollIntoView({ block: 'start' }));
  const control = await page.locator('#check-storage').boundingBox();
  const heading = await page.locator('.dialog-head').boundingBox();
  expect(control!.y).toBeGreaterThanOrEqual(heading!.y + heading!.height);
  await page.locator('#dialog').evaluate(el => el.scrollTop = el.scrollHeight);
  await expect(page.locator('#close-dialog')).toBeInViewport();
  expect(await page.locator('#dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#app-info')).toBeFocused();
});


test('an available update cannot discard setup fields or a pending symptom marker', async ({ page }) => {
  const workerPath = 'dist/sw.js'; const original = await readFile(workerPath, 'utf8');
  try {
    await page.goto('');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.locator('#setup-name').fill('Synthetic setup draft');
    await writeFile(workerPath, original + '\n// Synthetic setup update\n');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect(page.locator('#update-notice')).toBeVisible();
    await page.locator('#update-notice').click();
    await expect(page.locator('#apply-update')).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(page.locator('#setup-name')).toHaveValue('Synthetic setup draft');
    await page.locator('#start-diary').click();
    await page.evaluate(() => {
      const add = IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
        const request = add.apply(this, args);
        if (this.name === 'entries') {
          IDBObjectStore.prototype.add = add;
          request.addEventListener('success', () => this.transaction.abort());
        }
        return request;
      };
    });
    await page.locator('#mark-symptom').click();
    await expect(page.locator('#retry-marker')).toBeVisible();
    await page.locator('#update-notice').click();
    await expect(page.locator('#apply-update')).toBeDisabled();
    await page.keyboard.press('Escape');
    await page.locator('#retry-marker').click();
    await expect(page.locator('.entry')).toHaveCount(1);
    await page.locator('#update-notice').click();
    await expect(page.locator('#apply-update')).toBeEnabled();
  } finally { await writeFile(workerPath, original); }
});
