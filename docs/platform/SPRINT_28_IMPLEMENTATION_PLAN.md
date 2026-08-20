# Sprint 28 Implementation Plan - Teacher Workflow & UX Polish + Pre-Release Hardening

Status: Phase 1 planning. Companion to `SPRINT_28_ARCHITECTURAL_BLUEPRINT.md`
and `SPRINT_28_DEFINITION.md`. This plan translates the approved blueprint
into ordered, reviewable implementation phases. It authorizes no code, no
test change, no deployment, no OAuth initiation, and no Firebase or Google
state change. Implementation begins only after this plan and the blueprint
are reviewed and explicitly authorized. Chris commits manually through
GitHub Desktop after review.

Style: no em dashes. Use " - " (spaced hyphen) as the sentence-level break.

---

## How to read this plan

Each phase records: objective, files and components likely affected,
implementation tasks, tests, invariants, stop/review gate, and explicit
things NOT to change. "Likely affected" names starting points, not a
promise that no neighboring code moves. Phase 1 (this plan and the
blueprint) is complete on delivery; Phases 2 through 7 are the
implementation body and are not executed by the Phase 1 task. Phase 5 (W4
curriculum migration) was added by the Phase 2C scope amendment (definition
§16, blueprint §18); the former Phases 5 and 6 became Phases 6 and 7.

Phase ordering rationale. W1's O1 must begin with reproduction BEFORE any
code change; that gate is Phase 2 Step 1 and is not hidden inside a generic
implementation task. W3 (backend, self-contained) and W2 (four generated
lessons) are independent of W1 and of each other, so their order is chosen
for reviewability, not dependency: W1 first (it may need no code change at
all), then W2 (the four current v2 lessons), then W3 (the narrowest and
best-precedented).

Workstream renumbering (Phase 2C amendment). The original Sprint 28 W4
("manifest drift evidence handoff", O6) is renamed W5; it requires no
production change and is folded into the Phase 6 documentation
reconciliation. The new W4 is the assignable curriculum v2 migration
(definition §16, blueprint §18), implemented in Phase 5 AFTER W2 so the
hardened results pattern is the migration template. W4 is the largest
surface (up to ~45 generated lessons plus authored answer keys) and is
gated on W2 completion; it is sequenced last among the code workstreams for
that reason.

Global rule for every phase: no staging, no commit, no push, no deploy, no
Firebase mutation, no Google mutation, no OAuth grant change, no live
provider certification. No em dashes in project content.

---

## Phase 2 - W1: O1 reproduction gate and Assignment Detail hardening

### Phase 2A - O1 reproduction (gate; no production code change)

**Objective.** Reproduce the missing Close control cleanly and capture the
evidence that selects the implementation branch, before any fix.

**Components.** `app/src/assignments/detail/detail.ts` (render),
`app/src/assignments/detail/wire.ts` and `registry.ts` (metadata source),
`app/src/assignments/detail/hydrate.ts`
(`parseAssignmentsTeacherListItem`), `app/src/index.ts` (seam wiring),
`platform/functions/src/assignments/assignments-teacher-list.ts` (the
projection). The Firebase Emulator Suite plus browser (Sprint 27 Phase 7
environment), seeded canonical state, no live Google mutation.

**Tasks.**
1. Run the reproduction matrix (blueprint §5.1): manual vs LMS-linked
   provenance, `published` vs `closed` status, in-session vs post-reload
   hydration, crossing registry state and control rendering.
2. Capture the blueprint §5.2 evidence at each cell:
   `registry.lookup(assignmentId)` (null or full metadata + status), the raw
   `assignmentsTeacherList` item for that assignment (does it appear; does it
   carry `classId`, `className`, valid `status`), the detail load state
   (ready/empty/error), which control rendered, whether the session was
   `activeTeacher` with `closeCallable` wired, and the navigation path.
3. Prefer deterministic reproduction first (blueprint §5.3): assert
   `parseAssignmentsTeacherListItem` behavior on an LMS-published item shape;
   render `renderAssignmentDetail` with a registry stub at each status; then
   confirm the real projection in the browser.

**Tests.** No production test change in 2A. The deterministic reproduction
is expressed as scratch/spike assertions that become permanent regression
tests only in 2B once the branch is chosen.

**Invariants.** Read-only investigation. No Firestore mutation beyond the
seeded emulator state the harness already creates; no code change.

**Stop/review gate.** Stop and record the evidence and the selected branch
(A, B, or C per blueprint §4.3) before writing any fix. Do not proceed to
2B until the branch is chosen from evidence.

**Do NOT change.** Nothing in 2A. No speculative Close button. No
Assignment Detail redesign.

### Phase 2B - O1 fix (conditional on 2A) and O5 late-recipient polish

**Objective.** Apply the smallest justified O1 change for the branch
selected in 2A, and land the O5 bounded late-recipient polish.

**Components.** `app/src/assignments/detail/detail.ts` (Close/Reopen render
seam for O1 Branch A/B; `renderLateRecipientPanel` and its
`onRecipientAdded` path for O5), and, only if 2A proves a projection gap,
`platform/functions/src/assignments/assignments-teacher-list.ts` and/or
`app/src/assignments/detail/hydrate.ts` (parser). Tests:
`detail.test.ts`, `late-recipient.test.ts`, `hydrate.test.ts`,
`assignments-teacher-list.test.ts`.

**Tasks (O1, branch-selected).**
- Branch A: repair the render or state seam that produced a non-`published`
  or missing registry entry for a valid LMS-published assignment (for
  example, correct the projection or the parser so the assignment is
  registered with `status: "published"`, preserving malformed-item
  rejection). Preserve lifecycle semantics (published->Close,
  closed->Reopen, one action at a time).
- Branch B: apply the smallest discoverability polish (clearer placement or
  labeling of the lifecycle control) and pin the rendered control with a
  test; no functional change.
- Branch C: document the domain reason; change nothing unless the state is
  invalid or misleading.

**Tasks (O5).**
- Add an accessible add-success confirmation ("Added to the assignment")
  announced via `aria-live`, scoped to the post-add rerender.
- Add a calm informational state in place of the section's silent absence
  for a lifecycle status where a late add is impossible (`closed`, `draft`),
  explaining why adding is unavailable. No candidate read for a
  non-published assignment.
- Announce the in-flight "Adding..." transition via `aria-live`.

**Tests.**
- O1: a deterministic regression test for the reproduced state (Branch A/B)
  asserting the Close control renders for a published LMS assignment and the
  Reopen control for a closed one, matching the manual-class behavior.
- O5: success confirmation present and announced after an add; informational
  state present for `closed`/`draft` instead of silent absence; in-flight
  announcement present; no automatic or bulk addition exists; frozen
  semantics preserved. Strengthen existing `late-recipient.test.ts` cases
  rather than duplicating coverage.

**Invariants.** Frozen-recipient semantics locked; no automatic/bulk add;
Assignment Detail not redesigned; lifecycle semantics unchanged; if a rules
change is ever implicated (not expected), re-run the rules suite.

**Stop/review gate.** Stop if O1 cannot be fixed within the render or state
seam without a redesign, or if O5 tempts an automatic or bulk gesture.
Review the O1 branch decision and the O5 diff before proceeding.

**Do NOT change.** Recipient population semantics; the one-at-a-time add;
the certified `assignmentsRecipientAdd`; the broader Assignment Detail
layout; any lifecycle callable.

### Phase 2B execution record (completed)

