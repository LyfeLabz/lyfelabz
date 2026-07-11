# LMS Integration Architecture Amendment

Status: Ratified. The amendments in §3 have been accepted into the certified architecture. PDR-019 records the load-bearing posture; PDR-020 authorizes the initial implementation scope and advances Phase 9 (LMS Integration Foundation) ahead of Phase 8 (Administrator Platform) for that scope. Implementation of the initial scope is authorized subject to §7.
Companion documents: LMS_INTEGRATION_ARCHITECTURE.md, LMS_INTEGRATION_OPERATIONS.md, LMS_EXPERIENCE.md, LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_PLATFORM_DECISIONS.md, LYFELABZ_FIRESTORE_DATA_MODEL.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, PLATFORM_CONTRACTS.md, TEACHER_PLATFORM_DOMAIN_ROADMAP.md, TEACHER_EXPERIENCE_PHILOSOPHY.md, TEACHER_JOURNEY.md, ASSIGN_EXPERIENCE.md, CLASS_SNAPSHOT_EXPERIENCE.md, SNAPSHOT_ARCHITECTURE.md.

This document proposes the exact amendments the certified platform architecture must accept before an LMS integration sprint can be scheduled. It does not modify any certified document. It is a set of recommendations, sequenced and risk-assessed, produced under the same architecture-first discipline that produced Sprints 1 through 6.

Nothing in this document authorizes implementation. Nothing here overrides a certified decision. Every recommendation defers to `LYFELABZ_PLATFORM_ARCHITECTURE.md` and `LYFELABZ_PLATFORM_DECISIONS.md` in every case of conflict.

---

## 1. Why This Amendment Exists

During Sprint 7 planning, Google Classroom import was proposed as an implementation sprint. The certified architecture correctly rejected the proposal because `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` §3.9 explicitly places every LMS integration inside Future Extensions and because PDR-015 records LMS integrations as reachable-but-deferred capabilities that ship only against documented demand.

That rejection was correct. Bypassing the architecture to add Google Classroom import would have violated the "architecture before implementation" principle and the Cloud Function Charter's scoping discipline. It would have introduced a large new capability without the review the certified architecture requires.

The correct response is to reconcile the certified architecture with the long-term product philosophy that LyfeLabz complements existing learning management systems rather than replacing them (PDR-018a, TEACHER_EXPERIENCE_PHILOSOPHY §2, §4.7). That reconciliation is the purpose of this document.

The reconciliation is small in principle and large in scope. In principle, LMS integration is a straightforward extension of certified domains. In scope, it touches roadmap ordering, the Firestore Data Model, the Firebase Security Model, the Cloud Function Charter, the Platform Contracts, and several teacher-facing product documents. Ratifying the amendments in the wrong order would introduce silent contradictions.

---

## 2. Documents Requiring Amendment

The following certified documents require amendment before an LMS integration sprint can be scheduled. Each amendment is described conceptually; the exact wording is authored during the amendment sprint.

1. `TEACHER_PLATFORM_DOMAIN_ROADMAP.md`
2. `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-015; possible new PDR)
3. `LYFELABZ_FIREBASE_SECURITY_MODEL.md`
4. `LYFELABZ_FIRESTORE_DATA_MODEL.md`
5. `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
6. `PLATFORM_CONTRACTS.md`
7. `TEACHER_EXPERIENCE_PHILOSOPHY.md`
8. `TEACHER_JOURNEY.md`
9. `ASSIGN_EXPERIENCE.md`
10. `SNAPSHOT_ARCHITECTURE.md` and `CLASS_SNAPSHOT_EXPERIENCE.md`

Documents that do not require amendment:

- `LYFELABZ_PLATFORM_ARCHITECTURE.md` (§13 already lists Google Classroom and Canvas Integration as anticipated future capabilities; no new principle is introduced).
- `PLATFORM_STATE_MACHINE.md` (no new lifecycle field is proposed).
- `PRESENT_MODE_ARCHITECTURE.md` (LMS integration explicitly does not touch Present Mode).

