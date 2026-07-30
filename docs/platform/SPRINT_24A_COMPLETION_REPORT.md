# Sprint 24A - Production Runtime Configuration, Deployment, and End-to-End Verification

## 1. Executive summary

Sprint 24A completed the production deployment and end-to-end
validation of the Google Classroom integration infrastructure certified
across Sprints 23A through 23F. The Cloud Functions surface, Firestore
Rules and indexes, Hosting bundle, Google Cloud OAuth client
configuration, Firebase Functions typed parameters, Secret Manager
binding, and Firestore TTL policy are all provisioned in the
`lyfelabz-prod` project. A live production teacher successfully
completed the OAuth 2.0 authorization flow against the deployed
`lmsConnectionsBegin` and `lmsConnectionsComplete` callables, and
successfully linked a real Google Classroom course to an existing
LyfeLabz class through the deployed `lmsClassesImport` callable.

Sprint 24A verified the integration foundation only. Roster
synchronization, student enrollment writes, student identity
reconciliation, and the roster display surface were intentionally not
exercised. Those items are the scope of Sprint 24B (see
`SPRINT_24B_DEFINITION.md`).

## 2. Deployment target

- Firebase project: `lyfelabz-prod`
- Firebase CLI binding: `firebase use` reported `default (lyfelabz-prod)`
  at every deploy step
