# ADR: Teacher Default Class Metadata for Imported Classes

Status: Ratified in principle (2026-07-30). Refinements below are
authoritative. Implementation is not authorized until Sprint 24B is
resequenced (see §11) and this ADR is referenced from an approved
phase specification.
Date: 2026-07-30 (original), 2026-07-30 (ratification refinements)
Sprint context: Sprint 24B, Phase 2 audit outcome
Scope: Class metadata (`grade`, `block`) origination when a class is
created via Google Classroom Import versus Manual Create.

---

## 1. Executive Summary

Phase 2 exposed that Google Classroom import currently satisfies
`ClassRecord.grade` and `ClassRecord.block` with hard-coded client
constants ("7" / "A"). Those values are not truthful. They are the
initial state of the Manual Create form leaking into an unrelated
workflow.

The ratified remediation is the hybrid model:

1. A teacher-level `defaultGrade` preference (optional, absent by
   default) as a convenience pre-fill only.
2. Per-class `block` selection. No teacher-level `defaultBlock`.
3. Imported classes may initially enter a constrained
   `needsSetup` lifecycle state.
4. `grade` and `block` remain required before a class becomes
   `active` and usable for instruction.
5. Google Classroom import remains uninterrupted; no metadata prompt
   during import.
6. The teacher completes one brief setup step from the imported
   class workspace before the class is instruction-ready.

Rejected: globally optional `grade`/`block` on active classes;
sentinel values (`Unassigned`, `Not Set`); hard-coded Grade 7 /
Block A defaults; parsing Google Classroom text into `grade` or
`block`; a teacher-level `defaultBlock`.

---

## 2. Problem Statement

`ClassRecord` requires:

- `grade: "6" | "7" | "8"` - drives curriculum surface and lesson
  eligibility.
- `block: "A" .. "G"` - drives scheduling, roster grouping, and
  teacher-facing organization.

Manual Create satisfies both by asking the teacher.

Google Classroom Import satisfies neither. The Google Classroom API
returns `name`, `section`, `descriptionHeading`, `room`, and roster.
None of these fields carry the grade or the LyfeLabz block letter in a
structured, reliably parseable form. Weston teachers happen to encode
"Grade 7 - Block A" style hints in section strings, but that is a
local convention, not a provider guarantee.

The current import path silently persists `grade: "7", block: "A"` on
every imported class. This is a truthfulness defect. It also produces
downstream defects: analytics, curriculum eligibility, and teacher
dashboards all treat these classes as Grade 7 Block A regardless of
reality.

---

## 3. Current Architecture (Relevant Slice)

- `activeTeacher` - session identity; no preferences payload.
- `UserRecord` (Firestore `users/{uid}`) - identity, no per-teacher
  configuration surface.
- `ClassRecord` (Firestore `classes/{classId}`) - requires `grade`
  and `block`; no neutral state.
- `ClassStatus` is the single lifecycle field on a class, per the
  platform-wide "status is the only lifecycle field" invariant
  established for users in Sprint 2 and mirrored on classes in
  Sprint 4B. Current values: `"active" | "archived"`.
- `ClassCreationWrite` requires `teacherId`, `schoolId`, `title`,
  `grade`, `block`, `joinCode`, `status: "active"`, `createdAt`.
- `ClassLmsLinkWrite` writes only `enrollmentSource: "lms"` and
  `lmsProviderRef`. Grade, block, title, join code, status, and
  ownership are intentionally out of scope for the LMS-link boundary
  per PDR-019i and PDR-019j.
- Manual Create form - initial values `grade = "7", block = "A"`
  chosen for Weston Grade 7 launch convenience.
- Google Classroom import (`importFromClassroom.ts`) - the client
  invokes `classesCreate` first (which is what actually writes the
  hard-coded "7" / "A"), then `lmsClassesImport`.
- Provider abstraction - `ClassProvider` intentionally does not know
  about `grade`/`block`; those are LyfeLabz-native concerns layered on
  top of provider identity.

---

## 4. Why Phase 2 Exposed the Issue

