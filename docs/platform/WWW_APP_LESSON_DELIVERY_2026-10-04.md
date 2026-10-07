# Public lesson delivery investigation — October 4, 2026

> **Superseded release procedure (October 2026).** The redirect architecture
> recorded here remains in force. Its release commands do not: they deploy the
> marketing site alone with `firebase.marketing.json` or ad hoc `--config`
> files, which no longer exist. Both Hosting sites are now released together
> from `firebase.json` targets (`app`, `marketing`) after
> `scripts/hosting-release/prepare.cjs`, and certified with
> `scripts/hosting-release/certify.cjs`, which includes this report's catalog
> navigation gate. See `DOMAIN_AND_HOSTING_CONTRACT.md`.

Status: implemented and staging-preview certified; UNCOMMITTED. No production deployment.
The accepted architecture and four implementation/test files are unchanged in the continuation;
only this report was updated with the two completed certification gates.

## Scope and isolation

Operation worktree: `/Users/breezy/.codex/worktrees/www-app-lesson-delivery/lyfelabz`.
Base: `905c9d691bd4a3d4ecb4cdab6685f18ed6ee5253`, detached HEAD.
The normal checkout was observed at `7047b5789da85c29e5f43add409652616fd8641a`,
with only `docs/platform/MULTILINGUAL_DELIVERY_ARCHITECTURE.md` untracked.
This differs from the earlier dirty-file inventory in the request. None of the
listed files or other work from that checkout was copied into the source tree,
edited, stashed, reset, cleaned, or committed. Installed dependencies were copied
into ignored `app/node_modules`; the app was rebuilt from this worktree's source.

## 1. Live Hosting map

Read-only HTTP, DNS and Firebase Hosting REST inspection on October 4, beginning
at 12:31 UTC, established:

| Host | Serving system / project / site | Current role and lesson behavior |
| --- | --- | --- |
| `lyfelabz.com` | Firebase Hosting / `lyfelabz-prod` / `lyfelabz-marketing` | Public homepage, marketing, catalog and older public lesson files |
| `www.lyfelabz.com` | Firebase Hosting / `lyfelabz-prod` / `lyfelabz-marketing` | Same homepage and older lesson files as apex |
| `app.lyfelabz.com` | Firebase Hosting / `lyfelabz-prod` / default site `lyfelabz-prod` | Application, current public lessons, authenticated lesson renditions and revisions |

`lyfelabz-marketing` is a second **site in the production project**, not a separate
project in the inspected configuration. Hosting custom-domain API returns active
ownership and hosting for apex/www on marketing and app on the default site.

DNS: apex A `199.36.158.100`; www CNAME `lyfelabz-marketing.web.app`;
app CNAME `lyfelabz-prod.web.app`; authoritative NS `ns19.domaincontrol.com` and
`ns20.domaincontrol.com`. GoDaddy provides DNS for these hosts; their inspected
HTTPS content comes from Firebase, not GoDaddy or GitHub Pages. Each custom-host
body matches the corresponding Firebase `.web.app` site body.

All seven URLs requested returned HTTP 200 without redirects. Additional apex
lesson requests matched www. Deployed marketing routing has only `/app` and
`/app/` redirects to the app shell, plus `/privacy` and `/terms` rewrites.
There is no lesson redirect or proxy. App routing has the expected authenticated
shell rewrites and legal-page redirects; no public-lesson rewrite.

Marketing live version: `fa5173a7c8c6457f`, released `2026-09-10T17:51:31.878Z`.
App live version: **`66a47e5a18ba6dcc`**, released `2026-10-04T03:59:37.489Z`.
The request's `92046ea1f5745492` is not the current version. The preceding app
release returned by the API is `853ef27cc4151deb` at `02:09:02.203Z`.
The named `92046ea1f5745492` release exists at `00:18:53.740Z`, before both.
The initial investigation certified the lesson bytes below. The continuation in
section 12 independently establishes the entire current app artifact as commit
7047b57, not 905c9d6.

Repository deployment paths:

- `firebase.json`: default production site; `npm --prefix app run build && node scripts/app-hosting/build.cjs`; public artifact `dist/app-hosting`.
- `firebase.marketing.json`: `marketing` target, mapped by `.firebaserc` to `lyfelabz-marketing`; `node scripts/marketing-hosting/build.cjs`; artifact `dist/marketing`.
- `.github/workflows/platform-ci.yml` runs platform checks; it publishes neither Hosting site. No tracked automatic Hosting deployment workflow was found. Local Firebase predeploy/build configuration defines the publishing paths; historical release invocation outside the repository cannot be inferred from CI files alone.
- Staging has one inspected default site: project/site `lyfelabz-staging`.

## 2. Live lesson byte comparison

SHA-256 of decoded HTTP response bodies, not ETags:

| Lesson | www (also apex and marketing.web.app) | app (also prod.web.app and committed 905c9d6) |
| --- | --- | --- |
| Carbon Cycle | `12742c8421fcd4a4b06a9abe491d2da5541956f4021b058aa3cb24e4064f14e4` | `317d5907873da66d8ddf2cbcf796074b634606c658133c24cd649956307f0b8c` |
| Renewable & Nonrenewable Resources | `074fe70b56314cbe9172f28a2a1f6cfaff2e69d235469de0741eafdc45e81bfe` | `948f31280a354ce255bc0258fd2a379cb8d8bd40616ce11c2c82e9b4f077a5e6` |

Carbon: www 141,440 bytes; app/commit 166,327 bytes. The updated app page includes
the Animal respiration label at SVG `(350, 190)`.
Renewable: www 158,865 bytes; app/commit 153,280 bytes. The updated app page
contains the NYC historical water evidence and `assessment_renewable-and-nonrenewable-resources__r2` declaration.

Both old www pages and its homepage exactly match the files at September marketing
migration commit `135cccf893c4c719f7b0c0ec4a4a57062ccc736b`.
Homepage SHA: www/apex `dcdebeae1f545b895c0e6f3242b8f2df0eb551a55780aa1c300235664c45d60e`;
app `78670f7d14509015fb31bb443c7b52be3c5c0a29431a13e23dd2313dc67ff908`.

Responses use `Cache-Control: max-age=3600`. Marketing Last-Modified is September
10, 17:51:32 GMT; app is October 4, 03:59:37 GMT. Unique query strings plus
`Cache-Control: no-cache` produced CDN MISS responses with the same respective
hashes. This is persistent release divergence, not evidence of a browser-cache
problem. Old browser-cached 200 responses can still delay observing a later fix
until revalidation; release checks must use a fresh browser context.

## 3. GitHub migration finding

Early Sprint 3 and Sprint 24A documents describe GitHub Pages serving the public
curriculum; `CNAME` still contains `www.lyfelabz.com`, and README still says
GitHub Pages. Those are historical residues, not current DNS evidence.

Commit `135cccf` explicitly migrated marketing to dedicated Firebase Hosting.
It removed the homepage's anonymous GitHub repository API dependency.
The marketing builder has an existing regression test excluding that API request.
GitHub remains the source repository; current public requests do not fetch the
lesson bodies from GitHub. Repository privacy is therefore not causal to this
incident. Current GitHub Pages settings/privacy were not independently retrieved:
no `gh` executable was available. DNS, active Firebase bindings, live release
metadata and matching bytes suffice to identify these three hosts' delivery path.

The serving infrastructure migration is complete for these hosts. Release
ownership/certification remained split, and documentation cleanup/GitHub Pages
retirement status is not fully established by this investigation.

## 4. Root cause and normal navigation

Both Hosting artifacts intentionally contain root `lesson_*.html` files:
`scripts/marketing-hosting/public-files.json` explicitly includes them, and
`scripts/app-hosting/public-files.json` composes that manifest. The sites release
independently. App releases updated the app copy; marketing remained at September.

The actual public homepage has ordinary relative anchors:
`href="lesson_carbon-cycle.html"` and
`href="lesson_renewable-and-nonrenewable-resources.html"` (root index lines 1228
and 1416 at the base commit). With no overriding base URL, those resolve on the
www/apex host from which the visitor entered. This is not an absolute www URL
introduced by the teacher app. The generated curriculum manifest retains
root-relative lesson paths; `app/scripts/build-curriculum-manifest.cjs` documents
index.html as its source. Teacher/student launches separately use `/app/lessons/`
and revision-aware routing.

