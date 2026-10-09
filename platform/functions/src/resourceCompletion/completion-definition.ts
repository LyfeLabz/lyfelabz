import { assertActivityIdMatchesResourceType } from "../shared/activity-identifiers";
import {
  assessmentIdForLessonSlug,
  parseAssessmentIdFromRevisionId,
  parseRevisionOrdinalFromRevisionId,
} from "../shared/assessment-identifiers";
import { outcomeValidatorKey, resolveOutcomeValidator } from "./outcome-validators";

// Completion-definition contract, schema version 1 (RA-2).
//
// A completion definition declares, for one non-lesson resource and one
// assessment revision, the required and optional stages, the structured
// evidence items, the server-verifiable outcomes, and any explicitly
// authorized self-reported attestations. It is plain data intended to be
// frozen with the assessment revision; RA-2 does not store it anywhere.
//
// It deliberately carries no answer-key material, no question count, no
// teacher, unit, class, or assignment context, and no student navigation.
// Requirements are a small closed tree (evidence, outcome, attestation
// leaves; allOf and atLeast combinators). There are no expressions.
//
// `validateCompletionDefinition` is strict and fails closed: an unknown
// field, kind, version, validator, or reference, or any contradiction,
// rejects the whole definition.

export const COMPLETION_DEFINITION_SCHEMA_VERSION = 1;

export type CompletionResourceType = "simulation" | "investigation" | "extension" | "challenge";

const COMPLETION_RESOURCE_TYPES: readonly CompletionResourceType[] = [
  "simulation",
  "investigation",
  "extension",
  "challenge",
];

export type TextEvidencePurpose = "prediction" | "observation" | "explanation" | "reflection";

const TEXT_EVIDENCE_PURPOSES: readonly TextEvidencePurpose[] = [
  "prediction",
  "observation",
  "explanation",
  "reflection",
];

// RA-2 implements one evidence kind. Text validation is presence only
// (at least one visible character); there is no universal length minimum
// and no quality scoring. Further kinds (structured table, graph, CER,
// design record) are added as new union members with their own structural
// validation.
export interface TextEvidenceDefinition {
  readonly evidenceId: string;
  readonly stageId: string;
  readonly kind: "text";
  readonly purpose: TextEvidencePurpose;
  // The prompt the student answers, kept so a response is read with its
  // question.
  readonly prompt: string;
}

export type EvidenceItemDefinition = TextEvidenceDefinition;

export interface OutcomeDefinition {
  readonly outcomeId: string;
  readonly stageId: string;
  readonly validatorId: string;
  readonly validatorVersion: number;
  // One outcome code the validator reports.
  readonly validatorOutcome: string;
}

// Exceptional: only for physical or offline work the platform cannot
// verify. `reason` records the instructional exception.
export interface AttestationAuthorization {
  readonly attestationId: string;
  readonly stageId: string;
  readonly statement: string;
  readonly reason: string;
}

export type CompletionRequirement =
  | { readonly kind: "evidence"; readonly evidenceId: string }
  | { readonly kind: "outcome"; readonly outcomeId: string }
  | { readonly kind: "attestation"; readonly attestationId: string }
  | { readonly kind: "allOf"; readonly requirements: readonly CompletionRequirement[] }
  | {
      readonly kind: "atLeast";
      readonly count: number;
      readonly requirements: readonly CompletionRequirement[];
    };

export interface CompletionStage {
  readonly stageId: string;
  readonly required: boolean;
  readonly requirement: CompletionRequirement;
}

export interface CompletionDefinition {
  readonly schemaVersion: typeof COMPLETION_DEFINITION_SCHEMA_VERSION;
  readonly resourceId: string;
  readonly resourceType: CompletionResourceType;
  readonly assessmentRevisionId: string;
  // Positive integer revision of this resource's requirements.
  readonly definitionVersion: number;
  readonly stages: readonly CompletionStage[];
  readonly evidence: readonly EvidenceItemDefinition[];
  readonly outcomes: readonly OutcomeDefinition[];
  readonly attestations: readonly AttestationAuthorization[];
}

export type CompletionDefinitionValidation =
  | { readonly ok: true; readonly definition: CompletionDefinition }
  | { readonly ok: false; readonly issues: readonly string[] };

