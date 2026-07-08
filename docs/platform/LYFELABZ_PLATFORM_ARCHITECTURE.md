# LyfeLabz Platform Architecture

**Status:** Master architecture reference
**Phase:** Pre-implementation (Architecture only)
**Audience:** Platform architects, contributors, future maintainers
**Scope:** Version 1 through the five-year platform roadmap

This document is the canonical reference for every LyfeLabz platform decision. It defines what the platform is, how its systems relate, and which decisions should be considered locked before implementation begins. It is deliberately conceptual. It does not contain Firestore schemas, security rules, Cloud Functions, or configuration files. Those artifacts follow this document, they do not shape it.

The instructional repository is complete. The platform layer wraps around it. Nothing in this document is permitted to weaken the instructional philosophy that produced the existing repository.

---

## 1. Vision

LyfeLabz is a standards-driven, student-centered science learning environment for middle school. The instructional repository is a library of self-contained, accessible, mobile-first lessons that students can explore freely and teachers can rely on as high-quality instructional material.

The platform layer extends this repository with the coordination fabric that classrooms need: authenticated identities, classroom membership, assignment awareness, assessment submissions, and teacher visibility. It does not replace the repository, wrap it in a shell, or reinterpret it as a learning management system.

The platform is bound by the following non-negotiable commitments:

- **Lessons remain the home base.** Every student experience begins and ends inside a lesson. The platform is scaffolding around lessons, not a container that hides them.
- **Teachers manage classrooms, not students.** Teachers curate access, monitor submissions, and support learners. Nothing in the platform reduces students to rows in a gradebook.
- **Students explore rather than complete.** Progress is not a checklist. The platform surfaces exploration and revisitation, not completion percentages that create false finality.
- **Curriculum remains standards-driven.** The Massachusetts 2016 STE Framework and the existing source decks continue to define scope. The platform never becomes a mechanism for injecting new curriculum outside the standards-driven process.
- **Accessibility remains mandatory.** Every platform surface is subject to the same accessibility standard as the instructional repository. There are no "internal tool" exceptions.
- **Mobile remains a first-class experience.** Teacher and student surfaces must work on phones, tablets, and Chromebooks. The canonical responsive breakpoints defined in CLAUDE.md govern the platform as well as the lessons.

The platform's success is measured by whether it disappears behind the learning experience. If a student notices the platform, the platform has done too much.

---

## 2. Guiding Principles

These principles are permanent. They govern every future platform decision. When two options exist and one is more consistent with these principles, that option wins.

**Architecture before implementation.** No code is written before the architectural intent is documented. Documents like this one lead. Implementation follows.

**Simplicity over cleverness.** The platform will be maintained by a small team for a long time. The simplest design that meets the requirement is always preferred. Cleverness is a maintenance tax paid by every future contributor.

**Security by default.** New surfaces are locked until explicitly opened. New data is private until explicitly shared. New permissions are denied until explicitly granted. Defaults are the last line of defense when everything else fails.

**Least privilege.** Every role, every service account, every deployment credential, and every client-side API surface receives the smallest set of privileges that lets it do its job. Overprivileged access is a defect.

**Reusable components.** Platform UI reuses the canonical LyfeLabz components (cards, chevrons, ls-focus, mobile-canonical stylesheet). Data models reuse shared concepts (user, class, enrollment, submission). Divergence is justified in writing or it does not ship.

**Accessibility-first.** WCAG 2.1 AA is the floor. Keyboard operability, screen reader semantics, contrast, focus visibility, and reduced motion are treated as correctness, not polish.

**Mobile-first.** Layouts start at the smallest supported viewport and expand. If a teacher cannot use a dashboard on a phone during a class transition, the design has failed.

**Progressive enhancement.** Core functionality works without JavaScript-heavy dependencies wherever practical. Lessons must remain viewable without authentication. Authenticated features enhance the experience but never gate the instructional content itself.

