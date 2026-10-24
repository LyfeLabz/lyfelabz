# Release Record: October 24, 2026 Measuring Matter Buoyancy Hosting Releases

**Status:** Complete and certified. Release record (evidence) for two consecutive general paired Hosting releases, followed by the production publication of Measuring Matter assessment r2 (section 7).
**Current-state routing:** `DOMAIN_AND_HOSTING_CONTRACT.md` defines the release procedure; this record carries the release facts.

---

## 1. Release facts (current production pair)

| Surface | State |
| --- | --- |
| Source HEAD | `138c3f3abb33e8bfadd54acc826853b009eeca04` ("Clarify Measuring Matter buoyancy prediction") |
| Production app Hosting (`app.lyfelabz.com`, site `lyfelabz-prod`) | `1883bfd69064b991` (previously `8ac712c35a09d1b5`) |
| Production marketing Hosting (`lyfelabz.com`, site `lyfelabz-marketing`) | `f8fec7599ca3a322` (previously `ce5d23cd07fdc69c`) |
| Release intent | `general` |
| Teacher Units | Gate closed (`teacherUnitsAvailability: closed`); readiness not evaluated |
| Functions | Not deployed in this operation |
| Firestore Rules and indexes | Not deployed in this operation |
| Storage Rules | Not deployed in this operation |
| Feature flags and Firestore data | Unchanged by this operation |

Deployed from a clean release worktree at the release SHA with `npm --prefix app ci` dependencies, using `firebase deploy --only hosting:app,hosting:marketing --project lyfelabz-prod --message "release <sha>"`.

## 2. Release sequence (actual, 2026-10-24)

| Order | Source | App version | Marketing version | Previous pair |
| --- | --- | --- | --- | --- |
| Baseline | `997ff52da3f31314a7d3afcffac1148cea7e01ee` | `d0100629cc88af19` | `06038668db780537` | - |
| 1 | `79a1cd14ade08fbb8ccc4f7937687bd8b104f60f` ("Streamline Measuring Matter buoyancy investigation") | `8ac712c35a09d1b5` (released 12:46:53Z) | `ce5d23cd07fdc69c` (released 12:46:53Z) | `d0100629cc88af19` / `06038668db780537` |
| 2 | `138c3f3abb33e8bfadd54acc826853b009eeca04` ("Clarify Measuring Matter buoyancy prediction") | `1883bfd69064b991` | `f8fec7599ca3a322` | `8ac712c35a09d1b5` / `ce5d23cd07fdc69c` |

Each release was prepared (`prepare.cjs --intent general --expect-sha <sha>`), compared against the live pair, deployed after explicit owner approval, and certified.

## 3. Certification

Both releases certified with `certify.cjs --project lyfelabz-prod --intent general`. Results for the current pair (`138c3f3`):

- App: 238/238 served paths matched, 0 problems.
- Marketing: 84/84 served paths matched, 0 problems (50 paths shadowed by redirects).
- Catalog navigation: 52/52 checks passed from `https://lyfelabz.com` and 52/52 from `https://www.lyfelabz.com`.

The `79a1cd1` release certified with the same counts. The generated certification records under `dist/hosting-release/` are not committed.

## 4. Hosting changes

Each release changed exactly four app-site files; the marketing site had 0 changed files and routing was unchanged on both sites:

- `lesson_measuring-matter.html`
- `app/lessons/lesson_measuring-matter.html`
- `app/lessons/assessment-revisions/lesson_measuring-matter__r1.html`
- `app/lessons/assessment-revisions/lesson_measuring-matter__r2.html`

- `79a1cd1`: streamlined the ungraded Boat Shape Investigation (buoyancy section markup, styles, and lab script).
- `138c3f3`: replaced the buoyancy prediction question with "Two objects are made from the same material and each has a mass of 40 g. One is a compact solid. The other is shaped like a hollow boat. Which will float?" and removed the start note "Make a prediction to open the investigation." Diffed against the live pages, these were the only differences.

