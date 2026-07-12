# LyfeLabz Platform Operations Specification

**Status:** Canonical operational specification. Ratified 2026-07-12 in the Sprint 9B Architecture Decision Workshop.
**Purpose:** Single source of truth for LyfeLabz operational architecture - hosting, environments, release pipeline, rollback, maintenance mode, authentication session policy, monitoring, incident response, pilot readiness, and GitHub Pages retirement.
**Audience:** Every current and future LyfeLabz contributor and every operator with production access.
**Companion documents:** `LYFELABZ_PLATFORM_ARCHITECTURE.md`, `LYFELABZ_PLATFORM_DECISIONS.md` (PDR-014, PDR-022), `PLATFORM_CONTRACTS.md`, `PRESENT_MODE_ARCHITECTURE.md`, `ASSESSMENT_PIPELINE_SPECIFICATION.md`, `LYFELABZ_FIREBASE_BUILD_CHECKLIST.md`, `LYFELABZ_ENGINEERING_STANDARDS.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`.

This specification supersedes prior operational statements distributed across the architecture document, the Firebase build checklist, and PDR-014. Where a prior document contradicts this specification, this specification prevails and the prior document is updated with a superseding notice.

---

## 1. Operational Philosophy

LyfeLabz is a classroom product. Deployment failures and operational surprises reach real students during real class periods. Operational architecture exists to make platform behavior predictable, boring, and worthy of instructional trust.

The load-bearing operational principles are:

- **Invisible complexity.** Teachers never see a platform mechanism. Operational discipline is the mechanism that keeps it that way.
- **Minimize educator cognitive load.** Deployments, rollbacks, and maintenance transitions never require teacher awareness or action.
- **Operational reliability over deployment speed.** A slower release cadence with predictable classroom behavior is always preferred to a faster cadence that occasionally disrupts a class period.
- **Stable classrooms over rapid releases.** In-progress Present Mode sessions, in-progress assessment sessions, and active teacher workflows are protected across every operational transition.
- **Certified Releases represent instructional trust.** Every production release is a promise to teachers and students that the platform will behave the way it did the moment they last used it, except where a documented improvement was intended.

These principles are the interpretive lens for every subsequent section. When two operational options are otherwise comparable, the option that is quieter for classrooms wins.

---

## 2. Production Architecture

LyfeLabz composes a single production origin that serves two structurally separate surfaces.

- The **public curriculum surface** at `https://lyfelabz.com/` serves the canonical instructional experience: static HTML lessons, extensions, investigations, simulations, games, and engineering challenges. This surface has no client-side router, imports no Firebase SDK, and is safe to visit anonymously.
- The **authenticated platform surface** at `https://lyfelabz.com/app/` serves the Teacher Workspace and future student surfaces. This surface uses the client-side workspace router scoped to `/app/**`, imports the Firebase SDK, and requires Google Authentication for teacher and student use.

Both surfaces are served by a single Firebase Hosting site, backed by a single Firebase project (`lyfelabz-platform`) with Firestore, Authentication, Storage, and future Cloud Functions.

The production origin, its Hosting configuration, its Firestore project, its Authentication configuration, and its Cloud Functions deployment are load-bearing production dependencies. They are always changed through the release pipeline described in Section 6 and never modified out-of-band.

Present Mode, teacher workflows, student workflows, the assessment pipeline, and LMS integration surfaces all resolve to this single origin. Curriculum surfaces launched from the Teacher Workspace and from LMS integrations always resolve to the canonical origin. See `PRESENT_MODE_ARCHITECTURE.md` §2 and PDR-018b.

---

## 3. Hosting Strategy

Firebase Hosting is the **permanent canonical production origin** for LyfeLabz.

GitHub Pages is retained temporarily as a migration safety net and will be retired under the criteria in Section 17. GitHub remains the source repository for LyfeLabz code and documentation after GitHub Pages retirement.

The load-bearing hosting decisions are:

