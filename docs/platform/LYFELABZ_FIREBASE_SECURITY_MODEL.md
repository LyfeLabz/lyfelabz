# LyfeLabz Firebase Security Model

**Status:** Canonical
**Stage:** 2A - Implementation Blueprint
**Scope:** Platform-wide security philosophy, ownership, and access model
**Audience:** Security architects, platform engineers, future auditors
**Companion Documents:**
- LYFELABZ_PLATFORM_ARCHITECTURE.md
- LYFELABZ_PLATFORM_DOMAIN_MODEL.md
- LYFELABZ_FIRESTORE_DATA_MODEL.md
- ASSESSMENT_PIPELINE_SPECIFICATION.md
- IDENTITY_AND_ONBOARDING_SPECIFICATION.md

## Sprint 9C Reconciliation Notice

The identity portion of this document is superseded by `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` and PDR-023. Apply the following while reading:

- **District is a required security boundary.** Cross-district reads and writes are refused. Every rule that scopes a read or write by `schoolId` is additionally scoped by the caller's `districtId` claim (reserved by the Cloud Function Charter §2 canonical claim shape).
- **Roster placeholders (`awaitingFirstSignIn`) are readable by the owning teacher and unwriteable by clients.** Placeholder activation is performed only by the callable that resolves first sign-in.
- **Join-code redemption is server-only.** The callable path is the sole producer of an enrollment from a join code. Rules do not permit client-side writes to enrollment documents.
- **Redeeming a join code against an LMS-linked class is refused server-side** with a plain-language error, matching PDR-019i.
- **Verification-code state is default-deny for all client roles.** No client role reads a valid, unredeemed verification code. Redemption is performed by the callable that produces `teachers.verificationApproved` under the verification-code path.
- **The teacher pre-verification identity has no capability-bearing rules.** Rules keyed on `role: "teacher"` require an `active` status per `PLATFORM_STATE_MACHINE.md`.

Where this document and `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` conflict, the specification controls.

---

## Sprint 9A Reconciliation Notice

The formative assessment portion of this document is superseded by `ASSESSMENT_PIPELINE_SPECIFICATION.md` and PDR-021. Read every mention of `submissions` and `submission` under the mapping **Submission → Attempt**. In addition:

- The **Attempt** collection is written only by the Cloud Function scorer. No client role - student, teacher, or administrator - holds a direct write path to an attempt document. Security Rules deny direct client writes; the scorer's admin-authority write path is the only allowed producer.
- A distinct **Session** collection exists for autosaving student working state. Security Rules scope session reads and writes to the owning student and to the platform's session-management callables. Teachers do not read live sessions. Teacher preview never produces a session.
- Answer keys are held in a server-controlled surface that is never delivered to any client role. No Security Rule permits a read of the answer-key surface from any client. Only the scorer, running with admin authority, reads the surface.
- Anonymous callers hold no read or write path to attempts or sessions. Anonymous interaction is stateless.
- Attempts are immutable. Security Rules deny update and delete on the attempt collection for every client role. Administrative correction paths, if introduced, run through an audited server-side callable that writes an adjacent correction record.
- Assignment authorization is class-scoped. A student holds attempt authorization only through an active enrollment in the class referenced by the assignment.
- Session recovery from the archived state occurs only through a server-side callable. Clients cannot promote an archived session back to live on their own authority.

Where this document and the specification conflict, the specification controls.


- LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md
- LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md

---

## Preface

This document defines the canonical security model for LyfeLabz.

It describes WHO can access WHAT, WHY they can access it, and HOW ownership and permissions are enforced across the platform.

It is intentionally implementation-independent. It does not contain Firebase Security Rules, Cloud Function code, configuration files, or JSON. Those artifacts are downstream. Every future Security Rule, Cloud Function, dashboard query, and API surface must conform to the philosophy and boundaries described here.

If a proposed implementation conflicts with this document, the implementation is wrong, or this document must be formally revised through an architectural review.

---

# 1. Security Philosophy

LyfeLabz stores learning artifacts belonging to minors in classrooms operated by teachers who trust the platform. The security model is not a feature. It is a precondition for the platform's existence. Schools cannot adopt LyfeLabz unless the platform can articulate, without hedging, how student data is protected.

The following principles are canonical.

## 1.1 Least Privilege

Every actor receives only the permissions strictly required to perform their role. Teachers do not receive administrator permissions. Students do not receive teacher permissions. Administrators do not receive standing access to student responses. When a role expands, its permissions expand with a documented reason.

## 1.2 Explicit Ownership

Every persistent entity has an explicit, documented owner. Ownership is never implicit, inferred from UI state, or derived from the shape of a URL. If an entity has no owner, it has no reason to exist.

## 1.3 Default Deny

The default answer to any access question is no. Access is granted only when a documented rule specifically permits it. Silence in the model means denial, never permission.

## 1.4 Defense in Depth

No single control is trusted alone. Client-side gating exists for user experience, not security. Server-side rules exist for enforcement. Cloud Functions exist for actions that require elevated trust. Audit logs exist to detect what the other layers missed. A single failure at any layer must not compromise student data.

## 1.5 Privacy by Design

Privacy considerations occur at design time, not remediation time. If a feature would collect personally identifiable information the platform does not need, the feature is redesigned before it is built.

## 1.6 Immutable Ownership

Once an entity is created and its owner is recorded, the owner field cannot be reassigned by any client actor. Ownership transfer, if it ever occurs, is an administrative operation with a full audit trail.

## 1.7 Student Safety First

When two legitimate concerns conflict, student safety wins. A teacher's convenience does not override a student's privacy. A platform administrator's diagnostic curiosity does not override a student's ownership of their work.

## 1.8 Teacher Trust

Teachers are trusted to operate their classrooms. The platform does not treat teachers as suspects. It gives them the authority they need to teach, review, and assess student work within their own class, and no authority beyond that boundary.

## 1.9 Auditability

Every consequential action is recorded. If an action can affect a student's grade, a teacher's roster, an assignment's state, or an account's permissions, it produces an audit event. Auditability is not optional and cannot be disabled per-tenant.

## 1.10 Secure by Default

