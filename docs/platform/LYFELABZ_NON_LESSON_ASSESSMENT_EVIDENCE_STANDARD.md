# LyfeLabz Non-Lesson Assessment and Evidence Standard

**Status:** Approved product standard (documentation only). NOT implemented.
**Established:** October 8, 2026, against repository HEAD `e20df02`.
**Applies to:** every assignable non-lesson investigation, simulation,
extension, and engineering challenge, existing and future.
**Companion:** `LYFELABZ_NON_LESSON_RESOURCE_INVENTORY.md` (current behavior
and per-resource requirements).

This document defines how a non-lesson resource becomes an authenticated
LyfeLabz assignment: what work is required, what evidence is captured, how the
final five-question quiz is unlocked and scored, and what teachers see. It
states product decisions and a conceptual architecture. It adds no code,
Firestore collection, schema field, Rules change, index, or deployment.

Nothing here is current behavior unless it is labelled **Current**. Today only
`lesson` assignments are assignable (`isResourceTypeAssignable` in
`platform/functions/src/shared/activity-identifiers.ts`), and no non-lesson
resource produces an authenticated assessment attempt.

---

## 1. Purpose and scope

### 1.1 Purpose

- Give every assignable non-lesson resource one consistent completion and
  scoring contract that fits the existing LyfeLabz assessment model.
- Capture the scientific work students produce, in a form teachers can read,
  without turning that work into a platform grade.
- Give authors a checklist so future resources are built to the standard from
  the start.

### 1.2 In scope

| Resource type | Activity identifier (Phase 1 grammar) | Example |
| --- | --- | --- |
| Investigation | `investigation-<stem>` | `investigation_amplitude-challenge.html` -> `investigation-amplitude-challenge` |
| Simulation | `simulation-<stem>` | `simulation_gravity-wells.html` -> `simulation-gravity-wells` |
| Extension | `extension-<stem>` | `extension_fossil-hunt.html` -> `extension-fossil-hunt` |
| Challenge | `challenge-<stem>` | `challenge_welcome-to-floatia.html` -> `challenge-welcome-to-floatia` |

The grammar is owned by `app/scripts/activityIdentifiers.cjs` and
`platform/functions/src/shared/activity-identifiers.ts` (Resource Expansion
Phase 1, commit `e20df02`). The assignment field `lessonSlug` carries the
identifier; `resourceType` names the type (data model §3.6).

### 1.3 Out of scope

- Lessons. Lesson quizzes stay at 10 questions under `CLAUDE.md` QUIZ RULES.
- Games, body-system maps, disease explorations, the body-system hub pages, and
  tools. None is a formal assignable type under the Phase 1 grammar. Whether
  the eight required maps should ever become assignable is an open question
  (§16).
- Google Classroom integration design. Publication and best-score passback are
  reused as they are.
- Curriculum status. Whether a resource is required baseline or an extension is
  decided by the owner-ratified HQIM-4A record
  (`docs/hqim/hqim-4a-human-decision-reconciliation.md`), not by this standard
  or by a filename prefix.

### 1.4 Resource type versus curriculum status

These are different properties and must not be conflated.

- **Resource type** is the platform classification (filename prefix, registry
  `type`, activity identifier, evidence profile).
- **Curriculum status** (required baseline or extension) is an owner decision
  recorded in `docs/hqim/`.

Example: Protein Pathway's resource type is **investigation**
(`investigation_protein-pathway.html`, `investigation-protein-pathway`). HQIM-4A
gives it an extension (optional) curriculum role. Both stay true, and this
standard keeps it classified as an investigation.

---

## 2. Approved product decisions

These decisions are authoritative. Every later section applies them.

| ID | Decision |
| --- | --- |
| D-A | Every assignable non-lesson resource ends with **exactly five** objective, automatically scored understanding-check questions. This applies whatever the resource has today: no quiz, fewer or more questions, written reflection only, or another format. |
| D-B | Students complete all **required** instructional work and submit all **required** evidence before the quiz unlocks. The quiz is the final completion action and cannot be submitted on its own. The server enforces this; hiding a button is not enforcement. |
| D-C | Each resource explicitly separates **required instructional work**, **required evidence**, and **optional enrichment**. Optional enrichment never blocks quiz access or completion. |
| D-D | LyfeLabz supports structured capture of scientific evidence that fits the resource. Graph data is captured in structured form where possible. Evidence is stored independently of quiz attempts. |
| D-E | Evidence is **informational, not graded**. There is no teacher approval, review gate, teacher-scored CER or graph grade, verification requirement, evidence-derived numerical grade, or pending-review status. Teachers get read-only access. |
| D-F | The five-question quiz alone sets the numerical score. Unlimited retakes, best score retained, teacher-selected Classroom point value, existing graded/ungraded options, and best-score passback are preserved. A retake never requires redoing instructional work and never erases evidence. |
| D-G | Physical work (for example Build-a-Boat/Floatia and Ball Run) is represented by digital evidence fields that must be completed before the quiz. LyfeLabz never claims that digital evidence proves a prototype was built or tested, and no teacher verification is required. |

