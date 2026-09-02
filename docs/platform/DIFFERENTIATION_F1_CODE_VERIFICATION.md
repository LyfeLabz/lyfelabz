# LyfeLabz Persistent Student Differentiation

## F1 Code Verification — P4

**Status:** Read-only verification artifact. No persistent differentiation
architecture, schema, callable, UI, or lesson content has been implemented in
this task. This document verifies factual repository assumptions underlying
the finalized F1 architecture; it does not evaluate or revise F1's decisions.

---

## 1. Verification Disposition

**F1 VERIFIED WITH LIMITATIONS.**

Every load-bearing F1 assumption that could be checked against production
code, Firestore Rules, or ratified contracts is either directly confirmed or
confirmed with a named, narrow limitation — except one: the "district-wide"
semantic scope in D1 rests on a policy statement
(`IDENTITY_AND_ONBOARDING_SPECIFICATION.md`) that has no corresponding
enforced mechanism in code today (every actual authorization check compares
`schoolId`, not `districtId`, because `AssignmentRecord`/`EnrollmentRecord`
carry no `districtId` field). This is a limitation on D1's scope claim, not a
contradiction of D1's *locus* choice (a `uid`-keyed record independent of
enrollment/class), which is fully supported. Separately, V11/V12 confirm the
lesson-artifact and historical-retention assumptions are technically
achievable but are **process-discipline requirements with zero current
enforcement** (no schema support for N artifacts per lesson, no build-time
revision parameterization, no deploy-time retention guarantee) — real gaps an
implementation spec must account for, not blocking contradictions.

---

## 2. Verification Matrix

