# Sprint 9C Reconciliation Report

**Status:** Reconciliation report for Sprint 9C - Architecture Decision Workshop (Identity and Onboarding).
**Date:** 2026-07-12
**Scope:** Documentation and architecture reconciliation only. No implementation code, no Firebase configuration, no application code changed.

Sprint 9C ratified the LyfeLabz identity and onboarding architecture. This report records the documentation work that translated the ratified architecture into the certified documentation set. The authoritative source of the ratified architecture is `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` and PDR-023.

Sprint 9C did not find a prior document suitable to elevate into the canonical role. `LYFELABZ_SPRINT_2_ONBOARDING_AND_VERIFICATION.md` is an implementation-scoped Sprint 2 specification, not a canonical identity architecture. PDR-003 is verification-scoped. The Platform Domain Model treats District as a "Future" entity. Sprint 9C therefore created `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` as a new canonical document and reconciled every affected certified document to defer to it.

---

## 1. Files Created

- `docs/platform/IDENTITY_AND_ONBOARDING_SPECIFICATION.md` - The new canonical specification for LyfeLabz identity behavior. Written from scratch as a professional architecture document. Twenty-six sections spanning identity philosophy, authentication vs authorization, identity architecture, teacher identity, student identity, district architecture, school architecture, class architecture, roster authority, Google Classroom integration, manual class creation, join code architecture, teacher verification, teacher onboarding, student onboarding, first sign-in activation, identity matching, student transfers, teacher lifecycle, identity states, identity race conditions, the global header and authentication experience, identity principles, relationship to prior architecture, change discipline, and change log. This document is the single source of truth for LyfeLabz identity, onboarding, verification, roster authority, and the authenticated experience shell.
- `docs/platform/SPRINT_9C_RECONCILIATION_REPORT.md` - This report.

## 2. Files Modified

- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` - Added PDR-023 (Identity and Onboarding Architecture) with fifteen sub-decisions (a through o). Added a Sprint 9C Reconciliation Notice to PDR-003 retiring the maintained verified-domain automated verification path in favor of the verification-code path with the Request Teacher Access fallback. Added a Sprint 9C Reconciliation Notice to PDR-015 promoting the District entity from reachable expansion to a first-class security boundary. Extended the change log.
- `docs/platform/LYFELABZ_PLATFORM_ARCHITECTURE.md` - Prepended a Sprint 9C Reconciliation Notice superseding identity, onboarding, verification, roster authority, and authenticated-experience-shell content in favor of `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` and PDR-023. Summarized the load-bearing changes a reader must apply while reading downstream sections.
- `docs/platform/LYFELABZ_PLATFORM_DOMAIN_MODEL.md` - Prepended a Sprint 9C Reconciliation Notice promoting District to a first-class entity, documenting teacher district-binding and multi-school membership, introducing the class-level roster authority and roster placeholder, and codifying that student identities are created only at first successful Google sign-in.
- `docs/platform/LYFELABZ_FIRESTORE_DATA_MODEL.md` - Prepended a Sprint 9C Reconciliation Notice requiring `districtId` on schools and on active identities, adding roster placeholder shape guidance, restricting join-code storage to manual classes, adding the `rosterAuthority` class attribute, expressing teacher multi-school membership on the identity record, and marking verification-code storage as server-only.
- `docs/platform/LYFELABZ_FIREBASE_SECURITY_MODEL.md` - Prepended a Sprint 9C Reconciliation Notice requiring district scoping on cross-user rules, adding roster placeholder read semantics, keeping join-code and verification-code redemption server-only, refusing join-code redemption against LMS-linked classes, and requiring `active` status for teacher-role capability rules.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` - Prepended a Sprint 9C Reconciliation Notice adding the verification-code redemption callable, the join-code redemption callable, and the first-sign-in activation callable. Promoted `districtId` from a reserved claim slot to a claim written on every active identity.
- `docs/platform/LYFELABZ_SPRINT_2_ONBOARDING_AND_VERIFICATION.md` - Prepended a Sprint 9C Reconciliation Notice preserving Sprint 2 deliverables while reconciling Section 4.3 (verified school domain storage), Section 4.4 (custom claims), Section 6 (rules), and Section 7 (callables) with PDR-023 and the specification.
- `docs/platform/PLATFORM_STATE_MACHINE.md` - Prepended a Sprint 9C Reconciliation Notice clarifying that `awaitingFirstSignIn` is a roster-level state, not a user-level state, and that no new `users/{uid}` state is introduced. Teacher verification transitions are unchanged.
- `docs/platform/PLATFORM_CONTRACTS.md` - Prepended a Sprint 9C Reconciliation Notice extending client storage prohibitions to identity resolution, roster placeholder state, verification-code payloads, and join-code payloads. Reasserted that activation state is never conveyed by color alone. Reasserted the global header contract.
- `docs/platform/LMS_INTEGRATION_ARCHITECTURE.md` - Prepended a Sprint 9C Reconciliation Notice restating roster authority as one-per-class, restating identity matching as Google Classroom User ID primary and email secondary, adding roster placeholder semantics, and enforcing the district boundary at LMS operations.
- `docs/platform/TEACHER_JOURNEY.md` - Prepended a Sprint 9C Reconciliation Notice codifying class creation in the `Classes` workspace, the Google Classroom preference, the verification-code preference, the invisibility of completed verification, and the uniform global header.
- `docs/platform/TEACHER_EXPERIENCE_PHILOSOPHY.md` - Prepended a Sprint 9C Reconciliation Notice restating class creation location, verification invisibility, and the global header contract.
- `docs/platform/LYFELABZ_ENGINEERING_STANDARDS.md` - Added a Sprint 9C Reconciliation Notice enumerating the engineering obligations that follow from PDR-023 - server-authoritative identity operations, atomic and idempotent callables, claim shape, roster placeholder placement, join-code and verification-code protection, cross-district refusal, the global header layout obligation, and storage prohibitions.
- `docs/platform/PLATFORM_OPERATIONS_SPECIFICATION.md` - Amended Section 17 (Authentication Session Policy) to clarify the distinction between identity persistence and authentication session persistence and to point at the specification for return-to-location behavior.

