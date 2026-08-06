# Sprint 24B Phase 2B.6 - Activation Audit Vocabulary Hotfix

Status: HOTFIX COMPLETE. AWAITING EMULATOR RESET AUTHORIZATION.
Date: 2026-08-04
Scope: `platform/functions/src/shared/audit/*`, `platform/functions/src/shared/types/audit-event.ts`, `platform/functions/src/shared/index.ts`, plus one new integration test at `platform/functions/src/classes/classes-activate-audit-integration.test.ts`.

## 1. Executive finding

During the Sprint 24B live browser certification session, the `classesActivate` callable committed its class-lifecycle transaction and then silently returned an error to the client. The class became `active` in Firestore, the client displayed the generic "We could not finish setting up this class" message, and the required `classes.activated` audit event was not written. The root cause was a deterministic dual-list drift between the `AuditAction` TypeScript union and the runtime `VALID_ACTIONS` allowlist in `writeAuditEvent`: `classes.activated` was present in the union but not in the runtime list, so every activation call failed the audit vocabulary check.

The hotfix replaces the dual-list architecture with a single source of truth: a `const AUDIT_ACTIONS = [...] as const` tuple in `shared/types/audit-event.ts`, with `AuditAction` derived as `(typeof AUDIT_ACTIONS)[number]`. The runtime validator now consults the same tuple. Drift of this class is architecturally prevented; a new audit action added to `AUDIT_ACTIONS` is simultaneously accepted by the type system and by the runtime validator. An exhaustive-by-construction test iterates `AUDIT_ACTIONS` so any future addition is exercised on the next test run.

## 2. Browser-observed failure

Sequence observed in the certification session:
1. Operator completed OAuth, imported the clean certification Google Classroom course, and landed on the class workspace with a "Finish setting up this class" affordance.
2. Operator selected Grade 6, Block B, and submitted.
3. UI displayed "could not finish setting up the class."
4. Operator re-submitted with the same Grade 6, Block B.
5. UI transitioned to a workspace showing an active class with Grade 6, Block B, and a join code.

Post-session Firestore inspection found:
- Class `1jfpu4bidxr1awtaewz3` in the expected active shape.
- Three audit events (`lms.connectionCreated`, `classes.created`, `lms.classImported`).
- No `classes.activated` audit event.
- No enrollments, no roster sync.

## 3. Deterministic root cause

Located and reproduced against the live emulator. The controlled reproduction script at `scratchpad/reproduce-audit-drift.mjs` calls the real, compiled `writeAuditEvent` with the exact input shape `classes-activate.ts:329-342` produces. The pre-fix result: `PlatformError { code: "audit.invalidAction", message: 'action must be a canonical audit vocabulary value (received "classes.activated").' }`. The post-fix result: the write succeeds.

The pre-fix architecture had two independently maintained lists:
- `AuditAction` type union at `platform/functions/src/shared/types/audit-event.ts:12-69` (former line numbers).
- `VALID_ACTIONS` runtime array at `platform/functions/src/shared/audit/write-audit-event.ts:59-102` (former line numbers).

`classes.activated` was added to the union in Sprint 24B Phase 2B.3 but was never added to the runtime array. The self-comment at the runtime array explicitly stated the lockstep requirement, but no test enforced it. A subsequent union-wide sweep found two additional latent drifts of the same kind (see §8).

## 4. Original transaction and audit ordering

Source: `platform/functions/src/classes/classes-activate.ts:201-368`.

1. Auth + validation preflight.
2. Ownership + status pre-read.
3. `allocateJoinCode` outside the transaction.
4. Firestore transaction: `tx.update` writes `{ status: "active", grade, block, joinCode }` atomically to the class doc. Transaction commits on return.
5. Post-transaction `await writeAuditEvent({..., action: "classes.activated", ...})` (line 329-342). This is a plain `await`, not wrapped in `safeLog`. A throw here propagates.
6. Post-transaction `safeLog(() => log.info("classes.activated", ...))` (line 344-351). Only runs if the audit write returned normally.
7. Return `{ classId, status: "active", joinCode, alreadyActive: false }`.

Because step 5 is outside the transaction, the class doc could commit before the audit write attempted. When the audit write threw, the callable returned an error via the `platformCallable` wrapper's `translateThrown` path (`shared/errors/https-callable.ts:143-200`). That path recognizes `PlatformError` at line 148 and remaps to `HttpsError` without emitting a `callable.unhandled` log line (that log emission is reserved for genuinely unknown throwables, at line 197).

