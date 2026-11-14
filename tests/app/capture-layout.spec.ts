import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

async function settle(page: Page) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
async function start(page: Page) { await page.goto(''); await page.locator('#start-diary').click(); }

for (const mode of ['layout', 'overlay']) for (const width of [320, 393]) for (const large of [false, true]) {
  test(`capture remains stable while scrolling and resizing: ${mode}, ${width}px, large=${large}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 720 });
    // Model browsers whose keyboard only shrinks the visual viewport. This is
    // geometry coverage, not a claim about a physical device's keyboard.
    if (mode === 'overlay') await page.addInitScript(() => {
      const viewport = Object.assign(new EventTarget(), { height: innerHeight, width: innerWidth, offsetTop: 0, offsetLeft: 0, scale: 1 });
      Object.defineProperty(window, 'visualViewport', { value: viewport });
    });
    await start(page);
    if (large) await page.addStyleTag({ content: 'html { font-size: 24px; }' });
    await page.evaluate(() => scrollTo(0, 0));
    const initial = await page.locator('#save-entry').boundingBox();
    await page.locator('#note').focus(); await settle(page);
    expect(await page.locator('#save-entry').boundingBox()).toEqual(initial);
    await page.locator('#note').fill('Synthetic draft retained during scrolling'); await settle(page);
    expect(await page.locator('#save-entry').boundingBox()).toEqual(initial);
    const original = await page.locator('#note').elementHandle();
    await page.locator('#note').evaluate((el: HTMLTextAreaElement) => el.setSelectionRange(2, 7));
    if (mode === 'layout') await page.setViewportSize({ width, height: 320 });
    else await page.evaluate(() => { Object.assign(visualViewport!, { height: 320 }); visualViewport!.dispatchEvent(new Event('resize')); });
    await settle(page);
    const field = await page.locator('#note').boundingBox(), actions = await page.locator('.capture-actions').boundingBox();
    expect(field!.y + field!.height).toBeLessThanOrEqual(actions!.y - 11);
    expect(actions!.y + actions!.height).toBeLessThanOrEqual(320);
    const boundary = await page.locator('.inline-composer').evaluate(el => el.getBoundingClientRect().bottom + scrollY - 320);
    const gaps: number[] = [];
    for (const delta of [-35, -20, 0, 20, 35, 20, 0, -20, -35]) {
      const intended = Math.round(boundary + delta);
      await page.evaluate(y => scrollTo(0, y), intended); await settle(page);
      await page.evaluate(() => visualViewport!.dispatchEvent(new Event('scroll'))); await settle(page);
      const state = await page.evaluate(() => {
        const card = document.querySelector('.inline-composer')!.getBoundingClientRect();
        const save = document.querySelector('#save-entry')!.getBoundingClientRect();
        const note = document.querySelector<HTMLTextAreaElement>('#note')!;
        return { scroll: scrollY, gap: Math.min(card.bottom - 1, visualViewport!.height) - save.bottom, selection: [note.selectionStart, note.selectionEnd] };
      });
      expect(state.scroll).toBe(intended); gaps.push(state.gap); expect(state.selection).toEqual([2, 7]);
    }
    expect(Math.max(...gaps) - Math.min(...gaps)).toBeLessThan(1);
    expect(await original!.evaluate(el => el === document.querySelector('#note'))).toBe(true);
    const scroll = await page.evaluate(() => scrollY);
    await page.evaluate(() => visualViewport!.dispatchEvent(new Event('resize'))); await settle(page);
    expect(await page.evaluate(() => scrollY)).toBe(scroll);
    await page.locator('#entry-kind').check();
    await page.locator('#entry-time-details > summary').click();
    await page.locator('#entry-time').fill('2028-02-03T10:17'); await settle(page);
    const time = await page.locator('#entry-time').boundingBox(), footer = await page.locator('.capture-actions').boundingBox();
    expect(time!.y + time!.height).toBeLessThanOrEqual(footer!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('#save-entry').click(); await expect(page.locator('.entry')).toHaveCount(1);
    await expect(page.locator('.entry-note')).toHaveText('Synthetic draft retained during scrolling');
    await expect(page.locator('.entry-time strong')).toHaveText('10:17:00');
    // Existing-entry editing uses the same visible keyboard area.
    await page.locator('.entry-button').click();
    await page.locator('#note').fill('Synthetic edited note'); await settle(page);
    const editActions = await page.locator('.capture-actions').boundingBox();
    expect(editActions!.y + editActions!.height).toBeLessThanOrEqual(320);
    await page.locator('#entry-time').focus(); await settle(page);
    const editorTime = await page.locator('#entry-time').boundingBox(), editorFooter = await page.locator('.capture-actions').boundingBox();
    expect(editorTime!.y + editorTime!.height).toBeLessThanOrEqual(editorFooter!.y);
    await page.locator('#save-entry').click(); await expect(page.locator('.entry-note')).toHaveText('Synthetic edited note');
  });
}

test('header stays above capture controls and settings retain an unfinished note', async ({ page }) => {
  await page.setViewportSize({ width: 393, height: 700 }); await start(page);
  for (let i = 0; i < 5; i++) { await page.locator('#note').fill(`Synthetic record ${i}`); await page.locator('#save-entry').click(); }
  for (const size of [16, 24]) {
    await page.evaluate(size => document.documentElement.style.fontSize = `${size}px`, size);
    await page.locator('#note').fill('Unfinished draft');
    await page.evaluate(() => scrollTo(0, scrollY + document.querySelector('#save-entry')!.getBoundingClientRect().top - 20)); await settle(page);
    expect(await page.evaluate(() => {
      const save = document.querySelector('#save-entry')!.getBoundingClientRect();
      return !!document.elementFromPoint(save.x + save.width / 2, 40)?.closest('.topbar');
    })).toBe(true);
    await page.locator('#settings').click(); await expect(page.locator('#dialog')).toBeVisible();
    await page.locator('#close-dialog').click(); await expect(page.locator('#note')).toHaveValue('Unfinished draft');
  }
});
