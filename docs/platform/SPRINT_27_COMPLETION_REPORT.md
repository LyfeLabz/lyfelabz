# Sprint 27 - Completion Report (Student Classroom Lifecycle Completion & Certification)

Status: COMPLETE AND CERTIFIED, pending production release (Sprint 29).
This is the canonical Sprint 27 completion and certification record. It
consolidates the implementation (Phases 2 through 5), the deterministic
validation (Phase 6), the browser and emulator certification (Phase 7),
and the narrow live Google provider certification (Phase 8) into one
disposition. It does not rewrite Sprint 24, 25, or 26 history, it does not
reopen Sprint 25 B13, and it authorizes no production deployment. Sprint 27
is entirely uncommitted and undeployed; the human reviewer will commit it
manually.

Style: no em dashes. " - " is the sentence break, per repository standard.

Companion documents:
- `SPRINT_27_DEFINITION.md` (scope of record)
- `SPRINT_27_ARCHITECTURAL_BLUEPRINT.md` (Phase 1 architecture)
- `SPRINT_27_IMPLEMENTATION_PLAN.md` (ordered phases; Phase statuses reconciled)
- `SPRINT_27_PHASE_6_VALIDATION_REPORT.md` (deterministic validation)
- `SPRINT_27_PHASE_7_BROWSER_CERTIFICATION.md` (browser and emulator certification)
- `SPRINT_27_PHASE_8_LIVE_PROVIDER_CERTIFICATION.md` (live Google provider certification)
- `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` (phase and v1 release sequence)

---

## 1. Final disposition

**SPRINT 27 COMPLETE AND CERTIFIED WITH DOCUMENTED LIMITATIONS - READY FOR
HUMAN REVIEW AND COMMIT.**

Every Sprint 27 exit criterion (definition §17) is satisfied and recorded
with appropriately classified evidence. Paths A through D and all three
required negative assertions passed in the browser against emulated backend
state; the Firestore Rules suite passed standalone (228/228); the single
live Google boundary that could not be responsibly faked passed against the
real linked Google Classroom course. One genuine Sprint 27 implementation
defect (D1, the deep-link route could not load the app bundle) was found
during certification and corrected within scope; the correction was
re-certified in the browser. The documented limitations are non-blocking
and are Sprint 28 items: O1 (a pre-existing teacher "Close assignment" UI
gap on the Classroom-linked Assignment Detail) and O2 (a v2 post-submission
results scroll position). Neither weakens the certified Sprint 27 standard.

Production status: not deployed. The `/app/a/{assignmentId}` resolver route
resolves live only after the Sprint 27 release is deployed, which Sprint 29
owns.

## 2. Mission

Close the student side of the classroom lifecycle:

```
teacher assigns
  -> student receives / accesses the assignment
  -> student completes the assessment
  -> student sees results
  -> teacher sees the submission
```

For Google Classroom-linked classes, additionally establish safe LMS
student onboarding without a join code, server-mediated activation derived
from canonical enrollment, an assignment-aware deep link, server-
authoritative deep-link authorization, frozen-recipient preservation,
explicit late-recipient recovery, a signed-out deep-link auth round trip,
and real Google acceptance of the server-generated assignment-aware URL.

Sprint 27 is not a student-platform rebuild and is not the production-
release sprint. It preferred narrow wiring and integration over new backend
feature families.

## 3. Scope delivered

- **Student My Results (Workstream A, Phase 2).** The PDR-024i second
  student surface, wired over the existing caller-scoped
  `assessmentAttemptsList` read with client-side single-student self-
  aggregation: best score, attempt count, the four accessible status
  indicators (Ready to Begin, Improving, Well Done!, Perfect Score, shown
  by icon plus text and never color alone), and Improve My Score on every
  less-than-perfect best score. No rollup backend was built.
