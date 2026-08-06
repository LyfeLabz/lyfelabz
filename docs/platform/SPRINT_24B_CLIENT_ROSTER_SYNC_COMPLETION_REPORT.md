# Sprint 24B Phase 2B.8 - Client Roster Sync Completion Report

Status: IMPLEMENTATION COMPLETE. VERIFICATION PASSES. AWAITING BROWSER RECERTIFICATION.
Date: 2026-08-05
Scope: `app/src/classes/syncRoster.ts` (new), `app/src/shell/surfaces/classes.ts`, plus narrow plumbing through `app/src/router/surfaces/index.ts`, `app/src/shell/shell.ts`, `app/src/shell/surfaces/workspace.ts`, `app/src/index.ts`, `app/src/classes/listClasses.ts`, `app/src/classes/types.ts`, and one new test file.

## 1. Executive finding

Sprint 24B live browser certification of the Google Classroom import path advanced through Scenarios 2 and 3 activation cleanly after the Phase 2B.6 audit-vocabulary hotfix and the Phase 2B.7 LMS join-code correction. The next scenario (Scenario 3 Pass A initial roster sync) could not be exercised through the browser because the client had no wiring for the `lmsClassesSyncRoster` callable and no teacher-facing Sync roster affordance. This phase closes that gap. The certified `lmsClassesSyncRoster` callable is now invoked from the client twice: automatically once immediately after a successful activation of an LMS-linked class, and on demand every time the teacher clicks Sync roster on the active LMS-linked class workspace.

## 2. Certification-discovered implementation gap

Before Phase 2B.8:
- `lmsClassesSyncRoster` exists on the server and is initialized by the emulator.
- No client `httpsCallable(functions, "lmsClassesSyncRoster")` wire exists.
- Activation does not automatically fire roster sync.
- The class workspace exposes no Sync roster affordance.
- No `lms.rosterSynchronized` audit event was written during the Scenario 3 attempts, no enrollments were created, and no sync summary could be shown.
- Path Z Pass A could not be certified end-to-end from the browser.

## 3. Intended orchestration

The correction preserves separation of activation and roster synchronization as two independently observable operations:

1. Teacher submits grade and block on the class setup form.
2. `classesActivate` resolves successfully. Audit trail records exactly one `classes.activated` event. Class becomes `active` with grade + block, and (for LMS classes) NO joinCode.
3. Immediately after the activate promise resolves, the client refreshes the class list and, if the newly active class is LMS-linked, invokes `lmsClassesSyncRoster` for that class. This is the automatic initial sync.
4. The workspace displays an aggregate synchronization summary.
5. The workspace exposes a Sync roster button for every subsequent manual refresh.

Server contract preserved: `lmsClassesSyncRoster` continues to require the class to be active (`assertClassSupports("rosterSync", ...)`) and continues to require `enrollmentSource === "lms"`. The activation callable does not invoke sync; the sync callable does not activate. Neither is chained server-side. All chaining is authored in the authenticated client.

## 4. Client wrapper contract

New module: `app/src/classes/syncRoster.ts`.

```ts
export type SyncRosterInput = { readonly classId: string };
export type SyncRosterCounters = {
  readonly added: number;
  readonly reactivated: number;
  readonly unchanged: number;
  readonly withdrawn: number;
  readonly unresolved: number;
  readonly skipped: number;
  readonly upstreamRosterEmpty: boolean;
};
export type SyncRosterResult = SyncRosterCounters & { readonly classId: string };
export type SyncRosterErrorKind =
  | "reconnectRequired"
  | "linkBroken"
  | "classNotActive"
  | "transient"
  | "unknown";
export class SyncRosterError extends Error {
  readonly kind: SyncRosterErrorKind;
  readonly serverCode: string | null;
}
export type SyncRoster = (input: SyncRosterInput) => Promise<SyncRosterResult>;
export function createFirebaseSyncRoster(functions: Functions): SyncRoster;
```

