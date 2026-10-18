'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { sha256 } = require('./contract.cjs');
const { placementFingerprint } = require('../unit-placement/check-parity.cjs');
const { PROJECT_NUMBERS, REQUIRED_FUNCTIONS, MAX_AGE_MS, canonical, fingerprint, normalizeLocalIndexes,
  normalizeRemoteIndexes, tokenFromGcloud, readApi, archiveRuntime, inspectBackend, assertFresh,
  assertCompatible, verifyBackend, receipt, localCandidate, releaseIntent, assertIntentForProject, hostingCandidate, releaseCandidate, verifyPrepared, list, LIMITS } = require('./backend-state.cjs');
const { hostingPredeploy, verifyPreparedPair } = require('./build-pair.cjs');
function buildFixture(root, intent) {
  const src = path.join(root,'app/src/teacherUnits');fs.mkdirSync(src,{recursive:true});
  fs.copyFileSync(path.join(__dirname,'../../app/index.html'),path.join(root,'app/index.html'));
  for(const name of ['releaseAvailability.ts','releaseBoundary.ts']) fs.copyFileSync(path.join(__dirname,'../../app/src/teacherUnits',name),path.join(src,name));
  const entry=path.join(root,'app/src/index.ts');
  fs.writeFileSync(entry,'import { teacherUnitsReleaseBoundary } from "./teacherUnits/releaseBoundary"; console.log(teacherUnitsReleaseBoundary(() => { throw new Error("must not construct"); }));');
  const evidence=JSON.parse(execFileSync(process.execPath,[path.join(__dirname,'../../app/scripts/build-application.cjs'),'--build',root,intent],{encoding:'utf8'}));
  return {'app/dist/bundle.js':evidence.outputs['app/dist/bundle.js'],'app/index.html':evidence.inputs['app/index.html']};
}
const NOW = '2026-10-11T16:00:00.000Z';
const ids = ['lesson_test'];
const runtimeFiles = { 'lib/index.js':sha256('runtime'), 'lib/teacherUnits/unit-placeable-resources.json':sha256(JSON.stringify({resourceIds:ids})), 'package.json':sha256('{}'), 'package-lock.json':sha256('{}') };
const artifact = { runtimeFiles, artifactFingerprint:fingerprint(runtimeFiles), placementFingerprint:placementFingerprint(ids), archiveHash:sha256('zip') };
const candidate = { teacherUnitsAvailability:'closed',availabilityEvidence:'build-contract-assertion',applicationBuildFingerprint:sha256('build'), releaseIntent:'teacher-units', source:{sha:'a'.repeat(40),dirty:false}, hostingArtifactFingerprint:sha256('hosting'), functionsArtifactFingerprint:artifact.artifactFingerprint,
  runtimeFiles, placementFingerprint:artifact.placementFingerprint, rulesSourceHash:sha256('rules'), indexes:{indexes:[],fieldOverrides:[]} };
