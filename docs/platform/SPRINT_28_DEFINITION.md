# Sprint 28 Definition - Teacher Workflow & UX Polish + Pre-Release Hardening

Status: Defined. Scope-of-record for Sprint 28. This document is the
Phase 0 output: it reconstructs the current product state from canonical
evidence, records the investigation of the known Sprint 28 issues (O1
through O6), audits the existing teacher and student lifecycle for
additional evidence-backed pre-release hardening candidates, and fixes a
bounded Sprint 28 scope for review. It does not authorize implementation.
No production code, tests, Firebase state, Google state, or OAuth grant
were changed in producing it.

The how-and-in-what-order implementation layer (architectural blueprint,
implementation plan, certification runbook) is deliberately NOT produced
in this phase. The next phase is decided only after ChatGPT and Chris
review this definition.

Companion / precedent documents:
- `SPRINT_27_COMPLETION_REPORT.md` (certified, committed baseline)
- `SPRINT_27_DEFINITION.md` (immediate structural precedent)
- `SPRINT_27_PHASE_7_BROWSER_CERTIFICATION.md` (O1, O2 field observations)
- `SPRINT_27_PHASE_8_LIVE_PROVIDER_CERTIFICATION.md` (O1, O2 handoff)
- `SPRINT_27_IMPLEMENTATION_PLAN.md` (Phase 3 self-heal precedent for O4)
- `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` (phase and v1 release sequence)
- `ASSIGN_EXPERIENCE.md`, `TEACHER_JOURNEY.md`, `TEACHER_EXPERIENCE_PHILOSOPHY.md`
- `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` (PDR-027)
- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-024, PDR-025, PDR-027, PDR-029, PDR-030)

Style: no em dashes. Use " - " (spaced hyphen) as the sentence-level
break, per repository standard.

---

## 1. Status

Defined. Not started. No implementation, no code change, no test change,
no deployment, no OAuth initiation, and no Firebase or Google state
change is authorized by this document.

Sprint 27 (Student Classroom Lifecycle Completion & Certification) is
complete, certified with documented limitations, and committed at
`425f667` ("Complete Sprint 27 student classroom lifecycle"). It is not
yet production deployed; production deployment and final v1 certification
belong to Sprint 29.

Sprint 28 is a polish and hardening sprint. It repairs missing existing
affordances, eliminates UX dead ends, improves state communication and
accessibility, and closes known pre-release seams. It introduces no new
platform concept and no new backend feature family.

## 2. Sprint title and purpose

**Sprint 28: Teacher Workflow & UX Polish + Pre-Release Hardening.**

Make the existing teacher and student lifecycle coherent, discoverable,
understandable, accessible, recoverable, and release-ready. Prefer
repairing existing affordances, eliminating dead ends, improving state
communication and recovery, and making existing capabilities
discoverable, over any new capability.

Every in-scope item is tied to at least one of: a Sprint 27
certification observation, a broken or incomplete existing workflow,
accessibility, release hardening, a documented deferred item, or a
high-value usability problem in an existing workflow.

## 3. Baseline

### 3.1 Sprint 27 disposition

Sprint 27 closed the student side of the classroom lifecycle (teacher
assigns, student accesses, student completes, student sees results,
teacher sees submission) and the LyfeLabz-controlled Google Classroom
student lifecycle. It was certified across browser Paths A through D and
all three negative assertions, plus one narrow live Google
`courses.courseWork.create` acceptance of the server-built deep-link URL.

### 3.2 Deterministic baseline at Sprint 27 closeout (to be preserved)

- Functions: typecheck clean, lint clean, 91 suites, 1699 tests, 0 failures.
- App: typecheck clean, lint clean, 65 suites, 1092 tests, 1091 passed, 1
  known failure. The single failure is `curriculumManifest.test.ts` (SHA
  drift, pre-existing, see O6).
- Firestore Rules: 18 suites, 228 tests, 0 failures. Sprint 27 changed
  zero rules. Sprint 28 must not regress this.

### 3.3 Sprint 27 capabilities and invariants that must be preserved

Verbatim from the completion report, these remain load-bearing and are
NOT weakened by Sprint 28:

- Student My Assignments and My Results over the caller-scoped
  `assessmentAttemptsList` (no `studentId` from the client; no new rollup
  backend; teacher/class-scoped attempt APIs are never reused by the
  student surface).
- LMS student onboarding through `studentsCompleteLmsOnboarding`
  (server-authoritative activation from canonical enrollment evidence; no
  client-supplied class, school, district, provider membership, or join
  code).
- Assignment-aware deep link. Canonical destination
  `https://app.lyfelabz.com/app/a/{assignmentId}`, server-built by
  `buildAssignmentDeepLinkUrl`, resolved read-only by `lmsDeepLinkResolve`
  with the full authorization order (URL possession is never
  authorization; authenticated identity, enrollment, recipient
  membership, assignment status, and school/district boundaries all
  enforced; resolver never calls Google; closed or unavailable
  assignments fail safely).
