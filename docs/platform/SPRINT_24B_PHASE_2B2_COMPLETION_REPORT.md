# Sprint 24B - Phase 2B.2 Completion Report

Phase: 2B.2 of 2B - Teacher Default Grade Preference.

Governing spec: `docs/platform/SPRINT_24B_PHASE_2B_IMPLEMENTATION_SPECIFICATION.md`
Governing ADR: `docs/platform/ADR_TEACHER_DEFAULT_CLASS_METADATA.md`
Governing blueprint: `docs/platform/SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md`
Governing audit: `docs/platform/SPRINT_24B_PHASE_2B_READER_AUDIT.md`
Prior phase report: `docs/platform/SPRINT_24B_PHASE_2B1_COMPLETION_REPORT.md`

Date: 2026-07-31
Preservation Mode: honored.
No em dashes anywhere.

---

## 1. Executive Summary

Phase 2B.2 introduces the narrow teacher `defaultGrade` convenience
preference required to support a truthful default grade at Manual
Create time. The preference is scoped to a single subdoc at
`users/{uid}/preferences/teacher` and carries exactly one field
(`defaultGrade`, optional-absent, closed set `"6" | "7" | "8"`) plus
`updatedAt`.

A new callable, `teacherPreferencesUpdate`, is the sole writer. The
subdoc receives a narrow Firestore Rules block that permits self-only
`get` and denies every direct-client write, matching the callable-only
authoring pattern already used across the platform. A focused
client-side reader is preloaded once per active-teacher session and
threaded through the workspace deps to the Classes and Settings
surfaces. Manual Create prefills the grade select from the preference
when one exists, keeps the pre-Phase 2B.2 seed of `"7"` when it does
not, and best-effort writes the teacher-selected grade after a
successful class creation. Settings exposes a narrow "Default grade
for new classes" control that reads the current preference and writes
changes through the same callable.

No class-lifecycle change lands in Phase 2B.2. No `needsSetup`
document can be produced. No activation callable exists. No
`classesLmsCreate` exists. Manual Create still uses `classesCreate` as
today; the hard-coded `"7"` / `"A"` seed remains in place as the
fallback when no preference is stored (retirement is deferred to
Phase 2B.4 per the Phase 2B.1 Reader Audit §5 C12).

Certification recommendation: Phase 2B.2 is complete. Phase 2B.3 may
begin.

---

## 2. Final Preference Architecture

- Storage: `users/{uid}/preferences/teacher` (subdoc).
- Shape: `{ defaultGrade?: "6" | "7" | "8", updatedAt?: Timestamp }`.
  Absence of the document, absence of the field, or a malformed
  legacy value are all treated identically as "no preference."
- Sole authored writer: callable `teacherPreferencesUpdate`.
- Sole client-facing reader: `createFirestoreReadTeacherDefaultGrade`
  (direct-client `get` under the new Rules block).
- Session hydration: not modified. See §5 for the Option B decision.
- Provider neutrality: preserved. Google Classroom does not own,
  derive, or directly modify the preference. The Phase 2B.4 setup
  form is expected to invoke `teacherPreferencesUpdate` after a
  successful `classesActivate`; that composition remains a Phase 2B.4
  concern.

---

## 3. Storage Contract

Path: `users/{uid}/preferences/teacher`.

Schema (`platform/functions/src/shared/types/teacher-preferences.ts`):

```
export type TeacherDefaultGrade = "6" | "7" | "8";

export type TeacherPreferencesDoc = {
  readonly defaultGrade?: TeacherDefaultGrade;
  readonly updatedAt?: Timestamp;
};

export type TeacherPreferencesSetWrite = {
  readonly defaultGrade: TeacherDefaultGrade;
  readonly updatedAt: FieldValue;
};

export type TeacherPreferencesClearWrite = {
  readonly defaultGrade: FieldValue;  // FieldValue.delete()
  readonly updatedAt: FieldValue;
};
```

- Explicit `null` is never persisted.
- Absent doc + present doc without `defaultGrade` + present doc with a
  malformed value all read as `null` at the reader boundary.
