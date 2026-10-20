/** @jest-environment node */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const esbuild = require('esbuild');
const ts = require('typescript');
const { hostingCandidate } = require('../../scripts/hosting-release/backend-state.cjs');
const { build, compile, verify, checkSource } = require('./build-application.cjs');
const ROOT = path.resolve(__dirname,'../..');
function fixture(entry) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'u26-build-contract-'));
  const directory=path.join(root,'app/src/teacherUnits');fs.mkdirSync(directory,{recursive:true});
  fs.copyFileSync(path.join(ROOT,'app/index.html'),path.join(root,'app/index.html'));
  for(const file of ['releaseAvailability.ts','releaseBoundary.ts'])fs.copyFileSync(path.join(ROOT,'app/src/teacherUnits',file),path.join(directory,file));
  fs.writeFileSync(path.join(root,'app/src/index.ts'),entry);
  return root;
}
const IMPORT='import { teacherUnitsReleaseBoundary } from "./teacherUnits/releaseBoundary"; import { teacherUnitsAvailable, requireTeacherUnitsAvailable } from "./teacherUnits/releaseAvailability";';
const SAFE=IMPORT+' globalThis.result = teacherUnitsReleaseBoundary(() => { throw new Error("constructed"); });';
async function withFixture(entry, run) { const root=fixture(entry);try { await run(root); }finally {fs.rmSync(root,{recursive:true,force:true});} }
function execute(bundle) {const context={};vm.runInNewContext(bundle.toString(),context);return context;}
for(const intent of ['general','teacher-units']) test(`${intent} controlled compiler emits closed behavior and deterministic evidence`,async()=>withFixture(SAFE,async root=>{
  const first=await build(root,intent); const second=await verify(root,intent);
  expect(second).toEqual(first);expect(first.availability).toBe('closed');expect(first.releaseIntent).toBe(intent);
  expect(first.availabilityEvidence).toBe('build-contract-assertion');
  expect(first.runtimeAvailability).toBe('not-certified');
  expect(first.canonicalAvailability.identity).toBe('app/src/teacherUnits/releaseAvailability.ts');
  expect(first.canonicalAvailability.resolvedImports.length).toBeGreaterThan(0);
  expect(execute(fs.readFileSync(path.join(root,'app/dist/bundle.js'))).result).toBeNull();
}));
// Staging UX test intent (docs/platform/TEACHER_UNITS_STAGING_UX_TEST_DESIGN.md): open only on the staging origin.
test('staging-ux-test intent opens only on the exact staging origin, with distinct evidence',async()=>withFixture(IMPORT+' globalThis.result = teacherUnitsReleaseBoundary(() => "constructed" as never);',async root=>{
  const first=await build(root,'staging-ux-test'); const second=await verify(root,'staging-ux-test');
  expect(second).toEqual(first);
  expect(first).toMatchObject({releaseIntent:'staging-ux-test',availability:'staging-ux-test',policy:'teacher-units-staging-ux-test-v1',runtimeAvailability:'not-certified'});
  const bundle=fs.readFileSync(path.join(root,'app/dist/bundle.js')).toString();
  const run=origin=>{const context=origin===undefined?{}:{location:{origin}};vm.runInNewContext(bundle,context);return context.result;};
  expect(run('https://lyfelabz-staging.web.app')).toBe('constructed');
  for(const origin of [undefined,'https://app.lyfelabz.com','https://lyfelabz-staging.firebaseapp.com','http://localhost:5000','https://lyfelabz-staging.web.app.evil.test']) expect([origin,run(origin)]).toEqual([origin,null]);
  // Evidence from one intent never verifies as another.
  await expect(verify(root,'general')).rejects.toThrow('REFUSED');
  await build(root,'general'); await expect(verify(root,'staging-ux-test')).rejects.toThrow('REFUSED');
}));
test('a general build relabelled as staging-ux-test availability cannot verify',async()=>withFixture(SAFE,async root=>{
  await build(root,'general'); const record=path.join(root,'app/dist/application-build.json');const evidence=JSON.parse(fs.readFileSync(record));
  evidence.availability='staging-ux-test'; fs.writeFileSync(record,JSON.stringify(evidence));
  await expect(verify(root,'general')).rejects.toThrow('REFUSED');
}));
// Known-pattern regressions invoke the authoritative boundary in actual emitted JS.
for(const [label,condition] of [['commented false with effective typed true','/* const TEACHER_UNITS_GATE_OPEN = false; */ const TEACHER_UNITS_GATE_OPEN: boolean = true;'],['inverted condition','const TEACHER_UNITS_GATE_OPEN = !teacherUnitsAvailable();'],['unconditional construction','const TEACHER_UNITS_GATE_OPEN = true;']]) test(label,async()=>withFixture(IMPORT+condition+' globalThis.result = TEACHER_UNITS_GATE_OPEN ? teacherUnitsReleaseBoundary(() => { throw new Error("constructed"); }) : "unused";',async root=>{
  const {bundle}=await compile(root,'general');expect(execute(bundle).result).toBeNull();
}));
test('independent guarded construction throws before side effects in emitted code',async()=>withFixture(IMPORT+' globalThis.result=teacherUnitsReleaseBoundary(()=>null as never); requireTeacherUnitsAvailable(); globalThis.effect=true;',async root=>{
  const {bundle}=await compile(root,'general'); const context={};
  expect(()=>vm.runInNewContext(bundle.toString(),context)).toThrow('unavailable');expect(context.effect).toBeUndefined();
}));
test('compiler overrides a substituted enabled source availability module',async()=>withFixture(SAFE,async root=>{
  fs.writeFileSync(path.join(root,'app/src/teacherUnits/releaseAvailability.ts'),'export function teacherUnitsAvailable(){return true;} export function requireTeacherUnitsAvailable(){}');
  const {bundle}=await compile(root,'general');expect(execute(bundle).result).toBeNull();
}));
test('unreviewed external entry path is refused by actual compiler import graph',async()=>withFixture('import "./alternate";',async root=>{
  fs.writeFileSync(path.join(root,'app/src/alternate.ts'),SAFE);
  await expect(compile(root,'general')).rejects.toThrow('unreviewed Teacher Units entry path');
}));
test('test providers cannot enter production graph',async()=>withFixture('import "./x.test";'+SAFE,async root=>{
  fs.writeFileSync(path.join(root,'app/src/x.test.ts'),'console.log("test provider")');
  await expect(compile(root,'general')).rejects.toThrow('unapproved production input');
}));
test('missing evidence refuses instead of treating source as authority',async()=>withFixture(SAFE,async root=>{await expect(verify(root,'general')).rejects.toThrow('missing');}));
test('unknown intent refuses',async()=>withFixture(SAFE,async root=>{await expect(compile(root,'unknown')).rejects.toThrow('unknown release intent');}));
for(const mutation of ['bundle','enabled','unknown','fingerprint','intent','source','missing','runtime-claim','canonical-identity','replacement','resolved-import','source-contract','filename-policy','v3-schema']) test(`changed ${mutation} cannot verify a prepared build`,async()=>withFixture(SAFE,async root=>{
  await build(root,'general'); const record=path.join(root,'app/dist/application-build.json');const evidence=JSON.parse(fs.readFileSync(record));
  if(mutation==='bundle')fs.appendFileSync(path.join(root,'app/dist/bundle.js'),'globalThis.unsafe=true;');
  if(mutation==='enabled'||mutation==='unknown')evidence.availability=mutation;
  if(mutation==='fingerprint')evidence.outputs['app/dist/bundle.js']='f'.repeat(64);
  if(mutation==='intent')evidence.releaseIntent='teacher-units';
  if(mutation==='runtime-claim')evidence.availabilityEvidence='verified-runtime';
  if(mutation==='canonical-identity')evidence.canonicalAvailability.identity='alternate.ts';
  if(mutation==='replacement')evidence.canonicalAvailability.replacementHash='0'.repeat(64);
  if(mutation==='resolved-import')evidence.canonicalAvailability.resolvedImports=[];
  if(mutation==='source-contract')evidence.sourceContract.extensions.push('.tsx');
  if(mutation==='filename-policy')evidence.sourceContract.filenameComponents='unicode-allowed';
  if(mutation==='v3-schema')evidence.schemaVersion=1;
  if(mutation==='source')fs.appendFileSync(path.join(root,'app/src/index.ts'),'console.log("stale");');
  fs.writeFileSync(record,JSON.stringify(evidence));if(mutation==='missing')fs.unlinkSync(record);
  await expect(verify(root,'general')).rejects.toThrow('REFUSED');
}));

