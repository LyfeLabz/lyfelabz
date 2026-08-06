# Sprint 25 - Browser Certification Checklist

Status: Prepared for execution. Not yet executed. This document is the
scenario-by-scenario browser certification checklist for the Sprint 25
Google Classroom assignment-publication workflow. It is executed by a
human operator through the real teacher shell against the Emulator Suite.

Governing documents:
- `SPRINT_25_DEFINITION.md` §9 (claim boundary), §8 (success criteria)
- `SPRINT_25_ARCHITECTURAL_BLUEPRINT.md` §13 (browser certification plan)
- `SPRINT_25_PHASE_3_COMPLETION_REPORT.md` (implemented client behavior)
- `SPRINT_25_IMPLEMENTATION_PLAN.md` §2 (resolved decisions)
- `SPRINT_24B_DEPLOYMENT_AND_BROWSER_CERTIFICATION_RUNBOOK.md` (the
  established browser-certification standard this checklist extends)
- `SPRINT_25_CERTIFICATION_RUNBOOK.md` (the ordered execution procedure,
  environment prerequisites, and evidence rules that wrap this checklist)

Style: no em dashes. Use " - " (spaced hyphen).

Do not execute this checklist until the runbook's environment
prerequisites and stop-condition review pass. This document defines what
to observe; the runbook defines when the environment is safe to observe
it in.

---

## 0. Environment reality this checklist is written against

This is not a footnote. It changes what several scenarios can honestly
claim.

- LyfeLabz has one Firebase project, `lyfelabz-prod`, run under the
  Emulator Suite (`platform/firebase/firebase.json`, `singleProjectMode`).
  Every LyfeLabz-side write (assignment, publication record, mirror
  pointer, connection, audit event) lands in the local emulator, never in
  production Firestore.
- **There is no runtime Google Classroom API test double.** The fixture
  transport under
  `platform/functions/src/lms/providers/google-classroom/__fixtures__/`
  is imported only by Jest suites. At emulator runtime the LMS callables
  bind the real HTTPS transport through
  `ensureGoogleClassroomProductionBindings`. A genuine browser run
  therefore exercises **real Google Classroom** for topic listing,
  coursework creation, and incremental OAuth consent. This matches the
  Sprint 24B certification pattern (real Google OAuth, emulator Firestore),
  not the "test double" phrasing in blueprint §13.
- Consequence: the decisive upstream observations (B8 coursework created,
  B11/B12 appears in the course/topic, B6/B9 genuine consent) are
  **real Google Classroom** observations, or they are not performed. This
  checklist never fabricates a fixture result and presents it as real
  Google behavior. Where a scenario cannot be honestly produced against
  real Google in the available environment, it is marked
  NOT-CERTIFIABLE-HERE and deferred, not faked.
- If the team elects to certify against a fixture instead, a runtime
  fixture-installation seam must be built first (new production code,
  its own review and tests) and this checklist re-annotated. That is out
  of Phase 4 scope.

Each scenario below carries an **Upstream** field with one of:
- `real-google` - the observation requires and uses real Google Classroom.
- `emulator-only` - the observation is entirely LyfeLabz-side (emulator).
- `client-only` - the observation is a client-render check, no callable.
- `injected` - the observation requires a controlled failure; the
  injection method and its honesty caveat are stated in-scenario and in
  the runbook failure-injection plan.

---

## 1. Preconditions common to all scenarios

- The runbook Sections on environment prerequisites, validation baseline,
  and local startup have completed. Emulators running; app served at
  `http://localhost:5000`; certification OAuth client configured with the
  localhost redirect and the two coursework scopes grantable.
- Firestore emulator seeded with: `lmsProviders/googleClassroom`, one
  district, one school, the test teacher `users/{teacherUid}`, and the
  teacher's Auth emulator record. No `lmsClassLinks` and no
  `lmsAssignmentPublications` seeded.
