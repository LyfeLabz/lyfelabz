# LyfeLabz Production Release Ledger

Append-only record of certified production Hosting releases for `lyfelabz-prod`. Add a new entry at the bottom for each release; never edit earlier entries except to update a superseded or rollback status line. Current platform state lives in `CURRENT_PLATFORM_STATE.md`.

Rules for this file:

- Record only facts from certification receipts.
- Never record secrets, credentials, tokens or student data.
- Evidence paths are private folders on the owner's machine, under `LyfeLabz-Certification/`; they are not in the repository.

Rollback compatibility values: `CURRENT` (live), `SAFE` (may be restored with owner approval), `UNSAFE` (must not be restored).

---

## 2026-11-03: release 46986f4

- **Release SHA:** `46986f48b2dd1f37ed7124a47182ba498318e45e`
- **Scope:** student autosave reliability. Hosting pair (intent `teacher-units-hosting-only`), plus a single-Function deploy of `assessmentSessionsBegin` (revision `assessmentsessionsbegin-00015-mah`).
- **Hosting app:** `7a01064f13edc594` (released 2026-11-03T22:40:45.336Z)
- **Hosting marketing:** `4a6b2df3a28f4c27` (released 2026-11-03T22:40:45.316Z)
- **Replaced pair:** app `23f31eca386889dc`, marketing `ecae90a26d8ea37c` (release `3cbfdcf`)
- **Backend pin:** build `5700f199` from `3cbfdcf`; 92 Functions
- **Teacher Units policy:** enabled, generation 6
- **Certification:** CERTIFIED, `unchanged-enabled-backend-observed`. Live authenticated acceptance not performed.
- **Evidence:** `LyfeLabz-Certification/production-hosting-deployment-46986f4-2026-11-03T22-40-00Z/` (Hosting); `LyfeLabz-Certification/functions-v2-deployment-46986f4-2026-11-03T14-35-53-471Z/` (Function)
- **Status:** SUPERSEDED by release 16b959e on 2026-11-06.
- **Rollback compatibility:** UNSAFE since 2026-11-06T19:52:25Z. It has no Physical Properties r3 revision page or route, and production Firestore serves r3.

## 2026-11-06: release 16b959e

- **Release SHA:** `16b959e4bec22108a6ee9b2b5feb7ef0f781ae26`
- **Scope:** Physical Properties modernization. Hosting pair (intent `teacher-units-hosting-only`), then publication of `assessment_physical-properties__r3` to Firestore (2026-11-06T19:52:25Z; directly from r1; r2 never published).
- **Hosting app:** `732c250490ffb2d4` (released 2026-11-06T17:47:32.387Z)
- **Hosting marketing:** `a05ef6a6219e5fa5` (released 2026-11-06T17:47:32.407Z)
- **Replaced pair:** app `7a01064f13edc594`, marketing `4a6b2df3a28f4c27` (release `46986f4`)
- **Backend pin:** build `5700f199` from `3cbfdcf`; 92 Functions, unchanged
- **Teacher Units policy:** enabled, generation 6
- **Certification:** CERTIFIED, `unchanged-enabled-backend-observed` (app 241/241 paths, marketing 84 plus 50 redirects). r3 publication verified: content matches the committed payload, r1 unchanged.
- **Evidence:** `LyfeLabz-Certification/production-hosting-deployment-16b959e-2026-11-06T17-44-48Z/`
- **Status:** SUPERSEDED by release fa50cb0 on 2026-11-08.
- **Rollback compatibility:** SAFE. Both versions remain FINALIZED and preserve the Physical Properties r3 page and route.

## 2026-11-08: release fa50cb0

- **Release SHA:** `fa50cb0152be5dc9ce54d365018f8e5f31489188`
- **Scope:** navigation and student-read deduplication. Paired Hosting release, intent `teacher-units-hosting-only`.
- **Hosting app:** `57877ff8acfcb2a1` (released 2026-11-08T23:46:26.796Z)
- **Hosting marketing:** `3cc89fcdfaf080e7` (released 2026-11-08T23:46:26.802Z)
- **Verified rollback pair:** app `732c250490ffb2d4`, marketing `a05ef6a6219e5fa5` (release `16b959e`), both FINALIZED and compatible with Physical Properties r3.
- **Backend pin:** build `5700f199e1c42a061ea681645b9d5c25fd1b361812da078fad17f7626103a0a0` from `3cbfdcf621bb1912c9f3188cbef8696e1b644593`. All 92 Functions and the approved Rules, indexes, configuration, and secret bindings matched PREPARE.
- **Teacher Units policy:** enabled, generation 6. Student Support V2 and the Physical Properties r3 publication were preserved.
- **Certification:** CERTIFIED, `unchanged-enabled-backend-observed`. App matched 241 served paths. Marketing matched 84 served paths and retained 50 redirects.
- **Authenticated production acceptance:** PASS. Read-only teacher navigation, Student Detail, request deduplication, My Units, Unit Results, and Student Services passed. The signed-out teacher route redirected to Sign In.
- **Staging acceptance:** the owner approved and used a single-use exception scoped to this exact SHA, project, and intent. PREPARE, predeploy, certification, and authenticated production acceptance passed.
- **Evidence:** `LyfeLabz-Certification/production-hosting-deployment-fa50cb0-2026-11-08T23-46-26Z/` (SHA-256 manifest in archive).
- **Status:** SUPERSEDED by release 6fd2380 on 2026-11-10.
- **Rollback compatibility:** SAFE. Both versions remain FINALIZED, preserve the Physical Properties r3 page and route, and are the verified rollback pair for release 6fd2380.