| Area | Status | Key Finding | F1 Impact | Primary Evidence |
| --- | --- | --- | --- | --- |
| V1 Student Launch Surfaces | VERIFIED WITH LIMITATION | All three launch surfaces (deep link, student list, practice) resolve `lessonSlug` server-side, but the final artifact URL is built **client-side** via a static, slug-only, non-personalized lookup table consulted identically on every surface. | The server response (`lessonSlug`) is the correct injection point for `variantKey`/`presentationRevisionId`, but the client URL builder (`launch.ts`/`launchOverrides.ts`) would also need to consult server-resolved variant data instead of (or alongside) its static table — this is new client logic, not present today. | `app/src/assignments/studentList/launch.ts:36-63`, `app/src/assignments/deepLink/arrival.ts:108-145`, `app/src/assignments/studentList/launchOverrides.ts:23-79` |
| V2 Deep-Link Resolver | VERIFIED | Full server-side authorization chain (auth → active student → assignment exists → same-school → not draft/archived → active enrollment → canonical recipient) precedes any lesson identity being returned; `lessonSlug` is returned only after authorization; `FORBIDDEN_REQUEST_KEYS` refuses every client-asserted identity field. | An accommodation lookup inserted after existing authorization and before the response is constructed would not weaken any existing check — it is a pure additive read. | `platform/functions/src/lms/deep-link-resolve.ts:90-99`, `:230-300` (per P1 §6) |
| V3 Session Creation | VERIFIED | `assessmentSessionsBegin` independently re-derives every ownership/identity field from the assignment and the caller's verified claims; accepts only `{assignmentId}` from the client; uses `.create()` (must-not-exist precondition) to eliminate a read/write race, translating `ALREADY_EXISTS` into a stable conflict code. | Adding server-derived `variantKey`/`presentationRevisionId` to the `AssessmentSessionCreationWrite` shape at the same point ownership fields are derived is structurally consistent with the existing pattern; the idempotency check (`existingMatchesRequest`) would need to compare the new fields too. | `platform/functions/src/assessments/assessment-sessions-begin.ts:307-471` |
| V4 Autosave | VERIFIED | `AssessmentSessionAutosaveWrite` is a two-field type (`responses`, `lastActivityAt`) — structurally incapable of touching any other field, including ownership or frozen identifiers, regardless of request payload shape. | Frozen `variantKey`/`presentationRevisionId` fields would be outside autosave's mutation surface by construction, with no new guard needed. | `platform/functions/src/shared/types/assessment-session.ts:102-105`, `assessment-sessions-autosave.ts:390-395` |
| V5 Finalize → Attempt | VERIFIED | Finalize runs inside one Firestore transaction; reads the session, copies its frozen fields verbatim into `AssessmentAttemptCreationWrite` (explicit field-by-field assignment, not a spread), and deletes the session in the same transaction. `FORBIDDEN_REQUEST_KEYS` blocks every scoring/identity field from the client request. | Copying `session.variantKey`/`session.presentationRevisionId` into the attempt write (once those fields exist on the session type) is a one-line addition to an existing explicit field list, inside the existing transaction — no idempotency or immutability weakening. | `platform/functions/src/assessments/assessment-attempts-finalize.ts:826-847`, `shared/types/attempt.ts:66-84` |
| V6 Reassessment | VERIFIED | Each `assessmentSessionsBegin` call for a new attempt creates an independent session; `assessmentRevisionId` is always re-derived from the assignment's single frozen stamp (never from the prior session); attempts are structurally unlinked (no attempt references another). | Nothing in the reassessment path assumes session metadata is identical across attempts beyond the assignment-frozen triple; two attempts differing only in `variantKey`/`presentationRevisionId` while sharing `assessmentRevisionId` is representable without contradiction. | `assessment-sessions-begin.ts:371` (new `sessionId` per ordinal), `assessment-attempts-finalize.ts:803-813` (`attemptNumber` from live count) |
| V7 Reporting | VERIFIED | `assessmentAssignmentSummary` computes bounded numeric aggregates on read from `attempts`/`assessmentSessions`/`recipients`, filtered only by `assignmentId`; no field it reads or returns encodes lesson presentation. | A query that does not select on presentation fields is unaffected by their presence; optional new attempt fields would be silently ignored by every current aggregate query. | P1 §9 (`assessment-assignment-summary.ts`); not independently re-read line-by-line in P4, relied on as already-verified in P1 |
| V8 Google Classroom / LMS | VERIFIED | The only data Classroom receives is the opaque URL `https://lyfelabz.com/app/a/{assignmentId}`; no `lessonSlug`, revision, or other internal identifier crosses the publication boundary; one coursework item maps to one LyfeLabz assignment. | A future `variantKey`/`presentationRevisionId` never needs to cross the LMS boundary — resolution happens entirely after the student's authenticated arrival, downstream of the opaque link. | P1 §10 (`GOOGLE_CLASSROOM_DEEP_LINK_IMPLEMENTATION_CONTRACT.md` §8.1-8.2, `lms/deep-link-resolve.ts` header) |
| V9 District / School Boundary | VERIFIED WITH LIMITATION | The canonical contract ratifies District as the tenant security boundary ("Cross-tenant reads and writes are refused," `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md:75`), but `AssignmentRecord`/`EnrollmentRecord` carry no `districtId` field, `SchoolRecord.districtId` is typed **optional**, and every actual authorization check inspected (deep-link resolver, session-begin, autosave, finalize) enforces same-**school**, not same-district. No callable exists anywhere in `platform/functions/src/` that moves a student between schools while preserving `uid`; the "district-wide" claim is a stated policy with no exercised implementation. | D1's *locus* choice (uid-keyed, independent of enrollment/class) is unaffected — `uid` is confirmed stable and is the correct join key regardless of district semantics. D1's *scope* claim ("district-wide semantic scope") is not currently a mechanism the platform exercises; it degrades gracefully to "same school today," which is a narrower but non-contradictory special case. | `platform/functions/src/shared/types/school.ts:22-32`, `shared/auth/require-district-context.ts:70-189`, `lms/deep-link-resolve.ts:266`, `DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md:19-21,73,193,285-307` |
| V10 Accommodation Write Semantics | VERIFIED WITH LIMITATION | Compare-and-set exists today via `.create()` must-not-exist preconditions and `runFirestoreTransaction`; true append-only patterns exist (`auditEvents` via `.add()`-only with rules denying all client access; `recipients` subcollection with explicit create/update/delete denial). There is **no single reusable "teacher owns class AND student enrolled" combinator** — every callable assembles the check from field comparisons ad hoc. | The primitives needed (transactions, precondition writes, append-only-by-rule collections) all have working precedents to model a new collection after; a later implementation would still need to newly compose the teacher-class-student check rather than reuse an existing helper. | `assessment-sessions-begin.ts:414-441`, `assessment-attempts-finalize.ts:591`, `shared/audit/write-audit-event.ts:197`, `firestore.rules:227-230,575-577` |
| V11 Lesson Artifact Build Pipeline | VERIFIED WITH LIMITATION | Build pipeline is a real, working two-target (v1/v2) generator with atomic writes and a content hash used only for verification logging. As **currently written**, `buildBoth`/`paths.resolveOutput` hardcode exactly two literal targets (`"v1"`, `"v2"`); the config schema has no array/map for N variants; adding a third output is a restructuring, not a config change. | Producing `(lessonSlug, variantKey, presentationRevisionId)`-addressed artifacts is not supported by the pipeline today and would require changes to `config.cjs`, `index.cjs`, and `paths.cjs` — CONTRADICTS the assumption that this is a trivial extension, though it does not contradict the assumption that it is *technically possible*. | `app/scripts/lessonBuilder/index.cjs:43-49`, `paths.cjs:45-68`, `config.cjs:44-46` |
| V12 Historical Artifact Retention | VERIFIED WITH LIMITATION (operationally CONTRADICTED as a default) | `firebase.json` hosting config (`public: "."`, no multi-site/target config) means each deploy uploads the complete current repo tree as the new live release; the two generated lesson paths are overwritten in place by every rebuild (atomic same-path write). Nothing in current config preserves a prior revision's file at its own URL across a redeploy. | F1's "previously referenced builds must remain retrievable" assumption is **false under default current deployment mechanics** unless a future implementation commits each historical revision artifact to its own distinct, never-overwritten path inside the hosted tree and deploy discipline never omits it going forward — a new operational requirement, not something the current pipeline/config already guarantees. | `firebase.json:9-47`, `app/scripts/lessonBuilder/index.cjs:51-59` (atomic same-path write), absence of deploy automation in `.github/workflows/` |
| V13 Lesson Catalog | VERIFIED | No `lessons/{slug}` Firestore collection, constant, or type exists anywhere in `platform/functions/src/`. Lesson identity is purely the `lessonSlug` string field. | Confirms P1's finding; no catalog exists to extend or conflict with. | Repository-wide search, zero matches for a lessons collection constant |
| V14 Remaining P1 Uncertainties | VERIFIED | (A) Legacy submissions: `submissionsCreate`/`submissionsFinalize` remain exported but writes are gated inert-by-default behind `LYFELABZ_LEGACY_SUBMISSIONS_WRITES_ENABLED`; whether that env var is set in any deployed environment remains outside repository-visible state. (B) No session archival/expiry/recovery callable exists in `platform/functions/src/assessments/`; sessions are deleted only by the finalize transaction, so historical presentation identity must live on the **attempt**, never assumed recoverable from a session. (C) No `attemptRollups`/`assignmentRollups` collection or trigger exists; reporting is confirmed on-demand. | Confirms all three P1 findings remain current; strengthens the case that any presentation identifier needed for historical reproducibility MUST be copied onto the attempt at finalize (V5), since sessions do not survive. | `platform/functions/src/shared/legacy-submissions-flag.ts:26`, absence of sweep/purge/recover callables, zero rollup references |

