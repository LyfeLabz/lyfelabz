# LyfeLabz Assessment Pipeline Specification

**Status:** Canonical. Single source of truth for LyfeLabz formative assessment behavior.
**Sprint of record:** Sprint 9A - Architecture Decision Workshop, ratified 2026-07-12.
**Companion documents:** LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_PLATFORM_DOMAIN_MODEL.md, LYFELABZ_FIRESTORE_DATA_MODEL.md, LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, PLATFORM_CONTRACTS.md, PLATFORM_STATE_MACHINE.md, ASSIGN_EXPERIENCE.md, LYFELABZ_ENGINEERING_STANDARDS.md.
**Precedence:** Where any earlier certified document conflicts with this specification, this specification controls and the earlier document is amended to agree. Terminology introduced by Sprint 8 and earlier (notably "Submission") continues to appear in historical documents; Section 2 governs terminology reconciliation.

This document defines how a LyfeLabz formative assessment is offered, taken, saved, submitted, scored, recorded, revised, and reported on. It replaces the pre-Sprint 9A assumption that a browser can compute or claim an authoritative score, that assessment state and assessment history are the same entity, and that student mode is a UI toggle. It records the platform's commitment to server-authoritative scoring, session-attempt separation, unlimited attempts, immutable attempt history, invisible complexity, and educator restraint.

The specification reads top-down. Sections 1 through 3 establish philosophy and vocabulary. Sections 4 through 12 define the assessment lifecycle. Sections 13 through 17 define the systems that support that lifecycle. Sections 18 through 21 record governance, extensibility, and operations.

---

## Sprint 9 Foundational Specification Set

This document is one of the four foundational Sprint 9 canonical specifications that together form the architectural foundation of the LyfeLabz platform. Future engineers should navigate between them as a single corpus:

- **`ASSESSMENT_PIPELINE_SPECIFICATION.md` (Sprint 9A, PDR-021)** - this document. The platform's assessment substrate.
- **`PLATFORM_OPERATIONS_SPECIFICATION.md` (Sprint 9B, PDR-022)** - the platform's operational substrate.
- **`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` (Sprint 9C, PDR-023)** - the platform's identity substrate.
- **`PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` (Sprint 9D, PDR-024)** - the transition between the core platform architecture and the operational teacher and student experience.

`PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` §0 records the relationship between the four documents and how they compose. Attempt semantics, session semantics, unlimited attempts by default, immutable history, server-authoritative scoring, and grace-period behavior originate in this document and are inherited by the pilot's student experience (`My Assignments`, `My Results`, submit-equals-completion, Improve My Score) without amendment.

---

## 1. Educational Philosophy

LyfeLabz assessments exist to reveal student thinking, not to sort students. Every architectural decision in this document is downstream of that stance.

- **Lessons are the home base.** A lesson is not a container for a quiz. A quiz is one activity a lesson makes available. A student who never opens the quiz has not failed the lesson.
- **Teach liberally, badge conservatively.** A lesson may teach a supporting concept beyond the strict wording of the performance expectation; the badge, the standards alignment, and the assessment scope stay conservative. This principle governs which items appear in an authoritative assessment and which items live only in the instructional narrative.
- **Reusable resource, not a checklist.** Every activity in the repository - lesson quiz, extension, investigation, simulation, engineering challenge - is available for open exploration by anonymous visitors. Authenticated students access only the activities their teacher has authorized, and any submitted attempt on an authorized activity is recorded. No student is presented with a required progression.
- **Exploration is preferred over completion.** The platform does not compute a percent-complete for a class, a student, or a curriculum. Growth is derived from evidence; completion is not.
- **Preserve educational integrity.** Every authoritative recorded artifact is what the student actually did, at the moment they did it, against the version of the assessment they saw. Historical evidence is never rewritten to reflect later scoring rules, later item wording, or later teacher preference.
- **Minimize educator cognitive load.** Every teacher-visible surface answers a workflow question a teacher would ask on a school day. The teacher never manages assessment versions, never tunes scoring, never authors an answer key, and never decides which internal revision a student was scored against.
- **Invisible complexity.** The platform absorbs technical complexity internally so that teachers see a simple, coherent surface. Session recovery, revision selection, idempotent submission, grace-period handling, and scoring all happen without teacher intervention and without teacher awareness.

