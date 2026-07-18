# LyfeLabz Teacher Experience Philosophy

Status: Canonical
Companion documents: LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_PLATFORM_ARCHITECTURE.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, LYFELABZ_PLATFORM_DOMAIN_MODEL.md, PLATFORM_STATE_MACHINE.md, IDENTITY_AND_ONBOARDING_SPECIFICATION.md

## Sprint 9D Reconciliation Notice

Every teacher surface principle in this document is subordinate to `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` and PDR-024 in the following respects:

- **Teach First, Configure Second.** First-time verified teachers receive an optional, non-blocking Welcome Guide, not a setup wizard.
- **LyfeLabz is not a Learning Management System.** The Teacher Workspace does not include a calendar, planner, curriculum-mapping tool, gradebook, messaging system, recommendation engine, or analytics dashboard during or after the pilot.
- **Pilot Teacher Workspace scope.** Recent submissions, students who have not submitted the latest assignment, activate or deactivate lessons, publish assignments to Google Classroom, launch Present Mode, open lesson, class roster.
- **Activation and publication are separate.** Activation controls access to lessons inside LyfeLabz. Publication sends assignments into Google Classroom.
- **Calm software.** No email, push, marketing, or engagement notifications.

Where philosophy and specification conflict, the specification controls.

---

## Sprint 9C Reconciliation Notice

Every teacher surface principle in this document is subordinate to `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` and PDR-023 in the following respects:

- **Class creation lives in the Classes workspace**, never in Settings. The two options are Import from Google Classroom and Create Class Manually.
- **Teacher verification is invisible after completion.** Verified teachers see no residual verification chrome in their ordinary workflow.
- **The global header is uniform.** Identity is never hidden inside the hamburger menu; `Sign In` for anonymous users and the identity control for authenticated users occupy the upper right.

Where philosophy and specification conflict, the specification controls.

---

## 1. Purpose

This document is the canonical statement of the LyfeLabz teacher experience. It records the product-level and UX-level principles that govern every teacher-facing surface, and it distinguishes the surfaces from one another so that no future sprint quietly redefines them.

It is a philosophy document. It does not define fields, callables, rules, or component APIs. Where a principle has an architectural implication that is not yet covered by an existing certified document, it is called out and referred to the appropriate future architecture specification.

Where a principle interacts with an existing PDR, the PDR remains authoritative. This document defers to the certified architecture in every case of conflict.

---

## 2. Core Product Principle

**LyfeLabz is a teaching platform. It is not a learning management system and it is not a student information system.**

LyfeLabz complements systems such as Google Classroom and PowerSchool. It does not replace them.

- The Teacher Platform manages instruction.
- The original LyfeLabz curriculum experience delivers instruction.
- Google Classroom remains the district-owned assignment and communication hub where it is in use.
- PowerSchool (or an equivalent SIS) remains the district-owned gradebook and student information record.

This principle is the operating expression of PDR-001. It narrows the teacher surface to the work LyfeLabz is uniquely positioned to do: help a science teacher decide what to surface, present, and follow up on within the LyfeLabz curriculum.

---

## 3. Teacher Experience Principles

### 3.1 Simplicity over feature density

The teacher interface must be simple, predictable, and intuitive.

Every feature must reduce teacher effort, clicks, or cognitive load. Features are not added because peer platforms include them. A dashboard is not a value in itself.

The default answer to "should we add a dashboard component?" is no, unless the component measurably reduces teacher effort against a specific, named workflow.

### 3.2 Curriculum as the primary landing experience

The primary teacher landing experience centers the LyfeLabz curriculum, not a traditional analytics dashboard.

- The curriculum preserves the existing lesson-card organization and familiar LyfeLabz visual language.
- Teachers already follow an established scope and sequence. LyfeLabz supports that sequence rather than attempting to decide what a teacher should teach next.
- Analytics remain a supporting surface, not the front door.

### 3.3 Left-side teacher navigation

The Teacher Workspace uses a persistent left-side panel. The panel contains, in order:

1. **LYFELABZ** - returns to the teacher curriculum landing page.
2. **Curriculum** - the curriculum landing page.
3. **Classes** - a section listing the teacher's individual classes.
4. **Present Mode** - the global teacher-controlled presentation surface (see §3.8).
5. **Settings** - private teacher preferences and the Students section (see §3.7).

Selecting an individual class replaces the workspace region on the right with that class's workspace. Selecting Curriculum returns the workspace region to the teacher curriculum landing page.