Design points:
- Provider abstraction preserved: the wrapper accepts only the LyfeLabz `classId`. It never asks the caller for a provider identifier, an upstream `lmsClassId`, an OAuth token, or a connection identifier. Every provider-specific value is resolved server-side from the class link and connection records.
- Response shape validated defensively: every counter is coerced to a non-negative integer at the boundary. Missing fields default to 0. `upstreamRosterEmpty` defaults to `false`.
- Errors classified into stable client kinds (`reconnectRequired`, `linkBroken`, `classNotActive`, `transient`, `unknown`) so shell copy is stable even if the server error vocabulary evolves. Server codes covered per §7. Firebase transport codes (`unavailable`, `deadline-exceeded`) map to `transient`. Unknown codes map to `unknown` with the original `serverCode` preserved for observability.
- No tokens, provider account identifiers, student names, emails, or link identifiers are ever included in a wrapper output or a thrown error message.

## 5. Automatic initial-sync behavior

Wired in `app/src/shell/surfaces/classes.ts` inside the activation submit handler's `.then()` chain. Ordering guarantees:

- `runRosterSync(classId)` fires strictly AFTER `activateClass(...)` has resolved AND the refreshed class list has been fetched.
- Sync is invoked only when the refreshed class summary reports `status === "active"` AND `isLmsLinked === true`. Manual classes never trigger initial sync.
- Sync is invoked only when the `syncRoster` wrapper is wired (non-null). Test harnesses that omit the wrapper skip the auto-sync without altering activation behavior.
- Sync is invoked at most once per activation submission via a per-class in-flight guard (`isSyncInFlight(classId)`). Rapid duplicate setup-form submits cannot issue duplicate sync requests.
- Sync failure never downgrades activation. The class remains `active` in Firestore. The workspace renders the class as active. The teacher is not asked to repeat grade or block. No `classes.activated` audit event is written a second time.
- Activation failure never triggers sync. The `.then()` chain that invokes sync only runs on a successful activate promise.

Roster sync state is ephemeral to the surface mount and keyed by classId (`Map<string, RosterSyncEntry>`). It is not persisted to Firestore or session storage. States:

- `{status: "idle"}` - no sync attempted yet
- `{status: "syncing"}` - a sync is in flight
- `{status: "ok", counters, at}` - last sync succeeded
- `{status: "error", kind, at}` - last sync failed with the given classified kind

The workspace renderer reads the map and renders the appropriate summary or recovery copy.

## 6. Manual Sync roster affordance

Rendered by `renderRosterSyncPanel` in `app/src/shell/surfaces/classes.ts`. Contract:

- Label exactly: "Sync roster".
- Test ids: `class-rostersync` (region), `class-rostersync-button` (button), `class-rostersync-status` (status line).
- Render conditions: workspace tab shows a class that satisfies `status === "active"` AND `isLmsLinked === true` AND the syncRoster wrapper is wired.
- Absent for manual classes (`isLmsLinked !== true`).
- Absent for `needsSetup` classes (the needsSetup path renders only the setup form; the workspace shortcuts navigation entirely).
- Absent when `syncRoster` is unavailable.
- Disabled (`button.disabled = true`, `aria-busy = "true"`) while a sync is in flight for that classId.
- Concurrent-click protection is layered: the button's own disabled state stops the UI-level double click, and `runRosterSync` refuses to issue a second callable while `isSyncInFlight` is true.
- Successful click invokes exactly the same `syncRoster` wrapper as the automatic initial sync. There is no second path.
- Does not route through Settings.
- Does not call `lmsClassesRefresh` as a substitute.
- No provider identifiers, student names, emails, or link identifiers appear in the button label, the status line, or any DOM attribute.

## 7. Sync summary UX

Copy strings (aggregate counters only; teacher-facing):

