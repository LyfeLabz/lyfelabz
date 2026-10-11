/** @jest-environment node */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { build, compile, verify } = require('./build-application.cjs');
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
for(const mutation of ['bundle','enabled','unknown','fingerprint','intent','source','missing']) test(`changed ${mutation} cannot verify a prepared build`,async()=>withFixture(SAFE,async root=>{
  await build(root,'general'); const record=path.join(root,'app/dist/application-build.json');const evidence=JSON.parse(fs.readFileSync(record));
  if(mutation==='bundle')fs.appendFileSync(path.join(root,'app/dist/bundle.js'),'globalThis.unsafe=true;');
  if(mutation==='enabled'||mutation==='unknown')evidence.availability=mutation;
  if(mutation==='fingerprint')evidence.outputs['app/dist/bundle.js']='f'.repeat(64);
  if(mutation==='intent')evidence.releaseIntent='teacher-units';
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
      import {renderTeacherUnitsPanel} from './shell/surfaces/teacherUnitsPanel';
      const deps = new Proxy({}, {get(){throw new Error('dependency touched');}});
      globalThis.results = [teacherUnitsReleaseBoundary(()=>{throw new Error('factory touched');})];
      for (const create of [()=>createTeacherUnitsController(deps as never),()=>createTeacherUnitsSurfaceSeam(deps as never),()=>createTeacherUnitCreateAttemptStore(deps as never),()=>createFirebaseTeacherUnitsCallables(deps as never),()=>renderTeacherUnitsPanel(deps as never,deps as never)]) {
        try {create(); globalThis.results.push('enabled');} catch(error) {globalThis.results.push(error.message);}
      }
    `);
    const {bundle}=await compile(root,'general');
    const context={fetch:()=>{throw new Error('network touched');},TextEncoder,TextDecoder,URL,URLSearchParams,setTimeout,clearTimeout};
    context.self=context;
    vm.runInNewContext(bundle.toString(),context);
    expect(Array.from(context.results)).toEqual([null,...new Array(5).fill('Teacher Units unavailable in this release')]);
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
