# Sprint 17 Implementation Specification

**Status:** Authoritative implementation contract for Sprint 17
**Type:** Engineering specification - not an architecture document, not an implementation report
**Supersedes:** Any prior informal Sprint 17 implementation notes
**Companion documents:** Sprint 17 Technical Recommendation, Sprint 17 Architecture Review, Sprint 17 Certification Contract, Sprint 17 Architecture Validation Report, ADR-0001: Lesson Platform Integration

The architecture phase is complete. Every architectural decision governing Sprint 17 has already been approved and certified. This document does not revisit those decisions. It translates them into an engineering contract that removes remaining ambiguity before coding begins.

When a Sprint 17 implementation decision is unclear, this document is authoritative. When this document is silent, the certified architecture governs. When the certified architecture is silent, the Sprint 17 Certification Contract governs.

---

## 1. Objective

Sprint 17 is an integration sprint. Its purpose is to connect authenticated students to the already-certified assessment architecture so that a real student can sign in, open an assigned lesson, complete it, and have the resulting classroom data flow through the certified backend to the existing teacher dashboard - all while preserving the instructional independence of the 50 certified lessons. Sprint 17 does not build a student platform, does not extend the assessment pipeline, and does not introduce new backend capability. It activates what already exists.

---

## 2. Scope

Sprint 17 implements exactly the surfaces required to complete the authenticated instructional learning loop. Nothing more.

Included in scope:

- Student authentication flow (reuses the certified sign-in path already used by teachers, with the student role branch).
- Student onboarding integration (reuses the certified onboarding surface; student is routed to their assignments after identity verification).
- Student assignment discovery (a single authenticated surface that lists the assignments a student can currently work on).
- Assignment launcher (opens a certified assignment inside its associated lesson with the necessary runtime context).
- Lesson runtime (`lyfelabz-assessment-runtime.js`), the single canonical integration point between lessons and the certified backend.
- Certified assessment pipeline integration (the runtime calls the certified callables; no new pipeline is introduced).
- Teacher dashboard population through existing infrastructure (authentic student attempts flow into the certified rollups and appear in the existing teacher dashboard with no dashboard code changes).

Everything outside the authenticated learning loop is out of scope. See Section 10.

---

## 3. Certified Architecture Reused

Sprint 17 reuses the following certified components without modification. This list is authoritative. Each item is treated as a fixed dependency, not a candidate for reshaping.

Cloud Functions (callables):

- `assessmentSessionsBegin` - starts an assessment session for an authenticated student against a specific assignment.
- `assessmentSessionsAutosave` - persists in-progress attempt state during the session.
- `assessmentAttemptsFinalize` - finalizes the attempt and triggers certified scoring and rollup.
- `assessmentAttemptGet` - retrieves a finalized attempt (used for the student results view).
- `assessmentAttemptsList` - lists attempts for the authenticated student against an assignment.

Backend and data:

- Existing assignment lifecycle (draft, published, archived, roster resolution).
- Existing Firestore collections (assignments, sessions, attempts, rollups, roster records, identity records).
- Existing Firestore and Storage security rules.
- Existing scoring pipeline and rollup computation.
- Existing assessment session and attempt schemas.

Teacher-facing surfaces:

- Existing teacher dashboard (assignment detail, roster, progress, drill-down). Sprint 17 does not modify it. Authentic student data appears through the same code path teacher-simulated data already uses.

Sprint 17 introduces **no duplicate assessment architecture**. There is no parallel session model, no parallel scoring path, no lesson-scoped Firestore write, and no lesson-scoped callable. Every write reaching Firestore during a Sprint 17 lesson session passes through the certified callables above.

---

## 4. New Components

Sprint 17 introduces the following new components, and only these. Each is justified by an integration requirement that cannot be satisfied by extending an existing surface.

