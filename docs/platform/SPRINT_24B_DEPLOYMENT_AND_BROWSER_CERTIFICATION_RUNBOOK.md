# Sprint 24B - Deployment and Browser Certification Runbook

Status: Operational.
Date authored: 2026-07-31.
Scope: Sprint 24B (Google Classroom teacher workflow) including the
Phase 2B activation seam (`classesLmsCreate` and `classesActivate`),
the teacher-preference surface, and the class workspace roster view.

This runbook is executed by a human operator. It does not modify code,
does not commit, and does not deploy on its own. It is the single
procedure to certify a Sprint 24B build in a live browser and then
promote it to production.

Subordinate to:

- `docs/platform/SPRINT_23F_DEPLOYMENT_RUNBOOK.md` (canonical
  production deploy procedure - this runbook adds Sprint 24B specifics
  and defers to that document where the two overlap).
- `docs/platform/LMS_INTEGRATION_OPERATIONS.md`.
- `docs/platform/PLATFORM_OPERATIONS_SPECIFICATION.md`.
- `docs/platform/SPRINT_24B_DEFINITION.md` and
  `docs/platform/SPRINT_24B_PHASE_2B_COMPLETION_REPORT.md`.

Where a step conflicts with the Sprint 23F runbook or the operations
specifications, they control.

---

## 0. How to use this runbook

Read Sections 1 through 3 before starting. Execute Sections 4 through 8
in order, top to bottom. Do not skip steps. If any pass/fail step in
Section 5 fails, stop, record the failure in the certification log,
and do not proceed to deployment (Section 6). If any post-deploy step
in Section 7 fails, execute the rollback in Section 8 immediately.

Every command is annotated with the directory it must be run from.
Absolute paths are used where ambiguity would matter.

---

## 1. Environment prerequisites

### 1.1 Workstation

- macOS or Linux (POSIX shell).
- Node.js 20.x. Verify: `node --version` reports `v20.x.x`.
- npm 10.x (bundled with Node 20).
- Java 11 or newer (required by the Firestore emulator). Verify:
  `java -version`.
- Firebase CLI (`firebase-tools`) 13.x or newer. Verify:
  `firebase --version`.
- `gcloud` CLI (only required for the TTL step in Section 6 and for
  optional secret rotation).
- Google Chrome (or Chromium) 120+ - the certification steps in
  Section 5 are written against Chrome DevTools. Firefox and Safari
  are acceptable substitutes for keyboard/accessibility checks but
  Chrome is the reference browser for Firestore/console traces.

### 1.2 Repository state

- Clean working tree on the Sprint 24B implementation-complete commit.
  Verify: `git status` reports "nothing to commit, working tree
  clean". Uncommitted changes are a gating defect - either stash them
  or commit them before starting.
- `main` branch or a tag/commit that includes the Phase 2B.5
  completion report (`SPRINT_24B_PHASE_2B_COMPLETION_REPORT.md`).
- All dependencies installed:
  - `npm --prefix platform/functions install`
  - `npm --prefix app install`

### 1.3 Firebase Emulator Suite

The certification in Section 5 runs against the emulator suite
configured at `platform/firebase/firebase.json`:

| Emulator     | Port |
|--------------|------|
| Auth         | 9099 |
| Firestore    | 8080 |
| Functions    | 5001 |
| Storage      | 9199 |
| Emulator UI  | 4000 |

`singleProjectMode` is enabled. The emulator project id is
`lyfelabz-platform`.

Hosting is not configured in the emulator. Section 4.4 documents the
static-serve procedure the certification uses for the `/app/**`
bundle.

### 1.4 Google Cloud project and OAuth clients

LyfeLabz has exactly one Google Cloud project: `lyfelabz-prod`.
Browser certification does not create, use, or require any other
Google Cloud project. The certification exercises the real Google
Classroom OAuth handshake against Google (not a mock), but every
Firebase-side write lands in the local Emulator Suite (§1.3), not
in production Firestore, Auth, or Functions.

Production and certification share the following project-level
artifacts on `lyfelabz-prod`. Certification does not duplicate any
of them:

- The Google Classroom API enablement (`classroom.googleapis.com`).
- The OAuth consent screen (Google Auth Platform: Branding, Audience,
  and Data Access) shared by both OAuth clients on this project.

**Runtime scope source of truth.** The scopes actually requested
at OAuth authorization time are declared in code at
`platform/functions/src/lms/providers/google-classroom/adapter.ts`
(`GOOGLE_CLASSROOM_INITIAL_SCOPES`, consumed by `beginOAuth` on
the `scope` query parameter of the Google authorization URL). The
runtime request is:

- `https://www.googleapis.com/auth/classroom.courses.readonly`
- `https://www.googleapis.com/auth/classroom.rosters.readonly`

Only those two. A second constant
`GOOGLE_CLASSROOM_PUBLICATION_SCOPES` in the same file declares
`classroom.coursework.me` and `classroom.topics.readonly` and is
reserved for a future publication sprint; no current code path
requests them.

**Data Access declaration.** The Google Auth Platform "Data Access"
page must declare the same two readonly scopes the code requests.
Data Access is a declaration surface (used for verification review
and branded consent), not a runtime gate; Google honors whatever
the request asks for regardless of Data Access. Keeping the two
surfaces aligned is a hygiene requirement so the consent screen
truthfully advertises the app's data access and so future
verification review has an accurate scope list to certify. Data
Access must not list any Classroom write scope, and must not list
the two `PUBLICATION` scopes until the sprint that activates them
lands.

**Publishing status.** The OAuth app publishing status on
`lyfelabz-prod` is **In production** and this runbook does not
change that. Moving publishing status back to Testing for a
certification run would change production consent behavior and is
not authorized here. While publishing status is In production, the
consent screen's Test Users list is inert: any Google account can
attempt the flow, subject to the sensitive-scope caps below.

**OAuth verification posture.** The OAuth app is **not verified**
for the two Classroom readonly scopes. Sprint 24B §8 does not
claim verification is complete; this runbook inherits that non-
claim. Consequences:

- Certification (and any current production consent) will encounter
  Google's unverified-app warning ("Google hasn't verified this
  app") and the certifying teacher must click through it. The flow
  succeeds after the click-through.
- Google enforces a 100-user cap on sensitive-scope grants for
  unverified apps. Current onboarding is well under this cap; the
  cap is not a certification-blocking concern.
- **Broad teacher rollout must not be represented as ready until
  Google OAuth verification for the two readonly scopes is
  granted.** Verification is a separate prerequisite tracked
  outside this runbook. Certification proving the workflow works
  is not the same as verification proving the app can scale past
  the 100-user cap without the unverified-app warning.

