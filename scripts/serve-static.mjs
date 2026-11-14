// Development/test server only. Production hosting serves the packaged files.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
const args = process.argv.slice(2);
const option = (key, fallback) => args.includes(key) ? args[args.indexOf(key) + 1] : fallback;
const root = resolve(option('--dir', 'dist')), host = option('--host', '127.0.0.1');
const port = Number(option('--port', '4174')), prefix = '/holter-diary/';
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid preview port');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.txt': 'text/plain' };
createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    const url = new URL(req.url, 'http://preview.invalid');
    if (url.pathname === '/holter-diary') { res.writeHead(302, { Location: prefix + url.search }).end(); return; }
    if (!url.pathname.startsWith(prefix)) { res.writeHead(404).end(); return; }
    let file = resolve(root, decodeURIComponent(url.pathname.slice(prefix.length)));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    if ((await stat(file)).isDirectory()) {
      if (!url.pathname.endsWith('/')) { res.writeHead(302, { Location: url.pathname + '/' + url.search }).end(); return; }
      file = resolve(file, 'index.html');
    }
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404).end(); }
}).listen(port, host, () => console.log(`Preview: http://${host}:${port}${prefix}`));
