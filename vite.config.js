import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { releaseVersion } from './scripts/release.mjs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url)));
const lock = JSON.parse(readFileSync(new URL('./package-lock.json', import.meta.url)));
const version = releaseVersion(pkg, lock);

export default defineConfig({
  base: '/holter-diary/app/',
  build: { outDir: 'dist/app' },
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [{
    name: 'app-version',
    generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version }) + '\n' }); },
  }],
});