New features arrive in a secure configuration. There is no "development mode" for production data. There is no unguarded collection. There is no toggle that widens access as a convenience.

## Why These Principles Matter For An Educational Platform

Educational platforms are held to a higher standard than consumer products. Students cannot consent in the way adults can. Parents delegate trust to schools. Schools delegate trust to the platform. When that chain of trust breaks, the harm is not commercial. It is educational, developmental, and personal. These principles exist because the population LyfeLabz serves cannot advocate for itself in the ways adults can.

---

# 2. Security Goals

The security model exists to achieve concrete goals. These goals are the criteria against which every future feature and rule is evaluated.

## 2.1 Protect Student Data

Student responses, identifiers, and learning artifacts are protected from unauthorized access, modification, and disclosure.

## 2.2 Isolate Classrooms

A teacher's class is a sealed unit. Data does not leak between classrooms, teachers, or schools.

## 2.3 Prevent Unauthorized Access

Every access is authenticated, authorized, and traceable. Anonymous access is limited to genuinely public curriculum content.

## 2.4 Preserve Assessment Integrity

Once a submission is finalized, it cannot be silently altered. Grades and evidence of learning must be trustworthy.

## 2.5 Minimize Personally Identifiable Information

The platform collects the minimum PII required to operate. Optional PII is genuinely optional. Collected PII has a documented lifecycle.

## 2.6 Maintain Auditability

Every consequential action produces a durable, tamper-evident record.

## 2.7 Support Future District Deployments

The model must extend cleanly to district-scale deployments without requiring architectural rewrites. School and district administrator roles have reserved slots in the ownership model, even before they are implemented.

## 2.8 Enable Confident Adoption

A school administrator reviewing this model should be able to approve LyfeLabz for deployment without carve-outs, side agreements, or additional protective infrastructure.

---

# 3. Trust Boundaries

A trust boundary marks a transition in what an actor is permitted to see or do. Every boundary in LyfeLabz is enumerated below.

## 3.1 Public

The unauthenticated internet.

**May access:** Marketing content, public curriculum lessons, public documentation, structural pages that reveal no student or class information.

**May not access:** Any user record, class record, roster, submission, assignment, audit event, or teacher preference. Not even in aggregate.

## 3.2 Anonymous Visitor

A browser session with no authenticated identity, interacting with the site.

**May access:** The same content as Public. May exercise curriculum tools that do not persist data server-side.

**May not access:** Any Firestore document that references a specific user, class, or submission.

## 3.3 Authenticated User

A user who has proven their identity but whose role has not yet been established for the current context.

**May access:** Their own account record. Their own profile. Nothing else by default.

**May not access:** Any other user's data, any class they are not a member of, any submission that is not theirs.

## 3.4 Student

A user whose active role in a given class is student.

**May access:**
- Their own account and profile
- Classes in which they are actively enrolled
- Assignments that have been published to those classes
- Their own submissions in those assignments
- Their own audit events, to the extent they are surfaced

**May not access:**
- Rosters of their class beyond what the UI intentionally exposes
- Other students' submissions
- Teacher-only assignment metadata (answer keys, grading notes)
- Any class in which they are not enrolled
- Archived classes, unless read-only historical access is explicitly granted

## 3.5 Teacher

A user whose active role includes teacher, scoped to specific classes they own or co-teach.

**May access:**
- Their own account and profile
- Classes they own or co-teach
- Rosters of those classes
- Assignments they created within those classes
- Submissions from students in those classes
- Aggregate rollups for those classes
- Their own teacher preferences
- Audit events they generated

**May not access:**
- Classes owned by other teachers
- Submissions from students in classes they do not teach
- Other teachers' preferences
- Platform-level administrative surfaces

## 3.6 Platform Administrator

A LyfeLabz operator responsible for platform health, support, and integrity.

**May access:**
- Structural metadata: class existence, teacher existence, enrollment counts
- Audit event streams for investigation
- Feature-flag and configuration surfaces
- Any surface required to diagnose a reported incident, subject to Section 10

**May not routinely access:**
- Student submission content
- Teacher grade rollups
- Assessment responses

Content access by administrators is an exceptional, audited operation, not a standing privilege.

## 3.7 Future School Administrator

A user representing a school, with authority over that school's classes, teachers, and enrollments.

**Reserved permissions:**
- Read school-scoped metadata
- Manage teacher accounts at the school
- View aggregate school-level reports
- Never read individual student responses unless a documented policy permits it

## 3.8 Future District Administrator

A user representing a district, with authority spanning multiple schools.

**Reserved permissions:**
- Read district-scoped metadata
- Manage school administrator accounts
- View aggregate district-level reports
- Never read individual student responses unless a documented policy permits it

## 3.9 System (Cloud Function Context)

The platform itself, executing privileged operations on behalf of users.

**May access:** Whatever a specific operation requires, scoped to that operation's purpose. System context is not a general-purpose admin. Each Cloud Function has a documented purpose and touches only the data required for that purpose.

## 3.10 External LMS Providers

External learning management systems that LyfeLabz integrates with under PDR-019 and `LMS_INTEGRATION_ARCHITECTURE.md`. Google Classroom is the initial provider. Canvas, Schoology, and Teams for Education are reserved as future providers.

An external LMS is a data source and a publication target, not a security actor inside LyfeLabz. It is never trusted to make an authorization decision inside the platform.

**LyfeLabz trusts an external LMS to:**

- Return the classes an authenticated teacher teaches when a server-side Cloud Function asks for them under a scope the teacher granted.
- Return the roster of a class the teacher has explicitly opted to import.
- Accept a LyfeLabz-authored assignment publication under a scope the teacher granted.
- Reject any request whose OAuth token has been revoked upstream.

**LyfeLabz does not trust an external LMS to:**

- Establish a LyfeLabz identity. LyfeLabz identity remains established by Google Sign-In through Firebase Authentication per PDR-002.
- Grant, elevate, or revoke a LyfeLabz role or `schoolId` claim. Claims remain a Cloud Function Charter concern per PDR-019f.
- Determine LyfeLabz class ownership. PDR-005 and PDR-019j remain authoritative.
- Author or mutate a LyfeLabz assignment record. Publication is one-way per PDR-019d.
- Author or mutate a LyfeLabz submission. Submissions remain owned by the student and finalized only by the certified Cloud Function per PDR-008.
- Delete LyfeLabz historical data. An upstream deletion becomes a signal, not an authority; the mirror is marked broken and the LyfeLabz record is preserved.