Phase 1 hid the defect behind the Manual Create path, which happened
to make the constants "correct enough" for the pilot cohort. Phase 2
extended class creation to a second, non-interactive source (Google
Classroom). A non-interactive source has no teacher present to
correct the constants, so their falseness becomes load-bearing rather
than incidental. The defect is architectural, not a bug in the import
implementation.

---

## 5. Options Considered

### Option A - Teacher Preferences (`defaultGrade` + `defaultBlock`)

Store both defaults on the teacher; Manual Create and Import both
consume them.

### Option B - Optional `grade`/`block` on `ClassRecord`

Allow either to be `null` at persistence time on any class.

### Option C - Sentinel Values ("Unassigned", "Not Set")

Keep fields required; add non-instructional values that mean "unknown".

### Option D - Hybrid: Teacher `defaultGrade` + `needsSetup` lifecycle

Store `defaultGrade` only. Imported classes enter a `needsSetup`
lifecycle state where the class exists and the roster is populated,
but the class is not instruction-eligible until the teacher confirms
grade (pre-filled from default when present) and picks `block` in a
single one-screen form.

### Option E - Infer from Google Classroom section string

Parse "Grade 7 - Block A" style strings. Fallback to prompt.

---

## 6. Comparative Analysis

| Criterion                     | A (Teacher Prefs both) | B (Optional fields) | C (Sentinels) | D (Hybrid, recommended) | E (Infer from section) |
|---|---|---|---|---|---|
| Architectural cleanliness     | Half-right: `block` is not a teacher property | Weakens invariants across every consumer | Pollutes value space with non-instructional tokens | Clean: each field lives where its semantics belong | Fragile: convention-dependent |
| Data-model impact             | New `TeacherPreferences` doc; no `ClassRecord` change | `ClassRecord` fields become nullable | `ClassRecord` value space widens | New `TeacherPreferences` subdoc + extend the single `ClassStatus` lifecycle enum with `needsSetup` (see §7.3) | No schema change, but adds parser |
| Firestore impact              | 1 new subdoc per teacher | None, but every query/rule must handle null | None structurally, but rules and queries must exclude sentinels | 1 new subdoc + a narrowed enum extension + rules gate | None |
| Type-system impact            | Add `TeacherPreferences`; `Block` type unchanged but semantically wrong | `grade?: Grade`, `block?: Block` everywhere | `Grade or "unassigned"` unions leak everywhere | Discriminated `ClassRecord` union keyed on `status` | Localized to importer |
| Backward compatibility        | Existing classes unaffected | Every reader needs a null branch | Every reader needs a sentinel branch | Existing classes without an extended status are already `active`; no backfill | Non-breaking |
| UI complexity                 | Add prefs screen; no per-class prompt | Every UI must render "missing" | Every UI must render sentinel labels | Add prefs row (grade only) + one workspace-hosted setup form | No UI change until fallback |
| Provider abstraction          | Preserved | Preserved | Preserved | Preserved - provider still returns identity + roster only | Weakens: importer must know provider-specific conventions |
| Google Classroom workflow     | 0 prompts, but persists lies about `block` | 0 prompts, but classes are unusable until edited | 0 prompts, but classes are labeled "Unassigned" everywhere | 0 prompts during import; one setup step inside the workspace | 0 prompts when convention matches; unclear failure otherwise |
| Manual Create workflow        | Grade + block pre-filled from prefs | Unchanged | Unchanged | Grade pre-filled from prefs when present; block still chosen | Unchanged |
| Future extensibility          | Teacher prefs bag exists for future settings | Encourages more optional fields | Encourages more sentinels | Teacher prefs bag exists; extended status enum reusable | None |
| Risk                          | Silent wrong-block persistence at scale | Broad null-safety refactor; assignment eligibility bugs | Sentinels leak into student-facing surfaces | Small, contained; failure mode is a visible "finish setup" affordance | Silent misclassification when convention differs |
| Migration complexity          | Backfill defaults from most-common values per teacher | Rewrite every consumer | Rewrite every consumer | No backfill; existing classes read as `active` by absence | None, but no remediation for existing bad data |
| Long-term maintenance         | Ongoing confusion about why `defaultBlock` exists | Ongoing null-handling tax | Ongoing sentinel-handling tax | Two small, well-scoped additions | Convention drift over time |

