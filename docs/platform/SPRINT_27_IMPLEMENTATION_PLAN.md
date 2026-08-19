# Sprint 27 Implementation Plan - Student Classroom Lifecycle Completion

Status: Phase 1 planning. Companion to `SPRINT_27_ARCHITECTURAL_BLUEPRINT.md`
and `SPRINT_27_DEFINITION.md`. This plan translates the blueprint into
ordered implementation phases. It authorizes no code, no test change, no
deployment, no OAuth initiation, and no Firebase or Google state change.
Implementation begins only after the architecture is reviewed and
explicitly authorized.

Style: no em dashes. Use " - " (spaced hyphen) as the sentence-level
break.

---

## How to read this plan

Each phase records: objective, files and modules likely affected, exact
behaviors, tests, security assertions, stop conditions, and certification
implication. "Likely affected" names starting points, not a promise that
no neighboring code moves. Every callable named as new is single-purpose
and additive; every certified path named as unchanged stays unchanged.

Phase 1 is complete on delivery of the blueprint and this plan. Phases 2
through 9 are the implementation body and are not executed by the Phase 1
task.

---

## Phase 1 - Architecture and documentation completion

**Objective.** Resolve Decisions 1 through 4 and record the canonical
blueprint and this plan.

**Files.** `docs/platform/SPRINT_27_ARCHITECTURAL_BLUEPRINT.md` (new),
`docs/platform/SPRINT_27_IMPLEMENTATION_PLAN.md` (new). No production or
test file.

**Behaviors.** The four decisions are fixed:
1. My Results over caller-scoped `assessmentAttemptsList` with client
   aggregation; no rollups.
2. New `studentsCompleteLmsOnboarding` activation gated on a server-found
   LMS enrollment; teacher re-sync is the roster trigger;
   `reconcileMyExternalIdentity` unwired; forced token refresh after
   activation.
3. Late enrollment through the existing `assignmentsRecipientAdd`
   (`manualAddition`); no automatic bulk add.
4. Server-built `https://app.lyfelabz.com/app/a/{assignmentId}` deep link
   (current production host; PDR-027's `lyfelabz.com` origin is the future
   target state, blueprint §8.1), new `lmsDeepLinkResolve`, `/app/a/` route,
   recipient-aware `attemptContext`.

**Tests.** None; documentation only.

**Security assertions.** The plan preserves every invariant in blueprint
§11. No decision widens the district boundary, the recipient boundary, the
server-mediated enrollment boundary, or the server-only token boundary.

**Stop conditions.** Stop if any decision cannot be grounded in current
repository evidence, or if a decision would require weakening a
load-bearing invariant. (None encountered.)

**Certification implication.** Establishes the certification matrix
(blueprint §13) that Phases 7 and 8 execute.

---

## Phase 2 - My Results client seam and surface (Decision 1)

**Objective.** Wire My Results over `assessmentAttemptsList` and add the
PDR-024i second student surface with client aggregation.

**Files likely affected.**
- New `app/src/assignments/studentResults/wire.ts` -
  `createAttemptsListForStudentCallable(functions)` wrapping
  `assessmentAttemptsList`; defensive parser into a frozen
  `StudentAttemptSummary[]`.
- New `app/src/assignments/studentResults/types.ts` - client item shapes.
- New `app/src/assignments/studentResults/aggregate.ts` - per-assignment
  grouping, best-score selection, tie-break, attempt count, status
  derivation, canImprove.
- `app/src/router/surfaces/index.ts` - add `studentResultsList` getter to
  `SurfaceDeps`; render the two-surface menu (My Assignments, My Results)
  and the My Results region in `makeActiveStudentSurface`.
- `app/src/index.ts` - wire `studentResultsList` per active-student
  session.
- Reuse `app/src/assignments/studentList/launch.ts`
  (`buildAssignmentLaunchUrl`) for Improve My Score.

**Exact behaviors.**
- The wrapper calls `assessmentAttemptsList` with an empty payload; sends
  no `studentId`; drops malformed items.
- Aggregate per `assignmentId`: best percentage (max, tie-break higher
  `attemptNumber` then later `submittedAt`, mirroring PDR-029a and
  PDR-029b), attempt count, status (Ready to Begin, Improving, Well Done!,
  Perfect Score), canImprove (best < 100 percent).
- Join titles and launch targets from `assignmentsListForStudent` on
  `assignmentId`; neutral fallback label and no Improve control when an
  assignment is not listed.
- States: loading, populated, empty, recoverable error. No punitive
  language (PDR-024m). Status shown by icon plus text, never color alone
  (PDR-024l).

**Tests (deterministic).**
- Wrapper: parses a valid response; drops malformed items; sends no
  forbidden field.
- Aggregate: best-score selection and tie-break; attempt count; each of
  the four status indicators; canImprove true below 100 percent and false
  at 100 percent.
- Surface: renders My Assignments and My Results; empty, loading, error
  states; Improve My Score present on a less-than-perfect best and absent
  on a perfect best; fallback label path.

**Security assertions.**
- No `studentId` is ever sent; only caller-scoped reads are used.
- No teacher, class-scoped callable is reached from the student surface.
- No answer-key material is present (the callable excludes it).
- No cross-student aggregation; only single-student self-aggregation.

**Stop conditions.** Stop if any My Results path reaches
`assessmentAttemptsListForClass` or accepts a `studentId`, or if a card
can render answer-key or another student's data.

**Certification implication.** My Results is exercised in the Path A chain
(Phase 7): the student's best score, attempt count, status, and Improve My
Score reflect their completed attempts.

**Status - IMPLEMENTED (deterministic evidence; pending browser and
emulator certification in Phase 7).** Landed uncommitted for review.