- **LMS student onboarding and activation (Workstream B, Phase 3).** A new
  server-mediated `studentsCompleteLmsOnboarding` callable that activates a
  Google-Classroom-rostered student without a manual join code, gated on a
  server-found active enrollment in an `enrollmentSource === "lms"` class,
  deriving school and district from server state only, with a forced token
  refresh after activation.
- **Assignment-aware Google Classroom deep link (Workstream C, Phase 4).** A
  server-owned URL builder (`buildAssignmentDeepLinkUrl`), the read-only
  `lmsDeepLinkResolve` resolver, the `/app/a/{assignmentId}` arrival route
  and client, and removal of the client-supplied `lyfelabzAssignmentUrl`
  destination from the publish contract.
- **Late-recipient teacher affordance (Decision 3, Phase 5).** A minimal,
  additive "Students not yet assigned" section on Assignment Detail, backed
  by a new teacher-scoped `assignmentsRecipientCandidatesList` read and the
  certified, unchanged `assignmentsRecipientAdd` (`source: "manualAddition"`),
  one student at a time, no bulk gesture.
- **Full lifecycle certification (Workstream D, Phases 7 and 8).** Path A
  (manual class) and the LyfeLabz-controlled portions of Path B (Classroom-
  linked class) certified as integrated browser and emulator flows, plus one
  narrow live Google `courses.courseWork.create` acceptance of the server-
  built deep-link URL.

## 4. Architecture delivered

- **My Results read.** Caller-scoped `assessmentAttemptsList` (query scoped
  `where("studentId", "==", uid)` from verified claims only), projected to
  exclude answer keys, `itemResults`, and `responses`; all grouping, best-
  score selection (highest percentage, tie-break higher `attemptNumber` then
  later `submittedAt`, mirroring PDR-029a and PDR-029b), counting, and status
  derivation happen on the client over the single caller's own attempts. No
  `attemptRollups` or `assignmentRollups` were built (blueprint §5.3 records
  this as a safe interpretation of PDR-026f under the ratified bounded-pilot
  direct-query posture, PDR-029m and PDR-029n).
- **LMS activation.** `studentsCompleteLmsOnboarding` accepts only an
  optional `displayName`; every authority-bearing field is refused with
  `students.forbiddenField` before any read; `schoolId` derives from the LMS
  class record and `districtId` from the school record; activation writes
  only through the canonical `writeCustomClaims` and emits `students.activated`
  with a PII-free `payload: { source: "lms" }`. An idempotent claims self-heal
  repairs the non-atomic activation seam (record active, then claims, then
  audit) on replay. The manual `studentsCompleteOnboarding`,
  `enrollmentsJoinByCode`, `reconcileMyExternalIdentity` (kept identity-only,
  unwired), and `BETA_SCHOOL_ID` are unchanged.
- **Deep-link URL.** The sole producer `buildAssignmentDeepLinkUrl` emits
  exactly `https://app.lyfelabz.com/app/a/{assignmentId}` from a fixed
  production origin constant and refuses any non-canonical id
  (`deep-link-shape-invalid`); the id grammar admits no `:`, `/`, `?`, `#`,
  or `.`, so refusal of query, fragment, alternate host, scheme, lesson slug,
  or extra identifier is structural. `app.lyfelabz.com` is the current
  production host; PDR-027's `lyfelabz.com` origin is preserved as the future
  target reached only after the apex migrates from GitHub Pages to Firebase
  Hosting (blueprint §8.1), at which point the single constant moves with no
  other change.
- **Deep-link route and resolver.** `/app/a/{assignmentId}` is a single
  `/app/**` arrival route served by the existing `/app/** -> /app/index.html`
  rewrite. `lmsDeepLinkResolve` runs the PDR-027 §10.1 authorization order
  (authenticated active student, same-school district boundary, published or
  closed status, active enrollment) with a recipient-aware `attemptContext`
  (`authorized` only for a published, classroom-mode, open-window, canonical
  recipient; every other resolvable state `informational`). It is read-only
  against LyfeLabz domain state, writes exactly one best-effort success audit
  event and nothing on refusal, and never calls Google or reads an OAuth
  token. Session creation remains the sole responsibility of
  `assessmentSessionsBegin`.