// Bounds keep evaluation small and deterministic.
export const COMPLETION_DEFINITION_LIMITS = Object.freeze({
  maxStages: 16,
  maxEvidenceItems: 32,
  maxOutcomes: 32,
  maxAttestations: 8,
  maxRequirementDepth: 4,
  maxCombinatorChildren: 16,
  maxPromptCharacters: 2000,
});

const STABLE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_STABLE_ID_LENGTH = 64;
const VALIDATOR_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

export function isStableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_STABLE_ID_LENGTH &&
    STABLE_ID_PATTERN.test(value)
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const own = Object.keys(value);
  return own.length === keys.length && own.every((k) => keys.includes(k));
}

function isNonBlankBounded(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max && /[^\s\p{Cf}]/u.test(value);
}

type Leaf =
  | { kind: "evidence"; ref: string }
  | { kind: "outcome"; ref: string }
  | { kind: "attestation"; ref: string };

export function validateCompletionDefinition(raw: unknown): CompletionDefinitionValidation {
  const issues: string[] = [];
  const fail = (): CompletionDefinitionValidation => ({
    ok: false,
    issues: Object.freeze(issues.slice()),
  });

  if (!isPlainObject(raw)) {
    issues.push("definition.malformed");
    return fail();
  }
  if (raw.schemaVersion !== COMPLETION_DEFINITION_SCHEMA_VERSION) {
    issues.push("definition.unsupportedSchemaVersion");
    return fail();
  }
  const topKeys = [
    "schemaVersion",
    "resourceId",
    "resourceType",
    "assessmentRevisionId",
    "definitionVersion",
    "stages",
    "evidence",
    "outcomes",
    "attestations",
  ];
  if (!hasExactKeys(raw, topKeys)) {
    issues.push("definition.unexpectedFields");
    return fail();
  }

  // Identity.
  const { resourceId, resourceType, assessmentRevisionId, definitionVersion } = raw;
  if (
    typeof resourceType !== "string" ||
    !(COMPLETION_RESOURCE_TYPES as readonly string[]).includes(resourceType)
  ) {
    issues.push("definition.unsupportedResourceType");
  }
  if (typeof resourceId !== "string") {
    issues.push("definition.invalidResourceId");
  } else if (issues.length === 0) {
    try {
      assertActivityIdMatchesResourceType(resourceId, resourceType as CompletionResourceType);
    } catch {
      issues.push("definition.resourceTypeMismatch");
    }
  }
  if (
    typeof assessmentRevisionId !== "string" ||
    parseRevisionOrdinalFromRevisionId(assessmentRevisionId) === undefined
  ) {
    issues.push("definition.invalidAssessmentRevision");
  } else if (
    typeof resourceId === "string" &&
    parseAssessmentIdFromRevisionId(assessmentRevisionId) !== assessmentIdForLessonSlug(resourceId)
  ) {
    issues.push("definition.assessmentRevisionMismatch");
  }
  if (!isPositiveInteger(definitionVersion)) {
    issues.push("definition.invalidDefinitionVersion");
  }

  const { stages, evidence, outcomes, attestations } = raw;
  if (
    !Array.isArray(stages) ||
    !Array.isArray(evidence) ||
    !Array.isArray(outcomes) ||
    !Array.isArray(attestations)
  ) {
    issues.push("definition.malformed");
    return fail();
  }
  const L = COMPLETION_DEFINITION_LIMITS;
  if (
    stages.length > L.maxStages ||
    evidence.length > L.maxEvidenceItems ||
    outcomes.length > L.maxOutcomes ||
    attestations.length > L.maxAttestations
  ) {
    issues.push("definition.tooLarge");
    return fail();
  }

  // Stages (shape only; requirements checked after declarations).
  const stageIds = new Set<string>();
  for (const s of stages as unknown[]) {
    if (!isPlainObject(s) || !hasExactKeys(s, ["stageId", "required", "requirement"])) {
      issues.push("stage.malformed");
      continue;
    }
    if (!isStableId(s.stageId)) {
      issues.push("stage.invalidId");
      continue;
    }
    if (typeof s.required !== "boolean") issues.push(`stage.invalidRequired:${s.stageId}`);
    if (stageIds.has(s.stageId)) issues.push(`stage.duplicateId:${s.stageId}`);
    stageIds.add(s.stageId);
  }

  // Declarations: id -> owning stage.
  const owners = {
    evidence: new Map<string, string>(),
    outcome: new Map<string, string>(),
    attestation: new Map<string, string>(),
  };
  const declare = (kind: keyof typeof owners, id: unknown, stageId: unknown): void => {
    if (!isStableId(id)) {
      issues.push(`${kind}.invalidId`);
      return;
    }
    if (owners[kind].has(id)) issues.push(`${kind}.duplicateId:${id}`);
    if (typeof stageId !== "string" || !stageIds.has(stageId)) {
      issues.push(`${kind}.unknownStage:${id}`);
      return;
    }
    owners[kind].set(id, stageId);
  };

  for (const e of evidence as unknown[]) {
    if (!isPlainObject(e) || e.kind !== "text") {
      issues.push(isPlainObject(e) ? "evidence.unsupportedKind" : "evidence.malformed");
      continue;
    }
    if (!hasExactKeys(e, ["evidenceId", "stageId", "kind", "purpose", "prompt"])) {
      issues.push("evidence.malformed");
      continue;
    }
    if (
      typeof e.purpose !== "string" ||
      !(TEXT_EVIDENCE_PURPOSES as readonly string[]).includes(e.purpose)
    ) {
      issues.push("evidence.unsupportedPurpose");
    }
    if (!isNonBlankBounded(e.prompt, L.maxPromptCharacters)) issues.push("evidence.invalidPrompt");
    declare("evidence", e.evidenceId, e.stageId);
  }

  const validatorOutcomesSeen = new Set<string>();
  for (const o of outcomes as unknown[]) {
    if (
      !isPlainObject(o) ||
      !hasExactKeys(o, ["outcomeId", "stageId", "validatorId", "validatorVersion", "validatorOutcome"])
    ) {
      issues.push("outcome.malformed");
      continue;
    }
    const validator =
      typeof o.validatorId === "string" &&
      VALIDATOR_ID_PATTERN.test(o.validatorId) &&
      isPositiveInteger(o.validatorVersion)
        ? resolveOutcomeValidator(o.validatorId, o.validatorVersion)
        : undefined;
    if (!validator) {
      issues.push("outcome.unknownValidator");
    } else if (
      typeof o.validatorOutcome !== "string" ||
      !validator.outcomes.includes(o.validatorOutcome)
    ) {
      issues.push("outcome.unknownValidatorOutcome");
    } else {
      // Two declared outcomes for one validator result would let a single
      // launch count twice toward an atLeast group.
      const key = `${outcomeValidatorKey(validator.validatorId, validator.validatorVersion)}#${o.validatorOutcome}`;
      if (validatorOutcomesSeen.has(key)) issues.push("outcome.duplicateValidatorOutcome");
      validatorOutcomesSeen.add(key);
    }
    declare("outcome", o.outcomeId, o.stageId);
  }

  for (const a of attestations as unknown[]) {
    if (!isPlainObject(a) || !hasExactKeys(a, ["attestationId", "stageId", "statement", "reason"])) {
      issues.push("attestation.malformed");
      continue;
    }
    if (!isNonBlankBounded(a.statement, L.maxPromptCharacters)) issues.push("attestation.invalidStatement");
    if (!isNonBlankBounded(a.reason, L.maxPromptCharacters)) issues.push("attestation.missingReason");
    declare("attestation", a.attestationId, a.stageId);
  }

  if (issues.length > 0) return fail();

  // Requirement trees.
  const referenced = new Set<string>();
  const normalizedStages: CompletionStage[] = [];
  let requiredStageCount = 0;
  for (const s of stages as Array<Record<string, unknown>>) {
    const stageId = s.stageId as string;
    const leaves: Leaf[] = [];
    const requirement = normalizeRequirement(s.requirement, 1, stageId, leaves);
    if (!requirement) continue;
    const kinds = new Set(leaves.map((l) => l.kind));
    // An attestation is never an alternative to a verifiable outcome.
    if (kinds.has("attestation") && kinds.has("outcome")) {
      issues.push(`stage.attestationMixedWithOutcome:${stageId}`);
    }
    for (const leaf of leaves) {
      const key = `${leaf.kind}:${leaf.ref}`;
      if (referenced.has(key)) issues.push(`requirement.duplicateReference:${key}`);
      referenced.add(key);
    }
    if (s.required === true) requiredStageCount++;
    normalizedStages.push(Object.freeze({ stageId, required: s.required as boolean, requirement }));
  }

  for (const kind of ["evidence", "outcome", "attestation"] as const) {
    for (const id of owners[kind].keys()) {
      if (!referenced.has(`${kind}:${id}`)) issues.push(`${kind}.unreferenced:${id}`);
    }
  }
  if (requiredStageCount === 0) issues.push("definition.noRequiredStage");
  if (issues.length > 0) return fail();

  const definition: CompletionDefinition = Object.freeze({
    schemaVersion: COMPLETION_DEFINITION_SCHEMA_VERSION,
    resourceId: resourceId as string,
    resourceType: resourceType as CompletionResourceType,
    assessmentRevisionId: assessmentRevisionId as string,
    definitionVersion: definitionVersion as number,
    stages: Object.freeze(normalizedStages),
    evidence: Object.freeze(
      (evidence as Array<Record<string, unknown>>).map((e) =>
        Object.freeze({
          evidenceId: e.evidenceId as string,
          stageId: e.stageId as string,
          kind: "text" as const,
          purpose: e.purpose as TextEvidencePurpose,
          prompt: e.prompt as string,
        }),
      ),
    ),
    outcomes: Object.freeze(
      (outcomes as Array<Record<string, unknown>>).map((o) =>
        Object.freeze({
          outcomeId: o.outcomeId as string,
          stageId: o.stageId as string,
          validatorId: o.validatorId as string,
          validatorVersion: o.validatorVersion as number,
          validatorOutcome: o.validatorOutcome as string,
        }),
      ),
    ),
    attestations: Object.freeze(
      (attestations as Array<Record<string, unknown>>).map((a) =>
        Object.freeze({
          attestationId: a.attestationId as string,
          stageId: a.stageId as string,
          statement: a.statement as string,
          reason: a.reason as string,
        }),
      ),
    ),
  });
  return { ok: true, definition };

  function normalizeRequirement(
    r: unknown,
    depth: number,
    stageId: string,
    leaves: Leaf[],
  ): CompletionRequirement | null {
    if (depth > L.maxRequirementDepth) {
      issues.push(`requirement.tooDeep:${stageId}`);
      return null;
    }
    if (!isPlainObject(r) || typeof r.kind !== "string") {
      issues.push(`requirement.malformed:${stageId}`);
      return null;
    }
    const leafField = { evidence: "evidenceId", outcome: "outcomeId", attestation: "attestationId" } as const;
    if (r.kind === "evidence" || r.kind === "outcome" || r.kind === "attestation") {
      const kind = r.kind;
      const field = leafField[kind];
      if (!hasExactKeys(r, ["kind", field])) {
        issues.push(`requirement.malformed:${stageId}`);
        return null;
      }
      const ref = r[field];
      const owner = typeof ref === "string" ? owners[kind].get(ref) : undefined;
      if (owner === undefined) {
        issues.push(`requirement.unknown${kind[0].toUpperCase()}${kind.slice(1)}:${String(ref)}`);
        return null;
      }
      if (owner !== stageId) {
        issues.push(`requirement.crossStageReference:${kind}:${String(ref)}`);
        return null;
      }
      leaves.push({ kind, ref: ref as string });
      return Object.freeze({ kind, [field]: ref } as CompletionRequirement);
    }
    if (r.kind === "allOf" || r.kind === "atLeast") {
      const keys = r.kind === "allOf" ? ["kind", "requirements"] : ["kind", "count", "requirements"];
      if (!hasExactKeys(r, keys) || !Array.isArray(r.requirements)) {
        issues.push(`requirement.malformed:${stageId}`);
        return null;
      }
      const children = r.requirements as unknown[];
      if (children.length === 0 || children.length > L.maxCombinatorChildren) {
        issues.push(`requirement.invalidChildCount:${stageId}`);
        return null;
      }
      const normalized: CompletionRequirement[] = [];
      for (const c of children) {
        const n = normalizeRequirement(c, depth + 1, stageId, leaves);
        if (!n) return null;
        normalized.push(n);
      }
      if (r.kind === "allOf") {
        return Object.freeze({ kind: "allOf", requirements: Object.freeze(normalized) });
      }
      if (!isPositiveInteger(r.count) || r.count > normalized.length) {
        issues.push(`requirement.unsatisfiableCount:${stageId}`);
        return null;
      }
      return Object.freeze({ kind: "atLeast", count: r.count, requirements: Object.freeze(normalized) });
    }
    issues.push(`requirement.unsupportedKind:${stageId}`);
    return null;
  }
}
