# Sprint 27 Phase 7 - Browser & Emulator Certification

Status: IN PROGRESS. Interactive browser and emulator certification of the
LyfeLabz-controlled Sprint 27 classroom lifecycle against local emulated
backend state. No live Google provider certification is performed here (that
is Phase 8). No production changes; nothing staged, committed, pushed, or
deployed. All Sprint 27 implementation remains uncommitted.

Companion documents: `SPRINT_27_DEFINITION.md`,
`SPRINT_27_ARCHITECTURAL_BLUEPRINT.md`, `SPRINT_27_IMPLEMENTATION_PLAN.md`,
`SPRINT_27_PHASE_6_VALIDATION_REPORT.md`.

Style: no em dashes. Use " - " (spaced hyphen) as the sentence-level break.

---

## 1. Environment

- **Emulator suite** (project `lyfelabz-prod`, singleProjectMode): Auth
  `127.0.0.1:9099`, Firestore `127.0.0.1:8080`, Functions `127.0.0.1:5001`,
  Hosting `127.0.0.1:5000`, Storage `127.0.0.1:9199`, UI `127.0.0.1:4000`.
  Started from `platform/firebase` with `--export-on-exit ./sprint27-cert-state`.
- **App code under test:** freshly built this session. `platform/functions`
  rebuilt (`npm run build`) so `lib/` carries every Sprint 27 callable
  (`lmsDeepLinkResolve`, `studentsCompleteLmsOnboarding`,
  `assignmentsRecipientCandidatesList`, plus the caller-scoped
  `assessmentAttemptsList` wrapper's backend). `app` rebuilt
  (`npm run build`) so `dist/bundle.js` carries the My Results surface, the
  `/app/a/{id}` arrival client, and the LMS-onboarding affordance. Functions
  emulator confirmed loading all Sprint 27 definitions with no load error.
- **App URL:** `http://localhost:5000/app/index.html` (Hosting emulator; the
  `/app/** -> /app/index.html` rewrite is active, so `/app/a/{assignmentId}`
  deep-link routes resolve to the SPA). `localhost` satisfies the client
  `isEmulatorHost` predicate, so the browser talks to the emulators, never
  production.
- **Seed provenance:** `node platform/functions/seed-emulator.js` +
  `verify-seed.js` (ALL PRESENT). Baseline: `districts/district-beta`,
  `schools/school-beta`, 4 cert teachers (`cert-teacher-001..004`, all
  `role: teacher`, school-beta, district-beta, each with a synthetic
  google.com provider link), `lmsProviders/googleClassroom`, and 3 deployed
  cert assessments for lesson slugs `what-is-life`, `cell-types`,
  `biological-evolution`. classes / enrollments / assignments /
  externalIdentities / assessmentSessions / attempts / auditEvents all
  start empty (clean Sprint 27 slate).
- **Sprint 26 state preservation:** the pre-existing Sprint 26 Path B
  emulator (on port 8080, importing `sprint26-pathb-cert-state`) was first
  snapshotted live to `platform/firebase/sprint26-pathb-live-snapshot-2026-08-19`,
  then stopped. On-disk Sprint 25/26 exports are untouched. Sprint 27 uses
  its own separate `sprint27-cert-state` export dir.
- **Rules suite (Phase 6 deferral):** run this session with port 8080 free,
  `npm --prefix platform/firebase run test:rules`. Result: **18 suites, 228
  tests, 0 failures** (exit 0). Sprint 27 changed zero rules.

Certification identifiers use opaque cert accounts and "Sprint 27 ..."
labels. No real student PII is used.

---

## 2. Disposition

**PHASE 7 BROWSER CERTIFIED WITH LIMITATION - READY FOR LIVE PROVIDER
CERTIFICATION.**

Paths A, B (LyfeLabz-controlled chain), C, and D all PASS in the browser with
matching backend evidence; all three required negative assertions PASS; the
Firestore Rules suite passed (228/228). One Sprint 27 implementation defect was
found and corrected during certification (D1 - the deep-link route could not
load the app bundle); the corrected build was re-verified in the browser and
the deterministic app suite was re-run. The single limitation is O1 (a
pre-existing teacher "Close assignment" UI gap on the Classroom-linked
Assignment Detail, out of Sprint 27 scope), which only affected the *method* of
the closed-assignment negative (closed via the canonical `assignmentsClose`
callable instead of a UI button); the Sprint 27 resolver behavior itself was
certified. The live Google `courseWork.create` boundary remains for Phase 8, as
designed.

---

## 3. Path A - Manual LyfeLabz class

Class under test: `classes/7xabyndr2xdfl3990rkx` "Sprint 27 Manual"
(teacher `cert-teacher-001`, school-beta, joinCode `E823A91A`, manual).
Student: `s27-student-a@lyfelabz-cert.example`, uid
`vCHuVSL961J4bOcMwHuWVqd6pIoN`.

| Step | Browser action | Observed UI | Backend evidence | Result |
|---|---|---|---|---|
| A1 | Sign in as cert teacher via Auth emulator | Lands on `/app/teacher`, Curriculum surface, left nav Curriculum/Classes/Present Mode/Settings | No new state; still 4 users, 0 externalIdentities (imported teacher does not re-fire provisioning) | PASS |
| A2 | Classes -> create "Sprint 27 Manual" -> active | Class active, join code `E823A91A` | `classes/7xabyndr2xdfl3990rkx`: teacher cert-teacher-001, school-beta, status active, manual | PASS |
| A3+A4 | Student first sign-in (fresh Google acct via Auth emulator) then join-code onboarding | Active student surface "Welcome, Sprint 27 Student A" with the PDR-024i **My Assignments / My Results** two-surface menu; My Assignments empty state | `users/vCHuVSL...` role student/school-beta/active; claims role/schoolId/districtId all set; `enrollments/{classId}__{studentId}` active; audit chain `auth.userProvisioned` -> `classes.created` -> `enrollments.created` -> `students.activated` | PASS |
| A5 | Teacher assigns Earth's Layers (v2 lesson) to Sprint 27 Manual, classroom mode | Publication success | `assignments/a-earths-layers-...-3drmb7squm6ks` published, revision `assessment_earths-layers__r1`; recipients frozen `recipients/vCHuVSL...` source `classPublication` status `assigned` (PDR-029d) | PASS |
| A6 | Student My Assignments | "Earth's Layers" card with "○ Ready to Begin" status indicator (icon + text, PDR-024l) and Open assignment | Recipient-gated `assignmentsListForStudent` read; no mutation | PASS |
| A7 | Open assignment -> complete -> submit | **Silent v2 arrival, no Practice/Classroom toggle** (PDR-024h); scored 2/10; "SUBMITTED TO YOUR TEACHER"; Try Again offered | `attempts/...__vCHuVSL...__a1`: student/assignment/class correct, school-beta/district-beta, attemptNumber 1, score 2 / maxScore 10 / percentage 20, server-rescored itemResults, submittedAt set; audit `assessment.sessionBegan` -> `assessment.attemptFinalized`; session cleaned up on finalize | PASS |
| A8 | My Results tab | Earth's Layers card: "◑ Improving" (icon+text), Best score 2/10, 1 attempt completed, **Improve My Score** offered (best < 100%, PDR-024k) | Caller-scoped `assessmentAttemptsList`; single-student self-aggregation | PASS |
| A9 | Teacher Assignment Detail | Summary Total 1 / Completed 1 / Completion 100% / Average-Highest-Lowest 20% / Perfect Scores 0; Roster Submitted (1) Sprint 27 Student A 20% | Teacher-scoped read reflects the same attempt (2/10 = 20%) | PASS |

**Path A verdict: PASS.** The complete manual teacher -> student -> teacher
lifecycle is certified as one integrated browser + emulator flow: teacher
sign-in, manual class, student genuine first sign-in and join-code enrollment
and activation, assignment publication with frozen recipients, student silent
v2 assignment-aware runtime arrival and a persisted scored attempt, My Results
aggregation with the correct status indicator and Improve My Score, and the
teacher seeing the same attempt. Backend evidence matched the UI at every
step. No cross-student data, no answer keys, and no recipient/enrollment
bypass were observed.

**Certification-setup finding at A7 (not a defect, corrected).** Opening the
published `what-is-life` assignment launched the **v1** public artifact
`lesson_what-is-life.html?assignment=<id>`, which shows the legacy
Practice/Classroom `.quiz-mode-toggle` rather than entering the assessment
context silently. Investigation confirmed this is expected canonical
behavior, not a Sprint 27 defect: `buildAssignmentLaunchUrl`
(`app/src/assignments/studentList/launch.ts`) correctly consults the Sprint 18
override table (`launchOverrides.ts`), which lists only `earths-layers`,
`plate-tectonics`, `water-cycle`, `earthquakes` as having v2 authenticated
artifacts. `what-is-life` is v1-only, so it resolves to the v1 URL by design
(re-affirmed in blueprint §3.2), and the v1 artifact retains the toggle
(`lesson_what-is-life.html:472`, `:2642`). The v2 artifact
`app/lessons/lesson_earths-layers.html` has no toggle and forwards silently to
the certified backend on `?assignment=` (its lines 2000-2097). Root of the
mis-setup: the seed deployed assessments only for v1 lessons. Correction (no
code change): deployed the `earths-layers` assessment into the emulator
(`node lib/scripts/deploy-assessment.js --file=src/scripts/assessments/earths-layers.r1.json`
-> `assessment_earths-layers__r1`) and re-ran A5+ with Earth's Layers, the one
v2 override lesson with an assessment payload. The `what-is-life` publication
is left in place (a valid v1 manual assignment) and is not used for the
attempt loop.

**Environment finding (not a defect, recorded).** On the student's first
sign-in `authOnUserCreate` provisioned the user but logged
`identity.bridgeSkippedMalformed` and wrote no `externalIdentities` bridge.
Root cause: the Firebase Auth emulator delivers the `onCreate` background
event with the `google.com` provider entry's `uid` (the provider account id)
empty, so `extractSingleGoogleProviderAccountId` correctly refuses to guess
(`auth-on-user-create.ts`, Sprint 23C-I code, untouched by Sprint 27). Under
real Google the provider account id is populated at creation and the bridge
is written. This does not affect Path A (manual join-code enrollment needs no
bridge). For Path B it is accommodated through the documented server-side
recovery lane (`reconcileMyExternalIdentity` / emulator admin), which reads
the Auth record server-side where the provider account id is present; this
does not seed away the Sprint 27 behavior under certification (roster
resolution, enrollment, LMS onboarding activation).

## 4. Path B - Google Classroom-linked class

Class: `classes/s27-classroom` "Sprint 27 Classroom" (active,
`enrollmentSource: lms`, `lmsProviderRef: googleClassroom`, no join code,
teacher `cert-teacher-001`). Student B: `s27-student-b@lyfelabz-cert.example`,
uid `gi70TN...`.

**Google-boundary accommodation (where browser evidence ends).** No runtime
provider test-double transport exists (the roster sync engine reads the live
Google roster through the real adapter + `resolveLiveCredential`; confirmed by
inspection, consistent with the Sprint 25 finding). Per definition Path B and
the "seed provider/class records is acceptable" allowance, the following
Google-boundary records were seeded, each using the exact production write
shape: the LMS class + `lmsClassLinks` link (stand-in for
`lmsClassesImport`); the external-identity bridge via the production
`createOrConfirmExternalIdentity` write path (stand-in for the
`authOnUserCreate` bridge write the Auth emulator suppresses, see the §3
environment finding); and the active enrollment via the exact
`sync-engine.applyPlan` shape at the deterministic
`enrollmentIdFor(classId, uid)` id (stand-in for the roster-sync output). The
NEW Sprint 27 behavior was NOT seeded: Student B genuinely first-signed-in and
provisioned, and genuinely activated through `studentsCompleteLmsOnboarding`
and resolved through `lmsDeepLinkResolve` in the browser. Roster-sync
resolution is covered deterministically (Phase 6 Target F); the live Google
`courseWork.create` remains the sole Phase 8 boundary.

| Step | Browser action | Observed UI | Backend evidence | Result |
|---|---|---|---|---|
| B1 | (seed) LMS class | Teacher Classes shows "Sprint 27 Classroom" | `classes/s27-classroom` active, enrollmentSource lms, no joinCode | PASS (seed) |
| B2 | Student B first sign-in (fresh Google acct) | Provisioned onboarding screen showing manual join-code form AND "I'm in a Google Classroom class" affordance | `users/gi70TN...` provisioned, empty claims; google.com provider present; bridge skipped (emulator) | PASS |
| B3 (neg) | Click "I'm in a Google Classroom class" while provisioned-before-sync | Calm "Your class isn't ready in LyfeLabz yet. Ask your teacher to update the class roster, then try again." No activation, no leaked id/code | Still provisioned, empty claims, no enrollment | PASS |
| B4 | (seed) bridge + active LMS enrollment (roster-sync output) | n/a | `externalIdentities/fdd1a4...` active (source authOnUserCreate); `enrollments/s27-classroom__gi70TN...` active | PASS (seed) |
| B5 | Retry "I'm in a Google Classroom class" | Activated; landed on active student surface; no join code / class / school typed or selected | `users/gi70TN...` active role student school-beta; claims role/schoolId school-beta/districtId district-beta; audit `students.activated` `payload:{source:"lms"}` | PASS |
| B6 | Teacher assigns Earth's Layers to Sprint 27 Classroom, classroom mode | Publication success | `assignments/a-earths-layers-s27-classroom-...` published; recipients frozen `recipients/gi70TN...` source classPublication; server-built URL `https://app.lyfelabz.com/app/a/{assignmentId}` (via `buildAssignmentDeepLinkUrl`) | PASS |
| B7 | Navigate `/app/a/{assignmentId}` (signed in) -> complete -> submit | After D1 fix: silent arrival into Earth's Layers assessment (no picker, no toggle); scored 4/10; submitted; Try Again | audit `lms.deepLinkResolved` `payload:{attemptContext:"authorized",internalTarget:"assignmentLaunch"}`; `attempts/...__gi70TN...__a1` 4/10 correct scope | PASS (after D1) |
| B8 | My Results | Earth's Layers "◑ Improving", Best 4/10, 1 attempt, Improve My Score; Student A's result not shown (caller-scoped) | caller-scoped `assessmentAttemptsList` | PASS |

**Path B verdict: PASS (LyfeLabz-controlled chain).** Provisioned LMS student
onboarding without a join code (Decision 2), the server-built deep-link URL
(Decision 4 producer), and the authorized silent deep-link arrival ->
assessment runtime -> attempt -> My Results all certified in the browser. The
enrolled-non-recipient informational path is certified under Path C. The Google
roster read and `courseWork.create` are the only pieces not exercised live
(seed + deterministic evidence + Phase 8). Frozen-recipient population intact
throughout.

## 5. Path C - Late-enrollment recovery

Reuses the already-published `s27-classroom` Earth's Layers assignment
(recipients frozen to Student B at publication). Late student: Student C,
`s27-student-c@lyfelabz-cert.example`, uid `LjeeFx...`, who signs in and
enrolls AFTER publication. (Enrollment + bridge seeded as the roster-sync
output, per the Path B accommodation; activation, deep-link resolution, and the
teacher add are all genuine in-browser.)

| Step | Browser action | Observed UI | Backend evidence | Result |
|---|---|---|---|---|
| C1 | Student C first sign-in (fresh Google acct) | Provisioned onboarding | `users/LjeeFx...` provisioned, empty claims | PASS |
| C2 | (seed late enrollment) then LMS onboarding | Activated; My Assignments empty (not a recipient) | active enrollment `s27-classroom__LjeeFx...`; recipient absent; onboarding created NO recipient; claims role student/school-beta/district-beta | PASS |
| C3 (neg) | Follow `/app/a/{assignmentId}` while enrolled-non-recipient | **"This assignment isn't available for you yet. Ask your teacher for help."** + Go to My Assignments; NO launch; no code leaked | audit `lms.deepLinkResolved` `attemptContext:"informational"`; **0 attempts, 0 sessions** for Student C; recipient population unchanged (no auto-add) | PASS |
| C4 | Teacher opens Assignment Detail | "Students not yet assigned" lists Sprint 27 Student C (candidate = enrolled minus recipients) | `assignmentsRecipientCandidatesList` returns Student C only | PASS |
| C5 | Teacher clicks "Add to assignment" | Student C moves into roster "Not started (1)"; section now "Every enrolled student is already assigned" | `recipients/LjeeFx...` **source `manualAddition`** status assigned; audit `assignments.recipientAdded` by teacher, source manualAddition; population now B(classPublication)+C(manualAddition) | PASS |
| C6 | Student C reloads the deep link | Now **launches** into the Earth's Layers assessment (silent) | audit `lms.deepLinkResolved` flips to `attemptContext:"authorized"`, `internalTarget:"assignmentLaunch"` | PASS |

**Path C verdict: PASS.** The full stitched late-enrollment recovery is
certified in the browser: publication freezes recipients; a later enrollee is
active but not a recipient; onboarding and the deep-link visit never mutate the
frozen population; the deep link returns a safe informational state and does not
launch; the teacher explicitly adds the student through the certified
`manualAddition` path; and only then does the deep link authorize and launch.
No automatic or bulk recipient addition occurred anywhere.

## 6. Path D - Signed-out deep-link round trip

Student C (a recipient after Path C), starting signed-out.

| Step | Browser action | Observed UI | Backend / URL evidence | Result |
|---|---|---|---|---|
| D1 | Sign out, then navigate directly to `/app/a/{assignmentId}` while signed out | Sign-in surface ("Continue with Google") | Address bar **preserves** `/app/a/{assignmentId}` (verified independently in the in-app browser: `location.pathname === /app/a/{id}`), no redirect to `/` or `/app/signin`; bundle loads from `/app/dist/bundle.js` (D1 fix) | PASS |
| D2 | Continue with Google -> sign in as Student C | Returns to the lesson/assessment page (silent), not a generic dashboard | New `lms.deepLinkResolved` `attemptContext:"authorized"` for Student C after the round trip (a third resolve, later timestamp than the C6 resolve) | PASS |

**Path D verdict: PASS.** A signed-out arrival on `/app/a/{assignmentId}`
preserves that exact internal destination across the Google/Firebase sign-in
round trip and re-runs the resolver after authentication, landing the student
back in the correct assignment context. The return target is the preserved
internal `/app/a/{id}` path in browser history; no arbitrary external
`returnUrl` is involved.

## 7. Negative browser assertions

All three minimum high-value negatives certified in the browser:

| Assertion | Where | Observed | Backend | Result |
|---|---|---|---|---|
| Provisioned before sync (Classroom student signs in before teacher sync) | B3 | No join-code requirement; calm "Your class isn't ready in LyfeLabz yet. Ask your teacher to update the class roster, then try again."; no activation | still provisioned, empty claims, no enrollment | PASS |
| Enrolled but not recipient | C3 | Safe "This assignment isn't available for you yet. Ask your teacher for help."; runtime does not launch | resolver `informational`; 0 sessions, 0 attempts; no recipient auto-add | PASS |
| Closed / unavailable assignment | this section | Same safe informational surface; no new attempt launched; no leaked code | assignment `status: closed` (via canonical `assignmentsClose` callable); resolver flips to `informational`; 0 new attempts/sessions for the recipient | PASS |

**Closed-assignment method note.** The teacher-facing "Close assignment" control
(Sprint 13D; wired at `index.ts` and rendered by `detail.ts` when
`metadata.status === "published"`) did not render on the Classroom-linked
assignment's Assignment Detail for the cert teacher. Sprint 27's diff to
`detail.ts` is **purely additive** (256 insertions, 0 deletions; it added only
the "Students not yet assigned" section and never touched the lifecycle/close
rendering), so this is **not a Sprint 27 defect** - it is a pre-existing
Assignment Detail behavior (the close action renders off registry-sourced
metadata status). Broad Assignment Detail polish is explicitly a Sprint 28 item
in the implementation plan, not Sprint 27 scope. To certify the Sprint 27
**resolver** behavior on a closed assignment without adding a UI feature or
tampering with Firestore, the assignment was closed through the **canonical
`assignmentsClose` callable** (real teacher auth via a minted emulator token +
Firestore rules; the exact server-mediated product operation), returning
`{status:"closed", alreadyClosed:false}`. See §8/O1.

## 8. Defects / corrections

### D1 (CONFIRMED, CORRECTED) - deep-link route could not load the app bundle

**Discovered:** Path B step B7 (and it equally blocks Path D). Navigating to
`/app/a/{assignmentId}` hung on the static "Loading LyfeLabz Platform"
placeholder; the app never booted.

**Root cause:** the app shell `app/index.html` referenced its bundle with a
**relative** path, `<script type="module" src="./dist/bundle.js">`. The
`/app/a/{assignmentId}` arrival route (new in Sprint 27, Decision 4) is the
first **two-segment** route under `/app/`. Served via the
`/app/** -> /app/index.html` SPA rewrite, the document base URL is the
address-bar URL `/app/a/{id}`, so `./dist/bundle.js` resolved to
`/app/a/dist/bundle.js`, which the same rewrite answered with `index.html`
(HTML, HTTP 200) instead of the JS bundle. The module script failed to parse
and the app never initialized. Proven from the Hosting emulator access log:
`GET /app/a/dist/bundle.js 200` (the rewritten HTML). The existing one-segment
routes (`/app/`, `/app/teacher`, `/app/student`) resolve the relative path to
`/app/dist/bundle.js` correctly, which is why the defect was invisible until
the two-segment deep-link route existed.

**Severity:** high. The identical `/app/** -> /app/index.html` rewrite exists
in production Firebase Hosting, so the entire deep-link feature (the core
Sprint 27 Decision 4 deliverable) would have failed in production. Deterministic
tests did not catch it because they do not exercise the served HTML shell at
the new route depth; the client parse logic itself (`index.ts` pending-id
capture) was correct.

**Classification:** Sprint 27 implementation defect (asset-reference in the app
shell), surfaced by the new route. Not an environment or seed issue.

**Correction (narrow, one line):** `app/index.html` bundle reference made
absolute and depth-independent, matching the already-absolute config script
(line 1953) and the absolute asset paths the lesson artifacts use:
`src="./dist/bundle.js"` -> `src="/app/dist/bundle.js"`. No logic change, no
bundle rebuild (the HTML is served directly). No regression on the existing
routes (absolute resolves identically there).

**Verification of the fix:** reloaded `/app/a/{assignmentId}` in a browser;
Hosting log now shows `GET /app/dist/bundle.js 200` (the real JS), the app
boots, and the signed-out arrival renders the sign-in surface while
**preserving** the `/app/a/{assignmentId}` address-bar URL (confirming Decision
4 round-trip preservation). Deterministic re-run after the fix: app suite
1091 passed, 1 failed (only the pre-existing curriculum-manifest SHA drift, a
declared Sprint 27 non-goal - no new failure); Functions suite unaffected
(HTML-only change).

## 9. Rules suite

18 suites, 228 tests, 0 failures (exit 0), run standalone this session.

## 8b. Observations / limitations (not Sprint 27 defects)

### O1 - teacher "Close assignment" control absent on Classroom-linked Assignment Detail

The Sprint 13D "Close assignment" lifecycle control did not render on the
Classroom-linked assignment's Assignment Detail for the cert teacher, even at
the header. It is wired in `app/src/index.ts` and rendered by
`app/src/assignments/detail/detail.ts` gated on `metadata.status ===
"published"` (from the session-scoped registry). Sprint 27's `detail.ts` change
is purely additive and does not touch that rendering, so this is a pre-existing
Assignment Detail behavior, not a Sprint 27 regression. Broad Assignment Detail
polish is a Sprint 28 item. Recommended Sprint 28 follow-up: confirm the close
(and reopen) lifecycle controls render for LMS-sourced published assignments
reached via the Curriculum "View summary" path. Certification impact: none on
Sprint 27 scope; the closed-assignment resolver negative was certified through
the canonical `assignmentsClose` callable.

## 10. Remaining Phase 8 (live provider) assertion

Only that a real Google Classroom `courses.courseWork.create` accepts the
server-built `https://app.lyfelabz.com/app/a/{assignmentId}` link material and
returns a coursework record. Not attempted in Phase 7.
