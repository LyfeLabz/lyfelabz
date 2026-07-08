# LyfeLabz Sprint 1: Firebase Foundation

**Status:** Revised implementation specification (pre-code)
**Companion to:** LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_ENGINEERING_STANDARDS.md
**Audience:** Engineers implementing Sprint 1
**Scope:** Firebase infrastructure only. No product features. No dashboards. No user-visible surfaces.

This document specifies the exact scope of Sprint 1 following engineering review. It supersedes any earlier draft. Sprint 1 exists to establish the Firebase foundation on which every future sprint will build. It is deliberately infrastructural. If Sprint 1 ships something a student or teacher can see, the sprint has done too much.

The Platform Architecture Version 1.0 documents remain canonical. This sprint does not evolve the architecture. It initializes the infrastructure the architecture has already described.

---

## 1. Sprint Objectives

By the end of Sprint 1 the platform has:

1. A Firebase project, provisioned and owned by LyfeLabz.
2. Firebase CLI initialized in the repository.
3. A default-deny Firestore Rules file, tested against the Emulator Suite.
4. Firebase Storage initialized under a default-deny rules file.
5. A Cloud Functions scaffold with the full long-term folder organization in place.
6. A single implemented Cloud Function: the authentication user-created trigger that writes a canonical user record.
7. A CI pipeline that runs lint, typecheck, build, and Firestore Rules tests on every pull request.
8. The Engineering Standards document from which every future contributor works.

By the end of Sprint 1 the platform does **not** have:

- Any dashboard, HTML page, or user-visible frontend.
- Firebase Hosting configured for production, preview channels, rewrites, redirects, custom domains, or deployment targets.
- Any Storage feature, upload UI, or teacher tooling.
- Any Cloud Function beyond the single authentication trigger.
- Any Firestore indexes beyond what the CLI generates as an empty placeholder.
- Any production deploy. Sprint 1 is emulator-only.

GitHub Pages remains the production site for the instructional repository throughout Sprint 1.

---

## 2. Repository Structure

Sprint 1 establishes the platform's engineering structure at the repository root:

```
platform/
    firebase/       Firebase configuration (firebase.json, firestore.rules, firestore.indexes.json, storage.rules, .firebaserc)
    functions/      Cloud Functions source and tests
    docs/           Sprint-scoped engineering notes
```

A `platform/web/` directory is **not** created in Sprint 1. Dashboard implementation is a later sprint. Sprint 1 is strictly infrastructure.

The instructional repository at the repository root is untouched.

---

## 3. Implementation Sequence

Sprint 1 proceeds in the following order. Each step is completed and reviewed before the next begins.

### Step 1. Engineering Standards document

Write and merge `docs/platform/LYFELABZ_ENGINEERING_STANDARDS.md`. Every subsequent step in Sprint 1 follows the standards this document establishes. Nothing in Steps 2 through 10 is written before Step 1 is merged.

### Step 2. Firebase project creation

Create the Firebase project in the LyfeLabz organizational Google account. Enable only the services Sprint 1 needs: Firestore, Authentication, Storage, Cloud Functions, and Hosting (initialized only, not configured). Do not enable Analytics, App Check, or any additional Google Cloud services yet.

Record the project ID, project number, and default region in `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` under a new "Sprint 1 provisioning" section. Configure billing on the Blaze plan (required for Cloud Functions) with a low budget alert.

### Step 3. Firebase CLI initialization

From `platform/firebase/`, run `firebase init` and select: Firestore, Functions, Storage, Emulators, and Hosting. During initialization:

- Choose TypeScript for Functions.
- Choose ESLint on for Functions.
- Accept the default `firestore.rules`, `firestore.indexes.json`, and `storage.rules` filenames.
- Configure the Emulator Suite to include Auth, Firestore, Functions, Storage, and Hosting.
- Initialize Hosting **only**. Do not configure a public directory beyond the default, do not add rewrites, do not set up preview channels, do not attach a custom domain, and do not create deployment targets. Hosting exists in the config so future sprints can enable it without an infrastructure sprint.

