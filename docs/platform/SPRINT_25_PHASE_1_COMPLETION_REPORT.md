# Sprint 25 Phase 1 Completion Report

**Date:** 2026-08-06
**Phase:** Sprint 25 Phase 1 — Google Classroom Adapter Go-Live and Publication Callable Hardening
**Status:** Complete (amended 2026-08-06 after pre-commit review)

> **Amendment note (pre-commit review, 2026-08-06).** A pre-commit review
> corrected three defects the original report described inaccurately: the
> publication timeout was a leaky `Promise.race` (no abort, uncleared
> timer) rather than the AbortController mechanism §2.3 requires; the new
> adapter test suite failed `npm run lint` (5 pre-existing `require-await`
> / unnecessary-assertion errors) so the "lint clean" claim was not
> reproducible; and the app verification narrative ("two failures → one")
> was not evidenced. The Review Corrections section below records the
> actual, re-measured state. Where this document and that section disagree,
> the Review Corrections section is authoritative.

---

## Scope

Sprint 25 Phase 1 activates two previously deferred adapter operations and hardens the `lmsAssignmentsPublish` callable's internal control flow. It does not change any external contract, any Firestore record shape, any audit event shape, any OAuth scope, or any client-side surface.

---

## Files Modified

### `platform/functions/src/lms/providers/google-classroom/__fixtures__/fixture-transport.ts`

Added `"insufficient-scope"` to the `FixtureFailureMode` union type and the corresponding `applyFailureMode` case. The new mode throws a `GoogleClassroomFixtureUpstreamError(403, "INSUFFICIENT_SCOPE", ...)`, which is the upstream signal that `translateUpstreamError` maps to `lms.insufficientScope`. Required by the adapter-level tests for `listClassTopics` and `publishAssignment`. The review added a second mode `"permission-denied"` (403 `PERMISSION_DENIED`) so the 403 split is regression-tested against both a scope 403 and a non-scope 403 (R2).

### `platform/functions/src/lms/providers/google-classroom/transport.ts` (added by review, R1)

Additive optional `signal?: AbortSignal` on `GoogleClassroomCourseWorkCreateRequest`, on the `callUpstream` init, and on the `HttpsFetch` init type; the production `createCourseWork` forwards it into `fetch`. Smallest compatible change so the adapter timeout can genuinely abort the coursework POST (§2.3 Correction 3).

### `platform/functions/src/lms/providers/google-classroom/adapter.ts`

Changes (item 3 amended by review, R1/R3):

1. **Removed `notYetOperational` helper.** The helper was the deferred-stub mechanism used for `listClassTopics` and `publishAssignment` through Sprint 23C. It is no longer needed.

2. **Split 401/403 in `translateUpstreamError`.** The original `status === 401 || status === 403` branch mapped every authorization failure to `lms.upstreamAuthorizationFailed`. Phase 1 splits it: a 403 whose error code is `"INSUFFICIENT_SCOPE"` or `"ACCESS_TOKEN_SCOPE_INSUFFICIENT"` maps to `lms.insufficientScope`; all other 403s and all 401s remain `lms.upstreamAuthorizationFailed`. This distinction is required for Phase 2 incremental consent routing (blueprint §11).

3. **Replaced both adapter stubs with live transport calls.**

   `listClassTopics`: iterates `transport.listCourseTopics` across up to 25 pages (bounded pagination guard), validates each topic entry (non-empty `topicId` and `name`), and returns the collected `LmsTopic[]`. Malformed entries throw `lms.upstreamMalformedResponse` before they can be returned to the core layer.

   `publishAssignment`: calls `transport.createCourseWork` with an AbortController-backed 30-second timeout (§2.3 Correction 3, see Review Corrections §R1). The controller's `signal` is threaded into the transport (an additive optional `signal` field on `GoogleClassroomCourseWorkCreateRequest` and on the `HttpsFetch` init), so a real hang genuinely aborts the in-flight fetch. A `Promise.race` against the timeout guarantees the adapter promise settles even if a transport ignores the signal, and the timer is always cleared in a `finally`. A hang produces a controlled `lms.upstreamCallFailed` so a `failed` publication record is durably written rather than leaving the callable hanging. Validates the returned `id` field; absent or empty throws `lms.upstreamMalformedResponse`.

