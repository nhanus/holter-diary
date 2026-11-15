import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { releaseVersion, releaseContext, prepare, releaseFiles, publish, githubApi } from '../../scripts/release.mjs';
const sha = 'a'.repeat(40), version = '0.1.0-beta.6';
const env = { GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main', GITHUB_SHA: sha, GITHUB_REPOSITORY: 'example/diary' };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'diary-release-')); t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'dist/app'), { recursive: true }); await mkdir(join(root, 'releases'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'holter-diary', version }));
  await writeFile(join(root, 'package-lock.json'), JSON.stringify({ name: 'holter-diary', lockfileVersion: 3, version, packages: { '': { name: 'holter-diary', version } } }));
  await writeFile(join(root, 'releases', `${version}.md`), 'Synthetic reviewed release notes for the test app.');
  for (const name of ['app/index.html', 'sw.js', 'manifest.webmanifest', '.nojekyll']) await writeFile(join(root, 'dist', name), 'Synthetic build');
  await writeFile(join(root, 'dist/app/version.json'), JSON.stringify({ version }));
  await prepare(root, sha); return root;
}
function fakeApi(state = {}) {
  state.calls = []; state.uploads = 0;
  const api = async (method, path, body, binary) => {
    state.calls.push({ method, path, body });
    if (method === 'GET' && path.includes('/git/ref/')) return state.tag ?? null;
    if (method === 'GET' && path.includes('/releases/tags/')) return state.release && !state.release.draft ? state.release : null;
    if (method === 'GET' && path.includes('/releases?')) return state.release ? [state.release] : [];
    if (method === 'POST' && path.endsWith('/git/refs')) return state.tag = { object: { type: 'commit', sha: body.sha } };
    if (method === 'POST' && path.endsWith('/releases')) return state.release = { ...body, id: 123, assets: [] };
    if (method === 'DELETE' && path.includes('/releases/assets/')) {
      state.release.assets = state.release.assets.filter(asset => asset.id !== Number(path.split('/').pop())); return null;
    }
    if (binary) {
      const asset = { name: new URL(path).searchParams.get('name'), size: body.length, digest: 'sha256:' + createHash('sha256').update(body).digest('hex'), state: 'uploaded' };
      state.uploads++; state.release.assets.push(asset); return asset;
    }
    if (method === 'PATCH') { Object.assign(state.release, body); return state.release; }
    throw new Error('Unexpected API call: ' + method + ' ' + path);
  };
  return { state, api };
}
test('versions and publication contexts reject ambiguity and mismatches', () => {
  for (const value of ['0.1.0-beta.1', '1.0.0', '2.3.4-rc.0']) assert.equal(releaseVersion({ version: value }, { version: value, packages: { '': { version: value } } }), value);
  for (const value of ['01.0.0', '1.0.0+build', '1.0.0-beta.01', '../bad', '1.0.0-foo']) assert.throws(() => releaseVersion({ version: value }, { version: value, packages: { '': { version: value } } }));
  assert.throws(() => releaseVersion({ version }, { version, packages: { '': { version: '0.0.0' } } }));
  for (const patch of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_REF: 'refs/heads/feature' }, { GITHUB_SHA: 'main' }]) assert.throws(() => releaseContext({ ...env, ...patch }));
});
test('packaging is repeatable and refuses a stale build or tampered archive', async t => {
  const root = await fixture(t), before = await readFile(join(root, 'release', `holter-diary-${version}.tar.gz`));
  await utimes(join(root, 'dist/app/index.html'), new Date(), new Date());
  await prepare(root, sha); assert.deepEqual(await readFile(join(root, 'release', `holter-diary-${version}.tar.gz`)), before);
  await assert.rejects(() => releaseFiles(root, 'b'.repeat(40)), /identity mismatch/);
  await writeFile(join(root, 'release', `holter-diary-${version}.tar.gz`), 'Tampered');
  await assert.rejects(() => releaseFiles(root, sha), /checksum mismatch/);
  await writeFile(join(root, 'dist/app/version.json'), '{"version":"0.0.0"}');
  await assert.rejects(() => prepare(root, sha), /Built version differs/);
});
test('new prerelease publishes exact verified assets at the tested commit', async t => {
  const root = await fixture(t), { state, api } = fakeApi();
  assert.equal(await publish(root, env, api), 'published');
  assert.equal(state.tag.object.sha, sha); assert.equal(state.release.target_commitish, sha);
  assert.equal(state.release.prerelease, true); assert.equal(state.release.draft, false); assert.equal(state.release.make_latest, 'false');
  assert.equal(state.uploads, 4); assert.match(state.release.body, /Synthetic reviewed release notes/);
});
test('tag-only and partial draft retries resume without replacing assets', async t => {
  const root = await fixture(t), { state, api } = fakeApi({ tag: { object: { type: 'commit', sha } } });
  const interrupted = async (...args) => { if (state.uploads === 1 && args[3]) throw new Error('Synthetic interruption'); return api(...args); };
  await assert.rejects(() => publish(root, env, interrupted), /interruption/);
  assert.equal(state.release.draft, true);
  await publish(root, env, api); assert.equal(state.uploads, 4); assert.equal(state.release.draft, false);
  assert.equal(state.calls.filter(c => c.path.endsWith('/git/refs')).length, 0);
});
test('published versions stay unchanged on later commits and incomplete releases fail', async t => {
  const root = await fixture(t), { state, api } = fakeApi(); await publish(root, env, api);
  const next = 'b'.repeat(40); await prepare(root, next); state.calls = [];
  assert.equal(await publish(root, { ...env, GITHUB_SHA: next }, api), 'existing');
  assert.equal(state.calls.filter(c => c.method !== 'GET').length, 0);
  state.release.assets.pop(); await assert.rejects(() => publish(root, { ...env, GITHUB_SHA: next }, api), /incomplete/);
});
test('conflicting tags, drafts and already uploaded bytes fail closed', async t => {
  const root = await fixture(t), bad = 'b'.repeat(40);
  let f = fakeApi({ tag: { object: { type: 'commit', sha: bad } } });
  await assert.rejects(() => publish(root, env, f.api), /another commit/);
  f = fakeApi({ tag: { object: { type: 'commit', sha } }, release: { id: 123, tag_name: `v${version}`, prerelease: true, draft: true, target_commitish: bad, assets: [] } });
  await assert.rejects(() => publish(root, env, f.api), /another commit/);
  f.state.release.target_commitish = sha; f.state.release.assets = [{ name: `holter-diary-${version}.tar.gz`, state: 'uploaded', size: 1, digest: 'wrong' }];
  await assert.rejects(() => publish(root, env, f.api), /Existing asset differs/);
  assert.equal(f.state.release.draft, true);
});
test('API absence is limited to GET 404 and credentials never follow redirects', async t => {
  const calls = []; t.mock.method(globalThis, 'fetch', async (url, options) => { calls.push({ url, options }); return new Response('{}', { status: 404 }); });
  const api = githubApi('synthetic-token'); assert.equal(await api('GET', '/repos/example/diary/releases/tags/v1'), null);
  await assert.rejects(() => api('POST', '/repos/example/diary/releases', {}), /404/);
  assert.equal(calls[0].options.redirect, 'error');
  await assert.rejects(() => api('GET', 'https://example.org/token'), /Unexpected API origin/);
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 403 }));
  await assert.rejects(() => api('GET', '/repos/example/diary/releases/tags/v1'), /403/);
});
test('draft lookup paginates and rejects ambiguous matching drafts', async t => {
  const root = await fixture(t);
  const draft = { id: 123, tag_name: `v${version}`, prerelease: true, draft: true, target_commitish: sha, assets: [] };
  const { api, state } = fakeApi({ tag: { object: { type: 'commit', sha } }, release: draft });
  const paginated = async (...args) => {
    if (args[1].includes('/releases?')) return args[1].endsWith('page=1') ? Array.from({ length: 100 }, (_, i) => ({ tag_name: `unrelated-${i}` })) : [draft];
    return api(...args);
  };
  await publish(root, env, paginated); assert.equal(state.release.draft, false);
  state.release.draft = true;
  const duplicates = async (...args) => args[1].includes('/releases?') ? [draft, { ...draft, id: 124 }] : api(...args);
  await assert.rejects(() => publish(root, env, duplicates), /Multiple releases/);
});


