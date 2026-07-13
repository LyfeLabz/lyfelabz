# LyfeLabz Platform Transition and Pilot Readiness Specification

**Status:** Certified. Canonical single source of truth for teacher onboarding, teacher workspace philosophy, student assignment experience, Google Classroom integration philosophy, the learning archive, notification philosophy, the long-term student learning journey, and the transition from today's LyfeLabz into the first production teacher pilot.
**Sprint of record:** Sprint 9D - Platform Transition and Pilot Readiness.
**Authoritative anchor:** PDR-024 (Platform Transition and Pilot Readiness). Precedent PDRs (PDR-001, PDR-010, PDR-011, PDR-018, PDR-019, PDR-020, PDR-021, PDR-022, PDR-023) are reconciled through this document.
**Companion documents:** `LYFELABZ_PLATFORM_DECISIONS.md`, `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`, `ASSESSMENT_PIPELINE_SPECIFICATION.md`, `PLATFORM_OPERATIONS_SPECIFICATION.md`, `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`, `LMS_EXPERIENCE.md`, `ASSIGN_EXPERIENCE.md`, `CLASS_SNAPSHOT_EXPERIENCE.md`, `PRESENT_MODE_ARCHITECTURE.md`, `TEACHER_EXPERIENCE_PHILOSOPHY.md`, `TEACHER_JOURNEY.md`, `TEACHER_PLATFORM_DOMAIN_ROADMAP.md`.

This specification is the single source of truth for how LyfeLabz behaves as it moves from an instructional website into the first production teacher pilot, and for the product philosophy that governs teacher onboarding, the teacher workspace, the student assignment and results experience, the learning archive, and notifications. Where any earlier document contradicts this specification, this specification controls. Superseding notices in affected documents point back here.

---

## Sprint 10A F-3 Reconciliation Notice

The engineer-facing implementation rules that follow from §5 (Google Classroom Integration Philosophy), and in particular §5.3 (Deep Link Behavior) and PDR-024f, PDR-024g, and PDR-024h, are canonical in `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` under PDR-027. The product philosophy in §5 remains authoritative. Implementation questions about the deep-link URL contract, the resolution callable, the publication callable, multiple-class fan-out, multiple-teacher publication, and Classroom synchronization ownership route to the new contract. Where this specification and the implementation contract conflict on product behavior, this specification controls.

---

## 0. Relationship to Existing Canonical Specifications

This specification builds upon and complements three foundational Sprint 9 canonical specifications:

- **`ASSESSMENT_PIPELINE_SPECIFICATION.md` (Sprint 9A, PDR-021).** Defines how a LyfeLabz formative assessment is offered, taken, saved, submitted, scored, recorded, revised, and reported. Attempt semantics, session semantics, unlimited attempts by default, immutable history, server-authoritative scoring, and grace-period behavior originate here.
- **`PLATFORM_OPERATIONS_SPECIFICATION.md` (Sprint 9B, PDR-022).** Defines hosting, environments, the release pipeline, rollback, maintenance mode, authentication session policy, monitoring, incident response, operational Pilot Readiness Certification, and GitHub Pages retirement.
- **`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` (Sprint 9C, PDR-023).** Defines authentication versus authorization, the two identity families, the district as a first-class security boundary, teacher verification, roster authority, student identity permanence, and the authenticated experience shell.

Together with this Sprint 9D specification, these four documents form the architectural foundation of the LyfeLabz platform.

- Sprint 9A is the platform's assessment substrate.
- Sprint 9B is the platform's operational substrate.
- Sprint 9C is the platform's identity substrate.
- **Sprint 9D is the transition between the core platform architecture and the operational teacher and student experience.**

This specification does not restate the substrate. It relies on it. Attempt behavior in §6 defers to Sprint 9A. Pilot Readiness in §10 rests on the operational bar in Sprint 9B §22. Teacher onboarding in §3 extends the identity foundations in Sprint 9C §4, §11, §13, §14, and §16. Where a downstream contributor needs the underlying mechanic, the answer lives in the substrate specification. Where a contributor needs the pilot's product philosophy or scope, the answer lives here.

