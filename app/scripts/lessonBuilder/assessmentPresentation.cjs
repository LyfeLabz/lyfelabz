/*
 * F5.3 Slice 3 - Immutable, content-addressed assessment presentations.
 *
 * An assessment presentation is the student-facing form of ONE canonical
 * assessment revision for an accommodated delivery: item stems, the choices
 * displayed (in display order, each carrying its canonical optionId), any
 * deliberately omitted canonical distractors with their authored rationale,
 * optional adapted directions / per-item feedback, and an adapted Show Your
 * Thinking block. It never carries correctness, points, or scoring data: the
 * canonical assessment revision and its server-only answer key remain the
 * sole scoring authority (DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md
 * sections 5-8).
 *
 * Identity: assessmentPresentationRevisionId = "ap" + sha256(canonicalJson(record)).
 * canonicalJson is the deterministic serialization below (object keys sorted
 * by UTF-16 code unit, arrays in order, no insignificant whitespace, NFC
 * strings only, integers only). The record does not contain its own id.
 * A retained record file is named "<id>.json" and its bytes must be exactly
 * canonicalJson(record) + "\n", so the file bytes are as deterministic as the
 * id (mirrors the exact-bytes identity of presentation artifacts, where
 * presentationRevisionId = "pr" + sha256(artifact bytes)).
 *
 * Retained records live in platform/functions/src/scripts/assessment-presentations/
 * beside the canonical payloads they map onto (never hosting-served). The
 * Firestore family assessmentPresentations/{id} is reserved (deny-all Rules);
 * the publisher writes it in a later slice.
 *
 * Traits are generic, not tied to a variant key: `language` (canonical |
 * adapted) and `choiceCount`. Any combination that differs from canonical is
 * representable (adapted + 3, adapted + 4, canonical + 3, ...). Which delivery
 * profile uses a presentation is recorded by the variant manifest binding,
 * not here.
 *
 * Human certification lives in a separate review record
 * (lesson-sources/variants/reviews/<id>.json, never served) bound to the exact
 * id; any content change produces a new id and needs a new review.
 *
 * Pure and dependency-free (node builtins only) so the Functions publisher can
 * reuse it through createRequire in a later slice.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const paths = require("./paths.cjs");
const { sha256Hex } = require("./hash.cjs");
const { evaluateDistribution } = require("./assessmentQuality.cjs");

const SCHEMA_VERSION = 1;
const RECORD_KIND = "lyfelabz.assessmentPresentation";
const AP_ID_PATTERN = /^ap[0-9a-f]{64}$/;
const LESSON_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REVISION_ID_PATTERN = /^assessment_([a-z0-9]+(?:-[a-z0-9]+)*)__r([1-9][0-9]*)$/;
const LANGUAGE_TRAITS = Object.freeze(["canonical", "adapted"]);
const SUPPORTED_ITEM_TYPES = Object.freeze(["singleChoice"]);

// Keys that would carry scoring authority. The schema is closed (unknown keys
// fail anyway); this list makes a correctness leak an explicit, named failure.
const CORRECTNESS_KEYS = Object.freeze([
  "correct",
  "correctOptionId",
  "correctAnswer",
  "correctAnswers",
  "isCorrect",
  "answerKey",
  "points",
  "pointsEarned",
  "score",
]);

const RECORD_KEYS = Object.freeze([
  "schemaVersion", "kind", "lessonSlug", "assessmentRevisionId", "traits",
  "directions", "items", "showYourThinking",
]);
const TRAIT_KEYS = Object.freeze(["language", "choiceCount"]);
const ITEM_KEYS = Object.freeze(["itemId", "stem", "displayedOptions", "omittedOptions", "feedback"]);
const OPTION_KEYS = Object.freeze(["optionId", "text"]);
const OMITTED_KEYS = Object.freeze(["optionId", "rationale"]);
const SYT_KEYS = Object.freeze(["prompt", "modelAnswer", "requiredTerms"]);

// ---------------------------------------------------------------------------
// Canonical serialization and identity
// ---------------------------------------------------------------------------

function canonicalJson(value) {
  if (value === null) return "null";
  if (typeof value === "string") {
    if (value !== value.normalize("NFC")) {
      throw new Error("[assessment-presentation] strings must be Unicode NFC-normalized");
    }
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) {
      throw new Error("[assessment-presentation] only safe integers are allowed in a record");
    }
    return String(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
  }
  throw new Error(`[assessment-presentation] unsupported value type in record: ${typeof value}`);
}

function assessmentPresentationRevisionIdFor(record) {
  return `ap${sha256Hex(canonicalJson(record))}`;
}

function serializeRecord(record) {
  return `${canonicalJson(record)}\n`;
}

// ---------------------------------------------------------------------------
// Repository locations
// ---------------------------------------------------------------------------

function canonicalPayloadDir(repoRoot = paths.REPO_ROOT) {
  return path.join(repoRoot, "platform", "functions", "src", "scripts", "assessments");
}

function retainedRecordDir(repoRoot = paths.REPO_ROOT) {
  return path.join(repoRoot, "platform", "functions", "src", "scripts", "assessment-presentations");
}

function reviewDir(repoRoot = paths.REPO_ROOT) {
  return path.join(repoRoot, "lesson-sources", "variants", "reviews");
}

// Loads the committed canonical payload for an assessment revision id
// (assessment_<slug>__r<N> -> <slug>.r<N>.json), or null when none exists.
function loadCanonicalPayload(assessmentRevisionId, { repoRoot = paths.REPO_ROOT } = {}) {
  const m = REVISION_ID_PATTERN.exec(String(assessmentRevisionId || ""));
  if (!m) return null;
  const file = path.join(canonicalPayloadDir(repoRoot), `${m[1]}.r${m[2]}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function unknownKeys(obj, allowed) {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

function findCorrectnessKeys(value, at, out) {
  if (Array.isArray(value)) {
    value.forEach((v, i) => findCorrectnessKeys(v, `${at}[${i}]`, out));
  } else if (isPlainObject(value)) {
    for (const key of Object.keys(value)) {
      if (CORRECTNESS_KEYS.includes(key)) out.push(`${at}.${key}`);
      findCorrectnessKeys(value[key], `${at}.${key}`, out);
    }
  }
  return out;
}

// Minimal structural reading of the canonical payload (the committed
// deployment payload, which includes correctOptionId). Used only to verify
// the presentation; nothing from the answer key is copied into the record.
function canonicalItems(payload) {
  if (!isPlainObject(payload) || !Array.isArray(payload.items) || payload.items.length === 0) {
    return { error: "canonical payload has no items" };
  }
  const items = [];
  for (const it of payload.items) {
    if (!isPlainObject(it) || !isNonEmptyString(it.itemId) || !Array.isArray(it.options)) {
      return { error: "canonical payload item is malformed" };
    }
    items.push({
      itemId: it.itemId,
      itemType: it.itemType,
      stem: it.stem,
      options: it.options.map((o) => ({ optionId: o.optionId, text: o.text })),
      correctOptionId: it.correctOptionId,
    });
  }
  return { items };
}

// Validates a record against its canonical payload. Pure. Returns
// { ok, failures, warnings }. Failures fail closed; warnings are reported.
function validateAssessmentPresentation(record, canonicalPayload) {
  const failures = [];
  const warnings = [];
  const fail = (m) => failures.push(m);

  if (!isPlainObject(record)) {
    return { ok: false, failures: ["record must be a JSON object"], warnings };
  }
  const leaked = findCorrectnessKeys(record, "record", []);
  for (const at of leaked) fail(`correctness data is not allowed in an assessment presentation: ${at}`);
  for (const k of unknownKeys(record, RECORD_KEYS)) fail(`unknown record field "${k}"`);
  try {
    canonicalJson(record);
  } catch (err) {
    fail(err.message);
  }
  if (record.schemaVersion !== SCHEMA_VERSION) fail(`schemaVersion must be ${SCHEMA_VERSION}`);
  if (record.kind !== RECORD_KIND) fail(`kind must be "${RECORD_KIND}"`);
  if (typeof record.lessonSlug !== "string" || !LESSON_SLUG_PATTERN.test(record.lessonSlug)) {
    fail("lessonSlug must be lowercase kebab-case");
  }
  const rev = REVISION_ID_PATTERN.exec(String(record.assessmentRevisionId || ""));
  if (!rev) {
    fail("assessmentRevisionId must be assessment_<slug>__r<N>");
  } else if (rev[1] !== record.lessonSlug) {
    fail(`assessmentRevisionId ${record.assessmentRevisionId} does not belong to lesson "${record.lessonSlug}"`);
  }
  if (canonicalPayload === null || canonicalPayload === undefined) {
    fail(`assessment revision ${record.assessmentRevisionId} has no committed canonical payload`);
    return { ok: false, failures, warnings };
  }
  const canon = canonicalItems(canonicalPayload);
  if (canon.error) {
    fail(canon.error);
    return { ok: false, failures, warnings };
  }
  if (rev && (canonicalPayload.activityId !== rev[1] || canonicalPayload.revisionOrdinal !== Number(rev[2]))) {
    fail(`canonical payload identity does not match ${record.assessmentRevisionId}`);
  }

  // Traits
  const traits = isPlainObject(record.traits) ? record.traits : null;
  if (!traits) {
    fail("traits must be an object { language, choiceCount }");
    return { ok: false, failures, warnings };
  }
  for (const k of unknownKeys(traits, TRAIT_KEYS)) fail(`unknown traits field "${k}"`);
  const language = traits.language;
  const choiceCount = traits.choiceCount;
  if (!LANGUAGE_TRAITS.includes(language)) fail(`traits.language must be one of ${LANGUAGE_TRAITS.join(", ")}`);
  if (!Number.isInteger(choiceCount) || choiceCount < 2) fail("traits.choiceCount must be an integer of at least 2");

  const canonicalOptionCounts = new Set(canon.items.map((it) => it.options.length));
  if (canonicalOptionCounts.size !== 1) {
    fail("canonical items do not share one option count; reduced-choice presentation needs a uniform canonical option count");
  }
  const canonicalOptionCount = [...canonicalOptionCounts][0];
  if (Number.isInteger(choiceCount) && choiceCount > canonicalOptionCount) {
    fail(`traits.choiceCount ${choiceCount} exceeds the canonical option count ${canonicalOptionCount}`);
  }
  if (language === "canonical" && choiceCount === canonicalOptionCount) {
    fail("traits describe the canonical presentation itself (canonical language, full choice count); no assessment presentation is needed");
  }

  // Assessment-level directions
  if (record.directions !== null && !isNonEmptyString(record.directions)) {
    fail("directions must be null or a non-empty string");
  }
  if (language === "canonical" && record.directions !== null) {
    fail("directions must be null when traits.language is canonical");
  }

  // Items: exact canonical coverage, canonical order
  if (!Array.isArray(record.items)) {
    fail("items must be an array");
    return { ok: false, failures, warnings };
  }
  const canonById = new Map(canon.items.map((it) => [it.itemId, it]));
  const seenItems = new Set();
  const displayedCorrectPositions = [];
  record.items.forEach((item, i) => {
    const at = `items[${i}]`;
    if (!isPlainObject(item)) {
      fail(`${at} must be an object`);
      return;
    }
    for (const k of unknownKeys(item, ITEM_KEYS)) fail(`${at} unknown field "${k}"`);
    const c = canonById.get(item.itemId);
    if (!c) {
      fail(`${at} itemId "${item.itemId}" is not an item of ${record.assessmentRevisionId}`);
      return;
    }
    if (seenItems.has(item.itemId)) {
      fail(`${at} itemId "${item.itemId}" is duplicated`);
      return;
    }
    seenItems.add(item.itemId);
    if (canon.items[i] && canon.items[i].itemId !== item.itemId) {
      fail(`${at} itemId "${item.itemId}" is out of canonical order (expected "${canon.items[i].itemId}")`);
    }
    if (!SUPPORTED_ITEM_TYPES.includes(c.itemType)) {
      fail(`${at} item "${item.itemId}" has unsupported itemType "${c.itemType}"`);
      return;
    }
    if (!isNonEmptyString(item.stem)) fail(`${at} stem must be a non-empty string`);
    if (language === "canonical" && item.stem !== c.stem) {
      fail(`${at} stem must equal the canonical stem when traits.language is canonical`);
    }
    if (item.feedback !== null && !isNonEmptyString(item.feedback)) {
      fail(`${at} feedback must be null or a non-empty string`);
    }
    if (language === "canonical" && item.feedback !== null) {
      fail(`${at} feedback must be null when traits.language is canonical (the canonical explanation applies)`);
    }

    const canonOptionIds = c.options.map((o) => o.optionId);
    const canonTextById = new Map(c.options.map((o) => [o.optionId, o.text]));
    const displayed = Array.isArray(item.displayedOptions) ? item.displayedOptions : null;
    const omitted = Array.isArray(item.omittedOptions) ? item.omittedOptions : null;
    if (!displayed) fail(`${at} displayedOptions must be an array`);
    if (!omitted) fail(`${at} omittedOptions must be an array`);
    if (!displayed || !omitted) return;

    const displayedIds = [];
    displayed.forEach((opt, oi) => {
      const oat = `${at}.displayedOptions[${oi}]`;
      if (!isPlainObject(opt)) {
        fail(`${oat} must be an object`);
        return;
      }
      for (const k of unknownKeys(opt, OPTION_KEYS)) fail(`${oat} unknown field "${k}"`);
      if (!canonOptionIds.includes(opt.optionId)) {
        fail(`${oat} optionId "${opt.optionId}" is not an option of item "${item.itemId}"`);
      } else if (displayedIds.includes(opt.optionId)) {
        fail(`${oat} optionId "${opt.optionId}" is displayed more than once`);
      }
      displayedIds.push(opt.optionId);
      if (!isNonEmptyString(opt.text)) fail(`${oat} text must be a non-empty string`);
      if (language === "canonical" && opt.text !== canonTextById.get(opt.optionId)) {
        fail(`${oat} text must equal the canonical option text when traits.language is canonical`);
      }
    });
    if (Number.isInteger(choiceCount) && displayed.length !== choiceCount) {
      fail(`${at} displays ${displayed.length} options; traits.choiceCount is ${choiceCount}`);
    }
    if (!displayedIds.includes(c.correctOptionId)) {
      fail(`${at} does not display the canonical correct option (a presentation may never omit it)`);
    } else {
      displayedCorrectPositions.push(displayedIds.indexOf(c.correctOptionId));
    }

    const omittedIds = [];
    omitted.forEach((om, mi) => {
      const mat = `${at}.omittedOptions[${mi}]`;
      if (!isPlainObject(om)) {
        fail(`${mat} must be an object`);
        return;
      }
      for (const k of unknownKeys(om, OMITTED_KEYS)) fail(`${mat} unknown field "${k}"`);
      if (!canonOptionIds.includes(om.optionId)) {
        fail(`${mat} optionId "${om.optionId}" is not an option of item "${item.itemId}"`);
      } else if (displayedIds.includes(om.optionId)) {
        fail(`${mat} optionId "${om.optionId}" is both omitted and displayed`);
      } else if (omittedIds.includes(om.optionId)) {
        fail(`${mat} optionId "${om.optionId}" is omitted more than once`);
      } else if (om.optionId === c.correctOptionId) {
        fail(`${mat} omits the canonical correct option`);
      }
      omittedIds.push(om.optionId);
      if (!isNonEmptyString(om.rationale)) fail(`${mat} rationale must be a non-empty string`);
    });
    const accounted = new Set([...displayedIds, ...omittedIds]);
    const missing = canonOptionIds.filter((id) => !accounted.has(id));
    if (missing.length > 0) {
      fail(`${at} canonical option(s) ${missing.join(", ")} are neither displayed nor explicitly omitted`);
    }
  });
  const missingItems = canon.items.filter((it) => !seenItems.has(it.itemId)).map((it) => it.itemId);
  if (missingItems.length > 0) fail(`items are incomplete: missing ${missingItems.join(", ")}`);

  // Show Your Thinking
  const syt = record.showYourThinking;
  if (language === "canonical") {
    if (syt !== null) fail("showYourThinking must be null when traits.language is canonical (the canonical prompt applies)");
  } else if (!isPlainObject(syt)) {
    fail("showYourThinking must be an object { prompt, modelAnswer, requiredTerms } when traits.language is adapted");
  } else {
    for (const k of unknownKeys(syt, SYT_KEYS)) fail(`showYourThinking unknown field "${k}"`);
    if (!isNonEmptyString(syt.prompt)) fail("showYourThinking.prompt must be a non-empty string");
    if (!isNonEmptyString(syt.modelAnswer)) fail("showYourThinking.modelAnswer must be a non-empty string");
    if (!Array.isArray(syt.requiredTerms) || !syt.requiredTerms.every(isNonEmptyString)) {
      fail("showYourThinking.requiredTerms must be an array of non-empty strings");
    } else if (isNonEmptyString(syt.prompt)) {
      for (const term of syt.requiredTerms) {
        if (!syt.prompt.toLowerCase().includes(term.toLowerCase())) {
          fail(`showYourThinking.prompt does not contain required term "${term}"`);
        }
      }
    }
  }

  // Answer-position quality of the DISPLAYED order (Slice 1 standard). Only
  // meaningful once every item displays its correct option.
  if (failures.length === 0 && displayedCorrectPositions.length === canon.items.length) {
    const quality = evaluateDistribution(displayedCorrectPositions, choiceCount);
    for (const f of quality.hard) fail(`displayed answer positions: ${f.code} - ${f.detail}`);
    for (const f of quality.warnings) warnings.push(`displayed answer positions: ${f.code} - ${f.detail}`);
  }

  // Answer-cue heuristics on the displayed wording (section 11 check 9).
  // Under adapted language the author controls every word, so a hard cue
  // fails. Under canonical language the wording IS the canonical revision's,
  // which a presentation cannot change, so cues are reported as warnings.
  if (failures.length === 0) {
    const cues = answerCueFindings(record, canonicalPayload);
    for (const it of cues.items) {
      for (const f of it.presentation.hard) {
        const line = `${it.itemId} answer cue: ${f.code} - ${f.detail}`;
        if (language === "adapted") fail(line);
        else warnings.push(line);
      }
      for (const f of it.presentation.warnings) warnings.push(`${it.itemId} answer cue: ${f.code} - ${f.detail}`);
    }
    for (const f of cues.assessment) warnings.push(`answer cue: ${f.code} - ${f.detail}`);
  }

  return { ok: failures.length === 0, failures, warnings };
}

// ---------------------------------------------------------------------------
// Answer-cue heuristics (section 11 check 9; F5.3 Slice 6A)
// ---------------------------------------------------------------------------
//
// Deterministic, wording-only checks. They never rewrite content; they list
// findings for the human reviewer, who certifies `noAnswerCueing` in any case.
//
// HARD (fails an adapted-language presentation):
//   LENGTH_CUE       the correct choice is uniquely the longest displayed
//                    choice and at least CUE_LENGTH_RATIO_FAIL (1.5) times the
//                    length of the next longest (characters, trimmed).
//   ANSWER_MARKER    a displayed choice contains marker text: the words
//                    correct / incorrect / answer(s), or a check, cross, or
//                    star symbol.
// WARNING (always listed, never fails):
//   LENGTH_LONGEST   the correct choice is uniquely the longest at a ratio of
//                    at least CUE_LENGTH_RATIO_WARN (1.3) but below 1.5.
//   STEM_ECHO        a distinctive stem word (4+ letters, not a stop word)
//                    appears in the correct choice and in no displayed
//                    distractor. Words match when they share a prefix of at
//                    least 4 letters that covers all but at most 2 letters of
//                    the shorter word (dense / denser / densest, plate /
//                    plates, flow / flows / flowing).
//   ABSOLUTE_QUALIFIER  at least one displayed distractor uses an absolute
//                    (always, never, only, all, none, every, exactly,
//                    completely, entirely, no) and the correct choice uses
//                    none: a test-wise elimination cue.
//   ALL_NONE_OF_ABOVE   a displayed choice is "all/none/both of the above"
//                    (or "of these").
//   ARTICLE_AGREEMENT   the stem ends in "a" or "an", the correct choice agrees
//                    with it, and at least one distractor does not.
// ASSESSMENT-LEVEL WARNING:
//   LONGEST_ANSWER_BIAS  the correct choice is uniquely the longest on more
//                    than ceil(n / k) items.
//
// Every finding is also computed on the canonical four-choice item, so the
// reviewer can tell an inherited canonical cue from one the presentation
// introduced.

const CUE_LENGTH_RATIO_FAIL = 1.5;
const CUE_LENGTH_RATIO_WARN = 1.3;
const CUE_STOP_WORDS = Object.freeze(new Set([
  "about", "above", "after", "again", "also", "always", "because", "been", "before", "being", "best", "both",
  "choose", "could", "describe", "describes", "does", "doing", "down", "during", "each", "even", "every",
  "explain", "explains", "following", "from", "happen", "happens", "have", "having", "here", "into", "just",
  "make", "makes", "many", "more", "most", "much", "must", "never", "only", "other", "over", "question", "same",
  "sentence", "should", "some", "statement", "such", "than", "that", "their", "them", "then", "there", "these",
  "they", "this", "those", "through", "true", "under", "until", "very", "were", "what", "when", "where",
  "which", "while", "will", "with", "would", "your",
]));
const CUE_ABSOLUTES = Object.freeze(["always", "never", "only", "all", "none", "every", "exactly", "completely", "entirely", "no"]);
const CUE_MARKER_WORDS = /\b(correct|incorrect|answers?)\b/i;
const CUE_MARKER_SYMBOLS = /[✓✔✗✘★☆]/;
const CUE_ALL_NONE = /\b(?:all|none|both)\s+of\s+(?:the\s+above|these|them)\b/i;

function cueWords(text) {
  return String(text)
    .normalize("NFC")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z0-9']+/)
    .map((w) => w.replace(/'s$/, "").replace(/'/g, ""))
    .filter(Boolean);
}

function distinctiveWords(text) {
  return [...new Set(cueWords(text).filter((w) => w.length >= 4 && !CUE_STOP_WORDS.has(w)))];
}

function wordsMatch(a, b) {
  if (a === b) return true;
  const shorter = Math.min(a.length, b.length);
  let lcp = 0;
  while (lcp < shorter && a[lcp] === b[lcp]) lcp += 1;
  return lcp >= 4 && lcp >= shorter - 2;
}

function textHasWord(text, word) {
  return cueWords(text).some((w) => w.length >= 4 && wordsMatch(w, word));
}

function charLength(text) {
  return [...String(text).trim()].length;
}

// Pure: cue findings for one displayed item. `choices` are { optionId, text }
// in display order; `correctOptionId` comes from the canonical payload and is
// used only for this analysis.
function itemCueFindings({ stem, choices, correctOptionId }) {
  const hard = [];
  const warnings = [];
  const correct = choices.find((c) => c.optionId === correctOptionId);
  const distractors = choices.filter((c) => c.optionId !== correctOptionId);
  if (!correct || distractors.length === 0) return { hard, warnings, correctUniquelyLongest: false };

  const correctLen = charLength(correct.text);
  const longestDistractor = Math.max(...distractors.map((d) => charLength(d.text)));
  const correctUniquelyLongest = correctLen > longestDistractor;
  if (correctUniquelyLongest) {
    const ratio = longestDistractor > 0 ? correctLen / longestDistractor : Infinity;
    const detail = `correct ${correctOptionId} is ${correctLen} characters, next longest ${longestDistractor} (ratio ${ratio.toFixed(2)})`;
    if (ratio >= CUE_LENGTH_RATIO_FAIL) hard.push({ code: "LENGTH_CUE", detail: `${detail}; threshold ${CUE_LENGTH_RATIO_FAIL}` });
    else if (ratio >= CUE_LENGTH_RATIO_WARN) warnings.push({ code: "LENGTH_LONGEST", detail });
  }

  for (const c of choices) {
    if (CUE_MARKER_WORDS.test(c.text) || CUE_MARKER_SYMBOLS.test(c.text)) {
      hard.push({ code: "ANSWER_MARKER", detail: `choice ${c.optionId} contains answer-marker text: ${JSON.stringify(c.text)}` });
    }
    if (CUE_ALL_NONE.test(c.text)) {
      warnings.push({ code: "ALL_NONE_OF_ABOVE", detail: `choice ${c.optionId} is an all/none/both-of-the-above choice` });
    }
  }

  const echoed = distinctiveWords(stem).filter(
    (w) => textHasWord(correct.text, w) && !distractors.some((d) => textHasWord(d.text, w)),
  );
  if (echoed.length > 0) {
    warnings.push({ code: "STEM_ECHO", detail: `stem word(s) ${echoed.map((w) => `"${w}"`).join(", ")} appear in correct ${correctOptionId} and in no displayed distractor` });
  }

  const absolutesIn = (text) => CUE_ABSOLUTES.filter((a) => cueWords(text).includes(a));
  const flagged = distractors.map((d) => ({ id: d.optionId, found: absolutesIn(d.text) })).filter((d) => d.found.length > 0);
  if (flagged.length > 0 && absolutesIn(correct.text).length === 0) {
    warnings.push({
      code: "ABSOLUTE_QUALIFIER",
      detail: `distractor(s) ${flagged.map((d) => `${d.id} (${d.found.join(", ")})`).join("; ")} use absolute qualifiers; correct ${correctOptionId} uses none`,
    });
  }

  const article = /\b(a|an)\s*[_.:…]*\s*$/i.exec(String(stem).trim());
  if (article) {
    const wantsVowel = article[1].toLowerCase() === "an";
    const agrees = (text) => /^[aeiou]/i.test(String(text).trim()) === wantsVowel;
    if (agrees(correct.text) && distractors.some((d) => !agrees(d.text))) {
      warnings.push({ code: "ARTICLE_AGREEMENT", detail: `stem ends in "${article[1]}"; correct ${correctOptionId} agrees and at least one distractor does not` });
    }
  }
  return { hard, warnings, correctUniquelyLongest };
}

// Pure: cue findings for every item of a presentation (as displayed) and of
// its canonical four-choice item (the baseline), plus assessment-level bias.
function answerCueFindings(record, canonicalPayload) {
  const byId = new Map(canonicalPayload.items.map((it) => [it.itemId, it]));
  const items = [];
  let longestCount = 0;
  let canonicalLongestCount = 0;
  for (const item of record.items) {
    const c = byId.get(item.itemId);
    const presentation = itemCueFindings({ stem: item.stem, choices: item.displayedOptions, correctOptionId: c.correctOptionId });
    const canonical = itemCueFindings({ stem: c.stem, choices: c.options, correctOptionId: c.correctOptionId });
    if (presentation.correctUniquelyLongest) longestCount += 1;
    if (canonical.correctUniquelyLongest) canonicalLongestCount += 1;
    items.push({ itemId: item.itemId, presentation, canonical });
  }
  const assessment = [];
  const k = record.traits && Number.isInteger(record.traits.choiceCount) ? record.traits.choiceCount : 0;
  const cap = k > 0 ? Math.ceil(record.items.length / k) : Infinity;
  if (longestCount > cap) {
    assessment.push({ code: "LONGEST_ANSWER_BIAS", detail: `the correct choice is uniquely the longest on ${longestCount} of ${record.items.length} items (more than ${cap})` });
  }
  return { items, assessment, longestCount, canonicalLongestCount };
}

// ---------------------------------------------------------------------------
// Identical-to-canonical text (review aid; F5.3 Slice 6A)
// ---------------------------------------------------------------------------
//
// Under adapted language, lists every student-facing string that is exactly
// the canonical string, or equal to it after case, whitespace, and
// punctuation are ignored, or that falls back to canonical content because
// the record leaves it null. Never a failure: a short term such as "The
// asthenosphere" is often right to keep. The reviewer decides; an authoring
// note may give the author's reason (assessmentPresentationReview.cjs).
// `canonicalLesson` supplies what the payload does not hold:
// { directions, showYourThinking: { prompt, modelAnswer } | null } as plain text.

function comparableText(text) {
  return String(text).normalize("NFC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function compareText(field, adapted, canonical) {
  if (canonical === null || canonical === undefined) return null;
  if (adapted === null || adapted === undefined) return { field, kind: "canonicalUsed", text: canonical };
  if (adapted === canonical) return { field, kind: "identical", text: adapted };
  if (comparableText(adapted) === comparableText(canonical)) return { field, kind: "identicalAfterNormalization", text: adapted, canonical };
  return null;
}

function identicalTextFindings(record, canonicalPayload, canonicalLesson = {}) {
  const findings = [];
  if (!record.traits || record.traits.language !== "adapted") return findings;
  const push = (f) => {
    if (f) findings.push(f);
  };
  push(compareText("directions", record.directions, canonicalLesson.directions));
  const byId = new Map(canonicalPayload.items.map((it) => [it.itemId, it]));
  for (const item of record.items) {
    const c = byId.get(item.itemId);
    push(compareText(`${item.itemId}.stem`, item.stem, c.stem));
    const textById = new Map(c.options.map((o) => [o.optionId, o.text]));
    for (const o of item.displayedOptions) push(compareText(`${item.itemId}.option:${o.optionId}`, o.text, textById.get(o.optionId)));
    push(compareText(`${item.itemId}.feedback`, item.feedback, c.explanation));
  }
  const canonicalSyt = canonicalLesson.showYourThinking;
  if (record.showYourThinking && canonicalSyt) {
    push(compareText("showYourThinking.prompt", record.showYourThinking.prompt, canonicalSyt.prompt));
    push(compareText("showYourThinking.modelAnswer", record.showYourThinking.modelAnswer, canonicalSyt.modelAnswer));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Required-term equivalence (section 9.2; F5.3 Slice 6A)
// ---------------------------------------------------------------------------
//
// Every required term must appear in BOTH the canonical and the adapted Show
// Your Thinking prompt (case-insensitive substring, the same matching the
// renderer uses to emphasize the term). validateAssessmentPresentation checks
// the adapted side from the record alone; the canonical prompt lives in the
// lesson, so the renderer and the review tooling pass it here.

function requiredTermEquivalence(showYourThinking, canonicalShowYourThinking) {
  const failures = [];
  const terms = [];
  if (!showYourThinking) return { ok: true, failures, terms };
  if (!canonicalShowYourThinking || !isNonEmptyString(canonicalShowYourThinking.prompt)) {
    failures.push("the canonical lesson has no Show Your Thinking prompt to compare the required terms against");
    return { ok: false, failures, terms };
  }
  const has = (text, term) => isNonEmptyString(text) && text.toLowerCase().includes(term.toLowerCase());
  for (const term of showYourThinking.requiredTerms || []) {
    const row = {
      term,
      canonicalPrompt: has(canonicalShowYourThinking.prompt, term),
      adaptedPrompt: has(showYourThinking.prompt, term),
      canonicalModelAnswer: has(canonicalShowYourThinking.modelAnswer, term),
      adaptedModelAnswer: has(showYourThinking.modelAnswer, term),
    };
    terms.push(row);
    if (!row.canonicalPrompt) failures.push(`required term "${term}" is not in the canonical Show Your Thinking prompt`);
    if (!row.adaptedPrompt) failures.push(`required term "${term}" is not in the adapted Show Your Thinking prompt`);
  }
  return { ok: failures.length === 0, failures, terms };
}

// ---------------------------------------------------------------------------
// Retained record files
// ---------------------------------------------------------------------------

// Verifies one retained record file: name, exact canonical bytes, identity,
// and full validation against its committed canonical payload.
function verifyRetainedRecord(fileName, { repoRoot = paths.REPO_ROOT } = {}) {
  const failures = [];
  const id = fileName.replace(/\.json$/, "");
  if (!AP_ID_PATTERN.test(id) || `${id}.json` !== fileName) {
    return { ok: false, failures: [`${fileName}: retained record files must be named ap<sha256>.json`], warnings: [] };
  }
  const bytes = fs.readFileSync(path.join(retainedRecordDir(repoRoot), fileName), "utf8");
  let record;
  try {
    record = JSON.parse(bytes);
  } catch (err) {
    return { ok: false, failures: [`${fileName}: not valid JSON (${err.message})`], warnings: [] };
  }
  let canonicalBytes = null;
  try {
    canonicalBytes = serializeRecord(record);
  } catch (err) {
    failures.push(`${fileName}: ${err.message}`);
  }
  if (canonicalBytes !== null) {
    if (bytes !== canonicalBytes) failures.push(`${fileName}: file bytes are not the canonical serialization`);
    const actualId = assessmentPresentationRevisionIdFor(record);
    if (actualId !== id) failures.push(`${fileName}: content hashes to ${actualId}, not ${id}`);
  }
  const result = validateAssessmentPresentation(record, loadCanonicalPayload(record.assessmentRevisionId, { repoRoot }));
  for (const f of result.failures) failures.push(`${fileName}: ${f}`);
  return { ok: failures.length === 0, failures, warnings: result.warnings.map((w) => `${fileName}: ${w}`), record };
}

function verifyRetainedRecords({ repoRoot = paths.REPO_ROOT } = {}) {
  const dir = retainedRecordDir(repoRoot);
  if (!fs.existsSync(dir)) return { ok: true, failures: [], warnings: [], count: 0 };
  const failures = [];
  const warnings = [];
  const files = fs.readdirSync(dir).filter((f) => !f.startsWith(".")).sort();
  for (const f of files) {
    if (!f.endsWith(".json")) {
      failures.push(`${f}: unexpected file in the retained assessment-presentation directory`);
      continue;
    }
    const r = verifyRetainedRecord(f, { repoRoot });
    failures.push(...r.failures);
    warnings.push(...r.warnings);
  }
  return { ok: failures.length === 0, failures, warnings, count: files.length };
}

// ---------------------------------------------------------------------------
// Human certification (review record)
// ---------------------------------------------------------------------------

const REVIEW_KEYS = Object.freeze([
  "schemaVersion", "assessmentPresentationRevisionId", "reviewer", "reviewedAt", "determination", "criteria", "items",
]);
const REVIEWER_KEYS = Object.freeze(["role", "reviewerId"]);
const REVIEW_DETERMINATIONS = Object.freeze(["approved", "changesRequested", "rejected"]);
const CRITERION_RESULTS = Object.freeze(["pass", "fail", "notApplicable"]);
const REVIEW_CRITERIA = Object.freeze([
  "scientificAccuracy",
  "standardAndLearningTargetPreserved",
  "cognitiveDemandPreserved",
  "correctAnswerEquivalence",
  "distractorMisconceptionEquivalence",
  "omittedDistractorAppropriate",
  "noAnswerCueing",
  "showYourThinkingEquivalence",
  "explanationEquivalence",
]);
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/;

// Which criteria apply to a given record (the rest must be notApplicable).
function applicableCriteria(record) {
  const traits = (record && record.traits) || {};
  const reduced = (record.items || []).some((it) => Array.isArray(it.omittedOptions) && it.omittedOptions.length > 0);
  const hasFeedback = (record.items || []).some((it) => it.feedback !== null && it.feedback !== undefined);
  return new Set(
    REVIEW_CRITERIA.filter((c) => {
      if (c === "omittedDistractorAppropriate") return reduced;
      if (c === "showYourThinkingEquivalence") return traits.language === "adapted";
      if (c === "explanationEquivalence") return hasFeedback;
      return true;
    }),
  );
}

// Validates a review record against the exact record it certifies. The
// reviewer is a generic role + opaque identifier; no person is hardcoded.
function validateReview(review, record, assessmentPresentationRevisionId) {
  const failures = [];
  const fail = (m) => failures.push(m);
  if (!isPlainObject(review)) return { ok: false, approved: false, failures: ["review must be a JSON object"] };
  for (const k of unknownKeys(review, REVIEW_KEYS)) fail(`review unknown field "${k}"`);
  if (review.schemaVersion !== 1) fail("review schemaVersion must be 1");
  if (review.assessmentPresentationRevisionId !== assessmentPresentationRevisionId) {
    fail(`review certifies ${review.assessmentPresentationRevisionId}, not ${assessmentPresentationRevisionId}`);
  }
  const reviewer = review.reviewer;
  if (!isPlainObject(reviewer) || !isNonEmptyString(reviewer.role) || !isNonEmptyString(reviewer.reviewerId)) {
    fail("reviewer must be { role, reviewerId } with non-empty strings");
  } else {
    for (const k of unknownKeys(reviewer, REVIEWER_KEYS)) fail(`reviewer unknown field "${k}"`);
  }
  if (typeof review.reviewedAt !== "string" || !ISO_UTC.test(review.reviewedAt) || Number.isNaN(Date.parse(review.reviewedAt))) {
    fail("reviewedAt must be an ISO-8601 UTC timestamp");
  }
  if (!REVIEW_DETERMINATIONS.includes(review.determination)) {
    fail(`determination must be one of ${REVIEW_DETERMINATIONS.join(", ")}`);
  }
  const applicable = applicableCriteria(record || {});
  const criteria = isPlainObject(review.criteria) ? review.criteria : null;
  if (!criteria) {
    fail("criteria must be an object");
  } else {
    for (const k of unknownKeys(criteria, REVIEW_CRITERIA)) fail(`criteria unknown criterion "${k}"`);
    for (const c of REVIEW_CRITERIA) {
      const entry = criteria[c];
      if (!isPlainObject(entry) || !CRITERION_RESULTS.includes(entry.result)) {
        fail(`criteria.${c} must be { result: pass | fail | notApplicable, notes? }`);
        continue;
      }
      if (entry.notes !== undefined && typeof entry.notes !== "string") fail(`criteria.${c}.notes must be a string`);
      if (applicable.has(c) && entry.result === "notApplicable") fail(`criteria.${c} applies to this presentation and cannot be notApplicable`);
      if (!applicable.has(c) && entry.result !== "notApplicable") fail(`criteria.${c} does not apply to this presentation and must be notApplicable`);
    }
  }
  const recordItemIds = ((record && record.items) || []).map((it) => it.itemId);
  if (!Array.isArray(review.items)) {
    fail("items must be an array of per-item determinations");
  } else {
    const reviewed = review.items.map((it) => (isPlainObject(it) ? it.itemId : undefined));
    const missing = recordItemIds.filter((id) => !reviewed.includes(id));
    if (missing.length > 0) fail(`review does not cover item(s) ${missing.join(", ")}`);
    review.items.forEach((it, i) => {
      if (!isPlainObject(it) || !recordItemIds.includes(it.itemId)) fail(`items[${i}] names no item of the presentation`);
      else if (!["pass", "fail"].includes(it.result)) fail(`items[${i}].result must be pass or fail`);
    });
  }
  if (review.determination === "approved" && failures.length === 0) {
    const anyCriterionFail = REVIEW_CRITERIA.some((c) => criteria[c].result === "fail");
    const anyItemFail = review.items.some((it) => it.result === "fail");
    if (anyCriterionFail || anyItemFail) fail("an approved review cannot contain a failed criterion or item");
  }
  return { ok: failures.length === 0, approved: failures.length === 0 && review.determination === "approved", failures };
}

function loadReview(assessmentPresentationRevisionId, { repoRoot = paths.REPO_ROOT } = {}) {
  const file = path.join(reviewDir(repoRoot), `${assessmentPresentationRevisionId}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

// ---------------------------------------------------------------------------
// Manifest binding (instructional presentation -> assessment presentation)
// ---------------------------------------------------------------------------

// Verifies the optional binding on a variant manifest entry. An entry with
// neither field is a pre-F5.3 entry and keeps its F5.2 meaning
// (differentiated instruction, canonical assessment). An entry with the
// binding must name a retained, valid record for the same lesson and
// assessment revision, certified by an approved review.
function verifyManifestBinding(entry, { repoRoot = paths.REPO_ROOT } = {}) {
  const hasRev = entry.assessmentRevisionId !== undefined;
  const hasAp = entry.assessmentPresentationRevisionId !== undefined;
  if (!hasRev && !hasAp) return [];
  const where = `manifest entry ${entry.path}`;
  if (hasRev !== hasAp) {
    return [`${where}: assessmentRevisionId and assessmentPresentationRevisionId must be present together`];
  }
  const apId = entry.assessmentPresentationRevisionId;
  if (typeof apId !== "string" || !AP_ID_PATTERN.test(apId)) {
    return [`${where}: assessmentPresentationRevisionId must be ap<sha256>`];
  }
  if (typeof entry.assessmentRevisionId !== "string" || !REVISION_ID_PATTERN.test(entry.assessmentRevisionId)) {
    return [`${where}: assessmentRevisionId must be assessment_<slug>__r<N>`];
  }
  const checked = checkCertifiedPresentation(apId, {
    repoRoot,
    lessonSlug: entry.lessonSlug,
    assessmentRevisionId: entry.assessmentRevisionId,
  });
  return checked.failures.map((f) => `${where}: ${f}`);
}

// The ONE "retained, valid, certified" check, shared by the manifest binding
// and the build-time renderer (F5.3 Slice 4). Returns { record, failures }:
// `record` is the retained record whenever it could be read (even if other
// checks failed), `failures` is empty only when the record is retained under
// its content-addressed name, byte-canonical, valid against its committed
// canonical payload, belongs to the expected lesson and assessment revision,
// and is certified by an approved review of this exact id.
function checkCertifiedPresentation(apId, { repoRoot = paths.REPO_ROOT, lessonSlug, assessmentRevisionId } = {}) {
  if (typeof apId !== "string" || !AP_ID_PATTERN.test(apId)) {
    return { record: null, failures: ["assessmentPresentationRevisionId must be ap<sha256>"] };
  }
  const file = `${apId}.json`;
  if (!fs.existsSync(path.join(retainedRecordDir(repoRoot), file))) {
    return { record: null, failures: [`bound assessment presentation ${apId} is not retained`] };
  }
  const retained = verifyRetainedRecord(file, { repoRoot });
  const failures = [...retained.failures];
  if (!retained.record) return { record: null, failures };
  if (lessonSlug !== undefined && retained.record.lessonSlug !== lessonSlug) {
    failures.push(`bound presentation belongs to lesson "${retained.record.lessonSlug}", not "${lessonSlug}"`);
  }
  if (assessmentRevisionId !== undefined && retained.record.assessmentRevisionId !== assessmentRevisionId) {
    failures.push(`bound presentation maps to ${retained.record.assessmentRevisionId}, not ${assessmentRevisionId}`);
  }
  const review = loadReview(apId, { repoRoot });
  if (review === null) {
    failures.push(`bound presentation ${apId} has no human certification review record`);
  } else {
    const r = validateReview(review, retained.record, apId);
    for (const f of r.failures) failures.push(`review: ${f}`);
    if (r.ok && !r.approved) failures.push(`bound presentation ${apId} is not approved (determination "${review.determination}")`);
  }
  return { record: retained.record, failures };
}

module.exports = {
  SCHEMA_VERSION,
  RECORD_KIND,
  AP_ID_PATTERN,
  LANGUAGE_TRAITS,
  CORRECTNESS_KEYS,
  REVIEW_CRITERIA,
  REVIEW_DETERMINATIONS,
  CUE_LENGTH_RATIO_FAIL,
  CUE_LENGTH_RATIO_WARN,
  canonicalJson,
  assessmentPresentationRevisionIdFor,
  serializeRecord,
  canonicalPayloadDir,
  retainedRecordDir,
  reviewDir,
  loadCanonicalPayload,
  validateAssessmentPresentation,
  itemCueFindings,
  answerCueFindings,
  identicalTextFindings,
  requiredTermEquivalence,
  verifyRetainedRecord,
  verifyRetainedRecords,
  applicableCriteria,
  validateReview,
  loadReview,
  verifyManifestBinding,
  checkCertifiedPresentation,
};
