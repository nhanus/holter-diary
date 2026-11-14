import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

async function appChecksums(packageDir: string) {
  const entries = await readdir(join(packageDir, 'app'), { withFileTypes: true, recursive: true });
  const files = entries.filter(entry => entry.isFile()).map(entry => relative(packageDir, join(entry.parentPath, entry.name)));
  files.push('sw.js', 'manifest.webmanifest');
  return Promise.all(files.sort().map(async file => {
    const hash = createHash('sha256').update(await readFile(join(packageDir, file))).digest('hex');
    return [file, hash];
  }));
}

test('an FAQ-only change leaves the app package, manifest and worker byte-identical', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'holter-website-test-'));
  const app = resolve('dist');
  const composer = resolve('scripts/build-website.mjs');
  const source = join(workspace, 'website');
  const output = join(workspace, 'site');
  try {
    await cp('website', source, { recursive: true });
    await run(process.execPath, [composer, app, output], { cwd: workspace });
    const shipped = await appChecksums(app);
    expect(await appChecksums(output)).toEqual(shipped);

    const faq = join('faq', 'index.html');
    const updated = (await readFile(join(source, faq), 'utf8')) + '\n<!-- Synthetic FAQ change -->\n';
    await writeFile(join(source, faq), updated);
    await run(process.execPath, [composer, app, output], { cwd: workspace });
    expect(await readFile(join(output, faq), 'utf8')).toBe(updated);
    expect(await appChecksums(output)).toEqual(shipped);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
