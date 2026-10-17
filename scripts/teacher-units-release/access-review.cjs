'use strict';
// A3-6 S5 IAM and route review (decision D11, gate G3).
//
// Reviews invocation access for the nine A3 endpoints on top of a verified S4
// provider observation and produces the `InvocationAccessV1` blocks and a
// versioned `accessReviewReceipt` (ContentObjectV1 address of canonical bytes).
//
// Evidence levels (owner direction):
//   A  structurally valid access review        - what S5 v1 produces
//   B  complete provider-verified access review - never produced by v1: inherited
//      IAM, deployed Hosting routes, domain mappings and load balancer backends are
//      not observed, so B always refuses
//   C  release-authorized access evidence       - S6 signing and registration
// No credentials, no signing, no registration, no IAM or provider writes.
// Transport is injected and GET-only. Not part of the deployed Functions payload.
const fs = require('node:fs');
const path = require('node:path');
const { PROJECT_NUMBERS, MAX_AGE_MS, canonical, fingerprint, resource } = require('../hosting-release/backend-state.cjs');
const O = require('./provider-observation.cjs');

const LIB = path.resolve(__dirname, '../../platform/functions/lib/teacherUnits');
function compiled(name) {
  try { return require(path.join(LIB, name)); }
  catch { return refuse(`compiled A3 module ${name} unavailable; run npm --prefix platform/functions run build`); }
}
function refuse(message) { throw new Error(`[a3-access-review] REFUSED: ${message}`); }
const P = compiled('a3-protocol.js');
const V = compiled('a3-validation.js');
const K = compiled('a3-canonical.js');

const EXPECTED_KIND = 'lyfelabz.teacherUnitsA3ExpectedAccess';
const RECEIPT_KIND = 'lyfelabz.teacherUnitsA3AccessReviewReceipt';
const REGION = 'us-central1';
const ENDPOINTS = O.ENDPOINTS;
const ENVIRONMENTS = Object.freeze({ 'lyfelabz-prod': 'production', 'lyfelabz-staging': 'staging' });
// The Hosting config each environment deploys with (CLAUDE.md, FIREBASE AND PRODUCTION).
const HOSTING_CONFIG = Object.freeze({ 'lyfelabz-prod': 'firebase.json', 'lyfelabz-staging': 'firebase.staging.json' });
const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const PROVENANCE = Object.freeze(['synthetic-fixture', 'provider-get']);
const SOURCES = Object.freeze(['Cloud Functions v2 function GET', 'Cloud Functions v2 getIamPolicy GET (requestedPolicyVersion=3)',
  'Cloud Run v2 service GET', 'Cloud Run v2 revision GET', 'Cloud Run v2 getIamPolicy GET (requestedPolicyVersion=3)', 'local Hosting configuration file']);
// Surfaces S5 v1 cannot observe. Each stays unresolved and blocks level B (D3, D5).
const UNRESOLVED = Object.freeze({
  inheritedIam: 'organization, folder and project IAM inheritance is not observed (Cloud Resource Manager ancestry and policies); gate G3 open',
  hostingReleases: 'deployed Firebase Hosting release configuration is not observed; local configuration alone is insufficient',
  domainMappings: 'Cloud Run domain mappings are not observed',
  loadBalancerBackends: 'load balancer serverless network endpoint groups and backends are not observed',
});
const READS_PER_ENDPOINT = 5;

// Documented IAM message fields (Cloud Functions v2 Policy/Binding/Expr and Cloud
// Run v2 GoogleIamV1Policy/Binding/GoogleTypeExpr, Google Cloud SDK 583.0.0).
const IAM_FIELDS = Object.freeze({ policy: ['auditConfigs', 'bindings', 'etag', 'version'], binding: ['condition', 'members', 'role'] });
const ROLE = /^(?:roles\/[A-Za-z0-9_.]+|projects\/[a-z][a-z0-9-]*\/roles\/[A-Za-z0-9_.]+|organizations\/[1-9][0-9]*\/roles\/[A-Za-z0-9_.]+)$/;
const RUN_INVOKER = 'roles/run.invoker';
const PUBLIC_ROLES = Object.freeze({ service: [RUN_INVOKER], function: ['roles/cloudfunctions.invoker'] });
// A3-1 ContentObjectV1 generation bound: Cloud Storage generations are signed longs.
const SIGNED_LONG_MAXIMUM = 9223372036854775807n;

