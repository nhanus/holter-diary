import { test } from 'node:test';
import assert from 'node:assert/strict';
import { persistenceStatus } from '../../src/persistence.ts';

test('checks permission without requesting it on load', async () => {
  let requests = 0;
  const api = { persisted: async () => false, persist: async () => { requests++; return true; } };
  assert.equal(await persistenceStatus(false, api), 'not-granted');
  assert.equal(requests, 0);
});

test('existing grant is rechecked without repeated permission requests', async () => {
  const api = { persisted: async () => true, persist: async () => { throw Error('must not request'); } };
  assert.equal(await persistenceStatus(true, api), 'granted');
});

test('grant is reported only after the browser confirms the persisted state', async () => {
  let granted = false;
  const api = { persisted: async () => granted, persist: async () => (granted = true) };
  assert.equal(await persistenceStatus(true, api), 'granted');
  assert.equal(await persistenceStatus(true, { persisted: async () => false, persist: async () => true }), 'denied');
});

test('refusal, missing APIs and failure are distinct', async () => {
  assert.equal(await persistenceStatus(true, { persisted: async () => false, persist: async () => false }), 'denied');
  assert.equal(await persistenceStatus(false, undefined), 'unavailable');
  assert.equal(await persistenceStatus(true, { persisted: async () => { throw Error('unavailable storage'); }, persist: async () => false }), 'failed');
});
