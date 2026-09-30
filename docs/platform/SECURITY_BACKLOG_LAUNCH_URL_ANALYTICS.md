# Security Backlog: Launch Context in Lesson URLs and Analytics

**Status:** Opened 2026-09-29 from the Earth's Layers r2 Stage B staging certification and the follow-up read-only reconnaissance. Item 1 is **resolved and staging-certified** by the launch-URL fragment hardening (commit `432e728`, staging Hosting `a473c38faacc9396`); production is not deployed. Items 1b, 2, 3 and 4 are **resolved by policy**: the owner approved Policy E (2026-09-29), the Hosting analytics boundary described below. Staging release `737d935a2c048330` exposed a 304 cache-transition defect (below). With the transition fix (commit `6776da5`, staging Hosting `f8b1c6edb86e71de`), Policy E is **staging-certified** (2026-09-29), with an owner-accepted transition residual, and **live in production** since 2026-09-30 (Hosting `1fdb7d3ff3ead2aa`; see "Production catch-up").

## Background

Every lesson page, meaning all 49 canonical lessons, their generated v1 and v2 pages, revision renditions, and retained differentiated artifacts, loads the same inline Google Analytics snippet:

- `gtag('config', 'G-9QHB5G2B5B')`, with no parameters;
- an automatic `page_view`;
- enhanced measurement on.

GA4 sends the page location as `dl` = the URL **including its query string but not its fragment**, and the referrer as `dr` = `document.referrer`. Both were verified on staging (2026-09-29). The authenticated application shell (`/app/`, My Science, the teacher workspace, `/app/a/{id}`) loads no analytics.

## Item 1: `assignment` and `launchRef` in the query string (RESOLVED; staging-certified 2026-09-29; live in production 2026-09-30)

**Finding.** The assignment launcher put the launch context in the query string (`…?assignment=<id>&launchRef=<grant id>`). Every lesson-page analytics hit therefore sent both values to Google Analytics:
- directly, in `dl`;
- second-hand, in `dr` on the next same-origin page (for example after a Connections link).

The assignment id also embeds the lesson slug, the class id, and a lowercased prefix of the teacher's uid (`mintAssignmentId`).

**Significance.** The `launchRef` is a 128-bit CSPRNG launch-grant id.
- It is evidence, not authorization. `assessmentSessionsBegin` authenticates and authorizes the student first, and the grant is bound to `studentId`, `assignmentId` and `lessonSlug`.
- It lasts 6 hours (TTL).
- Server code never logs it.

Disclosure grants nothing on its own, but authorization-related material and internal identifiers should not go to third parties.

**Resolution (client only).** `buildAssignmentLaunchUrl` and `planAssignmentLaunch` (`app/src/assignments/studentList/launch.ts` and `launchRouting.ts`) now place the launch context in the URL fragment: `…#assignment=<id>&launchRef=<grant id>`.
- A fragment is never part of an HTTP request, a `Referer` header, GA's `dl`, or `document.referrer`.
- The assessment runtime is unchanged. It already read the query first and then the fragment, so legacy query-form links still work. The committed runtime asset is byte-identical.
- No lesson HTML, retained presentation, presentation revision id, assessment revision, launch grant, TTL, or authorization rule changes.
- The change ships with the next app Hosting release. Browsers holding the previous bundle keep producing query-form links until the cache expires (`max-age=3600`).

**Staging certification (2026-09-29).**
- **Release.** Commit `432e728979e6aa530cf156d9178cc170c79f957a`, built in the clean worktree `lyfelabz-lf-release` with real installs.
  - Gates: app 134 suites and 3763 tests; Functions 156 suites and 4101 tests; Hosting 228 files, 14 pass and 1 skipped.
  - Hosting only: version `a473c38faacc9396`, released 2026-09-29T15:39:09.112Z. The served delta is exactly `/app/dist/bundle.js` (SHA-256 `6cd6dc70…`, 1,482,621 bytes); everything else is byte-identical, including every lesson page, rendition, retained variant and the runtime asset.