- New client seam `app/src/assignments/studentResults/wire.ts`
  (`createAttemptsListForStudentCallable`) wraps the caller-scoped
  `assessmentAttemptsList` with the empty payload, a defensive parser into
  a frozen `StudentAttemptSummary[]`, and no `studentId`. New
  `types.ts` (client shapes) and `aggregate.ts` (per-assignment grouping,
  best-score selection and PDR-029b tie-break, PDR-024l status derivation,
  attempt count, canImprove).
- `app/src/router/surfaces/index.ts`: `SurfaceDeps` gains a
  `studentResultsList` getter; `makeActiveStudentSurface` now renders the
  PDR-024i two-surface menu (My Assignments, My Results) as an accessible
  tablist and the My Results region with loading, empty, error, and
  populated states. My Assignments gains a PDR-024l status indicator per
  card (Ready to Begin when unattempted), degrading to launch-only when the
  results read is unavailable. Improve My Score is offered on every
  less-than-perfect best score and only when a launchable target exists
  (fail closed); the fallback title label is used when an assignment is no
  longer listed.
- `app/src/index.ts` wires `studentResultsList` per active-student session
  and nulls it on every other session, mirroring `studentAssignmentsList`.
- The Well Done threshold is fixed at 90 percent, anchored to the canonical
  9/10 worked example (blueprint §5.2); recorded as a UI presentation
  threshold, not a backend contract.
- Deterministic tests: `wire.test.ts` (callable name, empty payload, no
  forbidden identifier, security regression that the class-scoped teacher
  callable is never targeted, malformed-item drop, error propagation),
  `aggregate.test.ts` (best-score, four tie-break rules, status
  derivation, grouping without cross-assignment contamination), and new
  surface tests in `surfaces.test.ts` (tablist navigation, loading, empty,
  error and retry, best score, attempt count, status, Improve My Score
  presence and fail-closed absence, fallback historical item, My
  Assignments status decoration and safe degradation).
- No Functions change: the backend contract is confirmed by inspection and
  by the 10 existing `assessment-attempts-list.test.ts` cases (caller
  scoping, cross-district and cross-school drops, answer-key projection
  exclusion, role-forbidden).

---

## Phase 3 - LMS student activation and enrollment path (Decision 2)

**Objective.** Let a Google-Classroom-rostered student reach `active`
without a manual join code, entirely server-mediated.

**Files likely affected.**
- New `platform/functions/src/students/students-complete-lms-onboarding.ts`
  - the `studentsCompleteLmsOnboarding` callable.
- `platform/functions/src/index.ts` - export the new callable.
- Shared helpers for reading the caller's active LMS enrollment and
  deriving `schoolId`/`districtId` (reuse `enrollmentsCollectionRef`,
  `classDocRef`, `schoolDocRef`, `writeCustomClaims`, `writeAuditEvent`).
- `app/src/router/surfaces/index.ts` - add the LMS onboarding affordance
  to `makeProvisionedSurface` and an `onStudentLmsOnboarding` dep.
- `app/src/index.ts` - wire `onStudentLmsOnboarding`: call the callable,
  then `getIdToken(true)`, then refresh the session.
- `platform/functions/src/lms/roster/sync-engine.ts` and
  `lmsClassesSyncRoster` - unchanged; they already create the enrollment.

**Exact behaviors (server callable).**
1. require an authenticated caller,
2. load `users/{uid}`; idempotent no-op when already `active` and
   `role === "student"`; else require `status === "provisioned"`,
3. find an `active` enrollment for `uid` in a class with
   `enrollmentSource === "lms"`; refuse with `students.noLmsEnrollment`
   when none,
4. derive `schoolId` from the class record, `districtId` from the school
   record,
5. `writeCustomClaims({ uid, status: "active", role: "student", schoolId,
   districtId })`,
6. emit `students.activated` (existing vocabulary),
7. accept only `displayName` from the client; refuse any `schoolId`,
   `classId`, provider account ID, or Classroom identifier on the payload.

**Client behavior.** The provisioned surface keeps the manual join-code
form and adds a "My teacher uses Google Classroom" action. The action
calls `onStudentLmsOnboarding`, which calls the callable, force-refreshes
the token, and refreshes the session. On `students.noLmsEnrollment`, show
"Ask your teacher to update the class roster, then try again" with retry.
The client asserts nothing about roster or Classroom membership.

**Tests (deterministic).**
- Callable: activates a provisioned student with an active LMS enrollment;
  derives schoolId/districtId from server state; idempotent replay; refuses
  when no LMS enrollment; refuses forbidden payload fields; refuses a
  non-provisioned status appropriately.
- Client: LMS action success path force-refreshes the token; no-enrollment
  path shows the ask-your-teacher state; manual path unchanged.

**Security assertions.**
- No client-supplied `schoolId`, provider account ID, class, or Classroom
  identifier is trusted.
- Enrollment is not created by this callable; it is only read.
- Manual join-code path and `studentsCompleteOnboarding` are unchanged.
- `reconcileMyExternalIdentity` is not wired.
- Forced token refresh occurs before assignment access (PDR-025j).

**Stop conditions.** Stop if activation can occur without a server-found
LMS enrollment, if the callable accepts a client `schoolId`, or if any
enrollment write is introduced on this path.

**Certification implication.** Provides the activation step of Path B
(sign-in to activation to enrollment to My Assignments).

**Status - IMPLEMENTED (deterministic evidence; pending browser and
emulator certification in Phase 7).** Landed uncommitted for review.

