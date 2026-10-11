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
  assertCompatible, verifyBackend, receipt, localCandidate } = require('./backend-state.cjs');
const { hostingPredeploy } = require('./build-pair.cjs');
const NOW = '2026-10-11T16:00:00.000Z';
const ids = ['lesson_test'];
const runtimeFiles = { 'lib/index.js':sha256('runtime'), 'lib/teacherUnits/unit-placeable-resources.json':sha256(JSON.stringify({resourceIds:ids})), 'package.json':sha256('{}'), 'package-lock.json':sha256('{}') };
const artifact = { runtimeFiles, artifactFingerprint:fingerprint(runtimeFiles), placementFingerprint:placementFingerprint(ids), archiveHash:sha256('zip') };
const candidate = { source:{sha:'a'.repeat(40),dirty:false}, hostingArtifactFingerprint:sha256('hosting'), functionsArtifactFingerprint:artifact.artifactFingerprint,
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
  const calls=[]; const get=readApi({token:'private-token',fetchImpl:async (url,options) => {calls.push(options);return {ok:true,json:async () => ({ok:true})};}});
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
  const e=await observe();const args={phase:'prepared',project:e.project,candidate,evidence:e,hosting:{app:{baseline:{version:'aaa'}},marketing:{baseline:{version:'bbb'}}},recordedAt:NOW};
  const a=receipt(args); const b=receipt({...args,candidate:Object.fromEntries(Object.entries(candidate).reverse())});
  assert.equal(JSON.stringify(a),JSON.stringify(b));assert.match(a.authority,/historical/);
  assert.equal(a.backend.rules.ruleset,'projects/lyfelabz-staging/rulesets/rules1');
  assert.throws(() => receipt({...args,hosting:{app:{}}}),/paired Hosting/);
});
test('Hosting predeploy repeats remote verification and failure blocks before success record',async () => {
  const calls=[];const pair={record:{source:{sha:'a'.repeat(40)}}};
  for(let i=0;i<2;i++) await hostingPredeploy({project:'lyfelabz-staging',build:() => {calls.push('build');return pair;},verify:async args => {assert.equal(args.project,'lyfelabz-staging');calls.push('remote');return {verified:true};},write:() => calls.push('record')});
  assert.deepEqual(calls,['build','remote','record','build','remote','record']);
  await assert.rejects(hostingPredeploy({project:'lyfelabz-staging',build:() => pair,verify:async () => {throw new Error('unavailable deployment API');},write:() => assert.fail('must not record readiness')}),/unavailable/);
  await assert.rejects(hostingPredeploy({project:undefined,build:() => assert.fail('must verify project first')}),/explicit --project/);
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
    const pair={source:candidate.source,files:{app:{},marketing:{}},unitPlacement:{fingerprint:artifact.placementFingerprint}};
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