**Backward compatibility whenever practical.** Public URLs (lesson filenames), stable identifiers (user IDs, class IDs, submission IDs), and stored data shapes evolve through additive changes, not renames. Breaking changes require a migration plan, not a hope.

**Scalable by design.** Every schema, query, and access rule is examined for behavior at a scale ten times current usage. The correct time to notice a fan-out problem is before it exists in production.

**Favor maintainability over short-term convenience.** A slightly slower path that a future maintainer will understand at a glance is preferred to a shortcut that only makes sense today.

**One canonical way to do each thing.** Auth, data access, error handling, deployment, and telemetry each have exactly one blessed pattern. Variations require documented justification.

**Observability is not optional.** Every meaningful platform action is auditable. Silent failure is prohibited.

---

## 3. High-Level Platform Architecture

The platform is composed of a small number of well-defined systems. Each has a single purpose. Interactions between them are explicit.

**Static Lesson Repository.** The existing HTML/CSS/JS lesson files served directly from Firebase Hosting. This is the instructional core and remains authoritative for lesson content. It has no runtime dependency on authentication, Firestore, or Cloud Functions. Lessons continue to load and function for anonymous visitors.

**Firebase Hosting.** The single production edge for the LyfeLabz custom domain. It serves the static repository, the dashboard shells, and the client bundles for authenticated features. It provides the versioning, atomic deploys, and rollback capability the platform requires.

**Authentication.** Google Sign-In through Firebase Authentication. The identity layer for all authenticated experiences. It produces a durable user record and a session that other systems trust.

**Firestore.** The system of record for all platform data that is not part of the static repository: users, classes, enrollments, submissions, teacher preferences, and settings. Firestore is accessed directly by authenticated clients within the bounds of the security model, and by Cloud Functions when server-side authority is required.

**Cloud Functions (future).** Server-side authority for actions that clients cannot be trusted to perform: minting join codes, finalizing submissions, generating administrative reports, and integrating with external systems. Introduced only when a client-side implementation cannot meet the security or correctness bar.

**Teacher Dashboard.** A client application that lets teachers create and manage classes, curate lesson availability, and review submissions. It reads and writes through the authenticated Firestore surface.

**Student Dashboard.** A minimal client surface that lets students join a class, see the lessons their teacher has surfaced, and revisit their own submissions. It is deliberately smaller than the teacher dashboard because students belong inside lessons, not on a dashboard.

**Assessment Pipeline.** The end-to-end flow from a student completing an in-lesson assessment to a durable, ownership-stamped submission record visible to the appropriate teacher. It spans the lesson runtime, the client submission layer, Firestore, and eventually Cloud Functions for finalization.

**Classroom Management.** The set of capabilities for creating classes, generating join codes, enrolling students, archiving classes, and rolling over school years. Owned by the teacher dashboard, backed by Firestore, guarded by the security model.

**Administrative Tools.** LyfeLabz-internal tools for supporting teachers, resolving account issues, and monitoring platform health. These are separate from the school administrator dashboard and are never exposed to end users.

**Analytics (future).** Aggregate, privacy-respecting insight into how lessons and classes are used. Not a per-student surveillance system. Never a substitute for teacher judgment.

**AI Services (future).** Optional capabilities such as tutoring hints, teacher-facing lesson recommendations, and content assistance. Isolated behind clear interfaces so that AI availability is never load-bearing for the instructional experience.

**Interactions, at a glance.** Anonymous visitors and students interact with the static repository directly. Authenticated students and teachers interact with the dashboards, which read and write Firestore through the security model. Cloud Functions handle any action that requires server-side authority. Analytics and AI services consume data only through documented, permissioned interfaces. The static repository never depends on any of the above.

---

## 4. User Roles

Roles are a small, closed set. New roles require a documented decision. Role assignment is data, not code.

**Anonymous Visitor.**
Purpose: browse the instructional repository as a member of the public.
Permissions: read all published lesson content. No access to any authenticated surface.
Responsibilities: none.
Future expansion: potentially receive read-only public showcase pages produced by teachers, subject to explicit opt-in.

