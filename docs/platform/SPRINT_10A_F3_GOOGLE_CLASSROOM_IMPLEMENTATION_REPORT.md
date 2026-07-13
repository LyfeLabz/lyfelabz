# Sprint 10A Step F-3 Reconciliation Report

**Status:** Reconciliation report for Sprint 10A step F-3 (Google Classroom Deep-Link Implementation Contract). Architecture-only step. No implementation code, no Firestore Rules, no Cloud Functions, no configuration, and no tests were modified. No commits were made.
**Date:** 2026-07-12
**Scope:** Documentation and architecture reconciliation only. F-3 addresses the third primary finding from the Sprint 9E independent architecture review by translating the certified Google Classroom integration into a single implementation contract for deep-link resolution, assignment resolution, URL contracts, security boundaries, and multiple-class publication behavior.

Sprint 10A F-3 does not begin implementation. Sprint 10A also does not close in this step; further steps beyond F-3 are out of scope for this report.

---

## 1. Documents Reviewed

The full certified corpus was reviewed for LMS-relevant and Google Classroom-relevant statements, with special attention to:

- `LMS_INTEGRATION_ARCHITECTURE.md`
- `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`
- `LMS_INTEGRATION_OPERATIONS.md`
- `LMS_EXPERIENCE.md`
- `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-005, PDR-010, PDR-011, PDR-012, PDR-013, PDR-017, PDR-018, PDR-019, PDR-020, PDR-023, PDR-024, PDR-025, PDR-026)
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `LYFELABZ_FIRESTORE_DATA_MODEL.md`
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md`
- `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md`
- `ASSIGN_EXPERIENCE.md`
- `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`
- `PLATFORM_OPERATIONS_SPECIFICATION.md`
- `PLATFORM_CONTRACTS.md`
- `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`
- `LYFELABZ_PLATFORM_ARCHITECTURE.md`
- `SPRINT_9E_PLATFORM_ARCHITECTURE_CERTIFICATION.md`
- `LYFELABZ_ARCHITECTURE_REVIEW.md` (independent Fable review)
- `SPRINT_10A_F1_DISTRICT_SECURITY_BOUNDARY_REPORT.md`
- `SPRINT_10A_F2_ASSESSMENT_IMPLEMENTATION_REPORT.md`
- `SPRINT_HISTORY.md`

Existing implementation surfaces were inspected only to identify canonical naming already in use; nothing was changed.

## 2. Files Created

- `docs/platform/GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` - The canonical implementation contract for Google Classroom deep-link resolution, assignment resolution, URL contracts, security boundaries, publication behavior, and Cloud Function ownership. Twenty-eight sections spanning purpose, scope, authority and precedence, terminology, external provider model, canonical assignment identity, external assignment identity, the deep-link URL contract, client storage and session handling for arrivals, link resolution lifecycle, assignment publication lifecycle, canonical publication identifiers, Firestore ownership expectations, multiple-class publication behavior, multiple-teacher publication behavior, Classroom synchronization ownership, the Cloud Function ownership matrix, interaction with refresh/unlink/broken-link states, security boundaries, district enforcement expectations, the error contract, required indexes, audit event requirements, required emulator tests, required unit tests, the engineering implementation checklist, explicit non-goals, and open implementation gaps.
- `docs/platform/SPRINT_10A_F3_GOOGLE_CLASSROOM_IMPLEMENTATION_REPORT.md` - This report.

## 3. Files Modified

- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` - Added PDR-027 (Google Classroom Deep-Link Implementation Contract) with ten sub-decisions (a through j), reconciliation notes, anti-decisions, and future reconsideration criteria. Extended the change log with the Sprint 10A F-3 entry.
- `docs/platform/LMS_INTEGRATION_ARCHITECTURE.md` - Prepended a Sprint 10A F-3 Reconciliation Notice ahead of the preserved Sprint 9C notice. The notice points at the new implementation contract and preserves every load-bearing decision in this architecture without amendment.
- `docs/platform/LMS_EXPERIENCE.md` - Prepended a Sprint 10A F-3 Reconciliation Notice ahead of the preserved Sprint 9D notice. Teacher-facing surfaces, error messages, and product principles remain authoritative here; implementation questions route to the new contract.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` - Prepended a Sprint 10A F-3 Reconciliation Notice ahead of the preserved Sprint 10A F-2 and Sprint 9A notices. The notice names the canonical publication and resolution callables and points the "LyfeLabz-to-LMS assignment publication" server responsibility at the new contract. Older text is preserved.
- `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md` - Prepended a Sprint 10A F-3 Reconciliation Notice ahead of the preserved Sprint 10A F-2 and Sprint 9A notices. The notice constrains the identifier construction, writer set, and district-tagging of `lmsAssignmentPublications/*` and the `assignments/{assignmentId}.lmsPublicationRef` field without changing any document shape.
- `docs/platform/PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md` - Prepended a Sprint 10A F-3 Reconciliation Notice ahead of §0. The notice points implementation questions about §5 (Google Classroom Integration Philosophy) and PDR-024f/g/h at the new contract. Product philosophy in §5 remains authoritative.