Status: Phase 2B complete. This record is the execution disposition; it does
not authorize any later phase. Chris commits manually after review.

**O1 - lifecycle contract pinned, no production render change.** Phase 2A
resolved O1 as Branch B: the Close / Reopen controls are provenance-agnostic
and a valid LMS-linked assignment renders `Close assignment` (published) and
`Reopen assignment` (closed) through both in-session registration and
reload/hydration; no LMS-specific Close-control defect was reproduced. Per the
Branch B disposition, the Close/Reopen production rendering logic in
`detail.ts` was NOT modified. Phase 2B added the smallest permanent regression
coverage to pin the contract, preferring the reload/hydration path (the Phase 1
primary suspect): a new `detail.o1-lifecycle.test.ts` drives the real
production path end to end - `parseAssignmentsTeacherListItem` ->
`hydrateAssignmentDetailRegistry` -> `createAssignmentDetailRegistry` ->
`createAssignmentDetailMetadataReader` -> `renderAssignmentDetail` - on the
actual canonical `assignmentsTeacherList` projection shape (which carries no
provenance field; the test asserts that), and pins header + `Close` present /
`Reopen` absent for a hydrated LMS-published assignment and the inverse for a
hydrated LMS-closed one. `loadClassNames` and `assignmentsTeacherList` were not
touched; no class-name fallback was introduced (Phase 2A registry-miss
hypothesis remains an unimplemented observation).

**O5 - bounded late-recipient polish (all in `detail.ts`).**
- O5.1 add-success confirmation: a calm, announced "Added to assignment."
  confirmation now renders on the single post-add rerender, keyed on a latched
  `justAdded` signal consumed once so it never persists into a later,
  unrelated rerender. It is panel-level (unambiguous because the added student
  leaves the list) and exposes no implementation vocabulary.
- O5.2 lifecycle-informational state: derived from the canonical backend
  contract (PDR-029j) confirmed by inspection of `assignments-recipient-add.ts`
  (adds refused unless `published`) and `assignments-recipient-candidates.ts`
  (non-published returns an empty candidate list). A `closed` assignment now
  shows "This assignment is closed. Reopen it to add students."; a `draft`
  shows the distinct "This assignment is a draft. Publish it before you can add
  students." (the states are not collapsed), each gated on the seams being
  wired so the pre-Sprint-27 surface is unchanged when they are not, and each
  issuing no candidate read.
- O5.3 in-flight accessibility: a single `role="status"` / `aria-live="polite"`
  live region announces "Adding..." while an add is in flight (the button-text
  change alone is not announced); the same region carries the success
  confirmation, so a screen reader never hears duplicate overlapping
  announcements.
- O5.4 failure behavior: unchanged calm failure preserved - the student stays
  eligible, the control re-enables for retry, the `role="alert"` error line
  announces the failure, the live region is cleared so no false success shows.
- O5.5 empty state: "Every enrolled student is already assigned." preserved
  verbatim; not rewritten.
- Focus: no post-add focus move was added; frozen-recipient semantics and the
  one-at-a-time add are unchanged.

**Validation.** App typecheck clean; app lint clean; full app suite 66 suites /
1101 tests / 1100 passed, with the single expected red being the known
`curriculumManifest.test.ts` SHA drift (Sprint 29-owned, not repaired here).
No Functions or Rules code changed, so those suites were not re-run. No
staging, commit, push, deploy, or Firebase / Google / OAuth mutation.

---

## Phase 3 - W2: v2 assessment results scroll, focus, and return navigation

**Objective.** On submission in each of the four v2 lessons, land the
viewport and focus at the top of the results below the sticky chrome and
announce the score (O2), and add the assignment-context-only
`Back to My Assignments` control to `/app/` after completion (O3), all via
the canonical source and rebuild so v1 is byte-for-byte unchanged.

**Components.**
- Canonical sources (edited): `lesson-sources/lesson_earths-layers.html`,
  `lesson-sources/lesson_plate-tectonics.html`,
  `lesson-sources/lesson_water-cycle.html`,
  `lesson-sources/lesson_earthquakes.html`.
- Builder configs (label/context/exclusion declarations):
  `app/scripts/lessonBuilder/lessons/{earths-layers,plate-tectonics,water-cycle,earthquakes}.cjs`.
- Generated artifacts (rebuilt, never hand-edited): the four
  `app/lessons/lesson_<slug>.html` and the four root `lesson_<slug>.html`.
- Not edited but relied upon: `app/src/runtime/entry.ts`
  (`hasAssignmentContext`, unchanged), `launchOverrides.ts`, `launch.ts`.

**Tasks.**
1. **O2 scroll offset (V2-ONLY `<style>`).** Add `scroll-margin-top` to
   `.score-board` equal to the sticky-stack height, with the phone
   breakpoint value, in a V2-ONLY style region in each source. No JS or
   markup change to the scroll line; `scrollIntoView({block:'start'})` then
   lands below the chrome.
2. **O2 focus and announcement (V2-ONLY).** Add `tabindex="-1"`,
   `role="status"`, and `aria-live="polite"` to the results region, and a
   V2-ONLY `focus({preventScroll:true})` call in `elSubmitQuiz` adjacent to
   the existing `scrollIntoView` line (scroll before focus). Keep the v1
   `scrollIntoView` call verbatim.
3. **O3 return control (V2-ONLY).** Add V2-ONLY `Back to My Assignments`
   markup inside `#el-score` (hidden by default), and a V2-ONLY reveal in
   `elSubmitQuiz` gated on `elAssigned`. Destination `/app/`; no assignmentId
   exposed; no deep-link re-entry.
4. **Declare markers** in each `*.cjs` config (`markers.v2Only`,
   `expectedContexts`, required signatures, and any `equivalenceExclusions`
   the instructional-equivalence contract needs for the adjacent
   scroll/focus statements).
5. **Rebuild** with `npm --prefix app run lessons:build`; never hand-edit
   the artifacts.

**Tests.**
- Deterministic (where meaningful in jsdom): the results region carries
  `role="status"`/`aria-live`/`tabindex`; the return control is present and
  points at `/app/` when `hasAssignmentContext()` is true and absent when
  false; the control never appears before submission; v1 output contains
  none of the V2-ONLY additions.
- Build: `npm --prefix app run lessons:verify` green (artifacts equal a
  fresh build); the marker scanner accepts the new regions; the
  instructional-equivalence contract passes (or a declared exclusion covers
  the adjacent scroll/focus statements).
- Reserved for browser certification (Phase 7), not faked in jsdom: true
  viewport landing below sticky chrome at 480/720/960; smooth-scroll and
  reduced-motion behavior; real screen-reader announcement; the return
  navigation landing on `/app/`.

**Invariants.** v1 lessons byte-for-byte unchanged (V2-ONLY); no
whole-curriculum migration; the runtime stays headless (no results UI added
to `entry.ts`); the certified deep-link architecture untouched (return
control does not re-enter the resolver, adds no `returnUrl`); practice and
standalone behavior unchanged.

**Stop/review gate.** Stop if `lessons:verify` reports drift, if the marker
scanner rejects a region, if the equivalence contract flags a difference
that a declared exclusion cannot honestly cover, or if achieving v1
preservation would require duplicating whole functions rather than adjacent
V2-ONLY statements. Review the four rebuilt v2 artifacts and the unchanged
v1 outputs before proceeding.

