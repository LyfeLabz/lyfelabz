# Release Record: October 30, 2026 Student Support V2 + My Units (Teacher Units Option B)

**Status:** SUCCESS WITH DOCUMENTED FOLLOW-UPS. Deployed and enabled in production. Release record (evidence) for one Teacher Units Option B release: availability close, 19 scoped Functions, backend pin, paired `teacher-units` Hosting release, re-enable.
**Current-state routing:** `CURRENT_PLATFORM_STATE.md` carries the live state; `U2_6_RELEASE_READINESS_RUNBOOK.md` defines the operator workflow; `STUDENT_SUPPORT_ACCESS.md` defines the feature; `DOMAIN_AND_HOSTING_CONTRACT.md` defines the Hosting procedure; this record carries the release facts. Follow-ups: `ENGINEERING_BACKLOG.md`.

---

## 1. Release facts (current production state)

| Surface | State |
| --- | --- |
| Source | `3cbfdcf621bb1912c9f3188cbef8696e1b644593` ("Preserve Student Support function instance limits"), branch `feature/student-support-workspace-v2` |
| Production project | `lyfelabz-prod` (explicit `--project` on every command) |
| Production app Hosting (`app.lyfelabz.com`, site `lyfelabz-prod`) | `23f31eca386889dc` (previously `d9b48607ebb7505d`) |
| Production marketing Hosting (`lyfelabz.com`, site `lyfelabz-marketing`) | `ecae90a26d8ea37c` (previously `29bc0af1a32171dd`) |
| Release intent | `teacher-units`; certified `compatible-backend-observed-policy-required` |
| My Units availability | Enabled, **generation 6**, policy instance `19592fb6-bddc-45d7-8c64-df2d50cabfcc`, contract `teacher-units-v3`, placement `ad477c4c…` |
| Backend build (pin) | `5700f199e1c42a061ea681645b9d5c25fd1b361812da078fad17f7626103a0a0` (policy-controlled, clean, from `3cbfdcf`; identical to the staging-certified build) |
| Functions | 92 (was 85), all ACTIVE. 12 updated, 7 created, 73 unchanged (section 3) |
| Firestore Rules and indexes | Not deployed. Ruleset `dcec7a5f-71f8-4fb9-b10d-2e25ad66a084` unchanged (source hash equals deployed); composite indexes unchanged |
| Storage Rules, IAM, other configuration | Not deployed or changed |

Deployed from a clean release worktree at the release SHA with `npm --prefix app ci` and `npm --prefix platform/functions ci` dependencies. App verification inside Hosting prepare: 9,156/9,156 tests, 249 suites.

## 2. Scope

Delivered to production:

- **Student Support V2** (PDR-032): owner-issued, read-only, student-specific support grants (single and bulk share/revoke in Settings > Student Services), the grantee Student Support workspace, and grantee reads of Student Detail (attempt history, Review answers, Repeated misses, Student thinking, grade-improvement history). See `STUDENT_SUPPORT_ACCESS.md`.
- **My Units** on the `3cbfdcf` backend and client (nonblocking registry hydration and retry fixes since `f1c476f`).

## 3. Function inventory changes

| Group | Functions | Result |
| --- | --- | --- |
| Teacher Units (policy-controlled) | `teacherUnitsArchive`, `teacherUnitsCapabilities`, `teacherUnitsCreate`, `teacherUnitsGet`, `teacherUnitsList`, `teacherUnitsReorder`, `teacherUnitsRestore`, `teacherUnitsSetResources`, `teacherUnitsUpdate` | Updated (revision 00001 to 00002), max 20 |
| Student Support, updated | `assessmentAttemptGetForTeacher`, `assessmentStudentAssignmentsForClass`, `gradeImprovementsListForStudent` | Updated, max 20 (see section 5 for the last) |
| Student Support, new | `assessmentAttemptsListForStudent`, `supportAccessGrant`, `supportAccessGrantMany`, `supportAccessRevoke`, `supportAccessRevokeMany`, `supportAccessListForClass`, `supportAccessListMine` | Created, max 20 |

All other production Functions were unchanged (state, scaling, revision). No broad Functions deploy was used.

## 4. Release sequence (actual, 2026-10-30, UTC)

| Time | Operation | Result |
| --- | --- | --- |
| ~17:58 | Preflight (source, staging acceptance, baseline, operator auth, rollback artifacts) | All pass |
| 17:59:29 | Availability close | committed-current, shutdownConfirmed, generation 3 to 4 |
| ~18:01-18:06 | Scoped Functions deploys (9, then 10) | All ACTIVE; inventory diff exactly as planned |
| 18:07:54 | Backend pin (prepare) while closed | generation 5, build `5700f199…` |
| ~18:08-18:15 | Hosting prepare, paired deploy, certify | Certified: 238 + 84 paths, 52 + 52 navigation checks |
| 18:15 | Current-release record, `checkEnable` | Passed (production-activation, staging acceptance bound) |
| 18:17:24 | Enable | committed-current, generation 6 |

My Units was unavailable to teachers for about 18 minutes.

## 5. Deployment incident (accepted)

`gradeImprovementsListForStudent` was planned to keep its previous unset instance limit. After the scoped deploy it has `maxInstances 20`; every other setting was unchanged. The `3cbfdcf` source sets no limit on this callable; the value was applied by the deploy path (consistent with other production Functions that have no source limit). The exact mechanism is not confirmed. The owner accepted the configuration during the release. It was not changed afterward. Follow-up: `ENGINEERING_BACKLOG.md`.

## 6. Verification scope and limitations

- **Production, owner teacher account (read-only, verified):** My Units list with the existing unit intact and Create Unit available; Unit Results; Settings > Student Services sharing view; class assignments intact; Student Detail attempt history, Review answers, Repeated misses, Student thinking. No grants, units or student data were created or changed. Cloud Run request logs after release: no 5xx; new revisions serving 200.
- **Staging (verified, `3cbfdcf`, accepted by owner 2026-10-30):** My Units write workflows 14/14; Support Teacher workspace 12/12; individual and teacher-level revocation (backend 403s); grant restoration; exact-build shutdown and recovery rehearsal.
- **Not directly tested in production:** the Support Teacher (grantee) workflow, sharing, and revocation authorization. No production grantee account was used and real grants were intentionally not created. Production coverage of those paths rests on staging acceptance and automated tests.
- One transient Students-tab failure ("We couldn't load your students") was observed; `enrollmentsListForClass` (not part of this release) had a 70.6 s request; a retry loaded the roster.
- Accepted staging limitations carried forward, including the My Units capability cold start beyond the 10 s client window and a known pre-existing tooling emulator test failure (`availability-control.emulator.test.cjs`, `TypeError: db.collection is not a function`).

## 7. Evidence and rollback

Private durable evidence (outside the repository): `~/Documents/LyfeLabz-Certification/student-support-v2-3cbfdcf/`

- Staging acceptance: `acceptance/staging-acceptance-3cbfdcf.json` (owner decision `acceptance/owner-acceptance-decision.txt`).
- Production release: `production-release/RELEASE_RECORD.md` (preflight, plans and results, deploy/prepare/certify logs, current-release record, incident).
- Closure: `RELEASE_CLOSURE.md`.
- Rollback: closed-only `3cbfdcf` build `4b45e591…` (`production-release/closed-only-rollback-3cbfdcf.zip`, canonical closed-only check passed); prior Hosting pair `d9b48607ebb7505d` / `29bc0af1a32171dd` (restore both); prior release records in `production-rollback-f1c476f/`. Backend closure (`availability close`) is the authoritative emergency control.
