import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function savedEntries(page: Page) {
  return page.evaluate(() => new Promise<Array<{ id: string; note: string }>>((resolve, reject) => {
    const r = indexedDB.open('holter-diary'); r.onerror = () => reject(r.error);
    r.onsuccess = () => { const db = r.result; const get = db.transaction('entries').objectStore('entries').getAll(); get.onsuccess = () => { db.close(); resolve(get.result); }; };
  }));
}
async function resetDialog(page: Page) { await page.locator('#settings').click(); await page.locator('#reset-diary').click(); }

test('reset confirmation reads entries saved elsewhere before opening and enables export', async ({ page, context }) => {
  await page.goto(''); await page.locator('#start-diary').click();
  const other = await context.newPage(); await other.goto('');
  await other.locator('#note').fill('Synthetic entry from another tab'); await other.locator('#save-entry').click();
  await resetDialog(page); await expect(page.locator('#dialog')).toContainText('1 Einträge');
  await expect(page.locator('#export-before-reset')).toBeEnabled();
  await page.locator('#export-before-reset').click(); const download = page.waitForEvent('download');
  await page.locator('#download-text').click(); const file = await download;
  const { readFile } = await import('node:fs/promises');
  expect(await readFile((await file.path())!, 'utf8')).toContain('Synthetic entry from another tab');
});

for (const change of ['add', 'edit', 'delete', 'replace'] as const) {
  test(`reset rejects a concurrent ${change} after confirmation opens and preserves the local draft`, async ({ page, context }) => {
    await page.goto(''); await page.locator('#start-diary').click();
    await page.locator('#note').fill('Synthetic original'); await page.locator('#save-entry').click();
    const other = await context.newPage(); await other.goto('');
    await page.locator('#note').fill('Synthetic unfinished draft'); await resetDialog(page);
    await expect(page.locator('#dialog')).toContainText('1 Einträge');
    if (change !== 'add') {
      await other.locator('.entry-button').click();
      if (change === 'edit') { await other.locator('#note').fill('Synthetic edited'); await other.locator('#save-entry').click(); }
      else { other.once('dialog', d => d.accept()); await other.locator('#delete-entry').click(); }
    }
    if (change === 'add' || change === 'replace') { await other.locator('#note').fill('Synthetic new'); await other.locator('#save-entry').click(); }
    const before = await savedEntries(other);
    await page.locator('#confirm-reset').click();
    await expect(page.locator('#dialog-error')).toContainText('anderen Fenster');
    expect(await savedEntries(page)).toEqual(before);
    await page.locator('#close-dialog').click(); await page.locator('#close-dialog').click();
    await expect(page.locator('#note')).toHaveValue('Synthetic unfinished draft');
    // Reopen to review a fresh snapshot, then explicitly consent again.
    await resetDialog(page); await expect(page.locator('#dialog')).toContainText(`${before.length} Einträge`);
    await page.locator('#confirm-reset').click(); await expect(page.locator('#start-diary')).toBeVisible();
    expect(await savedEntries(page)).toEqual([]);
  });
}
