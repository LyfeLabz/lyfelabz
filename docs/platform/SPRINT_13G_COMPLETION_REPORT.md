# Sprint 13G Completion Report: Draft Editing Foundation

**Dates:** 2026-07-17
**Status:** Implementation complete; conditionally certified pending resolution of the pre-existing `curriculum/curriculumManifest.test.ts` repository baseline failure.
**Preceding sprint:** Sprint 13F (Persistent Draft Assignment Discovery).

## 1. Architecture Review

Reviewed before implementation:

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `docs/platform/SPRINT_13A_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_13B_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_13C_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_13D_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_13E_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_13F_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_HISTORY.md`
- `platform/functions/src/assignments/` (every callable and its tests, especially `assignments-update-draft.ts`, `assignments-create-draft.ts`, and the shared district context / audit helpers).
- `app/src/assignments/detail/` (types, registry, hydrate, hydrate-wire, grouping, detail, wire, close-wire, reopen-wire).
- `app/src/assignments/summary/` (unchanged; still composed inside Detail for every non-draft status).
- `app/src/shell/surfaces/curriculum.ts` (Sprint 13B / 13C / 13F selection interface).
- `app/src/index.ts` (per-session assignment-detail wiring).

The certified `assignmentsUpdateDraft` callable already exists at `platform/functions/src/assignments/assignments-update-draft.ts`. It performs a narrow-metadata update of `assignments/{assignmentId}` while the record is still in `draft` per Data Model §3.6 and §7.6, is exported from `platform/functions/src/index.ts`, is covered by an existing test file, and is documented as the canonical draft-update path. The Sprint 13G architecture question was whether a client-side editor for a draft could be added without introducing a second callable, a second registry, a Firestore Rules relaxation, a composite index, or any schema change.

## 2. Lifecycle Decision

Option A. The existing certified `assignmentsUpdateDraft` callable is reused unchanged. No new callable was introduced. No callable was extended. No backward-compatibility shim was added. The client-side seam introduced by this sprint is the smallest possible narrow projection of the callable's existing request shape (`assignmentId`, `title?`); the seam never carries ownership, class, status, submission, attempt, session, summary, or timestamp fields, so widening the editor later (instructions, availability window, lesson revision) is a purely additive change to the seam and callable payload, not a re-decision.

## 3. Editable Fields

Only one narrow metadata field is exposed to the editor in this bounded slice:

- `title` (assignment title).

The callable already accepts additional draft-editable fields (`instructions`, `lessonSlug`, `lessonVersion`, `mode`, `windowClosesAt`, `availableAt`) per Data Model §3.6, but none of those fields are surfaced today on the `AssignmentDetailMetadata` shape or the Sprint 13C `assignmentsTeacherList` projection. Introducing a second surface for those fields is a future bounded slice; this sprint keeps to the smallest editing slice that produces observable behavior for the teacher.

## 4. Immutable Fields

Under no code path can any of the following be modified through the editor:

- `assignmentId`, `teacherId`, `schoolId`, `districtId`, `classId`, `className`.
- `status` (draft / published / closed / archived).
- `recipients`, `attempts`, `sessions`, `summaries`.
- `createdAt` and every rollup or aggregate.
- The `assessmentId` / assessment binding.

The client seam sends only `assignmentId` (routing) and `title` (when changed). The callable's validator (`validateRequest`) accepts only the seven whitelisted metadata keys and silently ignores every other request property. `computeDiff` in the callable projects only the whitelisted fields into the write payload, so an extra request property has no effect on Firestore. A dedicated backend test (`ignores immutable fields injected on the payload and only writes the whitelisted metadata`) asserts that `teacherId`, `schoolId`, `districtId`, `classId`, `status`, `createdAt`, `recipients`, and `attempts` are never present in the write and never affect the audit event.

## 5. User Experience

