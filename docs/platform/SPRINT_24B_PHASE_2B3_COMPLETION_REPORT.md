# Sprint 24B - Phase 2B.3 Completion Report

Phase: 2B.3 of 2B - LMS Class Creation and Class Activation Callables.

Governing spec: `docs/platform/SPRINT_24B_PHASE_2B_IMPLEMENTATION_SPECIFICATION.md`
Governing ADR: `docs/platform/ADR_TEACHER_DEFAULT_CLASS_METADATA.md`
Governing blueprint: `docs/platform/SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md`
Governing audit: `docs/platform/SPRINT_24B_PHASE_2B_READER_AUDIT.md`
Prior phase reports:
- `docs/platform/SPRINT_24B_PHASE_2B1_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_24B_PHASE_2B2_COMPLETION_REPORT.md`

Date: 2026-07-31
Preservation Mode: honored.
No em dashes anywhere.

---

## 1. Executive Summary

Phase 2B.3 introduces the two narrow server capabilities required by the
approved lifecycle architecture:

- `classesLmsCreate` - the sole `needsSetup` writer. Accepts
  `{ classId, title }`, derives ownership from the caller's canonical
  district context, and writes a `NeedsSetupClassRecord` through the
  new `classLmsCreationDocRef` typed reference. No grade, block, or join
  code is written.
- `classesActivate` - the sole activation seam. Accepts
  `{ classId, grade, block }`, validates against the closed sets,
  allocates a collision-free join code, and applies the atomic
  `{ status: "active", grade, block, joinCode }` transition in a single
  Firestore transaction. Idempotent on already-active records with
  matching metadata; conflicting metadata surfaces
  `classes.alreadyActiveConflict`.

Both callables are exported and registered. Neither is invoked by any
production client, any Google Classroom UI, any Manual Create workflow,
any setup workspace, or any route. Both are exercised by unit tests and
by a new lifecycle integration test.

No deployment. No commit. No client wiring. No `defaultBlock`. No
retirement of the Manual Create hard-coded `"7"` / `"A"` seed. The
existing `lmsClassesImport` callable remains the single authoritative
LMS link writer.

Certification recommendation: **Phase 2B.3 is complete.** Phase 2B.4 may
begin.

---

## 2. Scope Completed

- New callable `classesLmsCreate` in
  `platform/functions/src/classes/classes-lms-create.ts` with the narrow
  `{ classId, title }` request contract and the `NeedsSetupClassRecord`
  write shape.
- New callable `classesActivate` in
  `platform/functions/src/classes/classes-activate.ts` implementing the
  transactional `needsSetup -> active` transition per Spec §5.3, §8.5.
- New audit action `classes.activated` on the canonical `AuditAction`
  enum.
- New typed references `classLmsCreationDocRef` and
  `classActivationDocRef` in
  `platform/functions/src/shared/firestore/typed-ref.ts`, re-exported
  from `platform/functions/src/shared/index.ts`.
- Callable registration wired through
  `platform/functions/src/classes/index.ts` and
  `platform/functions/src/index.ts`.
- Unit tests for both callables (28 cases across the two suites).
- Lifecycle integration test proving the approved end-to-end invariants
  across creation, needsSetup rejection of instruction operations, and
  activation.
- No client-facing change. No Rules change. No Blueprint or ADR
  amendments (deferred to Phase 2B.5 per Spec §13 and Reader Audit §12).

---

## 3. Final LMS Creation Contract

### 3.1 Request

```
type ClassesLmsCreateRequest = {
  readonly classId: string;   // URL-safe token, same CLASS_ID_PATTERN as classesCreate
  readonly title: string;     // trimmed non-empty
};
```

Every other field is refused as follows: unrecognized keys are silently
dropped by the closed-parsing validator; ownership-derived fields
(`teacherId`, `schoolId`) come from the caller's canonical district
context and can never be client-supplied; `grade`, `block`, `joinCode`,
`status`, `createdAt`, `enrollmentSource`, `lmsProviderRef`, and any LMS
provider identifiers are structurally excluded from the write shape and
are dropped even when the client sends them (proven by
`ignores unexpected keys on the request (closed parsing)` in the unit
suite).

### 3.2 Response

