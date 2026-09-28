# LyfeLabz Persistent Student Differentiation

## F5.3 Addendum: Accessible Assessment Presentations

**Status:** Specification addendum to `DIFFERENTIATION_F5_2_IMPLEMENTATION_SPECIFICATION.md` (F5.2). Owner-approved with decisions D1-D8 (section "Owner decisions"). **Slices 1-4 implemented** (answer-position quality gate; server response validation; immutable assessment-presentation records, certification records, manifest binding, and the `assessmentPresentations` deny-all Rules block; build-time rendering of a certified presentation into a lesson artifact and canonical-option-identity mapping in the browser runtime; publication, resolution, and provenance propagation through index, grant, session, and attempt, with displayed-option validation). The owner's Slice 5 covers the table's slices 5 and 6. **Slices 6A and 6B implemented** (owner-review tooling; the Earth's Layers presentation `ap1fed478c...02c25`, owner-certified, retained, bound, and rendered into the new retained revision `pr90f52136...2189`; see slices 6A and 7 in section 20). **Slice 8 (staging certification C7-A to C7-F) is COMPLETE and PASSING for Earth's Layers** (2026-09-28; section 18.1). Slices 9 and 10 and production are not started. No canonical lesson or assessment content has changed. Where this addendum and F5.2 conflict, this addendum governs for assessment presentation only; every F5.2 contract not named in section 16 is unchanged.

**Evidence base:** repository HEAD `176fe27`; staging certification C4-C6 (2026-09-27); a read-only audit of all 49 committed assessment payloads.

---

### 1. Scope and non-goals

**Scope (V1 of this addendum).** A student with an active Reading Accessibility accommodation, on a lesson with published coverage, receives an accessible **assessment presentation** covering:

- multiple-choice stems, choices, and directions in adapted language;
- **three displayed choices instead of four** on every multiple-choice item;
- an adapted Show Your Thinking prompt and model answer;
- adapted student-facing post-answer and post-submit explanations.

These are delivered together with the existing reading-adapted instructional presentation.

**Invariant.** The assessment presentation changes how items are shown, never what is measured or how it is scored. Every accessible presentation maps onto exactly one canonical assessment revision, and is scored only by that revision's server-held answer key.

**Non-goals.**
- Canonical lesson versioning in general. This is the existing F5.2 non-goal; see the backlog note in 9.4.
- Adaptive testing, item substitution, or a different number of items.
- Different points, a separate grade scale, or a separate best-score track.
- A second teacher-facing accommodation control. V1 keeps one service (Reading Accessibility); see section 4.
- Removing client-side quiz answer data from lesson pages. See 14.3.
- Any Classroom change.

**Preserved result.** C6C (2026-09-27, staging) is PASS under the presentation-only architecture it certified. Its attempt remains valid and interpretable as-is: `deliveryOutcome: differentiated`, `presentationRevisionId prff01d9d2cf71210c491afc60cf98cd3d69b91d5c64cae51aff2463b50892375c`, `assessment_earths-layers__r1`, score 2/10, no passback. The artifact `prff01d9...375c` is retained and immutable.

---

### 2. Language adaptation

**May reduce:**
- unnecessary reading load;
- sentence and syntactic complexity;
- linguistic barriers unrelated to the science construct, in stems, choices, directions, the Show Your Thinking prompt and model answer, and explanations.

**Must preserve:**
- scientific accuracy;
- the badged standard and learning target;
- the underlying concept;
- cognitive demand (DOK) and rigor;
- correct-answer meaning;
- the misconception each retained distractor represents;
- the scoring scale;
- the Show Your Thinking evidence expectation.

**Must not:**
- reveal or cue the answer, through wording, length, grammatical agreement, specificity, repetition of stem words, or which distractor was removed;
- add information that changes what a correct answer requires.

Vocabulary support inside items is allowed only where the reviewer certifies it does not cue the answer.

---

### 3. Reduced-choice accommodation

Each canonical four-option item is presented with **three** options:

- the canonical correct option;
- two canonical distractors.

Exactly one distractor is omitted. The omission is a **deliberate, reviewed choice** recorded with a rationale; it is never random or positional. The two retained distractors must remain plausible and represent meaningful misconceptions.

The retained options may be shown in any order the author chooses. That order is part of the presentation, and it is subject to the answer-position quality standard (section 13).

The canonical correct option can never be omitted. The build enforces this (section 11).

---

### 4. Accommodation dimensions: separation and composition

Reading level and number of choices are **separate presentation traits**, not one permanent equivalence. V1 does not add a second teacher-facing accommodation.

- **Accommodation record (unchanged, F5.2 3.1):** one service, `readingAccessibility {status, level}`.
- **Delivery profile:** the existing `variantKey` names a *delivery profile*, derived server-side from the accommodation configuration by the existing `variantKeyForReadingLevel`. In V1, `reading-adapted` is defined as `{ language: "adapted", choiceCount: 3 }`.
- **Traits are declared on the assessment presentation record** (section 8): `language` (`canonical | adapted`) and `choiceCount` (`4 | 3`). They are frozen with the provenance, so history never depends on today's meaning of a variant key.
- **Future composition:** adding a second service later means extending the derivation from configuration to profile, plus new profile keys such as `reduced-choice` = `{canonical, 3}` or `reading-adapted-4` = `{adapted, 4}`.
  - Each lesson publishes only the profiles it supports. A missing profile is a coverage gap and resolves to `canonicalFallback`, as F5.2 already specifies.
  - One assignment, one Current, and one grant per launch are unaffected, so there are no duplicate assignments and no combinatorial authoring requirement.

---

### 5. Canonical assessment semantics

`assessment_<slug>__r<N>` (for example `assessment_earths-layers__r1`) remains the single canonical semantic and scoring identity. An accessible presentation **never** creates a new assessment revision.

**Boundary: what requires a canonical r(N+1).** Any change to:
- an item's canonical stem meaning;
- the canonical option set or any canonical option's meaning;
- the correct option;
- points;
- item count or item identities;
- the canonical explanation;
- the canonical rendered order of options. See section 13 and 17.3: r1 option IDs are letters equal to their r1 display positions, so reordering them in the canonical presentation is canonical content.

**Boundary: what is only a new assessment presentation.**
- Adapted wording of stems, choices, directions, explanations, or the Show Your Thinking prompt and model answer.
- Which distractor is omitted.
- The display order of options inside that presentation.
- Adapted vocabulary support.

---

### 6. Stable item and option identity model

**Finding.** Stable canonical option identities already exist.
- Each revision stores `items[].options[].optionId`, with `A` to `D` for all 49 committed payloads.
- The answer key stores `correctOptionId`.
- `scoreAttempt` (`assessment-attempts-finalize.ts:328-448`) scores by comparing the response string to `correctOptionId`, not by position.

**The positional assumption lives only in:**
1. the client mapping `mapIndexSelectionsToResponses` (`app/src/runtime/entry.ts:124-136`), which sends `OPTION_LETTERS[displayIndex]`;
2. the build fidelity rule that `optionId` equals the letter for its index (`assessmentFidelity.cjs checkFidelity`);
3. item identity `q<N>`, derived from the item's position.

**Model (smallest change).**
- **Canonical option identity:** the revision's `optionId`. It is immutable per revision. A letter `optionId` is an opaque identifier, not a display position.
- **Canonical item identity:** the revision's `itemId`. Item order stays canonical in V1; accessible presentations do not reorder items.
- **Displayed choice:** each displayed choice in a presentation carries the canonical `optionId` it represents.
- **Responses always carry canonical `optionId` values, never display letters.**
  - Canonical four-choice lessons keep today's behavior: display index equals `optionId` letter, so no change.
  - Presentation-bound lessons send the `optionId` from the presentation's displayed-choice table.
  - **As implemented (Slice 4):** a rendered artifact carries one non-executable `<script type="application/json" id="lyfelabz-assessment-presentation">` block: `{ schemaVersion: 1, lessonSlug, assessmentRevisionId, assessmentPresentationRevisionId, items: [{ itemId, optionIds }] }`, with every displayed choice's canonical `optionId` in display order and no correctness data. `lessonQuiz` (`app/src/runtime/entry.ts`) reads it at call time and submits `{ itemId, optionIds[displayIndex] }`; the display letters (A, B, C) are labels only. A page without the block keeps the legacy letter mapping (canonical option IDs are positional letters there by the fidelity contract). A page whose block is malformed, or a selection outside the displayed choices or a question count that does not match, fails closed: autosave sends nothing and finalize returns a non-recoverable refusal. There is never a fallback to positional letters on a presentation-bound page. The block is not authoritative; the server validates every response (section 7).
- The server validates every response against the authorized displayed set for the frozen presentation (section 7). The client never designates correctness, and the answer key stays server-only.

---

### 7. Scoring model

Scoring is canonical and server-authoritative, as today:

- same answer key;
- same `points` (1 per item);
- same `maxScore`, which is the canonical item count;
- same `percentage`;
- same `roundHalfToEven2`;
- same `itemResults` shape.

**New server validation (fail closed):**

1. **Implemented in Slice 2.** A response's `optionId` must be one of the item's canonical `optionIds` in the frozen revision. This applies to **all** sessions, canonical included. Before Slice 2 a non-member string silently scored 0 and an unknown `itemId` was ignored.
2. If the session froze an `assessmentPresentationRevisionId`:
   - the response must be one of that item's **displayed** `optionIds` in the frozen presentation;
   - the presentation's `assessmentRevisionId` must equal the session's `assessmentRevisionId`.
3. Autosave rejects an invalid response with `INVALID_ARGUMENT`. Finalize re-validates inside its transaction and refuses the attempt on any violation, writing nothing.

**As implemented (Slice 2).** One shared validator, `platform/functions/src/assessments/response-validation.ts` (`allowedOptionIdsByItem`, `findInvalidResponse`), is used at both authoritative boundaries:

- **Autosave** (`assessmentSessionsAutosave`): after ownership, district, school and live-status checks, and before the idempotent coalesce (so an identical replay of an inadmissible payload is refused, never acknowledged), it reads the session's frozen revision and rejects:
  - an unknown `itemId`;
  - a non-string or unknown `optionId`, including another item's option;
  - any response to an item type without an admissibility rule.
  It uses `assessmentSessions.invalidResponses`. A missing or unpublished frozen revision is `assessmentSessions.revisionMissing`. An empty responses array needs no revision read. Nothing is written on refusal.
- **Finalize** (`assessmentAttemptsFinalize`): inside the scoring transaction, after the pure `scoreAttempt` (so revision and answer-key integrity errors keep precedence), the stored responses are re-validated. A violation is `assessmentAttempts.invalidResponse`: no attempt, no session delete, no audit event, no grade passback. The session survives, so the student can re-answer and submit.
- Diagnostics name the item and the rule only; they never echo the submitted value or any answer-key data.
- Missing items remain unanswered and score 0 (scoring contract §8.4, unchanged).
- **Implemented in Slice 5:** for a session that froze an `assessmentPresentationRevisionId`, both boundaries load that immutable record (autosave by direct read; finalize inside the scoring transaction), verify it (content hashes to its id, maps onto the session's `assessmentRevisionId`), and narrow each item's admissible set to canonical options that were DISPLAYED (`narrowToDisplayedOptions`). The omitted distractor of a three-choice presentation is refused although the revision contains it. An unverifiable record fails closed (`assessmentSessions.presentationUnavailable` / `assessmentAttempts.presentationUnavailable`). A session without the id keeps the Slice 2 canonical check and reads no record. A client-supplied `assessmentPresentationRevisionId`, `displayedOptions`, or `displayedOptionIds` is refused as a request-shape error at autosave, begin, and finalize.
4. `itemResults` is unchanged. The displayed set and wording are recovered from the immutable presentation record, and are not copied onto every attempt.

---

### 8. Provenance and revision model

The earlier assumption that "`presentationRevisionId` alone is sufficient" is superseded. A reduced-choice presentation changes which option IDs are legal, and the server must validate that at scoring time without parsing HTML.

**Assessment presentation record** (new, immutable, content-addressed; implemented in Slice 3 by `app/scripts/lessonBuilder/assessmentPresentation.cjs`):
- **Identity:** `assessmentPresentationRevisionId = "ap" + sha256(canonicalJson(record))`. `canonicalJson` is deterministic: object keys sorted by UTF-16 code unit, arrays kept in order, no insignificant whitespace, strings must already be Unicode NFC, numbers must be safe integers. The record never contains its own id.
- **Retained copy (source of truth for history):** `platform/functions/src/scripts/assessment-presentations/<id>.json`, beside the canonical payloads it maps onto and never hosting-served. The file bytes must be exactly `canonicalJson(record) + "\n"`, so a file is valid only if its name, its bytes, and its content hash all agree. Files are add-only.
- **Firestore:** `assessmentPresentations/{assessmentPresentationRevisionId}`. Reserved in Slice 3: the explicit deny-all Rules block and the server type (`shared/types/assessment-presentation.ts`) exist; the publisher writes it (create-or-verify-equal, never updated or deleted) in Slice 5.

Record body (closed schema; unknown fields fail):

| Field | Meaning |
|---|---|
| `schemaVersion`, `kind` | `1`, `"lyfelabz.assessmentPresentation"` |
| `lessonSlug` | Owning lesson |
| `assessmentRevisionId` | The one canonical revision this presentation maps onto (`assessment_<slug>__r<N>`) |
| `traits` | `{ language: "canonical" \| "adapted", choiceCount }`. Generic: no variant key is stored. Any combination that differs from canonical is valid (adapted + 3, adapted + 4, canonical + 3); canonical language with the full choice count is refused as "no presentation needed" |
| `directions` | Adapted assessment directions, or `null` (required `null` under canonical language) |
| `items[]` | Every canonical item, in canonical order: `itemId`, `stem`, `displayedOptions[]` (display order, each `{ optionId, text }` with a canonical `optionId`), `omittedOptions[]` (each `{ optionId, rationale }`: a deliberately omitted canonical distractor and the authored reason), `feedback` (adapted student-facing explanation, or `null` for the canonical explanation) |
| `showYourThinking` | `{ prompt, modelAnswer, requiredTerms[] }` under adapted language; `null` under canonical language (the canonical prompt applies) |

The record holds no correctness, points, or scoring data. Keys such as `correctOptionId`, `correct`, `isCorrect`, `answerKey`, `points`, or `score` anywhere in it are an explicit failure. Tooling may read the committed canonical payload (which includes the answer key) to verify a presentation, but copies nothing from the key into it. The omission `rationale` is authored review content, kept in the record because it is part of what was decided for that presentation; the record is server-only and never client-readable.

**Provenance chain** (each question is answered by an immutable identity):

| Question | Source |
|---|---|
| Canonical assessment revision and scoring semantics | `assessmentRevisionId`, plus its answer key |
| Instructional presentation seen | `presentationRevisionId`, pointing to the retained artifact |
| Exact item wording, displayed choices, their order, omitted distractor, displayed-to-canonical mapping, Show Your Thinking prompt, explanations | `assessmentPresentationRevisionId`, pointing to the immutable record |
| Accommodation configuration used | `accommodationConfigRevision`, pointing to `studentAccommodations/{uid}/history/r<N>` |
| How the attempt was scored | `itemResults` on the attempt |

**New frozen fields (additive, optional):**
- **Presentation variant index:** `assessmentRevisionId`, `assessmentPresentationRevisionId`.
- **Launch grant:** `assessmentPresentationRevisionId` and `accommodationConfigRevision`. Present only on `differentiated` grants, and copied from the index and the accommodation read at issuance. **As implemented (Slice 5):** `accommodationConfigRevision` is recorded on every new differentiated grant; `assessmentPresentationRevisionId` only when the index is bound and its `assessmentRevisionId` equals the assignment's frozen revision. The grant does not repeat `assessmentRevisionId`: the record carries it immutably and begin verifies it against the assignment. The grant pair invariant refuses either field on a `canonicalFallback` grant. The 6-hour TTL is unchanged. The index binding and both identities are never returned to the client.
- **Session and attempt:** `assessmentPresentationRevisionId` and `accommodationConfigRevision`. Frozen at begin from the grant and copied verbatim at finalize, exactly like `presentationRevisionId`.

The artifact embeds the same `assessmentPresentationRevisionId` (and `assessmentRevisionId`) in its binding block, and the manifest entry records it (section 11), so the artifact and the record cannot silently diverge. The artifact cannot embed its own `presentationRevisionId`, which is the hash of its bytes; that identity is carried by the served path and the manifest entry.

---

### 9. Show Your Thinking

**9.1 Delivery.** The adapted prompt and model answer are generated into the variant's `#el-think`-equivalent block from the presentation record. The Show Your Thinking V2 pipeline is unchanged:
- textarea;
- `lessonQuiz.finalize(selections, { writtenResponse })`;
- session `writtenResponse`;
- attempt `writtenResponse`;
- `assessmentAttemptGetForTeacher`.

**9.2 Evidence equivalence.**
- The canonical and adapted prompts must require the same evidence: the same causal chain or claim-evidence-reasoning, and the same scaffold term.
- `requiredTerms` (for example `convection` for Earth's Layers) must appear in both prompts. The build checks this.
- Equivalence of the evidence demand is a human certification item.

**9.3 Provenance.** The prompt the student saw is pinned by `assessmentPresentationRevisionId`. The response stays attached to the same session and attempt, and teacher visibility and history are unchanged.

**9.4 Backlog, retained and separate.** Canonical Show Your Thinking prompts have no historical version identity, because canonical lessons are unversioned. The Earth's Layers canonical remediation changed canonical text. This addendum does not solve it. The natural later fix is to give canonical lessons a canonical assessment presentation record (slice 9).

---

### 10. Explanations

Student-facing explanations may be adapted.
- They must preserve scientific meaning, instructional intent, and answer rationale.
- They must not add information that changes what earns credit.
- They are pinned by `assessmentPresentationRevisionId`.
- The canonical explanation in the answer key (and therefore in `itemResults`, which teachers see today) is unchanged.

Teacher views that later show the adapted explanation must read it from the presentation record.

---

### 11. Build and publish validation

**Authoring source (new):** `lesson-sources/variants/<slug>.<variantKey>.assessment.json`, never served.
- Holds, per canonical item: adapted stem, directions, displayed options (by canonical `optionId`, in display order), the omitted `optionId` with its rationale, the adapted explanation, and the Show Your Thinking block.
- The build generates the variant's quiz literal, think box, and explanation text from it.
- The quiz region of the variant HTML is **generated, never hand-edited**. This replaces the rule that the variant quiz must be identical to the canonical quiz (`variantSource.cjs:122-135`) for profiles whose traits differ from canonical.

**Mechanical checks (build fails):**
1. The linked `assessmentRevisionId` exists as a committed payload, and it is the one the canonical quiz is faithful to (existing fidelity).
2. Item set and order equal the revision's (`itemId`s identical, canonical order).
3. Every displayed `optionId` exists in that item's canonical options, and none is duplicated.
4. The correct option (from the committed payload) is displayed on every item.
5. `displayedOptions.length === traits.choiceCount`. For `choiceCount: 3` on a four-option item, exactly one `omittedOptionId` exists, it is a distractor, and it has a non-empty rationale.
6. `displayedOptions` together with `omittedOptionIds` equals the canonical option set.
7. Adapted text is present for every stem and option. **As implemented (Slice 6A):** no schema field records an unchanged string. The review tooling lists every student-facing string identical to canonical (exactly, or after case, whitespace and punctuation are ignored, or because the record leaves it `null`) in the owner-review packet, with the author's reason when an authoring note gives one. It is review information, never a failure; an author reason for a string that is no longer identical fails as stale.
8. Show Your Thinking and explanation wiring are identical to canonical (element ids, textarea, model reveal, `finalize` call, per-item feedback), and `requiredTerms` is present in the adapted prompt. **As implemented (Slice 6A):** every required term must also be present in the canonical prompt (`requiredTermEquivalence`); the renderer reads the lesson's locked canonical prompt and refuses otherwise, and the review tooling reports both sides.
9. Answer-leak heuristics, which fail or warn and are always listed for the reviewer:
   - the correct choice is not uniquely the longest (length ratio at or above 1.5 of the next longest fails);
   - the stem shares no distinctive content word only with the correct choice;
   - no `correct`, `answer`, or similar marker text.

   **As implemented (Slice 6A, `assessmentPresentation.cjs` `itemCueFindings` / `answerCueFindings`, run inside `validateAssessmentPresentation`).** Hard (fails an adapted-language presentation): `LENGTH_CUE`, the correct choice is uniquely the longest displayed choice at a character ratio of 1.5 or more to the next longest; `ANSWER_MARKER`, a displayed choice contains correct / incorrect / answer(s) or a check, cross or star symbol. Warnings (always listed): `LENGTH_LONGEST` (uniquely longest at a ratio of 1.3 to below 1.5); `STEM_ECHO` (a stem word of 4+ letters, not a stop word, appears in the correct choice and no displayed distractor; words match on a shared prefix of 4+ letters covering all but at most 2 letters of the shorter word); `ABSOLUTE_QUALIFIER` (a distractor uses always / never / only / all / none / every / exactly / completely / entirely / no and the correct choice uses none); `ALL_NONE_OF_ABOVE`; `ARTICLE_AGREEMENT` (stem ends in "a" or "an" and only the correct choice agrees); assessment-level `LONGEST_ANSWER_BIAS` (correct uniquely longest on more than ceil(n / k) items). Under canonical language the wording is the canonical revision's, so every cue is a warning. Each finding is also computed on the canonical four-choice item, so the reviewer sees whether a cue is inherited or introduced (for example by which distractor was omitted).
10. The generated quiz literal's `correct` index points at the display position of the canonical correct `optionId`.
11. Answer-position quality standard (section 13) on the presentation's display positions.
12. `assessmentPresentationRevisionId` is recomputed from the source and embedded in the artifact. The deterministic double build and drift check (existing) pass.
13. A human certification record exists whose `assessmentPresentationRevisionId` equals the computed id (section 12).

**Publish checks (`publish-variant`, fail closed; implemented in Slice 5):** the retained-revision loader reconciles the manifest entry, the one Slice 3 certification check, and the binding block embedded in the artifact bytes (`reconcileAssessmentBinding`; an unbound entry whose artifact carries a block is refused too). LOCAL_VERIFIED then re-derives the record's id from its content and checks the binding against the deployed `currentRevisionId`, before any Hosting or Firestore side effect. A new stage, `ASSESSMENT_PRESENTATION_RECORDED`, creates `assessmentPresentations/{id}` or verifies an identical existing document (never updated or deleted) after the hosted bytes are proven and before `INDEX_UPDATED`. The index `.set()` writes the binding; repointing to an unbound revision removes it. The Slice 3 refusal (`refuseUnpropagatedAssessmentBinding`) is replaced by these checks.
- The manifest entry's `assessmentRevisionId` equals the deployed `assessments/<id>.currentRevisionId`.
- The presentation record is created, or verified equal, before the index is repointed. This extends the existing LOCAL_VERIFIED > HOSTING_DEPLOYED > HOSTED_BYTES_VERIFIED > INDEX_UPDATED sequence.
- The index records `assessmentRevisionId` and `assessmentPresentationRevisionId`.

**Manifest:** new entries add optional `assessmentRevisionId` and `assessmentPresentationRevisionId`. Existing entries, including `prff01d9...375c`, stay valid and are never rewritten. As implemented in Slice 3 (`variantManifest.cjs`): the two fields are both-or-neither, serialized after `publishedAt` only when present (the existing entry reserializes byte-identically), and the entry field set is closed. `verifyRetention` additionally requires a bound entry to name a retained, valid record of the same lesson and assessment revision with an approved certification record. An entry without the fields keeps its F5.2 meaning: differentiated instruction with the canonical assessment presentation. The index carries the same two optional fields (written by the publisher since Slice 5).

---

### 12. Human content certification

Mechanical checks cannot establish:
- concept and standard preservation;
- cognitive demand and rigor;
- scientific accuracy;
- correct-answer equivalence;
- distractor misconception equivalence;
- appropriateness of the omitted distractor;
- absence of subtle cueing;
- Show Your Thinking evidence equivalence;
- explanation equivalence.

**Record (implemented in Slice 3):** `lesson-sources/variants/reviews/<assessmentPresentationRevisionId>.json`, never served, validated by `validateReview`. It is machine-checkable JSON rather than Markdown, so the gate can enforce it:

| Field | Meaning |
|---|---|
| `schemaVersion` | `1` |
| `assessmentPresentationRevisionId` | The exact presentation certified |
| `reviewer` | `{ role, reviewerId }`: a generic role (for example `scienceContentReviewer`) and an opaque reviewer identifier; no person is hardcoded |
| `reviewedAt` | ISO-8601 UTC timestamp |
| `determination` | `approved`, `changesRequested`, or `rejected` |
| `criteria` | One entry per criterion above (`scientificAccuracy`, `standardAndLearningTargetPreserved`, `cognitiveDemandPreserved`, `correctAnswerEquivalence`, `distractorMisconceptionEquivalence`, `omittedDistractorAppropriate`, `noAnswerCueing`, `showYourThinkingEquivalence`, `explanationEquivalence`), each `{ result: pass \| fail \| notApplicable, notes? }` |
| `items[]` | One `{ itemId, result: pass \| fail, notes? }` per presentation item |

Applicability is computed from the record: `omittedDistractorAppropriate` applies only when a distractor is omitted, `showYourThinkingEquivalence` only under adapted language, and `explanationEquivalence` only when adapted feedback exists. An applicable criterion cannot be `notApplicable`, an inapplicable one must be, and an `approved` review cannot contain a failed criterion or item.

The build requires `determination: approved` bound to the exact computed `assessmentPresentationRevisionId`. Any content change produces a new id, so the prior approval no longer applies.

---

### 13. Answer-position quality standard

**Audit (read-only, 49 committed payloads at `176fe27`; all are 10 items x 4 options except body-systems, which has 15).**

- The rule exists in writing: CLAUDE.md QUIZ RULES ("Distribute correct answer positions (A, B, C, D) evenly"), `HQIM_LESSON_FRAMEWORK.md:352`, and lesson edu-notes.
- A manual rebalance commit, `97777dc` "Rebalance assessment answer positions" (2026-09-02), fixed 8 lessons two hours before the production deployment of 48 revisions.
- **No automated check exists, and none was removed.**
- Earth's Layers r1 was the Sprint 17 pilot. It was deployed separately on 2026-07-28 and last changed 2026-07-21, before the rebalance pass. So it is an escaped legacy item, not a regression.
- 43 of 49 are balanced (max-min spread at most 1).

Outliers:

| Lesson | Distribution | Spread | Longest run | Concern |
|---|---|---|---|---|
| earths-layers | A2 B7 C1 D0 | 7 | 4 (`CBBBBABABB`) | severe; D never correct |
| organelles | A0 B2 C5 D3 | 5 | 2 | A never correct |
| design-tradeoffs | A2 B4 C4 D0 | 4 | 2 | D never correct |
| engineering-systems | A3 B4 C3 D0 | 4 | 2 | D never correct |
| technology-and-society | A1 B5 C3 D1 | 4 | 2 | B concentration |
| cell-types | A2 B2 C4 D2 | 2 | 1 | mild |

Periodic patterns (a period-4 cycle matching in at least 80% of positions), balanced but exploitable:
- communication-systems `BACDBACDBA`
- earths-place-in-the-universe `CBDACBDACB`
- ecosystem-stability `BDACBDACBA`
- human-impacts `BDACBDACBD`
- introduction-to-electricity `CABDCABDCB`
- parts-of-an-ecosystem `CADBCADBCA`
- transportation-systems `BCADBCADBC`
- water-cycle `ACBDACBDAC`

**Standard.** For `n` items with `k` displayed options each (applies to canonical payloads and to each assessment presentation's display positions); let `e = n / k`.
- **Hard fail:**
  - any position with 0 correct when `n >= k`;
  - any position count greater than `ceil(e) + 1`;
  - spread (max minus min) of 3 or more;
  - three or more consecutive identical correct positions.
- **Warning** (listed in build output and in the review record):
  - spread of exactly 2;
  - a periodic cycle of period at most `k` matching at least 80% of positions.
- **Target:** spread at most 1, no run above 2, no visible cycle.
- Authored distributions are designed, not randomized. Presentation-time shuffling is not used, because it would break provenance and review.

**Enforcement (ratchet), as implemented in Slice 1.**
- **Module:** `app/scripts/lessonBuilder/assessmentQuality.cjs`. It evaluates the displayed position of each item's correct option (its index in authored option order).
- **Gate:** `npm --prefix app run assessments:verify` (`app/scripts/verify-assessment-quality.cjs`), which is part of `npm --prefix app run verify`. The jest suite `assessmentQuality.test.js` runs the same repository check under `npm test`.
- **Debt register:** `app/scripts/lessonBuilder/assessment-quality-allowlist.json`. It has 14 entries: the 5 hard failures, cell-types (spread of two), and the 8 periodic lessons. Each entry is pinned to its payload file and exact correct-position sequence, with its findings and a reason.
- **Shrink-only, enforced mechanically:**
  - An entry must match the frozen `LEGACY_DEBT_BASELINE` in the module, so the register cannot grow without editing the check itself.
  - Only `r1` payloads can be debt; an `r2` or later revision must always pass.
  - An entry fails if its payload's sequence changes (deployed revisions are immutable), if it is stale (no findings remain), if its findings differ from the current ones, if it is duplicated, if it names no committed payload, or if it has no reason.
- **Failure behavior:** an unrecorded hard finding fails. Warnings are always printed (as `DEBT` when recorded, `WARN` when new) and never fail.
- **Structural refusals:** a quiz with a non-uniform option count, or a correct option missing from its item, fails closed; the standard needs an explicit extension before mixed quizzes are allowed.
- **Presentations:** Slice 3 applies `evaluateDistribution` to each assessment presentation's display positions.
- **Target (D3):** zero entries. Every entry is assessment-quality debt, removed only through a compliant new canonical revision.

**Earth's Layers r1** is never edited in place. See 17.3 for the r2 path.

---

### 14. Fail-closed and security behavior

**14.1 Resolution and launch** (extends F5.2 sections 7-8):

| Condition | Outcome |
|---|---|
| Accommodation active, delivery disabled | `canonicalFallback` grant, reason `operationalDisable` (unchanged; proven in C4) |
| No active index, or retired index | `canonicalFallback` (coverage gap, unchanged) |
| Active index WITHOUT an assessment-presentation binding | Differentiated instruction with the canonical assessment presentation: the F5.2 meaning, preserved for existing indexes (owner direction, Slice 5; this supersedes the earlier row that made an unbound index a coverage gap). Requiring a presentation per profile would be a future policy switch |
| Half, malformed, or other-lesson binding on the index | Malformed index: `canonicalFallback` with defect telemetry at resolution; `BEGIN_VALIDATION_UNAVAILABLE` on the no-launch-ref begin path |
| Index `assessmentRevisionId` differs from the assignment's frozen `assessmentRevisionId` | `canonicalFallback`, new reason `coverageAssessmentMismatch`, with telemetry |
| Presentation record missing, altered (id mismatch), for another lesson, or for another `assessmentRevisionId`, at begin | Begin refused, `LAUNCH_REF_INVALID`, no session (no silent canonical freeze, F5.2 P1 posture); a failed read is `BEGIN_VALIDATION_UNAVAILABLE` (retriable). A grant with malformed provenance is `LAUNCH_REF_INVALID` |
| Artifact hash mismatch at publish | Publish refused (existing) |
| Invalid mapping, omitted correct option, duplicate or unknown `optionId` in source | Build fails; the presentation cannot exist |
| Variant retired before launch | `canonicalFallback` (existing) |
| Variant retired or replaced after session start | The frozen session completes on its presentation, which stays retained and immutable |

**14.2 Responses.**
- An unknown `optionId`, or a canonical `optionId` not displayed in the frozen presentation (for example the omitted distractor), is rejected by autosave and refused at finalize. Nothing is scored.
- The client cannot name a presentation (forbidden begin keys, existing), cannot supply correctness (the key is server-only), and cannot change the displayed set (it is frozen server-side).

**14.3 Known pre-existing property (out of scope).** Lesson pages include each question's correct index in the quiz literal, for instant feedback in practice mode. This addendum does not change it. It is recorded here so "no answer leakage" is not over-claimed: build leak checks concern wording and structure cues, not client data. Removing it is a separate owner decision.

---

### 15. Attempts, best score, Current, and Classroom

**Score comparability (explicit).** Three-choice and four-choice presentations are **not psychometrically identical**:
- The chance baseline rises from 25% to 33.3% per item, so the expected score from pure guessing goes from 2.5 to 3.33 out of 10.
- Partial-knowledge elimination is also easier.

The owner's policy is that this is an intentional accommodation, scored on the same scale:
- raw score and `maxScore` unchanged;
- `percentage` unchanged;
- no adjustment.

This is technically coherent, because every item is scored against the same canonical key with the same points.

**Behavior:**
- **Cumulative attempts, best score (`best-attempt.ts`), Current reconciliation:** unchanged. Attempts are compared by `percentage` regardless of presentation.
- **Classroom passback:** unchanged; it uses the best `percentage` and never reads delivery fields (F5.2).
- **Provenance:** every attempt records `assessmentPresentationRevisionId` and `accommodationConfigRevision` when accommodated, so reduced-choice use is always determinable.
- **Teacher reporting (recommended; owner decision D2):** attempt detail shows a neutral label such as "Accommodated presentation: adapted language, 3 choices", resolved from the presentation's traits. Students see no label.

**Changing conditions between attempts** (each new session resolves freshly; nothing already frozen changes):

| Scenario | Result |
|---|---|
| Attempt 1 canonical (4 choices), attempt 2 accommodated (3 choices) | Two attempts on the same revision, each with its own provenance; best score takes the higher `percentage` |
| Accommodation changed or deactivated between attempts | The next launch resolves from the new configuration; earlier attempts keep their `accommodationConfigRevision` |
| Variant or presentation republished between attempts | The next launch gets the new ids; earlier attempts point at retained records |
| Delivery flag turned off between attempts | The next launch is `canonicalFallback` with four choices; an already-begun session completes as frozen |

---

### 16. F5 / F5.2 changes and preserved invariants

**Intentional scope expansion (supersedes F5.2 section 2 "Does not ship"):**
- "differentiated assessment content" now ships;
- "reporting changes" becomes a minimal provenance label only (D2).

**Architectural changes required by reduced choice:**
- Responses carry canonical `optionId` values from a presentation table rather than an index-derived letter, for presentation-bound lessons.
- Server-side response-membership validation.
- The new immutable `assessmentPresentations` record family, with an explicit deny-all Rules block (**Firestore Rules change**).
- New optional frozen fields on the index, grant, session, and attempt (section 8).
- F5.2 section 5 build contract: the quiz region of a trait-differing variant is generated from the presentation source, not required to equal canonical.

**Unchanged:**
- one assignment per class and lesson;
- Current Assignment architecture and the `assignmentsCurrent` pointer;
- cumulative attempts;
- cumulative best performance;
- the Classroom grade destination is Current;
- append-only history;
- `configRevision` CAS;
- immutable content-addressed presentation revisions and the append-only manifest;
- launch-grant security, including server-issued, assignment-bound grants and forbidden client delivery keys;
- 6-hour grant expiry and TTL;
- session creation as the sole freeze point;
- fail-closed operational disable;
- canonical scoring identity;
- no Classroom change;
- F5.2's single accommodation service.

---

### 17. Backward compatibility and Earth's Layers migration

**17.1 Compatibility.** No migration of historical data is required.
- Canonical attempts and pre-feature attempts carry no new fields. Absent fields mean the canonical four-choice presentation.
- The C6 attempt (`prff01d9...375c`, no `assessmentPresentationRevisionId`) is interpretable as "adapted instruction, canonical four-choice assessment", which is exactly what it was.
- Canonical lessons keep the index-derived letter responses.
- New fields are optional everywhere.

**17.2 Earth's Layers new presentation revision.**
- `prff01d9...375c` stays retained and immutable in the manifest and on Hosting.
- Author `lesson-sources/variants/earths-layers.reading-adapted.assessment.json`, linked to `assessment_earths-layers__r1`. Per item:
  - an adapted stem;
  - three displayed options, including the correct one;
  - one reviewed omitted distractor;
  - an adapted explanation.
- Include the adapted Show Your Thinking prompt and model answer, with `requiredTerms: ["convection"]`.
- Author the review record (section 12).
- Build a new content-addressed revision `pr<new>` embedding `ap<new>`, and append a manifest entry.
- The display order must meet section 13 for three choices: target correct counts of 3/3/4 across display positions. This makes the adapted presentation well distributed even though canonical r1 is not.
- Publish on staging first; rollback is republishing `prff01d9...375c`.

**17.3 Canonical Earth's Layers r2 (answer distribution).**
- Deployment supports r2 (strictly increasing ordinal; `currentRevisionId` advances).
- **Delivery does not yet support it safely.**
  - Assignments freeze `assessmentRevisionId` at publish (`assignments-publish.ts:255-260`), but a lesson renders a single unversioned quiz.
  - Rebalancing the canonical quiz to r2 would make every Earth's Layers assignment already stamped r1 display r2's option order while being scored against r1's key.
  - The S0 staging resolver and the fidelity suite also assume one committed revision per lesson.
- **Required path:**
  1. Ship slice 9 (canonical assessment presentation records, which make the rendered quiz revision-bound).
  2. Commit `earths-layers.r2.json` beside the retained `r1.json`, with a balanced, professionally designed order.
  3. Update the resolver and fidelity suites for "each committed revision has a faithful presentation".
  4. Deploy r2.
  5. New assignments get r2 at publish; r1 attempts remain interpretable forever.
- An interim operational alternative (retiring or republishing every r1-stamped Current Earth's Layers assignment at cutover) is an owner decision (D5). It is not recommended.

---

### 18. Staging certification (C7, after implementation)

On `lyfelabz-staging`, with the same controlled pair and a fresh Earth's Layers attempt:

1. **Flag off:** `canonicalFallback`; a four-choice canonical quiz; no presentation fields.
2. **Flag on:**
   - the new grant carries `pr<new>`, `ap<new>`, and `accommodationConfigRevision`;
   - the artifact hash matches;
   - the quiz shows three choices with adapted wording.
3. The first answer creates a session that freezes both ids.
4. **Negative test (driver):** autosave of the omitted distractor's `optionId` is rejected; an unknown `optionId` is rejected.

   **Driver (C7-E):** `platform/functions/src/scripts/staging-f53-assessment-negatives.ts`, reusable for any bound lesson.
   - **Staging only.** It requires the literal `--project=lyfelabz-staging`, refuses a conflicting `GCLOUD_PROJECT` or `GOOGLE_CLOUD_PROJECT` and any emulator variable before network activity, calls only the staging `callableUrl`, and has no production flag.
   - **Authentication.** It reuses the certified staging token path (`createAstra004StagingIdToken`): the ADC principal needs `roles/iam.serviceAccountTokenCreator` on `lyfelabz-staging@appspot.gserviceaccount.com`, and `STAGING_WEB_API_KEY` is supplied at runtime. Signing in with the custom token updates the student's Auth last-sign-in metadata. Tokens and the launch reference are redacted from output.
   - **Plan mode (default).** Firestore reads only: it verifies the grant (owner, assignment, differentiated provenance, more than 10 minutes left), the assignment's frozen revision, the AP document (with the server's `checkAssessmentPresentationDoc`) and the bound index, then derives the omitted and unknown option from the verified record and the deployed revision, and prints every planned request. It never mints a token or calls a callable.
   - **`--execute`.** Runs, in order:
     - begin with forged provenance and no `launchRef` (refused);
     - E1: begin with the student's grant, then one autosave of the item's first displayed option; the session must freeze the grant's `presentationRevisionId`, `assessmentPresentationRevisionId` and `accommodationConfigRevision`, plus the assignment's revision;
     - E2: autosave of the omitted distractor (`assessmentSessions.invalidResponses`);
     - E3: autosave of an unknown option (same code);
     - E4: autosave and begin with `assessmentPresentationRevisionId`, `displayedOptions` or `displayedOptionIds` (`assessmentSessions.invalidRequest`);
     - E5: finalize with forged provenance (`assessmentAttempts.invalidRequest`).

     Every finalize request also carries a malformed idempotency key, so no request the driver builds can score, create an attempt or delete the session.
   - **Expected live mutations:** one session created by E1 and one stored response (an existing live session is kept as the baseline, never overwritten), and the Auth sign-in metadata. Nothing else.
   - **Pass criteria.** After every refusal the session's update time and responses must be unchanged. At the end the student's attempts, the assignment's passbacks, the Current Assignment pointer and the student's launch grants must be exactly as before, with one live session left for submission (C7-F). Exit 0 means every check passed.
5. **Submit:**
   - the attempt records both ids and `r1`;
   - an independent rescore against the r1 key matches;
   - reconstructing the displayed wording from `ap<new>` matches what was rendered.
6. The historical C6 attempt on `prff01d9...375c` remains unchanged and interpretable.
7. Best score over the mixed attempts equals the maximum `percentage`; there is no passback on the unlinked class.
8. Production is untouched.

### 18.1 C7 certification record: Earth's Layers (COMPLETE, PASSING)

**Result: F5.3 Earth's Layers staging certification C7-A through C7-F is COMPLETE and PASSING** (`lyfelabz-staging`, 2026-09-27 23:25Z to 2026-09-28 00:57Z). Production was neither read nor changed.

**Certified configuration**

| Field | Value |
|---|---|
| Canonical assessment revision | `assessment_earths-layers__r1` (unchanged; all 49 canonical payloads and answer keys unchanged) |
| Differentiated instructional presentation | `pr90f52136d39f36d21bf1602d0af3901adf0eae32a046c522907c5e932f342189` |
| Assessment presentation | `ap1fed478c9e4ad8335946ff7f7b165df657bafc48e8c5990d922419581fa02c25` (owner-certified; review record `lesson-sources/variants/reviews/<id>.json`) |
| Traits | language `adapted`, 3 displayed choices |
| Accommodation `configRevision` used | `1` (test student, Reading Accessibility active, level adapted) |
| Release commit (C7-A, C7-B) | `06a46ca` (clean detached worktree, real `npm ci` installs) |
| Driver commit (C7-E) | `cbe0225b832edaa04d6f47ca0dfcef1e466d2535` (clean detached worktree) |

**Evidence by step**

- **C7-A (infrastructure).** Staging was verified read-only to be running `176fe27`. From the clean `06a46ca` worktree:
  - Firestore Rules only (`firestore:rules`): the active ruleset is byte-identical to `06a46ca` and includes the `assessmentPresentations/{id}` deny-all block. Unauthenticated get and list return 403. Indexes and TTL are unchanged.
  - Exactly the five F5.3 Functions (`assignmentsListForStudent`, `lmsDeepLinkResolve`, `assessmentSessionsBegin`, `assessmentSessionsAutosave`, `assessmentAttemptsFinalize`): each deployed source archive is identical to `06a46ca`. The other 65 Functions were not redeployed, and the Classroom secret binding on finalize was retained.
  - Hosting was not deployed in this step.
- **C7-B (publication).** `publish-variant --target=staging` ran from the same worktree through LOCAL_VERIFIED, HOSTING_DEPLOYED (Hosting version `ec2f3373c0bd596c`), HOSTED_BYTES_VERIFIED, ASSESSMENT_PRESENTATION_RECORDED (created) and INDEX_UPDATED.
  - The hosted `pr90f…` bytes hash to their id, and the runtime bundle matches the release.
  - Every repository-backed served file equals `06a46ca`; no uncommitted owner work was served.
  - `assessmentPresentations/ap1fed…` hashes to its id and is byte-equal to the retained record.
  - The index `presentationVariants/earths-layers__reading-adapted` is active and bound to `pr90f…`, `ap1fed…` and r1.
  - Historical `prff01d9…375c` remained served, byte-identical and retained.
- **C7-C (fresh launch).** After the last `prff01` grant expired, the student launched Earth's Layers through My Science.
  - `assignmentsListForStudent` issued a new differentiated grant: `reading-adapted`, `pr90f…`, `ap1fed…`, `accommodationConfigRevision: 1`, a 6-hour TTL, and the correct student, assignment and lesson.
  - r1 is established by the assignment's frozen revision, the index binding and the AP record.
  - No session or attempt was created by launching.
- **C7-D (browser rendering; owner observation plus served-byte checks).**
  - The adapted instruction rendered normally, with no fallback.
  - The quiz showed 10 items, each with exactly 3 choices, and the approved q2 (Differentiation / Convection currents / Erosion), q4 ("It is a liquid layer made of iron and nickel") and q9 wording.
  - The adapted Show Your Thinking prompt appeared.
  - No fourth option, omission rationale, or reviewer or certification metadata was present.
  - The binding block names r1 and `ap1fed…`, and its canonical option ids match the certified display order (`BCD BAD ACB ACB BAC BAC BAC BDA ABD CDB`).
- **C7-E (adversarial; staging-locked driver `staging-f53-assessment-negatives.ts` at `cbe0225`).**
  - 44/44 driver checks passed, and 17/17 adversarial calls were refused with the exact expected code:
    - 7 forged begin fields (`assessmentSessions.invalidRequest`, with the session count still 0);
    - the canonical but omitted q1 option `A` and the unknown q1 option `Z` (`assessmentSessions.invalidResponses`);
    - 3 autosave provenance forgeries (`assessmentSessions.invalidRequest`);
    - 5 finalize provenance forgeries (`assessmentAttempts.invalidRequest`, each with the malformed idempotency-key backstop).
  - The legitimate session `a-earths-layers-uwxg1a0yiyq4ts5ctejs-kpckdzwx0hyhvc-ubjz9g7iq35q__NmxK5iDDdhcXYbOECyOFHu26AOb2__1` froze r1, `differentiated`, `reading-adapted`, `pr90f…`, `ap1fed…` and `accommodationConfigRevision: 1`.
  - No refusal changed the session (same update time and responses). No attempt, passback, launch grant or Current Assignment change occurred.
  - After C7-E the session held only q1 = `B`, chosen by display order and never by correctness.
- **C7-F (normal completion in the real browser).**
  - The page reused the same session, and its autosave replaced the placeholder with 10 displayed-option responses (q1 C, q2 A, q3 C, q4 A, q5 A, q6 B, q7 B, q8 A, q9 D, q10 B); no omitted option was submitted.
  - One browser submit created exactly one new attempt: `a-earths-layers-uwxg1a0yiyq4ts5ctejs-kpckdzwx0hyhvc-ubjz9g7iq35q__NmxK5iDDdhcXYbOECyOFHu26AOb2__a2`, attempt number 2.
  - Score 4/10 = 40% (maximum 10, 1 point per item), shown in the browser. An independent rescore against the deployed r1 key also gave 4/10.
  - The attempt retains `reading-adapted`, `pr90f…`, `ap1fed…`, `accommodationConfigRevision: 1` and r1.
  - The session was consumed at finalize.
  - The product's `selectHighestCompletedAttempt` selects `a2` (40%) over C6 (2/10, 20%).
  - The written response persisted on `a2` only.
  - Nothing reached Classroom (no link, no passbacks). The Current Assignment pointer, the AP record, the index and the assignment were unchanged.
  - Submitted Show Your Thinking text (certification test content): "First is the crust at the surface. Then comes the mantle, the outer and then inner core." It does **not** contain the requested word `convection` and does not follow the prompt. C7-F certifies only that the student's text was captured and stored, not its quality or its compliance with the prompt.

**Historical distinction (preserved).** C6 (`…__a1`) is differentiated instruction with the canonical four-choice r1 assessment. It uses `prff01d9…375c` and has no `assessmentPresentationRevisionId` or `accommodationConfigRevision`, and it is unchanged by C7. C7-F (`…__a2`) is differentiated instruction with the certified three-choice presentation, using `pr90f…` and `ap1fed…`. Both are scored against the same r1 key.

**What C7 certifies:**
- revision-bound differentiated assessment presentation, with adapted language and three displayed choices;
- authoritative server validation of displayed options, including rejection of omitted and unknown choices;
- rejection of client-forged presentation provenance at begin, autosave and finalize;
- canonical scoring against the frozen r1;
- attempt provenance;
- normal browser submission;
- compatibility with cumulative attempts and best performance;
- storage of the Show Your Thinking text;
- no unintended Classroom, passback or Current Assignment change.

**What C7 does not certify:**
- psychometric equivalence of the three-choice and four-choice forms (section 15: same scale by policy, D1);
- semantic grading of Show Your Thinking;
- anything outside Earth's Layers.

**Not part of this certification (remaining work):**
- revision-bound canonical assessment rendering and Earth's Layers r2 (slice 9; section 17.3);
- D2 teacher-visible neutral accommodation label (slice 10);
- D7 lesson-page answer-data hardening;
- rollout beyond Earth's Layers;
- production activation and certification (section 19).

The staging differentiated-delivery flag remains `true` by owner decision D8. Production differentiated delivery is outside this certification.

---

### 19. Production implications

Eventual deploy surfaces, each separately authorized:
- **Functions:** resolver, grant, begin, autosave, finalize, publisher.
- **Firestore Rules:** the `assessmentPresentations` deny block.
- **Hosting:** runtime bundle and new artifacts.
- **Production publication:** a new Earth's Layers presentation revision.

No index or TTL changes are expected.

Production is paused at C3 with `prff01d9...375c` published. Whether production C4-C6 proceeds with the presentation-only revision or waits for F5.3 is owner decision D6.

---

### 20. Implementation slices (dependency order)

| # | Slice | Surfaces |
|---|---|---|
| 1 | `assessmentQuality` check + ratchet allowlist (section 13) | `app/scripts/lessonBuilder`, `lessons:verify` |
| 2 | Server response-membership validation for all sessions (7.1) | `assessment-sessions-autosave.ts`, `assessment-attempts-finalize.ts` |
| 3 | **Implemented.** Presentation record schema, canonical serialization and content-addressed id, retained-record verification, validation against the canonical revision (section 11 checks 1-8, 10-11), certification-record schema, optional manifest binding (verified in `verifyRetention`, which the publisher runs), `assessmentPresentations` deny-all Rules block, and a publisher refusal for bound revisions until slice 5. Deferred: generating the variant quiz HTML from a record and embedding its id in the artifact (slice 4, since slice 3 must not change student-visible output), and the wording leak heuristics of check 9 (slice 7, with the first real content) | `assessmentPresentation.cjs`, `variantManifest.cjs`, `verify-assessment-quality.cjs`, `publish-variant.ts`, `shared/types/assessment-presentation.ts`, `shared/types/presentation-variant.ts`, `firestore.rules` |
| 4 | **Implemented.** `assessmentPresentationRender.cjs` renders a certified record (checked by the one Slice 3 `checkCertifiedPresentation`) into the instruction-only variant build: the quiz literal is regenerated from the record (stem, displayed choices in display order, display index of the canonical correct option for the lesson's existing instant feedback, record feedback or the canonical explanation), the quiz `section-desc` takes the record directions, the Show Your Thinking prompt, model answer, and textarea accessible name take the adapted block (wiring unchanged), and the binding block is inserted. Omitted options, rationale, traits, and review data never reach the artifact. The variant build runs every F5.2 gate on the instruction-only build first, renders twice (byte-identical), re-runs the no-disclosure check, and records the binding in the manifest entry. The runtime maps by canonical option identity (section 6). The committed runtime bundle `assets/lyfelabz-assessment-runtime-active.js` was rebuilt. Lessons whose quiz literal carries extra per-question fields (today only `nature-of-waves`, `visual`) are refused rather than guessed; lessons without a Show Your Thinking box (`biological-evolution`, `conducting-experiments`) accept only presentations whose Show Your Thinking is `null`. The Slice 3 publisher refusal for bound revisions is unchanged | `assessmentPresentationRender.cjs`, `variantSource.cjs`, `variantBuild.cjs`, `config.cjs`, `assessmentPresentation.cjs`, `app/src/runtime/entry.ts`, `assets/lyfelabz-assessment-runtime-active.js` |
| 5 | **Implemented (with 6, as the owner's Slice 5).** Publisher: reconciliation, record create-or-verify stage, deployed-revision check, index binding | `publish-variant.ts`, `variant-publication.ts` |
| 6 | **Implemented (with 5).** Resolver, grant, begin, autosave, finalize: frozen fields, `coverageAssessmentMismatch`, displayed-set validation, server-side identity re-derivation (`assessment-presentation-identity.ts`) | `resolve-launch-presentation.ts`, `launch-presentation-deps.ts`, `resolve-begin-delivery.ts`, `begin-delivery-deps.ts`, begin, autosave, finalize, `response-validation.ts`, shared types |
| 6A | **Implemented, stopped at owner review.** Review tooling (`assessmentPresentationReview.cjs`, `scripts/assessment-presentation-review.cjs`, `npm --prefix app run assessments:review`): validate a draft, compute and verify its `ap` id and canonical bytes, render an owner-review packet, and render an uncertified local preview (`variantSource.buildUncertifiedAssessmentPreview`: every F5.2 gate, the pure renderer twice, the no-disclosure check; the output is marked, and `generateVariantArtifact` refuses marked bytes). Output goes only to the gitignored `app/dist/assessment-preview/` (refused by the Hosting build) or outside the repository. Draft authored at `lesson-sources/variants/earths-layers.reading-adapted.assessment.json` with authoring notes beside it (`.assessment.notes.json`: per-item correct-meaning and retained-distractor misconception claims, Show Your Thinking evidence comparison, unchanged-text reasons; not part of the identity, never served). No retained record, review record, config binding, artifact, or manifest entry | `app/scripts/lessonBuilder`, `app/scripts`, `lesson-sources/variants/` |
| 7 | **Implemented as Slice 6B (repository only).** Owner-certified `ap1fed478c9e4ad8335946ff7f7b165df657bafc48e8c5990d922419581fa02c25` (review record `lesson-sources/variants/reviews/<id>.json`, reviewer role `owner`, opaque reviewer id); retained record `platform/functions/src/scripts/assessment-presentations/<id>.json`; bound in `earths-layers.cjs` (`variants["reading-adapted"].assessmentPresentationRevisionId`); new retained revision `pr90f52136d39f36d21bf1602d0af3901adf0eae32a046c522907c5e932f342189` with an appended manifest entry carrying the binding. `prff01d9...375c` and its manifest entry are unchanged. Nothing was published: no Firestore, index, or Hosting write was performed (that is slice 8) | `lesson-sources/variants/`, `platform/functions/src/scripts/assessment-presentations/`, `earths-layers.cjs`, `app/lessons/variants/` |
| 8 | **COMPLETE, PASSING (Earth's Layers, 2026-09-28).** Staging C7-A through C7-F; record in section 18.1 | staging only |
| 9 | Later: canonical presentation records (revision-bound canonical quiz; canonical Show Your Thinking provenance), then Earth's Layers r2 | builder, runtime, payloads |
| 10 | Optional: teacher provenance label (D2) | teacher attempt detail |

**Test and certification gates:**
- adversarial tests per mechanical check (omitted correct, duplicate or unknown ids, count mismatch, missing rationale, leak heuristics, stale certification id, distribution violations);
- manifest backward compatibility;
- publisher revision-mismatch refusal;
- resolver and begin mismatch paths;
- autosave and finalize membership rejection, canonical included;
- unchanged best-score and passback suites;
- rules tests for the deny block;
- deterministic double build;
- `npm --prefix app run verify`;
- Functions test, typecheck, lint and build;
- staging C7.

---

### Owner decisions

| # | Decision | Recommendation |
|---|---|---|
| D1 | Confirm the same-scale policy for three-choice attempts (section 15) | Accept; provenance recorded |
| D2 | Teacher-visible accommodation label on attempts | Yes, neutral wording; not student-visible |
| D3 | Answer-position standard thresholds and ratchet (section 13) | Adopt as written |
| D4 | Who certifies adapted assessments, and the review-record location | Owner or designated science reviewer; `lesson-sources/variants/reviews/` |
| D5 | Earth's Layers r2 timing | After slice 9; no cutover workaround |
| D6 | Production C4-C6 on `prff01d9...375c` now, or wait for F5.3 | Owner call |
| D7 | Removing client-side correct-answer data from lesson pages (14.3) | Separate backlog item |
| D8 | Staging delivery flag, currently `true` since C5 | Set false until C7, or leave for continued testing. **Decided:** left `true`; C7 ran with it on (section 18.1) |
