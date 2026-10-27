# shared/audit

Cross-domain audit helpers used by every callable, trigger, and administrative script that must record a security-relevant event.

**Responsibility.** Provide the single canonical path for writing to the `auditEvents` Firestore collection. The canonical event shape is defined by Data Model §3.8. The Sprint 2 audit-action vocabulary is defined by Sprint 2 §4.5. Every event written by the platform routes through `writeAuditEvent` and conforms to that shape and vocabulary.

**Depends on.** `firebase-admin/firestore`, `shared/errors`, `shared/firestore`, `shared/types/audit-event`, `shared/types/user`, and standalone strict data primitives from `teacherUnits/availability-protocol` (no runtime eligibility or I/O).

**Depended on by.** Every current and future callable, trigger, or administrative script that emits an audit event (Sprint 2: the extended `authOnUserCreate`, `studentsCompleteOnboarding`, `teachersRequestVerification`, `teachersApproveVerification`, `teachersDenyVerification`). No second write path exists for audit events. Client writes to `auditEvents` are blocked by Security Rules per Data Model §3.8 and Cloud Function Charter §2.

## My Units availability operator event

Option B adds one global audit-only exception: `actorRole: "operator"` is valid
if and only if `action: "teacherUnits.availabilityChanged"`,
`targetType: "teacherUnitsAvailability"`, and
`targetId: "platformConfig/teacherUnitsAvailability"`. Conversely, that action
requires this operator/target tuple. `correlationId` is a required canonical
lowercase UUID v4 identifying the transition; `actorUserId` must equal
`payload.operator.principalSubject`. No `schoolId` or `districtId` may be
supplied, including an explicitly undefined field. Unknown input and nested
payload fields are rejected for this exception.

Its required payload has exactly `{transition, policyInstanceId, generation,
mode, approvedBackendBuildId, placementFingerprint, operator, reason,
approvalRef}`. Transitions are `initialize`, `prepare`, `enable`, `close`, or
`recoverClosed`. Instance IDs are canonical lowercase UUID v4; generation is a
positive safe integer through `Number.MAX_SAFE_INTEGER`. Build and placement
identities are lowercase SHA-256 digests, with build nullable while closed.
Enable requires enabled mode, a build and a non-null approval reference;
prepare/close require closed mode. Initialize/recoverClosed require closed
mode, generation 1 and null build. Enabled maximum generation remains enabled.
`operator` is exactly `{principalSubject, credentialSubject, delegationSubject}`:
subjects are nonempty well-formed text, at most 256 code points, without
controls; delegation may be null. `reason` is trimmed nonempty text of at most
1000 code points; approvalRef is null or trimmed nonempty text of at most 256
code points, without controls. Never include credentials or student data.

This shared writer validates structure and attribution consistency; supplied
subjects are not authentication or approval proof. The future B1e trusted
operator tool must verify credentials and authorization, bind every field to
the same validated policy transition and decision, and enlist policy, history
and canonical audit in one transaction after all reads. B1d adds no operator
entry point, callable privilege, IAM grant, application Role or client access.
Transaction enlistment does not prove commit, shutdown or successful readback;
B1e must verify them, reconcile uncertainty and suppress duplicate/no-op audits.
Existing user school/district requirements, system exceptions and historical
audit record interpretation remain unchanged.
