import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSbom, validateSbom } from '../../scripts/sbom.mjs';

test('native SBOM includes exact transitive production versions, licenses and hashes, excluding development tools', async t => {
  const root = await mkdtemp(join(tmpdir(), 'sbom-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const pkg = {name: 'holter-diary', version: '1.0.0', dependencies: {library: '2.0.0'}, devDependencies: {tool: '3.0.0'}};
  const entry = (name, version, extra = {}) => ({version, resolved: `https://registry.npmjs.org/${name}/-/${name}-${version}.tgz`, integrity: 'sha512-' + Buffer.alloc(64, 1).toString('base64'), license: 'MIT', ...extra});
  await writeFile(join(root, 'package.json'), JSON.stringify(pkg));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: {
    '': pkg,
    'node_modules/library': entry('library', '2.0.0', {dependencies: {child: '1.2.3'}}),
    'node_modules/child': entry('child', '1.2.3'),
    'node_modules/tool': entry('tool', '3.0.0', {dev: true}),
  }}));
  const identity = {version: '1.0.0', sourceSha: 'a'.repeat(40), archive: 'holter-diary-1.0.0.tar.gz', sha256: 'b'.repeat(64)};
  const bom = JSON.parse(await createSbom(root, identity));
  assert.deepEqual(bom.components.map(c => `${c.name}@${c.version}`).sort(), ['child@1.2.3', 'library@2.0.0']);
  for (const c of bom.components) {
    assert.match(c.purl, /^pkg:npm\//);
    assert.equal(c.licenses[0].license.id, 'MIT');
    assert.equal(c.hashes[0].alg, 'SHA-512');
    assert.equal(c.hashes[0].content, Buffer.alloc(64, 1).toString('hex'));
  }
  assert.deepEqual(bom.dependencies.find(d => d.ref === 'library@2.0.0').dependsOn, ['child@1.2.3']);
  assert(!JSON.stringify(bom).includes(root));
  assert.throws(() => validateSbom({...bom, dependencies: []}, identity), /dependency graph/);
});