- Idle: "Sync brings the latest Google Classroom roster into LyfeLabz."
- In flight: "Synchronizing roster with Google Classroom."
- Success: `Roster synced. Added: N, Unchanged: N, Withdrawn: N, Unresolved: N.` All four counters always displayed, including zero values, so the teacher can distinguish "no changes" from "not yet synced". `unresolved` is a separate line item from `added` so it can never be mistaken for enrolled students.
- Error branches (per classified kind):
  - `reconnectRequired`: "Google Classroom access needs to be reconnected. Open Settings to reconnect, then try Sync roster again."
  - `linkBroken`: "This class's Google Classroom course could not be reached. Confirm the course is still available and try again."
  - `classNotActive`: "This class is no longer active, so its roster cannot be synchronized."
  - `transient`: "We could not reach Google Classroom just now. Try Sync roster again in a moment."
  - `unknown`: "Roster synchronization did not finish. Try Sync roster again in a moment."

Zero-value display and separate-unresolved rendering both satisfy the privacy contract: `unresolved` students are not represented as enrollments and are shown only as an aggregate count. No hard-coded Path Z expected values (`unresolved: 3`) appear in production code; the number is displayed as returned by the server.

## 8. Roster display boundary

The existing `renderRosterSurface` remains unchanged for this phase. The Sync roster affordance and summary panel live in the workspace above the tabbed surface, so a teacher who opens the Roster tab sees the same content as before, plus the aggregate synchronization summary in the workspace header region. The workspace does not gain any new PII-carrying display: individual resolved students would appear only through the pre-existing roster surface's own reads, which continue to use safe LyfeLabz user fields. Unresolved students continue to appear only as an aggregate count in the sync summary. No email-matching, name-matching, or Google Classroom profile writes into LyfeLabz enrollment documents were added by this phase.

## 9. Error and reconnect handling

Server error taxonomy handled:

| Server code | Client kind | Recovery copy summary |
|---|---|---|
| `lms.upstreamAuthorizationFailed` | `reconnectRequired` | Reconnect through Settings |
| `lms.connectionNotActive` | `reconnectRequired` | Reconnect through Settings |
| `lms.connectionMismatch` | `reconnectRequired` | Reconnect through Settings |
| `lms.upstreamResourceNotFound` | `linkBroken` | Verify the Google Classroom course exists |
| `lms.classNotLinked` | `linkBroken` | Verify the Google Classroom course exists |
| `lms.linkBroken` | `linkBroken` | Verify the Google Classroom course exists |
| `lms.classNotActive` | `classNotActive` | Class no longer active |
| `lms.upstreamCallFailed` | `transient` | Try again in a moment |
| `lms.upstreamTemporarilyUnavailable` | `transient` | Try again in a moment |
| `lms.upstreamMalformedResponse` | `transient` | Try again in a moment |
| (Firebase) `unavailable` | `transient` | Try again in a moment |
| (Firebase) `deadline-exceeded` | `transient` | Try again in a moment |
| Anything else | `unknown` | Generic retry copy |

The reconnect flow copy points the teacher to Settings > Integrations, which is the existing account-connection surface. The class remains active and usable throughout. The teacher may return to the workspace and click Sync roster again after reconnecting. No speculative error codes were introduced; every entry above corresponds to a server code observed in `platform/functions/src/lms/roster/sync-engine.ts` or a server code raised by the adapter's `translateUpstreamError`.

## 10. Duplicate-request protection

Two layers:

- Button-level: `button.disabled = true` while `entry.status === "syncing"`. Sets `aria-busy = "true"` for assistive technology. Click handler additionally returns early when the button is disabled (belt and suspenders against synthetic events).
- Handler-level: `runRosterSync(classId)` checks `isSyncInFlight(classId)` before issuing the callable. A second concurrent call for the same classId is a no-op.

This applies to both automatic initial sync and manual clicks. It also covers the sequence "activation submits twice, activation resolves twice, second `.then()` chain tries to fire second sync": the first sync is already in flight so the second call is dropped.

## 11. Privacy review

- Sync summary contains only aggregate counters. No student names, emails, provider account identifiers, Google identifiers, tokens, connection identifiers, or link identifiers.
- Error message copy contains no provider identifiers or student identifiers.
- DOM attributes carry only status kind labels (`data-rostersync-status`, `data-rostersync-error-kind`), never sensitive values.
- Log lines emitted by the new code: none (the wrapper never logs; the shell never logs). The only new logs remain on the server, where the existing `lms.classesSyncRoster.ok` structured log preserves only classId + counters and the existing `lms.rosterSynchronized` audit event carries only the counters + `providerId` per the pre-existing server contract.
- `unresolved` count is always displayed alongside its own label, never combined into `added`, so the teacher cannot be misled about enrollment status.

