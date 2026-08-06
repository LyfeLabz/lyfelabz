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
Suite with a Google Classroom API test double, plus the backend verification
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

*End of Phase 3 completion report.*