These principles are load-bearing. Every rule in the remainder of this document is a consequence of one or more of them.

---

## 2. Formative vs Summative Assessment

LyfeLabz separates two assessment classes and gives each its own architecture.

**Formative assessments** are the subject of this specification. They comprise:

- lesson quizzes,
- extension activities,
- investigations,
- simulations,
- engineering challenges.

Formative assessments reveal student thinking during learning. They are:

- **repeatable without penalty,** because learning is iterative;
- **immediately explained,** because feedback is the point;
- **teacher-visible in aggregate,** because teachers use the evidence to teach.

**Summative assessments** are future end-of-unit assessments. They are out of scope for this specification and will receive an independent architecture document when they are designed. Summative assessments will not inherit formative defaults; a summative "retake" is not a formative "attempt" with a different label.

The two classes intentionally diverge on terminology, on repeatability policy, on windowing behavior, and on teacher tooling. Attempts to unify them into a single pipeline are rejected: the pipeline for revealing thinking during a lesson is not the pipeline for producing a defensible end-of-unit result.

### Terminology reconciliation

- **Attempt** is the canonical term for a single completed formative assessment record. This term replaces "submission" as the entity name for formative assessments.
- **Retake** is reserved for the future summative pipeline. A retake is not an attempt.
- **Session** is the transient, resumable working state that precedes an attempt. Sessions and attempts are distinct entities (see Section 5 and Section 8).
- Earlier certified documents (notably `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md` and the Sprint 5A / Sprint 6 charter entries) use "submission" as the formative record entity name. Those documents are superseded by this specification for the formative pipeline and are read forward with the mapping `Submission → Attempt`. Historical Sprint documentation is not rewritten; the reconciliation report accompanying Sprint 9A records the mapping.

---

## 3. Platform Design Principles

The specification is bound by six platform principles. Every rule below either implements one of these principles or is disallowed.

1. **Teach liberally, badge conservatively.** Assessment scope is narrower than instructional scope. An item is in an authoritative assessment only if it belongs to a standard the lesson claims.
2. **Lesson is the home base.** Assessment surfaces open from the lesson and return to it. There is no standalone assessment "app."
3. **Reusable resource, not a checklist.** Anonymous visitors may freely explore any activity in the repository. Authenticated students see and access only the activities their teacher has authorized for their class, and every submitted attempt on an authorized activity is recorded. There is no unauthorized-but-authenticated exploration path.
4. **Invisible complexity.** Sessions autosave and resume automatically. Revisions are selected internally. Grace periods activate automatically. Scoring happens server-side without the student or teacher configuring it. Every one of these systems is invisible on the surface.
5. **Preserve educational integrity.** Attempts are immutable and version-stamped. Scoring is server-authoritative. Answer keys are server-confidential. No actor can rewrite historical evidence.
6. **Minimize educator cognitive load.** Teachers see a small, stable set of workflow-relevant metrics and a small, stable set of authorization surfaces. Every teacher-visible field earns its screen space against this principle.

---

## 4. Authentication Model

Two identity states matter for assessment behavior.

**Anonymous visitor.**

- Any visitor may open a lesson and explore any activity attached to it, including the quiz.
- Anonymous interaction produces no attempt, no session, no recorded state.
- Nothing about anonymous interaction ever appears on a teacher dashboard.
- Anonymous quiz activity is deliberately not observable to LyfeLabz. This is a privacy stance, not a bug.

**Authenticated student.**

- A student authenticates through the platform's identity provider (see PDR-002).
- An authenticated student's activity surface is defined by teacher authorization. The student sees and may open only those activities that are authorized for them through their class assignments (see Section 12).
- On any authorized activity, every submitted attempt is recorded. There is no per-student opt-out at the attempt level, and there is no separate "just exploring" path once the student is authenticated.
- A student who wishes to browse the repository without their work being recorded does so as an anonymous visitor. Signing in is the act of entering the recorded, teacher-directed learning environment.

**Authenticated teacher.**

- Teachers preview activities. Teacher preview never produces an attempt.
- Teachers submit test answers during preview without side effects.

**Practice/Classroom toggle.**

- The pre-Sprint 9A platform exposed a Practice / Classroom mode toggle on the student surface. This toggle is removed.
- Assessment behavior derives automatically from authentication state and authorization state. There is no mode the student selects.
- Anonymous exploration is what "Practice" used to name. Authenticated authorized attempt is what "Classroom" used to name. Neither name appears on the surface.

