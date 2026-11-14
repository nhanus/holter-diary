import { DiaryError, assertEntry, assertPreferences, requireValue } from './domain.ts';
import type { Entry, Preferences, Session } from './domain.ts';
import { assertConsistentCalibration } from './time.ts';

const DATABASE_NAME = 'holter-diary';
const VERSION = 1;
const STORES = ['sessions', 'entries', 'preferences'] as const;
type Store = typeof STORES[number];
export type Durability = IDBTransactionDurability | 'unreported';
export interface Saved<T> { value: T; durability: Durability }

function read<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new DiaryError('STORAGE_FAILED'));
  });
}

function createTransaction(db: IDBDatabase, stores: Store[], mode: IDBTransactionMode): IDBTransaction {
  if (mode === 'readonly') return db.transaction(stores, mode);
  try { return db.transaction(stores, mode, { durability: 'strict' }); }
  catch (error) {
    // Older browsers can reject the options argument. Never retry quota or I/O errors.
    if (!(error instanceof TypeError)) throw error;
    return db.transaction(stores, mode);
  }
}

async function checkSession(tx: IDBTransaction, id: string, expectedRevision: number): Promise<void> {
  const session: unknown = await read(tx.objectStore('sessions').get(id));
  requireValue(session !== undefined, 'SESSION_NOT_FOUND');
  assertConsistentCalibration(session);
  requireValue(session.revision === expectedRevision, 'SESSION_CHANGED');
}

export class DiaryStore {
  private db: IDBDatabase;

  constructor(db: IDBDatabase) {
    this.db = db;
    db.onversionchange = () => db.close();
  }

  close(): void { this.db.close(); }

