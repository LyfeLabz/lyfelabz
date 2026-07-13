# Sprint 10A Step F-4 Reconciliation Report

**Status:** Reconciliation report for Sprint 10A step F-4 (Roster Display Name Implementation Contract). Architecture-only step. No implementation code, no Firestore Rules, no Cloud Functions, no configuration, and no tests were modified. No commits were made.
**Date:** 2026-07-12
**Scope:** Documentation and architecture reconciliation only. F-4 addresses the fourth and final primary finding from the Sprint 9E independent architecture review by translating the certified identity, enrollment, and LMS roster documents into a single implementation contract for teacher-readable display names.

Sprint 10A F-4 does not begin implementation. Sprint 10A also does not close in this step; certification of Sprint 10A is out of scope for this report.

---

## 1. Documents Reviewed

The full certified corpus was reviewed for identity-relevant, roster-relevant, and display-name-relevant statements, with special attention to:

- `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`
- `LYFELABZ_FIRESTORE_DATA_MODEL.md` (§3.1 users, §3.4 enrollments, §766 personal-data minimization)
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md` (§539, §589, §608)
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `LYFELABZ_PLATFORM_ARCHITECTURE.md` (§229, §612)
- `LMS_INTEGRATION_ARCHITECTURE.md` (§7, §7.5)
- `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`
- `LMS_INTEGRATION_OPERATIONS.md`
- `LMS_EXPERIENCE.md` (§5, §12)
- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-003, PDR-005, PDR-011, PDR-013, PDR-015, PDR-017, PDR-018, PDR-019, PDR-023, PDR-025, PDR-026, PDR-027)
- `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`
- `PLATFORM_STATE_MACHINE.md`
- `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `ASSESSMENT_PIPELINE_SPECIFICATION.md` (§466)
- `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`
- `LYFELABZ_ARCHITECTURE_REVIEW.md` (independent Fable review; primary finding on display-name ownership and circular resolution)
- `SPRINT_9E_PLATFORM_ARCHITECTURE_CERTIFICATION.md`
- `SPRINT_10A_F1_DISTRICT_SECURITY_BOUNDARY_REPORT.md`
- `SPRINT_10A_F2_ASSESSMENT_IMPLEMENTATION_REPORT.md`
- `SPRINT_10A_F3_GOOGLE_CLASSROOM_IMPLEMENTATION_REPORT.md`
- `SPRINT_2_COMPLETION_REPORT.md`, `SPRINT_3_STEP_5_SPECIFICATION.md` (existing self-write allowlist; header truncation bound)
- `SPRINT_HISTORY.md`

Existing implementation surfaces were inspected only to identify canonical naming already in use; nothing was changed.

## 2. Files Created

- `docs/platform/ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md` - The canonical implementation contract for teacher-readable roster display names. Twenty-three sections spanning purpose, scope, authority and precedence, terminology, canonical identity versus display identity, canonical ownership of display names, Firestore ownership model, collection relationships, enrollment and roster resolution, display-name synchronization rules, Google profile interaction, teacher roster behavior, historical consistency expectations, the Cloud Function ownership matrix, Firestore Security Rule expectations, the error contract, required indexes, required emulator tests, required unit tests, audit event requirements, the engineering implementation checklist, explicit non-goals, and open implementation gaps.
- `docs/platform/SPRINT_10A_F4_ROSTER_DISPLAY_NAME_IMPLEMENTATION_REPORT.md` - This report.

## 3. Files Modified

- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` - Added PDR-028 (Roster Display Name Implementation Contract) with ten sub-decisions (a through j), reconciliation notes, anti-decisions, and future reconsideration criteria. Extended the change log with the Sprint 10A F-4 entry.
- `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md` - Prepended a Sprint 10A F-4 Reconciliation Notice ahead of the preserved Sprint 10A F-3, Sprint 10A F-2, Sprint 9A, and Sprint 9C notices. Constrains the writer set and resolver posture for `users/{uid}.displayName`, `enrollments/{enrollmentId}.displayNameOverride`, and roster placeholder documents without changing any document shape.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` - Prepended a Sprint 10A F-4 Reconciliation Notice ahead of the preserved Sprint 10A F-3, Sprint 10A F-2, and Sprint 9A/9C notices. Names the canonical display-name callables and points identity/enrollment/LMS callables at the implementation contract's ownership matrix.
- `docs/platform/IDENTITY_AND_ONBOARDING_SPECIFICATION.md` - Prepended a Sprint 10A F-4 Reconciliation Notice ahead of the preserved Sprint 9D notice. Identity, provisioning, roster authority, and roster placeholder rules remain authoritative here; display-name implementation questions route to the new contract.
- `docs/platform/LMS_INTEGRATION_ARCHITECTURE.md` - Prepended a Sprint 10A F-4 Reconciliation Notice ahead of the preserved Sprint 10A F-3 and Sprint 9C notices. LMS-reported display names are constrained to placeholder writes; every load-bearing decision in the architecture is preserved.
- `docs/platform/LMS_EXPERIENCE.md` - Prepended a Sprint 10A F-4 Reconciliation Notice ahead of the preserved Sprint 10A F-3 and Sprint 9D notices. Teacher-facing refresh confirmation surfaces and per-class override language remain authoritative here.