**Trust boundary invariants:**

- OAuth access tokens and refresh tokens are server-only artifacts. Clients never hold, transmit, or observe an LMS token. Token fields on any Firestore document are unreadable by every client role, including Platform Administrator, without an audited elevation. Token storage and rotation are Cloud Function Charter concerns.
- Clients never make direct HTTP calls to an LMS's REST or gRPC surface. Every LMS request originates in a Cloud Function on behalf of an authenticated teacher.
- The client never computes an LMS API URL from an unvalidated Firestore field.
- Every LMS callable revalidates the Canonical Session Object before acting. LMS callables run only for an `active` teacher; no LMS callable runs for a caller in `provisioned`, `pendingVerification`, `suspended`, or `archived`.
- OAuth scopes are requested incrementally. LyfeLabz never asks for the union of every scope it might ever need. The first scope requested is the minimum required to list a teacher's classes and inspect a class's roster. Additional scopes are requested only when the teacher initiates a workflow that requires them (for example, publishing an assignment).
- Revocation is honored immediately. If the LMS returns an authorization error, the connection is marked `revoked`, affected class links are marked `stale`, and the teacher sees a plain-language message on next visit.

**Ownership boundaries for LMS mirror records:**

- `lmsConnections/{connectionId}` is readable only by the connection's owning teacher (through the fields that do not carry the token reference) and by Platform Administrator under audit. The token reference itself is unreadable by any client role.
- `lmsClassLinks/{linkId}` is readable only by the teacher who owns the linked LyfeLabz class and by the enrolled student, in the same scoping as the underlying certified `classes/{classId}` and `enrollments/{enrollmentId}` records.
- `lmsRosterLinks/{rosterLinkId}` is readable only by the teacher of the linked class and by the enrolled student it references.
- `lmsAssignmentPublications/{publicationId}` is readable only by the teacher who initiated the publication and by Platform Administrator under audit. It is never readable by students.
- `lmsProviders/{providerId}` is read-only reference data readable by every authenticated user. It contains no PII and no token.
- No LMS integration record is readable by an unauthenticated visitor.

**Privacy expectations.**

- LMS integration does not widen the PDR-011 collection surface. Guardian contact information, LMS-computed grades, disciplinary records, attendance records, non-LyfeLabz assignment submissions or feedback, teacher notes authored inside the LMS, and announcements and comments authored in the LMS are never copied.
- Placeholder enrollments (a student who exists in the LMS roster but has not yet signed into LyfeLabz) carry only the identifier needed to reconcile the sign-in.
- Data minimization (Section 8.9) governs every LMS read.