This layout is a UX pattern. The certified router and Session model are not modified by this decision. When implementation begins, the left-side panel replaces the top-nav placeholder introduced in Sprint 6A, without introducing a new lifecycle field or a new role.

### 3.4 Curriculum activation

Teachers activate or deactivate LyfeLabz curriculum resources for student access.

- Activation determines whether students can access a lesson, activity, extension, investigation, simulation, engineering challenge, or other resource.
- Activation does not determine whether a teacher can preview or present that resource. Teacher browsing across the full LyfeLabz curriculum is unrestricted.

Activation is the teacher-facing expression of PDR-010 curation. The schema name for the underlying record remains `assignments/{assignmentId}`. The teacher-facing verb is subject to the PDR-010 terminology amendment. This document names the concept "activation" for clarity of principle; the exact user-facing verb ("activate," "surface," "make available") is a copy-review decision recorded when the Assignment domain UI sprint begins. See §5.

The activation interface must eventually support teachers who teach one grade and teachers who teach multiple grades, without requiring a redesigned interface. Multi-grade selection is a first-class capability; single-grade teachers see the same interface with a narrower selection.

### 3.5 Contextual assignment workflow

Teacher-facing lessons and activities retain the canonical LyfeLabz instructional experience. Contextual teacher controls (such as Assign) are additive overlays, not replacements.

The assignment workflow minimizes steps and must eventually support:

- one or more classes as the target,
- immediate release or scheduled release,
- points,
- Google Classroom topic selection where a Google Classroom integration is in use,
- Google Classroom publishing or equivalent integration where technically feasible.

The workflow is not implemented by this document. It is designed by the Assignment domain UI sprint under Phase 5.