- **Late recipient.** Publication freezes the recipient population; roster
  sync, onboarding, and deep-link possession never mutate it. The only
  extension is the teacher's explicit one-at-a-time `assignmentsRecipientAdd`
  (`manualAddition`, append-only, idempotent, published-only), surfaced by the
  additive Assignment Detail affordance backed by the server-side set-
  difference `assignmentsRecipientCandidatesList`.
- **Auth round trip.** The arriving `/app/a/{assignmentId}` URL is preserved
  across sign-in through browser history alone (no `localStorage`,
  `sessionStorage`, cookie, or token), and the client re-invokes the resolver
  after authentication. No arbitrary external `returnUrl` is introduced.

## 5. Security and privacy invariants (preserved)

- **Caller-scoped student reads only.** My Results never accepts a
  `studentId`, never reaches the class-scoped teacher callable
  (`assessmentAttemptsListForClass`), and computes no cross-student
  aggregate. No answer-key material crosses the boundary.
- **Server-authoritative LMS onboarding.** No client-supplied `schoolId`,
  `districtId`, `classId`, provider account id, or Classroom identifier is
  trusted; enrollment is read, never created, on this path; manual join-code
  behavior is unchanged; multi-school resolution fails closed.
- **Server-owned Classroom destination.** The client cannot influence the
  coursework URL; the `lyfelabzAssignmentUrl` field is removed from the
  publish contract and any residual client value is ignored.
- **URL possession is never authorization.** The resolver authorizes server-
  side on identity, district/school, enrollment, and recipient state, and is
  read-only; enrollment and recipient enforcement remain load-bearing and are
  independently re-enforced by `assessmentSessionsBegin`.
- **Frozen-recipient semantics preserved** (PDR-029d, PDR-029h, PDR-029l).
  Late enrollment alone never joins a frozen population; only the teacher's
  explicit `manualAddition` extends it; no automatic or bulk addition exists
  anywhere.
- **District and school isolation** enforced at both the Functions layer
  (`requireDistrictContext` plus explicit `schoolId` checks) and the
  unchanged Firestore rules layer.
- **No secret or PII exposure.** No OAuth token, refresh token, client
  secret, student PII, Google identity, session id, score, or Classroom
  identifier appears in any URL, resolution payload, audit event, log line,
  or client surface. The deep-link URL carries only the opaque `assignmentId`.

## 6. Deterministic validation (final, this closeout)

- **Functions:** typecheck clean, lint clean, **91 suites, 1699 tests, 0
  failures** (exit 0).
- **App:** typecheck clean, lint clean, **65 suites (64 passed, 1 failed),
  1092 tests (1091 passed, 1 failed)**. The single failure is
  `src/curriculum/curriculumManifest.test.ts` - the known curriculum-manifest
  SHA drift between the repository-root `index.html` and
  `app/src/curriculum/curriculum.manifest.json`. It is a declared Sprint 27
  non-goal (definition §14) and a Sprint 29 item. Confirmed unrelated to
  Sprint 27: both the root `index.html` (last touched 2026-07-30) and the
  manifest (2026-07-28) are untouched by the Sprint 27 working tree; Sprint
  27's only `index.html` edit is to the separate app-shell file
  `app/index.html` (D1). It is NOT a Sprint 27 regression.
- **Firestore rules:** unchanged since Sprint 25 (commit `9b073ed`,
  `firestore.rules` carries no uncommitted change), so no rules regression is
  possible. The Phase 7 standalone run remains applicable: **18 suites, 228
  tests, 0 failures**. Not re-run this closeout because nothing changed.

These counts match the Phase 6 and Phase 7 evidence exactly; no source
changed between certification and closeout.

## 7. Browser and emulator certification (Phase 7)

