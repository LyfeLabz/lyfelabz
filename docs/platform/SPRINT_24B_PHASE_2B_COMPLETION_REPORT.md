# Sprint 24B Phase 2B Completion Report

Status: **Implementation-complete. CERTIFICATION GRANTED 2026-08-05.**

> **Certification update (2026-08-05).** The "certification pending"
> language below, and the §5 "NOT PERFORMED" browser-certification
> section, are **superseded** by
> `SPRINT_24B_FINAL_CERTIFICATION_REPORT.md`, which is the canonical
> Sprint 24B certification record. The full teacher workflow through
> roster synchronization is now browser certified and backend verified.
> The implementation content of this report remains accurate and is
> retained for provenance.

Original status (retained for history): Phase 2B
implementation, documentation, and the validation baseline are
complete. Certification had not yet been granted at authoring time
because the required live-browser core-workflow certification could not
be completed in that environment (see §5 and Operational Readiness).
Phase 3 production implementation was on hold pending that
certification; Phase 3 planning could proceed in parallel.

Date: 2026-07-31
Sprint context: Sprint 24B, Phase 2B (units 2B.0 through 2B.5)
Authoritative specification:
`docs/platform/SPRINT_24B_PHASE_2B_IMPLEMENTATION_SPECIFICATION.md`
Prior units:
- `SPRINT_24B_PHASE_2B1_COMPLETION_REPORT.md`
- `SPRINT_24B_PHASE_2B2_COMPLETION_REPORT.md`
- `SPRINT_24B_PHASE_2B3_COMPLETION_REPORT.md`
- `SPRINT_24B_PHASE_2B4_COMPLETION_REPORT.md`

---

## 1. Executive Summary

Phase 2B.5 completed the adoption sweep, documentation amendments,
and validation baseline required by Specification §12.6. All work
authorized under Phase 2B.5 is implemented and the validation chain
is green.

The adoption sweep confirmed that every callable enumerated in
Specification §4.3 (Phase 2B.1 required plus `classesActivate` from
Phase 2B.3) already invokes `assertClassSupports(op, record)`. The
§4.3 "may safely wait" callables (S6, S15, S16, S17, S18) do not gate
on class status and require no helper adoption, in agreement with the
Specification. **No production code drift was found; no functional
code was modified for the adoption sweep.**

Documentation amendments called out in Specification §13 were
verified. Amendments to the ADR (§7.4 join-code correction, §7.4
enforcement-model correction, §9 Rules-partitioning correction) and
the Architectural Blueprint (§9.2.2 Rules-scope correction, §9.2.3
roster-sync decision, §9.2.7 Phase 3 sequencing) were already in
place from prior phase amendments. A single new amendment was applied
to ADR §7.5, appending a pointer to Specification §8 for the
activation-callable contract details. The Phase 2 Completion Report
§17.5 already contains the specification identifier called for by
Specification §13.

The validation baseline was executed:

- `platform/functions` typecheck: green.
- `platform/functions` lint: green (nine Phase 2B code-quality drift
  items surfaced during the baseline sweep and were fixed as part of
  the "validation chain green" requirement of §12.6; see §4).
- `platform/functions` unit test suite: **76 suites, 1406 tests, all
  green**.
- `app` typecheck, lint, and unit tests: green (48 of 49 suites, 831
  of 832 tests). The single failing suite is
  `curriculumManifest.test.ts` and reflects the pre-existing
  curriculum manifest drift documented in Specification §14 R9. Not
  a Phase 2B concern; not blocking.

Live-browser certification was not performed. This session's
environment does not provide the Firebase Emulator Suite bring-up,
seeded district / school / teacher fixtures, or Google Classroom
OAuth credentials required by the core-workflow scenarios. Per the
governing instruction, the certification is not claimed. Deployment
is not authorized until live-browser certification completes in an
environment that supports it.

---

## 2. Adoption Sweep (Specification §4.3)

### 2.1 Required Phase 2B.1 adoption (verified)

