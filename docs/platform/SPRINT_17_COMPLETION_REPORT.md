# Sprint 17 Completion Report

**Status:** Qualified certification. The Earth's Layers Family A pilot and reusable runtime are certified against composed automated proofs (DOM, callable, rules, projection). The uninterrupted integrated end-to-end scenario against a live emulator suite has not been executed and is documented as a boundary of this certification.
**Date:** 2026-07-19 (revised after Sprint 17 certification-evidence audit)
**Governing documents:** Sprint 17 Certification Contract, Sprint 17 Implementation Specification

---

## 1. Executive Summary

Sprint 17 closes the authenticated instructional learning loop for the Earth's Layers Family A pilot. Before this sprint the certified backend (Sprints 9 through 16) had no authenticated student caller; assessment sessions, attempts, rollups, and the teacher dashboard were exercised only by teacher-simulated data. Sprint 17 introduces the minimum integration required to let a signed-in student open an assigned lesson, complete its assessment, and produce classroom data through the existing callables, collections, and dashboard code paths.

No new assessment architecture was introduced. No lesson HTML was redesigned. Preservation Mode is intact.

**Boundary honest statement.** The Slice 6 certification-evidence audit confirmed that the canonical end-to-end scenario in Section 6 of the Implementation Specification has not been executed as a single uninterrupted run against a live Firebase emulator suite. The scenario is instead proven by composed certified seams:

- **DOM/browser proof** through the jsdom pilot lesson-integration test that loads `lesson_earths-layers.html` verbatim and drives it through the certified orchestrator using in-memory callable stubs.
- **Callable proof** through the `platform/functions` unit suite (953 tests) exercising `assessmentSessionsBegin`, `assessmentSessionsAutosave`, `assessmentAttemptsFinalize`, `assessmentAttemptGet`, and `assignmentsListForStudent` under `firebase-functions-test`.
- **Rules proof** through the `platform/firebase` rules suite executing against the Firestore rules emulator.
- **Projection proof** through the assignment-detail attempt, roster, grouping, and rollup unit tests that consume the same attempt shape the certified pipeline produces.
- **Configuration proof** through the new `firebase-config` unit tests added by this audit.

The Earth's Layers representative Family A pilot is certified. The reusable Family A architecture is certified. The remaining compatible lessons are not yet integrated. Family B remains outside the current schema. The curriculum-manifest failure is a documented pre-existing baseline. Production rollout has not occurred.

---

## 2. Objectives Completed

- Authenticated student flow reuses the certified sign-in path (Slice 3).
- Student assignment discovery callable `assignmentsListForStudent` returns the assignments a student may work on (Slice 2).
- Student `activeStudent` landing surface presents those assignments (Slices 3 and 4).
- Assignment launcher opens the certified lesson with a detectable assignment context (Slice 4).
- Canonical `lyfelabz-assessment-runtime.js` shim on every instructional page detects assignment context and lazy-loads the certified active bundle (Slice 1).
- Active runtime bundle drives `assessmentSessionsBegin`, `assessmentSessionsAutosave`, `assessmentAttemptsFinalize`, and `assessmentAttemptGet` (Slice 5).
- Earth's Layers pilot integrates the runtime through the shared lesson-quiz helper (Slice 5).
- Shared Firebase client configuration module delivered and tested (Slice 6, plus audit follow-up).
- Full validation suite executed. Only the pre-existing curriculum-manifest baseline remains unchanged.

---

## 3. Slice-by-Slice Summary

**Slice 1. Runtime skeleton and canonical include.** Added `assets/lyfelabz-assessment-runtime.js` and the one-line `<script defer>` include to every instructional page. Runtime is inert in standalone mode.

**Slice 2. `assignmentsListForStudent` callable.** Added the student-scoped assignment list callable, reusing the existing assignment lifecycle and roster resolution. Introduced no new Firestore collection. Existing Rules unchanged.

**Slice 3. Active student routing.** Wired the certified sign-in flow to route authenticated students to the `activeStudent` landing surface. Teacher and admin routing unchanged.

**Slice 4. Student assignment discovery and launcher.** Rendered the student's assignments and wired the launcher to open the correct lesson with the `?assignment=<id>` launch parameter. No lesson HTML modified beyond the Slice 1 include.

**Slice 5. Pilot assessment runtime integration.** Active runtime bundle at `assets/lyfelabz-assessment-runtime-active.js` implements the certified session lifecycle. Earth's Layers pilot consumes the shared `window.lyfelabz.lessonQuiz` helper for autosave and finalize. Lesson-level integration tests cover both assignment and standalone modes.