### `platform/functions/src/lms/assignments-publish.ts`

Restructured internal control flow per §2.2, §2.4, and §2.7. The external callable request/response contract is unchanged. Record and audit shapes are unchanged.

**Completed-attempt guard (§2.2).** Before the upstream POST, the callable reads `lmsAssignmentPublicationCreationDocRef(publicationId)`. A record with `status: "succeeded"` returns the existing result without a second upstream call, a second record write, or a second audit event. An absent record or a `failed` record may proceed.

**Phase A / Phase B split (§2.4).** The previous single `try/catch` had three defects: `published` was `const`-scoped inside `try` and unreachable from `catch`; the catch unconditionally overwrote any existing `succeeded` record with a `failed` one; and `lms.insufficientScope` was treated as a terminal failure. The restructure:

- Hoists `published` as `let` outside both phases.
- Phase A (upstream call): on failure, special-cases `lms.insufficientScope` (non-terminal: no record written, no audit emitted, return `errorCode: "lms.insufficientScope"` to client). All other failures write the `failed` record, emit `lms.publishFailed`, and return the graceful failure response.
- Phase B (persistence and audit of a confirmed upstream success): three ordered steps, each independently guarded:
  - B1: Write the `succeeded` publication record. If this write throws, log at `error` severity with `providerId`, `linkId`, `lmsClassId`, `publicationId`, and the upstream `lmsAssignmentId` for manual recovery; return `errorCode: "lms.localPersistenceFailed"`.
  - B2: Update the mirror pointer on the LyfeLabz assignment. If this write throws, log at `error` severity for desync alerting; continue returning `succeeded` — the succeeded record is already written and must not be clobbered.
  - B3: Emit `lms.assignmentPublished` audit event. If this write throws, log at `error` severity for audit-gap alerting; continue returning `succeeded`.

**`lms.insufficientScope` non-terminal (§2.7).** No `failed` publication record is written and no `lms.publishFailed` audit event is emitted on this path. The client checks `errorCode === "lms.insufficientScope"` to route to incremental consent (Phase 2).

**Privacy invariant preserved.** No OAuth token, student PII, raw provider body, or `accessToken` field appears in any publication record, audit payload, log line, or callable response.

### `platform/functions/src/lms/providers/google-classroom/adapter.test.ts`

Removed the two `DEFERRED_OPERATIONS` entries for `listClassTopics` and `publishAssignment` (they no longer return `lms.providerNotYetOperational`). The provider identity assertion and the activated-operations transport-seam assertion remain. Updated the file header comment to reflect Sprint 25 Phase 1 context.

---

## Files Created

### `platform/functions/src/lms/providers/google-classroom/adapter-publication.test.ts`

New test suite covering the two newly activated adapter operations:

**`listClassTopics`:** single page, multiple pages (page-size-2 fixture with 3 topics), empty list, malformed entry (missing `topicId`), malformed entry (empty `name`), 401 → `lms.upstreamAuthorizationFailed`, 403 insufficient-scope → `lms.insufficientScope`, 429 → `lms.upstreamTemporarilyUnavailable`, 503 → `lms.upstreamTemporarilyUnavailable`.

**`publishAssignment`:** success without topic, success with topic, `lmsAssignmentUrl` present when `alternateLink` returned, malformed result (empty `id`), insufficient-scope 403 → `lms.insufficientScope`, 401 → `lms.upstreamAuthorizationFailed`, 429 → `lms.upstreamTemporarilyUnavailable`, 503 → `lms.upstreamTemporarilyUnavailable`, 30-second timeout via `Promise.race` → `lms.upstreamCallFailed`, generic transport error → `lms.upstreamCallFailed`.