- **Cache checkpoint.** The browser `cache: "reload"` hash and the fresh-navigation decoded size (1,482,621 bytes) equal the release. The My Science fingerprints read `…__r2.html#assignment=…` and `…__r1.html#assignment=…`.
- **Launches (no submission):**
  - My Science r1: `pr90f…` + `ap1fed…`, r1.
  - My Science r2: `pr6b7c…` + `ap515838…`, r2.
  - `/app/a/{id}` for both.
  - A canonical fallback (flag false 15:42:00Z to 15:42:22Z, restored and independently verified true): r2 rendition, four choices.

  Every lesson URL had an empty query string and `#assignment=…&launchRef=<32 hex>` in the fragment. Each fragment launchRef matched the grant the server minted for that launch (`a1ac9965`, `7796129e`, `394ac7ce`).
- **Reload** (navigation type `reload`) kept the fragment, the same launchRef, and assignment context.
- **Legacy link.** A legacy `…__r1.html?assignment=<id>` link still activates assignment context. The legacy `launchRef` query form is proven by the runtime tests (`launchContext.test.ts`) on runtime source whose build is byte-identical to the deployed runtime asset; no live grant id was put in a GA-observed URL for it.
- **Google Analytics.** Across every `/g/collect` request from these launches, `dl` had no query; neither `assignment=`, `launchRef`, nor any launchRef value appeared; the fragment was never transmitted. After a same-origin Connections navigation from an assignment page, the next page's `dr` is the bare lesson path, with no fragment or launch context.
- **Integrity.** Unchanged: both assignments, all attempts (best r1 40%, r2 70%), both Current pointers, sessions (none), passbacks (0), the scoped r1 and r2 coverage, the AP records, accommodation, Functions, and production.
- **Mutations.** The Hosting release, the flag round trip, and 10 launch grants from certification launches (with their audit events).

## Approved policy: the Hosting analytics boundary (Policy E)

**Decision (owner, 2026-09-29).**
- Google Analytics stays on genuinely public pages: the marketing site and the root public pages on either Hosting site, including root `/lesson_*.html`.
- Google Analytics does not operate anywhere under `/app/lessons/**`, the educational-delivery zone. That zone covers:
  - authenticated assignments and assessment interactions;
  - differentiated variants and canonicalFallback launches;
  - historical retained variants and revision renditions;
  - deep-link practice and teacher preview;
  - the companion pages and the shell copy that the application artifact places beside the lessons.

  Suppression is by **path, not by detected assignment context**. The inline gtag snippet runs before the deferred runtime can detect context, and deep-link practice arrivals carry no `assignment=` at all.

**Mechanism.** Firebase Hosting response headers in `firebase.json`. No lesson HTML, rendition, retained presentation, `presentationRevisionId`, runtime asset, app bundle, Function, or Rule changes. The now-inert gtag snippet stays in the lesson HTML on purpose: removing it would change v2 bytes and force new presentation revisions.

| Source | Header |
|---|---|
| `/app/**` | `Referrer-Policy: strict-origin` |
| `/app/lessons/**` | `Content-Security-Policy: script-src 'self' 'unsafe-inline' https://apis.google.com https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js` |

Hosting applies every matching rule, so `/app/lessons/**` responses carry both headers. Other `/app/**` routes, including `/app/a/**`, `/app/student` and `/app/teacher`, carry only the referrer policy. Root public pages carry neither. All of this was verified on served headers in the Hosting emulator.

