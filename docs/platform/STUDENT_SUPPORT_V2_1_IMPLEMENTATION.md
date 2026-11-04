# Student Support V2.1 implementation

Status: local remediation for independent review.

Baseline: `3cbfdcf621bb1912c9f3188cbef8696e1b644593`. The public app bundle and assessment runtime matched the clean release artifacts at investigation time. Subsequent autosave and release-tooling work is excluded.

## Approved boundaries

Pending authorizations are server-only instructions, never student-read authority. Canonical UID-based active studentSupportGrants remain the only support authority for student data. Exact weston.org recipient matching applies to new pilot authorizations; existing grants are preserved. The protected teacher pilot allowlist remains an independent onboarding gate and is never written by sharing.

Individual student removal preserves the recipient relationship. Removing the recipient relationship ends its designation and revokes its associated grants, without touching another owner's relationships or grants. Pending records have no automatic expiry or deletion. No retention period is introduced.

Teachers owning any class, including archived classes, retain the full workspace. Active zero-class recipients receive Student Support and preview-only Curriculum. Student Support is the fresh-load landing. Existing valid grants qualify without re-onboarding; historically revoked grants do not.

Support-only recipients cannot obtain science-teacher capabilities through self-service class creation. A future administrator-controlled transition requires a separately specified, audited workflow; no transition endpoint is introduced here.

## Server-only lifecycle

New pending `supportRecipientRelationships` records are deterministic over owner UID, canonical school/district, and normalized email. Legacy compatibility relationships instead use owner/scope/recipient UID. `supportStudentAuthorizations` is deterministic over relationship, class, and student. Identifiers hash unambiguous JSON arrays, never raw email paths. Both collections and `supportAccountBoundaries` inherit terminal default-deny for every client role. Admin-SDK callables are the only writers.

Relationships carry pending/active/revoked status, revision, issuer, scope, timestamps, email, bound UID, and a hashed Google provider reference. Student authorizations carry pending/activated/revoked status, revision, issuer/scope, relationship/class/student identifiers, and canonical grant reference after activation. New recipient addresses require the exact weston.org domain; malformed addresses, lookalikes, and subdomains fail per pair. Issuers must belong to the configured pilot school. No email or membership list is exposed through the pilot configuration document.

Saving does not create an Auth user or provision a teacher. Existing active verified recipients activate immediately when the activation service succeeds; a confirmed authorization remains pending and retryable if activation is temporarily unavailable. Others wait for ordinary eligible onboarding. Matching requires the server Auth user's verified email and exactly one Google provider with the same email. Once bound, the UID and provider reference cannot be silently replaced by a recreated account or another identity at the same email. Identity-rebinding recovery is a future audited administrator workflow.

`supportAccessReconcileMine` runs from active-teacher bootstrap and shared-list refresh. It is idempotent and uses a resumable cursor with at most forty student activation attempts per call. Ineligible rows remain pending; advancing the cursor prevents them from starving later students. Identity data in requests is rejected. Every committing activation rereads the relationship, student authorization, recipient, owner, class, enrollment, and grant. Audits and grant/authorization writes share the transaction. A precise Firestore update-version comparison prevents stale pending reconciliation from reversing canonical revocation. Explicit owner re-sharing may create a new authorization revision; reconciliation alone never reopens a revoked row.

## Revocation and designation

Cancel invitation closes an unbound email relationship and queues its pending authorizations for cleanup. It does not revoke existing UID access. Remove teacher requires a server-validated UID from a bound relationship or an issuer-owned canonical grant. Its transaction writes the issuer cutoff, closes the selected relationship, and enqueues cleanup without scanning aliases. Binding, activation, and student reads enforce the cutoff immediately. The worker pages issuer-scoped grants and bound aliases, retaining its cursor and comparing issuance times to preserve later shares. Other issuers retain their grants.

Explicit grant-ID revocation replaces any cleanup marker, even on an already-revoked canonical grant. The write and its operation receipt commit together. Older pending authorizations cannot use the superseded grant version to activate. A later intentional share can observe the new version and authorize access again.

Canonical listing validates each grant before projecting a student. Legacy relationship seeding rechecks a validated candidate transactionally. Maintenance failure preserves the student list and returns the restricted workspace classification. Google reconciliation has its own retry path.

Only current valid legacy UID grants may seed compatibility relationships, and their validity is rechecked in the committing transaction. Existing grants are not rewritten for compatibility; historical revoked grants never seed a designation. Existing non-Weston grants remain authorized under the original checks, while new sharing requires weston.org.