---

## 3. Launch Path Trace

**Assignment deep link**
```
student clicks Classroom coursework link (opaque /app/a/{assignmentId})
  -> client: app/src/assignments/deepLink/arrival.ts renders loading state
  -> callable: lmsDeepLinkResolve({ assignmentId })
  -> server authorization: requireDistrictContext -> role=student -> assignment
     exists -> same-school -> not draft/archived -> active enrollment ->
     canonical recipient (isCanonicalRecipient)
  -> server returns { lessonSlug, internalTarget, attemptContext } (scalar
     lessonSlug only; no variant/revision concept exists to return)
  -> client: buildAssignmentLaunchUrl() / buildLessonBasePath() maps
     lessonSlug -> URL via the STATIC, slug-only LESSON_LAUNCH_OVERRIDES
     table (no per-student input)
  -> browser navigates to the resulting /app/lessons/lesson_<slug>.html
     or /lesson_<slug>.html
  -> [classroom mode only] lesson-embedded runtime (entry.ts) detects
     ?assignment=<id>, calls assessmentSessionsBegin -- this is a SECOND,
     independent server round-trip that re-derives activityId/assessmentId/
     assessmentRevisionId from the assignment, but does NOT influence which
     HTML artifact the browser already loaded
```
Server authority ends at the `lessonSlug` scalar returned by the resolver;
client routing (table lookup) begins immediately after and is where the
current architecture has no per-student dimension.

