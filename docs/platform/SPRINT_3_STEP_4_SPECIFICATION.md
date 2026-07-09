# LyfeLabz Sprint 3 Step 4 Technical Specification

**Status:** Planning only. No implementation. No commits.
**Sprint:** Sprint 3, Step 4 (Route Surface UX for the `/app/**` shell).
**Predecessors:** SPRINT_3_STEP_1_SPECIFICATION.md (approved), SPRINT_3_STEP_2_SPECIFICATION.md (approved and implemented), SPRINT_3_STEP_3_SPECIFICATION.md (approved and implemented; Canonical Session Bootstrap, Immutable Session Object, protected router, and stub route surfaces are committed).
**Companion documents:** LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, PLATFORM_STATE_MACHINE.md, SPRINT_3_STEP_3_SPECIFICATION.md.

This document scopes Sprint 3 Step 4 only. It specifies the complete user experience presented to every kind of caller reaching `/app/**` after the Canonical Session Bootstrap has resolved. It does not authorize implementation. Implementation begins only after this specification is separately approved.

Step 3 answered **who the caller is**. Step 4 answers **what the caller sees, hears, and can do**. Step 4 does not introduce classrooms, assignments, enrollments, dashboards, analytics, or administrator UI. Those belong to Sprint 4 and later.

---

## 1. Scope and Non-Goals

### 1.1 In scope

- One route surface per Session kind returned by the bootstrap (§3 of Step 3).
- The visual and behavioral contract for signed-out, provisioned, pending-verification, active-teacher, suspended, archived, and error states.
- Sign-in flow (Google), sign-out control, verification-request action, refresh strategy for pending teachers.
- Loading indicators, retry affordances, page-level messaging, and accessibility contract.
- Files expected to change, validation plan, local verification plan, rollback plan.

### 1.2 Explicitly out of scope

- Any classroom, roster, assignment, enrollment, submission, or analytics UI.
- Administrator surfaces beyond the placeholder shell already stubbed in Step 3.
- Student route surface enhancements beyond the current stub. Students continue to encounter only the anonymous instructional experience under Sprint 3; the `activeStudent` stub remains a placeholder and does not gain new UI in Step 4.
- New Cloud Functions, new Firestore collections, new custom claims, new lifecycle states, or any schema change.
- Any change to Firestore Security Rules, Storage Rules, Firestore indexes, or Firebase Hosting configuration.
- Any change to files outside `app/**` and `docs/**`. Root-level lesson HTML and the anonymous instructional experience are untouched.

### 1.3 Architectural constraints preserved

- Sprint 2 identity model is preserved. No new roles, no new claims, no new statuses.
- Sprint 3 Canonical Session Bootstrap is preserved. Route surfaces consume the Session object; they never re-derive lifecycle, role, or school from any other source.
- The Session Object remains immutable. Route surfaces do not mutate it. Any state transition (for example, from `provisioned` to `pendingVerification` after the verification-request callable succeeds) is expressed by re-running the bootstrap and re-dispatching, never by patching the current Session in place.
- Firestore remains authoritative for lifecycle state. Route surfaces do not cache lifecycle to `localStorage`, `sessionStorage`, cookies, the URL, or any in-memory singleton other than the Session Object itself.
- Fail closed. Any error, ambiguity, or drift routes the caller to a state that denies protected surfaces.

---

## 2. Entry Conditions

Step 4 begins at the moment the router receives the Canonical Session Object from the bootstrap. The router already exists (Step 3). Step 4 replaces the placeholder stub for each surface with a designed, accessible, minimal experience.

Every route surface receives:

- The immutable Session Object for its kind (typed narrowly).
- A stable mount node inside `app/index.html`.
- Access to `signOut()` (Firebase Auth) and, where §4 or §5 requires it, the `requestTeacherVerification` and `approveTeacherVerification` callables that already exist from Sprint 2. Step 4 wires no new callable.

Every route surface must:

- Render deterministically from its input Session; never read `window.location.search`, cookies, or storage for lifecycle input.
- Provide a single primary action (or none, when the state is terminal).
- Provide a visible sign-out control in every authenticated surface.
- Preserve the anonymous instructional experience by never redirecting a signed-out caller away from a public URL. Signed-out routing is confined to `/app/**`.

---

## 3. Global UX Contract

The following rules apply to every surface described in §4 through §11.

### 3.1 Layout

A single centered card, maximum width 480px on narrow viewports and 560px on wider viewports, centered vertically and horizontally in the viewport. The card contains, in order: a lightweight header (product name), a headline, one to three short paragraphs of body copy, zero or one primary action button, and, where authenticated, a low-visibility sign-out control at the card foot.