- Typed refs `teacherPreferencesDocRef(uid)` and
  `teacherPreferencesUpdateDocRef(uid)` centralize the path so no
  handler builds it inline.

The subdoc is not part of `UserRecord`; the identity document stays
minimal.

---

## 4. Authorization and Rules

New Firestore Rules block at `platform/firebase/firestore.rules`:

```
match /users/{uid}/preferences/teacher {
  allow get: if isSelf(uid);
  allow create, update, delete: if false;
}
```

- Direct-client `get` is permitted for the owning user only. This is
  what the client reader exercises.
- Direct-client `create`, `update`, and `delete` are denied
  explicitly. The `teacherPreferencesUpdate` callable is the sole
  writer, runs through the Admin SDK, and bypasses Rules. The
  explicit `if false` writes match the callable-only pattern used
  elsewhere (`assessmentAnswerKeys`, `auditEvents`,
  `externalIdentities`) so the intent is documented at the surface.
- No other Rules edit is authorized by Phase 2B.2.

Callable-side authorization (`teacherPreferencesUpdate`):

1. `requireDistrictContext(request)` verifies authenticated + active
   + district-consistent claims.
2. Explicit `context.role === "teacher"` check; every other role
   throws `role-forbidden`.
3. Payload validator rejects anything except
   `{ defaultGrade: "6" | "7" | "8" | null }`.
4. Extra keys on the payload are ignored (never persisted). No
   provider metadata is accepted.
5. Writes are always scoped to `context.uid`, so cross-user writes
   are impossible by construction.

---

## 5. Read Path

Decision: **Option B (focused per-caller reader, not session
hydration).**

Rationale:
- Spec §9.5 recommends Option A "subject to the session hydration API
  shape; final placement confirmed in Phase 2B.2." Actual inspection
  of `app/src/session/*` shows a narrow `UserRecordRead` and a Session
  union built on tightly-typed fields. Adding a preference field to
  every activeTeacher session would broaden the bootstrap surface,
  introduce a mid-bootstrap Firestore read, and pull the preference
  into the sign-in critical path.
- The preference is consumed by exactly two surfaces (Classes and
  Settings). A focused per-session read preloaded once at the entry
  point after `activeTeacher` resolves is strictly less invasive and
  matches Spec §9.6 (cache once per session, optimistic local update
  on write, no full session refresh).
- Rollback boundary stays full: the preference read failure resolves
  to `null` and no code path treats `null` as anything other than
  "no preference," which is the existing steady state today.

Reader implementation (`app/src/teacherPreferences/read.ts`):

- Absent doc: returns `null`.
- Absent `defaultGrade`: returns `null`.
- Malformed / out-of-set persisted value: returns `null`.
- Any thrown error (network, permission, decode): returns `null`.
- Never blocks teacher login, Manual Create, or Settings.

Preload point: `app/src/index.ts` `rerun()`, on the `activeTeacher`
branch, immediately after Firebase Functions initialization. The
resolved value is cached in a module-scoped `defaultGradePref` slot
and read by getter through the route table so per-session state
rebinds across reruns.

---

## 6. Write Path

Callable: `teacherPreferencesUpdate`
File: `platform/functions/src/teachers/teacher-preferences-update.ts`
Registered at `platform/functions/src/index.ts` and the teachers
barrel.

Contract:

```
type TeacherPreferencesUpdateRequest = {
  readonly defaultGrade?: TeacherDefaultGrade | null;
};

type TeacherPreferencesUpdateResponse = {
  readonly ok: true;
  readonly defaultGrade: TeacherDefaultGrade | null;
};
```

- Set: `defaultGrade` in `{ "6", "7", "8" }`. Written with
  `FieldValue.serverTimestamp()` for `updatedAt`.
- Clear: `defaultGrade === null`. Written with `FieldValue.delete()`
  for `defaultGrade` so no `null` value is ever persisted, and a
  fresh `updatedAt`.
- Rejects unauthenticated callers (via `requireDistrictContext`).
- Rejects non-teacher callers with `role-forbidden`.
- Rejects unsupported grades with
  `teacherPreferences.invalidDefaultGrade`.
- Rejects non-object payloads with
  `teacherPreferences.invalidRequest`.
