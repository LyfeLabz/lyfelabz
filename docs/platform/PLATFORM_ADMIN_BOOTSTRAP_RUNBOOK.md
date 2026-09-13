# Platform Administrator Bootstrap Runbook

**Status:** Canonical operator runbook (Phase 8G.12).
**Audience:** Repository owner / operator performing the first-platform-administrator bootstrap.
**Scope:** How to establish the first `platformAdministrator` safely, and the paired rollback.

This runbook is the operator context for a special, one-time lifecycle
operation. It is not routine administrator management. Read it end to end
before running anything.

---

## 1. Why first-admin bootstrap is operator-only

Production currently has **zero** canonical `platformAdministrator` users and
zero Firebase Auth users carrying the administrator claim. Every
administrator-only callable (`teachersSuspend`, `schoolsCreate`,
`teachersApproveVerification`, `teachersDenyVerification`,
`identityMigrationRunProductionInventory`) requires an already-active
administrator, so there is a bootstrapping gap: no in-product path can mint
the first administrator without one already existing.

The bootstrap is therefore an operator tool run with Application Default
Credentials (Firebase Admin), not a client callable. It is **not** exported
from the Cloud Functions bundle and cannot be invoked over the wire. Exposing
first-admin creation as a callable would be a privilege-escalation surface;
keeping it operator-only, dry-run-by-default, and gated behind explicit
acknowledgements keeps it a deliberate, audited, one-time action.

The tool:

- `platform/functions/src/scripts/admin/bootstrap-platform-administrator.ts` (CLI entrypoint)
- `platform/functions/src/scripts/admin/bootstrap-platform-administrator-core.ts` (pure, tested core)

No production identity (email, UID, project, school, district) is compiled
into either file. Every value is an explicit argument, validated against live
state.

Two 8G.12A properties underpin its safety:

- **Explicit project binding.** The CLI initializes Firebase Admin with the
  `--project-id` passed **explicitly** to `initializeApp({ projectId })`, never
  inferring the project from `GCLOUD_PROJECT` / `GCP_PROJECT` / credential
  inference / a Firebase CLI alias. Before any read or write it verifies the
  effective bound project equals `--project-id` and fails closed on any
  divergence. The Auth and Firestore clients are the ones bound to that
  project. (Section 5.)
- **Durable bootstrap lineage.** Bootstrap ownership is proven by a durable,
  server-only singleton document `platformAdminBootstrap/initial`, not inferred
  from `users/{uid}.role`. Repair replay, already-complete detection, rollback
  target/destination, and the correlation identity all derive from that record.
  A canonical administrator role with absent or conflicting lineage fails
  closed rather than being adopted. (Section 4.)

---

## 2. Administrator identity posture

The first `platformAdministrator` is established by transitioning an **existing
eligible active teacher** into the administrator role. The bootstrap
architecture intentionally supports promoting a real teacher identity: the
transition changes only the canonical `role` (and claims), and it preserves
every instructional and LMS record the account already owns. While the
canonical role is `platformAdministrator`, teacher-only surfaces are no longer
accessible to that account (authorization keys on the current role), but the
historical data remains intact and dormant.

Longer term, the product may introduce a separate dedicated, non-instructional
administrative identity so that administrator authority and teacher-owned data
live on different accounts. That is **out of scope for this phase** and is a
recommendation, not a current guarantee.

### Named operational decision (this rollout)

- **Intended first production administrator:** `cgbreezy7@gmail.com`.
  Production read-only inspection established that this account is **currently
  an active teacher with existing instructional / Google Classroom / LMS
  history**. It is therefore **not** a pristine or non-instructional identity,
  and this runbook does not describe it as one. Its teacher history MUST be
  preserved (see Section 11); the bootstrap must not delete, disconnect,
  migrate, or rewrite any of it.
- **Temporary certification teacher (cleanup target, later phase):**
  `labzlyfe@gmail.com`. This remains a **teacher** and MUST NOT be elevated by
  this bootstrap.

These are operational targets recorded here (operator context) only. They are
deliberately **not** placed in reusable architecture documentation, and they
are **not** hard-coded anywhere in source, tests, or configuration.

Because `cgbreezy7@gmail.com` is an existing teacher, its Firebase Auth
identity and canonical `users/{uid}` record already exist; the production
preflight (Section 5) verifies that its shape satisfies every prerequisite
before any bootstrap execution, and fails closed on any gap.

After the administrator is established and independently certified,
that administrator can later invoke the canonical `teachersSuspend` lifecycle
against `labzlyfe@gmail.com`. `teachersSuspend`'s self-target protection and
teacher-only target rule remain intact; the administrator and the cleanup
target are separate identities, and no administrator role transfer is performed
by suspension.

