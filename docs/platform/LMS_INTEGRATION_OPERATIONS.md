# LyfeLabz LMS Integration Operations Runbook

## Sprint 9B Reconciliation Notice

This runbook is subordinate to `PLATFORM_OPERATIONS_SPECIFICATION.md` and PDR-022 for hosting, environments, release pipeline, rollback, maintenance mode, authentication session policy, monitoring, incident response, Pilot Readiness Certification, and GitHub Pages retirement. Where a procedure below implies a hosting posture, an environment name, or a deployment path that conflicts with the operations specification, the operations specification controls. LMS-specific operational obligations (provider identity, token custody, quota management, provider incident handling) extend the operations specification and are unchanged by Sprint 9B.

Status: Operational. This runbook records the procedures Platform Operations follows to bring the LMS integration surface described in `LMS_INTEGRATION_ARCHITECTURE.md` and authorized by PDR-020 into a live, teacher-facing configuration. It is the canonical operational companion to the certified architecture. It ships no product functionality of its own.

Companion documents: `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_PLATFORM_DECISIONS.md`, `PLATFORM_CONTRACTS.md`, `LMS_EXPERIENCE.md`.

This document defers to the certified architecture and decision log in every case of conflict. In particular, it does not restate architectural decisions, does not amend PDR-019 or PDR-020, and does not introduce any capability outside the initial scope authorized by PDR-020c. Every procedure below implements a commitment already recorded in `LMS_INTEGRATION_ARCHITECTURE.md` §10.3.

---

## 1. Purpose

The purpose of this runbook is narrow and load-bearing:

- Give Platform Operations one canonical location for the procedures that stand up the first live Google Classroom connection.
- Record ownership, access, and rotation posture for every operational artifact the initial scope depends on.
- Bridge the certified architecture and the day-to-day operational work of provisioning, seeding, verifying, and rolling out the integration.
- Satisfy the operational prerequisites named in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` §7 items 5 through 7.

Procedures here are operational. They do not modify application code, Cloud Functions, Firestore Rules, the security model, the data model, or any teacher-facing surface. Where a procedure needs a code change to advance, the runbook says so explicitly and defers that change to its own sprint specification.

---

## 2. Operational Ownership

The following table records single-owner accountability for every operational artifact named in this runbook. Ownership is documented in the platform operational runbook alongside the Firebase project ownership per `LMS_INTEGRATION_ARCHITECTURE.md` §10.3.2.

- **Google Cloud project for LMS OAuth.** Operational owner. Documented on-call substitute. Access grants and revocations are audit-logged in the operational runbook.
- **OAuth client credentials.** Operational owner. Secret manager custodian. No credential is committed to the repository, exposed to any client bundle, or written to any Firestore document readable by any role (PDR-019e).
- **Per-teacher access and refresh tokens.** Operational owner in aggregate; every individual token is scoped to the teacher who authorized it. Tokens are held only inside the secret manager. Tokens are never rendered in operational tooling, logs, or dashboards.
- **`lmsProviders` seed data.** Operational owner. Seed operation is idempotent; running it a second time is a no-op.
- **DR and backup posture for LMS collections.** Operational owner. Aligned with the certified Firestore backup and DR posture (PDR-013).
- **Google Classroom test instance.** Operational owner. Identifiers recorded in the operational runbook. No production teacher or student data is copied into it.

Ownership changes require a documented handoff. The successor confirms access to every artifact above before the predecessor stands down.

---

## 3. Google Cloud Project

### 3.1 Project posture

The Google Cloud project that holds the LMS OAuth client is a dedicated project. It is separate from any project used by Firebase Authentication under PDR-002. Separation is a boundary, not a convenience: it keeps identity infrastructure and integration infrastructure independently rotatable and independently revocable.

- The project is named to make its purpose obvious in every operational surface (billing, IAM, audit log). The recommended name is `lyfelabz-lms-integration`.
- The project is created under the LyfeLabz operational billing account. Billing alerts are configured at a low threshold; the OAuth surface is a low-cost workload and any spend anomaly is a signal, not noise.
- The project is enrolled in Cloud Audit Logs for the services it uses. Admin activity logs are retained per the platform retention policy.

### 3.2 IAM posture

Project-level roles are granted at the minimum required for OAuth client administration. No project-level role grants access to student or teacher data in LyfeLabz.

- The operational owner holds `roles/owner` on the project. The on-call substitute holds `roles/owner`.
- No other principal holds a project-level role by default. Time-bounded grants for specific procedures (rotation, incident response) are recorded in the operational runbook and revoked at the end of the procedure.
- Service accounts inside the project are not granted access to any Firebase project or Cloud Function. The LMS OAuth trust boundary is server-mediated per PDR-019e; the operational trust boundary is server-only administration.
- IAM changes are audit-logged. A weekly operational check reads the audit log for unexpected role grants.

### 3.3 API enablement

Only the APIs the initial scope requires are enabled on the project.

- Google Classroom API. Required to list a teacher's classes and inspect a class's roster per `LMS_INTEGRATION_ARCHITECTURE.md` §10.3.8.
- No other Google Workspace API is enabled. Drive, Gmail, and Calendar remain disabled per `LMS_INTEGRATION_ARCHITECTURE.md` §11.2 (future architecture) and PDR-020c (excluded capabilities).

Enabling an additional API requires a documented operational change with a linked sprint specification. Enabling an API without a sprint is a gating defect for the next rotation review.

---

## 4. OAuth Client Provisioning

### 4.1 Client posture

One OAuth 2.0 client ID is provisioned inside the project named in §3.1. The client is dedicated to LyfeLabz LMS integration. Reuse of the client for any other purpose is prohibited.

- Client type: Web application.
- Client name: `LyfeLabz LMS Integration`.
- Client is created by the operational owner. Creation is recorded in the operational runbook with the creation date, the creating principal, and the initial redirect URI.

The client ID and client secret are the operational credential pair. Both are treated as secrets under §7. The client ID is not itself sensitive, but its handling is standardized with the secret so procedures do not have to distinguish which value is which at rotation time.

### 4.2 Redirect URIs

Authorized redirect URIs are limited to the server-side callback endpoint owned by the Cloud Function Charter. No client-side redirect URI is registered.

The following redirect URIs are authorized:

- The Cloud Function callback in the LyfeLabz production Firebase project, at the canonical function URL for `lmsConnectionsComplete`. The exact URL is recorded in the operational runbook alongside the client entry.
- The Cloud Function callback in the LyfeLabz staging Firebase project (if a staging project is present), at the equivalent function URL.
- The Emulator Suite callback used by the Emulator harness (`http://localhost:PORT/...`) for the duration of end-to-end validation only. This entry is removed after each certification pass.

