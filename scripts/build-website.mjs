import { cp, readFile, writeFile, readdir, rm, mkdir } from 'node:fs/promises';
import { resolve, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
export async function assembleWebsite(appDir = 'dist', output = 'site-dist', websiteDir = 'website') {
  const app = resolve(appDir), out = resolve(output), site = resolve(websiteDir);
  if ([app, site].some(dir => dir === out || dir.startsWith(out + sep) || out.startsWith(dir + sep))) throw new Error('Build inputs and output must be separate.');
  const selected = JSON.parse(await readFile(join(site, 'app-release.json'), 'utf8'));
  const version = JSON.parse(await readFile(join(app, 'app/version.json'), 'utf8')).version;
  if (version !== selected.version) throw new Error('Selected app release does not match the supplied app package.');
  for (const file of await readdir(site)) if (!['index.html', 'guide', 'faq', 'site.js', 'style.css', 'app-release.json', 'screenshots'].includes(file)) throw new Error('Unexpected website source.');
  await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
  for (const file of ['app', 'sw.js', 'manifest.webmanifest', '.nojekyll']) await cp(join(app, file), join(out, file), { recursive: true });
  for (const file of ['index.html', 'guide', 'faq', 'style.css', 'screenshots']) await cp(join(site, file), join(out, file), { recursive: true });
  const script = (await readFile(join(site, 'site.js'), 'utf8')).replaceAll('__APP_RELEASE_VERSION__', version);
  await writeFile(join(out, 'site.js'), script);
  console.log(`Assembled website with app ${version} in ${relative(process.cwd(), out)}; app bytes copied unchanged.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await assembleWebsite(process.argv[2], process.argv[3]);
