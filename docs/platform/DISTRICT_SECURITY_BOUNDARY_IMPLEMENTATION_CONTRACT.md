# District Security Boundary Implementation Contract

**Status:** Canonical implementation contract. Ratified under Sprint 10A step F-1.
**Date:** 2026-07-12
**Anchor decision:** PDR-025 in `LYFELABZ_PLATFORM_DECISIONS.md`.
**Reconciles:** PDR-023c, PDR-023d, PDR-015 Sprint 9C notice, PDR-003 Sprint 9C notice.
**Governs:** Server-side enforcement of the LyfeLabz district tenancy boundary across Firestore, Cloud Functions, custom claims, session behavior, and audit events.

This document is an engineer-facing implementation contract. It does not redesign product behavior, add user-facing surfaces, or amend identity philosophy. It translates the certified architecture into a single set of normative rules that a future implementation sprint MUST follow to enforce district isolation.

---

## Sprint 10A F-2 Reconciliation Notice

Where this contract names `submissions/{submissionId}`, `submissionsCreate`, or `submissionsFinalize` (§10, §12, §13, §17), read forward under `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §21 and §26. PDR-026 supersedes the older collection and callable names with `attempts/{attemptId}` and the single `assessmentAttemptsFinalize` callable. The district enforcement invariants stated in this contract are unchanged; every named responsibility applies identically to the successor collection and callable. No document shape or invariant is amended by this notice.

---

## 1. Purpose

The LyfeLabz certified architecture ratified the District entity as a first-class security boundary (PDR-023c). The architecture corpus, however, describes district enforcement across many documents at different levels of abstraction. This contract collapses those statements into one authoritative reference so engineers do not have to reconstruct the district enforcement model from many partial statements.

This document is the single source of truth for:

- who owns each piece of district-relevant state
- how the `districtId` custom claim is written, refreshed, and cleared
- how Firestore Security Rules enforce district isolation
- how each callable Cloud Function derives, compares, and rejects district-relevant values
- how account state, role, and district state must agree
- what auditable transitions are required
- what remains explicitly deferred to a later implementation sprint

## 2. Scope

This contract governs:

- Enforcement of district isolation in Firestore, Cloud Functions, and session behavior.
- The claim contract for `districtId`.
- Server-side responsibilities of every callable whose behavior touches district ownership.
- The Firestore Security Rules invariants that follow.
- The audit vocabulary required to make district-relevant transitions accountable.

It does not govern:

- The product experience of teacher onboarding, student onboarding, join-code redemption, or verification, all of which remain owned by `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`.
- The concrete schemas of `classes`, `enrollments`, `assignments`, or `submissions`, which remain owned by `LYFELABZ_FIRESTORE_DATA_MODEL.md`.
- The teacher workspace or student experience, both of which remain owned by their respective specifications.
- The pilot readiness bars, which remain owned by `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` and `PLATFORM_OPERATIONS_SPECIFICATION.md`.

## 3. Authority and Precedence

This contract implements the following canonical documents:

- `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` (identity and district architecture).
- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-023, PDR-023c, PDR-023d, PDR-015 Sprint 9C notice, PDR-025).
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md` (rule-layer district enforcement).
- `LYFELABZ_FIRESTORE_DATA_MODEL.md` (canonical shapes).
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` (callable authority boundaries).
- `LYFELABZ_ENGINEERING_STANDARDS.md` (engineering obligations).
- `PLATFORM_STATE_MACHINE.md` (user status lifecycle).
- `PLATFORM_CONTRACTS.md` (client storage prohibitions).

Precedence rules:

1. Where this contract and an older document conflict on district enforcement, this contract prevails and the older document MUST be reconciled with a narrow Sprint 10A reconciliation notice.
2. Where this contract and the certified identity philosophy in `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` conflict on identity behavior, the identity specification prevails and this contract MUST be reconciled.
3. Where existing implementation code conflicts with this contract, the code MUST be reconciled during the sprint that implements the district claim write path. This contract never treats older implementation code as authoritative.

## 4. Terminology

- **District.** A tenancy boundary that owns one or more Schools. A District is the outermost trust boundary below the Platform.
- **`districtId`.** The stable identifier of a District. When present as a custom claim it is server-authoritative.
- **School.** A Google Workspace institution that owns Teacher Identities, Classes, and enrolled Students. Every School resolves to exactly one District.
- **`schoolId`.** The stable identifier of a School. Present on `schools/{schoolId}`, denormalized where security-rule performance requires it, and projected into the caller's claims when the caller has an active school membership.
- **Tenant boundary.** The District. Cross-tenant reads and writes are refused.
- **Canonical user record.** The Firestore document at `users/{uid}`. It is the durable source of truth for role, account state, school membership, and district membership.
- **Account state.** The value of `users/{uid}.status` from the closed set defined in `PLATFORM_STATE_MACHINE.md` §1.
- **Custom claim.** A signed key on the caller's Firebase Auth token. Only `role`, `schoolId`, and `districtId` are recognized. All three are server-issued.
- **Authorization projection.** Any value written to a claim solely to make the caller's authorization decidable at the Security-Rules layer. A projection is derived from the canonical Firestore record; it is not a business record.
- **Activation.** The transition of a user to `status === "active"` under the appropriate identity family. Activation is the trigger that makes claims writable.
- **Verification.** The teacher-family gate that precedes activation. See `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §13.
- **District-scoped resource.** Any Firestore document whose authorized access depends on the caller belonging to the same District as the document. In this contract that set is `schools`, `users`, `classes`, `enrollments`, `assignments`, `submissions`, `auditEvents`, and any future collection that adopts the district-scoped ownership chain.
- **Cross-district reference.** A stored value in one district-scoped resource that resolves to a district different from the resource's own district. Cross-district references MUST be refused at write time and at rule time.
- **Server-authoritative transition.** A change to district-relevant state (assignment, activation, transfer, suspension, archival) that is performed exclusively by a Cloud Function running under an admin credential. Clients never submit the outcome of a server-authoritative transition.
- **Stale claim.** A signed token that reflects an earlier version of the caller's canonical Firestore state. Stale claims MUST fail closed.