**Student assignment list**
```
student opens "My Assignments"
  -> callable: assignmentsListForStudent (collection-group query over
     recipients.studentId, re-verified against live parent assignment)
  -> server returns items: { assignmentId, lessonSlug, title, status,
     publishedAt } (P1 §6; AssignmentsListForStudentItem)
  -> client: same buildAssignmentLaunchUrl() / static override table as
     the deep-link path (launch.ts is the single shared module)
  -> browser navigates; [classroom mode] same assessmentSessionsBegin
     second round-trip as above
```
Identical seam and identical limitation as the deep-link path: server
authority ends at `lessonSlug`; the static client-side table is the sole
current artifact-selection mechanism, shared verbatim across both surfaces.

**Practice mode**
```
student arrives via deep link or list with an assignment whose mode is
"practice"
  -> resolver/list returns internalTarget = "lessonPractice" (deep link) or
     the item is launched the same way (list; mode routes client-side by
     omitting ?assignment= handling in the runtime for non-classroom)
  -> client: buildLessonBasePath(lessonSlug) -- SAME static table, no
     ?assignment= query appended in the practice branch of arrival.ts
  -> browser navigates directly to the lesson artifact
  -> NO further server call occurs: assessmentSessionsBegin explicitly
     refuses (assignment-mode-invalid) for a non-"classroom" assignment,
     so practice mode has no second server round-trip at all
```
Practice mode's *only* server-authoritative step is the initial deep-link
resolve or list-for-student call; there is no session-begin seam to extend
later, confirming the F1 assumption that practice mode "still needs
server-authoritative presentation resolution if current practice launch
architecture permits it" -- it does permit it, but only at the single
existing resolution call, not at a second stage.

---

## 4. Session / Attempt Trace

```
session begin (assessmentSessionsBegin)
  -> derives {activityId, assessmentId, assessmentRevisionId} from the
     assignment's frozen assessmentRevisionId (never from the client)
  -> derives {classId, teacherId, schoolId} from the assignment;
     districtId from the caller's verified claim
  -> writes AssessmentSessionCreationWrite via .create() (must-not-exist
     precondition; concurrent begins collapse to one winner + a stable
     "conflict" refusal on the loser)
  -> FROZEN at this point: studentId, assignmentId, classId, teacherId,
     schoolId, districtId, activityId, assessmentId, assessmentRevisionId,
     sessionOrdinal, status, startedAt

autosave mutation surface (assessmentSessionsAutosave)
  -> AssessmentSessionAutosaveWrite = { responses, lastActivityAt } ONLY
  -> every other field, including the frozen set above, is structurally
     unreachable from this callable regardless of request payload

finalize (assessmentAttemptsFinalize)
  -> single Firestore transaction: reads session, explicitly copies each
     frozen session field onto AssessmentAttemptCreationWrite (studentId,
     assignmentId, classId, teacherId, schoolId, districtId, activityId,
     assessmentId, assessmentRevisionId), computes score/itemResults from
     the answer key, writes attempts/{attemptId}, deletes the session
  -> idempotency: a repeat call with the same idempotencyKey returns the
     existing attempt unchanged, including after the session has already
     been deleted (assignmentId recovered by parsing the session id)

immutable attempt
  -> firestore.rules:507-512 denies all client create/update/delete;
     "no callable ever updates or deletes a written document" (attempt.ts
     header)

reassessment / new session
  -> a new assessmentSessionsBegin call for the same (studentId,
     assignmentId) after the prior session was deleted by finalize
     produces a new session; assessmentRevisionId is re-derived from the
     SAME assignment-frozen stamp every time (never drifts across
     attempts); the resulting new attempt is fully independent (no
     attempt references another)
```