**Student.**
Purpose: explore lessons, join a class, submit assessments.
Permissions: read all published lesson content. Join classes via join codes. Read and write only their own submissions, preferences, and enrollments. Read only the lesson availability their teacher has surfaced in classes they belong to.
Responsibilities: maintain their own identity through Google Sign-In.
Future expansion: manage multiple simultaneous class enrollments, opt into optional features (e.g., AI tutoring), request accessibility preferences that persist across lessons.

**Teacher.**
Purpose: manage classes and support learners.
Permissions: create and manage their own classes. Generate join codes. Enroll and remove students in their classes. Read all submissions from students in their classes. Read and write their own teacher preferences.
Responsibilities: curate lesson availability for their classes, monitor submissions, respond to student needs.
Future expansion: co-teaching, sharing lesson curation across classes, participating in professional learning communities.

**School Administrator (future).**
Purpose: coordinate teachers within a school, provision accounts, view school-level dashboards.
Permissions: read aggregate information about classes and teachers in their school. Provision teacher accounts. Never read individual student submissions unless an explicit, auditable elevation is granted.
Responsibilities: onboarding, offboarding, and policy alignment within a school.
Future expansion: district-level coordination, roster synchronization with SIS providers.

**Platform Administrator.**
Purpose: operate the platform.
Permissions: full administrative access to the platform, subject to audit logging. Never used for routine teacher or student actions.
Responsibilities: platform health, incident response, support escalations, curriculum governance.
Future expansion: delegated admin, per-region admins.

Every role is additive relative to the anonymous visitor. Elevated roles never lose the ability to view the public repository. A user can hold at most one primary role at a time; teacher accounts do not double as student accounts and vice versa.

---

## 5. Authentication Philosophy

Authentication exists to answer a single question: whose data is this? Everything else follows from that.

**Google Sign-In.** The platform standardizes on Google Sign-In. Schools in the target market already provision Google Workspace for Education accounts. Standardizing here removes password management, reduces support burden, and matches how classrooms already work. Alternative providers (email/password, Apple, Microsoft) are deferred until a documented school need arises.

*Tradeoff.* Google Sign-In creates a dependency on Google identity and excludes schools that do not use it. That is an acceptable Version 1 constraint. The identity abstraction is designed so an additional provider can be added later without changing the user model.

**First Login.** On first successful sign-in, the platform creates a durable user record keyed to the Google identity. The user is prompted once to select a role (student or teacher). Teacher role assignment is provisional until verified by a Platform Administrator or, later, a school administrator. Students are not required to select a school or class at first login; they can explore the repository as an authenticated student before joining a class.

*Why this matters.* Deferring class join to a separate step preserves the "lessons are the home base" principle. A student who signs in to see a lesson is not forced through a classroom enrollment funnel.

**Account Creation.** There is no separate account creation flow. Account creation is a consequence of first sign-in. There is no password to recover, no email to verify beyond Google's own verification, and no dormant account state.

**Returning Users.** Returning users are identified by their Google identity and restored to the state they left. Their role, their class enrollments, their preferences, and their prior submissions are immediately available. The platform never asks a returning user to re-select their role.

**Session Persistence.** Sessions persist across browser sessions on the same device by default, consistent with how school-issued devices are used. Session expiration is set to a length appropriate for classroom devices without becoming a security hazard. Explicit logout ends the session immediately on the current device and does not require a network round trip.

**Classroom Joining.** Joining a class is a distinct, deliberate action taken by an authenticated student. A student enters a join code, the platform validates it against the class's active join code, and the student is enrolled. Join codes are rotating, time-bounded, and revocable. A student can be enrolled in multiple classes simultaneously. Enrollment is never implicit.

*Why this matters.* Explicit joining preserves student agency and avoids silent roster changes.

**Logout.** Logout is available from every authenticated surface. It clears local session state and revokes the client's authenticated context. Logging out never destroys durable data. A student can log back in and find everything as they left it.

**Impersonation and support.** Platform Administrators never impersonate a user. Support workflows are designed so that operators can diagnose issues without assuming a user's identity. This is a permanent constraint.

