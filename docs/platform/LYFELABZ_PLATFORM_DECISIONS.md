# LyfeLabz Platform Decisions

**Status:** Canonical architectural decision log
**Purpose:** Permanently record every major architectural decision that must be considered locked before implementation begins
**Audience:** Every current and future LyfeLabz contributor
**Companion documents:** LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_ARCHITECTURE_REVIEW.md

This document is the canonical reference for LyfeLabz architectural decisions. When a future contributor asks "why did we choose this?", "can we change this?", "what assumptions were made?", or "is this decision still valid?", this is the document that answers.

Decisions here are not casually revisited. Each has a **Future Reconsideration Criteria** section that describes the evidence that would justify reopening the decision. Absent that evidence, the decision stands.

Each record follows a uniform format:

- **Decision** - concise title
- **Status** - Accepted, Deferred, or Future Consideration
- **Background** - the problem or design question
- **Alternatives Considered** - realistic options weighed
- **Decision** - the chosen direction
- **Rationale** - why this is the right choice for LyfeLabz
- **Consequences** - benefits and limitations
- **Future Reconsideration Criteria** - what would justify revisiting

---

## PDR-001: Platform Identity

### Decision

LyfeLabz is a standards-driven, student-centered science learning environment for middle school. Its platform layer is a classroom coordination fabric around a public instructional repository. It is deliberately not a learning management system.

### Status

Accepted.

### Background

Educational software tends to drift toward LMS semantics: assignments, due dates, completion percentages, grade calculations, and progression gates. This drift happens quietly, one feature at a time, and eventually redefines the product. LyfeLabz must name what it is and what it is not before any classroom feature is built, because every subsequent decision either reinforces or erodes that identity.

### Alternatives Considered

- **Full LMS.** Grade books, due dates, mastery tracking, progression. Rejected: reframes learning as compliance and duplicates existing LMS products.
- **Pure content library, no platform.** Rejected: classrooms need coordination; teachers need to see student work; students benefit from continuity.
- **Content library plus lightweight LMS shim.** Rejected as a framing: "lightweight LMS" is how heavy LMSes begin.

### Decision

LyfeLabz is:

- a **reusable learning resource** anyone can access
- with a **classroom coordination platform** on top for teachers and students who want it
- where **lessons remain the home base** of every experience
- and **exploration is preferred over completion**

LyfeLabz is not:

- a learning management system
- a gradebook
- a compliance tool
- a surveillance system
- a competitor to Canvas, Schoology, or Google Classroom

### Rationale

Naming what the platform is not is the single cheapest way to prevent scope creep. Every future feature request is evaluated against this identity. "Would this feature move us toward being an LMS?" is a question with a defensible answer only if this record exists.

The tradeoff is real: some teachers will want LMS features and LyfeLabz will decline to provide them. That is the correct answer, not a gap.

### Consequences

Benefits:

- Every future feature has a stable frame of reference.
- The instructional repository stays independent of the platform.
- Marketing and positioning are unambiguous.
- The product does not compete with tools schools already own.

Limitations:

- Some prospective users will find the platform "too light."
- Certain revenue models (grade export, compliance dashboards) are foreclosed.
- Feature requests that violate this identity will be declined and that will disappoint some users.

### Future Reconsideration Criteria

This decision should be revisited only if:

- LyfeLabz's mission itself is redefined by its owners, or
- schools materially stop using external LMS products and expect LyfeLabz to fill that role.

Growth pressure alone is not sufficient reason.

---

## PDR-002: Authentication Provider

### Decision

Google Sign-In through Firebase Authentication is the sole identity provider for Version 1. School-issued Google Workspace accounts are the expected primary identity. Personal Google accounts are restricted at Version 1.

### Status

Accepted.

### Background

Every authenticated feature depends on identity. The choice of identity provider affects onboarding, security, verification, and every future integration. The target market (Massachusetts middle schools) is overwhelmingly on Google Workspace for Education.

### Alternatives Considered

- **Email/password.** Rejected: introduces password recovery, verification, and abuse concerns that Google already solves.
- **Apple, Microsoft, or multi-provider from day one.** Rejected for Version 1: adds complexity before there is documented school demand.
- **Custom SSO / SAML.** Rejected for Version 1: only meaningful at district scale, which is a later phase.
- **Anonymous accounts with device-scoped identity.** Rejected: cannot durably attribute submissions.

### Decision

- Google Sign-In only in Version 1.
- School-domain accounts are the expected identity.
- Personal Google accounts are blocked from the teacher role and, by default, from creating durable student records at Version 1. Anonymous browsing of the public repository remains available to anyone with any account or none.
- Identity is abstracted behind a user model that permits a second provider later without a data migration.

### Rationale

Standardizing on Google removes password management, matches how classrooms already work, and reduces the surface area of the platform. Restricting personal accounts closes a class of teacher-verification and student-identity abuse problems that would otherwise complicate every downstream security decision.

The tradeoff is that schools not on Google Workspace cannot use LyfeLabz in Version 1. This is acceptable because the abstraction allows another provider to be added when the demand is documented.

### Consequences

Benefits:

- No password infrastructure.
- No account creation flow separate from sign-in.
- Trust in identity is inherited from the school's Workspace domain.
- Teacher verification can be partially automated by school domain.

Limitations:

- Non-Google schools are excluded until a second provider ships.
- Google outages affect LyfeLabz sign-in.
- Personal-account users see a restricted experience, which requires clear messaging.

### Future Reconsideration Criteria

Add a second provider when a school with documented need adopts LyfeLabz and provisions accounts under a non-Google identity system. Do not add providers speculatively.

---

## PDR-003: Teacher Verification Philosophy

### Decision

Teacher role assignment is provisional at first sign-in and confirmed by a verification pathway. Verification prefers automation via known school Workspace domains, backed by manual override by a Platform Administrator. Later, school administrators may verify their own teachers.

### Status

Accepted.

### Background

A teacher account grants access to student submissions and the ability to create classes that other students join. Unverified teacher accounts are a privacy-incident vector. Verification cannot be so slow that legitimate teachers abandon onboarding, and cannot be so loose that anyone can claim the role.

### Alternatives Considered

- **Self-declaration only.** Rejected: unacceptable privacy exposure.
- **Manual review of every teacher.** Rejected as sole method: does not scale past a single school.
- **Rely on Google Workspace admin provisioning.** Rejected as sole method: requires district-level integration LyfeLabz does not yet have.

### Decision

- Teachers are provisional at first sign-in.
- The platform maintains a list of verified school Workspace domains. A sign-in from a verified domain that self-declares as teacher is auto-verified.
- A sign-in from an unverified domain that self-declares as teacher is placed in provisional state, with a clearly explained pending screen and a manual review path.
- Manual verification is performed by a Platform Administrator.
- School administrators (future) may verify their own teachers within their domain.

### Rationale

Domain-based verification is fast for the common case and defensible for the uncommon case. The provisional state is a real, designed screen rather than a locked dashboard, so legitimate teachers are not left guessing.

### Consequences

Benefits:

- Fast onboarding for teachers at partner schools.
- No possibility of an unverified teacher reading student submissions.
- Clear escalation path.

Limitations:

- Platform Administrators are on the critical path for new schools.
- A verified domain list must be maintained as data, not code.

### Future Reconsideration Criteria

Reconsider when a district integration provides authoritative teacher rosters, or when school administrators are broadly available to self-verify.

---

## PDR-004: Closed Role Model

### Decision

LyfeLabz has a small closed set of roles: Anonymous Visitor, Student, Teacher, School Administrator (future), and Platform Administrator. Every role is additive relative to Anonymous Visitor. A user holds exactly one primary role at a time.

### Status

Accepted.

### Background

Open role systems produce permission ambiguity, security-rule complexity, and support incidents. Every "just add a role" request that succeeds makes the next such request cheaper. Every one that is declined preserves the model.

### Alternatives Considered

- **Fine-grained permission grants.** Rejected: no small team can maintain a permission matrix at scale.
- **Dual roles (teacher who is also a student).** Rejected: creates ownership ambiguity on submissions and classes.
- **Custom per-school role labels.** Rejected: labels drift; underlying permissions must remain uniform.

### Decision

- Five roles, closed set.
- Additive to Anonymous Visitor.
- Exactly one primary role per user.
- New roles require a documented architectural decision record.

### Rationale

Closed role sets keep security rules writable, keep support tractable, and keep the mental model of the platform small. When a scenario appears to need a new role, it almost always turns out to need a new capability inside an existing role.

### Consequences

Benefits:

- Predictable authorization.
- Simple security rules.
- Bounded support surface.

Limitations:

- Some scenarios (co-teachers, teaching assistants, curriculum coaches) must be expressed within existing roles or deferred.
- Dual-role users must maintain two accounts, which will disappoint a small number of teachers who are also students in graduate programs.

### Future Reconsideration Criteria

Reconsider only when a documented capability cannot be expressed within an existing role without diluting that role's meaning.

---

## PDR-005: Classroom Ownership

### Decision

Classes are teacher-owned entities with stable identifiers. Classes are archived, never deleted. Ownership is immutable except through an audited administrative transfer path. The class model reserves space for future multi-teacher references without requiring a schema migration.

### Status

Accepted.

### Background

Classroom ownership determines who can read student work, who can rotate join codes, and who inherits a class when the original teacher leaves the school. Loose ownership is a privacy risk. Rigid ownership blocks legitimate transfers.

### Alternatives Considered

- **Multi-teacher ownership from day one.** Rejected for Version 1: permission semantics for co-teaching are unresolved and can be added additively later.
- **School-owned classes with teacher references.** Rejected for Version 1: requires school-level administration LyfeLabz does not yet have.
- **Delete classes on archive.** Rejected: destroys historical submission attribution.

### Decision

- Single primary teacher per class in Version 1.
- Stable class identifier assigned at creation and never changed.
- Archive, do not delete.
- Ownership transfers exist only through an audited Platform Administrator path.
- The class model expresses teacher ownership as a reference set of size one, so co-teaching is additive later.

### Rationale

This is the smallest ownership model that supports Version 1 and does not prevent Year 3. Preserving historical submissions through archive-not-delete is not optional; submissions are the highest-value data on the platform and their attribution must survive the class's lifecycle.

### Consequences

Benefits:

- Simple permission model in Version 1.
- Historical attribution is durable.
- Future co-teaching does not require migration.
- Teacher departures do not orphan student work.

Limitations:

- Version 1 cannot express co-teaching or teaching assistants.
- Ownership transfer is not self-serve.

### Future Reconsideration Criteria

Reconsider co-teaching when the permission semantics (join-code rotation, archival, submission read) can be defined without weakening the ownership invariant.

---

## PDR-006: School-Year Rollover

### Decision

School year boundaries are platform-managed settings. Class rollover is a per-class, opt-in, reversible teacher action, not an automatic mass update. Classes may not span more than one school year; rollover always produces a new class with a new identifier and a preserved link to the prior year's class.

### Status

Accepted.

### Background

Rollover is a moment where destructive shortcuts are tempting. A silent mass update at midnight on a fixed date has caused real incidents at real ed-tech products. Rollover must be predictable, opt-in, and reversible.

### Alternatives Considered

- **Automatic rollover at a fixed date.** Rejected: destructive at scale, hard to undo.
- **Manual duplication with no linkage.** Rejected: loses the ability to browse a teacher's prior years coherently.
- **Classes that span multiple years.** Rejected: complicates archival and reporting.

### Decision

- Platform-managed school year settings.
- Per-class opt-in rollover initiated by the teacher.
- Rollover produces a new class with a new identifier and a documented link to the prior class.
- Rollover is reversible within a defined window.

### Rationale

The blast radius of an automatic mass update is unacceptable. Per-class rollover is boring, predictable, and defensible.

### Consequences

Benefits:

- No silent destructive updates.
- Historical continuity for teachers.
- Reversibility protects against mistakes.

Limitations:

- Teachers must actively roll over each class.
- Curation carry-forward becomes a designed feature, not a side effect.

### Future Reconsideration Criteria

Reconsider automation only when there is a proven, staged, reversible path validated at scale, and only for opt-in teachers.

---

## PDR-007: Lessons Are Permanent Instructional Resources

### Decision

Lessons are permanent, publicly accessible instructional resources served from the static repository. The platform references lessons by stable identifiers; it never stores copies of lesson content. Instructional content is fully independent of classroom data.

### Status

Accepted.

### Background

The instructional repository predates the platform and is the reason LyfeLabz exists. Any architecture that makes lesson content dependent on the platform betrays that inheritance. Any architecture that duplicates lesson content into classroom records creates versioning nightmares.

### Alternatives Considered

- **Copy lesson content into classroom-scoped records.** Rejected: creates parallel truths and versioning drift.
- **Gate lessons behind authentication.** Rejected: violates the "home base" principle and breaks public accessibility.
- **Store lesson content in Firestore.** Rejected: static hosting is faster, cheaper, and simpler.

### Decision

- Lessons remain in the static repository, served from Firebase Hosting.
- Lessons are referenced by stable identifiers derived from filenames, governed by the safe-rename checklist in CLAUDE.md.
- The platform never stores lesson content.
- Anonymous visitors can read every published lesson.
- Assignments, submissions, and curation are pointers to lessons, never embeddings.

### Rationale

This decision is the structural expression of "lessons are the home base." It also protects public accessibility, keeps lesson deploys independent of platform deploys, and keeps the instructional repository legible to future maintainers.

### Consequences

Benefits:

- Public accessibility is preserved.
- Lesson evolution does not require platform migrations.
- The instructional repository remains legible on its own.
- Offline caching of lessons is possible.

Limitations:

- The platform cannot rewrite lesson content per class.
- Teacher-authored content, when added, must adhere to the canonical lesson architecture and live in a compatible pathway.

### Future Reconsideration Criteria

Reconsider only if the instructional repository itself is fundamentally reorganized, in which case this decision is a downstream effect, not a driver.

---

## PDR-008: Assessment Submission Model

### Sprint 9A Reconciliation Notice

This record is superseded in part by PDR-021 and by `ASSESSMENT_PIPELINE_SPECIFICATION.md`. The load-bearing commitments of PDR-008 - server-side finalization, immutability, ownership stamping, version stamping, retention of prior records on new attempts - all survive intact and are restated in the specification. The following terminology and scope changes apply:

- The authoritative record entity is renamed **Attempt**. There is no separate Submission entity. The transient `submitted` state remains internal to the server transaction and is never externally observable.
- The word "retake" is reserved for the future summative pipeline. Formative repeatable evidence is an **attempt**.
- Formative attempts are unlimited by default.
- Client-authoritative scoring is prohibited. The specification requires server-authoritative scoring and server-confidential answer keys.
- Sessions are a distinct entity from attempts. See Sections 6, 8, 9, and 10 of the specification.

Where this record and the specification appear to disagree, the specification controls.

### Decision

Attempts are ownership-stamped, immutable-once-finalized records that reference the lesson by identifier and by internal assessment revision. Finalization occurs through a Cloud Function from Version 1. Timestamps are server-set. New attempts create new attempt records and preserve all prior ones. Formative attempts are unlimited by default. Sessions are distinct from attempts and are governed by `ASSESSMENT_PIPELINE_SPECIFICATION.md`.

### Status

Accepted.

### Background

Submissions are the highest-value data on the platform. They must be trustworthy across years, resilient to client-side tampering, and reconstructable even after lessons evolve. The architecture review flagged client-side finalization as the single largest security risk.

### Alternatives Considered

- **Client-side finalization with security rules only.** Rejected: security rules alone cannot guarantee finalization semantics; correctness depends on trusted server logic.
- **Mutable submissions with an "edited" flag.** Rejected: destroys historical trust.
- **Overwrite on retake.** Rejected: destroys retake history and teacher visibility into learning.

### Decision

- Every submission carries: student reference, class-at-submission reference, lesson identifier, lesson version, response payload, and server-set creation, update, and finalization timestamps.
- Finalization is performed by a Cloud Function from Version 1.
- Submissions are immutable once finalized.
- Retakes produce new submission records; prior submissions remain readable.
- The response schema is forward-compatible for multiple-choice, open response, ordering, and rubric-scored formats.

### Rationale

Cloud Function finalization moves the trust boundary to a code path that can enforce ownership, class-at-submission attribution, lesson version stamping, and timestamp integrity in one place. This is worth the added infrastructure from day one because the alternative is an unfixable class of correctness bugs.

### Consequences

Benefits:

- Trustworthy assessment history.
- Rubric and analytics work later without migration.
- Attribution survives student class changes and lesson filename evolution.

Limitations:

- Cloud Functions must exist in Version 1, contrary to the architecture document's original "future" framing.
- Retake histories will grow; retention policy must address them (see PDR-011).

### Future Reconsideration Criteria

Reconsider the immutability rule only for legally required deletions (right-to-erasure requests) and only through an audited path.

---

