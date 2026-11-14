import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProject, checkPolicy, lockedPackages, securityExceptions, verifyRelease, MINIMUM_AGE_MS } from '../../scripts/check-dependency-policy.mjs';

const now = Date.parse('2030-06-20T12:00:00.000Z');
const integrity = `sha512-${Buffer.alloc(64, 1).toString('base64')}`;
const pkg = { name: 'synthetic-package', version: '1.2.3', resolved: 'https://registry.npmjs.org/synthetic-package/-/synthetic-package-1.2.3.tgz', integrity };
const metadata = (release = pkg, age = MINIMUM_AGE_MS) => ({ name: release.name,
  time: { [release.version]: new Date(now - age).toISOString() },
  versions: { [release.version]: { dist: { tarball: release.resolved, integrity: release.integrity } } },
});
const lock = (entries = { 'node_modules/synthetic-package': pkg }) => ({ lockfileVersion: 3, packages: { '': { name: 'fixture' }, ...entries } });
const policy = { exceptions: [] };
const exception = { name: pkg.name, version: pkg.version, advisory: 'https://example.org/security/advisory', reason: 'Synthetic urgent security patch requiring review.' };

test('exactly fourteen days is allowed; even one millisecond younger is blocked', () => {
  assert.equal(verifyRelease(pkg, metadata(), new Map(), now), false);
  assert.equal(verifyRelease(pkg, metadata(pkg, MINIMUM_AGE_MS + 1), new Map(), now), false);
  assert.throws(() => verifyRelease(pkg, metadata(pkg, MINIMUM_AGE_MS - 1), new Map(), now), /younger than 14 days/);
});

test('security exceptions apply only to the exact package and version', () => {
  const exceptions = securityExceptions({ exceptions: [exception] });
  assert.equal(verifyRelease(pkg, metadata(pkg, 1), exceptions, now), true);
  const newer = { ...pkg, version: '1.2.4' };
  assert.throws(() => verifyRelease(newer, metadata(newer, 1), exceptions, now), /younger than 14 days/);
  const other = { ...pkg, name: 'other-package' };
  assert.throws(() => verifyRelease(other, metadata(other, 1), exceptions, now), /younger than 14 days/);
  assert.equal(verifyRelease(pkg, metadata(), exceptions, now), false);
});

test('exceptions reject wildcards, incomplete rationale, insecure links and duplicates', () => {
  for (const change of [{ name: '*' }, { name: '@scope/*' }, { version: '^1.2.3' }, { reason: '' }, { advisory: 'http://example.org/advisory' }]) {
    assert.throws(() => securityExceptions({ exceptions: [{ ...exception, ...change }] }));
  }
  assert.throws(() => securityExceptions({ exceptions: [exception, exception] }), /Duplicate/);
});

test('unknown, malformed or future publication dates fail even with an exception', () => {
  for (const date of [undefined, 'not-a-date', '2030-02-30T12:00:00.000Z', new Date(now + 1).toISOString()]) {
    const value = metadata(); value.time[pkg.version] = date;
    assert.throws(() => verifyRelease(pkg, value, securityExceptions({ exceptions: [exception] }), now), /publication time/);
  }
});

test('tarball and integrity must match the registry identity being age-checked', () => {
  for (const change of [{ name: 'wrong-name' }, { versions: {} },
    { versions: { [pkg.version]: { dist: { tarball: pkg.resolved.replace('1.2.3', '9.9.9'), integrity } } } },
    { versions: { [pkg.version]: { dist: { tarball: pkg.resolved, integrity: 'changed' } } } }]) {
    assert.throws(() => verifyRelease(pkg, { ...metadata(), ...change }, new Map(), now), /identity\/integrity mismatch/);
  }
});

test('unsupported lock versions, sources, aliases and missing integrity are rejected', () => {
  assert.throws(() => lockedPackages({ ...lock(), lockfileVersion: 2 }));
  for (const change of [{ resolved: 'https://example.org/package.tgz' }, { resolved: 'file:package.tgz' },
    { resolved: 'https://registry.npmjs.org/package.tgz?download=1' }, { link: true }, { integrity: '' }, { version: 'latest' }, { name: 'aliased-package' }]) {
    assert.throws(() => lockedPackages(lock({ 'node_modules/synthetic-package': { ...pkg, ...change } })));
  }
});

test('all nested, development and optional platform packages are checked', async () => {
  const optional = { name: '@fixture/optional-platform', version: '2.0.0', resolved: 'https://registry.npmjs.org/@fixture/optional-platform/-/optional-platform-2.0.0.tgz', integrity };
  const entries = { 'node_modules/synthetic-package': pkg,
    'node_modules/parent/node_modules/@fixture/optional-platform': { ...optional, dev: true, optional: true, os: ['darwin'] } };
  const calls = [];
  await assert.rejects(checkPolicy(lock(entries), policy, { now, lookup: async name => {
    calls.push(name); return name === pkg.name ? metadata() : metadata(optional, 1);
  } }), /younger than 14 days/);
  assert.deepEqual(calls.sort(), [pkg.name, optional.name].sort());
});

test('registry failures stop the check instead of treating missing evidence as safe', async () => {
  await assert.rejects(checkPolicy(lock(), policy, { now, lookup: async () => { throw new Error('registry unavailable'); } }), /registry unavailable/);
});

test('identical repeated dependencies are deduplicated; contradictory identities fail', async () => {
  const entries = { 'node_modules/synthetic-package': pkg, 'node_modules/parent/node_modules/synthetic-package': pkg };
  let calls = 0;
  assert.deepEqual(await checkPolicy(lock(entries), policy, { now, lookup: async () => { calls++; return metadata(); } }), { count: 1, usedExceptions: [] });
  assert.equal(calls, 1);
  entries['node_modules/parent/node_modules/synthetic-package'] = { ...pkg, resolved: pkg.resolved.replace('1.2.3', '9.9.9') };
  assert.throws(() => lockedPackages(lock(entries)), /Conflicting/);
});

test('a valid reviewed security exception is reported without relaxing other packages', async () => {
  assert.deepEqual(await checkPolicy(lock(), { exceptions: [exception] }, { now, lookup: async () => metadata(pkg, 1) }),
    { count: 1, usedExceptions: [`${pkg.name}@${pkg.version}`] });
});


test('a root shrinkwrap is rejected rather than checking a different graph from npm ci', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dependency-policy-'));
  try {
    await mkdir(join(directory, '.github'));
    await writeFile(join(directory, 'package-lock.json'), JSON.stringify(lock()));
    await writeFile(join(directory, '.github/dependency-age-exceptions.json'), JSON.stringify(policy));
    assert.equal((await checkProject(directory, { now, lookup: async () => metadata() })).count, 1);
    await writeFile(join(directory, 'npm-shrinkwrap.json'), '{}');
    await assert.rejects(checkProject(directory, { now, lookup: async () => { throw new Error('must not fetch'); } }), /npm-shrinkwrap.json is not supported/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
