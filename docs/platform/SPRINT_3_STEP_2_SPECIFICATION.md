# LyfeLabz Sprint 3 Step 2 Technical Specification

**Status:** Planning only. No implementation. No commits.
**Sprint:** Sprint 3, Step 2 (Firebase Hosting scaffold for the future authenticated teacher platform surface)
**Predecessors:** SPRINT_3_STEP_1_SPECIFICATION.md (approved), SPRINT_3_STEP_1A additions to the platform architecture and security model (approved).
**Companion documents:** LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_ENGINEERING_STANDARDS.md, PLATFORM_STATE_MACHINE.md, SPRINT_3_STEP_1_SPECIFICATION.md

This document scopes Sprint 3 Step 2 only. It defines the Firebase Hosting scaffold that will later host the authenticated teacher platform surface at `/app/**`, without introducing any authentication logic, session bootstrap, teacher gate, or Firebase SDK usage on the client. This document does not authorize implementation. Implementation begins only after this specification is separately approved.

---

## 1. Purpose

Step 2 is a pure infrastructure step. It introduces the minimum Firebase Hosting configuration necessary for future authenticated pages to live at a distinct top-level path (`/app/**`) without disturbing the anonymous instructional repository that is served from the repository root today.

At the end of Step 2, the platform will have:

- A Firebase Hosting configuration that continues to serve the existing anonymous instructional site exactly as it works today.
- A single new placeholder file at `/app/index.html` that renders the plain text `LyfeLabz Platform` and nothing else.
- A Hosting rewrite that maps every request under `/app/**` to `/app/index.html`, so that a future client-side router can own that path prefix without additional Hosting changes.

Nothing authenticated exists yet. No Firebase SDK is loaded on the client. No session bootstrap runs. No teacher gate exists. The Sprint 2 identity trust layer is untouched.

---

## 2. Current Repository Assumptions

The following facts are load-bearing for Step 2. They are drawn from Sprint 1 and Sprint 2 outcomes and were re-verified during Step 1 review.

1. The repository root serves the anonymous instructional site directly. Lesson HTML files (for example `lesson_*.html`, `investigation_*.html`, `challenge_*.html`, `index.html`) sit at the repository root and are served as-is via GitHub Pages today, with the `CNAME` file pointing at the public custom domain.
2. `platform/firebase/firebase.json` currently declares Firestore, Storage, Functions, and Emulator configuration only. It does not declare a `hosting` block.
3. No `/app/` directory exists in the repository.
4. No client bundle exists. No client-side Firebase SDK is loaded on any current page.
5. The Sprint 2 identity trust layer is complete: five Cloud Functions (`authOnUserCreate`, `studentsCompleteOnboarding`, `teachersRequestVerification`, `teachersApproveVerification`, `teachersDenyVerification`) and the affirmative Firestore Rules covering `users/{uid}` self get / limited self update and `schools/{schoolId}` authenticated get. None of this is touched by Step 2.
6. The instructional repository has always operated as a flat static site. Existing internal links assume flat root paths. Preservation Mode (CLAUDE.md) forbids opportunistic restructuring of lesson files.
7. Firebase Hosting deploy remains out of scope; Step 2 is an emulator-only scaffold per the standing Sprint 1 and Sprint 2 posture. No production deployment is authorized by this step.

---

## 3. Files Expected to Change During Implementation

Implementation, when later approved, is expected to modify exactly the following files. No other file may be modified during Step 2.

**Modified:**

- `platform/firebase/firebase.json` - add a `hosting` block (see §4).

**Created:**

- `app/index.html` - single placeholder file. Text-only body containing `LyfeLabz Platform`. No `<script>` tag. No Firebase SDK. No stylesheet dependency beyond an inline minimal reset if needed for readability. No favicon reference beyond what is already in the repository root.

**Not modified in Step 2:**

- `platform/firebase/firestore.rules`
- `platform/firebase/storage.rules`
- `platform/firebase/firestore.indexes.json`
- `platform/functions/**`
- Any file at the repository root (all existing lesson HTML, `index.html`, `CNAME`, `about_*.html`, etc.).
- Any Sprint 2 document that describes lifecycle, claims, callables, or audit events.

If implementation discovers that a file outside this list must change, work pauses and this specification is amended before proceeding.

---

## 4. Exact Intended Hosting Rewrite Behavior

The new `hosting` block in `platform/firebase/firebase.json` is expected to be minimal. It must express the following behavior precisely.

**Public directory.** Hosting serves from the repository root (the same tree that GitHub Pages serves today). The `public` field must resolve, from `platform/firebase/`, to the repository root. Concretely, this is `"public": "../.."`. This choice preserves flat-root URLs for every existing lesson and prevents any need to move lesson files.

**Ignore list.** Standard Firebase Hosting ignores (`firebase.json`, `**/.*`, `**/node_modules/**`) apply. Additionally, `platform/**`, `docs/**`, and `blog/**` (if the blog directory is not intended to ship to Hosting; confirm at implementation time) are candidates for the ignore list. The final ignore list is fixed during implementation; the invariant is that no anonymous instructional page currently reachable at the public custom domain becomes unreachable.