**Do NOT change.** Any v1 instructional behavior or the Practice/Classroom
toggle; the assessment runtime's headless contract; the deep-link resolver,
arrival, or auth round-trip; the launch URL builder; any lesson other than
the four v2 lessons.

---

## Phase 4 - W3: manual onboarding claims self-heal

**Objective.** Add the certified idempotent claims self-heal to
`studentsCompleteOnboarding`, mirroring the Sprint 27 LMS path, so a
provisioned-then-active manual student whose claims write failed is repaired
on the next call.

**Components.**
`platform/functions/src/students/students-complete-onboarding.ts` (the
idempotent branch), reusing `readCustomClaims`, `resolveSchoolDistrictId`,
and `writeCustomClaims` from `../shared`. Test:
`students-complete-onboarding.test.ts`.

**Tasks.**
1. In the idempotent branch (record `active` + `student` + `schoolId`
   matches `input.schoolId`), read `readCustomClaims(uid)`.
2. Compute `claimsHealthy = role === "student" && schoolId ===
   user.schoolId && districtId non-empty`.
3. Healthy: no write; return `alreadyActive: true` with a benign info log
   (unchanged behavior).
4. Unhealthy: re-derive `districtId` via `resolveSchoolDistrictId(
   user.schoolId)` (fail closed on missing school or district) and
   `writeCustomClaims({ uid, status: "active", role: "student", schoolId:
   user.schoolId, districtId })`; emit a `warn` log; return `alreadyActive:
   true` with NO second `students.activated` audit event.
5. Defense-in-depth: if `user.schoolId` is empty on the active record, fail
   closed rather than write an empty-schoolId claim.

**Tests (deterministic, mirroring the LMS split-brain/stale cases).**
- Active record + healthy claims -> no repair, no write, no second audit
  event.
- Active record + missing claims -> claims re-asserted from server state.
- Active record + stale claims (wrong schoolId or missing districtId) ->
  repaired.
- Canonical data incomplete (missing school / district-unassigned) -> safe
  fail closed, no partial claim.
- Initial activation (`provisioned` path) unchanged.
- Idempotency preserved; authorization unchanged; no cross-school or
  cross-district escalation (the repair re-asserts exactly the record's
  implied claims).

**Invariants.** No weakening of authorization; no new client authority
field; `schoolId` from the record, `districtId` from the school record;
server authority and idempotency preserved; no onboarding redesign.

**Stop/review gate.** Stop if the self-heal would run outside the existing
idempotent branch, if it would accept any client field, or if it would emit
a second activation audit event. Review the diff against the certified LMS
precedent before proceeding.

**Do NOT change.** The `provisioned`->`active` activation path; the request
validator; `enrollmentsJoinByCode`; the LMS onboarding callable;
`BETA_SCHOOL_ID`; the client-supplied-`schoolId` trust question (post-v1).

---

## Phase 5 - W4: assignable curriculum v2 migration (Phase 2C amendment)

**Objective.** Migrate the ~45 Category B surfaceable lessons (definition
§16, blueprint §18) onto the existing v2 assignment-aware student contract
through the deterministic build system, and author (not deploy) the
co-requisite answer-key payloads, preserving instructional equivalence and
v1 public content. This phase runs AFTER W2 (Phase 3) so the hardened
results pattern is the template every migration clones.

**Preconditions.** Phase 3 (W2) is complete and its V2-ONLY scroll / focus /
announcement / return-control snippets are the accepted template. The four
Category A lessons are green under `lessons:verify` and the equivalence
contract.

**Components.**
- New canonical sources (created, one per migrated lesson):
  `lesson-sources/lesson_<slug>.html`, extracted from the current hand
  authored root artifact.
- New builder configs (created): `app/scripts/lessonBuilder/lessons/<slug>.cjs`.
- Generated artifacts (rebuilt, never hand-edited): each root
  `lesson_<slug>.html` (v1) and `app/lessons/lesson_<slug>.html` (v2).
- Launch seam: `app/src/assignments/studentList/launchOverrides.ts` (add
  each slug only after its checks pass).
- Answer-key payloads (authored, not deployed):
  `platform/functions/src/scripts/assessments/<slug>.r1.json`, and the
  three Category A gaps (plate-tectonics, water-cycle, earthquakes).
- Relied upon, not changed: the build engine, the marker scanner, the
  equivalence engine, the assessment runtime (`entry.ts`), the
  `deployAssessmentRevision` pipeline.

**Tasks (per lesson, the repeated transformation - blueprint §18.2).**
1. Create the canonical source from the committed v1 artifact.
2. Add the three SHARED runtime wiring points (`autosave`,
   `<prefix>Assigned = hasAssignmentContext()`, the `finalize` block).
3. Wrap the legacy classroom apparatus in V1-ONLY marker regions.
4. Add the V2-ONLY standalone-completion message and clone the W2 V2-ONLY
   hardening (scroll offset, focus, live region, `Back to My Assignments`).
5. Create the builder config with the lesson's per-prefix required /
   prohibited / shared signatures, expected contexts, equivalence
   exclusions, and pilot minimums.
6. `npm --prefix app run lessons:build`; never hand-edit an artifact.
7. Author `<slug>.r1.json` from the lesson's existing quiz. Do not deploy.
8. Add the slug to `LESSON_LAUNCH_OVERRIDES` only after build,
   legacy-absence, equivalence, and runtime checks pass for that lesson.

Do the migration in small reviewable batches (for example one curriculum
unit-narrative at a time), not all 45 at once, so each batch is reviewable
and `lessons:verify` stays green throughout.

**Tests (deterministic, systematic across generated outputs - blueprint §18.7).**
- `lessons:verify` green for every configured lesson.
- Marker scanner accepts every new region.
- Instructional-equivalence contract passes for every migrated lesson.
- Shared v2-contract test: `hasAssignmentContext` wired, finalize path
  present, legacy chooser signatures absent from v2, results region carries
  `role="status"`/`aria-live`/`tabindex` and the scroll offset, and
  `Back to My Assignments` present pointing at `/app/`.
- Shared v1-non-regression test: `v1RequiredSignatures` present in v1, v2
  additions absent from v1.
- Answer-key-fidelity test: each `<slug>.r1.json` matches the lesson's quiz
  (stems, options, correct option, explanations).

**Invariants.** No instructional redesign, question rewrite, or scientific
content change (the equivalence contract enforces this). No new assessment
architecture, assignment backend concept, grading semantic, teacher
semantic, or frozen-recipient change. No assessment DEPLOYMENT, no Firebase
mutation, no Google call, no manifest change (W4 does not touch
`index.html`; blueprint §18 and definition §16.8). The gated `ragebaiting`
lesson and all non-lesson resources stay out.

**Stop/review gate.** Stop if a lesson's generated v1 cannot reproduce its
instructional v1 output (`lessons:verify` drift), if the equivalence
contract flags content change a declared exclusion cannot honestly cover,
if a lesson turns out to have a non-standard interaction model (reclassify
to Category C and defer with a named reason rather than force it), or if
migration tempts any instructional edit. Review each batch's rebuilt
artifacts, unchanged v1 instructional content, and authored answer keys
before proceeding.

**Do NOT change.** Any lesson's instructional content or quiz; the
assessment runtime's headless contract; the deep-link resolver, arrival, or
auth flow; the launch URL builder shape; the curriculum manifest or
`index.html`; assessment deployment (Sprint 29); the gated lesson; any
non-lesson resource.

---

## Phase 6 - Deterministic regression validation and documentation reconciliation