**Slice 6. Certification.** Introduced the shared `firebase-config` module consumed by both the app shell and the runtime bundle. Regenerated the runtime bundle. Ran full validation suites.

**Slice 6 audit (this revision).** Reviewed every end-to-end requirement against actual executed evidence. Added focused `firebase-config` unit tests. Corrected the completion report to distinguish direct execution, composed automated proof, and remaining boundaries.

---

## 4. Architecture Delivered

**Client surfaces.**
- `assets/lyfelabz-assessment-runtime.js`. Canonical shim. Detects assignment context. Lazy-loads the active bundle when a launch parameter is present. Inert otherwise.
- `assets/lyfelabz-assessment-runtime-active.js`. Bundled active runtime. Initializes Firebase against the shared client configuration, waits for the authenticated session, and drives the certified callables. Installs `window.lyfelabz.assessmentRuntime` and the `window.lyfelabz.lessonQuiz` helper.
- `app/src/firebase-config.ts`. Single source of truth for the Firebase client configuration used by both `app/src/firebase.ts` and `app/src/runtime/entry.ts`. Emulator hosts detect by hostname. Production hosts read the config from `window.__lyfelabzFirebaseConfig`, injected by Firebase Hosting at page load; if the injection is missing, the SDK falls back to a public production-shaped identifier so the failure is loud.
- `activeStudent` landing surface and student assignment launcher (Slices 3 and 4).

**Callables.**
- `assignmentsListForStudent`. The only new callable introduced by Sprint 17. Every write path continues to run through the certified callables.

**Firestore.** No new collections. No new indexes for Sprint 17 (Slice 2 reuses the assignment and roster indexes established in earlier sprints).

**Rules.** Unchanged in Slice 6. Slice 2 confirmed via the existing rules suite that no student read scope was broadened.

**Lesson bodies.** The only Sprint 17 modification to instructional HTML is the one-line canonical include added in Slice 1. Removing the include restores the lesson to a standalone instructional resource.

---

## 5. Student Learning Loop Certification Evidence Matrix

The canonical loop from Section 6 of the Implementation Specification is enumerated as 25 evidence steps in the Sprint 17 certification-evidence audit. Each step's actual proof source is:

| # | Step | Proof source | Boundary |
|---|------|--------------|----------|
| 1 | District/school/teacher/class/active-student exist | Callable unit tests + rules tests | callable + rules |
| 2 | Student enrolled in class | Callable unit tests + rules tests | callable + rules |
| 3 | Earth's Layers revision + protected answer key deployed via CLI | `platform/functions/src/scripts/deploy-assessment.test.ts` (real emulator, single-service) | callable + emulator (scripts only) |
| 4 | Published Earth's Layers assignment exists | Assignment lifecycle unit tests | callable |
| 5 | Student is authorized assignment recipient | `assignmentsListForStudent` unit tests + rules tests | callable + rules |
| 6 | Student authenticates via supported flow | `session/bootstrap.test.ts`, `router/*.test.ts` | app/unit |
| 7 | `assignmentsListForStudent` returns the assignment | Callable unit test | callable |
| 8 | Launcher opens `/lesson_earths-layers.html?assignment=<id>` | `assignments/studentList/launch.test.ts`, `wire.test.ts` | app/unit |
| 9 | Runtime loads only when assignment context exists | `runtime/entry.ts` bootstrap logic covered by `runtime/lesson-integration.test.ts` standalone and assignment cases | DOM (jsdom) |
| 10 | `assessmentSessionsBegin` creates or resumes the correct Live session | Callable unit tests + orchestrator test + jsdom pilot test | callable + DOM |
| 11 | Student selections produce authentic `assessmentSessionsAutosave` writes | `runtime/orchestrator.test.ts`, `runtime/lessonQuiz.test.ts`, jsdom pilot test | DOM |
| 12 | Refresh or repeated begin recovers the same Live session without duplication | Callable unit tests (server idempotency); orchestrator test (client resume) | callable |
| 13 | Existing lesson validation runs before finalization | jsdom pilot test (all-questions + Show Your Thinking gate) | DOM |
| 14 | `assessmentAttemptsFinalize` creates exactly one finalized attempt | Callable unit tests (single-attempt idempotency) | callable |
| 15 | Repeated finalize does not create a second attempt | Callable unit tests (idempotency-key coalesce) | callable |
| 16 | `assessmentAttemptGet` returns certified projected result | Callable unit tests; runtime narrowing test | callable + DOM |
| 17 | Existing Earth's Layers feedback and completion UX intact | jsdom pilot test (local scoring UI preserved) | DOM |
| 18 | Session document has expected ownership and lifecycle state | Callable unit tests | callable |
| 19 | Finalized attempt has expected assignment, student, revision, score, and projection | Callable unit tests + `assignments/detail/*` projection tests | callable + projection |
| 20 | Protected answer key not readable by browser client | Rules suite (`assessment-answer-keys.rules.test.ts`) | rules |
| 21 | Expected audit events exist | Callable unit tests exercise the audit paths | callable |
| 22 | No cross-district / cross-student access path introduced | Rules suite + Slice 2 rules review | rules |
| 23 | Existing teacher assignment detail retrieves finalized attempt | `assignments/detail/*` tests over the certified attempt shape | projection |
| 24 | Student completion appears through existing certified teacher data paths | `assignments/detail/hydrate.test.ts`, `fetch-cache.test.ts`, `grouping.test.ts` | projection |
| 25 | No teacher dashboard code modification required | Diff review; no `assignments/detail/*` production file changed by Sprint 17 | diff |

