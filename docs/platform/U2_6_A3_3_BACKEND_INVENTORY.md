# U2.6 A3-3 backend inventory and implementation prerequisite

Status: investigation only. No backend enforcement has been implemented.
The mission requires reading the approved canonical A3 security design and
contract completion supplement before changing the implementation. Neither
source document was found in the supplied attachment or tracked repository.
`U2_6_A3_CONTRACTS.md` names both as its authority but does not include them.
Their location has been requested. This report does not replace either authority.

## Baseline and isolation

- Main: `/Users/breezy/Documents/GitHub/lyfelabz`, branch `main`.
- HEAD: `8ae51fe9e476503546148d4837bec3289502baf5`.
- Tree: `efc64bee4d2fc1324a3413c91c91791dd02b4e94`.
- Initial main status: clean; local `origin/main` has zero divergence.
- A fresh read-only `git ls-remote origin refs/heads/main` returned the same HEAD.
- Worktree: `/Users/breezy/Documents/GitHub/lyfelabz-a3-3-enforcement`.
- Branch: `codex/u26-a3-3-enforcement`, same HEAD/tree.
- Git exclude SHA-256:
  `e395c58812967140c82b007c340eedc3c9cb73a05f8f7a72eb1b047e9db68472`.

The app worktree tool initially chose its managed directory; `git worktree move`
relocated the checkout to the exact requested path. Git recognizes the worktree,
but the app's attach tool refused the relocated checkout as unmanaged. This is an
app attachment limitation, not a source or baseline change.

## Common authentication and authorization

Every handler calls `assertActiveTeacher`, which delegates to
`requireDistrictContext`. An authenticated UID, active canonical `users/{uid}`
record, teacher role, canonical school and resolvable district are required.
Signed role, school and district claims must agree with canonical records.
Those initial user/school reads are outside the operation transaction.

Every operation then uses `reassertTeacherContextInTransaction`: it reads the
canonical user and school in the operation's transaction, rechecks active teacher
status, unchanged school and district, and uses the verified actor for ownership
and audit attribution. Concurrent user/school changes join the read set and cause
Firestore retries. Unit ownership requires both teacher UID and canonical school;
missing and foreign units share the same not-found refusal.

No existing handler invokes the A3 availability policy, runtime resolver,
artifact provenance verifier or compatibility-envelope validator. Existing client
and build closure must not be confused with server availability enforcement.

## Exact nine-endpoint inventory

| Endpoint | Data access and transaction boundary | Receipt, audit and response behavior |
| --- | --- | --- |
| `teacherUnitsCapabilities` | Canonical authentication; read-only user/school reauthorization transaction. A2 project identity is checked afterward, using labels, Admin project and initialized Firestore project getter. No policy/evidence reads. | Strict schema 1/v1 nonce request; schema 1 response advertises v1 operations and placement. No receipts or audit. |
| `teacherUnitsList` | Reauthorization plus owner-and-school query in one read-only transaction; 1001-document overflow detection, then grade/archive filtering and deterministic projection. | No receipt/audit. Returns units from that authorized snapshot. |
| `teacherUnitsGet` | `readOwnedTeacherUnit`: reauthorization and owned unit read in one read-only transaction. | No receipt/audit. Same helper is used by post-commit mutation responses. |
| `teacherUnitsCreate` | Full existing request validation, then reauthorization, optional expected-school comparison, receipt read, and either original-unit replay or atomic unit/receipt/audit creation. Receipt already-exists retry reexecutes the transaction. | Teacher/school/key-scoped SHA-256 receipt; normalized grade/title/description request hash. Replay does not rewrite or audit. Fresh commit uses a second authorized unit-read transaction. |
| `teacherUnitsUpdate` | Full existing request validation; shared `mutateOwnedTeacherUnit` transaction reauthorizes, reads owned unit, plans changes, and compares revision before atomic update/audit. | Equal changes are a no-op before revision comparison; no audit or write. Written response uses a second authorized read. |
| `teacherUnitsArchive` | Same shared mutation transaction, for active-to-archived transition. | Already archived is a no-op; otherwise update and archive audit are atomic. Written response uses a second authorized read. |
| `teacherUnitsRestore` | Same shared mutation transaction, for archived-to-active transition. | Already active is a no-op; otherwise update and restore audit are atomic. Written response uses a second authorized read. |
| `teacherUnitsSetResources` | Request IDs are checked against canonical RA-1 placement; same shared mutation transaction verifies ownership/status and ordered membership changes. | Equal ordered IDs are a no-op; otherwise revision update and count-only audit are atomic. Written response uses a second authorized read. |
| `teacherUnitsReorder` | Own transaction reauthorizes, reads complete scoped organization, verifies all requested IDs and complete membership, then compares every revision before atomically updating/auditing moved units. | Already ordered is a no-op before revision comparison. Written response uses `listOwnedTeacherUnits` in a second authorized transaction. |