A comprehensive domain-reference search found 786 matching lines across tracked
sources/docs; runtime launch overrides, curriculum generation, root navigation,
Hosting manifests/configuration and deployment records were inspected.

App-only certification was truthful about its target while missing the public
entry path. Counting 50 links proves neither their final origin nor their bytes.
`RELEASE_2026-10-01_PRODUCTION_APP_CATCHUP.md` explicitly warned that public marketing
pages remained old; `CURRENT_PLATFORM_STATE.md` repeats that release distinction.

## 5. Intended architecture and bounded corrective decision

There is no evidence that the prior marketing site was strictly marketing-only.
Its explicit manifest and tests preserve public lessons. Historical operations
specification/PDR-022 describes a single Firebase apex origin; later live
separation and release configuration use two sites. Claiming the repository
already unambiguously mandated app-only public lessons would be incorrect.

The current app Hosting artifact already owns every current public lesson, v2
rendition and immutable assessment revision. The requested invariant is one
current production lesson delivery path. The bounded correction implements that
invariant at the existing site boundary: **app.lyfelabz.com is the canonical
production lesson-serving host**, while apex/www remain the public entry/catalog
and marketing host. This is the corrective policy proposed for review here,
not a claim that the old documentation already agreed. No domain remapping,
DNS change, auth migration, curriculum move or content duplication is needed.

## 6. Implemented fix — exactly 5 source files

1. `firebase.marketing.json`: add one anchored 301 redirect, regex
   `^/(lesson_[a-z0-9-]+\.html)$`, destination `https://app.lyfelabz.com/:1`.
2. `scripts/marketing-hosting/build.test.cjs`: extend exact routing contract to
   recognize the new rule, preserving all previous config expectations.
3. `scripts/marketing-hosting/certify-delivery.cjs`: read-only public-entry release
   gate; resolve actual catalog anchors, require full expected lesson coverage,
   follow HTTP redirects, assert final canonical origin/path/query, compare SHA-256
   with the certified app artifact, and test both incident lessons as legacy links.
4. `scripts/marketing-hosting/delivery.test.cjs`: use Firebase CLI's actual
   Superstatic Hosting server to test the two-origin flow, stale-file precedence,
   query preservation, staging destination, unaffected routes, Renewable r1/r2,
   original-failure detection and correct-host/stale-content detection.
5. This report/runbook: `docs/platform/WWW_APP_LESSON_DELIVERY_2026-10-04.md`.

