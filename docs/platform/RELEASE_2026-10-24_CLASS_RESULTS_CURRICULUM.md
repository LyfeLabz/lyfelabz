# Release Record: October 24, 2026 Class Results and Curriculum Modernization (Release 1)

**Status:** Complete and certified. Release record (evidence) for one production Function update followed by one general paired Hosting release. Teacher Units / My Units remains CLOSED in production.
**Current-state routing:** `DOMAIN_AND_HOSTING_CONTRACT.md` defines the Hosting release procedure; `TEACHER_UNITS.md` defines the Teacher Units activation prerequisites; this record carries the release facts.

---

## 1. Release facts (current production state)

| Surface | State |
| --- | --- |
| Source HEAD | `14f7bdb55d47d027b6074fb5cc23f1886ba45e21` ("Share grade selection between Curriculum and My Units") |
| Production project | `lyfelabz-prod` (explicit `--project` on every command) |
| Function `assessmentLessonSummary` | Cloud Run revision `assessmentlessonsummary-00006-gev` (created 2026-10-24T18:29:47Z), 100% traffic, ACTIVE, Functions hash `8d65301c153bff3c815240363a5ea5f8cbdb15d6` (previously revision `assessmentlessonsummary-00005-zon`, source `2a3efab`) |
| Production app Hosting (`app.lyfelabz.com`, site `lyfelabz-prod`) | `108562bef1fc513f` (previously `1883bfd69064b991`) |
| Production marketing Hosting (`lyfelabz.com`, site `lyfelabz-marketing`) | `5b50be665a93d424` (previously `f8fec7599ca3a322`) |
| Release intent | `general` |
| Teacher Units | Gate closed (`teacherUnitsAvailability: closed`, policy `teacher-units-canonical-closed-v2`); readiness not evaluated |
| Other Functions | Not deployed. 76 production Functions before and after; no `teacherUnits*` Function exists in production |
| Firestore Rules and indexes | Not deployed (Rules release unchanged: ruleset `626deb5b-7552-43d4-a2e3-116856b3ccd3`, 2026-09-18) |
| Storage Rules | Not deployed |
| IAM, feature flags, Firestore data | Unchanged. `platformConfig/teacherUnitsAvailability` does not exist in production |

Deployed from a clean release worktree at the release SHA with `npm --prefix app ci` and `npm --prefix platform/functions ci` dependencies.

## 2. Scope

Delivered to production:

- **Class Results** in lesson Results (per-class rows, View Results to Assignment Detail).
- **Results-first Curriculum** card actions and the Curriculum UX polish.
- **Shared grade selection** (Curriculum side).

Not delivered (compiled closed in the `general` build): My Units, Unit Results, unit colors, Add to Unit. These require the Teacher Units activation prerequisites in `TEACHER_UNITS.md` ("Remaining activation prerequisites", A3-3, A3-5, and the `U2_6_A3_6_DECISION_RECORD.md` release-authority work). The `staging-ux-test` intent was not used.

The previously certified staging modernization was `5ee7d5a68806227796c11f797bffcd815a201a7f` (intent `staging-ux-test`, uncertified for production). The release commit adds only `app/src/shell/surfaces/curriculum.ts`, `app/src/shell/surfaces/myUnits.ts`, and `app/src/shell/myUnits.modernization.test.ts`. The Functions source at `14f7bdb` is identical to `22cc00d`, the source of the staging `assessmentLessonSummary`.

## 3. Release sequence (actual, 2026-10-24)

| Order | Operation | Result |
| --- | --- | --- |
| 1 | Functions gates in the release worktree: `typecheck`, `lint`, `jest --maxWorkers=2`, `build` | All exit 0; 185/185 suites, 5516/5516 tests; A3 runtime build record `closed-only` |
| 2 | `prepare.cjs --project lyfelabz-prod --intent general --expect-sha 14f7bdb55d47d027b6074fb5cc23f1886ba45e21` | Exit 0; app verify 230/230 suites, 8677/8677 tests; Hosting suites 320 pass, 2 skipped; pair gate 126/126 shared paths byte-identical; live baselines recorded |
| 3 | `firebase deploy --only functions:assessmentLessonSummary --project lyfelabz-prod --non-interactive` | Exit 0; "Successful update operation" |
| 4 | `firebase deploy --only hosting:app,hosting:marketing --project lyfelabz-prod --message 'release 14f7bdb55d47d027b6074fb5cc23f1886ba45e21' --non-interactive` | Exit 0; both sites released at 18:30:50Z |
| 5 | `certify.cjs --project lyfelabz-prod --intent general` | CERTIFIED (section 5) |

