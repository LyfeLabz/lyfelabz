# LyfeLabz Cloud Function Charter

**Status:** Constitutional document
**Scope:** All trusted server-side logic within the LyfeLabz platform
**Companion to:** LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_PLATFORM_ARCHITECTURE.md, ASSESSMENT_PIPELINE_SPECIFICATION.md, IDENTITY_AND_ONBOARDING_SPECIFICATION.md

## Sprint 9C Reconciliation Notice

The identity portion of this charter is superseded by `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` and PDR-023. The three Sprint 9C callable surfaces (verification-code redemption, join-code redemption, first-sign-in activation) are enumerated in Appendix A under **Sprint 9C Identity Callables**. Where this charter and `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` conflict on identity behavior, the specification controls.

The charter's principles (server-authoritative, atomic, idempotent, single-purpose) survive intact. Terminology and scope are amended as follows.

- The canonical custom claims shape (`role`, `schoolId`, reserved `districtId`) is unchanged. Sprint 9C promotes `districtId` from a documented reserved slot to a claim that is written on every `active` identity, per PDR-023c.
- A **verification-code redemption callable** is added to the teacher onboarding surface. It validates the code server-side, transitions the identity from `pendingVerification` (or `provisioned` where applicable) to `active`, writes the canonical claims through the Sprint 2 §4.4 helper, and produces `teachers.verificationApproved`. The Sprint 2 admin approve/deny callables continue to serve the Request Teacher Access fallback path.
- A **join-code redemption callable** is added to the student enrollment surface. It validates the code, refuses redemption against an LMS-linked class per PDR-019i, and produces the enrollment record. Redemption is atomic and idempotent.
- A **first-sign-in activation callable** is the sole producer of the transition from a roster placeholder (`awaitingFirstSignIn`) to an active enrollment tied to a newly provisioned LyfeLabz Student ID. It is transactional. It never runs on the client.
- An **LMS roster refresh callable** remains the sole producer of roster changes on LMS-linked classes (`LMS_INTEGRATION_ARCHITECTURE.md`). No client role writes roster records directly.
- **District-scoping is enforced at every callable seam.** Callables refuse identity-affecting operations that cross district boundaries.

Where this document and `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` conflict, the specification controls.

---

## Sprint 9A Reconciliation Notice

The formative assessment portion of this charter is superseded by `ASSESSMENT_PIPELINE_SPECIFICATION.md` and PDR-021. The charter's principles (server-authoritative scoring, idempotency, single-purpose functions, out-of-band scaling) survive intact. Terminology and scope are amended as follows.

- Read every mention of "submission" as **attempt**. There is no separate Submission entity. The `submitted` state is transient inside the scoring transaction.
- The `submissionsCreate` and `submissionsFinalize` callables described in Section §12 are, going forward, understood as the scorer's write path for the Attempt entity. The `mode: "practice"` / `mode: "classroom"` field is retired; every recorded attempt is by definition an authenticated authorized attempt (see PDR-021e). Sprint 9B implementation is responsible for the concrete function renames and shape changes required by the specification.
- A distinct **Session** surface exists for autosave and resume of student working state. Session writes originate from the client through a server-mediated callable that validates enrollment and window state; sessions are not the attempt path and never write to the attempt collection. Session shape, expiration (24 hours), archival, and recovery follow specification Sections 6, 9, and 10.
- Scoring is server-authoritative. The client submits answers; the scorer computes the score against the server-confidential answer key; the scorer returns the score, correctness, and explanations. Section §11's "Immediate right/wrong feedback for practice questions is computed locally" continues to apply only to non-recording exploration surfaces; every authoritative attempt is scored server-side. No client-authoritative score field ever enters the attempt document under any name.
- Assignment windows are enforced at session creation and at attempt submission. Assignments closed at submission time are accepted only if the session was live at close and is within the one-hour grace period (specification §7.1).
- Assignments are per-class. Assigning one activity to multiple classes creates one assignment record per class through server-mediated fan-out. The publication callable enforces the per-class shape.
- Answer keys are held in a server-controlled surface readable only by the scorer. Answer keys never appear in any client-reachable artifact.
- Every attempt carries the **internal assessment revision identifier** at the moment of submission. The revision boundary is platform-owned (see PDR-021d).

Where this charter and the specification conflict, the specification controls.



This charter answers one question:

> When should logic run on the trusted server instead of the client?

Its objective is to minimize trusted server logic while ensuring platform integrity, security, and scalability. Every Cloud Function that exists, or will ever exist, within LyfeLabz should be justifiable under the principles below. A responsibility that cannot be justified here does not belong on the server.

---

## 1. Guiding Philosophy

Cloud Functions exist to enforce the boundary between what the platform trusts and what it merely observes. The client is a rendering surface. The server is the source of record.

The following principles govern every Cloud Function decision.

**The client is never authoritative.**
Anything the client submits is a request, not a fact. The server decides whether that request is legitimate, whether the requester is authorized, and what the resulting state should be.

**Cloud Functions enforce platform integrity.**
When a piece of state must remain consistent across users, roles, or sessions, that state is written by a Cloud Function or under the supervision of one. Integrity is not a client responsibility.

**Cloud Functions validate critical operations.**
Any operation that grants access, mutates shared state, produces a permanent record, or affects a student's academic history passes through server-side validation. Security Rules provide structural authorization; Cloud Functions provide semantic validation.

**Business rules live on the server when trust is required.**
If a rule can be broken by editing client code, that rule cannot live only on the client. Rules whose violation would compromise fairness, privacy, or auditability belong on the server.

