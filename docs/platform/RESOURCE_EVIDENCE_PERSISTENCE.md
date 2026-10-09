# Resource Evidence Persistence (RA-3A)

Server-side persistence for authenticated, resource-specific evidence:
working evidence, server-verified outcome runs, an immutable submitted
snapshot, and server-controlled submission metadata. Owned by Resource
Architecture. Builds on `RESOURCE_COMPLETION_EVIDENCE_CORE.md` (RA-2) and
implements part of `LYFELABZ_NON_LESSON_ASSESSMENT_EVIDENCE_STANDARD.md`
§11.5 and §11.9 (items 1 and 3).

Status: implemented and tested, **not operational**. Nothing is exported
from `platform/functions/src/index.ts`, so no callable is deployed. The
only production dependencies fail closed (below). No Rules, index, or
assignment change was made. Gravity Wells and every other non-lesson
resource remain unassignable.

RA-3B (`FROZEN_COMPLETION_DEFINITIONS.md`) supplied both integration
prerequisites: immutable `completionDefinitions/{assessmentRevisionId}`
records and a `completionBinding` frozen at publication. It replaced the
two ports' shapes, added inactive Firestore adapters, and added
`definitionHash` to the stored binding. Production deps still fail closed.

## Location

`platform/functions/src/resourceEvidence/`:

| File | Contents |
| --- | --- |
| `resource-evidence-record.ts` | Collection, record and write shapes, local typed refs |
| `evidence-assignment-context.ts` | Identity and entitlement resolution; the two integration ports |
| `evidence-request.ts` | Exact request shapes, size limits, canonical JSON, operation hashing |
| `run-observation-policy.ts` | Run verification allocation (guaranteed floor, bounded pool) |
| `resource-evidence-service.ts` | Get, save working, record run, submit |

Tests: `evidence-request.test.ts` (hermetic) and
`resource-evidence.emulator.test.ts` (Firestore emulator), plus
`platform/firebase/tests/resource-evidence.rules.test.ts`.

## Authoritative sources

| Need | Source |
| --- | --- |
| Student identity | Verified ID token + canonical `users/{uid}` and `schools/{schoolId}` through `requireDistrictContext` (record wins over claims); role must be `student` |
| Entitlement | `assignments/{assignmentId}` (same school, `classroom` mode, `published` for writes, `published` or `closed` for reads) and active `enrollments/{classId}__{uid}`, the sources `assessmentSessionsBegin` uses |
| Current occurrence | `isSupersededOccurrence` (`assignments/current-occurrence-group.ts`); writes refused on a superseded or inactive occurrence |
| Resource identity | Assignment `lessonSlug` + `resourceType`, checked with `assertActivityIdMatchesResourceType`; lessons refused |
| Assessment revision | Assignment `assessmentRevisionId` (frozen at publication, PDR-031), checked with `frozenRevisionOrdinal` |
| Frozen binding | **Port** `FrozenCompletionBindingSource`: the assignment's `completionBinding` (RA-3B adapter `ASSIGNMENT_RECORD_COMPLETION_BINDING`, inactive) |
| Definition content | **Port** `CompletionDefinitionStore`: `completionDefinitions/{assessmentRevisionId}` (RA-3B adapter `FIRESTORE_COMPLETION_DEFINITION_STORE`, inactive), verified with `verifyFrozenCompletionBinding` (hash, RA-2 schema, validators, identity) |

A client assignment id is only a lookup key. Not found, another school,
not enrolled, withdrawn, draft, archived, practice mode, lesson, and a
type that disagrees with its identifier all return one refusal,
`resourceEvidence.forbidden`, so the response is not an oracle.

## Integration boundary (why nothing is operational)

Historical record of the RA-3A boundary. RA-3B has since implemented both
prerequisites (see `FROZEN_COMPLETION_DEFINITIONS.md`); the operational
path stays disabled behind the activation blockers listed there. As
originally written, two prerequisites did not exist:

