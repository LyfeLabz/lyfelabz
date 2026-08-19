# Sprint 27 Architectural Blueprint - Student Classroom Lifecycle Completion

Status: Phase 1 architecture. Scope-of-record for how Sprint 27 is
implemented. This blueprint resolves the four architectural decisions the
Sprint 27 definition deferred to Phase 1 and produces the canonical plan
implementation follows. It authorizes no code, no test change, no
deployment, no OAuth initiation, and no Firebase or Google state change.

Companion documents:
- `SPRINT_27_DEFINITION.md` (scope of record; this blueprint is its Phase 1 companion)
- `SPRINT_27_IMPLEMENTATION_PLAN.md` (ordered implementation phases derived from this blueprint)
- `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` (PDR-027; deep-link, resolver, URL contract)
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (session, attempt, recipient enforcement)
- `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` (identity bridge, activation, enrollment authority)
- `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` (PDR-025 district enforcement)
- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-024, PDR-025, PDR-026, PDR-027, PDR-029, PDR-030)

Style: no em dashes. Use " - " (spaced hyphen) as the sentence-level
break, per repository standard.

---

## 1. Purpose

The Sprint 27 definition proved three narrow student surfaces are
missing or broken and named four architectural decisions it deferred to
Phase 1. This blueprint resolves those four decisions against the current
repository, not against earlier reports, and records the client and
server ownership boundaries, security invariants, failure behavior,
certification architecture, and implementation sequencing that the
implementation sprint follows.

The four decisions are:

1. Student My Results read architecture.
2. Google-Classroom-student activation and enrollment sequence.
3. Late enrollment versus frozen-recipient behavior.
4. Assignment-aware Google Classroom deep-link architecture.

Everything in this blueprint is grounded in direct inspection of the
files named inline. Where a decision interprets a canonical PDR rather
than copying an unimplemented historical detail, the interpretation is
stated explicitly with its rationale.

## 2. Scope

In scope for the architecture this blueprint governs:

- the client seam and student surface that expose My Results over the
  existing caller-scoped attempt read,
- the server-mediated onboarding and enrollment sequence that lets a
  Google-Classroom-rostered student reach `active` without a manual join
  code,
- the narrowest correct late-enrollment behavior for an assignment
  already published when a Classroom student later resolves,
- the assignment-aware deep-link route, server-side resolver, and
  server-authoritative destination construction that replace the current
  bare-lesson Classroom URL,
- the certification matrix for Path A (manual class) and Path B
  (Classroom-linked class).

Out of scope (see §15 and `SPRINT_27_DEFINITION.md` §14): learning
archive, multi-year portfolio, analytics or gradebook, grade sync,
background roster jobs or webhooks, generalized multi-school onboarding,
school or district selectors, a second LMS provider, production
deployment, and final v1 certification.

## 3. Current-state architecture (verified)

Every statement here was confirmed by direct file inspection during
Phase 1.

### 3.1 Attempt reads

- `assessmentAttemptsList`
  (`platform/functions/src/assessments/assessment-attempts-list.ts`)
  returns the authenticated caller's own completed attempts. It scopes
  the query as `attempts.where("studentId", "==", uid)` where `uid` is
  drawn only from `requireDistrictContext(request)`; it refuses any
  request that carries `studentId`, `uid`, `userId`, `districtId`,
  `schoolId`, `classId`, or `teacherId`. Every candidate document is
  defense-in-depth-checked against the caller's `districtId` and
  `schoolId` before projection. Non-student callers are refused with
  `role-forbidden`. The projection (`AssessmentAttemptSummary`) exposes
  only `attemptId`, `assessmentId`, `assignmentId`, `assessmentRevisionId`,
  `attemptNumber`, `score`, `maxScore`, `percentage`, `submittedAt`,
  `status`. It never spreads the source record, so `itemResults`,
  `responses`, answer-key material, `teacherId`, and every district
  internal are excluded by construction. Results are sorted
  `submittedAt` descending. It is exported and deployed
  (`platform/functions/src/index.ts` line 6). It has no client callable
  wrapper.
- `assessmentAttemptsListForClass` and `assessmentAttemptGetForTeacher`
  are the teacher, class-scoped reads. The teacher Assignment Detail wire
  (`app/src/assignments/detail/attempts-wire.ts`) reaches both. The
  class-scoped read returns every student's attempts in the class and
  their display names; it MUST NOT be reused for a student surface.

### 3.2 Student My Assignments

- `assignmentsListForStudent`
  (`platform/functions/src/assignments/assignments-list-for-student.ts`)
  is wired through `app/src/assignments/studentList/`. Its per-item shape
  is `{ assignmentId, lessonSlug, title, status: "published",
  publishedAt }`. It returns only published assignments the caller is
  authorized to work on (recipient-gated), and it carries no recipient
  document, session, attempt, score, or teacher-only field. The launch
  URL builder (`app/src/assignments/studentList/launch.ts`) composes
  `/lesson_<slug>.html?assignment=<encodedAssignmentId>` (with the
  Sprint 18 v2 override table) and encodes only the assignmentId.

### 3.3 Identity, activation, enrollment

- `authOnUserCreate`
  (`platform/functions/src/auth/auth-on-user-create.ts`) provisions the
  `users/{uid}` record to `provisioned` and, on a well-formed single
  `google.com` provider entry, calls `createOrConfirmExternalIdentity`
  to write the `externalIdentities` bridge. The bridge is created on the
  student's first Google sign-in, independent of activation or
  enrollment.
- `reconcileMyExternalIdentity`
  (`platform/functions/src/identity/reconcile-my-external-identity.ts`)
  re-reads the caller's Auth record server-side, reconciles the bridge,
  never trusts a client-supplied provider identifier, never echoes a
  provider identifier or email, and never creates an enrollment. It is
  exported and deployed but has no client caller.
- `studentsCompleteOnboarding`
  (`platform/functions/src/students/students-complete-onboarding.ts`)
  transitions `provisioned` to `active`. It requires a client payload of
  `{ role: "student", schoolId, displayName }`, resolves the school's
  `districtId` from the `schools/{schoolId}` record, writes activation
  claims via `writeCustomClaims`, and emits `students.activated`. The
  `schoolId` is client-supplied; the current client
  (`app/src/index.ts`) hardcodes `BETA_SCHOOL_ID = "school-beta"`.
- The manual student onboarding client flow (`app/src/index.ts`
  `onStudentOnboarding`) calls `studentsCompleteOnboarding` with the beta
  school, force-refreshes the ID token so the new claims are present,
  then calls `enrollmentsJoinByCode`.
- `enrollmentsJoinByCode`
  (`platform/functions/src/enrollments/enrollments-join-by-code.ts`)
  refuses a class whose `enrollmentSource === "lms"` (line 132), masking
  it as `enrollments.joinCodeNotFound`. LMS-linked classes reject join
  codes by design.