Concrete Firestore Rules and Cloud Function code are downstream artifacts, authored by the LMS Integration Foundation phase (`TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §4, Phase 9). Nothing in this section authorizes implementation. This section defines the trust boundary that every downstream implementation must satisfy.

---

# 4. Ownership Model

Every entity has one owner. Ownership is the anchor from which permissions derive.

## 4.1 Users

- **Owner:** The user themselves.
- **Editors:** The user, for profile fields. Platform Administrator, for role and status fields, with audit.
- **Readers:** The user. Teachers of classes the user is enrolled in, limited to roster-appropriate fields. Administrators.
- **Administrators:** Platform Administrator. Future School and District Administrators for their scope.

**Why it matters:** A user's identity is the primary key of trust. If ownership of the user record can be reassigned by a client, every downstream permission collapses.

## 4.2 Schools

- **Owner:** Platform Administrator, until Future School Administrator is introduced.
- **Editors:** Platform Administrator. Future School Administrator.
- **Readers:** Any teacher or student whose class references the school.
- **Administrators:** Platform Administrator. Future District Administrator.

## 4.3 Classes

- **Owner:** The creating teacher.
- **Editors:** The owning teacher. Future co-teachers, when co-teaching is implemented.
- **Readers:** The owning teacher, co-teachers, and enrolled students, each with role-scoped visibility.
- **Administrators:** Platform Administrator. Future School Administrator for the school in scope.

**Why it matters:** The class is the smallest unit of educational trust. Every submission, assignment, and roster fact is anchored to it.

## 4.4 Enrollments

- **Owner:** The class the enrollment belongs to. Effectively, the owning teacher.
- **Editors:** The owning teacher.
- **Readers:** The owning teacher. The enrolled student, for their own enrollment record.
- **Administrators:** Platform Administrator.

**Why it matters:** Enrollment is the gate through which a student earns access to class-scoped data. Enrollment tampering is privilege escalation.

## 4.5 Assignments

- **Owner:** The teacher who created the assignment, within the class it belongs to.
- **Editors:** The owning teacher.
- **Readers:** The owning teacher. Enrolled students, once the assignment is published.
- **Administrators:** Platform Administrator.

## 4.6 Lessons (Curriculum Content)

- **Owner:** LyfeLabz, as authored educational content.
- **Editors:** LyfeLabz content authors, out of band from the runtime data model.
- **Readers:** Public, unless a lesson is marked non-public.
- **Administrators:** Platform Administrator.

**Why it matters:** Curriculum content is not user data. It has different lifecycle rules and is intentionally distinct from student-generated data.

## 4.7 Assessment Submissions

- **Owner:** The student who created the submission.
- **Editors:** The student, while the submission is in draft. No one, once finalized. Corrections occur through a resubmission, not a mutation.
- **Readers:** The student. The teachers of the class in which the submission was made.
- **Administrators:** Platform Administrator, exceptionally, with audit.

**Why it matters:** The submission is the artifact of learning. If it can be edited invisibly, assessment collapses.

## 4.8 Assessment Rollups

- **Owner:** The class the rollup summarizes.
- **Editors:** System, exclusively. Rollups are derived, not authored.
- **Readers:** The teachers of the class.
- **Administrators:** Platform Administrator.

## 4.9 Audit Events

- **Owner:** The platform.
- **Editors:** None. Audit events are append-only.
- **Readers:** Platform Administrator. Restricted subsets for teachers and future school administrators, in defined circumstances.
- **Administrators:** Platform Administrator, for retention and export operations, never for deletion of individual events.

## 4.10 Teacher Preferences

- **Owner:** The teacher.
- **Editors:** The teacher.
- **Readers:** The teacher. System, when a preference is read to render a class experience.
- **Administrators:** Platform Administrator, exceptionally.

## Why Ownership Matters

Ownership converts a philosophical question ("who should be able to do this?") into a mechanical one ("is the requester the owner, or a party the owner has been designated to trust?"). Without explicit ownership, every rule becomes a guess. With explicit ownership, every rule becomes a check.

---

# 5. Permission Model

Permissions are the verbs of the security model. Each permission is defined once and applied consistently.

## 5.1 Read

View the contents of an entity. Reading is the most common permission and the most easily over-granted.

## 5.2 Create

Bring a new entity into existence, with the requester recorded as its owner where applicable.

## 5.3 Update

Modify an existing entity. Update permissions are always narrower than the full document; specific fields may be updatable while others are frozen.

## 5.4 Archive

Move an entity to an inactive state without destroying it. Archiving preserves data for audit and history while removing it from active workflows.

## 5.5 Delete

Permanently remove an entity. In LyfeLabz, delete is reserved for a small set of well-defined cases. Most "deletion" in the product is archival.

## 5.6 Review

View a submission for the purpose of assessment. Review is a distinct permission from Read because it carries a different audit weight and is only meaningful for teachers over their own class's submissions.

## 5.7 Finalize

Transition a submission from draft to finalized, freezing its content. Finalize is a system-only permission, invoked on behalf of the student, executed by Cloud Function.

## 5.8 Administer

Perform structural changes: role changes, ownership transfers, retention actions, support access. Administer is the highest permission and always audited.

## Role-to-Permission Mapping (High Level)

| Role | Read | Create | Update | Archive | Delete | Review | Finalize | Administer |
|---|---|---|---|---|---|---|---|---|
| Public | Public content only | No | No | No | No | No | No | No |
| Anonymous Visitor | Public content only | No | No | No | No | No | No | No |
| Authenticated User | Own account | Own profile fields | Own profile fields | No | No | No | No | No |
| Student | Own data, enrolled class content | Own submissions (draft) | Own submissions (draft) | No | No | No | No | No |
| Teacher | Own classes and their contents | Classes, assignments, enrollments in owned classes | Owned entities | Owned classes and assignments | No, direct destructive delete is disallowed | Submissions in owned classes | No | No |
| Platform Administrator | Metadata universally; content by exception | Platform-scoped entities | Role and status fields | Any entity | Reserved and audited | Exceptional | No | Yes |
| Future School Admin | School-scoped metadata | Teacher accounts in school | School-scoped fields | School-scoped | No | No | No | Scoped to school |
| Future District Admin | District-scoped metadata | School admin accounts | District-scoped fields | District-scoped | No | No | No | Scoped to district |
| System (Cloud Function) | As required by function purpose | As required | As required | As required | As required | No | Yes | As required |

Finalize is exclusively a System operation. No human role finalizes submissions directly.

---

# 6. Classroom Isolation

Classrooms are the atomic unit of educational trust. They must remain isolated in every dimension.

## 6.1 Teacher-to-Teacher Isolation

A teacher cannot view another teacher's class, roster, assignments, submissions, or rollups. There is no "faculty view." A teacher who is not on the roster of a class has, for the purposes of that class, the permissions of an Authenticated User.

## 6.2 Class-to-Class Isolation

A student in Class A cannot see anything belonging to Class B, even if the same teacher owns both. Classes do not share rosters, assignments, or submissions by default.

## 6.3 Archived Class Protection

An archived class is not a public class. Archived class data remains protected under the same rules as active class data. Archiving reduces workflow visibility, not privacy protection. Retention and export policies for archived classes are defined separately and are audited.

## 6.4 Co-Teaching (Future)

When co-teaching is implemented, co-teachers receive the same class-scoped permissions as the owning teacher, with one exception: destructive administrative operations on the class itself remain with the owner or a Platform Administrator. Co-teaching is an additive permission, never a transfer of ownership.

## 6.5 Cross-Class Aggregation

Aggregations that span multiple classes are a Platform, School, or District Administrator concern. Teachers do not receive cross-class views by default.

## 6.6 Isolation Invariants

The following statements must always be true:

- A query that does not name a specific class returns no class-scoped data.
- A query that names a class returns data only if the requester is on that class's roster in a compatible role.
- Removing a student from a class terminates their access to that class immediately, subject to a documented grace period for their own submissions if any.

---

# 7. Assessment Security

Assessment v2 is the most sensitive surface in the platform. Its integrity is the difference between LyfeLabz being a curriculum site and LyfeLabz being an assessment platform schools can rely on.

## 7.1 Immutable Finalized Submissions

Once a submission is finalized, its content is immutable. No client operation, no teacher action, and no ordinary administrative action can rewrite a finalized submission. A correction is a new submission, not an overwrite. The historical submission remains for audit.

## 7.2 Cloud Function Finalization

Finalization is performed exclusively by a Cloud Function invoked on behalf of the submitting student. The finalization function verifies:

- The requester is the owner of the submission.
- The submission is in a state permitted to be finalized.
- The submission belongs to a published assignment in a class in which the requester is currently enrolled.
- The finalization event is recorded in the audit stream.

No client-side finalization exists. There is no "trust the client to say this is done" path.

## 7.3 Ownership

Submissions are owned by the student. Ownership is stamped at creation and is immutable. Teachers do not own student submissions. Teachers may review them.

## 7.4 Review Permissions

A teacher may review submissions only for classes they own or co-teach. Review is auditable. A teacher who leaves a class loses review access at the moment their teaching role ends.

## 7.5 Resubmission Policy

Resubmission is a policy of the assignment, not a permission of the actor. An assignment either permits resubmission or does not. When resubmission is permitted, the new submission is a distinct document. The previous finalized submission remains preserved.

## 7.6 Auditability

Every finalization, every teacher review action that mutates rollup state, and every administrative access to submission content produces an audit event. The audit event names the actor, the target, the timestamp, and the reason where structured.

## 7.7 Why Assessment Integrity Is Critical

If a student's finalized answer can silently change, the platform is not a place where evidence of learning is safe. Teachers grade what they see. Schools trust what teachers grade. Parents trust what schools report. The chain begins at the submission. If the submission is not stable, nothing downstream is.

---

# 8. Privacy Model

Privacy is not a feature layered on top. It is a property of the data model.

## 8.1 Student Identity

Student identity is minimized to what is required for a teacher to recognize their student and for the student to recognize their own account. Full legal names, home addresses, phone numbers, and non-school email addresses are not collected. The student identity model reflects the classroom, not the person.

## 8.2 Teacher Identity

Teacher identity includes a display name and the school affiliation required for classroom operation. Additional teacher metadata (department, credentials, personal notes) is optional and, where collected, is teacher-visible only unless explicitly shared.

## 8.3 School Information

School records include the operational identifiers needed to route classes, teachers, and future school administrators. School records do not include commercial, financial, or non-educational metadata.

## 8.4 Assessment Responses

Assessment responses are the highest-sensitivity content in the platform. They are readable only by the student and their class's teachers. Administrators do not read assessment responses as part of ordinary operation.

## 8.5 Show Your Thinking Responses

Show Your Thinking responses are formative artifacts. They are treated with the same privacy protection as assessment responses, even when they are ungraded, because they capture student thought in written form.

## 8.6 Audit Records

Audit records may contain identifiers of actors and targets. Audit records are protected against modification and are readable only by roles authorized to investigate.

## 8.7 FERPA Alignment

LyfeLabz treats student data as an educational record under FERPA. Access is restricted to school officials with legitimate educational interest, expressed in this model as the student's teacher and, in the future, appropriate administrators. Disclosure outside those parties is not part of ordinary operation.

## 8.8 COPPA Alignment

LyfeLabz operates in a school context under the school-authorized data collection model. Personal information collected from students is limited to the educational purpose, is not used for marketing, is not shared with third parties for their commercial purposes, and is retained only as long as needed to serve the educational purpose.

## 8.9 Data Minimization

If a field is not required for the educational purpose, the field is not collected. Analytical curiosity does not justify collection. The default answer to "should we also store X?" is no.

## 8.10 Retention Philosophy

Data is retained while it serves an educational purpose. When a class is archived, its data enters a defined retention window governed by school policy. When retention ends, data is removed on a documented schedule. Deletion is not silent; it is an audited administrative operation.

---

# 9. Authentication vs Authorization

Authentication and authorization are distinct and must never be conflated.

## 9.1 Authentication

Authentication answers the question, "Who is this?" It establishes identity. Authentication produces a verified identity token that other layers can rely on. Authentication is a boolean predicate: known or not known.

## 9.2 Authorization

Authorization answers the question, "Is this actor permitted to do this thing to this resource?" It establishes what the identified actor may do. Authorization is contextual, resource-scoped, and always relative to the ownership model.

## 9.3 Identity

Identity is the stable, unique reference to a user. An identity persists across sessions and devices. Identity is not the same as a display name, an email address, or a session cookie. Identity is the anchor to which permissions attach.

## 9.4 Ownership

Ownership binds an identity to a resource. Ownership is a fact recorded on the resource. Ownership is durable and does not change on its own.

## 9.5 Permissions

Permissions are the derived rights that flow from ownership, role, and context. A permission is always a function of who the actor is, what the resource is, and what the actor is trying to do.

## 9.6 How They Work Together

Authentication establishes the actor. Ownership and role establish the actor's relationship to the resource. Permissions govern the specific action. All three layers must succeed for an action to occur. Any layer failing must result in denial.

## 9.7 Common Confusions To Avoid

- Being logged in is not permission.
- Owning one resource is not permission over another.
- Holding a role in one class is not a role in another.
- A public display name is not an identity.

---

# 10. Administrative Access

Platform Administrator is a role of last resort, not a role of convenience.

## 10.1 What Administrators May Access

- Structural metadata: existence of accounts, classes, schools.
- Audit event streams.
- System health and configuration surfaces.
- Feature flag and rollout controls.
- Any surface required to diagnose a specific, reported incident.

## 10.2 What Administrators Should Never Access Unnecessarily

- Student submission content.
- Teacher grade rollups outside of a specific investigation.
- Assessment responses outside of a specific investigation.
- Teacher preferences and personal notes.

The rule is not that administrators cannot access these surfaces. It is that they must not access them casually. Every content access outside of ordinary metadata is audited, justified, and, over time, reviewed.

## 10.3 Support Workflows

When a teacher or school reports an issue, support access follows a defined workflow:

- The reported problem is recorded.
- The scope of access needed is identified in advance.
- Access is exercised within that scope only.
- Access is logged in the audit stream, with the ticket reference where applicable.
- Access is closed when the issue is resolved.

## 10.4 Emergency Access

Emergencies (suspected breach, imminent data loss, safety concern involving a student) may justify broader access. Emergency access requires:

- A stated justification recorded before or immediately after access.
- An audit entry marked as emergency.
- A post-incident review.

Emergency is not a synonym for urgent. It is reserved for genuine emergencies.

## 10.5 Audit Requirements For Administrators

Administrator actions carry higher audit weight than user actions. Every role change, retention action, content access, and configuration change produces a durable, immutable audit event.

## 10.6 Future School and District Administrators

School and District Administrators inherit the same discipline. Their scope is narrower (a school or district). Their audit obligations are the same. They do not automatically inherit content-read permissions over student responses; those permissions require explicit policy.

---

# 11. Audit Philosophy

Audit is the memory of the platform. Without audit, no other control can be verified after the fact.

## 11.1 Authentication Events

- Successful sign-in.
- Failed sign-in attempts, in aggregate patterns.
- Sign-out.
- Session invalidation.
- Password or credential resets, at a metadata level.

## 11.2 Permission Changes

- Role assignments and revocations.
- Enrollment additions and removals.
- Co-teaching additions and removals (future).
- Administrator promotions and demotions.

## 11.3 Assignment Publication

- Publication of an assignment to a class.
- Changes to assignment scope or due date after publication.
- Unpublication or archival.

## 11.4 Submission Finalization

- Every finalization event, with actor, submission, assignment, class, and timestamp.
- Every resubmission event, linked to the prior submission.

## 11.5 Administrative Actions

- Any administrator content access.
- Any role change performed by an administrator.
- Any retention or deletion action.
- Any feature-flag change affecting security posture.

## 11.6 Support Actions

- Impersonation, if ever implemented, is a Tier 1 audit event with mandatory justification.
- Access exercised under a support ticket, linked to the ticket.

## 11.7 Always-Recorded Events

The following events are recorded without exception:

- Submission finalization.
- Role changes.
- Administrator content access.
- Ownership transfers.
- Retention and deletion actions.
- Emergency access.

## 11.7.a LMS Integration Audit Vocabulary

The LMS Integration Foundation phase (Phase 9, per `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §4 and `LMS_INTEGRATION_ARCHITECTURE.md`) extends the audit vocabulary with LMS-scoped event kinds. Every event follows the append-only invariant per PDR-013. Every event carries the canonical `actorUserId`, `actorRole`, `action`, `targetType`, `targetId`, `occurredAt`, and `schoolId` fields defined by the Firestore Data Model.