```
type ClassesLmsCreateResponse = {
  readonly classId: string;
  readonly status: "needsSetup";
  readonly alreadyCreated: boolean;
};
```

### 3.3 Write shape

```
type ClassLmsCreationWrite = {
  readonly teacherId: string;
  readonly schoolId: string;
  readonly title: string;
  readonly status: "needsSetup";
  readonly createdAt: FieldValue;
};
```

`grade`, `block`, and `joinCode` are absent by construction. The
`ClassLmsCreationWrite` type is the single source of truth for the write
shape; the callable never widens it. LMS link fields
(`enrollmentSource`, `lmsProviderRef`) are also absent; the existing
`lmsClassesImport` callable remains the authoritative link writer per
Spec §12.

### 3.4 Audit

Emits `classes.created` with `payload: { source: "lms" }` per Spec §7.1.
No new event kind is introduced for creation.

---

## 4. Authorization Model

Both callables share the pattern used by every district-scoped teacher
callable in the codebase:

1. `requireDistrictContext(request)` - authenticates the caller, asserts
   an active user, and returns the canonical `{ uid, role, schoolId,
   districtId }` context.
2. Explicit `role === "teacher"` check; every other role throws
   `role-forbidden`.
3. Request-shape validation on the closed set of allowed fields.
4. Ownership check inside the callable (for `classesActivate` this is
   done twice: once before the transaction opens and once inside the
   transaction).

Firestore Rules are not the authorization boundary because both
callables run through the Admin SDK.

For `classesActivate` the shared eligibility helper
`assertClassSupports("activate", record)` gates the record's status:
`active` returns cleanly (idempotency), `needsSetup` returns cleanly
(the ordinary transition), and `archived` throws
`classes.notActivatable`.

`classesLmsCreate` does not call the eligibility helper because it
creates rather than mutates; the equivalent guarantee is achieved by
refusing any existing record at the same `classId` that is not a
matching-owner-and-title `needsSetup` duplicate.

---

## 5. Duplicate and Idempotency Model

### 5.1 classesLmsCreate

The callable is idempotent on `(classId, teacherId, schoolId, title)`
where the existing record must be in `needsSetup`. Concrete behavior:

- No document at `classes/{classId}`: create.
- Existing `needsSetup` with matching `teacherId`, `schoolId`, and
  `title`: return `alreadyCreated: true`. No second write, no second
  audit event.
- Existing `needsSetup` with any mismatched ownership or title field:
  reject with `classes.conflict`.
- Existing `active` at the same `classId`: reject with
  `classes.conflict`. Manual Create writes `active` documents through a
  different write shape; returning idempotent success here would
  misrepresent the record.
- Existing `archived` at the same `classId`: reject with
  `classes.conflict`. Archive is a terminal state; a new LMS creation
  attempt against an archived classId is a client-supplied classId
  collision. The teacher can create with a fresh classId (the client
  generator is a URL-safe 20-character random token per
  `app/src/classes/createClass.ts:generateClassId`).
- Concurrent duplicate creates against the same `classId`: Firestore's
  document-level write ordering yields exactly one create; the other
  arrives after the read and the write, and its second read sees the
  now-existing record. If it is the same owner and title it returns
  `alreadyCreated: true`; otherwise it throws `classes.conflict`.

The classId space is client-generated; two distinct calls that
independently target the same upstream LMS course produce distinct
`classes/{classId}` documents unless the client derives the classId
deterministically. Phase 2B.4's client swap keeps the existing
`generateClassId` random token, so per-course duplicate prevention is
performed at the LMS link layer by `lmsClassesImport` (which already
refuses to link a second LyfeLabz class to the same upstream course,
per `lms.lmsClassAlreadyLinked`). This preserves the "one authoritative
link write" invariant demanded by Spec §12.

### 5.2 classesActivate

- `needsSetup`: allocate a collision-free join code, then in a single
  transaction re-read the class, re-verify ownership and status, and
  write `{ status: "active", grade, block, joinCode }`. Return
  `alreadyActive: false`.
- `active` with matching `grade` and `block`: return the existing
  `joinCode` without a write and without a new audit event. The join
  code is NOT rotated.
- `active` with differing `grade` or `block`: reject with
  `classes.alreadyActiveConflict`. Activation is not the metadata-
  editing seam; the teacher must use `classesUpdateMetadata` on the
  active class.
