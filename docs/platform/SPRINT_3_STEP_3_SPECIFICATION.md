# LyfeLabz Sprint 3 Step 3 Technical Specification

**Status:** Planning only. No implementation. No commits.
**Sprint:** Sprint 3, Step 3 (Canonical Session Bootstrap architecture)
**Predecessors:** SPRINT_3_STEP_1_SPECIFICATION.md (approved), SPRINT_3_STEP_1A architecture and security-model amendments (approved), SPRINT_3_STEP_2_SPECIFICATION.md (approved and implemented; Hosting scaffold committed as Sprint 3 Milestone 1).
**Companion documents:** LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, LYFELABZ_FIRESTORE_DATA_MODEL.md, LYFELABZ_ENGINEERING_STANDARDS.md, PLATFORM_STATE_MACHINE.md, SPRINT_3_STEP_1_SPECIFICATION.md, SPRINT_3_STEP_2_SPECIFICATION.md.

This document scopes Sprint 3 Step 3 only. It specifies the Canonical Session Bootstrap: the single client-side procedure that resolves an authenticated caller into a typed, immutable session object that every downstream `/app/**` surface consumes without re-deriving authorization state. It does not authorize implementation. Implementation begins only after this specification is separately approved.

---

## 1. Purpose of the Canonical Session Bootstrap

The Canonical Session Bootstrap is the single client-side procedure that converts a Firebase Authentication result and a Firestore `users/{uid}` record into a typed, immutable in-memory session object. It runs at most once per authenticated session and is the sole authoritative source of lifecycle-derived UI state within the `/app/**` bundle.

The bootstrap exists to enforce three invariants across the client:

1. **One derivation path.** No client surface derives lifecycle, role, or school from any other source. Every route, gate, header, and menu consumes the session object the bootstrap produces. Duplicate derivation is prohibited (State Machine §4 "Current account state comes from Firestore").
2. **Server as source of truth.** The client trusts custom claims for authorization intent and Firestore `users/{uid}` for lifecycle state. The URL, `localStorage`, `sessionStorage`, and any transient UI state are never consulted for account state.
3. **Fail closed.** Any error, drift, or ambiguity encountered during the bootstrap resolves to a state that denies protected surfaces rather than a state that grants them.

The bootstrap composes exactly these inputs in exactly this order:

Firebase Authentication → forced or explicit ID token refresh when needed → Custom Claims → Firestore `users/{uid}` read → authorization consistency check → school context → Canonical Session Object.

The bootstrap performs at most one Firestore read of the caller's own `users/{uid}` document, at most one `get` of `schools/{schoolId}` (only when a school context is required by the resolved session kind), and at most one forced ID token refresh. It performs no client writes to Firestore, no direct claim mutation, and no callable invocation. Callable invocations belong to Step 4 (role picker and pending screen) and Step 5 (active teacher gate), not to the bootstrap itself.

---

## 2. Files Expected to Change During Future Implementation

Step 3 is expected to modify or create exactly the following files. If implementation discovers that a file outside this list must change, work pauses and this specification is amended before proceeding.

**Modified:**

- `app/index.html` - replaced from the plain-text placeholder introduced in Step 2 with a bootstrap host page. Loads the client Firebase SDK (Auth and Firestore modular imports only) and mounts the router. Contains no route-specific UI; the router renders route surfaces into a single mount node.

**Created (client bundle):**

- `app/src/firebase.ts` - single Firebase App initialization module. Exports the initialized `Auth` and `Firestore` instances. No other module calls `initializeApp`.
- `app/src/session/types.ts` - the Canonical Session Object type union (see §4) and any narrow helper types the bootstrap needs. This is the sole location where session kinds are enumerated on the client.
- `app/src/session/bootstrap.ts` - the bootstrap function itself. Consumes the initialized `Auth` and `Firestore`, returns a `Promise<Session>`, and never throws to the caller (see §9).
- `app/src/session/consistency.ts` - the authorization consistency check between claims and the Firestore record (see §8). Isolated so it can be unit-tested in isolation.
- `app/src/router/router.ts` - a minimal dispatch table that maps `Session["kind"]` to the route surface responsible for that kind. Step 3 surfaces are stubs; the router itself is the deliverable.
- `app/src/router/routes/*.ts` - one stub module per Session kind. Each stub renders only the caller's display name and school name where those are available (see §11-§16). No forms, no navigation controls beyond a single sign-out control on authenticated stubs.
- `app/src/index.ts` - the client entry point. Waits for the bootstrap, hands the resulting Session to the router, and mounts the router into `app/index.html`.
- `app/test/session/bootstrap.test.ts`, `app/test/session/consistency.test.ts`, `app/test/router/router.test.ts` - unit tests using a JSDOM environment with mocked `Auth` and `Firestore` instances. No emulator dependency for unit tests.

**Not modified in Step 3:**

- `platform/firebase/firebase.json` (Hosting configuration is final for Sprint 3).
- `platform/firebase/firestore.rules` (Sprint 2 affirmative rules are sufficient; see §19).
- `platform/firebase/storage.rules`.
- `platform/firebase/firestore.indexes.json`.
- `platform/functions/**` (no new Cloud Function; no change to any existing Cloud Function).
- `platform/functions/src/shared/types/user.ts`, `platform/functions/src/shared/types/school.ts` (canonical shapes remain authoritative; the client mirrors them but does not import them).
- `docs/platform/PLATFORM_STATE_MACHINE.md` (no lifecycle change).
- `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md` (no schema change).
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (no callable change).
- Any file at the repository root (all existing lesson HTML, root `index.html`, `CNAME`, etc.).