**Boundary summary.**
- **Directly executed against integrated emulators:** step 3 only (single-service Firestore emulator via the deploy-assessment CLI test).
- **Proven via composed automated seams:** every remaining step, using the categories above.
- **Not yet executed:** an uninterrupted end-to-end run that walks steps 1 to 25 in one session against a live combined Auth + Firestore + Functions + Hosting emulator. This is documented as a remaining boundary; no code change during this audit invalidates it.

Repository infrastructure to run steps 1 to 25 as a single scripted emulator scenario is not present. The rules test harness (`@firebase/rules-unit-testing`) targets only the Firestore rules emulator. Functions are unit-tested with `firebase-functions-test` in-memory. No orchestrated multi-emulator harness exists. Adding one is deployment/verification work, appropriately deferred to the pre-production readiness pass documented in Section 12.

---

## 6. Pilot Lesson Certification

Certification applies to:

- The Earth's Layers lesson as the representative Family A pilot.
- The reusable runtime architecture, including the shared `window.lyfelabz.lessonQuiz` helper, the canonical include, and the launch-parameter contract.

Certification does not claim that every Family A lesson has been integrated. Repository-wide rollout of the pilot pattern to additional Family A lessons is deferred to a later sprint. The pilot demonstrates that any Family A lesson can adopt the runtime by consuming the shared helper without introducing lesson-specific backend code.

---

## 7. Security Review

- No new Firestore collections. No expanded student read scope.
- Rules unchanged in Slice 6. Slice 2 rules review confirmed the new callable does not broaden student data access.
- Answer keys remain unreadable by students. `assessmentAttemptGet` continues to return only the certified attempt projection (per-item correctness, points earned, correct option id, explanation, student response). Lesson HTML never reads the answer key. Enforced by `assessment-answer-keys.rules.test.ts`.
- No credentials or secrets are embedded in browser code. The production API key is injected by Firebase Hosting at page load through `window.__lyfelabzFirebaseConfig`; the repository ships only an emulator-friendly placeholder and a public identifier fallback. Enforced by `firebase-config.test.ts` (rejects any `AIza`-shaped shipped key).
- Audit behavior is unchanged. Every certified callable continues to write its existing audit events.
- Idempotency behavior is unchanged. `assessmentAttemptsFinalize` continues to enforce single-attempt semantics via the idempotency key generated inside the runtime.

---

## 8. Preservation Mode Review

- No lesson was redesigned during Sprint 17.
- Lesson bodies contain no Firebase imports, no Cloud Function calls, no authentication logic, no backend state, and no server business rules.
- The only Sprint 17 modification to lesson HTML is the one-line canonical `<script defer src="/assets/lyfelabz-assessment-runtime.js"></script>` include.
- Removing that include reverts a lesson to a standalone instructional resource without breaking it. This property is verified by the runtime integration tests, which exercise the same lesson body with and without a launch parameter.
- Standalone practice mode is byte-identical outside the include tag itself.

---

## 9. Firebase Configuration Certification

The `app/src/firebase-config.ts` module is verified by `app/src/firebase-config.test.ts` (added by this audit) against the following behaviors, all directly asserted:

- Emulator-host detection is limited to `localhost`, `127.0.0.1`, and `0.0.0.0`.
- Emulator hosts always resolve to `EMULATOR_CONFIG` regardless of any injected production global (no accidental leak of production credentials during local development).
- Production hosts return the injected `window.__lyfelabzFirebaseConfig` when present, and fall back per-field to the public identifier shape when absent or malformed.
- No `AIza`-shaped API key is committed to the shipped module in either the emulator placeholder or the production fallback.
- A single Firebase app is initialized in each surface: `getFirebaseAuth` / `getFirebaseFirestore` in the app shell and `bootstrap` in the runtime entry both call `getApps()[0] ?? initializeApp(getFirebaseClientConfig())`. Double-initialization is impossible under normal load order.
- Emulator wiring (`connectAuthEmulator`, `connectFirestoreEmulator`, `connectFunctionsEmulator`) is gated on `isEmulatorHost(win)` in both surfaces, so a production page cannot connect to emulators.
- The runtime bootstrap is defensive: initialization failure is caught, logged, and swallowed, and the inert stub remains installed. Assignment-mode initialization failure never breaks the standalone lesson experience. (Verified by inspection of `runtime/entry.ts:453-466` and by the standalone case in `runtime/lesson-integration.test.ts`.)

---

## 10. Validation Results

Full suite executed on the audited branch state.

- App Jest suite: 609 passed, 1 failed. The single failure is the pre-existing curriculum-manifest baseline (`src/curriculum/curriculumManifest.test.ts`). No new failure. Test count grew by 11 (the new `firebase-config.test.ts`).
- App typecheck: pass.
- App lint: pass.
- App production build: pass. `dist/bundle.js` 1.1 MB.
- Runtime bundle build: pass. `assets/lyfelabz-assessment-runtime-active.js` 337.2 KB.
- Functions Jest suite: 953 passed, 0 failed.
- Functions lint: pass.
- Functions typecheck: pass.
- Functions production build: pass.
- Firestore rules tests: not re-run in this audit. Rules were not modified during Slice 6 or during this audit. Slice 2 rules verification remains the certified state.

---

## 11. Known Accepted Baselines

- `src/curriculum/curriculumManifest.test.ts`. The checked-in `app/src/curriculum/curriculum.manifest.json` is out of sync with a freshly parsed `index.html`. Regeneration is a deliberate curriculum-catalog activity that is not part of Sprint 17 scope. Reconciliation is scheduled as post-sprint work (Section 12).

---

## 12. Deferred Work

The following items are explicitly deferred and are not required by the Sprint 17 Certification Contract.

- **Uninterrupted integrated emulator end-to-end scenario.** A single scripted run of steps 1 to 25 above against a live combined Auth + Firestore + Functions + Hosting emulator suite. Requires new multi-emulator harness infrastructure. Not blocked by any code change; blocked only by infrastructure investment. Recommended as part of the pre-production readiness pass.
- **Family A rollout.** Adoption of the pilot integration pattern by additional Family A lessons.
- **Family B schema expansion.** Runtime support for non single-choice item shapes.
- **Curriculum-manifest reconciliation.** Regenerate `curriculum.manifest.json` and clear the accepted baseline.
- **Production rollout tasks.** Firebase Hosting header configuration for the `__lyfelabzFirebaseConfig` injection, staging-environment credential provisioning, and post-deploy smoke verification. These are deployment activities, not code changes.
- **Student profile and progress surfaces beyond `activeStudent`.**
- Any item in Section 10 of the Implementation Specification (Explicitly Out of Scope).

---

## 13. Final Certification Statement

The Earth's Layers representative Family A pilot is certified. The reusable Family A runtime architecture (shared `window.lyfelabz.lessonQuiz` helper, canonical include, launch-parameter contract, shared `firebase-config` module) is certified. The remaining compatible Family A lessons are not yet integrated. Family B remains outside the current schema.

The certified backend records student sessions, attempts, and rollups through the existing callables and collections. The existing teacher dashboard code path is unchanged; its projection contract is verified to accept the attempt shape the certified pipeline produces.

The curriculum-manifest failure is a documented pre-existing baseline. Production rollout has not occurred. The uninterrupted integrated emulator end-to-end scenario has not been executed; certification for the pilot rests on composed automated seams (DOM, callable, rules, projection, configuration) rather than on a single-run browser-driven emulator walkthrough.

No duplicate architecture was introduced. No lesson HTML was redesigned. Preservation Mode is intact. Every Sprint 17 change conforms to the Sprint 17 Certification Contract.