**Rewrites.** Exactly one rewrite is added:

- Source pattern: `/app/**`
- Destination: `/app/index.html`

The rewrite must be interpreted such that any URL under `/app/` (including `/app`, `/app/`, `/app/signin`, `/app/teacher`, `/app/pending/anything/deep`) resolves to the same `/app/index.html` file. A future client-side router will then own that path prefix. No other rewrite is added in Step 2.

**No redirects.** No `redirects` array is added.

**No headers.** No `headers` array is added.

**No cleanUrls, no trailingSlash overrides.** Both defaults are preserved so that current lesson URLs continue to resolve exactly as they do today on GitHub Pages.

**Root behavior is unchanged.** A request to `/` continues to serve the existing `index.html` at the repository root. A request to `/lesson_earths-layers.html` continues to serve that exact file. Only requests under `/app/**` are rewritten.

---

## 5. Exact Intended `/app/index.html` Content

The placeholder file must be text-only. Exact intent:

- A single HTML5 document.
- `<title>LyfeLabz Platform</title>`.
- Body content: the literal text `LyfeLabz Platform`, wrapped in a single semantic element (recommended `<main>` containing an `<h1>`).
- No `<script>` tags.
- No Firebase SDK import (no `firebase-app`, `firebase-auth`, `firebase-firestore`, `firebase-functions`, or compat variants).
- No fetch, no XHR, no service worker registration.
- No form, no input, no button.
- No authentication logic, session bootstrap, teacher gate, dashboard, classroom, assignment, enrollment, or roster UI.
- No cross-page navigation link into the anonymous instructional repository, and no link from the anonymous instructional repository into `/app/`.
- Inline CSS may be used only to make the placeholder legible (a modest system font stack, comfortable line-height, centered layout). Inline CSS must not import any external resource.

The placeholder exists only to prove that the Hosting rewrite works. It is expected to be replaced entirely in Step 3.

---

## 6. Non-Goals

Step 2 must not introduce any of the following. This list is exhaustive for the step and takes precedence over any inferred convenience.

- No Firebase SDK on the client. No `firebase-app`, `firebase-auth`, `firebase-firestore`, `firebase-functions` import. No compat SDK.
- No sign-in surface. No sign-out control. No auth state listener. No `onAuthStateChanged` wiring.
- No session bootstrap. No `getIdTokenResult`. No custom claims read.
- No Firestore read from the client. No `users/{uid}` self-get. No `schools/{schoolId}` get.
- No callable invocation. No `httpsCallable` binding.
- No router. No route table. No client-side navigation logic.
- No teacher gate, no active teacher shell, no student shell, no role picker, no pending screen.
- No Firestore Rules changes.
- No Cloud Functions changes.
- No Storage Rules changes.
- No new Firestore collection or field.
- No new custom claim. No `districtId`. No `classroomIds`. No `permissions` array.
- No new lifecycle state. No new lifecycle field. No amendment to `PLATFORM_STATE_MACHINE.md`.
- No new school, classroom, enrollment, assignment, or submission schema.
- No production Hosting deploy. No `firebase deploy --only hosting` invocation against production.
- No modification of any existing lesson HTML file. No modification of `index.html` at the repository root. No modification of `CNAME`.
- No new build step or bundler. No `package.json` at the repository root. No new NPM dependency at the platform level.

If implementation would benefit from any item on this list, it is deferred to a later step and this specification is amended first.

---

## 7. Risks

The following are the known risks that Step 2 must actively guard against.

**Risk: Hosting `public` misconfiguration hides lesson files.**
Setting `"public": "../.."` is unusual and requires that the ignore list not accidentally exclude lesson HTML at the repository root. Mitigation: the validation commands in §8 and the local verification steps in §9 both exercise a representative lesson URL to confirm it still resolves.

**Risk: `/app/**` rewrite pattern is too greedy.**
A misspecified rewrite could match `/app` in a way that shadows some unrelated future path. Mitigation: only `/app/**` is rewritten. All other paths fall through to static serving. Verification exercises at least one non-`/app` URL and one deep `/app/*` URL.

**Risk: implicit GitHub Pages / Firebase Hosting drift.**
The site is currently served by GitHub Pages via `CNAME`. Step 2 configures Firebase Hosting locally (emulator only) and does not deploy. Mitigation: no production deploy is authorized. The emulator posture is preserved.

**Risk: preservation-mode violation.**
Preservation Mode (CLAUDE.md) forbids opportunistic restructuring of lesson files and instructional content. Mitigation: no lesson file is renamed, moved, or edited. The Hosting `public` directory is the repository root as-is.

**Risk: placeholder becomes a stealth entry point.**
A permissive placeholder could accumulate scope creep (a login button, a banner, a link into a teacher shell). Mitigation: §5 fixes the placeholder to plain text. Step 3 replaces the placeholder outright.

**Risk: rewrite semantics differ between emulator and eventual production Hosting.**
Both use the same Firebase Hosting rewrite grammar, so drift is unlikely, but Step 2 verifies only the emulator. Mitigation: production deploy is out of scope for Step 2.