**Minimize server complexity where possible.**
A Cloud Function is a permanent operational commitment. Every function must be maintained, monitored, versioned, and reasoned about during future changes. The best Cloud Function is the one that does not need to exist. When Security Rules alone are sufficient, prefer them.

**Prefer boring functions.**
Cloud Functions should be small, single-purpose, deterministic, and idempotent. Complex orchestration and long-running workflows belong outside the request path.

**Preserve the offline-friendly client.**
LyfeLabz lessons run in a classroom context where connectivity is uneven. Cloud Functions must never be placed in the critical path of lesson rendering, navigation, or Practice Mode.

### 1.a External Integrations

External integrations (learning management systems, student information systems, and other district-owned upstream systems) are governed by the guiding philosophy above and by the following additional constraints. These constraints are ratified into this charter by `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` and PDR-019.

**External integrations are a first-class case of "the client is never authoritative."** OAuth tokens, upstream API credentials, and upstream identifiers of authoritative external records are held server-side only. The client asks the server to act; the server decides whether the request is legitimate.

**External-integration tokens are never sent to the client.** No callable response, no Firestore document readable by any client role (including Platform Administrator without an audited elevation), and no downstream mirror record ever contains an OAuth access token or refresh token. Token storage, encryption posture, and rotation cadence are server responsibilities.

**External integrations are never in the critical path of lesson rendering, navigation, Practice Mode, or Classroom Mode finalization.** A lesson renders whether the LMS is reachable or not. A submission finalizes whether the LMS is reachable or not.

**External integrations are never in the critical path of Present Mode.** Present Mode remains a structurally separate surface with no Firebase SDK on the canonical instructional origin. No LMS token, OAuth flow, LMS bundle, or LMS-scoped payload reaches the canonical origin. This preserves PDR-018b, PDR-018c, and PDR-019l.

**Incremental authorization.** External-integration OAuth scopes are requested incrementally. The first scope requested is the minimum required for the teacher's immediate opt-in workflow. Additional scopes are requested only when the teacher initiates a workflow that requires them.

**Revocation is honored immediately.** If the upstream returns an authorization error, the server marks the connection revoked, marks affected mirror records stale, and surfaces a plain-language message to the teacher on next visit. No silent retries against a revoked token.

**Every consequential external-integration operation produces an `auditEvents` record** under the vocabulary reserved in `LYFELABZ_FIREBASE_SECURITY_MODEL.md` §11.7.a.

---

## 2. Responsibilities of Cloud Functions

The following responsibilities belong to the trusted server. This list is intentionally scoped to what LyfeLabz needs today, with room for the near-term expansion described in Section 8.

**Assessment finalization.**
When a student submits a Classroom Mode quiz, the server is responsible for recording the canonical result. The client sends answers; the server computes the score against the authoritative answer key, stamps the submission timestamp, associates the submission with the correct assignment record and roster, and writes the immutable result document. This prevents client-side score tampering and ensures every submission is reproducible.

**Terminology note.** LyfeLabz has two runtime modes: **Practice Mode** (client-only, no persistence) and **Classroom Mode** (server-finalized, persisted). The Assignment record's `mode` field takes exactly these two values (`practice`, `classroom`). The word "graded" is deliberately not used at any layer, per PDR-010; a `classroom`-mode Assignment record is not a "graded assignment," it is a Classroom Mode surface.

**Rollup updates.**
Class-level, assignment-level, and student-level rollups (aggregate scores, completion counts, mastery indicators) are computed server-side in response to submission events. Rollups must reflect the authoritative submission record, not client-reported summaries.

**Join code validation.**
When a student joins a class using a join code, the server validates the code, confirms it is active and not exhausted, resolves it to the correct class, and enrolls the student. The client never learns which classes exist, only whether its specific request succeeded.

**Teacher verification.**
Elevating an account to teacher status, binding a teacher to a school or district, and issuing the custom claims that Security Rules depend on are all server-only operations. Client code can request verification; only the server can grant it.

**Custom claims issuance.**
Any change to a user's `role`, `schoolId`, `districtId`, or equivalent claim is written exclusively by a Cloud Function. Claims are the foundation of authorization, and the client must never influence them directly.

*Canonical custom claims shape.* Every custom claims write in the platform uses exactly this shape:

- `role`: one of the values defined by PDR-004 and the Firestore Data Model. Present only when the user is `active`.
- `schoolId`: the school reference stamped on the user's document. Present only when the user is `active`.
- `districtId`: the district that owns the caller's school. Sprint 9C (PDR-023c) promoted this claim from a reserved slot to a claim written on every `active` identity. Present only when the user is `active`. The claim write contract, refresh behavior, and enforcement invariants are canonical in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` under PDR-025. Older Sprint 6 completion reports that describe this slot as unwritten are historical and are superseded by PDR-023c and PDR-025.

Claims are written only when the user's `status` (see `PLATFORM_STATE_MACHINE.md`) is `active`. A user in any other state, including `pendingVerification`, `provisioned`, `suspended`, or `archived`, carries no claims. The absence of claims is the canonical signal that the user has no active authorization and is distinct from the presence of claims with any particular values. Every custom claims write in the platform flows through the single canonical helper defined by the Engineering Standards (PDR-017); no second write path exists.

**Audit event creation.**
Security-relevant events (role changes, roster changes, assignment publication, teacher score annotations, data exports, deletions) are written to the Firestore `auditEvents` collection by the server as a side effect of the operation itself. That collection is the platform's authoritative append-only audit sink (Security Model 11; PDR-013). Clients cannot write to it, and no role, including Platform Administrator, may update or delete records in it.