---

## 3. Prerequisites (all validated by the tool; it fails closed on any gap)

### Identity prerequisites

- The target Firebase Auth identity exists.
- Its UID and email match the acknowledged `--target-uid` / `--target-email` exactly.
- The Auth identity is enabled (not disabled).
- The target email resolves to the same UID.

If the Firebase Auth identity does not exist: **FAIL CLOSED** (`bootstrap.missingAuthIdentity`).

### Canonical-user prerequisites

- `users/{uid}` exists.
- `authUid === uid`.
- `status === "active"`.
- `role === "<expected source role>"` (the operator-acknowledged `--expected-current-role`).
- `schoolId` is present and equals the acknowledged `--expected-school-id`.
- `schools/{schoolId}` exists and resolves a canonical `districtId`.
- The record shape is otherwise valid for the transition.

If `users/{uid}` does not exist: **FAIL CLOSED** (`bootstrap.missingCanonicalUser`).

### How to establish missing prerequisites (do NOT let the bootstrap do it)

The bootstrap tool never creates a Firebase Auth identity and never fabricates
a `users/{uid}` record. If either is missing, establish it through the existing,
independently safe canonical path, then re-run the bootstrap preflight:

1. **Firebase Auth identity + provisioned user record.** The target signs in
   once through the normal application sign-in flow
   (`https://lyfelabz.com/app/`). The `authOnUserCreate` trigger writes a
   canonical `provisioned` `users/{uid}` document. This is the canonical,
   product-owned way an identity and its user record come into existence.
2. **Active teacher (the expected source role for the initial bootstrap).**
   Move the provisioned user to an `active` teacher through the canonical
   verification path (`teachersRequestVerification` then
   `teachersApproveVerification`) or the allowlisted pilot activation
   (`teachersActivatePilot`), subject to the pilot allowlist. This assigns the
   canonical `schoolId` and resolves the district.

`scripts/bootstrap-beta-teacher.ts` is a beta teacher shortcut. It MUST NOT be
used as an administrator provisioning shortcut, and the admin bootstrap never
invokes it. Do not manually hand-edit a `users/{uid}` record to fabricate the
prerequisite state.

Only when the identity is an active canonical teacher (or the acknowledged
source role) does the administrator bootstrap have a safe record to transition.

---

## 4. Durable lineage, zero-admin precondition, and serialization

**Durable lineage.** A fresh initial bootstrap creates the singleton
`platformAdminBootstrap/initial` document in the SAME transaction as the role
transition and audit. It records `targetUid`, `previousRole`, `newRole`,
`schoolId`, `districtId`, `correlationId`, `reason`, `state`, `version`, and a
server `createdAt`. It stores **no email, token, or secret**. This record - not
`users/{uid}.role` - is the authority for repair replay, already-complete
detection, rollback, and correlation.

**Zero-existing-administrator precondition.** For `reason = initialBootstrap`
the tool requires, read transactionally, BOTH that no durable lineage exists
AND that no active canonical `platformAdministrator` exists. If either is
present it fails closed (`bootstrap.lineageConflict` /
`bootstrap.administratorExists`). The tool is not a routine administrator-grant
mechanism; the first-admin bootstrap is a special operator-controlled lifecycle
operation.

**Concurrent serialization.** The lineage document is a fixed-id singleton and
is read in every transaction path; its create fails if it already exists. Two
concurrent first-admin attempts therefore contend on that document and
Firestore admits exactly one - exactly one lineage, one administrator, one
audit; the loser fails closed. (Proven by the emulator-backed concurrency
test.)

**Unexpected privileged target.** The tool refuses a target whose canonical
role is still the source role yet already carries an administrator custom claim
(`bootstrap.unexpectedPrivilegedTarget`). That split-brain state is never
silently "completed".

**Change/correlation ticket.** `--change-ticket` must match
`[A-Za-z0-9._:-]` and be 1-64 characters (`bootstrap.invalidChangeTicket`
otherwise): no whitespace, control characters, newlines, free-form prose, or
email-like values. It is stamped as the audit `correlationId` and persisted on
the lineage; replay requires the same value.

---

## 5. Production preflight (dry run)

Default mode is **dry run**. A dry run performs every validation and mutates
nothing. Run it first and read the JSON result.