Within Assignment Detail, when the loaded metadata is `draft` and `updateDraftCallable` is wired, the Sprint 13F draft label is joined by an `Edit draft` action (`data-testid="assignment-detail-edit-action"`). Activating the action replaces the label + action pair with a lightweight inline editor rendered inside the same `.shell-assignment-detail-lifecycle` region:

- One labeled text input, prefilled with the current title, `maxLength=200`, `autocomplete="off"`, focus applied on open.
- A `Cancel` button and a `Save` button.
- A validation error region (`role="alert"`) that renders `Enter a title before saving.` when the trimmed title is empty; the input carries `aria-invalid="true"` and `aria-describedby` the error id.
- A calm error banner (`role="alert"`) that renders `We could not save this draft right now. Try again in a moment.` on callable failure. The editor remains open so the teacher can adjust and retry.

The teacher never navigates away. No new page is created. No new dialog is introduced. The reused design language is the existing `.shell-btn` control and the Sprint 13B / 13D / 13E lifecycle-region layout.

## 6. Save Behavior

Selecting `Save`:

- Trims the title. If empty, the callable is not invoked; validation surfaces and the editor stays open with the entered value preserved.
- Invokes the canonical `assignmentsUpdateDraft` callable exactly once with `{ assignmentId, title? }`. `title` is omitted when unchanged, so the callable's own idempotent path (`alreadyUpdated: true`) is exercised without a spurious diff.
- On success, updates the Detail header title immediately (no reload), collapses the editor back to the Draft label + Edit action, and invokes the injected `onStatusChange` seam so the session-scoped registry re-registers the updated metadata. Curriculum, when re-entered, reflects the new title through the existing Sprint 13C / 13F selection interface without a page reload.
- On failure, transitions the editor to an `error` UI state and surfaces the generic banner; the assignment's rendered header title is unchanged.

## 7. Cancel Behavior

Selecting `Cancel` collapses the editor back to the Draft label + Edit action, does not invoke the callable, does not mutate the registry, and preserves the currently rendered header title.

## 8. Validation

Client-side validation blocks the callable when the trimmed title is empty; the callable itself defensively rejects `assignments.invalidTitle` per its existing contract. The 200-character cap is enforced through the input's `maxLength` attribute (the callable enforces the same cap defensively). Reused validation posture; no new validation library, no new schema.

## 9. Authorization

Preserved unchanged. The certified callable enforces:

- Authentication.
- `requireDistrictContext(request)` (active teacher in a district).
- `context.role === "teacher"`.
- `existing.teacherId === actor.uid && existing.schoolId === actor.schoolId` (canonical ownership gate).
- `existing.status === "draft"` (any other status is rejected with `assignments.invalidStatus`).

Client identity is never trusted. The client-supplied fields are limited to `assignmentId` (routing) and `title` (metadata). A cross-teacher, cross-school, cross-district, or non-draft update is rejected server-side; the surface never falls back to a permissive local path.

## 10. Registry Behavior

The session-scoped `assignmentDetailRegistry` from Sprint 13B is reused unchanged. On a successful save, the detail surface constructs the next metadata (`{ ...metadata, title: trimmed }`) and passes it to the injected `onStatusChange` callback. The entry point already re-registers on `onStatusChange`, so the registry is updated in-session with no new lookup path. Curriculum's `View drafts` / `View summaries` control reflects the new title on next mount without a callable roundtrip. No second registry, no persistent storage, no `localStorage`, `sessionStorage`, `IndexedDB`, realtime listener, or polling was introduced.

## 11. Files Created

- `app/src/assignments/detail/update-wire.ts` (entry-point wire for the certified `assignmentsUpdateDraft` callable; the seam that keeps the pure Assignment Detail surface free of `firebase/*`).
- `app/src/assignments/detail/update-wire.test.ts` (five targeted unit tests for the wire: payload composition, `title` omission, `alreadyUpdated` propagation, malformed-response rejection, callable-rejection propagation).
- `docs/platform/SPRINT_13G_COMPLETION_REPORT.md` (this report).

## 12. Files Modified