This removal is required by the invisible-complexity principle and is possible only because authenticated students are confined to teacher-authorized activities. Once authentication uniquely implies the recorded, authorized path, the student no longer has to model the platform's data intent through a toggle. The platform models it internally.

---

## 5. Assessment Availability

Availability is governed by two independent identity states.

**Anonymous visitors.**

- The entire public repository - every lesson, quiz, extension, investigation, simulation, and engineering challenge - is freely available for open exploration.
- Anonymous exploration produces no session and no attempt. It is invisible to the platform and invisible to teachers by design (see Section 4).
- This is the platform's public face and the way LyfeLabz stays a repository of ideas rather than a gated LMS.

**Authenticated students.**

- Authentication moves the student out of open exploration and into the teacher-directed learning environment. In that environment, activity availability is defined by teacher authorization.
- An authenticated student sees and may open only those activities that are authorized for them through a class assignment. Unauthorized activities are not offered to authenticated students, and there is no separate "just exploring" path around this boundary.
- On an authorized activity, submitting an attempt records that attempt. There is no authenticated, unrecorded route through an authorized activity. Exploration without recording is the anonymous route.
- An activity is available for authoritative attempt to an authenticated student if and only if:
  - the student holds an active enrollment in a class,
  - that class has an assignment that authorizes this activity,
  - the assignment window permits new sessions (see Section 7), and
  - the student has not exceeded any assignment-level attempt cap (formative default: no cap; see Section 11).

**Authenticated teachers.**

- Teacher preview follows the preview code path (see Section 18) and never produces a session or an attempt on the student pipeline.

Availability is a server-evaluated property. The client presents a "Begin" affordance whose enabled state reflects the server's answer, but the server re-evaluates availability at session creation and at attempt finalization. A client that believes availability is granted has no authority to record an attempt if the server disagrees. Authorization checks apply to every authenticated read of an activity's assessment surface, not only to the attempt write.

---

## 6. Assessment Sessions

A session is the transient, resumable working state a student holds while working on an assessment. Sessions are the entity that supports "come back to this later." Sessions are not attempts. Sessions are never counted as evidence of student learning.

### Session properties

- A session is scoped to one student and one authorized activity in one class.
- A session captures the student's in-progress answers, timing markers, and enough context to resolve the activity, the class, the assignment, and the internal revision being taken.
- A session autosaves. The platform is responsible for durability; the student is not responsible for pressing "Save."
- A session resumes automatically. When the same student returns to the same activity while a live session exists, the session picks up where the student left off.
- Only one live session exists per (student, activity, class, assignment) tuple at a time. A new session is not created while a prior one is live.

### Session lifecycle

A session exists in exactly one of the following states.

- **Live.** Autosaving, resumable, awaiting further student action.
- **Submitted.** Transient. Only observable inside the server-side submission transaction. Never returned to a reader. On successful submission the session terminates and an attempt is created (see Section 8). On failure the session returns to Live.
- **Archived.** Terminal. Set when the session expires (see Section 9) or is administratively archived. Archived sessions are recoverable within the archival window (see Section 10) and are never counted as attempts.

Sessions do not have a "final" state that is anything other than "submitted and now expressed as an attempt" or "archived without submission." A live session that has not been submitted has not produced learning evidence, no matter how much work it contains.

### Session isolation from attempts

Sessions and attempts are distinct entities with distinct data shapes, distinct retention policies, distinct access controls, and distinct roles on teacher surfaces.

- Teacher dashboards do not show live sessions. A teacher cannot see "how far along" a student is on an in-progress attempt from a workflow surface, because "in progress" is not evidence. Aggregate liveness metrics remain internal.
- Attempts are never mutated to reflect session state. A session is not an attempt-in-progress; it is a separate object that may become the input to an attempt at the moment of successful submission.

---

## 7. Assignment Windows

An assignment window is the interval during which the assignment is open. Windows govern who may begin an assessment; grace periods govern who may finish one.

### Window definition

- Every assignment has an open moment and a close moment. Both are teacher-configurable at assignment creation.
- Between open and close, the assignment authorizes new sessions on its activity for enrolled students.
- Before open, the assignment does not authorize new sessions. The activity remains available for exploration (see Section 5) but not for authoritative attempt.
- After close, the assignment no longer authorizes new sessions. New sessions are refused. Sessions that were live at the close moment enter the grace period (see Section 7.1).