test('actual compiled exported constructors refuse alternate and unconditional construction',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'u26-real-boundaries-'));
  try {
    fs.mkdirSync(path.join(root,'app'),{recursive:true});
    fs.copyFileSync(path.join(ROOT,'app/index.html'),path.join(root,'app/index.html'));
    fs.cpSync(path.join(ROOT,'app/src'),path.join(root,'app/src'),{recursive:true});
    fs.symlinkSync(path.join(ROOT,'app/node_modules'),path.join(root,'app/node_modules'),'dir');
    fs.writeFileSync(path.join(root,'app/src/index.ts'),`
      import {teacherUnitsReleaseBoundary} from './teacherUnits/releaseBoundary';
      import {createTeacherUnitsController, createTeacherUnitsSurfaceSeam} from './teacherUnits/unitsController';
      import {createTeacherUnitCreateAttemptStore} from './teacherUnits/createAttemptStore';
      import {createFirebaseTeacherUnitsCallables} from './teacherUnits/wire';
      import {renderCurriculumSurface} from './shell/surfaces/curriculum';
      import {renderTeacherUnitsPanel} from './shell/surfaces/teacherUnitsPanel';
      import {renderMyUnitsSurface} from './shell/surfaces/myUnits';
      const deps = new Proxy({}, {get(){throw new Error('dependency touched');}});
      const mount=document.createElement('div'); document.body.appendChild(mount);
      const teacher={kind:'activeTeacher',uid:'teacher',schoolId:'school',displayName:'Teacher'} as const;
      renderCurriculumSurface(mount, teacher, {listClasses:()=>Promise.resolve([])});
      renderMyUnitsSurface(mount, teacher, {teacherUnits:{createController(){throw new Error('injected seam touched');}}});
      globalThis.viewSwitch = !!mount.querySelector('[data-testid=curriculum-view-switch], [data-testid=units-panel]');
      globalThis.renderedText = mount.textContent;
      globalThis.results = [teacherUnitsReleaseBoundary(()=>{throw new Error('factory touched');})];
      for (const create of [()=>createTeacherUnitsController(deps as never),()=>createTeacherUnitsSurfaceSeam(deps as never),()=>createTeacherUnitCreateAttemptStore(deps as never),()=>createFirebaseTeacherUnitsCallables(deps as never),()=>renderTeacherUnitsPanel(deps as never,deps as never)]) {
        try {create(); globalThis.results.push('enabled');} catch(error) {globalThis.results.push(error.message);}
      }
    `);
    const {bundle}=await compile(root,'general');
    const dom = new JSDOM('<!doctype html><body></body>', {url:'https://app.lyfelabz.com/app/',runScripts:'outside-only'});
    try {
      Object.assign(dom.window, {fetch:()=>{throw new Error('network touched');},TextEncoder,TextDecoder});
      vm.runInContext(bundle.toString(),dom.getInternalVMContext());
      expect(dom.window.location.hostname).toBe('app.lyfelabz.com');
      expect(Array.from(dom.window.results)).toEqual([null,...new Array(5).fill('Teacher Units unavailable in this release')]);
      expect(dom.window.viewSwitch).toBe(false);
      expect(dom.window.renderedText).not.toContain('My Units');
    } finally {dom.window.close();}
    // Exact hostname attack against the real teacher shell (its My Units
    // navigation gate), not just a label.
    fs.writeFileSync(path.join(root,'app/src/index.ts'),`
      import {mountTeacherShell} from './shell/shell';
      const mount=document.createElement('div'); document.body.appendChild(mount);
      mountTeacherShell({kind:'activeTeacher',uid:'teacher',schoolId:'school',displayName:'Teacher'}, mount, {onSignOut(){},onLaunchPresentMode(){},teacherUnits:{createController(){throw new Error('unexpected lazy construction');}},listClasses:()=>Promise.resolve([])});
    `);
    fs.writeFileSync(path.join(root,'app/src/teacherUnits/releaseAvailability.tsx'),
      'export function teacherUnitsAvailable(){return location.hostname === "app.lyfelabz.com";} export function requireTeacherUnitsAvailable(){}');
    const raw=await esbuild.build({absWorkingDir:path.join(root,'app'),entryPoints:['src/index.ts'],bundle:true,format:'esm',target:'es2022',write:false,preserveSymlinks:true});
    for (const hostname of ['app.lyfelabz.com','localhost']) {
      const browser=new JSDOM('<!doctype html><body></body>',{url:`https://${hostname}/app/`,runScripts:'outside-only'});
      try {
        Object.assign(browser.window,{fetch:()=>{throw new Error('network touched');},TextEncoder,TextDecoder});
        vm.runInContext(raw.outputFiles[0].text,browser.getInternalVMContext());
        expect(!!browser.window.document.querySelector('[data-testid=nav-units]')).toBe(hostname==='app.lyfelabz.com');
        expect(browser.window.document.body.textContent.includes('My Units')).toBe(hostname==='app.lyfelabz.com');
      } finally {browser.window.close();}
    }
    await expect(build(root,'general')).rejects.toThrow('ambiguous/shadowing availability module');
    expect(fs.existsSync(path.join(root,'app/dist/bundle.js'))).toBe(false);
    expect(fs.existsSync(path.join(root,'app/dist/application-build.json'))).toBe(false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('alternate HTML script entry point cannot silently substitute the application bundle',async()=>withFixture(SAFE,async root=>{
  const file=path.join(root,'app/index.html');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('/app/dist/bundle.js','/assets/alternate.js'));
  await expect(compile(root,'general')).rejects.toThrow('unreviewed executable application HTML');
}));
test('new inline or additional application scripts require entry policy review',async()=>withFixture(SAFE,async root=>{
  fs.appendFileSync(path.join(root,'app/index.html'),'<script>globalThis.unitsEnabled=true;</script>');
  await expect(compile(root,'general')).rejects.toThrow('unreviewed executable application HTML');
}));

// Reproduce the resolver exploit with esbuild itself, then require the controlled
// builder to refuse before writing any candidate artifact. No source-text scan.
for (const [label,expression] of [['hostname-conditional', 'location.hostname === "app.lyfelabz.com"'], ['unconditional', 'true']]) {
  test(`${label} .tsx shadow enables raw emitted bundle but controlled builder refuses`,async()=>withFixture(
    IMPORT + ' globalThis.result = teacherUnitsReleaseBoundary(() => "Browse | My Units");', async root=>{
      fs.writeFileSync(path.join(root,'app/src/teacherUnits/releaseAvailability.tsx'),
        `export function teacherUnitsAvailable(){return ${expression};} export function requireTeacherUnitsAvailable(){}`);
      const raw=await esbuild.build({absWorkingDir:path.join(root,'app'),entryPoints:['src/index.ts'],bundle:true,format:'esm',write:false,metafile:true});
      expect(Object.keys(raw.metafile.inputs)).toContain('src/teacherUnits/releaseAvailability.tsx');
      const context={location:{hostname:'app.lyfelabz.com'}};
      vm.runInNewContext(raw.outputFiles[0].text,context);
      expect(context.result).toBe('Browse | My Units');
      await expect(build(root,'general')).rejects.toThrow('ambiguous/shadowing availability module');
      expect(fs.existsSync(path.join(root,'app/dist/application-build.json'))).toBe(false);
      expect(fs.existsSync(path.join(root,'app/dist/bundle.js'))).toBe(false);
    }));
}
for (const name of ['releaseAvailability.js','releaseAvailability.mts','releaseAvailability.cts','releaseAvailability.jsx','releaseAvailability.mjs','releaseAvailability.cjs','releaseAvailability.json','releaseAvailability.css','ReleaseAvailability.ts','releaseavailability.TSX']) {
  test(`alternate resolver candidate ${name} refuses`,async()=>withFixture(SAFE,async root=>{
    const canonical=path.join(root,'app/src/teacherUnits/releaseAvailability.ts');
    if (name === 'ReleaseAvailability.ts') fs.renameSync(canonical, canonical + '.held');
    fs.writeFileSync(path.join(root,'app/src/teacherUnits',name),'export const enabled=true;');
    if (name === 'ReleaseAvailability.ts') fs.unlinkSync(canonical + '.held');
    await expect(compile(root,'general')).rejects.toThrow('ambiguous/shadowing');
  }));
}
test('directory alternate resolution and duplicate module location refuse',async()=>withFixture(SAFE,async root=>{
  const directory=path.join(root,'app/src/releaseAvailability');fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory,'index.ts'),'export const enabled=true;');
  await expect(compile(root,'general')).rejects.toThrow('ambiguous/shadowing');
  fs.rmSync(directory,{recursive:true});
  fs.writeFileSync(path.join(root,'app/src/releaseAvailability.ts'),'export const enabled=true;');
  await expect(compile(root,'general')).rejects.toThrow('ambiguous/shadowing');
}));
for (const extension of ['.tsx','.jsx','.js','.mts','.cts','.mjs','.cjs','.css','.unknown']) {
  test(`unreviewed source extension ${extension} refuses even when not imported`,async()=>withFixture(SAFE,async root=>{
    fs.writeFileSync(path.join(root,'app/src','unimported'+extension),'');
    expect(()=>checkSource(root)).toThrow('unreviewed application source extension');
    await expect(compile(root,'general')).rejects.toThrow('unreviewed application source extension');
  }));
}
test('source symlink refuses instead of bypassing extension inventory',async()=>withFixture(SAFE,async root=>{
  fs.symlinkSync('releaseAvailability.ts',path.join(root,'app/src/teacherUnits/alias.ts'));
  await expect(compile(root,'general')).rejects.toThrow('symlink in application source');
}));
test('explicit canonical import is pinned to the same private implementation',async()=>withFixture((SAFE+' globalThis.available=teacherUnitsAvailable();').replace('"./teacherUnits/releaseAvailability"','"./teacherUnits/releaseAvailability.ts"'),async root=>{
  const {bundle,evidence}=await compile(root,'general');expect(execute(bundle).result).toBeNull();
  expect(evidence.canonicalAvailability.resolvedImports.some(i=>i.specifier.endsWith('.ts'))).toBe(true);
}));
test('case variant import refuses instead of accepting filesystem resolution',async()=>withFixture((SAFE+' globalThis.available=teacherUnitsAvailable();').replace('"./teacherUnits/releaseAvailability"','"./teacherUnits/ReleaseAvailability"'),async root=>{
  await expect(compile(root,'general')).rejects.toThrow('noncanonical availability import');
}));

