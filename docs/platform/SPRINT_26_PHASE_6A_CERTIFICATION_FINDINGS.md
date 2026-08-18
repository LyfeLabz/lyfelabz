# Sprint 26 Phase 6A - Integrated Local Certification Findings

Status: DRAFT certification record. Phase 6A only. Sprint 26 is NOT
production-certified by this document; Phase 6B (narrowly scoped live
Google certification) has not been run. No deploy, no commit, no push,
no production state change occurred.

Style: no em dashes. " - " is the sentence break.

## Verdict

**READY FOR PHASE 6B.**

The complete combined Sprint 26 implementation (Phases 1 through 5) was
certified locally and deterministically. The whole-sprint diff is fully
accounted for, no scope creep exists, the security/privacy review is
clean, Functions verification is fully green, the app suite carries no
new Sprint 26 failure, the single app failure is the conclusively
pre-existing curriculum-manifest drift, and the teacher-facing surfaces
are proven at the DOM-render level by deterministic integration tests.

## 1. Baselines confirmed (this run)

- Functions: 87 suites, 1586 tests, ALL PASS. Typecheck clean. Lint clean.
- App: 58 suites, 975 tests, 974 PASS, 1 FAIL. Typecheck clean. Lint clean.
- The single app failure is `curriculumManifest.test.ts` (pre-existing
  drift, section 5). Matches the stated post-Phase-5 baseline exactly.

## 2. Diff inventory and phase ownership

25 paths, all accounted for. Nothing staged, committed, pushed, or deployed.

Phase 1 (observability + contract):
- `platform/functions/src/shared/types/audit-event.ts` (two new PII-safe actions)
- `platform/functions/src/shared/audit/write-audit-event.test.ts` (accepts both actions)
- `platform/functions/src/lms/providers/provider.ts` (optional `accountHint` on `beginOAuth`)
- `platform/functions/src/lms/providers/google-classroom/adapter.ts` (`login_hint` from hint)
- `platform/functions/src/lms/providers/google-classroom/adapter.test.ts`

Phase 2 (account continuity):
- `platform/functions/src/lms/connections-begin.ts` (`resolvePublicationAccountHint`)
- `platform/functions/src/lms/connections-begin-account-hint.test.ts` (new, 6 cases)
- `platform/functions/src/lms/connections-complete.ts` (widening audit emission; §4.2 invariant preserved)
- `platform/functions/src/lms/connections-complete-oauth-state.test.ts`

Phase 3 (assignment state correctness):
- `app/src/shell/surfaces/curriculum.ts` (`LyfelabzAssignmentState`, `qualifiesForAssignedBadge`, truthful `summarizeOutcomes`)
- `app/src/shell/surfaces/curriculum.false-success.test.ts`
- `app/src/shell/surfaces/curriculum.lms-publish.test.ts`

Phase 4 (connection + recovery UX):
- `app/src/shell/surfaces/shared/lmsPublication.ts` (identity-mismatch classification; session-local reconnect store)
- `app/src/shell/surfaces/shared/lmsPublication.test.ts`
- `app/src/assignments/detail/detail.ts` + `types.ts` (identityMismatch state + line)
- `app/src/assignments/detail/detail.lms-retry.test.ts`
- `app/src/settings/integrations/integrations.ts` + `types.ts` + `wire.ts` (action-needed state, Reconnect action)
- `app/src/settings/integrations/integrations.test.ts`
- `app/src/index.ts` (binds session-local `connectionRecovery` seam)

Phase 5 (Settings spacing):
- `app/index.html` (`.shell-settings-category-button { margin-top: 0 }`; also holds Phase 4 pill/recovery CSS)
- `app/src/shell/surfaces/settings.category-spacing-css.test.ts` (new)

Definition/documentation:
- `docs/platform/SPRINT_26_DEFINITION.md` (new)

Scope-hygiene confirmations:
- No unexpected file. No later phase overwrote an earlier invariant.
- No debugging code, no `.only`/`.skip`/`fdescribe`/`fit`, no `console.*`,
  no `TODO`/`FIXME` in added or untracked lines.
- No temporary browser harness, no test-only production branch, no
  certification fixture persisted into production code.
- No em dash in any Sprint 26-authored line.
- No unrelated refactor; no deployment/config artifact modified.
- No Sprint 24/25 historical evidence rewritten.

## 3. Security / privacy findings (clean)