### `platform/functions/src/lms/assignments-publish.test.ts`

New test suite covering the restructured callable control flow:

- First successful publication (full happy path)
- Completed-attempt guard: existing `succeeded` record → no second adapter POST, no second record write, no second audit event
- Failed record → re-attempt proceeds
- `lms.insufficientScope` → no failed record written, no `lms.publishFailed` emitted
- Confirmed upstream failure → failed record written, `lms.publishFailed` emitted, graceful response
- Phase B1 record write fails → error log with upstream `lmsAssignmentId`, returns `"lms.localPersistenceFailed"`
- Phase B1 failure does not clobber succeeded record
- Phase B2 mirror update fails → returns `succeeded`, logs mirror-desync at error severity
- Phase B3 audit emission fails → returns `succeeded`, logs audit-gap at error severity
- Privacy invariant: access token absent from response and records

---

## Test Results

Re-measured after the pre-commit review corrections (see Review Corrections
below). All commands were run without `--forceExit`.

```
platform/functions:
  npx jest src/lms/providers/google-classroom/adapter-publication.test.ts --detectOpenHandles
      → 23 passed; no open-handle warning
  npx jest src/lms/assignments-publish.test.ts --detectOpenHandles
      → 14 passed; no open-handle warning
  npx jest src/lms/providers/google-classroom/adapter.test.ts
      → 2 passed
  npx jest                       → 79 suites, 1457 tests — all pass; exit 0; no "did not exit" warning
  npm run typecheck              → clean (exit 0)
  npm run lint                   → clean (exit 0)
  npm run build                  → clean (exit 0)

app:
  npm run typecheck              → clean (exit 0)
  npm run lint                   → clean (exit 0)
  npx jest                       → 50 suites, 876 tests; 1 failed (curriculumManifest.test.ts), 875 pass
  npm run curriculum:verify      → FAIL (manifest drift); exit 1
  npm run lessons:verify         → OK (exit 0)
```

The functions suite total moved from 1453 to 1457: the review replaced one
timeout test with two AbortController-focused tests and added a non-scope
403 test (topics + publish) and a cyclic-page-token test.

The single app failure (`curriculumManifest.test.ts`) and the
`curriculum:verify` CLI failure are the **same** pre-existing curriculum
manifest drift (`index.html` diverged from
`app/src/curriculum/curriculum.manifest.json`). Both `index.html` and the
manifest are unmodified versus committed `HEAD`, so the drift exists on the
committed baseline and is independent of Phase 1, which changed **zero** app
files. See Review Corrections §R4.

---

## Review Corrections (pre-commit, 2026-08-06)

### R1. Timeout was not AbortController-backed and leaked a timer

**Original state.** `publishAssignment` wrapped `transport.createCourseWork`
in `Promise.race([createCourseWork(...), timeoutPromise])` where
`timeoutPromise` was a bare `setTimeout(...)` that (a) rejected with a plain
`Error`, (b) never received or delivered an `AbortSignal`, and (c) was never
cleared. The underlying request kept running after a timeout, and every
call — success, failure, or timeout — left a live 30-second timer.
`npx jest adapter-publication.test.ts --detectOpenHandles` reported multiple
open `Timeout` handles and the "Jest did not exit one second after the test
run has completed" warning. This did not match §2.3 Correction 3, which
mandates an `AbortController` request timeout.

**Correction.**
- `GoogleClassroomCourseWorkCreateRequest` and the `HttpsFetch` init type
  gained an additive optional `signal?: AbortSignal`; the production
  `createCourseWork` forwards it into `fetch`. No other operation or caller
  is affected (smallest compatible additive change).