Production and certification do NOT share OAuth clients. Two
separate OAuth 2.0 Web application clients exist on the
`lyfelabz-prod` Credentials page:

- **Production OAuth client** - the client already provisioned in
  Sprint 23F / Sprint 24A. Its authorized redirect URI is the
  production callback URL. Its client secret lives in
  `lyfelabz-prod` Secret Manager as
  `GOOGLE_CLASSROOM_CLIENT_SECRET` and is consumed only by the
  deployed Cloud Functions. Browser certification neither reads
  this secret nor modifies this client's redirect URI list.
- **Certification OAuth client** - a second Web application client
  named `LyfeLabz Local Certification`. Its only authorized
  redirect URI is the localhost callback that the emulator
  handshake uses (Section 4.3 fixes the exact value). It has no
  production redirect URI. Its client id and client secret are
  the values that populate the operator's local shell (or an
  ignored local env file) for the duration of a certification
  session. They are never written to Secret Manager, never
  committed to the repository, and never stored in any Firestore
  document (emulator or production).

**JavaScript origin.** The LyfeLabz OAuth handshake is a
server-side authorization-code flow. The Google OAuth server
redirects the browser to the authorized redirect URI; the token
exchange happens server-side (in the Functions emulator) using
the client secret. It does not use `gapi.auth2` or the browser-
side Google Identity Services client, both of which are the
consumers of the "Authorized JavaScript origins" field. The
certification OAuth client therefore does not require an
Authorized JavaScript origin. Leave that field empty when
creating the client. If a future change moves any part of the
OAuth flow to the browser (which Sprint 24B does not), that
change adds the field then.

**Production safety.** Because the emulator overrides the
Firestore, Auth, and Functions endpoints, no certification
callable, audit event, token bundle, or connection record ever
writes to `lyfelabz-prod` Firestore, Auth, or deployed Functions.
The only network traffic to Google is the OAuth token exchange
and the read-only Classroom REST calls against the two authorized
readonly scopes; both consume `lyfelabz-prod`'s Classroom API
quota and produce no writes to any Google Classroom resource.

The certification client id and client secret are captured for
the emulator provisioning step in Section 4.3.

### 1.5 Test Google accounts

- **Test teacher account.** A Google account the operator controls.
  This account owns the test Google Classroom course used for
  import and roster operations. While the OAuth app publishing
  status is In production (§1.4), the consent screen's Test Users
  list is inert and adding the account there has no effect; the
  account will encounter Google's unverified-app warning on first
  consent and must click through it.
- **Test student accounts (at least three).** Google accounts (or
  Google Workspace for Education accounts) enrolled as students in
  the test Google Classroom course. These need not be Test Users on
  the OAuth consent screen; only the teacher account authenticates.

### 1.6 Seed data (Firestore emulator)

Before Section 5 begins, the Firestore emulator must contain:

- `lmsProviders/googleClassroom` - the provider registry entry.
  Match the shape used in production per
  `LMS_INTEGRATION_OPERATIONS.md` §12. Minimum fields the client
  consults: `providerId: "googleClassroom"`, `enabled: true`, and
  the display metadata the Integrations surface renders.
- `districts/{districtId}` - one district record.
- `schools/{schoolId}` - one school under the district. The school
  document's `districtId` matches the district.
- `users/{teacherUid}` - the test teacher's user document with
  `role: "teacher"`, `districtId`, `schoolId`, and the `active`
  status expected by the identity boundary.
- `users/{studentUid}` - one document per **resolved** test student
  (per §1.7). `role: "student"`, matching `districtId` /
  `schoolId`. The `studentUid` is an arbitrary operator-chosen
  opaque string used as the mapping target; it is not the student's
  Google account id.
- `externalIdentities/{externalIdentityId}` - one document per
  **resolved** test student. The document id is the SHA-256 derived
  from `providerId = "google.com"` and `providerAccountId = <real
  Google account id>`. Fields carry the raw
  `providerAccountId`, the target `userId` (matching the student's
  `users/{studentUid}`), an `active` status, and a source label.
  The intentionally **unresolved** student receives no `users` seed
  and no `externalIdentities` seed.
- Firebase Auth Emulator: one user matching the teacher's UID, with
  a Google-provider link (created by signing in through the app on
  first launch, or seeded via the Auth Emulator UI). **Students do
  not need Firebase Auth Emulator user records** for Sprint 24B
  certification: no student signs into LyfeLabz during the six
  scenarios in Section 5. Only the teacher authenticates.

Seed procedure: use the Emulator UI at `http://localhost:4000` or a
one-shot Node script running against the Firestore emulator with
`FIRESTORE_EMULATOR_HOST=127.0.0.1:8080`. Do not attempt to seed
through the client - the client's own callables enforce the identity
boundary and will refuse teacher writes without an existing
`users/{uid}` document.

**Do not use the Firebase Auth Emulator as the source of a student
Google account identifier.** The Auth Emulator's mocked Google
sign-in produces a synthetic `providerData[i].uid` chosen by the
emulator (either random or operator-typed in the fake chooser).
That synthetic value does not equal the real Google account id
that the Sprint 24B roster reader receives from Google Classroom
during Scenario 3, and seeding `externalIdentities` from it would
leave every student unresolved. §1.7 documents the correct
extraction procedure for the real identifier.

### 1.7 Test classroom requirements

The test Google Classroom course owned by the test teacher must have:

- A stable course name and section (used to verify default-metadata
  writes at `needsSetup` time).
- At least three enrolled students. Two of the students will have
  `externalIdentities/{externalIdentityId}` documents pre-seeded in
  the Firestore emulator, so the roster sync can resolve them. At
  least one student will be intentionally unseeded, so the
  `unresolved` count is exercised.

**Canonical upstream identifier.** The identifier used as
`providerAccountId` (paired with `providerId = "google.com"`) is the
real Google Classroom roster identifier the adapter at
`platform/functions/src/lms/providers/google-classroom/adapter.ts`
reads as `student.profile.id` on the `courses.students.list`
response. This is Google's canonical opaque numeric account id;
across Google surfaces it also appears as the OIDC `sub` claim, as
`Student.userId` on the Classroom roster (identical to
`profile.id`), and as `providerData[i].uid` for the `google.com`
entry on a real Firebase Auth user record. The three values are
identical in production; the Auth Emulator's mocked
`providerData.uid` is NOT.

**Operator extraction procedure.**

- Preferred: use the Google APIs Explorer for `courses.students.list`
  at `https://developers.google.com/classroom/reference/rest/v1/courses.students/list`.
  Sign in as the test teacher, enter the `courseId` (the numeric
  segment of the Classroom course URL), optionally set `fields` to
  `students(userId,profile(id,emailAddress))`, execute, and read
  each student's `userId` and `profile.id` from the JSON response.
  APIs Explorer uses its own OAuth client (not the certification
  client, not the production client) and does not touch any
  LyfeLabz configuration.
