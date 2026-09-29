# Persistent Differentiation - Slices 1-6 Staging Certification Runbook

Working handoff for the Slices 1-6 Staging Integration Certification Gate
(F5.2 G14). This document is operational scaffolding for the certification, not
a curriculum or architecture change. It records the staging environment
identity, the wired staging deploy port, and the exact human prerequisites that
remain before the live end-to-end proof can run.

Authoritative contract: `DIFFERENTIATION_F5_2_IMPLEMENTATION_SPECIFICATION.md`.
This runbook never overrides F5.2.

---

## 1. Environment identity (verified)

| Role | Firebase project | Project number | Notes |
|---|---|---|---|
| Production | `lyfelabz-prod` | 182791689935 | `.firebaserc` `default`. NEVER touched by this gate. |
| Staging | `lyfelabz-staging` | 293337283840 | `.firebaserc` alias `staging`. The one authorized non-production target. |

Staging Hosting site (default): `https://lyfelabz-staging.web.app`.

Safety rule for every staging operation: an alias name is not a trust boundary.
Every deploy or Firestore mutation must positively resolve to the literal
project id `lyfelabz-staging` and fail closed otherwise. Production is never a
fallback.

---

## 2. Staging deploy port (wired - Slice 3 carry-forward blocker)

The Slice 3 publication CLI (`platform/functions/src/scripts/publish-variant.ts`)
previously left the Hosting deploy as a guarded no-op for all targets. It now has
a real, fail-closed `staging` target:

- New `--target=staging` requires an explicit `--project=lyfelabz-staging`; any
  other project (including a defaulted or stale one) is refused before anything
  runs (`ensureStagingTargetSafe`).
- `configureStagingEnv` forces `GCLOUD_PROJECT` and `GOOGLE_CLOUD_PROJECT` to the
  verified staging id so the Admin SDK index write can never bind to production.
  The legacy emulator-path default to `lyfelabz-prod` does not apply to staging.
- The real deploy runs `firebase deploy --only hosting --project lyfelabz-staging`
  via `execFileSync` with an argument array (no shell, no injection).
  `makeStagingDeployHosting` refuses to invoke the runner unless the project id
  is exactly `lyfelabz-staging`.
- Staging refuses to run while `FIRESTORE_EMULATOR_HOST` is set, requires
  `GOOGLE_APPLICATION_CREDENTIALS`, and requires `--hosting-origin` to be an
  `https` URL whose host resolves to the `lyfelabz-staging` site.
- The certified publication ordering is unchanged and still owned by the state
  machine: LOCAL_VERIFIED -> HOSTING_DEPLOYED -> HOSTED_BYTES_VERIFIED ->
  INDEX_UPDATED. A failed deploy returns `{ ok: false }` and stops publication
  before the Firestore index is ever touched.

Production and emulator behavior are unchanged.

### Liveness origin

For the staging target the liveness fetch (F5.2 6.8 step 8) uses the validated
`--hosting-origin` value, which must be:

```
--hosting-origin=https://lyfelabz-staging.web.app
```

`LYFELABZ_HOSTING_ORIGIN` (the environment variable) continues to serve only the
emulator and production wiring paths and is not used by the staging target.

### Intended staging publish invocation (after prerequisites in section 3)

```
npm --prefix platform/functions run build
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/lyfelabz-staging-sa.json \
node platform/functions/lib/scripts/publish-variant.js \
  --target=staging \
  --project=lyfelabz-staging \
  --hosting-origin=https://lyfelabz-staging.web.app \
  --lesson=<slug> \
  --variant=reading-adapted \
  --revision=<presentationRevisionId> \
  --published-by=<operator>
```

---

## 3. Certification progress

### Done (certified against real staging)

- Firestore `(default)` Native database created; Blaze billing linked; ADC
  credentials present locally.
- Firestore Rules and indexes deployed to staging
  (`firebase deploy --only firestore:rules,firestore:indexes --project lyfelabz-staging`).
- Publication half of G14 (F5.2 Phases 2, 9, 17) proven end-to-end against
  staging using the wired `--target=staging` publish CLI, controlled fixture
  `staging-cert-fixture__reading-adapted`:
  - Revision A `prd35502243cd3caf026f4436183d92fac31e669483bf01d40954b8e24f2cd8657`
    then revision B `pr784872aad5bd6a7b0c0a47b3bdfbc09fc2750ad0fc9e8bb050f76a00fa9aed46`,
    each through LOCAL_VERIFIED -> HOSTING_DEPLOYED -> HOSTED_BYTES_VERIFIED ->
    INDEX_UPDATED.
  - After B, the index points to B while A remains live and byte-identical
    (HTTP 200, unchanged sha256): historical retention holds across a normal
    full-tree Hosting deploy.