---

## 3. Recommended Amendments

### 3.1 Roadmap Amendment

**Document:** `TEACHER_PLATFORM_DOMAIN_ROADMAP.md`.

**Recommendation.** Introduce an explicit LMS Integration phase in Section 4, positioned after Phase 8 (Administrator Platform), and identified as a Future Extensions phase per §3.9. The phase is not renumbered into the certified sequential chain; it is a named future phase that is scheduled only when its predecessor phases are certified and a documented school need exists (PDR-015).

The recommended phase description:

- **Objectives.** Deliver vendor-neutral LMS integration as described in `LMS_INTEGRATION_ARCHITECTURE.md`. Google Classroom is the initial provider.
- **Deliverables.** OAuth flow, `lmsConnections`, `lmsClassLinks`, `lmsRosterLinks`, `lmsAssignmentPublications` collections; server-only token storage; teacher-facing Integrations surface inside Settings; extension of the Assign Experience to include optional publication to a linked LMS; refresh workflow on linked classes.
- **Exit criteria.** A verified teacher can connect Google Classroom, import a class, refresh a class, publish an assignment, and disconnect the integration, all under the Emulator Suite and with a documented offline-friendly degradation posture.
- **Explicit non-goals.** Second LMS provider; automatic synchronization; bidirectional publication; LMS grade export; SIS integration; district rollup.

**Rationale.** Naming the phase in the roadmap prevents future sprints from inventing an ad hoc LMS scope. It also makes the deferred status explicit: the phase is defined but not scheduled.

**Sequencing.** The phase depends on the Assignment Foundation (Phase 5), the Submission Foundation (Phase 6), and the completion of Sprint 6-series teacher-workspace surfaces. It does not require Analytics (Phase 7) or Administrator Platform (Phase 8) to complete, but it is scheduled after both to avoid concurrent domain churn.

### 3.2 Decision Log Amendment

**Document:** `LYFELABZ_PLATFORM_DECISIONS.md`.

**Recommendation.** Amend PDR-015 in place to move Google Classroom integration from "reconsidered when demand is documented" to "reconsidered when demand is documented and the architecture described in `LMS_INTEGRATION_ARCHITECTURE.md` is ratified." No change to the enabling decision; a pointer to the new canonical architecture.

**Recommendation (secondary).** Add PDR-019, "LMS Integration Posture," recording:

- LyfeLabz complements the LMS and never replaces it (this is PDR-018a extended into the integration surface).
- The LMS is authoritative for classroom identity, teacher ownership, and roster.
- LyfeLabz is authoritative for LyfeLabz assignments, Practice/Classroom mode, and every learning interaction.
- Manual import and manual refresh are the Version 1 posture; automatic synchronization is a deferred, opt-in extension.
- Assignment publication is one-way: LyfeLabz publishes to the LMS; the LMS never authors a LyfeLabz assignment.
- OAuth tokens are held server-side only; the client never holds an LMS token.
- No new user role, no new custom claim key, and no new lifecycle field is introduced by LMS integration.

**Rationale.** A dedicated PDR closes a class of drift attempts: "the integration is different, so PDR-X does not apply." Every rule the integration inherits from PDR-004, PDR-005, PDR-010, PDR-011, PDR-012, PDR-015, and PDR-018 is re-anchored in a single record so a future contributor cannot claim ambiguity.

**Reconsideration criteria for PDR-019.** Reconsidered only if the mission definition in PDR-001 or PDR-018a is redefined by the platform's owners.

### 3.3 Security Model Amendment

**Document:** `LYFELABZ_FIREBASE_SECURITY_MODEL.md`.

**Recommendation.** Add a new trust boundary section covering "External LMS Providers." The section records:

- The LMS is an external system. It is never trusted to make security decisions inside LyfeLabz.
- OAuth tokens are server-only artifacts. Their storage location is a Cloud Function Charter concern; their read boundary is server-only.
- Clients cannot read `lmsConnections` token fields. The mirror record's token field is not readable by any role, including Platform Administrator, without an audited elevation.
- `lmsClassLinks` and `lmsRosterLinks` are readable only by the teacher of the linked class and by the enrolled student, in the same scoping as the underlying certified records.
- `lmsAssignmentPublications` is readable only by the teacher who initiated the publication and by Platform Administrator under audit.
- No LMS integration record is readable by an unauthenticated visitor.

**Additional recommendation.** Extend the audit vocabulary with LMS-scoped event kinds: `lms.connectionCreated`, `lms.connectionRevoked`, `lms.classImported`, `lms.classRefreshed`, `lms.classUnlinked`, `lms.assignmentPublished`, `lms.publishFailed`, `lms.ownershipDrift`. Every event follows the append-only invariant per PDR-013.

### 3.4 Firestore Data Model Amendment

**Document:** `LYFELABZ_FIRESTORE_DATA_MODEL.md`.

**Recommendation.** Add the collections named in `LMS_INTEGRATION_ARCHITECTURE.md` §3.3: `lmsProviders`, `lmsConnections`, `lmsClassLinks`, `lmsRosterLinks`, `lmsAssignmentPublications`. Each collection follows the certified conventions:

- stable identifier at the document root,
- creation and update timestamps,
- explicit `ownerUid` and `schoolId` denormalization for security-rule performance,
- server-set timestamps,
- additive schema evolution.

Fields added to certified collections are strictly additive:

- `classes/{classId}` receives an optional `lmsProviderRef` field and an optional `enrollmentSource` field with the values `joinCode` (default) or `lms`. No existing field is renamed.
- `enrollments/{enrollmentId}` receives an optional `lmsRosterRef` field. No existing field is renamed.
- `assignments/{assignmentId}` receives an optional `lmsPublicationRef` field. No existing field is renamed.

Every additive field respects the "additive schema evolution" foundational decision. No destructive migration is required.

**Additional recommendation.** Establish that mirror records are subordinate to the certified records they mirror. A garbage-collection contract is documented: unlinking a class marks the mirror records `unlinked` and preserves them; deleting a class (an administrative operation) cascades to the mirror through a server-only path.

### 3.5 Cloud Function Charter Amendment

**Document:** `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`.

**Recommendation.** Add to Section 2 (Responsibilities of Cloud Functions) the following server responsibilities:

- LMS OAuth initiation and completion.
- LMS token storage, refresh, and revocation handling.
- LMS class discovery and roster read.
- LMS class import, refresh, and unlink.
- LyfeLabz-to-LMS assignment publication.
- LMS revocation and ownership-drift handling.

**Additional recommendation.** Add an "External Integrations" subsection to Section 1 that records:

- LMS integration is a first-class case of the "client is never authoritative" principle.
- LMS tokens are never sent to the client.
- LMS integration is never in the critical path of lesson rendering, navigation, Practice Mode, or Classroom Mode finalization.
- LMS integration is never in the critical path of Present Mode.

**Rate-limit recommendation.** Add LMS-scoped rate-limit defaults consistent with PDR-012's rate-limit posture:

- LMS discovery calls: bounded per teacher per minute.
- LMS import calls: bounded per teacher per hour.
- LMS refresh calls: bounded per class per hour.
- LMS publication calls: aligned with existing assignment publication rate limits.

Concrete numbers are set by the Cloud Function Charter amendment.

### 3.6 Platform Contracts Amendment

**Document:** `PLATFORM_CONTRACTS.md`.

**Recommendation.** Add the following contracts to Section 12 (Certified Contract Registry) once the amendment is ratified:

- **LMS integration surface identifier.** `settings/integrations` under the workspace-surface identifier convention of §7. Certified once the surface ships.
- **LMS provider namespace.** `lmsProviders` closed set with initial value `googleClassroom`. Additional providers require an amendment.
- **LMS mirror record ownership convention.** Every mirror record carries an `ownerUid` denormalization to preserve rule-evaluation performance.

