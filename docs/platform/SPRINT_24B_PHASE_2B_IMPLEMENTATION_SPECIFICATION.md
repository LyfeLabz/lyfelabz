# Sprint 24B - Phase 2B Implementation Specification

Status: Ratified. Implementation-ready specification. This document
is the sole authorization envelope for Phase 2B work. No production
code, tests, or Rules changes are authorized by any other document.

Date: 2026-07-30
Governing ADR: `docs/platform/ADR_TEACHER_DEFAULT_CLASS_METADATA.md`
Governing Blueprint: `docs/platform/SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md` §9.2
De-certified prior Phase: `docs/platform/SPRINT_24B_PHASE_2_COMPLETION_REPORT.md`

No em dashes. Spaced hyphens (" - ") throughout.

---

## 1. Executive Summary

The Phase 2 audit uncovered that Google Classroom import persists
`grade: "7"` and `block: "A"` on every imported class. The ratified
resolution introduces:

- A teacher `defaultGrade` convenience preference (optional-absent).
- No teacher `defaultBlock`. Block is per-class.
- A `needsSetup` value on the existing `ClassStatus` field.
- A narrow LMS-authored creation seam that omits grade and block.
- A narrow activation callable that atomically writes grade and block
  and transitions status to `active`.
- A workspace-hosted one-screen setup form as the sole teacher-facing
  activation surface.

This specification tightens the ratification against the actual
architecture. Firestore Security Rules do not govern trusted Admin
SDK writes; every callable-side eligibility guard and every reader
must therefore be positioned deliberately. Section 2 corrects the
enforcement model. Section 3 lists every load-bearing class reader
that must be verified before a `needsSetup` document is ever written.
Sections 4 through 9 finalize the eligibility helper, join-code
policy, roster-sync policy, creation seam, activation contract, and
preference contract. Sections 10 through 12 finalize the
compatibility, rollout, and unit-sequencing plans. Section 15
identifies the first implementation unit.

Phase 2B remains the required prerequisite for Phase 3. Phase 2 is
de-certified.

---

## 2. Corrected Enforcement Model

### 2.1 What Firestore Rules govern

Firestore Security Rules bind only direct-client Firestore access
authenticated as an end user. In this codebase (`firestore.rules`),
every mutation of `classes/{classId}`, `enrollments/{enrollmentId}`,
`assignments/{assignmentId}`, `lmsClassLinks/{linkId}`,
`lmsConnections/{connectionId}`, `submissions/{submissionId}`,
`attempts/{attemptId}`, `assessmentSessions/{sessionId}`,
`auditEvents/{eventId}`, and `externalIdentities/{id}` is denied to
clients; the sole writers are Cloud Functions callables that use the
Firebase Admin SDK.

The Admin SDK bypasses Security Rules. Any statement that Rules
"enforce" a needsSetup restriction on a class write, an assignment
publish, an enrollment create, or a roster sync is factually
incorrect. The ADR §7.4 sentence "Firestore Rules must enforce every
'not permitted' item above at the rules boundary" and the
Blueprint §9.2.2 bullets "Assignment write guards: extend to reject"
and "Join-code enrollment: reject" are read as callable-layer
requirements, not Rules-layer requirements. Section 11 of this
document supersedes those statements.

Rules do usefully constrain:

- Direct-client reads of `classes/{classId}` and `classes` list
  queries (owner-scoped only).
- Direct-client reads of `enrollments`, `assignments`,
  `submissions`, `attempts`, and LMS records.
- Direct-client writes: default-deny; no client write exists on any
  class-adjacent collection today, and Phase 2B does not introduce
  one.
- A new `users/{uid}/preferences/teacher` subdoc: reads and writes
  are direct-client and therefore governed by Rules.

### 2.2 Enforcement layers

Every operation Phase 2B touches must locate its enforcement in at
least one authoritative layer:

- **A. Firestore Rules** - direct client reads and writes only.
- **B. Callable authorization and domain validation** - the callable
  binds actor identity to a role, verifies ownership on the target
  document, and validates the request shape. This is the primary
  gate for Admin SDK writes.
- **C. Shared server eligibility helper** - a small in-repo helper
  that classifies a `ClassRecord` for a given operation. Adopting the
  helper prevents drift between callables and avoids the "not
  archived, therefore usable" fallacy. See §4.
- **D. Client UX gating** - hides or disables affordances a
  `needsSetup` class is not permitted to trigger. This is
  discoverability, never security.

### 2.3 Enforcement matrix

Each row identifies where the operation runs, which layers gate it
today, and the expected behavior for each class status after Phase 2B.

