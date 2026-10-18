# Teacher Units Staging UX Test Path (Design)

**Status:** Approved by the owner (2026-10-18) and implemented in the repository. Deployed to staging only on 2026-10-18 under owner approval: the 9 `teacherUnits*` Functions, staging policy instance `21819f18-fbce-498c-800f-d9deb8b9dfc3` (enabled, generation 1), Hosting app `d68a530dd7389d99` and marketing `57b772c2ee70550a` (rollback baselines `c7808cd876167ec9` and `934491432825292c`), built from `060bec7` plus uncommitted changes. Rules, indexes, Storage and Auth were not deployed. Production is closed. Authenticated teacher UX testing is pending.

**Baseline:** `main` at `060bec7d7db965fad0e5bee871fdda38b21a931b` (equal to local `origin/main`, clean tree).

**Purpose:** let the owner test the real Teacher Units teacher experience (My Units: create, rename, describe, archive, restore, add/remove resources, reorder resources) on existing staging (`lyfelabz-staging`, `https://lyfelabz-staging.web.app`) without D13 certification, signing, IAM observers, credential brokers or any production change.

**Non-goals:** production availability; any change to the certified release path (A3-6 verifier, S6e signing, D13 evidence); student-facing Teacher Units features (there are none).

---

## 1. Why a design is needed (blocker evidence)

Teacher Units is closed in every environment, staging included, by three independent layers. None has a staging switch.

| Layer | Evidence | Effect in staging today |
| --- | --- | --- |
| Server verifier | `platform/functions/src/teacherUnits/a3-enforcement.ts:61` wires `UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER`; `a3-release-authority.ts:40-46`: "The only production verifier ... There is no runtime switch that selects another implementation." | Even an enabled policy evaluates as `deploymentIneligible`. Every list, get and mutation is refused. |
| Server provenance | `enabledEligible` (`a3-enforcement.ts`) also requires backend release, deployment approval, activation evidence and approval documents, and `verifyRuntimeProvenance` matching the deployed Cloud Run service, revision and service account. | Requires the D13 / A3-6 evidence chain, which is not built. |
| Client build | `app/scripts/build-application.cjs:11,89-108` always substitutes `CLOSED_SOURCE` for `releaseAvailability.ts` for both intents (`general`, `teacher-units`); `backend-state.cjs:33` and `build-application.cjs:147` refuse any evidence whose `availability !== 'closed'`. | No bundle can show My Units. |

Staging deployment state (read-only check, 2026-10-18): staging Hosting sites `lyfelabz-staging` and `lyfelabz-staging-marketing` exist; staging has roughly 75 Functions and **no** `teacherUnits*` Function. Deployed staging Firestore Rules were not inspected (no gcloud access token in this session); see section 7 step R0.

---

## 2. Design summary

A narrowly bounded **staging UX test mode**, active only when all of these hold:

1. **Server:** the Function's runtime identity, resolved from the metadata server (not env vars), is `environment: "staging"`, `projectId: "lyfelabz-staging"`, `projectNumber: "293337283840"`, `source: "execution-metadata"`.
2. **Data:** staging Firestore holds `platformConfig/teacherUnitsAvailability` in `mode: "enabled"` whose `backendReleaseEligibility.releaseId` and `activationEvidenceRef` equal fixed, published **staging-test marker** values (section 3.2). A policy carrying marker values can never satisfy the certified path, and a certified-shaped policy never takes the test path.
3. **Client:** the Hosting bundle was built with a new explicit release intent `staging-ux-test`, which the release tooling accepts only for `--project lyfelabz-staging`, and the compiled availability function returns true only on origin `https://lyfelabz-staging.web.app`.

Everything else is unchanged: authentication, `requireDistrictContext`, the in-transaction authorization snapshot, ownership, school binding (`expectedSchoolId`), revision concurrency, idempotency receipts, audit events, placement validation, the compatibility envelope, `policyChanged` / `placementMismatch`, callable-only Rules, and the client's schema 2 discovery and origin pins.

