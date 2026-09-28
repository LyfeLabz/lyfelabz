# Security Backlog: Correct-Answer Data in Lesson Pages

**Status:** Open backlog item (owner decision D7, 2026-09-27). Deliberately out of scope for F5.3, including Slice 9, which inherits the condition temporarily (see below).

## Finding

Every lesson page embeds its quiz as an inline script literal (for example `elQuizQuestions` in `lesson_earths-layers.html`). Each question carries its `correct` option index and `explanation`, which the page uses for instant feedback in practice mode and for the post-submit reveal.

Anyone can read these answers in the browser's developer tools before answering. This applies to canonical lessons (v1 public and v2 authenticated) and to the retained reading-adapted variant artifact `prff01d9...375c`.

## Contract status

This condition contradicts the intended answer-data boundary:
- `ASSESSMENT_PIPELINE_SPECIFICATION.md` §11.2: no in-page bundle contains the answer key;
- `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §15: no cached asset or bundled script presents it, and a practice copy carries no answer key or explanations.

Both documents now record the condition as known and unresolved. It is not waived.

## F5.3 Slice 9 inheritance (owner ruling S9-E1, 2026-09-27; PDR-031g)

F5.3 Slice 9 adds revision-bound canonical renditions, one generated lesson page per committed assessment revision for lessons with more than one revision (`DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md` §21.3). As a temporary inherited condition:

- Renditions carry the same quiz data the canonical page carries today: `q`, `options`, `correct`, `explanation`. They carry nothing broader: no rubric, rationale, review data, or any other answer-key field.
- In practice, once a lesson has r2, the r1 rendition keeps r1's already-public answer data served alongside r2's. That is the existing condition applied per revision, not a new kind of exposure.
- Slice 9 does not implement, resolve, or waive D7.
- **The D7 fix must cover canonical pages, retained differentiated artifacts, and revision renditions.** Renditions come from one generator, so that fix has a single place to change them.

## What is not affected

Scoring is server-authoritative:
- The answer key (`assessmentAnswerKeys/*`) is deny-all to clients.
- `assessmentAttemptsFinalize` scores only against it.
- Since F5.3 Slice 2, responses must be canonical option IDs of the frozen revision.

A student who reads the page data can choose correct answers, but cannot forge a score, correctness, or an answer key.

## Why deferred

Removing the data would change practice-mode feedback and the post-submit reveal on all 49 lessons. That requires a server-mediated feedback path. It is a separate hardening project, not part of F5.3 (see F5.3 section 14.3).

## Possible direction (not designed)

For classroom attempts, withhold `correct` and `explanation` from the page and render the reveal from the finalize response's `itemResults`, which already carries them. Practice mode would need its own decision.
