import { Timestamp } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import { isSupersededOccurrence } from "../assignments/current-occurrence-group";
import {
  validateCompletionDefinition,
  type CompletionDefinition,
  type CompletionResourceType,
} from "../resourceCompletion";
import {
  assertActivityIdMatchesResourceType,
  parseAssignmentResourceType,
} from "../shared/activity-identifiers";
import { requireDistrictContext } from "../shared/auth/require-district-context";
import { PlatformError } from "../shared/errors/platform-error";
import { assignmentDocRef, enrollmentDocRef } from "../shared/firestore/typed-ref";
import { frozenRevisionOrdinal } from "../shared/presentation/revision-coverage";
import type { AssignmentRecord } from "../shared/types/assignment";
import {
  resourceEvidenceRecordId,
  type ResourceEvidenceBinding,
  type ResourceEvidenceOwnership,
} from "./resource-evidence-record";

// Server-authoritative evidence context (RA-3A).
//
// Every evidence call resolves, from authoritative records only:
//   - the student, from the verified ID token and canonical `users/{uid}`
//     (`requireDistrictContext`; the record wins over claims);
//   - entitlement to the assignment occurrence, from `assignments/{id}` and
//     the caller's active `enrollments/{classId}__{uid}` (the same sources
//     `assessmentSessionsBegin` uses), plus the canonical Current-occurrence
//     rule for writes;
//   - the resource and frozen assessment revision, from the assignment
//     record (`lessonSlug`, `resourceType`, `assessmentRevisionId`);
//   - the frozen completion-definition version and the published
//     definition, through two explicit ports (below).
//
// Integration boundary. Two prerequisites do not exist in the platform yet:
//   1. Assignments do not freeze a completion-definition version at
//      publication (`assignmentsPublish` freezes only the assessment
//      revision, and refuses every non-lesson type today).
//   2. No immutable, published completion-definition store exists. The
//      Gravity Wells definition is a DRAFT TypeScript constant, which does
//      not establish publication immutability.
// They are therefore ports. The production implementations fail closed:
// every call is refused with `resourceEvidence.completionBindingUnavailable`.
// Tests inject fixtures. The Gravity Wells DRAFT definition is never
// registered by production code.

export interface FrozenCompletionBindingSource {
  // The completion-definition version frozen with this assignment
  // occurrence at publication, or null when none was frozen.
  frozenDefinitionVersion(assignmentId: string, assignment: AssignmentRecord): Promise<number | null>;
}

export interface CompletionDefinitionStore {
  // The immutable published definition for exactly this binding, or null.
  // Never "the newest" definition: callers pass the frozen version.
  publishedDefinition(
    resourceId: string,
    assessmentRevisionId: string,
    definitionVersion: number,
  ): Promise<unknown>;
}

export const UNAVAILABLE_FROZEN_COMPLETION_BINDING: FrozenCompletionBindingSource = Object.freeze({
  frozenDefinitionVersion: () => Promise.resolve(null),
});

export const NO_PUBLISHED_COMPLETION_DEFINITIONS: CompletionDefinitionStore = Object.freeze({
  publishedDefinition: () => Promise.resolve(null),
});

export type ResourceEvidenceDeps = {
  readonly bindingSource: FrozenCompletionBindingSource;
  readonly definitionStore: CompletionDefinitionStore;
};

// The only deps production code may construct today.
export const PRODUCTION_RESOURCE_EVIDENCE_DEPS: ResourceEvidenceDeps = Object.freeze({
  bindingSource: UNAVAILABLE_FROZEN_COMPLETION_BINDING,
  definitionStore: NO_PUBLISHED_COMPLETION_DEFINITIONS,
});

export type EvidenceActor = {
  readonly uid: string;
  readonly schoolId: string;
  readonly districtId: string;
};

export type ResolvedEvidenceContext = {
  readonly actor: EvidenceActor;
  readonly recordId: string;
  // Why new evidence cannot be written now (closed, outside its window, or
  // superseded by the Current occurrence), or null when writable. Reads,
  // and acknowledgements of an operation that already landed, stay
  // available; every new write must call `assertWritable`.
  readonly writeRefusal: string | null;
  readonly ownership: ResourceEvidenceOwnership;
  readonly binding: ResourceEvidenceBinding;
  readonly definition: CompletionDefinition;
};

export async function assertActiveStudent(request: CallableRequest<unknown>): Promise<EvidenceActor> {
  const context = await requireDistrictContext(request);
  if (context.role !== "student") {
    throw new PlatformError("role-forbidden", "Caller must be an active student.");
  }
  return { uid: context.uid, schoolId: context.schoolId, districtId: context.districtId };
}

