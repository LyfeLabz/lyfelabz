# Sprint 17 Certification Contract

**Status:** Authoritative scope document for Sprint 17
**Type:** Certification contract - not an implementation plan
**Supersedes:** Any prior informal Sprint 17 scoping notes

This document defines what Sprint 17 is and is not permitted to become. Every implementation decision made during Sprint 17 must be evaluated against this contract. When in doubt, the contract wins.

---

## 1. Purpose

Sprint 17 exists to close the instructional learning loop.

Sprints 9 through 16 certified the platform architecture: authentication, assignment lifecycle, assessment sessions, attempts, rollups, Cloud Functions, security rules, and the teacher dashboard. That architecture is complete, tested, and trusted.

What is still missing is the connection between an authenticated student and the certified assessment pipeline. Until a real student can complete an assigned lesson and produce authentic classroom data in the certified backend, the loop is theoretical.

Sprint 17 completes that loop:

Teacher publishes
&nbsp;&nbsp;&nbsp;&nbsp;&darr;
Student completes lesson
&nbsp;&nbsp;&nbsp;&nbsp;&darr;
Assessment flows through the certified backend
&nbsp;&nbsp;&nbsp;&nbsp;&darr;
Teacher sees authentic classroom data

Sprint 17 is **not** building a student platform. It is not the beginning of a student experience initiative. It is a targeted integration sprint that validates the existing architecture end-to-end.

Everything beyond that scope belongs in a later sprint.

---

## 2. Architectural Principles

Sprint 17 is governed by the same principles that shaped the certified platform, applied specifically to student integration work.

**Teach First, Configure Second.** The student lands in a lesson, not in a configuration surface. Any authentication, assignment, or session mechanics stay out of the student's way.

**Calm Software.** The authenticated student experience should feel indistinguishable from the unauthenticated lesson experience. No banners, badges, or progress meters. No new UI ceremony.

**Save Teachers Time.** Sprint 17 succeeds when a teacher gains authentic classroom data without new configuration work. If a teacher must learn a new workflow, Sprint 17 has overreached.

**One Meaningful Decision Per Screen.** The student's only meaningful decision remains learning. Sprint 17 introduces no new decision points.

**Preserve Learning Across Years.** Nothing added during Sprint 17 may compromise the durability of the 50 certified lessons. Lessons remain independently usable, portable, and archival.

**Avoid LMS Scope Creep.** Sprint 17 is the sprint most at risk of drifting into LMS territory. Notifications, portfolios, gamification, messaging, and analytics are all out of scope by definition.

Three engineering principles govern how work is done:

**Preserve the Lesson.** Lesson HTML is instructional content. Sprint 17 does not modify lesson bodies to add platform behavior. Any integration is injected through shared infrastructure that already exists.

**Reuse Before Creating.** If a certified Cloud Function, Firestore collection, security rule, or client module already solves the problem, Sprint 17 uses it. New infrastructure is a last resort and must be justified.

**Extend Before Duplicating.** Where an existing surface is close but not quite sufficient, Sprint 17 extends it. Parallel systems are prohibited.

---

## 3. Architectural Baseline

Sprint 17 inherits and must reuse the following certified infrastructure. This inventory is authoritative. Nothing here may be duplicated, replaced, or worked around.

- Existing assessment pipeline (session start, attempt capture, scoring, rollup)
- Existing assessment sessions collection and schema
- Existing attempts collection and schema
- Existing rollups collection and computation
- Existing assignment lifecycle (draft, published, archived, roster resolution)
- Existing authentication (student sign-in, teacher sign-in, roles, claims)
- Existing teacher dashboard (assignment detail, roster, progress, drill-down)
- Existing Firestore schema and indexes
- Existing Cloud Functions (callables and triggers)
- Existing Firestore and Storage security rules

Sprint 17 extends this baseline. It does not replace it. It does not duplicate it. Any proposed change that could be implemented by wiring the existing baseline more carefully must be implemented that way.

---

## 4. Sprint Objective

Connect an authenticated student lesson experience to the certified assessment architecture without expanding the platform.

That is the entire objective. If a proposed change does not directly serve this sentence, it belongs in Sprint 18 or later.

---

## 5. Permitted Changes