---

## 3. Server change (Functions)

### 3.1 Behavior

In `evaluateAvailabilityInTransaction` (`a3-enforcement.ts`), after the policy has passed `validatePolicy(raw, scope.identity)` (which already binds the policy to the runtime's environment, project id and project number) and is `mode: "enabled"`:

```
if (isStagingUxTestPolicy(scope.identity, policy)) -> eligible = stagingUxTestEligible(scope.identity, policy)
else                                               -> eligible = await enabledEligible(tx, scope, policy)   // unchanged certified chain
```

- `isStagingUxTestPolicy`: true only when the policy's `releaseId` and `activationEvidenceRef` both equal the markers.
- `stagingUxTestEligible`: true only when identity is exactly the staging tuple in section 2 item 1, region `us-central1`, database `(default)`, and `policy.placementFingerprint === RUNTIME_PLACEMENT_FINGERPRINT`. In any other environment a marker policy returns **false** (fail closed), so a marker policy that somehow reached production would still be `deploymentIneligible`.
- No evidence documents are read and the verifier is not called on this path. The test path is a pure function of identity and the already-validated policy.
- Both discovery (`teacherUnitsCapabilities`, which uses the same evaluator) and every management read and mutation follow this, so the client receives an `enabled`, `deploymentEligible: true` declaration whose `backendReleaseId` is the marker.

### 3.2 Markers

New module `platform/functions/src/teacherUnits/a3-staging-ux-test.ts`:

- `STAGING_UX_TEST_RELEASE_ID = sha256("lyfelabz.teacherUnits.stagingUxTest.v1:release")` (64 hex).
- `STAGING_UX_TEST_EVIDENCE_REF = "teacherUnitsReleaseEvidence/" + sha256("lyfelabz.teacherUnits.stagingUxTest.v1:evidence")`.
- `isStagingUxTestPolicy`, `stagingUxTestEligible`, both frozen and pure.

The marker evidence document is never created; the reference is a label only. The certified chain would refuse it (missing document), which is the intended separation.

### 3.3 Production safety argument

- Production identity resolves only from the metadata server (`a3-runtime-identity.ts:328-333`); env vars can only cause refusal (`agrees(...)`), never change environment.
- A staging-bound policy fails `validatePolicy` in production (environment binding), and production has no policy document today.
- The test path is gated on the staging identity tuple inside the pure function, independently of the policy binding.
- `UNCONFIGURED_RELEASE_AUTHORITY_VERIFIER` stays the only verifier; the certified chain is byte-for-byte unchanged.
- The production Functions artifact will contain this code, but it is unreachable there. If the owner prefers it to be absent from production artifacts entirely, that needs a build-time flag, which is more machinery; not recommended.

---

## 4. Client and Hosting build change

### 4.1 Compiled availability

`app/src/teacherUnits/releaseAvailability.ts` in the repository stays **closed** (so jest, typecheck and every `general` / `teacher-units` build remain closed).

`app/scripts/build-application.cjs` gains a third intent, `staging-ux-test`, which substitutes:

```ts
export function teacherUnitsAvailable(): boolean {
  return typeof location !== "undefined" && location.origin === "https://lyfelabz-staging.web.app";
}
export function requireTeacherUnitsAvailable(): void {
  if (!teacherUnitsAvailable()) throw new Error("Teacher Units unavailable in this release");
}
```

Evidence for this intent: `policy: 'teacher-units-staging-ux-test-v1'`, `availability: 'staging-ux-test'`, `runtimeAvailability: 'not-certified'`, plus `replacementHash` of this source. `--verify` accepts `availability: 'staging-ux-test'` only for the `staging-ux-test` intent and `'closed'` only for the other two. The canonical-resolution and allowed-consumer checks are unchanged.

### 4.2 Release tooling

- `scripts/hosting-release/backend-state.cjs`: `releaseIntent` accepts `staging-ux-test`; `releaseCandidate` routes it to `hostingCandidate`, which accepts `availability: 'staging-ux-test'` only for that intent and records `teacherUnitsAvailability: 'staging-ux-test'`.
- `prepare.cjs`, `build-pair.cjs` (`hostingPredeploy`) and `certify.cjs`: refuse `staging-ux-test` unless the environment is `staging` (`environmentForProject(project).name === 'staging'`). Refusal happens before any build or live call.
- `hosting-identity.cjs` is **not** changed: `staging-ux-test` is not in its release intents, so such a build can never produce a D13 Hosting candidate fingerprint or an enabled candidate.
- `build-pair.cjs` skips the Functions backend rebuild for `staging-ux-test` (that is `teacher-units` intent behavior).

### 4.3 Runtime safety layers (client)

1. A `general` or `teacher-units` bundle is closed (unchanged).
2. A `staging-ux-test` bundle is refused by tooling for production.
3. If such a bundle were served from any other origin (including `app.lyfelabz.com` or `lyfelabz-staging.firebaseapp.com`), it is closed at runtime.
4. Even when open, every mutation needs an `enabled` declaration from the origin-pinned staging backend (`backendCompatibility.ts`, unchanged).

---

## 5. Staging policy document

New script `scripts/teacher-units-release/staging-ux-test-policy.cjs` (Admin SDK, Application Default Credentials):

- Hard-pinned to `lyfelabz-staging` / `293337283840`: refuses any other `--project`, and refuses if `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `FIRESTORE_EMULATOR_HOST` disagree or are set to something else.
- `show`: reads and prints the policy (read-only).
- `enable`: create-only (`create()`, fails if the document exists). Writes a full A3-1 `TeacherUnitsAvailabilityPolicyV1`: `schemaVersion 1`, fresh UUIDv4 `policyInstanceId`, staging environment binding, `region us-central1`, `databaseId (default)`, `mode enabled`, `generation 1`, `backendReleaseEligibility { releaseId: marker }`, `acceptedClientContractVersions ["teacher-units-v2"]`, `placementFingerprint` from `check-parity.cjs`'s `placementFingerprint()`, `activationEvidenceRef: marker`, server `updatedAt`. Validated locally with the compiled `validatePolicy` before writing.
- `close`: transaction that writes `mode closed`, `activationEvidenceRef null`, `generation + 1`, validated with `validatePolicyTransition`. This is the fast server-side kill switch.
- Every run prints the before and after documents.

It writes exactly one document. It writes no release, evidence, approval or audit document.

---

## 6. Invariants changed (exact)

| # | Invariant (source) | Change |
| --- | --- | --- |
| I1 | "The only production verifier ... There is no runtime switch that selects another implementation." (`a3-release-authority.ts:40-41`) and "Production wiring uses the UNCONFIGURED release-authority verifier, so an enabled policy always evaluates as ineligible" (`a3-enforcement.ts:10-12`; `TEACHER_UNITS.md` A3-3 section) | Verifier unchanged, but an enabled **marker** policy evaluates as eligible in the **staging** runtime identity without verifier, evidence or provenance. Still always ineligible in production. |
| I2 | Availability requires release, deployment approval, activation evidence and approval, runtime provenance and a verified verdict (`U2_6_A3_3_APPROVED_DECISIONS.md` Decision 4; `TEACHER_UNITS.md` A3-3 order) | Not required for the staging marker policy. Becomes: "required for every non-test enablement; staging UX test enablement is explicitly uncertified." |
| I3 | "One reviewed entry, one closed availability implementation, no activation switch." (`build-application.cjs:2`); evidence policy `teacher-units-canonical-closed-v2`; tooling refuses any availability other than `closed` (`backend-state.cjs:33`, `build-application.cjs:147`) | Adds a second compiled availability implementation, reachable only through the explicit `staging-ux-test` intent, staging project only, origin-gated. |
| I4 | Release intents are exactly `general` and `teacher-units` (`backend-state.cjs:19-21`, `build-application.cjs:23`) | Adds `staging-ux-test` (staging only). `hosting-identity.cjs` intents unchanged. |
| I5 | Status statements that Teacher Units is "not deployed" and "closed" everywhere (`CURRENT_PLATFORM_STATE.md` row for teacher units, `TEACHER_UNITS.md` header and sections 9.4-9.7, A3-3, A3-4) | After deployment: "staging UX test mode deployed in staging only; uncertified; production closed." |
| I6 | Activation prerequisites: independent certification of U2.2-U2.5, A3-5, A3-3 recertification before any activation (`TEACHER_UNITS.md` 9.4 and 9.7 "Remaining activation prerequisites") | Waived for **staging human UX testing only**. Remain prerequisites for production. |

Not changed: Rules semantics, authentication, tenant isolation, A3-3 refusal precedence, client discovery and origin pins, placement parity gate, the certified chain, the D13 tooling, production release tooling behavior for `general` / `teacher-units`.

**Accepted risk (staging only):** staging Teacher Units runs code whose independent certifications are pending (A3-3 recertification, A3-5, U2.2-U2.5). Staging data written in this mode (units, receipts, audit events) is real staging data and persists.

---

## 7. Deployment plan (for the later approval checkpoint)

All commands from the repository root, explicit `--project lyfelabz-staging`, each scoped with `--only`. The `.firebaserc` default is production and is never relied on.

| Step | Command | Resources changed |
| --- | --- | --- |
| R0 (read-only) | Fetch deployed staging Firestore Rules and diff against `platform/firebase/firestore.rules` | None |
| F1 | `firebase deploy --only functions:teacherUnitsCapabilities,functions:teacherUnitsCreate,functions:teacherUnitsList,functions:teacherUnitsGet,functions:teacherUnitsUpdate,functions:teacherUnitsArchive,functions:teacherUnitsRestore,functions:teacherUnitsSetResources,functions:teacherUnitsReorder --project lyfelabz-staging` | 9 new 2nd-gen callables (new Cloud Run services) in `us-central1`. The CLI grants public invoker on new callables, the same as every existing LyfeLabz callable: an IAM binding change that needs explicit approval. Predeploy runs the Functions build and the placement parity gate. No existing Function is redeployed. |
| P1 | `node scripts/teacher-units-release/staging-ux-test-policy.cjs enable --project lyfelabz-staging` | Creates `platformConfig/teacherUnitsAvailability` in staging Firestore. |
| H1 | `node scripts/hosting-release/prepare.cjs --project lyfelabz-staging --intent staging-ux-test`, then `firebase deploy --only hosting:app,hosting:marketing --config firebase.staging.json --project lyfelabz-staging --message "release <sha> staging-ux-test"`, then `certify.cjs` | New versions on both staging sites. The whole staging app and marketing bundle moves to the deployed revision, not only Teacher Units (prepare's live comparison will list every changed file). |
| Rules (conditional) | `firebase deploy --only firestore:rules --project lyfelabz-staging` | Only if R0 shows staging lacks A3-5. Not needed for function (callables use Admin SDK); needed so staging matches the callable-only security contract. Replaces the entire staging ruleset with the repository file, so R0 must show no unrelated drift. |

Not included: Firestore indexes (none required, `TEACHER_UNITS.md` section 3), Storage, Auth, production anything.

Order: F1, P1, H1 (backend before the client that calls it). If the staging teacher test account is not canonical `teacher` / `active` with a school in a district, Teacher Units refuses it; the owner chooses an existing staging teacher account.

**Rollback**

- Fast kill switch: `staging-ux-test-policy.cjs close` (server refuses everything at once).
- Hosting: roll back both staging sites to their pre-release versions (paired rollback, `DOMAIN_AND_HOSTING_CONTRACT.md`), or redeploy a `general` intent build.
- Functions: `firebase functions:delete <9 names> --region us-central1 --project lyfelabz-staging` (destructive; needs approval at the time).
- Rules: redeploy the previous ruleset captured in R0.
- Data: units, receipts and audit events created during testing remain; deleting them is a staging data mutation needing separate approval.

---

## 8. Files (implementation, all uncommitted for GitHub Desktop review)

**Modified (8)**

1. `platform/functions/src/teacherUnits/a3-enforcement.ts` (branch in `evaluateAvailabilityInTransaction`; header comment)
2. `platform/functions/src/teacherUnits/teacher-units.test.ts` (staging marker matrix through real handlers)
3. `app/scripts/build-application.cjs` (third intent and source, verify rules)
4. `app/scripts/build-application.test.js` (intent matrix; closed remains default)
5. `scripts/hosting-release/backend-state.cjs` (intent and candidate)
6. `scripts/hosting-release/prepare.cjs`, 7. `scripts/hosting-release/build-pair.cjs`, 8. `scripts/hosting-release/certify.cjs` (staging-only refusal)

**New (4)**

9. `platform/functions/src/teacherUnits/a3-staging-ux-test.ts`
10. `platform/functions/src/teacherUnits/a3-staging-ux-test.test.ts`
11. `scripts/teacher-units-release/staging-ux-test-policy.cjs`
12. `scripts/teacher-units-release/staging-ux-test-policy.test.cjs` (project pinning, create-only, close transition; no live calls)

**Docs (3, plus this file)**

13. `docs/platform/TEACHER_UNITS.md` (new staging UX test section; status lines)
14. `docs/platform/CURRENT_PLATFORM_STATE.md` (teacher units row)
15. As implemented, also: `scripts/hosting-release/backend-state.test.cjs` and `scripts/hosting-release/release.test.cjs` (staging-only refusals and fixtures), `.github/workflows/platform-ci.yml` (one step running the policy tool test). `hosting-identity.test.cjs` needed no change. The policy tool provides `show`, `enable` and `close` only; re-enabling after `close` is not provided.

Expected unchanged and asserted unchanged by tests: `a3-release-authority.ts`, `a3-composite-verifier.ts`, `releaseAvailability.ts`, `backendCompatibility.ts`, `firestore.rules`, `firestore.indexes.json`, `hosting-identity.cjs`, all D13 scripts.

## 9. Tests required before the deployment checkpoint

- Functions: staging marker policy enabled in staging identity (list, get, every mutation, discovery `enabled`); same policy refused (`deploymentIneligible`) for production identity, emulator identity and any project-number mismatch; non-marker enabled policy in staging still goes through the certified chain and is refused under UNCONFIGURED; marker policy with wrong placement refused; one marker but not the other refused. `npm --prefix platform/functions run test`, `typecheck`, `lint`, `build`; emulator suite where it runs.
- Rules: `npm --prefix platform/firebase run test:rules` (unchanged Rules; regression).
- App: `npm --prefix app run verify`; `build-application` tests prove `general` and `teacher-units` remain closed and `staging-ux-test` is origin-gated.
- Hosting tooling: the `HOSTING_TEST_FILES` suite, plus refusals of `staging-ux-test` for `lyfelabz-prod` in prepare, predeploy and certify.
- Production CLOSED regression: a `general` build's evidence still `availability: 'closed'`; production identity never eligible.

## 10. Owner decisions required

1. Approve invariant changes I1 to I6 for staging only.
2. Approve the 9 new staging callables, including the public invoker IAM binding the CLI applies to new callables.
3. Approve the one staging Firestore write (P1), and who runs it (needs ADC with staging Firestore write).
4. Staging Hosting source: deploy from the uncommitted working tree (staging tooling allows a dirty candidate) or after the owner commits.
5. Whether to include the staging Rules deploy after R0.
6. Which staging teacher account to use for testing.