// One refusal for every "this assignment is not yours to use" case, so the
// response is not an oracle for assignment existence, class membership, or
// another student's state.
function unavailable(): never {
  throw new PlatformError("resourceEvidence.forbidden", "This assignment is not available for evidence.");
}

export function assertWritable(ctx: ResolvedEvidenceContext): void {
  if (ctx.writeRefusal !== null) {
    throw new PlatformError("resourceEvidence.assignmentClosed", ctx.writeRefusal);
  }
}

function bindingUnavailable(message: string): never {
  throw new PlatformError("resourceEvidence.completionBindingUnavailable", message);
}

export async function resolveEvidenceContext(
  actor: EvidenceActor,
  assignmentId: string,
  deps: ResourceEvidenceDeps,
): Promise<ResolvedEvidenceContext> {
  const snapshot = await assignmentDocRef(assignmentId).get();
  const assignment = snapshot.exists ? snapshot.data() : undefined;
  if (!assignment) unavailable();
  // Same-school is same-district (PDR-025 §10), as in session begin.
  if (assignment.schoolId !== actor.schoolId) unavailable();

  let resourceType: CompletionResourceType;
  try {
    const parsed = parseAssignmentResourceType(assignment.resourceType);
    if (parsed === "lesson") unavailable();
    assertActivityIdMatchesResourceType(assignment.lessonSlug, parsed);
    resourceType = parsed;
  } catch (err) {
    if (err instanceof PlatformError && err.code === "resourceEvidence.forbidden") throw err;
    return unavailable();
  }
  if (assignment.mode !== "classroom") unavailable();
  if (assignment.status !== "published" && assignment.status !== "closed") unavailable();

  const enrollment = await enrollmentDocRef(`${assignment.classId}__${actor.uid}`).get();
  if (!enrollment.exists || enrollment.data()?.status !== "active") unavailable();

  const assessmentRevisionId = assignment.assessmentRevisionId;
  if (frozenRevisionOrdinal(assignment.lessonSlug, assessmentRevisionId) === undefined) {
    bindingUnavailable("The assignment has no frozen assessment revision for this resource.");
  }

  // Write gates. An older occurrence of the same class + resource cannot
  // gather new evidence once a Current exists: evidence follows the Current
  // occurrence, and a new occurrence starts with its own record. Like
  // `assessmentSessionsBegin`, these are read before the write transaction.
  let writeRefusal: string | null = null;
  const now = Timestamp.now().toMillis();
  if (assignment.status !== "published") {
    writeRefusal = "The assignment is closed.";
  } else if (assignment.availableAt && assignment.availableAt.toMillis() > now) {
    writeRefusal = "The assignment is not yet available.";
  } else if (assignment.windowClosesAt && assignment.windowClosesAt.toMillis() <= now) {
    writeRefusal = "The assignment window has closed.";
  } else if (await isSupersededOccurrence(assignmentId, assignment, actor.districtId)) {
    writeRefusal = "The assignment has been superseded by the current assignment.";
  }

  const definitionVersion = await deps.bindingSource.frozenDefinitionVersion(assignmentId, assignment);
  if (definitionVersion === null) {
    bindingUnavailable("The assignment has no frozen completion definition.");
  }
  const rawDefinition = await deps.definitionStore.publishedDefinition(
    assignment.lessonSlug,
    assessmentRevisionId as string,
    definitionVersion,
  );
  const validated = rawDefinition === null || rawDefinition === undefined
    ? undefined
    : validateCompletionDefinition(rawDefinition);
  if (!validated || !validated.ok) {
    bindingUnavailable("The frozen completion definition is unavailable.");
  }
  const definition = validated.definition;
  if (
    definition.resourceId !== assignment.lessonSlug ||
    definition.resourceType !== resourceType ||
    definition.assessmentRevisionId !== assessmentRevisionId ||
    definition.definitionVersion !== definitionVersion
  ) {
    bindingUnavailable("The completion definition does not match the assignment binding.");
  }

  return {
    actor,
    recordId: resourceEvidenceRecordId(assignmentId, actor.uid),
    writeRefusal,
    ownership: {
      studentId: actor.uid,
      assignmentId,
      classId: assignment.classId,
      teacherId: assignment.teacherId,
      schoolId: assignment.schoolId,
      districtId: actor.districtId,
    },
    binding: {
      resourceId: definition.resourceId,
      resourceType: definition.resourceType,
      assessmentRevisionId: definition.assessmentRevisionId,
      definitionVersion: definition.definitionVersion,
    },
    definition,
  };
}