No other redirect URI is authorized. Adding a URI requires a documented operational change. Removing a URI is a routine operation and does not require a change record beyond the audit log.

The consent completion flow terminates at a static asset served from the same origin as the callback function. The `app/lms-callback.html` shell is that asset. It carries no Firebase SDK, no OAuth secrets, and no per-teacher payload; it exists to hand control back to the workspace after the server-side exchange completes.

### 4.3 Client credentials handling

Client credentials are treated as production secrets from the moment they are generated.

- The client secret is copied into the operational secret manager (see §7) at generation time. It is never pasted into a chat, ticket, code review, or shared document.
- The client secret is never committed to the repository. A pre-commit check on operational branches greps for the well-known Google client secret prefix. The check exists as a defense in depth against accidental paste.
- The client secret is never written to any Firestore document under any role. It never reaches a client bundle. It never appears in a Cloud Function log.
- Rotation of the client secret is a documented procedure per §8. Rotation invalidates outstanding tokens and produces a teacher-visible re-authorization prompt on next visit.

---

## 5. OAuth Consent Configuration

### 5.1 Consent posture

The consent screen is configured to reflect the actual identity of the LyfeLabz platform.

- User type: Internal for pre-pilot validation against the LyfeLabz Google Workspace tenant; External once the pilot expands beyond that tenant.
- App name: `LyfeLabz`.
- App logo: The canonical LyfeLabz logo asset.
- App home page: The canonical LyfeLabz teacher landing URL.
- App privacy policy URL: The canonical LyfeLabz privacy policy URL.
- App terms of service URL: The canonical LyfeLabz terms of service URL.
- Support email: The operational owner's LyfeLabz support address.
- Developer contact email: The operational owner's LyfeLabz support address.

The consent screen is configured in Testing mode until the initial scope is exercised end-to-end under the Emulator Suite and the staging Firebase project. It is promoted to Production only after the first implementation sprint certifies and the pilot verification checklist in §14 is signed off.

### 5.2 Scope declaration

The consent screen declares the exact set of scopes named in §6. Additional scopes are not pre-declared "for future use"; incremental authorization per `LMS_INTEGRATION_ARCHITECTURE.md` §5.2 is preserved by declaring only what the initial scope requires.

Verification is required for the sensitive Classroom scopes named in §6. The operational owner initiates verification with Google before the consent screen is promoted to Production. Verification correspondence is retained in the operational runbook.

### 5.3 Test users

While the consent screen is in Testing mode, the following principals are added as test users:

- The operational owner's LyfeLabz Workspace account.
- The on-call substitute's LyfeLabz Workspace account.
- Every pilot teacher explicitly authorized to exercise the pre-Production integration.

Test users are removed on promotion to Production. Membership in the test-user list is recorded in the operational runbook.

