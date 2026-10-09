import type { FieldValue, Timestamp } from "firebase-admin/firestore";

// Frozen completion-definition records and assignment completion bindings
// (RA-3B). See docs/platform/FROZEN_COMPLETION_DEFINITIONS.md.
//
// `completionDefinitions/{assessmentRevisionId}` holds exactly one
// immutable completion definition per non-lesson assessment revision. It is
// created only by `deployAssessmentRevision`, in the same transaction as
// the revision and its answer key, and is never updated or deleted by any
// supported path. No Rules block opens the collection, so the terminal
// default-deny refuses every client read and write.
//
// The definition content is stored once, as canonical JSON, beside the
// SHA-256 of that exact string. Every reader re-derives the hash and
// re-validates the content; a record that does not reproduce its own hash
// is never honored. The identity fields beside the content are
// denormalized copies that must agree with the content.
//
// A completion-definition change is a new assessment revision. The
// definition's `definitionVersion` is therefore not an independent
// progression: it must equal the revision ordinal of the assessment
// revision it is frozen with.

export const COMPLETION_DEFINITIONS_COLLECTION = "completionDefinitions";

export const COMPLETION_DEFINITION_RECORD_SCHEMA_VERSION = 1;

export const ASSIGNMENT_COMPLETION_BINDING_SCHEMA_VERSION = 1;

export type CompletionBindingResourceType =
  | "simulation"
  | "investigation"
  | "extension"
  | "challenge";

// One registered validator a definition requires, by id and version.
export type CompletionValidatorRef = {
  readonly validatorId: string;
  readonly validatorVersion: number;
};

// Fields shared by the stored record and its creation write.
type CompletionDefinitionRecordFields = {
  readonly recordSchemaVersion: typeof COMPLETION_DEFINITION_RECORD_SCHEMA_VERSION;
  readonly assessmentId: string;
  readonly assessmentRevisionId: string;
  readonly revisionOrdinal: number;
  readonly resourceId: string;
  readonly resourceType: CompletionBindingResourceType;
  readonly definitionSchemaVersion: number;
  readonly definitionVersion: number;
  // Lowercase hex SHA-256 of `definitionJson`.
  readonly definitionHash: string;
  // Canonical JSON of the RA-2-normalized definition.
  readonly definitionJson: string;
  // Distinct validators the definition names, sorted by id then version.
  readonly validators: readonly CompletionValidatorRef[];
  readonly publishedBy: string;
};

export type CompletionDefinitionRecord = CompletionDefinitionRecordFields & {
  readonly publishedAt: Timestamp;
};

export type CompletionDefinitionCreationWrite = CompletionDefinitionRecordFields & {
  readonly publishedAt: FieldValue;
};

// Namespaced binding frozen on a published non-lesson assignment
// (`assignments/{assignmentId}.completionBinding`). Written exactly once by
// `assignmentsPublish`, in the same transaction as the `draft` ->
// `published` transition, the frozen `assessmentRevisionId`, the Current
// pointer, and the recipient snapshot. Never written on a lesson
// assignment, never supplied by a client, and never repaired: a published
// non-lesson assignment without a valid binding fails closed.
export type AssignmentCompletionBinding = {
  readonly bindingSchemaVersion: typeof ASSIGNMENT_COMPLETION_BINDING_SCHEMA_VERSION;
  // The assignment occurrence this binding belongs to (its document id
  // and frozen class), so a binding copied onto another record is refused.
  readonly assignmentId: string;
  readonly classId: string;
  readonly resourceId: string;
  readonly resourceType: CompletionBindingResourceType;
  readonly assessmentRevisionId: string;
  readonly definitionSchemaVersion: number;
  readonly definitionVersion: number;
  readonly definitionHash: string;
  readonly validators: readonly CompletionValidatorRef[];
};
