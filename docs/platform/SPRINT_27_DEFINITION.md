# Sprint 27 Definition - Student Classroom Lifecycle Completion & Certification

Status: Defined. Scope-of-record for Sprint 27. This document defines
what Sprint 27 does and does not attempt, grounded in the completed
Post-Sprint-26 Remaining Teacher Platform Roadmap Gap Analysis and the
focused Sprint 27 Student Lifecycle Pre-Definition Investigation. The
how-and-in-what-order implementation layer is a companion Phase 1
architectural blueprint produced at the start of implementation. This
document does not authorize implementation.

Companion / precedent documents:
- `SPRINT_26_DEFINITION.md` (immediate structural precedent)
- `SPRINT_26_COMPLETION_REPORT.md` (certified, committed, closed foundation)
- `SPRINT_25_COMPLETION_REPORT.md` (LMS publication foundation; B13 PASS WITH LIMITATION, not reopened)
- `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` (PDR-027; the deep-link, resolver, and URL contract)
- `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` (identity bridge, activation, enrollment authority)
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (session, attempt, recipient enforcement)
- `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` (student My Assignments / My Results, silent arrival)
- `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`
- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-019, PDR-020, PDR-024, PDR-025, PDR-027, PDR-029, PDR-030)
- `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` (phase sequence and v1 release sequence)

Style: no em dashes. Use " - " (spaced hyphen) as the sentence-level
break, per repository standard.

---

## 1. Status

Defined. Not started. No implementation, no code change, no test change,
no deployment, no OAuth initiation, and no Firebase or Google state
change is authorized by this document.

Sprint 26 (LMS UX Hardening) is complete, certified, committed, and
closed at `76f0162` ("Complete Sprint 26 LMS UX hardening"). Sprint 25
(LMS Assignment Publication) is complete and certified; its historical
B13 disposition remains PASS WITH LIMITATION and is not reopened by
Sprint 27. Sprint 24A and Sprint 24B are production certified.

Sprint 27 is an implementation-and-certification sprint. It is not a
student-platform rebuild. Most underlying domain infrastructure already
exists. The sprint prefers narrow wiring and integration work over new
backend feature families.

## 2. Sprint title

**Sprint 27: Student Classroom Lifecycle Completion & Certification.**

## 3. Background - why Sprint 27 exists

The teacher side of the classroom lifecycle is substantially built and,
in several places, production certified. Identity, schools, teachers,
classes, enrollments, assignments, submissions, the assessment pipeline,
the Google Classroom connection foundation, roster synchronization, and
assignment publication are all implemented. Sprint 25 delivered
publication of a LyfeLabz assignment into a Google Classroom course.
Sprint 26 hardened the teacher experience around that certified
capability.

The student side of the same lifecycle is where the remaining evidence
gap lives. Individual student lifecycle components carry substantial
deterministic and unit coverage. The backend assignment, session, and
attempt architecture exists. The client in-app assignment path exists.
What has not yet been certified as one integrated browser and emulator
flow is the complete chained lifecycle:

```
teacher assigns
  -> student receives
  -> student opens
  -> student completes
  -> attempt persists
  -> teacher reviews
```

Sprint 27 closes that evidence gap and wires the three narrow student
surfaces that the pre-definition investigation proved are genuinely
missing or genuinely broken:

1. the canonical My Results surface (unwired today),
2. a safe onboarding and enrollment path for a Google Classroom
   rostered student (currently broken because the only client
   onboarding path requires a manual join code),
3. an assignment-aware Google Classroom deep link that carries the
   LyfeLabz assignment context into the authenticated assessment runtime
   (today the published coursework URL is a bare lesson URL).

## 4. Evidence motivating the sprint

Every claim below was confirmed by direct repository inspection during
the focused pre-definition investigation. File anchors are the
evidence-of-record and the starting points for implementation. They are
not a promise that no neighboring code moves.

### 4.1 My Results is unwired; the backend read already exists

PDR-024i fixes the student identity menu as exactly two surfaces: My
Assignments and My Results. The current student surface implements the
My Assignments path (`app/src/assignments/studentList/`, the
`AssignmentsListForStudent` callable) but does not implement My Results.

