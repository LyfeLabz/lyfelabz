# LyfeLabz Platform Domain Model

Status: Canonical
Companion to: LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_ARCHITECTURE_REVIEW.md, LYFELABZ_PLATFORM_DECISIONS.md, ASSESSMENT_PIPELINE_SPECIFICATION.md, IDENTITY_AND_ONBOARDING_SPECIFICATION.md

## Sprint 9C Reconciliation Notice

The identity portion of this document is superseded by `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` and PDR-023. Apply the following mappings while reading:

- **District** is a first-class, load-bearing entity. Treat every "Future: District" statement as ratified and read District as the certified security boundary above School.
- **Teacher** identity is district-bound. Section 4 (Ownership Rules) is amended so that a Teacher identity may hold authorized membership in more than one School within the same District. Cross-district teacher continuity does not occur automatically; changing districts produces a new LyfeLabz teacher identity.
- **Join Code** exists only for manual classes. LMS-linked classes never use join codes. Every class has exactly one roster authority (Google Classroom for LMS-linked classes; LyfeLabz for manual classes).
- **Roster placeholder** is introduced as a first-class concept. A roster placeholder in the `awaitingFirstSignIn` state exists on a class before any Student identity is provisioned. First successful Google sign-in activates the placeholder and provisions the LyfeLabz Student ID.
- **Student** identity is created only at first successful Google sign-in, not at roster import. The LyfeLabz Student ID is authoritative; Google is the authentication provider.
- **Assessment Submission** section retains the Sprint 9A mapping to Attempt.

Where this document and `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` conflict, the specification controls.

---

## Sprint 9A Reconciliation Notice

The formative assessment portion of this document is superseded by `ASSESSMENT_PIPELINE_SPECIFICATION.md` and PDR-021. Read every mention of "Submission" or "Assessment Submission" in this document under the mapping **Submission → Attempt**. Additional Sprint 9A points to apply while reading:

- The authoritative record entity is **Attempt**, not Submission. There is no separate Submission entity.
- A **Session** is a distinct entity from an Attempt. Sessions are transient, resumable, autosaving working state; they are never counted as attempts, never appear on any teacher-facing surface as attempts, and are governed by the specification (Sections 6, 8, 9, 10).
- Formative attempts are unlimited by default. "Retake" is reserved for the future summative pipeline and is not a synonym for a repeat formative attempt.
- Scoring is server-authoritative. Answer keys are server-confidential. No browser-authoritative score exists.
- Every assignment belongs to exactly one class. Assigning one activity to multiple classes automatically creates one assignment per class.
- The Practice / Classroom mode toggle described in earlier surface documents is removed. Behavior derives automatically from authentication and authorization.

Where this document and the specification conflict, the specification controls.

---


---

## 1. Introduction

### Purpose

This document defines the LyfeLabz platform in terms of the objects that exist within it and the relationships between them. It is the canonical description of the business domain.

Someone who reads this document should be able to describe the entire platform without ever seeing a line of implementation code, a database schema, or an API definition.

### Business Entities vs Database Entities

A **Business Entity** is a concept that exists in the real world of LyfeLabz. A Teacher exists whether we store their record in a spreadsheet, a relational database, a document store, or on paper. A Lesson exists as an instructional resource regardless of how it is served to a browser.

A **Database Entity** is a technical representation of a Business Entity in a particular storage system. Database entities carry implementation concerns such as identifiers, indexes, denormalization, timestamps, and reference fields.

The Domain Model describes only Business Entities. It describes what exists, who owns it, how it behaves over time, and how it relates to other things.

### Why Implementation Details Are Excluded

The Domain Model must remain stable across many technical decisions. Storage engines may change. Authentication providers may change. Integrations may be added. Client frameworks may be replaced. The business meaning of a Lesson, an Assignment, or a Submission does not change because the storage layer changes.

Excluding implementation details keeps the Domain Model useful across:

- Future storage decisions
- Future integrations with third-party systems
- Future scaling and performance work
- Future organizational structures such as districts and parent accounts

### Position Within Platform Documentation

The Platform Architecture describes the overall system.

The Architecture Review captures cross-cutting concerns and constraints.

The Platform Decision Record captures the deliberate choices that shape the platform.