- The single production origin is `https://lyfelabz.com/`, served by Firebase Hosting.
- The public curriculum surface and the authenticated platform surface share the same origin. Path-based routing separates them. See Section 5.
- Permanent subdomains are not introduced. Cross-surface navigation must not change origin.
- Firebase Hosting release history is the atomic, versioned deploy channel. Every deploy is a release. Every rollback is a release re-selection.
- Firebase Hosting Preview Channels are the certified preview environment. See Section 5.
- The custom domain (`lyfelabz.com`) is bound to Firebase Hosting only after preview and production certification have been achieved.

Rationale. A single origin preserves the load-bearing surface boundary contract in `PLATFORM_CONTRACTS.md` §8 without introducing new cross-origin authentication or cross-origin cookie work. Firebase Hosting supplies atomic deploys, release history, one-action rollback, and preview channels without additional infrastructure. GitHub Pages, having served the pre-platform curriculum well, does not support authenticated surfaces, Cloud Functions, or an approval-gated release pipeline and cannot serve as the permanent production origin.

---

## 4. Migration Strategy

LyfeLabz migrates from GitHub Pages to Firebase Hosting through a controlled transition. Migration is not a switch. Migration is a sequence with explicit criteria and a documented safety net.

The migration sequence is:

1. Firebase Hosting is stood up for the canonical origin under a preview channel. Public curriculum parity is verified.
2. Authentication, routing, Present Mode, anonymous browsing, authorized student access, and deployment and rollback are verified against the preview channel.
3. The custom domain is bound to Firebase Hosting. GitHub Pages remains configured to serve as a fallback for a bounded observation period.
4. GitHub Pages is retired only after the criteria in Section 17 have been met and a seven-day successful observation period has completed.

Throughout migration, the canonical origin is Firebase Hosting. GitHub Pages exists only as a safety net during the transition. Content changes during migration are made on Firebase Hosting through the release pipeline and are propagated to GitHub Pages only for the duration of the safety net.

Rationale. A controlled transition preserves the public curriculum's uninterrupted availability while the platform surface is stood up. A documented retirement gate prevents the safety net from becoming a second permanent production origin.

---

## 5. Canonical Production Origin

The canonical production origin is `https://lyfelabz.com/`.

- **Public curriculum** is served from repository-root paths under this origin.
- **Authenticated platform** is served from `/app/**` under this origin.

The canonical production origin is the only origin that receives production traffic after GitHub Pages retirement. Present Mode, teacher launch flows, student launch flows, LMS integration launches, and every other cross-surface navigation resolve to this origin.

The canonical production origin is load-bearing for the platform's Public and Authenticated Surface Boundary. See `PLATFORM_CONTRACTS.md` §8. Public routes must not become dependent on teacher authentication, and authenticated routes must not leak instructional-experience assumptions across the boundary.

---

## 6. URL Strategy

LyfeLabz uses path-based routing to separate its two surfaces. Path-based routing is the certified surface separation mechanism.

- Public curriculum: `https://lyfelabz.com/lesson_*.html`, `https://lyfelabz.com/extension_*.html`, and every other canonical instructional path.
- Authenticated platform: `https://lyfelabz.com/app/**`.
- Workspace surface identifiers (`curriculum`, `classes`, `present-mode`, `settings`) name product surfaces inside `/app/**`, not URL paths. See `PLATFORM_CONTRACTS.md` §7.

The URL strategy commitments are:

- One production origin only. No `www.` variant carries production content; the apex domain is the canonical form. Legacy variants may redirect to the apex form.
- No permanent subdomains. Subdomains such as `app.`, `preview.`, or `staging.` are not introduced for surface separation. Preview traffic uses Firebase Hosting Preview Channel URLs; those URLs are internal and are not marketed.
- No production traffic on any host other than the canonical origin.
- Public curriculum URLs remain stable. Legacy URLs from the pre-platform period continue to resolve, either directly or through certified redirects.
- `lyfelabz.com/app/**` is the sole surface for authenticated platform navigation. Deep links inside `/app/**` are stable across releases.