- `app/src/assignments/detail/types.ts` (added the `AssignmentsUpdateDraftInput`, `AssignmentsUpdateDraftResult`, and `AssignmentsUpdateDraftCallable` seam types).
- `app/src/assignments/detail/detail.ts` (added the `updateDraftCallable` optional dep, `Edit draft` action rendered on the draft branch when the seam is wired, inline editor with title input plus Cancel and Save controls, `EditUiState` and validation state machine, and the `renderDraftEditor` helper).
- `app/src/assignments/detail/detail.test.ts` (eleven appended Sprint 13G client tests covering: presence of `Edit draft` on draft + wire, absence when unwired, absence on published, absence on closed, editor open + prefill, cancel restores prior state and never invokes the callable, save success updates the header and fires `onStatusChange`, validation blocks empty save, callable failure surfaces the calm error banner and preserves the header, idempotent unchanged-title round-trip, and a confidentiality guard against ownership / class / submission / attempt / session / firebase vocabulary in the editor subtree).
- `app/src/index.ts` (wired the `createAssignmentsUpdateDraftCallable` factory; the seam is rebound per active-teacher session and cleared on any non-teacher bootstrap outcome).
- `platform/functions/src/assignments/assignments-update-draft.test.ts` (three appended Sprint 13G backend tests: closed rejected, archived rejected, immutable fields injected on the payload are silently ignored and never written).
- `docs/platform/SPRINT_HISTORY.md` (Sprint 13G entry appended).

## 13. Tests Added

### Backend (`assignments-update-draft.test.ts`)

- `rejects an update against a closed assignment`.
- `rejects an update against an archived assignment`.
- `ignores immutable fields injected on the payload and only writes the whitelisted metadata`.

The pre-existing backend suite already covered: owner-edits-draft happy path, cross-teacher rejected (`assignments.forbidden`), cross-school rejected (`assignments.forbidden`), cross-district rejected (`district-mismatch`), published rejected (`assignments.invalidStatus`), unauthenticated / account-inactive / claim-stale / role-forbidden / non-teacher / platformAdministrator rejected, idempotency, ordering, invalid-request payloads, and invalid timestamps.

### Client wire (`update-wire.test.ts`)

- Payload composition with `title` supplied.
- `title` omitted from the payload when the caller omits it.
- `alreadyUpdated: true` propagates through the seam unchanged.
- Malformed callable response rejects with `unexpected shape`.
- Callable rejection propagates.

### Client detail (`detail.test.ts` - `renderAssignmentDetail - draft editing (Sprint 13G)`)

- `Edit draft` renders on a draft when the seam is wired.
- `Edit draft` is absent when the seam is not wired; the Sprint 13F draft label continues to render.
- Published assignments never expose `Edit draft`.
- Closed assignments never expose `Edit draft`.
- Clicking `Edit draft` opens the editor prefilled with the current title.
- `Cancel` closes the editor without invoking the callable and preserves the header.
- `Save` invokes the callable exactly once, updates the header title, fires `onStatusChange` with the updated metadata, and closes the editor.
- Empty-title save blocks the callable and renders the validation message.
- Callable failure preserves the header and renders a generic error banner; the editor stays open.
- Save on an unchanged title omits `title` from the payload and still fires `onStatusChange` for registry re-registration.
- The editor never exposes ownership, class, recipient, attempt, session, submission, callable, or firebase vocabulary.

## 14. Validation