## 5. Canonical Source-of-Truth Model

| Concern | Durable authority | Authorization projection | Written by |
| --- | --- | --- | --- |
| District membership of a user | `users/{uid}.districtId` | `districtId` claim | Cloud Function only |
| Role of a user | `users/{uid}.role` | `role` claim | Cloud Function only |
| Account lifecycle | `users/{uid}.status` | Not projected; enforced by every callable and rule via a Firestore re-read where required | Cloud Function only |
| Active school membership | `users/{uid}.schoolId` (single-school users), `users/{uid}.schoolIds` (multi-school teachers) | `schoolId` claim reflects the currently active school | Cloud Function only |
| Verification status | `users/{uid}` verification fields or the paired verification-request document | Not projected | Cloud Function only |
| School to district mapping | `schools/{schoolId}.districtId` | Not projected | Cloud Function only |
| District ownership of a class | Derived from `classes/{classId}.schoolId` and `schools/{schoolId}.districtId`; MAY be denormalized onto the class where the rule layer needs it | Not projected | Cloud Function only |
| Audit history | `auditEvents/{eventId}` (append-only) | Not projected | Cloud Function only |

The Firestore record MUST be treated as the durable authority in every case where the claim and the record could disagree. Any callable that consumes only the claim without re-reading Firestore where correctness requires it MUST be treated as a bug.

## 6. Canonical District Claim Contract

The recognized claim shape is exactly:

```
{
  role: "teacher" | "student" | "platformAdministrator",
  schoolId: string,
  districtId: string
}
```

Rules:

- **Names.** `role`, `schoolId`, and `districtId` are the only recognized claim keys. No other district-relevant key MAY be added without a new PDR.
- **Types.** All three values MUST be non-empty strings. Empty strings are forbidden.
- **Issuer.** Claims are written exclusively by a Cloud Function running under admin credentials.
- **Precondition.** Claims MUST NOT be written until `users/{uid}.status === "active"`. Claims MUST be cleared or omitted for any user whose status transitions out of `active`.
- **Platform administrator.** A platform administrator MUST carry `role === "platformAdministrator"`. Because administrator authority is not scoped to a single district, the administrator claim shape MAY OMIT `districtId` and `schoolId` if and only if the callable and rule layers accept the absence of these keys as the explicit administrator sentinel. Alternative sentinels (such as an empty string) are forbidden. The administrator sentinel MUST NOT be used by any other role.
- **Replacement.** Any authorized change to a user's role, district, or active school membership MUST be performed by writing the canonical Firestore record first, then issuing a claim replacement in the same server-side workflow.
- **Clearing.** Suspension, archival, or district withdrawal MUST clear the claim on the same server-authoritative transition that changes the canonical record.
- **Refresh.** After any claim write, the callable that performed it MUST return a signal that instructs the client to force a token refresh. Until the refreshed token is presented, any protected action that depends on the new claim MUST fail closed at the rule layer.
- **Forbidden client behavior.** Clients MUST NOT submit `districtId`, `schoolId`, or `role` as an authoritative input in any callable payload. Where a callable accepts a district-relevant identifier for lookup (such as a verification-code binding), the callable MUST resolve the value on the server and compare rather than trust.