**Assignment publication.**
Publishing an assignment to a class is a server-mediated action. The server validates that the teacher owns the class, the assignment references a real lesson, the roster snapshot is current, and the open/close window is coherent. Once published, the assignment record becomes the authoritative reference for all subsequent submissions and rollups.

**Data cleanup.**
Deletion of student, class, or teacher data (whether triggered by administrative action, account deletion, or retention policy) runs on the server so it can traverse every dependent document, revoke claims, and produce a deletion receipt.

**Scheduled maintenance.**
Periodic jobs (expiring stale join codes, closing Assignment record windows whose `windowClosesAt` has passed, pruning temporary artifacts, generating scheduled reports, exporting aged `auditEvents` to cold storage) run as scheduled functions. These jobs must be idempotent and safe to re-run. Closing a window is not "closing an overdue assignment"; it is transitioning an Assignment record's `status` from `published` to `closed`.

**Future notifications.**
When notifications ship (teacher summaries, parent updates, district reports), the composition and delivery of those messages will be server-side. Clients will never dispatch external communication on the platform's behalf.

**LMS OAuth initiation and completion.**
Reserved by the ratified LMS integration architecture (`LMS_INTEGRATION_ARCHITECTURE.md` §5, PDR-019e). When the LMS Integration Foundation phase is scheduled, the server initiates the OAuth flow with the provider on the teacher's behalf, completes the flow, and records the resulting connection in `lmsConnections`. The client asks; the server decides which scopes to request under the incremental-authorization rule.

**LMS token storage, refresh, and revocation handling.**
Server-only. Access tokens and refresh tokens are stored under a mechanism selected by the LMS Integration Foundation phase specification and never exposed to the client. Refresh is performed on demand, not speculatively. Revocation events are honored immediately and reflected in the mirror.

**LMS class discovery and roster read.**
The server reads the teacher's LMS class list and the roster of a class the teacher has opted to inspect. The client sees only the results the server chooses to write into the mirror. Cross-teacher and cross-school reads are impossible by construction.

**LMS class import, refresh, and unlink.**
The server owns the workflow that creates a LyfeLabz class record from an LMS class, refreshes a linked class on teacher demand, and unlinks a class while preserving the historical mirror for audit. Import validates that the requesting teacher is the LMS teacher of record. Refresh reconciles the LMS roster against the LyfeLabz enrollments under the certified vocabulary (`active`, `transferred`, `withdrawn`, `archived`) and never hard-deletes an enrollment record.

**LyfeLabz-to-LMS assignment publication.**
The server publishes a LyfeLabz assignment to a linked LMS class when the teacher explicitly opts in on the Assignment Dialog. Publication is one-way per PDR-019d. The LyfeLabz assignment is authoritative. Publication is a side effect and is recorded in `lmsAssignmentPublications`.

**LMS revocation and ownership-drift handling.**
The server marks connections revoked when upstream authorization fails, marks class links stale when the upstream teacher of record changes, and never silently reassigns LyfeLabz class ownership. The teacher sees a plain-language message and chooses a next step, including the audited administrative ownership transfer path recorded by PDR-005.

Each of these responsibilities belongs on the server for one of three reasons: the operation must be verifiable against authoritative data the client does not see; the operation issues or depends on trust artifacts the client cannot be permitted to forge; or the operation must produce a durable, tamper-resistant record.

---

## 3. Responsibilities That Must Remain on the Client

Some responsibilities do not belong on the server, and putting them there would degrade the platform.

**Lesson rendering.**
Lessons are static HTML. They must load and function without invoking a Cloud Function. Rendering is a client responsibility, always.

**Navigation.**
Movement between lessons, sections, and resources happens entirely in the browser. The server has no opinion about which page the student is viewing.

**Local UI state.**
Vocabulary card expansion, sticky navigation position, scroll offsets, transient form state, and other ephemeral interactions live in the DOM and browser memory.

**Practice Mode.**
Practice Mode is an ungraded, low-stakes formative experience. It must work with no account, no network round trip, and no server dependency. Practice Mode never invokes a Cloud Function.

**Accessibility preferences.**
Reduced motion, high contrast, font sizing, and similar preferences are read from the user agent and applied locally. They are not synced to the server.

**User interface interactions.**
Animations, transitions, hover and focus behavior, chevron affordances, tooltip visibility, and every other interaction concern belong to the client.

**Client-side answer feedback in Practice Mode.**
Immediate right/wrong feedback for practice questions is computed locally. Only Classroom Mode submissions require server-side scoring.

The rule of thumb: if the operation has no security, integrity, or permanence implication, it stays on the client. Adding a Cloud Function to something the client can already do correctly makes the platform slower, more expensive, and less resilient without improving trust.

---

## 4. Event Types

Cloud Functions are organized by how they are triggered. Every function in the platform belongs to exactly one of these categories.

**Authentication events.**
Triggered by user creation, deletion, or sign-in. Used to initialize account documents, assign initial claims, and record audit events for account lifecycle changes. These functions run once per lifecycle event and must be idempotent under retries.

**Firestore document events.**
Triggered by writes to specific document paths. Used for rollup maintenance, denormalization of authoritative state into read-optimized projections, and reaction to state transitions (a submission arriving, an assignment being published, a roster changing). These functions must tolerate out-of-order delivery and duplicate invocations.

**Scheduled events.**
Triggered by cron-like schedules. Used for maintenance, expiration, periodic reporting, and any recurring hygiene the platform requires. Scheduled functions must be safe to skip, safe to repeat, and observable enough that a missed run is detectable.