---

## 6. Platform Data Domains

The platform manages a small number of conceptual domains. These are described here in prose, not as schemas. Firestore modeling is a downstream decision.

**Users.** Durable identities produced at first sign-in. Each user has a role, a display name, a school affiliation (optional in Version 1), and a set of preferences.

**Schools.** Organizational units that group teachers and, later, administrators. Schools exist even in Version 1 as a soft grouping so that later multi-school features do not require data migration.

**Teachers.** The subset of users with the teacher role. Teachers own classes.

**Students.** The subset of users with the student role. Students are enrolled in zero or more classes.

**Classes.** A teacher-owned unit of classroom organization. A class has a grade level, a block designation, a school year, an active/archived state, and a rotating join code.

**Enrollments.** The relationship between a student and a class. Enrollments carry their own state (`active`, `transferred`, `withdrawn`, `archived`) so history is preserved without deleting records. This vocabulary is canonical across the Domain Model and the Firestore Data Model.

**Lessons.** The instructional repository. Lessons are canonical, versioned by file path, and referenced by stable identifiers derived from filenames. The platform never stores a copy of lesson content. It references lessons by identifier.

**Assignments.** The teacher's expression that a specific lesson (or investigation, extension, simulation, or challenge) is currently surfaced for a specific class. Assignments are lightweight pointers, not copies. They carry an optional window during which the resource is surfaced.

*Terminology.* "Assignment" is the canonical **schema and domain** name for this pointer record. It is used at the storage and query layer. User-facing surfaces never render "assigned," "due," "late," "overdue," or "graded" language to Teachers or Students. See PDR-010.

**Assessment Submissions.** A student's completed in-lesson assessment, stamped with ownership, class context, lesson identifier, timestamp, and lesson version. Submissions are append-only from the student's perspective and immutable once finalized.

**Teacher Preferences.** Per-teacher configuration that does not belong on a class (e.g., default classroom mode settings, notification preferences).

**Platform Settings.** LyfeLabz-managed configuration such as feature flags, grade rollout state, and school year boundaries.

Cross-cutting attributes on every domain: a stable identifier, creation and update timestamps, an ownership reference where applicable, and a soft-delete state instead of hard deletion for anything that could be referenced elsewhere.

Firestore collection design, indexing strategy, and denormalization decisions are explicitly deferred. Those choices are made only after the access patterns for the teacher and student dashboards are fully specified.

---

## 7. Classroom Model

Classrooms are the coordination unit between teachers and students. The model is designed so that Version 1 supports a single school with two grades and expands cleanly to hundreds of teachers across multiple schools and years.

**Class Creation.** A verified teacher creates a class by specifying its grade, block, and school year. The platform assigns a stable class identifier that never changes for the life of the class, even when the class is archived or renamed. Display attributes (teacher-visible name, color, notes) are mutable.

**Multiple Class Blocks.** Teachers routinely teach multiple sections of the same grade across the day. Each block is a separate class instance under the same teacher. Blocks are independent for enrollment, assignments, and submissions. The teacher dashboard supports viewing across blocks without merging their state.

**Join Codes.** Each class has exactly one active join code at a time. Join codes are short, human-readable, rotating, revocable, and time-bounded. A teacher can rotate a join code at any time; the previous code becomes immediately invalid. Join codes are never stored on a client beyond the moment they are displayed.

**Student Enrollment.** Students join by entering a join code. Teachers can remove students from a class, which archives the enrollment rather than deleting it, so that historical submissions remain attributable. Teachers can invite specific students by identifier once a directory exists; that is a future capability.

**Archived Classes.** At the end of a school year, classes are archived rather than deleted. Archived classes remain readable to their teacher (and to Platform Administrators) but are excluded from active views. Students of archived classes retain read access to their own historical submissions.

**School Years.** Every class carries a school year. School year boundaries are platform settings, not per-teacher configuration, to keep archival behavior consistent. Rollover is a scheduled, opt-in action for teachers, not an automatic mass update.

