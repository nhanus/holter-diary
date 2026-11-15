import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { githubApi, releaseContext } from './release.mjs';

// A rerun retains its original SHA. Never let it replace a newer main deployment.
export async function mayDeploy(env, api) {
  if (env.PAGES_ENABLED !== 'true') return false;
  const { sha, repo } = releaseContext(env);
  const reference = await (api ?? githubApi(env.GH_TOKEN))('GET', `/repos/${repo}/git/ref/heads/main`);
  if (reference?.object?.type !== 'commit' || !/^[0-9a-f]{40}$/.test(reference.object.sha ?? '')) {
    throw new Error('Cannot verify the current main commit; deployment stopped.');
  }
  return reference.object.sha === sha;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const eligible = await mayDeploy(process.env);
  await appendFile(process.env.GITHUB_OUTPUT, `eligible=${eligible}\n`);
  if (!eligible) console.log('::notice::Pages deployment skipped: disabled or superseded by a newer main commit.');
}