- `lms.connectionCreated` - a teacher completed an OAuth grant to a supported LMS provider.
- `lms.connectionRevoked` - a teacher disconnected a provider, or the server observed an upstream revocation.
- `lms.classImported` - a teacher imported an LMS class into a LyfeLabz class record.
- `lms.classRefreshed` - a teacher confirmed a manual refresh of a linked class.
- `lms.classUnlinked` - a teacher unlinked a LyfeLabz class from its LMS mirror.
- `lms.assignmentPublished` - a teacher published a LyfeLabz assignment to a linked LMS.
- `lms.publishFailed` - a publication attempt failed at the LMS boundary.
- `lms.ownershipDrift` - the server observed that the LyfeLabz-owning teacher is no longer the LMS teacher of record.

These vocabulary terms are reserved by this document and become live audit terms only when the LMS Integration Foundation phase is scheduled. No sprint may extend the vocabulary silently.

## 11.8 Audit Properties

Audit events are:

- Written to the Firestore `auditEvents` collection, which **is** the platform's authoritative append-only sink. Cold-storage export is a retention mirror, not a second sink.
- Append-only, enforced by Security Rules that permit `create` from trusted server context only and forbid `update` and `delete` for every role, including Platform Administrator.
- Immutable to every actor, including Platform Administrator. Retention operations export records to cold storage and prune the live collection; they never edit records in place.
- Retained on the documented schedule in PDR-013.
- Structured, with a defined schema per event type.
- Searchable by actor, target, and time range through Platform Administrator surfaces.

