/** Option B B1a: pure, unwired contracts. No metadata, authentication, I/O,
 * clock, randomness, persistence, audit writer or callable integration.
 * Supplied identity/build/approval data is never independently authenticated.
 * Concrete Timestamp proposals model stored values, not server write sentinels. */
import { Timestamp } from "firebase-admin/firestore";
import {
  array, digest, generation, integer, literal, nullable, object, pattern,
  plainRecord, refuse, stringRule, tuple, uuid, validate,
} from "./a3-protocol";
import type { Rule, StructuralResult } from "./a3-protocol";

export const AVAILABILITY_POLICY_PATH = "platformConfig/teacherUnitsAvailability";
export const AVAILABILITY_ENFORCEMENT_VERSION = "teacher-units-option-b-v1";
export const AVAILABILITY_CLIENT_CONTRACT = "teacher-units-v3";

export type AvailabilityIdentity = Readonly<{
  environment: "production" | "staging" | "emulator";
  projectId: string;
  projectNumber: string;
  region: "us-central1";
  databaseId: "(default)";
}>;
export type AvailabilityOperator = Readonly<{
  principalSubject: string;
  credentialSubject: string;
  delegationSubject: string | null;
}>;
export type AvailabilityPolicy = AvailabilityIdentity & Readonly<{
  schemaVersion: 2;
  enforcementVersion: "teacher-units-option-b-v1";
  policyInstanceId: string;
  generation: number;
  mode: "closed" | "enabled";
  approvedBackendBuildId: string | null;
  acceptedClientContractVersions: readonly [] | readonly ["teacher-units-v3"];
  placementFingerprint: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  updatedBy: AvailabilityOperator;
  transitionId: string;
  reason: string;
  approvalRef: string | null;
  lastEnabledAt: Timestamp | null;
  lastClosedAt: Timestamp;
}>;
/** Expectations must come from the future server resolver/build inspector.
 * This type and its validator do not resolve or authenticate those inputs. */
export type AvailabilityRuntime = Readonly<{
  identity: AvailabilityIdentity;
  identityCurrent: boolean;
  backendBuildId: string;
  deploymentMode: "closed-only" | "policy-controlled";
  sourceDirty: boolean;
  clientContractVersion: "teacher-units-v3";
  placementFingerprint: string;
}>;
export type AvailabilityCas = Readonly<{
  updateTime: Timestamp | null;
  policyInstanceId: string | null;
  generation: number | null;
}>;
export type AvailabilityTransition = "initialize" | "prepare" | "enable" | "close" | "recoverClosed";
/** An explicit, structurally checked repair decision supplied by a trusted
 * future caller. It is NOT proof that a human authorized a database write. */
export type ClosedRecoveryAuthorization = Readonly<{
  action: "recoverClosed";
  decisionRef: string;
  target: AvailabilityIdentity;
  expected: AvailabilityCas;
  replacementPolicyInstanceId: string;
  placementFingerprint: string;
  operator: AvailabilityOperator;
  reason: string;
}>;
export type AvailabilityTransitionInput = Readonly<{
  transition: AvailabilityTransition;
  previous: unknown;
  observedUpdateTime: Timestamp | null;
  expected: AvailabilityCas;
  next: unknown;
  recoveryAuthorization: ClosedRecoveryAuthorization | null;
}>;
export type ObservedPolicyMode = "missing" | "invalid" | "closed" | "enabled" | "unconfirmed";
export type AvailabilityTransitionResult = StructuralResult<Readonly<{
  transition: AvailabilityTransition;
  kind: "change" | "noop";
  nextPolicy: AvailabilityPolicy;
}>> & Readonly<{
  persistence: "not-performed";
  shutdownConfirmed: false;
  observedPolicyMode: ObservedPolicyMode;
  recoveryRequired: boolean;
}>;
export type AvailabilityEligibility = Readonly<{
  eligible: boolean;
  reason: "policyMissing" | "policyInvalid" | "runtimeInvalid" | "availabilityClosed" |
    "deploymentIneligible" | "matchedSuppliedInputs";
  scope: "supplied-inputs-only";
  operationalVerification: "unverified";
}>;

