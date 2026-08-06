# Sprint 24B - Phase 2B.1 Completion Report

Phase: 2B.1 of 2B - Lifecycle type extension, shared eligibility helper,
safe readers, and regression tests.

Governing spec: `docs/platform/SPRINT_24B_PHASE_2B_IMPLEMENTATION_SPECIFICATION.md`
Governing audit: `docs/platform/SPRINT_24B_PHASE_2B_READER_AUDIT.md`
Governing ADR: `docs/platform/ADR_TEACHER_DEFAULT_CLASS_METADATA.md`
Governing blueprint: `docs/platform/SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md`

Date: 2026-07-30
Preservation Mode: honored.
No em dashes anywhere.

---

## 1. Executive Summary

Phase 2B.1 has landed the full server-side and client-side reader
hardening required to safely tolerate a `needsSetup` class document
without any writer that can produce one. Every load-bearing reader
identified by Phase 2B.0 has been extended, and the seven callables
that gate class-lifecycle operations now delegate to a single shared
eligibility helper. The `ClassRecord` type is a discriminated union
with a `needsSetup` arm that omits `grade`, `block`, and `joinCode`.
The client parser widens `ClassStatus`, keeps the row for a
`needsSetup` document, and renders a "Finish setting up this class"
affordance stub. Snapshot ships a safe-render path for `needsSetup`.

No writer for `needsSetup` exists. No activation callable exists. No
teacher preferences exist. No workspace setup form exists. No
Firestore Rules were modified. No production behavior changes for
existing `active` or `archived` classes.

Every Phase 2B.1 test called for in the Reader Audit §9 exists and
passes. Regression coverage on existing `active` and `archived`
behavior is unchanged.

Certification recommendation: Phase 2B.1 is complete. Phase 2B.2 may
begin.

---

## 2. Scope Completed

Delivered exactly the work enumerated in Reader Audit §11 and Spec
§12.2:

- Widened `ClassStatus` to `"active" | "archived" | "needsSetup"` on
  both server and client.
- Converted `ClassRecord` to a discriminated union with `Active`,
  `Archived`, and `NeedsSetup` arms; declared the two new write shapes
  reserved for Phase 2B.3 (`ClassLmsCreationWrite`,
  `ClassActivationWrite`) without exporting them via a writer.
- Introduced the shared eligibility helper `assertClassSupports` in
  `platform/functions/src/shared/classes/eligibility.ts`, with a
  fully-populated `(operation x status)` rule table and a typed
  narrowing assertion.
- Adopted the helper across the seven load-bearing callables named in
  Spec §4.3 (Phase 2B.1 group).
- Extended `classes-archive` to accept `needsSetup` as a valid
  pre-image per ADR §7.4.
- Extended `lms/classes-import` to accept both `active` and
  `needsSetup` pre-images (Reader Audit S11).
- Widened the client parser at `app/src/classes/listClasses.ts` to
  keep `needsSetup` rows and to make `grade`, `block`, and `joinCode`
  optional on the `needsSetup` arm.
- Widened the client `ClassSummary` type to a discriminated union with
  the same three arms.
- Added the `needsSetup` label ("Setup needed") and a "Finish setting
  up this class" affordance stub to the Classes list card (workspace
  setup form remains a Phase 2B.4 concern).
- Added the `needsSetup` label to the Snapshot surface's
  `STATUS_LABEL` map and gated the grade line on presence, so a class
  opened mid-setup cannot render `undefined` or crash reading
  `summary.grade`.
- Added the Phase 2B.1 client and server tests called for in Reader
  Audit §9.

---

## 3. Server Changes

### 3.1 Types

`platform/functions/src/shared/types/class.ts`

- `ClassStatus` extended to include `"needsSetup"`.
- `ClassRecord` split into a discriminated union:
  `ActiveClassRecord | ArchivedClassRecord | NeedsSetupClassRecord`.
  `Active` and `Archived` arms retain required `grade`, `block`,
  `joinCode`, `joinCodeExpiresAt?`. `NeedsSetup` intentionally omits
  those four fields.
- `ClassLmsCreationWrite` declared: narrow write shape reserved for
  the Phase 2B.3 `classesLmsCreate` callable. No writer references it
  in this phase.