Workspace designation and teaching permission are separate. Any owned class (including archived) preserves the full workspace. Otherwise an active recognized recipient relationship or current valid grant selects Student Support. After the last relationship and grant are removed, that designation ends on the next successful authorization refresh, including within the current page. Failed reads do not clear a known designation or masquerade as an empty state. A server-owned teaching restriction remains for accounts already recognized as support-only: losing access must not grant new teaching privileges. It is a capability boundary, not a new identity role or claim. There is no self-service switch and no administrator-reset API in this implementation. A future transition needs explicit administrator authority, audited action, tenant checks, and concurrency design.

## Curriculum and navigation

Support navigation contains exactly Student Support and Curriculum. Student Support is the login/refresh destination, including for a saved Curriculum URL. Browser history may return to the preview catalog, but cannot restore teaching destinations or assignment/result management. The catalog receives explicit preview-only capability, omits Assign, lesson activation, resource selection, My Units, assignment results, and publishing dependencies, and uses the existing standalone lesson preview links. Preview links contain no assignment context and produce no persisted student assessment work.

A recognized recipient with no valid students sees:

> Your students will appear here soon.
>
> Once a science teacher shares students with you, you'll be able to view their progress and learning results.

Read failures show a retryable error; failed authorization reads do not mean an empty list. Shared Student Detail keeps existing read-only question review and server authorization.

## Backend enforcement and concurrency

The shared teaching-callable wrapper checks server-derived restrictions before entering teaching-domain operations, retaining the original handlers' role, ownership, school and district validation. It covers class management, assignments, LMS, My Units, accommodations, enrollments and teacher management preferences. Student-scoped support reads retain the existing grant checks; student-role operations retain their existing role validation.

Both manual and LMS class creation recheck the support restriction inside the committing transaction and read/touch the same account-boundary document as recipient binding. A pending recipient is restricted even before its first workspace bootstrap; unlinking Google cannot bypass this restriction. Google verification is still mandatory to grant student access. A client cannot obtain teaching privileges by hiding navigation state, invoking a callable directly, or racing the first class creation against binding.

## Configuration and operational review

The existing protected `platformConfig/teacherPilotAllowlist` remains the independent onboarding gate. Sharing never adds emails, activates accounts, writes teacher claims, or discloses allowlist membership. Its configured `pilotSchoolId` supplies the school restriction. Administrators continue to manage onboarding eligibility separately.

Verify all five composites in `platform/firebase/firestore.indexes.json` before deploying Functions.

- `supportRemovalJobs` on `pending`, `attemptedAt` for Scheduler queue selection in attempted-time order.
- `supportStudentAuthorizations` on `relationshipId`, `status` for pending activation and relationship cleanup.
- `studentSupportGrants` on `granteeUid`, `ownerTeacherId`, `status` for issuer-scoped cleanup and compatibility checks.
- `studentSupportGrants` on `granteeUid`, `status` for canonical recipient listing and legacy grant checks.
- `supportRecipientRelationships` on `recipientUid`, `status` for active recipient classification.

No new TTL is introduced. New callables retain the support-function maxInstances limit of twenty. Existing callable runtime options are forwarded unchanged by the teaching wrapper. Deployment requires a separately reviewed scoped Functions plan, index readiness, and paired Hosting procedure. Teacher Units guard changes also require the existing Option B build/policy certification process; ordinary local compilation is not release authorization.

No destructive migration, grant backfill, teacher-account rewrite, or manual provisioning is required. School/district transfers, email changes, recreated accounts and operator identity recovery require review rather than silent rebinding. Collection scan limits fail with an explicit retry/operator-review error rather than truncating authorization state.

Retention: the security model defines append-only audit and administrative retention principles, but no specific retention duration for these new pending/relationship records was found. Pending authorizations do not expire, records are not automatically deleted, and audit events follow the existing append-only sink. A concrete platform retention schedule remains an operational documentation gap; this implementation invents no period.


Owner-list compatibility: V2.1 requests `includeAuthorizations: true` to receive pending/removed status rows. Legacy owner-list requests retain their active canonical-grant projection. Only an activated row whose issuance matches the active canonical grant represents current access. Superseded rows use their own authorization IDs and appear as history. Current student access is revoked by canonical grant ID. Pending authorizations are canceled by authorization ID. Existing active-sharing response fields remain available. Old browser tabs should refresh to receive the V2.1 workspace and relationship-removal UI.


Cross-email revocation: the server-owned account boundary also records issuer-specific revocation timestamps. Binding and activation compare the owner's frozen authorization timestamp against that barrier inside their transaction. An older pending authorization under another email cannot restore a removed recipient's access. Only a later explicit owner authorization may cross that owner's barrier. Other owners' authorizations are unaffected. Compatibility seeding cannot cross a removal barrier, and does not renew the owner's authorization timestamp.


