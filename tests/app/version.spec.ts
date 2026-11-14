import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
const { version } = JSON.parse(await readFile('package.json', 'utf8'));

test('installed version stays tied to the running offline app in both languages and while an update waits', async ({ page, context }) => {
  const workerPath = 'dist/sw.js', original = await readFile(workerPath, 'utf8');
  try {
    await page.goto(''); await page.locator('#start-diary').click();
    await page.locator('#note').fill('Synthetic version check'); await page.locator('#save-entry').click();
    await expect(page.locator('#offline-badge')).toHaveText('Für Offline-Nutzung bereit');
    await page.locator('#settings').click();
    await expect(page.locator('#installed-version')).toHaveText(`Installierte Version: ${version}`);
    await expect(page.locator('#installed-version')).toBeVisible();
    const manifest = JSON.parse(await readFile('dist/version.json', 'utf8'));
    expect(manifest.version).toBe(version);
    expect(original).toContain('version.json');
    await writeFile(workerPath, original + '\n// Synthetic version-display update\n');
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.update());
    await expect(page.locator('#update-status')).toHaveText('Update verfügbar');
    await expect(page.locator('#installed-version')).toHaveText(`Installierte Version: ${version}`);
    await page.locator('#language-settings>summary').click(); await page.locator('#language').selectOption('en');
    await expect(page.locator('#installed-version')).toHaveText(`Installed version: ${version}`);
    await page.locator('#close-dialog').click();
    await context.setOffline(true); await page.reload();
    await expect(page.locator('.entry-note')).toHaveText('Synthetic version check');
    await page.locator('#settings').click();
    await expect(page.locator('#installed-version')).toHaveText(`Installed version: ${version}`);
  } finally { await writeFile(workerPath, original); }
});
