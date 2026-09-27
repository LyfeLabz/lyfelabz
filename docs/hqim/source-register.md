# HQIM Source Register and Reconciliation Rules

> **Status:** Consolidation provenance recorded 2026-09-27. This register identifies human authority, reviewed findings, and source snapshots. It does not authorize implementation.

## Source hierarchy

1. Human-ratified decisions govern.
2. Human-reviewed audit findings provide the factual audit record.
3. Current repository evidence verifies terminology, paths, and implementation state.
4. Existing HQIM documents supply useful earlier analysis, subject to correction.
5. External authoritative sources supply standards/framework/scientific provenance.

The owner’s session directive states that all eight narrow investigations were complete and human reviewed. That attestation establishes review status; this consolidation does not claim to have witnessed each review. The resulting documents are summaries and reconciliations, not verbatim transcripts or fresh full audits.

## Human authority

The current “LYFELABZ HQIM DOCUMENTATION CONSOLIDATION” directive authorizes writes only inside `docs/hqim/`, prohibits implementation and Git publication operations, freezes classifications, and supplies governing delivery/evidence policies and activity-specific decisions.

The provided attachment ends at section 24 item F, “Grade 6 Task-Level Performance Progression.” Its continuation was requested but was not available when this record was assembled. The document organization covers all substantive instructions supplied and the retrieved reviewed findings; it does not invent unseen instructions.

Earlier HQIM-3A/4A user decisions are preserved through their reconciliations. The owner's later Build-a-Boat, physical-investigation, modeling, and Ball Run clarifications supersede earlier open questions. The summer-program clarification is also present in the project planning task.

## Retrieved audit records

The following completed reports were retrieved from task history. Dates are report completion dates in UTC; a task may contain earlier and later turns. Section references in consolidated documents refer to these original reports.

| Source ID | Task title | Task ID | Reports recovered |
| --- | --- | --- | --- |
| HQIM-3 / HQIM-3A | 🍖 Audit Grade 6 evidence gaps | `01a0c5fe-a83c-7e31-b7dd-26e048e2b91e` | 2026-09-21, 2026-09-21 |
| HQIM-4 / HQIM-4A | 🍖 Audit Grade 6 course coherence | `01a0c644-3098-7281-9b60-317706b7666c` | 2026-09-22, 2026-09-21 |
| HQIM-5 | 🍖 Audit Grade 6 task progression | `01a0ca0d-5942-7c43-9924-55631c700292` | 2026-09-22 |
| Investigation 1 | 🍖 LYFELABZ V2 CONSTRUCTED-RESPONSE EVIDENCE TRACE NARROW R… | `01a0ca31-d11b-7501-a64b-8539f01760ae` | 2026-09-23 |
| Investigation 2 | 🍖 LYFELABZ BALL RUN EVIDENCE-CHAIN AUDIT NARROW READ-ONLY… | `01a0cd7d-32ee-7601-840a-8dcd397b74eb` | 2026-09-23 |
| Investigation 3 | 🍖 LYFELABZ FOSSIL HUNT SCIENTIFIC-ACCURACY AUDIT NARROW RE… | `01a0cd8a-42db-7d21-8fd4-9c4d34b253ca` | 2026-09-23 |
| Investigation 4 | 🍖 LYFELABZ CONDUCTING EXPERIMENTS PERFORMANCE-MISMATCH AUD… | `01a0d573-3528-7a73-93f0-ecd36ec0a7cc` | 2026-09-24 |
| Investigation 5 | 🍖 LYFELABZ PS1-8 PHYSICAL PERFORMANCE REQUIREMENTS AUDIT N… | `01a0d5b7-fd36-7691-b9c3-10e7c49e7446` | 2026-09-24 |
| Investigation 6 | 🍖 Audit PS1-6 physical requirements | `01a0df38-1fcb-79a3-9f40-8a5bca8d3d0d` | 2026-09-26 |
| Investigation 7 | 🍖 Audit Grade 6 modeling progression | `01a0df43-2df4-78e0-bfab-89e094daa5bb` | 2026-09-26 |
| Investigation 8 | 🍖 Audit Grade 6 evidence visibility | `01a0df5a-e56c-7101-b592-5d531e2ed147` | 2026-09-27 |