**Why each script source is allowed.**
- `'self'`: the assessment runtime chain (`/assets/lyfelabz-assessment-runtime.js`, `lyfelabz-firebase-config.js`, `lyfelabz-assessment-runtime-active.js`), plus `/app/dist/bundle.js` for the shell copy at `/app/lessons/index.html`.
- `'unsafe-inline'`: every lesson's inline scripts and inline event handlers (for example `onclick="elSelectAnswer(…)"`).
- `https://apis.google.com`: Firebase Auth's own gapi loader. The SDK loads `js/api.js` and then its gapi iframe modules proactively on mobile, Safari and iOS browsers whenever `getAuth()` runs; this was observed on a mobile user agent against the emulator. It is not an analytics endpoint.
- The exact jsPDF 2.5.1 file: the PDF export of the Body Systems companion pages (`system_*`, `extension_body-systems`, `game_photon-runner`). It is pinned to the exact file, not the CDN host, and loads no further scripts.

**Deliberately not granted.** `https://www.googletagmanager.com`, so gtag.js never loads, the inline snippet only fills a local `dataLayer`, and no `/g/collect` hit is sent. Also not granted: `'unsafe-eval'`, workers, `blob:`, `data:`, and reCAPTCHA (`https://www.google.com`), which the Firebase SDK bundles but nothing in the zone invokes.

The one expected console error on zone pages is the blocked gtag.js load. `scripts/app-hosting/build.test.cjs` guards every external script origin in the zone: a new one fails until it is explicitly decided and the CSP is reconciled.

**Referrer policy.** The browser Firebase API keys tolerate an origin-only `Referer`:
- the staging key's allowed referrers are `https://lyfelabz-staging.web.app/*` and `https://lyfelabz-staging.firebaseapp.com/*`, which the origin form matches;
- the production key has no referrer restriction.

No LyfeLabz code reads `document.referrer`.

## Policy E cache transition (304 defect; fix staging-certified 2026-09-29; live in production 2026-09-30)

**Defect (staging, 2026-09-29).** On fresh 200 responses Policy E behaves as designed. Firebase Hosting, however, sends **304 Not Modified without the custom headers** (no CSP, no Referrer-Policy); `curl` against staging `737d935a2c048330` confirms this.

Policy E changed headers only, so lesson bytes and ETags did not change. A browser holding a copy of a `/app/lessons/**` page cached before Policy E therefore keeps it, headers included:
- it reuses the copy with no request while it is fresh (`max-age=3600`);
- it then revalidates to a headerless 304 and keeps the old stored headers, indefinitely.

That copy has no CSP, so gtag.js loads. Staging recorded one `/g/collect` hit from the historical r1 variant this way.

**Mechanism.** Before product navigation into `/app/lessons/**`, the browser's cached copy of the exact target is replaced. The request is:

`GET <target without fragment>`, `cache: "reload"`, `credentials: "same-origin"`, with the body read to the end.

- `reload` makes an unconditional request and stores the full 200, which carries the current headers.
- The navigation that follows then uses a copy governed by the current policy. A later revalidation 304 only refreshes the headers it carries, so the stored CSP persists.
- `no-cache` does not work: it revalidates to the headerless 304. `no-store` never writes the cache. `HEAD` never replaces the stored GET.
- Preparation is best-effort. On failure, or after 4 s, the navigation proceeds exactly as before.
- The fragment (launch context) never enters the request. The navigation URL (fragment and any legacy query) is unchanged.

**Coverage.**
- **Application bundle** (`app/src/assignments/studentList/deliveryNavigation.ts`, wired in `browserLaunch.ts`): `executeLaunch` prepares before every navigation. That covers My Science canonical, canonicalFallback, differentiated (after the existing HEAD probe) and revision-bound renditions, the `/app/a/{id}` assignment and practice handoffs, and the canonical fallback after a failed or rejected variant.
- **Teacher Preview:** a plain click opens the tab synchronously, severs its opener, prepares, then loads the unchanged href. Modified clicks keep native behavior.
- **Links between delivery pages:** the shared runtime shim (`assets/lyfelabz-assessment-runtime.js`, SHA-256 `d07473b3…` to `e77b0458…`) holds a plain same-tab click on a same-origin `/app/lessons/**` link, prepares the target, then follows the unchanged href. It installs only on `/app/lessons/**` pages. It leaves untouched in-page fragments, other origins, `/app/` and root links, modified clicks, `target`/`download` links, clicks a lesson handler already handled, and all buttons (quiz controls). No lesson HTML, rendition, retained variant or `presentationRevisionId` changes.
- **App shell** (`app/index.html`): it also states `<meta name="referrer" content="strict-origin">`. The byte change gives every cached shell a new ETag, so the next revalidation (within `max-age=3600` of the release) returns a 200 with the header. The meta keeps the policy in the document regardless of headers.