**Objective.** Confirm the deterministic suites return to their Sprint 27
baselines and reconcile the Sprint 28 documentation, including the W4
manifest-drift handoff.

**Components.** The Functions, App, and Firestore Rules suites for the
touched domains; `docs/platform/SPRINT_28_*` documents; the roadmap pointer.

**Tasks.**
1. Run the relevant deterministic suites (do not run unrelated heavy suites
   without cause): Functions (students, plus any O1-touched assignments
   test, plus the answer-key-fidelity checks for the W4 payloads), App
   (assignment detail, late-recipient, and the full configured-lesson
   build/equivalence via `lessons:verify` across the Category A lessons and
   every W4-migrated lesson, plus the shared v2-contract and v1-non-regression
   tests), and re-run the Firestore Rules suite to confirm 228/228 even
   though no rules change is planned.
2. Confirm the only expected App red remains the O6 manifest SHA drift
   (unchanged; Sprint 29 owns it).
3. W4: record in the Sprint 28 completion documentation that the manifest
   drift root cause is the single cosmetic `#how` line and that Sprint 29
   regenerates the manifest mechanically; change no manifest artifact, SHA,
   source, or test.
4. Reconcile the Sprint 28 definition, blueprint, and plan; note the Phase 0
   v2-build-boundary correction (blueprint §2.3) so it is not re-litigated.

**Tests.** No new tests here beyond the phase suites; this phase confirms
green, not new behavior.

**Invariants.** No manifest regeneration; no curriculum change; suites at
Sprint 27 baseline (plus the single known manifest red).

**Stop/review gate.** Stop on any unexpected red or any rules regression
until resolved. Review the reconciled documents.

**Do NOT change.** The curriculum manifest, its SHA, its source
(`index.html`), or its test; any Sprint 29-owned artifact.

---

## Phase 7 - Browser certification

**Objective.** Certify the behaviors that only a browser can prove, against
emulated and seeded backend state, with no live Google mutation.

**Scenarios (browser-only validation).**
1. Teacher Assignment Detail lifecycle control behavior on a genuinely
   LMS-published assignment reached via Curriculum -> View summary (O1),
   plus the manual-class control as the comparison.
2. Late-recipient add success feedback, the informational state for a
   non-addable lifecycle status, and the in-flight announcement (O5).
3. Student v2 assessment submission lands the full score and confirmation
   visibly at the top of the results below the sticky chrome, at 480/720/960
   (O2).
4. Keyboard and screen-reader focus behavior after results render, including
   reduced motion (O2).
5. `Back to My Assignments` returns the student to `/app/` (My Assignments)
   from a completed assignment-aware v2 lesson, without browser Back (O3).
6. Practice and non-assignment launches do not show the return control (O3
   negative).
7. If the split-brain manual-onboarding state can be deterministically
   simulated without unsafe production mutation, the recovery on the next
   `studentsCompleteOnboarding` call (O4); otherwise O4 rests on its
   deterministic evidence (Phase 4) and this is recorded, not forced.
8. W4 representative sample (not all 49 lessons): the full assignment-aware
   lifecycle - automatic launch, no Practice/Classroom prompt, submission,
   hardened results, and `Back to My Assignments` - on a small set chosen by
   structural variation. Phase 6 update (post 49-lesson expansion): the
   representative set is bounded but must now span the structural variants the
   curriculum actually contains -
   (a) one original Category A v2 lesson (for example `earths-layers`) as the
   unchanged-behavior control;
   (b) `nature-of-waves`, the diagram lesson whose quiz carries SVG `visual`
   questions and which was the Phase 5A.1 migration unblock (its answer key
   intentionally excludes the SVG), so its assignment-aware submission and
   hardened results are confirmed in a browser at least once;
   (c) at least one newly migrated Grade 6 lesson and at least one newly
   migrated Grade 7 lesson;
   (d) one prefix-collision lesson such as `photosynthesis`; and
   (e) one whose legacy code diverged most from the earths-layers shape.
   Because the build machinery and transformation are identical across
   lessons, the deterministic contract tests (Phase 5, re-confirmed green in
   Phase 6) prove the invariants for all 49 migrated lessons; the browser
   samples confirm real behavior on representatives. Where a lesson's answer
   key is authored but not deployed, record that end-to-end submission
   certification is completed in Sprint 29 after deployment.

**Separation of evidence.** Deterministic automated validation (Phases 2B,
3, 4, 5, 6) covers render-by-status, parser behavior, self-heal cases,
marker and equivalence build checks, the W4 v2-contract / v1-non-regression
/ answer-key-fidelity checks across every generated lesson, and control
presence/absence. Browser-only validation (this phase) covers scroll
geometry, focus paint, real SR announcement, the O1 reproduction on a real
LMS-published assignment, the O3 navigation landing, and the W4
representative-sample lifecycle. No live Google `courseWork.create` is run
for any Sprint 28 item; the closed-assignment resolver negative is already
certified.

**Invariants.** No live provider mutation; no OAuth change; emulated and
seeded state only; Sprint 25 B13 not reopened.

**Stop/review gate.** Stop and correct within scope any defect the browser
reveals, or document and defer with a clear disposition. Do not force a live
boundary.

**Do NOT change.** Anything outside the four workstreams; no production
deployment (Sprint 29).

---

## Sprint 29 boundary (confirmed deferred)

Sprint 28 is hardening, not release certification. Deferred to Sprint 29:
the curriculum-manifest SHA regeneration and a complete deterministic
baseline; the Google OAuth verification and Data Access disposition; Secret
Manager rotation; broad documentation reconciliation; production deployment;
production teacher and student smoke and end-to-end tests; and final v1
production certification. Also deferred (post-v1): whole-curriculum v2
migration, and the client-supplied-`schoolId` manual-path trust question.

## Sequencing rationale

Phase 2 front-loads the O1 reproduction gate because the correct O1 outcome
may be "no code change," and manufacturing a fix before reproducing would
violate the definition. W2 (Phase 3) is the larger of the early surfaces
(the four current v2 lessons, build boundary, markers) and is sequenced
after W1 so a reviewer sees the smaller, higher-certainty changes first.
W4 (Phase 5) is the largest surface overall and is deliberately sequenced
after W2. W3 (Phase 4) is the
narrowest and best-precedented (a direct mirror of the certified LMS
self-heal) and is independent, so it can land whenever convenient after
review. Phase 5 (W4 curriculum migration, Phase 2C amendment) runs after
Phase 3 (W2) so the hardened results pattern is the migration template; it
is the largest surface and is gated on W2. Phase 6 validates and
reconciles (and folds in the W5 manifest-drift handoff); Phase 7 certifies
the browser-only behaviors and samples the W4 migration. No phase is
executed by the Phase 1 task.

---

## Phase 3 completion record (W2 - v2 assessment results UX)

Status: COMPLETE. Deterministic implementation and build validation done.
Browser certification remains Phase 7. Nothing deployed, staged, or
committed. HEAD unchanged at `425f667`.

### The hardened v2 contract now implemented (the Phase 5A migration target)

All changes live in the canonical sources under V2-ONLY markers and are
rebuilt through the deterministic lesson build; v1 outputs are byte-for-byte
unchanged (proven below).