Account-hint handling (`connections-begin.ts`, adapter):
- `upstreamAccountIdentifier` is read only where it already lived
  (the token bundle), transiently in memory, through the established
  `getLmsTokenStore().resolve` abstraction (a pure single-document read;
  no refresh, rotation, or mutation on this path).
- It is NOT copied onto the connection document, NOT placed in the OAuth
  state record (state `issue()` receives only `{teacherId, providerId,
  redirectUri, intent}`), NOT logged (begin performs no logging), and NOT
  audited.
- It reaches Google only as `login_hint` inside the authorization URL -
  the definition-mandated account-continuity mechanism (§5, §7.A). This
  is an intended transmission to Google, not a teacher-facing UI, log, or
  audit exposure. No teacher-facing surface renders it.
- Best-effort and steering-only: every absence/failure (no active
  connection, resolution failure, corrupted bundle) degrades to NO hint
  and never blocks authorization or fabricates an identity. A broken
  connection is not masked as healthy at begin; completion owns the
  authoritative broken-connection and identity semantics.

Audit payloads:
- `lms.connectionScopesWidened` payload = `{ providerId }` only, emitted
  AFTER the connection update commits and after the alreadyAuthorized
  early return (verified by reading the handler).
- `lms.connectionWideningRejected` payload = `{ providerId, reason:
  "identityMismatch" }`, emitted BEFORE the throw and BEFORE any mutation.
- Neither carries scopes, either Google identity, tokens, or PII. Both are
  written through `safeAudit`, which swallows its own failures so audit is
  never load-bearing for the security or lifecycle outcome.

Identity security (preserved):
- `login_hint` is never trusted as identity proof. Completion still
  independently validates the returned identity; a mismatch still throws
  `lms.identityMismatch` before any connection or credential mutation, does
  not widen, and leaves the existing connection intact and recoverable.
  Audit failure cannot suppress the reject.

OAuth invariants (unchanged): PKCE, redirect binding, teacher binding,
single-use state, publication-intent binding, scope sets,
`include_granted_scopes`, no-revoke widening, and token-refresh
architecture are untouched. Proven by the full green Functions suite
including the PKCE and oauth-state single-use suites.

## 4. Assignment-state findings

- Per-class `PerClassOutcome.lyfelabzState` is a three-value discriminant
  (`draftFailed` / `savedNotPublished` / `published`) replacing the
  ambiguous boolean. A saved draft is never described as "not created";
  a genuinely unsaved class is never described as recoverable.
- `summarizeOutcomes` counts the three states independently, so one
  class's failure never downgrades another class's success. Multi-class
  partial-success behavior is preserved and truthful.
- A Google Classroom publication failure after a successful LyfeLabz
  publish never claims the LyfeLabz assignment was lost (LMS line is
  additive and only appended for `published` rows).
- Assigned badge qualifies on `published` and `closed`; `draft` does not.
  Hydration gates `markPersisted` on `qualifiesForAssignedBadge(status)`.
  Verified across draft / published / closed and mixed co-registration
  cases, both in-session and after hydration/reload.
- Stranded drafts still hydrate and remain available to the View drafts
  control and the assignment detail surface; only the badge signal changed.

## 5. Manifest drift disposition - conclusively pre-existing, unrelated

- Failing assertion: `curriculumManifest.test.ts` - "checked-in manifest
  matches a freshly parsed canonical index.html".
- Exact difference: ONLY `canonicalSourceSha256`
  (fresh `20a1ad33...` vs checked `eca04df9...`). Every structural field
  (50 units, resource counts, topics, grades) is byte-identical.
- Sprint 26 participation: none. The test parses root `index.html`;
  Sprint 26 modified `app/index.html`, a different file. Root
  `index.html`, `curriculum.manifest.json`, and the test file are all
  byte-identical to committed HEAD (not in the Sprint 26 diff). No Sprint
  26 changed file references the manifest or its hash (the one grep hit in
  `curriculum.ts` is a pre-existing code comment).