No instructional HTML, runtime, index, generated curriculum manifest, assignment
routing, backend or data changed. Redirects precede static files in Firebase
Hosting, so retained marketing lesson files no longer constitute an independently
reachable current lesson copy. See
[Firebase Hosting response priority and capture syntax](https://firebase.google.com/docs/hosting/full-config).
Keeping the shared allowlist unchanged avoids disturbing the app builder.

## 7. Compatibility

Existing apex/www root lesson links, normal catalog navigation, blog lesson links
and bookmarks reach the matching app root path. Query parameters are preserved;
browsers inherit the original fragment when a redirect Location supplies none.
The rule does not match `/app/**`, nested lesson paths, r1/r2 rendition paths,
variants, investigations, blog, legal pages or Wonder Box. Unknown root lesson
slugs reach the app's normal 404 rather than an arbitrary fallback page.

Educator Mode code, Classroom integration, differentiation and student revision
locking are unchanged. Host-scoped preferences/login storage already present on
www cannot be transferred by an HTTP redirect; users now use the app host's
existing state. No automatic migration of that browser storage is introduced.

## 8. Validation

- Narrow marketing builder plus delivery regression suites: **13/13 tests pass**.
- App Hosting builder: **24/24 tests pass**, including the optional HTTP route
  suite against a local Firebase Hosting server (initial run had that one skipped;
  the completed run has none skipped).
- `npm --prefix app run verify`: **145 Jest suites, 5,870 tests pass**;
  curriculum manifest, lesson synchronization, retained variants, assessment
  quality, TypeScript and ESLint checks also pass.
- App artifact builds successfully: 236 files, 7 retained variants; HTML
  dependencies validated.
- New live gate against app homepage: all **50 lesson navigations + 2 legacy
  query-string checks pass**, matching the app artifact built from 905c9d6.
- New live gate against www: **fails as expected**, detecting the original
  wrong-origin behavior for all 52 checks. This is a reproduced production
  failure, not a claim that the undeployed fix is already live.
- Preserved September marketing candidate plus the redirect -> local current app:
  **50 lessons / 52 checks pass** using the exact prepared artifact.
- Complete source diff reviewed; `git diff --check` passes.
- No backend/data/rules tests were needed: those systems were not changed.

Requires Node, app dependencies and Firebase CLI on PATH for the Hosting tests;
this run used Firebase CLI 15.22.4 (Superstatic 10.0.0).

## 9. Production deployment plan — not executed; staging preview certified

Only **marketing Hosting configuration** needs a production release. App Hosting
already has the correct public lesson bytes. No app redeployment, DNS, Functions,
Rules, Auth settings, assessment publication or Firestore operation is required.

Do not rebuild/deploy the ordinary current `dist/marketing` artifact for this
urgent fix without separately reviewing its accumulated changes since September.
A configuration-only candidate is prepared in ignored `dist/marketing-config-only`,
using all 128 files from the historical marketing commit, stripping legal-page
front matter exactly as its builder does. Each file was compared against live
www: **128/128 byte-identical**. The deployed file inventory is exactly those
128 paths plus Firebase-managed `__/firebase/init.js` and `__/firebase/init.json`;
these reserved initialization resources are supplied by Firebase tooling. The candidate config is
`dist/firebase.marketing-config-only.json`: explicit site `lyfelabz-marketing`,
that exact public directory, existing routing plus the new redirect, no predeploy
hook that could replace the preserved artifact.

After review and separate deployment authorization, the scoped production command
would be (NOT executed here):

```sh
firebase deploy --only hosting --project lyfelabz-prod --config dist/firebase.marketing-config-only.json
```

Before doing so, re-read the current marketing version and revalidate all artifact
hashes; if it changed from `fa5173a7c8c6457f`, regenerate the preserved artifact
from the actual current release rather than overwrite someone else's changes.
After release, run the public gate below against both apex and www, inspect the
Hosting release version and retain its evidence. A normal future marketing build
uses the tracked redirect automatically. Rollback restores the previous marketing
release; browser-cached 301s may persist, so retain valid app lesson routes.

Staging must exercise the split host path, not just the staging app homepage.
A local preview config is prepared at `dist/firebase.lesson-entry-staging.json`:
same artifact/rules, explicit site `lyfelabz-staging`, app redirect destinations
changed to `https://lyfelabz-staging.web.app`. After separate authorization, publish
that config to a **preview channel**, never staging live (which serves the app):

```sh
firebase hosting:channel:deploy lesson-delivery --project lyfelabz-staging --config dist/firebase.lesson-entry-staging.json --expires 1d --no-authorized-domains --non-interactive
```

The continuation published and certified the preview described in section 13.
For future runs, ensure the chosen app release is on staging live and build its
matching app artifact. Use the preview URL as `--entry`, staging live as
`--canonical`, and its artifact as `--artifact`. This exercises preview public
catalog -> lesson redirect -> staging app -> current bytes. Always pass
`--no-authorized-domains` when deploying this unauthenticated preview so the CLI
does not modify Firebase Auth authorized domains.

## 10. GitHub Desktop and source safety

Exactly **5 changed/untracked source files** belong to this operation, listed in
section 6. Open the isolated worktree in GitHub Desktop to review them. They are
not mixed into the normal development checkout. Ignored build/test/dependency
outputs and prepared deployment artifacts are not source changes to commit.
HEAD remains the requested base; no new commit or branch was created.

## 11. Permanent release certification

Build from the actual approved release checkout, then run:

```sh
npm --prefix app run build
node scripts/app-hosting/build.cjs
node --test scripts/marketing-hosting/*.test.cjs
node scripts/marketing-hosting/certify-delivery.cjs
```

The last command defaults to BOTH `https://lyfelabz.com/` and
`https://www.lyfelabz.com/`, expecting `https://app.lyfelabz.com` and
`dist/app-hosting`. It must be a mandatory release acceptance gate, including
app-only lesson releases. A green direct-app check is merely a control.
No tracked Hosting deployment automation exists to wire this into automatically;
the release operator must run the gate and retain its result.

For staging:

```sh
node scripts/marketing-hosting/certify-delivery.cjs --entry https://THE-PREVIEW-URL/ --canonical https://lyfelabz-staging.web.app --artifact dist/app-hosting
```

Also use a fresh browser context to enter apex and www, select the visible Carbon
Cycle and Renewable cards normally, confirm the app host, verify the current
Carbon diagram and NYC evidence/r2 declaration, and open an existing bookmarked
URL with a fragment/query. This complements the automated static-anchor/HTTP-byte
gate with actual browser navigation and fragment behavior; the script does not
execute arbitrary homepage JavaScript. Do not require sign-in, create assignments,
or write data for this public delivery check.

Raw HTTP metadata, Hosting inspection, full domain search, parity evidence and
suite logs for this investigation are retained in
`/private/tmp/lyfelabz-delivery-audit/` (temporary evidence, not source files).

## 12. Gate 1 — full app release provenance (PASS)

The later releases are expected, separately authorized operations recorded in the
ChatGPT task **🟢 Sprint 30 UX Polish**, conversation
`6ab6fa0f-dd14-83e9-bf35-428f81eb3d7f`. Its Teacher Roster production authorization
is turn `b780bd95-2192-4fa0-b9ae-0d89c851c732`; the completed production report is
in user turn `c684661a-d2e3-4c21-84f9-68ef6aafda60`. These are historical evidence,
not authorization for a production deployment in this operation.

| App Hosting version | Release timestamp (UTC, Oct 4) | Source commit / operation | Independent file-hash match |
| --- | --- | --- | --- |
| `92046ea1f5745492` | `00:18:53.740Z` | `905c9d691bd4a3d4ecb4cdab6685f18ed6ee5253`, original certified release | 229/229 |
| `853ef27cc4151deb` | `02:09:02.203Z` | `c9bf1ac4421d110a50163d3d339d1b93e3784e00`, Student Navigation | 229/229 |
| `66a47e5a18ba6dcc` | `03:59:37.489Z` | `7047b5789da85c29e5f43add409652616fd8641a`, Teacher Roster UX | 229/229 |

All were deployed with Firebase CLI by the same recorded owner account.
The current version was created at `03:59:34.437995Z` and finalized at
`03:59:37.713419Z`; the release ID is `1791086377489000`. The table uses release
timestamps, distinguished from version create/finalize times. In New York these
three releases occurred October 3 at 8:18:53 PM, 10:09:02 PM and 11:59:37 PM EDT.

Provenance was not inferred from two lesson files or a release label. Firebase
stores a deployment-tool label but no source SHA here. Committed sources for
c9bf1ac and 7047b57 were exported into separate temporary directories with
`git archive` and rebuilt with real dependencies; the clean operation build
provided 905c9d6. Every deployed user-file hash in each historical Hosting version
matches its corresponding clean build after Firebase's level-9 gzip encoding.
Each build contains 236 files; the unchanged app Hosting ignore policy excludes
7 blog/Wonder Box files, leaving 229 user files. Hosting adds its 2 reserved
Firebase init resources: **231 deployed paths per version**.

Read-only HTTP comparison independently matched **229/229 current app responses**
to the fresh 7047b57 build. Historical inventories have identical path sets and
Hosting routing/header configuration. Reserved initialization hashes are unchanged.

Exactly six production file paths changed between 92046 and 66a47:

1. `/app/dist/bundle.js`
2. `/app/index.html`
3. `/app/lessons/index.html` (the app-shell copy)
4. `/assets/lyfelabz-assessment-runtime-active.js`
5. `/assets/lyfelabz-assessment-runtime.js`
6. `/index.html`

The first later commit contains 11 source files implementing Student Navigation.
The second contains 17 Teacher Roster UX files; 26 unique source files changed
across both commits. From 853ef to 66a47, only bundle.js and the two app-shell
HTML paths changed. No lesson instructional HTML, assessment rendition, retained
variant, revision-paths table, or Hosting routing configuration changed across
either release. Thus the redirect destination's lesson content and immutable
revision behavior remain the certified content.

**The earlier dirty-main inventory needs precise interpretation:** its five
modified navigation/runtime files and two new navigation source/test files were
subsequently committed in c9bf1ac and intentionally entered production through
the Student Navigation release. They are also inherited by 7047b57. They were not
silently copied from an unfinished working tree into an unexplained release.
There are **zero bytes beyond the committed artifacts** in the inspected
production user files. The multilingual architecture document remains untracked
and absent from Hosting. This redirect operation still incorporates none of those
later source changes into its five-file diff.

The historical production-release worktree path exists in `git worktree list`,
but OS permissions prevented reading it. The independent Git-object exports,
rebuilds, historical Hosting hash inventories and live-response comparisons
provide provenance without relying on that directory or its old generated files.

**Gate 1 conclusion:** 66a47e5a18ba6dcc is the expected, authorized Teacher Roster
release, with the committed Student Navigation baseline. It is safe as the
canonical destination for this bounded public-lesson redirect.

## 13. Gate 2 — hosted staging/preview certification (PASS)

Environment: project/site `lyfelabz-staging`; new channel
`www-app-delivery-20261004`, serving the preserved marketing artifact.
Canonical destination: `https://lyfelabz-staging.web.app`, existing staging live
version `4f326810ce9ec90e` (Teacher Roster accepted artifact).

Preview URL:
https://lyfelabz-staging--www-app-delivery-20261004-vymcbeea.web.app

- Preview version: `634c6c4f0568e2d1`
- Preview release: `1791118504685000`
- Released: `2026-10-04T12:55:04.685Z`
- Expires: `2026-10-05T12:55:01.998846035Z`
- Actual command executed, staging preview ONLY:

```sh
firebase hosting:channel:deploy www-app-delivery-20261004 --project lyfelabz-staging --config dist/firebase.lesson-entry-staging.json --expires 1d --no-authorized-domains --non-interactive --json
```

The preview contains exactly the same redirect rule shape as production, with
only destination origins changed to staging. Explicit site configuration and a
Hosting-only config constrain the deployment. `--no-authorized-domains` disables
the CLI's automatic Auth-domain synchronization. Neither staging live nor either
production site was deployed.

A fresh headless Chrome context executed the page JavaScript and clicked the
visible links selected from each actual catalog card. No images or screenshots
were generated. Sign-in was not used; non-GET/HEAD requests and Firestore traffic
were blocked throughout the browser certification.

| Browser case | Carbon Cycle | Renewable |
| --- | --- | --- |
| Actual catalog-card click | PASS: one 301 to identical staging app path | PASS: one 301 to identical staging app path |
| Current rendered content | Visible Animal respiration label at SVG (350, 190) | Visible NYC 1990–2010 evidence table and r2 declaration |
| HTML bytes | Exact 905c9d6 SHA-256 | Exact 905c9d6 SHA-256 |
| Direct legacy bookmark | PASS | PASS |
| Query preservation | PASS, including percent-encoded space | PASS, including percent-encoded space |
| Query plus fragment | `#explore` retained; actual scroll to target | `#evidence` retained; actual scroll to target |
| Redirect chain / loop | Exactly one 301, then 200; no loop | Exactly one 301, then 200; no loop |

The browser query was
`?mode=educator&delivery-cert=preview&topic=carbon%20cycle`. Fragment checks
observed Carbon scrollY 4295 with target top 10.1875px, and Renewable scrollY
5070 with target top 37.71875px. All **8 browser scenarios passed**.

The permanent read-only gate passed **50 actual catalog lesson links + 2 legacy
query links = 52 checks** through the hosted preview, comparing all returned lesson
bytes to the certified artifact. The staging app preflight independently passed
the same 52 checks.

**107 exclusion/content HTTP checks passed:**

- All 78 nonlesson marketing files retain their exact bytes and return 200.
- `/app/lessons/lesson_carbon-cycle.html`, the corresponding Renewable lesson,
  Renewable r1/r2 rendition routes and `revision-paths.json` are not intercepted:
  marketing preview retains 404, canonical staging app retains 200.
- `/app/signin`, `/app/onboarding`, `/app/pending`, `/app/teacher`, `/app/student`
  and `/app/a/...` keep the same boundary: marketing 404, app shell 200.
- Existing exact `/app` and `/app/` marketing redirects remain 301 to the app
  shell (staging destination in preview).
- Root homepage, legal rewrites, blog/Wonder Box directory behavior and static
  assets remain functional; no lesson wildcard intercepts them.

The preview version's complete user-file inventory matches the preserved candidate
**128/128**, including underlying lesson files shadowed by the redirect. Before
preview deployment, current live www also matched **128/128**. No unexpected
marketing content changed.

After preview certification, Hosting API checks confirmed these live releases
unchanged from the before snapshot:

| Site | Live version before = after |
| --- | --- |
| Production app `lyfelabz-prod` | `66a47e5a18ba6dcc` |
| Production marketing `lyfelabz-marketing` | `fa5173a7c8c6457f` |
| Staging live `lyfelabz-staging` | `4f326810ce9ec90e` |

Post-preview regression reruns completed successfully:

| Suite / command | Exact result |
| --- | --- |
| Operation worktree `npm --prefix app run verify` (905c9d6 + the five-file correction) | 145/145 suites; 5,870/5,870 tests |
| Independently reconstructed current production commit 7047b57, same full verify command | 149/149 suites; 6,024/6,024 tests |
| Marketing builder + delivery regression suites | 13/13 tests, zero skipped |
| App Hosting builder, including local HTTP route suite | 24/24 tests, zero skipped |
| Hosted preview permanent delivery gate | 52/52 checks |
| Fresh-browser certification | 8/8 scenarios |
| Hosted exclusions/nonlesson content checks | 107/107 checks |

Both full verify runs include successful curriculum, lesson synchronization,
variant, assessment-quality, typecheck and lint gates. The operation app build and
236-file Hosting artifact build pass. The complete five-file diff was reviewed
again; tracked and new-file whitespace checks pass. The four implementation/test
files are byte-identical to the accepted first-pass implementation. Only this
report changed during continued certification.

**Final verdict: SAFE TO AUTHORIZE PRODUCTION.** Authorization has not been given
for the production command; stop here without running it.

## 14. Final authorization boundary

The accepted architecture and implementation were not changed again. Only this
existing report was extended. The exact five-file list remains in section 6;
HEAD remains detached at 905c9d6 and all five changes remain uncommitted.

The proposed production-visible functional change is exactly:
root `/lesson_<slug>.html` requests on apex/www return a 301 to the identical
`https://app.lyfelabz.com/lesson_<slug>.html` path, with query and browser fragment
behavior certified above. All 128 existing marketing content files retain their
bytes; existing nonlesson routes/configuration remain unchanged.

The exact proposed production target is project **lyfelabz-prod**, site
**lyfelabz-marketing**, using the explicit-site configuration-only candidate:

```sh
firebase deploy --only hosting --project lyfelabz-prod --config dist/firebase.marketing-config-only.json
```

**This production command has NOT been executed.** It would deploy ONLY marketing
Hosting. It would NOT deploy app Hosting, Functions, Firestore Rules, indexes or
Storage; would NOT modify Auth; would NOT write Firestore; and would NOT change
DNS. The config has only a `hosting` section, explicit `site: lyfelabz-marketing`,
an absolute preserved artifact directory, and no predeploy hook. Its SHA-256 is
`a9e4a7b9119e7fabb816fa82d675f6165c9a9f25a28c66d3dd56c801b149a016`.

Recheck the production release baselines immediately before an authorized deploy;
a concurrently changed marketing release requires refreshing the preserved
artifact rather than overwriting it. Expiry of the temporary preview does not
change production or staging live.

Continuation evidence (full inventories, file hash comparisons, clean builds,
browser results, HTTP exclusions and test logs) is under
`/private/tmp/lyfelabz-delivery-gates/`. The temporary browser/check scripts and
ignored deployment artifacts do not add source files to this operation.

## Stop conditions

ZERO images generated, ZERO commits, ZERO pushes, ZERO production deployments,
ZERO DNS changes, ZERO Firestore writes. Exactly one authorized staging preview
deployment; no staging-live deployment or Auth change. Original checkout
untouched. STOP UNCOMMITTED.
