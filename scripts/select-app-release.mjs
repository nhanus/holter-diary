import { readFile, mkdir, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubApi } from './release.mjs';
import { assembleWebsite } from './build-website.mjs';

// Website publication consumes an immutable published app; it never rebuilds it.
export async function selectRelease(root, env, api = githubApi(env.GH_TOKEN), run = execFileSync) {
  const { version } = JSON.parse(await readFile(join(root, 'website/app-release.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(version)) throw new Error('Invalid selected release.');
  const repo = env.GITHUB_REPOSITORY;
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo ?? '')) throw new Error('Invalid repository.');
  const base = `/repos/${repo}`, tag = `v${version}`;
  const release = await api('GET', `${base}/releases/tags/${tag}`);
  const ref = await api('GET', `${base}/git/ref/tags/${tag}`);
  if (!release || release.draft || release.tag_name !== tag || ref?.object?.type !== 'commit') throw new Error('Selected app release is not published.');
  const dir = resolve(root, '.website-release');
  await rm(dir, { recursive: true, force: true }); await mkdir(dir);
  const archive = `holter-diary-${version}.tar.gz`, names = [archive, 'SHA256SUMS', 'release.json'];
  for (const name of names) {
    run('gh', ['release', 'download', tag, '--repo', repo, '--pattern', name, '--dir', dir], { stdio: 'inherit' });
    const digest = 'sha256:' + createHash('sha256').update(await readFile(join(dir, name))).digest('hex');
    if (!release.assets.some(asset => asset.name === name && asset.state === 'uploaded' && asset.digest === digest)) throw new Error('Published asset digest mismatch.');
  }
  const manifest = JSON.parse(await readFile(join(dir, 'release.json'), 'utf8'));
  const digest = createHash('sha256').update(await readFile(join(dir, archive))).digest('hex');
  if (manifest.version !== version || manifest.sourceSha !== ref.object.sha || manifest.archive !== archive || manifest.sha256 !== digest || await readFile(join(dir, 'SHA256SUMS'), 'utf8') !== `${digest}  ${archive}\n`) throw new Error('Selected release identity mismatch.');
  const paths = execFileSync('tar', ['-tzf', join(dir, archive)], { encoding: 'utf8' }).trim().split('\n');
  if (paths.some(path => !/^\.\/(?:app(?:\/[^\n]*)?|sw\.js|manifest\.webmanifest|\.nojekyll)?$/.test(path) || path.split('/').some(part => part === '..'))) throw new Error('Unexpected archive path.');
  const types = execFileSync('tar', ['-tvzf', join(dir, archive)], { encoding: 'utf8' }).trim().split('\n');
  if (types.some(line => !['-', 'd'].includes(line[0]))) throw new Error('Unexpected archive member type.');
  const unpacked = join(dir, 'unpacked'); await mkdir(unpacked);
  execFileSync('tar', ['-xzf', join(dir, archive), '--no-same-owner', '-C', unpacked]);
  await assembleWebsite(unpacked, join(root, 'site-dist'), join(root, 'website'));
  console.log(`Selected ${tag} from ${manifest.sourceSha}.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await selectRelease(process.cwd(), process.env);
