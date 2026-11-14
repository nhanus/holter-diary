import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('');
  await page.waitForFunction(() => !!window.diary);
});

test('committed session, entries and language survive page reload and database reopening', async ({ page }) => {
  const original = await page.evaluate(async () => {
    const d = window.diary;
    const store = await d.openDiaryStore();
    const session = d.newSession(Date.parse('2028-01-10T12:30:00Z'), { timeZone: 'UTC', utcOffsetMinutes: 0 });
    const savedSession = await store.startSession(session);
    const first = d.newEntry(session.id, session.startedAtMs, 'symptom', 'Synthetic symptom');
    const saved = await store.addEntry(first, session.revision);
    await store.addEntry(d.newEntry(session.id, session.startedAtMs - 60000, 'note', 'Synthetic activity'), session.revision);
    await store.setPreferences({ schemaVersion: 1, id: 'preferences', language: 'de' });
    store.close();
    return { session: savedSession.value, first: saved.value, durability: saved.durability };
  });
  expect(original.durability).toBe('strict');
  await page.reload();
  await page.waitForFunction(() => !!window.diary);
  const loaded = await page.evaluate(async sessionId => {
    const store = await window.diary.openDiaryStore();
    const result = { sessions: await store.sessions(), entries: await store.entries(sessionId), preferences: await store.preferences() };
    store.close(); return result;
  }, original.session.id);
  expect(loaded.sessions).toEqual([original.session]);
  expect(loaded.entries.map(x => x.note)).toEqual(['Synthetic activity', 'Synthetic symptom']);
  expect(loaded.entries[1]).toEqual(original.first);
  expect(loaded.preferences?.language).toBe('de');
});

test('aborted write never reports success or mutates the caller draft', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const d = window.diary;
    const store = await d.openDiaryStore();
    const session = d.newSession(Date.now(), { timeZone: 'UTC', utcOffsetMinutes: 0 });
    await store.startSession(session);
    const draft = d.newEntry(session.id, session.startedAtMs, 'note', 'Draft to keep');
    await store.addEntry(d.newEntry(session.id, session.startedAtMs - 60000, 'note', 'Previously saved'), session.revision);
    const originalAdd = IDBObjectStore.prototype.add;
    let requestSucceeded = false;
    IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
      const request = originalAdd.apply(this, args);
      if (this.name === 'entries') request.addEventListener('success', () => {
        requestSucceeded = true;
        this.transaction.abort();
      });
      return request;
    };
    let failed = false;
    try { await store.addEntry(draft, session.revision); } catch { failed = true; }
    finally { IDBObjectStore.prototype.add = originalAdd; }
    const entries = await store.entries(session.id);
    store.close();
    return { failed, requestSucceeded, entries, draft };
  });
  expect(result.failed).toBe(true);
  expect(result.requestSucceeded).toBe(true);
  expect(result.entries.map(x => x.note)).toEqual(['Previously saved']);
  expect(result.draft.note).toBe('Draft to keep');
  expect(result.draft.revision).toBe(1);
});

test('edits preserve captured time, reject stale writes and allow explicit calibration correction', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const d = window.diary;
    const store = await d.openDiaryStore();
    const session = d.newSession(Date.parse('2028-01-10T12:30:00Z'), { timeZone: 'UTC', utcOffsetMinutes: 0 });
    await store.startSession(session);
    const entry = d.newEntry(session.id, session.startedAtMs, 'note', 'First');
    await store.addEntry(entry, session.revision);
    const edited = await store.updateEntry({ ...entry, note: 'Corrected', eventAtMs: entry.eventAtMs - 60000 }, session.revision);
    let conflict = false, immutable = false, replacement = false;
    try { await store.updateEntry({ ...entry, note: 'Stale edit' }, session.revision); } catch (e) { conflict = (e as Error).message === 'EDIT_CONFLICT'; }
    try { await store.updateEntry({ ...edited.value, capturedAtMs: 0 }, session.revision); } catch (e) { immutable = (e as Error).message === 'IMMUTABLE_FIELD'; }
    try { await store.startSession(d.newSession(Date.now(), session.clock)); } catch (e) { replacement = (e as Error).message === 'SESSION_EXISTS'; }
    const corrected = await store.updateSession({ ...session, calibration: d.calibrate(session.startedAtMs, '2028-01-10T12:28:00', session.clock) });
    let changedSession = false, staleInsert = false;
    try { await store.updateEntry({ ...edited.value, eventAtMs: entry.eventAtMs - 300000 }, session.revision); }
    catch (e) { changedSession = (e as Error).message === 'SESSION_CHANGED'; }
    try { await store.addEntry(d.newEntry(session.id, entry.eventAtMs - 300000, 'note', 'Stale backdate'), session.revision); }
    catch (e) { staleInsert = (e as Error).message === 'SESSION_CHANGED'; }
    const entries = await store.entries(session.id);
    store.close();
    return { conflict, immutable, replacement, changedSession, staleInsert, original: entry, entries, display: d.monitorTime(entries[0].eventAtMs, corrected.value) };
  });
  expect(result.conflict && result.immutable && result.replacement && result.changedSession && result.staleInsert).toBe(true);
  expect(result.entries).toHaveLength(1);
  expect(result.entries[0].note).toBe('Corrected');
  expect(result.entries[0].capturedAtMs).toBe(result.original.capturedAtMs);
  expect(result.display).toBe('2028-01-10T12:27:00');
});

