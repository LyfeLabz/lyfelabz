# Sprint 28 Phase 7 - Browser & Emulator Certification

Status: COMPLETE AND CERTIFIED WITH DOCUMENTED LIMITATIONS. Interactive
browser and emulator certification of the Sprint 28 UX / hardening work
(W1 Assignment Detail, W2 v2 results, W3 onboarding self-heal, W4
curriculum v2 migration) against local emulated backend state. No live
Google provider mutation. No production changes; nothing staged,
committed, pushed, or deployed. All Sprint 28 implementation remains
uncommitted at HEAD `425f667`.

Companion documents: `SPRINT_28_DEFINITION.md`,
`SPRINT_28_ARCHITECTURAL_BLUEPRINT.md`, `SPRINT_28_IMPLEMENTATION_PLAN.md`
(Phase 7 scenario matrix), `SPRINT_28_PHASE_5A_V2_MIGRATION.md`,
`SPRINT_28_PHASE_5B_ASSESSMENT_FIDELITY.md`,
`SPRINT_28_PHASE_6_DETERMINISTIC_VALIDATION.md`,
`SPRINT_27_PHASE_7_BROWSER_CERTIFICATION.md` (convention of record).

Style: no em dashes. Use " - " (spaced hyphen) as the sentence-level break.

---

## 1. Environment

- **HEAD:** `425f667` ("Complete Sprint 27 student classroom lifecycle").
  Unchanged by Sprint 28 and unchanged by this phase. All Sprint 28 work
  is intentionally uncommitted for Chris to review and commit manually.
- **Working tree:** 259 changed paths, 0 staged, before and after this
  phase (identical). Phase 7 made no production source change (see §12).
- **Builds under test (this session):** `platform/functions` rebuilt
  (`npm run build`; `lib/` carries the W3 self-heal
  `studentsCompleteOnboarding` and every Sprint 27/28 callable). `app`
  rebuilt (`npm run build`; `dist/bundle.js` carries the 49-slug
  `launchOverrides` and the W1 `detail.ts` O1/O5 rendering). `dist/`,
  `lib/`, and the committed runtime asset are all gitignored or unchanged,
  so the rebuilds did not dirty the tree.
- **Lesson runtime:** the committed shim `/assets/lyfelabz-assessment-runtime.js`
  (Sprint 17, unchanged by Sprint 28) plus the committed active bundle
  `/assets/lyfelabz-assessment-runtime-active.js`. The shim's
  `hasAssignmentContext()` is driven purely by the presence of an
  `assignment=` URL parameter, so the entire W2 client behavior (score
  render, offset scroll, focus, live region, return-control reveal) is
  exercisable from the hosting emulator by URL alone.
- **Emulator suite** (project `lyfelabz-prod`, singleProjectMode): Auth
  `127.0.0.1:9099`, Firestore `127.0.0.1:8080`, Functions `127.0.0.1:5001`,
  Hosting `127.0.0.1:5000`. Tier 1 (W2 lessons) ran against a
  hosting-only emulator; Tier 2 (W1 teacher, W3 onboarding) ran against
  the full suite. `localhost`/`127.0.0.1` satisfies the client
  `isEmulatorHost` predicate, so the browser talks only to the emulators.
- **Seed:** `node seed-emulator.js` + `verify-seed.js` (ALL PRESENT):
  `districts/district-beta`, `schools/school-beta`, 4 cert teachers
  (`cert-teacher-001..004`, role teacher, school-beta, google.com
  provider), `lmsProviders/googleClassroom`, 3 cert assessments
  (`what-is-life`, `cell-types`, `biological-evolution`). classes /
  enrollments / assignments start empty. All Sprint 28 cert class /
  assignment / student state was created this session (genuine UI
  publication plus seeded enrolled students, per §3/§4).
- **Browser:** the in-app Chromium browser pane. Viewports: desktop
  1280x720 / 1280x800 / 1280x900, mobile 375x812 (below the 600px W2
  breakpoint). Evidence is DOM / geometry / accessibility-tree inspection
  (`getBoundingClientRect`, `document.activeElement`, computed styles,
  `aria-live` capture) plus backend Firestore reads, matching the
  Sprint 27 convention. Screenshots are used only where they materially
  document the teacher surface.