## 5. Canonical vocabulary architecture before the fix

Two separately maintained lists:
- A type-only `AuditAction` union in `shared/types/audit-event.ts`. Compile-time enforced.
- A local `VALID_ACTIONS: readonly AuditAction[]` array in `shared/audit/write-audit-event.ts`, used by the runtime `isValidAction` guard. Runtime enforced.

Drift-detection strategy: a header comment on the runtime array telling future maintainers to keep the two in lockstep. No mechanical drift check. No exhaustive test. The `writeAuditEvent` unit test at `write-audit-event.test.ts:163-182` iterated ten hand-typed action values out of roughly forty in the union, giving false confidence.

## 6. Canonical vocabulary architecture after the fix

One canonical const tuple. `AuditAction` is derived from the tuple. Runtime validator consults the tuple.

Source of truth at `platform/functions/src/shared/types/audit-event.ts:12-83` (new line numbers):
```ts
export const AUDIT_ACTIONS = [
  "auth.userProvisioned",
  ...
  "classes.activated",
  ...
  "assignments.reopened",
  ...
  "assignments.recipientAdded",
  ...
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
```

Runtime validator at `platform/functions/src/shared/audit/write-audit-event.ts` imports `AUDIT_ACTIONS` and uses `(AUDIT_ACTIONS as readonly string[]).includes(value)`. There is no local list. There is nothing to keep in lockstep with anything else.

Import graph: `write-audit-event.ts` imports from `../types/audit-event`. `audit-event.ts` does not import from `write-audit-event.ts`. No circular dependency introduced.

## 7. Why the dual-list design failed

Two structural gaps compounded:
1. A `readonly AuditAction[]` array only enforces that every element is a valid `AuditAction`. It does NOT enforce that every `AuditAction` appears in the array. TypeScript accepts a subset. So the type system could never catch a missing entry.
2. The `writeAuditEvent` unit test that iterated actions used a hand-typed list of ten values, not the union itself. It could not catch a missing entry either.

The single-source-of-truth refactor removes both gaps by making the tuple the sole authoring surface, and the exhaustive test (§14) iterates that tuple directly so every action is exercised in the runtime validator on every test run.

## 8. Additional latent drift found

The pre-fix runtime `VALID_ACTIONS` was missing three actions that were present in the `AuditAction` union:
- `classes.activated` (Sprint 24B Phase 2B.3, the failure that triggered this investigation).
- `assignments.reopened`.
- `assignments.recipientAdded`.

The two `assignments.*` gaps would have produced the same failure mode (class-of-callable commits its transaction, audit write throws, client sees a misleading error) as soon as the corresponding callables were exercised in production. The refactor closes all three at once and prevents a fourth from being introduced accidentally.

## 9. Unmocked activation and audit regression result

A new test file at `platform/functions/src/classes/classes-activate-audit-integration.test.ts` composes the real `__classesActivateHandler` with the real `writeAuditEvent` via a partial `jest.mock("../shared", () => ({ ..., writeAuditEvent: jest.requireActual("../shared/audit/write-audit-event").writeAuditEvent, ... }))`. The audit collection is stubbed by mocking `../shared/firestore/typed-ref` to provide an in-memory `.add()` that captures the exact payload.

Result: 7 tests, all passing. Key assertions covered:
- Callable resolves successfully with `alreadyActive: false`.
- Class doc becomes active with grade + block + joinCode.
- Exactly one `classes.activated` audit event with the canonical payload:
  - `actorUserId: teacher UID`
  - `actorRole: "teacher"`
  - `action: "classes.activated"`
  - `targetType: "class"`
  - `targetId: classId`
  - `schoolId`, `districtId` inherited from actor context
  - `payload: { previousStatus: "needsSetup", grade, block }`
  - `occurredAt: serverTimestamp sentinel`
- Idempotent replay: same joinCode, no additional audit event.
- Conflicting grade or block: rejected with `classes.alreadyActiveConflict`; no additional audit event.
- Not-found class: rejected with `classes.notFound`; audit writer never touched.
- Archived class: rejected with `classes.notActivatable`; audit writer never touched.