The client bundle deliberately does not import from `platform/functions/src/shared/types/`. Cross-package imports across the functions/client boundary are out of scope for Step 3. The client re-declares the narrow subset of types it needs (`UserStatus`, `Role`, the read-shape of `UserRecord`, and the read-shape of `SchoolRecord`) and is responsible for keeping them in sync with the canonical shapes.

---

## 3. Exact Session States

The Canonical Session Object is a discriminated union with exactly the following seven kinds. These are the only session kinds the router dispatches on. Every kind is derived, never asserted by any client caller.

1. **`unauthenticated`** - `onAuthStateChanged` resolved with no current user.
2. **`provisioned`** - authenticated, Firestore record present, `status === "provisioned"`. No role, no school, no display name yet.
3. **`pendingVerification`** - authenticated, Firestore record present, `status === "pendingVerification"`. Role is `"teacher"`, `schoolId` and `displayName` are present, custom claims are absent or incomplete (approval has not yet occurred).
4. **`activeTeacher`** - authenticated, Firestore record present, `status === "active"`, `role === "teacher"`, claims consistent with record.
5. **`activeStudent`** - authenticated, Firestore record present, `status === "active"`, `role === "student"`, claims consistent with record.
6. **`activeAdministrator`** - authenticated, Firestore record present, `status === "active"`, `role === "platformAdministrator"`, claims consistent with record. Rendered only through the same stub-shell mechanism; no administrator UI exists in Sprint 3.
7. **`error`** - the bootstrap encountered an unrecoverable condition (see §9). Carries a discriminator that lets the router choose between routing to sign-in with a banner and routing to a hard failure surface. Does not carry the underlying exception.

**Reserved but not surfaced in Sprint 3.** The lifecycle states `suspended` and `archived` exist in the state machine (State Machine §1) but are reserved. Any bootstrap resolution that observes `status === "suspended"` or `status === "archived"` collapses to §15 (Suspended user behavior) and §16 (Archived user behavior) respectively. The Session kinds `suspendedUser` and `archivedUser` are named in this specification but implemented as deliberate refusal states, not as first-class surfaces; the router treats them as terminal (sign-out only).

No other session kind is permitted. Adding a session kind requires amending this document first.

---

## 4. Canonical Session Object Shape

The Canonical Session Object is a discriminated union, always frozen, always constructed once per bootstrap. The `kind` discriminator names the state; the payload carries only fields the router or a stub surface is authorized to consume in Sprint 3.

Illustrative TypeScript, not implementation code:

```
type Session =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "provisioned"; readonly uid: string; readonly email?: string }
  | { readonly kind: "pendingVerification"; readonly uid: string; readonly schoolId: string; readonly displayName: string }
  | { readonly kind: "activeTeacher"; readonly uid: string; readonly schoolId: string; readonly displayName: string; readonly schoolName: string }
  | { readonly kind: "activeStudent"; readonly uid: string; readonly schoolId: string; readonly displayName: string; readonly schoolName: string }
  | { readonly kind: "activeAdministrator"; readonly uid: string; readonly schoolId: string; readonly displayName: string; readonly schoolName: string }
  | { readonly kind: "suspendedUser"; readonly uid: string }
  | { readonly kind: "archivedUser"; readonly uid: string }
  | { readonly kind: "error"; readonly reason: "authInitFailed" | "userRecordUnreadable" | "userRecordMissing" | "recordShapeInvalid" | "networkUnavailable" };
```

Invariants:

- The object is deep-frozen after construction (`Object.freeze` on the outer object).
- No mutable field is present. All fields are `readonly`.
- No timestamp, claim, or token content is embedded in the object. Downstream surfaces that need those values re-derive them through the same auth/firestore instances rather than reading from the session object.
- The object contains no `role` field on active kinds. Role is expressed by the discriminator.
- The `schoolName` field is populated only for active kinds because only those kinds display the school header in their stub shells. Sprint 3 does not require the school name on `pendingVerification` (that surface displays a plain-language waiting message, not a school header).
- The `email` field on `provisioned` is populated only when the Firebase Auth record carries it. It exists solely so the onboarding screen in Step 4 can confirm the caller identity in plain language; it is not used for authorization.

The session object is intentionally minimal. Every additional field is a load-bearing dependency that a future refactor will have to preserve; the specification prohibits fields that Sprint 3 stub surfaces do not consume.

---

## 5. Required Firebase Auth Inputs

The bootstrap depends on Firebase Authentication providing the following, and only the following, inputs:

- A resolved `onAuthStateChanged` result. The bootstrap waits for the first resolution before doing anything else. It does not poll `currentUser`.
- On the resolved user, `user.uid`. This is the only identifier the bootstrap trusts.
- On the resolved user, `user.email` (optional). Passed through to the `provisioned` session kind for display only. Not used for authorization.
- The ability to call `user.getIdTokenResult(forceRefresh: true)`. The bootstrap forces a token refresh exactly once (see §8 for the trigger condition) to pick up claims written by the most recent Cloud Function.

The bootstrap does not depend on any Auth provider metadata (`providerId`, `providerData`), any `photoURL`, any `phoneNumber`, or any anonymous auth capability. Anonymous sign-in is not supported by Sprint 2 or Sprint 3 and the bootstrap does not accommodate it.

The bootstrap assumes the client Firebase Auth instance has already been initialized by `app/src/firebase.ts`. Initialization is the caller's responsibility; the bootstrap consumes the initialized `Auth` object by parameter.

---

## 6. Required Custom Claim Assumptions

The bootstrap trusts that custom claims, when present, conform to the canonical claim shape defined by the Cloud Function Charter §2: `{ role, schoolId }`.