Rationale. Path-based routing preserves the surface boundary while keeping a single origin. Stable URLs preserve teacher bookmarks, LMS embeds, and search engine indexing across migration.

---

## 7. Environment Architecture

LyfeLabz maintains three permanent environments.

- **Development.** Local emulators for Auth, Firestore, Hosting, Storage, and Cloud Functions. Isolated from production data. See `LYFELABZ_EMULATOR_SUITE_GUIDE.md`.
- **Preview.** Firebase Hosting Preview Channels for the canonical origin, backed by a dedicated Firebase project mirroring production configuration. Every candidate production release is deployed here first.
- **Production.** Firebase project `lyfelabz-platform` bound to the canonical origin. The single live environment.

No deployment moves directly from Development to Production. Every production release passes through Preview. Preview is not optional and is not skipped for small changes.

The three environments are permanent. A future Staging environment may be introduced if release cadence, concurrent workstreams, or a district commitment justifies it. Until then, Preview is the sole pre-production environment.

---

## 8. Development Environment

Development is the contributor's local workspace.

- Local emulators for Auth, Firestore, Hosting, Storage, and Cloud Functions.
- No connection to production Firebase projects.
- Never contains real student data. Synthetic data only.
- Local verification precedes commit. See Section 10.
- Contributors run the emulator suite as documented in `LYFELABZ_EMULATOR_SUITE_GUIDE.md`.

Development is not a shared environment. Two contributors' Development environments are independent. Development never receives traffic from a browser other than the contributor's own.

---

## 9. Preview Environment

Preview is the certified pre-production environment. Preview verification is the operational gate before Platform Administrator approval.

- Preview runs on a Firebase Hosting Preview Channel of the canonical Hosting site or a dedicated preview project mirroring production configuration.
- Preview mirrors production configuration for Authentication, Firestore, security rules, Cloud Functions, and Hosting.
- Preview never contains real student data. Preview datasets are synthetic.
- Preview URLs are internal. They are shared only with reviewers and the Platform Administrator during certification. They are never linked from public curriculum, from the authenticated platform, or from LMS integrations.
- Preview supports the same authentication providers as production. Test accounts used for preview verification are documented and are never granted production access.

Preview exists to answer one question. Would this release, exactly as built, be safe for classrooms if it were promoted to production right now? Every preview verification is a rehearsal for that promotion.

---

## 10. Production Environment

Production is the single live environment serving the canonical origin.

- Firebase project: `lyfelabz-platform`.
- Firestore location: `nam5` (US multi-region).
- Storage location: US multi-region, Standard access frequency, locked-down rules until explicitly relaxed by a certified sprint.
- Authentication: Google Sign-In enabled. See Section 13.
- Cloud Functions: introduced through the release pipeline, deployed to production only after preview certification and Platform Administrator approval.
- Hosting: canonical origin `https://lyfelabz.com/` bound after preview certification.

Production is the environment of record. Every operational statement in this specification applies to production unless a specific section names another environment.

Production is never modified out-of-band. Console-driven changes to Firebase project configuration, security rules, Cloud Functions, or Hosting are prohibited outside the release pipeline, except for the specific console configuration steps documented in `LYFELABZ_FIREBASE_BUILD_CHECKLIST.md` for the initial project bring-up.

---

## 11. Release Pipeline

The certified release pipeline is:

```
Implementation
    ↓
Local Verification
    ↓
Commit
    ↓
Preview Deployment
    ↓
Internal Certification
    ↓
Platform Administrator Approval
    ↓
Production Deployment
    ↓
Production Monitoring
```

Each stage has a specific responsibility.