- Scroll positioning (O2). A V2-ONLY `<style>` region adds
  `.score-board { scroll-margin-top: 120px; }` with a
  `@media (max-width: 600px)` override to `104px`. The values are tied to
  the actual sticky chrome: the sticky nav (`top:0`, ~64px desktop / ~52px
  phone) plus the sticky `.quiz-progress-sticky` bar (`top:64px` / `top:52px`,
  ~46px) = ~110px desktop / ~98px phone, each offset leaving a small gap. The
  existing `sb.scrollIntoView({ behavior:'smooth', block:'start' })` call is
  unchanged and now honors the offset. No magic numbers.
- Focus (O2). The results region (`#el-score`) receives `tabindex="-1"`
  (V2-ONLY opening-tag variant) so it is programmatically focusable without
  becoming a Tab stop, and a V2-ONLY `sb.focus({ preventScroll: true })` runs
  in `elSubmitQuiz` immediately after the scroll call (scroll owns viewport
  position; focus does not re-scroll). A V2-ONLY `.score-board:focus { outline:
  none; }` suppresses the container ring, mirroring the file's existing
  `main[tabindex="-1"]:focus` precedent.
- Accessible result announcement (O2). The V2-ONLY results-region tag carries
  `role="status"` and `aria-live="polite"`. Only the changed nodes (score
  number, score message, submit status) are written on submit, so the static
  mystery-loop paragraph is not re-announced. One live region; no duplicate
  announcement.
- Assignment-context detection (O3). Reuses the existing trusted runtime seam
  `window.lyfelabz.lessonQuiz.hasAssignmentContext()`, already read into
  `elAssigned` at the top of `elSubmitQuiz`. No new context mechanism.
- Back to My Assignments (O3). A V2-ONLY `<a class="return-assignments"
  id="back-to-assignments" href="/app/">Back to My Assignments</a>` inside
  `#el-score` after Try Again, hidden by default (`display:none`) and revealed
  only inside the `if (elAssigned)` branch via a V2-ONLY
  `elReturnCtl.classList.add('show')`. Destination is the fixed in-product
  path `/app/`; it exposes no assignmentId and does not re-enter the deep-link
  resolver at `/app/a/{assignmentId}`. It is a native focusable anchor sitting
  after Try Again, reachable by keyboard from the post-submit focus.
- Non-assignment behavior. In v2 practice / standalone (`elAssigned` false)
  the control stays hidden; the existing exploration-mode message is
  unchanged. In v1 the control never exists (V2-ONLY).
- Reduced motion. Unchanged and preserved. The lessons already carry a
  `prefers-reduced-motion: reduce` block forcing `scroll-behavior: auto`, so
  the smooth scroll degrades to an instant jump; the focus move is
  motion-neutral. No smooth-scroll override was introduced.
- v1 preservation. V2-ONLY markers plus a dual opening-tag (`o2-results-region-v1`
  V1-ONLY / `o2-results-region-v2` V2-ONLY) keep the v1 results tag identical.

### Four lessons, one standard

earths-layers, plate-tectonics, water-cycle, earthquakes each received the
identical narrow transformation (they are structurally identical: `#el-score`,
`elSubmitQuiz`, `el-` prefix, same sticky heights). No shared UI helper was
introduced (the runtime stays headless); the deterministic build,
`lessons:verify`, and the instructional-equivalence contract machine-enforce
consistency across the four sources.

### Build architecture

- Canonical sources edited: `lesson-sources/lesson_{earths-layers,
  plate-tectonics,water-cycle,earthquakes}.html`.
- Builder configs updated (label + context declarations only): the four
  `app/scripts/lessonBuilder/lessons/*.cjs`. New labels: V1-ONLY
  `o2-results-region-v1`; V2-ONLY `o2-results-style`, `o2-results-region-v2`,
  `o2-results-focus`, `o3-return-style`, `o3-return-markup`, `o3-return-reveal`.
- Generated artifacts rebuilt via `npm --prefix app run lessons:build`; never
  hand-edited. No unrelated lesson changed.

### Validation results

- `lessons:build`: all four rebuilt.
- `lessons:verify`: pass (committed artifacts equal a fresh build).
- Instructional-equivalence contract: pass for all four with NO new
  `equivalenceExclusions` (the additions are equivalence-neutral: no new
  captured `el-*` id, no `scrollIntoView` change, attributes on a div that no
  extractor reads).
- New contract test `w2-results-contract.test.js`: 44 passed (11 assertions x
  4 lessons), data-driven over `W2_V2_SLUGS` so Phase 5A appends each migrated
  slug.
- App typecheck: clean. App lint: clean.
- Full app suite: 67 suites, 1145 tests, 1144 passed, 1 failed. The single
  failure is the known `curriculumManifest.test.ts` SHA drift (O6, Sprint
  29-owned). The manifest was NOT regenerated.

### v1 preservation evidence

The four root v1 artifacts (`lesson_<slug>.html`) are byte-for-byte identical
to their committed versions: their SHA-256 hashes are unchanged after rebuild,
and `git status` reports no modification to any of the four. Only the four
v2 artifacts under `app/lessons/` changed.

*End of Phase 3 completion record.*

---

## Phase 4 completion record (W3 - manual onboarding claims self-heal)

Status: COMPLETE. Deterministic implementation and validation done. Nothing
deployed, staged, or committed. HEAD unchanged at `425f667`.

### The seam repaired

`studentsCompleteOnboarding` activates in three non-atomic steps: update
`users/{uid}` to `active`, then `writeCustomClaims`, then `writeAuditEvent`.
A Firestore transaction cannot enclose the claims write. If a prior attempt
reached `active` but the claims write failed, the record was `active` while
the token carried no `role`, `schoolId`, or `districtId`. The idempotent
replay branch returned `alreadyActive: true` without re-reading or
re-asserting claims, so the student stayed stranded on the pending surface
and could not reach assignments. This is the same seam Sprint 27 Phase 3
self-healed for the LMS path; Phase 4 brings the manual path to that
standard.

### Claims health contract

Required claims (all canonical, server-derived; no client authority field
added): `role: "student"`, `schoolId` = the RECORD's `users/{uid}.schoolId`,
`districtId` = server-derived from that school via `resolveSchoolDistrictId`.

`claimsHealthy = readCustomClaims(uid).role === "student" && .schoolId ===
user.schoolId && isNonEmptyString(.districtId)`.

- Healthy: NO claims write. Return `alreadyActive: true` with a benign info
  log (`students.onboardingIdempotent`), exactly as before.
- Unhealthy (missing or stale role/school/district): re-derive `districtId`
  from the canonical school and re-assert the canonical claims through
  `writeCustomClaims`; `warn` log `students.onboardingClaimsRepaired`; return
  `alreadyActive: true` with NO second `students.activated` audit event.

### Self-heal flow

Active canonical student (branch gate: `status active` + `role student` +
`user.schoolId === input.schoolId`) -> bind `schoolId = user.schoolId`
(defense-in-depth empty-schoolId guard fails closed) -> `readCustomClaims(uid)`
-> compare against the record -> healthy: no write, return -> unhealthy:
`resolveSchoolDistrictId(user.schoolId)` (fail closed) -> `writeCustomClaims`
-> return `alreadyActive: true`. Canonical activation is never re-run and no
enrollment is re-scanned.

### Failure behavior

- Missing canonical school: `students.schoolNotFound`; no claim written; the
  record stays `active`, so the next call re-enters the idempotent branch and
  can self-heal once the school data is corrected (retry preserved).
- District resolution failure: `district-unassigned` /
  `school-district-mismatch`; no partial claim written; retry preserved.
