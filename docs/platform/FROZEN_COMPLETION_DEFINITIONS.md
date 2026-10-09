# Frozen Completion Definitions and Publication Binding (RA-3B)

Immutable, server-authoritative completion definitions for non-lesson
resources; atomic deployment with the assessment revision; a frozen
`completionBinding` on published non-lesson assignments; a publication
concurrency fix that applies to every assignment type; and the RA-3A
adapters that resolve the exact frozen definition. Owned by Resource
Architecture. Builds on `RESOURCE_COMPLETION_EVIDENCE_CORE.md` (RA-2) and
`RESOURCE_EVIDENCE_PERSISTENCE.md` (RA-3A), and implements standard
§11.3 and §16 Q2 of `LYFELABZ_NON_LESSON_ASSESSMENT_EVIDENCE_STANDARD.md`.

Status: implemented and tested, **not operational for non-lesson
resources**. Non-lesson assignability is unchanged (only `lesson` is
assignable), the RA-3A evidence callables remain unexported, and
`PRODUCTION_RESOURCE_EVIDENCE_DEPS` still fails closed. No Firestore Rules,
index, OAuth, or configuration change was made. The publication
concurrency fix is live code for lessons once Functions are deployed.

## Ownership boundary

| Owner | Owns |
| --- | --- |
| Resource Architecture | Completion-definition identity, the immutable record, deployment validation, the assignment `completionBinding`, and evidence integration |
| Curriculum and Units | Unit membership, resource ordering, and frozen unit context |
| Platform assignment publisher (`assignmentsPublish`) | The single authoritative publication mechanism for every assignment type |

RA-3B adds no second publisher. It extends `deployAssessmentRevision` and
`assignmentsPublish` in place. A completion definition and a binding carry
no unit, ordering, teacher, or navigation data, so Curriculum and Units can
add frozen unit context to the same publication transaction later without
changing completion identity. Any such addition must join the one
`assignmentsPublish` transaction (below) rather than write the assignment
separately, or it reintroduces the race this operation removed.

## Identity decision

- **One definition per assessment revision**, stored at
  `completionDefinitions/{assessmentRevisionId}`.
- **A completion-definition change requires a new assessment revision.**
  There is no second definition for a revision and no separate numeric
  progression: `definitionVersion` must equal the revision ordinal
  (`assessment_<resourceId>__r<N>` has `definitionVersion: N`). Deployment
  and every read enforce it.
- **Content hash for integrity:** `definitionHash` is the lowercase hex
  SHA-256 of `definitionJson`, the canonical JSON of the RA-2-normalized
  definition. Canonicalization reuses the shared `canonicalJson`
  (`shared/types/assessment-presentation.ts`, the assessment-presentation
  convention: sorted keys at every level, NFC strings, safe integers only).
  No second canonicalization algorithm exists. Authoring key order never
  changes the hash; a pinned hash test guards the procedure.
- **Immutable version identity for compatibility:** the revision id plus
  `definitionSchemaVersion`, `definitionVersion`, and the exact registered
  validator ids and versions.

The Gravity Wells TypeScript constant remains a DRAFT authoring source and
test fixture. It is never the authority for a published assignment: only
the stored record is.

## Record schema

`completionDefinitions/{assessmentRevisionId}`
(`shared/types/completion-definition.ts`):

| Field | Meaning |
| --- | --- |
| `recordSchemaVersion` | `1` |
| `assessmentId`, `assessmentRevisionId`, `revisionOrdinal` | The revision this definition is frozen with |
| `resourceId`, `resourceType` | The non-lesson resource (identifier grammar checked) |
| `definitionSchemaVersion`, `definitionVersion` | RA-2 schema; equals the revision ordinal |
| `definitionHash` | SHA-256 of `definitionJson` |
| `definitionJson` | Canonical JSON of the normalized definition (the only copy of the content) |
| `validators` | Distinct `{ validatorId, validatorVersion }`, sorted |
| `publishedBy`, `publishedAt` | Deployment provenance |