## 7. User Activation State Machine

The user status enumeration in `PLATFORM_STATE_MACHINE.md` §1 is closed: `provisioned`, `pendingVerification`, `active`, `suspended`, `archived`. The district projection for each state is:

| `users/{uid}.status` | `districtId` on record | `districtId` claim | District-scoped reads | District-scoped writes | Server transition that enters this state |
| --- | --- | --- | --- | --- | --- |
| `provisioned` | Absent or unbound | Absent | Refused | Refused | `authOnUserCreate` |
| `pendingVerification` (teacher only) | Present, bound to the requested school and district; not yet activating access | Absent | Refused | Refused | `teachersRequestVerification` or `teachersRedeemVerificationCode` |
| `active` | Present, canonical | Present, matching the record | Permitted where the caller's `districtId` matches the resource's district and every other rule predicate is satisfied | Permitted only through the callable authorized for the operation | `teachersApproveVerification`, `enrollmentsActivateOnFirstSignIn`, `studentsCompleteOnboarding` |
| `suspended` | Preserved | Cleared | Refused | Refused | Reserved future callable |
| `archived` | Preserved | Cleared | Refused | Refused | Reserved future callable |

Additional roster-level state (not on `users/{uid}`):

- **`awaitingFirstSignIn`.** A class-scoped roster placeholder state defined by `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §16 and reconciled onto the class in `LYFELABZ_FIRESTORE_DATA_MODEL.md` §Sprint 9C notice. A placeholder in `awaitingFirstSignIn` does not confer any district access; the student cannot read or write any district-scoped resource until `enrollmentsActivateOnFirstSignIn` promotes the placeholder to `active` and issues claims on the newly provisioned `users/{uid}` record.

No new user-level state is introduced by this contract.

## 8. Teacher Verification and District Activation

The authority chain for teacher activation is fixed:

1. A teacher applicant authenticates through Google Workspace.
2. `authOnUserCreate` creates the `users/{uid}` record in `provisioned`.
3. The applicant follows the verification-code path (preferred, `teachersRedeemVerificationCode`) or the Request Teacher Access fallback (`teachersRequestVerification`). Both paths transition the record to `pendingVerification` and record the requested school and district on the record.
4. A platform administrator reviews the request. Approval invokes `teachersApproveVerification`; denial invokes `teachersDenyVerification`.
5. `teachersApproveVerification` MUST, atomically:
   a. Verify the target `users/{uid}.status === "pendingVerification"`.
   b. Confirm that the target school exists and that `schools/{schoolId}.districtId` equals the district the request was bound to.
   c. Update `users/{uid}` to `status === "active"`, set `role === "teacher"`, and set `schoolId` and `districtId` to the canonical values.
   d. Issue the `role`, `schoolId`, and `districtId` claims.
   e. Write a `teachers.verificationApproved` audit event.
   f. Return the claim-refresh signal to the caller.
6. `teachersDenyVerification` MUST NOT issue claims. It MUST leave `districtId` on the record unset or unchanged and MUST write a `teachers.verificationDenied` audit event.

The teacher becomes district-active only when steps 5c and 5d have both committed. A client that observes `status === "active"` in Firestore but does not yet carry a refreshed token MUST be treated as not yet authorized for district-scoped operations.

## 9. Student Activation and District Assignment

The authority chain for student activation is:

1. A teacher establishes a class under `classesCreate`. The class's `schoolId` is server-derived from the caller's claim. Its district ownership resolves through `schools/{schoolId}.districtId`.
2. The class receives a roster, either through Google Classroom sync (LMS-linked classes) or through a server-generated join code (manual classes).
3. For manual classes, a student MAY invoke `enrollmentsRedeemJoinCode`. The callable MUST look up the class by code, resolve the class's district through the school, and MUST refuse redemption if any of the following are true:
   - The class is archived.
   - The class is LMS-linked.
   - The student is already actively enrolled in the class.
   - The resolved district would violate the district-boundary rules of `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §18.