const identityFields = {
  environment: literal("production", "staging", "emulator"),
  projectId: pattern(/^[a-z][a-z0-9-]*$/),
  projectNumber: pattern(/^(?:0|[1-9][0-9]*)$/),
  region: literal("us-central1"), databaseId: literal("(default)"),
};
const identityRule = object(identityFields);
const boundedText = (maximum: number, trimmed: boolean): Rule => (v, p) => {
  stringRule(v, p);
  const s = v as string;
  // eslint-disable-next-line no-control-regex
  if (!s.trim() || [...s].length > maximum || /[\u0000-\u001f\u007f]/.test(s) ||
      (trimmed && s.trim() !== s)) refuse(p, "nonempty bounded text without controls required");
};
const subject = boundedText(256, false), reason = boundedText(1000, true), approval = boundedText(256, true);
const operatorRule = object({ principalSubject: subject, credentialSubject: subject, delegationSubject: nullable(subject) });
const timestampRule: Rule = (v, p) => {
  if (!(v instanceof Timestamp) || Object.getPrototypeOf(v) !== Timestamp.prototype) refuse(p, "SDK Timestamp required");
  const ts = v;
  integer(-62135596800, 253402300799)(ts.seconds, p);
  integer(0, 999999999)(ts.nanoseconds, p);
};
const casRule = object({ updateTime: nullable(timestampRule), policyInstanceId: nullable(uuid), generation: nullable(generation) });
const policyRule = object({
  ...identityFields, schemaVersion: literal(2), enforcementVersion: literal(AVAILABILITY_ENFORCEMENT_VERSION),
  policyInstanceId: uuid, generation, mode: literal("closed", "enabled"), approvedBackendBuildId: nullable(digest),
  acceptedClientContractVersions: array(literal(AVAILABILITY_CLIENT_CONTRACT)), placementFingerprint: digest,
  createdAt: timestampRule, updatedAt: timestampRule, updatedBy: operatorRule,
  transitionId: uuid, reason, approvalRef: nullable(approval),
  lastEnabledAt: nullable(timestampRule), lastClosedAt: timestampRule,
});
const runtimeRule = object({ identity: identityRule, identityCurrent: literal(true, false), backendBuildId: digest,
  deploymentMode: literal("closed-only", "policy-controlled"), sourceDirty: literal(true, false),
  clientContractVersion: literal(AVAILABILITY_CLIENT_CONTRACT), placementFingerprint: digest });
const recoveryRule = object({ action: literal("recoverClosed"), decisionRef: approval, target: identityRule,
  expected: casRule, replacementPolicyInstanceId: uuid, placementFingerprint: digest,
  operator: operatorRule, reason });
const identityKeys = ["environment", "projectId", "projectNumber", "region", "databaseId"] as const;

/** Read data descriptors once into a detached immutable snapshot, so successful
 * parsing never returns caller-owned mutable state. No getters/toJSON invoked.
 * SDK timestamps are the sole admitted class, copied at nanosecond precision. */