| Callable | File | Line | Op | Verdict |
|---|---|---|---|---|
| `classesUpdateMetadata` | `platform/functions/src/classes/classes-update-metadata.ts` | 265 | `editMetadata` | ok |
| `classesArchive` | `platform/functions/src/classes/classes-archive.ts` | 140 | `archive` | ok |
| `assignmentsCreateDraft` | `platform/functions/src/assignments/assignments-create-draft.ts` | 314 | `assignDraft` | ok |
| `enrollmentsJoinByCode` | `platform/functions/src/enrollments/enrollments-join-by-code.ts` | 132 | `studentJoin` | ok |
| `enrollmentsTeacherAdd` | `platform/functions/src/enrollments/enrollments-teacher-add.ts` | 208 | `teacherAddEnrollment` | ok |
| `lmsClassesImport` | `platform/functions/src/lms/classes-import.ts` | 157 | `lmsLink` | ok |
| `synchronizeClassRoster` | `platform/functions/src/lms/roster/sync-engine.ts` | 410 | `rosterSync` | ok |

### 2.2 Phase 2B.3 introduction (verified)

| Callable | File | Line | Op | Verdict |
|---|---|---|---|---|
| `classesActivate` | `platform/functions/src/classes/classes-activate.ts` | 234 | `activate` | ok |

### 2.3 "May safely wait" callables (verified inert)

The following callables read a class only for ownership and do not
gate on `status`, per Specification §4.3. `assertClassSupports` is
intentionally not adopted because there is no operation-vs-status
decision to centralize.

| Ref | Callable | File |
|---|---|---|
| S6 | `enrollmentsSetStatus` | `platform/functions/src/enrollments/enrollments-set-status.ts` |
| S15 | `assessmentAttemptsListForClass` | `platform/functions/src/assessments/assessment-attempts-list-for-class.ts` |
| S16 | `assessmentAttemptGetForTeacher` | `platform/functions/src/assessments/assessment-attempt-get-for-teacher.ts` |
| S17 | `assessmentAssignmentSummary` | `platform/functions/src/assessments/assessment-assignment-summary.ts` |
| S18 | `assignmentsListForStudent` | `platform/functions/src/assignments/assignments-list-for-student.ts` |

Grep for class-status literals (`status === "active"`,
`status !== "active"`) across these files returns no class-record
matches; matches are on `enrollment.status` or `attempt.status`,
which are unrelated lifecycle fields.

### 2.4 Result

No production code change was required for the adoption sweep. The
implementation reflects the specification exactly.

---

## 3. Documentation Amendments (Specification §13)

### 3.1 ADR_TEACHER_DEFAULT_CLASS_METADATA.md

- §7.4 join-code capability bullet: verified corrected in a prior
  phase to state that the join code is deferred to activation per
  Specification §5 (Option B) and that the `needsSetup` arm omits
  `joinCode`, `grade`, and `block`.
- §7.4 enforcement sentence: verified corrected in a prior phase to
  state that enforcement is split between Rules (direct-client reads
  and the preference subdoc) and callable-side guards
  (`assertClassSupports` on Admin SDK writes).
- §7.5 activation-callable pointer: **added** in this phase. The
  section now points readers to Specification §8 for the callable
  name, request / response shapes, error taxonomy, and the
  join-code generation invariant, while remaining the authoritative
  statement of the atomic-transition requirement, idempotency, and
  rejection of `archived`.
- §9 Rules partitioning: verified corrected in a prior phase to
  partition Rules-layer additions (preference subdoc only) from
  callable-layer requirements.

### 3.2 SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md

- §9.2.2 server bullet on Rules: verified corrected. Reads "No other
  Rules change is required or authorized. The class-creation,
  assignment-eligibility, and join-code guards listed in earlier
  drafts are callable-layer requirements..." Consistent with
  Specification §2.
- §9.2.3 roster-sync deferral: verified corrected. Now states
  Option B: "a `needsSetup` class never synchronizes its roster.
  Phase 3 therefore sequences the initial sync after the activation
  callable returns; the decision is not deferred to Phase 3."
- §9.2.7 Phase 3 impact: verified corrected. States "Initial roster
  sync runs only against `active` classes per Phase 2B Implementation
  Specification §6; Phase 3 therefore sequences the initial sync
  after the activation callable returns."

### 3.3 SPRINT_24B_PHASE_2_COMPLETION_REPORT.md

- §17.5: the specification identifier
  `docs/platform/SPRINT_24B_PHASE_2B_IMPLEMENTATION_SPECIFICATION.md`
  is present in the section text (line 794). Specification §13
  authorized only this appended pointer; no other change was made.

### 3.4 Non-scope observation