- Claim-write failure: `claims.writeFailed` propagates; the callable does not
  falsely report success; canonical `active` state is not mutated again; the
  retry re-enters the idempotent branch and repairs later.
- Corrupt active record with empty `user.schoolId`: fails closed with
  `students.invalidStatus` before any claim write (unreachable in normal flow
  because the branch gate and validator both require a non-empty schoolId;
  kept as defense-in-depth mirroring the LMS path).

### Security invariants preserved

Authorization unchanged (authenticated caller, `provisioned`-only activation
on the non-idempotent path). The self-heal runs only in the existing
idempotent branch that already proved the record is `active`/`student` for
this caller. No client authority field is accepted; `schoolId` comes from the
record and `districtId` from the school record, so no cross-school or
cross-district escalation is possible and the role cannot be broadened. A
caller can repair only their own onboarding state (uid from auth throughout).
No LMS enrollment is involved. No Firestore rules changed.

### Audit / log behavior

No new audit taxonomy. A repair emits a structured `warn` log
(`students.onboardingClaimsRepaired`) and deliberately does NOT emit a second
`students.activated` audit event (the activation already happened; the repair
restores the authorization it intended). A healthy replay emits the benign
`students.onboardingIdempotent` info log, unchanged.

### Tests added / changed

`platform/functions/src/students/students-complete-onboarding.test.ts`:
wired `readCustomClaims` into the `../shared` mock and reset; rewrote the
prior idempotent test into a healthy-claims no-op (asserts a single claims
read, no district read, no write, no repair warn); added split-brain missing
claims repair, stale-role repair (no escalation), stale-school repair (record
wins, client cannot select a school), stale/missing-district re-derivation,
conservative repair on a claims read failure, fail-closed on missing school,
fail-closed on district-unassigned, claim-write-failure propagation without
false success, and repair idempotency (a second replay writes nothing).

### Validation results

- Functions typecheck: clean.
- Functions lint: clean (`eslint --ext .ts src`).
- Targeted `students-complete-onboarding.test.ts`: 32 passed.
- Full Functions suite: 91 suites, 1708 tests, 0 failures (Sprint 27 baseline
  was 1699; +9 net new self-heal tests).
- App and Rules suites were not re-run: no app or rules code changed
  (Functions-only change).

### Files changed

- `platform/functions/src/students/students-complete-onboarding.ts` - added
  the idempotent-branch claims self-heal (reuses `readCustomClaims`,
  `resolveSchoolDistrictId`, `writeCustomClaims`); updated the handler doc
  comment.
- `platform/functions/src/students/students-complete-onboarding.test.ts` -
  self-heal coverage (above).
- `docs/platform/SPRINT_28_IMPLEMENTATION_PLAN.md` - this record.

No lesson source, generated artifact, builder config, Assignment Detail,
`assignmentsTeacherList`, LMS onboarding, OAuth, Classroom, curriculum
migration, answer-key, or manifest file was touched.

*End of Phase 4 completion record.*

---

## Phase 5A completion record (W4 - assignable curriculum v2 migration)

Status: COMPLETE WITH ONE EXPLICIT EXCEPTION. Deterministic implementation and
build/app validation done. Answer-key authoring (Phase 5B) and browser
certification (Phase 7) remain. Nothing deployed, staged, or committed. HEAD
unchanged at `425f667`. Full evidence: `SPRINT_28_PHASE_5A_V2_MIGRATION.md`.

### Result

44 of the 45 Category B lessons migrated onto the hardened v2 assignment-aware
contract via the deterministic lesson build; 1 deferred (nature-of-waves).
Final assignable v2 total: 48 (4 Category A + 44 migrated). This is a
platform-contract migration, not a curriculum rewrite: instructional content is
preserved and machine-enforced by the instructional-equivalence contract and
the v1-preservation diff check.

### What each migrated lesson received

The exact Phase 3 transformation, parameterised per lesson by prefix, grade
(teacher set + grade number + resourceId), and endpoint token: the three SHARED
runtime wiring points (autosave, `hasAssignmentContext` var, `finalize`
branch); V1-ONLY regions wrapping the legacy classroom apparatus (mode toggle,
student info, classroom CSS split into `legacy-classroom-styles` +
`legacy-student-info-styles`, touch-target, endpoint, mode state, setQuizMode,
mode-init, validate, classroom-validation guard, practice completion,
apps-script submit, plus `legacy-classroom-localstorage` on the three lessons
that persist student info to localStorage); and the V2-ONLY W2 hardening
(scroll offset, focus, live region, `Back to My Assignments` -> `/app/`). Each
new canonical source lives under `lesson-sources/` and each builder config
under `app/scripts/lessonBuilder/lessons/`; artifacts come only from
`lessons:build`.

### Deferred: nature-of-waves

Its quiz diagram questions embed SVG authoring comments (`<!-- ... -->`) inside
a `<script>` template literal, which the marker scanner categorically rejects.
Unblocking it needs a diagram-source content edit outside Phase 5A scope. It
remains fully functional on v1 (root artifact and public URL untouched; not
launch-overridden). Recorded for a follow-up.

### Validation

- `lessons:build` all 48; `lessons:verify` OK for all 48; marker scanner,
  signature checks, and instructional-equivalence contract pass for all 48 with
  no new exclusions.
- W2 results contract test rewritten data-driven over 48 `{slug, prefix}`
  lessons: 528 assertions pass. `launchOverrides.ts`/`.test.ts` updated to the
  48-slug set. `launch.test.ts` and `surfaces.test.ts` repointed off the
  now-migrated example slugs (to nature-of-waves / the v2 paths).
- Inline-script JS syntax check clean for both targets of every lesson. v1
  preservation: each root v1 gains only the GENERATED notice + shared wiring,
  no instructional line removed, no v2 control leaked; the four Category A root
  v1 artifacts are byte-unchanged.
- App typecheck clean; app lint clean; full app suite 67 suites / 1629 tests /
  1628 passed, the single red being the pre-existing `curriculumManifest.test.ts`
  `#how` SHA drift (index.html untouched; Sprint 29-owned). Functions and Rules
  suites not re-run (no Functions/Rules code changed).

### Not done in Phase 5A (by design)

No `<slug>.r1.json` answer key authored, no assessment revision deployed, no
publication guard changed, no manifest regenerated, no Assignment Detail /
onboarding / OAuth / Google / Firebase change. A migrated lesson is v2-ready in
code but is production-publishable only after Phase 5B authors its answer key
and Sprint 29 deploys the assessment.

### Files changed

- 44 new canonical sources (`lesson-sources/lesson_<slug>.html`).
- 44 new builder configs (`app/scripts/lessonBuilder/lessons/<slug>.cjs`).
- 44 regenerated root v1 artifacts + 44 new v2 artifacts (`app/lessons/`).
- `app/src/assignments/studentList/launchOverrides.ts` (+ its test).
- `app/scripts/lessonBuilder/__tests__/w2-results-contract.test.js` (rewritten).
- `app/src/assignments/studentList/launch.test.ts`,
  `app/src/router/surfaces/surfaces.test.ts` (example-slug repoint).
- `docs/platform/SPRINT_28_PHASE_5A_V2_MIGRATION.md` (new) and this record.

*End of Phase 5A completion record.*

---

## Phase 5A.1 completion record (W4 - nature-of-waves migration unblock)

Status: COMPLETE. Deterministic implementation and build/app validation done.
Answer-key authoring (Phase 5B) and browser certification (Phase 7) remain.
Nothing deployed, staged, or committed. HEAD unchanged at `425f667`. Full
evidence: `SPRINT_28_PHASE_5A_V2_MIGRATION.md` §12.

