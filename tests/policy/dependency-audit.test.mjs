import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { evaluateAudit } from '../../scripts/audit-dependencies.mjs';

const expiry = Date.parse('2026-12-01T00:00:00.000Z');
const advisory = {
  name: 'picomatch', dependency: 'picomatch', severity: 'high', range: '<=4.0.7',
  url: 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf',
};
const manifest = { devDependencies: { vite: '8.3.5' } };
const lock = {
  lockfileVersion: 3,
  packages: {
    '': manifest,
    'node_modules/picomatch': { version: '4.0.7', dev: true },
    'node_modules/fdir': { version: '6.5.0', dev: true, peerDependencies: { picomatch: '^3 || ^4' } },
    'node_modules/tinyglobby': { version: '0.2.17', dev: true, dependencies: { fdir: '^6.5.0', picomatch: '^4.0.4' } },
    'node_modules/vite': { version: '8.3.5', dev: true, dependencies: { picomatch: '^4.0.7', tinyglobby: '^0.2.17' } },
  },
};

function report() {
  const sources = {
    picomatch: [advisory], fdir: ['picomatch'],
    tinyglobby: ['fdir', 'picomatch'], vite: ['picomatch', 'tinyglobby'],
  };
  const effects = { picomatch: ['fdir', 'tinyglobby', 'vite'], fdir: ['tinyglobby'], tinyglobby: ['vite'], vite: [] };
  const vulnerabilities = Object.fromEntries(Object.entries(sources).map(([name, via]) =>
    [name, { name, severity: 'high', isDirect: name === 'vite', via, effects: effects[name], nodes: ['node_modules/' + name] }]));
  return {
    auditReportVersion: 2, vulnerabilities,
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 4, critical: 0, total: 4 },
      dependencies: { prod: 1, dev: 4, optional: 0, peer: 0, peerOptional: 0, total: 4 },
    },
  };
}

const evaluate = (value, options = {}) => evaluateAudit(
  JSON.stringify(value), options.status ?? 1, options.lock ?? lock, options.manifest ?? manifest,
  options.now ?? expiry - 1,
);

test('the exact reviewed development finding passes before expiry and fails at expiry', () => {
  assert.match(evaluate(report()), /picomatch@4\.0\.7.*GHSA-fc5q-39xc-vjpf/);
  assert.throws(() => evaluate(report(), { now: expiry }), /exception expired/);
  const clean = report();
  clean.vulnerabilities = {};
  clean.metadata.vulnerabilities.high = clean.metadata.vulnerabilities.total = 0;
  assert.equal(evaluate(clean, { now: expiry, status: 0 }), null);
  assert.throws(() => evaluate(clean), /Inconsistent/);
});

test('additional advisories and findings, changes in severity and different nodes remain blocked', () => {
  const extra = report();
  extra.vulnerabilities.other = {
    name: 'other', severity: 'low', isDirect: false, via: [advisory], effects: [], nodes: ['node_modules/other'],
  };
  extra.metadata.vulnerabilities.low = 1;
  extra.metadata.vulnerabilities.total = 5;
  assert.throws(() => evaluate(extra), /differ from the approved exception/);

  for (const change of [
    result => result.vulnerabilities.picomatch.via = [{ ...advisory, url: 'https://example.org/another-advisory' }],
    result => result.vulnerabilities.picomatch.via = [{ ...advisory, severity: 'critical' }],
    result => result.vulnerabilities.picomatch.isDirect = true,
    result => result.vulnerabilities.picomatch.effects = ['unreviewed-package'],
    result => result.vulnerabilities.vite.via.push({ ...advisory, name: 'vite' }),
    result => result.vulnerabilities.picomatch.nodes.push('node_modules/other/node_modules/picomatch'),
  ]) {
    const value = report();
    change(value);
    assert.throws(() => evaluate(value), /differ from the approved exception/);
  }
});

test('another version, a runtime dependency or an unreviewed consumer invalidates the exception', () => {
  for (const change of [
    value => value.packages['node_modules/picomatch'].version = '4.0.6',
    value => value.packages['node_modules/picomatch'].dev = false,
    value => value.packages['node_modules/vite'].dependencies.fdir = '^6.5.0',
  ]) {
    const changed = structuredClone(lock);
    change(changed);
    assert.throws(() => evaluate(report(), { lock: changed }), /differ from the approved exception/);
  }
  const runtimeManifest = { ...manifest, dependencies: { picomatch: '4.0.7' } };
  assert.throws(() => evaluate(report(), { manifest: runtimeManifest }), /differ from the approved exception/);
});

test('invalid reports and npm failures never pass the audit gate', () => {
  const result = report();
  assert.throws(() => evaluateAudit('', null, lock, manifest, expiry - 1), SyntaxError);
  assert.throws(() => evaluate({ ...result, error: { code: 'E503' } }), /Incomplete/);
  assert.throws(() => evaluate(result, { status: 2 }), /Inconsistent/);
  assert.throws(() => evaluate(result, { status: 0 }), /Inconsistent/);
  delete result.vulnerabilities.vite.effects;
  assert.throws(() => evaluate(result), /Inconsistent/);
  delete result.metadata.dependencies.dev;
  assert.throws(() => evaluate(result), /Incomplete/);
  result.metadata.dependencies.dev = 4;
  result.metadata.dependencies.total = 1;
  assert.throws(() => evaluate(result), /Incomplete/);
});

test('the CLI requests an online audit of the complete lockfile', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dependency-audit-'));
  try {
    const wrapper = join(directory, 'scripts', 'audit-dependencies.mjs');
    const stubNpm = join(directory, 'npm.mjs');
    const clean = report();
    clean.vulnerabilities = {};
    clean.metadata.vulnerabilities.high = clean.metadata.vulnerabilities.total = 0;
    await Promise.all([
      cp(new URL('../../scripts/audit-dependencies.mjs', import.meta.url), wrapper),
      writeFile(join(directory, 'package.json'), JSON.stringify(manifest)),
      writeFile(join(directory, 'package-lock.json'), JSON.stringify(lock)),
      writeFile(stubNpm, `import assert from 'node:assert/strict';
const args = process.argv.slice(2);
for (const flag of ['--offline=false', '--include=prod', '--include=dev', '--include=optional', '--include=peer']) assert.ok(args.includes(flag));
console.log(${JSON.stringify(JSON.stringify(clean))});
`),
    ]);
    const stdout = execFileSync(process.execPath, [wrapper], {
      encoding: 'utf8', env: { ...process.env, npm_execpath: stubNpm, npm_config_offline: 'true' },
    });
    assert.deepEqual(JSON.parse(stdout), clean);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