- Late-enrollment recovery. Late enrollment never mutates the frozen
  recipient population; teacher intent through the "Students not yet
  assigned" section and `assignmentsRecipientAdd` (`source:
  manualAddition`) is the only extension.
- Signed-out deep-link round trip through browser history alone (no
  arbitrary client `returnUrl`).
- The Sprint 27 D1 defect fix. `app/index.html` references its bundle at
  the absolute `/app/dist/bundle.js` so booting from a deeper
  `/app/a/{assignmentId}` path works. This must not be reverted or
  casually redesigned.

## 4. Investigation evidence (O1 through O6)

Every claim below was confirmed by direct repository inspection during
Phase 0. File anchors are the evidence-of-record and the starting points
for implementation; they are not a promise that no neighboring code
moves.

### O1 - Teacher "Close assignment" control on the Classroom-linked Assignment Detail

**Observation (Sprint 27).** During browser certification the teacher
"Close assignment" control did not render on the Classroom-linked
Assignment Detail. The closed-assignment resolver negative was instead
certified through the canonical `assignmentsClose` callable
(`SPRINT_27_PHASE_7_BROWSER_CERTIFICATION.md` sections 7 and 8b).

**Code trace.**
- `app/src/assignments/detail/detail.ts` renders the Close control gated
  on `metadata.status === "published" && deps.closeCallable !== undefined`
  (and the inverse Reopen on `closed`). The rendering is type-agnostic: it
  does not branch on `enrollmentSource`, manual vs LMS, or publication
  provenance.
- `app/src/index.ts` wires `closeCallable: assignmentClose ?? undefined`
  (and `reopenCallable`) unconditionally for every active-teacher session,
  in the same branch that wires the late-recipient seams. `assignmentClose`
  is assigned via `createAssignmentsCloseCallable(functions)` for every
  active teacher.
- `metadata.status` is read from the session-scoped
  `AssignmentDetailRegistry` through
  `createAssignmentDetailMetadataReader`. The registry is hydrated from
  `assignmentsTeacherList` (`app/src/assignments/detail/hydrate.ts`),
  which returns `published` and `closed` (and optional `draft`)
  assignments for the caller with their real status, and is calm on
  failure. `platform/functions/src/assignments/assignments-teacher-list.ts`
  returns LMS-published assignments identically to manual ones.
- The backend lifecycle capability is intact: `assignmentsClose` is
  certified and the closed-assignment negative passed through it.

**Root-cause understanding.** There is no committed code path that
suppresses the Close or Reopen control for a published LMS-linked
assignment. Lifecycle controls are provenance-agnostic and the callable
is always wired. The most probable explanations for the Sprint 27
observation are therefore (a) a transient registry or state condition in
the seeded certification environment (for example a metadata reader that
resolved a stale or missing registry entry so `metadata.status` was not
`published` at that render), or (b) a discoverability problem (the Close
control is a small secondary header button and may not have been
noticed). This is NOT a backend capability gap, and the fix is NOT simply
"add a button."

**Classification.** P1 required pre-release hardening. Nature: functional
defect OR discoverability (must be disambiguated by browser reproduction
before a fix is chosen).

**Disposition.** In scope as a bounded verification-plus-polish item, not
a redesign. Reproduce in a clean browser and emulator run against a
genuinely LMS-published assignment reached through Curriculum then View
summary. If the control renders, close O1 by verification and optionally
apply discoverability polish (clearer placement or labeling of lifecycle
controls). If it genuinely does not render, capture the exact failing
state (registry contents, `metadata.status`, seam wiring) and fix within
that render or state seam. Do not redesign Assignment Detail.

### O2 - v2 post-submission results scroll and focus

**Observation (Sprint 27).** After a student submits a v2 assessment the
results render while the browser retains a scroll position that hides the
top of the score, so the student must scroll up.

**Code trace.**
- The v2 assessment runtime (`app/src/runtime/entry.ts`, built to
  `assets/lyfelabz-assessment-runtime.js`) is a headless adapter. It owns
  no results UI, no scroll behavior, and no focus behavior. It exposes
  `window.lyfelabz.lessonQuiz` and `assessmentRuntime` for the lesson to
  call. A single runtime edit therefore CANNOT fix O2.
- The scroll and results UI live in each v2 lesson artifact. In
  `app/lessons/lesson_earths-layers.html` (function `elSubmitQuiz`) submit
  reveals the score board and calls
  `sb.scrollIntoView({ behavior: 'smooth', block: 'start' })` where `sb`
  is `#el-score` (class `.score-board`).
- The page has a sticky top nav (`position: sticky; top: 0; z-index:
  1000`, roughly 64px, 52px at the phone breakpoint) and a
  `.quiz-progress-sticky` bar (`position: sticky; top: 64px`). The
  `.score-board` rule has `margin-top` but NO `scroll-margin-top`.
  `block: 'start'` aligns the score board top to viewport y=0, where the
  two sticky layers overlay and cut off the top of the score; the student
  scrolls up to reveal it.