**Owner decisions (2026-09-29).** The owner approved the implementation and made three decisions.

*Accepted transition residual.* This is an accepted residual. It is **not zero risk**, and it is distinct from the steady-state Policy E architecture. It applies only to browsers that cached a `/app/lessons/**` resource before Policy E. Navigation the product does not initiate cannot be prepared:
- direct typed URLs;
- bookmarks;
- history and session restore to a representation cached before Policy E;
- links from the 22 zone pages that load no runtime shim (the body-system `system_*`/`disease_*` pages, the `about_*` pages, `body-system-*`, and the shell copy `index.html`, pinned in `scripts/app-hosting/build.test.cjs`). Links **to** those pages from runtime-bearing pages are prepared;
- the shell transition: a browser-initiated `/app/a/{id}` arrival can reuse a still-fresh pre-release shell copy, with the browser-default referrer policy, for up to one hour (`max-age=3600`) after the release.

Such a stale copy stays stale until:
- the product navigates to that URL;
- the browser evicts it;
- the user hard-reloads.

While stale, each visit can send Google Analytics the page path without query or fragment. The exception is a pre-hardening `?assignment=` URL restored from history, which also sends that query.

The residual is transitional. Fresh responses always carry Policy E. Every product-controlled launch and prepared link replaces the stale copy it targets. The population of pre-policy cache entries only shrinks. Explicitly rejected, because they add disproportionate complexity or broader cache behavior for a shrinking condition:
- `Clear-Site-Data`;
- a service worker;
- cache-busting query parameters;
- any change to immutable lesson artifacts.

Self-healing detection in the shim, which would act only after a first hit, is also not implemented.

*Shared runtime shim: approved.* The shared, mutable runtime shim may prepare same-tab `/app/lessons/**` navigation targets before navigation. Only shared platform navigation behavior changes. For retained variants and renditions, all of these are unchanged:
- bytes and SHA-256 hashes (`variants:verify`);
- `presentationRevisionId`s;
- lesson content;
- assessment and scoring behavior.

Historical retained presentation artifacts remain immutable.

*ASTRA-004: approved, fail-closed.* The historical ASTRA-004 staging preparer (`platform/functions/src/scripts/astra004-hosting-prepare.ts`) still requires the working-tree shim to match the reviewed overlay hash `d07473b3…`. At HEAD it therefore **refuses** to prepare, rather than silently accepting the modified shim. Its test suite validates the previously approved overlay bytes as committed in `1ab9609`, the approval commit. `APPROVED_OVERLAY_SHA256` is unchanged.

**Staging certification (2026-09-29).**
- **Release.** Commit `6776da5f58d66f6a4ad08255b64587004388e23e`, built in the clean worktree `lyfelabz-pc-release` with real installs.
  - Gates: app 137 suites and 3862 tests; Functions 156 suites and 4101 tests; Hosting 23 pass and 1 skipped.
  - Hosting only. The live sequence was:
    - `737d935a2c048330`;
    - `a473c38faacc9396` (the pre-Policy-E version, released for fixture creation at 22:01:27.417Z);
    - `f8b1c6edb86e71de` (released 22:02:30.524Z).

    Staging was without Policy E for 63 s.
  - All 221 deployed files are served byte-identical to the artifact. The served delta against `737d935a2c048330` is exactly:
    - `/app/dist/bundle.js` (`e26927d3…`, 1,486,057 bytes);
    - `/app/index.html` and its copy `/app/lessons/index.html` (`4b5d7958…`);
    - `/assets/lyfelabz-assessment-runtime.js` (`d07473b3…` to `e77b0458…`).

    Every lesson page, rendition, retained variant, and the active runtime is byte-identical.