| # | Operation | Path | A. Rules | B. Callable | C. Helper | D. UX | active | needsSetup | archived |
|---|---|---|---|---|---|---|---|---|---|
| 1 | Create manual class | Callable `classesCreate` | n/a (client write denied) | teacher role + district + shape | not applicable (no target) | Create form | writes `active` | not written by this seam | not written by this seam |
| 2 | Create imported class | Callable `classesLmsCreate` (new, §7) | n/a | teacher role + district + shape | not applicable (creation) | Import flow | not written by this seam | writes `needsSetup` | not written by this seam |
| 3 | Activate class | Callable `classesActivate` (new, §8) | n/a | teacher role + ownership + grade + block validation | `assertClassSupports("activate", record)` | Setup form | idempotent success | atomic transition to `active` | reject `classes.notActivatable` |
| 4 | Update metadata | Callable `classesUpdateMetadata` | n/a | teacher role + ownership | `assertClassSupports("editMetadata", record)` | Metadata form | permitted | reject `classes.notActive` (metadata is set by activation) | reject `classes.notActive` (existing behavior) |
| 5 | Archive class | Callable `classesArchive` | n/a | teacher role + ownership | `assertClassSupports("archive", record)` | Archive control | permitted | permitted (adopts §4 rule extension) | idempotent success (existing) |
| 6 | List classes | Client direct read | teacher owner list rule | n/a | n/a | Renders list | include | include with "Finish setting up" affordance | include (existing archive filter) |
| 7 | Read class doc | Client direct read | owner get | n/a | n/a | Workspace | render active workspace | render setup form | render archived workspace |
| 8 | Class workspace | Client only | (Rules on the read) | n/a | client-side helper `isInstructionEligible` mirrors §4 | Setup form vs roster | roster + actions | setup form only; no roster; no header actions | archived read-only |
| 9 | Create assignment draft | Callable `assignmentsCreateDraft` | n/a | teacher role | `assertClassSupports("assignDraft", record)` | Curriculum picker filters | permitted | reject `assignments.classNotActive` (existing) | reject (existing) |
| 10 | Assignment publish | Callable `assignmentsPublish` | n/a | teacher role + assignment ownership | not applicable (already gated via draft) | Publish action | permitted | unreachable (no draft can target needsSetup) | unreachable |
| 11 | Recipient add | Callable `assignmentsRecipientAdd` | n/a | teacher role + assignment ownership + enrollment status | not applicable | Add student | permitted | unreachable | unreachable |
| 12 | Curriculum class selector | Client-side filter | n/a | n/a | client-side `isAssignEligible(record)` | Filters list | selectable | hidden | hidden (existing) |
| 13 | Join-code lookup / enrollment | Callable `enrollmentsJoinByCode` | n/a | student role + school scope | `assertClassSupports("studentJoin", record)` | Join code entry | permitted | reject `enrollments.joinCodeNotFound` (existing "active"-only guard) | reject (existing) |
| 14 | Teacher-add enrollment | Callable `enrollmentsTeacherAdd` | n/a | teacher role + ownership | `assertClassSupports("teacherAddEnrollment", record)` | Add student | permitted | reject `classes.notActive` (existing) | reject (existing) |
| 15 | Enrollment status update | Callable `enrollmentsSetStatus` | n/a | teacher role + ownership | not applicable (enrollment-only) | Roster actions | permitted | unreachable (no enrollments exist) | permitted |
| 16 | Roster synchronization | Callable `lmsClassesSyncRoster` | n/a | teacher role + ownership | `assertClassSupports("rosterSync", record)` | Sync button | permitted | see §6 (deferred until active) | reject (existing "active"-only) |
| 17 | LMS import (link) | Callable `lmsClassesImport` | n/a | teacher role + ownership | `assertClassSupports("lmsLink", record)` | Import flow | permitted (existing) | permitted (§7 requires extension) | reject (existing) |
| 18 | LMS refresh / health | Callable `lmsClassesRefresh` | n/a | teacher role + ownership | not applicable (link-scoped) | Panel | permitted | permitted (link exists but instruction gated) | reject |
| 19 | Snapshot / assignment summary | Callable `assessmentAssignmentSummary` | n/a | teacher role + ownership | not applicable (assignment-scoped) | Snapshot | permitted | unreachable (no assignments) | existing |
| 20 | Attempts list for class | Callable `assessmentAttemptsListForClass` | n/a | teacher role + ownership | not applicable (attempt-scoped) | Reports | permitted | unreachable | existing |
| 21 | Student class access | Client (assignments-list-for-student) | n/a | student callable | not applicable (assignment-scoped) | Student home | permitted | unreachable | permitted for archived |
| 22 | Preference read | Client direct read | owner get on `users/{uid}/preferences/teacher` | n/a | n/a | Settings row | reads present or absent | same | same |
| 23 | Preference write | Callable `teacherPreferencesUpdate` (new, §9) OR direct client update | If direct: owner + shape allowlist | teacher role + closed-set validation | n/a | Settings row | permitted | same | same |

The matrix is the authoritative reference for reviewers. Any Phase 2B
change that touches an operation must cite its row.

### 2.4 Rules-side scope for Phase 2B

Phase 2B introduces exactly one new Rules block:

- `users/{uid}/preferences/teacher` - self-only read; self-only
  update / create limited to an allowlist of `{ defaultGrade,
  updatedAt }`; explicit delete denied (or permitted per §9 decision).
  The closed-set validation of `defaultGrade` is enforced on the
  callable path; a Rules-side shape guard is defense in depth.

No other Rules edit is authorized by Phase 2B. In particular:

- No Rules change to `classes/{classId}` is required or authorized.
  The existing owner-scoped `get` and `list` rules already handle
  `needsSetup` correctly (they discriminate only on `teacherId`).
- The Rules block on `classes` intentionally does not attempt to
  restrict `needsSetup` writes; those writes are Admin SDK writes
  and are outside the Rules boundary.

---

## 3. Reader-Audit Findings

This section is a snapshot of every load-bearing class reader
inspected during Phase 2B specification. It is not exhaustive; the
Phase 2B.0 unit re-runs this audit against `main` at implementation
time. No `needsSetup` document is written until every row marked
"required before first needsSetup write" is safe.

### 3.1 Server-side readers

| # | File | Function / surface | Current assumption | Effect of needsSetup today | Required Phase 2B change | Required before first needsSetup write | Test requirement |
|---|---|---|---|---|---|---|---|
| S1 | `platform/functions/src/classes/classes-create.ts` | `classesCreateHandler` | writes `status: "active"` unconditionally | n/a (no read of existing needsSetup) | none (Manual Create keeps writing `active`) | no | no |
| S2 | `platform/functions/src/classes/classes-archive.ts` | `classesArchiveHandler` | narrows `existing.status` to `"active"` after archived idempotency check | would silently write `status: "archived"` from `needsSetup` | extend guard to accept both `active` and `needsSetup` (per ADR §7.4 archive allowance) | yes | archive-from-needsSetup test |
| S3 | `platform/functions/src/classes/classes-update-metadata.ts` | `classesUpdateMetadataHandler` | requires `existing.status === "active"` | `classes.notActive` reject | keep reject; metadata for `needsSetup` flows through activation | yes (verify) | needsSetup reject test |
| S4 | `platform/functions/src/enrollments/enrollments-join-by-code.ts` | `resolveClassByJoinCode` | requires `record.status === "active"` | `enrollments.joinCodeNotFound` reject | keep reject; documented in §5 | yes (verify) | needsSetup reject test |
| S5 | `platform/functions/src/enrollments/enrollments-teacher-add.ts` | handler | requires `classRecord.status === "active"` | reject | keep reject | yes (verify) | needsSetup reject test |
| S6 | `platform/functions/src/enrollments/enrollments-set-status.ts` | handler | reads class for ownership; does not check `status` (enrollment lifecycle only) | no effect | none | no | none |
| S7 | `platform/functions/src/assignments/assignments-create-draft.ts` | handler | requires `classRecord.status === "active"` | reject | keep reject | yes (verify) | needsSetup reject test |
| S8 | `platform/functions/src/assignments/assignments-recipient-add.ts` | handler | operates on enrollment; enrollment cannot exist for needsSetup class (S5, S4) | unreachable | none | no | reachability regression |
| S9 | `platform/functions/src/assignments/assignments-teacher-list.ts` | `listForTeacher` | reads assignments only; class read is used to project display metadata; does not require `active` on class | assignments referencing a class transitioned needsSetup->active continue to resolve | verify no filter drops the row unexpectedly | no | none |
| S10 | `platform/functions/src/assignments/assignments-publish.ts` | handler | operates on assignment `status`; class already gated at draft | unreachable | none | no | reachability regression |
| S11 | `platform/functions/src/lms/classes-import.ts` | `handler` | requires `classRecord.status === "active"` before linking | reject on a freshly created `needsSetup` class - blocks the new orchestration | extend guard to accept `"active"` OR `"needsSetup"`; keep archived reject | yes | needsSetup link happy-path test |
| S12 | `platform/functions/src/lms/roster/sync-engine.ts` | `synchronizeClassRoster` | requires `classRecord.status === "active"` | reject | policy decision in §6; if Option B (recommended), keep reject and add explicit `lms.classNotActive` error code | yes (verify) | needsSetup reject test |
| S13 | `platform/functions/src/lms/classes-sync-roster.ts` | callable | delegates to S12 | see S12 | see S12 | yes | see S12 |
| S14 | `platform/functions/src/lms/classes-refresh.ts` | handler | operates on `lmsClassLinks` only; does not gate on class `status` | link health can be refreshed for a needsSetup class | none (health is not instruction) | no | none |
| S15 | `platform/functions/src/assessments/assessment-attempts-list-for-class.ts` | handler | verifies class ownership; does not require `active` | no effect (no attempts exist for needsSetup class) | none | no | reachability regression |
| S16 | `platform/functions/src/assessments/assessment-attempt-get-for-teacher.ts` | handler | verifies class ownership; does not require `active` | no effect | none | no | none |
| S17 | `platform/functions/src/assessments/assessment-assignment-summary.ts` | handler | verifies class + assignment; assignment already gated at draft | unreachable | none | no | reachability regression |
| S18 | `platform/functions/src/assignments/assignments-list-for-student.ts` | handler | operates on recipient docs; no recipient can exist for needsSetup class | unreachable | none | no | reachability regression |