- There is no focus move to the results on submit, and the score board
  carries no `role="status"` or `aria-live`, so a screen-reader student is
  not told the score rendered.

**Breadth.** The identical pattern (a `.score-board#el-score` with
`margin-top` and no `scroll-margin-top`, plus
`scrollIntoView({block:'start'})` on submit under the same sticky nav and
`quiz-progress-sticky`) is present in all four v2 lessons: earths-layers,
plate-tectonics, water-cycle, earthquakes.

Correction (Phase 1 inspection, ratified by the Phase 2C scope amendment,
§16 below): all four v2 lessons are generated from canonical sources under
the Sprint 18 deterministic lesson build system, not just earths-layers.
Canonical sources exist for all four under `lesson-sources/`, each has a
builder config under `app/scripts/lessonBuilder/lessons/`, and each v2
artifact carries the `<!-- GENERATED FILE. -->` notice. The earlier
sentence in this paragraph claiming "the other three are hand-authored v2
artifacts" was factually wrong and is retained here only so the correction
is visible. The fix must respect the build boundary for all four (edit the
canonical source and rebuild; never hand-edit the artifact), or be placed
in the canonical shared mobile stylesheet, which CLAUDE.md records as the
owner of "sticky quiz progress offset behavior".

**Classification.** P1 required pre-release hardening. Nature:
accessibility plus UX clarity (a functional scroll defect with an
accessibility dimension).

**Disposition.** In scope. Ensure that on submission the viewport and
focus move to the top of the results content so the full score and
submission confirmation are immediately visible, including for
keyboard-only and screen-reader students. The fix is a bounded scroll
offset (a `scroll-margin-top` on the results target equal to the sticky
chrome height, or an equivalent offset scroll) plus a focus move to a
results heading and a status role. It applies to the four v2 lessons
only; it does not touch v1 lessons and does not begin a curriculum
migration.

### O3 - Student return navigation after completion

**Observation (Sprint 27).** After a v2 submission there was no obvious
in-product route from the results back to the student workspace; browser
Back was used.

**Code trace.**
- A v2 assignment launches as a full-page navigation OUT of the SPA to
  the standalone lesson artifact at `/app/lessons/lesson_<slug>.html?
  assignment=<id>` (the Sprint 18 override path,
  `app/src/assignments/studentList/launchOverrides.ts`), reached from the
  My Assignments launch control and from the deep-link silent handoff
  (`app/src/assignments/deepLink/arrival.ts`).
- After an assignment submission the lesson shows only
  "Submitted to your teacher" in `#el-submit-status`. There is no in-page
  control that returns to `/app/` (the student workspace / My
  Assignments). The runtime provides none. So only browser Back returns.
- The deep-link arrival surface DOES offer "Go to My Assignments" on every
  informational and failure state, but the successful silent handoff
  navigates to the standalone lesson, which then has no return control.
- Non-assignment practice launches the v1 public artifact and is a
  different, legacy experience; it must not be altered.

**Root-cause understanding.** A genuine missing affordance in the four v2
lesson artifacts: no assignment-context return path to the student
workspace after completion.

**Classification.** P1 required pre-release hardening. Nature: missing
affordance / UX clarity ("students should not depend on browser Back").

**Disposition.** In scope. Add the smallest coherent return control to
the v2 lesson results surface, rendered and active ONLY in assignment
context (`window.lyfelabz.lessonQuiz.hasAssignmentContext()` true) so v1,
practice, and standalone behavior are byte-for-byte unchanged. The
destination is the student workspace (`/app/`, which lands on My
Assignments per PDR-024i). Label and exact destination are an open
decision for Chris and ChatGPT; "Back to My Assignments" was discussed and
is not locked. Keyboard-usable, not color-dependent.

### O4 - Manual onboarding claims self-heal

**Observation (deferred item).** Sprint 27 Phase 3 self-healed a
non-atomic activation seam for LMS onboarding and explicitly left the
manual `studentsCompleteOnboarding` path unchanged, deferring it to
Sprint 28 pre-release hardening
(`SPRINT_27_IMPLEMENTATION_PLAN.md` Phase 3 and Phase 4 deferral notes).

**Code trace.**
- `platform/functions/src/students/students-complete-onboarding.ts`
  activates in three non-atomic steps: update the `users/{uid}` record to
  `active`, then `writeCustomClaims(...)`, then `writeAuditEvent(...)`. A
  Firestore transaction cannot enclose the claims write.
- The failure window is between the record update and the claims write. If
  the record reaches `active` but the claims write fails or the process
  dies, the record is `active` while the token carries no role, schoolId,
  or districtId.