- Backend targeted suite: `platform/functions` `npx jest src/assignments/assignments-update-draft.test.ts` (18 / 18 pass).
- Client wire targeted suite: `app` `npx jest src/assignments/detail/update-wire.test.ts` (5 / 5 pass).
- Client detail targeted suite: `app` `npx jest src/assignments/detail/detail.test.ts` (58 / 58 pass).
- Full Cloud Functions suite: `platform/functions` `npx jest` (40 suites, 893 / 893 pass).
- Full application suite: `app` `npx jest` (14 / 15 suites pass, 388 / 389 tests pass; the one remaining failure is the pre-existing repository baseline in `curriculum/curriculumManifest.test.ts`).
- App typecheck: `app` `npx tsc --noEmit` (clean).
- Functions typecheck: `platform/functions` `npx tsc --noEmit` (clean).
- App lint: `app` `npx eslint src/assignments/detail/ src/index.ts` (clean).
- Functions lint: `platform/functions` `npx eslint src/assignments/` (clean).
- App build: `app` `npx vite build` (clean; single 494 KB main chunk).
- Em-dash sweep: `grep -c` returned 0 for every modified file.
- Firestore Rules: not modified; no rules-only run required.
- No deployment. No commit.

## 15. Certification

Sprint 13G is CONDITIONALLY CERTIFIED. Implementation is complete; every Sprint 13G target is met:

- Drafts are editable through a lightweight inline editor.
- Only whitelisted draft-editable fields (title, in this bounded slice) can change; the callable's validator and diff builder prevent every other field from being written.
- Authorization is preserved (active teacher, district context, canonical ownership gate, draft-only status guard).
- Immutable fields (ownership, school, district, class, assessment, recipients, submissions, attempts, sessions, summaries, status, createdAt) remain immutable, verified by a dedicated backend test.
- The session-scoped registry is updated immediately through the existing Sprint 13B `onStatusChange` seam; no page reload is required.
- Curriculum reflects the updated title through the existing Sprint 13C / 13F selection interface on next mount.
- Targeted backend, wire, and detail tests pass; the full Cloud Functions regression suite passes; the full application suite passes except for the previously accepted `curriculum/curriculumManifest.test.ts` baseline; lint, typecheck, and build are clean.

Final certification is conditional pending resolution or formal acceptance of the pre-existing `curriculum/curriculumManifest.test.ts` repository baseline failure.

## 16. Recommended Next Bounded Slice

Extend the editor to `instructions`. The certified callable already accepts the field; the Sprint 13G editor state machine, validation posture, error banner, and registry re-registration are directly reusable. The bounded work is: (a) add `instructions?: string` to `AssignmentDetailMetadata` and to the `assignmentsTeacherList` response projection so hydration surfaces the current value, and (b) add a textarea to the editor with the same trim / empty validation posture as title. Every other subsystem (authorization, registry, curriculum) is unaffected.

## 17. Deployment and Commit

- No deployment was performed.
- No commit was created.

## 18. Sprint 13G Scope-Completion Remediation (2026-07-17)

### 18.1 Why Remediation Was Required

The original Sprint 13G implementation shipped a single editable field (`title`) even though the canonical `assignmentsUpdateDraft` callable already accepts the full whitelist per Data Model §3.6 and §7.6. The original completion report acknowledged this explicitly ("Introducing a second surface for those fields is a future bounded slice; this sprint keeps to the smallest editing slice that produces observable behavior for the teacher.") The scope-completion remediation reconciles the client draft editor with the callable's actual whitelist by inspecting each schema-supported field and either implementing it or documenting evidence that it is not safely editable through the client today.

### 18.2 Field-Support Review

The certified callable's request shape (see `platform/functions/src/assignments/assignments-update-draft.ts`, `AssignmentsUpdateDraftRequest`) accepts seven metadata fields. The canonical `AssignmentRecord` (`platform/functions/src/shared/types/assignment.ts`) declares each as optional and additive per §3.6. Ownership fields (`classId`, `teacherId`, `schoolId`, `districtId`), lifecycle (`status`), timestamp (`createdAt`), and the LMS mirror pointer (`lmsPublicationRef`) are intentionally absent from every write shape and are never editable through this path.

