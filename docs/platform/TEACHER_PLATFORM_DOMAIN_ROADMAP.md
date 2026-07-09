# LyfeLabz Teacher Platform Domain Roadmap

Status: Canonical
Companion documents: LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_PLATFORM_DOMAIN_MODEL.md, LYFELABZ_FIRESTORE_DATA_MODEL.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, PLATFORM_STATE_MACHINE.md, SPRINT_HISTORY.md, SPRINT_3_CERTIFICATION.md

---

## 1. Introduction

### Purpose

This document is the master dependency roadmap for the Teacher Platform. It names the major platform domains, records how each domain depends on the domain before it, and establishes the implementation order that future sprints must follow.

It is an architecture document, not an implementation specification. It does not define fields, callables, rules, or UI. Each phase in the roadmap will later be expanded into its own sprint specification the way Sprints 1 through 3 were, at which point the specific document shapes, callable signatures, rules, and surfaces will be recorded.

The roadmap begins with the identity trust layer certified in Sprints 1 through 3 and continues through the complete teacher platform.

### Position Within Platform Documentation

The Platform Architecture describes the system as a whole. The Domain Model defines the business entities. The Firestore Data Model defines their storage shape. The Firebase Security Model defines who may read and write them. The Cloud Function Charter defines what runs on the server.

This document sits above all of them and answers a single question: **in what order do the domains become real, and why can none of them be built out of order.**

Every domain in this roadmap defers to the certified architecture. Nothing in this document overrides the Firestore Data Model, the Firebase Security Model, the Cloud Function Charter, the Platform Architecture, or the Platform State Machine.

### Scope

The roadmap describes the Teacher Platform. It also names the Administrator Platform as its terminal phase, because the Administrator Platform is the operational partner to the Teacher Platform and completes the platform picture. Student-facing surfaces, parent surfaces, and district surfaces are named only where they are prerequisites or downstream consumers of a Teacher Platform domain; their own build-out belongs to future roadmaps.

---

## 2. Dependency Diagram

The domains build on one another in a strict, unbranching order. Each domain becomes real only after the one above it is certified.

```
                    +------------------+
                    |     Identity     |   (Sprints 1 - 3, certified)
                    +------------------+
                             |
                             v
                    +------------------+
                    |     Schools      |
                    +------------------+
                             |
                             v
                    +------------------+
                    |     Teachers     |
                    +------------------+
                             |
                             v
                    +------------------+
                    |   Classrooms     |
                    +------------------+
                             |
                             v
                    +------------------+
                    |   Enrollments    |
                    +------------------+
                             |
                             v
                    +------------------+
                    |   Assignments    |
                    +------------------+
                             |
                             v
                    +------------------+
                    |   Submissions    |
                    +------------------+
                             |
                             v
                    +------------------+
                    |    Analytics     |
                    +------------------+
                             |
                             v
                    +------------------+
                    | Future Extensions|
                    +------------------+
```

The chain is intentionally linear. Later domains reference earlier ones; earlier domains never depend on later ones. A domain cannot be partially built ahead of its predecessor because the predecessor owns the identifiers, ownership relationships, or lifecycle guarantees the later domain needs.

---

## 3. Domain Descriptions

Each domain is described in the same conceptual terms: purpose, canonical Firestore ownership, primary collections, primary callable functions, security responsibilities, upstream dependencies, downstream dependents, and items intentionally deferred to future sprints.

Collections and callable names in this section are the canonical names already established or reserved by the certified architecture. Domains that have not yet been implemented name only the collections and callables the certified architecture anticipates; final shapes are set by the sprint specification for that phase.

---

### 3.1 Identity

**Purpose.** Establish and maintain trusted identity for every human that authenticates against the platform. Identity is the foundation on which every other domain rests, because every other domain is scoped by role, school, and lifecycle state.

**Canonical Firestore ownership.** The Identity domain owns `users/{uid}` end-to-end. It shares stewardship of `auditEvents` with every other domain: every domain writes to `auditEvents`, but the canonical writer, vocabulary contract, and append-only invariant belong to Identity.