---

## 7. Recommended Architecture (Option D, Ratified with Refinements)

### 7.1 Why not pure Teacher Preferences (Option A)

`block` is not a property of a teacher. It is a property of a class's
place in the school schedule. Weston's Grade 7 team has one teacher
per block only because of a specific staffing pattern; that is not
generalizable. A single elementary teacher may own five blocks. A
high school teacher routinely owns classes across four or five
periods per day. Storing `defaultBlock` on the teacher would either
be almost always wrong or almost always ignored, which is worse than
absent.

`grade`, by contrast, is typically stable per teacher over the
course of a school year, even across districts. `defaultGrade`
therefore earns its place in the identity model. `defaultBlock`
does not.

### 7.2 Teacher preference model (ratified)

**Storage**: Firestore document at
`users/{uid}/preferences/teacher`. A subdoc (rather than fields on
`UserRecord`) keeps the identity document minimal, allows
independent security rules, and provides a natural home for future
preferences without churning the identity schema. The location must
be confirmed against Sprint 2 identity rules, callable ownership,
and the provider-neutral seam during Phase 2 implementation (see
§9).

**Representation**: preference uses an optional absent field.

```
TeacherPreferences {
  defaultGrade?: "6" | "7" | "8"
  updatedAt: Timestamp
}
```

Three semantically distinct states are documented and must be
handled by every reader:

- Preference document absent: teacher has never expressed a
  preference. Readers treat this as "no default; prompt when a
  choice is required." Manual Create renders the grade selector
  with no pre-selected value.
- Preference document present without `defaultGrade`: teacher has
  cleared their default in Settings (or the document exists for an
  unrelated preference). Same reader behavior as "absent" for this
  field.
- Preference document present with a valid `defaultGrade`: readers
  pre-fill grade selectors with that value.

Explicit `null` storage is not required and must not be introduced
unless a pre-existing platform-wide convention already demands it.
No such convention exists today (`ClassRecord`, `UserRecord`, and
LMS records all use optional-absent for unknown-value fields).

**Preference learning behavior**: the preference is a bounded
convenience, not a restriction or identity claim.

- Manual Create initializes grade from `defaultGrade` when present;
  otherwise the field starts unselected.
- A successfully teacher-confirmed manual class creation may update
  `defaultGrade` to the selected value.
- A successfully completed imported-class setup (workspace form)
  may also update `defaultGrade` to the selected value.
- The teacher may edit `defaultGrade` at any time from Settings.
- The rule is "most recently confirmed grade wins." No frequency
  count, no course-name inference, no curriculum-filter inference,
  no LMS-side inference. The rule is the shortest one that stays
  correct under cross-grade teachers and mid-year grade reassignment.
- The preference never restricts what grade an individual class may
  have. The teacher can always choose a different grade for any
  class regardless of the current preference.
- The first Manual Create does not permanently establish the
  default. Any subsequent successful confirmation overrides it.

### 7.3 Class lifecycle (ratified)

The platform-wide invariant "status is the only lifecycle field on a
class" is preserved. `ClassRecord.lifecycleState` is **not**
introduced. Instead, the existing single lifecycle enum is extended:

```
ClassStatus = "active" | "archived" | "needsSetup"
```

`needsSetup` is a new terminal-until-promotion value on the same
`status` field that already governs `active` and `archived`. There
is no second lifecycle field. Callers that already switch on
`status` gain one new arm; callers that only care whether a class
is instruction-eligible check `status === "active"` (the same check
they use today to exclude archived classes).

The TypeScript boundary carries this as a discriminated union on
`status`:

```
type ClassRecord =
  | ActiveClassRecord    // status: "active"; grade + block required
  | ArchivedClassRecord  // status: "archived"; grade + block required
  | NeedsSetupClassRecord // status: "needsSetup"; grade optional, block optional
```

Only `NeedsSetupClassRecord` may omit `grade` or `block`. Every
existing reader that currently narrows on `status === "active"` (or
excludes `"archived"`) already carries the guard needed to keep
instruction eligibility correct.

Wire-shape implications:

- `ClassCreationWrite` remains required-grade / required-block for
  Manual Create.
