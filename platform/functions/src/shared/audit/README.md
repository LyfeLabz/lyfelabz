# shared/audit

Cross-domain audit helpers used by every callable, trigger, and administrative script that must record a security-relevant event.

**Responsibility.** Provide the single canonical path for writing to the `auditEvents` Firestore collection. The canonical event shape is defined by Data Model §3.8. The Sprint 2 audit-action vocabulary is defined by Sprint 2 §4.5. Every event written by the platform routes through `writeAuditEvent` and conforms to that shape and vocabulary.

**Depends on.** `firebase-admin/firestore`, `shared/errors`, `shared/firestore`, `shared/types/audit-event`, `shared/types/user`.

**Depended on by.** Every current and future callable, trigger, or administrative script that emits an audit event (Sprint 2: the extended `authOnUserCreate`, `studentsCompleteOnboarding`, `teachersRequestVerification`, `teachersApproveVerification`, `teachersDenyVerification`). No second write path exists for audit events. Client writes to `auditEvents` are blocked by Security Rules per Data Model §3.8 and Cloud Function Charter §2.