- **Implementation.** The engineering change is complete against the certified architecture. Contradictions between the change and the architecture are resolved in the architecture first, not in the code.
- **Local Verification.** The contributor exercises the change end-to-end against the emulator suite. Automated tests pass locally. See `LYFELABZ_ENGINEERING_STANDARDS.md`.
- **Commit.** The change is committed to `main` through a reviewed pull request. GitHub is the single source of truth. No production artifact originates from any surface other than a tagged commit on `main`.
- **Preview Deployment.** The change is deployed to Preview through the automated preview workflow. Preview deployment is automatic on merge to `main` or on a labeled pull request; production deployment is never automatic.
- **Internal Certification.** Reviewers verify the preview deployment against the certification criteria in Section 12. Automated tests and human verification are both required. Neither replaces the other.
- **Platform Administrator Approval.** The Platform Administrator explicitly approves the promotion. Approval is recorded. See Section 13.
- **Production Deployment.** The Platform Administrator triggers the promotion. Production deployment publishes the release to the canonical origin.
- **Production Monitoring.** Post-deployment health verification. See Section 22.

Automated CI gates enforce the pipeline. Human gates enforce the pipeline for behavior CI cannot see. Both are required.

---

## 12. Certified Releases

A **Certified Release** is a production release that satisfies every certification criterion below.

A release is certified only when:

1. Architecture is certified. The change is consistent with the specifications and PDRs referenced by the change.
2. Documentation is reconciled. Every affected certified document is updated in the same release.
3. Implementation is complete. No behind-a-flag half-implementations reach production without an explicit release note documenting the intended progressive rollout.
4. Local verification has passed. Emulator-suite exercises, unit tests, contract tests, and security-rules tests have run and are green.
5. Security verification has passed. Security rules have been reviewed by a second reviewer. Client-side surface prohibitions in `PLATFORM_CONTRACTS.md` §§8-9 have not been violated. See `LYFELABZ_FIREBASE_SECURITY_MODEL.md`.
6. Operational documentation is updated. This specification, `LYFELABZ_ENGINEERING_STANDARDS.md`, and any affected operational document reflects the change.
7. Preview deployment has been verified. The change has been exercised end-to-end in Preview.
8. Platform Administrator approval has been recorded.
9. Production deployment has completed. The release is live on the canonical origin.
10. Post-deployment health has been verified. See Section 22.

Certified Releases represent official production history. Only Certified Releases are considered valid rollback targets. Every Certified Release is tagged in git, recorded in the release history, and referenced in the operational changelog.

---

## 13. Production Approval

Production deployment always requires explicit Platform Administrator approval.

- Approval is granted for a specific release candidate identified by commit SHA and preview channel identifier.
- Approval is recorded in writing. The record includes the approver, the release identifier, the certification checklist, and the intended deployment window.
- Approval expires when the release candidate materially changes. A new candidate requires a new approval.
- Automated tests are required but never replace human approval. A green CI run authorizes preview promotion, not production promotion.
- Emergency production deployment (for a security fix or a classroom-affecting production incident) still requires Platform Administrator approval. The certification criteria are compressed only to the extent that the incident requires; every skipped criterion is recorded in the release note.

Platform Administrator approval is the load-bearing human gate. This gate is never automated away.

---

## 14. Deployment Workflow

The deployment workflow, at operational level of detail, is:

1. A pull request is opened against `main`. CI runs unit tests, security-rules tests, accessibility checks, and lint. Reviewers verify the change against the certified architecture and against affected specifications.
2. The pull request is merged to `main`. A preview deployment is produced from the merge commit and posted to the Firebase Hosting Preview Channel of the canonical Hosting site (or the dedicated preview project).
3. Reviewers exercise the preview deployment against the certification criteria in Section 12. Automated preview smoke tests run against the preview URL.
4. When preview verification is complete, the release candidate is presented to the Platform Administrator with the certification record.
5. The Platform Administrator approves the promotion. Approval is recorded.
6. Production deployment is triggered. The release is deployed atomically. Firebase Hosting produces a new release in the release history.
7. Post-deployment health verification runs against production. See Section 22.
8. The release is recorded in the operational changelog and tagged in git.

