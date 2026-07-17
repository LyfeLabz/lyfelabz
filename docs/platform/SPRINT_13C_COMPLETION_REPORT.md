# Sprint 13C Completion Report: Persistent Teacher Assignment Enumeration and Detail Access

**Dates:** 2026-07-17
**Status:** Implementation complete; conditionally certified pending resolution of the pre-existing repository baseline test failure.
**Preceding sprint:** Sprint 13B (Teacher Assignment Detail Surface).

## 1. Objective

Introduce the smallest certified retrieval path that lets an authenticated teacher recover their existing assignments after a full page reload and reopen the corresponding Sprint 13B Assignment Detail surface. Prior to this sprint the Sprint 13B visible `View summary` affordance depended on session-scoped registration performed by the Sprint 13B publish path; once the tab reloaded, previously published assignments were forgotten and the affordance disappeared. Sprint 13C hydrates the session-scoped assignment-detail registry from a new backend enumeration callable so `View summary` is restored automatically for every already-published assignment owned by the authenticated teacher.

## 2. Architecture Review

The repository was inspected before implementation. Reviewed:

- `docs/platform/ASSESSMENT_IMPLEMENTATION_CONTRACT.md`
- `docs/platform/IDENTITY_AND_ONBOARDING_SPECIFICATION.md`
- `docs/platform/LYFELABZ_CLOUD_FUNCTION_CHARTER.md`
- `docs/platform/SPRINT_13A_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_13B_COMPLETION_REPORT.md`
- `docs/platform/SPRINT_HISTORY.md`
- `platform/functions/src/assignments/` (all callables)
- `platform/functions/src/index.ts`
- `platform/firebase/firestore.rules`
- `platform/firebase/firestore.indexes.json`
- `app/src/assignments/`
- `app/src/shell/surfaces/curriculum.ts`
- `app/src/index.ts`

## 3. Existing Retrieval Paths Evaluated

The assignments domain currently exports six callables: `assignmentsArchive`, `assignmentsClose`, `assignmentsCreateDraft`, `assignmentsPublish`, `assignmentsRecipientAdd`, `assignmentsUpdateDraft`. None of these enumerates teacher-owned assignments; each targets a single `assignmentId` supplied by the caller. The `assessmentAssignmentSummary` callable is per-assignment aggregate metrics only and requires the caller to already know the target `assignmentId`. Firestore Rules allow a `list` on `assignments` where `resource.data.teacherId == request.auth.uid`, but the sprint brief explicitly directs against establishing a client Firestore enumeration path when a certified callable is the cleaner boundary, and this repository has consistently preferred callables for cross-district-boundary enforcement.

## 4. Selected Architecture

Option C from the sprint brief: introduce a single narrowly bounded callable, `assignmentsTeacherList`, that returns the minimal metadata required to restore Curriculum affordances and open the certified Sprint 13B Assignment Detail surface. No Firestore Rules relaxation, no schema migration, no composite index, and no direct client Firestore enumeration path is introduced.

## 5. Authorization Model

- Requires authentication.
- Requires `requireDistrictContext(request)` to resolve.
- Requires `context.role === "teacher"`; every other role is rejected with the canonical `role-forbidden` code before any Firestore access.
- Server-side identity is authoritative. The request payload is `Record<string, never>` and carries no `teacherId`, `districtId`, or `schoolId` field; a client-supplied identifier cannot override the authenticated identity.

## 6. District-Boundary Enforcement

The Firestore query filters on `teacherId == context.uid` and `schoolId == context.schoolId`, where `context.schoolId` is derived through the certified `requireDistrictContext` helper. `AssignmentRecord.schoolId` is denormalized per Data Model §3.6, so the primary district-boundary check occurs at query time. A defense-in-depth belt-and-suspenders filter re-verifies `teacherId` and `schoolId` on each returned document before it is admitted to the response. `className` is resolved server-side through a teacher-authorized read of `classes/{classId}`; if the class is missing or is owned by a different teacher or school, the assignment is dropped from the response rather than emitted with a client-supplied class name.

## 7. Query Shape

```
assignments
  .where("teacherId", "==", <uid>)
  .where("schoolId", "==", <schoolId>)
  .where("status", "in", ["published", "closed"])
```