1. **Frozen definition version.** `assignmentsPublish` freezes only
   `assessmentRevisionId`, and `assertAssignableActivity` refuses every
   non-lesson type at draft creation and publish. No assignment carries a
   completion-definition version.
2. **Published definition store.** The only definition is the Gravity Wells
   DRAFT TypeScript constant. A constant does not establish publication
   immutability.

They are ports. `PRODUCTION_RESOURCE_EVIDENCE_DEPS` returns null from both,
so every call is refused with `resourceEvidence.completionBindingUnavailable`
and nothing is written (emulator-tested). Tests inject fixtures; the DRAFT
definition is used only as a test fixture. Publication must freeze the
definition version with the assignment (standard §16 Q2 recommends binding
it to the assessment revision) and store definitions immutably. The client
never selects a version, and the newest definition is never substituted.

## Storage

`resourceEvidence/{assignmentId}__{studentId}` (one record per assignment
occurrence and student; no unit, attempt, session, or score field):

| Group | Fields | Writer rule |
| --- | --- | --- |
| Ownership | `studentId`, `assignmentId`, `classId`, `teacherId`, `schoolId`, `districtId` | Written once at creation |
| Binding | `resourceId`, `resourceType`, `assessmentRevisionId`, `definitionVersion` | Written once at creation |
| Working evidence | `workingJson` (canonical `{authored, attestations}`), `workingBytes`, `workingRevision`, `lastWorkingOperationId`, `lastWorkingPayloadHash` | CAS on `workingRevision` |
| Accepted runs | `runs[]` (`operationId`, `payloadHash`, `flightId`, `validatorId`, `validatorVersion`, `reportedParametersJson`, `parametersJson`, `truncated`, `cost`, `outcomes`, `undetermined`), `runsRevision` | Atomic append |
| Server metadata | `status` (`working` / `submitted`), `submitOperationId`, `submittedAt`, `evidenceEligibleAt`, `createdAt`, `updatedAt` | Server only |

`resourceEvidence/{recordId}/submissions/submitted`: the frozen snapshot
(canonical RA-2 `ResourceEvidence` JSON), the revisions it was taken at,
`verifiedOutcomeIds`, `undeterminedRunIndexes`, `eligible: true`,
ownership, binding, and `submittedAt`. Written once with `create`; no code path updates it.

Every call re-resolves the context and refuses a stored record whose
ownership (`resourceEvidence.forbidden`) or binding
(`resourceEvidence.bindingMismatch`) disagrees, without reading or
changing it.

## Firestore ownership

No Rules block opens `resourceEvidence`. The terminal default-deny refuses
every client role, including the owning student, so evidence, outcomes,
eligibility, and snapshots cannot be written directly. Admin SDK writes
bypass Rules, so all authorization is server side in the resolver above.
A Rules emulator test covers read, list, collection-group list, create,
update, and delete for five identities. No Rules change; no index needed
(all access is by document id).

## Operations

Requests have exact shapes. Any extra field is refused
(`resourceEvidence.invalidRequest`): no student, teacher, class, school,
district, resource, revision, definition version, validator, outcome,
mission, success, eligibility, status, or timestamp.

| Operation | Request | Behavior |
| --- | --- | --- |
| Get own | `assignmentId` | Read access; returns working evidence, runs (flight id, outcomes, capped flag), verified outcome ids, status |
| Save working | `assignmentId`, `operationId`, `expectedWorkingRevision`, `working{authored, attestations}` | Validated by RA-2 `parseResourceEvidence` against the frozen definition with the server binding; 256 KiB canonical limit |
| Record run | `assignmentId`, `operationId`, `flightId`, `parameters` | Validator chosen from the frozen definition (exactly one per definition in this schema); verified, then appended |
| Submit | `assignmentId`, `operationId`, `expectedWorkingRevision`, `expectedRunsRevision` | Evaluated by RA-2 `evaluateCompletionEligibility` on the stored content; accepted only when eligible |