- A new narrow write shape (e.g. `ClassLmsCreationWrite`) is
  introduced solely for the import path. It writes
  `status: "needsSetup"`, `title`, `teacherId`, `schoolId`,
  `joinCode`, `createdAt`, and omits `grade` / `block`. Ownership
  fields remain immutable per Data Model §1.2.
- A new narrow write shape (e.g. `ClassActivationWrite`) transitions
  a `needsSetup` class to `active` by writing the required
  `grade`, `block`, and `status: "active"` in a single atomic write.
  No other field is writable through this seam.

Existing-document compatibility rule (ratified below in §7.6):
class documents without a `status` field are interpreted as
`"active"` on read. Class documents with `status: "active"` or
`status: "archived"` are unchanged. No backfill batch is required.

### 7.4 `needsSetup` capability matrix (ratified)

A `needsSetup` class is permitted to:

- Persist as a linked LyfeLabz class in `classes/{classId}` with
  neither a join code nor grade / block. Join-code generation is
  deferred to the activation transaction per Phase 2B
  Implementation Specification §5 (Option B). The `needsSetup`
  arm of the `ClassRecord` discriminated union therefore omits
  `joinCode`, `grade`, and `block`. This supersedes the earlier
  intent to create the join code at needsSetup time and hide it.
- Appear in the teacher's Classes list with a "Finish setting up
  this class" affordance.
- Open a class workspace whose primary state is the setup form.
- Display its Google Classroom source relationship.
- Perform or retain roster synchronization if and only if the
  existing phased architecture already supports it for the class at
  hand. In Sprint 24B the initial roster sync is a Phase 3 concern;
  whether the initial sync runs against a `needsSetup` class is a
  Phase 3 sequencing question and is not decided by this ADR.
- Expose the required setup form.
- Be archived through the existing `classes-archive` callable if
  that callable already supports it. The archive callable currently
  accepts only `status: "archived"`; extending its accepted
  pre-images to include `needsSetup` is a narrow additive change
  and is authorized by this ADR as part of the resequenced Phase 2
  work.

A `needsSetup` class is not permitted to:

- Be a target of `assignments-create-draft`, `assignments-recipient-add`,
  or any assignment publish path. Every assignment eligibility guard
  extends the existing `status === "active"` check.
- Appear as an eligible destination in Curriculum assignment
  controls.
- Be enrolled into via the student join-code surface. Under the
  §5 (Option B) join-code decision no join code exists to leak;
  the join-code lookup path continues to require
  `status === "active"` as defense in depth.
- Be presented anywhere as instruction-ready.
- Be included in instructional reporting or Snapshot metrics as an
  active teaching class.
- Be consumed by any workflow that assumes valid `grade` and
  `block` metadata.

Enforcement is split across layers per Phase 2B Implementation
Specification §2 (Corrected Enforcement Model). Every mutation of
classes, assignments, enrollments, and LMS records in this codebase
is performed by a Cloud Functions callable using the Firebase Admin
SDK, and the Admin SDK bypasses Firestore Security Rules. The
"not permitted" items above are therefore enforced at the callable
layer via the shared `assertClassSupports` eligibility helper
introduced in Phase 2B, not at the Rules boundary. Rules continue
to gate direct-client reads (owner-scoped `get` and `list` on
`classes/{classId}`) and the new
`users/{uid}/preferences/teacher` subdoc.

### 7.5 Activation contract (ratified)

Promotion from `needsSetup` to `active` requires all of:

- A valid `grade` value from the closed set `{"6", "7", "8"}`.
- A valid `block` value from the closed set `{"A"..."G"}`.
- A successful authorized metadata write proving the caller is the
  class's `teacherId` (or an authorized co-teacher).
- An atomic lifecycle-state transition. `status`, `grade`, and
  `block` are written in a single transaction. The class must never
  be observable as `active` with missing or invalid `grade` or
  `block`, and must never be observable with `status: "needsSetup"`
  and a persisted `grade`/`block` that were written outside the
  activation transaction.

Idempotency: the activation callable is safe to re-invoke. If the
class is already `active`, the callable returns success without a
write. If the class is `needsSetup` and the incoming payload is
valid, the callable writes and returns success. If the class is
`archived`, the callable rejects.

