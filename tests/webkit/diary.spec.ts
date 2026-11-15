import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

for (const lang of ['de', 'en']) {
  test(`WebKit saves, reopens and exports actual PDF content: ${lang}`, async ({ page, context }) => {
    await page.goto(`?lang=${lang}`);
    await page.getByRole('button', { name: lang === 'de' ? 'Tagebuch beginnen' : 'Start my diary' }).click();
    const note = 'Synthetic walk across the bridge';
    await page.locator('#note').fill(note);
    await page.locator('#save-entry').click();
    await expect(page.locator('.entry-note')).toHaveText(note);
    await page.close();
    const reopened = await context.newPage();
    await reopened.goto('');
    await expect(reopened.locator('html')).toHaveAttribute('lang', lang);
    await expect(reopened.locator('.entry-note')).toHaveText(note);
    await reopened.locator('#export').click();
    const downloading = reopened.waitForEvent('download');
    await reopened.locator('#download-pdf').click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^holter-diary-.*\.pdf$/);
    const task = getDocument({ data: new Uint8Array(await readFile((await download.path())!)), standardFontDataUrl: fileURLToPath(new URL('./standard_fonts/', import.meta.resolve('pdfjs-dist/package.json'))) });
    try {
      const doc = await task.promise;
      const content = await (await doc.getPage(1)).getTextContent();
      const text = content.items.flatMap(item => 'str' in item ? [item.str] : []).join(' ');
      expect(text).toContain(note);
      expect(text).toContain(lang === 'de' ? 'Langzeit-EKG-Tagebuch' : 'Holter monitoring diary');
    } finally { await task.destroy(); }
  });
}

test('WebKit keeps a draft when a transaction aborts and retries without duplication', async ({ page }) => {
  await page.goto('');
  await page.getByRole('button', { name: 'Tagebuch beginnen' }).click();
  const note = 'Synthetic retained draft';
  await page.locator('#note').fill(note);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args: Parameters<IDBObjectStore['add']>) {
      const req = original.apply(this, args);
      if (this.name === 'entries') {
        IDBObjectStore.prototype.add = original;
        req.addEventListener('success', () => this.transaction.abort());
      }
      return req;
    };
  });
  await page.locator('#save-entry').click();
  await expect(page.locator('#error')).toContainText('Speichern fehlgeschlagen');
  await expect(page.locator('#note')).toHaveValue(note);
  await expect(page.locator('.entry')).toHaveCount(0);
  await page.locator('#save-entry').click();
  await expect(page.locator('.entry')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.entry-note')).toHaveText(note);
});