Cloud Functions deployments follow the same pipeline. Cloud Functions deploys are versioned and are individually revertible. See Section 15.

Firestore security rules deploys are treated as first-class releases. Security rules changes always receive an independent second review. Security rules changes may be deployed independently of Hosting and Cloud Functions when the change scope is limited to rules.

Firestore schema evolution is additive by default. Destructive schema evolution requires a documented migration plan, a paired backup, and a Platform Administrator approval that specifically names the destructive step. See `LYFELABZ_ENGINEERING_STANDARDS.md`.

No manual production deploys originate from developer machines.

---

## 15. Rollback Strategy

If production experiences a material issue affecting:

- authentication,
- assessment,
- assignments,
- Present Mode,
- teacher workflow,
- student workflow, or
- platform stability,

the production release is immediately rolled back to the previous Certified Release.

Rollback rules:

- Rollback is a re-selection of a previous Certified Release from Firebase Hosting's release history. Rollback is not a re-deploy of the prior source tree.
- Rollback is one action. It is performed by the Platform Administrator or by an on-call operator explicitly authorized by the Platform Administrator.
- Rollback preserves in-progress classroom sessions to the extent the retiring release supported them. See Section 19.
- Cloud Functions rollback is a re-selection of the prior deployed version.
- Firestore security rules rollback is a re-deploy of the prior versioned rules file from git.
- Firestore data rollback is not automatic. Schema changes are additive by default; destructive changes carry a documented plan and a paired backup.
- Repairs occur in Preview. Production is redeployed only after recertification.

Rollback is not a decision to relitigate a release. Rollback is the load-bearing tool that ensures a bad release cannot outlast a class period. Post-rollback analysis happens after classrooms are safe.

---

## 16. Maintenance Mode

LyfeLabz supports formal maintenance mode. Maintenance mode is a controlled operational state, not an incident response.

Maintenance mode behavior:

- **Public curriculum readable when safe.** Anonymous curriculum browsing continues when the maintenance transition does not require the public surface to be paused.
- **Write-dependent services temporarily disabled.** Assessment submission, assignment creation, class configuration changes, and other write paths return a friendly maintenance message.
- **In-progress assessment sessions preserved.** No session is destroyed by entering maintenance mode. Sessions that cannot submit during maintenance receive the grace period behavior defined in `ASSESSMENT_PIPELINE_SPECIFICATION.md`; sessions retain their working state and resume on maintenance exit.
- **No partial attempt records.** Maintenance mode never creates a partial attempt. The attempt is created only after successful server-side submission. See PDR-021a.
- **Friendly user messaging.** Teachers and students see a maintenance page that names the platform state, points to the estimated exit time, and indicates that in-progress work is preserved.
- **Platform Administrator activation.** Maintenance mode is entered and exited only by the Platform Administrator. Entry and exit are recorded in the operational changelog.

Maintenance mode is used for narrow operational windows that cannot be executed safely against live classroom traffic (for example, a security rules change with a data-shape prerequisite). Routine releases do not use maintenance mode; they use the release pipeline in Section 11.

---

## 17. Authentication Session Policy

Google Authentication uses secure persistent sessions.

- Students remain signed in unless they sign out, security requires reauthentication, or session expiration occurs.
- Session persistence is scoped to the authenticated platform surface (`/app/**`). Public curriculum surfaces do not require authentication and do not create sessions.
- Session expiration follows Firebase Authentication's default token lifetime with silent refresh; students do not experience routine reauthentication prompts during a class period.
- Reauthentication may be required for security-sensitive teacher operations (for example, class deletion, teacher account changes). Reauthentication requirements are documented in the affected feature architecture.
- Sign-out is available and is honored immediately.

Session policy is designed to be invisible during a class period. A student who signs in during first period should still be signed in at the start of second period without action. This is a load-bearing classroom expectation.

The assessment session lifecycle (PDR-021a) is distinct from the authentication session. Assessment sessions expire 24 hours after last activity; authentication sessions are governed by this section. Neither replaces the other.

