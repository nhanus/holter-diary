import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { readFile, writeFile, readdir, copyFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const workerPath = 'dist/sw.js';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));
const nextVersion = '0.1.0-beta.999';

// Build a distinct synthetic version, including matching asset integrity and cache.
async function nextBuild() {
  const scripts = (await readdir('dist/app/assets')).filter(x => x.endsWith('.js')).map(x => 'dist/app/assets/' + x);
  const paths = [...scripts, 'dist/app/version.json', workerPath];
  const originals = new Map(await Promise.all(paths.map(async path => [path, await readFile(path, 'utf8')] as const)));
  const restore = async () => { for (const [path, content] of originals) await writeFile(path, content); };
  try {
    expect(scripts.some(path => originals.get(path)!.includes(version))).toBe(true);
    for (const path of scripts) await writeFile(path, originals.get(path)!.replaceAll(version, nextVersion));
    await writeFile('dist/app/version.json', JSON.stringify({ version: nextVersion }));
    await copyFile('dist/manifest.webmanifest', 'dist/app/manifest.webmanifest');
    execFileSync(process.execPath, ['scripts/build-offline.mjs']);
    return restore;
  } catch (error) { await restore(); throw error; }
}
async function start(page: Page) {
  await page.goto(''); await page.locator('#start-diary').click();
  await page.locator('#note').fill('Synthetic saved record'); await page.locator('#save-entry').click();
  await expect(page.locator('#offline-badge')).toHaveText('Für Offline-Nutzung bereit');
}
async function waitForUpdate(page: Page) {
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
  await expect(page.locator('#update-notice')).toBeVisible(); await page.locator('#settings').click();
}
async function holdActivation(page: Page) {
  await page.evaluate(() => {
    const send = ServiceWorker.prototype.postMessage;
    ServiceWorker.prototype.postMessage = function (message, options) {
      if (message?.type === 'ACTIVATE_UPDATE') {
        ServiceWorker.prototype.postMessage = send;
        (window as unknown as { releaseActivation: () => void }).releaseActivation = () => Reflect.apply(send, this, [message, options]); return;
      }
      return Reflect.apply(send, this, [message, options]);
    };
  });
}
async function releaseActivation(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => {
    navigator.serviceWorker.addEventListener('controllerchange', () => resolve(), { once: true });
    (window as unknown as { releaseActivation: () => void }).releaseActivation();
  }));
}
async function expectReloadRequired(page: Page) {
  await expect(page.locator('#update-settings')).toHaveAttribute('data-state', 'reload-required');
  await expect(page.locator('#apply-update')).toHaveText('App neu laden');
  expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())!.waiting)).toBe(false);
}

test('late activation of a different version preserves a new draft and offers a guarded reload', async ({ page, context }) => {
  await start(page); const restore = await nextBuild();
  try {
    await waitForUpdate(page); await holdActivation(page); await page.clock.install();
    await page.locator('#apply-update').click(); await page.clock.fastForward(10001);
    await expect(page.locator('#update-settings')).toHaveAttribute('data-state', 'failed');
    await page.locator('#close-dialog').click(); await page.locator('#note').fill('Draft after timeout');
    await releaseActivation(page); await expect(page.locator('#note')).toHaveValue('Draft after timeout');
    await page.locator('#settings').click(); await expectReloadRequired(page);
    await expect(page.locator('#installed-version')).toContainText(version);
    await expect(page.locator('#apply-update')).toBeDisabled(); await expect(page.locator('#update-blocked')).toBeVisible();
    await page.locator('#return-note').click(); await page.locator('#save-entry').click();
    await page.locator('#settings').click(); await expect(page.locator('#apply-update')).toBeEnabled();
    await page.locator('#apply-update').click(); await expect(page.locator('#note')).toBeVisible();
    await page.locator('#settings').click(); await expect(page.locator('#installed-version')).toContainText(nextVersion);
    await expect(page.locator('#update-settings')).toHaveAttribute('data-state', 'none');
    await page.locator('#close-dialog').click(); await context.setOffline(true); await page.reload();
    await expect(page.locator('.entry-note')).toHaveText(['Draft after timeout', 'Synthetic saved record']);
  } finally { await restore(); }
});

test('settings edited while activation is pending prevent automatic reload', async ({ page }) => {
  await start(page); const restore = await nextBuild();
  try {
    await waitForUpdate(page); await holdActivation(page); await page.locator('#apply-update').click();
    await page.locator('#identity-settings>summary').click(); await page.locator('#settings-name').fill('Unsaved synthetic identity');
    expect(await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
    await releaseActivation(page); await expectReloadRequired(page);
    await expect(page.locator('#settings-name')).toHaveValue('Unsaved synthetic identity');
    await expect(page.locator('#apply-update')).toBeDisabled();
    await page.locator('#save-identity').click(); await expect(page.locator('#apply-update')).toBeEnabled();
    await page.locator('#apply-update').click(); await expect(page.locator('#note')).toBeVisible();
    await page.locator('#settings').click(); await expect(page.locator('#installed-version')).toContainText(nextVersion);
    await expect(page.locator('#identity-settings>summary')).toContainText('Unsaved synthetic identity');
  } finally { await restore(); }
});

test('activation in another tab preserves this tab draft and exposes reload without a waiting worker', async ({ page, context }) => {
  await start(page); const other = await context.newPage(); await other.goto('');
  await page.locator('#note').fill('Draft in original tab'); const restore = await nextBuild();
  try {
    await waitForUpdate(other); await other.locator('#apply-update').click();
    await expect(other.locator('#note')).toBeVisible();
    await expect(page.locator('#note')).toHaveValue('Draft in original tab');
    await page.locator('#settings').click(); await expectReloadRequired(page);
    await expect(page.locator('#apply-update')).toBeDisabled();
    await page.locator('#return-note').click(); await page.locator('#save-entry').click();
    await page.locator('#settings').click(); await page.locator('#apply-update').click();
    await expect(page.locator('#note')).toBeVisible(); await page.locator('#settings').click();
    await expect(page.locator('#installed-version')).toContainText(nextVersion);
  } finally { await restore(); }
});