- Confirm for every roster entry that `userId` equals `profile.id`.
  If they differ for a given entry, stop and report; the design
  invariant no longer holds and the extraction procedure needs
  investigation before seeding.
- Alternative: OAuth 2.0 Playground at
  `https://developers.google.com/oauthplayground/`, authorized for
  `https://www.googleapis.com/auth/classroom.rosters.readonly`,
  issuing `GET https://classroom.googleapis.com/v1/courses/<courseId>/students`.
- Record each identifier privately in the operator's transient
  scratch alongside the corresponding student email. Do not paste
  identifiers or emails into chat. Do not commit them. Do not place
  them in permanent project documentation. The email-to-identifier
  mapping exists only for the duration of the certification session
  and is discarded when certification completes.

**Fallback rules if extraction fails.**

- If APIs Explorer does not return the expected roster profile
  fields (account permissions, sensitive-scope prompts, or an
  unexpected API response shape), stop and switch to the OAuth 2.0
  Playground alternative or another real-Google API method that
  authenticates as the teacher.
- Do not guess identifiers.
- Do not use the Firebase Auth UID as a substitute (it is the
  mapping target, not the identifier).
- Do not use an emulator-generated `providerData.uid` as a
  substitute (it is synthetic and will not match Scenario 3's real
  roster response).
- Do not infer the identifier from an email address, a display
  name, or any other user-facing attribute.
- No active LyfeLabz link **in the emulator's Firestore** to a
  pre-existing test class. Because the emulator seed does not
  include any `lmsClassLinks` document, this is satisfied by
  starting the emulator with the seed defined in §1.6.
  Historical `lmsClassLinks` records in **production Firestore**
  (for example, from prior beta testing on a course that is being
  reused for certification) do not block certification: the
  emulator's Firestore is a physically separate database, and
  `lmsClassesImport`'s duplicate-detection guard at
  `platform/functions/src/lms/classes-import.ts` queries only the
  caller's Firestore (the emulator during certification). Record
  any known historical production link in the certification log
  as a documented exception; do not attempt to modify production
  Firestore from this runbook.

The two seeded student `externalIdentities` documents should point at
valid `users/{studentUid}` records with `role: "student"`, matching
the same `districtId` / `schoolId` as the teacher.

### 1.8 Local certification isolation guarantees

The certification exercises real Google Classroom OAuth against
Google but writes nothing to production Firebase. This subsection
codifies the six boundaries a future operator can verify without
re-deriving them. Every boundary is either mechanically enforced
by code that ships in this repository or is a documented operator
constraint enforced by §4 startup.

1. **The browser client talks to the local Functions emulator.**
   Enforced by `connectFunctionsEmulator("127.0.0.1", 5001)` in
   `app/src/index.ts` and `app/src/runtime/entry.ts`, gated on the
   `isEmulatorHost(win)` predicate in `app/src/firebase-config.ts`.
2. **Local Functions read and write the local Firestore emulator,
   not production Firestore.** Enforced by the Firebase Emulator
   Suite: when a Cloud Function runs under `firebase emulators:
   start`, the Admin SDK auto-detects `FIRESTORE_EMULATOR_HOST`,
   `FIREBASE_AUTH_EMULATOR_HOST`, and related env vars the emulator
   sets on the child process. No app code is required.
3. **The OAuth handshake reaches Google, but every LyfeLabz-side
   mirror write lands in the emulator only.** The OAuth token
   exchange is the only network egress; every subsequent
   `lmsConnections`, `lmsClassLinks`, `classes`, `enrollments`,
   and `auditEvents` write goes through the Admin SDK, which is
   emulator-bound per Boundary 2.
4. **No production Firebase configuration can accidentally receive
   certification writes.** Enforced by `isEmulatorHost` in
   `app/src/firebase-config.ts:75-79`, which returns `true` for
   exactly three hostnames: `localhost`, `127.0.0.1`, `0.0.0.0`.
   For any other hostname the client resolves to the production
   Firebase config. **Operator constraint:** §4.4 requires serving
   the app from `http://localhost:5000` specifically. Do not
   substitute a LAN IP, a `.local` mDNS host, `[::1]`, or any
   other alias.
5. **The local OAuth client credentials are used, not the
   production OAuth client secret.** Enforced by §4.3: the
   operator exports `GOOGLE_CLASSROOM_CLIENT_ID` and
   `GOOGLE_CLASSROOM_CLIENT_SECRET` from the certification client
   on `lyfelabz-prod` (Step 4 of the operator checklist), never
   from `lyfelabz-prod` Secret Manager.
6. **The local Firestore emulator starts empty for
   `lmsClassLinks`.** Enforced by §1.6: `lmsClassLinks` is not in
   the seed set. A historical production `lmsClassLinks` record
   for the same upstream Google Classroom course does not appear
   in the emulator and does not affect duplicate detection during
   certification.

Any deviation from these six boundaries invalidates the
certification. If a deviation is required by an unforeseen
environment constraint, stop and update this runbook before
proceeding.

---

## 2. Certification participants

- **Operator.** Executes every step in this runbook. Holds workstation
  access, the emulator seed, and the test teacher Google account
  credentials.
- **Test teacher (may be the operator).** Interacts with the browser
  in Section 5. If separate from the operator, must be physically
  present at the workstation - the runbook does not authorize remote
  teacher-driven certification.