```bash
npm --prefix platform/functions run build
node platform/functions/lib/scripts/admin/bootstrap-platform-administrator.js \
  --operation bootstrap --mode dryRun \
  --project-id <PROJECT_ID> \
  --target-uid <UID> \
  --target-email <EMAIL> \
  --expected-current-role teacher \
  --target-role platformAdministrator \
  --expected-school-id <SCHOOL_ID> \
  --change-ticket <TICKET>
```

Credentials: `gcloud auth application-default login` (or
`GOOGLE_APPLICATION_CREDENTIALS` pointing at a service-account key with Firebase
Admin permissions on the intended project). The CLI binds Firebase Admin to
`--project-id` **explicitly** (`initializeApp({ projectId })`); it does not
infer the project from `GCLOUD_PROJECT` / `GCP_PROJECT` / credential inference /
a CLI alias. Application Default Credentials supply auth material only, not the
project selection. Before any read or write the tool verifies the effective
bound project equals `--project-id` and fails closed on divergence
(`bootstrap.projectMismatch`, plus a hard pre-flight binding assertion). This is
the wrong-project guard, and it targets the actual bound Auth/Firestore
clients.

**Emulator endpoint rejection (8G.12B).** BEFORE any app init, client, or
read/write, the tool refuses to run if `FIRESTORE_EMULATOR_HOST` or
`FIREBASE_AUTH_EMULATOR_HOST` is set and non-empty. firebase-admin silently
honors these to redirect Firestore/Auth to a local emulator; permitting them
could create an emulator/production split-brain (e.g. Firestore validated
against the emulator while Auth claim replacement / token revocation hit
production) even with a matching project string. The tool refuses rather than
sanitizing or unsetting them. Only the two variables for the services this tool
touches are checked; unrelated emulator variables are left untouched. Unset
them and re-run against the real project.

**App binding (8G.12B).** The tool uses and validates the `[DEFAULT]` Firebase
app (Option B - every canonical shared helper derives from it). It resolves the
default app via the `getApp()`-throws pattern (never `getApps().length`, which
is non-empty even when only an unrelated named app exists): if no default app
exists it initializes a fresh one bound to `--project-id`; if one already
exists it is reused ONLY when explicitly bound to `--project-id`, else it fails
closed. An unrelated named app is never reused, and no existing app is mutated
or deleted.

A clean dry run reports `outcome: "dryRunOk"` with the intended
`previousRole` / `newRole` and resolved `schoolId` / `districtId`, and makes no
mutation. Any missing prerequisite instead surfaces the specific fail-closed
error.

---

## 6. Apply (canonical-first ordering)

Apply requires the exact acknowledgements. Missing or wrong acknowledgements
fail closed (`bootstrap.acknowledgementMissing`).

```bash
node platform/functions/lib/scripts/admin/bootstrap-platform-administrator.js \
  --operation bootstrap --mode apply \
  --project-id <PROJECT_ID> \
  --target-uid <UID> \
  --target-email <EMAIL> \
  --expected-current-role teacher \
  --target-role platformAdministrator \
  --expected-school-id <SCHOOL_ID> \
  --change-ticket <TICKET> \
  --production-ack I_UNDERSTAND_THIS_MUTATES_PRODUCTION \
  --apply-ack I_UNDERSTAND_THIS_APPLIES_A_ROLE_CHANGE
```

Ordering (never claims-first):

1. **Canonical Firestore transaction + lineage + audit (atomic).** The role
   transition (`role: teacher -> platformAdministrator`, every other field
   preserved), the durable `platformAdminBootstrap/initial` lineage create, and
   exactly one `users.roleChanged` audit event commit together, or none commit.
2. **Auth claims replacement.** After the transaction commits, custom claims are
   **replaced** (not merged) with the canonical shape
   `{ role: "platformAdministrator", schoolId, districtId }`. Stale claims are
   erased by the atomic replace.
3. **Refresh-token revocation.** Outstanding refresh tokens are revoked.

### `users.roleChanged` audit semantics

- `actorRole`: `system`; `actorUserId`: the stable, non-PII bootstrap actor id
  (`system-bootstrap-platform-administrator`).
- `targetType`: `user`; `targetId`: the target UID.
- Top-level `schoolId` / `districtId`: the canonical association observed in the
  transaction.
- `payload`: `{ previousRole, newRole, reason }` only. `reason` is
  `initialBootstrap` (bootstrap) or `rollback`, a low-cardinality category, never
  free text.
- `correlationId`: the change ticket.
- No email, OAuth identifier, token reference, or free-form note is ever stored.
- Exactly one event per canonical transition. A repair replay emits none.

### Required reauthentication

Claims take effect on a fresh ID token. The target must **sign out and back in**
so the new administrator claims are minted; refresh-token revocation forces this.

---

