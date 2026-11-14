import { readdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

async function files(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async item => item.isDirectory()
    ? files(join(dir, item.name), prefix + item.name + '/') : [prefix + item.name]));
  return nested.flat();
}
await rename('dist/app/manifest.webmanifest', 'dist/manifest.webmanifest');
const appVersion = JSON.parse(await readFile('dist/app/version.json', 'utf8')).version;
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
    event.ports[0]?.postMessage({ready, appVersion: ${JSON.stringify(appVersion)}, version: ${JSON.stringify(version)}});
  })());
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  const root = self.registration.scope;
  if (event.request.method !== 'GET' || !url.href.startsWith(root)) return;
  const appRoot = new URL('app/', root);
  const rootNavigation = event.request.mode === 'navigate' &&
    (url.pathname === new URL(root).pathname || url.pathname === new URL('index.html', root).pathname);
  // A delayed installed start URL can still point at the old root. Never use
  // its old cached index for the website; offline launches go to the diary.
  if (rootNavigation) {
    event.respondWith(fetch(event.request).then(response => response.ok ? response : Response.redirect(appRoot.href))
      .catch(() => Response.redirect(appRoot.href)));
    return;
  }
  const appRequest = url.pathname.startsWith(appRoot.pathname);
  const legacyAsset = url.pathname.startsWith(new URL('assets/', root).pathname);
  const manifest = url.pathname === new URL('manifest.webmanifest', root).pathname;
  if (!appRequest && !legacyAsset && !manifest) return;
  event.respondWith((async () => {
    const key = event.request.mode === 'navigate' &&
      (url.pathname === appRoot.pathname || url.pathname === new URL('index.html', appRoot).pathname)
      ? new URL('index.html', appRoot).href : event.request.url;
    const cached = await (await caches.open(cacheName)).match(key);
    if (cached) return cached;
    // Previous immutable hashed assets support tabs that still run an older app.
    // Never fall back to old HTML, manifests or mutable metadata.
    if (legacyAsset || url.pathname.startsWith(new URL('assets/', appRoot).pathname)) {
      for (const name of (await caches.keys()).filter(name => name.startsWith(prefix)).reverse()) {
        const previous = await (await caches.open(name)).match(key);
        if (previous) return previous;
      }
    }
    return fetch(event.request);
  })());
});
`;
await writeFile('dist/sw.js', worker);
await writeFile('dist/.nojekyll', '');
console.log(`Prepared offline build: ${assets.length} assets (${version})`);
