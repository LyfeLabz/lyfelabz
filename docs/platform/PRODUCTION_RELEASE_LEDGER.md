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
- **Status:** CURRENT
- **Rollback compatibility:** CURRENT. A future Hosting correction must keep serving the r3 revision page and route.
