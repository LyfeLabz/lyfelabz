# Sprint 26 Phase 6B - Recovery + Restart Findings (live publication blocked at provider boundary)

Status: This is a certification-progress record, not a completion report.
Sprint 26 is NOT production-certified and NOT marked complete by this
document. No deploy, no stage, no commit, no push, no production state
change. The only real-Google interaction was a single stored-credential
refresh attempt, which Google rejected (see section 6).

Style: no em dashes. " - " is the sentence break.

## Verdict

**PRESERVATION + RESTART: PASS. LIVE PATH B PUBLICATION: BLOCKED at the
provider boundary. Sprint 26 NOT marked complete.**

The in-memory widened Path B fixture was preserved to a new on-disk
snapshot, independently validated, and restored into a freshly built
Sprint 26 environment. All preservation gates (P0 through P7) passed. The
live publication then could not complete: the preserved connection's
refresh token is no longer valid at real Google (`invalid_grant` / 401 ->
`lms.upstreamAuthorizationFailed` -> `lms.reconnectRequired`). Curing that
requires incremental OAuth / reconnect, which is explicitly forbidden.

This is a provider-boundary condition, not a Sprint 26 code defect and not
a preservation defect. The fixture was preserved exactly (the token bundle,
its refresh token, and the widened scope all survived the export/restart);
the upstream Google grant it points to has since become unrefreshable.

## 1. Pre-export state (Gate P0)

- Git HEAD `732017d`, working tree = the Sprint 26 baseline. Nothing staged.
- Stale emulator: PID 98584, started
  `firebase emulators:start --import ./sprint25-b9-pre-retest` (no
  `--export-on-exit`), from `platform/firebase`. Firestore PID 98641 on
  8080. Ports 5001/8080/9099/9199/4000/4400/4500/9299/9150.
- Live in-memory fixture (read-only, redacted): `cert-teacher-001` active,
  widened (scope set includes `classroom.coursework.students`),
  `scopesUpdatedAt 2026-08-16T17:07:48.502Z`, tokenRef present. Connections
  `cert-teacher-001..004` all present (B13 artifacts not pruned).

## 2. Credential custody (Gate P1) - Firestore-backed, survives restart

- In a functions runtime (`FUNCTION_TARGET` set, which the Emulator Suite
  sets), `lms/index.ts` runs `ensureLmsDurableStorageBindings()`, installing
  `FirestoreLmsTokenStore`. Token bundles live in Firestore
  `lmsTokenBundles/{tokenRef}`, which `firebase emulators:export` captures.
- Verified against live data: the bundle at `cert-teacher-001`'s tokenRef
  exists with an access token, a refresh token, an upstream identifier, and
  the coursework scope. No secret value was printed.
- Conceptual finding: `tokenRef` resolves to a Firestore-backed token
  bundle and survives emulator import. This is the safe custody case, not
  the volatile in-process store.

## 3. Snapshot export (Gate P2)

- New directory `platform/firebase/sprint26-pathb-cert-state/`
  (firestore_export + auth_export + storage_export), created by
  `firebase emulators:export` against the running hub. The stale emulator
  was NOT stopped to export.
- Historical snapshots `sprint25-b9-pre-retest` and `sprint25-cert-state`
  untouched. No manual edit of exported data. All four connections
  preserved (B13 `-002/-003/-004` not pruned).
- Ignored by the pre-existing `.gitignore` rule
  `platform/firebase/*-cert-state/`. No `.gitignore` change was needed. The
  snapshot is invisible to git.

## 4. Throwaway validation (Gates P3 / P4 and section 7)

- A throwaway firestore-only emulator on alternate port 8090 imported the
  new snapshot. The live stale emulator was not touched.
- `cert-teacher-001`: exists, active, widened, `scopesUpdatedAt` intact.
- Credential resolution proven through the real abstraction:
  `FirestoreLmsTokenStore.resolve(tokenRef)` succeeded and returned a
  structurally valid bundle (access token, refresh token, upstream id, and
  coursework scope all present). No secret value printed.
- Path B qualified: durable active connection, widened publication scope,
  resolvable credential, no incremental OAuth required for a normal
  publication. Throwaway torn down; stale emulator preserved throughout.

## 5. Stop, rebuild, restart, prove (Gates P-stop, P5, P6, P7)

- Only after validation, the stale emulator was stopped (graceful SIGTERM);
  all cert ports released. The widened state remained in the validated
  snapshot.
- Functions rebuilt (`npm run build`, exit 0). Compiled `lib` contains all
  Sprint 26 markers (`resolvePublicationAccountHint`, `accountHint`,
  `login_hint`, `upstreamAccountIdentifier`, `connectionScopesWidened`,
  `connectionWideningRejected`, `identityMismatch`,
  `lms.connectionScopesWidened`, `lms.connectionWideningRejected`) and is
  newer than every corresponding source file.