### Windowed authorization vs. exploration

Closed windows do not remove the activity from the public repository. Anonymous visitors continue to explore the activity freely. What closes is the authorization to begin a new session and record a new attempt through that assignment. Authenticated students retain read access to their prior attempts and to the activity as a historical assignment artifact; they do not begin new authoritative sessions on it.

### 7.1 Grace period behavior

Students who were already working when the window closed receive a one-hour grace period.

- The grace period applies only to sessions that were live at the moment the window closed.
- The grace period does not apply to new sessions. No new sessions begin after the close moment.
- The grace period permits the student to submit the live session. The submission produces an authoritative attempt in the ordinary way.
- The grace period is a platform default (one hour) and is a configurable operational constant (see Section 21). Teachers do not set or override it.
- Saved work in a live session remains preserved even if the student does not submit within the grace period. The session is archived on grace-period expiry; see Section 9 and Section 10.

The grace period exists so that a student who is mid-thought at close time is not punished by the clock. The one-hour limit is intentional: it protects the assignment window from indefinite extension while acknowledging that the student was already working in good faith.

---

## 8. Attempt Lifecycle

An attempt is the authoritative, immutable record of a completed formative assessment. Attempts are created only after successful server-side submission.

### Attempt properties

- One attempt corresponds to one successful submission by one student on one assignment in one class.
- An attempt records the identity of the student, the identity of the class at the moment of submission, the identity of the assignment, the identifier of the activity, the internal revision identifier of the assessment at the moment of submission, the student's item-level responses, the item-level correctness, the item-level points earned, the aggregate score, the feedback that was delivered, and the relevant timestamps (see Section 13).
- An attempt is immutable once written. No actor - student, teacher, administrator, or platform - mutates a finalized attempt document. Corrections and annotations, when they exist, live adjacent to the attempt, not by mutating it.
- There is no "Submission" entity separate from the attempt. The attempt is the authoritative record. The `submitted` state is a transient state inside the server-side submission transaction; it is never externally observable.

### Attempt creation

An attempt is created only after all of the following are true.

- The submitting client is an authenticated student.
- The student holds an active enrollment in the class referenced by the assignment.
- The assignment is either inside its window or the student's session is in a grace period (see Section 7.1).
- The submission is idempotent against a client-supplied idempotency marker. A retry that arrives after the server has already produced an attempt for this session does not produce a second attempt.
- The server-authoritative scorer has produced a score, item-level correctness, and item-level points earned (see Section 11).

If any of these conditions fails, no attempt is created. The client receives a well-defined error and the session either remains live (for recoverable errors) or is archived (for terminal errors).

### Attempt count

An attempt count is the number of attempts a student has produced for a given assignment. It advances only when an attempt is created. Live sessions, archived sessions, and expired sessions do not advance the attempt count.

---

## 9. Session Expiration

Sessions expire on inactivity. Expiration protects the platform from indefinite state accumulation and protects the student from stale context.

- The platform default session expiration is 24 hours after last student activity.
- Expiration is a configurable operational constant (see Section 21). Teachers do not set or override it.
- On expiration, the session enters the archived state (see Section 10). No attempt is produced by expiration alone.
- Expiration is measured from last activity, not from session creation. A student who is actively working does not have their session expired out from under them.

Expiration is intentional. It expresses the invariant that a session is a resume-later working area, not a permanent workspace. A student who has not returned in 24 hours is starting over.

---

## 10. Archived Sessions

An archived session is a terminated session that did not produce an attempt. Archived sessions exist for a bounded recovery period and are then deleted.

- Archived sessions are never counted as attempts. They are never returned by any teacher-facing metric. They are never included in growth calculations.
- Archived sessions are retained temporarily so that a session that was archived by mistake (client crash, misclick, ambiguous grace-period boundary) can be recovered on request. The recovery window is a configurable operational constant (see Section 21).
- After the recovery window elapses, archived sessions are deleted under the platform's ordinary retention policy.
- Recovery of an archived session, when granted, returns the session to the live state and does not itself produce an attempt. The student must submit to produce an attempt.