Firestore accepts a single `in` clause per query in composition with equality filters. The two equality filters and the `in` filter fit under the built-in single-field-index composition and do not require a composite index; `firestore.indexes.json` is unchanged.

## 8. Response Shape

```
type AssignmentsTeacherListItem = {
  assignmentId: string;
  lessonSlug: string;
  title: string;
  classId: string;
  className: string;
  status: "published" | "closed";
};

type AssignmentsTeacherListResponse = { items: readonly AssignmentsTeacherListItem[] };
```

No `recipients`, `studentId`, `recipientId`, `attemptId`, `sessionId`, `teacherId`, `districtId`, `schoolId`, `answerKey`, or `explanation` field is projected. `lessonSlug` and `classId` are required to associate the assignment with the correct Curriculum lesson card and to distinguish per-class copies of the same lesson.

## 9. Status Scope

`published` and `closed`. `draft` records exist only transiently between `assignmentsCreateDraft` and `assignmentsPublish` and are never rendered in the Curriculum `View summary` affordance; they are omitted. `archived` records are terminal per Data Model §3.6 and are removed from active teacher views by definition; they are omitted.

## 10. Multiple-Assignment Policy

Each returned item is preserved in the session-scoped registry keyed by canonical `assignmentId`. The Curriculum surface uses the returned `lessonSlug` to reconstruct the per-lesson mapping. When more than one published or closed assignment exists for the same `(teacherUid, lessonSlug)` pair (per-class copies), the last entry consumed during hydration becomes the default target of the lesson card's `View summary` control; the newly published assignment observed during the current session then supersedes it via the canonical `assignmentId`-keyed deduplication. This preserves Sprint 13B's existing single-card behavior. A calm, deterministic, per-card selection UI for choosing among multiple concurrent assignments is a candidate for a future bounded slice; the current release intentionally does not scope it because the Curriculum surface never silently opens a stale assignment (the `View summary` control always carries a concrete registered `assignmentId`).

## 11. Client Bootstrap Integration

`app/src/index.ts` calls `hydrateAssignmentDetailRegistry(assignmentDetailRegistry, teacherList)` exactly once per active-teacher session, immediately after `assignmentSummary` is bound. The hydration is guarded by the `session.kind === "activeTeacher"` branch; anonymous, provisioned, pending-teacher, inactive-teacher, student, suspended-user, and archived-user bootstrap outcomes never invoke the callable. The `assignmentDetailRegistry.clear()` on every non-active-teacher branch remains authoritative for cross-session state clearance.

## 12. Registry Hydration

The `AssignmentDetailRegistry` gained a `list()` accessor that returns a snapshot of the registered metadata. The Curriculum surface calls this once at mount and populates its per-`(uid, lessonSlug)` map so lesson cards can render `View summary` immediately after a reload.

## 13. Existing Publication-Path Compatibility

The Sprint 13B `assignmentDetail.register(...)` publish path is preserved unchanged; the publish-time payload now additionally carries `lessonSlug` and `classId`. Because the registry deduplicates by canonical `assignmentId`, hydrated and republished copies of the same assignment collapse into one entry. Newly published assignments in the current session still appear immediately without a reload.

## 14. Loading Behavior

Hydration awaits inside the entry-point `rerun` sequence but never blocks Curriculum rendering indefinitely. A run-token invalidation check prevents a stale hydration from mutating a superseded session.

## 15. Failure Behavior

Hydration is calm. A rejected `assignmentsTeacherList` callable is caught inside `hydrateAssignmentDetailRegistry` and never propagates. The teacher workspace still renders, lesson browsing remains available, and current-session publication still registers through the Sprint 13B publish path. No raw callable error is exposed to the DOM.

## 16. Confidentiality Posture

The response contract projects only teacher-owned assignment metadata: `assignmentId`, `lessonSlug`, `title`, `classId`, `className`, `status`. A dedicated backend test verifies that no field named `studentId`, `recipientId`, `attemptId`, `sessionId`, `teacherId`, `districtId`, `schoolId`, `answerKey`, `explanation`, or `recipients` appears on the returned items. The Sprint 12E Slice 1 aggregate-only boundary is preserved unchanged; the callable is orthogonal to and does not touch `assessmentAssignmentSummary`.

## 17. Firestore Rules Posture

