# Google Classroom Deep-Link Implementation Contract

**Status:** Canonical implementation contract. Ratified under Sprint 10A step F-3.
**Date:** 2026-07-12
**Anchor decision:** PDR-027 in `LYFELABZ_PLATFORM_DECISIONS.md`.
**Implements:** PDR-019 (LMS Integration Posture), PDR-020 (LMS Phase Re-Sequencing and Initial Scope), PDR-024f, PDR-024g, PDR-024h (Google Classroom integration philosophy).
**Reconciles:** `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`, `LMS_INTEGRATION_OPERATIONS.md`, `LMS_EXPERIENCE.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `ASSIGN_EXPERIENCE.md`, `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`.
**Governs:** Server-side implementation of Google Classroom deep-link resolution, assignment resolution, URL contracts, multiple-class publication behavior, multiple-teacher publication behavior, Classroom synchronization ownership, and the security boundaries around every Classroom-bound URL LyfeLabz emits or resolves.

This document is an engineer-facing implementation contract. It does not redesign product behavior, introduce new LMS features, expand Google Classroom integration beyond the approved architecture, or amend the certified LMS integration philosophy. It translates the certified architecture into one normative rule set that a future implementation sprint MUST follow.

Where this contract and any earlier document conflict on implementation detail, this contract prevails. Where this contract and `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_EXPERIENCE.md`, or `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` conflict on product behavior, the certified product documents prevail and this contract MUST be reconciled.

---

## 1. Purpose

The LyfeLabz certified corpus ratified an LMS integration posture (PDR-019, PDR-020) and a Google Classroom integration philosophy for the pilot (PDR-024f, PDR-024g, PDR-024h). That posture is authoritative for what the integration is and is not. The rules that follow from it, however, are distributed across `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`, `LMS_INTEGRATION_OPERATIONS.md`, `LMS_EXPERIENCE.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `ASSIGN_EXPERIENCE.md`, and `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`. Sprint 10A F-3 collapses those statements into one implementation contract so engineers do not have to reconstruct the deep-link, publication, and resolution model from many partial statements.

This document is the single source of truth for:

- how a LyfeLabz assignment resolves to a Google Classroom coursework record
- how a Google Classroom coursework record resolves back to a LyfeLabz assignment
- the exact URL shape LyfeLabz publishes into Google Classroom and how it is verified
- how a student arriving from Google Classroom lands in the correct authorized attempt context
- how publication behaves when a LyfeLabz assignment fans out to more than one Classroom class
- how publication behaves when a Classroom class has more than one co-teacher
- what synchronization operations LyfeLabz performs against Google Classroom and what it never performs
- which Cloud Function owns each deep-link, publication, and resolution operation
- which Firestore collections own which pieces of Classroom-link state
- what security boundaries every URL, callable, and mirror record MUST enforce
- what remains explicitly deferred to a later implementation sprint

## 2. Scope

This contract governs:

- The construction, publication, verification, and resolution of the deep-link URL LyfeLabz emits into a Google Classroom coursework record.
- The bidirectional resolution between `assignments/{assignmentId}` and `lmsAssignmentPublications/{publicationId}` documents.
- The one-way publication lifecycle from a LyfeLabz assignment to zero, one, or more Google Classroom coursework records.
- The behavior of the publication callable when a teacher targets more than one linked class in a single Assignment Dialog gesture.
- The behavior of the publication callable when a Classroom class carries more than one co-teacher.
- The behavior of the resolution callable when a student arrives on a LyfeLabz deep-link URL emitted by Classroom.
- Cloud Function ownership for every Classroom-facing operation.
- Firestore collection ownership for `lmsAssignmentPublications`, `lmsClassLinks`, and the additive `lmsPublicationRef` field on `assignments/{assignmentId}`.
- Firestore Security Rules invariants for the collections above.
- Composite index requirements for the queries the deep-link and publication paths issue.
- Audit event vocabulary for the deep-link and publication lifecycle.
- The error contract for publication and resolution callables.

It does not govern:

- The educational philosophy of the LMS integration, which remains owned by `LMS_INTEGRATION_ARCHITECTURE.md` and `LMS_EXPERIENCE.md`.
- The OAuth connection lifecycle, discovery lifecycle, or class import lifecycle, which remain owned by `LMS_INTEGRATION_ARCHITECTURE.md` §5 through §7, `LMS_EXPERIENCE.md` §3 and §4, and `LMS_INTEGRATION_OPERATIONS.md`. This contract touches those flows only where they are load-bearing for a publication or a resolution.
- The pilot Assignment Dialog visual design, which remains owned by `ASSIGN_EXPERIENCE.md`.
- District-boundary enforcement, which remains owned by `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`. Every callable named here also complies with that contract; the district rules are not restated in full below.
- The assessment session and attempt pipeline, which remains owned by `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`. This contract records only how a Classroom-arriving student reaches the correct authorized attempt context defined there.
- The refresh, roster synchronization, and unlink workflows, which remain future capabilities under `LMS_INTEGRATION_ARCHITECTURE.md` §7 and `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` §8. This contract records their interaction with a published deep-link only.
- The second-provider adapter surface (Canvas, Schoology, Microsoft Teams for Education), which remains reserved by `LMS_INTEGRATION_ARCHITECTURE.md` §4.2. Provider neutrality is preserved by naming Google-specific choices as such; a second adapter satisfies this contract's shape without rewriting it.

## 3. Authority and Precedence

This contract implements the following canonical documents:

- `LMS_INTEGRATION_ARCHITECTURE.md` (LMS architecture; ratified under PDR-019 and PDR-020).
- `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` (Amendment set; ratified under PDR-019 and PDR-020).
- `LMS_INTEGRATION_OPERATIONS.md` (Operational runbook).
- `LMS_EXPERIENCE.md` (Product specification; Sprint 9D Reconciliation Notice controls).
- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-005, PDR-010, PDR-011, PDR-012, PDR-013, PDR-017, PDR-018, PDR-019, PDR-020, PDR-023, PDR-024, PDR-025, PDR-026, PDR-027).
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (callable authority boundaries).
- `LYFELABZ_FIRESTORE_DATA_MODEL.md` (canonical document shapes including `lmsClassLinks`, `lmsAssignmentPublications`, and the additive `lmsPublicationRef` field).
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md` (rule-layer enforcement).
- `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md` (index strategy).
- `ASSIGN_EXPERIENCE.md` (assign workflow that hosts the publication gesture).
- `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` (activation-versus-publication separation, deep-link behavior).
- `PLATFORM_OPERATIONS_SPECIFICATION.md` (canonical origin and `/app/**` routing).
- `PLATFORM_CONTRACTS.md` (workspace-surface identifier convention, client storage prohibitions).
- `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` (district enforcement).
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (session and attempt ownership consumed by the deep-link resolver).
- `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` (identity and roster authority).

Precedence rules:

1. Where this contract and `LMS_INTEGRATION_ARCHITECTURE.md` or `LMS_EXPERIENCE.md` conflict on product behavior or on the LMS trust boundary, the architecture and experience documents prevail and this contract MUST be reconciled.
2. Where this contract and any older implementation document (charter, data model, security model, index strategy, operations runbook) conflict on Google Classroom deep-link, publication, or resolution implementation, this contract prevails and the older document MUST be reconciled with a narrow Sprint 10A F-3 notice.
3. Where this contract intersects with `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`, both apply. District enforcement is additive to the rules below; nothing in this contract widens or narrows the district boundary.
4. Where this contract intersects with `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`, both apply. Classroom is never the source of truth for an authorized attempt context; the deep-link resolver never creates, mutates, or replaces a session or an attempt.
5. Where existing implementation code diverges from this contract, the code MUST be reconciled during the sprint that lands the publication or resolution paths. This contract never treats older implementation code as authoritative.

## 4. Terminology

- **LyfeLabz assignment.** The authoritative `assignments/{assignmentId}` record under `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.6. One assignment per class per activity per `ASSESSMENT_PIPELINE_SPECIFICATION.md` §12.1. Owns activation, window, and mode.
- **Classroom coursework record.** A Google Classroom `Course.CourseWork` resource created by publication. Owned upstream by Google Classroom. Never authoritative for LyfeLabz behavior.
- **Publication.** A server-mediated write from a LyfeLabz assignment to a Classroom coursework record. One-way under PDR-019d. Recorded in `lmsAssignmentPublications`.
- **Deep-link URL.** The stable LyfeLabz URL LyfeLabz embeds as a link material in the Classroom coursework record. Format defined in §8.
- **Deep-link resolver.** The server path that resolves a deep-link URL request into an authorized LyfeLabz assignment context for the arriving student. Defined in §10.
- **Publication ordinal.** The one-based, monotonic count of publication attempts LyfeLabz has made for a `(lyfelabzAssignmentId, lmsClassId)` pair. Used to construct the deterministic `lmsAssignmentPublications/{publicationId}` identifier.
- **External assignment identifier.** The Google Classroom coursework identifier (`{courseId}`, `{courseWorkId}`) recorded on a successful publication. LyfeLabz stores it for reconciliation; it never treats it as an authorization key.
- **Canonical LyfeLabz identifier.** The stable LyfeLabz `assignmentId`. The load-bearing key for authorization, session begin, and audit.
- **Fan-out publication.** A single teacher publication gesture that targets more than one LMS-linked class. Fan-out produces one LyfeLabz assignment record per class per `ASSESSMENT_PIPELINE_SPECIFICATION.md` §12.1 and one publication attempt per (LyfeLabz assignment, target class).
- **Co-teacher.** Any Google Classroom user carrying a teacher role on the Classroom course. The teacher of record inside LyfeLabz is the LyfeLabz class owner, per `LMS_EXPERIENCE.md` §7 and PDR-005.
- **Silent arrival.** The pilot obligation from PDR-024h that a student arriving from Google Classroom is placed in the correct authorized attempt context without selecting a class or an assignment.
- **Broken link.** The state of a `lmsClassLinks/{linkId}` document whose upstream Classroom course has been deleted upstream. See `LMS_EXPERIENCE.md` §8.
- **Ownership drift.** The state in which the LyfeLabz class owner is no longer the Classroom teacher of record. See `LMS_EXPERIENCE.md` §7 and PDR-019j.
- **Idempotency marker.** A client-supplied stable string that identifies a single logical publication intent. The publication callable deduplicates on this marker; retries are safe.
- **Claim-refresh signal.** The response flag a callable returns when it has invalidated the caller's cached authorization state. No callable in this contract writes a custom claim; the signal is not raised by this pipeline.

## 5. External Provider Model

Google Classroom is the initial and only supported external provider under PDR-020a. The provider abstraction is preserved for future adapters under PDR-019h.

- The closed provider set is enumerated in `lmsProviders`. Version 1 contains exactly `googleClassroom`. Additional providers require an amendment per `LMS_INTEGRATION_ARCHITECTURE.md` §4.
- Every publication, resolution, mirror record, and audit event named in this contract is tagged with a provider identifier at write time. Provider-scoped queries MUST filter by provider identifier so a second adapter does not force a schema change.
- Provider-specific field names appear only inside `lmsAssignmentPublications` (for example, `providerCourseId`, `providerCourseWorkId`) and inside the Google Classroom adapter. The generic ownership, timing, and status fields defined below are provider-neutral.
- A second provider MUST NOT reuse a Google Classroom provider identifier. A second provider MUST NOT reuse a Google Classroom mirror record. A Google Classroom mirror record MUST NOT be repointed to a second provider by mutation; unlinking and re-linking is the only supported transition.

## 6. Canonical Assignment Identity

Identity of a LyfeLabz assignment is unaffected by publication. Every rule in `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.6, `ASSESSMENT_PIPELINE_SPECIFICATION.md`, and `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` remains authoritative.

- The `assignments/{assignmentId}` document is the single load-bearing identity for authorization, activation, and every attempt-bearing operation.
- The `assignmentId` is a server-generated stable identifier consistent with `LYFELABZ_FIRESTORE_DATA_MODEL.md` §5 conventions.
- Fan-out publication produces one `assignments/{assignmentId}` per (class, activity). It never produces a shared assignment across classes; it never renames an existing assignment.
- Publication MAY populate the optional `lmsPublicationRef` field on `assignments/{assignmentId}` to reference the most recent `lmsAssignmentPublications/{publicationId}` mirror document (see `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.6 and PDR-019d). Absence of `lmsPublicationRef` is the default and MUST NOT block any assessment operation.
- No field on `assignments/{assignmentId}` other than `lmsPublicationRef` is written by any callable in this contract. Activation, window, mode, and instructions remain owned by the Assign Experience.

## 7. External Assignment Identity

Every publication attempt records the external assignment identifier on the `lmsAssignmentPublications/{publicationId}` document. LyfeLabz never treats the external identifier as authoritative for authorization.

Recorded external fields on a successful publication:

- `provider` (equals `googleClassroom` in Version 1).
- `providerCourseId` (the Google Classroom `Course.id`).
- `providerCourseWorkId` (the Google Classroom `CourseWork.id`).
- `providerCourseWorkAlternateLink` (the human-readable Classroom URL Google returns for the coursework record; recorded for teacher-facing display in operational tooling only).
- `providerTopicId` (optional; recorded only if the teacher selected a topic in the Assignment Dialog).

Invariants:

- The external identifier tuple `(provider, providerCourseId, providerCourseWorkId)` MUST be unique across `lmsAssignmentPublications` for the successful, unrevoked publications LyfeLabz owns. A retried publication that succeeds against the same coursework record MUST reuse the same publication document via idempotency (see §11) rather than write a second.
- The external identifier is not readable by any student surface. Students never see a Classroom coursework identifier inside LyfeLabz.
- The external identifier MAY be read by the owning teacher via an audited operational surface. It MUST NOT be projected into any teacher-facing analytics view (see `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §20 for the analytics boundary this contract inherits).
- LyfeLabz MUST NOT compute an authorization decision from `providerCourseWorkAlternateLink`. That URL is stored for operational display; it is not a trusted path.

## 8. Deep-Link URL Contract

LyfeLabz publishes exactly one deep-link URL per publication. The URL is the load-bearing artifact of the "Integrate Rather Than Duplicate" posture (`LMS_EXPERIENCE.md` §1, PDR-024h).

### 8.1 URL Shape

The deep-link URL MUST have the following shape under the canonical origin (`PLATFORM_OPERATIONS_SPECIFICATION.md` §7):

```
https://lyfelabz.com/app/a/{assignmentId}
```

- The scheme MUST be `https`. No `http` variant is emitted.
- The host MUST be `lyfelabz.com`. No preview or staging origin is embedded in a Classroom coursework record under any circumstance. The preview environment is exercised through the Emulator Suite and never publishes to a production Classroom class (`PLATFORM_OPERATIONS_SPECIFICATION.md` and `LMS_INTEGRATION_OPERATIONS.md`).
- The path prefix MUST be `/app/a/`. The `a` segment is the workspace-surface routing hint for "assignment arrival"; it is scoped to `/app/**` per `PLATFORM_OPERATIONS_SPECIFICATION.md` and stable across releases.
- The trailing segment MUST be the canonical LyfeLabz `assignmentId`. No secondary identifier, no student identifier, no class identifier, and no token appears in the path.
- The URL MUST NOT carry personal, session, or scoring data in query parameters or fragments. See §9.

### 8.2 Prohibited URL Content

The deep-link URL MUST NOT contain:

- a student identifier,
- a teacher identifier,
- a school or district identifier,
- an authorization token,
- an OAuth code,
- an answer key excerpt,
- a score, item-level correctness marker, or feedback payload,
- a Classroom coursework identifier,
- a session identifier,
- a claim payload,
- any Personally Identifying Information beyond the opaque `assignmentId`,
- a rendered lesson URL. The deep-link resolves to a lesson on the server side; it never encodes the lesson slug in the URL.

Any URL emitted by publication that violates §8.1 or §8.2 MUST be refused by the publication callable and MUST NOT be sent to Classroom.

### 8.3 URL Emission

- The URL is constructed by the publication callable, not by the client. The client never sees an unsigned draft of the deep-link URL before it is written.
- The URL is embedded in the Classroom coursework record's link material only. LyfeLabz MUST NOT populate description text, title text, attachments, or grading fields with a duplicate URL or with any additional URL beyond the single canonical deep-link.
- The coursework title, description, and points MUST be derived from the LyfeLabz assignment record (title default per `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.6, description empty by default). The publication callable MUST NOT ask the client for these values.

### 8.4 URL Verification

- The deep-link URL MUST be verifiable by the resolver as belonging to the canonical origin. The resolver MUST refuse any request whose `assignmentId` segment fails the identifier shape check (character class, length bounds, non-empty).
- The resolver MUST NOT trust the `Referer` header of an arriving request as an authorization signal. Referer MAY be recorded on the audit event for observability but MUST NOT gate access.
- The resolver MUST NOT trust any query parameter or fragment as an authorization signal. If any query parameter is present, the resolver MUST strip it before dispatching to the internal navigation target.

## 9. Client Storage and Session Handling for Deep-Link Arrivals

- The deep-link URL MUST NOT be persisted by the client to `localStorage`, `sessionStorage`, or a cookie beyond the ordinary browser history record.
- The `/app/**` bootstrap under `PLATFORM_OPERATIONS_SPECIFICATION.md` handles authentication for the arriving student per `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §11 and §16. This contract does not amend that bootstrap.
- If the arriving student is unauthenticated, the bootstrap resolves identity before the deep-link resolver runs. Silent arrival (PDR-024h) implies no additional class or assignment selection; it does not imply skipping identity establishment.
- The client MUST NOT expose the `assignmentId` in a shareable URL suitable for another student's arrival. `assignmentId` is not a secret, but the resolver rejects a request from a caller who is not enrolled in the assignment's class; the URL is safe to route through browser history but does not confer authorization on its own.

## 10. Link Resolution Lifecycle

The resolver is the sole authorized path from a deep-link URL to an authorized LyfeLabz assignment context.

Lifecycle for one deep-link arrival:

1. The student clicks the deep-link URL in Google Classroom.
2. The browser navigates to `https://lyfelabz.com/app/a/{assignmentId}`.
3. The `/app/**` bootstrap establishes identity per `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §11 and §16. If the student is not signed in, sign-in completes first. The bootstrap preserves the arriving URL through the sign-in round trip and dispatches to it afterwards.
4. The client invokes `lmsDeepLinkResolve` with the `assignmentId` as its sole payload.
5. `lmsDeepLinkResolve` performs the resolution described in §10.1 and returns a resolution payload.
6. The client dispatches to the internal navigation target named in the resolution payload. No additional class or assignment selection is presented.

### 10.1 Resolution Rules

`lmsDeepLinkResolve` MUST, in order:

1. Verify the caller is authenticated under an active LyfeLabz identity. Refuse with `unauthenticated` otherwise.
2. Verify the caller's `role === "student"`. Refuse with `role-forbidden` otherwise.
3. Verify the caller's `status === "active"`. Refuse with `account-inactive` otherwise.
4. Load `assignments/{assignmentId}` from server state. Refuse with `assignment-not-found` if absent.
5. Verify the caller's `districtId` claim equals the assignment's `districtId` per `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §17. Refuse with `district-mismatch` otherwise.
6. Verify the caller holds an active enrollment in `enrollments` for the assignment's `classId`. Refuse with `enrollment-inactive` otherwise.
7. Verify the assignment is `status === "published"` or `status === "closed"`. Refuse with `assignment-not-published` for `draft`. Refuse with `assignment-archived` for `archived`.
8. Compute the internal navigation target described in §10.2.
9. Emit `lms.deepLinkResolved` under §17.
10. Return the resolution payload described in §10.2.

### 10.2 Resolution Payload

The resolution payload contains exactly:

- `assignmentId` (echoed).
- `classId` (from the assignment record).
- `activityId` (from the assignment record, equivalent to `lessonSlug`).
- `internalTarget` (the workspace-surface route the client SHOULD dispatch to). For a `mode === "classroom"` assignment, the target routes the student into `My Assignments` (`PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` §6.1) pre-focused on this assignment. For a `mode === "practice"` assignment, the target routes the student to the lesson surface without invoking the assessment pipeline.
- `attemptContext` (either `authorized` when a new session MAY be begun by the assessment pipeline for this student, or `informational` when the window is closed without grace or when the assignment is `mode === "practice"`).

The payload MUST NOT contain:

- an attempt payload, a score, a session identifier, or answer-key material,
- any classmate identifier,
- any Classroom coursework identifier,
- any teacher identifier beyond the one already carried on `assignments/{assignmentId}` for display,
- any Personally Identifying Information for a student other than the caller.

### 10.3 Resolver Non-Responsibilities

`lmsDeepLinkResolve` MUST NOT:

- create, mutate, or delete an `assessmentSessions/{sessionId}` document. Session creation is the sole responsibility of `assessmentSessionsBegin` (`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §21).
- create, mutate, or delete an `attempts/{attemptId}` document. Attempt creation is the sole responsibility of `assessmentAttemptsFinalize`.
- write to `assignments/{assignmentId}`, `lmsAssignmentPublications/{publicationId}`, or `lmsClassLinks/{linkId}`.
- return any information that depends on the caller's Classroom account, Classroom scopes, or Classroom OAuth grant. The resolver is Classroom-agnostic; it only knows a canonical LyfeLabz `assignmentId`.

## 11. Assignment Publication Lifecycle

Publication is a teacher gesture inside the Assign Experience (`ASSIGN_EXPERIENCE.md`, `LMS_EXPERIENCE.md` §15). This contract records the implementation obligations.

Lifecycle for one publication attempt against one target class:

1. The teacher opens the Assignment Dialog and produces an assignment for a class. Activation and publication remain separate under PDR-024f.
2. The teacher toggles "Also publish to Google Classroom" on the class row (`LMS_EXPERIENCE.md` §15).
3. The client invokes `lmsAssignmentPublish` with the LyfeLabz `assignmentId`, the target LMS `lmsClassLinkId`, an optional `providerTopicId`, and a client-supplied idempotency marker.
4. `lmsAssignmentPublish` performs the transaction described in §11.1.
5. On success, the callable returns the `publicationId`, the `providerCourseWorkId`, and the `providerCourseWorkAlternateLink`.
6. On failure, the callable returns a distinguishable error identifier from §20 and the LyfeLabz assignment record is unchanged.

### 11.1 Publication Transaction

`lmsAssignmentPublish` MUST, in order:

1. Verify the caller is `role === "teacher"`, `status === "active"`, and district-matched per `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12.
2. Load the LyfeLabz `assignments/{assignmentId}` and verify `teacherId === caller.uid`. Refuse with `role-forbidden` otherwise.
3. Load `lmsClassLinks/{lmsClassLinkId}` and verify the caller is the owning teacher and the link is `status === "linked"`. Refuse with `link-not-linked` for `stale`, `broken`, or `unlinked` states.
4. Verify the LyfeLabz assignment's `classId` matches the LyfeLabz class named on the link. Refuse with `publication-class-mismatch` otherwise.
5. Verify the assignment is `status === "published"` or `status === "draft"` (publication of a `draft` assignment publishes the LyfeLabz record first per `ASSIGN_EXPERIENCE.md` and PDR-024f, then publishes the Classroom coursework in the same transaction). Refuse with `assignment-not-publishable` for `closed` or `archived`.
6. Compute the deterministic `publicationId` per §12. Refuse with `publication-duplicate` if a prior successful publication document already exists for this `(assignmentId, lmsClassLinkId)` and the caller's idempotency marker does not match the recorded one; return the existing publication payload if it does match.
7. Load `lmsConnections` for the caller and refresh the OAuth token per `LMS_INTEGRATION_ARCHITECTURE.md` §5.3. Refuse with `connection-revoked` for a revoked connection.
8. Construct the deep-link URL per §8.
9. Call the Google Classroom `courses.courseWork.create` endpoint with the deep-link URL as the sole link material, the LyfeLabz assignment title as the coursework title, and the optional `providerTopicId` if the teacher selected one.
10. On Classroom success: write the `lmsAssignmentPublications/{publicationId}` document (§13), update the assignment's `lmsPublicationRef`, emit `lms.assignmentPublished`, and return the success payload.
11. On Classroom rate-limit or 5xx failure: retry within the callable's timeout with exponential backoff and jitter. On persistent failure, do not write the publication document, emit `lms.publishFailed`, and refuse with `provider-unavailable`.
12. On Classroom 4xx failure: do not retry. Do not write the publication document. Emit `lms.publishFailed` with the provider error code. Refuse with `provider-refused`.

Invariants:

- The transaction MUST NOT partially commit. If the Classroom write succeeds but the Firestore write fails, the callable MUST record the outcome for reconciliation and MUST NOT double-publish on retry; idempotency is enforced via the client-supplied marker AND the deterministic identifier construction in §12.
- A refused publication leaves the LyfeLabz assignment record untouched. The teacher sees the failure message from `LMS_EXPERIENCE.md` §14 in the Assign Experience.
- The publication callable MUST NOT modify Classroom coursework beyond the initial create in Version 1. Editing a published coursework is a teacher gesture inside Classroom itself, per `LMS_EXPERIENCE.md` §15.
- Unpublish is a distinct callable (`lmsAssignmentUnpublish`) scoped to remove the Classroom coursework without touching the LyfeLabz assignment record. Unpublish is out of scope for this contract's initial ratification; it is enumerated as a follow-on in §22 and §24.

### 11.2 Publication Ordering with the Assign Experience

- Publication is a side effect of an assignment record under PDR-019d. It MUST NOT be performed before the LyfeLabz assignment is at `status === "published"` or is being transitioned to `published` inside the same operation.
- Activation is not affected by publication. A published Classroom coursework whose LyfeLabz assignment is later deactivated MUST remain in Classroom (LyfeLabz does not unpublish silently). The next student arrival on the deep-link URL sees `assignment-archived` or `assignment-not-published` and the resolver refuses to route into an authorized attempt context. Nothing else happens automatically.
- Publication MUST NOT modify `assignments/{assignmentId}.status`, `.mode`, `.availableAt`, `.windowClosesAt`, or `.lessonSlug`. It writes only `lmsPublicationRef`.

## 12. Canonical Publication Identifiers

Identifier construction is deterministic per the pattern established by `LYFELABZ_FIRESTORE_DATA_MODEL.md` §5 and `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §12.

| Document | Identifier | Notes |
| --- | --- | --- |
| `lmsAssignmentPublications/{publicationId}` | `{assignmentId}__{lmsClassLinkId}__p{ordinal}` where `{ordinal}` is the one-based publication ordinal for this `(assignmentId, lmsClassLinkId)` pair | Ordinals include failed-then-succeeded attempts; the successful ordinal is the one referenced by `lmsPublicationRef` |
| `lmsClassLinks/{lmsClassLinkId}` | Existing construction in `LYFELABZ_FIRESTORE_DATA_MODEL.md` §2.9. This contract does not redefine it | One active link per LyfeLabz class per `LMS_INTEGRATION_ARCHITECTURE.md` §3.3 |

Callables MUST refuse client-supplied `publicationId` values that do not match the deterministic construction and MUST refuse writes whose derived identifier collides with an existing document unless the idempotency marker matches.

## 13. Firestore Ownership Expectations

The following collections and fields are canonical for the deep-link and publication paths. Each row lists the sole authorized writer, the read audience, and the immutability posture.

| Collection or field | Purpose | Written by | Readable by | Immutable after write |
| --- | --- | --- | --- | --- |
| `lmsAssignmentPublications/{publicationId}` | Per-attempt publication record: outcome, external identifiers, timing, ordinal | `lmsAssignmentPublish`, `lmsAssignmentUnpublish` (future) | Owning teacher; server; Platform Administrator under audit | Yes for successful attempts (identifier fields, outcome, timing frozen). A future unpublish callable MAY append a terminal `unpublishedAt` field only |
| `lmsClassLinks/{lmsClassLinkId}` | Per-(LyfeLabz class, Classroom course) mirror | `lmsClassImport`, `lmsClassRefresh` (future), `lmsClassUnlink` (future) | Owning teacher; server | `status` transitions on refresh, ownership drift, and unlink; identifier fields frozen at creation |
| `assignments/{assignmentId}.lmsPublicationRef` | Optional pointer to the most recent successful publication | `lmsAssignmentPublish` only | Owning teacher; server (per assignment read audience) | Rewritten on every successful publication attempt against this `(assignmentId, lmsClassLinkId)` pair; never rewritten from any Classroom callback |
| `auditEvents/{eventId}` | Append-only audit sink (canonical collection in `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.8) | Server only | Server; Platform Administrator | Yes |

Ownership rules:

- No callable other than `lmsAssignmentPublish` writes `lmsAssignmentPublications/*` or `assignments/{assignmentId}.lmsPublicationRef` in this contract's initial scope. The reserved `lmsAssignmentUnpublish` callable, when implemented, writes only the terminal `unpublishedAt` field on the specific publication document it targets.
- `lmsAssignmentPublish` MUST NOT write to `assessmentSessions/*`, `attempts/*`, `attemptRollups/*`, `assignmentRollups/*`, `assessmentAnswerKeys/*`, `users/*`, `enrollments/*`, `classes/*`, or `schools/*`.
- No callable in this contract creates, mutates, or deletes a Classroom course. Classroom courses are upstream state.
- No callable in this contract creates, mutates, or deletes a Classroom roster entry. The refresh callable that owns roster reconciliation is a future capability under `LMS_INTEGRATION_ARCHITECTURE.md` §7.

## 14. Multiple-Class Publication Behavior

The Assignment Dialog under `ASSIGN_EXPERIENCE.md` allows a teacher to target more than one class in a single gesture. When those classes include more than one LMS-linked class, the following rules apply.

- Fan-out publication MUST produce one LyfeLabz `assignments/{assignmentId}` per class per `ASSESSMENT_PIPELINE_SPECIFICATION.md` §12.1. This contract does not perform the fan-out; the Assign Experience callable does.
- The client MUST invoke `lmsAssignmentPublish` once per (LyfeLabz assignment, target class) pair. Each invocation carries a distinct idempotency marker.
- The callable MUST NOT accept a batched payload that would allow a single Classroom failure to affect another target's outcome. Each target succeeds or fails independently.
- Ordering is per (assignment, class) pair. A fan-out to three linked classes produces three `lmsAssignmentPublications` documents, one per class, each with `ordinal === 1` on first success.
- A partial fan-out is a supported terminal state. If two of three targets succeed and one fails, the two successes remain and the third is retried by a teacher gesture. LyfeLabz MUST NOT automatically retry a failed fan-out target beyond the callable's local retry budget in §11.
- Fan-out MUST NOT publish the same LyfeLabz assignment to the same Classroom course twice. The deterministic identifier in §12 and the uniqueness of `(assignmentId, lmsClassLinkId)` enforce this at the write boundary. If the teacher targets a class whose `lmsClassLinkId` is already published for this assignment, the callable returns the existing publication payload.
- The Assign Experience surface MUST reflect per-target outcomes clearly per `LMS_EXPERIENCE.md` §14 and `ASSIGN_EXPERIENCE.md`. This contract does not define the visual treatment.

## 15. Multiple-Teacher Publication Behavior

Classroom courses may carry more than one co-teacher. LyfeLabz enforces a single teacher-of-record per class under PDR-005.

- The LyfeLabz class owner (the teacher who imported the class per `LMS_EXPERIENCE.md` §4) is the sole authorized publisher on the LyfeLabz side. A co-teacher who did not import the class MUST NOT publish through LyfeLabz. Publication callable refuses with `role-forbidden` if `caller.uid !== assignment.teacherId`.
- The Classroom side may carry co-teachers who did not initiate the LyfeLabz publication. LyfeLabz does not attempt to enumerate Classroom co-teachers on publication; the create call uses the owning teacher's Classroom OAuth grant.
- Ownership drift detection (`LMS_EXPERIENCE.md` §7, PDR-019j) MUST run on publication. If the caller is no longer listed as the Classroom teacher of record for the target course, the callable refuses with `ownership-drift` and emits `lms.ownershipDrift`. The LyfeLabz class link MUST be marked `stale`. No Classroom write is attempted.
- LyfeLabz MUST NOT silently reassign LyfeLabz class ownership to a Classroom co-teacher. Ownership changes remain the audited administrative path per PDR-005.
- A co-teacher inside LyfeLabz (a hypothetical future capability) is not authorized by this contract. Any future co-teacher role MUST introduce a superseding PDR and MUST extend this contract's authorization rules explicitly.

## 16. Classroom Synchronization Ownership

Classroom is the source of truth only for concepts PDR-019b already names (classroom identity, teacher ownership, roster). LyfeLabz is the source of truth for LyfeLabz assignments, activation, sessions, attempts, and every learning interaction. This contract records the synchronization operations that follow from that division.

Operations LyfeLabz performs against Google Classroom, in order of scope:

| Operation | Direction | Ownership | Sprint |
| --- | --- | --- | --- |
| List teacher's Classroom courses | Classroom -> LyfeLabz | Read-only | LMS Sprint B (initial scope) |
| Read roster of a Classroom course | Classroom -> LyfeLabz | Read-only | LMS Sprint B (initial scope) |
| Create a Classroom coursework record with a deep-link URL | LyfeLabz -> Classroom | Write, single call per publication | LMS Sprint D |
| Refresh the roster of an imported class | Classroom -> LyfeLabz | Read + reconcile | LMS Sprint E |
| Detect Classroom course deletion (broken link) | Classroom -> LyfeLabz | Read on failure | LMS Sprint E |
| Detect Classroom teacher-of-record change (ownership drift) | Classroom -> LyfeLabz | Read on publication and refresh | LMS Sprint D and Sprint E |
| Unpublish a Classroom coursework record | LyfeLabz -> Classroom | Write, single call | Deferred (see §22) |

Operations LyfeLabz MUST NEVER perform against Google Classroom:

- Post to the Classroom class stream.
- Comment on a Classroom coursework, submission, or announcement.
- Send an email, direct message, or notification through Classroom.
- Grade a Classroom coursework submission or push a grade back into Classroom.
- Read a non-LyfeLabz Classroom coursework's submission content.
- Read Classroom announcements, comments, or attachments authored by anyone else.
- Read the Classroom class stream.
- Modify a Classroom coursework's title, description, points, topic, or availability after publication (edits are teacher gestures inside Classroom, per `LMS_EXPERIENCE.md` §15).
- Delete a Classroom course, coursework, or roster entry.

Every operation LyfeLabz performs against Classroom MUST be initiated by a Cloud Function under the owning teacher's OAuth grant. Clients never call Classroom directly (`LMS_INTEGRATION_ARCHITECTURE.md` §5.5).

## 17. Cloud Function Ownership Matrix

Every callable that touches the Google Classroom deep-link, publication, or resolution path is listed here. Where an older document names a callable slot at the concept level (`LMS_INTEGRATION_ARCHITECTURE.md` §6), the concrete name below is canonical for this contract.

| Callable | Trigger | Owner responsibility | Idempotent? |
| --- | --- | --- | --- |
| `lmsAssignmentPublish` | Callable, teacher | Publishes a LyfeLabz assignment to one Classroom course via one link material. Runs the transaction in §11.1. Sole writer of `lmsAssignmentPublications/*` and of `assignments/{assignmentId}.lmsPublicationRef`. Emits `lms.assignmentPublished` on success and `lms.publishFailed` on failure. | Yes, under the client-supplied idempotency marker AND the deterministic `publicationId` |
| `lmsAssignmentUnpublish` | Callable, teacher (future scope; reserved by this contract) | Removes a specific Classroom coursework record without touching the LyfeLabz assignment. Sole writer of the terminal `unpublishedAt` field on `lmsAssignmentPublications/{publicationId}`. Emits `lms.assignmentUnpublished`. | Yes, under the target `publicationId` |
| `lmsDeepLinkResolve` | Callable, student | Resolves a deep-link URL request into an authorized LyfeLabz assignment context per §10. Read-only against `assignments/*` and `enrollments/*`. Never writes to any assignment, session, attempt, publication, or link record. Emits `lms.deepLinkResolved`. | Yes (read-only) |
| `lmsClassImport` | Callable, teacher | Creates a `lmsClassLinks/{lmsClassLinkId}` document under `LMS_INTEGRATION_ARCHITECTURE.md` §7. Named here to establish the sole authorized producer of the link identifier this contract's callables consume. | Yes |
| `lmsClassRefresh` | Callable, teacher (future scope) | Reconciles roster and detects ownership drift or broken link. Named here to establish the sole authorized transitioner of `lmsClassLinks/{lmsClassLinkId}.status`. | Yes |
| `lmsClassUnlink` | Callable, teacher (future scope) | Transitions a linked class to `status === "unlinked"`. Named here to establish the interaction with published deep-links (§18). | Yes |
| `lmsOwnershipDriftHandler` | Server-triggered, on 403 from Classroom during publication or refresh | Transitions the affected `lmsClassLinks/{lmsClassLinkId}` to `status === "stale"` and emits `lms.ownershipDrift`. Never reassigns LyfeLabz class ownership. | Yes |

Ownership rules:

- No callable other than `lmsAssignmentPublish` writes `lmsAssignmentPublications/*` or `assignments/{assignmentId}.lmsPublicationRef` in this contract's initial scope.
- `lmsDeepLinkResolve` MUST NOT write to any Firestore document except `auditEvents/*`.
- Every callable additionally satisfies the district enforcement contract in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12.
- Every callable is single-purpose. A callable that appears to need two responsibilities is two callables.

## 18. Interaction with Refresh, Unlink, and Broken-Link States

- **Refresh (`lmsClassRefresh`).** When refresh detects ownership drift or a broken upstream course, it transitions the `lmsClassLinks/{lmsClassLinkId}.status`. Existing `lmsAssignmentPublications` documents for that link remain readable for audit. `lmsDeepLinkResolve` continues to resolve against LyfeLabz state; the deep-link URL is unaffected by upstream Classroom coursework deletion because the URL points at LyfeLabz, not at Classroom.
- **Unlink (`lmsClassUnlink`).** Unlink transitions the link to `status === "unlinked"`. Existing publications remain readable for audit. `lmsAssignmentPublish` refuses new publications against an unlinked link (§11.1 step 3). `lmsDeepLinkResolve` is unaffected; the LyfeLabz assignment continues to authorize its enrolled students.
- **Broken link.** A Classroom course deleted upstream does not delete the LyfeLabz class or the deep-link URL. The URL continues to route to `lmsDeepLinkResolve`, which authorizes the student against LyfeLabz state alone. `LMS_EXPERIENCE.md` §8 governs the teacher-facing surface for a broken link.
- **Coursework deleted upstream in Classroom.** LyfeLabz does not detect deletion of an individual coursework record proactively. The next teacher-initiated publication against the same `(assignmentId, lmsClassLinkId)` MAY succeed and produce a new publication ordinal. This is a designed omission for the initial scope; a periodic coursework reconciliation sweep is deferred (§22).
- **Assignment closed or archived in LyfeLabz.** The Classroom coursework record MUST NOT be modified by LyfeLabz in response. Students arriving on the deep-link see the resolver refuse with `assignment-archived` or (during closed with no grace) `assignment-window-closed`. No automatic Classroom side effect follows.
- **Assignment deleted in LyfeLabz.** Deletion of a LyfeLabz assignment is out of scope; the certified architecture retains assignments per `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.6. If a future deletion capability is authorized, the resolver's `assignment-not-found` refusal is the safe default.

## 19. Security Boundaries

The following invariants MUST hold across every operation named in this contract.

- **Server-authoritative.** Every Classroom API call originates in a Cloud Function under the owning teacher's server-held OAuth grant. Clients never call Classroom directly, never hold a Classroom OAuth token, never sign a Classroom request, and never compute a Classroom API URL from an unvalidated Firestore field. See `LMS_INTEGRATION_ARCHITECTURE.md` §5.4 and §5.5.
- **URL scope.** The deep-link URL MUST comply with §8.1 and §8.2. No callable in this contract emits any other URL into Google Classroom link material.
- **No cross-district publication.** `lmsAssignmentPublish` refuses when the caller's `districtId` claim does not match the assignment's `districtId` (`DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12 and §17). No cross-district link may exist.
- **No cross-teacher publication.** `lmsAssignmentPublish` refuses when the caller is not the assignment's `teacherId`.
- **No student-authored publication.** No callable in this contract is authorized for `role === "student"` except `lmsDeepLinkResolve`.
- **No answer-key exposure.** No callable emits any answer-key material into Classroom, into a callable response, into an audit event, or into a URL. This is a restatement of `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §15 into the Classroom surface.
- **No score exposure through Classroom.** LyfeLabz does not push a score, item-level correctness, or feedback payload into Classroom under any circumstance. Grade-back is out of scope permanently under `LMS_INTEGRATION_ARCHITECTURE.md` §11.3.
- **No client storage of publication tokens.** OAuth tokens remain server-only per PDR-019e. No callable returns a token, a refresh token, an OAuth code, or a signed request to the client.
- **Referer is not authorization.** The deep-link resolver MUST NOT trust `Referer` as an authorization signal (§8.4).
- **Preview environment does not publish to production Classroom.** No callable in a preview environment produces a Classroom coursework record in a production Classroom class. Preview publication targets an authorized Google Workspace for Education test instance or a Google Classroom API test double, per `LMS_INTEGRATION_ARCHITECTURE.md` §10.3.5 and §10.3.6.

## 20. District Enforcement Expectations

Every callable named in this contract MUST also satisfy `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12 (Callable Requirements) and §17 (Error Contract). The district rules are additive to the rules above; nothing in this contract widens or narrows the district boundary.

Specifically:

- `lmsAssignmentPublish` MUST derive `districtId` from the LyfeLabz assignment's server-stored value and compare it to the caller's `districtId` claim. Refuse with `district-mismatch` on disagreement.
- `lmsDeepLinkResolve` MUST derive `districtId` from the resolved assignment's server-stored value and compare it to the caller's `districtId` claim. Refuse with `district-mismatch` on disagreement.
- Every `lmsAssignmentPublications/{publicationId}` document MUST carry the `districtId` at write time. Cross-district publications MUST NOT exist. This is enforced at the write boundary by the callable and re-checked by Security Rules.
- Every `auditEvents/{eventId}` document emitted by this contract MUST carry the `districtId` per `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §16.

## 21. Error Contract

Callables MUST return stable error identifiers for deep-link, publication, and resolution failures. The following identifiers are canonical. Where an identifier already exists in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §17 or `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §25, that name is preserved.

- `unauthenticated`
- `account-inactive`
- `role-forbidden`
- `district-mismatch`
- `enrollment-inactive`
- `assignment-not-found`
- `assignment-not-published`
- `assignment-not-publishable`
- `assignment-archived`
- `assignment-window-closed`
- `publication-class-mismatch`
- `publication-duplicate`
- `link-not-linked`
- `connection-revoked`
- `ownership-drift`
- `provider-unavailable`
- `provider-refused`
- `provider-rate-limited` (informational; the callable retries within its budget before returning `provider-unavailable`)
- `deep-link-shape-invalid`
- `idempotency-marker-mismatch`

Callables MUST NOT leak Classroom coursework identifiers, Classroom roster entries, another teacher's assignment identifiers, or any student's Personally Identifying Information in any error payload.

## 22. Required Indexes

The composite indexes named here MUST exist for the deep-link and publication paths. Names use the existing `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md` §3.1 convention.

`lmsAssignmentPublications`

- `(assignmentId, lmsClassLinkId, ordinal desc)` - serves the pre-write existence check in `lmsAssignmentPublish` and the "most recent publication for this pair" query used by teacher operational surfaces.
- `(teacherId, publishedAt desc)` - serves the teacher's recent-publication stream in operational tooling.
- `(districtId, publishedAt desc)` - serves district-scoped administrative queries; reserved until first use.

`lmsClassLinks`

- Reuses the indexes named in `LMS_INTEGRATION_ARCHITECTURE.md` §3.3 and `LYFELABZ_FIRESTORE_DATA_MODEL.md` §2.9. This contract does not introduce a new `lmsClassLinks` index.

`assignments`

- No new index is introduced by this contract. The additive `lmsPublicationRef` field is read from an assignment already loaded by `assignmentId`.

`auditEvents`

- Reuses the indexes in `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md` §3.1.7. No new index is introduced.

The implementation sprint MUST review the emulator's index emissions after every callable is landed and MUST reconcile the deployed index configuration to this contract.

## 23. Audit Event Requirements

All deep-link, publication, and resolution transitions MUST emit an `auditEvents/{eventId}` document under the canonical shape in `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.8 (required fields: `actorUserId`, `actorRole`, `action`, `targetType`, `targetId`, `occurredAt`; conditionally required `schoolId`; where the event resolves to a district, `districtId` MUST also be recorded per `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §16).

Required event vocabulary:

| Transition | Canonical `action` | Actor | Target | Notes |
| --- | --- | --- | --- | --- |
| Publication succeeded | `lms.assignmentPublished` | `teacher` | `lmsAssignmentPublications/{publicationId}` | Records `assignmentId`, `lmsClassLinkId`, `providerCourseId`, `providerCourseWorkId`, `ordinal` |
| Publication failed | `lms.publishFailed` | `teacher` | `assignments/{assignmentId}` | Records `lmsClassLinkId`, `providerErrorCode` when returned by Classroom, `reason` from §21 |
| Publication refused pre-Classroom | `lms.publishFailed` with `outcome: "refused"` | `teacher` | `assignments/{assignmentId}` | Records the refusal reason from §21; Classroom is not called |
| Deep-link resolved | `lms.deepLinkResolved` | `student` | `assignments/{assignmentId}` | Records `attemptContext`; MUST NOT record classmate identifiers or Classroom identifiers |
| Deep-link refused | `lms.deepLinkResolved` with `outcome: "refused"` | Caller | Attempted `assignmentId` (or a null target when the identifier failed shape validation) | Records the refusal reason from §21 |
| Ownership drift detected | `lms.ownershipDrift` | `system` | `lmsClassLinks/{lmsClassLinkId}` | Records `assignmentId` when detection occurred during publication |
| Assignment unpublished (future scope) | `lms.assignmentUnpublished` | `teacher` | `lmsAssignmentPublications/{publicationId}` | Reserved for `lmsAssignmentUnpublish` |

The vocabulary above extends the vocabulary named in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` §3.3 (`lms.assignmentPublished`, `lms.publishFailed`, `lms.ownershipDrift`) with two additional identifiers (`lms.deepLinkResolved`, `lms.assignmentUnpublished`). No second audit sink is created.

The `auditEvents` collection is append-only. No callable and no rule permits update or delete, including for `platformAdministrator`.

## 24. Required Emulator Tests

The implementation sprint that lands the deep-link and publication paths MUST include emulator tests covering, at a minimum:

- `lmsAssignmentPublish` succeeds against a linked class with a valid teacher OAuth grant; writes exactly one `lmsAssignmentPublications` document; sets `lmsPublicationRef` on the assignment; emits exactly one `lms.assignmentPublished` event.
- `lmsAssignmentPublish` is idempotent under retry with the same idempotency marker; a second call returns the existing publication payload without a second Classroom write and without a second audit event.
- `lmsAssignmentPublish` refuses a `draft` assignment by transitioning it to `published` in the same operation only when the Assign Experience authorizes it; refuses a `closed` or `archived` assignment.
- `lmsAssignmentPublish` refuses cross-district and cross-teacher publications.
- `lmsAssignmentPublish` refuses when the link is `stale`, `broken`, or `unlinked`.
- `lmsAssignmentPublish` refuses when the connection is `revoked`; the failed attempt emits `lms.publishFailed`.
- `lmsAssignmentPublish` refuses when ownership drift is detected on the target course; the link is transitioned to `stale`; `lms.ownershipDrift` is emitted.
- `lmsAssignmentPublish` retries on Classroom 5xx and rate-limit responses within its local retry budget; returns `provider-unavailable` on persistent failure; does not write a publication document on failure.
- `lmsAssignmentPublish` never modifies session, attempt, rollup, answer-key, class, enrollment, or user documents.
- Fan-out publication: three sequential calls for three linked classes produce three publication documents, one per class; each carries `ordinal === 1`; each is independently retryable.
- Fan-out publication with one 4xx failure: two documents are written for the two successes; no document is written for the failure; the failed target is independently retryable.
- `lmsDeepLinkResolve` returns the correct navigation target for an enrolled student on a `published` assignment; returns `informational` for a `practice`-mode assignment; refuses for a non-enrolled caller with `enrollment-inactive`; refuses for a cross-district caller with `district-mismatch`.
- `lmsDeepLinkResolve` never writes to `assessmentSessions/*`, `attempts/*`, or `assignments/*`.
- `lmsDeepLinkResolve` refuses a malformed `assignmentId` with `deep-link-shape-invalid` and does not emit a fully populated audit target.
- `lmsDeepLinkResolve` refuses a request whose deep-link URL carries any query parameter or fragment that would smuggle identity or authorization.
- A published assignment later archived in LyfeLabz: `lmsDeepLinkResolve` returns `assignment-archived`; the Classroom coursework record is not touched by LyfeLabz.

The tests themselves are not written in Sprint 10A F-3.

## 25. Required Unit Tests

The implementation sprint MUST include unit tests covering, at a minimum:

- The deep-link URL builder produces the exact shape in §8.1 for every canonical `assignmentId`; refuses to embed a query parameter, a fragment, an alternate host, an `http` scheme, or a lesson slug.
- The deep-link URL parser accepts only the exact shape in §8.1 and refuses everything else with `deep-link-shape-invalid`.
- The deterministic `publicationId` builder in §12 produces stable identifiers under identical inputs; refuses client-supplied identifiers that do not match; increments the ordinal correctly across successive failed-then-succeeded attempts.
- The Google Classroom adapter's `courseWork.create` call sends exactly one link material carrying the LyfeLabz deep-link URL; does not populate description text, attachments, or grading fields beyond what §8.3 authorizes.
- The scorer, session, and rollup helpers imported from `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` are not reachable from any code path exercised by `lmsAssignmentPublish` or `lmsDeepLinkResolve`. (Static import graph assertion.)
- The district enforcement helper from `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` is invoked exactly once at the start of every callable named in this contract.

The tests themselves are not written in Sprint 10A F-3.

## 26. Engineering Implementation Checklist

The implementation sprint that lands the deep-link and publication paths MUST address:

1. Shared TypeScript types for `lmsAssignmentPublications/{publicationId}`, the deep-link URL, the publication request payload, the publication response payload, the deep-link resolution request payload, and the resolution response payload.
2. A single deep-link URL builder that is the sole authorized producer of the URL shape in §8.1. No other code path constructs the URL.
3. A single deep-link URL parser that is the sole authorized consumer of the URL shape in §8.1. `lmsDeepLinkResolve` calls only this parser to interpret the `assignmentId` segment.
4. A single Google Classroom adapter module that isolates every Classroom API call. The adapter is the sole importer of the Classroom SDK.
5. A single publication transaction implementation that runs §11.1 in order.
6. A single resolution implementation that runs §10.1 in order.
7. Firestore Security Rules updated to enforce §13 and the invariants named in `LYFELABZ_FIREBASE_SECURITY_MODEL.md` §296 for `lmsAssignmentPublications`.
8. Composite indexes updated to include every index in §22.
9. Emulator tests per §24 and unit tests per §25.
10. Deployment validation: staging environment MUST run the full rules-test matrix and the emulator suite before rules and callables are promoted to production. Staging MUST NOT publish to a production Classroom class.
11. Observability: latency histograms per callable, error-rate dashboards per error identifier in §21, and an oncall runbook for `provider-unavailable` and `ownership-drift`.
12. Runbook additions: `LMS_INTEGRATION_OPERATIONS.md` MUST be extended (in a later sprint, not this one) with the operational procedures for publication rollback, unpublish, and coursework-deleted-upstream reconciliation as they are implemented.

## 27. Explicit Non-Goals

This contract does not introduce:

- Bidirectional publication. LyfeLabz never reads Classroom-authored coursework as a LyfeLabz assignment. This is permanent under PDR-019d.
- Grade export to Classroom. LyfeLabz does not push a score or a completion signal into Classroom under any circumstance. This is permanent under `LMS_INTEGRATION_ARCHITECTURE.md` §11.3.
- Automatic synchronization of publications. Publication is a teacher gesture per PDR-019c. No scheduled job in this contract publishes on the teacher's behalf.
- A second-provider adapter (Canvas, Schoology, Microsoft Teams for Education). The provider abstraction is preserved (§5); an adapter is a future sprint under `LMS_INTEGRATION_ARCHITECTURE.md` §4.2.
- A LyfeLabz-side co-teacher role or a Classroom-derived co-teacher authorization. Any co-teacher capability requires a superseding PDR.
- A deep-link URL that carries a session identifier, a token, or a score. Permanent under §8.2.
- A student surface that displays Classroom coursework identifiers, Classroom URLs, or Classroom teacher lists. Permanent under `LMS_EXPERIENCE.md` §13.
- A teacher-facing publication history surface. `lmsAssignmentPublications` documents are inspectable via operational tooling; a teacher-facing history view is a future capability.
- A Classroom-driven curation of the LyfeLabz curriculum. Permanent under `LMS_INTEGRATION_ARCHITECTURE.md` §11.3.
- A Present Mode integration with Classroom. Permanent under PDR-019l.
- A parent view of Classroom activity. Not in scope.

Any of the above requires a new PDR that supersedes the relevant section of this contract.

## 28. Open Implementation Gaps

The following are the only implementation gaps that cannot be resolved from the certified architecture. Each is narrow and non-blocking under the safe defaults recorded above.

- **G-10A-9. Unpublish callable ratification.** `lmsAssignmentUnpublish` is named as a reserved slot in §17 and §23 but its full transaction is not specified by this contract. Impact: the implementation sprint that lands unpublish MUST author its transaction as an amendment to this contract; the safe default is that unpublish is unavailable until authored.
- **G-10A-10. Coursework-deleted-upstream reconciliation.** LyfeLabz does not detect Classroom coursework deletion proactively in the initial scope (§18). Recommendation: the implementation sprint that lands publication MAY add a bounded, teacher-initiated reconciliation gesture; a periodic scheduled sweep is deferred to a future sprint. This contract does not require either.
- **G-10A-11. Coursework metadata beyond title and topic.** The initial scope emits only title, single link material, and optional topic. Whether the coursework carries a `points` field, an `assigneeMode`, or a `state === "PUBLISHED"` value at create is not fixed by this contract because Classroom's minimum-required create payload can shift. Recommendation: the implementation sprint MUST record the exact create payload in an operational appendix and reconcile it here without a new PDR.
- **G-10A-12. Assignment Dialog per-target failure surface.** The teacher-facing per-target outcome surface for fan-out publication is owned by `ASSIGN_EXPERIENCE.md` and `LMS_EXPERIENCE.md` §14. Its exact visual treatment is not fixed here. Recommendation: the implementation sprint reconciles the surface at the Assign Experience level; this contract requires only the per-target callable independence in §14.
- **G-10A-13. Deep-link URL rotation.** No rotation of `assignmentId` is authorized in the certified architecture; the URL is stable for the life of the assignment. If a future superseding decision authorizes rotation, the URL contract in §8 MUST be amended and every published Classroom coursework record MUST have a migration path. This contract does not require rotation to exist.

No blocking gap remains. Implementation of the publication and resolution paths can proceed against this contract with the five narrow decisions above deferred to their appropriate future scope.

---

## Change Log

- 2026-07-12 - Initial issuance under Sprint 10A step F-3. Ratified by PDR-027.
