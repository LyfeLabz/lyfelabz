# Sprint 23C Completion Report

Google Classroom Roster Synchronization

Status: Sprint 23C roster retrieval and roster reconciliation are implemented and certified at the code, test, emulator, fixture, and controlled single-process level. Existing Firebase UID identity, external identity, enrollment, assessment, submission, and immutable Attempt architecture is preserved. Production activation remains blocked pending durable multi-instance token and OAuth-state stores, production identity backfill, operational provisioning, and deployment certification.

---

## 1. Architecture assessment

The Sprint 23C STOP report objected to any implicit expansion of `LmsProviderAdapter`. This sprint proceeds under the explicit authorization to expand the vendor-neutral provider surface with exactly one roster-read operation and one paired vendor-neutral roster-student type. No other provider-interface fields were added; every excluded capability named in Sprint 23A / 23B (grade sync, announcements, materials, roster mutation, refresh mutation) remains absent by design.

Roster reconciliation is implemented in a provider-neutral engine that depends only on the vendor-neutral provider adapter, the existing provider registry, the certified external identity bridge, the existing token-store boundary, the existing LMS connection and class-link records, and the existing enrollment records and helpers. No Google-specific concern leaks into the engine (PDR-020f).

## 2. Final `LmsRosterStudent` type

```
export type LmsRosterStudent = {
  readonly providerAccountId: string;
};
```

Only the opaque upstream account identifier is exposed. No email, no display name, no profile photo, no course role, no enrollment status, no school metadata, and no Google-shaped response fields are carried across the vendor-neutral boundary. `providerAccountId` is opaque string data passed into the certified external identity bridge; it is not a Firebase UID and not an email.

## 3. Final `listClassRoster` signature

```
listClassRoster(input: {
  readonly accessToken: string;
  readonly lmsClassId: string;
}): Promise<readonly LmsRosterStudent[]>;
```

Returns one complete normalized roster or rejects the whole call. Pagination stays inside the adapter.

## 4. Files created

- `platform/functions/src/lms/roster/sync-engine.ts` - provider-neutral reconciliation engine (two-phase read / plan then apply).
- `platform/functions/src/lms/roster/sync-engine.test.ts` - 15 engine unit tests.
- `platform/functions/src/lms/classes-sync-roster.ts` - `lmsClassesSyncRoster` callable.
- `platform/functions/src/lms/classes-sync-roster.test.ts` - callable unit tests (auth, request validation, response projection, audit shape, no-token / no-PII exposure).
- `platform/functions/src/lms/providers/google-classroom/adapter-roster.test.ts` - 18 adapter tests covering pagination, dedup, ordering, exact-string preservation, malformed-entry rejection, error translation, pagination loop, max-page bound, and later-page-failure atomicity.
- `docs/platform/SPRINT_23C_COMPLETION_REPORT.md` - this document.

## 5. Files modified

- `platform/functions/src/lms/providers/provider.ts` - added `LmsRosterStudent` and `listClassRoster`; updated the header comment to reflect that roster reading is now part of the certified provider boundary and that grade sync and every other excluded capability still requires its own sprint authorization.
- `platform/functions/src/lms/providers/google-classroom/adapter.ts` - implemented `listClassRoster` against the existing `listCourseStudents` transport method with bounded pagination, deterministic first-occurrence dedup, deterministic sort ordering, malformed-entry rejection, pagination-loop guard, and max-page-bound rejection. All upstream failures route through the existing `translateUpstreamError` boundary translator.
- `platform/functions/src/lms/providers/google-classroom/adapter.test.ts` - updated the deferred-operations boundary comment to reflect Sprint 23C activation. `listClassTopics` and `publishAssignment` remain the only deferred operations.
- `platform/functions/src/lms/index.ts` - exported `lmsClassesSyncRoster`.
- `platform/functions/src/index.ts` - re-exported `lmsClassesSyncRoster` from the deploy surface.
- `platform/functions/src/shared/types/audit-event.ts` - extended the `AuditAction` union with `lms.rosterSynchronized`.
- `platform/functions/src/shared/audit/write-audit-event.ts` - extended `VALID_ACTIONS` in lockstep. (Also brought `lms.assignmentPublished` and `lms.publishFailed` into the runtime validator to match the pre-existing type union entries; this repair had no observable behavior change under the current callable surface but removes a latent runtime rejection.)
- `docs/platform/LMS_INTEGRATION_OPERATIONS.md` - added `§17B. Sprint 23C - Google Classroom Roster Synchronization` operational note.

## 6. Provider adapter implementation summary

