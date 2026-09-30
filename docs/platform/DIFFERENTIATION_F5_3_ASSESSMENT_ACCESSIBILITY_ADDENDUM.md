# LyfeLabz Persistent Student Differentiation

## F5.3 Addendum: Accessible Assessment Presentations

**Status:** Specification addendum to `DIFFERENTIATION_F5_2_IMPLEMENTATION_SPECIFICATION.md` (F5.2). Owner-approved with decisions D1-D8 (section "Owner decisions"). **Slices 1-4 implemented** (answer-position quality gate; server response validation; immutable assessment-presentation records, certification records, manifest binding, and the `assessmentPresentations` deny-all Rules block; build-time rendering of a certified presentation into a lesson artifact and canonical-option-identity mapping in the browser runtime; publication, resolution, and provenance propagation through index, grant, session, and attempt, with displayed-option validation). The owner's Slice 5 covers the table's slices 5 and 6. **Slices 6A and 6B implemented** (owner-review tooling; the Earth's Layers presentation `ap1fed478c...02c25`, owner-certified, retained, bound, and rendered into the new retained revision `pr90f52136...2189`; see slices 6A and 7 in section 20). **Slice 8 (staging certification C7-A to C7-F) is COMPLETE and PASSING for Earth's Layers** (2026-09-28; section 18.1). **Slice 9 (revision-bound canonical assessment rendering) is specified in section 21.** Its owner rulings are recorded, and its normative basis is ratified as PDR-031. Slice 9.0 (documentation reconciliation) is complete. Slice 9A (payload authority and multi-revision tooling, section 21.3) is implemented. Slice 9B (declarations, renditions, variant baseline, path table, Hosting inclusion; sections 21.3 to 21.5) is implemented with no routing or runtime change. Slice 9C-1 (revision-aware server read path and shared coverage evaluator, section 21.6) is implemented with no writes and no client change. Slice 9C-2 (revision-scoped coverage publication, section 21.7) is implemented as repository tooling; scoped r1 and r2 Earth's Layers coverage has since been published with it in staging and production (section 21.12). Slice 9D (revision-bound client routing and runtime integrity, sections 21.4 and 21.5) is implemented. 9E (staging certification C8) is COMPLETE and PASSING (section 18.3). Earth's Layers r2 is authored, owner-approved, certified locally, and staging-certified through Stages A and B, with live r1 and r2 coexistence (section 21.12). In production, the P1-P4 catch-up, Phase A/B coverage publication, and Phase C (differentiated-delivery flag enabled, certified with zero accommodations) are complete; Phase D is not performed (section 21.12). Slice 10 is not started. Where this addendum and F5.2 conflict, this addendum governs for assessment presentation only; every F5.2 contract not named in section 16 is unchanged.

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
- Canonical lesson versioning in general. This is the existing F5.2 non-goal; see the backlog note in 9.4. Slice 9 (section 21) binds only the canonical *assessment* display to the assignment's frozen assessment revision. Canonical instruction and the canonical Show Your Thinking prompt remain unversioned.
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
- **Presentation variant index:** `assessmentRevisionId`, `assessmentPresentationRevisionId`. Slice 9C adds revision-scoped index documents on which `assessmentRevisionId` is always present, including for unbound variants (section 21.7). The existing unscoped documents keep this meaning under the legacy rules in 21.7.
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

**9.4 Backlog, retained and separate.** Canonical Show Your Thinking prompts have no historical version identity, because canonical lessons are unversioned. The Earth's Layers canonical remediation changed canonical text. This addendum does not solve it.

**Status (2026-09-27, owner ruling S9-D5): split out of Slice 9 and tracked here as a separate follow-up.**
- The earlier suggestion that slice 9 would provide canonical assessment presentation records is withdrawn from Slice 9's scope.
- Slice 9 binds the canonical *assessment* display to the frozen assessment revision (section 21). Every Slice 9 rendition carries the lesson's current canonical Show Your Thinking prompt, exactly as canonical pages do today.
- A canonical session or attempt therefore still cannot identify which canonical prompt the student saw. Adapted prompts remain pinned by `assessmentPresentationRevisionId`.
- The follow-up must define a canonical prompt identity and how sessions or attempts reference it. It must not create a second assessment-content authority beside the committed revision payloads.
- It is not a prerequisite for Earth's Layers r2 unless r2 authoring changes the canonical prompt. Changing the prompt remains a lesson-content change governed by the ordinary content rules.

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
- The manifest entry's `assessmentRevisionId` equals the deployed `assessments/<id>.currentRevisionId`. **Current implementation; changes in Slice 9C-2 (section 21.7).** The check becomes "the revision is deployed", so that r1 coverage can still be published or rolled back after r2 becomes current. Coverage is never published for an undeployed revision (owner ruling S9-U2).
- The presentation record is created, or verified equal, before the index is repointed. This extends the existing LOCAL_VERIFIED > HOSTING_DEPLOYED > HOSTED_BYTES_VERIFIED > INDEX_UPDATED sequence.
- The index records `assessmentRevisionId` and `assessmentPresentationRevisionId`.

**Manifest:** new entries add optional `assessmentRevisionId` and `assessmentPresentationRevisionId`. Existing entries, including `prff01d9...375c`, stay valid and are never rewritten. As implemented in Slice 3 (`variantManifest.cjs`): the two fields are both-or-neither, serialized after `publishedAt` only when present (the existing entry reserializes byte-identically), and the entry field set is closed. `verifyRetention` additionally requires a bound entry to name a retained, valid record of the same lesson and assessment revision with an approved certification record. An entry without the fields keeps its F5.2 meaning: differentiated instruction with the canonical assessment presentation. The index carries the same two optional fields (written by the publisher since Slice 5). Slice 9C-2 changes the rule for entries appended from then on: every new entry records `assessmentRevisionId`, bound or unbound (owner ruling S9-D2). The only entries allowed without it are a pinned legacy list that can only shrink: `prff01d9...375c`, interpreted under the tested legacy-r1 rule (section 21.7).

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

The rows above describe the current (pre-Slice-9) index. Slice 9 makes coverage resolution revision-aware and shares one evaluator between launch resolution and begin. The revised rows are in section 21.8. In particular, a begin without a `launchRef` whose frozen revision has no coverage becomes a truthful `canonicalFallback` (owner ruling S9-U1).

**14.2 Responses.**
- An unknown `optionId`, or a canonical `optionId` not displayed in the frozen presentation (for example the omitted distractor), is rejected by autosave and refused at finalize. Nothing is scored.
- The client cannot name a presentation (forbidden begin keys, existing), cannot supply correctness (the key is server-only), and cannot change the displayed set (it is frozen server-side).

**14.3 Known pre-existing property (out of scope).** Lesson pages include each question's correct index in the quiz literal, for instant feedback in practice mode. This addendum does not change it. It is recorded here so "no answer leakage" is not over-claimed: build leak checks concern wording and structure cues, not client data. Removing it is a separate owner decision.

This condition contradicts the intended boundary in `ASSESSMENT_PIPELINE_SPECIFICATION.md` §11.2 and `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §15. It remains open as owner decision D7 (`SECURITY_BACKLOG_LESSON_PAGE_ANSWER_DATA.md`). Under owner ruling S9-E1 (PDR-031g), Slice 9 revision renditions temporarily inherit it:
- they carry exactly the `q`, `options`, `correct` and `explanation` fields the canonical quiz literal already carries, and nothing broader;
- D7 is not waived;
- the D7 fix must cover the renditions.

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
- **Required path (superseded 2026-09-27 by section 21; retained for traceability):**
  1. Ship slice 9 (canonical assessment presentation records, which make the rendered quiz revision-bound).
  2. Commit `earths-layers.r2.json` beside the retained `r1.json`, with a balanced, professionally designed order.
  3. Update the resolver and fidelity suites for "each committed revision has a faithful presentation".
  4. Deploy r2.
  5. New assignments get r2 at publish; r1 attempts remain interpretable forever.
- An interim operational alternative (retiring or republishing every r1-stamped Current Earth's Layers assignment at cutover) is an owner decision (D5). It is not recommended.
- **Current path.** Slice 9 is revision-bound canonical *renditions* derived from the committed revision payloads, not canonical assessment presentation records. The finalized sequence is:
  - complete Slice 9 (9A to 9E, section 21.11), which PDR-031h requires before any second deployed revision;
  - then follow the r2 publication sequence in section 21.12.

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

### 18.2 C8 staging certification plan: Slice 9 (authoritative sequence)

C8 runs on `lyfelabz-staging` from the committed Slice 9 release (9A to 9D, HEAD `0b10b2e`), from a clean detached release worktree. No lesson has a second deployed revision during C8 (PDR-031h). The multi-revision behavior (r1 and r2 together) is proven by the unit and integration suites of 9A to 9D and live only in the later r2 sequence (section 21.12). Operational details (commands, credentials, the staging `.env`) are in `DIFFERENTIATION_STAGING_CERTIFICATION_RUNBOOK.md` §3d; this section is the one authoritative C8 order.

Owner decisions (2026-09-28):
- **C8-D1.** Full live scope: a new differentiated attempt `a3` and a `canonicalFallback` attempt `a4`, with the forced runtime mismatch performed on the `canonicalFallback` page before `a4` completes. Attempts are cumulative and are never rolled back.
- **C8-D2.** No practice fixture is created. Assignment-tied practice relies on the committed 9C-1 `lessonPractice` server tests and the 9D synthetic r1/r2 routing tests; live practice certification is deferred to the r2 sequence.
- **C8-D3.** The first scoped record is created with `--op=publish --published-by=lyfelabz-owner-c8` (the publisher's second, identical Hosting deploy is approved). If the scoped record already exists, stop and report it; never repoint it.

Sequence:
1. **Release worktree.** A clean detached worktree at the release commit, which must equal `origin/main`. Real `npm ci` installs. Copy only `platform/functions/.env.lyfelabz-staging`.
2. **Gates and protected bytes.**
   - `npm --prefix app run verify`, the app build, the curated Hosting build and its tests.
   - The Functions test, typecheck, lint and build.
   - `pr90f…` and `prff01…` hash to their ids; the `ap1fed…` record and review record are unchanged.
   - No r2 exists. The artifact carries the path table, the bundled client copy, the gated runtime and the canonical declarations, and no private or source files.
3. **Pre-state snapshot (read-only).** The flag, assignment, Current pointer, accommodation, legacy and scoped coverage (the scoped r1 record must be absent), the AP record, r1 deployment, attempts `a1` and `a2`, sessions, passbacks, Function update times and the Hosting release. Stop on material drift from C7.
4. **Functions.** Deploy exactly `assignmentsListForStudent`, `lmsDeepLinkResolve` and `assessmentSessionsBegin` (the only deployed Functions whose code changed since C7). No autosave, finalize, Rules, indexes, Storage or Hosting. Verify that only those three changed.
5. **Server contract under the old client.** With the C7 Hosting still live, My Science for the test student returns `assessmentRevisionId: assessment_earths-layers__r1` together with `pr90f…` and a launchRef (legacy-bound coverage). Stop if the field is missing.
6. **9D Hosting.** A curated release of the default staging site (`firebase deploy --only hosting`); the predeploy builds run. Functions must already be live (21.10).
7. **Served bytes.**
   - The path table is served and equals the release.
   - The runtime asset and the bundle match the release.
   - The v1 and v2 Earth's Layers pages declare r1.
   - `pr90f…` and `prff01…` are served and hash to their ids.
   - The variant manifest is not served.
   - Record the cache headers.
8. **Scoped coverage.** After re-reading that `…__r1` is still absent, `publish-variant --op=publish` creates `presentationVariants/earths-layers__reading-adapted__r1` for retained `pr90f…`:
   - LOCAL_VERIFIED: r1 from the certified AP; deployed; preflight absent, so create;
   - HOSTING_DEPLOYED: redeploys the identical build;
   - HOSTED_BYTES_VERIFIED;
   - ASSESSMENT_PRESENTATION_RECORDED: identical;
   - INDEX_UPDATED: scoped create.
   The legacy document is not written.
9. **Coverage state.** The scoped record is exact. The legacy record, the AP record and every other `presentationVariants` document are unchanged. From here the scoped record alone decides r1 coverage.
10. **Differentiated acceptance (`a3`).**
    - A My Science launch reaches retained `pr90f…`, shows 10 items with 3 choices each, and binds r1 and `ap1fed…`; the runtime check passes.
    - The staging-locked negatives driver is re-run (C7-E scope) against the new grant.
    - The student then reopens through `/app/a/{assignmentId}` (no Classroom link is added) and submits: `a3` is r1, `differentiated`, `pr90f…`, `ap1fed…`, cfg 1.
11. **Runtime integrity and `canonicalFallback` (`a4`).**
    - With the differentiated session consumed, set the delivery flag to false.
    - A fresh My Science launch reaches the canonical r1 page (declares r1, four choices).
    - Before the first answer, the page's in-memory `lyfelabz-assessment-revision` block is changed to r2. Begin may run, but no autosave and no finalize is sent, the student sees the reopen message, and no attempt is created.
    - A normal reload completes `a4`: r1, `canonicalFallback`, no pair. (Performed in C8 as a fresh My Science open, the recovery the reopen message tells the student to use; see 18.3.)
    - The flag is restored to true and verified.
12. **History and provenance.**
    - `a1`, `a2`, the legacy record, the AP record and review file, the assignment, the Current pointer, and the `prff01…` and `pr90f…` bytes are unchanged.
    - Only the scoped record, `a3`, `a4`, and grants, sessions and audit events were added.
    - No r2, no passback; only the three Functions changed; production untouched.
13. **Final snapshot.**

Superseded wording (C8 preparation, 2026-09-28). The earlier plan read: step 1 "Regression of C7 (r1)"; step 2 "A canonical student launches through My Science and through the Google Classroom deep link"; step 3 "A practice-mode assignment deep link routes to its frozen revision's page"; step 4 "Forced mismatch"; step 5 "The publisher repoints retained `pr90f…` into `presentationVariants/earths-layers__reading-adapted__r1` after re-confirming liveness"; step 6 "History unchanged". It was superseded because:
- S9-D9 makes a first scoped write a create-only `--op=publish`, not a repoint;
- the only recipient is accommodated, so the canonical page is reached through `canonicalFallback`;
- the test assignment has no Classroom link, and `/app/a/{assignmentId}` exercises the same resolver without one;
- no practice assignment exists (C8-D2);
- the plan did not state the Functions-before-Hosting order.

### 18.3 C8 certification record: Slice 9 (COMPLETE, PASSING)

**Result: F5.3 Slice 9 staging certification C8 (section 18.2, steps 1 to 13) is COMPLETE and PASSING** (`lyfelabz-staging`, 2026-09-28 15:41Z to 15:56Z). Production was neither read nor changed, apart from read-only release and Function metadata listings that confirm nothing changed there.

**Release**

| Field | Value |
|---|---|
| Release commit | `0b10b2e` (= `origin/main`), clean detached worktree `lyfelabz-c8-release`, real `npm ci` installs, only `.env.lyfelabz-staging` copied |
| Functions deployed | `assessmentSessionsBegin` 15:41:10.909Z, `lmsDeepLinkResolve` 15:41:11.249Z, `assignmentsListForStudent` 15:41:11.319Z; the other 67 of 70 unchanged |
| 9D Hosting release | version `469d38baef9e34b6`, 15:45:45.352Z |
| Publisher Hosting release | version `b292073a482b032b`, 15:48:00.579Z (file list identical to `469d38…`) |
| Scoped record | `presentationVariants/earths-layers__reading-adapted__r1`, created 15:48:02.211Z, `publishedBy: lyfelabz-owner-c8` |

**Evidence by step**

- **Gates (step 2).**
  - App verify: 133 suites and 3713 tests; 49 lessons; path table, variants and assessments verified.
  - The app build, the curated Hosting build (225 files) and its tests passed, as did the Functions checks (156 suites and 4055 tests, typecheck, lint, build).
  - `pr90f…` and `prff01…` hash to their ids.
  - The `ap1fed…` review record SHA-256 is `4670e199…75a6`, unchanged.
  - No r2 exists.
- **Pre-state (step 3).** Identical to the C8 preparation snapshot and consistent with C7:
  - the flag is true;
  - the assignment is frozen r1, and Current targets it;
  - accommodation cfg 1;
  - the legacy record is bound `pr90f…` + `ap1fed…` + r1, and the scoped record is absent;
  - attempts `a1` and `a2` exist, with no sessions and 0 passbacks;
  - Hosting is `ec2f3373c0bd596c`.
- **Server contract under the C7 client (step 5).** `assignmentsListForStudent`, called as the test student, returned `assessmentRevisionId: assessment_earths-layers__r1` with `pr90f…` and a launchRef. The C7 client launched normally.
- **Served bytes (step 7).**
  - All 218 served files equal the release artifact. The Firebase CLI count of 218 against 225 built is the 7 `blog/**` and `wonderbox/**` files ignored by `firebase.json`.
  - Against C7, the only added path is `/app/lessons/assessment-revisions/revision-paths.json`, and it equals the bundled client copy.
  - The runtime asset carries the gate.
  - v1 and v2 Earth's Layers declare r1.
  - `pr90f…` and `prff01…` are served, hashing to their ids.
  - The variant manifest, `app/src`, scripts, `.env` files and the client table copy return 404.
  - Cache headers: `cache-control: max-age=3600` on the lesson pages, bundle, runtime and path table.
- **Scoped publish (step 8).** The scoped record was re-read as absent, then `--op=publish` passed every stage:
  - ASSESSMENT_PRESENTATION_RECORDED reported "already identical";
  - INDEX_UPDATED was `earths-layers__reading-adapted__r1 create`;
  - the legacy document, the AP record and the other `presentationVariants` documents are unchanged.
- **Differentiated acceptance (step 10).**
  - A My Science launch reached `pr90f…` with query keys `assignment` and `launchRef` only. It showed 10 items with 3 choices each, bound r1 + `ap1fed…`, in display order `BCD BAD ACB ACB BAC BAC BAC BDA ABD CDB`.
  - The negatives driver at `0b10b2e` passed 8/8 in plan (`P0-index`: effective coverage, scoped) and 44/44 in execute:
    - the omitted `A` and the unknown `Z` were refused with `assessmentSessions.invalidResponses`;
    - every provenance forgery was refused;
    - no refusal changed the session, attempts, passbacks, Current or grants.
  - `/app/a/{assignmentId}` auto-navigated to the same `pr90f…` URL, and the runtime went active. As the student, `assessmentSessionsBegin` returned `alreadyLive: true` with r1, and `lmsDeepLinkResolve` returned `pr90f…`, a launchRef and r1.
  - Browser submit created **`a3`** (attempt 3):
    - r1, `differentiated`, `reading-adapted`, `pr90f…`, `ap1fed…`, cfg 1;
    - **3/10 (30%)**, submitted 15:53:24.676Z;
    - the session was consumed, and Current is unchanged.
- **Runtime integrity and `canonicalFallback` (step 11).**
  - The flag was set to false at 15:53:56Z. `assignmentsListForStudent` then returned a launchRef with no `presentation`, bound to r1.
  - A fresh My Science launch reached `/app/lessons/lesson_earths-layers.html` (`assignment`, `launchRef`), declaring r1, with 4 choices.
  - **Forced mismatch.** Before the first answer, only the in-memory declaration was changed to r2; no Firestore, artifact or deployed file was touched.
    - The first click ran begin (200), which created the `canonicalFallback` r1 session (15:54:24.784Z, no `responses` field).
    - The runtime entered its error state, and no autosave was sent.
    - Completing the quiz and pressing Submit sent no finalize and showed: "This assignment needs to be opened again, so your answers were not submitted. Go back to My Science and open the assignment again."
    - Attempts remained `a1`–`a3`.
  - **Recovery.** Following that message, a fresh My Science open reused the live session, passed the gate, autosaved and finalized **`a4`** (attempt 4):
    - r1, `canonicalFallback`, with no variant, presentation, AP or cfg fields;
    - **2/10 (20%)**, submitted 15:55:26.068Z.
    - Its written response is the recovery text, not the text typed on the mismatched page.
  - The flag was restored to true at 15:55:39Z and verified.
- **History and provenance (step 12).**
  - Unchanged: `a1` and `a2` (update times identical), the legacy record, the AP record (hashes to its id, equals the retained record), the review record, the assignment, Current, accommodation, and the `pr90f…`/`prff01…` repository and hosted bytes.
  - Added:
    - the scoped record;
    - `a3` and `a4`;
    - 10 launch grants: 7 differentiated `pr90f…`/`ap1fed…`, and 3 `canonicalFallback`, all from the test student's list and resolve calls;
    - the corresponding audit events (not enumerated).
  - No live session remains.
  - No r2 or r3 exists (`currentRevisionId` r1). There are 0 passbacks.
  - Only the three Functions changed.
  - The latest production Hosting release (2026-09-27 12:27Z) and the latest production Function update time predate C8.
- **Best attempt.** My Science shows "40% · 4/10, 4 attempts": `a2` remains the best attempt.

**Findings recorded (non-blocking)**

- **Browser cache after a Hosting release.** The first My Science load after the 9D release ran the cached pre-9D bundle (encoded 238404 bytes vs 239350) under `max-age=3600`. A hard reload in the pane did not refresh it; a `cache: "reload"` fetch of the bundle, runtime assets and config did. This confirms section 21.10: Slice 9 Hosting must precede any r2 deployment by more than the cache window, and certification browsers must confirm the served bundle before observing behavior.
- **Local score beside a refused submit.** The lesson's existing results reveal is local and precedes finalize (the shared v2 quiz pattern). On the mismatched page it displayed "2/10" above the "Could not submit" message. Nothing was recorded, and the message is correct; whether the local score should be suppressed when a submission is refused is an owner UX decision, outside Slice 9.
- **Practice (C8-D2).** No practice assignment exists, and none was created. Assignment-tied practice routing is covered only by the 9C-1 `lessonPractice` server tests and the 9D synthetic r1/r2 routing tests. Live practice certification moves to the r2 sequence (section 21.12).

**What C8 certifies (r1 only, one deployed revision):**
- the server's frozen revision on the list, the deep link and begin;
- revision-scoped coverage publication (create-only) and its precedence over the legacy record;
- client routing from the bundled path table for differentiated, `canonicalFallback` and deep-link launches;
- the runtime gate refusing every response when the page's revision disagrees with the session, and recovery through a fresh launch;
- no regression of C6 or C7.

**What C8 does not certify:**
- live multi-revision behavior (r1 and r2 together), which is proven only by the unit and integration suites until section 21.12;
- live assignment-tied practice;
- anything outside Earth's Layers;
- production.

The staging differentiated-delivery flag remains `true` (D8).

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
| 9 | Revision-bound canonical assessment rendering and revision-aware coverage (section 21). Replaces the earlier plan of "canonical presentation records (revision-bound canonical quiz; canonical Show Your Thinking provenance)". Show Your Thinking provenance is split out (9.4). Earth's Layers r2 follows Slice 9 (21.12) | see 9.0 to 9E |
| 9.0 | **Implemented (documentation only).** Normative reconciliation: PDR-031, contract §38, pipeline specification §8, §11.2 and §15, and the related documents | `docs/platform/`, `LESSON_BUILD_REFERENCE.md` |
| 9A | Payload authority and multi-revision tooling | `app/scripts/lessonBuilder`, payload conformance |
| 9B | Canonical revision declarations, renditions, variant baseline, revision path table | builder, Hosting manifest |
| 9C-1 | Server read path and shared revision-aware coverage evaluator | resolver, begin, list, deep-link resolve |
| 9C-2 | Publisher and revision-scoped coverage | `publish-variant.ts`, `variant-publication.ts`, manifest |
| 9D | Client routing and runtime verification | launcher, deep-link arrival, assessment runtime |
| 9E | Staging certification C8 (18.2; COMPLETE, PASSING, 18.3) | staging only |
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
| D5 | Earth's Layers r2 timing | After slice 9; no cutover workaround. **Decided:** after Slice 9 (9A to 9E); PDR-031h makes it a gate |
| D6 | Production C4-C6 on `prff01d9...375c` now, or wait for F5.3 | Owner call |
| D7 | Removing client-side correct-answer data from lesson pages (14.3) | Separate backlog item. **Still open.** Slice 9 renditions temporarily inherit the condition (S9-E1, PDR-031g), and the D7 fix must cover them |
| D8 | Staging delivery flag, currently `true` since C5 | Set false until C7, or leave for continued testing. **Decided:** left `true`; C7 ran with it on (section 18.1) |

---

### 21. Slice 9: revision-bound canonical assessment rendering

**Status:** Specified. The normative basis is ratified as PDR-031 (`LYFELABZ_PLATFORM_DECISIONS.md`) and reconciled in `ASSESSMENT_IMPLEMENTATION_CONTRACT.md` §38. 9.0 (documentation) is complete. 9A and 9B are implemented (sections 21.3 to 21.5, build side only). 9C-1 is implemented (section 21.6, server read path). 9C-2 is implemented (section 21.7, publisher; nothing published). 9D is implemented (sections 21.4 and 21.5, client). 9E (C8) is complete and passing (18.3). Earth's Layers r2 local certification is complete; the two-stage staging release is prepared, not executed (21.12). Nothing else in this section is implemented yet unless it says "current".

#### 21.1 Invariant

**The assessment displayed to a student for an assignment corresponds to the assessment revision frozen on that assignment.**

- `assignmentsPublish` freezes `assessmentRevisionId` once, at first publication (current behavior, PDR-031a).
- Sessions freeze that value, autosave validates against it, and finalize scores against it (current).
- Slice 9 extends the binding to what the student sees: canonical renditions, differentiated coverage, launch routing, and a runtime check.
- The client never selects the revision. The server derives it from the assignment.
- Until Slice 9 is certified, no lesson may receive a second deployed revision (PDR-031h). Slice 9 is staging-certified (C8). Deployed state (2026-09-30): in staging and production, Earth's Layers has r1 and r2, `assessment_earths-layers` is current r2, and each project's existing Earth's Layers assignment stays frozen r1; every other production lesson has only r1. Both projects cover r1 and r2 with scoped records (staging Stages A and B; production P1-P4 and Phases A and B, 21.12). Repository: Earth's Layers commits r1 and r2 and declares r2 canonical (release Stage B, 21.12).

#### 21.2 Owner rulings (Slice 9 architecture review, 2026-09-27)

Labels are prefixed `S9-` to avoid confusion with this addendum's D1 to D8.

| # | Ruling |
|---|---|
| S9-D1 | Per-revision accommodation coverage is part of Slice 9. Coverage resolves by lesson, instructional variant, and frozen assessment revision. Historical records stay valid. |
| S9-D2 | New unbound variant publications record their embedded assessment revision. Historical `prff01d9...375c` is interpreted under an explicit, tested legacy-r1 rule. For a lesson with more than one assessment revision, an unbound publication whose embedded revision is unknown or ambiguous is refused. |
| S9-D3 | Assignment-tied practice-mode deep links obey the frozen revision. There is one invariant and no practice exception. Practice not associated with an assignment may use the unversioned current canonical page. |
| S9-D4 | Assessment revision identity may appear in internal lesson paths and machine-readable page data. It is not answer data. No opaque path token is introduced. It is never a teacher-configurable value or teacher-facing UI text (PDR-031f). |
| S9-D5 | Canonical Show Your Thinking provenance is split out of Slice 9 (9.4). |
| S9-D6 | Slice 9 renditions assume compatible quiz chrome across revisions: the same item count and the same quiz section text, progress text and wiring. The renderer is not generalized for structurally different chrome. |
| S9-D7 | (2026-09-28, 9B closure; refines S9-D2 and supersedes one clause of 21.7) Variant artifacts never gain the canonical `lyfelabz-assessment-revision` declaration, because retained content-addressed variants must stay byte-identical. A variant's assessment revision comes from build and publication metadata, in this order: (1) an AP-bound variant's certified assessment-presentation record; (2) a new unbound variant's explicit variant-config `assessmentRevisionId`; (3) only for a historical approved artifact without that metadata, pinned in a shrink-only list (today exactly `prff01d9...375c`), the tested legacy-r1 rule. The artifact's assessment must be proven faithful to the resolved revision. Disagreeing sources, an unknown or uncommitted revision, or a new unbound variant without explicit provenance fail closed. Missing metadata never means r1 for a newly authored variant. |
| S9-D8 | (2026-09-28, 9C-1 closure; supersedes one clause of 21.7 step 4 and one 21.8 row) Malformed effective coverage at launch keeps the certified F5.2 §8.5 row-5 behavior as the canonical rule. Launch returns a truthful `canonicalFallback` grant with defect-severity telemetry, bound to the assignment's frozen revision. The malformed differentiated record is never used for delivery. A read failure stays F5.2 row 8 (canonical, no grant). A begin without a launch reference still refuses malformed coverage with `BEGIN_VALIDATION_UNAVAILABLE`. A malformed scoped record never falls through to the legacy record. |
| S9-D9 | (2026-09-28, 9C-2; supersedes the "full `.set()`" clause of the 21.7 publisher invariants, and F5.2 P5.1 "last publish wins" for new publications) `--op=publish` is create-only for the scoped document. It creates the record, or reconciles an identical one with no write, and refuses any other existing record (a different presentation revision or status is never overwritten). `--op=rollback` is the explicit repoint and the only re-activation of a retired record. It still requires hosted-byte liveness and never crosses lesson, variant key, or assessment revision. `--op=retire` names the assessment revision (`--assessment-revision`) and flips only that scoped record. |
| S9-E1 | Renditions temporarily inherit the existing lesson-page answer-data condition, limited to the fields the canonical quiz literal already carries. D7 stays open and must cover renditions (PDR-031g). |
| S9-E2 | Publish-time freezing is canonical (PDR-031a). |
| S9-U1 | At a begin without a `launchRef`, a legitimate revision-coverage gap resolves to a truthful `canonicalFallback` with telemetry, through the same shared revision-aware evaluator used at launch. Malformed records, unavailable reads, and invalid provenance still fail closed. |
| S9-U2 | Coverage is never published for an undeployed assessment revision. |
| S9-U3 | No new student-facing mismatch notice. A mismatch fails closed through the existing recovery and relaunch experience. |

#### 21.3 Canonical assessment authority and renditions (9A, 9B)

- **Authority.** Each committed payload `platform/functions/src/scripts/assessments/<slug>.r<N>.json` is the authority for its own revision.
  - Today the lesson's quiz literal is the authority and the r1 payload must be faithful to it (`assessmentFidelity.cjs`, `assessment-fidelity.test.js`).
  - After 9A, the lesson config declares which revision the unversioned canonical page renders, and the source literal must be faithful to that revision's payload.
  - Payload validation accepts any ordinal of 1 or more, provided it matches the file name.
  - The answer-position ratchet is unchanged: only r1 may carry recorded debt.
  - **Implemented in 9A** (`assessmentRevisions.cjs`). Every `.json` file in the payload directory must be a strict `<slug>.r<N>.json`. Its `activityId` and `revisionOrdinal` must match the file name. Revision ids and declared ordinals are unique, and a lesson's ordinals are contiguous from r1 (add-only). Any disagreement fails closed.
  - The config field is `canonicalAssessmentRevisionId`. When it is absent, the lesson resolves to r1 only while r1 is its single committed revision, so no config changed. With more than one committed revision, a missing, malformed, foreign, or uncommitted declaration fails closed. Deployed Firestore state is never consulted.
  - The quality gate audits every committed revision under its own file name, so r1 debt never covers r2. The authoring CLI never rewrites a committed revision and authors a later one only with an explicit `--lesson`, `--revision` (the next ordinal) and `--published-by`.
- **Renditions.** For a lesson with more than one committed revision, the build generates one v2 rendition per committed revision, including the current one, at `/app/lessons/assessment-revisions/lesson_<slug>__r<N>.html` (fixed in 9B).
  - A rendition is the current canonical v2 lesson with only the quiz literal regenerated from that revision's payload.
  - It reuses the certified renderer primitives (`assessmentPresentationRender.cjs`: literal location, literal source, post-render verification).
  - A `checkFidelity` post-condition must show the rendition's extracted quiz equals its payload.
  - Instruction and the Show Your Thinking prompt are the current canonical ones.
  - Renditions are deterministic, drift-checked by `lessons:verify`, and retained as long as their payload is committed. Payloads are add-only.
  - Lessons with a single revision produce no rendition files.
- **Answer data (S9-E1).** A rendition's literal carries exactly `q`, `options`, `correct` and `explanation`, as the canonical literal does today. It never carries rubric, rationale, authoring notes, or any field beyond those.
- **Chrome (S9-D6).** A rendition is refused unless the revision's item count and literal shape match what the lesson's quiz chrome supports. Lessons whose literal carries extra fields (for example `visual`) are refused, as the AP renderer already does.
- **Variant baseline.** A variant is built and gated against the canonical rendition of its own declared assessment revision, not against the current source quiz. This keeps `ap1fed…` renderable after the source moves to r2.
  - `pr90f…` must stay byte-reproducible: `variants:verify` green with no new manifest entry.
  - `prff01…` stays retained and unchanged.
- **Implemented in 9B** (`assessmentRenditions.cjs`, `index.cjs`, `variantSource.cjs`).
  - The canonical build now fails unless the v1 and v2 quiz is faithful to the configured revision. It inserts the declaration immediately before the runtime script tag, so every canonical artifact changed by exactly that one line.
  - Renditions are relocated for their directory like variants. The notice names the revision and payload. `lessons:verify` fails on a missing, drifting, or unlisted file in the rendition directory.
  - A variant's revision follows S9-D7: its bound AP record's revision; else the variant config's explicit `assessmentRevisionId`; else the legacy-r1 rule, only when the build reproduces a pinned historical artifact (`LEGACY_R1_UNBOUND_REVISIONS` in `variantSource.cjs`, exactly `prff01…`). A disagreement, an uncommitted revision, or a new unbound variant without an explicit revision is refused. Variant bytes never gain the canonical declaration.
  - When that revision is not the configured canonical one, the baseline is the canonical v2 build with only the quiz literal regenerated. The variant's own literal is used in the comparison only after it is proven to be exactly that revision's quiz. Delivered variant bytes are never normalized.
  - Both `pr90f…` and `prff01…` reproduce byte-for-byte, including with a synthetic current r2 (tests only).

#### 21.4 Revision declaration and runtime verification (9B, 9D)

- **Declaration.** Every canonical v1 and v2 artifact that loads the assessment runtime, and every rendition, embeds one inert JSON block, `<script type="application/json" id="lyfelabz-assessment-revision">`, holding exactly `{ schemaVersion: 1, lessonSlug, assessmentRevisionId }` (fixed in 9B).
  - The block is inserted only in the canonical build path, never in the variant build path, so retained variant bytes are unaffected. Variant revision provenance is build and publication metadata (S9-D7), not HTML.
  - AP-bound pages already declare their revision in the existing `lyfelabz-assessment-presentation` block.
  - The block carries no correctness data.
- **Begin response.** `assessmentSessionsBegin` returns the session's frozen `assessmentRevisionId` (additive). For an already-live session it returns that session's value.
- **Runtime check.** Before sending any response, the runtime compares the page's declared revision with begin's revision. The page's revision comes from the AP block, or else from the declaration; if both exist they must agree.
  - On a mismatch, nothing is autosaved and finalize returns the existing non-recoverable refusal (S9-U3). The live session is harmless, and nothing is written to it.
- **Legacy pages.** A page with neither block is a legacy pre-Slice-9 artifact: retained `prff01…`, or a browser-cached canonical page from before 9B was served. It is accepted only when begin returns an r1 revision. Every such artifact was built when r1 was the only revision, and a repository test proves that for each retained no-declaration artifact.
- **Implemented in 9D.**
  - The orchestrator runs the check inside `ensureBegun`, after begin returns and before the session becomes active. Autosave and finalize both wait on it, so no response can be sent first.
  - A mismatch, a malformed or duplicated block, a block of another lesson, a disagreement between the declaration and the AP block, or a begin response without a usable revision puts the runtime in its non-recoverable error state. Finalize then returns a plain student message ("This assignment needs to be opened again...") with no identifiers.
  - The legacy rule is exactly the one above. A test proves the only retained no-declaration artifact is `prff01…` and that it displays r1.
- **Scope of the check.** The check protects honest clients from stale URLs and caches. It is not a security boundary. Scoring authority remains the server's frozen revision.

#### 21.5 Launch routing (9D) and practice (S9-D3)

- **Revision field.** `assignmentsListForStudent` items and `lmsDeepLinkResolve` responses (both `assignmentLaunch` and `lessonPractice`) carry `assessmentRevisionId`, read from the assignment.
  - It is present for every student regardless of accommodation, so it discloses nothing about accommodations.
  - Requests remain unable to name a revision.
- **Path table.** The build generates a revision-to-path table that ships in the same Hosting release as the artifacts.
  - Single-revision lessons: r1 maps to the existing unversioned v2 path.
  - Multi-revision lessons: every revision maps to its rendition.
  - Implemented in 9B as `app/lessons/assessment-revisions/revision-paths.json`: `{ schemaVersion: 1, kind: "lyfelabz.assessmentRevisionPaths", lessons: { <slug>: { <assessmentRevisionId>: <absolute path> } } }`. It is sorted, has no fallback entry, and is drift-checked by `lessons:verify`. The curated Hosting build ships it and copies exactly the renditions it names. Nothing consumes it until 9D.
- **Selection.** `buildAssignmentLaunchUrl` and `planPracticeLaunch` select by (slug, revision). This covers the canonical primary URL, the `canonicalFallback` URL, and the differentiated load-failure fallback. A missing or unknown revision fails closed to the existing retryable state.
- **Pre-`b294e65` assignments (recorded at 9C-1; resolved in 9D).** They are obsolete, not a supported launch population, so 9D fails closed with no compatibility rule and no r1 guess.
  - Production: every assignment without `assessmentRevisionId` was deleted in the Sprint 21 production cleanup (2026-07-28; `SPRINT_21_FINAL_CERTIFICATION.md`, "Zero remain in `lyfelabz-prod`").
  - Staging: the staging project was first used on 2026-09-04, after `b294e65`.
  - Publish: `assignmentsPublish` has stamped the revision since `b294e65` and refuses without a deployed one.
  - Begin: `assessmentSessionsBegin` has refused an assignment without it since `b294e65`.
  - No migration.
- **Implemented in 9D.**
  - **Path table.** The client bundles a byte-identical copy of the 9B table (`app/src/assignments/studentList/assessment-revision-paths.json`, written by `lessons:build` and drift-checked by `lessons:verify`), following the curriculum-manifest pattern. `revisionPaths.ts` does an exact (lesson, revision) lookup with no fallback.
  - **Routing.** `buildAssignmentLaunchUrl` and `planPracticeLaunch` take the server's frozen `assessmentRevisionId` from the list item or deep-link resolution. This covers the canonical primary, `canonicalFallback`, and differentiated load-failure URLs, and deep-link `lessonPractice`. A missing or unmapped revision produces no navigation. A My Science card stays visible with no launch action; a deep link shows the existing retryable state.
  - **Unchanged.** Curriculum preview, public pages, and Present Mode keep the unversioned page. The Classroom URL `/app/a/{assignmentId}` is unchanged, and the revision never appears in a launch URL.
- **Practice.**
  - My Assignments excludes practice-mode assignments (`assignments-list-for-student.ts`). The assignment-tied practice path is therefore the `lessonPractice` deep-link route, which routes to the frozen revision.
  - Practice creates no session, so its guarantee is routing only.
  - Anonymous and public practice, teacher curriculum preview, and Present Mode are not associated with an assignment and keep the unversioned page.
- **Google Classroom.** The external URL `/app/a/{assignmentId}` and the coursework are unchanged. Every arrival re-resolves on the server, so existing Classroom links pick up the correct revision without republication.

#### 21.6 Server read path (9C-1)

- Additive response fields as in 21.4 and 21.5.
- One shared coverage evaluator (21.7) replaces the two separate index parsers:
  - `readVariantIndex` in `launch-presentation-deps.ts`;
  - `readCoverage` in `begin-delivery-deps.ts`.
- Op C and begin's check without a launch reference both key on the assignment's frozen revision.
- Grant, session, and attempt shapes are unchanged. The Slice 2 and Slice 5 validation boundaries are unchanged.
- **Implemented in 9C-1.** The shared evaluator is `shared/presentation/revision-coverage.ts`, wired through `revision-coverage-deps.ts`. Launch (`launch-presentation-deps.ts`) and begin (`begin-delivery-deps.ts`) call it; neither parses an index document itself. Details:
  - A frozen revision is usable only when it is exactly `assessment_{lessonSlug}__r{N}` (N of 1 or more, no leading zero). An unusable or missing one is never guessed. No scoped read happens, a legacy record is never honored (`assessmentMismatch`), and the list and deep-link responses omit `assessmentRevisionId`. Begin refuses such an assignment with the existing `assignment-not-published` code.
  - A scoped record's `assessmentRevisionId` is always present, so its binding is decided by `assessmentPresentationRevisionId` alone. Its identity (lesson, variant key, revision) is checked before its status, so a retired record naming another revision is malformed.
  - Begin's no-ref check adds the kind `assessmentMismatch`, which yields `canonicalFallback` with `noRefFallback` telemetry, reason `coverageAssessmentMismatch` (S9-U1).
  - `assessmentSessionsBegin` returns `assessmentRevisionId` (the session's, equal to the assignment's). `assignmentsListForStudent` items and `lmsDeepLinkResolve` launch targets return it too. Both surfaces now refuse a request that names `assessmentRevisionId`.
  - The `staging-f53-assessment-negatives` P0 coverage precondition evaluates effective coverage through the shared evaluator.
  - Malformed coverage at launch follows S9-D8: the certified F5.2 row-5 `canonicalFallback` grant with defect telemetry. That is the implemented and canonical behavior. A read failure is canonical with no grant (row 8). Begin refuses malformed coverage without a launch reference, as before.

#### 21.7 Revision-aware coverage (9C-1 read, 9C-2 publish)

- **Shape.** Revision-scoped documents `presentationVariants/{lessonSlug}__{variantKey}__r{N}` sit in the existing collection.
  - `N` is the ordinal of the frozen `assessmentRevisionId`, parsed by the shared identifier helper. The id is unambiguous because slugs and variant keys cannot contain `__`.
  - Fields are those of `PresentationVariantIndexDoc`, with `assessmentRevisionId` always present and equal to `assessment_{lessonSlug}__r{N}`. `assessmentPresentationRevisionId` is present only when bound.
  - The existing deny-all Rules block `presentationVariants/{indexId}` already covers these ids. No Rules or composite index change is needed.
- **Lookup** for (lesson, variant key, frozen revision), after the operational delivery flag:
  1. If the scoped document exists, it alone decides (active, retired or malformed). An active document naming another revision is malformed. A retired scoped document never falls through to the legacy document.
  2. Otherwise the legacy unscoped document `presentationVariants/{lessonSlug}__{variantKey}` is read:
     - if bound, it is honored only when its `assessmentRevisionId` equals the frozen revision (current Slice 5 rule);
     - if unbound with no recorded revision, the legacy-r1 rule applies: it is honored only when the frozen revision is `assessment_{lessonSlug}__r1`;
     - anything else is a revision mismatch.
  3. A revision mismatch, absence, or retirement is a coverage gap for that revision. Launch mints a `canonicalFallback` grant with telemetry (`coverageAssessmentMismatch`, `coverageAbsent`, `coverageRetired`). A begin without a launch reference freezes `canonicalFallback` with the same telemetry (S9-U1).
  4. A malformed record: launch mints a truthful `canonicalFallback` grant with defect-severity telemetry (`coverageMalformed`), bound to the frozen revision (F5.2 §8.5 row 5, S9-D8); the malformed record is never used for delivery. A failed read: launch degrades to canonical with no grant (F5.2 §8.5 row 8). Either way, a begin without a launch reference refuses with `BEGIN_VALIDATION_UNAVAILABLE`.
     - Superseded wording (9C-1 closure, S9-D8): "A malformed record or failed read: launch degrades to canonical with no grant (F5.2 §8.5 row 8)". It contradicted the certified row-5 behavior that 21.11 requires to be preserved.
  5. An assignment without a frozen revision receives no differentiated coverage.
- **Legacy records.** The legacy document is never written again after 9C-2.
  - Staging's legacy document (`pr90f…`, `ap1fed…`, r1) keeps serving r1 exactly as certified in C7.
  - Production's legacy document (`prff01…`, unbound) serves only r1 assignments. Production delivery is disabled.
  - No migration.
- **Publisher invariants (9C-2).**
  - Every manifest entry appended from 9C-2 onward records `assessmentRevisionId`. `assessmentPresentationRevisionId` requires it. Entries without it are exactly a pinned legacy list, `{prff01d9...375c}`, that can only shrink.
  - For an unbound entry, the recorded revision is the variant's provenance under S9-D7 (its explicit variant-config `assessmentRevisionId`, or the legacy-r1 rule for a pinned historical artifact). It must also equal the single committed payload faithful to the artifact's quiz, extracted from the retained bytes. Zero or several faithful payloads, missing provenance for a new variant, or a disagreement refuses publication (S9-D2, S9-D7). The artifact's HTML is not required to carry a revision declaration, and immutable retained HTML is never changed to add one.
  - Superseded wording (9B closure, S9-D7): the recorded revision had to equal all three of "the revision declared in the lesson config", the single faithful payload, and "the artifact's own revision declaration", and "a missing declaration" refused publication. Variant artifacts carry no canonical declaration (21.4), so that clause could never be satisfied without mutating retained bytes.
  - The recorded revision must be a deployed revision (`assessmentRevisions/{id}` exists), not necessarily the current one. An undeployed revision is always refused (S9-U2).
  - The publisher writes only the scoped document for the entry's revision. `prff01…` maps to r1 through the legacy-r1 rule. Publish is create-only and rollback is the explicit repoint (S9-D9). The self-consistency check is extended to check that the document id agrees with its fields.
    - Superseded wording (9C-2, S9-D9): "The write is a full `.set()` under the existing self-consistency check". A full `.set()` would let an ordinary publish overwrite existing coverage.
  - The stage order is unchanged: LOCAL_VERIFIED, HOSTING_DEPLOYED, HOSTED_BYTES_VERIFIED, ASSESSMENT_PRESENTATION_RECORDED (bound only), INDEX_UPDATED.
  - Retirement and rollback act on one scoped document. The operational flag remains the global kill switch.
  - **Implemented in 9C-2.** Details:
    - **Provenance.** `app/scripts/lessonBuilder/variantPublicationProvenance.cjs` decides the covered revision from the manifest entry and the exact retained bytes. The order is: the certified AP record (whose revision must equal the entry's); else the entry's explicit `assessmentRevisionId`; else, only for an artifact in the pinned, shrink-only `LEGACY_R1_UNBOUND_REVISIONS` (`variantManifest.cjs`, exactly `prff01…`), r1. There is no opt-in to the exception.
    - **Fidelity and canonical page.** The revision must be committed and have a canonical page in the 9B revision-path table. The artifact's rendered quiz must be exactly the AP rendering against that revision, or, unbound, faithful to that revision and no other. Variant HTML carries no canonical declaration.
    - **Deployed, not necessarily current.** The revision must be deployed: `assessmentRevisions/{id}` exists with this `assessmentId`, `activityId`, and `revisionOrdinal`. It need not be current. A committed but undeployed revision is refused. The Slice 5 "deployed current" requirement for bound revisions is replaced by this rule for every revision.
    - **Before side effects.** At LOCAL_VERIFIED, before any Hosting or Firestore side effect, the machine also checks the scoped record's self-consistency, that it reads back through the shared 9C-1 evaluator as exactly this coverage, and a preflight read of the existing scoped record. The final write re-reads it in a transaction and applies the same planner (`planScopedCoverageWrite`).
    - **Characterized boundary.** A scoped record that appears between the preflight and the write (after the staging Hosting deploy) is refused at INDEX_UPDATED with the coverage unchanged. Hosting may already have been deployed; that deploy only makes a retained, add-only artifact reachable.
    - **Manifest.** An entry may record `assessmentRevisionId` alone. `assessmentPresentationRevisionId` requires it. A new append without it is refused, and `verifyRetention` fails on any revisionless entry outside the pinned list. `generateAuthoredVariant` records the explicit revision of an unbound build.
    - **No legacy writes.** The legacy unscoped document has no write reference in the typed-ref layer and no publisher port. Existing legacy records (`pr90f…` on staging, `prff01…` in production) are read-only compatibility state and are not migrated.
    - No Rules or index change. Nothing was published to staging or production, and no real r2 exists.
- **r1 after r2 becomes current.** r1 assignments resolve to the r1 scoped document, or to the legacy document. Nothing published for r2 can change r1 resolution.
- **r2 before an r2 AP exists.** Accommodated students on r2 assignments receive a truthful `canonicalFallback` and the canonical r2 display. This is visible in telemetry and is never silent.
- **Adding an r2 AP.** Publishing the r2-bound revision writes only the `…__r2` document.
- **Rollback of Slice 9 Functions.** Pre-Slice-9 code reads only the legacy document: r1 keeps working and other revisions fall back canonically. The legacy document must therefore never be rewritten or removed as part of Slice 9.

#### 21.8 Fail-closed rules

| Condition | Result |
|---|---|
| Launch item or deep-link response lacks a revision, or the revision is not in the path table | Existing retryable state; no navigation |
| Page's declared revision differs from begin's revision | Nothing autosaved; finalize refused as non-recoverable (existing message); session unchanged |
| Page has no declaration and no AP block, and the session is not r1 | Refused as above |
| Scoped or legacy coverage malformed (a malformed scoped record never falls through to the legacy record) | Launch: truthful `canonicalFallback` grant on the frozen revision, defect-severity telemetry, the malformed record never delivered (F5.2 row 5, S9-D8). Begin with that grant: `canonicalFallback`. Begin without a launch reference: `BEGIN_VALIDATION_UNAVAILABLE` |
| Scoped or legacy coverage read fails | Launch: canonical, no grant, telemetry (F5.2 row 8). Begin: `BEGIN_VALIDATION_UNAVAILABLE` |
| Coverage absent, retired, or for another revision | `canonicalFallback` with telemetry at launch and at a begin without a launch reference (S9-U1) |
| Grant with invalid or forged provenance | Unchanged: `LAUNCH_REF_INVALID` or `LAUNCH_REF_EXPIRED` |
| AP record missing, altered, or mapped to another revision | Unchanged: refused at begin, autosave and finalize |
| Rendition not faithful to its payload, chrome incompatible, or unbound revision unknown or ambiguous | Build or publish refused |
| Coverage for an undeployed revision | Publish refused |

#### 21.9 Historical compatibility

| Case | Display | Coverage source | Begin freeze | Scoring |
|---|---|---|---|---|
| C6 (`…__a1`, `prff01…`) | Attempt immutable. A relaunch reaches `prff01…` only through the legacy-r1 rule. No declaration, so the runtime legacy rule applies (r1 only) | Legacy unbound | `differentiated`, no AP | r1, four choices |
| C7 (`…__a2`, `pr90f…` + `ap1fed…`) | Variant path. The AP block declares r1 | r1 scoped document or legacy bound document | `differentiated` + AP | r1 key, displayed-option narrowing |
| Future canonical r1 | r1 page (unversioned while single-revision, rendition afterward) | none | `canonical` | r1 key |
| Future canonical r2 | r2 rendition | r2 absent: `canonicalFallback` for accommodated students | `canonical` or `canonicalFallback` | r2 key |
| Future r2 AP | Variant path. The AP block declares r2 | r2 scoped document, bound | `differentiated` + r2 AP | r2 key, narrowing |

No attempt, AP record, presentation revision, answer key, or manifest entry is rewritten.

#### 21.10 Deployment ordering and caches

- **Functions before Hosting.** The 9C-1 Functions deploy (`assignmentsListForStudent`, `lmsDeepLinkResolve`, `assessmentSessionsBegin`) precedes the 9D Hosting deploy. Otherwise the new client finds no revision field and fails every launch closed.
  - As implemented in 9D, the lesson runtime also refuses to send any response when begin omits `assessmentRevisionId`. A 9D Hosting release over pre-9C-1 Functions would therefore block assignment quizzes as well as launches.
  - The 9D release includes the rebuilt `assets/lyfelabz-assessment-runtime-active.js`, and both the marketing and app releases carry the 9B declarations.
- **Slice 9 before r2.** Slice 9's Hosting release precedes any r2 deployment by more than the browser cache window, so cached pre-Slice-9 pages and bundles expire before any second revision exists. The live Hosting cache headers must be checked during C8. They are not configured in `firebase.json`, so Firebase defaults apply.
- **Stable paths.** Rendition paths are stable, so browser history and bfcache restore pages that are internally consistent.

#### 21.11 Implementation sequence

| Sub-slice | Purpose | Key invariant | Deploy | Depends on |
|---|---|---|---|---|
| 9.0 | Normative reconciliation (documentation) | Documentation matches PDR-031 and current behavior | No | Owner rulings |
| 9A | Payload authority and multi-revision tooling | Each committed revision is validated as its own authority. No artifact bytes change | No | 9.0 |
| 9B | Declarations, renditions, variant baseline, path table, Hosting manifest | Every canonical artifact declares its revision. Renditions are faithful and deterministic. `pr90f…` and `prff01…` reproduce byte-identically | Hosting later, with 9D | 9A |
| 9C-1 | Server read path and shared evaluator | Revision-aware coverage. Legacy-r1 rule. Revision field always present | Functions | 9.0 |
| 9C-2 | Publisher and scoped coverage | Scoped writes only. Recorded revision. Deployed-not-current check. Pinned legacy list | No (repository tooling) | 9C-1 |
| 9D | Client routing and runtime verification | Every assignment-associated launch lands on the frozen revision. Mismatches fail closed | Hosting, after 9C-1 | 9B, 9C-1 |
| 9E | Staging certification C8 (18.2; COMPLETE, PASSING, 18.3) | No C7 regression; live routing proven | Staging only | 9B to 9D |

Every implementation sub-slice runs `npm --prefix app run verify` and the Functions test, typecheck, lint and build. Sub-slices that change data access also run `test:rules`. C7-preserving regressions are required throughout:
- `pr90f…` rebuild and `variants:verify` with an unchanged manifest;
- the `ap1fed…` record and review record bytes;
- the resolver and begin matrices, including the C6 legacy-unbound path;
- Slice 2 and Slice 5 validation;
- best-attempt and passback suites;
- the `staging-f53-assessment-negatives` driver tests, updated to evaluate effective coverage.

#### 21.12 Earth's Layers r2, after Slice 9

1. Author `earths-layers.r2.json` (balanced; passes the answer-position standard with no allowlist entry) and an r2 assessment presentation. Certify the r2 AP (section 12).
2. Build the r1 and r2 renditions and the r2-bound variant revision. Release Hosting to staging and verify the served bytes and the path table.
3. Deploy r2 to staging (`currentRevisionId` advances). Immediately publish the r2 coverage (S9-U2); the gap between the two is a telemetry-visible `canonicalFallback`.
4. Prove on staging:
   - the existing r1 assignment still displays r1 and scores against r1 (canonical and `ap1fed…` paths);
   - a newly published assignment freezes r2 and displays r2 for canonical and accommodated students;
   - a forced mismatched page writes nothing;
   - C6, C7-F, the AP records, the index documents, and the assignments are unchanged.
5. Production follows under separate authorization.

**Status (2026-09-30): local certification COMPLETE and PASSING; staging Stage A and Stage B COMPLETE and PASSING (records below). Production canonical r2 is COMPLETE; production Phase A/B coverage publication is COMPLETE (below); production flag activation (Phase C) is COMPLETE and certified (below); Phase D is not performed.**

**Production record (2026-09-29 to 09-30).** Production followed the staged order as the Slice 9 + Policy E catch-up (full record: `SECURITY_BACKLOG_LAUNCH_URL_ANALYTICS.md`, "Production catch-up").
- P1: the five F5.3/9C-1 Functions, from HEAD `6930452`.
- P2: Stage A Hosting `04a3bffc0b91518b` from `8b6773a` (23:18:15.275Z). The owner's beta student reached the r1 rendition for the existing r1 assignment.
- P3: more than 3600 s later, `deploy-assessment.ts --target=production` deployed `assessment_earths-layers__r2` (00:20:50Z; revision and answer key equal the committed payload, key `BDACBADCAB` by plan). The parent became current r2.
- P4: HEAD Hosting `1fdb7d3ff3ead2aa` (Stage B plus fragment hardening, Policy E, and the cache-transition fix), 00:26:01.579Z.

The existing production Earth's Layers assignment stays frozen to r1. No r2 assignment exists in production.

**Production coverage publication (2026-09-30, Phases A and B).** Each phase ran `publish-variant.ts --op=publish --target=production` from a clean worktree of `deab657`, with the guarded no-op `HOSTING_DEPLOYED` stage. Every stage passed, and hosted bytes matched the retained artifact before any write. The AP was created first and the scoped record last.
- Phase A (01:52:03Z): `assessmentPresentations/ap1fed…` and `presentationVariants/earths-layers__reading-adapted__r1` (active, r1 → `pr90f…` + `ap1fed…`).
- Phase B (01:59:11Z): `assessmentPresentations/ap515838…` and `presentationVariants/earths-layers__reading-adapted__r2` (active, r2 → `pr6b7c…` + `ap515838…`).
- Verification:
  - each AP hashes to its id and equals the committed canonical record;
  - the shared evaluator resolves r1 and r2 as active, source scoped, to their own presentation and AP;
  - the legacy unscoped `prff01…` record is unchanged and retained as historical evidence (scoped records take precedence).
- Mutation ledger: exactly those four documents. Assignments (22), attempts (144), Current pointers (4), sessions (25) and passbacks (99) were unchanged, as were Hosting `1fdb7d3ff3ead2aa`, all 70 Functions and the Rules.
- Still dark: the delivery flag is absent, with 0 accommodations and 0 launch grants. The `launchGrants.expiresAt` TTL policy is ACTIVE. Phase C (flag activation) and controlled-beta end-to-end production verification are not started.

**Production activation (Phase C, 2026-09-30).** Pre-state was re-verified read-only against the Phase A/B record: HEAD `94c1c1b` = `origin/main`, Hosting `1fdb7d3ff3ead2aa`, all 70 Functions unchanged, Rules unchanged, both scoped records and the legacy record as above, the TTL policy ACTIVE, the flag absent, 0 accommodations and 0 launch grants.
- The write: Chris created `platformConfig/differentiatedDelivery` in the `lyfelabz-prod` Firebase Console with exactly the boolean `enabled: true`. This is the only field the fail-closed reader consults (`enabled === true`). It was the only Phase C production mutation. Differentiated delivery is enabled.
- Semantics (implementation and tests): the launch and begin resolvers read the accommodation first. An absent or inactive accommodation yields canonical delivery with no grant, before the flag or coverage is read.
- Post-write re-read: only the flag document changed. Still 0 accommodations (0 active, 0 history entries) and 0 launch grants. Scoped r1 (`pr90f…` + `ap1fed…`), scoped r2 (`pr6b7c…` + `ap515838…`) and the legacy `prff01…` record are unchanged. Earth's Layers is current r2, and the existing assignment is frozen r1. Assignments (22), attempts (144), Current pointers (4), sessions (25) and passbacks (99) are unchanged, as are Hosting `1fdb7d3ff3ead2aa`, all 70 Functions, the Firestore and Storage Rules, and the ACTIVE TTL policy.
- Beta-student verification (non-submitting): the designated beta student signed into production. My Science showed the existing Earth's Layers assignment and prior attempt. Opening it navigated to the canonical frozen-r1 rendition `/app/lessons/assessment-revisions/lesson_earths-layers__r1.html`, with the assignment context in the fragment, no `launchRef`, and no `/variants/` route. All 10 items displayed four choices (canonical, not reading-adapted). No answer was selected and nothing was submitted. No session, launch grant, or accommodation was created, and no Classroom passback was triggered.
- Certified invariant: flag enabled + no active accommodation → canonical delivery with no differentiated launch grant.
- Student Services: the teacher UI gate is open (`G19_GATE_OPEN = true` since `ece3861`, 2026-09-26; the production bundle carries it). With the flag enabled, a teacher activating Reading Accessibility through Student Services makes differentiated delivery operational for that student wherever certified coverage exists. This is intended behavior. Keep Student Services accommodation changes controlled until Phase D is certified.
- Phase D (controlled Reading Accessibility activation for the designated beta student, with end-to-end production delivery verification) is NOT performed.

Owner rulings (2026-09-28, owner review packet):
- **R2-D1.** Canonical r2 q1 to q10 approved as presented.
- **R2-D2.** The adapted three-choice r2 presentation `ap51583824375c58be36627f047f280510b0cde98e9aba2fbec7ef058ad2fc4903` approved as presented.
- **R2-D3.** Canonical Show Your Thinking unchanged; the adapted r2 Show Your Thinking keeps the certified r1 form. Canonical Show Your Thinking provenance (9.4) stays out of scope.
- **R2-D4.** The lesson keeps its existing 7.MS-ESS2-2 alignment.
- **R2-D5.** Narrow explicit-revision support in the staging assessment deployer.
- **R2-D6.** Cache-safe two-stage release, approved in principle.

Local results:
- **Canonical r2.** `earths-layers.r2.json` was authored with the committed CLI.
  - The generated r1 and r2 renditions and the revision-path table map each revision to its own rendition.
  - r2 passes the answer-position standard with no allowlist entry (`BDACBADCAB`) and has no canonical answer-cue finding.
  - r1 is byte-unchanged.
- **Certified r2 presentation.**
  - Review record `lesson-sources/variants/reviews/ap515838…4903.json`: reviewer `owner` / `lyfelabz-owner`, `approved`, reviewed 2026-09-28T16:47:58.379Z.
  - Retained record `platform/functions/src/scripts/assessment-presentations/ap515838…4903.json` (canonical bytes).
  - The variant config binds it.
  - The authored variant source's quiz literal is a verbatim copy of the canonical r2 literal.
  - `build-variants.cjs --generate` retained **`pr6b7c74fe84fb20a9b05d4b2d6e006c21ed2bc02d58dcfbefc925dbd4c400e948`**:
    - bound to r2 and `ap515838…`;
    - three displayed choices per item;
    - no omission rationale, review data, or canonical declaration in the bytes;
    - appended to the manifest after the unchanged `prff01…` and `pr90f…` entries.
- **Retained r1 state.**
  - `ap1fed…`, its review record, `pr90f…`, and `prff01…` are byte-unchanged.
  - Both retained r1 artifacts still reproduce byte-for-byte from the historical r1 variant source, in either stage. The verbatim r1 literal is recovered from retained `prff01…`, an unbound variant whose literal is the canonical r1 literal.
- **r1 authoring notes (Task 1 decision).** The certified r1 provenance is the retained `ap1fed…` record (content, including every omission rationale) plus its approved review record. Both are immutable and unchanged.
  - The draft notes are working material under the Slice 6A contract: author claims for the reviewer, not identity, never served, not authoritative.
  - No archival location for notes exists in the architecture, and none was created.
  - The certified r1 notes remain recoverable by content address: Git blob `3a833bca0a87ea7ea570853d4ada7ff855759da7`, added in `06a46ca` and unchanged through `f6e5067`.
- **Explicit-revision staging deployment (R2-D5).** `deploy-assessment-staging --lesson=<slug> --assessment-revision=assessment_<slug>__r<N>` deploys exactly that committed payload.
  - Without the flag, a lesson with several committed revisions is refused with an operator error.
  - A malformed or cross-lesson id is refused while parsing, and an uncommitted one while resolving, both before any credential or network access. There is no latest, current, or fallback.
  - Fidelity is checked against the page the committed revision-path table maps that revision to.
  - A new preflight state, "advance", accepts exactly what the certified `deployAssessmentRevision` transaction accepts for a later revision: the lesson's parent at a lower revision of the same assessment, with the selected revision and answer key absent. The earlier preflight could only deploy a lesson's first revision.
  - The production CLI (`deploy-assessment.ts --file=`) is per file and has no equivalent ambiguity.

**Release stages (repository mechanics).** The unversioned canonical pages are generated from `canonicalAssessmentRevisionId`, so the two stages are two repository states.
- **Stage A** (the working tree at local certification) declares `canonicalAssessmentRevisionId: assessment_earths-layers__r1`, with r2 committed and rendered. Its v1 and v2 unversioned pages are byte-identical to the pre-r2 pages at `f6e5067`.
- **Stage B** changes exactly four files:
  - the config declaration to r2;
  - the canonical source quiz literal, which becomes a verbatim copy of the variant source's literal;
  - the regenerated v1 and v2 unversioned pages.
- Both stages ship identical renditions, path table, client bundle, and retained variants. The r2-bound variant builds to the same `pr6b7c…` in both.
- Every test is stage-agnostic. Stage B passed the full app, Functions, and Hosting gates in a scratch worktree.
- The exact staging procedure is `DIFFERENTIATION_STAGING_CERTIFICATION_RUNBOOK.md` §3e.

**Stage A staging record (2026-09-28): COMPLETE and PASSING.** Stage B is not started; production is untouched.
- **Release.** Commit `8b6773a8b830804cad1fcccb14d4d51054608223` ("Add Earth's Layers r2 assessment support").
  - Built from the clean detached worktree `lyfelabz-r2a-release` with real `npm ci` installs and only the staging `.env`.
  - Gates: app verify 133 suites and 3743 tests; app build; Functions 156 suites and 4101 tests, typecheck, lint, build; Hosting 228 files, 14 pass and 1 skipped.
  - The artifact was verified as Stage A: the ordinary v1 and v2 pages declare r1 and equal the `f6e5067` bytes; the renditions and table are r1/r2; `pr6b7c…` is bound to r2 + `ap515838…`; `pr90f…` is bound to r1 + `ap1fed…`.
- **Pre-snapshot.** Identical to the C8 final state:
  - flag true;
  - the assignment frozen r1, with Current, recipient and accommodation unchanged;
  - legacy and scoped r1 coverage unchanged, no scoped r2 record, and only `ap1fed…` among assessment-presentation records;
  - the parent assessment at r1, whose r1 revision and answer key equal the committed plan (`CBBBBABABB`); no r2 or r3 documents;
  - attempts `a1`–`a4` unchanged, no session, 0 passbacks;
  - 70 Functions identical to C8.
- **Hosting.** Version `980e784622c62aba`, released **2026-09-28T23:05:22.741Z** (the previous release was `b292073a482b032b`).
  - The served delta equals the expected delta: added are the r1 and r2 renditions and `pr6b7c…`; changed are `app/dist/bundle.js` and `revision-paths.json`; nothing else changed.
  - All 221 served files equal the artifact.
  - The ordinary pages still declare and display r1.
  - `pr6b7c…` shows 3 choices per item and no rationale, review, or certification text.
  - `cache-control: max-age=3600`.
- **Cache-safety checkpoint.** In the certification browser:
  - The `cache: "reload"` refetch hashes of the bundle, both runtime assets, the table, both renditions, both ordinary pages, `pr90f…` and `pr6b7c…` all equal the release hashes.
  - After a fresh navigation, the executing bundle's decoded size was 1,482,495 bytes, equal to the release.
  - Fingerprint: the frozen-r1 assignment's `data-assignment-launch-url` is `/app/lessons/assessment-revisions/lesson_earths-layers__r1.html?assignment=…`.
- **r1 launch before the r2 data.** My Science reached `pr90f…` (query keys `assignment` and `launchRef`) with binding r1 + `ap1fed…`, 3 choices per item, and r1 content. The runtime stayed pending, with no session or attempt.
- **r2 data, deployed by explicit revision.**
  - Without `--assessment-revision`, the tool refused with exit 2 before any access.
  - The dry run reported `revision=assessment_earths-layers__r2 fidelity=exact selection=explicit state=advance from=assessment_earths-layers__r1 writes=0 target=staging`.
  - `--apply` reported `applied … revision=assessment_earths-layers__r2 ordinal=2 writes=3` at 23:12:43.559Z.
  - Documents changed: `assessmentRevisions/assessment_earths-layers__r2` and `assessmentAnswerKeys/assessment_earths-layers__r2` were created, both equal to the committed plan (key `BDACBADCAB`). `assessments/assessment_earths-layers` changed `currentRevisionId` from r1 to r2.
  - The r1 revision and answer key are unchanged.
- **After the r2 data deployment, unchanged:**
  - the assignment (still frozen r1), Current, recipient and accommodation;
  - every `presentationVariants` record, with no `…__r2`;
  - the assessment-presentation records (`ap515838…` not recorded);
  - attempts `a1`–`a4` (best still `a2`, 40%), with no session and 0 passbacks;
  - the flag, still true;
  - all 70 Functions.
- **r1 launch after the r2 data.** The fingerprint is still the r1 rendition, and My Science still reaches `pr90f…` + `ap1fed…` for r1. The r1 rendition (canonical and fallback) declares r1 and shows r1 content.
- **Mutation ledger (staging only):**
  - Hosting release `980e784622c62aba`;
  - the three r2 assessment documents above;
  - three r1 launch grants (differentiated `pr90f…`/`ap1fed…`, 23:11:47Z to 23:13:06Z) from certification My Science loads, with their normal audit events (not enumerated).
- **Not changed:** no Functions, Rules, indexes, Storage, Auth or marketing deploy; no flag change; no assignment; no coverage; no attempt; no passback; no Current change.
- **Production.** Hosting `fc8feef66cddca29` (2026-09-27T12:27:40Z) and all 70 Function update times are unchanged; only metadata was listed.
- **Earliest Stage B Hosting release:** **2026-09-29T00:05:22.741Z** (Stage A release plus 3600 s), and only with the Stage B checkpoint (runbook §3e).
- **Staging note.** Newly published staging Earth's Layers assignments now freeze r2. The test class `uwxg1a0yiyq4ts5ctejs` also holds two pre-existing Earth's Layers draft assignments (2026-09-26); publishing either would freeze r2. The Stage B r2-assignment class decision covers them.

**Stage B staging record (2026-09-29): COMPLETE and PASSING; live r1 + r2 coexistence staging-certified.** Production is untouched.
- **Release.** Commit `28e2e2ca6241eaf422a0db9c9c9419f6b8606701` ("Make Earth's Layers r2 current").
  - It is exactly the certified four-file transition: the config declaration r1 to r2, the source quiz literal (a verbatim copy of the variant's r2 literal), and the regenerated v1 and v2 pages.
  - Built from the clean detached worktree `lyfelabz-r2b-release` with real installs.
  - Gates: app verify 133 suites and 3743 tests; app build; Functions 156 suites and 4101 tests, typecheck, lint, build; Hosting 228 files, 14 pass and 1 skipped.
  - The artifact differs from the Stage A artifact only in the two ordinary pages.
- **Precondition.** At 00:06:01Z, after the 00:05:22.741Z boundary, Stage A was still the served release and all ten certified Stage A files were served unchanged. The pre-snapshot equaled the Stage A final state.
- **Hosting.** Version `dd2878386ce4cbbd`, released **2026-09-29T00:06:22.079Z**.
  - The served delta is exactly `/app/lessons/lesson_earths-layers.html` and `/lesson_earths-layers.html`, with no path added or removed; all 221 served files equal the artifact.
  - The ordinary v1 and v2 pages declare and display r2 (four choices).
  - The bundle, runtime, table, both renditions, `pr90f…` and `pr6b7c…` are byte-identical to Stage A.
- **Cache checkpoint.**
  - The certification browser's `cache: "reload"` refetches of all ten files equal the Stage B release hashes, and the fresh-navigation bundle decoded size is 1,482,495 bytes.
  - The frozen-r1 fingerprint still names the r1 rendition.
  - The r1 differentiated launch still reaches `pr90f…` + `ap1fed…`, with no session.
- **r2 assignment (owner decision, 2026-09-29).**
  - SYT Acceptance (`uwxg1a0yiyq4ts5ctejs`) holds a valid, fully staffed Current r1 assignment. The teacher Assign dialog therefore shows it as "Up to date" (locked); the product's only new-assignment path there is "Assign as new" after closing that Current, which would have made r1 history-only.
  - The owner chose a second class instead, keeping r1 live. The controlled student joined "LyfeLabz Staging Test" (`qxtgj09sb58fox0zgv30`, G6 Block B, no Classroom link) through the product callable `enrollmentsJoinByCode`, called as the student with the class join code. Enrollment `qxtgj09sb58fox0zgv30__NmxK5iDDdhcXYbOECyOFHu26AOb2`.
  - As the teacher, the Earth's Layers Assign dialog was used with only that class selected, Ungraded, and Post now. It created and published **`a-earths-layers-qxtgj09sb58fox0zgv30-kpckdzwx0hyhv-3rb8j6cfpceua`**:
    - classroom mode, ungraded, no Classroom link;
    - frozen **`assessment_earths-layers__r2`**;
    - one recipient, the controlled student (`classPublication`);
    - Current in Block B from 14:34:36Z.
  - The r1 assignment remains Current in Block F, unchanged. The two Block F drafts are untouched.
- **Canonical r2** (flag false 14:37:56Z, restored true 14:39:15Z and verified).
  - My Science reached the r2 rendition (declares r2, 10 × 4, r2 content, Show Your Thinking prompt).
  - The begin session froze r2 `canonicalFallback`, and the runtime gate passed.
  - Attempt `…3rb8j6cfpceua__NmxK5iDDdhcXYbOECyOFHu26AOb2__a1`: responses `AAAAAAAAAA`, **3/10 (30%)**, equal to the independent rescore against the committed r2 key `BDACBADCAB`. The session was consumed.
- **Scoped r2 coverage.** `publish-variant --op=publish --target=staging --project=lyfelabz-staging --hosting-origin=https://lyfelabz-staging.web.app --lesson=earths-layers --variant=reading-adapted --revision=pr6b7c… --published-by=lyfelabz-owner-r2b` passed every stage:
  - LOCAL_VERIFIED;
  - HOSTING_DEPLOYED: release `48660c1305746ad7` at 14:39:32Z, file-for-file identical to `dd2878386ce4cbbd`;
  - HOSTED_BYTES_VERIFIED;
  - ASSESSMENT_PRESENTATION_RECORDED: `ap515838…` created, hashing to its id;
  - INDEX_UPDATED: `earths-layers__reading-adapted__r2` created (active, `pr6b7c…`, r2, `ap515838…`).

  The legacy and scoped r1 records and the `ap1fed…` record are unchanged.
- **Adapted r2.**
  - My Science reached `pr6b7c…` with binding r2 + `ap515838…`, display orders `ABC DAC BCA ACB ACB ABC ADB CBD BCA ABC`, three choices per item, the approved adapted stems and Show Your Thinking, and no omission or review text.
  - Grant: differentiated, `pr6b7c…`, `ap515838…`, config 1; it equals the page's launchRef.
  - The negatives driver passed 44/44: the session froze `pr6b7c…`/`ap515838…`/config 1; the omitted q1 option D and the unknown Z were refused; all provenance forgeries were refused.
  - Attempt `…__a2`: `differentiated`, `reading-adapted`, `pr6b7c…`, `ap515838…`, config 1, responses `BDACBADBBA`, **7/10 (70%)**, equal to the independent rescore. The session was consumed.
- **Live r1 + r2 coexistence (same student, same bundle):**
  - My Science lists r2 (70%, 2 attempts, best `a2`) routing to the r2 rendition, and r1 (40%, 4 attempts, best `a2` of r1) routing to the r1 rendition.
  - The list resolver gives r2 → `pr6b7c…` and r1 → `pr90f…`.
  - The deep-link resolver gives `assignmentLaunch`/`authorized` for both, with their own revision and presentation.
  - Re-opening r1 (no submission) reached `pr90f…` + `ap1fed…` with r1 content.
  - `canonicalFallback` is proven per revision: r2 by the attempt above, r1 by C8 `a4`.
- **Practice.** No practice-mode assignment exists, and the teacher Assign dialog offers only ungraded or graded classroom assignments, so live assignment-tied practice was not certified. It remains covered by the 9C-1 `lessonPractice` server tests and the 9D routing tests.
- **Mutation ledger (staging only):**
  - Hosting `dd2878386ce4cbbd` and the publisher's identical `48660c1305746ad7`;
  - the enrollment above;
  - the r2 assignment, its recipient, and the Block B Current pointer;
  - the flag round trip (ends true);
  - two r2 sessions, both consumed;
  - attempts `…__a1` and `…__a2` on the r2 assignment;
  - `presentationVariants/earths-layers__reading-adapted__r2` and `assessmentPresentations/ap515838…`;
  - 16 launch grants from certification loads and probes, with their normal audit events (not enumerated).
- **Unchanged:**
  - the r1 assignment, recipient and Block F Current;
  - attempts `a1`–`a4`;
  - the r1 and r2 assessment documents and the parent (current r2);
  - the legacy and scoped r1 coverage and `ap1fed…`;
  - accommodation (config 1);
  - 0 passbacks;
  - all 70 staging Functions;
  - production (Hosting `fc8feef66cddca29`, 70 Functions).
- **Findings (not blockers):**
  - The lesson pages' analytics `page_view` beacon sends the full page URL, including `assignment` and the `launchRef` grant id, to Google Analytics. This is pre-existing and needs a separate owner decision.
  - The teacher Assign dialog pre-selects every other eligible class by default.
  - An already-onboarded student has no UI to join a further class.

**Backlog (UX, not a blocker).** When the runtime refuses a submit (for example a revision mismatch), the lesson's local results reveal still shows a local score above "Could not submit" (C8, 18.3). Nothing is recorded. Whether to suppress the local score on a refused submit is an owner UX decision.

#### 21.13 Out of scope for Slice 9

- Earth's Layers r2 authoring.
- D7 answer-data hardening.
- D2 teacher-visible accommodation label (slice 10).
- Canonical Show Your Thinking provenance (9.4).
- Canonical instruction versioning.
- Quiz chrome that differs between revisions.
- Production activation.
- Rollout beyond Earth's Layers.
