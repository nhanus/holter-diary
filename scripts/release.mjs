import { readFile, writeFile, mkdir, readdir, lstat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const assert = (value, message) => { if (!value) throw new Error(message); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(alpha|beta|rc)\.(0|[1-9]\d*))?$/;
export function releaseVersion(pkg, lock) {
  assert(typeof pkg?.version === 'string' && versionPattern.test(pkg.version), 'Use X.Y.Z or X.Y.Z-(alpha|beta|rc).N.');
  assert(lock?.version === pkg.version && lock?.packages?.['']?.version === pkg.version, 'Package and lockfile versions differ.');
  return pkg.version;
}
export function releaseContext(env) {
  assert(env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === 'refs/heads/main', 'Only a main push can publish a release.');
  assert(/^[0-9a-f]{40}$/.test(env.GITHUB_SHA ?? ''), 'Invalid source commit.');
  assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY ?? ''), 'Invalid repository.');
  return { sha: env.GITHUB_SHA, repo: env.GITHUB_REPOSITORY };
}
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function packageVersion(root) { return releaseVersion(await json(join(root, 'package.json')), await json(join(root, 'package-lock.json'))); }
async function regularFiles(dir) {
  const result = [];
  for (const name of (await readdir(dir)).sort()) {
    const path = join(dir, name), stat = await lstat(path);
    assert(!stat.isSymbolicLink(), 'Release files must not be symlinks.');
    if (stat.isDirectory()) result.push(...await regularFiles(path));
    else { assert(stat.isFile(), 'Unexpected release file type.'); result.push(path); }
  }
  return result;
}
export async function prepare(root, sourceSha) {
  assert(/^[0-9a-f]{40}$/.test(sourceSha ?? ''), 'Invalid source commit.');
  const version = await packageVersion(root), dist = join(root, 'dist'), output = join(root, 'release');
  assert((await json(join(dist, 'version.json'))).version === version, 'Built version differs from package version.');
  const files = await regularFiles(dist);
  for (const required of ['index.html', 'sw.js', 'manifest.webmanifest', 'version.json']) assert(files.includes(join(dist, required)), `Missing build file: ${required}`);
  // Normalize metadata so retries package identical bytes, including hidden files.
  await mkdir(output, { recursive: true });
  const archive = `holter-diary-${version}.tar.gz`;
  execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '--mode=u=rwX,go=rX', '-czf', join(output, archive), '-C', dist, '.']);
  const digest = sha256(await readFile(join(output, archive)));
  await writeFile(join(output, 'SHA256SUMS'), `${digest}  ${archive}\n`);
  await writeFile(join(output, 'release.json'), JSON.stringify({ version, sourceSha, archive, sha256: digest }, null, 2) + '\n');
  return { version, sourceSha, archive, sha256: digest };
}
export async function releaseFiles(root, sha) {
  const version = await packageVersion(root), output = join(root, 'release'), manifest = await json(join(output, 'release.json'));
  const archive = `holter-diary-${version}.tar.gz`;
  assert(manifest.version === version && manifest.sourceSha === sha && manifest.archive === archive, 'Release identity mismatch.');
  const assets = await Promise.all([archive, 'SHA256SUMS', 'release.json'].map(async name => {
    const bytes = await readFile(join(output, name)); return { name, bytes, size: bytes.length, digest: `sha256:${sha256(bytes)}` };
  }));
  assert(manifest.sha256 === assets[0].digest.slice(7) && assets[1].bytes.toString() === `${manifest.sha256}  ${archive}\n`, 'Release checksum mismatch.');
  const notes = await readFile(join(root, 'releases', `${version}.md`), 'utf8');
  assert(notes.trim().length >= 20, 'Reviewed release notes are required.');
  return { version, assets, notes };
}
export function githubApi(token) {
  assert(token, 'Missing release token.');
  return async (method, path, body, binary = false) => {
    const url = new URL(path.startsWith('https:') ? path : `https://api.github.com${path}`);
    assert(['https://api.github.com', 'https://uploads.github.com'].includes(url.origin), 'Unexpected API origin.');
    const response = await fetch(url, {
      method, redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(body === undefined ? {} : { 'Content-Type': binary ? 'application/octet-stream' : 'application/json' }) },
      body: body === undefined ? undefined : binary ? body : JSON.stringify(body),
    });
    if (method === 'GET' && response.status === 404) return null;
    assert(response.ok, `GitHub ${method} ${url.pathname} failed (${response.status}).`);
    return response.status === 204 ? null : response.json();
  };
}
export async function publish(root, env, api = githubApi(env.GH_TOKEN)) {
  const { sha, repo } = releaseContext(env), { version, assets, notes } = await releaseFiles(root, sha);
  const tag = `v${version}`, base = `/repos/${repo}`, prerelease = version.includes('-');
  let reference = await api('GET', `${base}/git/ref/tags/${tag}`);
  let release = await api('GET', `${base}/releases/tags/${tag}`);
  // The tag endpoint does not reliably return drafts. A write-token listing does.
  if (!release) {
    const matches = [];
    for (let page = 1; ; page++) {
      const batch = await api('GET', `${base}/releases?per_page=100&page=${page}`);
      assert(Array.isArray(batch), 'Could not inspect existing release drafts.');
      matches.push(...batch.filter(item => item.tag_name === tag));
      if (batch.length < 100) break;
    }
    assert(matches.length <= 1, 'Multiple releases use this tag.');
    release = matches[0];
  }
  // Only lightweight tags created at an exact commit are accepted by this workflow.
  if (reference) assert(reference.object?.type === 'commit', 'Release tag must point directly to a commit.');
  if (release) assert(release.tag_name === tag && release.prerelease === prerelease, 'Existing release identity mismatch.');
  if (release && !release.draft) {
    assert(reference && assets.every(asset => release.assets?.some(a => a.name === asset.name && a.state === 'uploaded')), 'Published release is incomplete.');
    console.log(`${tag} is already published; left unchanged.`); return 'existing';
  }
  if (reference) assert(reference.object.sha === sha, 'Existing tag points to another commit.');
  if (release) assert(release.target_commitish === sha, 'Draft belongs to another commit.');
  if (!reference) reference = await api('POST', `${base}/git/refs`, { ref: `refs/tags/${tag}`, sha });
  if (!release) {
    release = await api('POST', `${base}/releases`, {
      tag_name: tag, target_commitish: sha, name: `Holter Diary ${version}`, draft: true, prerelease,
      body: `${prerelease ? 'Preview release. Android acceptance remains in progress.\n\n' : ''}${notes.trim()}\n\nThe app archive is the exact CI-tested static build. SHA256SUMS and release.json identify its bytes and source commit.`,
    });
  }
  assert(Number.isSafeInteger(release.id) && release.id > 0, 'Invalid release identifier.');
  for (const asset of assets) {
    const existing = release.assets?.find(item => item.name === asset.name);
    if (existing) assert(existing.state === 'uploaded' && existing.size === asset.size && existing.digest === asset.digest, `Existing asset differs: ${asset.name}`);
    else {
      const uploaded = await api('POST', `https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`, asset.bytes, true);
      assert(uploaded.state === 'uploaded' && uploaded.size === asset.size && uploaded.digest === asset.digest, `Uploaded asset could not be verified: ${asset.name}`);
    }
  }
  // Recheck the tag before making the complete draft visible.
  const finalRef = await api('GET', `${base}/git/ref/tags/${tag}`);
  assert(finalRef?.object?.type === 'commit' && finalRef.object.sha === sha, 'Tag moved during publication.');
  await api('PATCH', `${base}/releases/${release.id}`, { draft: false, prerelease, make_latest: prerelease ? 'false' : 'true' });
  console.log(`Published ${tag} at ${sha}.`); return 'published';
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    if (process.argv[2] === 'prepare') await prepare(process.cwd(), process.env.GITHUB_SHA);
    else if (process.argv[2] === 'publish') await publish(process.cwd(), process.env);
    else throw new Error('Use prepare or publish.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