**Existing seams F1 expects to extend later** (described, not implemented):
the explicit ownership-field list at session creation (§ V3), the
structurally narrow autosave write type (§ V4), and the explicit
field-by-field session-to-attempt copy at finalize (§ V5) are three separate,
independently narrow write surfaces — each is a plausible, minimally
invasive extension point for two new frozen fields, precisely because each
is already a hand-enumerated field list rather than a generic object spread.

---

## 5. Security Boundary Findings

- **Current boundary:** District is the ratified tenant boundary in the
  canonical contract (`DISTRICT_SECURITY_BOUNDARY_IMPLEMENTATION_CONTRACT.md:19-21,75`);
  school is a narrowing sub-scope, not an alternate boundary
  (`IDENTITY_AND_ONBOARDING_SPECIFICATION.md:133`).
- **Identity source:** `requireDistrictContext()` resolves the caller's
  `districtId` server-side from `schools/{schoolId}.districtId`, cross-checked
  against signed custom claims (`shared/auth/require-district-context.ts:70-189`).
- **Teacher/student relationship checks:** No single reusable combinator;
  every callable composes teacher-ownership and student-enrollment checks
  from direct field comparisons against the referenced assignment/class/
  enrollment documents at call time.
- **Direct-client Firestore access relevant to F1:** `assessmentSessions`
  permits only `get` by the owning student, no client write of any kind
  (`firestore.rules:475-479`); `attempts` permits only `get` by the owning
  student or teacher, all writes denied (`firestore.rules:507-512`). A future
  accommodation record following the same pattern (server-mediated
  read/write, no direct client write) has direct precedent.
- **Conflict with current boundary:** None for D1's *locus* (uid-keyed,
  enrollment-independent — `uid` is confirmed stable within the enforced
  scope). A limitation exists for D1's *scope* claim: `AssignmentRecord`/
  `EnrollmentRecord` carry no `districtId`, `SchoolRecord.districtId` is
  optional/legacy-compatible rather than guaranteed-present, and no callable
  moves a student between schools while preserving `uid` — so "district-wide"
  is a stated policy without an exercised same-district-different-school code
  path today. This narrows, but does not invalidate, treating the student's
  `uid` as the stable join key.

---

## 6. Lesson Artifact Findings

- **Current canonical artifact model:** one `lesson-sources/lesson_<slug>.html`
  canonical source produces exactly two generated outputs via
  `app/scripts/lessonBuilder/`: `/lesson_<slug>.html` (v1, repo root, required)
  and `/app/lessons/lesson_<slug>.html` (v2, required), both atomically
  overwritten in place on every build.
- **Slug-to-artifact mapping:** 1:1 today, but through one level of
  indirection — each lesson's config (`lessons/<slug>.cjs`) declares its own
  `outputs.v1`/`outputs.v2` filename strings; every existing config happens to
  follow the `lesson_<slug>.html` pattern, but nothing enforces that pattern
  structurally.
- **Build/generation process:** marker-scanned source transform
  (`markerScanner.cjs` + `transformer.cjs`), config-schema-validated, written
  atomically, hashed (SHA-256) only for build/verify integrity logging.
- **Multiple/revision-specific artifacts:** NOT currently possible without
  restructuring — `buildBoth`/`paths.resolveOutput` hardcode exactly the two
  literal targets `"v1"`/`"v2"`; the config schema has no N-variant shape.
- **Content-derived presentation IDs:** technically computable (a working
  `sha256()` utility already exists) but not currently wired to filenames,
  routing, or storage — it is a verification checksum only.
- **Routing constraint:** `launchOverrides.ts` is a static
  `Record<slug, {path}>` with no variant/revision parameter anywhere in its
  shape; v1 outputs are additionally constrained to the repo root exactly
  (no subdirectory), while v2 outputs may live anywhere under `app/lessons/`.

---

## 7. Historical Retention Findings

- **Current hosting/deploy behavior:** `firebase.json` hosting config serves
  the entire repo root (`public: "."`, minus an ignore list) with no
  multi-site/multi-target hosting configuration; deploy is a manual,
  documentation-only `firebase deploy --only hosting` step with no CI
  automation.