---

## 18. Present Mode During Deployment

Production deployments never interrupt active classroom sessions.

- Active Present Mode sessions continue through a deployment. In-flight browser tabs are not forced to reload.
- Active assessment sessions continue through a deployment. Working state is preserved. See PDR-021a.
- Active teacher workflows continue through a deployment.
- New sessions receive the new release. New tabs, new Present Mode launches, and new assessment sessions load the newly deployed assets.

Firebase Hosting's atomic release model makes this behavior tractable. A tab that has already loaded a release runs against that release's client assets until the tab reloads. A new tab loads the current release. Cloud Functions honor the client's request payloads across releases within the certified contract stability window in `PLATFORM_CONTRACTS.md`.

Client-side release awareness is not exposed to users. There is no in-product "reload for new release" banner during a class period. New sessions naturally pick up the new release.

Rationale. A class period is a load-bearing instructional unit. A deployment that forces a mid-lesson reload is a deployment that reaches a real student in the middle of real learning. That failure mode is designed out.

---

## 19. Operational Monitoring

Operational monitoring exists to monitor platform health. Educational analytics remain separate. Operational telemetry is not a proxy for observing student behavior.

Monitored surfaces:

- **Authentication.** Sign-in success rate, sign-in error rate, token refresh success.
- **Cloud Functions.** Invocation counts, error rates, latency percentiles, cold-start behavior.
- **Assessment scoring.** Scoring success rate, scoring error rate, scoring latency. Failures produce alerts because they block attempt creation.
- **Assignments.** Assignment write success and failure. Assignment window transitions.
- **Routing.** 4xx and 5xx rates on the canonical origin. Preview channel and production release identifiers.
- **Deployment.** Release history integrity. Successful and failed deployment counts.
- **Rollback.** Rollback frequency and time-to-rollback for any material incident.
- **Latency.** End-to-end latency percentiles for authenticated surfaces.
- **Session recovery.** Assessment session recovery success and failure counts.
- **Infrastructure.** Firestore read and write counts, quota headroom, security rules denials at a coarse aggregate level.

Explicitly not monitored:

- Student behavioral telemetry beyond what is necessary for platform health.
- Per-student engagement, per-student click paths, per-student time-on-task, or any signal that would substitute for classroom observation.
- Any signal that violates the browser storage or projector-safety contracts in `PLATFORM_CONTRACTS.md` §§5, 9.

Monitoring dashboards and alerts are owned by the Platform Administrator. Alert routing, on-call rotation, and severity criteria are documented outside this specification.

---

## 20. Incident Response

An operational incident is a material production issue affecting any of the surfaces named in Section 15. Incident response is:

1. **Detect.** Monitoring alert, on-call observation, or user report.
2. **Contain.** Roll back to the previous Certified Release if the incident is release-related. Enter maintenance mode if the incident is not release-related and requires containment.
3. **Communicate.** Notify affected teachers through the operational channel. The communication states the platform state and the expected recovery time; it does not speculate about root cause.
4. **Repair.** Repair happens in Preview. A repair candidate is prepared through the release pipeline.
5. **Recertify.** The repair candidate is certified against Section 12.
6. **Redeploy.** Production is redeployed only after recertification and Platform Administrator approval.
7. **Post-incident review.** The incident is recorded in the operational changelog. A post-incident review captures the timeline, the root cause, the affected classrooms if any, and the specific operational or architectural change that prevents a recurrence.

Post-incident reviews are treated as first-class inputs to the release pipeline. A repeated incident with no preventive change is an architectural failure, not an operational one.

---

## 21. Production Health

Production health is a documented status. It is not a subjective assessment.

Production is healthy when:

- Sign-in success rate is at or above the health threshold documented in the monitoring configuration.
- Assessment scoring success rate is at or above threshold.
- The rate of 5xx responses on the canonical origin is below threshold.
- No open Sev-1 or Sev-2 incident exists.
- The current production release is the current Certified Release.

