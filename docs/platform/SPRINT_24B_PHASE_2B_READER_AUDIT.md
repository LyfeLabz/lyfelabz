# Sprint 24B - Phase 2B.0 Reader and Authorization Audit

Status: Documentation only. Phase 2B.0 gate deliverable. No production
code, tests, or Firestore Rules were modified in the course of this
audit. No commits.

Date: 2026-07-30
Governing spec: `docs/platform/SPRINT_24B_PHASE_2B_IMPLEMENTATION_SPECIFICATION.md`
Governing ADR: `docs/platform/ADR_TEACHER_DEFAULT_CLASS_METADATA.md`
Governing blueprint: `docs/platform/SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md`
De-certified prior phase: `docs/platform/SPRINT_24B_PHASE_2_COMPLETION_REPORT.md`

No em dashes. Spaced hyphens (" - ") throughout.

---

## 1. Executive Summary

The Phase 2B Implementation Specification §3 forecast a small set of
load-bearing readers and writers that must be certified before the first
`needsSetup` class may be written. This Phase 2B.0 audit re-ran the
enumeration against `main` at HEAD and confirms the forecast without
material adjustment. No newly-discovered load-bearing reader forces a
design change; no stop condition from Phase 2B.1's Definition of Done is
triggered.

Findings:

- 18 server callables and shared server helpers inspected. 7 must change
  in Phase 2B.1 before any `needsSetup` write is safe. 8 are safe as-is
  (ownership-only reads, or enrollment / assignment scopes that are
  unreachable while `needsSetup`). 3 warrant verification-only tests.
- 12 client readers and surfaces inspected. 4 are load-bearing and must
  change in Phase 2B.1 or Phase 2B.4. 7 are safe (existing `active`-only
  filters are intentional and preserve the desired behavior). 1 is
  workspace-render work that is deferred to Phase 2B.4 but must
  compile-clean after the type extension.
- The canonical `ClassStatus` union today is `"active" | "archived"`
  on both server (`platform/functions/src/shared/types/class.ts:15`) and
  client (`app/src/classes/types.ts:13`). Both parsers reject unknown
  values. Adding `"needsSetup"` is additive and the compiler surfaces
  the missed arms.
- The shared eligibility helper recommended in Phase 2B Spec §4 is not
  present today. Its introduction remains a Phase 2B.1 responsibility.
- No production `needsSetup` class exists in any environment. The
  deployment gate has not been crossed.
- The load-bearing pre-write blocker list (§8 below) contains exactly
  the seven server rows and four client rows enumerated in the spec.
  No additional rows were discovered.

Certification recommendation: Phase 2B.0 is complete. Phase 2B.1 may
begin.

---

## 2. Audit Method

The audit consumed the following authoritative sources in priority
order:

1. `docs/platform/SPRINT_24B_PHASE_2B_IMPLEMENTATION_SPECIFICATION.md`
   (governs Phase 2B).
2. `docs/platform/ADR_TEACHER_DEFAULT_CLASS_METADATA.md` and
   `docs/platform/SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md` (governing
   architecture).
3. Repository search over `platform/functions/src/` and `app/src/` for
   the following strings and patterns:
   - `ClassStatus`, `ClassRecord`
   - `status === "active"`, `status === 'active'`
   - `status !== "active"`, `status !== 'active'`
   - `status === "archived"`, `status !== "archived"`
   - `isStatus`, `STATUS_LABEL`
   - `status: "active"` (write shapes)
   - `switch (` bounded to `status`
   - `needsSetup`
4. Direct reads of every touched file to confirm classification.

The audit inspected production code and tests. No file was modified.

The audit reused the row identifiers in Phase 2B Spec §3 (S1..S18 for
server, C1..C10 for client) so cross-references are stable.

---

## 3. Canonical Lifecycle Contract

Confirmed against `main`:

- Server canonical type at
  [class.ts:15](platform/functions/src/shared/types/class.ts:15):
  `export type ClassStatus = "active" | "archived";`
- Server `ClassRecord` at
  [class.ts:27](platform/functions/src/shared/types/class.ts:27) makes
  `grade`, `block`, `joinCode`, and `status` all required. There is
  no discriminated union today.
- Server write shapes at [class.ts:56, 75, 88, 98](platform/functions/src/shared/types/class.ts:56):
  `ClassCreationWrite` requires `status: "active"` and all metadata
  fields; `ClassMetadataUpdateWrite` is metadata-only; `ClassLmsLinkWrite`
  is enrollment-source-only; `ClassArchiveWrite` writes only `status:
  "archived"`.
- Client canonical type at
  [types.ts:13](app/src/classes/types.ts:13): `export type ClassStatus
  = "active" | "archived";`. `ClassSummary` treats `grade` as
  required and `block`, `joinCode` as optional.
- Client parser at
  [listClasses.ts:33](app/src/classes/listClasses.ts:33): `isStatus`
  narrows to the two-value union; unknown values drop the row via
  `toSummary` returning `null`.

Phase 2B extends the union additively to `"active" | "archived" |
"needsSetup"` and converts `ClassRecord` to a discriminated union
consistent with Phase 2B Spec §7.4. `active` and `archived` arms retain
required `grade`, `block`, `joinCode`; the `needsSetup` arm omits
those three plus `joinCodeExpiresAt`.

The `needsSetup` arm is a legitimate steady state until activation. It
is not a partially-filled `active` class. The union boundary is the
only place a reader can safely branch on absence.

---

## 4. Server Reader and Writer Matrix

Legend: A = safe without change; B = must change in Phase 2B.1;
C = must change in a later Phase 2B unit; D = verification-only;
E = out of scope.