test('tsconfig alias cannot load canonical source through the default file namespace',async()=>withFixture(SAFE+' import {teacherUnitsAvailable as alias} from "availabilityAlias"; globalThis.enabled=alias();',async root=>{
  fs.writeFileSync(path.join(root,'app/tsconfig.json'),JSON.stringify({compilerOptions:{baseUrl:'.',paths:{availabilityAlias:['src/teacherUnits/releaseAvailability.ts']}}}));
  fs.writeFileSync(path.join(root,'app/src/teacherUnits/releaseAvailability.ts'),'export function teacherUnitsAvailable(){return true;} export function requireTeacherUnitsAvailable(){}');
  await expect(compile(root,'general')).rejects.toThrow('availability import bypassed canonical resolution');
}));

test('canonical virtual identity and emitted bytes are portable across checkout roots',async()=>withFixture(SAFE,async first=>withFixture(SAFE,async second=>{
  const a=await compile(first,'general');const b=await compile(second,'general');
  expect(a.bundle.equals(b.bundle)).toBe(true);expect(a.evidence).toEqual(b.evidence);
  expect(a.bundle.toString()).not.toContain(first);expect(a.bundle.toString()).not.toContain(second);
})));

test('supported typecheck, lint and auxiliary builds refuse unreviewed extensions before their tools run',async()=>withFixture(SAFE,async root=>{
  const app=path.join(root,'app');fs.mkdirSync(path.join(app,'scripts'));
  fs.copyFileSync(path.join(ROOT,'app/scripts/build-application.cjs'),path.join(app,'scripts/build-application.cjs'));
  fs.copyFileSync(path.join(ROOT,'app/package.json'),path.join(app,'package.json'));
  fs.symlinkSync(path.join(ROOT,'app/node_modules'),path.join(app,'node_modules'),'dir');
  fs.writeFileSync(path.join(app,'src/unreviewed.js'),'globalThis.enabled=true;');
  for (const command of ['typecheck','lint','build:runtime','build:lab-report-cloud']) {
    const result=spawnSync('npm',['--prefix',app,'run',command],{encoding:'utf8',timeout:10000});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('REFUSED: unreviewed application source extension: app/src/unreviewed.js');
  }
}));

