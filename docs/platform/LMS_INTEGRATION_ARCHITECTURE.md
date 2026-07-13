# LyfeLabz LMS Integration Architecture

Status: Implementation authorized following this ratification. The narrow initial scope named in PDR-020c is authorized for implementation under Phase 9 (LMS Integration Foundation) as advanced ahead of Phase 8 by PDR-020b. Every load-bearing decision in PDR-019 and PDR-020 continues to apply. Capabilities beyond the initial scope remain reachable-but-deferred and require their own subsequent sprint specifications.
Companion documents: LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_FIRESTORE_DATA_MODEL.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, PLATFORM_CONTRACTS.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, TEACHER_JOURNEY.md, ASSIGN_EXPERIENCE.md, PRESENT_MODE_ARCHITECTURE.md, CLASS_SNAPSHOT_EXPERIENCE.md, SNAPSHOT_ARCHITECTURE.md, LMS_EXPERIENCE.md, LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md, LMS_INTEGRATION_OPERATIONS.md, IDENTITY_AND_ONBOARDING_SPECIFICATION.md.

## Sprint 10A F-3 Reconciliation Notice

The Google Classroom deep-link, publication, and resolution implementation rules that follow from PDR-019 and PDR-020 are canonical in `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` under PDR-027. Every load-bearing decision in this document (complement not replace, authority boundaries, manual-first, one-way publication, server-only tokens, no new roles, vendor-neutral core) is preserved without amendment. Implementation questions about the deep-link URL contract, the publication callable, the resolution callable, multiple-class publication behavior, multiple-teacher publication behavior, and Classroom synchronization ownership route to the new contract.

Where this document and the implementation contract conflict on architecture or on the LMS trust boundary, this document controls and the implementation contract is reconciled.

---

## Sprint 9C Reconciliation Notice

The identity and roster portions of this architecture are subordinate to `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` and PDR-023. Nothing in Sprint 9C widens or narrows the LMS surface; it names the identity contract this architecture already assumed.

- **Roster authority.** Every class has exactly one roster authority. LMS-linked classes: Google Classroom. Manual classes: LyfeLabz. Hybrid authority is refused. This is the identity restatement of PDR-019b and PDR-019i.
- **Identity matching.** Google Classroom User ID is the primary matching key for LMS-linked classes; email is the secondary validator. Students never resolve identity ambiguity by hand.
- **Roster placeholders and first sign-in activation.** Roster import produces placeholders in the `awaitingFirstSignIn` state. Student identities are created only at first successful Google sign-in.
- **District boundary.** LMS integration operations are refused across district boundaries. A teacher may only import Google Classroom classes into their own district's school membership.

Where this document and `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` conflict on identity or roster authority, the specification controls.

---