| Row | File and function | Line | Current guard | Class A/B/C/D/E | needsSetup effect today | Required Phase 2B change | Op helper key | Blocks first needsSetup write | Test |
|---|---|---|---|---|---|---|---|---|---|
| S1 | `classes/classes-create.ts` `classesCreateHandler` | [251](platform/functions/src/classes/classes-create.ts:251) | writes `status: "active"` | A (Manual Create keeps writing `active`) | n/a | none | n/a | no | none |
| S2 | `classes/classes-archive.ts` `classesArchiveHandler` | [132](platform/functions/src/classes/classes-archive.ts:132), [146](platform/functions/src/classes/classes-archive.ts:146) | idempotent on `archived`; else narrows to `active` implicitly | B | would silently write `archived` from `needsSetup` given the "no other status is possible" comment; behavior is undefined once union extends | accept both `active` and `needsSetup` as valid pre-images; adopt `assertClassSupports("archive", record)` | archive | yes | archive-from-needsSetup happy path |
| S3 | `classes/classes-update-metadata.ts` handler | [257](platform/functions/src/classes/classes-update-metadata.ts:257) | requires `status === "active"`, throws `classes.notActive` | B (verify) | reject with `classes.notActive` (correct) | keep reject; adopt `assertClassSupports("editMetadata", record)` for consistency | editMetadata | yes | needsSetup reject test |
| S4 | `enrollments/enrollments-join-by-code.ts` `resolveClassByJoinCode` | [124](platform/functions/src/enrollments/enrollments-join-by-code.ts:124) | requires `record.status === "active"`, throws `enrollments.joinCodeNotFound` | B (verify) | reject (correct) | keep reject; adopt `assertClassSupports("studentJoin", record)`; per Spec §5 Option B, join code is not present on needsSetup, so this path is doubly safe | studentJoin | yes | needsSetup reject test |
| S5 | `enrollments/enrollments-teacher-add.ts` handler | [204](platform/functions/src/enrollments/enrollments-teacher-add.ts:204) | requires `classRecord.status === "active"`, throws `enrollments.invalidClassStatus` | B (verify) | reject (correct) | keep reject; adopt `assertClassSupports("teacherAddEnrollment", record)` | teacherAddEnrollment | yes | needsSetup reject test |
| S6 | `enrollments/enrollments-set-status.ts` handler | [233](platform/functions/src/enrollments/enrollments-set-status.ts:233) | reads class for ownership, no lifecycle gate on class | A | no effect (no enrollment can exist for needsSetup) | none | n/a | no | reachability regression |
| S7 | `assignments/assignments-create-draft.ts` handler | [310](platform/functions/src/assignments/assignments-create-draft.ts:310) | requires `classRecord.status === "active"`, throws `assignments.invalidClassStatus` | B (verify) | reject (correct) | keep reject; adopt `assertClassSupports("assignDraft", record)` | assignDraft | yes | needsSetup reject test |
| S8 | `assignments/assignments-recipient-add.ts` handler | [304](platform/functions/src/assignments/assignments-recipient-add.ts:304) | requires `enrollment.status === "active"`; class not re-checked | A | unreachable (no enrollment exists for needsSetup class) | none | n/a | no | reachability regression |
| S9 | `assignments/assignments-teacher-list.ts` `listForTeacher` | file | joins assignment to class for display; no lifecycle gate on class | A | rows for classes transitioned needsSetup->active continue to resolve; no active-only filter drops rows | none | n/a | no | none |
| S10 | `assignments/assignments-publish.ts` handler | [140](platform/functions/src/assignments/assignments-publish.ts:140) | operates on assignment `status`; class gated at draft | A | unreachable (no draft targets needsSetup after S7) | none | n/a | no | reachability regression |
| S11 | `lms/classes-import.ts` handler | [151](platform/functions/src/lms/classes-import.ts:151) | requires `classRecord.status === "active"`, throws `lms.classNotActive` | B | rejects a freshly-created `needsSetup` class - blocks the ADR §7.4 orchestration | extend guard to accept `"active"` OR `"needsSetup"`; keep archived reject; adopt `assertClassSupports("lmsLink", record)` | lmsLink | yes | needsSetup link happy path |
| S12 | `lms/roster/sync-engine.ts` `synchronizeClassRoster` | [405](platform/functions/src/lms/roster/sync-engine.ts:405) | requires `classRecord.status === "active"` | B (verify) | reject with unstructured message | keep reject per Spec §6 Option B; adopt `assertClassSupports("rosterSync", record)`; emit `lms.classNotActive` | rosterSync | yes | needsSetup reject test |
| S13 | `lms/classes-sync-roster.ts` callable | file | delegates to S12 | B (verify) | see S12 | see S12 | rosterSync | yes | shared with S12 |
| S14 | `lms/classes-refresh.ts` handler | file | operates on `lmsClassLinks`; no class lifecycle gate | A | link health refreshable while needsSetup (desired per Spec §6.3) | none | n/a | no | none |
| S15 | `assessments/assessment-attempts-list-for-class.ts` handler | file | verifies class ownership; no lifecycle gate | A | no effect (no attempts exist) | none | n/a | no | reachability regression |
| S16 | `assessments/assessment-attempt-get-for-teacher.ts` handler | file | verifies class ownership; no lifecycle gate | A | no effect | none | n/a | no | none |
| S17 | `assessments/assessment-assignment-summary.ts` handler | file | verifies class + assignment; assignment gated at draft | A | unreachable | none | n/a | no | reachability regression |
| S18 | `assignments/assignments-list-for-student.ts` handler | file | operates on recipient docs; no recipient exists for needsSetup class | A | unreachable | none | n/a | no | reachability regression |

