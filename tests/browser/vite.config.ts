import { defineConfig } from 'vite';

export default defineConfig({
  base: '/holter-diary/',
  build: {
    outDir: '.test-build',
    rollupOptions: { input: 'tests/browser/fixture.html' },
  },
});