---

## 3. Universal five-question assessment contract

### 3.1 Item requirements

- **Count:** exactly 5 items per assessment revision for a non-lesson
  activity.
- **Type:** objective and automatically scored, using the existing item model
  in `ASSESSMENT_SCORING_CONTRACT.md` (single-select multiple choice, 1 point
  each, no partial credit).
- **Alignment:** the 5 items assess the resource's essential scientific
  learning objectives as students actually experience them in that activity.
  They are not generic unit review.
- **Quality:** follow `CLAUDE.md` QUIZ RULES where they are count-independent:
  DOK 1 and DOK 2 mix, an explanation for every item, plausible distractors, no
  longest-answer bias, no "all/none of the above" unless necessary. With 5
  items and 4 options, positions cannot be perfectly even. The existing
  answer-position verifier (`app/scripts/lessonBuilder/assessmentQuality.cjs`,
  `evaluateDistribution`) is item-count generic: every position must be correct
  at least once, no position more than `ceil(5/4) + 1 = 3` times, a spread of 1
  or less is the target, and no more than 2 consecutive items share a position.
  A distribution such as 2-1-1-1 meets it.
- **Accuracy and grade fit:** scientifically accurate, appropriate for the
  resource's grade, and consistent with the Massachusetts 2016 STE Framework.

### 3.2 Migration rules for existing quizzes

- Do **not** truncate an existing 10-question quiz mechanically to its first
  five items.
- Do **not** invent questions during documentation work. Authoring the five
  items is separate, reviewable content work for each resource.
- Existing items may be reused when they assess an essential objective and
  meet §3.1; they are re-authored into a canonical assessment revision payload
  (`platform/functions/src/scripts/assessments/<activityId>.r1.json`
  convention).
- A resource whose current check is written-only (for example a CER or
  reflection) keeps that writing as **evidence** (§6), and the five objective
  items are added as the final check.
- Ungraded in-activity checks (checkpoints, mission checks, Quick Checks) may
  stay as formative interactions. They are not the graded quiz, never feed the
  score, and should not duplicate the five graded items word for word.

### 3.3 Server authority (reuses the certified pipeline)

The five items are delivered and scored by the existing server-authoritative
pipeline, exactly as for v2 lessons:

- Assessment identity `assessment_<activityId>`; revision
  `assessment_<activityId>__r<N>`; paired `assessmentRevisions` (no answers)
  and `assessmentAnswerKeys` (answers; readable by no client role).
- `assignmentsPublish` freezes `assessmentRevisionId` at first publication
  (PDR-031); sessions, autosave, finalize, and attempts all bind to it.
- `assessmentSessionsBegin` creates sessions; `assessmentAttemptsFinalize`
  scores against the answer key and is the only writer of attempts.
- Correct answers and explanations reach the student only in the finalize
  result (`itemResults`), after submission.

**Current:** the server pipeline has no fixed item count. Deployment, finalize,
and the presentation identity reject only an empty item list. Grade passback
scales the best **percentage** to the teacher's `maxPoints`
(`computeGradePassbackEarnedPoints`), so a 5-item quiz needs no passback change.
Some client display strings and comments were written with 10 items in mind
(for example roster labels like "4/10"); they need a 5-item display review
before a pilot (§15).

### 3.4 Answer-data rule for new delivery

Graded non-lesson delivery must **not** embed the correct answers or
explanations for the five graded items in the delivered page. Lesson pages
still embed answer data today (open item D7,
`SECURITY_BACKLOG_LESSON_PAGE_ANSWER_DATA.md`). Non-lesson delivery must not
copy that condition. Item content comes from the frozen revision, and feedback
comes from the finalize result.

---

## 4. Required versus optional work

### 4.1 Definitions

| Category | Meaning | Gates the quiz? |
| --- | --- | --- |
| **Required instructional work** | Activities and interactions essential to the resource's learning objectives (for example completing the core simulation challenges or running the investigation trials). | Yes, through a declared required stage (§5). |
| **Required evidence** | Student-produced information that must be submitted before the quiz unlocks (for example a prediction, a data table, a CER). | Yes. |
| **Optional enrichment** | Exploration, extra information, extra practice, extension prompts, and any interaction that deepens learning but is not essential. | **Never.** |

### 4.2 Minimum meaningful completion

Each resource declares its **minimum meaningful completion requirements**: the
smallest set of required stages and evidence that shows the student did the
core scientific work. Rules:

- Require work because the learning objective needs it, not because it exists
  on the page.
- No arbitrary click counts, dwell times, scroll depth, or "open every card"
  gates.