- Restarted on the normal ports importing
  `sprint26-pathb-cert-state`. The suite loaded every function from the
  freshly built `lib` (including all LMS callables) with no build error and
  no "SPRINT 26 BUILD NOT DEPLOYED" condition. Deterministic + load
  evidence proves Sprint 26 is running; Google was not called to prove code
  version.
- Post-restart fixture revalidation (read-only): `cert-teacher-001` active,
  widened, tokenRef resolves through `FirestoreLmsTokenStore`. Path B
  preserved across the restart.

## 6. Live Path B publication (section 14) - BLOCKED

Mechanism: the operator (user) approved a direct production-callable run
authenticated as `cert-teacher-001` (the in-app browser could not drive the
Google sign-in popup, and no real Chrome was connected). This is a level-D
real-Google publication via the production code path, not a level-C
browser-UI run.

- Authentication: an Auth-emulator ID token for `cert-teacher-001` with its
  own persisted claims (`role: teacher`, matching `schoolId`, `districtId`).
- `assignmentsCreateDraft` created a clearly-labeled draft
  `s26cert-celltypes-1` (LyfeLabz-side only, no Google call).
- `lmsAssignmentsPublish` (Publication 1) returned
  `lms.reconnectRequired` (HTTP 400 FAILED_PRECONDITION). Functions log:
  `lms.accessTokenRefreshStarted` (reason: expired) then
  `lms.accessTokenRefreshFailed` (`errorCode: lms.upstreamAuthorizationFailed`).
- The stored access token was expired, so the resolver attempted an
  in-place refresh against real Google; Google rejected the refresh token
  (`invalid_grant` / 401). The code correctly normalized this to
  `lms.reconnectRequired` and returned a graceful failure.

Consequence: no coursework POST was ever reached. Publication 2 was NOT
attempted (stop condition). No reconnect, re-widen, incremental OAuth,
revoke, or fixture edit was performed.

## 7. Honest-failure verification (no orphan, no false success)

- No `succeeded` publication record for `s26cert-celltypes-1`; total
  `lmsAssignmentPublications` unchanged at 7.
- No `lmsPublicationRef` mirror pointer on the assignment.
- No real Google coursework was created (the failure preceded the POST), so
  there is no orphan to reconcile.
- The assignment remains a `draft` with only an `assignments.created`
  audit. It is disposable emulator state.

## 8. Why this is a stop, not something to work around

The only paths from here to a completed live publication are forbidden by
the Phase 6B authorization: incremental OAuth / reconnect to re-widen,
revoking or re-granting at Google, creating a new identity, or manufacturing
a fixture. Per the stop conditions, the correct action is to halt and report.

## 9. Disposition

- Preservation + restart: PASS (P0 through P7 proven).
- Sprint 26 implementation: correct through the provider boundary. The live
  path resolved the preserved widened credential, attempted refresh, and
  handled the upstream rejection gracefully and honestly.
- Live Path B publication certification: BLOCKED. The preserved fixture's
  upstream Google grant can no longer be refreshed; re-authorization is
  forbidden.
- Sprint 26 is NOT marked complete. No completion report is authored (that
  is gated on a successful live publication).

## 10. Environment left behind

- The Sprint 26 emulator is left RUNNING on the normal ports importing
  `sprint26-pathb-cert-state`. Stopping it discards only the disposable
  `s26cert-celltypes-1` draft; the validated snapshot on disk is unaffected.
- New snapshot `platform/firebase/sprint26-pathb-cert-state/` is local
  certification infrastructure only, gitignored, never committed.

## 11. Git status at end of run

- HEAD `732017d`, unchanged. Nothing staged, committed, pushed, or deployed.
- The new snapshot is gitignored and invisible to git.
- This findings document is a new untracked file.

## 12. Follow-up resolution (2026-08-18) - not a rewrite of the above

The BLOCKED verdict in section Verdict was accurate at the time: the
preserved fixture's refresh token was genuinely dead at real Google and
re-authorization was not yet authorized. A subsequent, explicitly
authorized controlled same-account reauthorization was then run (Sprint 26
Controlled Same-Account Reauthorization + Final Live Certification). It
cured the provider boundary through the real product path, both live
publications succeeded, and Sprint 26 reached a full PASS.

The full evidence is in `SPRINT_26_COMPLETION_REPORT.md`. Nothing in this
document is edited; the dead-refresh-token discovery it records is the
genuine live evidence that made the reauthorization legitimate rather than
a manufactured incremental-OAuth attempt. The pre-reauth snapshot
`platform/firebase/sprint26-pathb-cert-state/` remains the immutable
before-state; a distinct `platform/firebase/sprint26-certified-cert-state/`
holds the healthy after-state. Both are gitignored.
