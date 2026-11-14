import { test, expect } from '@playwright/test';

test('the bilingual landing page, guide and FAQ link together on narrow phones', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 650 });
  const noOverflow = async () => {
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  };

  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Dein Tag.\s*Gut festgehalten\./);
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('link', { name: 'App öffnen' })).toHaveAttribute('href', './app/?lang=de');
  await noOverflow();

  await page.getByRole('link', { name: 'EN', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Your day.\s*Clearly recorded\./);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await noOverflow();
  await page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: 'Guide' }).click();
  await expect(page).toHaveURL(/\/guide\/\?lang=en$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ready in a few steps.');
  await noOverflow();
  await page.getByRole('navigation', { name: 'On this page' }).getByRole('link', { name: 'Export & updates' }).click();
  await expect(page).toHaveURL(/\/guide\/\?lang=en#step-5$/);
  await page.getByRole('link', { name: 'DE', exact: true }).click();
  await expect(page).toHaveURL(/\/guide\/\?lang=de#step-5$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('In wenigen Schritten startklar.');
  await noOverflow();

  const navigation = page.getByRole('navigation', { name: 'Hauptnavigation' });
  await navigation.getByRole('link', { name: 'FAQ' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gut zu wissen.');
  await noOverflow();
  await navigation.getByRole('link', { name: 'Über die App' }).click();
  await page.getByRole('link', { name: 'Was bedeutet das für meine Daten?' }).click();
  await expect(page).toHaveURL(/\/faq\/\?lang=de#question-5$/);
  await expect(page.locator('#question-5')).toHaveJSProperty('open', true);
  await page.getByRole('link', { name: 'EN', exact: true }).click();
  await expect(page).toHaveURL(/\/faq\/\?lang=en#question-5$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Good to know.');
  await expect(page.locator('#question-5')).toHaveJSProperty('open', true);
  await noOverflow();
  await page.getByRole('link', { name: 'Read the guide' }).click();
  await expect(page).toHaveURL(/\/guide\/\?lang=en$/);
});

test('only the diary exposes install metadata and it adopts and saves the website language', async ({ page, context }) => {
  await page.goto('./?lang=en');
  await expect(page.locator('link[rel="manifest"]')).toHaveCount(0);
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  await page.getByRole('link', { name: 'Open app' }).click();
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.getByRole('button', { name: 'Start my diary' })).toBeVisible();
  await page.goto('./app/');
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('button', { name: 'Start my diary' })).toBeVisible();

  const app = new URL(page.url());
  const legacyIdentity = new URL('/', app).href;
  const manifestURL = new URL('../manifest.webmanifest', app).href;
  const cdp = await context.newCDPSession(page);
  const { url, errors, manifest } = await cdp.send('Page.getAppManifest');
  expect(url).toBe(manifestURL);
  expect(errors).toEqual([]);
  expect(manifest).toMatchObject({ id: legacyIdentity, scope: app.href, startUrl: app.href, display: 'kStandalone' });

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.locator('#language-settings > summary').click();
  await page.locator('#language').selectOption('de');
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Tagebuch beginnen' })).toBeVisible();
});

test('a legacy online standalone launch opens the diary and keeps its selected language', async ({ page }) => {
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = query => {
      const result = matchMedia(query);
      if (query.includes('display-mode: standalone')) Object.defineProperty(result, 'matches', { value: true });
      return result;
    };
  });
  await page.goto('./?lang=en');
  await expect(page).toHaveURL(/\/app\/$/);
  await expect(page.getByRole('button', { name: 'Start my diary' })).toBeVisible();
});

test('an offline old root launch preserves diary records, and documentation always uses the network', async ({ page, context }) => {
  await page.goto('./app/');
  await page.getByRole('button', { name: 'Tagebuch beginnen' }).click();
  const note = 'Synthetic observation before an offline launch';
  await page.getByRole('textbox', { name: 'Notiz', exact: true }).fill(note);
  await page.getByRole('button', { name: 'Eintrag speichern' }).click();
  await expect(page.locator('.entry-note')).toHaveText(note);
  await expect(page.locator('#offline-badge')).toHaveText('Für Offline-Nutzung bereit');
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);

  const documentation = ['guide/', 'faq/'];
  const cachedPaths = await page.evaluate(async paths => {
    const prefix = 'holter-diary:' + new URL('../', location.href).href + ':';
    const legacyName = prefix + 'legacy';
    const legacyCache = await caches.open(legacyName);
    for (const path of paths) {
      await legacyCache.put(new URL('../' + path, location.href), new Response('Stale page', {
        headers: { 'Content-Type': 'text/html' },
      }));
    }
    const cacheNames = (await caches.keys()).filter(name => name.startsWith(prefix) && name !== legacyName);
    const requests = await Promise.all(cacheNames.map(async name => (await caches.open(name)).keys()));
    return requests.flat().map(request => new URL(request.url).pathname);
  }, ['', 'index.html', ...documentation]);
  expect(cachedPaths).toContain('/holter-diary/app/index.html');
  for (const path of ['', 'index.html', 'site.js', 'style.css', ...documentation, 'guide/index.html', 'faq/index.html']) {
    expect(cachedPaths).not.toContain('/holter-diary/' + path);
  }

  for (const [path, title] of [
    ['./', /Dein Tag./],
    ['./guide/', 'In wenigen Schritten startklar.'],
    ['./faq/', 'Gut zu wissen.'],
  ] as const) {
    const response = await page.goto(path);
    expect(response?.ok()).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
  }

  await context.setOffline(true);
  for (const path of ['./', './index.html']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/app\/$/);
    await expect(page.locator('.entry-note')).toHaveText(note);
  }

  for (const path of documentation) {
    const newTab = await context.newPage();
    await expect(newTab.goto('./' + path)).rejects.toThrow(/net::ERR_/);
    await newTab.close();
  }
});