Limitation and its rationale: this is not an emulator round-trip test. Running jest tests against a live emulator is not part of the existing repo test architecture, and setting up an emulator-run jest project would materially exceed the scope of a hotfix. What this test does prove is that the real `writeAuditEvent` code path, including the vocabulary validation and the canonical shape construction, runs on every activation. Any regression that removes an action from `AUDIT_ACTIONS` or changes the activation call site to a bad action name will fail this test.

## 10. Idempotency result

Verified by the new integration test and confirmed by the existing `classesActivate` mocked unit tests. Repeat activation with matching grade + block returns `alreadyActive: true`, preserves the join code, and does not create a second audit event. Behavior matches Sprint 24B Phase 2B Spec §8.6, §10.

## 11. Atomicity limitation explicitly deferred

The pre-fix and post-fix architectures both write the audit event outside the class-lifecycle transaction. That means a genuine post-commit audit-write failure (a transient Firestore hiccup, an emulator restart mid-write, a rules-eval regression) would still cause `classesActivate` to return an error to the client after the class had already become active. The `classes.activated` vocabulary drift was one specific way this could happen; the general shape remains.

This hotfix does NOT change the post-commit audit-write architecture. The scope was constrained to closing the deterministic vocabulary defect that produced the certification failure. A repo-wide correction that moves audit writes inside their domain transactions (or wraps them with an outbox / durable follow-up) is a larger architectural change that belongs to its own sprint. Every callable in the repo that follows the "domain transaction, then post-commit audit write" pattern (including `classesCreate`, `classesArchive`, `classesUpdateMetadata`, `classesLmsCreate`, `lmsClassesImport`, `lmsConnectionsComplete`, and others) shares this limitation.

Explicit statement, so the record is unambiguous: **the deterministic vocabulary failure is fixed. The repository-wide post-commit audit boundary is not solved. It remains deferred.**

## 12. Client behavior review

Reviewed `app/src/shell/surfaces/classes.ts:713-751` (`describeActivationError`, `extractErrorCode`) and `app/src/classes/importFromClassroom.ts:245-330` (import controller).

Findings:
- The client's `describeActivationError` fallback at classes.ts:739 is the correct fallback for an unknown error code. The failure was that the server was sending an unknown error code after a successful state transition, not that the client mishandled a known code.
- The client's re-click was possible because the workspace re-renders from the live class descriptor after any activation attempt (success or failure). The class was live-active by then, so the setup affordance was still shown by the workspace state derivation, allowing the retry.
- No client change is required to fix the observed defect. The fix is entirely on the server.

Defense-in-depth options (not applied in this hotfix; recommended for a separate UX-hardening pass):
- After any server error during activation, the client could re-read the class descriptor once before showing the error to the operator. If the descriptor now reports active, the client renders a "class is active, but a background step failed" message and offers a support-contact affordance rather than the misleading "could not finish setting up" copy.
- The `describeActivationError` mapping could add an explicit branch for `audit.writeFailed` to phrase the failure more accurately when it does surface.

Neither is required to unblock certification; both should be considered when the atomicity architecture at §11 is revisited.

## 13. Files modified

Four files modified, two files added. Six total.

Modified:
1. `platform/functions/src/shared/types/audit-event.ts` - replaced type-only `AuditAction` with a const tuple `AUDIT_ACTIONS` and a derived `AuditAction` type. Preserved all pre-existing sprint comments on their actions. Added a source-of-truth header note citing this Phase 2B.6 defect.
2. `platform/functions/src/shared/audit/write-audit-event.ts` - deleted the local `VALID_ACTIONS` array. Added `AUDIT_ACTIONS` import. Updated `isValidAction` to consult the imported tuple. Rewrote the block comment that described the dual-list requirement.
3. `platform/functions/src/shared/index.ts` - one line added: re-export `AUDIT_ACTIONS`. (Other diffs on this file were already present on the branch before this hotfix session started and are unrelated.)
4. `platform/functions/src/shared/audit/write-audit-event.test.ts` - imports `AUDIT_ACTIONS`, replaces the former hand-typed ten-value test with an exhaustive iteration of `AUDIT_ACTIONS`, adds three named regression tests for the three actions that had drifted (`classes.activated`, `assignments.reopened`, `assignments.recipientAdded`).

Added:
5. `platform/functions/src/classes/classes-activate-audit-integration.test.ts` - the new unmocked-audit integration test. 7 tests. Covers happy path, idempotent replay, conflicting grade, conflicting block, not-found, archived.
6. `docs/platform/SPRINT_24B_ACTIVATION_AUDIT_HOTFIX_REPORT.md` - this document.