- **Teacher session:** the app uses `signInWithPopup`, which this headless
  pane suppresses silently (no popup tab, no redirect, no console error).
  A genuine `cert-teacher-001` session was instead established by minting a
  real emulator ID token (custom-token exchange, claims role=teacher /
  school-beta / district-beta) and injecting it into the app's own
  Firebase Auth IndexedDB persistence, then reloading. The app restored
  the session through its normal `onAuthStateChanged` bootstrap and routed
  to `/app/teacher`. This is a genuine authenticated session against the
  Auth emulator; only the sign-in gesture is substituted.

Certification identifiers use opaque cert accounts and "Sprint 28 ..."
labels. No real student PII is used. No production Firebase, no real
Google Classroom, no OAuth grant.

---

## 2. Disposition

**COMPLETE AND CERTIFIED WITH DOCUMENTED LIMITATIONS.**

Every Sprint 28-new browser-only behavior passed:

- O1 Assignment Detail lifecycle (published -> Close -> closed -> Reopen ->
  published) certified live on a manual class, and the Close control
  certified present on a genuinely LMS-linked published assignment
  (Branch B, no provenance suppression). This closes the pre-existing
  Sprint 27 O1 limitation.
- O5 late-recipient add success ("Added to assignment."), the in-flight
  "Adding..." announcement, duplicate-activation prevention, the
  `aria-live` announcements, and the closed-lifecycle informational note
  ("This assignment is closed. Reopen it to add students.") all certified,
  with the backend recipient written at source `manualAddition`.
- O2 results scroll offset, focus, and `role="status"`/`aria-live`/
  `tabindex` semantics certified at desktop and mobile across the W4
  representative matrix.
- O3 `Back to My Assignments` -> `/app/` certified positive and
  absent-in-practice certified negative.
- W3 manual onboarding claims self-heal certified against the deployed
  emulator callable (missing-claims repair, stale-school repair, and
  healthy no-op, each with no second activation).
- The signed-out deep-link path-preservation regression holds.

No Sprint 28 regression or defect was found. All limitations (§10) are
tooling boundaries (headless smooth-scroll no-op, no popup transport,
screen-reader speech, the draft informational-state UI path, and the O5
failure-injection path), each with the deterministic evidence that
covers it. Nothing was deployed; the manifest was not touched.

---

## 3. Tier 2 backend context created this session

| Record | Id | Shape | How created |
|---|---|---|---|
| Manual class | `23pigr5llprhr205gtbw` "Sprint 28 Cert Class" | teacher cert-teacher-001, school-beta, Grade 6 Block A, joinCode 7400705B, active | genuine teacher UI (Create LyfeLabz Class) |
| LMS class | `s28-lms-classroom` "Sprint 28 LMS Classroom" | teacher cert-teacher-001, school-beta, Grade 6 Block B, `enrollmentSource: lms`, `lmsProviderRef: googleClassroom`, no joinCode, active | seeded (exact class shape + LMS provenance) |
| Student A | `s28-student-a` | active student, school-beta, enrolled in manual class BEFORE publish | seeded users + enrollment |
| Student B | `s28-student-b` | active student, school-beta, enrolled in manual class AFTER publish (non-recipient) | seeded users + enrollment |
| LMS student | `s28-student-lms` | active student, enrolled in LMS class before publish | seeded users + enrollment |
| Manual assignment | `a-cell-types-23pigr5llprhr205gtbw-cert-teacher-001-3dd4abf88a17` | cell-types, published, class = manual class | genuine teacher UI (Curriculum -> Assign) |
| LMS assignment | biological-evolution on `s28-lms-classroom` | published | genuine teacher UI (Assign to LMS class only) |

Seeding follows the Sprint 27 accommodation: backend context records use
the exact production write shapes; the NEW Sprint 28 behavior under test
(the O1 render, the O5 add flow, the self-heal) is exercised genuinely.

---

## 4. Scenario results

### Tier 2 - W1 teacher Assignment Detail (O1 / O5) - full suite emulator