const canonicalJSON = value => K.canonicalJSON(value);
const sha = value => K.sha256Bytes(canonicalJSON(value));
const byCanonical = (a, b) => { const x = canonicalJSON(a), y = canonicalJSON(b); return x < y ? -1 : x > y ? 1 : 0; };
function record(value, fields, d) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) refuse(`${d} missing or not an object`);
  for (const key of Object.keys(value)) if (!fields.includes(key)) refuse(`${d} has an unknown provider field: ${key}`);
  return value;
}
function strings(value, d) {
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !v)) refuse(`${d} must be an array of nonempty strings`);
  if (new Set(value).size !== value.length) refuse(`${d} has duplicates`);
  return [...value].sort();
}
// Proto3 JSON omits false booleans; absent therefore means false. S4 records an
// absent flag as null, which is read the same way.
function flag(value, d) {
  if (value === undefined || value === null) return false;
  if (typeof value !== 'boolean') refuse(`${d} must be a boolean`);
  return value;
}
// IAM etags are protobuf bytes, carried in JSON as standard Base64. Only the
// canonical encoding of a nonempty byte sequence is accepted (F5): alphabet,
// padding, length and zero trailing bits must all round-trip.
function etag(value) {
  return typeof value === 'string' && value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value) &&
    Buffer.from(value, 'base64').length > 0 && Buffer.from(value, 'base64').toString('base64') === value;
}

// --- IAM members ------------------------------------------------------------
// Only principals whose meaning can be evaluated from the policy alone are
// accepted. Groups, domains, workforce/workload principal sets, deleted
// principals, legacy project convenience values and allAuthenticatedUsers are
// refused: their effective membership is not observable here.
function member(value, project, d) {
  const number = PROJECT_NUMBERS[project];
  if (value === 'allUsers') return value;
  const m = /^(user|serviceAccount):([^:]+)$/.exec(value);
  if (!m || !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(m[2]) || m[2] !== m[2].toLowerCase()) {
    refuse(`${d} principal cannot be evaluated safely: ${value}`);
  }
  if (m[1] === 'serviceAccount') {
    const email = m[2];
    const sameProject = email.endsWith(`@${project}.iam.gserviceaccount.com`) || email === `${number}-compute@developer.gserviceaccount.com` ||
      email === `${project}@appspot.gserviceaccount.com` || new RegExp(`^service-${number}@[a-z0-9-]+\\.iam\\.gserviceaccount\\.com$`).test(email);
    if (!sameProject) refuse(`${d} cross-project service account: ${value}`);
  }
  return value;
}

/** Raw provider policy -> IamAllowPolicyV1 plus its etag. Fails closed on anything unreviewed. */
function normalizePolicy(raw, project, d) {
  record(raw, IAM_FIELDS.policy, d);
  if (raw.auditConfigs !== undefined) refuse(`${d} auditConfigs present; unreviewed policy content`);
  if (!etag(raw.etag)) refuse(`${d} etag missing or not canonical Base64`);
  // IAM documents an unset version (0) as version 1.
  if (![undefined, 0, 1, 3].includes(raw.version)) refuse(`${d} unsupported policy version`);
  if (raw.bindings !== undefined && !Array.isArray(raw.bindings)) refuse(`${d} bindings must be an array`);
  const roles = new Set();
  const bindings = (raw.bindings || []).map((b, i) => {
    const where = `${d} binding[${i}]`;
    record(b, IAM_FIELDS.binding, where);
    if (typeof b.role !== 'string' || !ROLE.test(b.role)) refuse(`${where} role missing or malformed`);
    if (b.condition !== undefined) refuse(`${where} has an IAM condition; conditional bindings cannot be evaluated safely`);
    if (roles.has(b.role)) refuse(`${where} duplicates role ${b.role}; ambiguous policy`);
    roles.add(b.role);
    const members = strings(b.members, `${where} members`);
    if (!members.length) refuse(`${where} has no members`);
    return { role: b.role, members: members.map(x => member(x, project, where)), condition: null };
  }).sort(byCanonical);
  return { etag: raw.etag, policy: { version: raw.version === 3 ? 3 : 1, bindings } };
}

/** Owner posture rules (D1) applied to approved and observed policies alike. */
function assertPosture(kind, policy, project, d) {
  for (const b of policy.bindings) {
    if (b.condition !== null) refuse(`${d} conditional binding is not an approved posture`);
    if (!b.members.length) refuse(`${d} ${b.role} binding has no members`);
    b.members.forEach(x => member(x, project, `${d} ${b.role}`));
    if (b.members.includes('allUsers') && !PUBLIC_ROLES[kind].includes(b.role)) refuse(`${d} grants ${b.role} to allUsers`);
  }
  if (kind === 'service') {
    const invoker = policy.bindings.filter(b => b.role === RUN_INVOKER);
    if (invoker.length !== 1 || canonicalJSON(invoker[0].members) !== canonicalJSON(['allUsers'])) {
      refuse(`${d} Cloud Run invocation must be exactly the explicit ${RUN_INVOKER} grant to allUsers`);
    }
  }
}