Archived sessions are the reason the platform can offer strong autosave and a 24-hour session lifetime without accumulating unbounded state.

---

## 11. Attempt Model

The attempt model is the shape of the authoritative record and the guarantees around its production.

### 11.1 Server authoritative scoring

Scoring is completely server-authoritative.

- The browser submits answers.
- The server computes the score against the server-confidential answer key.
- The server stores the score, the item-level correctness, and the item-level points earned on the attempt document.
- The browser displays only the score the server returns.

There is no browser-authoritative score. A client that computes a score and reports it is not participating in the pipeline; its computation is discarded. A prior generation of the platform allowed a client-side "practice score" to inform teacher-adjacent surfaces; that pattern is removed.

### 11.2 Server-side answer keys

Authoritative answer keys are server-confidential.

- Answer keys never reach the browser before submission. A client that inspects its network payloads sees only the item stems and permitted metadata. It does not see the correct answers, the item-level rubrics, or the distractor rationales that inform explanations.
- Answer keys are held in a server-controlled surface that only Cloud Functions read. No client-side artifact, no CDN-cached asset, and no in-page JavaScript bundle contains the answer key.
- Cloud Functions perform grading against the answer key. Grading is the only operation authorized to read the key.

Post-submission, the server returns to the browser a specific, permitted feedback payload: the score, the item-level correctness for the items the student answered, the correct answers for those items, and the explanations for those items. The distinction is that the browser learns the correct answer after submitting, not before.

### 11.3 Feedback pipeline

Immediately after a successful attempt, the platform returns:

- the aggregate score,
- the correct answers to each item, and
- the item-level explanations.

The feedback payload is authored inside the server response so that the client cannot fabricate feedback that the server did not send. The client is responsible only for display. New attempts always begin blank; feedback from a prior attempt is never pre-filled into a new session.

### 11.4 Unlimited attempts

Formative assessments allow unlimited attempts.

- Every submitted attempt is preserved. No attempt is overwritten. No attempt count is capped by default.
- An assignment may in principle carry a per-assignment maximum attempt count; the platform default is uncapped and teachers are not offered an attempt-cap surface at the initial teacher UI. Whether the future teacher UI ever exposes an attempt cap is a product decision recorded under PDR-018.
- Every attempt is an independent record. Growth metrics (Section 14) derive from the ordered set of attempts, not from a single "current" attempt.

### 11.5 Attempt data preserved

Every attempt preserves the following educationally meaningful evidence.

- **Student context.** Stable reference to the student who produced the attempt.
- **Assessment context.** The activity's stable identifier and the internal revision identifier the student was scored against (see Section 15).
- **Assignment context.** Stable reference to the assignment and to the class at the moment of submission.
- **Timing.** The moment the session began, the moment the student submitted, and the moment the server finalized the attempt.
- **Attempt number.** The one-based ordinal of this attempt for this student on this assignment.
- **Score.** The aggregate score the server computed.
- **Question-level responses.** The student's answer to each item, recorded in a form that can be redisplayed exactly as the student submitted it.
- **Correctness.** The item-level correctness the scorer produced.
- **Points earned.** The item-level points the scorer produced.
- **Feedback delivered.** The correct answers and explanations returned to the student for this attempt.

The platform collects only educationally meaningful evidence. Behavioral telemetry - mouse movement, dwell time per item, tab-focus events, keyboard cadence - is deliberately not collected on attempts. The absence is a design choice, not an oversight.

---

## 12. Assignment Architecture

An assignment authorizes a specific activity for a specific class during a specific window.

### 12.1 One assignment, one class

Every assignment belongs to exactly one class.

- An assignment references one activity, one class, one open moment, one close moment, and the internal revision policy for the activity at the moment of publication.
- A teacher who wishes to assign the same activity to multiple classes creates one assignment per class. The platform performs this fan-out automatically when the teacher's workflow expresses "assign to these classes."
- Teachers experience the fan-out as one workflow. Internally the platform holds N assignment records for N classes. Each record is independent.

The one-assignment-per-class rule is load-bearing. It preserves per-class ownership boundaries in the domain model, keeps rollup records per-class-scoped, and eliminates a class of cross-class visibility bugs.

### 12.2 Assignment lifecycle

An assignment moves through a fixed sequence.