test('newer or malformed database is rejected without clearing its contents', async ({ page }) => {
  const result = await page.evaluate(async () => {
    async function existing(name: string, version: number) {
      await new Promise<void>((resolve, reject) => {
        const req = indexedDB.open(name, version);
        req.onupgradeneeded = () => req.result.createObjectStore('keep').put('synthetic existing record', 'record');
        req.onsuccess = () => { req.result.close(); resolve(); };
        req.onerror = () => reject(req.error);
      });
      let rejected = false;
      try { await window.diary.openDiaryStore(name); } catch { rejected = true; }
      const value = await new Promise<unknown>((resolve, reject) => {
        const req = indexedDB.open(name);
        req.onsuccess = () => {
          const db = req.result;
          const get = db.transaction('keep').objectStore('keep').get('record');
          get.onsuccess = () => { db.close(); resolve(get.result); };
        };
        req.onerror = () => reject(req.error);
      });
      return { rejected, value };
    }
    return Promise.all([existing('future-schema', 2), existing('invalid-schema', 1)]);
  });
  for (const item of result) expect(item).toEqual({ rejected: true, value: 'synthetic existing record' });
});

test('unsupported strict durability falls back and reports the actual browser mode', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const store = await window.diary.openDiaryStore();
    const originalTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function (...args: Parameters<IDBDatabase['transaction']>) {
      if (args.length > 2) throw new TypeError('Synthetic unsupported options');
      return originalTransaction.apply(this, args);
    };
    try {
      return (await store.setPreferences({ schemaVersion: 1, id: 'preferences', language: 'en' })).durability;
    } finally { IDBDatabase.prototype.transaction = originalTransaction; store.close(); }
  });
  expect(result).toBe('default');
});


test('legacy sessions can add, reload and clear a birth date without changing entries', async ({ page }) => {
  const expected = await page.evaluate(async () => {
    const d = window.diary;
    const store = await d.openDiaryStore();
    const legacy = d.newSession(Date.parse('2030-01-01T00:00:00Z'), { timeZone: 'UTC', utcOffsetMinutes: 0 }, 'Synthetic person');
    delete legacy.dateOfBirth;
    await store.startSession(legacy);
    const entry = (await store.addEntry(d.newEntry(legacy.id, legacy.startedAtMs, 'note', 'Existing observation'), legacy.revision)).value;
    const loaded = (await store.sessions())[0];
    const saved = await store.updateSession({ ...loaded, dateOfBirth: '1980-02-29' });
    let invalidRejected = false;
    try { await store.updateSession({ ...saved.value, dateOfBirth: '1980-02-30' }); } catch { invalidRejected = true; }
    store.close();
    return { session: saved.value, entry, invalidRejected };
  });
  expect(expected.invalidRejected).toBe(true);
  await page.reload();
  await page.waitForFunction(() => !!window.diary);
  const result = await page.evaluate(async id => {
    const store = await window.diary.openDiaryStore();
    const snapshot = await store.reportSnapshot(id);
    const cleared = (await store.updateSession({ ...snapshot.session, dateOfBirth: '' })).value;
    const after = await store.reportSnapshot(id);
    store.close();
    return { snapshot, cleared, after };
  }, expected.session.id);
  expect(result.snapshot).toEqual({ session: expected.session, entries: [expected.entry] });
  expect(result.cleared.dateOfBirth).toBe('');
  expect(result.after.entries).toEqual([expected.entry]);
});
