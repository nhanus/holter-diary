import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

async function files(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async item => item.isDirectory()
    ? files(join(dir, item.name), prefix + item.name + '/') : [prefix + item.name]));
  return nested.flat();
}
const assets = (await files('dist')).filter(x => x !== 'sw.js' && x !== '.nojekyll').sort();
const hash = createHash('sha256');
const integrity = {};
for (const asset of assets) {
  const bytes = await readFile(join('dist', asset));
  hash.update(asset); hash.update(bytes);
  integrity[asset] = 'sha256-' + createHash('sha256').update(bytes).digest('base64');
}
const version = hash.digest('hex').slice(0, 16);
const worker = `// Generated from the complete static build. No diary content is cached here.
const assets = ${JSON.stringify(assets)};
const prefix = 'holter-diary:' + self.registration.scope + ':';
const cacheName = prefix + ${JSON.stringify(version)};
const urls = assets.map(path => new URL(path, self.registration.scope).href);
const integrity = ${JSON.stringify(integrity)};
const expectedIntegrity = Object.fromEntries(urls.map((url, i) => [url, integrity[assets[i]]]));
const assetRequest = url => new Request(url, {cache: 'reload', integrity: expectedIntegrity[url]});
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    await cache.addAll(urls.map(assetRequest));
  })());
});
self.addEventListener('activate', event => {
  // Retain previous versions so another open tab can finish its work safely.
  // IndexedDB is deliberately never touched by service-worker lifecycle events.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') self.skipWaiting();
  if (event.data?.type === 'CHECK_READY') event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    const missing = [];
    for (const url of urls) if (!(await cache.match(url))) missing.push(url);
    if (event.data.repair && missing.length) {
      try { await cache.addAll(missing.map(assetRequest)); }
      catch { /* Offline or failed fetch: readiness remains false. */ }
    }
    const ready = (await Promise.all(urls.map(url => cache.match(url)))).every(Boolean);
    event.ports[0]?.postMessage({ready, version: ${JSON.stringify(version)}});
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith((async () => {
    const root = self.registration.scope;
    const key = event.request.mode === 'navigate' &&
      (url.pathname === new URL(root).pathname || url.pathname === new URL('index.html', root).pathname)
      ? new URL('index.html', root).href : event.request.url;
    const cache = await caches.open(cacheName);
    const cached = await cache.match(key);
    if (cached) return cached;
    // Old hashed assets can still be needed by a previously opened tab.
    for (const name of (await caches.keys()).filter(name => name.startsWith(prefix)).reverse()) {
      const previous = await (await caches.open(name)).match(key);
      if (previous) return previous;
    }
    return fetch(event.request);
  })());
});
`;
await writeFile('dist/sw.js', worker);
await writeFile('dist/.nojekyll', '');
console.log(`Prepared offline build: ${assets.length} assets (${version})`);