test('a matching draft recovers an incomplete starter asset without replacing completed bytes', async t => {
  const root = await fixture(t), files = await releaseFiles(root, sha);
  const complete = { id: 10, ...files.assets[1], state: 'uploaded' };
  const starter = { id: 11, name: files.assets[0].name, state: 'starter', size: 0, digest: null };
  const { state, api } = fakeApi({ tag: { object: { type: 'commit', sha } }, release: {
    id: 123, tag_name: `v${version}`, target_commitish: sha, draft: true, prerelease: true, assets: [complete, starter],
  } });
  assert.equal(await publish(root, env, api), 'published');
  assert.equal(state.uploads, 3);
  assert.deepEqual(state.calls.filter(c => c.method === 'DELETE').map(c => c.path), ['/repos/example/diary/releases/assets/11']);
  assert.equal(state.release.assets.find(a => a.id === 10), complete);
});

test('incomplete-asset cleanup failures and invalid identifiers leave the draft unpublished', async t => {
  const root = await fixture(t);
  const f = fakeApi({ tag: { object: { type: 'commit', sha } }, release: {
    id: 123, tag_name: `v${version}`, target_commitish: sha, draft: true, prerelease: true,
    assets: [{ id: 11, name: `holter-diary-${version}.tar.gz`, state: 'starter', size: 0 }],
  } });
  const failedDelete = async (...args) => { if (args[0] === 'DELETE') throw new Error('Synthetic delete failure'); return f.api(...args); };
  await assert.rejects(() => publish(root, env, failedDelete), /delete failure/);
  assert.equal(f.state.uploads, 0); assert.equal(f.state.release.draft, true);
  f.state.release.assets[0].id = -1;
  await assert.rejects(() => publish(root, env, f.api), /Invalid incomplete asset identifier/);
  assert.equal(f.state.uploads, 0); assert.equal(f.state.release.draft, true);
});

