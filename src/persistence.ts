export type PersistenceStatus = 'granted' | 'not-granted' | 'denied' | 'unavailable' | 'failed';

export interface PersistenceAPI {
  persisted(): Promise<boolean>;
  persist(): Promise<boolean>;
}

function browserStorage(): PersistenceAPI | undefined {
  return typeof navigator === 'undefined' ? undefined : navigator.storage;
}

// Request only from an explicit setup gesture, never merely while loading the app.
export async function persistenceStatus(request = false, storage = browserStorage()): Promise<PersistenceStatus> {
  if (!storage || typeof storage.persisted !== 'function' ||
    (request && typeof storage.persist !== 'function')) return 'unavailable';
  try {
    if (await storage.persisted()) return 'granted';
    if (!request) return 'not-granted';
    const granted = await storage.persist();
    // Re-read the browser state rather than caching a permission indefinitely.
    return granted && await storage.persisted() ? 'granted' : 'denied';
  } catch { return 'failed'; }
}
