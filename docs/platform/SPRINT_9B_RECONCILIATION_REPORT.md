# Sprint 9B Reconciliation Report

**Status:** Reconciliation report for Sprint 9B - Architecture Decision Workshop (Platform Operations).
**Date:** 2026-07-12
**Scope:** Documentation and architecture reconciliation only. No implementation code, no Firebase configuration, no application code changed.

Sprint 9B ratified the LyfeLabz platform operations architecture. This report records the documentation work that translated the ratified architecture into the certified documentation set. The authoritative source of the ratified architecture is `PLATFORM_OPERATIONS_SPECIFICATION.md` and PDR-022.

---

## 1. Files Created

- `docs/platform/PLATFORM_OPERATIONS_SPECIFICATION.md` - The new canonical specification for LyfeLabz operational behavior. Written from scratch as a professional operational architecture document. Twenty-seven sections spanning operational philosophy, production architecture, hosting strategy, migration strategy, canonical production origin, URL strategy, environment architecture, Development, Preview, Production, release pipeline, Certified Releases, production approval, deployment workflow, rollback, maintenance mode, authentication session policy, Present Mode during deployment, operational monitoring, incident response, production health, Pilot Readiness Certification, GitHub Pages retirement, future operational expansion, relationship to prior architecture, change discipline, and change log. This document is the single source of truth for LyfeLabz operational behavior.
- `docs/platform/SPRINT_9B_RECONCILIATION_REPORT.md` - This report.

## 2. Files Modified

- `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` - Added PDR-022 (Platform Operations Architecture) with eleven sub-decisions (a through k). Added a PDR-014 Sprint 9B Reconciliation Notice ratifying Firebase Hosting as the permanent canonical production origin, replacing the Testing environment nomenclature with Preview, and naming Platform Administrator approval as the load-bearing human gate. Extended the change log.
- `docs/platform/LYFELABZ_PLATFORM_ARCHITECTURE.md` - Prepended a Sprint 9B Reconciliation Notice superseding Section 12 (Deployment Strategy) in favor of `PLATFORM_OPERATIONS_SPECIFICATION.md` and PDR-022. Summarized the load-bearing corrections a reader must apply while reading Section 12.
- `docs/platform/LYFELABZ_FIREBASE_BUILD_CHECKLIST.md` - Added a Sprint 9B Reconciliation Notice ratifying Firebase Hosting as the permanent canonical production origin, retiring the "GitHub Pages remains the production website" and "Hosting is initialized but not used for the public site" statements, and updating the pre-production Firebase project name to `lyfelabz-preview`. Amended the canonical configuration checklist and the "Do Not Do Manually" list to reference the release pipeline and the retirement criteria.
- `docs/platform/LMS_INTEGRATION_OPERATIONS.md` - Prepended a Sprint 9B Reconciliation Notice subordinating this runbook to `PLATFORM_OPERATIONS_SPECIFICATION.md` and PDR-022 for hosting, environments, release pipeline, rollback, maintenance mode, authentication session policy, monitoring, incident response, Pilot Readiness Certification, and GitHub Pages retirement.
- `docs/platform/LYFELABZ_ENGINEERING_STANDARDS.md` - Added a Sprint 9B Reconciliation Notice stating that operational behavior is defined by `PLATFORM_OPERATIONS_SPECIFICATION.md` and PDR-022, and enumerating the engineering obligations that follow from Sprint 9B (Preview-before-Production, recorded Platform Administrator approval, Certified Release criteria, rollback discipline, additive schema evolution by default, non-interrupting deployments, and platform-health-only monitoring scope).

## 3. Summary of Architectural Changes

Sprint 9B ratified eleven load-bearing operational decisions and a body of supporting behavior.

1. **Firebase Hosting is the permanent canonical production origin** (`https://lyfelabz.com/`). Public curriculum and the authenticated platform share the origin under path-based routing. Permanent subdomains are not introduced. GitHub Pages is retained only as a migration safety net.
2. **Three permanent environments.** Development (local emulators), Preview (Firebase Hosting Preview Channels of the canonical origin, or a dedicated preview project mirroring production), and Production. No deployment moves from Development to Production without passing through Preview. A future Staging environment is deferred.
3. **Certified Releases require ten criteria.** Architecture certified, documentation reconciled, implementation complete, local verification passed, security verification passed, operational documentation updated, preview deployment verified, Platform Administrator approval recorded, production deployment completed, and post-deployment health verified. Only Certified Releases are valid rollback targets.
4. **Platform Administrator approval is the load-bearing human gate.** Automated tests are required but never replace human approval. Approval is granted for a specific release candidate and is recorded in writing.
5. **Rollback is one action, targets a previous Certified Release, and repairs happen in Preview.** Production is redeployed only after recertification.
6. **Maintenance mode is formal, Platform-Administrator-controlled, and preserves in-progress assessment sessions with no partial attempt records.** Public curriculum remains readable when safe.
7. **Google Authentication uses secure persistent sessions.** Students remain signed in unless they sign out, security requires reauthentication, or session expiration occurs. Authentication sessions are distinct from assessment sessions (PDR-021a).
8. **Production deployments never interrupt active classroom sessions.** Present Mode, assessment sessions, and teacher workflows continue across a deployment. New sessions receive the new release.
9. **Operational monitoring is scoped to platform health.** Authentication, Cloud Functions, assessment scoring, assignments, routing, deployment, rollback, latency, session recovery, and infrastructure are monitored. Student behavioral telemetry beyond platform health is not collected.
10. **Pilot Readiness is a formal, one-time Platform Administrator certification** verifying architecture, security, authentication, teacher and student workflows, the assessment pipeline, Present Mode, deployment, rollback, monitoring, recovery, and operational ownership.
11. **GitHub Pages retirement criteria are twelve, plus a seven-day observation period.** After retirement, Firebase Hosting is the sole production origin. GitHub remains the source repository only.

