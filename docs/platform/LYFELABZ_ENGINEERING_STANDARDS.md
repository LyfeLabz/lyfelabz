# LyfeLabz Engineering Standards

**Status:** Canonical engineering reference
**Companion to:** LYFELABZ_PLATFORM_ARCHITECTURE.md
**Audience:** Every engineer who writes code inside `platform/`
**Scope:** All platform code for the next five years

This document is the engineering equivalent of the platform architecture documents. The architecture documents define **what** the platform is. This document defines **how** the code that implements it is written, organized, reviewed, and maintained.

It is deliberately opinionated. It exists so that every future contributor writes code that looks, reads, and behaves like every other piece of platform code, without having to reinvent conventions on each pull request.

If this document and a piece of existing code disagree, this document is authoritative and the code is a defect to be corrected during normal maintenance. If this document and the platform architecture documents disagree, the architecture documents win.

## Sprint 9B Reconciliation Notice

Operational behavior (hosting, environments, release pipeline, rollback, maintenance mode, authentication session policy, monitoring, incident response, Pilot Readiness Certification, GitHub Pages retirement) is defined by `PLATFORM_OPERATIONS_SPECIFICATION.md` and PDR-022. This document restates engineering-level obligations that follow from those operational commitments; it does not redefine them. Where this document and the operations specification conflict, the operations specification controls.

Engineering obligations that follow from Sprint 9B:

- Every production release passes through Preview. Local verification is not a substitute for preview verification.
- Preview deployment is automatic on merge to `main`; production deployment is never automatic. Production promotion requires recorded Platform Administrator approval (PDR-022d).
- A Certified Release is defined by the ten criteria of `PLATFORM_OPERATIONS_SPECIFICATION.md` §12. Documentation reconciliation is part of the release, not a follow-up.
- Rollback targets a previous Certified Release. Repairs are made in Preview, not on production.
- Firestore schema evolution is additive by default. Destructive changes require a documented migration plan, a paired backup, and named Platform Administrator approval.
- Cloud Functions and security rules are individually revertible.
- Production deployments never interrupt active classroom sessions. Client code must not force a mid-class reload for a new release (PDR-022h).
- Operational monitoring is scoped to platform health. Adding student behavioral telemetry beyond platform health requires a new PDR (PDR-022i).

---

## 1. Guiding Philosophy

The platform will be maintained by a small team for a long time. Every standard in this document flows from that reality.

- **One canonical implementation.** For each capability (auth, data access, error handling, logging, deployment, testing), there is exactly one blessed pattern. A second pattern requires a written decision, not a preference.
- **Simplicity over cleverness.** Clever code is a maintenance tax paid by every future contributor. Prefer the boring solution that a new engineer can read in one pass.
- **Consistency over novelty.** New folders, naming schemes, or abstractions require a documented reason. When in doubt, imitate the neighboring code.
- **Small, focused changes.** A pull request does one thing. Opportunistic refactors are a separate PR.
- **Boring is a feature.** The platform is not a place to experiment with the latest patterns. Choose well-understood tools and use them the well-understood way.
- **Deletion is a feature.** Dead code, unused config, and stale comments are defects. The cleanest change often removes more than it adds.
- **Avoid architectural drift.** If the code and the architecture documents diverge, one of them is wrong. Do not silently normalize the drift. Either update the code or open a decision to update the architecture.

---

## 2. Folder Organization

The top-level platform structure is fixed:

```
platform/
    firebase/       Firebase project configuration (firebase.json, firestore.rules, firestore.indexes.json, storage.rules, emulator config)
    functions/      Cloud Functions source code and tests
    docs/           Sprint-scoped engineering notes that are not architecture documents
```

Architecture documents live in `docs/platform/` at the repository root. Instructional lessons remain in the repository root and are unaffected by the platform layer.

Inside `functions/`, source is organized by **domain**, not by technical layer:

```
functions/src/
    auth/           Authentication triggers, user lifecycle
    teachers/       Teacher-facing server logic
    students/       Student-facing server logic
    classes/        Class creation, join codes, enrollment
    submissions/    Submission finalization, ownership stamping
    assignments/    Assignment lifecycle
    audit/          Audit log writers and readers
    shared/         Cross-domain utilities (typed Firestore refs, error types, logging)
```

Rules for folder organization:

- Each domain folder has an `index.ts` that exports the domain's public surface. Nothing else imports from files inside a domain folder.
- `shared/` contains only code that is truly cross-domain. If only two domains need it, it does not belong there yet.
- A domain folder may start as a placeholder (`README.md` plus an empty `index.ts`) when the architecture reserves the space but no code has landed. This is expected and preferred over creating the folder later.
- New top-level folders in `functions/src/` require a documented decision.

---

## 3. Naming Conventions

Names are one of the two things a future maintainer sees first (the other is the folder structure). They deserve care.

- **Files:** `kebab-case.ts`. One primary export per file. The file name matches the export (`join-code-minter.ts` exports `mintJoinCode`).
- **Directories:** `kebab-case`, singular for shared utilities, plural for domain collections (`classes/`, `submissions/`, `shared/`).
- **TypeScript identifiers:**
  - Types, interfaces, and classes: `PascalCase` (`ClassRecord`, `SubmissionOwnership`).
  - Functions, variables, and parameters: `camelCase`.
  - Constants that are true compile-time constants: `SCREAMING_SNAKE_CASE`. Configuration values that happen to be `const` are not constants in this sense and use `camelCase`.
  - Boolean names read as predicates: `isArchived`, `hasSubmitted`, `canJoin`.
- **Firestore collections and fields:** `camelCase` collection names (`classEnrollments`), `camelCase` field names. IDs are opaque strings; never encode meaning into an ID.
- **Cloud Function names:** `<domain><Action>` in camelCase (`authOnUserCreate`, `classesMintJoinCode`). The domain prefix is required so functions are grouped in the console.
- **Environment variables:** `SCREAMING_SNAKE_CASE`, prefixed with `LYFELABZ_` when they are platform-specific. Firebase-provided variables keep their Firebase names.
- **Feature flags:** none in Sprint 1. When introduced, they follow the same `LYFELABZ_` prefix rule and are documented in a decisions document.
- **Test files:** co-located with source, `<name>.test.ts` for unit tests, `<name>.rules.test.ts` for Firestore Rules tests.

Do not abbreviate unless the abbreviation is already universal in the domain (`id`, `url`, `db`). `submissionRecord` beats `subRec`.

---

## 4. TypeScript Conventions

TypeScript is the only language used inside `functions/`. Rules tests may be TypeScript or JavaScript per the emulator's guidance; prefer TypeScript.

- **Strict mode is mandatory.** `strict: true` in every `tsconfig.json`. No `noImplicitAny: false`, no `strictNullChecks: false`, no exceptions.
- **No `any`.** If a value's shape is unknown, use `unknown` and narrow. If a third-party type is missing, write a minimal declaration in `shared/types/` rather than reaching for `any`.
- **No non-null assertions (`!`) in production code.** If you know a value is present, narrow it with a type guard and throw a descriptive error if the guard fails. Non-null assertions are permitted in test fixtures only.
- **Explicit return types on exported functions.** Inferred return types are permitted inside a module but not across module boundaries.
- **Prefer `type` over `interface`** for data shapes. Reserve `interface` for object contracts that consumers may implement.
- **Discriminated unions over optional fields** when a value has genuinely different shapes. Optional fields describe optional data; unions describe alternative states.
- **Readonly by default.** Function parameters, exported types, and array fields use `readonly` unless mutation is a documented part of the contract.
- **No enums.** Use string literal unions (`type Role = "teacher" | "student" | "admin"`). Enums add runtime cost and interoperate poorly with Firestore.
- **No default exports.** Named exports only. Default exports break renames and hide intent.
- **`import type` for type-only imports.** Keeps runtime bundles honest.

Type definitions for Firestore documents live in `shared/types/` and are the single source of truth. Every Firestore read and write goes through a typed helper, never a raw `db.collection("...").doc("...").set(anyShape)` call.

---

## 5. Import Ordering

Every source file orders imports in the following groups, separated by a blank line. An automated formatter enforces this.

1. Node built-ins (`node:crypto`, `node:path`).
2. External packages (`firebase-admin`, `firebase-functions`).
3. Cross-domain platform imports (`@shared/...` or the relative path equivalent).
4. Same-domain relative imports (`./join-code-minter`).
5. Type-only imports, matching the same four groups above, each `import type`.

Within a group, imports are alphabetized by module path. Named imports within a single statement are alphabetized.

Circular imports are prohibited. If two modules need to reference each other, one of them is doing too much and needs to split.

---

## 6. Asynchronous Programming

