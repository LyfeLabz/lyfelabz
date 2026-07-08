# LyfeLabz Sprint 3 Step 1 Technical Specification

**Status:** Architecture planning. No implementation.
**Sprint:** Sprint 3, Step 1 (Teacher Platform Foundation, architecture review)
**Companion documents:** LYFELABZ_PLATFORM_ARCHITECTURE.md, LYFELABZ_FIRESTORE_DATA_MODEL.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, LYFELABZ_ENGINEERING_STANDARDS.md, PLATFORM_STATE_MACHINE.md, SPRINT_2_COMPLETION_REPORT.md, SPRINT_HISTORY.md

This document scopes Sprint 3 Step 1 only. It captures the current architecture findings and a proposed teacher-platform-foundation shape. It does not authorize implementation. Steps 2 through 6 will each ship under their own commit series and their own validation gate.

---

## 1. Current Architecture Findings

The identity trust layer delivered by Sprint 2 is complete and internally consistent. The following invariants are load-bearing for Sprint 3.

- `users/{uid}` is the sole canonical user record. Provisioning-required fields (`authUid`, `status`, `createdAt`) are always present. Activation-required fields (`role`, `schoolId`, `displayName`) are present only when `status` is `active` or `pendingVerification`.
- `status` is the one and only lifecycle field. Values are the five defined in `PLATFORM_STATE_MACHINE.md` §1.
- Custom claims are exactly `{ role, schoolId }`. Claims are written only on transitions arriving at `active`. `districtId` is documented as reserved but not written by any Version 1 function.
- Every audit write flows through `writeAuditEvent`. User-actor events require a resolvable `schoolId`; system-actor events may omit it (only `auth.userProvisioned` does so today).
- Every claims write flows through `writeCustomClaims`.
- The callable surface consists of exactly five functions: `authOnUserCreate` (trigger), `studentsCompleteOnboarding`, `teachersRequestVerification`, `teachersApproveVerification`, `teachersDenyVerification`.
- Firestore Rules over the default-deny baseline: `users/{uid}` self `get` and self `update` limited to `{ displayName }`; `schools/{schoolId}` authenticated `get`; `auditEvents/{eventId}` explicit server-only.
- No Firebase Hosting target is configured yet. `firebase.json` declares Firestore, Storage, Functions, and Emulators only.
- No client bundle, no route table, and no session bootstrap exist in the repository. The instructional lesson HTML files at the repository root are anonymous, unauthenticated pages and remain so.

---

## 2. Files Reviewed

Architecture and lifecycle documents:

- `docs/platform/LYFELABZ_PLATFORM_ARCHITECTURE.md`
- `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md` (§3.1, §3.2, §3.8)
- `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md` (§3 role bands)
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (§1, §2, canonical claims shape)
- `docs/platform/LYFELABZ_ENGINEERING_STANDARDS.md`
- `docs/platform/PLATFORM_STATE_MACHINE.md`

Sprint history:

- `docs/platform/SPRINT_HISTORY.md`
- `docs/platform/SPRINT_1_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_2_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_2_PREVIEW.md`
- `docs/platform/LYFELABZ_SPRINT_2_ONBOARDING_AND_VERIFICATION.md`

Implementation surface:

- `platform/firebase/firebase.json`
- `platform/firebase/firestore.rules`
- `platform/functions/src/index.ts`
- `platform/functions/src/auth/auth-on-user-create.ts`
- `platform/functions/src/students/students-complete-onboarding.ts`
- `platform/functions/src/teachers/teachers-request-verification.ts`
- `platform/functions/src/teachers/teachers-approve-verification.ts`
- `platform/functions/src/teachers/teachers-deny-verification.ts`
- `platform/functions/src/shared/types/user.ts`
- `platform/functions/src/shared/types/school.ts`
- `platform/functions/src/shared/types/audit-event.ts`
- `platform/functions/src/shared/auth/claims.ts`
- `platform/functions/src/shared/audit/write-audit-event.ts`
- `platform/functions/src/shared/firestore/typed-ref.ts`

---

## 3. Proposed Sprint 3 Teacher Platform Foundation Scope

Sprint 3 delivers the minimal protected teacher platform shell that exercises the Sprint 2 identity trust layer end to end from a real browser. It builds:

- A Firebase Hosting configuration for a small authenticated client bundle, published under a dedicated path prefix.
- A sign-in surface that uses Firebase Authentication and triggers `authOnUserCreate` on first sign-in.
- A role-picker surface that, for teachers, invokes `teachersRequestVerification`.
- A `pendingVerification` waiting screen keyed off the caller's `users/{uid}` document.
- A protected teacher shell rendered only when the caller is `active` with `role === "teacher"` in custom claims and in the Firestore user record.
- Sign-out from the shell.
- A session bootstrap that reads the caller's ID token claims and the caller's `users/{uid}` document exactly once per session.
- Client-side rules tests for every affirmative Firestore path the client depends on.

Sprint 3 does not build teacher features. It builds the gate.

---

## 4. Non-Goals

Sprint 3 must not implement:

- Any `classes` collection, `enrollments` collection, join codes, `assignments`, `submissions`, gradebook tools, or teacher analytics.
- Any full teacher dashboard beyond a placeholder shell that proves the gate.
- Any student dashboard beyond a placeholder shell that proves the gate.
- School domain verification, verified-domain storage, or auto-verification.
- Any new lifecycle state (no `activationState`, no `onboardingState`, no `verified` boolean, no `restricted` flag).
- Any new claim (no `districtId`, no `classroomIds`, no `permissions` array).
- Any second write path for claims or audit events.
- Any suspend, reinstate, or archive workflow.
- Any production deployment.

---

## 5. Recommended Route Structure

The client shell lives under a distinct top-level path so the anonymous lesson repository at the repository root is unaffected. Recommended layout:

- `/app/` - client bundle entry. Redirects to `/app/signin` if unauthenticated, `/app/pending` if `pendingVerification`, `/app/teacher` if `active` teacher, `/app/student` if `active` student, `/app/onboarding` if `provisioned`.
- `/app/signin` - sign-in surface. Renders unauthenticated only.
- `/app/onboarding` - role picker. Renders when `status === "provisioned"`. Dispatches to `teachersRequestVerification` or `studentsCompleteOnboarding` based on selection.
- `/app/pending` - pending-verification waiting screen. Renders when `status === "pendingVerification"`.
- `/app/teacher` - protected teacher shell. Renders only when the caller passes the active teacher gate (§7).
- `/app/student` - placeholder protected student shell (rendered only to prove that the gate is not teacher-specific). No student features.

Every non-`/app/` path continues to serve the anonymous instructional repository.

Hosting configuration adds a rewrite that maps `/app/**` to the client bundle's `index.html`. The client routes internally. No lesson HTML file is moved.

---

## 6. Recommended Session Bootstrap Shape

The session bootstrap runs once per authenticated session and produces a small, immutable in-memory object consumed by the router.

Shape (illustrative TypeScript, not implementation code):

```
type Session =
  | { kind: "unauthenticated" }
  | { kind: "provisioned"; uid: string }
  | { kind: "pendingVerification"; uid: string; schoolId: string }
  | { kind: "activeTeacher"; uid: string; schoolId: string; displayName: string }
  | { kind: "activeStudent"; uid: string; schoolId: string; displayName: string }
  | { kind: "activeAdministrator"; uid: string; schoolId: string; displayName: string };
```

Bootstrap sequence:

1. Wait for a resolved `onAuthStateChanged` result.
2. If unauthenticated, return `{ kind: "unauthenticated" }`.
3. Force-refresh the ID token to pick up any claims written by the most recent Cloud Function.
4. Read `users/{uid}` under the caller's own credentials. Rely on the Sprint 2 self-get rule.
5. Cross-check that the token's `role` and `schoolId` (when present) match the Firestore record's `role` and `schoolId`. If they diverge, treat the session as the *lesser* of the two authorizations (record wins on disagreement per State Machine §4 "Current account state comes from Firestore").
6. Derive the Session kind from `status` and `role`. Never infer state from URL, from local storage, or from token contents alone.

The bootstrap performs at most one Firestore read and at most one token refresh. It performs no writes.

---

## 7. Recommended Active Teacher Gate Rules

The teacher shell renders only when all of the following are true, evaluated in order, with the first failure short-circuiting the gate.

1. `request.auth != null` (authenticated).
2. Firestore `users/{uid}.status === "active"`.
3. Firestore `users/{uid}.role === "teacher"`.
4. Firestore `users/{uid}.schoolId` is a non-empty string.
5. ID token `claims.role === "teacher"`.
6. ID token `claims.schoolId === users/{uid}.schoolId`.