ADR §10 tradeoff bullet 4 still reads "A needsSetup class holds a
server-issued join code that is hidden until activation." This
contradicts the corrected §7.4 policy, which defers join-code
generation to activation. Specification §13 did not authorize a §10
edit; the bullet is flagged here as an internal-consistency
follow-up. Not blocking. Phase 3 may fold the correction into a
routine editorial pass.

---

## 4. Validation Baseline (Specification §12.6)

### 4.1 Functions chain

| Step | Command | Result |
|---|---|---|
| Typecheck | `npm --prefix platform/functions run typecheck` | green |
| Lint | `npm --prefix platform/functions run lint` | green (after Phase 2B lint drift fixes; see below) |
| Test | `npm --prefix platform/functions test` | 76 suites, 1406 tests, all pass |

Phase 2B lint drift corrected during this phase (five files, all
Phase 2B-introduced code; no behavior change):

| File | Line(s) | Rule | Fix |
|---|---|---|---|
| `platform/functions/src/classes/classes-activate.ts` | 295 | `no-unnecessary-type-assertion` | Removed redundant `as Extract<ClassRecord, {status:"active"}>`; the discriminated union narrows naturally at the branch. |
| `platform/functions/src/classes/classes-activate.ts` | 17 | `no-unused-vars` | Removed newly-unused `ClassRecord` type import. |
| `platform/functions/src/classes/classes-activate.test.ts` | 156 | `require-await` | Rewrote `async () => snapshot()` as `() => Promise.resolve(snapshot())`. |
| `platform/functions/src/classes/classes-lifecycle-integration.test.ts` | 23, 29, 41, 49, 58, 157 | `require-await` | Same rewrite pattern; no test behavior change. |
| `platform/functions/src/shared/firestore/typed-ref.ts` | 133 | `no-unnecessary-type-assertion` | Removed redundant `as DocumentReference<TeacherPreferencesDoc>`; the typed collection reference already returns the correct type. |

These are code-quality drift items introduced when Phase 2B.3 and
Phase 2B.4 tests and callables landed. They surfaced as the "full
verification chain green" gate of Specification §12.6 was executed.
No functional behavior changed; the test suite remained fully green
before and after.

### 4.2 App chain

| Step | Command | Result |
|---|---|---|
| `curriculum:verify` | `npm --prefix app run curriculum:verify` | fails (pre-existing) |
| `lessons:verify` | `npm --prefix app run lessons:verify` | green (4 lessons verified) |
| Typecheck | `npm --prefix app run typecheck` | green |
| Lint | `npm --prefix app run lint` | green |
| Test | `npm --prefix app test` | 48 of 49 suites pass; 831 of 832 tests pass |