## PDR-009: Lesson Versioning and Identity

### Decision

Every lesson has a permanent identifier that outlives filename changes. Lesson revisions are tracked by a version marker embedded in the lesson. Every submission stamps both the lesson identifier and the lesson version it was completed against. Archived lesson versions remain reconstructable so that historical submissions can be interpreted correctly.

### Status

Accepted.

### Background

Filenames change. Question wording evolves. Standards attribution changes. Without a stable identity model, a submission from October becomes uninterpretable by February.

### Alternatives Considered

- **Filename as identity.** Rejected: renames are supported by the safe-rename checklist but must not silently break attribution.
- **Content hash as identity.** Rejected: changes on every edit; unusable as a stable reference.
- **UUID stamped into every lesson file.** Accepted, in combination with a version marker.

### Decision

- Each lesson carries a permanent lesson identifier (independent of filename) declared in the lesson file.
- Each lesson also carries a monotonically increasing version marker.
- The safe-rename checklist is extended to require: no change to the lesson identifier, an incremented version marker, and a documented rationale.
- Assignments reference lessons by identifier.
- Submissions capture identifier and version at submission time.
- The static repository preserves prior lesson versions in a form that allows a submission to be reconstructed against its original questions.

### Rationale

The safe-rename checklist already protects URL stability. Extending it to protect submission attribution closes the last major identity risk. Preserving prior lesson versions is a modest storage cost that pays for itself the first time an assessment must be defensibly reconstructed.

### Consequences

Benefits:

- Historical submissions remain interpretable.
- Filename evolution stays safe.
- Rubric grading of prior submissions works even after the current lesson has moved on.

Limitations:

- Lesson authors must respect the identifier and version markers.
- The repository accumulates prior lesson versions, requiring a retention rule.

### Future Reconsideration Criteria

Reconsider archival retention when storage costs or content-organization concerns materially outweigh the reconstruction guarantee.

---

## PDR-010: Curation, Not Assignment

### Decision

Teachers curate lesson availability at grade, unit, and lesson granularity. Curation surfaces or hides content; it never removes content from the public repository, and it never creates due dates or completion requirements.

### Status

Accepted.

### Background

The line between "surfacing" and "assigning" is where a content library becomes an LMS. This line must be drawn structurally, not by naming convention.

### Alternatives Considered

- **Assignments with due dates.** Rejected: reframes learning as compliance.
- **Progression gates that unlock lessons.** Rejected: violates exploration principle.
- **Teacher-authored lesson variants per class.** Deferred: teacher-created content is a future capability with its own governance.

### Decision

- Curation is expressed as a set of assignment records that are pointers, not copies.
- Curation has three layers: grade, unit, lesson.
- The same model applies to investigations, extensions, simulations, and engineering challenges.
- Games follow lessons; they are not separately curated.
- Public repository access is never removed by curation.
- Curation never expresses "due," "assigned," or "required" to users.

### Terminology Amendment (2026-07-07)

Downstream documents refer to the pointer record by the neutral schema name `assignment` (collection `assignments`, document type Assignment). This is accepted here as the canonical **schema and domain** term. It appears in the Firestore Data Model, the Query Strategy, the Rollup Strategy, the Security Model, and the Cloud Function Charter at the storage and workflow layer.

The **user-facing vocabulary** is bound by the following rules, which are load-bearing under PDR-010:

- Teacher UI and Student UI never render the words "assigned," "due," "late," "overdue," "required," or "graded."
- Teacher UI uses "curation," "surface," "hide," "window closes," "Classroom Mode," and "Practice Mode."
- Student UI uses "available," "closing soon," and lesson-native vocabulary.
- Field names on the Assignment record are neutral: `windowClosesAt` (not `dueAt`), `availableAt`, `mode: practice | classroom` (not `graded`). Fields expressing lateness or forced completion do not exist.

This amendment reconciles PDR-010's philosophy with the practical need for a stable schema name. The intent of PDR-010 is unchanged; only the terminology boundary between schema and UI is made explicit.

### Rationale

This is the structural expression of the platform's identity (PDR-001). The three-layer model matches how teachers actually think about their curriculum. Preservation of public access is the invariant that keeps LyfeLabz honest.

### Consequences

Benefits:

- Teachers get real control without the platform drifting toward LMS semantics.
- Students retain the ability to explore beyond what has been surfaced.
- The instructional repository remains authoritative.

Limitations:

- Teachers who want deadlines will need to communicate them outside the platform.
- Curation carry-forward between years must be a designed feature.

### Future Reconsideration Criteria

This decision does not become negotiable. Even if teachers request deadlines, the response is to help them use their existing LMS for that purpose.

---

## PDR-011: Privacy

### Decision

LyfeLabz treats student identity and student work as sensitive data subject to FERPA and, for the under-13 cohort, COPPA. Data collection is minimized to what is necessary for the classroom function. Teacher preferences are private to the teacher. Deletion, retention, and guardian access are governed by explicit written policies attached to this record.

### Status

Accepted.

### Background

Middle school students include the under-13 cohort. The architecture review flagged the absence of COPPA scope as a major gap. Privacy cannot be a gesture; it must be operationalized as retention rules, collection limits, and disclosure logging.

### Alternatives Considered

- **FERPA-only framing.** Rejected: leaves the under-13 cohort inadequately protected.
- **Third-party consent management platform.** Deferred: valuable at district scale, unnecessary at Version 1.
- **Broad data collection with post-hoc anonymization.** Rejected: minimization is cheaper and safer than anonymization.

### Decision

**Regulatory posture.**

- FERPA-aligned handling is the default for all student records.
- COPPA compliance applies to any student the platform has reason to believe is under 13. In Version 1, all middle-school student records are treated as if COPPA applies.
- State-level requirements (Massachusetts student data privacy) are layered on top.

**Minimum student data collection.**

- Google identity (subject identifier and email).
- Display name (may be first name only, per teacher policy).
- Role.
- Class enrollments.
- Submissions.
- No demographic data. No behavioral tracking beyond submission timestamps. No third-party analytics on authenticated student surfaces.

**Teacher privacy.**

- Teacher preferences, notes, and drafts are private to the teacher.
- Administrators do not read teacher preferences without an audited reason.

**Account deletion.**

- A student may request deletion of their identifiable data through their teacher or through LyfeLabz support.
- Deletion redacts identifying fields on submissions and enrollments rather than destroying the records, so classroom aggregates remain consistent. Fully destructive deletion is available for legal requests through an audited path.

**Data retention.**

- Active-year submissions are retained through the school year.
- Archived-class submissions are retained for a defined period, then redacted.
- Audit logs are retained separately with their own retention (see PDR-013).

**Recommended Version 1 retention defaults.** These values are tunable and are not on the formal-review list. They are the concrete numbers that should ship in Version 1 unless a documented alternative is chosen.

- Active-year submissions: retained live through the end of the school year in which they were finalized.
- Finalized submissions in archived classes: retained live for **three (3) years** from the class's archival date, then redacted (identifying fields cleared, structural record preserved).
- Fully-redacted submissions: retained indefinitely for aggregate integrity, without identifying fields.
- Enrollment records: retained live for **three (3) years** after enrollment ends, then redacted.
- Archived classes: retained live for **five (5) years** from archival, then metadata-only.
- User records: retained live while the user is active, then archived on the same schedule as their most recent class.
- Audit events: see PDR-013.

**Guardian considerations.**

- Parent accounts are a future capability with explicit per-student consent.
- Until parent accounts exist, guardian access to a student's LyfeLabz data is provided by the student themselves or by the teacher on request. Platform Administrators do not disclose student data to third parties, including guardians, without an audited process.

**Third-party integrations.**

- No student data leaves the platform without an explicit per-integration approval documented as a decision record.
- AI providers, analytics providers, and error-reporting providers are all in scope for this rule.

### Rationale

Minimization is the strongest privacy control. It is cheaper than anonymization, more legible to auditors, and easier for future contributors to preserve. Redaction over deletion preserves classroom continuity while satisfying the substantive privacy interest.

### Consequences

Benefits:

- Regulatory posture is defensible from day one.
- Data model is simpler because there is less data.
- Third-party integrations are gated by a documented decision, not by developer discretion.

Limitations:

- Some product ideas (behavioral analytics, engagement scoring) are foreclosed.
- Guardian access is more constrained than at some LMS products, which will disappoint some parents.

### Future Reconsideration Criteria

Reconsider retention windows when longitudinal instructional value is documented and can be balanced against privacy exposure. Reconsider guardian access when parent accounts ship with an explicit consent model.

---

## PDR-012: Security

### Decision

Security is a design property enforced by least privilege, ownership-based access, and server-side authority for high-value operations. Every privileged action produces an audit record. Security rules and Cloud Functions share responsibility for enforcing invariants.

### Status

Accepted.

### Background

The architecture review identified several security gaps: client-side write authority for submissions, missing rate limits, audit log integrity, and absent data classification. This record closes those gaps as architectural decisions.

### Alternatives Considered

- **Client-side writes with security rules only.** Rejected for high-value operations (see PDR-008).
- **Server-side everything.** Rejected: unnecessary infrastructure for reads and low-risk writes.

### Decision

**Least privilege.**

- Clients receive only the credentials required for their current role and view.
- Service accounts hold minimum scopes.
- Cross-class queries are structurally impossible for non-administrators.

**Ownership boundaries.**

- Every writable record has an owner set at creation.
- Ownership is immutable except through an audited admin path.
- Ownership is denormalized onto records where it enables efficient rule evaluation.

**Data classification.**

Three tiers:

- **Public.** Lesson content, homepage, non-personalized platform pages.
- **Class-scoped.** Curation, class metadata, enrollment records.
- **Sensitive.** Student identity, submissions, teacher preferences, audit logs.

Each tier has documented handling rules for storage, transit, logging, and third-party disclosure.

**Server-side authority.**

- Submission finalization: Cloud Function (see PDR-008).
- Join-code minting and validation: Cloud Function.
- Ownership transfers: Cloud Function with audit record.
- Role assignment and verification: Cloud Function with audit record.

**Audit logging.**

- Every privileged action produces an audit record with actor, action, target, and server timestamp.
- Audit records are written to a sink that is not readable or writable by application code (see PDR-013).
- Silent administrative actions are prohibited.

**Rate limiting.**

- Sign-in attempts, join-code guesses, and submission writes are rate-limited per identity, per IP, and per resource.
- Rate-limit violations produce audit records.

**Recommended Version 1 rate-limit defaults.** These are tunable operational values, not architectural decisions.

- Sign-in attempts: **10 per minute per IP**, **20 per hour per identity**.
- Join-code guesses: **5 per minute per authenticated user**, **20 per hour per authenticated user**. Repeated invalid attempts trigger a temporary lock and an audit event.
- Submission writes (finalization requests): **30 per minute per authenticated student**. Bulk operations exceeding this rate are treated as anomalous.
- Assignment publication writes: **60 per minute per teacher**.
- Audit-log reads by Platform Administrators: no rate limit, but every read is itself audited.

**Sessions.**

- Session length is set to a value appropriate for shared classroom devices.
- **Recommended Version 1 default: 12 hours** of idle-tolerant session, extended sliding by activity, with a hard maximum of **24 hours** since last authentication event. This matches a classroom day plus after-school work without becoming a security hazard on shared devices.
- Explicit logout clears session state immediately without a required network round trip.
- No impersonation. Ever.

**Support tooling.**

- Support tools are diagnostic, not impersonating. They read a user's state to help operators reason about it; they never assume the user's identity.

**Future security reviews.**

- Security rules and Cloud Functions receive an independent review at each major release.
- Third-party dependencies in client bundles are audited on a defined cadence.
- Penetration testing is scheduled at least once between Version 1 launch and the addition of the first district.

### Rationale

Server-side authority for high-value operations is the only way to make security rules and Cloud Functions each solve the problems they are good at. Data classification turns security from a checkbox into a design property with tiered handling.

### Consequences

Benefits:

- Privileged actions are auditable end to end.
- Security rules stay simple because they are not asked to enforce every invariant alone.
- Third-party disclosure is gated, not incidental.

Limitations:

- Cloud Functions become a required Version 1 component.
- Audit sink infrastructure is a real dependency.

### Future Reconsideration Criteria

Reconsider the classification tier list when a genuinely new data category emerges (e.g., voice recordings, video submissions).

---

## PDR-013: Operational Excellence

### Decision

Backups, disaster recovery, monitoring, error reporting, audit logs, support tooling, and documentation are Version 1 requirements, not optional enhancements. Each has a named owner and a tested procedure.

### Status

Accepted.

### Background

The architecture review flagged operational systems as the largest cluster of missing pieces. Ed-tech products that ship without them survive Version 1 and fail Version 2. This record commits to operational maturity at launch.

### Alternatives Considered

- **Add operations after launch.** Rejected: operational systems change data model choices and cannot be retrofitted cheaply.
- **Outsource operations to a third party.** Deferred: valuable at scale, unnecessary at Version 1.

### Decision

**Backups.**

- Firestore point-in-time recovery enabled from Version 1 launch.
- Daily off-project backup of Firestore to a separate storage bucket in a separate project.
- Retention: 30 days for daily backups, 1 year for month-end backups.

**Disaster recovery.**

- A written DR runbook covering total Firestore loss, total Hosting loss, and total Auth loss.
- Restore procedures rehearsed at least twice per year against a non-production project.
- Recovery time objective and recovery point objective are documented numbers, not adjectives.

**Monitoring.**

- Firestore read/write quotas and error rates.
- Auth error rates and sign-in latency.
- Cloud Function invocation counts, error rates, and cold-start latency.
- Hosting error rates and traffic.
- Client-side error rate (see error reporting).
- Alerts route to an on-call channel with a documented response expectation.

**Error reporting.**

- Structured client-side error capture with student PII stripped at source.
- Server-side error aggregation.
- Error dashboards reviewed on a documented cadence.

**Audit logs.**

- The Firestore `auditEvents` collection **is** the platform's append-only audit sink. Its append-only property is enforced by Security Rules that permit `create` from trusted server context only and that forbid `update` and `delete` for every role, including Platform Administrator.
- Application code (client-side, and non-audit server code) cannot read or write `auditEvents`. Reads are permitted only through Platform Administrator surfaces, and every read of `auditEvents` itself produces a further audit event.
- **Recommended Version 1 retention:** live retention of **24 months** in `auditEvents`. On a scheduled cadence, events older than 24 months are exported to a cold-storage bucket (retention **5 years**, then destroyed) and pruned from the live collection. The exported records are a mirror for retention; they are not a second authoritative sink.
- Retention for legally significant actions (role changes, ownership transfers, retention actions, emergency access) is **7 years** live plus indefinite cold storage.
- Access to audit logs is itself audited.

**Support tools.**

- Diagnostic-only, no impersonation (see PDR-012).
- Every support action produces an audit record.
- Support workflows are documented as runbooks.

**Documentation.**

- Architecture documents (this document and its companions) are canonical.
- Runbooks for the top 10 operational scenarios exist before launch.
- Security rules are documented alongside their code.
- Teacher-facing help exists before launch.
- Contributor onboarding documentation exists before the second contributor joins.

### Rationale

Every one of these systems has a data-model implication. Deferring them past implementation start guarantees rework. Naming them as Version 1 requirements is the cheapest time to commit.

### Consequences

Benefits:

- The platform can be operated by a small team without heroics.
- Incidents have documented responses.
- Restores have been rehearsed before they are needed.

Limitations:

- Version 1 launch takes longer than it would without these commitments.
- Some infrastructure costs begin before revenue.

### Future Reconsideration Criteria

Individual retention or cadence numbers may be tuned based on observed usage. The commitment that these systems exist at Version 1 is not negotiable.

---

## PDR-014: Deployment Philosophy

### Decision

Deployment is boring on purpose. Three Firebase projects (development via emulators, testing, production). GitHub as single source of truth. Every deployment originates from a tagged commit on main. Production deploys require a green testing deploy and a deliberate promotion. Rollback is one action.

### Status

Accepted.

### Background

Deployment failures at a classroom product happen during school hours and affect real classrooms. Predictability matters more than speed.

### Alternatives Considered

- **Continuous deployment to production.** Rejected: unacceptable blast radius during school hours.
- **Manual deploys from developer machines.** Rejected: no auditable trail.
- **Staging environment from day one.** Deferred: introduced when release cadence justifies it.

### Decision

**Environments.**

- Development: local emulators for Auth, Firestore, Hosting, and Functions.
- Testing: dedicated Firebase project mirroring production configuration. No real student data.
- Production: single live Firebase project on the custom domain.
- Staging: added when release cadence justifies it.

**Source of truth.**

- GitHub. Pull requests are the only path to main.

**CI gates.**

- Build, lint, accessibility checks, unit tests, and security-rules tests must pass.

**Deploy workflow.**

- Merge to main triggers a testing deploy.
- Production promotion is a deliberate action gated on a green testing deploy.
- No manual production deploys from developer machines.