The card uses the canonical LyfeLabz visual language: existing typography, existing color tokens, existing spacing scale, existing button styles. Step 4 introduces no new design system, no new component library, and no new tokens. This is consistent with CLAUDE.md ("Match existing LyfeLabz spacing, colors, typography, cards, and interactions").

### 3.2 Typography and copy

- Headlines are one sentence.
- Body copy is at most three short paragraphs, each at most three sentences.
- No em dashes anywhere. Use spaced hyphens.
- Student-facing voice standards from CLAUDE.md apply where relevant, but every Step 4 surface is teacher- or platform-facing rather than student-facing.
- No jargon. No abbreviations that a first-time teacher would not recognize.

### 3.3 Accessibility

- All interactive controls are reachable by keyboard and expose a visible focus ring.
- All primary buttons carry an accessible name derived from their visible label.
- All non-decorative icons carry `role="img"` and a concise `aria-label`. Purely decorative icons carry `aria-hidden="true"`, consistent with the Repository Hardening Pass 5 rule.
- Loading indicators announce their state to screen readers via `aria-live="polite"` on the loading region.
- Error messages announce via `aria-live="assertive"` on a dedicated error region.
- Color is never the sole carrier of state; every state carries either a text label or an icon plus label pair.
- Minimum touch target 44x44 CSS pixels on coarse pointers, consistent with the canonical mobile stylesheet.

### 3.4 Loading

Every asynchronous action (sign-in, verification request, manual refresh, retry) shows a loading state on its triggering control. The control is disabled while pending, its label switches to a present-progressive verb ("Signing in", "Requesting verification", "Checking status"), and an inline spinner is announced via `aria-live="polite"`. The rest of the page remains interactable only where safe (for example, sign-out remains available during a refresh check).

### 3.5 Retry

Every failed asynchronous action reveals a single retry affordance labeled unambiguously ("Try again"). Retries reuse the same code path as the first attempt. There is no exponential backoff UI in Step 4; retries are user-initiated.

### 3.6 Session immutability

No surface mutates the Session Object. Any state change that would produce a different Session kind is realized by calling the bootstrap again and letting the router re-dispatch. Step 4 exposes a single `refreshSession()` helper the router owns; surfaces call it but do not implement it.

### 3.7 Sign-out

Every authenticated surface exposes a sign-out control. Sign-out calls `signOut()`, awaits its resolution, and then triggers a bootstrap re-run. On success the router dispatches to the signed-out surface. On failure the surface shows the standard error banner (§10) with a retry affordance. Sign-out is available even from the suspended and archived surfaces so that a caller can leave the shared device.

---

## 4. Signed-Out User (`kind: "unauthenticated"`)

### 4.1 Purpose

Present the LyfeLabz teacher platform entry point. Explain, in one sentence, that this area is for teachers. Offer Google Sign In. Preserve the anonymous instructional experience by never forcing sign-in on a public lesson URL.

### 4.2 Layout

- Header: "LyfeLabz".
- Headline: "Sign in to your teacher account."
- Body, one paragraph: "Teachers sign in with a Google account to reach the LyfeLabz teacher platform. Students should continue using the public lessons and do not need to sign in."
- Primary action: "Continue with Google".
- Secondary link (below the button): "Return to public lessons". Links to `/` (the anonymous experience root).
- No sign-out control (nothing to sign out of).

### 4.3 Behavior

- The primary action calls `signInWithPopup` with the Google provider on desktop and, on browsers where popups are unreliable, falls back to `signInWithRedirect` per the existing Firebase Auth defaults. The choice is made by the Auth wrapper, not by this surface.
- While the sign-in call is pending, the button label reads "Signing in" and the button is disabled. The secondary link remains active.
- On success, the Auth state change triggers the bootstrap. This surface does not navigate; the router re-dispatches to the next kind.
- On failure, the surface renders the error banner (§10) directly beneath the button with copy:
  - Network failure: "We could not reach Google right now. Check your connection and try again."
  - User closed popup: "Sign in was cancelled. Try again whenever you are ready."
  - Provider error: "Google sign in did not complete. Try again in a moment."
- The button remains present and re-enabled after any failure. The retry affordance is the button itself.

### 4.4 Loading behavior

If the bootstrap has not yet resolved on first paint, the router shows a shared loading surface (§9) rather than this surface. The signed-out surface is only rendered after the bootstrap has resolved to `unauthenticated`. This guarantees the signed-in caller never briefly sees a "Sign in" button they should not see.

