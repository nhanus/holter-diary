import { readFile, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export const MINIMUM_AGE_MS = 14 * 24 * 60 * 60 * 1000;
const REGISTRY = 'https://registry.npmjs.org/';
const packageName = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/;
const exactVersion = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function lockedPackages(lock) {
  assert(lock?.lockfileVersion === 3 && lock.packages?.[''], 'A version-3 npm lockfile is required.');
  const packages = new Map();
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path) continue;
    const name = path.split('node_modules/').at(-1);
    assert(path.startsWith('node_modules/') && packageName.test(name) && !entry.link &&
      (!entry.name || entry.name === name), `Unsupported dependency source or alias: ${path}`);
    assert(exactVersion.test(entry.version ?? ''), `Missing exact version: ${name}`);
    const url = new URL(entry.resolved);
    assert(url.origin === REGISTRY.slice(0, -1) && !url.username && !url.password && !url.search && !url.hash,
      `Only public npm registry tarballs are supported: ${name}`);
    assert(/^sha512-[A-Za-z0-9+/]{86}==$/.test(entry.integrity ?? ''), `Missing SHA-512 integrity: ${name}`);
    const key = `${name}@${entry.version}`;
    const existing = packages.get(key);
    assert(!existing || (existing.resolved === entry.resolved && existing.integrity === entry.integrity),
      `Conflicting lockfile identities: ${key}`);
    packages.set(key, { name, version: entry.version, resolved: entry.resolved, integrity: entry.integrity });
  }
  return [...packages.values()];
}

export function securityExceptions(policy) {
  assert(Array.isArray(policy?.exceptions), 'Security exceptions must be an array.');
  const exceptions = new Map();
  for (const exception of policy.exceptions) {
    assert(exception && packageName.test(exception.name ?? '') && exactVersion.test(exception.version ?? ''),
      'Security exceptions require an exact package name and version; no wildcards.');
    const advisory = new URL(exception.advisory);
    assert(advisory.protocol === 'https:' && !advisory.username && !advisory.password &&
      typeof exception.reason === 'string' && exception.reason.trim().length >= 20,
    'Each security exception needs an HTTPS advisory and a meaningful rationale.');
    const key = `${exception.name}@${exception.version}`;
    assert(!exceptions.has(key), `Duplicate security exception: ${key}`);
    exceptions.set(key, exception);
  }
  return exceptions;
}

export function verifyRelease(pkg, metadata, exceptions, now) {
  const key = `${pkg.name}@${pkg.version}`;
  const release = metadata.versions?.[pkg.version];
  assert(metadata.name === pkg.name && release?.dist?.tarball === pkg.resolved &&
    release.dist.integrity === pkg.integrity, `Registry identity/integrity mismatch: ${key}`);
  const published = metadata.time?.[pkg.version];
  assert(typeof published === 'string' && /^\d{4}-\d\d-\d\dT/.test(published), `Missing publication time: ${key}`);
  const timestamp = Date.parse(published);
  assert(Number.isFinite(timestamp) && new Date(timestamp).toISOString() === published && timestamp <= now, `Invalid or future publication time: ${key}`);
  if (now - timestamp >= MINIMUM_AGE_MS) return false;
  assert(exceptions.has(key), `${key} is younger than 14 days (published ${published}). A reviewed security exception is required.`);
  return true;
}

export async function registryMetadata(name) {
  const response = await fetch(REGISTRY + encodeURIComponent(name), {
    redirect: 'error', signal: AbortSignal.timeout(20_000),
    headers: { accept: 'application/json' },
  });
  assert(response.ok, `Registry lookup failed for ${name}: HTTP ${response.status}`);
  return response.json();
}

export async function checkPolicy(lock, policy, { now = Date.now(), lookup = registryMetadata } = {}) {
  assert(Number.isFinite(now), 'Invalid clock for dependency check.');
  const packages = lockedPackages(lock);
  const exceptions = securityExceptions(policy);
  const metadata = new Map();
  const usedExceptions = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, packages.length) }, async () => {
    while (next < packages.length) {
      const pkg = packages[next++];
      if (!metadata.has(pkg.name)) metadata.set(pkg.name, lookup(pkg.name));
      if (verifyRelease(pkg, await metadata.get(pkg.name), exceptions, now)) usedExceptions.push(`${pkg.name}@${pkg.version}`);
    }
  }));
  return { count: packages.length, usedExceptions: usedExceptions.sort() };
}

export async function checkProject(directory = fileURLToPath(new URL('../', import.meta.url)), options) {
  let shrinkwrap = false;
  try { await lstat(join(directory, 'npm-shrinkwrap.json')); shrinkwrap = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  assert(!shrinkwrap, 'npm-shrinkwrap.json is not supported: npm would install a different lockfile.');
  const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'));
  const policy = JSON.parse(await readFile(join(directory, '.github/dependency-age-exceptions.json'), 'utf8'));
  return checkPolicy(lock, policy, options);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const result = await checkProject();
    console.log(`Dependency policy passed: ${result.count} locked package versions checked, including optional and development dependencies.`);
    for (const key of result.usedExceptions) console.log(`Security exception in use: ${key}`);
  } catch (error) {
    console.error(`Dependency policy failed: ${error.message}`);
    process.exitCode = 1;
  }
}
