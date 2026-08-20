# LyfeLabz Teacher Platform Domain Roadmap

Status: Canonical
Companion documents: LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_PLATFORM_DOMAIN_MODEL.md, LYFELABZ_FIRESTORE_DATA_MODEL.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, PLATFORM_STATE_MACHINE.md, SPRINT_HISTORY.md, SPRINT_3_CERTIFICATION.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, TEACHER_JOURNEY.md, ASSIGN_EXPERIENCE.md

---

## Teacher-Facing Implementation Reference

Future sprint specifications that shape a teacher-facing surface (Curriculum, Classes, Present Mode, Settings, assignment scheduling, class Snapshots, class workspaces, or any subsequent teacher surface) must read `TEACHER_JOURNEY.md` alongside `TEACHER_EXPERIENCE_PHILOSOPHY.md` before proposing a surface shape. The philosophy states the principles; the journey grounds those principles in the concrete moments of a teacher's day. A surface that cannot be located inside a moment in the journey is a signal to reconsider the surface, not to add a moment. The journey defers to the certified architecture in every case of conflict.

`ASSIGN_EXPERIENCE.md` is the canonical workflow document for assignment-related implementation. Any future sprint that touches the Assign control, the Assignment Dialog, per-class scheduling rows, the "✓ Assigned" card state, or the confirmation and revisit behavior for a scheduled resource must reconcile its surface with `ASSIGN_EXPERIENCE.md`. Assignment scheduling is one workflow. Alternate assignment surfaces or parallel assign dialogs are not proposed by a sprint specification; they require a documented amendment to `ASSIGN_EXPERIENCE.md` first. The document defers to the Assignment Foundation phase (Phase 5) and to the certified architecture in every case of conflict.

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
- Custom claims are `{ role, schoolId, districtId }`. Sprint 9C (PDR-023c) promoted `districtId` from a reserved slot to a claim written on every `active` identity; the enforcement contract is `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` under PDR-025.

**Depends on.** No earlier platform domain. Depends on the Firebase project, Firebase Authentication, and the Sprint 1 Cloud Function scaffold.

**Depended on by.** Every subsequent domain. Schools resolves institutional tenancy through the `schoolId` claim. Teachers, Classrooms, Enrollments, Assignments, Submissions, and Analytics all key their access-control decisions off the role and school membership established here.

**Deferred to future sprints.**