Request limits: 1 KiB (get, submit), 4 KiB (record), 300 KiB (save).

## Idempotency and concurrency

- Validation and validator computation run **outside** transactions.
  Transactions only re-read, compare, and write, so an automatic retry never
  repeats physics.
- **Save:** `expectedWorkingRevision` must equal the stored revision
  (`resourceEvidence.writeConflict` with the current revision). A retry of
  the save that produced the current revision (same `operationId`, same
  hash) is acknowledged; the same id with a different payload is
  `resourceEvidence.operationConflict`. Only the last save's id is kept;
  an older id reused differently fails the revision check instead.
- **Record run:** replays and duplicates are settled from a plain read
  before any physics, then the new run is verified outside the transaction
  within its allowance. The append transaction re-reads the run list and
  re-checks duplicates, capacity, and the budget invariant. If concurrent
  runs consumed pool budget the window assumed, the run is re-verified
  outside the transaction (up to 3 attempts, then
  `resourceEvidence.writeConflict`; the client retries with the same ids).
  Same `operationId` and hash: replay. Same id, different hash:
  `operationConflict`. Concurrent records of different runs all land (no
  lost update, emulator-tested).
- **Retries after close.** A retry of a run or save that already landed
  (same id and payload) is acknowledged without writing, even after the
  window closes, the occurrence is superseded, or the evidence is
  submitted. Entitlement (active student, active enrollment, same school,
  binding) is still checked first. Every new write, including a repeated
  flight under a new operation id, is refused once the assignment is not
  writable.
- **Submit:** both revisions must match at evaluation and again inside the
  transaction. A save racing a submit either lands first (submit refused as
  stale, nothing frozen) or is refused after (`alreadySubmitted`); the
  snapshot is always exactly the evaluated content. A retried submit with
  the same `operationId` is acknowledged from the stored record, even after
  the window closes.
- A rejected request writes nothing, so accepted evidence is never damaged
  (emulator-tested with whole-document equality).

## Immutable submitted evidence

Pilot rule (standard §16 Q5): evidence is frozen at its one submission.
Submission is accepted only when the server evaluates the stored content as
eligible; otherwise `resourceEvidence.requirementsUnmet` with the unmet
stage ids, and nothing changes. A student can therefore never freeze an
incomplete record and be locked out of the occurrence. After submission,
save, record, and a new submit are refused (`alreadySubmitted`). There is
no teacher approval or review step.

`evidenceEligibleAt` is recorded at submission and is sticky. It is **not**
the quiz gate: `assessmentSessionsBegin` and `assessmentAttemptsFinalize` do
not read it (RA-4).

## Outcome runs and computation

Runs are verified by the registered RA-2 validator; client success claims
have no field. A valid unsuccessful run (a crash) is stored as evidence with
no outcomes. Malformed or out-of-range parameters are refused whole.

### Verification allocation

RA-2 shares one budget (4,000,000 units; one unit is one Gravity Wells
integration step) across a snapshot's runs in order, at most 50 runs.
Accumulated over an assignment, one long flight (a probe left orbiting in an
open tab) could consume it, and every later run would be undetermined. The
persistence layer therefore decides each run's window
(`run-observation-policy.ts`):

| Limit | Value | Basis |
| --- | --- | --- |
| Guaranteed floor per run slot | 20,000 | 50 x 20,000 = 1,000,000 reserved. Covers RA-2's late Sun escape (call 11,711) and every mission in a 6,000-launch grid except two late flybys. |
| Maximum per run | 1,000,000 | At most a quarter of the budget; about 6.8 times the latest known outcome. |
| Shared pool | 3,000,000 | The rest of the budget, granted in record order. |

A run's allowance is
`min(1,000,000, 4,000,000 - storedCost - 20,000 x slotsAfterThis)`, and it is
charged its **actual** cost (what the validator spent), so a run that
crashes early leaves the pool untouched. Invariant, checked inside the append
transaction: after n runs, `storedCost <= 4,000,000 - 20,000 x (50 - n)`.
Every later run therefore keeps at least the floor, and a stored snapshot
never exceeds the RA-2 budget.

