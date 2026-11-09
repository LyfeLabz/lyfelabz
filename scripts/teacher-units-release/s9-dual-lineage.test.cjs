'use strict';
const test=require('node:test'), assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path');
const S9=require('../hosting-release/s9-dual-lineage.cjs');
const U=require('../hosting-release/unchanged-backend.cjs');
const H=require('../hosting-release/backend-state.cjs');
const C=require('../hosting-release/contract.cjs');
const O=require('./option-b-observation.cjs');
const A=require('./availability-control.cjs');
const {currentReleaseFixture}=require('./option-b-observation.test.cjs');
const {memory,clone,A:audit,Timestamp}=require('./availability-control.test.cjs');
const toolingSha='c'.repeat(40), policyInstanceId='123e4567-e89b-4abc-8def-1234567890ab';

function approval(pin, sourceFingerprint=S9.sourceFingerprint(C.repositoryRoot), generation=4) {
  const record={kind:S9.KIND,schemaVersion:1,projectId:S9.PROJECT,hostingSha:S9.HOSTING,backendSha:S9.BACKEND,
    backendBuildId:S9.BUILD,backendPin:pin,policyInstanceId,policyGeneration:generation,clientContract:S9.CONTRACT,
    sourceFingerprint,toolingSha,decisionRef:'modeled-hosting-owner-decision',principalSubject:'modeled-owner'};
  return {approval:record,digest:H.fingerprint(record)};
}
test('exception requires the exact staging pair, build, policy and explicit owner digest',()=>{
  const backendPin='d'.repeat(64), authorization=approval(backendPin);
  const input={project:S9.PROJECT,hostingSha:S9.HOSTING,backendPin,authorization,
    observation:{projectId:S9.PROJECT,build:{sourceSha:S9.BACKEND},backendBuildId:S9.BUILD},policy:{policyInstanceId,generation:4}};
  assert.deepEqual(S9.approved(input),authorization.approval);
  for (const invalid of [{project:'lyfelabz-prod'},{hostingSha:'e'.repeat(40)},
    {observation:{...input.observation,backendBuildId:'a'.repeat(64)}},
    {observation:{...input.observation,build:{sourceSha:'e'.repeat(40)}}},
    {policy:{policyInstanceId,generation:5}},{authorization:undefined},
    {authorization:{...authorization,digest:'f'.repeat(64)}}])
    assert.throws(()=>S9.approved({...input,...invalid}),/REFUSED/);
  for(const field of ['clientContract','principalSubject','decisionRef','backendPin']) {
    const tampered={...authorization.approval,[field]:''};
    assert.throws(()=>S9.approved({...input,authorization:{approval:tampered,digest:H.fingerprint(tampered)}}),/owner release approval/);
  }
});

test('source proof checks the real pair manifests and refuses hidden files or changes outside tooling',()=>{
  const a=approval('d'.repeat(64)).approval;
  const run=({changed='scripts/hosting-release/s9-dual-lineage.cjs', dirty='', hidden='', changedManifest}={})=>(cmd,args,options)=>{
    if(args[0]==='rev-parse') return toolingSha;
    if(args[0]==='status') return dirty;
    if(args[0]==='ls-files') return hidden;
    if(args[0]==='merge-base') return '';
    if(args[0]==='diff') return changed+'\0';
    const real=execFileSync(cmd,args,options);
    return args[3]===S9.BACKEND && changedManifest ? real.replace(new RegExp(changedManifest),'changed') : real;
  };
  assert.deepEqual(S9.sourceProof(C.repositoryRoot,a,run()),{sha:S9.HOSTING,dirty:false});
  for(const changed of ['app/src/teacherUnits/releaseBoundary.ts','platform/functions/src/supportAccess/teaching-callable.ts','firebase.staging.json',' scripts/hosting-release/s9-dual-lineage.cjs'])
    assert.throws(()=>S9.sourceProof(C.repositoryRoot,a,run({changed})),/outside the release tooling/);
  for(const changedManifest of ['releaseBoundary','teaching-callable'])
    assert.throws(()=>S9.sourceProof(C.repositoryRoot,a,run({changedManifest})),/client or backend authorization/);
  assert.throws(()=>S9.sourceProof(C.repositoryRoot,a,run({dirty:' M file'})),/clean/);
  assert.throws(()=>S9.sourceProof(C.repositoryRoot,a,run({hidden:'S file\0'})),/hidden/);
});