**Rollback.**

- Firebase Hosting release history for the static surface: one-click rollback.
- Cloud Functions deploys revertible to prior version.
- Security rules versioned in git, rollback is a re-deploy of the prior version.
- Firestore schema changes are additive; destructive changes require a documented, paired backup.

**Feature flags.**

- A real flag system is available at Version 1 for grade rollouts and staged feature releases.
- Flags default off. Flags decommissioned within a documented window after full rollout.

**Release cadence.**

- Predictable weekly promotions during the school year, with a documented moratorium during high-risk classroom windows (state testing weeks, first two weeks of school).

**Access control.**

- Production deploys are restricted to a named list of maintainers.
- Security rules deploys receive an independent review.

### Rationale

Boring deploys are cheap. Exciting deploys are expensive. Every gate above has prevented a real incident at a real product.

### Consequences

Benefits:

- Predictable classroom experience.
- Auditable release history.
- Fast rollback when needed.

Limitations:

- Slower iteration than continuous deployment.
- Feature flags add complexity.

### Future Reconsideration Criteria

Reconsider cadence when a staging environment is added or when a district commits to LyfeLabz.

---

## PDR-015: Future Expansion Philosophy

### Decision

Every future expansion is architecturally reachable from today's decisions. No future expansion is a commitment. Each is enabled by a specific present-day decision and gated on documented demand.

### Status

Future Consideration for each item; framework Accepted.

### Background

Roadmap items in the architecture document represent possible futures. Some are cheap to enable now, others require substantive present-day decisions. This record commits to which present-day decisions are made to keep each future reachable.

### Alternatives Considered

- **Design each future expansion in detail now.** Rejected: speculative complexity.
- **Ignore future expansions.** Rejected: cheap enabling decisions are worth making now.

### Decision

**District deployments.** Enabled by school and district identifiers being first-class references from day one, even when only one school is live. Reconsidered when the first district commits.

**Google Classroom integration.** Enabled by enrollment being a source-aware operation (join code, roster sync, manual invite) so roster sync is additive. Ratification of `LMS_INTEGRATION_ARCHITECTURE.md` and `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` records the canonical architecture. Implementation is authorized under PDR-020 (LMS Phase Re-Sequencing and Initial Scope), which supersedes the prior Phase 8 gating for the narrow initial scope named in PDR-020. Google Classroom is the initial implementation target under PDR-019h; provider neutrality is preserved as a permanent architectural property.

**Canvas integration.** Enabled by identity abstraction and stable class identifiers. Reconsidered when demand is documented. Any Canvas integration inherits the vendor-neutral architecture recorded in `LMS_INTEGRATION_ARCHITECTURE.md` and is added as a second adapter under PDR-019; it does not rewrite the core.

**Parent accounts.** Enabled by ownership-first data design and by attaching a consent object to the student record so parent access is additive.

**AI tutoring.** Enabled by keeping AI behind a service interface so AI availability is never load-bearing for the lesson. Data-boundary rule (PDR-011) governs what may be sent to AI providers.

**AI feedback.** Same enabling as AI tutoring. Feedback is advisory, never authoritative; teacher judgment remains primary.

**AI lesson recommendations.** Enabled by stable lesson identifiers and standards attribution.

**Custom teacher-created content.** Enabled by the canonical lesson architecture rules in CLAUDE.md. Content moderation and quality-review model are deferred to their own future decision record.

**Standards reporting.** Enabled by standards attribution being present on submissions, not derived at report time. This requires that lessons and submissions capture standards references as data.

### Rationale

Cheap enabling decisions made now are dramatically cheaper than migrations later. Speculative design of each future is rejected because most of these futures will not happen and the ones that do will change shape before they arrive.

### Consequences

Benefits:

- Every listed future is reachable without a migration.
- No speculative complexity in Version 1.

Limitations:

- Some enabling decisions (district identifiers, standards attribution) impose a small ongoing tax.

### Future Reconsideration Criteria

Each expansion is reconsidered on documented demand, not on speculation.

---

## PDR-016: Accessibility and Mobile-First

### Decision

Every platform surface meets WCAG 2.1 AA as a floor and is designed mobile-first. There are no internal-tool exceptions. Accessibility and mobile fitness are treated as correctness, verified in CI.

### Status

Accepted.

### Background

The instructional repository holds itself to this bar. The platform must not weaken it. Ed-tech products that carve out "internal tool" exceptions for admin surfaces end up with those exceptions used by teachers.

### Alternatives Considered

- **Accessibility for student surfaces only.** Rejected: teachers use the platform in accessibility-relevant contexts too.
- **Mobile-second for teacher surfaces.** Rejected: teachers use phones during class transitions.

### Decision

- WCAG 2.1 AA on every surface.
- Mobile-first design starting at the smallest supported viewport.
- Canonical responsive breakpoints from CLAUDE.md govern the platform.
- CI verifies accessibility on every pull request.

### Rationale

Correctness verified in CI is correctness that persists. Correctness left to review inevitably slips.

### Consequences

Benefits:

- Consistent user experience for all users.
- Reduced legal and ethical exposure.
- Teacher usability during real classroom moments.

Limitations:

- Some design shortcuts foreclosed.
- CI infrastructure must include accessibility checks.

### Future Reconsideration Criteria

The bar rises when a new WCAG version is published. It does not fall.

---

## PDR-017: One Canonical Way

### Decision

Auth, data access, error handling, deployment, telemetry, and UI composition each have exactly one blessed pattern in the platform. Variations require a documented decision record.

### Status

Accepted.

### Background

Divergence multiplies maintenance cost. On small teams over long timescales, "there are three ways we do this" is the single largest maintainability drag.

### Alternatives Considered

- **Let each area evolve organically.** Rejected: guarantees drift.
- **Freeze all patterns.** Rejected: prevents genuine improvement.

### Decision

- Each cross-cutting concern has a documented canonical pattern.
- Variations require a written decision.
- The list of canonical patterns is maintained alongside this document.

### Rationale

Documented divergence is manageable. Undocumented divergence is not.

### Consequences

Benefits:

- New contributors have exactly one right answer.
- Refactors touch known places.
- Code review becomes simpler.

Limitations:

- Genuine improvements require the friction of a decision record.

### Future Reconsideration Criteria

Each canonical pattern is reconsidered when a documented cost or defect justifies it.

---

## Architectural Decisions That Must Not Change Without Formal Review

The following decisions are foundational. Each is load-bearing for LyfeLabz's identity, integrity, or safety. Changing any of them touches every part of the platform.

Formal review, in this context, means:

- a written decision record superseding the current one,
- an assessment of impact on data, security, and instructional philosophy,
- explicit acknowledgment from the platform's owner.

**Foundational decisions:**

1. **Platform identity (PDR-001).**
   Foundational because every subsequent decision is measured against it.
   Risk of change: LyfeLabz becomes indistinguishable from LMS competitors.
   Evidence that would justify revisiting: a redefinition of LyfeLabz's mission by its owners.

2. **Lessons remain permanent, public, and independent (PDR-007).**
   Foundational because it protects the instructional inheritance.
   Risk of change: public URLs break, offline caching fails, and the "home base" principle collapses.
   Evidence: a fundamental reorganization of the instructional repository.

3. **Submission immutability and Cloud Function finalization (PDR-008).**
   Foundational because it protects the highest-value data on the platform.
   Risk of change: historical submissions become unreliable; assessment trust collapses.
   Evidence: a legally required deletion pathway (which would be additive, not a replacement).

4. **Ownership immutability (PDR-005, PDR-012).**
   Foundational because it is the base of the security model.
   Risk of change: security rules become ambiguous; support incidents multiply.
   Evidence: none currently anticipated.

5. **Closed role model (PDR-004).**
   Foundational because it keeps authorization tractable.
   Risk of change: security rule complexity grows without bound.
   Evidence: a capability that genuinely cannot be expressed within an existing role.

6. **Curation, not assignment (PDR-010).**
   Foundational because it is the structural expression of the platform's identity.
   Risk of change: LyfeLabz drifts into being an LMS.
   Evidence: none. This decision does not become negotiable.

7. **Privacy posture (PDR-011).**
   Foundational because it is the platform's legal and ethical baseline.
   Risk of change: regulatory exposure, loss of trust.
   Evidence: a change in applicable law, applied additively.

8. **No impersonation (PDR-012).**
   Foundational because it is a permanent trust commitment.
   Risk of change: support incidents become privacy incidents; audit records become deniable.
   Evidence: none currently anticipated.

9. **Stable lesson identifiers governed by the safe-rename checklist (PDR-009).**
   Foundational because every submission and assignment references lessons by identifier.
   Risk of change: silent breakage of historical attribution.
   Evidence: a fundamental reorganization of the instructional repository.

10. **Additive schema evolution.**
    Foundational because destructive migrations at scale are dangerous.
    Risk of change: past data becomes unreadable or requires expensive migrations.
    Evidence: a specific, documented, backed-up, rehearsed migration plan for a specific, one-time case.

11. **Accessibility and mobile-first as correctness (PDR-016).**
    Foundational because platform surfaces are used by the same students and teachers as the lessons.
    Risk of change: legal exposure, loss of trust, exclusion of users.
    Evidence: none. The bar rises; it does not fall.

12. **Boring deployment (PDR-014).**
    Foundational because deploy failures affect real classroom minutes.
    Risk of change: outages during school hours.
    Evidence: a demonstrated pattern of low-risk changes that could safely bypass a gate.

These twelve are the platform's constitutional layer. Every other decision may evolve through the normal decision-record process. These may evolve only through formal review with explicit ownership acknowledgment.

---

## PDR-018: Teacher Experience Surface Boundaries

### Decision

LyfeLabz complements existing LMS and SIS platforms rather than replacing them. Present Mode uses the canonical original LyfeLabz curriculum experience, not a parallel implementation. Resource activation controls student access only. Present Mode remains unrestricted for teachers.

### Status

Accepted.

### Background

The teacher experience direction was clarified through educator-centered UX planning ahead of Sprint 6C. Three sub-decisions have architectural weight because they name what the teacher platform is not, in the same way PDR-001 named what the platform is not. Naming them here prevents future sprints from silently redefining the teacher surface.

Placement rationale. `TEACHER_EXPERIENCE_PHILOSOPHY.md` records the full teacher-experience philosophy. This record captures only the three sub-decisions that carry PDR-weight because they:

- constrain the identity of the product (LMS/SIS boundary),
- constrain the structure of an entire surface family (Present Mode),
- constrain the semantics of a load-bearing teacher control (activation).

Recording them alongside PDR-001, PDR-007, and PDR-010 keeps the "why did we choose this?" answer in the canonical decision log rather than dispersing it across roadmap and philosophy documents.

### Alternatives Considered

- **Fold these into a future sprint specification.** Rejected: sprint specifications are implementation artifacts; identity-level commitments belong here.
- **Record them only in `TEACHER_EXPERIENCE_PHILOSOPHY.md`.** Rejected: philosophy documents describe intent; PDRs record locked commitments with reconsideration criteria.
- **Add each sub-decision as its own PDR.** Rejected as needlessly granular; the three sub-decisions share a single motivating principle (teacher surface boundaries) and are naturally read together.

### Decision

**PDR-018a. LyfeLabz complements existing LMS and SIS platforms.**

- LyfeLabz manages instruction; the district's LMS (typically Google Classroom) manages assignment communication where present.
- LyfeLabz collects mastery evidence; the district's SIS (typically PowerSchool) remains the gradebook of record.
- LyfeLabz never publishes itself as an LMS or SIS replacement to schools.

**PDR-018b. Present Mode uses the canonical original LyfeLabz curriculum experience.**

- Present Mode restores the original curriculum surface at the repository root, including the existing grade and topic filter box, the lesson-card organization, and normal student-facing lesson navigation.
- No parallel curriculum implementation exists for Present Mode.
- Improvements to the canonical curriculum surface automatically benefit Present Mode.

**PDR-018c. Resource activation controls student access only. Present Mode remains unrestricted for teachers.**

- Teacher-controlled activation determines whether a resource is available to students in the activating class.
- Activation does not affect teacher preview or teacher presentation.
- All curriculum resources remain available in Present Mode regardless of activation status.
- Present Mode never loads student names, scores, accommodations, class data, assignment-management controls, teacher notes, or private teacher settings. The restriction is enforced by entry-point design, not by conditional rendering inside a shared surface.

### Rationale

Each sub-decision closes a specific class of drift.

- 018a prevents the platform from being marketed or built as an LMS/SIS substitute. It is the natural extension of PDR-001 into the surface layer.
- 018b prevents the emergence of a Present-Mode-specific curriculum implementation, which would silently violate PDR-007 and PDR-017.
- 018c prevents the emergence of two different curation semantics (one for students, one for teachers) and prevents Present Mode from becoming a teacher-tools shell in disguise.

### Consequences

Benefits:

- One canonical curriculum experience serves teacher browsing, presentation, and student access.
- Teachers retain unrestricted access to the full LyfeLabz curriculum for planning and presentation.
- Student privacy in classroom presentation contexts is protected by a genuine surface boundary, not by CSS.
- Marketing and positioning stay unambiguous.

Limitations:

- Feature requests to add LMS-style gradebook, communication, or SIS-style rostering are declined and referred back to the district system.
- Present Mode cannot show teacher analytics inline; teachers switch surfaces to see teacher-only data.
- The teacher-facing verb for activation must be reconciled with PDR-010's terminology amendment when the Assignment domain UI sprint begins (see §5 of `TEACHER_EXPERIENCE_PHILOSOPHY.md`).

### Future Reconsideration Criteria

- 018a reconsidered only if LyfeLabz's mission is redefined by its owners (see PDR-001).
- 018b reconsidered only if the canonical curriculum surface itself is fundamentally reorganized (see PDR-007).
- 018c reconsidered only if a new documented use case cannot be expressed without loosening one of the three constraints. Growth pressure alone is not sufficient.

---

## PDR-019: LMS Integration Posture

### Decision