- **Genuine stale fixture.** While `a473c38faacc9396` was live, the signed-in certification browser fetched six real staging pages with `cache: "reload"`. It loaded no document, so gtag never ran. `only-if-cached` confirmed the stored copies had no CSP, the same ETags as the current bytes, and dates of 22:02:17-18Z. They were:
  - the `pr90f…` and `pr6b7c…` variants;
  - both Earth's Layers renditions;
  - `lesson_plate-tectonics.html` and `lesson_earthquakes.html`.

  After the fix was released, all six were still stored without the CSP.
- **Healing (primary gate): My Science r2 differentiated launch into the stale `pr6b7c…` copy.**
  - The launch ran the HEAD probe, then the preparation GET, then the document navigation.
  - The stored copy then carried the CSP and `strict-origin` (Date 22:04:45Z). The navigation was served from it (`transferSize` 0), and the document ran under the CSP (eval blocked).
  - gtag.js was blocked by the CSP before any request, `google_tag_manager` was undefined, and there was no `/g/collect`.
  - The fragment kept `assignment` and the 32-hex `launchRef`, with an empty query. The correct presentation loaded, and the active runtime 17.5.0 loaded with the staging config and no error.
  - A reload revalidated to a 304 (`transferSize` 300). The stored CSP persisted (Date 22:06:12Z).
- **Matrix.**
  - `/app/a/{id}` r1 arrival into the stale `pr90f…` copy: prepared (HEAD, GET, document), CSP stored (22:06:58Z), gtag blocked. The lesson's `document.referrer` was the bare origin.
  - A real Connections click from that page into the stale `lesson_plate-tectonics.html` copy: the runtime shim prepared it (GET, then document), CSP stored (22:07:20Z), gtag blocked.
- **Not exercised on staging** (automated tests and the local Chrome reproduction cover them):
  - canonical and canonicalFallback launches, including the rendition targets, which need the delivery flag changed;
  - Teacher Preview, which needs a teacher session;
  - deep-link practice, which has no valid fixture.
- **Referrer.** The public root page reached from a delivery page received the bare origin as `document.referrer`: no assignment id, launchRef, or variant path.
- **Public analytics.** The root page loads gtag.js and sends its `/g/collect` page view, with no CSP.
- **jsPDF.** `system_nervous.html` loads the pinned jsPDF file and generates a PDF (`%PDF-1.3`) under the CSP, with gtag blocked.
- **Real Safari (owner, iPhone/iPad).** From My Science, the Earth's Layers lesson opened and behaved normally, with no submission.
  - Tapping answers autosaved: a live r2 session (`…3rb8j6cfpceua`, attempt 1, differentiated `pr6b7c…`, 2 responses) began at 22:16:50Z.
  - This confirms Firebase Auth, session begin, and autosave under the CSP in Safari.
- **Integrity.** Unchanged:
  - attempts: r1 a1 to a4, best 40%; r2 a1 to a2, best 70%;
  - both Current pointers;
  - 0 passbacks;
  - the r1 and r2 coverage;
  - the AP records;
  - the flag (true).

  Added: 7 launch grants from ordinary My Science and `/app/a` loads. They remain.

  The Safari check also started the live r2 session above. It was removed as explicit, owner-authorized staging certification cleanup (2026-09-29):
  - The session was re-read and verified: live, r2, `sessionOrdinal` 1, differentiated `pr6b7c…`, 2 responses, started 22:16:50.501Z, the student's only session, no subcollections.
  - That one document (`assessmentSessions/<r2 assignment>__<student>__1`) was deleted with an `updateTime` precondition. This is the same single-document delete as the staging driver's `resetSession`, which is hard-wired to the synthetic fixture.
  - Afterwards, the whole integrity snapshot equals the pre-deploy baseline, with no sessions, apart from the launch-grant count.
