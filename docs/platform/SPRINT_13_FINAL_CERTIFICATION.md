# Sprint 13 Final Certification: Teacher Assignment Lifecycle

**Date:** 2026-07-17
**Status:** CONDITIONALLY CERTIFIED (pending only the pre-existing `curriculum/curriculumManifest.test.ts` baseline failure).
**Sprints reconciled:** 13A, 13B, 13C, 13D, 13E, 13F, 13G, 13H.
**Preservation notice:** No implementation change, deployment, or commit was performed by this reconciliation.

## 1. Sprint Objective

Reconcile, validate, document, and certify Sprint 13 as a single integrated feature: the complete authenticated teacher assignment lifecycle from draft creation through published, closed, and reopen transitions, including persistent rediscovery of every state after a full page reload. This certification treats Sprint 13A through Sprint 13H as one integrated deliverable and asserts that the internal consistency, authorization, registry synchronization, callable inventory, and documentation are aligned.

## 2. Scope

Scope covers the eight completed Sprint 13 slices:

- Sprint 13A. Teacher Assignment Summary UI Foundation. Reusable `renderAssignmentSummaryCard` composed against the certified `assessmentAssignmentSummary` callable.
- Sprint 13B. Teacher Assignment Detail Surface. Composed the 13A card, added header metadata, session-scoped `assignmentDetailRegistry`, and `openAssignmentDetail(assignmentId)` opener; Curriculum `View summary` control landed as remediation.
- Sprint 13C. Persistent Teacher Assignment Enumeration and Detail Access. Introduced `assignmentsTeacherList` and reload-hydration of published and closed assignments; Sprint 13C multi-assignment remediation added `View summaries` selection.
- Sprint 13D. Assignment Close. Reused `assignmentsClose` unchanged; added `Close assignment` action and confirmation dialog on Detail.
- Sprint 13E. Assignment Reopen. Introduced `assignmentsReopen` callable and `Reopen assignment` action; documentation reconciliation added §33 to `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` and appended the `assignmentsReopen` charter entry.
- Sprint 13F. Persistent Draft Assignment Discovery. Extended `assignmentsTeacherList` additively with `includeDrafts`; Curriculum `View drafts` control; draft branch on Detail; UX reconciliation replaced the 13A card with a calm draft-results panel for drafts.
- Sprint 13G. Draft Editing Foundation. Reused `assignmentsUpdateDraft` unchanged; inline `Edit draft` editor for `title`; scope-completion remediation added `instructions` as the second editable field and additive `instructions` projection on `assignmentsTeacherList`.
- Sprint 13H. Draft Publication Workflow. Reused `assignmentsPublish` unchanged; `Publish assignment` action with confirmation dialog; in-place transition from Draft to Published with immediate recomposition of the 13A summary card.

Out of scope for this reconciliation: any student-facing surface, LMS side effect, Google Classroom side effect, notification system, Firestore Rules relaxation, composite index, schema change, browser persistence, realtime listener, polling, deployment, or commit.

## 3. Architecture Reviewed

Reviewed end-to-end:

- All eight Sprint 13 completion reports.
- `docs/platform/SPRINT_HISTORY.md` Sprint 13 entries.
- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md` including §33 (13E) and §34 (13F) reconciliations.
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` Appendix A assignments entries.
- All backend callables under `platform/functions/src/assignments/` and their tests.
- All client modules under `app/src/assignments/summary/` and `app/src/assignments/detail/`.
- `app/src/shell/surfaces/curriculum.ts` selection interface.
- `app/src/index.ts` entry-point wiring for the assignment-detail registry and per-session callable seams.

The certified aggregate-only Sprint 12E Slice 1 confidentiality boundary is preserved end-to-end. The four-item Teacher Workspace navigation established in Sprint 6C is unchanged.

## 4. Lifecycle Reviewed

The canonical Sprint 13 lifecycle:

```
Draft
   |
   |-- Edit (assignmentsUpdateDraft, Sprint 13G)
   |-- Publish (assignmentsPublish, Sprint 13H)
   |
Published
   |
   |-- Summary (assessmentAssignmentSummary, Sprint 13A/13B)
   |-- Close (assignmentsClose, Sprint 13D)
   |
Closed
   |
   |-- Reopen (assignmentsReopen, Sprint 13E) -> Published
```

Terminal `archived` state (via `assignmentsArchive`) exists per Data Model §3.6 but is not surfaced by any Sprint 13 client UI and is intentionally excluded from every teacher-visible enumeration path (`assignmentsTeacherList` excludes `archived` in both default and `includeDrafts: true` modes).

Every user-visible transition has been verified end-to-end:

- Create draft: `assignmentsCreateDraft` remains the sole draft-creation path; unchanged by Sprint 13.
- Rediscover draft: `assignmentsTeacherList({ includeDrafts: true })` on active-teacher hydration (Sprint 13F).
- Edit draft: `assignmentsUpdateDraft` via `update-wire.ts`; whitelist enforcement verified (Sprint 13G).
- Publish draft: `assignmentsPublish` via `publish-wire.ts`; atomic status write plus initial recipient snapshot preserved (Sprint 13H).
- View published assignment: `openAssignmentDetail(assignmentId)` opens Detail with Published header (Sprint 13B).
- View assignment summary: 13A card composed inside 13B Detail for non-draft statuses.
- Close assignment: `assignmentsClose` via `close-wire.ts` (Sprint 13D).
- Reopen assignment: `assignmentsReopen` via `reopen-wire.ts` (Sprint 13E).
- Rediscover assignments after reload: hydration on active-teacher bootstrap restores every non-archived assignment (Sprint 13C plus 13F).
- Return to Curriculum without losing state: `onBack` handler re-runs bootstrap; registry is preserved for the remainder of the session; no state is lost.

No invalid transition path is reachable from any Sprint 13 client surface. Every backend callable rejects every other current status with `assignments.invalidTransition`, and every client control is gated on the current status (Draft-only editor and publish; Published-only close; Closed-only reopen).

## 5. Authorization Reviewed

Every Sprint 13 lifecycle transition preserves the same authorization gate:

- Authentication required (Firebase Auth ID token).
- `requireDistrictContext(request)` resolves the caller's `{ uid, role, schoolId, districtId }` from the certified district-boundary infrastructure (Sprint 10A F1).
- Active-teacher role required: `context.role === "teacher"`; every other role is rejected with `role-forbidden` before any Firestore access.
- Ownership gate: `existing.teacherId === context.uid`.
- School gate: `existing.schoolId === context.schoolId`.
- District boundary: derived from the caller's district context (never trusted from the payload).
- Client identity is never trusted. The only request field accepted by lifecycle callables is `assignmentId` (`assignmentsTeacherList` also accepts the additive `includeDrafts?`; `assignmentsUpdateDraft` accepts the whitelisted metadata keys).

No Sprint 13 client control writes to Firestore directly. Every mutation is server-authoritative via the certified callable pattern. Firestore Rules were not relaxed by any Sprint 13 slice.

## 6. Registry Reviewed

The Sprint 13B session-scoped `assignmentDetailRegistry` is the single source of truth for the visible catalog of teacher-owned assignments during a signed-in session. Every Sprint 13 mutation path updates it:

- Publish (Sprint 13H): `onStatusChange(metadata)` re-registers with `status: "published"`.
- Close (Sprint 13D): `onStatusChange(metadata)` re-registers with `status: "closed"`.
- Reopen (Sprint 13E): `onStatusChange(metadata)` re-registers with `status: "published"`.
- Edit title/instructions (Sprint 13G): `onStatusChange(metadata)` re-registers with the updated fields.
- Reload hydration (Sprint 13C plus 13F): `hydrateAssignmentDetailRegistry` calls `assignmentsTeacherList({ includeDrafts: true })` and registers every returned record.

Registry contract:

- Purely in-memory `Map` keyed by canonical `assignmentId`.
- Last-write-wins on the same key (e.g. republish overwrites the prior Draft entry in place).
- Scoped to the active-teacher session; cleared on any non-teacher bootstrap outcome.
- No `localStorage`, `sessionStorage`, `IndexedDB`, realtime listener, or polling.
- Never stores student, recipient, attempt, session, or summary data.

Every downstream reader reads through this registry:

- Detail: `AssignmentDetailMetadataReader` resolves from the registry.
- Curriculum: `grouping.ts` buckets by `lessonSlug` for the selection interface.
- Curriculum affordance: `every((a) => a.status === "draft")` yields `View drafts`; single non-draft yields `View summary`; multi yields `View summaries` (or `View drafts` for multi-draft).

Registry synchronization is consistent across every lifecycle transition. No Sprint 13 code path bypasses `onStatusChange` when the certified callable resolves successfully.

## 7. Cloud Functions Reviewed

Canonical Sprint 13 callable inventory:

| Callable | Request | Response | Authorization | Lifecycle responsibility | Sprint |
| --- | --- | --- | --- | --- | --- |
| `assignmentsCreateDraft` | `{ assignmentId, classId, lessonSlug, ..., title? }` | `{ assignmentId, alreadyCreated? }` | Active teacher, owning class in same school | Create `draft` record | Sprint 4D (unchanged by 13) |
| `assignmentsUpdateDraft` | `{ assignmentId, title?, instructions?, lessonSlug?, lessonVersion?, mode?, windowClosesAt?, availableAt? }` | `{ assignmentId, alreadyUpdated?, changedFields? }` | Active teacher, owning teacher, `draft` only | Narrow metadata update on `draft` | Sprint 4D (reused Sprint 13G) |
| `assignmentsPublish` | `{ assignmentId }` | `{ assignmentId, status: "published", alreadyPublished? }` | Active teacher, owning teacher, `draft` -> `published` | Advance to `published` and write frozen recipient snapshot atomically | Sprint 4D / PDR-029 (reused Sprint 13H) |
| `assignmentsClose` | `{ assignmentId }` | `{ assignmentId, status: "closed", alreadyClosed? }` | Active teacher, owning teacher, `published` -> `closed` | Advance to `closed` | Sprint 4D (reused Sprint 13D) |
| `assignmentsReopen` | `{ assignmentId }` | `{ assignmentId, status: "published", alreadyPublished? }` | Active teacher, owning teacher, `closed` -> `published` | Restore to `published` | Sprint 13E (new) |
| `assignmentsArchive` | `{ assignmentId }` | `{ assignmentId, status: "archived", alreadyArchived? }` | Active teacher, owning teacher, any of `draft` / `published` / `closed` -> `archived` | Terminal archive | Sprint 4D (unchanged by 13; not surfaced in 13 UI) |
| `assignmentsTeacherList` | `{ includeDrafts?: boolean }` | `[{ assignmentId, lessonSlug, title, classId, className, status, instructions? }]` | Active teacher; filter by `teacherId == uid` and `schoolId == context.schoolId`; class-ownership re-verified per record | Read-only enumeration for reload hydration | Sprint 13C (new), extended Sprint 13F, additive `instructions` projection Sprint 13G |
| `assignmentsRecipientAdd` | `{ assignmentId, studentId }` | `{ ok: true, alreadyAdded? }` | Active teacher, owning teacher, active target student in same school | Idempotent single-recipient add to the frozen recipient snapshot | Sprint 12E (unchanged by 13) |
| `assessmentAssignmentSummary` | `{ assignmentId }` | Aggregate-only ten-field response | Active teacher, owning teacher, school-boundary; aggregate-only allowlist | Read-only per-assignment aggregate metrics | Sprint 12E Slice 1 (unchanged by 13; consumed by 13A/13B) |

No duplicate responsibilities. Each callable has a single, narrowly bounded responsibility. Every mutation callable is server-authoritative, idempotent under repeated identical requests, and emits exactly one canonical audit event on the effective write (or zero on an idempotent no-op) via `writeAuditEvent`. `assignmentsTeacherList` is read-only and emits a single info-level `assignments.teacherList` observability log line per call.

## 8. Documentation Reconciliation

The following documents were reviewed and confirmed to agree on the Sprint 13 lifecycle, authorization, and callable inventory:

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md` (including §33 Sprint 13E reconciliation and §34 Sprint 13F reconciliation).
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md` Appendix A (including `assignmentsReopen` and `assignmentsTeacherList` entries).
- `docs/platform/SPRINT_HISTORY.md` (Sprint 13A through Sprint 13H entries).
- Sprint 13A through Sprint 13H completion reports.

No documentation conflicts were discovered. No implementation defect was surfaced by the documentation review. The only reconciliation produced by this sprint is this document (`SPRINT_13_FINAL_CERTIFICATION.md`) plus the appended Sprint 13 final-certification entry in `SPRINT_HISTORY.md`.

## 9. Testing Review

Coverage confirmed by test run:

- Draft lifecycle: `assignments-create-draft.test.ts`, `assignments-update-draft.test.ts` (backend), `update-wire.test.ts`, `detail.test.ts` draft branch (client).
- Published lifecycle: `assignments-publish.test.ts` (backend), `publish-wire.test.ts`, `detail.test.ts` publish branch (client).
- Closed lifecycle: `assignments-close.test.ts` (backend), `close-wire.test.ts`, `detail.test.ts` close branch (client).
- Reopen lifecycle: `assignments-reopen.test.ts` (backend), `reopen-wire.test.ts`, `detail.test.ts` reopen branch (client).
- Hydration: `hydrate.test.ts`, `assignments-teacher-list.test.ts` (backend and includeDrafts variants).
- Registry: `grouping.test.ts`, `detail.test.ts` registry re-registration paths, `shell.test.ts` curriculum-selection tests.
- Curriculum: `shell.test.ts` (`View summary` / `View summaries` / `View drafts` cases across single, multi, mixed, published-only, closed-only, draft-only sets).
- Authorization: every backend callable test enforces `requireDistrictContext`, `role === "teacher"`, and cross-owner / cross-school rejection.
- Invalid transitions: every lifecycle callable test asserts rejection of non-source statuses with `assignments.invalidTransition` and idempotency of the already-target status.
- Failure handling: every wire test asserts callable-rejection propagation and shape-mismatch rejection; every Detail test asserts calm error banners on failure and state preservation.

No meaningful testing gap was identified that belongs inside the Sprint 13 scope. See §10 for future-work items.

