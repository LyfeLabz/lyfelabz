# Sprint 9A Reconciliation Report

**Status:** Reconciliation report for Sprint 9A - Architecture Decision Workshop
**Date:** 2026-07-12
**Scope:** Documentation and architecture reconciliation only. No implementation code, no Firebase configuration, no application code changed.

Sprint 9A ratified the LyfeLabz formative assessment pipeline. This report records the documentation work that translated the ratified architecture into the certified documentation set. The authoritative source of the ratified architecture is `ASSESSMENT_PIPELINE_SPECIFICATION.md` and PDR-021.

---

## 1. Files Created

- `docs/platform/ASSESSMENT_PIPELINE_SPECIFICATION.md` - The new canonical specification for LyfeLabz formative assessment behavior. Written from scratch as a professional architecture document. Twenty-one sections spanning philosophy, formative-versus-summative separation, platform design principles, authentication, availability, sessions, assignment windows and grace period, attempt lifecycle, session expiration and archival, the attempt model, assignment architecture, server-authoritative scoring, teacher analytics, assessment revision strategy, curriculum governance, future extensibility, security model, operational considerations, relationship to prior architecture, and change discipline. This document is the single source of truth for formative assessment behavior.
- `docs/platform/SPRINT_9A_RECONCILIATION_REPORT.md` - This report.

## 2. Files Modified

- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` - Amended PDR-008 with a Sprint 9A Reconciliation Notice recording the Submission → Attempt terminology change, the session-attempt separation, the server-authoritative scoring rule, and the removal of the Practice / Classroom mode toggle. Added PDR-021 (Assessment Pipeline Architecture) with seven sub-decisions (a through g). Extended the change log.
- `docs/platform/LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md` - Prepended a Sprint 9A Reconciliation Notice. Terminology mapping Submission → Attempt applies throughout. Section 5 amended for grace period and unlimited attempts. Session distinction called out. Teacher metric surface narrowed to the five metrics of PDR-021c.
- `docs/platform/LYFELABZ_PLATFORM_DOMAIN_MODEL.md` - Prepended a Sprint 9A Reconciliation Notice reconciling the Assessment Submission entity to the Attempt entity, introducing the Session entity, and pointing at PDR-021 for load-bearing behavior. Companion documents list extended.
- `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md` - Prepended a Sprint 9A Reconciliation Notice reconciling the `submissions/{submissionId}` collection shape to the Attempt entity, retiring the `mode` field, introducing the Session collection distinction, and stamping every attempt with the internal assessment revision identifier.
- `docs/platform/PLATFORM_CONTRACTS.md` - Prepended a Sprint 9A Reconciliation Notice extending the browser storage prohibitions to the Attempt and Session entities and to feedback payloads.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` - Prepended a Sprint 9A Reconciliation Notice reconciling the `submissionsCreate` and `submissionsFinalize` callables to the scorer's Attempt write path, adding the Session callable surface, retiring the `mode` field, and enforcing server-confidential answer keys.
- `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md` - Prepended a Sprint 9A Reconciliation Notice reconciling the Attempt collection as write-only through the Cloud Function scorer, introducing Session-collection access rules, denying answer-key reads from any client role, and requiring server-side archival recovery.
- `docs/platform/ASSIGN_EXPERIENCE.md` - Prepended a Sprint 9A Reconciliation Notice recording the one-assignment-per-class rule with automatic fan-out, the one-hour grace period, unlimited attempts, removal of the Practice / Classroom mode toggle, and platform-owned assessment revisions.
- `docs/platform/LYFELABZ_PLATFORM_ARCHITECTURE.md` - Prepended a Sprint 9A Reconciliation Notice pointing at the specification as the single source of truth for the assessment pipeline and summarizing the seven load-bearing changes.
- `docs/platform/LYFELABZ_ENGINEERING_STANDARDS.md` - Added Section 15A (Sprint 9A Operational Standards for the Assessment Pipeline) covering server scoring, answer key protection, session retention, archived session retention, immutable attempts, assignment lifecycle, and assessment revisions.

## 3. Summary of Architectural Changes

Sprint 9A ratified seven load-bearing decisions and a body of supporting behavior.