- **Draft.** Private to the teacher. Not visible to students. Not counted anywhere.
- **Published.** Visible to enrolled students. Between open and close, sessions may begin. Attempts may be recorded during the window and during the grace period.
- **Closed.** Past the close moment (and past the grace period for sessions that were live at close). No new sessions may begin. Existing sessions have either produced attempts, been archived, or been recovered under Section 10.
- **Archived.** Class-level or teacher-level archival propagates to assignments. Historical attempts remain readable. No new sessions may begin.

Assignments never re-open. A teacher who wishes to re-authorize an activity for a class publishes a new assignment. The new assignment produces new attempts; historical attempts remain attributed to the earlier assignment.

### 12.3 Assignment authorization

Authorization to record an attempt on an activity is derived from the assignment.

- The activity in the assignment is the only activity authorized for authoritative attempt through that assignment.
- A student who is enrolled in the class holds authorization for the assignment while the assignment is published and the window (or grace period) permits it.
- Removal of a student's enrollment revokes authorization prospectively. Attempts already produced remain attributed to the class at the moment of submission (Section 11.5).

---

## 13. Server Authoritative Scoring (Consolidated)

Section 11.1 stated the invariant. This section records its operational consequences.

- Every formative assessment surface writes through a Cloud Function scorer. There is no direct client write to the attempt collection.
- The scorer is idempotent. A retry that arrives after a successful scoring produces no second attempt and no second audit event; the retry is acknowledged as `alreadyFinalized`.
- The scorer performs class-boundary validation, assignment-window validation, grace-period validation, session ownership validation, revision resolution, and answer-key evaluation before writing the attempt.
- Scoring latency is a platform-level operational property. It is not a teacher-configurable value.
- If the scorer cannot compute a score (for example, an answer-key integrity failure), no attempt is written and the client receives a well-defined error. Silent partial scoring is prohibited.

The scorer is the single trust boundary at which "the student's browser said this" becomes "the platform records this." Every other component - the browser, the session store, the assignment record, the class snapshot - is either upstream input or downstream projection.

---

## 14. Teacher Analytics

Teacher dashboards initially expose a fixed set of metrics per (student, assignment) pair.

- **Highest score.** The highest aggregate score across the student's attempts on the assignment.
- **First score.** The aggregate score of the student's first attempt on the assignment.
- **Latest score.** The aggregate score of the student's most recent attempt on the assignment.
- **Attempt count.** The number of attempts the student has produced for the assignment.
- **Growth.** A summarized comparison of first score to latest score for the assignment, expressed as the change in aggregate score.

The five metrics are the entire teacher-facing metric surface at the initial release. Additional analytics may exist internally to support platform observability and future features; those internal analytics are not exposed to teachers without a subsequent Platform Decision Record.

The five metrics were chosen because they answer the workflow questions a teacher asks during a school day: "how did they do at their best," "where did they start," "where are they now," "have they engaged," and "are they growing." Every additional metric proposed for the teacher surface is measured against those questions.

Aggregation of these metrics into class-level and cohort-level rollups follows the rollup discipline recorded in `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md` (read forward under the Submission → Attempt mapping). Rollups do not compute teacher metrics by scanning attempts at read time.

---

## 15. Assessment Revision Strategy

Teachers never manage assessment versions.

- The platform automatically creates an internal revision identifier when the assessment content changes in a way that would meaningfully affect scoring or student experience.
- Minor editorial corrections (typo fixes, punctuation, cosmetic phrasing that does not change item meaning) do not create a new revision.
- Revision identifiers are internal. They do not appear on any teacher-facing surface, on any student-facing surface, or in any teacher-configurable field.
- Every attempt records the internal revision identifier of the assessment at the moment of submission. Historical attempts remain interpretable even after later revisions ship.
- The Platform Administrator (see Section 16) authors and versions assessment content. Teachers do not.

The revision boundary is defined by the effect of the change, not by the surface of the change. Adding an item, removing an item, changing an item's stem in a way that alters its meaning, changing the correct answer, changing the distractor set, changing the rubric, changing the number of points on an item, or changing the item ordering rule are all revision-creating changes. Fixing a typo or reflowing an explanation is not.

Revisions are never exposed to teachers because exposing them would recreate the LMS-style "manage assessment version" workflow the platform declines to build.

---

## 16. Curriculum Governance

Canonical curriculum is owned exclusively by the Platform Administrator.

