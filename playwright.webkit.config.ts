import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.WEBKIT_TEST_PORT ?? 4176);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid test port');
const url = `http://127.0.0.1:${port}/holter-diary/app/`;
export default defineConfig({
  testDir: './tests/webkit', workers: 1, retries: 0, reporter: 'list',
  use: { ...devices['iPhone 13'], browserName: 'webkit', baseURL: url, locale: 'de-DE', timezoneId: 'Europe/Berlin', trace: 'retain-on-failure' },
  webServer: {
    command: `npm run preview -- --host 127.0.0.1 --port ${port} --strictPort`,
    url, reuseExistingServer: false,
  },
});