Retry: on a transient Firestore error, the client may retry the
activation call. Because the callable is idempotent on `active`,
retry after a partial network failure is safe.

Failure modes surfaced to the teacher:

- Invalid grade or block: client-side validation prevents submission.
- Authorization failure: teacher-facing "You do not have permission
  to finish setting up this class" copy; no raw rules error.
- Transient error: teacher-facing "We could not save. Try again."

Callable contract details (callable name, request / response shapes,
error taxonomy, and the join-code generation invariant that runs
inside the activation transaction) are recorded in Phase 2B
Implementation Specification §8. This §7.5 remains the authoritative
statement of the atomic-transition requirement, idempotency, and
rejection of `archived`.

### 7.6 Existing-class compatibility (ratified)

Existing class documents in `lyfelabz-prod` and every non-production
project fall into two shapes:

- `status: "active"` explicitly present: interpreted as `active`;
  no change.
- `status: "archived"` explicitly present: interpreted as
  `archived`; no change.

There is no case today where `status` is absent on a class
document; the field has been required at the write boundary since
Sprint 4B. The absence-defaults-to-`active` rule is therefore
documented as a defensive posture rather than a required migration
path.

No bulk migration is authorized or required. The extended enum is
purely additive: no existing document produces a `needsSetup`
value until the new import path writes it, and no existing reader
misbehaves against the two pre-existing values.

Callers must be audited at implementation time to confirm this. In
particular:

- Every server-side callable that loads a class must be verified to
  either (a) branch on `status === "active"` for instruction
  eligibility, or (b) accept both `active` and `needsSetup` where
  legitimate (roster viewer, workspace shell, class list, archive
  callable).
- Client-side surfaces that render class cards or class lists must
  render a `needsSetup` class with the "Finish setting up" affordance
  and must not surface the join code, assignment destination, or any
  student-facing entry point.

### 7.7 Manual Create consumption

Grade field initial value: `defaultGrade` when present, otherwise
unselected. Block field initial value: unselected (unchanged from
today's manual form, minus the Weston "A" default which is retired
along with the "7" default).

### 7.8 Google Classroom Import consumption

Import writes a `NeedsSetupClassRecord`:

- `status: "needsSetup"`.
- `title`: Google Classroom course name.
- `teacherId`, `schoolId`: from the authenticated session.
- `joinCode`: server-issued (not surfaced).
- `createdAt`: server timestamp.
- `grade`, `block`: absent.
- `enrollmentSource: "lms"`, `lmsProviderRef`: written by
  `lmsClassesImport` immediately after the create, unchanged from
  Sprint 24A.

The client orchestration composes the new
`ClassLmsCreationWrite` seam and `lmsClassesImport` in the same
order it does today. `lmsClassesImport` is unchanged.

The teacher is taken directly to the class workspace on success.
The primary workspace state is the setup form (§8.2).

### 7.9 Provider abstraction

`ClassProvider` remains free of `grade`/`block`. The importer
translates a provider-shaped class into a `NeedsSetupClassRecord`
whenever LyfeLabz-native metadata cannot be inferred. No provider
learns about LyfeLabz block letters.

### 7.10 Migration

- Add `TeacherPreferences` subdoc; absence = "no default set."
- Extend `ClassStatus` with `needsSetup`; no backfill of existing
  documents required. Verify every reader.
- Introduce narrow `ClassLmsCreationWrite` and `ClassActivationWrite`
  seams. Do not weaken `ClassCreationWrite`.

Each step is independently shippable and reversible.

---

## 8. UX Contract (Ratified)

### 8.1 Manual Create

- Opens with `defaultGrade` when present; grade is unselected
  otherwise.
- Block requires an explicit teacher choice for the individual
  class.
- The teacher reviews both values before submission.
- Successful creation may update `defaultGrade` to the selected
  value.

### 8.2 Google Classroom Import

- OAuth and course selection remain uninterrupted (unchanged from
  Sprint 24B Phase 2 as-implemented).
