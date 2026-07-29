# Sprint 23F - Firestore TTL Operations

## Purpose

Sprint 23D introduced two durable Firestore-backed OAuth stores:

- `lmsOAuthStates/{state}` (server-issued state and PKCE verifier
  custody; ten-minute expiration window)
- `lmsTokenBundles/{tokenRef}` (per-teacher OAuth access and refresh
  token custody; retained for the lifetime of the LyfeLabz connection
  record)

Both collections are server-only (see
`platform/firebase/firestore.rules`
`lmsOAuthStates` and `lmsTokenBundles` blocks; every client operation
is denied). This document is the operational specification for the
Firestore TTL policy that removes expired OAuth state records.

The Sprint 23F repository work does NOT enable TTL and does NOT
deploy any TTL policy. TTL provisioning is a one-time operator
activity following the first production deploy.

---

## 1. TTL scope

TTL applies to exactly one collection:

- **Collection:** `lmsOAuthStates`
- **Field:** `expiresAt`
- **Field type:** `Timestamp` (Firestore native, ten minutes after
  issuance per `LMS_OAUTH_STATE_TTL_MS_FOR_FIRESTORE` in
  `platform/functions/src/lms/oauth-state/firestore-state-store.ts`)
- **Retention semantics:** documents are deleted once
  `expiresAt < now` and the TTL sweeper runs. Firestore's TTL SLA is
  approximate (typically within a few hours of the field value); this
  is acceptable because correctness does NOT depend on the sweeper -
  the consume path in
  `platform/functions/src/lms/oauth-state/firestore-state-store.ts:247`
  rejects on `now >= expiresAt.toMillis()` regardless of storage age.

TTL is NOT applied to `lmsTokenBundles`. Token bundles are held for
the lifetime of the corresponding `lmsConnections/{connectionId}`
record and are removed by `lmsConnectionsDisconnect` when the teacher
revokes the connection or by the token store's `revoke` method when
the server observes an authorization failure. Automatic expiry by TTL
would defeat the connection lifecycle contract.

TTL is NOT applied to `externalIdentities`. Sprint 23C-I records are
retained for the lifetime of the Firebase Auth user; the lifecycle
sprint that owns user deletion (currently unplanned) is the future
owner of any deletion or `revoked` transition per
`LMS_INTEGRATION_OPERATIONS.md` §17A.

TTL is NOT applied to `auditEvents`. The audit stream is append-only
per PDR-013 and the LyfeLabz Cloud Function Charter §2.

---

## 2. Provisioning procedure

TTL is provisioned once per Firebase project (production and, if
present, staging). The operational owner performs the provisioning
after the first successful Cloud Functions deploy per
`SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §8.

### 2.1 Firebase Console procedure

1. Open the Firebase Console for the target project.
2. Navigate to **Firestore Database** > **TTL**.
3. Click **Create policy**.
4. Set **Collection ID** to `lmsOAuthStates`.
5. Set **Timestamp field** to `expiresAt`.
6. Click **Create**.
7. Confirm the policy status transitions from **Provisioning** to
   **Serving** (typically within a few minutes).
8. Record the provisioning date and initiating principal in the
   operational runbook.

### 2.2 gcloud CLI procedure (equivalent)

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=lmsOAuthStates \
  --enable-ttl \
  --project=<firebase-project-id>
```

The command is idempotent. Re-running against a project that already
has the policy is a no-op.

### 2.3 Firebase CLI limitation

The Firebase CLI does NOT currently manage TTL as a first-class
resource. `firebase deploy --only firestore` does not create, update,
or delete TTL policies. Provisioning MUST go through the Firebase
Console or `gcloud` per §2.1 or §2.2.

---

## 3. Verification

After provisioning:

1. Confirm the TTL policy is **Serving** in the Firebase Console
   under **Firestore Database** > **TTL**.
2. Query `lmsOAuthStates` for documents with `expiresAt` more than a
   day in the past (through the Admin SDK; the collection is denied
   to every client role). Any such document is a TTL sweeper
   candidate. The count SHOULD converge to zero within the SLA
   window; a persistent nonzero count is a signal that the sweeper
   is not running.
3. Absence of the sweeper is NOT a correctness defect - the consume
   path rejects expired records unconditionally - but it is an
   operational storage-cost defect and should be reported to Firebase
   Support if the count remains nonzero for more than 24 hours after
   provisioning.

---

## 4. Rollback

Rollback is unusual but supported.

### 4.1 Firebase Console

1. Firebase Console > Firestore Database > TTL.
2. Select the `lmsOAuthStates.expiresAt` policy.
3. Click **Delete policy**.
4. Confirm deletion.

### 4.2 gcloud CLI

```bash
gcloud firestore fields ttls update expiresAt \
  --collection-group=lmsOAuthStates \
  --disable-ttl \
  --project=<firebase-project-id>
```

Rollback does not remove records that have already been swept. It
only prevents future sweeps.

---

## 5. Retention expectations

- **Pending OAuth state.** Ten minutes from issuance. Consumed by
  `lmsConnectionsComplete` or rejected as expired by the same path.
- **Consumed OAuth state.** Retained until the TTL sweeper runs
  (typically within a few hours of `expiresAt`). Retention past the
  consume timestamp is required so a replay attempt observes
  "already consumed" rather than "not found".
- **Orphaned OAuth state.** A record whose teacher never returned to
  the callback surface (browser closed, network failure) is
  correctness-safe to leave until TTL sweeps it. The store never
  reads such records after `expiresAt`.

Token bundle retention is governed by
`LMS_INTEGRATION_OPERATIONS.md` §7.2 and §9. This document does not
duplicate those procedures.

---

## 6. Cost posture

`lmsOAuthStates` sees exactly one write per `lmsConnectionsBegin`
and one write per `lmsConnectionsComplete` (the transactional consume
update). Under any realistic teacher-connection load the storage
footprint is small (tens to low hundreds of documents per day). TTL
prevents unbounded accumulation over the lifetime of the project.

`lmsTokenBundles` sees exactly one write per successful teacher
connection and one delete per disconnect. Storage grows with the
active-connection count, not with time. TTL is deliberately not
applied.

---

## 7. Non-goals

This document does NOT:

- authorize a Firestore Rules change on `lmsOAuthStates` or
  `lmsTokenBundles`,
- authorize a TTL policy on any collection other than
  `lmsOAuthStates`,
- authorize a scheduled purge outside the TTL sweeper,
- deploy TTL as part of the Sprint 23F repository work.

TTL provisioning is a post-deploy operator activity. Sprint 23F ships
this specification and updates the deployment runbook to reference
it; the live policy is not created by Sprint 23F.