test('first visits follow the browser while only explicit language choices persist', async ({ browser, baseURL }) => {
  for (const [locale, expected] of [['en-GB', 'en'], ['de-AT', 'de'], ['fr-FR', 'en']]) {
    const context = await browser.newContext({ locale });
    try {
      const page = await context.newPage(); await page.goto(baseURL!);
      await expect(page.locator('html')).toHaveAttribute('lang', expected);
      expect(await page.evaluate(() => localStorage.getItem('holter-diary:website-language'))).toBeNull();
      await page.locator('.main-nav a').nth(1).click();
      expect(new URL(page.url()).search).toBe('');
      expect(await page.evaluate(() => localStorage.getItem('holter-diary:website-language'))).toBeNull();
      await page.evaluate(() => localStorage.setItem('holter-diary:website-language', 'invalid'));
      await page.goto(baseURL! + '?lang=invalid');
      await expect(page.locator('html')).toHaveAttribute('lang', expected);
      await page.getByRole('link', { name: 'DE', exact: true }).click();
      await page.goto(baseURL!);
      await expect(page.locator('html')).toHaveAttribute('lang', 'de');
      const returning = await context.newPage(); await returning.goto(baseURL! + 'faq/');
      await expect(returning.locator('html')).toHaveAttribute('lang', 'de');
      await returning.goto(baseURL! + '?lang=en');
      await returning.goto(baseURL! + '?lang=invalid');
      await expect(returning.locator('html')).toHaveAttribute('lang', 'en');
      await returning.reload(); await expect(returning.locator('html')).toHaveAttribute('lang', 'en');
    } finally { await context.close(); }
  }
});

test('blocked website preference storage does not prevent language switching or app handoff', async ({ browser, baseURL }) => {
  const context = await browser.newContext({ locale: 'en-US' });
  try {
    await context.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } }));
    const page = await context.newPage(); const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(baseURL!); await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await page.getByRole('link', { name: 'DE', exact: true }).click();
    await page.locator('.main-nav a').nth(1).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await page.getByRole('link', { name: 'App öffnen' }).click();
    await expect(page.locator('#start-diary')).toHaveText('Tagebuch beginnen');
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