- **`assignmentsListForStudent` callable.** Returns the assignments an authenticated student is currently permitted to work on, resolved through the existing assignment lifecycle and roster infrastructure. Required because the existing callables are scoped to a specific assignment; the student assignment discovery surface needs a role-appropriate list endpoint. No other purpose.
- **`activeStudent` surface.** The authenticated student's landing view. Lists assignments available to the student and provides the entry point into the assignment launcher. This is the student equivalent of the existing teacher landing surface and follows its conventions.
- **Student assignment launcher.** The routing surface that opens the certified lesson associated with an assignment and hands the runtime the context it needs (assignment id, authenticated identity, session intent). It does not embed lesson content. It navigates to the lesson.
- **`lyfelabz-assessment-runtime.js`.** The single canonical lesson runtime. Contract defined in Section 5.
- **Canonical lesson runtime include.** A one-line `<script defer>` tag added to every instructional page. Contract defined in Section 7.
- **Production Firebase configuration.** The production Firebase project configuration required to run the authenticated loop against the certified backend. This is deployment configuration, not new architecture.

No additional components are approved. If, during implementation, a new component appears necessary, the default answer is that an existing certified surface should be extended or wired more carefully. New components are a last resort and must be re-approved against the Sprint 17 Certification Contract before being introduced.

---

## 5. Runtime Contract

`lyfelabz-assessment-runtime.js` is the only lesson/platform integration point.

### 5.1 Responsibilities

The runtime is responsible for:

- **Assignment context detection.** On load, determine whether the current lesson page was opened from the assignment launcher (authenticated assignment context) or as a standalone lesson (legacy practice mode). Detection is inferred from the launch parameters handed off by the launcher; nothing in the lesson body participates.
- **Authentication verification.** In assignment context, verify that a valid authenticated student identity is present. If not, hand control back to the authentication flow. Never prompt for credentials inside the lesson page.
- **Session creation.** In assignment context, call `assessmentSessionsBegin` to open a certified session for the current assignment and student.
- **Autosave.** Persist in-progress attempt state through `assessmentSessionsAutosave` at the cadence defined by the certified pipeline. The runtime does not choose the schema; it forwards state captured from lesson interactions using the certified attempt shape.
- **Submission.** Finalize the attempt through `assessmentAttemptsFinalize` when the student completes the lesson's assessment. The runtime does not score, does not compute rollups, and does not decide correctness.
- **Student results handling.** After finalization, display the student's certified result using `assessmentAttemptGet`. The results view is a thin presentation over server-computed data.
- **Legacy practice-mode fallback.** In the absence of an assignment context, the runtime is inert with respect to the backend. The lesson behaves as a standalone instructional resource, exactly as it does today.
- **Future extensibility.** The runtime is versioned and centrally hosted so that future certified changes (new callables, additional context fields, expanded results views) can be rolled out by updating the runtime alone, without touching lesson bodies.

### 5.2 Prohibitions

The runtime must **never** contain:

- Teacher dashboard logic of any kind.
- Lesson content, instructional copy, or answer keys.
- Scoring logic, correctness rules, or rubric evaluation.
- Business rules already implemented on the server (assignment lifecycle, rollup computation, roster resolution, permissioning).
- Direct Firestore writes that bypass the certified callables.
- Parallel session or attempt schemas.
- Any code that is specific to a single lesson.

If a proposed runtime change would violate any of the above, the change is out of scope.

---

## 6. Student Learning Loop

The canonical authenticated workflow is:

Student signs in
&nbsp;&nbsp;&nbsp;&nbsp;&darr;
Student opens assignment
&nbsp;&nbsp;&nbsp;&nbsp;&darr;
Lesson loads
&nbsp;&nbsp;&nbsp;&nbsp;&darr;
Runtime activates
&nbsp;&nbsp;&nbsp;&nbsp;&darr;
Session begins
&nbsp;&nbsp;&nbsp;&nbsp;&darr;
Autosave
&nbsp;&nbsp;&nbsp;&nbsp;&darr;
Submission
&nbsp;&nbsp;&nbsp;&nbsp;&darr;
Certified backend
&nbsp;&nbsp;&nbsp;&nbsp;&darr;
Teacher dashboard displays authentic classroom data

This is the canonical Sprint 17 learning loop. Every implementation slice contributes to a portion of this loop and is evaluated against it. No slice may introduce a step outside this sequence.

---

## 7. Lesson Contract

Every instructional page in the repository satisfies exactly the following contract:

```html
<script defer src="/assets/lyfelabz-assessment-runtime.js"></script>
```

Nothing more.

Lessons shall contain:

- **No Firebase imports.**
- **No Cloud Function calls.**
- **No authentication logic.**
- **No backend state.**
- **No server business rules.**
- **No lesson-specific runtime code that reaches the backend.**

Lessons remain instructional resources. They are portable, archival, and independently usable. The only change Sprint 17 makes to lesson HTML is the addition of the one canonical include above.

Removal of the include reverts a lesson to a standalone instructional resource without breaking it. This property is required and must be verified.

---

## 8. Implementation Slices

Sprint 17 is divided into logical slices that build cumulatively toward the authenticated learning loop. Each slice is independently testable and each depends only on slices before it.

### Slice 1 - Runtime skeleton and canonical include

- **Objective.** Ship `lyfelabz-assessment-runtime.js` in an inert state and add the canonical `<script defer>` include to every instructional page.
- **Deliverables.** Runtime file at `/assets/lyfelabz-assessment-runtime.js`; canonical include added repository-wide; runtime detects absence of assignment context and remains inert.
- **Dependencies.** None.
- **Acceptance criteria.** Every lesson still functions identically in standalone practice mode. No new network calls occur on lesson load. Removing the include restores prior behavior byte-for-byte outside the tag itself.
- **Complexity.** Low. Mechanical repository-wide addition plus a minimal runtime scaffold.

### Slice 2 - `assignmentsListForStudent` callable

- **Objective.** Add the student-scoped assignment list callable.
- **Deliverables.** Callable implementation reusing the existing assignment lifecycle and roster resolution; tests; security rule review confirming no new exposure.
- **Dependencies.** None on Slice 1.
- **Acceptance criteria.** Callable returns the correct set of assignments for authenticated students under the existing security model. Returns nothing for unauthenticated callers. Introduces no new Firestore collection.
- **Complexity.** Low to medium.

### Slice 3 - Student authentication and onboarding integration

- **Objective.** Route an authenticated student through the certified sign-in and onboarding paths into the `activeStudent` surface.
- **Deliverables.** Role-branch wiring in the certified auth flow; onboarding hand-off; landing on `activeStudent`.
- **Dependencies.** None on Slices 1 and 2.
- **Acceptance criteria.** A verified student lands on `activeStudent` after sign-in without new configuration screens. Existing teacher and admin flows are unchanged.
- **Complexity.** Medium. Integration work with the certified identity surfaces.

### Slice 4 - `activeStudent` surface and assignment launcher

- **Objective.** Present the student's available assignments and launch the correct lesson with runtime context.
- **Deliverables.** `activeStudent` surface consuming `assignmentsListForStudent`; assignment launcher that navigates to the associated lesson with the required launch parameters.
- **Dependencies.** Slices 2 and 3.
- **Acceptance criteria.** Student can select an assignment and land on the associated lesson with detectable assignment context. No lesson HTML is modified beyond the Slice 1 include.
- **Complexity.** Medium.

### Slice 5 - Runtime session lifecycle

- **Objective.** Activate the runtime in assignment context and drive the certified session lifecycle.
- **Deliverables.** Session begin on lesson load in assignment context; autosave at the certified cadence; finalize on completion; student results view over `assessmentAttemptGet`.
- **Dependencies.** Slices 1 and 4.
- **Acceptance criteria.** A finalized attempt is visible in the certified backend and traceable to the authenticated student and assignment. Legacy practice mode continues to function on the same lesson with the include present but no assignment context.
- **Complexity.** Medium to high. This is the core integration slice.

### Slice 6 - End-to-end learning loop and teacher dashboard verification

- **Objective.** Verify that authentic student data flows into the existing teacher dashboard through the existing rollup and dashboard code paths.
- **Deliverables.** End-to-end test covering the canonical loop from Section 6; verification that the teacher dashboard displays authentic classroom data with no dashboard code changes; production Firebase configuration finalized.
- **Dependencies.** Slice 5.
- **Acceptance criteria.** A student completing an assigned lesson produces a rollup that the existing teacher dashboard renders indistinguishably from prior teacher-simulated data. No dashboard code was modified.
- **Complexity.** Medium.