1. **Session-attempt separation.** A session is transient, resumable, autosaving working state. An attempt is the authoritative, immutable record of a completed formative assessment. Sessions are never counted as attempts. There is no separate Submission entity; the `submitted` state is transient inside the server scoring transaction. Sessions expire 24 hours after last activity, are archived on expiry, and are retained for a bounded recovery window before deletion.
2. **Server-authoritative scoring; server-confidential answer keys.** The browser submits answers; the server computes the score; the server stores the score; the browser displays only the score the server returns. No browser-authoritative score exists under any name. Answer keys are held in a server-controlled surface readable only by the scorer.
3. **Unlimited attempts and immutable history.** Every submitted attempt is preserved. No attempt is overwritten. Teacher dashboards initially expose exactly five metrics per (student, assignment): highest score, first score, latest score, attempt count, and growth.
4. **Platform-owned assessment revision boundary.** Teachers never manage assessment versions. The platform automatically creates internal revisions when assessment content changes in a way that would meaningfully affect scoring or student experience. Minor editorial corrections do not create a new revision. Revision identifiers are internal.
5. **Practice / Classroom mode toggle removed.** Assessment behavior derives automatically from authentication and authorization. Anonymous exploration produces no session and no attempt. Authenticated authorized exploration on an assigned activity produces an attempt on submission. The toggle does not return under a rename.
6. **Assignment windows with a one-hour grace period.** Windows control who may begin an assessment. Students already working when a window closes receive a one-hour grace period for submission. No new sessions begin after close. Saved work in a live session is preserved even if the student does not submit within the grace period.
7. **One assignment belongs to exactly one class; canonical curriculum ownership.** Multi-class assignment is expressed as automatic per-class fan-out. Canonical curriculum - lessons, quizzes, extensions, investigations, simulations, challenges, answer keys, explanations, and standards alignment - is owned exclusively by the Platform Administrator. Teachers configure delivery but do not modify canonical curriculum.

Supporting behaviors ratified alongside the seven decisions: formative-versus-summative separation with "retake" reserved for the summative pipeline; a fixed feedback payload of score, correct answers, and item-level explanations; new attempts always begin blank; anonymous quiz activity deliberately not observable; teacher preview never producing an attempt; the class snapshot architecture continuing to govern class-at-submission attribution.

## 4. Contradictions Resolved

Every contradiction below was identified in the certified documentation and resolved by amending the affected document to defer to `ASSESSMENT_PIPELINE_SPECIFICATION.md`.

1. **PDR-008 named "Submission" as the entity and "retake" as the repeat action.** Resolved by amending PDR-008 with a Sprint 9A Reconciliation Notice mapping Submission → Attempt and reserving "retake" for the future summative pipeline. Substantive commitments (server-side finalization, immutability, version stamping) survive.
2. **`LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md` treated a resubmission policy as an assignment-level toggle.** Resolved by amending Section 5 through the reconciliation notice: formative assessments allow unlimited attempts by default; every attempt is preserved.
3. **`LYFELABZ_SUBMISSION_ROLLUP_STRATEGY.md` §5 said finalization requests against a closed assignment are rejected server-side.** Resolved by amending the closure rule: no new sessions begin after close, but sessions live at close receive a one-hour grace period during which submission remains permitted.
4. **`LYFELABZ_PLATFORM_DOMAIN_MODEL.md` treated "in-progress state" as either local to the client or a short-lived working area.** Resolved by naming the Session entity with explicit lifecycle, expiration, and archival semantics.
5. **`LYFELABZ_FIRESTORE_DATA_MODEL.md` and `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` carried a `mode: "practice"` / `mode: "classroom"` field on the submission shape.** Resolved by retiring the field. Every recorded attempt is by definition an authenticated authorized attempt; the Practice / Classroom toggle is removed by PDR-021e.
6. **`LYFELABZ_CLOUD_FUNCTION_CHARTER.md` §11 said "Immediate right/wrong feedback for practice questions is computed locally. Only Classroom Mode submissions require server-side scoring."** Resolved by scoping local right/wrong to non-recording exploration and requiring server-authoritative scoring for every authoritative attempt.
7. **`ASSIGN_EXPERIENCE.md` and adjacent teacher-facing documents implied a teacher-visible mode selection.** Resolved by removing the mode toggle from the teacher workflow. Behavior derives from authentication and authorization.
8. **Earlier documents implied that a single assignment might reference multiple classes.** Resolved by codifying the one-assignment-per-class rule and describing the automatic per-class fan-out as a workflow-layer feature that produces N records.
9. **Earlier documents implied that teachers might manage assessment versions.** Resolved by codifying the platform-owned internal revision boundary. Revision identifiers are internal only.
10. **Earlier documents did not name a session expiration or an archival recovery window.** Resolved by defining a 24-hour session expiration measured from last activity, an archived state on expiry, a bounded configurable recovery window, and terminal deletion after the window elapses.
11. **Earlier documents did not name a grace period at assignment close.** Resolved by defining the one-hour grace period as a platform default and a configurable operational constant.
12. **Earlier documents implied "retake" as the successor to a submission on repeat.** Resolved by reserving "retake" for the future summative pipeline and naming "attempt" as the formative record entity.