A production deployment (Section 6) is executed by an operator holding
the IAM permissions listed in `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §2.

---

## 3. Pre-certification validation baseline

Execute in order. Any failure aborts certification.

1. **Repository state reviewed and intentional.**

   ```bash
   git status
   ```

   Sprint 24B browser certification occurs **before** the final
   Sprint 24B commit. A clean working tree is NOT a prerequisite at
   this stage; the sprint's own protocol forbids committing until
   certification passes, so the working tree will carry the entire
   Sprint 24B diff (typically ~78 files across `app/`,
   `platform/functions/`, `platform/firebase/`, and
   `docs/platform/`).

   What must be true instead:

   - Every modified or new file in `git status` is an intended
     Sprint 24B implementation, test, or documentation deliverable
     traceable to a Phase 1, Phase 2, or Phase 2B.1 through 2B.5
     completion report, or to this certification runbook itself.
   - No file appears that is unrelated, accidental, generated,
     temporary, or otherwise out of scope. Any such file must be
     resolved before the validation baseline runs (either reverted
     with a scoped `git checkout HEAD -- <path>` on that path only,
     or explicitly acknowledged in the certification log as being
     excluded from the eventual Sprint 24B commit).
   - No cleanup command with broader scope than a single named path
     (`git reset --hard`, `git checkout .`, `git restore .`,
     `git clean -fd`, `git stash`) may be run. Any such command
     could destroy uncommitted Sprint 24B work and is forbidden
     without explicit operator review of the exact scope.

   The final Sprint 24B commit is created only after Section 5
   browser certification passes. Every command in this section
   through Section 5 runs against the exact uncommitted working
   tree that will later become the certified commit; the tree does
   not change between validation, emulator startup, browser
   certification, and the commit that closes the sprint.

2. **Functions validation chain.**

   ```bash
   npm --prefix platform/functions run typecheck
   npm --prefix platform/functions run lint
   npm --prefix platform/functions test
   ```

   Expected baseline (per the Phase 2B.5 completion report):
   76 suites, 1406 tests, all green. Typecheck and lint clean.

3. **App validation chain.**

   ```bash
   npm --prefix app run typecheck
   npm --prefix app run lint
   npm --prefix app run lessons:verify
   npm --prefix app test
   ```

   Expected: typecheck, lint, and `lessons:verify` green. Tests
   report 48 of 49 suites passing (`curriculumManifest.test.ts` is
   the pre-existing R9 drift documented in the Phase 2B completion
   report; it is not a gating defect for Sprint 24B).

4. **App bundle build.**

   ```bash
   npm --prefix app run build
   ```

   Produces `app/dist/bundle.js`. Section 4.4 serves the bundle as
   part of the local static site.

5. **Functions build.**

   ```bash
   npm --prefix platform/functions run build
   ```

   Produces `platform/functions/lib/`.

If any step above fails, stop. Do not proceed to Section 4.

---

## 4. Local startup procedure

Every command below is run in a dedicated terminal tab. Leave each
process running for the duration of Section 5.

### 4.1 Terminal A - Firebase Emulator Suite

```bash
cd platform/firebase
firebase emulators:start
```

Wait until every emulator reports "started". The Emulator UI URL
(`http://localhost:4000`) appears at the bottom of the startup log.

Verification:

- Open `http://localhost:4000` in the browser. Every emulator card
  (Auth, Firestore, Functions, Storage) reports the green
  "Running" state.
- Cloud Functions load without emitting an installer-failure line.
  On cold start, `platform/functions` logs
  `lms.durableOAuthStateStoreInstalled` and
  `lms.durableTokenStoreInstalled` under the Functions emulator log.

### 4.2 Terminal B - Firestore seed

Once the emulators are running, load the seed data enumerated in
§1.6 and §1.7. Two options:

- **Emulator UI (manual).** Visit `http://localhost:4000/firestore`
  and add each document under the paths listed.
- **Seed script (repeatable).** Author a one-shot Node script under
  `scratchpad/` that uses `firebase-admin` against
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080` and
  `FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099`. Do not commit the
  script; certification does not authorize repository additions.

Verification:

- Firestore emulator UI shows `lmsProviders/googleClassroom`,
  `districts/{districtId}`, `schools/{schoolId}`,
  `users/{teacherUid}`, and the two pre-seeded
  `externalIdentities` documents.
- Auth emulator UI shows the teacher's user account.

### 4.3 Terminal C - OAuth parameters and secret

The Google Classroom callables require the OAuth client secret and
two typed parameters. Provide them to the Functions emulator via
environment variables. From `platform/firebase`:

```bash
export GOOGLE_CLASSROOM_CLIENT_ID="<certification-client-id-from-1.4>"
export GOOGLE_CLASSROOM_REDIRECT_URI="http://localhost:5000/app/lms-callback.html"
export GOOGLE_CLASSROOM_CLIENT_SECRET="<certification-client-secret-from-1.4>"
```

These values come from the **certification** OAuth client on
`lyfelabz-prod` (§1.4), never from the production OAuth client and
never from the `GOOGLE_CLASSROOM_CLIENT_SECRET` entry in
`lyfelabz-prod` Secret Manager.

The redirect URI must match the value authorized on the
certification OAuth client in Google Cloud Console exactly. The
value above is derived from the client at
`app/src/settings/integrations/wire.ts` (the constructor computes
`${win.location.origin}/app/lms-callback.html`; see the wire test
that asserts the `/app/lms-callback.html` suffix and forbids the
origin-root `/lms-callback.html` variant). Serving the app on
`http://localhost:5000` therefore produces the URI above. If the
client bundle serves from a port other than 5000, update both this
variable and the certification OAuth client entry so they agree.
Do not add the localhost URI to the production OAuth client.

If preferred, place the three exports in a git-ignored file (for
example `platform/firebase/.env.certification.local`, matching the
existing `**/.*` ignore pattern used by Firebase and the repo's
`.gitignore` conventions) and `source` it before starting the
emulator. Do not commit the file. Do not paste its contents into
chat.

Restart the emulator suite (Terminal A) after exporting these
variables so the Functions runtime picks them up. In development the
Functions emulator inherits the shell environment; if the emulator
was started before the exports, kill it and rerun `emulators:start`.

Verification:

- Functions emulator startup log does not report a missing-secret
  warning for any Google Classroom callable.
- Invoking `lmsProvidersList` from the browser (Section 5) returns
  the seeded Google Classroom entry.

### 4.4 Terminal D - Static site for `/app/**`

The emulator does not include Hosting. Serve the repository root as
static content on **`http://localhost:5000` only**. This hostname
is not a preference: the client's emulator-detection predicate at
`app/src/firebase-config.ts:75-79` (`isEmulatorHost`) returns true
for exactly `localhost`, `127.0.0.1`, and `0.0.0.0`. Any other
hostname (a LAN IP such as `192.168.1.10`, a `.local` mDNS name, a
DNS alias, IPv6 loopback `[::1]`, or any custom hosts-file entry)
causes the client to fall back to the production Firebase config,
which would send Auth and Firestore traffic to `lyfelabz-prod`.
That would violate §1.8 Boundary 4 and invalidate the
certification.

Any static server that serves the repository root at
`http://localhost:5000` works. Simple option using Python:

```bash
cd /Users/breezy/Documents/GitHub/lyfelabz
python3 -m http.server 5000 --bind 127.0.0.1
```

The `--bind 127.0.0.1` argument prevents the server from also
listening on the host's LAN interface, so a browser on another
device on the network cannot accidentally load the app under a
non-loopback hostname.

The `/app/**` route must resolve to `/app/index.html` so the router
in `app/src/router/surfaces/index.ts` handles deep links. Python's
`http.server` does not rewrite; for certification purposes, navigate
directly to `http://localhost:5000/app/index.html` at each step
below - do not deep-link to `/app/settings/integrations`. If a
rewrite-capable server is available (`npx serve -s .`), prefer that
so deep links work naturally.