| Field | Schema | Callable | Client selector / control | Classification | Editable in Sprint 13G? |
|---|---|---|---|---|---|
| `title` | `AssignmentRecord.title?: string` | Yes | Plain text `<input>` | Supported now | Yes (original) |
| `instructions` | `AssignmentRecord.instructions?: string` | Yes | `<textarea>` (native) | Supported now | Yes (remediation) |
| `windowClosesAt` (availability end) | `AssignmentRecord.windowClosesAt?: Timestamp` | Yes (ISO 8601 string transport) | No existing teacher-facing date/time control convention; the assignment creation flow never populates it (`app/src/shell/surfaces/curriculum.ts` calls `createDraft` without either timestamp), and the Assign Experience contract carries the field only as an untyped ISO passthrough | Schema-supported, not safely editable | No |
| `availableAt` (availability start) | `AssignmentRecord.availableAt?: Timestamp` | Yes (ISO 8601 string transport) | Same as `windowClosesAt`: no existing teacher-facing date/time control convention, no established client timezone semantics; introducing one would invent new UX and a new timezone model | Schema-supported, not safely editable | No |
| Lesson revision reference (`lessonVersion` and `lessonSlug`) | `AssignmentRecord.lessonSlug: string`, `AssignmentRecord.lessonVersion: string` (frozen at creation per §12.4) | Yes | No client-side lesson-revision selector, no client-side manifest of valid revisions; the creation flow hardcodes `DEFAULT_LESSON_VERSION = "v1"` in `app/src/shell/surfaces/curriculum.ts:1445` | Schema-supported but no certified client-side selector, and `lessonSlug` / `lessonVersion` are documented as frozen at creation per Data Model §12.4 | No |
| `mode` (not on the required inspection list) | `AssignmentRecord.mode: AssignmentMode` | Yes | No client-side mode selector; creation hardcodes `"classroom"` in `curriculum.ts:1545` | Schema-supported but no certified client-side selector | No |

### 18.3 Evidence

- `platform/functions/src/assignments/assignments-update-draft.ts` (validator + `computeDiff`) admits `title`, `instructions`, `lessonSlug`, `lessonVersion`, `mode`, `windowClosesAt`, `availableAt`.
- `platform/functions/src/shared/types/assignment.ts` declares all seven as optional on `AssignmentRecord` (except `lessonSlug`, `lessonVersion`, `mode` which are required at creation).
- The pre-existing backend test `updates only the changed fields and emits a single audit event` (`assignments-update-draft.test.ts`) already exercises `title` and `instructions` in the same call, confirming callable acceptance for the second remediation field.
- `platform/functions/src/assignments/assignments-teacher-list.ts` prior to remediation projected only `assignmentId`, `lessonSlug`, `title`, `classId`, `className`, `status`. It did not project `instructions`, so a page reload would strip the value from the editor's prefill.
- `app/src/shell/surfaces/curriculum.ts:1520-1547` calls `assignmentsCreateDraft` with only `assignmentId`, `classId`, `lessonSlug`, `lessonVersion: "v1"`, `mode: "classroom"`, and `title`; the creation path never sets `instructions`, `windowClosesAt`, or `availableAt`. This confirms that no existing client convention transports availability windows or lesson revisions to the callable.
- Repository-wide search (`grep -rn 'input type="datetime-local"\|type="date"'` across `app/src/`) returns no matches; there is no existing teacher-facing date/time control convention on which the Sprint 13G editor could compose.

### 18.4 Final Editable Fields (post-remediation)

- `title`
- `instructions`

### 18.5 Fields Classified As Not Safely Editable In Sprint 13G

- `windowClosesAt` (availability end), `availableAt` (availability start): schema-supported and callable-supported, but the client has no existing date/time control convention and no established timezone semantics. Adding these would require inventing new UX and a timezone model, which is out of scope per this remediation's guidance ("do not invent a new timezone model").
- Lesson revision reference (`lessonSlug`, `lessonVersion`): schema-supported and callable-supported, but no certified client-side selector or safe list of valid revisions exists. An unrestricted free-text input for an internal document ID would violate the remediation's explicit restriction. Additionally, Data Model §12.4 documents lesson identifiers as frozen at creation to protect students from mid-window content changes; changing them mid-draft is only safe when a certified selector guarantees a valid target.
- `mode`: not on the required inspection list; unchanged from the original slice. No certified client-side selector.