## 2026-11-10: release 6fd2380

- **Release SHA:** `6fd2380922e2d7c53637bf2918419541bd5101e5`
- **Scope:** Evolution Clicker homepage Easter egg (`index.html`, marketing publish manifest, `assets/easter-eggs/evolution-clicker-microbe.png`). Built on release fa50cb0 with only these three files changed (same content as main commit d0ec8c6). Paired Hosting release, intent `teacher-units-hosting-only`.
- **Hosting app:** `d4bba4e4dea405b7` (released 2026-11-10T10:24:04.990Z)
- **Hosting marketing:** `20a9e1c22c0ab5e2` (released 2026-11-10T10:24:04.988Z)
- **Verified rollback pair:** app `57877ff8acfcb2a1`, marketing `3cc89fcdfaf080e7` (release `fa50cb0`), both FINALIZED.
- **Backend pin:** build `5700f199e1c42a061ea681645b9d5c25fd1b361812da078fad17f7626103a0a0` from `3cbfdcf621bb1912c9f3188cbef8696e1b644593`, unchanged. Existing Rules and configuration approvals reused; no Functions, Rules, index, or configuration deployment.
- **Teacher Units policy:** enabled, generation 6, unchanged.
- **Certification:** CERTIFIED, `unchanged-enabled-backend-observed`. App matched 242 served paths. Marketing matched 85 served paths and retained 50 redirects. Catalog navigation passed 52 checks each from the apex and www hosts.
- **Production verification:** homepage, PNG, and game returned 200; the served PNG matches the committed bytes. Typing `clicker` showed the image below the navigation; activating it requested the game in a new tab; the game loaded and gameplay advanced. Signed-out `/app/` redirected to Sign In. Authenticated teacher navigation was not exercised.
- **Staging acceptance:** the owner approved a single-use exception scoped to this exact SHA, project, and intent. PREPARE, predeploy, and certification passed.
- **Evidence:** `LyfeLabz-Certification/production-hosting-deployment-6fd2380-2026-11-10T10-24-04Z/` (SHA-256 manifest in archive).
- **Status:** SUPERSEDED by release 39d4722 on 2026-11-11.
- **Rollback compatibility:** SAFE. Both versions remain FINALIZED, preserve the Physical Properties r3 page and route, and are the verified rollback pair for release 39d4722.

## 2026-11-11: release 39d4722

- **Release SHA:** `39d4722d81a349ae1f0555552626feeb8effa35c`
- **Scope:** Physical Properties standards corrections and Policy A (lesson content separated from assessment revisions). Built on release 6fd2380 with one cherry-picked commit (main `3cffc23`), exactly nine files changed. Curriculum Session Isolation (PR #5) is not included. Paired Hosting release, intent `teacher-units-hosting-only`.
- **Served changes:** five app files (`lesson_physical-properties.html`, `app/lessons/lesson_physical-properties.html`, and the r1, r2 and r3 revision pages). Marketing content bytes unchanged. Goals 1 and 2 now carry 6.MS-ETS2-1(MA) and 6.MS-ETS2-2(MA); the buoyancy goal carries no code. Quiz sections, quiz scripts and revision IDs are unchanged; no assessment revision was created.
- **Hosting app:** `eda9f724433207dc` (released 2026-11-11T20:25:22.276Z)
- **Hosting marketing:** `b03dc5793bf53d54` (released 2026-11-11T20:25:22.193Z)
- **Verified rollback pair:** app `d4bba4e4dea405b7`, marketing `20a9e1c22c0ab5e2` (release `6fd2380`), both FINALIZED.
- **Backend pin:** build `5700f199e1c42a061ea681645b9d5c25fd1b361812da078fad17f7626103a0a0` from `3cbfdcf621bb1912c9f3188cbef8696e1b644593`, unchanged. Existing Rules and configuration approvals reused; no Functions, Rules, index, configuration or Firestore change.
- **Teacher Units policy:** enabled, generation 6, unchanged. Placement fingerprint `ad477c4c` unchanged.
- **Certification:** CERTIFIED, `unchanged-enabled-backend-observed`. App matched 242 served paths. Marketing matched 85 served paths and retained 50 redirects.
- **Production verification:** read-only. All five Physical Properties pages returned 200 and matched the certified bytes; the apex lesson URL redirects to the app host. Authenticated teacher navigation was not exercised.
- **Staging acceptance:** the owner approved a single-use exception scoped to this exact SHA, project and intent, conditional on PREPARE. PREPARE, predeploy, certification and read-only production lesson checks passed. The exception is consumed.
- **Evidence:** `LyfeLabz-Certification/production-hosting-deployment-39d4722-2026-11-11T20-25-22Z/` (SHA-256 manifest in archive).
- **Status:** CURRENT
- **Rollback compatibility:** CURRENT
