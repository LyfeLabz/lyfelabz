# Sprint 28.6 - Architectural Blueprint

**Status:** Authoritative blueprint for Sprint 28.6 implementation. Produced by
Sprint 28.6B (Human Acceptance UX Architecture & Contract Lock).
**Phase constraint:** Sprint 28.6B is architecture-only. No production code,
tests, CSS, Functions, Rules, manifest, or lesson changes were made. Sprint 29
remains deferred.
**Baseline:** branch `main`, HEAD `8cd6150`, post-Sprint-28.5 (Teacher Platform
v1 UX frozen). This blueprint is the sanctioned re-opening of that freeze for a
bounded information-architecture revision approved by Chris.

Read this document with `CURRENT_PLATFORM_STATE.md` (canonical current state)
and its routing table. Where this blueprint and a subsystem contract disagree on
a security or scoring detail, the subsystem contract controls.

---

## 1. Disposition

**ARCHITECTURE LOCKED.**

The revised product model reuses existing architecture almost entirely. The one
genuinely new server capability - bounded, caller-scoped, lesson-level cross-
assignment analytics for Curriculum **View Summary** - has a clean reuse path
(the certified `assessmentAssignmentSummary` authorization + aggregation
pattern) that requires no new Firestore composite index. The single open
architectural question from 28.6A (Teacher Preview fidelity) is resolved in
favor of an existing, zero-mutation seam that is *more* faithful than the
28.6A-proposed public Practice Mode. No item requires a lesson-runtime redesign.

There is one deliberately scoped limitation, not a blocker: Preview faithfully
represents the instructional lesson and its quiz UI but intentionally does not
exercise the server-scored results screen, because that screen requires a real
attempt and Preview must create none. This is the correct boundary, documented
in Section 8.

---

## 2. Approved Product Model

### Teacher

| Surface | Question it answers | Owns |
| --- | --- | --- |
| **Classes** (new default landing, operational home) | "What is happening with my students?" | Class-specific assignments, student-specific information/results, operational assignment management |
| **Curriculum** (instructional library) | "What do I want to teach, and how has this lesson performed overall?" | Lesson discovery, Preview, Assign, lesson-level aggregate View Summary, related formal Resources |
| **Settings** (configuration) | "How is LyfeLabz configured?" | Real configuration, Google Classroom / class-management entry points, account info/actions, only functioning preferences |

Primary teacher navigation becomes **Classes · Curriculum · Settings**. Present
Mode leaves the primary v1 navigation (Section 8).

### Student

The student landing experience becomes a single page, **My Science**. The
`My Assignments` / `My Results` conceptual split is removed; each assignment is
shown together with its useful result/state. Assignments are grouped by science
domain. Unfinished work stays visually prominent; completed work stays available
but visually quieter. Student cards use the **canonical curriculum lesson title**
(e.g. "Earth's Layers"), never the stored teacher-authored assignment title
(e.g. "Earth's Layers - Check for Understanding"). The stored assignment title is
never mutated.

### Ownership rule (governs the whole IA)

> **Curriculum owns the LESSON. Classes owns a PARTICULAR ASSIGNMENT of that
> lesson.** Student-specific information belongs under Classes. Lesson-level
> aggregate information belongs under Curriculum.

---

## 3. Repository Evidence (verified seams)