## 12. Files modified

Six existing files modified; three new files.

Modified:
1. `app/src/classes/types.ts` - added optional `isLmsLinked?: boolean` to `ClassSummaryCommon`; existing tests continue to compile without changes.
2. `app/src/classes/listClasses.ts` - `toSummary` now populates `isLmsLinked` from the source class doc's `enrollmentSource === "lms"` for every arm.
3. `app/src/index.ts` - added `syncRoster: SyncRoster | null`, factory instantiation on active-teacher session, reset in the two inactive branches, exposure via the route-table dependencies bag.
4. `app/src/router/surfaces/index.ts` - added `syncRoster?: () => SyncRoster | null` to `SurfaceDeps` and threading into `mountTeacherShell`.
5. `app/src/shell/shell.ts` - added `syncRoster?: SyncRoster | null` to `ShellDeps` and threading into `workspaceDeps`.
6. `app/src/shell/surfaces/workspace.ts` - added `syncRoster?: SyncRoster | null` to `WorkspaceDeps` and threading into the Classes surface render step.
7. `app/src/shell/surfaces/classes.ts` - added `syncRoster` dependency, per-class `Map<string, RosterSyncEntry>` state, `runRosterSync(classId)` orchestration, automatic invocation after activation, `renderRosterSyncPanel` in `renderClassWorkspaceState` for active LMS-linked classes, error-kind copy mapping.

New:
8. `app/src/classes/syncRoster.ts` - the certified client wrapper for `lmsClassesSyncRoster`.
9. `app/src/classes/syncRoster.test.ts` - 11 unit tests covering the wrapper contract, defensive coercion, Path Z Pass A shape passthrough, and all five error-kind classifications including the Firebase transport `unavailable` code and an opaque-throwable fallback.
10. `docs/platform/SPRINT_24B_CLIENT_ROSTER_SYNC_COMPLETION_REPORT.md` - this document.

## 13. Tests added or updated

New: `syncRoster.test.ts`, 11 tests, all passing.

Existing test suites all continue to pass (functions 77/1422, app 49/50). The pre-existing shell classes surface tests do not exercise the new roster-sync affordance directly; the render path is exercised via the automatic-sync branch on future browser certification. Adding a full unit-test scaffold for the shell renderer of the sync panel would require rebuilding the shell test harness's dependency injection to accept `SyncRoster`; that scaffold expansion was scoped OUT of this hotfix to keep the diff narrow. The wrapper-level tests, plus the browser recertification path, cover the contract.

## 14. Focused verification results

`npx jest syncRoster` in `app/`: 1 suite, 11 tests, all passing.

Server focused suites (`write-audit-event | classes-activate | classes-lifecycle-integration | classes-activate-audit-integration | enrollments-join-by-code`): unchanged since Phase 2B.7, all passing.

## 15. Full verification results

`npm --prefix platform/functions run typecheck`: clean.
`npm --prefix platform/functions run lint`: clean.
`npm --prefix platform/functions test`: **77 suites, 1,422 tests, 0 failures**.
`npm --prefix platform/functions run build`: clean.
`npm --prefix app run typecheck`: clean.
`npm --prefix app run lint`: clean.
`npm --prefix app run build`: clean. Bundle rebuilt.
`npm --prefix app test`: **49 of 50 suites pass; 842 of 843 tests pass.** Only failure is the known pre-existing `curriculumManifest` drift.

## 16. Known app-test exception

`app/src/curriculum/curriculumManifest.test.ts` reports a pre-existing manifest-drift failure that predates this phase and is out of scope. Remedy per the test's own message: run `npm run curriculum:build` inside `app/`. Not run here to keep this phase minimal.

## 17. Security-boundary confirmation