## 3. Summary of Architectural Changes

Sprint 9C ratified fifteen load-bearing identity decisions and a body of supporting behavior.

1. **Authentication is not authorization.** Google Workspace authenticates; the platform authorizes through canonical claims (`role`, `schoolId`, `districtId`). Claims are written only when `status` is `active`.
2. **Two identity families.** Teacher identities and student identities follow distinct provisioning, verification, and lifecycle rules and never silently become one another.
3. **District is a first-class security boundary.** `Platform → District → School → Teacher Identity → Class → Enrollment` is now the certified hierarchy. Cross-district reads and writes are refused.
4. **Teacher identity is district-bound.** Changing districts creates a new LyfeLabz teacher identity. Within a district, a teacher may be authorized for multiple schools.
5. **Permanent LyfeLabz Student ID.** Student identity is authoritative, permanent within its district, and independent of the authentication provider.
6. **Roster import does not create student identities.** Student identities are created only at first successful Google sign-in. Roster placeholders in the `awaitingFirstSignIn` state exist on the class until then.
7. **Server-authoritative identity matching.** Google Classroom User ID is the primary matching key; email is the secondary validator. Students never resolve identity ambiguity by hand.
8. **One roster authority per class.** Google Classroom for LMS-linked classes; LyfeLabz for manual classes. Hybrid authority is refused.
9. **Google Classroom is the preferred onboarding path.** Teachers who use Google Classroom never maintain duplicate rosters.
10. **Manual class creation with server-generated join codes.** Codes are unique, revocable, replaceable, disabled after archive, never anonymous, and refused against LMS-linked classes.
11. **Teacher verification prefers a one-time institution-bound verification code.** The Request Teacher Access workflow is the fallback. The maintained verified-domain automated path is retired.
12. **Verification is invisible after completion.** No residual verification chrome in the verified teacher's ordinary workflow.
13. **Identity operations are atomic and idempotent.** No duplicate identities, enrollments, activations, or verifications may be produced under any race.
14. **Uniform global header.** `LYFELABZ` wordmark on the far left; identity control on the upper right; hamburger menu on the far right; identity is never hidden inside the hamburger menu.
15. **Authentication becomes required only when a capability depends on identity.** After sign-in, users return to the exact location they were using.

## 4. Contradictions Resolved

- **PDR-003 named a maintained verified-domain list as the automated verification path.** Resolved by superseding PDR-003 with the verification-code preferred path and the Request Teacher Access fallback (PDR-023k, `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §13). The domain-list mechanism is retired. Sprint 2 §4.3, which had already deferred the domain list, is preserved.
- **Domain Model treated District as `Future`.** Resolved by promoting District to a first-class, load-bearing entity through PDR-015's Sprint 9C notice and PDR-023c. The Domain Model reconciliation notice records the promotion.
- **Domain Model implied a Teacher belongs to exactly one School.** Resolved by codifying that a teacher identity may hold explicit membership in multiple schools within the same district, expressed as an authorized set on the identity record.
- **Domain Model treated Join Code as a class-level credential without codifying its exclusivity to manual classes.** Resolved by codifying that join codes exist only for manual classes and are refused against LMS-linked classes (`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §9, §12).
- **Prior product narratives placed class creation in Settings.** Resolved by codifying that class creation lives in the `Classes` workspace under `+ Add Class` with exactly two options: Import from Google Classroom or Create Class Manually. `TEACHER_JOURNEY.md` and `TEACHER_EXPERIENCE_PHILOSOPHY.md` reconciliation notices record this.
- **Sprint 2 §4.4 documented `districtId` as a reserved slot without a write path.** Resolved by promoting `districtId` to a claim written on every active identity in the Sprint 9C Cloud Function Charter notice, without changing the canonical claim shape.
- **The Domain Model did not codify the `awaitingFirstSignIn` roster placeholder state.** Resolved by introducing it as a roster-level state (not a `users/{uid}` state) and describing its atomic activation on first successful Google sign-in.
- **Prior documents did not codify identity matching as strictly server-authoritative.** Resolved by naming Google Classroom User ID as the primary matching key and email as the secondary validator, and by prohibiting student manual identity picks.
- **The global header layout was not codified as a repository-wide contract.** Resolved by naming its layout, the identity control's placement, and the surfaces to which it applies (`IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §22). Present Mode remains the sole exception under PDR-018b.
- **Prior documents ambiguously described return-to-location after sign-in.** Resolved by codifying that users return to the exact location they were using.