| Concern | File / artifact | Finding |
| --- | --- | --- |
| Per-assignment aggregation + auth pattern to reuse | `platform/functions/src/assessments/assessment-assignment-summary.ts` | Caller-scoped via `requireDistrictContext`; teacher-role gate; 8-step ownership chain (assignment.teacherId/schoolId == caller, class ownership, defense-in-depth); frozen recipient subcollection is the population authority; PDR-029 tie-break selects best attempt; bounded queries with **no composite index**. This is the template for the new lesson-summary callable. |
| Teacher assignment enumeration + query shape | `platform/functions/src/assignments/assignments-teacher-list.ts` | Query `teacherId== schoolId== status in [published,closed(,draft)]`; returns `assignmentId, lessonSlug, title, classId, className, status, publishedAt`. Served with no composite index. |
| Composite indexes | `platform/firebase/firestore.indexes.json` | `"indexes": []` (only a `recipients` collection-group field override). Confirms the lesson-summary callable must **reuse the existing indexed query shape** and filter `lessonSlug` in memory rather than add a `lessonSlug` composite index. |
| Preview runtime behavior | `app/src/runtime/entry.ts`, `app/src/runtime/orchestrator.ts` | With no `?assignment` query, `bootstrap` installs an **inert** runtime and returns: no Firebase init, no auth listener, no network. Orchestrator mode `inert`; `begin/autosave/finalize` are hard no-ops without assignment context. Session/attempt creation is structurally impossible in standalone mode. |
| Launch/preview URL builder | `app/src/assignments/studentList/launch.ts`, `launchOverrides.ts` | `buildLessonBasePath(slug)` returns the override-aware path: `/app/lessons/lesson_<slug>.html` for all 49 migrated lessons, else `/lesson_<slug>.html`. Assigned launch appends `?assignment=<id>`; standalone/practice omits it. |
| Formal resources | `curriculum.manifest.json` totals | 50 lessons, 1 gated (behavioral-science) → 49 assignable. Resources: **3 simulation + 4 investigation + 5 extension + 1 challenge = 13**. `game`, `activity`, `map`, `disease` counts are **0** - games are already excluded from the manifest. Confirms 28.6A; no second registry needed. |
| Science domains | `curriculum.manifest.json` topicGroups | `earth-space` (15), `life-science` (12), `physical-science` (11), `tech-engineering` (11), `behavioral-science` (1, gated). Labels come from `TOPIC_LABEL`/topicGroups. |
| Default Grade preference | `app/src/teacherPreferences/types.ts`, `platform/functions/src/teachers/teacher-preferences-update.ts` | `defaultGrade` at `users/{uid}/preferences/teacher`; read by Manual Create + Settings; write by Manual Create + Settings via `teacherPreferencesUpdate`. Convenience only; never restricts a class. |
| Navigation | `app/src/shell/navigation.ts` | `NAVIGATION_ITEMS` order: Workspace(brand→curriculum), Curriculum, Classes, Present Mode, Settings. Default `activeKey` = `curriculum`. Reorder + default change + Present Mode removal is a bounded data edit. |
| Active Assignments today | `app/src/shell/surfaces/shared/activeAssignments.ts` mounted in `app/src/shell/surfaces/curriculum.ts` | `renderActiveAssignmentsSection` consumes `assignmentsTeacherList` (which already carries `classId`). Re-homing to a class-filtered Assignments tab is a re-home + filter, not a rebuild. |
| Assignment Detail | `app/src/assignments/detail/*`, shell outlet (Sprint 28.5 D2A) | Opened by `assignmentId`, renders inside the workspace shell via a bounded outlet seam. Already hosts Close/Reopen and the late-recipient add flow. Reachable independent of entry path. |
| Late recipients | `platform/functions/src/assignments/assignments-recipient-candidates.ts`, `assignment-recipients.ts`; `app/src/assignments/detail/late-recipient-wire.ts` | Candidate = server-side set difference (active enrollments minus frozen recipients); only `published` yields candidates; explicit Add; frozen-recipient immutability preserved. Capability and wire unchanged; only its entry path moves under Classes. |
| Student data | `platform/functions/src/assignments/assignments-list-for-student.ts` + student attempts | List returns `assignmentId, lessonSlug, title, status(published), publishedAt`, caller-scoped. Best %/best score/attempt count/status are derived client-side by joining attempts, exactly as My Assignments/My Results do today. |

---

## 4. Teacher Navigation Contract

- **Final primary nav (top-to-bottom):** `Classes`, `Curriculum`, `Settings`.
  Brand/`Workspace` item retained; its `targetSurface` changes from `curriculum`
  to `classes` so the brand mark lands on the operational home.