**Administrative events.**
Triggered by authorized administrative actions (teacher verification, role assignment, bulk roster operations, data exports, deletions). These functions require the strongest authorization checks in the platform and always emit audit records.

**Callable and HTTP endpoints.**
Triggered directly by client requests through the Firebase callable interface or, in narrowly justified cases, HTTPS. Used for operations where the client must initiate a transaction that the server then validates and executes (submitting a quiz, joining a class, requesting a join code). Callable functions are preferred over raw HTTP because they carry the authenticated user context automatically.

**Future HTTP endpoints.**
Reserved for eventual integrations (LMS synchronization, district reporting, webhook receivers). These will be introduced only when a specific integration requires them, and each will be governed by the same trust and audit requirements as the categories above.

A function that appears to need multiple triggers is almost always two functions.

---

## 5. Trust Boundaries

Cloud Functions reinforce the trust boundary between the client and the platform. Every server-mediated operation follows the same shape.

**Client request.**
The client sends a request expressing intent: "submit this quiz," "join this class," "publish this assignment." The client attaches its authenticated identity through the Firebase SDK. It does not attach role claims, ownership assertions, or precomputed results.

**Validation.**
The function inspects the request against authoritative server-side state. Does the referenced assignment exist? Is it currently open? Is the submitted quiz version the one that was published? Are the answer keys internally consistent? Validation is semantic; Security Rules have already handled structural checks.

**Authorization.**
The function confirms the requester is permitted to perform the operation. Role, class membership, school scope, and district scope are read from the authenticated custom claims, never from request payload fields. If authorization fails, the function returns a generic error and emits an audit event.

**Server-side action.**
The function performs the state change using its privileged credentials. Writes are transactional where correctness demands it, and idempotency keys are used where retries are possible. The client is not asked to help.

**Audit creation.**
Security-relevant operations write an audit record as part of the same transaction. Audit records name the actor, the operation, the affected resources, and the outcome. They are immutable once written.

**Response.**
The function returns only what the client needs to know: success or failure, and, where appropriate, the minimum result payload. It does not leak information about other users, other classes, or the internal structure of the platform.

The client never crosses the trust boundary. Every crossing is mediated by a function, and every function follows this shape.

---

## 6. Error Philosophy

Cloud Functions fail in predictable ways, and the platform must handle those failures without compromising integrity or user trust.

**Validation failures.**
When a request fails validation, the function returns a specific but non-revealing error. The client learns what it did wrong at a level of detail sufficient to correct the request, and no more. Validation failures are logged but do not page an operator.

**Retries.**
Firestore-triggered and scheduled functions may be delivered more than once. Every such function must be idempotent, either by design (the operation is naturally idempotent) or by construction (an idempotency key guards against duplicate effects). Callable functions that mutate state should also tolerate client-driven retries.

**Idempotency.**
Idempotency is a first-class design requirement, not an optimization. A submission arriving twice produces one recorded submission. An assignment publication arriving twice produces one published assignment. A rollup event fired twice produces the same rollup.

**Logging.**
Every function emits structured logs at defined severity levels. Successful operations log at info; validation failures log at warning; unexpected failures log at error. Logs include the operation name, the authenticated user id, the affected resource ids, and a correlation id sufficient to reconstruct the request. Logs never include quiz answers, personally identifying student data beyond what is operationally required, or credentials.

**User-friendly errors.**
The messages surfaced to students and teachers describe the situation in classroom terms, not stack terms. "This join code is no longer active" is correct. "PERMISSION_DENIED at /classes/{id}" is not. Client code translates function error codes into human-readable messages using the canonical LyfeLabz voice.

**Failure containment.**
A failure in a rollup function must never corrupt the underlying submission. A failure in an audit write must never silently succeed. The platform prefers a loud, contained failure over a quiet, ambiguous one.

---

## 7. Performance Expectations

Cloud Functions in LyfeLabz operate under classroom timing constraints. A teacher publishing an assignment or a student submitting a quiz should experience the platform as immediate.

**Execution time.**
Interactive callable functions target sub-second median execution and should complete well within a few seconds at the tail. Background functions have no interactive deadline but are expected to complete within seconds under normal load. Any function that consistently approaches minute-scale execution is a design problem, not a scaling problem.

**Reliability.**
Interactive functions target very high success rates measured against total invocations, excluding client-side validation failures. Background functions are expected to converge to success through retry and idempotency; a persistent failure is treated as an incident.

**Scalability.**
The platform must handle simultaneous submissions from every student in a class period, and, eventually, every class period in a school. Functions must be safe under fan-out, must not hold long-lived locks, and must not create hot-spot document paths.

**Observability.**
Every function is observable in three dimensions: invocation count, error rate, and latency distribution. Operators can answer "is this function healthy right now" without reading logs. Every audit-generating operation is queryable by user, resource, and time range.

**Cost awareness.**
Cloud Functions are billed per invocation and per second of execution. A design that fires a function for every keystroke is wrong. A design that fans out a background function to millions of documents in response to a single write is wrong. Cost is a design constraint, not an afterthought.

The platform is a classroom tool. It must feel immediate, behave reliably during peak class periods, and remain affordable at district scale.

---

## 8. Future Expansion

The charter anticipates growth. New categories of responsibility will be added under the same guiding principles.

**AI processing.**
Server-mediated calls to language models for open-response scoring, feedback generation, or teacher summaries. All model interactions run server-side so that API credentials, prompt templates, and safety controls remain trusted. Model outputs are validated before they are shown to students or written to authoritative records.