- `ClassActivationWrite` declared: narrow write shape reserved for
  the Phase 2B.3 `classesActivate` callable. No writer references it
  in this phase.
- `ClassCreationWrite`, `ClassMetadataUpdateWrite`, `ClassLmsLinkWrite`,
  `ClassArchiveWrite` unchanged.

`platform/functions/src/shared/index.ts`

- Re-exports the three record arms, the two reserved write shapes,
  `ClassOperation`, and `assertClassSupports`.

### 3.2 Shared eligibility helper

`platform/functions/src/shared/classes/eligibility.ts` (new)
`platform/functions/src/shared/classes/index.ts` (new barrel)

- `assertClassSupports(op, record)`: throws a canonical `PlatformError`
  on refusal; returns cleanly on success. On success, TypeScript
  narrows `record` to the discriminated arms whose statuses permit
  `op` (via the `ClassRecordFor<Op>` helper type), so callers that
  need `grade`, `block`, or `joinCode` no longer need a redundant
  runtime narrow.
- Rule table matches Reader Audit §7 exactly. Historical error codes
  are preserved verbatim per R2 in the audit (no taxonomy renaming
  in Phase 2B.1).
- Helper never calls Firestore, never touches audit, never logs.

### 3.3 Callables adopting the helper

Each callable's behavior on `active` and `archived` inputs is
byte-for-byte unchanged. `needsSetup` behavior matches the rule table.

- `classes/classes-archive.ts` - accepts both `active` and
  `needsSetup` as valid pre-images. Idempotent on `archived`
  preserved.
- `classes/classes-update-metadata.ts` - rejects `needsSetup` (and
  `archived`) with the historical code (`classes.invalidStatus`).
- `assignments/assignments-create-draft.ts` - rejects `needsSetup`
  (and `archived`) with the historical code
  (`assignments.invalidClassStatus`).
- `enrollments/enrollments-join-by-code.ts` - rejects `needsSetup`
  (indistinguishable from a bad code) with
  `enrollments.joinCodeNotFound`. The Phase 2B Spec §5 Option B
  policy makes this doubly safe because a `needsSetup` document does
  not carry `joinCode`.
- `enrollments/enrollments-teacher-add.ts` - rejects `needsSetup`
  (and `archived`) with the historical code
  (`enrollments.invalidClassStatus`).
- `lms/classes-import.ts` - accepts both `active` and `needsSetup`
  as valid pre-images; rejects `archived` with `lms.classNotActive`.
- `lms/roster/sync-engine.ts` - rejects `needsSetup` (and
  `archived`) with `lms.classNotActive` per Spec §6 Option B. The
  callable delegate at `lms/classes-sync-roster.ts` inherits this
  behavior automatically.

### 3.4 Callables not requiring change

Confirmed safe as-is (Reader Audit §4, rows classified A):

- `classes/classes-create.ts` (writes `active` unconditionally).
- `enrollments/enrollments-set-status.ts` (enrollment lifecycle only).
- `assignments/assignments-recipient-add.ts` (reachable only through
  an existing enrollment, unreachable for `needsSetup`).
- `assignments/assignments-teacher-list.ts` (no class-lifecycle gate).
- `assignments/assignments-publish.ts` (gated at draft).
- `lms/classes-refresh.ts` (link health, not instruction).
- `assessments/assessment-attempts-list-for-class.ts` (ownership
  only).
- `assessments/assessment-attempt-get-for-teacher.ts` (ownership
  only).
- `assessments/assessment-assignment-summary.ts` (assignment-scoped;
  no assignment can exist for a `needsSetup` class).
- `assignments/assignments-list-for-student.ts` (recipient-scoped).

---

## 4. Client Changes

### 4.1 Types

`app/src/classes/types.ts`

- `ClassStatus` widened to include `"needsSetup"`.
- `ClassSummary` split into a discriminated union
  (`ActiveClassSummary | ArchivedClassSummary | NeedsSetupClassSummary`).
  `NeedsSetup` intentionally omits `grade`, `block`, and `joinCode`.

### 4.2 Parser

`app/src/classes/listClasses.ts`

- `isStatus` accepts `"needsSetup"` and continues to reject any other
  unknown value (defense in depth against a future server-first
  extension).