### 3.2 Client-side readers

| # | File | Surface | Current assumption | Effect of needsSetup today | Required Phase 2B change | Required before first needsSetup write | Test requirement |
|---|---|---|---|---|---|---|---|
| C1 | `app/src/classes/listClasses.ts` | `isStatus` union `"active" \| "archived"` and `toSummary` filter | needsSetup document rejected by `toSummary` returning `null` | **class disappears from teacher's list** | extend `ClassStatus` union to include `"needsSetup"`; keep row in the summary; extend `ClassSummary` type accordingly | yes (load-bearing) | needsSetup document renders |
| C2 | `app/src/settings/integrations/wire.ts:416` | `createListTeacherClasses` filter | filters to `status === "active"` for Integrations panel projection | needsSetup class hidden from Integrations picker | keep filter (Integrations picker is for classes already ready to link; needsSetup classes are linked by a different seam) | no (behavior desirable) | ensure filter is intentional |
| C3 | `app/src/settings/integrations/integrations.ts:187` | LMS import picker | filters to `status === "active"` | same as C2 | keep (defensive) | no | none |
| C4 | `app/src/classes/importFromClassroom.ts:191` | `findActiveConnection` for connections (not classes) | operates on LMS connection status | no class effect | none | no | none |
| C5 | `app/src/classes/importFromClassroom.ts:374` | pre-check duplicate against `listTeacherClasses` | reads only active classes (via C2) | duplicate needsSetup class not detected client-side; server-side `alreadyLinked` still catches | acceptable; the server-side check is authoritative | no | none |
| C6 | `app/src/shell/surfaces/classes.ts` | Classes list rendering + import workflow | renders `ClassSummary` rows; opens workspace | needsSetup class must render "Finish setting up this class" affordance and hide join code / assignment destination surfaces | add branch on `status === "needsSetup"` throughout renderer; setup form workspace state | yes (list must render sensibly) | needsSetup renders correctly |
| C7 | `app/src/shell/surfaces/curriculum.ts:1178` | assignment curriculum class selector filter | filters to `status === "active"` | needsSetup class hidden from assignment picker | keep filter (desired: cannot assign to needsSetup) | no | none |
| C8 | `app/src/shell/surfaces/snapshot.ts` | Snapshot summary | reads `ClassSummary.status`; renders `STATUS_LABEL[status]` | uses `Record<"active" \| "archived", string>` - unindexed access on `needsSetup` will render `undefined` | add `"needsSetup"` entry to `STATUS_LABEL` (or an explicit exclude filter that hides needsSetup from Snapshot metrics) | yes | needsSetup exclusion / label test |
| C9 | `app/src/session/consistency.ts:36` | session consistency guard on user record | inspects user `status`, not class | no effect | none | no | none |
| C10 | Any other exhaustive TypeScript `switch (status)` | search will be re-run in Phase 2B.0 | may fail to compile once the union extends | benefits Phase 2B: the compiler surfaces every missed reader | resolve every missing arm | yes | typecheck-driven audit |

### 3.3 The rule

No `needsSetup` write path is deployed before every row marked
"required before first needsSetup write" (S2, S3, S4, S5, S7, S11,
S12/S13, C1, C6, C8) is verified safe by a passing test on `main`.
This gate is Phase 2B.1's definition of done.

---

## 4. Shared Eligibility Contract

### 4.1 Recommendation

Introduce one small server-side helper in
`platform/functions/src/shared/classes/`, exported through the
existing shared barrel. It classifies a `ClassRecord` against a
named operation and either returns cleanly or throws a
`PlatformError`. Suggested surface, subject to name confirmation at
implementation time:

```
type ClassOperation =
  | "activate"        // needsSetup -> active
  | "editMetadata"    // classesUpdateMetadata
  | "archive"         // classesArchive
  | "assignDraft"     // assignmentsCreateDraft
  | "teacherAddEnrollment"
  | "studentJoin"     // enrollmentsJoinByCode
  | "rosterSync"      // lmsClassesSyncRoster (see §6)
  | "lmsLink"         // lmsClassesImport
  ;

function assertClassSupports(op: ClassOperation, record: ClassRecord): void;
```

The helper owns one rule table. Each `(op, status)` entry either
returns cleanly or throws a canonical `PlatformError` with an
operation-specific code:

| Operation | active | needsSetup | archived |
|---|---|---|---|
| activate | ok (idempotent) | ok | throw `classes.notActivatable` |
| editMetadata | ok | throw `classes.notActive` | throw `classes.notActive` |
| archive | ok | ok | ok (idempotent) |
| assignDraft | ok | throw `assignments.classNotActive` | throw `assignments.classNotActive` |
| teacherAddEnrollment | ok | throw `classes.notActive` | throw `classes.notActive` |
| studentJoin | ok | throw `enrollments.joinCodeNotFound` (indistinguishable from unknown code) | throw `enrollments.joinCodeNotFound` |
| rosterSync | ok | see §6 decision | throw `lms.classNotActive` |
| lmsLink | ok | ok | throw `lms.classNotActive` |

The helper never calls Firestore, never touches audit, never logs.
It is trivially unit-testable.

### 4.2 Why one helper

- Prevents callables from independently expressing a rule like
  "anything not archived is usable" - a fallacy that becomes an
  assignment-eligibility bug once `needsSetup` exists.
- Centralizes the error taxonomy so callers stay consistent.
- Makes future lifecycle extensions (suspension, template) an
  edit-in-one-place change.

### 4.3 Adoption plan

The helper is introduced in Phase 2B.1 and adopted by these
callables in Phase 2B.1 and Phase 2B.5:

- Phase 2B.1 (load-bearing, must adopt): `classesUpdateMetadata`
  (S3), `classesArchive` (S2), `assignmentsCreateDraft` (S7),
  `enrollmentsJoinByCode` (S4), `enrollmentsTeacherAdd` (S5),
  `lmsClassesImport` (S11), roster sync engine (S12).
- Phase 2B.3 (introduced with adoption): `classesActivate` (new).
- Phase 2B.5 (may safely wait): any callable whose rule is already
  correct today and whose behavior does not change. Adoption is
  still recommended in the same phase for consistency, but a callable
  that only reads a class for ownership without gating on `status`
  (S6, S15, S16, S17, S18) does not need the helper.

### 4.4 Client-side mirror

A small client-side helper `isInstructionEligible(record)` mirrors
the `active`-only check for surfaces C6, C7, C8. It is not the
security boundary; it is discoverability. The server helper is the
authoritative gate.

---

## 5. Join-Code Decision

### 5.1 Recommendation - Option B (defer join-code creation until activation)

Do not generate a join code when the `needsSetup` class is created.
The activation callable generates the join code as part of the
atomic `needsSetup -> active` transaction.

### 5.2 Comparison

Option A (create-then-hide, as ratified in ADR §7.4):

- Requires `classesLmsCreate` to hold the `randomBytes(4)`
  join-code generator today. That is a leak of a
  `classesCreate`-only concern into a new write shape.
- Requires the join-code lookup path (`enrollmentsJoinByCode` S4) to
  reject `status !== "active"`. That check already exists today, so
  no additional reject is needed - but the code is a valid,
  server-issued, hidden-from-teacher credential that resolves
  `where("joinCode", "==", ...)` even if the class rejects
  enrollment. That is an unnecessary attack surface: a leaked code
  becomes usable the instant the class activates.
- Requires cleanup thinking: if a `needsSetup` class is archived
  before activation (per ADR §7.4 archive allowance), the join code
  remains persisted on a status-`archived` record. Harmless, but
  another edge case.

Option B (defer generation):

- The `needsSetup` document simply omits the `joinCode` field. The
  canonical `ClassRecord` shape (see §7) makes `joinCode` optional
  on the `needsSetup` arm of the discriminated union.
- The activation callable generates the join code and writes
  `{ status, grade, block, joinCode }` in a single transaction. All
  four fields become observable at the same instant.
- The join-code lookup path continues to reject non-active classes;
  this is a defense-in-depth guard that a race window against
  activation cannot exploit.
- The only invariant to preserve is uniqueness: the activation
  transaction must ensure no other class in the same
  `(schoolId, joinCode)` scope holds the newly minted code. See
  §5.3.
- Manual Create is unchanged: `classesCreate` still generates a
  join code at creation time because it writes `active` directly.

Option C (defer entirely, activate a class without a join code
until first student join): rejected. Overloads the join-code path
with lazy creation and introduces a second creation seam for
join codes; not worth the complication.

### 5.3 Activation-time join-code generation

The activation callable performs, atomically within one Firestore
transaction:

1. Load `classes/{classId}` inside the transaction.
2. Assert `status === "needsSetup"` and ownership.
3. Validate incoming `grade` (`"6" | "7" | "8"`) and `block`
   (`"A".."G"`).
4. Generate a candidate `joinCode` (same 8-hex generator).
5. Query for an existing `active` class with the same `schoolId`
   and `joinCode` (bounded, indexed query used by
   `enrollmentsJoinByCode`). If a collision is detected, regenerate
   up to N times (recommend N = 5); on exhaustion, throw
   `classes.joinCodeGenerationFailed` and let the client retry.
   The 32-bit code space over a single school makes collisions
   negligible.
6. Update the class document with
   `{ status: "active", grade, block, joinCode }` inside the same
   transaction.
7. Emit an audit event `classes.activated` (see §8.5).

Retry behavior: on transient Firestore transaction errors, the
callable is safe to re-invoke because the pre-image guard (`status
=== "needsSetup"`) makes the transaction idempotent - a second
successful commit is impossible.

Rollback: the transaction is a single commit; there is no partial
state.

### 5.4 Amendment to ADR §7.4

Update the ADR bullet "Persist as a linked LyfeLabz class in
`classes/{classId}` with a server-issued join code..." to state that
the join code is created at activation time, not at needsSetup
creation time. See §13.

---

## 6. Roster-Synchronization Decision

### 6.1 Recommendation - Option B (activation gates roster sync)

`lmsClassesSyncRoster` continues to require `status === "active"`.
A `needsSetup` class does not synchronize its roster. Phase 3 does
not need to re-decide this.

### 6.2 Why

- The certified roster engine (S12) materializes `enrollments/*`
  documents. Materializing enrollments against a class that cannot
  yet be assigned lessons, cannot be joined by a student join
  code, and does not appear in curriculum selectors is a
  half-instantiated state with no consumer. A withdrawn upstream
  student would silently transition an unreachable enrollment.
- The teacher's activation step is one screen. Blocking initial
  sync on activation delays the roster by seconds, not hours.
- Enrollments carry `classId`; a rollback of Phase 2B leaves
  enrollments referencing an unknown-status class. Callables that
  join enrollment -> class default-open the class today; running
  sync while `needsSetup` exists compounds the number of
  enrollments that would sit on such a class in a rollback
  scenario. Option B keeps the rollback footprint minimal.
- Audit and observability are cleaner: `lms.rosterSynchronized`
  events always describe an instruction-eligible class.

### 6.3 What is permitted while needsSetup

- Link the LMS class (`lmsClassesImport`, extension in S11): yes.
  This is the whole point of the import flow.
- Refresh link health (`lmsClassesRefresh`, S14): yes. Link health
  is not instruction.
- Materialize enrollments: no.

### 6.4 Implication for Phase 3

Phase 3 sequences the initial roster sync **after** the activation
callable returns. The Classes surface, on setup form submission,
awaits `classesActivate`, then invokes `lmsClassesSyncRoster` if
the class is LMS-linked. The Phase 3 completion report will make
this ordering explicit.

### 6.5 Amendment to Blueprint §9.2.3 and §9.2.7

Blueprint §9.2.3 currently says "Whether the initial roster sync
runs against a `needsSetup` class is a Phase 3 sequencing
question". §9.2.7 currently says "Phase 3 must decide". Both are
replaced by the policy above. See §13.

### 6.6 Callable-side change

`synchronizeClassRoster` (S12) already rejects on
`status !== "active"`. Phase 2B.5 adopts `assertClassSupports("rosterSync", record)`
in place of the inline check for consistency; behavior is unchanged.

---

## 7. NeedsSetup Creation Seam

### 7.1 Recommendation - Option B (narrow new domain callable)

Introduce a new callable `classesLmsCreate` in
`platform/functions/src/classes/` alongside `classes-create.ts`.
The callable is deliberately narrow:

- Accepts `{ classId, title }` only. No `grade`, `block`,
  `academicTerm`, `providerId`, or `lmsClassId`.
