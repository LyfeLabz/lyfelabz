import { createHash } from "crypto";

import { assertActivityIdMatchesResourceType } from "../shared/activity-identifiers";
import {
  assessmentIdForLessonSlug,
  parseAssessmentIdFromRevisionId,
  parseRevisionOrdinalFromRevisionId,
} from "../shared/assessment-identifiers";
import { canonicalJson } from "../shared/types/assessment-presentation";
import {
  ASSIGNMENT_COMPLETION_BINDING_SCHEMA_VERSION,
  COMPLETION_DEFINITION_RECORD_SCHEMA_VERSION,
  type AssignmentCompletionBinding,
  type CompletionDefinitionCreationWrite,
  type CompletionValidatorRef,
} from "../shared/types/completion-definition";
import {
  validateCompletionDefinition,
  type CompletionDefinition,
  type CompletionResourceType,
} from "./completion-definition";
import { outcomeValidatorKey, resolveOutcomeValidator } from "./outcome-validators";

// Frozen completion-definition identity (RA-3B). Pure: no Firestore access.
//
// Identity:
//   - One definition per assessment revision, stored at
//     `completionDefinitions/{assessmentRevisionId}`.
//   - `definitionVersion` equals the revision ordinal. A requirement change
//     is a new assessment revision, never a second definition for one
//     revision and never a separate numeric progression.
//   - Integrity: `definitionHash` = lowercase hex SHA-256 of
//     `definitionJson`, which is the canonical JSON (shared
//     `canonicalJson`, the assessment-presentation convention: sorted keys,
//     NFC strings, safe integers only) of the RA-2-normalized definition.
//
// Every reader re-derives the hash, re-parses and re-validates the content
// with RA-2 `validateCompletionDefinition` (which also refuses an
// unregistered validator or unsupported schema), and checks every identity
// field. Any disagreement fails closed with a stable reason code. The
// newest definition is never substituted for a frozen one: readers address
// a definition only by the frozen revision id.

export type CompletionDefinitionRecordIssue =
  | "missing"
  | "malformed"
  | "unsupportedRecordSchema"
  | "corrupt"
  | "hashMismatch"
  | "unsupportedDefinitionSchema"
  | "unregisteredValidator"
  | "invalidDefinition"
  | "identityMismatch"
  | "revisionMismatch"
  | "resourceMismatch"
  | "versionMismatch"
  | "validatorMismatch";

export type CompletionBindingIssue =
  | CompletionDefinitionRecordIssue
  | "bindingMissing"
  | "bindingMalformed"
  | "bindingUnsupportedSchema"
  | "bindingAssignmentMismatch"
  | "bindingResourceMismatch"
  | "bindingRevisionMismatch"
  | "bindingHashMismatch"
  | "bindingVersionMismatch"
  | "bindingValidatorMismatch";

const HASH_PATTERN = /^[0-9a-f]{64}$/;

const RECORD_KEYS = [
  "recordSchemaVersion",
  "assessmentId",
  "assessmentRevisionId",
  "revisionOrdinal",
  "resourceId",
  "resourceType",
  "definitionSchemaVersion",
  "definitionVersion",
  "definitionHash",
  "definitionJson",
  "validators",
  "publishedBy",
  "publishedAt",
] as const;