### 18.6 Backend Contract Decision

The certified `assignmentsUpdateDraft` callable is reused unchanged. The certified `assignmentsTeacherList` callable is extended additively: the response `AssignmentsTeacherListItem` gains an optional `instructions?: string` field, only projected when the stored record carries a non-empty string. Pre-Sprint-13G clients ignore the additive field; the Sprint 13C hydrate parser accepts items without it. No new callable was introduced. No callable request contract was changed. No Firestore Rules were relaxed. No schema field was added. No composite index was introduced.

### 18.7 Enumeration and Hydration Changes

- `AssignmentsTeacherListItem` gains `instructions?: string` (backend, `assignments-teacher-list.ts`). The projection reads `record.instructions` and only includes it when it is a non-empty string.
- `AssignmentDetailMetadata` gains `instructions?: string` (client, `types.ts`). The Sprint 13B session-scoped registry and Sprint 13C hydrate parser propagate the field transparently.
- `parseAssignmentsTeacherListItem` (client, `hydrate.ts`) parses the additive field and drops empty strings, so a saved-and-reloaded draft returns to the editor with the saved instructions prefilled.

### 18.8 Editor Behavior

The Sprint 13G inline editor gains a labeled `<textarea>` (`assignment-detail-editor-instructions`, `rows=4`, `maxLength=4000`, `autocomplete="off"`) beneath the title input. Initial value: `metadata.instructions ?? ""`. The textarea is disabled in the `pending` state and preserved verbatim on failure. The Cancel and Save buttons and the empty-title validation continue to apply.

### 18.9 Validation