## 5. Assessment state at the Hosting releases

Superseded by section 7: r2 was published to production after these Hosting releases. The facts below describe the state during the two Hosting releases.

- Measuring Matter production assessment remains **r1**. The existing r1 assessment is preserved; no assessment publication or Firestore write occurred.
- Measuring Matter **r2 remains unpublished and ON HOLD.** Its rendition is hosted at `app/lessons/assessment-revisions/lesson_measuring-matter__r2.html` but is not the current revision.
- In every Measuring Matter rendition (canonical source, v1, v2, r1, r2), the quiz section markup and every script other than the ungraded buoyancy lab script are byte-identical to the `997ff52` baseline. Revision mappings (`revision-paths.json`), `app/src`, and `platform/` are unchanged.

## 6. Rollback

Restore **both** sites to the previous certified pair (`79a1cd1`):

```sh
firebase hosting:clone lyfelabz-prod@8ac712c35a09d1b5 lyfelabz-prod:live --project lyfelabz-prod
firebase hosting:clone lyfelabz-marketing@ce5d23cd07fdc69c lyfelabz-marketing:live --project lyfelabz-prod
```

To return to the pre-buoyancy-refinement baseline (`997ff52`), clone app `d0100629cc88af19` and marketing `06038668db780537` the same way.

## 7. Measuring Matter assessment r2 publication (production)

Production Measuring Matter is `assessment_measuring-matter__r2`. Publication completed **2026-10-24T13:15:36Z** in `lyfelabz-prod`, after the final Hosting release (`138c3f3abb33e8bfadd54acc826853b009eeca04`; app `1883bfd69064b991`, marketing `f8fec7599ca3a322`). Hosting preceded the r2 data, matching the Water Cycle r2 precedent (`RELEASE_2026-10-01_PRODUCTION_APP_CATCHUP.md` section 2).

| Fact | Value |
| --- | --- |
| Payload | `platform/functions/src/scripts/assessments/measuring-matter.r2.json` (committed in `116fc09`) |
| Tool | `deploy-assessment` (`platform/functions/src/scripts/deploy-assessment.ts`), certified `deployAssessmentRevision` transaction |
| Dry run | `dry-run ok ... ordinal=2 items=10 answerKeyItems=10 writes=0 target=production project=lyfelabz-prod` |
| Apply | `deployed assessment=assessment_measuring-matter revision=assessment_measuring-matter__r2 ordinal=2 assessmentCreated=false target=production` |
| Parent `currentRevisionId` | `assessment_measuring-matter__r2` (ordinal 2) |
| Hosting, Functions, Rules, indexes, Storage, feature flags | Not deployed or changed by this publication |

Pre-publication state (read-only): parent current revision r1; r2 revision and answer key absent; 0 Measuring Matter assignments, attempts, and sessions.

Post-publication verification (read-only):

- The r2 revision has 10 items; every stem and option matches the committed payload.
- The r2 answer key has 10 entries; every correct option matches the committed payload. No correct option appears in the revision record.
- r1 is preserved and unchanged: revision (ordinal 1, 10 items) and answer key (10 entries) match the committed r1 payload, with create and update times both 2026-09-02T15:45:53Z.
- Measuring Matter assignments and attempts remain 0. No existing assignment or student record was affected.
- The production bundle's revision path table maps both r1 and r2, and the r2 rendition is served (HTTP 200).

Behavior: new Measuring Matter assignments freeze r2 at first publication (`assignmentsPublish`, `resolveCurrentAssessmentRevisionId`). No Measuring Matter assignment is frozen to r1; r1 stays deployed so any historical reference remains interpretable.

Rollback: there is no revision rollback tool; revisions are forward-only. A correction to r2 is published as a new r3 with a paired answer key. A failed publication writes nothing (single transaction).

Outstanding (human acceptance): the first real Measuring Matter assignment must be observed to freeze r2 and score correctly, including Classroom grade passback if published to Classroom.