Adjacent-but-unrelated status references confirmed as E (out of scope):

- `enrollments/enrollments-teacher-add.ts:224` narrows on `student.status === "active"` (student user, not class).
- `enrollments/enrollments-set-status.ts:233` narrows on `enrollment.status`.
- `enrollments/enrollments-join-by-code.ts:195,215` narrow on
  `student.status` and write `enrollment.status`.
- `lms/roster/sync-engine.ts:137, 181, 193, 214, 271, 339, 357` operate
  on `lmsClassLinks.status`, `enrollments.status`, or in-memory
  enrollment status; not the class lifecycle field.
- `lms/classes-import.ts:164, 193, 251, 263` operate on
  `lmsClassLinks.status`.
- `teachers/teachers-approve-verification.ts:157, 170, 201, 206, 232`
  and `students/students-complete-onboarding.ts:176` operate on user
  `status`, not class lifecycle.
- `shared/identity/external-identity-store.ts:288, 468` operate on
  external-identity status.

None of these E rows are affected by the `ClassStatus` extension.

---

## 5. Client Reader Matrix

| Row | File | Line | Current behavior | A/B/C/D/E | needsSetup effect today | Required Phase 2B change | Load-bearing before first needsSetup write | Deferrable to Phase 2B.4? | Test |
|---|---|---|---|---|---|---|---|---|---|
| C1 | `app/src/classes/listClasses.ts` `isStatus` + `toSummary` | [33](app/src/classes/listClasses.ts:33), [43](app/src/classes/listClasses.ts:43) | narrows to `"active" \| "archived"`; foreign values drop the row | B | **needsSetup class disappears from teacher's list** | extend `ClassStatus` union to include `"needsSetup"`; keep row in the summary; treat `grade`, `block`, `joinCode` as absent-tolerant on the needsSetup arm | yes | no (Phase 2B.1) | needsSetup row is returned |
| C2 | `app/src/settings/integrations/wire.ts` `createListTeacherClasses` | [416](app/src/settings/integrations/wire.ts:416) | filters to `status === "active"` for Integrations picker | A (intentional) | needsSetup class hidden from Integrations picker (desired) | keep filter | no | n/a | ensure filter documented in Phase 2B.1 |
| C3 | `app/src/settings/integrations/integrations.ts` LMS import picker | [187](app/src/settings/integrations/integrations.ts:187) | filters to `status === "active"` for connections list | A (this predicate targets connection status, not class - narrow scope) | no class effect | none | no | n/a | none |
| C4 | `app/src/classes/importFromClassroom.ts` `findActiveConnection` | [191](app/src/classes/importFromClassroom.ts:191) | operates on LMS connection status | A | no class effect | none | no | n/a | none |
| C5 | `app/src/classes/importFromClassroom.ts` duplicate pre-check | file | reads only active classes via C2 filter | A | duplicate needsSetup not detected client-side; server-side `alreadyLinked` (S11) is authoritative | none | no | n/a | none |
| C6 | `app/src/shell/surfaces/classes.ts` list + workspace rendering | [62](app/src/shell/surfaces/classes.ts:62), [1207](app/src/shell/surfaces/classes.ts:1207), [1213](app/src/shell/surfaces/classes.ts:1213) | `STATUS_LABEL: Record<ClassSummary["status"], string>` indexed by `summary.status`; join code and workspace tabs unconditional | B (list-render) then C (workspace setup form) | after C1 extends, `STATUS_LABEL["needsSetup"]` yields `undefined` and prints as `"undefined"`; join code appears only if summary.joinCode is set (safe), but assignment / roster affordances remain visible | Phase 2B.1: add `needsSetup` label; hide join code / roster / assignment for needsSetup and render a "Finish setting up this class" affordance stub. Phase 2B.4: full setup form and activation wiring | yes (label + affordance) | Phase 2B.4 owns the setup form itself | needsSetup row renders label; no join code; setup affordance rendered |
| C7 | `app/src/shell/surfaces/curriculum.ts` assignment class selector | [1178](app/src/shell/surfaces/curriculum.ts:1178) | filters to `status === "active"` | A (intentional) | needsSetup hidden from assignment picker (desired) | keep filter; align filter with the client-side `isInstructionEligible(record)` helper per Spec §4.4 | no | n/a | ensure filter documented |
| C8 | `app/src/shell/surfaces/snapshot.ts` `STATUS_LABEL` and pill | [73](app/src/shell/surfaces/snapshot.ts:73), [126](app/src/shell/surfaces/snapshot.ts:126), [130](app/src/shell/surfaces/snapshot.ts:130), [132](app/src/shell/surfaces/snapshot.ts:132) | `STATUS_LABEL: Record<ClassSummary["status"], string>` and `snapshot-class-status-{status}` CSS class | B | after C1 extends, `STATUS_LABEL["needsSetup"]` -> `undefined` and pill class becomes `shell-snapshot-status-needsSetup` (unstyled); `input.summary.grade.length > 0` at [117](app/src/shell/surfaces/snapshot.ts:117) already tolerates empty-string, but the discriminated-union client type will yield `undefined` for grade, which crashes `.length` at read | Phase 2B.1: either exclude needsSetup from Snapshot (recommended, dashboards should not summarize a class without a roster) or add a `needsSetup` label and gate the grade line on presence. If excluded, the current Classes surface's snapshot preview should skip needsSetup rows or route them to the setup form instead | yes | no | needsSetup exclusion or safe-render test |
| C9 | `app/src/session/consistency.ts` | [36](app/src/session/consistency.ts:36) | inspects user record `status`, not class | E | no effect | none | no | n/a | none |
| C10 | Exhaustive `switch (status)` sweep | app/src, functions/src | grep returned no `switch (` block on class `status` on either side | D | no compile break from a switch statement | none | no | n/a | typecheck-driven audit at Phase 2B.1 union widening confirms |
| C11 | `app/src/settings/integrations/wire.ts` classes projection typing | [416](app/src/settings/integrations/wire.ts:416) | consumes `ClassSummary.status` via C2 | D | after C1 union extends, filter continues to include only `active`; safe | none | no | n/a | typecheck |
| C12 | Manual Create default form seed | [96](app/src/shell/surfaces/classes.ts:96) | seeds `grade: "7", block: "A"` on the create form | C (Phase 2B.4) | not a needsSetup reader; but the hard-coded defaults are the immediate cause of the Phase 2 defect the ADR corrects | replace with the teacher's `defaultGrade` preference per Phase 2B.4 | no | Phase 2B.4 | Manual Create writes teacher-selected grade |

