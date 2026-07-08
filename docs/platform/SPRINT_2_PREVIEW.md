# LyfeLabz Sprint 2 Preview

**Status:** High-level roadmap only. Sprint 2 has not been designed in detail.
**Companion documents:** LYFELABZ_PLATFORM_ARCHITECTURE.md, SPRINT_1_COMPLETION_REPORT.md, LYFELABZ_ENGINEERING_STANDARDS.md

This preview describes the direction Sprint 2 is expected to take. It is intentionally brief. Detailed scope, sequencing, and acceptance criteria will be produced in a dedicated Sprint 2 specification before implementation begins.

---

## Objective

Begin turning the Firebase foundation delivered by Sprint 1 into the first authenticated platform surfaces defined by Platform Architecture Version 1.0, while preserving the default-deny posture and the architecture-first workflow established in Sprint 1.

---

## Primary milestones

- Introduce the first authenticated identity flows for teachers and students.
- Establish role activation on top of the provisioning record written by `authOnUserCreate`.
- Add the first narrowly scoped Firestore Rules that permit specific access on top of the default-deny baseline.
- Extend the Cloud Functions codebase into a second domain beyond `auth/`.

---

## Expected deliverables

- A Sprint 2 specification document analogous to LYFELABZ_SPRINT_1_FIREBASE_FOUNDATION.md.
- The first non-`auth/` Cloud Functions, matching the domain layout scaffolded in Sprint 1.
- Additional Firestore Rules covering the specific paths Sprint 2 opens.
- Additional automated Firestore Rules tests for every new rule.
- Continued green builds on the existing continuous integration pipeline.

---

## Architecture dependencies already satisfied by Sprint 1

- The Firebase project and Blaze billing.
- The Firebase CLI configuration under `platform/firebase/`.
- The default-deny baseline for Firestore and Storage.
- The Emulator Suite configuration and local verification workflow.
- The Cloud Functions domain scaffold and `shared/` module.
- The `users/{uid}` provisioning contract.
- The Firestore Rules test harness.
- The continuous integration pipeline.

Sprint 2 does not need to relitigate any of the above.

---

## Risks

- Scope creep into user-visible product surfaces before role activation is trustworthy.
- Introducing broad Firestore Rules where narrow rules are sufficient.
- Adding Cloud Functions in ad hoc locations rather than into the existing domain scaffold.
- Deploying to the live Firebase project before Sprint 2 has its own verification story.

Each risk is mitigated by continued adherence to the Engineering Standards and to the architecture-first workflow.

---

## Success criteria

Sprint 2 succeeds when:

- Every deliverable is specified before it is implemented.
- Every new rule is covered by an automated Rules test.
- Every new Cloud Function is idempotent, typed, and logged through the shared module.
- The default-deny posture remains intact except where a specific rule authorizes a specific access pattern.
- Continuous integration remains green throughout the sprint.
- Sprint 2 closes with its own completion report and a new section in SPRINT_HISTORY.md.
