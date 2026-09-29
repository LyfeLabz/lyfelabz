# Security Backlog: Launch Context in Lesson URLs and Analytics

**Status:** Opened 2026-09-29 from the Earth's Layers r2 Stage B staging certification and the follow-up read-only reconnaissance. Item 1 is **resolved and staging-certified** by the launch-URL fragment hardening (commit `432e728`, staging Hosting `a473c38faacc9396`); production is not deployed. Items 1b, 2, 3 and 4 are **resolved by policy**: the owner approved Policy E (2026-09-29), the Hosting analytics boundary described below. It is deployed to staging (Hosting `737d935a2c048330`) and **not certified**: staging exposed a 304 cache-transition defect (below). The transition fix is implemented, locally certified in Chrome, and owner-approved with an accepted transition residual; it is not yet deployed to staging or production.

## Background

Every lesson page, meaning all 49 canonical lessons, their generated v1 and v2 pages, revision renditions, and retained differentiated artifacts, loads the same inline Google Analytics snippet:

- `gtag('config', 'G-9QHB5G2B5B')`, with no parameters;
- an automatic `page_view`;
- enhanced measurement on.

GA4 sends the page location as `dl` = the URL **including its query string but not its fragment**, and the referrer as `dr` = `document.referrer`. Both were verified on staging (2026-09-29). The authenticated application shell (`/app/`, My Science, the teacher workspace, `/app/a/{id}`) loads no analytics.

## Item 1: `assignment` and `launchRef` in the query string (RESOLVED; staging-certified 2026-09-29; production not deployed)

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

## Policy E cache transition (304 defect; fix locally certified, not deployed)

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

## Item 1b: assignment id in GA `dr` after a `/app/a/{id}` arrival (RESOLVED by policy; not yet deployed)

The Google Classroom arrival URL `/app/a/{assignmentId}` carries the assignment id in its **path**; this is the external Classroom contract and does not change. `/app/a/{id}` itself never ran analytics. The exposure came from the destination lesson page, whose GA `dr` was the arrival URL.

Every arrival handoff target is under `/app/lessons/**`, where GA no longer loads, so no GA hit carries the arrival path. As defense in depth, `Referrer-Policy: strict-origin` on `/app/**` makes any navigation out of an `/app` page report only the origin. That includes a future link from the shell or a lesson to a GA-bearing public page. Verified in the emulator: `document.referrer` after leaving a `/app/lessons/variants/…` page is the bare origin.

## Item 2: differentiated `/variants/` path reveals accommodated delivery (RESOLVED by policy; not yet deployed)

A differentiated launch loads `/app/lessons/variants/lesson_<slug>__pr<hash>.html`. Under the boundary, GA receives nothing from that page, including the initial page view, enhanced-measurement events, reloads and same-origin navigation. GA also does not receive the path as a later page's `dr`, because of the referrer policy.

No `page_location` sanitization is needed, and no new presentation revision is minted. The boundary also covers historical retained variants, because it is applied by response header rather than in the immutable HTML.

Hosting and CDN request logs still record `/variants/…` paths. That is first-party infrastructure logging under the Firebase Hosting service, distinct from third-party analytics.

## Item 3: staging and production share one GA property (RESOLVED by policy; not yet deployed)

`firebase.json` is shared by both Hosting sites, so the boundary applies to staging too: staging educational delivery, including certification launches and test launch-grant traffic, sends nothing to GA. A separate staging property is not required.

Staging's **public** root pages still use the existing `G-9QHB5G2B5B` property, with hostname `lyfelabz-staging.web.app`, unless a GA hostname filter is separately configured in GA admin. That is an optional owner setting, not a code change.

## Item 4: whether analytics should run on authenticated student assessment pages (RESOLVED by policy; not yet deployed)

No. Authenticated educational delivery does not use Google Analytics:
- first-party records already hold what GA approximated on these pages: `launchGrants`, `assessmentSessions`, `attempts`, `auditEvents` and grade passback;
- no replacement telemetry is added.

This is a data-minimization decision, not a legal determination.

## Related

- `SECURITY_BACKLOG_LESSON_PAGE_ANSWER_DATA.md` (D7).
- Launch grants: `platform/functions/src/shared/types/launch-grant.ts`.
- Runtime transport: `app/src/runtime/launchParams.ts`, `app/src/runtime/entry.ts` (`detectAssignmentId`).