The backend read needed for the minimum My Results experience already
exists: `assessmentAttemptsList`
(`platform/functions/src/assessments/assessment-attempts-list.ts`)
returns the caller's own completed-attempt history, scoped entirely by
the verified caller (`where("studentId", "==", uid)`), and is exported
and deployed at `platform/functions/src/index.ts`. It has no client
callable wrapper today. The teacher Assignment Detail wire
(`app/src/assignments/detail/attempts-wire.ts`) wires the different,
class-scoped `assessmentAttemptsListForClass` and
`assessmentAttemptGetForTeacher` callables, not this caller-scoped read;
there is no student attempt surface. Sprint 27 must add the client
wrapper and the student surface. It must not create a new analytics
backend, and it must not reuse the class-scoped teacher callable for a
student surface, because that callable returns every student's attempts
in the class. The smallest canonical implementation is preferred: client
aggregation over this existing caller-scoped read.

### 4.2 The manual LyfeLabz student lifecycle is substantially implemented

The manual-class lifecycle is present end to end in code:

```
teacher creates class
  -> join code
  -> student Google sign-in
  -> provisioned user
  -> student onboarding (join-code form)
  -> join-code enrollment
  -> teacher publishes assignment
  -> frozen recipients (PDR-029d)
  -> My Assignments
  -> lesson launch with assignment context
  -> session begin
  -> autosave
  -> finalize
  -> attempt
  -> teacher Assignment Detail
```

Individual parts are tested. The missing obligation is My Results and
status client behavior, integrated browser and emulator certification of
the complete chain, and correction of any defect genuinely discovered
during that certification. This path is not to be redesigned.

### 4.3 Identity bridge ordering (Google Classroom students)

`authOnUserCreate`
(`platform/functions/src/auth/auth-on-user-create.ts`) already creates
the external identity bridge on a student's first Google sign-in through
`createOrConfirmExternalIdentity`. The earlier assumption that client
wiring of `reconcileMyExternalIdentity` is the primary missing identity
mechanism was incorrect. `reconcileMyExternalIdentity`
(`platform/functions/src/identity/reconcile-my-external-identity.ts`)
exists but has no client caller today; it is an idempotent defensive
identity-confirmation callable, not the enrollment mechanism.

The real ordering fact: a roster sync run before a student has ever
signed in classifies that student as unresolved, because the bridge does
not yet exist. A later sync resolves the student once the bridge exists.
The sprint definition therefore distinguishes four distinct states that
must never be collapsed:

```
identity bridge  !=  student activation  !=  class enrollment  !=  assignment recipient membership
```

### 4.4 Provisioned LMS-student onboarding is genuinely broken

The provisioned-student client onboarding form requires a class join
code (`app/src/router/surfaces/index.ts`, the student form rejects an
empty `joinCode`). LMS-linked classes intentionally reject join-code
enrollment. A student who exists on a Google Classroom roster therefore
has no clean client path from `provisioned` to `active` without
attempting the manual join-code workflow that does not apply to them.
This is a genuine implementation gap and a required Sprint 27 workstream.

### 4.5 The Google Classroom coursework deep link is wrong for assignment context

Current publication supplies a bare lesson URL as the coursework link.
`app/src/shell/surfaces/curriculum.ts` computes
`` `${window.location.origin}${lesson.href}` `` and threads it to the
publication path as a client-supplied `lyfelabzAssignmentUrl`
(`app/src/shell/surfaces/shared/lmsPublication.ts`). That URL does not
carry the LyfeLabz assignment context the authenticated assessment
runtime requires, and the client is the source of truth for the
destination URL.

The canonical deep-link architecture (PDR-027,
`GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`) expects an
assignment-aware route (`https://lyfelabz.com/app/a/{assignmentId}`)
constructed server-side, with a server-side resolver
(`lmsDeepLinkResolve`) enforcing student authorization before entering
the attempt context. The investigation confirmed neither exists today:
there is no `/app/a/` route and no `lmsDeepLinkResolve` callable.
Sprint 27 reconciles this architecture. During Phase 1 the exact current
PDR-027 wording and the current implementation constraints must be
re-verified before any specific symbol name is frozen. The architectural
requirement outranks copying an old proposed function name.

## 5. Mission