// --- default URLs (F3) ------------------------------------------------------
// Bound to the approved environment identity and the observed resource: the
// Functions URL is exactly the region-project-function form; Cloud Run URIs are
// the deterministic project-number form or the per-service hash form. The hash
// form carries no project identity (documented residual gap).
function expectedFunctionUrl(project, endpointName) { return `https://${REGION}-${project}.cloudfunctions.net/${endpointName}`; }
function serviceUriAllowed(uri, project, serviceResource) {
  const id = serviceResource.split('/').pop();
  return uri === `https://${id}-${PROJECT_NUMBERS[project]}.${REGION}.run.app` || new RegExp(`^https://${id}-[a-z0-9]+-uc\\.a\\.run\\.app$`).test(uri);
}
function assertDefaultUrls(urls, project, endpointName, serviceResource, defaultUriDisabled, d) {
  if (urls.functionUrl !== expectedFunctionUrl(project, endpointName)) refuse(`${d} Functions default URL is missing or not bound to ${project}/${endpointName}`);
  if (!Array.isArray(urls.serviceUris)) refuse(`${d} Cloud Run URIs missing`);
  if (!defaultUriDisabled && !urls.serviceUris.length) refuse(`${d} Cloud Run default URI missing`);
  for (const uri of urls.serviceUris) if (!serviceUriAllowed(uri, project, serviceResource)) refuse(`${d} Cloud Run URI is not bound to ${project}/${serviceResource.split('/').pop()}: ${uri}`);
}

