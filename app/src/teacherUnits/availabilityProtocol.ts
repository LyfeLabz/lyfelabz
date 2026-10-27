/** Option B standalone v3 protocol. Parsing is consistency only, never authorization.
 * Frozen A3 wire formats are handled exclusively by the historical modules. */
export type Environment = "production" | "staging" | "emulator";
export type MutationCompatibilityV2 = {
  schemaVersion: 2; clientContractVersion: "teacher-units-v3";
  policyInstanceId: string; policyGeneration: number;
  backendReleaseId: string; placementFingerprint: string;
};
export type CapabilityRequestV3 = {
  schemaVersion: 3; nonce: string; clientContractVersion: "teacher-units-v3";
};
export type CapabilityResponseV3 = {
  schemaVersion: 3; nonce: string;
  backend: { projectId: string; environment: Environment; region: "us-central1";
    enforcementVersion: "teacher-units-option-b-v1"; backendBuildId: string };
  teacherUnits: {
    apiContractVersion: "teacher-units-v3";
    supportedOperations: ["create", "list", "get", "update", "archive", "restore", "setResources", "reorder"];
    supportedClientContractVersions: ["teacher-units-v3"];
    acceptedClientContractVersions: [] | ["teacher-units-v3"];
    placementFingerprint: string;
    availability: { state: "closed" | "enabled" | "unverified";
      policyInstanceId: string | null; policyGeneration: number | null;
      /** Policy approvedBackendBuildId, not a legacy release-manifest digest. */
      backendReleaseId: string | null; deploymentEligible: boolean };
  };
  caller: { uid: string; role: "teacher"; schoolId: string; districtId: string };
};
export type StructuralResult<T> =
  | { ok: true; value: T; scope: "structure-only"; operationalVerification: "unverified" }
  | { ok: false; issue: { path: string; reason: string }; scope: "structure-only";
      operationalVerification: "unverified" };
export class AvailabilityValidationError extends Error {
  constructor(readonly path: string, readonly reason: string) { super(`${path}: ${reason}`); }
}
export type Rule = (value: unknown, path: string) => void;
export const refuse: (path: string, reason: string) => never = (path, reason) => { throw new AvailabilityValidationError(path, reason); };
export function plainRecord(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    return refuse(path, "plain record required");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(value).length !== Object.keys(descriptors).length ||
      Object.values(descriptors).some(d => !d.enumerable || !Object.hasOwn(d, "value")))
    return refuse(path, "accessors, symbols and hidden fields prohibited");
  return value as Record<string, unknown>;
}
export function object(fields: Record<string, Rule>): Rule {
  return (value, path) => {
    const record = plainRecord(value, path);
    if (Object.keys(record).length !== Object.keys(fields).length ||
        Object.keys(record).some(k => !Object.hasOwn(fields, k))) refuse(path, "exact fields required");
    for (const [key, rule] of Object.entries(fields)) {
      if (!Object.hasOwn(record, key)) refuse(`${path}.${key}`, "missing field");
      rule(record[key], `${path}.${key}`);
    }
  };
}
export const literal = (...values: unknown[]): Rule => (value, path) => {
  if (!values.some(v => v === value)) refuse(path, "unsupported value");
};
export const stringRule: Rule = (value, path) => {
  if (typeof value !== "string" || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value))
    refuse(path, "well-formed Unicode string required");
};
export const text: Rule = (value, path) => { stringRule(value, path); if (value === "") refuse(path, "nonempty string required"); };
export const pattern = (regex: RegExp): Rule => (value, path) => {
  stringRule(value, path); if (!regex.test(value as string)) refuse(path, "noncanonical string");
};
export const digest = pattern(/^[a-f0-9]{64}$/);
export const uuid = pattern(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
export const integer = (minimum: number, maximum = Number.MAX_SAFE_INTEGER): Rule => (value, path) => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || Object.is(value, -0) || value < minimum || value > maximum)
    refuse(path, "safe integer out of range");
};
export const generation = integer(1);
export const nullable = (rule: Rule): Rule => (value, path) => { if (value !== null) rule(value, path); };
export function array(rule: Rule, ordering?: (value: unknown) => string): Rule {
  return (value, path) => {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || Object.keys(value).length !== value.length ||
        Reflect.ownKeys(value).length !== value.length + 1) refuse(path, "dense array required");
    let previous: string | undefined;
    for (let i = 0; i < value.length; i++) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(i));
      if (!descriptor || !Object.hasOwn(descriptor, "value")) refuse(path, "array accessors prohibited");
      const item: unknown = descriptor.value;
      rule(item, `${path}[${i}]`);
      if (ordering) {
        const current = ordering(item);
        if (previous !== undefined && previous >= current) refuse(path, "canonical unique ordering required");
        previous = current;
      }
    }
  };
}
export const tuple = (...rules: Rule[]): Rule => (value, path) => {
  array((v, p) => { const i = Number(p.slice(p.lastIndexOf("[") + 1, -1)); rules[i]?.(v, p); })(value, path);
  if ((value as unknown[]).length !== rules.length) refuse(path, "exact tuple required");
};
/** Descriptor-only detached data. Refuses getters, hidden/symbol fields, sparse
 * arrays, custom classes and cycles before the version-specific parser runs. */