- Region: `us-central1` (Cloud Functions v2 default per
  `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §6)
- Custom domain for the authenticated app: `app.lyfelabz.com`
- Custom domain for public curriculum content: `www.lyfelabz.com` and
  `lyfelabz.com` (served by GitHub Pages; unchanged by this sprint)
- Deploy commit: `9b9682f` (`Sprint 24A: fix production LMS OAuth
  callback path`)

## 3. Deployment sequence executed

Executed from the repository root against `lyfelabz-prod` in the order
prescribed by `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §8.

1. `firebase deploy --only firestore:rules,firestore:indexes` -
   Firestore Rules compiled and released to production; Firestore
   indexes deployed. This was the first production release of the
   Sprint 23 LMS Rules surface covering `lmsOAuthStates`,
   `lmsTokenBundles`, `lmsConnections`, `lmsClassLinks`, and
   `externalIdentities`.
2. `firebase deploy --only functions` - all callables from
   `platform/functions/src/index.ts` deployed successfully, including
   the Sprint 23 additions `reconcileMyExternalIdentity`,
   `identityMigrationRunProductionInventory`, and `lmsClassesSyncRoster`.
   No prompt to delete stale functions was issued; no partial failure
   occurred.
3. `firebase deploy --only hosting` - the rebuilt `app/dist/bundle.js`
   was deployed alongside the `app/lms-callback.html` static shell. The
   deploy propagated to the `app.lyfelabz.com` custom domain within
   seconds.
4. A follow-up `firebase deploy --only functions` was executed after
   correcting `GOOGLE_CLASSROOM_REDIRECT_URI` in
   `platform/functions/.env.lyfelabz-prod` from
   `https://lyfelabz.com/app/lms-callback.html` to
   `https://app.lyfelabz.com/app/lms-callback.html`.

## 4. OAuth production configuration

### 4.1 Google Cloud OAuth client

The Web application OAuth client in the LyfeLabz Google Cloud project
was updated to match the deployed Firebase Hosting surface. Verified in
the Google Cloud Console after Save:

- Authorized JavaScript origins include `https://app.lyfelabz.com`
  (retained: `https://lyfelabz.com`,
  `https://lyfelabz-prod.firebaseapp.com`, `http://localhost`,
  `http://localhost:5000`).
- Authorized redirect URIs list is exactly:
  - `https://lyfelabz-prod.firebaseapp.com/__/auth/handler` (Firebase
    Auth handler; retained)
  - `https://app.lyfelabz.com/app/lms-callback.html` (LMS callback;
    added by Sprint 24A)
- The stale entry `https://lyfelabz.com/app/lms-callback.html` was
  removed. That URI targeted the GitHub Pages host and could not
  succeed for a real teacher.

### 4.2 Firebase Functions typed parameters

Provisioned in `platform/functions/.env.lyfelabz-prod` (git-ignored per
`.gitignore` and `platform/functions/.gitignore`):

- `GOOGLE_CLASSROOM_CLIENT_ID` - the OAuth 2.0 Web application client
  ID from the Google Cloud console. Value validated against the pattern
  `^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$`.
- `GOOGLE_CLASSROOM_REDIRECT_URI` -
  `https://app.lyfelabz.com/app/lms-callback.html`. Exact-match
  requirement per `LMS_INTEGRATION_OPERATIONS.md` §4.2 and
  `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §5.

`LYFELABZ_LEGACY_SUBMISSIONS_WRITES_ENABLED` was verified absent from
the production environment, preserving the inert default required by
PDR-026 §26 and enforced at
`platform/functions/src/shared/legacy-submissions-flag.ts:28`.

### 4.3 Secret Manager

`GOOGLE_CLASSROOM_CLIENT_SECRET` was already provisioned prior to
Sprint 24A. Verified via `firebase functions:secrets:get
GOOGLE_CLASSROOM_CLIENT_SECRET`: exactly one version, state `ENABLED`.
The secret payload was not accessed at any point during the sprint.

Binding to the five Google Classroom callables is declarative and
automatic through `googleClassroomProductionSecrets` in
`platform/functions/src/lms/providers/google-classroom/config-firebase.ts:72`.

## 5. Live production verification

A production teacher account signed into the deployed workspace at
`https://app.lyfelabz.com/app/` and completed the following flow:

1. Settings > Connected Services > Open Integrations.
2. Clicked Connect Google Classroom.
3. The OAuth popup opened at `accounts.google.com`.
4. The consent screen displayed the correct app name (LyfeLabz) and
   the two authorized read-only scopes
   (`classroom.courses.readonly`, `classroom.rosters.readonly`). No
   write, edit, or manage scope was requested.
5. Consent was approved.
6. Google redirected the popup to
   `https://app.lyfelabz.com/app/lms-callback.html`.
7. The callback shell posted the authorization code and state back to
   the opener window, which invoked `lmsConnectionsComplete` as a
   callable to finish the exchange.
8. The Integrations panel displayed the provider as connected.
9. Google Classroom course discovery via `lmsClassesDiscover` returned
   the teacher's courses in the import picker.
10. The teacher selected one Google Classroom course and linked it to
    the existing LyfeLabz class "Beta" via `lmsClassesImport`.

No raw OAuth error surfaced. The popup closed cleanly. The Integrations
panel refreshed without a page reload.

## 6. Firestore evidence

Verified read-only in the Firebase Console for `lyfelabz-prod`
immediately after the live test.

- `lmsConnections`: one document. Fields observed: `providerId =
  googleClassroom`, `status = active`, `teacherId` matches the
  authenticated teacher UID, `connectedAt` matches the production
  test window, `tokenRef` present.
- `lmsClassLinks`: one document. Fields observed: `classId` references
  the LyfeLabz "Beta" class, `providerId = googleClassroom`,
  `status = linked`, `connectionId` matches the `lmsConnections`
  document, `lmsClassId` present, `linkedAt` matches the production
  test window.
- `classes`: the "Beta" class document reflects the linked upstream
  provider with `lmsProviderRef = googleClassroom` and `status =
  active`.
- `lmsOAuthStates`: one document. Fields observed: `providerId =
  googleClassroom`, `teacherId` matches, `redirectUri =
  https://app.lyfelabz.com/app/lms-callback.html`, `consumedAt`
  present, `expiresAt` present as a Firestore Timestamp. The consume
  path in
  `platform/functions/src/lms/oauth-state/firestore-state-store.ts`
  behaved correctly under production load.
- `lmsTokenBundles`: one document present. The document payload was
  not opened at any point. Presence-only confirmation.
- `auditEvents`: two events were observed for the authenticated
  teacher, `lms.connectionCreated` and `lms.classImported`. No
  `lms.rosterSynchronized` event exists for the teacher; this is
  correct because no roster sync was executed.
- `enrollments`: the enrollment count for the "Beta" class is
  unchanged versus the pre-test state. Sprint 24A wrote zero
  enrollment documents.

## 7. Firestore TTL

Provisioned once post-deploy through the Firebase Console per
`SPRINT_23F_FIRESTORE_TTL_OPERATIONS.md` §2.1. Verified state:

- Collection group: `lmsOAuthStates`
- Timestamp field: `expiresAt`
- State: `Serving`

TTL is a storage-cost optimization only. Correctness of the OAuth
state consume path does not depend on the sweeper (see
`platform/functions/src/lms/oauth-state/firestore-state-store.ts:247`).

## 8. Items intentionally not certified

Sprint 24A verified the integration foundation. The following items
were intentionally not exercised and are not certified by this sprint:

- Roster synchronization. `lmsClassesSyncRoster` was deployed but not
  invoked. The client build has no surface that calls it, and manual
  invocation against production was declined to avoid creating student
  enrollment data before the roster workflow, identity resolution
  behavior, and display surface are designed.
- Student enrollment writes triggered by an upstream roster.
- Student identity reconciliation through the certified external
  identity bridge (`resolveActiveExternalIdentity`) for non-teacher
  accounts.
- Roster synchronization idempotency across repeated invocations.
- Roster display inside the class workspace. Classes > Beta > Roster
  currently renders the placeholder "The full class-level workspace
  will grow into this space...".
- Automatic LyfeLabz class creation from a Google Classroom course.
- Roster refresh UI (manual sync button).
- Reconnect flow for expired Google OAuth refresh tokens.

These items are the scope of Sprint 24B.

## 9. Lessons learned

### 9.1 Redirect URI must target the authenticated app subdomain

The initial Sprint 24A source correction changed the redirect URI path
from `${origin}/lms-callback.html` to `${origin}/app/lms-callback.html`.
That path change was correct, but the deployed application actually
serves from `app.lyfelabz.com`, not `lyfelabz.com`. The apex and `www`
hosts still point at the legacy GitHub Pages marketing site. The first
live test attempt at `https://lyfelabz.com/app/` failed at the bundle
load because the GitHub Pages tree does not carry
`app/dist/bundle.js`. The fix was to test at the true production host
`https://app.lyfelabz.com/app/`, update the redirect URI value in
`platform/functions/.env.lyfelabz-prod` and the Google Cloud OAuth
client to the same host, and redeploy Functions so
`GOOGLE_CLASSROOM_REDIRECT_URI` reached the callables.

Documentation updated in the same commit stream to reflect the
authoritative production URI:

- `docs/platform/LMS_INTEGRATION_OPERATIONS.md` §4.2

Documentation deliberately not updated: the platform architecture,
operations specification, and PDR-027 references to `lyfelabz.com/`
as the eventual canonical origin describe a target state after Firebase
Hosting takes over the apex from GitHub Pages. That migration is
separate work and is not authorized by Sprint 24A.

### 9.2 Firebase CLI v15 does not have `functions:params:set`

The `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §5 suggestion
`firebase functions:params:set` is not a real CLI command in Firebase
CLI v15.22.4. Firebase Functions v2 typed parameters
(`defineString`, `defineInt`, `defineBoolean`) are configured via
`.env` files in the functions source directory, keyed by project id
(`.env.<project-id>` wins over `.env`). The Sprint 24A operator
provisioned production parameters through
`platform/functions/.env.lyfelabz-prod`, which is git-ignored and never
committed. `firebase functions:secrets:set` (and the read-only
`firebase functions:secrets:get`) remain valid for `defineSecret`
values.

The Sprint 23F runbook prescription is superseded by this note for
day-to-day operations. A future documentation pass should replace the
`functions:params:set` suggestion in the runbook with the `.env` file
mechanism.

### 9.3 Current teacher flow is not the desired production UX

The verified working flow requires a teacher to:

1. Create a LyfeLabz class first.
2. Connect Google Classroom.
3. Manually choose the pre-existing LyfeLabz class in the import
   picker.
4. Link the Google Classroom course into that class.

This works but inverts the natural mental model. The intended default
flow is: connect Google Classroom, choose a Classroom course, and let
LyfeLabz create the LyfeLabz class automatically from it. The
"link to existing LyfeLabz class" path becomes the secondary option
for teachers who already have a class set up. This is Sprint 24B work.

## 10. Validation baseline

The following validation ran clean from commit `9b9682f` immediately
before deployment:

- `npm --prefix platform/functions run typecheck` - pass
- `npm --prefix platform/functions run lint` - pass
- `npm --prefix platform/functions run build` - pass
- `npm --prefix platform/functions test` - 71 suites, 1315 tests
  passing
- `npm --prefix app run verify` - 41 suites, 757 tests passing
- Em-dash sweep on modified files - clean
- Working tree clean at deploy time (an unrelated in-progress edit to
  `about_learning-science.html` was temporarily stashed for the
  duration of the deploy and restored afterward).

Post-sprint validation baseline (unchanged from the deploy baseline
because Sprint 24A did not change source code beyond
`app/src/settings/integrations/wire.ts` and
`app/src/settings/integrations/wire.test.ts` in the preparatory
commit; the follow-up commit adjusted only the test file's exemplar
production origin and the documentation host).

## 11. Certification statement

Google Classroom OAuth connection, Google Classroom course discovery,
LyfeLabz class linking, external identity creation for the connecting
teacher, durable OAuth state custody, and durable OAuth token custody
have been configured, deployed, and verified in the `lyfelabz-prod`
production environment using the certified external identity bridge
and durable OAuth storage architecture. The verified workflow preserved
Firebase UID identity, existing enrollment records, existing attempts,
and existing submissions.

Sprint 24A does not certify roster synchronization, student enrollment
writes, student identity reconciliation for non-teacher accounts,
roster synchronization idempotency, the roster display surface,
automatic LyfeLabz class creation from a Google Classroom course, a
manual roster refresh UI, or an OAuth reconnect flow for expired
tokens. Those items are the scope of `SPRINT_24B_DEFINITION.md`.

## 12. Files created and modified

Repository changes committed for Sprint 24A:

- `app/src/settings/integrations/wire.ts` (modified) - corrected the
  browser-emitted redirect URI to include the `/app/` path segment so
  it matches the served callback shell.
- `app/src/settings/integrations/wire.test.ts` (created, then updated) -
  three regression tests locking the corrected redirect URI shape and
  the exemplar production origin `https://app.lyfelabz.com`.
- `docs/platform/LMS_INTEGRATION_OPERATIONS.md` (modified) - §4.2
  updated to describe the same-origin browser-callback architecture
  and to reflect the authoritative production redirect URI
  `https://app.lyfelabz.com/app/lms-callback.html`.
- `docs/platform/SPRINT_24A_COMPLETION_REPORT.md` (this file, created).
- `docs/platform/SPRINT_24B_DEFINITION.md` (created).

Operator-side configuration not committed to the repository:

- `platform/functions/.env.lyfelabz-prod` (git-ignored) - populated
  with `GOOGLE_CLASSROOM_CLIENT_ID` and `GOOGLE_CLASSROOM_REDIRECT_URI`.
- Google Cloud OAuth client Authorized JavaScript origins and
  Authorized redirect URIs updated.
- Google Secret Manager `GOOGLE_CLASSROOM_CLIENT_SECRET` (version 1,
  Enabled).
- Firestore TTL policy on `lmsOAuthStates.expiresAt` (Serving).

## 13. Sprint 24B not started

Sprint 24B work has not begun. This sprint stops at production
certification of the Sprint 23 integration foundation. Roster workflow
implementation, roster display, and automatic LyfeLabz class creation
from a Google Classroom course are deferred to Sprint 24B per
`SPRINT_24B_DEFINITION.md`.

*End of report.*
