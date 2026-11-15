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
    for (const platform of ['android', 'iphone']) {
      const section = page.locator(`#install-${platform}`);
      await expect(section).toBeVisible();
      await expect(section.locator('h3')).toHaveText(platform === 'android' ? 'Android' : 'iPhone · Safari');
      await expect(section.locator('ol > li')).toHaveCount(platform === 'android' ? 3 : 4);
      expect(await section.locator('li').first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);
    }
    const iphone = page.locator('#install-iphone');
    await expect(iphone).toContainText(lang === 'de' ? 'Als Web-App öffnen' : 'Open as Web App');
    await expect(iphone).toContainText(lang === 'de' ? 'Aktionen bearbeiten' : 'Edit Actions');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const android = page.getByRole('link', { name: 'Android', exact: true });
    await android.focus(); await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#install-android$/);
    const other = lang === 'de' ? 'en' : 'de';
    await page.getByRole('link', { name: other.toUpperCase(), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`lang=${other}#install-android$`));
    await expect(page.locator('html')).toHaveAttribute('lang', other);
    await page.getByRole('link', { name: other === 'de' ? 'App öffnen' : 'Open app', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', other);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  });
}