| # | Scenario | Observed UI | Backend | Result |
|---|---|---|---|---|
| 1a | Assignment Detail header + published control (manual) | "Assignment / Back to Curriculum / Cell Types", Class "Sprint 28 Cert Class Grade 6", Status **Published**, **Close assignment** visible, Reopen absent; Roster Not started (1) Sprint 28 Student A | assignment `published`, recipient s28-student-a `assigned` source `classPublication` | PASS |
| 1b | Lifecycle published -> Close -> closed | Close confirm dialog -> Status **Closed**, **Reopen assignment** visible, Close absent, no stale UI, no page reload | canonical `assignmentsClose` via the UI button | PASS |
| 1c | Lifecycle closed -> Reopen -> published | Status back to **Published**, **Close assignment** restored, Reopen absent, live update | canonical reopen via the UI button | PASS |
| 1d | O1 Branch B on a genuinely LMS-linked published assignment | Class "Sprint 28 LMS Classroom Grade 6", Status **Published**, **Close assignment** visible - no provenance-based suppression | LMS-provenance class (`enrollmentSource: lms`), published assignment | PASS |
| 2a | Late-recipient candidate surfaced | "Students not yet assigned" lists **Sprint 28 Student B**, **Add to assignment** present, keyboard focusable (tabIndex 0), aria-label "Add Sprint 28 Student B to this assignment" | `assignmentsRecipientCandidatesList` returns B (enrolled minus recipients) | PASS |
| 2b | Add in-flight | On activation the button text becomes **"Adding..."** and the button is **disabled** (duplicate activation prevented); a `role="status"`/`aria-live="polite"` region announces **"Adding..."** | add in flight | PASS |
| 2c | Add success | The live region announces **"Added to assignment."** (exact copy); the Add button is removed; the section reverts to "Every enrolled student is already assigned."; NO page reload; no Google-membership language | recipient `s28-student-b` written `assigned` source **`manualAddition`**; frozen population now A(classPublication)+B(manualAddition) | PASS |
| 4-closed | O5 closed informational state | Late-recipient panel: **"This assignment is closed. Reopen it to add students."** No candidate read, no Add path offered | status closed; candidates callable returns empty for non-published | PASS |

### Tier 1 - W2 v2 results + O3 return navigation (hosting emulator, URL-driven context)

Each lesson launched at `/app/lessons/lesson_<slug>.html?assignment=CERT-...`,
quiz filled via the real option-button click handlers and the Show Your
Thinking gate, and submitted via the real `<prefix>SubmitQuiz`. Geometry
read after an instant `scrollIntoView` (the smooth variant no-ops in this
headless pane, see §10). Sticky chrome measured live at the landed position.

| # | Lesson (grade, prefix) | scroll-margin-top | Board top | Chrome bottom | Score content clears chrome | Focus on results | role/aria-live/tabindex | Return -> /app/ | Result |
|---|---|---|---|---|---|---|---|---|---|
| 5/6/7/8/9 | earths-layers (G7, el) - Category A control - desktop 1280 | 120px | 120 | 121 | yes (score num 175) | yes | status/polite/-1 | shown | PASS |
| 6 | earths-layers - mobile 375 | 104px | 104 | 118 (wrapped nav) | yes (score num 159) | yes | status/polite/-1 | shown | PASS |
| 10 | earths-layers - no assignment param (negative) | n/a | rendered | n/a | practice score shown | n/a | present | **hidden** (display:none) + "Exploration mode..." | PASS |
| 11 | nature-of-waves (G6, nw) - diagram lesson | 90px | 90 | 121 | yes (score num 136) | yes | status/polite/-1 | shown | PASS |
| 12 | digital-signals (G6, ds) - newly migrated G6 | 120px | 120 | 121 | yes (score num 166) | yes | status/polite/-1 | shown | PASS |
| 13 | reproductive-success (G7, rs) - newly migrated G7 | 120px | 120 | 121 | yes (score num 175) | yes | status/polite/-1 | shown | PASS |
| 14 | photosynthesis (G7, el) - prefix collision | 120px | 120 | 121 | yes (score num 175) | yes | status/polite/-1 | shown | PASS |
| 15 | gravity (G6, grav) - divergent legacy shape | 90px | 90 | 118 | yes (score num 146) | yes | status/polite/-1 | shown | PASS |
| 16 | body-systems (G6, bs) - 15-question quiz | 120px | 120 | 163 | yes (score num 176) | yes | status/polite/-1 | shown | PASS |