**Additional recommendation.** Add to Section 5 (Browser Storage Contracts) an explicit prohibition: LMS OAuth tokens, refresh tokens, discovery results, roster snapshots, and mirror records must not be persisted in `localStorage`, `sessionStorage`, cookies, URL query parameters, or URL fragments. This is a restatement of the certified storage posture applied to the new domain.

### 3.7 Teacher Journey Implications

**Document:** `TEACHER_JOURNEY.md`.

**Recommendation.** Add a moment describing the "opting-in" teacher who visits Settings, connects Google Classroom, and imports a class. The moment is small, in keeping with the Journey's philosophy that a feature must locate itself inside a real moment in a teacher's day. The moment does not restructure the Journey's preparation-teach-move-on rhythm.

**Additional recommendation.** Clarify in §5 (Between classes) that Snapshot never displays LMS state. LMS state is a Settings concern, not a between-moments concern.

### 3.8 Teacher Experience Implications

**Document:** `TEACHER_EXPERIENCE_PHILOSOPHY.md`.

**Recommendation.** Extend §3.5 (Contextual assignment workflow) with a subordinate note: the LMS-linked class row in the Assignment Dialog carries a Google Classroom topic selector and a publication toggle when the class is LMS-linked. The dialog remains one dialog per the Assign Experience.

**Additional recommendation.** Extend §4.7 (Google Classroom and PowerSchool responsibilities) with a pointer to `LMS_INTEGRATION_ARCHITECTURE.md`. Preserve the certified statement that no integration ships in the current sprint sequence.

### 3.9 Assignment Experience Implications

**Document:** `ASSIGN_EXPERIENCE.md`.

**Recommendation.** Extend the class-row description with the LMS-linked row shape (topic selector, publication toggle). The extension is additive; the one-dialog rule is preserved.

**Additional recommendation.** Add a subsection describing the confirmation surface for LMS-side publication outcomes. Confirmation reads: "The LyfeLabz assignment was scheduled. Publishing to Google Classroom [succeeded / did not succeed]." The LyfeLabz assignment is authoritative. Publication is a side effect.

### 3.10 Snapshot Implications

**Documents:** `SNAPSHOT_ARCHITECTURE.md` and `CLASS_SNAPSHOT_EXPERIENCE.md`.

**Recommendation.** No functional change is required. Snapshot does not display LMS state. The Snapshot architecture reads certified enrollment and assignment records; those records include the additive `lmsRosterRef` and `lmsPublicationRef` fields but Snapshot does not render them.

The Snapshot documents should be extended with a single sentence recording that LMS state is not a Snapshot concern. This preserves the "preparation before analytics" and "informs, does not act" principles.

---

## 4. Migration Strategy

The migration is small because every schema change is additive.

- Existing `classes/{classId}` records receive default `enrollmentSource: "joinCode"` and no `lmsProviderRef` value.
- Existing `enrollments/{enrollmentId}` records receive no `lmsRosterRef` value.
- Existing `assignments/{assignmentId}` records receive no `lmsPublicationRef` value.
- Existing teachers have no `lmsConnections` document.
- No existing document is renamed, restructured, or relocated.

The migration is a deploy of amended documents and code. It requires no data movement.

Reversibility: if the LMS integration phase is abandoned after ratification, the additive fields remain in the schema but carry no data. Removing them (a destructive change) is not required.

---

## 5. Backward Compatibility

Backward compatibility is preserved across every certified surface.

- Teachers who do not connect an LMS see no change to any workflow.
- Students see no change to any workflow.
- Join-code enrollment continues to be the default enrollment source.
- Snapshot, Present Mode, and Curriculum surfaces render unchanged.
- The Cloud Function Charter's canonical `writeCustomClaims` and `writeAuditEvent` helpers are unchanged. The claims shape is unchanged.
- The Canonical Session Object is unchanged.
- The Firestore Rules governing existing collections are amended only to permit reads and writes on the new fields under the same class-scoping principles.