Cross-references between the four foundational specifications are maintained so future engineers can navigate the corpus without ambiguity. When a substrate behavior is amended, the amending sprint updates the substrate specification and, where appropriate, records the reconciliation here.

---

## 1. Purpose

Sprint 9 established the canonical architecture for the assessment pipeline (Sprint 9A), platform operations (Sprint 9B), and identity and onboarding (Sprint 9C). This specification closes Sprint 9 by defining what the platform is, and is not, at the moment it opens to the first pilot teachers and their students.

The transition to a pilot is a product moment, not only an operational one. The educational philosophy established across Sprint 9 must be preserved and extended into every surface a teacher, student, or Platform Administrator will touch during the pilot. This specification records that philosophy so that no future sprint can quietly convert LyfeLabz into a Learning Management System, an analytics product, an engagement platform, or a marketing surface.

The audience for this document is future contributors evaluating a proposed teacher-facing or student-facing surface against the intent of the pilot. If a proposed surface cannot be justified against the principles below, it does not belong in the pilot regardless of how peer products behave.

---

## 2. Transition Philosophy

LyfeLabz begins the pilot as an instructional website that a small number of teachers extend with a teacher workspace. It does not begin the pilot as a Learning Management System that happens to include curriculum.

The transition preserves three commitments.

- **Public educational content remains browsable without authentication.** Curriculum, lessons, vocabulary, and Explore surfaces continue to serve anonymous visitors under `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §2. The pilot never requires sign-in to browse LyfeLabz.
- **Authentication becomes required only when a capability depends on identity.** Teachers sign in to reach the Teacher Workspace. Students sign in to attempt an assessment or view their results. Nothing else requires authentication.
- **The pilot is a first pilot, not a first release.** Pilot readiness under `PLATFORM_OPERATIONS_SPECIFICATION.md` §22 governs the operational bar. This specification governs the product bar. Both must be satisfied for the pilot to begin.

The transition adds a Teacher Workspace, a Student Assignments surface, a Student Results surface, and a Learning Archive. It adds no other surface for the pilot.

---

## 3. Teacher Onboarding

Teacher onboarding follows `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §4 and §14 and extends the following pilot-scoped behavior.

### 3.1 Entry

- Google Sign-In is the primary entry point for teachers.
- Public educational content remains browsable without authentication. A teacher who arrives at LyfeLabz for the first time may browse the curriculum without signing in.
- The `Sign In` control on the global header is the only surface that starts the onboarding flow.

### 3.2 Access Request

- Unknown teachers request access. The verification path is the one ratified in `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §13.
- The Platform Administrator approves or denies. This is the load-bearing human gate. No automated path grants teacher capabilities during the pilot beyond the verification-code path defined in §13.1 of the specification.
- Approval writes the teacher's active claims per `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §14 and PDR-023a. Denial produces the `auth.activationRejected` audit event with no state change.

### 3.3 Welcome Guide, Not Setup Wizard

- First-time verified teachers receive a Welcome Guide, not a setup wizard.
- The Welcome Guide is optional and non-blocking. It does not gate access to the Teacher Workspace, does not require a sequence of decisions, and does not persist any teacher preference beyond a dismissed flag.
- A teacher may dismiss the Welcome Guide at any time and return to it later.
- The teacher's goal at first sign-in is to prepare tomorrow's lesson, not to configure software. The Welcome Guide points at that goal and stays out of the teacher's way.

**Teach First, Configure Second.** No pilot surface requires a teacher to complete configuration screens before teaching. Any configuration a teacher needs is reachable when the teacher decides they need it.

---

## 4. Teacher Workspace Philosophy

LyfeLabz is not a Learning Management System. This principle governs every teacher-facing surface in the pilot and every teacher-facing surface added after the pilot.

Teachers already know what they are teaching. The Teacher Workspace exists to help teachers manage the classroom they are about to teach or just finished teaching. Every feature must save teachers time.

### 4.1 In Scope for the Pilot

The primary class workspace capabilities during the pilot are:

- recent submissions,
- students who have not submitted the latest assignment,
- activate or deactivate lessons,
- publish assignments to Google Classroom,
- launch Present Mode,
- open lesson,
- class roster.