- No input requirements unrelated to the learning objective.
- Checks verify that required work was **performed or submitted**. They never
  pretend to judge the quality of scientific reasoning automatically.
- Text requirements are presence checks with a low, documented minimum (for
  example "not blank" or a short minimum length). They are never quality
  scores.
- When in doubt, classify as optional. A teacher can always assign more in
  class; a platform gate cannot be bypassed by a student who legitimately
  cannot complete it.

### 4.3 Declared, not inferred

The required/optional classification is declared in the resource's
requirements definition (§11.4), reviewed with its content, and frozen with the
assignment. The platform never infers "required" from what a page happens to
render.

---

## 5. Quiz eligibility and completion rules

### 5.1 Student sequence

1. Open the assigned resource (authenticated launch).
2. Complete the required activities and interactions.
3. Complete and submit the required scientific evidence.
4. The final five-question understanding check unlocks.
5. Submit the quiz.
6. The score is recorded and the assignment is complete.

### 5.2 Eligibility

- A student is **quiz-eligible** for an assignment when the server holds a
  record showing that every required stage is satisfied and every required
  evidence item has been submitted and passed structural validation (§11.6).
- Eligibility is evaluated by the server against the assignment's frozen
  requirements definition. A client-reported "completed" flag, button state,
  or local storage value is never sufficient.
- Eligibility is **sticky**: once established for an assignment, later evidence
  edits (if allowed, §16) never revoke it. This guarantees retakes never require
  repeating work.

### 5.3 Enforcement points

| Point | Rule |
| --- | --- |
| Quiz UI | Hidden or locked until eligible (convenience only, not enforcement). |
| `assessmentSessionsBegin` (non-lesson assignment) | Refuses to create a session unless the student is eligible for that assignment. |
| `assessmentAttemptsFinalize` (non-lesson assignment) | Re-checks eligibility inside its transaction and fails closed if it cannot be established. |
| Lesson assignments | Unchanged. No eligibility gate applies. |

### 5.4 Completion

- **Initial completion** is the first finalized attempt on an eligible
  assignment. This is the existing "submit = completion" rule
  (`CURRENT_PLATFORM_STATE.md` §9).
- Submitting evidence without submitting the quiz is **not** completion. The
  student is in progress.
- Completion never depends on teacher action.

### 5.5 States (conceptual)

| State | Meaning |
| --- | --- |
| Not started | No evidence record and no session. |
| In progress: working | Some required work or evidence is outstanding. |
| In progress: quiz unlocked | All requirements satisfied; no finalized attempt yet. |
| Complete | At least one finalized attempt. Best score shown. |

There is deliberately **no** "pending teacher review", "awaiting approval", or
"evidence rejected" state.

---

## 6. Evidence-capture principles

1. **Fit the purpose.** Capture the evidence the resource's science calls for.
   Do not require every evidence type everywhere.
2. **Retain instructional evidence, not telemetry**
   (`docs/hqim/curriculum-delivery-principles.md`). Store predictions, data,
   explanations, decisions, and revisions. Do not store hovers, slider
   positions, animation frames, or navigation history.
3. **Structured over images.** Data tables, measurements, and graphs are
   stored as structured values (rows, columns, units, plotted points, axis
   labels) so they can be re-rendered and read. An image is acceptable only
   where the evidence is inherently visual (a sketch) and even then is optional
   unless the resource declares it required.
4. **Failed and unexpected results are evidence.** Trial tables keep failed
   and stalled trials; a design record keeps rejected iterations.
5. **Independent of quiz attempts.** Resource evidence is keyed to the
   (assignment, student) pair, not to an attempt. Retakes never touch it.
6. **Attributable.** Evidence records the authenticated student. Team data
   entered by one student is labelled as that student's entry; it does not
   prove individual participation (`docs/hqim/engineering-challenge-principles.md`).
7. **Prompt context preserved.** The prompt each response answered is
   identifiable through the frozen requirements definition, so a teacher reads
   a response with its question.
8. **Honest about limits.** Captured evidence shows that a student submitted
   it, not that the underlying activity happened as described (§10).

### 6.1 Evidence kinds

| Kind | Typical structured form |
| --- | --- |
| Prediction / hypothesis | Short text, or a selected option plus a reason |
| Observation | Short text, optionally tied to a stage or trial |
| Data table | Typed columns with units; rows; blank cells allowed only where declared |
| Measurement | Number plus unit, or a row in a data table |
| Graph | Series of (x, y) points, axis variables and units, optional best-fit or trend statement |
| CER | Claim, Evidence, Reasoning as three text fields |
| Show Your Thinking | One text explanation tied to a declared prompt |
| Model / diagram | Structured selections (for example labelled parts or connections), or an optional image |
| Experimental result | Outcome value(s) tied to a trial or condition |
| Design decision | Selected option(s) plus a rationale |
| Engineering test result | Trial rows: configuration, outcome, pass/fail against criteria, notes |
| Reflection | Text |
| Revision / improvement | What changed, why, and the resulting outcome |

