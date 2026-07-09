# LyfeLabz Cloud Function Charter

**Status:** Constitutional document
**Scope:** All trusted server-side logic within the LyfeLabz platform
**Companion to:** LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_PLATFORM_ARCHITECTURE.md

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
- `districtId`: reserved slot for the district expansion path in PDR-015. Not written by Version 1 functions.

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
Grade passback, roster import, and assignment linking with external learning management systems. These integrations exchange trust artifacts with third parties and must be entirely server-side.

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