- The adapter now creates an `AbortController`, calls `controller.abort()`
  when the deadline fires, threads `controller.signal` into the transport,
  races against the timeout so the adapter promise always settles, swallows
  any post-race rejection on the work promise, and **clears the timer in a
  `finally`**.
- On timeout the race rejects with a `PlatformError("lms.upstreamCallFailed")`;
  a real fetch abort (no status/code) also maps to `lms.upstreamCallFailed`
  via `translateUpstreamError`. No raw provider body is exposed.

**Tests added.** AbortSignal is delivered to `createCourseWork` and is not
aborted on a successful call; the signal becomes aborted at the 30 s
deadline; a late upstream resolution after the timeout path completes cannot
turn the already-rejected publish into a success; fake timers are restored
in `finally`. `--detectOpenHandles` is now clean.

### R2. 403 translation — verified, not "all 403 = insufficient scope"

`translateUpstreamError` maps a 403 to `lms.insufficientScope` **only** when
the upstream error code is `INSUFFICIENT_SCOPE` or
`ACCESS_TOKEN_SCOPE_INSUFFICIENT`; every other 403 and all 401s map to
`lms.upstreamAuthorizationFailed`; 404 → `lms.upstreamResourceNotFound`;
429/503 → `lms.upstreamTemporarilyUnavailable`; `400 invalid_grant` →
`lms.upstreamAuthorizationFailed`. Only a genuine missing-scope 403 reaches
the non-terminal incremental-consent path. To lock this against regression,
a `permission-denied` fixture mode (403 `PERMISSION_DENIED`) was added and
tests assert it maps to `lms.upstreamAuthorizationFailed`, **not**
`lms.insufficientScope`, for both `listClassTopics` and `publishAssignment`.
No raw Google error body is persisted or returned; only the stable
`PlatformError` code crosses the adapter boundary.

### R3. listClassTopics pagination hardened to match listClassRoster

`listClassTopics` was bounded (`MAX_PAGES = 25`, no infinite loop) but,
unlike `listClassRoster`, it silently returned whatever it had collected on
a repeated/cyclic `nextPageToken` or on exhausting the page bound — which
would surface duplicate topics under a non-advancing cursor. It now rejects a
repeated cursor (`lms.upstreamCallFailed`), rejects a malformed
`nextPageToken` (`lms.upstreamMalformedResponse`), and rejects on
bound-exhaustion rather than returning a truncated list. A cyclic-token test
was added. Malformed/empty pages remain handled (empty array for no topics;
malformed entry → `lms.upstreamMalformedResponse`). A deleted/inaccessible
course surfaces the provider's real status (404 →
`lms.upstreamResourceNotFound`, non-scope 403 →
`lms.upstreamAuthorizationFailed`); it becomes `lms.insufficientScope` only
on a genuine scope 403.

### R4. App verification narrative corrected

The original report stated the app baseline "had two failures" and Phase 1
left "one remaining failure" with "no app files changed." Phase 1 changed
**zero** app files, so the app result is byte-identical before and after
Phase 1; a real 2→1 reduction attributable to Phase 1 is not possible and
was not measured on a captured pre-implementation baseline. The verifiable
truth: there is exactly **one** root-cause app failure — the curriculum
manifest drift — and it surfaces through **two** commands:
`npm run curriculum:verify` (CLI, exit 1) and `curriculumManifest.test.ts`
(one failing jest test). `npm run verify` chains with `&&` and runs
`curriculum:verify` first, so it aborts there and never reaches the jest
suite; that is why the verify chain shows one failure while running the jest
suite directly shows the drift again. The "two vs one" was a conflation of
the same single drift across two commands, not a before/after improvement.
The drift predates Sprint 25 (both `index.html` and the manifest are
unmodified vs `HEAD`); it is environmental to the committed tree, not
ordering-related, not nondeterministic, and not generated-file drift caused
by Phase 1. `npm run lessons:verify` passes.

### R5. Functions lint was not actually clean for the new suite