- **Accepted residual.** Unchanged and not re-tested. The certification browser still holds stale copies of both renditions and `lesson_earthquakes.html`.

## Production catch-up: Slice 9, Earth's Layers r2, fragment hardening, Policy E (2026-09-29 to 09-30)

Production was at Hosting `fc8feef66cddca29`, proven to be commit `4ebaad1` (all 216 deployable files byte-identical to its rebuilt artifact), with Functions predating Slice 9. Deploying HEAD directly would have shipped the 9D client over pre-9C-1 Functions and failed every assignment launch (addendum 21.10). Production was therefore brought forward in the certified dependency order, each phase separately owner-authorized. Differentiated delivery stayed dark throughout: `platformConfig/differentiatedDelivery` is absent, and no coverage or AP record was published.

1. **P1 Functions (2026-09-29T22:54:27Z to 22:54:30Z).** Exactly `assessmentSessionsBegin`, `assignmentsListForStudent`, `lmsDeepLinkResolve`, `assessmentSessionsAutosave`, and `assessmentAttemptsFinalize`, deployed from HEAD `6930452`.
   - Each deployed source archive equals HEAD's 422 source files, with the release build's `lib`.
   - The other 65 Functions are unchanged. Finalize keeps its Classroom secret (version 4).
   - Before the deploy, all 25 live production sessions (r1, canonical) were checked against the new revision-bound response validator; none would be refused.
2. **P2 Stage A Hosting (`04a3bffc0b91518b`, 2026-09-29T23:18:15.275Z).** Built from `8b6773a`.
   - 106 files changed or were added:
     - the Slice 9B r1 declarations (96 lesson pages, each byte-identical to production apart from the one block);
     - the 9D bundle and active runtime;
     - the r1 and r2 renditions and `revision-paths.json`;
     - the inert `pr90f…` and `pr6b7c…`;
     - the approved Conducting Experiments improvement `e5306e4`.
   - No headers.
   - The owner's production beta student then opened the existing Earth's Layers assignment from My Science. It routed to the r1 rendition, with no answer or submission.
3. **P3 Earth's Layers r2 data (2026-09-30T00:20:50Z).** More than 3600 s after P2.
   - `deploy-assessment.ts --target=production` wrote the r2 revision and answer key, both equal to the committed payload, and advanced `currentRevisionId` from r1 to r2.
   - The r1 documents and the existing r1 assignment are unchanged.
4. **P4 Hosting (`1fdb7d3ff3ead2aa`, 2026-09-30T00:26:01.579Z).** Built from HEAD `6930452`, byte-identical (221/221) to the staging-certified `f8b1c6edb86e71de`.
   - The delta from Stage A was:
     - the two Stage B Earth's Layers pages (r2);
     - the fragment and cache-transition bundle;
     - the app shell and its `app/lessons/index.html` copy;
     - the runtime shim;
     - the Policy E headers.
   - Served headers are correct by zone on all 221 files: the CSP plus `strict-origin` under `/app/lessons/**`, `strict-origin` only elsewhere under `/app/**`, and neither on public pages.
   - Verified in production:
     - gtag.js is blocked and no `/g/collect` is sent on zone pages;
     - the root page sends its GA page view;
     - the pinned jsPDF loads and generates a PDF under the CSP.
   - The signed-out certification browser held a genuine pre-Policy-E production copy of `/app/lessons/lesson_earths-layers.html`. A real Connections click from `lesson_plate-tectonics.html` produced the runtime shim's preparation GET before the navigation. The page was then served from the replaced copy, with the CSP, declaring r2, and with gtag blocked.
   - The production bundle carries fragment-form launch context and the preparation mechanism. With the flag absent no launch grant is minted, so production launch URLs carry `#assignment=` only. Grant-bearing fragments are staging-certified.