Unchanged. `platform/firebase/firestore.rules` is not modified. Direct client `list` on assignments continues to be gated by the existing teacher-ownership rule; the certified callable operates through the Admin SDK trust boundary and does not require any rule relaxation.

## 18. Index Posture

`platform/firebase/firestore.indexes.json` is unchanged. The `teacherId == X && schoolId == Y && status in [...]` query composes two equality filters and a single `in` filter, which fits Firestore's built-in single-field indexing.

## 19. Audit Decision

`assignmentsTeacherList` is a read-only enumeration and does not emit a per-item audit event. This matches the platform pattern for aggregate-only read callables such as `assessmentAssignmentSummary`, which also does not emit audit events per request. A single info-level `assignments.teacherList` observability log line is written per call, capturing only the actor UID and the returned item count.

## 20. Files Created

- `platform/functions/src/assignments/assignments-teacher-list.ts`
- `platform/functions/src/assignments/assignments-teacher-list.test.ts`
- `app/src/assignments/detail/hydrate.ts`
- `app/src/assignments/detail/hydrate.test.ts`
- `app/src/assignments/detail/hydrate-wire.ts`
- `docs/platform/SPRINT_13C_COMPLETION_REPORT.md`

## 21. Files Modified

- `platform/functions/src/assignments/index.ts` (export the new callable and its request/response types).
- `platform/functions/src/index.ts` (register the new callable name).
- `app/src/assignments/detail/types.ts` (add optional `lessonSlug` and `classId` fields on `AssignmentDetailMetadata` for lesson and class association).
- `app/src/assignments/detail/registry.ts` (add `list()` accessor; document deduplication semantics).
- `app/src/index.ts` (hydrate registry on active-teacher session; expose `list()` through the Curriculum seam).
- `app/src/shell/surfaces/curriculum.ts` (accept optional `list()` accessor on the seam; seed per-lesson mapping from the registry at mount; include `lessonSlug` and `classId` in the publish-time `register` payload).
- `docs/platform/SPRINT_HISTORY.md` (append Sprint 13C entry).

## 22. Tests Added

- `platform/functions/src/assignments/assignments-teacher-list.test.ts` (11 tests): authorization rejection for non-teachers; propagation of missing district context; canonical query shape (`teacherId`, `schoolId`, `status in`); ownership retention; cross-owner defensive exclusion; cross-district defensive exclusion; class-owner mismatch exclusion; closed-status retention; deterministic ordering; response-field allowlist; empty result.
- `app/src/assignments/detail/hydrate.test.ts` (4 tests): registry population; calm failure; deduplication of hydrated and republished entries; `clear()` removes hydrated state.

## 23. Validation Results

- `platform/functions` targeted: `assignments-teacher-list` - 11 passed.
- `platform/functions` full: 872 passed, 0 failed, 39 test suites.
- `app` targeted: `assignments/detail` - 25 passed (Sprint 13B detail + Sprint 13C hydrate).
- `app` full: 309 passed, 1 failed (pre-existing baseline `curriculum/curriculumManifest.test.ts` drift; unchanged by this sprint).
- `platform/functions` typecheck: pass.
- `app` typecheck: pass.
- `platform/functions` lint: pass.
- `app` lint: pass.
- `platform/functions` build: pass.
- `app` build: pass (1.0 MB bundle).
- Four-item Teacher Workspace navigation: unchanged. Verified through the Sprint 13B `shell.test.ts` regression that reruns as part of the app suite.

## 24. Findings by Severity

- Critical: none.
- High: none.
- Medium: none.
- Low: none.
- Informational: the pre-existing `curriculum/curriculumManifest.test.ts` baseline drift is unchanged and remains outside Sprint 13C's scope; per repository policy, `npm run curriculum:build` was not run.

## 25. Certification Result

CONDITIONALLY CERTIFIED: Sprint 13C implementation is complete. Final certification requires resolution or formal acceptance of the pre-existing repository baseline test failure.

## 26. Recommended Next Bounded Slice

Add a calm, deterministic per-card selection UI for the case where a single lesson has multiple concurrent published or closed assignments across different classes. The selector should be scoped to lesson cards that actually surface more than one registered assignment, should use the existing shell components without introducing a new design system, and should preserve the confidentiality posture established in this sprint.