The one failing test is `src/curriculum/curriculumManifest.test.ts`.
It reports drift between `index.html` and
`app/src/curriculum/curriculum.manifest.json`. This is the
pre-existing risk R9 captured in Specification §14 ("Curriculum
manifest drift... Not a Phase 2B concern"). It has been failing on
`main` since before Phase 2B opened and is unrelated to any Phase 2B
work. Not blocking.

### 4.3 Result

All Phase 2B validation gates are green. The unrelated curriculum
manifest drift is out of Phase 2B scope and does not affect the
Phase 2B certification decision.

---

## 5. Live-Browser Certification

### 5.1 Required scenarios (from the Phase 2B.5 charter)

Core teacher workflow (required to certify Phase 2B):

1. Manual Create flow
2. Google Classroom Import to Setup
3. Finish Setup to Activation
4. Reload during Setup
5. Activation failure path
6. Keyboard and accessibility spot check

Supplemental (not required to certify): remainder of Phase 2B UX
surfaces.

### 5.2 Status: NOT PERFORMED

Live-browser certification was not performed in this session. The
required scenarios cannot be exercised without:

- A running Firebase Emulator Suite (Auth, Firestore, Functions)
  configured with the Phase 2B build.
- Seeded fixtures: at least one district, one school, one active
  teacher with authenticated session, and Firestore Rules /
  callables reachable from the browser client.
- Google Classroom OAuth credentials (client ID, secret, authorized
  redirect URIs) configured for a Google Cloud test project
  reachable from `localhost`.
- At least one Google Classroom test course owned by the test
  teacher, capable of being imported.
- Static hosting of the built `app` bundle at the emulator's Hosting
  origin.

None of the above are available in this session. Per the governing
instruction ("If any required browser scenario cannot be completed
because of an environment limitation, stop immediately, explain
exactly why, and do not claim browser certification"), certification
is withheld and is a hard prerequisite for Phase 2B deployment and
for Phase 3 authorization.

### 5.3 What the current baseline does certify

The Phase 2B unit-test suite is a strong indirect signal for the
core workflow:

- `classesLmsCreate` unit tests confirm `needsSetup` write shape and
  idempotent replay.
- `classesActivate` unit tests confirm atomic
  `{ status, grade, block, joinCode }` write, idempotency on active,
  rejection on archived, invalid-grade / invalid-block rejection,
  join-code collision retry, and concurrent-activation contention.
- `classes-lifecycle-integration.test.ts` composes the two handlers
  against a shared in-memory Firestore fake, exercising the
  needsSetup-then-activate sequence end-to-end from the callable
  boundary.
- Reader-safety tests confirm `listClasses`, `classesArchive`,
  `lmsClassesImport`, Snapshot label, and the Classes surface all
  tolerate `needsSetup` documents (Phase 2B.1 regression suite).
- Preference contract tests confirm `teacherPreferencesUpdate`
  validates the closed set and enforces owner-only writes
  (Phase 2B.2).

The unit-test evidence establishes that the callables and readers
behave correctly at the contract boundary. Live-browser
certification remains necessary to confirm the assembled UX
experience: workspace setup-form render, "Finish setting up"
affordance, reload-mid-setup recovery, error copy on activation
failure, keyboard focus order, and screen-reader labels.

---

## 6. Phase 2 Re-Certification

Phase 2's carried-forward surface (Google Classroom import flow,
OAuth, duplicate detection, reentrancy, provider selection) remains
architecturally certified. Phase 2B did not modify:

- The certified `lmsClassesImport` callable's contract with the
  provider registry.
- The Google OAuth path (`lmsGoogleClassroomAuthorize`,
  `lmsGoogleClassroomExchange`, `lmsGoogleClassroomListCourses`).
- Provider adapters or the provider registry.
- The identity bridge (`identity.*`), the district-security
  boundary, or the roster reconciliation engine.

Phase 2's de-certification (recorded in
`SPRINT_24B_PHASE_2_COMPLETION_REPORT.md` §17) is now lifted for
the metadata-truthfulness defect. The Phase 2 orchestration now
composes with `classesLmsCreate` (Phase 2B.3) instead of
`classesCreate`, producing `needsSetup` classes that the teacher
completes via `classesActivate`. The hard-coded `"7"` / `"A"`
defaults are retired at the write boundary (Phase 2B.4).

Re-certification is conditional on live-browser certification of the
end-to-end workflow. Until §5 completes, the re-certification is
partial: contract and reader safety are certified; assembled UX
behavior is not.

---

## 7. Certification Boundaries (Specification §9.2.8)

Phase 2B certification claims:

- Imported classes are created as `needsSetup` and never carry
  untruthful `grade` or `block` at rest. **Certified at the
  callable-contract level. Live-browser confirmation pending.**
- `defaultGrade` is a teacher-scoped, provider-neutral preference
  stored under the identity boundary. **Certified.**
- The activation callable is the only path from `needsSetup` to
  `active`, is atomic, is idempotent on `active`, and rejects
  against `archived`. **Certified at the callable-contract level.**
- Assignment surfaces, join-code enrollment, Snapshot metrics, and
  student-facing entry points exclude `needsSetup` classes.
  **Certified at the reader and callable level. Live-browser
  confirmation pending.**
- Manual Create writes the teacher-selected metadata; no hard-coded
  `"7"` or `"A"` remains at any write site. **Certified by grep and
  by unit tests. Live-browser confirmation pending.**

Phase 2B certification does not claim:

- Any Phase 3 through Phase 7 behavior.
- Any change to provider adapters, the roster reconciliation engine,
  the identity bridge, or the token store.
- Any change to `lmsClassesImport` or `lmsClassesSyncRoster` beyond
  the eligibility-helper adoption (behavior-preserving) and the
  reader extension to accept `needsSetup` as a valid pre-image for
  linking.

---

## Operational Readiness

### Implementation status

**Complete.** All six Phase 2B units (2B.0 through 2B.5) shipped
their authorized deliverables. The Phase 2B.5 adoption sweep
confirmed zero drift between the specification and the
implementation; no production code changes were required for the
sweep itself. Five low-severity lint drift items in Phase 2B-
introduced code were corrected during the validation baseline so the
"verify chain green" gate would hold.