## 14. Tests added or updated

Additions:
- `write-audit-event.test.ts` - `it("regression (Sprint 24B Phase 2B.6): accepts classes.activated")`.
- `write-audit-event.test.ts` - `it("regression (Sprint 24B Phase 2B.6): accepts assignments.reopened")`.
- `write-audit-event.test.ts` - `it("regression (Sprint 24B Phase 2B.6): accepts assignments.recipientAdded")`.
- `write-audit-event.test.ts` - `it("accepts every action in the canonical AUDIT_ACTIONS tuple")`. Replaces the former hand-typed partial iteration.
- `classes-activate-audit-integration.test.ts` - 7 new tests as detailed in §9.

The pre-existing `classes-lifecycle-integration.test.ts` continues to mock `writeAuditEvent` and is left unchanged; its scope covers lifecycle composition rather than audit vocabulary.

## 15. Focused verification results

`npx jest --testPathPattern "write-audit-event|classes-activate|classes-lifecycle-integration|assignments-reopen|assignments-recipient"` from `platform/functions/`:

- `src/shared/audit/write-audit-event.test.ts` PASS
- `src/assignments/assignments-recipient-list.test.ts` PASS
- `src/classes/classes-lifecycle-integration.test.ts` PASS
- `src/classes/classes-activate-audit-integration.test.ts` PASS (new)
- `src/assignments/assignments-recipient-add.test.ts` PASS
- `src/classes/classes-activate.test.ts` PASS
- `src/assignments/assignments-reopen.test.ts` PASS

Totals: 7 suites, 116 tests, 0 failures.

## 16. Full verification results

`npm --prefix platform/functions run typecheck`: clean.
`npm --prefix platform/functions run lint`: clean.
`npm --prefix platform/functions test`: 77 suites, 1416 tests, 0 failures.
`npm --prefix platform/functions run build`: clean.
`npm --prefix app run typecheck`: clean.
`npm --prefix app run lint`: clean.
`npm --prefix app test`: 48 of 49 suites pass; 831 of 832 tests pass. The single failure is `curriculumManifest.test.ts` "checked-in manifest matches a freshly parsed canonical index.html", a pre-existing manifest-drift failure unrelated to this hotfix (see §17).

## 17. Known app-test exception

`app/src/curriculum/curriculumManifest.test.ts` reports a pre-existing "Curriculum manifest drift" failure. The test verifies that the checked-in `curriculum.manifest.json` matches a fresh parse of the root `index.html`. This drift was already present on this branch at the start of the certification session (per the initial working-tree state) and is out of scope for this hotfix. Remedy per the test's own message: run `npm run curriculum:build` inside `app/`. Not run here to keep this hotfix minimal.

## 18. Security-boundary confirmation