**LMS synchronization.**
Roster import and refresh, class discovery, class linking and unlinking, and one-way assignment publication to external learning management systems. These integrations exchange trust artifacts with third parties and are entirely server-side. Grade passback is deliberately not on the roadmap and would require its own decision record per PDR-019d. The canonical architecture is `LMS_INTEGRATION_ARCHITECTURE.md`. The responsibilities added by this charter for LMS integration are enumerated in §2. Rate-limit defaults consistent with PDR-012's rate-limit posture are:

- LMS discovery calls: bounded per teacher per minute.
- LMS import calls: bounded per teacher per hour.
- LMS refresh calls: bounded per class per hour.
- LMS publication calls: aligned with the existing assignment publication rate limit recorded in PDR-012 (60 per minute per teacher).

Concrete numbers are set by the LMS Integration Foundation phase specification.

**District reporting.**
Aggregate reports across schools, classes, and standards. Reports are computed from the authoritative rollups and delivered through scheduled or on-demand functions with district-scoped authorization.

**Email notifications.**
Transactional and summary email to teachers and administrators. Composition, rate limiting, and delivery all run on the server.

**Parent notifications.**
Progress summaries and account-related messages for parents and guardians. These carry the strongest privacy requirements in the platform and must be implemented with explicit consent tracking.

**Standards reporting.**
Mastery reporting aligned to Massachusetts 2016 STE Framework performance expectations, computed from the authoritative submission and rollup records.

Each new responsibility is admitted to the charter only when it satisfies the guiding philosophy: it requires trust the client cannot provide, it produces state the client must not author, or it interacts with an external system on behalf of the platform.

---

## 9. Anti-Patterns

The following patterns must not appear in LyfeLabz server-side code. Each represents a failure of the trust model, a maintenance liability, or a performance hazard.

**Business logic duplicated on client and server.**
When a rule is expressed in two places, it will drift. Rules that require trust live on the server, and the client defers to the server's result. Rules that do not require trust live on the client alone.

**Trusting client-submitted ownership.**
A request that says "I am the teacher of class X" is not evidence. Ownership is read from custom claims and confirmed against authoritative documents, never from request payload fields.

**Trusting client-submitted scores or completion state.**
The client may report what it observed, but the server decides what actually happened. Scores are computed on the server against the authoritative answer key.

**Long-running synchronous operations.**
Functions that block interactive callers for more than a few seconds are broken by design. Long work is decomposed into background functions coordinated through Firestore document state.

**Cloud Functions performing UI responsibilities.**
Rendering, formatting, and layout are client concerns. A function that returns HTML to be injected into the page, or that decides which vocabulary card is open, is a category error.

**Unbounded fan-out.**
A function that writes to every document in a collection in response to a single event will eventually take down the platform. Fan-out is chunked, rate-limited, and monitored.

**Silent failures.**
A function that swallows errors to appear successful hides real problems and corrupts trust. Failures are surfaced.

**Writing to the audit log from the client.**
The audit log is a server artifact. Any pathway that permits client-driven audit writes invalidates the log's evidentiary value.

**Weakening Security Rules to work around a function.**
Rules and functions are complementary. When a rule seems to block a legitimate operation, the answer is a function that performs the operation with privileged credentials, not a looser rule.

**One giant function.**
A single function that handles submissions, publications, and roster changes is not a function; it is a router masquerading as one. Functions are single-purpose.

**Hidden dependencies on client behavior.**
A function that only works because the client happens to send fields in a particular order, or happens to call two endpoints in a particular sequence, is fragile. Server correctness must not depend on client discipline.

---

## 10. Readiness Assessment

The question before the platform is:

> Would you approve this Cloud Function Charter as the permanent guide for all future server-side development?

**Assessment.** The charter is ready to be adopted as the constitutional document governing trusted server-side logic within LyfeLabz.

It establishes a coherent philosophy: the client is never authoritative, and Cloud Functions exist to enforce the boundary between what the platform trusts and what it merely observes. It enumerates the responsibilities that belong on the server, the responsibilities that must remain on the client, and the categories of events that trigger server work. It defines the shape of every server-mediated operation through the trust boundary section, the failure modes the platform must handle, the performance envelope classroom use demands, and the growth paths the platform anticipates. It names the anti-patterns that would compromise the model if they were tolerated.

It is aligned with LYFELABZ_FIREBASE_SECURITY_MODEL.md, which handles structural authorization at the Security Rules layer, leaving semantic validation and privileged state changes to the functions defined here. The two documents together form a complete account of trust in the platform.

**Standing recommendation.** Adopt the charter as written. Treat any deviation from it in future implementation work as a request to amend the charter, not a request to make an exception. Amendments require the same level of scrutiny as the original document, because every Cloud Function is a permanent operational commitment.

**Nothing outstanding requires clarification before adoption.** The companion documents identified in the readiness assessment (data model, audit specification, deployment and operations guide) remain separately scoped and do not block approval of this charter.

This document is now the authoritative reference for every Cloud Function that exists, or will ever exist, within LyfeLabz.

---

## Appendix A. Registered Cloud Functions

Every Cloud Function currently deployed by the platform is enumerated here. A function does not enter this list until it has shipped under a certified sprint. Each entry names the responsibility it discharges under §2, the trigger category it belongs to under §4, and the authorization gate it enforces at the trust boundary described in §5.

**authOnUserCreate** (Authentication events). Provisioning trigger for Firebase Authentication `user.create`. Writes the canonical `users/{uid}` provisioning record and emits a single `auth.userProvisioned` audit event. No custom claims are issued at this step. Sprint 2.