Disposition: PHASE 7 BROWSER CERTIFIED WITH LIMITATION. Emulated backend,
project `lyfelabz-prod`; app served from the Hosting emulator so the
`/app/a/{id}` rewrite is exercised; Google provider boundary supplied through
seeded canonical records where no runtime provider test double exists.

- **Path A - Manual class.** Full teacher -> student -> teacher loop:
  teacher sign-in, manual class and join code, student genuine first sign-in
  and join-code enrollment and activation, assignment publication with frozen
  recipients, silent v2 assessment-aware runtime arrival and a persisted
  scored attempt, My Results aggregation with the correct status indicator and
  Improve My Score, and the teacher seeing the same attempt. PASS.
- **Path B - Classroom-linked class.** Provisioned LMS student onboarding
  without a join code, the server-built deep-link URL, and authorized silent
  deep-link arrival -> assessment runtime -> persisted attempt -> My Results.
  The Google roster boundary was represented through canonical seeded output
  (no runtime provider test double exists); the new Sprint 27 behavior
  (onboarding, resolution) was genuinely exercised in the browser. PASS
  (LyfeLabz-controlled chain).
- **Path C - Late enrollment.** Active enrollment but not a recipient ->
  informational deep-link response -> no session or attempt -> explicit
  teacher Add to Assignment (`source: manualAddition`) -> resolver flips to
  authorized. PASS.
- **Path D - Signed-out deep-link round trip.** Signed-out `/app/a/{id}` ->
  Google/Firebase sign-in with the URL preserved in browser history ->
  post-auth resolver rerun -> authorized return to the intended assignment
  destination. PASS.
- **Negative assertions (all PASS).** (1) provisioned-before-sync student
  refused safely, no activation; (2) enrolled non-recipient receives an
  informational state and cannot launch (0 sessions, 0 attempts); (3) closed
  assignment receives an informational state and cannot create an
  attempt/session (closed through the canonical `assignmentsClose` callable;
  see O1).

## 8. Live Google provider certification (Phase 8)

Disposition: PHASE 8 LIVE PROVIDER CERTIFIED. A single genuine
`courses.courseWork.create` against the real linked Google Classroom course
accepted the server-built deep-link URL and returned a real coursework
record; a live read-back confirmed the stored `materials[0].link.url` is
exactly the server-built URL.

- **Google Classroom course:** `871447706346` (the established Sprint 25/26
  certification course; no new course; no real student roster).
- **LyfeLabz class:** `3la0b7o2jgw03cfzebw5` (`enrollmentSource: lms`, active,
  linked to course `871447706346`).
- **Certification assignment:** `Sprint 27 Deep Link Certification`, assignment
  id `s27cert-deeplink-1` (lesson `cell-types`, classroom mode).
- **Server-built destination (exact, non-secret):**
  `https://app.lyfelabz.com/app/a/s27cert-deeplink-1`.
- **Returned coursework id:** `875115775254`; publication record
  `s27cert-deeplink-1__googleclassroom__6687e707` status `succeeded`; exactly
  one `lms.assignmentPublished` audit event, no token or PII.
- **OAuth state:** existing publication authorization was sufficient; no OAuth
  widening and no reconnection; no account chooser (no OAuth flow initiated);
  Sprint 25 B13 not reopened; no grant manipulated.
- **Cleanup:** the temporary coursework `875115775254` is retained as
  certification evidence, following the Sprint 25/26 convention.

## 9. Defects found and corrected

### D1 (CONFIRMED, CORRECTED) - deep-link route could not load the app bundle

Discovered at Path B step B7 (and it equally blocked Path D). The app shell
`app/index.html` referenced its bundle with a relative path
(`./dist/bundle.js`). The `/app/a/{assignmentId}` arrival route is the first
two-segment route under `/app/`; served via the `/app/** -> /app/index.html`
SPA rewrite, the document base URL is `/app/a/{id}`, so `./dist/bundle.js`
resolved to `/app/a/dist/bundle.js`, which the same rewrite answered with
HTML instead of the bundle, and the app never booted. The identical rewrite
exists in production, so the entire deep-link feature would have failed in
production (severity: high). Corrected narrowly and depth-independently to an
absolute path: `src="/app/dist/bundle.js"` (one line, no logic change, no
bundle rebuild, no regression on the existing one-segment routes). The
corrected route was re-certified in the browser (the bundle loads, the app
boots, and the signed-out arrival preserves the `/app/a/{id}` URL), and the
deterministic app suite was re-run (1091 passed, 1 failed = only the pre-
existing manifest drift). This correction is part of Sprint 27 and remains.