- **Default landing:** `classes` (change `renderNavigation` default `activeKey`
  and the shell's initial surface).
- **Present Mode:** removed from `NAVIGATION_ITEMS` and from
  `WorkspaceSurfaceKey`. The `presentMode` surface module and
  `app/src/presentMode/*` are left dormant (not deleted) so a future genuine
  classroom-presentation tool can restore it (Section 8).
- **Migration sequencing (mandatory):**
  1. Build the Classes → Class → Assignments → Assignment Detail operational
     path (28.6C).
  2. Only then make Classes the default landing, reorder nav, remove Present
     Mode, remove Active Assignments from Curriculum, add Preview / View Summary
     / Resources to Curriculum cards (28.6D).
  At no point may the teacher lose the established assignment-management entry
  path before its replacement exists.

---

## 5. Classes / Class Workspace Contract

### Top-level Classes surface

- **Class card (smallest useful set, no N+1 reads):**
  - Class name (title).
  - Grade · block line (e.g. `G6 · Block A`) from class metadata.
  - Assignment count (e.g. `3 assignments`) derived by grouping
    `assignmentsTeacherList` items by `classId` - **already loaded once** for
    the whole teacher, no per-class call.
  - Optional single compact "most recent assignment" preview line
    (`Earth's Layers · 18 / 22 completed`). Completion for that preview is the
    per-assignment `assessmentAssignmentSummary` `completedStudents/totalStudents`.
    Because a naive per-card summary call is N+1, v1 renders the completed/total
    fragment **only for the class's single most recently published assignment**,
    fetched lazily/on demand, or omits it if the batching cost is not yet
    justified. Average score, attempt analytics, and student details do **not**
    appear on the top-level card.
- **`+ Add a class`** entry point is always present (including on an empty
  Classes page) and invokes the **same** class-management workflows Settings
  exposes (Import from Google Classroom / Create LyfeLabz Class). No duplicate
  import/create implementation. An empty Classes page is never a dead end.

### Class workspace (opening a class)

Conceptual sections: **Overview · Assignments · Students**. Implemented with the
smallest existing navigation/state architecture - the class workspace already
has a Snapshot/Roster segmented switcher (Sprint 28.5 D3); extend that same
switcher pattern rather than introducing new routing.

| Section | Responsibility | Data source |
| --- | --- | --- |
| **Overview** | Quick class-level operational info (name, grade/block, roster/link state, assignment count). Maps onto the existing Snapshot surface. | class record + grouped `assignmentsTeacherList` |
| **Assignments** | Assignments belonging to *this* class, with useful operational metrics (status, completed/total). This is the re-homed `renderActiveAssignmentsSection` filtered by `classId`. Each row opens **Assignment Detail**. | `assignmentsTeacherList` filtered to `classId`; per-row `assessmentAssignmentSummary` on open/expand |
| **Students** | Roster / student-oriented information (existing Roster view). Assignment-specific student results are reachable by opening an assignment (Assignment Detail), not via a general dashboard. | existing roster/`syncRoster` |

### Assignment Detail (entry re-home only)

Assignment Detail is unchanged in capability. Its entry point moves from
Curriculum → Active Assignments to **Classes → Class → Assignments → row**. It
continues to host lifecycle (Close/Reopen, demoted per Section 12) and the
late-recipient add flow (Section 12). No general analytics dashboard is built.

**Metrics by level:** class card = name + grade/block + assignment count
(+ optional one-assignment completed/total); Assignments section =
per-assignment status + completed/total; Assignment Detail = the full certified
per-assignment monitoring (existing). Lesson-level aggregates never appear here;
they live in Curriculum View Summary.

---

## 6. Curriculum Contract

Curriculum stays **lesson-centric**. It must not drift back into assignment
management (Active Assignments leaves it in 28.6D, after 28.6C ships).

### Lesson card

```
Earth's Layers
G6 · Earth & Space Science

[Assign]   [Preview]

View Summary        Resources · 2
```

- Title = canonical unit title; sub-line = `G{grade} · {TOPIC_LABEL[topic]}`.
- **Action hierarchy (locked):**
  - **Assign** = primary instructional action (existing Assign dialog /
    `ASSIGN_EXPERIENCE.md`). Remains available after previous assignments (a
    lesson can be assigned to more classes or re-assigned to the same class).
  - **Preview** = quieter inspection action (Section 7).
  - **View Summary** = meaningful secondary analytics action (Sections 7, 10,
    11). Appears only when the lesson has at least one owned published/closed
    assignment (Section 10 entry states); otherwise unavailable/hidden.
  - **Resources** = related instructional materials disclosure (Section 9).
- **Assigned-state behavior:** a lesson the teacher has assigned may show a
  quiet "assigned" affordance and enables View Summary. It does **not** list the
  specific assignments inline (that is Classes). The teacher reaches a specific
  operational assignment via Classes, not from the Curriculum card.
- **G6:** grade metadata from the manifest is displayed on the card (the
  existing All / Grade 6 / Grade 7 framing is preserved; no structural change).

---

## 7. Preview Fidelity Finding (mandatory)

**Question:** Is the 28.6A-proposed seam (Curriculum → public lesson URL →
Practice Mode) faithful to the current assigned student experience, or is a
purpose-built v2 Preview required?

**Answer:** The *public v1 URL* (`/lesson_<slug>.html`) is **not** faithful, but
a closely related existing seam - the **v2 artifact without `?assignment`** - is
faithful *and* zero-mutation. Select the v2 seam.

### Public Practice Mode (v1 URL) vs current v2 assigned lesson

| Dimension | Public v1 `/lesson_<slug>.html` | v2 assigned `/app/lessons/lesson_<slug>.html?assignment=<id>` |
| --- | --- | --- |
| Artifact | Separate v1 build; retains legacy classroom apparatus (name/teacher/block gating) | v2 build; no legacy classroom |
| Results UX | Legacy v1 results flow | Hardened v2 results (O2 scroll offset, focus, `role="status"`; O3 `Back to My Assignments`) |
| Runtime | Same shared assessment bundle, but v1 markup differs | v2 markup + shared bundle |

Because the v1 artifact differs in chrome and results behavior, **choosing the
v1 URL merely for ease would misrepresent the current student experience.**

### v2-without-`?assignment` vs v2 assigned lesson

| # | Fidelity question | Finding |
| --- | --- | --- |
| 1 | Same underlying lesson content? | **Yes** - identical generated v2 artifact. |
| 2 | Same layout/runtime? | **Yes** - same artifact, same esbuild bundle. |
| 3 | Same interactions? | **Yes** - vocabulary cards, diagrams, quiz UI all render and function. |
| 4 | Assessment questions available? | **Yes** - the quiz renders and can be answered; the lesson's local practice path shows local feedback. |
| 5 | Differs only in assignment authority/submission? | **Yes** - `hasAssignmentContext()` is the only behavioral fork. Without it, `autosave`/`finalize` no-op (`return null`); the pipeline is never entered. |
| 6 | Omits important v2 student behavior? | Only the **server-scored results screen** (score, item results, the O2/O3 hardened results transition), which is inherently attempt-backed and must not be created in Preview. Acceptable and intended. |
| 7 | Any of the four hardened lessons materially different this way? | No - they render identically; only the attempt-backed results differ, uniformly. |
| 8 | Remaining 45 migrated lessons? | Identical behavior - all 49 share one runtime bundle and the same fork. |

### Selected Preview architecture

**Curriculum Preview → open `buildLessonBasePath(slug)` (override-aware v2 path
for migrated lessons) with NO `?assignment` query, in a new tab.**

- Reuses the existing `buildLessonBasePath` seam already used by the launcher and
  the Sprint 27 deep-link practice handoff. **No duplicate renderer.**
- **Mutation guarantees (by construction):** standalone mode installs an inert
  runtime and returns before any Firebase initialization - it cannot create a
  session, cannot create an attempt, cannot autosave, requires no fake student
  identity, does not touch assignments, and does not weaken student
  authorization. A teacher (authenticated as `role: teacher`) opening the URL
  stays inert because the auth listener is never attached in standalone mode.
- **Implementation footprint:** trivial. A `Preview` control per Curriculum card
  computes `buildLessonBasePath(slug)` and opens it (`target="_blank"`,
  `rel="noopener"`). No callable, no rules, no runtime change.
- **Risk:** low. The one honest limitation (Section 1) is the intentional
  absence of the server-scored results screen. No lesson-runtime redesign is
  required; nothing to flag for deferral beyond that documented boundary.
- **Edge to confirm in 28.6D:** every Curriculum-surfaced lesson is migrated
  (49/49 assignable have v2 overrides; the 50th unit is gated and not surfaced),
  so `buildLessonBasePath` resolves to v2 for every previewable card. If a future
  surfaced lesson lacks a v2 override, Preview falls back to its v1 URL; treat
  that as a migration gap to close, not a Preview defect.

---

## 8. Present Mode Disposition

**v1 decision: remove Present Mode from the primary navigation.** 28.6A found it
primarily placeholder/future-facing, and `CURRENT_PLATFORM_STATE.md` §10
confirms it is a structurally separate instructional surface with no Firebase
SDK. Its former "show students the lesson" purpose is met faithfully by lesson
Preview (Section 7).

- Remove the `present-mode` nav item and default routing to it.
- Leave `app/src/shell/surfaces/presentMode.ts` and `app/src/presentMode/*`
  dormant in the tree (not deleted) so a future genuine tool can restore it.
- **Do not build** teacher-controlled pacing, synchronized screens, reveal/hide,
  polling, classroom display controls, or timers now. Present Mode may return as
  its own sprint when it becomes a real classroom-presentation capability.

---

## 9. Resources Contract

- **Reuse the existing curriculum manifest.** Each core lesson unit already
  carries its formal related resources as `resources[]` children (types
  `simulation`, `investigation`, `extension`, `challenge`). No second registry.
- **Formal inventory (verified):** 3 simulations, 4 investigations, 5 extensions,
  1 challenge = **13 total**, distributed as children of their parent lessons.
- **Games excluded:** the manifest carries `game: 0`. Games are not formal
  LyfeLabz curriculum; they must not appear in Curriculum Resources, must not be
  migrated, modernized, or deleted by this sprint.
- **Teacher interaction:** Resources is a lesson-scoped disclosure on the
  Curriculum card. `Resources · N` reveals the lesson's formal children inline
  (or via a small bounded panel using the existing card idiom - no new design
  system). Resources are children of the lesson, never peer lesson tiles.
- **Assignability (locked):** each resource action is **Open / Preview** only,
  opening the resource's `href` (public instructional page) in a new tab. For
  v1, resources are **not** assignable; they are not forced through the
  assessment/assignment architecture. (If, later, independent assignment is
  proven safe, it becomes its own scoped decision.)

---

## 10. View Summary - Server Analytics Contract

New callable: **`assessmentLessonSummary`** (Cloud Function, `platformCallable`).
It answers: "How has this lesson performed across the classes/assignments I own?"
It is caller-scoped and bounded; it never does client-side assignment fan-out.

### Input

```ts
type AssessmentLessonSummaryRequest = { readonly lessonSlug: string };
```

- `lessonSlug` validated to the canonical slug pattern
  (`/^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/`, matching
  `LESSON_SLUG_PATTERN`).
- Forbidden-key rejection identical to `assessmentAssignmentSummary`
  (`studentId`, `uid`, `teacherId`, `districtId`, `schoolId`, `classId`,
  `groupBy`, `aggregate`, `filter`, ...) with a single canonical
  `assignments.invalidRequest`. No owner-scoping/aggregation key is accepted.

### Output

```ts
type AssessmentLessonSummaryResponse = {
  readonly lessonSlug: string;
  readonly classesAssigned: number;        // unique owned classes with this lesson assigned
  readonly students: number;               // unique students who received this lesson
  readonly studentsCompleted: number;      // unique students with >=1 completed attempt
  readonly completionPercentage: number;   // studentsCompleted / students * 100, half-up int
  readonly averageBestPercentage: number | null; // avg of each completed student's best; null if none
  readonly assignmentsConsidered: number;  // count of owned published/closed assignments of this lesson
};
```

Only bounded numeric aggregates cross the boundary. No student/attempt/session/
recipient identifier, name, response, item result, or answer-key value is ever
returned (mirrors the certified `assessmentAssignmentSummary` projection rule).

### Authorization

- `requireDistrictContext(request)` → authenticated + active + canonical claims
  + district agreement. Non-teacher callers refused `role-forbidden`.
- Ownership source is the **verified caller context** (`uid`, `schoolId`,
  `districtId`) - never a client-supplied identifier.
- Every assignment considered must satisfy `teacherId === caller.uid` and
  `schoolId === caller.schoolId`; every recipient/attempt/session admitted is
  re-checked against the loaded assignment's frozen ownership fields
  (assignmentId, classId, teacherId, schoolId, districtId) exactly as
  `assessmentAssignmentSummary` does. This reuses the existing teacher
  assignment-summary authorization pattern rather than inventing a new one.

### Query strategy (bounded, no new index)

1. `assignments.where("teacherId","==",uid).where("schoolId","==",schoolId)
   .where("status","in",["published","closed"]).get()` - the **exact existing
   `assignmentsTeacherList` query shape**, served by auto single-field indexes.
2. Filter that result set in memory to `record.lessonSlug === lessonSlug` and to
   the belt-and-suspenders ownership predicate. This is the bounded owned-
   assignment set for the lesson (typically a handful; a teacher owns tens of
   assignments total).
3. For each matched assignment, read - in parallel, bounded by the matched set:
   - its `assignments/{id}/recipients` subcollection (frozen population),
   - `attempts.where("assignmentId","==",id)` (auto index),
   - `assessmentSessions.where("assignmentId","==",id)` (auto index - only if a
     future in-progress metric needs it; v1 metrics below do not require
     sessions, so this read may be omitted for v1).
4. Aggregate across the matched assignments per Section 11.

**No `lessonSlug` composite index is added.** `firestore.indexes.json` remains
`"indexes": []`. The lesson filter is applied after the indexed teacher/school/
status query, exactly the boundedness posture 28.6B mandates over unbounded
client fan-out.

### Empty state / malformed lesson

- Unknown or never-assigned `lessonSlug`: step 2 yields zero assignments →
  `classesAssigned: 0`, `students: 0`, `studentsCompleted: 0`,
  `completionPercentage: 0`, `averageBestPercentage: null`,
  `assignmentsConsidered: 0`. No error. The client uses this to render View
  Summary as unavailable/empty (Section 11 entry states).
- Malformed `lessonSlug` (fails the pattern): `assignments.invalidRequest`.
- A lesson slug that is valid but not in the manifest is not an error server-side
  (the server does not consult the manifest); it simply returns the zero
  aggregate.

### Boundedness / performance

- Reads scale with the number of the teacher's own published/closed assignments
  of that one lesson (bounded, small in v1 - four teachers). The initial teacher/
  school/status query is the same one already run for the teacher list. No fan-
  out over classes the teacher does not own; no unbounded client iteration.
- Deterministic: identical inputs and Firestore state always yield identical
  output (fixed tie-break, fixed rounding, set-based dedup).

### Extensibility

The response is additive-friendly (new bounded numeric fields can be appended
without breaking older clients, exactly as `assignmentsTeacherList` grew
`instructions`/`publishedAt`). Do **not** pre-build fields for the deferred
advanced analytics (Section 19); keep the seam small.

---

## 11. Analytics Semantics

**Governing principle:** the lesson-level View Summary answers a *lesson-mastery*
question across all of a teacher's classes. Operational, assignment-specific
"is *this* assignment done" questions are answered elsewhere - by the existing
`assessmentAssignmentSummary` under Classes → Class → Assignment Detail. Because
the operational question has its own home, View Summary is free to use **unique-
student** semantics without being misleading. All rate/score metrics therefore
share **one population - unique students** - and denominators are never mixed.
`Classes Assigned` is a separate structural count (not a rate), so it does not
mix with the student population.

| Metric | Exact definition | Repeated-assignment behavior |
| --- | --- | --- |
| **Classes Assigned** | Count of **distinct `classId`** among the teacher's owned `published`/`closed` assignments of this lesson. | A class assigned the lesson twice counts **once** (distinct classId). |
| **Students** | Count of **distinct `studentId`** across the frozen `recipients` snapshots of those assignments (union, deduped by studentId; each recipient row validated against the loaded assignment's frozen ownership, `status === "assigned"`, `doc.id === studentId`). | A student who received the lesson in two assignments (same class re-assign, or two classes) counts **once**. |
| **Completion** | `studentsCompleted / students`, half-up to an integer percent. `studentsCompleted` = distinct students in the population with **≥1 completed attempt in any** of the matched assignments. `0` when `students === 0`. | A student assigned twice who completed at least one instance is **complete once**. Because this is lesson-mastery, not per-assignment operations, "did Period 2 do the January re-assign specifically" is answered under Classes, not here. |
| **Average Best Score** | For each distinct **completed** student, select their single best completed attempt **across all matched assignments** using the PDR-029 tie-break (percentage, then attemptNumber, then `submittedAt` ms, then ascending `attemptId`; extended by a final ascending `assignmentId` tiebreak so cross-assignment selection is fully deterministic). Average those percentages; half-up to an integer. **Denominator = distinct completed students** (students with no completed attempt are excluded). `null` when no completed students. | A student assigned twice contributes exactly **one** best score - the higher across both instances. |

### Denominator discipline (locked)

- `Students`, the `Completion` numerator/denominator, and `Average Best Score`
  all key on **unique student**. They compose intuitively: a teacher reading
  "Students 45 · Completion 80%" correctly infers 36 students completed.
- `Classes Assigned` is structural and never a rate denominator.
- The assignment-recipient-instance alternative for Completion/Average was
  considered and **rejected** for v1: it would mix an instance denominator into
  a surface whose headline counts are unique, producing the exact "80% of what?"
  ambiguity 28.6B warns against. Its legitimate use (per-assignment operational
  completion) is already served by `assessmentAssignmentSummary`.

### Labels (locked, to avoid implying the wrong denominator)

- "Classes Assigned" · "Students" · "Completion" (rendered as
  `studentsCompleted / students` completed, e.g. "36 / 45 students completed")
  · "Average Best Score". The Completion chip should show the fraction, not only
  a bare percentage, so the unique-student denominator is explicit.

### Rounding (locked)

Half-up to the nearest integer via the existing `roundPercentage` convention
(clamp 0–100, `Math.round`). Perfect-score handling, if surfaced later, uses the
raw `score === maxScore && maxScore > 0` test, matching
`assessmentAssignmentSummary`.

---

## 12. Lifecycle / Late Recipients

### Assignment lifecycle (backend preserved, UI demoted)

- **Preserve unchanged:** `draft` / `published` / `closed` / `archived`
  semantics; authorization behavior; the `assignmentsClose` and
  `assignmentsReopen` callables; every lifecycle test. Do **not** redesign the
  lifecycle.
- **Presentation decision:** Chris's philosophy is that students should normally
  remain able to complete and retry assigned work, so Close/Reopen must no longer
  read as an everyday action. Smallest treatment: within **Assignment Detail**
  (its only home), move Close/Reopen out of the primary action row into a
  secondary/administrative affordance (e.g. a quiet "Manage" / overflow area or a
  de-emphasized control), keeping full keyboard access and the existing status
  pill. No prominent everyday Close button anywhere; the capability stays one
  interaction away. The existing calm `closed`-state informational copy (Sprint
  28 O5) is retained.

### Late recipients (capability preserved, entry re-homed)

- **Preserve unchanged:** candidate calculation
  (`assignmentsRecipientCandidatesList` set difference), explicit **Add**
  (`assignmentsRecipientAdd`/`assignment-recipients`), success feedback, failure/
  retry, accessibility (`aria-live` announcements), and recipient immutability /
  frozen-recipient semantics. Newly enrolled students are **never** silently
  auto-added to previously published assignments. Do not weaken the authorization
  contract.
- **New home:** the late-recipient add flow already lives in Assignment Detail;
  in 28.6C Assignment Detail is reached via Classes → Class → Assignments → row,
  so late-recipient management naturally moves into the class-centered assignment/
  student workflow with **no change to the capability or its wire**.

### Contracts/tests that must remain green

Assignment lifecycle authorization tests; Close/Reopen callable tests;
recipient-candidate set-difference tests; recipient-add success/failure/idempotency
tests; frozen-recipient immutability tests; the `assessmentAssignmentSummary`
population-stability-under-roster-churn tests.

---

## 13. Settings Contract

Restrained v1 structure; no roadmap ideas presented as settings.

- **Classes & Google Classroom** (administrative home for class management):
  - Current Google Classroom connection state (existing
    `settings/integrations`).
  - **Import Class from Google Classroom** - visually **primary**.
  - **Create LyfeLabz Class** - secondary.
  - These are the same workflows the Classes `+ Add a class` entry invokes; one
    implementation, two entry points.
- **Account:** only actual account information/actions where appropriate.
- **Preferences:** only if a real functioning preference remains after Default
  Grade removal (Section 14). If none remain, omit the Preferences section
  entirely rather than show an empty shell.
- **Remove** future-facing/nonfunctional Settings concepts from the live surface.

---

## 14. Default Grade Removal

- **Remove** the global teacher **Default Grade** preference from the v1 live
  surface. Grade/block belongs to the **class**, not the teacher.
  - Imported class: Import → setup if needed → choose/confirm grade/block →
    activate (preserve the existing `needsSetup` architecture).
  - Manual class: Create → choose grade/block.
  - Preserve per-class grade/block; preserve `needsSetup`.
- **Cleanup footprint:**
  - **UI:** remove the Default Grade control from Settings; remove the
    Manual Create prefill that reads `defaultGrade`.
  - **Preference reads:** remove `ReadTeacherDefaultGrade` consumers (Manual
    Create prefill, Settings).
  - **Preference writes:** remove `UpdateTeacherDefaultGrade` call sites (Manual
    Create best-effort write, Settings set/clear).
  - **Callable:** `teacherPreferencesUpdate` may remain deployed but unused, or
    have the `defaultGrade` field ignored; do not repurpose it this sprint.
  - **Tests:** update/remove Default-Grade-specific client and callable tests;
    keep any teacher-preferences infrastructure tests that remain meaningful.
  - **Data:** stored historical `users/{uid}/preferences/teacher.defaultGrade`
    documents may **remain inert**. **No data migration.**

---

## 15. Student My Science Contract

### Shell / header

Smallest student shell: `LYFELABZ` wordmark · student identity · `Log out`, then
the `My Science` heading and the page content. No teacher-style sidebar, no extra
student navigation, no dashboard widgets. With My Results removed, the student
needs no persistent navigation beyond the page itself.

### Page structure

- **Domain grouping** using canonical curriculum metadata (manifest `topic` via
  `lessonSlug`), source of truth - never duplicated into student-owned or
  assignment-authored documents.
  - **Canonical domain order (locked):** Earth & Space Science, Life Science,
    Physical Science, Tech & Engineering. (`behavioral-science` is gated / not
    assignable and never appears.)
  - **Empty domain:** a domain with no assignments for this student is **omitted**
    (no empty section shells).
  - **Unresolvable lesson metadata:** if a `lessonSlug` cannot be resolved to a
    manifest topic, place the card in a single trailing **"More"** / other group
    rather than dropping it, so the assignment is never lost. (Fallback title:
    Section below.)
  - **Within-domain ordering:** unfinished before completed; then a stable
    deterministic key (e.g. `publishedAt` desc, then `lessonSlug` asc).
- Within each domain, two visual tiers: **Unfinished** (prominent) and
  **Completed** (available but quieter).

### Card contracts

Derived by joining the caller-scoped `assignmentsListForStudent` items with the
student's own attempts (both already loaded today; caller-scoped privacy
boundary preserved).

**Unfinished card:**
- Canonical lesson title.
- Derived status (e.g. "Ready to begin" / "In progress").
- Primary action: **Open assignment** (launches via the existing
  `buildAssignmentLaunchUrl`, i.e. the v2 artifact **with** `?assignment`).

**Completed card (quieter):**
- Canonical lesson title.
- Derived completion status.
- Best score / percentage (best completed attempt).
- Attempt count.
- Primary action: **Open assignment** (re-launchable; supports Improve My Score
  where the best score is < 100%).
- **No separate Results action** - the result data lives on the card. Do not add
  a Results button unless later evidence requires it.

### Canonical title contract ("Check for Understanding")

- Student My Science resolves the display title from the **canonical curriculum
  lesson title** (manifest unit `title` for the `lessonSlug`), e.g.
  "Earth's Layers".
- The **stored teacher-authored assignment title is never mutated** and remains
  the teacher-facing title everywhere on the teacher side.
- **Fallback:** if the `lessonSlug` cannot be resolved in the manifest, fall back
  to the stored assignment `title` returned by `assignmentsListForStudent` (never
  a blank card). This is the same slug that groups the card into "More" per the
  unresolvable-metadata rule.

### My Results disposition

`My Results` as a separate destination is **retired**. Its information is folded
into the completed cards on My Science. No separate results page or nav item
remains.

---

## 16. Accessibility Contract

Preserve and extend the existing standard; prefer native semantics over
unnecessary ARIA.

**Teacher:**
- Navigation selected state via `aria-current="page"` + non-color cue (existing).
- Classes / Class workspace section switcher: proper button semantics, selected
  state not by color alone, keyboard operable.
- Assignment Detail landmarks preserved (shell outlet, headings, status pill).
- Preview: keyboard-accessible control; opens in a new tab with `rel="noopener"`;
  announce new-tab behavior where the idiom is used.
- Resources: keyboard-accessible disclosure; `aria-expanded` on the toggle;
  focus order preserved.
- View Summary: numeric aggregates exposed as text (table or definition list),
  not color-only; empty/unavailable state announced clearly.
- Class-management dialogs (Import / Create / `+ Add a class`): focus trap,
  labelled controls, escape-to-close (existing dialog idiom).
- Late-recipient live regions (`aria-live`) preserved unchanged.

**Student:**
- Correct heading hierarchy: `My Science` (h1) → domain section headings (h2) →
  cards.
- Domain section headings are real headings, navigable by assistive tech.
- Card actions are real buttons/links with discernible names (include the lesson
  title in the accessible name).
- Status conveyed by text/shape, **not color only** (unfinished vs completed).
- Visible focus on every interactive element.
- Completed-card readability: quieter styling must retain sufficient contrast.
- Logout reachable and labelled.
- Result/status text is readable by assistive tech; announce launch/return
  transitions where the existing v2 results contract already does.

---

## 17. Responsive Contract

Priority widths: **1280 desktop · 1024 classroom laptop · 768 tablet · narrow/
mobile**. No horizontal page scroll at any width (wide content scrolls within its
own container).

- **Teacher** may remain denser than student (existing shell posture).
- **Classes cards** with an assignment-preview line must stay compact - card
  grammar, not giant dashboard panels. Reflow the class grid (multi-column →
  single column) at the existing breakpoints; the assignment-preview line wraps
  or truncates gracefully.
- **Class workspace** Overview/Assignments/Students switcher collapses using the
  existing Snapshot/Roster responsive behavior.
- **Curriculum** lesson cards keep the existing 4/3/2 density at 1280/1024/768;
  the added Preview / View Summary / Resources affordances must not force
  horizontal overflow.
- **Student My Science** domain grouping stays easy to scan on narrow screens:
  domain headings stack, cards go single-column, tap targets meet the coarse-
  pointer minimums.

---

## 18. Implementation Dependency Graph

```
                       ┌─────────────────────────────────────────┐
                       │ 28.6C  Classes + Class Workspace         │
                       │ operational assignment path              │
                       │ (Overview/Assignments/Students;          │
                       │  re-home Active Assignments filtered by  │
                       │  classId; Assignment Detail entry;       │
                       │  late-recipient + Close/Reopen live here)│
                       └───────────────┬─────────────────────────┘
                                       │  MUST precede
                                       ▼
     ┌──────────────────────────────────────────────────────────────┐
     │ 28.6D  Teacher nav + Curriculum simplification                │
     │  - Classes becomes default landing; nav = Classes/Curriculum/ │
     │    Settings; remove Present Mode                              │
     │  - REMOVE Active Assignments from Curriculum  ◄── gated by 28.6C│
     │  - add Preview (Sec 7), Resources (Sec 9); View Summary entry │
     └───────┬───────────────────────────────────┬──────────────────┘
             │                                   │
             ▼                                   ▼
 ┌───────────────────────────┐      ┌────────────────────────────────┐
 │ 28.6E  View Summary        │      │ 28.6F  Settings simplification │
 │ assessmentLessonSummary    │      │  - remove Default Grade        │
 │ + Curriculum summary surface│      │  - class mgmt + `+ Add a class`│
 │ (Sec 10-11)                │      │    reuse (Sec 13-14)           │
 └───────────────────────────┘      └────────────────────────────────┘

 ┌────────────────────────────────────────────────────────────────────┐
 │ 28.6G  Student My Science (independent of teacher phases; may run    │
 │ in parallel after 28.6B; no dependency on 28.6C-F)                   │
 └────────────────────────────────────────────────────────────────────┘

 ┌────────────────────────────────────────────────────────────────────┐
 │ 28.6H  Human acceptance recertification (last; needs C-G landed)     │
 └────────────────────────────────────────────────────────────────────┘
```

**Load-bearing invariant (proved by the graph):** the Classes assignment-
management path (28.6C) ships **before** Active Assignments is removed from
Curriculum (28.6D). The teacher never loses the assignment-management entry
point. Likewise, Classes does not become the default landing until the class
workspace is usable (both changes are inside 28.6D, sequenced after 28.6C).

The View Summary *entry affordance* appears on the Curriculum card in 28.6D but
renders live data only once 28.6E lands the callable; until then the control is
absent or clearly unavailable (Section 10 empty state covers the data side).

---

## 19. Deferred Items

- **Advanced analytics** (NOT in 28.6 View Summary v1): hardest/most-missed
  questions, misconception/concept-level analytics, aggregated Show Your Thinking
  analysis, longitudinal analytics, charts, AI analysis.
- **Future Present Mode** as a genuine classroom-presentation tool (pacing,
  synchronized screens, reveal/hide, polling, display controls, timers).
- **Learning supports** and any other new instructional-component families
  (preservation mode).
- **Legacy games** - excluded from formal curriculum; not migrated, modernized,
  or deleted.
- **Resource independent assignability** - Open/Preview only in v1.
- **Sprint 29 release work:** private GitHub transition; Privacy Policy; Terms of
  Use; Google OAuth privacy-policy URL; OAuth branding/disclosure review; four
  authorized production teachers + production allowlist; assessment revision
  deployment; curriculum manifest regeneration; Secret Manager / release hygiene;
  production deployment; final production certification. Privacy/OAuth disclosure
  is a **release requirement**, not optional backlog. None of it happens in 28.6.

---

## 20. Cross-References

- Current state + routing: `CURRENT_PLATFORM_STATE.md`.
- Assign workflow: `ASSIGN_EXPERIENCE.md`.
- Assessment attempt/answer-key/scoring: `ASSESSMENT_IMPLEMENTATION_CONTRACT.md`,
  `ASSESSMENT_SCORING_CONTRACT.md`; tie-break policy PDR-029.
- Deep links / launch: `GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md`;
  `app/src/assignments/studentList/launch.ts`.
- Class default metadata / setup: `ADR_TEACHER_DEFAULT_CLASS_METADATA.md`.
- Human acceptance context: `SPRINT_28_5_HUMAN_ACCEPTANCE_WALKTHROUGH.md`,
  `SPRINT_28_5_CROSS_PLATFORM_CERTIFICATION.md`.
- Execution sequence: `SPRINT_28_6_IMPLEMENTATION_PLAN.md`.
