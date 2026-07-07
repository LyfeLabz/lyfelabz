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

Teacher role assignment is provisional at first sign-in and confirmed by a verification pathway. Verification prefers automation via known school Workspace domains, backed by manual override by a LyfeLabz administrator. Later, school administrators may verify their own teachers.

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
- Manual verification is performed by a LyfeLabz administrator.
- School administrators (future) may verify their own teachers within their domain.

### Rationale

Domain-based verification is fast for the common case and defensible for the uncommon case. The provisional state is a real, designed screen rather than a locked dashboard, so legitimate teachers are not left guessing.

### Consequences

Benefits:

- Fast onboarding for teachers at partner schools.
- No possibility of an unverified teacher reading student submissions.
- Clear escalation path.

Limitations:

- LyfeLabz administrators are on the critical path for new schools.
- A verified domain list must be maintained as data, not code.

### Future Reconsideration Criteria

Reconsider when a district integration provides authoritative teacher rosters, or when school administrators are broadly available to self-verify.

---

## PDR-004: Closed Role Model

### Decision

LyfeLabz has a small closed set of roles: Anonymous Visitor, Student, Teacher, School Administrator (future), and LyfeLabz Administrator. Every role is additive relative to Anonymous Visitor. A user holds exactly one primary role at a time.

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
- Ownership transfers exist only through an audited LyfeLabz administrator path.
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

### Decision

Submissions are ownership-stamped, immutable-once-finalized records that reference the lesson by identifier and by version. Finalization occurs through a Cloud Function from Version 1. Timestamps are server-set. Retakes create new submissions and preserve prior ones.

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
- Curation never expresses "due," "assigned," or "required."

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
- Archived-class submissions are retained for a defined period (recommended: through the student's expected time in middle school plus one year), then redacted.
- Audit logs are retained separately with their own retention (see PDR-013).

**Guardian considerations.**

- Parent accounts are a future capability with explicit per-student consent.
- Until parent accounts exist, guardian access to a student's LyfeLabz data is provided by the student themselves or by the teacher on request. LyfeLabz administrators do not disclose student data to third parties, including guardians, without an audited process.

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

**Sessions.**

- Session length is set to a value appropriate for shared classroom devices, with an explicit documented number.
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

- Streamed to a separate append-only sink that is not readable or writable by application code.
- Retention: minimum two years, longer for legally significant actions.
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

**Google Classroom integration.** Enabled by enrollment being a source-aware operation (join code, roster sync, manual invite) so roster sync is additive. Reconsidered when demand is documented.

**Canvas integration.** Enabled by identity abstraction and stable class identifiers. Reconsidered when demand is documented.

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

## Change Log

- 2026-07-07 - Initial platform decision record established.
