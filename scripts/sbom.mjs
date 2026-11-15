import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export const sbomName = version => `holter-diary-${version}.cdx.json`;
export const legacyRelease = version => /^0\.1\.0-beta\.[1-5]$/.test(version);
const assert = (value, message) => { if (!value) throw new Error(message); };
const properties = ({ sourceSha, archive, sha256 }) => [
  { name: 'holter-diary:source-commit', value: sourceSha },
  { name: 'holter-diary:archive', value: archive },
  { name: 'holter-diary:archive-sha256', value: sha256 },
];

// npm supplies package identities, licenses, integrity hashes and declared edges.
// This is a production lockfile inventory, not a file-level bundle analysis.
export async function createSbom(root, identity) {
  const bom = JSON.parse(execFileSync('npm', [
    'sbom', '--sbom-format=cyclonedx', '--sbom-type=application',
    '--package-lock-only', '--omit=dev', '--include=prod', '--offline', '--ignore-scripts',
  ], { cwd: root, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }));
  // Optional volatile fields would make an interrupted upload impossible to retry.
  delete bom.serialNumber;
  delete bom.metadata.timestamp;
  bom.metadata.component.purl = `pkg:generic/holter-diary@${identity.version}`;
  bom.metadata.properties = [
    ...properties(identity),
    { name: 'holter-diary:package-lock-sha256', value: createHash('sha256').update(await readFile(join(root, 'package-lock.json'))).digest('hex') },
    { name: 'holter-diary:inventory-scope', value: 'Locked production npm dependencies, including transitives; excludes development tools. Packages may be partially bundled or tree-shaken. Package hashes identify npm tarballs, not bundled files.' },
  ];
  validateSbom(bom, identity);
  return Buffer.from(JSON.stringify(bom, null, 2) + '\n');
}

export function validateSbom(bom, identity) {
  assert(bom?.bomFormat === 'CycloneDX' && bom.specVersion === '1.5' && bom.version === 1, 'Unexpected SBOM format.');
  const component = bom.metadata?.component;
  assert(component?.type === 'application' && component.name === 'holter-diary' && component.version === identity.version, 'SBOM application identity mismatch.');
  assert(Array.isArray(bom.components) && Array.isArray(bom.dependencies), 'Missing SBOM inventory.');
  for (const property of properties(identity)) {
    const matches = bom.metadata.properties?.filter(p => p.name === property.name);
    assert(matches?.length === 1 && matches[0].value === property.value, 'SBOM release identity mismatch.');
  }
  const refs = new Set([component['bom-ref'], ...bom.components.map(c => c['bom-ref'])]);
  assert(refs.size === bom.components.length + 1 && !refs.has(undefined), 'Invalid SBOM component references.');
  assert(bom.dependencies.length === refs.size && new Set(bom.dependencies.map(d => d.ref)).size === refs.size &&
    bom.dependencies.every(d => refs.has(d.ref) && Array.isArray(d.dependsOn) && d.dependsOn.every(ref => refs.has(ref))), 'Invalid SBOM dependency graph.');
}
