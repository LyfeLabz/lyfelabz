import { Timestamp } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import { isSupersededOccurrence } from "../assignments/current-occurrence-group";
import {
  parseAssignmentCompletionBinding,
  verifyFrozenCompletionBinding,
  type CompletionDefinition,
  type CompletionResourceType,
} from "../resourceCompletion";
import {
  assertActivityIdMatchesResourceType,
  parseAssignmentResourceType,
} from "../shared/activity-identifiers";
import { requireDistrictContext } from "../shared/auth/require-district-context";
import { PlatformError } from "../shared/errors/platform-error";
import {
  assignmentDocRef,
  completionDefinitionDocRef,
  enrollmentDocRef,
} from "../shared/firestore/typed-ref";
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
//   - the frozen completion binding and the immutable completion
//     definition it names, through two explicit ports (below).
//
// Ports (RA-3B). Publication now freezes a namespaced `completionBinding`
// on a published non-lesson assignment, and deployment stores one
// immutable definition per assessment revision in
// `completionDefinitions/{assessmentRevisionId}`. The ports return raw,
// unverified data; `resolveEvidenceContext` verifies all of it with the
// one canonical verifier (`verifyFrozenCompletionBinding`): binding shape
// and schema, assignment occurrence (id and class), resource and type,
// frozen revision, record hash, RA-2 schema, registered validators,
// definition version, and the validator list. A fixture cannot skip that.
//
// The Firestore adapters (`ASSIGNMENT_RECORD_COMPLETION_BINDING`,
// `FIRESTORE_COMPLETION_DEFINITION_STORE`) are implemented and tested but
// NOT active: `PRODUCTION_RESOURCE_EVIDENCE_DEPS` still fails closed, and
// none of these handlers is exported or deployed. Switching the production
// ports is an RA-5 activation step behind the activation blockers in
// docs/platform/FROZEN_COMPLETION_DEFINITIONS.md.

export interface FrozenCompletionBindingSource {
  // The completion binding frozen on this assignment occurrence at
  // publication (raw, unverified), or null when none was frozen.
  frozenBinding(assignmentId: string, assignment: AssignmentRecord): Promise<unknown>;
}

export interface CompletionDefinitionStore {
  // The stored completion-definition record for exactly this assessment
  // revision (raw, unverified), or null. Addressed only by the frozen
  // revision id, so the newest definition is never substituted.
  publishedDefinition(assessmentRevisionId: string): Promise<unknown>;
}

export const UNAVAILABLE_FROZEN_COMPLETION_BINDING: FrozenCompletionBindingSource = Object.freeze({
  frozenBinding: () => Promise.resolve(null),
});

export const NO_PUBLISHED_COMPLETION_DEFINITIONS: CompletionDefinitionStore = Object.freeze({
  publishedDefinition: () => Promise.resolve(null),
});

// Reads the binding `assignmentsPublish` froze on the assignment record
// itself (the record `resolveEvidenceContext` already loaded).
export const ASSIGNMENT_RECORD_COMPLETION_BINDING: FrozenCompletionBindingSource = Object.freeze({
  frozenBinding: (_assignmentId: string, assignment: AssignmentRecord) =>
    Promise.resolve(assignment.completionBinding ?? null),
});

// Reads `completionDefinitions/{assessmentRevisionId}`.
export const FIRESTORE_COMPLETION_DEFINITION_STORE: CompletionDefinitionStore = Object.freeze({
  publishedDefinition: async (assessmentRevisionId: string) => {
    const snapshot = await completionDefinitionDocRef(assessmentRevisionId).get();
    return snapshot.exists ? (snapshot.data() ?? null) : null;
  },
});

export type ResourceEvidenceDeps = {
  readonly bindingSource: FrozenCompletionBindingSource;
  readonly definitionStore: CompletionDefinitionStore;
};

// The only deps production code may construct today. Fail closed.
export const PRODUCTION_RESOURCE_EVIDENCE_DEPS: ResourceEvidenceDeps = Object.freeze({
  bindingSource: UNAVAILABLE_FROZEN_COMPLETION_BINDING,
  definitionStore: NO_PUBLISHED_COMPLETION_DEFINITIONS,
});

// RA-3B frozen-publication adapters. Implemented and emulator-tested, not
// wired into any production path. Activation is a separate, authorized
// change (RA-5).
export const FROZEN_PUBLICATION_RESOURCE_EVIDENCE_DEPS: ResourceEvidenceDeps = Object.freeze({
  bindingSource: ASSIGNMENT_RECORD_COMPLETION_BINDING,
  definitionStore: FIRESTORE_COMPLETION_DEFINITION_STORE,
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

function bindingUnavailable(message: string, issue?: string): never {
  throw new PlatformError(
    "resourceEvidence.completionBindingUnavailable",
    message,
    undefined,
    issue === undefined ? undefined : { issue },
  );
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

  const parsedBinding = parseAssignmentCompletionBinding(
    await deps.bindingSource.frozenBinding(assignmentId, assignment),
  );
  if (!parsedBinding.ok) {
    bindingUnavailable("The assignment has no frozen completion definition.", parsedBinding.issue);
  }
  const verified = verifyFrozenCompletionBinding({
    assignmentId,
    classId: assignment.classId,
    resourceId: assignment.lessonSlug,
    resourceType,
    assessmentRevisionId: assessmentRevisionId as string,
    binding: parsedBinding.binding,
    record: await deps.definitionStore.publishedDefinition(parsedBinding.binding.assessmentRevisionId),
  });
  if (!verified.ok) {
    bindingUnavailable("The frozen completion definition does not match the assignment binding.", verified.issue);
  }
  const definition = verified.definition;

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
      definitionHash: verified.binding.definitionHash,
    },
    definition,
  };
}