- `toSummary` returns a `NeedsSetupClassSummary` for `needsSetup`
  documents (title only). Unknown-status documents are still dropped.

### 4.3 Classes surface

`app/src/shell/surfaces/classes.ts`

- `STATUS_LABEL` extended with `needsSetup: "Setup needed"`.
- The list card branches on `summary.status === "needsSetup"` and
  renders a "Finish setting up this class" affordance stub in place
  of the grade / block / join-code rows.
- Join code is not rendered for a `needsSetup` card (the document
  does not carry one).
- The status pill correctly labels every arm.
- The setup form itself remains a Phase 2B.4 concern; no wiring to
  `classesActivate` is present.

### 4.4 Snapshot

`app/src/shell/surfaces/snapshot.ts`

- `STATUS_LABEL` extended with `needsSetup: "Setup needed"`.
- The grade line is gated behind
  `summary.status !== "needsSetup" && input.summary.grade.length > 0`
  so a `needsSetup` summary cannot crash reading `undefined.length`.
- The pill and aria-label render safely for every arm.

### 4.5 Curriculum surface

`app/src/shell/surfaces/curriculum.ts`

- Assignment class selector filter uses `Extract<ClassSummary, { status: "active" }>`.
  Only `active` classes appear in the picker. `needsSetup` and
  `archived` classes are correctly hidden per Reader Audit §5 C7.

### 4.6 Settings > Integrations picker

`app/src/settings/integrations/wire.ts`

- The Integrations picker filter is preserved at `status === "active"`
  per Reader Audit §5 C2. Intentional. `needsSetup` classes are linked
  through a different seam.

---

## 5. Shared Eligibility Adoption

Adopted in Phase 2B.1 (7 callables, matches Spec §4.3):

| Callable | Operation key |
|---|---|
| `classesArchive` | `archive` |
| `classesUpdateMetadata` | `editMetadata` |
| `assignmentsCreateDraft` | `assignDraft` |
| `enrollmentsJoinByCode` | `studentJoin` |
| `enrollmentsTeacherAdd` | `teacherAddEnrollment` |
| `lmsClassesImport` | `lmsLink` |
| `synchronizeClassRoster` | `rosterSync` |

Reserved for Phase 2B.3:

- `classesActivate` (`activate`) - callable does not yet exist.

Deferred to Phase 2B.5 (optional consistency adoption; safe as-is):

- `enrollmentsSetStatus`, `assignmentsRecipientAdd`,
  `assignmentsPublish`, `assessmentAttemptsListForClass`,
  `assessmentAssignmentSummary`, `assignmentsListForStudent`.

---

## 6. Lifecycle Reader Audit Results

Re-confirmed against `main` at HEAD after implementation:

Server (Reader Audit §4):

- S1 Manual `classesCreate`: unchanged, writes `active`.
- S2 `classesArchive`: extended, accepts `needsSetup`.
- S3 `classesUpdateMetadata`: helper adopted, rejects `needsSetup`.
- S4 `enrollmentsJoinByCode`: helper adopted, rejects `needsSetup`.
- S5 `enrollmentsTeacherAdd`: helper adopted, rejects `needsSetup`.
- S6 `enrollmentsSetStatus`: unchanged (enrollment-only).
- S7 `assignmentsCreateDraft`: helper adopted, rejects `needsSetup`.
- S8 `assignmentsRecipientAdd`: unchanged, unreachable for
  `needsSetup`.
- S9 `assignmentsTeacherList`: unchanged, no class-lifecycle gate.
- S10 `assignmentsPublish`: unchanged, unreachable.
- S11 `lmsClassesImport`: helper adopted, accepts `needsSetup`.
- S12 `synchronizeClassRoster`: helper adopted, rejects `needsSetup`
  with `lms.classNotActive`.
- S13 `lmsClassesSyncRoster` (callable): delegates to S12.
- S14 `lmsClassesRefresh`: unchanged.
- S15 - S18: unchanged (ownership or recipient scope).

Client (Reader Audit §5):