- Runs under the same `assertActiveTeacherInDistrict` authorization
  as `classesCreate`.
- Writes a `ClassLmsCreationWrite` shape (§7.4).
- Is idempotent on `(classId, teacherId, title)` in the same
  fashion as `classesCreate`.
- Emits `classes.created` with a `payload.source = "lms"` marker so
  audit consumers can distinguish creation origin without a new
  event kind.

### 7.2 Why not extend `classesCreate`

`classesCreate` today enforces required `grade` and `block`. Adding
a mode flag ("import" vs "manual") that conditionally waives those
requirements re-introduces the classifier problem the ADR
architecture is trying to avoid. Ownership of "class creation with
grade / block invariants" stays clean; a second creation seam owns
"class creation without grade / block, awaiting activation".

### 7.3 Why not fold into `lmsClassesImport`

`lmsClassesImport` is a link callable, not a creation callable. Its
write shape (`ClassLmsLinkWrite`) is intentionally narrow per
PDR-019i and PDR-019j and does not accept ownership or lifecycle
fields. Making it a creator would collapse two well-separated
concerns.

### 7.4 Types

Add to `platform/functions/src/shared/types/class.ts`:

```
export type ClassStatus = "active" | "archived" | "needsSetup";

// Existing ClassRecord becomes a discriminated union.
export type ActiveClassRecord = { ...existing shape... status: "active"; grade: string; block: string; joinCode: string; };
export type ArchivedClassRecord = { ...same shape... status: "archived"; };
export type NeedsSetupClassRecord = {
  readonly teacherId: string;
  readonly schoolId: string;
  readonly title: string;
  readonly status: "needsSetup";
  readonly createdAt: Timestamp;
  readonly coTeacherIds?: readonly string[];
  readonly academicTerm?: string;
  readonly enrollmentSource?: ClassEnrollmentSource;
  readonly lmsProviderRef?: LmsProviderId;
  // grade, block, joinCode, joinCodeExpiresAt intentionally absent.
};
export type ClassRecord = ActiveClassRecord | ArchivedClassRecord | NeedsSetupClassRecord;

export type ClassLmsCreationWrite = {
  readonly teacherId: string;
  readonly schoolId: string;
  readonly title: string;
  readonly status: "needsSetup";
  readonly createdAt: FieldValue;
};

export type ClassActivationWrite = {
  readonly status: "active";
  readonly grade: string;
  readonly block: string;
  readonly joinCode: string;
};
```

`ClassCreationWrite` (Manual Create) is unchanged.
`ClassMetadataUpdateWrite` is unchanged. `ClassLmsLinkWrite` is
unchanged. `ClassArchiveWrite` is unchanged.

### 7.5 Client orchestration

`app/src/classes/importFromClassroom.ts` swaps `classesCreate` for
`classesLmsCreate` on the import branch. The composition remains
`classesLmsCreate` -> `lmsClassesImport`. The controller state
machine's `creating` and `linking` stages are unchanged; only the
callable target changes.

### 7.6 Cleanup on link failure

Today, when `lmsClassesImport` fails after `classesCreate`, the
result is an orphan `active` class the teacher must archive
manually. After Phase 2B, an orphan is a `needsSetup` class with no
link. The teacher's Classes list surfaces it with a "Finish
setting up this class" affordance; the teacher can either complete
setup (creating a normal, un-linked class) or archive it. This is
strictly better UX than the current orphan behavior.

No new cleanup callable is introduced.

---

## 8. Activation Callable Contract

### 8.1 Name

Recommended: `classesActivate`. Working callable name in this doc.
Final name subject to naming convention review at implementation
time.

### 8.2 Request

```
type ClassesActivateRequest = {
  readonly classId: string;
  readonly grade: "6" | "7" | "8";  // closed set
  readonly block: "A" | "B" | "C" | "D" | "E" | "F" | "G";
};
```

Validation:

- `classId`: non-empty URL-safe token matching the existing
  `CLASS_ID_PATTERN` in `classes-create.ts`.
- `grade`: closed-set membership check.
- `block`: uppercased single letter A..G.

### 8.3 Response

```
type ClassesActivateResponse = {
  readonly classId: string;
  readonly status: "active";
  readonly joinCode: string;
  readonly alreadyActive: boolean;
};
```

### 8.4 Authorization and authentication

- `assertActiveTeacherInDistrict(request)` (existing helper).
- Ownership: transaction reads the class; asserts
  `record.teacherId === actor.uid` and
  `record.schoolId === actor.schoolId`. Co-teacher activation is
  out of scope for Phase 2B.
- Status: `assertClassSupports("activate", record)` throws
  `classes.notActivatable` on `archived`; returns cleanly on
  `active` (idempotent) and on `needsSetup`.

### 8.5 Transactional semantics

Inside one Firestore transaction:

1. Read `classes/{classId}`.
2. Assert existence, ownership, and status.
3. If `status === "active"`, no write; return
   `{ alreadyActive: true, joinCode: record.joinCode }`.
4. If `status === "needsSetup"`:
   a. Generate join code (see §5.3 for collision handling; the
      collision check is a separate `get` outside the transaction
      followed by a re-run only on failure, since transactions
      cannot execute non-key queries).
   b. `update(classDocRef(classId), { status: "active", grade, block, joinCode })`.
5. Commit.

Outside the transaction, after commit:

- Emit `classes.activated` audit event with
  `payload: { previousStatus: "needsSetup", grade, block }`. No new
  audit event kind is introduced beyond `classes.activated`; this
  kind is either added to the existing enum or reuses
  `classes.updated` if the audit layer's naming convention
  requires. Naming is confirmed in Phase 2B.3 against the audit
  contract.
- Emit a structured `log.info("classes.activated", { ... })`.

### 8.6 Idempotency and retry

- Already-active: safe. Returns the existing `joinCode`.
- Transient error before commit: safe. Client retries; the pre-image
  guard yields the same result.
- Transient error after commit but before audit / log: audit is
  best-effort per existing patterns. A retry sees `alreadyActive:
  true` and returns quietly; the missed audit is acceptable and
  matches existing behavior for `classesArchive`.

### 8.7 Concurrent activation

Two teachers, or one teacher in two tabs, activating the same class
simultaneously: Firestore transaction serialization ensures exactly
one write; the loser's transaction sees `status === "active"` on
re-read and returns `alreadyActive: true`.

### 8.8 Error taxonomy

| Code | HTTP mapping | Message |
|---|---|---|
| `classes.invalidRequest` | 400 | "Request payload must be a structured object." |
| `classes.invalidClassId` | 400 | "classId must be a URL-safe token." |
| `classes.invalidGrade` | 400 | "grade must be one of 6, 7, 8." |
| `classes.invalidBlock` | 400 | "block must be a single letter A through G." |
| `classes.notFound` | 404 | "Class was not found." |
| `classes.forbidden` | 403 | "Caller does not own this class." |
| `classes.notActivatable` | 409 | "Class cannot be activated in its current state." |
| `classes.joinCodeGenerationFailed` | 503 | "Could not allocate a join code; try again." |
| `role-forbidden` | 403 | "Caller must be an active teacher." (existing) |