- Compute APIs auto-enabled during the (incomplete) Functions deploy attempt:
  Cloud Functions, Cloud Build, Artifact Registry, Firebase Extensions.

### Staging Classroom OAuth (DONE)

- Staging OAuth client `LyfeLabz Staging Classroom` (Web application) created in
  `lyfelabz-staging`; redirect URI
  `https://lyfelabz-staging.web.app/app/lms-callback.html`; consent screen
  External/Testing; test user `brownc@weston.org`.
- `GOOGLE_CLASSROOM_CLIENT_SECRET` stored in staging Secret Manager (version 1,
  ENABLED); value never accessed by tooling.
- Non-secret params in git-ignored `platform/functions/.env.lyfelabz-staging`
  (`GOOGLE_CLASSROOM_CLIENT_ID`, `GOOGLE_CLASSROOM_REDIRECT_URI`).

### Cloud Functions (DEPLOYED to staging)

- `firebase deploy --only functions --project lyfelabz-staging` deployed all
  v2 callables, including `assignmentsListForStudent`, `lmsDeepLinkResolve`,
  `assessmentSessionsBegin`, `assessmentSessionsAutosave`, `submissionsFinalize`,
  `assessmentAttemptGet`.
- `authOnUserCreate` (Gen1 Auth trigger) did NOT deploy: Firebase Auth is not
  yet enabled. Redeploy it after Auth is enabled.
- Non-blocking: no Artifact Registry cleanup policy set in us-central1 (minor
  image-storage cost until set via `firebase functions:artifacts:setpolicy`).

### Firebase Authentication (DONE)

- Authentication enabled on `lyfelabz-staging`; Google provider ON; Email/Password
  intentionally OFF; authorized domains `localhost`,
  `lyfelabz-staging.firebaseapp.com`, `lyfelabz-staging.web.app`.
- `authOnUserCreate` was stuck UNKNOWN from the first (Auth-off) deploy; deleted
  and redeployed fresh once Auth was enabled.

### Synthetic seed (DONE)

- Harness `platform/functions/src/scripts/staging-cert-seed.ts` (+ tests) - fail
  closed to `lyfelabz-staging`, synthetic-only, idempotent, `--reset` cleanup.
- Seeded on staging: school `staging-cert-school` (district
  `staging-cert-district`); users `staging-cert-teacher` (teacher),
  `staging-cert-student-diff` (student), `staging-cert-student-canon` (student,
  canonical control) - synthetic `@staging-cert.invalid` emails; class
  `staging-cert-class` (active); enrollments for both students; assignment
  `staging-cert-assignment` (published, classroom, lessonSlug
  `staging-cert-fixture`, `assessmentRevisionId assessment_staging-cert-fixture__r1`);
  recipients for both students. studentAccommodations is NOT seeded (activated via
  the real Op B callable during certification).
- Staging Web app created (`Staging Cert Web`) for the non-secret browser API key
  used to mint synthetic ID tokens.
- Deny-all rules verified live: unauthenticated client reads of
  `studentAccommodations`, `launchGrants`, `presentationVariants` all return
  403 PERMISSION_DENIED.

### Active blocker before the delivery half: IAM token-creator grant

Exercising the real callables headlessly requires minting ID tokens for the
synthetic users via `admin.auth().createCustomToken()`, which signs through the
IAM Credentials `signBlob` API. The local ADC principal currently lacks
`iam.serviceAccounts.signBlob` on the staging service account, so token minting
is denied. HUMAN action (one IAM grant, no secret) unblocks the entire headless
delivery-half certification:

```
gcloud iam service-accounts add-iam-policy-binding \
  lyfelabz-staging@appspot.gserviceaccount.com \
  --member="user:<the account used for gcloud auth application-default login>" \
  --role="roles/iam.serviceAccountTokenCreator" \
  --project=lyfelabz-staging
```