Positive assumptions:

- If claims are present and `claims.role` is one of `"teacher"`, `"student"`, `"platformAdministrator"`, the value is authoritative for authorization intent.
- If claims are present and `claims.schoolId` is a non-empty string, the value is authoritative for school scope.
- Claims are absent on `provisioned` and `pendingVerification` accounts. Absence is the canonical signal that no active authorization applies (State Machine §4 "Authorization comes from custom claims").

Explicit non-assumptions:

- The bootstrap does not assume claims are present.
- The bootstrap does not assume `districtId` is present. It is reserved (Cloud Function Charter §2 and State Machine §4) but not written by any Version 1 function, and the client must not read it.
- The bootstrap does not assume any claim beyond `role` and `schoolId`. Additional claim keys, if observed, are ignored.
- The bootstrap does not derive lifecycle state from claims. Lifecycle state comes only from the Firestore record's `status`.
- The bootstrap does not write claims and does not attempt to trigger claim issuance directly.

The consistency check in §8 is the only place where claim contents are compared against the Firestore record. Every other client surface consumes the resolved Session kind.

---

## 7. Required Firestore User Record Fields

The bootstrap reads `users/{callerUid}` under the caller's own credentials via the Sprint 2 affirmative self-get rule. The read is expected to return a document conforming to the canonical `UserRecord` shape (`platform/functions/src/shared/types/user.ts`).

The bootstrap consumes exactly these fields:

- `status` (required) - the lifecycle discriminator. Must be one of the five values in State Machine §1.
- `role` (present when `status ∈ { active, pendingVerification }`) - the authorization intent from the server side. Must be one of `"teacher"`, `"student"`, `"platformAdministrator"` when present.
- `schoolId` (present when `status ∈ { active, pendingVerification }`) - the school scope. Must be a non-empty string when present.
- `displayName` (present when `status ∈ { active, pendingVerification }`) - the display name for header rendering. The bootstrap trusts the server-written value verbatim; no client-side normalization applies.
- `email` (optional) - passed through to the `provisioned` session kind for display only.

Fields the bootstrap does not read: `authUid` (redundant with the document id), `createdAt`, `grade`, `teacherProfile`, `studentProfile`, `consentState`. Those fields belong to later sprints and are ignored by the Sprint 3 client even if present.

Shape validation. The bootstrap validates the returned document against the shape above. If the document is missing (`snapshot.exists === false`), if `status` is absent or not in the closed enumeration, or if `status ∈ { active, pendingVerification }` and any of `role`, `schoolId`, `displayName` is absent or malformed, the bootstrap resolves to the `error` kind with `reason = "recordShapeInvalid"` or `"userRecordMissing"` (see §9). Shape violations are treated as unrecoverable and do not fall back to a lesser-privilege session kind, because a malformed record indicates that something upstream (the trigger, a callable, or a manual edit) has left the record in an unsupported state and any downstream inference would be a guess.

---

## 8. Token/Record Drift Handling

Custom claims and the Firestore record are written by two adjacent operations inside the same Cloud Function (`teachersApproveVerification`, for example: `writeCustomClaims` followed by the Firestore update; the two writes are ordered but not transactional across systems). The client will occasionally observe:

- **Record ahead of token.** `status === "active"`, `role`, and `schoolId` are on the Firestore record; the cached ID token still reflects the pre-approval state (no claims, or stale claims).
- **Token ahead of record.** Rare; occurs only in reordered write scenarios that are considered defects rather than normal operation. If observed, treat as drift and refuse the higher-privilege surface.

Drift handling procedure. After the initial `onAuthStateChanged` resolution and before evaluating the session kind, the bootstrap performs the following:

1. Read the current ID token result *without* forcing a refresh (`getIdTokenResult()`).
2. Read `users/{callerUid}` under the caller's own credentials.
3. Evaluate the consistency check:
   - If the Firestore `status` is `active` and the token claims `role` is missing or does not match the Firestore `role`, or the token claims `schoolId` is missing or does not match the Firestore `schoolId`: this is the "record ahead of token" case. Force-refresh the token (`getIdTokenResult(true)`) and re-evaluate consistency once. If the refreshed token now matches, resolve to the `active*` session kind. If it still does not match, resolve to `pendingVerification` (see §12).
   - If the Firestore `status` is `pendingVerification` and the token claims are present with `role === "teacher"`: this is the "token ahead of record" case. Refuse the teacher shell. Resolve to `pendingVerification`. Do not attempt any client-side mitigation beyond refusal; the record is authoritative for lifecycle (State Machine §4).
   - If the Firestore `status` is `active` and the token claims match the record: resolve to the appropriate `active*` session kind.
   - If the Firestore `status` is any other value: token contents are not consulted for that resolution.

The bootstrap force-refreshes the token at most once. Repeated refresh loops are prohibited. If a single force-refresh does not resolve drift, the bootstrap treats the caller as the lesser of the two authorizations and moves on. This mirrors the recommendation in Step 1 §7 ("record wins on disagreement per State Machine §4").

The bootstrap never mutates claims and never invokes any callable to resolve drift. Drift caused by a defect upstream is not fixable client-side; refusal is the correct response.

---

## 9. Error and Loading States

The bootstrap is a single asynchronous procedure. It has one loading state and one error class.

**Loading state.** From the moment the client entry point calls the bootstrap until the returned promise resolves, no route surface is rendered. `app/index.html` renders a plain, non-branded loading indicator (a single accessible line of text: "Loading LyfeLabz Platform" or equivalent) inside the router mount node. The indicator uses only inline CSS already loaded by `app/index.html`. No spinner asset, no network fetch, no external font.