## 27. Multiple-Assignment Remediation

The original Sprint 13C release described a single-card `View summary` control that opened the last registered assignment for a lesson. That behavior was correct only for lessons with exactly one registered assignment. When more than one assignment existed for the same `lessonSlug` (per-class copies, republication cycles), the control still resolved to a single stored id, so the teacher could reach only one of the assignments through Curriculum. This section documents the remediation that closes that gap without expanding the certified retrieval-callable scope or changing any backend contract.

### 27.1 Correctness gap

The Sprint 13B session bucket stored `Map<lessonSlug, string>`. When a teacher published a second assignment for the same lesson, the second `assignmentId` overwrote the first inside the per-slug map even though both remained present inside the certified `AssignmentDetailRegistry`. Hydration exhibited the same shape: only the last item observed during hydration became the target of the lesson card. A teacher who had a Grade 6A and a Grade 6B copy of the same lesson could only reach one summary through the Curriculum surface without opening the direct URL.

### 27.2 Why silent single-assignment selection was unacceptable

Silently choosing an assignment based on hydration order or map iteration order violates the calm, deterministic behavior described in TEACHER_EXPERIENCE_PHILOSOPHY.md. It also creates the visible surprise of teachers reporting that the summary they were shown belonged to a different class than the one they intended to review, and it makes the lesson card unusable when both copies matter to the same teacher.

### 27.3 Grouping by lesson slug

A new pure helper module `app/src/assignments/detail/grouping.ts` groups any list of `AssignmentDetailMetadata` by `lessonSlug`. The Curriculum surface now stores a `Map<lessonSlug, Map<assignmentId, AssignmentDetailMetadata>>` and derives the visible per-lesson list via that grouping helper on every render.

### 27.4 Deduplication by assignment ID

The inner `Map<assignmentId, AssignmentDetailMetadata>` deduplicates by canonical `assignmentId`. A hydrated copy and a current-session republish of the same id collapse into one entry; the latest write wins so a status transition observed in-session supersedes the stale hydrated status. This matches the certified `AssignmentDetailRegistry` semantics.

### 27.5 Singular `View summary` behavior

When exactly one valid assignment exists for a lesson, the card renders the existing `View summary` control. Its accessible name, visible text, and click behavior are unchanged from Sprint 13B: it opens the exact registered `assignmentId` through the certified entry-point opener.

### 27.6 Plural `View summaries` behavior

When two or more valid assignments exist for a lesson, the card renders a single `View summaries` control (exact visible label, exact plural form). The control carries `data-assignment-count` reflecting the number of valid grouped assignments and no `data-assignment-id`, because no specific assignment is selected until the teacher chooses one.

### 27.7 Selection-interface design

Selecting `View summaries` opens a compact overlay dialog that reuses the existing `shell-assign-overlay` and `shell-assign-dialog` patterns already certified for the Assign dialog. The interface has:

- a clear `<h3>` heading naming the lesson (`Choose an assignment for {lesson.title}`),
- `role="dialog"` and `aria-modal="true"`,
- one native `<button>` per registered assignment inside a `role="list"` list,
- a Cancel control,
- Escape key dismissal,
- overlay-click dismissal,
- focus restoration to the invoking `View summaries` control,
- no nested interactive controls.

The interface is not a new design system; it is the same overlay style used elsewhere in the shell.

### 27.8 Displayed metadata

Each choice displays exactly `${className} · ${statusLabel}` where `statusLabel` is `Published`, `Closed`, or `Draft` (drawn from the same repository capitalization already used by the Sprint 13B Detail surface). No assignment id, class id, teacher id, district id, school id, recipient, attempt, session, roster entry, score, or answer information is rendered. Status is always conveyed textually; the CSS hook `data-status` is available for future styling but is never the sole channel.

### 27.9 Deterministic ordering policy

Choices are always rendered in the order produced by `compareAssignmentsForSelection`:

1. `className` ascending with a locale-aware base-sensitivity comparison,
2. status rank `published` (0) before `closed` (1) before `draft` (2),
3. `title` ascending with a locale-aware base-sensitivity comparison,
4. `assignmentId` ascending as the final stable tie-breaker.

Document retrieval order and JavaScript `Map` insertion order are never relied on as product behavior.

### 27.10 Exact assignment-opening behavior