## 10. Technical Debt

Only items that genuinely belong on the Sprint 13 technical-debt ledger:

### High priority

- (none identified)

### Medium priority

- Repository baseline: `app/src/curriculum/curriculumManifest.test.ts` drift failure. Pre-existing and unrelated to any Sprint 13 file. Regeneration path is `npm run curriculum:build` inside `app/`. Deferred as a repository-wide baseline concern rather than a Sprint 13 defect.

### Low priority

- The draft editor exposes `title` and `instructions` but not `windowClosesAt`, `availableAt`, `lessonSlug`, `lessonVersion`, or `mode`. The `assignmentsUpdateDraft` callable already whitelists these fields, so any later expansion is a purely additive client change. Deferred as an intentional bounded slice, not a defect.
- The Curriculum multi-assignment selection interface renders `${className} · ${statusLabel}` per choice. If a teacher assigns the same lesson to the same class multiple times, the choices remain deterministic via the final `assignmentId` tie-breaker but read alike to the user. Deferred as a low-frequency edge case.

### Future enhancement

- Teacher-visible archive workflow. `assignmentsArchive` is certified but is not surfaced by any Sprint 13 client control. A bounded archive slice mirroring 13D and 13E would round out the terminal state.
- Availability-window editing on the draft editor once a canonical teacher-facing date/time control convention is adopted.
- Google Classroom deep-link publication on publish (PDR-027 track; independent of Sprint 13 scope).

## 11. Remaining Accepted Repository Baseline Issues

- `app/src/curriculum/curriculumManifest.test.ts` drift failure. Reproduces outside Sprint 13, is unrelated to any Sprint 13 file, and every Sprint 13A through Sprint 13H entry has already documented it as the sole remaining application-suite failure. Accepted as the repository baseline for the purpose of this certification.

No other baseline issue is accepted.

## 12. Certification Statement

Sprint 13 is CONDITIONALLY CERTIFIED as one integrated teacher assignment lifecycle feature. The lifecycle is complete (Draft, Published, Closed, and Reopen paths, plus persistent rediscovery of every non-archived state). Lifecycle transitions are internally consistent. Authorization is consistent across every transition and every retrieval path. Registry synchronization is consistent across every mutation and every reload hydration. Documentation is reconciled across the Assessment Implementation Contract, the Cloud Function Charter, and the Sprint History. No implementation defect was surfaced by this reconciliation. Final certification remains conditional pending resolution or formal acceptance of the pre-existing `curriculum/curriculumManifest.test.ts` baseline failure.

## 13. Recommendation to Begin Sprint 14

Sprint 14 may begin. The certified Sprint 13 lifecycle is stable, internally consistent, and documented. Sprint 14 should observe the following invariants:

- The four-item Teacher Workspace navigation (Curriculum, Classes, Present Mode, Settings) is canonical and should not be widened without a repository-level decision.
- The session-scoped `assignmentDetailRegistry` remains the single in-memory catalog for teacher-owned assignments during a session; new mutation paths must call `onStatusChange` or otherwise re-register.
- `assignmentsTeacherList` remains the single reload-hydration path; any new visible catalog must plug into it rather than adding a parallel enumeration path.
- Every new lifecycle transition must be server-authoritative via a callable that resolves through `requireDistrictContext` and enforces the canonical ownership plus school gate.
- The aggregate-only Sprint 12E Slice 1 confidentiality boundary remains inviolate on every teacher analytics surface.

## 14. Validation Results

- Targeted assignment backend tests: pass (assignments domain suites clean under `platform/functions`).
- Targeted assignment client tests: 134 of 134 pass across 8 suites under `app/src/assignments/`.
- Full application suite: 414 of 415 pass across 16 suites. Sole failure: `curriculum/curriculumManifest.test.ts` (accepted baseline; see §11).
- Full Cloud Functions suite: 896 of 896 pass across 40 suites.
- Firestore Rules: not exercised. No Rules file was modified by this reconciliation.
- Lint (`app`): clean.
- Lint (`platform/functions`): clean.
- Typecheck (`app`): clean.
- Typecheck (`platform/functions`): clean.
- Build (`app`): clean (`dist/bundle.js` produced).
- Git diff inspection: only reconciliation documents (this file and the appended `SPRINT_HISTORY.md` entry) were introduced by this sprint. The seven pre-existing modified HTML files (`extension_fossil-hunt.html`, `extension_virus.html`, `game_layer-detective.html`, `investigation_gray-zone.html`, `investigation_protein-pathway.html`, `simulation_floatlandia-fracture.html`, `simulation_gravity-wells.html`) are unrelated to Sprint 13 and were not touched by this reconciliation.
- Em dash check: zero em dashes in this document and in the appended Sprint History entry.
- No deployment occurred.
- No commit occurred.