Production health is verified after every deployment, after every rollback, and at least daily during the school year during the school day. Verification results are recorded.

Production is not "healthy enough." The definition above is binary. If any criterion is not satisfied, production is either recovering from an incident or is entering incident response.

---

## 22. Pilot Readiness Certification

Pilot readiness is a formal, one-time certification that the platform is ready to serve a real classroom pilot. It is a higher bar than a Certified Release. A Certified Release is safe to deploy; Pilot Readiness certifies that the platform is safe for real students in a real school.

Pilot Readiness requires successful verification of:

- **Architecture.** The certified specifications for the pilot scope are current and consistent.
- **Security.** The security model is verified against the pilot surface. Security rules, Cloud Functions authorization, and the browser storage contracts are exercised end-to-end.
- **Authentication.** Google Sign-In is verified for teacher and student accounts. Session persistence, sign-out, and reauthentication paths are exercised.
- **Teacher workflows.** Curriculum, class configuration, assignment creation, Present Mode launch, and classroom-side operations are exercised end-to-end against a preview environment with realistic synthetic data.
- **Student workflows.** Anonymous curriculum browsing, authenticated assessment attempts, session save and resume, and grace-period submission are exercised.
- **Assessment pipeline.** Every load-bearing behavior in `ASSESSMENT_PIPELINE_SPECIFICATION.md` is exercised, including server-authoritative scoring, session-attempt separation, unlimited attempts, immutable history, and assignment window handling.
- **Present Mode.** The certified Present Mode surface is exercised, including same-tab launch, exit affordance semantics, and projector-safety contracts.
- **Deployment.** A full release pipeline run has been rehearsed against Preview and Production.
- **Rollback.** A rollback has been rehearsed against Preview. The rollback playbook is current.
- **Monitoring.** Every monitored surface in Section 19 has an active alert route and a documented on-call responder.
- **Recovery.** Session recovery, archived session recovery within the retention window, and grace-period submission recovery have been exercised.
- **Operational ownership.** The Platform Administrator and on-call responder are named and available for the pilot window.

Pilot Readiness is certified by the Platform Administrator. Certification is recorded in writing, references the specific Certified Release that is pilot-ready, and names the pilot window.

Pilot Readiness is not permanent. If material architecture, security, or operational conditions change between certification and pilot start, Pilot Readiness is re-certified before the pilot begins.

---

## 23. GitHub Pages Retirement

GitHub Pages is retired when, and only when, every criterion below has been verified:

- Public curriculum parity is verified. Every canonical instructional URL served by GitHub Pages resolves identically on Firebase Hosting.
- Custom domain binding is verified. `https://lyfelabz.com/` and any legacy variants resolve to Firebase Hosting.
- Authentication is verified against the canonical origin.
- Routing is verified for the authenticated platform surface (`/app/**`).
- Present Mode is verified end-to-end against the canonical origin.
- Anonymous browsing is verified across the public curriculum surface.
- Authorized student access is verified end-to-end.
- Deployment through the release pipeline is verified.
- Rollback is verified against the Firebase Hosting release history.
- Search indexing is verified. Canonical URLs on Firebase Hosting are indexed. Legacy GitHub Pages URLs are either redirected or have been de-indexed as intended.
- Legacy redirects are verified where feasible. Where a legacy URL cannot be preserved, the retirement plan records the decision and the mitigation.
- A seven-day successful observation period has completed during which every criterion above has held continuously.

After retirement:

- Firebase Hosting is the **sole** production origin.
- GitHub remains the source repository only. `main` continues to be the single source of truth for code and documentation.
- Documents that reference GitHub Pages as an operational surface are updated with a retirement notice referencing the retirement date.
- The Firebase build checklist is amended to reflect that Hosting is the production website and that Firebase Hosting deployment is required, not optional.

GitHub Pages retirement is a Platform Administrator decision. Retirement is not attempted until every criterion is verified in writing.