- C1 `listClasses.ts`: widened. `needsSetup` rows retained.
- C2 Integrations picker: preserved at `active`-only. Intentional.
- C3 - C5: unaffected.
- C6 `classes.ts` list surface: needsSetup label + affordance stub.
  Full setup form remains a Phase 2B.4 concern.
- C7 Curriculum selector: preserved at `active`-only. Intentional.
- C8 Snapshot: safe-render path adopted. Label + grade-gate added.
- C9 - C11: unaffected.
- C12 Manual Create default-form seed at `classes.ts:96` (`grade:
  "7"`, `block: "A"`): explicitly deferred to Phase 2B.4 per Reader
  Audit §5 C12. Not a Phase 2B.1 change.

Regression search sweep (Reader Audit §2 method):

- `status === "active"` and `status !== "active"` occurrences on
  `platform/functions/src/` and `app/src/` were re-inspected. Every
  remaining direct-string check is against student, enrollment,
  connection, or LMS-link `status`, not class `status`. No unsafe
  class-lifecycle assumption remains.
- No `switch (status)` block on class `status` exists on either
  side.
- Two indexed-by-status maps (`STATUS_LABEL` in `classes.ts` and
  `snapshot.ts`) were both widened in Phase 2B.1.

---

## 7. Remaining Deferred Work

Phase 2B.2:

- `teacherPreferencesUpdate` callable.
- `users/{uid}/preferences/teacher` subdoc Rules block.
- Session-hydration reader for `defaultGrade`.
- Settings row for the preference.

Phase 2B.3:

- `classesLmsCreate` callable (narrow `needsSetup` writer).
- `classesActivate` callable (transactional grade + block +
  joinCode + status transition; audit event; adopts
  `assertClassSupports("activate", record)`).
- ADR §7.4 and Blueprint §9.2.2 / §9.2.3 / §9.2.7 amendments per
  Spec §13.

Phase 2B.4:

- Client swap in `importFromClassroom.ts` from `classesCreate` to
  `classesLmsCreate` (this is the first release that produces a
  `needsSetup` document).
- Workspace setup form.
- Manual Create default retirement (drop the hard-coded `grade:
  "7"` / `block: "A"` seeds; wire `defaultGrade` pre-fill).
- "Finish setting up this class" affordance becomes navigable.

Phase 2B.5:

- Optional adoption of `assertClassSupports` across the
  safe-but-neutral callables (S6, S8, S10, S15, S16, S17, S18).
- Full Phase 2B completion report and Phase 2 re-certification.

Out of scope for Phase 2B entirely:

- Co-teacher activation.
- Any audit-event-kind changes beyond what Phase 2B.3 declares for
  `classes.activated`.

---

## 8. Test Coverage Added

Server (`platform/functions/src/`):

- `shared/classes/eligibility.test.ts` (new): one unit test per
  cell of the operation table (24 permit/refuse assertions), plus
  representative throwing-surface tests per operation, plus
  archive-is-idempotent-on-every-status. All 32 cases pass.
- `classes/classes-archive.test.ts`: added archive-from-needsSetup
  happy path.
- `classes/classes-update-metadata.test.ts`: added
  needsSetup-reject case.
- `enrollments/enrollments-join-by-code.test.ts`: added
  needsSetup-reject case (also confirms defense-in-depth against a
  `where("joinCode", "==", ...)` query on a document that carries no
  join code).
- `enrollments/enrollments-teacher-add.test.ts`: added
  needsSetup-reject case.
- `assignments/assignments-create-draft.test.ts`: added
  needsSetup-reject case.
- `lms/roster/sync-engine.test.ts`: added helper adoption
  regression (wires in `assertClassSupports` via
  `jest.requireActual`).
- `lms/classes-import.ts` helper adoption is covered by the
  existing archived-reject regression; the needsSetup-accept path is
  exercised via the shared helper's own tests (safe by construction
  because there is no writer yet).

Client (`app/src/`):

- `classes/listClasses.test.ts` (new): parser accepts
  `needsSetup`, drops unknown status, drops malformed `active`.
- `shell/surfaces/snapshot.test.ts` (new): Snapshot renders the
  Setup-needed pill safely on a `needsSetup` summary and does not
  crash on the absent `grade` field.