**studentsCompleteOnboarding** (Callable). Transitions the authenticated caller from `provisioned` to `active` under `role: "student"`. Issues canonical claims `{ role, schoolId }` and emits a single `students.activated` audit event. Idempotent under a matching already-`active` record. Sprint 2.

**teachersRequestVerification** (Callable). Transitions the authenticated caller from `provisioned` to `pendingVerification` under `role: "teacher"`. Does not issue custom claims. Emits a single `teachers.verificationRequested` audit event. Idempotent under a matching already-`pendingVerification` record. Sprint 2.

**teachersApproveVerification** (Administrative callable). Platform Administrator only. Transitions a target teacher from `pendingVerification` to `active`, issues canonical claims `{ role, schoolId }`, and emits a single `teachers.verificationApproved` audit event. Idempotent under an already-`active` target. Sprint 2.

**teachersDenyVerification** (Administrative callable). Platform Administrator only. Transitions a target teacher from `pendingVerification` back to `provisioned`, clears the activation-required fields via `FieldValue.delete()`, and emits a single `teachers.verificationDenied` audit event. Idempotent under an already-`provisioned` target. Sprint 2.

**schoolsCreate** (Administrative callable). Platform Administrator only. Creates a canonical `schools/{schoolId}` document under the Data Model §3.2 shape (`name`, `shortName`, `timezone`, `createdAt`; optional `district`, `gradeLevels`, `brandingRef`). Emits a single `schools.created` audit event. Idempotent under a client-supplied `schoolId`: an existing document whose canonical fields match the request returns `alreadyCreated: true` with no second write and no second audit event; an existing document whose canonical fields differ is rejected with `schools.conflict`. No new lifecycle field, no new custom claim, and no new Firestore collection is introduced. Sprint 4A.

**classesCreate** (Callable). Active teacher only (canonical `{ role: "teacher", schoolId }` custom claim required). Creates a canonical `classes/{classId}` document under the Data Model §3.3 shape (`teacherId`, `schoolId`, `title`, `grade`, `block`, `joinCode`, `status: "active"`, `createdAt`; optional `academicTerm`). Ownership fields are server-derived: `teacherId` is the caller's uid and `schoolId` is the caller's canonical claim; neither is client-supplied. `joinCode` is server-generated at initial creation and preserved on idempotent replay; the join-code lookup, rotation, and enrollment flows are out of scope for Sprint 4B and are not implemented. Emits a single `classes.created` audit event. Idempotent under a client-supplied `classId`: an existing document owned by the caller under the same school with matching canonical metadata returns `alreadyCreated: true` with no second write and no second audit event; every other conflict is rejected with `classes.conflict`. No new lifecycle enumeration is introduced beyond the Data Model §3.3 `active`/`archived` pair. Sprint 4B.

**classesUpdateMetadata** (Callable). Owning teacher only. Applies a narrow update to `classes/{classId}` limited to the teacher-editable metadata fields (`title`, `grade`, `block`, `academicTerm`). Ownership fields, `joinCode`, `status`, and `createdAt` are never writable through this path. Rejects a cross-teacher or cross-school update with `classes.forbidden` and rejects an update against a non-`active` class with `classes.invalidStatus`. Emits a single `classes.metadataUpdated` audit event whose payload names the `changedFields`. Idempotent: if every submitted field already matches the stored value, no write and no audit event are emitted and `alreadyUpdated: true` is returned. Sprint 4B.

**classesArchive** (Callable). Owning teacher only. Advances the lifecycle field on `classes/{classId}` from `active` to `archived` and modifies no other field. Rejects a cross-teacher or cross-school archive with `classes.forbidden`. Emits a single `classes.archived` audit event. Idempotent under an already-`archived` target: no second write and no second audit event are emitted and `alreadyArchived: true` is returned. Sprint 4B.

**enrollmentsJoinByCode** (Callable). Active student only (canonical `{ role: "student", schoolId }` custom claim required). Resolves an active class from the request `joinCode` scoped to the caller's `schoolId`, then creates a canonical `enrollments/{enrollmentId}` document under the Data Model §3.4 shape (`studentId`, `classId`, `schoolId`, `status: "active"`, `enrolledAt`; optional `displayNameOverride`). Ownership fields are server-derived: `studentId` is the caller's uid and `classId`/`schoolId` are read from the resolved class record; none are client-supplied. Enrollment document IDs are the deterministic composite `{classId}__{studentId}` so uniqueness is enforced at the write boundary without a hot document or a transactional query. Emits a single `enrollments.created` audit event whose payload names `{ classId, source: "joinByCode" }`. Idempotent: an existing active enrollment for this (student, class) pair returns `alreadyEnrolled: true` with no second write and no second audit event; a prior enrollment in a terminal status is rejected with `enrollments.conflict`. Unknown or archived-class join codes are rejected with the neutral `enrollments.joinCodeNotFound`. No new lifecycle field, no new custom claim, and no new Firestore collection is introduced beyond the canonical `enrollments` collection. Sprint 4C.

**enrollmentsTeacherAdd** (Callable). Owning teacher only. Creates a canonical `enrollments/{enrollmentId}` document for the (`classId`, `studentId`) pair under the Data Model §3.4 shape. Ownership is enforced by comparing the record's `teacherId` and `schoolId` to the authenticated caller and the caller's canonical claim; cross-teacher or cross-school attempts are rejected with `enrollments.forbidden`. The target student must exist in the same school and be `active`; otherwise the request is rejected with `enrollments.studentNotFound`, `enrollments.invalidTargetRole`, `enrollments.forbidden`, or `enrollments.invalidTargetStatus`. Emits a single `enrollments.created` audit event whose payload names `{ classId, studentId, source: "teacherAdd" }`. Idempotent under an already-active enrollment; terminal-status conflicts are rejected with `enrollments.conflict`. Sprint 4C.