Verification:

- `http://localhost:5000/app/index.html` renders the LyfeLabz
  authenticated shell (sign-in prompt visible if no session).

### 4.5 Terminal E (optional) - live logs

Optional but recommended: tail the Functions emulator log filtered
to LMS lines.

```bash
tail -f platform/firebase/firebase-debug.log \
  | grep -E "lms\.|classes\.|classesActivate|classesLmsCreate"
```

---

## 5. Browser certification

Six scenarios. Each has:

- **Preconditions** - state that must hold before the scenario begins.
- **Actions** - the exact steps the test teacher performs.
- **Expected UI** - what the browser must render at each step.
- **Expected Firestore changes** - what the Firestore emulator must
  contain after the scenario.
- **Expected callable invocations** - which callables the client
  invoked (visible in the Functions emulator log).
- **Expected audit events** - the `auditEvents` documents written
  during the scenario.
- **Pass criteria** - the affirmative test.
- **Failure indicators** - the negative test. Any single one aborts
  certification.

Record every scenario's outcome in a certification log (a scratch
file under `scratchpad/`, not committed) with timestamp, operator,
scenario id, pass/fail, and screenshot filenames.

### 5.1 Scenario 1 - Manual Create

**Preconditions**

- Test teacher signed in at
  `http://localhost:5000/app/index.html`.
- Test teacher has zero LyfeLabz classes at start
  (`classes` collection filtered by `teacherId == <teacherUid>` is
  empty in the emulator).

**Actions**

1. Navigate to the Classes surface.
2. Choose "Create class".
3. Enter a class name (any short string). Enter a Grade (choose a
   value from the closed set - Grade 7 recommended). Enter a Block
   (any value from the closed set, e.g. A).
4. Submit.

**Expected UI**

- Success confirmation; the new class appears in the class list.
- The class card shows the teacher-entered grade and block, not
  `"7"` and not `"A"` unless the teacher entered them.

**Expected Firestore changes**

- One new document under `classes/{classId}` with:
  - `status: "active"`
  - `grade` matches the teacher-entered value.
  - `block` matches the teacher-entered value.
  - `joinCode` present (server-issued).
  - `teacherId` matches the signed-in teacher.
  - `districtId` / `schoolId` inherited from the teacher.

**Expected callable invocations**

- Exactly one `classesCreate` call in the Functions log.

**Expected audit events**

- One `auditEvents` document of kind `class.created` referencing
  the new `classId`.

**Pass criteria**

- The classes list contains the newly created class.
- Firestore fields match teacher-entered metadata exactly.
- No `needsSetup` status anywhere.

**Failure indicators**

- The class writes `grade: "7"` or `block: "A"` when the teacher
  entered a different value (Phase 2B.4 default-metadata regression).
- `status: "needsSetup"` on a manually created class.
- Missing or empty `joinCode`.

### 5.2 Scenario 2 - Google Classroom Import to Setup

**Preconditions**

- Test teacher signed in.
- Google Classroom is not yet connected in the Integrations surface
  (`lmsConnections` for the teacher is absent or in a disconnected
  state).
- The test Google Classroom course (§1.7) is not yet linked to any
  LyfeLabz class.

**Actions**

1. Navigate to Settings -> Integrations.
2. Choose "Connect Google Classroom".
3. Complete the OAuth handshake in the popup / redirect. Choose the
   test teacher account. Approve the two Classroom scopes.
4. Back in the Integrations surface, open the class import dialog.
5. Choose "Import a Google Classroom class" (the default flow per
   Sprint 24B §3.1).
6. Select the test Google Classroom course from the list.
7. Confirm the import.

**Expected UI**

- OAuth completion returns to the Integrations surface with the
  connection reported as active.
- The course list renders course name and enrollment count.
- After confirming import, the teacher lands on the newly created
  LyfeLabz class workspace. The workspace displays a "Finish setting
  up this class" affordance (Phase 2B.3 - the class is
  `needsSetup`).

**Expected Firestore changes**

- One new `lmsConnections/{connectionId}` document for the teacher,
  provider `googleClassroom`, state active.
- One new `lmsTokenBundles/{tokenRef}` document (token custody).
  Token material is not readable client-side; presence-only check
  via the emulator UI.
- One new `classes/{classId}` document with:
  - `status: "needsSetup"`
  - `grade` and `block` absent or null (deferred to activation).
  - `joinCode` absent (deferred to activation, per ADR §7.4 as
    corrected in Phase 2B.5).
  - `lmsProvider: "googleClassroom"`, `lmsCourseId` matches the
    imported course.
- One new `lmsClassLinks/{linkId}` binding the LyfeLabz class to the
  Google Classroom course.

**Expected callable invocations**

- `lmsConnectionsBegin`
- `lmsConnectionsComplete`
- `lmsClassesDiscover` (course list)
- `lmsClassesImport` (the link write)
- `classesLmsCreate` (creates the `needsSetup` class)

The exact ordering matches the client's import orchestration; every
call must return success.

**Expected audit events**

- `lms.connectionAuthorized` on OAuth completion.
- `class.created` (or the equivalent kind used by
  `classesLmsCreate` - verify against the current
  `assignments/classes-lms-create.ts` audit call).
- `lms.classLinked` on the successful link.

Roster sync does NOT run in this scenario (Sprint 24B blueprint
§9.2.3 Option B: a `needsSetup` class never synchronizes; sync
sequences after activation).

**Pass criteria**

- The `needsSetup` class is present in Firestore with the shape
  above.
- No roster sync ran (no `lms.rosterSynchronized` audit event, no
  new enrollment documents).
- The class workspace renders and shows the setup affordance.

**Failure indicators**

- Any `enrollments/{...}` document for this class exists after
  import (roster sync ran prematurely).
- `classes/{classId}` writes `status: "active"` (skipped the setup
  seam entirely).
- `grade: "7"` or `block: "A"` written on the `needsSetup` document
  (Phase 2B.4 default-metadata regression at the LMS write site).
- `joinCode` present on the `needsSetup` document (join-code
  premature generation).
- OAuth completion fails with `lms.upstreamAuthorizationFailed`
  (redirect URI mismatch - correct per §4.3).

### 5.3 Scenario 3 - Finish Setup to Activation

**Preconditions**

- Scenario 2 completed successfully.
- The `needsSetup` class from Scenario 2 exists.

**Actions**

1. On the class workspace (or wherever the "Finish setting up"
   affordance surfaces), choose it.
2. Enter a Grade (closed-set value) and Block (closed-set value).
3. Submit activation.

**Expected UI**