Every reader (`verifyCompletionDefinitionRecord`) checks, in order: present;
exact key set; supported record schema; `publishedAt` is a stored
timestamp (a non-array object with safe-integer `seconds` inside
Firestore's range 0001-01-01 through 9999-12-31 and integer `nanoseconds`
in [0, 1e9); null, arrays, and `serverTimestamp()` sentinels refused,
RA-3C); hash format; the hash reproduces
from `definitionJson`; the JSON parses; RA-2 `validateCompletionDefinition`
accepts it (which refuses an unsupported definition schema or unregistered
validator); the stored string is exactly the canonical form of what it
validates to; resource, type, revision, and ordinal identity; and every
denormalized field. Any failure is a stable issue code (below).

Storage: server-owned. No Rules block opens the collection, so the
terminal default-deny refuses every client role
(`platform/firebase/tests/completion-definitions.rules.test.ts`). The only
writer is `deployAssessmentRevision`, with `create`; no supported path
updates or deletes a record. Historical records stay readable because they
are keyed by revision and never overwritten.

## Assessment deployment

`deployAssessmentRevision` (`assessments/assessment-deployment.ts`):

- **Lessons:** unchanged. No completion definition is accepted, read, or
  written; the lesson item contract is unchanged.
- **Non-lesson resources** (an `activityId` with a reserved `<type>-`
  prefix): the identifier must follow the resource grammar; a
  `completionDefinition` is required; **exactly five** items are required
  (standard D-A; not a registry-wide rule); existing item validation is
  unchanged (single-choice, server-scored). The definition is validated with
  RA-2 and against the exact revision (resource, type, revision,
  `definitionVersion == revisionOrdinal`, registered validators) before any
  transaction runs.
- **One transaction** reads the assessment, revision, answer key, and
  completion-definition slots, then creates the revision, answer key, and
  definition (all with `create`) and advances `currentRevisionId`. A
  duplicate definition is refused (`assessmentDeployment.duplicateCompletionDefinition`)
  and a failed deployment leaves no partial revision or definition
  (emulator-tested). The result carries `completionDefinitionHash`.

Error codes: `missingCompletionDefinition`, `unexpectedCompletionDefinition`,
`invalidItemCount`, `invalidCompletionDefinition` (details carry the issue),
`duplicateCompletionDefinition`, all under `assessmentDeployment.`. The
operator CLI passes payloads through unchanged and was not run.

## Assignment `completionBinding`

Namespaced field on `assignments/{assignmentId}`, written only by
`assignmentsPublish` on the `draft` -> `published` transition, only for a
non-lesson type:

| Field | Source |
| --- | --- |
| `bindingSchemaVersion` | `1` |
| `assignmentId`, `classId` | The authoritative assignment record (occurrence identity) |
| `resourceId`, `resourceType` | The record's `lessonSlug` and `resourceType` |
| `assessmentRevisionId` | The revision frozen in the same write |
| `definitionSchemaVersion`, `definitionVersion`, `definitionHash`, `validators` | The verified stored record |

At publication the transaction resolves the current revision, reads its
completion definition, verifies it, builds the binding, and writes it with
`status`, `publishedAt`, `assessmentRevisionId`, the Current pointer, the
recipient snapshot, and the audit event in one commit. Any verification
failure refuses publication with `assignments.completionDefinitionUnavailable`
(details carry the issue) and writes nothing. Clients cannot supply or
replace it: no request field names it, no write shape but the publish write
carries it, and Rules deny every client assignment write. Lessons never
carry it. A published non-lesson assignment without a valid binding is
refused by every reader; nothing repairs it (an already-published record is
a no-op on republish).

Production gate: `assignmentsPublish` always uses
`PRODUCTION_ASSIGNMENT_PUBLICATION_POLICY` (the canonical
`assertAssignableActivity`), so non-lesson publication is still refused.
Tests use the explicit seam `__publishAssignmentWithPolicy` with a policy
that keeps the identifier/type check and allows the tested type. The seam
is not a callable and is not exported from `src/index.ts`.

## Publication concurrency

Before RA-3B, `assignmentsPublish` read the record and committed an
unconditional batch. Two concurrent calls could both observe `draft` and
both commit, rewriting the frozen revision, recipient snapshot, Current
pointer, and audit trail; and `assignmentsUpdateDraft` read then wrote
without a precondition, so an update read before publication could land on
the published record (for example changing `lessonSlug` after
`assessmentRevisionId` was frozen for the old one).

