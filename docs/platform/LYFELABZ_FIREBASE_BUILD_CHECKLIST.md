# LyfeLabz Firebase Build Checklist

A repeatable checklist for manually creating or verifying a LyfeLabz Firebase project through the Firebase Console.

This checklist reflects the exact configuration used for the current production project, `lyfelabz-prod`, and is written so that future `lyfelabz-dev` and `lyfelabz-test` projects can be brought up identically.

GitHub Pages remains the production website. Firebase is the backend platform for authentication, data, storage, and future Cloud Functions. Hosting is initialized but not used for the public site.

---

## 1. Canonical Configuration (lyfelabz-prod)

The following configuration is the current, verified state of `lyfelabz-prod` and is the reference used by every subsequent LyfeLabz Firebase project.

- Project ID: `lyfelabz-prod`
- Google Analytics: disabled
- Billing plan: Blaze (pay-as-you-go)
- Firestore mode: Native mode
- Firestore location: `nam5` (US multi-region)
- Authentication: enabled
- Sign-in provider: Google (enabled)
- Cloud Storage: initialized
- Storage location: US multi-region
- Storage access frequency: Standard
- Storage rules: locked down
  ```
  rules_version = '2';
  service firebase.storage {
    match /b/{bucket}/o {
      match /{allPaths=**} {
        allow read, write: if false;
      }
    }
  }
  ```
- Hosting: initialized only (not deployed, no custom domain)
- Cloud Functions: not manually initialized
- Public website: GitHub Pages (unchanged)

---

## 2. Firebase Console Click-Paths

All steps below assume you are signed in at https://console.firebase.google.com/ with an account that has permission to create projects on the LyfeLabz billing account.

### 2.1 Create the project

1. Firebase Console home -> Add project
2. Enter project name -> confirm Project ID (must exactly match target, e.g. `lyfelabz-prod`)
3. Google Analytics step -> Disable Google Analytics -> Create project
4. Wait for provisioning to complete -> Continue

### 2.2 Upgrade to Blaze

1. Left sidebar -> gear icon (bottom-left) -> Usage and billing
2. Details and settings tab -> Modify plan
3. Select Blaze (pay-as-you-go) -> link the LyfeLabz billing account -> Purchase
4. Confirm the plan badge in the sidebar reads "Blaze".

### 2.3 Firestore (Native mode, nam5)

1. Left sidebar -> Build -> Firestore Database
2. Create database
3. Mode: Native mode
4. Location: `nam5 (United States)` multi-region
5. Start in production mode (locked rules)
6. Enable

### 2.4 Authentication + Google sign-in

1. Left sidebar -> Build -> Authentication -> Get started
2. Sign-in method tab -> Add new provider -> Google
3. Enable -> set project support email -> Save
4. Confirm Google appears in the enabled providers list.

### 2.5 Cloud Storage (US multi-region, Standard, locked rules)

1. Left sidebar -> Build -> Storage -> Get started
2. Start in production mode
3. Location: `us` (US multi-region), Standard storage class -> Done
4. Rules tab -> paste the locked-down rules block from section 1 -> Publish
5. Confirm the default bucket appears and rules show `allow read, write: if false`.

### 2.6 Hosting (initialize only)

1. Left sidebar -> Build -> Hosting -> Get started
2. Click through the setup dialog until Hosting is listed as initialized.
3. Do not run `firebase deploy`. Do not add a custom domain. Do not point DNS.

### 2.7 Cloud Functions

Skip entirely. Cloud Functions must not be manually initialized in the Console. This is handled by the repository workflow in a later sprint.

---

## 3. Future Project Checklist (lyfelabz-dev, lyfelabz-test)

Use this section verbatim when standing up `lyfelabz-dev` or `lyfelabz-test`. The intent is byte-for-byte parity with `lyfelabz-prod` except for the Project ID.

- [ ] Create project with Project ID exactly `lyfelabz-dev` or `lyfelabz-test`
- [ ] Google Analytics: disabled during creation
- [ ] Upgrade to Blaze and link the LyfeLabz billing account
- [ ] Firestore: Native mode, location `nam5`, start in production mode
- [ ] Authentication: enabled
- [ ] Google sign-in provider: enabled, support email set
- [ ] Cloud Storage: initialized, location `us` multi-region, Standard class
- [ ] Storage rules: `allow read, write: if false` (from section 1)
- [ ] Hosting: initialized only, no deploy, no custom domain
- [ ] Cloud Functions: not initialized
- [ ] App Check: not enabled
- [ ] Realtime Database: not enabled
- [ ] App Hosting: not enabled
- [ ] Analytics: not enabled after the fact
- [ ] Record the resulting Web App config in the platform docs

---

## 4. Verification

Run this section after initial setup and again any time a teammate suspects drift.

- [ ] Project ID matches the target exactly
- [ ] Billing plan badge reads "Blaze"
- [ ] Firestore Database exists, Native mode, location `nam5`
- [ ] Authentication is enabled with Google as an active provider
- [ ] Storage default bucket exists, location `us`, Standard class
- [ ] Storage rules match the locked-down block in section 1 exactly
- [ ] Hosting shows as initialized with no deploys and no custom domains
- [ ] Cloud Functions shows no functions and no manual initialization
- [ ] App Check, Realtime Database, App Hosting, and Analytics are all disabled or absent
- [ ] GitHub Pages is still serving the public website unchanged

---

## 5. Do Not Do Manually

The following actions must not be performed from the Firebase Console or by hand. Each one belongs to a later, repository-driven workflow, and doing it manually will create drift that the repository cannot reconcile.

- Do not manually initialize Cloud Functions
- Do not deploy Firebase Hosting
- Do not add a custom domain to Firebase Hosting
- Do not enable Google Analytics
- Do not enable App Check
- Do not enable Realtime Database
- Do not enable App Hosting
- Do not edit Firestore or Storage rules outside the repository workflow

If any of these become necessary, they should be introduced through the repository as a reviewed change, not through the Console.

---

## 6. Scope Boundary

Firebase CLI initialization, `firebase.json`, `.firebaserc`, `firestore.rules`, `storage.rules`, and related repository files belong to Sprint 1 Step 3 and later. This checklist stops at Console-level project provisioning.
