# Sprint 5B Certification: Closed as Satisfied by Sprint 5A

**Date:** 2026-07-09
**Status:** Closed without code changes. No commit produced by Sprint 5B.
**Companion documents:** SPRINT_HISTORY.md, LYFELABZ_CLOUD_FUNCTION_CHARTER.md, LYFELABZ_FIRESTORE_DATA_MODEL.md §3.7, LYFELABZ_FIREBASE_SECURITY_MODEL.md §4.6, TEACHER_PLATFORM_DOMAIN_ROADMAP.md Phase 6.

---

## 1. Architecture review finding

Sprint 5B was originally scoped to complete the server-side Submission Foundation begun in Sprint 5A: the finalization callable, the additive Firestore Rules for submission reads, and the audit vocabulary for the `submitted -> finalized` lifecycle.

A pre-implementation architecture review of the Sprint 5A commit (`28cd62b Sprint 5A: Implement Submission Foundation`) confirmed that Sprint 5A shipped the full server-side Submission Foundation in a single sprint, not the create-only foundation initially anticipated. Every invariant the Sprint 5B specification would have introduced is already implemented, tested, and consistent with the Platform Architecture.

Sprint 5B is therefore closed as satisfied. No code, tests, rules, types, audit vocabulary, or documentation were modified by this closure.

## 2. Why no code changes were required

The Sprint 5A commit shipped both callables in the Submission Foundation - `submissionsCreate` and `submissionsFinalize` - together with the Rules, types, audit vocabulary, and tests that Sprint 5B would otherwise have introduced. Splitting the domain across two sprints would have produced no additional invariant and would have required rewriting no file. Preservation Mode and the Repository Hardening Rule both direct us to prefer repository-wide consistency over introducing structural changes that produce no user-visible or architectural benefit.

## 3. Sprint 5A files that already satisfy each Sprint 5B invariant

| Sprint 5B invariant | Sprint 5A file that satisfies it |
|---|---|
| Canonical `SubmissionRecord`, `SubmissionCreationWrite`, `SubmissionFinalizationWrite` shapes per Data Model §3.7 | `platform/functions/src/shared/types/submission.ts` |
| Typed reference layer for `submissions/{submissionId}` (read/write split) | `platform/functions/src/shared/firestore/typed-ref.ts` |
| `submissions.created` and `submissions.finalized` in the canonical `AuditAction` union | `platform/functions/src/shared/types/audit-event.ts` |
| Canonical `writeAuditEvent` allowlist covers both new actions | `platform/functions/src/shared/audit/write-audit-event.ts` |
| Deterministic submission ID `{assignmentId}__{studentId}` and idempotent create in `submitted` state | `platform/functions/src/submissions/submissions-create.ts` |
| Server-mediated `submitted -> finalized` transition, immutable ownership, `submittedAt` stamped server-side | `platform/functions/src/submissions/submissions-finalize.ts` |
| Both callables registered on the Functions surface | `platform/functions/src/index.ts` |
| Additive Firestore Rules for submission `get`/`list` scoped to `studentId` (student) and `teacherId` (class teacher); default-deny preserved for writes | `platform/firebase/firestore.rules` (submissions block) |
| Unit tests exercising every branch of both callables (validation, idempotency, ownership, audit ordering, downstream failure propagation) | `platform/functions/src/submissions/submissions-create.test.ts`, `platform/functions/src/submissions/submissions-finalize.test.ts` |
| Rules tests exercising every admissible and inadmissible submission read shape | `platform/firebase/tests/submissions.rules.test.ts` |
| Documentation of Sprint 5A scope in the domain README | `platform/functions/src/submissions/README.md` |
| Callable enumerated in the Charter appendix | `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` |

## 4. No architecture drift

Every Sprint 4 and Sprint 5A architectural guarantee is preserved:

- Firestore remains authoritative for lifecycle.
- `status` remains the only lifecycle field on every domain document. No second lifecycle field was introduced on `submissions/{submissionId}`.
- Audit events remain append-only and flow exclusively through `writeAuditEvent`. The canonical vocabulary was extended only inside `shared/types/audit-event.ts` by Sprint 5A and was not touched by Sprint 5B.
- Custom claims remain `{ role, schoolId }`. No new claim was introduced.
- The Immutable Session Object, Session Bootstrap, protected router, Teacher Platform Shell, authentication flow, teacher verification flow, and student onboarding flow are unchanged.
- Denormalized ownership fields on submissions (`classId`, `teacherId`, `schoolId`, `lessonSlug`, `lessonVersion`, `mode`) are copied from the referenced assignment at creation and are immutable thereafter per Data Model §12.3 and §1.2.
- Firestore Rules remain strictly additive to the default-deny baseline. Client writes to `submissions/{submissionId}` remain denied; both callables write through the Admin SDK from the Cloud Function trust boundary.
- No new collection beyond the certified `submissions` collection was introduced. The reserved `submissions/{submissionId}/responses` subcollection remains reserved and unused.

## 5. No files affecting runtime, rules, functions, or app behavior were modified

Sprint 5B closure modified only this certification document and appended a concise Sprint 5B entry to `SPRINT_HISTORY.md`. No file under any of the following paths was created, edited, renamed, or deleted:

- `platform/functions/**`
- `platform/firebase/firestore.rules`
- `platform/firebase/firestore.indexes.json`
- `platform/firebase/storage.rules`
- `platform/firebase/firebase.json`
- `platform/firebase/tests/**`
- `app/**` (source, tests, or build configuration)
- Any file at the instructional repository root
- Any deployment surface

Repository validation totals are therefore unchanged from the Sprint 5A baseline and remain green.

## 6. Recommendation

Sprint 5B is closed as satisfied by Sprint 5A. The platform should proceed to Sprint 6 (per the Teacher Platform Domain Roadmap, the next scoped surface after the server-side Submission Foundation) after:

1. Technical Lead review of this certification and of the Sprint 5A commit against the Sprint 5B invariants enumerated above.
2. Local verification by Chris that `platform/functions`, `platform/firebase`, and `app` all validate cleanly on his machine, matching the totals recorded in the Sprint 5B history entry.

No commit is recommended until both reviews are complete.
