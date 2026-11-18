import { spawnSync } from 'node:child_process';
import { readFile, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const advisory = 'https://github.com/advisories/GHSA-fc5q-39xc-vjpf';
const expiresAt = '2026-12-01T00:00:00.000Z';
const reviewedPackages = new Map([
  ['picomatch', { version: '4.0.7', via: [] }],
  ['fdir', { version: '6.5.0', via: ['picomatch'] }],
  ['tinyglobby', { version: '0.2.17', via: ['fdir', 'picomatch'] }],
  ['vite', { version: '8.3.5', via: ['picomatch', 'tinyglobby'] }],
]);
const reviewedLinks = [
  ':devDependencies:vite',
  'node_modules/fdir:peerDependencies:picomatch',
  'node_modules/tinyglobby:dependencies:fdir',
  'node_modules/tinyglobby:dependencies:picomatch',
  'node_modules/vite:dependencies:picomatch',
  'node_modules/vite:dependencies:tinyglobby',
];
const dependencyKinds = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const auditScopes = ['prod', 'dev', 'optional', 'peer', 'peerOptional'];
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
const isRecord = value => value && typeof value === 'object' && !Array.isArray(value);
const sameMembers = (actual, expected) => actual.length === expected.length &&
  new Set(actual).size === actual.length && actual.every(value => expected.includes(value));

function reviewedLinksFrom(path, entry) {
  return dependencyKinds.flatMap(kind => Object.keys(entry[kind] ?? {})
    .filter(name => reviewedPackages.has(name))
    .map(name => `${path}:${kind}:${name}`));
}

function hasReviewedScope(packages, manifest) {
  const links = [];
  for (const [path, entry] of Object.entries(packages)) {
    const name = path.split('node_modules/').at(-1);
    const expected = reviewedPackages.get(name);
    if (expected && (path !== 'node_modules/' + name || entry.version !== expected.version || entry.dev !== true || entry.link)) return false;
    links.push(...reviewedLinksFrom(path, entry));
  }
  return [...reviewedPackages.keys()].every(name => Object.hasOwn(packages, 'node_modules/' + name)) &&
    sameMembers(links, reviewedLinks) && sameMembers(reviewedLinksFrom('', manifest), [':devDependencies:vite']);
}

function matchesReviewedFinding(name, finding) {
  const expected = reviewedPackages.get(name);
  const effects = [...reviewedPackages].filter(([, pkg]) => pkg.via.includes(name)).map(([name]) => name);
  if (!expected || finding.severity !== 'high' || finding.isDirect !== (name === 'vite') ||
      !sameMembers(finding.nodes, ['node_modules/' + name]) || !sameMembers(finding.effects, effects)) return false;
  if (name !== 'picomatch') return sameMembers(finding.via, expected.via);
  const [source] = finding.via;
  return finding.via.length === 1 && source?.url === advisory && source.name === name &&
    source.dependency === name && source.severity === 'high' && source.range === '<=4.0.7';
}

export function evaluateAudit(stdout, status, lock, manifest, now = Date.now()) {
  const report = JSON.parse(stdout);
  const { vulnerabilities, metadata } = report ?? {};
  const dependencies = metadata?.dependencies;
  if (report?.auditReportVersion !== 2 || Object.hasOwn(report, 'error') ||
      !isRecord(vulnerabilities) || lock?.lockfileVersion !== 3 || !isRecord(lock.packages) ||
      !isRecord(lock.packages['']) || !isRecord(manifest) ||
      !isRecord(dependencies) || dependencies.total !== Object.keys(lock.packages).length - 1 ||
      auditScopes.some(scope => !Number.isInteger(dependencies[scope]) || dependencies[scope] < 0) ||
      !Number.isFinite(now)) {
    throw new Error('Incomplete npm audit report or unsupported lockfile.');
  }
  const findings = Object.entries(vulnerabilities);
  if (status !== Number(findings.length > 0) || metadata.vulnerabilities?.total !== findings.length ||
      findings.some(([name, finding]) => finding?.name !== name || !severities.includes(finding.severity) ||
        typeof finding.isDirect !== 'boolean' || !Array.isArray(finding.effects) ||
        !Array.isArray(finding.nodes) || !finding.nodes.length || !Array.isArray(finding.via) || !finding.via.length) ||
      severities.some(severity => metadata.vulnerabilities[severity] !== findings.filter(([, finding]) => finding.severity === severity).length)) {
    throw new Error('Inconsistent npm audit result.');
  }
  if (!findings.length) return null;
  if (Date.parse(expiresAt) <= now) throw new Error(`Vulnerability audit failed. The ${advisory} exception expired at ${expiresAt}.`);
  if (findings.length !== reviewedPackages.size || !hasReviewedScope(lock.packages, manifest) ||
      !findings.every(([name, finding]) => matchesReviewedFinding(name, finding))) {
    throw new Error('Vulnerability audit failed. Findings or locked dependency paths differ from the approved exception.');
  }
  return `Maintainer-approved audit exception in use for picomatch@4.0.7 (${advisory}, development dependencies only). Expires at ${expiresAt}.`;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    const directory = fileURLToPath(new URL('../', import.meta.url));
    try {
      await lstat(join(directory, 'npm-shrinkwrap.json'));
      throw new Error('npm-shrinkwrap.json is not supported.');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const lockfile = join(directory, 'package-lock.json');
    const manifestFile = join(directory, 'package.json');
    const [lock, manifest] = await Promise.all([readFile(lockfile, 'utf8'), readFile(manifestFile, 'utf8')]);
    const npm = process.env.npm_execpath;
    const command = spawnSync(npm ? process.execPath : 'npm', [
      ...(npm ? [npm] : []),
      'audit', '--package-lock-only', '--audit-level=info', '--json',
      '--include=prod', '--include=dev', '--include=optional', '--include=peer',
      '--offline=false', '--registry=https://registry.npmjs.org/',
    ], { cwd: directory, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 60_000 });
    if (command.stdout) process.stdout.write(command.stdout);
    if (command.stderr) process.stderr.write(command.stderr);
    if (command.error) throw command.error;
    if (await readFile(lockfile, 'utf8') !== lock || await readFile(manifestFile, 'utf8') !== manifest) {
      throw new Error('The dependency files changed during the audit.');
    }
    const exception = evaluateAudit(command.stdout, command.status, JSON.parse(lock), JSON.parse(manifest));
    if (exception) console.warn(exception);
  } catch (error) {
    console.error(`Dependency audit failed: ${error.message}`);
    process.exitCode = 1;
  }
}