const BINDING_KEYS = [
  "bindingSchemaVersion",
  "assignmentId",
  "classId",
  "resourceId",
  "resourceType",
  "assessmentRevisionId",
  "definitionSchemaVersion",
  "definitionVersion",
  "definitionHash",
  "validators",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && own.every((k) => keys.includes(k));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// Firestore's representable Timestamp range: 0001-01-01T00:00:00Z through
// 9999-12-31T23:59:59.999999999Z (the bounds `Timestamp` itself enforces).
const MIN_TIMESTAMP_SECONDS = -62_135_596_800;
const MAX_TIMESTAMP_SECONDS = 253_402_300_799;

// `publishedAt` is a server timestamp. Checked structurally (Firestore
// `Timestamp` exposes integer `seconds` and `nanoseconds`) so this module
// stays free of firebase-admin; null, arrays, or any other value is
// malformed. `seconds` must be a safe integer inside Firestore's valid
// range and `nanoseconds` an integer in [0, 1e9). A deployment-time
// `serverTimestamp()` sentinel is never a stored value and fails here.
function isStoredTimestamp(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const { seconds, nanoseconds } = value as { seconds?: unknown; nanoseconds?: unknown };
  return (
    typeof seconds === "number" &&
    Number.isSafeInteger(seconds) &&
    seconds >= MIN_TIMESTAMP_SECONDS &&
    seconds <= MAX_TIMESTAMP_SECONDS &&
    typeof nanoseconds === "number" &&
    Number.isInteger(nanoseconds) &&
    nanoseconds >= 0 &&
    nanoseconds < 1_000_000_000
  );
}

export function computeCompletionDefinitionHash(definitionJson: string): string {
  return createHash("sha256").update(definitionJson, "utf8").digest("hex");
}

// Canonical JSON of an RA-2-normalized definition. Throws when the
// definition carries a value the canonical form refuses (a string that is
// not NFC-normalized, or a number that is not a safe integer).
export function canonicalCompletionDefinitionJson(definition: CompletionDefinition): string {
  return canonicalJson(definition);
}

// Distinct validators a definition names, sorted by id then version.
export function completionDefinitionValidators(
  definition: CompletionDefinition,
): readonly CompletionValidatorRef[] {
  const byKey = new Map<string, CompletionValidatorRef>();
  for (const o of definition.outcomes) {
    byKey.set(outcomeValidatorKey(o.validatorId, o.validatorVersion), {
      validatorId: o.validatorId,
      validatorVersion: o.validatorVersion,
    });
  }
  return Object.freeze(
    [...byKey.values()]
      .sort((a, b) =>
        a.validatorId === b.validatorId
          ? a.validatorVersion - b.validatorVersion
          : a.validatorId < b.validatorId
            ? -1
            : 1,
      )
      .map((v) => Object.freeze({ ...v })),
  );
}

function validatorListsEqual(a: unknown, b: readonly CompletionValidatorRef[]): boolean {
  if (!Array.isArray(a) || a.length !== b.length) return false;
  return a.every((entry: unknown, i) => {
    if (!isPlainObject(entry) || !hasExactKeys(entry, ["validatorId", "validatorVersion"])) return false;
    return entry.validatorId === b[i].validatorId && entry.validatorVersion === b[i].validatorVersion;
  });
}

function issueFromValidation(issues: readonly string[]): CompletionDefinitionRecordIssue {
  if (issues.includes("definition.unsupportedSchemaVersion")) return "unsupportedDefinitionSchema";
  if (issues.includes("outcome.unknownValidator")) return "unregisteredValidator";
  return "invalidDefinition";
}

export type CompletionDefinitionIdentity = {
  readonly resourceId: string;
  readonly resourceType: CompletionResourceType;
  readonly assessmentRevisionId: string;
};

// Checks identity shared by deployment and every read: the revision id is
// canonical and belongs to the resource's assessment, and the definition
// names exactly this resource, type, revision, and the revision's ordinal
// as its version. Returns the ordinal, or an issue.
function checkDefinitionIdentity(
  definition: CompletionDefinition,
  expected: CompletionDefinitionIdentity,
): { readonly ok: true; readonly revisionOrdinal: number } | { readonly ok: false; readonly issue: CompletionDefinitionRecordIssue } {
  const revisionOrdinal = parseRevisionOrdinalFromRevisionId(expected.assessmentRevisionId);
  if (
    revisionOrdinal === undefined ||
    parseAssessmentIdFromRevisionId(expected.assessmentRevisionId) !==
      assessmentIdForLessonSlug(expected.resourceId)
  ) {
    return { ok: false, issue: "revisionMismatch" };
  }
  try {
    assertActivityIdMatchesResourceType(expected.resourceId, expected.resourceType);
  } catch {
    return { ok: false, issue: "resourceMismatch" };
  }
  if (definition.resourceId !== expected.resourceId || definition.resourceType !== expected.resourceType) {
    return { ok: false, issue: "resourceMismatch" };
  }
  if (definition.assessmentRevisionId !== expected.assessmentRevisionId) {
    return { ok: false, issue: "revisionMismatch" };
  }
  if (definition.definitionVersion !== revisionOrdinal) {
    return { ok: false, issue: "versionMismatch" };
  }
  for (const o of definition.outcomes) {
    if (!resolveOutcomeValidator(o.validatorId, o.validatorVersion)) {
      return { ok: false, issue: "unregisteredValidator" };
    }
  }
  return { ok: true, revisionOrdinal };
}

export type PreparedCompletionDefinitionRecord =
  | {
      readonly ok: true;
      readonly definition: CompletionDefinition;
      readonly write: Omit<CompletionDefinitionCreationWrite, "publishedAt">;
    }
  | { readonly ok: false; readonly issue: CompletionDefinitionRecordIssue; readonly details: readonly string[] };

// Deployment side: validates an authored definition against the revision it
// will be frozen with and projects the immutable record (minus the server
// timestamp). The stored JSON is the canonical form of the RA-2-normalized
// definition, so authoring key order or extra whitespace never changes the
// hash.
export function prepareCompletionDefinitionRecord(
  raw: unknown,
  expected: CompletionDefinitionIdentity & { readonly publishedBy: string },
): PreparedCompletionDefinitionRecord {
  const validated = validateCompletionDefinition(raw);
  if (!validated.ok) {
    return { ok: false, issue: issueFromValidation(validated.issues), details: validated.issues };
  }
  const definition = validated.definition;
  const identity = checkDefinitionIdentity(definition, expected);
  if (!identity.ok) return { ok: false, issue: identity.issue, details: [] };
  let definitionJson: string;
  try {
    definitionJson = canonicalCompletionDefinitionJson(definition);
  } catch {
    return { ok: false, issue: "invalidDefinition", details: ["definition.notCanonicalizable"] };
  }
  return {
    ok: true,
    definition,
    write: {
      recordSchemaVersion: COMPLETION_DEFINITION_RECORD_SCHEMA_VERSION,
      assessmentId: assessmentIdForLessonSlug(expected.resourceId),
      assessmentRevisionId: expected.assessmentRevisionId,
      revisionOrdinal: identity.revisionOrdinal,
      resourceId: definition.resourceId,
      resourceType: definition.resourceType,
      definitionSchemaVersion: definition.schemaVersion,
      definitionVersion: definition.definitionVersion,
      definitionHash: computeCompletionDefinitionHash(definitionJson),
      definitionJson,
      validators: completionDefinitionValidators(definition),
      publishedBy: expected.publishedBy,
    },
  };
}

export type VerifiedCompletionDefinitionRecord = {
  readonly definition: CompletionDefinition;
  readonly definitionHash: string;
  readonly validators: readonly CompletionValidatorRef[];
};

export type CompletionDefinitionRecordVerification =
  | ({ readonly ok: true } & VerifiedCompletionDefinitionRecord)
  | { readonly ok: false; readonly issue: CompletionDefinitionRecordIssue };

// Read side: verifies a stored `completionDefinitions/{assessmentRevisionId}`
// document. `raw` is the document data (undefined when absent).
export function verifyCompletionDefinitionRecord(
  assessmentRevisionId: string,
  raw: unknown,
  expected: { readonly resourceId: string; readonly resourceType: CompletionResourceType },
): CompletionDefinitionRecordVerification {
  if (raw === undefined || raw === null) return { ok: false, issue: "missing" };
  if (!isPlainObject(raw)) return { ok: false, issue: "malformed" };
  if (raw.recordSchemaVersion !== COMPLETION_DEFINITION_RECORD_SCHEMA_VERSION) {
    return { ok: false, issue: "unsupportedRecordSchema" };
  }
  if (!hasExactKeys(raw, RECORD_KEYS)) return { ok: false, issue: "malformed" };
  if (!isStoredTimestamp(raw.publishedAt)) return { ok: false, issue: "malformed" };
  const { definitionJson, definitionHash } = raw;
  if (typeof definitionJson !== "string" || typeof definitionHash !== "string" || !HASH_PATTERN.test(definitionHash)) {
    return { ok: false, issue: "malformed" };
  }
  if (computeCompletionDefinitionHash(definitionJson) !== definitionHash) {
    return { ok: false, issue: "hashMismatch" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(definitionJson);
  } catch {
    // The parser error is dropped on purpose: V8 quotes the input text.
    return { ok: false, issue: "corrupt" };
  }
  const validated = validateCompletionDefinition(parsed);
  if (!validated.ok) return { ok: false, issue: issueFromValidation(validated.issues) };
  const definition = validated.definition;
  let canonical: string;
  try {
    canonical = canonicalCompletionDefinitionJson(definition);
  } catch {
    return { ok: false, issue: "corrupt" };
  }
  // The stored string must be exactly the canonical form of the content it
  // validates to; anything else was not written by deployment.
  if (canonical !== definitionJson) return { ok: false, issue: "corrupt" };

  const identity = checkDefinitionIdentity(definition, {
    resourceId: expected.resourceId,
    resourceType: expected.resourceType,
    assessmentRevisionId,
  });
  if (!identity.ok) return { ok: false, issue: identity.issue };

  // Denormalized fields must agree with the content.
  const validators = completionDefinitionValidators(definition);
  if (
    raw.assessmentRevisionId !== assessmentRevisionId ||
    raw.assessmentId !== assessmentIdForLessonSlug(definition.resourceId) ||
    raw.revisionOrdinal !== identity.revisionOrdinal ||
    raw.resourceId !== definition.resourceId ||
    raw.resourceType !== definition.resourceType ||
    raw.definitionSchemaVersion !== definition.schemaVersion ||
    raw.definitionVersion !== definition.definitionVersion ||
    !isNonEmptyString(raw.publishedBy)
  ) {
    return { ok: false, issue: "identityMismatch" };
  }
  if (!validatorListsEqual(raw.validators, validators)) return { ok: false, issue: "validatorMismatch" };

  return { ok: true, definition, definitionHash, validators };
}

// Publication side: the binding frozen on an assignment occurrence from a
// verified record.
export function buildAssignmentCompletionBinding(
  occurrence: { readonly assignmentId: string; readonly classId: string },
  verified: VerifiedCompletionDefinitionRecord,
): AssignmentCompletionBinding {
  const d = verified.definition;
  return {
    bindingSchemaVersion: ASSIGNMENT_COMPLETION_BINDING_SCHEMA_VERSION,
    assignmentId: occurrence.assignmentId,
    classId: occurrence.classId,
    resourceId: d.resourceId,
    resourceType: d.resourceType,
    assessmentRevisionId: d.assessmentRevisionId,
    definitionSchemaVersion: d.schemaVersion,
    definitionVersion: d.definitionVersion,
    definitionHash: verified.definitionHash,
    validators: verified.validators.map((v) => ({ ...v })),
  };
}

// Strict structural parse of a stored binding. Values are checked against
// the assignment and the definition record by `verifyFrozenCompletionBinding`.
export function parseAssignmentCompletionBinding(
  raw: unknown,
): { readonly ok: true; readonly binding: AssignmentCompletionBinding } | { readonly ok: false; readonly issue: CompletionBindingIssue } {
  if (raw === undefined || raw === null) return { ok: false, issue: "bindingMissing" };
  if (!isPlainObject(raw)) return { ok: false, issue: "bindingMalformed" };
  if (raw.bindingSchemaVersion !== ASSIGNMENT_COMPLETION_BINDING_SCHEMA_VERSION) {
    return { ok: false, issue: "bindingUnsupportedSchema" };
  }
  if (!hasExactKeys(raw, BINDING_KEYS)) return { ok: false, issue: "bindingMalformed" };
  const strings = ["assignmentId", "classId", "resourceId", "resourceType", "assessmentRevisionId", "definitionHash"];
  if (!strings.every((k) => isNonEmptyString(raw[k]))) return { ok: false, issue: "bindingMalformed" };
  if (!HASH_PATTERN.test(raw.definitionHash as string)) return { ok: false, issue: "bindingMalformed" };
  for (const k of ["definitionSchemaVersion", "definitionVersion"]) {
    const v = raw[k];
    if (typeof v !== "number" || !Number.isInteger(v) || v < 1) return { ok: false, issue: "bindingMalformed" };
  }
  if (!Array.isArray(raw.validators)) return { ok: false, issue: "bindingMalformed" };
  const validators: CompletionValidatorRef[] = [];
  for (const v of raw.validators as unknown[]) {
    if (
      !isPlainObject(v) ||
      !hasExactKeys(v, ["validatorId", "validatorVersion"]) ||
      !isNonEmptyString(v.validatorId) ||
      typeof v.validatorVersion !== "number" ||
      !Number.isInteger(v.validatorVersion) ||
      v.validatorVersion < 1
    ) {
      return { ok: false, issue: "bindingMalformed" };
    }
    validators.push({ validatorId: v.validatorId, validatorVersion: v.validatorVersion });
  }
  return {
    ok: true,
    binding: {
      bindingSchemaVersion: ASSIGNMENT_COMPLETION_BINDING_SCHEMA_VERSION,
      assignmentId: raw.assignmentId as string,
      classId: raw.classId as string,
      resourceId: raw.resourceId as string,
      resourceType: raw.resourceType as AssignmentCompletionBinding["resourceType"],
      assessmentRevisionId: raw.assessmentRevisionId as string,
      definitionSchemaVersion: raw.definitionSchemaVersion as number,
      definitionVersion: raw.definitionVersion as number,
      definitionHash: raw.definitionHash as string,
      validators,
    },
  };
}

export type FrozenCompletionBindingVerification =
  | {
      readonly ok: true;
      readonly binding: AssignmentCompletionBinding;
      readonly definition: CompletionDefinition;
    }
  | { readonly ok: false; readonly issue: CompletionBindingIssue };

// The single verifier for "this published assignment occurrence and this
// stored definition record agree": the binding belongs to this occurrence
// (assignment id, class), names the assignment's own resource, type and
// frozen revision, and matches the verified record's hash, schema,
// version, and validators. Used by the RA-3A evidence context.
export function verifyFrozenCompletionBinding(input: {
  readonly assignmentId: string;
  readonly classId: string;
  readonly resourceId: string;
  readonly resourceType: CompletionResourceType;
  readonly assessmentRevisionId: string;
  readonly binding: AssignmentCompletionBinding;
  readonly record: unknown;
}): FrozenCompletionBindingVerification {
  const b = input.binding;
  if (b.assignmentId !== input.assignmentId || b.classId !== input.classId) {
    return { ok: false, issue: "bindingAssignmentMismatch" };
  }
  if (b.resourceId !== input.resourceId || b.resourceType !== input.resourceType) {
    return { ok: false, issue: "bindingResourceMismatch" };
  }
  if (b.assessmentRevisionId !== input.assessmentRevisionId) {
    return { ok: false, issue: "bindingRevisionMismatch" };
  }
  const verified = verifyCompletionDefinitionRecord(b.assessmentRevisionId, input.record, {
    resourceId: input.resourceId,
    resourceType: input.resourceType,
  });
  if (!verified.ok) return verified;
  if (b.definitionHash !== verified.definitionHash) return { ok: false, issue: "bindingHashMismatch" };
  if (
    b.definitionSchemaVersion !== verified.definition.schemaVersion ||
    b.definitionVersion !== verified.definition.definitionVersion
  ) {
    return { ok: false, issue: "bindingVersionMismatch" };
  }
  if (!validatorListsEqual(b.validators, verified.validators)) {
    return { ok: false, issue: "bindingValidatorMismatch" };
  }
  return { ok: true, binding: b, definition: verified.definition };
}