- The test teacher owns a real Google Classroom course with at least one
  topic, and a second real course (single topic acceptable) for the
  multi-class scenario.
- A LyfeLabz lesson is available to assign (any published lesson slug).
- A clean run starts from a teacher who has connected Google Classroom
  with readonly scopes only (Sprint 24B state) and has never granted the
  coursework scopes. B9 depends on this readonly-only starting point.

Record each scenario's outcome in the certification log (scratch file,
not committed): timestamp, operator, scenario id, PASS or FAIL, evidence
filenames. Any FAIL on a pass/fail criterion stops the run per the
runbook.

---

## 2. Scenario checklist (B1 - B24)

### B1. Genuine teacher sign-in and shell baseline
- **Setup:** Emulators up, app served at localhost:5000, teacher not yet
  signed in.
- **Upstream:** real-google (Auth via Google provider in the Auth
  emulator handoff) / emulator-only for the shell.
- **Browser actions:** Sign in as the test teacher. Land on the
  authenticated teacher shell.
- **Expected visible state:** The shell renders; the teacher's classes
  are listed; no error banner; no LMS publish affordance visible outside
  Assign.
- **Evidence:** Screenshot of the shell; Functions log shows identity
  resolution, no error lines.
- **Pass/fail:** PASS when the shell renders for the genuine session with
  no auth injection and no Firestore patching.

### B2. Assign dialog remains one authoritative workflow
- **Setup:** Signed in; at least one LMS-linked active class and one
  non-LMS class exist.
- **Upstream:** client-only.
- **Browser actions:** Open Assign on a lesson.
- **Expected visible state:** Exactly one Assign dialog. No publish
  wizard, no Google Classroom settings panel, no second surface. All
  class rows selected by default, as today.
- **Evidence:** Screenshot of the open dialog.
- **Pass/fail:** PASS when publication is expressed only as additive
  per-row affordances inside the single dialog.

### B3. Non-LMS class row remains unchanged
- **Setup:** Assign dialog open with a non-LMS class row visible.
- **Upstream:** client-only.
- **Browser actions:** Inspect the non-LMS row.
- **Expected visible state:** No topic selector and no publish toggle on
  that row - absent, not shown disabled.
- **Evidence:** Screenshot; DOM inspection confirming the controls are
  not present in the row markup.
- **Pass/fail:** PASS when the non-LMS row is byte-equivalent to its
  pre-Sprint-25 rendering.

### B4. LMS-linked active row shows the publication toggle and topic selector
- **Setup:** Assign dialog open; the LMS-linked active class row visible.
- **Upstream:** real-google (topics fetched via `lmsClassesListTopics` ->
  live `listCourseTopics`).
- **Browser actions:** Inspect the LMS-linked active row. Open the topic
  selector.
- **Expected visible state:** The row carries a topic selector and an
  "Also publish to Google Classroom" toggle. The topic selector is
  populated from the linked course's real topics, with "No topic" as the
  default. A stale prefilled topic falls back to "No topic". A topic
  fetch failure degrades to an empty selector with the toggle still
  usable (verify only if a fetch failure occurs naturally; do not force).
- **Evidence:** Screenshot of the populated selector; Functions log shows
  one `lmsClassesListTopics` call returning the course topics.
- **Pass/fail:** PASS when both controls appear only on LMS-linked active
  rows and topics come from the real course.

### B5. Publication toggle defaults off
- **Setup:** Assign dialog open; LMS-linked active row visible; dialog
  freshly opened.
- **Upstream:** client-only.
- **Browser actions:** Observe the toggle state on open. Close and reopen
  the dialog; observe again.
- **Expected visible state:** The toggle is off on every open. It never
  remembers an on state across opens.
- **Evidence:** Screenshots of two independent opens.
- **Pass/fail:** PASS when the toggle is off by default on every open.

### B6. Successful LyfeLabz assignment with Classroom publication off
- **Setup:** Assign dialog open; LMS-linked active row present; publish
  toggle left off.