The Domain Model, this document, defines the vocabulary and structure of the business itself. Every subsequent design document, including the eventual database schema, security model, and API surface, should defer to the vocabulary and rules defined here.

---

## 2. Core Platform Entities

Each entity is described in conceptual terms only.

### Platform

**Purpose.** The overall LyfeLabz system, considered as a single named entity.

**Description.** The Platform is the container in which every other entity exists. It has a public identity, a curriculum, an educator community, and a governance model.

**Owner.** LyfeLabz itself.

**Lifecycle.** Continuous. The Platform does not have a create or archive event.

**Relationships.** Contains Schools, Grades, Units, Lessons, Teachers, Students, Classes, Assignments, and Submissions.

**Notes.** The Platform is intentionally referenced as a distinct entity so that platform-level rules, invariants, and administrators have a clear conceptual home.

---

### School

**Purpose.** An educational institution using LyfeLabz.

**Description.** A School is the organizational context in which Teachers work and Students learn. A School has a name, a location, and, over time, a roster of Teachers.

**Owner.** The Platform, on behalf of the school itself.

**Lifecycle.** Created, Active, Inactive, Archived.

**Relationships.** Contains Teachers. Indirectly contains Classes through those Teachers. In the future, a School may belong to a District.

**Notes.** A School is not a container for Lessons. Instructional content is platform-wide, not school-specific.

---

### Teacher

**Purpose.** An educator who uses LyfeLabz with Students.

**Description.** A Teacher is a verified adult professional. Teachers create Classes, publish Assignments, review Submissions, and maintain Teacher Preferences.

**Owner.** The Teacher owns their own account.

**Lifecycle.** Created, Verified, Active, Inactive, Archived.

**Relationships.** Belongs to one School. Owns Classes. Owns Assignments. Owns Teacher Preferences.

**Notes.** Teachers never own Students. Teachers never own instructional content.

---

### Student

**Purpose.** A learner who participates in LyfeLabz.

**Description.** A Student is a young person who joins Classes and completes Assignments. Students have a name and grade level. Students may participate across multiple school years.

**Owner.** The Student owns their own account. The Platform holds custodial responsibility appropriate to a student user.

**Lifecycle.** Created, Joins Class, Participates, Graduates, Archived.

**Relationships.** Enrolled in Classes through Enrollments. Produces Submissions. Never owns Assignments or Lessons.

**Notes.** A Student's identity is not created by a Teacher. A Teacher may facilitate joining but does not own the Student.

---

### Class

**Purpose.** A group of Students taught by a Teacher during a school year.

**Description.** A Class has a name, a subject or grade context, a school year, and a roster of Students. It is the primary container for classroom activity.

**Owner.** The Teacher who created it.

**Lifecycle.** Created, Active, Archived, Copied into New School Year.

**Relationships.** Belongs to one Teacher. Belongs to exactly one school year. Contains Enrollments. Contains Assignments. Has a Join Code.

**Notes.** A Class is not the owner of Students. It is a context in which Students participate. A Class does not own instructional content.

---

### Enrollment

**Purpose.** The relationship that connects a Student to a Class.

**Description.** An Enrollment records that a specific Student participates in a specific Class during a specific timeframe. It is the connective tissue between Students and Classes.

**Owner.** The Platform, on behalf of both the Teacher and the Student.

**Lifecycle.** Active while the Student participates, Transferred when the Student moves to a different Class, Withdrawn when the Student leaves the Class, Archived when the containing Class is archived. The canonical status vocabulary is `active`, `transferred`, `withdrawn`, `archived`, matching the Firestore Data Model.

**Relationships.** References exactly one Student and exactly one Class.

**Notes.** Ending an Enrollment does not delete a Student. Ending a Class does not delete a Student. Enrollments are the join between two independent long-lived entities.

---

### Grade

**Purpose.** An organizational level of the curriculum.

**Description.** A Grade groups Units and Lessons that share a target grade level. LyfeLabz currently defines Grade 6, Grade 7, and Grade 8.

**Owner.** The Platform.

**Lifecycle.** Continuous. Grades are defined by the curriculum rather than by users.

**Relationships.** Contains Units. Indirectly contains Lessons through those Units.

**Notes.** A Grade is a curricular concept, not an organizational one. It is not a classroom, not a cohort, and not a school year.