function fixture(project = 'lyfelabz-staging', mutate = () => {}) {
  const p = `projects/${project}`; const calls = [];
  const fns = REQUIRED_FUNCTIONS.map(id => ({ name:`${p}/locations/us-central1/functions/${id}`, environment:'GEN_2',state:'ACTIVE',updateTime:NOW,
    buildConfig:{runtime:'nodejs22',entryPoint:id,build:`${p}/locations/us-central1/builds/build1`,sourceProvenance:{resolvedStorageSource:{bucket:'source-bucket',object:'source.zip',generation:'123'}}},
    serviceConfig:{service:`${p}/locations/us-central1/services/${id.toLowerCase()}`, revision:`${id.toLowerCase()}-00001-abc`,allTrafficOnLatestRevision:true} }));
  const routes = {
    [`https://firebase.googleapis.com/v1beta1/${p}`]:{name:p,projectId:project,projectNumber:PROJECT_NUMBERS[project],state:'ACTIVE'},
    [`https://firestore.googleapis.com/v1/${p}/databases/(default)`]:{name:`${p}/databases/(default)`,type:'FIRESTORE_NATIVE'},
    [`https://cloudfunctions.googleapis.com/v2/${p}/locations/-/functions`]:{functions:fns},
    [`https://firebaserules.googleapis.com/v1/${p}/releases/cloud.firestore`]:{name:`${p}/releases/cloud.firestore`,rulesetName:`${p}/rulesets/rules1`,updateTime:NOW},
    [`https://firebaserules.googleapis.com/v1/${p}/rulesets/rules1`]:{name:`${p}/rulesets/rules1`,source:{files:[{name:'firestore.rules',content:'rules'}]}},
    [`https://firestore.googleapis.com/v1/${p}/databases/(default)/collectionGroups/-/indexes`]:{},
    [`https://firestore.googleapis.com/v1/${p}/databases/(default)/collectionGroups/-/fields?filter=indexConfig.usesAncestorConfig%3Dfalse`]:{},
    [`https://firestore.googleapis.com/v1/${p}/databases/(default)/collectionGroups/-/fields?filter=ttlConfig%3A*`]:{},
    'https://storage.googleapis.com/storage/v1/b/source-bucket/o/source.zip?alt=media&generation=123':Buffer.from('zip')
  };
  for (const f of fns) routes[`https://cloudfunctions.googleapis.com/v2/${f.name}`] = f;
  mutate(routes, fns);
  const get = async (url, binary) => { calls.push({url,binary}); if (!(url in routes)) throw new Error(`unexpected GET ${url}`); return structuredClone(routes[url]); };
  return {routes,fns,get,calls,project};
}
async function observe(f = fixture(), opts = {}) { return inspectBackend({ project:f.project,get:f.get,unpack:() => structuredClone(artifact),now:() => NOW,...opts }); }
for (const project of Object.keys(PROJECT_NUMBERS)) test(`independently verifies ${project}, immutable artifacts and all required Functions`, async () => {
  const f = fixture(project); let archives = 0;
  const evidence = await observe(f,{unpack:() => {archives++;return artifact;}});
  assert.equal(evidence.project,project); assert.equal(evidence.projectNumber,PROJECT_NUMBERS[project]);
  assert.equal(evidence.functions.length,8); assert.equal(archives,1);
  assert.deepEqual(assertCompatible(candidate,evidence,NOW),{policy:'u26-a1-exact-backend-artifact-v1',compatible:true});
  assert.ok(f.calls.every(c => c.url.startsWith('https://')));
  assert.equal(f.calls.filter(c => c.url.includes('/functions/')).length,16);
});
test('explicit literal project is required before credentials, network, or files',async () => {
  for (const project of [undefined,'staging','default','unknown']) {
    let calls=0;
    await assert.rejects(verifyBackend({project,run:() => calls++,get:() => calls++}),/explicit --project|unsupported project/);
    assert.equal(calls,0);
  }
});
test('wrong project id, number, inactive Firebase project, or database refuses',async () => {
  for (const key of ['projectId','projectNumber','state']) {
    const f=fixture('lyfelabz-staging',(r) => {r['https://firebase.googleapis.com/v1beta1/projects/lyfelabz-staging'][key]='wrong';});
    await assert.rejects(observe(f),/wrong-project/);
  }
  const f=fixture('lyfelabz-staging',r => {r['https://firestore.googleapis.com/v1/projects/lyfelabz-staging/databases/(default)'].name='projects/lyfelabz-prod/databases/(default)';});
  await assert.rejects(observe(f),/wrong-project/);
});
test('credential command is read-only, token is private, failures refuse',() => {
  const calls=[]; assert.equal(tokenFromGcloud((cmd,args) => {calls.push([cmd,...args]);return 'private-token\n';}),'private-token');
  assert.deepEqual(calls,[['gcloud','auth','print-access-token','--quiet']]);
  assert.throws(() => tokenFromGcloud(() => {throw new Error('private-token');}),/missing credentials/);
  assert.throws(() => tokenFromGcloud(() => ''),/missing credentials/);
});
test('API transport uses only GET, never redirects credentials or prints error bodies',async () => {
  const calls=[]; const get=readApi({token:'private-token',fetchImpl:async (url,options) => {calls.push(options);return new Response(JSON.stringify({ok:true}));}});
  await get('https://firebase.googleapis.com/v1beta1/projects/lyfelabz-staging');
  assert.equal(calls[0].method,'GET'); assert.equal(calls[0].redirect,'error');
  for (const status of [401,403,404,500]) await assert.rejects(readApi({token:'secret',fetchImpl:async () => ({ok:false,status})})('https://firebase.googleapis.com/test'),new RegExp(`HTTP ${status}`));
  await assert.rejects(readApi({token:'secret',fetchImpl:async () => {throw new Error('secret');}})('https://firebase.googleapis.com/test'),/API unavailable/);
  await assert.rejects(readApi({token:'secret',fetchImpl:async () => ({ok:true,json:async () => {throw new Error('secret');}})})('https://firebase.googleapis.com/test'),/unverifiable/);
});
test('missing, duplicate, unreachable and wrong-project Functions refuse',async () => {
  for (const mutation of [
    (r,f) => f.pop(), (r,f) => f.push(f[0]), (r,f) => {f[0].name=f[0].name.replace('staging','prod');},
    r => {r['https://cloudfunctions.googleapis.com/v2/projects/lyfelabz-staging/locations/-/functions'].unreachable=['us-east1'];}
  ]) await assert.rejects(observe(fixture('lyfelabz-staging',mutation)),/missing|ambiguous|wrong-project|unreachable/);
});
test('unknown build, generation, entry point, runtime, revision, traffic or state refuses',async () => {
  for (const mutation of [
    f => delete f.buildConfig.build, f => delete f.buildConfig.sourceProvenance,
    f => delete f.buildConfig.sourceProvenance.resolvedStorageSource.generation,
    f => {f.buildConfig.entryPoint='other';},f => {f.buildConfig.runtime='nodejs20';},
    f => delete f.serviceConfig.revision,f => {f.serviceConfig.allTrafficOnLatestRevision=false;},f => {f.state='DEPLOYING';},
    f => {f.buildConfig.build=f.buildConfig.build.replace('staging','prod');}
  ]) await assert.rejects(observe(fixture('lyfelabz-staging',(r,f) => mutation(f[0]))),/unknown|immutable|wrong-project/);
});
test('changed Function between source reads refuses',async () => {
  const f=fixture();const get=f.get;let reads=0;
  f.get=async(url,binary) => {const value=await get(url,binary);if(url.endsWith('/functions/teacherUnitsArchive') && ++reads===2)value.updateTime='2026-10-11T16:00:01Z';return value;};
  await assert.rejects(observe(f),/changed during inventory/);
});
test('pagination is complete and repeated tokens refuse',async () => {
  const f=fixture(); const first='https://cloudfunctions.googleapis.com/v2/projects/lyfelabz-staging/locations/-/functions';
  f.routes[first]={functions:f.fns.slice(0,4),nextPageToken:'next'};
  f.routes[`${first}?pageToken=next`]={functions:f.fns.slice(4)};
  assert.equal((await observe(f)).functions.length,8);
  f.routes[`${first}?pageToken=next`].nextPageToken='next';
  await assert.rejects(observe(f),/pagination/);
});
test('Rules release/source uncertainty refuses',async () => {
  for (const mutation of [
    r => delete r['https://firebaserules.googleapis.com/v1/projects/lyfelabz-staging/releases/cloud.firestore'].rulesetName,
    r => {r['https://firebaserules.googleapis.com/v1/projects/lyfelabz-staging/rulesets/rules1'].source.files=[];},
    r => {r['https://firebaserules.googleapis.com/v1/projects/lyfelabz-staging/rulesets/rules1'].name='projects/lyfelabz-prod/rulesets/rules1';}
  ]) await assert.rejects(observe(fixture('lyfelabz-staging',mutation)),/resource identity|Rules source/);
});
test('index normalization proves exact overrides including TTL and readiness',() => {
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../../platform/firebase/firestore.indexes.json')));
  const local=normalizeLocalIndexes(config);
  const fields=local.fieldOverrides.map(f => ({name:`projects/lyfelabz-staging/databases/(default)/collectionGroups/${f.collectionGroup}/fields/${f.fieldPath}`,
    ...(f.ttl ? {ttlConfig:{state:'ACTIVE'}} : {}),indexConfig:{indexes:f.indexes.map(i => ({...i,state:'READY'}))}}));
  assert.deepEqual(normalizeRemoteIndexes([],fields,'lyfelabz-staging'),local);
  fields[0].indexConfig.indexes[0].state='CREATING';
  assert.throws(() => normalizeRemoteIndexes([],fields,'lyfelabz-staging'),/not READY/);
  fields[0].indexConfig.indexes[0].state='READY';fields.find(f => f.ttlConfig).ttlConfig.state='CREATING';
  assert.throws(() => normalizeRemoteIndexes([],fields,'lyfelabz-staging'),/not ACTIVE/);
  fields.find(f => f.ttlConfig).ttlConfig.state='ACTIVE';
  delete fields[0].indexConfig;
  assert.throws(() => normalizeRemoteIndexes([],fields,'lyfelabz-staging'),/identity uncertain/);
});
test('unknown index semantics fail closed instead of dropping them from hash',() => {
  assert.throws(() => normalizeLocalIndexes({indexes:[{collectionGroup:'x',queryScope:'COLLECTION',fields:[{fieldPath:'x',vectorConfig:{}}]}],fieldOverrides:[]}),/unsupported|unknown/);
});
test('incompatible runtime, placement, Rules and indexes each refuse',async () => {
  const evidence=await observe();
  for (const mutation of [
    e => {e.functions[0].placementFingerprint='unknown';},
    e => {e.functions[0].artifactFingerprint='unknown';},
    e => {e.rules.sourceHash='unknown';},
    e => {e.indexes.configuration={indexes:[],fieldOverrides:[{}]};},
    e => {e.functions=[];}
  ]) {const e=structuredClone(evidence);mutation(e);assert.throws(() => assertCompatible(candidate,e,NOW),/incompatible|uncertain|missing/);}
});
test('stale, future, wrong-project observations and old receipt schemas cannot authorize readiness',async () => {
  const e=await observe();
  assert.throws(() => assertFresh(e,'lyfelabz-prod',NOW),/wrong-project/);
  assert.throws(() => assertFresh(e,e.project,new Date(Date.parse(NOW)+MAX_AGE_MS+1).toISOString()),/stale/);
  assert.throws(() => assertFresh(e,e.project,'2026-10-11T15:59:59Z'),/future/);
  assert.throws(() => assertFresh({kind:'lyfelabz.hostingCertifiedRelease'},e.project,NOW),/unsupported/);
});
test('receipts serialize deterministically, preserve independent claims and identify historical evidence',async () => {
  const e=await observe();const args={phase:'prepared',intent:'teacher-units',project:e.project,candidate,evidence:e,hosting:{app:{baseline:{version:'aaa'}},marketing:{baseline:{version:'bbb'}}},recordedAt:NOW};
  const a=receipt(args); const b=receipt({...args,candidate:Object.fromEntries(Object.entries(candidate).reverse())});
  assert.equal(JSON.stringify(a),JSON.stringify(b));assert.match(a.authority,/historical/);
  assert.equal(a.backend.rules.ruleset,'projects/lyfelabz-staging/rulesets/rules1');
  assert.throws(() => receipt({...args,hosting:{app:{}}}),/paired Hosting/);
});
async function hookFixture(intent = 'teacher-units') {
  const now = new Date().toISOString();
  const e = await observe(); e.startedAt = now; e.observedAt = now;
  const c = intent === 'teacher-units' ? candidate : {releaseIntent:intent,source:candidate.source,hostingArtifactFingerprint:sha256('hosting'),placementFingerprint:artifact.placementFingerprint,teacherUnitsAvailability:intent === 'staging-ux-test' ? 'staging-ux-test' : 'closed',availabilityEvidence:'build-contract-assertion',applicationBuildFingerprint:sha256('build')};
  const surfaces = {app:{site:'lyfelabz-staging',baseline:{version:'aaa',releaseTime:now}},marketing:{site:'lyfelabz-staging-marketing',baseline:{version:'bbb',releaseTime:now}}};
  const prepared = {kind:'lyfelabz.hostingPreparedRelease',schemaVersion:3,releaseIntent:intent,project:'lyfelabz-staging',environment:'staging',source:c.source,candidate:c,preparedAt:now,surfaces,
    evidenceReceipt:receipt({phase:'prepared',intent,project:'lyfelabz-staging',candidate:c,evidence:intent === 'teacher-units' ? e : null,hosting:surfaces,recordedAt:now})};
  const calls=[];
  const args = {project:'lyfelabz-staging',verifyExisting:()=>{},read:()=>prepared,candidateFor:()=>c,
    build:options=>{assert.equal(options.intent,intent);calls.push('build');return {record:{schemaVersion:3,releaseIntent:intent}};},
    discover:()=>{calls.push('hosting');return {};},
    verify:async()=>{calls.push('remote');return {candidate:c,evidence:e};},write:()=>calls.push('record')};
  return {args,calls,prepared,c};
}
test('Teacher Units predeploy repeats remote verification and refuses failures without fallback',async () => {
  const f=await hookFixture();
  for(let i=0;i<2;i++) await hostingPredeploy(f.args);
  assert.deepEqual(f.calls,['build','hosting','hosting','remote','record','build','hosting','hosting','remote','record']);
  await assert.rejects(hostingPredeploy({...f.args,verify:async()=>{throw new Error('unavailable deployment API');},write:()=>assert.fail('must not record readiness')}),/unavailable/);
  await assert.rejects(hostingPredeploy({project:undefined,build:()=>assert.fail('must verify project first')}),/explicit --project/);
});
test('general Hosting predeploy needs no Functions deployment or Functions credentials and never claims Teacher Units readiness',async()=>{
  const f=await hookFixture('general');
  const result=await hostingPredeploy({...f.args,verify:()=>assert.fail('must not read Teacher Units backend')});
  assert.equal(result.backend,null);assert.equal(result.teacherUnitsReadiness,'not-evaluated');
  assert.deepEqual(f.calls,['build','hosting','hosting','record']);
});
test('predeploy refuses missing, offline, stale, cross-project, changed-candidate and unknown-intent preparation',async()=>{
  for(const mutate of [p=>{p.releaseIntent='unknown';},p=>{p.evidenceReceipt=null;},p=>{p.preparedAt='2020-01-01T00:00:00Z';},p=>{p.project='lyfelabz-prod';},p=>{p.candidate={...p.candidate,hostingArtifactFingerprint:'other'};}]) {
    const f=await hookFixture('general'); mutate(f.prepared);
    await assert.rejects(hostingPredeploy(f.args),/intent|prepare evidence|stale/);assert.equal(f.calls.length,0);
  }
  const f=await hookFixture('general');
  await assert.rejects(hostingPredeploy({...f.args,read:()=>{throw new Error('ENOENT');}}),/missing or malformed online prepare/);
  await assert.rejects(hostingPredeploy({...f.args,candidateFor:()=>({...f.c,applicationBuildFingerprint:sha256('changed')})}),/different-candidate/);
  await assert.rejects(hostingPredeploy({...f.args,discover:()=>{throw new Error('unverified site');}}),/unverified site/);
});
test('generation-pinned archive parsing hashes real bytes without extracting paths',() => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'backend-archive-test-'));
  try {
    fs.mkdirSync(path.join(root,'lib/teacherUnits'),{recursive:true});
    fs.writeFileSync(path.join(root,'lib/index.js'),'runtime');
    fs.writeFileSync(path.join(root,'lib/teacherUnits/unit-placeable-resources.json'),JSON.stringify({resourceIds:ids}));
    fs.writeFileSync(path.join(root,'package.json'),'{}');fs.writeFileSync(path.join(root,'package-lock.json'),'{}');
    execFileSync('zip',['-q','-r','source.zip','lib','package.json','package-lock.json'],{cwd:root});
    const actual=archiveRuntime(fs.readFileSync(path.join(root,'source.zip')));
    assert.equal(actual.artifactFingerprint,artifact.artifactFingerprint);assert.equal(actual.placementFingerprint,artifact.placementFingerprint);
    assert.deepEqual(fs.readdirSync(root).sort(),['lib','package-lock.json','package.json','source.zip']);
    assert.throws(() => archiveRuntime(Buffer.from('invalid')),/unverifiable/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('local candidate never treats source SHA as deployed identity and checks compiled placement',async () => {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'backend-candidate-test-'));
  try {
    const dir=path.join(root,'platform/functions');fs.mkdirSync(path.join(dir,'lib/teacherUnits'),{recursive:true});
    fs.mkdirSync(path.join(root,'platform/firebase'),{recursive:true});
    fs.writeFileSync(path.join(dir,'lib/index.js'),'runtime');fs.writeFileSync(path.join(dir,'lib/teacherUnits/unit-placeable-resources.json'),JSON.stringify({resourceIds:ids}));
    for(const f of ['package.json','package-lock.json'])fs.writeFileSync(path.join(dir,f),'{}');
    fs.writeFileSync(path.join(root,'platform/firebase/firestore.rules'),'rules');fs.writeFileSync(path.join(root,'platform/firebase/firestore.indexes.json'),'{"indexes":[],"fieldOverrides":[]}');
    const pair={releaseIntent:'teacher-units',source:candidate.source,files:{app:buildFixture(root,'teacher-units'),marketing:{}},unitPlacement:{fingerprint:artifact.placementFingerprint}};
    pair.backendCandidate=localCandidate(pair,root);
    assert.equal(pair.backendCandidate.functionsArtifactFingerprint,artifact.artifactFingerprint);
    let reads=0;
    const f=fixture();
    const verified=await verifyBackend({project:f.project,pair,root,get:async(...args)=>{reads++;return f.get(...args);},unpack:()=>artifact,now:()=>NOW});
    assert.equal(verified.compatibility.compatible,true);
    assert.ok(reads>0);reads=0;
    fs.writeFileSync(path.join(dir,'lib/index.js'),'changed-after-build');
    await assert.rejects(verifyBackend({project:f.project,pair,root,get:()=>reads++}),/candidate changed since pair build/);
    assert.equal(reads,0);
    fs.writeFileSync(path.join(dir,'lib/index.js'),'runtime');
    assert.throws(() => localCandidate({...pair,unitPlacement:{fingerprint:'f'.repeat(64)}},root),/placement/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});

test('Rules or index configuration changing during inventory refuses',async () => {
  for (const component of ['rules','indexes']) {
    const f=fixture();const get=f.get;let reads=0;
    f.get=async(url,binary)=>{const value=await get(url,binary);
      if(component==='rules' && url.endsWith('/releases/cloud.firestore') && ++reads===2)value.updateTime='2026-10-11T16:00:01Z';
      if(component==='indexes' && url.endsWith('/collectionGroups/-/indexes') && ++reads===2)value.indexes=[{name:'projects/lyfelabz-staging/databases/(default)/collectionGroups/x/indexes/changed',state:'READY',queryScope:'COLLECTION',fields:[{fieldPath:'x',order:'ASCENDING'}]}];
      return value;
    };
    await assert.rejects(observe(f),/changed during inventory/);
  }
});
test('malformed index list is uncertainty, not evidence of zero deployed indexes',async () => {
  const f=fixture();f.routes['https://firestore.googleapis.com/v1/projects/lyfelabz-staging/databases/(default)/collectionGroups/-/indexes']=[];
  await assert.rejects(observe(f),/invalid indexes inventory response/);
});

const fieldName = (group,field) => `projects/lyfelabz-staging/databases/(default)/collectionGroups/${group}/fields/${field}`;
const standardIndexes = field => [{order:'ASCENDING'},{order:'DESCENDING'},{arrayConfig:'CONTAINS'}].map(mode=>({queryScope:'COLLECTION',apiScope:'ANY_API',density:'SPARSE_ALL',multikey:false,unique:false,state:'READY',fields:[{fieldPath:field,...mode}]}));
test('real API global default, density, inherited TTL and omitted repeated indexes normalize exactly',()=>{
  const local=normalizeLocalIndexes({indexes:[],fieldOverrides:[{collectionGroup:'events',fieldPath:'expiresAt',ttl:true,indexes:standardIndexes('expiresAt').map(({fields,queryScope})=>{const {fieldPath,...mode}=fields[0];return {...mode,queryScope};})},{collectionGroup:'events',fieldPath:'payload',indexes:[]}]});
  const fields=[
    {name:fieldName('__default__','*'),indexConfig:{usesAncestorConfig:false,reverting:false,indexes:standardIndexes('*')}},
    {name:fieldName('events','expiresAt'),ttlConfig:{state:'ACTIVE',expirationOffset:'0s'},indexConfig:{usesAncestorConfig:true,ancestorField:fieldName('__default__','*'),indexes:standardIndexes('expiresAt')}},
    {name:fieldName('events','payload'),indexConfig:{usesAncestorConfig:false,ancestorField:fieldName('__default__','*')}}
  ];
  assert.deepEqual(normalizeRemoteIndexes([],fields,'lyfelabz-staging'),local);
  fields[2].indexConfig.indexes=[];
  assert.deepEqual(normalizeRemoteIndexes([],fields,'lyfelabz-staging'),local);
});
test('server-added composite __name__ suffix matches CLI defaults without erasing custom direction',()=>{
  for(const fields of [[{fieldPath:'grade',order:'DESCENDING'},{fieldPath:'resources',arrayConfig:'CONTAINS'}],[{fieldPath:'grade',order:'ASCENDING'},{fieldPath:'updatedAt',order:'DESCENDING'}],[{fieldPath:'resources',arrayConfig:'CONTAINS'}]]) {
    const local=normalizeLocalIndexes({indexes:[{collectionGroup:'units',queryScope:'COLLECTION',fields}],fieldOverrides:[]});
    const remote={name:'projects/lyfelabz-staging/databases/(default)/collectionGroups/units/indexes/id1',state:'READY',queryScope:'COLLECTION',density:'SPARSE_ALL',fields:local.indexes[0].fields};
    assert.deepEqual(normalizeRemoteIndexes([remote],[],'lyfelabz-staging'),local);
    const custom=structuredClone(remote);custom.fields.at(-1).order=custom.fields.at(-1).order==='ASCENDING'?'DESCENDING':'ASCENDING';
    assert.notDeepEqual(normalizeRemoteIndexes([custom],[],'lyfelabz-staging'),local);
  }
});
test('meaningful or unknown index differences remain refusals, including global default and inheritance',()=>{
  const base={name:fieldName('events','payload'),indexConfig:{indexes:[standardIndexes('payload')[0]]}};
  for(const mutate of [f=>{f.indexConfig.indexes[0].density='DENSE';},f=>{f.indexConfig.indexes[0].unique=true;},f=>{f.indexConfig.indexes[0].multikey=true;},f=>{f.indexConfig.indexes[0].apiScope='MONGODB_COMPATIBLE_API';},f=>{f.indexConfig.indexes[0].unknown=true;},f=>{f.indexConfig.indexes[0].fields[0].fieldPath='other';},f=>{f.indexConfig.reverting=true;},f=>{f.indexConfig.unknown=true;},f=>{f.ttlConfig={state:'ACTIVE',expirationOffset:'60s'};},f=>{f.indexConfig.usesAncestorConfig=true;},f=>{f.name=fieldName('__default__','*');f.indexConfig.indexes=[];},f=>{f.indexConfig.ancestorField=fieldName('__default__','*').replace('staging','prod');}]) {
    const f=structuredClone(base);mutate(f);assert.throws(()=>normalizeRemoteIndexes([],[f],'lyfelabz-staging'),/unsupported|unknown|uncertain|mismatch|incompatible|wrong-project/);
  }
});
test('retrieval, pagination and archives have explicit size/count bounds and no deployment effects',async()=>{
  await assert.rejects(list(async()=>({functions:[],nextPageToken:Math.random().toString()}),'https://example.test/list','functions'),/pagination limit/);
  await assert.rejects(list(async()=>({functions:new Array(LIMITS.items+1).fill({})}),'https://example.test/list','functions'),/item limit/);
  const get=readApi({token:'secret',fetchImpl:async()=>new Response('x',{headers:{'content-length':String(LIMITS.jsonBytes+1)}})});
  await assert.rejects(get('https://firebase.googleapis.com/test'),/oversized/);
  await assert.rejects(readApi({token:'secret',fetchImpl:async()=>new Response(Buffer.alloc(LIMITS.jsonBytes+1))})('https://firebase.googleapis.com/test'),/oversized/);
  assert.throws(()=>archiveRuntime(Buffer.alloc(LIMITS.archiveBytes+1)),/size limit/);
  assert.throws(()=>archiveRuntime(Buffer.from('zip'),()=>new Array(LIMITS.entries+1).fill('lib/a.js').join('\n')),/entry limit/);
  const calls=[];
  assert.throws(()=>archiveRuntime(Buffer.from('zip'),(command,args,options)=>{
    calls.push([command,...args]);assert.equal(options.timeout,30000);assert.ok(options.maxBuffer<=LIMITS.fileBytes);
    return args[0]==='-Z1'?'lib/index.js\npackage.json\npackage-lock.json\nlib/teacherUnits/unit-placeable-resources.json':Buffer.alloc(LIMITS.fileBytes+1);
  }),/runtime size/);
  assert.ok(calls.every(c=>c[0]==='unzip' && ['-p','-Z1'].includes(c[1])));
});
test('general scope independently validates closed build without reading Functions lib',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'general-candidate-'));
  try {
    const pair={releaseIntent:'general',source:candidate.source,files:{app:buildFixture(root,'general'),marketing:{}},unitPlacement:{fingerprint:artifact.placementFingerprint}};
    const c=releaseCandidate(pair,root);assert.equal(c.teacherUnitsAvailability,'closed');assert.equal(c.runtimeFiles,undefined);
    for(const intent of [undefined,'unknown','GENERAL'])assert.throws(()=>releaseIntent(intent),/explicit release intent/);
    assert.throws(()=>localCandidate(pair,root),/requires teacher-units intent/);
    fs.appendFileSync(path.join(root,'app/dist/bundle.js'),'\nconsole.log("mutated")');
    assert.throws(()=>hostingCandidate(pair,root),/unverifiable/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('ambiguous local field modes and unsupported local metadata refuse instead of being discarded',()=>{
  assert.throws(()=>normalizeLocalIndexes({indexes:[],fieldOverrides:[{collectionGroup:'x',fieldPath:'x',indexes:[{queryScope:'COLLECTION',order:'ASCENDING',arrayConfig:'CONTAINS'}]}]}),/ordering/);
  assert.throws(()=>normalizeLocalIndexes({indexes:[{name:'ignored?',collectionGroup:'x',queryScope:'COLLECTION',fields:[{fieldPath:'x',order:'ASCENDING'}]}],fieldOverrides:[]}),/local index metadata/);
});
test('backend inventory stops once its freshness budget is exhausted',async()=>{
  const f=fixture();let times=0;
  await assert.rejects(observe(f,{now:()=>times++ === 0?NOW:new Date(Date.parse(NOW)+MAX_AGE_MS+1).toISOString()}),/inventory deadline/);
  assert.equal(f.calls.length,0);
});

test('Teacher Units predeploy cannot record unevaluated or malformed backend readiness',async()=>{
  for(const bad of [null,{}, {candidate}]) {
    const f=await hookFixture();
    await assert.rejects(hostingPredeploy({...f.args,verify:async()=>bad,write:()=>assert.fail('no success record')}),/missing|unsupported|wrong-project/);
  }
});

test('malformed inventory metadata cannot masquerade as empty index evidence',async()=>{
  for(const page of [{unexpectedIndexes:[]},{indexes:[],nextPageToken:0},{indexes:[],unreachable:{}}])await assert.rejects(list(async()=>page,'https://example.test/list','indexes'),/unsupported|invalid/);
  for(const url of ['https://firebase.googleapis.com/v1beta1/projects/lyfelabz-staging','https://cloudfunctions.googleapis.com/v2/projects/lyfelabz-staging/locations/us-central1/functions/teacherUnitsArchive','https://firebaserules.googleapis.com/v1/projects/lyfelabz-staging/releases/cloud.firestore']) {
    const f=fixture();f.routes[url]=null;await assert.rejects(observe(f),/wrong-project|malformed resource/);
  }
});

test('predeploy checks modified prepared Hosting bytes before rebuilding or any remote effects',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'prepared-bytes-'));
  try {
    const app=buildFixture(root,'general');
    const directories={app:path.join(root,'hosting/app'),marketing:path.join(root,'hosting/marketing')};
    for(const dir of Object.values(directories))fs.mkdirSync(dir,{recursive:true});
    const bundlePath=path.join(directories.app,'app/dist/bundle.js');fs.mkdirSync(path.dirname(bundlePath),{recursive:true});
    fs.copyFileSync(path.join(root,'app/dist/bundle.js'),bundlePath);
    fs.copyFileSync(path.join(root,'app/index.html'),path.join(directories.app,'app/index.html'));
    fs.writeFileSync(path.join(directories.marketing,'index.html'),'marketing');
    const pair={kind:'lyfelabz.hostingPairBuild',schemaVersion:3,releaseIntent:'general',source:candidate.source,files:{app,marketing:{'index.html':sha256('marketing')}},unitPlacement:{fingerprint:artifact.placementFingerprint}};
    pair.candidate=hostingCandidate(pair,root);
    const f=await hookFixture('general');f.prepared.candidate=pair.candidate;f.prepared.source=pair.source;
    f.prepared.evidenceReceipt=receipt({phase:'prepared',project:'lyfelabz-staging',intent:'general',candidate:pair.candidate,hosting:f.prepared.surfaces,recordedAt:f.prepared.preparedAt});
    const check=()=>verifyPreparedPair({prepared:f.prepared,project:'lyfelabz-staging',read:()=>pair,candidateFor:p=>hostingCandidate(p,root),directories});
    check();
    fs.appendFileSync(bundlePath,'\nunsafe');
    await assert.rejects(hostingPredeploy({...f.args,verifyExisting:check}),/artifact changed/);
    assert.equal(f.calls.length,0);
    fs.copyFileSync(path.join(root,'app/dist/bundle.js'),bundlePath);
    const evidenceFile=path.join(root,'app/dist/application-build.json');const build=JSON.parse(fs.readFileSync(evidenceFile));build.availability='enabled';fs.writeFileSync(evidenceFile,JSON.stringify(build));
    await assert.rejects(hostingPredeploy({...f.args,verifyExisting:check}),/unverifiable/);assert.equal(f.calls.length,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('receipt refuses enabled/unknown availability, missing build fingerprint and rejected v2 claims',()=>{
  const args={phase:'prepared',project:'lyfelabz-staging',intent:'general',hosting:{app:{},marketing:{}}};
  for(const mutation of [c=>{c.teacherUnitsAvailability='enabled';},c=>{c.teacherUnitsAvailability='unknown';},c=>{delete c.applicationBuildFingerprint;},c=>{delete c.availabilityEvidence;},c=>{c.availabilityEvidence='verified-runtime';},c=>{delete c.teacherUnitsAvailability;c.closedGateSourceHash=sha256('v2');}]) {
    const c={...candidate,releaseIntent:'general'};mutation(c);assert.throws(()=>receipt({...args,candidate:c}),/availability candidate evidence/);
  }
});

test('general intent refuses an enabled replacement bundle even with self-consistent forged hash claims',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'forged-enabled-candidate-'));
  try {
    const files=buildFixture(root,'general');
    const enabled=Buffer.from("document.body.innerHTML = '<button>My Units</button>';\n");
    fs.writeFileSync(path.join(root,'app/dist/bundle.js'),enabled);
    const file=path.join(root,'app/dist/application-build.json');const evidence=JSON.parse(fs.readFileSync(file));
    evidence.outputs['app/dist/bundle.js']=sha256(enabled);fs.writeFileSync(file,JSON.stringify(evidence));
    files['app/dist/bundle.js']=sha256(enabled);
    const pair={releaseIntent:'general',source:candidate.source,files:{app:files,marketing:{}},unitPlacement:{fingerprint:artifact.placementFingerprint}};
    // Reconstructed output, not the matching local declarations, controls certification.
    assert.throws(()=>hostingCandidate(pair,root),/unverifiable/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('hostname-conditional shadow refuses general preparation and predeploy before remote effects',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'hostname-shadow-candidate-'));
  try {
    const app=buildFixture(root,'general');
    const pair={releaseIntent:'general',source:candidate.source,files:{app,marketing:{}},unitPlacement:{fingerprint:artifact.placementFingerprint}};
    const original=hostingCandidate(pair,root);
    fs.writeFileSync(path.join(root,'app/src/teacherUnits/releaseAvailability.tsx'),
      'export function teacherUnitsAvailable(){return location.hostname === "app.lyfelabz.com";} export function requireTeacherUnitsAvailable(){}');
    // Existing safe output and its matching historical evidence cannot hide a new shadow.
    assert.throws(()=>hostingCandidate(pair,root),/unverifiable/);
    const f=await hookFixture('general');f.prepared.candidate=original;f.prepared.source=original.source;
    f.prepared.evidenceReceipt=receipt({phase:'prepared',project:'lyfelabz-staging',intent:'general',candidate:original,hosting:f.prepared.surfaces,recordedAt:f.prepared.preparedAt});
    await assert.rejects(hostingPredeploy({...f.args,verifyExisting:()=>hostingCandidate(pair,root)}),/unverifiable/);
    assert.equal(f.calls.length,0);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

// Staging UX test intent (docs/platform/TEACHER_UNITS_STAGING_UX_TEST_DESIGN.md): staging only.
test('staging-ux-test intent is accepted only for the staging project',()=>{
  assert.equal(assertIntentForProject('staging-ux-test','lyfelabz-staging'),'staging-ux-test');
  assert.throws(()=>assertIntentForProject('staging-ux-test','lyfelabz-prod'),/only for the staging project/);
  for(const intent of ['general','teacher-units'])assert.equal(assertIntentForProject(intent,'lyfelabz-prod'),intent);
  assert.throws(()=>assertIntentForProject('STAGING-UX-TEST','lyfelabz-staging'),/explicit release intent/);
});
test('staging-ux-test candidate records origin-gated availability and never verifies as another intent',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'staging-ux-candidate-'));
  try {
    const pair={releaseIntent:'staging-ux-test',source:candidate.source,files:{app:buildFixture(root,'staging-ux-test'),marketing:{}},unitPlacement:{fingerprint:artifact.placementFingerprint}};
    const c=releaseCandidate(pair,root);assert.equal(c.teacherUnitsAvailability,'staging-ux-test');assert.equal(c.runtimeFiles,undefined);
    // The same staging bundle relabelled general cannot pass the closed check.
    assert.throws(()=>releaseCandidate({...pair,releaseIntent:'general'},root),/unverifiable|availability/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('staging-ux-test receipts are staging only and bind their availability label',()=>{
  const c={releaseIntent:'staging-ux-test',source:candidate.source,hostingArtifactFingerprint:sha256('hosting'),placementFingerprint:artifact.placementFingerprint,teacherUnitsAvailability:'staging-ux-test',availabilityEvidence:'build-contract-assertion',applicationBuildFingerprint:sha256('build')};
  const args={phase:'prepared',intent:'staging-ux-test',candidate:c,hosting:{app:{},marketing:{}}};
  assert.equal(receipt({...args,project:'lyfelabz-staging'}).teacherUnitsReadiness,'staging-ux-test-uncertified');
  assert.throws(()=>receipt({...args,project:'lyfelabz-prod'}),/only for the staging project/);
  assert.throws(()=>receipt({...args,project:'lyfelabz-staging',candidate:{...c,teacherUnitsAvailability:'closed'}}),/availability candidate evidence/);
  assert.throws(()=>receipt({...args,project:'lyfelabz-staging',intent:'general',candidate:{...c,releaseIntent:'general'}}),/availability candidate evidence/);
  assert.throws(()=>receipt({...args,project:'lyfelabz-staging',evidence:{}}),/cannot claim backend readiness/);
});
test('staging-ux-test predeploy runs for staging without backend reads, and refuses production before any effect',async()=>{
  const f=await hookFixture('staging-ux-test');
  const result=await hostingPredeploy({...f.args,verify:()=>assert.fail('must not read Teacher Units backend')});
  assert.equal(result.backend,null);assert.deepEqual(f.calls,['build','hosting','hosting','record']);
  const g=await hookFixture('staging-ux-test');
  await assert.rejects(hostingPredeploy({...g.args,project:'lyfelabz-prod'}),/only for the staging project/);
  assert.equal(g.calls.length,0);
});