Each of these capabilities has a defined home in the certified architecture. Activation follows `TEACHER_EXPERIENCE_PHILOSOPHY.md` §3.4. Publication follows §5 of this specification. Present Mode follows `PRESENT_MODE_ARCHITECTURE.md`. The class roster follows `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §9 and §10.

### 4.2 Out of Scope for the Pilot

The Teacher Workspace does not introduce any of the following during the pilot, and does not introduce them after the pilot without a new PDR that supersedes PDR-024:

- calendars,
- planners,
- curriculum mapping tools,
- gradebooks,
- messaging systems,
- recommendation engines,
- analytics dashboards.

These absences are load-bearing. LyfeLabz complements Google Classroom and PowerSchool under PDR-001 and `TEACHER_EXPERIENCE_PHILOSOPHY.md` §2. The pilot must not blur that boundary.

### 4.3 Every Feature Must Save Teachers Time

A pilot feature is measured against a real moment in a teacher's day. A feature that a teacher would not miss if it were removed does not belong in the pilot. A feature that duplicates something a teacher already does in Google Classroom or PowerSchool does not belong in the pilot.

---

## 5. Google Classroom Integration Philosophy

The pilot preserves a strict separation between activation and publication.

### 5.1 Activation and Publication Are Separate

- **Activation** controls access to lessons inside LyfeLabz. It is the teacher's decision that a given lesson or resource is available to a class's students in LyfeLabz. Activation is required for a student to access an assessment as an authorized attempt under `ASSESSMENT_PIPELINE_SPECIFICATION.md`.
- **Publication** sends the assignment into Google Classroom for a specific LMS-linked class. Publication does not create a duplicate assignment inside LyfeLabz.
- Activation without publication is a supported state. Publication without activation is refused.

### 5.2 Google Classroom Remains the Assignment Hub

Google Classroom remains the student's assignment hub and To-do list wherever a class is linked to Google Classroom.

- LyfeLabz never asks a student to check a second assignment list. The student's assignment surface inside LyfeLabz (§6) is a status view of the student's LyfeLabz-attempted work, not a competing assignment hub.
- LyfeLabz never asks a teacher to communicate an assignment through a second channel.

### 5.3 Deep Link Behavior

A student who launches an assignment from Google Classroom enters the correct lesson automatically. The pilot supports this behavior for every LMS-linked class published from LyfeLabz.

- The student never selects a class from a list after arriving from Google Classroom.
- The student never selects an assignment from a list after arriving from Google Classroom.
- The student is authenticated per `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §11 and §16 and lands in the lesson with the correct authorized attempt context.

The mechanics of the deep link are the responsibility of `LMS_INTEGRATION_ARCHITECTURE.md`. The pilot obligation is that the student's arrival is silent, immediate, and correct.

**Integrate Rather Than Duplicate.** Wherever Google Classroom already answers a teacher or student question, LyfeLabz defers to Google Classroom rather than creating a second surface that answers the same question.

---

## 6. Student Experience

The student's identity menu contains exactly two entries during the pilot.

- **My Assignments**
- **My Results**

No additional student surface is introduced by the pilot. The public curriculum, Explore, and lesson surfaces remain reachable without authentication.

### 6.1 My Assignments

`My Assignments` displays:

- newly assigned work,
- incomplete work,
- assignment status,
- open assignment.

`My Assignments` never displays another student's status, never compares one student to another, and never surfaces a class-wide leaderboard.

For LMS-linked classes, `My Assignments` is a status view. It does not replace the Google Classroom To-do list; it complements it under §5.2.

### 6.2 Submit Immediately

Submit equals completion. When a student submits an attempt:

- the attempt is recorded per `ASSESSMENT_PIPELINE_SPECIFICATION.md`,
- the assessment is scored,
- the correct answers are revealed,
- the assignment is marked complete.

No additional confirmation step, cool-down window, or teacher-side approval step is inserted between submit and completion. The student's submit gesture is the completion gesture.

### 6.3 My Results

`My Results` displays for each attempted assessment:

- best score,
- number of attempts,
- lesson.

If the student's best score is less than a perfect score, `My Results` offers an action button:

- **Improve My Score**

`Improve My Score` opens a new authorized attempt under `ASSESSMENT_PIPELINE_SPECIFICATION.md` §7 (unlimited attempts by default; every attempt is preserved).

### 6.4 Status Indicators

`My Results` uses four status indicators.

- **Blue circle. Ready to Begin.** The student has not yet attempted the assessment.
- **Yellow circle. Improving.** The student has attempted the assessment and has not yet reached a well-done or perfect result.
- **Green circle. Well Done!** The student's best score is very strong but not a perfect score. A score of 9/10 receives this indicator and still offers `Improve My Score`.
- **Gold star. Perfect Score.** The student's best score is a perfect score. A score of 10/10 receives this indicator and does not offer `Improve My Score`.

The indicators must never be represented by color alone. Every indicator carries an accessible label (`Ready to Begin`, `Improving`, `Well Done!`, `Perfect Score`) per `PLATFORM_CONTRACTS.md` and `LYFELABZ_ENGINEERING_STANDARDS.md`.

### 6.5 Celebrate Persistence, Never Compare Students

Improvement is celebrated as loudly as achievement.

- Example moments: "You improved from 6/10 to 10/10." "Great persistence!"
- Personal bests are celebrated. Students are never compared to one another.
- Class-average banners, percentile rankings, and public leaderboards are not part of the student experience.

Punitive language is prohibited on every student surface. Words such as `Failed`, `Poor`, and `Needs Improvement` never appear. A low score is a starting point, not a judgment.

**Celebrate Improvement as Much as Achievement.**

---

## 7. Student Learning Archive

Learning belongs to the student. Once a lesson is archived by the teacher (for example, at the end of a term or at the end of a school year), the student's learning history remains accessible to the student.

### 7.1 Archive Access

Archived lessons remain permanently accessible through the student's login.

Through the student's login, students may:

- review lessons,
- review vocabulary,
- review Explore,
- review scores,
- review attempts,
- review explanations.

### 7.2 Archive Immutability

Once a lesson is archived, students may not:

- submit again,
- modify responses,
- create new attempts.

Archived assessment attempts are immutable, consistent with `ASSESSMENT_PIPELINE_SPECIFICATION.md`. The archive is a preservation surface, not a re-assessment surface.

### 7.3 Teacher Archival Does Not Remove Student History

Teacher class archival closes the assignment. It does not remove the student's learning history.

- The teacher's ownership over the class is unaffected by the student's ongoing access to their own history.
- Roster changes, teacher lifecycle transitions, and class archival never truncate a student's learning history within the district under `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §5.

**Learning Belongs to the Student.** Assignments close. Learning remains accessible.

---

## 8. Long-Term Student Learning Journey

LyfeLabz is designed around the student's complete middle school science journey rather than individual school years.

### 8.1 Multi-Year Continuity

Completed learning accumulates from Grade 6 through Grade 8. A student's permanent LyfeLabz Student ID (`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §5) is the anchor for that accumulation. The Student ID outlives class, teacher, and school-year changes within the student's district.

### 8.2 Portfolio Outcome

By the end of middle school every student has a permanent digital science learning portfolio inside LyfeLabz. The portfolio is:

- the student's own,
- composed entirely of the student's actual attempts, actual explanations, and actual vocabulary review moments,
- accessible through the student's login without teacher mediation.

### 8.3 Study Resource, Not an MCAS Product

The portfolio naturally becomes an exceptional study resource for future science courses and MCAS preparation. This is a byproduct, not the product.

- The purpose of the archive and the portfolio is preserving learning.
- LyfeLabz is not an MCAS preparation product. It is a science curriculum whose preserved learning is useful for MCAS preparation.
- No pilot surface, and no post-pilot surface added under PDR-024, may reframe the archive as a test-prep product.

**Preserve Learning Across Years.**

---

## 9. Notification Philosophy

LyfeLabz is calm software.

### 9.1 Prohibited

The pilot introduces no email notifications, no push notifications, no marketing notifications, and no engagement reminders.