- **Upstream:** emulator-only.
- **Browser actions:** Configure the assignment normally and confirm with
  the toggle off.
- **Expected visible state:** The LyfeLabz assignment is scheduled. The
  confirmation names the LyfeLabz success and says nothing about Google
  Classroom for that row.
- **Evidence:** Screenshot of the confirmation; Functions log shows
  `assignmentsCreateDraft` and `assignmentsPublish` and **no**
  `lmsAssignmentsPublish` call.
- **Pass/fail:** PASS when assigning works with publication off and no
  publish callable fires. (Activation without publication is supported.)

### B7. Successful Classroom publication without a topic
- **Setup:** Assign dialog open; LMS-linked active row; the coursework
  scopes already granted (run after B9 the first time, or on a connection
  already widened). Leave the topic on "No topic".
- **Upstream:** real-google.
- **Browser actions:** Turn the publish toggle on, leave "No topic",
  confirm.
- **Expected visible state:** "The LyfeLabz assignment was scheduled.
  Publishing to Google Classroom succeeded."
- **Evidence:** Screenshot of the confirmation; Functions log shows
  `lmsAssignmentsPublish` with the row's `attemptNonce` and no
  `lmsTopicId`.
- **Pass/fail:** PASS when publication succeeds and the coursework POST
  carried no topic id (verified backend V-side; see B12 for the topic
  case).

### B8. Successful Classroom publication with a selected topic
- **Setup:** As B7 but pick a real topic from the selector.
- **Upstream:** real-google.
- **Browser actions:** Toggle on, select a topic, confirm.
- **Expected visible state:** Success confirmation line as in B7.
- **Evidence:** Screenshot; Functions log shows `lmsAssignmentsPublish`
  carrying the selected `lmsTopicId`.
- **Pass/fail:** PASS when publication succeeds with the topic id sent.
  This is a decisive observation (real upstream write). See B11/B12 for
  the in-Classroom confirmation.

### B9. Genuine incremental consent from a readonly connection
- **Setup:** The teacher's connection holds readonly scopes only (no
  coursework scopes granted yet). Assign dialog open; LMS-linked row;
  toggle on; confirm.
- **Upstream:** real-google (decisive).
- **Browser actions:** Confirm the publish. The first publish returns
  `lms.insufficientScope`; a single incremental-consent handoff opens.
  Complete the genuine Google consent for exactly the coursework
  capability. The publish is re-issued once automatically.
- **Expected visible state:** A real Google consent prompt scoped to the
  coursework capability; previously granted readonly scopes are
  preserved (the teacher is not asked to re-grant them). On grant, the
  row reports success.
- **Evidence:** Screenshot of the Google consent screen (redact account
  email); Functions log shows exactly one `lmsConnectionsBegin`
  (`capability: "publication"`), one `lmsConnectionsComplete`, then one
  re-issued `lmsAssignmentsPublish` with the **same** nonce as the first
  attempt.
- **Pass/fail:** PASS when consent is genuine, readonly scopes are
  preserved, exactly one begin/complete pair fires, and the single
  re-issue succeeds. This is the decisive consent observation.

### B10. Same logical publication re-issued once after consent
- **Setup:** Same action as B9 (this scenario is the ledger view of B9).
- **Upstream:** real-google.
- **Browser actions:** Observe that after consent the publish is
  re-issued exactly once, with the same nonce, and is not re-dispatched.
- **Expected visible state:** One success line for the row; no duplicated
  confirmation; the confirm control was locked while in flight.
- **Evidence:** Functions log shows exactly two `lmsAssignmentsPublish`
  calls for the row (pre-consent insufficient-scope, post-consent
  success), both with the identical `attemptNonce`.
- **Pass/fail:** PASS when the re-issue is single and nonce-stable.