This document defines the canonical architecture for integrating LyfeLabz with external learning management systems. It is implementation-neutral. It does not ship Firestore fields, Firebase Security Rules, Cloud Function code, callable signatures, or client bundles. Those artifacts follow this document. The amendments recommended in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` have been ratified into the platform architecture; PDR-019 records the load-bearing posture and PDR-020 authorizes the initial implementation scope.

Every architectural decision in this document defers to the certified architecture and to the certified decision log (`LYFELABZ_PLATFORM_DECISIONS.md`) in every case of conflict. In particular, this document defers to PDR-001, PDR-004, PDR-005, PDR-007, PDR-010, PDR-011, PDR-012, PDR-015, PDR-017, and PDR-018.

---

## 1. Purpose

The purpose of this document is narrow and load-bearing:

- Give LyfeLabz a canonical, vendor-neutral architecture for LMS integration.
- Name Google Classroom as the first implementation target without letting Google-specific detail become the architecture.
- Preserve the certified boundary between LyfeLabz and every external learning management system.
- Establish the trust boundary, ownership model, and lifecycle for imported classroom data.
- Prevent the certified domains (Identity, Schools, Teachers, Classrooms, Enrollments, Assignments, Submissions) from being silently redefined by an integration sprint.

LMS integration exists so a teacher who already uses Google Classroom can bring the classes she already has into LyfeLabz without recreating them by hand. It does not exist so that LyfeLabz can replace the LMS, mirror its features, or become an alternative front door to it.

---

## 2. Architecture Principles

The following principles are canonical for every LMS integration LyfeLabz will ever build.

**LyfeLabz complements. It never replaces.** The connected LMS remains the authoritative system for the concepts it owns. LyfeLabz never claims to be the source of truth for anything the LMS is the source of truth for.

**The LMS owns classroom identity, teacher ownership, enrollment, and roster.** LyfeLabz mirrors these into its own domain records so that the certified platform surfaces (Classes, Assign, Snapshot, Present Mode) continue to work, but the LMS is the authoritative upstream.

**LyfeLabz owns instructional experiences, classroom workflow, assignments, Present Mode, Snapshot, and learning interactions.** These are LyfeLabz's job. No LMS integration relocates them.

**Integration is opt-in per teacher, per class, and per action.** No teacher is enrolled in an integration by default. No class is imported without an explicit teacher action. No assignment is published to the LMS without an explicit teacher action.

**Manual before automatic.** The first integration surface is a manual import driven by the teacher. Automatic synchronization is not the default and, when it ships, is opt-in and reversible.

**One-way where possible.** LyfeLabz reads from the LMS to mirror rosters and to open classes. LyfeLabz writes to the LMS only when the teacher explicitly publishes an assignment there. LyfeLabz never edits an LMS record it did not create through a teacher action.

**Vendor-neutral core, vendor-specific edges.** The platform surface (session, callables, storage, security) speaks in LyfeLabz concepts. The LMS-specific adapter translates. A second LMS is added by writing a second adapter; it never rewrites the core.

**No new roles.** PDR-004's closed role model is preserved. No LMS integration introduces a new user role, a new custom claim key, or a new authoritative lifecycle field.

**No new authority.** No LMS integration widens a role's authority. A teacher who imports a class from Google Classroom does not thereby gain authority she does not already have as an active teacher.

**Privacy first.** LyfeLabz does not copy data from the LMS that it does not need. Student PII beyond what LyfeLabz already collects under PDR-011 is not imported.

**Server-authoritative.** Every write that touches an OAuth token, a mirrored class, a mirrored enrollment, or an outbound LMS publication is server-mediated by a Cloud Function. The client asks; the server decides.

**Safe under revocation.** At any moment, the LMS can revoke access, delete a class, archive a class, or remove a student. LyfeLabz must degrade gracefully at every such event and must never surface stale, private, or unowned data as if it were current.

---

## 3. Relationship to the Certified Architecture

LMS integration is a new capability layered on top of the certified domains. It does not replace any of them.

### 3.1 Relationship to Identity

Identity remains owned by Sprints 1 through 3. The Sprint 2 authentication trigger, the canonical `{ role, schoolId }` custom claims, and the `PLATFORM_STATE_MACHINE.md` lifecycle are unchanged.

An LMS integration operates only for a teacher whose `status` is `active`. No LMS callable runs for a caller in `provisioned`, `pendingVerification`, `suspended`, or `archived`. The Canonical Session Object remains the sole client-side authority for identity.

The LMS is not an identity provider for LyfeLabz. Google Sign-In through Firebase Authentication remains the identity provider per PDR-002. The fact that Google Classroom is operated by Google does not fold LMS authorization into LyfeLabz's identity trust layer.

### 3.2 Relationship to Security

The Firebase Security Model remains authoritative for who can read and write which Firestore documents. The LMS integration adds new server-authoritative writes; it does not loosen any existing rule.

The trust boundary is unchanged. Clients never hold OAuth tokens for external LMS providers. Clients never make direct HTTP calls to the LMS's REST or gRPC surface. Every LMS request is initiated by a Cloud Function on behalf of an authenticated teacher.

Ownership is unchanged. A class is teacher-owned; an enrollment is scoped to the enrolled student and the teacher of the referenced class; a submission is scoped to the submission's student and the teacher of the associated class. LMS integration does not introduce a new ownership actor.

### 3.3 Relationship to Firestore

LMS integration introduces integration-scoped records that mirror upstream state. Their canonical shape is defined by the Firestore Data Model amendment recommended in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`. The following domain concepts are reserved by this architecture:

- **`lmsProviders`** - the closed set of supported LMS providers. In Version 1 of the integration, this contains `googleClassroom` only. Additional providers require an amendment.
- **`lmsConnections`** - one document per (teacher, provider) pair. Records the teacher's opt-in to a specific LMS provider, the OAuth scopes granted, the token reference (not the token), and the connection status.
- **`lmsClassLinks`** - one document per (LyfeLabz class, LMS class) pair. Records the mirroring link between a LyfeLabz `classes/{classId}` record and its upstream LMS class identifier.
- **`lmsRosterLinks`** - one document per (LyfeLabz enrollment, LMS roster entry) pair. Records the mirroring link between a LyfeLabz enrollment and its upstream LMS roster entry.
- **`lmsAssignmentPublications`** - one document per publication attempt from a LyfeLabz assignment to an LMS. Records the publication attempt, the outcome, and the LMS assignment identifier where the attempt succeeded.