- New roles beyond `teacher`, `student`, `platformAdministrator`.
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
- LMS Integrations - Google Classroom and Canvas, treated as external systems mapped into LyfeLabz entities. The canonical architecture for this extension is recorded in `LMS_INTEGRATION_ARCHITECTURE.md`, its teacher-facing shape in `LMS_EXPERIENCE.md`, and the ratified amendments to the certified architecture in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`. The named phase for this extension is Phase 9 (LMS Integration Foundation), described in Section 4. PDR-020 advances Phase 9 ahead of Phase 8 (Administrator Platform) for the narrow initial scope named in PDR-020c. Google Classroom is the formally authorized initial provider under PDR-020a; provider neutrality is preserved as a permanent architectural property under PDR-019h and PDR-020f. Canvas, Schoology, and Microsoft Teams for Education remain named-but-deferred subsequent providers.
- Professional Learning Communities.
- Teacher-authored instructional content, distinct from Lessons.

Each of these will receive its own roadmap when its time comes.

**Deferred to future sprints.** All of it. The Future Extensions section exists to name what is not being built now.

---

## 4. Implementation Roadmap

The roadmap is organized as sequential phases. Each phase corresponds to one domain from Section 3, expanded into an implementable body of work. Phase 1 is complete. Each phase is preceded by a sprint specification, prosecuted by one or more sprints, and closed by a completion report and certification in the same pattern as Sprints 1 through 3.

Phases are strictly sequential within the certified domain chain in §2. Phase execution order follows the phase-number sequence with one authorized exception: PDR-020 (LMS Phase Re-Sequencing and Initial Scope) advances Phase 9 (LMS Integration Foundation) ahead of Phase 8 (Administrator Platform) for the narrow initial scope named in PDR-020c. The certified domain chain in §2 is not reordered by that decision; Phase 8 remains defined in its own right and is scheduled as a subsequent phase after Phase 9's initial scope certifies. A phase does not begin until every phase it depends on is certified complete.

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

### Phase 2 UX Direction Amendment (2026-07-09)

The teacher experience direction is now clarified by `TEACHER_EXPERIENCE_PHILOSOPHY.md`. The philosophy document does not change the domain sequence in Sections 2 and 3; every domain remains authoritative for its own records. It does, however, revise the Phase 2 implementation sequence to seat the following surfaces in the correct order.

The revised Phase 2 sequence is:

1. **Sprint 6C - Teacher Workspace navigation restructuring.** Replace the Sprint 6A/6B top-nav with the persistent left-side navigation defined in §3.3 of the philosophy: LYFELABZ, Curriculum, Classes, Present Mode, Settings. Curriculum and Classes are the only active items in this sprint. Present Mode and Settings render coming-soon surfaces under the same contract used for unavailable navigation items in Sprint 6B. No new Firestore reads, no new callables, no new claim, no new lifecycle field. Session model unchanged.

2. **Sprint 6D - Curriculum landing surface (read-only bridge).** Replace the placeholder Home surface with a teacher curriculum landing page that references the canonical instructional repository. Introduces no lesson content into the platform. The bridge mechanism is a Phase 2 architecture decision recorded in the Phase 2 Architecture Planning Report.

   **Sprint 6D.0 - Canonical Curriculum Manifest Extraction (prerequisite).** Sprint 6D certification depends on Sprint 6D.0. The initial Sprint 6D implementation carried a manually maintained TypeScript registry (`app/src/shell/surfaces/shared/lessonCatalog.ts`) that duplicated curriculum metadata already authored in the root `index.html`. Sprint 6D.0 replaces that shadow registry with a deterministic build-time extractor (`app/scripts/build-curriculum-manifest.cjs`) that reads the canonical `index.html` and emits a checked-in `app/src/curriculum/curriculum.manifest.json`. The teacher application consumes only the generated manifest through a typed selector. A drift test and a `--check` CLI mode enforce that the manifest and the canonical index cannot diverge. See `SPRINT_6D_0_SPECIFICATION.md` and `SPRINT_6D_0_COMPLETION_REPORT.md`. The manifest is the structural expression of PDR-007 and TEACHER_EXPERIENCE_PHILOSOPHY.md §3.9 for the teacher-application build.

3. **Phase 2 continues** with the School Foundation objectives originally recorded below, executed in parallel with or after Sprints 6C and 6D as the sprint specifications dictate. Nothing in Sprints 6C or 6D relaxes the administrator-mediated school-write contract described in the Phase 2 Objectives.

Every subsequent phase (Classrooms through Administrator Platform) remains as recorded in Sections 3 and 4. The philosophy document does not compress or expand any phase; it only names the teacher-facing shape that each phase's surfaces must ultimately satisfy.

Present Mode, curriculum activation, class workspaces, private student supports, and Google Classroom integration are called out in the philosophy for architectural clarity, but they are not moved into Phase 2. They remain in their respective downstream phases:

- Curriculum activation and the assignment workflow: Phase 5 (Assignment Foundation).
- Class workspaces (roster + assignment columns + mastery data): span Phases 4 - 7.
- Private student supports and accommodations: require their own architecture specification before any implementation sprint.
- Google Classroom and PowerSchool responsibilities: PDR-015 (Future Expansion). No integration ships in the current sprint sequence.
- Present Mode: architecture foundation may be scheduled inside Phase 2 as a Phase 2 - or later - narrow architecture sprint. Its runtime is deferred until its architecture is certified.

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

**Sequencing note.** PDR-020b advances Phase 9 (LMS Integration Foundation) ahead of Phase 8 for the narrow initial scope named in PDR-020c. Phase 8 is unchanged in scope, objectives, deliverables, exit criteria, risks, and non-goals; it is scheduled as a subsequent phase after the LMS initial scope certifies. Administrative work continues to run through the callables already established in Phases 1 through 7 until Phase 8 certifies. See Phase 9 below for the advanced-phase description.

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

### Phase 9: LMS Integration Foundation

**Status.** Scheduled. Advanced ahead of Phase 8 (Administrator Platform) by PDR-020 (LMS Phase Re-Sequencing and Initial Scope). Implementation of the initial scope named below is authorized. Every load-bearing decision in PDR-019 continues to apply without exception.

**Placement rationale.** Phase 9 was originally sequenced strictly after Phase 8. PDR-020 advances it ahead of Phase 8 for a narrow initial scope in response to pilot priorities: teacher onboarding for pilot schools is materially improved by importing existing Google Classroom classes rather than reconstructing them by hand. The certified domain chain in §2 is not reordered by this move. Phase 8 remains defined in its own right and is scheduled as a subsequent phase. Advancing Phase 9 does not delete, compress, or redefine Phase 8. Administrative work continues to run through the callables already established in Phases 1 through 7 until Phase 8 certifies. The initial scope named below is narrow by design; every excluded capability remains reachable as its own subsequent sprint under the internal Phase 9 sequence recorded in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` §8.

