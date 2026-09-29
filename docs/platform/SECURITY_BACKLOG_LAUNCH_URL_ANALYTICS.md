# Security Backlog: Launch Context in Lesson URLs and Analytics

**Status:** Opened 2026-09-29 from the Earth's Layers r2 Stage B staging certification and the follow-up read-only reconnaissance. Item 1 is **resolved and staging-certified** by the launch-URL fragment hardening (commit `432e728`, staging Hosting `a473c38faacc9396`); production is not deployed. Items 1b, 2, 3 and 4 are **open**.

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

## Item 1b: assignment id in GA `dr` after a `/app/a/{id}` arrival (OPEN; found during the item 1 staging certification)

The Google Classroom arrival URL `/app/a/{assignmentId}` carries the assignment id in its **path**; this is the external Classroom contract and did not change. When the arrival hands off to the lesson page, the lesson page's `document.referrer`, and therefore GA's `dr`, is that arrival URL, so GA receives the assignment id. It never receives a launchRef.

My Science launches are not affected (their `dr` is `/app/student`). A candidate fix is a referrer policy for the application shell (for example `strict-origin` for `/app/**`), so that same-origin navigations out of `/app/a/…` report only the origin. That is a Hosting or shell change needing owner authorization.

## Item 2: differentiated `/variants/` path reveals accommodated delivery (OPEN)

A differentiated launch loads `/app/lessons/variants/lesson_<slug>__pr<hash>.html`, and GA records that path in `dl`. The path shows that a pseudonymous GA client received a differentiated (accommodation-related) presentation. Revision renditions similarly reveal `…__r<N>` (low sensitivity).

Item 1 does not change this. Fixing it needs a sanitized `page_location`/`page_referrer` (for example mapping variant paths to the canonical lesson path), which changes the canonical lesson sources.
- Retained artifacts are immutable, so they would need **new content-addressed presentation revisions**, and published coverage would have to be repointed.
- In production, differentiated delivery is disabled today, so no variant paths reach GA from production. **Decide this before production differentiation activation.**

## Item 3: staging and production share one GA property (OPEN)

Every page, on every host, hard-codes `G-9QHB5G2B5B`. Staging certification traffic, including test launch-grant ids now expired, reaches the production analytics property. Owner decision needed.

## Item 4: whether analytics should run on authenticated student assessment pages at all (OPEN)

Pending an owner decision. It covers:
- the data-minimization review of lesson pages opened in assignment context;
- GA's pseudonymous client id;
- enhanced-measurement events.

This is not a legal determination.

## Related

- `SECURITY_BACKLOG_LESSON_PAGE_ANSWER_DATA.md` (D7).
- Launch grants: `platform/functions/src/shared/types/launch-grant.ts`.
- Runtime transport: `app/src/runtime/launchParams.ts`, `app/src/runtime/entry.ts` (`detectAssignmentId`).