### 8.9 Client recovery UX

- Invalid grade / block: client-side validation prevents submission.
- Not found: "This class no longer exists" copy; return to Classes.
- Forbidden: "You do not have permission to finish setting up this
  class."
- Not activatable: "This class can no longer be finished (it may
  have been archived)." Return to Classes.
- Join-code failure: "Could not finish setting up. Try again." Retry
  button on the setup form.

### 8.10 Preference update

The teacher's `defaultGrade` preference is updated **outside** the
activation transaction, best-effort:

- On successful activation, the client (not the callable) invokes
  `teacherPreferencesUpdate({ defaultGrade: submittedGrade })`.
- Activation succeeds independently of the preference call. A
  preference-update failure logs a warning but does not surface an
  error to the teacher.

This keeps the activation callable single-purpose and prevents an
unrelated preference-storage failure from blocking a class from
becoming instruction-eligible.

---

## 9. Teacher Preference Contract

### 9.1 Storage

- Firestore path: `users/{uid}/preferences/teacher` (subdoc).
- Rationale: keeps the identity document minimal, allows a narrow
  Rules block scoped to the subdoc, and provides a reusable seat
  for future preferences without churning `UserRecord`.

### 9.2 Schema

```
type TeacherPreferencesDoc = {
  readonly defaultGrade?: "6" | "7" | "8";
  readonly updatedAt: Timestamp;
};
```

Explicit `null` is not stored. "No preference" is represented by
either an absent document or a document with `defaultGrade`
omitted. Both are legitimate steady states.

### 9.3 Writer - recommendation

Recommendation: **callable** `teacherPreferencesUpdate`.

Reasoning:

- Existing convention on `users/{uid}` is Rules-side self-update
  limited to `{ displayName }` (see `firestore.rules` lines 32-49).
  A subdoc create + closed-set validation adds enough shape logic
  that a callable is cleaner than a Rules-side allowlist with a
  value check.
- A callable owns the closed-set validation, stamps `updatedAt`,
  and standardizes error taxonomy with the rest of the platform.
- The subdoc itself carries a narrow Rules block as defense in
  depth (see §9.7).

### 9.4 Callable contract

```
type TeacherPreferencesUpdateRequest = {
  readonly defaultGrade?: "6" | "7" | "8" | null;
  // `null` clears the field; absent leaves the current value; string sets it.
};

type TeacherPreferencesUpdateResponse = {
  readonly ok: true;
};
```

Behavior:

- Authorization: `assertActiveTeacherInDistrict`.
- Validation: `defaultGrade` is either `"6"`, `"7"`, `"8"`, `null`,
  or absent. Any other value throws
  `teacherPreferences.invalidDefaultGrade`.
- Write: `set({ defaultGrade, updatedAt }, { merge: true })` on the
  subdoc. When `null` is supplied, uses `FieldValue.delete()` to
  remove the field.

### 9.5 Reader

- Direct client read at session hydration.
- Surface: `activeTeacher.preferences.defaultGrade` (subject to the
  session hydration API shape; final placement confirmed in Phase
  2B.2).
- Absent doc: reader returns `{ defaultGrade: undefined }`. No
  throw.
- Absent field: same.
- Invalid legacy value (out-of-set string): reader treats as absent
  and logs once at debug level.
- Cache: hydrated once per session; the preference-update callable
  optimistically updates the local cache without a re-hydration
  round trip.

### 9.6 Cache invalidation and failure

- On a successful preference write, the client updates its cached
  `activeTeacher.preferences.defaultGrade` in place.
- On a failed preference write during activation flow, the client
  surfaces no teacher-facing error; activation has already
  succeeded. A silent local log records the failure.
- No full session refresh is required for a preference change.

### 9.7 Rules block

```
match /users/{uid}/preferences/teacher {
  allow get: if isSelf(uid);
  allow create, update: if isSelf(uid)
    && request.resource.data.keys().hasOnly(["defaultGrade", "updatedAt"])
    && (
      !("defaultGrade" in request.resource.data)
      || request.resource.data.defaultGrade in ["6", "7", "8"]
    );
  allow delete: if false;
}
```

This is defense in depth. The callable is the primary writer and
performs the same validation.

### 9.8 Deletion / account cleanup

On teacher account deletion (a future capability outside Phase 2B),
the subdoc must be deleted alongside the identity document. Phase
2B does not touch account-cleanup code; the deletion Rules-block
`delete: if false` ensures no accidental client-side deletion in the
meantime.

---

## 10. Backward-Compatibility Analysis

### 10.1 Existing documents

- Every existing class document in `lyfelabz-prod` carries either
  `status: "active"` or `status: "archived"`. Neither value is
  affected by the type extension.
- No migration or backfill is authorized.
- No existing reader misbehaves against `active` or `archived`
  after Phase 2B: existing switches, guards, and filters continue
  to match the string values they already match.

### 10.2 Missing status handling