No other defect required correction. Phase 8 required no code change, so the
Phase 6 and Phase 7 deterministic evidence remained current.

## 10. Known limitations and Sprint 28 handoff

- **O1 - Close Assignment UI (Sprint 28).** The teacher-facing "Close
  assignment" lifecycle control (Sprint 13D) did not render on the
  Classroom-linked Assignment Detail for the cert teacher. This is a pre-
  existing Assignment Detail behavior, not a Sprint 27 regression: Sprint 27's
  `detail.ts` change is purely additive (256 insertions, 0 deletions; it added
  only the "Students not yet assigned" section and never touched the lifecycle
  or close rendering). The backend lifecycle callable works and the closed
  deep-link negative was certified through the canonical `assignmentsClose`
  callable. Sprint 28 should confirm and restore/polish the close (and reopen)
  lifecycle controls for LMS-sourced published assignments.
- **O2 - v2 assessment result scroll (Sprint 28 / v2 migration standard).**
  After a student submits a v2 assessment, the results view can retain an
  incorrect vertical scroll position so the top of the score/results area is
  cut off and the student must scroll up. Sprint 28 / the v2 migration
  standard should ensure that on submission the viewport and focus move to the
  top of the results content so the full score and submission confirmation are
  immediately visible.
- **Manual-onboarding claims self-heal (Sprint 28).** The manual
  `studentsCompleteOnboarding` path shares the same non-atomic activation seam
  (record active, then custom claims, then audit) that Phase 3 self-healed for
  LMS onboarding. It was intentionally left unchanged in Sprint 27 and is
  deferred to Sprint 28 pre-release hardening.
- **Late-recipient UX and Assignment Detail polish (Sprint 28).** Teacher-
  facing late-recipient UX beyond the narrow "Students not yet assigned"
  affordance, and broad Assignment Detail cohesion polish.
- **Curriculum-manifest SHA drift (Sprint 29).** Repaired as part of the final
  deterministic baseline; explicitly out of Sprint 27 scope.
- **Google OAuth verification and Data Access disposition (Sprint 29).** The
  level-E production gate; may be started operationally in parallel but does
  not gate Sprint 27.
- **Client-supplied `schoolId` on the manual path (post-v1).** The generalized
  trust-boundary concern; out of Sprint 27 scope; the LMS path deliberately
  does not inherit it.

## 11. Working tree reconciliation (Phase 9 Task 1)

Every changed and new source, test, and documentation file maps to a Sprint
27 phase. No unrelated or pre-existing code change is absorbed into the
Sprint 27 claim.

- **Production source (modified):** `app/index.html` (D1),
  `app/src/assignments/detail/detail.ts` (late-recipient section),
  `app/src/assignments/studentList/launch.ts` (behavior-preserving
  `buildLessonBasePath` extraction), `app/src/index.ts` (per-session wiring),
  `app/src/router/surfaces/index.ts` (My Results + LMS onboarding surfaces),
  `app/src/settings/integrations/types.ts`,
  `app/src/shell/surfaces/curriculum.ts`,
  `app/src/shell/surfaces/shared/lmsPublication.ts` (deep-link contract),
  `platform/functions/src/assignments/index.ts`,
  `platform/functions/src/index.ts`, `platform/functions/src/lms/index.ts`,
  `platform/functions/src/lms/assignments-publish.ts` (server-built URL),
  `platform/functions/src/shared/auth/claims.ts` (`readCustomClaims`),
  `platform/functions/src/shared/index.ts`,
  `platform/functions/src/shared/types/audit-event.ts`
  (`lms.deepLinkResolved`), `platform/functions/src/students/index.ts`.
