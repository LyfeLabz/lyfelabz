import { createHash } from "node:crypto";

import { PlatformError } from "../shared/errors/platform-error";

// Request parsing for the resource-evidence services (RA-3A). Every request
// is untrusted. Shapes are exact: any extra key is refused, so a client
// cannot name a student, teacher, class, resource, revision, definition
// version, validator, outcome, mission, eligibility, or timestamp. The
// assignment id is only a lookup key; entitlement is resolved server side.

export const EVIDENCE_REQUEST_LIMITS = Object.freeze({
  // Serialized request size, checked before any structural parse.
  maxGetRequestBytes: 1024,
  maxSubmitRequestBytes: 1024,
  maxRecordRunRequestBytes: 4 * 1024,
  maxSaveRequestBytes: 300 * 1024,
  // Canonical working evidence (authored text + attestations). Matches the
  // lab-report ceiling and keeps a record far below the 1 MiB document limit.
  maxWorkingBytes: 256 * 1024,
});

const ASSIGNMENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
// Same token grammar as `labReportsSave.saveId`.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_REVISION = Number.MAX_SAFE_INTEGER - 1;

function invalid(message: string): never {
  throw new PlatformError("resourceEvidence.invalidRequest", message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

// Canonical JSON: object keys sorted at every level, arrays in order. Used
// for storage equality and operation hashing. Refuses values JSON cannot
// represent faithfully (undefined, functions, non-finite numbers).
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) invalid("Request contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  return invalid("Request contains a value that is not plain JSON.");
}

export function payloadHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function requestObject(data: unknown, maxBytes: number, keys: readonly string[]): Record<string, unknown> {
  if (!isPlainObject(data)) invalid("Request payload must be an object.");
  // Size before structure: a huge payload is refused without walking it.
  let size: number;
  try {
    size = Buffer.byteLength(JSON.stringify(data), "utf8");
  } catch {
    return invalid("Request payload is not serializable.");
  }
  if (size > maxBytes) invalid("Request payload is too large.");
  const own = Object.keys(data);
  for (const key of own) {
    if (!keys.includes(key)) invalid(`Field "${key}" is not permitted on the request.`);
  }
  for (const key of keys) {
    if (!(key in data)) invalid(`Field "${key}" is required.`);
  }
  return data;
}

function readAssignmentId(value: unknown): string {
  if (typeof value !== "string" || !ASSIGNMENT_ID_PATTERN.test(value)) {
    invalid("assignmentId must be a URL-safe token.");
  }
  return value;
}

function readToken(value: unknown, field: string): string {
  if (typeof value !== "string" || !TOKEN_PATTERN.test(value)) {
    invalid(`${field} must be a URL-safe token of 8 to 64 characters.`);
  }
  return value;
}

function readRevision(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_REVISION) {
    invalid(`${field} must be a non-negative integer.`);
  }
  return value;
}

export type GetEvidenceRequest = { readonly assignmentId: string };

export function parseGetEvidenceRequest(data: unknown): GetEvidenceRequest {
  const p = requestObject(data, EVIDENCE_REQUEST_LIMITS.maxGetRequestBytes, ["assignmentId"]);
  return { assignmentId: readAssignmentId(p.assignmentId) };
}

// Working evidence is `{ authored, attestations }` only. Its items are
// validated against the frozen definition by RA-2 `parseResourceEvidence`
// in the service, not here.
export type SaveWorkingEvidenceRequest = {
  readonly assignmentId: string;
  readonly operationId: string;
  readonly expectedWorkingRevision: number;
  readonly working: { readonly authored: unknown; readonly attestations: unknown };
};

export function parseSaveWorkingEvidenceRequest(data: unknown): SaveWorkingEvidenceRequest {
  const p = requestObject(data, EVIDENCE_REQUEST_LIMITS.maxSaveRequestBytes, [
    "assignmentId",
    "operationId",
    "expectedWorkingRevision",
    "working",
  ]);
  const working = p.working;
  if (!isPlainObject(working)) invalid("working must be an object.");
  const keys = Object.keys(working);
  if (keys.length !== 2 || !keys.includes("authored") || !keys.includes("attestations")) {
    invalid("working must contain exactly authored and attestations.");
  }
  if (!Array.isArray(working.authored) || !Array.isArray(working.attestations)) {
    invalid("working.authored and working.attestations must be arrays.");
  }
  return {
    assignmentId: readAssignmentId(p.assignmentId),
    operationId: readToken(p.operationId, "operationId"),
    expectedWorkingRevision: readRevision(p.expectedWorkingRevision, "expectedWorkingRevision"),
    working: { authored: working.authored, attestations: working.attestations },
  };
}

// One run per request. The client sends only the run parameters; the
// validator id and version come from the frozen definition.
export type RecordOutcomeRunRequest = {
  readonly assignmentId: string;
  readonly operationId: string;
  readonly flightId: string;
  readonly parameters: unknown;
};

export function parseRecordOutcomeRunRequest(data: unknown): RecordOutcomeRunRequest {
  const p = requestObject(data, EVIDENCE_REQUEST_LIMITS.maxRecordRunRequestBytes, [
    "assignmentId",
    "operationId",
    "flightId",
    "parameters",
  ]);
  return {
    assignmentId: readAssignmentId(p.assignmentId),
    operationId: readToken(p.operationId, "operationId"),
    flightId: readToken(p.flightId, "flightId"),
    parameters: p.parameters,
  };
}

export type SubmitEvidenceRequest = {
  readonly assignmentId: string;
  readonly operationId: string;
  readonly expectedWorkingRevision: number;
  readonly expectedRunsRevision: number;
};

export function parseSubmitEvidenceRequest(data: unknown): SubmitEvidenceRequest {
  const p = requestObject(data, EVIDENCE_REQUEST_LIMITS.maxSubmitRequestBytes, [
    "assignmentId",
    "operationId",
    "expectedWorkingRevision",
    "expectedRunsRevision",
  ]);
  return {
    assignmentId: readAssignmentId(p.assignmentId),
    operationId: readToken(p.operationId, "operationId"),
    expectedWorkingRevision: readRevision(p.expectedWorkingRevision, "expectedWorkingRevision"),
    expectedRunsRevision: readRevision(p.expectedRunsRevision, "expectedRunsRevision"),
  };
}