- Writes only to `teacherPreferencesUpdateDocRef(context.uid)`.
- Uses `set(..., { merge: true })` so `updatedAt` semantics are
  preserved without disturbing unrelated fields (there are none in
  Phase 2B.2, but the pattern is forward-compatible).
- Idempotent for repeated identical requests: each call is a merge
  set; the persisted `defaultGrade` value is unchanged and only
  `updatedAt` advances.

The callable does not read the class collection, does not touch
audit, does not issue claims, and is not part of any transactional
composition. Manual Create's best-effort preference update runs
outside the class-creation flow so a preference-storage failure can
never fail class creation.

---

## 7. Manual Create Integration

File: `app/src/shell/surfaces/classes.ts` (Manual Create form).

- New `defaultGrade` and `updateDefaultGrade` fields on
  `ClassesSurfaceDeps`, both optional.
- `emptyForm` now takes the seed grade as a parameter: it uses the
  preference when supplied, and falls back to `"7"` when no
  preference is stored. The hard-coded fallback is retained
  intentionally per Phase 2B.1 Reader Audit §5 C12; retirement is
  scheduled for Phase 2B.4.
- Block remains a per-class teacher choice: the block select still
  defaults to `"A"` and is not influenced by any preference.
  Phase 2B.2 does not introduce a `defaultBlock` at any layer.
- The teacher can always override the prefilled grade before
  submission; server-side `classesCreate` validation is unchanged.
- On successful class creation, the surface calls
  `updateDefaultGrade(submittedGrade)` in a fire-and-forget promise
  with a swallowed `.catch()`. This implements the approved bounded
  "most recently confirmed grade wins" behavior.
- On failed class creation, the preference is not updated.
- On failed preference update, class creation is not rolled back and
  no teacher-facing error is surfaced.
- The preference update is invoked only for submitted grades in the
  closed set. This is a defensive guard: `classesCreate` accepts a
  broader alphanumeric token today, so Phase 2B.2 filters at the
  boundary before feeding the preference callable.

---

## 8. Settings Integration

File: `app/src/shell/surfaces/settings.ts`.

- New "Default grade for new classes" section on the Settings root.
- Copy: "The starting grade for new class setup. You can change the
  grade for each class you create." Wording deliberately avoids
  labels the ADR forbids ("teacher's grade", "account grade",
  "permanent grade", "Google Classroom grade").
- Control: a single `<select>` with options
  `[No default, Grade 6, Grade 7, Grade 8]`. Initialized to the
  current preference (or `No default`).
- On change, the surface invokes `updateDefaultGrade(next)`:
  - `Grade N` sets the preference to `"N"`.
  - `No default` clears it.
- Async status text: `Saving` -> `Saved` or `Cleared` on success;
  `Could not save. Try again.` on failure, restoring the select to
  the last-known value so the display reflects persisted state.
- No default-block control is exposed anywhere in Settings.
- Google Classroom import controls remain on the Classes surface and
  are not moved into Settings.

The pre-existing Settings behavior (headline, purpose, categories
list, Connected Services entry point, growth notice) is unchanged.

---

## 9. Session and Cache Behavior

- `activeTeacher` session shape is unchanged. Existing session
  bootstrap, bootstrap tests, and consistency guard are all
  unaffected.
- The preference reader is preloaded once per successful
  `activeTeacher` `rerun()`. On any non-teacher session (unauth,
  provisioned, student, admin, suspended, archived, error) the
  cached value is reset to `null` and the update seam is set to
  `null` so cross-session state cannot leak.
- Settings' select maintains a local `currentDefaultGrade` copy that
  is updated on successful callable response. The next Settings
  remount inside the same session re-hydrates from
  `deps.defaultGrade`, which comes from the entry-point cache
  written at session start; the local copy is a short-lived
  intra-render optimization only.
- No full session refresh is required for a preference change.
- A preference read failure at session start resolves to `null` and
  neither blocks the session nor surfaces to the teacher.

---

## 10. Failure and Recovery Behavior

- Read failure (network, permission, decode): reader returns `null`.
  Manual Create falls back to the pre-Phase 2B.2 seed of `"7"`.
  Settings displays `No default` as the current value.