function snapshot(value: unknown, path = "$", ancestors = new Set<object>(), depth = 0): unknown {
  if (depth > 16) return refuse(path, "input nesting limit exceeded");
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value;
  if (typeof value !== "object") return refuse(path, "data value required");
  if (ancestors.has(value)) return refuse(path, "cyclic input prohibited");
  const proto: unknown = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(k => typeof k !== "string")) return refuse(path, "symbol fields prohibited");
  if (proto === Timestamp.prototype) {
    if (keys.length !== 2 || !Object.hasOwn(descriptors, "_seconds") || !Object.hasOwn(descriptors, "_nanoseconds"))
      return refuse(path, "unexpected SDK Timestamp fields");
    for (const key of ["_seconds", "_nanoseconds"]) {
      const d = descriptors[key];
      if (!d.enumerable || !Object.hasOwn(d, "value")) return refuse(path, "Timestamp accessors prohibited");
    }
    const seconds: unknown = descriptors._seconds.value, nanos: unknown = descriptors._nanoseconds.value;
    integer(-62135596800, 253402300799)(seconds, path);
    integer(0, 999999999)(nanos, path);
    return Object.freeze(new Timestamp(seconds as number, nanos as number));
  }
  const isArray = Array.isArray(value);
  if (isArray ? proto !== Array.prototype : proto !== Object.prototype && proto !== null)
    return refuse(path, "plain record or dense array required");
  ancestors.add(value);
  try {
    if (isArray) {
      const length: unknown = descriptors.length?.value;
      integer(0, 64)(length, path);
      if (keys.length !== (length as number) + 1) return refuse(path, "dense array without extra fields required");
      const result: unknown[] = [];
      for (let i = 0; i < (length as number); i++) {
        const d = descriptors[String(i)];
        if (!d || !d.enumerable || !Object.hasOwn(d, "value")) return refuse(path, "array accessors/holes prohibited");
        result.push(snapshot(d.value, `${path}[${i}]`, ancestors, depth + 1));
      }
      return Object.freeze(result);
    }
    if (keys.length > 64) return refuse(path, "record field limit exceeded");
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const d = descriptors[key];
      if (!d.enumerable || !Object.hasOwn(d, "value")) return refuse(path, "accessors/hidden fields prohibited");
      result[key] = snapshot(d.value, `${path}.${key}`, ancestors, depth + 1);
    }
    return Object.freeze(result);
  } finally { ancestors.delete(value); }
}
function check<T>(value: unknown, rule: Rule): StructuralResult<T> {
  try { return validate<T>(rule, snapshot(value)); }
  catch (err) { return validate<T>(() => { throw err; }, undefined); }
}
function checked<T>(result: StructuralResult<T>): T {
  if (!result.ok) return refuse(result.issue.path, result.issue.reason);
  return result.value;
}
function target(value: unknown): AvailabilityIdentity {
  const result = checked(check<AvailabilityIdentity>(value, identityRule));
  const pin = result.environment === "production" ? ["lyfelabz-prod", "182791689935"] :
    result.environment === "staging" ? ["lyfelabz-staging", "293337283840"] : null;
  if (pin ? result.projectId !== pin[0] || result.projectNumber !== pin[1] :
    result.projectNumber !== "0" || !/^demo-[a-z0-9-]+$/.test(result.projectId))
    return refuse("$.identity", "project/environment binding mismatch");
  return result;
}
function sameIdentity(a: AvailabilityIdentity, b: AvailabilityIdentity): boolean {
  return identityKeys.every(key => a[key] === b[key]);
}
function compare(a: Timestamp, b: Timestamp): number {
  return a.seconds === b.seconds ? a.nanoseconds - b.nanoseconds : a.seconds - b.seconds;
}
function equal(a: unknown, b: unknown): boolean {
  if (a instanceof Timestamp && b instanceof Timestamp) return compare(a, b) === 0;
  if (a === null || b === null || typeof a !== "object" || typeof b !== "object") return a === b;
  const ak = Object.keys(a), bk = Object.keys(b);
  return ak.length === bk.length && ak.every(k => Object.hasOwn(b, k) &&
    equal((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function validateAvailabilityPolicy(value: unknown, expectedIdentity: unknown): StructuralResult<AvailabilityPolicy> {
  return check<AvailabilityPolicy>(value, (v, p) => {
    const expected = target(expectedIdentity);
    policyRule(v, p);
    const policy = v as AvailabilityPolicy;
    if (!sameIdentity(target(policyIdentity(policy)), expected)) refuse(p, "expected target mismatch");
    if (policy.mode === "closed") tuple()(policy.acceptedClientContractVersions, p);
    else {
      tuple(literal(AVAILABILITY_CLIENT_CONTRACT))(policy.acceptedClientContractVersions, p);
      if (policy.approvedBackendBuildId === null || policy.approvalRef === null || policy.lastEnabledAt === null ||
          compare(policy.lastEnabledAt, policy.updatedAt) !== 0) refuse(p, "enabled build/approval/transition timestamp required");
    }
    if (compare(policy.createdAt, policy.updatedAt) > 0 || compare(policy.lastClosedAt, policy.createdAt) < 0 ||
        compare(policy.lastClosedAt, policy.updatedAt) > 0) refuse(p, "invalid policy chronology");
    if (policy.lastEnabledAt !== null) {
      if (compare(policy.lastEnabledAt, policy.createdAt) < 0 || compare(policy.lastEnabledAt, policy.updatedAt) > 0 ||
          (policy.mode === "closed" ? compare(policy.lastEnabledAt, policy.lastClosedAt) >= 0 :
            compare(policy.lastClosedAt, policy.lastEnabledAt) >= 0)) refuse(p, "invalid enable/close chronology");
    }
  });
}
function policyIdentity(p: AvailabilityPolicy): AvailabilityIdentity {
  return { environment: p.environment, projectId: p.projectId, projectNumber: p.projectNumber,
    region: p.region, databaseId: p.databaseId };
}

/** Consistency of supplied inputs only, never teacher authorization, provider
 * verification or an authority to execute. Future transactions must revalidate. */
export function evaluateAvailabilityEligibility(policy: unknown, runtime: unknown): AvailabilityEligibility {
  const result = (eligible: boolean, why: AvailabilityEligibility["reason"]): AvailabilityEligibility =>
    Object.freeze({ eligible, reason: why, scope: "supplied-inputs-only", operationalVerification: "unverified" });
  const parsedRuntime = check<AvailabilityRuntime>(runtime, runtimeRule);
  if (!parsedRuntime.ok) return result(false, "runtimeInvalid");
  const context = parsedRuntime.value;
  const parsed = validateAvailabilityPolicy(policy, context.identity);
  if (!parsed.ok) return result(false, policy === null || policy === undefined ? "policyMissing" : "policyInvalid");
  const p = parsed.value;
  if (p.mode === "closed") return result(false, "availabilityClosed");
  if (!context.identityCurrent || context.deploymentMode !== "policy-controlled" || context.sourceDirty ||
      context.backendBuildId !== p.approvedBackendBuildId || context.placementFingerprint !== p.placementFingerprint)
    return result(false, "deploymentIneligible");
  return result(true, "matchedSuppliedInputs");
}

/** Validate a concrete post-commit-shaped proposal. Always returns
 * persistence=not-performed and shutdownConfirmed=false, including no-ops.
 * CAS compares supplied snapshot metadata, not a live document. The future
 * writer must repeat it in its transaction and reconcile commit/readback. */
export function validateAvailabilityTransition(input: unknown, expectedIdentity: unknown): AvailabilityTransitionResult {
  let observedPolicyMode: ObservedPolicyMode = "unconfirmed";
  let recoveryRequired = false;
  const parsed = check<AvailabilityTransitionInput>(input, () => undefined);
  // Parse the input separately; never expose that intermediate snapshot as a proposal.
  const result = validate<void>(() => {
    if (!parsed.ok) return refuse(parsed.issue.path, parsed.issue.reason);
    const raw: unknown = parsed.value;
    object({ transition: literal("initialize", "prepare", "enable", "close", "recoverClosed"),
      previous: () => undefined, observedUpdateTime: nullable(timestampRule), expected: casRule,
      next: () => undefined, recoveryAuthorization: nullable(recoveryRule) })(raw, "$");
    const r = raw as AvailabilityTransitionInput;
    const expected = target(expectedIdentity);
    const absent = r.previous === null;
    const beforeResult = validateAvailabilityPolicy(r.previous, expected);
    const before = beforeResult.ok ? beforeResult.value : null;
    observedPolicyMode = absent ? "missing" : before?.mode ?? "invalid";
    if ((absent && r.observedUpdateTime !== null) || (!absent && r.observedUpdateTime === null))
      refuse("$.observedUpdateTime", "snapshot existence/updateTime mismatch");
    const actualCas: AvailabilityCas = { updateTime: r.observedUpdateTime,
      policyInstanceId: before?.policyInstanceId ?? null, generation: before?.generation ?? null };
    if (!equal(actualCas, r.expected)) refuse("$.expected", "stale compare-and-set preconditions");
    if (r.transition !== "recoverClosed" && r.recoveryAuthorization !== null)
      refuse("$.recoveryAuthorization", "repair authorization only applies to recoverClosed");
    if (r.transition !== "initialize" && r.transition !== "recoverClosed" && before === null)
      refuse("$.previous", absent ? "policy missing" : "policy invalid; separate closed recovery required");
    if (before !== null && before.generation === Number.MAX_SAFE_INTEGER &&
        r.transition !== "recoverClosed" && r.transition !== "initialize" &&
        !(r.transition === "close" && before.mode === "closed")) {
      recoveryRequired = true;
      refuse("$.previous.generation", before.mode === "enabled" ? "still enabled; recovery required" : "generation exhausted; closed recovery required");
    }
    const next = checked(validateAvailabilityPolicy(r.next, expected));
    if (r.transition === "initialize" || r.transition === "recoverClosed") {
      if (r.transition === "initialize" ? !absent : absent) refuse("$.previous", "wrong initialization/recovery existence");
      if (next.generation !== 1 || next.mode !== "closed" || next.approvedBackendBuildId !== null ||
          next.lastEnabledAt !== null || !equal(next.createdAt, next.updatedAt) || !equal(next.lastClosedAt, next.updatedAt))
        refuse("$.next", "new instance must be initialized closed, generation one, without build");
      if (r.transition === "recoverClosed") {
        const auth = r.recoveryAuthorization;
        if (auth === null) refuse("$.recoveryAuthorization", "separate explicit closed-recovery decision required");
        const authorization = auth;
        if (!sameIdentity(target(authorization.target), expected) || !equal(authorization.expected, r.expected) ||
            authorization.replacementPolicyInstanceId !== next.policyInstanceId ||
            authorization.placementFingerprint !== next.placementFingerprint || !equal(authorization.operator, next.updatedBy) ||
            authorization.reason !== next.reason || authorization.decisionRef !== next.approvalRef)
          refuse("$.recoveryAuthorization", "repair decision does not bind this exact proposal");
        const old = plainRecord(r.previous, "$.previous");
        if (old.policyInstanceId === next.policyInstanceId || old.transitionId === next.transitionId ||
            (before !== null && (compare(next.updatedAt, before.updatedAt) <= 0 ||
              (before.mode === "enabled" && next.approvalRef === before.approvalRef))))
          refuse("$.next", "recovery requires fresh instance/transition/time and separate approval");
      }
    } else {
      const previous = before as AvailabilityPolicy;
      if (!sameIdentity(previous, next) || previous.policyInstanceId !== next.policyInstanceId ||
          !equal(previous.createdAt, next.createdAt)) refuse("$.next", "ordinary transition changed immutable identity");
      if (r.transition === "close" && previous.mode === "closed") {
        if (!equal(previous, next)) refuse("$.next", "closed close no-op must leave all content unchanged");
      } else {
        if (r.transition === "prepare" && previous.mode === "closed" &&
            previous.approvedBackendBuildId === next.approvedBackendBuildId && previous.placementFingerprint === next.placementFingerprint) {
          if (!equal(previous, next)) refuse("$.next", "unchanged preparation must preserve all content");
        } else {
          if (next.generation !== previous.generation + 1 || next.transitionId === previous.transitionId ||
              compare(next.updatedAt, previous.updatedAt) <= 0) refuse("$.next", "change requires next generation, fresh transition and later timestamp");
          if (r.transition === "prepare") {
            if (previous.mode !== "closed" || next.mode !== "closed" || !equal(previous.lastEnabledAt, next.lastEnabledAt) ||
                !equal(previous.lastClosedAt, next.lastClosedAt)) refuse("$.next", "preparation requires closure and preserved transition times");
          } else if (r.transition === "enable") {
            if (previous.mode !== "closed" || next.mode !== "enabled" || previous.approvedBackendBuildId === null ||
                next.approvedBackendBuildId !== previous.approvedBackendBuildId || next.placementFingerprint !== previous.placementFingerprint ||
                !equal(next.lastClosedAt, previous.lastClosedAt)) refuse("$.next", "enable requires unchanged prepared build/placement and prior close time");
          } else if (next.mode !== "closed" || next.placementFingerprint !== previous.placementFingerprint ||
              (next.approvedBackendBuildId !== null && next.approvedBackendBuildId !== previous.approvedBackendBuildId) ||
              !equal(next.lastEnabledAt, previous.lastEnabledAt) || !equal(next.lastClosedAt, next.updatedAt))
            refuse("$.next", "close must preserve placement/enable time and retain or clear the build");
        }
      }
    }
  }, undefined);
  // The validation callback above intentionally performs no write. Produce a
  // detached proposal only on success; failures never return a replacement.
  if (!result.ok) return Object.freeze({ ...result, persistence: "not-performed", shutdownConfirmed: false,
    observedPolicyMode, recoveryRequired });
  const r = checked(parsed);
  const nextPolicy = checked(validateAvailabilityPolicy(r.next, expectedIdentity));
  return Object.freeze({ ok: true, value: Object.freeze({ transition: r.transition,
    kind: equal(r.previous, nextPolicy) ? "noop" : "change", nextPolicy }), scope: "structure-only",
    operationalVerification: "unverified", persistence: "not-performed", shutdownConfirmed: false,
    observedPolicyMode, recoveryRequired });
}