**Primary collections.**

- `users/{uid}` - canonical identity record. Sole lifecycle field is `status`.
- `auditEvents/{eventId}` - append-only event stream.

**Primary callable functions.**

- `authOnUserCreate` - the sole authentication trigger, writes the canonical provisioning record.
- `studentsCompleteOnboarding` - `provisioned` to `active` for students.
- `teachersRequestVerification` - `provisioned` to `pendingVerification` for teachers.
- `teachersApproveVerification` - `pendingVerification` to `active`, administrator-gated.
- `teachersDenyVerification` - `pendingVerification` to `provisioned`, administrator-gated.

**Security responsibilities.**

- Default-deny baseline across every collection.
- Self-get and narrow self-update on `users/{uid}`.
- Authenticated get on `schools/{schoolId}`.
- Server-only writes to `auditEvents`.
- Custom claims restricted to `{ role, schoolId }`. `districtId` is reserved only.

**Depends on.** No earlier platform domain. Depends on the Firebase project, Firebase Authentication, and the Sprint 1 Cloud Function scaffold.

**Depended on by.** Every subsequent domain. Schools resolves institutional tenancy through the `schoolId` claim. Teachers, Classrooms, Enrollments, Assignments, Submissions, and Analytics all key their access-control decisions off the role and school membership established here.

**Deferred to future sprints.**

- New roles beyond `teacher`, `student`, `platformAdministrator`.
- `districtId` becoming a real claim rather than a reserved slot.
- Parent identity.
- School-managed identity provider federation for students.
- Bulk provisioning through roster imports.

---

### 3.2 Schools

**Purpose.** Represent the institutional tenant that every teacher and classroom belongs to. Schools give the platform a stable boundary for administrative access, timezone-aware scheduling, and future district rollup.

**Canonical Firestore ownership.** The Schools domain owns `schools/{schoolId}` end-to-end and owns the `schoolId` reference used across `users`, `classes`, `assignments`, and `auditEvents`.

**Primary collections.**

- `schools/{schoolId}` - institutional tenant record.

**Primary callable functions.**

- Administrator-facing school lifecycle callables that create, update, and archive school records.
- Verification-support callables that resolve a teacher's requested school during onboarding when the school does not yet exist.

The exact callable names are set by the Schools Foundation sprint specification.

**Security responsibilities.**

- Authenticated get on `schools/{schoolId}` (already permitted).
- Server-mediated writes to `schools/{schoolId}` through administrator-gated callables.
- School membership is written to `users/{uid}.schoolId` and to the caller's custom claims by administrator-controlled flows only.

**Depends on.** Identity. A school cannot exist for a teacher who has not been provisioned, and school administration cannot be exercised without the `platformAdministrator` role established by Identity.

**Depended on by.** Teachers (as institutional home), Classrooms (as tenancy boundary), Enrollments (indirectly, through class school membership), Assignments (per-school administrative views), Analytics (per-school rollups), and every future school-scoped surface.

**Deferred to future sprints.**

- District rollup.
- School branding configuration.
- School-level policy defaults inherited by teachers or classrooms.
- SIS synchronization.
- School-managed academic calendars.

---

### 3.3 Teachers

**Purpose.** Deliver the certified teacher identity into a working, scoped presence inside the Teacher Platform Shell. Teachers as a domain is the layer at which an approved teacher becomes an actor: they can be listed within their school, they can hold preferences, and they can be surfaced to administrators.

**Canonical Firestore ownership.** The Teachers domain owns the teacher-scoped view of `users/{uid}` where `role == "teacher"`, and owns any future teacher-preference document. It does not own the `users` collection itself; that ownership remains with Identity.

**Primary collections.**

- `users/{uid}` (teacher-scoped views).
- A future teacher-preferences record, deferred to the Teachers Foundation sprint specification.

**Primary callable functions.**

- Teacher profile update callables (bounded self-updates beyond `displayName`).
- Teacher preferences write callables.
- Administrator-facing teacher lifecycle callables (suspend, archive, restore).

