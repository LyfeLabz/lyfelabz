# V2 Constructed-Response Evidence Trace — Investigation 1

> **Status:** Human-reviewed Astra read-only audit consolidated 2026-09-27. Sources: Investigation 1; current-state qualifications from Investigations 7–8 and consolidation source inspection; [source register](source-register.md). Human policy belongs to the project owner. This record authorizes no implementation. Source behavior is not proof of deployed behavior or teacher receipt.

## Historically verified defect

The ordinary authenticated V2 lesson flow read and locally used constructed-response writing, but omitted it from the lesson-to-assessment handoff. The shared layer therefore did not send it, the backend never received it, and Teacher Workspace could not display that writing. This was a payload/retention defect, not absence of a writing task or solely a display defect. The historical investigation verified the shared omission across the 23 ordinary Grade 6 lessons.

Legacy public branches used `thinking`; their existence did not prove deployed receipt and did not repair the authenticated route. Existing immutable attempts cannot recover text never submitted.

## Implementation in progress / current source state

Later Investigations 7–8 observed 22 of 23 ordinary Grade 6 lessons passing `writtenResponse`. The consolidation source census corroborates that snapshot. Conducting Experiments is externally modified and its inspected finalization still sends selected answers without the writing argument.

| Boundary | Source-level observation | Verification limit |
| --- | --- | --- |
| Lesson → shared adapter | Most ordinary Grade 6 finalizers now supply writing; Body Systems does so | Source census, not classroom or deployed submission |
| Runtime → autosave | Final autosave accepts writing before finalization | Does not universally require writing |
| Session → attempt | Backend supports retaining writing with the attempt | Production records not inspected |
| Teacher projection → adapter | Optional writing is returned/preserved | Retrieval success not executed |
| Workspace | Source supports attempt-response display | Production rendering not tested |

Repository anchors: [Body Systems delivery](../../app/lessons/lesson_body-systems.html), [runtime](../../app/src/runtime/orchestrator.ts), [teacher attempt projection](../../platform/functions/src/assessments/assessment-attempt-get-for-teacher.ts), [adapter](../../app/src/assignments/detail/attempts-wire.ts), [Workspace](../../app/src/shell/surfaces/classes.ts), [Conducting Experiments source](../../lesson-sources/lesson_conducting-experiments.html).

### Later external provenance commit

During consolidation, external commit `fc598c8` added conditional assessment-presentation revision and accommodation configuration references to attempts, with server-side presentation identity checks. External commit `06a46ca` added an accessible Earth’s Layers assessment. These are source developments owned by another workstream; they do not establish universal historical Grade 6 writing-prompt reconstruction, teacher presentation of that context, or production operation. The 22/23 ordinary Grade 6 handoff census was rechecked after the first commit and remains applicable after the second, which does not change those ordinary lesson files.

## Locally verified, if established

The reviewed synthesis inspected test assertions for transmission, truncation, persistence, separate attempts, replay, retrieval, and rendering. It did not run tests or execute authenticated end-to-end submission. This consolidation rechecks source text and paths; it does not promote test presence to passing tests or a successful local end-to-end run.

## Production verified, if established

**Not established by this audit series or consolidation.** There is no production certification here for universal writing retention, teacher receipt, latest-first display, retry behavior, or historical prompt reconstruction.

## Attempt semantics and unresolved verification

| Topic | Ratified intent / reviewed finding | Remaining qualification |
| --- | --- | --- |
| Latest thinking versus best score | Attempt-specific writing and best objective score answer different questions | Earlier synthesis found no latest-first review; current production compliance unverified |
| Distinct genuine attempts | Source supports separate attempt identities and optional writing | A visible retry is not automatically a new attempt |
| Same-page Try Again | Local reset can clear/rewrite text while runtime retains finalized state | Runtime returns cached result after finalization; fresh writing may remain unsaved |
| Historical prompt | Assessment revision is useful objective-item context | It does not universally preserve exact historical writing wording; active presentation work must be verified separately |
| Submission success | Fresh correctly wired runtime awaits autosave/finalization | Missing writing remains allowed; local feedback can appear earlier; adapter length truncation and cached success qualify the claim |
| Authorship | Account/attempt identity supports attribution | Does not prove independent reasoning or absence of collaboration |

Investigation 8 documented a 10,000-character adapter limit and oldest-first teacher presentation at its snapshot. Those are historical/current-source findings for the owning workstream to verify, not product policy.

## Handoff boundary

Preserve attempt-specific reasoning, distinguish latest thinking from best score, and verify task context and teacher access before production claims. No repairs, retries, test execution, deployment, schema, or assessment contract are authorized by this document.