- No grade or block prompt appears during import.
- The class is created and linked as `needsSetup`.
- The teacher is taken to the imported class workspace.
- The primary workspace state is a brief setup form.
- Grade is prefilled from `defaultGrade` when available.
- Block requires a teacher choice.
- If no grade preference exists, grade also requires a teacher
  choice.
- Saving valid metadata activates the class atomically.
- The workspace then transitions into the ordinary active-class
  experience.

### 8.3 Language

The internal term `needsSetup` is not surfaced to teachers.
Teacher-facing copy uses phrasing such as:

- "Finish setting up this class"
- "One quick step to finish setting up this class"
- "Choose a grade and block to start assigning lessons"

The setup form title should describe the action, not the state:
"Finish setting up [Course Title]" is preferred over anything that
names the lifecycle.

---

## 9. Firestore and Rules Impact (Ratified, corrected)

Per Phase 2B Implementation Specification §2, enforcement is split
between Firestore Security Rules (direct-client interactions) and
callable-layer guards (all Admin SDK writes). The bullets below are
partitioned accordingly.

**Rules-layer additions (direct-client governance):**

- `users/{uid}/preferences/teacher` subdoc: self-only `get`;
  self-only `create` and `update` limited to the
  `{ defaultGrade, updatedAt }` shape allowlist with `defaultGrade`
  membership in `{"6", "7", "8"}` as defense in depth. Deletion
  denied. See Specification §9.7 for the concrete rule.
- Class reads: no rules change is required. The existing
  owner-scoped `get` and `list` on `classes/{classId}` continue to
  admit `needsSetup` documents.

**Callable-layer requirements (Admin SDK writes, enforced by the
shared eligibility helper):**

- `status: "needsSetup"` is written only by the new
  `classesLmsCreate` callable (see Specification §7). The ordinary
  `classesCreate` callable continues to write `status: "active"`
  exclusively.
- Every callable-side class-status check that currently gates on
  `status === "active"` is adopted through
  `assertClassSupports(op, record)` so behavior for `needsSetup`
  is explicit per operation (see Specification §4).
- The join-code lookup path (`enrollmentsJoinByCode`) continues to
  require `status === "active"`; under the deferred-join-code
  policy (Specification §5) no join code exists on a `needsSetup`
  class to look up.
- Assignment eligibility (`assignmentsCreateDraft`) continues to
  require `status === "active"` and adopts the shared helper.

The preference writer is a callable (`teacherPreferencesUpdate`)
per Specification §9. The subdoc's Rules block is defense in depth.

Callable ownership map for the preference:

- Reader: consumed at session hydration on the `activeTeacher`
  branch. Recommended surface:
  `activeTeacher.preferences.defaultGrade`.
- Writer: `teacherPreferencesUpdate` callable per Specification
  §9.3-§9.4. The subdoc Rules block admits self-writes as defense
  in depth.
- Validation: `defaultGrade` must be in `{"6", "7", "8"}`,
  `null`, or absent. Any other value is rejected.
- Authorization: writes require the caller to be the owning
  teacher (`request.auth.uid == uid`).
- Audit expectations: preference writes are user-scoped and low
  sensitivity. No new audit event kind is proposed; the existing
  identity audit posture applies.
- Cache and invalidation: the preference is read once at session
  hydration and cached on the `activeTeacher` object. Manual Create
  and the imported-class setup form both re-read from the same
  cached object; a successful write invalidates the cache and
  updates the local object without a full session refresh.
- Absent-preference behavior: the reader must not throw. Absence
  is a legitimate steady state.

Callable ownership map for the preference:

- Reader: consumed at session hydration on the `activeTeacher`
  branch. Recommended surface:
  `activeTeacher.preferences.defaultGrade`.
- Writer: preferred surface is a callable (e.g.
  `teacherPreferencesSetDefaultGrade`) so the write shape is
  validated server-side and audited consistently. If the
  identity-writes convention already permits direct client writes
  to identity subdocs, that convention may be reused; the
  implementation phase must decide based on the existing pattern
  and document its choice.
- Validation: `defaultGrade` must be in `{"6", "7", "8"}` or
  absent. Any other value is rejected.
- Authorization: writes require the caller to be the owning
  teacher (`request.auth.uid == uid`).