LyfeLabz integrates with external learning management systems as a complement, never as a replacement. LMS integration is a vendor-neutral extension of the certified domains, opt-in per teacher, per class, and per action, manual-first, and server-authoritative. Google Classroom is the initial provider. The canonical architecture is recorded in `LMS_INTEGRATION_ARCHITECTURE.md`, its teacher-facing shape in `LMS_EXPERIENCE.md`, and the ratified amendments to the certified architecture in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`.

### Status

Accepted. Load-bearing posture for every LMS integration LyfeLabz will ever ship. Implementation of the narrow initial scope described in PDR-020 is authorized under that record. The load-bearing sub-decisions in this record (complement not replace, authority boundaries, manual-first, one-way publication, server-only tokens, no new roles, additive schema, vendor-neutral core, class-scoped enrollment source, ownership never silently reassigns, privacy not widened, Present Mode not touched) are unchanged by PDR-020 and remain the permanent guardrails of every LMS sprint.

### Background

PDR-015 records Google Classroom and Canvas integrations as reachable-but-deferred capabilities. PDR-018a records that LyfeLabz complements existing LMS and SIS platforms rather than replacing them. `TEACHER_EXPERIENCE_PHILOSOPHY.md` §4.7 anticipates a dedicated integration architecture pass gated on documented demand. During Sprint 7 planning, an ad hoc Google Classroom import proposal was correctly rejected because the certified architecture required a formal integration architecture first.

The correct response was to author that architecture, review its risks, and reconcile the certified documentation. `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_EXPERIENCE.md`, and `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` do that work. This record captures the load-bearing posture the platform adopts as a result.

The posture is small in principle. It is large in scope, because it touches roadmap ordering, the Firestore Data Model, the Firebase Security Model, the Cloud Function Charter, the Platform Contracts, and several teacher-facing product documents. Recording the posture as a dedicated PDR closes a class of drift attempts: "the integration is different, so PDR-X does not apply." Every rule the integration inherits from PDR-004, PDR-005, PDR-010, PDR-011, PDR-012, PDR-015, PDR-017, and PDR-018 is re-anchored here so a future contributor cannot claim ambiguity.

### Alternatives Considered

- **Fold the integration posture into PDR-015 alone.** Rejected. PDR-015 is a framework record about reachable expansions. The integration surface requires its own load-bearing rules that outlast the reconsideration criterion.
- **Add the posture to `TEACHER_EXPERIENCE_PHILOSOPHY.md` only.** Rejected. Philosophy documents describe intent; PDRs record locked commitments with reconsideration criteria. The complement-not-replace commitment is identity-level and belongs in the decision log alongside PDR-001 and PDR-018.
- **Author a separate PDR per sub-decision (server-only tokens, manual-first synchronization, one-way publication, no new roles).** Rejected as needlessly granular. The sub-decisions share a single motivating principle and are naturally read together.
- **Defer authoring any PDR until the LMS phase begins.** Rejected. Ratifying the posture now is what makes the phase schedulable. Deferring it would recreate the ambiguity Sprint 7 exposed.

### Decision

**PDR-019a. Complement, do not replace.**

- LyfeLabz complements the connected LMS. It never replaces it.
- This is PDR-018a extended into the integration surface. Where PDR-018a and PDR-019a appear to conflict, PDR-018a controls and this record is amended.
- LyfeLabz never markets itself as an LMS replacement, and no LMS integration sprint may propose surfaces that would move LyfeLabz toward being one.

**PDR-019b. Authority boundaries.**

- The LMS is authoritative for classroom identity, teacher ownership, and roster.
- LyfeLabz is authoritative for LyfeLabz assignments, Practice/Classroom mode, Present Mode, Snapshot, and every learning interaction.
- Conflicts between the LMS and the LyfeLabz mirror resolve through this rule. The mirror is never authoritative for the upstream, and the upstream is never authoritative for LyfeLabz-owned surfaces.

**PDR-019c. Manual before automatic.**

- Manual import and manual refresh are the Version 1 integration posture.
- Automatic synchronization is a deferred, opt-in, reversible extension. It is never the default and it never ships silently.
- Reconsideration of the automatic posture requires an amendment to `LMS_INTEGRATION_ARCHITECTURE.md`.

**PDR-019d. One-way publication.**

- LyfeLabz publishes to the LMS. The LMS never authors a LyfeLabz assignment record.
- Publication is a side effect of the LyfeLabz assignment, not an alternate assign path. The Assign Experience remains the single canonical origin of assignment records.
- Bidirectional publication is deliberately not on the roadmap and requires its own decision record.

**PDR-019e. Server-only tokens.**

- OAuth access tokens and refresh tokens are held server-side only.
- Clients never hold, transmit, or observe an LMS token.
- Token storage, rotation, and revocation are Cloud Function Charter concerns.

**PDR-019f. No new roles, claims, or lifecycle fields.**

- LMS integration introduces no new user role, no new custom claim key (`role` and `schoolId` remain the only claim keys), and no new authoritative lifecycle field on `users/{uid}`, `classes/{classId}`, `enrollments/{enrollmentId}`, `assignments/{assignmentId}`, or `submissions/{submissionId}`.
- The closed role model in PDR-004, the lifecycle model in `PLATFORM_STATE_MACHINE.md`, and the claim shape in the Cloud Function Charter are unchanged.

**PDR-019g. Additive schema evolution.**

- Every Firestore change introduced by LMS integration is additive per the foundational "additive schema evolution" commitment recorded in this document.
- No existing collection is renamed, restructured, or relocated. No existing field is renamed.
- The mirror collections (`lmsProviders`, `lmsConnections`, `lmsClassLinks`, `lmsRosterLinks`, `lmsAssignmentPublications`) are subordinate to the certified records they mirror.

**PDR-019h. Vendor-neutral core, vendor-specific edges.**

- The platform surface (session, callables, storage, security) speaks in LyfeLabz concepts.
- The LMS-specific adapter translates. A second LMS is added by writing a second adapter; it never rewrites the core.
- Google Classroom is the first implementation target. Canvas, Schoology, and Teams for Education are reserved as future targets under PDR-015's reconsideration criteria.

**PDR-019i. Enrollment source is a class property.**

- A class is either LMS-linked or not. A teacher who imports a class through the LMS may not use join codes for that class.
- Redeeming a join code against a linked class is refused server-side with a plain-language error.
- Unlinking a class returns it to the join-code path and preserves the historical mirror for audit. Unlinking never deletes an enrollment record.

**PDR-019j. Ownership never silently reassigns.**

- If the LyfeLabz-owning teacher is no longer the LMS teacher of record, the mirror connection becomes stale and the teacher sees a plain-language message.
- LyfeLabz never reassigns class ownership in response to an LMS change. Ownership transfers remain the audited Platform Administrator path recorded by PDR-005.

**PDR-019k. Privacy is not widened.**

- LMS integration does not widen the PDR-011 collection surface.
- The exclusion list in `LMS_INTEGRATION_ARCHITECTURE.md` §9.4 is load-bearing. Guardian contact information, LMS-computed grades, disciplinary records, attendance records, non-LyfeLabz submissions, teacher LMS notes, and LMS announcements are never copied.

**PDR-019l. Present Mode is not touched.**

- Present Mode remains a structurally separate surface with no Firebase SDK on the canonical instructional origin.
- No LMS token, OAuth flow, LMS bundle, or LMS-scoped payload reaches the canonical origin.
- This preserves PDR-018b and PDR-018c.

### Rationale

The dedicated posture closes drift by naming which certified decisions the integration inherits and which sub-decisions are unique to it. It also makes reconsideration criteria explicit: the integration surface can grow as documented demand accumulates, but the load-bearing rules (complement not replace, manual first, one-way publication, server-only tokens, no new roles) are foundational.

Naming the posture at the decision-log level is the natural extension of PDR-018 into the integration surface. PDR-018 named what the teacher platform is not; PDR-019 names what the LMS integration is not. Both records preserve identity across future sprints.

### Consequences

Benefits:

- Every LMS integration decision has a canonical anchor. Future sprints locate themselves inside PDR-019 before proposing surface shape.
- The certified domains (Identity, Schools, Teachers, Classrooms, Enrollments, Assignments, Submissions, Analytics, Administrator Platform) remain unchanged in identity.
- Vendor neutrality is preserved permanently. A second LMS ships as a second adapter, not as an architectural rewrite.
- Teacher trust is preserved: no silent import, no silent refresh, no silent grade export, no silent ownership reassignment.
- The teacher who does not use an LMS sees no change to any workflow. The join-code enrollment path remains the default.

Limitations:

- Some feature requests (automatic synchronization at Version 1, LMS-authored LyfeLabz assignments, LMS grade export as a first-class LyfeLabz surface) are declined and referred to their own future decision records.
- Multi-account teachers (two Google Workspace identities) hold two LyfeLabz identities. Merging identities remains a PDR-004 concern.
- LMS integration is scheduled ahead of Phase 8 under PDR-020 for the narrow initial scope named there. Every load-bearing sub-decision in this record (a through l) applies to the initial scope without exception.

### Future Reconsideration Criteria

- **PDR-019a** reconsidered only if PDR-001 or PDR-018a is redefined by the platform's owners.
- **PDR-019b** reconsidered only when a new upstream system (SIS, district identity provider) requires a load-bearing authority reassignment. Any change is authored as an amendment to `LMS_INTEGRATION_ARCHITECTURE.md`.
- **PDR-019c** reconsidered when manual synchronization has been used at scale and its edge cases are known. Automatic synchronization requires an amendment to `LMS_INTEGRATION_ARCHITECTURE.md`.
- **PDR-019d** reconsidered only through a new decision record specifically authorizing bidirectional publication. It does not become negotiable through implementation.
- **PDR-019e** reconsidered only if the Cloud Function Charter's server-only trust boundary itself is redefined.
- **PDR-019f** and **PDR-019g** reconsidered only through the formal-review path already required for changes to PDR-004 and to the additive schema evolution commitment.
- **PDR-019h** reconsidered only if a second provider's identity or API model requires a rewrite of the core rather than an adapter. Growth pressure alone is not sufficient.
- **PDR-019i** reconsidered only when a proven, staged, reversible dual-source enrollment path is authored. Growth pressure alone is not sufficient.
- **PDR-019j** reconsidered only if PDR-005's ownership immutability is redefined.
- **PDR-019k** reconsidered only under a change to PDR-011.
- **PDR-019l** reconsidered only if PDR-018b or PDR-018c is redefined.

Reconsideration of any PDR-019 sub-decision requires the same level of scrutiny as its parent PDR.

---

## PDR-020: LMS Phase Re-Sequencing and Initial Scope

### Decision

The LMS Integration Foundation phase is advanced ahead of the Administrator Platform phase for a narrow, defined initial scope. Google Classroom is formally authorized as the initial LMS implementation target. Provider neutrality remains a permanent architectural property; Google Classroom being first is an implementation decision, not an architectural limitation.

### Status

Accepted. Authorizes implementation of the initial scope named below. Every load-bearing decision in PDR-019 continues to apply without exception.

### Background

`TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §4 originally sequenced Phase 9 (LMS Integration Foundation) strictly after Phase 8 (Administrator Platform). `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` §7 listed Phase 5 (Assignment Foundation) and Phase 6 (Submission Foundation) certification, along with several operational prerequisites, as gates on implementation. That sequencing was correct at the moment PDR-019 was ratified.

Product priorities have since changed. The Teacher Platform is preparing for a pilot in which teacher onboarding is meaningfully improved by importing existing Google Classroom classes rather than reconstructing them by hand. Leadership has approved advancing a narrowly scoped LMS Foundation ahead of the Administrator Platform on the following observations:

- Teacher onboarding for pilot schools is the load-bearing adoption moment. Reducing setup friction at the point of first classroom construction has an outsized effect on whether the pilot succeeds.
- Phase 8 (Administrator Platform) is the operational partner to the Teacher Platform. Its surfaces consolidate administrative work that today happens through direct callable invocation. Nothing in Phase 8 is a technical prerequisite for LMS class discovery or LMS class import.
- Phase 7 (Analytics) is a derived, read-side domain that consumes upstream records. Nothing in Phase 7 is a technical prerequisite for the initial LMS scope.
- Phases 5 (Assignment Foundation) and 6 (Submission Foundation) own the record shapes the LMS integration extends. Those phases have been certified complete and their exit criteria hold.

Advancing Phase 9 before Phase 8 is therefore an implementation-sequence decision, not an architectural change. The certified domain chain remains linear; the order in which the domains ship is the concern of this record.

### Alternatives Considered

- **Preserve the original Phase 8 gate and defer the pilot.** Rejected. Teacher onboarding is the pilot's load-bearing moment. Deferring LMS integration would reshape the pilot around a compensating manual workflow that does not exist today.
- **Ship a Google-specific integration outside the vendor-neutral core to move faster.** Rejected. Provider neutrality is preserved under PDR-019h as a permanent architectural property. A Google-only implementation would require rewriting the core when the second provider ships and would violate PDR-017's one-canonical-way commitment.
- **Ship a broader initial scope (roster sync, assignment publication, refresh) alongside class import.** Rejected. Manual-first synchronization is preserved under PDR-019c. A broader initial scope would concentrate multiple novel surfaces in one release, raise the review burden past what a pilot can absorb, and create pressure to relax PDR-019c's manual-first commitment.
- **Bundle Phase 8 into the pilot.** Rejected. Phase 8 is a substantial phase in its own right. Bundling would delay the pilot and introduce concurrent domain churn without a pilot-side justification.

### Decision

**PDR-020a. Google Classroom as the initial implementation target.**

- Google Classroom is formally authorized as the first LMS implementation. It is chosen because the target market is already on Google Workspace for Education, because Google Classroom's roster and assignment concepts translate cleanly to LyfeLabz's certified concepts, and because the OAuth prompt is an expansion of a trust relationship the teacher already has under PDR-002.
- Google Classroom being first is an implementation decision. It is not an architectural limitation. The platform remains vendor-neutral under PDR-019h. A second LMS ships as a second adapter, not as a rewrite of the core.

**PDR-020b. Phase 9 is scheduled ahead of Phase 8.**

- Phase 9 (LMS Integration Foundation) is scheduled to begin before Phase 8 (Administrator Platform).
- The certified domain chain in `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §2 is not reordered. Phase 8 remains defined and reachable in its own right.
- Advancing Phase 9 does not delete, compress, or redefine Phase 8. Administrator surfaces continue to be delivered as recorded in `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §4 (Phase 8), on their own sequence, after Phase 9's initial scope certifies.

**PDR-020c. Approved initial scope.**

The initial LMS scope authorized by this record contains only:

- provider abstraction,
- provider registry,
- connection lifecycle,
- secure infrastructure,
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

