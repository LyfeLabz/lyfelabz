# Sprint 13H Completion Report: Draft Publication Workflow

**Date:** 2026-07-17
**Status:** Implementation complete; conditionally certified pending resolution or formal acceptance of the pre-existing `curriculum/curriculumManifest.test.ts` repository baseline failure.
**Preceding sprint:** Sprint 13G (Draft Editing Foundation).

## 1. Architecture Review

Reviewed before implementation:

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `docs/platform/SPRINT_13A_COMPLETION_REPORT.md` through `SPRINT_13G_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_HISTORY.md`
- `platform/functions/src/assignments/` (specifically `assignments-publish.ts`, `assignments-publish.test.ts`, `assignments-close.ts`, `assignments-reopen.ts`, `assignment-recipients.ts`, and shared district-context / audit / batch helpers).
- `app/src/assignments/detail/` (types, detail, wire, hydrate, hydrate-wire, close-wire, reopen-wire, update-wire, registry, grouping).
- `app/src/shell/surfaces/curriculum.ts` (Sprint 13B / 13C / 13F selection interface: `View drafts` / `View summary` / `View summaries` derived from `assignments.every((a) => a.status === "draft")`).
- `app/src/index.ts` (per-session assignment-detail wiring).

## 2. Publish Decision (Option A: Reuse)

A certified `assignmentsPublish` callable already exists at `platform/functions/src/assignments/assignments-publish.ts`. It performs the canonical `draft -> published` lifecycle transition per Data Model §3.6, atomically batches the assignment status write with the initial recipient snapshot, writes the canonical audit event, and rejects every non-draft current status with `assignments.invalidTransition` (an already-`published` record short-circuits to an idempotent no-op). Its authorization gate uses the shared `requireDistrictContext` helper plus the canonical ownership guard (`teacherId === actor.uid && schoolId === actor.schoolId`). Its recipient population read uses the shared `loadInitialRecipientPopulation` helper, filtered by frozen `classId` and defense-in-depth-filtered against frozen `schoolId` and `status === "active"`. Seventeen backend tests cover the callable end-to-end.

Selected **Option A: reuse the existing certified `assignmentsPublish` callable unchanged.** No callable extension, no schema change, no request-contract change, no additive response field, no Firestore Rules relaxation, and no composite index was required by this sprint's user experience.

## 3. Authorization

Reused verbatim from the certified `assignmentsPublish` handler:

- Active-teacher gate: `requireDistrictContext(request)` resolves the caller's `{ uid, schoolId, districtId }` from the canonical district-boundary infrastructure; a non-teacher context yields `role-forbidden`.
- Ownership + school gate: `existing.teacherId === actor.uid && existing.schoolId === actor.schoolId`; every other combination yields `assignments.forbidden`.
- District boundary: the assignment's authoritative `districtId` is derived from the caller's district context (never trusted from the payload). Sprint 10A F1 guarantees the caller's district context matches the district that owns their school.
- Lifecycle guard: only `draft -> published` advances; `published` is idempotent; every other status yields `assignments.invalidTransition`.
- Request payload: only `{ assignmentId }` is accepted; the callable never trusts client identity.

The Assignment Detail surface's `publishCallable` seam only sends `{ assignmentId }`. The `PublishConfirmController` cannot bypass the seam and cannot inject any additional payload field.

## 4. Registry Behavior

On success the Assignment Detail surface freezes a new `AssignmentDetailMetadata` copy with `status: "published"`, updates its own `state`, and fires `onStatusChange(nextMetadata)`. The entry point wires `onStatusChange` to `assignmentDetailRegistry.register(metadata)`, which mutates the session-scoped registry in place. The registry is a pure in-memory map keyed by canonical `assignmentId`; the same key overwrites the prior Draft entry.

No page reload, no listener, no polling, and no callable roundtrip is required to reflect the new status in the registry. The registry is rebuilt per active-teacher session by `hydrateAssignmentDetailRegistry` on next bootstrap; the in-session mutation is authoritative for the remainder of the session.

