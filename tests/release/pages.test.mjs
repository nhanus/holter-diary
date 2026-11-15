import test from 'node:test';
import assert from 'node:assert/strict';
import { mayDeploy } from '../../scripts/check-pages-deployment.mjs';

const sha = 'a'.repeat(40);
const env = { PAGES_ENABLED: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/main',
  GITHUB_SHA: sha, GITHUB_REPOSITORY: 'example/diary' };
const unexpectedApi = () => { throw new Error('Unexpected API request'); };

test('the current main deployment checks the exact repository reference', async () => {
  assert.equal(await mayDeploy(env, async (method, path) => {
    assert.equal(method, 'GET'); assert.equal(path, '/repos/example/diary/git/ref/heads/main');
    return { object: { type: 'commit', sha } };
  }), true);
});

test('an older run cannot replace the current main deployment', async () => {
  assert.equal(await mayDeploy(env, async () => ({ object: { type: 'commit', sha: 'b'.repeat(40) } })), false);
});

test('Pages must be explicitly enabled before contacting GitHub', async () => {
  for (const value of [undefined, '', 'false', 'TRUE']) {
    assert.equal(await mayDeploy({ ...env, PAGES_ENABLED: value }, unexpectedApi), false);
  }
});

test('PRs, schedules, manual calls and other branches cannot deploy', async () => {
  for (const patch of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_EVENT_NAME: 'schedule' },
    { GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_REF: 'refs/heads/feature' },
    { GITHUB_SHA: 'main' }, { GITHUB_REPOSITORY: 'example/diary/extra' }]) {
    await assert.rejects(() => mayDeploy({ ...env, ...patch }, unexpectedApi), /Only a main push|Invalid/);
  }
});

test('missing or malformed main references stop deployment', async () => {
  for (const reference of [null, {}, { object: { type: 'tag', sha } }, { object: { type: 'commit', sha: 'main' } }]) {
    await assert.rejects(() => mayDeploy(env, async () => reference), /Cannot verify/);
  }
});

test('GitHub API failures stop deployment instead of assuming eligibility', async () => {
  await assert.rejects(() => mayDeploy(env, async () => { throw new Error('GitHub unavailable'); }), /GitHub unavailable/);
});