(Console: IAM and Admin -> Service Accounts -> `lyfelabz-staging@appspot.gserviceaccount.com`
-> Permissions -> Grant access -> that account -> role "Service Account Token
Creator".) After granting, the delivery half runs headlessly: accommodation
activation (Op B), operational enable/disable, launch resolution + grants,
session/attempt binding, reassessment A->B, downgrade defense
(`BEGIN_REQUIRES_LAUNCH`), canonical non-regression, invalid-grant security.
Client routing (browser) may still need a short manual step.

---

### IAM token-creator grant (RESOLVED)

`user:cgbreezy7@gmail.com` was granted `roles/iam.serviceAccountTokenCreator` on
`lyfelabz-staging@appspot.gserviceaccount.com` (staging only). ADC quota project
is `lyfelabz-staging`. `admin.createCustomToken()` -> Identity Toolkit
`signInWithCustomToken` now mints synthetic ID tokens headlessly (no token value
is ever printed).

### Delivery-half certification (backend A-M certified against staging)

Driver `platform/functions/src/scripts/staging-cert-driver.ts` (+ tests) - fail
closed to `lyfelabz-staging`, tokens/refs in memory only, redacted logs. Real
callables exercised with synthetic identities. Results:

- A auth/identity PASS - student->teacher-op `PERMISSION_DENIED`; both students
  authenticate; protected families deny-all (403) to direct client reads.
- B accommodation (Op B) PASS - activation configRevision 1, attribution +
  append-only history `r1`; stale CAS refused; equal-value `noop:true` (no rev
  increment / no history entry).
- C flag fail-closed PASS - missing config = disabled (canonicalFallback); only
  explicit `enabled:true` enables.
- D canonical control PASS - canon session+attempt `canonical`, no pair.
- E disabled PASS - session+attempt `canonicalFallback`, no pair; accommodation
  remained active/unchanged.
- F differentiated PASS - resolve->current revB; grant binds student/assignment/
  lesson/outcome/pair, TTL 6h; session+attempt freeze revB; `differentiated`.
- G downgrade defense PASS - covered+enabled, no launchRef -> `BEGIN_REQUIRES_LAUNCH`;
  no session, no attempt.
- H invalid grants PASS - cross-user and malformed both -> uniform
  `LAUNCH_REF_INVALID`; no session created.
- I A->B immutability PASS - grant bound to revA; index moved to revB; begin froze
  session AND attempt to revA (no re-resolution); revA artifact still reachable.
- J reassessment PASS - attempt#1 revA unchanged, attempt#2 revB, both same
  assignment-frozen `assessmentRevisionId`.
- K client/hosting - headless PASS (revA & revB artifacts reachable HTTP 200;
  manifest.json non-public: URL returns the SPA index fallback, not manifest
  bytes). Browser navigation / artifact-load-failure UX requires a human step.
- L operational disable/re-enable PASS - disable->truthful canonicalFallback->
  re-enable->differentiated; accommodation never migrated/rewritten.
- M legacy compatibility PASS - synthetic pre-feature attempt readable, carries no
  `deliveryOutcome`/pair, not backfilled.

Synthetic evidence remaining on staging (for review): attempts a1(revA
differentiated), a2(revB differentiated), a3(canonicalFallback), a4(revB
differentiated) for the diff student; a1(canonical) for canon; one legacy attempt
fixture; `studentAccommodations/staging-cert-student-diff` active rev 1;
`platformConfig/differentiatedDelivery` `{enabled:true}`; index -> revB.
`node .../staging-cert-seed.js --project=lyfelabz-staging --reset` removes the
synthetic seed/users.

### Staging Firebase web config fix (Phase K prep)

Root cause of the staging Google sign-in failure: staging Hosting served the
committed `assets/lyfelabz-firebase-config.js`, which hardcoded the lyfelabz-prod
web config, so the staging app authenticated against lyfelabz-prod from the
staging origin and failed. Fix: `assets/lyfelabz-firebase-config.js` is now
host-aware - it emits the lyfelabz-staging web config on
`lyfelabz-staging.web.app` / `.firebaseapp.com` and the byte-identical prod
config on every other host (production runtime unchanged). Redeployed with
`firebase deploy --only hosting --project lyfelabz-staging`; retained variant
artifacts A/B remained HTTP 200. This working-tree change is uncommitted and is
safe if committed (prod output identical), but the human performs commits.
Not a production application defect (the app already reads an injected config).

### Browser actor prepared (labzlyfe@gmail.com)

Login succeeded after the config fix: staging Auth UID
`N7Zc3wdfUUY2FaJAC1bZpeCFRBk2` (provider google.com). The post-login
"You appear to be offline" screen is the bootstrap `navigator.onLine === false`
branch (session/bootstrap.ts) - a retriable client transient with a working
"Try again", not a backend defect and not the provisioned-identity surface.
`staging-cert-driver.js prepareBrowserActor --uid=<uid>` then provisioned the
actor (staging-only): student custom claims + `users/{uid}` active student;
active enrollment in `staging-cert-class`; assignment recipient (with teacherId);
reading-accessibility activated via the REAL Op B callable (configRevision 1).
Headless verification: a fresh resolver call for that UID returns differentiated,
selecting revB (`pr784872…aed46`) with a launchRef minted. Token-refresh note: the
browser must sign out and sign back in (fresh incognito) so its ID token carries
the newly set student claims.

### Stale staging client bundle fix (Phase K normal-routing 404)

The first differentiated browser launch hit Firebase's raw 404 for
`/lesson_staging-cert-fixture.html` (the root-level canonical fallback URL, which
does not exist for the fixture). Root cause: the deployed staging
`app/dist/bundle.js` was a stale build with ZERO Slice 5 routing markers, so
"Open assignment" navigated straight to the canonical lesson URL. Slice 5 SOURCE
is correct (`launchRouting.ts` builds absolute `/app/lessons/variants/...`,
probes, and falls back) - a fresh `npm --prefix app run build` yields a bundle
with the Slice 5 markers. Fix: rebuilt the app bundle (gitignored build artifact,
no source change) and redeployed `firebase deploy --only hosting --project
lyfelabz-staging`; live staging bundle now carries the Slice 5 routing; retained
A/B artifacts stayed HTTP 200. Not a Slice 5 implementation defect; not
production (prod untouched). Note for the later artifact-failure test: the
fixture has no canonical lesson page, so the visual canonical fallback will 404 -
expected for a fixture, and still proves ref-discard + `BEGIN_REQUIRES_LAUNCH`.

### Remaining human gate: Phase K browser observation

The synthetic users cannot sign in through Google interactively (Email/Password is
intentionally off), so the client-side navigation and artifact-load-failure UX
must be observed by a human in a browser. Minimal script:

1. In an incognito browser, sign in at `https://lyfelabz-staging.web.app/app/`
   with a personal Google test account (used ONLY for browser auth - not a real
   student). Provision it as a synthetic student via the seed harness pattern or
   by enrolling it in `staging-cert-class` and adding it as a recipient.
2. Launch the `staging-cert-assignment`; confirm the browser loads the exact
   server-selected revision path (`/app/lessons/variants/lesson_staging-cert-fixture__<revB>.html`)
   and that no variantKey / presentationRevisionId / launchRef appears in the URL.
3. Simulate artifact-load failure (e.g. block that path in devtools); confirm the
   client falls back visually to canonical, discards the ref, and a subsequent
   begin returns `BEGIN_REQUIRES_LAUNCH` rather than a silent canonical attempt.

## 3a. Final Phase K browser certification (COMPLETE)

Browser actor: `labzlyfe@gmail.com` (browser-auth only, not a real student),
staging Firebase UID `N7Zc3wdfUUY2FaJAC1bZpeCFRBk2`, prepared as a synthetic
differentiated student (student claims, `users/{uid}`, enrollment in
`staging-cert-class`, recipient of `staging-cert-assignment`, active
reading-accessibility accommodation via the real Op B).

Normal differentiated routing = PASS (human): fresh incognito login; reached My
Science; opened `Staging Cert Assignment`; the browser loaded the exact
server-selected revB artifact
(`/app/lessons/variants/lesson_staging-cert-fixture__<revB>.html`) rendering
"Controlled differentiated presentation - revision B."; no accommodation
semantics in the URL.

Controlled artifact-failure = PASS (human + backend correlation). Chrome 152
rejected the wildcard `*lessons/variants*`; the human used the accepted
`Request conditions` block rule
`https://lyfelabz-staging.web.app/app/lessons/variants/*` (block; enable blocking
and throttling), then Open assignment:
- differentiated revB request BLOCKED by DevTools; the revB fixture did NOT load;
- client fell back to `https://lyfelabz-staging.web.app/lesson_staging-cert-fixture.html?assignment=staging-cert-assignment`
  (HTTP 404 - expected, the fixture has no canonical lesson page);
- the fallback URL carried `assignment=` but NO `launchRef=` (differentiated ref
  discarded, not carried into canonical navigation).
Backend correlation (staging driver + Admin reads): browser actor had 0 sessions
and 0 attempts (the failed launch created NO durable state - no canonical,
canonicalFallback, or differentiated record); a fresh resolve still returns
`deliveryOutcome=differentiated` revB (authoritative state unmutated); a ref-less
begin returns `BEGIN_REQUIRES_LAUNCH` with no session/attempt created.
Observational limitation: the neutral `console.warn` anomaly
("lesson presentation unavailable; opening the standard lesson") was not captured
in the human screenshot. It is telemetry/observability, not a correctness/security
mechanism; the security invariants (ref discarded, no differentiated claim, no
unauthorized attempt, fail-closed begin) are independently proven. Not material.

## 3b. Final disposition

- Phase K: PASS (normal routing + controlled failure).
- Backend Phases A-M: PASS (previously certified against staging).
- Slices 1-6 staging integration certification: PASS.
- Slice 7 (teacher Student Services activation UI): DEFERRED until after Sprint 29
  certification.
- Production (`lyfelabz-prod`): never deployed, mutated, or reconfigured.

Staging issues found and corrected (staging-only; neither was a production
application defect): (1) staging Hosting served the committed production Firebase
web config - fixed with a host-aware `assets/lyfelabz-firebase-config.js` that
emits staging config on the staging host and byte-identical prod config elsewhere;
(2) the deployed staging `app/dist/bundle.js` was a stale pre-Slice-5 build -
fixed by rebuilding from current source and redeploying hosting to staging only.

## 3c. F5.3 staging certifications (pointer)

This runbook covers the F5.2 Slices 1-6 gate. The F5.3 certifications are specified and recorded in `DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md`:

- **C7 (Earth's Layers accessible assessment): COMPLETE, PASSING.** See addendum §18.1.
- **Earth's Layers r2: Stage A COMPLETE, PASSING (2026-09-28, Hosting `980e784622c62aba`); Stage B COMPLETE, PASSING (2026-09-29, Hosting `dd2878386ce4cbbd`, r2 assignment, scoped r2 coverage, live r1 + r2 coexistence).** See §3e and the addendum §21.12 records.
- **C8 (Slice 9 revision-bound rendering): COMPLETE, PASSING.** See addendum §18.3 (record), §18.2 (the authoritative sequence) and §3d below (operational amendments).

C8 environment preconditions, in addition to the addendum steps:

- Slices 9A-9D are committed by the owner.
- The staging Functions deploy (`assignmentsListForStudent`, `lmsDeepLinkResolve`, `assessmentSessionsBegin`) precedes the staging Hosting deploy, each separately authorized and run from a clean release worktree with real `npm ci` installs.
- No lesson has a second deployed assessment revision (PDR-031h).
- The revision-scoped coverage write (`presentationVariants/earths-layers__reading-adapted__r1`) is a staging mutation that needs its own authorization.
- The live Hosting cache headers are recorded.
- Production is never touched.

## 3d. Slice 9 operational amendments (F5.3 9C-2, 9D; reference for C8)

These amend §2 and §3 for revision-scoped coverage. Where they differ, this section governs; the C8 order itself is addendum §18.2.

- **Scoped writes only.** `publish-variant` writes only `presentationVariants/{lessonSlug}__{variantKey}__r{N}`, for the assessment revision the retained revision covers.
  - The legacy unscoped document is read-only compatibility state and is never written or migrated.
  - The §2 description "INDEX_UPDATED" now means the scoped create or repoint.
  - The §3 fixture history ("index points to B") describes pre-Slice-9 pointer semantics.
- **Publish is create-only (S9-D9).** `--op=publish` creates the scoped record, or reconciles an identical one without writing. Any other existing record is refused before any side effect.
  - A staging `--op=publish` also runs `firebase deploy --only hosting --project lyfelabz-staging` (HOSTING_DEPLOYED) from the current working directory, so run it from the release worktree root.
- **Rollback is the explicit repoint.** `--op=rollback --revision=<retained pr>` repoints or re-activates the scoped record of the same lesson, variant and assessment revision. It needs hosted-byte liveness and never redeploys. It is used only under an owner ruling.
- **Retire names the revision.** `--op=retire --assessment-revision=assessment_<slug>__r<N>` flips only that scoped record. A retired scoped record never falls through to the legacy one.
- **C8 Functions deploy (exactly three).** Run from the release worktree root:
  ```
  firebase deploy --only functions:assignmentsListForStudent,functions:lmsDeepLinkResolve,functions:assessmentSessionsBegin --project lyfelabz-staging
  ```
  - Never a full `--only functions`, which would redeploy every function, including finalize and its Classroom secret binding.
  - These Functions must be live before any 9D Hosting release: the 9D client refuses launches, and the 9D runtime refuses to send responses, without the server's frozen `assessmentRevisionId`.
- **Staging `.env`.** Copy only the git-ignored `platform/functions/.env.lyfelabz-staging` (non-secret Classroom params) into the release worktree. `.env.lyfelabz-prod` is never copied or used.
- **Credentials.** Owner ADC (`gcloud auth application-default login`, account with the staging token-creator grant), quota project `lyfelabz-staging`. The staging publisher requires `GOOGLE_APPLICATION_CREDENTIALS`, set to that ADC file (`$HOME/.config/gcloud/application_default_credentials.json`). A service-account key file is not required.
- **Driver invocations (demonstrated in C8).** The staging drivers need the non-secret web key in `STAGING_WEB_API_KEY`, extracted from `assets/lyfelabz-firebase-config.js` with the driver's `extractAstra004StagingWebApiKey`. Then, for example, run `node platform/functions/lib/scripts/staging-cert-driver.js flag --set=false --project=lyfelabz-staging` from the release worktree with `GOOGLE_APPLICATION_CREDENTIALS` as above and both `GCLOUD_PROJECT` and `GOOGLE_CLOUD_PROJECT` set to `lyfelabz-staging`.
- **Browser cache after a Hosting release (observed in C8).** Hosting serves lesson pages, the bundle, the runtime and the path table with `max-age=3600`. A browser that loaded the app before the release can keep running the old bundle for up to an hour, and a hard reload did not always refresh it. Before observing behavior, confirm that the served bundle size (resource timing `encodedBodySize`) equals the release. If it does not, refetch the bundle, runtime assets and config with `cache: "reload"` (or clear site data), then reload.
- **Flag and live sessions.** A session freezes its delivery at its first begin and is reused until it is finalized. Finalize (or confirm there is no) live session before changing the delivery flag, or the next launch reuses the old delivery.
- **Synthetic fixture under 9D.** `staging-cert-assignment` (lesson `staging-cert-fixture`) has no canonical page in the revision-path table. Under 9D its My Science card shows with no launch action. This is expected fail-closed behavior; the headless drivers are unaffected.

## 3e. Earth's Layers r2: two-stage staging release (Stage A and Stage B COMPLETE)

Owner ruling R2-D6 (addendum §21.12). Each stage is its own owner-approved execution prompt. Nothing here authorizes a deploy, publish, Firestore write, or flag change.

**Why two repository states.** The unversioned Earth's Layers pages are generated from `canonicalAssessmentRevisionId`.
- **Stage A commit:** the tree at local certification.
  - The config declares r1, with r2 committed and rendered, the certified r2 presentation retained, and `pr6b7c…` generated.
  - The unversioned v1 and v2 pages are byte-identical to `f6e5067` and declare r1.
- **Stage B commit:** exactly four files change.
  1. `app/scripts/lessonBuilder/lessons/earths-layers.cjs`: the declaration becomes `assessment_earths-layers__r2`.
  2. `lesson-sources/lesson_earths-layers.html`: its quiz literal is replaced by a verbatim byte copy of the literal in `lesson-sources/variants/earths-layers.reading-adapted.html`. A regenerated literal fails the variant script-block gate.
  3. `lesson_earths-layers.html`, regenerated by `npm --prefix app run lessons:build`.
  4. `app/lessons/lesson_earths-layers.html`, regenerated the same way.

  The renditions, path table, client bundle, runtime assets, and retained variants are identical in both states, and the tests are stage-agnostic.
- **Why Stage A first.** A browser still holding a pre-Stage-A bundle routes an r1 assignment to the unversioned page. In Stage A that page still displays r1, so the stale bundle is harmless.

### Stage A

**Executed 2026-09-28: COMPLETE, PASSING.** Record in addendum §21.12. Release `8b6773a`, Hosting `980e784622c62aba` released 2026-09-28T23:05:22.741Z, and r2 deployed by `--assessment-revision` (`state=advance`, `writes=3`).


1. **Preconditions.** The owner has committed and pushed the Stage A state. The staging flag is true. The C8 state is intact.
2. **Release worktree.** Create a clean detached worktree at the Stage A commit, which must equal `origin/main`.
   - Run `npm --prefix app ci` and `npm --prefix platform/functions ci` (real installs, never symlinked).
   - Copy only `platform/functions/.env.lyfelabz-staging` (§3d).
3. **Gates.**
   - App: `npm --prefix app run verify` and `npm --prefix app run build`.
   - Functions: test, typecheck, lint and build.
   - Hosting: `node scripts/app-hosting/build.cjs` and `node --test scripts/app-hosting/build.test.cjs`.
   - Protected hashes:
     - `earths-layers.r1.json` is `1ecb141a…74b3`;
     - `prff01…`, `pr90f…` and `pr6b7c…` hash to their ids;
     - the `ap1fed…` record is `c6421097…1117` and its review record `4670e199…75a6`;
     - `node app/scripts/assessment-presentation-review.cjs verify-canonical` passes for both retained records.
   - Stage check: the config declares r1, and both unversioned pages declare r1.
4. **No Functions deploy.** `git diff --stat f6e5067..<Stage A commit> -- platform/functions/src` must show only `scripts/` (the staging deployer, its tests, the r2 payload, the retained r2 record) and tests. Anything else: STOP.
5. **Read-only pre-snapshot** (as C8 Phase 3). Expected:
   - `assessments/assessment_earths-layers` has `currentRevisionId` r1;
   - no r2 revision, answer key, `…__r2` scoped record, or `assessmentPresentations/ap515838…`;
   - the scoped r1 and legacy records are as in C8 §18.3;
   - attempts `a1`–`a4`, no live session, 0 passbacks, the flag.
   - Also record the Function update times and the Hosting release.
6. **Hosting.** Run `firebase deploy --only hosting --project lyfelabz-staging` from the release worktree root. Record the release time from the Hosting API.
7. **Served bytes.**
   - Every served file equals the artifact.
   - Against the C8 release `b292073a482b032b`:
     - added: exactly the two renditions and `pr6b7c…`;
     - changed: `revision-paths.json` and `app/dist/bundle.js`;
     - the unversioned Earth's Layers pages are unchanged and declare r1.
   - Record the cache headers.
8. **Cache-safety checkpoint** (below). STOP on any mismatch.
9. **Deploy r2 by explicit revision** (credentials: §3d).
   - Dry run:
     ```
     node platform/functions/lib/scripts/deploy-assessment-staging.js --project=lyfelabz-staging --lesson=earths-layers --assessment-revision=assessment_earths-layers__r2
     ```
     Expect `dry-run ok … file=earths-layers.r2.json … revision=assessment_earths-layers__r2 … fidelity=exact selection=explicit state=advance from=assessment_earths-layers__r1 writes=0`.
   - Then the same command with `--apply`. Expect `applied … revision=assessment_earths-layers__r2 ordinal=2 writes=3`.
   - Verify:
     - the r2 revision and answer key exist (key `BDACBADCAB`);
     - `currentRevisionId` is r2;
     - the r1 revision and key update times are unchanged.
   - From here any newly published Earth's Layers assignment freezes r2. Create none in Stage A. Publish no r2 coverage in Stage A.
10. **Post-snapshot.** Only the r2 revision and answer key are added, and the parent's `currentRevisionId` advanced. Everything else equals step 5.

### Cache-safety checkpoint (Stage A and Stage B)

Hosting serves the lesson pages, `app/dist/bundle.js`, the runtime, and the path table at unhashed URLs with `cache-control: max-age=3600`. There is no service worker.

1. **Release hashes.** From the release artifact `dist/app-hosting`, record the SHA-256 and byte length of:
   - `app/dist/bundle.js`;
   - `assets/lyfelabz-assessment-runtime.js`;
   - `assets/lyfelabz-assessment-runtime-active.js`;
   - `app/lessons/assessment-revisions/revision-paths.json`;
   - both renditions;
   - `app/lessons/lesson_earths-layers.html` and `lesson_earths-layers.html`;
   - the `pr90f…` and `pr6b7c…` variants.
2. **Served hashes.** `curl -s -H 'Cache-Control: no-cache' https://lyfelabz-staging.web.app/<path> | shasum -a 256` must equal step 1 for every path.
3. **Browser refetch.** In the certification browser (signed in as the test student, on the staging origin), fetch every path with `fetch(path, { cache: "reload" })`. This bypasses and replaces the HTTP-cache entry. Hash the bytes with `crypto.subtle.digest("SHA-256", …)`; each must equal step 1.
4. **Fresh navigation.** Navigate to `/app/` (a real navigation, not history). The resource-timing `decodedBodySize` of `/app/dist/bundle.js` must equal the step 1 byte length.
5. **Executing-bundle fingerprint.** The My Science "Open assignment" control of the frozen-r1 assignment must carry `data-assignment-launch-url` = `/app/lessons/assessment-revisions/lesson_earths-layers__r1.html?assignment=<id>`.
   - A pre-Stage-A bundle yields `/app/lessons/lesson_earths-layers.html?assignment=<id>`.
   - The value is computed by the executing bundle from its own path table.
6. **Stage B only.** The refetched unversioned v1 and v2 pages declare r2. The fingerprint in step 5 is unchanged, because the bundle is identical.
7. Record every value in the certification record.

**Elapsed window (also required).** Stage B's Hosting release must come at least **3600 seconds after the Stage A Hosting release**, in addition to the checkpoint.
- The checkpoint proves only the certification browser.
- Any other browser that loaded a pre-Stage-A bundle may keep it for up to `max-age`.
- Harmless during Stage A, such a bundle would route r1 to a page displaying r2 after Stage B, and the runtime gate would block that student.
- Waiting `max-age` after the Stage A release guarantees that no pre-Stage-A bundle is still fresh.

### Stage B

**Executed 2026-09-29: COMPLETE, PASSING.** Record in addendum §21.12. Release `28e2e2c`, Hosting `dd2878386ce4cbbd` released 00:06:22.079Z. The r2 assignment `a-earths-layers-qxtgj09sb58fox0zgv30-kpckdzwx0hyhv-3rb8j6cfpceua` is in "LyfeLabz Staging Test" (owner decision; step 6).

Step 6 note. A class whose Current Earth's Layers assignment is valid and fully staffed shows "Up to date" in the Assign dialog. A new assignment there requires closing that Current first ("Assign as new"), which makes the old assignment history-only. To keep an older revision live, use another class.


1. **Preconditions.**
   - Stage A certified, including step 9.
   - At least 3600 s since the Stage A Hosting release.
   - The Stage B commit exists: exactly the four-file delta above, made by an owner-approved local change with the full gates run, then committed and pushed.
2. **Release worktree and gates** as in Stage A steps 2 and 3. Also:
   - both unversioned pages declare r2;
   - `git diff --stat <Stage A>..<Stage B>` lists exactly the four files.
3. **Hosting:** `firebase deploy --only hosting --project lyfelabz-staging`. Against the Stage A release, exactly `/app/lessons/lesson_earths-layers.html` and `/lesson_earths-layers.html` change.
   - The marketing target (`firebase.marketing.json`) also serves the v1 page on its own surface. That is a separate authorization and is not part of assignment flows.
4. **Cache-safety checkpoint** with the Stage B hashes, including step 6.
5. **Frozen r1 still routes r1.**
   - The fingerprint is unchanged.
   - With the flag false, a fresh launch reaches the r1 rendition (declares r1, four choices). Restore the flag to true and verify it.
   - With the flag true, the accommodated launch still reaches `pr90f…` through the scoped r1 record.
6. **Controlled r2 assignment** (owner decision required on the class, because publishing Earth's Layers in the existing class would replace that class's Current Assignment). The new assignment must freeze `assessment_earths-layers__r2`.
7. **Canonical r2.**
   - With the flag false, or with a canonical student, the launch reaches the r2 rendition: declares r2, four choices, r2 q1 stem.
   - The attempt records r2 and is scored against the r2 key.
8. **Publish r2 coverage** (create-only):
   ```
   node platform/functions/lib/scripts/publish-variant.js --op=publish --target=staging --project=lyfelabz-staging --hosting-origin=https://lyfelabz-staging.web.app --lesson=earths-layers --variant=reading-adapted --revision=pr6b7c74fe84fb20a9b05d4b2d6e006c21ed2bc02d58dcfbefc925dbd4c400e948 --published-by=<owner label>
   ```
   Expected stages:
   - LOCAL_VERIFIED: r2 from `ap515838…`, r2 deployed, preflight absent, create;
   - HOSTING_DEPLOYED: the identical Stage B build;
   - HOSTED_BYTES_VERIFIED;
   - ASSESSMENT_PRESENTATION_RECORDED: create `ap515838…`;
   - INDEX_UPDATED: create `earths-layers__reading-adapted__r2`.

   The scoped r1 and legacy records are not written.
9. **Adapted r2.**
   - With the flag true, the accommodated student on the r2 assignment reaches `pr6b7c…`: 10 items, 3 choices each, binding r2 and `ap515838…`.
   - The negatives driver is re-run against the new grant.
   - The attempt records r2, `differentiated`, `pr6b7c…`, `ap515838…`, and the config revision.
   - A forced mismatch on the r2 page writes nothing.
10. **Unchanged.**
    - The r1 assignment is still frozen r1, and attempts `a1`–`a4` are unchanged.
    - The scoped r1 and legacy records, the `ap1fed…` record, and the served `pr90f…` and `prff01…` bytes are unchanged.
    - 0 passbacks; production untouched.

## 4. Do not

- Do not deploy to or mutate `lyfelabz-prod`.
- Do not rely on the selected Firebase alias as the safety boundary; verify the
  resolved project id.
- Do not use real student accommodation data anywhere.
- Do not expose the Slice 7 teacher Student Services activation UI.
- Do not commit or push; the human performs all commits.
