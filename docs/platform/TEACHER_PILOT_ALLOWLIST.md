# Teacher Pilot Allowlist Guardrail

**Status:** Canonical operational reference for the Sprint 29C pilot-release control.
**Scope:** Pilot-release guardrail, not general user-facing functionality. This
control exists to protect the initial limited pilot and is expected to evolve or
be removed as onboarding matures.

---

## 1. What this is

A narrow, server-side, belt-and-suspenders control at the teacher approval
boundary. Teacher activation now requires **both**:

1. an explicit `platformAdministrator` approval through
   `teachersApproveVerification` (the primary authorization mechanism,
   unchanged), and
2. membership in a pilot allowlist of permitted teacher emails.

The invariant it enforces: an authenticated Google user must not become a
teacher merely because a Platform Administrator accidentally approves them,
unless they are explicitly permitted by the pilot allowlist. Admin approval
remains required; this is a second, independent gate, not a replacement.

This control does not automatically activate anyone. An allowlisted user is
still inert until an administrator approves them.

---

## 2. Where enforcement lives

- **Callable:** `teachersApproveVerification`
  (`platform/functions/src/teachers/teachers-approve-verification.ts`). After the
  administrator role check and the target-state checks, and **before** any
  status update, custom-claims write, or audit event, the callable calls
  `assertTeacherPilotAllowlisted(target.email)`.
- **Helper:** `assertTeacherPilotAllowlisted`
  (`platform/functions/src/shared/config/teacher-pilot-allowlist.ts`). Reads the
  allowlist and throws `teachers.pilotNotAllowlisted` when the account is not a
  member, when the configuration document is absent or malformed, or when no
  verified email is available (fail-closed).

Because the check runs before any write, a refusal is atomic:
`users/{uid}.status` is unchanged and no teacher custom claims are issued.

The out-of-band `bootstrap-beta-teacher.ts` script is a deliberate
operator-only escape hatch that requires local Firebase Admin credentials. It
is not a callable, is never bundled into Cloud Functions, and is not reachable
by an authenticated Google user, so it is intentionally not gated by this
allowlist (it is how the first administrator/teacher is provisioned).

---

## 3. Identity source and matching

- The approval caller supplies only a **target UID**. The email compared
  against the allowlist is read server-side from the authoritative
  `users/{uid}` record, which is populated by `authOnUserCreate` from the
  Google/Firebase Auth record. A client can never supply the email that is
  matched, so allowlist membership cannot be spoofed from the request payload.
- Comparison is **exact-match on a normalized value**: trimmed and lowercased.
  No domain matching, no fuzzy matching, no display-name matching.

---

## 4. Where the allowlist lives

A single protected Firestore document:

```
platformConfig/teacherPilotAllowlist
```

Body shape:

```json
{ "emails": ["teacher-one@example.org", "teacher-two@example.org"] }
```

The `platformConfig` collection is denied to **every** client role at the Rules
layer (`platform/firebase/firestore.rules`), mirroring `assessmentAnswerKeys`,
`externalIdentities`, and `auditEvents`. Only Cloud Function code running under
Admin SDK authority reads it. Pilot email addresses therefore never reach a
client bundle, a callable response, a URL, or Firestore data readable by
students or teachers.

---

## 5. Human configuration procedure (later setup for Chris)

Do this once, before approving any pilot teacher. No email addresses are
committed to source; they live only in the protected Firestore document.

1. **Where membership lives.** Firestore document
   `platformConfig/teacherPilotAllowlist`, field `emails` (array of strings).

2. **Add the four pilot identities.** Using an editor with Firebase Admin
   access to the `lyfelabz-prod` project (Firebase Console, or an
   ADC-authenticated Admin script), create or edit the document so `emails`
   contains the four verified Google account emails (Chris plus the three
   colleagues), each lowercased. Use the exact email the pilot teacher signs in
   with. Example shape only:

   ```json
   { "emails": ["a@school.org", "b@school.org", "c@school.org", "d@school.org"] }
   ```

3. **Verify the configured values.** Read the document back in the Console (or
   with an Admin script) and confirm the four expected addresses are present
   and correctly spelled. There is no client-side view of this data by design.

4. **Remove or revoke one.** Delete that address from the `emails` array and
   save. Note: removing an address prevents **future** approvals of that
   account; it does not revoke an already-active teacher (that is a separate
   suspension/archival path). To fully revoke an already-active teacher, use the
   account-lifecycle suspension path in addition to removing the allowlist
   entry.

5. **Deploy requirement.** None. Changing membership is a Firestore data edit.
   No frontend redeploy and no Cloud Functions redeploy is required for
   membership changes to take effect on the next approval.

6. **Permissions required to edit.** Firebase Admin access to the production
   project (Console editor with Firestore write, or an operator holding
   Application Default Credentials / a service-account key with Firestore
   write). Ordinary teacher and student accounts, and even a
   `platformAdministrator` acting through the client, cannot read or write this
   document.

7. **Confirm a non-allowlisted teacher is rejected.** With a target user in
   `pendingVerification` whose email is **not** in `emails`, invoke
   `teachersApproveVerification` for that target as a Platform Administrator.
   It must fail with `teachers.pilotNotAllowlisted` (surfaced to the client as
   `permission-denied`), the user's `status` must remain `pendingVerification`,
   and no teacher custom claims may be present on the account. Adding the
   address to `emails` and re-approving must then succeed.

---

## 6. Failure behavior

On a non-allowlisted approval attempt:

- teacher activation is refused,
- no teacher custom claims are written,
- `users/{uid}.status` does not advance to `active`,
- no partial mutation occurs (the check precedes every write),
- the client receives a non-secret administrative error
  (`teachers.pilotNotAllowlisted` -> `permission-denied`, message: "This account
  is not authorized for the teacher pilot.").

The error and the logs never reveal allowlist membership, its size, or any
member address.

---

## 7. Removing or evolving the control

To retire the guardrail after the pilot, remove the
`assertTeacherPilotAllowlisted` call from `teachersApproveVerification`, drop
the `platformConfig` Rules block if no other platform config uses it, and delete
this document. The admin approval flow continues to function unchanged.