Per-lesson certification notes:

- **Scenario 11 (nature-of-waves).** The quiz renders 2 SVG diagrams
  (Q5 / Q9); the Phase 5A.1 SVG-comment removal caused no visible loss.
  Assignment-aware submission scored 4/10 and revealed the hardened
  results. The one collapsed-layout reading first observed was traced to a
  transient 0-width browser viewport, not a lesson defect; after an
  explicit viewport reset the body renders at full width (1280) and the
  score board at 1100px.
- **Scenario 14 (photosynthesis).** Uses prefix `el`, the same prefix as
  earths-layers and ~16 other G7 lessons. Autosave-on-answer fired for all
  10 selections (`lessonQuiz.autosave` spy = 10), proving the reused-prefix
  assignment-context autosave wiring is intact; context detection,
  finalize, focus, and the return control all work with the shared prefix.
- **Scenario 15 (gravity).** Selected as the divergent legacy shape: it is
  one of only 3 lessons (with earths-place-in-the-universe and
  sun-earth-moon) that carry the legacy localStorage student-info block,
  and uses the non-standard prefix `grav`. The v2 artifact shows **no**
  legacy Practice/Classroom toggle and **no** legacy student-info form
  (the localStorage apparatus is correctly V1-ONLY); it behaves like the
  standard v2 contract.
- **Scenario 16 (body-systems).** 15 questions render (60 option buttons =
  15x4); the scoring denominator reflects 15 (score "10/15"); submission
  completes and the results surface behaves correctly.
- **Offset variation (observation, not a defect).** The W2 offset is not
  uniform: earths-layers / digital-signals / reproductive-success /
  photosynthesis / body-systems use 120px; nature-of-waves and gravity use
  90px. In every measured case the score content clears the actual sticky
  chrome because the score board's own top padding (about 45px) absorbs
  any difference between the offset and the chrome height. No score heading
  or number was obscured on any lesson at any tested viewport.

### Tier 2 - W3 manual onboarding claims self-heal (O4) - deployed emulator callable

Exercised the actual deployed `studentsCompleteOnboarding` function over
HTTP with a genuine student ID token, against a real active Firestore
record and real Auth custom claims.

| Case | Claims before | Claims after | Record | 2nd activation | Result |
|---|---|---|---|---|---|
| A missing claims (empty) | `{}` | `{role:student, schoolId:school-beta, districtId:district-beta}` | stays `active` | none (audit delta 0) | PASS |
| B stale schoolId | `{role:student, schoolId:school-WRONG, districtId:...}` | corrected to `school-beta` (RECORD wins) | stays `active` | none | PASS |
| C healthy claims | `{role:student, schoolId:school-beta, districtId:district-beta}` | unchanged (no write) | stays `active` | none | PASS |

All three returned `alreadyActive: true`. The repair re-asserts exactly
the record's implied claims (no cross-school escalation - the client
cannot select a school), never re-activates, and is idempotent. This is
the O4 self-heal certified at the deployed-callable level (stronger than
the deterministic unit tests, which mock the SDK).

### Tier 2 - signed-out deep-link round trip regression

| # | Scenario | Observed | Result |
|---|---|---|---|
| 18 | Signed-out navigation to `/app/a/{assignmentId}` | App shell boots to the sign-in surface ("Sign in to LyfeLabz" / "Continue with Google"); the address bar **preserves** `/app/a/a-cell-types-...` (no redirect to `/` or `/app/signin`) | PASS |

The full round trip = this path preservation (certified here) + the
resolver rerun after authentication (Sprint 27 Phase 7 certified,
Sprint 28-unchanged) + `Back to My Assignments` after completion
(Tier 1 certified). The architecture is intact.

---

## 5. Negative assertions (all certified)