The original reports distinguish repository observation, human policy, inference, and unverified assumptions. Their former proposals or unresolved decisions must be read through the later ratifications. No new work was sent to those tasks.

## Current repository anchors

Source inspection at consolidation baseline `4484b250c78fbb7a01d6479547b5656c0c76dd9c` included uncommitted external development; HEAD alone does not identify that working tree. Later external commits moved HEAD/local origin to `06a46ca6cb16c2a4f54c62933786db2f83188329`; see the [session record](documentation-consolidation-record.md). Current-writing observations were checked against the changing source, without certifying production.

| Evidence area | Inspectable repository source |
| --- | --- |
| Ordinary Grade 6 population | [Curriculum manifest](../../app/src/curriculum/curriculum.manifest.json), read only; 23 ungated ordinary Grade 6 lessons |
| Canonical lesson writing | [Body Systems](../../lesson-sources/lesson_body-systems.html), [Biological Evolution](../../lesson-sources/lesson_biological-evolution.html) |
| Current ordinary writing census | `app/lessons/lesson_*.html`, narrowed to the 23 ordinary Grade 6 manifest lessons: 22 passing `writtenResponse`, Conducting Experiments exception |
| Writing/attempt chain | [Runtime](../../app/src/runtime/orchestrator.ts), [teacher retrieval](../../platform/functions/src/assessments/assessment-attempt-get-for-teacher.ts), [adapter](../../app/src/assignments/detail/attempts-wire.ts), [Workspace](../../app/src/shell/surfaces/classes.ts) |
| Active preparatory lesson correction | [Conducting Experiments](../../lesson-sources/lesson_conducting-experiments.html); supplied-results premise observed, no writing argument in inspected finalizer |
| Required investigations | [Gray Zone](../../investigation_gray-zone.html), [Cell Energy](../../investigation_cell-energy.html), [Amplitude](../../investigation_amplitude-challenge.html) |
| Geological evidence | [Fossil Hunt](../../extension_fossil-hunt.html), [Floatlandia](../../simulation_floatlandia-fracture.html) |
| Space models | [Eclipse Alignment](../../simulation_eclipse-alignment.html), [Gravity Wells](../../simulation_gravity-wells.html) |
| Eight required maps | [Circulatory](../../system_circulatory.html), [Digestive](../../system_digestive.html), [Respiratory](../../system_respiratory.html), [Excretory](../../system_excretory.html), [Skeletal](../../system_skeletal.html), [Muscular](../../system_muscular.html), [Nervous](../../system_nervous.html), [Immune](../../system_immune.html) |
| Engineering representation | [Ball Run hub](../../challenge_slow-motion-ball-run.html), five daily pages, [Floatia](../../challenge_welcome-to-floatia.html); authentic boat details come from owner context |

Use semantic symbols and filenames rather than treating historical line numbers as stable through parallel development. The consolidation reran a source census, not application tests or authenticated submissions.

## External provenance

The [Massachusetts framework](https://www.doe.mass.edu/frameworks/scitech/2016-04.pdf) is the governing standards source (Grade 6 printed pages 54–59). It was reopened during consolidation. Standard-specific interpretations were already examined in Investigations 5–7; this is not a new framework or external eligibility review.

The [BGS crinoid reference](https://www.bgs.ac.uk/discovering-geology/fossils-and-geological-time/crinoids/) was reopened to verify the distinction between the broad group and useful specific taxa. Investigation 3 section 27 retains the detailed scientific source inventory for its range and correlation findings.

The existing [external-review matrix source register](external-review-readiness-matrix.md#source-register) and [review-board report](review-board-report.md) retain earlier EdReports/CURATE/EQuIP provenance and unresolved admission/rubric questions. Those framework checks are dated historical research, not re-certified current eligibility in this consolidation.

## Reconciliation and verification discipline

Historical facts remain historical. Current-source support, inspected test coverage, a passing local test, a local end-to-end run, and production verification are different evidence levels. No source-only observation is upgraded to a deployed capability here.

A changed rationale does not change a frozen HQIM-3A classification. The [roster](hqim-3a-human-decision-reconciliation.md) contains all 22 recovered letters; there is no need to retain HQIM-5's historical “roster not supplied/located” uncertainty now that HQIM-3A has been recovered.

See the [session record](documentation-consolidation-record.md) for repository baseline, external work, scope, and validation.
