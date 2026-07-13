# Sprint 10A Step F-1 Reconciliation Report

**Status:** Reconciliation report for Sprint 10A step F-1 (District Security Boundary Implementation Contract). Architecture-only step. No implementation code, no Firestore Rules, no Cloud Functions, no configuration, and no tests were modified. No commits were made.
**Date:** 2026-07-12
**Scope:** Documentation and architecture reconciliation only. F-1 addresses the first primary finding from the Sprint 9E independent architecture review by translating the district enforcement model into a single implementation contract.

Sprint 10A F-1 does not begin implementation. Sprint 10A also does not close in this step; F-2 and any further steps are out of scope for this report.

---

## 1. Files Created

- `docs/platform/DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` - The canonical implementation contract for server-side enforcement of the LyfeLabz district tenancy boundary. Twenty-two sections spanning purpose, scope, authority and precedence, terminology, source-of-truth model, the canonical claim contract, the user activation state machine, teacher verification and district activation, student activation and district assignment, the resource ownership chain, the Firestore Security Rules contract, the Cloud Function enforcement contract, cross-district reference prevention, the district transfer contract, stale claim and session reconciliation, the audit event contract, the error contract, required Firestore Rules tests, required Cloud Function tests, an implementation checklist, explicit non-goals, and open gaps. This document is the single source of truth for district enforcement.
- `docs/platform/SPRINT_10A_F1_DISTRICT_SECURITY_BOUNDARY_REPORT.md` - This report.

## 2. Files Modified

- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` - Added PDR-025 (District Security Boundary Implementation Contract) with eleven sub-decisions (a through k), reconciliation notes, anti-decisions, and future reconsideration criteria. Extended the change log with the Sprint 10A F-1 entry.
- `docs/platform/LYFELABZ_PLATFORM_ARCHITECTURE.md` - Narrow edit to the Sprint 9C Reconciliation Notice bullet on canonical claims. Removed the residual `reserved districtId` phrasing and pointed at `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` and PDR-025.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` - Narrow edit to the canonical custom claims shape bullet on `districtId`. Removed the residual `Not written by Version 1 functions` phrasing and pointed at PDR-025.
- `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md` - Narrow edit to the Sprint 9C Reconciliation Notice bullet on the district security boundary. Removed the parenthetical `reserved by the Cloud Function Charter §2 canonical claim shape` and pointed at PDR-025.
- `docs/platform/LMS_INTEGRATION_ARCHITECTURE.md` - Narrow edit to Section 10.2 (Future Extensibility) bullet on district rollup. Replaced the pre-Sprint-9C statement that the `districtId` slot remains reserved with the current model: LMS integration does not itself assign `districtId`; district ownership is inherited from the school that owns the class.
- `docs/platform/TEACHER_PLATFORM_DOMAIN_ROADMAP.md` - Narrow edits to Section 3.1 (Identity and Access) security-responsibilities and deferred-to-future-sprints bullets. Updated the claim shape to `{ role, schoolId, districtId }` and removed the deferral line that treated `districtId` as future work.

## 3. Documents Reviewed

The full certified corpus was reviewed for district-relevant statements, with special attention to:

- `IDENTITY_AND_ONBOARDING_SPECIFICATION.md`
- `LYFELABZ_PLATFORM_ARCHITECTURE.md`
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md`
- `LYFELABZ_FIRESTORE_DATA_MODEL.md`
- `LYFELABZ_PLATFORM_DECISIONS.md`
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `LYFELABZ_ENGINEERING_STANDARDS.md`
- `LYFELABZ_PLATFORM_DOMAIN_MODEL.md`
- `PLATFORM_OPERATIONS_SPECIFICATION.md`
- `PLATFORM_STATE_MACHINE.md`
- `PLATFORM_CONTRACTS.md`
- `PLATFORM_TRANSITION_AND_PILOT_READINESS_SPECIFICATION.md`
- `LMS_INTEGRATION_ARCHITECTURE.md`
- `TEACHER_PLATFORM_DOMAIN_ROADMAP.md`
- `SPRINT_9E_PLATFORM_ARCHITECTURE_CERTIFICATION.md`
- `LYFELABZ_ARCHITECTURE_REVIEW.md` (independent Fable review)
- `SPRINT_HISTORY.md`

The current implementation surface (Cloud Function source, Firestore Rules) was inspected only to identify canonical naming already in use; nothing was changed.

## 4. Decisions Confirmed

The canonical decisions listed in the sprint charter (Section 4, items 1 through 12) are ratified in `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` and anchored by PDR-025:

1. District membership is server-authoritative (PDR-025b, PDR-025c, PDR-025g).
2. Firestore is the durable source of truth (PDR-025a).
3. Custom claims are server-issued authorization data (PDR-025b, PDR-025c).
4. No partial district activation (PDR-025d).
5. Account state and district state must agree (PDR-025a, PDR-025c, PDR-025d, PDR-025j).
6. Security Rules enforce district isolation (PDR-025e, PDR-025g).
7. Platform administrators are explicitly bounded (PDR-025h).
8. School ownership is subordinate to district ownership (Contract §10, §13; PDR-025g).
9. Class, enrollment, assignment, submission, and audit-event ownership derive from the canonical district boundary (Contract §10, §13; PDR-025e, PDR-025f, PDR-025g).
10. District transfers require an explicit lifecycle transition; the safe default is denial (PDR-025i; Contract §14).
11. Claim refresh and stale-session behavior are deterministic (PDR-025j; Contract §15).
12. Auditability is mandatory (PDR-025k; Contract §16).

## 5. Conflicts Found and Resolved

Five conflicting statements between the certified architecture (post-Sprint 9C) and older documents were identified. Each was resolved with a narrow edit rather than a rewrite.

- `LYFELABZ_PLATFORM_ARCHITECTURE.md` line 40 called `districtId` a reserved claim slot. Reconciled to state the claim is written on every `active` identity and to point at PDR-025.
- `LYFELABZ_CLOUD_FUNCTION_CHARTER.md` line 121 stated `districtId` is not written by Version 1 functions. Reconciled to the current model with a pointer to PDR-025. Older Sprint 6 completion reports that describe the slot as unwritten are historical; they were not modified.
- `LYFELABZ_FIREBASE_SECURITY_MODEL.md` line 18 called the `districtId` claim reserved. Reconciled and pointed at PDR-025.
- `LMS_INTEGRATION_ARCHITECTURE.md` line 330 stated the reserved slot remains reserved and LMS integration does not fill it. Reconciled to state that LMS integration does not itself assign `districtId`; district ownership is inherited from the class's school.
- `TEACHER_PLATFORM_DOMAIN_ROADMAP.md` lines 127 and 136 treated `districtId` as a reserved-only future capability. Reconciled to the current claim shape and removed the deferral bullet.

Ambiguities noted but not requiring an edit in this step (they are resolved inside the new contract itself and do not require changes to prior documents):

- Whether every district-scoped child resource (`classes`, `enrollments`, `assignments`, `submissions`, `auditEvents`) carries a denormalized `districtId` field, or whether rules resolve district through the parent school with a `get()`. The contract permits either strategy but requires that a resource carry the denormalized field if the rule layer needs a single-document read (Contract §10, §11). No prior document is contradicted.
- The concrete audit `action` names for the three Sprint 9C identity callables (verification-code redemption, join-code redemption, first-sign-in activation). The certified architecture defers concrete names to the implementation sprint that introduces them. The contract records the required event categories, actors, targets, and payload fields without inventing names (Contract §16).

## 6. Remaining Gaps

Three narrow gaps remain. None is a blocking gap for implementation.

- **G-10A-1. District document collection.** The certified architecture does not define a `districts/{districtId}` collection. The contract does not require one for district enforcement, because `schools/{schoolId}.districtId` already carries the durable value. A future domain (district-level reporting, district-scoped administration) may require the collection; that sprint amends the Data Model, not this contract.
- **G-10A-2. District transfer callable.** No callable is named for a district transfer. The safe default in Contract §14 is denial of client-driven mutation, with new-identity provisioning per PDR-023d and `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §18. A future PDR is required to authorize a transfer callable.
- **G-10A-3. Platform administrator claim shape.** The claim shape in Contract §6 permits absence-as-sentinel or an explicit sentinel for administrator tokens. The certified architecture does not settle which is canonical. The implementation sprint that lands the claim write path picks one and amends Contract §6.

## 7. Implementation Blockers

None. The claim write path can be implemented against `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md` without inventing platform behavior. The three gaps in Section 6 are either narrow authoritative choices (G-10A-3) or genuinely future work (G-10A-1, G-10A-2).

## 8. Confirmations

- No application source, Cloud Function source, Firestore configuration, Firestore Rules, or emulator configuration was modified.
- No test file was modified.
- No product behavior was redesigned. Sprint 10A F-1 is a documentation reconciliation of the certified architecture into an engineer-facing implementation contract.
- No em dash appears in any created or modified document. A grep for the em-dash character returns zero matches across the files listed in Sections 1 and 2.
- No broken internal Markdown reference was introduced. Every referenced document exists under `docs/platform/`.
- No commits were made. F-2 has not been started.