### Result

nature-of-waves - the sole Phase 5A deferral - is migrated onto the same
hardened v2 assignment-aware contract as the other 48 lessons. The assignable
curriculum is now a clean **49 assignable / 49 v2 / 0 migration blockers**, all
49 covered by the systematic W2 contract.

### The blocker and how it was safely resolved

Two quiz diagram questions embedded their SVG in a `<script>` template literal
that carried six authoring-only HTML comments (`<!-- A: crest -->` and five
similar). The marker scanner categorically rejects HTML comments inside a
`<script>`/`<style>`, so the canonical source could not pass `lessons:build`.

A deterministic scan confirmed exactly those six comments and no others inside
any script/style context. All six are safe authoring-only: each labeled SVG
point already has a visible A/B/C/D `<text>` label and the `<svg>` has a full
aria-label; no JS/CSS/DOM logic reads the comment nodes; SVG comment nodes do
not render. The fix removed only those six comments from the canonical source.
The marker scanner was NOT modified; no scanner exception, exclusion, or bypass
was added; nothing was escaped to fool the scanner. The source became
structurally compatible on its own.

### Fidelity

The regenerated root v1 differs from pre-migration HEAD only by the GENERATED
notice, the six removed comment lines, and the three shared runtime wiring
points. The two SVG bodies are otherwise byte-identical: geometry, coordinates,
paths, A/B/C/D labels, aria-labels, question text, options, correct indices,
explanations, and scoring are unchanged. Both generated artifacts contain zero
HTML comments inside any script/style block. The instructional-equivalence
contract (v1 vs v2) passes with no new exclusion types, because the comment
removal is applied to the single canonical source and is symmetric across v1
and v2.

### Migration contract

The exact Phase 3 / Phase 5A transformation for prefix `nw`, Grade 6
(`mr-brown`/`ms-gay`), `resourceId: lesson_nature-of-waves`: three SHARED
wiring points; the standard V1-ONLY legacy classroom regions plus
`o2-results-region-v1`; and the V2-ONLY W2 hardening (`o2-results-style`,
`o2-results-region-v2`, `o2-results-focus`, `o3-return-style`,
`o3-return-markup`, `o3-return-reveal`, `platform-standalone-completion`). No
legacy localStorage block exists in this lesson, so
`legacy-classroom-localstorage` is not used.

### Validation

- `lessons:build` (nature-of-waves) both targets; `lessons:verify` OK for all
  49 configured lessons.
- Marker scanner, signature checks, instructional-equivalence contract pass for
  nature-of-waves with no new exclusion types.
- W2 results contract test now 49 `{slug, prefix}` entries: 539 assertions
  pass (49 x 11). `launchOverrides.ts`/`.test.ts` at the 49-slug set.
  `launch.test.ts` and `deepLink/arrival.test.ts` repoint their v1-fallback
  example off nature-of-waves (now v2) onto the gated `ragebaiting` slug.
- App typecheck clean; app lint clean; full app suite 67 suites / 1640 tests /
  1639 passed, the single red being the pre-existing
  `curriculumManifest.test.ts` `#how` SHA drift (index.html and the manifest
  untouched; Sprint 29-owned). Functions and Rules suites not re-run (no
  Functions/Rules code changed).

### Files changed

- `lesson-sources/lesson_nature-of-waves.html` (new canonical source).
- `app/scripts/lessonBuilder/lessons/nature-of-waves.cjs` (new builder config).
- `app/lessons/lesson_nature-of-waves.html` (new v2) and
  `lesson_nature-of-waves.html` (regenerated root v1), both from
  `lessons:build`.
- `app/scripts/lessonBuilder/__tests__/w2-results-contract.test.js`,
  `app/src/assignments/studentList/launchOverrides.ts` (+ test),
  `app/src/assignments/studentList/launch.test.ts`,
  `app/src/assignments/deepLink/arrival.test.ts`.
- `docs/platform/SPRINT_28_PHASE_5A_V2_MIGRATION.md` (§12) and this record.

No `<slug>.r1.json` answer key authored, no assessment deployed, no publication
guard changed, no manifest regenerated, no Assignment Detail / onboarding /
OAuth / Google / Firebase / Functions / Rules change.

*End of Phase 5A.1 completion record.*

## Phase 5B completion record (assessment answer-key authoring + fidelity)

Status: COMPLETE. Repository-only. No deployment. Full record in
`SPRINT_28_PHASE_5B_ASSESSMENT_FIDELITY.md`.

### Result

All 49 assignable lessons now have a repository-authored, schema-valid,
fidelity-valid `<slug>.r1.json` assessment revision payload. 4 pre-existing
payloads (earths-layers, what-is-life, cell-types, biological-evolution) were
already fidelity-valid and were preserved unmodified; 45 were authored in this
phase (publishedBy `sprint-28-phase-5b`, revision r1).

### Method

Deterministic and STATIC. `app/scripts/lessonBuilder/assessmentFidelity.cjs`
parses each canonical source's `<script>` blocks with acorn and statically
evaluates the `<prefix>QuizQuestions` array literal (no lesson JS executed;
any non-static node STOPS that lesson). The single transform maps `q -> stem`,
positional option letters, canonical 0-based `correct` -> `correctOptionId`
letter, verbatim `options`/`explanation`. `authorAssessments.cjs` writes only
missing payloads, validates schema + fidelity before writing, and never
overwrites an existing payload.

### Fidelity

49 lessons, 495 questions (48 x 10 + body-systems x 15), 0 schema failures, 0
fidelity mismatches. Two independent extractors agree (acorn AST and a
`new Function` cross-check). Special cases: body-systems is a genuine
15-question quiz (followed, not "fixed"); nature-of-waves diagram questions map
correctly with the SVG `visual` intentionally excluded from the answer-key
schema.

### Validation

- New durable fidelity contract
  `app/scripts/lessonBuilder/__tests__/assessment-fidelity.test.js`: 248 tests
  pass.
- Functions assessment tests (assessment-deployment, cert-lessons): 51 pass.
  Functions typecheck clean.
- `lessons:verify` OK for all 49 (no lesson source/artifact changed). App
  typecheck/lint clean.
- Full app suite: 68 suites / 1888 tests / 1887 passed; the single red is the
  pre-existing `curriculumManifest.test.ts` `#how` SHA drift (Sprint 29-owned).

### Files changed

- 45 new `platform/functions/src/scripts/assessments/<slug>.r1.json`.
- `app/scripts/lessonBuilder/assessmentFidelity.cjs`,
  `app/scripts/lessonBuilder/authorAssessments.cjs`,
  `app/scripts/lessonBuilder/__tests__/assessment-fidelity.test.js`.
- `docs/platform/SPRINT_28_PHASE_5B_ASSESSMENT_FIDELITY.md` and this record.

No assessment deployed, no manifest regenerated, no lesson source/artifact
change, no launch-override / W2 / Assignment Detail / onboarding / OAuth /
Google / Functions-production / Rules change, no external mutation. Sprint 29
owns deployment.

*End of Phase 5B completion record.*

---

## Phase 6 completion record (deterministic validation + doc reconciliation)

Status: COMPLETE, READY FOR PHASE 7. Repository-only. No deployment, no
external mutation, no manifest regeneration. Full record in
`SPRINT_28_PHASE_6_DETERMINISTIC_VALIDATION.md`.