Slices may be delivered sequentially. Later slices may not begin until their listed dependencies are accepted.

---

## 9. Testing Strategy

Every slice is verified at the layers appropriate to its surface. Sprint 17 does not introduce new test frameworks; it reuses the certified testing infrastructure established during Sprints 9 through 16.

- **Cloud Functions tests.** `assignmentsListForStudent` is unit-tested against the existing assignment and roster fixtures. Existing callables are not retested; Sprint 17 assumes their prior certification.
- **App tests.** The `activeStudent` surface, assignment launcher, and runtime session lifecycle are covered by app-level tests that drive the authenticated loop against the emulator suite.
- **Rules tests.** Where a slice touches security-relevant data access (specifically Slice 2), the existing Firestore rules tests are extended to confirm the new callable does not broaden student read scope.
- **Manual verification.** Every slice is manually verified by driving the surface as a real authenticated student. Console errors, responsive behavior, and accessibility are checked per repository quality control rules.
- **Regression testing.** After Slices 1 and 5 in particular, standalone lesson practice mode is regression-tested to confirm no instructional behavior changed.
- **Teacher workflow validation.** After Slice 6, the certified teacher workflows validated in Sprint 16 (assignment detail, roster, progress drill-down) are re-run against authentic student data to confirm identical behavior.
- **Student workflow validation.** The full authenticated student workflow - sign in, discover, launch, complete, view result - is validated as one continuous session.
- **Complete end-to-end authenticated learning loop validation.** The canonical loop in Section 6 is validated as a single scripted end-to-end scenario against the emulator suite and again against staging before certification.

Testing expectations are minimums, not ceilings. Slices with elevated risk (Slice 5) may require additional targeted coverage at the implementer's discretion.

---

## 10. Explicitly Out of Scope

The following features belong to Sprint 18 or later and must not be introduced during Sprint 17, even opportunistically:

- Enhanced student dashboard (beyond the minimal `activeStudent` assignment list).
- Portfolios.
- Analytics surfaces for students or teachers.
- Notifications of any kind (email, in-app, push).
- Teacher comments or feedback surfaces.
- Adaptive lessons or personalization.
- Offline support.
- Gamification (points, badges, streaks, leaderboards).
- Gradebook or grade export.
- LMS functionality (rostering integrations beyond what is already certified, standards mapping surfaces, LTI, deep linking beyond the certified Google Classroom path).
- New lesson content or lesson redesign of any kind (Preservation Mode remains in force).
- Any new instructional page type.
- Any new visual design system or component library.

Anything not strictly required to complete the authenticated learning loop is out of scope by definition. When in doubt, defer.

---

## 11. Certification Requirements

Sprint 17 is certified only if all of the following are true:

- Authenticated students can complete assigned lessons end to end.
- The certified backend records the resulting work through the existing callables and collections.
- The existing teacher dashboard displays authentic classroom data with no dashboard code changes.
- No duplicate assessment architecture exists anywhere in the codebase.
- No lesson-specific Firebase code exists in any lesson HTML file.
- No lesson-specific backend logic exists anywhere outside the certified server surfaces.
- Preservation Mode remains intact: no lesson has been redesigned, and lesson bodies contain only the single canonical runtime include added by Sprint 17.
- Legacy practice mode continues to function on every lesson.
- The Sprint 17 Certification Contract has not been violated in any slice.

Failure of any single item invalidates certification.

---

## 12. Success Definition

Sprint 17 succeeds when the authenticated instructional learning loop is complete: a real student, signed in and rostered, can open an assigned lesson, complete it, and produce authentic classroom data that appears in the existing teacher dashboard through the certified backend - with no lesson content changed, no duplicate architecture introduced, and no LMS-adjacent scope added.

Sprint 17 is not a student platform. It is not an LMS. It is not the beginning of a student experience initiative. It is an integration sprint that activates the certified architecture built during Sprints 9 through 16.

When the canonical loop in Section 6 runs end to end against the certified backend and the existing teacher dashboard renders the resulting data unchanged, Sprint 17 is done.