---

## 8. Validation Commands Claude Should Run After Implementation

Every command below runs from the specified working directory. All must pass before Step 2 is considered complete.

Run in `platform/firebase/`:

- `npx firebase emulators:start --only hosting` (started in the background; stopped after §9 verification is complete).
- `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/` - must return `200`.
- `curl -s http://127.0.0.1:5000/ | head -n 20` - must contain markup from the existing repository-root `index.html`.
- `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/lesson_earths-layers.html` - must return `200`.
- `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/app/` - must return `200`.
- `curl -s http://127.0.0.1:5000/app/` - must contain the literal text `LyfeLabz Platform`.
- `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/app/signin` - must return `200` (rewrite target).
- `curl -s http://127.0.0.1:5000/app/signin` - must contain the literal text `LyfeLabz Platform` (proving rewrite to placeholder).
- `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5000/app/teacher/deep/path` - must return `200` and rewrite to the placeholder.

Also confirm the Sprint 2 layer remains green (no regression, even though Step 2 does not touch it):

Run in `platform/functions/`:

- `npm run build`
- `npm run typecheck`
- `npm run lint`
- `npm test`

Run in `platform/firebase/`:

- `npm run test:rules`

The Hosting emulator process is stopped once verification is complete. No production Hosting deploy is executed.

If any command fails, Step 2 pauses and the failure is diagnosed before further work.

---

## 9. Local Verification Steps Chris Should Run After Implementation

Chris performs the following manual checks in a real browser against the Hosting emulator started per §8.

1. Load `http://127.0.0.1:5000/` and confirm the LyfeLabz homepage renders visually as it does on the live custom domain today. Spot check that lesson cards on the homepage still link to lesson HTML files at the repository root and that clicking one loads the lesson page.
2. Load `http://127.0.0.1:5000/lesson_earths-layers.html` directly and confirm the flagship lesson renders exactly as it does today (hero, sticky nav, vocabulary, quiz, More Learning, Connections).
3. Load `http://127.0.0.1:5000/app/` and confirm the page renders the plain text `LyfeLabz Platform` and nothing else. Open the browser devtools Network panel and confirm no request to any Firebase SDK, Firestore, Auth, or Functions endpoint is issued.
4. Load `http://127.0.0.1:5000/app/signin`, `http://127.0.0.1:5000/app/teacher`, and `http://127.0.0.1:5000/app/pending`. Each URL must render the same plain text `LyfeLabz Platform` placeholder, confirming the rewrite behavior.
5. Confirm the browser console is clean for both a lesson page and the `/app/` placeholder. No errors, no warnings introduced by Step 2.
6. Stop the Hosting emulator and confirm the local repository state is clean and no unintended files were created outside `app/index.html` and the modified `platform/firebase/firebase.json`.

If any check fails, Chris reports back and Step 2 is diagnosed before proceeding.

---

## 10. Rollback Notes

Step 2 is trivially reversible because it introduces no persistent state and no deployed configuration.

To roll back:

1. Revert the change to `platform/firebase/firebase.json` (remove the `hosting` block).
2. Delete `app/index.html`. If `app/` is empty after deletion, remove the directory.
3. Confirm no other file was modified. `git status` should be clean.
4. Because Step 2 does not deploy, no production surface is affected. GitHub Pages continues to serve the anonymous instructional site from the repository root exactly as before.
5. No Firestore Rules changed, no Cloud Functions changed, no lifecycle state changed, and no custom claim changed. There is nothing to migrate and nothing to unwind on the identity trust layer.

Rollback should complete in a single commit or a single discarded working tree.

---

## 11. Recommended Step 3 After the Hosting Scaffold Is Complete

Once Step 2 is merged and verified, the recommended Step 3 is the **sign-in surface and session bootstrap**, exactly as described in `SPRINT_3_STEP_1_SPECIFICATION.md` §12 "Step 3".

Step 3 will:

- Introduce the client Firebase SDK (Auth only, initially) inside the `/app/**` bundle.
- Add the sign-in page at `/app/signin`.
- Add the session bootstrap module that resolves `onAuthStateChanged`, force-refreshes the ID token, reads `users/{uid}` under the caller's own credentials, and derives the Session kind per Step 1 §6.
- Add the client-side router that dispatches by Session kind to `/app/onboarding`, `/app/pending`, `/app/teacher`, or `/app/student`.
- Add stub teacher and student shells that render only the caller's display name and school name.
- Add client-side unit tests for the router and the session bootstrap.

Step 3 introduces no new Firestore Rules, no new Cloud Function, no new lifecycle state, no new custom claim, and no new collection or field. It exercises only Sprint 2 affirmative rules and Sprint 2 callables.

If Step 3 discovers a need for any new rule, function, state, claim, or schema, work pauses and this document (or `PLATFORM_STATE_MACHINE.md`, as appropriate) is amended before proceeding.

---

*End of Sprint 3 Step 2 specification. No implementation code produced. No Firebase configuration modified. No frontend scaffold created. No commits produced.*
