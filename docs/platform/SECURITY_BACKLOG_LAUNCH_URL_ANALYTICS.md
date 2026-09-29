# Security Backlog: Launch Context in Lesson URLs and Analytics

**Status:** Opened 2026-09-29 from the Earth's Layers r2 Stage B staging certification and the follow-up read-only reconnaissance. Item 1 is addressed by the launch-URL fragment hardening, which is implemented locally and not yet deployed. Items 2, 3 and 4 are **open** and are not addressed by that change.

## Background

Every lesson page, meaning all 49 canonical lessons, their generated v1 and v2 pages, revision renditions, and retained differentiated artifacts, loads the same inline Google Analytics snippet:

- `gtag('config', 'G-9QHB5G2B5B')`, with no parameters;
- an automatic `page_view`;
- enhanced measurement on.

GA4 sends the page location as `dl` = the URL **including its query string but not its fragment**, and the referrer as `dr` = `document.referrer`. Both were verified on staging (2026-09-29). The authenticated application shell (`/app/`, My Science, the teacher workspace, `/app/a/{id}`) loads no analytics.

## Item 1: `assignment` and `launchRef` in the query string (ADDRESSED by the launch-URL fragment hardening; staging acceptance pending)

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

**Staging acceptance (pending owner-authorized deploy):**
- My Science r1 and r2 launches, the `/app/a/{id}` handoff, canonical fallback, and differentiated delivery all carry the context in the fragment.
- Reload works, and the runtime activates.
- No GA `/g/collect` `dl` or next-page `dr` contains `assignment=` or `launchRef=`.
- Historical query-form links still work.

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