- New server callable
  `platform/functions/src/students/students-complete-lms-onboarding.ts`
  (`studentsCompleteLmsOnboarding`). It authenticates the caller directly
  (the caller is still `provisioned` and holds no claims, so
  `requireDistrictContext` cannot gate it), loads `users/{uid}`, is an
  idempotent no-op when already `active` with `role === "student"`, else
  requires `status === "provisioned"`. Eligibility: it queries
  `enrollmentsCollectionRef().where("studentId","==",uid).where("status","==","active")`,
  and for each active enrollment loads the referenced class, qualifying it
  only when the class exists, is itself `active` (not `needsSetup`, not
  `archived`), and carries `enrollmentSource === "lms"`. A manual
  (join-code) class never qualifies; a terminal enrollment cannot appear
  (query scoped to `active`); the external-identity bridge alone confers
  nothing. It refuses with `students.noLmsEnrollment` when none qualifies,
  and fails closed with `students.conflictingLmsEnrollment` when qualifying
  enrollments resolve to more than one school. `schoolId` is derived from
  the class record and `districtId` from the `schools/{schoolId}` record;
  no client value participates. Activation writes through the canonical
  `writeCustomClaims` helper and emits `students.activated` with a
  PII-free `payload: { source: "lms" }` provenance marker (reusing the
  canonical vocabulary; no new audit kind). The only client field accepted
  is an optional `displayName`, which falls back to the name recorded at
  provisioning; every authority-bearing field (`schoolId`, `districtId`,
  `classId`, `studentId`, `enrollmentId`, `providerId`,
  `providerAccountId`, `uid`, `userId`, `role`) is refused with
  `students.forbiddenField` before any read. Exported from
  `platform/functions/src/students/index.ts` and
  `platform/functions/src/index.ts`.
- `platform/functions/src/lms/roster/sync-engine.ts` and
  `lmsClassesSyncRoster` are UNCHANGED: they already create the enrollment,
  and the load-bearing regression (a `provisioned` user with an active
  external-identity bridge is resolved and enrolled without custom claims)
  is proven by the existing `sync-engine.test.ts` "initial sync creates one
  enrollment per resolved roster member" case. The engine never reads user
  status and never writes claims, so the ordering invariant is structural.
- Client: `app/src/router/surfaces/index.ts` gains an
  `onStudentLmsOnboarding` dep and a distinct "I'm in a Google Classroom
  class" affordance beneath the manual join-code form in
  `makeProvisionedSurface`. It sends at most an optional `displayName`
  (reusing the name field when typed), never a join code or any authority
  field, and renders into a dedicated `lms-error-host` so the manual and
  LMS flows never contaminate each other. Recovery states are calm and
  non-leaking: `students.noLmsEnrollment` shows "ask your teacher to update
  the class roster, then try again" (the button itself is the retry);
  conflicting or
  validation failures show generic support guidance; retryable failures
  invite a retry. No class id, school id, district id, provider id, or
  internal status code is exposed.
- `app/src/index.ts` wires `onStudentLmsOnboarding`: it calls
  `studentsCompleteLmsOnboarding`, then force-refreshes the ID token
  (`getIdToken(true)`) so the new claims are present before the
  active-student surface loads, mirroring the manual path. The surface
  schedules the session refresh on success.
- `studentsCompleteOnboarding`, `enrollmentsJoinByCode`,
  `reconcileMyExternalIdentity`, and `BETA_SCHOOL_ID` are unchanged. The
  LMS callable does not receive or trust `BETA_SCHOOL_ID`.

**Post-implementation audit correction (idempotent claims self-heal).** A
review of the activation state machine found one non-atomic seam:
activation writes the `users/{uid}` record, then the Firebase Auth
custom-claims, then the audit event, and a Firestore transaction cannot
enclose a custom-claims write. A prior attempt that reached `active` but
failed the claims write left a split-brain (record active, token carries no
authorization) that the client bootstrap could not recover - a force-refresh
only re-reads claims that were never written, degrading the student to the
pending surface - and the original idempotent replay returned
`alreadyActive: true` without repairing it, so the student was persistently
stuck. The idempotent branch now reads the caller's own claims and, only when
role/schoolId/districtId are missing or stale, re-derives the district from
the school the record already names and re-asserts the canonical student
claims through `writeCustomClaims`. Healthy claims remain a bounded no-op; no
enrollment re-scan, no LMS re-qualification, no second activation audit event.
Added a shared `readCustomClaims` helper (the read counterpart to
`writeCustomClaims`, so the callable never reaches `getAdminAuth()` directly).
The manual `studentsCompleteOnboarding` path shares the same non-atomic seam
but was left unchanged per audit scope; the same self-heal is a candidate
follow-up. UX: the `students.noLmsEnrollment` recovery copy changed from "Ask
your teacher to add you to the class" to "Ask your teacher to update the class
roster" to match the real recovery sequence (the student is already in the
Google Classroom; the teacher re-runs the roster sync).
- Deterministic tests: `students-complete-lms-onboarding.test.ts` (41
  cases: success + server-side derivation, canonical claims and audit
  shape, side-effect ordering, optional/fallback display name, multiple
  same-school enrollments, no-enrollment, manual-only, archived/terminal
  class, missing class, conflicting-school fail-closed, district-unassigned
  and missing-school fail-closed, per-field forbidden-authority rejection
  before any read, invalid payloads, unauthenticated, wrong status,
  idempotent replay with healthy claims as a bounded no-op, split-brain
  claims repair on replay, stale-claims repair, conservative repair on an
  unreadable claim set, no LMS re-qualification on the idempotent path,
  missing-schoolId fail-closed, non-student active rejection, downstream
  claims-failure and audit-failure propagation). Client: 9 new
  `surfaces.test.ts` cases
  (affordance present, empty-payload success + refresh, typed-name reuse,
  no join/school/class/district/provider identity sent, no-enrollment
  recovery copy with no leaked ids and empty manual host, retry after
  no-enrollment, generic-unavailability copy, degrade when dep unwired,
  manual path unaffected).

---

## Phase 4 - Assignment-aware deep link (Decisions 4 and 3)

**Objective.** Replace the client-supplied bare-lesson Classroom URL with
a server-built assignment-aware URL, add the resolver and the arrival
route, and wire the late-recipient teacher affordance.

