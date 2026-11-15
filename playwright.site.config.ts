import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.SITE_TEST_PORT ?? 4175);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid test port');
const host = process.env.TEST_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
const url = `http://127.0.0.1:${port}/holter-diary/`;

export default defineConfig({
  testDir: './tests/site',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { baseURL: url, locale: 'de-DE', trace: 'retain-on-failure' },
  projects: [
    { name: 'chromium', use: { ...devices['Pixel 7'] } },
    { name: 'webkit', testMatch: /(?:installation|faq-help)\.spec\.ts/, use: { ...devices['iPhone 13'], browserName: 'webkit' } },
  ],
  webServer: {
    command: `npm run preview -- --dir site-dist --host ${host} --port ${port} --strictPort`,
    url,
    reuseExistingServer: false,
  },
});