- The provisioned onboarding surface
  (`app/src/router/surfaces/index.ts` `makeProvisionedSurface`) presents
  a student form that requires a non-empty eight-character join code and
  validates it against `^[A-F0-9]{8}$`. There is no LMS path.

### 3.4 Roster synchronization and enrollment creation

- `synchronizeClassRoster`
  (`platform/functions/src/lms/roster/sync-engine.ts`), invoked by the
  certified `lmsClassesSyncRoster` callable, reads the upstream Classroom
  roster through the owning teacher's server-only OAuth grant (resolved
  through `resolveLiveCredential`), resolves each upstream member through
  the certified bridge `resolveActiveExternalIdentity({ providerId:
  "google.com", providerAccountId })`, and, for a resolved student who is
  not currently active-enrolled and has no prior terminal enrollment,
  creates an `enrollments/{enrollmentId}` record with `status: "active"`.
  An upstream member whose bridge does not yet exist resolves as
  `unresolved` and no enrollment is created. Enrollment creation is
  server-mediated; the deterministic `enrollmentIdFor(classId,
  studentUserId)` keeps it idempotent. The engine does not activate the
  student and does not write custom claims.

### 3.5 Recipient population

- `assignmentsRecipientAdd`
  (`platform/functions/src/assignments/assignments-recipient-add.ts`)
  is the certified late-recipient add. It is teacher-only, refuses every
  client-supplied ownership or override field, requires the assignment to
  be `published`, requires the target student to hold an `active`
  enrollment in the assignment's frozen class and school, writes exactly
  one `assignments/{assignmentId}/recipients/{studentId}` document with
  `source: "manualAddition"`, emits `assignments.recipientAdded`, and is
  idempotent (a second call returns `added: false` and mutates nothing).
- Recipient membership is the canonical population. `assignmentsListForStudent`,
  `assessmentSessionsBegin`, and `assessmentAttemptsFinalize` treat the
  recipient collection as authoritative (PDR-029l). A non-recipient is
  refused a session and refused an attempt.

### 3.6 Google Classroom deep link (current, non-conforming)

- Publication supplies a bare lesson URL. The client computes
  `` `${window.location.origin}${lesson.href}` `` in
  `app/src/shell/surfaces/curriculum.ts` (line 1775) and threads it as
  `lyfelabzAssignmentUrl` to `publishAssignment`
  (`app/src/shell/surfaces/shared/lmsPublication.ts`).