- The client-side `isStatus` guard (C1) currently returns `false`
  for anything other than `"active"` or `"archived"`. After Phase
  2B extends the union to include `"needsSetup"`, the guard
  accepts the new value. Any other string continues to be rejected
  (defensive, matches today's behavior).
- On the server, `ClassStatus`-typed fields flow through Firestore
  as strings; the type extension does not change the runtime
  value. TypeScript exhaustiveness checks will surface any
  server-side switch that missed the new arm at compile time.

### 10.3 Query behavior

No existing Firestore query filters on `status` at the classes
collection level (verified). All status filtering happens
post-fetch. The one exception is the teacher-scoped list rule,
which filters on `teacherId`, not `status`. `needsSetup` documents
appear in the list result and are handled by the client filter (C1).

### 10.4 Non-production environments

The extension is additive. Emulator suites see the new value only
when new tests write it.

---

## 11. Mixed-Version and Rollback Analysis

### 11.1 Deployment order

The unsafe ordering is: deploy the `needsSetup` writer before every
critical reader is safe. That produces classes that disappear from
the teacher's list (C1) or crash the Snapshot label (C8).

The safe ordering is:

1. **Server + client reader upgrade** (Phase 2B.1). Extend
   `ClassStatus` in shared types. Extend every load-bearing reader
   listed in §3 to tolerate the new value. Adopt the shared
   eligibility helper. **No writer for `needsSetup` is deployed.**
   Ship this as a single Hosting + Functions bundle. Verify.
2. **Preference contract** (Phase 2B.2). Ship the subdoc Rules,
   the callable, the reader, the Settings row. This is
   independently useful (empty state today) and unblocks Manual
   Create pre-fill in Phase 2B.4.
3. **Activation callable + LMS creation seam** (Phase 2B.3). Ship
   the two new callables. The client still calls `classesCreate`;
   no `needsSetup` document is written yet.
4. **Client swap** (Phase 2B.4). Change
   `importFromClassroom.ts` to call `classesLmsCreate`. Ship the
   workspace setup form and the "Finish setting up" affordance.
   Retire the hard-coded `"7"`/`"A"` defaults in Manual Create.
   **This is the first release that produces `needsSetup`
   documents.**
5. **Adoption sweep + verification** (Phase 2B.5).

Every phase is a Hosting redeploy that keeps the prior known-good
bundle warm per `SPRINT_23F_DEPLOYMENT_RUNBOOK.md`.

### 11.2 Rollback safety per phase

- 2B.1 rollback: safe. No new documents exist. Reader extensions
  are inert on `active` / `archived` documents.
- 2B.2 rollback: safe. Subdoc becomes inert to the reverted client.
- 2B.3 rollback: safe. Callables are unused by the reverted client;
  their code is dead but harmless.
- 2B.4 rollback: partially safe. `needsSetup` documents already
  written survive. The reverted client's `isStatus` (C1) drops them
  from the list (C1 was never rolled back if 2B.1 shipped first);
  wait - if 2B.1 shipped first and stays deployed, C1 accepts
  `needsSetup` on the reverted client too, but the reverted
  workspace has no setup form. The teacher sees the class listed
  with no way to finish setup. The recovery path is to redeploy
  2B.4. This is acceptable because the teacher can also archive
  the class through `classesArchive` (which after 2B.1 accepts
  `needsSetup`).
- 2B.5 rollback: safe. Adoption of the helper does not change
  behavior on any operation.

### 11.3 Cross-version safety

- Old client + new server: safe. Old client cannot write
  `needsSetup`. Old client reads existing `active` / `archived`
  documents unchanged.
- New client + old server: unsafe. The new `classesLmsCreate` and
  `classesActivate` callables must be deployed before the client
  that calls them. This is standard deploy discipline (Functions
  deploy before Hosting deploy in 2B.3, then Hosting deploy in
  2B.4).

### 11.4 What partial deploys must not do

- Never ship the client swap (2B.4) before 2B.1's readers land in
  production.
- Never ship the eligibility-helper adoption (2B.5) before 2B.1's
  reader extensions land.
- Never write a `needsSetup` document from a script, migration, or
  admin console until 2B.4 is production-verified.

---

## 12. Final Implementation Sequence

The Phase 2B work is decomposed into six independently certifiable
units. Each unit has a Definition of Done and a Stop Condition. No
subsequent unit may begin until the prior unit is certified.

### 12.1 Phase 2B.0 - Reader and authorization audit only

- Objective: re-run §3 against `main` at implementation time.
  Produce a table identical in shape to §3 with any additions.
- Files affected: none.
- Non-scope: no code change of any kind.
- Tests required: none.
- Deployability: n/a.
- Rollback: n/a.
- Definition of done: audit table filed as an appendix to this
  document.
- Stop condition: any newly-discovered load-bearing reader that
  cannot be safely extended without a design change halts Phase 2B
  and reopens this specification.

### 12.2 Phase 2B.1 - Lifecycle type extension + safe readers + eligibility helper

- Objective: extend `ClassStatus` and the discriminated union;
  introduce `assertClassSupports`; extend every reader in §3 to
  handle `needsSetup` safely; adopt the helper in the callables
  listed in §4.3.
- Files likely affected:
  - `platform/functions/src/shared/types/class.ts`
  - `platform/functions/src/shared/classes/eligibility.ts` (new)
  - `platform/functions/src/classes/classes-archive.ts`
  - `platform/functions/src/classes/classes-update-metadata.ts`
  - `platform/functions/src/assignments/assignments-create-draft.ts`
  - `platform/functions/src/enrollments/enrollments-join-by-code.ts`
  - `platform/functions/src/enrollments/enrollments-teacher-add.ts`
  - `platform/functions/src/lms/classes-import.ts` (S11 extension)
  - `platform/functions/src/lms/roster/sync-engine.ts`
  - `app/src/classes/listClasses.ts` (union + guard)
  - `app/src/classes/types.ts` (ClassStatus)
  - `app/src/shell/surfaces/classes.ts` (render support)
  - `app/src/shell/surfaces/snapshot.ts` (STATUS_LABEL)
- Non-scope: no new callable; no new client workflow; no
  `needsSetup` document is ever written by this unit.
- Tests required:
  - Every `assertClassSupports` cell in §4.1 has a unit test.
  - `listClasses` accepts a `needsSetup` document.
  - `classesArchive` accepts a `needsSetup` document as pre-image.
  - `lmsClassesImport` accepts a `needsSetup` class as pre-image.
  - Regression: every existing `active` / `archived` test still
    passes without modification (proves the extension is additive).
- Deployability: Functions + Hosting redeploy.
- Rollback boundary: full and safe.
- Definition of done: verification chain green; no `needsSetup`
  document exists in any environment.
- Stop condition: any typecheck exhaustiveness failure that cannot
  be resolved by adding a `needsSetup` arm without behavior change
  halts the unit.

### 12.3 Phase 2B.2 - Teacher preference contract

- Objective: ship the subdoc Rules, `teacherPreferencesUpdate`
  callable, session-hydration reader, Settings row.
- Files likely affected:
  - `platform/firebase/firestore.rules` (new subdoc block)
  - `platform/functions/src/teachers/teacher-preferences-update.ts` (new)
  - `platform/functions/src/teachers/index.ts`
  - `app/src/session/*` (hydration extension)
  - `app/src/shell/surfaces/settings.ts` (row)
- Non-scope: no class-lifecycle change.
- Tests required:
  - Callable validates the closed set.
  - Callable rejects non-teacher callers.
  - Rules test: self read/write; cross-user denied; shape allowlist.
  - Session reader tolerates absent doc.
- Deployability: Rules + Functions + Hosting.
- Rollback boundary: full and safe.
- Definition of done: verification chain green.
- Stop condition: any existing Sprint 2 identity convention that
  precludes a subdoc write path is uncovered - halts and reopens
  §9.

### 12.4 Phase 2B.3 - NeedsSetup creation seam + activation callable

- Objective: ship `classesLmsCreate` and `classesActivate`. Neither
  is called by any client in this unit; they are deployed dark.
- Files likely affected:
  - `platform/functions/src/classes/classes-lms-create.ts` (new)
  - `platform/functions/src/classes/classes-activate.ts` (new)
  - `platform/functions/src/classes/index.ts`
  - `platform/functions/src/index.ts` (export)
  - `platform/functions/src/audit/*` (if a new `classes.activated`
    kind is needed)
- Non-scope: no client wiring.
- Tests required:
  - `classesLmsCreate` writes a valid `NeedsSetupClassRecord`;
    idempotent replay returns the same shape.
  - `classesActivate` happy path: needsSetup -> active with grade,
    block, joinCode set atomically.
  - `classesActivate` idempotent on active.
  - `classesActivate` rejects on archived.
  - `classesActivate` rejects on invalid grade / block.
  - Join-code collision retry test.
  - Concurrent activation test (two callers, one writer).
- Deployability: Functions redeploy.
- Rollback boundary: full and safe. Callables are dead code until
  2B.4.
- Definition of done: verification chain green; both callables
  invocable from a manual `curl` in the emulator.
- Stop condition: audit contract cannot accommodate
  `classes.activated` and no reuse fits - halts and reopens §8.5.

### 12.5 Phase 2B.4 - Client import swap + workspace setup form + Manual Create cleanup

- Objective: switch the import orchestration to
  `classesLmsCreate`. Render the setup form. Retire hard-coded
  Manual Create defaults. Wire `defaultGrade` pre-fill on both
  Manual Create and the setup form. Wire the "Finish setting up"
  affordance in the Classes list.
- Files likely affected:
  - `app/src/classes/importFromClassroom.ts`
  - `app/src/shell/surfaces/classes.ts` (list affordance, workspace
    setup form, manual create default retirement)
  - `app/src/index.ts` (wiring)
- Non-scope: no server change.
- Tests required:
  - Import produces a `needsSetup` class with no grade/block
    persisted.
  - Setup form pre-fills grade from `defaultGrade` when present.
  - Setup form submission invokes `classesActivate`.
  - On activation success, `teacherPreferencesUpdate` is invoked
    best-effort.
  - Manual Create writes teacher-selected grade and block.
  - Classes list renders `needsSetup` with the affordance and
    without join code / assignment destination.
- Deployability: Hosting redeploy.
- Rollback boundary: see §11.2.
- Definition of done: manual production teacher can import a
  Classroom class and complete setup end-to-end. No hard-coded
  `"7"` or `"A"` remains at any write site.
- Stop condition: any Phase 2B.1 reader turns out to be
  insufficient in a workspace-render test - halts and reopens the
  reader.

### 12.6 Phase 2B.5 - Adoption sweep + verification + Phase 2 re-certification

- Objective: adopt `assertClassSupports` in the remaining
  callables (§4.3 Phase 2B.5 list). Run the full emulator suite
  including regression coverage. Author
  `SPRINT_24B_PHASE_2B_COMPLETION_REPORT.md` re-certifying
  Phase 2's carried-forward surface and certifying Phase 2B's new
  surface.
- Files likely affected: same callables as Phase 2B.1 adoption plus
  the completion report.
- Tests required: full existing suite green plus the new tests
  from prior units.
- Deployability: Functions + Hosting.
- Rollback boundary: safe.
- Definition of done: completion report on file; Phase 3 unblocked.
- Stop condition: any regression in existing `active` behavior
  halts.

---

## 13. Documentation Modified or Created

Phase 2B specification is documentation-only. No production code
or tests may be modified. The four documents in scope:

1. **`docs/platform/ADR_TEACHER_DEFAULT_CLASS_METADATA.md`**
   - §7.4: correct the sentence about Firestore Rules enforcing
     "not permitted" items. Rules govern direct-client
     interactions; Admin SDK writes are gated by callables. Amend
     to state that enforcement is split between Rules (direct
     client reads and the preference subdoc) and callable-side
     guards (all Admin SDK writes, plus the shared
     `assertClassSupports` helper).
   - §7.4: correct the join-code capability bullet. Join code is
     generated at activation time per §5 of this document; the
     `needsSetup` document does not carry a join code.
   - §7.5: reference §8 of this specification for the activation
     callable contract details.
   - §9: correct the Rules section to reflect the corrected
     enforcement model: the class-write and assignment-write
     bullets are callable-layer requirements, not Rules-layer
     requirements; the preference subdoc block is the only new
     Rules addition.

2. **`docs/platform/SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md`**
   - §9.2.2 Server bullets: replace "Add or extend Firestore Rules"
     that mention assignment and join-code guards with pointers to
     the callable-layer guards in this specification. Retain only
     the `preferences/teacher` Rules addition.
   - §9.2.3: replace the roster-sync deferral to Phase 3 with the
     Option B decision recorded in §6 of this specification.
   - §9.2.7: replace "Phase 3 must decide" with "Phase 3 sequences
     roster sync after activation per Phase 2B Specification §6".

3. **`docs/platform/SPRINT_24B_PHASE_2_COMPLETION_REPORT.md`**
   - §17.5: append this specification's identifier so the
     re-certification chain is traceable.
   - No other change. The de-certification remains in force.

4. **`docs/platform/SPRINT_24B_PHASE_2B_IMPLEMENTATION_SPECIFICATION.md`**
   (this document): new.

---

## 14. Risks

- **R1. Reader miss.** A load-bearing reader not enumerated in §3
  behaves unexpectedly on `needsSetup`. Mitigation: Phase 2B.0's
  audit and Phase 2B.1's TypeScript exhaustiveness pass. Regression
  coverage for existing `active` classes catches the majority.
- **R2. Snapshot / analytics.** Existing Snapshot metrics may need
  explicit exclusion of `needsSetup` classes to keep dashboards
  meaningful. §3 C8 captures this.
- **R3. Join-code collision noise.** The 32-bit code space makes
  this negligible, but a school with tens of thousands of active
  classes may benefit from monitoring. Non-blocking.
- **R4. Preference storage failure.** Handled by the best-effort
  policy in §8.10; the class still activates.
- **R5. Orphan needsSetup classes.** Cleanup UX is documented in
  §7.6 (list affordance + archive). Not a defect.
- **R6. Rollback of Phase 2B.4.** Teachers may see a `needsSetup`
  class with no setup form on the reverted client. §11.2 accepts
  this as recoverable via re-deploy or archive.
- **R7. Cross-teacher activation.** Not supported in Phase 2B.
  Co-teacher activation is a future concern.
- **R8. Audit event kind naming.** `classes.activated` may need a
  new audit kind or a reuse; Phase 2B.3 confirms.
- **R9. Curriculum manifest drift** (pre-existing). Continues to
  fail `curriculum:verify` in CI on `main`. Not a Phase 2B concern.

---

## 15. Recommendation for the First Implementation Unit

Begin with **Phase 2B.0 (Reader and authorization audit only)**.

Justification:

- The single largest risk in Phase 2B is R1 (reader miss). Every
  other unit assumes §3 is complete.
- Phase 2B.0 is a documentation appendix. It produces no code and
  cannot destabilize any environment.
- Its output becomes the acceptance checklist for Phase 2B.1's
  reader-extension work.

Deliverable: an appendix (or a new companion doc) filed under
`docs/platform/` that lists every load-bearing class reader on
`main` at implementation time, annotated with the columns in §3.

Only after that audit is approved does Phase 2B.1 begin.

---

*End of Phase 2B Implementation Specification.*