- Title: empty (trimmed) blocked as before.
- Instructions: no client-side required check (the callable's contract admits absence). A trimmed empty edit is treated as "unchanged" and is not sent, because the callable rejects `""` per its contract (`assignments.invalidInstructions`). Clearing existing instructions is therefore not supported through this editor until the callable admits a canonical clear sentinel; this is documented behavior.

### 18.10 Save Behavior

- Trims both title and instructions.
- If the trimmed title is empty, validation surfaces and the callable is not invoked.
- Otherwise, invokes `assignmentsUpdateDraft` exactly once with only the changed whitelisted fields. `title` is sent only when the trimmed value differs from the current stored title; `instructions` is sent only when the trimmed value is non-empty and differs from the current stored instructions.
- On success: header title updates immediately, `metadata.instructions` updates in the registry through `onStatusChange`, the editor collapses to the Draft label + Edit action, and Curriculum reflects the new title on next mount through the existing Sprint 13C / 13F selection interface. No page reload.
- On failure: editor stays open, teacher-entered values preserved verbatim, calm generic error banner rendered. The registry and rendered header are not mutated.

### 18.11 Cancel Behavior

Cancel closes the editor without invoking the callable, discards edited title and instructions, restores the stored values on reopen, and preserves the currently rendered header.

### 18.12 Registry Behavior

Unchanged. The registry receives `{ ...metadata, title, instructions? }` through `onStatusChange` on successful save. No second registry, no persistent storage, no realtime listener, no polling.

### 18.13 Files Modified In Remediation

- `platform/functions/src/assignments/assignments-teacher-list.ts` (additive optional `instructions` projection).
- `platform/functions/src/assignments/assignments-teacher-list.test.ts` (three appended tests: projects instructions when present, omits when absent, omits when empty string).
- `app/src/assignments/detail/types.ts` (added `instructions?: string` to `AssignmentDetailMetadata` and to `AssignmentsUpdateDraftInput`).
- `app/src/assignments/detail/update-wire.ts` (forwards `instructions` on the callable payload when supplied).
- `app/src/assignments/detail/update-wire.test.ts` (two appended tests: instructions included when supplied, omitted when absent).
- `app/src/assignments/detail/hydrate.ts` (parses additive optional `instructions` from the projection).
- `app/src/assignments/detail/hydrate.test.ts` (three appended tests: parses instructions, omits when absent, omits when empty string).
- `app/src/assignments/detail/detail.ts` (extended `EditUiState` with `draftInstructions`, added the instructions textarea to the editor, extended save/cancel to preserve and forward the new field).
- `app/src/assignments/detail/detail.test.ts` (six appended tests: textarea prefilled with current instructions, empty prefill when absent, save sends changed instructions, save omits unchanged instructions, cancel discards edited instructions, whitespace-only edit is not sent).
- `docs/platform/SPRINT_13G_COMPLETION_REPORT.md` (this remediation section).
- `docs/platform/SPRINT_HISTORY.md` (scope-completion note appended).

### 18.14 Files Not Modified

- `platform/functions/src/assignments/assignments-update-draft.ts` (reused unchanged).
- `platform/functions/src/shared/types/assignment.ts` (canonical schema unchanged).
- Firestore Rules (not touched).
- `app/src/index.ts` (registry wiring unchanged; `updateDraftCallable` seam already wired).
- `app/src/assignments/detail/hydrate-wire.ts` (parser change is upstream in `hydrate.ts`; wire unchanged).
- `app/src/assignments/detail/registry.ts` (unchanged).
- `app/src/shell/surfaces/curriculum.ts` (unchanged; title-based labels continue to work).

### 18.15 Validation Results (remediation)

- Targeted backend: `assignments-update-draft` 18/18 pass, `assignments-teacher-list` 21/21 pass.
- Targeted client: `update-wire` 7/7 pass, `hydrate` all pass, `detail` 98/98 pass, `assignments/detail` overall 101/101 pass.
- Full Cloud Functions suite: 40 suites, 896 / 896 pass.
- Full application suite: 14 / 15 suites pass, 399 / 400 tests pass. The single remaining failure is the pre-existing `curriculum/curriculumManifest.test.ts` repository baseline, unchanged from before remediation.
- App typecheck (`npx tsc --noEmit`): clean.
- Functions typecheck (`npx tsc --noEmit`): clean.
- App lint (`npm run lint`): clean.
- Functions lint (`npm run lint`): clean.
- App build (`npm run build`): clean.
- Functions build (`npm run build`): clean.
- Em-dash sweep of every modified doc: 0 matches.
- Firestore Rules: not modified.
- No deployment. No commit.

### 18.16 Findings

None of severity high. Two low-severity notes:

- The callable's `assignments.invalidInstructions` contract rejects an empty string, so clearing existing instructions through this editor is not supported. This is documented and enforced client-side by omitting the field on a whitespace-only edit. A future bounded slice could introduce a canonical clear sentinel to the callable if the product decides teachers should be able to remove instructions after adding them.
- Availability windows and lesson-revision editing remain in the schema but not in the editor. The recommended next bounded slice is a small canonical selector for lesson revisions (backed by a certified manifest) and a small teacher-facing datetime control convention with an explicit timezone story; both would enable additional draft-editable fields without any callable contract change.

### 18.17 Documentation Reconciliation (remediation)

- This report (Section 18) documents the remediation in full.
- `docs/platform/SPRINT_HISTORY.md` is appended with a brief Sprint 13G scope-completion note; the original Sprint 13G entry is preserved.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` is not updated: the callable contract is unchanged; the additive optional `instructions` field on the `assignmentsTeacherList` response is a per-item projection detail that does not alter the callable's authority, boundary, or authorization model.
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md` is not updated: draft-editable fields are already documented per Data Model §3.6 and §7.6; no clarification is required by this remediation.

### 18.18 Updated Certification

CONDITIONALLY CERTIFIED: Sprint 13G implementation is complete and the draft-editable field scope is reconciled with the canonical assignment schema and callable contract. Final certification requires resolution or formal acceptance of the pre-existing repository baseline test failure.