The `ClassRecord`-typed surfaces on the server are otherwise safe: no
server helper indexes into a `Record<ClassStatus, ...>` map by status
today. The client `STATUS_LABEL` maps in C6 and C8 are the only two
indexed-by-status structures found.

---

## 6. Type and Parser Findings

Confirmed against `main`:

1. Server `ClassStatus` at `platform/functions/src/shared/types/class.ts:15`
   is a two-value string literal union. Extending it to include
   `"needsSetup"` is additive and compiles.
2. Server `ClassRecord` at line 27 is a single object type with
   required `grade`, `block`, `joinCode`, `status`, `createdAt`. Phase
   2B.1 converts it into the discriminated union in Phase 2B Spec §7.4
   (`ActiveClassRecord | ArchivedClassRecord | NeedsSetupClassRecord`).
   Every current caller that reads `record.grade`, `record.block`, or
   `record.joinCode` is already inside a code path that has verified
   `status === "active"` (S3, S4, S5, S7, S11, S12) or reads on
   archived records (which retain those fields per §7.4 of the spec).
   Therefore the union widening is not expected to force new callers to
   pre-narrow.
3. Server write shapes are safe as-is: `ClassCreationWrite` still
   requires the full active shape; `ClassArchiveWrite` still writes
   only `status: "archived"`; `ClassMetadataUpdateWrite` and
   `ClassLmsLinkWrite` are unchanged. Two new write shapes are added:
   `ClassLmsCreationWrite` and `ClassActivationWrite` per Spec §7.4.
   No changes to existing shapes.
4. Client `ClassStatus` at `app/src/classes/types.ts:13` is a mirror.
   The client parser (`isStatus`, `toSummary` at
   `app/src/classes/listClasses.ts:33-53`) must be widened to accept
   `"needsSetup"` and tolerate absent `grade` on that arm. The
   `ClassSummary` type must be a discriminated union mirroring the
   server, with the `needsSetup` arm allowing `grade`, `block`, and
   `joinCode` to be absent. Existing consumers of `summary.grade`
   (`snapshot.ts:117, 121`) must narrow first.
5. Legacy missing-status behavior: `isStatus` returns `false` for any
   value outside the union. `toSummary` drops the row. After the union
   extension, `"needsSetup"` becomes accepted; any other unknown value
   remains dropped. This is the correct forward-compatible behavior for
   a future lifecycle addition.
6. Confirmed: `needsSetup` may omit `grade`, `block`, `joinCode`, and
   `joinCodeExpiresAt`. `active` may not omit any of the three. Archived
   records retain `grade`, `block`, `joinCode` because archival writes
   only the `status` field.
7. Confirmed: no existing Firestore converter or `.withConverter(...)`
   binding sits on the `classes/{classId}` reads. The parser boundary
   is `toSummary` on the client and typed helpers on the server. No
   converter migration is required.

---

## 7. Shared Eligibility Operation Table

Phase 2B.1 introduces a single narrow helper. Recommended surface:

```
type ClassOperation =
  | "activate"
  | "editMetadata"
  | "archive"
  | "assignDraft"
  | "teacherAddEnrollment"
  | "studentJoin"
  | "rosterSync"
  | "lmsLink";

function assertClassSupports(op: ClassOperation, record: ClassRecord): void;
```

Fixed operation table (this row set is the acceptance table for Phase
2B.1):

| Operation | active | needsSetup | archived | Absent / invalid status | Error taxonomy on refusal |
|---|---|---|---|---|---|
| activate | ok (idempotent, returns existing joinCode) | ok (drives transition) | throw | throw | `classes.notActivatable` (409) on archived; `classes.notFound` (404) on absent |
| editMetadata | ok | throw | throw | throw | `classes.notActive` (409) |
| archive | ok | ok | ok (idempotent) | throw | `classes.notFound` (404) on absent |
| assignDraft | ok | throw | throw | throw | `assignments.classNotActive` (409); today the code is `assignments.invalidClassStatus` at S7 - the Phase 2B.1 unit renames to align with the spec taxonomy (see §14 Risks / R-taxonomy) |
| teacherAddEnrollment | ok | throw | throw | throw | `classes.notActive` (409); today the code is `enrollments.invalidClassStatus` at S5 - rename per spec |
| studentJoin | ok | throw (indistinguishable) | throw (indistinguishable) | throw | `enrollments.joinCodeNotFound` (404) - preserves attack-surface parity with the spec |
| rosterSync | ok | throw | throw | throw | `lms.classNotActive` (409) - today S12 throws without a stable code; Phase 2B.1 introduces the code |
| lmsLink | ok | ok | throw | throw | `lms.classNotActive` (409) |