export function snapshotProtocolData(value: unknown, depth = 0, active = new Set<object>()): unknown {
  if (depth > 16) return refuse("$", "input nesting limit exceeded");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") { stringRule(value, "$"); return value; }
  if (typeof value === "number") { integer(-Number.MAX_SAFE_INTEGER)(value, "$"); return value; }
  if (typeof value !== "object" || active.has(value)) return refuse("$", "acyclic data required");
  const isArray = Array.isArray(value);
  if (isArray) array(() => undefined)(value, "$"); else plainRecord(value, "$");
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Object.keys(descriptors).filter(k => !(isArray && k === "length"));
  if (keys.length > 64) return refuse("$", "field limit exceeded");
  active.add(value);
  try {
    if (isArray) return Object.freeze(keys.map(k => snapshotProtocolData(descriptors[k].value, depth + 1, active)));
    return Object.freeze(Object.fromEntries(keys.map(k => {
      stringRule(k, "$");
      return [k, snapshotProtocolData(descriptors[k].value, depth + 1, active)];
    })));
  } finally { active.delete(value); }
}
export function validate<T>(rule: Rule, value: unknown): StructuralResult<T> {
  try { value = snapshotProtocolData(value); rule(value, "$" ); return Object.freeze({ ok: true, value: value as T, scope: "structure-only", operationalVerification: "unverified" }); }
  catch (error) {
    return Object.freeze({ ok: false, issue: error instanceof AvailabilityValidationError
      ? { path: error.path, reason: error.reason } : { path: "$", reason: "unreadable input" },
    scope: "structure-only", operationalVerification: "unverified" });
  }
}
export function checkProtocolProject(projectId: string, environment: Environment, expectedEmulatorProjectId?: string): void {
  if ((environment === "production" && projectId !== "lyfelabz-prod") ||
      (environment === "staging" && projectId !== "lyfelabz-staging") ||
      (environment === "emulator" && (!expectedEmulatorProjectId || !/^demo-[a-z0-9-]+$/.test(expectedEmulatorProjectId) || projectId !== expectedEmulatorProjectId)))
    refuse("$.backend", "project/environment mismatch or untrusted emulator profile");
}
const contract = literal("teacher-units-v3");
export const compatibilityRule = object({ schemaVersion: literal(2), clientContractVersion: contract,
  policyInstanceId: uuid, policyGeneration: generation, backendReleaseId: digest, placementFingerprint: digest });
export const capabilityRequestRule = object({ schemaVersion: literal(3), nonce: pattern(/^[A-Za-z0-9_-]{16,64}$/), clientContractVersion: contract });
const versions = tuple(contract);
const responseRule = object({ schemaVersion: literal(3), nonce: pattern(/^[A-Za-z0-9_-]{16,64}$/),
  backend: object({ projectId: pattern(/^[a-z][a-z0-9-]*$/), environment: literal("production", "staging", "emulator"), region: literal("us-central1"), enforcementVersion: literal("teacher-units-option-b-v1"), backendBuildId: digest }),
  teacherUnits: object({ apiContractVersion: contract,
    supportedOperations: tuple(...["create", "list", "get", "update", "archive", "restore", "setResources", "reorder"].map(v => literal(v))),
    supportedClientContractVersions: versions,
    acceptedClientContractVersions: (v, p) => { if (Array.isArray(v) && v.length === 0) tuple()(v, p); else versions(v, p); },
    placementFingerprint: digest,
    availability: object({ state: literal("closed", "enabled", "unverified"), policyInstanceId: nullable(uuid),
      policyGeneration: nullable(generation), backendReleaseId: nullable(digest), deploymentEligible: literal(true, false) }) }),
  caller: object({ uid: text, role: literal("teacher"), schoolId: text, districtId: text }) });
export const validateMutationCompatibility = (value: unknown): StructuralResult<MutationCompatibilityV2> => validate(compatibilityRule, value);
export const validateCapabilityRequest = (value: unknown): StructuralResult<CapabilityRequestV3> => validate(capabilityRequestRule, value);
export function validateCapabilityResponse(value: unknown, expectedEmulatorProjectId?: string): StructuralResult<CapabilityResponseV3> {
  return validate((v, p) => {
    responseRule(v, p);
    const response = v as CapabilityResponseV3;
    checkProtocolProject(response.backend.projectId, response.backend.environment, expectedEmulatorProjectId);
    const { availability: a, acceptedClientContractVersions: accepted } = response.teacherUnits;
    if ((a.policyInstanceId === null) !== (a.policyGeneration === null)) refuse(p, "partial policy identity");
    if (a.state === "enabled" && (!a.deploymentEligible || !a.policyInstanceId || !a.policyGeneration || !a.backendReleaseId || a.backendReleaseId !== response.backend.backendBuildId || accepted.length !== 1)) refuse(p, "contradictory enabled declaration");
    if (a.state !== "enabled" && accepted.length !== 0) refuse(p, "closed/unverified cannot accept contracts");
    if (a.state === "closed" && (!a.policyInstanceId || !a.policyGeneration)) refuse(p, "closed policy identity required");
    if (a.state === "unverified" && (a.deploymentEligible || (a.policyInstanceId === null && a.backendReleaseId !== null))) refuse(p, "contradictory unverified declaration");
  }, value);
}