**enrollmentsSetStatus** (Callable). Owning teacher only. Advances the `status` field on `enrollments/{enrollmentId}` under the Data Model §3.4 lifecycle table: `active` may transition to `transferred`, `withdrawn`, or `archived`; `transferred` and `withdrawn` may only advance to the terminal `archived`; `archived` is terminal. `exitedAt` is stamped by the server when a live enrollment first exits (`active` -> `transferred`, `active` -> `withdrawn`, `active` -> `archived`) and is not re-stamped on `transferred`/`withdrawn` -> `archived`. Ownership is enforced against both the enrollment and its parent class record. Rejects a cross-teacher or cross-school change with `enrollments.forbidden` and rejects a disallowed transition with `enrollments.invalidTransition`. Emits a single `enrollments.statusChanged` audit event whose payload names `{ classId, studentId, previousStatus, status }`. Idempotent under a matching current status: no second write and no second audit event are emitted and `alreadyInStatus: true` is returned. Sprint 4C.

**assignmentsCreateDraft** (Callable). Active teacher only (canonical `{ role: "teacher", schoolId }` custom claim required). Creates a canonical `assignments/{assignmentId}` document in the `draft` state under the Data Model §3.6 shape (`classId`, `teacherId`, `schoolId`, `lessonSlug`, `lessonVersion`, `mode`, `status: "draft"`, `createdAt`; optional `title`, `instructions`, `windowClosesAt`, `availableAt`). Ownership fields are server-derived: `teacherId` is the caller's uid and `schoolId` is denormalized from the referenced class record; neither is client-supplied. `lessonSlug` and `lessonVersion` are frozen at creation per §12.4. The class must be owned by the caller under their canonical claim and must be `active`; cross-teacher or cross-school targets are rejected with `assignments.forbidden`, and a non-active class is rejected with `assignments.invalidClassStatus`. Emits a single `assignments.created` audit event whose payload names `{ classId, lessonSlug, lessonVersion, mode }`. Idempotent under a client-supplied `assignmentId`: an existing document owned by the caller under the same school and class with matching canonical fields and still in `draft` returns `alreadyCreated: true` with no second write and no second audit event; every other conflict is rejected with `assignments.conflict`. No new lifecycle enumeration is introduced beyond the Data Model §3.6 `draft`/`published`/`closed`/`archived` set. Sprint 4D.

**assignmentsUpdateDraft** (Callable). Owning teacher only. Applies a narrow update to `assignments/{assignmentId}` limited to the teacher-editable metadata fields (`title`, `instructions`, `lessonSlug`, `lessonVersion`, `mode`, `windowClosesAt`, `availableAt`). Ownership fields, `status`, and `createdAt` are never writable through this path. Rejects a cross-teacher or cross-school update with `assignments.forbidden` and rejects an update against a non-`draft` record with `assignments.invalidStatus`. Emits a single `assignments.updated` audit event whose payload names the `changedFields`. Idempotent: if every submitted field already matches the stored value, no write and no audit event are emitted and `alreadyUpdated: true` is returned. Sprint 4D.

**assignmentsPublish** (Callable). Owning teacher only. Advances the lifecycle field on `assignments/{assignmentId}` from `draft` to `published` and modifies no other field. Rejects a cross-teacher or cross-school publish with `assignments.forbidden`, and rejects a publish from any status other than `draft` with `assignments.invalidTransition`. Emits a single `assignments.published` audit event whose payload names `{ classId, lessonSlug, lessonVersion }`. Idempotent under an already-`published` target: no second write and no second audit event are emitted and `alreadyPublished: true` is returned. Sprint 4D.

**assignmentsClose** (Callable). Owning teacher only. Advances the lifecycle field on `assignments/{assignmentId}` from `published` to `closed` and modifies no other field. Rejects a cross-teacher or cross-school close with `assignments.forbidden`, and rejects a close from any status other than `published` with `assignments.invalidTransition`. Emits a single `assignments.closed` audit event whose payload names `{ classId }`. Idempotent under an already-`closed` target: no second write and no second audit event are emitted and `alreadyClosed: true` is returned. Sprint 4D.

**assignmentsArchive** (Callable). Owning teacher only. Advances the lifecycle field on `assignments/{assignmentId}` to the terminal `archived` state from any of `draft`, `published`, or `closed`, and modifies no other field. Rejects a cross-teacher or cross-school archive with `assignments.forbidden`. Emits a single `assignments.archived` audit event whose payload names `{ classId, previousStatus }`. Idempotent under an already-`archived` target: no second write and no second audit event are emitted and `alreadyArchived: true` is returned. Sprint 4D.