function rest(v) {
  if(v===null)return {nullValue:null};
  if(v instanceof Timestamp)return {timestampValue:new Date(v.seconds*1000).toISOString().slice(0,19)+'.'+String(v.nanoseconds).padStart(9,'0')+'Z'};
  if(Array.isArray(v))return {arrayValue:{values:v.map(rest)}};
  if(typeof v==='object')return {mapValue:{fields:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,rest(x)]))}};
  return typeof v==='number'?{integerValue:String(v)}:{stringValue:v};
}
async function recovery(t) {
  const body='modeled staging Hosting bytes';
  const hash=C.sha256(body);
  const f=await currentReleaseFixture({scoped:true,hostingFiles:{app:{'app/dist/bundle.js':hash,'app/index.html':hash},marketing:{'index.html':hash}}});
  t.after(f.cleanup);
  const original={BUILD:S9.BUILD,ROLLBACK_BUILD:S9.ROLLBACK_BUILD,ROLLBACK_SHA256:S9.ROLLBACK_SHA256};
  const testApproval=approval('a'.repeat(64)).approval;
  // Only substitute fixture identities for pinned real source artifacts. The
  // provider inspection, byte hashing, policy/CAS and receipt validators are real.
  S9.BUILD=f.evidence.backendBuildId;
  S9.ROLLBACK_BUILD=f.bundle.rollback.backendBuildId;
  S9.ROLLBACK_SHA256=f.bundle.rollback.artifactSha256;
  const realApproved=S9.approved;
  t.mock.method(S9,'approved',input=>{
    if (input.observation.build.sourceSha!==f.evidence.build.sourceSha || input.observation.backendBuildId!==S9.BUILD)
      throw Error('wrong fixture backend');
    return realApproved({...input,observation:{...input.observation,build:{sourceSha:S9.BACKEND},backendBuildId:original.BUILD},
      authorization:input.authorization});
  });
  t.after(()=>Object.assign(S9,original));
  t.mock.method(S9,'sourceProof',(_root,app)=>{assert.equal(app.sourceFingerprint,testApproval.sourceFingerprint);return {sha:S9.HOSTING,dirty:false};});
  Object.assign(f.provider.state.database,{locationId:'nam5',uid:'037a7646-a60f-419a-8263-eea18fef3318'});
  const indexConfig=JSON.parse(fs.readFileSync(path.join(C.repositoryRoot,'platform/firebase/firestore.indexes.json'),'utf8'));
  f.provider.state.indexes=indexConfig.indexes.map(({collectionGroup,...index},i)=>({
    ...index,name:`projects/${S9.PROJECT}/databases/(default)/collectionGroups/${collectionGroup}/indexes/modeled${i}`,state:'READY'}));
  const evidence=await O.inspectOptionB({project:S9.PROJECT,get:f.provider.get,now:()=>f.now,plan:f.configurationApproval,supportIndexes:true});
  const earlier=Timestamp.fromMillis(Date.parse(f.now)-1000);
  const initial={...f.policy,mode:'enabled',createdAt:earlier,lastClosedAt:earlier,acceptedClientContractVersions:[S9.CONTRACT],lastEnabledAt:f.policy.updatedAt};
  const at=Date.parse(f.now), now=()=>new Date(clock).toISOString();
  let clock=at, badBytes=false, badRouting=false, badRollback=false, providerOverride;
  const policy={name:`projects/${S9.PROJECT}/databases/(default)/documents/platformConfig/teacherUnitsAvailability`,
    fields:rest(initial).mapValue.fields,updateTime:rest(initial.updatedAt).timestampValue,createTime:rest(initial.createdAt).timestampValue};
  const pin=U.pin(evidence,policy);
  const releaseApproval={...testApproval,backendPin:pin};
  const backendBaseline={observation:evidence,policy,dualLineage:{approval:releaseApproval,digest:H.fingerprint(releaseApproval)}};
  const candidate={kind:U.KIND,schemaVersion:1,projectId:S9.PROJECT,source:{sha:S9.HOSTING,dirty:false},target:H.optionBTarget(S9.PROJECT),
    releaseIntent:U.INTENT,teacherUnitsAvailability:'server-policy-required',availabilityEvidence:'build-contract-assertion',
    hostingArtifactFingerprint:f.candidate.hostingArtifactFingerprint,applicationBuildFingerprint:f.candidate.applicationBuildFingerprint,
    rulesSourceHash:f.candidate.rulesSourceHash,indexes:H.normalizeLocalIndexes(indexConfig),backendBaseline,backendPin:pin};
  const inputs={rulesApproval:f.bundle.rulesApproval,rulesReport:f.bundle.rulesReport,approvalDigest:f.approvalDigest,configurationApproval:f.configurationApproval};
  const certifiedReceipt=U.receipt({phase:'certified',project:S9.PROJECT,intent:U.INTENT,candidate,evidence:{observation:evidence,policy},
    hosting:f.bundle.certifiedReceipt.hosting,...inputs,recordedAt:f.now});
  const bundle={...f.bundle,kind:S9.CURRENT,approvalRef:'modeled-separate-reenable',candidate,certifiedReceipt,observation:evidence,
    closePlan:null};
  bundle.review.decisionRef=bundle.approvalRef;
  const routing=C.readHostingTargets(C.readConfigFile('firebase.staging.json')), sites=C.readTargetSites(S9.PROJECT);
  const get=async(url,binary)=>{
    if(url.startsWith('https://firebasehosting.googleapis.com/')) {
      const key=url.includes(sites.marketing)?'marketing':'app';
      return {release:{message:`release ${S9.HOSTING}`,version:{name:`sites/${sites[key]}/versions/${bundle.hosting[key].version}`,
        config:badRouting ? {} : C.toApiRouting(routing[key])}}};
    }
    const observed=await f.provider.get(url,binary);
    return providerOverride?.(url,observed)??observed;
  };
  const refresh=(b=bundle)=>O.refreshCurrentRelease(b,{get,now,readArtifact:()=>badRollback?Buffer.from('incorrect'):f.rollbackBytes,
    fetchImpl:async()=>new Response(badBytes?'incorrect':body)});
  const db=memory(f.target,at);
  db.rows.set(A.POLICY,{value:initial,updateTime:initial.updatedAt});
  const credential={target:f.target,operator:{principalSubject:'mock-owner',credentialSubject:'mock-credential',delegationSubject:null},
    permissions:A.WRITE,expiresAt:at+3600000,source:'verified-provider'};
  const controller=A.createController({db,identity:f.target,now:()=>clock,authenticate:async()=>clone(credential),releaseEvidence:()=>refresh(),
    writeAudit:(tx,input)=>{const ref=db.collection('auditEvents').doc();tx.set(ref,audit.buildAuditEventWrite(input).write);return {eventId:ref.id};}});
  return {bundle,db,controller,refresh,options:{reason:'Modeled staging recovery',approvalRef:bundle.approvalRef},
    advance:ms=>{clock+=ms;},bytes:v=>{badBytes=v;},routing:v=>{badRouting=v;},rollback:v=>{badRollback=v;},
    provider:fn=>{providerOverride=fn;},close:async(commit=true)=>{
      bundle.closePlan=await controller.review('close',{reason:'Modeled rehearsal',approvalRef:'modeled-separate-close'});
      if(commit) {
        assert.equal((await controller.execute(bundle.closePlan,bundle.closePlan.confirm)).shutdownConfirmed,true);
        bundle.policyGeneration=db.rows.get(A.POLICY).value.generation;
      }
    }};
}