### B11. Publication appears in the correct Classroom course
- **Setup:** After B7 or B8 succeeded.
- **Upstream:** real-google (decisive).
- **Browser actions:** In a separate Google Classroom tab signed in as
  the test teacher, open the linked course's Classwork.
- **Expected visible state:** A coursework item exists that links to the
  LyfeLabz assignment URL (the launcher URL), in the correct course.
- **Evidence:** Screenshot of the Classroom coursework item showing the
  LyfeLabz link (redact nothing that is not PII; the item is
  operator-owned test content).
- **Pass/fail:** PASS when the item is present in the correct course and
  points at the LyfeLabz assignment URL.

### B12. Publication appears under the correct topic when selected
- **Setup:** After B8 (topic selected) succeeded.
- **Upstream:** real-google (decisive).
- **Browser actions:** In the Classroom course, confirm the coursework
  item sits under the selected topic.
- **Expected visible state:** The item is filed under the chosen topic.
- **Evidence:** Screenshot showing the item under the topic.
- **Pass/fail:** PASS when the item is under the selected topic; the B7
  item (no topic) is not filed under any topic.

### B13. Teacher cancels or closes consent
- **Setup:** Readonly-only connection (a fresh readonly connection, or a
  connection that still lacks coursework scopes). Toggle on; confirm;
  when the consent prompt appears, cancel or close it.
- **Upstream:** real-google.
- **Browser actions:** Trigger the consent handoff, then cancel/close the
  Google consent window.
- **Expected visible state:** Calm line: "Publishing to Google Classroom
  needs your permission. You can try again from the assignment." The
  LyfeLabz assignment is scheduled and intact. No second OAuth attempt.
- **Evidence:** Screenshot of the calm line; Functions log shows one
  begin, no successful complete, and no re-issued publish.
- **Pass/fail:** PASS when cancellation produces no re-issue, no second
  popup, and leaves the LyfeLabz assignment intact and retryable.

### B14. Consent completes but required permission remains absent
- **Setup:** Readonly-only connection. Toggle on; confirm; in the Google
  consent screen, complete the flow **without** granting the coursework
  scope (deselect the coursework permission where Google allows partial
  grants).
- **Upstream:** real-google / injected (depends on whether Google offers
  a partial-grant path for the coursework scope; if Google does not allow
  deselecting it in this consent configuration, mark this scenario
  NOT-CERTIFIABLE-HERE and record why - do not simulate the partial
  grant with a fixture and present it as real).
- **Browser actions:** Complete consent without the coursework
  permission; the publish is re-issued once and again returns
  insufficient scope.
- **Expected visible state:** The row outcome is "needs your permission"
  (`permissionNotGranted`); the LyfeLabz assignment stays intact; retry
  stays available.
- **Evidence:** Screenshot; Functions log shows exactly one re-issue
  after consent and then a stop (no third publish, no reopened OAuth).
- **Pass/fail:** PASS when a completed-but-insufficient consent yields the
  permission-needed outcome with no loop.

### B15. Second insufficient-scope result stops without reopening OAuth
- **Setup:** Continuation of B14 (or any path where the post-consent
  re-issue still returns insufficient scope).
- **Upstream:** real-google.
- **Browser actions:** Observe the client after the single re-issue
  returns insufficient scope again.
- **Expected visible state:** No second consent window opens; no third
  publish fires; the outcome remains permission-needed.
- **Evidence:** Functions log shows exactly one begin, one complete, at
  most one re-issue; console shows no repeated OAuth handoff.
- **Pass/fail:** PASS when the consent loop is provably bounded to one
  re-issue.

### B16. Provider failure leaves LyfeLabz assignment intact
- **Setup:** Coursework scopes granted (post-B9). Inject a genuine
  provider failure for the coursework write (see runbook failure-injection
  plan; e.g. publish to a course/topic that was deleted upstream between
  fetch and confirm, or revoke the coursework grant in the Google account
  security settings immediately before confirm).
- **Upstream:** injected (real-google failure produced by a real upstream
  condition, not a fixture).
