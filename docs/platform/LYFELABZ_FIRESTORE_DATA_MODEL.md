# LyfeLabz Firestore Data Model

Version 1.0
Status: Canonical design reference
Scope: Cloud Firestore data model for the LyfeLabz Platform

This document is documentation only. It defines how the Platform Domain Model maps into Cloud Firestore. No Security Rules, Cloud Functions, indexes, or configuration are defined here. Those artifacts are downstream deliverables that must conform to this document.

This document assumes the reader is already familiar with:

- LYFELABZ_PLATFORM_DOMAIN_MODEL.md
- LYFELABZ_PLATFORM_ARCHITECTURE.md
- LYFELABZ_PLATFORM_ARCHITECTURE_CERTIFICATION.md
- ASSESSMENT_PIPELINE_SPECIFICATION.md
- IDENTITY_AND_ONBOARDING_SPECIFICATION.md

## Sprint 9C Reconciliation Notice

The identity portion of this document is superseded by `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` and PDR-023. Apply the following while reading:

- **District identifier is required.** Every `schools/{schoolId}` document carries a required `districtId`. Every `users/{uid}` document carries a `districtId` for teacher and student records once identity is `active`. Cross-district reads are refused at the security-rule layer per Section 6 of the specification.
- **Roster placeholders are a class-scoped concept.** A roster placeholder in the `awaitingFirstSignIn` state is stored on the class (or on a per-class enrollment mirror), not as a `users/{uid}` document. `users/{uid}` documents are created only at first successful Google sign-in.
- **Join code storage is exclusive to manual classes.** Any collection or field representing a join code is scoped to manual classes. LMS-linked classes carry no active join code.
- **Roster authority is a class-level attribute.** Each class carries a canonical `rosterAuthority` value of `google_classroom` or `lyfelabz`. Hybrid authority is refused.
- **Teacher multi-school membership is expressed on the identity record.** A teacher `users/{uid}` document carries a set of authorized `schoolIds` within its `districtId`, not a duplicated identity per school. The `schoolId` custom claim reflects the currently active membership.
- **Verification-code redemption records are server-only.** Any collection introduced to hold or track verification-code state is server-writable only. No client role reads a valid, unredeemed code.

Where this document and `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` conflict, the specification controls.

---

## Sprint 9A Reconciliation Notice

The formative assessment portion of this document is superseded by `ASSESSMENT_PIPELINE_SPECIFICATION.md` and PDR-021. Read every mention of `submissions/{submissionId}` in this document under the mapping **Submission → Attempt** and apply the following:

- The authoritative record is the **Attempt**. There is no separate Submission entity. The `submitted` state remains internal to the server-side scoring transaction and is never externally observable.
- A distinct **Session** entity holds transient, resumable, autosaving student working state. Sessions expire 24 hours after last activity, are archived on expiry, and are retained for a bounded recovery window before deletion. Sessions are never counted as attempts. Session storage lives in its own collection distinct from attempts. The specification (Sections 6, 9, 10) governs session shape and retention.
- Every attempt document records the **internal assessment revision identifier** the student was scored against. Lesson version stamping continues to apply (PDR-009).
- The `mode` field on the pre-Sprint 9A submission shape ("classroom" / "practice") is retired. Every recorded attempt is by definition an authenticated authorized attempt; the pre-Sprint 9A Practice / Classroom mode toggle is removed by PDR-021e.
- Every assignment belongs to exactly one class. Assigning one activity to multiple classes creates one assignment document per class through server-side fan-out (PDR-021g).
- Scoring is server-authoritative. Answer keys are server-confidential and are not delivered to the client before submission. Attempt writes originate only from the Cloud Function scorer.

Where this document and the specification conflict, the specification controls. Sprint 9B implementation is responsible for reconciling the concrete Firestore shape (collection names, field names, retention windows) with the specification.

---

## 1. Design Principles

The following principles guide every decision in this document. Where later sections make a choice, they defer to these principles.

### 1.1 Single Source of Truth

Every fact about the platform lives in exactly one authoritative location. A student's name lives on the student record. An assignment's window-close timestamp lives on the assignment. When another document needs that fact, it references the source rather than copying it.

Copies are permitted only as deliberate performance denormalizations, and every such copy must be labeled as derived data with a clear rebuild path.

### 1.2 Immutable Ownership

Ownership fields (owner teacher, owning class, owning school) never change after a document is created. If a document must be reassigned to a new owner, it is archived and a new document is created. This preserves audit clarity, simplifies security rules, and prevents "ownership drift" over the five year maintenance window.

### 1.3 Immutable Instructional Content

Lessons, quizzes, vocabulary sets, and other instructional content are treated as versioned, immutable artifacts. A student submission from October must reference the exact lesson version the student experienced in October, even if the lesson is later revised.

This principle is load-bearing for scientific accuracy claims, teacher trust, and the Repository Hardening posture already established in CLAUDE.md.

### 1.4 Favor Reads Over Writes

Classroom traffic is overwhelmingly read-dominated. Teachers open dashboards repeatedly. Students revisit assignments. Submissions are read many times after being written once. The model is shaped so that the common read path is a small number of direct document reads or a single indexed query, even when this makes writes slightly more complex.

### 1.5 Minimize Document Contention

Any document that could be written by many actors simultaneously is a contention hazard in Firestore. Class rosters, assignment aggregates, and school-wide counters are all candidates for contention. The model avoids single hot documents by distributing writes across per-student or per-submission documents, and by computing aggregates asynchronously rather than incrementing shared counters.

### 1.6 Understandable Security Rules

Security rules that require joining more than one document at read time are fragile and expensive. The model is shaped so that every document contains the ownership fields required to authorize access on its own, without lookups. If a rule needs to know "who owns this," the answer is on the document itself.

### 1.7 Prepare for Future Scale

The Version 1 target is one school. The five year target is hundreds of schools. The model must not require a structural rewrite to cross that boundary. Every collection is designed as if it already contains millions of documents, even when it currently contains dozens.

### 1.8 Stable Document Identifiers

Document IDs are permanent. They are never reused, never renamed, and never reassigned. Human-readable identifiers (join codes, lesson slugs) are separate fields, not IDs. This decoupling protects the model from the naming churn that inevitably occurs across a multi-year curriculum.

### 1.9 Design for Deletion Later

Right-to-be-forgotten requests, student transfers, and end-of-year cleanup are all easier when personally identifying information is concentrated in a small number of collections. The model concentrates PII on the user record and references it by ID everywhere else, so deletion cascades touch a bounded set of documents.

---

## 2. Collection Hierarchy