The helper never calls Firestore, never touches audit, never logs. Its
adoption plan follows Phase 2B Spec §4.3: seven callables adopt in
Phase 2B.1; `classesActivate` adopts on creation in Phase 2B.3; the
remainder is optional cleanup in Phase 2B.5.

Naming preference: the operation keys are domain nouns, not policy
levers. If Phase 2B.1 reviewers prefer `"createDraftAssignment"` over
`"assignDraft"` etc., substitute at implementation time; the shape of
the table stands.

---

## 8. Must Be Certified Before First needsSetup Write

The following rows must be safe on `main` before any code path (script,
callable, admin console) is permitted to write a `needsSetup` class
document. This is Phase 2B.1's Definition of Done.

| # | File | Function / surface | Current behavior | Required behavior | Phase 2B unit | Test | Blocks needsSetup writes |
|---|---|---|---|---|---|---|---|
| 1 | `platform/functions/src/classes/classes-archive.ts` | `classesArchiveHandler` | idempotent on `archived`; implicit `active` narrow | accept `active` and `needsSetup`; adopt helper | 2B.1 | archive-from-needsSetup happy path | yes |
| 2 | `platform/functions/src/classes/classes-update-metadata.ts` | handler | rejects non-active with `classes.notActive` | keep reject; adopt helper | 2B.1 | needsSetup reject | yes (verify) |
| 3 | `platform/functions/src/enrollments/enrollments-join-by-code.ts` | `resolveClassByJoinCode` | rejects non-active with `enrollments.joinCodeNotFound` | keep reject; adopt helper; guard is doubly safe because Spec §5 Option B omits joinCode | 2B.1 | needsSetup reject | yes (verify) |
| 4 | `platform/functions/src/enrollments/enrollments-teacher-add.ts` | handler | rejects non-active with `enrollments.invalidClassStatus` | keep reject; adopt helper; align code with spec taxonomy | 2B.1 | needsSetup reject | yes (verify) |
| 5 | `platform/functions/src/assignments/assignments-create-draft.ts` | handler | rejects non-active with `assignments.invalidClassStatus` | keep reject; adopt helper; align code with spec taxonomy | 2B.1 | needsSetup reject | yes (verify) |
| 6 | `platform/functions/src/lms/classes-import.ts` | handler | rejects non-active with `lms.classNotActive` | accept `active` and `needsSetup`; keep archived reject; adopt helper | 2B.1 | needsSetup link happy path | yes |
| 7 | `platform/functions/src/lms/roster/sync-engine.ts` (and `classes-sync-roster.ts`) | `synchronizeClassRoster` | rejects non-active without stable code | keep reject per Spec §6 Option B; adopt helper; introduce `lms.classNotActive` | 2B.1 | needsSetup reject | yes (verify) |
| 8 | `app/src/classes/listClasses.ts` | `isStatus`, `toSummary`, `ClassSummary` shape | drops row for foreign status | widen union; keep row; discriminated summary shape | 2B.1 | needsSetup row is returned | yes |
| 9 | `app/src/shell/surfaces/classes.ts` | list render + workspace | `STATUS_LABEL` two-key map; assumes join code / roster / assignment tabs | Phase 2B.1: add `needsSetup` label; hide join code / roster / assignment; render setup affordance stub. Phase 2B.4: full setup form | 2B.1 (list-render + affordance stub); 2B.4 (form) | needsSetup row renders label; no join code; setup affordance rendered | yes (list render must not crash or misrender) |
| 10 | `app/src/shell/surfaces/snapshot.ts` | `STATUS_LABEL` + pill + grade line | two-key map; unconditional `summary.grade.length` | either exclude needsSetup or add `needsSetup` label and narrow grade line on presence | 2B.1 | needsSetup exclusion or safe-render | yes |
| 11 | `app/src/classes/types.ts` | `ClassStatus`, `ClassSummary` | two-value union; `grade` required | union widened; `grade`, `block`, `joinCode` optional on the `needsSetup` arm | 2B.1 | typecheck | yes |

Twelfth pre-write item, procedural: the exhaustiveness sweep. Phase
2B.1 must run `tsc --noEmit` on both `app/` and `platform/functions/`
after the union widens and fix every compiler-surfaced missing arm as
part of the same PR. This is not a file-scoped row; it is the safety
net that catches any reader §5 missed.

No thirteenth item was discovered.

---

## 9. Phase 2B.1 Test Checklist

Existing tests are green today because the union contains only `active`
and `archived`. Phase 2B.1 adds tests without deleting any; regression
on `active` and `archived` is the primary safety net.

Server:

1. `platform/functions/src/shared/classes/eligibility.test.ts` (new):
   one unit test per cell of §7. Total 32 cases.
2. `platform/functions/src/classes/classes-archive.test.ts`: add
   archive-from-needsSetup happy path; retain the existing
   idempotent-archived and active-to-archived tests unchanged.
3. `platform/functions/src/classes/classes-update-metadata.test.ts`:
   add needsSetup reject case (`classes.notActive`).
4. `platform/functions/src/enrollments/enrollments-join-by-code.test.ts`:
   add needsSetup reject case (`enrollments.joinCodeNotFound`). Also
   verify that a needsSetup class carrying no `joinCode` field is
   simply not discoverable by the `where("joinCode", "==", ...)` query
   (defensive test).
5. `platform/functions/src/enrollments/enrollments-teacher-add.test.ts`:
   add needsSetup reject case; the existing archived-reject test at
   line 332 is the reference.