A teacher who imports a class through the LMS may not use join codes for that class. This is a designed constraint recorded in PDR-019 (§3.2) and is not a backward-compatibility break for prior classes.

---

## 6. Risk Analysis

### 6.1 Identity Risks

- **Confusion between Google Sign-In and Google Classroom OAuth.** Mitigation: the LMS Experience explicitly separates the two events. The `LMS_EXPERIENCE.md` copy is authored to prevent conflation. A teacher must sign into LyfeLabz with her school email before Google Classroom OAuth is offered.
- **Personal-account misconnection.** Mitigation: the Integrations surface refuses to complete a Google Classroom OAuth grant unless the Google identity used matches the LyfeLabz identity.

### 6.2 Security Risks

- **Token leakage.** Mitigation: tokens are server-only, never sent to the client, never written to a client-readable Firestore field. Rotation is server-mediated.
- **Overbroad scope grants.** Mitigation: incremental authorization; the initial scope is minimum-required.
- **Session token reuse.** Mitigation: every LMS callable revalidates the Canonical Session Object.

### 6.3 Privacy Risks

- **Unnecessary PII import.** Mitigation: the explicit exclusion list in `LMS_INTEGRATION_ARCHITECTURE.md` §9.4 and `LMS_EXPERIENCE.md` §13.
- **Guardian data drift.** Mitigation: LyfeLabz does not import guardian contact information. Parent accounts remain a separate future capability under PDR-011.
- **Placeholder enrollments carrying LMS-side PII.** Mitigation: placeholders carry only the identifier needed to reconcile the sign-in.

### 6.4 Ownership Risks

- **LMS teacher-of-record change.** Mitigation: LyfeLabz never silently reassigns class ownership. The teacher sees a plain-language message and chooses a next step, including an audited administrative ownership transfer path.
- **Duplicate import.** Mitigation: the Import surface refuses to link the same LMS class twice.

### 6.5 Reliability Risks

- **LMS outage during import or publication.** Mitigation: LyfeLabz-authoritative records are written first. LMS-side failures are surfaced without corrupting LyfeLabz state.
- **Rate-limit exhaustion.** Mitigation: server-side rate limits per teacher and per class; backoff on LMS 429 responses.
- **API-shape drift.** Mitigation: the vendor-neutral core isolates change to the adapter.

### 6.6 Product Drift Risks

- **LMS surface bloat.** Mitigation: PDR-019 records the boundary. Every proposed LMS surface is measured against `LMS_EXPERIENCE.md`.
- **Second Assign workflow.** Mitigation: `ASSIGN_EXPERIENCE.md`'s "one workflow" rule and the amendment in §3.9.
- **Snapshot bloat.** Mitigation: Snapshot's "not a dashboard" rule and the amendment in §3.10.
- **Automatic sync introduced silently.** Mitigation: `LMS_EXPERIENCE.md` §17 records the future posture; the manual-first default is load-bearing.

### 6.7 Operational Risks

- **Support surface expansion.** Mitigation: LMS integration produces `auditEvents` for every consequential operation; support workflows read audit events, not tokens.
- **Backup and restore of mirror records.** Mitigation: mirror records fall under the certified Firestore backup and DR posture (PDR-013).

---

## 7. Implementation Prerequisites

The implementation prerequisites for the initial LMS scope authorized by PDR-020c are listed below, with the current status of each recorded inline. Implementation of the initial scope cannot begin until every prerequisite is satisfied.