Deployed under the owner's Release 1 authorization.

## 4. Function update details

- **Contract.** The single-lesson request `{ lessonSlug }` and its response fields are unchanged. The response adds `classes` (the caller's own classIds and per-class aggregates only), and the callable adds the batch form `{ lessonSlugs }` (1 to 100). The previously live client (`138c3f3`) ignores the extra field; the new client treats a missing `classes` as "Class results are not available right now." The batch form is called only by Unit Results (closed in production).
- **Shared code.** Since `2a3efab`, `requireDistrictContext` is unchanged; the removed shared code (retired assignment close and variant write refs) is not used by this Function; `https-callable` changes are additive. Dependencies are unchanged (`engines.node` 20 to 22; production already ran `nodejs22`).
- **Configuration.** The `defineString` parameters `GOOGLE_CLASSROOM_CLIENT_ID` and `GOOGLE_CLASSROOM_REDIRECT_URI` load from the git-ignored `platform/functions/.env.lyfelabz-prod`, which a clean worktree does not contain. The file was copied into the release worktree after its values were verified equal (by hash) to the live values; the post-deploy values are equal. Service account (default compute), 256Mi memory, max 20 instances, concurrency 80, ingress `ALLOW_ALL`, and the `roles/run.invoker` `allUsers` binding are unchanged (the invoker binding was observed after deployment only; firebase-tools does not change it on an update).
- **Probe.** An unauthenticated POST returns 401 `unauthenticated` with the platform error shape.

## 5. Certification

`certify.cjs --project lyfelabz-prod --intent general`:

- App: 238/238 served paths matched, 0 problems.
- Marketing: 84/84 served paths matched, 0 problems (50 paths shadowed by redirects).
- Catalog navigation: 52/52 checks passed from `https://lyfelabz.com` and 52/52 from `https://www.lyfelabz.com`.

The generated records under `dist/hosting-release/` in the release worktree are not committed.

Hosting changes: three app-site files (`app/dist/bundle.js`, `app/index.html`, `app/lessons/index.html`); the marketing site had 0 changed files; routing was unchanged on both sites. The live `app/dist/bundle.js` is byte-identical to the built artifact.

Test count note: the 8686 tests reported before the release came from the main checkout, whose uncommitted test edits add exactly 9 tests; the release commit has 8677, all passing.

## 6. Post-deployment checks

Verified (unauthenticated):

- `https://app.lyfelabz.com/app/` loads the sign-in page ("Continue with Google") with no console errors.
- `https://lyfelabz.com/` loads (50 lesson links) with no console errors; `https://www.lyfelabz.com/` and `https://app.lyfelabz.com/app/lms-callback.html` return 200.
- The live bundle contains the Class Results surface and the closed Teacher Units gate.

Open (requires an authenticated teacher; not performed):

- Curriculum loads and assigned lessons show Results.
- Class Results rows render for a lesson assigned to more than one class; View Results opens Assignment Detail and Back returns to Results.
- Shared grade selection behaves correctly across Curriculum.
- My Units is absent from Teacher Workspace navigation.

## 7. Rollback

**Hosting.** Restore **both** sites to the previous certified pair (`138c3f3`):

```sh
firebase hosting:clone lyfelabz-prod@1883bfd69064b991 lyfelabz-prod:live --project lyfelabz-prod
firebase hosting:clone lyfelabz-marketing@f8fec7599ca3a322 lyfelabz-marketing:live --project lyfelabz-prod
```

**Function.** The previous revision `assessmentlessonsummary-00005-zon` (image digest `sha256:bcd8c7c296ca922a0760796c7eae186dcdad5d704d240f23463922dbf3607aa1`) is retained. Its deployed source tree is identical to commit `2a3efab7299b99383e719d195b446768253cf16b`.

- Fast: route 100% of Cloud Run traffic for service `assessmentlessonsummary` (us-central1) to revision `assessmentlessonsummary-00005-zon` (Cloud Run console, or `gcloud run services update-traffic` after `gcloud auth login`). The next Functions deploy replaces this pin.
- Durable: from a clean worktree at `2a3efab` with `platform/functions/.env.lyfelabz-prod` present, `firebase deploy --only functions:assessmentLessonSummary --project lyfelabz-prod`.

Rolling the Function back without Hosting is safe: the current client degrades to "Class results are not available right now." Rolling Hosting back without the Function is also safe: the older client ignores `classes`.