"Implementation-complete" refers to code, tests, and documentation
being in place and internally consistent with the specification. It
is not a certification claim; see the Browser certification status
below.

### Documentation status

Complete. All amendments enumerated in Specification §13 are on
file. The one net new amendment in Phase 2B.5 is the ADR §7.5
pointer to Specification §8; the remaining amendments were folded in
during earlier phases as the specification was refined. One
observation (ADR §10 tradeoff bullet 4) is flagged as an
internal-consistency follow-up but is outside Specification §13's
authorized scope and is not blocking.

### Validation status

Green. Functions chain: typecheck, lint, and 76 test suites / 1406
tests all pass. App chain: typecheck, lint, `lessons:verify`, and
831 of 832 unit tests pass. The single failing app test
(`curriculumManifest.test.ts`) is the pre-existing risk R9 in
Specification §14 and is out of Phase 2B scope.

### Browser certification status

**Not performed. Certification not granted.** The environment used
for Phase 2B.5 does not provide the Firebase Emulator Suite
bring-up, seed fixtures, or Google Classroom OAuth credentials
required by the core teacher workflow. Per the governing
instruction, no certification is claimed.

Phase 2B being implementation-complete does **not** imply Phase 2B
is certified. Certification requires the six core scenarios in §5.1
to be exercised end-to-end in a live browser against a running
Firebase surface. Until that happens and evidence is recorded,
Phase 2B carries "implementation-complete, certification pending"
status only.

### Deployment status

**Not authorized.** Deployment requires certification, and
certification has not been granted. Deployment is contingent on
live-browser certification of the core teacher workflow in a
suitable environment. No deploy, push, or commit occurred in this
phase.

### Remaining prerequisites before production deployment

1. **Live-browser certification of the six core scenarios** in §5.1
   in an environment with a running Emulator Suite (or a staging
   Firebase project), seed teacher fixtures, and Google Classroom
   OAuth credentials wired to a test Google Cloud project. Record
   evidence in a supplementary appendix or a dedicated
   `SPRINT_24B_PHASE_2B_BROWSER_CERTIFICATION.md`.
2. **Pre-deployment smoke pass** per
   `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` for both the Hosting and
   Functions bundles.
3. **Rollback plan verification.** Confirm the prior known-good
   Functions bundle is warm per the runbook so the Phase 2B.4
   rollback boundary (§11.2 of the Specification) is exercisable.
4. **Non-blocking editorial follow-up.** ADR §10 tradeoff bullet 4
   should be reconciled with the corrected §7.4 policy at a routine
   pass.

The pre-existing curriculum manifest drift (Specification §14 R9) is
tracked separately and does not gate Phase 2B deployment. It is
already failing on `main`.

### Certification recommendation

**Implementation-complete; certification pending.** Phase 2B's
implementation, documentation, and validation baseline are complete
and internally consistent with the specification. Certification has
**not** been granted, because the required live-browser core-workflow
certification could not be completed in this environment (see §5).

Certification decision after browser certification lands:

- If the six core scenarios in §5.1 pass with recorded evidence,
  Phase 2B is certified.
- If any core scenario fails, the failure is a Phase 2B defect and
  must be reconciled before certification.

No provisional or conditional certification is claimed here.
"Implementation-complete" is a status, not a certification.

### Authorization recommendation for Phase 3

**Planning: proceed. Production implementation: hold.**

Phase 3 planning work (design refinement, sequencing analysis,
runbook drafts, test-fixture design) may proceed in parallel with
Phase 2B browser certification. Planning does not depend on Phase 2B
being live in production.

Phase 3 production implementation is on hold until:

- Live-browser core-workflow certification of Phase 2B lands with
  recorded evidence.
- Pre-deployment smoke and rollback verification complete per the
  Sprint 23F runbook.
- Phase 2B is deployed to production and observed clean.

Phase 3's dependency on Phase 2B is a hard sequencing dependency
(Specification §6.4, Blueprint §9.2.7): initial roster sync runs
only against `active` classes and must be sequenced after
`classesActivate` returns. Beginning Phase 3 production
implementation before Phase 2B is production-verified would risk
building on an unproven activation seam.

---

*End of Phase 2B Completion Report.*