**Future Co-Teaching Support.** The class ownership model is designed for a single primary teacher in Version 1 but expressed as a set of teacher references to allow co-teaching without a schema migration. Co-teaching itself is deferred until permission semantics (who can rotate join codes, who can archive) are resolved.

**Recommendation.** Classes are first-class entities with stable identifiers, teacher-owned but designed for future multi-teacher references, and always archived rather than deleted.

*Why.* This model scales cleanly, preserves history, and keeps join and rollover behavior predictable. Its main future limitation is that class-level customizations (e.g., renaming blocks mid-year) require careful UI to avoid confusing students; that is a design problem, not a data-model problem.

---

## 8. Lesson Availability Philosophy

Teachers curate access; they do not assign work. This distinction is the difference between LyfeLabz and a conventional LMS.

Availability is expressed in three layers, from broadest to narrowest:

- **Grade access.** A class's grade determines the default set of lessons visible to students in that class.
- **Unit access.** Within a grade, a teacher can open or close entire conceptual narratives (e.g., Earth Systems, Water Systems) for their class.
- **Lesson access.** Within a unit, a teacher can surface or hide individual lessons.

The same three-layer control applies to supporting resource types: investigations, extensions, simulations, and engineering challenges. Games are always available where lessons are available; they are not a separate curation axis.

**Preservation rule.** Even when a teacher has not surfaced a lesson to a class, that lesson remains a public instructional resource on the repository. Curation controls what appears in the student's class view; it never removes lessons from the internet. Students always retain the ability to explore beyond what has been surfaced.

**No forced completion.** Availability is never expressed as "assigned" or "due." A lesson is either surfaced or not. Timestamps on submissions record when students engaged; they are not deadlines.

**Recommendation.** Curation is stored as a set of assignment records referencing stable lesson identifiers, scoped to a class. Defaults come from grade-level rollout state managed by LyfeLabz.

*Why.* This preserves the "lessons are reusable learning resources" principle, avoids curriculum forking, and keeps the instructional repository as the single source of truth. Future limitations: teachers who want to author or remix lessons must go through the future teacher-created content workflow, not through curation.

---

## 9. Assessment Architecture

Assessment v2 is the durable, ownership-stamped submission model that replaces ad hoc quiz storage.

**Submission Ownership.** Every submission carries a stable reference to its student, its class at the moment of submission, the lesson identifier, and the lesson version. Ownership is verified server-side before the submission is finalized. A submission that cannot be attributed is rejected.

**Timestamps.** Every submission records creation, last update, and finalization timestamps in UTC. Timestamps are set by trusted sources (Firestore server timestamps or Cloud Functions), never by the client.

**Versioning.** Submissions are immutable once finalized. A student who retakes an assessment produces a new submission. The prior submission remains readable to preserve history. Lesson version is captured so that a submission's questions can be reconstructed even after the lesson evolves.

**Student Responses.** Responses are stored per-question in a structured, forward-compatible format that supports multiple choice today and open-response, ordering, and rubric-scored answers later. Response schema evolution is additive.

**Future Rubric Support.** Rubric scoring is anticipated but not designed here. The submission format reserves space for teacher-assigned scores and comments so that adding rubric support does not require a migration.

**Recommendation.** Submissions are append-only from the student side, finalized by a trusted path (Cloud Function or transactional client write with server timestamps), and versioned against the lesson at submission time.

*Why.* This produces trustworthy historical data, protects submission integrity, and makes future rubric and analytics work possible without reshaping past submissions.

Analytics is explicitly out of scope for this section.

---

## 10. Dashboard Responsibilities

Dashboards are responsibilities, not screens. UI design is out of scope.

**Teacher Dashboard.**
- Present the teacher's classes across blocks and school years.
- Support class creation, join code rotation, and enrollment management.
- Surface curation controls at grade, unit, and lesson granularity.
- Present submissions with clear class and lesson context.
- Never present per-student analytics that would substitute for teacher judgment.
- Provide accessible, mobile-first surfaces suitable for use during class transitions.

