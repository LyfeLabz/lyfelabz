# Sprint 26 Phase 6B - Blocked Findings (Path B fixture unavailable)

Status: BLOCKED. This is a certification-blocker record, not a completion
report. Sprint 26 is NOT production-certified and NOT marked complete by
this document. No deploy, no stage, no commit, no push, no production
state change, and no live Google interaction occurred.

Style: no em dashes. " - " is the sentence break.

## Verdict

**PHASE 6B BLOCKED: NO PRESERVED PATH B FIXTURE.**

The Sprint 26 Functions build succeeds and the freshly compiled artifacts
provably contain the Phase 1/2 code. However, neither preserved on-disk
certification snapshot contains a widened (publication-capable) Google
Classroom connection. Both hold `cert-teacher-001` in the pre-widening,
readonly-only state. Restarting the emulator from either snapshot would
leave the connection unwidened, so a live publication would naturally
require incremental OAuth (Path A). Forcing that is explicitly forbidden
and is a defined stop condition. Live Path B certification therefore
cannot proceed with the preserved fixtures.

This blocker is at the fixture layer, not the code layer. The Sprint 26
implementation was not exercised against live Google and is neither
certified nor faulted by this run.

## 1. Environment captured before any change (Gate C0)

- Git HEAD: `732017d` (Sprint 25 completion). Nothing staged.
- Working tree: the 26 Sprint 26 paths (22 modified, 4 untracked),
  matching the Phase 6A inventory plus the Phase 6A findings doc. All
  preserved, unstaged.
- Stale emulator: PID 98584, started
  `firebase emulators:start --import ./sprint25-b9-pre-retest` (no
  `--export-on-exit`). Firestore PID 98641 on 8080 seeding from
  `sprint25-b9-pre-retest`. Storage-rules runtime PID 98647.
- Ports held by the stale suite: 5001 functions, 8080 firestore, 9099
  auth, 9199 storage, 4000 UI, 4400 hub, 4500 logging, 9299 eventarc,
  9150 firestore websocket.
- Preserved snapshots on disk: `platform/firebase/sprint25-b9-pre-retest`
  (Aug 14) and `platform/firebase/sprint25-cert-state` (Aug 7).
- Local cert env files confirmed present by name only (contents not
  read): `platform/functions/.env.local`, `.env.lyfelabz-prod`,
  `.secret.local`.
- Confirmed stale build: compiled `lib/lms/connections-begin.js` predated
  the Sprint 26 source. This is the original "SPRINT 26 BUILD NOT
  DEPLOYED" condition.

## 2. Build (Gate C1) - PASS

- Command: `npm run build` in `platform/functions` (canonical
  `tsc -p tsconfig.build.json`). Exit 0. No source modified to make it
  build.
- `lib/` is gitignored, so the build produced zero tracked changes. Git
  status remained byte-identical to the Sprint 26 baseline; nothing
  staged; HEAD unchanged.

## 3. Proof the build contains Sprint 26 (Gate C5, deterministic)

Freshly compiled artifacts (all rebuilt this run, `lib` mtimes now newer
than every corresponding `src`):

- `lib/lms/connections-begin.js` contains `resolvePublicationAccountHint`,
  `accountHint`, `login_hint`, and `upstreamAccountIdentifier` (the Phase
  2 account-hint resolution path).
- `lib/lms/providers/google-classroom/adapter.js` contains `accountHint`
  and `login_hint` (the adapter conversion).
- `lib/lms/connections-complete.js` contains `connectionScopesWidened`,
  `connectionWideningRejected`, and `identityMismatch` (Phase 1 audit
  emission and the preserved reject).
- `lib/shared/types/audit-event.js` contains `lms.connectionScopesWidened`
  and `lms.connectionWideningRejected` (Phase 1 audit vocabulary).
- `provider.ts` `accountHint` is a type-only interface field
  (`readonly accountHint?: string`), correctly erased from `provider.js`.

The build proof is deterministic and required no emulator restart and no
live Google.

## 4. Fixture assessment (Gate C3 / C6) - BLOCKER

Authoritative read-only inspection. Each on-disk snapshot was imported
into a throwaway firestore-only emulator (alternate ports 8099/4499, no
export-on-exit, permissive throwaway rules) and read via the Firestore
REST API. No token, refresh token, or upstream Google identifier was
printed.

On-disk `sprint25-b9-pre-retest`:
- 1 `lmsConnections` doc: `googleclassroom__cert-teacher-001`.
- `status=active`, `scopesUpdatedAt=None`, `tokenRef` present.
- scopes (5): `classroom.courses.readonly`, `classroom.rosters.readonly`,
  `openid`, `userinfo.email`, `userinfo.profile`. No coursework scope.