- **`async`/`await` exclusively.** No `.then()` chains except at framework boundaries where the API demands them.
- **Never fire and forget.** Every promise is either awaited or explicitly handed to a supervisor (`Promise.all`, `Promise.allSettled`, or a background job runner). Unhandled promises are a defect.
- **Prefer `Promise.all` over sequential awaits** when operations are independent. Prefer sequential awaits when one operation depends on the result of another. Never `Promise.all` writes that must be ordered.
- **Cancellation.** Cloud Functions have a hard timeout. Long-running work must check for timeout budget and fail fast rather than run past it. Do not rely on the platform to kill a runaway function cleanly.
- **Idempotency.** Every triggered function (auth trigger, Firestore trigger, scheduled function) is written to be safe to invoke twice with the same input. Firebase retries. Assume it will.
- **No shared mutable state between invocations.** Module-level `let` bindings that survive invocations are a defect. Cache read-only lookups only, and only when profiling justifies it.

---

## 7. Logging Philosophy

Logs exist to answer one question: *what happened, and why?*

- **One logger.** All server code uses `firebase-functions/logger`. No `console.log`, no third-party logging libraries.
- **Structured, not stringly.** Log a message plus a structured payload: `logger.info("class.joinCode.minted", { classId, teacherId })`. Never interpolate values into the message string.
- **Event names are dotted, past-tense, domain-first.** `submissions.finalized`, `auth.userCreated`, `classes.enrollmentDenied`. The name identifies the event; the payload identifies the specifics.
- **Levels have meanings.**
  - `debug`: only useful when investigating a specific issue. Off in production.
  - `info`: a meaningful business event happened. The default for successful operations.
  - `warn`: something unexpected happened but the system recovered. A human should eventually look.
  - `error`: an operation failed in a way the system could not recover from. Paged if it happens often.
- **Never log secrets.** Never log full Firebase Auth tokens, session cookies, or user emails except where the event is inherently about the email (`auth.userCreated` may include it). PII beyond that is redacted.
- **Log at the seams.** Every entry to and exit from a Cloud Function logs one event. Internal helper functions log only when the event is meaningful on its own.

Silent failure is prohibited. If a code path can fail without an operator noticing, it needs a log line.

---

## 8. Error Handling

- **Errors are values, but they are also typed.** Define a small set of `PlatformError` subclasses in `shared/errors/` and throw those. Never throw a bare string. Never throw an object literal.
- **Fail closed.** When authorization, validation, or preconditions fail, throw immediately and log at `warn` or `error`. Do not proceed with degraded behavior.
- **Boundary translation.** Cloud Functions catch platform errors at the boundary and translate them into the appropriate Firebase Functions error (`HttpsError` for callable functions, structured log for triggers). Internal code never returns HTTP-shaped errors.
- **No swallowed catches.** `catch (e) { /* ignore */ }` is prohibited. If a caught error is truly ignorable, log it at `debug` with a one-line reason and move on.
- **No error-as-control-flow.** Errors signal failure. Do not throw to signal "not found" when a return value would communicate it more clearly.
- **Retries are explicit.** If a call may be retried, the retry happens in the code that owns the operation, not implicitly through wrapper libraries.

---

## 9. Testing Philosophy

Tests exist to give future maintainers confidence to change code. They are not a compliance exercise.

- **Firestore Rules tests are mandatory.** Every rule change lands with tests that cover both the allow path and at least one deny path. Rules tests run in CI on every PR.
- **Function unit tests are recommended in Sprint 1, mandatory in Sprint 2.** By Sprint 2, every Cloud Function ships with tests that cover the happy path, the primary failure mode, and the idempotency contract.
- **Integration tests use the Firebase Emulator Suite.** Never against a real project.
- **Test names describe behavior, not implementation.** `"denies a student from reading another student's submission"` beats `"returns false"`.
- **Fixtures live next to their tests.** No shared global fixture bag.
- **No snapshot tests for logic.** Snapshots are appropriate for rendered output, not for business rules.
- **Test doubles are typed.** Any mock or stub uses the same types as the real object. `as any` inside a test is a defect just as it is in production code.
- **Coverage is a trailing indicator, not a target.** Do not write meaningless tests to raise a number.

---

## 10. Documentation Expectations

Documentation is code that describes code. It ages the same way and needs the same care.