// --- structural schemas -----------------------------------------------------
const S = (() => {
  // A3-1 rejects a binding with no members (F4); enforced here before composition.
  const members = (v, p) => { P.array(P.text, x => x)(v, p); if (!v.length) P.refuse(p, 'IAM binding requires members'); };
  const policy = P.object({ version: P.literal(1, 3), bindings: P.array(P.object({ role: P.pattern(ROLE), members, condition: P.literal(null) }), v => canonicalJSON(v)) });
  const email = P.pattern(/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/);
  const ingress = P.literal('all', 'internal', 'internal-and-load-balancing');
  // A3-1 ContentObjectV1 bounds (F4): positive decimal generation within a signed long.
  const generation = (v, p) => { P.pattern(/^[1-9][0-9]*$/)(v, p); if (BigInt(v) > SIGNED_LONG_MAXIMUM) P.refuse(p, 'provider integer out of range'); };
  const contentObject = P.object({ bucket: P.pattern(/^[a-z0-9][a-z0-9._-]*[a-z0-9]$/), object: P.text, generation, sha256: P.digest });
  const expectedEndpoint = P.object({ endpointName: P.literal(...ENDPOINTS), runtimeServiceAccountEmail: email, ingress,
    invokerIamDisabled: P.literal(false), iapEnabled: P.literal(false), defaultUriDisabled: P.literal(true, false),
    customAudiences: P.array(P.text, v => v), functionAllowPolicy: policy, serviceAllowPolicy: policy });
  const expected = P.object({ schemaVersion: P.literal(1), kind: P.literal(EXPECTED_KIND), environment: P.literal('production', 'staging'),
    projectId: P.text, projectNumber: P.text, region: P.literal(REGION),
    endpoints: P.array(expectedEndpoint, v => String(P.plainRecord(v, '$').endpointName)) });
  const observedPolicy = P.object({ resource: P.text, etag: (v, p) => { if (!etag(v)) P.refuse(p, 'canonical Base64 etag required'); }, sha256: P.digest, policy });
  const receiptEndpoint = P.object({ endpointName: P.literal(...ENDPOINTS), functionResource: P.text, serviceResource: P.text, revisionResource: P.text,
    runtimeServiceAccountEmail: email, ingress,
    access: P.object({ invokerIamDisabled: P.literal(false), defaultUriDisabled: P.literal(true, false), iapEnabled: P.literal(false), customAudiences: P.array(P.text, v => v) }),
    functionPolicy: observedPolicy, servicePolicy: observedPolicy,
    defaultUrls: P.object({ functionUrl: P.text, serviceUris: P.array(P.text, v => v) }),
    revisionRoute: P.object({ revisionResource: P.text, percent: P.literal(100), tag: P.literal(null) }) });
  const unresolved = P.object({ status: P.literal('unresolved'), reason: P.text });
  const configured = P.object({ status: P.literal('observed-configuration') });
  const receipt = P.object({ schemaVersion: P.literal(1), kind: P.literal(RECEIPT_KIND), authority: P.text,
    reviewLevel: P.literal('A-structural'), providerComplete: P.literal(false), releaseAuthorized: P.literal(false),
    provenance: P.literal(...PROVENANCE), environment: P.literal('production', 'staging'), projectId: P.text, projectNumber: P.text, region: P.literal(REGION),
    s4ObservationFingerprint: P.digest, s4StartedAt: P.text, s4ObservedAt: P.text, deploymentPlanSha256: P.digest, expectedAccessSha256: P.digest,
    startedAt: P.text, observedAt: P.text, sources: P.array(P.text),
    inheritedIam: unresolved,
    routes: P.object({ hostingReleases: unresolved, domainMappings: unresolved, loadBalancerBackends: unresolved,
      localHostingConfig: P.object({ status: P.literal('checked-local-only'), path: P.text, sha256: P.digest }),
      defaultUrls: configured, revisionRoutes: configured, ingress: configured }),
    endpoints: P.array(receiptEndpoint, v => String(P.plainRecord(v, '$').endpointName)) });
  return { expected, receipt, contentObject };
})();
function structural(rule, value, d) {
  const result = P.validate(rule, value);
  if (!result.ok) refuse(`${d} invalid at ${result.issue?.path}: ${result.issue?.reason}`);
}
function readCanonical(object, bytes, rule, d) {
  structural(S.contentObject, object, `${d} content object`);
  if (!Buffer.isBuffer(bytes) || bytes.length > 8 * 1024 * 1024) refuse(`${d} bytes required`);
  if (K.sha256Bytes(bytes) !== object.sha256) refuse(`${d} bytes do not match the content object hash`);
  let value; try { value = K.parseStrictJSON(bytes.toString('utf8')); } catch { refuse(`${d} is not strict JSON`); }
  if (canonicalJSON(value) !== bytes.toString('utf8')) refuse(`${d} bytes are not canonical JSON`);
  structural(rule, value, d);
  return value;
}
function identity(value, project, d) {
  if (!Object.hasOwn(ENVIRONMENTS, project)) refuse('an explicit supported --project is required (lyfelabz-staging or lyfelabz-prod)');
  if (value.projectId !== project || value.environment !== ENVIRONMENTS[project] || value.projectNumber !== PROJECT_NUMBERS[project]) refuse(`${d} wrong-project or wrong-environment identity`);
  if (canonicalJSON(value.endpoints.map(e => e.endpointName)) !== canonicalJSON(ENDPOINTS)) refuse(`${d} requires exactly the nine sorted A3 endpoints`);
}

// --- expected-access plan (D6) ----------------------------------------------
/** Verifies the expected-access attachment at its ContentObjectV1 address. */
function readExpectedAccess(object, bytes, project) {
  const plan = readCanonical(object, bytes, S.expected, 'expected-access plan');
  identity(plan, project, 'expected-access plan');
  for (const e of plan.endpoints) {
    assertPosture('service', e.serviceAllowPolicy, project, `expected ${e.endpointName} Cloud Run policy`);
    assertPosture('function', e.functionAllowPolicy, project, `expected ${e.endpointName} Cloud Functions policy`);
  }
  return plan;
}

// --- local Hosting configuration (necessary, never sufficient) --------------
const REWRITE_KEYS = ['source', 'regex', 'destination', 'function', 'run', 'dynamicLinks'];
/** Refuses any local rewrite that can route to Functions or Cloud Run. */
function localHostingExposure(bytes, d) {
  let config; try { config = K.parseStrictJSON(Buffer.from(bytes).toString('utf8')); } catch { refuse(`${d} is not strict JSON`); }
  const sites = config?.hosting === undefined ? [] : Array.isArray(config.hosting) ? config.hosting : [config.hosting];
  sites.forEach((site, s) => {
    if (!site || typeof site !== 'object') refuse(`${d} hosting[${s}] malformed`);
    if (site.rewrites === undefined) return;
    if (!Array.isArray(site.rewrites)) refuse(`${d} hosting[${s}].rewrites malformed`);
    site.rewrites.forEach((r, i) => {
      record(r, REWRITE_KEYS, `${d} hosting[${s}].rewrites[${i}]`);
      if (r.function !== undefined || r.run !== undefined) refuse(`${d} hosting[${s}].rewrites[${i}] routes to Functions or Cloud Run; unreviewed endpoint exposure`);
    });
  });
}
/** Reads and checks the environment's own Hosting config; path and hash come only from that file (F3). */
function checkLocalHosting(project, root = REPOSITORY_ROOT) {
  const name = HOSTING_CONFIG[project];
  let bytes; try { bytes = fs.readFileSync(path.join(root, name)); } catch { refuse(`local Hosting configuration ${name} unreadable`); }
  localHostingExposure(bytes, name);
  return { status: 'checked-local-only', path: name, sha256: K.sha256Bytes(bytes) };
}