The new (untracked) `adapter-publication.test.ts` failed `npm run lint` with
five errors (four `@typescript-eslint/require-await` on `async` mock
overrides with no `await`, and one `no-unnecessary-type-assertion`). The
original "lint clean" claim was therefore not reproducible. The review
converted the affected mock overrides to `Promise.resolve(...)` /
`Promise.reject(...)` and removed the needless assertion; `npm run lint` now
exits 0.

### R6. Sequential vs concurrent duplicate guarantee (no overclaim)

The completed-attempt guard is a **read-then-post** check: it reads the
`succeeded` publication record before the upstream POST. This prevents
**sequential** duplicates (a retry after a recorded success, a
double-submit that lands after the first completes) — proven by the callable
test asserting no second adapter POST, no second record write, and no second
audit event. It does **not** close the **concurrent** double-fire window: two
invocations with the same nonce that both read "absent" before either writes
will both POST to Google (two coursework items) and both write `succeeded`
(last-write-wins on the same deterministic doc). This is the exact residual
the implementation plan §2.2 delegates to the **client-side in-flight submit
lock** (part 2), which is Phase 2 / client work and out of scope here.
Closing it server-side would require a transactional create-if-absent or a
status reservation — an architectural shape change (new write semantics or a
reservation state) that the review is instructed not to introduce without
escalation. Phase 1 therefore documents this limitation rather than claiming
full concurrent idempotency (Option B).

---

## Design Decisions Honored

| Decision | Source | How Phase 1 honors it |
|---|---|---|
| Vendor neutrality | PDR-020f | No Google-specific concept in `assignments-publish.ts`; adapter registry resolves provider |
| lms.insufficientScope non-terminal | §2.7, blueprint §11 | No failed record, no publishFailed audit; errorCode returned to client for Phase 2 routing |
| Completed-attempt guard server-side | §2.2 | Publication record read before every upstream POST |
| Phase A / Phase B split | §2.4 | Later local failures cannot clobber a written succeeded record |
| Orphan log with upstream id | §2.4 | B1 failure logs `lmsAssignmentId` at error severity for manual recovery |
| 30-second adapter timeout | §2.3 Correction 3 | AbortController-backed in `publishAssignment`: signal threaded into the transport, timer cleared in `finally`, race guards a signal-ignoring transport; hang → `lms.upstreamCallFailed` (see R1) |
| No new audit vocabulary | Sprint 25 def | Only `lms.assignmentPublished` and `lms.publishFailed` used; both pre-existed in `AUDIT_ACTIONS` |
| Privacy invariant | §8 | Token and provider body absent from every record, log, and response surface |

---

## Phase 2 Prerequisites Satisfied by Phase 1

Phase 2 (OAuth scope changes and client incremental consent flow) depends on the `lms.insufficientScope` error code reaching the client cleanly. Phase 1 ensures:

1. The adapter correctly maps a Google 403 `INSUFFICIENT_SCOPE` response to `lms.insufficientScope`.
2. The callable returns `{ status: "failed", errorCode: "lms.insufficientScope" }` to the client without writing any record.
3. A nonce-stable `publicationId` is always returned so the client can retry with the same `attemptNonce` after obtaining the broader scope.

No Phase 2 work is authorized by this report.

---

## Certification Addendum: real-Google insufficient-scope error shape

Recorded during Sprint 25 browser certification (paused at B4). Certification
remained paused throughout; no B5 or B9 scenario was run.