1. **[Satisfied]** The amendments in §3 are ratified in their respective certified documents. Ratification is recorded by PDR-019 (LMS Integration Posture) and by the additive updates to `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `PLATFORM_CONTRACTS.md`, and `TEACHER_PLATFORM_DOMAIN_ROADMAP.md`.
2. **[Satisfied]** Phase 5 (Assignment Foundation) is certified complete. The Assignment record shape the LMS integration extends is stable. (The initial scope does not exercise the additive `lmsPublicationRef` field on `assignments/{assignmentId}`; publication remains out of the initial scope.)
3. **[Satisfied]** Phase 6 (Submission Foundation) is certified complete. The Submission record shape and its dependency on the enrollment record are stable. (The initial scope does not exercise refresh; refresh remains out of the initial scope.)
4. **[Satisfied]** A written decision approves the initial provider and the initial scope set. Google Classroom is formally authorized as the initial provider under PDR-020a. The initial scope is named in PDR-020c and consists of provider abstraction, provider registry, connection lifecycle, secure infrastructure, class discovery, and class import. Every excluded capability is enumerated in PDR-020c.
5. **[Operational, in progress]** A Google Cloud project OAuth client is provisioned under LyfeLabz operational ownership, with documented rotation and revocation procedures. The commitments are recorded in `LMS_INTEGRATION_ARCHITECTURE.md` §10.3.1 through §10.3.3. The sprint that lands the initial scope may not begin until the operational artifacts named there are in place.
6. **[Operational, in progress]** A DR update covers the new collections in the Firestore backup and restore posture certified by PDR-013. The commitments are recorded in `LMS_INTEGRATION_ARCHITECTURE.md` §10.3.4. The sprint that lands the initial scope may not begin until the operational artifacts named there are in place.
7. **[Operational, in progress]** An emulator harness covering the Google Classroom API shape is documented, whether by fixtures or by an authorized test instance. The commitments are recorded in `LMS_INTEGRATION_ARCHITECTURE.md` §10.3.5 and §10.3.6. The sprint that lands the initial scope may not begin until the operational artifacts named there are in place.

Prerequisites 1 through 4 are documentation-level and are satisfied by the ratifications recorded above. Prerequisites 5 through 7 are operational and are satisfied by the operational readiness section of `LMS_INTEGRATION_ARCHITECTURE.md`. The sprint that lands the initial scope must record each operational prerequisite as satisfied in its specification before implementation begins. Implementation without any of these is prohibited by this document.

Prerequisites for capabilities beyond the initial scope (refresh, publication, roster synchronization, automatic synchronization, second-provider adapters) remain as originally stated and are re-evaluated by the sprint specification that owns each capability.

---

## 8. Recommended Implementation Sequence

The recommended sequence for the LMS Integration phase, once its prerequisites are met.

**LMS Sprint A - Amendment ratification (documentation-only).** Complete. Ratified through PDR-019 (LMS Integration Posture) and PDR-020 (LMS Phase Re-Sequencing and Initial Scope), and through the additive updates to `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `PLATFORM_CONTRACTS.md`, and `TEACHER_PLATFORM_DOMAIN_ROADMAP.md`.

**LMS Sprint B - Firestore, Rules, and callable scaffolding (initial-scope subset).** Authorized under PDR-020c. Land the additive Firestore fields required by the initial scope (`classes/{classId}.lmsProviderRef`, `classes/{classId}.enrollmentSource`), the initial mirror collections (`lmsProviders`, `lmsConnections`, `lmsClassLinks`), the Firestore Rules covering them, and the callable scaffolding for connection, discovery, and import. The remaining mirror collections (`lmsRosterLinks`, `lmsAssignmentPublications`) remain reserved but are not populated by this sprint. No refresh callable, publication callable, or roster-synchronization callable is landed by this sprint. The scaffolding is exercised end-to-end under the Emulator Suite with a Google Classroom API test double.

**LMS Sprint C - Teacher Integrations surface (initial-scope subset).** Authorized under PDR-020c. Land the Settings > Integrations client surface described in `LMS_EXPERIENCE.md` §3, §4, limited to connection, class discovery, class import, and disconnect. Refresh is not a deliverable of this sprint under PDR-020c; the refresh affordance on the class detail view is deferred to LMS Sprint E.

