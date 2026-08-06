# Sprint 25 - Certification Runbook

Status: Prepared. Not yet executed. This runbook is the single ordered
procedure to certify the Sprint 25 Google Classroom assignment-publication
workflow in a live browser against the Emulator Suite and to verify it in
the backend. It is executed by a human operator. It does not modify code,
does not commit, and does not deploy.

Subordinate to:
- `SPRINT_24B_DEPLOYMENT_AND_BROWSER_CERTIFICATION_RUNBOOK.md` (the
  established environment, isolation, and OAuth-client standard - this
  runbook adds Sprint 25 specifics and defers to that document where the
  two overlap)
- `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` (production deploy, out of this
  sprint)
- `SPRINT_25_DEFINITION.md` §9, §10 (claim boundary, rollout gates)
- `SPRINT_25_ARCHITECTURAL_BLUEPRINT.md` §13, §14
- `SPRINT_25_BROWSER_CERTIFICATION_CHECKLIST.md` (B1 - B24)
- `SPRINT_25_BACKEND_VERIFICATION_CHECKLIST.md` (V1 - V25)

Style: no em dashes. Use " - " (spaced hyphen).

---

## 1. Environment prerequisites

### 1.1 Workstation
- macOS or Linux, Node.js 20.x, npm 10.x, Java 11+, Firebase CLI 13.x+,
  Google Chrome 120+. Same as the Sprint 24B runbook §1.1.