- **Browser actions:** Toggle on, confirm; the upstream write fails.
- **Expected visible state:** "The LyfeLabz assignment was scheduled.
  Publishing to Google Classroom did not succeed." A retry entry point is
  offered. The LyfeLabz assignment exists.
- **Evidence:** Screenshot; Functions log shows `assignmentsPublish`
  succeeded before the failed `lmsAssignmentsPublish`; a `failed`
  publication record was written (backend V19).
- **Pass/fail:** PASS when the LyfeLabz assignment is intact and the
  failure is calm and retryable. If no honest real-upstream failure can
  be produced in the environment, mark NOT-CERTIFIABLE-HERE and rely on
  the Phase 1 callable unit tests for the failure path, noting the
  distinction in the report.

### B17. Reconnect-required result produces calm Settings-directed guidance
- **Setup:** Set the teacher's connection to a non-active state (revoke
  or disconnect at the account level, or let it expire), then attempt a
  publish.
- **Upstream:** injected / emulator-only (the connection state is a
  LyfeLabz record; a non-active connection is refused server-side before
  any upstream call).
- **Browser actions:** Toggle on, confirm.
- **Expected visible state:** "Google Classroom needs to be reconnected
  in Settings. Your assignment was scheduled." No consent flow opens; no
  publish re-issue. The LyfeLabz assignment is scheduled.
- **Evidence:** Screenshot; Functions log shows the publish callable
  returning the connection-not-active outcome and no
  `lmsConnectionsBegin`.
- **Pass/fail:** PASS when a non-active connection maps to the reconnect
  line, never to a consent loop, and the LyfeLabz assignment proceeds.

### B18. Assignment-detail manual retry uses a fresh attempt
- **Setup:** A row from B16 whose publication did not succeed, in the
  current tab session. Open that assignment's detail view.
- **Upstream:** real-google (the retry re-attempts the upstream write).
- **Browser actions:** On the detail view's Google Classroom panel,
  choose "Try again".
- **Expected visible state:** The retry runs with a fresh nonce and,
  where scopes are present, succeeds and updates the panel to succeeded.
- **Evidence:** Functions log shows a new `lmsAssignmentsPublish` with a
  **different** `attemptNonce` from the original attempt, and **no**
  `assignmentsCreateDraft` / `assignmentsPublish`.
- **Pass/fail:** PASS when retry uses a fresh nonce and never re-runs the
  LyfeLabz lifecycle.

### B19. Successful detail retry does not recreate the LyfeLabz assignment
- **Setup:** Continuation of B18 where the retry succeeds.
- **Upstream:** real-google / emulator-only verification.
- **Browser actions:** Observe the detail panel after a successful retry.
- **Expected visible state:** The panel shows succeeded and the retry
  control is removed. The original LyfeLabz assignment id is unchanged.
- **Evidence:** Firestore: the same `assignmentId`; a new `succeeded`
  publication record for the retry nonce; the prior `failed` record
  retained; `lmsPublicationRef` now set. No new assignment document.
- **Pass/fail:** PASS when the assignment record is unchanged and only
  publication state advanced.

### B20. Failed retry remains retryable
- **Setup:** A detail-view retry that fails again (re-inject the B16
  condition, or retry while the upstream failure persists).
- **Upstream:** injected.
- **Browser actions:** Choose "Try again"; it fails.
- **Expected visible state:** The panel again shows "did not succeed" and
  keeps the retry control available. No crash, no loop.
- **Evidence:** Screenshot; Functions log shows another `failed`
  publication record with yet another fresh nonce.
- **Pass/fail:** PASS when a failed retry stays calmly retryable.

### B21. Multi-class mixed outcome
- **Setup:** Two LMS-linked active classes (two real courses). Assign one
  lesson to both. Arrange one class to succeed and one to fail (e.g. the
  second course's selected topic was deleted upstream, or its coursework
  scope is not grantable).