Audit is not observability. It is not analytics. It has a different retention policy, a different access model, and a different tolerance for gaps (which is zero).

---

# 12. Threat Model

The threats considered below are realistic for a school-facing platform. Each is paired with likelihood, impact, and mitigation philosophy. Specific mitigations are implementation details defined downstream.

## 12.1 Unauthorized Student Access

A student attempts to access data in another class or another student's submission.

- Likelihood: Moderate. Curiosity and experimentation are common.
- Impact: Moderate to High, depending on the data reached.
- Mitigation Philosophy: Class-scoped authorization on every read. No cross-class inference. No client-controlled ownership.

## 12.2 Teacher Account Compromise

A teacher's credentials are stolen or misused.

- Likelihood: Moderate. Educators are frequent phishing targets.
- Impact: High. A teacher account can reach every submission in every class they own.
- Mitigation Philosophy: Strong authentication, session hygiene, audit visibility into unusual patterns, and rapid revocation paths.

## 12.3 Malicious Submissions

A student submits content designed to attack the platform or other users (script injection, oversized payloads, malformed structures).

- Likelihood: Moderate. Students test boundaries.
- Impact: Ranges from cosmetic to serious.
- Mitigation Philosophy: Server-side validation of submission structure. Rendering that treats submission content as untrusted. No client that trusts server-returned strings as HTML.

## 12.4 Privilege Escalation

A user attempts to grant themselves a role they should not have, by writing to fields that are not theirs to write.

- Likelihood: Low, but nonzero.
- Impact: Very High if successful.
- Mitigation Philosophy: Role fields are administered exclusively by administrators or by system context. Clients cannot write role fields directly.

## 12.5 Accidental Data Exposure

A UI accidentally exposes data the user is technically permitted to fetch but should not see in that context.

- Likelihood: Moderate over time.
- Impact: Moderate.
- Mitigation Philosophy: Rules are the enforcement, not the UI. When rules are tight, UI mistakes stay cosmetic.

## 12.6 Stolen Devices

A student or teacher device is lost or stolen with an active session.

- Likelihood: Moderate.
- Impact: Ranges from minor to serious depending on session lifetime.
- Mitigation Philosophy: Bounded session lifetimes, session revocation paths, and awareness that a stolen device is a compromised session.

## 12.7 Shared Computers

Multiple students share a device in a classroom lab.

- Likelihood: High. This is the norm in many schools.
- Impact: Moderate.
- Mitigation Philosophy: Explicit sign-out flows. No indefinite sessions. UI defaults that assume the next user is different.

## 12.8 Phishing

A user is tricked into surrendering credentials.

- Likelihood: Moderate.
- Impact: Depends on the compromised account.
- Mitigation Philosophy: Authentication mechanisms resistant to phishing where possible. Communication conventions that make impersonation harder.

## 12.9 Improper Administrator Access

An administrator accesses content without a legitimate reason.

- Likelihood: Low, but must be treated as nonzero.
- Impact: High for the affected students and for trust in the platform.
- Mitigation Philosophy: Content access by administrators is exceptional, audited, and reviewed. Curiosity is not a justification.

## 12.10 Insider Threats

A LyfeLabz operator uses their access improperly.

