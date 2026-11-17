import { test, expect } from '@playwright/test';

for (const lang of ['de', 'en']) {
  test(`FAQ update steps and everyday help stay readable and linked with enlarged text: ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 650 });
    await page.goto(`./faq/?lang=${lang}#question-10`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
    const update = page.locator('#question-10');
    await expect(update).toHaveJSProperty('open', true);
    await expect(update.locator('ol > li')).toHaveCount(6);
    await expect(update).toContainText(lang === 'de' ? 'nicht unbedingt' : 'not necessarily');
    await expect(update).toContainText(lang === 'de' ? 'App neu laden' : 'Reload app');
    await expect(update).toContainText(lang === 'de' ? 'Wenn das Ziehen nichts bewirkt' : 'If pulling down does nothing');
    expect(await update.locator('.faq-answer').evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);
    // Native disclosures remain keyboard-operable and all original anchors survive.
    const summary = update.locator('summary'); await summary.focus(); await page.keyboard.press('Enter');
    await expect(update).toHaveJSProperty('open', false);
    const shortcut = page.getByRole('link', { name: lang === 'de' ? 'App Schritt für Schritt aktualisieren' : 'Update the app step by step' });
    await shortcut.focus(); await page.keyboard.press('Enter');
    await expect(update).toHaveJSProperty('open', true);
    await expect(page.locator('.faq-group details')).toHaveCount(16);
    const topics = page.getByRole('navigation', { name: lang === 'de' ? 'Auf dieser Seite' : 'On this page' });
    await expect(topics.getByRole('link')).toHaveCount(3);
    await topics.getByRole('link', { name: lang === 'de' ? 'Daten & Protokoll' : 'Data & reports' }).click();
    await expect(page).toHaveURL(/#faq-data$/);
    await expect(page.locator('#faq-data #question-15')).toBeVisible();
    await shortcut.click();
    await expect(page).toHaveURL(/#question-10$/);
    for (let i = 1; i <= 16; i++) await expect(page.locator(`#question-${i}`)).toHaveCount(1);
    await page.evaluate(() => { document.querySelectorAll('details').forEach(el => { el.open = true; }); });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const other = lang === 'de' ? 'en' : 'de';
    await page.getByRole('link', { name: other.toUpperCase(), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`lang=${other}#question-10$`));
    await expect(page.locator('#question-10')).toHaveJSProperty('open', true);
    await page.goto(`./guide/?lang=${lang}`);
    await page.getByRole('link', { name: lang === 'de' ? 'App Schritt für Schritt aktualisieren' : 'Update the app step by step' }).click();
    await expect(page).toHaveURL(new RegExp(`/faq/\\?lang=${lang}#question-10$`));
    await expect(page.locator('#question-10')).toHaveJSProperty('open', true);
  });
}