Each choice invokes the injected entry-point opener with the exact `assignmentId` that choice represents. No choice ever opens another choice's assignment. The card never re-implements detail mounting; the opener seam remains the single path.

### 27.11 Publish-time updates

When `assignmentsPublish` resolves for a lesson that already has one or more registered assignments, the new assignment is added to the per-lesson `Map` by `assignmentId`. If the count crosses the 1 -> 2 boundary, the control label flips from `View summary` to `View summaries` immediately without a reload. If the same `assignmentId` is registered again, the entry is replaced in place; no duplicate choice appears.

### 27.12 Reload hydration behavior

After active-teacher hydration:

- every returned assignment is registered by canonical `assignmentId`,
- Curriculum derives every valid assignment for each lesson from the registry,
- lessons with one assignment show `View summary`,
- lessons with multiple assignments show `View summaries`,
- each assignment is selectable after reload with no extra callable request.

### 27.13 Invalid-metadata handling

`isValidForSelection` requires a non-empty `assignmentId`, `lessonSlug`, `title`, `className`, and a supported `status`. Entries that fail this check are silently excluded from the visible choices; they never suppress valid siblings. The registry retains the raw entry so a defect in the returned payload is not amplified into a permanent client-side outage.

### 27.14 Accessibility

- Singular control label: `View summary` (exact string).
- Plural control label: `View summaries` (exact string).
- Dialog has an `aria-labelledby` pointer to the visible `<h3>` heading.
- Each choice is a native `<button>`; keyboard reachable, no nested interactive controls.
- Each choice's accessible name is `Open assignment summary for {className}, {statusLabel}`.
- Escape closes the dialog.
- Focus returns to the `View summaries` control on close when the caller supplies it.
- Status is never conveyed by color alone.

### 27.15 Responsive behavior

The overlay reuses the certified `shell-assign-overlay` / `shell-assign-dialog` classes and adds `shell-summary-select-*` variants. The interface fits within existing spacing tokens, wraps long class names, avoids horizontal scrolling, avoids fixed desktop widths, and introduces no new global breakpoints.

### 27.16 Tests added

- `app/src/assignments/detail/grouping.test.ts`: pure grouping and comparator tests (grouping by slug, deduplication by id, invalid-entry exclusion, input-order independence, ordering by class name, published-before-closed for identical class names, title tie-breaker, assignmentId final tie-breaker).
- `app/src/shell/shell.test.ts` (new `Sprint 13C multiple-assignment selection` describe block): hydrated multiple assignments render `View summaries`; the selection dialog lists every assignment with class and status visible; class/assignment ids are never shown; sort order matches the policy; selecting a choice opens its exact assignment id; Escape dismisses without opening; publishing a second assignment flips `View summary` to `View summaries` without a reload; publishing another lesson does not alter the first lesson's choices; malformed hydrated entries do not suppress valid siblings.

### 27.17 Validation results (remediation)

- `app/src/assignments/detail/grouping.test.ts` - 12 passed.
- `app/src/shell/shell.test.ts` - 140 passed (all pre-existing Sprint 13B tests + 8 new Sprint 13C multiple-assignment tests).
- `app/src/assignments/detail/` targeted - 36 passed.
- `app` full suite - 328 passed, 1 failed (pre-existing `curriculum/curriculumManifest.test.ts` baseline; unchanged by this remediation).
- `platform/functions` full suite - 872 passed, 0 failed, 39 suites (unchanged).
- `app` typecheck: pass.
- `app` lint: pass.
- `app` production build: pass (1.0 MB bundle).
- Four-item Teacher Workspace navigation: unchanged.
- No backend callable, authorization, query, response shape, Firestore Rules, Firestore indexes, LMS, Google Classroom, notification, browser persistence, realtime listener, polling, or deployment change was made.
- No commit was made.

### 27.18 Updated findings by severity

- Critical: none.
- High: none.
- Medium: none.
- Low: none.
- Informational: the pre-existing `curriculum/curriculumManifest.test.ts` baseline drift is unchanged and remains outside Sprint 13C scope.

### 27.19 Updated certification

CONDITIONALLY CERTIFIED: Sprint 13C implementation is complete. Final certification requires resolution or formal acceptance of the pre-existing repository baseline test failure.