**Security responsibilities.**

- Narrow self-update rules for teacher-owned profile fields.
- Same-school reads of teacher records for teacher-to-teacher visibility inside a school.
- Server-mediated administrator writes for suspension and archival.

**Depends on.** Identity and Schools. A teacher is a `users/{uid}` record with `role == "teacher"` scoped by `schoolId`. Neither can exist without the two upstream domains.

**Depended on by.** Classrooms (a class belongs to exactly one teacher), Assignments (a teacher creates them), Analytics (per-teacher rollups), and the Administrator Platform.

**Deferred to future sprints.**

- Co-teaching relationships.
- Teacher-to-teacher shared resources.
- Professional learning community grouping.

---

### 3.4 Classrooms

**Purpose.** Introduce the class as the primary container for classroom activity. A classroom is where a teacher and a group of students exist together for a school year. Classrooms are the first domain in the roadmap that carries per-class security scoping.

**Canonical Firestore ownership.** The Classrooms domain owns `classes/{classId}` end-to-end. It owns the `classId` reference used across enrollments, assignments, submissions, and analytics.

**Primary collections.**

- `classes/{classId}` - class record. Owns join code, block, grade, teacher pointer, and school pointer.

**Primary callable functions.**

- Class creation, update, and archival callables owned by the class's teacher.
- Class copy callable for cross-school-year continuity.
- Join code generation and rotation callables.

**Security responsibilities.**

- Teacher self-owned class writes.
- Same-school administrator visibility.
- Join code lookup permitted only through a server-mediated callable, never through a client query.

**Depends on.** Teachers (which depends on Schools, which depends on Identity). A class must be owned by an active teacher who belongs to a school.

**Depended on by.** Enrollments (an enrollment references a class), Assignments (an assignment belongs to a class), Submissions (indirectly through assignments), Analytics (per-class rollups).

**Deferred to future sprints.**

- Class announcements.
- Co-taught classes.
- Cross-school shared classes.
- Class-level analytics dashboards (owned by the Analytics phase).

---

### 3.5 Enrollments

**Purpose.** Connect students to classes. Enrollments are the join between two independent long-lived entities; they are the domain that makes classroom life possible without violating the rule that a teacher never owns a student.

**Canonical Firestore ownership.** The Enrollments domain owns `enrollments/{enrollmentId}` end-to-end. Its canonical status vocabulary is `active`, `transferred`, `withdrawn`, `archived`.

**Primary collections.**

- `enrollments/{enrollmentId}` - one document per (student, class) pair.

**Primary callable functions.**

- Student-facing join callable, keyed off a join code, that establishes an enrollment for the authenticated student.
- Teacher-facing enrollment lifecycle callables (transfer, withdraw).
- Administrator-facing enrollment archival callables.

**Security responsibilities.**

- Reads scoped to the enrolled student and the teacher of the referenced class.
- Server-mediated join-code redemption. Clients never query `classes` by join code directly.
- Enrollment writes strictly through callables. No client `create` on `enrollments`.

**Depends on.** Classrooms, Teachers, Schools, and Identity. An enrollment cannot exist without a class to enroll into and a student to be enrolled.