**Defect (certification-discovered).** The Phase 1 mapping above was verified
only against the fixture transport's synthetic `errorCode` values
(`INSUFFICIENT_SCOPE`, `PERMISSION_DENIED`). Real Google Classroom does not
send those. A genuine OAuth scope shortfall arrives as HTTP 403 with the
generic top-level `error.status = "PERMISSION_DENIED"` and the discriminating
reason nested in `error.details[].reason = "ACCESS_TOKEN_SCOPE_INSUFFICIENT"`.
The transport's `extractUpstreamCode` returned `error.status` first and never
inspected `error.details[]`, so the adapter's insufficient-scope branch
(which already recognizes `ACCESS_TOKEN_SCOPE_INSUFFICIENT`) was dead code
against production. Every real insufficient-scope 403 was therefore
misclassified as `lms.upstreamAuthorizationFailed`.

**Scope of impact.** `listCourseTopics` and `createCourseWork` share
`callUpstream` → `extractUpstreamCode` → `GoogleClassroomHttpsError` and both
adapter methods translate through `translateUpstreamError`. So publication was
affected identically to topic listing: a first real publish on a readonly-only
connection would have returned `lms.upstreamAuthorizationFailed`, written a
`failed` publication record, and emitted `lms.publishFailed` - defeating the
non-terminal `lms.insufficientScope` contract this report depends on and
denying the client its Phase 2 incremental-consent signal. (This also means
the correction is what makes backend checks V5/V6 pass against real Google.)

**Correction (smallest, provider-specific).** `extractUpstreamCode` in
`platform/functions/src/lms/providers/google-classroom/transport.ts` now scans
`error.details[]` for a `google.rpc.ErrorInfo` reason and surfaces it as the
upstream code when it is one of the two exact scope markers
(`ACCESS_TOKEN_SCOPE_INSUFFICIENT` or the legacy/fixture `INSUFFICIENT_SCOPE`),
before falling back to `error.status`. An ordinary `PERMISSION_DENIED` (no such
reason) is unchanged and still maps to `lms.upstreamAuthorizationFailed`. The
adapter, callable, and provider-neutral error vocabulary are unchanged; raw
Google bodies still never cross the client trust boundary. Initial OAuth scopes
were NOT broadened and PDR-030 was NOT changed.

**Tests added (real error shape, not synthetic codes).**

- `transport-https.test.ts`: a real 403 `PERMISSION_DENIED` + details reason
  `ACCESS_TOKEN_SCOPE_INSUFFICIENT` surfaces that reason as the upstream code
  for both `listCourseTopics` and `createCourseWork`; an ordinary 403 without
  the scope reason stays `PERMISSION_DENIED`.
- `adapter-publication.test.ts`: the genuine fetch-based transport wired into
  the adapter classifies the real insufficient-scope 403 as
  `lms.insufficientScope` for both `listClassTopics` and `publishAssignment`,
  and an ordinary real 403 as `lms.upstreamAuthorizationFailed`.
- `assignments-publish.test.ts`: a scope shortfall reaching the callable stays
  the non-terminal `lms.insufficientScope` outcome (no failed record, no
  `lms.publishFailed`) and does not regress to
  `lms.upstreamAuthorizationFailed`.

**Client topic-load correctness (Phase 3 surface).** `ensureTopics`
(`app/src/shell/surfaces/curriculum.ts`) previously cached an empty list on any
topic-fetch failure. A pre-consent failure (expected, since the topics scope is
post-consent) was thus remembered permanently and, after publication consent
widened the connection, the real topics never appeared. The failure path no
longer caches, so a later Assign-dialog open re-fetches against the possibly
widened connection. The pre-consent empty selector remains the accepted
degraded state, and topic loading still never triggers consent - publication
remains the sole consent trigger.

**B4 sequencing correction (documentation only).** The frozen architecture is
authoritative: `classroom.topics.readonly` stays in the publication
incremental-consent bundle. The browser checklist and runbook were corrected so
B4 is a PRE-CONSENT check (topic selector present, empty "No topic" expected,
no claim of a real topic read) and a new B4b verifies real topic population
AFTER B9/B10 widen the connection. The backend verification checklist already
treated topics as post-consent (V10) and its pre-consent insufficient-scope
expectations (V5/V6) are unchanged, so it required no edit.
