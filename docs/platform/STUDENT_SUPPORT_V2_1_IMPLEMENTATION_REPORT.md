# Student Support V2.1 implementation report

The isolated worktree is `/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz` on `codex/student-support-v2-1`, based on `3cbfdcf621bb1912c9f3188cbef8696e1b644593`. The corrected inventory contains 91 unstaged and uncommitted files.

The second review remediation separates cancellation of an unbound invitation from removal of a UID recipient. Whole removal atomically closes the selected relationship, publishes the issuer cutoff, and enqueues a durable job. Cleanup pages the issuer's grants and aliases after access is denied. An explicit grant-ID revoke supersedes the older cleanup version and blocks pending activation. Canonical student listing retains valid grants if relationship maintenance fails.

The versioned write API requires an operation ID and expected issuer generation. Old V2 tabs retain canonical reads and confirmation of current active shares. Legacy requests that could change access require a refresh. V2.1 loads canonical grants and workspace eligibility independently of pending reconciliation and never falls back to legacy writes. Verified Google identity remains mandatory for new activation.

Functions and the cleanup scheduler deploy before Hosting. A Hosting rollback can restore V2 assets with the cutoff-enforcing backend retained. Backend rollback requires separate authorization and proof that equivalent security remains enforced. See [the implementation contract](STUDENT_SUPPORT_V2_1_IMPLEMENTATION.md) for the full sequence.

## Verification

| Check | Passed tests | Failed tests | Exit |
|---|---:|---:|---:|
| App unit tests | 9176 | 0 | 0 |
| Functions unit tests | 5870 | 0 | 0 |
| Student Support emulator | 72 | 0 | 0 |
| Firestore Rules | 3 | 0 | 0 |

Other check exit codes are `app-typecheck` 0, `functions-typecheck` 0, `app-lint` 0, `functions-lint` 0, `app-build` 0, `diff-check` 0. Tests ran serially with at most two workers. Firestore tests used a local demo project. The initial focused emulator run had three fixture failures because the synthetic class lacked a title. The corrected focused run passed all five selected tests.

Source manifest SHA-256 is `19ae25ba92301b77f6eba3a2fa3528959951512416824dc14fa93e55f3d8ee4f`. It covers all 88 changed code, configuration, and test files.

[Source manifest](/private/tmp/lyfelabz-v21-review2/source-manifest.json) · [Exit statuses](/private/tmp/lyfelabz-v21-review2/status.txt) · [App unit tests](/private/tmp/lyfelabz-v21-review2/app-test.log) · [Functions unit tests](/private/tmp/lyfelabz-v21-review2/functions-test.log) · [Student Support emulator](/private/tmp/lyfelabz-v21-review2/emulator-final.log) · [Firestore Rules](/private/tmp/lyfelabz-v21-review2/rules.log)

## Staging verification checklist

1. Confirm the configured pilot school, index readiness, and Functions and Hosting compatibility under the existing Teacher Units release procedure.
2. Use approved Google test identities and synthetic students to verify pending saves, allowlist refusal, ordinary onboarding, and automatic activation.
3. Verify the two destinations, default landing, preview links, waiting state, retry behavior, and archived-class ownership.
4. Exercise individual and whole-recipient removal with multiple issuers. Test stale activation, account recreation, and direct teaching callables.
5. Exercise the 400-pair bulk path with active and pending recipients and measure warm and cold response times.
6. Regression-check science-teacher onboarding, class management, assignment publishing, Google Classroom, and existing UID grants.

Administrator identity recovery and a future transition to science-teacher capabilities require a separately authorized workflow. Pending records have no automatic expiration. The platform retention schedule for these records remains unspecified. Staging must verify real Google sign-in, service latency, and deployed configuration.

## Suggested GitHub Desktop commit groups and complete file inventory

### Backend and Firestore tests (75 files)