## 5. Curriculum Transition

The Curriculum surface derives its lesson-card affordance from `assignments.every((a) => a.status === "draft")`:

- All-draft assignments render `View drafts`.
- Any-non-draft assignment renders `View summary` (single) or `View summaries` (multiple) per Sprint 13B / 13C.

When the teacher clicks Back after a successful publish, the entry point's `onBack` handler calls `rerun()`, which re-dispatches the router. The router re-renders Curriculum using the seam's `list()`, which returns the current registry contents (including the newly re-registered `published` metadata). The lesson card automatically flips from `View drafts` to `View summary` (single-assignment case) or `View summaries` (multi-assignment case) per Sprint 13C behavior. No page reload is triggered.

The transition is exercised end-to-end by the existing Curriculum tests (`publishing a second assignment for the same lesson flips View summary to View summaries`, `single hydrated draft shows View drafts and opens directly`, etc.). Sprint 13H introduces no new Curriculum surface changes.

## 6. Files Created

- `app/src/assignments/detail/publish-wire.ts` - entry-point wire for the certified `assignmentsPublish` callable; mirrors `close-wire.ts` / `reopen-wire.ts` / `update-wire.ts`. Isolated from the pure Detail surface so the surface never imports from `firebase/*`. Returns the canonical `{ assignmentId, status: "published", alreadyPublished }` and rejects with a generic Error on shape mismatch or callable rejection.
- `app/src/assignments/detail/publish-wire.test.ts` - four wire tests: happy-path invocation and shape assertion, idempotent already-published response passthrough, malformed shape rejection, callable rejection propagation.
- `docs/platform/SPRINT_13H_COMPLETION_REPORT.md` - this document.

## 7. Files Modified

- `app/src/assignments/detail/types.ts` - added `AssignmentsPublishResult` and `AssignmentsPublishCallable` seam types alongside the Sprint 13D / 13E / 13G analogues.
- `app/src/assignments/detail/detail.ts`:
  - Added `publishCallable?: AssignmentsPublishCallable` optional dep.
  - Added `PublishUiState` state machine (`idle`, `pending`, `error`).
  - Rendered a `Publish assignment` button on the draft branch when the seam is wired, alongside the Sprint 13G `Edit draft` action. Hidden while the inline editor is open (the editor supersedes the calm draft label branch that hosts the button).
  - Added the canonical publish confirmation dialog (`renderPublishConfirmDialog`) matching the Sprint 13D / 13E body-attached overlay with `role="dialog"`, `aria-modal="true"`, Escape and backdrop cancel, and the required copy: `Publish this assignment? / Students in the frozen recipient list will be able to begin submitting work. / Cancel / Publish assignment`.
  - `openPublishConfirmation`, `performPublish` handlers wired into `renderReady`'s handlers block. `performPublish` invokes the callable exactly once, freezes a new metadata copy with `status: "published"`, updates `state`, clears sibling lifecycle UI state (`closeUi`, `reopenUi`), rerenders, and fires `onStatusChange`. On failure sets `publishUi` to `error` and rerenders without mutating `state`.
  - Failure banner (`assignment-detail-publish-error`) with `role="alert"` and calm generic copy: `We could not publish this assignment right now. Try again in a moment.` No callable name, Firestore path, stack trace, or internal error is exposed.
- `app/src/assignments/detail/detail.test.ts` - eleven appended Sprint 13H client tests covering: draft renders Publish action (7); publish never on published (8, 18); publish never on closed (9, 18); action hidden without callable (10); dialog opens on click (8); cancel path (9); success path with registry re-registration + summary card re-composition + all draft affordances removed (11-16); failure path preserves Draft state, editor stays closed, and the error banner is generic (17); publish action hidden while the editor is open (18).
- `app/src/index.ts` - imported `createAssignmentsPublishCallable`; added `assignmentPublish: AssignmentsPublishCallable | null` per-session slot; created the callable on the `activeTeacher` branch; cleared it on every other bootstrap outcome; wired `publishCallable: assignmentPublish ?? undefined` into the Detail surface deps.
- `docs/platform/SPRINT_HISTORY.md` - Sprint 13H entry appended.