Known late outcomes are preserved:

- Black Hole flyby (RA-2 parity case): observed to call 84,427 the flight is
  still going (no flyby, determined: the student reset); observed to call
  84,428 the escape is detected and the flyby credited (cost 84,427).
- Grid sweep (4 masses, 25 speeds, 60 angles, observed 400,000 calls): two
  more Black Hole flybys at calls 130,712 and 147,455. Both are credited.
- The earlier equal 80,000-call share lost all three and reported them as an
  ended observation. That was the defect.

A run observed longer than its allowance is verified over its allowance only
(`truncated`; the declared observation is shortened, the physics is not
touched; the reported parameters are kept). If the flight was still going
when the window ended (cost equals the window), the run is stored
`undetermined`: missions inside the window are verified, later ones are
neither credited nor refuted, exactly RA-2's undetermined meaning. A
truncated run that crashes or escapes inside the window is determined. This
never over-credits: under the RA-2 trust model a shorter observation can only
lose credit. Undetermined runs are reported by the get operation and recorded
in the snapshot's `undeterminedRunIndexes`.

When the pool is exhausted by earlier long runs, a later late outcome (for
example the 84,428-call flyby) can fall outside the floor and be
undetermined. Every required Gravity Wells mission can still be earned
inside the floor (Earth and Jupiter orbits at call 240, Black Hole survival
at 120, Sun escape and flybys typically within 1,000 calls).

Consequences and checks:

- Stored runs never exceed the budget, so each run's result is independent
  of the others and of order. A new run is verified alone at record time.
- Submit re-runs the RA-2 evaluator on the whole snapshot and refuses
  (`resourceEvidence.corruptRecord`) if stored costs exceed the budget, the
  evaluator reports an undetermined run, or its verified outcomes differ
  from the stored ones.
- Duplicates and replays cost no computation.
- Timing (compiled code, one machine, median of 5): about 3 ms for 80,000
  steps and about 130 ms for 4,000,000 steps, so a maximum run is about 33 ms
  and a full submit about 130 ms. These are provisional engineering limits
  derived from the RA-2 budget and observed mission timing, not production
  load certification.

### Capacity

At most 50 runs (RA-2 `maxOutcomeRuns`). Slots stay reserved for every
declared outcome not yet verified: a run that earns no new outcome is
accepted only while `runs < 50 - unverified`. Analysis:

- Repeated unsuccessful launches fill at most `50 - unverified` slots (45 at
  the start for Gravity Wells). A run that earns a new outcome always fits,
  and the budget floor guarantees it can be verified, so failed launches can
  never permanently block a required mission (tested to a full record and a
  successful submission).
- Duplicates (same flight, or identical parameters) consume neither a slot
  nor budget, so repeated terminal callbacks cannot exhaust capacity.
- Storage is bounded (50 runs of a few hundred bytes plus 256 KiB of text).
- Once full, further runs are refused with
  `resourceEvidence.runCapacityReached`. Nothing accepted is evicted or
  rewritten; the refusal is explicit, not silent. Fabricated runs gain
  nothing: outcomes are recomputed, and identical or failing runs earn no
  credit.

The cost of this policy is that unsuccessful launches after the cap are not
recorded as evidence. Whether a teacher evidence view needs more of them is a
product decision (below); it does not affect eligibility or safety.

## Gravity Wells flight correlation

The page keeps terminal state when relaunched without a reset, and RA-2
verifies independent reset-origin flights. The contract:

- `flightId` is a browser-supplied correlation hint for one reset-origin
  flight. It proves nothing.
- Same `flightId`, same parameters (a repeated terminal callback):
  acknowledged as `duplicate`, nothing stored, no credit change.