- LyfeLabz does not email students about incomplete assignments.
- LyfeLabz does not email teachers about student activity.
- LyfeLabz does not push mobile notifications.
- LyfeLabz does not market to teachers, students, or families.
- LyfeLabz does not send re-engagement reminders when a teacher or student has not signed in recently.

### 9.2 The Only Exception

Notifications exist only when immediate classroom action is required. The pilot has no such notifications. Any future notification introduced under a superseding PDR must meet the "immediate classroom action" bar and must be tied to a specific classroom moment.

### 9.3 Consequences for the Product

The absence of engagement notifications shapes the pilot's product decisions.

- The Teacher Workspace does not include an inbox.
- The student's `My Assignments` surface does not include a notification bell.
- Google Classroom continues to handle every assignment notification for LMS-linked classes.

**Calm Software.**

---

## 10. Pilot Transition

The pilot begins under the operational readiness bar in `PLATFORM_OPERATIONS_SPECIFICATION.md` §22 and the product readiness bar in this section.

### 10.1 Product Readiness

The product is pilot-ready when each of the following is true.

- **Teacher onboarding.** A first-time verified teacher can complete Google Sign-In, complete verification, dismiss the Welcome Guide, and reach the Teacher Workspace without configuring anything. See §3.
- **Teacher workspace.** Every capability listed in §4.1 is exercised end-to-end in Preview against realistic synthetic data. No capability listed in §4.2 is present.
- **Google Classroom integration.** Activation and publication are separable. Deep links from Google Classroom land the student in the correct authorized attempt context. See §5.
- **Student assignment surface.** `My Assignments` and `My Results` behave as specified in §6, including all four status indicators with accessible labels.
- **Learning archive.** A teacher-archived lesson remains readable by the student. New attempts against the archived assessment are refused per §7.2.
- **Notifications.** No email, push, or engagement notification is emitted by the pilot codebase, including from third-party services embedded through Cloud Functions or hosting. See §9.
- **Copy review.** No student-facing surface contains punitive language (§6.5). No teacher-facing surface reframes LyfeLabz as an LMS (§4.2).

### 10.2 Coexistence With Public Curriculum

Throughout the pilot, the public curriculum remains reachable without authentication. Anonymous curriculum access is not gated on pilot readiness; it is not gated on any teacher's onboarding state; it is not gated on the pilot window.

### 10.3 Pilot Scope Is Load-Bearing

Sprint discretion during the pilot window is bounded by this specification. A pilot-window sprint that would introduce a surface listed in §4.2 or a notification prohibited under §9 requires a new PDR that supersedes PDR-024 before the sprint may proceed.

---

## 11. Product Principles

The following principles summarize the platform philosophy established during Sprint 9. Each principle is enforceable against any proposed teacher-facing or student-facing surface.

1. **Teach First, Configure Second.** No LyfeLabz surface requires a teacher to complete configuration screens before teaching.
2. **One Meaningful Decision Per Screen.** A teacher surface asks the teacher for one meaningful decision at a time. A student surface asks the student for one meaningful decision at a time.
3. **Integrate Rather Than Duplicate.** Where Google Classroom or PowerSchool already answers a question, LyfeLabz defers rather than creating a competing surface.
4. **Save Teachers Time.** Every teacher feature must reduce teacher effort against a specific, named workflow.
5. **Complement Existing Classroom Workflows.** LyfeLabz enters a classroom that already works. It does not ask the classroom to rearrange itself around LyfeLabz.
6. **Learning Belongs to the Student.** A student's learning history follows the student's identity, not a class or a teacher.
7. **Celebrate Improvement as Much as Achievement.** Persistence is a first-class outcome. Perfect scores are a first-class outcome. Both are recognized without comparing students to one another.
8. **Preserve Learning Across Years.** The Student ID anchors a multi-year portfolio. The portfolio outlives class rosters, school-year transitions, and teacher lifecycle events within the district.
9. **Calm Software.** LyfeLabz does not email, push, or nudge. Notifications exist only when immediate classroom action is required.
10. **Every Feature Must Earn Its Place.** A feature that cannot be located inside a real teacher or student moment does not belong in the pilot, and does not belong after the pilot without a superseding PDR.

---

## 12. Relationship to Prior Architecture