**Student Dashboard.**
- Present the classes the student is enrolled in.
- Present the lessons the student's teachers have surfaced, without hiding public repository lessons.
- Present the student's own submission history.
- Provide a simple join-a-class action.
- Never present rankings, streaks, or engagement metrics that reframe learning as competition.

**Administrator Dashboard (future).**
- Present school-level roster and class health without exposing individual student submissions by default.
- Support teacher provisioning and role verification.
- Provide auditable elevation for support scenarios.
- Never provide default access to instructional content that would make it easier to surveil learners than to support them.

Every dashboard obeys the accessibility, mobile-first, and progressive-enhancement principles. Every dashboard is instrumented for observability. Every dashboard fails to a legible empty state rather than a blank screen.

---

## 11. Security Philosophy

Security is a design property, not a review step.

**Least Privilege.** Clients receive only the credentials required for their current role and their current view. Teachers cannot read submissions from classes they do not own. Students cannot read submissions belonging to peers. Administrators cannot read student submissions without an auditable elevation. Service accounts hold the minimum scopes required for their function.

**Ownership.** Every writable record has an owner. Ownership is set at creation and never changed except through an auditable administrative path. Writes that would violate ownership are rejected server-side, not filtered client-side.

**Classroom Isolation.** Data belonging to one class is invisible to any user not enrolled in or teaching that class. Cross-class queries are structurally impossible for non-administrators. This is enforced by the data model and by security rules, not by UI filtering.

**Student Privacy.** Student identity and student work are treated as sensitive. Aggregated analytics never re-identify individual students. Third-party integrations do not receive student data without explicit, per-integration approval. FERPA-aligned handling is the default; state-level requirements are layered on top.

**Teacher Privacy.** Teacher work, notes, and preferences are private to the teacher. Administrators do not access teacher preferences without an auditable reason.

**Scalability.** The security model performs at scale. Rules are evaluated in constant time relative to a document's size; hot-path rules do not fan out. Security decisions are pre-computed into the data model where possible (e.g., denormalized ownership references) rather than resolved at query time.

**Future District Support.** The model anticipates district-level roles. School and district identifiers are first-class references from day one, even when only a single school is live, so that adding district scoping later is additive.

**Auditability.** Every privileged action produces an audit record. Silent administrative actions are prohibited.

Firebase Security Rules will implement this model. They are not designed in this document.

---

## 12. Deployment Strategy

Deployment is boring on purpose.

**Environments.**
- **Development.** Local emulators for Auth, Firestore, and Hosting. No traffic reaches production data.
- **Testing.** A dedicated Firebase project that mirrors production configuration. Used for CI verification and pre-release validation. Never contains real student data.
- **Production.** The single live Firebase project serving the LyfeLabz custom domain.
- **Staging (future).** A separate project inserted between testing and production once release cadence justifies it.

**GitHub.** The single source of truth for all code, configuration, and this document. Every deployable artifact originates from a tagged commit on the main branch. Pull requests are the only path into main.

**Firebase Hosting.** The deployment target for the static repository and dashboard shells. Atomic releases with versioned channels. Preview channels are used for reviewing dashboard changes before promotion.

**Versioning.** Semantic versioning at the platform level, distinct from lesson content revisions. Lesson content is versioned by file path and by a version marker embedded in each lesson for assessment attribution.

**Deployment Workflow.** A single documented workflow: pull request opened, CI runs (build, lint, accessibility checks, tests), review is required, merge to main triggers a testing deploy, promotion to production is a deliberate action gated on green testing. No manual production deploys from developer machines.

**Rollback Strategy.** Firebase Hosting's release history provides one-click rollback of the static surface. Firestore data changes are protected by additive schema evolution; destructive migrations require a documented plan and are always paired with a backup. Cloud Functions (when introduced) deploy with the ability to revert to the previous version. Security rules are versioned in git and can be rolled back independently.