test('SBOM bytes are repeatable and missing, modified or misbound SBOMs cannot publish', async t => {
  const root = await fixture(t), name = `holter-diary-${version}.cdx.json`;
  const before = await readFile(join(root, 'release', name));
  await prepare(root, sha);
  assert.deepEqual(await readFile(join(root, 'release', name)), before);
  const bom = JSON.parse(before);
  assert.equal(bom.metadata.component.version, version);
  assert.equal(bom.serialNumber, undefined);
  assert.equal(bom.metadata.timestamp, undefined);
  await rm(join(root, 'release', name));
  const f = fakeApi();
  await assert.rejects(publish(root, env, f.api), /ENOENT/);
  assert.equal(f.state.calls.length, 0);
  await writeFile(join(root, 'release', name), before.toString() + ' ');
  await assert.rejects(publish(root, env, f.api), /checksum mismatch/);
  assert.equal(f.state.calls.length, 0);
  // Even internally consistent hashes cannot substitute another product/source/archive.
  for (const field of ['version', 'source-commit', 'archive-sha256']) {
    const changed = JSON.parse(before);
    if (field === 'version') changed.metadata.component.version = '9.0.0';
    else changed.metadata.properties.find(p => p.name === `holter-diary:${field}`).value = 'wrong';
    const bytes = JSON.stringify(changed), digest = createHash('sha256').update(bytes).digest('hex');
    const manifest = JSON.parse(await readFile(join(root, 'release/release.json')));
    manifest.sbom.sha256 = digest;
    await writeFile(join(root, 'release', name), bytes);
    await writeFile(join(root, 'release/release.json'), JSON.stringify(manifest));
    await writeFile(join(root, 'release/SHA256SUMS'), `${manifest.sha256}  ${manifest.archive}\n${digest}  ${name}\n`);
    await assert.rejects(publish(root, env, f.api), /SBOM .* identity mismatch/);
    assert.equal(f.state.calls.length, 0);
  }
});

test('historical three-asset releases stay untouched without weakening new releases', async t => {
  const root = await fixture(t), historical = '0.1.0-beta.5';
  for (const file of ['package.json', 'package-lock.json', 'dist/app/version.json']) {
    const path = join(root, file), value = JSON.parse(await readFile(path));
    value.version = historical;
    if (value.packages) value.packages[''].version = historical;
    await writeFile(path, JSON.stringify(value));
  }
  await writeFile(join(root, 'releases', `${historical}.md`), 'Historical reviewed release notes.');
  await prepare(root, sha);
  const f = fakeApi({ tag: { object: { type: 'commit', sha: 'b'.repeat(40) } }, release: {
    tag_name: `v${historical}`, prerelease: true, draft: false,
    assets: [`holter-diary-${historical}.tar.gz`, 'SHA256SUMS', 'release.json'].map(name => ({name, state: 'uploaded'})),
  }});
  assert.equal(await publish(root, env, f.api), 'existing');
  assert.equal(f.state.calls.filter(c => c.method !== 'GET').length, 0);
  f.state.release.assets.pop();
  await assert.rejects(publish(root, env, f.api), /incomplete/);
});