## 5. Identity Implications

- **Firestore reference changes.** Every `schools/{schoolId}` document is expected to carry a required `districtId`. Every `active` `users/{uid}` document is expected to carry a `districtId`. Future implementation sprints are responsible for the concrete schema change and any migration semantics.
- **Custom claims write path.** The canonical claims helper (Sprint 2 §4.4) writes `role`, `schoolId`, and `districtId` on every active identity. Sprint 2 rules keyed by `schoolId` gain a `districtId` scoping predicate.
- **New callable surfaces.** A verification-code redemption callable, a join-code redemption callable, and a first-sign-in activation callable enter the identity-onboarding callable surface. Each is atomic, idempotent, and refuses cross-district operations.
- **Security rule scope changes.** Cross-user rules require district-scoping. Roster placeholder documents are readable by the owning teacher and unwriteable by clients. Verification-code state is default-deny for all client roles.
- **Roster placeholder collection.** A collection or per-class subcollection representing roster placeholders is required. Its concrete shape is a future implementation deliverable.
- **Class attribute additions.** A canonical `rosterAuthority` (`google_classroom` or `lyfelabz`) is required at the class level. A canonical enrollment-source attribute distinguishes join-code redemption from LMS-mediated enrollment.
- **Teacher identity shape.** A teacher `users/{uid}` document must express authorized `schoolIds` within its `districtId`, and the `schoolId` claim reflects the currently active membership.
- **Global header implementation.** New surfaces must implement the header layout defined in `IDENTITY_AND_ONBOARDING_SPECIFICATION.md` §22. Present Mode remains the sole exception.
- **Sign-in-required boundaries.** Anonymous exploration remains permitted on the homepage, on public curriculum, and on any surface that does not depend on identity. Recording an attempt, entering the Teacher Workspace, entering the Student Workspace, and accessing assignments require authentication.
- **Return-to-location contract.** Sign-in flows must preserve return-to-location across the redirect. This is a client obligation.

## 6. Remaining Architectural Questions

Sprint 9C closed the questions it was chartered to close. The following identity questions are open by design and are named here so that no future sprint mistakes them for gaps in the specification.

1. **School administrator role.** PDR-004's closed role set anticipates a School Administrator role. Its concrete shape, its verification-code issuance authority, and its cross-teacher visibility surface remain deferred to a subsequent PDR.
2. **Cross-district identity linking.** Manual, Platform-Administrator-mediated cross-district identity views may be introduced later. Any such capability is a subsequent PDR that must preserve the district boundary (PDR-023c and PDR-023d).
3. **Parent role.** The Parent entity remains reachable-but-deferred per the Domain Model. Its identity model, its authentication surface, and its relationship contract with a Student identity are out of scope for Sprint 9C.
4. **Additional authentication providers.** Adding a non-Google provider requires a subsequent PDR that preserves the two-layered rule (specification §3) and the LyfeLabz Student ID authority (specification §5).
5. **Automatic Google Classroom roster synchronization.** PDR-019c's manual-first posture remains load-bearing. Automatic synchronization requires an amendment to `LMS_INTEGRATION_ARCHITECTURE.md` and must preserve one-roster-authority (PDR-023h).
6. **Verification-code issuance UI for school administrators.** The specification names Platform Administrators and authorized school administrators as the issuing parties. The concrete school-administrator issuance UI is deferred to the school-administrator sprint.
7. **Suspension, reinstatement, and archival transitions.** These transitions remain deferred per `PLATFORM_STATE_MACHINE.md` and Sprint 2 §10. They are not re-opened by Sprint 9C.
8. **Multi-account teachers.** A teacher who holds more than one Google Workspace identity continues to hold more than one LyfeLabz teacher identity per PDR-004. Merging identities remains a PDR-004 concern.
9. **Roster placeholder deletion policy.** The rule for removing a roster placeholder that has never activated (student who never signs in) is a roster-authority operational concern that is deferred to the sprint that introduces roster hygiene tooling.

These open questions do not block Sprint 9D. Each is reachable as its own subsequent work item under the ordinary sprint discipline recorded in `LYFELABZ_ENGINEERING_STANDARDS.md`.

---

## Change Log

- 2026-07-12 - Initial Sprint 9C reconciliation report established. Fourteen certified documents modified. Two documents created (specification and this report). PDR-023 added. PDR-003 and PDR-015 amended by Sprint 9C reconciliation notices.