**Objectives.** Deliver vendor-neutral LMS integration as described in `LMS_INTEGRATION_ARCHITECTURE.md`. Google Classroom is formally authorized as the initial provider under PDR-020a. Preserve every certified boundary between LyfeLabz and every external learning management system. Preserve every load-bearing decision in PDR-004, PDR-005, PDR-010, PDR-011, PDR-012, PDR-015, PDR-017, PDR-018, PDR-019, and PDR-020.

**Approved initial scope (per PDR-020c).** The initial LMS scope authorized under PDR-020 contains only:

- provider abstraction,
- provider registry,
- connection lifecycle (creation, lookup, revocation, ownership verification),
- secure infrastructure (server-only OAuth flow and token storage abstractions),
- class discovery,
- class import.

The initial scope explicitly excludes:

- roster synchronization,
- assignment publication,
- assignment refresh,
- grade synchronization,
- automatic synchronization,
- background jobs,
- webhooks,
- Google Drive integration,
- Gmail integration,
- Calendar integration,
- Canvas implementation,
- Schoology implementation,
- Microsoft Teams for Education implementation,
- SIS integration,
- district rollup.

Every excluded capability remains reachable as its own subsequent sprint under the internal Phase 9 sequence recorded in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` §8. No excluded capability may be introduced by an implementation sprint that authorizes only the initial scope. Expansion of the initial scope requires a subsequent PDR or a subsequent sprint specification. Expansion by implementation is prohibited.

**Deliverables (initial scope).**

- Provider abstraction and provider registry named by the Cloud Function Charter, seeded with a single `googleClassroom` provider under the closed set in the Firestore Data Model amendment.
- OAuth initiation and completion callables owned by the Cloud Function Charter, satisfying the server-only token boundary in PDR-019e.
- The additive Firestore collections `lmsProviders`, `lmsConnections`, and `lmsClassLinks` named by the Firestore Data Model amendment. The `lmsRosterLinks` and `lmsAssignmentPublications` collections remain reserved by the data model but are not populated by the initial scope.
- Additive fields on `classes/{classId}` (`lmsProviderRef`, `enrollmentSource`) recorded in the Firestore Data Model amendment. Additive fields on `enrollments/{enrollmentId}` and `assignments/{assignmentId}` remain reserved but unpopulated under the initial scope.
- Firestore Rules covering the new collections and the new fields under the same class-scoping principles as the underlying certified records.
- Teacher-facing Integrations surface inside Settings under the workspace-surface identifier `settings/integrations`, per `PLATFORM_CONTRACTS.md`, delivering connection lifecycle, class discovery, and class import to the teacher.
- LMS-scoped audit vocabulary limited to the events emitted by the initial scope: `lms.connectionCreated`, `lms.connectionRevoked`, `lms.classImported`, `lms.classUnlinked`, `lms.ownershipDrift`. The remaining LMS audit vocabulary (`lms.classRefreshed`, `lms.assignmentPublished`, `lms.publishFailed`) remains reserved but unemitted until its owning sprint.

**Exit criteria (initial scope).**

- A verified teacher can connect Google Classroom, discover the classes she teaches in Google Classroom, import a specific class into LyfeLabz, and disconnect the integration, all under the Emulator Suite.
- Every LMS write is server-mediated and produces an audit record. No OAuth token reaches the client.
- The Teacher Workspace continues to render when Google Classroom is unreachable. Present Mode, Curriculum, Classes, Snapshot, and Practice/Classroom Mode are unaffected by LMS integration state.
- CI and rules tests remain green.

**Architectural risks.**

- Initial scope creeping into excluded capabilities during implementation. Mitigation: PDR-020c names the excluded capabilities explicitly; expansion by implementation is prohibited.
- LMS integration becoming an alternate assign workflow. Mitigation: `ASSIGN_EXPERIENCE.md` §5 remains authoritative and the one-dialog rule is preserved. Publication is out of the initial scope.
- OAuth tokens leaking to the client. Mitigation: server-only token storage per the Firebase Security Model amendment.
- Google-specific decisions becoming architectural facts. Mitigation: PDR-019h and PDR-020f preserve provider neutrality as a permanent architectural property. Provider-specific concerns live inside the provider adapter; provider-neutral concerns live inside the core.
- Automatic synchronization introduced silently. Mitigation: manual import is the initial scope; refresh is out of the initial scope; PDR-019c preserves the manual-first posture.
- Silent ownership reassignment on LMS teacher-of-record change. Mitigation: PDR-005 remains authoritative; LMS integration never reassigns class ownership.

**Explicit non-goals (initial scope).** Every capability enumerated in the exclusion list above is an explicit non-goal for the initial scope. It remains reachable as its own subsequent sprint but is not delivered by the sprint that lands the initial scope.

**Sequencing.** Depends on Phase 5 (Assignment Foundation) and Phase 6 (Submission Foundation), which own the record shapes the LMS phase extends. Both are certified complete. Does not require Phase 7 (Analytics) or Phase 8 (Administrator Platform); PDR-020d and PDR-020e establish that neither is a technical prerequisite for the initial scope. The recommended internal sprint sequence for Phase 9 is recorded in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` §8. The initial scope corresponds to the amendment's LMS Sprint B (Firestore, Rules, and callable scaffolding) and the discovery-and-import portion of LMS Sprint C. Refresh, publication, and the remaining LMS sprints are reachable subsequent phases and remain out of the initial scope.