Close the student side of the classroom lifecycle by wiring the minimum
canonical My Results experience, giving Google-Classroom-rostered
students a safe path through onboarding and enrollment, reconciling
Classroom coursework deep links into the authenticated assignment
context, and certifying the first genuine teacher to student to teacher
classroom loop as one integrated browser and emulator flow.

Sprint 27 is explicitly not a student-platform rebuild. It prefers
narrow wiring and integration work over new backend feature families.

## 6. Canonical requirements and PDR anchors

- **PDR-024i.** The student identity menu is exactly My Assignments and
  My Results. No additional student surface is introduced.
- **PDR-024j, PDR-024k, PDR-024l, PDR-024m.** Submit equals completion;
  Improve My Score on every less-than-perfect best score; the four
  canonical status indicators (Ready to Begin, Improving, Well Done!,
  Perfect Score), never represented by color alone; celebrate
  improvement, never compare students, never use punitive language.
- **PDR-024h.** Silent arrival: a student launching an assignment from
  Google Classroom enters the correct authorized attempt context without
  selecting a class or an assignment.
- **PDR-024n, PDR-024o.** The learning archive and the multi-year
  portfolio. These remain OUT of Sprint 27 (see section 14) unless the
  canonical documents unambiguously prove otherwise.
- **PDR-027 (a through j) and `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`.**
  LyfeLabz owns the deep-link URL; the canonical `assignmentId` is the
  load-bearing key; the resolver is read-only against LyfeLabz state and
  never calls Google Classroom; server-side authorization precedes the
  attempt context; the URL carries no token, session, score, student, or
  Classroom identifier.
- **PDR-029 (d through l).** The frozen recipient population captured at
  first publication; recipient immutability and append-only writes;
  late-recipient behavior via `manualAddition` (PDR-029h); session and
  attempt enforcement that refuses a non-recipient (PDR-029l).
- **PDR-025.** District security boundary; every student-facing callable
  remains district-scoped and additive to this contract.
- **PDR-019, PDR-020, PDR-030.** LMS integration posture, phase
  sequencing, and the certified publication foundation Sprint 27 builds
  on without amending.

## 7. Current-state architecture

Implemented and load-bearing:

- **Identity and activation.** `authOnUserCreate` provisions the user and
  creates the external identity bridge on first Google sign-in.
  `studentsCompleteOnboarding` transitions a student from `provisioned`
  to `active`. `reconcileMyExternalIdentity` exists as an idempotent
  identity-confirmation callable with no client caller today.
- **Enrollment.** Join-code redemption establishes an
  `enrollments/{enrollmentId}` record for manual classes. Server-mediated
  throughout.
- **Assignments and recipients.** Assignment lifecycle callables exist.
  First publication freezes the recipient population under PDR-029d.
  `assignmentsRecipientAdd`
  (`platform/functions/src/assignments/assignments-recipient-add.ts`)
  implements the PDR-029h late-add path with `source === "manualAddition"`.
- **Assessment runtime.** Session begin, autosave, resume, finalize, and
  attempt persistence exist and enforce recipient membership (PDR-029l).
- **Student My Assignments.** Implemented through the
  `AssignmentsListForStudent` callable and the launch URL builder
  (`app/src/assignments/studentList/`).
- **Attempt read.** `assessmentAttemptsList` returns caller-scoped
  completed attempts and is exported and deployed, but has no client
  callable wrapper today. The teacher Assignment Detail attempt views are
  wired to the separate class-scoped `assessmentAttemptsListForClass` and
  `assessmentAttemptGetForTeacher` callables; the caller-scoped
  `assessmentAttemptsList` is not reached from any client surface.
- **LMS publication.** Sprint 25 publishes a coursework record into a
  linked Google Classroom course. The coursework URL is currently a bare
  lesson URL computed and supplied by the client.
- **Beta school constant.** `BETA_SCHOOL_ID = "school-beta"`
  (`platform/functions/src/scripts/bootstrap-beta-teacher.ts`) seeds the
  single-school pilot. `studentsCompleteOnboarding` accepts a
  client-supplied `schoolId`.

Unwired or absent:

- My Results student surface (absent).
- A client callable wrapper for `assessmentAttemptsList` (absent; the
  caller-scoped student attempt read is not reached from any client
  surface).
- A provisioned-to-active onboarding path for an LMS-rostered student
  that does not require a manual join code (absent).