---

### Unit

**Purpose.** A coherent conceptual narrative within a Grade.

**Description.** A Unit is a sequence of Lessons united by a shared scientific narrative. In LyfeLabz, Units are conceptual rather than mechanical containers.

**Owner.** The Platform.

**Lifecycle.** Continuous. Units evolve with the curriculum.

**Relationships.** Belongs to a Grade. Contains Lessons.

**Notes.** Units group Lessons narratively. They are not required progressions. Students may traverse Lessons in orders that respect but are not strictly bound to the Unit sequence.

---

### Lesson

**Purpose.** A permanent instructional resource.

**Description.** A Lesson is a fully designed learning experience. It contains hero content, learning goals, vocabulary, explore sections, quick recall, explain, evaluate, more learning, and connections.

**Owner.** The Platform. Lessons are curriculum, not classroom artifacts.

**Lifecycle.** Created, Published, Revised, Retired. Lessons are essentially permanent once published.

**Relationships.** Belongs to a Unit. Referenced by Assignments. Referenced by Connections in other Lessons. Never owned by a Teacher, a Class, a School, or a Student.

**Notes.** A Lesson is independent of any classroom that uses it. Two Teachers who assign the same Lesson are assigning the same instructional resource, not personal copies of it.

---

### Assignment

**Purpose.** A Teacher's decision to surface a Lesson for a specific Class, expressed as the pointer record defined by PDR-010 (Curation).

**Description.** An Assignment records that a particular Class has been offered a particular Lesson under conditions chosen by the Teacher. Those conditions may include a window of time, a mode of engagement, or a stated purpose.

The word "Assignment" is the canonical **domain and schema** term for this pointer record. It is used in this document, in the Firestore Data Model, and in the Query Strategy at the storage layer only. **User-facing surfaces never render the words "assigned," "due," "late," "overdue," "required," or "graded" to Teachers or Students.** The user-facing vocabulary is always "curation," "surfaced," "window closes," and "Classroom Mode" or "Practice Mode." This distinction reconciles the load-bearing decision in PDR-010 with the need for a stable schema name.

**Owner.** The Teacher who created it.

**Lifecycle.** Draft, Published, Closed, Archived.

**Relationships.** Belongs to exactly one Class. References exactly one Lesson. May be associated with many Assessment Submissions.

**Notes.** An Assignment never contains Lesson content. It references the Lesson. Modifying a Lesson does not change the meaning of any past Assignment because the Lesson is a permanent resource whose revisions are handled at the curriculum level.

---

### Assessment Submission

**Purpose.** A record of a Student's work on an Assignment.

**Description.** A Submission captures the responses a Student produced in the assessment portion of a Lesson while participating in a specific Assignment. It includes the Student's answers, any explanations, and the outcome.

**Owner.** The Student. The Teacher of the associated Class has permission to view.

**Lifecycle.** `submitted` → `finalized` within the server-side finalization transaction. There is no client-authored Started state on the authoritative Submission record: any in-progress work exists only in a transient working area outside the authoritative collection. Retention is a policy applied to finalized records, not a lifecycle state.

**Relationships.** References exactly one Student. References exactly one Assignment. Indirectly references one Class and one Lesson through that Assignment.

**Notes.** Finalized Submissions are immutable. Retention is governed by platform policy, not by individual Teachers or Classes.

---

### Join Code

**Purpose.** A short human-readable credential that allows a Student to join a Class.

**Description.** A Join Code is a temporary shared secret that maps to exactly one Class for the duration of its validity.

**Owner.** The Teacher who owns the Class.

**Lifecycle.** Generated, Active, Rotated or Revoked, Expired.

**Relationships.** Belongs to exactly one Class.

**Notes.** A Join Code is not an identity. Using a Join Code allows an authenticated Student to establish an Enrollment. It does not create a Student.

---

### Teacher Preferences

**Purpose.** Persistent settings that shape a Teacher's experience of the platform.

**Description.** Teacher Preferences record editorial and workflow choices such as default Class settings, notification preferences, and other Teacher-scoped options.

**Owner.** The Teacher.

**Lifecycle.** Created with the Teacher account, edited throughout the Teacher's tenure, archived with the Teacher.

