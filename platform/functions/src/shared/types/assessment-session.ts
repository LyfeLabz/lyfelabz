import type { FieldValue, Timestamp } from "firebase-admin/firestore";

export const ASSESSMENT_SESSIONS_COLLECTION = "assessmentSessions";

// Canonical assessment-session lifecycle field per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6 (PDR-026). This slice implements
// only the `live` state. The transient `submitted` state exists exclusively
// inside the future `assessmentAttemptsFinalize` transaction and is never
// persisted on the readable collection. The `archived` state and the
// scheduled sweep that produces it are deferred to a later Sprint 11C
// slice; the enumeration is declared here so downstream slices extend
// this union in one place rather than reintroducing a competing name.
export type AssessmentSessionStatus = "live" | "archived";

// F5.2 §3.3/§8.1 - the three-state durable delivery-outcome vocabulary,
// Persistent Student Differentiation Slice 6. Server-derived at session begin
// and never client-supplied. This is the EXACT certified set; no fourth
// persisted value (`failed`, `unknown`, `adapted`, `disabled`,
// `missingCoverage`, `retired`, `legacy`, ...) is ever introduced. Operational
// reasons live only in telemetry (§ telemetry), never in this durable enum.
//   - `"canonical"`         : no support expected at freeze; canonical delivered.
//   - `"differentiated"`    : a validated uid/assignment/lesson-bound launch
//                             grant delivered the frozen `(variantKey,
//                             presentationRevisionId)` pair.
//   - `"canonicalFallback"` : support expected but canonical delivered for a
//                             legitimate reason (coverage gap/retired,
//                             operational disable, or a canonical-fallback
//                             grant). No presentation pair.
export type DeliveryOutcome = "canonical" | "differentiated" | "canonicalFallback";

// F5.2 §3.3 pair invariant, expressed as a discriminated union so a session
// can NEVER be typed with `deliveryOutcome:"differentiated"` and no pair, nor
// with a pair on a `"canonical"`/`"canonicalFallback"` freeze. The
// `variantKey`/`presentationRevisionId` pair is present iff
// `deliveryOutcome === "differentiated"`; exactly one present is unrepresentable.
// This is the ONLY server-derived delivery shape written onto a new session at
// begin (`assessmentSessionsBegin`, Slice 6); it comes from a validated launch
// grant (differentiated) or a server-side no-ref legitimacy check (fallback),
// never from client input.
export type SessionDeliveryFreeze =
  | { readonly deliveryOutcome: "canonical" }
  | { readonly deliveryOutcome: "canonicalFallback" }
  | {
      readonly deliveryOutcome: "differentiated";
      readonly variantKey: string;
      readonly presentationRevisionId: string;
    };

// Per-item autosave response inline on the session document per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6. `itemId` names the assessment
// item the student answered and `response` carries the student's current
// answer as an opaque structured value the scorer will interpret at
// finalize time against the paired answer key (§8, §15). Sessions never
// carry a score, correctness marker, points-earned value, or explanation
// payload on any response element; the scorer produces all such artifacts
// and writes them only to `attempts/{attemptId}` (§7).
export type AssessmentSessionResponse = {
  readonly itemId: string;
  readonly response: unknown;
};

// Canonical assessment-session record shape per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6, §11, and §13.
//
// Ownership fields (`studentId`, `assignmentId`, `classId`, `teacherId`,
// `schoolId`, `districtId`, `activityId`, `assessmentId`,
// `assessmentRevisionId`) are frozen at session creation per §6 invariants
// and are never rewritten by autosave, sweep, recover, or finalize.
// `activityId`, `assessmentId`, and `assessmentRevisionId` are denormalized
// from the referenced assignment record at session creation so the scorer
// in a future slice can resolve the paired answer key without a second
// assignment read.
//
// `responses` and `lastActivityAt` are the only mutable fields on a Live
// session per §14 and are introduced by the Slice 2 autosave callable
// (`assessmentSessionsAutosave`). They are absent from a session that has
// been created but never autosaved (Slice 1 wrote only the creation
// document). Scoring artifacts (score, item-level correctness, points
// earned, explanations) never touch this collection.
//
// This type is the single source of truth for reads of
// assessmentSessions/{sessionId}. Writes use `AssessmentSessionCreationWrite`
// (creation) or `AssessmentSessionAutosaveWrite` (autosave) so that
// `FieldValue.serverTimestamp()` can be used at the write boundary.
export type AssessmentSessionRecord = {
  readonly studentId: string;
  readonly assignmentId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly activityId: string;
  readonly assessmentId: string;
  readonly assessmentRevisionId: string;
  readonly sessionOrdinal: number;
  readonly status: AssessmentSessionStatus;
  readonly startedAt: Timestamp;
  readonly responses?: readonly AssessmentSessionResponse[];
  readonly lastActivityAt?: Timestamp;
  // F5.2 §3.3 - Persistent Student Differentiation Slice 6 additive fields.
  // Frozen at creation from the validated launch grant / no-ref legitimacy
  // check and never rewritten by autosave, sweep, recover, or finalize. All
  // three are OPTIONAL on the read shape: a pre-Slice-6 session lacks all
  // three and is interpreted as canonical (§3.3, §12). The §3.3 invariant
  // (pair present iff `deliveryOutcome:"differentiated"`) holds by
  // construction on every session created at/after Slice 6.
  readonly deliveryOutcome?: DeliveryOutcome;
  readonly variantKey?: string;
  readonly presentationRevisionId?: string;
};

// Write shape for the assessment-session creation callable
// (assessmentSessionsBegin). Conforms to
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6, §11, §12: all ownership fields
// are set at creation; `status` is always `live` at creation; `startedAt`
// is stamped by the server via `FieldValue.serverTimestamp()`; no other
// lifecycle value is reachable through this write path.
// The delivery freeze (`SessionDeliveryFreeze`, §3.3) is intersected onto the
// creation write so every NEW session is durably stamped with its
// server-derived `deliveryOutcome` (and, iff differentiated, its exact
// presentation pair) at the single authoritative freeze point. The pair
// invariant is carried by the union: a differentiated write cannot omit the
// pair and a canonical/canonicalFallback write cannot carry one. Autosave uses
// `AssessmentSessionAutosaveWrite`, whose two-field shape structurally cannot
// touch these frozen fields (V4).
export type AssessmentSessionCreationWrite = {
  readonly studentId: string;
  readonly assignmentId: string;
  readonly classId: string;
  readonly teacherId: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly activityId: string;
  readonly assessmentId: string;
  readonly assessmentRevisionId: string;
  readonly sessionOrdinal: number;
  readonly status: "live";
  readonly startedAt: FieldValue;
} & SessionDeliveryFreeze;

// Autosave-write shape for the assessment-session update callable
// (assessmentSessionsAutosave). Conforms to
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6 and §14: only the
// student-authored `responses` array and the server-stamped
// `lastActivityAt` timing marker are ever mutated by autosave. Ownership
// fields, `sessionOrdinal`, `status`, and `startedAt` are intentionally
// absent from the write shape so no autosave can silently reassign
// ownership, advance the lifecycle, backdate the start moment, or promote
// a session that has been archived by the scheduled sweep (§10).
// Scoring artifacts (score, item-level correctness, points earned,
// explanations) are structurally impossible to write through this shape;
// the scorer produces those artifacts and writes them only to
// `attempts/{attemptId}` per §7.
export type AssessmentSessionAutosaveWrite = {
  readonly responses: readonly AssessmentSessionResponse[];
  readonly lastActivityAt: FieldValue;
};
