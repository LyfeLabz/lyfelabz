'use strict';
// Injected read-only provider observations. Application/configuration consistency
// is not deployment authority, owner approval, or proof of effective IAM.
const { execFileSync } = require('node:child_process');
const { PROJECT_NUMBERS, MAX_AGE_MS, MAX_PREPARE_AGE_MS, canonical, fingerprint, list,
  normalizeRemoteIndexes, archiveRuntime, resource } = require('../hosting-release/backend-state.cjs');
const { environmentForProject, readTargetSites } = require('../hosting-release/contract.cjs');
const K = require('../../platform/functions/lib/teacherUnits/a3-canonical.js');
const B = require('../../platform/functions/lib/teacherUnits/availability-runtime-build.js');
const P = require('../../platform/functions/lib/teacherUnits/availability-policy.js');
const RULES = require('./option-b-rules-evidence.cjs');
const OBSERVATION_KIND = 'lyfelabz.teacherUnitsOptionBObservation';
const CURRENT_RELEASE_KIND = 'lyfelabz.teacherUnitsOptionBCurrentReleaseEvidence';
const CONFIGURATION_KIND = 'lyfelabz.teacherUnitsOptionBConfigurationApproval';
const ENDPOINTS = Object.freeze(['teacherUnitsArchive','teacherUnitsCapabilities','teacherUnitsCreate','teacherUnitsGet','teacherUnitsList','teacherUnitsReorder','teacherUnitsRestore','teacherUnitsSetResources','teacherUnitsUpdate']);
const BUILD_PATH = 'lib/teacherUnits/a3-runtime-build.json';
function refuse(message) { throw new Error(`[option-b-observation] REFUSED: ${message}`); }
function data(value) { try { return K.parseStrictJSON(K.canonicalJSON(value)); } catch { return refuse('plain canonical data required'); } }
function record(v, fields, label, exact = false) {
  if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype,null].includes(Object.getPrototypeOf(v))) refuse(`${label}: plain record required`);
  if (Object.keys(v).some(k => !fields.includes(k)) || (exact && Object.keys(v).length !== fields.length)) refuse(`${label}: unknown or missing fields`);
  return v;
}
function text(v, label) { if (typeof v !== 'string' || !v.trim() || v !== v.trim() || v.length > 2048 || /[\x00-\x1f\x7f]/.test(v)) refuse(`${label}: bounded text required`); return v; }
function digest(v, label) { if (!/^[a-f0-9]{64}$/.test(v || '')) refuse(`${label}: digest required`); }
function time(v, label) { if (typeof v !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3}(?:\d{3})?(?:\d{3})?)?Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(Date.parse(v)).toISOString().slice(0,19)!==v.slice(0,19)) refuse(`${label}: valid calendar UTC timestamp required`); return Date.parse(v); }
function metadataTimes(value, at, label) { for (const key of ['createTime','updateTime','lastTransitionTime']) if (value[key]!==undefined && time(value[key],`${label} ${key}`)>time(at,'observation clock')) refuse(`${label}: future provider metadata`); }
function fresh(v, now, max = MAX_AGE_MS) { const t = time(v,'evidence'), n = time(now,'now'); if (t > n || n-t > max) refuse('future or stale evidence'); }
function equal(a,b,label) { if (canonical(a) !== canonical(b)) refuse(`${label}: mismatch`); }
function project(projectId) { if (!Object.hasOwn(PROJECT_NUMBERS,projectId)) refuse('explicit supported project required'); return environmentForProject(projectId); }
function stringMap(v,label) { if (v === undefined) return; if (!v || typeof v !== 'object' || Array.isArray(v) || Object.values(v).some(x => typeof x !== 'string')) refuse(`${label}: string map required`); }
function configApproval(raw, projectId, at, buildId, configDigest) {
  const p = record(data(raw), ['kind','schemaVersion','projectId','backendBuildId','configDigest','automaticUpdatesAccepted','principalSubject','decisionRef','reviewedAt'],'configuration approval',true);
  if (p.kind !== CONFIGURATION_KIND || p.schemaVersion !== 1 || p.projectId !== projectId || p.automaticUpdatesAccepted !== true) refuse('explicit configuration approval required');
  digest(p.backendBuildId,'approved build'); digest(p.configDigest,'approved configuration'); text(p.principalSubject,'configuration reviewer'); text(p.decisionRef,'configuration decision');
  if (time(p.reviewedAt,'configuration review') > time(at,'now')) refuse('future configuration approval');
  if (buildId !== undefined && (p.backendBuildId !== buildId || p.configDigest !== configDigest)) refuse('configuration/build differs from independently approved plan');
  return p;
}
function unpackOptionB(bytes) {
  let buildBytes;
  const result = archiveRuntime(bytes, (command,args,options) => {
    const output = execFileSync(command,args,options);
    if (command === 'unzip' && args[0] === '-p' && args[2] === BUILD_PATH) buildBytes = Buffer.from(output);
    return output;
  });
  if (!buildBytes) refuse('actual Option B build record bytes missing from archive');
  return { ...result, buildRecordBytes:buildBytes };
}
function artifact(raw, mode = 'policy-controlled') {
  if (!raw || (!Buffer.isBuffer(raw.buildRecordBytes) && typeof raw.buildRecordBytes !== 'string')) refuse('actual archive build record bytes required');
  let parsed; try { parsed = B.validateAvailabilityRuntimeBuild(K.parseStrictJSON(raw.buildRecordBytes.toString('utf8'))); } catch { refuse('malformed archive build record'); }
  if (!parsed.ok || parsed.value.deploymentMode !== mode || parsed.value.sourceDirty !== false) refuse(`clean ${mode} schema 2/v3 build required`);
  const files = data(raw.runtimeFiles); for (const hash of Object.values(files)) digest(hash,'runtime file');
  if (!files['lib/index.js'] || !files['package.json'] || !files['package-lock.json'] || !files['lib/teacherUnits/unit-placeable-resources.json'] || files[BUILD_PATH] !== K.sha256Bytes(raw.buildRecordBytes)) refuse('incomplete runtime file inventory or unbound build bytes');
  const payload = {...files}; delete payload[BUILD_PATH];
  if (K.contentDigest(payload) !== parsed.value.runtimePayloadFingerprint || raw.placementFingerprint !== parsed.value.placementFingerprint || fingerprint(files) !== raw.artifactFingerprint) refuse('archive application content/build mismatch');
  digest(raw.archiveHash,'archive bytes');
  return { build:parsed.value, runtimeFiles:files, runtimePayloadFingerprint:parsed.value.runtimePayloadFingerprint,
    functionsArtifactFingerprint:raw.artifactFingerprint, placementFingerprint:raw.placementFingerprint, archiveHash:raw.archiveHash };
}
// Narrow reviewed profile. Unknown fields, extra containers, tagged traffic and
// unreviewed code-loading settings refuse instead of being normalized away.
const FN = ['name','environment','state','updateTime','createTime','description','url','labels','buildConfig','serviceConfig','stateMessages','satisfiesPzi','satisfiesPzs'];
const BUILD = ['runtime','entryPoint','build','dockerRegistry','dockerRepository','serviceAccount','source','sourceProvenance','automaticUpdatePolicy','onDeployUpdatePolicy','environmentVariables'];
const SC = ['service','revision','allTrafficOnLatestRevision','serviceAccountEmail','availableMemory','availableCpu','timeoutSeconds','maxInstanceRequestConcurrency','maxInstanceCount','minInstanceCount','ingressSettings','uri','environmentVariables'];
const SERVICE = ['name','generation','observedGeneration','ingress','launchStage','latestReadyRevision','latestCreatedRevision','terminalCondition','conditions','traffic','trafficStatuses','uri','template','buildConfig','labels','annotations','createTime','updateTime','creator','lastModifier','etag','uid','reconciling','invokerIamDisabled','defaultUriDisabled','iapEnabled','customAudiences','urls','client','clientVersion','satisfiesPzs','scaling','sshEnabled'];
const SPEC = ['serviceAccount','timeout','maxInstanceRequestConcurrency','executionEnvironment','scaling','containers','labels','annotations','sessionAffinity','revision','client'];
const REVISION = ['name','service','generation','observedGeneration','conditions','createTime','updateTime','launchStage','etag','uid','creator','reconciling','logUri',...SPEC];
const CONTAINER = ['name','image','baseImageUri','env','resources','ports','command','args','workingDir','startupProbe','livenessProbe','buildInfo'];
function condition(v,label,at,types=['Ready']) { record(v,['type','state','lastTransitionTime','message','reason','severity'],label); if (at) metadataTimes(v,at,label); if (!types.includes(v.type) || v.state !== 'CONDITION_SUCCEEDED') refuse(`${label}: not ready`); }
function conditions(values,label,at,types,readyRequired=false) {
  if (!Array.isArray(values) || !values.length) refuse(`${label}: readiness required`);
  const seen=new Set();
  for(const v of values) {condition(v,label,at,types);if(seen.has(v.type)) refuse('duplicate readiness condition');seen.add(v.type);}
  if (readyRequired && !seen.has('Ready')) refuse('Ready condition required');
}
function spec(v,label,projectId,expectedBuild) {
  const x = record(v,SPEC,label); stringMap(x.labels,`${label} labels`); stringMap(x.annotations,`${label} annotations`); if (x.sessionAffinity!==undefined && typeof x.sessionAffinity!=='boolean') refuse('unknown session affinity');
  if (x.client!==undefined) text(x.client,'template client');
  if (x.executionEnvironment !== 'EXECUTION_ENVIRONMENT_GEN2' || typeof x.serviceAccount !== 'string' || !/^[A-Za-z0-9_.-]+@[a-z0-9.-]+\.gserviceaccount\.com$/.test(x.serviceAccount) || !/^\d+(?:\.\d{1,9})?s$/.test(x.timeout || '') || !Number.isSafeInteger(x.maxInstanceRequestConcurrency) || x.maxInstanceRequestConcurrency < 1) refuse(`${label}: unresolved execution context`);
  if (x.scaling !== undefined) { record(x.scaling,['minInstanceCount','maxInstanceCount'],`${label} scaling`); for (const n of Object.values(x.scaling)) if (!Number.isSafeInteger(n) || n < 0) refuse('invalid scaling'); }
  if (!Array.isArray(x.containers) || x.containers.length !== 1) refuse('one application container required');
  const c = record(x.containers[0],CONTAINER,`${label} container`);
  if (!/^us-central1-docker\.pkg\.dev\/[a-z0-9-]+\/[^@\s]+@sha256:[a-f0-9]{64}$/.test(c.image || '') || !c.image.startsWith(`us-central1-docker.pkg.dev/${projectId}/`)) refuse('wrong-project/unpinned image');
  if (c.baseImageUri !== undefined && !/^us-central1-docker\.pkg\.dev\/serverless-runtimes\/[^\s]+$/.test(c.baseImageUri)) refuse('unknown base image');
  if (c.buildInfo!==undefined) {
    record(c.buildInfo,['functionTarget','sourceLocation'],'container buildInfo',true);
    if (!expectedBuild || c.buildInfo.functionTarget!==expectedBuild.id || c.buildInfo.sourceLocation!==expectedBuild.sourceLocation) refuse('container build provenance differs from function');
  }
  record(c.resources,['limits','cpuIdle','startupCpuBoost'],'container resources');
  record(c.resources.limits,['cpu','memory'],'container limits',true); text(c.resources.limits.cpu,'cpu'); text(c.resources.limits.memory,'memory'); if (!/^(?:[1-9][0-9]*|[1-9][0-9]*m)$/.test(c.resources.limits.cpu) || !/^[1-9][0-9]*(?:Mi|Gi|M|G)$/.test(c.resources.limits.memory)) refuse('unknown CPU/memory quantity');
  for (const key of ['cpuIdle','startupCpuBoost']) if (c.resources[key] !== undefined && typeof c.resources[key] !== 'boolean') refuse('unknown resource flags');
  if (c.env !== undefined) { if (!Array.isArray(c.env)) refuse('environment array required'); const names = new Set(); for (const e of c.env) { record(e,['name','value'],'environment',true); text(e.name,'environment name'); if (typeof e.value !== 'string' || names.has(e.name)) refuse('ambiguous environment'); names.add(e.name); if (e.name === 'FIREBASE_CONFIG' && K.parseStrictJSON(e.value)?.projectId !== projectId) refuse('wrong FIREBASE_CONFIG project'); } }
  if (c.ports !== undefined) { if (!Array.isArray(c.ports) || c.ports.length !== 1) refuse('unknown container ports'); record(c.ports[0],['name','containerPort'],'port'); if (c.ports[0].containerPort !== 8080) refuse('unknown application port'); }
  for (const key of ['command','args']) if (c[key] !== undefined && (!Array.isArray(c[key]) || c[key].some(a => typeof a !== 'string'))) refuse('unknown command arguments');
  for (const key of ['startupProbe','livenessProbe']) if (c[key] !== undefined) { const probe=record(c[key],['failureThreshold','initialDelaySeconds','periodSeconds','timeoutSeconds','tcpSocket','httpGet'],key); if (probe.tcpSocket) { record(probe.tcpSocket,['port'],'probe socket',true); if (probe.tcpSocket.port !== 8080) refuse('unknown probe port'); } if (probe.httpGet) { record(probe.httpGet,['path','port'],'probe HTTP'); text(probe.httpGet.path,'probe path'); if (probe.httpGet.port !== undefined && probe.httpGet.port !== 8080) refuse('unknown probe HTTP port'); } }
  return x;
}
function normalizeEndpoint({projectId,id,fn,service,revision,at,archive}) {
  record(fn,FN,'function'); metadataTimes(fn,at,'function'); stringMap(fn.labels,'function labels'); record(fn.buildConfig,BUILD,'function build'); record(fn.serviceConfig,SC,'function service config');
  const name=`projects/${projectId}/locations/us-central1/functions/${id}`, b=fn.buildConfig, sc=fn.serviceConfig;
  if (fn.name !== name || fn.environment !== 'GEN_2' || fn.state !== 'ACTIVE' || b.runtime !== 'nodejs22' || b.entryPoint !== id || sc.allTrafficOnLatestRevision !== true || (fn.stateMessages && (!Array.isArray(fn.stateMessages) || fn.stateMessages.length))) refuse('function identity/state/runtime mismatch');
  if (time(fn.updateTime,'function update') > time(at,'observation')) refuse('future deployment');
  resource(b.build,projectId,/\/locations\/us-central1\/builds\/[A-Za-z0-9_-]+$/); resource(b.dockerRepository,projectId,/\/locations\/us-central1\/repositories\/[A-Za-z0-9_-]+$/); resource(b.serviceAccount,projectId,/\/serviceAccounts\/[A-Za-z0-9_.-]+@[a-z0-9.-]+\.gserviceaccount\.com$/);
  if (b.dockerRegistry !== 'ARTIFACT_REGISTRY') refuse('unknown registry');
  record(b.source,['storageSource'],'source',true); record(b.source.storageSource,['bucket','object','generation'],'storage source'); record(b.sourceProvenance,['resolvedStorageSource'],'source provenance',true);
  const source=record(b.sourceProvenance.resolvedStorageSource,['bucket','object','generation'],'resolved source',true);
  text(source.bucket,'source bucket'); text(source.object,'source object'); if (!/^[1-9][0-9]*$/.test(source.generation || '')) refuse('generation-pinned source required');
  if (b.source.storageSource.bucket !== source.bucket || b.source.storageSource.object !== source.object || (b.source.storageSource.generation !== undefined && b.source.storageSource.generation !== source.generation)) refuse('declared/resolved source mismatch');
  stringMap(b.environmentVariables,'build environment'); stringMap(sc.environmentVariables,'function environment');
  const automatic=b.automaticUpdatePolicy !== undefined;
  if (automatic === (b.onDeployUpdatePolicy !== undefined)) refuse('ambiguous runtime update policy');
  if (automatic) record(b.automaticUpdatePolicy,[],'automatic update policy',true); else { record(b.onDeployUpdatePolicy,['runtimeVersion'],'on-deploy policy',true); text(b.onDeployUpdatePolicy.runtimeVersion,'runtime version'); }
  resource(sc.service,projectId,/\/locations\/us-central1\/services\/[a-z0-9-]+$/); if (!/^[a-z0-9-]+$/.test(sc.revision || '')) refuse('unknown serving revision');
  const revisionName=`${sc.service}/revisions/${sc.revision}`;
  record(service,SERVICE,'Cloud Run service'); metadataTimes(service,at,'service'); stringMap(service.labels,'service labels'); stringMap(service.annotations,'service annotations');
  for (const key of ['customAudiences','urls']) if (service[key]!==undefined && (!Array.isArray(service[key]) || service[key].some(x=>typeof x!=='string'))) refuse('unknown service URL/audience list');
  if (service.conditions!==undefined) { conditions(service.conditions,'service readiness condition',at,['Ready','RoutesReady','ConfigurationsReady']); }
  if (service.name !== sc.service || service.latestCreatedRevision !== revisionName || service.latestReadyRevision !== revisionName || !service.generation || service.generation !== service.observedGeneration || service.reconciling === true || service.ingress !== 'INGRESS_TRAFFIC_ALL') refuse('Cloud Run identity/readiness/ingress mismatch');
  // Service-wide capacity remains visible in the approved configuration digest.
  if (service.sshEnabled!==undefined && service.sshEnabled!==false) refuse('SSH must be disabled when reported');
  if (service.scaling!==undefined) {
    record(service.scaling,['minInstanceCount','maxInstanceCount'],'service scaling');
    for(const [key,value] of Object.entries(service.scaling)) if (!Number.isSafeInteger(value) || value<0 || value!==(revision.scaling?.[key]??0)) refuse('service/revision scaling differs');
  }
  condition(service.terminalCondition,'service condition',at);
  for (const routes of [service.traffic,service.trafficStatuses]) { if (!Array.isArray(routes) || routes.length !== 1) refuse('traffic split/tagged route'); const r=record(routes[0],['type','revision','percent','tag','uri'],'traffic'); if (r.percent !== 100 || r.tag !== undefined || !['TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST','TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION'].includes(r.type) || (r.type === 'TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION' && r.revision !== sc.revision)) refuse('unknown serving route'); }
  if (service.trafficStatuses[0].revision !== sc.revision) refuse('traffic status revision mismatch');
  for (const flag of ['invokerIamDisabled','defaultUriDisabled','iapEnabled']) if (service[flag] !== undefined && typeof service[flag] !== 'boolean') refuse('unknown transport flag');
  if (service.buildConfig !== undefined) {
    const runBuild=record(service.buildConfig,['name','sourceLocation','functionTarget','baseImage','enableAutomaticUpdates','environmentVariables','serviceAccount','imageUri'],'Run buildConfig');
    if (runBuild.imageUri!==undefined && runBuild.imageUri!==service.template?.containers?.[0]?.image) refuse('Run build image differs from desired image');
    if (runBuild.functionTarget !== id || (runBuild.enableAutomaticUpdates !== undefined && runBuild.enableAutomaticUpdates !== automatic)) refuse('Run build target/update policy mismatch');
    if (runBuild.name !== undefined && runBuild.name !== b.build) refuse('Run build resource mismatch');
    if (runBuild.sourceLocation !== undefined && runBuild.sourceLocation !== `gs://${source.bucket}/${source.object}#${source.generation}` && runBuild.sourceLocation !== `gs://${source.bucket}/${source.object}`) refuse('Run build source differs');
    if (runBuild.baseImage !== undefined && !/^(?:nodejs22|google-22\/nodejs22|us-central1-docker\.pkg\.dev\/serverless-runtimes\/[^\s]+)$/.test(runBuild.baseImage)) refuse('unknown Run base image'); stringMap(runBuild.environmentVariables,'Run build environment');
    if (runBuild.serviceAccount !== undefined && runBuild.serviceAccount !== b.serviceAccount) refuse('Run build principal mismatch');
  }
  record(revision,REVISION,'Cloud Run revision'); metadataTimes(revision,at,'revision'); stringMap(revision.labels,'revision labels'); stringMap(revision.annotations,'revision annotations'); if (revision.name !== revisionName || ![sc.service,sc.service.split('/').pop()].includes(revision.service) || revision.reconciling === true) refuse('revision mismatch');
  if (revision.logUri!==undefined) {const u=new URL(revision.logUri);if(u.origin!=='https://console.cloud.google.com' || u.searchParams.get('project')!==projectId) refuse('wrong-project revision log URI');}
  conditions(revision.conditions,'revision condition',at,['Ready','Active','ResourcesAvailable','ContainerReady','ContainerHealthy'],true);
  const expectedBuild={id,sourceLocation:`gs://${source.bucket}/${source.object}#${source.generation}`};
  const running=spec(Object.fromEntries(SPEC.filter(k=>revision[k]!==undefined).map(k=>[k,revision[k]])),'revision spec',projectId,expectedBuild);
  const desired=spec(service.template,'service template',projectId,expectedBuild); const strip=v=>{
    const x={...v};delete x.revision;delete x.client;
    // Revision buildInfo is provider output. Both sides were checked against
    // the exact function/source above; raw values remain in the config digest.
    x.containers=x.containers.map(c=>{const {buildInfo,...execution}=c;void buildInfo;return execution;});
    return x;
  }; equal(strip(running),strip(desired),'desired/serving spec');
  if (desired.revision !== undefined && desired.revision !== sc.revision) refuse('template revision mismatch');
  if (sc.availableMemory!==running.containers[0].resources.limits.memory || sc.availableCpu!==running.containers[0].resources.limits.cpu || (sc.maxInstanceCount??null)!==(running.scaling?.maxInstanceCount??null) || (sc.minInstanceCount??0)!==(running.scaling?.minInstanceCount??0)) refuse('Functions/Run resource limits differ');
  if (running.serviceAccount !== sc.serviceAccountEmail || `${sc.timeoutSeconds}s` !== running.timeout || sc.maxInstanceRequestConcurrency !== running.maxInstanceRequestConcurrency || sc.ingressSettings !== 'ALLOW_ALL') refuse('Functions/Run execution mismatch');
  return {endpointName:id,functionResource:name,serviceResource:sc.service,revisionResource:revisionName,source,backendBuildId:archive.build.backendBuildId,configuration:{fn,service,revision},runtimeUpdate:{kind:automatic?'automatic':'on-deploy',baseImageUri:running.containers[0].baseImageUri ?? null}};
}
async function inspectOptionB({project:projectId,get,unpack=unpackOptionB,now=()=>new Date().toISOString(),plan,scoped=false}={}) {
  const environment=project(projectId), startedAt=now();
  (scoped ? scopedConfiguration : configApproval)(plan,projectId,startedAt);
  if (typeof get !== 'function') refuse('explicit independently authenticated GET transport required');
  const read=async (url,binary=false)=>{ fresh(startedAt,now()); const result=await get(url,binary); return binary ? result : data(result); };
  const identity=await read(`https://firebase.googleapis.com/v1beta1/projects/${projectId}`);
  if (identity.projectId!==projectId || String(identity.projectNumber)!==PROJECT_NUMBERS[projectId] || identity.state!=='ACTIVE' || identity.name!==`projects/${projectId}`) refuse('wrong Firebase project');
  const database=await read(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)`);
  if (!scoped) record(database,['name','type','locationId','concurrencyMode','appEngineIntegrationMode','createTime','updateTime','etag','uid','databaseEdition','deleteProtectionState','pointInTimeRecoveryEnablement','versionRetentionPeriod','earliestVersionTime','freeTier'],'database');
  metadataTimes(database,now(),'database');
  if (database.name!==`projects/${projectId}/databases/(default)` || database.type!=='FIRESTORE_NATIVE') refuse('wrong database');
  const inventoryUrl=`https://cloudfunctions.googleapis.com/v2/projects/${projectId}/locations/-/functions`;
  const inventoryOf=async()=> (await list(read,inventoryUrl,'functions')).filter(f=>!scoped || f.name?.split('/').pop().startsWith('teacherUnits')).map(f=>{resource(f.name,projectId,/\/locations\/[^/]+\/functions\/[^/]+$/);return {name:f.name,environment:f.environment??null,state:f.state??null,updateTime:f.updateTime??null};}).sort((a,b)=>a.name.localeCompare(b.name));
  const inventory=await inventoryOf(), units=inventory.filter(f=>f.name.split('/').pop().startsWith('teacherUnits'));
  if (units.length!==ENDPOINTS.length || units.some(f=>!ENDPOINTS.includes(f.name.split('/').pop()))) refuse('missing/unknown/duplicate nine-endpoint inventory');
  const endpoints=[], artifacts=[], captured=[], archives=new Map();
  for (const id of ENDPOINTS) {
    const expected=`projects/${projectId}/locations/us-central1/functions/${id}`;
    if (units.filter(f=>f.name===expected).length!==1) refuse('missing/duplicate/wrong-region endpoint');
    const snapshot=async()=>{
      const fn=await read(`https://cloudfunctions.googleapis.com/v2/${expected}`);
      const serviceName=fn.serviceConfig?.service, revisionName=fn.serviceConfig?.revision;
      resource(serviceName,projectId,/\/locations\/us-central1\/services\/[a-z0-9-]+$/); if (!/^[a-z0-9-]+$/.test(revisionName||'')) refuse('unknown revision');
      return {fn,service:await read(`https://run.googleapis.com/v2/${serviceName}`),revision:await read(`https://run.googleapis.com/v2/${serviceName}/revisions/${revisionName}`)};
    };
    const first=await snapshot(), source=first.fn.buildConfig?.sourceProvenance?.resolvedStorageSource;
    if (!source || typeof source.bucket!=='string' || typeof source.object!=='string' || !/^[1-9][0-9]*$/.test(source.generation||'')) refuse('immutable source generation required');
    const url=`https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(source.bucket)}/o/${encodeURIComponent(source.object)}?alt=media&generation=${source.generation}`;
    if (!archives.has(url)) archives.set(url,artifact(await unpack(await read(url,true))));
    const a=archives.get(url);
    const compareSnapshot=scoped ? value=>{
      const e=scopedEndpoint({projectId,id,...value,at:now(),archive:a,plan});
      return {deployment:e.deployment,source:e.source,backendBuildId:e.backendBuildId};
    } : value=>value;
    equal(compareSnapshot(first),compareSnapshot(await snapshot()),'provider changed during retrieval');
    endpoints.push((scoped ? scopedEndpoint : normalizeEndpoint)({projectId,id,...first,at:now(),archive:a,plan})); artifacts.push(a); captured.push({snapshot,first,compareSnapshot});
  }
  for (const a of artifacts) equal(a.build,artifacts[0].build,'mixed nine-endpoint build');
  for (const a of artifacts) equal(a.runtimeFiles,artifacts[0].runtimeFiles,'mixed application bytes');
  const rulesUrl=`https://firebaserules.googleapis.com/v1/projects/${projectId}/releases/cloud.firestore`, release=await read(rulesUrl);
  record(release,['name','rulesetName','updateTime','createTime','disabled'],'Rules release');
  if (release.name!==`projects/${projectId}/releases/cloud.firestore` || release.disabled===true || time(release.updateTime,'Rules update')>time(now(),'now')) refuse('invalid/disabled Rules release');
  resource(release.rulesetName,projectId,/\/rulesets\/[A-Za-z0-9_-]+$/);
  const ruleset=await read(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`);
  record(ruleset,['name','source','createTime','metadata'],'ruleset'); metadataTimes(ruleset,now(),'ruleset'); record(ruleset.source,['files','language'],'Rules source');
  if (ruleset.name!==release.rulesetName || !Array.isArray(ruleset.source.files) || ruleset.source.files.length!==1 || (ruleset.source.language!==undefined && ruleset.source.language!=='FIREBASE_RULES')) refuse('unknown Rules source');
  // Accept only the canonical label or the exact repository-relative label
  // captured by B4S. Never resolve paths/basenames or alter source bytes: the
  // single-file check above and resource/hash/approval bindings remain exact.
  const file=record(ruleset.source.files[0],['name','content','fingerprint'],'Rules file');
  if (typeof file.content!=='string' || !['firestore.rules','platform/firebase/firestore.rules'].includes(file.name)) refuse('exact Rules file required');
  equal(release,await read(rulesUrl),'Rules changed');
  const indexSnapshot=async()=>{
    const base=`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/collectionGroups/-`;
    const indexes=await list(read,`${base}/indexes`,'indexes'), fields=[...await list(read,`${base}/fields?filter=indexConfig.usesAncestorConfig%3Dfalse`,'fields'),...await list(read,`${base}/fields?filter=ttlConfig%3A*`,'fields')];
    const byName=new Map(); for (const f of fields) { if (byName.has(f.name)) equal(f,byName.get(f.name),'field configuration changed'); byName.set(f.name,f); }
    const inScope=value=>SCOPED_INDEX_GROUPS.some(group=>value.name?.includes(`/collectionGroups/${group}/`));
    return normalizeRemoteIndexes(scoped ? indexes.filter(inScope) : indexes,scoped ? [...byName.values()].filter(inScope) : [...byName.values()],projectId);
  };
  const indexes=await indexSnapshot(); equal(indexes,await indexSnapshot(),'indexes changed'); equal(inventory,await inventoryOf(),'inventory changed');
  for (const c of captured) equal(c.compareSnapshot(c.first),c.compareSnapshot(await c.snapshot()),'provider changed before completion');
  const configDigest=scoped ? scopedConfigDigest(database,endpoints) : fingerprint({database,endpoints:endpoints.map(e=>({endpointName:e.endpointName,...e.configuration}))});
  const approved=(scoped ? scopedConfiguration : configApproval)(plan,projectId,now(),artifacts[0].build.backendBuildId,configDigest);
  const a=artifacts[0];
  return data({kind:OBSERVATION_KIND,schemaVersion:scoped ? 2 : 1,scope:'application-config-consistency-only',authority:'none',operationalVerification:'not-certified',
    projectId,projectNumber:PROJECT_NUMBERS[projectId],environment:environment.name,databaseId:'(default)',region:'us-central1',startedAt,observedAt:now(),
    backendBuildId:a.build.backendBuildId,build:a.build,runtimeFiles:a.runtimeFiles,runtimePayloadFingerprint:a.runtimePayloadFingerprint,functionsArtifactFingerprint:a.functionsArtifactFingerprint,placementFingerprint:a.placementFingerprint,
    configDigest,configurationApprovalDigest:K.contentDigest(approved),configurationApproval:approved,database,endpoints,inventory,
    rules:{rulesetResource:ruleset.name,sourceHash:K.sha256Bytes(file.content),release:release.name,updateTime:release.updateTime},indexes,readyIndexesConfigurationHash:fingerprint(indexes)});
}
function assertObservation(e,projectId,now) {
  record(e,['kind','schemaVersion','scope','authority','operationalVerification','projectId','projectNumber','environment','databaseId','region','startedAt','observedAt','backendBuildId','build','runtimeFiles','runtimePayloadFingerprint','functionsArtifactFingerprint','placementFingerprint','configDigest','configurationApprovalDigest','configurationApproval','database','endpoints','inventory','rules','indexes','readyIndexesConfigurationHash'],'B observation',true);
  const environment=project(projectId); if (e.kind!==OBSERVATION_KIND || e.schemaVersion!==1 || e.projectId!==projectId || e.projectNumber!==PROJECT_NUMBERS[projectId] || e.environment!==environment.name || e.databaseId!=='(default)' || e.region!=='us-central1' || e.scope!=='application-config-consistency-only' || e.authority!=='none' || e.operationalVerification!=='not-certified') refuse('unknown observation kind/target/scope');
  fresh(e.observedAt,now); fresh(e.startedAt,e.observedAt);
  const b=B.validateAvailabilityRuntimeBuild(e.build); if (!b.ok || b.value.deploymentMode!=='policy-controlled' || b.value.sourceDirty || e.backendBuildId!==b.value.backendBuildId || e.placementFingerprint!==b.value.placementFingerprint) refuse('invalid observed B build');
  const payload={...e.runtimeFiles}; delete payload[BUILD_PATH]; if (fingerprint(e.runtimeFiles)!==e.functionsArtifactFingerprint || K.contentDigest(payload)!==b.value.runtimePayloadFingerprint || e.runtimePayloadFingerprint!==b.value.runtimePayloadFingerprint) refuse('observed runtime bytes mismatch');
  if (!Array.isArray(e.endpoints) || e.endpoints.length!==9 || e.endpoints.some((v,i)=>v.endpointName!==ENDPOINTS[i])) refuse('exact ordered nine endpoints required');
  for (const endpoint of e.endpoints) {
    record(endpoint,['endpointName','functionResource','serviceResource','revisionResource','source','backendBuildId','configuration','runtimeUpdate'],'observed endpoint',true);
    if (endpoint.backendBuildId!==e.backendBuildId) refuse('mixed observed build');
    const checked=normalizeEndpoint({projectId,id:endpoint.endpointName,...endpoint.configuration,at:e.observedAt,archive:{build:b.value}}); equal(checked,endpoint,'endpoint normalized configuration');
  }
  equal(e.configDigest,fingerprint({database:e.database,endpoints:e.endpoints.map(x=>({endpointName:x.endpointName,...x.configuration}))}),'configuration digest');
  const approved=configApproval(e.configurationApproval,projectId,now,e.backendBuildId,e.configDigest); equal(e.configurationApprovalDigest,K.contentDigest(approved),'configuration approval digest');
  equal(e.readyIndexesConfigurationHash,fingerprint(e.indexes),'indexes digest');
}
function assertCompatible(candidate,raw,{rulesApproval,rulesReport,approvalDigest,configurationApproval,now=new Date().toISOString()}={}) {
  const c=data(candidate), e=data(raw);
  record(c,['kind','schemaVersion','protocolVersion','projectId','projectNumber','environment','databaseId','source','backendBuildId','hostingArtifactFingerprint','placementFingerprint','rulesSourceHash','functionsArtifactFingerprint','runtimeFiles','indexes','applicationBuildFingerprint','releaseIntent','teacherUnitsAvailability','availabilityEvidence'],'B release candidate',true);
  record(c.source,['sha','dirty'],'B candidate source',true);
  project(c.projectId); assertObservation(e,c.projectId,now);
  if (configurationApproval !== undefined) equal(data(configurationApproval),e.configurationApproval,'supplied configuration approval');
  if (c.kind!=='lyfelabz.teacherUnitsOptionBCandidate' || c.schemaVersion!==1 || c.protocolVersion!=='teacher-units-v3' || c.projectNumber!==e.projectNumber || c.environment!==e.environment || c.databaseId!=='(default)' || c.releaseIntent!=='teacher-units' || c.teacherUnitsAvailability!=='server-policy-required' || c.availabilityEvidence!=='build-contract-assertion' || c.source?.dirty!==false || c.source?.sha!==e.build.sourceSha) refuse('candidate B contract/source mismatch');
  for (const field of ['backendBuildId','functionsArtifactFingerprint','placementFingerprint']) if (c[field]!==e[field]) refuse(`candidate ${field} mismatch`);
  equal(c.runtimeFiles,e.runtimeFiles,'candidate runtime files'); equal(c.indexes,e.indexes,'candidate ready indexes'); digest(c.hostingArtifactFingerprint,'candidate Hosting'); digest(c.applicationBuildFingerprint,'candidate compiler');
  const comparison=RULES.validateRulesEvidence(rulesApproval,{projectId:c.projectId,projectNumber:c.projectNumber,databaseId:c.databaseId,releaseSourceSha:c.source.sha,backendBuildId:c.backendBuildId,hostingArtifactFingerprint:c.hostingArtifactFingerprint,placementFingerprint:c.placementFingerprint,localRulesSourceHash:c.rulesSourceHash,observedRulesetResource:e.rules.rulesetResource,observedSourceHash:e.rules.sourceHash,approvalDigest,report:rulesReport});
  if (time(RULES.parseApproval(rulesApproval).review.reviewedAt,'Rules review')>time(now,'now')) refuse('future Rules review');
  return data({kind:'lyfelabz.teacherUnitsOptionBCompatibility',schemaVersion:1,scope:'consistency-evidence-only',authority:'none',backendBuildId:c.backendBuildId,configDigest:e.configDigest,rules:comparison});
}
function validateCurrentRelease(raw,{target,policy,now=new Date().toISOString(),approvalRef}={}) {
  // This validates retained/current supplied evidence, never enables anything.
  const b=data(raw); record(b,['kind','schemaVersion','projectId','policyInstanceId','policyGeneration','backendBuildId','placementFingerprint','approvalRef','preparedAt','observedAt','candidate','observation','configurationApproval','rulesApproval','rulesReport','approvalDigest','certifiedReceipt','hosting','review','provenance'],'current release',true);
  if (b.kind!==CURRENT_RELEASE_KIND || b.schemaVersion!==1 || b.projectId!==target?.projectId || target.projectNumber!==PROJECT_NUMBERS[b.projectId] || target.environment!==project(b.projectId).name || target.databaseId!=='(default)' || target.region!=='us-central1') refuse('current release kind/target mismatch');
  const p=P.validateAvailabilityPolicy(policy,target); if (!p.ok || p.value.mode!=='closed' || !p.value.approvedBackendBuildId || b.policyInstanceId!==p.value.policyInstanceId || b.policyGeneration!==p.value.generation || b.backendBuildId!==p.value.approvedBackendBuildId || b.placementFingerprint!==p.value.placementFingerprint || b.approvalRef!==approvalRef) refuse('current prepared closed policy/release binding required');
  text(approvalRef,'owner approval reference'); if (!['provider-observed','synthetic, not provider-verified'].includes(b.provenance) || (target.environment==='production' && b.provenance!=='provider-observed')) refuse('synthetic evidence cannot validate production');
  fresh(b.preparedAt,now,MAX_PREPARE_AGE_MS); fresh(b.observedAt,now); equal(b.observedAt,b.observation.observedAt,'current observation timestamp');
  equal(b.configurationApproval,b.observation.configurationApproval,'current configuration approval');
  if (b.candidate.projectId!==b.projectId || b.candidate.projectNumber!==target.projectNumber || b.candidate.environment!==target.environment || b.candidate.databaseId!==target.databaseId) refuse('current candidate/target tuple mismatch');
  const compatible=assertCompatible(b.candidate,b.observation,{rulesApproval:b.rulesApproval,rulesReport:b.rulesReport,approvalDigest:b.approvalDigest,now});
  if (b.backendBuildId!==b.candidate.backendBuildId || b.placementFingerprint!==b.candidate.placementFingerprint) refuse('current candidate identity mismatch');
  const receipt=b.certifiedReceipt;
  if (receipt?.phase!=='certified' || receipt.kind!=='lyfelabz.teacherUnitsOptionBReleaseReceipt' || receipt.project!==b.projectId) refuse('certified Option B receipt required');
  fresh(receipt.recordedAt,now,MAX_PREPARE_AGE_MS);
  const expected=require('../hosting-release/backend-state.cjs').optionBReceipt({phase:'certified',project:b.projectId,intent:'teacher-units',candidate:b.candidate,evidence:receipt.backend,hosting:receipt.hosting,rulesApproval:b.rulesApproval,rulesReport:b.rulesReport,approvalDigest:b.approvalDigest,configurationApproval:b.configurationApproval,recordedAt:receipt.recordedAt});
  equal(expected,receipt,'certified release receipt');
  for (const key of ['app','marketing']) {
    if (time(receipt.hosting[key].releaseTime,'certified Hosting release') < time(b.preparedAt,'prepare')) refuse('Hosting release predates preparation');
  }
  const h=record(b.hosting,['projectId','observedAt','app','marketing'],'current paired Hosting',true); if (h.projectId!==b.projectId) refuse('Hosting project mismatch'); fresh(h.observedAt,now);
  const sites=readTargetSites(b.projectId), env=project(b.projectId), files={};
  for (const key of ['app','marketing']) {
    const surface=record(h[key],['site','origin','files'],`Hosting ${key}`,true);
    if (surface.site!==sites[key] || surface.origin!==env.origins[key]) refuse('Hosting target/site/origin mismatch');
    if (!surface.files || typeof surface.files!=='object' || Array.isArray(surface.files) || !Object.keys(surface.files).length) refuse('actual served Hosting file inventory required');
    for (const [name,hash] of Object.entries(surface.files)) { if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').some(x=>!x || x==='..' || x==='.')) refuse('invalid Hosting artifact path'); digest(hash,'served Hosting file'); }
    files[key]=surface.files;
  }
  equal(fingerprint(files),b.candidate.hostingArtifactFingerprint,'current served paired Hosting bytes');
  if (time(b.preparedAt,'prepare')>time(receipt.recordedAt,'certification') || time(receipt.recordedAt,'certification')>time(b.observedAt,'current observation') || time(receipt.recordedAt,'certification')>time(h.observedAt,'current Hosting observation')) refuse('release preparation/certification/current observation ordering');
  const r=record(b.review,['principalSubject','decisionRef','reviewedAt','iamScopeAccepted','routingAccepted','automaticUpdatesAccepted'],'current IAM/routing review',true);
  text(r.principalSubject,'reviewer'); text(r.decisionRef,'review decision'); fresh(r.reviewedAt,now,MAX_PREPARE_AGE_MS);
  if (r.decisionRef!==approvalRef || r.iamScopeAccepted!==true || r.routingAccepted!==true || r.automaticUpdatesAccepted!==true) refuse('explicit effective IAM/routing/runtime residual review required');
  return data({kind:'lyfelabz.teacherUnitsOptionBCurrentReleaseComparison',schemaVersion:1,scope:'consistency-evidence-only',authority:'none',activation:'not-approved',projectId:b.projectId,policyInstanceId:b.policyInstanceId,policyGeneration:b.policyGeneration,backendBuildId:b.backendBuildId,placementFingerprint:b.placementFingerprint,approvalDigest:b.approvalDigest,configDigest:compatible.configDigest,observedAt:b.observedAt});
}
async function refreshCurrentRelease(raw,{get,now=()=>new Date().toISOString()}={}) {
  const b=data(raw);
  const observation=await inspectOptionB({project:b.projectId,get,now,plan:b.configurationApproval});
  // Current provider reads never refresh independent Hosting/IAM evidence dates.
  return {...b,observation,observedAt:observation.observedAt};
}

// E2 active schema 2. The schema-1 functions above are historical readers only.
// No Cloud Build, Artifact Registry or checkpoint API is used. Functions source
// bytes establish application consistency, not a signed source-to-image chain.
const SCOPED_INDEX_GROUPS=['teacherUnits','teacherUnitCreateReceipts','teacherUnitsAvailabilityHistory'];
function scopedIndexes(value) {
  return {indexes:value.indexes.filter(i=>SCOPED_INDEX_GROUPS.includes(i.collectionGroup)),fieldOverrides:value.fieldOverrides.filter(i=>SCOPED_INDEX_GROUPS.includes(i.collectionGroup))};
}
function scopedConfiguration(raw, projectId, at, buildId) {
  const p=record(data(raw),['kind','schemaVersion','projectId','backendBuildId','sourceSha','settings','automaticUpdatesAccepted','principalSubject','decisionRef','reviewedAt'],'scoped configuration',true);
  if(p.kind!==CONFIGURATION_KIND || p.schemaVersion!==2 || p.projectId!==projectId || p.automaticUpdatesAccepted!==true) refuse('scoped configuration target/version');
  digest(p.backendBuildId,'approved build');
  if(!/^[a-f0-9]{40}$/.test(p.sourceSha || '')) refuse('reviewed source commit required');
  text(p.principalSubject,'configuration reviewer');text(p.decisionRef,'configuration decision');
  if(time(p.reviewedAt,'configuration review')>time(at,'now')) refuse('future configuration review');
  const x=record(p.settings,['runtimeServiceAccount','timeoutSeconds','maxInstanceRequestConcurrency','availableMemory','availableCpu','minInstanceCount','maxInstanceCount','ingressSettings','environmentVariables'],'required settings',true);
  if(!/^[a-zA-Z0-9_.-]+@[a-z0-9.-]+\.gserviceaccount\.com$/.test(x.runtimeServiceAccount || '') || x.ingressSettings!=='ALLOW_ALL') refuse('runtime account/ingress required');
  for(const k of ['timeoutSeconds','maxInstanceRequestConcurrency','maxInstanceCount']) if(!Number.isSafeInteger(x[k]) || x[k]<1) refuse('positive runtime limit required');
  if(!Number.isSafeInteger(x.minInstanceCount) || x.minInstanceCount<0 || x.minInstanceCount>x.maxInstanceCount) refuse('invalid scaling limits');
  text(x.availableMemory,'memory');text(x.availableCpu,'cpu');stringMap(x.environmentVariables,'approved environment');
  if(!x.environmentVariables) refuse('explicit environment required');
  if(buildId!==undefined && buildId!==p.backendBuildId) refuse('deployment differs from approved build');
  return p;
}
function scopedEndpoint({projectId,id,fn,service,revision,at,archive,plan}) {
  const name=`projects/${projectId}/locations/us-central1/functions/${id}`, b=fn?.buildConfig, sc=fn?.serviceConfig;
  if(!ENDPOINTS.includes(id) || fn?.name!==name || fn.environment!=='GEN_2' || fn.state!=='ACTIVE' || b?.runtime!=='nodejs22' || b.entryPoint!==id || !sc) refuse('function target/runtime/deployment not ready');
  metadataTimes(fn,at,'function');
  const expectedService=`projects/${projectId}/locations/us-central1/services/${id.toLowerCase()}`;
  if(sc.service!==expectedService || !new RegExp(`^${id.toLowerCase()}-[a-z0-9-]+$`).test(sc.revision || '') || sc.allTrafficOnLatestRevision!==true) refuse('wrong endpoint service/revision');
  const revisionName=`${sc.service}/revisions/${sc.revision}`;
  if(service?.name!==sc.service || service.latestReadyRevision!==revisionName || service.latestCreatedRevision!==revisionName || !service.generation || service.generation!==service.observedGeneration || service.reconciling===true || service.ingress!=='INGRESS_TRAFFIC_ALL') refuse('serving deployment not reconciled');
  condition(service.terminalCondition,'service readiness',at);
  if(revision?.name!==revisionName || ![sc.service,id.toLowerCase()].includes(revision.service) || revision.reconciling===true) refuse('wrong serving revision');
  if(!Array.isArray(revision.conditions) || !revision.conditions.some(c=>c.type==='Ready' && c.state==='CONDITION_SUCCEEDED') || revision.conditions.some(c=>c.state!=='CONDITION_SUCCEEDED')) refuse('serving revision not healthy');
  for(const routes of [service.traffic,service.trafficStatuses]) {
    if(!Array.isArray(routes) || routes.length!==1) refuse('traffic split/alternate route');
    const r=routes[0];
    if(r.percent!==100 || r.tag!==undefined || !['TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST','TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION'].includes(r.type) || r.type==='TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION' && r.revision!==sc.revision) refuse('wrong serving traffic');
  }
  if(service.trafficStatuses[0].revision!==sc.revision) refuse('traffic status revision mismatch');
  const settings=plan.settings;
  for(const k of ['timeoutSeconds','maxInstanceRequestConcurrency','availableMemory','availableCpu','ingressSettings']) if(sc[k]!==settings[k]) refuse(`required ${k} differs`);
  if((sc.minInstanceCount??0)!==settings.minInstanceCount) refuse('required minInstanceCount differs');
  // The service-wide ceiling is mandatory. Managed Functions may omit all
  // Capabilities revision ceilings; any explicit ceiling must agree with the reviewed one.
  if(service.scaling?.maxInstanceCount!==settings.maxInstanceCount) refuse('required service maxInstanceCount differs');
  if(service.scaling.manualInstanceCount!==undefined || service.scaling.scalingMode && service.scaling.scalingMode!=='AUTOMATIC') refuse('unapproved service scaling mode');
  for(const scaling of [sc,service.template?.scaling,revision.scaling]) {
    if(scaling?.maxInstanceCount!==undefined && scaling.maxInstanceCount!==settings.maxInstanceCount) refuse('conflicting maxInstanceCount');
  }
  if(id!=='teacherUnitsCapabilities' && (sc.maxInstanceCount!==settings.maxInstanceCount || revision.scaling?.maxInstanceCount!==settings.maxInstanceCount)) refuse('required management maxInstanceCount differs');
  if(sc.serviceAccountEmail!==settings.runtimeServiceAccount || revision.serviceAccount!==settings.runtimeServiceAccount || service.template?.serviceAccount!==settings.runtimeServiceAccount) refuse('runtime account differs');
  if(revision.timeout!==`${settings.timeoutSeconds}s` || revision.maxInstanceRequestConcurrency!==settings.maxInstanceRequestConcurrency) refuse('serving limits differ');
  if((revision.scaling?.minInstanceCount??0)!==settings.minInstanceCount) refuse('serving scaling differs');
  if(service.sshEnabled===true) refuse('SSH enabled');
  const checkEnv=env=>{
    stringMap(env,'runtime environment');
    const user={...env};
    const reserved={GCLOUD_PROJECT:projectId,GOOGLE_CLOUD_PROJECT:projectId,FUNCTION_TARGET:id,FUNCTION_SIGNATURE_TYPE:'http',LOG_EXECUTION_ID:'true',EVENTARC_CLOUD_EVENT_SOURCE:sc.service.replace(id.toLowerCase(),id)};
    for(const [k,v] of Object.entries(reserved)) if(Object.hasOwn(user,k)) {if(user[k]!==v) refuse('wrong runtime environment identity');delete user[k];}
    if(Object.hasOwn(user,'FIREBASE_CONFIG')) {if(K.parseStrictJSON(user.FIREBASE_CONFIG).projectId!==projectId) refuse('wrong runtime Firebase project');delete user.FIREBASE_CONFIG;}
    equal(user,settings.environmentVariables,'approved environment');
  };
  checkEnv(sc.environmentVariables??{});
  for(const spec of [service.template,revision]) {
    if(!Array.isArray(spec?.containers) || spec.containers.length!==1) refuse('one application container required');
    const c=spec.containers[0];
    if(c.command?.length || c.args?.length || c.workingDir) refuse('unapproved code-loading override');
    if(c.resources?.limits?.cpu!==settings.availableCpu || c.resources?.limits?.memory!==settings.availableMemory) refuse('serving resources differ');
    const env={};for(const e of c.env??[]) {if(typeof e.name!=='string' || typeof e.value!=='string' || Object.hasOwn(env,e.name)) refuse('ambiguous runtime environment');env[e.name]=e.value;}checkEnv(env);
    // Tagged desired images and omitted executionEnvironment are supported
    // managed Functions behavior. Their strings are retained, not certified.
  }
  if(archive.build.backendBuildId!==plan.backendBuildId || archive.build.sourceSha!==plan.sourceSha) refuse('wrong reviewed application build');
  const source=b.sourceProvenance?.resolvedStorageSource;
  if(!source || !/^[1-9][0-9]*$/.test(source.generation || '')) refuse('fixed Functions source required');
  return {endpointName:id,functionResource:name,serviceResource:sc.service,revisionResource:revisionName,source,backendBuildId:archive.build.backendBuildId,
    deployment:{runtime:'nodejs22',state:fn.state,settings,revision:revisionName},configuration:{fn,service,revision}};
}
function scopedConfigDigest(database,endpoints) {return fingerprint({database:{name:database.name,type:database.type},endpoints:endpoints.map(e=>({endpointName:e.endpointName,deployment:e.deployment}))});}
async function inspectScoped(options) {return inspectOptionB({...options,scoped:true});}
function assertScopedObservation(e,projectId,now) {
  project(projectId);
  if(e?.kind!==OBSERVATION_KIND || e.schemaVersion!==2 || e.projectId!==projectId || e.projectNumber!==PROJECT_NUMBERS[projectId] || e.environment!==project(projectId).name || e.databaseId!=='(default)' || e.region!=='us-central1' || e.authority!=='none') refuse('scoped observation target/version');
  fresh(e.observedAt,now);fresh(e.startedAt,e.observedAt);
  const approved=scopedConfiguration(e.configurationApproval,projectId,now,e.backendBuildId);
  const checked=B.validateAvailabilityRuntimeBuild(e.build);
  if(!checked.ok || checked.value.deploymentMode!=='policy-controlled' || checked.value.sourceDirty || checked.value.backendBuildId!==e.backendBuildId || checked.value.sourceSha!==approved.sourceSha || checked.value.placementFingerprint!==e.placementFingerprint) refuse('clean controlled application build required');
  const payload={...e.runtimeFiles};delete payload[BUILD_PATH];
  if(fingerprint(e.runtimeFiles)!==e.functionsArtifactFingerprint || K.contentDigest(payload)!==checked.value.runtimePayloadFingerprint || e.runtimePayloadFingerprint!==checked.value.runtimePayloadFingerprint) refuse('application inventory mismatch');
  if(!Array.isArray(e.endpoints) || e.endpoints.length!==9 || e.endpoints.some((v,i)=>v.endpointName!==ENDPOINTS[i])) refuse('exact nine-endpoint scope required');
  for(const endpoint of e.endpoints) equal(endpoint,scopedEndpoint({projectId,id:endpoint.endpointName,...endpoint.configuration,at:e.observedAt,archive:{build:checked.value},plan:approved}),'serving endpoint');
  if(e.database?.name!==`projects/${projectId}/databases/(default)` || e.database.type!=='FIRESTORE_NATIVE') refuse('wrong database');
  equal(e.configDigest,scopedConfigDigest(e.database,e.endpoints),'required configuration digest');
  equal(e.configurationApprovalDigest,K.contentDigest(approved),'configuration decision');
  equal(e.readyIndexesConfigurationHash,fingerprint(e.indexes),'ready indexes');
  const inventory=e.inventory?.filter(f=>f.name.split('/').pop().startsWith('teacherUnits'));
  if(!inventory || inventory.length!==9 || ENDPOINTS.some(id=>inventory.filter(f=>f.name===`projects/${projectId}/locations/us-central1/functions/${id}` && f.state==='ACTIVE' && f.environment==='GEN_2').length!==1)) refuse('partial/alternate endpoint inventory');
}
function assertScopedCompatible(candidate,raw,{rulesApproval,rulesReport,approvalDigest,configurationApproval,now=new Date().toISOString()}={}) {
  const c=data(candidate),e=data(raw);
  record(c,['kind','schemaVersion','protocolVersion','projectId','projectNumber','environment','databaseId','source','backendBuildId','hostingArtifactFingerprint','placementFingerprint','rulesSourceHash','functionsArtifactFingerprint','runtimeFiles','indexes','applicationBuildFingerprint','releaseIntent','teacherUnitsAvailability','availabilityEvidence'],'B release candidate',true);
  record(c.source,['sha','dirty'],'candidate source',true);
  assertScopedObservation(e,c.projectId,now);
  if(c.kind!=='lyfelabz.teacherUnitsOptionBCandidate' || c.schemaVersion!==1 || c.protocolVersion!=='teacher-units-v3' || c.source.dirty!==false || c.source.sha!==e.build.sourceSha || c.projectNumber!==e.projectNumber || c.environment!==e.environment || c.databaseId!=='(default)' || c.releaseIntent!=='teacher-units' || c.teacherUnitsAvailability!=='server-policy-required' || c.availabilityEvidence!=='build-contract-assertion') refuse('candidate target/build contract');
  for(const k of ['backendBuildId','placementFingerprint','functionsArtifactFingerprint']) equal(c[k],e[k],k);
  equal(c.runtimeFiles,e.runtimeFiles,'application files');equal(scopedIndexes(c.indexes),e.indexes,'required ready indexes');
  digest(c.hostingArtifactFingerprint,'Hosting bytes');digest(c.applicationBuildFingerprint,'compiler');
  if(configurationApproval!==undefined) equal(configurationApproval,e.configurationApproval,'configuration approval');
  const a=RULES.parseApproval(rulesApproval);if(a.schemaVersion!==2) refuse('source-scoped Rules evidence required');
  if(time(a.review.reviewedAt,'Rules review')>time(now,'now')) refuse('future Rules review');
  const rules=RULES.validateRulesEvidence(a,{projectId:c.projectId,projectNumber:c.projectNumber,databaseId:c.databaseId,localRulesSourceHash:c.rulesSourceHash,observedRulesetResource:e.rules.rulesetResource,observedSourceHash:e.rules.sourceHash,approvalDigest,report:rulesReport});
  return data({kind:'lyfelabz.teacherUnitsOptionBCompatibility',schemaVersion:2,scope:'consistency-evidence-only',authority:'none',backendBuildId:c.backendBuildId,configDigest:e.configDigest,rules});
}
function validateScopedCurrentRelease(raw,{target,policy,now=new Date().toISOString(),approvalRef}={}) {
  const b=data(raw);
  record(b,['kind','schemaVersion','projectId','policyInstanceId','policyGeneration','backendBuildId','placementFingerprint','approvalRef','preparedAt','observedAt','candidate','observation','configurationApproval','rulesApproval','rulesReport','approvalDigest','certifiedReceipt','hosting','review','provenance','rollback','stagingAcceptance'],'scoped current release',true);
  if(b.kind!==CURRENT_RELEASE_KIND || b.schemaVersion!==2 || b.projectId!==target?.projectId || target.projectNumber!==PROJECT_NUMBERS[b.projectId] || target.environment!==project(b.projectId).name || target.databaseId!=='(default)' || target.region!=='us-central1') refuse('current release target/version');
  text(approvalRef,'explicit activation approval');
  const p=P.validateAvailabilityPolicy(policy,target);
  if(!p.ok || p.value.mode!=='closed' || !p.value.approvedBackendBuildId || b.policyInstanceId!==p.value.policyInstanceId || b.policyGeneration!==p.value.generation || b.backendBuildId!==p.value.approvedBackendBuildId || b.placementFingerprint!==p.value.placementFingerprint || b.approvalRef!==approvalRef) refuse('prepared closed policy/CAS binding required');
  if(b.provenance!=='provider-observed') refuse('synthetic/legacy evidence cannot authorize real projects');
  fresh(b.preparedAt,now,MAX_PREPARE_AGE_MS);fresh(b.observedAt,now);equal(b.observedAt,b.observation.observedAt,'observation time');
  const compatibility=assertScopedCompatible(b.candidate,b.observation,{rulesApproval:b.rulesApproval,rulesReport:b.rulesReport,approvalDigest:b.approvalDigest,configurationApproval:b.configurationApproval,now});
  if(b.candidate.backendBuildId!==b.backendBuildId || b.candidate.placementFingerprint!==b.placementFingerprint) refuse('candidate/policy mismatch');
  const r=b.certifiedReceipt;
  if(r?.kind!=='lyfelabz.teacherUnitsOptionBReleaseReceipt' || r.schemaVersion!==2 || r.phase!=='certified' || r.project!==b.projectId) refuse('scoped certified receipt required');
  fresh(r.recordedAt,now,MAX_PREPARE_AGE_MS);
  const expected=require('../hosting-release/backend-state.cjs').optionBReceipt({phase:'certified',project:b.projectId,intent:'teacher-units',candidate:b.candidate,evidence:r.backend,hosting:r.hosting,rulesApproval:b.rulesApproval,rulesReport:b.rulesReport,approvalDigest:b.approvalDigest,configurationApproval:b.configurationApproval,recordedAt:r.recordedAt});
  equal(expected,r,'certified release receipt');
  const h=record(b.hosting,['projectId','observedAt','app','marketing'],'paired Hosting',true), sites=readTargetSites(b.projectId),env=project(b.projectId),files={};
  if(h.projectId!==b.projectId) refuse('Hosting project mismatch');fresh(h.observedAt,now);
  for(const key of ['app','marketing']) {
    const surface=record(h[key],['site','origin','files','version'],'current Hosting surface',true);
    if(surface.site!==sites[key] || surface.origin!==env.origins[key] || surface.version!==r.hosting[key].version) refuse('Hosting site/version mismatch');
    if(!surface.files || !Object.keys(surface.files).length) refuse('served bytes required');
    for(const [name,hash] of Object.entries(surface.files)) {hostingPath(name);digest(hash,'served file');}files[key]=surface.files;
    if(time(r.hosting[key].releaseTime,'Hosting release')<time(b.preparedAt,'prepared')) refuse('Hosting release predates preparation');
  }
  equal(fingerprint(files),b.candidate.hostingArtifactFingerprint,'served pair');
  if(time(b.preparedAt,'prepare')>time(r.recordedAt,'certified') || time(r.recordedAt,'certified')>time(b.observedAt,'observed') || time(r.recordedAt,'certified')>time(h.observedAt,'Hosting observation')) refuse('release observation ordering');
  const review=record(b.review,['principalSubject','decisionRef','reviewedAt','iamScopeAccepted','routingAccepted','automaticUpdatesAccepted','purpose'],'operator decision',true);
  text(review.principalSubject,'decision principal');fresh(review.reviewedAt,now,MAX_PREPARE_AGE_MS);
  if(review.decisionRef!==approvalRef || review.iamScopeAccepted!==true || review.routingAccepted!==true || review.automaticUpdatesAccepted!==true || review.purpose!==(target.environment==='staging'?'staging-validation':'production-activation')) refuse('explicit environment-specific activation decision required');
  const rollback=record(b.rollback,['projectId','backendBuildId','sourceSha','deploymentMode','artifactRef','artifactSha256','verifiedClosed','hosting'],'rollback',true);
  if(rollback.projectId!==b.projectId || rollback.deploymentMode!=='closed-only' || rollback.verifiedClosed!==true || !/^[a-f0-9]{40}$/.test(rollback.sourceSha || '')) refuse('verified compatible closed-only rollback required');
  digest(rollback.backendBuildId,'rollback build');digest(rollback.artifactSha256,'retained artifact');text(rollback.artifactRef,'retained artifact reference');
  record(rollback.hosting,['app','marketing'],'rollback Hosting pair',true);
  for(const key of ['app','marketing']) if(rollback.hosting[key]!==r.hosting[key].previous) refuse('rollback pair mismatch');
  if(target.environment==='production') {
    const a=record(b.stagingAcceptance,['projectId','sourceSha','decisionRef','acceptedAt','teacherWorkflowsPassed','securityTestsPassed','shutdownRehearsed'],'staging acceptance',true);
    if(a.projectId!=='lyfelabz-staging' || a.sourceSha!==b.candidate.source.sha || a.teacherWorkflowsPassed!==true || a.securityTestsPassed!==true || a.shutdownRehearsed!==true) refuse('matching staging acceptance required');
    text(a.decisionRef,'staging acceptance decision');if(time(a.acceptedAt,'staging acceptance')>time(now,'now')) refuse('future staging acceptance');
  } else if(b.stagingAcceptance!==null) refuse('staging validation must not imply production acceptance');
  // Bind stable release facts. Live observation clocks can advance without
  // invalidating exact intent; a changed revision/config/Rules/pair cannot.
  const releaseId=K.contentDigest({candidate:b.candidate,configDigest:compatibility.configDigest,rules:compatibility.rules,configurationApproval:b.configurationApproval,
    certifiedAt:r.recordedAt,hosting:r.hosting,review,rollback,stagingAcceptance:b.stagingAcceptance,preparedAt:b.preparedAt,approvalRef});
  return data({kind:'lyfelabz.teacherUnitsOptionBCurrentReleaseComparison',schemaVersion:2,scope:'scoped-firebase-deployment',authority:'none',activation:'not-approved',projectId:b.projectId,policyInstanceId:b.policyInstanceId,policyGeneration:b.policyGeneration,backendBuildId:b.backendBuildId,placementFingerprint:b.placementFingerprint,approvalRef,preparedAt:b.preparedAt,releaseId,observedAt:b.observedAt});
}
function hostingPath(name) {
  if(typeof name!=='string' || !name || /[\\%?#\x00-\x20]/.test(name) || name.split('/').some(s=>!s || s==='.' || s==='..')) refuse('invalid Hosting file path');
  return name.split('/').map(encodeURIComponent).join('/');
}
async function refreshScopedCurrentRelease(raw,{get,now=()=>new Date().toISOString(),fetchImpl=fetch,readArtifact=name=>require('node:fs').readFileSync(name)}={}) {
  const b=data(raw);
  if(b.schemaVersion!==2 || b.kind!==CURRENT_RELEASE_KIND || b.provenance!=='provider-observed') refuse('real scoped release record required');
  const env=project(b.projectId),sites=readTargetSites(b.projectId);
  // Recovery must remain closed even if the policy cannot be changed. A
  // policy-controlled archive plus a claimed closed policy is not that fallback.
  if(!b.rollback || !require('node:path').isAbsolute(b.rollback.artifactRef || '')) refuse('absolute retained rollback archive required');
  const rollbackBytes=await readArtifact(b.rollback.artifactRef);
  if(K.sha256Bytes(rollbackBytes)!==b.rollback.artifactSha256) refuse('rollback archive changed or missing');
  const rollbackArtifact=artifact(unpackOptionB(rollbackBytes),'closed-only');
  if(rollbackArtifact.build.backendBuildId!==b.rollback.backendBuildId || rollbackArtifact.build.sourceSha!==b.rollback.sourceSha || rollbackArtifact.placementFingerprint!==b.placementFingerprint || b.rollback.deploymentMode!=='closed-only') refuse('incompatible rollback application');
  const observation=await inspectScoped({project:b.projectId,get,now,plan:b.configurationApproval});
  const hosting={projectId:b.projectId,observedAt:now()};
  for(const key of ['app','marketing']) {
    const channel=await get(`https://firebasehosting.googleapis.com/v1beta1/sites/${sites[key]}/channels/live`);
    const versionName=channel?.release?.version?.name;
    if(typeof versionName!=='string' || versionName!==`sites/${sites[key]}/versions/${b.certifiedReceipt?.hosting?.[key]?.version}`) refuse('current Hosting live version changed');
    if(b.hosting?.[key]?.site!==sites[key] || b.hosting[key].origin!==env.origins[key] || !b.hosting[key].files || !Object.keys(b.hosting[key].files).length) refuse('expected paired Hosting files required');
    const files={};
    for(const name of Object.keys(b.hosting[key].files)) {
      const response=await fetchImpl(`${env.origins[key]}/${hostingPath(name)}`,{redirect:'error',cache:'no-store'});
      if(response.status!==200) refuse('served Hosting file unavailable');files[name]=K.sha256Bytes(Buffer.from(await response.arrayBuffer()));
    }
    hosting[key]={site:sites[key],origin:env.origins[key],version:versionName.split('/').pop(),files};
    const after=await get(`https://firebasehosting.googleapis.com/v1beta1/sites/${sites[key]}/channels/live`);
    if(after?.release?.version?.name!==versionName) refuse('Hosting changed during retrieval');
  }
  hosting.observedAt=now();
  // Reviews, certification, Rules results and rollback clocks are never renewed.
  return {...b,observation,hosting,observedAt:observation.observedAt};
}
module.exports={OBSERVATION_KIND,CURRENT_RELEASE_KIND,CONFIGURATION_KIND,ENDPOINTS,
  inspectOptionB:inspectScoped,assertCompatible:assertScopedCompatible,assertObservation:assertScopedObservation,
  validateCurrentRelease:validateScopedCurrentRelease,refreshCurrentRelease:refreshScopedCurrentRelease,
  normalizeEndpoint:scopedEndpoint,unpackOptionB,
  historical:{inspectOptionB,assertCompatible,assertObservation,validateCurrentRelease,refreshCurrentRelease,normalizeEndpoint}};