**Implementation status (updated 2026-08-18).**

- **Sprint 24A - LMS infrastructure and OAuth host correction: certified.** See `SPRINT_24A_COMPLETION_REPORT.md`.
- **Sprint 24B - activation seam and roster synchronization: ✅ Production Certified (2026-08-05).** Canonical record: `SPRINT_24B_FINAL_CERTIFICATION_REPORT.md`. Sprint 24B advanced Phase 9 beyond the initial scope to deliver the activation seam (`classesLmsCreate`, `classesActivate`) and roster synchronization (`lmsClassesSyncRoster`, `lms.rosterSynchronized`), certified end to end through the genuine teacher workflow under the Emulator Suite. Roster synchronization was one of the initial-scope exclusions above; it is now delivered and certified as a subsequent Phase 9 sprint, consistent with the amendment's internal sequence.
- **Sprint 25 - LMS Assignment Publication: ✅ Complete with Documented Limitation (2026-08-17).** Canonical record: `SPRINT_25_COMPLETION_REPORT.md`. Publication is delivered as an opt-in extension of the one Assign dialog: a teacher publishes an existing LyfeLabz assignment to a linked Google Classroom course, optionally under a chosen topic, obtaining the coursework scopes through a one-time incremental OAuth consent that widens the single existing connection. The decisive path was certified end to end against real Google Classroom with operator confirmation (B9/B10 genuine incremental consent; B8/B11/B12 real coursework write filed under the selected topic and pointing at the LyfeLabz URL; real coursework `874752057518`). Two live-certification discoveries were corrected in code and re-certified: the write scope is `classroom.coursework.students`, not `classroom.coursework.me` (PDR-030g), and an automatic access-token refresh lifecycle was added at credential resolution (PDR-030h). The limitation: B13 (teacher cancels incremental consent) is PASS WITH LIMITATION - the live cancel branch could not be cheaply reproduced because Google's `include_granted_scopes` re-folds previously granted scopes, and the LyfeLabz-side behavior is instead covered by deterministic unit tests (canonical: `SPRINT_25_B13_ARCHITECTURE_REASSESSMENT_AND_CLOSURE.md`). The non-decisive failure-path/retry/multi-class browser scenarios (B14 - B23) were not run live and rest on compensating automated evidence; none surfaced a defect. Production rollout (Google OAuth verification for the coursework scopes, Data Access declaration) remains a level-E gate outside the sprint (PDR-030f).