  private async run<T>(stores: Store[], mode: IDBTransactionMode, work: (tx: IDBTransaction) => Promise<T>): Promise<Saved<T>> {
    const tx = createTransaction(this.db, stores, mode);
    const finished = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new DiaryError('TRANSACTION_ABORTED'));
    });
    // Work awaits only IndexedDB requests, keeping the transaction active.
    try {
      const [value] = await Promise.all([work(tx), finished]);
      return { value, durability: tx.durability ?? 'unreported' };
    } catch (error) {
      try { tx.abort(); } catch { /* The transaction may already be finished. */ }
      throw error;
    }
  }

  async startSession(input: Session): Promise<Saved<Session>> {
    const value = structuredClone(input);
    assertConsistentCalibration(value);
    requireValue(value.revision === 1);
    return this.run(['sessions'], 'readwrite', async tx => {
      const store = tx.objectStore('sessions');
      requireValue(await read(store.count()) === 0, 'SESSION_EXISTS');
      await read(store.add(value));
      return value;
    });
  }

  async sessions(): Promise<Session[]> {
    return (await this.run(['sessions'], 'readonly', async tx => {
      const values: unknown[] = await read(tx.objectStore('sessions').getAll());
      values.forEach(assertConsistentCalibration);
      return values as Session[];
    })).value;
  }

  async updateSession(input: Session): Promise<Saved<Session>> {
    const value = structuredClone(input);
    assertConsistentCalibration(value);
    return this.run(['sessions'], 'readwrite', async tx => {
      const store = tx.objectStore('sessions');
      const previous: unknown = await read(store.get(value.id));
      requireValue(previous !== undefined, 'SESSION_NOT_FOUND');
      assertConsistentCalibration(previous as Session);
      const old = previous as Session;
      requireValue(old.revision === value.revision, 'EDIT_CONFLICT');
      requireValue(old.startedAtMs === value.startedAtMs &&
        old.clock.timeZone === value.clock.timeZone && old.clock.utcOffsetMinutes === value.clock.utcOffsetMinutes,
      'IMMUTABLE_FIELD');
      value.revision += 1;
      await read(store.put(value));
      return value;
    });
  }

  async addEntry(input: Entry, expectedSessionRevision: number): Promise<Saved<Entry>> {
    const value = structuredClone(input);
    assertEntry(value);
    requireValue(value.revision === 1);
    return this.run(['sessions', 'entries'], 'readwrite', async tx => {
      await checkSession(tx, value.sessionId, expectedSessionRevision);
      await read(tx.objectStore('entries').add(value));
      return value;
    });
  }

  async entries(sessionId: string): Promise<Entry[]> {
    return (await this.run(['entries'], 'readonly', async tx => {
      const values: unknown[] = await read(tx.objectStore('entries').getAll());
      values.forEach(assertEntry);
      return (values as Entry[]).filter(value => value.sessionId === sessionId)
        .sort((a, b) => a.eventAtMs - b.eventAtMs || a.id.localeCompare(b.id));
    })).value;
  }

  async updateEntry(input: Entry, expectedSessionRevision: number): Promise<Saved<Entry>> {
    const value = structuredClone(input);
    assertEntry(value);
    return this.run(['sessions', 'entries'], 'readwrite', async tx => {
      await checkSession(tx, value.sessionId, expectedSessionRevision);
      const store = tx.objectStore('entries');
      const previous: unknown = await read(store.get(value.id));
      requireValue(previous !== undefined, 'ENTRY_NOT_FOUND');
      assertEntry(previous);
      requireValue(previous.revision === value.revision, 'EDIT_CONFLICT');
      requireValue(previous.capturedAtMs === value.capturedAtMs && previous.sessionId === value.sessionId, 'IMMUTABLE_FIELD');
      value.revision += 1;
      await read(store.put(value));
      return value;
    });
  }

  async deleteEntry(id: string, expectedRevision: number): Promise<void> {
    await this.run(['entries'], 'readwrite', async tx => {
      const store = tx.objectStore('entries');
      const previous: unknown = await read(store.get(id));
      requireValue(previous !== undefined, 'ENTRY_NOT_FOUND');
      assertEntry(previous);
      requireValue(previous.revision === expectedRevision, 'EDIT_CONFLICT');
      await read(store.delete(id));
    });
  }

  async preferences(): Promise<Preferences | undefined> {
    return (await this.run(['preferences'], 'readonly', async tx => {
      const value: unknown = await read(tx.objectStore('preferences').get('preferences'));
      if (value !== undefined) assertPreferences(value);
      return value as Preferences | undefined;
    })).value;
  }

  async setPreferences(input: Preferences): Promise<Saved<Preferences>> {
    const value = structuredClone(input);
    assertPreferences(value);
    return this.run(['preferences'], 'readwrite', async tx => {
      await read(tx.objectStore('preferences').put(value));
      return value;
    });
  }

  async resetSession(id: string, expectedRevision: number): Promise<void> {
    await this.run(['sessions', 'entries'], 'readwrite', async tx => {
      await checkSession(tx, id, expectedRevision);
      const entries = tx.objectStore('entries');
      const values: Entry[] = await read(entries.getAll());
      for (const entry of values) {
        assertEntry(entry);
        if (entry.sessionId === id) await read(entries.delete(entry.id));
      }
      await read(tx.objectStore('sessions').delete(id));
    });
  }

  async reportSnapshot(sessionId: string): Promise<{ session: Session; entries: Entry[] }> {
    return (await this.run(['sessions', 'entries'], 'readonly', async tx => {
      const session: unknown = await read(tx.objectStore('sessions').get(sessionId));
      requireValue(session !== undefined, 'SESSION_NOT_FOUND');
      assertConsistentCalibration(session);
      const values: unknown[] = await read(tx.objectStore('entries').getAll());
      values.forEach(assertEntry);
      return { session, entries: (values as Entry[]).filter(x => x.sessionId === sessionId)
        .sort((a, b) => a.eventAtMs - b.eventAtMs || a.id.localeCompare(b.id)) };
    })).value;
  }
}

export function openDiaryStore(name = DATABASE_NAME): Promise<DiaryStore> {
  return new Promise((resolve, reject) => {
    let abandoned = false;
    const request = indexedDB.open(name, VERSION);
    request.onupgradeneeded = event => {
      if (event.oldVersion !== 0) {
        request.transaction?.abort();
        return;
      }
      for (const store of STORES) request.result.createObjectStore(store, { keyPath: 'id' });
    };
    request.onblocked = () => {
      abandoned = true;
      reject(new DiaryError('DATABASE_BLOCKED'));
    };
    request.onerror = () => reject(request.error ?? new DiaryError('STORAGE_FAILED'));
    request.onsuccess = () => {
      const db = request.result;
      if (abandoned) { db.close(); return; }
      try {
        requireValue(STORES.every(store => db.objectStoreNames.contains(store)), 'INVALID_SCHEMA');
        const tx = db.transaction([...STORES], 'readonly');
        requireValue(STORES.every(store => tx.objectStore(store).keyPath === 'id'), 'INVALID_SCHEMA');
        resolve(new DiaryStore(db));
      } catch (error) { db.close(); reject(error); }
    };
  });
}