## 4. Implementation Contracts Established

The following implementation authorities are canonical in `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` and anchored by PDR-027:

1. The deep-link URL shape `https://lyfelabz.com/app/a/{assignmentId}` is the sole authorized Classroom coursework link material. The URL never carries a token, session identifier, student identifier, score, answer-key excerpt, or Classroom coursework identifier. (§8)
2. The canonical LyfeLabz `assignmentId` is the load-bearing authorization key at deep-link arrival time. Classroom coursework identifiers are recorded for reconciliation only. (§6, §7)
3. `lmsAssignmentPublish` is the sole writer of `lmsAssignmentPublications/*` and of `assignments/{assignmentId}.lmsPublicationRef`. Its transaction is atomic; a failed Classroom write leaves no publication document. Idempotency is enforced by a client-supplied marker AND a deterministic identifier. (§11, §12, §13, §17)
4. `lmsDeepLinkResolve` is a read-only resolver. It never writes to `assessmentSessions/*`, `attempts/*`, `assignments/*`, `lmsAssignmentPublications/*`, or `lmsClassLinks/*`. It never calls Google Classroom. Session creation remains the sole responsibility of `assessmentSessionsBegin`. (§10, §17)
5. Fan-out publication is per (assignment, class). Each target succeeds or fails independently. The deterministic identifier construction refuses a second publication of the same LyfeLabz assignment against the same Classroom course. (§14)
6. LyfeLabz enforces a single teacher-of-record per LyfeLabz class. Classroom co-teachers do not authorize LyfeLabz publication. Ownership drift refuses publication and marks the link stale; LyfeLabz never silently reassigns class ownership. (§15)
7. Classroom synchronization is bounded to: list courses, read rosters (read-only), create one coursework record per publication, and (in future scope) refresh rosters, detect broken links, detect ownership drift, and unpublish. LyfeLabz never posts to the class stream, comments, messages, grades, edits published coursework, deletes Classroom state, or reads non-LyfeLabz content. (§16)
8. Every callable in this contract also satisfies the district enforcement contract in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12. Cross-district publications and cross-district resolutions are refused. Every publication document carries `districtId`. (§20)
9. The audit vocabulary is fixed: `lms.assignmentPublished`, `lms.publishFailed`, `lms.deepLinkResolved`, `lms.ownershipDrift`, and (reserved for future unpublish) `lms.assignmentUnpublished`. No second audit sink is created. (§23)
10. A canonical error identifier set is defined for publication and resolution failures, aligned with the district and assessment contracts' error identifiers where they overlap. (§21)
11. Composite indexes are enumerated per collection and reconciled with `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md`. (§22)

## 5. Reconciliation Results