This specification reconciles the following certified documents.

- `LYFELABZ_PLATFORM_DECISIONS.md`
  - PDR-001 is preserved and strengthened. LyfeLabz complements Google Classroom and PowerSchool during and after the pilot.
  - PDR-010 is preserved. Activation is the pilot's teacher-facing expression of curation. Publication is added as an adjacent, LMS-scoped operation and does not modify activation.
  - PDR-011 is preserved. The pilot introduces no analytics dashboard.
  - PDR-018 is preserved. The pilot's Teacher Workspace stays within the surface boundaries recorded in PDR-018.
  - PDR-019 is preserved. The Google Classroom integration philosophy in §5 is the product-level expression of PDR-019 and PDR-023h.
  - PDR-020 is preserved. Google Classroom remains the initial LMS implementation target.
  - PDR-021 is preserved. Submit-equals-completion and unlimited attempts under PDR-021 govern the student experience in §6.
  - PDR-022 is preserved. Pilot Readiness under PDR-022 remains the operational readiness bar. This specification adds the product readiness bar in §10.1.
  - PDR-023 is preserved. Teacher onboarding in §3 is the pilot-scoped extension of PDR-023.
- `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` - Preserved. Sections 4, 11, 13, 14, and 16 are the identity foundations of §3, §6, and §7.
- `ASSESSMENT_PIPELINE_SPECIFICATION.md` - Preserved. Attempt semantics, session semantics, unlimited attempts, immutable history, and grace-period behavior govern §6 and §7.
- `PLATFORM_OPERATIONS_SPECIFICATION.md` - Preserved. Pilot Readiness §22 remains the operational bar. This specification adds the product bar and refers back for operations.
- `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`, and `LMS_EXPERIENCE.md` - Preserved. §5 restates the product-level integration philosophy without widening or narrowing the LMS surface.
- `TEACHER_EXPERIENCE_PHILOSOPHY.md` - Preserved. §4 restates the surface boundaries from a pilot readiness lens and names the pilot's in-scope and out-of-scope Teacher Workspace capabilities.
- `TEACHER_JOURNEY.md` - Preserved. The teacher day narrated in `TEACHER_JOURNEY.md` is the concrete expression of §3, §4, and §5.
- `ASSIGN_EXPERIENCE.md` - Preserved. The assignment workflow's per-class row shape is reconciled with §5.1 (activation and publication are separate).
- `CLASS_SNAPSHOT_EXPERIENCE.md` - Preserved. Snapshot remains the between-moments surface and is not converted into a dashboard by the pilot.
- `PRESENT_MODE_ARCHITECTURE.md` - Preserved. Present Mode remains a launchable capability from the Teacher Workspace per §4.1.
- `LYFELABZ_PLATFORM_ARCHITECTURE.md` - Preserved. Sprint 9D adds a pilot readiness product bar that operates alongside the operational bar.

---

## 13. Change Discipline

- This specification is the single source of truth for the transition to the first pilot, the pilot product philosophy, and the platform's long-term learning-journey posture. Amendments travel through PDR-024 and are recorded here.
- A pilot-window sprint that would introduce a surface listed in §4.2 or a notification prohibited under §9 requires a new PDR that supersedes PDR-024 before the sprint may proceed.
- Downstream documents that describe teacher onboarding, teacher workspace scope, the student assignment or results experience, the learning archive, or notifications must defer to this specification. Superseding notices remain in place until each document is next revised.
- Where a downstream document appears to conflict with this specification, this specification controls until the downstream document is reconciled.

---

## 14. Change Log

- 2026-07-12 - Initial certified Platform Transition and Pilot Readiness Specification established. Sections 1 through 14. PDR-024 anchors the specification. Reconciliation notices added to `LYFELABZ_PLATFORM_DECISIONS.md`, `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`, `PLATFORM_OPERATIONS_SPECIFICATION.md`, `TEACHER_EXPERIENCE_PHILOSOPHY.md`, `TEACHER_JOURNEY.md`, `LMS_EXPERIENCE.md`, `ASSIGN_EXPERIENCE.md`, and `CLASS_SNAPSHOT_EXPERIENCE.md`.