| Assertion | Where | Observed | Result |
|---|---|---|---|
| Non-assignment v2 does NOT show `Back to My Assignments` | Scenario 10 | No `assignment=` param -> `hasAssignmentContext()` false -> return control `display:none`; exploration-mode message shown; no submission | PASS |
| Closed lifecycle does not expose an invalid Add | Scenario 4-closed | Closed assignment shows the calm informational note, no candidate read, no Add control | PASS |
| No browser-back dependency after completion | Scenario 9 | `Back to My Assignments` is a native `<a href="/app/">`; activating it navigates to `/app/` (app shell), never the deep-link resolver `/app/a/{id}` | PASS |
| No v1 legacy chooser in the assignment-aware v2 flow | Scenarios 11-16 (esp. gravity) | v2 artifacts carry no `.quiz-mode-toggle` and no student-info form; silent assignment arrival | PASS |
| Frozen recipients not mutated by a later enrollment | Scenario 2 setup | Enrolling Student B after publish left recipients frozen to A; B appeared only as a candidate, added only by the explicit manual gesture | PASS |

---

## 6. O2 viewport matrix

- **Desktop (1280 wide).** `.score-board` scroll-margin-top honored exactly
  (board top lands at the declared offset). Sticky chrome = sticky nav
  (about 74px) + sticky quiz-progress bar (to about 121px). Score number
  and message land fully below the chrome on every lesson.
- **Mobile (375 wide, below the 600px breakpoint).** The 104px branch is
  active on earths-layers (scroll-margin-top computed 104px, board top 104).
  The mobile nav wraps to about 118px (7 links at 375px), so the board's top
  padding sits under the nav, but the score number (159px) clears the chrome
  and is fully visible. This wrap is a pre-existing mobile-nav trait, not a
  Sprint 28 regression.

Both implemented offset branches (desktop and phone) are proven.

---

## 7. Keyboard checks

- **Add to assignment** (O5): native button, tabIndex 0, keyboard focusable;
  activating it runs the real add and disables during the in-flight window.
- **Close / Reopen** (O1): native buttons rendered by `detail.ts`, operated
  and confirmed to toggle the lifecycle live.
- **Results focus** (O2): after submit, `document.activeElement` is the
  results region (`#<prefix>-score`), which carries `tabindex="-1"` so it is
  programmatically focusable but is NOT a normal Tab stop; `preventScroll`
  keeps the offset landing intact (focus does not add a second scroll).
- **Back to My Assignments** (O3): native `<a href="/app/">`, tabIndex 0,
  keyboard focusable, Enter-activatable; reachable by keyboard from the
  post-submit focus.

---

## 8. Accessible result semantics

Certified in the DOM / accessibility tree on every representative lesson:
the results region carries `role="status"`, `aria-live="polite"`, and
`tabindex="-1"`. The O5 add flow announces "Adding..." then "Added to
assignment." through a single `role="status"` / `aria-live="polite"`
region (no duplicate overlapping announcements). Actual screen-reader
speech was not driven by a real assistive technology in this pane; the
DOM/accessibility semantics are certified and the spoken announcement is
inferential from those standards-compliant attributes plus the
deterministic W2 contract.

---

## 9. Defects found / fixed

None. No Sprint 28 regression or defect was reproduced in the browser. The
one alarming reading during Scenario 11 (a collapsed, 92px-wide score
board on nature-of-waves) was root-caused to a transient zero-width
browser viewport (`window.innerWidth === 0`) after a preset resize, not to
the lesson: an explicit viewport reset restored full-width rendering and a
clean pass. No code changed; the deterministic Phase 6 baseline is
therefore untouched (see §12).

---

## 10. Limitations (browser tooling could not directly prove)

1. **Smooth-scroll animation.** This headless pane no-ops every
   `behavior:'smooth'` scroll (confirmed: `window.scrollTo({behavior:'smooth'})`
   and `scrollIntoView({behavior:'smooth'})` both leave scrollY unchanged).
   The results auto-scroll ON SUBMIT therefore could not be watched
   animating. The landing GEOMETRY it targets is certified via the instant
   `scrollIntoView` (board top lands exactly at the declared
   scroll-margin-top, below the chrome); in a production browser the smooth
   scroll animates to that same final position.