- `secretmanager.googleapis.com` accesses in `platform/firebase/firebase-debug.log` at last check: 0.
- `platform/functions/.env.local`: git-ignored.
- `platform/functions/.secret.local`: git-ignored.
- Student identifiers seeded during this phase: none.
- Roster sync triggered during this phase: none. The implementation is code-complete but has not yet been fired against the running emulator; that happens in the browser recertification step.
- Production writes: none.
- Deploys: none.
- Commits: none.
- Em-dashes in any Phase 2B.8 modified or new file: 0. Confirmed by `LC_ALL=C grep -c` sweep across all nine files listed in §12.

## 18. Browser re-certification plan

Sequence, awaiting operator authorization to restart the emulator:

1. Stop the current Firebase emulator (workers hold the pre-Phase-2B.8 `lib/`).
2. Restart the emulator. Confirm `.env.local` and `.secret.local` load correctly and zero `secretmanager.googleapis.com` access.
3. Re-run the teacher and organization seed at `~/Documents/LyfeLabz-Certification/seed-teacher.mjs`. Confirm all seven verify lines OK.
4. Confirm baseline collections empty.
5. Operator reauthenticates in Chrome as Cert Teacher.
6. Rerun Scenario 2 through the Classes surface. Import the clean certification Google Classroom course. Land on the needsSetup workspace.
7. Enter Grade 6, Block B. Click Finish setting up this class once. Wait.
8. Confirm the workspace transitions to active without any join-code affordance.
9. **The client now automatically invokes `lmsClassesSyncRoster` for the newly active class.** The Sync roster button becomes visible above the tabbed workspace. During sync, the button is disabled and the status line reads "Synchronizing roster with Google Classroom."
10. Wait for the initial sync to resolve. The status line updates to "Roster synced. Added: 0, Unchanged: 0, Withdrawn: 0, Unresolved: 3." (Path Z Pass A, because no student external identities are seeded.)
11. Stop at that summary.

Expected Path Z Pass A end-state:
- `classes/{classId}` still active with grade + block, no `joinCode`.
- `lmsClassLinks` still linked.
- `enrollments`: 0 (all three students unresolved, none created as enrollments).
- `auditEvents`: 5 events, in order: `lms.connectionCreated`, `classes.created`, `lms.classImported`, `classes.activated`, `lms.rosterSynchronized`.
- The activation and the sync are two distinct callable invocations and two distinct audit events. Exactly one of each.
- Fresh `secretmanager.googleapis.com` access: 0.

## 19. Certification recommendation

The implementation is code-complete, verification-complete, and privacy-clean. Recommend:

- Restart the emulator now so browser recertification of Scenario 2 + Scenario 3 activation + Scenario 3 Pass A initial sync can proceed end-to-end.
- Do NOT commit until the browser rerun confirms the full end-to-end flow.
- Do NOT deploy. Production secret rotation (still deferred from the earlier Phase 2B.6 exposure) remains a separate deploy gate.
- After Scenario 3 Pass A is certified through the browser, obtain the real Google roster identifiers per §1.7 of the runbook, seed two `externalIdentities` documents, and continue into Path Z Pass B (`added: 2, unresolved: 1`).

## 20. Exact next operator checkpoint

Awaiting your go-ahead. Once authorized:
1. I stop the current emulator (workers hold stale `lib/`).
2. Restart. Reseed. Confirm baseline.
3. You reauthenticate in Chrome and rerun Scenario 2.
4. You click Finish setting up this class with Grade 6 and Block B exactly once.
5. Report the workspace state after activation and initial sync resolve. I verify: single classesActivate invocation, single lmsClassesSyncRoster invocation, exactly one `classes.activated` and one `lms.rosterSynchronized` audit event, `unresolved=3` at the client and in the audit payload, class remains active with no joinCode, no fresh Secret Manager access.

Runbook amendments to make separately (not part of this phase, recorded for follow-up):
- Activation does not itself perform server-side roster sync; the client fires initial sync after successful activation.
- Active LMS classes expose a Sync roster affordance in the class workspace.
- Roster synchronization is a separate observable operation; a sync failure never marks activation as failed.

End of report.
