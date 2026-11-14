import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const workerPath = 'dist/sw.js';
async function panel(page: import('@playwright/test').Page, id: string) {
  if (!await page.locator('#' + id).evaluate((el: HTMLDetailsElement) => el.open)) await page.locator('#' + id + '>summary').click();
}

test('update indicator is accessible, opens once on entry and preserves disclosure choices and drafts', async ({ page }) => {
  const original = await readFile(workerPath, 'utf8');
  try {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto(''); await page.locator('#start-diary').click();
    await expect(page.locator('#offline-badge')).toHaveText('Für Offline-Nutzung bereit');
    await expect(page.locator('#update-notice')).toBeHidden();
    await expect(page.locator('#settings')).toHaveAccessibleName('Einstellungen');
    await page.locator('#settings').click();
    await expect(page.locator('#update-settings')).toHaveAttribute('data-state', 'none');
    await expect(page.locator('#apply-update')).toBeHidden();
    await expect(page.locator('#update-settings')).not.toHaveAttribute('open');
    await writeFile(workerPath, original + '\n// Synthetic indicator update\n');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect(page.locator('#update-settings')).toHaveAttribute('data-state', 'available');
    // Incoming updates must not expand a panel or steal focus during an existing visit.
    await expect(page.locator('#update-settings')).not.toHaveAttribute('open');
    await expect(page.locator('#dialog-title')).toBeFocused();
    await expect(page.locator('#dialog-update-announcement')).toHaveText('Update verfügbar');
    await expect(page.locator('#update-announcement')).toBeEmpty();
    await page.locator('#close-dialog').click();
    await expect(page.locator('#settings')).toHaveAccessibleName('Einstellungen, Update verfügbar');
    await expect(page.locator('#update-notice svg')).toBeVisible();
    await expect(page.locator('#update-notice')).toHaveAttribute('aria-hidden', 'true');
    expect(await page.locator('#settings').evaluate(el => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#note').fill('Synthetic unsaved note');
    await page.locator('#settings').click();
    await expect(page.locator('#update-settings')).toHaveAttribute('open');
    await expect(page.locator('#dialog-title')).toBeFocused();
    expect(await page.locator('#dialog').evaluate(el => el.scrollTop)).toBe(0);
    await expect(page.locator('#apply-update')).toBeDisabled();
    await expect(page.locator('#update-blocked')).toBeVisible();
    await page.locator('#update-settings>summary').click();
    await panel(page, 'language-settings'); await page.locator('#language').selectOption('en');
    await expect(page.locator('#update-settings')).not.toHaveAttribute('open');
    await expect(page.locator('#update-status')).toHaveText('Update available');
    await panel(page, 'identity-settings'); await page.locator('#settings-name').fill('Synthetic name');
    await expect(page.locator('#update-settings')).not.toHaveAttribute('open');
    await page.locator('#save-identity').click();
    await expect(page.locator('#update-settings')).not.toHaveAttribute('open');
    expect(await page.locator('#dialog').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await panel(page, 'update-settings'); await page.locator('#return-note').click();
    await expect(page.locator('#note')).toHaveValue('Synthetic unsaved note');
    await expect(page.locator('#settings')).toHaveAccessibleName('Settings, Update available');
    await page.locator('#settings').click();
    await expect(page.locator('#update-settings')).toHaveAttribute('open');
  } finally { await writeFile(workerPath, original); }
});

test('update progress, timeout and retry are distinct and preserve saved records', async ({ page }) => {
  const original = await readFile(workerPath, 'utf8');
  try {
    await page.goto(''); await page.locator('#start-diary').click();
    await page.locator('#note').fill('Saved before retry'); await page.locator('#save-entry').click();
    await expect(page.locator('#offline-badge')).toHaveText('Für Offline-Nutzung bereit');
    await writeFile(workerPath, original + '\n// Synthetic retry presentation update\n');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect(page.locator('#update-notice')).toBeVisible();
    await page.locator('#settings').click();
    // Drop only the activation message once, so the real application timeout runs.
    await page.evaluate(() => {
      const send = ServiceWorker.prototype.postMessage;
      ServiceWorker.prototype.postMessage = function (message: { type?: string }, options?: StructuredSerializeOptions | Transferable[]) {
        if (message?.type === 'ACTIVATE_UPDATE') { ServiceWorker.prototype.postMessage = send; return; }
        return Reflect.apply(send, this, [message, options]);
      };
    });
    await page.clock.install();
    await page.locator('#apply-update').click();
    await expect(page.locator('#update-settings')).toHaveAttribute('data-state', 'applying');
    await expect(page.locator('#update-settings')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#apply-update')).toBeDisabled();
    await expect(page.locator('#apply-update')).toHaveText('Update wird übernommen …');
    await expect(page.locator('#close-dialog')).toBeDisabled();
    await page.clock.fastForward(10001);
    await expect(page.locator('#update-settings')).toHaveAttribute('data-state', 'failed');
    await expect(page.locator('#update-settings')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('#update-status')).toHaveText('Aktualisierung fehlgeschlagen');
    await expect(page.locator('#update-help')).toContainText('Versuche es erneut');
    await expect(page.locator('#apply-update')).toBeEnabled();
    await expect(page.locator('#apply-update')).toHaveText('Erneut versuchen');
    await expect(page.locator('#dialog-update-announcement')).toHaveText('Aktualisierung fehlgeschlagen');
    await page.locator('#apply-update').click();
    await expect(page.locator('#dialog')).toHaveCount(0);
    await expect(page.locator('.entry-note')).toHaveText('Saved before retry');
    await expect(page.locator('#update-notice')).toBeHidden();
    await page.locator('#settings').click();
    await expect(page.locator('#update-settings')).toHaveAttribute('data-state', 'none');
    await expect(page.locator('#apply-update')).toBeHidden();
  } finally { await writeFile(workerPath, original); }
});