**Files likely affected.**
- New `platform/functions/src/lms/deep-link-url.ts` - the sole authorized
  deep-link URL builder and parser (`/app/a/{assignmentId}` shape;
  refusals per PDR-027 §8.1, §8.2).
- New `platform/functions/src/lms/deep-link-resolve.ts` - the
  `lmsDeepLinkResolve` student callable (PDR-027 §10.1, read-only,
  recipient-aware `attemptContext`).
- `platform/functions/src/lms/assignments-publish.ts` - remove
  `lyfelabzAssignmentUrl` from the request contract; construct the URL
  server-side via the builder from the resolved `assignmentId`.
- `platform/functions/src/index.ts` - export `lmsDeepLinkResolve`.
- `app/src/shell/surfaces/curriculum.ts` - stop computing
  `window.location.origin + lesson.href`; stop passing
  `lyfelabzAssignmentUrl`.
- `app/src/shell/surfaces/shared/lmsPublication.ts` and the integrations
  publish types - drop `lyfelabzAssignmentUrl` from the client publish
  request shape and the retry context.
- New `app/src/assignments/deepLink/` - the `/app/a/{assignmentId}`
  arrival client: parse the route, invoke `lmsDeepLinkResolve`, dispatch
  to `internalTarget`, render the failure states.
- `/app/**` routing entry - register the `/app/a/` arrival route so the
  bootstrap preserves the arriving URL across sign-in.
- Decision 3: `app/src/assignments/detail/` - add a minimal teacher
  control that calls the existing `assignmentsRecipientAdd` if no such
  affordance exists. `platform/functions/src/assignments/assignments-recipient-add.ts`
  is unchanged.

**Exact behaviors.**
- The URL builder emits exactly
  `https://app.lyfelabz.com/app/a/{assignmentId}` (the current production
  host per blueprint §8.1; the host constant moves to `lyfelabz.com` only
  when the apex migrates to Firebase Hosting) and refuses any query
  parameter, fragment, alternate host, `http` scheme, lesson slug, or extra
  identifier.
- `lmsAssignmentsPublish` builds the URL from the `assignmentId` it already
  loads and passes it as the sole coursework link material; the client no
  longer supplies a destination.
- `lmsDeepLinkResolve` runs the PDR-027 §10.1 order, adds the
  recipient-aware `attemptContext`, is read-only, and emits
  `lms.deepLinkResolved`.
- The arrival client dispatches to the returned `internalTarget` (My
  Assignments focused for a `classroom`-mode recipient) and renders the
  §8.6 failure states.
- Late recipient add: the teacher control calls `assignmentsRecipientAdd`;
  no automatic or bulk behavior.

**Tests (deterministic and emulator).**
- URL builder and parser: exact shape in and out; every refusal branch.
- `lmsAssignmentsPublish`: builds the URL server-side; ignores or refuses
  any client destination field; otherwise unchanged (idempotency, failure
  recording, scope/refresh behavior from Sprint 25 preserved).
- `lmsDeepLinkResolve`: correct target for an enrolled recipient on a
  published assignment; `informational` for enrolled non-recipient and for
  practice mode; refuses non-enrolled, cross-district, draft, archived,
  malformed id; writes nothing (import-graph assertion that scorer,
  session, rollup helpers are unreachable); never calls Google.
- Recipient add affordance: calls the existing callable; idempotent;
  refuses when no active enrollment.

**Security assertions.**
- The client cannot influence the Classroom destination URL.
- The URL carries no secret and no PII beyond the opaque `assignmentId`.
- The resolver is read-only and Classroom-agnostic; URL possession is not
  authorization.
- District, enrollment, and recipient enforcement all hold on resolve.
- No token, session id, score, or Classroom id in the URL, the payload, an
  audit event, or a log.
- Late add stays `manualAddition`, append-only, teacher-intended; no bulk
  mutation.

**Stop conditions.** Stop if the publish path still accepts a
client-supplied destination, if the resolver writes any document other
than `auditEvents`, if the resolver calls Google, or if any late-add
automatic or bulk behavior is introduced.

**Certification implication.** Provides the deep-link arrival, silent
arrival, and late-recipient behavior for Path B, and the server-built URL
for the live-provider boundary in Phase 8.

**Status - IMPLEMENTED (deterministic evidence; pending browser and
emulator certification in Phase 7).** Landed uncommitted for review.

Part 1 - server-owned Classroom destination.
- New `platform/functions/src/lms/deep-link-url.ts`
  (`buildAssignmentDeepLinkUrl`) is the sole authorized producer of the
  deep-link URL. It emits exactly
  `https://app.lyfelabz.com/app/a/{assignmentId}` and refuses any
  non-canonical assignmentId with `deep-link-shape-invalid`, so no query,
  fragment, alternate host, `http` scheme, lesson slug, or extra identifier
  can be smuggled into the URL (the emitted shape is structural because the
  assignmentId grammar admits no `:`/`/`/`?`/`#`/`.`). The origin is a fixed
  production constant owned by the single producer (blueprint §8.1), not a
  client input; the PDR-027 `lyfelabz.com` origin is preserved as the future
  target reached only after the apex migrates to Firebase Hosting.
- `platform/functions/src/lms/assignments-publish.ts` no longer reads
  `payload.lyfelabzAssignmentUrl`; it builds the coursework link server-side
  from the authoritative `assignmentId` via the builder and passes it as the
  sole link material to the Google Classroom adapter (the adapter interface
  field name is unchanged; only its source moved server-side). The field is
  removed from `LmsAssignmentsPublishRequest`. Any client value still present
  on the request is ignored, never trusted.
- Client trust-boundary removal: `app/src/settings/integrations/types.ts`
  drops `lyfelabzAssignmentUrl` from the `publishAssignment` request shape;
  `app/src/shell/surfaces/curriculum.ts` no longer computes
  `window.location.origin + lesson.href`; `app/src/shell/surfaces/shared/lmsPublication.ts`
  drops it from the retry context and the retry publish call. The client
  cannot influence the Classroom destination.