- `archived`: reject with `classes.notActivatable` via
  `assertClassSupports`.
- `not-found`: reject with `classes.notFound`.
- Concurrent activation: the second caller's transaction re-reads the
  class, sees `status: "active"`, and returns the idempotent success
  (or the conflict if grade/block differ). Firestore serialization
  ensures exactly one join-code write.

---

## 6. NeedsSetup Write Shape

Per Spec §7.4, the persisted `needsSetup` document contains:

| Field | Source | Notes |
|---|---|---|
| `teacherId` | server (context) | immutable ownership |
| `schoolId` | server (context) | immutable ownership |
| `title` | client (request) | trimmed non-empty |
| `status` | server (literal) | `"needsSetup"` |
| `createdAt` | server (sentinel) | `FieldValue.serverTimestamp()` |

Absent by construction: `grade`, `block`, `joinCode`,
`joinCodeExpiresAt`, `academicTerm`, `coTeacherIds`, `enrollmentSource`,
`lmsProviderRef`. Null / empty / "Unassigned" / sentinel default values
are never persisted for any absent field. The `ClassLmsCreationWrite`
type structurally forbids widening.

---

## 7. Final Activation Contract

### 7.1 Request

```
type ClassesActivateRequest = {
  readonly classId: string;                     // CLASS_ID_PATTERN
  readonly grade: "6" | "7" | "8";              // closed set
  readonly block: "A" | "B" | "C" | "D" | "E" | "F" | "G";  // closed set
};
```

### 7.2 Response

```
type ClassesActivateResponse = {
  readonly classId: string;
  readonly status: "active";
  readonly joinCode: string;
  readonly alreadyActive: boolean;
};
```

### 7.3 Error taxonomy

| Code | Cause |
|---|---|
| `classes.invalidRequest` | non-object payload |
| `classes.invalidClassId` | bad token |
| `classes.invalidGrade` | not in `{6,7,8}` |
| `classes.invalidBlock` | not in `A..G` |
| `classes.notFound` | class absent |
| `classes.forbidden` | teacherId or schoolId mismatch |
| `classes.notActivatable` | class is archived (via helper) |
| `classes.alreadyActiveConflict` | already active, differing grade or block |
| `classes.joinCodeGenerationFailed` | exhausted the retry cap |
| `role-forbidden` | non-teacher caller |
| `unauthenticated` / `account-inactive` / `claim-stale` / `district-mismatch` | propagated from `requireDistrictContext` |

`classes.alreadyActiveConflict` is a new taxonomy entry introduced by
Phase 2B.3 to preserve the Spec §10 "do not silently treat activation
as metadata editing" invariant. All other codes are pre-existing.

---

## 8. Activation Transaction

Per Spec §8.5 the join-code uniqueness check is an indexed non-key
query that cannot execute inside a Firestore transaction. The callable
therefore executes:

1. Pre-transaction read of `classes/{classId}` for early ownership,
   existence, and status validation (including the fast-path
   already-active idempotent return).
2. Pre-transaction join-code allocation loop:
   - Generate an 8-uppercase-hex candidate (`randomBytes(4)`).
   - Query `classes.where("joinCode", "==", candidate).where("schoolId",
     "==", schoolId).limit(1)`.
   - Retry up to `JOIN_CODE_MAX_ATTEMPTS = 5` (Spec §5.3 recommended N).
   - Exhausted: throw `classes.joinCodeGenerationFailed`. No class
     mutation.
3. Transaction body:
   - `tx.get(classDocRef(classId))`.
   - Re-verify existence and ownership.
   - If `status === "active"`: return the concurrent-write idempotent
     branch (or throw `classes.alreadyActiveConflict` on mismatch).
   - If `status === "needsSetup"`: `tx.update(classActivationDocRef,
     { status: "active", grade, block, joinCode })`.
   - Any other status (concurrent archive between the two reads):
     throw `classes.notActivatable`.
4. After commit: emit `classes.activated` audit event (only when the
   transaction wrote); log info. Audit failures do not fail the
   activation, matching `classesArchive`'s posture.

The single-commit boundary guarantees that:

