import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { selectRelease } from '../../scripts/select-app-release.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t, failure) {
  const root = await mkdtemp(join(tmpdir(), 'website-selection-')); t.after(() => rm(root, {recursive:true,force:true}));
  const app=join(root,'input'), site=join(root,'website');await mkdir(join(app,'app'),{recursive:true});await mkdir(site);
  const version='0.1.0-beta.2', sha='a'.repeat(40), archive=`holter-diary-${version}.tar.gz`;
  for(const [name,text] of Object.entries({'app/version.json':JSON.stringify({version}),'app/index.html':'App','sw.js':'worker','manifest.webmanifest':'{}','.nojekyll':''})) await writeFile(join(app,name),text);
  for(const name of ['guide','faq']) {await mkdir(join(site,name));await writeFile(join(site,name,'index.html'),name);}
  for(const [name,text] of Object.entries({'index.html':'Website','style.css':'body{}','site.js':'__APP_RELEASE_VERSION__','app-release.json':JSON.stringify({version})})) await writeFile(join(site,name),text);
  if(failure==='path') await writeFile(join(app,'unexpected.txt'),'no');
  if(failure==='link') { const {symlink}=await import('node:fs/promises');await symlink('index.html',join(app,'app/link')); }
  execFileSync('tar',['-czf',join(root,archive),'-C',app,'.']);
  const bytes=await readFile(join(root,archive)), digest=hash(bytes);
  await writeFile(join(root,'SHA256SUMS'),`${digest}  ${archive}\n`);
  await writeFile(join(root,'release.json'),JSON.stringify({version,sourceSha:failure==='commit'?'b'.repeat(40):sha,archive,sha256:digest}));
  const assets=await Promise.all([archive,'SHA256SUMS','release.json'].map(async name=>({name,state:'uploaded',digest:'sha256:'+hash(await readFile(join(root,name)))})));
  if(failure==='digest') assets[0].digest='sha256:'+'0'.repeat(64);
  const api=async(_method,path)=>path.includes('/releases/')?{tag_name:`v${version}`,draft:failure==='draft',assets}:{object:{type:'commit',sha}};
  const run=(_command,args)=>{const name=args[args.indexOf('--pattern')+1],dir=args[args.indexOf('--dir')+1];execFileSync('cp',[join(root,name),join(dir,name)]);};
  return {root,api,run,app,version};
}
test('website copies the exact selected published app without rebuilding',async t=>{
 const f=await fixture(t);await selectRelease(f.root,{GITHUB_REPOSITORY:'example/diary'},f.api,f.run);
 for(const name of ['sw.js','manifest.webmanifest','app/index.html','app/version.json']) assert.deepEqual(await readFile(join(f.root,'site-dist',name)),await readFile(join(f.app,name)));
 assert.equal(await readFile(join(f.root,'site-dist/site.js'),'utf8'),f.version);
});
for(const failure of ['draft','digest','commit','path','link']) test(`website rejects release ${failure}`,async t=>{
 const f=await fixture(t,failure);await assert.rejects(selectRelease(f.root,{GITHUB_REPOSITORY:'example/diary'},f.api,f.run));
});