---

## 24. Future Operational Expansion

This specification anticipates operational surfaces that do not yet exist. When they are introduced, they must be introduced through the same architecture-first discipline that governs the rest of the platform.

Anticipated expansions:

- **Staging environment.** A dedicated environment between Preview and Production, introduced when release cadence or concurrent workstreams justify it. Staging inherits the operational contracts of Preview and adds live-like synthetic datasets.
- **Formal feature flag system.** Real feature flags for grade rollouts and staged feature releases. Flags default off. Flags are decommissioned within a documented window after full rollout. See PDR-014.
- **Multi-region Firestore.** Deferred until scale or availability requirements justify it. Introduced through a documented migration plan.
- **Additional Cloud Functions runtimes.** Introduced through the release pipeline; each new runtime is a Certified Release event.
- **LMS integration operations.** Operational obligations for LMS providers are defined in `LMS_INTEGRATION_OPERATIONS.md`. That document is subordinate to this specification for hosting, deployment, rollback, and monitoring; it extends this specification for LMS-specific operational concerns.
- **Additional identity providers.** Reconsidered only under the criteria in PDR-002. Any new provider is introduced through the release pipeline and is verified in Preview before production exposure.
- **Automated production canary.** A future automated safety check that briefly compares production behavior against the retiring release before finalizing a deployment. Not currently implemented; introduced only through a subsequent PDR.

Every expansion is an amendment to this specification or to a subordinate operational document. Operational expansion by implementation is prohibited.

---

## 25. Relationship to Prior Architecture

This specification supersedes the operational statements previously distributed across:

- `LYFELABZ_PLATFORM_ARCHITECTURE.md` §12 (Deployment Strategy)
- `LYFELABZ_PLATFORM_DECISIONS.md` PDR-014 (Deployment Philosophy)
- `LYFELABZ_FIREBASE_BUILD_CHECKLIST.md` §1 (Canonical Configuration) statements about the public website
- Any prior text asserting that GitHub Pages is the permanent production website

Where a prior document conflicts with this specification, this specification prevails. The prior document is updated with a superseding notice pointing here. Companion operational documents (`LYFELABZ_ENGINEERING_STANDARDS.md`, `LYFELABZ_FIREBASE_SECURITY_MODEL.md`, `LMS_INTEGRATION_OPERATIONS.md`) continue to operate within the boundaries this specification establishes.

Prior decisions that remain correct are not restated. Prior decisions that require revision are revised through PDR-022, which is added to `LYFELABZ_PLATFORM_DECISIONS.md` alongside PDR-014's superseding notice.

---

## 26. Change Discipline

This specification is the canonical operational specification. Changes to it follow the same discipline as other certified specifications.

- Editorial corrections that do not change behavior may be made without a new PDR.
- Any change to hosting strategy, environment architecture, release pipeline stages, certification criteria, rollback behavior, maintenance mode behavior, authentication session policy, Present-Mode-during-deployment behavior, monitoring scope, Pilot Readiness criteria, or GitHub Pages retirement criteria requires a new PDR or an amendment to an existing PDR.
- Every change is recorded in the operational changelog and referenced from the affected PDR.

Operational behavior is not evolved by implementation. It is evolved by decision, recorded in the specification, and then implemented.

---

## 27. Change Log

- 2026-07-12. Initial ratification. Sprint 9B Architecture Decision Workshop. Establishes Firebase Hosting as the permanent canonical production origin, the three-environment architecture, the Certified Release model, the Platform Administrator approval gate, the rollback contract, maintenance mode, authentication session policy, Present-Mode-during-deployment behavior, operational monitoring scope, Pilot Readiness Certification, and GitHub Pages retirement criteria. Supersedes prior operational statements in `LYFELABZ_PLATFORM_ARCHITECTURE.md` §12 and `LYFELABZ_PLATFORM_DECISIONS.md` PDR-014 to the extent they conflict with this specification.
