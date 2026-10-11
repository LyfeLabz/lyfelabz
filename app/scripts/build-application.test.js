/** @jest-environment node */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { JSDOM } = require('jsdom');
const esbuild = require('esbuild');
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
for(const mutation of ['bundle','enabled','unknown','fingerprint','intent','source','missing','runtime-claim','canonical-identity','replacement','resolved-import','source-contract','v3-schema']) test(`changed ${mutation} cannot verify a prepared build`,async()=>withFixture(SAFE,async root=>{
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
      const deps = new Proxy({}, {get(){throw new Error('dependency touched');}});
      const mount=document.createElement('div'); document.body.appendChild(mount);
      renderCurriculumSurface(mount, {kind:'activeTeacher',uid:'teacher',schoolId:'school',displayName:'Teacher'}, {teacherUnits:{createController(){throw new Error('injected seam touched');}},listClasses:()=>Promise.resolve([])});
      globalThis.viewSwitch = !!mount.querySelector('[data-testid=curriculum-view-switch]');
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
    // Exact hostname attack against the real Curriculum renderer, not just a label.
    fs.writeFileSync(path.join(root,'app/src/index.ts'),`
      import {renderCurriculumSurface} from './shell/surfaces/curriculum';
      const mount=document.createElement('div'); document.body.appendChild(mount);
      renderCurriculumSurface(mount, {kind:'activeTeacher',uid:'teacher',schoolId:'school',displayName:'Teacher'}, {teacherUnits:{createController(){throw new Error('unexpected lazy construction');}},listClasses:()=>Promise.resolve([])});
    `);
    fs.writeFileSync(path.join(root,'app/src/teacherUnits/releaseAvailability.tsx'),
      'export function teacherUnitsAvailable(){return location.hostname === "app.lyfelabz.com";} export function requireTeacherUnitsAvailable(){}');
    const raw=await esbuild.build({absWorkingDir:path.join(root,'app'),entryPoints:['src/index.ts'],bundle:true,format:'esm',target:'es2022',write:false,preserveSymlinks:true});
    for (const hostname of ['app.lyfelabz.com','localhost']) {
      const browser=new JSDOM('<!doctype html><body></body>',{url:`https://${hostname}/app/`,runScripts:'outside-only'});
      try {
        Object.assign(browser.window,{fetch:()=>{throw new Error('network touched');},TextEncoder,TextDecoder});
        vm.runInContext(raw.outputFiles[0].text,browser.getInternalVMContext());
        expect(!!browser.window.document.querySelector('[data-testid=curriculum-view-switch]')).toBe(hostname==='app.lyfelabz.com');
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