## 5. Future Implementation Implications

Sprint 9A does not write code. It does record the constraints Sprint 9B (and every subsequent assessment-related sprint) must honor. The most material implications are:

- **Firestore collection renames.** The pre-Sprint 9A `submissions/{submissionId}` collection is understood forward as the Attempt collection. Sprint 9B implementation is responsible for the concrete rename and any migration semantics.
- **New Session collection.** A distinct Session collection is required. It carries autosave state, expiration metadata, and archival metadata. It is written by session-management callables. Sprint 9B is responsible for the concrete shape.
- **Answer key surface.** The server-controlled answer key surface must exist before authoritative attempts ship. Sprint 9B is responsible for its concrete storage, its versioning tie to the internal assessment revision identifier, and its access enforcement.
- **Scorer callable.** The scorer's callable surface must accept item-level responses, an idempotency marker, and enough context to resolve the class, the assignment, the session, and the active internal revision. It must return the aggregate score, item-level correctness, and item-level feedback.
- **Session-management callables.** A session-management callable surface handles session start, autosave, resume, expiration, and archival recovery. Clients do not autonomously promote archived sessions to live.
- **Retirement of the `mode` field.** The pre-Sprint 9A `mode: "practice"` / `mode: "classroom"` field is retired on both the submission (attempt) shape and the assignment shape. Sprint 9B is responsible for the concrete schema change.
- **Fan-out on multi-class assign.** The Assign workflow must produce N assignment records for N target classes through a server-mediated callable. Sprint 9B is responsible for the concrete callable shape and the audit event.
- **Grace-period evaluation.** The scorer must evaluate grace-period eligibility at submission time by comparing session start time, session last-activity time, assignment close time, and the grace-period constant. Sprint 9B is responsible for the concrete evaluation code path and its audit events.
- **Revision resolver.** A revision resolver must select the active internal revision at session creation and stamp the attempt at submission. Sprint 9B is responsible for the concrete resolver shape and the revision-creation trigger.
- **Teacher analytics.** The five-metric teacher surface (highest, first, latest, count, growth) becomes the initial teacher metric contract. Sprint 9B and downstream analytics work must not expose additional metrics on the teacher surface without a subsequent PDR.
- **Security Rules.** Client roles must be denied write access to the Attempt collection and to the answer key surface. Session-collection access must be scoped to the owning student and to the session-management callables. Sprint 9B is responsible for the concrete rules.

## 6. Remaining Architectural Questions

Sprint 9A closed the questions it was chartered to close. The following questions are open by design and are named here so that no future sprint mistakes them for gaps in the specification.

1. **Summative pipeline architecture.** End-of-unit summative assessments are out of scope for this specification. Their pipeline will be defined in a separate document when summative work is scheduled. The specification names "retake" as the summative-only term but does not define retake semantics.
2. **Assignment-level attempt cap.** The initial teacher UI does not offer an attempt cap on formative assignments. Whether a future teacher UI ever exposes one is deferred to a future PDR-018 amendment, not to sprint discretion.
3. **Concrete configurable operational constants.** The exact numeric value of the archived-session recovery window (and any subsequent tuning of the 24-hour session expiration and 1-hour grace period) is an operational concern for the operational readiness review. Constants are not teacher-configurable.
4. **Adjacent correction record shape.** The specification permits administrative correction to be expressed as an adjacent record. The concrete shape and audit contract for adjacent correction records is deferred to the sprint that introduces the correction capability, if any.
5. **Teacher suggestion workflow.** PDR-021g acknowledges that a future teacher suggestion workflow may be added. Its concrete shape is out of scope for Sprint 9A.
6. **Additional teacher-facing analytics.** Beyond the five initial metrics, additional analytics remain internal. Any future exposure requires a subsequent PDR.
7. **Attempt collection retention beyond class archival.** Attempts are retained for the lifetime of the class's historical record. Long-horizon retention policy for the analytics pipeline is a separate concern and is not defined here.
8. **LMS grade export shape.** LMS grade export reads attempts and produces the export format the target LMS requires. The concrete export contract is out of scope for Sprint 9A and will be defined by the LMS integration architecture at the phase that authorizes grade synchronization.

These open questions do not block Sprint 9B. Each is reachable as its own subsequent work item under the ordinary sprint discipline recorded in `LYFELABZ_ENGINEERING_STANDARDS.md`.

---

## Change Log

- 2026-07-12 - Initial Sprint 9A reconciliation report established. Ten certified documents modified. Two documents created (specification and this report).