- Same `flightId`, different parameters: `resourceEvidence.flightConflict`.
- New `flightId`, parameters identical to a stored run: `duplicate`.
  Validators are deterministic, so a repeat can never add credit and never
  consumes capacity or budget. Duplicates are settled before any physics.
- Credit is a set of outcome ids, so even accepted duplicates could not
  inflate it.

`observedInvocations` is student-reported and untrusted. Verification
establishes only that the declared trajectory reproduces the credited
outcomes over that observation interval (capped as above). It does not
prove the student watched the simulation or performed the drag. The
verification window (above) bounds how much of that interval the server
replays.

The public page sends nothing today and is unchanged. **RA-5 client
requirement:** on the authenticated delivery path, mint a `flightId` at each
reset-origin `launchProbe`, count executed `runOrbitLoop` calls (the direct
call included), and report once when the flight crashes, escapes, or is
reset. A relaunch without reset must not be reported as a new reset-origin
flight (RA-2 does not model it). Until then the operational path stays
disabled.

## Dependencies

**RA-4 (assessment eligibility):** add the non-lesson eligibility check to
`assessmentSessionsBegin` and repeat it inside the
`assessmentAttemptsFinalize` transaction (standard §5.3, §11.7), reading this
record for the session's assignment. Decide the error vocabulary and how it
uses `evidenceEligibleAt` and the snapshot. Retakes neither read nor write
evidence (tested: evidence services never touch `assessmentSessions` or
`attempts`).

**Publication prerequisite:** done in RA-3B (frozen binding and immutable
store). Still open: per-resource assignability (standard §16 Q1).

**RA-5 (authenticated delivery):** host the evidence-capable page under the
authenticated path, call these services, and implement the flight contract
above. Wrap the handlers with `platformCallable`, export them, move the
typed refs into `shared/firestore/typed-ref.ts`, and switch the production
ports to `FROZEN_PUBLICATION_RESOURCE_EVIDENCE_DEPS`. Each step is a
separate, authorized change, gated on the RA-3B activation blockers.

**Teacher evidence read:** a future owning-teacher read of the submitted
snapshot (standard §9). Not built.

## Security and deployment limitations

- Not deployed and not callable. Wiring it requires the prerequisites
  above and a Functions deployment, separately authorized.
- No rate limiter exists. Abuse is bounded by request size, exact shapes,
  the 50-run cap with reservation, per-run computation, and CAS, not by a
  per-student request rate. Concurrent load, memory, cold starts, and abuse
  behavior are not tested; production readiness is not claimed.
- No audit event is written (student evidence is not a privileged action);
  logs carry ids, revisions, counts, and outcome codes, never student text
  or run parameters (tested).
- Retention and deletion of evidence records are not defined.
- Write gates (window, Current occurrence) are read before the write
  transaction, as in `assessmentSessionsBegin`; a write can land moments
  after a supersession. RA-4's finalize gate is the in-transaction check.

## Product decisions still open

1. **Unsuccessful launches beyond the cap.** Current: bounded retention, no
   eviction (45 unsuccessful runs at the start, up to 50 total). Alternatives:
   (a) keep as is; (b) evict the oldest non-crediting run (keeps recent
   attempts, but rewrites accepted working evidence before submission and
   needs an owner decision); (c) record only counts beyond the cap (a new
   field, more schema). Option (a) is safe and needs no decision to stay
   correct.
2. **Verification limits.** The 20,000 floor and 1,000,000 ceiling are
   engineering values. A larger floor shrinks the pool for long runs; a
   larger ceiling lets fewer long runs share it.

## Compatibility

- RA-1 projection and RA-2 core are unchanged and reused (not duplicated).
  `platformEvidence` stays false until the capability ships.
- No assignment gate, publication path, Units-owned behavior, student page,
  or Gravity Wells page changed. Evidence identity carries no teacher unit
  membership, so teachers can organize the same resource differently
  without affecting evidence.
- Each assignment occurrence has its own record; a new occurrence never
  inherits evidence or eligibility (tested).