- The assignment-aware deep-link route `/app/a/{assignmentId}` (absent).
- The `lmsDeepLinkResolve` server resolver (absent).
- A client caller for `reconcileMyExternalIdentity` (absent; and this is
  by design not the enrollment mechanism).

## 8. Problem statements

- **P1. My Results is unwired.** PDR-024i requires it; the backend read
  exists; the surface does not. Students cannot review their result
  history, best score, attempt count, status indicator, or Improve My
  Score entry point through a canonical My Results surface.
- **P2. The complete student lifecycle is uncertified as one flow.** The
  components are tested individually. The chained teacher-to-student-to-teacher
  loop has never been certified as one integrated browser and emulator
  flow.
- **P3. LMS-rostered students cannot onboard cleanly.** The only client
  onboarding path requires a join code that LMS-linked classes reject.
- **P4. The Google Classroom deep link cannot carry assignment context.**
  A bare lesson URL does not enter the authenticated assignment runtime,
  and the client is the source of truth for the destination URL, which
  violates the PDR-027 server-authoritative posture.

## 9. Scope and workstreams

Sprint 27 is organized into four coherent workstreams. Phase ordering is
refined by the Phase 1 architectural blueprint against repository
dependencies.

### Workstream A - Student My Results and assignment status

Goal: complete the minimum PDR-024 student identity experience.

Likely scope:

- expose My Assignments and My Results within the active student surface,
  consistent with the PDR-024i two-surface menu,
- wire the existing `assessmentAttemptsList` read,
- derive best score and attempt count on the client from the
  caller-scoped attempt history,
- display the four required accessible status indicators (PDR-024l),
  never by color alone,
- offer Improve My Score on every less-than-perfect best score
  (PDR-024k) using the existing reassessment and session behavior,
- make My Assignments completion and status understandable to the
  student.

Prefer client aggregation over backend expansion. Explicitly exclude the
broader learning archive (PDR-024n) and the multi-year portfolio
(PDR-024o).

Security: caller-scoped result reads only; no other student's data; no
answer keys; no class-level comparison; no teacher analytics exposed to
students.

### Workstream B - Google Classroom student activation and enrollment

Goal: allow a legitimate Google-Classroom-rostered student to traverse
the existing identity and enrollment model without a manual join code.

The narrow LMS-student onboarding path must preserve:

- server-mediated enrollment,
- no student self-assertion of Classroom membership,
- no client-provided Google roster identity,
- district and school boundaries,
- idempotent identity handling,
- existing manual join-code behavior unchanged.

Implementation determines the smallest correct sequence across:

```
student first Google sign-in
  -> external identity bridge (authOnUserCreate, already implemented)
  -> provisioned student
  -> activation
  -> roster re-resolution
  -> enrollment
  -> assignment recipient eligibility
```

`reconcileMyExternalIdentity` is available as an idempotent identity
confirmation mechanism only, never as an enrollment shortcut. The student
client must not assert a provider account ID, Classroom membership, class
membership, or arbitrary school or district membership. The manual and
LMS trust boundaries are not merged casually.

### Workstream C - Assignment-aware Google Classroom deep link

Goal: replace the current bare-lesson Classroom URL with an
authenticated assignment-aware LyfeLabz route.

Definition requirements:

- server-authoritative construction or validation of the destination
  URL; the client is not the source of truth for an arbitrary Classroom
  destination,
- the assignment identifier carried through the deep link,
- authentication round-trip preservation for an unauthenticated arrival,
- server-side student authorization,
- enrollment and recipient validation,
- published-assignment validation,
- correct lesson resolution,
- handoff into the existing assignment-aware assessment runtime,
- safe failure and recovery states.

Do not broaden this into a generic link-routing framework. During
Phase 1, re-verify the current PDR-027 wording and implementation
constraints before freezing specific symbol names such as `/app/a/` and
`lmsDeepLinkResolve`; the architectural requirement is authoritative
over an old proposed name.

### Workstream D - Full classroom lifecycle certification

Sprint 27 certifies two paths.

**Path A - Manual LyfeLabz class.**

```
teacher -> manual class -> join code -> student onboarding -> enrollment
  -> assignment -> student opens -> student completes
  -> My Results reflects outcome -> teacher reviews attempt
```