- **Production source (new):** `app/src/assignments/deepLink/*` (arrival
  route/client), `app/src/assignments/studentResults/*` (My Results),
  `app/src/assignments/detail/late-recipient-wire.ts`,
  `platform/functions/src/assignments/assignments-recipient-candidates.ts`,
  `platform/functions/src/lms/deep-link-resolve.ts`,
  `platform/functions/src/lms/deep-link-url.ts`,
  `platform/functions/src/students/students-complete-lms-onboarding.ts`.
- **Tests (modified/new):** the matching `*.test.ts` for each of the above,
  plus `surfaces.test.ts`, `shell.test.ts`,
  `curriculum.lms-publish.test.ts`, `lmsPublication.test.ts`,
  `assignments-publish.test.ts`, and `claims.test.ts`. The two one-line test
  removals (`shell.test.ts`, `curriculum.lms-publish.test.ts`) drop the removed
  `lyfelabzAssignmentUrl` field.
- **Documentation:** the six Sprint 27 documents and this completion report;
  the roadmap and implementation-plan reconciliation described in §12.
- **Hygiene (this closeout):** one line added to `.gitignore` -
  `platform/firebase/*-snapshot-*/` - so the Phase 7 emulator safety snapshot
  `platform/firebase/sprint26-pathb-live-snapshot-2026-08-19/` (which contains
  `auth_export/accounts.json` test-identity data) cannot enter the commit set.
  It escaped the existing `*-export/` and `*-cert-state/` globs only because
  its name ends in a date. The Sprint 27 certification export directories
  (`sprint27-cert-state`, `sprint27-phase8-cert-state`) were already gitignored
  by `*-cert-state/`.

Nothing is staged, nothing is committed, nothing is pushed, and nothing is
deployed.

## 12. Documentation updated during closeout

- **Created:** `docs/platform/SPRINT_27_COMPLETION_REPORT.md` (this report).
- **Updated:** `docs/platform/TEACHER_PLATFORM_DOMAIN_ROADMAP.md` - Sprint 27
  moved from "Defined (planned), not started" to complete and certified, with
  a pointer to this report; Sprint 28 and Sprint 29 sequence preserved.
- **Updated:** `docs/platform/SPRINT_27_IMPLEMENTATION_PLAN.md` - Phase 9
  marked complete and the final phase statuses reconciled.
- **Hygiene:** `.gitignore` (see §11).

## 13. Production status

Not deployed. Sprint 27 is entirely uncommitted and undeployed; HEAD is
`76f0162`. Google accepted the server-built URL as coursework link material
(Phase 8), but the `/app/a/{assignmentId}` resolver route resolves live only
after the Sprint 27 release is deployed. Production deployment and final v1
production certification are out of Sprint 27 scope and belong to Sprint 29.

## 14. Release sequencing

The v1 release sequence is preserved:

- **Sprint 27 - Student Classroom Lifecycle Completion & Certification**
  (this report): complete and certified with documented limitations.
- **Sprint 28 - Teacher Workflow & UX Polish + Pre-Release Hardening.**
  Carries O1, O2, the manual-onboarding claims self-heal, late-recipient UX,
  and broad Assignment Detail cohesion polish.
- **Sprint 29 - Teacher Platform v1 Release Certification.** Curriculum-
  manifest SHA drift repair, the Google OAuth verification and Data Access
  disposition, production deployment, and final v1 production certification.

No Sprint 30 is planned; work after Sprint 29 is driven by classroom
feedback, defects, or a deliberately chosen feature family.

## 15. Certification disposition

**SPRINT 27 COMPLETE AND CERTIFIED WITH DOCUMENTED LIMITATIONS - READY FOR
HUMAN REVIEW AND COMMIT.**

*End of Sprint 27 completion report.*