- **Architecture belongs in `docs/platform/`.** Sprint-scoped engineering notes belong in `platform/docs/`. Nothing important lives only in a PR description.
- **Every domain folder has a `README.md`** that answers three questions in three short paragraphs: what is this domain responsible for, what does it depend on, and what depends on it.
- **Every exported function has a doc comment** that states its purpose, its inputs, its outputs, and any non-obvious constraint (idempotency, ordering, retryability). Doc comments do not restate the type signature.
- **Do not write comments that describe what the code does.** A well-named function and clear code make the *what* obvious. Comment only when the *why* is non-obvious: a hidden constraint, a workaround, a subtle invariant.
- **Update the doc when you change the code.** A stale doc is worse than no doc.
- **Delete obsolete documentation.** A markdown file that no longer reflects reality is a defect. Prune with the same rigor as dead code.

---

## 11. File and Function Size

Size limits are guidelines, not absolutes. They exist so that "this file is getting big" happens during code review, not during a 3 a.m. incident.

- **Files:** target under 200 lines. A file over 400 lines needs a justification in review.
- **Functions:** target under 40 lines. A function over 80 lines needs a justification in review.
- **Cyclomatic complexity:** target under 10. Higher requires a comment explaining why the branching is essential.
- **Parameter counts:** target under 4. More than 4 parameters usually means the function is doing two jobs or wants a typed options object.

These are review triggers, not blockers. The right response to a large file is usually a split; occasionally the right response is a comment explaining why the size is intrinsic to the problem.

---

## 12. Code Review Checklist

Every pull request is reviewed against this checklist. Reviewers may add domain-specific checks; they may not remove items from this list.

1. **Scope.** Does the PR do exactly one thing? Are unrelated changes split out?
2. **Architecture alignment.** Does the change respect the current architecture documents? If it evolves the architecture, is there a corresponding decision document?
3. **Canonical patterns.** Does the change use the one blessed pattern for auth, data access, error handling, and logging? If it introduces a new pattern, is that justified in the PR description?
4. **Naming and structure.** Do file names, function names, and folder placement match Sections 2 and 3?
5. **Types.** Is `any` absent? Are exported functions explicitly typed? Are Firestore reads and writes going through typed helpers?
6. **Errors and logs.** Are failures logged at the right level? Are errors typed? Are secrets redacted?
7. **Tests.** Do Firestore Rules changes have new tests? Do new functions have (Sprint 2+) unit tests? Do tests describe behavior?
8. **Docs.** Are affected READMEs and doc comments updated? Is anything now stale?
9. **Security.** Does the change respect the default-deny model? Does it grant any permission that was not explicitly requested by a sprint?
10. **Migration and compatibility.** Does the change rename fields, IDs, or URLs? If so, is there a migration plan or a compatibility shim with an expiration date?
11. **Deletion.** Does the change leave behind dead code, unused config, or stale comments? Are they removed?
12. **CI.** Does lint, typecheck, build, and Rules tests pass? Are any warnings introduced?

A review that only says "LGTM" is not a review. A reviewer's approval is a statement that they have walked the checklist.

---

## 13. One Canonical Implementation

This principle is important enough to state as its own section.

For every capability the platform needs, there is exactly one blessed pattern:

- **Authentication:** Firebase Auth, Google Sign-In, single client-side SDK call.
- **Data access on the client:** Firestore SDK, through typed helpers in `shared/`.
- **Data access on the server:** Firebase Admin SDK, through the same typed helpers.
- **Error handling:** typed `PlatformError` subclasses, translated at function boundaries.
- **Logging:** `firebase-functions/logger`, structured payloads, dotted event names.
- **Configuration:** environment variables with `LYFELABZ_` prefix, loaded once at function cold start.
- **Deployment:** Firebase CLI from CI, no local deploys to production.
- **Testing:** Firebase Emulator Suite plus Jest (or the framework equivalent chosen in Sprint 2).

A second pattern is a defect. If a new pattern is genuinely needed, it replaces the previous one across the codebase in the same sprint. Two patterns for the same job never coexist for more than a single sprint.

---

## 14. Maintainability Principles

- **Optimize for reading, not writing.** The code will be read a hundred times for every time it is written.
- **Prefer explicit over implicit.** Magic is fun to write and painful to debug. Wire dependencies explicitly.
- **No premature abstraction.** Three similar lines are better than the wrong abstraction. Extract when the third instance clarifies the shape, not before.
- **No premature generalization.** A function that takes seven parameters "for flexibility" almost always ships with one caller.
- **Keep the seams stable.** Public interfaces of a domain folder change rarely and deliberately. Internal implementation changes freely.
- **Own the boring parts.** Configuration files, CI, and READMEs are part of the codebase. They receive the same care as production code.

---

## 15. Avoiding Architectural Drift

Architectural drift is what happens when small, individually reasonable decisions accumulate into a codebase that no longer matches the architecture documents. It is the single largest long-term risk for a small team.

