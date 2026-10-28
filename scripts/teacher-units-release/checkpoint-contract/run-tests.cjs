'use strict';
// Trusted local launcher. Tests load only after the canonical Seatbelt profile
// applies; no cloud clients, credential environment, or unsandboxed fallback.
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const assert=require('node:assert/strict'), crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const root=fs.realpathSync(__dirname), repo=path.resolve(root,'../../..');
const manifest=JSON.parse(fs.readFileSync(path.join(root,'fixtures/manifest.json')));
const packet=fs.realpathSync(manifest.canonicalPacket), node=fs.realpathSync(manifest.node.path);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
assert.equal(process.argv.length,2,'no arguments; evidence is written to a fresh private /private/tmp directory');
assert.equal(process.platform,'darwin','macOS Seatbelt required; no fallback');
assert.equal(process.version,'v22.23.3','use the pinned Node 22 executable');
assert.equal(fs.realpathSync(process.execPath),node);
assert.equal(hash(fs.readFileSync(node)),manifest.node.sha256,'reviewed Node changed');
for(const [file,digest] of Object.entries(manifest.canonicalReadDependencies))
  assert.equal(hash(fs.readFileSync(path.join(packet,file))),digest,`canonical dependency changed: ${file}`);
for(const f of manifest.fixtures)
  assert.equal(hash(fs.readFileSync(path.join(root,'fixtures',f.file))),f.sha256,`fixture bytes changed: ${f.file}`);
assert.equal(hash(fs.readFileSync(path.join(repo,'scripts/teacher-units-release/option-b-observation.cjs'))),manifest.productionObserverSha256,'observer changed; review fixtures before rerunning');
function walk(base,dir=base,out={}) {
  for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
    const p=path.join(dir,e.name);
    if(e.isDirectory()) walk(base,p,out);
    else {const s=fs.lstatSync(p);out[path.relative(base,p)]={sha256:hash(fs.readFileSync(p)),mode:s.mode,mtimeMs:s.mtimeMs,...(e.isSymbolicLink()?{symlink:fs.readlinkSync(p)}:{})};}
  }
  return out;
}
function git(args) {
  const r=spawnSync('/usr/bin/git',['-C',repo,...args],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',GIT_OPTIONAL_LOCKS:'0'},maxBuffer:8*1024*1024});
  assert.equal(r.status,0,r.stderr||String(r.error));return r.stdout;
}
function inventory() {
  const files=[...new Set(git(['ls-files','-z','--cached','--others','--exclude-standard']).split('\0').filter(Boolean))].sort();
  return {packet:walk(packet),repository:{head:git(['rev-parse','HEAD']).trim(),branch:git(['branch','--show-current']).trim(),status:git(['status','--porcelain=v1','-z']),files:Object.fromEntries(files.map(f=>{const p=path.join(repo,f),s=fs.lstatSync(p);return [f,{sha256:hash(fs.readFileSync(p)),mode:s.mode,mtimeMs:s.mtimeMs,...(s.isSymbolicLink()?{symlink:fs.readlinkSync(p)}:{})}];}))}};
}
const evidence=fs.mkdtempSync('/private/tmp/lyfelabz-b6b4c-tests-');fs.chmodSync(evidence,0o700);
const scratch=fs.mkdtempSync('/private/tmp/b4c-'),work=path.join(scratch,'work'),protectedDir=path.join(scratch,'protected');
fs.mkdirSync(work,{mode:0o700});fs.mkdirSync(protectedDir,{mode:0o700});
for(const name of ['packet-fixture.json','repository-fixture.txt']) fs.writeFileSync(path.join(protectedDir,name),'protected disposable fixture\n',{mode:0o600});
fs.writeFileSync(path.join(work,'copy-source'),'disposable copy source\n',{mode:0o600});
fs.symlinkSync(protectedDir,path.join(work,'protected-alias'));
const before=inventory(),protectedBefore=walk(protectedDir);
const env={PATH:'/usr/bin:/bin',LANG:'C',TMPDIR:work,B6B2_PACKET:packet,B6B2_REPOSITORY:repo,B6B2_WORK:work,B6B2_PROTECTED:protectedDir,B6B4C_ISOLATED:'1'};
const launch=file=>spawnSync('/usr/bin/sandbox-exec',['-D','NODE='+node,'-D','WORK='+work,'-f',path.join(packet,'tools/test-isolation.sb'),node,'--test','--experimental-test-isolation=none','--test-concurrency=1','--test-reporter=tap',file],{cwd:repo,env,stdio:['ignore','pipe','pipe'],encoding:'utf8',timeout:60000,maxBuffer:8*1024*1024});
let tap='';
try {
  const boundary=launch(path.join(packet,'tests/isolation.test.cjs'));
  tap+='# Unmodified canonical OS boundary suite\n'+(boundary.stdout||'')+(boundary.stderr||'')+(boundary.error?String(boundary.error)+'\n':'');
  let focused;
  if(boundary.status===0) {
    focused=launch(path.join(root,'test.cjs'));
    tap+='# B6b-4C focused rejection suite\n'+(focused.stdout||'')+(focused.stderr||'')+(focused.error?String(focused.error)+'\n':'');
  }
  const after=inventory();
  const result={kind:'b6b4c-offline-test-result-v1',authority:'none',independentReview:'pending',capturedAt:new Date().toISOString(),platform:process.platform,osRelease:os.release(),node:process.version,testConcurrency:1,boundaryExit:boundary.status,focusedExit:focused?.status??null,packetPreserved:JSON.stringify(before.packet)===JSON.stringify(after.packet),repositoryPreserved:JSON.stringify(before.repository)===JSON.stringify(after.repository),protectedFixturesPreserved:JSON.stringify(protectedBefore)===JSON.stringify(walk(protectedDir)),network:'OS deny; numeric loopback boundary canaries only',writes:'trusted parent evidence after child termination; children disposable work only',providerOperations:0};
  result.passed=result.boundaryExit===0&&result.focusedExit===0&&result.packetPreserved&&result.repositoryPreserved&&result.protectedFixturesPreserved;
  for(const [name,value] of [['before.json',before],['after.json',after],['result.json',result]]) fs.writeFileSync(path.join(evidence,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
  fs.writeFileSync(path.join(evidence,'tests.tap'),tap,{mode:0o600});
  process.stdout.write(tap+'# Result '+JSON.stringify(result)+'\n# Evidence '+evidence+'\n');
  if(!result.passed) process.exitCode=1;
} finally {fs.rmSync(scratch,{recursive:true,force:true});}