Part 2 - assignment-aware arrival route. New client modules under
`app/src/assignments/deepLink/`: `route.ts`
(`parseDeepLinkAssignmentId`, the sole client consumer of the `/app/a/{id}`
shape; validates the id, rejects a second segment / query / fragment / bad
grammar), `types.ts`, `wire.ts` (`createDeepLinkResolveCallable`, sends only
the assignmentId, fails closed on a malformed or inconsistent resolution),
and `arrival.ts` (`renderDeepLinkArrival`, the pure DOM arrival surface).
`app/src/index.ts` captures the pending arrival id once at startup from
`window.location.pathname`, routes an active student into the arrival
surface, and, for a provisioned or unauthenticated arrival, renders
onboarding / sign-in WITHOUT a history replace so the `/app/a/{id}` URL is
preserved across a redirect sign-in round trip (browser history is the only
preservation mechanism; no storage, no token, no PII). A non-student session
discards the id. The resolver seam is bound per active-student session and
nulled on every other session.

Part 3 - server resolver. New
`platform/functions/src/lms/deep-link-resolve.ts` (`lmsDeepLinkResolve`),
read-only against LyfeLabz domain state. Authorization order (at least as
strict as `assessmentSessionsBegin`): authenticated active caller and
claims/record consistency via `requireDistrictContext`; `role === "student"`;
canonical assignmentId shape; assignment exists; same-school invariant as the
district boundary (PDR-025 §10; the AssignmentRecord carries schoolId, not
districtId, identical to session begin) -> `district-mismatch`; status gate
(`draft` -> `assignment-not-published`, `archived` -> `assignment-archived`,
`published`/`closed` resolve); active enrollment -> `enrollment-inactive`;
recipient-aware `attemptContext` (`authorized` + `assignmentLaunch` only for a
published, classroom-mode, open-window, canonical recipient; every other
resolvable state is `informational`, and a practice-mode assignment routes to
`lessonPractice`). It reuses `isCanonicalRecipient` and `enrollmentIdFor`;
it never calls Google, never reads an OAuth token, and writes exactly one
best-effort `lms.deepLinkResolved` audit event on success and no document on
any refusal. Success-only auditing is a deliberate narrowing of PDR-027 §23,
which also lists a refusal-outcome `lms.deepLinkResolved` event; that refusal
event is intentionally deferred, not implemented (rationale and future-target
disposition recorded in blueprint §8.4 "Audit scope"). The single append-only
success write is explicitly permitted for the read-only resolver by PDR-027
§17. New audit action `lms.deepLinkResolved` added to the single
canonical `AUDIT_ACTIONS` vocabulary. Exported from `lms/index.ts` and the
root `index.ts`.

Runtime handoff. On `authorized` the arrival surface hands off silently
(PDR-024h) to the existing runtime by navigating to the launch URL built by
the certified `buildAssignmentLaunchUrl` (the same mechanism My Assignments
uses); a narrow refactor exposed `buildLessonBasePath` in
`app/src/assignments/studentList/launch.ts` for the practice handoff, with
existing launch behavior unchanged. Session creation remains the sole
responsibility of `assessmentSessionsBegin`; the resolver never begins a
session.

Part 4 - teacher late-recipient affordance (Decision 3). DEFERRED to
Phase 5. The load-bearing Decision 3 invariants are fully preserved in
Phase 4: the resolver is read-only and never mutates recipients; roster sync
never mutates recipients; no automatic or bulk recipient addition is
introduced anywhere; the certified `assignmentsRecipientAdd`
(`source: "manualAddition"`, idempotent, truthful audit) remains the only
late-add path. A usable teacher UI affordance requires enumerating enrolled
students who are NOT recipients, and no such data source exists on Assignment
Detail (the roster surface lists only recipients). Adding that enumeration
plus a picker would redesign Assignment Detail, which is out of scope
("Do not redesign Assignment Detail"). Per the report-rather-than-redesign
directive, the teacher-facing control is deferred to Phase 5 lifecycle
stitching, where the enrolled-non-recipient surface can be designed
deliberately; the enrolled-but-not-recipient student meanwhile receives the
resolver's `informational` "ask your teacher" surface.

Tests. Functions: `deep-link-url.test.ts` (canonical shape; host correction;
every prohibited-content refusal), `deep-link-resolve.test.ts` (authorized;
informational for non-recipient / closed / practice / closed-window; every
refusal branch including cross-school district-mismatch, draft, archived,
no/inactive enrollment, role, unauthenticated, malformed and
authority-field payloads; frozen-recipient enforcement; minimal privacy-safe
response; no audit on refusal; audit-failure tolerance), and updated
`assignments-publish.test.ts` (server-built URL; arbitrary client URL
ignored). App: `deepLink/route.test.ts`, `deepLink/wire.test.ts`,
`deepLink/arrival.test.ts` (silent handoff; practice; informational; each
failure state; no leaked internal code; retry re-resolves). Full suites green
except the pre-existing curriculum-manifest SHA drift.

Deferred hardening (Sprint 28). The manual `studentsCompleteOnboarding`
path shares the same non-atomic activation seam (record active, then
custom-claims, then audit) that Phase 3 self-healed for LMS onboarding; it
was intentionally left unchanged in Phase 3 and is NOT touched in Phase 4.
Recorded here as deferred pre-release hardening for Sprint 28, unchanged from
the Phase 3 note.

---

## Phase 5 - Integration fixes and lifecycle stitching

**Objective.** Stitch Phases 2 through 4 into the two end-to-end lifecycles
and correct defects discovered while wiring.

**Files likely affected.** Entry-point wiring (`app/src/index.ts`), the
route table, session bootstrap interaction with the `/app/a/` arrival, and
any surface transition seams uncovered during integration.