### 4.5 Accessibility

- The Google button carries `aria-label="Continue with Google"`.
- The Google mark is included with `role="img"` and `aria-label="Google"` if it appears; if the mark is purely decorative next to the labeled button, it carries `aria-hidden="true"`.
- Errors render inside a region with `role="status"` and `aria-live="assertive"`.

---

## 5. Newly Provisioned Teacher (`kind: "provisioned"`)

### 5.1 Purpose

Welcome a teacher who has authenticated for the first time but has not yet been provisioned with a role, a school, or a display name in the way that supports the platform. Explain the verification process in one paragraph. Offer a single primary action that requests verification. Transition to the pending state.

Note on the Sprint 2 lifecycle: `provisioned` is the initial state written by the account-creation callable. The Sprint 2 `requestTeacherVerification` callable is the transition mechanism to `pendingVerification`. Step 4 wires the UI for that callable; it does not modify the callable.

### 5.2 Layout

- Header: "LyfeLabz".
- Headline: "Welcome to the LyfeLabz teacher platform."
- Body, three short paragraphs:
  1. "Your account has been created. Before you can reach the teacher tools, a LyfeLabz administrator needs to verify that you are a teacher at your school."
  2. "Choose Request Verification below. We will send your request to the administrator. Verification usually takes one school day."
  3. "You can close this window and come back at any time. Sign in again with the same Google account to see your current status."
- Primary action: "Request Verification".
- Sign-out control at card foot.

### 5.3 Behavior