This section proposes the top-level Firestore collections. Every collection listed here is a root collection unless explicitly described as a subcollection. Nesting is used sparingly, because deeply nested data is harder to query across, harder to secure uniformly, and harder to migrate.

The recommended hierarchy is deliberately flat.

### 2.1 users

Purpose: Canonical identity for every human that authenticates against the platform.

Why it exists: Firebase Authentication provides an identity token, but the platform needs a domain record for each person that carries role, profile, and consent state. Splitting identity (Auth) from profile (Firestore) is the standard Firebase pattern and keeps auth concerns separate from domain concerns.

What belongs here: One document per authenticated human. Roles include `teacher`, `student`, and `platformAdministrator`. Future roles (`parent`, `schoolAdministrator`, `districtAdministrator`) fit here without new collections.

**Terminology note.** The word "assignment" in this document is the neutral internal schema term for the pointer record described by PDR-010 (Curation). It is used at the schema and query layer only. User-facing surfaces (teacher UI, student UI, notifications) never render the words "assigned," "due," "late," "overdue," or "graded" to students or teachers. This distinction is normative across every document in this corpus.

Why top level: Users cross classroom and school boundaries. A student may move schools. A teacher may teach in multiple classes. Nesting users under any parent collection would create migration pain the moment that assumption breaks.

### 2.2 schools

Purpose: Represents an institutional tenant.

Why it exists: Even in a single school Version 1, the school is the natural boundary for administrative access, branding, and future district rollup.

What belongs here: One document per school. Contains identity, timezone, academic calendar reference, and administrative pointers. Enrollment and rosters are not stored here.

Why top level: Schools are the tenancy boundary. Nesting them under a hypothetical district collection now would prematurely commit to a district hierarchy that Version 1 does not have.

### 2.3 classes

Purpose: Represents a teacher's class section.

Why it exists: The class is the primary unit of instruction and the primary security boundary for student data.

What belongs here: One document per class section. Owns join codes, class metadata, block, grade, teacher pointer, and school pointer.

Why top level: Classes are queried by teacher, by school, and by join code. A subcollection under teachers would break the join-code lookup and the school-level administrative view. A subcollection under schools would break the teacher-centric view. Top level with indexed fields serves all three access patterns cleanly.

### 2.4 enrollments

Purpose: Represents the relationship between a student and a class.

Why it exists: A student can be in many classes. A class contains many students. This is a many-to-many relationship and deserves its own collection.

What belongs here: One document per (student, class) pair. Carries enrollment date, status (active, transferred, withdrawn), and any per-class student metadata such as block-specific display name.

Why top level: Storing enrollments as an array on either the class or the student would create hot-document contention during class rostering and would cap classroom size at Firestore's document size limit. A separate collection also allows enrollment state to be queried independently for reporting.

### 2.5 lessons

Purpose: Canonical catalog record for every instructional page in the repository.

Why it exists: The static HTML in the repository is the delivery surface. Firestore needs a matching record for assignments, submissions, and analytics to point at.

What belongs here: One document per lesson version. Contains the lesson slug, display title, grade, unit, narrative, and version metadata. Does not contain lesson body content. The HTML file remains the source of truth for instructional content.

Why top level: Lessons are referenced by every assignment and submission, and are queried across grades and units. They are not owned by any school or teacher.

### 2.6 assignments

Purpose: A teacher's curation of a lesson for a specific class. "Assignment" is the schema term for the pointer record described by PDR-010; the user-facing vocabulary is always "curation."

Why it exists: The same lesson may be surfaced by many teachers with different windows, instructions, and configurations. The assignment record is where instructional intent meets classroom context.

What belongs here: One document per assignment record. References one class, one lesson version, and one teacher. Carries an optional window-close timestamp, mode (`practice` or `classroom`), and optional instructions.

Why top level: Assignments are queried per class, per teacher, per lesson, and (for administrative views) per school. Top level with indexed fields supports all four without duplication.

### 2.7 submissions

Purpose: A student's completed work on an assignment.

Why it exists: Submissions are the highest-volume write in the system and the most sensitive read. They deserve a dedicated collection with a purpose-built shape.

What belongs here: One document per (student, assignment) attempt. Contains score, per-question responses, timing metadata, and the frozen lesson version reference. Submissions are append-mostly and effectively immutable after finalization.

Why top level: Submissions are queried per student, per assignment, per class (via assignment), and per teacher (via assignment). A subcollection under assignments would make the "all work by one student" query expensive. A subcollection under students would make the "all submissions for one assignment" query expensive. Top level with indexed fields serves both.

### 2.8 rosters (deferred)

Purpose: Reserved namespace for future SIS-synced roster imports.

Why it exists: Enrollments captured through student self-service (join code) are structurally distinct from enrollments produced by an authoritative roster feed. Keeping a separate collection ready avoids overloading the enrollments collection later.

What belongs here: Nothing in Version 1. Reserved.

Why top level: If it ever exists, it will be queried per school and per class.

### 2.9 auditEvents

Purpose: Append-only record of platform-significant events.

Why it exists: Administrative accountability, incident response, and future compliance conversations all require a durable event log distinct from application state.

What belongs here: One document per event. Actor, action, target, timestamp, and a small structured payload.

Why top level: Audit events are queried by actor, by target, and by time range. They are never nested under the object they describe, because the object may be deleted while the audit trail must survive.

### 2.9.a LMS integration collections (reserved by ratified architecture, not yet live)