The Platform Administrator holds sole authority over:

- lessons,
- quizzes,
- extensions,
- investigations,
- simulations,
- engineering challenges,
- answer keys,
- explanations,
- standards alignment,
- assessment items,
- the internal revision boundary described in Section 15.

Teachers configure delivery. Teachers do not modify canonical curriculum. In particular, teachers do not edit assessment items, do not edit answer keys, do not edit explanations, do not edit standards alignment, and do not fork assessments per class.

A future teacher suggestion workflow may be added. Any such workflow is a suggestion pipeline: teacher input becomes a proposal that the Platform Administrator evaluates. The suggestion pipeline is not authorization for teachers to write curriculum directly.

This ownership model preserves educational integrity across the entire fleet of classes. A student who takes an assessment in one class and moves to another class in the same district takes the same canonical assessment.

---

## 17. Future Extensibility

The specification anticipates several capabilities that may be added without rewriting the pipeline.

- **Rubrics.** Rubric-scored items extend the per-item scoring shape. The attempt already carries item-level points earned, correctness, and delivered feedback; rubric results are an extension of these existing fields, not a new record type.
- **Open-response scoring by language models.** Server-mediated model scoring produces an item-level score and rationale that lives on the attempt in the same shape as any other item-level score. Model outputs are validated server-side before they reach the student.
- **Teacher annotations.** Annotations on an attempt live adjacent to the attempt, not by mutating it. The attempt's immutability is preserved.
- **Growth trajectories.** Multi-attempt trajectory metrics are derived from the ordered set of attempts. No new attempt-level field is required to support them.
- **Standards-attainment reporting.** Standards reporting is derived from attempts by the analytics pipeline described in `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md` §10. It does not repurpose teacher workflow rollups.
- **Summative pipeline.** End-of-unit summative assessments will have their own architecture document. Retake semantics belong there, not here.
- **Parent views.** Parent access is a scoped read against student-level rollups and targeted reads of attempts the parent is authorized to see. It reuses existing surfaces.
- **LMS grade export.** Grade export reads attempts, respects class ownership, and produces the export format the target LMS requires. It does not modify the attempt model.

Each capability is compatible with the specification without a schema break because the attempt records educationally meaningful evidence at a granularity that supports these downstream uses.

---

## 18. Security Model

The pipeline's security posture is the direct consequence of the server-authoritative scoring rule and the server-confidential answer-key rule.

- **Trust boundary.** The only trusted producer of an attempt is a Cloud Function scorer. The browser is untrusted for scoring and for attempt writing.
- **Answer-key confidentiality.** Answer keys are never delivered to a client before submission. They are held in a server-controlled surface readable only by the scorer.
- **Class-boundary enforcement.** Every attempt read and every attempt write is scoped to the class at the moment of submission. Cross-class reads are impossible by construction (see `LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md` §8).
- **Idempotency.** Every submission carries a client-supplied idempotency marker. The scorer deduplicates on the marker. Retries are safe.
- **Session ownership.** A session is readable and writable only by the owning student and the platform. Teachers do not read live sessions. Teachers do not resume sessions on a student's behalf.
- **Preview isolation.** Teacher preview of an activity uses a preview code path that never invokes the scorer's attempt-writing surface and never touches the attempt collection.
- **Anonymous isolation.** Anonymous interaction produces no session and no attempt. Anonymous sessions are not held server-side.
- **Attempt immutability.** No production caller can mutate a finalized attempt. Administrative correction paths, if introduced, run through an audited surface that writes an adjacent correction record; they do not overwrite the attempt.
- **Personal data minimization.** Attempts carry stable internal references, not display names or emails. Names appear on teacher dashboards through denormalized snapshot fields governed by the class snapshot architecture.
- **Retention.** Attempts are retained for the lifetime of the class's historical record. Sessions expire on the schedule defined in Section 9. Archived sessions are retained for the recovery window defined in Section 10 and then deleted.

The pipeline's security invariants are enforced primarily in Cloud Functions and secondarily in Security Rules. Where the two disagree, the Cloud Function is authoritative and the Security Rules are widened only to permit the Cloud Function's write path.

---

## 19. Operational Considerations

The specification imposes operational obligations on the platform. Section 21 in `LYFELABZ_ENGINEERING_STANDARDS.md` will be updated to reflect these obligations; this section records them at the specification layer.