The six mutation endpoints are create/update/archive/restore/setResources/reorder.
The two management reads are list/get; capability discovery is the ninth endpoint.
No Teacher Units operation publishes assignments. The canonical assignment
publisher remains `assignments/assignments-publish.ts`. The separate LMS publisher
creates external pointers rather than replacing canonical assignment publication.
No alternative canonical publisher is needed or proposed.

## Integration boundaries identified

- Resolve A3-2 runtime identity against the same shared Admin Firestore client
  before canonical tenant reads. Previously initialized unbound clients refuse;
  they cannot be retrofitted. Shared process/client lifetime needs careful review.
- Preserve A3-1 exact policy validation at
  `platformConfig/teacherUnitsAvailability` and exact environment/placement.
- Read uncached policy and referenced release/activation documents in each
  authoritative transaction, before unit/receipt/replay/no-op decisions or writes.
  Reauthorize the user/school in that same transaction on every SDK retry.
- Reuse A3-1 release/evidence content-address and deployment/activation/mutation
  binding validators; do not duplicate their schemas or canonicalization.
- Reuse A3-2 runtime provenance only as consistency evidence. Even a matched
  result is unavailable and has unverified approval/deployment authority.
- No trusted signer/key, source-object retrieval, revocation resolver,
  certification authority or provider eligibility observer is configured by
  A3-1/A3-2. Their absence must deny availability; it is not permission to invent
  A3-6 evidence or accept synthetically shaped signatures.
- Require schema 1/v2 mutation compatibility independently of discovery. Keep it
  outside create intent hashes and receipt identity. Require original
  `expectedSchoolId` for v2 first attempts and replay.
- Apply fresh authorization and availability to post-commit response transactions.
  A refusal after commit must preserve the write and report unconfirmed outcome.

These are integration observations from the certified foundation reports and
code, not a substitute architectural approval or an implemented availability path.

## Contract differences reported before implementation

1. A2 discovery requires schema 1 and `teacher-units-v1`, advertises accepted v1,
   and has no availability declaration. A3-1 defines schema 2/v2 with explicit
   closed/unverified declarations and no accepted versions while unavailable.
   The mission also requires preserving A2 behavior until A3-4 and forbids
   premature v2 client activation. The authoritative design must be read to
   establish the approved server-side transition and legacy refusal behavior.
   No new v1 response fields or permissive legacy fallback have been invented.
2. All six mutation allowlists currently reject `compatibility` as an unknown
   field. Create's school binding is optional. A3 requires mandatory compatibility
   and v2 school binding even on replay; A3-4 remains a client dependency.
3. Existing post-commit reads reauthorize, but their refusals propagate ordinary
   errors without A3 `responseUnavailable`/unconfirmed outcome handling. The A3
   error table is currently inert, and the shared HTTPS translator lacks its exact
   mappings. This requires contract-preserving integration, not write rollback.
4. Runtime identity currently follows tenant reads in A2 discovery. A3-2 explicitly
   requires pre-read binding and rejects initialized unbound shared clients.

## Validation, integrity and dependencies

Investigation checks: main and isolated HEAD/tree/branch, initial cleanliness,
fresh remote synchronization, exact endpoint exports, authorization/transaction
boundaries, receipt/replay/no-op/post-commit paths, and repository searches for
the named architecture sources. No live tenant/provider inspection was performed.

Implementation tests, emulator tests, Functions typecheck, ESLint, isolated build,
placement/hash-vector and security-gate regressions were not run: no implementation
was made, and this document must not be represented as completed A3-3 validation.
Only this report is changed, unstaged and uncommitted. Main, all callable code,
A3-1/A3-2, application/client gate, multilingual architecture, RAP resources,
publisher, dependencies, Rules/indexes and deployment configuration remain intact.
No stage, commit, push, merge, deploy, activation or transfer to main occurred.

A3-4 client migration, A3-5 Rules lockdown, A3-6 release/approval/certification
tooling and A3-7 integrated security certification remain deferred. A3-3 is not
ready for independent implementation certification. Supply the approved security
design and completion supplement to resume implementation without guessing their
decisions. No operational approval evidence is requested or fabricated.
