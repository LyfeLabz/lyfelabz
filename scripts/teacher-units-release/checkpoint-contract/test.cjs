'use strict';
// Historical responses are immutable negative fixtures. Every accepting control
// below is SYNTHETIC, tests only a subcheck, and grants no checkpoint authority.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
assert.equal(process.env.B6B4C_ISOLATED,'1','use checkpoint-contract/run-tests.cjs');
const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/manifest.json')));
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
for(const [file,digest] of Object.entries(manifest.canonicalReadDependencies))
  assert.equal(hash(fs.readFileSync(path.join(manifest.canonicalPacket,file))),digest,`canonical dependency changed: ${file}`);
const C=require(path.join(manifest.canonicalPacket,'tools/checkpoint.cjs'));
const O=require('../option-b-observation.cjs');
const K=require('../../../platform/functions/lib/teacherUnits/a3-canonical.js');
const read=n=>JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures',n+'.json')));
const observed={fn:read('function'),service:read('service'),revision:read('revision'),build:read('build'),image:read('image')};
const NOW='2026-10-27T00:21:00.000Z',project='lyfelabz-staging',id='optionBDeploymentProbe';
const archive={build:{backendBuildId:'a'.repeat(64)}}; // Synthetic metadata-subcheck argument; no archive certification.
const normalize=f=>O.normalizeEndpoint({projectId:project,id,at:NOW,archive,...f});
function syntheticEndpoint() {
  const serviceName=`projects/${project}/locations/us-central1/services/optionbdeploymentprobe`,revisionId='optionbdeploymentprobe-00001-synthetic';
  const source={bucket:`gcf-v2-sources-${C.N}-us-central1`,object:'optionBDeploymentProbe/synthetic.zip',generation:'123'};
  const account=`projects/${project}/serviceAccounts/${C.N}-compute@developer.gserviceaccount.com`;
  const image=`us-central1-docker.pkg.dev/${project}/gcf-artifacts/synthetic-probe@sha256:`+'a'.repeat(64);
  const template={executionEnvironment:'EXECUTION_ENVIRONMENT_GEN2',serviceAccount:C.SA,timeout:'60s',maxInstanceRequestConcurrency:80,scaling:{maxInstanceCount:20},containers:[{image,env:[{name:'FUNCTION_TARGET',value:id}],resources:{limits:{cpu:'1',memory:'512Mi'}}}]};
  const fn={name:C.FN,environment:'GEN_2',state:'ACTIVE',updateTime:NOW,buildConfig:{runtime:'nodejs22',entryPoint:id,build:`projects/${C.N}/locations/us-central1/builds/synthetic-build`,dockerRegistry:'ARTIFACT_REGISTRY',dockerRepository:`projects/${project}/locations/us-central1/repositories/gcf-artifacts`,serviceAccount:account,source:{storageSource:structuredClone(source)},sourceProvenance:{resolvedStorageSource:structuredClone(source)},automaticUpdatePolicy:{}},serviceConfig:{service:serviceName,revision:revisionId,allTrafficOnLatestRevision:true,serviceAccountEmail:C.SA,availableMemory:'512Mi',availableCpu:'1',timeoutSeconds:60,maxInstanceRequestConcurrency:80,maxInstanceCount:20,ingressSettings:'ALLOW_ALL'}};
  const service={name:serviceName,generation:'1',observedGeneration:'1',ingress:'INGRESS_TRAFFIC_ALL',latestReadyRevision:`${serviceName}/revisions/${revisionId}`,latestCreatedRevision:`${serviceName}/revisions/${revisionId}`,terminalCondition:{type:'Ready',state:'CONDITION_SUCCEEDED'},template:structuredClone(template),traffic:[{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',percent:100}],trafficStatuses:[{type:'TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST',revision:revisionId,percent:100}]};
  const revision={...structuredClone(template),name:service.latestReadyRevision,service:serviceName,conditions:[{type:'Ready',state:'CONDITION_SUCCEEDED'}]};
  return {fn,service,revision};
}
function syntheticPacket() {
  const f=syntheticEndpoint(),source=f.fn.buildConfig.sourceProvenance.resolvedStorageSource,image=f.revision.containers[0].image;
  const hashes=JSON.parse(fs.readFileSync(path.join(manifest.canonicalPacket,'evidence/remediation-before.json'))).packetHashes;
  const sourceFileHashes=Object.fromEntries(['index.js','scope.cjs','probe-revision.json','package.json','package-lock.json'].map(n=>[n,hashes['functions/'+n]]));
  // These true booleans are test inputs, never an independent-review assertion.
  const q={reviewer:'SYNTHETIC-NO-HUMAN-REVIEW',reviewedAt:NOW,checkpoint:'SYNTHETIC-NOT-PROVIDER-QUALIFIED',sourceReviewed:true,buildQualified:true,imageLinked:true,refusalVerified:true,independentReview:true,sourceVariant:'baseline-a',sourceArchiveSha256:'f'.repeat(64),sourceFileHashes,buildServiceAccount:f.fn.buildConfig.serviceAccount,approvedSourceBuckets:[source.bucket],image,build:f.fn.buildConfig.build,source};
  const proof={kind:'b6b2-reviewed-checkpoint-v1',function:structuredClone(f.fn),snapshots:{function:C.objectHash(f.fn),service:C.objectHash(f.service),revision:C.objectHash(f.revision)},qualification:q,sourceArchiveSha256:q.sourceArchiveSha256,sourceMetadata:{bucket:source.bucket,name:source.object,generation:source.generation},build:{name:q.build,id:'synthetic-build',status:'SUCCESS',serviceAccount:q.buildServiceAccount,startTime:NOW,finishTime:NOW,sourceProvenance:{resolvedStorageSource:structuredClone(source)},results:{images:[{name:image.split('@')[0],digest:image.split('@')[1]}]}},image:{uri:image,name:`projects/${project}/locations/us-central1/repositories/gcf-artifacts/dockerImages/${image.split('@')[1]}`}};
  return {...f,proof};
}
const validate=f=>C.validateProvenance(f.proof,f.fn,f.service,f.revision);
test('retained A0 fixture bytes match original HTTP-200 body hashes',()=>{
  for(const f of manifest.fixtures) {assert.equal(f.status,200);assert.equal(hash(fs.readFileSync(path.join(__dirname,'fixtures',f.file))),f.sha256);}
});
test('retained A0 remains rejected at its actual first observer condition',()=>{
  const before=JSON.stringify(observed);
  assert.throws(()=>normalize(observed),/^Error: \[option-b-observation\] REFUSED: revision spec: unresolved execution context$/);
  assert.equal(JSON.stringify(observed),before);
  assert.equal(observed.fn.environment,'GEN_2');
  assert.equal(observed.revision.executionEnvironment,undefined);
  assert.equal(observed.service.template.executionEnvironment,undefined);
});
test('synthetic metadata control reaches the observer subcheck without modifying it',()=>{
  const f=syntheticEndpoint(),before=JSON.stringify(f);assert.equal(normalize(f).endpointName,id);assert.equal(JSON.stringify(f),before);
});
test('synthetic legacy packet control isolates provenance assertions; not provider approval',()=>{
  const f=syntheticPacket();assert.equal(validate(f),f.revision.containers[0].image);
});
test('missing Build resolved source rejects even with synthetic qualification flags',()=>{
  const f=syntheticPacket();f.proof.build.sourceProvenance=structuredClone(observed.build.sourceProvenance);
  assert.deepEqual(f.proof.build.sourceProvenance,{});
  assert.throws(()=>validate(f),/source bucket mismatch/);
});
test('missing Build results.images rejects; builder-step digests do not substitute',()=>{
  const f=syntheticPacket();f.proof.build.results=structuredClone(observed.build.results);
  assert.equal(f.proof.build.results.images,undefined);assert.ok(f.proof.build.results.buildStepImages.length);
  assert.throws(()=>validate(f),/build output does not identify selected image/);
});
test('absent Build sourceProvenance rejects rather than accepting the Function copy alone',()=>{
  const f=syntheticPacket();delete f.proof.build.sourceProvenance;assert.throws(()=>validate(f),/source bucket mismatch/);
});
test('retained registry URI matches revision; legacy URI grammar rejects observed repeated separators',()=>{
  assert.equal(observed.image.uri,observed.revision.containers[0].image);
  assert.throws(()=>C.digestImage(observed.image.uri),{code:'ERR_ASSERTION',operator:'match'});
  const image=observed.image.uri;
  assert.notEqual(observed.image.name,`projects/${project}/locations/us-central1/repositories/gcf-artifacts/dockerImages/${image.split('@')[1]}`);
});
test('legacy name condition independently rejects package@digest under otherwise valid synthetic scaffolding',()=>{
  const f=syntheticPacket(),image=f.revision.containers[0].image;
  f.proof.image.name=`projects/${project}/locations/us-central1/repositories/gcf-artifacts/dockerImages/${image.split('/gcf-artifacts/')[1]}`;
  assert.throws(()=>validate(f),{code:'ERR_ASSERTION',operator:'strictEqual'});
});
for(const [label,change,pattern] of [
  ['incorrect registry resource identity',f=>f.proof.image.name+='-wrong',/Expected values to be strictly equal/],
  ['registry URI digest differs',f=>f.proof.image.uri=f.proof.image.uri.replace('a'.repeat(64),'b'.repeat(64)),/Expected values to be strictly equal/],
  ['missing registry evidence',f=>delete f.proof.image,/Expected values to be strictly equal/],
  ['missing Build evidence',f=>delete f.proof.build,/The "string" argument must be of type string/],
  ['missing checkpoint evidence',f=>f.proof=undefined,/independent checkpoint evidence required/],
  ['Build identity disagreement',f=>f.proof.build.name+='-other',/Expected values to be strictly equal/],
  ['source generation disagreement',f=>f.proof.sourceMetadata.generation='999',/source generation mismatch/],
  ['snapshot inconsistency',f=>f.proof.snapshots.service='b'.repeat(64),/checkpoint service snapshot mismatch/],
]) test('legacy packet rejects '+label,()=>{const f=syntheticPacket();change(f);assert.throws(()=>validate(f),pattern);});
for(const [label,change,pattern] of [
  ['missing revision execution environment',f=>delete f.revision.executionEnvironment,/revision spec: unresolved execution context/],
  ['missing desired execution environment',f=>delete f.service.template.executionEnvironment,/service template: unresolved execution context/],
  ['GEN1 revision execution environment',f=>f.revision.executionEnvironment='EXECUTION_ENVIRONMENT_GEN1',/revision spec: unresolved execution context/],
  ['unspecified revision environment',f=>f.revision.executionEnvironment='EXECUTION_ENVIRONMENT_UNSPECIFIED',/revision spec: unresolved execution context/],
  ['unknown revision environment',f=>f.revision.executionEnvironment='EXECUTION_ENVIRONMENT_GEN3',/revision spec: unresolved execution context/],
  ['tagged desired image',f=>f.service.template.containers[0].image=f.service.template.containers[0].image.split('@')[0]+':version_1',/wrong-project\/unpinned image/],
  ['tagged revision image',f=>f.revision.containers[0].image=f.revision.containers[0].image.split('@')[0]+':version_1',/wrong-project\/unpinned image/],
  ['missing revision image digest',f=>f.revision.containers[0].image=f.revision.containers[0].image.split('@')[0],/wrong-project\/unpinned image/],
  ['missing desired image',f=>delete f.service.template.containers[0].image,/wrong-project\/unpinned image/],
  ['malformed digest',f=>f.revision.containers[0].image+='0',/wrong-project\/unpinned image/],
  ['cross-project execution image',f=>f.revision.containers[0].image=f.revision.containers[0].image.replace(project,'lyfelabz-prod'),/wrong-project\/unpinned image/],
  ['desired and running digest disagreement',f=>f.service.template.containers[0].image=f.service.template.containers[0].image.replace('a'.repeat(64),'b'.repeat(64)),/desired\/serving spec: mismatch/],
  ['revision identity disagreement',f=>f.revision.name+='-other',/revision mismatch/],
  ['unexpected Function serving revision',f=>f.fn.serviceConfig.revision+='-other',/Cloud Run identity\/readiness\/ingress mismatch/],
  ['latest-created and latest-ready mismatch',f=>f.service.latestCreatedRevision+='-other',/Cloud Run identity\/readiness\/ingress mismatch/],
  ['missing latest-ready revision',f=>delete f.service.latestReadyRevision,/Cloud Run identity\/readiness\/ingress mismatch/],
  ['traffic split',f=>f.service.traffic.push({type:'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION',percent:1,revision:'other'}),/traffic split\/tagged route/],
  ['traffic percent differs',f=>f.service.trafficStatuses[0].percent=99,/unknown serving route/],
  ['tagged serving route',f=>f.service.trafficStatuses[0].tag='unexpected',/unknown serving route/],
  ['wrong traffic revision',f=>f.service.trafficStatuses[0].revision+='-other',/traffic status revision mismatch/],
  ['unknown traffic allocation',f=>f.service.traffic[0].type='TRAFFIC_TARGET_ALLOCATION_TYPE_UNSPECIFIED',/unknown serving route/],
  ['missing traffic status',f=>delete f.service.trafficStatuses,/traffic split\/tagged route/],
  ['missing Function evidence',f=>delete f.fn,/function: plain record required/],
  ['missing service evidence',f=>delete f.service,/Cloud Run service: plain record required/],
  ['missing revision evidence',f=>delete f.revision,/Cloud Run revision: plain record required/],
  ['missing Function source provenance',f=>delete f.fn.buildConfig.sourceProvenance,/source provenance: plain record required/],
  ['unknown provider field',f=>f.service.unreviewedCodeLoader=true,/Cloud Run service: unknown or missing fields/],
  ['reconciling service',f=>f.service.reconciling=true,/Cloud Run identity\/readiness\/ingress mismatch/],
  ['inconsistent observed generation',f=>f.service.observedGeneration='2',/Cloud Run identity\/readiness\/ingress mismatch/],
  ['contradictory readiness',f=>f.revision.conditions.push({type:'Ready',state:'CONDITION_FAILED'}),/revision condition: not ready/],
  ['duplicate successful readiness',f=>f.revision.conditions.push({...f.revision.conditions[0]}),/duplicate readiness condition/],
  ['wrong revision build source',f=>f.revision.containers[0].buildInfo={functionTarget:id,sourceLocation:'gs://other/source#999'},/container build provenance differs from function/],
  ['wrong expected Function identity',f=>f.fn.name+='Other',/function identity\/state\/runtime mismatch/],
  ['cross-project Build resource',f=>f.fn.buildConfig.build=f.fn.buildConfig.build.replace(C.N,'123'),/wrong-project or malformed resource identity/],
  ['cross-region service',f=>f.fn.serviceConfig.service=f.fn.serviceConfig.service.replace('us-central1','us-east1'),/resource/],
  ['tagged build destination disagrees with pinned desired image',f=>f.service.buildConfig={functionTarget:id,imageUri:f.service.template.containers[0].image.split('@')[0]+':version_1'},/Run build image differs from desired image/],
]) test('unchanged observer rejects '+label,()=>{const f=syntheticEndpoint();normalize(f);change(f);assert.throws(()=>normalize(f),pattern);});
test('rejected synthetic input is not normalized or mutated into acceptance',()=>{
  const f=syntheticEndpoint();delete f.revision.executionEnvironment;const before=JSON.stringify(f);
  assert.throws(()=>normalize(f),/unresolved execution context/);assert.equal(JSON.stringify(f),before);
});
test('top-level observer propagates inaccessible provider evidence without fallback',async()=>{
  let calls=0;const unavailable=new Error('SYNTHETIC HTTP 403 - no provider call');
  const plan={kind:O.CONFIGURATION_KIND,schemaVersion:1,projectId:project,backendBuildId:'a'.repeat(64),configDigest:'b'.repeat(64),automaticUpdatesAccepted:true,principalSubject:'SYNTHETIC',decisionRef:'SYNTHETIC',reviewedAt:NOW};
  await assert.rejects(()=>O.inspectOptionB({project,now:()=>NOW,plan,get:async()=>{calls++;throw unavailable;}}),e=>e===unavailable);
  assert.equal(calls,1);
});
test('top-level observer rejects ambiguous duplicate endpoint inventory before archive retrieval',async()=>{
  const plan={kind:O.CONFIGURATION_KIND,schemaVersion:1,projectId:project,backendBuildId:'a'.repeat(64),configDigest:'b'.repeat(64),automaticUpdatesAccepted:true,principalSubject:'SYNTHETIC',decisionRef:'SYNTHETIC',reviewedAt:NOW};
  const ids=[O.ENDPOINTS[0],...O.ENDPOINTS.slice(0,-1)];let reads=0;
  await assert.rejects(()=>O.inspectOptionB({project,now:()=>NOW,plan,get:async()=>{
    reads++;if(reads===1)return {projectId:project,projectNumber:C.N,state:'ACTIVE',name:`projects/${project}`};
    if(reads===2)return {name:`projects/${project}/databases/(default)`,type:'FIRESTORE_NATIVE'};
    assert.equal(reads,3);return {functions:ids.map(id=>({name:`projects/${project}/locations/us-central1/functions/${id}`,environment:'GEN_2',state:'ACTIVE'}))};
  }}),/missing\/duplicate\/wrong-region endpoint/);assert.equal(reads,3);
});
test('strict JSON parser rejects duplicate keys before any normalized observation',()=>assert.throws(()=>K.parseStrictJSON('{"name":"one","name":"two"}')));
// Corrected package@digest matrix is implemented below against the disposable copy.
test.todo('UNRESOLVED: independently reviewed replacement source-consumption and Build-output proof; genuine A0 must remain unqualified');
test.todo('PROPOSED: raw transport envelope completeness/status/duplicate-key rejection at the checkpoint ingestion boundary');
test.todo('STAGING ONLY: explicit GEN2/digest pin readback, buildConfig persistence, Firebase redeployment and restoration');

// B6b-4D: mapping-only controls against the authorized disposable validator.
// Synthetic provenance scaffolding isolates this subcheck and never qualifies A0.
const D=require('/private/tmp/lyfelabz-b6b4d-registry-20261027/tools/checkpoint.cjs');
function correctedPacket(image=observed.image.uri) {
  const f=syntheticPacket();
  f.revision.containers[0].image=image;
  f.service.template.containers[0].image=image;
  f.proof.snapshots.service=D.objectHash(f.service);
  f.proof.snapshots.revision=D.objectHash(f.revision);
  f.proof.qualification.image=image;
  f.proof.image={...structuredClone(observed.image),uri:image,name:`projects/${project}/locations/us-central1/repositories/gcf-artifacts/dockerImages/${image.split('/gcf-artifacts/')[1]}`};
  f.proof.build.results.images=[{name:image.split('@')[0],digest:image.split('@')[1]}];
  return f;
}
const correctedValidate=f=>D.validateProvenance(f.proof,f.fn,f.service,f.revision);
test('corrected mapping accepts exact provider package and digest under synthetic subcheck scaffolding',()=>{
  assert.equal(D.digestImage(observed.image.uri),observed.image.uri);
  assert.equal(correctedValidate(correctedPacket()),observed.image.uri);
});
const packageImage=packageName=>`us-central1-docker.pkg.dev/${project}/gcf-artifacts/${packageName}@${observed.image.uri.split('@')[1]}`;
for(const packageName of ['ordinary','ordinary-package','ordinary_package','ordinary.package','a1-b2_c3.d4','nested/ordinary-package','nested.path/ordinary_package/leaf'])
  test('original package grammar still accepts '+packageName,()=>{
    const image=packageImage(packageName);
    assert.equal(C.digestImage(image),image);
    assert.equal(D.digestImage(image),image);
    assert.equal(correctedValidate(correctedPacket(image)),image);
  });
const approvedPackage='lyfelabz--staging__us--central1__option_b_deployment_probe';
for(const packageName of [
  'unrelated--package','unrelated__package','nested/unrelated---package',
  'unrelated___package','unrelated..package','unrelated._package','unrelated-_package',
  'nested--path/ordinary','nested__path/ordinary',
  'prefix'+approvedPackage,approvedPackage+'suffix',
  'prefix-'+approvedPackage,approvedPackage+'-suffix',
  'nested/'+approvedPackage,approvedPackage+'/leaf',
  approvedPackage.replace('lyfelabz','Lyfelabz'),approvedPackage.replace('__','%5F%5F'),
  './'+approvedPackage,approvedPackage+'/',approvedPackage+' ',
]) test('exact exception rejects consistently substituted unauthorized package '+packageName,()=>{
  const image=packageImage(packageName),f=correctedPacket(image);
  assert.equal(f.service.template.containers[0].image,image);
  assert.equal(f.revision.containers[0].image,image);
  assert.equal(f.proof.image.uri,image);
  assert.equal(f.proof.qualification.image,image);
  assert.equal(f.proof.image.name.split('/dockerImages/')[1],image.split('/gcf-artifacts/')[1]);
  assert.equal(f.proof.build.results.images[0].name,image.split('@')[0]);
  assert.equal(f.proof.snapshots.service,D.objectHash(f.service));
  assert.equal(f.proof.snapshots.revision,D.objectHash(f.revision));
  assert.throws(()=>D.digestImage(image),{code:'ERR_ASSERTION',operator:'match'});
  assert.throws(()=>correctedValidate(f),{code:'ERR_ASSERTION',operator:'match'});
});
for(const [label,change] of [
  ['wrong project',f=>f.proof.image.name=f.proof.image.name.replace(project,'lyfelabz-prod')],
  ['wrong location',f=>f.proof.image.name=f.proof.image.name.replace('us-central1','us-east1')],
  ['wrong repository',f=>f.proof.image.name=f.proof.image.name.replace('gcf-artifacts','other')],
  ['wrong package',f=>f.proof.image.name=f.proof.image.name.replace('option_b_deployment_probe','other')],
  ['wrong digest',f=>f.proof.image.name=f.proof.image.name.replace(/sha256:.+$/,'sha256:'+'b'.repeat(64))],
  ['malformed resource name',f=>f.proof.image.name=f.proof.image.name.replace('/dockerImages/','/packages/')],
  ['invalid digest encoding',f=>f.proof.image.name=f.proof.image.name.replace('sha256:','sha256%3A')],
  ['digest-only legacy resource',f=>f.proof.image.name=f.proof.image.name.replace(/dockerImages\/.*@/,'dockerImages/')],
  ['missing registry evidence',f=>delete f.proof.image],
  ['ambiguous registry evidence',f=>f.proof.image=[f.proof.image,f.proof.image]],
  ['registry URI and revision disagreement',f=>f.proof.image.uri=f.proof.image.uri.replace(/sha256:.+$/,'sha256:'+'b'.repeat(64))],
]) test('corrected mapping rejects '+label,()=>{const f=correctedPacket();change(f);assert.throws(()=>correctedValidate(f));});
for(const [label,image] of [
  ['wrong URI project',observed.image.uri.replace(project,'lyfelabz-prod')],
  ['wrong URI location',observed.image.uri.replace('us-central1','us-east1')],
  ['wrong URI repository',observed.image.uri.replace('gcf-artifacts','other')],
  ['encoded digest',observed.image.uri.replace('sha256:','sha256%3A')],
  ['uppercase digest',observed.image.uri.replace(/sha256:.+$/,'sha256:'+'A'.repeat(64))],
  ['short digest',observed.image.uri.slice(0,-1)],
  ['mutable tag',observed.image.uri.split('@')[0]+':version_1'],
  ['tag plus digest',observed.image.uri.replace('@sha256:',':version_1@sha256:')],
  ['empty package segment',observed.image.uri.replace('/gcf-artifacts/','/gcf-artifacts//')],
  ['triple underscore',observed.image.uri.replace('__','___')],
  ['trailing newline',observed.image.uri+'\n'],
]) test('corrected digestImage rejects '+label,()=>assert.throws(()=>D.digestImage(image)));
for(const [label,change,pattern] of [
  ['historical missing Build source',f=>f.proof.build.sourceProvenance=structuredClone(observed.build.sourceProvenance),/source bucket mismatch/],
  ['historical missing Build output',f=>f.proof.build.results=structuredClone(observed.build.results),/build output does not identify selected image/],
]) test('corrected mapping preserves '+label+' rejection',()=>{const f=correctedPacket();change(f);assert.throws(()=>correctedValidate(f),pattern);});
