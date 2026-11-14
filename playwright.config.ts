import { defineConfig, devices } from '@playwright/test';

const port = Number(process.env.TEST_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid test port');
const host = process.env.TEST_HOST === '0.0.0.0' ? '0.0.0.0' : '127.0.0.1';
const url = `http://127.0.0.1:${port}/holter-diary/tests/browser/fixture.html`;

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '*.spec.ts',
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: { ...devices['Pixel 7'], browserName: 'chromium', baseURL: url, trace: 'retain-on-failure' },
  webServer: {
    command: `npm run test:serve -- --host ${host} --port ${port} --strictPort`,
    url,
    reuseExistingServer: false,
  },
});