- Callable failure on preference set from Manual Create: swallowed.
  Class creation is not undone. The teacher sees the ordinary
  success UX with the join-code panel.
- Callable failure on preference set from Settings: surfaced only in
  the row's status text (`Could not save. Try again.`). The select
  restores the previous value. No blocking modal, no destructive
  UX.
- Callable failure on preference clear: same recovery as set.
- Malformed persisted preference data: read as `null`; the teacher
  can either leave the value unchanged or explicitly set a new
  preference from Settings, which will overwrite whatever legacy
  value existed.

---

## 11. Tests Added or Updated

Server (`platform/functions/src/teachers/teacher-preferences-update.test.ts`, new):
- unauthenticated update rejected (via `requireDistrictContext` mock throw)
- non-teacher update rejected with `role-forbidden`
- Grade 6 / 7 / 8 accepted and written with the correct payload
- unsupported grade string rejected
- unsupported grade type rejected
- non-object payload rejected
- `null` clears using `FieldValue.delete()`
- arbitrary extra keys ignored (only `defaultGrade` + `updatedAt`
  written)
- repeated identical requests remain safe (both writes structurally
  identical)
- caller writes only to their own preference document (the ref
  builder is invoked with the caller's uid)
- `updatedAt` is stamped on every write with
  `FieldValue.serverTimestamp()`

Rules (`platform/firebase/tests/teacher-preferences.rules.test.ts`, new):
- self read allowed
- cross-user read denied
- unauthenticated read denied
- self direct create denied
- self direct update denied
- self direct delete denied
- cross-user direct write denied
- unrelated `users/{uid}/preferences/{other}` path denied

Client:
- `app/src/teacherPreferences/read.test.ts` (new): absent doc,
  absent field, valid value, malformed value, read-throws all
  resolve to `null` without throwing.
- `app/src/shell/surfaces/classes.test.ts` (extended with a new
  describe block): prefill from `defaultGrade`; fallback to `"7"`
  when no preference; Manual Create remains usable without a
  preference; teacher may override prefilled grade; successful
  create triggers best-effort update; failed create does not update
  preference; failed preference update does not undo successful
  class creation.
- `app/src/shell/surfaces/settings.test.ts` (new): control renders
  with current preference; renders `No default` when none stored;
  update invoked on change; clear invoked when `No default`
  selected; failure shows recoverable status text and restores prior
  value; no default-block control rendered; select disabled without
  update seam.
- `app/src/shell/shell.test.ts` (existing test tightened): the
  "Settings has no form controls" invariant is updated to permit
  exactly one `<select>` on the Settings root, namely
  `settings-default-grade-select`. Any other form control on
  Settings still fails the test, so a regression is caught.

---

## 12. Verification Results

Command outputs at implementation time:

- `npm --prefix platform/functions run typecheck`: green.
- `npm --prefix platform/functions test`: 73 suites, 1365 tests
  passed, 0 failed (Phase 2B.1 baseline: 72 suites, 1352 tests; net
  +1 suite, +13 tests, all from `teacher-preferences-update.test.ts`).
- `npm --prefix app run typecheck`: green.
- `npm --prefix app test`: 46 of 47 suites passed; 810 of 811 tests
  passed. The single failure is
  `src/curriculum/curriculumManifest.test.ts` (curriculum manifest
  drift on `main`, pre-existing, documented as Spec §14 R9 / Phase
  2B.1 report §12 R6, explicitly not a Phase 2B.2 concern).
- `npm --prefix platform/firebase run test:rules` via
  `firebase emulators:exec --only firestore "jest"`: 18 suites, 228
  tests passed, 0 failed (Phase 2B.1 baseline: 17 suites, 220 tests;
  net +1 suite, +8 tests, all from
  `teacher-preferences.rules.test.ts`).
- Em-dash sweep across every modified or new file (server + client
  + rules + report): zero em dashes.

Feature-level confirmations from tests and code review:

- Manual Create still creates ordinary active classes through the
  existing `classesCreate` callable; the classId / joinCode /
  status contract is unchanged.
- `defaultGrade` is used only as a prefill; the teacher may always
  submit a different grade.
- Block remains teacher-selected. No `defaultBlock` field exists at
  any layer.
- A preference update failure cannot fail class creation (test
  `failed preference update does not undo a successful class
  creation`).
- Settings has no default-block control (test
  `does not render a default-block control`).
- No `needsSetup` writer exists (no code writes `status:
  "needsSetup"` anywhere; confirmed by search).
- No `classesActivate` exists.
- No `classesLmsCreate` exists.
- No deployment was performed.
- No commit was created.

---

## 13. Files Modified

Modified (server):
- `platform/functions/src/shared/index.ts`
- `platform/functions/src/shared/firestore/typed-ref.ts`
- `platform/functions/src/teachers/index.ts`
- `platform/functions/src/index.ts`
- `platform/firebase/firestore.rules`

Modified (client):
- `app/src/shell/surfaces/classes.ts`
- `app/src/shell/surfaces/classes.test.ts`
- `app/src/shell/surfaces/settings.ts`
- `app/src/shell/surfaces/workspace.ts`
- `app/src/shell/shell.ts`
- `app/src/shell/shell.test.ts`
- `app/src/router/surfaces/index.ts`
- `app/src/index.ts`

Created (server):
- `platform/functions/src/shared/types/teacher-preferences.ts`
- `platform/functions/src/teachers/teacher-preferences-update.ts`
- `platform/functions/src/teachers/teacher-preferences-update.test.ts`
- `platform/firebase/tests/teacher-preferences.rules.test.ts`

Created (client):
- `app/src/teacherPreferences/types.ts`
- `app/src/teacherPreferences/read.ts`
- `app/src/teacherPreferences/read.test.ts`
- `app/src/teacherPreferences/update.ts`
- `app/src/teacherPreferences/index.ts`
- `app/src/shell/surfaces/settings.test.ts`

Documentation created:
- `docs/platform/SPRINT_24B_PHASE_2B2_COMPLETION_REPORT.md` (this
  file).

Files present in the working tree but out of scope for Phase 2B.2:
carried over from Phase 1 / Phase 2 / Phase 2B.1 work. Not touched
by Phase 2B.2 and documented in their own governing reports.

---

## 14. Explicit Non-Scope Confirmation

None of the following were introduced by Phase 2B.2:

- No `classesLmsCreate` callable.
- No `classesActivate` callable.
- No imported `needsSetup` class creation.
- No workspace setup form.
- No `needsSetup` document writer of any kind.
- No `defaultBlock` field, callable, or Settings control.
- No join-code deferral.
- No activation transactions.
- No roster-sync changes.
- No Google Classroom import metadata changes.
- No assignment eligibility changes beyond what Phase 2B.1 already
  completed.
- No generic preference framework (only the narrow `defaultGrade`
  field on a single subdoc).
- No Phase 3 work.
- No retirement of the Manual Create hard-coded `"7"` / `"A"` seed
  (still applies when no preference is stored; explicit Phase 2B.4
  concern per Reader Audit §5 C12).
- No ADR §7.4 or Blueprint §9.2 amendment (Spec §13 amendments
  remain deferred to Phase 2B.3).
- No `activeTeacher` session hydration change.
- No `curriculum:verify` regeneration (pre-existing unrelated CI
  drift; not touched).
- No deployment performed.
- No commit created.

---

## 15. Risks

- **R1. Focused-reader instead of session hydration.** Option B was
  selected per §5. If Phase 2B.4 reviewers prefer session hydration
  once the setup form ships, the change is bounded: extend
  `UserRecordRead` and `Session["activeTeacher"]` with an optional
  `preferences.defaultGrade` field, wire the reader into
  `bootstrapSession`, and drop the entry-point preload. The current
  reader stays as the low-cost per-session cache regardless.
- **R2. Best-effort preference update swallows failures.** Approved
  by Spec §8.10 and §10.2 for the Phase 2B.4 activation path. The
  Manual Create equivalent shipped in Phase 2B.2 follows the same
  pattern. A future observability slice may want to increment a
  counter on swallowed failures; not blocking.
- **R3. Legacy malformed preference values.** No preference document
  exists in any environment today, so this risk is theoretical
  until Phase 2B.4 lands. The reader fails closed regardless.
- **R4. Rules block is narrower than the spec's sample.** Spec §9.7
  proposes a rules-side `hasOnly` allowlist with a closed-set check
  on `defaultGrade`. Phase 2B.2 chose the strictly narrower "self
  read + deny every direct-client write" pattern that already
  documents the callable-only writer contract elsewhere in the
  file. The callable itself enforces the closed set, so the
  Rules-side allowlist would be redundant defense-in-depth. Adopting
  the sample allowlist later is a one-block Rules edit if reviewers
  prefer.
- **R5. Curriculum-manifest CI drift** (pre-existing, Spec R9 /
  Phase 2B.1 R6). Continues to fail `curriculum:verify` on `main`.
  Not a Phase 2B.2 blocker.

No risk in this phase reaches the severity of "reopen the spec."

---

## 16. Phase 2B.2 Certification Recommendation

Recommendation: **Phase 2B.2 is complete and ready for certification.**

Justification:

- The preference contract (§2 - §6) is implemented end-to-end: a
  narrow subdoc, a callable writer, a Rules block that permits
  self-only reads and denies every direct-client write, a
  fail-closed reader, and the Manual Create + Settings integrations
  that consume both.
- Every test called for by the spec §Tests block is present and
  green.
- The full server test suite (1365 tests) and the full Rules test
  suite (228 tests) pass with zero failures.
- The full app test suite passes except for the pre-existing,
  documented, out-of-scope curriculum manifest drift.
- Typecheck is clean on both `app/` and `platform/functions/`.
- No writer capable of producing a `needsSetup` document exists.
- No activation callable, LMS creation callable, or setup form
  exists.
- No Rules edit outside the approved `preferences/teacher` block.
- No `defaultBlock` control anywhere.
- No deployment was performed.
- No commit was created.
- Em-dash sweep across every touched file is clean.
- Rollback boundary remains full and safe: the new subdoc is inert
  to the reverted client (nothing reads or writes it once the
  preference feature is removed), and the reader failure resolves
  to `null` which is the pre-Phase 2B.2 steady state.

---

## 17. Authorization Recommendation for Phase 2B.3

Recommendation: **Phase 2B.3 is authorized to begin.**

Phase 2B.3 scope (per Spec §12.4):

- New callable `classesLmsCreate` writing a `NeedsSetupClassRecord`
  through the reserved `ClassLmsCreationWrite` shape.
- New callable `classesActivate` performing the transactional
  `needsSetup -> active` transition with atomic grade + block +
  joinCode write, adopting
  `assertClassSupports("activate", record)`.
- Audit-event kind decision for `classes.activated`.
- ADR §7.4 and Blueprint §9.2.2 / §9.2.3 / §9.2.7 amendments per
  Spec §13.

Prerequisites now satisfied:

- Phase 2B.1: every load-bearing reader safely tolerates
  `needsSetup`; `assertClassSupports` helper is in place.
- Phase 2B.2: the teacher preference contract is available for
  Phase 2B.4's setup form to consume without any new server work.

Deferred distinctions:

- Completed in Phase 2B.2: teacher preference contract
  (storage / callable / Rules / client reader / Manual Create
  prefill / Settings row).
- Deferred to Phase 2B.3: the LMS creation seam
  (`classesLmsCreate`), the activation callable (`classesActivate`),
  and the ADR / Blueprint amendments.
- Deferred to Phase 2B.4: the client swap in
  `importFromClassroom.ts` from `classesCreate` to
  `classesLmsCreate`; the workspace setup form; retirement of the
  Manual Create hard-coded `"7"` / `"A"` seed; wiring
  `teacherPreferencesUpdate` on activation success.
- Deferred to Phase 3: post-activation initial roster sync
  sequencing (Spec §6.4).

Phase 2B.3 must complete under its own Definition of Done and Stop
Conditions as stated in Spec §12.4, and no Phase 2B.4 work may begin
until Phase 2B.3 certification lands.

---

*End of Phase 2B.2 Completion Report.*