**Future Staging Environment.** Introduced when the platform has multiple concurrent workstreams or when live-like data (synthetic, never real) is needed for pre-release validation. Until then, testing is sufficient.

---

## 13. Long-Term Platform Roadmap

The following capabilities are anticipated. Today's architecture is designed to make each of them additive.

**Parent Accounts.** A read-only view scoped to a single student, with explicit consent. Enabled by the role model being an extendable closed set and by ownership-first data design.

**AI Tutoring.** Optional per-lesson hints and Socratic prompts. Enabled by keeping AI behind a clear service interface so its availability is never load-bearing for the lesson.

**AI Lesson Recommendations.** Teacher-facing suggestions grounded in the standards framework, not in student surveillance. Enabled by the standards-driven curriculum model and stable lesson identifiers.

**District Analytics.** Aggregate insight for districts, never per-student. Enabled by school and district identifiers being first-class from day one.

**Cross-School Collaboration.** Teachers sharing curation and, eventually, teacher-created content across schools. Enabled by the class model treating teachers as references rather than embedded owners.

**Professional Learning Communities.** Discussion spaces for teachers around lessons and curation. Enabled by the platform having authenticated teacher identity and durable class references.

**Shared Lesson Libraries.** Curated collections of lessons that transcend a single grade or unit. Enabled by lessons being referenced by stable identifiers.

**Teacher-Created Content.** A future authoring pathway that produces content meeting the canonical lesson architecture. Enabled by the canonical architecture rules already documented in CLAUDE.md.

**Standards Reporting.** Reporting aligned to the Massachusetts framework and, later, other frameworks. Enabled by badge conservatism and by treating standards as data attached to lessons.

**Google Classroom and Canvas Integration.** Optional rostering and single-sign-on integrations. Enabled by the identity abstraction and by class identifiers being stable across integrations.

**Offline Support.** Lessons should function offline once loaded. Enabled by keeping the static repository free of runtime authentication dependencies. Authenticated features are online-first with graceful degradation.

Every item above is a possible future. None is a commitment. The point of listing them is to ensure today's architectural choices do not preclude them.

---

## 14. Architectural Decisions to Lock

The following decisions should be considered locked before implementation begins. Each is worth revisiting only through a documented architectural change process.

**Google Sign-In as the identity provider for Version 1.**
Why it matters: identity provider choice affects every downstream permission and integration decision.
Risk of changing later: user records and administrative flows have to be reworked; existing users may need to re-authenticate through a new provider.
Recommended choice: Google Sign-In only, behind an identity abstraction that allows a second provider without changing the user model.

**Firebase Hosting, Authentication, and Firestore as the platform substrate.**
Why it matters: the substrate choice determines deployment, security, and scaling patterns.
Risk of changing later: a substrate migration touches every system.
Recommended choice: Firebase, with disciplined use of vendor-neutral abstractions where feasible.

**Static lesson repository remains authoritative and independent of authentication.**
Why it matters: this preserves the "lessons are the home base" principle and keeps public URLs stable.
Risk of changing later: the entire mental model of the platform shifts, and public URLs may break.
Recommended choice: never gate lesson content behind authentication.

**Ownership is stamped at creation and never mutated except through an auditable admin path.**
Why it matters: ownership is the foundation of the security model.
Risk of changing later: security rules become ambiguous; historical attribution becomes unreliable.
Recommended choice: immutable ownership with administrative reassignment as an audited exception.

**Classes have stable identifiers, are archived not deleted, and are designed for future multi-teacher references.**
Why it matters: classroom history and future co-teaching hinge on this.
Risk of changing later: historical submissions become orphaned; co-teaching requires migration.
Recommended choice: as stated.

**Submissions are immutable once finalized and are versioned against the lesson.**
Why it matters: assessment trust depends on this.
Risk of changing later: past submissions become unverifiable.
Recommended choice: as stated.

**Curation is expressed at grade, unit, and lesson granularity and never removes lessons from the public repository.**
Why it matters: preserves LyfeLabz's instructional philosophy.
Risk of changing later: the platform drifts toward LMS semantics.
Recommended choice: as stated.

