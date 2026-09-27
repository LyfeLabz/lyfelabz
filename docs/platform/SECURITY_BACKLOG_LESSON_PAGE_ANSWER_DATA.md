# Security Backlog: Correct-Answer Data in Lesson Pages

**Status:** Open backlog item (owner decision D7, 2026-09-27). Deliberately out of scope for F5.3.

## Finding

Every lesson page embeds its quiz as an inline script literal (for example `elQuizQuestions` in `lesson_earths-layers.html`). Each question carries its `correct` option index and `explanation`, which the page uses for instant feedback in practice mode and for the post-submit reveal.

Anyone can read these answers in the browser's developer tools before answering. This applies to canonical lessons (v1 public and v2 authenticated) and to the retained reading-adapted variant artifact `prff01d9...375c`.

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