### 1.2 Repository state
- Sprint 25 Phases 1 - 3 committed. Verify: `git log --oneline -5` shows
  the Phase 1, Phase 2, and Phase 3 commits and `git status` is clean.
  (At preparation time, HEAD is `71d9866`, "Sprint 25 Phase 3: complete
  Classroom publication workflow", working tree clean.)
- Dependencies installed: `npm --prefix platform/functions install` and
  `npm --prefix app install`.

### 1.3 Firebase Emulator Suite
Configured at `platform/firebase/firebase.json`:

| Emulator | Port |
|---|---|
| Auth | 9099 |
| Firestore | 8080 |
| Functions | 5001 |
| Storage | 9199 |
| Emulator UI | 4000 |

`singleProjectMode` is enabled; the default project is `lyfelabz-prod`
(`.firebaserc`), so the emulator project id resolves to `lyfelabz-prod`.
Hosting is not in the emulator block; §4.4 documents the static-serve
procedure. Every LyfeLabz-side write lands in the emulator, never in
production Firestore, Auth, or Functions.

### 1.4 Google Cloud project and OAuth clients
Same posture as the Sprint 24B runbook §1.4, with the Sprint 25 scope
delta below.

- One Google Cloud project, `lyfelabz-prod`. No other project is used.
- Two OAuth clients exist: the production client (production redirect,
  secret in Secret Manager) and a localhost **certification** client
  (localhost redirect only). Browser certification uses the certification
  client, populated into the operator's local env at emulator start; its
  secret is never written to Secret Manager or committed.
- The emulator binding is provided by the git-ignored
  `platform/functions/.env.local` (client id and
  `GOOGLE_CLASSROOM_REDIRECT_URI=http://localhost:5000/app/lms-callback.html`)
  and `platform/functions/.secret.local` (client secret). Confirm these
  point at the certification client, not the production client.

**Sprint 25 scope delta (the decisive prerequisite).** Sprint 25 requests
two additional scopes at incremental consent:
`https://www.googleapis.com/auth/classroom.coursework.me` and
`https://www.googleapis.com/auth/classroom.topics.readonly`
(`GOOGLE_CLASSROOM_PUBLICATION_SCOPES` in `adapter.ts`). Before
certification:
- Confirm the certification OAuth client's consent screen will present
  and grant these two scopes to the test teacher. `classroom.coursework.me`
  is a sensitive scope; on an unverified app it triggers the
  unverified-app warning and the 100-user sensitive-scope cap, both
  acceptable for a single-operator certification. If Google will not
  grant the coursework scope to the test account in this configuration,
  stop - browser and real-Google certification cannot proceed (see stop
  conditions).
- The Data Access declaration is a hygiene surface, not a runtime gate;
  Google honors the requested scopes regardless. Aligning Data Access to
  include the two coursework scopes is a production-rollout task, not a
  certification blocker.

### 1.5 The test-double question (read before starting)
The blueprint §13 describes certification "against a Google Classroom API
test double." **There is no runtime seam that installs that test double.**
The fixture transport is Jest-only; at emulator runtime the LMS callables
bind the real Google HTTPS transport. Therefore:
- A genuine browser run exercises **real Google Classroom** for topics,
  coursework creation, and incremental consent. This is the Sprint 24B
  pattern and is honest.
- Do not present a fixture-produced result as a real Google observation,
  and do not present a real Google observation as a fixture result. The
  browser checklist marks each scenario's upstream nature; honor it.
- If the team requires a fixture-backed browser certification instead,
  building the runtime fixture seam is prerequisite new production code
  with its own review and tests. That is out of this runbook's scope and
  is a stop condition for a "test double browser certification" claim.

### 1.6 Test Google accounts and course
- One test teacher Google account the operator controls.
- A real Google Classroom course owned by the test teacher, with at least
  one topic (required for B8/B12).
- A second real course owned by the test teacher (single topic acceptable)
  for the multi-class scenarios B21/B22.
- No student accounts are needed. Sprint 25 is teacher-initiated publish
  only; no student authenticates and no roster is read on the publish
  path.

### 1.7 Seed data (Firestore emulator)
- `lmsProviders/googleClassroom`, one district, one school, the teacher
  `users/{teacherUid}`, and the teacher's Auth emulator record. No
  `lmsClassLinks`, no `lmsAssignmentPublications` seeded.
- The teacher must reach the certified Sprint 24B state through the app
  (connect Google Classroom readonly, import a course, activate the
  class, sync roster) so the LMS-linked active class exists with a real
  `lmsClassLinks` binding. B9 requires the connection to hold **readonly
  scopes only** at the start of the publish flow. Do not pre-grant the
  coursework scopes.

---

## 2. Claim boundary

This runbook certifies within the definition §9 boundary. It distinguishes
five levels and never conflates them.

| Level | What it is | This runbook |
|---|---|---|
| A. Unit and integration validation | Jest suites, fixture transport. | Prerequisite; green at prep time (functions 79/1487, app 913/914 with the known drift). Proves code paths, not the workflow. |
| B. Emulator-backed engineering validation | Emulator + real Google OAuth + emulator Firestore. | The environment this runbook runs in. |
| C. Genuine browser certification | One continuous real teacher-shell run, no injection. | Executed here IF the §1.4/§1.6 prerequisites hold. |
| D. Real Google Classroom publication verification | Real coursework created and filed in a real course. | Executed here as B8/B11/B12 IF real Google is reachable; there is no test double, so C and D collapse into the same run. |
| E. Production rollout readiness | Google OAuth verification for the coursework scopes, Data Access declaration, production Secret Manager posture, deploy runbook. | NOT in scope. A rollout gate, not a certification. |

Rules:
- Jest fixture results (level A) never support a level C or D claim.
- A NOT-CERTIFIABLE-HERE browser scenario is never upgraded to PASS on the
  strength of a fixture.
- The final report must state exactly which levels were achieved and must
  not claim Google OAuth verification, broad rollout authorization, grade
  or submission sync, or any second-provider behavior.

---

## 3. Pre-certification validation baseline

Run before touching the emulator. Any failure aborts.

```bash
# Functions
npm --prefix platform/functions run typecheck
npm --prefix platform/functions run lint
npm --prefix platform/functions run build
npm --prefix platform/functions test
```

Expected at prep time: typecheck/lint/build clean; 79 suites, 1487 tests
pass.

```bash
# App
npm --prefix app run typecheck
npm --prefix app run lint
npm --prefix app run build
npm --prefix app run lessons:verify
npm --prefix app run curriculum:verify   # known DRIFT, see below
npm --prefix app test
```

Expected at prep time: typecheck/lint/build clean; `lessons:verify` OK;
`curriculum:verify` reports DRIFT (exit 1); the app suite reports 53
suites, 914 tests, 1 failure (`curriculumManifest.test.ts`).

**Known curriculum drift (not a Sprint 25 defect).** Root `index.html`
and `app/src/curriculum/curriculum.manifest.json` disagree. Both files are
unmodified versus HEAD, so the drift is on the committed baseline and is
independent of Sprint 25, which changed neither file. It surfaces as one
failing jest test and one `curriculum:verify` exit-1. It is documented in
the Phase 1, Phase 2, and Phase 3 completion reports. It does not gate
Sprint 25 certification. Do not "fix" it during certification; if it is to
be resolved, that is a separate, out-of-sprint change (`npm --prefix app
run curriculum:build`, reviewed on its own).

If any other step fails, stop.

---

## 4. Local startup procedure

Follow the Sprint 24B runbook §4 exactly, with the Sprint 25 delta in
§4.3. Each process runs in its own terminal tab and stays up for the whole
run.

### 4.1 Terminal A - Emulator Suite
```bash
cd platform/firebase
firebase emulators:start
```
Wait for every emulator to report "started". On cold start the Functions
log emits the durable-store installer lines.

### 4.2 Terminal B - Firestore seed
Seed §1.7 through the Emulator UI at `http://localhost:4000` or a one-shot
Node script bound to `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and
`FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`. Do not commit the script.

### 4.3 Terminal C - OAuth parameters (Sprint 25 delta)
The emulator reads `platform/functions/.env.local` and `.secret.local`
automatically. Confirm they carry the **certification** client id, the
localhost redirect (`http://localhost:5000/app/lms-callback.html`), and
the certification client secret. Do not export the production client
secret and do not read it from Secret Manager.

The coursework scopes are selected in code at consent time
(`capability: "publication"` -> `GOOGLE_CLASSROOM_PUBLICATION_SCOPES`); no
env change is needed to request them. The only environment requirement is
that the certification OAuth client's consent screen will grant them
(§1.4).

If the env files are edited, restart the emulator so the Functions runtime
picks up the values.

### 4.4 Terminal D - Static site
Serve the repository root at `http://localhost:5000` only (the client's
`isEmulatorHost` predicate accepts exactly `localhost`, `127.0.0.1`,
`0.0.0.0`; the redirect URI derives from the served origin). Example:
```bash
cd /Users/breezy/Documents/GitHub/lyfelabz
python3 -m http.server 5000 --bind 127.0.0.1
```
Navigate to `http://localhost:5000/app/index.html`. Do not substitute a
LAN IP, `.local`, `[::1]`, or any alias; doing so points the client at
production Firebase and invalidates certification.

### 4.5 Terminal E (optional) - live LMS logs
```bash
tail -f platform/firebase/firebase-debug.log \
  | grep -E "lms\.|assignmentsPublish|connectionsBegin|connectionsComplete|secretmanager"
```

---

## 5. Ordered scenario execution

Execute in this order. The order is chosen so the single usable readonly
connection is not consumed before the scenarios that depend on it, and so
destructive states (revoked/disconnected connection) come last.

1. **Baseline and controls (non-destructive):** B1, B2, B3, B4, B5. These
   render and inspect surfaces; they mutate nothing upstream.
2. **Happy path, publication off:** B6. Confirms assigning still works and
   fires no publish.
3. **Incremental consent (decisive, needs the readonly-only connection):**
   B9, then B10 as its ledger view. This is the one flow that must run
   while the connection still lacks the coursework scopes. Run it before
   any scenario that would widen the connection.
4. **Happy path, publication on (needs the widened connection):** B7 (no
   topic), B8 (topic). These require the coursework scopes granted in step
   3.
5. **In-Classroom confirmation:** B11, B12 against the real course.
6. **Bounded consent-failure scenarios (need a readonly-only connection):**
   B13 (cancel/deny) and, where Google permits a partial grant, B14 and
   B15. These require a connection that again lacks the coursework scopes;
   prepare a fresh readonly-only connection (disconnect and reconnect
   readonly, or use a second test teacher) rather than un-widening the
   primary one.
7. **Provider failure and retry:** B16 (injected upstream failure), then
   B18, B19, B20 (detail-view retry) on that assignment.
8. **Reconnect path (destructive to the connection):** B17. Run after the
   happy-path and consent scenarios, because it deliberately puts the
   connection into a non-active state.
9. **Multi-class:** B21 (mixed outcome) and B22 (shared consent) using the
   second course. B22 needs a readonly-only connection.
10. **Standing observations:** B23 (calm summary) and B24 (privacy DOM
    sweep), verified against the surfaces produced above.
11. **Backend verification:** run the full V1 - V25 checklist against the
    emulator state produced by steps 1 - 10.

Per-scenario connection-state requirements:

| Needs | Scenarios |
|---|---|
| Fresh readonly-only connection | B9/B10, B13, B14, B15, B22 |
| Active widened connection | B7, B8, B11, B12, B18, B19 |
| Deliberately non-active connection | B17 |
| A course topic | B4, B8, B12 |
| A second class/course | B21, B22 |
| Cleanup/restoration afterward | B16, B17, B20 (see §7) |

---

## 6. Evidence requirements

Capture into a certification log (scratch file under `scratchpad/`, not
committed) plus a screenshot folder. For each scenario record: timestamp,
operator, scenario id, PASS/FAIL/NOT-CERTIFIABLE-HERE, and evidence
filenames.

Capture:
- Browser screenshots of every confirmation line, detail panel, topic
  selector, consent screen, and error surface.
- Exact timestamps for each callable, read from the Functions log.
- Teacher-visible confirmation lines verbatim.
- Google Classroom coursework evidence (the created item, its LyfeLabz
  link, its topic) for B8/B11/B12.
- Firestore document snapshots or field summaries for the assignment, the
  publication record(s), the mirror pointer, and the connection before and
  after consent.
- Callable ledger excerpts (ordered invocation list).
- Audit entries (`lms.assignmentPublished`, `lms.publishFailed`).
- Sanitized Functions logs, including any `error`-severity
  orphan/mirror-desync/audit-gap lines.
- The connection document before and after consent (for V7 - V11).
- The publication record before and after a retry (for V18).
- Explicit negative-evidence checks: the absence of a record/event for the
  pre-consent insufficient-scope attempt (V5, V6); the absence of Secret
  Manager access on the publish path (V21); the absence of token material
  and student PII (V22 - V24).

Do NOT capture or paste anywhere (chat, log, screenshot, commit):
- Access tokens, refresh tokens, OAuth authorization codes, client
  secrets.
- Private Google identifiers (account ids, `sub`).
- Student PII.
- Teacher email unless redacted in the captured image.
Redact the account email in any consent-screen screenshot before saving.

---

## 7. Failure-injection rules

Injection must produce a genuine condition, never a fabricated result.

| Condition | Method | Honesty rule |
|---|---|---|
| Insufficient scope (first publish) | Natural: start from a readonly-only connection (B9). | Real. No injection needed. |
| Consent cancellation | Natural: cancel/close the real Google consent window (B13). | Real. |
| Consent completes without the scope | Deselect the coursework permission in the real consent screen, if Google offers a partial grant (B14). | Real only if Google actually allows the partial grant. If it does not, mark B14/B15 NOT-CERTIFIABLE-HERE; do not simulate with a fixture. |
| Provider temporary failure | Real upstream condition: publish to a course/topic deleted upstream between fetch and confirm, or revoke the coursework grant in Google account security just before confirm (B16). | Real. If no honest condition can be produced, defer to the Phase 1 callable failure tests and say so. |
| Provider timeout / uncertain response | Not honestly reproducible against real Google on demand. | Do not fake a timeout. Rely on the Phase 1 AbortController timeout test (`assignments-publish.test.ts`, adapter timeout case) as the standing evidence and name it as the uncertain residual (implementation plan §2.3, §2.6). |
| Stale / deleted topic | Delete the selected topic in the real course between fetch and confirm. | Real. Falls to the retryable failed outcome. |
| Inactive / disconnected connection | Disconnect at the account level or let the connection expire (B17). | Real LyfeLabz-side state; the publish is refused server-side. |
| Failed manual retry | Keep the B16 upstream condition in place and retry from the detail view (B20). | Real. |
| Repeated insufficient scope after completed consent | Continuation of B14. | Real only if B14 was certifiable; otherwise deferred with B14. |

Never manufacture a result through direct Firestore writes, direct
callable invocation, auth injection, or a test-only shortcut. Any
condition that cannot be produced honestly in this environment is recorded
as NOT-CERTIFIABLE-HERE with its reason and its compensating unit/
integration evidence.

---

## 8. Cleanup and restoration

- Coursework items created in the real test course during B8/B11/B12/B16/
  B18/B21 are operator-owned test content. Delete them from Google
  Classroom after the run, or leave them in a clearly-labeled test course.
  Record the upstream ids in the certification log (they are LMS resource
  ids, not PII) so any orphan from B16's injected failure can be found.
- Restore the test teacher's connection to a clean state after B17
  (reconnect readonly, or leave disconnected if the run is complete).
- The emulator Firestore is disposable; stop the emulator to discard it,
  or clear the run's collections if reusing the environment.
- Revoke any coursework grant added to the test account if the account is
  reused for later readonly-only scenarios.
- Do not modify production Firestore, production OAuth clients, or Secret
  Manager at any point.

---

## 9. Stop conditions

Stop and report before or during certification if any of the following
hold:

- Phase 1, Phase 2, or Phase 3 is not committed, or the working tree
  carries unexplained implementation drift (anything beyond this runbook,
  the two checklists, and the known curriculum-manifest baseline drift).
- The certification OAuth client cannot request or the test account cannot
  grant the two coursework scopes.
- The test teacher does not own the target course, or the course has no
  topic (blocks B8/B12).
- The redirect URI on the certification OAuth client does not exactly
  match `http://localhost:5000/app/lms-callback.html`.
- Genuine incremental consent cannot complete against real Google.
- The browser environment would send Auth/Firestore traffic to production
  (any non-loopback serving host).
- Real Google behavior would be confused with a fixture result - for
  example, an attempt to satisfy a decisive scenario (B9/B11/B12) with the
  Jest fixture instead of real Google.
- Evidence for a required check cannot be gathered without exposing a
  secret, token, private Google identifier, or student PII.

On any stop condition, halt, record the exact blocker, and do not proceed
to the next scenario or to any completion claim.

---

## 10. Final report template

On completion (or on a stop), author `SPRINT_25_FINAL_CERTIFICATION_REPORT.md`
using this template. Do not author it before execution.

```
# Sprint 25 - Final Certification Report

## 1. Environment of record
- Commit (HEAD), branch, emulator project, OAuth client used (name only),
  redirect URI, real-Google vs fixture posture per scenario.

## 2. Claim boundary achieved
- Levels A - E: achieved / not achieved, with one line each.

## 3. Browser certification results (B1 - B24)
- Per scenario: PASS / FAIL / NOT-CERTIFIABLE-HERE, evidence filenames,
  and (for NOT-CERTIFIABLE-HERE) the compensating unit/integration
  evidence.
- Decisive observations B9, B11, B12 called out explicitly.

## 4. Backend verification results (V1 - V25)
- Per check: PASS / FAIL / cited-evidence, data source, and forbidden-state
  confirmation.

## 5. Security and privacy verification
- Zero Secret Manager access on the publish path (V21).
- No token material anywhere (V22).
- No student PII (V23).

## 6. Failure-injection ledger
- Each injected condition, the honest method used, and the observed
  outcome. Uncertain-response residual named.

## 7. Evidence index
- Screenshot folder, callable ledger excerpts, Firestore snapshots, audit
  entries.

## 8. Known limitations and residuals
- The uncertain-upstream retry duplicate residual (plan §2.3).
- Session-scoped detail retry (Phase 3 report §17).
- The known curriculum-manifest baseline drift.
- Any NOT-CERTIFIABLE-HERE scenarios.

## 9. Production-rollout prerequisites still open (level E)
- Google OAuth verification for the coursework scopes, Data Access
  declaration, production Secret Manager posture, deploy runbook.

## 10. Verdict
- CERTIFIED (levels achieved), or NOT CERTIFIED with exact blockers.
- Explicit statements: no production code changed; nothing staged or
  committed by the certification itself beyond the report and (on
  ratification) the PDR-030 record already present.
```

---

*End of certification runbook. Every procedure here reads or observes
existing artifacts and real Google test content; nothing here mutates
production state or fabricates a result.*