Rules for preventing drift:

- **Sprints open surfaces.** No production code exists for a capability the architecture has not yet described. If a sprint discovers a missing architectural decision, the sprint pauses and the decision is made in writing before the code lands.
- **Decisions are recorded.** Every meaningful engineering choice that is not already stated in an architecture document is recorded in `docs/platform/LYFELABZ_PLATFORM_DECISIONS.md` with a date, a rationale, and (if relevant) the alternatives considered.
- **Reviewers block drift.** A pull request that quietly introduces a second pattern for an existing capability, or that adds a folder outside the canonical structure, is asked to either revert or open a decision document. Both are acceptable; silent divergence is not.
- **Periodic audits.** At the end of each sprint, the engineering standards and the architecture documents are reviewed against the code. Anything that has drifted is either corrected or documented as an intentional evolution.

Drift is not prevented by good intentions. It is prevented by a review culture that treats consistency as correctness.

---

## 15A. Sprint 9A Operational Standards for the Assessment Pipeline

The formative assessment pipeline is governed by `ASSESSMENT_PIPELINE_SPECIFICATION.md` and PDR-021. Every operational obligation below applies to platform code and platform operations:

**Server scoring.**

- Attempt writes originate only from the Cloud Function scorer. No client role holds a direct write path to the attempt collection.
- The scorer computes the aggregate score, item-level correctness, and item-level points earned against the server-confidential answer key. The scorer's return payload is the sole source of truth for the browser's post-submission display.
- The scorer is idempotent under retry. Every submission carries a client-supplied idempotency marker; the scorer deduplicates on the marker.
- Scorer outages are teacher-visible only as submission failures. Sessions are not expired by scorer downtime; session expiration is measured from student activity, not from platform activity.

**Answer key protection.**

- Answer keys are held in a server-controlled surface readable only by the scorer's admin-authority code path.
- Answer keys are never delivered to a client before submission. No client-reachable artifact (network payload, CDN asset, JavaScript bundle, cached response) contains an answer key.
- Answer keys are versioned with the internal assessment revision identifier. Deploying an answer-key change without a matching revision boundary is prohibited.

**Session retention.**

- Session expiration: platform default 24 hours from last student activity. Configurable operational constant. Not exposed to teachers.
- Grace period: platform default 1 hour after assignment close, for sessions live at close. Configurable operational constant. Not exposed to teachers.
- Session storage lives in its own collection, distinct from attempts. Sessions are never mutated into attempts; the scorer produces the attempt as a new document.

**Archived session retention.**

- Archived sessions are retained for a bounded recovery window (a configurable operational constant) and are then deleted under the platform's ordinary retention policy.
- Session recovery from the archived state runs only through a server-side callable. Clients cannot promote an archived session back to live on their own authority.
- Archived sessions are never counted as attempts and never appear on teacher-facing surfaces as attempts.

**Immutable attempts.**

- Attempts are immutable. Security Rules deny update and delete on the attempt collection for every client role.
- Administrative correction paths, if introduced, run through an audited server-side callable that writes an adjacent correction record. The attempt itself is never overwritten.
- Rollups are recomputable from attempts. Attempts are not recomputable from rollups. Any dispute between the two is resolved by reading the attempt.

**Assignment lifecycle.**

- Every assignment belongs to exactly one class. Assigning one activity to multiple classes is implemented as automatic server-mediated fan-out into N assignment records, one per class.
- Assignment lifecycle events - publication, closure, grace-period activation, archival - are recorded as audit events.
- Closed assignments never re-open. A teacher who wishes to re-authorize an activity publishes a new assignment.

**Assessment revisions.**

- The internal assessment revision identifier is platform-owned and platform-authored. Revision identifiers never appear on teacher-facing or student-facing surfaces.
- Every attempt records the internal revision identifier at the moment of submission. Historical attempts remain interpretable across later revisions.

Deviations from these operational standards require a Platform Decision Record amendment. Silent divergence is treated as a defect under Section 15.

---

## 16. Living Document Rules

This document evolves, but slowly.

- Changes to any section require a pull request, a rationale, and (for anything other than typo fixes) a note in `LYFELABZ_PLATFORM_DECISIONS.md`.
- Backwards-incompatible changes (renaming a canonical pattern, changing folder structure) require an accompanying migration plan.
- The document is reviewed in full at the end of every second sprint, at minimum.
- If a rule in this document is found to be unhelpful in practice, it is changed. Rules exist to serve maintainers, not the other way around.