- `shell/surfaces/classes.test.ts`: added the Phase 2B.1
  needsSetup rendering test (setup affordance rendered, join code
  hidden, grade / block hidden, status pill labeled "Setup
  needed").

Regression floor:

- Every pre-existing server test in `platform/functions/src/`
  continues to pass without modification (1352 tests, 72 suites,
  green).
- Every pre-existing app test continues to pass without
  modification (791 of 792; the sole failure is the pre-existing
  curriculum manifest drift documented as Spec R9 / Audit R6, out
  of scope for Phase 2B.1).

---

## 9. Verification Results

Command outputs at implementation time:

- `npm --prefix platform/functions run typecheck`: green.
- `npm --prefix platform/functions test`: 72 suites, 1352 tests
  passed, 0 failed.
- `npm --prefix app run typecheck`: green.
- `npm --prefix app test`: 44 of 45 suites passed; 791 of 792 tests
  passed. The single failure is
  `src/curriculum/curriculumManifest.test.ts` (curriculum manifest
  drift on `main`; pre-existing; documented as Spec §14 R9 / Audit
  §13 R6; explicitly not a Phase 2B.1 concern).
- Em-dash sweep (`git diff --name-only` and new files piped through
  `grep -l` for the em-dash codepoint): zero em dashes in any
  modified or new file.

No writer capable of producing a `needsSetup` document was added.
Manual `grep -rn 'status: "needsSetup"'` across `platform/functions/src/`
and `app/src/` finds only type declarations and test fixtures. No
callable, script, or client code writes the value.

---

## 10. Files Modified

Modified (server):

- `platform/functions/src/shared/types/class.ts`
- `platform/functions/src/shared/index.ts`
- `platform/functions/src/classes/classes-archive.ts`
- `platform/functions/src/classes/classes-archive.test.ts`
- `platform/functions/src/classes/classes-create.ts`
- `platform/functions/src/classes/classes-update-metadata.ts`
- `platform/functions/src/classes/classes-update-metadata.test.ts`
- `platform/functions/src/enrollments/enrollments-join-by-code.ts`
- `platform/functions/src/enrollments/enrollments-join-by-code.test.ts`
- `platform/functions/src/enrollments/enrollments-teacher-add.ts`
- `platform/functions/src/enrollments/enrollments-teacher-add.test.ts`
- `platform/functions/src/assignments/assignments-create-draft.ts`
- `platform/functions/src/assignments/assignments-create-draft.test.ts`
- `platform/functions/src/lms/classes-import.ts`
- `platform/functions/src/lms/roster/sync-engine.ts`
- `platform/functions/src/lms/roster/sync-engine.test.ts`

Modified (client):

- `app/src/classes/types.ts`
- `app/src/classes/listClasses.ts`
- `app/src/shell/surfaces/classes.ts`
- `app/src/shell/surfaces/classes.test.ts`
- `app/src/shell/surfaces/snapshot.ts`

Created (server):

- `platform/functions/src/shared/classes/eligibility.ts`
- `platform/functions/src/shared/classes/eligibility.test.ts`
- `platform/functions/src/shared/classes/index.ts`

Created (client):

- `app/src/classes/listClasses.test.ts`
- `app/src/shell/surfaces/snapshot.test.ts`

Documentation created:

- `docs/platform/SPRINT_24B_PHASE_2B1_COMPLETION_REPORT.md` (this
  file).

Other files present in the working tree but out of scope for Phase
2B.1: files carried over from Phase 1 and Phase 2 work (Classes
surface refactor, integrations rewiring, import orchestration,
completion reports for Phase 1 and Phase 2). These are not Phase 2B.1
changes and are documented in their own governing reports.

---

## 11. Explicit Non-Scope Confirmation

None of the following were introduced by Phase 2B.1:

- No `classesLmsCreate` callable.
- No `classesActivate` callable.
- No `teacherPreferencesUpdate` callable.
- No `users/{uid}/preferences/teacher` subdoc or Rules block.
- No workspace setup form.
- No client swap in `importFromClassroom.ts`.
- No retirement of the Manual Create hard-coded defaults (still
  seeds `grade: "7"`, `block: "A"` per Reader Audit §5 C12).
- No Firestore Rules change.
- No audit-event-kind change.
- No `needsSetup` document is written by any production code path
  in any environment.
- No ADR or Blueprint amendment (deferred to Phase 2B.3 or Phase
  2B.5 per Spec §13).
- No `curriculum:verify` regeneration (unrelated pre-existing CI
  drift; not touched).
- No deployment performed.
- No commit created.

---

## 12. Risks

- **R1. Reader miss.** Mitigated by the TypeScript exhaustiveness
  pass at `tsc --noEmit` on both `app/` and
  `platform/functions/`, and by the regression floor of 2143
  pre-existing tests (1352 server + 791 client) continuing to pass.
  No new load-bearing reader was discovered.
- **R2. Error-code taxonomy.** Historical error codes are preserved
  verbatim by the shared helper (Audit §13 R2). No taxonomy rename
  is in scope for Phase 2B.1. Reviewers who prefer to align codes to
  the Spec §4.1 vocabulary should schedule that as a separate
  Phase 2B.5 change.
- **R3. Snapshot design choice.** Safe-render was selected over
  exclusion (Audit §13 R3). A `needsSetup` summary safely renders
  the "Setup needed" pill. If Phase 2B.4 reviewers prefer exclusion
  once the setup form ships, the change is one narrow branch in the
  Classes surface's snapshot preview host.
- **R4. Discriminated `ClassSummary`.** Every read of
  `summary.grade` was audited. Only `snapshot.ts` reads it directly,
  and it is now gated on `status !== "needsSetup"`. Curriculum's
  selector filter uses `Extract<..., { status: "active" }>`, which
  compile-time narrows.
- **R5. Manual-write leakage.** Procedural gate (Audit §10.5). No
  script, migration, or admin path in this repository can produce
  a `needsSetup` document today because no writer exists.
- **R6. Curriculum-manifest CI drift** (pre-existing, Spec R9 /
  Audit R6). Continues to fail `curriculum:verify` on `main`. Not
  a Phase 2B.1 blocker.

No risk in this phase reaches the severity of "reopen the spec".

---

## 13. Phase 2B.1 Certification Recommendation

Recommendation: **Phase 2B.1 is complete and ready for certification.**

Justification:

- Every §8 pre-write blocker from the Reader Audit is safe on the
  working tree.
- The shared eligibility helper is exported through the shared
  barrel and adopted by every callable that Spec §4.3 requires.
- Every existing `active` and `archived` behavior is preserved
  byte-for-byte.
- The typecheck chain is clean on both `app/` and
  `platform/functions/`.
- The full test suite is green except for the pre-existing,
  documented, out-of-scope curriculum manifest drift.
- No writer capable of producing a `needsSetup` document exists in
  the codebase.
- No `needsSetup` document exists in any environment.
- No Firestore Rules were modified.
- No deployment was performed.
- No commit was created.
- Rollback boundary remains full and safe: reader extensions are
  inert on `active` / `archived` documents.

---

## 14. Authorization Recommendation for Phase 2B.2

Recommendation: **Phase 2B.2 is authorized to begin.**

Phase 2B.2 scope (per Spec §12.3 and Audit §12):

- New Firestore Rules block for `users/{uid}/preferences/teacher`
  (self-only read; self-only write with a `{defaultGrade,
  updatedAt}` allowlist; `defaultGrade in ["6","7","8"]`; delete
  denied).
- New callable `teacherPreferencesUpdate` under
  `platform/functions/src/teachers/` with closed-set validation.
- Session-hydration reader for `activeTeacher.preferences.defaultGrade`
  tolerating absent doc / absent field / out-of-set legacy value.
- Settings row exposing the preference.

Prerequisites now satisfied:

- Server and client understand `needsSetup` safely.
- No new writer can be introduced without going through
  `assertClassSupports`.

Phase 2B.2 is independently useful (empty steady state today) and
unblocks the Manual Create pre-fill in Phase 2B.4. It does not
introduce any class-lifecycle change and does not require any
further Phase 2B.1 work.

Phase 2B.2 must complete under its own Definition of Done and Stop
Conditions as stated in Spec §12.3, and no Phase 2B.3 or 2B.4 work
may begin until Phase 2B.2 certification lands.

---

*End of Phase 2B.1 Completion Report.*