**Relationships.** Belongs to exactly one Teacher.

**Notes.** Preferences never store classroom data. They shape how a Teacher works, not what the Teacher's Classes contain.

---

### Platform Administrator

**Purpose.** A human operator responsible for the Platform itself.

**Description.** A Platform Administrator maintains curriculum, resolves account issues, and stewards platform-wide policies.

**Owner.** The Platform.

**Lifecycle.** Appointed, Active, Retired.

**Relationships.** Acts on any entity when required by platform stewardship. Does not own individual Classes, Assignments, or Submissions.

**Notes.** Administrator action is a governance activity, not a classroom activity. Administrators do not replace Teachers in classroom contexts.

---

### Future: District

**Purpose.** An organizational grouping of Schools.

**Description.** A District would contain multiple Schools and would carry district-wide agreements, policies, and reporting relationships.

**Owner.** The District itself, represented through Platform records.

**Lifecycle.** Created, Active, Archived.

**Relationships.** Contains Schools.

**Notes.** The Domain Model anticipates Districts so that adding them later does not require restructuring Schools, Teachers, or Classes.

---

### Future: Parent

**Purpose.** A caregiver associated with a Student.

**Description.** A Parent would have visibility into a specific Student's participation and, where appropriate, communication channels with the Student's Teachers.

**Owner.** The Parent owns their own account. The relationship to a Student is a distinct connective entity.

**Lifecycle.** Created, Linked to Student, Active, Unlinked, Archived.

**Relationships.** Linked to one or more Students. Never owns Assignments or Classes.

**Notes.** Parents are not Teachers. Parents are not Administrators. Parents view; they do not manage instruction.

---

## 3. Entity Relationships

Relationships are described in plain language.

- The Platform contains every other entity.
- A School contains Teachers.
- A Teacher belongs to one School.
- A Teacher owns Classes.
- A Class belongs to one Teacher.
- A Class belongs to exactly one school year.
- A Class contains Enrollments.
- An Enrollment connects one Student to one Class.
- A Student may hold many Enrollments across time.
- A Student never belongs to a Teacher.
- A Grade contains Units.
- A Unit contains Lessons.
- A Lesson belongs to one Unit.
- A Lesson exists independently of any Class.
- A Teacher creates Assignments.
- An Assignment belongs to one Class.
- An Assignment references exactly one Lesson.
- A Lesson may be referenced by many Assignments.
- A Student produces Assessment Submissions.
- An Assessment Submission belongs to one Student and references one Assignment.
- A Submission indirectly references a Lesson through its Assignment.
- A Join Code belongs to exactly one Class.
- Teacher Preferences belong to exactly one Teacher.
- A Platform Administrator acts on the Platform rather than on any single Class.
- A District, when introduced, contains Schools.
- A Parent, when introduced, links to Students without owning them.

Lessons remain the pivot point of the model. Assignments reference Lessons. Submissions reference Assignments. Classroom life flows around Lessons without ever containing them.

---

## 4. Ownership Rules

Ownership is the answer to "whose entity is this." Permission is the answer to "who may act on it." The two are distinct.

### Platform

Created by LyfeLabz. Owned by LyfeLabz. Edited only by Platform Administrators. Never archived. Viewable by everyone. Never accessed as raw record by ordinary users.

### School

Created by the Platform on behalf of an institution. Owned by the School. Edited by Platform Administrators. Archived by Platform Administrators. Viewable by its own Teachers and Administrators. Not accessible to Teachers or Students outside the School.

### Teacher

Created by the Teacher through account establishment. Owned by the Teacher. Edited by the Teacher. Archived by Platform Administrators at the Teacher's request or by policy. Viewable in classroom contexts by that Teacher's Students. Never accessed by other Teachers except in shared School views intended for that purpose.

### Student

Created by the Student through account establishment. Owned by the Student. Edited by the Student. Archived by Platform Administrators at request or by policy. Viewable in classroom contexts by the Teachers of the Classes the Student is enrolled in. Never accessed by unrelated Teachers or other Students beyond classroom-appropriate visibility.

### Class

Created by a Teacher. Owned by the Teacher. Edited by the Teacher. Archived by the Teacher. Viewable by the Teacher and the Students enrolled in it. Never accessed by unrelated Teachers.

