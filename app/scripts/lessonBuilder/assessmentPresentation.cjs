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

  return { ok: failures.length === 0, failures, warnings };
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
  const file = `${apId}.json`;
  if (!fs.existsSync(path.join(retainedRecordDir(repoRoot), file))) {
    return [`${where}: bound assessment presentation ${apId} is not retained`];
  }
  const retained = verifyRetainedRecord(file, { repoRoot });
  const failures = retained.failures.map((f) => `${where}: ${f}`);
  if (!retained.record) return failures;
  if (retained.record.lessonSlug !== entry.lessonSlug) {
    failures.push(`${where}: bound presentation belongs to lesson "${retained.record.lessonSlug}", not "${entry.lessonSlug}"`);
  }
  if (retained.record.assessmentRevisionId !== entry.assessmentRevisionId) {
    failures.push(`${where}: bound presentation maps to ${retained.record.assessmentRevisionId}, not ${entry.assessmentRevisionId}`);
  }
  const review = loadReview(apId, { repoRoot });
  if (review === null) {
    failures.push(`${where}: bound presentation ${apId} has no human certification review record`);
  } else {
    const r = validateReview(review, retained.record, apId);
    for (const f of r.failures) failures.push(`${where}: review: ${f}`);
    if (r.ok && !r.approved) failures.push(`${where}: bound presentation ${apId} is not approved (determination "${review.determination}")`);
  }
  return failures;
}

module.exports = {
  SCHEMA_VERSION,
  RECORD_KIND,
  AP_ID_PATTERN,
  LANGUAGE_TRAITS,
  CORRECTNESS_KEYS,
  REVIEW_CRITERIA,
  REVIEW_DETERMINATIONS,
  canonicalJson,
  assessmentPresentationRevisionIdFor,
  serializeRecord,
  canonicalPayloadDir,
  retainedRecordDir,
  reviewDir,
  loadCanonicalPayload,
  validateAssessmentPresentation,
  verifyRetainedRecord,
  verifyRetainedRecords,
  applicableCriteria,
  validateReview,
  loadReview,
  verifyManifestBinding,
};