- **Do old revision-specific paths survive a normal deploy:** only if they
  are committed to their own distinct path inside the hosted tree and that
  path is never overwritten by a later build. The two current generated
  lesson paths do NOT survive in this sense — each rebuild atomically
  overwrites the same path.
- **Does F1's retention assumption hold today:** NOT by default. Firebase
  Hosting's standard model (unmodified by anything in this repo's config)
  makes each deploy's public-directory contents the complete new live file
  set; a file omitted from a later deploy 404s even though Firebase retains
  release history for rollback (whole-release rollback, not per-URL
  addressability of an old file).
- **Limitation:** for F1's guarantee to hold, a future implementation would
  need to (a) give every historical `presentationRevisionId` its own
  never-reused, never-overwritten path in the hosted tree, and (b) ensure
  deploy practice never drops previously-shipped revision files from that
  tree. Neither is enforced by `lessons:verify`, the build pipeline, or
  `firebase.json` today — this is a new operational discipline requirement,
  not a capability already provided.

---

## 8. F1 Assumptions Verified

- D1 locus: a dedicated record keyed to the student's canonical `uid`,
  separate from `users/{uid}`, enrollments, assignments, and recipients, with
  server-mediated (not direct client) read/write, has direct structural
  precedent (`assessmentSessions`/`attempts` rules: `get`-only, no client
  write) and no lifecycle incompatibility (`uid` is stable across status
  transitions and school changes within the currently-enforced scope).
- D2: `lessonSlug` remains the sole, untouched canonical assignment identity;
  no current invariant requires assignments to carry variant/revision fields.
  `assessmentRevisionId` continues to be frozen once per assignment and is
  unaffected by presentation differentiation, since sessions/attempts always
  re-derive it from the same assignment stamp regardless of attempt count.
- D3: server-authoritative resolution is structurally consistent with the
  existing deep-link resolver (authorization completes before any lesson
  identity is returned) and with session-begin (every ownership field is
  server-derived, never client-supplied); `FORBIDDEN_REQUEST_KEYS` patterns
  already exist at both the autosave and finalize boundaries to prevent
  client assertion of server-owned fields, giving direct precedent for
  refusing a client-asserted `variantKey`/`presentationRevisionId`.
- Frozen-field propagation (session -> attempt) is a real, working,
  explicit field-by-field pattern today, not a generic copy — a two-field
  extension (variantKey, presentationRevisionId) fits the existing shape of
  that pattern at both write points (session creation, finalize).
- Practice mode has exactly one server-authoritative resolution point
  (deep-link resolve or list-for-student), confirmed to be the only seam
  available for it, since it structurally never reaches session-begin.
- No rollup collection, lesson catalog collection, or session-archival
  callable exists to conflict with or require updating.

---

## 9. F1 Assumptions Requiring Correction or Qualification

**F1 ASSUMPTION:** "District-wide in semantic scope" is a coherent, already-
supported scope for the accommodation record (D1).
**STATUS:** VERIFIED WITH LIMITATION.
**CURRENT FACT:** No stored `districtId` exists on `assignments` or
`enrollments`; `SchoolRecord.districtId` is optional/legacy-compat rather
than guaranteed; every actual authorization check enforces same-*school*
equality as a proxy for same-district; no callable exists that moves a
student between schools while preserving `uid`, so the same-district-
different-school case this scope claim depends on is never exercised in
current code.
**WHY IT MATTERS:** The record's *locus* (keyed to `uid`, independent of
enrollment) is unaffected and remains sound. But "district-wide" as a
functional scope claim (the record automatically follows a student who
changes schools within a district) describes a code path that does not
exist today; an implementation spec should treat this as "works today only
within the same school, and the district-wide claim is aspirational until a
same-district cross-school transfer mechanism exists," not as an
already-proven capability.