## 4. Contradictions Resolved

- **"GitHub Pages remains the production website"** (`LYFELABZ_FIREBASE_BUILD_CHECKLIST.md` §1, prior text) - superseded. Firebase Hosting is the permanent canonical production origin (PDR-022a).
- **"Hosting is initialized but not used for the public site"** (`LYFELABZ_FIREBASE_BUILD_CHECKLIST.md` §1, prior text) - superseded. Firebase Hosting serves the canonical origin after Preview and Production certification.
- **"Testing" as the pre-production environment name** (`LYFELABZ_PLATFORM_ARCHITECTURE.md` §12; `LYFELABZ_PLATFORM_DECISIONS.md` PDR-014) - superseded. The certified pre-production environment is **Preview**, backed by Firebase Hosting Preview Channels or a dedicated preview project mirroring production. Preview verification precedes Platform Administrator approval.
- **"Deliberate promotion" as the production gate** (PDR-014) - clarified. The gate is explicit, recorded Platform Administrator approval. Automated tests never replace human approval.
- **Ambiguity about whether small changes may skip Preview** - resolved. No deployment moves directly from Development to Production. Preview is not optional.
- **Ambiguity about rollback target** - resolved. Rollback targets a previous **Certified Release** from Firebase Hosting's release history. Rollback is not a re-deploy of the prior source tree.
- **Ambiguity about deployment during class sessions** - resolved. Production deployments never interrupt active classroom sessions. Mid-class reload prompts are prohibited (PDR-022h).
- **Ambiguity about what "monitoring" means for a classroom product** - resolved. Operational monitoring is scoped to platform health. Adding student behavioral telemetry beyond platform health requires a new PDR (PDR-022i).
- **Absence of a formal Pilot Readiness bar** - resolved. `PLATFORM_OPERATIONS_SPECIFICATION.md` §22 defines a twelve-criterion Platform Administrator certification, higher than a Certified Release.
- **Absence of explicit GitHub Pages retirement criteria** - resolved. `PLATFORM_OPERATIONS_SPECIFICATION.md` §23 defines twelve verification criteria and a seven-day observation period.

## 5. Operational Implications

- **Preview verification is now a load-bearing engineering commitment.** Every change destined for production must be exercised end-to-end in Preview with a synthetic dataset that mirrors production configuration.
- **Documentation reconciliation is part of every Certified Release.** A pull request whose behavior changes an operational contract must also update `PLATFORM_OPERATIONS_SPECIFICATION.md` or a subordinate document in the same release, or the release is not certifiable.
- **Rollback is a first-class operational tool.** Contributors must not treat rollback as failure. A rollback that protects a class period is a success, and the follow-up repair happens in Preview under the same discipline as any other change.
- **Maintenance mode is a documented operational state, not an incident response.** Its entry and exit are recorded. In-progress assessment sessions are preserved across maintenance transitions; no partial attempt records are created.
- **Mid-class reload prompts are prohibited.** Client code must be designed so that a new release is picked up by new sessions, not by a mid-class reload of active tabs.
- **Operational monitoring dashboards must be owned.** Every monitored surface has an alert route and a documented on-call responder before pilot begins.
- **The Firebase build checklist requires updating.** The `lyfelabz-test` project name is retired in favor of `lyfelabz-preview` for the certified pre-production environment. Any existing tooling that references `lyfelabz-test` must be renamed or documented as legacy during the next affected sprint.
- **The Cloud Functions runtime is now on the certified release path from the outset.** Adding a Cloud Functions runtime is a Certified Release event, not a Console action.
- **LMS Integration Operations extends but does not override this specification.** LMS-specific runbooks operate within the boundaries this specification establishes.
- **Sprint 9C will operate under this specification.** Any implementation work that would establish a new operational contract must first amend the specification or a subordinate document.

## 6. Remaining Architectural Questions

The following operational questions are recorded and deferred; they do not block Sprint 9C.

- **Alert thresholds and severity criteria.** Section 19 names monitored surfaces. Specific thresholds and severity criteria are documented outside this specification and will be authored alongside the monitoring configuration during Pilot Readiness rehearsal.
- **Formal feature flag system.** PDR-014 anticipated feature flags at Version 1. `PLATFORM_OPERATIONS_SPECIFICATION.md` §24 records this as an anticipated expansion. A dedicated feature flag PDR will be authored when the first flag-gated rollout is scheduled.
- **Staging environment activation criteria.** Section 24 defers Staging until release cadence or concurrent workstreams justify it. The specific activation criteria are recorded there and are not restated as a separate PDR at this time.
- **Automated production canary.** Section 24 anticipates a future automated safety check. Introduction requires a subsequent PDR.
- **Alert routing and on-call rotation.** Ownership is named in Section 19; specific routing and rotation are recorded operationally and are updated as ownership changes.
- **LMS integration rollout inside the release pipeline.** `LMS_INTEGRATION_OPERATIONS.md` remains the LMS-specific extension; sequencing of LMS integration rollout inside the Sprint 9C+ release pipeline is a coordination question, not an architectural one.

---

## Change Log

- 2026-07-12 - Sprint 9B Architecture Decision Workshop reconciled. `PLATFORM_OPERATIONS_SPECIFICATION.md` created. PDR-022 added and PDR-014 amended in `LYFELABZ_PLATFORM_DECISIONS.md`. Reconciliation notices added to `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `LYFELABZ_FIREBASE_BUILD_CHECKLIST.md`, `LMS_INTEGRATION_OPERATIONS.md`, and `LYFELABZ_ENGINEERING_STANDARDS.md`.