- Predates Sprint 26: root `index.html` last changed 2026-07-30 ("Fix How
  It's Built anchor offset"), after the manifest was last regenerated
  2026-07-28 (Sprint 21). The SHA drift was introduced 2026-07-30, before
  Sprint 25 (HEAD, 2026-08-17) and before Sprint 26.
- Certification impact: none. No Sprint 26 workflow consumes
  `canonicalSourceSha256` or the manifest; the structural manifest is
  identical, so even the curriculum catalog is unaffected.
- Disposition: known non-Sprint-26 baseline failure. NOT fixed in Phase
  6A (section 12 prohibits automatic regeneration).

## 6. Local integration and browser UX evidence

The teacher-facing Sprint 26 surfaces are proven at the DOM-render level
by deterministic jsdom integration tests that render the real production
modules (`renderIntegrationsSurface`, `renderCurriculumSurface`, the
detail LMS line) with injected deterministic seams and assert on rendered
DOM text/classes:

- saved-but-not-published messaging (never "not created"); draft-create
  failure messaging; mixed multi-class summary - `curriculum.false-success`,
  `curriculum.lms-publish`.
- draft-only stays unassigned + exposes View drafts; published and closed
  light the badge; order-independent co-registration - `curriculum.false-success`.
- identity mismatch renders the same-account line distinct from the
  permission line, connection intact, no code/token/scope/identity leak -
  `curriculum.lms-publish`, `detail.lms-retry`.
- Settings: "Connected, action needed" pill + attention class, Reconnect
  action present only when armed, recovery paragraph, backward-compatible
  when unwired, not-connected never shows action-needed, Reconnect reuses
  connect flow / never disconnects first / clears the signal on success -
  `integrations.test.ts`.
- Settings spacing: served base `button` still carries `margin-top: 1rem`
  and `.shell-settings-category-button` resets it to 0 -
  `settings.category-spacing-css.test.ts`.

Emulator limitation (documented, not a defect). Per the established
Sprint 25 Certification Runbook §1.5, there is no runtime LMS test-double
seam: a Firebase-emulator browser run of the LMS callables exercises real
Google Classroom. A deterministic authenticated-browser reproduction of
the LMS OAuth / publication paths would therefore either hit live Google
(forbidden in Phase 6A) or require building a new runtime fixture seam
(prerequisite new production code, out of scope, a stop condition). The
LMS-specific request-construction and state seams are fully proven by the
deterministic Functions handler tests and the jsdom surface tests above;
the real Google integration boundary is the subject of Phase 6B.

## 7. Preservation matrix (no regression)

Confirmed green by the full Functions (1586) and app (974) suites plus
targeted re-runs: initial Classroom connection, class import, needsSetup
activation, roster synchronization, token custody, token refresh,
publication, topic selection, retry, duplicate protections, OAuth-state
single-use protections, PKCE, callback identity validation,
`lms.identityMismatch`, Sprint 25 B13 PASS WITH LIMITATION closure (not
reopened), and the no-student-PII posture.

## 8. Proposed Phase 6B plan (NOT executed)

Minimal live-Google steps, provider boundary only:
1. Begin an incremental publication authorization for a teacher with an
   existing durable connection; confirm the authorization request carries
   the connected identity via `login_hint` (network/URL inspection).
2. Complete authorization with the correct connected account; confirm it
   succeeds and the connection widens.
3. Publish the assignment; confirm publication succeeds.
4. Trigger a subsequent publication; confirm it reuses the widened durable
   connection with no unnecessary reauthorization.

Explicitly NOT tested in 6B: Google never showing a chooser, deliberate
identity mismatch, consent cancellation, B13 reproduction,
cert-teacher-005, grant revocation, pristine readonly-only fixture
reconstruction, any destructive certification-state manipulation.

Safest existing account: per Sprint 25 evidence
(`SPRINT_25_B8_CERTIFICATION_FINDINGS.md`), the certified teacher whose
real Google Classroom coursework publication passed is the established
healthy widened connection and the lowest-risk choice. Identifier
correction (see Phase 6B, and reconciled in the completion report): the
Google Classroom course id is `871447706346`; `874752057518` is the
historical Sprint 25 coursework id created inside that course, not a
course id. Do NOT modify that account or its grants during Phase 6A.
Confirm the exact certification account and course against the Sprint 25
runbook at 6B start.

## 9. Remaining risks / limitations

- Google may still present an account chooser under some session/account
  conditions. This is provider-controlled and explicitly not a Sprint 26
  failure (§11.C, §15); the identity invariant and recovery UX cover the
  wrong-account case. Not a LyfeLabz defect.
- Action-needed is session-local by design (no durable connection-health
  field exists; introducing one is out of scope). It is honestly forgotten
  on reload and re-armed by the next failing attempt. Not a defect.

## 10. Documentation changes

This findings document only (new, untracked). `SPRINT_26_DEFINITION.md`
already records the canonical Phase 1 through 4 resolutions; no edit was
required. Sprint 26 is not marked complete or production-certified.