**Error class.** The bootstrap resolves to `{ kind: "error", reason }` in the following cases. It never throws to the caller; every error path is a discriminated Session kind.

- `authInitFailed` - the Auth SDK failed to initialize (thrown during `getAuth()` or during `onAuthStateChanged` subscription).
- `userRecordUnreadable` - `getDoc(users/{callerUid})` rejected with any error. The bootstrap does not classify the underlying error further; every read failure is treated identically because the client cannot distinguish rules regressions from network failures with confidence.
- `userRecordMissing` - the read succeeded but `snapshot.exists === false`. This should not occur under normal operation because `authOnUserCreate` creates the record on Auth user creation. If observed, it indicates that the trigger failed or has not yet run.
- `recordShapeInvalid` - shape validation per §7 rejected the returned document.
- `networkUnavailable` - the browser reports offline (`navigator.onLine === false`) at the moment of resolution, and the read has not succeeded. The bootstrap prefers `userRecordUnreadable` when a read attempt was made; `networkUnavailable` is reserved for the case where the bootstrap can determine offline before attempting the read.

Router behavior on `error`:

- All error kinds route to the sign-in surface with a plain-language banner.
- `userRecordMissing` additionally offers a single retry affordance (a button that re-invokes the bootstrap). No automatic retry occurs.
- Neither the loading state nor the error state renders any protected surface. There is no partial rendering of a teacher shell during loading and no fallback to a cached prior session.

The bootstrap does not persist any part of a prior session to `localStorage`, `sessionStorage`, IndexedDB, or a service worker cache. Firebase Auth may persist its own tokens per its default policy; the bootstrap does not extend that persistence to session content.

---

## 10. Signed-Out Behavior

When the resolved `onAuthStateChanged` result is `null`, the bootstrap resolves to `{ kind: "unauthenticated" }` and performs no further work.

Router behavior:

- Every route path under `/app/**` that is not the sign-in surface routes to the sign-in surface.
- The sign-in surface renders the sign-in UI defined by Step 4 (specification only in Step 3; Step 3 implements a stub with a single Google sign-in control if the sign-in surface stub is part of Step 3's minimal deliverable).
- No Firestore read is attempted while the session is `unauthenticated`. The bootstrap does not preemptively fetch anything.
- Sign-out from any authenticated route calls `signOut` on the initialized Auth instance and re-invokes the bootstrap. The bootstrap resolves to `unauthenticated` on the next `onAuthStateChanged` tick, and the router routes to the sign-in surface.

The sign-in surface itself is a stub in Step 3. Step 4 fills in the role picker and pending screen. Step 3 owns only the bootstrap and the router.

---

## 11. Provisioned User Behavior

Trigger: authenticated caller, Firestore `status === "provisioned"`, no `role`, no `schoolId`, no `displayName`. Custom claims absent.

Session kind: `provisioned`.

Router behavior:

- Route to `/app/onboarding`. In Sprint 3 this is a stub that renders "Onboarding placeholder" and a sign-out control. The stub does not present the role picker; that surface belongs to Step 4.
- Every other `/app/**` path (except `/app/signin`, which redirects here) is routed to `/app/onboarding` because the caller cannot access any other surface.
- No callable invocation. No Firestore write. No consent capture.

The bootstrap does not distinguish between "just provisioned" and "provisioned after teacher denial." Both resolve to the same session kind because the state machine collapses the "denied" outcome back to `provisioned` (State Machine §3, `teachersDenyVerification` transition). Any user-visible explanation of a prior denial is deferred to Step 4.

---

## 12. Pending Verification Behavior

Trigger: authenticated caller, Firestore `status === "pendingVerification"`, `role === "teacher"`, `schoolId` and `displayName` present. Custom claims absent (the canonical case) or, in the "token ahead of record" drift case, present but refused per §8.

Session kind: `pendingVerification`.

Router behavior:

- Route to `/app/pending`. In Sprint 3 this is a stub that renders the caller's `displayName` and a sign-out control. The plain-language explanation belongs to Step 4.
- Every other `/app/**` path is routed to `/app/pending`.
- No polling. The stub does not attempt to detect approval in-session. Chris confirmed in Step 1 §14 that a manual refresh affordance is acceptable for Sprint 3; that affordance is a page reload, not a background poller. If the router receives a manual reload signal (page reload or explicit sign-out/sign-in), it re-invokes the bootstrap, which force-refreshes the token per §8 and re-evaluates.
- No callable invocation from this surface.

The bootstrap never renders a teacher shell while `status === "pendingVerification"`, even if claims contain `role === "teacher"`. This is the enforcement of "record wins on disagreement" from State Machine §4.

---

## 13. Active Teacher Behavior

Trigger: authenticated caller, Firestore `status === "active"`, Firestore `role === "teacher"`, Firestore `schoolId` present, claims consistent with the record after the drift procedure in §8.

Session kind: `activeTeacher`.

Additional read. Only for `activeTeacher`, `activeStudent`, and `activeAdministrator` sessions, the bootstrap performs one `get schools/{schoolId}` under the caller's own credentials to obtain `schoolName` for the stub header. This read is authorized by the Sprint 2 affirmative rule on `schools/{schoolId}` (authenticated get). If the school read fails or the returned document is missing `name`, the bootstrap does not fail the session; it degrades `schoolName` to the empty string and the stub header renders without a school name. School read failure is not an error kind because the school header is presentational, not authorization-bearing.

Router behavior:

- Route to `/app/teacher`. In Sprint 3 this is a stub that renders the caller's `displayName`, the resolved `schoolName`, and a sign-out control. No teacher features.
- Every other `/app/**` path (except `/app/signin`, which routes here when the caller is already authenticated as an active teacher) is routed to `/app/teacher`.
- No callable invocation. No teacher-authored data. No classroom, enrollment, assignment, submission, gradebook, or analytics affordance.

The active teacher gate defined in Step 1 §7 is implemented in Step 5, not Step 3. The Step 3 router evaluates only the Session kind, which is a superset of the gate's conditions because the bootstrap has already validated `status`, `role`, `schoolId`, and claim consistency. Step 5 will add an explicit gate function that re-evaluates these six conditions at the shell entry point for defense in depth; Step 3's contribution is the Session kind that the gate consumes.

---

## 14. Suspended User Behavior

Trigger: authenticated caller, Firestore `status === "suspended"`.

Session kind: `suspendedUser`.

Router behavior:

- Route to a plain refusal surface (implemented as a stub that renders a single line of plain-language text and a sign-out control). The refusal surface never renders authenticated content.
- No school read. No further Firestore read of any kind. No callable invocation.

Sprint 3 does not implement any suspend or reinstate workflow (the transitions remain reserved per State Machine §3). The bootstrap must nonetheless refuse suspended accounts because the state may exist in emulator fixtures or in future data used by rules-test suites. Refusal is the correct client behavior regardless of when suspension is implemented server-side.

---

## 15. Archived User Behavior

Trigger: authenticated caller, Firestore `status === "archived"`.

Session kind: `archivedUser`.

Router behavior:

- Identical to §14. Route to the plain refusal surface. Sign-out is the only affordance.
- No school read, no further Firestore read, no callable invocation.

The bootstrap does not distinguish `suspendedUser` from `archivedUser` in any user-visible way in Sprint 3. Both resolve to the same refusal surface with the same plain-language message. A future sprint may differentiate them; Sprint 3 does not.

---

## 16. Rejected or Unsupported Account Behavior

The bootstrap encounters "rejected or unsupported account" outcomes in two distinct forms.

**Personal-account rejection during onboarding.** This is not a bootstrap concern in Sprint 3. Personal-account rejection is a callable outcome (`auth.activationRejected` per State Machine §3 audit-only rows) surfaced by the role picker in Step 4. The bootstrap does not observe a "rejected" lifecycle state because there is no such state; a rejected onboarding attempt leaves the caller in `provisioned`.

**Unsupported account shape.** If the bootstrap observes a `users/{uid}` record with any of the following, it resolves to `{ kind: "error", reason: "recordShapeInvalid" }`:

- `status` is present but not one of the five canonical values.
- `status ∈ { active, pendingVerification }` and any of `role`, `schoolId`, `displayName` is missing.
- `role` is present but not one of `"teacher"`, `"student"`, `"platformAdministrator"`.
- `schoolId` is present but not a non-empty string.

Unsupported shape is treated as an unrecoverable, non-authorization-bearing outcome. The router routes to sign-in with an error banner. The bootstrap does not attempt to repair the record and does not offer the caller any affordance beyond sign-out. The condition indicates a defect that must be diagnosed server-side.

**Unsupported role in claims.** If `claims.role` is present but not in the canonical enumeration, the bootstrap treats the claim as absent for the purpose of the consistency check in §8. The Firestore record is authoritative; if the record's `role` is canonical, the session resolves based on the record. If the record's `role` is also non-canonical, the previous paragraph applies.

---

## 17. School Context Handling

School context in Sprint 3 is a narrow concept: the resolved session may carry a `schoolId` (for `pendingVerification` and all `active*` kinds) and, for `active*` kinds only, a `schoolName` for header rendering.

- `schoolId` on the session object comes exclusively from the Firestore `users/{uid}` record. It is never read from claims for the purpose of populating the session object, even though claims also carry `schoolId`. The consistency check in §8 compares the two; the session object exposes the record value.
- `schoolName` comes from `schools/{schoolId}.name` and is fetched only for `active*` kinds. Fetch failure degrades to an empty string (see §13) and is not surfaced as an error.
- No school directory. The bootstrap does not `list` schools and does not offer school selection. School selection during onboarding is a Step 4 concern; per Step 1 §14 the recommended pilot posture is a hard-coded pilot school in the role picker, not a directory-driven picker.
- No cross-school context. The session object carries exactly one `schoolId`. Multi-school and multi-district scenarios are out of scope for Sprint 3 and for the entire Sprint 2/3 identity model. `districtId` is reserved and not read.
- No school branding. `brandingRef` on the school record is not read by the bootstrap. Any future branding surface will introduce its own read path outside the session bootstrap.

The bootstrap does not accept an out-of-band school context (URL parameter, `localStorage`, deep-link claim). Any such input is ignored.

---

## 18. Client-Side Security Limitations

The Canonical Session Bootstrap is a UX control, not an authorization control. This is a load-bearing distinction and must be reflected in code review, testing, and future feature work.

- **Any client can be lied to.** A determined caller can modify the client bundle in-browser to bypass the router, forge a Session kind, or invoke Firestore reads/writes directly. The bootstrap makes no attempt to prevent this and cannot.
- **Server rules are the authority.** Every authorization decision that matters (whether a read is permitted, whether a callable succeeds) is enforced by Firestore Security Rules and by Cloud Function contract validation. The bootstrap's role is to prevent honest users from seeing surfaces they are not entitled to and to fail closed when the record and token disagree.
- **The session object is not signed.** It carries no HMAC, no server-side verification. Its trustworthiness derives from the Firestore read that produced it, which is in turn constrained by rules.
- **Force-refreshed tokens still originate on the client.** The token itself is signed by Firebase Auth and is trustworthy; the *decision* to route based on it is a client decision, and a malicious client can skip that decision. Rules do not.
- **No client-side "impersonation" protection.** The bootstrap trusts `user.uid` from `onAuthStateChanged`. If a caller has valid credentials, they are that user. There is no additional identity verification.
- **`navigator.onLine` is advisory.** The `networkUnavailable` error kind is a UX signal only. The bootstrap does not rely on it for correctness; a caller who reports online may still be offline and vice versa.
- **Route defense is not authorization.** Routing an `unauthenticated` caller to sign-in is a UX affordance. If a Sprint 4+ surface expects that only teachers reach `/app/teacher`, the surface itself must re-validate via the Sprint 5 active teacher gate function, which itself is a UX affordance backed by server rules and callable contracts.

Every future sprint that adds a protected surface must add or reuse a server-side authorization check as well. The session bootstrap must never be the sole line of defense for any authorization concern.

---

## 19. Firestore Rules Implications

Sprint 3 Step 3 introduces no changes to `platform/firebase/firestore.rules`. The bootstrap is authorized in full by the Sprint 2 affirmative rules:

- `users/{uid}` self `get` - permits the caller's self-read of their user record. Used by every non-`unauthenticated` bootstrap resolution.
- `schools/{schoolId}` authenticated `get` - permits the school-name lookup used by `activeTeacher`, `activeStudent`, and `activeAdministrator` resolutions.

The bootstrap does not require any `list`, `create`, `update`, or `delete` operation on any collection. The bootstrap does not read `auditEvents`, which remain server-only per Sprint 2. The bootstrap does not attempt to write to `users/{uid}`; the Sprint 2 self-update allowance is scoped to `{ displayName }` and is not exercised by the bootstrap (any future in-app profile edit surface will exercise it separately).

If Step 5 or Step 6 discovers a required client read that is not authorized by the Sprint 2 rules, work pauses and this document is amended to name that requirement before rules are changed. Rules changes are not authorized by Step 3.

The bootstrap's design deliberately keeps the client read footprint identical to the read footprint the Sprint 2 rules already permit. This is the correctness reason the specification explicitly forbids reading `districtId`, iterating schools, reading audit events, or reading other users' records. Any such read would require a new rule.

---

## 20. Non-Goals

Step 3 must not introduce any of the following. This list is exhaustive for the step.

- No sign-in UI beyond a minimal stub (the sign-in surface with the actual provider button, error banner wording, and post-sign-in redirect belongs to Step 4).
- No role picker. No `/app/onboarding` interaction beyond a stub. Callable dispatch is a Step 4 concern.
- No `/app/pending` content beyond a stub. Plain-language explanation and manual refresh affordance are Step 4 concerns.
- No teacher gate function. The six-condition gate belongs to Step 5. Step 3 provides the Session kind on which the gate depends.
- No teacher dashboard. No student dashboard. No administrator dashboard.
- No classrooms, enrollments, join codes, assignments, submissions, gradebook, or analytics. None of these appear in any file created by Step 3.
- No new lifecycle state, no new lifecycle field, no amendment to `PLATFORM_STATE_MACHINE.md`.
- No new custom claim, no `districtId` handling in claims, no `classroomIds`, no `permissions` array.
- No Firestore Rules change.
- No Cloud Function change and no new callable.
- No Storage surface.
- No Hosting configuration change.
- No production deploy.
- No modification of any lesson HTML at the repository root.
- No cross-package import from the client bundle into `platform/functions/**`.
- No CI change in Step 3 itself; CI extension to cover the client bundle's typecheck and unit tests is a Step 6 concern per Step 1 §12.

---

## 21. Validation Plan for Future Implementation

Every command below runs from the specified working directory. All must pass before Step 3 is considered complete.

Run in `platform/functions/`:

- `npm run build`
- `npm run typecheck`
- `npm run lint`
- `npm test`

Run in `platform/firebase/`:

- `npm run test:rules`

Run in the new client bundle root (path finalized during implementation; expected `app/`):

- Client typecheck (TypeScript strict, no errors).
- Client lint (matches `LYFELABZ_ENGINEERING_STANDARDS.md`).
- Client unit tests, which must include at minimum:
  - Bootstrap resolves to `unauthenticated` when `onAuthStateChanged` returns `null`.
  - Bootstrap resolves to `provisioned` on a well-shaped provisioned record.
  - Bootstrap resolves to `pendingVerification` on a well-shaped pending record with absent claims.
  - Bootstrap resolves to `activeTeacher` on a well-shaped active record with consistent claims (no force-refresh needed).
  - Bootstrap resolves to `activeTeacher` on the "record ahead of token" drift case after a single force-refresh.
  - Bootstrap resolves to `pendingVerification` when the record says `pendingVerification` but claims already assert `teacher` ("token ahead of record" refusal).
  - Bootstrap resolves to `pendingVerification` when the "record ahead of token" case still does not match after force-refresh.
  - Bootstrap resolves to `activeStudent` and `activeAdministrator` on their respective well-shaped records.
  - Bootstrap resolves to `suspendedUser` and `archivedUser` on their respective records.
  - Bootstrap resolves to `error(userRecordMissing)` when `snapshot.exists === false`.
  - Bootstrap resolves to `error(recordShapeInvalid)` on each named shape violation in §7 and §16.
  - Bootstrap resolves to `error(userRecordUnreadable)` when the read rejects.
  - Bootstrap does not force-refresh the token when claims and record are already consistent.
  - Bootstrap force-refreshes the token at most once even when drift persists.
  - Router routes each Session kind to the expected stub route.
  - Consistency check module rejects mismatched `role`, mismatched `schoolId`, missing claims when record is `active`, and unsupported `claims.role` values.

Optional (recommended but not required for Step 3 completion, deferred to Step 5 if scheduling is tight): an emulator-driven integration test that walks a fresh Firebase Auth user through provisioning and confirms the bootstrap resolves to `provisioned`. The full end-to-end walk through teacher request, administrative approval, and shell rendering is a Step 5 concern.

Confirm CI (`platform-ci.yml`) remains green. CI expansion to cover the client bundle is a Step 6 concern per Step 1 §12; Step 3 does not modify CI configuration.

---

## 22. Local Verification Plan for Chris

After implementation, Chris performs the following manual checks against the Hosting + Firestore + Auth + Functions emulator suite. All checks are performed in a real browser.

1. Start the emulator suite (`npx firebase emulators:start`) and load `http://127.0.0.1:5000/app/`. Confirm the page renders the loading indicator briefly and then a stub surface. Confirm the browser console is clean.
2. Confirm the anonymous instructional site is unaffected: load `http://127.0.0.1:5000/` and `http://127.0.0.1:5000/lesson_earths-layers.html`. Both render as they did after Step 2. No Firebase SDK network activity is observed for these pages.
3. Sign out (if signed in) and load `http://127.0.0.1:5000/app/teacher`. Confirm the router routes to the sign-in stub. Confirm no protected surface is rendered.
4. Create a fresh Firebase Auth user via the emulator UI. Sign in in the browser. Confirm the router routes to the provisioned stub (`/app/onboarding`). Confirm no teacher, student, or administrator content is rendered.
5. Via the emulator UI or a direct callable invocation, promote the record to `pendingVerification` (using `teachersRequestVerification`). Reload `/app/`. Confirm the router routes to the pending stub and displays the caller's display name.
6. Via a direct callable invocation under a `platformAdministrator` identity (per Step 1 §12), approve the teacher. Reload `/app/`. Confirm the router routes to the teacher stub and displays the caller's display name and school name. Confirm the token was force-refreshed only when necessary (visible in the emulator function logs or via a client-side console assertion added for verification and removed before commit).
7. Directly edit the emulator's Firestore record to `status = "suspended"`. Reload. Confirm the router routes to the refusal surface. Repeat for `status = "archived"`. Repeat for a deliberately malformed record (for example, `status = "active"` with `role` removed). Confirm the router routes to sign-in with an error banner.
8. Turn off the browser network (devtools offline mode) after sign-in. Reload. Confirm the router routes to sign-in with an error banner and does not render any protected surface from a cache.
9. Confirm `git status` is clean apart from the files enumerated in §2. No lesson HTML, no root `index.html`, no `firebase.json`, no rules or functions files are modified.

If any check fails, Chris reports back and Step 3 is diagnosed before proceeding.

---

## 23. Rollback Notes

Step 3 is fully reversible because it introduces no server-side state, no rules change, no Cloud Function change, and no deployed configuration.

To roll back:

1. Restore `app/index.html` to the plain-text Step 2 placeholder (see Step 2 §5).
2. Delete the client bundle directory (recommended `app/src/` and `app/test/`) and any client-side build artifacts.
3. Confirm `platform/firebase/firebase.json` is unchanged from the Step 2 state.
4. Confirm no other file was modified. `git status` should be clean apart from the reverted `app/` tree.
5. Because Step 3 does not deploy, no production surface is affected. GitHub Pages continues to serve the anonymous instructional site from the repository root exactly as before, and the Firebase Hosting emulator continues to serve `/app/**` to the plain-text placeholder introduced in Step 2.
6. No Firestore Rules changed, no Cloud Functions changed, no lifecycle state changed, and no custom claim changed. There is nothing to migrate and nothing to unwind on the identity trust layer.

Rollback should complete in a single commit or a single discarded working tree.

---

## 24. Recommended Sprint 3 Step 4

Once Step 3 is merged and verified, the recommended Step 4 is the **role picker and pending screen**, exactly as described in `SPRINT_3_STEP_1_SPECIFICATION.md` §12 "Step 4".

Step 4 will:

- Replace the stub at `/app/onboarding` with the role picker. Presents student and teacher choices, collects `displayName`, and (for the pilot) uses the hard-coded pilot `schoolId` per Step 1 §14.
- Invoke `studentsCompleteOnboarding` on the student choice or `teachersRequestVerification` on the teacher choice.
- Surface `auth.activationRejected` outcomes with plain-language rejection wording (finalized in Step 4).
- Replace the stub at `/app/pending` with a plain-language waiting explanation and a manual sign-out control. No polling. A manual reload is the only in-session re-evaluation path.
- Replace the sign-in stub with the actual sign-in surface (Google provider by default per pilot posture; provider decision is finalized in Step 4).
- Add client-side unit tests for the role picker and pending screen. Add an emulator-driven integration test for the student activation path (the teacher approval path is a Step 5 concern).

Step 4 introduces no new Firestore Rules, no new Cloud Function, no new lifecycle state, no new custom claim, and no new collection or field. It exercises only Sprint 2 affirmative rules and Sprint 2 callables. It consumes the Session kinds produced by the Step 3 bootstrap without extending them.

If Step 4 discovers a need for any new rule, function, state, claim, or schema, work pauses and the appropriate canonical document (`PLATFORM_STATE_MACHINE.md`, `LYFELABZ_FIRESTORE_DATA_MODEL.md`, `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`, or `LYFELABZ_FIREBASE_SECURITY_MODEL.md`) is amended before proceeding.

---

*End of Sprint 3 Step 3 specification. No implementation code produced. No Firebase SDK initialized. No auth UI added. No Firestore Rules, Cloud Functions, or Hosting configuration modified. No commits produced.*

---

## Appendix: Implementation Retrospective

This appendix is documentation only. It records how Step 3 was actually delivered, what could have been done differently, and the guidance that follows for future platform work. It does not modify the approved Step 3 architecture, the Session model, the bootstrap, consistency validation, dependency injection, bounded token refresh, Firestore-authoritative behavior, Firebase initialization, or router behavior beyond the route-set cleanup captured in the Sprint 3 Step 3 Final Cleanup pass.

### The four logical implementation phases

During the Engineering Design Review the implementer identified that Step 3 could have been decomposed into four independently reviewable commits without changing the approved architecture:

1. **Phase 1 - Toolchain scaffold.** An `app/` npm package that can typecheck and run jest against pure TypeScript. No source. No runtime dependencies. No bundler. No DOM. Deliverable: `npm run typecheck` and `npm test` succeed with zero tests. Verifies only that the toolchain is wired up.
2. **Phase 2 - Canonical Session Bootstrap module.** `app/src/session/types.ts`, `user-record.ts`, `consistency.ts`, `bootstrap.ts`, and their unit tests. A pure, SDK-independent, DOM-independent TypeScript module. No Firebase runtime import. No router. Deliverable: 37 unit tests covering every branch of the bootstrap's state machine and every named error kind.
3. **Phase 3 - Firebase adapter, entry point, bundler.** `app/src/firebase.ts`, `app/src/index.ts`, esbuild, the `firebase` runtime dependency, and the host-page mount node in `app/index.html`. The Phase-3 entry point renders a plain verification line (`session: ${kind}`) after the bootstrap resolves. Deliverable: the emulator suite renders the resolved Session kind end-to-end in a browser.
4. **Phase 4 - Router and stub surfaces.** `app/src/router/router.ts`, `app/src/router/routes.ts`, the router unit tests, jsdom, and (optionally) ESLint. Replaces the Phase-3 verification line with per-kind stubs. Deliverable: the emulator suite renders the per-kind stub content.

The four phases share zero behavior change relative to the single-commit implementation. Their purpose was to separate architectural concerns - toolchain, pure module, runtime posture, presentation - so that each concern could be reviewed against its own criteria.

### Why the implementation landed as a single commit

Step 3 landed in one commit because the implementer read the refined task list (which included "Implement routing decisions for all supported session states") together with the file list in §2 of this specification as a single authorized deliverable, and prioritized producing an end-to-end demonstrable result over minimizing review surface per commit.

Concretely:

- The task's item seven authorized the router, so the router landed alongside the bootstrap.
- Without a Firebase adapter and an entry point, the bootstrap could not be exercised in a browser. To make the deliverable observable to Chris, the adapter and entry point came in the same commit.
- Once an entry point existed, a bundler was needed. esbuild was selected as the smallest zero-config option that could produce an ESM bundle for `/app/**`.
- Once a bundler existed, `app/index.html` had to load the bundled artifact. The host page updated in the same commit.
- Toolchain (TypeScript, jest, ts-jest, jest-environment-jsdom) was necessary from the first line of source and therefore landed with the source.
- ESLint was added as parity with `platform/functions/` even though the review later identified it as non-essential to Step 3.

The Technical Lead's review recorded the resulting boundary as acceptable in terms of architecture but too broad in terms of reviewability. The decision to keep the implementation as a single commit was made in the Final Cleanup pass; this appendix documents that history so that future readers understand why the commit spans four logical concerns.

### Guidance for future platform work

The identity trust layer delivered by Sprints 1 and 2 landed as a sequence of narrow, individually reviewable commits (each Sprint 2 step: rules, callable, tests, audit event). The frontend foundation should be held to the same standard going forward. The following guidance applies to every future step in the platform:

- **Prefer the smallest commit that has a single reason to exist.** If a step introduces a module, a runtime dependency, and a bundler simultaneously, at least three separate concerns are being decided at once. Split unless there is a specific reason not to.
- **Separate the pure module from its runtime posture.** A pure TypeScript module (like the Canonical Session Bootstrap) should be reviewable and testable without any decision about how it will be initialized, bundled, or served. Adapters and entry points land in later commits.
- **Separate the toolchain decision from the source it enables.** Introducing a bundler is an architectural decision (esbuild vs. Vite vs. Rollup vs. no bundler). It deserves its own review, ideally its own commit, and should not be introduced silently alongside a feature.
- **Do not introduce presentation in a data-plane step.** Route surfaces, DOM stubs, and UI content are their own concern. If a step's goal is to establish a data-plane module, presentation belongs to a later step. Phase 4 stubs in Step 3 were justified only by "the reviewer needs to see something render"; a plain verification line would have served the same purpose with less review surface.
- **Introduce new architectural artifacts only through an approved amendment.** The Sprint 3 Step 3 initial implementation invented two route paths (`/app/administrator`, `/app/refused`) that were not part of the Step 1 §5 approved route set. Final Cleanup removed them. Future work must not introduce new routes, new lifecycle states, new custom claims, new collections, or new Cloud Function contracts without a corresponding amendment to the appropriate canonical document.
- **When in doubt, ship less and ask.** A step that produces one narrow, obviously-correct commit is easier to review than a step that produces a broadly-scoped commit whose correctness depends on the reviewer holding four concerns in mind at once. Asking before broadening scope is cheaper than defending the broader scope after the fact.

This guidance is documentation, not a rule change. It reflects the Technical Lead's expectation that the frontend foundation is held to the same care standard as the backend identity foundation.

---

*End of Implementation Retrospective. Documentation only. No architectural behavior changed.*