// Browser mappings and nested paths alter esbuild's resolution while the root
// verification project/Jest still use the original implementation. All writes
// below stay in disposable fixture directories, including the synthetic package.
function jsonResolutionFixture(root, kind) {
  const app=path.join(root,'app');
  fs.mkdirSync(path.join(app,'scripts'));
  fs.copyFileSync(path.join(ROOT,'app/scripts/build-application.cjs'),path.join(app,'scripts/build-application.cjs'));
  for (const file of ['package.json','tsconfig.json','.eslintrc.cjs']) fs.copyFileSync(path.join(ROOT,'app',file),path.join(app,file));
  fs.mkdirSync(path.join(app,'node_modules'));
  for (const name of fs.readdirSync(path.join(ROOT,'app/node_modules'))) fs.symlinkSync(path.join(ROOT,'app/node_modules',name),path.join(app,'node_modules',name));
  // A type-only stub lets these small compiler fixtures use the real lazy gate.
  fs.writeFileSync(path.join(app,'src/teacherUnits/unitsController.ts'),'export type TeacherUnitsSurfaceSeam = never;');
  const boundary='import {teacherUnitsReleaseBoundary} from "./teacherUnits/releaseBoundary"; Object.assign(globalThis,{result:teacherUnitsReleaseBoundary(()=>null as never)});';
  let config,consumer,specifier;
  if (kind==='package') {
    fs.writeFileSync(path.join(app,'src/original.ts'),'export const marker="original";');
    fs.writeFileSync(path.join(app,'src/redirected.ts'),'export const marker="redirected";');
    config=path.join(app,'src/package.json');
    fs.writeFileSync(config,JSON.stringify({browser:{'./original.ts':'./redirected.ts'}}));
    consumer=path.join(app,'src/index.ts');specifier='./original';
    fs.writeFileSync(consumer,'import {marker} from "./original"; Object.assign(globalThis,{marker});'+boundary);
  } else if (kind==='tsconfig') {
    const pkg=path.join(app,'node_modules/u26-fixture-dependency');fs.mkdirSync(pkg);
    fs.writeFileSync(path.join(pkg,'package.json'),JSON.stringify({name:'u26-fixture-dependency',main:'index.js',types:'index.d.ts'}));
    fs.writeFileSync(path.join(pkg,'index.js'),'exports.marker="original";');
    fs.writeFileSync(path.join(pkg,'index.d.ts'),'export const marker: "original";');
    fs.mkdirSync(path.join(app,'src/nested'));
    fs.writeFileSync(path.join(app,'src/nested/redirected.ts'),'export const marker="redirected";');
    config=path.join(app,'src/nested/tsconfig.json');
    fs.writeFileSync(config,JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'u26-fixture-dependency':['./redirected.ts']}}}));
    consumer=path.join(app,'src/nested/consumer.ts');specifier='u26-fixture-dependency';
    fs.writeFileSync(consumer,'export {marker} from "u26-fixture-dependency";');
    fs.writeFileSync(path.join(app,'src/index.ts'),'import {marker} from "./nested/consumer"; Object.assign(globalThis,{marker});'+boundary);
  }
  if (kind==='jsconfig') {
    // Exact nested paths/baseUrl attack: the target is JS outside app/src.
    fs.mkdirSync(path.join(app,'src/nested'));
    fs.writeFileSync(path.join(app,'redirected.js'),'export function redirected(){}; export {redirected as httpsCallable};');
    config=path.join(app,'src/nested/jsconfig.json');
    fs.writeFileSync(config,JSON.stringify({compilerOptions:{baseUrl:'.',paths:{'firebase/functions':['../../redirected.js']}}}));
    consumer=path.join(app,'src/nested/consumer.ts');specifier='firebase/functions';
    fs.writeFileSync(consumer,'import {httpsCallable} from "firebase/functions"; export const marker=httpsCallable.name;');
    fs.writeFileSync(path.join(app,'src/index.ts'),'import {marker} from "./nested/consumer"; Object.assign(globalThis,{marker});'+boundary);
  }
  return {app,config,consumer,specifier};
}
function expectCommandPass(command,args,cwd) {
  const result=spawnSync(command,args,{cwd,encoding:'utf8',timeout:30000});
  if (result.status!==0) throw new Error(`fixture verification failed: ${command} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
}
for (const kind of ['package','tsconfig','jsconfig']) test(`${kind} JSON redirect reproduces raw divergence and refuses all certified routes`,async()=>withFixture(SAFE,async root=>{
  const {app,config,consumer,specifier}=jsonResolutionFixture(root,kind);
  const raw=await esbuild.build({absWorkingDir:app,entryPoints:['src/index.ts'],bundle:true,format:'esm',write:false,metafile:true,preserveSymlinks:true});
  const observed=execute(Buffer.from(raw.outputFiles[0].contents));
  expect(observed.marker).toBe('redirected');expect(observed.result).toBeNull();
  expect(Object.keys(raw.metafile.inputs).some(p=>p.endsWith(kind==='jsconfig'?'redirected.js':'redirected.ts'))).toBe(true);
  const parsed=ts.getParsedCommandLineOfConfigFile(path.join(app,'tsconfig.json'),{}, {...ts.sys,onUnRecoverableConfigFileDiagnostic:d=>{throw new Error(ts.flattenDiagnosticMessageText(d.messageText,' '));}});
  const resolved=ts.resolveModuleName(specifier,consumer,parsed.options,ts.sys).resolvedModule.resolvedFileName;
  expect(resolved.endsWith(kind==='package'?'original.ts':kind==='jsconfig'?'firebase/functions/dist/functions/index.d.ts':'u26-fixture-dependency/index.d.ts')).toBe(true);
  // Run the unguarded tools to demonstrate precisely why the contract must refuse.
  fs.writeFileSync(path.join(app,'src/resolution.test.ts'),'import "./index"; test("verification sees original module",()=>{const values=globalThis as typeof globalThis & {marker:string;result:unknown}; expect(values.marker).toBe("'+(kind==='jsconfig'?'httpsCallable':'original')+'"); expect(values.result).toBeNull();});');
  expectCommandPass(process.execPath,[path.join(ROOT,'app/node_modules/typescript/bin/tsc'),'--noEmit','-p',path.join(app,'tsconfig.json')],app);
  expectCommandPass(process.execPath,[path.join(ROOT,'app/node_modules/eslint/bin/eslint.js'),'--ext','.ts','src'],app);
  expectCommandPass(process.execPath,[path.join(ROOT,'app/node_modules/jest/bin/jest.js'),'--config',JSON.stringify({rootDir:app,preset:'ts-jest',testEnvironment:'node',roots:['<rootDir>/src'],testMatch:['**/resolution.test.ts']}),'--runInBand','--silent'],app);
  for (const intent of ['general','teacher-units']) await expect(build(root,intent)).rejects.toThrow('resolution-controlling JSON configuration');
  expect(fs.existsSync(path.join(app,'dist/bundle.js'))).toBe(false);
  expect(fs.existsSync(path.join(app,'dist/application-build.json'))).toBe(false);
  for (const command of ['build','typecheck','lint','build:runtime','build:lab-report-cloud']) {
    const result=spawnSync('npm',['--prefix',app,'run',command],{encoding:'utf8',timeout:10000});
    expect(result.status).toBe(1);expect(result.stderr).toContain('REFUSED: resolution-controlling JSON configuration');
  }
  // New configuration must invalidate a formerly safe candidate/receipt before
  // release preparation can certify it; the real release reconstruction is used.
  const bytes=fs.readFileSync(config);fs.unlinkSync(config);
  const safe=await build(root,'general');
  fs.writeFileSync(config,bytes);
  await expect(verify(root,'general')).rejects.toThrow('resolution-controlling JSON configuration');
  const pair={releaseIntent:'general',source:{sha:'f52218d15a198b24b675fa6b9b26178626e344a8',dirty:true},unitPlacement:{fingerprint:'0'.repeat(64)},files:{app:{'app/index.html':safe.inputs['app/index.html'],'app/dist/bundle.js':safe.outputs['app/dist/bundle.js']},marketing:{}}};
  expect(()=>hostingCandidate(pair,root)).toThrow('unverifiable application availability/build evidence');
}),60000);

for (const relative of ['package.json','Package.Json','deep/nested/PACKAGE.JSON','tsconfig.json','nested/tsconfig.build.json','.hidden/deep/TSConfig.BASE.JSON','nested/tsconfigextra.json','jsconfig.json','JsConfig.Json','deep/nested/JSCONFIG.JSON','.hidden/deep/jsconfig.json']) test(`resolution config ${relative} refuses even when untracked and unimported`,async()=>withFixture(SAFE,async root=>{
  const file=path.join(root,'app/src',relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'{}');
  expect(()=>checkSource(root)).toThrow('resolution-controlling JSON configuration');
  await expect(compile(root,'general')).rejects.toThrow('resolution-controlling JSON configuration');
}));

test('all four existing JSON data files remain usable and config-like data is not a resolver file',async()=>withFixture(IMPORT+' import manifest from "./curriculum/curriculum.manifest.json"; import registry from "./curriculum/curriculum.registry.json"; import policy from "./curriculum/curriculum.resource-types.json"; import revisions from "./assignments/studentList/assessment-revision-paths.json"; import data from "./ordinary-data.json"; Object.assign(globalThis,{data:[manifest,registry,policy,revisions,data],result:teacherUnitsReleaseBoundary(()=>null as never)});',async root=>{
  const names=['curriculum/curriculum.manifest.json','curriculum/curriculum.registry.json','curriculum/curriculum.resource-types.json','assignments/studentList/assessment-revision-paths.json'];
  for (const relative of names) {const target=path.join(root,'app/src',relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(ROOT,'app/src',relative),target);}
  fs.writeFileSync(path.join(root,'app/src/ordinary-data.json'),JSON.stringify({browser:{'./original.ts':'./redirected.ts'},compilerOptions:{paths:{marker:['redirected']}}}));
  const {bundle,evidence}=await compile(root,'general');const observed=execute(bundle);
  expect(observed.result).toBeNull();expect(observed.data).toHaveLength(5);
  for (let i=0;i<names.length;i++) expect(JSON.stringify(observed.data[i])).toBe(JSON.stringify(JSON.parse(fs.readFileSync(path.join(ROOT,'app/src',names[i]),'utf8'))));
  expect(evidence.sourceContract.filenameComponents).toBe('ascii-only');
  expect(evidence.sourceContract.resolutionConfigs).toEqual({prohibitedNames:['package.json','tsconfig*.json','jsconfig.json'],caseInsensitive:true});
  for (const relative of names) expect(evidence.inputs['app/src/'+relative]).toBeDefined();
}));

// Resolver discovery in esbuild 0.24.2 uses exact tsconfig/jsconfig names.
// PnP discovery starts from absWorkingDir (app), not a child source directory.
// These probes assert current behavior, not a general inert-JSON guarantee.
test('other resolver-like JSON names and source-local PnP are not auto-discovered by the fixed builder',async()=>withFixture(SAFE,async root=>{
  const {app,config}=jsonResolutionFixture(root,'jsconfig');
  const executeSdk=bundle=>{const context={fetch:()=>{throw new Error('network touched');}};context.self=context;vm.runInNewContext(bundle.toString(),context);return context;};
  const redirect=fs.readFileSync(config);fs.unlinkSync(config);
  for (const name of ['jsconfig.build.json','esbuild.config.json','.pnp.data.json']) {
    const file=path.join(app,'src/nested',name);fs.writeFileSync(file,redirect);
    try {
      const {bundle}=await compile(root,'general');
      expect(executeSdk(bundle).marker).toBe('httpsCallable');
    } finally {fs.unlinkSync(file);}
  }
  // A malformed source-local manifest would fail if it were parsed as PnP.
  fs.writeFileSync(path.join(app,'src/.pnp.data.json'),'not valid JSON');
  expect(executeSdk((await compile(root,'general')).bundle).marker).toBe('httpsCallable');
}),30000);

// These exact spellings bypassed v6's /i JSON filename rule. On case-insensitive
// APFS Kelvin folds to ASCII K, so the raw resolver redirects successfully.
for (const [kind,name] of [['package','pac\u212Aage.json'],['jsconfig','jsconf\u0130g.json'],['tsconfig','tsconf\u0130g.json']]) test(`Unicode config ${name} refuses before either candidate`,async()=>withFixture(SAFE,async root=>{
  const {app,config}=jsonResolutionFixture(root,kind);
  const bytes=fs.readFileSync(config);fs.unlinkSync(config);
  const unicode=path.join(path.dirname(config),name);fs.writeFileSync(unicode,bytes);
  const lookup=fs.existsSync(config);
  const raw=()=>esbuild.build({absWorkingDir:app,entryPoints:['src/index.ts'],bundle:true,format:'esm',write:false,metafile:true,preserveSymlinks:true,logLevel:'silent'});
  if (lookup) {
    const emitted=await raw();expect(execute(Buffer.from(emitted.outputFiles[0].contents)).marker).toBe('redirected');
  } else await expect(raw()).rejects.toThrow();
  expect(()=>checkSource(root)).toThrow('non-ASCII application source filename component');
  for (const intent of ['general','teacher-units']) await expect(build(root,intent)).rejects.toThrow('non-ASCII application source filename component');
  expect(fs.existsSync(path.join(app,'dist/bundle.js'))).toBe(false);
  expect(fs.existsSync(path.join(app,'dist/application-build.json'))).toBe(false);
  // An old safe artifact must not hide the newly added Unicode configuration.
  fs.unlinkSync(unicode);const safe=await build(root,'general');fs.writeFileSync(unicode,bytes);
  await expect(verify(root,'general')).rejects.toThrow('non-ASCII application source filename component');
  const pair={releaseIntent:'general',source:{sha:'f52218d15a198b24b675fa6b9b26178626e344a8',dirty:true},unitPlacement:{fingerprint:'0'.repeat(64)},files:{app:{'app/index.html':safe.inputs['app/index.html'],'app/dist/bundle.js':safe.outputs['app/dist/bundle.js']},marketing:{}}};
  expect(()=>hostingCandidate(pair,root)).toThrow('unverifiable application availability/build evidence');
  for (const command of ['build','typecheck','lint']) {
    const result=spawnSync('npm',['--prefix',app,'run',command],{encoding:'utf8',timeout:10000});
    expect(result.status).toBe(1);expect(result.stderr).toContain('non-ASCII application source filename component');
  }
}),30000);

for (const relative of ['nested/\u212Aeeper/data.json','nested/k\u00E9eper/data.json','nested/ke\u0301eper/data.json','nested/\u0130/data.json','nested/\uFF4B/data.json','nested/keeper/na\u00EFve.json','nested/keeper/nai\u0308ve.json','nested/keep\u{1F600}/data.json']) test(`non-ASCII source component ${relative} refuses without being imported`,async()=>withFixture(SAFE,async root=>{
  const file=path.join(root,'app/src',relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'{}');
  expect(()=>checkSource(root)).toThrow('non-ASCII application source filename component');
  await expect(build(root,'general')).rejects.toThrow('non-ASCII application source filename component');
  expect(fs.existsSync(path.join(root,'app/dist/bundle.js'))).toBe(false);
}));

test('Git-ignored Unicode entries cannot evade filesystem inventory',async()=>withFixture(SAFE,async root=>{
  expectCommandPass('git',['init','--quiet'],root);
  fs.writeFileSync(path.join(root,'.gitignore'),'app/src/ignored/\n');
  const file=path.join(root,'app/src/ignored/deep/pac\u212Aage.json');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'{}');
  expectCommandPass('git',['check-ignore',file],root);
  expect(()=>checkSource(root)).toThrow('non-ASCII application source filename component');
  await expect(build(root,'general')).rejects.toThrow('non-ASCII application source filename component');
}));

for (const name of ['\u017Frc','Src']) test(`source root ${name} cannot alias the required literal src component`,async()=>withFixture(SAFE,async root=>{
  fs.renameSync(path.join(root,'app/src'),path.join(root,'app',name));
  expect(()=>checkSource(root)).toThrow('missing exact application source directory');
  await expect(build(root,'general')).rejects.toThrow('missing exact application source directory');
}));