Every excluded capability remains reachable as its own subsequent sprint under the internal Phase 9 sequence recorded in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` §8. Each excluded capability requires its own sprint specification. No excluded capability may be introduced by an implementation sprint that authorizes only the initial scope.

**PDR-020d. Administrator Platform remains defined.**

- Phase 8 (Administrator Platform) is not a prerequisite for the initial LMS scope. It remains defined and scheduled as a subsequent phase.
- The absence of the Administrator Platform is not a substitute for administrative operations. Administrative operations continue to run through the callables already established in Phases 1 through 7, exactly as they do today.

**PDR-020e. Analytics remains defined.**

- Phase 7 (Analytics) is not a prerequisite for the initial LMS scope. Analytics reads across upstream records; it does not gate LMS class discovery or LMS class import.

**PDR-020f. Provider neutrality is permanent.**

- No Google-specific decision made under PDR-020 is permitted to become an architectural fact.
- Every provider-specific concern lives inside the provider adapter; every provider-neutral concern lives inside the core.
- A second LMS is added by writing a second adapter. It never rewrites the core. This is PDR-019h restated to prevent regression under implementation pressure.

**PDR-020g. External systems remain authoritative for information they own.**

- This principle is elevated to a permanent architectural rule. The connected LMS is authoritative for classroom identity, teacher ownership, enrollment, and roster. LyfeLabz is authoritative for instructional workflow, Present Mode, Snapshot, Assign, and every learning interaction.
- Implementation never blurs these ownership boundaries. A mirror record never asserts authority over the upstream system. An upstream system never authors a LyfeLabz-owned record.

**PDR-020h. Load-bearing PDR-019 sub-decisions remain in force.**

- Every sub-decision in PDR-019 (a through l) applies to the initial scope without exception.
- Where PDR-020 and PDR-019 appear to conflict, PDR-019 controls and this record is amended.
- Where the LMS integration architecture and PDR-020 appear to conflict, the architecture controls and this record is amended.

### Rationale

Recording the re-sequencing as a dedicated PDR closes a class of drift attempts: "the LMS phase moved, so PDR-X no longer applies." Naming the initial scope explicitly prevents the sprint that lands class discovery and class import from silently expanding into roster synchronization, publication, or automatic refresh. Naming Google Classroom explicitly, while restating provider neutrality as permanent, prevents a future contributor from reading "Google Classroom is first" as "Google Classroom is the architecture."

The re-sequencing is a product-priority decision. The architecture does not change. Every load-bearing rule in PDR-019 continues to apply. Every certified domain retains its ownership. The vendor-neutral core, the server trust boundary, the one-way publication rule, the manual-first synchronization posture, and the class-scoped enrollment-source rule are all preserved.

### Consequences

Benefits:

- The pilot is unblocked at the load-bearing onboarding moment.
- Teachers who already use Google Classroom can bring their classes into LyfeLabz without reconstructing them by hand.
- The initial scope is narrow enough to review, certify, and operate without concentrating multiple novel surfaces in one release.
- Provider neutrality remains a permanent architectural property.
- Phase 8 remains defined and reachable; its scope is not compressed.

Limitations:

- Administrative work continues to run through direct callable invocation until Phase 8 certifies. This is a preservation of the current state, not a regression.
- Roster synchronization, assignment publication, refresh, and every excluded capability remains unavailable under the initial scope. Each remains reachable as its own subsequent sprint.
- The Google Cloud project OAuth client and its operational scaffolding must be provisioned before the first implementation sprint. This is recorded in the operational readiness section of `LMS_INTEGRATION_ARCHITECTURE.md`.

### Future Reconsideration Criteria

- **PDR-020a** reconsidered only when a second provider is formally authorized. A second provider does not remove Google Classroom as an initial target; it extends the provider set.
- **PDR-020b** reconsidered only if pilot priorities change materially before the initial scope ships. After the initial scope certifies, PDR-020b becomes historical.
- **PDR-020c** reconsidered only by an explicit expansion of the initial scope through a subsequent PDR or a subsequent sprint specification. Expansion by implementation is prohibited.
- **PDR-020d** and **PDR-020e** reconsidered only if Phase 8 or Phase 7 becomes a technical prerequisite for a subsequent LMS sprint. Neither is a prerequisite for the initial scope.
- **PDR-020f** reconsidered only if a second provider's identity or API model requires a rewrite of the core rather than an adapter. Growth pressure alone is not sufficient. This mirrors PDR-019h.
- **PDR-020g** reconsidered only if the authority boundary in PDR-019b is redefined.
- **PDR-020h** is not reconsidered; it is a restatement clause.

---

## PDR-021: Assessment Pipeline Architecture

### Decision

The formative assessment pipeline is defined by `ASSESSMENT_PIPELINE_SPECIFICATION.md` and comprises seven load-bearing sub-decisions recorded below. Together they specify how a LyfeLabz formative assessment is offered, taken, saved, submitted, scored, recorded, revised, and reported on.

### Status

Accepted. Ratified 2026-07-12 in the Sprint 9A Architecture Decision Workshop. Supersedes PDR-008 in part (see PDR-008 Sprint 9A Reconciliation Notice) and constrains every subsequent assessment-related sprint. Every load-bearing decision below is locked before Sprint 9B implementation begins.

### Background

Sprint 8 completed the LMS foundation on top of an assessment pipeline that had not yet ratified session lifecycle, revision boundary, scoring authority, feedback contract, mode surface, or per-class assignment rule. Ambiguity in those areas would compound as authenticated student traffic grows. Sprint 9A ratified the entire assessment pipeline before authenticated student traffic ships.

### Alternatives Considered

The specification records the alternatives considered for each sub-decision. This record aggregates the outcomes.

### Decision

**PDR-021a. Session and attempt are distinct entities.**

- A **session** is transient, resumable, autosaving working state. Sessions are never counted as attempts and never appear as attempts on any teacher-facing surface.
- An **attempt** is the authoritative, immutable record of a completed formative assessment. Attempts are created only after successful server-side submission.
- There is no separate Submission entity. The `submitted` state is a transient state inside the server-side submission transaction; it is never externally observable.
- Sessions expire on inactivity. Platform default: 24 hours after last activity. Configurable operational constant. Expired sessions are archived and are retained for a bounded recovery window before deletion. Recovery of an archived session returns it to the live state and does not itself produce an attempt.

**PDR-021b. Server-authoritative scoring; server-confidential answer keys.**

- Scoring is completely server-authoritative. The browser submits answers; the server computes the score, the item-level correctness, and the item-level points earned; the server stores the score; the browser displays only the score the server returns. No browser-authoritative score exists.
- Authoritative answer keys never reach the browser before submission. Cloud Functions perform grading. Only the scorer reads the answer key.
- Post-submission, the platform returns to the browser a specific, permitted feedback payload: the aggregate score, the correct answers to each item, and the item-level explanations. The client is responsible only for display.

**PDR-021c. Unlimited attempts, immutable history, teacher analytics.**

- Formative assessments allow unlimited attempts. Every submitted attempt is preserved. No attempt is overwritten.
- Teacher dashboards initially expose exactly five metrics per (student, assignment): **highest score, first score, latest score, attempt count, growth**. Additional analytics remain internal until a subsequent PDR authorizes exposure.

**PDR-021d. Platform-owned assessment revision boundary.**

- Teachers never manage assessment versions.
- The platform automatically creates an internal revision identifier when the assessment content changes in a way that would meaningfully affect scoring or student experience. Minor editorial corrections do not create a new revision.
- Revision identifiers are internal. They never appear on a teacher-facing surface or a student-facing surface.
- Every attempt records the internal revision identifier of the assessment at the moment of submission. Historical attempts remain interpretable across later revisions.

**PDR-021e. Practice / Classroom mode toggle is removed.**

- The authenticated platform no longer exposes a Practice / Classroom toggle on the student surface. Behavior derives automatically from authentication and authorization.
- Anonymous exploration replaces the surface that "Practice" used to name. Authenticated, authorized attempt replaces the surface that "Classroom" used to name. Neither name appears on the student surface.
- Anonymous interaction produces no session and no attempt. Anonymous quiz activity is deliberately not observable to LyfeLabz.

**PDR-021f. Assignment windows and grace period.**

- Assignment windows control who may begin an assessment. No new sessions begin after the close moment.
- Students already working when the window closed receive a one-hour grace period during which they may submit. The grace period does not authorize new sessions. Saved work in a live session remains preserved even if the student does not submit within the grace period.
- The one-hour grace period is a platform default and a configurable operational constant. Teachers do not set or override it.

**PDR-021g. One assignment belongs to exactly one class; canonical curriculum ownership.**

- Every assignment belongs to exactly one class. Assigning one activity to multiple classes automatically creates one assignment per class. Teachers experience this as one workflow; internally the platform holds N assignment records.
- Canonical curriculum - lessons, quizzes, extensions, investigations, simulations, challenges, answer keys, explanations, and standards alignment - is owned exclusively by the Platform Administrator. Teachers configure delivery but do not modify canonical curriculum. A future teacher suggestion workflow may be added; it is a suggestion pipeline, not authorization to write curriculum directly.

### Rationale

Recording the pipeline as a dedicated PDR closes a class of drift attempts and gives Sprint 9B implementation a stable target. Naming the session-attempt separation prevents future sprints from folding session state into the authoritative record. Naming the server-authoritative scoring rule prevents future sprints from admitting a client-side score field into the attempt document under any name. Naming the removed Practice / Classroom toggle prevents its reappearance under a different label. Naming the one-assignment-per-class rule prevents cross-class attempt records from being introduced under an ambiguous multi-class assignment shape.

### Consequences

Benefits:

- The assessment pipeline is ratified end-to-end before authenticated student traffic ships.
- Historical attempts remain defensible across curriculum evolution because every attempt carries an internal revision identifier.
- Student attempt history is uncapped, preserved, and immutable, satisfying the growth-over-completion posture.
- Teacher metrics are small, stable, and workflow-relevant, satisfying the minimize-cognitive-load principle.
- The client cannot fabricate or influence a score, satisfying the preserve-educational-integrity principle.

Limitations:

- Every scoring operation runs through a Cloud Function. Scorer outages block attempt creation; they do not block exploration or session autosave.
- The attempt collection grows without a per-student cap. Retention is governed by class-level historical retention.
- Teacher analytics are limited to five metrics at the initial release; expanding the teacher surface requires a subsequent PDR.

### Future Reconsideration Criteria

- **PDR-021a** reconsidered only if the session and attempt entities' distinct roles cease to model the workflow (for example, if the platform ever adopts a summative pipeline that unifies them - which is prohibited under Section 2 of the specification).
- **PDR-021b** reconsidered only if a compelling privacy or performance case is made against server scoring. Growth pressure is not sufficient.
- **PDR-021c** reconsidered only if the unlimited-attempt posture materially undermines educational integrity in observed practice, or if a teacher surface expansion is authorized through PDR-018.
- **PDR-021d** reconsidered only if teachers require version selection for a defensible educational reason (none has been named).
- **PDR-021e** reconsidered only if authentication or authorization semantics change materially. The toggle does not return under a rename.
- **PDR-021f** reconsidered only if the one-hour grace period proves operationally wrong; the value is a constant, not a policy.
- **PDR-021g** reconsidered only if the one-assignment-per-class rule proves incompatible with a future teacher workflow. Multi-class assignment surfaces remain a workflow-layer concern with a per-class record shape.

---

## PDR-022: Platform Operations Architecture

### Decision

The LyfeLabz platform operations architecture is defined by `PLATFORM_OPERATIONS_SPECIFICATION.md` and comprises the load-bearing sub-decisions recorded below. Together they specify how LyfeLabz is hosted, deployed, rolled back, maintained, monitored, and pilot-certified.

### Status

Accepted. Ratified 2026-07-12 in the Sprint 9B Architecture Decision Workshop. Supersedes PDR-014 in part (see PDR-014 Sprint 9B Reconciliation Notice) and constrains every subsequent operational decision. Every load-bearing decision below is locked before Sprint 9C implementation begins.

### Background

The pre-platform LyfeLabz curriculum has been served by GitHub Pages. Firebase has been the backend platform for authentication, data, storage, and future Cloud Functions. Sprint 9B ratified the migration to Firebase Hosting as the permanent canonical production origin, the three-environment architecture, the Certified Release model, and the Pilot Readiness Certification process. Prior operational statements distributed across the architecture document, PDR-014, and the Firebase build checklist are superseded to the extent they conflict with this decision.

### Alternatives Considered

- **Keep GitHub Pages as the permanent production origin.** Rejected: GitHub Pages does not support authenticated surfaces, Cloud Functions, or an approval-gated release pipeline. Preserving it as the origin would fragment the platform across two origins and reintroduce the surface boundary as a cross-origin concern.
- **Introduce a permanent subdomain (`app.lyfelabz.com`) for the authenticated platform.** Rejected: permanent subdomains complicate the surface boundary contract and introduce cross-origin authentication and cookie concerns without a corresponding benefit.
- **Skip a Preview environment for small changes.** Rejected: preview verification is a load-bearing gate. The failure modes it catches are exactly the failure modes small changes are assumed not to have.
- **Automate production promotion when preview verification is green.** Rejected: automated tests do not replace human approval for a classroom product. Explicit Platform Administrator approval remains the load-bearing human gate.
- **Introduce Staging from day one.** Deferred: Preview is sufficient until release cadence or concurrent workstreams justify a Staging environment. This restates PDR-014's staging posture.

### Decision

**PDR-022a. Firebase Hosting is the permanent canonical production origin.**

- `https://lyfelabz.com/` is the sole production origin.
- Firebase Hosting serves the public curriculum surface and the authenticated platform surface from a single origin under path-based routing.
- Permanent subdomains are not introduced.
- GitHub Pages is retained only as a migration safety net until the retirement criteria in `PLATFORM_OPERATIONS_SPECIFICATION.md` §23 are met.

**PDR-022b. LyfeLabz operates three permanent environments.**

- Development (local emulators), Preview (Firebase Hosting Preview Channels of the canonical origin, or a dedicated preview project mirroring production), and Production (`lyfelabz-platform`).
- No deployment moves directly from Development to Production. Every production release passes through Preview.
- A future Staging environment is introduced only when release cadence or concurrent workstreams justify it.

**PDR-022c. Certified Releases require the ten criteria of §12.**

- Architecture certified, documentation reconciled, implementation complete, local verification passed, security verification passed, operational documentation updated, preview deployment verified, Platform Administrator approval recorded, production deployment completed, and post-deployment health verified.
- Only Certified Releases are valid rollback targets.

**PDR-022d. Production deployment always requires explicit Platform Administrator approval.**

- Automated tests are required but never replace human approval.
- Approval is granted for a specific release candidate and is recorded in writing.
- Emergency deployments still require approval; compressed certification is recorded.

**PDR-022e. Rollback is the immediate response to a material production issue.**

- Rollback targets a previous Certified Release from Firebase Hosting's release history.
- Rollback is one action, performed by the Platform Administrator or an explicitly authorized on-call operator.
- Repairs occur in Preview. Production is redeployed only after recertification.

**PDR-022f. Maintenance mode is a formal, Platform-Administrator-controlled operational state.**

- Public curriculum remains readable when safe.
- Write-dependent services are temporarily disabled.
- In-progress assessment sessions are preserved with no partial attempt records.
- Users see friendly maintenance messaging that names the state and the expected exit.

**PDR-022g. Google Authentication uses secure persistent sessions.**

- Students remain signed in unless they sign out, security requires reauthentication, or session expiration occurs.
- Authentication sessions are distinct from assessment sessions (PDR-021a).

**PDR-022h. Production deployments never interrupt active classroom sessions.**

- Active Present Mode sessions, active assessment sessions, and active teacher workflows continue through a deployment.
- New sessions receive the new release. There is no in-product mid-class reload prompt.

**PDR-022i. Operational monitoring is scoped to platform health.**

- Authentication, Cloud Functions, assessment scoring, assignments, routing, deployment, rollback, latency, session recovery, and infrastructure are monitored.
- Student behavioral telemetry beyond platform health is not collected. Educational analytics remain separate.

**PDR-022j. Pilot Readiness is a formal, one-time certification.**

- Pilot Readiness requires verification of architecture, security, authentication, teacher workflows, student workflows, the assessment pipeline, Present Mode, deployment, rollback, monitoring, recovery, and operational ownership.
- Pilot Readiness is certified by the Platform Administrator and is re-certified if material conditions change before the pilot begins.

**PDR-022k. GitHub Pages retirement follows the criteria of §23.**

- Retirement occurs only after curriculum parity, custom domain, authentication, routing, Present Mode, anonymous browsing, authorized student access, deployment, rollback, search indexing, legacy redirects, and a seven-day observation period have been verified.
- After retirement, Firebase Hosting is the sole production origin. GitHub remains the source repository only.

### Rationale

Recording the operational architecture as a dedicated PDR closes a class of drift attempts and gives Sprint 9C implementation a stable operational target. Naming Firebase Hosting as the permanent production origin prevents accidental preservation of GitHub Pages as a second production surface. Naming the three-environment architecture prevents future sprints from skipping Preview under time pressure. Naming the ten-criterion Certified Release prevents partial releases from reaching production. Naming Platform Administrator approval as a load-bearing human gate prevents it from being automated away. Naming rollback as one action prevents mid-incident debate about the response.

### Consequences

Benefits:

- Operational behavior is uniform across every release.
- Deployment, rollback, maintenance mode, and Pilot Readiness are documented once and are consistent thereafter.
- Classrooms are protected across every operational transition.
- Instructional trust is earned by predictable operational behavior.

Limitations:

- Every production release passes through Preview, adding latency to small changes.
- Every production release requires Platform Administrator approval, adding a coordination cost.
- Emergency changes still require approval and recorded compressed certification.

### Future Reconsideration Criteria

- **PDR-022a** reconsidered only if a compelling classroom-safety or platform-boundary case is made against a single canonical origin. Growth pressure is not sufficient.
- **PDR-022b** amended by adding a Staging environment when release cadence or concurrent workstreams justify it. Not amended by removing Preview.
- **PDR-022c** amended only by making the certification criteria stricter. Loosening any criterion requires a new PDR.
- **PDR-022d** is not reconsidered. Automated tests never replace human approval for a classroom product.
- **PDR-022e** reconsidered only if a documented operational surface makes single-action rollback infeasible; the replacement must be as fast for classrooms.
- **PDR-022f** amended only by adding scope. Removing scope requires a new PDR.
- **PDR-022g** reconsidered only if authentication provider constraints change materially.
- **PDR-022h** is not reconsidered. Mid-class reloads are prohibited.
- **PDR-022i** amended only by adding platform-health signals. Adding student behavioral telemetry requires a new PDR.
- **PDR-022j** amended only by adding criteria.
- **PDR-022k** is not reconsidered. Retirement is a one-way transition.

---

## PDR-014 Sprint 9B Reconciliation Notice

PDR-014 (Deployment Philosophy) is ratified and continues to hold for the deployment properties it names: predictable, boring deployments; a testing environment that mirrors production configuration; GitHub as the single source of truth; every deployable artifact originating from a tagged commit on main; feature flags for grade rollouts; predictable release cadence; access-controlled production deploys; and rollback as one action.

Sprint 9B supersedes PDR-014 in three respects, recorded here and elaborated in PDR-022:

1. **Hosting posture.** PDR-014's implicit assumption that GitHub Pages remained the production website is superseded. Firebase Hosting is the permanent canonical production origin. See PDR-022a.
2. **Environment nomenclature.** PDR-014 named "Testing" as the pre-production Firebase project. Sprint 9B ratifies "Preview" as the certified pre-production environment, backed by Firebase Hosting Preview Channels or a dedicated preview project mirroring production. Where prior text says Testing, read Preview. A future Staging environment remains deferred.
3. **Human approval gate.** PDR-014's "deliberate promotion" is ratified explicitly as Platform Administrator approval. Automated tests are required but never replace human approval. See PDR-022d.

PDR-014's remaining properties continue to hold without amendment.

---

## PDR-023: Identity and Onboarding Architecture

### Decision

LyfeLabz identity, onboarding, verification, roster authority, and the authenticated experience shell are governed by `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`. That document is the single source of truth for identity behavior. This record ratifies its load-bearing decisions and anchors them in the decision log.

### Status

Accepted. Load-bearing.

### Background

Prior identity behavior was distributed across PDR-002, PDR-003, PDR-004, PDR-005, PDR-015, PDR-019, PDR-020, `LYFELABZ_SPRINT_2_ONBOARDING_AND_VERIFICATION.md`, and the Domain Model. Sprint 9C ratified a canonical specification that unifies these commitments, promotes District to a first-class entity, retires the verified-domain automated verification path, and codifies the verification-code path with a Request Teacher Access fallback.

### Sub-decisions