**Exact behaviors.** The manual lifecycle (Path A) and the Classroom
lifecycle (Path B) run end to end in a single environment. A
provisioned student arriving on a deep link is routed to onboarding, then
re-resolves. My Results updates after an attempt. The teacher sees the
attempt.

**Tests.** Integration tests under the emulator for the stitched
transitions; any defect gets a deterministic regression test.

**Security assertions.** No invariant regresses during stitching; the
stitched flow reads only caller-scoped student data and derives all
identity facts server-side.

**Stop conditions.** Stop if stitching requires relaxing any boundary; the
correct response is to keep the boundary and adjust the surface.

**Certification implication.** Prepares both chains for Phases 7 and 8.

**Status - IMPLEMENTED (deterministic evidence; pending browser and
emulator certification in Phase 7).** Landed uncommitted for review. Phase 5
resolved the one lifecycle gap Phase 4 explicitly deferred: the teacher
late-recipient affordance (Decision 3), which closes the frozen-recipient
recovery path for a Google Classroom student who signs in after publication.

Candidate source (the enrolled-non-recipient question). Phase 4 deferred the
affordance because "no such data source exists on Assignment Detail (the
roster surface lists only recipients)." Phase 1 of Phase 5 traced the current
teacher data and confirmed this: `assignmentsRecipientList` returns only
recipients; the Classes surface reads `classes/{classId}` documents, not
enrollments; and while the Firestore rules do admit a teacher `list` of
`enrollments` filtered by `classId` for an owned class, the enrollment
document carries no canonical display name, and resolving one requires reading
`users/{studentId}` and the enrollment override server-side
(`resolveRosterDisplayName`, PDR-028), which the client cannot do. A
client-side set difference could therefore only render raw student uids, not
the approved roster display names. Existing teacher data is thus NOT
sufficient to render candidates safely, so the smallest teacher-scoped read
was created (blueprint "IF EXISTING DATA IS NOT SUFFICIENT" branch).

- New server read `platform/functions/src/assignments/assignments-recipient-candidates.ts`
  (`assignmentsRecipientCandidatesList`). Authorization mirrors
  `assignmentsRecipientList` exactly: active-teacher role, owning teacher,
  same school, district boundary via `requireDistrictContext`, and the same
  forbidden-request-key set. It computes a pure server-side set difference:
  the active enrolled population of the assignment's frozen class (reusing the
  certified `loadInitialRecipientPopulation(classId, schoolId)` helper that
  first publication uses to freeze recipients) MINUS the assignment's current
  recipient population (filtered identically to the recipient list). Only a
  `published` assignment yields candidates; `draft`, `closed`, and every other
  state return an empty list without reading enrollments (no addable student
  exists, PDR-029j). Display names are resolved server-side through the same
  `createRosterDisplayNameResolver` the recipient list uses, so the projection
  carries exactly the minimum studentId + display name already approved for
  teacher roster views - no attempt, session, score, answer, provider
  identity, OAuth, or LMS roster metadata. Exported from the assignments
  domain index and the root `index.ts`.

Teacher UX (the narrowest affordance). `app/src/assignments/detail/detail.ts`
gains a "Students not yet assigned" section beneath the existing roster,
rendered only for a `published` assignment and only when both new seams are
wired (absent otherwise, so the pre-Sprint-27 detail surface is byte-for-byte
unchanged; a closed or draft assignment never shows it). The section lists
each candidate by display name with a single "Add to assignment" control. It
is one-student-at-a-time explicit teacher intent - no bulk gesture, no select
all - which best preserves PDR-029. Assignment Detail is not redesigned: the
summary, attempt list, per-question detail, recipient roster, publication
state, and lifecycle controls are untouched; the section is additive.

Recipient mutation (reuse, provenance, idempotency). The Add control calls the
certified `assignmentsRecipientAdd` unchanged. The client sends only
`{ assignmentId, studentId }`; every ownership field, the recipient `source`,
the status, and the timestamp are derived and owned server-side. The server
enforces active teacher, assignment ownership, `published` status, and an
`active` enrollment in the frozen class and school; writes exactly one
`recipients/{studentId}` with `source: "manualAddition"` (PDR-029h); emits
`assignments.recipientAdded`; and is idempotent (a repeat returns
`added: false` and mutates nothing). The client adds a double-click guard (the
section locks while any add is in flight); the two guards compose. On success
the surface refreshes through the same cache-drop + rerender seam the
lifecycle actions use, so the roster above and the candidate list below both
re-fetch once and reflect the newly assigned student without a broad page
reload; no student client state is manipulated.

Post-add resolver regression (deterministic evidence). A successful add writes
the exact `recipients/{studentId}` shape (`buildRecipientCreationWrite` with
`status: "assigned"` and the district/school ownership fields) that the
Phase 4 resolver authorizes on: `lmsDeepLinkResolve` reads it through
`isCanonicalRecipient`, whose match predicate is
assignmentId + studentId + schoolId + districtId + `status === "assigned"`.
`assignments-recipient-add.test.ts` asserts the write shape and
`deep-link-resolve.test.ts` asserts the authorized-recipient resolution, so
the "add then the next resolve authorizes" transition is proven at the domain
level without a browser chain. A full browser/emulator run of this transition
is Phase 7.

Security. Teacher intent is required for every add; no automatic or bulk
addition exists anywhere; roster sync still never mutates a published
assignment's recipients (`sync-engine.ts` untouched); the deep-link resolver
still never mutates recipients (`deep-link-resolve.ts` untouched); no student
self-add path exists; every read and write is district- and school-scoped and
assignment-owner-scoped; no Google provider ID, OAuth token, or hidden LMS
metadata enters the candidate projection or any new surface. No new audit
event was introduced (the candidate read only logs a count; the add keeps its
existing `assignments.recipientAdded` event).