- **Upstream:** real-google + injected.
- **Browser actions:** Toggle publication on for both rows, confirm once.
- **Expected visible state:** A mixed confirmation: "succeeded for N ...
  did not succeed for M". Each class's LyfeLabz assignment is scheduled
  independently.
- **Evidence:** Screenshot; Functions log shows one draft/publish and one
  `lmsAssignmentsPublish` per row, each with its own nonce and its own
  `assignmentId`; one shared consent flow if consent was needed.
- **Pass/fail:** PASS when per-row outcomes are independent and one row's
  failure never blocks or rolls back the other.

### B22. No duplicate popup during multi-row consent
- **Setup:** As B21 but with a readonly-only connection so both rows need
  consent in the same confirm.
- **Upstream:** real-google (decisive for the coordinator).
- **Browser actions:** Confirm both rows; observe the consent handoff.
- **Expected visible state:** Exactly one Google consent window opens for
  the whole confirm; both rows re-issue once against the completed
  consent.
- **Evidence:** Functions log shows exactly one `lmsConnectionsBegin` and
  one `lmsConnectionsComplete` for the confirm across both rows; each row
  re-issues its own publish once.
- **Pass/fail:** PASS when a single shared consent covers all rows in the
  confirm and no second popup opens.

### B23. Calm confirmation summary distinguishes LyfeLabz success from Classroom failure
- **Setup:** Any confirm where the LyfeLabz assignment succeeds but the
  Classroom publish does not (reuse B16 or B21).
- **Upstream:** injected.
- **Browser actions:** Read the confirmation summary.
- **Expected visible state:** The summary states the LyfeLabz assignment
  was scheduled AND that publishing to Google Classroom did not succeed.
  It never implies the LyfeLabz assignment failed. No stack trace, no
  administrator reference, no raw code.
- **Evidence:** Screenshot of the summary copy.
- **Pass/fail:** PASS when the two outcomes are named separately and the
  LyfeLabz success is never conflated with the publication failure.

### B24. No token, scope string, raw provider error, account identity, or student PII appears in the UI
- **Setup:** Run across all prior scenarios; this is a standing
  observation, verified explicitly at the end.
- **Upstream:** client-only (DOM/console inspection).
- **Browser actions:** Inspect the DOM, all rendered copy, and the
  browser console across the confirmation, the detail panel, the topic
  selector, and every error line. Search the DOM for `lms.`, `token`,
  `@`, `403`, the Google account email, any raw scope URL, and any
  student name.
- **Expected visible state:** None of these appear on any teacher
  surface, in any DOM attribute, or in any client console line. Google
  Classroom is referenced by display name only.
- **Evidence:** Console-search output; screenshots of the error and
  confirmation surfaces.
- **Pass/fail:** PASS when no token, scope string, raw provider error,
  Google email/account id, or student PII is present anywhere in the
  client. This is a hard privacy gate; any occurrence is a FAIL.

---

## 3. Decisive observations

Per blueprint §13, the decisive real-upstream observations are:
- **B9/B10** - incremental consent is genuine and bounded to one re-issue.
- **B8/B11/B12** - the coursework write is real and correctly filed.

If B9, B11, and B12 cannot be produced against real Google in the
available environment, Sprint 25 cannot claim genuine browser or
real-Google certification, only engineering validation (definition §9
levels 1). Record that boundary honestly in the final report.

## 4. Certification decision

Every pass/fail criterion in B1 - B24 must pass for the scenarios that
are certifiable in the environment. Any FAIL stops the run. Any scenario
marked NOT-CERTIFIABLE-HERE is recorded with its exact reason and the
compensating engineering evidence (the relevant Phase 1/2/3 unit or
integration test), and the final report's claim boundary is narrowed
accordingly. Do not upgrade a NOT-CERTIFIABLE-HERE scenario to PASS on
the strength of a Jest fixture.

*End of browser certification checklist.*