**Is a `lastUpdateTime` precondition enough?** On the publish batch alone,
no: it does not order the revision, definition, and population reads, and
it turns every benign loss into an error instead of an idempotent result.
On the draft update alone it would close that side, but it would also turn
two concurrent draft edits (today last-write-wins) into errors. Both paths
therefore use Firestore transactions:

- `assignmentsPublish`: one transaction reads the record, the current
  revision, the completion definition (non-lesson), and the enrollment
  population (all reads before writes), then writes the transition, binding,
  Current pointer, recipients, and audit event
  (`writeAuditEventInTransaction`). Firestore re-runs the function on
  contention; each attempt re-reads.
- `assignmentsUpdateDraft`: one transaction reads, checks `draft`, diffs,
  and updates. The audit event stays after commit, as before.

Results (all assignment types, emulator-tested):

1. Exactly one `draft` -> `published` transition commits.
2. Losers observe `published` and return `alreadyPublished: true` with no
   write, so the frozen revision, binding, recipient snapshot, pointer, and
   audit event are written once, by the winner.
3. A later republish (even after a new revision deploys or the class gains
   a student) changes nothing.
4. A draft update that loses to publication is refused with
   `assignments.invalidStatus`; one that wins is observed by the retried
   publication, which freezes the revision for the record as updated.
5. Contention that outlasts the SDK's retries is refused with
   `assignments.publishConflict` or `assignments.updateConflict` and writes
   nothing (stable, retryable).
6. The audit event commits with the transition, so it always describes the
   winning values (`assessmentRevisionId`, and `completionDefinitionHash` for
   non-lesson).
7. Current-pointer semantics are unchanged: publication still sets it
   unconditionally (Slice 5); two different drafts for one class and
   resource remain last-commit-wins by design.