An email-only authorization with no prior identity binding has no earlier Google subject to compare. Its first claim requires the current verified Google address and independent eligible onboarding. Operators should review stale pending addresses; the approved policy introduces no automatic expiry. Previously bound UIDs/provider references are never silently reassigned to a recreated account.


Account recreation is not a teaching-permission reset. Restricted boundaries retain opaque canonical Google-identity and server-provisioned-email fingerprints. Teaching guards check matching boundaries and unresolved canonical external-identity mappings, and recognize current valid legacy support grants on a same-email old active account before its first V2.1 visit. These checks deny escalation; they never transfer student access or change onboarding eligibility. Revocation barriers follow matching identity boundaries. A new UID cannot bind a previously restricted identity without administrator identity recovery, and no recovery/reset endpoint is introduced.

Legacy compatibility relationships are keyed by owner/scope/recipient UID, have a null email, and are created only from transactionally rechecked valid UID grants. They do not claim an email identity or change grant records, and remain active when individual grants disappear. Owner lists use their stable UID relationship reference; whole-recipient removal works without relying on a mutable email address.


A denied teaching operation may retain an audited server-only restriction derived from currently valid support authorization. The denial still creates no class, assignment, teacher role, or student grant. This prevents an account first recognized by a direct callable attempt from losing its restriction when that last student grant is later revoked. Current class owners continue to retain their full workspace and teaching operations.


Single sharing returns a read-only projection after activation. Response shaping never invokes a second grant mutation. If revocation wins before that projection, the response reports removed access and does not recreate the grant.


Bulk requests keep the existing raw-array caps (forty students, ten recipients, four hundred pairs) and normalize/de-duplicate only after enforcing them. Pilot scope and recipient Auth lookups are cached within that one authenticated request; canonical role/scope and every activation still recheck their transactional records. Confirmed pending saves survive activation-service failures. Owner authorization listing does not impose a new cumulative four-hundred-record cap; relationship/recipient metadata reads are shared across rows.


## Versioned mutation and rollout contract

Read the issuer generation with `supportAccessMutationGeneration` before loading the owner grant view. A V2.1 mutation sends `operationId` and `expectedGeneration` to `supportAccessV21GrantMany`, `supportAccessV21RevokeAuthorization`, or `supportAccessV21RemoveRecipient`. The server reserves the next issuer generation transactionally and binds the operation ID to the normalized intent. Each bulk pair has a transactionally committed receipt. Retries reuse the operation ID and expected generation. A competing operation invalidates remaining stale writes. A new decision requires a new operation ID and the current generation after reviewing access. Generation counters are scoped by owner, school, and district. Retain the receipts and cutoff records while clients may replay requests.

V2 list callables preserve canonical read shapes. An old share request can confirm an existing usable active grant. Legacy calls that could mutate grants return `supportAccess.refreshRequired` and create no pending rows. V2.1 never falls back to legacy mutations. If a versioned endpoint is missing, the V2.1 tab can display compatible canonical reads and requires a refresh for mutations. Canonical student reads and workspace eligibility work independently of Google reconciliation. Reconciliation failures have their own retry status. New pending activation still requires verified Google identity.

1. Confirm the staging project and wait for the required Firestore indexes to be ready. Deploy the security-enforcing Functions, including the scheduled removal worker, before Hosting.
2. Record the deployed Scheduler job name and region for `supportAccessDrainRemovals`, its schedule, authenticated invoking principal and target, and the Functions runtime service account. Verify invoker permission on the target and Firestore read/write access for the runtime identity. Confirm a scheduled invocation succeeds and advances a synthetic multi-page removal. Monitor failed invocations, cleanup error logs, pending job count, and oldest pending cutoff age.
3. Verify V2 canonical reads and confirmation of an existing active share.
4. Verify legacy generation-sensitive calls refuse with refresh required.
5. Verify V2.1 mutation and replay behavior with approved synthetic staging accounts.
6. Verify required Firestore indexes are ready and cleanup can resume through multiple pages.
7. Deploy V2.1 Hosting through the paired Hosting release procedure.
8. Verify V2.1 behavior and already-open V2 tabs.

Hosting rollback may restore V2 client assets while retaining the security-enforcing Functions. Automatic rollback to the original V2 Functions is prohibited. Any backend rollback requires separate authorization and evidence that the replacement retains cutoff enforcement, pending-authorization isolation, and generation-safe mutation behavior.

Before staging rollout, tell users with already-open V2 tabs to reload LyfeLabz before changing Student Support access. The existing V2 revoke UI may show a generic retry message even when the server requires a refresh. Verify this with a tab opened before the Functions deployment.