- Likelihood: Low.
- Impact: Very High.
- Mitigation Philosophy: Same as improper administrator access. Structural minimization of who can access what. Audit review that is genuine, not ceremonial.

## 12.11 Third-Party Dependency Compromise

A dependency the platform relies on becomes compromised.

- Likelihood: Low per incident, nontrivial over time.
- Impact: Varies widely.
- Mitigation Philosophy: Minimized dependency surface. Awareness that the platform's security is bounded by its dependencies.

---

# 13. Security Anti-Patterns

The following practices must never appear in LyfeLabz. Their absence is part of the definition of a correct implementation.

## 13.1 Client-Controlled Ownership

Ownership fields written by client code, based on client-supplied identity. Ownership is stamped by trusted server context, always.

## 13.2 Client-Finalized Submissions

A submission finalized because a client said so. Finalization is a Cloud Function operation, invoked with server-verified identity.

## 13.3 Ownership Inferred From UI

Access decisions that depend on "we don't render this button unless you're the owner." Rules enforce ownership; the UI merely reflects it.

## 13.4 Unrestricted Collection Reads

A collection that any authenticated user can list. Every collection has a defined scoping rule. There are no open collections.

## 13.5 Trust Based On Hidden UI Elements

Security by obscurity of navigation. Hidden is not protected. A hidden route with real data behind it is exactly as unsafe as a visible one.

## 13.6 Storing Unnecessary Personal Information

Collecting fields "in case we need them." If a field has no defined educational purpose, it is not collected.

## 13.7 Privilege Checks Only In The Client

Rules that exist only in application code. Server rules are the source of truth. Client rules are a UX aid.

## 13.8 Silent Mutation Of Finalized Data

Any code path that rewrites a finalized submission, a resolved audit event, or a completed rollup without recording the change. Silent mutation is not permitted anywhere.

## 13.9 Blanket Administrator Reads Of Student Content

Administrator dashboards that display raw student submission content as a matter of course. Content access is exceptional.

## 13.10 Cross-Tenant Queries By Default

Queries that assume "one big collection" and scope by client-side filter. Scoping is a server-enforced property of the query, not a client convenience.

## 13.11 Long-Lived Credentials In Client Code

Any secret, API key, or service credential embedded in a client bundle. Client code is public; anything shipped in it is public.

## 13.12 Ambient Authority

Actions that occur because the actor is signed in, without the specific resource being consulted for permission. Every action names a resource and asks its rule.

---

# 14. Security Review Checklist

Every future feature must pass this checklist before implementation begins. This checklist is applied by the feature author and reviewed by a second engineer.

- [ ] **Ownership defined.** Every new entity has an explicit owner, and the owner is stamped by trusted context.
- [ ] **Permissions documented.** Read, Create, Update, Archive, Delete, Review, Finalize, and Administer permissions are defined per role for the new surface.
- [ ] **Least privilege maintained.** The feature does not grant permissions broader than its educational purpose requires.
- [ ] **Default deny preserved.** New collections and fields are inaccessible unless a specific rule permits them.
- [ ] **Trust boundaries respected.** The feature does not cross Public, Student, Teacher, or Administrator boundaries incorrectly.
- [ ] **Classroom isolation preserved.** The feature does not leak data between classes, teachers, or schools.
- [ ] **Assessment integrity preserved.** The feature does not enable client-side finalization or silent mutation of finalized content.
- [ ] **Privacy reviewed.** The feature does not collect PII beyond documented need. Any new field has a documented educational purpose.
- [ ] **FERPA and COPPA alignment considered.** The feature does not disclose educational records outside the permitted parties.
- [ ] **Audit events identified.** Every consequential action in the feature produces an audit event of the defined shape.
- [ ] **Data retention considered.** The feature's data has a documented lifecycle, including archive and end-of-retention behavior.
- [ ] **Threat model reviewed.** The feature has been considered against the threats in Section 12.
- [ ] **Anti-patterns absent.** No item from Section 13 appears in the design or implementation.
- [ ] **Rules-first enforcement.** Server rules enforce every access decision. Client behavior does not substitute for rules.
- [ ] **Cloud Function scope minimized.** If the feature uses a Cloud Function, the function's data access is scoped to its purpose.
- [ ] **Administrative access considered.** If the feature exposes an administrator surface, access is exceptional and audited.
- [ ] **Future roles reserved.** The design does not preclude clean introduction of School and District Administrators.
- [ ] **UI does not carry authority.** No security decision is made by hiding a UI element.
- [ ] **Errors do not leak.** Error messages do not reveal the existence, ownership, or content of resources the caller cannot access.
- [ ] **Session assumptions documented.** The feature's assumptions about session lifetime and shared-device use are recorded.

A feature that cannot pass this checklist is not ready for implementation. It is ready for redesign.

---

# 15. Readiness Assessment

**Question:** If you were responsible for protecting LyfeLabz over the next five years, would you approve this security model for implementation?

**Answer:** Yes, with the qualifications below.

This document establishes a defensible security model for a school-facing educational platform. It defines ownership as the anchor of all access decisions, treats classrooms as sealed units, protects assessment integrity through system-only finalization, and reserves capacity for the future roles (School Administrator, District Administrator, co-teaching) the platform will need to grow.

The model is implementation-independent. Its principles will still be correct when the specific rules, functions, and dashboards downstream of it are rewritten. That property, not any specific rule, is what makes it a durable foundation.

**What still needs to happen before implementation begins:**

1. **A parallel Data Handling Policy.** This document defines who may access what. It does not define how long data is retained, how export requests are processed, or how a school terminates the relationship. A companion Data Handling Policy is needed to close that gap.

2. **A Cloud Function Charter.** Cloud Functions carry elevated authority. Before functions are written, a short charter should enumerate the permitted purposes for a Cloud Function and the pattern each function must follow (verify identity, verify ownership, verify state, act, audit).

3. **An Incident Response Plan.** The threat model in Section 12 identifies threats. An incident response plan defines how the platform reacts when a threat is realized: who is notified, what is disclosed, on what timeline, and how audit evidence is preserved.

