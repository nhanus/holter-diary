import { defineConfig, devices } from '@playwright/test';
const port = Number(process.env.APP_TEST_PORT ?? 4174);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid test port');
const host = process.env.TEST_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
const url = `http://127.0.0.1:${port}/holter-diary/`;
export default defineConfig({
  testDir: './tests/app', workers: 1, retries: 0, reporter: 'list',
  use: { ...devices['Pixel 7'], browserName: 'chromium', baseURL: url, locale: 'de-DE', timezoneId: 'Europe/Berlin', trace: 'retain-on-failure' },
  webServer: { command: `npm run preview -- --host ${host} --port ${port} --strictPort`, url, reuseExistingServer: false },
});