If (5) or (6) fail while (2), (3), and (4) succeed, the gate treats the session as `pendingVerification`-equivalent and refuses the shell. This handles the narrow window where an administrator has approved the teacher but the client token has not yet been refreshed; the bootstrap force-refreshes the token before evaluating the gate to close that window.

Every gate failure routes to the pending screen or the sign-in screen. No error text mentions administrative approval workflow beyond the language already required by the pending screen.

---

## 8. Firestore Reads Needed by the Client

Sprint 3 requires exactly two client-initiated Firestore read patterns, both already permitted by the Sprint 2 rules:

- `get users/{callerUid}` - the session bootstrap. Covered by Sprint 2 self-get.
- `get schools/{schoolId}` - the role picker (to display the school name confirming the caller's onboarding target) and the teacher shell header (to display the school name). Covered by Sprint 2 authenticated-get on schools.

No `list` operation, no cross-user read, and no audit-event read is required.

If the role picker needs a school directory (rather than a preselected schoolId), that requirement is deferred; Sprint 3 assumes the caller's `schoolId` is provided by a mechanism the sprint specification will name (recommendation: hard-coded pilot school in the client bundle until a directory feature is planned). Introducing a schools `list` rule is out of scope for Sprint 3.

---

## 9. Custom Claim Assumptions

The client trusts only that claims contain `{ role, schoolId }`. No claim beyond those two is read. No claim beyond those two is expected to exist. The client never writes to claims.

Explicit non-assumptions:

- The client does not assume claims are present. Absence of claims is the canonical signal that the caller is not `active`.
- The client does not assume `districtId` exists.
- The client does not derive lifecycle state from claims. Claims answer "may this caller do X"; the Firestore record answers "where is this account in the platform."

---

## 10. Security and Rules Implications

Sprint 3 requires no new affirmative Firestore Rules over the Sprint 2 baseline. Every client read Sprint 3 needs is already authorized by:

- `users/{uid}` self get.
- `schools/{schoolId}` authenticated get.

Sprint 3 requires no `update`, `create`, or `delete` from the client. Every lifecycle transition still flows through the Sprint 2 callables. In particular:

- The role picker calls `teachersRequestVerification` or `studentsCompleteOnboarding` and awaits the callable's result. It does not mutate `users/{uid}` directly.
- The pending screen does not attempt to poll or write.
- The teacher shell is read-only until Sprint 4+ introduces teacher-authored data.

Storage rules remain default-deny. No Storage surface is opened.

Firebase Hosting configuration is expanded to serve the client bundle from a distinct path. Hosting rewrites are configured so that the anonymous lesson repository at the repository root continues to serve unchanged.

---

## 11. Architecture Documents That Should Be Amended Before Implementation

The following amendments are recommended before Sprint 3 Step 2 begins. Each is small and scoped.

- `LYFELABZ_PLATFORM_ARCHITECTURE.md` §3, §10: add the `/app/**` client shell as the first authenticated Hosting surface. Confirm the anonymous lesson repository continues to serve from the repository root without a client bundle dependency.
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md` §3.4, §3.5: add a one-paragraph note that the client's session bootstrap performs exactly one self-read of `users/{uid}` and one `get` of `schools/{schoolId}`, and that no client `list` or cross-user read is authorized in Sprint 3.
- `SPRINT_3_PREVIEW.md`: author a brief preview mirroring `SPRINT_2_PREVIEW.md`, referencing this Step 1 specification.

No amendment to `PLATFORM_STATE_MACHINE.md` is required. Sprint 3 introduces no new state, no new transition, and no new lifecycle field. If Sprint 3 discovers a need for any of those, the state machine is amended *first* and Sprint 3 pauses.

No amendment to `LYFELABZ_FIRESTORE_DATA_MODEL.md` is required. Sprint 3 introduces no new collection and no new field.

No amendment to `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` is required. Sprint 3 introduces no new Cloud Function.

---

## 12. Proposed Implementation Sequence for Sprint 3 Steps 2 through 6

Each step ships under its own commit and its own verification gate. No step overlaps with the next.

**Step 2 - Hosting scaffold.**
Add Firebase Hosting configuration to `platform/firebase/firebase.json` that serves the client bundle under `/app/**` via a rewrite to `/app/index.html`. Add a minimal placeholder `/app/index.html` that renders "LyfeLabz Platform" and nothing else. No authentication logic yet. Verify against the Emulator Suite that the anonymous lesson repository is unaffected. No Cloud Function changes.

**Step 3 - Sign-in surface and session bootstrap.**
Add the sign-in page at `/app/signin`, the session bootstrap module, and the router that dispatches by Session kind. On successful sign-in, the router routes to `/app/onboarding` (for `provisioned`), `/app/pending` (for `pendingVerification`), or `/app/teacher` / `/app/student` (for `active`). The teacher and student shells are stub pages that render only the caller's display name and school name. Add client-side unit tests for the router.

**Step 4 - Role picker and pending screen.**
Add `/app/onboarding` and `/app/pending`. The onboarding page presents student and teacher choices, collects `displayName`, and invokes the appropriate Sprint 2 callable. On callable success, the router re-evaluates the session. The pending screen displays a plain-language explanation and a sign-out control. No polling.

**Step 5 - Active teacher gate and shell.**
Implement the six-condition active teacher gate in §7. The teacher shell renders only when the gate passes. Add an emulator-driven integration test that walks a new Firebase Auth user through provisioning, teacher request, administrative approval (via a direct callable invocation under a `platformAdministrator` claim), and confirms the shell renders. Add corresponding tests for the deny and student paths.

**Step 6 - Sprint 3 completion, documentation, and history append.**
Author `SPRINT_3_COMPLETION_REPORT.md`, append the Sprint 3 section to `SPRINT_HISTORY.md`, and verify all validation commands in §13 pass. No code changes in Step 6.

The sequence is intentionally conservative. Any step that discovers an architecture gap pauses and produces a targeted amendment before proceeding.

---

## 13. Validation Commands to Run After Future Implementation

Run in `platform/functions/`:

- `npm run build`
- `npm run typecheck`
- `npm run lint`
- `npm test`

Run in `platform/firebase/`:

- `npm run test:rules`

Run for the Sprint 3 client bundle (paths finalized in Step 2 spec):

- Client bundle typecheck.
- Client bundle unit tests (router and session bootstrap).
- Emulator-driven integration test that exercises the full onboarding walk.

Confirm CI (`platform-ci.yml`) remains green, and extend it in Step 6 to cover the client bundle's typecheck and unit tests.

---

## 14. Risks and Open Questions

**Risk: token/record drift at the moment of approval.**
After `teachersApproveVerification` writes claims, the client's cached token is stale until the next refresh. Mitigation: the session bootstrap force-refreshes the token before evaluating the gate (§6). The teacher shell must also expose a manual "refresh session" affordance for the narrow window where the caller was approved during an already-open session; alternative mitigation is a scheduled token refresh in the pending screen.

**Risk: schoolId source in the role picker.**
The role picker needs a `schoolId` to submit. Listing schools is out of scope. Options: hard-code the pilot school in the client bundle (recommended for Sprint 3), embed the pilot school in the sign-in URL, or preassign schoolId to auth records via a future admin surface. Decision belongs in the Sprint 3 specification, not this Step 1 document.

**Risk: personal-account rejection surface.**
Sprint 2 named `auth.activationRejected` but did not exercise it. Sprint 3 is the first place the callables can reject on real user input. The role picker must surface a clear, non-technical rejection message when the callable returns an `auth.activationRejected` error. Wording is deferred to Sprint 3 Step 4.

**Open question: administrative approval UI.**
Sprint 3 does not build an administrator dashboard. The `platformAdministrator` role is exercised only by direct callable invocation in tests. Confirm with engineering review that this is acceptable for Sprint 3.

**Open question: student shell scope.**
The proposal renders a stub student shell to prove the gate is role-agnostic. If the sprint would rather leave the student surface entirely for a later sprint, the router simply routes `active` students to a "coming soon" placeholder page.

**Open question: session bootstrap error handling.**
If the self-read of `users/{uid}` fails (network error, rules regression), the bootstrap must fail closed. Recommendation: route to sign-in with an error banner. Confirm in Sprint 3 specification.

**Open question: Hosting deployment target.**
Sprint 3 remains emulator-only per the standing Sprint 1 and Sprint 2 posture. Whether Sprint 3 closes with a production Hosting deploy is a separate decision. Recommendation: emulator-only for Sprint 3, first production deploy in a dedicated deployment sprint.

---

*End of Sprint 3 Step 1 specification. No implementation code produced. No architecture documents modified. No commits produced.*