## 8. Tests

### 8.1 Backend

Reused unchanged: the seventeen tests in `platform/functions/src/assignments/assignments-publish.test.ts`. Every checklist item is covered:

1. Owner publishes draft: covered (`assignmentsPublish transitions a draft assignment to published for its owning teacher`, `writes the initial recipient snapshot from the frozen class enrollment`, `commits the recipient snapshot and status write atomically`).
2. Wrong owner rejected: covered (`rejects cross-teacher and cross-school owners`).
3. Wrong district rejected: covered (a non-teacher / mismatched-district caller is rejected by `requireDistrictContext` and by the ownership gate; explicit `rejects a non-teacher caller`, `rejects a caller whose district context is missing`).
4. Published rejected (idempotency): covered (`treats an already-published assignment as an idempotent no-op`, `writes no audit event on an idempotent already-published call`).
5. Closed rejected: covered (`rejects transition from closed to published with assignments.invalidTransition`).
6. Archived rejected: covered (`rejects transition from archived to published with assignments.invalidTransition`).

No new backend test was added because the certified callable is reused unchanged; the existing 17 tests already cover every required scenario.

### 8.2 Client

- `app/src/assignments/detail/publish-wire.test.ts` (4 tests): invocation + shape, idempotent passthrough, malformed shape rejection, callable rejection propagation.
- `app/src/assignments/detail/detail.test.ts` Sprint 13H suite (11 tests): all UX contract items from the sprint prompt items 7-18.

Every existing Sprint 13B / 13C / 13D / 13E / 13F / 13G Detail test continues to pass unchanged.

## 9. Validation

All commands run from repo root unless noted.

### 9.1 Targeted backend

```
cd platform/functions && npx jest src/assignments/assignments-publish.test.ts
```

Result: 17 / 17 pass.

### 9.2 Targeted publish (client)

```
cd app && npx jest src/assignments/detail/publish-wire.test.ts
```

Result: 4 / 4 pass.

### 9.3 Targeted Assignment Detail

```
cd app && npx jest src/assignments/detail/detail.test.ts
```

Result: 69 / 69 pass (58 pre-existing + 11 Sprint 13H).

### 9.4 Targeted Curriculum

```
cd app && npx jest src/shell/shell.test.ts
```

Result: shell suite passes; Curriculum draft-discovery + View summary / summaries transitions confirmed unchanged.

### 9.5 Full application suite

```
cd app && npx jest
```

Result: 414 / 415 pass. The single failure is the pre-existing `curriculum/curriculumManifest.test.ts` baseline (`Curriculum manifest drift detected between root index.html and app/src/curriculum/curriculum.manifest.json`), which is the same failure noted in Sprint 13G §12 and the Repository Hardening baseline.

### 9.6 Full Cloud Functions suite

```
cd platform/functions && npx jest
```

Result: 40 suites, 896 / 896 pass.

### 9.7 Firestore Rules

No Rules change required (no new callable path, no new document write, no read-path change). Not run.

### 9.8 Lint

- `cd app && npm run lint` - clean.
- `cd platform/functions && npm run lint` - clean.

### 9.9 Typecheck

- `cd app && npm run typecheck` - clean.
- `cd platform/functions && npm run typecheck` - clean.

### 9.10 Build

- `cd app && npm run build` - builds `dist/bundle.js` (1.1 MB).

### 9.11 Git diff inspection

The Sprint 13H diff touches only:

- `app/src/assignments/detail/types.ts` (M)
- `app/src/assignments/detail/detail.ts` (M)
- `app/src/assignments/detail/detail.test.ts` (M)
- `app/src/assignments/detail/publish-wire.ts` (A)
- `app/src/assignments/detail/publish-wire.test.ts` (A)
- `app/src/index.ts` (M)
- `docs/platform/SPRINT_HISTORY.md` (M)
- `docs/platform/SPRINT_13H_COMPLETION_REPORT.md` (A)

The seven pre-existing dirty HTML files present in `git status` at session start (`extension_fossil-hunt.html`, `extension_virus.html`, `game_layer-detective.html`, `investigation_gray-zone.html`, `investigation_protein-pathway.html`, `simulation_floatlandia-fracture.html`, `simulation_gravity-wells.html`) are unrelated to this sprint and were not touched.

### 9.12 Em-dash sweep

A U+2014 EM DASH sweep across every modified and created Sprint 13H file returns 0 occurrences.

### 9.13 Deployment / commit

No deployment. No commit. No push. No emulator start. No Rules deploy. No functions deploy.

## 10. Certification

Sprint 13H is CONDITIONALLY CERTIFIED. All required outcomes are satisfied:

- Teachers can publish a draft assignment directly from Assignment Detail.
- Authorization is preserved verbatim from the certified `assignmentsPublish` callable (active teacher, district boundary, ownership + school gate, canonical `draft -> published` lifecycle guard, already-published idempotency, and rejection of every other status).
- The session-scoped registry updates immediately on success via `onStatusChange`; no page reload, no listener, no polling, no callable roundtrip.
- The Curriculum surface immediately reflects the Published state on next mount (Back button rerun), flipping `View drafts` to `View summary` / `View summaries` per the existing Sprint 13C selection interface.
- Detail lifecycle controls transition correctly: the Draft-only affordances (Publish, Edit, draft label, draft-only informational summary panel) disappear on success; the Published-lifecycle Close action becomes visible; the Sprint 13A Assignment Summary card is composed.
- Targeted backend tests pass (17 / 17).
- Targeted client tests pass (4 / 4 wire, 69 / 69 Detail).
- Full Cloud Functions regression passes (896 / 896).
- Lint, typecheck, and build pass across both `app/` and `platform/functions/`.
- Zero em dashes across every modified and created file.

Conditional certification is retained pending resolution or formal acceptance of the pre-existing `curriculum/curriculumManifest.test.ts` repository baseline failure, which is the only remaining application-suite failure and is unrelated to this sprint.

## 11. Recommended Next Bounded Slice

Sprint 13I candidates, ranked by dependency chain:

1. **Sprint 13I - Teacher Assignment Deletion Foundation (Discard Draft).** A draft assignment currently has no delete affordance; a teacher must publish and then close, or leave the draft indefinitely. A `Discard draft` action on the Draft branch (opening a canonical confirmation dialog and invoking a new `assignmentsDiscardDraft` callable) would complete the draft lifecycle. This is the first slice that requires a new callable in the 13 series; scope must be tight (draft-only, no cascading deletes because a draft has no recipients / attempts / sessions / summaries).
2. **Sprint 13J - Availability Window Editor.** Extend the Sprint 13G inline editor with `availableAt` and `windowClosesAt` controls once a canonical client-side date/time control convention exists. The callable already whitelists these fields per Data Model §3.6.
3. **Sprint 13K - Lesson Revision Selector.** Extend the Sprint 13G inline editor with `lessonSlug` / `lessonVersion` / `mode` controls once a canonical client-side lesson-revision selector exists.

The recommended first pick is Sprint 13I; it closes the smallest remaining gap in the Draft lifecycle before layering additional editable fields.

## 12. Non-Regression Confirmations

- No LMS behavior added or changed.
- No Google Classroom behavior added or changed.
- No browser persistence added (no `localStorage`, no `sessionStorage`, no `IndexedDB`, no cookies).
- No realtime Firestore listener added (`onSnapshot` posture test remains green on the Detail surface).
- No polling added.
- No deployment performed.
- No commit created.
- No unrelated configuration change.