4. On first Google sign-in, `enrollmentsActivateOnFirstSignIn` MUST atomically:
   a. Match the caller to a roster placeholder under the identity-matching rules of `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §17 (Google Classroom User ID primary; email secondary).
   b. Verify the resolved class's district against the school's `districtId`.
   c. Provision or reuse the `users/{uid}` record with `role === "student"`, the canonical `schoolId`, and the canonical `districtId`.
   d. Transition `status` to `active`.
   e. Transition the roster placeholder to `active`.
   f. Issue the `role`, `schoolId`, and `districtId` claims.
   g. Write the audit events reserved for first-sign-in activation.
   h. Return the claim-refresh signal.

A student's client MUST NOT be permitted to submit `districtId`, `schoolId`, or a class reference that would bypass this resolution. The callable derives every district-relevant value from the resolved server state.

## 10. Resource Ownership Chain

For each district-scoped resource:

| Resource | District ownership | May be denormalized | Written by | Rule-layer comparison |
| --- | --- | --- | --- | --- |
| `users/{uid}` | `districtId` field on the record | Not derived from any parent | `authOnUserCreate`, verification, activation, transfer, suspension, archival callables | Direct field comparison against the caller's claim where applicable |
| `schools/{schoolId}` | `districtId` field on the record (required, Sprint 9C notice) | Not derived; canonical here | Platform administrator provisioning (reserved future callable) | Direct field comparison against the caller's claim |
| `classes/{classId}` | Derived through `classes/{classId}.schoolId` and `schools/{schoolId}.districtId`. MUST be denormalized onto the class as `districtId` if the rule layer requires a single-document read to authorize access | Yes, at class creation time only | `classesCreate`, `classesUpdateMetadata`, `classesArchive` | Prefer the denormalized `districtId` if present; otherwise the rule MUST read the school |
| `enrollments/{classId}__{studentId}` | Derived from the parent class. MUST be denormalized onto the enrollment if the rule layer requires a single-document read | Yes, at enrollment creation time only | `enrollmentsJoinByCode`, `enrollmentsRedeemJoinCode`, `enrollmentsTeacherAdd`, `enrollmentsActivateOnFirstSignIn`, `enrollmentsSetStatus` | Prefer the denormalized `districtId` |
| `assignments/{assignmentId}` | Derived from the parent class. MUST be denormalized onto the assignment if the rule layer requires a single-document read | Yes, at draft creation time only | `assignmentsCreateDraft`, `assignmentsUpdateDraft`, `assignmentsPublish`, `assignmentsClose`, `assignmentsArchive` | Prefer the denormalized `districtId` |
| `submissions/{assignmentId}__{studentId}` | Derived from the parent assignment. MUST be denormalized onto the submission | Yes, at creation time only | `submissionsCreate`, `submissionsFinalize` | Direct field comparison |
| `auditEvents/{eventId}` | Every district-relevant event MUST carry a `districtId` field. Absence is permitted only for pre-district system events such as `auth.userProvisioned` | Yes, server-set | Every callable that emits an event | Never client-readable; server-only writes |

Denormalized `districtId` values on child resources are authorization projections and are set exclusively at the write that creates the resource. They MUST NOT be re-written on subsequent updates. Any callable that would change a resource's parent chain in a way that changes the resolved district MUST refuse the update and require an explicit transfer transition.

## 11. Firestore Security Rules Contract

Firestore Security Rules MUST enforce the following invariants. Rule code is not written by this contract; the invariants are.

Rules MUST trust:

- The authenticated `request.auth.uid`.
- The signed claims `request.auth.token.role`, `request.auth.token.schoolId`, `request.auth.token.districtId`.
- The values already stored in the resource being read or written (`resource.data.*`).
- The values on a distinct Firestore document only where a `get()` is explicitly authorized and cheap enough for the rule layer.

Rules MUST compare, at a minimum:

- Caller `districtId` claim to the resource's `districtId` field (or, absent denormalization, the resolved district through a `get()` on the parent school).
- Caller `schoolId` claim to the resource's `schoolId` where school scoping narrows district scoping.
- Caller `role` claim to the role required by the operation.
- Caller `status === "active"` where required. Because `status` is not projected into claims, the rule MUST either (a) trust that claims are only present when `status === "active"`, per §6, and treat the absence of the claim as denial, or (b) read `users/{request.auth.uid}` where a specific rule requires it.

Rules MUST NOT trust:

- Any `districtId`, `schoolId`, `role`, `teacherId`, `studentId`, `ownerUid`, `classId`, or `assignmentId` value supplied in `request.resource.data` unless that same value is separately compared to the caller's claim or to a resolved server-side value.
- The presence of a `districtId` on the request payload as evidence of district membership.

Rules MUST require server-only writes for:

- Any write to `users/{uid}.role`, `users/{uid}.status`, `users/{uid}.schoolId`, `users/{uid}.districtId`, `users/{uid}.schoolIds`, or any verification field.
- Any write to `schools/{schoolId}.districtId`.
- Any write to `auditEvents/*`.
- Any write to a claim (claims are Auth-layer state, not Firestore state, but this contract records the parity).

Rules MUST default to deny. Any collection or field not covered by an explicit rule is inaccessible.

Platform administrator access is explicit: rules MAY permit administrator reads or writes only where the callable path is not available and only under the explicit `role === "platformAdministrator"` predicate. Administrator access is never a wildcard; it MUST be limited to the specific operations enumerated in `PLATFORM_OPERATIONS_SPECIFICATION.md` and this contract.

## 12. Cloud Function Enforcement Contract

Every callable that touches district-relevant state MUST:

- Verify `request.auth.uid` is present.
- Read `users/{request.auth.uid}` where the callable's correctness depends on `status`, `role`, or district membership. Claims alone are insufficient at the callable layer because the callable is the authority that keeps claims consistent with the record.
- Derive `districtId` and `schoolId` from the canonical record, not from the payload.
- Reject any payload field that would set an ownership value.
- Verify parent ownership. For example, `assignmentsCreateDraft` MUST verify the class exists, the caller is the class's teacher, and the class's resolved district equals the caller's district.
- Emit at least one audit event under §16.
- Return a claim-refresh signal whenever it writes a claim.

Callable-by-callable district responsibilities (names as canonical in `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` Appendix A; implementations MAY finalize argument shapes and error codes in the sprint that introduces the function):

| Callable | Derive `districtId` | Compare `districtId` | Reject client-supplied ownership | Verify `status === "active"` | Verify role | Verify parent | Write audit event | Write claims |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `authOnUserCreate` (trigger) | No | No | n/a | n/a | n/a | n/a | Yes (`auth.userProvisioned`) | No |
| `teachersRequestVerification` | From requested school | Yes | Yes | Verifies caller is `provisioned` | Verifies caller has no active role | n/a | Yes (`teachers.verificationRequested`) | No |
| `teachersRedeemVerificationCode` | From code binding | Yes | Yes | Verifies caller is `provisioned` | Verifies caller has no active role | Verifies code binding is valid and untouched | Yes | No |
| `teachersApproveVerification` | From request record | Yes | Yes | Verifies target is `pendingVerification` | Verifies caller is `platformAdministrator` | Verifies request record | Yes (`teachers.verificationApproved`) | Yes |
| `teachersDenyVerification` | n/a | n/a | Yes | Verifies target is `pendingVerification` | Verifies caller is `platformAdministrator` | Verifies request record | Yes (`teachers.verificationDenied`) | No |
| `studentsCompleteOnboarding` | From resolved class or roster | Yes | Yes | Verifies caller is `provisioned` | Verifies caller has no active role | Verifies enrollment intent | Yes | Yes |
| `enrollmentsRedeemJoinCode` | From class through school | Yes | Yes | Verifies caller is `active` student, or provisions atomically with activation | Yes | Yes | Yes | If activation is atomic, yes |
| `enrollmentsActivateOnFirstSignIn` | From roster placeholder's class through school | Yes | Yes | Provisions atomically with activation | Sets `student` | Yes | Yes | Yes |
| `classesCreate` | From caller's `districtId` claim; MAY denormalize to class | Yes | Yes | Yes | `teacher` | n/a | Yes (`classes.created`) | No |
| `classesUpdateMetadata` | From existing class | Yes | Yes | Yes | `teacher` and ownership | Yes | Yes | No |
| `classesArchive` | From existing class | Yes | Yes | Yes | `teacher` and ownership | Yes | Yes | No |
| `enrollmentsJoinByCode` | From class | Yes | Yes | Yes | `student` | Yes | Yes | No |
| `enrollmentsTeacherAdd` | From class | Yes | Yes | Yes | `teacher` | Yes | Yes | No |
| `enrollmentsSetStatus` | From enrollment | Yes | Yes | Yes | `teacher` or `platformAdministrator` | Yes | Yes | No |
| `assignmentsCreateDraft` / `assignmentsUpdateDraft` / `assignmentsPublish` / `assignmentsClose` / `assignmentsArchive` | From class | Yes | Yes | Yes | `teacher` and ownership | Yes | Yes | No |
| `submissionsCreate` / `submissionsFinalize` | From assignment | Yes | Yes | Yes | `student` and ownership | Yes | Yes | No |

No new callable is required by this contract to enforce the model above.

## 13. Cross-District Reference Prevention

The following invariants MUST hold. Each is enforced at the callable layer and, where the rule layer can also enforce it, at the rule layer.

- A `classes/{classId}` document MUST NOT reference a `schoolId` whose `districtId` differs from the creating teacher's `districtId` claim.
- An `enrollments/{enrollmentId}` document MUST NOT link a `studentId` to a `classId` whose resolved district differs from the student's `users/{studentId}.districtId`.
- An `assignments/{assignmentId}` document MUST NOT reference a `classId` whose district differs from the assignment's own `districtId`.
- A `submissions/{submissionId}` document MUST NOT reference an `assignmentId` whose district differs from the submitting student's district.
- A teacher MUST NOT read a roster document, class document, enrollment document, assignment document, submission document, or audit event outside the teacher's `districtId`.
- A student MUST NOT read a lesson-attempt, submission, or personal record that resolves to a district other than the student's own.
- A client MUST NOT be able to fabricate any of the ownership fields above; every callable enforces server-derived values on write.

Historical learning records generated in a prior district remain owned by their original district. A student who is later provisioned in a new district MUST NOT be granted read access to those records through the new-district identity. Read access to prior-district learning history is available through the original district's canonical Student ID and MUST NOT be projected across districts.

## 14. District Transfer Contract

A canonical district transfer workflow is not implemented by this contract. Sprint 10A F-1 records only the safe default.

Safe default rule:

- Clients MUST NOT mutate `districtId` on any record.
- No callable currently listed in `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` Appendix A performs a district transfer.
- Where an operational need to change a user's district arises before a transfer callable is implemented, the change MUST be executed as a new-identity provisioning under `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §18 and §19: the original identity is preserved and remains owned by the original district; a new identity is provisioned in the new district; historical learning records remain accessible through the original identity in the original district.
- Any teacher identity that changes districts MUST be a new LyfeLabz teacher identity per PDR-023d. Cross-district identity linking never occurs automatically.

When a district transfer callable is later authorized, its implementation sprint MUST address, at a minimum:

1. Which authority initiates the transition. The default is a platform administrator.
2. The order of durable writes. `users/{uid}` MUST be updated before claims are replaced.
3. Claim replacement or clearing. The old district's claim MUST be cleared in the same server-authoritative transition that writes the new district's claim, or the user's `status` MUST be moved out of `active` between the two writes so no window exists in which stale claims permit access to the old district.
4. Stale-session handling. The old token MUST be treated as unauthorized until the client refreshes its token. Any protected operation attempted with the old token MUST fail closed at the rule layer per §15.
5. Old-district access revocation. All enrollments, assignments, and submissions that resolve to the old district MUST become inaccessible through the transferred identity at the moment of transfer.
6. Historical learning ownership. Prior-district student learning records remain owned by the student and remain accessible only through the original district's Student ID.
7. Cross-district data leakage. No denormalized district-owned data may be copied from the old district into the new district.
8. Audit events required (§16).

Until that sprint is authorized, the safe default rule above is the entire district-transfer contract.

## 15. Stale Claims and Session Reconciliation

Every callable MUST behave deterministically when the token and the canonical record disagree. The following table is exhaustive for the cases the platform anticipates.

| Observed state | Required behavior |
| --- | --- |
| `users/{uid}.status !== "active"` and any claim is present on the token | Deny the operation. The claim is stale. The server MUST clear claims on the next authorized transition. |
| `users/{uid}.districtId` present and no `districtId` claim on the token | Deny district-scoped operations. Instruct the client to refresh its token. Do not silently trust the record. |
| `users/{uid}.districtId` and `token.districtId` disagree | Deny the operation. Log a `security.staleClaim` diagnostic under the existing audit vocabulary. The server MUST reconcile at the next authorized transition, not silently. |
| `users/{uid}.role` and `token.role` disagree | Deny the operation. Same reconciliation rule. |
| `users/{uid}.schoolId` and `token.schoolId` disagree | Deny district-scoped writes and school-scoped reads. District-scoped reads MAY still succeed if the caller's `districtId` claim is consistent with the record. |
| Token cannot be refreshed | The client MUST sign the user out. The platform MUST NOT silently degrade to a lower privilege level. |
| Claim missing on a user whose record is `active` | The next authorized callable invocation by that user MUST reissue claims before proceeding, if that callable is a claim-issuing callable; otherwise the operation is denied and the client is instructed to refresh. |

The secure failure result for any mismatch is denial, not fallback. Fallback to the record is forbidden at the rule layer because rules cannot always read the record cheaply. Callables MAY read the record and reissue claims where the reissue is part of their canonical responsibility.

## 16. Audit Event Contract

All district-relevant transitions MUST emit an `auditEvents/{eventId}` document under the canonical shape defined in `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.8 (required fields: `actorUserId`, `actorRole`, `action`, `targetType`, `targetId`, `occurredAt`; conditionally required `schoolId`; where the event resolves to a district, `districtId` MUST also be recorded).

Required event vocabulary for district-relevant transitions:

| Transition | Canonical `action` | Actor | Target | Notes |
| --- | --- | --- | --- | --- |
| Provisioning of a new user record | `auth.userProvisioned` | `system` | `users/{uid}` | Pre-district; `districtId` MAY be absent |
| Rejected activation attempt | `auth.activationRejected` | `system` | `users/{uid}` | Pre-district permitted |
| Teacher verification requested | `teachers.verificationRequested` | `teacher` applicant | Verification request | Records requested `districtId` |
| Teacher verification approved | `teachers.verificationApproved` | `platformAdministrator` | `users/{uid}` | Records new `districtId`, `schoolId`, `role` |
| Teacher verification denied | `teachers.verificationDenied` | `platformAdministrator` | Verification request | Records requested `districtId` |
| Student activated on first sign-in | `students.activated` | `system` | `users/{uid}` | Records `districtId`, `schoolId`, class link |
| District claim issued | Recorded as the payload of the transition that issued it (e.g. `teachers.verificationApproved`, `students.activated`); no separate action name is created | n/a | n/a | Do not fabricate a second audit sink |
| District claim replaced | Recorded on the transition that replaced it (transfer, school change) | n/a | n/a | Same principle |
| District claim cleared | Recorded on `users.suspended`, `users.archived`, or the future transfer transition | n/a | n/a | Same principle |
| User suspended | `users.suspended` | `platformAdministrator` | `users/{uid}` | Records prior `districtId` |
| User reinstated | `users.reinstated` | `platformAdministrator` | `users/{uid}` | Records reissued `districtId` |
| User archived | `users.archived` | `platformAdministrator` | `users/{uid}` | Records prior `districtId` |
| Cross-district operation refused | Recorded as a denial payload on the callable's canonical audit event with `outcome: "refused"` and a reason code from §17 | Caller | Attempted target | Do not create a new event name for the refusal alone |
| Administrator override where authorized | Recorded on the underlying transition's canonical event with `actorRole: "platformAdministrator"` and an `override: true` payload flag | Administrator | Target | Do not create a new event name |

The `auditEvents` collection is append-only. No callable and no rule permits update or delete, including for `platformAdministrator`.

## 17. Error Contract

Callables MUST return stable error identifiers for district-boundary failures. The following identifiers are canonical for this contract. Where an identifier already exists in the certified architecture (for example, error names used by Sprint 2 callables), that name is preserved; otherwise the name below is the canonical name.

- `unauthenticated`
- `account-inactive`
- `role-forbidden`
- `district-unassigned`
- `district-mismatch`
- `school-district-mismatch`
- `cross-district-reference`
- `claim-stale`
- `claim-state-mismatch`
- `server-only-field`
- `transfer-not-supported`

Callables MUST NOT leak the value of another district's identifier in any error payload. `district-mismatch` MUST report only that a mismatch occurred and MUST NOT echo the requested district back to the caller.

## 18. Required Firestore Rules Tests

The implementation sprint that lands the district claim write path MUST include a rules-test matrix. Required cases include, at a minimum:

- Same-district permitted access for every role and every district-scoped resource.
- Cross-district access denied for every role and every district-scoped resource, in both read and write directions.
- Inactive account denied for every district-scoped resource, even when claims are present.
- Stale-claim denial: request presents a claim that disagrees with the record.
- Forged request denial: request payload includes a `districtId` different from the caller's claim.
- Forged parent denial: request payload references a `schoolId` or `classId` outside the caller's district.
- School and district mismatch denial: `schools/{schoolId}.districtId` differs from the caller's claim.
- Class and district mismatch denial: `classes/{classId}` denormalized `districtId` differs from the caller's claim.
- Enrollment mismatch denial: enrollment resolves to a district other than the student's.
- Assignment mismatch denial: assignment resolves to a district other than the class's.
- Submission mismatch denial: submission resolves to a district other than the assignment's.
- Platform administrator permitted for authorized operations; denied for wildcard reads.
- Server-only write protection on `role`, `status`, `schoolId`, `districtId`, and every verification field.
- Audit-event write restrictions: no client write, no update, no delete for any role.

The tests themselves are not written in Sprint 10A.

## 19. Required Cloud Function Tests

The implementation sprint MUST also include emulator tests covering, at a minimum:

- `authOnUserCreate` provisioning idempotency; no district claim issued.
- `teachersRequestVerification` records requested `districtId`; does not issue claims.
- `teachersRedeemVerificationCode` refuses cross-district code binding; refuses replayed codes.
- `teachersApproveVerification` transitions `pendingVerification` to `active`, writes claims, emits audit event, is idempotent under replay.
- `teachersDenyVerification` writes audit event; issues no claims.
- `enrollmentsRedeemJoinCode` refuses archived classes, LMS-linked classes, cross-district codes.
- `enrollmentsActivateOnFirstSignIn` provisions atomically, refuses cross-district placeholder match, is idempotent under replay by the same principal.
- `classesCreate` derives `schoolId` and `districtId` from the caller; refuses payload-supplied ownership; idempotent on replay.
- `assignmentsCreateDraft` and every other class-scoped callable refuses cross-district class references.
- `submissionsCreate` refuses cross-district assignment references.
- Every callable that writes a claim returns the claim-refresh signal.
- Every callable emits at least one canonical audit event.

The tests themselves are not written in Sprint 10A.

## 20. Implementation Checklist

The implementation sprint that lands the district claim write path MUST address:

1. Shared TypeScript types for the canonical claim shape and the closed set of error identifiers in §17.
2. A single claims helper that writes `role`, `schoolId`, and `districtId` atomically and refuses any partial write.
3. Callable validation shared across every district-touching callable: authentication, active status, role, and claim-record parity.
4. Transaction boundaries that keep the `users/{uid}` write, any denormalized district writes on child resources, and the audit event write in a single atomic operation.
5. Audit event emission under §16.
6. Firestore Security Rules updated to enforce §11.
7. Composite indexes for any district-scoped query (`classes` by `districtId`+`teacherId`, `assignments` by `districtId`+`classId`+`status`, `submissions` by `districtId`+`assignmentId`, `auditEvents` by `districtId`+`occurredAt`).
8. Emulator tests per §18 and §19.
9. App-side session reconciliation: client MUST refresh its token when the callable returns the refresh signal, and MUST sign the user out if the token cannot be refreshed.
10. Migration validation: the sprint MUST verify that any pre-existing `users/{uid}` records in the deployment have consistent `districtId` and canonical claim state before enabling district-scoped rules in production.
11. Deployment validation: staging environment MUST run the full rules-test matrix in §18 before rules are promoted to production.

## 21. Explicit Non-Goals

This contract does not introduce:

- A district management surface, a district self-service surface, or a teacher-selected district assignment.
- Automatic district trust based only on email domain.
- A new role, including School Administrator, District Administrator, or Parent.
- A new audit sink.
- LMS-driven district behavior beyond what `LMS_INTEGRATION_ARCHITECTURE.md` already ratifies.
- A new classroom, assignment, or assessment behavior.
- A broad platform-administrator bypass.
- An unrestricted district transfer capability.
- A new user-facing state.

Any of the above requires a new PDR that supersedes the relevant section of this contract.

## 22. Open Gaps

The following are the only implementation gaps that cannot be resolved from the certified architecture. Each is narrow and non-blocking under the safe default in §14.

- **G-10A-1. District document collection.** The certified architecture references `districtId` as an ownership key but does not define a `districts/{districtId}` collection or its shape. Impact: engineers implementing the claim write path MUST decide, in the same sprint, whether the `districtId` is looked up from a `districts` collection or resolved solely through `schools/{schoolId}.districtId`. This contract does not require the collection to exist for district enforcement to work; the school record already carries the value. Recommendation: introduce the collection only when a domain requires it.
- **G-10A-2. District transfer callable.** No callable is named for a district transfer. The safe default in §14 is denial of client-driven mutation and new-identity provisioning per PDR-023d and `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §18. A future PDR is required to authorize a transfer callable.
- **G-10A-3. Platform administrator claim shape.** The claim shape in §6 permits either omitted `districtId`/`schoolId` on administrator tokens or an explicit administrator sentinel; the certified architecture does not settle which is canonical. The implementation sprint MUST pick one and document it as an amendment to this contract. Absence-as-sentinel is preferred because it aligns with the rule "claims are only present when `status === "active"` and the role has a district".

No blocking gap remains. Implementation of the district claim write path can proceed against this contract with the three narrow decisions above deferred to their appropriate future scope.

---

## Change Log

- 2026-07-12 - Initial issuance under Sprint 10A step F-1. Ratified by PDR-025.