Commit the generated files (`firebase.json`, `.firebaserc`, `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `functions/`) as the initialization baseline.

### Step 4. Firestore Rules (default-deny)

Replace the generated `firestore.rules` with a strict default-deny ruleset:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

There is no authenticated wildcard access. There are no temporary permissions. There are no bootstrap exceptions. Every future collection is opened by its own sprint, in its own rules block, with its own tests.

`firestore.indexes.json` is left in its generated near-empty state. Sprint 1 does not proactively create indexes. Firestore will identify required composite indexes during later implementation, and those indexes will be added at that time.

`storage.rules` mirrors the Firestore approach: default-deny for all paths. Storage is initialized so future sprints can build on it, but Sprint 1 grants no Storage access to anyone.

### Step 5. Emulator Suite

Confirm the Emulator Suite starts cleanly with `firebase emulators:start` from `platform/firebase/`. Verify that Auth, Firestore, Functions, Storage, and Hosting all bind to their configured ports. Document the ports in `platform/docs/emulators.md`.

Sprint 1 development and verification happen exclusively against the Emulator Suite. There are no deploys to the live Firebase project during Sprint 1.

### Step 6. Firestore Rules testing

Add `@firebase/rules-unit-testing` and a Jest configuration to `platform/firebase/`. Write tests that verify:

- An unauthenticated request to any path is denied.
- An authenticated request to any path is denied.
- A write to any path is denied.

These tests establish the default-deny contract. Every future sprint that opens a collection adds allow-path and deny-path tests alongside the rules change. The Sprint 1 tests provide the harness those future tests will extend.

### Step 7. Cloud Functions scaffold

Inside `platform/functions/src/`, create the full long-term domain structure:

```
functions/src/
    auth/           README.md, index.ts
    teachers/       README.md, index.ts
    students/       README.md, index.ts
    classes/        README.md, index.ts
    submissions/    README.md, index.ts
    assignments/    README.md, index.ts
    audit/          README.md, index.ts
    shared/         README.md, types/, errors/, logging/
```

Every domain folder except `auth/` contains only its `README.md` (describing what the domain will own) and an empty `index.ts` that exports nothing. The `shared/` folder contains the initial typed helpers Sprint 1 needs: a typed Firestore reference helper, the `PlatformError` base class, and the structured logger wrapper described in the Engineering Standards.

The top-level `functions/src/index.ts` re-exports each domain's public surface. Sprint 1's re-exports list only what `auth/` exposes; the others export nothing yet.

This scaffold exists so that when future sprints add teacher, student, class, submission, assignment, or audit functionality, they add code to a folder that is already there, next to a README that already describes its purpose. No sprint will ever need to "set up folders" again.

### Step 8. Authentication trigger

Implement the single Cloud Function that Sprint 1 ships: `authOnUserCreate`. It fires on Firebase Auth user creation and writes a canonical user record to Firestore at `users/{uid}` containing:

- `uid`
- `email` (if present)
- `displayName` (if present)
- `photoURL` (if present)
- `provider` (the auth provider ID)
- `createdAt` (server timestamp)
- `role` (unset in Sprint 1; roles are assigned in later sprints)

The function is idempotent: if the user document already exists, it is left unchanged. The function logs `auth.userCreated` at `info` with `{ uid, provider }` on success and `auth.userCreateFailed` at `error` on failure. It uses typed Firestore helpers from `shared/`.

Because the Firestore Rules are default-deny, no client can read or write `users/{uid}`. The trigger runs with Admin SDK privileges and bypasses rules by design. Later sprints will open `users/{uid}` for owner-only client reads.

Firestore Rules tests are extended to confirm that even the newly written `users/{uid}` document is not readable or writable by any client, authenticated or not.

### Step 9. Firebase Storage initialization

Confirm that `storage.rules` is default-deny and that the Storage emulator serves it. Storage is initialized in Sprint 1 so that future sprints can open specific paths (for example, teacher-uploaded reference materials) without a fresh infrastructure sprint. No upload UI, no teacher features, no Storage code beyond the default-deny rules file.

### Step 10. CI pipeline

Add a GitHub Actions workflow that runs on every pull request touching `platform/`:

1. `lint` — ESLint on `platform/functions/src/`.
2. `typecheck` — `tsc --noEmit` on `platform/functions/`.
3. `build` — `npm run build` in `platform/functions/`.
4. `rules-tests` — Firestore Rules tests via the Emulator Suite.

The workflow does **not** run Cloud Function unit tests in Sprint 1. Function testing expands in Sprint 2, when there is more than one function to test. The workflow does not deploy anything.

CI must pass before merge. A failing CI run is a blocker, not a signal to bypass.

---

## 4. Explicit Non-Goals

Sprint 1 does **not** include:

- **A dashboard.** No `platform/web/`, no HTML, no client bundles, no build tooling for a frontend.
- **A signin smoke-test page.** Authentication is verified through the Firebase Emulator Suite and browser developer tools. No `signin-smoke.html` or equivalent artifact is created. Artifacts that will immediately become obsolete are not built.
- **Production Firebase Hosting configuration.** Hosting is initialized in `firebase.json` and nothing more. No preview channels, no rewrites, no redirects, no custom domain, no deployment targets. GitHub Pages remains the production site.
- **Any collection open to clients.** Firestore is default-deny. Storage is default-deny. Every future collection is opened by its own sprint with its own tests.
- **Proactive Firestore indexes.** `firestore.indexes.json` remains essentially empty. Indexes are added when Firestore identifies the need during real query implementation.
- **Function tests beyond Rules tests.** Function unit tests expand in Sprint 2.
- **Any live deploy.** Sprint 1 is emulator-only. Deploy configuration is a later sprint.
- **Any teacher, student, class, submission, assignment, or audit feature.** The folders exist. The code inside them does not, beyond the `auth/` trigger.

---

## 5. Deliverables

At the end of Sprint 1 the repository contains:

- `docs/platform/LYFELABZ_ENGINEERING_STANDARDS.md` — merged.
- `docs/platform/LYFELABZ_SPRINT_1_FIREBASE_FOUNDATION.md` — this document.
- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` — updated with the Sprint 1 provisioning record.
- `platform/firebase/` — Firebase configuration, default-deny Firestore and Storage rules, empty indexes file, emulator config, initialized-only Hosting config.
- `platform/functions/` — Cloud Functions scaffold with the full domain folder structure, `shared/` utilities, and the `authOnUserCreate` trigger.
- `platform/docs/emulators.md` — how to start and use the Emulator Suite locally.
- `.github/workflows/platform-ci.yml` — lint, typecheck, build, and Rules tests on every PR touching `platform/`.

---

## 6. Definition of Done

Sprint 1 is done when all of the following are true:

- The Engineering Standards document is merged and the sprint has been reviewed against it.
- The Firebase project exists, billing is configured, and provisioning details are recorded.
- `firebase emulators:start` runs cleanly for Auth, Firestore, Functions, Storage, and Hosting.
- Firestore Rules and Storage Rules are default-deny with no exceptions.
- Rules tests pass in CI and prove the default-deny contract.
- The Cloud Functions scaffold reflects the long-term domain organization.
- `authOnUserCreate` is implemented, tested locally against the Emulator Suite, idempotent, and logging structured events.
- CI runs lint, typecheck, build, and Rules tests on every PR touching `platform/` and blocks merge on failure.
- No user-visible surface, no production deploy, no smoke-test page, and no additional Firestore indexes exist.

When every item above is true, Sprint 1 is complete and Sprint 2 planning begins from the Engineering Standards and the architecture documents, exactly as intended.
