# shared/auth

Cross-domain authentication helpers used by every callable and trigger that needs to grant or revoke authorization.

**Responsibility.** Provide the single canonical path for writing custom claims on a Firebase Auth identity. The canonical claims shape and its invariants are defined by Cloud Function Charter §2: claims contain exactly `role` and `schoolId`, and are written only when the user's lifecycle `status` is `active` per `PLATFORM_STATE_MACHINE.md`.

**Depends on.** `firebase-admin/auth`, `shared/errors`, `shared/types/user`.

**Depended on by.** Every current and future callable and trigger that transitions a user to `active` (Sprint 2: `studentsCompleteOnboarding`, `teachersApproveVerification`). No second write path exists for custom claims.
