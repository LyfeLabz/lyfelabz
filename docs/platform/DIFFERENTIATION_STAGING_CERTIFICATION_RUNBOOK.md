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

## 4. Do not

- Do not deploy to or mutate `lyfelabz-prod`.
- Do not rely on the selected Firebase alias as the safety boundary; verify the
  resolved project id.
- Do not use real student accommodation data anywhere.
- Do not expose the Slice 7 teacher Student Services activation UI.
- Do not commit or push; the human performs all commits.