Primary evidence: deterministic, emulator and local integration, and a
genuine browser chain. No real Google Classroom provider dependency is
needed for Path A.

**Path B - Google Classroom-linked class.**

```
teacher -> Classroom import -> activation -> roster
  -> student sign-in / identity resolution -> student activation
  -> roster synchronization / enrollment -> recipient inclusion
  -> assignment + Classroom publication -> assignment-aware deep link
  -> student opens -> completes -> teacher reviews
```

Use deterministic, fixture, and emulator evidence for all
LyfeLabz-controlled behavior. Use real Google only where the provider
boundary itself matters. Do not manipulate Google grants to manufacture
test scenarios. Whether Google displays an account chooser is not a
correctness criterion.

## 10. Security invariants

These invariants are load-bearing and are never weakened by Sprint 27:

- **Server-authoritative authorization.** The deep-link resolver
  authorizes server-side against LyfeLabz state. Possession of the URL is
  never authorization. Enrollment and recipient enforcement remain
  load-bearing.
- **Deep-link URL contains no secrets or PII.** No OAuth credential, no
  Google identity, no student PII, no token, no session identifier, no
  score, no answer-key material, and no Classroom coursework identifier
  in the path, query, or fragment. An opaque LyfeLabz assignment
  identifier in the path is acceptable, consistent with the existing
  domain model and PDR-027a.
- **Resolver is read-only against LyfeLabz state.** It never creates,
  mutates, or deletes a session, attempt, assignment, publication, or
  link record, and it never calls Google Classroom (PDR-027d).
- **Enrollment stays server-mediated.** No client `create` on
  `enrollments`. The LMS-student path never accepts a client-asserted
  provider account ID, Classroom membership, class membership, or school
  or district membership.
- **Caller-scoped student reads only.** My Results exposes only the
  caller's own results. No cross-student data, no answer keys, no
  class-level comparison, no teacher analytics.
- **District boundary preserved.** Every student-facing callable remains
  district-scoped and additive to
  `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` (PDR-025).
- **No student PII, token, secret, or Google identity** enters any
  audit payload, log line, URL, or client surface.
- **Frozen-recipient semantics preserved** (see section 11).

## 11. Frozen-recipient and late-enrollment decision boundary

PDR-029 recipient semantics are load-bearing. Assignment publication
freezes the recipient population (PDR-029d). A student who becomes
enrolled after publication is not automatically a recipient (PDR-029h).
The repository already contains `assignmentsRecipientAdd`, which creates
an immutable recipient record with `source === "manualAddition"`.

Sprint 27 must NOT silently redefine frozen recipient semantics, and must
NOT automatically add every future enrollment to previously published
assignments. This is an explicit implementation-phase architectural
decision for the Google Classroom student timing case, resolved in
Phase 1, not in this definition.

Before implementation chooses behavior, Phase 1 MUST inspect:

- PDR-029 (especially PDR-029d, PDR-029h, PDR-029l),
- `assignmentsRecipientAdd`,
- current teacher workflows,
- roster resync semantics,
- assignment publication behavior.

The narrow options may include, for example:

- a teacher explicitly adds a newly resolved or newly enrolled student
  through the existing `assignmentsRecipientAdd` path,
- an already-defined server-mediated late-add workflow,
- another existing canonical mechanism.

Automatic bulk addition of newly enrolled students to previously
published assignments is not authorized by this definition; PDR-029h
requires a superseding sprint to authorize a bulk gesture. Sprint 27
preserves the meaning of a frozen recipient population.

## 12. Certification architecture

Sprint 27 is implementation plus certification. It does not stop at code
complete. The sprint proceeds through:

1. architecture confirmation (Phase 1 blueprint),
2. implementation,
3. deterministic testing,
4. local integration and browser certification (Firebase Emulator Suite
   plus browser),
5. narrowly necessary live-provider evidence only where Google itself is
   the boundary,
6. final certification findings,
7. sprint completion report.

The preference is to close the sprint with evidence. Certification is not
split into a separate sprint unless an external provider condition
genuinely prevents closure.

## 13. Evidence classes

The following evidence classes are kept distinct and must not be
conflated:

- **Deterministic.** Unit, domain, client, and rules tests.
- **Local integration.** Firebase Emulator Suite and browser
  integration.