`googleClassroomAdapter.listClassRoster` calls the existing `listCourseStudents` transport method (already present in the Sprint 23A transport interface and Sprint 23B production HTTPS binding). It iterates pages up to a defensive `MAX_PAGES = 50` bound. For each returned entry it validates the `profile` object shape and requires a nonempty, non-whitespace `profile.id`; a malformed entry rejects the whole operation with `lms.upstreamMalformedResponse`. Deduplication uses first-occurrence semantics keyed by `providerAccountId`. The returned array is sorted deterministically by the byte-exact string comparison of `providerAccountId` so identical rosters always produce identical engine planning input across replays. All upstream failures pass through `translateUpstreamError`, which maps 401/403 to `lms.upstreamAuthorizationFailed`, 404 to `lms.upstreamResourceNotFound`, 429 and 503 to `lms.upstreamTemporarilyUnavailable`, and everything else to `lms.upstreamCallFailed`. A repeated `nextPageToken` from upstream is treated as a pagination loop and rejected with `lms.upstreamCallFailed`.

## 7. Pagination and malformed-response behavior

Pagination is fully contained inside the adapter. The vendor-neutral engine never sees a page token, an iterator, a generator, or any Google-shaped response object. A later-page failure after earlier pages succeeded rejects the entire operation; the engine therefore never receives a partial roster represented as successful. An empty successful roster is a valid observation (no students in the upstream class) and is distinct from a failed roster read.

## 8. Synchronization algorithm

Two phases.

Phase 1 (read + plan, no writes):

1. Load the `classes/{classId}` document and re-verify caller ownership.
2. Load the single `lmsClassLinks/{linkId}` document with `status = "linked"` for this class (refuses ambiguity if more than one active link is found).
3. Load the `lmsConnections/{connectionId}` document, verify teacher ownership and `status = "active"`, and verify the connection's `providerId` matches the link's `providerId`.
4. Resolve the connection's `tokenRef` through the existing token-store boundary.
5. Resolve the vendor-neutral adapter from the existing provider registry and call `listClassRoster`. Any failure aborts the sync before any write.
6. Load current active enrollments for this class through the certified `enrollmentsCollectionRef().where(classId, "==", classId).where(status, "==", "active")` query.
7. For each upstream roster member, call `resolveActiveExternalIdentity({ providerId: "google.com", providerAccountId })`. Absent or revoked mappings are classified `unresolved`.
8. For each resolved member: if already in the current active set, count `unchanged`; otherwise inspect the deterministic per-(classId, studentId) enrollment document. If no prior enrollment doc exists, plan an add. If a prior enrollment doc exists in a non-active status, count `skipped` (no reactivation transition is authorized; see §11).
9. Compute withdrawals: any current active enrollment whose student UID is not present in the resolved set is planned for withdrawal.

Phase 2 (apply):

1. Additions are applied in deterministic enrollment-id order. Each add re-reads the deterministic-id document as a race check; a pre-existing document is preserved (upholds the "no duplicate enrollment documents" invariant on concurrent replays).
2. Withdrawals are applied in deterministic enrollment-id order using the narrow `enrollmentStatusChangeDocRef(...).update({ status: "withdrawn", exitedAt })` write.

## 9. Identity-resolution behavior

The certified external identity bridge is the ONLY authorized identity path. `resolveActiveExternalIdentity({ providerId: "google.com", providerAccountId })` is the exact call site. No email lookup, no display-name lookup, no Firebase Auth enumeration, no account creation, no placeholder users, no automatic account linking. The LMS provider namespace (`"googleClassroom"`) and the external identity provider namespace (`"google.com"`) are kept distinct. A missing or revoked mapping means the roster member is `unresolved`; the sync continues processing the rest of the roster and never guesses.

## 10. Addition behavior

Additions use the certified `enrollmentCreationDocRef(id).set({...})` write path with the deterministic `enrollmentIdFor(classId, studentUserId)` document ID. The write shape is the standard `EnrollmentCreationWrite` with `status: "active"` at creation and a server-stamped `enrolledAt`. No `displayNameOverride` is written from Classroom metadata (the vendor-neutral roster type does not expose it, and none of email / display name / profile is captured). The resolved Firebase UID is preserved byte-exact.

## 11. Reactivation behavior

None. The certified enrollment lifecycle table (`enrollments-set-status.ts`) admits only:

```
active      -> transferred | withdrawn | archived
transferred -> archived
withdrawn   -> archived
archived    -> (terminal)
```

There is no authorized inactive-to-active transition. A resolved upstream member whose prior deterministic-id enrollment document is in a non-active status (`transferred`, `withdrawn`, or `archived`) is classified `skipped`; no write is performed. This is a documented lifecycle gap: the teacher may re-enroll the student through the certified `enrollmentsTeacherAdd` path once the lifecycle table admits a reactivation transition. Sprint 23C does not add such a transition.

## 12. Removal behavior

Removals are applied only after a complete successful roster retrieval and only against current active enrollments. The single authorized exit transition used by roster synchronization is `active -> withdrawn`; `archived` is reserved for class-archival driven transitions and is not written here. Historical Attempts, submissions, assessment relationships, and the enrollment document itself are preserved. Because a class carrying an LMS link rejects join-code enrollment (see `classes-import.ts` plus enrollment-source enforcement), every current active enrollment on a linked class was itself sourced from a prior roster sync, so the "withdraw active enrollments missing from the upstream roster" rule cannot accidentally withdraw a join-code student.