On-disk `sprint25-cert-state`:
- 1 `lmsConnections` doc: `googleclassroom__cert-teacher-001`, identical
  readonly-only scope set, `scopesUpdatedAt=None`, `tokenRef` present.
- Also present: `classes` (2), `lmsClassLinks` (1), `assignments` (12).

Both preserved snapshots predate the B9 widening
(`scopesUpdatedAt 2026-08-16T17:07:48.502Z`, per B8 findings). Neither is
a Path B fixture.

Where the widened state actually lives:
- The still-running stale emulator's in-memory Firestore holds four
  4-scope widened connections (`cert-teacher-001` through `-004`, all
  carrying a coursework scope). This is volatile B8-through-B13 mutation
  that was never persisted to disk (the startup command carried no
  `--export-on-exit`; `cert-teacher-003` even carries a
  `2026-08-17` `scopesUpdatedAt`, impossible in an Aug-14 export). It also
  includes the `cert-teacher-002/003/004` artifacts from the B13
  fixture-manufacturing that was explicitly ordered stopped.
- The genuine widened grant otherwise exists only in real
  production/Google for the account behind `cert-teacher-001`.

Consequence: even if a widened connection document were present, the
snapshot token bundle is itself pre-widening, so a locally resolved token
would mint only readonly access and a coursework POST would fail
`insufficient_scope`. The preserved fixtures cannot perform Path B
publication.

## 5. Why this is a stop, not something to work around

Getting to Path B from here would require one of the following, each
forbidden by the Phase 6B authorization and/or the Sprint 26 definition:

- Forcing incremental OAuth / Path A to re-widen (explicitly forbidden;
  defined stop condition).
- Editing a snapshot to add the coursework scope (manufacturing a
  fixture; forbidden).
- Exporting the stale emulator's in-memory widened state into a new
  snapshot (outside the intentionally narrow authorization, and it would
  carry the stopped B13 `cert-teacher-002/003/004` artifacts).
- Revoking or reconnecting the preserved live Google grant (forbidden).
- Creating a new certification identity / `cert-teacher-005` (forbidden).

Per Gate C3 ("If no preserved snapshot contains a valid Path B fixture:
STOP and report that limitation. Do not manufacture one.") and section 11
("If the fixture unexpectedly requires incremental authorization
naturally, STOP before proceeding and report the state. Do not switch to
Path A automatically."), the correct action is to stop and report.

## 6. Actions deliberately NOT taken

- Did not stop the stale emulator. Stopping it would discard the only
  local (in-memory) widened fixture and remove a recovery option, with no
  offsetting benefit while blocked. The stale emulator remains untouched
  (PIDs 98584/98641 alive, in-memory fixture intact).
- Did not restart against a snapshot for live certification.
- Did not touch live Google, did not open OAuth, did not publish.
- Did not deploy, stage, commit, or push.
- Did not reopen B13, revoke grants, or create a new identity.

## 7. Identifier correction carried forward

Google Classroom course id is `871447706346`. Historical Sprint 25
coursework id is `874752057518`. The Phase 6A findings described
`874752057518` as a course id in one place (section 8 / references); that
is a labeling imprecision to correct when Sprint 26 documentation is
finalized. Historical Sprint 25 evidence is not rewritten.

## 8. What would unblock Phase 6B (for review, not executed)

A separate, explicitly authorized decision is required. Candidate
approaches, in rough order of least to most involved:

1. Deliberately preserve the stale emulator's in-memory widened
   `cert-teacher-001` into a clean Path B snapshot (pruned of the B13
   `-002/-003/-004` artifacts), then certify against it. Requires
   authorization to create a snapshot and confirmation that its token
   bundle holds a usable widened grant.
2. A controlled, authorized live re-widening (Path A once), accepting that
   this is incremental OAuth, to reestablish a widened durable connection,
   then certify silent reuse (Path B). This contradicts the current "no
   incremental OAuth" constraint and needs explicit sign-off.
3. Accept the Phase 6A deterministic evidence as sufficient for the
   account-continuity boundary and formally close Sprint 26 as PASS WITH
   PROVIDER-BOUNDARY LIMITATION without a live Path B run, if the reviewer
   judges the live provider-reuse proof non-essential.

## 9. Git status at end of run

- HEAD `732017d`, unchanged.
- 26 Sprint 26 paths present and preserved (22 modified, 4 untracked),
  identical to the Sprint 26 baseline.
- This blocked-findings document is a new untracked file.
- Nothing staged, committed, pushed, or deployed.
