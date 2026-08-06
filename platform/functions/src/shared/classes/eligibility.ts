import { PlatformError } from "../errors/platform-error";
import type { ClassRecord, ClassStatus } from "../types/class";

// Shared class-lifecycle eligibility helper per Phase 2B Spec §4 and
// Phase 2B.0 Reader Audit §7. This helper is the single source of truth
// for the "may operation X proceed against a class in status Y?"
// question that every callable answers today with a bespoke inline
// check. Centralizing the rule table prevents drift between callables
// and avoids the "not archived, therefore usable" fallacy that will
// become an assignment-eligibility bug once `needsSetup` exists.
//
// The helper is trivially unit-testable: it never calls Firestore,
// never touches audit, never logs. It classifies a `ClassRecord`
// against a named operation and either returns cleanly or throws a
// canonical `PlatformError`.
//
// Error taxonomy preservation (per Reader Audit §13 R2): the historical
// error codes emitted by each callable today are preserved verbatim.
// Renaming the taxonomy across callables and their tests is out of
// scope for Phase 2B.1; the helper simply centralizes what each
// operation already threw. If Phase 2B.5 (or a later phase) elects to
// consolidate, it does so in one file rather than seven.

export type ClassOperation =
  | "activate"
  | "editMetadata"
  | "archive"
  | "assignDraft"
  | "teacherAddEnrollment"
  | "studentJoin"
  | "rosterSync"
  | "lmsLink";

type Verdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: string; readonly message: string };

const OK: Verdict = { ok: true };

const NOT_ACTIVATABLE: Verdict = {
  ok: false,
  code: "classes.notActivatable",
  message: "Class cannot be activated in its current state.",
};

const EDIT_METADATA_INVALID: Verdict = {
  ok: false,
  code: "classes.invalidStatus",
  message: 'Metadata update requires status "active".',
};

const ASSIGN_DRAFT_INVALID: Verdict = {
  ok: false,
  code: "assignments.invalidClassStatus",
  message: 'Assignment draft requires the class to be in status "active".',
};

const TEACHER_ADD_INVALID: Verdict = {
  ok: false,
  code: "enrollments.invalidClassStatus",
  message: 'Teacher-add enrollment requires the class to be in status "active".',
};

const STUDENT_JOIN_INVALID: Verdict = {
  ok: false,
  code: "enrollments.joinCodeNotFound",
  message: "No active class matches the supplied join code.",
};

const ROSTER_SYNC_INVALID: Verdict = {
  ok: false,
  code: "lms.classNotActive",
  message:
    "Class is not active; roster synchronization requires an active class.",
};

const LMS_LINK_INVALID: Verdict = {
  ok: false,
  code: "lms.classNotActive",
  message: "Class is not active; only active or needsSetup classes can be linked.",
};

// The rule table. Every (operation, status) pair has an explicit entry.
// A missing entry is a code bug; the compiler enforces exhaustiveness
// through the discriminated `ClassStatus` union.
function classify(op: ClassOperation, status: ClassStatus): Verdict {
  switch (op) {
    case "activate":
      switch (status) {
        case "active":
          return OK;
        case "needsSetup":
          return OK;
        case "archived":
          return NOT_ACTIVATABLE;
      }
      break;
    case "editMetadata":
      switch (status) {
        case "active":
          return OK;
        case "needsSetup":
          return EDIT_METADATA_INVALID;
        case "archived":
          return EDIT_METADATA_INVALID;
      }
      break;
    case "archive":
      switch (status) {
        case "active":
          return OK;
        case "needsSetup":
          return OK;
        case "archived":
          return OK;
      }
      break;
    case "assignDraft":
      switch (status) {
        case "active":
          return OK;
        case "needsSetup":
          return ASSIGN_DRAFT_INVALID;
        case "archived":
          return ASSIGN_DRAFT_INVALID;
      }
      break;
    case "teacherAddEnrollment":
      switch (status) {
        case "active":
          return OK;
        case "needsSetup":
          return TEACHER_ADD_INVALID;
        case "archived":
          return TEACHER_ADD_INVALID;
      }
      break;
    case "studentJoin":
      switch (status) {
        case "active":
          return OK;
        case "needsSetup":
          return STUDENT_JOIN_INVALID;
        case "archived":
          return STUDENT_JOIN_INVALID;
      }
      break;
    case "rosterSync":
      switch (status) {
        case "active":
          return OK;
        case "needsSetup":
          return ROSTER_SYNC_INVALID;
        case "archived":
          return ROSTER_SYNC_INVALID;
      }
      break;
    case "lmsLink":
      switch (status) {
        case "active":
          return OK;
        case "needsSetup":
          return OK;
        case "archived":
          return LMS_LINK_INVALID;
      }
      break;
  }
  // Unreachable given the discriminated union; retained as a defensive
  // guard so a future lifecycle addition surfaces here at runtime as
  // well as at compile time.
  return {
    ok: false,
    code: "classes.invalidStatus",
    message: `Unhandled class status "${String(status)}" for operation "${op}".`,
  };
}

// Static map from operation to the set of statuses that permit it.
// Used by the typed assertion overloads below so that a successful
// `assertClassSupports("editMetadata", record)` narrows `record` to the
// `ActiveClassRecord` arm and thereby exposes `grade`, `block`, and
// `joinCode` to the caller without a redundant runtime check.
type AllowedStatusFor = {
  activate: "active" | "needsSetup";
  editMetadata: "active";
  archive: "active" | "needsSetup" | "archived";
  assignDraft: "active";
  teacherAddEnrollment: "active";
  studentJoin: "active";
  rosterSync: "active";
  lmsLink: "active" | "needsSetup";
};

export type ClassRecordFor<Op extends ClassOperation> = Extract<
  ClassRecord,
  { readonly status: AllowedStatusFor[Op] }
>;

// Assert that `op` may proceed against `record`. Throws a canonical
// `PlatformError` on refusal; returns cleanly on success. The helper
// operates on the record's status alone; ownership, existence, and
// request-shape validation remain the caller's responsibility. On
// success TypeScript narrows `record` to the discriminated arms whose
// statuses permit `op`, per the `AllowedStatusFor` table.
export function assertClassSupports<Op extends ClassOperation>(
  op: Op,
  record: ClassRecord,
): asserts record is ClassRecordFor<Op> {
  const verdict = classify(op, record.status);
  if (verdict.ok) return;
  throw new PlatformError(verdict.code, verdict.message);
}

// Exported for unit tests that assert the table directly without going
// through the throwing surface. Not part of the public callable API.
export const __classifyForTests = classify;