- **Configurable operational constants.**
  - Session expiration: default 24 hours from last student activity.
  - Grace period: default 1 hour after assignment close for sessions that were live at close.
  - Archived-session recovery window: bounded; set at operational review; not exposed to teachers.
  - Attempt retention: for the lifetime of the class's historical record; class archival does not delete attempts.
- **Scorer availability.** Scoring is on the critical path for attempt creation. Scorer outages are teacher-visible: submission fails and the session stays live. Sessions do not expire simply because the scorer was unavailable; expiration is measured from student activity.
- **Answer-key deployment.** Answer keys ship as server-controlled artifacts and are versioned with the internal revision identifier of the assessment. Deploying a new answer key without a matching revision boundary is prohibited.
- **Attempt collection growth.** Attempts accumulate across school years. Aggregate growth is bounded by the class snapshot architecture and by the analytics pipeline; per-class growth remains readable by teacher dashboards via the rollup strategy.
- **Session store growth.** Sessions plus archived sessions are bounded by session expiration and the recovery window. The session store never grows without bound.
- **Assignment lifecycle observability.** The platform records assignment publication, closure, grace-period activation, and archival events as audit records so that "why did my session get archived" can be answered from the record.
- **Backfill and recomputation.** Rollups are recomputable from attempts. Attempts are not recomputable from rollups. Any dispute between the two is resolved by reading the attempt.
- **Latency budgets.** Session autosave, session resume, submission, and scoring each have latency budgets recorded in the operational runbook. Budgets are not teacher-configurable.

---

## 20. Relationship to Prior Architecture

This specification supersedes the pre-Sprint 9A assumption chain in the following ways.

- The pre-Sprint 9A architecture treated the "submission" as the authoritative record. This specification treats the **attempt** as the authoritative record and treats the **session** as a distinct upstream entity. There is no separate Submission entity.
- The pre-Sprint 9A architecture allowed a Practice / Classroom mode toggle on the student surface. This specification removes the toggle; mode is derived from authentication and authorization.
- The pre-Sprint 9A charter allowed a client-computed "practice" score to influence platform behavior. This specification prohibits any client-authoritative score; all scoring is server-authoritative for both formative and future summative pipelines.
- The pre-Sprint 9A architecture spoke of "retake" as the successor to a formative submission. This specification reserves "retake" for the future summative pipeline and uses "attempt" for formative.
- The pre-Sprint 9A architecture did not define a session expiration or an archived-session recovery window. This specification defines both.
- The pre-Sprint 9A architecture did not define the grace-period behavior at assignment close. This specification defines it (Section 7.1).
- The pre-Sprint 9A architecture did not define an internal revision boundary distinct from lesson versioning. This specification defines the assessment revision strategy (Section 15).
- The pre-Sprint 9A architecture allowed one assignment to reference multiple classes. This specification records the one-assignment-per-class rule and the automatic fan-out (Section 12.1).

Every earlier certified document is reconciled to this specification in the Sprint 9A reconciliation report.

---

## 21. Change Discipline

Changes to this specification are governed by the same discipline as Platform Decision Records.

- Sections 1 through 4 are load-bearing philosophy. They change only through an explicit Platform Decision Record amendment.
- Sections 5 through 12 define the lifecycle. Changes to lifecycle behavior require a Platform Decision Record amendment.
- Section 15 (revisions) and Section 16 (governance) express ownership boundaries. They change only through an explicit Platform Decision Record amendment.
- Sections 17 through 19 record extensibility and operations. Extensibility additions may proceed under ordinary sprint discipline provided they honor Sections 1 through 16.
- Section 20 records the reconciliation with prior architecture; it is a historical record and is not itself a rule surface.

The specification is the single source of truth. When any subsequent document conflicts with it, the specification controls and the subsequent document is amended.

---

## Change Log

- 2026-07-12 - Initial specification established under Sprint 9A. Ratifies session-attempt separation, server-authoritative scoring, server-confidential answer keys, unlimited-attempt formative posture, one-hour grace period, 24-hour session expiration, archived-session recovery window, removal of the Practice / Classroom toggle, one-assignment-per-class rule with automatic fan-out, five-metric teacher analytics surface, platform-owned assessment revision boundary, and Platform-Administrator-owned canonical curriculum.