test('staging re-enable refreshes the real Hosting-only receipt and requires the exact committed close',async t=>{
  const h=await recovery(t);
  await h.close(false);
  await assert.rejects(h.controller.preEnable(h.options),/prepared closed policy/);
  await h.close();
  const saved=h.bundle.closePlan;
  h.bundle.closePlan=null;
  await assert.rejects(h.controller.preEnable(h.options));
  h.bundle.closePlan=saved;
  const key=`${A.HISTORY}/${saved.transitionId}`, history=h.db.rows.get(key);
  h.db.rows.delete(key);
  await assert.rejects(h.controller.preEnable(h.options),/committed-current closure/);
  h.db.rows.set(key,history);
  await assert.rejects(h.controller.preEnable({...h.options,approvalRef:saved.next.approvalRef}),/separate owner decision/);
  await assert.rejects(h.controller.preEnable({...h.options,approvalRef:undefined}),/approval/);
  const plan=await h.controller.review('enable',h.options);
  h.advance(1000); // A refreshed observation clock must not invalidate stable evidence.
  assert.equal((await h.controller.execute(plan,plan.confirm)).status,'committed-current');
  await h.close();
  h.bundle.closePlan=saved; // An earlier successful close cannot authorize a new generation.
  await assert.rejects(h.controller.preEnable(h.options),/committed-current closure/);
  assert.equal((await h.controller.execute(plan,plan.confirm)).status,'committed-superseded');
  assert.equal(h.db.rows.get(A.POLICY).value.mode,'closed');
});