**LMS Sprint D - Assign Experience extension.** Extend the Assignment Dialog with the LMS-linked class row shape. Publication is user-facing. The one-dialog rule is preserved.

**LMS Sprint E - Refresh workflow completion.** Complete the manual refresh reconciliation surface, the ownership-drift handling, and the broken-link handling. Every message from §14 of `LMS_EXPERIENCE.md` is delivered.

**LMS Sprint F - Certification.** Full end-to-end certification against the certified architecture, including a security review of OAuth handling and a privacy review of the mirror.

Sprints B through F are sequential. No sprint begins until the previous one is certified.

Automatic synchronization, bidirectional publication, LMS grade export, and second-provider support are not on this sequence. Each requires its own amendment.

---

## 9. Roadmap and Sprint-Sequence Summary

The recommended sequence produces the following roadmap picture.

- Phases 2 through 6 (Schools, Teachers, Classrooms, Enrollments, Assignments, Submissions) are certified complete as recorded in `TEACHER_PLATFORM_DOMAIN_ROADMAP.md`.
- LMS Integration is advanced ahead of Phase 8 (Administrator Platform) for the narrow initial scope named in PDR-020c. Phase 7 (Analytics) and Phase 8 (Administrator Platform) remain defined and scheduled as subsequent phases; PDR-020d and PDR-020e establish that neither is a technical prerequisite for the initial LMS scope.
- Google Classroom is the first provider. Canvas, Schoology, and Teams for Education are named-but-deferred second providers.
- Automatic synchronization is deferred inside the LMS phase itself; the first release ships manual import and manual refresh.

Nothing here reorders the certified phase chain. The LMS phase is added as an explicit future phase, not inserted into the middle of the certified sequence.

---

## 10. Validation Notes

This document has been reviewed against every certified architecture document. The following observations were recorded during validation.

- **PDR-001 alignment.** Confirmed. The recommended posture (complement, do not replace) is a restatement of PDR-001 into the integration surface.
- **PDR-004 alignment.** Confirmed. No new role is introduced. No custom claim key is introduced. No lifecycle field is introduced.
- **PDR-005 alignment.** Confirmed. Class ownership remains immutable except through an audited administrative path. Ownership drift produces a teacher-visible message, not a silent reassignment.
- **PDR-007 alignment.** Confirmed. LMS integration does not touch the static instructional repository.
- **PDR-010 alignment.** Confirmed. Assignments remain pointers. The user-facing vocabulary is preserved. Publication is a side effect of the LyfeLabz assignment record, not an alternate assign path.
- **PDR-011 alignment.** Confirmed. The exclusion list in `LMS_INTEGRATION_ARCHITECTURE.md` §9.4 preserves data minimization.
- **PDR-012 alignment.** Confirmed. Every LMS write is server-mediated. Every consequential operation produces an audit record.
- **PDR-013 alignment.** Confirmed. New collections fall under the certified backup, DR, and audit posture.
- **PDR-015 alignment.** Confirmed. This document is the "dedicated integration architecture pass" TEACHER_EXPERIENCE_PHILOSOPHY §4.7 anticipates.
- **PDR-017 alignment.** Confirmed. The vendor-neutral core preserves the one-canonical-way principle; the vendor-specific adapter is a bounded, documented divergence.
- **PDR-018 alignment.** Confirmed. Present Mode is not touched. LyfeLabz does not become an LMS.
- **`PLATFORM_STATE_MACHINE.md` alignment.** Confirmed. No new lifecycle field on `users/{uid}`.
- **`PLATFORM_CONTRACTS.md` alignment.** Confirmed. The public/authenticated separation is preserved. The workspace-surface identifier convention is extended additively.

No conflicts were found. Every recommendation in §3 is additive with respect to the certified architecture. Ratification requires the documentation amendments; no runtime behavior changes on ratification alone.

---

*End of amendment. Recommendations are recorded here so the certified architecture can accept LMS integration through the ordinary decision-record process. Implementation is authorized only after ratification.*