- **Live provider.** Only Google behavior that cannot responsibly be
  proven through deterministic or fixture testing.
- **Production.** Reserved for Sprint 29 unless Sprint 27 uncovers a
  compelling reason otherwise. Sprint 27 is not the production-release
  sprint.

Language discipline: a component with individual unit coverage is
described as having deterministic evidence, never as "end-to-end
certified." "End-to-end" applies only to the integrated chained flow once
it is certified under Workstream D.

## 14. Explicit non-goals

Sprint 27 explicitly excludes:

- broad teacher UX polish,
- broad Settings polish,
- analytics or gradebook,
- Administrator Platform,
- broad v2 lesson migration,
- question-level historical learning archive (PDR-024n),
- multi-year portfolio (PDR-024o),
- grade sync or grade-back,
- background roster jobs or webhooks unless a canonical requirement
  forces them,
- Canvas, Schoology, Microsoft Teams for Education,
- notifications, calendar, planner, messaging,
- generalized multi-school onboarding,
- school or district selectors,
- curriculum-manifest SHA repair,
- general release hardening,
- full production deployment,
- final v1 production certification,
- reopening Sprint 25 B13,
- weakening frozen-recipient semantics.

## 15. Dependencies

- Certified Sprint 24A, Sprint 24B, Sprint 25, and Sprint 26 foundations.
- `assessmentAttemptsList` (caller-scoped completed-attempt read).
- `authOnUserCreate` external identity bridge; `reconcileMyExternalIdentity`
  (idempotent confirmation only).
- `studentsCompleteOnboarding` activation callable and the enrollment
  callables.
- `assignmentsRecipientAdd` and the PDR-029 recipient collection.
- The assessment runtime (session begin, autosave, resume, finalize,
  attempt) with PDR-029l recipient enforcement.
- The Sprint 25 publication path (`lmsAssignmentsPublish` and the client
  publication module) for the deep-link reconciliation.
- `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` (PDR-027) as the
  governing contract for Workstream C.
- The Firebase Emulator Suite and the browser verification tooling.
- `BETA_SCHOOL_ID` remains the single-school pilot constant (see
  section 16).

## 16. Risks and unknowns

- **BETA_SCHOOL_ID decision: KEEP FOR v1 PILOT.** v1 is a single-school
  and single-district pilot-ready release, not a generalized multi-school
  SaaS launch. The fixed beta school value masks a broader future issue:
  `studentsCompleteOnboarding` accepts a client-supplied `schoolId`. That
  generalized trust-boundary concern is documented as post-v1 technical
  and product architecture, not a Sprint 27 requirement, unless Sprint 27
  implementation reveals a direct security problem within the defined
  pilot boundary. Sprint 27 introduces no school selector, no district
  selector, no school discovery, no generalized school routing, and no
  arbitrary multi-school onboarding. This is not asserted to be the final
  long-term architecture.
- **LMS-student activation sequence is unresolved.** The exact
  provisioned-to-active sequence for an LMS-rostered student is a Phase 1
  architectural decision. The role of `reconcileMyExternalIdentity`, the
  roster re-sync timing, and where enrollment is established must be
  determined against the existing model, not assumed.
- **Late enrollment versus frozen recipients.** Resolved in Phase 1 per
  section 11, not in this definition.
- **Deep-link resolver contract.** The exact resolver symbol names,
  route shape, and payload must be re-verified against the current
  PDR-027 wording and current code in Phase 1 before they are frozen.
- **Google may present an account chooser.** This is provider-controlled
  and is not a Sprint 27 correctness criterion. Do not manipulate Google
  grants to manufacture scenarios.
- **Google OAuth verification and Data Access review** may have a long
  lead time. It may be started operationally in parallel during Sprint 27
  but is not part of Sprint 27 engineering implementation, Sprint 27
  completion must not depend on Google's review timeline, and it is not
  initiated by this definition task. Sprint 29 remains responsible for
  final v1 release gating.

## 17. Exit criteria

Sprint 27 exits when all of the following hold:

- My Assignments and My Results are both present in the active student
  surface, consistent with PDR-024i.
- My Results shows lesson and assignment result history, best score,
  attempt count, the PDR-024l status indicators (never color alone), and
  offers Improve My Score on every less-than-perfect best score, using
  the existing reassessment and session behavior.
