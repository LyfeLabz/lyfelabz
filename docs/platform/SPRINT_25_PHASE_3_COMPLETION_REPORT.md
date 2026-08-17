# Sprint 25 Phase 3 Completion Report - Assign Dialog Publication Integration

Status: Complete, engineering-validated, independently reviewed, ready to
commit. Not browser certified (that is Phase 4). Sprint 25 is not marked
complete. Nothing was staged or committed.

This report incorporates a final independent pre-commit review of the
implementation, UX, privacy, and tests (recorded in §20). That review
confirmed the frozen architecture was preserved, re-ran every command in
§15, and made exactly one bounded correction (a misleading comment in
`runPublicationAction`; §3, §20). No behavior changed.

Governing documents (frozen, unchanged by this phase):
- `SPRINT_25_PHASE_3_DEFINITION.md` (scope-of-record)
- `SPRINT_25_PHASE_3_ARCHITECTURAL_BLUEPRINT.md` (workflows, failure matrix)
- `SPRINT_25_IMPLEMENTATION_PLAN.md` §2 (resolved decisions), §3 Phase 3
- `ADR_LMS_PUBLICATION_SURFACE_RECONCILIATION.md`, `PDR_030_LMS_ASSIGNMENT_PUBLICATION.md`

Style: no em dashes; " - " is the sentence-level break.

---

## 1. Baseline verified

Phase 3 is a connect-and-complete phase on a mostly-built surface. The
following were read in full before any edit and confirmed as the source of
truth:

- `app/src/shell/surfaces/curriculum.ts` - the one Assign dialog, row state,
  `renderRow`, `runAssignmentLifecycle`, `summarizeOutcomes`, submit lock.
- `app/src/assignments/detail/detail.ts`, `detail/types.ts`, `registry.ts` -
  the detail surface, its injected deps seam, and the session-scoped registry.
- `app/src/settings/integrations/wire.ts`, `types.ts` - `createLmsCallables`
  (`publishAssignment`, `listClassTopics`, `beginConnection`,
  `completeConnection`), `createBrowserOAuthHandoff`, `createListClassLinks`,
  `createIntegrationsDeps`.
- `app/src/shell/surfaces/workspace.ts`, `app/src/index.ts` - the seam wiring
  and the `openAssignmentDetail` entry point.
- `platform/functions/src/lms/assignments-publish.ts` and
  `shared/errors/{platform-error,https-callable}.ts` - the frozen server
  contract, the completed-attempt guard, the non-terminal insufficient-scope
  path, and how a thrown `PlatformError` reaches the client (`HttpsError`
  `details: { code }`).
- Existing tests: `curriculum.false-success.test.ts`, `detail.test.ts`,
  `shell.test.ts` posture invariant, `integrations.test.ts`.

## 2. Pre-built functionality confirmed (reused unchanged)

Confirmed present and reused, not rebuilt (definition §6 inventory):

- LMS link detection via `createListClassLinks` + `ensureClassLinks`, cached
  per teacher by `classId`.
- Per-row Google Classroom topic selector wired to `lmsClassesListTopics`,
  with "No topic" as the default, a non-selectable loading option, per-`linkId`
  session caching, and stale-topic fallback to "No topic".
- The off-by-default "Also publish to Google Classroom" per-row toggle,
  present only on LMS-linked `active` rows.
- The confirm-time per-class lifecycle `runAssignmentLifecycle`
  (`createDraft` then `publish` then `publishAssignment`), with independent
  per-class outcomes and the invariant that a publication failure never
  disturbs the authoritative LyfeLabz assignment.
- The dialog-level in-flight submit lock (`submissionInFlight`).
- `summarizeOutcomes` succeeded / did-not-succeed read-back.
- Client seams and types already carrying `attemptNonce`, `capability`,
  `consentOutcome`, `errorCode`.
- The server callable already accepting `attemptNonce`, guarding a
  `succeeded` record, and treating `lms.insufficientScope` as non-terminal.

The genuine gaps (definition §6.2) were: no `attemptNonce` passed; no
insufficient-scope consent handoff or re-issue; no reconnect routing; no
detail-view retry; unhardened outcome mapping.

## 3. Files modified

Client only. No server file, no Firestore rule, no publication record shape,
no new callable, no new collection.

- `app/src/shell/surfaces/shared/lmsPublication.ts` (new) - the shared
  publication attempt model: `mintNonce`, `runPublicationAction`,
  `createConsentCoordinator`, error classification, and the session-scoped
  retry-context store + `createDetailLmsRetrySeam`.
- `app/src/shell/surfaces/curriculum.ts` - per-row nonce, consent handoff and
  single re-issue via the shared runner, reconnect/permission states,
  retry-context recording, extended `summarizeOutcomes`.
- `app/src/assignments/detail/types.ts` - `AssignmentLmsPublicationState` and
  the injected `AssignmentLmsRetrySeam`.
- `app/src/assignments/detail/detail.ts` - the publication status + retry
  panel, retry UI state, in-flight lock, reconnect routing.
- `app/src/index.ts` - builds the `lmsRetry` seam from the session store when
  opening the detail view; clears the store on sign-out / teacher swap.
- Tests (new): `shared/lmsPublication.test.ts`,
  `curriculum.lms-publish.test.ts`, `detail/detail.lms-retry.test.ts`.