## 7. Partial-failure repair (replay)

Firestore and Firebase Auth cannot share one transaction. If the Firestore
transaction commits but claims replacement or token revocation fails:

- The canonical role transition stays committed (it is **not** rolled back
  automatically). Authorization boundaries fail closed on canonical state, and
  the authoritative administrator guard (Section 9) refuses a caller whose
  canonical role/status does not match, so a partially completed bootstrap
  cannot confer authority through a stale claim.
- Re-run the same apply command **with the same change ticket**. The tool
  detects the already-committed canonical transition, **requires the durable
  lineage to match** this exact bootstrap (same target, source role,
  school/district, reason, correlation, version), and then **repairs only the
  Auth side** (claims + token revocation), idempotently, **without emitting a
  second audit event or a second lineage**. If the canonical role is already
  administrator but the lineage is absent or conflicting, the tool fails closed
  (`bootstrap.lineageMissing` / `bootstrap.lineageConflict`) and repairs
  nothing - it never adopts manually created administrator state.

Reported outcomes distinguish the states:

- `applied` - fresh transition + lineage + audit committed, claims replaced, tokens revoked.
- `repairedAuth` - canonical role already transitioned (lineage proven); claims
  were inconsistent and were repaired (no second audit); tokens re-revoked.
- `alreadyComplete` - canonical role and claims already consistent (lineage
  proven); no audit, no claims write; tokens re-revoked idempotently.
- `dryRunOk` - preflight only.

Other states fail closed: conflicting/missing lineage, conflicting existing
administrator, wrong project, UID/email mismatch, wrong expected role, wrong
school acknowledgement, disabled identity, missing identity, missing canonical
user, malformed canonical user (including missing email/displayName/createdAt or
an email that disagrees with the Auth identity), invalid change ticket,
unexpected privileged target.

---

## 8. Rollback (paired, audited demotion)

Rollback is a first-class mode, not a manual Firestore edit. It derives its
target UID and destination role **from the durable lineage** (`previousRole`),
never from an arbitrary operator argument: `--target-uid` and `--target-role`
are cross-checked against the lineage and must match, so rollback can only
reverse the recorded initial-bootstrap transition and can never be turned into a
general teacher/student/admin role editor (`bootstrap.rollbackTargetMismatch` /
`bootstrap.rollbackDestinationMismatch`). In one transaction it restores the
lineage `previousRole`, flips the lineage `state` to `rolledBack`, and appends a
`users.roleChanged` audit with `reason: rollback`; then it replaces claims with
the restored-role shape and revokes refresh tokens (forcing reauthentication).
A rollback partial-Auth failure is repaired by re-running rollback, which
repairs only the Auth side without a second rollback audit.

```bash
node platform/functions/lib/scripts/admin/bootstrap-platform-administrator.js \
  --operation rollback --mode apply \
  --project-id <PROJECT_ID> \
  --target-uid <UID> \
  --target-email <EMAIL> \
  --expected-current-role platformAdministrator \
  --target-role teacher \
  --expected-school-id <SCHOOL_ID> \
  --change-ticket <TICKET> \
  --production-ack I_UNDERSTAND_THIS_MUTATES_PRODUCTION \
  --rollback-ack I_UNDERSTAND_THIS_ROLLS_BACK_A_ROLE_CHANGE
```

Rollback refuses if there is no durable lineage (`bootstrap.lineageMissing`) or
if the canonical state has drifted unexpectedly (the target is not the
lineage-recorded active administrator, or its school/district no longer matches
the lineage): `bootstrap.rollbackDrift`. Because demotion interacts with stale
claims, the authoritative administrator guard hardening (Section 9) is a
prerequisite for treating this tool as production-ready.

**Strict lineage validation (8G.12B).** Both rollback and bootstrap replay run
one authoritative lineage validator before acting. The lineage must be
structurally and semantically valid or the tool fails closed
(`bootstrap.lineageVersionUnsupported` for an unknown/future `version`;
`bootstrap.lineageConflict` for a wrong `reason`, a `newRole` other than
`platformAdministrator`, a `previousRole` outside the supported source-role
allowlist - currently `teacher` only, so `platformAdministrator` and arbitrary
strings are refused - a malformed `targetUid`/`schoolId`/`districtId`, a
`correlationId` that is not a valid change ticket, a `state` outside the closed
`{active, rolledBack}` vocabulary, a `createdAt` that is not a canonical
timestamp, or - when `rolledBack` - a missing `rolledBackAt` timestamp or a
malformed `rollbackCorrelationId`). "Anything except `rolledBack`" is never
treated as active.