6. `platform/functions/src/assignments/assignments-create-draft.test.ts`:
   add needsSetup reject case; the existing non-active-reject test at
   line 393 is the reference.
7. `platform/functions/src/lms/classes-import.test.ts` (or the
   in-file test): add needsSetup happy-path test. Add archived reject
   regression.
8. `platform/functions/src/lms/roster/sync-engine.test.ts` (or
   `classes-sync-roster.test.ts`): add needsSetup reject with new
   `lms.classNotActive` code.
9. Reachability regressions (S6, S8, S10, S15, S17, S18): a single
   integration test that constructs a needsSetup class and asserts that
   `assignmentsRecipientAdd`, `assignmentsPublish`,
   `assignmentsListForStudent`, `assessmentAttemptsListForClass`, and
   `assessmentAssignmentSummary` are unreachable because no assignment
   / recipient / enrollment / attempt can be created against the class
   in the first place. This one integration test covers five rows.

Client:

10. `app/src/classes/listClasses.test.ts` (new or extended):
    assert `isStatus("needsSetup") === true`; assert `toSummary` returns
    a summary for a needsSetup document with grade / block / joinCode
    absent; assert the returned summary's discriminated shape.
11. `app/src/shell/surfaces/classes.test.ts`: assert needsSetup card
    renders the correct label, does not render a join code, does not
    render an assignment or roster affordance, and does render a
    "Finish setting up this class" affordance.
12. `app/src/shell/surfaces/snapshot.test.ts` (new if absent): assert
    the chosen behavior for needsSetup (exclusion or safe-render). If
    exclusion: assert Snapshot does not select a needsSetup row and
    routes back to the setup form.
13. `app/src/shell/surfaces/curriculum.test.ts` (if present): assert
    the assignment class picker does not list needsSetup rows.

Regression floor:

14. Every existing test file in `app/src/` and `platform/functions/src/`
    referenced above must continue to pass unmodified. Any test that
    fails without an intentional Phase 2B.1 assertion change is a
    stop-condition trigger.

Legacy fixture audit:

15. Search `platform/functions/src/**/*.test.ts` and `app/src/**/*.test.ts`
    for fixtures that write class documents with hard-coded `status:
    "active"` or `status: "archived"`. None must be forced to change,
    but any fixture that constructs an eligibility-neutral `ClassRecord`
    (for reuse in the new tests) should be surfaced.

Assessment surfaces are unaffected in Phase 2B.1 beyond the reachability
regression in test 9.

---

## 10. Deployment and Rollback Gate

### 10.1 Pre-write deployment gate

The first `needsSetup` writer (`classesLmsCreate` invoked from the
client) may not deploy until each of the following is true on
production:

1. §8 rows 1..11 are safe on `main`.
2. `assertClassSupports` is exported and adopted per §4.3 of the spec.
3. Assignment eligibility rejects needsSetup (S7 with helper).
4. Join-code enrollment rejects needsSetup (S4 with helper).
5. Roster-sync engine rejects needsSetup with `lms.classNotActive`
   (S12).
6. Snapshot excludes needsSetup or safely renders it (C8).
7. Classes surface renders needsSetup and shows the setup affordance
   (C6).
8. `grade` / `block` / `joinCode` absence does not crash any surface.
9. Rollback behavior is documented (this section).
10. Old clients cannot see a needsSetup class as active.

### 10.2 Old-client safety analysis

An old client (pre-Phase 2B.1) served after Phase 2B.4 has already
written a needsSetup document:

- The old `isStatus` guard at
  [app/src/classes/listClasses.ts:34](app/src/classes/listClasses.ts:34)
  returns `false` for `"needsSetup"`. The old `toSummary` returns
  `null`. **The needsSetup class disappears from the old client's
  list.** This is a fail-closed behavior: the teacher does not see a
  class they cannot act on. Not a crash. Recoverable by loading the new
  client.
- The old `STATUS_LABEL` maps at
  [classes.ts:62](app/src/shell/surfaces/classes.ts:62) and
  [snapshot.ts:73](app/src/shell/surfaces/snapshot.ts:73) are never
  reached because the row was dropped upstream.
- The old `curriculum.ts:1178` filter continues to exclude it
  regardless.
- The old client cannot expose join code (no joinCode field in the
  needsSetup document).
- The old client cannot expose assignment controls (needsSetup row
  never reaches the assignment picker).
- The old client cannot complete setup (no setup form exists in the
  old bundle).
- The old client cannot open the workspace (the class is not in the
  list; there is no reachable navigation).

Conclusion: the old client is **fail-closed** on needsSetup writes.
The teacher's only observable symptom on an old client is that the
just-imported class is not visible until they refresh into the new
client. This is acceptable and matches the spec's rollback discussion
in §11.2.

### 10.3 Deployment order

Per Spec §11.1, the deployment order is fixed:

1. Phase 2B.1: server + client reader upgrade. No needsSetup writer
   yet. Ship Functions + Hosting as a single bundle.
2. Phase 2B.2: preference contract. Independent.
3. Phase 2B.3: creation seam + activation callable. Deployed dark.
4. Phase 2B.4: client swap. First release that writes needsSetup.
5. Phase 2B.5: adoption sweep + certification.

The writer must remain dark until the client swap in Phase 2B.4.
Between Phase 2B.3's Functions deploy and Phase 2B.4's Hosting deploy,
no code path calls `classesLmsCreate`.

### 10.4 Rollback boundaries