// --- endpoint evaluation (shared by review and verification) ----------------
/** Every eligibility rule for one endpoint; refuses on the first class of failure. */
function evaluateEndpoint(entry, observed, planned, project) {
  const c = observed.configuration, d = entry.endpointName;
  if (entry.functionResource !== c.functionResource || entry.serviceResource !== c.serviceResource || entry.revisionResource !== c.revisionResource ||
      canonicalJSON(entry.revisionRoute) !== canonicalJSON({ revisionResource: c.revisionResource, percent: 100, tag: null })) refuse(`${d} resource identity differs from the S4 observation`);
  if (entry.functionPolicy.resource !== c.functionResource || entry.servicePolicy.resource !== c.serviceResource) refuse(`${d} policy is not bound to the observed resource`);
  for (const key of ['functionPolicy', 'servicePolicy']) if (entry[key].sha256 !== sha(entry[key].policy)) refuse(`${d} ${key} hash does not match its content`);
  if (entry.runtimeServiceAccountEmail !== c.execution.serviceAccountEmail) refuse(`${d} runtime service identity differs from the S4 observation`);
  if (entry.ingress !== c.execution.ingress) refuse(`${d} ingress differs from the S4 observation`);
  // The access flags were recorded by the certified S4 normalizer; a receipt must carry exactly those.
  const s4 = observed.provider.accessForS5;
  if (canonicalJSON(entry.access) !== canonicalJSON({ invokerIamDisabled: flag(s4.invokerIamDisabled, `${d} S4 invokerIamDisabled`),
    defaultUriDisabled: flag(s4.defaultUriDisabled, `${d} S4 defaultUriDisabled`), iapEnabled: flag(s4.iapEnabled, `${d} S4 iapEnabled`),
    customAudiences: s4.customAudiences })) refuse(`${d} access flags differ from the S4 observation`);
  assertDefaultUrls(entry.defaultUrls, project, d, c.serviceResource, entry.access.defaultUriDisabled, d);
  // Gen2 traffic is authorized by Cloud Run run.routes.invoke; the Functions
  // policy never establishes invocation security on its own.
  if (entry.access.invokerIamDisabled !== false) refuse(`${d} Cloud Run invoker IAM check is disabled (invokerIamDisabled); explicit IAM grant required`);
  if (entry.access.iapEnabled !== false) refuse(`${d} IAP is enabled; approved posture requires iapEnabled false`);
  assertPosture('service', entry.servicePolicy.policy, project, `${d} Cloud Run policy`);
  assertPosture('function', entry.functionPolicy.policy, project, `${d} Cloud Functions policy`);
  const differences = [];
  const same = (a, b, where) => { if (canonicalJSON(a) !== canonicalJSON(b)) differences.push(where); };
  same(entry.runtimeServiceAccountEmail, planned.runtimeServiceAccountEmail, 'runtimeServiceAccountEmail');
  same(entry.ingress, planned.ingress, 'ingress');
  same(entry.access.defaultUriDisabled, planned.defaultUriDisabled, 'defaultUriDisabled');
  same(entry.access.customAudiences, planned.customAudiences, 'customAudiences');
  // Bindings are compared exactly. The version is not: without conditions it
  // carries no meaning, and the provider decides which version to report.
  same(entry.servicePolicy.policy.bindings, planned.serviceAllowPolicy.bindings, 'serviceAllowPolicy');
  same(entry.functionPolicy.policy.bindings, planned.functionAllowPolicy.bindings, 'functionAllowPolicy');
  if (differences.length) refuse(`${d} observed access differs from the approved expected access: ${differences.join(', ')}`);
}

// The S4 archive record for an observed endpoint. S5 does not download the
// archive again: the S4 normalizer is given the S4-recorded generation-pinned
// source and fingerprints, so any change of resolved source refuses there.
function archiveOf(observation, configuration) {
  const { bucket, object, generation, sha256 } = configuration.build.source;
  return { source: { bucket, object, generation }, archiveHash: sha256, runtimePayloadFingerprint: observation.runtimePayloadFingerprint,
    artifactFingerprint: observation.functionsArtifactFingerprint, placementFingerprint: observation.placementFingerprint };
}
/**
 * One endpoint's raw S5 reads -> receipt entry (F2). The current Function,
 * Cloud Run service and serving revision are re-validated by the certified S4
 * normalizer (template parity, readiness, reconciliation, latest revisions,
 * function state, traffic, nested fields) and must reproduce the S4 record exactly.
 */
