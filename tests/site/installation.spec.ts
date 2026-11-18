import { test, expect } from '@playwright/test';

for (const lang of ['de', 'en']) {
  test(`both installation sections stay visible and preserve deep links: ${lang}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 650 });
    await page.goto(`./guide/?lang=${lang}`);
    await page.evaluate(() => { document.documentElement.style.fontSize = '24px'; });
    const iphone = page.locator('#install-iphone');
    const android = page.locator('#install-android');
    for (const [section, title, count] of [[android, 'Android', 3], [iphone, 'iPhone · Safari', 4]] as const) {
      await expect(section.getByRole('heading', { name: title })).toBeVisible();
      const steps = section.getByRole('listitem');
      await expect(steps).toHaveCount(count);
      for (const step of await steps.all()) await expect(step).toBeVisible();
      expect(await steps.first().evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(24);
    }
    await expect(iphone).toContainText(lang === 'de' ? 'Als Web-App öffnen' : 'Open as Web App');
    await expect(iphone).toContainText(lang === 'de' ? 'Aktionen bearbeiten' : 'Edit Actions');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('link', { name: 'Android', exact: true }).press('Enter');
    await expect(page).toHaveURL(/#install-android$/);

    await page.goto(`./faq/?lang=${lang}#question-3`);
    const faq = page.locator('#question-3');
    await expect(faq).toHaveJSProperty('open', true);
    await faq.getByRole('link', { name: 'iPhone · Safari' }).click();
    await expect(page).toHaveURL(new RegExp(`/guide/\\?lang=${lang}#install-iphone$`));
    await expect(android.getByRole('listitem').first()).toBeVisible();
    await expect(iphone.getByRole('listitem').first()).toBeVisible();
    const other = lang === 'de' ? 'en' : 'de';
    await page.getByRole('link', { name: other.toUpperCase(), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`lang=${other}#install-iphone$`));
    await expect(iphone.getByRole('listitem').first()).toBeVisible();
    await expect(android.getByRole('listitem').first()).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', other);
    await page.getByRole('link', { name: other === 'de' ? 'App öffnen' : 'Open app', exact: true }).click();
    await expect(page).toHaveURL(/\/app\/$/);
    await expect(page.locator('html')).toHaveAttribute('lang', other);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  });
}