- The server publish callable `lmsAssignmentsPublish`
  (`platform/functions/src/lms/assignments-publish.ts`) accepts
  `lyfelabzAssignmentUrl` as a client string (validated only as
  non-empty, line 142) and passes it verbatim to the Google Classroom
  adapter as the coursework link material (line 319). The client is the
  source of truth for the Classroom destination URL. This violates
  PDR-027 §8.3 ("The URL is constructed by the publication callable, not
  by the client") and the PDR-027a URL-shape contract.
- There is no `/app/a/{assignmentId}` route and no `lmsDeepLinkResolve`
  callable in the tree. Confirmed by search.

## 4. Canonical PDR anchors

- **PDR-024h.** Silent arrival: a student launching from Google Classroom
  enters the correct authorized attempt context without selecting a class
  or an assignment.
- **PDR-024i.** The student identity menu is exactly My Assignments and
  My Results.
- **PDR-024j, k, l, m.** Submit equals completion; Improve My Score on
  every less-than-perfect best score; the four accessible status
  indicators, never color alone; celebrate improvement, never compare
  students, never punitive language.
- **PDR-025.** District security boundary; every student-facing callable
  is district-scoped and additive.
- **PDR-026d.** Answer keys are never client-readable.
- **PDR-026f.** Rollups (`attemptRollups`, `assignmentRollups`) are the
  named certified read path for My Results and teacher analytics. See §5
  for the Phase 1 divergence resolution.
- **PDR-027 (a through j) and the deep-link contract.** LyfeLabz owns the
  deep-link URL; the canonical `assignmentId` is the load-bearing key;
  the resolver is read-only against LyfeLabz state and never calls Google;
  server-side authorization precedes the attempt context; the URL carries
  no token, session, score, student, or Classroom identifier.
- **PDR-029d, h, l.** Frozen recipient population at first publication;
  late-recipient behavior only through `manualAddition`; session and
  attempt enforcement refuse a non-recipient.
- **PDR-029m, n.** Direct-query is the ratified bounded-pilot read policy;
  rollups are a future scalability optimization that must preserve
  identical semantics.

---

## 5. Decision 1 - Student My Results read architecture

### 5.1 What PDR-026f actually requires

PDR-026f must be read as three separable claims.

- **Product requirement.** A student can read their own result history,
  and no teacher surface reads `attempts/*` in bulk. My Results is a
  caller-scoped, privacy-preserving view of the student's own completed
  attempts, from which best score, attempt count, and status indicator
  are derived.
- **Proposed data architecture.** `attemptRollups/{assignmentId}__{studentId}`
  and `assignmentRollups/{assignmentId}` rewritten atomically on every
  attempt write by a single rollup Cloud Function. This is a scalability
  design, not the product requirement.
- **Privacy and security rationale.** Reads are caller-scoped; no
  cross-student data; no answer-key material; no teacher analytics
  reaches a student.

The proposed rollup storage does not exist in production code (verified;
no `attemptRollups` or `assignmentRollups` collection, writer, or read
path is present). PDR-029m and PDR-029n already ratified that the
direct-query path over `attempts` is acceptable for the bounded pilot and
that rollups are a future optimization which must preserve identical
metric semantics. The same reasoning that lets `assessmentAssignmentSummary`
compute teacher aggregates directly from `attempts` for the bounded pilot
applies to the student's own results.

### 5.2 Is caller-scoped `assessmentAttemptsList` safe and sufficient

Yes. Evaluated against each risk the definition names:

- **Caller scoping.** The query is `where("studentId", "==", uid)` with
  `uid` from verified claims only; no `studentId` input is accepted. A
  student can read only their own attempts.
- **School and district defense-in-depth.** Every candidate document is
  dropped unless its `districtId` and `schoolId` equal the caller's
  verified claim values. This is additive to PDR-025.
- **Answer-key exposure.** The projection omits `itemResults` (which
  carries `correctOptionId` and `explanation`) and `responses` by
  construction. No answer-key material crosses the boundary (PDR-026d).
- **Other-student exposure.** Impossible by the caller-scoped query and
  the district/school re-check.
- **Expected data volume.** Bounded pilot: tens of assignments per
  student, a small number of attempts each. A single unpaged read is
  acceptable and matches the `assessmentAttemptsList` design (single
  auto-index, in-memory sort).
- **Sorting and pagination.** The callable already sorts `submittedAt`
  descending server-side. No pagination is required for the pilot volume.
- **Client aggregation feasibility.** Best score, attempt count, and
  status are pure functions of the caller's own attempt list grouped by
  `assignmentId`. No cross-student computation is involved, so the
  "aggregation is server-mediated" rule (which exists to prevent
  cross-student client aggregation) is not engaged. This is single-student
  self-aggregation.
- **Best-score derivation.** Per `assignmentId`, the best score is the
  maximum `percentage`, tie-broken by higher `attemptNumber` then later
  `submittedAt`, mirroring PDR-029a and PDR-029b so the student's own
  best matches the teacher's representative attempt.
- **Attempt-count derivation.** The count of completed attempts for that
  `assignmentId` in the caller's list.
- **Status derivation.** From the best percentage: Ready to Begin (no
  completed attempt), Improving (a completed attempt below the Well Done
  threshold), Well Done! (high but under 100 percent), Perfect Score
  (100 percent). Rendered with icon plus text, never color alone
  (PDR-024l).

### 5.3 Decision

**USE EXISTING CALLER-SCOPED ATTEMPTS.** Sprint 27 wires My Results over
`assessmentAttemptsList` with client-side self-aggregation. It does NOT
build `attemptRollups` or `assignmentRollups`.

Interpretation note (deliberate, not accidental): PDR-026f's rollup
storage is an unimplemented scalability design. Its product requirement
and its privacy rationale are both satisfied by the caller-scoped read.
PDR-029m and PDR-029n explicitly authorize the direct-query path for the
bounded pilot and classify rollups as a future optimization that must
preserve identical semantics. Sprint 27 therefore satisfies PDR-026f's
intent while deferring its storage design, consistent with the ratified
bounded-pilot posture. When rollups are later built, My Results swaps its
read source without changing the derived semantics (best = highest valid
completed attempt, PDR-029a; tie-break PDR-029b). This divergence is
recorded so it is never mistaken for a silent contradiction of PDR-026f.

### 5.4 Client seam

- **New client callable wrapper.** `createAttemptsListForStudentCallable(functions)`
  in a new module under `app/src/assignments/studentResults/` (proposed:
  `wire.ts`). It calls `httpsCallable(functions, "assessmentAttemptsList")`
  with an empty payload, parses the response defensively into a frozen
  `StudentAttemptSummary[]` (mirroring the parsing discipline in
  `app/src/assignments/detail/attempts-wire.ts`), and drops any malformed
  item. It never sends a `studentId`. It reuses no teacher, class-scoped
  callable.
- **Dependency-injection boundary.** Injected into the route table exactly
  like `studentAssignmentsList`: a getter `studentResultsList?: () =>
  StudentResultsListCallable | null` on `SurfaceDeps`
  (`app/src/router/surfaces/index.ts`), wired from `app/src/index.ts` per
  active-student session so per-session state cannot leak. The student
  surface stays a pure DOM builder with no `firebase/*` import.
- **Student surface integration.** The active-student surface presents the
  PDR-024i two-surface menu (My Assignments, My Results). My Results is a
  new surface region that loads results and renders per-assignment result
  cards. My Assignments remains the existing region.
- **Data model presented to UI.** A per-assignment aggregate:
  `{ assignmentId, title, bestPercentage, attemptCount, statusIndicator,
  canImprove, launchUrl }`. Scores, counts, and status come from the
  `assessmentAttemptsList` attempts grouped by `assignmentId`. Title and
  `launchUrl` come from a client-side join against
  `assignmentsListForStudent` on `assignmentId` (both reads are
  caller-scoped). When an assignment is no longer listed by
  `assignmentsListForStudent` (for example a closed assignment that still
  has attempts), the card renders with a neutral fallback label and no
  Improve My Score control, because the launchable target is not
  available. This fallback is a known, acceptable minimum for the pilot
  and is recorded as a non-blocking gap (§17).
- **Aggregation responsibilities.** All grouping, best-score selection,
  tie-breaking, attempt counting, and status derivation happen on the
  client over the single-student attempt list. No cross-student data is
  read or computed.
- **Improve My Score.** Offered on every less-than-perfect best score
  (PDR-024k) by reusing the existing launch URL builder
  (`buildAssignmentLaunchUrl`), which routes the student back into the
  same assignment through the existing reassessment and session behavior.
  A perfect best score (100 percent) receives the Perfect Score indicator
  and offers no Improve My Score control.
- **Error, loading, empty states.** Mirror the existing active-student
  surface conventions: a loading indicator while the read is in flight, a
  calm empty state ("You have not completed any assignments yet.") when
  there are no attempts, and a recoverable error banner with a Try again
  control when the read fails. No punitive language on any state
  (PDR-024m).

### 5.5 Security invariants for Decision 1

- Caller-scoped reads only; no `studentId` accepted; no cross-student
  data.
- No answer-key material (the projection already excludes it).
- No class-level comparison; no teacher analytics surfaced to a student.
- District and school defense-in-depth preserved (already enforced by the
  callable).

---

## 6. Decision 2 - Google Classroom student activation and enrollment sequence

### 6.1 The lifecycle, traced

```
student first Google sign-in
  -> authOnUserCreate: users/{uid} = provisioned, externalIdentities bridge created
  -> (client) provisioned onboarding surface
  -> teacher runs lmsClassesSyncRoster -> resolveActiveExternalIdentity -> enrollments/{id} = active
  -> student activation (provisioned -> active, claims written)
  -> ID token refresh
  -> assignment recipient eligibility (recipient add, Decision 3)
```

The four states never collapse:
`external identity bridge != student activation != class enrollment != assignment recipient membership`.

### 6.2 A - How the server knows this is an LMS-rostered student

The client must not assert Google identity or Classroom membership. The
only authoritative LyfeLabz record that ties a specific student UID to an
LMS class is an `enrollments/{enrollmentId}` document whose referenced
class has `enrollmentSource === "lms"`. That enrollment is created only by
the server-mediated roster sync engine, which resolves the student
through the certified external identity bridge. There is no persisted
roster mirror (`lmsRosterLinks` is reserved and unpopulated), so the
enrollment is the authoritative signal.

Therefore the server determines LMS-rostered eligibility by reading, for
the authenticated caller's UID, whether an `active` enrollment exists in a
class whose `enrollmentSource === "lms"`. The class record supplies the
authoritative `schoolId` (and, through the school, the `districtId`). No
client-supplied `schoolId`, provider account ID, or Classroom identifier
is trusted.

This inverts the manual order deliberately. Manual: activate (client
schoolId from the beta constant), then join-code enrollment. LMS:
server-mediated enrollment first (via roster sync), then activation
derived from that enrollment. The two trust boundaries stay separate.

### 6.3 B - What the provisioned-student UI does

One onboarding surface with server-determined eligibility. The provisioned
surface keeps the existing manual join-code path unchanged and adds a
second, distinct LMS affordance. The safest flow is:

- The provisioned student sees a "My teacher uses Google Classroom" action
  alongside the existing "join with a class code" form.
- Choosing the Classroom action calls a server callable that checks LMS
  eligibility (an `active` enrollment in an LMS class for this UID) and,
  if eligible, activates the student. The student never types or selects a
  class, a school, or a Google identity. The client asserts nothing about
  roster membership.
- If the server finds no eligible enrollment, the surface shows a calm
  "Ask your teacher to add you, then try again" state and offers a retry.
  It never lets the student self-assert membership.

The manual and LMS trust boundaries are not merged: the manual path still
requires a valid join code and the beta school constant; the LMS path
requires a server-confirmed LMS enrollment and derives the school from
that enrollment.

### 6.4 C - What `studentsCompleteOnboarding` does

`studentsCompleteOnboarding` cannot be reused unchanged for the LMS path,
because it requires a client-supplied `schoolId` and performs no
enrollment check. Reusing it for LMS would either re-introduce a
client-asserted `schoolId` or force the LMS path through the beta
constant, neither of which derives the school from the authoritative
enrollment.

Decision: introduce a new narrow server-mediated activation callable,
proposed name `studentsCompleteLmsOnboarding`, that:

1. requires an authenticated caller,
2. loads the caller's `users/{uid}` and requires `status === "provisioned"`
   (idempotent no-op when already `active` with `role === "student"`, like
   the manual callable),
3. finds an `active` enrollment for the caller's UID in a class with
   `enrollmentSource === "lms"`; refuses with a canonical
   `students.noLmsEnrollment` identifier when none exists,
4. derives `schoolId` from the enrolling class record and `districtId`
   from the school record (never from the client),
5. writes activation via the existing `writeCustomClaims` helper and
   emits `students.activated` (reusing the canonical vocabulary; no new
   audit kind),
6. accepts only a `displayName` from the client, and never a `schoolId`,
   `classId`, provider account ID, or Classroom identifier.

This is a single-purpose additive callable that reuses every canonical
helper. It is not a refactor of `studentsCompleteOnboarding`; the manual
callable is untouched. This avoids speculative refactoring while keeping
the client-supplied-`schoolId` trust surface out of the LMS path.

Alternative considered and rejected: adding an `enrollmentGated` mode to
`studentsCompleteOnboarding`. Rejected because it entangles two trust
models in one callable and risks the manual path silently gaining an
enrollment gate or the LMS path silently gaining a client `schoolId`.

### 6.5 D - Role of `reconcileMyExternalIdentity`

**No client use required.** The external identity bridge is already
created by `authOnUserCreate` on first sign-in, so roster sync can resolve
the student without any client reconciliation call.
`reconcileMyExternalIdentity` remains an idempotent, identity-only,
server-mediated confirmation callable. It is never an enrollment
shortcut, and Sprint 27 does not wire it into the enrollment or activation
path. It stays available as a defensive recovery lane for the documented
edge where provider data changed after account creation; wiring it is out
of Sprint 27 scope. This corrects the earlier assumption that its client
wiring was the primary missing identity mechanism.

### 6.6 E - When roster sync is re-run

The teacher manually re-runs `lmsClassesSyncRoster`. This is the least
disruptive design and uses the existing certified callable. The ordering
fact is load-bearing: roster sync can only create an enrollment for a
student whose bridge already exists, which means the student has already
signed in. A sync run before the student's first sign-in classifies them
`unresolved`. So the canonical sequence is:

1. teacher imports and activates the Classroom class,
2. students sign in to LyfeLabz at least once (bridge created),
3. teacher runs roster sync (now the signed-in students resolve and gain
   `active` enrollments),
4. each student completes LMS onboarding (activation derived from the
   enrollment).

Sprint 27 introduces no background roster job and no webhook (definition
§14). A student-initiated server-side re-resolution is explicitly not
adopted, because it would require a student-triggered path to read Google
Classroom under the teacher's OAuth grant, crossing the server-only token
boundary and the "resolver never calls Google" posture. The teacher
re-sync gesture keeps roster reads server-mediated and teacher-owned. The
onboarding failure state in §6.3 ("ask your teacher to add you, then try
again") is the honest surface for a student who signed in after the last
sync.

### 6.7 F - Claims refresh

Required. After activation the student must force-refresh the Firebase ID
token before any enrollment-scoped or assignment-scoped read, because the
new `role`, `schoolId`, and `districtId` claims are only on a refreshed
token (PDR-025d, PDR-025j). This mirrors the existing manual client
behavior (`app/src/index.ts` calls `currentUser.getIdToken(true)` after
`studentsCompleteOnboarding`). The LMS onboarding client path performs the
same force-refresh after `studentsCompleteLmsOnboarding` succeeds and
before it routes the student to My Assignments.

### 6.8 Security invariants for Decision 2

- Enrollment stays server-mediated; no client `create` on `enrollments`.
- No client-asserted provider account ID, Classroom membership, class
  membership, or school or district membership.
- School and district are derived from the authoritative enrollment and
  school records, never from the client.
- The manual join-code path and its trust boundary are unchanged.
- Activation writes claims only through `writeCustomClaims`; no new claim
  key, no new lifecycle field, no new audit kind.
- `reconcileMyExternalIdentity` remains identity-only.

---

## 7. Decision 3 - Late enrollment and frozen-recipient behavior

### 7.1 The case

An assignment is published (frozen recipient population captured from the
active enrollment roster at first publication, PDR-029d). A Classroom
student later signs in, is resolved by a subsequent roster sync, and gains
an `active` enrollment. That student is not a recipient of the
already-published assignment (PDR-029h) and is refused a session and an
attempt (PDR-029l).

### 7.2 Options evaluated

- **Option 1 - teacher explicitly adds through existing
  `assignmentsRecipientAdd`.** Preserves teacher intent, uses the
  certified append-only `manualAddition` path, no new callable.
- **Option 2 - a narrow server "seat newly resolved roster student"
  action wrapping the same recipient-add semantics with explicit
  provenance.** Would require a distinct provenance `source` value or a
  new callable; PDR-029f fixes `source` to `classPublication`,
  `manualAddition`, or `lmsImport`, and PDR-029h routes a manual late-add
  to `manualAddition`. A new automatic seat action edges toward the bulk
  gesture PDR-029h reserves for a superseding sprint.
- **Option 3 - no late addition; teacher reissues another assignment.**
  Heavier for the teacher and produces a second assignment record; not
  warranted when the certified single-recipient add already exists.
- **Option 4 - another existing canonical mechanism.** None exists beyond
  `assignmentsRecipientAdd`.

### 7.3 Decision

**Option 1.** The narrowest correct behavior is the teacher explicitly
adding the newly enrolled student through the existing
`assignmentsRecipientAdd` callable. Sprint 27 adds no new server callable
for late enrollment and authorizes no automatic addition of new
enrollments to published assignments. If a teacher-facing affordance to
invoke the add is not already present on Assignment Detail, Sprint 27 may
wire a minimal teacher control that calls the existing callable; the
server semantics are unchanged.

For the chosen approach:

- **Actor.** The owning teacher (the assignment's frozen `teacherId`).
- **Authorization.** `assignmentsRecipientAdd` already enforces active
  teacher, assignment ownership, published status, and an `active`
  enrollment for the target student in the frozen class and school, all
  district-scoped.
- **User experience.** The teacher chooses to add a specific student to a
  specific published assignment. No bulk gesture is offered.
- **Recipient `source`.** `manualAddition` (PDR-029h).
- **Audit event.** `assignments.recipientAdded` with `source:
  "manualAddition"` (PDR-029p), carrying no PII beyond the identifiers in
  PDR-029f.
- **Idempotency.** A repeat add returns `added: false` and mutates
  nothing.
- **Effect on assignment state.** None beyond the appended recipient
  document. The frozen population is extended by one immutable record, not
  redefined. No `assignments/{assignmentId}` field changes.
- **Effect on My Assignments.** After the add, the assignment appears for
  the newly added student (recipient-gated `assignmentsListForStudent`),
  and session begin and finalize now admit them (PDR-029l).
- **Failure behavior.** If the student lacks an active enrollment, the
  callable refuses with `assignments.recipientEnrollmentMissing` or
  `assignments.recipientEnrollmentInactive`; the teacher is directed to
  run roster sync first. No partial write occurs.
- **Google Classroom re-publication.** Not automatic (PDR-029h). The
  coursework already exists in the Classroom course and is visible to the
  whole Classroom roster; the LyfeLabz recipient add is what authorizes
  the late student's attempt. No second coursework write is issued.

### 7.4 Security invariants for Decision 3

- Frozen-recipient semantics preserved (PDR-029d): publication captures
  the population; later enrollment does not silently join it.
- Recipient writes are server-mediated, append-only, and teacher-intended
  (PDR-029g, PDR-029h).
- No automatic bulk mutation of published assignments (PDR-029h anti-decision).
- Roster sync never mutates a published assignment's recipient
  population; it only creates enrollments.

---

## 8. Decision 4 - Assignment-aware Classroom deep-link architecture

The PDR-027 contract already specifies this architecture in normative
detail. Phase 1 confirms the current contract wording is canonical and
that the current implementation diverges from it (client-supplied bare
lesson URL, no route, no resolver). Sprint 27 implements the contract as
written; it does not redesign it.

### 8.1 A - Destination ownership

The client MUST NOT continue supplying the destination. The deep-link URL
is constructed server-side by the publication callable from authoritative
LyfeLabz state, per PDR-027 §8.3. The server builds
`https://app.lyfelabz.com/app/a/{assignmentId}` from the resolved LyfeLabz
`assignmentId` it already loads; it never accepts a client-supplied
destination URL and never derives the destination from client lesson
data.

Host correction (Phase 1 re-verification, definition §16). PDR-027 §8.1
and `PLATFORM_OPERATIONS_SPECIFICATION.md` §5 through §7 fix the canonical
origin as `https://lyfelabz.com/`. That origin is a documented target
state that is reached only after Firebase Hosting takes over the apex from
GitHub Pages and GitHub Pages is retired
(`PLATFORM_OPERATIONS_SPECIFICATION.md` §17). That migration has not
happened. The current production authenticated platform serves from
`https://app.lyfelabz.com/app/`, while `lyfelabz.com` and `www.lyfelabz.com`
still resolve to the legacy GitHub Pages curriculum site, which does not
carry the app bundle (`SPRINT_24A_COMPLETION_REPORT.md` §9.1, §9.2; the
live LMS OAuth callback is `https://app.lyfelabz.com/app/lms-callback.html`
per `LMS_INTEGRATION_OPERATIONS.md` §4.2). A Classroom coursework link
written today to `https://lyfelabz.com/app/a/{assignmentId}` would land the
student on the GitHub Pages site with no app bundle and fail to resolve.
Sprint 27 therefore builds the URL against the current production host
`https://app.lyfelabz.com`. The PDR-027 `lyfelabz.com` wording is preserved
as the future canonical origin; when the apex migrates to Firebase Hosting,
the builder's host constant moves to `lyfelabz.com` with no other change,
because the `/app/a/{assignmentId}` route shape is host-independent. The
builder still refuses any preview or staging origin; the only production
host it emits is `app.lyfelabz.com` until the apex migration completes.

Concretely, `lmsAssignmentsPublish` stops reading
`payload.lyfelabzAssignmentUrl` as the coursework link material. Instead a
single server-side deep-link URL builder (the sole authorized producer,
PDR-027 §26 item 2) constructs the URL from the `assignmentId`. The
builder refuses to emit any URL that carries a query parameter, a
fragment, an alternate host, an `http` scheme, a lesson slug, or any
identifier other than the opaque `assignmentId` (PDR-027 §8.1, §8.2). The
client `lyfelabzAssignmentUrl` field is removed from the publish request
contract, and `app/src/shell/surfaces/curriculum.ts` stops computing
`window.location.origin + lesson.href`.

This closes the current security defect: today a compromised or buggy
client could make Classroom coursework point at an arbitrary external URL.
After this change the client cannot influence the Classroom destination.

### 8.2 B - Route contract

`/app/a/{assignmentId}` is confirmed canonical (PDR-027a, §8.1). The `a`
segment is the assignment-arrival routing hint scoped to `/app/**`. The
`{assignmentId}` is the sole path segment and the load-bearing key. No new
generic routing framework is introduced: the `/app/**` bootstrap already
owns authentication and dispatch; Sprint 27 adds one narrow arrival route
that hands the `assignmentId` to the resolver and then dispatches to the
existing student surface. The exact route spelling `/app/a/` matches the
PDR, so it is frozen for Sprint 27.

Route-shape verification (Phase 1). The `/app/a/{assignmentId}` route is a
single `/app/` prefix plus the `a/{assignmentId}` arrival segment, so under
the current production host it is
`https://app.lyfelabz.com/app/a/{assignmentId}`, never a doubled
`app.lyfelabz.com/app/app/...`. It matches the live app-router topology,
whose every route is an absolute `/app/**` path (`/app/signin`,
`/app/onboarding`, `/app/teacher`, `/app/student` in
`app/src/router/router.ts`), the sibling production URL
`https://app.lyfelabz.com/app/lms-callback.html`, and the Firebase Hosting
rewrite `/app/** -> /app/index.html` (`platform/firebase/firebase.json`).
The `/app/**` bootstrap therefore already receives the arrival request and
can preserve it across sign-in with no new rewrite.

### 8.3 C - Authentication round-trip

```
student clicks the Classroom link
  -> browser navigates to https://app.lyfelabz.com/app/a/{assignmentId}
  -> /app/** bootstrap establishes identity (IDENTITY_AND_ONBOARDING_SPECIFICATION.md §11, §16)
       - if not signed in, Google/Firebase sign-in completes first
       - the bootstrap preserves the arriving URL across the sign-in round trip
  -> client invokes lmsDeepLinkResolve with { assignmentId } as the sole payload
  -> server authorization (§8.4)
  -> client dispatches to the internal navigation target; no class or assignment selection
```

The destination survives authentication because the arriving `/app/a/{assignmentId}`
URL is the browser location the bootstrap returns to after sign-in
(PDR-027 §9, §10 step 3). The `assignmentId` is never persisted to
`localStorage`, `sessionStorage`, or a cookie beyond ordinary browser
history (PDR-027 §9). A provisioned student who arrives on the deep link
and is not yet `active` is routed into the onboarding surface (Decision 2);
after activation and the token refresh, the client re-invokes the resolver
for the same `assignmentId`. Silent arrival (PDR-024h) means no class or
assignment picker, not skipping identity or onboarding.

### 8.4 D - Authorization resolver

A new student callable `lmsDeepLinkResolve` (PDR-027 §17), read-only
against LyfeLabz state, performs in order (PDR-027 §10.1):

1. authenticated caller under an active LyfeLabz identity, else
   `unauthenticated`,
2. `role === "student"`, else `role-forbidden`,
3. `status === "active"`, else `account-inactive`,
4. load `assignments/{assignmentId}`, else `assignment-not-found`,
5. caller `districtId` claim equals the assignment `districtId`, else
   `district-mismatch` (PDR-025),
6. caller holds an `active` enrollment in the assignment's `classId`, else
   `enrollment-inactive`,
7. assignment is `published` or `closed` (refuse `assignment-not-published`
   for `draft`, `assignment-archived` for `archived`),
8. compute the internal navigation target,
9. emit `lms.deepLinkResolved`,
10. return the resolution payload.

Recipient-membership refinement (Phase 1 decision, additive and
fail-closed). PDR-027 §10.1 authorizes on enrollment. PDR-029l makes the
recipient collection the canonical population, and session begin refuses a
non-recipient. To keep silent arrival honest, the resolver additionally
reads the caller's recipient record for the assignment and sets
`attemptContext` accordingly: `authorized` when the caller is a recipient
and a new session may be begun, `informational` when the caller is
enrolled but not a recipient (or the window is closed, or the assignment
is `practice` mode). This is stricter than PDR-027 §10.1, never a
widening, and prevents dropping a student into a context that session
begin would immediately refuse. It reads the recipient collection only;
it writes nothing. If the pilot prefers the literal PDR-027 §10.1
behavior, the alternative is to authorize on enrollment and let session
begin surface the not-a-recipient refusal; the recipient-aware
`attemptContext` is preferred because it produces the calmer surface.

`lmsDeepLinkResolve` MUST NOT (PDR-027 §10.3): create, mutate, or delete a
session or attempt; write to `assignments`, `lmsAssignmentPublications`,
or `lmsClassLinks`; call Google Classroom; or return anything derived from
the caller's Classroom account or OAuth grant. URL possession is never
authorization.

Audit scope (Phase 1 recorded deviation from PDR-027 §23, deliberate and
narrowing). PDR-027 §23 lists two `lms.deepLinkResolved` transitions: the
success event emitted at step 9 above, and a refusal event carrying
`outcome: "refused"` and the §21 refusal reason. Sprint 27 emits only the
success event; a refused resolution writes no audit document (asserted by
`deep-link-resolve.test.ts`). This is a considered scope decision, not an
oversight. The refusal branches an authenticated caller can reach at will
with a guessed or malformed identifier - `deep-link-shape-invalid`,
`assignment-not-found`, `unauthenticated`, `role-forbidden` - would make
the resolver a caller-driven amplifier of append-only audit volume for no
security value, which the append-only sink is not meant to absorb. The
security-significant refusals (`district-mismatch`, `enrollment-inactive`,
and the enrolled-non-recipient informational path) remain fully enforced,
are observable through the resolver's structured logs, and are
independently re-enforced by `assessmentSessionsBegin` at the one boundary
that actually creates state. The success event is retained because it
records the authorization decision at the LMS trust boundary and is
required by PDR-027 §10.1 step 9. The append-only success write is the sole
document the read-only resolver produces and is explicitly permitted by
PDR-027 §17 ("MUST NOT write to any Firestore document except
`auditEvents/*`"), so "read-only resolver" means no domain-state mutation,
not zero writes. Adding the §23 refusal event is deferred to a later sprint
if operational monitoring shows a need; PDR-027 §23 and §24 remain the
future target and are not amended here.

### 8.5 E - Runtime handoff

The resolution payload (PDR-027 §10.2) contains exactly `assignmentId`,
`classId`, `activityId` (equivalent to `lessonSlug`), `internalTarget`,
and `attemptContext`. The client dispatches to `internalTarget`, which for
a `classroom`-mode recipient routes the student into My Assignments
pre-focused on this assignment, from which the existing launch URL builder
and the existing assessment runtime (session begin, autosave, resume,
finalize) take over. The resolver never duplicates assessment logic;
session creation remains the sole responsibility of
`assessmentSessionsBegin` (PDR-027 §10.3, PDR-026). A `practice`-mode
assignment routes to the lesson surface without invoking the assessment
pipeline.

### 8.6 F - Failure UX

Minimum states, each calm and non-leaking (PDR-027 §21, PDR-024m):

- **sign-in required** - the bootstrap runs sign-in; not an error surface.
- **onboarding required** - a provisioned student is routed to onboarding
  (Decision 2), then re-resolves.
- **not enrolled** (`enrollment-inactive`) - "This assignment is not
  available for your account. Ask your teacher for help."
- **not a recipient** (informational `attemptContext`) - the assignment is
  shown as informational (view only); "Ask your teacher to add you to this
  assignment" when appropriate.
- **assignment unavailable** (`assignment-not-found`, `assignment-not-published`)
  - "This assignment is not available right now."
- **assignment closed** (`assignment-archived`, or closed without grace)
  - "This assignment is closed."
- **generic retryable failure** - "We could not open this assignment.
  Try again in a moment." with a retry control.

No failure state leaks a classmate identifier, a Classroom coursework
identifier, another teacher's assignment identifier, or any roster or
assignment metadata beyond what the caller is authorized to see. The
resolver never reveals whether an `assignmentId` exists to a caller who
fails the district or enrollment check beyond the stable error identifier.

### 8.7 G - Live-provider boundary

- **Deterministic and emulator evidence** covers everything
  LyfeLabz-controlled: the URL builder and parser (shape in, shape out,
  refusals), the resolver authorization order and every refusal branch,
  the recipient-aware `attemptContext`, the district checks, the
  read-only invariant (static import-graph assertion that scorer, session,
  rollup helpers are unreachable from the resolver), and the publish
  callable now constructing the URL server-side.
- **Real Google evidence** is needed only where the Google boundary itself
  matters: that `courses.courseWork.create` accepts the server-built
  `https://app.lyfelabz.com/app/a/{assignmentId}` link material and returns a
  coursework record. The resolver never calls Google, so resolution needs
  no live-provider evidence. Account-chooser behavior is not a correctness
  criterion, and grants are not manipulated to manufacture scenarios.

### 8.8 Security invariants for Decision 4

- Server-authoritative destination construction; the client cannot point
  Classroom coursework at an arbitrary URL.
- URL carries no secret and no PII beyond the opaque `assignmentId`
  (PDR-027 §8.2).
- Resolver is read-only against LyfeLabz state and never calls Google
  (PDR-027d).
- Server-side authorization precedes the attempt context; URL possession
  is not authorization.
- District boundary preserved on publish and resolve (PDR-025, PDR-027h).
- No token, session identifier, score, or Classroom identifier in the URL,
  the resolution payload, an audit event, or a log line.

---

## 9. Data-flow diagrams (text)

### 9.1 My Results read

```
student surface (My Results)
  -> studentResultsList()  -> assessmentAttemptsList (caller-scoped)   -> attempts[]
  -> studentAssignmentsList() -> assignmentsListForStudent (caller-scoped) -> {assignmentId,title,lessonSlug}[]
  -> client join on assignmentId + self-aggregate (best %, count, status, canImprove)
  -> render per-assignment result cards + Improve My Score (launch URL)
```

### 9.2 LMS student activation and enrollment

```
first sign-in -> authOnUserCreate: provisioned + externalIdentities bridge
teacher: lmsClassesSyncRoster -> resolveActiveExternalIdentity -> enrollments (active, lms class)
student: studentsCompleteLmsOnboarding
    server: find active enrollment in an lms class for uid
            -> derive schoolId (class) + districtId (school)
            -> writeCustomClaims(active, student, schoolId, districtId)
            -> emit students.activated
client: getIdToken(true) -> My Assignments
```

### 9.3 Late recipient add

```
assignment published -> recipients frozen (classPublication)
new student signs in -> teacher re-syncs roster -> active enrollment
teacher: assignmentsRecipientAdd { assignmentId, studentId }
    server: published + owner + active enrollment checks
            -> recipients/{studentId} = { source: manualAddition }
            -> emit assignments.recipientAdded
student now recipient -> My Assignments shows it -> session begin admits
```

### 9.4 Deep-link arrival and resolution

```
teacher publish -> lmsAssignmentsPublish
    server builds https://app.lyfelabz.com/app/a/{assignmentId}  (no client URL)
    -> courses.courseWork.create(link=that URL)
student clicks link -> /app/a/{assignmentId}
  -> /app/** bootstrap establishes identity (sign-in if needed, URL preserved)
  -> lmsDeepLinkResolve({ assignmentId })  (read-only)
       auth -> student -> active -> assignment -> district -> enrollment -> published/closed
       -> attemptContext (recipient-aware) -> emit lms.deepLinkResolved
  -> client dispatches to internalTarget (My Assignments focused) -> assessment runtime
```

---

## 10. Client and server ownership boundaries

- **Server owns.** The caller-scoped attempt read; the LMS onboarding
  eligibility check and activation; enrollment creation (roster sync); the
  recipient add; the deep-link URL construction; the deep-link resolver
  and all authorization. Every school, district, provider, and Classroom
  fact is derived from server state.
- **Client owns.** Presentation and single-student self-aggregation for My
  Results; the onboarding gesture that requests LMS activation (asserting
  nothing about membership); the token force-refresh after activation; the
  dispatch to the resolver's `internalTarget`. The client never constructs
  a Classroom destination, never asserts identity or membership, never
  reads another student's data, and never computes cross-student
  aggregates.

---

## 11. Security invariants (consolidated, load-bearing)

- Caller-scoped student reads only; no cross-student attempt leakage.
- No client-supplied student identity, Classroom membership, class
  membership, or school or district assertion is trusted.
- No arbitrary destination URL injection: the deep-link URL is
  server-built from the `assignmentId`.
- Deep-link enumeration confers no access: the resolver authorizes
  server-side on identity, district, enrollment, and recipient state.
- Recipient enforcement and enrollment enforcement remain load-bearing;
  neither is bypassed by the deep link.
- Enrollment stays server-mediated; no client `create` on `enrollments`;
  no duplicate enrollment (deterministic `enrollmentIdFor`).
- Recipient add is idempotent; no duplicate recipient record.
- Stale claims fail closed; activation returns and the client performs a
  forced token refresh before assignment access (PDR-025j).
- `lms.identityMismatch` remains the publication-consent identity boundary
  (unchanged by Sprint 27).
- OAuth tokens remain server-only; no token, refresh token, or code
  crosses the callable boundary.
- No student PII, token, secret, or Google identity in any URL, audit
  payload, log line, or client surface.
- Frozen-recipient semantics preserved.

---

## 12. Failure and recovery behavior

- **My Results read fails.** Recoverable error banner with retry; no
  partial or misleading state; empty state when there are no attempts.
- **LMS onboarding finds no enrollment.** Calm "ask your teacher to add
  you, then try again" state; retry re-runs the eligibility check after
  the teacher syncs.
- **Activation succeeds but claims not yet refreshed.** The forced token
  refresh runs before assignment access; a stale-claim read fails closed
  and the client refreshes or signs out (PDR-025j).
- **Late student not a recipient.** The deep link resolves to
  informational; session begin refuses a non-recipient; the teacher adds
  the recipient through the existing path.
- **Deep-link resolver refusals.** Each maps to a stable error identifier
  and a calm surface (§8.6); nothing leaks.
- **Publication upstream failure.** Unchanged from Sprint 25: a failed
  Classroom write records `lms.publishFailed` and never falsely reports
  success; the server-built URL does not change this behavior.

---

## 13. Certification architecture

Two paths, with evidence classes kept distinct (definition §13).

### 13.1 Path A - Manual class (no real Google dependency)

One genuine chained browser and emulator run:

```
teacher creates class -> student joins by code -> teacher publishes assignment
  -> student sees My Assignments -> student launches -> student completes
  -> attempt persists -> My Results updates -> teacher sees the attempt
```

Evidence: deterministic unit and rules tests for each rule; Firebase
Emulator Suite plus browser for the integrated chain. My Results is
exercised in the chain (best score, attempt count, status indicator,
Improve My Score offered on a less-than-perfect best score).

### 13.2 Path B - Classroom-linked class

One chained architecture:

```
teacher imports/activates Classroom class -> roster
  -> student signs in -> external identity resolves -> student activates (LMS onboarding)
  -> enrollment established (roster sync) -> recipient treatment (frozen + manual add case)
  -> assignment published to Classroom (server-built deep link)
  -> student opens the deep link -> silent arrival -> completes -> teacher reviews
```

Evidence:

- **Deterministic** for individual rules and domain behavior: LMS
  onboarding eligibility and refusals; roster sync resolution; recipient
  add semantics; resolver authorization order and every refusal; URL
  builder and parser; district checks; the read-only import-graph
  assertion for the resolver.
- **Fixture transport** for Google Classroom provider behavior (roster
  read, coursework create) using the certified test-double seam, so most
  of Path B runs without real Google.
- **Emulator plus browser** for the LyfeLabz integration chain: sign-in
  to activation to enrollment to My Assignments to attempt to teacher
  review, and the `/app/a/{assignmentId}` arrival to resolver to runtime
  handoff.
- **Real Google** only at the provider boundary that cannot be
  responsibly faked: that `courses.courseWork.create` accepts the
  server-built `https://app.lyfelabz.com/app/a/{assignmentId}` link material
  and returns a coursework record. The resolver needs no live-provider
  evidence.

Google account-chooser behavior is not a correctness criterion; grants
are not manipulated. Production and final v1 certification remain out of
scope (Sprint 29).

---

## 14. Migration and backward compatibility

- **My Results** is additive: a new callable wrapper and a new surface
  region. No change to `assessmentAttemptsList`, `assignmentsListForStudent`,
  or any teacher surface.
- **LMS onboarding** is additive: a new `studentsCompleteLmsOnboarding`
  callable and a new provisioned-surface affordance. The manual
  join-code path, `studentsCompleteOnboarding`, and `enrollmentsJoinByCode`
  are unchanged. `BETA_SCHOOL_ID` remains for the manual path.
- **Late enrollment** requires no migration: `assignmentsRecipientAdd`
  already exists; Sprint 27 may add only a teacher affordance that calls
  it.
- **Deep link** is a behavior change to publication: the coursework link
  material moves from the client-supplied bare lesson URL to the
  server-built `/app/a/{assignmentId}` URL, and the client
  `lyfelabzAssignmentUrl` field is removed from the publish contract.
  Coursework already published in Sprint 25 or Sprint 26 continues to
  point at whatever URL was written then; PDR-027 §11.1 does not modify
  coursework after create, and no back-migration of existing coursework is
  in scope. New publications use the server-built URL. The
  `assignmentsListForStudent` launch URL (`?assignment=` query form) is
  unchanged and continues to serve in-app launches; the deep-link route is
  the Classroom-arrival path, and both resolve to the same assessment
  runtime.

---

## 15. Explicit non-goals

- No `attemptRollups` or `assignmentRollups` construction.
- No learning archive (PDR-024n) or multi-year portfolio (PDR-024o).
- No analytics, gradebook, or grade sync.
- No automatic or bulk addition of enrollments to published assignments.
- No background roster job or webhook; no student-initiated Google read.
- No generalized multi-school onboarding, school selector, or district
  selector; `BETA_SCHOOL_ID` stays for the manual path.
- No second LMS provider; no `lmsAssignmentUnpublish` implementation.
- No reopening of Sprint 25 B13; no weakening of frozen-recipient
  semantics.
- No production deployment; no final v1 production certification.

---

## 16. Implementation sequencing

The ordered phases are specified in `SPRINT_27_IMPLEMENTATION_PLAN.md`.
Summary order:

1. Architecture and documentation completion (this blueprint and the plan).
2. My Results client seam and surface (Decision 1).
3. LMS student activation and enrollment path (Decision 2).
4. Assignment-aware deep link: server URL construction, resolver, route
   (Decision 4), including the late-recipient teacher affordance if needed
   (Decision 3).
5. Integration fixes and lifecycle stitching.
6. Deterministic validation.
7. Browser and emulator certification (Path A and LyfeLabz-controlled
   Path B).
8. Narrow live-provider certification (Google coursework-create boundary).
9. Closeout.

Decision 3 has almost no server work (the callable exists) and is
sequenced with Decision 4 because the deep-link and recipient behaviors
are exercised together in Path B.

---

## 17. Risks

- **My Results title join gap.** An assignment no longer returned by
  `assignmentsListForStudent` (for example a closed assignment with
  historical attempts) yields a card without a title or Improve My Score.
  Mitigation: neutral fallback label and no launch control; recorded as a
  non-blocking pilot minimum. A future rollup or a bounded title read
  would close it.
- **Roster-sync ordering friction.** A student who signs in after the
  teacher's last sync cannot activate until the teacher re-syncs.
  Mitigation: the onboarding surface tells the student to ask the teacher
  to add them; the teacher re-sync is a one-gesture certified path. No
  background job is introduced.
- **Resolver recipient-check interpretation.** Adding a recipient-aware
  `attemptContext` is stricter than the literal PDR-027 §10.1 enrollment
  check. Mitigation: it is fail-closed and additive, never a widening; if
  the pilot prefers the literal contract, the fallback in §8.4 applies.
- **Deep-link publication change touches a certified path.** Moving URL
  construction server-side edits `lmsAssignmentsPublish` and the client
  publish path. Mitigation: the change is narrow (remove one client field,
  add one server builder), deterministic tests cover the builder and the
  refusals, and Sprint 25/26 publication behavior is otherwise unchanged.
- **Client-supplied `schoolId` on the manual path.** Out of Sprint 27
  scope per definition §16; the LMS path deliberately does not inherit it.

---

## 18. Definition of architectural completion

Architecture is complete when:

- Decisions 1 through 4 are each resolved with a single chosen approach
  and a stated rationale (done: §5 through §8).
- The PDR-026f divergence is resolved explicitly and recorded as a safe
  interpretation, not a silent contradiction (done: §5.3).
- The client and server ownership boundaries, the security invariants, the
  failure behavior, and the certification matrix are recorded (done: §10
  through §13).
- The implementation plan translates the blueprint into ordered phases
  with objectives, affected modules, tests, security assertions, stop
  conditions, and certification implications (in
  `SPRINT_27_IMPLEMENTATION_PLAN.md`).
- No production code, no test change, and no Firebase or Google state
  change is made by the Phase 1 task.

Disposition: ARCHITECTURE COMPLETE - READY FOR IMPLEMENTATION, pending the
explicit implementation authorization the definition requires.

*End of blueprint.*