None of these records is authoritative for the upstream LMS state. All of them are mirroring records with a `mirroredAt` server timestamp. The upstream LMS remains the authoritative source; the mirror is the operational read-side for LyfeLabz surfaces.

The certified `classes`, `enrollments`, `assignments`, and `submissions` collections are not renamed, restructured, or relocated. Fields added to these records to reference the mirror are additive per the additive-schema-evolution principle.

### 3.4 Relationship to Cloud Functions

LMS integration lives on the server. The Cloud Function Charter is amended to add responsibilities under the existing philosophy of §1 of the charter; no new philosophy is introduced. The following responsibilities become server responsibilities:

- Initiating and completing the OAuth flow with the LMS provider.
- Storing and rotating LMS access and refresh tokens.
- Reading LMS class lists, roster entries, and topic lists on behalf of a teacher.
- Establishing and updating `lmsConnections`, `lmsClassLinks`, and `lmsRosterLinks` records.
- Publishing a LyfeLabz assignment to an LMS.
- Refreshing a mirrored class on teacher request.
- Handling revocation events (token expiry, class archival, class deletion, student removal).

The client is never authoritative. A teacher's click on "Import class" opens a callable request; the server decides whether the request is legitimate, authorized, and safe.

### 3.5 Relationship to Teacher Workspace

The LMS integration surface lives inside the Teacher Workspace shell. It does not introduce a new authenticated shell, a new router, or a new session bootstrap. It renders through the shared workspace outlet using the workspace-surface identifier convention certified in `PLATFORM_CONTRACTS.md` §7.

The recommended workspace-surface identifier for the integration surface is `settings/integrations`. This is a nested surface under Settings, not a top-level navigation item on the left-side panel. The left-side panel (LYFELABZ, Curriculum, Classes, Present Mode, Settings) is not amended by this document.

The Curriculum surface, the Classes list, the class workspace, Present Mode, and Snapshot render unchanged. They read mirrored records only where the mirror already resolves cleanly to an existing LyfeLabz class record.

### 3.6 Relationship to Assign

The Assign Experience (`ASSIGN_EXPERIENCE.md`) is the single canonical origin of LyfeLabz assignment records. LMS integration does not create a second assign workflow.

LMS integration extends the Assign Experience in exactly one way: an optional Google Classroom topic selector and an optional "Also publish to Google Classroom" affordance in the Assignment Dialog. Both are additive controls on the same one dialog. Both are visible only when the teacher has an active `lmsConnections` record for that class's linked LMS provider. Neither affordance affects the LyfeLabz assignment record, which remains authoritative for LyfeLabz-side scheduling, activation, and Practice/Classroom mode semantics per PDR-010.

Publishing to the LMS is a side effect of an assignment record, not an alternate assign path. A LyfeLabz assignment can exist without an LMS publication. An LMS publication cannot exist without a LyfeLabz assignment.

### 3.7 Relationship to Snapshot

Snapshot (`SNAPSHOT_ARCHITECTURE.md`) is a downstream reader of certified domains. LMS integration adds no field to the Snapshot contract. Snapshot never displays LMS-specific state, LMS topic names, LMS publication status, or LMS roster deltas. The teacher checks LMS state in her LMS. Snapshot remains a preparation surface for LyfeLabz-scoped moments.

### 3.8 Relationship to Present Mode

Present Mode (`PRESENT_MODE_ARCHITECTURE.md`) is a structurally separate surface with no Firebase SDK on the canonical instructional origin. LMS integration does not touch Present Mode. No LMS token, no OAuth flow, no LMS bundle, and no LMS-scoped payload reaches the canonical origin. This is a preservation of the certified surface boundary, not a new rule.

---

## 4. Supported LMS Philosophy

LyfeLabz supports a small, deliberate set of learning management systems. Each supported LMS is a documented decision, not a checkbox in a settings panel.

### 4.1 Initial Implementation Target

Google Classroom is the initial implementation target. It is chosen because:

- The target market (Massachusetts middle schools) is overwhelmingly on Google Workspace for Education, matching the PDR-002 identity choice.
- Google Classroom's roster and assignment concepts translate cleanly to LyfeLabz's certified concepts of class, enrollment, and assignment.
- The identity provider is already Google, so the OAuth prompt a teacher sees for LMS scopes is an expansion of a trust relationship she already has.

Google Classroom is a target, not the definition. Any Google-specific decision in this document is called out as such and is expected to be mirrored by an equivalent decision for any second LMS.

### 4.2 Future LMS Support

Canvas, Schoology, and Microsoft Teams for Education are reserved as future targets. Their support is enabled by:

- the vendor-neutral core (see §2),
- the `lmsProviders` closed set (see §3.3),
- the identity abstraction preserved by PDR-002 (a second identity provider ships alongside a non-Google LMS if the LMS's identity model requires it, but is not a prerequisite for reading an LMS the teacher has already authenticated against).

A second LMS becomes a documented commitment only when the reconsideration criteria in PDR-015 are met: a school with documented need adopts LyfeLabz and provisions classrooms in that LMS.

### 4.3 Out-of-Scope LMS Systems

Learning management systems that do not fit the target market (higher-education-only systems, corporate LMSes, MOOC platforms) are not on the roadmap. The absence of a system from the future list is a statement, not an oversight.

---

## 5. Authentication and OAuth Philosophy

### 5.1 OAuth is Not Identity

The LMS's OAuth grant authorizes LyfeLabz to act on the teacher's behalf against the LMS. It does not authenticate the teacher to LyfeLabz. The teacher's LyfeLabz identity remains established by Google Sign-In through Firebase Authentication per PDR-002.

A teacher signs into LyfeLabz once. Later, she opts into a specific LMS by granting a specific set of scopes. The two events are architecturally separate and remain separate for every future LMS.

### 5.2 Incremental Authorization

LMS OAuth scopes are requested incrementally. LyfeLabz never asks for the union of every scope it might ever need. The first scope requested is the minimum required to list the teacher's classes and inspect a class's roster. Additional scopes are requested only when the teacher initiates a workflow that requires them (for example, publishing an assignment).

Incremental authorization is preserved for Google Classroom by aligning with Google's incremental scope model. Where a second LMS supports incremental authorization, LyfeLabz uses it. Where a second LMS does not, the scope request is a documented, teacher-visible decision at connection time.

### 5.3 Token Lifecycle

OAuth access tokens and refresh tokens are held server-side. They are never sent to the client. They are never stored in a Firestore document readable by the client. Their storage location, encryption posture, and rotation cadence are Cloud Function Charter concerns amended by `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`.

Tokens are scoped per teacher, per LMS provider. A teacher who signs into two LMS providers holds two connections and two token sets. A teacher who connects two Google accounts to a single provider holds two connections (see §7).

Refresh is performed by the server, on demand, when a callable requires a live token. Refresh is not scheduled speculatively. A token that is not needed is not refreshed.

Revocation is honored immediately. If the LMS returns an authorization error, the connection is marked `revoked` in `lmsConnections`, the affected class links are marked `stale`, and the teacher sees a clear message in the Teacher Workspace on next visit.

### 5.4 Server Trust Boundary

The server holds the LMS trust. Every LMS API call originates in a Cloud Function that:

- validates the calling teacher's session against the Canonical Session Object,
- resolves the teacher's `lmsConnections` document,
- refreshes the token if required,
- calls the LMS with the minimum scope necessary,
- writes any resulting mirror update inside the same Firestore transaction (or an idempotent equivalent) that closes the callable,
- writes an `auditEvents` record for every consequential operation per PDR-013.

### 5.5 Client Trust Boundary

The client observes mirror records under the ordinary Firestore Security Model. The client displays the connection state, the imported class list, and the linked LMS state visible on the assignment dialog. The client never:

- holds an OAuth token,
- signs a request to the LMS,
- computes an LMS API URL from an unvalidated Firestore field,
- reads private LMS state that the server has not already scoped down and written to the mirror.

---

## 6. Callable Architecture

LMS integration follows the Cloud Function Charter's boring-function philosophy. The intended callable surface is small, single-purpose, and idempotent. Exact callable names are set by the sprint specification for the integration phase. This document reserves conceptual slots only.

- **Connection callables.** Begin OAuth, complete OAuth, describe an existing connection, disconnect a connection.
- **Discovery callables.** List classes the teacher can import from an active connection.
- **Import callables.** Import a specific LMS class into a new or existing LyfeLabz class record.
- **Refresh callables.** Refresh a linked class's roster from the LMS.
- **Publication callables.** Publish a LyfeLabz assignment to a linked LMS class.
- **Revocation callables.** Handle server-observed revocation events and reflect them in the mirror.

Every callable is written under the canonical `writeAuditEvent` helper. Every callable operates only for an `active` teacher. Every callable is idempotent under the Sprint 2 helper contract.

---

## 7. Synchronization Philosophy

### 7.1 Manual Import is the Default

The first synchronization mode is a manual, teacher-initiated import. A teacher opts into an LMS, sees the list of classes she teaches in that LMS, and chooses which to import. A class becomes a LyfeLabz class only after an explicit teacher action.

Manual import is the default because it preserves teacher control, because it makes the mirror's state easy to reason about, and because it aligns with PDR-005's rule that a teacher owns her classes. A silent import of every class the LMS returns would be a violation of teacher trust even if the technical mirror was correct.

### 7.2 Refresh Is Also Manual, at First

A linked class is refreshed on teacher demand. A "Refresh from Google Classroom" affordance appears on the class detail view when the class carries an active `lmsClassLinks` record. Refresh reads the current LMS roster, reconciles it against the current LyfeLabz enrollments, and produces a small, reversible set of proposed changes for teacher review.

Automatic synchronization is a future capability. It is not the default. When it ships, it is opt-in per class, reversible, rate-limited, and always accompanied by an audit event stream the teacher can review.

### 7.3 Assignment Publication Is One-Way

LyfeLabz publishes assignments to the LMS. The LMS never authors a LyfeLabz assignment. This is a load-bearing decision, not a temporary limitation. It preserves PDR-010 (LyfeLabz owns the shape of a LyfeLabz assignment) and it prevents a class of surprising two-way write failures at the edge of a live classroom.

Publication is a teacher gesture inside the Assign Experience. It is not the default. A teacher can create a LyfeLabz assignment without publishing it. A teacher can publish an assignment to more than one target (LyfeLabz and Google Classroom) as long as each target is an active, teacher-authorized destination.

The LMS assignment record produced by publication is a pointer, in the LMS, to the LyfeLabz surface where the actual work happens. LyfeLabz does not attempt to duplicate its instructional experience inside the LMS.

### 7.4 Roster Philosophy

The LMS roster is authoritative. The LyfeLabz roster for a linked class is a mirror. When the LMS says a student is enrolled, the mirror records an active enrollment. When the LMS says a student has been removed, the mirror marks the enrollment `withdrawn` under the certified enrollment vocabulary (`active`, `transferred`, `withdrawn`, `archived`). No enrollment record is ever hard-deleted by a refresh; the certified archival principle stands.

A student who exists in the LMS roster but has not yet signed into LyfeLabz produces a placeholder enrollment. The placeholder resolves to a real enrollment on the student's first authenticated sign-in that matches the LMS identifier. Placeholder enrollments carry no per-student PII beyond what LyfeLabz needs to reconcile the sign-in.

### 7.5 Enrollment Philosophy

Enrollments in a linked class are established through the LMS-fed path, not through the join-code path. This is per PDR-015's requirement that enrollment be a source-aware operation. A class may not simultaneously accept LMS-fed enrollments and join-code enrollments; a class is either linked or not. Attempting to redeem a join code against a linked class is refused by the server with a clear error message.

A class can be unlinked. Unlinking clears the `lmsClassLinks` record, retains the historical mirror as an audit trail, and returns the class to the join-code enrollment path. Unlinking does not delete a single enrollment record.

---

## 8. Failure Handling

Failure is not an edge case; it is a routine event that the LMS integration handles boringly.

- **Token expiry.** The server refreshes the token. If refresh fails, the connection is marked `revoked` and the teacher is prompted to reconnect on next visit.
- **Class archived in the LMS.** The linked LyfeLabz class continues to exist and remains readable. Refresh is disabled. The teacher can unlink or archive the LyfeLabz class independently.
- **Class deleted in the LMS.** The link is marked `broken`. The LyfeLabz class remains, with a clear indicator that the upstream is gone. Submissions and assignments are not destroyed.
- **Student removed from the LMS roster.** The mirrored enrollment transitions to `withdrawn`. Historical submissions are preserved per PDR-005 and PDR-011.
- **Duplicate import.** A class already linked to an LMS class cannot be linked to the same LMS class twice. A teacher who attempts to import an already-linked class is shown the existing link.
- **Simultaneous connections.** A teacher who reconnects an already-connected provider replaces the existing connection's token set; existing links are preserved.
- **LMS outage.** The Teacher Workspace continues to render. Curriculum, Assign, Classes, Present Mode, and Snapshot remain available. Only LMS-scoped affordances degrade, with a clear message.
- **LMS API-shape drift.** Adapter code isolates the drift; the platform surface remains stable.

Every failure produces an `auditEvents` record. Silent failure is prohibited per PDR-013.

---

## 9. Offline, Performance, Security, and Privacy Expectations

### 9.1 Offline

The instructional repository must remain offline-capable per the Cloud Function Charter §1. No LMS integration is placed in the critical path of lesson rendering, navigation, Present Mode, or Practice Mode. If a class is linked to an LMS that is unreachable, students continue to see LyfeLabz-scoped assignment state; the LMS-scoped surface degrades separately.

### 9.2 Performance

LMS calls are server-side and are not in the critical path of an authenticated page load. A teacher's Curriculum landing page renders without contacting the LMS. Refresh, import, and publication are teacher-initiated actions with clear progress indicators. Long LMS calls are handled asynchronously; the client never blocks a page render on an LMS round trip.

### 9.3 Security

Every LMS interaction is subject to the Firebase Security Model. OAuth tokens are server-only. Mirrored records are subject to the same class-scoping rules as their upstream LyfeLabz records. A teacher cannot read another teacher's mirror; a student cannot read the mirror.

Rate limits for LMS callables follow PDR-012's rate-limit posture. Concrete numbers are set by the Cloud Function Charter amendment recommended in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`.

### 9.4 Privacy

PDR-011 governs what LyfeLabz collects. LMS integration does not widen the collection surface. The following information is never copied into LyfeLabz from the LMS:

- guardian contact information,
- grade-book grades computed by the LMS or the SIS,
- disciplinary records,
- attendance records,
- non-LyfeLabz assignment submissions or feedback,
- teacher notes authored inside the LMS,
- announcements and comments authored in the LMS.

LMS-provided student names and school-provided email addresses are already within the LyfeLabz collection surface under PDR-011 and are copied only where necessary to reconcile the mirror.

---

## 10. Scalability and Future Extensibility

### 10.1 Scalability

LMS integration is a small write path relative to the certified submission pipeline. Mirror records are small, queries scoped to a single teacher or a single class, and refreshes rate-limited per teacher. The integration does not fan out across all classes on a schedule; it operates only on classes the teacher has explicitly opened.

### 10.2 Future Extensibility

- **Additional LMS providers.** Adding a second provider extends the `lmsProviders` closed set and adds a second adapter. It does not touch the certified domains.
- **Automatic synchronization.** Opt-in automatic refresh is a future capability. Its architecture ships as an amendment to this document.
- **Bidirectional publication.** LyfeLabz reading LMS-authored assignments is deliberately not on the roadmap and would require a formal decision record; it does not become negotiable through implementation.
- **District rollup.** Sprint 9C (PDR-023c) promoted `districtId` to a first-class security boundary and Sprint 10A F-1 records the implementation contract in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` under PDR-025. LMS integration does not itself assign `districtId`; the identity family that owns the caller assigns it. LMS classes and roster links inherit their district ownership from the school that owns the class.
- **SIS integration.** PowerSchool and equivalent SIS integrations are governed by TEACHER_EXPERIENCE_PHILOSOPHY §4.7 and remain a separate architecture pass. This document does not authorize them.

---

## 10.3 Operational Readiness

The initial LMS scope authorized by PDR-020c depends on the following operational capabilities being in place before the first implementation sprint begins. Each is a documented commitment rather than an implementation artifact; the sprint that lands the initial scope may not begin until each is recorded as satisfied. The canonical operational procedures that implement the commitments in this section are recorded in `LMS_INTEGRATION_OPERATIONS.md`; this section names the commitments, and the operational runbook names the procedures.

### 10.3.1 OAuth Provisioning Checklist

- A Google Cloud project OAuth client is provisioned under LyfeLabz operational ownership. The client is dedicated to LMS integration and is separate from any client used by Firebase Authentication under PDR-002.
- The client's authorized redirect URIs are limited to the server-side callback endpoint owned by the Cloud Function Charter. No client-side redirect URI is registered.
- The client's default consent screen is configured in Testing mode until the integration is exercised end-to-end under the Emulator Suite, and is promoted to Production only after the first implementation sprint certifies.
- The client's requested scopes reflect the incremental authorization posture in §5.2. The initial scope requests the minimum required to list a teacher's classes and inspect a class's roster. Additional scopes are added by the sprint that owns the workflow requiring them.
- Client credentials (client ID and client secret) are recorded in the operational secret manager under access controls consistent with PDR-012. Neither credential is committed to the repository, exposed to the client bundle, or written to a Firestore document readable by any role.

### 10.3.2 Google Cloud Project Ownership

- The Google Cloud project holding the OAuth client is owned by LyfeLabz operations. Ownership is documented in the operational runbook alongside the Firebase project ownership.
- Access to the project is restricted to the operational owner and to a documented on-call substitute. Access grants and revocations are audit-logged in the operational runbook.
- Project-level roles are set at the minimum required for OAuth client administration. No project-level role grants access to student or teacher data in LyfeLabz.

### 10.3.3 Secret Management Expectations

- OAuth client credentials, per-teacher access tokens, and per-teacher refresh tokens are held server-side only, per PDR-019e.
- Secret storage location, encryption posture, and rotation cadence are Cloud Function Charter concerns. Concrete storage is set by the Cloud Function Charter's operational appendix; this document establishes only that server-only holding is non-negotiable.
- Rotation of OAuth client credentials is a documented operational procedure. Rotation invalidates outstanding tokens and produces a teacher-visible re-authorization prompt on next visit.
- Revocation of an individual teacher's tokens is a documented operational procedure. It marks the affected `lmsConnections` record `revoked` and produces the failure-state behavior in §8.

### 10.3.4 Disaster Recovery Additions

- The additive Firestore collections named in §3.3 (`lmsProviders`, `lmsConnections`, and, when populated by later scope, `lmsClassLinks`, `lmsRosterLinks`, `lmsAssignmentPublications`) fall under the certified Firestore backup and DR posture established by PDR-013.
- The DR runbook is extended to name these collections explicitly and to record that restoring an `lmsConnections` document does not restore the underlying OAuth tokens. Tokens are held in the operational secret manager and follow its own DR posture.
- A restore that recovers a `lmsConnections` document without a matching valid token produces the `revoked` failure-state behavior in §8. The teacher sees a plain-language reconnection prompt.

### 10.3.5 Provider Testing Strategy

- Every LMS provider adapter is tested in isolation against a provider-specific test double. The Google Classroom adapter is tested against a Google Classroom API test double.
- The vendor-neutral core is tested against a synthetic in-memory provider that satisfies the provider abstraction without invoking a real network round trip.
- Regression protection covers the connection lifecycle, the discovery path, and the import path for the initial scope. Additional test coverage lands with the sprint that owns the corresponding capability.

### 10.3.6 API Emulator Strategy

- The initial scope is exercised end-to-end under the Emulator Suite. The Google Classroom API is not part of the Emulator Suite; a documented test double or an authorized test instance provides the equivalent surface.
- The test double records the shape of the Google Classroom API calls the adapter performs. Its fixtures are checked into the repository and reviewed as part of the sprint that lands the initial scope.
- An authorized Google Workspace for Education test instance may be used for pre-release validation of the initial scope. Its use is documented, its identifiers are recorded, and no production teacher or student data is copied into it.

### 10.3.7 Ownership Verification Strategy

- The importing teacher must be the teacher of record for the LMS class at import time. Ownership is verified server-side against the LMS at import time, per §12 ("How should teacher ownership be validated?").
- Ownership drift after import produces the `lms.ownershipDrift` audit event and the failure-state behavior in PDR-019j. LyfeLabz never silently reassigns class ownership in response to an LMS change.
- The initial scope does not implement re-verification on refresh (refresh is out of the initial scope). Re-verification lands with the sprint that owns the refresh workflow.

### 10.3.8 Incremental Authorization Strategy

- OAuth scopes are requested incrementally per §5.2. The initial scope requests the minimum required to list a teacher's classes and inspect a class's roster.
- Scopes required by excluded capabilities (roster synchronization, publication, refresh) are not requested by the initial scope. They are added by the sprint that owns the workflow requiring them.
- The teacher sees a scope-scoped consent prompt at connection time. She does not see a prompt for scopes that are not required by the initial scope.
- The incremental posture is preserved for every future provider. Where a second LMS does not support incremental authorization, the scope request is a documented, teacher-visible decision at connection time.

### 10.3.9 Readiness Gate

The initial scope may not begin implementation until §10.3.1 through §10.3.8 are each recorded as satisfied in the sprint specification for that scope. Recording is documentation-only; each item names the operational artifact that satisfies it. The absence of any item is a gating defect for the initial scope. The operational procedures that discharge each commitment are recorded in `LMS_INTEGRATION_OPERATIONS.md` §16 (Operational Readiness Summary), which maps each subsection above to the runbook section that satisfies it.

---

## 11. Current, Future, and Out-of-Scope Architecture

To keep this document readable at a glance, the following separation applies.

### 11.1 Current Architecture

The initial scope authorized by PDR-020c is current architecture. It contains provider abstraction, provider registry, connection lifecycle, secure infrastructure, class discovery, and class import. Implementation is authorized under Phase 9 as advanced ahead of Phase 8 by PDR-020b. The remainder of the surface described in §3 through §9 is future architecture reachable through subsequent sprints under the internal Phase 9 sequence in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` §8.

### 11.2 Future Architecture

The following capabilities are described in §3 through §9 but are not authorized by PDR-020c. Each is future architecture reachable through its own subsequent sprint under the internal Phase 9 sequence:

- roster synchronization,
- assignment publication,
- assignment refresh,
- grade synchronization,
- automatic synchronization,
- background jobs,
- webhooks,
- Google Drive integration,
- Gmail integration,
- Calendar integration,
- second-provider adapters (Canvas, Schoology, Microsoft Teams for Education),
- SIS integration,
- district rollup.

Each capability retains the shape described in §3 through §9. Its addition to the shipped surface requires its own sprint specification. Expansion by implementation is prohibited under PDR-020c.

### 11.3 Out-of-Scope Architecture

The following are explicitly out of scope for LMS integration, permanently or until a separate decision record redefines them:

- LMS integration as an identity provider for LyfeLabz.
- LMS-authored LyfeLabz assignments (bidirectional publication).
- LMS grade export as an authoritative LyfeLabz surface.
- LMS-driven curation of the LyfeLabz curriculum.
- LMS-fed replacement of the LyfeLabz Practice Mode or Classroom Mode contract.
- Any LMS surface that would require Present Mode to load Firebase SDKs.
- Any LMS surface that would require a new user role, a new custom claim key, or a new lifecycle field.

---

## 12. Resolved Questions

The following architectural questions are answered by this document.

- **Should imports be one-time or refreshable?** Refreshable. The first refresh is manual; automatic refresh is a future extension.
- **Should synchronization ever become automatic?** Yes, as an opt-in, reversible extension. It is not the default.
- **Should assignment publication be one-way?** Yes. LyfeLabz publishes to the LMS. The LMS never authors a LyfeLabz assignment.
- **How should conflicts be resolved?** The LMS is authoritative for classroom identity, teacher ownership, and roster. LyfeLabz is authoritative for LyfeLabz assignments, Practice/Classroom mode, and every learning interaction.
- **How should archived classes behave?** The LyfeLabz class continues to exist and remains readable. Refresh is disabled.
- **How should deleted classes behave?** The link is marked broken. Historical LyfeLabz data is preserved.
- **How should teacher ownership be validated?** The importing teacher must be the teacher of record for the LMS class. Ownership is verified server-side against the LMS at import time and re-verified on refresh.
- **How should multiple LMS providers coexist?** A teacher may hold at most one active connection per provider. A class may be linked to at most one LMS provider at a time.
- **How should OAuth scopes evolve over time?** Incrementally, requested only when the teacher initiates a workflow that requires them.
- **What information should never be copied into LyfeLabz?** The list in §9.4.

---

## 13. Non-Goals

This document does not:

- authorize implementation beyond the initial scope named in PDR-020c,
- schedule any sprint beyond the one that lands the initial scope,
- ratify amendments to any certified document (the amendments recommended by `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` have been ratified separately through PDR-019 and PDR-020),
- introduce a new role, claim, or lifecycle field,
- redefine any PDR,
- describe the visual design of any surface (that is the job of `LMS_EXPERIENCE.md`),
- authorize a second identity provider or a second LMS.

---

*End of architecture. LMS integration is now a scheduled capability under Phase 9 (LMS Integration Foundation). This document defines its shape. Implementation of the initial scope named in PDR-020c is authorized. Every capability beyond the initial scope remains reachable-but-deferred and requires its own subsequent sprint specification.*