- Modified [platform/firebase/firestore.indexes.json](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/firebase/firestore.indexes.json)
- Modified [platform/firebase/tests/student-support-grants.rules.test.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/firebase/tests/student-support-grants.rules.test.ts)
- Modified [platform/functions/src/accommodations/accommodations-get.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/accommodations/accommodations-get.ts)
- Modified [platform/functions/src/accommodations/accommodations-list-students.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/accommodations/accommodations-list-students.ts)
- Modified [platform/functions/src/accommodations/accommodations-set.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/accommodations/accommodations-set.ts)
- Modified [platform/functions/src/assignments/assignments-archive.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-archive.ts)
- Modified [platform/functions/src/assignments/assignments-close.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-close.ts)
- Modified [platform/functions/src/assignments/assignments-create-draft.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-create-draft.ts)
- Modified [platform/functions/src/assignments/assignments-current-recipients-reconcile.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-current-recipients-reconcile.ts)
- Modified [platform/functions/src/assignments/assignments-current-set.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-current-set.ts)
- Modified [platform/functions/src/assignments/assignments-lifecycle-state.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-lifecycle-state.ts)
- Modified [platform/functions/src/assignments/assignments-list-for-student.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-list-for-student.ts)
- Modified [platform/functions/src/assignments/assignments-publish.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-publish.ts)
- Modified [platform/functions/src/assignments/assignments-recipient-add.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-recipient-add.ts)
- Modified [platform/functions/src/assignments/assignments-recipient-candidates.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-recipient-candidates.ts)
- Modified [platform/functions/src/assignments/assignments-recipient-list.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-recipient-list.ts)
- Modified [platform/functions/src/assignments/assignments-recipients-reconcile.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-recipients-reconcile.ts)
- Modified [platform/functions/src/assignments/assignments-reopen.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-reopen.ts)
- Modified [platform/functions/src/assignments/assignments-teacher-list.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-teacher-list.ts)
- Modified [platform/functions/src/assignments/assignments-update-draft.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/assignments/assignments-update-draft.ts)
- Modified [platform/functions/src/classes/classes-activate-audit-integration.test.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/classes/classes-activate-audit-integration.test.ts)
- Modified [platform/functions/src/classes/classes-activate.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/classes/classes-activate.ts)
- Modified [platform/functions/src/classes/classes-archive.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/classes/classes-archive.ts)
- Modified [platform/functions/src/classes/classes-create.test.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/classes/classes-create.test.ts)
- Modified [platform/functions/src/classes/classes-create.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/classes/classes-create.ts)
- Modified [platform/functions/src/classes/classes-lifecycle-integration.test.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/classes/classes-lifecycle-integration.test.ts)
- Modified [platform/functions/src/classes/classes-lms-create.test.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/classes/classes-lms-create.test.ts)
- Modified [platform/functions/src/classes/classes-lms-create.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/classes/classes-lms-create.ts)
- Modified [platform/functions/src/classes/classes-update-metadata.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/classes/classes-update-metadata.ts)
- Modified [platform/functions/src/enrollments/enrollments-join-by-code.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/enrollments/enrollments-join-by-code.ts)
- Modified [platform/functions/src/enrollments/enrollments-list-for-class.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/enrollments/enrollments-list-for-class.ts)
- Modified [platform/functions/src/enrollments/enrollments-set-status.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/enrollments/enrollments-set-status.ts)
- Modified [platform/functions/src/enrollments/enrollments-teacher-add.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/enrollments/enrollments-teacher-add.ts)
- Modified [platform/functions/src/gradeImprovements/callables.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/gradeImprovements/callables.ts)
- Modified [platform/functions/src/index.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/index.ts)
- Modified [platform/functions/src/lms/assignments-publish.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/assignments-publish.ts)
- Modified [platform/functions/src/lms/classes-discover.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/classes-discover.ts)
- Modified [platform/functions/src/lms/classes-import.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/classes-import.ts)
- Modified [platform/functions/src/lms/classes-list-topics.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/classes-list-topics.ts)
- Modified [platform/functions/src/lms/classes-refresh-roster.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/classes-refresh-roster.ts)
- Modified [platform/functions/src/lms/classes-refresh.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/classes-refresh.ts)
- Modified [platform/functions/src/lms/classes-sync-roster.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/classes-sync-roster.ts)
- Modified [platform/functions/src/lms/connections-begin.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/connections-begin.ts)
- Modified [platform/functions/src/lms/connections-complete.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/connections-complete.ts)
- Modified [platform/functions/src/lms/connections-describe.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/connections-describe.ts)
- Modified [platform/functions/src/lms/connections-disconnect.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/connections-disconnect.ts)
- Modified [platform/functions/src/lms/coursework-inspect.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/coursework-inspect.ts)
- Modified [platform/functions/src/lms/deep-link-resolve.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/deep-link-resolve.ts)
- Modified [platform/functions/src/lms/lms-grade-passbacks-apply.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/lms-grade-passbacks-apply.ts)
- Modified [platform/functions/src/lms/lms-grade-passbacks-preview.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/lms-grade-passbacks-preview.ts)
- Modified [platform/functions/src/lms/lms-grade-passbacks-retry.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/lms-grade-passbacks-retry.ts)
- Modified [platform/functions/src/lms/providers-list.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/lms/providers-list.ts)
- Modified [platform/functions/src/shared/types/audit-event.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/shared/types/audit-event.ts)
- Modified [platform/functions/src/supportAccess/authorize.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/supportAccess/authorize.ts)
- Modified [platform/functions/src/supportAccess/callables.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/supportAccess/callables.ts)
- Modified [platform/functions/src/supportAccess/support-access.emulator.test.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/supportAccess/support-access.emulator.test.ts)
- Modified [platform/functions/src/supportAccess/support-access.test.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/supportAccess/support-access.test.ts)
- Modified [platform/functions/src/teacherUnits/teacher-units-archive.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/teacherUnits/teacher-units-archive.ts)
- Modified [platform/functions/src/teacherUnits/teacher-units-capabilities.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/teacherUnits/teacher-units-capabilities.ts)
- Modified [platform/functions/src/teacherUnits/teacher-units-create.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/teacherUnits/teacher-units-create.ts)
- Modified [platform/functions/src/teacherUnits/teacher-units-get.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/teacherUnits/teacher-units-get.ts)
- Modified [platform/functions/src/teacherUnits/teacher-units-list.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/teacherUnits/teacher-units-list.ts)
- Modified [platform/functions/src/teacherUnits/teacher-units-reorder.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/teacherUnits/teacher-units-reorder.ts)
- Modified [platform/functions/src/teacherUnits/teacher-units-restore.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/teacherUnits/teacher-units-restore.ts)
- Modified [platform/functions/src/teacherUnits/teacher-units-set-resources.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/teacherUnits/teacher-units-set-resources.ts)
- Modified [platform/functions/src/teacherUnits/teacher-units-update.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/teacherUnits/teacher-units-update.ts)
- Modified [platform/functions/src/teachers/teacher-class-color-update.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/teachers/teacher-class-color-update.ts)
- Modified [platform/functions/src/teachers/teacher-class-order-update.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/teachers/teacher-class-order-update.ts)
- Modified [platform/functions/src/teachers/teacher-preferences-update.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/teachers/teacher-preferences-update.ts)
- New [platform/functions/src/supportAccess/recipient-authorizations.emulator.test.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/supportAccess/recipient-authorizations.emulator.test.ts)
- New [platform/functions/src/supportAccess/recipient-authorizations.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/supportAccess/recipient-authorizations.ts)
- New [platform/functions/src/supportAccess/recipient-policy.test.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/supportAccess/recipient-policy.test.ts)
- New [platform/functions/src/supportAccess/recipient-policy.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/supportAccess/recipient-policy.ts)
- New [platform/functions/src/supportAccess/teaching-callable.test.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/supportAccess/teaching-callable.test.ts)
- New [platform/functions/src/supportAccess/teaching-callable.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/platform/functions/src/supportAccess/teaching-callable.ts)