## 13. Unresolved-member behavior

An upstream roster member whose external identity is absent or revoked is counted as `unresolved` and skipped. The remaining roster members continue processing. Unresolved members do NOT count as removals from the local roster; a resolved-but-currently-inactive student who is upstream is `skipped`, not withdrawn. The public callable response includes only an aggregate `unresolved` count. The raw provider account identifier is not logged, not written to any client-visible response field, and not carried into the audit payload.

## 14. Idempotency and concurrency evidence

- The enrollment document ID is deterministic (`${classId}__${studentId}`), so a repeat sync with an unchanged upstream roster produces zero writes and returns matching counts.
- Additions re-read the deterministic-id document immediately before writing. A concurrent write that already produced the same enrollment causes the second attempt to become a no-op instead of an overwrite. Test: "does not overwrite a pre-existing enrollment doc during add (idempotency on concurrent race)".
- Withdrawals re-verify the current status before the narrow status-change update; a doc that raced to a non-active state is skipped.
- Additions and withdrawals are applied in deterministic sorted order, so replay ordering is identical.
- No new lock collection, lease document, or lock file was introduced.

## 15. Data-preservation evidence

- No user is ever deleted or deactivated.
- No enrollment document is deleted.
- No Attempts, submissions, assessment revisions, or assessment records are modified.
- No other class is affected: the query surface is scoped by `classId` and every write targets a deterministic ID within that class.
- The connection, class-link, and provider records are read-only from the engine's perspective.

## 16. Audit and privacy evidence

- Exactly one `lms.rosterSynchronized` audit event per completed synchronization, emitted through the canonical `writeAuditEvent` helper.
- Target: `class` / the LyfeLabz class ID.
- Audit payload fields: `providerId`, `added`, `reactivated`, `unchanged`, `withdrawn`, `unresolved`, `skipped`, `upstreamRosterEmpty`, `unresolvedPresent`.
- Audit payload NEVER contains: provider account identifier, external identity document ID, Firebase UID, student name, email, profile data, OAuth tokens, or Classroom raw payload. The callable test asserts this negative shape with a regex over the serialized payload.
- Public callable response fields: `classId`, `added`, `reactivated`, `unchanged`, `withdrawn`, `unresolved`, `skipped`, `upstreamRosterEmpty`. Same negative-shape guarantee.

## 17. Exact validation results

- Functions typecheck: clean (`tsc --noEmit -p tsconfig.json`).
- Functions lint: clean (`npm run lint`).
- Functions build: clean (`npm run build`).
- Functions test suite: 67 suites, 1249 tests, all passing.
- Firestore Rules test suite (via `firebase emulators:exec --only firestore jest`): 16 suites, 202 tests, all passing.
- App verification chain (`npm --prefix app run verify`, includes `curriculum:verify`, `lessons:verify`, `typecheck`, `lint`, `test`): 40 suites, 754 tests, all passing.
- Em-dash grep over every touched file: 0 occurrences across 12 files.

## 18. Regression assessment

Every Sprint 23A, Sprint 23B, and Sprint 23C-I test remains green. The Sprint 23B deferred-operation boundary test (`adapter.test.ts`) was updated only in its header comment to reflect that Sprint 23C activated `listClassRoster`; the enumerated deferred operations list (`listClassTopics`, `publishAssignment`) is unchanged and continues to short-circuit with `lms.providerNotYetOperational`. Student onboarding is unchanged. Enrollment lifecycle is unchanged outside the two authorized transitions used by roster synchronization (create at `active`; transition `active -> withdrawn`). Assessment architecture is unchanged; Attempts remain immutable; submissions are unchanged.

## 19. Remaining production blockers

- Durable multi-instance LMS OAuth token store (Sprint 23B in-process fallback remains active).
- Durable multi-instance LMS OAuth state store (Sprint 23B in-process fallback remains active).
- Production external identity backfill (Sprint 23C-I emulator-only migration path).
- Operational OAuth provisioning per `LMS_INTEGRATION_ARCHITECTURE.md §10.3.1`.
- Deployment certification and production activation gates.

## 20. Sprint 23D readiness

Sprint 23C leaves teacher UX, student UX, dashboard changes, assignment publication changes, coursework mutation beyond the already-shipped publication surface, announcements, materials, grading, and grade synchronization intentionally untouched. The provider interface is not expanded beyond the one authorized method. Sprint 23D may proceed against a stable Sprint 23C boundary.

## 21. Sprint 23C certification recommendation

"Google Classroom roster retrieval and LyfeLabz roster reconciliation are implemented and certified at the code, test, emulator, fixture, and controlled single-process level. Existing Firebase UID identity, external identity, enrollment, assessment, submission, and immutable Attempt architecture is preserved. Production activation remains blocked pending durable multi-instance token and OAuth-state stores, production identity backfill, operational provisioning, and deployment certification."