**Rollback-repair correlation binding (8G.12B).** Once a rollback has committed
(`state == rolledBack`), a repair replay requires `--change-ticket` to equal
the stored `rollbackCorrelationId`; a different ticket fails closed
(`bootstrap.rollbackCorrelationMismatch`) BEFORE any Auth mutation and without
emitting an audit. Same-ticket replay repairs only the Auth side (claims +
token revocation) with no second rollback audit.

---

## 9. Administrator authorization hardening (Phase 8G.12 Part 2/14, 8G.12A)

The four administrator callables (`schoolsCreate`,
`teachersApproveVerification`, `teachersDenyVerification`,
`identityMigrationRunProductionInventory`) previously trusted only the signed
administrator claim. Authority now requires ALL of:

- signed `platformAdministrator` role claim;
- canonical `users/{uid}` with `authUid === uid`;
- canonical `status === "active"`;
- canonical `role === "platformAdministrator"`.

Tenant context (`schoolId`/`districtId`) is derived from canonical user/school
records, not from token claims. A stale administrator token cannot retain
authority after canonical demotion, suspension, archival, or `authUid`
divergence.

**8G.12A: transactional (mutation-time) revalidation.** The three **mutating**
callables (`schoolsCreate`, `teachersApproveVerification`,
`teachersDenyVerification`) keep the cheap `requireActivePlatformAdministrator`
guard for early rejection, but the AUTHORITATIVE check now runs INSIDE the same
Firestore transaction as the mutation and audit
(`assertActivePlatformAdministratorInTransaction`). An administrator demoted or
suspended after the cheap guard passes but before the transaction commits is
observed transactionally, so the mutation and its audit do not commit (closing
the demotion race). For `teachersApproveVerification`, the Auth-side claims
write happens only after the transaction commits, so a refused transaction
never issues teacher claims. `teachersSuspend` retains its existing stronger
in-transaction administrator validation.

**`identityMigrationRunProductionInventory` (read-only) per-page
revalidation.** This callable scans exactly one Firebase Auth page per
invocation and returns `nextPageToken`; the operator drives pagination by
re-invoking. The authoritative administrator check therefore runs at every page
boundary, so a demoted administrator is refused on their next page call and
cannot continue a long privileged scan. It is read-only and idempotent, so no
Firestore transaction is used - bounded per-page revalidation is the correct
control.

---

## 10. Prohibitions

- Do NOT hand-edit `users/{uid}.role` or custom claims to grant or remove
  administrator authority. Use this tool (bootstrap or rollback) so the change
  is transactional, audited, and Auth-consistent.
- Do NOT use this tool for routine administrator management. It is the
  first-admin lifecycle operation, gated by the zero-admin precondition.
- Do NOT elevate `labzlyfe@gmail.com`. It stays a teacher until the later
  cleanup phase.
- Do NOT weaken `teachersSuspend` self-target protection to solve an
  administrator lifecycle problem.
- Never print tokens or secrets. The tool prints only non-secret role/tenant
  context and step logs.

---

## 11. Instructional-history preservation of an existing-teacher administrator

The first production administrator (`cgbreezy7@gmail.com`) is an existing
teacher with instructional / Google Classroom / LMS history. The bootstrap
preserves that history. Concretely, bootstrap mutates ONLY:

- the target's canonical `users/{uid}.role`;
- the durable `platformAdminBootstrap/initial` lineage document;
- the `users.roleChanged` audit event;
- the target's Auth custom claims;
- the target's Auth refresh-token validity.

It does NOT delete or disconnect Google Classroom, delete classes, class links,
assignments, attempts, or teacher history, rewrite ownership, migrate
instructional records, or touch the teacher pilot allowlist. Rollback mutates
only the corresponding reverse lifecycle surfaces.

While the canonical role is `platformAdministrator`, teacher-only operational
access is no longer available to the account (authorization keys on the current
role), and the historical instructional/LMS records remain preserved and
dormant. That is acceptable for this phase and consistent with the current
authorization architecture. The account is **not** pristine or
non-instructional, and must not be described as such.

---

## 12. Current tenant-context requirement for `platformAdministrator`

Under the current implementation, a `platformAdministrator` carries canonical
`schoolId` and `districtId` context (the canonical claims writer requires both
as non-empty strings for every role, and the bootstrap sets them from the
target's canonical school/district). This resolves the historical ambiguity in
`DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §6 / G-10A-3 and
PDR-025h about an administrator school/district "sentinel": the current
architecture does **not** implement an absence-of-district/school sentinel and
does **not** implement a global administrator. No future global/sentinel
administrator model is introduced in this phase.