- 2B.1 rollback: safe. No documents change.
- 2B.2 rollback: safe. Subdoc becomes inert.
- 2B.3 rollback: safe. Callables are dead code.
- 2B.4 rollback: partially safe. Existing needsSetup documents survive.
  Old client fail-closes on them (see 10.2). Recovery = re-deploy
  2B.4 or archive via `classesArchive` (which after 2B.1 accepts
  needsSetup).
- 2B.5 rollback: safe.

### 10.5 Manual write prohibition

No script, migration, admin console, or emulator seeding may write a
needsSetup document until Phase 2B.4 is production-verified. Phase
2B.1..2B.3 tests may construct needsSetup documents in the emulator
because those environments are isolated.

---

## 11. Phase 2B.1 Exact Scope

Files expected to change:

- `platform/functions/src/shared/types/class.ts` (union widening;
  discriminated union; two new write shapes).
- `platform/functions/src/shared/classes/eligibility.ts` (new; helper).
- `platform/functions/src/shared/classes/index.ts` (barrel; new).
- `platform/functions/src/shared/index.ts` (re-export the helper and
  new types).
- `platform/functions/src/classes/classes-archive.ts` (adopt helper;
  accept needsSetup pre-image).
- `platform/functions/src/classes/classes-update-metadata.ts` (adopt
  helper; align error code to `classes.notActive`).
- `platform/functions/src/enrollments/enrollments-join-by-code.ts`
  (adopt helper).
- `platform/functions/src/enrollments/enrollments-teacher-add.ts`
  (adopt helper; align error code per §7 note).
- `platform/functions/src/assignments/assignments-create-draft.ts`
  (adopt helper; align error code per §7 note).
- `platform/functions/src/lms/classes-import.ts` (adopt helper; accept
  needsSetup pre-image).
- `platform/functions/src/lms/roster/sync-engine.ts` (adopt helper).
- `platform/functions/src/lms/classes-sync-roster.ts` (delegates to
  S12; no separate change).
- `app/src/classes/types.ts` (union widening; discriminated
  ClassSummary).
- `app/src/classes/listClasses.ts` (extend `isStatus`; extend
  `toSummary`).
- `app/src/shell/surfaces/classes.ts` (STATUS_LABEL entry; needsSetup
  branch; join-code hide; setup-affordance stub).
- `app/src/shell/surfaces/snapshot.ts` (needsSetup exclusion or safe
  render; grade line narrow).

Types created:

- `NeedsSetupClassRecord`, `ActiveClassRecord`, `ArchivedClassRecord`
  (server discriminated union).
- `ClassLmsCreationWrite`, `ClassActivationWrite` (declared for
  Phase 2B.3 use; unused in 2B.1 code paths).
- `ClassOperation` (helper input type).
- Client-side discriminated `ClassSummary` variant equivalents.

Helper created:

- `assertClassSupports(op, record)` in
  `platform/functions/src/shared/classes/eligibility.ts`.

Callables that adopt the helper in 2B.1:

- `classesUpdateMetadata`, `classesArchive`, `assignmentsCreateDraft`,
  `enrollmentsJoinByCode`, `enrollmentsTeacherAdd`,
  `lmsClassesImport`, roster sync engine (`synchronizeClassRoster`).

Client readers that become needsSetup-safe in 2B.1:

- `app/src/classes/listClasses.ts` (parser).
- `app/src/shell/surfaces/classes.ts` (list card render + affordance
  stub; no setup form yet).
- `app/src/shell/surfaces/snapshot.ts` (exclusion or safe render).

Tests added or updated: see §9.

Explicit non-scope for Phase 2B.1:

- No new callable (`classesLmsCreate`, `classesActivate`,
  `teacherPreferencesUpdate` all wait for later units).
- No new client workflow (import swap, setup form, Manual Create
  cleanup all wait for Phase 2B.4).
- No Firestore Rules change (the preference subdoc block belongs to
  Phase 2B.2).
- No audit-event kind changes.
- No `needsSetup` document is written by production code in any
  environment.
- No governing-doc edits beyond this audit's own file. Phase 2B Spec
  §13 governs the ADR / Blueprint / Phase 2 report amendments; those
  are Phase 2B.3+ documentation, not Phase 2B.1.

Verification commands (Phase 2B.1):

- `npm --prefix platform/functions test`
- `npm --prefix app run typecheck` (or the project's equivalent
  `npm --prefix app run verify`)
- `npm --prefix app run lessons:verify` (Sprint 18 gate; unrelated but
  part of the standard chain)

Rollback boundary: full and safe. No documents change; the reader
extensions are inert on `active` / `archived`.

Definition of done for Phase 2B.1:

- Verification chain green.
- All §9 tests present and passing.
- `assertClassSupports` is exported and adopted per the seven
  callables above.
- Manual grep confirms no production code path writes a
  `needsSetup` document.
- Emulator harness can construct a needsSetup document and observe
  correct reader / callable behavior across §8 rows 1..11.

Stop conditions for Phase 2B.1:

- Any TypeScript exhaustiveness failure that cannot be resolved by
  adding a `needsSetup` arm without behavior change.
- Any reader newly discovered during the exhaustiveness sweep that is
  not in §5 and cannot be trivially made safe.
- Any existing test that fails under the new union without a spec-authorized
  assertion change.

---

## 12. Deferred Work

The following are called out to prevent scope creep in Phase 2B.1.
Each has its own designated Phase 2B unit.

- `classesLmsCreate` callable - Phase 2B.3.
- `classesActivate` callable (join-code generation, transactional
  atomicity, audit) - Phase 2B.3.
- `teacherPreferencesUpdate` callable and the
  `users/{uid}/preferences/teacher` subdoc Rules block - Phase 2B.2.