- Audit expectations: preference writes are user-scoped and low
  sensitivity. No new audit event kind is proposed; the existing
  identity audit posture applies. Confirm during implementation.
- Cache and invalidation: the preference is read once at session
  hydration and cached on the `activeTeacher` object. Manual Create
  and the imported-class setup form both re-read from the same
  cached object; a successful write invalidates the cache and
  updates the local object without a full session refresh.
- Absent-preference behavior: the reader must not throw. Absence
  is a legitimate steady state.

The capability is provider-neutral. Google Classroom does not own
or define the preference. No provider adapter reads or writes it.

Activation contract details are recorded in Phase 2B Implementation
Specification §8. This ADR §7.5 remains the authoritative statement
of the atomic-transition requirement, idempotency, and rejection of
`archived`; §8 of the Specification supplies the callable name,
request / response shapes, error taxonomy, and the join-code
generation invariant that runs inside the activation transaction.

---

## 10. Tradeoffs

- **One setup step per imported class remains.** This is the
  honest minimum given no provider signal for `block`. The sprint
  principle is "reduce decisions," not "eliminate them at the cost
  of truth." The step happens inside the class workspace after
  import so the import flow itself is uninterrupted.
- **The `status` enum grows from two values to three.** Mitigated
  by preserving the single-lifecycle-field invariant, by the
  additive nature of the change, and by the fact that every
  existing eligibility guard already narrows on
  `status === "active"`.
- **`defaultGrade` will be wrong for cross-grade teachers on some
  imports.** Mitigated because it is only ever a pre-fill and the
  teacher confirms every setup.
- **A `needsSetup` class holds a server-issued join code that is
  hidden until activation.** Mitigated by the rules-side
  enrollment guard and by not surfacing the code anywhere in the
  UI until `status === "active"`.

---

## 11. Impact on Sprint 24B (Ratified)

The Blueprint is amended (see companion doc
`SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md`). Phase 2's audit finding
is upheld: the hard-coded constants are an architectural defect,
not an implementation bug. The as-shipped Phase 2 is de-certified
(see `SPRINT_24B_PHASE_2_COMPLETION_REPORT.md` §17). A revised
Phase 2 (labeled Phase 2B in the Blueprint amendment) implements
this ADR. Phase 3 remains blocked until the revised Phase 2 is
implemented and certified.

Implementation units required before Phase 2 re-certification:

1. Teacher preference data contract (`preferences/teacher` subdoc,
   reader, writer, validation, Rules).
2. `needsSetup` class lifecycle contract (extend `ClassStatus`,
   discriminated union at the type boundary, reader audit,
   compatibility rule).
3. Import creation using `needsSetup` (new
   `ClassLmsCreationWrite`; import path stops writing hard-coded
   grade/block).
4. Imported-class setup workspace (grade + block form, activation
   handler, teacher-facing copy).
5. Activation eligibility enforcement (new
   `ClassActivationWrite`, callable seam, atomic transition,
   idempotency, retry semantics, Rules gate).
6. Removal of hard-coded Grade 7 and Block A across every write
   site (import path first, manual create default second).
7. Regression coverage for existing active classes (loaders,
   assignment eligibility, roster viewer, snapshot metrics).
8. Updated Phase 2 certification (new completion report or a
   Phase 2B report; the current report remains on file with its
   de-certification appendix).

---

## 12. Recommendation

Adopt Option D as ratified above. Introduce
`TeacherPreferences.defaultGrade` (optional-absent) and extend
`ClassStatus` with `"needsSetup"` as the single new lifecycle
value. Reject `defaultBlock` on the teacher, nullable
`grade`/`block` fields, and sentinel values. Handle the
irreducible per-class `block` unknown through the workspace-hosted
setup form gated by the extended `status` enum.

This is the smallest change that keeps `ClassRecord` truthful,
preserves the platform-wide single-lifecycle-field invariant,
preserves the provider abstraction, honors the "reduce decisions"
principle to the extent honesty permits, and creates a reusable
seat for future teacher-scoped preferences without weakening any
existing invariant.

Do not begin implementation from this ADR alone. Implementation
authorization flows from the revised Phase 2 (Phase 2B) block in
`SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md`.

*End of ADR.*