- The class is never observable as `active` without `grade`.
- The class is never observable as `active` without `block`.
- The class is never observable as `active` without `joinCode`.
- The class is never observable as `needsSetup` with a persisted
  `grade`/`block` that were written outside the activation transaction
  (the write shape excludes those keys entirely on any non-activation
  write path).
- A leaked join code cannot exist before the class is active (no
  earlier writer produces one, per Spec §5.1 Option B).

---

## 9. Join-Code Lifecycle

Per Spec §5 Option B (ratified):

- No join code is generated at `classesLmsCreate` time. The
  `needsSetup` document omits `joinCode`, `joinCodeExpiresAt`.
- The activation callable allocates the join code and writes it inside
  the atomic transaction alongside `status`, `grade`, and `block`.
- The join-code lookup path (`enrollmentsJoinByCode`, S4) already
  rejects non-active classes with `enrollments.joinCodeNotFound`; a
  pre-image `needsSetup` class has no `joinCode` field to match on and
  a defense-in-depth `assertClassSupports("studentJoin", record)`
  guards the resolver anyway.
- Idempotent re-activation preserves the existing `joinCode`. The
  callable never rotates.

---

## 10. Teacher Preference Follow-Up

Per Spec §8.10 and §9.6 the activation callable does NOT touch the
teacher preference document. The `defaultGrade` follow-up is a
best-effort client-side write performed by the Phase 2B.4 workspace
setup form after `classesActivate` returns successfully. The write
uses the existing `teacherPreferencesUpdate` callable shipped in
Phase 2B.2.

Rationale for not calling the preference callable from the activation
handler:

- Activation success must not depend on preference success.
- Preference failure must not roll back activation.
- Preference failure must not rotate or remove the join code.
- Repeated idempotent activations must not produce noisy preference
  writes.
- No `defaultBlock` field is ever considered (per ADR §12).

The unit test suite includes an explicit `does not touch the teacher
preferences document` assertion (both callables) confirmed by the
absence of `teacherPreferencesUpdateDocRef` from each suite's shared-
module mock.

---

## 11. LMS Link Ownership and Orchestration

Preserved: `lmsClassesImport` is the single authoritative writer of
`enrollmentSource`, `lmsProviderRef`, and every `lmsClassLinks/{linkId}`
document. `classesLmsCreate` writes neither the enrollment source nor
the LMS provider reference on the `classes/{classId}` document.

The approved Phase 2B.4 orchestration is:

1. Teacher selects an external class.
2. Client calls `classesLmsCreate` to write the `needsSetup` class.
3. Client calls `lmsClassesImport` to write the mirror link and the
   additive `{ enrollmentSource: "lms", lmsProviderRef }` fields via
   `classLmsLinkDocRef.update(...)`. Because Phase 2B.1 extended
   `assertClassSupports("lmsLink", record)` to accept `needsSetup`,
   the link happy path already works against the new pre-image (proven
   by the Phase 2B.1 `lmsClassesImport` `needsSetup` pre-image test).
4. Teacher completes grade and block through the setup form.
5. Client calls `classesActivate`.
6. Client best-effort calls `teacherPreferencesUpdate` for the
   `defaultGrade` follow-up.
7. Phase 3 may perform initial roster sync only after step 5.

Rollback footprint: if step 3 fails after step 2, the result is a
`needsSetup` class with no link. The Classes surface surfaces it with
the "Finish setting up" affordance shipped in Phase 2B.1; the teacher
can either complete setup or archive via `classesArchive` (which after
Phase 2B.1 accepts `needsSetup` pre-images).

Zero conceptual duplication: neither callable emits the additive LMS
enrollment-source fields; the link callable remains the sole authority.

---

## 12. Failure and Recovery Behavior

The classes-lifecycle-integration test and the two unit suites together
exercise every failure surface listed in the phase objective §13:

- Unauthenticated caller: propagates `unauthenticated`.
- Inactive / non-teacher / missing-district caller: propagates the
  canonical district errors.
- Bad payload: `classes.invalidRequest`, `classes.invalidClassId`,
  `classes.invalidTitle` (create), `classes.invalidGrade` /
  `classes.invalidBlock` (activate).
- Cross-owner / cross-school: `classes.conflict` (create),
  `classes.forbidden` (activate).