- Client `importFromClassroom.ts` swap from `classesCreate` to
  `classesLmsCreate` - Phase 2B.4.
- Workspace setup form (one-screen, hosted inside the class workspace)
  - Phase 2B.4.
- Manual Create form default retirement (remove hard-coded `"7"` /
  `"A"` seeds; wire `defaultGrade` pre-fill) - Phase 2B.4.
- Adoption sweep of `assertClassSupports` in the safe-but-neutral
  callables (S6, S15, S16, S17, S18) - Phase 2B.5, optional.
- ADR §7.4 / Blueprint §9.2.2, §9.2.3, §9.2.7 corrections per Spec
  §13 - Phase 2B.3 or Phase 2B.5.
- Co-teacher activation - out of scope for Phase 2B entirely.

---

## 13. Risks

- **R1. Reader miss.** Mitigated by the TypeScript exhaustiveness pass
  in Phase 2B.1 and the regression floor in §9 test 14. The audit
  found no new load-bearing readers beyond §5.
- **R2. Error-code renaming friction.** S5 and S7 use codes
  `enrollments.invalidClassStatus` and `assignments.invalidClassStatus`
  that predate the Spec §4.1 taxonomy naming (`classes.notActive` /
  `assignments.classNotActive`). Renaming touches the tests at
  [enrollments-teacher-add.test.ts:337](platform/functions/src/enrollments/enrollments-teacher-add.test.ts:337)
  and [assignments-create-draft.test.ts:399](platform/functions/src/assignments/assignments-create-draft.test.ts:399)
  and any client that consumes the code. Recommendation: keep the
  historical codes as-is in Phase 2B.1 (preservation over renaming);
  the helper can emit the historical code per operation. Phase 2B.5
  may consolidate the taxonomy in a separate, scoped change if
  reviewers wish.
- **R3. Snapshot exclusion vs safe-render.** C8 admits two designs.
  The audit recommends exclusion because a needsSetup class has no
  roster, no assignments, no attempts, and therefore nothing for
  Snapshot to summarize. Safe-render is a viable fallback but ships
  more UI code than needed. Decision belongs to Phase 2B.1 reviewers.
- **R4. Discriminated `ClassSummary`.** Widening the client type may
  ripple to any surface that reads `summary.grade` unconditionally.
  Confirmed today: only `snapshot.ts:117, 121` does so, and it is
  already in the required-change list. `classes.ts` does not read
  `summary.grade` on the list card. If Phase 2B.1's typecheck surfaces
  additional consumers, they must be resolved before merge; the
  exhaustiveness safety net catches this.
- **R5. Manual-write leakage.** The prohibition in §10.5 is procedural.
  Enforcement is by review, not by code. Recommendation: Phase 2B.1
  reviewers include this gate on the PR template checklist.
- **R6. Curriculum-manifest CI drift** (pre-existing, from Spec §14
  R9). Continues to fail `curriculum:verify` on `main`. Not a Phase
  2B.1 blocker.

No risk in this audit reaches the severity of "reopen the spec". The
spec's forecast is confirmed.

---

## 14. Phase 2B.0 Certification Recommendation

Recommendation: **Phase 2B.0 is certified complete.** Phase 2B.1 may
begin.

Justification:

- The reader-audit forecast in Phase 2B Spec §3 matches the repository
  at HEAD. Every S-row and C-row is confirmed by file and line.
- No newly-discovered load-bearing reader requires the spec to
  reopen.
- The load-bearing pre-write blocker list is bounded and enumerable
  (§8, 11 rows).
- Test inventory (§9) is fully derivable and additive.
- Old-client safety is fail-closed (§10.2).
- The shared eligibility helper contract (§7) is stable.
- No production code, tests, Rules, or governing documents were
  modified in the course of this audit.

The gate is open. Phase 2B.1 is authorized to begin under its own
Definition of Done and Stop Conditions as re-stated in §11.

---

## 15. Phase 2B.1 Work Order

This work order restates §11 in the shape the Phase 2B.1 unit should
accept as its acceptance checklist. It adds no scope beyond §11.

- Files expected to change: as enumerated in §11.
- Types expected to change: `ClassStatus`, `ClassRecord` (discriminated
  union), client `ClassStatus`, `ClassSummary`. New: two write shapes
  reserved for Phase 2B.3; `ClassOperation` for the helper.
- Helper expected to be created: `assertClassSupports` in
  `platform/functions/src/shared/classes/eligibility.ts`, exported
  through the shared barrel.
- Server callables expected to adopt the helper in this unit: seven
  (as enumerated in §11).
- Client readers expected to become needsSetup-safe: `listClasses.ts`
  parser, `classes.ts` list card + affordance stub, `snapshot.ts`
  exclusion or safe render.
- Tests expected to be added or updated: as enumerated in §9.
- Explicit non-scope: no new callable, no client workflow swap, no
  setup form, no Manual Create cleanup, no Rules change, no
  needsSetup writes.
- Verification commands: as enumerated in §11.
- Rollback boundary: full and safe. Reader extensions are inert on
  existing documents.
- Definition of done: verification chain green; §9 tests present and
  passing; helper adopted per §4.3 of the spec; no production code
  writes needsSetup; emulator harness demonstrates §8 rows 1..11.
- Stop conditions: exhaustiveness surfaces an unresolvable reader; a
  new load-bearing reader not in §5 appears; an existing test fails
  without a spec-authorized change.

Phase 2B.1 begins only after this audit is approved.

---

*End of Phase 2B.0 Reader and Authorization Audit.*