### Enrollment

Created when a Student joins a Class using a Join Code. Owned by the Platform on behalf of the Teacher-Student pair. Edited only through structured actions such as removal or ending. Archived when the Class or Student is archived. Viewable by the Teacher of the Class and the enrolled Student. Never accessed by other Students.

### Grade, Unit, Lesson

Created by curriculum authors. Owned by the Platform. Edited only through curriculum processes. Never deleted; retired instead. Viewable by everyone. Never edited by Teachers or Students.

### Assignment

Created by a Teacher. Owned by the Teacher. Edited by the Teacher while in Draft. After Publish, only limited edits are appropriate. Archived by the Teacher. Viewable by Students enrolled in the Class. Never accessed by unrelated Teachers.

### Assessment Submission

Created by a Student when engaging with an Assignment. Owned by the Student. Edited by the Student only before Finalization. Never edited after Finalization. Viewable by the Student and the Teacher of the associated Class. Never accessible to other Students. Retained under platform policy.

### Join Code

Created by a Teacher. Owned by the Teacher. Rotated or revoked by the Teacher. Viewable by the Teacher and by Students only for the duration of their attempt to join. Never accessed by unrelated Teachers.

### Teacher Preferences

Created with the Teacher account. Owned by the Teacher. Edited by the Teacher. Never accessed by Students or other Teachers.

### Platform Administrator

Appointed by LyfeLabz. Owned by the Platform. Edited by governance. Retired by governance. Never accessed as an ordinary account.

### Future District

Created by governance. Owned by the District. Edited by District Administrators. Archived by governance. Viewable by its Schools.

### Future Parent

Created by the Parent. Owned by the Parent. Edited by the Parent. Archived at request or by policy. Viewable by the linked Students' Teachers in appropriate contexts. Never granted classroom management authority.

---

## 5. Entity Lifecycles

### Teacher

Created, Verified, Active, Inactive, Archived. Verification confirms that a Teacher is a legitimate educator. Inactive Teachers retain history but do not lead current Classes. Archived Teachers are preserved for historical integrity.

### Student

Created, Joins Class, Participates, Graduates, Archived. A Student may hold many participation phases across years. Graduation is a lifecycle milestone, not a deletion.

### Class

Created, Active, Archived, Copied into New School Year. Copying is a deliberate lifecycle event that produces a new Class for a new school year rather than mutating an old one. A Class's school year membership is immutable once set.

### Enrollment

`active`, `transferred`, `withdrawn`, `archived`. Transferred and withdrawn Enrollments preserve the historical fact that a Student participated; Archived is the terminal state applied when the containing Class is archived.

### Grade, Unit, Lesson

Created, Published, Revised, Retired. Lessons are never deleted. Retirement removes them from active suggestion while preserving referenceability.

### Assignment

Draft, Published, Closed, Archived. Draft Assignments are private to the Teacher. Published Assignments become visible to Students. Closed Assignments no longer accept new Submissions. Archived Assignments remain in the historical record.

### Assessment Submission

`submitted` → `finalized`, both applied inside the server-side finalization transaction. Every readable Submission is Finalized. Retention is a policy applied to Finalized Submissions, not a lifecycle state.

### Join Code

Generated, Active, Rotated or Revoked, Expired. A Join Code is a short-lived credential. Its lifecycle is intentionally simpler and shorter than a Class's.

### Teacher Preferences

Created with the Teacher, Edited over time, Archived with the Teacher.

### Platform Administrator

Appointed, Active, Retired.

### Future District

Created, Active, Archived.

### Future Parent

Created, Linked, Active, Unlinked, Archived.

---

## 6. Relationships That Must Never Exist

The following relationships are intentionally prohibited by the domain.

- A Lesson never belongs to a Teacher.
- A Lesson never belongs to a Class.
- A Lesson never belongs to a School.
- A Lesson never belongs to a District.
- A Teacher never owns a Student account.
- A Class never owns a Student account.
- A School never owns a Student account.
- A Student never edits a Finalized Submission.
- A Student never views another Student's Submission.
- A Teacher never views Submissions from Classes they do not teach.
- An Assignment never contains embedded Lesson content.
- An Assignment never belongs to more than one Class.
- A Submission never belongs to more than one Assignment.
- A Class never belongs to more than one school year.
- A Join Code never maps to more than one Class.
- Teacher Preferences never contain student data.
- A Parent, when introduced, never owns a Class or Assignment.
- A Platform Administrator never appears as the Teacher of a Class.
- Curriculum entities are never authored by end users through classroom flows.