4. **A First Audit Schema.** The audit philosophy in Section 11 defines what must be recorded. Before implementation begins, a first-pass event schema, event types, and required fields should be drafted so that features built against this model produce compatible audit records from day one.

5. **A Retention Schedule.** Data minimization requires that data have an end as well as a beginning. A specific retention schedule for each entity family should accompany the first implementation milestone.

6. **A Review Cadence.** This document should be reviewed at a defined interval (proposed: annually, or on any incident of consequence, whichever comes first). Without a review cadence, security models drift.

Provided these companion artifacts are produced alongside the first implementation, this security model is approved as the canonical foundation for LyfeLabz.

---

# 16. Authenticated Teacher Platform Boundary

This section describes the security posture of the Authenticated Teacher Platform introduced by Sprint 3. It is architectural and behavioral only. It does not introduce a new trust boundary, a new claim, a new lifecycle state, or a new Firestore collection. It refers to concepts defined in Section 3 (Trust Boundaries), Section 9 (Authentication vs Authorization), `PLATFORM_STATE_MACHINE.md`, and `LYFELABZ_PLATFORM_ARCHITECTURE.md` §16.

## 16.1 Canonical Session Bootstrap

Every authenticated LyfeLabz surface initializes its session through exactly one canonical bootstrap. The bootstrap is defined architecturally in `LYFELABZ_PLATFORM_ARCHITECTURE.md` §16.2. From a security perspective, the following invariants hold:

- The bootstrap consumes Firebase Authentication, custom claims, and the Firestore user record in that order. Each is treated as observational; the bootstrap performs no writes.
- The bootstrap forces an ID token refresh before reading claims, closing the narrow window in which an administrative approval has issued fresh claims that a stale token has not yet reflected.
- The bootstrap performs exactly one client-initiated read of `users/{callerUid}` and at most one client-initiated read of `schools/{schoolId}`. Both are already permitted by the affirmative Sprint 2 Firestore Rules. No `list` operation, no cross-user read, and no `auditEvents` read is performed by the client.
- On any disagreement between custom claims and the Firestore user record, the Firestore record is authoritative for `status`, `role`, and `schoolId`. This mirrors the principle in `PLATFORM_STATE_MACHINE.md` §4 that current account state comes from Firestore.

Client-side gating derived from the bootstrap exists for user experience only. Enforcement remains the exclusive responsibility of Firestore Security Rules and Cloud Functions, per Section 1.4 (Defense in Depth). A caller who circumvents the client bootstrap gains no additional authorization; the server-side layers refuse the request regardless.

## 16.2 Protected Teacher Route Authorization

A protected teacher route is any client path whose contents are visible only to an active teacher. The client renders a protected teacher route only when *all* of the following are true, evaluated against the Canonical Session Object:

- The caller is authenticated.
- The caller possesses the teacher custom claim (`role === "teacher"`).
- The caller possesses a valid, non-empty `schoolId` claim.
- The caller has a valid Firestore user record readable under the Sprint 2 self-get rule.
- The user record's `status` is `active`.
- The user record's `role` is `teacher`.
- The user record's `schoolId` matches the `schoolId` on the claim.

These conditions describe client-side gating. They do not replace, weaken, or duplicate the rule and function layers. Every server-side decision continues to derive from the canonical `{ role, schoolId }` claim shape and the affirmative Sprint 2 Firestore Rules.

## 16.3 Authentication Failure State Behavior

The following behavioral descriptions define how the Authenticated Teacher Platform responds when a caller fails the protected-teacher-route conditions. Each name refers to an existing artifact defined by `PLATFORM_STATE_MACHINE.md` §1 or by the Sprint 2 audit vocabulary. Sprint 3 introduces no new lifecycle state.

- **Signed out.** The caller has no Firebase Authentication session. Behavior: the client refuses every protected route and routes to the sign-in surface. No Firestore read is attempted.
- **Provisioned.** `users/{uid}.status === "provisioned"`. Behavior: the client refuses every protected route and routes to the onboarding surface, from which the Sprint 2 onboarding callables may be invoked.
- **Pending verification.** `users/{uid}.status === "pendingVerification"`. Behavior: the client refuses every protected route and routes to a pending surface. The pending surface performs no polling and no write.
- **Rejected teacher activation.** The caller invoked a Sprint 2 onboarding callable and the callable emitted `auth.activationRejected`. The user record remains in `provisioned`. Behavior: the client surfaces a plain-language rejection message. The lifecycle field is not mutated; the rejection is recorded only in the audit stream.
- **Suspended.** `users/{uid}.status === "suspended"`. Behavior: the client refuses every protected route and displays a plain-language message. `suspended` remains a reserved state; Sprint 3 introduces no transition into or out of it.
- **Archived.** `users/{uid}.status === "archived"`. Behavior: the client refuses every protected route and displays a plain-language message. `archived` remains a reserved state; Sprint 3 introduces no transition into or out of it.

In every failure state the client performs no write, initiates no lifecycle transition, and issues no request that would broaden the caller's authorization. Every lifecycle transition remains the exclusive responsibility of the five Sprint 2 callables.

## 16.4 Constraints Preserved

Sprint 3 preserves every Sprint 2 architectural decision. In particular:

- `status` remains the sole lifecycle field.
- Custom claims remain exactly `{ role, schoolId }`. `districtId` is not introduced.
- No new Firestore collection is introduced. No new field is introduced on `users/{uid}`, `schools/{schoolId}`, or `auditEvents/{eventId}`.
- No new affirmative Firestore Rule is introduced beyond the Sprint 2 baseline. The client bootstrap operates entirely inside that baseline.
- No new Cloud Function is introduced. The callable surface remains the five functions delivered in Sprint 2.
- No classroom, enrollment, join-code, assignment, submission, analytics, gradebook, or administrator UI surface is introduced.

Any Sprint 3 pull request that expands the authorization surface beyond what is described here is out of scope and is a defect against this section.

---

## Governance

This document is canonical. It does not change through incidental edits. Modifications require an explicit architectural review, a stated reason, and an updated readiness assessment. Every future Firebase Security Rule, Cloud Function, dashboard, and API must conform to this model. Where a proposed implementation cannot conform, this document is revised first, and the implementation follows.