- A Google-Classroom-rostered student can reach `active` and become
  eligible for assignment recipient membership without using a manual
  join code, entirely through server-mediated enrollment.
- The published Google Classroom coursework carries an assignment-aware
  LyfeLabz deep link constructed or validated server-side, and a student
  arriving on it is authorized server-side and lands silently in the
  correct assignment context (PDR-024h, PDR-027).
- The manual-class lifecycle (Path A) is certified as one integrated
  browser and emulator flow, with deterministic and local-integration
  evidence.
- The Google Classroom-linked lifecycle (Path B) is certified using
  deterministic, fixture, and emulator evidence for all
  LyfeLabz-controlled behavior, with live-provider evidence only where
  the Google boundary itself matters.
- Frozen-recipient semantics (PDR-029d, PDR-029h, PDR-029l) are
  preserved; any late-enrollment behavior uses an existing
  server-mediated path resolved in Phase 1.
- All security invariants in section 10 hold.
- No student PII, token, secret, or Google identity is exposed in any
  URL, audit payload, log line, or client surface.
- Any defect genuinely discovered during certification is corrected
  within the defined scope, or is documented and deferred with a clear
  disposition.
- No production deployment, no final v1 production certification, and no
  reopening of Sprint 25 B13.

## 18. Documentation and certification deliverables

- This definition (`SPRINT_27_DEFINITION.md`).
- A Phase 1 architectural blueprint that resolves the LMS-student
  activation sequence, the deep-link resolver contract, and the
  late-enrollment and frozen-recipient decision.
- Deterministic test evidence for each workstream.
- A local integration and browser certification record for Path A and
  the LyfeLabz-controlled portions of Path B.
- A narrowly scoped live-provider certification record for the Google
  boundary in Path B.
- A Sprint 27 completion report with final certification findings.
- Narrow reconciliation notices only where a landed change requires them.
  Broad documentation reconciliation is owned by Sprint 29.

## 19. Definition of Done

Sprint 27 is complete when:

- My Results is wired against `assessmentAttemptsList` with client
  aggregation, and both student identity surfaces satisfy PDR-024i,
  PDR-024k, PDR-024l, and PDR-024m.
- The LMS-rostered student onboarding and enrollment path is implemented
  server-mediated, preserves all trust boundaries in Workstream B, and
  leaves manual join-code behavior unchanged.
- The assignment-aware deep link is implemented per Workstream C and
  PDR-027, server-authoritative, with the resolver authorizing before the
  attempt context and carrying no secrets or PII.
- The complete teacher-to-student-to-teacher loop is certified as one
  integrated flow for Path A, and for the LyfeLabz-controlled portions of
  Path B, with live-provider evidence only at the Google boundary.
- Frozen-recipient semantics are preserved and the late-enrollment
  decision is resolved through an existing server-mediated mechanism.
- All exit criteria in section 17 are satisfied and recorded with
  appropriately classified evidence.
- No new token, secret, PII, or Google-identity exposure, and no
  regression in the certified Sprint 24, Sprint 25, or Sprint 26
  behavior.

## 20. Next-sprint boundary

The remaining v1 release sequence is:

- **Sprint 27 - Student Classroom Lifecycle Completion & Certification**
  (this document).
- **Sprint 28 - Teacher Workflow & UX Polish + Pre-Release Hardening.**
  Likely focus: Classes to Assign to Assignment Detail to Settings
  cohesion; teacher copy, hierarchy, and action polish; accessibility;
  responsive and browser testing; security and rules regression;
  pre-release hardening. No large new domain feature family is
  introduced.
- **Sprint 29 - Teacher Platform v1 Release Certification.** Likely
  focus: final stabilization; curriculum-manifest SHA drift resolution;
  a complete deterministic baseline; documentation reconciliation; the
  Google OAuth verification and Data Access disposition; Secret Manager
  rotation; production deployment; production teacher and student smoke
  and end-to-end tests; final v1 production certification.

There is no Sprint 30 planned. Work after Sprint 29 is driven by
classroom feedback, defects, or a deliberately chosen feature family.

Sprint 27 does not begin the work Sprint 28 or Sprint 29 owns, and it is
not the production-release sprint.

*End of definition.*