These prohibitions preserve the platform's core promises: instructional content is permanent and shared; classroom data is scoped and private; students are people rather than possessions.

---

## 7. Future Expansion

The Domain Model is designed to accept the following expansions without structural redesign.

### District Support

A District entity slots above Schools. Teachers still belong to Schools. Classes still belong to Teachers. Reporting and policy can aggregate through the new level without changing the meaning of Classes, Assignments, or Submissions.

### Parent Accounts

Parents are a distinct account type linked to Students. Since Students already own their own accounts, adding Parents introduces new visibility relationships rather than restructuring existing ownership.

### AI Tutoring

AI tutoring interacts with a Student in the context of a Lesson. Because Lessons are stable and independent of classrooms, tutoring can be attached at the Lesson level without touching Assignments or Classes.

### AI-Generated Feedback

Feedback attaches to Assessment Submissions. Because Submissions already have clear ownership, provenance, and visibility rules, feedback can be added as a related concept without altering ownership boundaries.

### AI Lesson Recommendations

Recommendations traverse Grades, Units, and Lessons. They observe existing curriculum structure and do not require new ownership relationships.

### Shared Teacher Resources

If Teachers share resources with one another in the future, those resources become a new entity type. They do not become extensions of Lessons or Classes. The Domain Model's separation of curriculum from classroom leaves room for a distinct shared-resource concept.

### Google Classroom Integration

Google Classroom becomes an external system that mirrors or exchanges data with LyfeLabz entities. Because LyfeLabz owns its own definitions of Class, Assignment, and Submission, integration is a mapping activity rather than a redefinition.

### Canvas Integration

The same reasoning applies. Canvas is external. LyfeLabz entities remain canonical.

### Professional Learning Communities

A PLC would be a grouping of Teachers who collaborate. It does not disturb Class ownership or Student privacy. It can be added as a new entity above Teachers.

### Teacher-Created Instructional Content

If Teachers ever author instructional content, that content is a distinct entity from Lessons. Lessons remain platform-owned. Teacher-authored content would carry its own ownership, lifecycle, and sharing rules.

The Domain Model should remain stable across these additions because it separates curriculum from classroom, identity from ownership, and ownership from permission. New capabilities extend the model rather than reshape it.

---

## 8. Permanent Truths of the LyfeLabz Platform

The following statements are domain invariants. They should remain true regardless of implementation, integration, or growth.

- Lessons are permanent instructional resources.
- Lessons are owned by the Platform, never by Teachers, Classes, Schools, or Districts.
- Assignments reference Lessons; they never contain Lesson content.
- Ownership of an entity is immutable once established.
- Assessment history is immutable once finalized.
- Roles are closed. The role set is Anonymous Visitor, Student, Teacher, and Platform Administrator, with anticipated additions of Parent, School Administrator, and District Administrator. New roles are governance decisions, not runtime configurations.
- Authentication establishes identity. Authorization determines permissions. The two are distinct.
- A Class belongs to exactly one school year.
- Students belong to Classes through Enrollments, not through direct containment.
- Teachers never own Students.
- Students always own their own submissions.
- Instructional content remains independent from classroom data.
- Classroom data remains scoped to the Class in which it was produced.
- Platform entities are loosely coupled: changes in one entity should not require changes in unrelated entities.
- Retirement replaces deletion for entities that carry historical or curricular significance.
- A Join Code is a credential, not an identity.
- A Submission belongs to a Student first and an Assignment second.
- A Parent, when introduced, gains visibility rather than authority.
- Administrator action is governance, not instruction.

---

## 9. Domain Language

The following terms are canonical. Future documentation should use them precisely.

**Lesson.** A permanent instructional resource that lives at the curriculum layer.

**Unit.** A conceptual narrative grouping of Lessons within a Grade.

**Grade.** A curricular level, such as Grade 6, Grade 7, or Grade 8.