test('recovery refuses synthetic, cross-project, stale, altered Hosting, backend, and rollback evidence',async t=>{
  const h=await recovery(t);
  await h.close();
  const policy=h.db.rows.get(A.POLICY).value;
  assert.throws(()=>O.validateCurrentRelease(h.bundle,{target:A.target(S9.PROJECT),policy}),/fresh provider refresh/);
  await assert.rejects(h.refresh({...h.bundle,provenance:'synthetic'}),/real scoped/);
  await assert.rejects(h.refresh({...h.bundle,projectId:'lyfelabz-prod'}),/certified staging/);
  const refreshed=await h.refresh();
  assert.throws(()=>O.validateCurrentRelease(refreshed,{target:A.target('lyfelabz-prod'),policy}),/staging dual lineage/);
  for(const [set,pattern] of [[h.bytes,/served pair/],[h.routing,/routing changed/],[h.rollback,/rollback archive changed/]]) {
    set(true);
    await assert.rejects(h.controller.preEnable(h.options),pattern);
    set(false);
  }
  h.provider((url,raw)=>url.includes('cloudfunctions.googleapis.com/v2/projects/') && raw.serviceConfig
    ? {...raw,serviceConfig:{...raw.serviceConfig,service:raw.serviceConfig.service.replace('/us-central1/','/us-east1/')}}:raw);
  await assert.rejects(h.controller.preEnable(h.options),/resource|region/);
  h.provider((url,raw)=>url.includes('/indexes') ? {...raw,indexes:raw.indexes.slice(1)} : raw);
  await assert.rejects(h.controller.preEnable(h.options),/retained backend provider pin/);
  h.provider((url,raw)=>url.includes('/indexes') ? {...raw,indexes:raw.indexes.map(i=>({...i,state:'CREATING'}))} : raw);
  await assert.rejects(h.controller.preEnable(h.options),/index not READY/);
  h.provider(undefined);
  h.bundle.policyGeneration=policy.generation-1;
  await assert.rejects(h.controller.preEnable(h.options),/policy\/CAS/);
  h.bundle.policyGeneration=policy.generation;
  h.advance(86400001);
  await assert.rejects(h.refresh(),/stale evidence/);
});