- **PDR-023a. Authentication is not authorization.** Google Workspace authenticates; the platform authorizes. Custom claims are written only when the identity's `status` is `active`.
- **PDR-023b. Two identity families.** Teacher identities and student identities are governed by distinct provisioning, verification, and lifecycle rules.
- **PDR-023c. District is a first-class security boundary.** Platform → District → School → Teacher Identity → Class → Enrollment. District is promoted from `Future` to load-bearing.
- **PDR-023d. Teacher identity is district-bound.** Changing districts creates a new LyfeLabz teacher identity. Cross-district identity linking never occurs automatically. Within a district, a teacher identity may be authorized for multiple schools.
- **PDR-023e. Student LyfeLabz Student ID is the authoritative student identifier.** Google is the authentication provider. Additional providers may be linked without changing the identifier.
- **PDR-023f. Roster import does not create student identities.** Student identities are created only after first successful Google sign-in. Roster placeholders carry an `awaitingFirstSignIn` state until activation.
- **PDR-023g. Identity matching is server-authoritative.** Primary key is Google Classroom User ID; email is the secondary validator. Students never resolve identity ambiguity by hand.
- **PDR-023h. One roster authority per class.** Google Classroom for LMS-linked classes; LyfeLabz for manual classes. Hybrid authority is refused.
- **PDR-023i. Google Classroom is the preferred onboarding path.** Manual classes remain fully supported for teachers whose classes are not represented in Google Classroom.
- **PDR-023j. Join codes exist only for manual classes.** Server-generated, unique, revocable, replaceable, disabled after archive, never anonymous.
- **PDR-023k. Teacher verification prefers a one-time institution-bound verification code.** The Request Teacher Access workflow is the fallback. The maintained verified-domain automated path is retired.
- **PDR-023l. Verification is invisible after completion.** No residual verification chrome in the verified teacher's ordinary workflow.
- **PDR-023m. Identity operations are atomic and idempotent.** No duplicate identities, enrollments, activations, or verifications.
- **PDR-023n. Global header is uniform.** Identity is never hidden inside the hamburger menu. `Sign In` is globally visible for anonymous users; identity control is upper-right for authenticated users.
- **PDR-023o. Authentication becomes required only when a capability depends on identity.** After sign-in, users return to the exact location they were previously using.

### Rationale

The identity architecture is the trust foundation for every other domain. Assessments, assignments, roster management, and LMS integration all depend on identity resolving to exactly one person with exactly one set of authorized capabilities. Distributing this contract across multiple records made drift easy. A single specification, anchored by a single PDR, makes drift structurally visible.

### Consequences

Benefits:

- Every identity behavior has a canonical anchor.
- The verified-domain allowlist is retired, closing a class of edge cases (personal domains, contractor accounts, transitional accounts).
- District becomes a first-class security boundary before the first district ships, preventing a load-bearing migration later.
- The onboarding surface is stable enough to be exercised end-to-end by pilot teachers.

Limitations:

- Verification codes require a Platform Administrator or authorized school administrator to issue. The Request Teacher Access fallback remains the safety net.
- Cross-district teacher continuity is not automatic. This is intentional under PDR-023d.

### Future Reconsideration Criteria

- Automatic cross-district identity linking may be reconsidered when a district integration provides authoritative teacher rosters and consent for cross-district relationships is codified.
- Non-Google identity providers may be added as linked providers without amending the specification's identity model, provided the two-layered rule (§3) is preserved.

---

## PDR-003 Sprint 9C Reconciliation Notice

PDR-003 (Teacher Verification Philosophy) is ratified for its foundational commitments: teachers are provisional at first sign-in, verification is a designed screen and not a locked dashboard, and Platform Administrators are the authoritative reviewers. Sprint 9C supersedes PDR-003 in the following respect:

- The maintained verified-domain automated verification path is retired. The preferred verification mechanism is a one-time, institution-bound verification code. The fallback is the Request Teacher Access workflow. See `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §13 and PDR-023k.

PDR-003's reconsideration criterion (district integration providing authoritative teacher rosters) is preserved and now points to PDR-023d and PDR-023k as the correct extension surface.

---

## PDR-015 Sprint 9C Reconciliation Notice

PDR-015 (Future Expansion Philosophy) is ratified. Sprint 9C promotes the District entity from "reachable expansion" to a first-class, load-bearing entity that acts as the certified security boundary in the identity hierarchy. See `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §6 and PDR-023c. The other expansions PDR-015 names (Canvas, Schoology, parent surface, additional authentication providers) remain reachable-but-deferred.

---

## PDR-024: Platform Transition and Pilot Readiness

**Status:** Ratified under Sprint 9D. Canonical.

**Anchor document:** `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`.

**Context.** Sprint 9A ratified the assessment pipeline (PDR-021). Sprint 9B ratified platform operations (PDR-022). Sprint 9C ratified identity and onboarding (PDR-023). Sprint 9D closes Sprint 9 by ratifying the product philosophy that governs the platform's transition from an instructional website into the first production teacher pilot, and the long-term learning-journey posture that follows.

**Sub-decisions.**

- **PDR-024a. Teach First, Configure Second.** No LyfeLabz surface requires a teacher to complete configuration screens before teaching. First-time verified teachers receive an optional, non-blocking Welcome Guide, not a setup wizard.
- **PDR-024b. Access is requested; approval is human.** Unknown teachers request access. Platform Administrator approval is the load-bearing human gate for teacher onboarding during and after the pilot.
- **PDR-024c. Public educational content remains browsable without authentication.** The pilot never gates the public curriculum on sign-in. Authentication becomes required only when a capability depends on identity.
- **PDR-024d. LyfeLabz is not a Learning Management System.** The Teacher Workspace does not include a calendar, planner, curriculum-mapping tool, gradebook, messaging system, recommendation engine, or analytics dashboard during or after the pilot. Adding any of these surfaces requires a new PDR that supersedes PDR-024d.
- **PDR-024e. Teacher Workspace pilot scope.** In-scope capabilities: recent submissions, students who have not submitted the latest assignment, activate or deactivate lessons, publish assignments to Google Classroom, launch Present Mode, open lesson, class roster.
- **PDR-024f. Activation and publication are separate.** Activation controls access to lessons inside LyfeLabz. Publication sends assignments into Google Classroom. Activation without publication is a supported state. Publication without activation is refused.
- **PDR-024g. Google Classroom is the assignment hub.** Where a class is linked to Google Classroom, Google Classroom remains the student's assignment hub and To-do list. LyfeLabz does not compete for the teacher's or student's attention with a second assignment channel.
- **PDR-024h. Deep links land the student in the correct lesson silently.** A student launching an assignment from Google Classroom enters the correct authorized attempt context without selecting a class or an assignment.
- **PDR-024i. Student identity menu is exactly My Assignments and My Results.** No additional student surface is introduced by the pilot.
- **PDR-024j. Submit equals completion.** The student's submit gesture records the attempt, scores the assessment, reveals correct answers, and marks the assignment complete in a single step.
- **PDR-024k. Improve My Score is offered on every less-than-perfect best score.** A best score of 9/10 receives the Well Done indicator and still offers Improve My Score. A best score of 10/10 receives the Perfect Score indicator and does not offer Improve My Score.
- **PDR-024l. Status indicators.** Four indicators are canonical: Ready to Begin (blue circle), Improving (yellow circle), Well Done! (green circle), Perfect Score (gold star). Indicators are never represented by color alone.
- **PDR-024m. Celebrate improvement as much as achievement.** Personal bests are celebrated. Students are never compared to one another. Punitive language such as `Failed`, `Poor`, or `Needs Improvement` is prohibited on every student surface.
- **PDR-024n. Learning belongs to the student.** Archived lessons remain permanently accessible through the student's login. Students may review lessons, vocabulary, Explore, scores, attempts, and explanations. Students may not submit again, modify responses, or create new attempts after archival. Teacher class archival never removes student learning history.
- **PDR-024o. Multi-year portfolio.** Completed learning accumulates across Grade 6 through Grade 8 under the permanent LyfeLabz Student ID. The resulting portfolio is a preservation surface, not a test-prep product. Its use as MCAS preparation is a byproduct, not the product.
- **PDR-024p. Calm software.** LyfeLabz does not emit email notifications, push notifications, marketing notifications, or engagement reminders. Notifications exist only when immediate classroom action is required. The pilot has no such notifications.
- **PDR-024q. Product Readiness bar for the pilot.** Pilot readiness under PDR-022 (operations) is joined by the product readiness bar in `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` §10.1. Both must be satisfied before the pilot begins.
- **PDR-024r. Every feature must earn its place.** A pilot feature that cannot be located inside a real teacher or student moment does not belong in the pilot, and does not belong after the pilot without a superseding PDR.

**Reconciliation notes.**

- PDR-001 is strengthened. LyfeLabz complements Google Classroom and PowerSchool during and after the pilot.
- PDR-010 is preserved. Activation continues as the teacher-facing expression of curation. Publication is an adjacent, LMS-scoped operation that does not modify activation.
- PDR-011 is preserved. The pilot introduces no analytics dashboard.
- PDR-018 is preserved. The pilot's Teacher Workspace stays within the surface boundaries recorded in PDR-018.
- PDR-019 and PDR-020 are preserved. Google Classroom remains the initial LMS implementation target; PDR-024f, PDR-024g, and PDR-024h are the product-level expression of that posture.
- PDR-021 is preserved. Submit-equals-completion (PDR-024j) and Improve My Score (PDR-024k) rely on the unlimited-attempts default in PDR-021.
- PDR-022 is preserved. Pilot Readiness under PDR-022 remains the operational bar. PDR-024q adds a product bar.
- PDR-023 is preserved. Teacher onboarding under PDR-024a and PDR-024b is the pilot-scoped extension of PDR-023.

**Anti-decisions.**

- The pilot does not introduce a calendar, planner, curriculum-mapping tool, gradebook, messaging system, recommendation engine, analytics dashboard, inbox, notification bell, engagement email, or marketing surface. Adding any of these requires a superseding PDR.

---

## PDR-022 Sprint 9D Reconciliation Notice

PDR-022 (Platform Operations Architecture) is ratified. Sprint 9D adds a product readiness bar that operates alongside the operational Pilot Readiness bar in `PLATFORM_OPERATIONS_SPECIFICATION.md` §22. Both bars must be satisfied before the pilot begins. See `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` §10 and PDR-024q.

---

## PDR-025: District Security Boundary Implementation Contract

**Status:** Ratified under Sprint 10A step F-1. Canonical.

**Anchor document:** `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`.

**Context.** PDR-023c promoted District to a first-class security boundary and PDR-023d bound teacher identity to a single district. The independent Sprint 9E architecture review recorded that the district enforcement model was distributed across several documents (Cloud Function Charter, Security Model, Data Model, Identity Specification, Engineering Standards, Domain Roadmap, LMS Integration Architecture) at different levels of abstraction. Sprint 10A F-1 collapses those statements into one implementation contract without redesigning the identity, onboarding, class, enrollment, assessment, or platform-operations experiences.

**Decision.** The load-bearing rules for district enforcement are canonical in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`. Older documents are reconciled to defer to it.

**Sub-decisions.**

- **PDR-025a. Firestore is the durable source of truth.** `users/{uid}` is the durable authority for role, account state, school membership, and district membership. Custom claims are an authorization projection of that record, never the business record.
- **PDR-025b. Custom claims are server-issued.** Only `role`, `schoolId`, and `districtId` are recognized. All three are written exclusively by Cloud Functions. Clients MUST NOT submit ownership values as authoritative input.
- **PDR-025c. Claims are written only when `status === "active"`.** Any transition out of `active` clears the claim. Any authorized change to role, district, or active school membership writes the record first and issues a claim replacement in the same server-authoritative transition.
- **PDR-025d. No partial district activation.** A user is district-active only after `status === "active"` and the matching claims are on a refreshed token. A pending verification, a stored `districtId` on a non-active record, a Google identity email domain, an enrollment invitation, and a stale claim never confer district access on their own.
- **PDR-025e. Security Rules enforce district isolation.** Every district-scoped rule compares the caller's `districtId` claim to the resource's canonical district ownership (denormalized where the rule layer requires a single-document read). Rules default to deny. Rules never trust ownership fields in `request.resource.data` without an independent comparison to the caller's claim.
- **PDR-025f. Callables enforce parent ownership.** Every callable that touches a district-scoped resource derives `districtId` from server state, verifies parent ownership through the resolved chain, refuses client-supplied ownership, verifies the caller's account state, and emits at least one canonical audit event.
- **PDR-025g. Cross-district references are refused.** No class MAY reference a school outside its district. No enrollment MAY join a student to a class outside the student's district. No assignment MAY reference a class outside its district. No submission MAY reference an assignment outside its district. No client MAY forge ownership fields.
- **PDR-025h. Platform administrator authority is bounded.** Administrator access is explicit and audited; it is not a wildcard. Administrators MAY carry a claim shape that omits `districtId` and `schoolId` as the canonical administrator sentinel. The administrator sentinel MUST NOT be usable by any other role.
- **PDR-025i. District transfer is not implemented in Sprint 10A.** The safe default is denial of client-driven `districtId` mutation. Where a district change is operationally required before a transfer callable is authorized, a new identity is provisioned in the new district per PDR-023d and `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §18. A future PDR is required to authorize a transfer callable.
- **PDR-025j. Stale sessions fail closed.** When token claims and the canonical record disagree, the callable and the rule layer deny the operation. Fallback to the record at the rule layer is forbidden. Callables that reissue claims MUST return a refresh signal; the client MUST refresh or sign out.
- **PDR-025k. Auditability is mandatory.** Every district-relevant transition emits an `auditEvents` record with `districtId` populated where the transition resolves to a district. No second audit sink is created.

**Reconciliation notes.**

- PDR-023 is preserved. PDR-025 implements PDR-023c and PDR-023d without amending identity philosophy.
- PDR-015 Sprint 9C notice is preserved. PDR-025 records the enforcement contract that follows from the promotion of District to a first-class boundary.
- PDR-003 Sprint 9C notice is preserved. Teacher verification callable behavior is bounded by PDR-025f.
- PDR-004 is preserved. The recognized role set is unchanged.
- PDR-013 is preserved. Audit vocabulary is extended, not replaced. No second audit sink is created.

**Anti-decisions.**

- PDR-025 does not introduce district self-service, teacher-selected district assignment, automatic district trust based on email domain, a School Administrator or District Administrator role, a Parent role, a new user-facing state, a district management surface, an unrestricted platform-administrator bypass, a new audit sink, or a district transfer capability.

**Future Reconsideration Criteria.**