**Stable lesson identifiers derived from filenames, governed by the safe-rename checklist already in CLAUDE.md.**
Why it matters: every assignment and submission references lessons by identifier.
Risk of changing later: silent breakage of past submissions.
Recommended choice: keep the safe-rename checklist authoritative and extend it to include submission attribution checks.

**Server-authoritative timestamps for anything that carries legal or academic weight.**
Why it matters: client clocks are not trustworthy.
Risk of changing later: audit records become unreliable.
Recommended choice: as stated.

**Additive schema evolution.**
Why it matters: destructive migrations at scale are dangerous.
Risk of changing later: past data becomes unreadable or requires expensive migrations.
Recommended choice: additive-only, with documented migration plans for the rare exceptions.

**Accessibility standard equal to the instructional repository across all platform surfaces.**
Why it matters: platform surfaces are used by the same students and teachers.
Risk of changing later: legal and ethical exposure; erosion of trust.
Recommended choice: WCAG 2.1 AA as the floor, verified in CI.

**Mobile-first design for every platform surface.**
Why it matters: real classroom devices are phones and Chromebooks.
Risk of changing later: teachers cannot use the platform in the environments they actually work in.
Recommended choice: as stated.

**One canonical way to do each cross-cutting concern.**
Why it matters: divergence multiplies maintenance cost.
Risk of changing later: incremental drift is invisible until it isn't.
Recommended choice: documented canonical patterns for auth, data access, error handling, deployment, and telemetry.

---

## 15. Questions That Must Be Answered Before Firebase Development Begins

These questions do not have provisional answers. Each requires a deliberate decision before implementation begins.

**Identity and provisioning.**
- How is a user's initial teacher role verified? Manual LyfeLabz review, school administrator approval, or invite links?
- What happens when a user signs in with a personal Google account instead of a school-issued one? Allowed, restricted, or blocked at Version 1?
- What is the exact policy for account deletion, and how does it interact with historical submissions?

**Schools and districts.**
- Does Version 1 launch with one school or multiple? If one, what is the trigger for adding a second?
- How is a school created in the platform, and who authorizes it?
- What is the naming and identifier convention for schools and districts?

**Classes and rollover.**
- What are the exact school year boundaries, and who sets them?
- What is the teacher's experience for rolling classes over between years? Automatic, opt-in, or manual?
- Is a class allowed to span more than one school year, or does rollover always create a new class?

**Enrollment and join codes.**
- What is the join code format and lifespan?
- What rate limits apply to join attempts?
- What happens when a student joins a class they were previously removed from?

**Assessment.**
- What triggers finalization of a submission: student action, timer, teacher action, or a combination?
- Are retakes allowed by default, controlled per class, or controlled per assessment?
- How are lesson versions communicated to submissions in a way that survives lesson filename changes governed by the safe-rename checklist?

**Curation.**
- Are grade-level defaults set by LyfeLabz, by school administrators, or by teachers?
- When a lesson is unpublished from the repository, what happens to classes that had it surfaced?
- Do investigations, extensions, simulations, and engineering challenges follow the exact same curation model, or do any require special handling?

**Security and privacy.**
- What is the concrete data retention policy for submissions, enrollments, and archived classes?
- Under what circumstances, and with what audit trail, may a Platform Administrator read student submissions?
- What is the platform's stance on parental access before parent accounts exist?

**Operations.**
- Who is on call for the platform, and what is the incident response process?
- What is the backup cadence for Firestore, and what is the tested restore procedure?
- What is the acceptable window for a production rollback?

**Integrations.**
- Is Google Classroom integration a Version 1 need or a later addition?
- Are any state or district reporting integrations required at launch?

**Governance.**
- Who approves changes to this document?
- What is the review cadence to ensure this document remains accurate as the platform evolves?

Answering these questions is the prerequisite for Firebase implementation. Until each has a recorded decision, this document is the operative reference and no production code should be written against assumptions that contradict it.