**F1 ASSUMPTION:** The lesson build pipeline can, largely as-is, emit
multiple `(lessonSlug, variantKey, presentationRevisionId)`-addressed
artifacts per canonical lesson (D2).
**STATUS:** VERIFIED WITH LIMITATION (structurally CONTRADICTED as
currently written).
**CURRENT FACT:** `buildBoth`/`paths.resolveOutput` hardcode exactly two
literal output targets (`"v1"`, `"v2"`); the lesson config schema has no
array/map shape for N variants. Emitting a third (or Nth) artifact requires
restructuring the config schema, the build-target resolver, and the build
orchestration function — not a per-lesson config change.
**WHY IT MATTERS:** This is a real, nontrivial build-tooling extension that
a later implementation specification must scope explicitly, rather than
treating differentiated-artifact generation as "the pipeline already
supports this, just add a config entry."

**F1 ASSUMPTION:** Previously referenced differentiated presentation builds
remain retrievable by historical attempts under current deployment
mechanics (V12).
**STATUS:** CONTRADICTED as a default; achievable only with new operational
discipline.
**CURRENT FACT:** Firebase Hosting here deploys the complete repository
public tree on every deploy with no multi-site/versioned-subdirectory
mechanism; the two current lesson artifact paths are atomically overwritten
in place on every rebuild. Nothing in `firebase.json`, the build pipeline,
or CI enforces retention of a superseded artifact at its own stable path.
**WHY IT MATTERS:** F1's historical-reproducibility guarantee for
differentiated presentations is not something the platform already provides
"for free" — it requires a positive, enforced convention (distinct
never-overwritten per-revision paths, and deploy discipline that never drops
them) that does not exist in any form today and is not verified by
`lessons:verify`.

---

## 10. Remaining Unresolved Facts

**QUESTION:** Is `LYFELABZ_LEGACY_SUBMISSIONS_WRITES_ENABLED` currently set
to `true` in any deployed environment, which would mean the legacy
`submissions` write path (bypassing the session/attempt pipeline F1 assumes
is the sole path) is live somewhere today?
**WHY UNRESOLVED:** This is deployment/operational environment-variable
state, not visible from the repository source tree.
**WHAT EVIDENCE WOULD RESOLVE IT:** Inspection of the actual Cloud Functions
environment configuration for each deployed environment (not available to a
repository-scoped, read-only code investigation).
**DOES IT BLOCK IMPLEMENTATION SPECIFICATION:** NO — the flag defaults
inert, and D3's resolution model does not depend on the legacy path being
absent, only on differentiated resolution not needing to participate in it
if it is ever briefly re-enabled for a migration.

**QUESTION:** Can a student actually retain the same canonical `uid` across a
same-district, different-school move, as `IDENTITY_AND_ONBOARDING_SPECIFICATION.md:327`
asserts?
**WHY UNRESOLVED:** The policy is stated in the canonical identity
specification, but no callable implementing a post-activation school
transfer was found anywhere in `platform/functions/src/`; the claim has
never been exercised in code that P4's search boundary could locate.
**WHAT EVIDENCE WOULD RESOLVE IT:** Either locating a transfer-handling code
path missed by this search, or confirmation from the identity/onboarding
owners that no such transfer has ever been implemented and the statement is
forward-looking policy only.
**DOES IT BLOCK IMPLEMENTATION SPECIFICATION:** NO for D1's locus (uid
stability is independently well-established for the currently-enforced
same-school case). YES for D1's specific "district-wide" scope claim if an
implementation spec wants to rely on that claim as an already-working
behavior rather than an aspiration.

---

## 11. Implementation-Readiness Disposition

**READY AFTER NON-ARCHITECTURAL FACTUAL CORRECTIONS.**

None of the findings above require reopening F1's root decisions (D1/D2/D3)
or its adjudicated write semantics — the persistence locus, identity model,
and server-authoritative resolution point are all structurally supported by
existing, working patterns in the current codebase. What an implementation
specification must incorporate as factual corrections rather than
architecture changes: (1) treat "district-wide scope" as functionally
equivalent to "same-school today" until a same-district cross-school
transfer mechanism is verified or built, (2) scope the lesson-build-pipeline
work as a real multi-target restructuring of `config.cjs`/`index.cjs`/
`paths.cjs`, not a config-only addition, and (3) treat historical artifact
retention as a new operational contract requiring distinct never-overwritten
per-revision paths and deploy-discipline enforcement, not an existing
guarantee of current hosting configuration.