## 4. Canonical Decisions Established

The following implementation authorities are canonical in `ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md` and anchored by PDR-028:

1. `users/{uid}.displayName` is the sole canonical display name for a signed-in person. No other collection duplicates it. No security rule and no callable branches on a display-name value. (§5, §6)
2. `enrollments/{enrollmentId}.displayNameOverride` is the sole authorized per-class presentation override. It never propagates to `users/{uid}.displayName`, never propagates to another enrollment, and never becomes the canonical display name. (§6, §8)
3. The roster placeholder name is not a display name for a LyfeLabz identity. It is written only by `lmsClassImport` (import) and `lmsClassRefresh` (confirmed refresh delta), and is retired at placeholder resolution. (§7.1, §11)
4. The teacher-facing roster resolver is a single canonical function: per-class override, then resolved `users/{uid}.displayName`, then placeholder name, then `null`. No teacher surface concatenates a name from any other source. (§9, §12)
5. The Google profile display name is a source only at first sign-in (`authOnUserCreate`). LyfeLabz MUST NOT read the Google profile display name into any canonical field afterwards. (§10.4, §11)
6. The LMS-reported display name never overwrites `users/{uid}.displayName` for a resolved enrollment. LMS refresh applies confirmed name-change deltas to placeholders only; overriding a resolved enrollment's rendered name is an explicit per-class teacher gesture. (§10.5)
7. A single shared normalizer validates every display-name write (trim, whitespace collapse, empty and length refusal, disallowed characters). No callable inlines its own validator. (§13.1)
8. Attempts, sessions, submissions, rollups, classes, and assignments MUST NOT carry a denormalized display-name copy. (§6, §13)
9. Every callable also satisfies the district enforcement contract in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12. Cross-district and cross-class display-name reads are refused. (§15)
10. The audit vocabulary is fixed: `users.displayNameChanged`, `enrollments.displayNameOverrideChanged`, `roster.placeholderNameChanged`, `roster.placeholderResolved`. No second audit sink is created. (§20)

## 5. Reconciliation Results