**LMS-linked class rows.** When the ratified LMS integration architecture (`LMS_INTEGRATION_ARCHITECTURE.md`, PDR-019) is implemented in the phase named by `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §4, the Assignment Dialog's per-class row shape gains two additive affordances on rows for LMS-linked classes: a Google Classroom topic selector and a publication toggle (defaulting off until the teacher opts in for that class). These affordances are additive controls on the same one dialog. The Assign Experience remains one workflow per `ASSIGN_EXPERIENCE.md`. Rows for classes that are not LMS-linked are unchanged.

### 3.6 Class workspace

Selecting a class opens a spreadsheet-style learning-data workspace.

- Students appear as rows.
- Assigned lessons and activities appear across the top as selectable columns or tabs.
- Selecting an assignment displays the scores and other data collected from that assignment.

LyfeLabz is the control center for instructional access and mastery data. It is not the official gradebook. Grades of record remain in PowerSchool or the district SIS.

The class workspace is Phase 4 through Phase 7 territory in the roadmap. This document names its intended shape; concrete field lists and callable signatures belong to the sprint specifications for those phases.

### 3.7 Private student settings and accommodations

Settings contains a Students section that is separate from any classroom score display.

- Student accommodations and modifications must not appear in normal classroom projection or score-review workflows.
- Configured supports are applied automatically whenever content is delivered to that student.

The intent is to reduce the risk of exposing private information to peers during classroom activity. Future accommodation controls may include reading support, modified presentation, reduced answer choices, extended time, or other documented supports.

The accommodation data model is not defined here. When accommodation implementation is scheduled, a formal architecture specification (or an amendment to the Firestore Data Model, Security Model, and Cloud Function Charter) will define the record shape, the security boundary, the propagation mechanism, and the audit vocabulary. Accommodations touch privacy (PDR-011) and security (PDR-012); they cannot ship without their own certification pass.

### 3.8 Present Mode

Present Mode is a global teacher-controlled presentation surface for live classroom instruction.

Present Mode restores the original full-width LyfeLabz curriculum and lesson experience. It does not create a separate imitation of it.

Present Mode includes:

- the original LyfeLabz main curriculum page,
- the existing grade and topic filter box,
- all available lessons and learning experiences,
- extensions, investigations, simulations, challenges, and other resource types,
- normal student-facing lesson navigation,
- the ability to return from a lesson to the main LyfeLabz curriculum page,
- unrestricted teacher browsing across grades and topics.

All curriculum resources remain available in Present Mode regardless of activation or assignment status.

Present Mode must not load or expose:

- student names,
- scores,
- accommodations,
- class data,
- assignment-management controls,
- teacher notes,
- private teacher settings,
- any other teacher-only information.

Present Mode is a genuinely restricted presentation surface. It is not the Teacher Workspace with teacher controls hidden by CSS. The restriction is enforced by the entry point (the surface the teacher lands on has no access to teacher-scoped session data), not by conditional rendering inside a shared surface.

The teacher can exit Present Mode and return to the previous Teacher Workspace context.

Present Mode is not implemented by this document. Its architecture is discussed in §4 of the companion Phase 2 Architecture Planning Report attached to this task.

### 3.9 One canonical curriculum experience

Duplicate lesson or curriculum implementations for Teacher Mode, Present Mode, and Student Mode are prohibited.

The architecture preserves one canonical curriculum and instructional experience:

- the static instructional repository at the repository root.

Improvements to canonical LyfeLabz lessons automatically benefit teacher browsing, presentation, and student access. This is the structural expression of PDR-007.

Teacher-specific and student-specific behavior is composed as overlays on top of the canonical experience, not as parallel copies of it. The overlay contract is a future architecture decision (see §5).

---

## 4. Surface Definitions

Each teacher-facing surface has a distinct purpose. The definitions are load-bearing: a future sprint that renames a surface without updating this document introduces drift.

### 4.1 Teacher Workspace

The authenticated `/app/**` shell for an `active` teacher. Owns:

- the persistent left-side navigation,
- the workspace outlet,
- the identity card and header,
- the session bootstrap contract.

Reads teacher-scoped session data. Never renders lesson content directly.

### 4.2 Curriculum

The teacher curriculum landing page inside the Teacher Workspace. Owns:

- the teacher-facing view of the LyfeLabz curriculum,
- the activation surface (see §3.4),
- contextual teacher controls layered onto the canonical curriculum organization.

The curriculum surface never duplicates lesson content. It references the canonical instructional repository.

### 4.3 Class workspaces

The per-class spreadsheet-style workspace opened by selecting an individual class from the left-side panel. Owns:

- the class roster view,
- the class-scoped assignment column set,
- the class-scoped mastery data views.

A class workspace never mutates a canonical lesson. It reads assignment and submission records scoped to the selected class.

### 4.4 Settings and private student supports

The teacher-private surface for preferences, notes, and student-support configuration. Owns:

- teacher preferences (a future teacher-preferences record; see the Teachers domain in the roadmap),
- the Students section (see §3.7),
- accommodations and modifications (deferred; requires its own architecture specification).

Settings never appears on classroom projection.

### 4.5 Present Mode

The teacher-controlled presentation surface (see §3.8). Owns:

- entry into the canonical curriculum experience from an authenticated teacher context,
- exit back to the Teacher Workspace,
- the guarantee that no teacher-only or student-private data is loaded.

Present Mode never renders a Teacher Workspace surface.

### 4.6 Student access

The student-facing surface for LyfeLabz. Owns:

- the student's join-and-explore experience,
- student-scoped access to activated resources,
- student-facing Practice Mode and Classroom Mode runtime behavior per the Cloud Function Charter.

Student access is out of scope for this document except as a consumer of activation. Its detailed shape belongs to the Phase 4 Enrollment surface and subsequent phases.

### 4.7 Google Classroom and PowerSchool responsibilities

Google Classroom (where in use) remains the assignment and communication hub. LyfeLabz publishes into Google Classroom where technically feasible; LyfeLabz does not replace it.

PowerSchool (or the equivalent SIS) remains the gradebook of record. LyfeLabz collects and displays mastery data as instructional evidence; it does not compute a report-card grade.

Both are external systems. Integration work is a separate architecture phase gated on PDR-015 (documented demand) and, for Google Classroom specifically, on a dedicated integration architecture pass. That architecture pass is now recorded in `LMS_INTEGRATION_ARCHITECTURE.md`, its teacher-facing shape in `LMS_EXPERIENCE.md`, and its ratified amendments to the certified corpus in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`. The load-bearing integration posture is recorded as PDR-019. The named phase for implementation is Phase 9 (LMS Integration Foundation) in `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §4. No integration ships in the current sprint sequence.

---

## 5. Deferred Terminology and Data-Model Reconciliations

The following items are named here so they are not silently invented later:

- **Activation vocabulary.** PDR-010's terminology amendment binds teacher UI to the verbs "surface" and "hide." §3.4 uses "activate" and "deactivate" as principle-level language. The final teacher-facing verb is a copy-review decision recorded when the Assignment domain UI sprint begins. If the verb chosen is not "surface" or "hide," a PDR-010 terminology amendment records the reconciliation. No verb change alters the underlying `assignments/{assignmentId}` schema.
- **Teacher preferences.** The left-side layout, grade selection, and topic selection are teacher preferences. Their storage location is deferred to the Teachers domain sprint specification. See §7 of the Phase 2 Architecture Planning Report.
- **Accommodations.** See §3.7. Requires its own architecture specification.
- **Multi-grade selection.** See §3.4. The interface supports multi-grade teachers as a first-class capability; the persisted preference shape is deferred to the teacher-preferences record.
- **Present Mode entry contract.** See §3.8 and §4 of the Phase 2 Architecture Planning Report. The specific mechanism (dedicated route, hosting boundary, session-object exclusion) is a Phase 2 architecture decision.

---

## 6. Non-Goals

This document does not:

- redefine any of the twelve foundational PDRs,
- introduce a new role, claim, or lifecycle field,
- specify Firestore collections, callable signatures, or security rules,
- describe the visual design of any specific surface,
- schedule a Google Classroom or PowerSchool integration.

---

*End of philosophy document. This document defines what the teacher experience is. It does not define implementation. Every principle here will be exercised by future sprint specifications that defer to the certified architecture.*

---

## 7. Platform Posture

Introduced under Sprint 14. Canonical. Operational rules that govern every teacher-facing surface built on top of the certified Sprint 13 assignment lifecycle.

### 7.1 Instrument, not agent

LyfeLabz is a classroom instrument, not an instructional agent. It preserves, organizes, presents, and reports student learning. It does not recommend, diagnose, predict, persuade, rank, or make instructional decisions for teachers.

### 7.2 Preserve, organize, present, report

The four verbs that define every teacher-facing surface:

- **Preserve.** Store the student's work faithfully (frozen recipient population under PDR-029, immutable attempts, canonical audit events).
- **Organize.** Group facts so a teacher can find them quickly (registry by lesson, roster grouped by progress state, assignment cards ordered deterministically).
- **Present.** Render facts calmly and literally (aggregate counts, factual per-question rates, canonical status labels).
- **Report.** Return factual summaries when asked (Assignment Summary, Assignment Detail, dashboard cards).

Nothing on any teacher surface exists outside these four verbs.

### 7.3 Teacher owns interpretation and decisions

LyfeLabz makes student thinking visible. The teacher decides what it means. LyfeLabz never labels a student as at risk, on track, disengaged, improving, or needing help. Every displayed value is a fact traceable to stored assignment, session, attempt, or submission data.

### 7.4 Show facts, not inferred judgments

The default renders factual counts, factual percentages, and canonical status labels. When a value would require inference, LyfeLabz stays silent rather than showing an uncertain signal. The absence of a signal is itself information: it means LyfeLabz has nothing factual to say.

### 7.5 Silence rather than uncertain or unnecessary signals

Teacher-facing LyfeLabz is calm, terse, predictable, literal, easy to understand, and free of unnecessary alerts, badges, gamification, and configuration. There are no notifications of any kind: no email, no push, no in-app, no marketing, no engagement, no reminder. A surface with nothing factual to say renders nothing.

### 7.6 No LMS scope creep

Google Classroom (where in use) remains responsible for rosters and institutional class membership, due dates, announcements, gradebook workflows, and general classroom communication. LyfeLabz remains responsible for lesson assignment, assignment lifecycle state, student submission visibility, quiz results, Show Your Thinking responses, and clear instructional evidence. LyfeLabz never replicates a gradebook, a messaging system, an attendance tracker, or an administrator performance dashboard. LyfeLabz never adds a parent portal, an AI recommendation surface, or a predictive analytics surface as part of the beta.

### 7.7 Operational reading

This section is normative. Where a future sprint proposes a teacher-facing feature that violates §7.1 through §7.6, the section controls unless a repository-level decision (a new PDR or a formal amendment to this section) overrides it. Sprint 14 introduces this section; Sprint 14 does not modify any other principle in this document, does not reopen any Sprint 9C, 9D, or 6C decision, and does not introduce a fifth navigation item to the Teacher Workspace.

### 7.8 Sprint 14 Reconciliation Notice

Every principle in §§1 through 6 remains in force. §7 is an operational overlay that makes the design constraints explicit for the beta teacher platform built on the certified Sprint 13 lifecycle. Where §3.1 ("Simplicity over feature density") and §3.2 ("Curriculum as the primary landing experience") describe the philosophy, §7 describes the operational rules that Sprint 15 and beyond must observe.