- Class not found (activate): `classes.notFound`.
- Archived (activate): `classes.notActivatable`.
- Already-active matching (activate): idempotent return.
- Already-active conflicting (activate): `classes.alreadyActiveConflict`.
- Concurrent activation: idempotent-or-conflict branch inside the
  transaction.
- Race: concurrent archive between pre-read and transaction:
  `classes.notActivatable`.
- Malformed needsSetup record inside the transaction (owner drift):
  `classes.forbidden`. No write.
- Join-code collision: retries up to 5.
- Join-code retry exhaustion: `classes.joinCodeGenerationFailed`. No
  class mutation.
- Audit-write failure after commit: consistent with existing atomicity
  policy; the activation succeeds. Follows the same pattern as
  `classesArchive`.
- Preference-write failure: outside the callable entirely; cannot
  affect activation.

Every failure leaves either no class, a valid `needsSetup` class, or a
fully valid `active` class. No intermediate observable state exists.

---

## 13. Tests Added or Updated

### 13.1 New unit suite: `classes-lms-create.test.ts` (17 tests)

- creates a needsSetup class with the narrow write shape
- is idempotent on an existing needsSetup class with matching owner and title
- rejects an existing active class at the same classId
- rejects a cross-teacher needsSetup duplicate
- rejects a cross-school needsSetup duplicate
- rejects a needsSetup document with a different title
- propagates the canonical unauthenticated district error
- propagates the canonical account-inactive district error
- rejects a non-teacher active caller with role-forbidden
- rejects a platformAdministrator caller with role-forbidden
- rejects a non-object payload
- rejects an invalid classId payload
- rejects an empty title
- ignores unexpected keys on the request (closed parsing)
- orders side effects: creation write, then audit event
- propagates a downstream creation-write failure and does not write audit
- does not touch teacher preferences

### 13.2 New unit suite: `classes-activate.test.ts` (22 tests)

- activates a needsSetup class atomically and emits an audit event
- is idempotent on an already-active class with matching grade and block
- rejects an already-active class with a differing grade
- rejects an already-active class with a differing block
- rejects an archived class with classes.notActivatable
- rejects a class not found
- rejects a cross-teacher activation with classes.forbidden
- rejects a cross-school activation with classes.forbidden
- rejects an invalid grade
- rejects an invalid block
- rejects an invalid classId
- rejects a non-object payload
- propagates the canonical unauthenticated district error
- rejects a non-teacher active caller with role-forbidden
- retries join-code generation on collision and succeeds within the cap
- fails with joinCodeGenerationFailed if all candidates collide
- returns idempotent success when a concurrent write already activated
  the class matching the request
- propagates classes.alreadyActiveConflict from inside the transaction
- rejects if the class was archived between pre-check and transaction
- rejects a malformed needsSetup record (missing owner) safely inside
  the transaction
- orders side effects: transaction commit, then audit event
- does not touch the teacher preferences document

### 13.3 New lifecycle integration suite: `classes-lifecycle-integration.test.ts` (2 tests)

- creates needsSetup, rejects instruction ops, activates, and satisfies
  eligibility (exercises the full 1..16-step Phase 2B.3 lifecycle
  invariant per §16 of the phase objective)
- classesLmsCreate is idempotent on replay and does not emit a second
  audit

---

## 14. Verification Results

Command outputs at implementation time:

- `npm --prefix platform/functions run typecheck`: green.
- `npm --prefix platform/functions test`: 76 suites, 1406 tests
  passed, 0 failed. Phase 2B.2 baseline was 73 suites / 1365 tests; net
  +3 suites, +41 tests, all from the three new files listed in §13.
- `npm --prefix app run typecheck`: green.
- `npm --prefix app test`: 46 of 47 suites, 810 of 811 tests. The
  single failure is the pre-existing curriculum manifest drift on
  `main` (documented at Spec §14 R9 / Phase 2B.1 R6 / Phase 2B.2 R5;
  explicitly not a Phase 2B.3 concern).
- Firestore Rules tests: not re-run. Phase 2B.3 makes no Rules change.
- Em-dash sweep across every modified or new file (server + rules-
  irrelevant + report): zero em dashes.

Feature-level confirmations:

- `classesLmsCreate` is the only new needsSetup creation seam (grep on
  `"needsSetup"` string literal in write positions shows only
  `platform/functions/src/classes/classes-lms-create.ts` and the type
  declarations / readers).
- `classesActivate` is the only new activation seam.
- No client invokes either callable (grep on `classesLmsCreate` and
  `classesActivate` in `app/src/**/*.ts` returns nothing).
- No join code is generated on any `needsSetup` write.
- No `grade` or `block` default is inserted inside `classesLmsCreate`.
- Activation is atomic: single `tx.update` with all four fields;
  proven by the `activates a needsSetup class atomically` test and the
  concurrent-race branches.
- Duplicate creation is controlled by classId ownership + title
  matching; concurrent conflicts throw `classes.conflict`.
- Preference failure cannot fail activation (activation handler does
  not call the preference callable at all).
- No `defaultBlock` exists at any layer.
- No deployment occurred.
- No commit occurred.

---

## 15. Files Modified

Modified (server):
- `platform/functions/src/shared/types/audit-event.ts`
- `platform/functions/src/shared/firestore/typed-ref.ts`
- `platform/functions/src/shared/index.ts`
- `platform/functions/src/classes/index.ts`
- `platform/functions/src/index.ts`

Created (server):
- `platform/functions/src/classes/classes-lms-create.ts`
- `platform/functions/src/classes/classes-activate.ts`

Tests created:
- `platform/functions/src/classes/classes-lms-create.test.ts`
- `platform/functions/src/classes/classes-activate.test.ts`
- `platform/functions/src/classes/classes-lifecycle-integration.test.ts`

Documentation created:
- `docs/platform/SPRINT_24B_PHASE_2B3_COMPLETION_REPORT.md` (this file).

Files present in the working tree but out of scope for Phase 2B.3:
carried over from prior sprints and Phase 2B.1 / 2B.2. Not touched by
Phase 2B.3.

---

## 16. Darkness Verification

- Grep across `app/src/**/*.ts` for `classesLmsCreate`: no matches.
- Grep across `app/src/**/*.ts` for `classesActivate`: no matches.
- Both callables are exported from
  `platform/functions/src/classes/index.ts` and re-exported from
  `platform/functions/src/index.ts` so they compile into the Functions
  build and can be exercised by tests. No client wrapper module is
  added; no route wiring is added; no Google Classroom UI or Manual
  Create workflow references either callable name.
- The existing temporary Manual Create fallback to Grade 7 (Phase 2B.1
  Reader Audit §5 C12) is untouched.
- `firestore.rules` is unchanged.

---

## 17. Explicit Non-Scope Confirmation

None of the following were introduced by Phase 2B.3:

- No client wrappers for the two new callables.
- No Google Classroom import UX change.
- No workspace setup form.
- No `importFromClassroom.ts` swap from `classesCreate` to
  `classesLmsCreate`.
- No Manual Create workflow change (no default retirement).
- No `defaultBlock` field, callable, or Settings control.
- No preference read at activation time.
- No preference write inside the activation callable.
- No roster-sync change.
- No assignment eligibility change.
- No Rules edit.
- No ADR §7.4 or Blueprint §9.2.2 / §9.2.3 / §9.2.7 amendment
  (deferred per Reader Audit §12 to Phase 2B.5).
- No Phase 3 work.
- No deployment performed.
- No commit created.

---

## 18. Risks

- **R1. Duplicate LMS-course prevention.** `classesLmsCreate` is
  idempotent on `classId` (not on `(teacherId, providerId,
  externalCourseId)`). Because the classId is client-generated, two
  distinct create calls that target the same upstream course produce
  two distinct `needsSetup` classes; the actual duplicate-course
  guard lives in `lmsClassesImport` via `lms.lmsClassAlreadyLinked`.
  Consistent with Spec §7 which forbids `providerId`/`lmsClassId` on
  the create request; the classifier problem stays out of the create
  seam. Phase 2B.4's client orchestration is expected to pre-check
  duplicates before calling `classesLmsCreate` (the current
  `importFromClassroom.ts` `findDuplicate` already does so).
- **R2. classes.alreadyActiveConflict is a new taxonomy entry.** The
  Spec §8.8 error table does not include this code explicitly, but
  Spec §10 mandates the behavior. Phase 2B.4 UX copy should map this
  code to "This class is already set up. Open it from Classes to
  change the grade or block." A future spec edit may consolidate this
  into an existing code; no callable outside `classesActivate` throws
  it.