### Result

The complete Sprint 28 working tree (257 paths, all uncommitted at HEAD
`425f667`) is internally consistent and deterministically green. Every path
maps to a known workstream (W1 x4, W4 launch/routing x4, W3 x2, W4 canonical
x49, W4 v2 x49, W4 builder-config x49, W4 v1 regenerated x45, Phase 5B
payloads x45, fidelity tooling x4, docs x6); no unexplained file; no scope
drift.

### Deterministic results (exact)

- `lessons:build` (full): exit 0, ZERO working-tree drift (byte-identical
  before/after). `lessons:verify`: 49/49 OK, 0 failures.
- W2 hardened-results contract: 49 lessons, 539 tests, 0 failures.
- Assessment fidelity: 49 lessons, 248 tests, 0 failures. Payloads: 49 files,
  49 unique activityIds, 495 items, 1,980 options, 0 invalid correctOptionId,
  0 malformed JSON. Repository publication readiness: 49/49 (all six
  prerequisites per slug).
- App: typecheck clean, lint clean, 68 suites / 1,888 tests, 1 failure -
  the pre-existing `curriculumManifest.test.ts` `#how` SHA drift only.
- Functions: typecheck clean, lint clean, 91 suites / 1,708 tests / 0
  failures (equals the Phase 4 baseline; JSON payloads add no tests).
- Rules: 18 suites / 228 tests / 0 failures (local emulator; 0 rules
  changed).

### Manifest exception (verified)

The single app red is exactly the pre-existing cosmetic `#how`
`scroll-margin-top` line in `index.html` (last changed at `4fd2bab`; manifest
last built at `c8fe03e`). A field-level diff proves the ONLY differing
manifest field is `canonicalSourceSha256`; all curriculum data is identical.
`index.html` is unchanged in the Sprint 28 tree, so W4 adds ZERO additional
manifest staleness. Regeneration remains Sprint 29-owned. No manifest
artifact, SHA, source, or test was changed.

### Documentation reconciliation

The definition, blueprint, curriculum-migration audit, Phase 5A, and Phase 5B
records were verified consistent with the current tree and required no change.
Changed in Phase 6: this record, the new
`SPRINT_28_PHASE_6_DETERMINISTIC_VALIDATION.md`, a bounded Phase 7 browser-
matrix addition (below), and the `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` Sprint
28 status pointer.

### Files changed in Phase 6

- `docs/platform/SPRINT_28_PHASE_6_DETERMINISTIC_VALIDATION.md` (new).
- `docs/platform/SPRINT_28_IMPLEMENTATION_PLAN.md` (this record + Phase 7
  browser-matrix addition).
- `docs/platform/TEACHER_PLATFORM_DOMAIN_ROADMAP.md` (Sprint 28 status).

No production code, test, lesson source/artifact, launch override, payload,
manifest, Firebase, Google, or OAuth state changed. Nothing staged,
committed, or pushed.

*End of Phase 6 completion record.*

---

## Phase 7 completion record (browser & emulator certification)

Status: COMPLETE AND CERTIFIED WITH DOCUMENTED LIMITATIONS. Full record in
`SPRINT_28_PHASE_7_BROWSER_CERTIFICATION.md`. No production change; nothing
staged, committed, pushed, or deployed. HEAD unchanged at `425f667`; the
working tree is the same 259 paths as the Phase 6 baseline.

### Result

Every Sprint 28-new browser-only behavior is certified against local
emulated and seeded state, with no live Google mutation:

- **O1 (Scenario 1).** On a genuine authenticated `cert-teacher-001`
  session, the Assignment Detail lifecycle was driven live: published ->
  Close -> closed (Reopen shown) -> Reopen -> published (Close restored),
  with no stale UI and no page reload, on a manual class; and the Close
  control was certified present on a genuinely LMS-linked published
  assignment (`enrollmentSource: lms`), proving Branch B has no
  provenance-based suppression. This closes the pre-existing Sprint 27 O1
  limitation in the browser.
- **O5 (Scenarios 2, 4).** Late-recipient add certified end to end: the
  enrolled-non-recipient candidate surfaced, the in-flight "Adding..."
  `aria-live` announcement fired with the button disabled (duplicate
  activation prevented), the "Added to assignment." confirmation announced
  through the `role="status"` region, the Add control was removed, no page
  reload occurred, and the backend recipient was written at source
  `manualAddition`. The closed-lifecycle informational note ("This
  assignment is closed. Reopen it to add students.") was certified.
- **O2 / O3 (Scenarios 5-16).** The hardened results (scroll-margin-top
  offset landing below the sticky chrome, focus move to the `role="status"`
  / `aria-live="polite"` / `tabindex="-1"` results region, and the
  assignment-gated `Back to My Assignments` -> `/app/`) were certified at
  desktop (120/104 branches) and mobile across the structural
  representative matrix: earths-layers (Category A control),
  nature-of-waves (diagram lesson, 2 SVGs intact), digital-signals (new
  G6), reproductive-success (new G7), photosynthesis (prefix `el`
  collision, autosave verified), gravity (divergent legacy-localStorage
  shape, no legacy chooser leakage), and body-systems (15-question quiz,
  denominator 15). The non-assignment negative (return control hidden,
  exploration message) was certified.
- **O4 (Scenario 17).** The manual onboarding claims self-heal was
  certified against the deployed emulator `studentsCompleteOnboarding`
  callable: missing-claims repair, stale-schoolId repair (record wins), and
  healthy no-op, each keeping the record active with no second activation.
- **Signed-out deep-link regression (Scenario 18).** A signed-out visit to
  `/app/a/{assignmentId}` preserves the exact deep-link path on the
  sign-in surface (Sprint 27 D1 architecture intact).

### Defects

None. No Sprint 28 regression was reproduced. A transient zero-width
browser viewport briefly mis-rendered one lesson; an explicit viewport
reset restored a clean pass. No code changed.

### Limitations (tooling boundaries, each deterministically covered)

Headless smooth-scroll no-op (landing geometry certified via instant
scroll); suppressed sign-in popup (session injected via a real emulator
token into the app's own Auth persistence); screen-reader speech
(DOM/accessibility semantics certified, speech inferential); O5 add
failure/retry not force-induced (covered by `late-recipient.test.ts`);
draft informational-state UI path not reachable (its sibling closed note
is certified; draft covered by `late-recipient.test.ts`); genuine student
backend submission is Sprint 27-certified and Sprint 28-unchanged.

### Deterministic baseline

Phase 7 changed no production source; the functions/app rebuilds wrote
only to gitignored `lib/` and `dist/`. The Phase 6 baseline (App
68/1,888/1-known-red, Functions 91/1,708/0, Rules 18/228/0, lessons zero
drift + 49/49 verify, W2 49/539, fidelity 49/248) remains valid without a
re-run. The known manifest SHA red is unchanged and Sprint 29-owned.

### Files changed in Phase 7

- `docs/platform/SPRINT_28_PHASE_7_BROWSER_CERTIFICATION.md` (new).
- `docs/platform/SPRINT_28_IMPLEMENTATION_PLAN.md` (this record).
- `docs/platform/TEACHER_PLATFORM_DOMAIN_ROADMAP.md` (Sprint 28 status).

No production code, test, lesson source/artifact, launch override, payload,
manifest, Firebase, Google, or OAuth state changed.

*End of Phase 7 completion record.*

*End of Sprint 28 implementation plan.*