Files changed. New: `assignments-recipient-candidates.ts` (+ test),
`app/src/assignments/detail/late-recipient-wire.ts` (+ test),
`app/src/assignments/detail/late-recipient.test.ts`. Modified:
`platform/functions/src/assignments/index.ts` and
`platform/functions/src/index.ts` (export the new callable),
`app/src/assignments/detail/detail.ts` (the section + two deps),
`app/src/index.ts` (wire and per-session teardown of the two callables).

Tests. Functions: `assignments-recipient-candidates.test.ts` (23 cases:
authorization and forbidden-key rejection, owner and cross-school refusal,
set-difference correctness, already-recipient suppression, cross-district and
non-assigned recipient-record defensiveness, no attempt/score/provider fields,
and draft/closed lifecycle gating that never reads enrollments). App:
`late-recipient-wire.test.ts` (9 cases: callable names, only the id pair sent,
no client-controlled `source`/ownership field, defensive parse, idempotent
`added:false`, rejection propagation) and `late-recipient.test.ts` (12 cases:
section visibility gated on published + both seams, absence when seams unwired
and for closed, empty/one/many candidate states, calm read-error state, only
display name shown, add invokes the callable with the id pair, in-flight
disable + pending label, double-click guard, refresh-on-success removes the
student, and error recovery + retry). Full app suite: 1091 passed, 1 failed
(the pre-existing curriculum-manifest SHA drift, unrelated to Phase 5). Full
Functions suite: 1699 passed, 0 failed. Typecheck and lint clean on both
projects.

Manual class note. The late-recipient mechanism is domain-correct for manual
classes too, because `assignmentsRecipientAdd` and the enrollment population
read do not distinguish `enrollmentSource`; a teacher-added manual enrollee is
an equally valid candidate. Sprint 27's requirement is the Classroom timing
case; no new manual-class roster feature was added.

Deferred hardening (Sprint 28), unchanged. The manual
`studentsCompleteOnboarding` path still shares the non-atomic activation seam
that Phase 3 self-healed for LMS onboarding; it remains untouched and deferred
to Sprint 28. Broad Assignment Detail polish remains Sprint 28. No Phase 6+
work was started.

---

## Phase 6 - Deterministic validation

**Objective.** Run the deterministic suites for the changed domains and
confirm green.

**Files.** The unit and rules suites touching students, assignments,
recipients, assessments, and LMS.

**Behaviors.** Execute the relevant deterministic tests; do not run
unrelated heavy suites.

**Tests.** All new and affected unit and rules tests pass; no regression
in Sprint 24, 25, 26 behavior.

**Security assertions.** Rules tests confirm caller-scoped student reads,
server-mediated enrollment, recipient enforcement, and district isolation.

**Stop conditions.** Stop on any red test or any rules regression until
resolved.

**Certification implication.** Deterministic evidence class for every
workstream.

**Status - VALIDATED.** Recorded in
`docs/platform/SPRINT_27_PHASE_6_VALIDATION_REPORT.md`. Disposition:
PHASE 6 VALIDATED - READY FOR BROWSER CERTIFICATION. No production code was
changed; no defect required correction.

- Functions: typecheck clean, lint clean, 91 suites / 1699 tests / 0
  failures.
- App: typecheck clean, lint clean, 65 suites (64 passed, 1 failed),
  1092 tests (1091 passed). The single failure is the known
  curriculum-manifest SHA drift (`curriculumManifest.test.ts`), a declared
  Sprint 27 non-goal (definition §14) and a Sprint 29 item; no Sprint 27
  file touches `index.html` or the manifest, so it is not a Sprint 27
  regression.
- Rules: not executed this session - a pre-existing user-owned Firebase
  emulator (importing `sprint26-pathb-cert-state`) held port 8080, and
  running the rules harness would have required killing that emulator or
  wiping its seeded state via `clearFirestore`. Sprint 27 changed zero
  Firestore rules (`firestore.rules` unmodified since Sprint 25, commit
  `9b073ed`), so no rules regression is possible; the committed rules suite
  from the certified Sprint 26 baseline remains applicable, and the rules
  layer relevant to Sprint 27 was verified by static inspection. Recommended
  follow-up: run the standalone rules suite once the port is free (or during
  Phase 7 emulator certification) and record exact counts.
- Every validation target (A through O), the traceability matrix, the
  security negative-case matrix, the Phase 7 browser handoff, and the
  Phase 8 live-provider handoff are recorded in the Phase 6 validation
  report. Deferred Sprint 28 items (including the manual-onboarding claims
  self-heal) remain deferred.

---

## Phase 7 - Browser and emulator certification

**Objective.** Certify Path A as one integrated browser and emulator flow,
and the LyfeLabz-controlled portions of Path B.

**Behaviors.** Execute the blueprint §13 chains under the Firebase Emulator
Suite plus browser, with Google Classroom provider behavior supplied
through the fixture transport for Path B.

**Tests.** The chained runs produce the expected teacher-visible attempt,
the expected My Results update, silent arrival on the deep link, and the
late-recipient behavior.

**Security assertions.** No cross-student leakage, no client destination
injection, no recipient or enrollment bypass observed in the integrated
runs.

**Stop conditions.** Stop and correct any defect the chain reveals within
scope, or document and defer with a clear disposition.

**Certification implication.** End-to-end evidence for Path A and the
LyfeLabz-controlled Path B.