- Success confirmation.
- The class workspace re-renders as an active class: the roster
  view is visible, "Sync roster" and (conditionally) "Reconnect
  provider" header actions appear per Sprint 24B §3.2 and §3.6.
- On completion, the initial roster sync runs and a sync summary
  panel appears with counts: `added` = number of resolved students,
  `reactivated: 0`, `unchanged: 0`, `withdrawn: 0`, `unresolved` =
  count of upstream students without a matching
  `externalIdentities` entry, `skipped: 0`,
  `upstreamRosterEmpty: false`.

**Expected Firestore changes**

- The class document transitions atomically to:
  - `status: "active"`
  - `grade` matches teacher input.
  - `block` matches teacher input.
  - `joinCode` present (server-issued at activation).
- `enrollments/{enrollmentId}` documents appear for each resolved
  student, each with `status: "active"`, `classId` matching the
  activated class, `studentId` matching the resolved user document.
- Unresolved students produce no `enrollments` writes.

**Expected callable invocations**

- Exactly one `classesActivate` call, returning success.
- Exactly one `lmsClassesSyncRoster` call, invoked by the client
  after `classesActivate` returns (Sprint 24B §3.2).

**Expected audit events**

- One `class.activated` (or the exact kind used by
  `classesActivate` - verify against the callable).
- Exactly one `lms.rosterSynchronized` event for the initial sync.

**Pass criteria**

- Atomic transition observed: the class never appears as `active`
  with `grade` / `block` / `joinCode` unset.
- Roster sync ran exactly once and produced the expected counts.
- The `unresolved` count matches the intentionally unseeded student
  count from §1.7.
- No provider account identifier, Google email, Google display name,
  or OAuth token appears in the sync summary UI, in any client
  console log, in any structured Cloud Logging line, or in any
  audit event payload.

**Failure indicators**

- The class writes `status: "active"` before `grade` / `block` /
  `joinCode` are set (non-atomic activation).
- `enrollments` documents appear for unresolved upstream students.
- Two or more `lms.rosterSynchronized` events for a single
  activation (duplicate sync trigger).
- The sync summary UI shows a Google email, `provider.sub`, or
  display name.
- `classesActivate` returns an unexpected error against valid input.

### 5.4 Scenario 4 - Reload During Setup

**Preconditions**