**submissionsCreate** (Callable). Active student only (canonical `{ role: "student", schoolId }` custom claim required). Creates a canonical `submissions/{submissionId}` document in the transient `submitted` state under the Data Model §3.7 shape (`assignmentId`, `studentId`, `classId`, `teacherId`, `schoolId`, `lessonSlug`, `lessonVersion`, `mode`, `status: "submitted"`, `startedAt`, `responses`). Ownership fields are server-derived: `studentId` is the caller's uid; `classId`, `teacherId`, `schoolId`, `lessonSlug`, `lessonVersion`, and `mode` are denormalized from the referenced assignment record per §12.3; none are client-supplied. The referenced assignment must be owned by the caller's school, must be in `classroom` mode, and must be in `status: "published"`; a `practice`-mode target is rejected with `submissions.invalidAssignmentMode`, a non-published target is rejected with `submissions.invalidAssignmentStatus`, and a cross-school target is rejected with `submissions.forbidden`. The caller must hold an `active` enrollment for `(assignment.classId, studentId)`; otherwise the request is rejected with `submissions.notEnrolled`. Submission document IDs are the deterministic composite `{assignmentId}__{studentId}` so uniqueness of the current attempt is enforced at the write boundary without a hot document or a transactional query per §5.6. Emits a single `submissions.created` audit event whose payload names `{ assignmentId, classId, lessonSlug, lessonVersion }`. Idempotent: an existing submission for this (assignment, student) pair still in `submitted` with matching canonical fields returns `alreadyCreated: true` with no second write and no second audit event; every other conflict (finalized document, mismatched canonical fields) is rejected with `submissions.conflict`. No new lifecycle enumeration is introduced beyond the Data Model §3.7 `submitted`/`finalized` pair. Sprint 5A.

**submissionsFinalize** (Callable). Owning student only. Advances the lifecycle field on `submissions/{submissionId}` from `submitted` to `finalized`, stamps `submittedAt` server-side, and preserves the frozen ownership fields untouched. Rejects a cross-student or cross-school target with `submissions.forbidden`, a missing document with `submissions.notFound`, and any transition from a status other than `submitted` with `submissions.invalidTransition`. Re-verifies that the caller still holds an `active` enrollment for the persisted `classId`; otherwise the request is rejected with `submissions.notEnrolled`. Optional analytics fields (`responses`, `score`, `durationMs`, `attemptCount`) may be supplied by the finalizer and are validated at the write boundary. Emits a single `submissions.finalized` audit event whose payload names `{ assignmentId, classId, lessonSlug, lessonVersion }`. Idempotent under an already-`finalized` target owned by the caller: no second write and no second audit event are emitted and `alreadyFinalized: true` is returned. Sprint 5A.

### Sprint 9C Identity Callables

The following callable surfaces are ratified by `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §§12, 13, 16 and PDR-023. They are named here as the canonical registered surfaces. Concrete function names, argument shapes, and error codes are finalized by the first implementation sprint that introduces them; the load-bearing responsibilities, authorization boundaries, atomicity, idempotency, and audit vocabulary below are canonical and not subject to sprint discretion.

**teachersRedeemVerificationCode** (Callable). Authenticated caller in `provisioned` or `pendingVerification` under `role: "teacher"`. Server-validates a single-use, revocable, institution-bound verification code (`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §13.1) against the district and school the code was issued to; refuses a redemption whose caller domain, district, or school does not match the code's binding. On success, transitions the identity from its current state to `active`, writes canonical claims `{ role: "teacher", schoolId, districtId }` through the Sprint 2 §4.4 helper (with `districtId` now written on every active identity per PDR-023c), and emits a single `teachers.verificationApproved` audit event. Retires the redeemed code so it cannot be replayed. Idempotent under an already-`active` caller whose `schoolId` and `districtId` match the code's binding: no second write, no second audit event, and the same success is returned. Atomic: identity transition, claims write, and code retirement occur under a single transaction; a failure at any step leaves no partial state. The Sprint 2 `teachersApproveVerification` / `teachersDenyVerification` administrative callables continue to serve the Request Teacher Access fallback (`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §13.2) and are unchanged. Sprint 9C ratified.

**enrollmentsRedeemJoinCode** (Callable). Active student only (`role: "student"`, `schoolId`, `districtId`). Server-validates a join code minted for a manual class (`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §12): confirms the code is active and not revoked, resolves it to exactly one class, and refuses redemption against an LMS-linked class with `enrollments.linkedClassNotJoinable` per PDR-019i. Verifies that the resolved class lives inside the caller's district; cross-district redemption is refused. Creates or reconciles a canonical `enrollments/{enrollmentId}` document for `(classId, studentId)` under the Data Model §3.4 shape, using the deterministic composite `{classId}__{studentId}` document ID so uniqueness is enforced at the write boundary. Emits a single `enrollments.created` audit event whose payload names `{ classId, source: "joinByCode" }`. Idempotent: an existing active enrollment for the (student, class) pair returns `alreadyEnrolled: true` with no second write and no second audit event; a prior enrollment in a terminal status is rejected with `enrollments.conflict`. Atomic: code validation, class resolution, enrollment write, and audit event occur under a single transaction. Sprint 9C ratified.

**enrollmentsActivateOnFirstSignIn** (Callable). Authenticated student caller whose Google sign-in matches, per the specification's identity-matching rule (`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §17), an existing roster placeholder in the `awaitingFirstSignIn` state on an LMS-linked or manually-populated class. Never runs on the client. Matches by Google Classroom User ID as the primary key with email as the secondary validator; refuses to resolve identity by student choice. On successful match, provisions the LyfeLabz Student ID (or reuses the caller's already-provisioned identity), links the identity to the roster placeholder, and transitions the roster entry from `awaitingFirstSignIn` to `active` under the class's roster authority. Never creates a duplicate LyfeLabz Student ID for a student who signs in twice; repeated invocations by the same principal are a benign no-op. Enforces the district boundary: activation against a roster placeholder in a different district is refused. Emits the audit events reserved for first-sign-in activation under the Sprint 9C audit vocabulary. Atomic: identity resolution, placeholder linkage, and roster-state transition occur under a single transaction. Ambiguous matches are held for administrative resolution rather than resolved by student choice, per §17. Sprint 9C ratified.