- `secretmanager.googleapis.com` accesses in `platform/firebase/firebase-debug.log` since the last emulator restart: **0**. Confirmed by `LC_ALL=C grep -cE "secretmanager\.googleapis\.com|Trying to access secret" platform/firebase/firebase-debug.log`.
- `platform/functions/.env.local` ignored: yes, via `.env.*` rule at `platform/functions/.gitignore:5`.
- `platform/functions/.secret.local` ignored: yes, via `.secret.local` rule at `platform/functions/.gitignore:7`.
- Student identity seeds performed during this hotfix: none.
- Roster sync triggered during this hotfix: none.
- Browser-certification class `1jfpu4bidxr1awtaewz3` modified during this hotfix: no (probe writes were made to `auditEvents` and were deleted before final state check; the certification class's fields remain `status=active, grade=6, block=B, joinCode=9531C98B, title="LyfeLabz Testing"`).
- Production writes: none.
- Deploys: none.
- Commits: none.
- Em-dashes in any hotfix-modified or new file: 0. Confirmed by an `LC_ALL=C grep -c` sweep across all six files listed in §13, with the character checked being the U+2014 codepoint (spelled out here rather than pasted so this report itself does not contain the character).

## 19. Current certification-class disposition

The class `1jfpu4bidxr1awtaewz3` in the certification emulator is a valid, coherent, active LMS-linked class:
- Correct fields on the class doc.
- Correct LMS link to Google Classroom course `871447706346`.
- Correct connection and token bundle for the seeded teacher.
- Zero enrollments (no roster sync ran).
- Missing `classes.activated` audit event that cannot be back-filled without violating the `writeAuditEvent` server-time invariant at `write-audit-event.ts:132-135`.

The missing audit event on this pre-fix class is a certification-packet defect. It cannot be repaired in place. The correct remedy is to reset the emulator and rerun Scenarios 2 and 3 from a clean baseline with the hotfixed code loaded.

## 20. Required clean emulator rerun

Before Scenario 2 and Scenario 3 Pass A can be certified:
1. Stop the current Firebase emulator suite (the Functions workers currently in memory were spun up before `npm run build` regenerated `lib/`; a live callable would still hit stale code without a restart).
2. Restart the emulator suite. Confirm the fresh `firebase-debug.log` shows no `secretmanager.googleapis.com` access after the restart. Confirm the load line reads `Loaded environment variables from .env.lyfelabz-prod, .env.local.`.
3. Re-run the teacher and organization seed at `~/Documents/LyfeLabz-Certification/seed-teacher.mjs`. Expect the same seven `[verify] ... OK` lines and `[done]`.
4. Confirm the baseline collections are empty (`classes`, `enrollments`, `lmsClassLinks`, `lmsConnections`, `lmsTokenBundles`, `lmsOAuthStates`, `auditEvents`, `externalIdentities`).
5. Ask the operator to re-sign-in in Chrome and rerun Scenario 2 from the Classes surface. This time, when activation completes, the audit trail must contain a `classes.activated` event and the client must not display the misleading failure message.
6. Continue into Scenario 3 Pass A per the previously approved Path Z plan.

## 21. Production-secret rotation gate

The Sprint 24B live browser certification session earlier revealed that the Functions emulator, before the local secret architecture correction, had authenticated to production Google Cloud Secret Manager and fetched the production `GOOGLE_CLASSROOM_CLIENT_SECRET`. The Firebase apiv2 debug logger captured the fetch response body, which was base64-encoded plaintext of the production secret. The subsequent emulator restart naturally overwrote `firebase-debug.log`, but the exposure is not fully contained until:
- The production `GOOGLE_CLASSROOM_CLIENT_SECRET` is rotated in the Google Cloud Console (Credentials or Google Auth Platform, for the production OAuth client).
- The Secret Manager entry `projects/lyfelabz-prod/secrets/GOOGLE_CLASSROOM_CLIENT_SECRET` receives a new version containing the new secret.
- The old Secret Manager version is disabled after the new version is confirmed usable by production Functions.
- The old client secret on the production OAuth client is disabled after the new version is confirmed.

None of that was done in this hotfix, per the explicit direction to keep this hotfix scoped to the deterministic vocabulary defect. The production-secret rotation remains required as a separate security operation before this hotfix ships to production. Deploying the hotfix while the production secret remains unrotated is safe (the fix itself does not touch production credentials in any way), but this document flags rotation as a deploy-gate item.

## 22. Hotfix certification recommendation

The hotfix is code-complete and verification-complete. Recommend:
- Do NOT reset the emulator yet; that decision belongs to the operator so post-fix browser certification can be run under fresh operator observation.
- Do NOT commit yet; hold until the clean re-run in §20 proves the fix end-to-end in the browser. The commit message can then reference the end-to-end verification.
- Do NOT deploy yet; the production-secret rotation at §21 is the deploy gate.
- Do accept this document as the hotfix report artifact for Sprint 24B Phase 2B.6.
- Do add the `curriculumManifest` regeneration (§17) to any subsequent commit that touches app-side files.

## 23. Exact next browser-certification step

Awaiting operator authorization to reset the emulator per §20. Once authorized:
1. Stop the current emulator (this instance still holds the pre-fix `lib/` in worker memory).
2. Restart. Confirm zero `secretmanager.googleapis.com` accesses.
3. Re-seed. Confirm baseline.
4. Operator re-signs-in in Chrome at `http://localhost:5000/app/index.html`.
5. Operator repeats Scenario 2 from the Classes surface with the same clean certification Google Classroom course. This time the setup affordance stops at needsSetup and the audit trail is captured cleanly.
6. Operator repeats Scenario 3 Pass A: activate, allow the initial roster sync, expect `added=0, unresolved=3`, per Path Z Pass A.
7. Post-run verification confirms the presence of the `classes.activated` audit event and the `lms.rosterSynchronized` audit event.

End of report.
