# LyfeLabz Platform State Machine

**Status:** Canonical reference
**Scope:** The single authoritative definition of the account lifecycle across the entire LyfeLabz platform
**Companion documents:** LYFELABZ_FIRESTORE_DATA_MODEL.md, LYFELABZ_FIREBASE_SECURITY_MODEL.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, LYFELABZ_PLATFORM_DECISIONS.md

This document is the one canonical location for the account lifecycle. Every future sprint, Cloud Function, security rule, dashboard, and audit consumer refers to this document rather than redefining lifecycle states in place. If this document and any other document disagree on lifecycle terminology or transitions, this document is authoritative and the other is a defect.

---

## 1. Canonical Lifecycle States

The account lifecycle is a closed set of five states. It applies to every user document in `users/{uid}`.

- **`provisioned`** - The account has a Firebase Auth identity and a user document created by the authentication trigger. It carries no role, no school, and no display name yet. It cannot access authenticated surfaces beyond reading its own record.
- **`pendingVerification`** - The user has requested activation as a teacher and is awaiting review by a Platform Administrator. Role and school are recorded on the document but the account is not yet authorized.
- **`active`** - The account is fully activated. Role and school are stamped. Custom claims have been issued. All role-appropriate authorization applies.
- **`suspended`** - The account is temporarily withheld from active use through an administrative action. History is preserved. Reserved for future administrative workflows.
- **`archived`** - The account has reached end-of-life. History is preserved for attribution. Reserved for future administrative workflows.

Only these five values are permitted. Additions require a formal amendment to this document.

---

## 2. State Transition Diagram

```
                        (Firebase Auth user created)
                                    |
                                    v
                              +-------------+
                              | provisioned |
                              +-------------+
                                 |       |
                (student path)   |       |   (teacher path)
                                 v       v
                          +--------+   +---------------------+
                          | active |   | pendingVerification |
                          +--------+   +---------------------+
                                            |            |
                                (approved)  |            |  (denied)
                                            v            v
                                       +--------+   +-------------+
                                       | active |   | provisioned |
                                       +--------+   +-------------+

                          +--------+ <----(future)----> +-----------+
                          | active |                    | suspended |
                          +--------+ ----(future)-----> +-----------+
                                                              |
                                                              v (future)
                                                        +----------+
                                                        | archived |
                                                        +----------+
```

Personal-account rejection and any other activation-failure outcome do not appear in the diagram. They do not change state. They are recorded in the audit stream (Section 4).

---

## 3. Transition Table

Every transition is written by exactly one Cloud Function and produces exactly one audit event. Client code never mutates `status`.

| Current state | Allowed next state | Responsible Cloud Function | Audit event |
|---|---|---|---|
| (none) | `provisioned` | `authOnUserCreate` | `auth.userProvisioned` |
| `provisioned` | `active` | `studentsCompleteOnboarding` | `students.activated` |
| `provisioned` | `pendingVerification` | `teachersRequestVerification` | `teachers.verificationRequested` |
| `pendingVerification` | `active` | `teachersApproveVerification` | `teachers.verificationApproved` |
| `pendingVerification` | `provisioned` | `teachersDenyVerification` | `teachers.verificationDenied` |
| `active` | `suspended` | (reserved, future sprint) | `users.suspended` |
| `suspended` | `active` | (reserved, future sprint) | `users.reinstated` |
| `active` | `archived` | (reserved, future sprint) | `users.archived` |
| `suspended` | `archived` | (reserved, future sprint) | `users.archived` |

Every attempt-outcome that does not change state is recorded as an audit event without a state transition. In Sprint 2:

- `auth.activationRejected` - written when personal-account policy or any other activation precondition rejects an onboarding attempt. The user remains in `provisioned`.

Reserved transitions are named here so that future sprints implement them into the same enumeration rather than inventing parallel lifecycles.

---

## 4. Notes

**Lifecycle represents where an account is in the platform.**
The `status` field on `users/{uid}` answers one question: where is this account in its progression through the platform? It never answers "what happened during the last onboarding attempt," "was this request approved or denied," or "what policy verdict applied." Those questions belong to the audit stream.

**Audit events represent what happened to the account.**
The `auditEvents` collection is the authoritative record of every meaningful occurrence, whether or not it changed lifecycle state. Approvals, denials, rejections, and reinstatements are all events. Some of them also change state; the audit event is the source of truth for the occurrence regardless.

**Authorization comes from custom claims.**
Firestore Security Rules and Cloud Function callers determine what an actor may do by consulting the custom claims on the authenticated identity token. Claims are issued only when `status` is `active` and carry only `role` and `schoolId` (see Cloud Function Charter §2). The absence of claims is the canonical signal that no active authorization applies.

**Current account state comes from Firestore.**
The current `status` value on `users/{uid}` is the authoritative account state. It is never inferred from token contents, never inferred from URL structure, and never inferred from client-side UI. Client code that needs to know the lifecycle state reads the user document; server code that needs to know reads the user document under privileged credentials.

**There must never be multiple competing lifecycle fields.**
`status` on `users/{uid}` is the one canonical lifecycle field. No other field, on this document or any other, expresses account lifecycle. Attempts to introduce a second lifecycle concept (an `activationState`, an `onboardingState`, a `verified` boolean, a `restricted` flag, or any variant) are prohibited without a formal amendment to this document. Duplicate lifecycle concepts violate PDR-017 and are the fastest known route to authorization drift.

---

## 5. Governance

This document is canonical. It changes only through a formal architectural review that produces:

- A stated reason for the change.
- An updated enumeration, diagram, and table.
- A migration note for any existing user documents affected.
- Concurrent updates to `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.1 and `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` §2 where those documents refer to lifecycle behavior.

Every Cloud Function, security rule, dashboard, and audit consumer that touches account state must conform to this document. When a proposed implementation cannot conform, this document is revised first and the implementation follows.