- The primary action calls the existing `requestTeacherVerification` callable. Inputs are whatever the callable already requires (see Sprint 2 completion report and the Cloud Function charter). If the callable requires a school selection or a display name, this surface collects them before invoking the callable. If the callable is self-sufficient (using the caller's Auth email), no additional collection occurs on the client.
  - **This specification does not extend the callable's input contract.** If Sprint 2 requires additional inputs that are not already collected, the required collection is documented here as a pre-request form and the callable's contract is honored, not modified.
- While pending: button reads "Requesting verification", button disabled, sign-out remains active.
- On success: the surface immediately calls `refreshSession()`. The bootstrap re-runs, observes the new Firestore status, and the router dispatches to §6.
- On failure:
  - Callable rejected with a permissions error: "Your account is not eligible to request verification. Sign out and try again with your school Google account."
  - Callable rejected for validation: render the callable's returned message verbatim, capped at 240 characters.
  - Network failure: "We could not send your request. Check your connection and try again."
  - Any other failure: standard error banner with retry.

### 5.4 Transition messaging

On successful callable resolution and before the bootstrap re-dispatches, the button briefly shows "Request sent" for at most 600 ms so that the transition to the pending surface is perceptibly caused by the caller's action. This is a purely cosmetic delay and never blocks navigation for more than 600 ms.

---

## 6. Pending Verification Teacher (`kind: "pendingVerification"`)

### 6.1 Purpose

Reassure a teacher whose verification request is in flight with an administrator. Provide a manual refresh. Do not poll aggressively. Explain what happens next.

### 6.2 Layout

- Header: "LyfeLabz".
- Headline: "Your verification is pending."
- Body, three short paragraphs:
  1. "Your request has been sent to a LyfeLabz administrator. Verification usually takes one school day."
  2. "You will be able to reach the teacher tools as soon as the administrator approves your request."
  3. "You do not need to keep this page open. Sign in again anytime to check your status."
- Primary action: "Check status now".
- Sign-out control at card foot.
- Tertiary line, small type, under the button: "Last checked at HH:MM".

### 6.3 Manual refresh

"Check status now" calls `refreshSession()`. The bootstrap forces an ID-token refresh and re-reads the Firestore record. If the status has changed to `active`, the router dispatches to §7. If the status is unchanged, the surface re-renders with an updated "Last checked" timestamp and a short inline confirmation ("No change yet.") that clears after 4 seconds.

### 6.4 Automatic refresh strategy

The surface schedules a low-frequency automatic refresh on a fixed interval of 60 seconds while the surface is visible. It uses `document.visibilityState === "visible"` and pauses the interval when the tab is hidden. The interval calls the same `refreshSession()` used by the manual button. It does not poll faster than once every 60 seconds and does not backoff or accelerate.

The 60 second interval is deliberately conservative:

- It is slow enough to add negligible Firestore read load per pending teacher.
- It is fast enough that a teacher who leaves the tab open during an administrator's approval sees the transition within a minute.
- Any teacher who wants an instantaneous check has the manual button.

No listener-based real-time subscription is opened. Firestore `onSnapshot` on the caller's own user record is expressly not used in Step 4. Reasoning: the Canonical Session Bootstrap is a one-shot procedure by contract, and introducing a persistent listener would violate the "one derivation path" invariant. If real-time updates are required in a later sprint, they will be introduced as a separate, named channel and documented as an amendment to the state machine.

### 6.5 Messaging while awaiting approval

The pending surface never speculates about administrator identity, review queue depth, or estimated wait. Copy is strictly factual. If the administrator rejects the request (a future capability), that is a lifecycle transition owned by Sprint 2 and rendered as either return to `provisioned` (with an error banner) or as a distinct rejected state; Step 4 does not add a rejected surface because no `rejected` lifecycle state exists in the current state machine.

---

## 7. Active Teacher (`kind: "activeTeacher"`)

### 7.1 Purpose

Confirm to an approved teacher that they have arrived in the teacher platform shell. Present an intentionally minimal placeholder. Do not present classroom UI, roster UI, assignment UI, or analytics UI.

### 7.2 Transition from bootstrap

The transition from bootstrap is direct dispatch. The active teacher surface is the router's terminal destination for `activeTeacher`. It has no sub-routes in Step 4.

### 7.3 Layout

- Header: "LyfeLabz Teacher Platform".
- Greeting: "Welcome, {displayName}."
- Sub-greeting, one line: "You are signed in as a teacher at {schoolName}."
- Body, one paragraph: "The teacher tools are being built. Classrooms, assignments, and student rosters will appear here as they are released. Thank you for helping us build LyfeLabz."
- No primary action.
- Sign-out control at card foot.

### 7.4 Placeholder-only guarantee

This surface is the last surface Step 4 adds behind the active-teacher gate. It contains no navigation to further pages, no callable invocations beyond sign-out, and no data reads beyond what the bootstrap already performed. If a future sprint introduces classroom UI, it will replace or extend this surface, not layer on top of it.

### 7.5 Anonymous instructional experience

The active teacher surface includes a link "Return to public lessons" to `/` so that a signed-in teacher can still browse the anonymous curriculum. The link is a navigation to the root of the site and does not sign the teacher out.

---

## 8. Active Student and Active Administrator (Sprint 3 posture)

These two Session kinds already resolve in the bootstrap and dispatch to stub surfaces in Step 3. Step 4 does not enhance them.

- **`activeStudent`**: the stub surface continues to render only "You are signed in as a student. Return to lessons." with a link to `/` and a sign-out control. Students are not the audience of the teacher platform shell.
- **`activeAdministrator`**: the stub surface continues to render only "You are signed in as a platform administrator." with a sign-out control. Administrator UI is out of scope until Sprint 4 or later.

Both surfaces adopt the global UX contract (§3) for typography, spacing, and sign-out placement so that the shell reads as one product.

---

## 9. Loading, Bootstrap-In-Flight, and Cold Start

While the bootstrap has not yet resolved (typical duration under 500 ms, worst case 2 to 5 seconds on cold cache with a slow network), the router renders a shared loading surface.

### 9.1 Layout

- Header: "LyfeLabz".
- Body: an inline spinner and the label "Loading your account".
- No primary action.
- No sign-out control (there is no confirmed authenticated session to leave).

### 9.2 Behavior

- The loading surface times out after 15 seconds of no resolution and transitions to the error surface (§10) with reason "networkUnavailable".
- The loading surface is not the same as the pending-verification surface. It is only ever visible before the bootstrap has resolved.

### 9.3 Accessibility

The loading region carries `role="status"` and `aria-live="polite"` so that assistive technology announces the load state without interrupting the caller.

---

## 10. Error State (`kind: "error"`)

### 10.1 Purpose

Provide a bounded, human-readable failure state for every unrecoverable bootstrap condition. Never leak internals. Always provide a user-facing recovery action.

### 10.2 Reasons and copy

The Session Object's `error.reason` discriminator (see Step 3 §4) is one of `authInitFailed`, `userRecordUnreadable`, `userRecordMissing`, `recordShapeInvalid`, `networkUnavailable`. The Step 4 error surface renders per reason:

- **`authInitFailed`**
  - Headline: "We could not start your sign-in session."
  - Body: "Something went wrong before we could confirm who you are. Refresh the page and try again. If this keeps happening, sign out and sign back in."
  - Actions: "Refresh", "Sign out".
- **`userRecordUnreadable`**
  - Headline: "We could not load your account."
  - Body: "Your account exists, but we could not read your account record right now. This is usually a temporary connection problem."
  - Actions: "Try again", "Sign out".
- **`userRecordMissing`**
  - Headline: "Your account record was not found."
  - Body: "You are signed in, but we do not have an account record for you yet. If you just requested access, wait a moment and try again. If the problem persists, contact your school administrator."
  - Actions: "Try again", "Sign out".
- **`recordShapeInvalid`**
  - Headline: "Your account record needs attention."
  - Body: "We found your account record but it is not in the expected shape. This is a platform issue, not something you caused. Please contact support and include your email address."
  - Actions: "Sign out". The retry action is deliberately suppressed because retrying will not repair a shape drift.
- **`networkUnavailable`**
  - Headline: "You appear to be offline."
  - Body: "We could not reach LyfeLabz. Check your connection and try again."
  - Actions: "Try again".

### 10.3 Recovery actions

- "Try again" re-runs the bootstrap via `refreshSession()`.
- "Refresh" calls `location.reload()`. Used only for `authInitFailed`, which the bootstrap alone cannot recover from.
- "Sign out" calls `signOut()` and then `refreshSession()`.

### 10.4 Support contact

For `userRecordMissing`, `recordShapeInvalid`, and any persistent `authInitFailed`, the surface renders a single support line: "Contact support at teachers@lyfelabz.example with your email address." The address in this specification is a placeholder; the implementation-time value is the canonical teacher-support address configured by LyfeLabz.

### 10.5 Security considerations

- No error surface renders the underlying exception message, stack trace, HTTP status, Firestore error code, or claim payload. All raw diagnostic detail is confined to the browser console at `console.debug` and is scrubbed of PII beyond the caller's own UID and email (which the caller already possesses).
- No error surface renders another user's UID, email, or display name.
- No error surface renders a Firebase project identifier, config value, or API key beyond what is already public in `firebase.ts`.

---

## 11. Suspended User

The state machine reserves `suspended` (State Machine §1). The bootstrap collapses any `status === "suspended"` observation to the `suspendedUser` kind. Step 4 renders this surface as a deliberate refusal state.

### 11.1 Layout

- Header: "LyfeLabz".
- Headline: "Your account is not available right now."
- Body, two short paragraphs:
  1. "Your LyfeLabz account has been temporarily suspended. You will not be able to reach the teacher tools until this is resolved."
  2. "If you believe this is a mistake, contact your school administrator or LyfeLabz support at teachers@lyfelabz.example."
- No primary action.
- Sign-out control at card foot.

### 11.2 Security considerations

- The surface does not explain why suspension occurred. Suspension reasons are administrator-facing, not user-facing.
- The surface does not offer a self-service unsuspend action. Reinstatement is administrator-controlled.
- Sign-out remains available so that a caller on a shared device can leave.
- The surface does not link to any protected route, does not invoke any callable, and does not re-run the bootstrap on any interval.

---

## 12. Archived User

The state machine reserves `archived` (State Machine §1). The bootstrap collapses `status === "archived"` to the `archivedUser` kind. Step 4 renders this surface as a terminal refusal state.

### 12.1 Layout

- Header: "LyfeLabz".
- Headline: "This account has been archived."
- Body, two short paragraphs:
  1. "This LyfeLabz account is no longer active. You will not be able to reach the teacher tools with this account."
  2. "If you need to return to LyfeLabz, contact your school administrator to have a new account provisioned."
- No primary action.
- Sign-out control at card foot.

### 12.2 Contact instructions

Archived users are directed exclusively to their school administrator. Support email is not surfaced here because archival is an intentional administrative act, not a support incident.

### 12.3 Terminal state

The archived surface schedules no refresh, opens no listener, and invokes no callable. It is fully terminal within Step 4.

---

## 13. Navigation Rules

- The router never navigates by URL. Route surface selection is a pure function of `Session.kind`. The URL under `/app/**` may be any path; the router renders the surface that matches the resolved Session.
- No surface links to another `/app/**` route. All in-shell transitions are Session-kind transitions and are realized by re-running the bootstrap.
- The only outbound links from `/app/**` in Step 4 are:
  - "Return to public lessons", present on the signed-out surface and the active teacher surface. Links to `/`.
  - The support email link, present only on the error, suspended, and (rarely) provisioned surfaces.
- Browser back/forward within `/app/**` re-renders the current Session's surface. Back does not attempt to re-enter a prior lifecycle state.
- Deep-linking into `/app/**` from an external referrer lands on the loading surface until the bootstrap resolves, then dispatches to the Session's surface. Deep links do not bypass the bootstrap.

---

## 14. State Transitions Summary

The Session kinds change only through these transitions in Step 4:

| From | Trigger | To |
| --- | --- | --- |
| `unauthenticated` | Google sign-in success | `provisioned` \| `pendingVerification` \| `activeTeacher` \| `activeStudent` \| `activeAdministrator` \| `suspendedUser` \| `archivedUser` (whichever the bootstrap resolves) |
| `provisioned` | `requestTeacherVerification` success | `pendingVerification` |
| `pendingVerification` | Manual or 60s auto refresh + administrator approval landed | `activeTeacher` |
| Any authenticated | Sign-out success | `unauthenticated` |
| Any | Bootstrap error | `error` |
| `error` | "Try again" (bootstrap succeeds) | Any resolvable kind |
| `error` | "Sign out" | `unauthenticated` |
| `suspendedUser` | Sign-out only | `unauthenticated` |
| `archivedUser` | Sign-out only | `unauthenticated` |

There are no other transitions in Step 4. No surface can move to another surface except by re-running the bootstrap and letting the router dispatch.

---

## 15. Accessibility Contract Summary

- All headlines are `h1` inside the card region. Sub-greetings are `p`, not lower-level headings.
- All primary buttons are `button` elements with a visible label; no click handlers on `div`.
- All loading regions carry `role="status"` and `aria-live="polite"`.
- All error regions carry `role="alert"` and `aria-live="assertive"`.
- Keyboard traversal follows visual order.
- Focus is placed on the headline of each new surface at dispatch time so that assistive technology announces the surface change.
- No motion beyond a subtle fade for surface transitions. Prefers-reduced-motion disables the fade entirely.
- Minimum contrast ratio 4.5:1 for all text and 3:1 for large text and icons, consistent with the existing LyfeLabz accessibility posture.

---

## 16. Files Expected to Change

Step 4 is expected to modify or create exactly the following files. If implementation discovers that a file outside this list must change, work pauses and this specification is amended before proceeding.

**Modified:**

- `app/index.html` - retains its Step 3 mount node. Adds only whatever `<link>` or `<style>` inclusions the shared UX contract requires. No route-specific markup.
- `app/src/router/router.ts` - dispatch table is updated to route to the enhanced surfaces below. Router itself is not architecturally changed.
- `app/src/router/routes.ts` (or the equivalent existing routes module from Step 3) - the current placeholder implementations are replaced with the Step 4 surface implementations.
- `app/src/index.ts` - may be extended to attach the shared loading surface behavior; no other change.
- `app/index.html` `<style>` block, or a new `app/src/styles/shell.css` if one is preferred, for the shared card layout and typography tokens. This decision is left to the implementation reviewer; either is acceptable as long as no new design system is introduced.

**Created (client bundle):**

- `app/src/router/routes/signedOut.ts`
- `app/src/router/routes/provisioned.ts`
- `app/src/router/routes/pendingVerification.ts`
- `app/src/router/routes/activeTeacher.ts`
- `app/src/router/routes/activeStudent.ts` (thin update of the Step 3 stub only)
- `app/src/router/routes/activeAdministrator.ts` (thin update of the Step 3 stub only)
- `app/src/router/routes/suspended.ts`
- `app/src/router/routes/archived.ts`
- `app/src/router/routes/errorSurface.ts`
- `app/src/router/routes/loading.ts`
- `app/src/router/routes/shared/card.ts` - shared card layout renderer used by every surface.
- `app/src/router/routes/shared/signOutControl.ts` - shared sign-out button, wired to `signOut()` + `refreshSession()`.
- `app/src/router/routes/shared/errorBanner.ts` - shared inline error banner used within surfaces (distinct from the full-page error surface).
- `app/src/router/routes/shared/loadingIndicator.ts` - shared inline spinner.
- `app/src/session/refreshSession.ts` - thin re-export or wrapper that surfaces call to re-run the bootstrap. May instead live inside `bootstrap.ts`; that placement is acceptable.
- `app/test/router/routes/signedOut.test.ts`
- `app/test/router/routes/provisioned.test.ts`
- `app/test/router/routes/pendingVerification.test.ts`
- `app/test/router/routes/activeTeacher.test.ts`
- `app/test/router/routes/suspended.test.ts`
- `app/test/router/routes/archived.test.ts`
- `app/test/router/routes/errorSurface.test.ts`

**Not modified in Step 4:**

- `platform/firebase/firebase.json`, `firestore.rules`, `storage.rules`, `firestore.indexes.json`.
- `platform/functions/**`. No new callable, no signature change to any existing callable.
- `app/src/firebase.ts`, `app/src/session/bootstrap.ts`, `app/src/session/consistency.ts`, `app/src/session/types.ts`, `app/src/session/user-record.ts`. Bootstrap architecture is frozen.
- Any file outside `app/**` and `docs/**`.
- The root `index.html`, all lesson HTML, `CNAME`, `sitemap.xml`. The anonymous instructional experience is untouched.

---

## 17. Validation Plan

### 17.1 Type-level validation

- `tsc --noEmit` from the `app/` package passes with zero errors.
- Every route surface accepts a narrowed Session type in its function signature; the router's dispatch table is exhaustive over `Session["kind"]`. TypeScript exhaustiveness is enforced with a `never`-typed default arm.

### 17.2 Unit test validation

- Each route surface renders deterministically given a fixed Session input. Snapshot-style assertions on rendered DOM confirm the headline, body text, primary action label, and presence or absence of the sign-out control.
- The signed-out surface, given a successful Google sign-in stub, calls `signInWithPopup` exactly once and does not call the bootstrap directly (the Auth state change is what re-runs it).
- The provisioned surface, given a resolved `requestTeacherVerification` mock, calls `refreshSession()` exactly once on success.
- The pending surface, given a mocked visibility API and mocked `refreshSession()`, calls `refreshSession()` at most once per 60 seconds while visible and zero times while hidden.
- The error surface renders the correct copy per reason and exposes the correct set of recovery actions.
- Every surface is keyboard-reachable and focuses its headline on mount.

### 17.3 Rules and callable validation

Step 4 introduces no rules change and no callable change. No emulator rules test is added or modified. Sprint 2 emulator tests for `requestTeacherVerification` and `approveTeacherVerification` continue to pass unchanged.

### 17.4 Cross-cutting checks

- Grep the changed files for em dashes (`—`); zero hits required.
- Grep for hard-coded strings that should be pulled from a single copy module; if the implementation chooses to inline copy per surface (acceptable), the grep confirms no duplication of the same string across multiple surfaces.
- Confirm no surface imports from `platform/functions/**`.
- Confirm no surface reads `localStorage`, `sessionStorage`, `document.cookie`, or `window.location.search` for lifecycle input.
- Confirm no surface calls `initializeApp`. Firebase initialization remains centralized in `app/src/firebase.ts`.

---

## 18. Local Verification Plan for Chris

The verification plan mirrors Sprint 3 Step 3's structure so Chris follows a familiar rhythm.

### 18.1 Environment

1. `cd app && npm ci` if the lockfile has changed. Otherwise skip.
2. `npm run build` inside `app/`. Expect zero TypeScript errors.
3. `npm test` inside `app/`. Expect the Step 4 unit tests to pass alongside the existing Step 3 suite.
4. Start the Firebase emulator suite per `LYFELABZ_EMULATOR_SUITE_GUIDE.md`.
5. Serve the `app/` build through `firebase emulators:start --only hosting,auth,firestore,functions` per the Sprint 3 Step 2 hosting scaffold.

### 18.2 Manual walkthrough

Chris performs these walks in order. Each is expected to take under two minutes.

1. **Signed-out arrival.** Visit `/app/`. Confirm the loading surface flashes and the signed-out surface renders. Confirm the "Return to public lessons" link goes to `/`. Confirm keyboard focus lands on the headline. Confirm no console errors.
2. **Google sign-in success (new teacher).** Sign in with a fresh test Google account provisioned by the emulator. Confirm dispatch to the provisioned surface. Confirm the welcome copy is exactly as specified. Confirm sign-out is present.
3. **Verification request.** Click "Request Verification". Confirm the button shows the pending label, then briefly "Request sent", then the pending surface renders. Confirm the "Last checked" timestamp is present.
4. **Automatic refresh cadence.** Leave the pending surface open for two minutes. Confirm at most two automatic refreshes occurred (visible in the emulator Firestore read log or via a console debug line the implementation may add for verification purposes only).
5. **Approval landing.** In a second browser session, sign in as a platform administrator and approve the verification via the existing Sprint 2 tooling. Return to the first session. Click "Check status now". Confirm dispatch to the active-teacher surface.
6. **Active teacher greeting.** Confirm the greeting reads "Welcome, {displayName}" and the school name matches. Confirm "Return to public lessons" is present and works.
7. **Sign-out.** From the active-teacher surface, click sign out. Confirm dispatch to the signed-out surface.
8. **Suspended user.** With the emulator, set a test user's status to `suspended`. Sign in as that user. Confirm the suspended surface. Confirm no protected surface is reachable. Confirm sign-out works.
9. **Archived user.** Repeat with `archived`.
10. **Error paths.** Force each of the five error reasons in turn (`authInitFailed`, `userRecordUnreadable`, `userRecordMissing`, `recordShapeInvalid`, `networkUnavailable`) using the emulator or by disabling the network. Confirm each renders the specified copy and offers the specified recovery actions.
11. **Anonymous experience preserved.** Visit `/` and browse a lesson. Confirm no `/app/**` code interferes with the anonymous experience. Confirm the browser does not attempt any Firebase Auth call on the anonymous route.
12. **Em dash sweep.** `grep -R "—" app/` returns zero hits.

### 18.3 Accessibility spot check

- Tab through every surface with the keyboard alone. Confirm every interactive control is reachable and has a visible focus ring.
- Run an axe or Lighthouse accessibility pass on each surface. Confirm zero critical findings.
- Test with `prefers-reduced-motion: reduce`. Confirm no motion beyond static state changes.

---

## 19. Rollback Plan

Step 4 is client-only. Rollback is a Hosting-only operation and does not touch Firestore data, Auth users, custom claims, Cloud Functions, security rules, or indexes.

### 19.1 Trigger conditions

Roll back Step 4 if any of the following are observed after deployment:

- Any protected surface renders for an unauthenticated caller.
- Any suspended, archived, provisioned, or pending caller reaches the active-teacher surface.
- Any surface reads or writes Firestore state outside the bootstrap contract.
- Sign-out fails to clear the Session and re-run the bootstrap.
- Bootstrap re-runs cause a rendering loop.

### 19.2 Rollback procedure

1. `firebase hosting:clone` the previous production release into the current channel, or `firebase hosting:releases:rollback` to the last Step 3 release identifier.
2. Confirm `/app/` returns the Step 3 stub surfaces.
3. Confirm the anonymous instructional experience at `/` is unchanged.
4. Announce the rollback in the internal channel with the release identifier.

### 19.3 Post-rollback state

Because Step 4 modifies no server-side artifact, the platform's authoritative state (Firestore records, custom claims, Cloud Functions, security rules) is identical before and after rollback. No data reconciliation is required.

### 19.4 Re-attempt

A re-attempt requires an amendment to this specification identifying the cause of the rollback and the specific change that addresses it. Re-attempts do not proceed on the assumption that "the fix is small enough to skip the amendment."

---

## 20. Open Questions and Deferred Decisions

The following are intentionally left open and are called out here so the implementation review does not treat them as accidental omissions.

1. **Copy module vs inline copy.** Whether route copy lives in a single `copy.ts` module or is inlined per surface is left to the implementation reviewer. Both satisfy §17.4's duplication check.
2. **Card styling location.** Whether shared card styling lives in `app/index.html` or a new `app/src/styles/shell.css` is left to the implementation reviewer, per §16.
3. **Support email address.** The address `teachers@lyfelabz.example` is a placeholder pending confirmation of the canonical LyfeLabz support address. The implementation must replace it before the release build.
4. **Provisioned surface inputs.** Whether the provisioned surface must collect any inputs (school selection, display name) before invoking `requestTeacherVerification` depends on the Sprint 2 callable contract. §5.3 honors whichever contract exists; the implementation reviewer confirms the contract at implementation time and, if additional inputs are required, this specification is amended to describe the pre-request form.
5. **Motion tokens.** The subtle fade for surface transitions has no canonical duration in existing LyfeLabz lessons because lessons do not surface-transition. A 120 ms fade with an ease-out curve is a reasonable default; a shorter or longer value is acceptable if it aligns with existing lesson micro-interactions.

None of these open questions blocks approval of the Step 4 specification. They are documented so that implementation is not delayed by ambiguity about their status.

---

## 21. Approval Gate

Implementation of Step 4 begins only after this document is separately approved. Approval implies:

- The seven authenticated Session kinds each have a specified surface.
- The signed-out, loading, and error surfaces are specified.
- The verification-request UX is specified without extending the Sprint 2 callable contract.
- The refresh strategy is specified as manual + 60-second visibility-gated automatic refresh, with no real-time listener.
- No new lifecycle state, no new claim, no new collection, no new callable, no rules change, no indexes change, no hosting change.
- Files expected to change are enumerated and bounded to `app/**` and `docs/**`.
- Validation, local verification, and rollback plans are defined and executable.

Any deviation from the above in the implementation phase pauses work and amends this specification.