function normalizeAccess({ project, observation, observed, fn, service, revision, functionPolicy, servicePolicy, at }) {
  const c = observed.configuration, d = c.endpointName;
  const current = O.normalizeEndpoint({ project, endpointName: d, fn, service, revision, archive: archiveOf(observation, c), at });
  if (canonical({ configuration: current.configuration, runtimeProfile: current.runtimeProfile, provider: current.provider }) !== canonical(observed)) {
    refuse(`${d} current Function or Cloud Run configuration differs from the S4 observation`);
  }
  const s4 = current.provider.accessForS5;
  const access = { invokerIamDisabled: flag(s4.invokerIamDisabled, `${d} invokerIamDisabled`), defaultUriDisabled: flag(s4.defaultUriDisabled, `${d} defaultUriDisabled`),
    iapEnabled: flag(s4.iapEnabled, `${d} iapEnabled`), customAudiences: s4.customAudiences };
  // A status URI exists only for a tagged route; S4 records it as metadata.
  if (service.trafficStatuses.some(t => t.uri !== undefined)) refuse(`${d} revision route URL present`);
  // URI fields S4 records as metadata only; S5 requires and binds them.
  const listed = service.urls === undefined ? [] : strings(service.urls, `${d} Cloud Run urls`);
  if (service.uri !== undefined && typeof service.uri !== 'string') refuse(`${d} Cloud Run uri malformed`);
  if (!access.defaultUriDisabled && service.uri === undefined) refuse(`${d} Cloud Run default URI missing`);
  if (service.uri !== undefined && listed.length && !listed.includes(service.uri)) refuse(`${d} Cloud Run uri is not among its urls`);
  const serviceUris = [...new Set([...(service.uri === undefined ? [] : [service.uri]), ...listed])].sort();
  const defaultUrls = { functionUrl: fn.url === undefined ? null : fn.url, serviceUris };
  assertDefaultUrls(defaultUrls, project, d, c.serviceResource, access.defaultUriDisabled, d);
  if (fn.serviceConfig.uri !== undefined && !serviceUris.includes(fn.serviceConfig.uri)) refuse(`${d} Functions service URI differs from the Cloud Run URIs`);
  const fnPolicy = normalizePolicy(functionPolicy, project, `${d} Cloud Functions policy`);
  const runPolicy = normalizePolicy(servicePolicy, project, `${d} Cloud Run policy`);
  return {
    endpointName: d, functionResource: c.functionResource, serviceResource: c.serviceResource, revisionResource: c.revisionResource,
    runtimeServiceAccountEmail: c.execution.serviceAccountEmail, ingress: c.execution.ingress, access,
    functionPolicy: { resource: c.functionResource, etag: fnPolicy.etag, sha256: sha(fnPolicy.policy), policy: fnPolicy.policy },
    servicePolicy: { resource: c.serviceResource, etag: runPolicy.etag, sha256: sha(runPolicy.policy), policy: runPolicy.policy },
    defaultUrls, revisionRoute: { revisionResource: c.revisionResource, percent: 100, tag: null },
  };
}

const AUTHORITY = 'access review evidence only (level A, structural); not signed, not provider-complete, not a release, approval, certification or availability document';
function routesSection(localHostingConfig) {
  return {
    hostingReleases: { status: 'unresolved', reason: UNRESOLVED.hostingReleases },
    domainMappings: { status: 'unresolved', reason: UNRESOLVED.domainMappings },
    loadBalancerBackends: { status: 'unresolved', reason: UNRESOLVED.loadBalancerBackends },
    localHostingConfig,
    defaultUrls: { status: 'observed-configuration' }, revisionRoutes: { status: 'observed-configuration' }, ingress: { status: 'observed-configuration' },
  };
}
function readPlans(project, observation, deploymentPlan, expected, now) {
  O.compareObservationToPlan(observation, deploymentPlan?.object, deploymentPlan?.bytes, project, now);
  return readExpectedAccess(expected?.object, expected?.bytes, project);
}

/**
 * Reviews access for the nine endpoints of a verified S4 observation against the
 * approved S4 deployment plan and the S5 expected-access plan. The review must
 * complete within the S4 observation's five-minute window. Returns the receipt
 * and its canonical bytes; the caller supplies the storage address (S6).
 */