**Status - BROWSER CERTIFIED WITH DOCUMENTED LIMITATION.** Recorded in
`docs/platform/SPRINT_27_PHASE_7_BROWSER_CERTIFICATION.md`. Disposition:
PHASE 7 BROWSER CERTIFIED WITH LIMITATION - READY FOR LIVE PROVIDER
CERTIFICATION. Path A (manual class), Path B (LyfeLabz-controlled Classroom
chain), Path C (late-enrollment recovery), and Path D (signed-out deep-link
auth round trip) all PASS in the browser against emulated backend state, with
matching backend evidence at every step; all three required negative
assertions PASS; the Firestore Rules suite passed standalone (18 suites, 228
tests, 0 failures). One genuine Sprint 27 defect (D1) was found and corrected
during certification: the `/app/a/{assignmentId}` deep-link route could not
load the app bundle because `app/index.html` referenced it with a relative
path that the two-segment SPA rewrite resolved to HTML; corrected narrowly to
the absolute `/app/dist/bundle.js` and re-certified in the browser, and the
deterministic app suite re-run (1091 passed, 1 pre-existing manifest-drift
failure). The single limitation is O1 (a pre-existing teacher "Close
assignment" UI gap on the Classroom-linked Assignment Detail, out of Sprint 27
scope), which affected only the method of the closed-assignment negative (the
assignment was closed through the canonical `assignmentsClose` callable rather
than a UI button); the Sprint 27 resolver behavior itself was certified. The
live Google `courses.courseWork.create` boundary remained for Phase 8.

---

## Phase 8 - Narrow live-provider certification

**Objective.** Prove only the Google boundary that cannot be responsibly
faked: `courses.courseWork.create` accepts the server-built
`https://app.lyfelabz.com/app/a/{assignmentId}` link material and returns a
coursework record.

**Behaviors.** A single genuine publication against real Google Classroom
using the server-built URL, confirming the coursework link material is the
canonical LyfeLabz deep link. The resolver requires no live-provider
evidence.

**Tests.** One live publication with operator confirmation; account
chooser behavior is not a criterion; no grant manipulation.

**Security assertions.** No token leaves the server; the URL carries no
PII; the coursework link is the server-built URL, not a client string.

**Stop conditions.** Stop if the live boundary cannot be exercised without
manipulating grants or without production rollout; record the limitation
rather than forcing it.

**Certification implication.** Live-provider evidence class for Path B, at
the one boundary that matters.

**Status - LIVE PROVIDER CERTIFIED.** Recorded in
`docs/platform/SPRINT_27_PHASE_8_LIVE_PROVIDER_CERTIFICATION.md`. Disposition:
PHASE 8 LIVE PROVIDER CERTIFIED - READY FOR CLOSEOUT. A single real Google
Classroom `courses.courseWork.create` accepted the server-built
`https://app.lyfelabz.com/app/a/s27cert-deeplink-1` link material and returned
coursework `875115775254` in the linked certification course `871447706346`; a
live read-back confirmed the stored material link is exactly that server-built
deep-link URL (no bare lesson URL, no localhost, no client-supplied URL).
Existing publication authorization was sufficient (no OAuth widening, no
reconnection). No production deployment; nothing staged, committed, or pushed.
No code change was required, so Phase 6/7 deterministic evidence remains
current. Sprint 25 B13 not reopened. Sprint 27 is not closed; Phase 9 owns
closeout.

---

## Phase 9 - Closeout

**Objective.** Record the Sprint 27 completion report with final
certification findings, evidence classes, and any deferred defects.

**Files.** A new `SPRINT_27_COMPLETION_REPORT.md`; narrow reconciliation
notices only where a landed change requires them (broad reconciliation is
Sprint 29).

**Behaviors.** Summarize the certified chains, the evidence class of each
result, the preserved invariants, and the disposition of any discovered
defect.

**Tests.** None beyond the certification evidence already recorded.

**Security assertions.** Confirm every load-bearing invariant held through
certification and that no new token, secret, PII, or Google-identity
exposure was introduced.

**Stop conditions.** Do not declare completion while any exit criterion in
definition §17 is unmet.

**Certification implication.** Sprint 27 closes with evidence, not a code-
complete claim.

**Status - COMPLETE.** Recorded in
`docs/platform/SPRINT_27_COMPLETION_REPORT.md`. Disposition: SPRINT 27
COMPLETE AND CERTIFIED WITH DOCUMENTED LIMITATIONS - READY FOR HUMAN REVIEW
AND COMMIT. Phase 9 reconciled the working tree (every changed and new
source, test, and documentation file maps to a Sprint 27 phase; no unrelated
change is absorbed), audited the implementation against the approved
architecture (no discrepancy; no refactor for cleanliness), re-ran the final
deterministic validation (Functions 91 suites / 1699 tests / 0 failures; App
65 suites / 1092 tests / 1 pre-existing curriculum-manifest SHA drift
failure; Rules unchanged, Phase 7 result 228/228 applicable), performed the
static security and hygiene sweep (no secret, token, PII, localhost in
production deep-link code, TODO/FIXME, or em dash introduced; the Phase 7
emulator safety snapshot `sprint26-pathb-live-snapshot-2026-08-19` was
gitignored via a new `platform/firebase/*-snapshot-*/` pattern so it cannot
enter the commit set), created the canonical completion report, and updated
the roadmap and this plan. Nothing staged, committed, pushed, or deployed;
the human reviewer commits Sprint 27 manually.

Phase status summary: Phase 1 complete; Phase 2 complete; Phase 3 complete;
Phase 4 complete; Phase 5 complete; Phase 6 validated; Phase 7 browser
certified with documented limitation; Phase 8 live provider certified;
Phase 9 complete.

---

## Sequencing rationale

The order front-loads the two additive student surfaces (My Results,
Phase 2; LMS activation, Phase 3) because they are independent and
low-risk, then lands the deep-link change (Phase 4) that both edits a
certified publication path and adds the resolver and route. Decision 3 is
folded into Phase 4 because the recipient behavior is exercised with the
deep link in Path B. Integration, deterministic validation, and the two
certification tiers follow. If a repository dependency surfaces during
implementation that justifies reordering (for example the deep-link route
being a prerequisite for exercising My Results in the browser chain),
Phases 2 through 4 may interleave, provided each phase's stop conditions
still gate it.

*End of implementation plan.*