- The idempotent replay branch matches on
  `user.status === "active" && role === "student" && schoolId === input.schoolId`
  and returns `alreadyActive: true` WITHOUT re-reading or re-asserting
  claims. The client force-refresh only re-reads claims that were never
  written and degrades the student to the pending surface, so the student
  is persistently stranded and cannot access assignments.
- The safer counterpart already exists: the LMS path
  (`students-complete-lms-onboarding.ts`) reads the caller's claims via the
  shared `readCustomClaims` (`platform/functions/src/shared/auth/claims.ts`)
  and re-asserts them when they are missing or stale, as a bounded no-op
  when healthy. `readCustomClaims` is already available.

**Root-cause understanding.** A confirmed, reproducible split-brain
recovery gap on the primary manual (join-code) onboarding path used by the
Grade 6 pilot classes and certified as Path A. Users can become stranded
and inconsistent; existing login and session reconciliation does not
self-heal it (the record is already `active`, so nothing re-derives the
missing claims).

**Classification.** P1 required pre-release hardening. Nature:
recovery/hardening.

**Disposition.** In scope. Apply the same narrow, certified idempotent
self-heal the LMS path uses: in the idempotent branch, read the caller's
own claims, and only when role, schoolId, or districtId are missing or
stale, re-derive districtId from the school the record already names and
re-assert the canonical student claims through `writeCustomClaims`. No
enrollment re-scan, no second activation audit event, and a bounded no-op
when claims are healthy. This is not an onboarding redesign and requires
no architecture expansion.

### O5 - Late-recipient Assignment Detail polish

**Observation.** Sprint 27 intentionally implemented the minimum safe
late-recipient affordance ("Students not yet assigned" plus one-at-a-time
"Add to assignment").