async function reviewA3Access({ project, get, observation, deploymentPlan, expected, provenance, hostingRoot = REPOSITORY_ROOT, now = () => new Date().toISOString() } = {}) {
  if (!Object.hasOwn(ENVIRONMENTS, project)) refuse('an explicit supported --project is required (lyfelabz-staging or lyfelabz-prod)');
  if (typeof get !== 'function') refuse('an explicit GET transport is required; S5 holds no credentials');
  if (!PROVENANCE.includes(provenance)) refuse('explicit provenance required: synthetic-fixture or provider-get');
  const startedAt = now(), start = O.instant(startedAt, 'review start');
  O.assertA3Observation(observation, project, startedAt);
  if (start < O.instant(observation.observedAt, 'S4 observation end')) refuse('review cannot start before the S4 observation ended');
  const deadline = O.instant(observation.startedAt, 'S4 observation start') + BigInt(MAX_AGE_MS) * 1000000n;
  const plan = readPlans(project, observation, deploymentPlan, expected, startedAt);
  const localHostingConfig = checkLocalHosting(project, hostingRoot);

  const read = async url => {
    if (O.instant(now(), 'review clock') > deadline) refuse('stale review; the S4 observation window has expired, observe the provider again');
    try { return await get(url, false); }
    catch (error) { if (/REFUSED/.test(String(error?.message))) throw error; return refuse(`provider read failed: ${new URL(url).host}`); }
  };
  const snapshot = async observed => {
    const c = observed.configuration;
    return {
      fn: await read(`https://cloudfunctions.googleapis.com/v2/${c.functionResource}`),
      functionPolicy: await read(`https://cloudfunctions.googleapis.com/v2/${c.functionResource}:getIamPolicy?options.requestedPolicyVersion=3`),
      service: await read(`https://run.googleapis.com/v2/${c.serviceResource}`),
      revision: await read(`https://run.googleapis.com/v2/${c.revisionResource}`),
      servicePolicy: await read(`https://run.googleapis.com/v2/${c.serviceResource}:getIamPolicy?options.requestedPolicyVersion=3`),
    };
  };
  // Two observation-wide passes; any difference, including an etag, refuses.
  // Provider APIs offer no transactional snapshot: a change reverted between
  // passes, or made after the second pass, is not detected.
  const first = [];
  for (const observed of observation.endpoints) first.push(await snapshot(observed));
  for (let i = 0; i < first.length; i++) {
    if (canonical(first[i]) !== canonical(await snapshot(observation.endpoints[i]))) refuse(`IAM or service configuration changed during the review: ${observation.endpoints[i].configuration.endpointName}`);
  }
  const at = O.instant(now(), 'review clock');
  const endpoints = observation.endpoints.map((observed, i) => normalizeAccess({ project, observation, observed, ...first[i], at }));
  endpoints.forEach((entry, i) => evaluateEndpoint(entry, observation.endpoints[i], plan.endpoints[i], project));
  const observedAt = now();
  if (O.instant(observedAt, 'review end') > deadline) refuse('stale review; the S4 observation window has expired, observe the provider again');
  const receipt = {
    schemaVersion: 1, kind: RECEIPT_KIND, authority: AUTHORITY, reviewLevel: 'A-structural', providerComplete: false, releaseAuthorized: false, provenance,
    environment: ENVIRONMENTS[project], projectId: project, projectNumber: PROJECT_NUMBERS[project], region: REGION,
    s4ObservationFingerprint: fingerprint(observation), s4StartedAt: observation.startedAt, s4ObservedAt: observation.observedAt,
    deploymentPlanSha256: deploymentPlan.object.sha256, expectedAccessSha256: expected.object.sha256, startedAt, observedAt, sources: [...SOURCES],
    inheritedIam: { status: 'unresolved', reason: UNRESOLVED.inheritedIam }, routes: routesSection(localHostingConfig), endpoints,
  };
  structural(S.receipt, receipt, 'access review receipt');
  return { receipt, bytes: Buffer.from(canonicalJSON(receipt), 'utf8') };
}

/** The ContentObjectV1 address of receipt bytes at a caller-chosen storage location. */
function receiptContentObject(bytes, { bucket, object, generation }) {
  const address = { bucket, object, generation, sha256: K.sha256Bytes(bytes) };
  structural(S.contentObject, address, 'access review receipt content object');
  return address;
}