The five collections below are reserved by `LMS_INTEGRATION_ARCHITECTURE.md` and its ratified amendment. They become live only when the LMS Integration Foundation phase (`TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §4, Phase 9) is scheduled. Each is a top-level collection, follows the certified conventions of Section 2 (stable identifier at the document root, server-set timestamps, explicit `ownerUid` and `schoolId` denormalization where security-rule performance requires it, additive schema evolution), and is subordinate to the certified records it mirrors.

**lmsProviders**

- Closed set of supported LMS providers. Version 1 contains the single document `googleClassroom`.
- Read-only reference data. Contains no PII and no token.
- Additional providers require an amendment to `LMS_INTEGRATION_ARCHITECTURE.md`.

**lmsConnections**

- One document per (teacher, provider) pair. The teacher's opt-in to a specific LMS provider.
- Carries the granted OAuth scopes, a server-only reference to the token record (never the token itself), and a connection status (`active`, `revoked`, `stale`).
- Never readable by the client on any field that references the token.

**lmsClassLinks**

- One document per (LyfeLabz class, LMS class) pair. The mirroring link between a `classes/{classId}` record and its upstream LMS class identifier.
- Carries an `ownerUid` denormalization to preserve rule-evaluation performance under class-scoped reads.
- A LyfeLabz class carries at most one active link at a time.

**lmsRosterLinks**

- One document per (LyfeLabz enrollment, LMS roster entry) pair. The mirroring link between an `enrollments/{enrollmentId}` record and its upstream LMS roster entry.
- Carries an `ownerUid` denormalization scoped to the class's teacher for security-rule performance.

**lmsAssignmentPublications**

- One document per publication attempt from a LyfeLabz assignment to an LMS. Carries the outcome and the LMS assignment identifier where the attempt succeeded.
- A LyfeLabz assignment may hold zero, one, or more publication records over its lifetime (successive attempts).

None of these records is authoritative for the upstream LMS state. All are mirroring records. The upstream LMS remains the authoritative source for classroom identity, teacher ownership, and roster per PDR-019b. The mirror is the operational read-side for LyfeLabz surfaces.

Garbage-collection contract. Unlinking a class marks the mirror records `unlinked` and preserves them. Deleting a class (an administrative operation) cascades to the mirror through a server-only path. Historical mirror records are retained for audit under PDR-013.

### 2.10 Subcollections used sparingly

The model uses subcollections in only two cases:

- submissions/{submissionId}/responses is available if per-question responses grow too large to sit on the submission document. In Version 1, per-question responses live inline on the submission. The subcollection is a documented escape hatch, not an initial structure.
- classes/{classId}/announcements is available for future teacher-to-class messaging. Not used in Version 1.

Every other relationship is modeled as a top-level collection with references. This is a deliberate choice, discussed in Section 12.

---

## 3. Document Definitions

Each subsection defines the purpose of the document, the fields it must carry, the fields it may carry, how it relates to other documents, who owns it, and how it moves through its lifecycle. Field types are intentionally omitted at this stage.

### 3.1 users

Purpose: The domain record for a person who signs in.

The user document has a two-stage field-requirement contract that reflects the platform lifecycle:

- Provisioning-required fields are written by the authentication trigger the first time a Firebase Auth user is created. They must be present on every user document at all times.
- Activation-required fields become required when the account leaves the `provisioned` state and enters `active` or `pendingVerification`. They are absent on a provisioned-but-not-yet-activated user.

The canonical lifecycle enumeration and the transitions between states live in `PLATFORM_STATE_MACHINE.md`. This section names the fields; the state machine names the transitions.

Provisioning-required fields:

- authUid: The Firebase Auth UID. The join key between the identity token and the domain record.
- status: One of `provisioned`, `pendingVerification`, `active`, `suspended`, `archived`. The canonical lifecycle field. Its enumerated values and transitions are the canonical account lifecycle for the entire platform and are defined in `PLATFORM_STATE_MACHINE.md`. There must never be a second lifecycle field on this document.
- createdAt: Timestamp of first provisioning. Required for auditing.

Activation-required fields (required when `status` is `active` or `pendingVerification`; absent when `status` is `provisioned`):

- role: One of `teacher`, `student`, `platformAdministrator`. Every security rule branches on role. Reserved future values: `parent`, `schoolAdministrator`, `districtAdministrator`.
- schoolId: Reference to the school this user belongs to. Every access decision starts from school membership.
- displayName: Shown throughout the UI. Anonymous participation is not supported.

Optional fields:

- email: Present for teachers and administrators. May be absent for students who authenticate through a school-managed identity provider or classroom mode. May also be populated at provisioning from the Firebase Auth record.
- grade: Present for students. Absent for teachers and administrators.
- teacherProfile: A nested object holding teacher-specific settings such as default block visibility. Absent for other roles.
- studentProfile: A nested object holding student-specific settings such as accommodations flags. Absent for other roles.
- consentState: Records parental consent and terms acceptance for future compliance. Optional in Version 1 but reserved.

Outcomes of individual onboarding attempts (personal-account rejections, unverified-domain requests, denials, and any future activation-failure mode) are recorded in the `auditEvents` collection, never in `status`. The lifecycle field describes where the account is in the platform. The audit stream describes what happened to the account. See `PLATFORM_STATE_MACHINE.md`.

Relationships: Belongs to one school. Referenced by classes (as teacher), by enrollments (as student), and by every ownership field elsewhere in the system.

Ownership: The user record is created by the administrative provisioning flow. It is updated by the user (profile fields) and by administrators (role, status). It is never updated by other teachers or students.

Lifecycle: Created at provisioning. Updated as profile changes. Archived rather than deleted when a person leaves the school, so submissions retain a resolvable owner.

### 3.2 schools

Purpose: The institutional tenant record.

Required fields:

- name: Display name of the school.
- shortName: A URL-safe token used in dashboards and any per-school routing.
- timezone: Required because due dates and lesson analytics need a canonical local time.
- createdAt: For auditing.

Optional fields:

- district: Reserved for future rollup.
- gradeLevels: The grade span the school actually serves. Optional because the platform can infer from enrollments.
- brandingRef: A pointer to future branding configuration.

Relationships: Referenced by users, classes, and audit events.

Ownership: Created by platform administrators. Updated by platform administrators only.

Lifecycle: Created once. Rarely updated. Never deleted.

### 3.3 classes

Purpose: A teacher's section of a course.

Required fields:

- teacherId: Reference to the teaching user. Required because every class must have exactly one owning teacher for authorization.
- schoolId: Reference to the school. Required because school administrators query classes by school.
- title: Human-readable name, such as "Grade 7 Science, Block C."
- grade: The grade level of the class.
- block: The block identifier (A through G), aligned with the classroom mode already documented in CLAUDE.md.
- joinCode: A short human-readable code used by students to enroll. Required because self-service enrollment is the Version 1 rostering path.
- status: active, archived. Required because archived classes must remain queryable for historical grade views.
- createdAt: For auditing.

Optional fields:

- coTeacherIds: Reserved for future co-teaching. Absent in Version 1.
- academicTerm: Fall, spring, full year. Optional because the school-level calendar can supply a default.
- joinCodeExpiresAt: Optional expiration timestamp. Recommended for future security posture.
- enrollmentSource: One of `joinCode` (default) or `lms`. Reserved by the ratified LMS integration architecture. Absent or `joinCode` on every pre-existing class. `lms` becomes writable when the LMS Integration Foundation phase is scheduled. A class with `enrollmentSource: "lms"` refuses join-code redemption per PDR-019i.
- lmsProviderRef: Optional reference to the `lmsProviders/{providerId}` document associated with this class when `enrollmentSource` is `lms`. Absent for join-code classes.

Relationships: Belongs to one school. Belongs to one primary teacher. Has many enrollments. Has many assignments.

Ownership: Created by the owning teacher (or by an administrator on the teacher's behalf). Updated by the owning teacher. Archived by the owning teacher or by an administrator.

Lifecycle: Created before instruction begins. Actively updated during the year. Archived at end of year. Never deleted, because assignments and submissions reference it.

### 3.4 enrollments

Purpose: One student's membership in one class.

Required fields:

- studentId: Reference to the student user.
- classId: Reference to the class.
- schoolId: Denormalized from the class for authorization. This is one of the very few permitted denormalizations, and it is justified because every security rule for enrollments must be able to test school membership without a second read.
- status: `active`, `transferred`, `withdrawn`, `archived`. `archived` is the terminal state applied when the enrolling class is archived; it preserves history without implying an ongoing relationship.
- enrolledAt: Timestamp of enrollment.

Optional fields:

- displayNameOverride: Some students prefer a different name in one class than another (nickname, preferred name). Optional.
- exitedAt: Timestamp when status became transferred or withdrawn.
- lmsRosterRef: Optional reference to the `lmsRosterLinks/{rosterLinkId}` mirror document for this enrollment when the enrolling class is LMS-linked. Reserved by the ratified LMS integration architecture. Absent on every pre-existing enrollment. Never renamed. Presence never widens the caller's authorization; it is a mirror pointer, not an ownership field.

Relationships: References one student, one class, and one school.

Ownership: Created by the student (via join code) or by a teacher (via manual add). Updated by teachers and administrators. Never updated by other students.

Lifecycle: Created at enrollment. Status transitions during the year. Retained after end of year so that grade history remains resolvable.

### 3.5 lessons

Purpose: A catalog record for a lesson version.

Required fields:

- slug: The stable lesson identifier, matching the repository file naming convention (for example, lesson_g7_earths-layers). Required because assignments reference lessons by slug plus version.
- version: A monotonic version identifier for this lesson revision.
- title: Display title.
- grade: The intended grade.
- unit: The narrative or unit the lesson belongs to.
- publishedAt: Timestamp of this version's publication.
- htmlPath: Repository-relative path to the delivering HTML file. This is not a URL; the platform composes the URL from environment configuration.

Optional fields:

- standards: A list of standards addressed. Optional because not every instructional page is standards-badged (per CLAUDE.md's supporting concept principle).
- description: A short summary used in teacher assignment flows.
- vocabulary: A list of vocabulary term references. Optional. Used for teacher previews only.
- retiredAt: Timestamp if the version has been superseded.

Relationships: Referenced by assignments and submissions. Never references classes, teachers, or students.

Ownership: Created by the curriculum publication process. Updated only to mark retirement. Never edited in place after publication (see Section 1.3).

Lifecycle: Published once. Retired when a new version is published. Retained indefinitely so old submissions remain resolvable.

### 3.6 assignments

Purpose: A teacher's assignment of a lesson to a class.

Required fields:

- classId: Reference to the class receiving the assignment.
- teacherId: Reference to the assigning teacher. Denormalized from the class for authorization efficiency.
- schoolId: Denormalized from the class for administrative queries.
- lessonSlug: The lesson slug being assigned.
- lessonVersion: The specific version being surfaced. Freezing the version at record creation protects students from mid-window content changes.
- mode: `practice` or `classroom`. Aligns with the Practice Mode and Classroom Mode terminology already documented in CLAUDE.md. There is no `graded` mode.
- status: `draft`, `published`, `closed`, `archived`. `archived` is the terminal state that removes the record from active teacher views while preserving history so past submissions remain resolvable.
- createdAt: For auditing.

Optional fields:

- title: A teacher-provided title. Optional because the lesson title is the default.
- instructions: A short teacher note shown above the lesson.
- windowClosesAt: Optional. When present, defines the moment after which the record leaves active student views. This is not a due date; the platform does not render "due," "late," or "overdue" language to students or teachers, and finalization is not blocked by the window closing. See PDR-010.
- availableAt: Optional. If present, the record is hidden from students until this time.
- lmsPublicationRef: Optional reference to the most recent `lmsAssignmentPublications/{publicationId}` mirror document for this assignment. Reserved by the ratified LMS integration architecture. Absent on every pre-existing assignment. Presence records that publication has been attempted; success or failure is recorded on the referenced publication document. Publication is a side effect per PDR-019d; the assignment record remains authoritative.

Relationships: References one class, one teacher, one school, and one lesson version. Has many submissions.

Ownership: Created by the owning teacher. Updated by the owning teacher until closed. Never updated by students or by other teachers.

Lifecycle: Draft, published to students, closed at end of window, archived when the class is archived. Records are retained indefinitely so submissions resolve.

### 3.7 submissions

Purpose: A student's work on an assignment.

Required fields:

- assignmentId: Reference to the assignment.
- studentId: Reference to the student user.
- classId: Denormalized from the assignment for classroom-scoped queries.
- teacherId: Denormalized from the assignment for teacher dashboards.
- schoolId: Denormalized from the assignment for administrative queries.
- lessonSlug: Denormalized for analytics and grade views.
- lessonVersion: The frozen lesson version the student experienced. Denormalized deliberately, because the assignment record could theoretically be recreated but the version the student saw must be preserved.
- status: `submitted`, `finalized`. There is no client-authored `in-progress` state on the authoritative submission collection: the document is created by the server-side finalization Cloud Function (PDR-008). `submitted` is the transient state inside the finalization transaction; every readable submission is `finalized`. In-progress client draft state, if any, is held in a working area outside this collection and is not authoritative.
- startedAt: Timestamp of first attempt. Set by the finalization Cloud Function from the client-reported start moment, retained for pedagogical analytics; not used for authorization.
- submittedAt: Timestamp of final submission.
- score: Numeric score if applicable.
- responses: Per-question responses inline in Version 1. Escape hatch to subcollection if size becomes a concern.

Optional fields:

- durationMs: Total time on task.
- attemptCount: Number of times the student re-entered the assignment.
- teacherNoteRef: Reference to a teacher comment. Reserved for a future feature.
- flaggedForReview: Boolean set by the teacher.

Relationships: References one assignment, one student, one class, one teacher, one school, and one frozen lesson version. Denormalization on this document is heavier than anywhere else in the model, and it is justified in Section 12.

Ownership: Created by the server-side finalization Cloud Function on behalf of the student (PDR-008). Students never write directly to this collection. After creation, the document is immutable to students. Teachers may append notes and flag for review through an adjacent record, not by mutating the submission. Platform Administrators may not edit content; retention actions are audited.

Lifecycle: `submitted` → `finalized` within the finalization transaction. Retention is a policy applied to the finalized document; it is not a status. Never edited after finalization.

### 3.8 auditEvents

Purpose: The single append-only event log for the platform. This Firestore collection **is** the authoritative audit sink referenced in PDR-013. It is made append-only by Security Rules that permit `create` from trusted server context only and forbid `update` and `delete` for every role, including Platform Administrator. Retention export to cold storage is a mirror for retention, not a second authoritative sink.

Audit events have a two-stage field-requirement contract that reflects the actor context of the event:

- User-actor events are written in response to an authenticated caller's action. Every user-actor event carries a resolvable `schoolId`.
- System-actor events are written by triggers, scheduled jobs, or other trusted-server contexts where no user actor initiated the action. A system-actor event may pre-date the target's school association, in which case `schoolId` is absent from the record.

Required fields (all events):

- actorUserId: Who performed the action. For system-actor events, this is the subject of the event (for example, the newly provisioned user's uid).
- actorRole: Role at the time of the action, because a user's role may change later. Permitted values are the canonical `Role` enumeration (`teacher`, `student`, `platformAdministrator`) or the sentinel `system` for trusted-server contexts where no user actor initiated the action.
- action: A short verb such as class.created, assignment.published, submission.finalized.
- targetType: The kind of object acted upon.
- targetId: The document ID of the object acted upon.
- occurredAt: Timestamp.

Conditionally required field:

- schoolId: For administrative scoping. Required for every user-actor event. Required for every system-actor event that has a resolvable school association at write time. Absent only when no school association exists at write time, as with `auth.userProvisioned`, which fires before the user has selected or been assigned to a school. An empty-string `schoolId` is never permitted.

Optional fields:

- payload: A small structured object describing the specifics of the action.
- correlationId: For linking a chain of events triggered by a single user action.

Relationships: References users and targets by ID. Never referenced by application documents.

Ownership: Written by the platform. Never edited. Never deleted.

Lifecycle: Append only. Retention is a policy decision, not a model decision.

---

## 4. Relationships

This section describes the reference graph. In every case, documents reference other documents by ID rather than embedding them, unless a specific denormalization is called out.

### 4.1 Teacher to Classes

A teacher owns many classes. The relationship is expressed by classes.teacherId. Querying "all classes for teacher T" is a single indexed query. A subcollection under teachers was rejected because it would prevent school-level administrative queries.

### 4.2 School to Classes and Users

A school contains many classes and many users. Both classes and users carry schoolId. The school document itself does not carry a roster of its children. This preserves school-scoped queries at any scale without hot-document contention.

### 4.3 Class to Enrollments

A class has many enrollments. Enrollments carry classId. Storing an array of student IDs on the class would cap class size at the Firestore document size limit and create write contention every time a student joined or left. Enrollments as a separate collection avoid both problems.

### 4.4 Student to Enrollments

A student has many enrollments (one per class). Enrollments carry studentId. Querying "all classes for student S" is a single indexed query on enrollments, followed by class document reads for the ones needed.

### 4.5 Assignment to Lesson

An assignment references a lesson by lessonSlug plus lessonVersion. The tuple is the key. Duplicating title or content on the assignment is rejected because the lesson version is the source of truth and can always be dereferenced.

### 4.6 Assignment to Class

An assignment carries classId and, denormalized for authorization, teacherId and schoolId. These denormalizations are called out in Section 12 with their tradeoffs.

### 4.7 Submission to Assignment

A submission carries assignmentId. It also carries the denormalized classId, teacherId, schoolId, lessonSlug, and lessonVersion, so that every downstream query (teacher dashboard, student portfolio, administrative report) can be served by a single indexed query.

### 4.8 Submission to Student

A submission carries studentId. Querying "all submissions for student S" is a single indexed query.

### 4.9 Why References Over Duplication

Duplication is tempting because it eliminates joins. But every duplicated field is a future consistency bug: rename a class, update a student's display name, correct a lesson title, and every duplicated copy becomes stale.

The model duplicates only fields that are (a) immutable after the referring document is created, or (b) required for authorization and thus performance-critical. Every such duplication is explicitly enumerated on the submission and assignment documents and is justified in Section 12. All other relationships are pure references.

---

## 5. Document Identity

This section defines the identifier philosophy.

### 5.1 Stable Document IDs

Every top-level collection uses opaque, system-generated document IDs. These IDs never change, never get reused, and never carry semantic meaning. This is the standard Firestore practice, and it protects the model against every kind of naming churn.

Semantic identifiers (slugs, join codes, email addresses) are separate fields.

### 5.2 Human-Readable Identifiers

Human-readable identifiers exist alongside document IDs, never replacing them.

- User: authUid is stable but is a Firebase Auth artifact. Email is human-readable but mutable. Neither is used as the document ID.
- School: shortName is human-readable and stable within a school's lifetime, but stored as a field.
- Class: title is human-readable and mutable. joinCode is human-readable and short-lived.

### 5.3 Join Codes

Join codes are short, human-readable, case-insensitive strings used only for student self-enrollment. They are stored as a field on the class document. They are unique within the school. Recommendation: join codes should expire after a configurable window (default: end of the current academic term), and should be regenerable by the owning teacher without changing the class document ID. Expiring join codes reduces the security exposure from codes leaking beyond the classroom.

### 5.4 Lesson Identifiers

Lesson identifiers are a compound key: (slug, version). The slug corresponds to the repository file naming convention (lesson_g7_earths-layers). The version is a monotonic version marker.

The lesson document ID itself is opaque, so a lesson can be renamed in the repository without breaking Firestore references. This is a deliberate hedge against the file-naming rules in CLAUDE.md.

### 5.5 Assignment Identifiers

Opaque document IDs. Human-readable titles are stored as a field. No teacher-facing identifier is required.

### 5.6 Submission Identifiers

Opaque document IDs. However, a submission is uniquely identified in the business sense by (assignmentId, studentId, attemptNumber). Uniqueness of the current attempt should be enforced at write time, not baked into the document ID.

### 5.7 Identifiers That Must Never Change

The following never change over the lifetime of the document:

- Any Firestore document ID.
- authUid on the user record.
- schoolId on any document.
- studentId on an enrollment or submission.
- assignmentId on a submission.
- lessonSlug and lessonVersion on a submission.

Every other field is theoretically mutable, subject to authorization rules.

---

## 6. Read and Write Patterns

For each major entity, this section describes the traffic pattern the model must serve.

### 6.1 Users

Reads: Every authenticated request begins with a user document read to resolve role and school. This should be a single direct read by document ID, cached in application memory for the session.

Writes: Creation at provisioning. Profile updates infrequently.

Updates: Rare. Role transitions are administrative events.

Queries: "All users in school S" for administrative dashboards. Indexed on schoolId plus role.

The model supports this by keeping the user document small and by keeping schoolId and role on the document itself.

### 6.2 Classes

Reads: A teacher opens their dashboard several times per class period. A single indexed query on teacherId returns all their classes.

Writes: Class creation at term start. Occasional updates to metadata.

Updates: Rare during the term.

Queries: By teacher, by school, by join code (for enrollment lookup).

The model supports all three access paths without any restructuring, because teacherId, schoolId, and joinCode are all indexable fields on the class document.

### 6.3 Enrollments

Reads: "All students in class C" for the teacher dashboard. "All classes for student S" for the student home page.

Writes: One write per enrollment. Concentrated at the start of a term.

Updates: Status changes when students transfer or withdraw.

Queries: By classId (roster), by studentId (student's schedule), by (studentId, classId) for authorization checks.

Because enrollments is a separate collection, none of these queries touches a hot document. The enrollment collection scales with total students-times-classes, which is bounded and predictable.

### 6.4 Lessons

Reads: Every assignment creation and every submission touches a lesson document to resolve version metadata.

Writes: Only at publication. Publication is a curriculum event, not a classroom event.

Updates: Never. Content is versioned by publishing a new document.

Queries: By slug plus version (lookup), by grade (browsing), by unit (browsing).

Read volume is high but easily served by lookup by (slug, version) using an indexed query. Application-layer caching should be aggressive here, because lesson documents are effectively immutable.

### 6.5 Assignments

Reads: Teacher dashboard shows "all assignments for class C." Student home shows "all assignments for classes I am enrolled in." Administrative view shows "all assignments in school S."

Writes: One write per assignment.

Updates: Draft to published, published to closed.

Queries: By classId (for students and teachers), by teacherId, by schoolId, by lessonSlug (for curriculum analytics).

Each access path is served by a single indexed query on a field carried on the assignment. No fanout is required.

### 6.6 Submissions

Reads: The most read-heavy collection. Teacher dashboards read "all submissions for assignment A." Student portfolios read "all submissions for student S." Administrative reports read "all submissions in school S over time range T."

Writes: The most write-heavy collection. Each student produces at least one submission per assignment.

Updates: A submission is edited by its student until finalized, then never again. Teacher-added notes are additive, not edits.

Queries: By assignmentId, by studentId, by classId, by teacherId, by schoolId, by (studentId, assignmentId) for uniqueness checks.

The heavy denormalization on submissions is what makes all of these queries single-index. Section 12 addresses whether this denormalization is worth its cost.

### 6.7 Audit Events

Reads: Administrative queries by actor, by target, by time range. Never in a hot path.

Writes: Append only. Rate is a function of platform activity.

Updates: Never.

Queries: Indexed on actorUserId, targetId, and occurredAt. Time-range queries are typical.

---

## 7. Ownership Mapping

For each collection, this section describes who creates, updates, finalizes, archives, and reads.

### 7.1 users

- Created by Platform Administrators (or platform provisioning).
- Profile fields updated by the user.
- Role and status updated by Platform Administrators only.
- Never updated by other users of the same role.
- Read by the user themselves and by Platform Administrators.

### 7.2 schools

- Created by platform administrators.
- Updated by platform administrators.
- Never touched by teachers or students.
- Read by administrators. Referenced (not read) by everyone else.

### 7.3 classes

- Created by teachers or by administrators on behalf of teachers.
- Updated by the owning teacher.
- Archived by the owning teacher or by an administrator.
- Never touched by students, and never touched by other teachers.
- Read by the owning teacher, enrolled students, and administrators.

### 7.4 enrollments

- Created by students (via join code) or by teachers (via manual add).
- Updated (status changes) by teachers or administrators.
- Never edited by other students.
- Read by the enrolled student, the owning teacher, and administrators.

### 7.5 lessons

- Created by the curriculum publication process.
- Updated only to mark retirement.
- Never edited by teachers or students.
- Read by everyone.

### 7.6 assignments

- Created by the owning teacher.
- Updated by the owning teacher while in draft or published.
- Closed by the owning teacher or by scheduled automation.
- Never edited by students.
- Read by the owning teacher, enrolled students, and administrators.

### 7.7 submissions

- Created by the student.
- Updated by the student until finalized.
- After finalization, immutable to the student and to the teacher.
- Teacher notes are separate additions, not edits.
- Read by the submitting student, the owning teacher, and administrators.

### 7.8 audit events

- Created by the platform.
- Never updated.
- Never deleted.
- Read only by administrators.

---

## 8. Security Considerations

This section describes how the structure supports authorization. It does not define rules.

### 8.1 Least Privilege

Every document carries the fields needed to authorize access to itself. A submission carries studentId, teacherId, and schoolId. A class carries teacherId and schoolId. Because ownership is on the document, no rule needs to traverse another document to make an authorization decision. This lowers rule complexity and rule evaluation cost.

### 8.2 Classroom Isolation

Enrollments provide the join between students and classes. A student sees a class's assignments only if an enrollment exists linking them. Because enrollments live in their own collection with indexed studentId and classId, membership checks are cheap and unambiguous.

### 8.3 Teacher Isolation

Teachers are scoped to their own classes. Since every class carries teacherId and every downstream document (assignment, submission) carries the teacher's ID denormalized from the class, teachers cannot read another teacher's data through any query supported by the model.

### 8.4 Student Privacy

Student PII is concentrated on the user record. Submissions carry studentId as an opaque reference, not student names or emails. Reports that need student names must join through the user document. This structure makes it straightforward to redact or pseudonymize student data for analytics without editing every submission.

### 8.5 Immutable Submissions

Once submitted, a submission's core fields cannot be edited by anyone. The teacher-note pattern (a separate additive field, not an in-place edit) preserves the integrity of the original student work. This aligns with the classroom mode already documented in CLAUDE.md.

### 8.6 Administrative Access

Administrators are scoped by schoolId. Because every document in the model carries schoolId either directly or denormalized, administrative queries are single-index and cannot accidentally cross school boundaries.

### 8.7 Structure Simplifies Rules

Because every document contains its own ownership fields, security rules can be written in terms of "does this document's schoolId match the caller's schoolId?" without a get() call. Firestore's rule engine penalizes cross-document lookups; the model avoids them by design.

---

## 9. Scalability Review

Target scale: hundreds of schools, thousands of teachers, tens of thousands of students, millions of submissions.

### 9.1 Users

Tens of thousands of user documents in a single collection are well within Firestore's comfort zone. Queries scoped by schoolId plus role remain efficient with a composite index.

### 9.2 Schools

Hundreds of schools is trivial. No concern.

### 9.3 Classes

Tens of thousands of classes is trivial. Queries by teacherId, schoolId, and joinCode are all indexable.

### 9.4 Enrollments

Enrollment count grows as students-times-classes-per-student. For tens of thousands of students at six classes each, that is a few hundred thousand documents. Comfortable.

### 9.5 Lessons

Bounded by curriculum size. Even with a decade of versions, this collection is small.

### 9.6 Assignments

Grows as teachers-times-assignments-per-teacher-per-year. For thousands of teachers producing on the order of 100 assignments per year, that is hundreds of thousands per year. Comfortable, indexed by classId, teacherId, and schoolId.

### 9.7 Submissions

The largest collection. Tens of thousands of students producing hundreds of submissions per year yields millions per year. Firestore handles this scale, but two operational concerns must be acknowledged:

- Queries that span many years of submissions (multi-year student portfolios) need composite indexes that include a time field. This must be planned in advance so that indexes exist before the queries run.
- Aggregations (class averages, teacher dashboards) should never be computed by scanning submissions in real time at scale. Aggregations should be produced by asynchronous rollup jobs into dedicated summary documents.

### 9.8 Audit Events

Growth is proportional to platform activity. Retention should be capped by policy, and events beyond the retention window should be exported and pruned.

### 9.9 Anticipated Bottlenecks

- Hot documents. No collection in the model concentrates writes on a single document. Class rosters are avoided by using the enrollments collection.
- Fanout writes. Publishing an assignment does not require fanning out a copy to each student. Students see the assignment through queries against the assignments collection.
- Large documents. Submissions carry per-question responses inline. If a lesson evolves to have many long-form responses, submissions may approach Firestore's document size limit. The escape hatch (responses subcollection) is defined and can be adopted per lesson without a schema migration.
- Aggregations. Any teacher dashboard that shows "average score across the class" must not compute that from submissions on read. A rollup pattern must be adopted before this becomes a load concern.

---

## 10. Future Compatibility

This section confirms that the proposed structure can absorb likely future features without a structural rewrite.

### 10.1 Districts

Adding districts requires a new districts collection and a districtId field on schools. Every document already scopes through schoolId, so district-level queries roll up through schools without touching downstream documents.

### 10.2 Parent Accounts

A parent is a user with role=parent and a new relations field or a new relationships collection that ties parents to students. Read-only access to student submissions is trivially expressible in the model. No downstream changes required.

### 10.3 AI Tutoring

An AI tutor produces tutoring events that reference lessons, students, and (optionally) submissions. A new tutoringSessions collection fits alongside submissions with the same reference shape. Nothing existing changes.

### 10.4 AI Feedback

AI-generated feedback on a submission is stored as a separate feedback document (or subcollection under submissions), preserving the immutability of the original student work. The submission document is untouched.

### 10.5 Google Classroom Integration

The canonical architecture for LMS integration is `LMS_INTEGRATION_ARCHITECTURE.md`, ratified into the certified corpus by `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` and recorded as PDR-019. Google Classroom is the initial provider.

The integration lands as the five additive mirror collections named in §2.9.a (`lmsProviders`, `lmsConnections`, `lmsClassLinks`, `lmsRosterLinks`, `lmsAssignmentPublications`) and as the additive optional fields on `classes` (`enrollmentSource`, `lmsProviderRef`), `enrollments` (`lmsRosterRef`), and `assignments` (`lmsPublicationRef`). The reserved `rosters` collection (§2.8) is not repurposed by the LMS integration; it remains reserved for SIS-fed rosters. Existing classes, enrollments, assignments, and submissions never change shape and never require a destructive migration. Historical join-code classes continue to operate under their default `joinCode` enrollment source.

The mirror is never authoritative for the upstream LMS state (PDR-019b). External identifiers (LMS class IDs, LMS roster entry IDs, LMS assignment IDs) live on the mirror records, not on the certified `classes`, `enrollments`, `assignments`, or `submissions` documents.

### 10.6 Canvas Integration

Same shape as Google Classroom. A second LMS provider is added by extending the `lmsProviders` closed set and by writing a second adapter under PDR-019h. External identifiers are attached at the mirror boundary, not to any certified downstream document. No structural rewrite is required.

### 10.7 Teacher-Created Lessons

Teacher-created lessons fit into the lessons collection with a source field indicating creator. The publication process differs, but the shape of the document does not. Assignments continue to reference (slug, version) and know nothing about origin.

### 10.8 Shared Instructional Resources

A resources collection can be added for supplemental artifacts (videos, readings) referenced from assignments. This does not disturb any existing shape.

---

## 11. Migration Strategy

This section describes how the model evolves over time.

### 11.1 Backward Compatibility

Every field addition is additive. Consumers must tolerate unknown fields on read and must never fail because a field is absent. This convention must be enforced by application-layer code, not by Firestore.

### 11.2 Optional Fields

Optional fields are the primary mechanism for evolving documents. A field is added first as optional. It becomes required only when all existing documents have been backfilled and all writers have been updated. The transition from optional to required is a coordinated release.

### 11.3 Versioning

Documents do not carry a schema version field in Version 1. This is a deliberate choice: adding one now would create ceremony without benefit, and adding one later is trivial. When a breaking change becomes necessary, a schemaVersion field is introduced and defaults to 1 for pre-existing documents.

### 11.4 Deprecation

Deprecated fields are marked in this document and in application-layer code. Reads must continue to tolerate them until a documented removal window has elapsed. Writes stop populating them at deprecation. Removal is a separate migration step.

### 11.5 Data Migrations

Migrations are run as backfill jobs against the collection, never as ad-hoc scripts. Each migration is:

- Idempotent, so partial completion is safe.
- Auditable, producing an audit event per document touched.
- Reversible when reasonable, or explicitly documented as one-way.

Migrations that change ownership or authorization fields must be reviewed for security impact before running.

### 11.6 Renames

Field renames are performed as add-copy-remove: add the new field, backfill from the old field, update writers to populate both, update readers to prefer the new field, then remove the old field on a scheduled cadence. This preserves compatibility throughout.

---

## 12. Firestore Design Decisions

This section summarizes the load-bearing design choices, with alternatives considered, tradeoffs, and long-term implications.

### 12.1 Enrollments as a Top-Level Collection

Chosen: A separate enrollments collection.

Alternatives considered: Array of student IDs on the class document. Subcollection under classes. Subcollection under users.

Why: An array caps class size at Firestore's document size limit and causes write contention. A subcollection under classes prevents the student-centric "all my classes" query without a collection-group index that would still need denormalized fields. A subcollection under users has the reverse problem. A top-level collection with indexed studentId and classId serves both access paths.

Risks: Two writes are needed to enroll (the enrollment and any denormalized counters). Manageable.

Long-term implications: Absorbs districts, roster imports, and parent visibility without restructuring.

### 12.2 Submissions as a Top-Level Collection

Chosen: A separate submissions collection.

Alternatives considered: Subcollection under assignments. Subcollection under users.

Why: Both subcollection choices force a compromise. Under assignments, the student portfolio query becomes expensive. Under users, the teacher dashboard query becomes expensive. Top level with heavy denormalization serves both.

Risks: The largest single collection in the system. Requires disciplined indexing and retention planning.

Long-term implications: Submissions cleanly absorb feedback documents, AI tutoring links, and portfolio views.

### 12.3 Denormalization on Submissions

Chosen: Submissions carry classId, teacherId, schoolId, lessonSlug, and lessonVersion in addition to assignmentId and studentId.

Alternatives considered: Store only assignmentId and studentId, resolve the rest through joins.

Why: The join alternative requires multiple document reads on every dashboard render, and it complicates security rules. Denormalization here is safe because every denormalized field is immutable on the referring document. classId cannot change on an assignment. teacherId cannot change on a class after creation. The lesson version is frozen by definition.

Risks: If any of these fields ever needs to change (for example, an assignment is transferred to another class), the denormalization becomes stale. This is why Section 1.2 declares ownership immutable: rather than transferring, the model requires archive-and-create.

Long-term implications: All downstream reporting becomes cheap.

### 12.4 Freezing Lesson Version on Assignment

Chosen: The assignment records the exact lesson version. The submission also records it, denormalized.

Alternatives considered: Reference the lesson by slug only and always resolve to the current version.

Why: Instructional content changes. A student who took a quiz in October must see, in April, the same lesson they experienced. Otherwise, submissions become inexplicable when the lesson revises.

Risks: Retired lesson versions must be retained indefinitely. This is a storage cost, not a correctness cost.

Long-term implications: Enables year-over-year comparison, curriculum change auditing, and honest analytics.

### 12.5 Immutable Submissions After Finalization

Chosen: Once finalized, a submission is not edited. Teacher notes are additive.

Alternatives considered: Allow edits with a revision history.

Why: Revision history adds complexity to every read and every rule, in exchange for a use case (teacher correction of student answers) that the platform explicitly does not want to support. Additive notes achieve the pedagogical goal without violating integrity.

Risks: None material.

Long-term implications: Simplifies auditing and honest reporting to families.

### 12.6 Schools as First-Class Even in Version 1

Chosen: A schools collection exists in Version 1, and every document carries schoolId.

Alternatives considered: Defer schools until the second customer.

Why: Retrofitting schoolId across every collection later is enormously expensive, and requires migrating every existing document. Introducing schools now, with a single seeded school, is nearly free.

Risks: A small amount of ceremony in Version 1. Trivial.

Long-term implications: Multi-tenant readiness from day one.

### 12.7 Users Split from Firebase Auth

Chosen: A users collection in Firestore is separate from Firebase Auth.

Alternatives considered: Rely on Firebase Auth custom claims for role and school.

Why: Custom claims are limited in size, propagate slowly on change, and are difficult to migrate. A Firestore user document gives the platform a first-class domain record with full flexibility. Auth remains the identity source.

Risks: A one-round-trip read at session start. Cached in application memory. Trivial.

Long-term implications: Roles, consents, and profile evolution are easy.

### 12.8 Audit Events as a Separate Collection

Chosen: A single top-level auditEvents collection.

Alternatives considered: Per-document subcollections of events.

Why: Cross-cutting queries (all actions by user U, all actions on target T) are the point of an audit log. Nesting defeats them.

Risks: Growth. Managed through retention policy and export.

Long-term implications: Ready for future compliance conversations without redesign.

### 12.9 Flat Hierarchy Overall

Chosen: Nearly every collection is top level.

Alternatives considered: A deeply nested schools/{schoolId}/classes/{classId}/enrollments/{enrollmentId} shape.

Why: Deep nesting looks tidy on a whiteboard, but Firestore charges the same for a nested read as a top-level read, and nested paths make cross-cutting queries harder. Every path carries schoolId anyway, so nesting adds no security benefit.

Risks: URLs and admin tools show flat collections, which can feel unstructured. Cosmetic.

Long-term implications: Every future feature composes cleanly.

### 12.10 Join Codes as Fields, Not IDs

Chosen: joinCode is a field on the class document, not the document ID.

Alternatives considered: Use the join code as the document ID for O(1) lookup.

Why: Join codes should expire and rotate. Using them as document IDs would mean the class document ID rotates too, breaking every reference. Storing joinCode as an indexed field preserves rotation without disrupting identity.

Risks: Join-code lookups are indexed queries rather than direct reads. Negligible cost.

Long-term implications: Enables safer join-code hygiene.

---

## 13. Readiness Assessment

Would I approve this design for implementation if I were personally responsible for maintaining this Firestore database for the next five years?

Yes, with three conditions.

### 13.1 Condition One: Rollup Strategy Must Be Named Before Launch

The submissions collection is the highest-volume surface in the platform. Dashboards that aggregate over it must not compute on read. Before implementation, a separate short document must define how class-level, teacher-level, and school-level aggregates are produced, stored, and refreshed. That document is not required to be finished before implementation begins, but it must be named as a required Version 1 deliverable so the approach is not chosen ad hoc under pressure.

### 13.2 Condition Two: Index Plan Must Precede Query Code

Every query described in Section 6 corresponds to a composite index. Those indexes must be enumerated in a separate index-plan document before the first dashboard is coded, because deploying missing indexes under production load is a well-known source of preventable outages.

### 13.3 Condition Three: Denormalization Discipline Must Be Enforced

The denormalized fields on submissions and assignments are safe only because ownership is immutable. If a future feature tries to allow reassigning an assignment to a different class, that feature must not simply mutate classId; it must archive the assignment and create a new one. This rule must be encoded in a lightweight design-review checklist and referenced from CLAUDE.md when the platform work begins, or the denormalization guarantees will erode within eighteen months.

Subject to those three conditions, the model in this document is approved as the canonical Firestore data model for LyfeLabz Version 1 and is expected to remain the canonical model through the five year horizon, absorbing districts, parent accounts, AI tutoring, AI feedback, external LMS integrations, teacher-created lessons, and shared resources without structural rewrite.

---

End of document.
