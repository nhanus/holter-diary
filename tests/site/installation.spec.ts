import { test, expect } from '@playwright/test';

for (const lang of ['de', 'en']) {
  test(`installation instructions keep both platforms accessible and preserve language: ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 650 });
    await page.goto(`./faq/?lang=${lang}#question-3`);
    const faq = page.locator('#question-3');
    await expect(faq).toHaveJSProperty('open', true);
    await faq.getByRole('link', { name: 'iPhone · Safari' }).click();
    await expect(page).toHaveURL(new RegExp(`/guide/\\?lang=${lang}#install-iphone$`));
    await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
    const iphone = page.locator('#install-iphone');
    const android = page.locator('#install-android');
    await expect(iphone).toHaveJSProperty('open', true);
    await expect(android).toHaveJSProperty('open', false);
    const androidSummary = android.locator('summary');
    await androidSummary.focus();
    await page.keyboard.press('Enter');
    await expect(android).toHaveJSProperty('open', true);
    for (const platform of ['android', 'iphone']) {
      const section = page.locator(`#install-${platform}`);
      await expect(section).toBeVisible();
      await expect(section.locator('summary')).toHaveText(platform === 'android' ? 'Android' : 'iPhone · Safari');
      await expect(section.locator('ol > li')).toHaveCount(platform === 'android' ? 3 : 4);
      expect(await section.locator('li').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);
    }
    await expect(iphone).toContainText(lang === 'de' ? 'Als Web-App öffnen' : 'Open as Web App');
    await expect(iphone).toContainText(lang === 'de' ? 'Aktionen bearbeiten' : 'Edit Actions');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const other = lang === 'de' ? 'en' : 'de';
    await page.getByRole('link', { name: other.toUpperCase(), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`lang=${other}#install-iphone$`));
    await expect(iphone).toHaveJSProperty('open', true);
    await expect(android).toHaveJSProperty('open', false);
    await expect(page.locator('html')).toHaveAttribute('lang', other);
    await page.getByRole('link', { name: other === 'de' ? 'App öffnen' : 'Open app', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', other);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  });
}