2. **Live sign-in gesture.** `signInWithPopup` is silently suppressed by
   this pane. The teacher session was established by injecting a real
   emulator-issued session into the app's own Auth persistence (genuine
   token, genuine `onAuthStateChanged` restore); only the click gesture is
   substituted. This does not affect the O1/O5 behaviors under test.
3. **Screen-reader speech.** DOM/accessibility semantics certified; actual
   spoken output is inferential (see §8). No screen-reader evidence is
   fabricated.
4. **O5 add failure / retry (Scenario 3).** A deterministic add failure
   could not be induced in the browser without artificial production-style
   Firestore manipulation, so it was not forced. It rests on the
   deterministic `late-recipient.test.ts` coverage (failure keeps the
   student eligible, re-enables the control, announces via `role="alert"`,
   clears the live region so no false success shows).
5. **O5 draft informational state (Scenario 4 draft).** The teacher UI
   publishes directly to `published`; a `draft` Assignment Detail is not
   reachable through a normal navigation path, so the draft note ("This
   assignment is a draft. Publish it before you can add students.") was not
   browser-driven. Its sibling `closed` note, which is rendered by the same
   `renderLateRecipientLifecycleNote` seam, IS browser-certified (Scenario
   4-closed), and the draft branch is covered by `late-recipient.test.ts`.
6. **Genuine student backend submission for Scenario 5.** The earths-layers
   O2/O3 CLIENT behavior is fully certified (Tier 1). The genuine
   student-authenticated backend finalize -> persisted scored attempt was
   already certified in Sprint 27 Phase 7 (Path A/B, real attempts) and is
   Sprint 28-unchanged; Sprint 28's only delta on that path is the
   client-side O2/O3, certified here.

None of these is a Sprint 28 behavior gap; each is a pane/tooling boundary
with the deterministic evidence that covers it.

---

## 11. External-state boundary

No production Firebase mutation. No real Google Classroom call. No OAuth
grant change. No assessment revision deployed. No production Hosting,
Functions, or Rules deploy. The only Firestore writes were to the local
in-memory Firestore emulator; the only Auth writes were to the local Auth
emulator. The curriculum manifest was not touched. The committed runtime
asset was not rebuilt.

---

## 12. Deterministic baseline after browser work

Phase 7 changed no production source, test, lesson artifact, launch
override, payload, or manifest file. HEAD is `425f667`; the working tree
is the same 259 paths as the Phase 6 baseline; nothing is staged. The
functions and app rebuilds wrote only to gitignored `lib/` and `dist/`.
Therefore the Phase 6 deterministic baseline remains valid without a
re-run:

- App: 68 suites / 1,888 tests / 1,887 passed, the single red being the
  known `curriculumManifest.test.ts` `#how` SHA drift (Sprint 29-owned).
- Functions: 91 suites / 1,708 tests / 0 failures.
- Rules: 18 suites / 228 tests / 0 failures.
- Lessons: `lessons:build` zero drift, `lessons:verify` 49/49.
- W2 contract 49 / 539 green; assessment fidelity 49 / 248 green.

The known manifest exception is unchanged and remains Sprint 29-owned.

---

## 13. Final disposition

**Sprint 28 Phase 7: COMPLETE AND CERTIFIED WITH DOCUMENTED LIMITATIONS.**

Every Sprint 28-new browser-only behavior is certified: the O1 Assignment
Detail lifecycle on both manual and LMS-linked assignments (closing the
Sprint 27 O1 limitation), the O5 late-recipient add success / in-flight /
closed-informational behavior, the O2 results scroll / focus / semantics
at both viewport branches across the W4 structural representative matrix,
the O3 return navigation (positive and negative), the W3 onboarding
claims self-heal at the deployed callable, and the signed-out deep-link
path-preservation regression. No Sprint 28 defect was found. All
limitations are tooling boundaries backed by deterministic evidence.

Sprint 28 remains uncommitted until Chris reviews, and remains NOT
production deployed. Sprint 29 owns the final manifest regeneration,
assessment deployment, production deployment, Google/OAuth release items,
and Teacher Platform v1 release certification.

*End of Sprint 28 Phase 7 record.*