**Depended on by.** Assignments (visibility of an assignment to a student is filtered through their active enrollment), Submissions (a submission's student must be enrolled in the referenced class at the time of engagement), Analytics (per-class rosters, per-student trajectories).

**Deferred to future sprints.**

- Roster-fed enrollment through the reserved `rosters` collection.
- Bulk enrollment operations.
- Per-class student metadata beyond a block-specific display name.

---

### 3.6 Assignments

**Purpose.** Give teachers a way to surface a specific lesson for a specific class under conditions they choose. Assignments are the pointer records defined by PDR-010 (Curation). Their user-facing vocabulary is always "curation," "surfaced," and "window closes." Their schema name remains "assignment."

**Canonical Firestore ownership.** The Assignments domain owns `assignments/{assignmentId}` end-to-end. It also owns the read side of `lessons/{lessonId}` at the platform layer; the write side of `lessons/{lessonId}` remains a curriculum-team responsibility outside the classroom lifecycle.

**Primary collections.**

- `assignments/{assignmentId}` - one document per assignment record. References one class, one lesson version, one teacher.
- `lessons/{lessonId}` - the referenced canonical lesson catalog record (read only for the classroom lifecycle).

**Primary callable functions.**

- Assignment draft, publish, close, and archive callables owned by the assigning teacher.
- Bounded update callables for post-publish edits that do not break student experience.

**Security responsibilities.**

- Assignment reads scoped to the teacher of the class and to students with an active enrollment in the referenced class.
- Server-mediated publish transitions.
- Prohibition on client edits after `closed` or `archived`.
- Prohibition on embedded lesson content. Assignments always reference; they never contain.

**Depends on.** Classrooms, Teachers, Schools, and Identity. An assignment is a teacher's decision to make a lesson available to their class. It also depends on the pre-existing curriculum layer (`lessons`), which is populated outside of the teacher platform sprint sequence but must be catalogued before the Assignments phase completes.

**Depended on by.** Submissions (every submission references an assignment), Analytics (per-assignment rollups feed the primary teacher analytics views).

**Deferred to future sprints.**

- Automatic grading policy configuration.
- Assignment templates.
- Cross-class shared assignments.
- Bulk assignment operations.

---

### 3.7 Submissions

**Purpose.** Capture a student's work on an assignment. Submissions are the highest-volume write in the platform and the most sensitive read. They are the artifact that lets teachers see whether a curation landed and lets students see their own history.

**Canonical Firestore ownership.** The Submissions domain owns `submissions/{submissionId}` end-to-end. Its canonical lifecycle is `submitted` -> `finalized`, both applied inside the server-side finalization transaction. There is no client-authored `started` state on the authoritative record.

**Primary collections.**

- `submissions/{submissionId}` - one document per (student, assignment) attempt.
- `submissions/{submissionId}/responses` - reserved subcollection for oversized per-question payloads.

**Primary callable functions.**

- Submission finalization callable, which is the sole write path that produces a `finalized` record.
- Teacher-facing bounded correction callable for administrative correction, not classroom edit.
- Administrator-facing retention callable.

**Security responsibilities.**

- Read scoped to the submission's student and the teacher of the associated class.
- Write scoped to a single server-mediated finalization path.
- Finalized submissions are immutable.
- Retention policy applied to finalized records, not modelled as a lifecycle state.

**Depends on.** Assignments, Enrollments, Classrooms, Teachers, Schools, and Identity. A submission cannot exist without an assignment to submit against and an enrollment that authorizes the student's participation.

**Depended on by.** Analytics (submissions are the primary evidence base for every teacher, class, school, and administrator rollup) and every future feedback, tutoring, or portfolio surface.

**Deferred to future sprints.**

- AI-generated feedback attached to submissions.
- Student portfolios spanning multiple classes and years.
- Submission-level analytics dashboards (owned by the Analytics phase).

---

### 3.8 Analytics

**Purpose.** Turn identity, classroom, and submission history into structured, safe, and useful views for teachers and administrators. Analytics is a derived domain: it reads across the domains above it and produces summaries. It does not own primary lifecycle records.

**Canonical Firestore ownership.** The Analytics domain owns whatever rollup collections it introduces. It never re-owns `users`, `classes`, `assignments`, or `submissions`; those remain owned by their upstream domains. The Analytics phase must decide, per rollup, whether the rollup is a persisted document, a query pattern, or a Cloud Function on-demand computation. That decision belongs to the Analytics sprint specification and is guided by `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md`.

**Primary collections.**

- Rollup collections named by the Analytics sprint specification.
- No new authoritative lifecycle records.

**Primary callable functions.**

- Rollup query callables that return teacher, class, and school-scoped summaries.
- Server-mediated writers for any persisted rollup document.

**Security responsibilities.**

- Reads scoped to the appropriate actor (teacher, administrator).
- Rollups never expose per-student data outside the actor's own visibility scope.
- No client-side computation over multiple students' submissions. Aggregation is server-mediated.
- Rollup writes never mutate an authoritative record from an upstream domain.

**Depends on.** Submissions, Assignments, Enrollments, Classrooms, Teachers, Schools, and Identity. Analytics reads the full stack.

**Depended on by.** The Administrator Platform (school and platform administrator views), future export surfaces, and future AI recommendation surfaces.

**Deferred to future sprints.**

- Student-facing analytics.
- Parent-facing analytics.
- District-level analytics.
- Longitudinal analytics across school years for individual students.

---

### 3.9 Future Extensions

**Purpose.** Reserve conceptual space for the domains that follow the Teacher Platform without pretending they are part of the current build.

Future Extensions is not a single domain. It names the reserved surface area that the certified architecture already anticipates. It exists in this roadmap so that later work slots into place without disturbing the certified domains.

Reserved extensions include:

- Administrator Platform - the operational partner to the Teacher Platform.
- Student Platform - dedicated student surfaces beyond the current router stub.
- Parent Platform - Parent accounts linked to Students without owning them.
- District Platform - a District entity above Schools, enabling `districtId` claims and district-scoped rollups.
- SIS-fed Rosters - the reserved `rosters` collection.
- AI Tutoring and AI-Generated Feedback - attached at the Lesson and Submission layers respectively.
- LMS Integrations - Google Classroom and Canvas, treated as external systems mapped into LyfeLabz entities.
- Professional Learning Communities.
- Teacher-authored instructional content, distinct from Lessons.

Each of these will receive its own roadmap when its time comes.

**Deferred to future sprints.** All of it. The Future Extensions section exists to name what is not being built now.

---

## 4. Implementation Roadmap

The roadmap is organized as sequential phases. Each phase corresponds to one domain from Section 3, expanded into an implementable body of work. Phase 1 is complete. Phases 2 through 8 will each be preceded by a sprint specification, prosecuted by one or more sprints, and closed by a completion report and certification in the same pattern as Sprints 1 through 3.

Phases are strictly sequential. A phase does not begin until the phase before it is certified complete.

---

### Phase 1: Identity Foundation (Completed)

**Objectives.** Establish trusted identity. Turn the Sprint 1 provisioning record into a fully activated identity for both students and teachers. Deliver the client shell that exercises the identity trust layer end to end under the Emulator Suite.

**Deliverables.** Delivered by Sprints 1 through 3 and recorded in `SPRINT_HISTORY.md`, `SPRINT_1_COMPLETION_REPORT.md`, `SPRINT_2_COMPLETION_REPORT.md`, `SPRINT_3_COMPLETION_REPORT.md`, and `SPRINT_3_CERTIFICATION.md`.

- Default-deny Firestore and Storage baseline.
- Cloud Functions domain scaffold with typed helpers.
- `authOnUserCreate` provisioning trigger.
- Canonical `UserRecord`, `SchoolRecord`, and `AuditEventRecord` shapes.
- Canonical `writeCustomClaims` and `writeAuditEvent` helpers.
- Student and teacher onboarding callables plus administrator approve and deny callables.
- First affirmative Firestore rules over default-deny.
- `/app/**` Hosting scaffold, Canonical Session Bootstrap, Immutable Session Object, protected router, teacher entry experience, and permanent Teacher Platform Shell.
- Firebase project alignment on `lyfelabz-platform`.

**Exit criteria.** All satisfied.

- The full onboarding pipeline (provisioning through active teacher) is exercised end to end under the Emulator Suite.
- Every Sprint 2 architectural guarantee is preserved.
- `platform-ci.yml` is green.
- The instructional repository at the repository root is untouched.

**Architectural risks.** All retired.

**Explicit non-goals.** No classroom, roster, enrollment, assignment, submission, gradebook, or analytics surface. No production deployment.

---

### Phase 2: School Foundation

**Objectives.** Give the platform an owner-controlled model for the institutional tenant. Enable administrator lifecycle management of `schools/{schoolId}` and allow the verification-support callables introduced in Phase 1 to bind teachers to a school without ad-hoc writes.

**Deliverables.**

- Administrator-facing callables to create, update, and archive `schools/{schoolId}` records under the canonical `SchoolRecord` shape.
- Verification-support callable that resolves a teacher's requested school during onboarding, either by matching an existing school or by handing off to an administrator for creation.
- Administrator-facing surface inside `/app/**` for school management, scoped to the `platformAdministrator` role and gated by the existing router.
- Rules that permit administrator-gated school writes without loosening the authenticated get on `schools/{schoolId}` established in Sprint 2.

**Exit criteria.**

- Teachers verified through the Phase 1 flow now bind to real, administrator-created school records rather than manually seeded fixtures.
- Every school write is server-mediated, audited, and idempotent under the Sprint 2 helper contract.
- No new lifecycle field is introduced on `schools/{schoolId}`.
- CI and rules tests remain green.

**Architectural risks.**

- Administrator visibility could inadvertently open cross-school data reads if rules are written broadly. Mitigation: rules are scoped by explicit `schoolId` on each callable path.
- The verification-support callable could turn into an ad-hoc school creator. Mitigation: creation remains an administrator-only capability; the callable proposes, it does not create.

**Explicit non-goals.**

- District rollup.
- Branding, calendars, or policy configuration.
- SIS synchronization.

---

### Phase 3: Classroom Foundation

**Objectives.** Introduce `classes/{classId}` as the primary container for classroom activity. Deliver teacher-owned class creation, update, archival, and cross-year copy. Establish the join code contract that Enrollments will consume in Phase 4.

**Deliverables.**

- Teacher-owned class lifecycle callables (create, update, archive, copy).
- Join code generation and rotation callables owned by the class's teacher.
- Client surface inside the Teacher Platform Shell that replaces the placeholder Classes navigation entry with a working class list and class detail view.
- Firestore rules for teacher-owned class reads and writes, and administrator visibility scoped to the same school.
- Server-mediated join-code lookup callable, so that clients never query `classes` by join code directly.

**Exit criteria.**

- A verified teacher can create a class, rotate its join code, archive it, and copy it into a new school year, all under the Emulator Suite.
- No client `list` of `classes` exists across teachers.
- Every class-owned callable is idempotent under the Sprint 2 helper contract.
- CI and rules tests remain green.

**Architectural risks.**

- Cross-school data leakage through overly permissive `list` rules. Mitigation: all `list` operations remain server-mediated.
- Join-code guessability. Mitigation: server-mediated redemption with rate limiting and rotation.

**Explicit non-goals.**

- Enrollments. A class is a container; who is inside is Phase 4.
- Assignments.
- Announcements.
- Co-teaching.

---

### Phase 4: Enrollment Foundation

**Objectives.** Connect students to classes. Deliver the student-facing join flow, the teacher-facing enrollment management surfaces, and the enrollment lifecycle vocabulary `active`, `transferred`, `withdrawn`, `archived`.

**Deliverables.**

- Student-facing join callable that redeems a join code against a class and establishes an `enrollments/{enrollmentId}` record.
- Teacher-facing callables to transfer or withdraw a student from a class.
- Administrator-facing callable to archive enrollments when a containing class is archived.
- Student-facing surface inside `/app/**` for joining a class, replacing the current placeholder student route.
- Teacher-facing roster surface inside the Teacher Platform Shell, replacing the placeholder Students navigation entry.
- Firestore rules for enrollment reads scoped to the enrolled student and the class's teacher.

**Exit criteria.**

- A verified student can join a class using a join code produced in Phase 3, appear on the teacher's roster, be transferred, and be withdrawn, all under the Emulator Suite.
- No client `create` on `enrollments` exists. Every write is server-mediated.
- CI and rules tests remain green.

**Architectural risks.**

- A student in one school being able to join a class in another school. Mitigation: server-mediated redemption enforces same-school constraints as a rule and as an assertion.
- The teacher-facing roster growing into a student ownership surface. Mitigation: roster views expose enrollment records, never editable student profiles.

**Explicit non-goals.**

- Roster-fed enrollment through the `rosters` collection.
- Bulk enrollment operations.

---

### Phase 5: Assignment Foundation

**Objectives.** Introduce the assignment as the teacher's decision to surface a lesson for a class. Deliver draft, publish, close, and archive lifecycles under the PDR-010 curation vocabulary. Establish the read contract for `lessons/{lessonId}` inside the classroom lifecycle.

**Deliverables.**

- Assignment lifecycle callables (draft, publish, close, archive) owned by the assigning teacher.
- Bounded post-publish update callable for non-breaking edits.
- Teacher-facing assignment authoring surface inside the Teacher Platform Shell, replacing the placeholder Assignments navigation entry.
- Student-facing assignment discovery surface inside `/app/**`, filtered through active enrollments.
- Firestore rules for assignment reads scoped to the teacher and to enrolled students.
- Read-side integration with the existing `lessons/{lessonId}` catalog. Write side remains a curriculum-team responsibility outside this phase.

**Exit criteria.**

- A verified teacher can draft, publish, close, and archive an assignment against a real lesson, and enrolled students can see the assignment, all under the Emulator Suite.
- Every user-facing surface uses the "curation" vocabulary specified by PDR-010.
- No assignment ever contains embedded lesson content.
- CI and rules tests remain green.

**Architectural risks.**

- Post-publish edits silently changing student experience. Mitigation: post-publish updates are bounded and audited.
- Teacher-facing UI leaking the schema term "assignment" to students. Mitigation: strict vocabulary contract enforced in copy review.

**Explicit non-goals.**

- Grading policy configuration.
- Templates, cross-class shared assignments, or bulk operations.

---

### Phase 6: Submission Foundation

**Objectives.** Deliver the highest-volume write in the platform under the strictest security contract. Establish the server-mediated finalization transaction that produces the `finalized` record, and the teacher-facing review surface that reads it.

**Deliverables.**

- Server-mediated submission finalization callable that atomically writes the `submitted` record and transitions it to `finalized` within the same transaction.
- Teacher-facing bounded correction callable for administrative correction.
- Administrator-facing retention callable.
- Student-facing submission surface inside `/app/**` that captures work against the assignment vocabulary from Phase 5.
- Teacher-facing submission review surface inside the Teacher Platform Shell.
- Firestore rules for submission reads scoped to the submission's student and the class's teacher.
- Application of the guidance in `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md` for hot-path considerations.

**Exit criteria.**

- Enrolled students can finalize submissions against published assignments and see their own history; class teachers can review those submissions, all under the Emulator Suite.
- Every readable submission is finalized. No client-authored `started` state exists on the authoritative record.
- Finalized submissions are immutable outside the bounded correction path.
- CI and rules tests remain green.

**Architectural risks.**

- Finalization races that produce partial records. Mitigation: server-mediated atomic finalization transaction.
- Retention policy drift. Mitigation: retention lives in policy, applied through a single administrator-gated callable.

**Explicit non-goals.**

- AI-generated feedback.
- Portfolio surfaces across classes.
- Any per-submission analytics dashboard (owned by Phase 7).

---

### Phase 7: Analytics

**Objectives.** Turn the accumulated identity, classroom, and submission history into structured, safe teacher-facing and administrator-facing summaries. Establish which rollups are persisted documents, which are query patterns, and which are on-demand Cloud Function computations.

**Deliverables.**

- Rollup collections named by the Analytics sprint specification, where persistence is warranted.
- Server-mediated rollup query callables for teacher, class, and school scopes.
- Teacher-facing analytics surface inside the Teacher Platform Shell.
- Administrator-facing analytics surface inside `/app/**` for the `platformAdministrator` role.
- Firestore rules for rollup reads scoped to the appropriate actor.
- Documented adherence to `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md`.

**Exit criteria.**

- Teachers can see class-scoped and assignment-scoped summaries of student engagement and outcomes; administrators can see school-scoped summaries, all under the Emulator Suite.
- No client-side aggregation across multiple students' submissions exists. All aggregation is server-mediated.
- Rollup writes never mutate an authoritative record from an upstream domain.
- CI and rules tests remain green.

**Architectural risks.**

- Rollups drifting away from the source records. Mitigation: rollups are derived, not authoritative; source records remain the truth.
- Per-student data leakage through overly broad rollup shapes. Mitigation: rollup shapes are reviewed against the visibility scope of the reading actor.

**Explicit non-goals.**

- Student-facing analytics.
- Parent-facing analytics.
- District-scoped analytics.

---

### Phase 8: Administrator Platform

**Objectives.** Deliver the operational partner to the Teacher Platform. Give platform administrators a coherent surface for managing schools, teachers, enrollments, submissions retention, and analytics, replacing every direct callable invocation used during Phases 2 through 7 for administrative work.

**Deliverables.**

- Administrator-facing shell inside `/app/**`, scoped to the `platformAdministrator` role and dispatched by the existing router.
- Consolidated administrator surfaces for school management, teacher verification queue, enrollment archival, submission retention, and analytics.
- No new lifecycle state, no new claim, no new authoritative collection. Every administrator surface reads and writes through callables already established in Phases 1 through 7.

**Exit criteria.**

- Every administrator operation exercised during Phases 2 through 7 has a corresponding surface inside the Administrator Platform.
- No administrator surface bypasses a server-mediated callable.
- CI and rules tests remain green.

**Architectural risks.**

- Administrator surfaces developing shadow lifecycle fields. Mitigation: strict adherence to `status` as the only lifecycle field.
- Administrator surfaces developing shadow analytics rollups. Mitigation: administrator analytics reads only Phase 7 rollups.

**Explicit non-goals.**

- District platform.
- Cross-platform export surfaces.
- Parent, student, or teacher-facing extensions to administrator work.

---

## 5. Architectural Principles

Every future sprint, in every phase named above, must preserve the following principles. They are reaffirmed here so that no phase inherits ambiguity about what remains non-negotiable.

- **Firestore is authoritative.** Client-side state is derived from Firestore through the Canonical Session Bootstrap and equivalent server-mediated reads. On any disagreement between claims and record, the record wins.
- **`status` is the only lifecycle field.** No second lifecycle field is permitted on any document. Every domain in this roadmap models its own lifecycle through its own document's `status` (or through server-mediated transitions) without shadowing `users/{uid}.status`.
- **Audit events are append-only.** Every domain writes to `auditEvents` through the canonical `writeAuditEvent` helper. No domain edits or deletes an audit event. New audit vocabulary is a repository-level decision.
- **Immutable Session Objects.** The Session Object is the sole client-side derivation path for lifecycle-derived UI state. It is deep-frozen after construction. State changes are realized by re-running the bootstrap.
- **Custom claims remain limited to `role` and `schoolId`.** No new claim key is introduced by any phase.
- **`districtId` remains reserved only.** It is not written by any function or read by any client until a formally amended District phase authorizes it.
- **No architecture drift without formal amendment.** Any change to the certified Firestore Data Model, Firebase Security Model, Platform Architecture, Cloud Function Charter, or Platform State Machine is a documented, review-gated amendment. Sprints do not silently redefine the architecture.
- **Preserve server-mediated writes.** Every domain in this roadmap writes through Cloud Function callables. No client is granted direct write access to records outside the narrow self-update allowlist established by Sprint 2.
- **Preserve preservation mode.** The instructional repository at the repository root remains untouched by Teacher Platform sprints. Platform work lives under `platform/**`, `app/**`, and `docs/platform/**`. Instructional changes remain governed by the CLAUDE.md preservation rules.

These principles are the load-bearing invariants of the Teacher Platform. A phase that cannot deliver its objectives while preserving them must be re-scoped, not exempted.

---

*End of roadmap. This document defines the order in which the Teacher Platform is built. It does not define implementation. Every phase named here will be expanded into its own sprint specification when its time comes.*