Review-pass correction (no behavior change): the thrown-error branch of
`runPublicationAction` carried a garbled comment that misdescribed the
control flow (it implied a thrown insufficient-scope error would "fall
through" to the consent handoff, which the code does not and must not do).
The comment was rewritten to state the actual invariant: the frozen server
contract returns `lms.insufficientScope` as a resolved outcome only, the
consent handoff is driven only from the resolved path, and any thrown error
is a generic failure that can never open the consent flow or start a loop.
The executable logic is unchanged.

## 4. Nonce implementation

One `attemptNonce` per logical publication action (implementation plan §2.1):

- The confirm path mints one nonce per LMS-linked row selected for
  publication (`mintNonce()` per row inside `runAssignmentLifecycle`),
  distinct from the pre-existing confirm-level nonce used only to derive the
  `assignmentId`.
- `runPublicationAction` reuses that same nonce for the initial publish and
  for the single automatic re-issue after consent; it is never re-minted per
  HTTPS call.
- Separate rows receive separate nonces; each row also carries its own
  `assignmentId`, so derived `publicationId` values never collide.
- An explicit detail-view retry mints a fresh nonce (a distinct logical
  action, a distinct ledger record).
- Tests prove: nonce passed on the initial call; same nonce on the re-issue;
  distinct nonces across rows; distinct nonces across successive retries;
  ordinary publication never calls the server without a nonce.

## 5. Incremental-consent implementation

Handled only for `lms.insufficientScope` (the one non-terminal outcome):

1. First publish returns `lms.insufficientScope`.
2. `beginConnection({ providerId, redirectUri, capability: "publication" })`.
3. The existing `openOAuth` browser handoff.
4. `completeConnection(...)`.
5. Exactly one re-issue with the same nonce.

The Phase 2 popup, cancellation, denial, state-mismatch, and postMessage
handling are reused unchanged. The LyfeLabz assignment lifecycle is never
recreated or republished during consent. No Google scope string, token,
account id, or provider payload is passed or surfaced. `consentOutcome` is
intentionally not used to decide whether to re-issue (see §6).

## 6. Consent-loop prevention

Decisive requirement (definition Part 4). After consent completes, the
publish is re-issued exactly once. If the re-issue again returns
`lms.insufficientScope` (Phase 2 may report `alreadyAuthorized` even when the
teacher declined the coursework scopes), `runPublicationAction` stops: it does
not reopen OAuth and does not publish again. The row outcome becomes
`permissionNotGranted`, the LyfeLabz assignment stays intact, and retry stays
available from the detail view. Tests prove exactly one begin, one open, one
completion, at most one re-issue, and no loop on a repeated insufficient
scope.

## 7. Cancellation and denial handling

If the teacher closes, cancels, or denies consent (`openOAuth` rejects) or the
completion fails, `runConsentHandoff` resolves `notGranted`: no re-issue, no
second OAuth attempt. The outcome is `permissionNotGranted` with the calm
line "Publishing to Google Classroom needs your permission. You can try again
from the assignment." The LyfeLabz assignment remains published; the old
read-only connection is untouched; manual retry remains available. The three
cases (cancel/deny, insufficient-after-consent, unexpected failure) are kept
distinct in the classifier.

## 8. Reconnect routing

`lms.connectionNotActive` / `lms.connectionNotFound` (thrown callable errors,
inspected via the sanitized `details.code`) map to `reconnectRequired`, never
to a consent flow and never re-issued. The confirm summary and the detail
panel render "Google Classroom needs to be reconnected in Settings. Your
assignment was scheduled." The LyfeLabz assignment proceeds; retry stays
available for after reconnection. The detail seam exposes an optional
`onReconnect` route (rendered as a "Reconnect in Settings" button when wired);
see §17 for the deferral note.

## 9. Error normalization

Both a graceful `{ status: "failed" }` response and a thrown callable error
are normalized by `runPublicationAction` into the same bounded result set:
`succeeded | failed | permissionNotGranted | reconnectRequired`. Mapping:
`lms.insufficientScope` -> consent flow; inactive/not-found connection ->
reconnect; every other resolved failure and every thrown error (transport,
deadline, permission denied, link/topic unavailable, local persistence) ->
`failed` with retry. A thrown error is never treated as a hard stop or a
success, and a publication failure never undoes, deletes, or re-runs the
LyfeLabz lifecycle. No raw message, Firebase internal, HTTP status, provider
payload, token, or account id is ever rendered; a privacy test asserts none of
`lms.`, `token=`, `@example.com`, or `403` reaches the DOM even when the
server returns a deliberately dirty `errorMessage`.

## 10. Topic behavior

Preserved and covered: "No topic" is a first-class default; a selected topic
is passed as `lmsTopicId`, "No topic" omits it; a stale prefilled topic falls
back to "No topic"; a topic fetch failure degrades to an empty selector
without blocking assigning; non-LMS rows have no topic control. No topic
creation, sync, or management was added.

## 11. Assignment-detail retry

The detail surface accepts an optional injected `lmsRetry` seam. When present
for a non-draft assignment it renders a calm "Google Classroom" panel: the
state line, and, unless the publication already succeeded, a single "Try
again" control. The seam (`createDetailLmsRetrySeam`) owns the workflow: fresh
nonce, one consent, one re-issue, never re-running `createDraft` or `publish`.
The control is disabled while a retry is in flight (a rapid double click
dispatches exactly one retry). A successful retry updates the panel to
succeeded and removes the control; a failed or permission-needed retry stays
retryable; a reconnect outcome shows the reconnect line. `index.ts` builds the
seam only when the session store holds a publication that did not succeed for
that assignment, so the pre-Phase-3 detail surface is byte-for-byte unchanged
when there is nothing to retry.

## 12. Multi-class behavior

Each selected class runs its LyfeLabz lifecycle independently, owns its own
publish nonce, topic, and outcome, and one class's failure never blocks, rolls
back, re-nonces, or overwrites another. One consent coordinator per confirm
bounds incremental consent to a single OAuth flow shared across all affected
rows: the first row to need consent runs it; concurrent rows await the same
completed consent and each re-issue once; a declined consent latches for the
action so no second OAuth flow opens. Tests prove one begin/open/complete
across two rows, distinct nonces and distinct assignmentIds per row, and a
partial-success aggregate line. This is the smallest behavior consistent with
the frozen design and existing connection widening; no batch publish API was
introduced, and no architectural contradiction was encountered.

## 13. Teacher-facing outcome behavior

`summarizeOutcomes` distinguishes per confirm: assigned in LyfeLabz;
publishing succeeded; did not succeed; needs your permission; needs to be
reconnected in Settings; and a mixed "succeeded for N ... did not succeed for
M" line. It never implies the LyfeLabz assignment failed when only publication
failed, and never shows a raw code. The detail panel uses the same calm copy
table. Google Classroom is referenced by display name only.

## 14. Tests added or changed

New, all green (38 tests):
- `shared/lmsPublication.test.ts` (18): nonce pass/reuse, single re-issue,
  consent cancel/deny, insufficient-after-consent stop (no loop), reconnect
  (resolved and thrown), thrown generic -> failed, provider unavailable,
  multi-row shared consent, declined-consent latch, retry store uid-scoping,
  detail seam null cases, fresh-nonce retry.
- `curriculum.lms-publish.test.ts` (10): LMS vs non-LMS row controls,
  off-by-default toggle, nonce on publish, topic present/absent, consent +
  re-issue success, consent cancelled, reconnect line, thrown -> did not
  succeed, multi-class partial success, no-PII copy.
- `detail/detail.lms-retry.test.ts` (10): panel present/absent, failed and
  succeeded lines, successful retry (and no LyfeLabz lifecycle re-run),
  failed retry stays retryable, submit lock, permission line, reconnect
  routing with/without `onReconnect`, no-PII copy.

No existing test was weakened. The certified `curriculum.false-success` and
`detail` suites remain green unchanged.

## 15. Exact commands run

From `app/`:
- `npx tsc --noEmit`
- `npm run lint`  (`eslint --ext .ts src`)
- `npm run build` (`esbuild src/index.ts ...`)
- `npx jest` (full app suite)
- `npx jest src/shell/surfaces/shared/lmsPublication.test.ts`
- `npx jest src/shell/surfaces/curriculum.lms-publish.test.ts`
- `npx jest src/assignments/detail/detail.lms-retry.test.ts`
- `npx jest src/shell/surfaces/curriculum.false-success.test.ts src/assignments/detail/detail.test.ts`
- `npx jest src/shell/shell.test.ts -t "posture"`
- `npm run lessons:verify`
- `npm run curriculum:verify`

## 16. Results

- Typecheck: PASS (no output).
- Lint: PASS (exit 0, no findings).
- Build: PASS (`dist/bundle.js`, 1.2mb).
- Full app suite: 913 passed, 1 failed, 914 total. The single failure is
  `curriculumManifest.test.ts` "checked-in manifest matches a freshly parsed
  canonical index.html" - the pre-existing curriculum-manifest drift between
  root `index.html` and the checked-in manifest, documented in the Phase 1 and
  Phase 2 reports and independent of Sprint 25. No Phase 3 file touches
  `index.html` or the manifest.
- New Phase 3 suites: 38 passed, 0 failed.
- Shell posture test: PASS (the new shared module opens no `firebase/*`,
  listener, callable, or browser storage).
- `lessons:verify`: PASS (earthquakes, earths-layers, plate-tectonics,
  water-cycle all OK).
- `curriculum:verify`: DRIFT (the same pre-existing, independent drift as
  above; not introduced by Phase 3).
- Server (`platform/functions`): not run because Phase 3 changed no server
  file. The `attemptNonce` request field the client now always sends is
  already optional in the frozen `lmsAssignmentsPublish` contract and is
  exercised by the Phase 1 server tests; no client change alters a server
  request assumption.

## 17. Known limitations

- The reconnect route (`onReconnect`) is supported by the detail seam and
  verified by test, but is intentionally left unwired at the entry point in
  Phase 3. In production the reconnect state renders the calm line naming
  Settings plus the retry control; a one-click "Reconnect in Settings" nav
  button is deferred so Phase 3 adds no teacher-shell navigation architecture
  (the persistent left nav already reaches Settings in one click). This is the
  smallest calm affordance consistent with the frozen design.
- The detail-view retry affordance is session-scoped: it is available for a
  publication recorded during the current tab session. After a full page
  reload the client does not re-read publication state (Phase 3 adds no new
  read path, per §12 non-goals); the affordance reappears only for a
  publication attempted in the current session. This matches the rollback
  posture (definition §9).
- Retry after a genuinely uncertain original response (timeout) may create a
  second coursework item upstream; this residual is accepted and documented
  (implementation plan §2.3, §2.6) and is not reconciled in Sprint 25.
- The consent coordinator shares one completed OAuth consent across every
  LMS-linked row in a single confirm, regardless of each row's
  `providerId`. This is correct and safe for Sprint 25 because the only
  publication provider is Google Classroom and incremental consent widens
  the single teacher connection; a second row cannot need a different
  provider's consent today. If a future sprint adds a second publication
  provider, the coordinator must be keyed by `providerId` so cross-provider
  rows do not reuse each other's consent. Called out here as a forward
  guardrail, not a Phase 3 defect.
- In the reconnect-required state, the detail panel keeps the "Try again"
  control active (there is no `onReconnect` route wired at the entry point
  in Phase 3, per the first limitation above). This is intentional: the
  client has no in-session signal that the teacher reconnected (they may do
  so in another tab or window), so a premature retry simply re-reports the
  same calm reconnect line with no loop, no duplicate work, and no harm to
  the authoritative LyfeLabz assignment. A disabled control would wrongly
  block a teacher who has already reconnected. This is the smallest calm
  behavior consistent with the frozen design; it was reviewed and left as
  is.

## 18. Certification scenarios deferred to Phase 4

The blueprint §13 table (P3-1 through P3-12) is executed in Phase 4 as one
continuous genuine run through the real teacher shell against the Emulator
Suite with real Google Classroom (the Sprint 24B certification model), plus the backend verification
(§14): callable ledger ordering, the widened single connection, `succeeded`
and `failed` records, the `lmsPublicationRef` mirror, the audit chain, zero
Secret Manager access, and no PII or token in any record, payload, or log.
Phase 3 performed no browser certification and claims none. Google OAuth
production verification and the rollout runbook remain out of sprint.

## 19. Confirmations

- LyfeLabz assignment authority preserved: publication is always a side effect
  after `published`; no failure, consent, reconnect, or retry path ever
  recreates, republishes, rolls back, or deletes the LyfeLabz assignment.
- Phase 4 not started: no browser certification run, no emulator certification
  claim, no production-rollout work.
- Architecture not redesigned: one Assign dialog, per-class rows, existing
  LMS-link detection, topic selector, off-by-default toggle, existing
  createDraft -> publish lifecycle, independent per-class outcomes, dialog
  submit lock, confirmation summary, and provider-neutral callable seams all
  preserved. No second publish surface, wizard, Settings publish action,
  Google-first terminology, new callable, new collection, new audit kind, or
  server change was introduced.
- Nothing staged or committed: `git status` shows 4 modified files
  (`app/src/shell/surfaces/curriculum.ts`,
  `app/src/assignments/detail/detail.ts`,
  `app/src/assignments/detail/types.ts`, `app/src/index.ts`) and 5
  untracked files (`app/src/shell/surfaces/shared/lmsPublication.ts` and its
  test, `app/src/shell/surfaces/curriculum.lms-publish.test.ts`,
  `app/src/assignments/detail/detail.lms-retry.test.ts`, and this report).
  All are unstaged.

## 20. Independent pre-commit review

A final independent review re-inspected the implementation against the
frozen definition and blueprint, re-ran every command in §15, and audited
the areas below. Findings:

- Nonce lifecycle: one nonce per logical action; distinct nonces across
  rows; the same nonce on the single post-consent re-issue; a fresh nonce on
  each explicit detail-view retry; no ordinary publish reaches the callable
  without a nonce. `runAssignmentLifecycle` runs once per confirm (the
  dialog closes on confirm, so a nonce is neither re-minted nor lost by a
  rerender). Confirmed correct.
- Incremental consent and one re-issue: exactly one begin, one open, one
  completion, at most one re-issue; a second insufficient-scope stops with
  no reopened OAuth; cancellation and denial produce no re-issue;
  `consentOutcome` is intentionally not consulted (the re-issue is the
  authoritative scope test). Confirmed correct.
- Multi-class coordinator: one shared consent per confirm across rows; a
  declined consent latches for the action only (a fresh coordinator per
  confirm and per retry, so no leak into a later action); each row keeps its
  own nonce, assignmentId, topic, and outcome. Confirmed correct, with the
  single-provider forward guardrail recorded in §17.
- Error normalization: verified against the real server shape
  (`https-callable.ts` wraps a thrown `PlatformError` as `HttpsError(...,
  message, { code })`, so the client reads `err.details.code`).
  `lms.insufficientScope` alone triggers consent; `lms.connectionNotActive`
  / `lms.connectionNotFound` map to reconnect; every other resolved failure
  and every thrown error map to a retryable "did not succeed"; a permission
  denial is not mistaken for insufficient scope; no raw message, HTTP code,
  or provider payload is read or rendered. Confirmed correct.
- Privacy: the shared module imports no `firebase/*`, opens no listener or
  browser storage, and touches no DOM; only LyfeLabz identifiers, the
  LyfeLabz assignment URL (derived from `window.location.origin +
  lesson.href`, never teacher input), the optional topic id, and the nonce
  reach the callable. No-PII tests assert `lms.`, `token=`, `@example.com`,
  and `403` never reach the DOM even with a deliberately dirty
  `errorMessage`. Confirmed correct.
- Accessibility: semantic `type="button"` retry and reconnect controls (no
  accidental form submission); the retry control is disabled and
  `aria-busy` while in flight (a double click dispatches one retry); the
  status line carries `role="status"` / `aria-live="polite"`; the topic
  `<select>` is wrapped in a `<label>`; the panel is rebuilt on each
  rerender (`body.textContent = ""`) so no duplicate ids or handlers
  accumulate. Confirmed correct.

One bounded correction was made: the misleading comment in
`runPublicationAction` (§3). No executable behavior changed; typecheck,
lint, and the 38 Phase 3 tests were re-run green after the edit.

## 21. Final verdict

PHASE 3 COMPLETE AND READY TO COMMIT.

Phase 4 was not started. The frozen Sprint 25 architecture was preserved.
Nothing was staged or committed.

## 22. Certification-found defect: stale class cache (scenario B2)

Browser certification paused at scenario **B2**. B2 exposed a
**pre-existing** defect that predates Sprint 25 and is unrelated to the
LMS-publication architecture certified above. The Phase 3 architecture is
unchanged.

**Symptom.** The Classes page showed the teacher's active class, but the
Assign dialog (opened from the Curriculum surface) still reported "You do
not have any active classes yet."

**Root cause.** The Curriculum surface (`app/src/shell/surfaces/
curriculum.ts`) warms a module-scoped, uid-keyed teacher class cache
(`cachedClasses`) on mount. Because the SPA re-renders in place instead of
reloading the module, that cache survived two boundaries it should not:

1. A same-session class mutation (create / import / activate) performed on
   the Classes surface. The Classes page reads classes fresh through its
   own `listClasses` call; the Assign dialog kept serving the pre-mutation
   (often empty) cached list.
2. A same-uid sign-out/sign-in. The cache key is the uid, which is
   identical across that teardown, so the incoming session reused the
   outgoing session's rows.

**Bounded fix.** A single class-scoped invalidation,
`invalidateCurriculumClassCache()`, drops the class list and the LMS
class-link caches (plus any in-flight fetch) so the next Assign open
re-fetches. It deliberately leaves session preferences, filters, the
assignment registries, the persisted-slug badges, and per-link LMS topics
untouched. It is invoked:

- after every class mutation on the Classes surface (`createClass`,
  Google Classroom import link, and `activateClass` success paths in
  `app/src/shell/surfaces/classes.ts`), before the mount-connection guard
  so a confirmed server mutation always invalidates; and
- at every auth bootstrap transition in `app/src/index.ts` `rerun()`
  (alongside the existing Curriculum scroll-guard invalidation), so a
  same-uid sign-out/sign-in cannot reuse the prior session's rows. In-tab
  surface navigation does not pass through `rerun`, so the intended
  within-session prefetch cache is preserved.

No class data model, callable contract, Firestore rule, LMS architecture,
or assignment architecture was changed. No Firestore data was modified.

**Regression tests added.**
`app/src/shell/surfaces/curriculum.class-cache-invalidation.test.ts`
(5 tests): warm-empty-then-exists invalidation; same-session
create-then-assign; same-uid sign-out/sign-in teardown; cross-teacher
cache isolation; and unchanged behavior when the cache is valid. The
failing browser scenario is reproduced by these tests: with the
invalidation neutered, three of the five fail; with the fix in place all
five pass.

**Certification status.** Certification is **paused and must resume at
B2**. No later certification scenario was started.

## 23. Certification-found defect: publish toggle persists ON (scenario B5)

Browser certification, resumed after B2, paused again at scenario **B5**.
B5 exposed an implementation defect in the Assign dialog's rehydration
seam. The frozen architecture is unchanged; the Assign experience was not
redesigned.

**Authoritative requirement.** Classroom publication is opt-in per action
(PDR-019a: integration is opt-in per teacher, per class, per action). The
publish toggle must be OFF every time the Assign dialog opens, and a prior
ON state must never be restored.

**Symptom.** A teacher opened an LMS-linked Assign row, turned the publish
toggle ON, and confirmed. Reopening the same lesson/class restored the
publish toggle in the ON state.

**Root cause.** The confirm handler persists the full `RowConfig` per class
so revisit-in-place can restore remembered fields. That stored config
includes `publishToLms: true`. The rehydration seam
(`app/src/shell/surfaces/curriculum.ts`) spread the prior row verbatim
(`{ ...prior }`), so the ON flag was carried back onto the reopened row.
This persistence was inherited accidentally from the older whole-row
persistence mechanism; it was never an intentional preference. The server
completed-attempt guard is a publication-safety control and is not the
mechanism that enforces this UX rule.

**Bounded fix.** A single-field reset at the rehydration seam: when prior
row state exists, the dialog now rehydrates it as
`{ ...prior, publishToLms: false }`. Every other remembered field is
preserved exactly as before - enabled state, date, release time, points,
legacy topic preference, `lmsTopicId`, and row order. `publishToLms` is the
only field forced OFF on open. No architecture document, callable contract,
Firestore rule, LMS architecture, or assignment architecture was changed.
No Firestore data was modified.

**Regression tests added.** `curriculum.lms-publish.test.ts` gains a
three-test block: toggle ON + Confirm then reopen asserts the toggle is OFF
while date/time/points/topic/enabled remain restored; a new explicit opt-in
after the reset still publishes; and the cancel path reopens OFF and never
publishes. The existing revisit-in-place test in `shell.test.ts` is
strengthened to assert no ON publish toggle survives a reopen; the
default-off test is unchanged and still passes. With the pre-fix verbatim
spread restored, the new regression fails; with the reset in place it
passes.

**Certification status.** The bounded fix was browser-retested: scenario
**B5 PASSES**. Certification resumes at the next scenario after B5.

## 24. Certification-found defect: invalid assignment-id minting (scenario B6)

Browser certification, resumed after B5, paused again at scenario **B6**.
B6 exposed an implementation defect in the client's assignmentId minter.
The frozen architecture is unchanged; the assignment lifecycle was not
redesigned and no server contract was broadened.

**Authoritative requirement.** Every assignment callable validates the
client-supplied `assignmentId` against one shared URL-safe token pattern:

```
const ASSIGNMENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
```

An id must begin and end with an alphanumeric character, contain only
letters, digits, hyphens, and underscores, and be at most 64 characters.

**Symptom (browser evidence).** In B6 the first callable, `assignmentsCreateDraft`,
rejected **both** createDraft requests. The actual callable response was:

```
{
  "error": {
    "details": { "code": "assignments.invalidAssignmentId" },
    "message": "assignmentId must be a URL-safe token (letters, digits, hyphens, underscores).",
    "status": "INVALID_ARGUMENT"
  }
}
```

Because createDraft failed for every row, no `assignmentsPublish` ran and
no `lmsAssignmentsPublish` ran. The dialog had already closed optimistically,
so the teacher saw the calm "LyfeLabz assignment was not created" outcome
line but no assignment was created. This is proven browser evidence, not an
inference.

**Root cause.** `mintAssignmentId` (formerly in-line in
`app/src/shell/surfaces/curriculum.ts`) built a deterministic readable id
and, when it exceeded 64 characters, trimmed with `raw.slice(raw.length - 64)`.
For real certification-length identifiers (28-char Firebase teacher uid,
long lesson slug such as `earths-place-in-the-universe`, 20-char Firestore
class id, 12-char nonce; readable form ~93 chars) this blind tail-slice
could (a) begin with `-`, violating the pattern's alphanumeric-start rule,
and (b) drop a differing class id sitting in the middle of the string, so
two distinct classes could collide on one id.

**Bounded fix.** The minter moved to a new firebase-free module,
`app/src/shell/surfaces/shared/assignmentId.ts` (paralleling `classId.ts`),
so it can be unit-tested in isolation. The over-length branch no longer
tail-slices. It now:

- keeps a valid alphanumeric leading sentinel (`a-...`) trimmed to a valid
  boundary, and
- appends a deterministic 64-bit FNV-1a digest of the full logical tuple
  (teacher uid, lesson slug, class id, nonce), rendered in base36
  (URL-safe `[0-9a-z]`).

Every returned id now begins and ends alphanumeric, is <= 64 characters,
contains only URL-safe characters, is deterministic for the same logical
input, and is distinct across different nonces, class ids, teacher uids,
and lesson slugs regardless of field lengths. The common (short) case is
unchanged apart from a defensive trailing-separator trim. `ASSIGNMENT_ID_PATTERN`
was not weakened and no server contract was broadened. No Firestore data
was modified.

**Failure UX.** No change was required. On total createDraft failure
`summarizeOutcomes` already emits a visible, non-misleading, teacher-safe
banner line ("... LyfeLabz assignment was not created. Google Classroom
publication was not attempted."), and the false-success suite already
asserts it renders. The optimistic-close UX was not redesigned.

**Regression tests added.** A new focused suite
`app/src/shell/surfaces/shared/assignmentId.test.ts` exercises real-length
identifiers (28-char teacher uid; realistic 20-char class ids; long slugs
including `parts-of-an-ecosystem`, `what-is-life`, `body-systems`,
`earths-place-in-the-universe`) and asserts pattern conformance, <= 64
length, determinism, and distinctness across nonce / class id / teacher
uid. A contract test reads the server source, extracts its live
`ASSIGNMENT_ID_PATTERN`, asserts the client mirror is byte-identical, and
asserts every minted id passes the actual server regex. `curriculum.lms-publish.test.ts`
gains a two-row publication-OFF lifecycle test whose createDraft validates
the minted id against the server pattern: both createDraft calls succeed,
both `assignmentsPublish` calls run, no `lmsAssignmentsPublish` runs, and
the calm LyfeLabz success outcome is produced.

**Certification status.** Certification remains **paused at scenario B6**
pending browser retest of the bounded fix. It has not advanced to B7.

## 25. Certification-found defect: success confirmation not visible (scenario B6)

Browser certification, re-run after the assignmentId minter fix
(section 24), confirmed the B6 backend lifecycle now **passes**:
`assignmentsCreateDraft` succeeds, `assignmentsPublish` succeeds, no
`lmsAssignmentsPublish` runs when Classroom publication is OFF, and the
assignmentId minting defect is resolved. B6 nonetheless **failed on
presentation**: after clicking Assign the dialog closed and the teacher
perceived no visible success confirmation. The frozen architecture is
unchanged; no assignment lifecycle logic was modified and the Assign
experience was not redesigned.

**Symptom (browser evidence).** After a successful Assign the dialog
closed and the teacher, still scrolled near the assigned lesson card, saw
nothing. The quiet self-dismissing banner *was* rendered with correct
copy, but it was appended at the very bottom of the Curriculum surface
(after the lesson grid), the page did not scroll to it, and it
self-dismissed after four seconds. The backend, the generated summary,
and the banner copy were all correct; the failure was purely visibility.

**Root cause (two independent defects).**

1. *Off-screen placement.* The `assign-success` live region was rendered
   below the lesson grid, out of the teacher's viewport at the moment of
   confirmation, and nothing scrolled it into view before it self-dismissed.

2. *Stale self-dismiss timer.* `showSuccess()` created a new four-second
   timeout on every call but never cleared the previous one. The Assign
   flow calls it twice, first with the optimistic "Assigning..." line and
   then with the final "Assigned..." outcome. The optimistic timer, still
   pending, could fire and hide the final Assigned message early.

**Bounded UI fix.** Smallest architecture-preserving change; no modal, no
wizard, no navigation redesign; the quiet self-dismissing notification
philosophy, the `role="status"` / `aria-live="polite"` semantics, the
copy, the lifecycle, and the backend are all unchanged.

- *Visibility.* `.shell-curriculum-success` in the shell host page
  (`app/index.html`) is now a fixed toast anchored near the top-center of
  the viewport (`position: fixed; top: 1rem`), so it is seen immediately
  after Assign regardless of scroll position and without moving the
  teacher's scroll. `showSuccess()` adds a `shell-curriculum-success-visible`
  marker class when it shows the banner and removes it on dismiss, giving
  the DOM a concrete, testable visibility signal.

- *Timer correctness.* `showSuccess()` now tracks the pending self-dismiss
  timeout per banner in a `WeakMap` and clears any in-flight timer before
  installing the new one. Only the newest message owns the dismiss timer,
  so the optimistic timeout can never hide the final Assigned line, and
  the banner self-dismisses only after the newest four-second timeout.

**Badge verification.** The lesson card's `✓ Assigned` badge already
updates correctly on a successful publish: the lifecycle calls
`markPersisted` before `onLifecycleComplete`, and `refreshAssignControl`
re-derives the badge from the persisted-assignment registry. No badge
change was made; a regression test now pins this behavior.

**Regression tests added.** A new focused suite
`app/src/shell/surfaces/curriculum.success-banner.test.ts`:

- banner is visible (not hidden, carries the visible marker class,
  retains `role="status"` / `aria-live="polite"`) after a successful
  assignment;
- banner shows the final "Assigned" line, not the optimistic "Assigning"
  line, after both callbacks fire;
- a second `showSuccess` clears the first timer, so at t=4000ms (when the
  optimistic timer would have fired) the final message is still visible,
  and the banner self-dismisses only after the newest timer;
- banner stays visible for the full four seconds after the newest message;
- a successful assignment still lights the `✓ Assigned` badge on the card.

**Certification status.** Certification remains **paused at scenario B6**
pending a browser retest of this bounded UI fix. It has not advanced to B7.

## 26. Certification-found defect: toast CSS did not reach the visible state (scenario B6)

Browser certification, re-run after section 25 (and after restarting the
Functions emulator, which cleared the transient invalid-assignmentId
condition), confirmed the B6 backend lifecycle passes and `showSuccess()`
runs. The toast, however, still did not render as intended. This is a
follow-up presentation defect to section 25, isolated to the CSS /
served-document seam. No assignment lifecycle, assignmentId minting,
Functions, Firestore, or Google Classroom publication logic was touched,
and the Assign experience was not redesigned.

**Symptom (browser evidence).** DevTools on `/app/teacher` showed the
`assign-success` live region toggling and re-hiding on its four-second
timer, but the applied `.shell-curriculum-success` styles contained the
inline-callout token rule plus the older `margin: 0.75rem 0` rule, and
did **not** contain the section-25 fixed-toast declarations
(`position: fixed`, `top`, `left`, `transform`, `z-index`, `box-shadow`).
The JavaScript behavior was current while the toast CSS was not.

**Root cause (CSS cascade + JS/CSS seam; the served document was correct).**
The document Firebase Hosting serves for `/app/teacher` is the repo-root
`app/index.html` (`hosting.public: "."`, rewrite `/app/**` ->
`/app/index.html`). The `build` script only bundles JS
(`esbuild src/index.ts -> dist/bundle.js`); it never generates or copies
the HTML, and `app/index.html` loads that separate bundle by URL. That is
why the browser always receives current JavaScript regardless of the HTML:
the JS is a distinct built artifact, while the toast CSS is inline in the
hand-authored HTML. A byte-for-byte diff of the emulator response against
the working tree was identical, so the served bytes were not stale; the
DevTools screenshot reflected a **browser-cached pre-edit copy** of the
HTML. Two genuine repo-level defects nonetheless survived a hard refresh:

1. *Wrong state targeted.* `showSuccess()` toggles the class
   `shell-curriculum-success-visible`, but **no rule for that class existed**.
   The section-25 fixed-toast declarations were attached to the base
   `.shell-curriculum-success` class instead of the visible-state class the
   JavaScript actually adds - a JS/CSS seam with nothing backing the toggled
   class.

2. *Cascade override + header overlap.* A later "token unification" rule
   (`.shell-curriculum-success`, same 0,1,0 specificity, declared after the
   base rule) re-colored the class with the inline-callout success token
   whose background is only ~8% opaque - unreadable for a toast floating
   over page content - and `top: 1rem` (16px) did not clear the in-flow
   application header (`.shell-header` measures ~70.5px: a 24.3px x 1.6
   wordmark line box, or 44px coarse-pointer targets, plus 15.3px x 2 block
   padding and a 1px border).

**Bounded UI fix.** The visible **state** now owns the toast presentation.
A single new rule, `.shell-curriculum-success.shell-curriculum-success-visible`
(specificity 0,2,0), reliably outranks both the base rule and the token
rule regardless of source order, so the fix cannot be silently undone by a
future callout-token pass. It sets `position: fixed; top: 5.5rem` (88px at
the app's 16px root, clearing the ~70.5-75.6px header with ~12-17px of gap,
constant across breakpoints because the header keeps canonical padding and
wordmark size on phones), `left: 50% / translateX(-50%)` centering, an
**opaque** success background (`#e8fbf0`, the section-25 tint composited
over white so it stays readable over any content), `#175a31` success ink
for strong contrast, `margin: 0` so the fixed toast cannot shift layout,
and a soft `box-shadow`. The base `.shell-curriculum-success` rule was
reverted to its committed inline-callout form. `role="status"`,
`aria-live="polite"`, the copy, the ~4s self-dismiss, and the backend are
all unchanged. Measured live against the served stylesheet: header 70.47px,
toast top 88px, gap 17.5px, computed background `rgb(232,251,240)` (opaque),
ink `rgb(23,90,49)`, centered.

**Regression tests added.** The section-25 jsdom suite asserts DOM state
only; it passed the entire time the browser showed no toast, because jsdom
never loads `app/index.html` or applies its CSS. A new node-environment
suite `app/src/shell/surfaces/curriculum.assign-toast-css.test.ts` pins the
served-document seam that actually failed:

- Hosting config: `public` is `"."` and `/app/**` rewrites to
  `/app/index.html`, so the asserted file is the served document.
- JS/CSS agreement: `showSuccess()` toggles
  `shell-curriculum-success-visible`, and the served HTML defines a rule for
  that exact class.
- Presentation: the visible-state rule is fixed, top-anchored with an
  offset that clears the header (>= 4.8rem), centered, layered, with an
  **opaque** background (not the `--tw-callout-success-bg` token and not a
  translucent `rgba()`), and strong `#175a31` ink with `margin: 0`.
- Cascade: the visible-state selector carries two classes (0,2,0), higher
  than the token rule (0,1,0), so the toast wins.

**Certification status.** Certification remains **paused at scenario B6**
pending a browser retest of this bounded presentation fix. It has not
advanced to B7.

## 27. Certification-found defect: unactivated publish path (scenario B9)

Browser certification, resumed after the B6 fixes, reached scenario **B9**
(the first live Google Classroom *publication* attempt) and exposed two
distinct production implementation defects on the publish path. Both are
implementation defects, not architecture changes: the frozen Phase 2
architecture, the publication contract, and every server-side invariant are
unchanged. Certification is **stopped at B9** and was **not retried**; B9's
intended sequence (publish attempt to a bound transport, then the missing
`classroom.coursework.me` scope surfacing as `lms.insufficientScope`, then
incremental consent and a successful retry) is precisely what these fixes
restore the ability to observe. No scope was auto-granted, no consent was
bypassed, and publication retry semantics were not changed.

### 27A. Missing per-callable production transport binding

**Root cause.** Three upstream Google Classroom callables performed a real
transport operation without independently activating the production
bindings. Each reached the provider through the adapter
(`lmsAssignmentsPublish` -> `adapter.publishAssignment`,
`lmsClassesListTopics` -> `adapter.listClassTopics`,
`lmsClassesRefresh` -> `adapter.fetchClass`) but neither called
`ensureGoogleClassroomProductionBindings()` at handler entry nor declared
`googleClassroomProductionSecrets` on the `platformCallable(...)` options.
The module-level transport is per-worker state. In a worker that had not yet
served a callable that *did* activate the bindings (the Sprint 24B
import/discovery/sync callables), the transport was still the sentinel
`UnboundGoogleClassroomTransport`, whose `createCourseWork()` throws
synchronously. The publish path therefore depended on another callable
having run first in the same worker, which is not guaranteed.

**Affected callables.** `lmsAssignmentsPublish`, `lmsClassesListTopics`,
`lmsClassesRefresh`.

**Bounded fix.** Each of the three callables now mirrors the established
Sprint 24B pattern used by `lmsClassesImport` / `lmsClassesDiscover` /
`lmsClassesSyncRoster`, verbatim:

- calls `ensureGoogleClassroomProductionBindings()` as the first statement
  of the handler, before any provider or transport work;
- attaches `{ secrets: [...googleClassroomProductionSecrets] }` through the
  existing `platformCallable(options, handler)` mechanism.

The installer is idempotent and respects an explicitly installed test
transport (it only binds when the seam is unbound), so fixture behavior is
preserved and no global bootstrap was introduced. A bounded audit of every
Google Classroom callable confirmed these were the only three missing the
wiring; all other upstream callables already carried both, and the
Firestore/read-only callables (`connectionsDescribe`, `providersList`)
correctly carry neither.

### 27B. Escaped timeout / unhandled-rejection worker crash

**Root cause.** In `adapter.publishAssignment` the 30-second
AbortController-backed timeout timer was created, and then
`transport.createCourseWork()` was invoked, *before* the `try` whose
`finally` cleared the timer. If `createCourseWork()` threw **synchronously**
(exactly what the unbound transport of defect 27A does), control left the
function before entering the `try`, so the `finally` never ran. The 30-second
timer stayed live and, on firing, rejected a timeout promise that no longer
had a consumer (the `Promise.race` was never reached). That unhandled
rejection could crash the Functions worker roughly 30 seconds after the
publish call had already returned an error, one interacting with the other:
27A guaranteed the synchronous throw that 27B then turned into a delayed
crash.

**Affected code.** `platform/functions/src/lms/providers/google-classroom/adapter.ts`,
`publishAssignment`.

**Bounded fix.** The timer creation, the `createCourseWork()` call, and the
`Promise.race` now live entirely inside a single `try` whose `finally`
clears the timer. This one ownership boundary clears the timer regardless of
how the call settles: synchronous throw, asynchronous rejection, success, or
the 30-second timeout winning. A no-op `.catch()` is additionally attached to
the timeout promise itself so the losing side of the race (or an orphan on a
synchronous throw) can never surface as an unhandled rejection. The intended
30-second timeout behavior is intact and still surfaces through the
established `lms.upstreamCallFailed` contract. No process-level
`unhandledRejection` handler was added; the lifecycle defect was fixed
structurally rather than suppressed.

### 27C. Regression coverage

- **Transport binding (Part 4A).** Each of the three callables now has a
  binding-contract test asserting (1) the callable declares
  `googleClassroomProductionSecrets` (a sentinel from a mocked
  `config-firebase` proves the value's provenance) and (2)
  `ensureGoogleClassroomProductionBindings()` runs at handler entry before
  the adapter is resolved. `lmsClassesListTopics` gained a new callable
  suite (`classes-list-topics.test.ts`); `assignments-publish.test.ts` and
  `classes-refresh.test.ts` were extended.
- **Synchronous throw (Part 4B).** A new adapter test installs a transport
  whose `createCourseWork()` throws synchronously, asserts the mapped
  failure surfaces, advances fake timers past 30 seconds, and asserts
  `jest.getTimerCount()` is 0 and no `unhandledRejection` fired. This test
  fails against the pre-fix adapter (observed timer count 1) and passes
  post-fix.
- **Normal timeout (Part 4C).** A never-resolving transport asserts the
  30-second timeout still fires as `lms.upstreamCallFailed`, the timer is
  cleared afterward, and no later rejection leaks.
- **Insufficient-scope path (Part 4D).** With a bound transport and a
  readonly-only scope shortfall, publication surfaces `lms.insufficientScope`
  rather than `lms.googleClassroomTransportUnbound` or a generic upstream
  failure. Scopes were not widened to force success.

### 27D. Confirmations

- **OAuth state is readonly-only and untouched.** The certification
  connection remains at its initial (readonly) scope. No code grants scopes,
  bypasses consent, or alters publication retry semantics. The next B9 retry
  can now produce the intended sequence: publish attempt -> bound real
  transport -> missing `classroom.coursework.me` -> `lms.insufficientScope`
  -> incremental consent -> retry -> successful publication.
- **Existing failed publication record left untouched.** The `failed`
  publication record written by the earlier transport-unbound attempt was not
  altered, deleted, or migrated.
- **No emulator/seed reframing.** This is a per-callable production-activation
  requirement, not an emulator startup or seed obligation.

### 27E. TEMPORARY B9 upstream diagnostic instrumentation (awaiting one real-Google capture)

**Why.** §27 assumed the readonly-only publish attempt would surface as
`lms.insufficientScope`. The resumed diagnosis established that the real
readonly-only B9 attempt instead reached the genuine `createCourseWork` call,
failed at real Google, and was translated to `lms.upstreamAuthorizationFailed`
(not `lms.insufficientScope`). The current transport surfaces only a single
`upstreamCode` string and cannot read `WWW-Authenticate` at all, so it discards
the evidence needed to determine how Google actually signals an insufficient
scope shortfall (HTTP 401 vs 403, `error.status`, `error.details[].reason`, or
the `WWW-Authenticate` auth-error token). The permanent classification
correction is therefore **awaiting one sanitized real-Google capture** from a
single B9 diagnostic retry.

**What was added (temporary).** Sanitized diagnostic instrumentation at the
non-2xx boundary of the Google Classroom HTTPS transport
(`transport.ts`, `callUpstream`). On any non-2xx upstream response it emits one
structured log, `lms.googleClassroomUpstreamDiagnostic`, carrying only:
HTTP status; `error.status` (enum-token only); `error.code` (numeric);
`error.details[].reason` values (enum-token only); the `WWW-Authenticate`
auth-error token (e.g. `insufficient_scope`, `invalid_token`) and a boolean
presence of its `error_description`; `error.message` presence plus a
categorical label drawn from a fixed allowlist of Google's own non-identifying
messages; and a route with every dynamic id segment replaced by `{id}`. It
explicitly never logs tokens, Authorization or any header set, OAuth
codes/secrets, full request/response bodies, full error messages, account
email, user id, course id, coursework id, or any student/teacher PII. To read
`WWW-Authenticate`, the `HttpsFetch` seam gained one optional named-header
reader (`header?(name)`), delegating to `Response.headers.get`; no full header
set is copied into application state.

**Classification intentionally unchanged.** `extractUpstreamCode`, the
scope-insufficient reason scan, and the adapter's `translateUpstreamError`
mapping are untouched. The diagnostic emits and returns; the value thrown from
`callUpstream` is identical. This is deliberate: the next real B9 attempt must
**reproduce the current failure** (still `lms.upstreamAuthorizationFailed` if
that is what Google returns) while emitting the missing evidence. Tests pin
that the thrown `upstreamCode` is unchanged for both the insufficient-scope and
ordinary-denial shapes.

**TEMPORARY - must be removed or converted before Sprint 25 closeout.** This
instrumentation is a bounded certification diagnostic, marked `temporary: true`
in its payload and flagged in-code. Before Sprint 25 closeout it must be
removed or converted into appropriately minimal permanent observability, at the
same time the permanent insufficient-scope classifier is written from the
captured evidence.

**Secondary scope observation (read-only, no change made).** A read-only review
of the coursework-create scope was requested. The project docs (PDR-030b)
select `classroom.coursework.me` as the publication write scope but do **not**
capture Google's own API-reference scope-requirement table for
`courses.courseWork.create`. Per Google's published Classroom API reference, a
teacher creating coursework requires `classroom.coursework.students`;
`classroom.coursework.me` is a caller-scoped (student-facing) scope and is a
strong candidate for the true B9 root cause. Because the repository docs do not
themselves establish Google's requirement, this is flagged as **requiring
verification against the live Google API reference** (which the diagnostic
capture will corroborate) rather than treated as settled. **No OAuth scope was
changed**; `GOOGLE_CLASSROOM_PUBLICATION_SCOPES` is untouched.

> **CONFIRMED and CORRECTED (2026-08-16, Sprint 25 B9 live certification,
> PDR-030g).** The prediction above was corroborated by real Google. In the
> live B9 run, Google granted `classroom.coursework.me`, yet the teacher-side
> `courses.courseWork.create` call still returned HTTP 403
> `ACCESS_TOKEN_SCOPE_INSUFFICIENT`. Token-lifecycle analysis ruled out stale
> `tokenRef`, stale access token, worker isolation, token-store inconsistency,
> and connection-metadata/token-bundle divergence: the post-consent token
> genuinely carried `.me`. `GOOGLE_CLASSROOM_PUBLICATION_SCOPES` was
> subsequently corrected from `classroom.coursework.me` to
> `classroom.coursework.students`. The read-only-at-the-time wording above is
> retained unchanged for traceability; see PDR-030g in
> `LYFELABZ_PLATFORM_DECISIONS.md`.

### 27F. RESOLVED - successful B9 (and co-observed B10) live certification (2026-08-16)

After the §27A / §27B fixes and the PDR-030g scope correction
(`classroom.coursework.me` -> `classroom.coursework.students`), the operator
re-ran B9 against real Google from a clean readonly-only baseline. The
complete intended sequence occurred end to end and **B9 is PASS** (B10 is
co-observed PASS on the same run). The evidence below was read from the live
emulator Functions log and emulator Firestore; no certification data, no
token, and no Google Classroom coursework was edited or deleted to gather it.

**Readonly baseline (pre-B9).** Connection `googleclassroom__cert-teacher-001`,
tokenRef `lms_token_7bc61476...` present, scopes exactly
`classroom.rosters.readonly` + `classroom.courses.readonly`. No publication
scopes; `classroom.coursework.students` and `classroom.topics.readonly` both
absent. (That baseline bundle was subsequently rotated out and is now absent,
see below - authoritative confirmation of a fresh, unwidened starting point.)

**Operator action.** Assigned Biological Evolution to one Google
Classroom-linked class, publication enabled, topic "No topic", Assign clicked
**exactly once**.

**Observed backend chain (this run, assignment `...28x9thcelm9k7`), in order:**

1. `lmsClassesListTopics` -> `lms.googleClassroomUpstreamDiagnostic` (HTTP 403,
   route `/v1/courses/{id}/topics`, `ACCESS_TOKEN_SCOPE_INSUFFICIENT`) -
   pre-consent topic read returns no topics, consistent with the readonly
   baseline.
2. `assignmentsCreateDraft` -> `assignments.created` (one draft, no duplicate).
3. `assignmentsPublish` -> `assignments.published` (LyfeLabz activation).
4. `lmsAssignmentsPublish` (first attempt) ->
   `lms.googleClassroomUpstreamDiagnostic` (HTTP 403, route
   `/v1/courses/{id}/courseWork`, `errorStatus PERMISSION_DENIED`,
   `detailReasons [ACCESS_TOKEN_SCOPE_INSUFFICIENT]`, `WWW-Authenticate
   insufficient_scope`) - the decisive insufficient-scope failure on coursework
   creation.
5. `lmsConnectionsBegin` (intent `publication`) - one incremental-consent
   handoff opens.
6. `lmsConnectionsComplete` -> `lms.connectionScopesWidened` - OAuth callback
   recovered the publication intent, revalidated the same upstream account,
   wrote a new token bundle, and widened the connection.
7. `lmsAssignmentsPublish` (single automatic re-issue, same attemptNonce) ->
   `lms.assignmentPublished` - success.

Exactly one begin/complete pair; exactly two `lmsAssignmentsPublish` calls
(insufficient, then success); no second `assignmentsCreateDraft`; the operator
did not click Assign again. The re-issue is single and nonce-stable by
construction (`curriculum.ts`: one `attemptNonce` per logical publication
action, reused on the automatic post-consent re-issue and never re-minted).

**Insufficient-scope proof (not a different failure).** The first publish
failed at the coursework-create route with HTTP 403 `PERMISSION_DENIED`, detail
reason `ACCESS_TOKEN_SCOPE_INSUFFICIENT`, and `WWW-Authenticate:
insufficient_scope`. It was not `invalid_token`, not an expired token, not a
wrong account (identity revalidation passed at widening), not a
transport-unbound error (§27A), not a timeout, and not a generic authorization
failure. This is the exact sanitized real-Google shape §27E was awaiting.

**Post-consent credential (authoritative, emulator Firestore).** Connection
`googleclassroom__cert-teacher-001`: status `active`, tokenRef rotated to
`lms_token_0736b760...` (the readonly baseline bundle `...7bc61476...` was
cleaned up after the connection update committed and is now absent),
`scopesUpdatedAt 2026-08-16T17:07:48Z`. Stored scope set (sorted union), on
both the connection document and the current token bundle:

- `classroom.courses.readonly`
- `classroom.coursework.students`
- `classroom.rosters.readonly`
- `classroom.topics.readonly`

`classroom.coursework.me` is **absent**. `classroom.coursework.students` and
`classroom.topics.readonly` are **present**. The prior readonly scopes are
preserved (Google showed "LyfeLabz already has some access"; the teacher was
not asked to re-grant them).

**Publication record.**
`lmsAssignmentPublications/...28x9thcelm9k7__googleclassroom__88c6cf85`: status
`succeeded`, providerId `googleClassroom`, connectionId
`googleclassroom__cert-teacher-001`, lmsClassId `871447706346`, lmsAssignmentId
`874734574049`, lmsAssignmentUrl
`https://classroom.google.com/c/ODcxNDQ3NzA2MzQ2/a/ODc0NzM0NTc0MDQ5/details`,
publishedAt `2026-08-16T17:07:49.351Z`, no topic id (No topic), no error
fields. Exactly one publication record for this assignment; the pre-consent
insufficient-scope attempt left no separate record (V5/V6).

**LyfeLabz assignment.** `assignments/...28x9thcelm9k7`: lessonSlug
`biological-evolution`, title `Biological Evolution`, classId
`3la0b7o2jgw03cfzebw5` (one class), status `published`. Exactly one assignment
for the single Assign action; the OAuth round trip created no second one. Three
earlier biological-evolution assignments are historical and were left
untouched: `...o1jhtu9uyyqz` (failed on the pre-correction `.me` scope,
`lms.upstreamAuthorizationFailed`, no coursework created) and
`...2ntxr6yqeichv` / `...3kr1o1bweg9tl` (earlier incomplete B9 attempts, zero
`lms.assignmentPublished`, no coursework created).

**External Google Classroom confirmation.** The operator independently
confirmed in the real course "LyfeLabz Testing": Biological Evolution, Posted
1:07 PM, under No topic. This correlates with lmsClassId `871447706346`,
lmsAssignmentId `874734574049` (the launcher URL's base64 segments decode to
exactly those two ids), publishedAt 17:07:49Z (1:07 PM local), and the
No-topic behavior recorded in the publication document.

**Exactly one coursework item.** Across the entire B9 investigation exactly one
`lms.assignmentPublished` fired and exactly one publication record reached
`succeeded`; the three earlier assignments produced zero. The single idempotent
publication key (`...88c6cf85`) means the automatic post-consent re-issue
transitioned the same logical publication rather than creating a second
coursework item.

**Diagnostic disposition.** The temporary `lms.googleClassroomUpstreamDiagnostic`
instrumentation (§27E; uncommitted working-tree only, marked `temporary: true`,
`certification: "sprint25-b9"`) has now served its purpose - it captured the
sanitized real-Google insufficient-scope shape above. Recommendation:
**remove it, or convert it to minimal permanent observability, as a dedicated
Sprint 25 closeout change**, together with writing the permanent
insufficient-scope classifier from this capture. It is intentionally left in
place for now; this B9 checkpoint does not authorize the production-code change,
so it was not touched.

**Certification status.** B9 and B10 are **PASS** as of 2026-08-16 (see §27F);
the earlier "stopped at B9" status in §27E is superseded. Levels C (genuine
browser run) and D (real Classroom coursework created and filed) were achieved
for B9. The next operator step is **B4b** (post-consent topic-selector
population from real Google), then **B7** (publish, no topic) and **B8**
(publish, topic selected), per certification runbook §5 step 4; the connection
now holds the widened scope set those scenarios require. Level E
(production-rollout OAuth verification and Data Access declaration for the
coursework scopes) remains out of scope.

*End of Phase 3 completion report.*