Limits. The former 500-write cap no longer applies: current Firestore
documentation lists no fixed number of writes per transaction or batch
(the 500 figure is now the per-document field-transform limit), and Sol's
emulator run published 600 recipients (603 writes) in one commit. That run
is a functional check, not production load certification, and no recipient
cap is introduced. The constraints that do apply (Firestore "Usage and
limits", checked 2026-10-09):

- **Request size:** 10 MiB per API request. The publication commit is one
  request: the transition, binding, Current pointer, audit event, and one
  small recipient document per student.
- **Document size:** 1 MiB per document. The assignment record carries the
  binding (well under 1 KiB); a completion definition is bounded by the RA-2
  limits (at most 32 evidence prompts of 2,000 characters, and so on).
- **Transaction duration:** 270 seconds, with a 60-second idle expiration.
- **Contention:** reads lock documents for the transaction's duration
  (the emulator showed the reader winning and a competing transactional
  write being aborted and retried). Publication reads the class's
  enrollment documents, so large classes widen the lock set. Exhausted
  retries surface as `assignments.publishConflict`.
- **Security-rule access calls** (10 per single-document request, 20 per
  transaction or batch) do not apply: these paths run under the Admin SDK,
  which bypasses Rules.

## Archive (certification correction)

Sol reproduced a race in `assignmentsArchive`: it read the record, then
updated it and wrote its audit event separately, so a publication that
committed in between left the record archived with an audit recording
`previousStatus: "draft"`. Archive now runs in one transaction, following
the publication convention: it reads the record, enforces ownership, treats
`archived` as idempotent, stages `status: "archived"` and the audit event
(`writeAuditEventInTransaction`) with `previousStatus` from that snapshot,
and commits both together. Retries re-read; the transaction has no external
side effect (logging follows commit). Exhausted contention is
`assignments.archiveConflict`. Response shape, authorization, idempotency,
and the untouched Current pointer are unchanged. `archived` stays terminal
for publish and draft update.

The invariant is serializability, not a fixed winner: whichever of a
concurrent archive and publication commits first, the final committed
history is lifecycle-consistent and the archive audit names the state that
was actually archived. The Firestore scheduler decides the order; neither
transaction is promised to win. Emulator tests force interleavings with
test-only hooks (`__archiveAssignmentWithHooks`, awaited inside the
transaction) and assert committed outcomes: when a publication commits
before the archive, the archive retries, re-reads, and records
`previousStatus: "published"` with the frozen revision and binding
preserved; when the archive commits first, the publication re-reads
`archived` and is refused with nothing written. Concurrent archives yield
one transition and one audit; a failure after staging leaves no change.

## Reopen (RA-3C lifecycle hardening)

Sol reproduced a P1 race in `assignmentsReopen`: it read the record outside
any transaction, required `closed`, then wrote `published` and a separate
audit event unconditionally. Reopen reads `closed`, archive commits
`archived`, reopen writes `published`: the archived assignment was
resurrected. Two concurrent reopens could also both write and produce two
`assignments.reopened` audits for one transition.

Reopen now follows the archive convention in one `runFirestoreTransaction`:
it reads the record, enforces ownership against that snapshot, treats
`published` as idempotent (`alreadyPublished: true`, no write, no audit),
refuses every status other than `closed` (including `archived`) with
`assignments.invalidTransition`, stages the narrow `status: "published"`
write and the audit event (`writeAuditEventInTransaction`, payload
`{ classId, previousStatus }` with `previousStatus` from the snapshot), and
commits both together. A write that lands after the read forces a retry
that re-reads, so a concurrent archive either commits first (reopen re-reads
`archived` and refuses) or commits after the reopen (archive records
`previousStatus: "published"`). `archived` is terminal under every
interleaving. Exhausted contention is `assignments.reopenConflict` and
writes nothing. The response shape and authorization are unchanged; the
audit payload gains `previousStatus` (additive). Reopen never reads or
writes recipients, the frozen revision or `completionBinding`, or the
Current pointer.

`assignmentsClose` was verified and not changed: teacher closing is retired
and the handler holds no assignment write ref and no audit write, so a
stale read can only change which refusal or idempotent response it
returns.

Emulator tests (`__reopenAssignmentWithHooks`, test-only, not exported from
`src/index.ts`) cover reopen-reads-then-archive and archive-reads-then-reopen
(final state `archived`, audits consistent with whichever committed first),
archive before reopen, reopen before archive, concurrent reopens (one
transition, one audit), idempotency, failure after staging, a competing
write mid-transaction, ownership, frozen binding, recipient, and Current
preservation, and unchanged lesson reopen.

## RA-3A adapter integration

The ports in `resourceEvidence/evidence-assignment-context.ts` now return
raw data, and `resolveEvidenceContext` verifies all of it with the one
canonical verifier `verifyFrozenCompletionBinding`:

- `FrozenCompletionBindingSource.frozenBinding(assignmentId, assignment)`
  returns the stored binding. Adapter: `ASSIGNMENT_RECORD_COMPLETION_BINDING`
  (reads the already-loaded record).
- `CompletionDefinitionStore.publishedDefinition(assessmentRevisionId)`
  returns the stored record, addressed only by the frozen revision.
  Adapter: `FIRESTORE_COMPLETION_DEFINITION_STORE`.

Verification: binding schema and shape; the binding belongs to this
occurrence (assignment id and class); resource and type equal the
assignment's; the binding revision equals the assignment's frozen
`assessmentRevisionId`; the stored record verifies; and its hash, schema,
version, and validators equal the binding's. Failures are
`resourceEvidence.completionBindingUnavailable` with `details.issue`.

`ResourceEvidenceBinding` now retains `definitionHash`, so every evidence
record and submitted snapshot names the exact frozen content. A stored
record whose hash differs from the resolved binding is refused with
`resourceEvidence.bindingMismatch`. Authenticated identity, entitlement,
ownership, immutable snapshots, idempotency, verification budgets, and
undetermined-outcome semantics are unchanged.

The adapters are bundled as `FROZEN_PUBLICATION_RESOURCE_EVIDENCE_DEPS` and
are **not** used by any production path. `PRODUCTION_RESOURCE_EVIDENCE_DEPS`
still fails closed, and the handlers remain unexported.

## Fail-closed behavior

| Case | Where | Result |
| --- | --- | --- |
| Missing or deleted definition | publish, evidence | `missing` |
| Corrupted definition or hash mismatch | publish, evidence | `hashMismatch` / `corrupt` / `malformed` |
| Unsupported record or definition schema | deploy, publish, evidence | `unsupportedRecordSchema` / `unsupportedDefinitionSchema` |
| Unregistered validator | deploy, publish, evidence | `unregisteredValidator` |
| Resource identity mismatch | deploy, publish, evidence | `resourceMismatch` / `identityMismatch` / `bindingResourceMismatch` |
| Assessment revision mismatch | deploy, publish, evidence | `revisionMismatch` / `bindingRevisionMismatch` |
| Missing published binding | evidence | `bindingMissing` |
| Substituted binding | evidence | `bindingHashMismatch` / `bindingVersionMismatch` / `bindingValidatorMismatch` |
| Binding from another occurrence | evidence | `bindingAssignmentMismatch` |
| Conflicting or repeated publication | publish | one winner; `alreadyPublished` or `assignments.publishConflict` |
| Superseded assignment | evidence | writes refused (RA-3A rule, unchanged) |
| Evidence under a different definition revision | evidence | `resourceEvidence.bindingMismatch` |

The latest definition is never substituted for a frozen one.

## Historical reproducibility

A published occurrence names its revision and hash. Deploying a newer
revision creates a new record and advances `currentRevisionId`; it never
touches the older record or any published binding. The older occurrence
keeps resolving to its own record (emulator-tested), and handing it a newer
record is refused. The pinned-hash unit test fails if canonicalization or
hashing ever changes, which would otherwise break every stored hash.

## Tests

- `resourceCompletion/completion-definition-record.test.ts`: canonical JSON,
  pinned hash (independently reproduced), key-order independence, record
  preparation, every stored-record failure, binding parse and verification,
  historical reproducibility.
- `assessments/assessment-deployment.test.ts`: non-lesson deployment,
  five-item rule, lesson unchanged, refusals, no partial write.
- `assignments/assignments-publish.test.ts`,
  `assignments/assignments-update-draft.test.ts`: transaction structure,
  binding through the test seam, production gate, contention codes, retry
  observing a winner.
- `assignments/frozen-completion-publication.emulator.test.ts` (Firestore
  emulator): atomic and concurrent deployment, publication binding and
  refusals, concurrent publication, repeated publication after a new
  revision, draft-update races, historical occurrences, and RA-3A adapter
  resolution and refusals.
- `resourceEvidence/*`: RA-3A suites updated to the new ports.
- `platform/firebase/tests/completion-definitions.rules.test.ts`: default-deny.

## Dependencies

**RA-4 (assessment eligibility):** gate `assessmentSessionsBegin` and
`assessmentAttemptsFinalize` for non-lesson assignments on the evidence
record bound to the assignment's `completionBinding.definitionHash`.

**RA-5 (authenticated delivery and activation):** switch the evidence
ports to `FROZEN_PUBLICATION_RESOURCE_EVIDENCE_DEPS`, export the handlers,
open per-resource assignability (standard §16 Q1), and deploy a real
non-lesson assessment revision with its definition. Each is a separate,
authorized change.

## Activation blockers (retained, not resolved here)

- **A. Transaction-time authorization revalidation.** Evidence write gates
  (window, Current occurrence) are still read before the write transaction.
- **B. Aggregate computation and concurrency safeguards.** No rate limiter
  or load test; budgets are per record.
- **C. Independent Firestore persistence and Rules certification.** This
  operation's emulator and Rules tests are not an independent certification
  and nothing was exercised in staging or production.
- **D. Evidence retention and deletion policy.** Not defined.

## Deployment surfaces

When separately authorized: Functions only (`assignmentsPublish`,
`assignmentsUpdateDraft`, `assignmentsArchive`, and, from RA-3C,
`assignmentsReopen` behavior change for lessons; deployment code is
used by the operator CLI). No Rules, index, Hosting, or configuration
deployment is needed. No migration: existing assignments, lesson
publications, and assessment revisions are read unchanged.
