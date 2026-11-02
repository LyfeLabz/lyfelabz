'use strict';
// Hosting-only release evidence. Never writes policy, invokes a callable, or
// deploys Functions. Existing Option B checks still validate the backend at its
// ORIGINAL source SHA; the new Hosting source is recorded independently.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const H = require('./backend-state.cjs');
const C = require('./contract.cjs');
const O = require('../teacher-units-release/option-b-observation.cjs');
const P = require('../../platform/functions/lib/teacherUnits/availability-policy.js');
const { Timestamp } = require(require.resolve('firebase-admin/firestore',{paths:[path.resolve(__dirname,'../../platform/functions')]}));
const INTENT = 'teacher-units-hosting-only';
const KIND = 'lyfelabz.unchangedTeacherUnitsBackendCandidate';
const RECEIPT = 'lyfelabz.unchangedTeacherUnitsBackendReceipt';
function refuse(message) { throw new Error(`[unchanged-backend] REFUSED: ${message}`); }
function equal(a,b,label) { if (H.canonical(a)!==H.canonical(b)) refuse(`${label} changed or incompatible`); }
function policyName(project) { C.environmentForProject(project); return `projects/${project}/databases/(default)/documents/platformConfig/teacherUnitsAvailability`; }
function decode(value) {
  if (!value || Object.keys(value).length!==1) refuse('ambiguous Firestore policy value');
  if (Object.hasOwn(value,'nullValue') && value.nullValue===null) return null;
  if (typeof value.stringValue==='string') return value.stringValue;
  if (typeof value.booleanValue==='boolean') return value.booleanValue;
  if (typeof value.integerValue==='string' && /^(?:0|-?[1-9][0-9]*)$/.test(value.integerValue) && Number.isSafeInteger(Number(value.integerValue))) return Number(value.integerValue);
  if (typeof value.timestampValue==='string') {
    const m=/^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d)(?:\.(\d{1,9}))?Z$/.exec(value.timestampValue);
    if (!m || !Number.isFinite(Date.parse(m[1]+'Z')) || new Date(Date.parse(m[1]+'Z')).toISOString().slice(0,19)!==m[1]) refuse('invalid policy timestamp');
    return new Timestamp(Date.parse(m[1]+'Z')/1000,Number((m[2]||'').padEnd(9,'0')));
  }
  if (value.arrayValue && Object.keys(value.arrayValue).every(k=>k==='values') && (value.arrayValue.values===undefined || Array.isArray(value.arrayValue.values))) return (value.arrayValue.values||[]).map(decode);
  if (value.mapValue && Object.keys(value.mapValue).every(k=>k==='fields')) return decodeFields(value.mapValue.fields||{});
  refuse('unsupported Firestore policy value');
}
function decodeFields(fields) {
  if (!fields || typeof fields!=='object' || Array.isArray(fields)) refuse('policy fields required');
  return Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,decode(v)]));
}
function validatePolicy(document,e) {
  if (document?.name!==policyName(e.projectId) || !document.fields ||
      Object.keys(document).some(k=>!['name','fields','createTime','updateTime'].includes(k))) refuse('exact existing policy document required');
  for (const k of ['createTime','updateTime']) if (!document[k] || !Number.isFinite(Date.parse(document[k])) || Date.parse(document[k])>Date.parse(e.observedAt)) refuse('policy metadata timestamp');
  const identity={projectId:e.projectId,projectNumber:e.projectNumber,environment:e.environment,region:'us-central1',databaseId:'(default)'};
  const parsed=P.validateAvailabilityPolicy(decodeFields(document.fields),identity);
  if (!parsed.ok) refuse(`invalid current policy: ${parsed.issue.reason}`);
  const p=parsed.value;
  // This mode preserves existing enabled functionality. Closed/missing or
  // damaged policies need an explicitly reviewed different release workflow.
  if (p.mode!=='enabled' || p.approvedBackendBuildId!==e.backendBuildId || p.placementFingerprint!==e.placementFingerprint ||
      H.canonical(p.acceptedClientContractVersions)!==H.canonical(['teacher-units-v3'])) refuse('enabled policy/backend/client binding required');
  return p;
}
function backendView(e,{hostingArtifactFingerprint,applicationBuildFingerprint,rulesSourceHash,indexes}) {
  return {kind:H.OPTION_B_CANDIDATE,schemaVersion:1,protocolVersion:'teacher-units-v3',projectId:e.projectId,
    projectNumber:e.projectNumber,environment:e.environment,databaseId:'(default)',source:{sha:e.build.sourceSha,dirty:false},
    backendBuildId:e.backendBuildId,hostingArtifactFingerprint,applicationBuildFingerprint,placementFingerprint:e.placementFingerprint,
    rulesSourceHash,indexes,functionsArtifactFingerprint:e.functionsArtifactFingerprint,runtimeFiles:e.runtimeFiles,
    releaseIntent:'teacher-units',teacherUnitsAvailability:'server-policy-required',availabilityEvidence:'build-contract-assertion'};
}
function pin(e,policy) {
  // Include full endpoint provider snapshots, source generations, Rules identity,
  // runtime files and full policy (including updateTime), not merely build ID.
  const {startedAt,observedAt,...stable}=e;
  void startedAt;void observedAt;
  return H.fingerprint({observation:stable,policy});
}
async function inspect({project,configurationApproval,get,token,fetchImpl,run,unpack,now=()=>new Date().toISOString()}={}) {
  C.environmentForProject(project);
  O.validateConfigurationApproval(configurationApproval,project,now());
  const read=get || H.readApi({token:token || H.tokenFromGcloud(run),fetchImpl});
  const url=`https://firestore.googleapis.com/v1/${policyName(project)}`;
  const before=await read(url);
  const observation=await O.inspectOptionB({project,get:read,plan:configurationApproval,unpack,now});
  const policy=await read(url);
  equal(before,policy,'policy during observation');
  validatePolicy(policy,observation);
  return {observation,policy};
}
function assertClientSource(root,backendSha,hostingSha) {
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  if (git(['rev-parse','HEAD'])!==hostingSha) refuse('Hosting source SHA differs from HEAD');
  try { git(['merge-base','--is-ancestor',backendSha,hostingSha]); } catch { refuse('deployed backend source must be an ancestor of Hosting source'); }
  // Conservative bounded compatibility: retain the deployed Teacher Units client
  // implementation and its backend protocol/security implementation byte for byte.
  // A changed implementation requires separate compatibility review, not a flag.
  const roots=['app/src/teacherUnits','platform/functions/src/teacherUnits'];
  if (git(['diff',backendSha,'--',...roots])) refuse('Teacher Units client/backend source changed');
  if (git(['status','--porcelain','--untracked-files=normal'])) refuse('Hosting-only release requires a clean source checkout');
}
function candidate(pair,root=C.repositoryRoot,{verifySource=assertClientSource,verifyApplication}={}) {
  if (pair?.releaseIntent!==INTENT || pair.backendFormat!==INTENT || pair.target?.projectId===undefined ||
      pair.source?.dirty!==false || !/^[a-f0-9]{40}$/.test(pair.source?.sha||'')) refuse('clean Hosting-only pair required');
  equal(pair.target,H.optionBTarget(pair.target.projectId),'Hosting target');
  const baseline=pair.backendBaseline, e=baseline?.observation;
  if (!e || e.projectId!==pair.target.projectId) refuse('deployed backend baseline required');
  O.assertObservation(e,e.projectId,e.observedAt);
  validatePolicy(baseline.policy,e);
  verifySource(root,e.build.sourceSha,pair.source.sha);
  let build;
  try { build=verifyApplication ? verifyApplication() : JSON.parse(execFileSync(process.execPath,[path.join(root,'app/scripts/build-application.cjs'),'--verify',root,'teacher-units',pair.target.projectId,pair.target.environment,pair.target.origin],{encoding:'utf8',stdio:['ignore','pipe','pipe']})); }
  catch { refuse('unverifiable policy-capable application build'); }
  if (build.releaseIntent!=='teacher-units' || build.schemaVersion!==2 || build.availability!=='server-policy-required' || build.runtimeAvailability!=='not-certified' || build.availabilityEvidence!=='build-contract-assertion') refuse('application compiler profile');
  equal(build.policyTarget,pair.target,'compiler target');
  equal(pair.files?.app?.['app/dist/bundle.js'],build.outputs?.['app/dist/bundle.js'],'application bundle');
  equal(pair.files?.app?.['app/index.html'],build.inputs?.['app/index.html'],'application entry');
  if (!build.outputs?.['app/dist/bundle.js'] || !pair.files?.marketing || pair.unitPlacement?.fingerprint!==e.placementFingerprint) refuse('paired Hosting/placement inventory');
  return {kind:KIND,schemaVersion:1,releaseIntent:INTENT,projectId:e.projectId,source:pair.source,target:pair.target,
    teacherUnitsAvailability:'server-policy-required',availabilityEvidence:'build-contract-assertion',
    hostingArtifactFingerprint:H.fingerprint(pair.files),applicationBuildFingerprint:H.fingerprint(build),
    rulesSourceHash:C.sha256(fs.readFileSync(path.join(root,'platform/firebase/firestore.rules'))),
    indexes:H.normalizeLocalIndexes(JSON.parse(fs.readFileSync(path.join(root,'platform/firebase/firestore.indexes.json'),'utf8'))),
    backendBaseline:baseline,backendPin:pin(e,baseline.policy)};
}
function compare(c,evidence,inputs,now=new Date().toISOString()) {
  if (c?.kind!==KIND || c.schemaVersion!==1 || c.releaseIntent!==INTENT || c.teacherUnitsAvailability!=='server-policy-required' || c.availabilityEvidence!=='build-contract-assertion' || c.source?.dirty!==false || !/^[a-f0-9]{40}$/.test(c.source?.sha||'')) refuse('Hosting-only candidate contract');
  const e=evidence?.observation;
  O.assertObservation(e,c.projectId,now);
  validatePolicy(evidence.policy,e);
  equal(c.target,H.optionBTarget(c.projectId),'candidate target');
  equal(c.backendPin,pin(c.backendBaseline.observation,c.backendBaseline.policy),'baseline pin');
  equal(c.backendPin,pin(e,evidence.policy),'deployed backend/policy');
  // Existing exact source/runtime/Rules/configuration/index checks are reused
  // with an explicitly backend-scoped candidate, never a relabeled Hosting SHA.
  const compatibility=O.assertCompatible(backendView(e,c),e,{...inputs,now});
  equal(inputs.configurationApproval,e.configurationApproval,'reviewed configuration');
  return {kind:'lyfelabz.unchangedTeacherUnitsBackendCompatibility',schemaVersion:1,
    hostingSourceSha:c.source.sha,backendSourceSha:e.build.sourceSha,backendBuildId:e.backendBuildId,
    policyInstanceId:validatePolicy(evidence.policy,e).policyInstanceId,policyGeneration:validatePolicy(evidence.policy,e).generation,
    backendPin:c.backendPin,compatibility,authority:'none'};
}
async function verify(options={}) {
  C.environmentForProject(options.project);
  if (options.pair?.target?.projectId!==options.project) refuse('Hosting/backend project mismatch');
  const c=candidate(options.pair,options.root);
  equal(c,options.pair.candidate,'pair candidate');
  const evidence=await inspect(options);
  const compatibility=compare(c,evidence,options,options.now?.());
  return {candidate:c,evidence,compatibility};
}
function receipt(options) {
  const {phase,project,intent,candidate:c,evidence,hosting,recordedAt=new Date().toISOString()}=options;
  if (intent!==INTENT || c?.projectId!==project || !['prepared','certified'].includes(phase)) refuse('receipt scope');
  H.validateOptionBHosting(hosting,phase,project,recordedAt);
  const compatibility=compare(c,evidence,options,recordedAt);
  return JSON.parse(H.canonical({kind:RECEIPT,schemaVersion:1,phase,project,environment:C.environmentForProject(project).name,releaseIntent:INTENT,
    candidate:c,backend:evidence,hosting,recordedAt,compatibility,teacherUnitsReadiness:'unchanged-enabled-backend-observed',
    rulesApproval:Buffer.isBuffer(options.rulesApproval)?options.rulesApproval.toString('utf8'):options.rulesApproval,
    rulesReport:Buffer.isBuffer(options.rulesReport)?options.rulesReport.toString('utf8'):options.rulesReport,
    approvalDigest:options.approvalDigest,configurationApproval:options.configurationApproval,
    authority:'historical observation only; fresh predeploy and certification observations required'}));
}
function verifyPrepared(p,project,c,now=new Date().toISOString()) {
  const r=p?.evidenceReceipt;
  if (p?.kind!=='lyfelabz.hostingPreparedRelease' || p.schemaVersion!==3 || p.project!==project || p.environment!==C.environmentForProject(project).name || p.releaseIntent!==INTENT || r?.kind!==RECEIPT || r.schemaVersion!==1 || r.phase!=='prepared') refuse('current Hosting-only preparation required');
  equal(p.source,c.source,'prepared source');equal(p.candidate,c,'prepared candidate');equal(r.candidate,c,'receipt candidate');
  const age=Date.parse(now)-Date.parse(p.preparedAt),receiptAge=Date.parse(p.preparedAt)-Date.parse(r.recordedAt);
  if (!Number.isFinite(age) || age<0 || age>H.MAX_PREPARE_AGE_MS || !Number.isFinite(receiptAge) || receiptAge<0 || receiptAge>H.MAX_AGE_MS) refuse('stale preparation');
  equal(r,receipt({phase:'prepared',project,intent:INTENT,candidate:c,evidence:r.backend,hosting:p.surfaces,...require('./release.cjs').optionBReceiptInputs(r),recordedAt:r.recordedAt}),'prepared receipt');
}
module.exports={INTENT,KIND,RECEIPT,inspect,candidate,compare,verify,receipt,verifyPrepared,decode,validatePolicy,pin,assertClientSource};