Sprint 17 may include work in the following categories, and only when the work directly serves the learning loop:

- Student client integration with existing authentication
- Assessment runtime integration with existing session and attempt callables
- Router additions required to launch a lesson from an assignment context
- Authenticated lesson launch flow (assignment context in, lesson body untouched)
- Wiring to existing callable Cloud Functions
- Wiring to the existing assessment pipeline
- Client-side navigation between assignment and lesson
- Testing (unit, integration, end-to-end) required to certify the loop

Every permitted change must clear two gates:

1. It is required to make an authenticated student produce authentic data in the certified pipeline.
2. It reuses or extends existing infrastructure rather than creating parallel infrastructure.

If either gate fails, the change is not permitted under this contract.

---

## 6. Prohibited Changes

Sprint 17 shall not introduce any of the following. This list is exhaustive for the categories it names; the spirit of the list governs adjacent cases.

- New assessment architecture
- Duplicate Firestore collections
- Duplicate Cloud Functions
- Duplicate session models
- Duplicate attempt models
- Duplicate scoring pipelines
- Lesson rewrites
- Lesson-specific Firebase code embedded in lesson HTML
- Notifications (in-app, email, or push)
- Gradebook
- Analytics (product, learning, or otherwise)
- Portfolios
- Gamification (points, streaks, badges, leaderboards)
- Messaging (student-teacher, student-student, or broadcast)
- Student-facing dashboards
- LMS functionality of any kind
- Student profile features beyond what authentication already provides
- Feature flags beyond assignment context
- Backend infrastructure not required by the learning loop

If a proposed feature is not strictly required to validate the certified learning loop, it belongs in Sprint 18 or later. The default answer to "should we also add..." during Sprint 17 is **no, defer it**.

---

## 7. Preservation Mode

This section is permanent guidance and outlives Sprint 17.

Lessons are instructional resources. They are not platform components.

A lesson author, now or in the future, should never need to understand:

- Firebase
- Cloud Functions
- Firestore
- Authentication
- Assignment IDs
- Assessment sessions
- Backend architecture of any kind

Platform behavior is injected through shared infrastructure that lives outside lesson bodies. Lesson HTML remains isolated, portable, and archival. A lesson written in 2025 should still open, teach, and quiz in 2035 without knowledge of the platform that surrounds it.

This philosophy survives every future sprint. It is not a Sprint 17 constraint. It is a repository constraint that Sprint 17 is required to honor.

---

## 8. Definition of Success

Sprint 17 succeeds only when all of the following are true:

- A real authenticated student can open a lesson from an assignment context
- The student can complete the assessment inside that lesson
- The certified backend records the session, attempts, and rollup without new pipelines
- The existing teacher dashboard displays that student's authentic data with no new dashboard code
- No lesson HTML was modified to make this work
- No parallel infrastructure was introduced
- No feature outside the minimum learning loop was added

If every one of these is true, Sprint 17 is certifiable. If any one is false, Sprint 17 is not complete.

---

## 9. Definition of Failure

Sprint 17 fails if it does any of the following, regardless of how well the code works:

- Duplicates certified architecture
- Introduces a parallel assessment system
- Requires lesson authors to understand backend architecture
- Expands into LMS functionality
- Creates infrastructure that is not strictly necessary
- Adds features beyond the minimum authenticated learning loop
- Violates any architectural principle established during Sprints 9 through 16
- Modifies lesson HTML to carry platform behavior

A Sprint 17 that ships a working student experience while violating any of the above is a failed sprint. Working code is necessary but not sufficient.

---

## 10. Certification Requirements

Sprint 17 may be certified only when every one of the following holds:

- Every implementation conforms to this contract
- All regression suites from Sprints 9 through 16 continue to pass
- No duplicate architecture exists in the repository
- Preservation Mode remains intact across all 50 lessons
- Existing teacher workflows remain unchanged
- The authenticated student learning loop functions end-to-end against the certified backend
- Every addition made during Sprint 17 can be justified against Sections 4, 5, and 8 of this contract

When a reviewer evaluates any proposed Sprint 17 change, they need to answer exactly one question:

> **Does this conform to the Sprint 17 Certification Contract?**

If the answer is not a clear yes, the default decision is: **defer it to Sprint 18.**