- **R3. Join-code retry cap.** Fixed at 5 per Spec §5.3
  recommendation. Given the 32-bit code space over a single school,
  the probability of exhaustion is negligible; the failure surface
  exists for defense in depth. Monitoring is optional.
- **R4. Concurrent transaction re-read cost.** Each activation runs two
  reads of the class document (one outside the transaction, one
  inside). Necessary to keep the join-code uniqueness query outside
  the transaction. Acceptable given the low activation volume.
- **R5. Curriculum-manifest CI drift** (pre-existing). Continues to
  fail `curriculum:verify` on `main`. Not a Phase 2B.3 blocker.
- **R6. Deferred documentation amendments.** ADR §7.4 and Blueprint
  §9.2.2 / §9.2.3 / §9.2.7 still contain the pre-Spec Rules-layer
  enforcement language. Reader Audit §12 authorizes Phase 2B.3 or
  Phase 2B.5 to make the edits; Phase 2B.3 has intentionally deferred
  them so this phase remains scoped to server capability only. Phase
  2B.5 will handle in the certification sweep.

No risk in this phase reaches the severity of "reopen the spec."

---

## 19. Phase 2B.3 Certification Recommendation

Recommendation: **Phase 2B.3 is complete and ready for certification.**

Justification:

- Both callables ship with the exact narrow contracts specified in
  Spec §7 and §8.
- The activation transaction preserves every observability invariant in
  Spec §5.3, §7.5, and §8.5.
- Duplicate handling and idempotency behavior match Spec §5, §7, §10.
- The join-code lifecycle follows Spec §5 Option B (defer generation
  until activation).
- The preference contract from Phase 2B.2 remains untouched; the
  activation callable does not read or write it.
- The `lmsClassesImport` link ownership is preserved intact.
- The full server test suite (1406 tests) and the app typecheck are
  green.
- The single failing app test is the pre-existing, documented, out-of-
  scope curriculum manifest drift.
- Both callables are dark: no production client, no UI, no route, no
  workflow references them.
- No Rules change, no deployment, no commit.
- Em-dash sweep across every touched file is clean.
- Rollback boundary remains full and safe: the callables are dead code
  until Phase 2B.4 wires the client; a rollback of the Functions
  deploy would simply remove the two callable entry points, and no
  `needsSetup` document can exist in any environment until the client
  swap ships.

---

## 20. Authorization Recommendation for Phase 2B.4

Recommendation: **Phase 2B.4 is authorized to begin.**

Phase 2B.4 scope (per Spec §12.5):

- `importFromClassroom.ts` swap from `classesCreate` to
  `classesLmsCreate`.
- Workspace setup form (one-screen, hosted inside the class workspace).
- Manual Create default retirement (remove hard-coded `"7"` / `"A"`
  seeds; wire `defaultGrade` pre-fill).
- Best-effort `teacherPreferencesUpdate` on activation success.
- Classes list "Finish setting up" affordance wiring.

Prerequisites now satisfied:

- Phase 2B.1: every load-bearing reader safely tolerates `needsSetup`
  and `assertClassSupports` is in place.
- Phase 2B.2: teacher preference contract is available for the setup
  form to consume.
- Phase 2B.3: the two dark server capabilities are shipped and covered
  by tests.

Deferred distinctions:

- Completed in Phase 2B.3: `classesLmsCreate`, `classesActivate`,
  `classes.activated` audit action, integration lifecycle test.
- Deferred to Phase 2B.4: every client wiring change; the workspace
  setup form; the Manual Create hard-coded seed retirement; the
  best-effort preference write after activation.
- Deferred to Phase 2B.5: adoption sweep, full re-certification, ADR
  §7.4 and Blueprint amendments per Spec §13.
- Deferred to Phase 3: post-activation initial roster sync sequencing
  per Spec §6.4.

Phase 2B.4 must complete under its own Definition of Done and Stop
Conditions as stated in Spec §12.5. No Phase 3 work may begin until
Phase 2B.4 and Phase 2B.5 certifications land.

---

*End of Phase 2B.3 Completion Report.*