**Assignment.** A Teacher's decision to make a Lesson part of the work of a specific Class.

**Enrollment.** The relationship that connects a Student to a Class.

**Submission.** A Student's record of work on an Assignment. Short form of Assessment Submission.

**Assessment Submission.** The full canonical name for a Submission.

**Ownership.** The relationship between an entity and the party responsible for its existence and content.

**Permission.** The relationship between an actor and an action they may perform on an entity.

**Verification.** The process by which a Teacher's professional identity is confirmed.

**Archive.** The lifecycle transition that preserves an entity while removing it from active use.

**Retire.** The lifecycle transition that removes a curriculum entity from active suggestion while preserving referenceability.

**Join Code.** A short-lived credential that allows an authenticated Student to enroll in a Class.

**Teacher.** A verified adult educator using LyfeLabz with Students.

**Student.** A young learner participating in LyfeLabz.

**Class.** A group of Students led by a Teacher during a specified school year.

**School.** An educational institution to which Teachers belong.

**District.** A future grouping of Schools.

**Parent.** A future account type linked to one or more Students.

**Platform Administrator.** A steward of the Platform itself.

**Platform.** The LyfeLabz system as a whole.

**Teacher Preferences.** Persistent Teacher-scoped settings distinct from any Class or Assignment.

**Curriculum Layer.** The portion of the domain that contains Grades, Units, and Lessons.

**Classroom Layer.** The portion of the domain that contains Classes, Enrollments, Assignments, and Submissions.

---

## 10. Domain Boundaries

The LyfeLabz domain is defined by what the Platform owns and governs.

### Inside the LyfeLabz Domain

- Lessons and the curriculum layer that contains them
- Classes, Enrollments, Assignments, and Submissions
- Teacher, Student, and Administrator accounts and their preferences
- School records and, in the future, District records
- Join Codes and other Platform-issued credentials
- Platform governance, retention, and verification policies

### Outside the LyfeLabz Domain

- Google Authentication and other identity providers
- Google Classroom, when used to synchronize rosters or assignments
- Canvas and any other learning management systems
- School Information Systems
- Email, messaging, and notification providers
- Analytics, monitoring, and infrastructure providers

External systems may exchange data with LyfeLabz, but they do not define LyfeLabz entities. When integration occurs, LyfeLabz maps external records into its own domain rather than adopting external definitions.

### Why Clear Boundaries Matter

Clear boundaries protect the Platform against churn in external systems. An identity provider outage does not redefine what a Teacher is. A Google Classroom feature change does not redefine what an Assignment is. A Canvas migration does not redefine what a Submission is. LyfeLabz remains coherent because its domain is its own.

Clear boundaries also protect against unintentional coupling. Integrations should observe the boundary rather than blur it. A Lesson does not become a Google Classroom object; it may be represented in Google Classroom, but its meaning stays with LyfeLabz.

---

## 11. Open Questions

The following business-domain questions should be resolved before database design begins. Each is a question about meaning, not implementation.

- Does a Teacher belong to exactly one School at a time, or may a Teacher belong to multiple Schools simultaneously?
- When a Class is copied into a new school year, which entities are copied and which are re-established, in terms of business meaning?
- Under what circumstances may an Assignment be modified after Publish, and which modifications are considered breaking versus non-breaking from a Student's perspective?
- How should Student identity persist across grade transitions and across School transfers?
- What is the retention window for Finalized Submissions, expressed in business terms rather than storage terms?
- Should a Student who leaves a Class retain read-only visibility of their own Submissions from that Class indefinitely?
- Are Teacher Preferences ever inherited from a School default or a District default, and if so, which preferences may be inherited?
- What is the business meaning of a "shared" Lesson revision when curriculum authors update a Lesson that has already been referenced by many Assignments?
- If Parents are introduced, may a Parent be linked to more than one Student, and how is that link established and verified?
- If Districts are introduced, do certain Class or Assignment behaviors become governed at the District level rather than the Teacher level?
- Should the Platform recognize co-teaching relationships, where more than one Teacher leads the same Class?
- Should the domain represent long-term Student portfolios that span multiple Classes and multiple years as a first-class entity, or should that concept remain a view derived from Submissions?

These questions belong to the business. Answering them clarifies the domain before any storage decisions are made.