**Code trace.** `renderLateRecipientPanel` in
`app/src/assignments/detail/detail.ts` already provides a heading, a
loading state, an error state, an empty state ("Every enrolled student is
already assigned."), per-row display name with an accessible
`aria-label`, an in-flight section lock, and a single non-leaking action
error line. Frozen-recipient semantics are preserved (one-at-a-time,
teacher-initiated, server-mediated, idempotent). The section renders only
for a `published` assignment with both seams wired.

**Bounded gaps found.**
- No explicit success confirmation after an add. The added student simply
  disappears from the list and appears in the roster above; a brief
  confirmation ("Added to the assignment") would improve clarity for a
  Grade 6 teacher.
- No calm informational state for a `closed` (or `draft`) assignment,
  where a late add is intentionally impossible (PDR-029j). The section is
  simply absent, with no explanation of why late-adding is unavailable.
- Minor accessibility: the in-flight "Adding..." button-text change is not
  announced via `aria-live`.

**Classification.** P2 valuable bounded polish. Nature: UX clarity plus a
minor accessibility improvement.

**Disposition.** In scope as bounded polish only. Do not introduce
automatic recipient mutation, a bulk gesture, or a select-all. Do not
redesign Assignment Detail. Frozen-recipient semantics are locked.

### O6 - Curriculum manifest SHA drift

**Observation.** The app suite carries one known failure,
`curriculumManifest.test.ts`, described as SHA drift and intentionally not
repaired in Sprint 27.

**Code trace and history.**
- The failing assertion re-parses the root `index.html`, rebuilds the
  manifest, and compares it to the checked-in
  `app/src/curriculum/curriculum.manifest.json`; it also compares the
  stored `canonicalSourceSha256` to a fresh hash of `index.html`.
- The manifest was last regenerated in commit `c8fe03e`. The most recent
  `index.html` change is commit `4fd2bab` ("Fix How It's Built anchor
  offset", 2026-07-30), which changed exactly one line: it added
  `scroll-margin-top: 80px` to the `#how` CSS rule. This is a cosmetic
  anchor offset in the marketing "How It Works" section. It touches no
  topic-group, subject-block, unit-card, or resource href.
- Phase 0 ran the test in isolation: 1 test fails (the drift comparison),
  19 pass, including every structural test (topic groups, unique slugs and
  hrefs, surfaceable-lesson count of 49, orphan units, resource totals).
  The passing structural tests prove the curriculum DATA in the checked-in
  manifest is identical to a fresh parse; only the embedded SHA fingerprint
  differs.

**Root-cause understanding.** The drift is benign and fully understood: a
single cosmetic CSS line was added to `index.html` after the manifest was
last built, without re-running the manifest build. Regenerating the
manifest (`npm run curriculum:build` inside `app/`, per the test's
REGENERATE_HINT and `build-curriculum-manifest.cjs`) would update only the
SHA and re-green the test. It would bless a KNOWN, benign change, not
unknown drift.

**Classification.** Defer to Sprint 29 certification. Nature: test/release
hygiene.

**Disposition.** Not repaired in Phase 0 (the manifest was not
regenerated). Ownership stays with Sprint 29's "complete deterministic
baseline" per the Sprint 27 completion report section 14 and the roadmap.
Sprint 28 contributes this completed root-cause finding so Sprint 29's
regeneration is a mechanical, understood step. Sprint 28 does not make the
test green merely for cleanliness.

## 5. Additional evidence-backed hardening candidates

The bounded audit of the existing teacher and student lifecycle surfaced
no new P0 or P1 defect beyond O1 through O6. Positive findings worth
recording (they bound the scope and prevent over-reach):

- The student surfaces are well formed. Both the provisioned and the
  active student surfaces carry a sign-out control, clear empty states
  ("No assignments are open for you right now...", "You have not completed
  any assignments yet."), loading states, and recoverable error states.
  The two-surface PDR-024i menu (My Assignments, My Results) renders as an
  accessible tablist. No dead end was found inside the SPA.
- The deep-link arrival surface has a complete set of calm, non-leaking
  states, each with a "Go to My Assignments" or "Try again" route. No dead
  end.
- The platform source contains no lingering `TODO`, `FIXME`, or "Sprint
  28" code markers.

One minor candidate (P2, in scope under Workstream 1 alongside O5):

- **AC1 - v2 lesson launch leaves the SPA.** Because a v2 assignment is a
  full-page navigation to the standalone lesson artifact, every in-lesson
  return depends on browser Back until O3 lands. This is the same root
  cause as O3 and is addressed by O3; recorded here only to confirm the
  audit reached it and to keep it from being re-opened as a separate item.

## 6. In scope

Bounded, evidence-backed items only:

- O1: verify and, if needed, repair or improve the discoverability of the
  Assignment Detail Close and Reopen lifecycle controls for LMS-sourced
  published assignments.
- O2: v2 post-submission results scroll and focus, across the four v2
  lessons.
- O3: v2 assignment-context return-to-workspace control, across the four
  v2 lessons.
- O4: manual `studentsCompleteOnboarding` idempotent claims self-heal.
- O5: bounded Assignment Detail late-recipient polish (success feedback,
  calm informational state, minor accessibility).
- O6: contribute the root-cause evidence; hand the repair to Sprint 29.

## 7. Out of scope

Sprint 28 explicitly excludes and will actively reject:

- A whole-workspace visual redesign or a Teacher Workspace visual reboot.
- Whole-curriculum v2 migration. The existence of the v1 Practice /
  Classroom toggle on v1 lessons is not a defect. Sprint 28 improves the
  existing four v2 lessons; it does not migrate v1 lessons.
- Any new LMS architecture, provider, or capability.
- Reopening any certified OAuth architecture, including Sprint 25 B13; no
  incremental-consent redesign, no grant manipulation, no account-chooser
  dependence, no live OAuth experiment.
- A new student rollup or analytics backend. My Results stays on the
  caller-scoped `assessmentAttemptsList` with client aggregation.
- Any weakening of frozen-recipient semantics; no automatic or bulk
  recipient addition anywhere.
- Any new platform concept, feature family, claim key, or lifecycle field.
- Curriculum-manifest regeneration (Sprint 29).
- Production deployment and final v1 production certification (Sprint 29).
- Unrelated cleanup, opportunistic refactors, and preservation-mode
  instructional redesigns.

## 8. UX invariants

LyfeLabz is used primarily by Grade 6 students and teachers. Every Sprint
28 change must be:

- immediately understandable and low cognitive load,
- explicit about what happens next,
- forgiving of mistakes and recoverable,
- accessible, keyboard usable, and not dependent on color alone,
- not dependent on browser Back,
- clear about success and failure, and calm and informational when an
  action cannot proceed.

Teacher-facing UI minimizes LMS terminology where plain teacher language
communicates better. Student-facing UI exposes no implementation concept.
The locked Teacher Workspace direction (dark blue-gray chrome, gold
LYFELABZ wordmark, left navigation of Curriculum / Classes / Present Mode
/ Settings, lesson cards, Assign, Assigned / View Summary, Active
Assignments summary) is preserved; no visual reboot is proposed.

## 9. Security and domain invariants

All Sprint 27 protections are preserved without exception:

- Server-authoritative deep-link authorization; URL possession is never
  authorization; the resolver stays read-only and never calls Google.
- Caller-scoped student result reads only; no `studentId` from the client;
  no cross-student data; no answer keys; no teacher analytics exposed to
  students.
- Server-mediated, server-authoritative LMS and manual onboarding; no
  client-asserted school, district, class, provider, or roster identity.
  The O4 self-heal reads and re-asserts server-owned claims only; it
  accepts no new client authority field.
- Enrollment, recipient, and school/district boundaries enforced at the
  Functions and Firestore Rules layers. Sprint 28 changes zero Firestore
  rules unless a discovered defect requires it, and re-runs the rules
  suite either way.
- Frozen-recipient semantics (PDR-029d, PDR-029h, PDR-029l) intact.
- No token, secret, PII, or Google identity in any URL, payload, audit
  event, log line, or client surface.

## 10. Workstreams

Bounded workstreams derived from the audit findings. Phase ordering and
implementation detail are deferred to a later phase; this section fixes
the grouping and boundaries only.

### Workstream 1 - Assignment Detail teacher polish (O1, O5)

Teacher-facing. Verify and, if needed, repair or improve the
discoverability of the Close and Reopen lifecycle controls on LMS-sourced
published assignments (O1), and apply the bounded late-recipient polish
(O5: add-success feedback, a calm informational state for
lifecycle-states where late-adding is unavailable, minor accessibility).
No Assignment Detail redesign. No change to recipient semantics.

### Workstream 2 - v2 assessment results UX (O2, O3)

Student-facing, across the four v2 lessons (earths-layers,
plate-tectonics, water-cycle, earthquakes). On submission move viewport
and focus to the top of the results content and announce the score (O2),
and add an assignment-context-only return-to-workspace control after
completion (O3). Respect the Sprint 18 lesson build boundary for
earths-layers. Do not alter v1, practice, or standalone behavior.

### Workstream 3 - Manual onboarding claims self-heal (O4)

Backend recovery hardening. Add the certified idempotent claims self-heal
to `studentsCompleteOnboarding`, mirroring the Sprint 27 LMS path, using
the existing `readCustomClaims`. No onboarding redesign.

### Workstream 4 - Manifest drift evidence handoff (O6)

No production change. Record the completed root-cause finding and hand the
one-command regeneration to Sprint 29.

Renumbering note (Phase 2C amendment, §16): this manifest handoff is
renamed Workstream 5. The new Workstream 4 is the assignable curriculum v2
migration added by the scope amendment (§16.5). This §10 list predates the
amendment; §16 is authoritative for the W4/W5 numbering.

## 11. Acceptance criteria

- **W1 (O1).** In a clean browser and emulator run, a teacher opening a
  genuinely LMS-published assignment via Curriculum then View summary sees
  the Close control on a published assignment and the Reopen control on a
  closed one, with the correct status transition, and the behavior matches
  a manual-class assignment. Any state or discoverability defect found is
  fixed within the render or state seam, with a deterministic regression
  test.
- **W1 (O5).** An add produces a visible, accessible success confirmation;
  a lifecycle state where late-adding is unavailable shows a calm
  informational note rather than silent absence; the in-flight state is
  announced. No automatic or bulk addition exists; frozen semantics
  preserved.
- **W2 (O2).** After a v2 submission in each of the four v2 lessons, the
  full score and submission confirmation are visible without manual
  scrolling, and focus moves to the results with a status announcement, for
  mouse, keyboard, and screen-reader students, at the 480, 720, and 960
  breakpoints.
- **W2 (O3).** After completing an assigned v2 assessment, a keyboard-usable
  return control lands the student back in the student workspace / My
  Assignments without using browser Back. In practice, standalone, and v1
  contexts the control is absent and behavior is unchanged.
- **W3 (O4).** A provisioned-then-active manual student whose claims write
  failed is repaired on the next `studentsCompleteOnboarding` call
  (claims re-asserted from server state) and can reach assignments; a
  healthy replay is a bounded no-op with no second activation audit event.
- **W4 (O6).** The root-cause finding is recorded and referenced by the
  Sprint 29 baseline task; no manifest change is made in Sprint 28.

## 12. Validation expectations

- **Deterministic.** New and updated unit tests for the O4 self-heal
  (mirroring the LMS `students-complete-lms-onboarding.test.ts` split-brain
  and stale-claims cases), for any O1 detail render or state fix, and for
  the O5 detail polish. The Functions, App, and Firestore Rules suites
  return to their Sprint 27 baselines (the O6 manifest failure remains the
  only expected app red until Sprint 29 regenerates it).
- **Browser certification (later phase).** O1 reproduction on a genuinely
  LMS-published assignment; O2 scroll and focus and O3 return navigation in
  each of the four v2 lessons at the canonical breakpoints; O5 teacher
  flow. Emulated and seeded backend state is sufficient. Do NOT run a live
  Google mutation for any item that merely touches an LMS-linked
  assignment: the O1 closed-assignment resolver negative is already
  certified, and no Sprint 28 item requires a real `courseWork.create`.
- **Accessibility.** Keyboard and screen-reader checks for O2, O3, and the
  O5 in-flight state; no color-only signaling.

## 13. Explicit deferrals

Investigated and intentionally excluded from Sprint 28:

- O6 curriculum-manifest regeneration: Sprint 29 (root-cause evidence
  contributed here).
- Whole-curriculum v2 migration: post-v1 / a deliberately chosen feature
  family. The v1 Practice / Classroom toggle is not a defect.
- Google OAuth verification and Data Access disposition, Secret Manager
  rotation, production deployment: Sprint 29.
- Client-supplied `schoolId` on the manual onboarding path (the
  generalized trust-boundary question): post-v1; the LMS path deliberately
  does not inherit it, and O4 does not touch it.
- Any Assignment Detail redesign, teacher analytics, gradebook,
  administrator platform, or additional LMS providers: out of the v1
  release sequence.

## 14. Sprint 29 boundary

Sprint 28 is hardening, not release certification. Sprint 29 (Teacher
Platform v1 Release Certification) owns: the curriculum-manifest SHA
regeneration and a complete deterministic baseline; the Google OAuth
verification and Data Access disposition; Secret Manager rotation;
documentation reconciliation; production deployment; production teacher
and student smoke and end-to-end tests; and final v1 production
certification. No Sprint 30 is planned.

## 15. Definition of Done for Phase 0

- This definition exists and is grounded in cited canonical files, code
  anchors, tests, and certification observations.
- O1 through O6 are each investigated with evidence, a root-cause
  understanding, a classification, and a disposition.
- Additional candidates are evidence-backed; over-reaching and
  architectural candidates are explicitly rejected.
- No production implementation changed; nothing staged, committed, pushed,
  or deployed; no Firebase, Google, or OAuth state changed.
- Sprint 28 scope is bounded and ready for Chris and ChatGPT review, and no
  implementation plan, blueprint, or certification runbook was created.

## 16. Phase 2C scope amendment - assignable curriculum v2 migration

Status: Approved scope amendment (Chris and ChatGPT), post Phase 1, post
Phase 2A. This section supersedes the Phase 0 assumption (§7, §13) that
whole-curriculum v2 migration is automatically outside Sprint 28. It does
not erase that history; it records why the boundary moved and fixes the
new bounded surface. It authorizes planning only, not implementation. The
full audit evidence lives in `SPRINT_28_CURRICULUM_MIGRATION_AUDIT.md`;
the architecture lives in the blueprint §18; the ordered work lives in the
plan Phase 5.

### 16.1 Why the boundary moved

Phase 0 excluded whole-curriculum v2 migration because it could have been a
major architecture expansion, and it recorded the v1 Practice/Classroom
toggle as "not a defect." Phase 1 inspection established a new load-bearing
fact: all four current v2 lessons are generated through the deterministic
lesson-source build system (blueprint §2.3), not one pilot plus three
hand-authored artifacts. Migration is therefore a small repeated
transformation over generated sources, not a set of unrelated architecture
projects. There is also a product-release concern: from a teacher's and a
student's perspective a lesson is simply an assignable lesson, and it is
undesirable for one assignment to run the silent assignment-aware v2
lifecycle while another asks the student to choose Practice or Classroom
solely because the underlying lesson has not migrated. Teacher Platform v1
certification (Sprint 29) is stronger if the appropriate assignable
curriculum shares one coherent student assignment contract.

### 16.2 What the audit found (summary; full evidence in the audit doc)

- The Teacher Platform assigns exactly one thing: a `lessonSlug`
  (`assignmentsCreateDraft`). The assignable surface is the curriculum
  manifest's surfaceable lessons: `getSurfaceableLessons()` = units with a
  `lesson` resource that are not gated. That is 49 lessons (23 Grade 6, 26
  Grade 7).
- Non-lesson resources (games, investigations, simulations, extensions,
  engineering challenges, disease and system pages) are supporting
  resources inside a lesson unit. They are never independent assignment
  targets. They are out of the migration surface.
- One lesson, `ragebaiting` (Grade 6 behavioral-science), is gated and is
  not surfaced or assignable today (PDR-010 activation deferred). It is not
  part of this migration.
- All 49 surfaceable lessons share the same standard assessment
  architecture: a per-lesson prefixed `<prefix>SubmitQuiz`, a
  `<prefix>-score` results board, a 10-question single-choice quiz, a Show
  Your Thinking box, and the assessment-runtime `<script>` include. No
  surfaceable lesson uses a materially different interaction model.
- Four lessons are already v2 (built, with a launch override):
  earths-layers, plate-tectonics, water-cycle, earthquakes. The other 45
  surfaceable lessons are v1-only and are structurally compatible with the
  same migration.
- A hard co-requisite exists at the backend: `assignmentsPublish` refuses a
  draft -> published transition unless the referenced lesson already has a
  deployed assessment (answer key), through `resolveCurrentAssessmentRevisionId`
  (ASSESSMENT_SCORING_CONTRACT.md §12.1). Only four answer-key payloads are
  authored in the repo (what-is-life, cell-types, biological-evolution,
  earths-layers), and only earths-layers has both a v2 build and an answer
  key. Every migrated lesson therefore also needs an authored, deployed
  assessment to be publishable end to end.

### 16.3 Migration categories

- Category A (already v2): 4 - earths-layers, plate-tectonics, water-cycle,
  earthquakes. Preserve behavior; receive the W2 (O2/O3) hardening.
- Category B (v1, structurally compatible): 45 - migrate via the repeated
  transformation. This is the W4 surface.
- Category C (different interaction model): 0 surfaceable lessons.
- Category D (not assignable / not student-facing-assignable): all
  non-lesson resources, the 2 orphan units, and the gated `ragebaiting`.
- Category E (architecture-blocked): 0 lessons. The answer-key co-requisite
  is a data-authoring and deploy-sequencing dependency, not a new
  architecture, so it does not block on architecture.

### 16.4 Amended scope decision

Executive conclusion: YES WITH EXPLICIT EXCEPTIONS. The frontend v2 lesson
migration of the ~45 Category B lessons is a bounded, systematic Sprint 28
workstream (W4) that reuses the existing deterministic build system,
V1-ONLY/V2-ONLY markers, the instructional-equivalence contract,
`lessons:verify`, and the launch-override seam. The exceptions:

- The backend answer-key co-requisite. Authoring each lesson's
  `<slug>.r1.json` answer-key payload (a mechanical extraction of the
  quiz that already exists in each lesson) can be done deterministically in
  Sprint 28. Deploying assessments to production is a Firebase mutation and
  belongs to Sprint 29 release certification, alongside the manifest
  regeneration. Sprint 28 does not deploy assessments and does not call
  Google or mutate Firebase.
- The three already-built v2 lessons that lack an authored answer key
  (plate-tectonics, water-cycle, earthquakes) need answer keys authored to
  be publishable end to end. This is named, not silently assumed.
- The gated `ragebaiting` lesson stays out (product-gated).
- Sequencing: W2 (O2/O3 results and navigation hardening) lands BEFORE W4
  so the hardened results pattern is the template every Category B
  migration clones, avoiding a second pass over 45 lessons.

### 16.5 In-scope change

§6 gains one workstream:

- W4 (curriculum v2 migration): migrate the Category B surfaceable lessons
  onto the existing v2 assignment-aware student contract through the
  deterministic build system, and author (not deploy) the co-requisite
  answer-key payloads. Preserve instructional equivalence and the v1 public
  content. No new assessment architecture, no new assignment backend
  concept, no grading-semantics change, no instructional redesign.

### 16.6 Out-of-scope and deferral corrections

§7 and §13 previously listed "whole-curriculum v2 migration" as out of
scope. That specific exclusion is withdrawn by this amendment for the
Category B frontend migration and answer-key authoring. The following
remain firmly out of scope and are not weakened:

- Any instructional redesign, question rewrite, scientific-content change,
  or assessment-architecture change. Migration preserves instructional
  content; it is a platform-contract migration only.
- Assessment DEPLOYMENT to production (Sprint 29), curriculum-manifest
  regeneration (Sprint 29), and final v1 certification (Sprint 29).
- Any new assignment backend concept, claim key, lifecycle field, grading
  semantic, teacher-assignment semantic, or frozen-recipient change.
- Migrating the gated `ragebaiting` lesson or making any non-lesson
  resource independently assignable.
- Reopening OAuth, the deep-link resolver, or the Teacher Workspace design.

### 16.7 Acceptance criteria for W4 (per migrated lesson)

1. Teacher assignment behavior for the lesson is unchanged and correct.
2. Assignment-aware student launch is automatic (the lesson detects
   `?assignment=<id>` via `hasAssignmentContext()`).
3. The student is not asked to choose Practice or Classroom when assignment
   context exists.
4. Assignment identity and context are preserved through submission.
5. Submission uses the certified assignment-aware runtime
   (`window.lyfelabz.lessonQuiz.finalize`), scored against the deployed
   answer key.
6. Results follow the hardened W2 standard (scroll, focus, announcement).
7. Assignment-aware completion offers `Back to My Assignments`.
8. Practice / non-assignment behavior remains valid (v2 exploration-mode
   message; no legacy chooser).
9. Instructional content is equivalent (instructional-equivalence contract
   passes).
10. The v1 public artifact preserves the lesson's instructional content and
    public URL; it becomes a generated artifact carrying the GENERATED FILE
    notice, exactly as the four existing v2 lessons already did.
11. Generated artifacts are produced from canonical sources, never
    hand-edited.
12. `lessons:verify` passes (committed artifacts equal a fresh build).
13. The marker scanner and instructional-equivalence checks pass.
14. Teacher Platform security and domain invariants are unchanged.
15. The authored `<slug>.r1.json` answer key matches the lesson's quiz
    (stems, options, correct option, explanation) exactly. Deployment is
    deferred to Sprint 29.

### 16.8 Manifest interaction

W4 changes generated lesson artifacts (the root v1 file and the
`app/lessons/` v2 file) and the launch-override table. It does NOT change
`index.html`, which is the curriculum manifest's canonical source, so W4
does not touch the manifest or its SHA. The pre-existing O6 manifest SHA
drift (the cosmetic `#how` line) is neither hidden nor conflated by W4 and
remains Sprint 29's mechanical regeneration. This separation is deliberate.

*End of Phase 2C scope amendment.*

*End of Sprint 28 definition (Phase 0, amended Phase 2C).*