- `LYFELABZ_PLATFORM_DECISIONS.md`: PDR-027 added. Change log extended. No prior PDR was retired.
- `LMS_INTEGRATION_ARCHITECTURE.md`: Sprint 10A F-3 Reconciliation Notice prepended. Every load-bearing decision in the architecture (complement not replace, authority boundaries, manual-first, one-way publication, server-only tokens, no new roles, vendor-neutral core) is preserved without amendment.
- `LMS_EXPERIENCE.md`: Sprint 10A F-3 Reconciliation Notice prepended. Teacher-facing surfaces, error messages, and product principles remain authoritative here.
- `LMS_INTEGRATION_ARCHITECTURE_AMENDMENT.md`: Not modified. The amendment set's ratification posture and its Sprint B/C/D/E/F sprint sequence remain authoritative. The implementation contract does not amend the amendment; it implements the LMS Sprint D and (in resolution scope) LMS Sprint B/C boundary surfaces.
- `LMS_INTEGRATION_OPERATIONS.md`: Not modified. The runbook continues to describe operational readiness for the initial scope. Future publication-related runbook procedures (rollback, unpublish, coursework-deleted-upstream reconciliation) are enumerated in the implementation contract's checklist (§26) and land in a later sprint.
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`: Sprint 10A F-3 Reconciliation Notice prepended. The Sprint 10A F-2 and Sprint 9A notices are preserved. No callable definition in Appendix A was changed by this notice; the actual callable landings occur in the implementation sprint that follows Sprint 10A.
- `LYFELABZ_FIRESTORE_DATA_MODEL.md`: Sprint 10A F-3 Reconciliation Notice prepended. The Sprint 10A F-2 and Sprint 9A notices are preserved. No document shape was changed; the additive `lmsAssignmentPublications` collection and `lmsPublicationRef` field retain the shapes named in §2.9 and §3.6 and are further constrained by the implementation contract's identifier construction and writer set.
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md`: Not modified. Its existing statement that `lmsAssignmentPublications/{publicationId}` is readable only by the teacher who initiated the publication and by Platform Administrator under audit continues to apply. The implementation contract's §13 and §19 supersede finer-grained rule invariants and MUST be applied in the implementation sprint.
- `LYFELABZ_FIRESTORE_QUERY_AND_INDEX_STRATEGY.md`: Not modified. Its existing index enumerations are preserved; the additional indexes in `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` §22 augment them and MUST be applied in the implementation sprint.
- `ASSIGN_EXPERIENCE.md`: Not modified. Its one-dialog rule, the per-class row shape, and the confirmation surface for publication remain authoritative. The implementation contract records only per-callable independence for fan-out targets.
- `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`: Sprint 10A F-3 Reconciliation Notice prepended. §5 (Google Classroom Integration Philosophy) remains authoritative for product behavior.
- `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`: Not modified. Its §12 (callable requirements), §16 (audit events), and §17 (error identifiers) are cited by the implementation contract without amendment.
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`: Not modified. Its §15 (answer key ownership), §21 (Cloud Function ownership matrix), and §25 (error contract) are cited by the implementation contract without amendment. `lmsDeepLinkResolve` is bounded so it never touches session, attempt, or answer-key state.

## 6. Remaining Gaps

Enumerated as open implementation gaps in `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` §28:

- **G-10A-9.** Unpublish callable ratification. `lmsAssignmentUnpublish` is a reserved slot until a superseding sprint authors its transaction.
- **G-10A-10.** Coursework-deleted-upstream reconciliation. A periodic sweep is deferred; a bounded teacher-initiated reconciliation gesture is optional in the initial implementation.
- **G-10A-11.** Coursework metadata beyond title and topic. The exact `courses.courseWork.create` payload (points, assigneeMode, published state) MUST be recorded in an operational appendix during the implementation sprint.
- **G-10A-12.** Assignment Dialog per-target failure surface. The visual treatment is owned by `ASSIGN_EXPERIENCE.md` and `LMS_EXPERIENCE.md` §14; only per-callable independence is fixed here.
- **G-10A-13.** Deep-link URL rotation. Not authorized in the certified architecture; a future superseding decision is required to introduce it.

None is blocking under the safe defaults recorded in the contract.

## 7. Implementation Blockers

None. The implementation sprint that lands the deep-link and publication paths can proceed against `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`, `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md`, and `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` without further architectural work.

## 8. Validation Performed

- No em dash appears in any created or modified document.
- Deep-link ownership is unambiguous: LyfeLabz owns the URL shape; only `lmsAssignmentPublish` emits it into Classroom; only `lmsDeepLinkResolve` interprets it at arrival.
- Assignment ownership is unambiguous: `assignments/{assignmentId}` remains the authoritative record; only `lmsPublicationRef` is written by the publication callable; no Classroom identifier is ever an authorization key.
- Classroom never becomes the source of truth: activation, sessions, attempts, rollups, and answer keys are untouched by the deep-link and publication callables.
- District enforcement is stated as additive and references `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` §12, §16, and §17 (PDR-025).
- Assessment references cite `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §15, §21, and §25 (PDR-026) and preserve the boundary that only `assessmentSessionsBegin` creates sessions and only `assessmentAttemptsFinalize` writes attempts.
- No implementation code was modified.
- No Firestore Rules were modified.
- No Cloud Function source was modified.
- No test file was modified.
- No configuration or deployment file was modified.
- No commits were made.

## 9. Repository Status

- Preservation mode intact.
- Repository Hardening posture intact.
- No runtime behavior changed.
- Sprint 10A remains open. F-3 is complete. Further steps beyond F-3 are out of scope for this report.