/** Verifies receipt bytes and re-applies every rule against the S4 observation, both plans and the local Hosting file. */
function assertAccessReview(receiptObject, receiptBytes, { project, observation, deploymentPlan, expected, hostingRoot = REPOSITORY_ROOT, now = new Date().toISOString() } = {}) {
  const receipt = readCanonical(receiptObject, receiptBytes, S.receipt, 'access review receipt');
  identity(receipt, project, 'access review receipt');
  if (receipt.authority !== AUTHORITY || canonicalJSON(receipt.sources) !== canonicalJSON(SOURCES)) refuse('access review receipt authority or sources altered');
  if (canonicalJSON(receipt.inheritedIam) !== canonicalJSON({ status: 'unresolved', reason: UNRESOLVED.inheritedIam })) refuse('access review receipt inheritance status altered');
  if (receipt.s4ObservationFingerprint !== fingerprint(observation) || receipt.s4StartedAt !== observation.startedAt || receipt.s4ObservedAt !== observation.observedAt) {
    refuse('access review receipt is not bound to this S4 observation');
  }
  const s4Start = O.instant(observation.startedAt, 'S4 observation start'), start = O.instant(receipt.startedAt, 'review start');
  const end = O.instant(receipt.observedAt, 'review end'), current = O.instant(now, 'current');
  O.assertA3Observation(observation, project, receipt.startedAt);
  if (start < O.instant(observation.observedAt, 'S4 observation end') || start > end || end > current) refuse('access review receipt window is inconsistent');
  if (current - s4Start > BigInt(MAX_AGE_MS) * 1000000n) refuse('stale access review; observe the provider again');
  const plan = readPlans(project, observation, deploymentPlan, expected, now);
  if (receipt.deploymentPlanSha256 !== deploymentPlan.object.sha256) refuse('access review receipt is not bound to this deployment plan');
  if (receipt.expectedAccessSha256 !== expected.object.sha256) refuse('access review receipt is not bound to this expected-access plan');
  // The local Hosting claim must be exactly what checking the real file yields now.
  if (canonicalJSON(receipt.routes) !== canonicalJSON(routesSection(checkLocalHosting(project, hostingRoot)))) refuse('access review receipt route evidence or local Hosting binding altered');
  receipt.endpoints.forEach((entry, i) => evaluateEndpoint(entry, observation.endpoints[i], plan.endpoints[i], project));
  return Object.freeze({ reviewLevel: receipt.reviewLevel, providerComplete: false, releaseAuthorized: false, unresolved: Object.freeze(unresolvedSurfaces()), receipt });
}

function unresolvedSurfaces() {
  return ['inheritedIam', 'routes.hostingReleases', 'routes.domainMappings', 'routes.loadBalancerBackends'];
}
/**
 * Level B gate (F1). S5 v1 cannot observe inherited IAM, deployed Hosting,
 * domain mappings or load balancer backends, so no input can establish
 * provider completeness: this refuses for every argument, and never reads
 * caller-controlled completeness, provenance or status fields.
 */
function assertProviderCompleteAccessReview() {
  refuse(`access review is not provider-complete (G3 open); S5 v1 cannot observe: ${unresolvedSurfaces().join(', ')}`);
}

/**
 * Composes A3-1 cloud endpoint configurations (InvocationAccessV1 added) from a
 * verified receipt. Structural composition only: the result is level A and
 * never release-eligible on its own.
 */
function composeEndpoints(receiptObject, receiptBytes, context) {
  const verified = assertAccessReview(receiptObject, receiptBytes, context);
  const endpoints = context.observation.endpoints.map(({ configuration }, i) => {
    const entry = verified.receipt.endpoints[i];
    const invocation = { ...entry.access, functionAllowPolicy: entry.functionPolicy.policy, serviceAllowPolicy: entry.servicePolicy.policy, accessReviewReceipt: receiptObject };
    const composed = { ...configuration, invocation };
    const result = V.validateEndpoint(composed);
    if (!result.ok) refuse(`${configuration.endpointName} composed configuration fails A3-1 validation: ${result.issue?.path} ${result.issue?.reason}`);
    return composed;
  });
  return { reviewLevel: verified.reviewLevel, providerComplete: false, releaseAuthorized: false, unresolved: verified.unresolved, endpoints };
}

module.exports = { EXPECTED_KIND, RECEIPT_KIND, SOURCES, UNRESOLVED, HOSTING_CONFIG, READS_PER_ENDPOINT, normalizePolicy, readExpectedAccess,
  localHostingExposure, checkLocalHosting, reviewA3Access, receiptContentObject, assertAccessReview, assertProviderCompleteAccessReview,
  composeEndpoints, unresolvedSurfaces };