- **Sprint 26 - LMS UX Hardening: ✅ Complete (2026-08-18).** Canonical record: `SPRINT_26_COMPLETION_REPORT.md`. A UX hardening sprint on top of certified Sprint 25 that adds no LMS capability. It delivered the Sprint 25 deferred follow-up, none of which blocked Sprint 25 closure: proactive Google account continuity during incremental publication consent (the durable connection's stored Google account identifier is threaded into `beginOAuth` and set as `login_hint` for publication intent to steer Google toward the connected account, while the post-callback `lms.identityMismatch` hard invariant is preserved as the security boundary); clearer identity-mismatch teacher UX; PII-safe consent-flow observability (`lms.connectionScopesWidened` / `lms.connectionWideningRejected`); resolution of the failure-path client defects 2.A (truthful draft-create-vs-publish messaging) and 2.B (a stranded draft no longer lights the Assigned badge); a Settings connection-recovery path that replaces the reconnect dead-end; and the Settings spacing fix. A certification-discovered Phase 4 defect - the Settings Reconnect action did not re-mint an active-but-unusable credential - was determined to be within Phase 4 scope, corrected before closure through an explicit provider-neutral `reconnect` OAuth intent, and certified deterministically. Certified through its narrowly scoped live Google integration boundary in course `871447706346` (live `login_hint` account continuity, completion-time identity revalidation, and two live Google Classroom publications with silent reuse; courseworks `874953413992` / `874953414061` / `874954047705`). B13 remains PASS WITH LIMITATION and was not reopened. All Sprint 26 work preserved the one-dialog assign workflow in `ASSIGN_EXPERIENCE.md`; the deferred-follow-up ownership detail is in `SPRINT_25_COMPLETION_REPORT.md` §13.

- **Sprint 27 - Student Classroom Lifecycle Completion & Certification: ✅ Complete and Certified with Documented Limitations (2026-08-19), pending production release (Sprint 29).** Canonical record: `SPRINT_27_COMPLETION_REPORT.md` (definition: `SPRINT_27_DEFINITION.md`; architecture: `SPRINT_27_ARCHITECTURAL_BLUEPRINT.md`; plan: `SPRINT_27_IMPLEMENTATION_PLAN.md`; certification: Phase 6 validation, Phase 7 browser, Phase 8 live-provider reports). Sprint 27 closed the student side of the classroom lifecycle through narrow wiring and integration rather than a student-platform rebuild. It wired the minimum canonical My Results surface over the existing caller-scoped `assessmentAttemptsList` read with client-side self-aggregation (PDR-024i), gave Google-Classroom-rostered students a server-mediated onboarding and enrollment path that does not require a manual join code (`studentsCompleteLmsOnboarding`), reconciled the Google Classroom coursework deep link from the client-supplied bare-lesson URL to a server-built assignment-aware route (`https://app.lyfelabz.com/app/a/{assignmentId}`) with a read-only server-side resolver (`lmsDeepLinkResolve`, PDR-027), and preserved frozen-recipient semantics with an explicit teacher late-recipient affordance over the certified `assignmentsRecipientAdd` (`source: manualAddition`) path. The complete teacher-to-student-to-teacher loop was certified as one integrated browser and emulator flow: Path A (manual class), the LyfeLabz-controlled portions of Path B (Classroom-linked class), Path C (late-enrollment recovery), and Path D (signed-out deep-link auth round trip), plus all three required negative assertions; the Firestore Rules suite passed (228/228, rules unchanged). One narrow live Google boundary was certified: a real `courses.courseWork.create` accepted the server-built deep-link URL and returned coursework `875115775254` in course `871447706346` (assignment `s27cert-deeplink-1`), with a live read-back confirming the stored material link is exactly `https://app.lyfelabz.com/app/a/s27cert-deeplink-1`; no OAuth widening or reconnection was required. One genuine Sprint 27 defect (D1, the `/app/a/{id}` route could not load the app bundle because of a relative bundle reference in `app/index.html`) was found in browser certification and corrected narrowly to the absolute `/app/dist/bundle.js`, then re-certified. Documented non-blocking limitations deferred to Sprint 28: O1 (the teacher "Close assignment" control did not render on the Classroom-linked Assignment Detail; a pre-existing behavior, not a Sprint 27 regression; the closed-assignment resolver negative was certified through the canonical `assignmentsClose` callable) and O2 (a v2 post-submission results scroll position). Frozen-recipient semantics (PDR-029d, PDR-029h, PDR-029l) preserved; `BETA_SCHOOL_ID` kept for the single-school v1 pilot; the client-supplied-`schoolId` manual-path question deferred to post-v1. B13 not reopened. Deterministic baselines at closeout: Functions 91 suites / 1699 tests / 0 failures; App 65 suites / 1092 tests / 1 pre-existing curriculum-manifest SHA drift failure (a declared non-goal, unrelated to Sprint 27, Sprint 29 item). Not deployed: Sprint 27 is uncommitted and undeployed; the `/app/a/{assignmentId}` resolver route resolves live only after the Sprint 27 release is deployed. Production deployment and final v1 production certification remain Sprint 29. The v1 release sequence continues as Sprint 27 (this sprint) then Sprint 28 (Teacher Workflow & UX Polish + Pre-Release Hardening) then Sprint 29 (Teacher Platform v1 Release Certification).

- **Sprint 28 - Teacher Workflow & UX Polish + Pre-Release Hardening: ✅ Complete and Certified with Documented Limitations (2026-08-20), uncommitted, not production deployed; Sprint 29 release certification pending.** Canonical records: `SPRINT_28_DEFINITION.md` (scope, amended Phase 2C), `SPRINT_28_ARCHITECTURAL_BLUEPRINT.md`, `SPRINT_28_IMPLEMENTATION_PLAN.md`, `SPRINT_28_CURRICULUM_MIGRATION_AUDIT.md`, `SPRINT_28_PHASE_5A_V2_MIGRATION.md`, `SPRINT_28_PHASE_5B_ASSESSMENT_FIDELITY.md`, `SPRINT_28_PHASE_6_DETERMINISTIC_VALIDATION.md`, `SPRINT_28_PHASE_7_BROWSER_CERTIFICATION.md`. Sprint 28 hardened the existing teacher and student lifecycle against the six Sprint 27 observations (O1-O6) and, under an approved Phase 2C scope amendment, migrated the entire assignable curriculum onto one coherent v2 assignment-aware student contract. Delivered: W1 Assignment Detail teacher polish (O1 lifecycle-control verification with a permanent LMS-shaped regression test; O5 calm informational states for non-addable lifecycle statuses, add-success feedback, and in-flight `aria-live` announcements, frozen-recipient semantics preserved); W2 v2 assessment results UX across all 49 assignable lessons (O2 sticky-chrome scroll offset, focus move, and `role="status"` announcement; O3 assignment-context-gated `Back to My Assignments` to `/app/`, with v1/practice/standalone behavior byte-preserved); W3 manual `studentsCompleteOnboarding` idempotent claims self-heal (O4, mirroring the certified LMS self-heal, server-authoritative, no second activation audit, bounded no-op when healthy); W4 assignable curriculum v2 migration (49/49 lessons built from canonical sources through the Sprint 18 deterministic build system with launch overrides, `nature-of-waves` unblocked in Phase 5A.1), plus Phase 5B answer-key authoring (49/49 fidelity-valid `<slug>.r1.json` payloads, 495 questions, 1,980 choices, 0 mismatches, authored not deployed). Phase 6 deterministic baseline: `lessons:build` zero-drift and `lessons:verify` 49/49; W2 contract 49 lessons / 539 tests green; assessment fidelity 49 lessons / 248 tests green; App 68 suites / 1,888 tests with the single pre-existing `curriculumManifest.test.ts` `#how` SHA-drift red (verified to be SHA-field-only, `index.html` untouched, Sprint 29-owned); Functions 91 suites / 1,708 tests / 0 failures; Firestore Rules 18 suites / 228 tests / 0 failures (0 rules changed). Repository publication readiness: 49/49. No em dashes across 143 changed lesson files; no scope drift; no secrets or deploy-config changes. Deferred to Sprint 29: assessment deployment, curriculum-manifest SHA regeneration, and final v1 production certification. No large new domain feature family was introduced. Phase 7 browser & emulator certification (2026-08-20, `SPRINT_28_PHASE_7_BROWSER_CERTIFICATION.md`) certified every Sprint 28-new browser-only behavior against local emulated and seeded state with no live Google mutation: the O1 Assignment Detail lifecycle (published -> Close -> closed -> Reopen -> published) live on a manual class and the Close control on a genuinely LMS-linked published assignment (closing the Sprint 27 O1 limitation); the O5 late-recipient add success / in-flight `aria-live` / duplicate-prevention / closed-informational-note flow with the backend recipient written at `manualAddition`; the O2 results scroll-offset / focus / `role="status"` semantics at desktop and mobile across a structural representative matrix (earths-layers, nature-of-waves diagrams, a new G6, a new G7, the `el` prefix-collision photosynthesis, the divergent-legacy gravity, and the 15-question body-systems); the O3 `Back to My Assignments` -> `/app/` positive and its practice/standalone negative; the O4 manual onboarding claims self-heal at the deployed emulator callable; and the signed-out deep-link path-preservation regression. No Sprint 28 defect was found; limitations are tooling boundaries (headless smooth-scroll no-op, suppressed sign-in popup, screen-reader speech, the O5 failure-injection and draft-UI paths) each backed by deterministic evidence. The Phase 6 deterministic baseline remains valid (Phase 7 changed no production source). All Sprint 28 work remains uncommitted for manual review and commit, and remains not production deployed. Sprint 29 owns final manifest regeneration, assessment deployment, production deployment, Google/OAuth release items, and Teacher Platform v1 Release Certification.

- **Sprint 29 - Teacher Platform v1 Release Certification: Planned.** Likely focus: final stabilization; curriculum-manifest SHA drift resolution; a complete deterministic baseline; documentation reconciliation; the Google OAuth verification and Data Access disposition; Secret Manager rotation; production deployment; production teacher and student smoke and end-to-end tests; final v1 production certification. No Sprint 30 is planned; work after Sprint 29 is driven by classroom feedback, defects, or a deliberately chosen feature family.

---

---

## 5. Architectural Principles

Every future sprint, in every phase named above, must preserve the following principles. They are reaffirmed here so that no phase inherits ambiguity about what remains non-negotiable.

- **Firestore is authoritative.** Client-side state is derived from Firestore through the Canonical Session Bootstrap and equivalent server-mediated reads. On any disagreement between claims and record, the record wins.
- **`status` is the only lifecycle field.** No second lifecycle field is permitted on any document. Every domain in this roadmap models its own lifecycle through its own document's `status` (or through server-mediated transitions) without shadowing `users/{uid}.status`.
- **Audit events are append-only.** Every domain writes to `auditEvents` through the canonical `writeAuditEvent` helper. No domain edits or deletes an audit event. New audit vocabulary is a repository-level decision.
- **Immutable Session Objects.** The Session Object is the sole client-side derivation path for lifecycle-derived UI state. It is deep-frozen after construction. State changes are realized by re-running the bootstrap.
- **Custom claims are limited to `role`, `schoolId`, and `districtId`.** Sprint 9C (PDR-023c) promoted `districtId` from a reserved slot to a canonical claim; the enforcement contract is `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` under PDR-025. No further claim key is introduced by any phase named in this roadmap.
- **`districtId` is server-written and server-refreshed.** It is written on every `active` identity and cleared on any transition out of `active`, per PDR-025b and PDR-025c. Client-driven mutation is denied per PDR-025i; a district transfer callable requires a superseding PDR.
- **No architecture drift without formal amendment.** Any change to the certified Firestore Data Model, Firebase Security Model, Platform Architecture, Cloud Function Charter, or Platform State Machine is a documented, review-gated amendment. Sprints do not silently redefine the architecture.
- **Preserve server-mediated writes.** Every domain in this roadmap writes through Cloud Function callables. No client is granted direct write access to records outside the narrow self-update allowlist established by Sprint 2.
- **Preserve preservation mode.** The instructional repository at the repository root remains untouched by Teacher Platform sprints. Platform work lives under `platform/**`, `app/**`, and `docs/platform/**`. Instructional changes remain governed by the CLAUDE.md preservation rules.

These principles are the load-bearing invariants of the Teacher Platform. A phase that cannot deliver its objectives while preserving them must be re-scoped, not exempted.

---

*End of roadmap. This document defines the order in which the Teacher Platform is built. It does not define implementation. Every phase named here will be expanded into its own sprint specification when its time comes.*