- `LYFELABZ_PLATFORM_DECISIONS.md`: PDR-028 added. Change log extended. No prior PDR was retired.
- `LYFELABZ_FIRESTORE_DATA_MODEL.md`: Sprint 10A F-4 Reconciliation Notice prepended. No document shape was changed; the writer set and resolver posture for `users/{uid}.displayName`, `enrollments/{enrollmentId}.displayNameOverride`, and roster placeholder documents are further constrained by the implementation contract's ownership matrix (§6) and resolver rule (§9).
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`: Sprint 10A F-4 Reconciliation Notice prepended. The Sprint 10A F-3, Sprint 10A F-2, and Sprint 9A/9C notices are preserved. No callable definition in Appendix A was changed by this notice; actual callable landings occur in the implementation sprint that follows Sprint 10A.
- `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`: Sprint 10A F-4 Reconciliation Notice prepended. The Sprint 9D notice is preserved. Identity, provisioning, roster authority, roster placeholder lifecycle, and the authenticated experience shell remain authoritative here.
- `LMS_INTEGRATION_ARCHITECTURE.md`: Sprint 10A F-4 Reconciliation Notice prepended. The Sprint 10A F-3 and Sprint 9C notices are preserved. Every load-bearing decision in the architecture is preserved; LMS-reported display-name writes are constrained to placeholders only.
- `LMS_EXPERIENCE.md`: Sprint 10A F-4 Reconciliation Notice prepended. The Sprint 10A F-3 and Sprint 9D notices are preserved. Teacher-facing refresh confirmation language and per-class override language remain authoritative here.
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md`: Not modified. Its existing statements that "a public display name is not an identity" and that identity is the anchor to which permissions attach continue to apply. The implementation contract's §15 supersedes finer-grained rule invariants and MUST be applied in the implementation sprint.
- `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md`: Not modified. Its existing display-name-adjacent indexes (`(schoolId, role, displayName asc)`; client-side sort of rosters) are preserved. The implementation contract records no new required composite index against `users` or `enrollments` for the display-name path; any placeholder-listing index is enumerated as an operational appendix in the sprint that chooses the placeholder shape.
- `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`: Not modified. The Sprint sequence for roster reconciliation remains authoritative; the implementation contract records only the display-name responsibilities of the callables it lands.
- `LMS_INTEGRATION_OPERATIONS.md`: Not modified. Operational readiness continues to apply; runbook additions for display-name-related migrations are enumerated in the implementation contract's checklist (§21) and land in a later sprint.
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`: Not modified. Its personal-data minimization boundary (attempts carry `studentId`, not display names) is cited by the implementation contract without amendment.
- `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`: Not modified. Its §12 (callable requirements) and §17 (cross-district read refusal) are cited by the implementation contract without amendment.
- `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`: Not modified. Its §8.2 (no student identifier in the deep-link URL) is cited to record that Google Classroom is not a display-name authority for LyfeLabz.
- `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`: Not modified. Its student assignment and results experience and its teacher workspace philosophy remain authoritative.
- `LYFELABZ_PLATFORM_ARCHITECTURE.md`: Not modified. Its §229 statement that each user has a role, a display name, and a school affiliation continues to apply; the implementation contract further constrains where the display name is written and read.

## 6. Circular-Reference Elimination

The independent Fable review recorded that the "authoritative" answer for a display name a teacher reads on a roster was not uniformly named. The implementation contract eliminates the circular reference by making three ownership claims exactly once:

1. **Canonical ownership.** `users/{uid}.displayName` is the sole canonical display name for a signed-in person, stated exactly once in `ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md` §6.
2. **Per-class presentation.** `enrollments/{enrollmentId}.displayNameOverride` is the sole per-class presentation override, stated exactly once in §6, and cannot ever become the canonical display name.
3. **Pre-identity placeholder.** The roster placeholder name is the teacher-readable name for a not-yet-resolved LMS roster entry only, stated exactly once in §6 and §11, and is retired at placeholder resolution.

The resolver in §9 is the single consumer that composes these three sources into a per-enrollment name. No document in the corpus other than `ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md` §9 defines the composition. Every prior reconciled document has been updated to point at the new contract for the composition rule.

## 7. Remaining Gaps

Enumerated as open implementation gaps in `ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md` §23:

- **G-10A-14.** Convergence on `usersUpdateProfile` versus the Sprint 2 rules-allowlisted self-write plus `usersOnDisplayNameChange`. The implementation sprint MUST choose one and record the choice.
- **G-10A-15.** Roster placeholder shape (enrollment-as-placeholder versus separate `rosterPlaceholders/*`). The implementation sprint MUST choose one and record the choice; safe default is enrollment-as-placeholder.
- **G-10A-16.** Display-name length bound tuning. The 60 code-point default may be finalized in the implementation sprint under a §13.1 tuning permission; any change above 200 code points requires a new PDR.
- **G-10A-17.** Google profile re-read policy. No periodic re-read is authorized; a user-initiated "refresh from Google" gesture is a future capability under an explicit user confirmation.
- **G-10A-18.** Audit-event payload retention window for display-name transitions. Follows PDR-011 and `LYFELABZ_FIRESTORE_DATA_MODEL.md` §3.8 by default; any compliance-driven change requires the ratifying sprint to amend the contract.

None is blocking under the safe defaults recorded in the contract.

## 8. Implementation Blockers

None. The implementation sprint that lands the display-name callables can proceed against `ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md`, `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`, and `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` without further architectural work.

## 9. Validation Performed

- No em dash appears in any created or modified document.
- Canonical ownership of display names is unambiguous: `users/{uid}.displayName` is the sole canonical display name; `enrollments/{enrollmentId}.displayNameOverride` is the sole per-class override; the roster placeholder name is a pre-identity concept only.
- The teacher-facing roster resolver is defined exactly once (`ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md` §9).
- No circular ownership reference remains. The three ownership claims are each stated exactly once and are not restated in any of the reconciled documents; the reconciled documents point at the implementation contract instead.
- Firestore ownership is defined exactly once (`ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md` §7).
- Cloud Function ownership is defined exactly once (`ROSTER_DISPLAY_NAME_IMPLEMENTATION_CONTRACT.md` §14).
- District security references `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` (PDR-025); assessment references `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (PDR-026); Google Classroom references `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` (PDR-027).
- No implementation code was modified.
- No Firestore Rules were modified.
- No Cloud Function source was modified.
- No test file was modified.
- No configuration or deployment file was modified.
- No commits were made.

## 10. Repository Status

- Preservation mode intact.
- Repository Hardening posture intact.
- No runtime behavior changed.
- Sprint 10A remains open. F-4 is complete. Certification of Sprint 10A is out of scope for this report.