### 6.2 Relationship to the existing Show Your Thinking field

**Current:** the post-quiz Show Your Thinking `writtenResponse` is carried by
`assessmentSessionsAutosave`, frozen onto the **attempt** at finalize, and
projected to the owning teacher by `assessmentAttemptGetForTeacher`
(`ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §37). It belongs to an attempt, so a
retake produces a new attempt with its own (possibly empty) response.

For non-lesson resources:

- Required evidence (including any required Show Your Thinking explanation that
  belongs to the activity) is stored as **resource evidence**, independent of
  attempts, so retakes cannot erase it.
- The attempt-level `writtenResponse` remains available, unchanged, for an
  optional post-quiz reflection where a resource wants one. It is never
  required evidence, because it would not survive a retake on the new attempt.

---

## 7. Evidence profiles by resource type

Profiles describe the typical shape of each type. They are **not** identical
worksheets. A component that would be artificial or irrelevant for a specific
resource is omitted, and the omission is recorded in that resource's
requirements definition with a one-line reason (an **instructional
exception**).

Every profile ends with the five-question final quiz.

### 7.1 Simulations

| Component | Typical status |
| --- | --- |
| Prediction or initial reasoning | Required when the simulation tests an idea students can predict; otherwise omitted |
| Interactive exploration | Optional enrichment |
| Required simulation challenges (missions) | Required stage(s) |
| Observations or data | Required when the challenges produce comparable outcomes |
| Graph | Required only when graphing is a learning objective |
| Scientific explanation | Required (short Show Your Thinking or CER) |
| Five-question final quiz | Required, final action |

### 7.2 Investigations

| Component | Typical status |
| --- | --- |
| Scientific question | Presented; acknowledging it is not evidence |
| Hypothesis or prediction | Required when appropriate |
| Procedure or investigation | Required stage(s) |
| Observations and measurements | Required |
| Data organization | Required (structured table) |
| Graphing | Required when appropriate, as structured data |
| CER or evidence-based explanation | Required |
| Five-question final quiz | Required, final action |

### 7.3 Extensions

| Component | Typical status |
| --- | --- |
| Application of prior learning | Framing; not separately captured |
| Scenario or problem analysis | Required stage when the extension is built around cases |
| Interactive model or task | Required stage(s) for the core task; extra cases optional |
| Show Your Thinking response | Required |
| Evidence-based explanation | Required when the extension asks for a conclusion from evidence |
| Five-question final quiz | Required, final action |

### 7.4 Challenges (engineering)

| Component | Typical status |
| --- | --- |
| Problem definition | Required (short statement or selection) |
| Criteria and constraints | Required (identified or sorted) |
| Design planning | Required (plan text, choices, optional sketch image) |
| Testing or performance evidence | Required (structured trial table, failed trials kept) |
| Analysis of results | Required |
| Revision or improvement | Required where the challenge includes an iteration |
| Design justification | Required |
| Five-question final quiz | Required, final action |

Physical construction remains physical (§10). Multi-session challenges declare
each session as a stage so students can work across days.

---

## 8. Grading and retake behavior

| Rule | Behavior |
| --- | --- |
| Score source | The five-question quiz only. Evidence never contributes points. |
| Scoring | Server-authoritative, 1 point per item, percentage = score / 5. |
| Retakes | Unlimited. "Improve My Score" behavior as for lessons. |
| Best score | Retained using the existing best-attempt selection (`selectHighestCompletedAttempt`). |
| Retake prerequisites | None beyond the sticky eligibility already established. No instructional work is repeated. |
| Evidence on retake | Untouched. Retakes neither read nor write resource evidence. |
| Classroom grading | Existing `classroomGrading` (`graded` with teacher `maxPoints`, or `ungraded`) unchanged. |
| Grade passback | Existing best-score passback (`lmsGradePassbacks`), percentage scaled to `maxPoints`. |
| Initial completion vs retake | The first finalized attempt completes the assignment. Later attempts can raise the best score and never change completion. |

Neither the Classroom integration nor the grading model is redesigned by this
standard.

---

## 9. Teacher Workspace evidence visibility

- Teachers see a student's submitted evidence **read-only**, in the student's
  assignment context (Teacher Workspace Student Detail is the natural home,
  where attempt-level Show Your Thinking is already read lazily per attempt).
- Each response is shown with the prompt or column labels it answered, taken
  from the frozen requirements definition.
- Structured data renders as a table; structured graph data renders as a
  simple plot plus its underlying table.
- Shown with evidence: submission time and which required stages were
  satisfied. Not shown: telemetry, scores derived from evidence, or approval
  controls.
- There are **no** grading controls, rubric fields, approve/reject actions, or
  review queues. Teachers use the evidence for conversations, feedback, and
  classroom evaluation outside the platform.
- Authorization follows the existing owning-teacher and district boundary.
  Evidence is never visible to other students and never placed in a URL,
  callable log, or audit payload (student text stays out of logs, as in the
  lab report callables).
- Aggregate assignment views may count "quiz unlocked" separately from "not
  started" (open question §16, Q6).

---

## 10. Physical activity limitations

Some resources require work outside the browser: Build-a-Boat (represented by
`challenge_welcome-to-floatia.html`), Ball Run (`challenge_ball-run_day1-5`),
and future physical investigations (PS1-6, PS1-8).

- The platform captures **evidence about** the physical work: designs, test
  data, results, explanations, and revisions.
- Required evidence fields must be completed before the quiz unlocks, as for
  any resource.
- **Limitation (must be stated in teacher-facing material):** digital evidence
  shows what a student entered. It does not prove that a prototype was built,
  that tests were run, or that the recorded values were measured. LyfeLabz
  makes no such claim.
- No teacher verification, sign-off, or approval is required to unlock the
  quiz or finalize the assignment.
- Physical artifacts, paper records, and teacher observation remain legitimate
  evidence that lives outside the platform
  (`docs/hqim/curriculum-delivery-principles.md`). The platform does not try
  to duplicate them fully.
- Team construction and shared measurements may be entered by each team
  member. A shared value does not establish individual participation.

---

## 11. Conceptual technical architecture

This section is a **conceptual design**. It names the existing records and
callables it would reuse, and the gaps. It does not define a schema. Any new
record family, field, callable, or Rules block listed as a gap requires a
focused design and security review before implementation (§16).

### 11.1 Concept map

| Concept | Conceptual meaning | Existing implementation to reuse | Gap |
| --- | --- | --- | --- |
| Assignment identity | One assignment per class per activity | `assignments/{assignmentId}` with `lessonSlug` = activity identifier and `resourceType` (Phase 1) | `isResourceTypeAssignable` admits only `lesson` |
| Resource type | investigation, simulation, extension, challenge | `resourceType` field, reserved prefixes, parity test | None for identity |
| Immutable presentation revision | The exact delivered page a student used | Lesson revision renditions and the build-generated revision path table (`app/src/assignments/studentList/revisionPaths.ts`) | No non-lesson rendition; the path table and its Hosting copier accept only `lesson_<slug>` renditions; non-lesson pages are not in the lesson build (the app host serves byte copies of the public pages) |
| Assessment revision | The frozen 5-item quiz | `assessmentRevisions`, `assessmentAnswerKeys`, publish-time freeze (PDR-031) | No non-lesson assessment payloads deployed |
| Required activity stages | Declared stages with completion rules | None | New: requirements definition |
| Required evidence definitions | Declared evidence items, kinds, validation | None | New: requirements definition |
| Optional enrichment definitions | Declared optional items (documentation and display only) | None | New: requirements definition |
| Evidence persistence | Per (assignment, student) server-held record | Pattern: `studentLabReports` (server-only, callables, ownership stamp, revision CAS, size limits). Its contract already reserves an assignment-linked report id `assignment_{assignmentId}` with `scope: "assignment"` | New record family or a designed extension of the lab-report family |
| Quiz eligibility | Server-derived from evidence record + requirements | `assessmentSessionsBegin` / `assessmentAttemptsFinalize` transaction structure | New eligibility check for non-lesson assignments |
| Quiz attempts | Immutable scored attempts | `assessmentSessions`, `attempts`, rollups | None |
| Best score | Highest percentage | `selectHighestCompletedAttempt` | None |
| Assignment completion | First finalized attempt | Existing summaries (`assessmentAssignmentSummary`) | Optional "quiz unlocked" state (Q6) |
| Teacher evidence retrieval | Read-only per student | `assessmentAttemptGetForTeacher` pattern; Student Detail lazy reads | New owning-teacher read callable |
| Launch | Authenticated arrival | `lmsDeepLinkResolve`, `/app/a/{assignmentId}`, enrollment checks | Resolver target for non-lesson pages |
| Launch grants | Server-issued delivery evidence | `launchGrants` (differentiation; TTL, deny-all) | Not needed for canonical delivery; only if non-lesson differentiation is added |
| Grade passback | Best percentage to Classroom | `lmsGradePassbacks`, `platform/functions/src/lms/grade-passback/grade-calculation.ts` | None expected |

### 11.2 Assignment identity and type

Reused unchanged: `assignments/{assignmentId}` remains the single
load-bearing identity. A non-lesson assignment carries `resourceType` and the
`<type>-<stem>` identifier. Making a type assignable is a deliberate,
per-type server change to `ASSIGNABLE_RESOURCE_TYPES`, made only once that
type's delivery, assessment, and eligibility path exists. A per-resource
allowlist (rather than a whole type at once) is recommended for the pilot
(§16, Q1).

### 11.3 Presentation and assessment revisions

- The assessment revision is frozen at publication (existing).
- The requirements definition and the delivered page must correspond to the
  frozen revision, the same principle as PDR-031 revision-bound display.
- **Recommended:** bind the requirements definition to the assessment
  revision, so one frozen identifier governs both the quiz and the required
  work. Changing a required stage or evidence prompt then means a new revision,
  and existing assignments keep their original requirements.
- The alternative, a separate resource revision identifier, is more flexible
  but adds a second freeze. Decide in the focused design review (§16, Q2).
- **Implemented (RA-3B):** bound to the assessment revision, with a content
  hash. See `FROZEN_COMPLETION_DEFINITIONS.md`.

### 11.4 Requirements definition (conceptual content)

For each resource and revision:

- Stage list: `stageId`, label, required or optional, and a completion rule
  (§11.6).
- Evidence list: `evidenceId`, kind (§6.1), prompt text or column schema,
  required or optional, structural validation (type, row bounds, presence,
  modest minimum length), and the stage it belongs to.
- Optional enrichment list (display and documentation only; never gating).
- Declared instructional exceptions to the type profile, each with a reason.

It contains no answer-key material and is not secret. It must be server
readable so the server can evaluate eligibility.

### 11.5 Evidence persistence

Conceptually one record per (assignment, student), written only through
student callables in the established pattern (as `labReportsSave`):

- Identity from the verified token and the canonical user record; active
  student; active enrollment in the assignment's class; district match.
- Ownership stamp (student, assignment, class, school, district) set on
  create and never changed.
- Optimistic concurrency (revision + idempotent `saveId`), server timestamps,
  size limits, no student text in logs or audit payloads.
- Autosaved drafts so work survives device changes (the lab-report rationale).
- An explicit **submit evidence** action that validates every required item
  and records a submitted snapshot with a server timestamp.
- Zero direct client Firestore access (deny-all Rules, matching
  `studentLabReports`).

### 11.6 Verifying required work (practical approach)

A client-reported "completed" flag is never trusted. The server can only
verify what it receives, so each stage declares one of three completion rules,
from strongest to weakest:

| Rule | What the server checks | Use for |
| --- | --- | --- |
| **Evidence-derived** | The stage is satisfied when its required evidence items are submitted and structurally valid. | Most stages: predictions, tables, CER, reflections, design records, trial tables |
| **Deterministic outcome check** | The client submits the parameters of the student's final configuration; the server recomputes the outcome with a shared pure function and confirms it meets the stage's success condition. | Simulation missions with deterministic physics or geometry (for example an eclipse alignment or a target trajectory), where practical |
| **Recorded completion (student attestation)** | The server records the student's attestation, with a server timestamp, and labels it as self-reported. | Exceptional. Only for physical or offline work the platform cannot independently verify, and only where the resource's frozen completion definition authorizes it for that stage (see the self-reported completion policy below). |

Rules of use:

- Prefer **evidence-derived**. It matches the product intent: completion
  checks verify that work was submitted, not that reasoning is good.
- A deterministic outcome check requires the simulation's success logic to be
  a pure, versioned function shared by client and server. It is optional
  hardening, not a pilot prerequisite.
- No rule claims to prove authentic performance. A determined student can
  fabricate client inputs. The platform guarantees that required evidence was
  submitted by the authenticated student before the quiz, nothing more.
- Eligibility is computed by the server from the stored record and the frozen
  requirements, never accepted from the client.

Self-reported completion policy:

1. Self-reported completion is an exceptional mechanism. It is not a general
   substitute for required instructional work.
2. For digital interactions where meaningful evidence or outcomes can be
   captured or independently validated, quiz eligibility depends on those
   mechanisms (evidence-derived or deterministic outcome check), never on a
   generic student confirmation.
3. For physical or offline work the platform cannot independently verify, a
   resource may explicitly require a student attestation together with
   accompanying evidence (for example test data, observations, or a design
   record) when appropriate.
4. An attestation records the student's report. It does not establish that
   the physical work actually occurred (§10).
5. Self-reported completion is available only for a stage whose resource's
   frozen completion definition specifically authorizes it. It is never a
   universal fallback for any stage or resource.
6. Teacher approval or verification is never required for quiz eligibility,
   assignment completion, or grading.

These rules apply only to required instructional work. Optional enrichment
never gates the quiz or completion (§4) and needs no completion rule.

### 11.7 Quiz eligibility in the assessment callables

- `assessmentSessionsBegin`, for an assignment whose `resourceType` is not
  `lesson`, reads the evidence record and refuses (with a new, distinct error
  code) unless eligible.
- `assessmentAttemptsFinalize` repeats the check inside its transaction.
- Both remain the sole session creator and sole attempt writer (security
  invariant 6). The eligibility check adds a precondition; it creates no
  alternative path.
- Lesson behavior is unchanged.

### 11.8 Delivery

Non-lesson pages are not built by the lesson build
(`app/scripts/lessonBuilder/`), and `CLAUDE.md` forbids extending that build
without explicit sprint direction. Two delivery options need a decision
(§16, Q3):

- **Separate authenticated artifact** under `/app/...` for each assignable
  resource, mirroring v1/v2 lessons; or
- **One page with host gating**, the Lab Report Assistant precedent: the
  public page stays anonymous and unchanged on the marketing host, and the app
  host injects authenticated evidence saving and the server quiz.

Either way, the public v1 page keeps working for anonymous visitors, and the
authenticated path must not post to the legacy Google Apps Script endpoint.

### 11.9 Decisions needing a focused design or security review

1. New evidence record family (or extension of `studentLabReports`): Rules
   deny-all block, ownership stamp, size limits, retention.
2. Eligibility gate inside `assessmentSessionsBegin` and
   `assessmentAttemptsFinalize`: error vocabulary, transaction reads,
   interaction with superseded occurrences and the `assignmentsCurrent`
   pointer (evidence should follow the Current occurrence, like attempts).
3. Requirements definition binding (assessment revision vs separate revision).
4. New owning-teacher evidence read callable and its projection.
5. Opening `ASSIGNABLE_RESOURCE_TYPES` (type-wide vs per-resource allowlist).
6. Deep-link resolver target for non-lesson assignments.
7. Any deterministic outcome check (shared function versioning).

Each is a Rules, callable, or data-model change. None is authorized by this
document.

---

## 12. Assessment integrity requirements

1. No client-computed score is ever trusted or stored as authoritative.
2. No answer key or graded explanation is delivered before finalize (§3.4).
3. Revisions are immutable; a correction ships a new revision with a paired
   answer key; existing assignments keep their frozen revision.
4. The client never selects a revision or requirements definition.
5. Eligibility is server-derived; a client "complete" flag is never accepted.
6. Evidence is ownership-stamped and server-written only.
7. Evidence and attempts are independent: neither operation can modify the
   other's record.
8. No student evidence text in logs, audit payloads, URLs, or Classroom.
9. Existing security invariants (`CURRENT_PLATFORM_STATE.md` §11) are
   preserved, including district boundary, enrollment checks, and answer-key
   confidentiality.
10. The authenticated path does not send data to legacy Google Apps Script
    endpoints.

---

## 13. Accessibility and differentiation considerations

- Required evidence inputs meet the canonical accessibility standard
  (labels, keyboard operation, visible focus, `aria-expanded` where relevant,
  large targets, mobile layout using the canonical breakpoints).
- Every gate explains what remains, in student language ("Finish your data
  table to unlock the quiz"), never only by color.
- Data tables and graph entry offer a keyboard and screen-reader path; a
  plotted graph is always backed by an editable table.
- Text minimums stay modest so students who write less, use dictation, or
  are English learners are not blocked. Minimums check presence, not length
  as quality.
- Evidence inputs autosave, so a student who needs more time or several
  sessions loses nothing.
- Simulation missions that depend on fine motor control offer an accessible
  alternative input (for example numeric entry instead of dragging) where the
  mission is required.
- Differentiated assessment presentations (F5.3 reduced-choice, adapted
  language) are a later, separate extension for non-lesson revisions. The
  5-item revisions should be authored so they can receive presentations later.
- Multilingual delivery, when it arrives, follows its own architecture; this
  standard does not define it.

---

## 14. Future resource authoring checklist

Use this for every new or converted assignable non-lesson resource.

**Identity and placement**

- [ ] Filename uses the correct prefix (`investigation_`, `simulation_`,
      `extension_`, `challenge_`) and yields a valid activity identifier.
- [ ] Registered in `app/src/curriculum/curriculum.registry.json` under its
      unit; `curriculum:verify` passes.
- [ ] Curriculum status (required or extension) is an owner decision recorded
      in `docs/hqim/`, not implied by the type.

**Learning objectives**

- [ ] Essential learning objectives listed (2 to 4), traceable to MA 2016 STE.
- [ ] Grade level fixed; no other grade's performance expectation is taught
      and assessed.

**Required work and evidence**

- [ ] Type profile (§7) applied; each omitted component has a one-line
      instructional-exception reason.
- [ ] Required stages listed, each with a completion rule (§11.6), preferring
      evidence-derived.
- [ ] Required evidence listed with kind, prompt, and structural validation.
- [ ] Data and graphs captured as structured values.
- [ ] Failed or unexpected results can be recorded.
- [ ] Minimum meaningful completion stated in one sentence.
- [ ] No arbitrary gates (click counts, dwell time, open-every-card).

**Optional enrichment**

- [ ] Optional items listed; none gates the quiz or completion.

**Five-question quiz**

- [ ] Exactly 5 objective items, each aligned to an essential objective.
- [ ] DOK 1/2 mix, explanations, plausible distractors, no longest-answer
      bias; answer positions pass the quality verifier.
- [ ] Authored as a canonical revision payload; no answers in the delivered
      page.
- [ ] Not a copy of the in-activity formative checks.

**Physical work (if any)**

- [ ] Physical tasks identified; evidence fields describe them; the
      limitation statement (§10) appears in teacher-facing material.
- [ ] No teacher verification step.

**Teacher view**

- [ ] Each evidence item has a teacher-readable label and prompt context.
- [ ] No grading, rubric, or approval controls.

**Accessibility and style**

- [ ] Section 13 met; gates explained in student language.
- [ ] Learning Science Focus block present; `CLAUDE.md` style rules, including
      no em dashes.

---

## 15. Proposed implementation sequence

Each phase is a separate, owner-authorized operation. Nothing here authorizes
bulk conversion.

| Phase | Scope | Key outputs |
| --- | --- | --- |
| 0 (this document) | Standard and inventory | Approved product decisions recorded |
| 1 (done, `e20df02`) | Activity identifier contract | `resourceType`, reserved prefixes, parity test |
| 2 | Focused design and security review | Decisions on §16 Q1 to Q8; data model, Rules, and callable contract amendments |
| 3 | Platform infrastructure, no resource yet | Evidence record + callables; eligibility gate in begin/finalize; teacher evidence read; deny-all Rules; tests; staging only |
| 4 | Pilot resource content | Requirements definition and 5-item revision for the pilot; authenticated delivery; 5-item display review in client strings |
| 5 | Pilot enablement | Per-resource assignability; staging certification (launch, gating, refusal of early begin, evidence persistence, retake without evidence loss, teacher view, passback); then production by separate authorization |
| 6 | Batch conversion | Small groups per inventory §15, each with content review |

### 15.1 Pilot selection: Gravity Wells

Gravity Wells remains the provisional first pilot. The evaluation against the
new required-evidence and gating rules, and the recommended alternative if the
owner prefers a stronger evidence exemplar, are in
`LYFELABZ_NON_LESSON_RESOURCE_INVENTORY.md` §15.

### 15.2 Minimum infrastructure for a pilot

1. Authenticated resource delivery reachable from `/app/a/{assignmentId}`.
2. A deployed 5-item assessment revision for the pilot identifier.
3. A requirements definition the server can read, bound to that revision.
4. An evidence record with student save/submit callables (deny-all Rules).
5. An eligibility check in `assessmentSessionsBegin` and
   `assessmentAttemptsFinalize` for non-lesson assignments.
6. Completion on first finalize (existing) and best score (existing).
7. A teacher read-only evidence view in Student Detail.
8. Retakes that skip work and leave evidence untouched (follows from sticky
   eligibility and separate records).
9. Per-resource assignability for the pilot identifier only.

---

## 16. Open architectural questions

| ID | Question | Recommendation |
| --- | --- | --- |
| Q1 | Open a whole resource type, or allowlist individual resources? | Per-resource allowlist for the pilot and early batches. |
| Q2 | Bind the requirements definition to the assessment revision, or to a separate resource revision? | Bind to the assessment revision (one freeze). Implemented in RA-3B (`FROZEN_COMPLETION_DEFINITIONS.md`). |
| Q3 | Separate authenticated artifact or host-gated single page? | Decide in Phase 2; host gating has a working precedent (Lab Report Assistant). |
| Q4 | New evidence record family, or extend `studentLabReports` with `scope: "assignment"`? | Likely a dedicated family with the same patterns; lab reports are a personal tool with a different lifecycle. |
| Q5 | After evidence submission, can students edit it? If so, is history kept? | Pilot: evidence is frozen at submission (simplest, matches what preceded the quiz). Revisit with teacher feedback. |
| Q6 | Should teacher summaries show "quiz unlocked" separately from "in progress"? | Yes, as a count only; requires a summary change. |
| Q7 | Ball Run: one assignable challenge with five day stages, or five assignable resources? | One challenge (HQIM-4A counts Ball Run once; one 5-item quiz at the end). Requires consolidating five independent pages. |
| Q8 | Should the eight required body-system maps become assignable, given they are outside the Phase 1 grammar? | Out of scope here; owner decision. |
| Q9 | Should the attempt-level Show Your Thinking prompt also appear after a non-lesson quiz? | Optional per resource; never required evidence. |
| Q10 | Does the existing rollup/summary pipeline need to treat non-lesson assignments differently (for example in per-lesson summaries)? | Verify in Phase 2; `assessmentLessonSummary` naming assumes lessons. |
| Q11 | `CLAUDE.md` QUIZ RULES state "10 questions" without scoping them to lessons. | Owner may add one clarifying line that non-lesson resources follow this standard. Not changed here. |

---

## Change log

- 2026-10-08: Initial issuance. Documentation only; no code, Rules, index,
  schema, or deployment change.