### App and client tests (13 files)

- Modified [app/src/index.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/app/src/index.ts)
- Modified [app/src/shell/navigation.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/app/src/shell/navigation.ts)
- Modified [app/src/shell/shell.student-support-workspace.test.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/app/src/shell/shell.student-support-workspace.test.ts)
- Modified [app/src/shell/shell.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/app/src/shell/shell.ts)
- Modified [app/src/shell/supportWorkspace.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/app/src/shell/supportWorkspace.ts)
- Modified [app/src/shell/surfaces/classSupportAccess.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/app/src/shell/surfaces/classSupportAccess.ts)
- Modified [app/src/shell/surfaces/classes.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/app/src/shell/surfaces/classes.ts)
- Modified [app/src/shell/surfaces/curriculum.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/app/src/shell/surfaces/curriculum.ts)
- Modified [app/src/shell/surfaces/settings.share-student-progress.test.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/app/src/shell/surfaces/settings.share-student-progress.test.ts)
- Modified [app/src/shell/surfaces/workspace.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/app/src/shell/surfaces/workspace.ts)
- Modified [app/src/supportAccess/types.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/app/src/supportAccess/types.ts)
- Modified [app/src/supportAccess/wire.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/app/src/supportAccess/wire.ts)
- New [app/src/supportAccess/wire.test.ts](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/app/src/supportAccess/wire.test.ts)

### Documentation (3 files)

- Modified [docs/platform/STUDENT_SUPPORT_ACCESS.md](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/docs/platform/STUDENT_SUPPORT_ACCESS.md)
- New [docs/platform/STUDENT_SUPPORT_V2_1_IMPLEMENTATION.md](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/docs/platform/STUDENT_SUPPORT_V2_1_IMPLEMENTATION.md)
- New [docs/platform/STUDENT_SUPPORT_V2_1_IMPLEMENTATION_REPORT.md](/Users/breezy/.codex/worktrees/student-support-v2-1/lyfelabz/docs/platform/STUDENT_SUPPORT_V2_1_IMPLEMENTATION_REPORT.md)
