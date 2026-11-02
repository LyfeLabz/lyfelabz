'use strict';
// Synthetic transport only. No real Firebase reads, records or deployment.
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const U=require('./unchanged-backend.cjs'),H=require('./backend-state.cjs'),C=require('./contract.cjs');
const {fixture,currentReleaseFixture}=require('../teacher-units-release/option-b-observation.test.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function encode(v) {
  if(v===null)return {nullValue:null};
  if(v?.constructor?.name==='Timestamp')return {timestampValue:new Date(v.seconds*1000).toISOString().slice(0,19)+'.'+String(v.nanoseconds).padStart(9,'0')+'Z'};
  if(Array.isArray(v))return {arrayValue:{values:v.map(encode)}};
  if(typeof v==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,encode(x)]))}};
  return typeof v==='number'?{integerValue:String(v)}:typeof v==='boolean'?{booleanValue:v}:{stringValue:v};
}
async function setup(now=new Date().toISOString()) {
  const f=await currentReleaseFixture({now});
  const p=f.policy;p.mode='enabled';p.acceptedClientContractVersions=['teacher-units-v3'];p.lastEnabledAt=p.updatedAt;
  const {Timestamp}=require(require.resolve('firebase-admin/firestore',{paths:[path.resolve(__dirname,'../../platform/functions')]}));
  p.lastClosedAt=Timestamp.fromMillis(Date.parse(now)-1000);p.createdAt=p.lastClosedAt;
  const policy={name:`projects/${f.candidate.projectId}/databases/(default)/documents/platformConfig/teacherUnitsAvailability`,fields:encode(p).mapValue.fields,createTime:new Date(Date.parse(now)-1000).toISOString(),updateTime:now};
  const evidence={observation:f.evidence,policy};
  const c={kind:U.KIND,schemaVersion:1,projectId:f.candidate.projectId,source:{sha:'9'.repeat(40),dirty:false},target:H.optionBTarget(f.candidate.projectId),releaseIntent:U.INTENT,
    teacherUnitsAvailability:'server-policy-required',availabilityEvidence:'build-contract-assertion',hostingArtifactFingerprint:f.candidate.hostingArtifactFingerprint,
    applicationBuildFingerprint:f.candidate.applicationBuildFingerprint,rulesSourceHash:f.candidate.rulesSourceHash,indexes:f.candidate.indexes,
    backendBaseline:evidence,backendPin:U.pin(f.evidence,policy)};
  const inputs={rulesApproval:f.rulesApproval,rulesReport:f.rulesReport.toString('utf8'),approvalDigest:f.approvalDigest,configurationApproval:f.configurationApproval};
  return {...f,c,inputs,evidence,now};
}
function prepared(f,hosting) {
  const project=f.c.projectId;
  const surfaces=hosting||Object.fromEntries(Object.entries(C.readTargetSites(project)).map(([k,site])=>[k,{site,baseline:{version:'aaa123',releaseTime:f.now}}]));
  return {kind:'lyfelabz.hostingPreparedRelease',schemaVersion:3,project,environment:f.c.target.environment,releaseIntent:U.INTENT,source:f.c.source,candidate:f.c,preparedAt:f.now,surfaces,
    evidenceReceipt:H.receipt({phase:'prepared',project,intent:U.INTENT,candidate:f.c,evidence:f.evidence,hosting:surfaces,...f.inputs,recordedAt:f.now})};
}
test('new Hosting SHA certifies against original backend SHA with unchanged enabled policy',async()=>{
  const f=await setup();try {
    const result=U.compare(f.c,f.evidence,f.inputs,f.now);
    assert.equal(result.hostingSourceSha,'9'.repeat(40));assert.equal(result.backendSourceSha,'a'.repeat(40));assert.equal(result.policyGeneration,4);
    const p=prepared(f);H.verifyPrepared(p,f.c.projectId,f.c,f.now);
    const hosting=Object.fromEntries(Object.entries(C.readTargetSites(f.c.projectId)).map(([k,site])=>[k,{site,version:'bbb123',previous:'aaa123',releaseTime:f.now,bytes:{matched:1,redirected:0}}]));
    assert.equal(H.receipt({phase:'certified',project:f.c.projectId,intent:U.INTENT,candidate:f.c,evidence:f.evidence,hosting,...f.inputs,recordedAt:f.now}).compatibility.backendBuildId,f.evidence.observation.backendBuildId);
    assert.equal(f.evidence.policy.fields.generation.integerValue,'4');
  }finally{f.cleanup();}
});
for(const [label,mutate] of [
  ['backend build',e=>e.observation.backendBuildId='0'.repeat(64)],
  ['backend source SHA',e=>e.observation.build.sourceSha='0'.repeat(40)],
  ['serving revision',e=>e.observation.endpoints[0].revisionResource+='other'],
  ['policy generation',e=>e.policy.fields.generation.integerValue='5'],
  ['policy instance',e=>e.policy.fields.policyInstanceId.stringValue='123e4567-e89b-4abc-8def-1234567890aa'],
  ['policy closed',e=>e.policy.fields.mode.stringValue='closed'],
  ['policy backend pin',e=>e.policy.fields.approvedBackendBuildId.stringValue='0'.repeat(64)],
  ['policy updateTime',e=>e.policy.updateTime='2026-01-01T00:00:00.000Z'],
  ['runtime file',e=>e.observation.runtimeFiles['lib/index.js']='0'.repeat(64)],
  ['Rules identity',e=>e.observation.rules.rulesetResource+='other'],
  ['unsupported backend protocol',e=>e.observation.build.supportedClientContractVersions=['teacher-units-v4']],
  ['backend placement',e=>e.observation.placementFingerprint='0'.repeat(64)],
]) test(`rejects changed ${label}`,async()=>{const f=await setup();try{const e=clone(f.evidence);mutate(e);assert.throws(()=>U.compare(f.c,e,f.inputs,f.now));}finally{f.cleanup();}});
test('rejects incompatible client placement, unapproved Rules/config and stale observation',async()=>{
  const f=await setup();try{
    for(const edit of [c=>c.rulesSourceHash='0'.repeat(64),c=>c.source.dirty=true,c=>c.source.sha='bad',c=>c.target.origin='https://evil.example',c=>c.backendPin='0'.repeat(64)]) {const c=clone(f.c);edit(c);assert.throws(()=>U.compare(c,f.evidence,f.inputs,f.now));}
    assert.throws(()=>U.compare(f.c,f.evidence,{...f.inputs,approvalDigest:'0'.repeat(64)},f.now));
    assert.throws(()=>U.compare(f.c,f.evidence,{...f.inputs,configurationApproval:{...f.configurationApproval,sourceSha:'0'.repeat(40)}},f.now));
    assert.throws(()=>U.compare(f.c,f.evidence,f.inputs,new Date(Date.parse(f.now)+H.MAX_AGE_MS+1).toISOString()));
    assert.throws(()=>H.verifyPrepared({...prepared(f),source:{sha:'0'.repeat(40),dirty:false}},f.c.projectId,f.c,f.now));
    assert.throws(()=>U.assertClientSource(C.repositoryRoot,'a'.repeat(40),'0'.repeat(40)),/SHA/);
  }finally{f.cleanup();}
});
test('policy REST decoder retains nanoseconds and refuses ambiguous/unsafe values',()=>{
  assert.equal(U.decode({timestampValue:'2026-10-30T00:00:00.123456789Z'}).nanoseconds,123456789);
  for(const value of [{integerValue:'9007199254740992'},{doubleValue:1},{booleanValue:true,stringValue:'x'},{timestampValue:'2026-02-30T00:00:00Z'}])assert.throws(()=>U.decode(value));
});
test('read-only observer double-reads policy and detects a change during observation',async()=>{
  const f=await setup();try{
    const requests=[];let reads=0;
    const get=async(url,binary)=>{requests.push(url);return url.includes('/documents/')?clone(f.evidence.policy):f.provider.get(url,binary);};
    const observed=await U.inspect({project:f.c.projectId,...f.inputs,get,now:()=>f.now});
    assert.equal(U.pin(observed.observation,observed.policy),f.c.backendPin);
    assert.equal(requests.filter(u=>u.includes('/documents/')).length,2);
    await assert.rejects(U.inspect({project:f.c.projectId,...f.inputs,get:async(url,binary)=>{if(!url.includes('/documents/'))return f.provider.get(url,binary);const p=clone(f.evidence.policy);if(++reads===2)p.fields.generation.integerValue='5';return p;},now:()=>f.now}),/policy during observation/);
  }finally{f.cleanup();}
});
test('new mode requires online clean preparation and retains paired baseline checks',async()=>{
  const f=await setup();try{
    const {preflight}=require('./prepare.cjs');
    for(const extra of [{offline:true},{allowDirty:true}])assert.throws(()=>preflight({project:f.c.projectId,intent:U.INTENT,...extra}),/clean online/);
    const p=prepared(f);delete p.surfaces.marketing;assert.throws(()=>H.verifyPrepared(p,f.c.projectId,f.c,f.now));
    const q=prepared(f);q.evidenceReceipt.candidate=clone(f.c);q.evidenceReceipt.candidate.source.sha='0'.repeat(40);assert.throws(()=>H.verifyPrepared(q,f.c.projectId,f.c,f.now));
  }finally{f.cleanup();}
});
test('real candidate compiler contract rejects closed profile, wrong bytes, placement and source',async()=>{
  const f=await setup();const root=fs.mkdtempSync(path.join(os.tmpdir(),'hosting-only-candidate-'));try{
    fs.mkdirSync(path.join(root,'platform/firebase'),{recursive:true});fs.writeFileSync(path.join(root,'platform/firebase/firestore.rules'),'synthetic');fs.writeFileSync(path.join(root,'platform/firebase/firestore.indexes.json'),JSON.stringify({indexes:[],fieldOverrides:[]}));
    const build={schemaVersion:2,releaseIntent:'teacher-units',availability:'server-policy-required',runtimeAvailability:'not-certified',availabilityEvidence:'build-contract-assertion',policyTarget:f.c.target,outputs:{'app/dist/bundle.js':'b'.repeat(64)},inputs:{'app/index.html':'c'.repeat(64)}};
    const pair={releaseIntent:U.INTENT,backendFormat:U.INTENT,source:f.c.source,target:f.c.target,backendBaseline:f.evidence,files:{app:{...build.outputs,...build.inputs},marketing:{'index.html':'d'.repeat(64)}},unitPlacement:{fingerprint:f.evidence.observation.placementFingerprint}};
    const options={verifySource:(root,backendSha,hostingSha)=>{assert.equal(backendSha,'a'.repeat(40));assert.equal(hostingSha,'9'.repeat(40));},verifyApplication:()=>build};
    assert.equal(U.candidate(pair,root,options).source.sha,f.c.source.sha);
    assert.throws(()=>U.candidate(pair,root,{...options,verifySource:()=>{throw Error('source changed');}}),/source changed/);
    for(const edit of [p=>p.unitPlacement.fingerprint='0'.repeat(64),p=>p.files.app['app/dist/bundle.js']='0'.repeat(64),p=>p.target.origin='https://evil.example']) {const p=clone(pair);edit(p);assert.throws(()=>U.candidate(p,root,options));}
    assert.throws(()=>U.candidate(pair,root,{...options,verifyApplication:()=>({...build,availability:'closed'})}));
  }finally{f.cleanup();fs.rmSync(root,{recursive:true,force:true});}
});
async function certificationFlow({mutateBackend,mutatePair,partial=false}={}) {
  const f=await setup(),root=fs.mkdtempSync(path.join(os.tmpdir(),'hosting-only-flow-'));
  try {
    const project=f.c.projectId,env=C.environmentForProject(project),sites=C.readTargetSites(project),routing=C.readHostingTargets(C.readConfigFile(env.config));
    const body='synthetic Hosting homepage',directories={},files={};
    for(const key of ['app','marketing']) {directories[key]=path.join(root,key);fs.mkdirSync(directories[key]);fs.writeFileSync(path.join(directories[key],'index.html'),body);files[key]={'index.html':C.sha256(body)};}
    f.c.hostingArtifactFingerprint=H.fingerprint(files);
    const pair={kind:'lyfelabz.hostingPairBuild',schemaVersion:3,releaseIntent:U.INTENT,source:f.c.source,files,candidate:f.c};
    const p=prepared(f);let writes=0,backendReads=0;
    const routes=new Map(),contract=C.loadContract();
    for(const sample of contract.redirectSamples)routes.set(`${env.origins[sample.target]}${new URL(sample.path,env.origins[sample.target]).pathname}`,{status:sample.status,location:sample.location.replace('{app}',env.origins.app).replace('{marketing}',env.origins.marketing)});
    for(const sample of contract.routeSamples)routes.set(`${env.origins[sample.target]}${new URL(sample.path,env.origins[sample.target]).pathname}`,{status:sample.status});
    for(const origin of [env.origins.app,env.origins.marketing,...env.entryAliases])routes.set(origin+'/',{status:200});
    const backendVerify=async()=>{backendReads++;const evidence=clone(f.evidence);mutateBackend?.(evidence);return {candidate:f.c,evidence};};
    // Real predeploy producer, with only build/transport substitutes. It must
    // carry the original baseline into its rebuild and recheck current policy.
    await require('./build-pair.cjs').hostingPredeploy({project,read:()=>p,verifyExisting:()=>{},candidateFor:()=>f.c,
      build:options=>{assert.equal(options.intent,U.INTENT);assert.deepEqual(options.backendBaseline,f.c.backendBaseline);assert.deepEqual(options.target,f.c.target);return {record:pair};},
      verify:backendVerify,discover:({site})=>({site}),write:()=>{}});
    mutatePair?.(pair);
    const result=await require('./certify.cjs').certify({project,intent:U.INTENT,directories,optionB:f.inputs,candidateFor:()=>f.c,
      readJson:name=>name.endsWith('pair-build.json')?pair:p,
      run:(cmd,args)=>{
        assert.equal(cmd,'firebase');
        if(args[0]==='hosting:sites:list')return JSON.stringify({status:'success',result:{sites:Object.values(sites).map(site=>({name:`projects/${project}/sites/${site}`}))}});
        assert.equal(args[0],'hosting:channel:list');const site=args[args.indexOf('--site')+1],key=site===sites.app?'app':'marketing';
        return JSON.stringify({status:'success',result:{channels:[{name:`sites/${site}/channels/live`,release:{message:require('./release.cjs').releaseMessage(f.c.source.sha,false),releaseTime:f.now,version:{name:`sites/${site}/versions/${partial&&key==='marketing'?'aaa123':'bbb123'}`,config:C.toApiRouting(routing[key])}}}]}});
      },fetchImpl:async url=>{const u=new URL(url),r=routes.get(u.origin+u.pathname);assert.ok(r,url);return new Response(body,{status:r.status,headers:r.location?{location:r.location}:{}});},
      backendVerify,certifyEntry:async()=>({checked:1}),log:()=>{},write:()=>{writes++;return '/synthetic/result.json';}});
    assert.equal(writes,1);assert.equal(backendReads,2);assert.equal(result.record.evidenceReceipt.kind,U.RECEIPT);
    assert.equal(result.record.evidenceReceipt.compatibility.backendSourceSha,'a'.repeat(40));
    return result;
  }finally{f.cleanup();fs.rmSync(root,{recursive:true,force:true});}
}
test('real predeploy and certification producers support the Hosting-only evidence route',async()=>{await certificationFlow();});
test('real release flow refuses policy drift, partial paired deploy and changed source receipt',async()=>{
  await assert.rejects(certificationFlow({mutateBackend:e=>e.policy.fields.generation.integerValue='5'}),/changed|incompatible/);
  await assert.rejects(certificationFlow({partial:true}),/baseline/);
  await assert.rejects(certificationFlow({mutatePair:p=>{p.candidate={...p.candidate,source:{sha:'0'.repeat(40),dirty:false}};}}),/candidate changed/);
});
test('Hosting-only pair build uses the policy compiler and rebuilds runtime without building Functions',()=>{
  const vm=require('node:vm'),{createRequire}=require('node:module');
  const file=path.join(__dirname,'build-pair.cjs'),realRequire=createRequire(file),events=[];
  const target=H.optionBTarget('lyfelabz-staging'),baseline={synthetic:true};
  const overrides={
    'node:child_process':{execFileSync(command,args){
      if(command==='git')return args[0]==='rev-parse'?'9'.repeat(40):'';
      if(command===process.execPath){assert.equal(args[3],'teacher-units');assert.deepEqual(Array.from(args.slice(4)),[target.projectId,target.environment,target.origin]);events.push('compiler');return;}
      assert.equal(command,'npm');assert.deepEqual(Array.from(args),['--prefix','app','run','build:runtime']);events.push('runtime');
    }},
    'node:fs':{mkdirSync(){},writeFileSync(){}},
    '../app-hosting/build.cjs':{buildApplicationArtifact(){events.push('app');return {files:[]};}},
    '../marketing-hosting/build.cjs':{buildMarketingArtifact(){events.push('marketing');return {files:[]};}},
    './contract.cjs':{...C,artifactFiles:()=>[],verifyPair:()=>({})},
    './backend-state.cjs':{...H,releaseCandidate(pair){assert.equal(pair.backendFormat,U.INTENT);assert.deepEqual(pair.backendBaseline,baseline);assert.deepEqual(pair.target,target);return {};}}
  };
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(file,'utf8'),{module,require:name=>overrides[name]||realRequire(name),process,console},{filename:file});
  module.exports.buildPair({intent:U.INTENT,target,backendBaseline:baseline,runFunctionsBuild:true,placementParity:()=>({}),log(){}});
  assert.deepEqual(events,['compiler','runtime','app','marketing']);
});
test('wrong project and invalid configuration refuse before credential/provider access',async()=>{
  let reads=0;
  await assert.rejects(U.inspect({project:'lyfelabz-prod',configurationApproval:{},get:async()=>{reads++;}}),/REFUSED/);
  await assert.rejects(U.verify({project:'lyfelabz-prod',pair:{target:{projectId:'lyfelabz-staging'}},get:async()=>{reads++;}}),/project mismatch/);
  assert.equal(reads,0);
});
