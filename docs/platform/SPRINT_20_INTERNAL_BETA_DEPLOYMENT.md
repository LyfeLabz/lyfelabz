# Sprint 20 - Internal Beta Deployment

## 1. Executive Summary

The LyfeLabz platform is deployed to Firebase project `lyfelabz-prod` at
`https://lyfelabz-prod.web.app`. Hosting serves the full repository
including the four migrated v2 lessons (Earth's Layers, Plate
Tectonics, Water Cycle, Earthquakes). All 42 Cloud Functions callables
and the `authOnUserCreate` trigger are deployed to `us-central1`.
Firestore rules and indexes are applied. Storage rules are applied.

The internal beta is reachable in a browser. Two manual steps remain
before an end-to-end teacher walkthrough succeeds: enabling the Google
sign-in provider in the Firebase Console, and running the
`bootstrap-beta-teacher` script to activate the owner account. Both
are documented below.

## 2. Pre-deployment State

- `platform/firebase/firebase.json` used `public: "../.."`, which the
  modern Firebase CLI rejects as being outside the config directory.
- `.firebaserc` and `PROJECT_ID` (in `app/src/firebase-config.ts`)
  named `lyfelabz-platform`, which is not accessible from the
  repository owner's Firebase account.
- No `window.__lyfelabzFirebaseConfig` injection point existed.
- No Firebase web app was registered against `lyfelabz-prod`.
- No functions predeploy build hook, so Cloud Build could not find
  `lib/index.js`.
- Modified working-tree files present from unrelated HQIM work (seven
  HTML files); left untouched by this sprint.

## 3. Firebase Project and Environment

- Project id: `lyfelabz-prod`
- Project number: `182791689935`
- Web app id: `1:182791689935:web:047a9e33cc45b9567809ba`
- Web app display name: `lyfelabz-beta-web`
- Hosting site: `lyfelabz-prod` -> `https://lyfelabz-prod.web.app`
- Functions region: `us-central1`
- Billing plan: Blaze (confirmed by repo owner)

## 4. Hosting Architecture

A new top-level `firebase.json` and `.firebaserc` were added at the
repository root so that the deploy runs with the working tree as the
Hosting public directory. `platform/firebase/firebase.json` is
preserved as the canonical emulator-suite configuration for local
development; the root config is for deploy.

Root `firebase.json` highlights:

- `hosting.public`: `.` (repository root)
- `hosting.ignore`: excludes `platform/**`, `docs/**`, `blog/**`,
  `lesson-sources/**`, `mission-control/**`, `wonderbox/**`,
  root-level Apps Script `.js` files, all `.md` files, and node
  metadata. Everything else in the tree is served.
- `hosting.rewrites`: `/app/** -> /app/index.html`. Real files under
  `/app/lessons/` are matched by Hosting before the rewrite is
  evaluated, so direct v2 lesson URLs resolve correctly.
- `functions[0].source`: `platform/functions`
- `functions[0].predeploy`: `npm --prefix "$RESOURCE_DIR" run build`

Firestore rules, indexes, and storage rules point at the canonical
files under `platform/firebase/`.

## 5. Frontend Build and Asset Wiring

Two build outputs are shipped to Hosting:

- `/app/dist/bundle.js` -- built by `npm --prefix app run build`
  (esbuild, ESM, es2022). Loaded by `/app/index.html`.
- `/assets/lyfelabz-assessment-runtime-active.js` -- built by
  `npm --prefix app run build:runtime` (esbuild, IIFE, es2020).
  Loaded lazily by `/assets/lyfelabz-assessment-runtime.js` when a
  lesson URL carries `?assignment=<id>`.

The public Firebase Web SDK configuration is delivered to both entry
points via a global `window.__lyfelabzFirebaseConfig`:

- `/app/index.html` loads `/assets/lyfelabz-firebase-config.js`
  before the shell bundle.
- `/assets/lyfelabz-assessment-runtime.js` sets the same global
  inline at the top of its IIFE so every v1 and v2 lesson page that
  already includes the shim gets it for free.

The Firebase Web SDK config is a public identifier bundle, not a
secret. Firebase Auth allowlists and the certified Firestore /
Storage rules enforce access.

## 6. V2 Lesson Deployment Paths

Confirmed live URLs:

- `https://lyfelabz-prod.web.app/app/lessons/lesson_earths-layers.html`
- `https://lyfelabz-prod.web.app/app/lessons/lesson_plate-tectonics.html`
- `https://lyfelabz-prod.web.app/app/lessons/lesson_water-cycle.html`
- `https://lyfelabz-prod.web.app/app/lessons/lesson_earthquakes.html`

These match the paths declared in
`app/src/assignments/studentList/launchOverrides.ts`.

## 7. Authentication Configuration

- Sign-in provider expected by the client: Google.
- Authorized domains that Hosting URLs land on:
  `lyfelabz-prod.web.app` and `lyfelabz-prod.firebaseapp.com`
  (both added to the Firebase Auth authorized-domains list by
  default when the project was created).
- `authOnUserCreate` provisions a `users/{uid}` document with
  `status: "provisioned"` on first sign-in.
- Teacher activation normally moves through
  `provisioned -> pendingVerification -> active` via
  `teachersRequestVerification` and `teachersApproveVerification`.
  The approval callable requires the caller to hold the
  `platformAdministrator` custom claim. Since no bootstrap
  administrator exists in a fresh project, an admin script
  performs the initial activation directly.

## 8. Firestore, Storage, Functions Deployment

Deployed:

- Firestore rules: `platform/firebase/firestore.rules`
- Firestore indexes: `platform/firebase/firestore.indexes.json`
- Storage rules: `platform/firebase/storage.rules`
- All 41 callables and the `authOnUserCreate` trigger from
  `platform/functions/src/index.ts`.
- The bootstrap script `bootstrap-beta-teacher.ts` compiles as part
  of the functions build but is NOT exported from `index.ts`, so it
  is not deployed as a callable. It runs locally against ADC.

## 9. Validation Results

Pre-deployment:

- `npm --prefix app run lessons:verify` -- PASS (all 4 lessons)
- `npm --prefix app run typecheck` -- PASS
- `npm --prefix app test` -- 692/692 tests PASS
- `npm --prefix app run build` -- PASS
- `npm --prefix app run build:runtime` -- PASS
- `npm --prefix platform/functions run build` -- PASS
- `npm --prefix platform/functions test` -- 953/953 tests PASS

## 10. Deployment Commands and Results

```
firebase apps:create WEB "lyfelabz-beta-web" --project lyfelabz-prod
firebase apps:sdkconfig WEB <appId> --project lyfelabz-prod
firebase deploy --project lyfelabz-prod --only "firestore:rules,firestore:indexes,hosting,storage"
firebase deploy --project lyfelabz-prod --only "functions" --force
```

Results:

- Firestore rules: deployed
- Firestore indexes: deployed
- Storage rules: deployed
- Hosting: 4152 files uploaded, release complete
- Functions: 42 create/update operations all successful
- Artifact Registry cleanup policy: configured (1 day)

## 11. Live URL

`https://lyfelabz-prod.web.app`

Teacher shell: `https://lyfelabz-prod.web.app/app/`

## 12. Automated Smoke-Test Results

- `GET /` -> 200 (public catalog index.html)
- `GET /app/` -> 200 (teacher shell)
- `GET /app/lessons/lesson_earths-layers.html` -> 200
- `GET /assets/lyfelabz-assessment-runtime.js` -> 200
- `GET /assets/lyfelabz-firebase-config.js` -> 200
- Browser load of `/app/` -> "Sign in to LyfeLabz." with a
  "Continue with Google" button. No console errors.
- Browser load of the Earth's Layers v2 URL -> lesson renders in
  standalone mode. No console errors.

## 13. Manual Internal-Beta Walkthrough

See "Final Response" in the sprint chat for the numbered walkthrough.

## 14. Known Limitations

- Google sign-in provider must be enabled once in the Firebase
  Console. This is a Console-only setting; no CLI toggle exists.
- The client `activeAdministrator` surface is a stub and offers no
  admin actions. All administration (teacher approval, school
  creation) currently runs via callables or the local bootstrap
  script.
- No student self-signup flow is wired to the beta yet; test
  students are provisioned by having the second Google account sign
  in and then joining a class via a class code (the class code
  workflow uses `enrollmentsJoinByCode`).
- LMS integrations (Google Classroom, Schoology, Canvas) are not
  configured on this project; the Settings > Integrations panel
  will show them as unavailable, which is the correct behavior for
  an internal beta.
- Custom domain `www.lyfelabz.com` continues to serve the GitHub
  Pages version. The beta is intentionally isolated to
  `lyfelabz-prod.web.app`.

## 15. Test-Data Safety

Everything created in the beta lives in production `lyfelabz-prod`
Firestore. Recommended safety conventions:

- School id: `school-beta` (created by the bootstrap script)
- District id: `district-beta`
- Class titles: prefix with `BETA TEST - `
- Assignment titles: prefix with `BETA TEST - `

To clean up later, the beta school can be identified by its
`district: "district-beta"` field, and all classes and assignments
under it can be batch-archived (assignments and classes each expose
an archive callable). No destructive cleanup tool is added in this
sprint.

## 16. Rollback Procedure

Hosting: `firebase hosting:clone lyfelabz-prod:<previous-version> lyfelabz-prod:live --project lyfelabz-prod`
(or from the Firebase Console -> Hosting -> Release history -> Rollback).

Functions: `firebase functions:delete <name> --project lyfelabz-prod --region us-central1`
per function. No production traffic other than the beta is on this
project today, so deleting all functions returns the project to a
clean state.

Firestore rules / indexes: previous versions available under
Firebase Console -> Firestore -> Rules / Indexes -> History.

## 17. Files Created and Modified

Created (Sprint 20):

- `firebase.json` (root)
- `.firebaserc` (root)
- `assets/lyfelabz-firebase-config.js`
- `platform/functions/src/scripts/bootstrap-beta-teacher.ts`
- `docs/platform/SPRINT_20_INTERNAL_BETA_DEPLOYMENT.md`

Modified:

- `platform/firebase/.firebaserc` -- project id retargeted
- `app/src/firebase-config.ts` -- PROJECT_ID retargeted
- `app/src/firebase-config.test.ts` -- expected id updated
- `platform/functions/src/scripts/deploy-assessment.ts` -- default
  project id updated
- `platform/functions/src/scripts/deploy-assessment.test.ts` --
  expected id updated
- `assets/lyfelabz-assessment-runtime.js` -- inline config setter
  prepended
- `assets/lyfelabz-assessment-runtime-active.js` -- rebuilt from
  source (byte content changes because PROJECT_ID changed)
- `app/dist/bundle.js` -- rebuilt from source
- `app/index.html` -- config script tag added
- `platform/functions/lib/**` -- rebuilt from source

Not touched (intentional): the seven modified HQIM HTML files in the
working tree at sprint start.

## 18. Certification Status

Deployed. Live URL responds. Automated smoke tests pass. Two
Console-side actions remain before the first authenticated login
succeeds; both are documented and are external-account blockers, not
repository blockers.