- Repeat Scenario 2 to produce a fresh `needsSetup` class (or use
  Scenario 2's class if it has not yet been activated).

**Actions**

1. On the setup form (Grade / Block fields), do NOT submit.
2. Reload the browser tab (Cmd-R / Ctrl-R).
3. Observe the workspace after reload.

**Expected UI**

- The class workspace re-renders and again shows the "Finish setting
  up" affordance. The setup form is presented, not the active
  roster view.
- No error state.

**Expected Firestore changes**

- None. The class remains `status: "needsSetup"`. No
  `classesActivate` call was made.

**Expected callable invocations**

- Reads only. No mutation callables invoked.

**Expected audit events**

- None new.

**Pass criteria**

- Setup is recoverable across a full page reload. The teacher can
  now complete Scenario 3 against this class.

**Failure indicators**

- Reload lands on the active-class roster view (client cached
  activation state incorrectly).
- Reload lands on a broken / empty state.
- Any callable side-effect is recorded during the reload.

### 5.5 Scenario 5 - Activation Failure

**Preconditions**

- A `needsSetup` class exists (create one via Scenario 2 if needed).

**Actions - Path A (invalid input)**

1. On the setup form, submit with a Grade value outside the closed
   set. If the client blocks the submit at the field level, use
   DevTools to bypass the client validation and force the callable
   to reject.

**Actions - Path B (transient error)**

1. Use Chrome DevTools -> Network to throttle to Offline (or block
   the Functions origin for a single request).
2. Submit activation with valid Grade / Block.

**Expected UI - Path A**

- The class remains on the setup form. An error message surfaces
  the invalid-grade rejection. The class workspace does not
  re-render as active.

**Expected UI - Path B**

- The setup form displays a transient error and remains editable.
- Restoring the network and re-submitting completes activation
  successfully (Scenario 3 outcome).

**Expected Firestore changes**

- Path A: none. Class remains `status: "needsSetup"`.
- Path B: none until the successful retry.

**Expected callable invocations**

- Path A: one `classesActivate` invocation that returns an
  `invalidGrade` (or `invalidBlock`) rejection.
- Path B: one `classesActivate` invocation that fails at the
  transport, then one successful invocation on retry.

**Expected audit events**

- Path A: no `class.activated` event. A failed-invocation audit
  event may or may not be emitted depending on the callable's
  contract; verify against `classes-activate.ts` and record whichever
  outcome is documented.
- Path B: `class.activated` only on the successful retry.

**Pass criteria**

- Failed activation leaves the class in `needsSetup` intact.
- The teacher can retry without any loss of state.
- No partial write (e.g. `grade` set but `status` still
  `needsSetup`).

**Failure indicators**

- The class transitions to `active` after a rejected activation.
- The class transitions to a corrupt state (partial fields written).
- The client crashes and cannot recover on retry.

### 5.6 Scenario 6 - Keyboard and Accessibility

Executed against the surfaces exercised in Scenarios 1 through 3.

**Actions**

1. Sign out and sign back in using keyboard only.
2. Navigate to Classes, open the Create Class form, complete
   Scenario 1's flow using Tab / Shift-Tab / Space / Enter only.
3. Navigate to Settings -> Integrations using keyboard only. Open
   the import dialog. Navigate through the course list with arrow
   keys.
4. Complete Scenario 3's activation form using keyboard only.
5. Trigger the class workspace's "Sync roster" header action with
   Enter.
6. Confirm focus rings are visible at every focusable control.

**Expected UI**

- Every interactive control is reachable via Tab in a logical
  order.
- Focus indicators are visible on every control (no `outline: none`
  without a visible replacement).
- Modal dialogs (Create Class, Import Course) trap focus until
  dismissed and return focus to the invoking control on close.
- Form errors are announced (each error message is associated with
  its field via `aria-describedby` or is rendered within the field's
  labeled region).

**Expected callable invocations**

- Same callables as Scenarios 1 and 3, driven by keyboard rather
  than pointer.

**Expected audit events**

- Same as Scenarios 1 and 3 for the corresponding flows.

**Pass criteria**

- Every scenario above (1, 2, 3, and the Sync roster action) is
  completable without a mouse.
- No focus trap escapes a modal.
- No keyboard operation loses focus into the document body.

**Failure indicators**

- Any control cannot be reached with Tab.
- Focus disappears (no visible ring, no `document.activeElement`).
- A modal traps focus permanently (cannot be dismissed with Escape
  or a Close control).
- Form errors are not announced.

### 5.7 Certification decision

Every scenario in §5.1 through §5.6 must pass. If any single
failure indicator triggers, certification is not granted. Record
the failure in the certification log, do not proceed to Section 6,
and open a defect against the responsible callable or surface.

If all six scenarios pass, record the certification in a
supplementary document (e.g.
`docs/platform/SPRINT_24B_PHASE_2B_BROWSER_CERTIFICATION.md`) and
proceed to Section 6.

---

## 6. Production deployment readiness checklist

Deployment is not authorized unless every item below is true. This
list is additive to `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §7; both
apply.

1. **Sprint 24B certification recorded.** Section 5 passed and
   evidence is written to a Sprint 24B browser-certification
   document. Certification is a hard prerequisite (Phase 2B
   completion report, Operational Readiness).
2. **Sprint 24A certification on record.** Verify
   `SPRINT_24A_COMPLETION_REPORT.md` is present and certifies the
   Sprint 24A infrastructure.
3. **Repository state clean.** `git status` on the deploying
   workstation reports a clean working tree at the certified commit.
4. **Firebase CLI project binding correct.** `firebase use` reports
   `lyfelabz-prod`. Mismatch aborts.
5. **IAM sanity.** The deploying principal holds the roles listed
   in `SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §2 on `lyfelabz-prod`.
6. **Google Cloud APIs enabled.** Every API listed in Sprint 23F §3
   is enabled on `lyfelabz-prod`.
7. **Production Secret Manager provisioned.**
   `GOOGLE_CLASSROOM_CLIENT_SECRET` set on `lyfelabz-prod` per
   Sprint 23F §4. `firebase functions:secrets:access
   GOOGLE_CLASSROOM_CLIENT_SECRET` returns the current version
   metadata. This is the production OAuth client secret, not the
   certification client secret from §1.4.
8. **Production typed parameters provisioned.**
   `GOOGLE_CLASSROOM_CLIENT_ID` and `GOOGLE_CLASSROOM_REDIRECT_URI`
   set on `lyfelabz-prod` per Sprint 23F §5. The redirect URI
   matches the value corrected in Sprint 24A
   (`SPRINT_24A_COMPLETION_REPORT.md`).
9. **Production `lmsProviders/googleClassroom` seed present.**
10. **Functions validation baseline green** on the deploy commit
    (Section 3 above; matches `SPRINT_23F_DEPLOYMENT_RUNBOOK.md`
    §14 expected baseline plus the Sprint 24B increment recorded in
    the Phase 2B.5 completion report: 76 suites / 1406 tests).
11. **App validation baseline green** on the deploy commit
    (Section 3 above).
12. **Rollback commit identified.** The prior known-good commit
    (the last commit whose deploy passed Section 7 verification) is
    identified in writing. Its SHA is recorded on the deployment
    ticket before deploy begins.
13. **Firestore indexes reviewed.** Any additive index Sprint 24B
    introduced (per Sprint 24B §4 non-goal boundary: additive only
    and documented in `platform/firebase/firestore.indexes.json`)
    is present in the repository.
14. **Firestore Rules unchanged for enrollments / classes / users /
    attempts / submissions / assessments** (per Sprint 24B §4
    non-goal). Verify with `git diff` against the prior deploy commit
    on `platform/firebase/firestore.rules`.
15. **OAuth production consent screen posture.** The production
    OAuth app's verification status is unchanged from Sprint 24A
    (Sprint 24B §8 does not claim OAuth verification is complete).
    If the app is still in Testing, the production teacher list on
    the OAuth consent screen matches the operational owner list.
16. **Runbook readership acknowledged.** The deploying engineer has
    read this runbook, `SPRINT_23F_DEPLOYMENT_RUNBOOK.md`, and
    `LMS_INTEGRATION_OPERATIONS.md` §7, §8, §13.

An unmet item is a gating defect. Resolve before deploying.

---

## 7. Production deployment steps

Sprint 24B deployment is scoped to Firestore Rules (redeploy of the
current file, no behavioral change), Functions (the callable
increment - `classesLmsCreate`, `classesActivate`,
`teacherPreferencesUpdate`, and the eligibility-helper adoption in
existing callables), and Hosting (the updated `app/dist/bundle.js`
and any lesson pages).

Every command runs from `platform/firebase` unless otherwise noted.
Every command targets the currently bound Firebase project (verify
with `firebase use` before each step).

### 7.1 Functions

1. Verify the currently deployed Functions inventory before the
   change so any function that disappears is visible:

   ```bash
   firebase functions:list
   ```

   Save the output to the deployment ticket.

2. Deploy the Functions surface:

   ```bash
   firebase deploy --only functions
   ```

   The CLI prompts for any unset typed parameter (should not occur
   if §6 step 8 is complete). Watch for build failures - the deploy
   is transactional at the function level. Confirm the summary lists
   the Sprint 24B callables (`classesLmsCreate`, `classesActivate`,
   `teacherPreferencesUpdate`) and confirm no stale function is
   deleted that the runbook did not intend to delete.

3. Confirm the deploy completed without error and record the
   deploy log excerpt on the deployment ticket. This is the first
   rollback point - after this step, rollback is a redeploy of the
   prior commit per Section 8.

### 7.2 Firestore Rules

Sprint 24B does not change enrollments / classes / users / attempts
/ submissions / assessments rules. The Phase 2B specification allows
only the teacher-preference subdoc addition (verify with
`git diff` against the prior deploy commit).

If any Rules diff exists on this deploy commit:

```bash
firebase deploy --only firestore:rules
```

If `git diff` shows no Rules change against the prior deploy, skip
this step. Deploying identical rules is a no-op but wastes a
deployment slot.

### 7.3 Firestore indexes

Sprint 24B authorizes only additive index changes documented in
`platform/firebase/firestore.indexes.json`. If an additive index
was added:

```bash
firebase deploy --only firestore:indexes
```

Index builds may take minutes; the deploy returns before the build
completes. Do not proceed to §7.5 verification of any query that
depends on the new index until the Firebase Console reports the
index as "Enabled".

If no index changed on this deploy commit, skip this step.

### 7.4 Hosting

The `hosting` block in `platform/firebase/firebase.json` publishes
the repository root (with the `platform/`, `docs/`, `blog/`, and
`lesson-sources/` directories ignored). The Sprint 24B app bundle
must be built before deploying Hosting.

1. From the repository root:

   ```bash
   npm --prefix app run build
   ```

   Confirm `app/dist/bundle.js` is produced fresh.

2. Deploy Hosting:

   ```bash
   cd platform/firebase
   firebase deploy --only hosting
   ```

3. Note the deploy URL from the CLI output. This is the second
   rollback point. Hosting rollback is a Console-level "Roll back"
   action or a redeploy of the prior bundle per Section 8.

### 7.5 OAuth verification posture (documentation-only)

Sprint 24B §8 explicitly does not claim OAuth verification is
complete. If the app is still in Testing status and a production
teacher outside the Test Users list is expected to onboard, deploy
does not authorize that onboarding. Record the current OAuth app
verification status on the deployment ticket.

### 7.6 Smoke tests

Run against the production surface immediately after deploy.

1. **Function inventory.**

   ```bash
   firebase functions:list
   ```

   Every Sprint 24B callable (`classesLmsCreate`, `classesActivate`,
   `teacherPreferencesUpdate`) is present. No stale function remains
   that is not declared in `platform/functions/src/index.ts`.

2. **Cold-start structured logs.** In Cloud Logging, filter to the
   deploy's Functions revisions. Confirm each function that touches
   the LMS durable-storage installer emits
   `lms.durableOAuthStateStoreInstalled` and
   `lms.durableTokenStoreInstalled` on its first invocation.

3. **`lmsProvidersList` smoke.** From an authenticated operator
   session on production, invoke `lmsProvidersList` (via the
   Integrations surface). Returns the seeded Google Classroom
   provider entry.

4. **Manual Create smoke** (production analogue of Scenario 1).
   Using an operational teacher account, create a throwaway class
   with a distinctive name. Verify the class writes with the
   teacher-selected metadata (no `"7"` / `"A"` defaults). Delete
   the throwaway class or archive it after the smoke completes.

5. **Do not run the Google Classroom Import smoke against a live
   student roster.** The Sprint 24B production verification
   (Sprint 24B §6) is a teacher-supervised, controlled, single-class
   exercise; it is out of scope for the deploy runbook. Sequence it
   separately with pre-test enrollment counts captured.

Smoke tests are the third rollback point. Failure of any smoke
triggers Section 8.

---

## 8. Post-deployment verification

Execute within the first two hours after deploy.

1. **Cloud Logging clean.** Filter to Sprint 24B callables
   (`classesLmsCreate`, `classesActivate`, `teacherPreferencesUpdate`)
   and confirm no error-level entries in the first hour after
   deploy.
2. **Audit event stream healthy.** Query `auditEvents` for the
   first hour after deploy: `class.activated`, `class.created`, and
   `lms.rosterSynchronized` events (if any real teacher activity
   occurred) are well-formed and never carry provider account
   identifiers, Google emails, Google display names, or OAuth
   tokens.
3. **No Firestore Rules denials on Sprint 24B paths.** Filter
   Cloud Logging for `FirebaseFirestoreRulesDenied` in the first
   hour and confirm none point at Sprint 24B write paths (class
   activation, teacher preference update).
4. **No orphaned `needsSetup` classes accumulating.** In Firestore,
   query `classes` filtered by `status == "needsSetup"` and
   `createdAt` older than two hours. Under normal use these decay
   to zero as teachers complete activation. A rising count over
   days is a UX regression worth investigating.
5. **Hosting bundle content correct.** Load
   `https://<production-host>/app/index.html` in an incognito window
   and confirm the deployed bundle is served (compare the bundle
   hash / a distinctive Phase 2B marker to the deploy artifact).
6. **Rollback readiness confirmed.** The prior known-good commit
   identified in §6 step 12 is still buildable on the deploying
   workstation.

Record every verification result on the deployment ticket.

---

## 9. Rollback procedure

Rollback is invoked when Section 7.6 smoke fails, Section 8
verification surfaces a live defect, or a Sprint 24B behavior
regression is observed within the rollback window.

The rollback boundary follows Sprint 24B §7 and Sprint 23F §11:

- Rollback is a redeploy of the prior known-good commit. Cloud
  Functions v2 does not support in-place version rollback.
- Rollback never deletes a `lmsConnections`, `lmsClassLinks`,
  `lmsTokenBundles`, `externalIdentities`, `auditEvents`, or
  `enrollments` document.
- Rollback of a client-invoked sync that produced unexpected
  reconciliation counts is not a Firestore mutation - the
  reconciliation contract is the certified engine outcome; a
  disagreement is a design defect, not corruption.

Procedure:

1. **Halt further deploys.** Announce the rollback on the
   deployment ticket and pause any queued deploy.
2. **Identify the prior known-good commit.** Read the SHA recorded
   on the deployment ticket per §6 step 12.
3. **Check out the prior commit on the deploying workstation.**

   ```bash
   git checkout <prior-commit-sha>
   ```

4. **Re-run the pre-deploy validation baseline** per Section 3 on
   the prior commit. Everything green.
5. **Re-run the deployment steps 7.1 (Functions) and 7.4
   (Hosting)** against `lyfelabz-prod`. Skip Rules and indexes
   unless their diff at the failing deploy included changes -
   additive indexes are safe to leave in place across rollback.
6. **Re-run Section 7.6 smoke tests.** Confirm the rolled-back
   surface is healthy.
7. **Record the rollback** on the deployment ticket: failing
   commit SHA, restored commit SHA, initiating principal, and
   timestamps.
8. **Retain the failing commit** in the git history. Do not
   force-push. The failing commit is the input to the follow-up
   defect ticket.

Client-only defects (a bug in the class workspace or Integrations
surface) may be rolled back with a Hosting-only redeploy. Do not
skip Section 3 validation on the rollback commit even for a
Hosting-only rollback - the prior known-good bundle must build
clean on the rollback workstation.

Do not attempt to hand-mutate any Firestore document during
rollback. If a data-level remediation is required, escalate per
`PLATFORM_OPERATIONS_SPECIFICATION.md` and
`SPRINT_23F_DEPLOYMENT_RUNBOOK.md` §13.

---

## 10. Non-goals

This runbook does not:

- Authorize any production mutation beyond deployment and the
  post-deploy smoke and verification steps in Sections 7.6 and 8.
- Authorize the Sprint 24B production verification exercise
  described in Sprint 24B §6 - that is a separate, teacher-
  supervised, single-class exercise with its own pre-test
  enrollment capture.
- Change any callable's contract or add or remove Firestore
  collections.
- Rotate any secret (secret rotation follows
  `LMS_INTEGRATION_OPERATIONS.md` §8.1).
- Modify Firestore Rules for enrollments, classes, users, attempts,
  submissions, or assessments (Sprint 24B §4 non-goal).
- Onboard production teachers who are not on the OAuth Test Users
  list while the app remains in Testing.
- Authorize Sprint 24C or later work.

---

*End of runbook. Every procedure in this document reads or deploys
existing artifacts; nothing here mutates production state beyond
the deployment itself and the smoke and verification steps.*