- A district transfer callable may be added when a superseding PDR authorizes it and defines the transition, claim replacement, stale-session handling, revocation, historical learning ownership, cross-district data leakage prevention, and audit vocabulary specified in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §14.
- The platform administrator claim shape (absence-as-sentinel vs explicit sentinel) may be finalized in the sprint that lands the claim write path; the resulting decision amends `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §6 without a new PDR.

---

## PDR-026: Assessment Implementation Contract

**Status:** Ratified under Sprint 10A step F-2. Canonical.

**Anchor document:** `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`.

**Context.** PDR-021 established the certified assessment pipeline (session-attempt separation, server-authoritative scoring, server-confidential answer keys, unlimited attempts, immutable history, one-hour grace, 24-hour session expiration). The independent Sprint 9E architecture review recorded that the implementation rules that follow from that stance were distributed across the Assessment Pipeline Specification, the Cloud Function Charter, the Firestore Data Model, the Firebase Security Model, the Firestore Query and Index Strategy, and the Submission Rollup Strategy. Sprint 10A F-2 collapses those statements into one implementation contract without redesigning any product behavior established by PDR-021.

**Decision.** The load-bearing rules for assessment implementation are canonical in `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`. Older documents are reconciled to defer to it.

**Sub-decisions.**

- **PDR-026a. Attempt is the sole authoritative record.** `attempts/{attemptId}` supersedes `submissions/{submissionId}` for the formative pipeline. Attempts are immutable after write. The existing `submissions` collection is superseded and its migration is planned in the implementation sprint (Contract §26).
- **PDR-026b. Sessions and attempts are distinct collections.** `assessmentSessions/{sessionId}` holds transient working state; `attempts/{attemptId}` holds authoritative history. Only one Live session MAY exist per (student, assignment). Sessions never become attempts by rename; a scorer transaction creates the attempt and deletes the session atomically.
- **PDR-026c. `assessmentAttemptsFinalize` is the sole writer of `attempts/*`.** The two-callable split (`submissionsCreate` / `submissionsFinalize`) is retired. A single callable runs the submission transaction described in Contract §8. Idempotency is enforced against a client-supplied marker.
- **PDR-026d. Answer keys live only in `assessmentAnswerKeys/{revisionId}`.** Firestore Security Rules refuse client reads for every role, including `platformAdministrator`. Only the scorer reads answer keys at request time. Administrative inspection is routed through an audited callable.
- **PDR-026e. Assessment revisions are platform-owned.** Revisions are internal, monotonic, and never surface to teachers. Every attempt records the revision it was scored against; revisions are never deleted while an attempt references them.
- **PDR-026f. Rollups are the read path for `My Results` and teacher analytics.** `attemptRollups/{assignmentId}__{studentId}` and `assignmentRollups/{assignmentId}` are rewritten atomically on every attempt write by a single rollup Cloud Function. No teacher surface reads `attempts/*` in bulk.
- **PDR-026g. District enforcement is additive.** Every callable in this contract also complies with `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12. Nothing in this contract widens the district boundary.
- **PDR-026h. Audit vocabulary is fixed.** Assessment transitions emit exactly the events in Contract §24. Autosave is not audited event-by-event. Rollup recomputation is not audited. No second audit sink is created.
- **PDR-026i. Practice Mode remains client-only.** The recorded pipeline never runs in Practice Mode. `practice`-mode assignments are refused by `assessmentSessionsBegin`. This preserves the existing offline-friendly instructional surface.

**Reconciliation notes.**

- PDR-008 is preserved. PDR-026 implements the Sprint 9A amendment to PDR-008 that renamed Submission to Attempt.
- PDR-021 is preserved. PDR-026 implements it without amending the specification.
- PDR-024 is preserved. `My Results`, `Improve My Score`, and the five-metric teacher surface consume this pipeline without change.
- PDR-025 is preserved. Every callable named here also satisfies the district enforcement contract.
- PDR-013 is preserved. Audit vocabulary is extended, not replaced. No second audit sink is created.
- PDR-017 is preserved. A single scorer helper and a single session helper avoid duplicating the trust boundary.

**Anti-decisions.**

- PDR-026 does not introduce a summative pipeline, a teacher-editable answer key, a per-class assessment fork, a live-session viewer for teachers, a teacher annotation collection, a rubric-scored open-response item, a language-model scoring pathway, a parent view, a grade-export surface, a Practice Mode server pathway, a new user-facing state, or a per-assignment attempt cap surface.

**Future Reconsideration Criteria.**

- A rubric-scored or model-scored item type may be added when a superseding PDR authorizes it and defines the item-level score shape, the validation posture for model outputs, and any additional error identifiers.
- A teacher annotation surface may be added when a superseding PDR authorizes it and defines the annotation collection, its callable ownership, and its relationship to the immutable attempt record.
- The archival recovery window and the autosave throttle constant may be finalized in the sprint that lands the callables; the resulting decisions amend `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §31 without a new PDR.

---

## PDR-027: Google Classroom Deep-Link Implementation Contract

**Status:** Ratified under Sprint 10A step F-3. Canonical.

**Anchor document:** `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`.

**Context.** PDR-019 established the LMS integration posture, PDR-020 authorized the initial Google Classroom scope, and PDR-024f, PDR-024g, and PDR-024h fixed the pilot integration philosophy (activation and publication are separate, Classroom is the assignment hub, deep links land the student in the correct authorized attempt context silently). The independent Sprint 9E architecture review recorded that the implementation rules that follow from that stance were distributed across the LMS Integration Architecture, the LMS Integration Architecture Amendment, the LMS Integration Operations runbook, the LMS Experience, the Cloud Function Charter, the Firestore Data Model, the Firebase Security Model, the Assign Experience, and the Platform Transition and Pilot Readiness Specification. Sprint 10A F-3 collapses those statements into one implementation contract without redesigning any product behavior established by PDR-019, PDR-020, or PDR-024.

**Decision.** The load-bearing rules for Google Classroom deep-link resolution, assignment resolution, URL contracts, security boundaries, and multiple-class and multiple-teacher publication behavior are canonical in `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`. Older documents are reconciled to defer to it.

**Sub-decisions.**

- **PDR-027a. LyfeLabz owns the deep-link URL.** The URL shape `https://lyfelabz.com/app/a/{assignmentId}` is the sole authorized deep-link Classroom coursework link material. No token, session identifier, student identifier, score, answer-key excerpt, or Classroom coursework identifier appears in the URL. The URL is emitted only by the publication callable and consumed only by the resolver callable.
- **PDR-027b. The canonical LyfeLabz `assignmentId` is the load-bearing key.** Classroom coursework identifiers (`providerCourseId`, `providerCourseWorkId`) are recorded for reconciliation only. They are never an authorization key. Bidirectional lookup between `assignments/{assignmentId}` and `lmsAssignmentPublications/{publicationId}` is one-directional at authorization time: the resolver reads only the LyfeLabz assignment.
- **PDR-027c. `lmsAssignmentPublish` is the sole writer of `lmsAssignmentPublications/*`.** It writes one publication document per successful (LyfeLabz assignment, target class) attempt. It is the sole writer of `assignments/{assignmentId}.lmsPublicationRef`. The transaction is atomic; a failed Classroom write leaves no publication document.
- **PDR-027d. `lmsDeepLinkResolve` is read-only against LyfeLabz state.** It never writes to `assessmentSessions/*`, `attempts/*`, `assignments/*`, `lmsAssignmentPublications/*`, or `lmsClassLinks/*`. It never calls Google Classroom. Silent arrival is dispatched through the internal navigation target; session creation remains the sole responsibility of `assessmentSessionsBegin`.
- **PDR-027e. Fan-out publication is per (assignment, class).** A teacher gesture targeting multiple linked classes produces one LyfeLabz assignment per class per `ASSESSMENT_PIPELINE_SPECIFICATION.md` §12.1 and one publication attempt per (assignment, class). Each target succeeds or fails independently. Partial fan-out is a supported terminal state.
- **PDR-027f. LyfeLabz enforces a single teacher-of-record per LyfeLabz class.** The LyfeLabz class owner is the sole authorized publisher. Classroom co-teachers do not authorize LyfeLabz publication. Ownership drift refuses publication and marks the link stale; LyfeLabz never silently reassigns class ownership.
- **PDR-027g. Classroom synchronization is bounded.** LyfeLabz reads Classroom courses and rosters and writes exactly one Classroom coursework record per publication. LyfeLabz never posts to the class stream, comments, messages, grades, edits published coursework after create, deletes Classroom state, or reads non-LyfeLabz Classroom content.
- **PDR-027h. District enforcement is additive.** Every callable in this contract also complies with `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12. Cross-district publications and cross-district resolutions are refused at the callable layer and the rule layer. Nothing in this contract widens the district boundary.
- **PDR-027i. Audit vocabulary is fixed.** Publication and resolution transitions emit exactly `lms.assignmentPublished`, `lms.publishFailed`, `lms.deepLinkResolved`, `lms.ownershipDrift`, and (reserved for future unpublish) `lms.assignmentUnpublished`. No second audit sink is created.
- **PDR-027j. Google Classroom is an integration, not the source of truth.** The LyfeLabz assignment record is authoritative. Deactivating, closing, or archiving a LyfeLabz assignment does not modify the Classroom coursework record. Deleting or archiving a Classroom course does not modify LyfeLabz assignment or learning state. Every conflict resolves through the certified authority boundaries in PDR-019b.

**Reconciliation notes.**

- PDR-019 is preserved. PDR-027 implements PDR-019a through PDR-019l without amending the integration posture.
- PDR-020 is preserved. Google Classroom remains the initial and only supported provider in Version 1; provider neutrality is preserved by naming Google-specific choices as such.
- PDR-024 is preserved. Activation and publication remain separate (PDR-024f), Google Classroom remains the assignment hub (PDR-024g), and deep links land the student silently (PDR-024h).
- PDR-025 is preserved. Every callable named here also satisfies the district enforcement contract.
- PDR-026 is preserved. `lmsDeepLinkResolve` never creates a session or an attempt; session creation remains the sole responsibility of `assessmentSessionsBegin` and attempt creation the sole responsibility of `assessmentAttemptsFinalize`.
- PDR-013 is preserved. Audit vocabulary is extended, not replaced. No second audit sink is created.
- PDR-017 is preserved. A single deep-link URL builder, a single deep-link URL parser, a single Google Classroom adapter, a single publication transaction, and a single resolution implementation avoid duplicating the trust boundary.

**Anti-decisions.**

- PDR-027 does not introduce bidirectional publication, grade export to Classroom, automatic publication, a second-provider adapter, a LyfeLabz-side co-teacher role, a deep-link URL that carries a session identifier or score, a teacher-facing publication history surface, a Classroom-driven curation of the LyfeLabz curriculum, a Present Mode integration with Classroom, or a parent view of Classroom activity.

**Future Reconsideration Criteria.**

- An `lmsAssignmentUnpublish` callable may be added when a superseding sprint authors its transaction as an amendment to `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` §17.
- A coursework-deleted-upstream reconciliation sweep may be added when operational evidence indicates the manual gesture is insufficient. The sweep is enumerated as G-10A-10 and is deferred until then.
- Second-provider (Canvas, Schoology, Microsoft Teams for Education) adapters may be added under PDR-020 and PDR-019h once demand is documented; each adapter satisfies this contract's shape without rewriting it.

---

## PDR-028: Roster Display Name Implementation Contract

**Status:** Ratified under Sprint 10A step F-4. Canonical.

**Anchor document:** `ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md`.

**Context.** PDR-003 established the verified teacher identity path, PDR-005 established a single teacher-of-record per class, PDR-011 established personal-data minimization, PDR-019 established the LMS roster authority rule, and PDR-023 established identity, onboarding, and roster authority as first-class boundaries. The independent Sprint 9E architecture review recorded that the implementation rules governing teacher-readable roster display names were distributed across `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.1 and §3.4, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LMS_INTEGRATION_ARCHITECTURE.md` §7 and §7.5, `LMS_EXPERIENCE.md` §5 and §12, `LYFELABZ_PLATFORM_ARCHITECTURE.md` §229, and the Sprint 3 shell specifications. In one direction the resolution model was circular: the display name a teacher reads on a roster may be resolved from the user, from the enrollment override, or from the placeholder, and the "authoritative" answer was not uniformly named. Sprint 10A F-4 collapses those statements into one implementation contract without redesigning any product behavior established by PDR-003, PDR-005, PDR-011, PDR-019, or PDR-023.

**Decision.** The load-bearing rules for canonical ownership of teacher-readable roster display names across users, enrollments, roster placeholders, Google profile interaction, LMS roster refresh, teacher roster resolution, and the Firestore, Cloud Function, and audit ownership of every writer that produces a name a teacher will read are canonical in `ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md`. Older documents are reconciled to defer to it.

**Sub-decisions.**

- **PDR-028a. `users/{uid}.displayName` is the sole canonical display name for a signed-in person.** No other collection duplicates it. No callable derives an authorization decision from it.
- **PDR-028b. `enrollments/{enrollmentId}.displayNameOverride` is the sole authorized per-class presentation override.** It never propagates to `users/{uid}.displayName`, never propagates to another enrollment, and never becomes the canonical display name.
- **PDR-028c. The roster placeholder name is not a display name for a LyfeLabz identity.** It is the teacher-readable name for a not-yet-resolved LMS roster entry, sourced from the LMS at import and refreshed only on explicit teacher confirmation. It is retired at placeholder resolution.
- **PDR-028d. The teacher-facing roster resolver is a single, canonical function.** For every enrollment, the resolver returns the per-class override, or the resolved `users/{uid}.displayName`, or the placeholder name, or `null`, in that order. No teacher surface concatenates a name from any other source.
- **PDR-028e. The Google profile display name is a source only at first sign-in.** After the initial `authOnUserCreate` seed, LyfeLabz MUST NOT read the Google profile display name into any canonical field. A Google profile rename does not silently rename a LyfeLabz identity.
- **PDR-028f. The LMS-reported display name never overwrites `users/{uid}.displayName` for a resolved enrollment.** LMS refresh applies confirmed name-change deltas to placeholders only; overriding a resolved enrollment's rendered name is an explicit per-class teacher gesture.
- **PDR-028g. A single shared normalizer validates every display-name write.** It trims, collapses whitespace, refuses empty and over-long values, and refuses disallowed characters. No callable inlines its own validator.
- **PDR-028h. Attempts, sessions, submissions, rollups, classes, and assignments MUST NOT carry a denormalized display-name copy.** This restates `ASSESSMENT_PIPELINE_SPECIFICATION.md` §466 and `LYFELABZ_FIRESTORE_DATA_MODEL.md` §766 into the display-name surface.
- **PDR-028i. District enforcement is additive.** Every callable in this contract also complies with `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12. Cross-district and cross-class display-name reads are refused at the callable and rule layers.
- **PDR-028j. Audit vocabulary is fixed.** Display-name transitions emit exactly `users.displayNameChanged`, `enrollments.displayNameOverrideChanged`, `roster.placeholderNameChanged`, and `roster.placeholderResolved`. No second audit sink is created.

**Reconciliation notes.**

- PDR-003 is preserved. Teacher-verified identity remains the load-bearing authorization boundary; display-name changes do not affect verification state.
- PDR-005 is preserved. A single teacher-of-record per class remains the authority for a per-class override gesture; co-teacher writes remain unauthorized.
- PDR-011 is preserved. Personal-data minimization continues to prohibit denormalized display-name copies on submission or attempt records.
- PDR-019 is preserved. LMS roster authority remains the source of placeholder names and remains constrained to placeholder-only writes; a LyfeLabz-identity rename never routes through an LMS callable.
- PDR-023 is preserved. Identity, onboarding, verification, roster authority, and the authenticated experience shell remain owned by `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`; display-name ratification at activation is called out here without amending the identity lifecycle.
- PDR-025 is preserved. Every callable named here also complies with the district enforcement contract.
- PDR-026 is preserved. Attempts remain owned by `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`; no display-name field participates in an attempt record.
- PDR-027 is preserved. Google Classroom deep-link and publication paths remain owned by `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`; a display-name change never propagates through the deep-link URL or a Classroom coursework record.
- PDR-013 is preserved. Audit vocabulary is extended, not replaced.
- PDR-017 is preserved. A single normalizer, a single resolver, and a single writer per display-name field avoid duplicating the trust boundary.

**Anti-decisions.**

- PDR-028 does not introduce a separate legal-name field, a preferred-pronouns field, a family-name field, or any additional personal-name field. PDR-028 does not authorize automatic reconciliation of a Google profile display-name change into `users/{uid}.displayName`. PDR-028 does not authorize automatic reconciliation of an LMS-reported display-name change into a resolved enrollment's canonical name. PDR-028 does not authorize a teacher rename of another user's canonical display name. PDR-028 does not introduce a denormalized display-name copy on any attempt, session, submission, rollup, class, or assignment document. PDR-028 does not introduce a display-name-based authorization decision. PDR-028 does not introduce a parent, districtAdministrator, schoolAdministrator, or co-teacher display-name surface.

**Future Reconsideration Criteria.**

- A separate legal-name or preferred-pronouns field may be added when a superseding PDR authorizes it and defines the collection, its callable ownership, and its interaction with the resolver.
- A user-initiated "refresh from Google" gesture may be added when a superseding decision authorizes it under an explicit user confirmation.
- The display-name length bound in §13.1 may be finalized in the implementation sprint under the tuning permission recorded in G-10A-16; any change above 200 code points requires a new PDR.

---

## PDR-029: Assignment Summary and Recipient Population Policy

**Status:** Ratified under Sprint 12E-A. Canonical.

**Date:** 2026-07-16.

**Anchor documents:** `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `SPRINT_12E_SLICE_1_COMPLETION_REPORT.md`, `SPRINT_12E_A_ASSIGNMENT_SUMMARY_POLICY_RATIFICATION.md`.

**Context.** Sprint 12E Slice 1 delivered the bounded teacher-facing callable `assessmentAssignmentSummary`, which returns aggregate participation and completed-attempt score metrics for exactly one assignment. Its implementation surfaced two policies that were previously inferred from the certified contracts but were never explicitly ratified: (a) which completed attempt represents a student in aggregate assignment metrics, and (b) which students belong to the canonical population of an assignment over time. `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §17 names the assignment as the authorization boundary for authoritative attempts, §18 defines the pilot `attemptRollups.bestScore` and `bestAttemptId` fields, and §20 lists "Highest score" first among the five teacher-visible metrics, but neither the summary attempt-selection policy nor a frozen recipient population is stated in normative language. `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.6 defines the assignment record and its immutable ownership fields but does not define an `assignmentRecipients` collection. PDR-024, PDR-025, PDR-026, PDR-027, and PDR-028 are preserved. This PDR does not redesign the assessment pipeline, the district boundary, the deep-link contract, or the roster display-name resolver.

**Decision.** The teacher-facing assignment summary is aggregate-only and is governed by two canonical policies. First, the representative attempt for each student in aggregate assignment score metrics is the student's highest valid completed attempt for that assignment. Second, an assignment has a frozen recipient population captured at first publication; roster changes after publication do not silently rewrite the population. The direct-query implementation delivered in Sprint 12E Slice 1 remains acceptable for the bounded pilot and MUST be migrated to read the frozen recipient population before Sprint 12E Slice 1 is fully certified. Long-term persistent rollups (`assignmentRollups`, `attemptRollups`) remain the certified scalable path and MUST preserve identical metric semantics.

**Sub-decisions.**

- **PDR-029a. Representative attempt policy.** The representative attempt for each student in every aggregate assignment summary metric (average, highest, lowest, perfect-score count) is the student's highest valid completed attempt. "Valid" means a frozen `attempts/{attemptId}` record whose scoped ownership fields (`assignmentId`, `classId`, `teacherId`, `schoolId`, `districtId`, `studentId`) match the loaded assignment context and whose `percentage`, `score`, `maxScore`, and `attemptNumber` are finite. All completed attempts remain preserved. Individual attempt drill-down (via `assessmentAttemptsGetForTeacher` and `assessmentAttemptsGetForStudent`) continues to expose the full attempt history. Additional attempts MUST NOT inflate the number of completed students. A later lower attempt MUST NOT reduce the student's aggregate representation. An improved attempt updates the summary representation.
- **PDR-029b. Tie-breaking.** Ties in `percentage` MUST be broken deterministically in the following order: (1) higher `attemptNumber`; (2) later `completedAt` when both attempts carry comparable timestamps; (3) stable ascending `attemptId` ordering as the final technical fallback. Raw `score` MUST NOT be used as a tie-breaker across attempts whose `maxScore` differs, because comparability is not guaranteed across assessment revisions. The tie-break policy is a technical determinism rule and MUST NOT be surfaced to teachers or students as an instructional signal.
- **PDR-029c. Cross-revision comparability.** `percentage` is the sole cross-revision comparable score field. Raw `score` comparisons across attempts against different `assessmentRevisionId` values MUST NOT be used for representative-attempt selection or for any teacher-facing aggregate. Malformed attempts (non-finite `percentage`, `score`, `maxScore`, or `attemptNumber`) MUST be dropped from selection. If every attempt for a student is malformed, the student MUST NOT be classified as completed.
- **PDR-029d. Canonical assignment population.** Every assignment has a frozen recipient population. The first successful publication of an assignment MUST atomically capture the assignment's recipient set from the active enrollment roster of the assignment's `classId`. The recipient population MUST NOT be redefined by subsequent roster changes.
- **PDR-029e. Recipient persistence model.** The canonical persistence shape is the assignment subcollection `assignments/{assignmentId}/recipients/{studentId}`. `studentId` is the document identifier so each recipient is unique per assignment by construction. Alternative shapes (a top-level `assignmentRecipients` collection or an embedded array or map on the assignment document) MUST NOT be introduced. The subcollection shape aligns with existing assignment ownership rules, keeps the recipient set inside the assignment's rules boundary, avoids the assignment document-size limit, supports single-field equality queries for both teacher summary and student My Assignments reads, and preserves auditability at the assignment level.
- **PDR-029f. Minimum recipient record.** A recipient record MUST carry at minimum: `assignmentId`, `studentId`, `classId`, `schoolId`, `districtId`, `assignedAt` (server timestamp), `assignedBy` (uid of the teacher whose action produced the recipient), `source` (one of `classPublication`, `manualAddition`, `lmsImport`), and `status` set to `assigned`. Recipient records MUST NOT carry a denormalized display name (PDR-028h), MUST NOT duplicate answer-key or assessment content, and MUST NOT duplicate user profile data. Additional fields (for example a due-date override or an assignment-window override) MAY be added in a superseding sprint under an explicit reconciliation notice.
- **PDR-029g. Recipient immutability.** Recipient records are append-only after publication. Roster removal MUST NOT delete a recipient record. Recipient records MUST NOT be edited by clients. Recipient records MUST NOT be deleted through normal teacher workflows. All recipient writes MUST occur through trusted Cloud Functions. An administrative correction path MAY mark a recipient as invalidated while preserving audit history in a superseding sprint; invalidation MUST NOT silently delete attempts.
- **PDR-029h. Late-recipient behavior.** A newly enrolled student MUST NOT be silently added to any previously published assignment. When a teacher elects to assign an existing published assignment to a student who joined after publication, a new immutable recipient record MUST be created for that student with `source === "manualAddition"` and `assignedAt` stamped at the moment of the write. Bulk "assign to newly enrolled students" gestures are permitted only when a superseding sprint authorizes and specifies the ownership check, audit event, and rate limits. Adding a recipient inherits the assignment's window and mode; per-recipient window overrides MUST NOT be introduced without a superseding PDR. Google Classroom re-publication for the added recipient follows PDR-027 and is not automatic.
- **PDR-029i. Removed-student behavior.** Removing a student from a class (whether via `enrollmentsSetStatus`, transfer, or archive) MUST NOT delete recipient records and MUST NOT rewrite historical assignment metrics. Historical attempts remain readable to the owning teacher and to the student under PDR-025 and PDR-026. The student's current platform authorization continues to follow enrollment lifecycle rules; assignment inclusion is a separate historical fact.
- **PDR-029j. Assignment lifecycle interaction.** First publication (`draft` -> `published` via `assignmentsPublish`) is the sole event that creates the canonical recipient population. Reopening a closed assignment MUST NOT change the recipient population. Editing `windowClosesAt`, `availableAt`, `title`, `instructions`, or other teacher-editable metadata under §3.6 MUST NOT change the recipient population. Republishing a `published` assignment is a no-op with respect to the recipient population. Archiving MUST NOT alter recipient records. Duplicating an assignment creates a new `assignmentId` and a new recipient population captured at that new assignment's first publication.
- **PDR-029k. Enrollment lifecycle interaction.** Assignment inclusion is determined solely by the recipient record. Current display-name availability, current enrollment status, current class membership, and current district membership MUST NOT be used to include or exclude a student from a historical assignment summary. Cross-district revocation (PDR-025) continues to gate live reads and writes.
- **PDR-029l. Session and attempt enforcement.** `assessmentSessionsBegin` MUST refuse to create a session for a student who is not a recipient of the target assignment. `assessmentAttemptsFinalize` MUST refuse to persist an attempt whose `(studentId, assignmentId)` does not resolve to a recipient record. Existing session and attempt callables (`assessmentSessionsAutosave`, `assessmentSessionsResume`, `assessmentAttemptsGetForStudent`, `assessmentAttemptsGetForTeacher`, `assessmentAssignmentSummary`) MUST read the recipient collection as the canonical population when computing membership. Multiple attempts by a single student do not create multiple recipient records. Recipient identity is student-based, not attempt-based.
- **PDR-029m. Direct-query pilot policy.** `assessmentAssignmentSummary` MAY compute its aggregates directly from `attempts`, `assessmentSessions`, and the recipient collection while pilot class sizes remain bounded (tens of students per assignment). The direct-query path is not the historical-population authority; the recipient collection is. Migration to `assignmentRollups` and `attemptRollups` is a future scalability optimization.
- **PDR-029n. Future rollup policy.** Persistent `assignmentRollups` and `attemptRollups` remain the certified long-term shape per `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §18 and §20. Rollup adoption MUST preserve identical semantics for the representative-attempt policy, the tie-break policy, and the frozen recipient population. Rollups MUST NOT redefine any metric. Rollups MAY carry additional internal observability fields provided they are never projected onto the teacher UI.
- **PDR-029o. Security and privacy implications.** Recipient records are readable by the owning teacher (matching the assignment's `teacherId` and `schoolId`) and by the student named on the recipient record. Cross-district and cross-school reads are refused at the callable and rules layers under PDR-025. Recipient records MUST NOT be readable by parents, co-teachers, district administrators, or school administrators until a superseding PDR authorizes it. Recipient records MUST NOT carry personal data beyond the identifiers named in PDR-029f.
- **PDR-029p. Audit implications.** Recipient writes MUST emit a canonical audit event named `assignments.recipientAdded` (source in `classPublication`, `manualAddition`, or `lmsImport`). An administrative invalidation, if authorized in a superseding sprint, MUST emit `assignments.recipientInvalidated`. No second audit sink is created (PDR-013).

**Reconciliation notes.**

- PDR-024 is preserved. The frozen recipient population is a first-class product surface for the student assignment experience and the teacher analytics experience without redesigning either.
- PDR-025 is preserved. Recipient reads and writes satisfy the district enforcement contract.
- PDR-026 is preserved. `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §17 is amended by explicit reconciliation notice to name the recipient collection as the canonical population source for teacher analytics and student My Assignments queries. Sessions and attempts remain owned by the assessment pipeline. No new lifecycle field is introduced on the assignment record itself.
- PDR-027 is preserved. Google Classroom publication continues to create one assignment per class and never adds recipients silently on the LyfeLabz side; a late Classroom-side add follows PDR-029h.
- PDR-028 is preserved. Recipient records do not carry a denormalized display name; the canonical resolver in `ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md` continues to render names on any teacher-facing surface.
- PDR-011 is preserved. Personal-data minimization continues to prohibit denormalized personal data on recipient records.
- PDR-017 is preserved. A single canonical writer for recipient records at first publication, a single canonical writer for the late-recipient add, and a single canonical reader per surface avoid duplicating the trust boundary.

**Anti-decisions.**

- PDR-029 does not introduce a top-level `assignmentRecipients` collection. PDR-029 does not authorize an embedded recipient array or map on the assignment document. PDR-029 does not authorize automatic addition of newly enrolled students to previously published assignments. PDR-029 does not authorize client-side recipient writes. PDR-029 does not authorize teacher-side deletion of recipient records. PDR-029 does not authorize parent, co-teacher, district-administrator, or school-administrator recipient reads. PDR-029 does not introduce a per-recipient window override, a per-recipient mode override, or a per-recipient assessment revision. PDR-029 does not authorize using raw `score` as a cross-revision comparability field. PDR-029 does not authorize using latest-attempt or first-attempt as the representative attempt for aggregate assignment metrics. PDR-029 does not authorize adding a `districtAdministrator` or `schoolAdministrator` role to any recipient callable. PDR-029 does not commit any code, Firestore Rules, index, schema, dependency, or configuration change.

**Consequences.**

- Sprint 12E Slice 1 remains conditionally certified until the `assessmentAssignmentSummary` callable is remediated to read the frozen recipient collection instead of the current active enrollment roster.
- A follow-up implementation slice (recommended: Sprint 12E Slice 2) is required to introduce the recipient collection, wire recipient writes into `assignmentsPublish`, add the explicit manual-addition callable, extend Firestore Rules, and extend the assessment session and attempt callables to enforce recipient membership. The recommended sequence is 2A (data model and publication writer), 2B (session and attempt enforcement), and 2C (summary migration and Sprint 12E Slice 1 recertification).
- Historical accuracy of the assignment summary improves once Sprint 12E Slice 2C lands. Until then, the completion report for Sprint 12E Slice 1 continues to state the historical-accuracy deviation.

**Alternatives considered.**

- Latest-attempt or first-attempt as the representative attempt: rejected. Latest-attempt punishes improvement and violates "Celebrate Improvement." First-attempt hides growth and violates "Preserve Learning Across Years." Both fail the "Learning Belongs to the Student" principle at the aggregate layer.
- Top-level `assignmentRecipients` collection: rejected as canonical shape. It fragments the assignment ownership rules across two roots, complicates rules composition, and duplicates the assignment index strategy. The subcollection shape keeps recipients inside the assignment boundary.
- Embedded recipient array or map on the assignment document: rejected. It risks the Firestore document-size limit at even moderate roster sizes, forces every recipient write to contest the assignment document, and breaks the append-only immutability contract at the field level.
- Automatic addition of every newly enrolled student to every previously published assignment: rejected. It rewrites history, punishes teachers who use archival gestures instead of unassignments, and violates "Save Teachers Time" by creating notifications and audit noise the teacher did not authorize.
- Silent recipient removal on unenrollment: rejected. It rewrites history, hides evidence of prior learning, and violates "Preserve Learning Across Years."

**Future Reconsideration Criteria.**

- A bulk "assign to newly enrolled students" gesture may be added when a superseding sprint authorizes it and defines the ownership check, audit event, and rate limits.
- An administrative recipient invalidation path may be added when operational evidence demonstrates a real correction workflow. Invalidation MUST preserve attempt history.
- Persistent `assignmentRollups` and `attemptRollups` become mandatory when observed class sizes or query volume exceed the bounded pilot envelope. Rollup adoption MUST preserve PDR-029a, PDR-029b, PDR-029c, and PDR-029d verbatim.

---

## Change Log

- 2026-07-07 - Initial platform decision record established.
- 2026-07-09 - PDR-018 (Teacher Experience Surface Boundaries) added.
- 2026-07-10 - PDR-019 (LMS Integration Posture) added. PDR-015 amended to reference the ratified LMS integration architecture.
- 2026-07-10 - PDR-020 (LMS Phase Re-Sequencing and Initial Scope) added. PDR-015 and PDR-019 amended to remove the Phase 8 gate for the initial LMS scope. Google Classroom formally authorized as the initial LMS implementation target. Provider neutrality reaffirmed as a permanent architectural property.
- 2026-07-12 - PDR-021 (Assessment Pipeline Architecture) added under Sprint 9A. PDR-008 amended with a Sprint 9A Reconciliation Notice recording the Submission → Attempt terminology change, the session/attempt separation, the server-authoritative scoring rule, and the removal of the Practice / Classroom mode toggle. `ASSESSMENT_PIPELINE_SPECIFICATION.md` established as the single source of truth for formative assessment behavior.
- 2026-07-12 - PDR-022 (Platform Operations Architecture) added under Sprint 9B. PDR-014 amended with a Sprint 9B Reconciliation Notice ratifying Firebase Hosting as the permanent canonical production origin, replacing the Testing environment nomenclature with Preview, and naming Platform Administrator approval as the load-bearing human gate. `PLATFORM_OPERATIONS_SPECIFICATION.md` established as the single source of truth for LyfeLabz operational behavior.
- 2026-07-12 - PDR-023 (Identity and Onboarding Architecture) added under Sprint 9C. PDR-003 amended with a Sprint 9C Reconciliation Notice retiring the maintained verified-domain automated verification path in favor of the verification-code path with the Request Teacher Access fallback. PDR-015 amended with a Sprint 9C Reconciliation Notice promoting the District entity from reachable expansion to a first-class security boundary. `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` established as the single source of truth for LyfeLabz identity, onboarding, verification, roster authority, and the authenticated experience shell.
- 2026-07-12 - PDR-024 (Platform Transition and Pilot Readiness) added under Sprint 9D. PDR-022 amended with a Sprint 9D Reconciliation Notice adding a product readiness bar alongside the operational Pilot Readiness bar. `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` established as the single source of truth for teacher onboarding, teacher workspace philosophy, the student assignment and results experience, the Google Classroom integration philosophy, the learning archive, notifications, the long-term student learning journey, and the pilot transition.
- 2026-07-12 - PDR-025 (District Security Boundary Implementation Contract) added under Sprint 10A step F-1. `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` established as the single source of truth for server-side enforcement of the district tenancy boundary across Firestore, Cloud Functions, custom claims, session behavior, and audit events. Narrow reconciliation notices applied to `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LMS_INTEGRATION_ARCHITECTURE.md`, and `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` retiring the residual "reserved `districtId`" language.
- 2026-07-12 - PDR-026 (Assessment Implementation Contract) added under Sprint 10A step F-2. `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` established as the single source of truth for server-side implementation of the formative assessment pipeline, including sessions, attempts, revisions, answer keys, callable ownership, Firestore collection ownership, index strategy, audit events, and error semantics. Narrow reconciliation notices applied to `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, and `ASSESSMENT_PIPELINE_SPECIFICATION.md` pointing implementation questions at the new contract without amending PDR-021 or PDR-008.
- 2026-07-12 - PDR-027 (Google Classroom Deep-Link Implementation Contract) added under Sprint 10A step F-3. `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` established as the single source of truth for server-side implementation of Google Classroom deep-link resolution, assignment resolution, URL contracts, security boundaries, multiple-class publication behavior, multiple-teacher publication behavior, Classroom synchronization ownership, and the Cloud Function and Firestore ownership of publication records. Narrow reconciliation notices applied to `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_EXPERIENCE.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, and `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` pointing implementation questions at the new contract without amending PDR-019, PDR-020, or PDR-024.
- 2026-07-12 - PDR-028 (Roster Display Name Implementation Contract) added under Sprint 10A step F-4. `ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md` established as the single source of truth for canonical ownership of teacher-readable roster display names across users, enrollments, roster placeholders, Google profile interaction, LMS roster refresh, teacher roster resolution, and the Firestore, Cloud Function, and audit ownership of every writer that produces a name a teacher will read. Narrow reconciliation notices applied to `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`, `LMS_INTEGRATION_ARCHITECTURE.md`, and `LMS_EXPERIENCE.md` pointing implementation questions at the new contract without amending PDR-003, PDR-005, PDR-011, PDR-019, or PDR-023.
- 2026-07-16 - PDR-029 (Assignment Summary and Recipient Population Policy) added under Sprint 12E-A. Ratifies the highest-completed-attempt representative policy for aggregate assignment metrics, the deterministic tie-breaking policy, the frozen assignment recipient population captured at first publication, the `assignments/{assignmentId}/recipients/{studentId}` subcollection as the canonical persistence shape, recipient immutability and append-only writes, late-recipient and removed-student behavior, and the interim direct-query pilot policy. Narrow reconciliation notices applied to `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, and `SPRINT_12E_SLICE_1_COMPLETION_REPORT.md` pointing implementation questions at PDR-029 without amending PDR-024, PDR-025, PDR-026, PDR-027, or PDR-028. Sprint 12E Slice 1 remains conditionally certified until the summary callable reads the frozen recipient collection.