**Integrity.** Across P1 to P4, only these changed: the five Function revisions, the two Hosting releases, and the three P3 documents. Unchanged: the assignments (22, all r1), attempts (144), live sessions (25), passbacks (99), Current pointers (4), launch grants (0), the legacy `prff01…` coverage, AP records (0), and Rules.

**Separately tracked.**
- The production `lmsGradePassbacks*` Functions still run `60b5f6a` source, predating `4ebaad1`'s passback-engine and Classroom-provider changes. This is pre-existing, is not a Slice 9 dependency, and needs its own reconciliation.
- AP and scoped-coverage publication, and differentiated-delivery activation, remain separate owner decisions.
- The accepted transition residual applies to production browsers that cached `/app/lessons/**` pages before 2026-09-30T00:26Z.

## Item 1b: assignment id in GA `dr` after a `/app/a/{id}` arrival (RESOLVED by policy; staging-certified 2026-09-29; live in production 2026-09-30)

The Google Classroom arrival URL `/app/a/{assignmentId}` carries the assignment id in its **path**; this is the external Classroom contract and does not change. `/app/a/{id}` itself never ran analytics. The exposure came from the destination lesson page, whose GA `dr` was the arrival URL.

Every arrival handoff target is under `/app/lessons/**`, where GA no longer loads, so no GA hit carries the arrival path. As defense in depth, `Referrer-Policy: strict-origin` on `/app/**` makes any navigation out of an `/app` page report only the origin. That includes a future link from the shell or a lesson to a GA-bearing public page. Verified in the emulator: `document.referrer` after leaving a `/app/lessons/variants/…` page is the bare origin.

## Item 2: differentiated `/variants/` path reveals accommodated delivery (RESOLVED by policy; staging-certified 2026-09-29; live in production 2026-09-30)

A differentiated launch loads `/app/lessons/variants/lesson_<slug>__pr<hash>.html`. Under the boundary, GA receives nothing from that page, including the initial page view, enhanced-measurement events, reloads and same-origin navigation. GA also does not receive the path as a later page's `dr`, because of the referrer policy.

No `page_location` sanitization is needed, and no new presentation revision is minted. The boundary also covers historical retained variants, because it is applied by response header rather than in the immutable HTML.

Hosting and CDN request logs still record `/variants/…` paths. That is first-party infrastructure logging under the Firebase Hosting service, distinct from third-party analytics.

## Item 3: staging and production share one GA property (RESOLVED by policy; staging-certified 2026-09-29; live in production 2026-09-30)

`firebase.json` is shared by both Hosting sites, so the boundary applies to staging too: staging educational delivery, including certification launches and test launch-grant traffic, sends nothing to GA. A separate staging property is not required.

Staging's **public** root pages still use the existing `G-9QHB5G2B5B` property, with hostname `lyfelabz-staging.web.app`, unless a GA hostname filter is separately configured in GA admin. That is an optional owner setting, not a code change.

## Item 4: whether analytics should run on authenticated student assessment pages (RESOLVED by policy; staging-certified 2026-09-29; live in production 2026-09-30)

No. Authenticated educational delivery does not use Google Analytics:
- first-party records already hold what GA approximated on these pages: `launchGrants`, `assessmentSessions`, `attempts`, `auditEvents` and grade passback;
- no replacement telemetry is added.

This is a data-minimization decision, not a legal determination.

## Related

- `SECURITY_BACKLOG_LESSON_PAGE_ANSWER_DATA.md` (D7).
- Launch grants: `platform/functions/src/shared/types/launch-grant.ts`.
- Runtime transport: `app/src/runtime/launchParams.ts`, `app/src/runtime/entry.ts` (`detectAssignmentId`).
