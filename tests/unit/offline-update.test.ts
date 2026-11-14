import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OfflineApp } from '../../src/offline.ts';

test('a missing or unusable update never leaves activation in progress', () => {
  const app = new OfflineApp(() => {}, () => true);
  assert.equal(app.applyUpdate(), false);
  assert.equal(app.updateStatus, 'failed');
  app.registration = { waiting: { state: 'installed', postMessage: () => { throw new Error('Synthetic channel failure'); } } } as unknown as ServiceWorkerRegistration;
  assert.equal(app.applyUpdate(), false);
  assert.equal(app.updateStatus, 'failed');
});

test('an unresponsive update restores the normal state and allows retry', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] });
  let sent = 0;
  const app = new OfflineApp(() => {}, () => true);
  app.registration = { waiting: { state: 'installed', postMessage: () => { sent++; } } } as unknown as ServiceWorkerRegistration;
  assert.equal(app.applyUpdate(), true);
  assert.equal(app.updateStatus, 'applying');
  assert.equal(app.applyUpdate(), false);
  assert.equal(sent, 1);
  context.mock.timers.tick(10000);
  assert.equal(app.updateStatus, 'failed');
  assert.equal(app.applyUpdate(), true);
  assert.equal(sent, 2);
  context.mock.timers.tick(10000);
  assert.equal(app.updateStatus, 'failed');
});


test('activation and reload both recheck whether input is safe to leave', () => {
  let allowed = false, sent = 0;
  const app = new OfflineApp(() => {}, () => allowed);
  app.registration = { waiting: { state: 'installed', postMessage: () => { sent++; } } } as unknown as ServiceWorkerRegistration;
  assert.equal(app.applyUpdate(), false); assert.equal(sent, 0); assert.equal(app.updateStatus, 'idle');
  app.updateStatus = 'reload-required';
  assert.equal(app.applyUpdate(), false); assert.equal(app.updateStatus, 'reload-required');
  allowed = true;
  // A missing waiting worker remains a failure when no activated update was seen.
  app.updateStatus = 'idle'; app.registration = undefined;
  assert.equal(app.applyUpdate(), false); assert.equal(app.updateStatus, 'failed');
});