---

## 6. Required Google Classroom Scopes

The initial scope authorized by PDR-020c requests only the minimum required to list a teacher's classes and inspect a class's roster. The exact scopes are:

- `https://www.googleapis.com/auth/classroom.courses.readonly`
- `https://www.googleapis.com/auth/classroom.rosters.readonly`

These are the scopes exported by the adapter as `GOOGLE_CLASSROOM_INITIAL_SCOPES`. The scope set is a code-level constant; the operational owner does not tune it at runtime. Any change to this constant is a code change with its own sprint specification.

Scopes explicitly not requested by the initial scope:

- `classroom.courses` (write). Required by class refresh and unlink workflows; deferred to LMS Sprint E per Amendment §8.
- `classroom.coursework.*` in any form. Required by assignment publication; deferred to LMS Sprint D per Amendment §8.
- `classroom.rosters` (write), `classroom.profile.*`, `classroom.announcements.*`, `classroom.push-notifications`. Not required by any capability in the internal Phase 9 sequence and not requested.
- Every Drive, Gmail, and Calendar scope. Excluded by PDR-020c and by `LMS_INTEGRATION_ARCHITECTURE.md` §11.3.

Scopes required by excluded capabilities are added by the sprint that owns the workflow requiring them. The operational owner refuses any request to add a scope outside a sprint specification.

---

## 7. Secret Manager Configuration

### 7.1 Storage location

OAuth client credentials, per-teacher access tokens, and per-teacher refresh tokens are held server-side only, per PDR-019e and `LMS_INTEGRATION_ARCHITECTURE.md` §10.3.3.

- The operational secret manager is Google Cloud Secret Manager inside the LyfeLabz production Firebase project. Staging tokens live in the staging Firebase project's Secret Manager. Emulator tokens live in-process only and never touch Secret Manager.
- The Cloud Function service account holds `roles/secretmanager.secretAccessor` on the secrets it must read. No wider role is granted. No human principal holds `secretAccessor` on the production token secrets by default; time-bounded grants for incident response are recorded in the operational runbook and revoked at the end of the incident.
- Secret Manager audit logs are enabled. Every access is logged.

### 7.2 Secret layout

The secret layout is a small, closed set. Each secret has one owner and one purpose.

- `lms/googleClassroom/clientId`. Value: OAuth client ID. Owner: operational owner. Replicated to staging under a separate secret.
- `lms/googleClassroom/clientSecret`. Value: OAuth client secret. Owner: operational owner. Replicated to staging under a separate secret.
- `lms/token/<tokenRef>`. Value: JSON envelope holding the per-teacher access token, refresh token (if present), granted scopes, expiry, and upstream account identifier. Owner: platform runtime. Created by `lmsConnectionsComplete` through the token store (see §7.3). Revoked by `lmsConnectionsDisconnect`.

The `<tokenRef>` value is the opaque reference minted by the token store per `platform/functions/src/lms/tokens/token-store.ts`. It is the only artifact that ever appears in a Firestore document; the token material itself never crosses the callable response boundary or the Firestore boundary.

### 7.3 Runtime binding

The in-process token store used by the Emulator Suite and by unit tests is not adequate for production. Production wiring replaces the default store through the `setLmsTokenStore` hook in `platform/functions/src/lms/tokens/token-store.ts`. Wiring is a code change and is delivered by its own sprint specification. Until wired, the initial-scope callables succeed under the Emulator Suite but return `lms.providerNotYetOperational` when the Google Classroom adapter is invoked against a real upstream. This is the intended state until §11's live validation is complete.

The runtime binding is a boring adapter: read the client credentials from Secret Manager on cold start, cache them for the lifetime of the function instance, and read or write per-teacher token envelopes on demand. No token material is stored in memory across cold starts. No token material is written to any log line, including error logs.

---

## 8. Token Rotation Strategy

Rotation is a scheduled operational procedure. It applies to both categories of secret: client credentials and per-teacher tokens.

### 8.1 Client credential rotation

The OAuth client secret rotates on a documented cadence. The default cadence is every 180 days. The cadence may be accelerated in response to a security signal (suspected leak, IAM anomaly, incident finding).

Rotation procedure:

1. The operational owner generates a new client secret through the Google Cloud console. Both the old and new secrets are valid during the rotation window.
2. The new secret is written to `lms/googleClassroom/clientSecret` in Secret Manager. A prior version is retained for the length of the rotation window.
3. The Cloud Function is redeployed so cold-started instances pick up the new secret. Warm instances continue to serve with the cached prior secret until they cool down; both secrets are valid, so no request fails.
4. Once every function instance is confirmed rotated (verified through the runbook's rotation dashboard or, if unavailable, through a 30-minute waiting period that exceeds function idle timeout), the old client secret is deleted through the Google Cloud console.
5. The rotation is recorded in the operational runbook with the rotation date, the initiating principal, and the incident (if any) that motivated an accelerated rotation.

Rotation of the client secret does not invalidate outstanding per-teacher tokens; the exchange has already happened. Teachers do not see a re-authorization prompt for a client secret rotation.

The client ID does not rotate on a schedule. It rotates only in response to a compromise finding. Rotating the client ID invalidates every per-teacher token and produces a teacher-visible re-authorization prompt on next visit; this is treated as a special case of §9.

### 8.2 Per-teacher token rotation

Per-teacher access tokens are short-lived and refresh through the ordinary OAuth refresh flow. Refresh is performed by the server, on demand, when a callable requires a live token per `LMS_INTEGRATION_ARCHITECTURE.md` §5.3. Refresh is not scheduled speculatively; a token that is not needed is not refreshed.

Per-teacher refresh tokens do not rotate on a schedule. They rotate:

- When the teacher reconnects the provider. The completion callable stores the new bundle under a new `tokenRef` and the connection record's `tokenRef` field is updated inside the same write.
- When the operational owner initiates a targeted revocation per §9.
- When Google rotates the refresh token as part of its own security posture, which the adapter honors on the next refresh exchange.

The runbook holds no expectation that a refresh token is durable beyond the connection lifecycle. Every callable that reads a token must be prepared for a refresh failure and must react by transitioning the connection to `revoked` (see §9.2).

---

## 9. Token Revocation Strategy

Revocation is a documented, teacher-safe operation. It applies to individual teachers, to sets of teachers, and to the entire connection surface.

### 9.1 Teacher-initiated revocation

A teacher revokes her own connection through the `lmsConnectionsDisconnect` callable, exposed in Settings > Integrations. The callable:

1. Resolves the `tokenRef` from her `lmsConnections/{connectionId}` document.
2. Invokes the adapter's `revokeGrant` against the upstream provider.
3. Discards the stored bundle from the operational token store.
4. Marks the connection `revoked` with a server timestamp per `LmsConnectionRevocationWrite`.
5. Writes an `lms.connectionRevoked` audit event per PDR-013.

The teacher-initiated path requires no operational action. It is documented here so the operational owner recognizes the audit-log signature during routine review.

### 9.2 Server-observed revocation

If the LMS returns an authorization error (HTTP 401 or 403) to any callable that holds a token for a teacher, the server treats the connection as revoked. The affected `lmsConnections` record transitions to `revoked` and the affected class links are marked `stale` per `LMS_INTEGRATION_ARCHITECTURE.md` §5.3 and §8. The teacher sees a plain-language reconnection prompt on next visit.

Server-observed revocation produces an `lms.connectionRevoked` audit event with a payload indicating an upstream cause. No operational action is required. The runbook records the pattern so the operational owner can distinguish it from a teacher-initiated event during triage.

### 9.3 Operator-initiated revocation

The operational owner may initiate targeted revocation in response to:

- A pilot teacher's off-boarding.
- A compromise finding involving a specific teacher's token material.
- A rollback of the OAuth client ID (see §8.1), which requires en-masse revocation of every outstanding token.

Procedure:

1. The operational owner identifies the target set of teachers by teacher UID (individual) or by school ID (bulk).
2. For each affected teacher, the operational owner invokes the operational revocation script. The script:
   - Reads the teacher's `lmsConnections/{connectionId}` document.
   - Fetches the `tokenRef` and invokes the token store's `revoke` method to discard the secret.
   - Writes the `revoked` status and revocation timestamp on the `lmsConnections/{connectionId}` document.
   - Writes an `lms.connectionRevoked` audit event with a payload indicating the operator cause and the initiating principal.
3. The operational owner records the revocation in the operational runbook with the affected teacher UIDs, the initiating principal, and the reason.

The operational revocation script is not implemented in the initial scope. Until it is delivered, the operational owner performs the equivalent through the Cloud Function callable surface, invoked with an operational session, and records the transaction in the runbook.

### 9.4 Restore posture after revocation

A revoked connection is not deleted. The `lmsConnections` document persists with the `revoked` status and revocation timestamp so audit trails remain complete per PDR-013 and the certified archival principle. The teacher restores service by initiating a fresh connection through the Integrations surface, which produces a new `connectionId` for a fresh (teacher, provider) pair.

The prior `tokenRef` is not restorable. Secret Manager retains no version of a revoked token secret; the secret is destroyed on revocation. This is a load-bearing property, not a limitation: a restore that recovered a revoked token would defeat revocation.

---

## 10. Disaster Recovery Additions

The additive Firestore collections named in `LMS_INTEGRATION_ARCHITECTURE.md` §3.3 fall under the certified Firestore backup and DR posture established by PDR-013 and referenced by `LMS_INTEGRATION_ARCHITECTURE.md` §10.3.4. The initial-scope collections are `lmsProviders`, `lmsConnections`, and `lmsClassLinks`. `lmsRosterLinks` and `lmsAssignmentPublications` are reserved and are not populated by the initial scope.

### 10.1 Firestore backup coverage

The existing Firestore backup schedule that covers `users`, `schools`, `classes`, `enrollments`, `assignments`, and `submissions` is extended to include the LMS collections. Coverage is a configuration change to the certified backup schedule; the change is a routine operational edit and does not require a code change.

- **Included collections.** `lmsProviders`, `lmsConnections`, `lmsClassLinks`.
- **Backup cadence.** Same cadence as the certified collections.
- **Retention.** Same retention as the certified collections.
- **Restore path.** Same restore path as the certified collections. A partial restore that touches only LMS collections is supported and is the recommended posture for an LMS-scoped incident that leaves the rest of the platform healthy.

The DR runbook is extended to name the LMS collections explicitly per `LMS_INTEGRATION_ARCHITECTURE.md` §10.3.4. Extension is a documentation edit; the extension is delivered alongside this runbook.

### 10.2 Secret Manager DR

OAuth tokens live in the operational secret manager and follow its own DR posture, not Firestore's. Secret Manager replicates its secrets within its own SLA; the runbook does not implement a separate backup of token material because doing so would defeat revocation.

Client credentials are recorded in a sealed operational break-glass envelope maintained by the operational owner. Recovery from the envelope is the DR path if Secret Manager is unavailable during a restore.

### 10.3 Restore behavior

A restore that recovers an `lmsConnections/{connectionId}` document without a matching valid token in the secret store produces the `revoked` failure-state behavior per `LMS_INTEGRATION_ARCHITECTURE.md` §10.3.4 and §8. The teacher sees a plain-language reconnection prompt on next visit. The behavior is not a bug; it is a feature of the ownership boundary between Firestore and Secret Manager.

A restore that recovers `lmsClassLinks/{linkId}` documents against an already-restored `classes/{classId}` set is safe. The link records are subordinate mirrors and carry no upstream authority; the certified class records they mirror remain intact.

A restore of `lmsProviders` overwrites the seed. Because the seed is idempotent (see §12), a subsequent seed run is safe.

---

## 11. Google Classroom Test Environment

The initial scope is exercised end-to-end under the Emulator Suite. The Google Classroom API is not part of the Emulator Suite; a documented test double or an authorized test instance provides the equivalent surface per `LMS_INTEGRATION_ARCHITECTURE.md` §10.3.5 and §10.3.6.

### 11.1 In-repository test double

The Google Classroom API is exercised by an in-process test double for regression testing. Fixtures are checked into the repository under the sprint that lands the Emulator harness (LMS Sprint B per Amendment §8). The double satisfies the provider abstraction without invoking a real network round trip.

Runbook responsibilities:

- Confirm the test double is present and passing before signing off the pilot verification checklist in §14.
- If the double drifts from the observed shape of the live Google Classroom API, file a defect against the sprint that owns the harness. Do not patch the double outside a sprint.

### 11.2 Authorized live test instance

An authorized Google Workspace for Education test instance is used for pre-release validation of the initial scope. Its identifiers are recorded in the operational runbook. No production teacher or student data is copied into it.

The test instance is provisioned under a LyfeLabz-owned domain dedicated to test use. It hosts:

- One test school with one dedicated `schoolId` in the LyfeLabz staging Firebase project.
- At least two test teachers with the LyfeLabz `teacher` role, each with a matching Google Workspace account.
- At least one test class in Google Classroom per test teacher, each with at least one enrolled test student and at least one section identifier.

Test data is refreshed between certification passes. Refresh is a scripted operational procedure that resets the test school's Firestore documents and rebuilds the Google Classroom side to a known good baseline. Refresh is recorded in the operational runbook with the refresh date and the initiating principal.

### 11.3 Boundary posture

The test instance is not a production surface. Its consent screen, redirect URIs, and IAM posture mirror production shape but sit inside the staging Firebase project. No production credential is reused inside the test instance; no test credential is reused inside production.

---

## 12. Provider Seed Procedure

The `lmsProviders` collection is a read-only reference dataset per Data Model §2.9.a. Seeding is required before any teacher can complete a connection because the callables validate the provider identifier against the closed set through the registry.

### 12.1 Seed content

The initial seed contains one document:

- `lmsProviders/googleClassroom`
  - `providerId`: `"googleClassroom"`
  - `displayName`: `"Google Classroom"`
  - `status`: `"available"`
  - `createdAt`: server timestamp at seed time

### 12.2 Seed procedure

The seed is applied through the operational seed script. The script:

1. Verifies the Firebase project the CLI is bound to matches the intended target (production or staging). A mismatch aborts.
2. Reads the current `lmsProviders/googleClassroom` document. If the document exists and its shape matches the expected seed shape, the script exits successfully with no write.
3. If the document does not exist, the script writes the seed shape through the `lmsProviderCollectionRef` writer with `createdAt: FieldValue.serverTimestamp()`.
4. If the document exists but its shape differs from the expected seed shape, the script prints a diff and exits without writing. The operational owner reconciles by hand and re-runs the script.
5. On success, the script prints the target project ID and the seed document ID for the operational log.

The seed script is not implemented in the initial scope. Until it is delivered, the operational owner performs the equivalent through a targeted Firebase CLI invocation or through a scripted Cloud Function callable, and records the transaction in the runbook.

### 12.3 Seed idempotency

Re-running the seed against a project that is already seeded is a no-op. Idempotency is a load-bearing property because the seed sits on the operational rollout path (see §13); a script that fails on a second run would raise a spurious rollout defect.

The `createdAt` timestamp is set only on the first successful write. Subsequent runs do not touch it, so the audit trail on the seed document remains stable across the lifetime of the project.

---

## 13. Initial Production Rollout Checklist

The first production rollout of the LMS integration is a single, non-recurring event. This checklist is executed once by the operational owner in the order presented. Each item is signed off in the operational runbook before the next item begins.

1. **Architecture and decision log alignment confirmed.** `LMS_INTEGRATION_ARCHITECTURE.md`, `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`, PDR-019, and PDR-020 are ratified. No open architectural questions block the rollout.
2. **Prerequisite phases confirmed.** Phase 5 (Assignment Foundation) and Phase 6 (Submission Foundation) are certified complete per Amendment §7 items 2 and 3.
3. **Sprint completion confirmed.** LMS Sprint B (Firestore, Rules, and callable scaffolding) and LMS Sprint C (Teacher Integrations surface) are complete and certified per Amendment §8. The initial-scope callables are deployed to the production Firebase project.
4. **Google Cloud project provisioned.** The project named in §3.1 exists. IAM posture per §3.2 is in place. Only the APIs listed in §3.3 are enabled.
5. **OAuth client provisioned.** The client per §4.1 exists. Redirect URIs per §4.2 are configured. Client credentials are recorded in Secret Manager per §7.2. Repository pre-commit check per §4.3 is active.
6. **Consent screen configured.** Consent screen configuration per §5.1 is complete. Scopes per §6 are declared. Verification is complete (or the pre-Production consent screen mode is in effect for the pilot cohort only, with the test users listed in §5.3).
7. **Secret Manager wired.** Client credentials are readable by the Cloud Function service account per §7.2. The token store production binding per §7.3 is deployed. The `lms.providerNotYetOperational` error is no longer returned by the adapter against the live upstream.
8. **`lmsProviders` seeded.** The seed procedure per §12 is executed against the production project. The `lmsProviders/googleClassroom` document exists with the expected shape.
9. **Firestore backup coverage extended.** `lmsProviders`, `lmsConnections`, and `lmsClassLinks` are included in the certified backup schedule per §10.1. A dry-run restore of the LMS collections is exercised against the staging Firebase project.
10. **DR runbook extended.** The certified DR runbook is updated to name the LMS collections and the restore behavior per §10.3.
11. **Google Classroom test instance ready.** The test instance per §11.2 is provisioned. Test data is refreshed to a known good baseline.
12. **End-to-end OAuth validation complete.** The procedure in §15 is executed successfully against the staging Firebase project and against the production project with a single operational test teacher.
13. **Pilot verification checklist complete.** The checklist in §14 is executed and signed off.
14. **Rollout announcement.** The operational owner records the rollout in the operational runbook with the rollout date and the initiating principal.

An unmet item is a gating defect for the rollout. The operational owner does not proceed past an unmet item without a documented exception, which itself requires a sprint specification.

---

## 14. Pilot Verification Checklist

The pilot verification checklist is executed after the initial production rollout and before general availability to any pilot teacher. It is executed by the operational owner in coordination with at least one pilot teacher whose participation is documented.

1. **Pilot teacher identity confirmed.** The pilot teacher's LyfeLabz identity is `active` per `PLATFORM_STATE_MACHINE.md`. Her `role` custom claim is `teacher`. Her `schoolId` matches the pilot school.
2. **Pre-connection state clean.** The pilot teacher has no `lmsConnections/{connectionId}` document under the (teacher, googleClassroom) pair. The pilot teacher's Google Classroom account has no existing OAuth grant to the LyfeLabz client.
3. **Consent screen presentation.** The pilot teacher opens Settings > Integrations and initiates a Google Classroom connection. The consent screen presents the LyfeLabz brand configured in §5.1 and the exact scopes declared in §6. No unexpected scope appears.
4. **Consent approval and callback.** The pilot teacher approves the consent screen. The callback lands on the redirect URI configured in §4.2. `lms-callback.html` renders and hands control back to the workspace without exposing any token material.
5. **Connection record.** `lmsConnections/{connectionId}` exists for the pilot teacher with `status: "active"`, the scopes named in §6, an opaque `tokenRef`, and a server-set `connectedAt`. No token material appears in the document.
6. **Token storage.** A matching secret exists in Secret Manager under `lms/token/<tokenRef>`. The secret is not readable by any human principal by default. The Cloud Function service account can read it.
7. **Audit event.** An `lms.connectionCreated` audit event is present with `actorUserId` equal to the pilot teacher's UID and `targetId` equal to the connection ID.
8. **Discovery.** The pilot teacher navigates to the class import surface. The `lmsClassesDiscover` callable returns the list of classes the pilot teacher teaches in Google Classroom, with no student PII and no LMS-authored artifact beyond the fields exported by `LmsDiscoveredClass`.
9. **Import.** The pilot teacher imports one Google Classroom class. `classes/{classId}` is created with `enrollmentSource: "lms"` and `lmsProviderRef` populated. `lmsClassLinks/{linkId}` is created with `status: "linked"` and matching `classId` and `lmsClassId`. An `lms.classImported` audit event is written.
10. **Join-code refusal.** The pilot teacher attempts to enable a join code on the imported class. The server refuses per PDR-019i with a clear message. No join code is created.
11. **Disconnect.** The pilot teacher initiates disconnect through Settings > Integrations. The `lms.connectionRevoked` audit event is written. The `lmsConnections` document transitions to `status: "revoked"` with a `revokedAt` timestamp. The Secret Manager entry under `lms/token/<tokenRef>` is destroyed. The imported class is preserved but its link is unaffected by the disconnect (a separate unlink is required to sever the mirror; unlink is out of the initial scope and is not exercised here).
12. **Repeat connection.** The pilot teacher initiates a fresh connection. A new `tokenRef` is minted; the prior `revoked` record is preserved.
13. **Failure surface.** The operational owner invokes an intentionally failing scenario (an invalid scope on the consent screen, or a network fault during `lmsConnectionsComplete`). The failure surfaces to the pilot teacher as a plain-language message; no Firestore write results; an audit event records the failure.
14. **Sign-off.** The operational owner records the pilot verification date, the participating pilot teacher's UID, and any observations in the operational runbook.

An unmet item is a gating defect for pilot general availability. The operational owner does not extend the pilot to a second teacher until every item is signed off or a documented exception exists with a linked sprint specification.

---

## 15. End-to-End OAuth Validation Procedure

The end-to-end OAuth validation procedure is run at three moments:

- Before the first production rollout (as item 12 of §13).
- After every rotation of the OAuth client secret (§8.1).
- After any change to the redirect URI set, the scope set, or the consent screen.

The procedure exercises the OAuth grant against a live upstream. It is not a substitute for the in-repository test double per §11.1; it is a live-upstream complement to it.

### 15.1 Preconditions

- The Google Cloud project per §3 is in the intended state.
- The OAuth client per §4 is in the intended state.
- The consent screen per §5 is in the intended state.
- Secret Manager per §7 is wired.
- `lmsProviders` per §12 is seeded in the target Firebase project.
- The Cloud Functions for the initial scope are deployed to the target Firebase project.
- The operational owner is signed into a Google Workspace test account that is a member of the consent screen's test user list (if pre-Production) or that has not previously granted the client (if Production).

### 15.2 Procedure

1. **Begin.** The operational owner opens Settings > Integrations in the LyfeLabz workspace and clicks the affordance that initiates a Google Classroom connection. The client invokes `lmsConnectionsBegin` with `providerId: "googleClassroom"` and the configured redirect URI. The response contains an `authorizationUrl` and an opaque `state`.
2. **Consent.** The client opens the `authorizationUrl` in the browser. The consent screen renders with the LyfeLabz brand and the scopes named in §6. The operational owner approves.
3. **Callback.** The browser lands on the redirect URI. `lms-callback.html` renders and the client invokes `lmsConnectionsComplete` with the authorization `code`, the `state` from step 1, and the redirect URI.
4. **Completion.** The server exchanges the code with Google, stores the resulting token bundle through the token store, writes the `lmsConnections/{connectionId}` document, and writes the `lms.connectionCreated` audit event. The callable returns `{ connectionId, providerId, alreadyConnected: false }`.
5. **Verify Firestore state.** The operational owner reads `lmsConnections/{connectionId}` and confirms the shape defined in `LmsConnectionRecord`. No token material appears in the document.
6. **Verify Secret Manager state.** The operational owner confirms that a matching secret exists in Secret Manager under `lms/token/<tokenRef>`. The operational owner does not read the secret value (doing so would leave a false-positive audit signal).
7. **Verify audit state.** The operational owner reads the `auditEvents` collection and confirms the `lms.connectionCreated` event with the expected shape.
8. **Idempotency.** The operational owner replays step 3 with the same authorization `code`. The completion callable returns `{ alreadyConnected: true }` without minting a second token. This exercises the idempotency contract in `lmsConnectionsComplete`.
9. **Discovery.** The operational owner invokes `lmsClassesDiscover` and confirms the response contains the operational owner's own Google Classroom classes and nothing else.
10. **Disconnect.** The operational owner invokes `lmsConnectionsDisconnect`. The `revokeGrant` call reaches Google. The token secret is destroyed. The `lmsConnections/{connectionId}` document transitions to `status: "revoked"`. An `lms.connectionRevoked` audit event is written.
11. **Post-conditions.** No token material persists in Secret Manager. The connection record persists in `revoked` state. The operational owner records the validation date, the target Firebase project, and the outcome in the operational runbook.

A failure at any step aborts the validation. The failure is recorded in the operational runbook with the failing step and the observed cause. Remediation happens in a subsequent sprint; the operational owner does not proceed to a later step by hand.

---

## 16. Operational Readiness Summary

The following items from `LMS_INTEGRATION_ARCHITECTURE.md` §10.3 are addressed by this runbook. The runbook is the operational artifact each subsection anticipates.

- §10.3.1 (OAuth Provisioning Checklist). Addressed by §3, §4, §5, §6.
- §10.3.2 (Google Cloud Project Ownership). Addressed by §2, §3.
- §10.3.3 (Secret Management Expectations). Addressed by §7, §8, §9.
- §10.3.4 (Disaster Recovery Additions). Addressed by §10.
- §10.3.5 and §10.3.6 (Provider Testing Strategy, API Emulator Strategy). Addressed by §11.
- §10.3.7 (Ownership Verification Strategy). Addressed at the code layer by the discovery and import callables. Operationally, ownership drift is surfaced through the `lms.ownershipDrift` audit event; the operational owner reads for it during triage.
- §10.3.8 (Incremental Authorization Strategy). Addressed by §6. The scope list is a code constant and is not tuned at runtime.
- §10.3.9 (Readiness Gate). Addressed by §13.

The runbook does not close §10.3.7 in code (ownership drift handling in refresh is future architecture) and does not close the token store production binding in code (§7.3). Both are scoped as remaining work in §17.

---

## 17. Remaining Operational Work

The following work items remain after this runbook lands. Each is scoped for a subsequent sprint specification and is not authorized by this document.

- **Token store production binding.** Wire the Secret Manager-backed token store through `setLmsTokenStore` in production. Until wired, the initial-scope callables return `lms.providerNotYetOperational` when the Google Classroom adapter is invoked against a real upstream (per §7.3).
- **Operational revocation script.** Deliver the script referenced in §9.3 so the operational owner does not perform the equivalent by hand.
- **Operational seed script.** Deliver the script referenced in §12.2 so the operational owner does not perform the equivalent by hand.
- **Rotation dashboard.** Deliver the dashboard referenced in §8.1 step 4 so the operational owner can confirm rotation completion without a waiting-period fallback.
- **Consent screen verification.** Complete Google's verification for the sensitive Classroom scopes named in §6 so the consent screen can be promoted to Production.
- **Ownership drift handling.** Deliver the refresh workflow that closes §10.3.7 in code. This is a sprint under Amendment §8 (LMS Sprint E) and is not in the initial scope.

Each item is a documented commitment. Delivery is scheduled through the ordinary sprint sequence and is not accelerated by any procedure in this runbook.

---

## 18. Non-Goals

This runbook does not:

- authorize implementation beyond the initial scope named in PDR-020c,
- schedule any sprint beyond the ones already sequenced in `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md` §8,
- amend PDR-019 or PDR-020,
- redefine any certified architecture document,
- introduce a new role, claim, or lifecycle field,
- describe the visual design of the Integrations surface (that is the job of `LMS_EXPERIENCE.md`),
- authorize a second identity provider or a second LMS provider.

Sprint 8D may begin once the items in §13 are signed off and the token store production binding in §17 is scheduled. The confirmation is a documentation-only signal; every architectural decision that governs Sprint 8D is already recorded in the certified architecture and decision log.

---

*End of runbook. This document is the canonical operational companion to `LMS_INTEGRATION_ARCHITECTURE.md`. Every procedure in it implements a commitment already recorded in the certified architecture. Sprint 8D may begin under the conditions in §18.*
