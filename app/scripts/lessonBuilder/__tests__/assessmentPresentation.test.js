/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * F5.3 Slice 3 - immutable, content-addressed assessment presentations,
 * their human-certification review records, and the optional variant
 * manifest binding. All fixtures are synthetic and live in a temp repository
 * root; no canonical assessment, lesson, or variant content is touched.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");

const AP = require("../assessmentPresentation.cjs");

// F5.3 Slice 6B: the owner-certified Earth's Layers presentation and the
// historical unbound revision it must never disturb.
const EARTHS_LAYERS_AP = "ap1fed478c9e4ad8335946ff7f7b165df657bafc48e8c5990d922419581fa02c25";
const HISTORICAL_PR = "prff01d9d2cf71210c491afc60cf98cd3d69b91d5c64cae51aff2463b50892375c";
const manifestMod = require("../variantManifest.cjs");
const { sha256Hex } = require("../hash.cjs");

const SLUG = "synthetic-lesson";
const REVISION_ID = `assessment_${SLUG}__r1`;
const CANONICAL_CORRECT = "ACBDBADCAB"; // canonical correct optionIds (A3 B3 C2 D2)
const IDS = ["A", "B", "C", "D"];

function canonicalPayload(overrides = {}) {
  return {
    activityId: SLUG,
    revisionOrdinal: 1,
    itemOrderingRule: "authoredOrder",
    schemaVersion: 1,
    publishedBy: "synthetic",
    items: CANONICAL_CORRECT.split("").map((correct, i) => ({
      itemId: `q${i + 1}`,
      itemType: "singleChoice",
      stem: `Synthetic question ${i + 1}?`,
      options: IDS.map((id) => ({ optionId: id, text: `Option ${id} of q${i + 1}` })),
      points: 1,
      correctOptionId: correct,
      explanation: `Because ${correct}.`,
    })),
    ...overrides,
  };
}

// Adapted language, three displayed choices: the correct option plus two
// distractors in a designed display order; the alphabetically first
// distractor is deliberately omitted with a rationale.
const THREE_CHOICE_POSITIONS = [0, 1, 2, 1, 2, 0, 2, 0, 1, 2]; // A3 B3 C4, no runs, no cycle
function adaptedThreeChoice() {
  const payload = canonicalPayload();
  return {
    schemaVersion: 1,
    kind: "lyfelabz.assessmentPresentation",
    lessonSlug: SLUG,
    assessmentRevisionId: REVISION_ID,
    traits: { language: "adapted", choiceCount: 3 },
    directions: "Pick the best answer.",
    items: payload.items.map((item, i) => {
      const distractors = IDS.filter((id) => id !== item.correctOptionId);
      const [omitted, ...kept] = distractors;
      const shown = kept.map((id) => ({ optionId: id, text: `Easier ${id} ${i + 1}` }));
      shown.splice(THREE_CHOICE_POSITIONS[i], 0, { optionId: item.correctOptionId, text: `Easier ${item.correctOptionId} ${i + 1}` });
      return {
        itemId: item.itemId,
        stem: `Easier question ${i + 1}?`,
        displayedOptions: shown,
        omittedOptions: [{ optionId: omitted, rationale: `Distractor ${omitted} duplicates the misconception of another choice.` }],
        feedback: `Simpler explanation ${i + 1}.`,
      };
    }),
    showYourThinking: {
      prompt: "Explain how heat from the core causes convection in the mantle.",
      modelAnswer: "Heat rises, the mantle flows in convection currents, and the plates move.",
      requiredTerms: ["convection"],
    },
  };
}

function adaptedFourChoice() {
  const payload = canonicalPayload();
  const r = adaptedThreeChoice();
  r.traits = { language: "adapted", choiceCount: 4 };
  r.items = payload.items.map((item, i) => ({
    itemId: item.itemId,
    stem: `Easier question ${i + 1}?`,
    displayedOptions: IDS.map((id) => ({ optionId: id, text: `Easier ${id} ${i + 1}` })),
    omittedOptions: [],
    feedback: null,
  }));
  return r;
}

function canonicalThreeChoice() {
  const payload = canonicalPayload();
  const r = adaptedThreeChoice();
  r.traits = { language: "canonical", choiceCount: 3 };
  r.directions = null;
  r.showYourThinking = null;
  r.items = r.items.map((it, i) => ({
    ...it,
    stem: payload.items[i].stem,
    displayedOptions: it.displayedOptions.map((o) => ({ optionId: o.optionId, text: `Option ${o.optionId} of q${i + 1}` })),
    feedback: null,
  }));
  return r;
}

function validate(record, payload = canonicalPayload()) {
  return AP.validateAssessmentPresentation(record, payload);
}

function expectFailure(record, messagePart, payload) {
  const result = validate(record, payload);
  expect(result.ok).toBe(false);
  expect(result.failures.join("\n")).toContain(messagePart);
}

function approvedReview(record, apId) {
  const applicable = AP.applicableCriteria(record);
  const criteria = {};
  for (const c of AP.REVIEW_CRITERIA) criteria[c] = { result: applicable.has(c) ? "pass" : "notApplicable", notes: "" };
  return {
    schemaVersion: 1,
    assessmentPresentationRevisionId: apId,
    reviewer: { role: "scienceContentReviewer", reviewerId: "reviewer-001" },
    reviewedAt: "2026-09-28T12:00:00.000Z",
    determination: "approved",
    criteria,
    items: record.items.map((it) => ({ itemId: it.itemId, result: "pass" })),
  };
}

// Temp repository root with the synthetic canonical payload.
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ap-repo-"));
  fs.mkdirSync(AP.canonicalPayloadDir(root), { recursive: true });
  fs.writeFileSync(path.join(AP.canonicalPayloadDir(root), `${SLUG}.r1.json`), JSON.stringify(canonicalPayload()));
  return root;
}

function retain(root, record, name) {
  const id = AP.assessmentPresentationRevisionIdFor(record);
  fs.mkdirSync(AP.retainedRecordDir(root), { recursive: true });
  fs.writeFileSync(path.join(AP.retainedRecordDir(root), name || `${id}.json`), AP.serializeRecord(record));
  return id;
}

function writeReview(root, review) {
  fs.mkdirSync(AP.reviewDir(root), { recursive: true });
  fs.writeFileSync(path.join(AP.reviewDir(root), `${review.assessmentPresentationRevisionId}.json`), JSON.stringify(review));
}

function variantEntry(root, extra = {}) {
  const bytes = `<!-- synthetic variant ${JSON.stringify(extra)} -->\n`;
  const sha = sha256Hex(bytes);
  const rel = `app/lessons/variants/lesson_${SLUG}__pr${sha}.html`;
  fs.mkdirSync(path.join(root, "app", "lessons", "variants"), { recursive: true });
  fs.writeFileSync(path.join(root, rel), bytes);
  return { lessonSlug: SLUG, variantKey: "reading-adapted", presentationRevisionId: `pr${sha}`, path: rel, sha256: sha, publishedAt: "2026-09-28T00:00:00.000Z", ...extra };
}

let roots = [];
afterEach(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  roots = [];
});
function repo() {
  const r = makeRepo();
  roots.push(r);
  return r;
}

describe("content addressing", () => {
  test("the id is ap + sha256 of the canonical serialization, independent of key order", () => {
    const record = adaptedThreeChoice();
    const shuffled = {};
    for (const k of Object.keys(record).reverse()) shuffled[k] = record[k];
    const id = AP.assessmentPresentationRevisionIdFor(record);
    expect(id).toMatch(AP.AP_ID_PATTERN);
    expect(AP.assessmentPresentationRevisionIdFor(shuffled)).toBe(id);
    expect(id).toBe(`ap${sha256Hex(AP.canonicalJson(record))}`);
    expect(AP.serializeRecord(record)).toBe(`${AP.canonicalJson(record)}\n`);
  });

  test("any content change produces a different id", () => {
    const a = adaptedThreeChoice();
    const b = adaptedThreeChoice();
    b.items[0].stem = "Easier question 1 ?";
    expect(AP.assessmentPresentationRevisionIdFor(a)).not.toBe(AP.assessmentPresentationRevisionIdFor(b));
  });

  test("canonical serialization refuses non-integers and non-NFC strings", () => {
    expect(() => AP.canonicalJson({ n: 1.5 })).toThrow("safe integers");
    expect(() => AP.canonicalJson({ s: "café" })).toThrow("NFC");
    expect(AP.canonicalJson({ b: [2, "x"], a: null })).toBe('{"a":null,"b":[2,"x"]}');
  });
});

describe("valid presentations", () => {
  test.each([
    ["adapted language + 3 choices", adaptedThreeChoice],
    ["adapted language + 4 choices", adaptedFourChoice],
    ["canonical language + 3 choices", canonicalThreeChoice],
  ])("%s validates against the canonical revision", (_label, build) => {
    const result = validate(build());
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("the canonical presentation itself (canonical language, 4 choices) is refused", () => {
    const r = canonicalThreeChoice();
    r.traits.choiceCount = 4;
    expectFailure(r, "describe the canonical presentation itself");
  });

  test("no authoritative correctness data exists anywhere in a generated record", () => {
    for (const build of [adaptedThreeChoice, adaptedFourChoice, canonicalThreeChoice]) {
      const text = AP.serializeRecord(build());
      for (const key of AP.CORRECTNESS_KEYS) expect(text).not.toContain(`"${key}"`);
      expect(text).not.toContain("Because "); // canonical answer-key explanations are never copied
    }
  });
});

describe("fail-closed validation", () => {
  test("unknown assessment revision", () => {
    expectFailure(adaptedThreeChoice(), "has no committed canonical payload", null);
    const root = repo();
    expect(AP.loadCanonicalPayload(`assessment_${SLUG}__r2`, { repoRoot: root })).toBeNull();
    expect(AP.loadCanonicalPayload(REVISION_ID, { repoRoot: root })).not.toBeNull();
  });

  test("assessment revision of another lesson", () => {
    const r = adaptedThreeChoice();
    r.assessmentRevisionId = "assessment_other-lesson__r1";
    expectFailure(r, "does not belong to lesson");
  });

  test("unknown item id", () => {
    const r = adaptedThreeChoice();
    r.items[3].itemId = "q99";
    expectFailure(r, 'itemId "q99" is not an item of');
  });

  test("incomplete item coverage", () => {
    const r = adaptedThreeChoice();
    r.items.pop();
    expectFailure(r, "items are incomplete: missing q10");
  });

  test("items out of canonical order", () => {
    const r = adaptedThreeChoice();
    [r.items[0], r.items[1]] = [r.items[1], r.items[0]];
    expectFailure(r, "out of canonical order");
  });

  test("unknown displayed option id", () => {
    const r = adaptedThreeChoice();
    r.items[0].displayedOptions[1].optionId = "Z";
    expectFailure(r, 'optionId "Z" is not an option of item "q1"');
  });

  test("duplicate displayed option id", () => {
    const r = adaptedThreeChoice();
    const correct = r.items[0].displayedOptions.find((o) => o.optionId === "A");
    r.items[0].displayedOptions = [correct, { ...correct }, r.items[0].displayedOptions.find((o) => o.optionId !== "A")];
    expectFailure(r, 'optionId "A" is displayed more than once');
  });

  test("omitted option that is also displayed", () => {
    const r = adaptedThreeChoice();
    r.items[0].omittedOptions[0].optionId = r.items[0].displayedOptions.find((o) => o.optionId !== "A").optionId;
    expectFailure(r, "is both omitted and displayed");
  });

  test("invalid omitted option id", () => {
    const r = adaptedThreeChoice();
    r.items[0].omittedOptions[0].optionId = "Q";
    expectFailure(r, 'optionId "Q" is not an option of item "q1"');
  });

  test("omitted option without a rationale", () => {
    const r = adaptedThreeChoice();
    r.items[0].omittedOptions[0].rationale = "  ";
    expectFailure(r, "rationale must be a non-empty string");
  });

  test("a presentation that omits the canonical correct option", () => {
    const r = adaptedThreeChoice(); // q1 correct is A; omitted is B
    const item = r.items[0];
    item.displayedOptions = item.displayedOptions.map((o) => (o.optionId === "A" ? { optionId: "B", text: "Easier B 1" } : o));
    item.omittedOptions = [{ optionId: "A", rationale: "wrongly omitted" }];
    const result = validate(r);
    expect(result.failures.join("\n")).toContain("does not display the canonical correct option");
    expect(result.failures.join("\n")).toContain("omits the canonical correct option");
  });

  test("wrong displayed-option count", () => {
    const r = adaptedThreeChoice();
    r.items[0].displayedOptions.pop();
    expectFailure(r, "displays 2 options; traits.choiceCount is 3");
  });

  test("a canonical option neither displayed nor omitted", () => {
    const r = adaptedThreeChoice();
    r.items[0].omittedOptions = [];
    expectFailure(r, "are neither displayed nor explicitly omitted");
  });

  test("unsupported canonical item type", () => {
    const payload = canonicalPayload();
    payload.items[2].itemType = "multiSelect";
    expectFailure(adaptedThreeChoice(), 'unsupported itemType "multiSelect"', payload);
  });

  test("correctness data smuggled into the record", () => {
    const r = adaptedThreeChoice();
    r.items[0].correctOptionId = "A";
    expectFailure(r, "correctness data is not allowed in an assessment presentation: record.items[0].correctOptionId");
  });

  test("unknown fields are refused (closed schema)", () => {
    const r = adaptedThreeChoice();
    r.variantKey = "reading-adapted";
    expectFailure(r, 'unknown record field "variantKey"');
  });

  test("canonical language must reuse canonical text exactly", () => {
    const r = canonicalThreeChoice();
    r.items[0].stem = "Reworded?";
    expectFailure(r, "must equal the canonical stem");
  });

  test.each([
    ["Show Your Thinking missing under adapted language", (r) => { r.showYourThinking = null; }, "showYourThinking must be an object"],
    ["empty prompt", (r) => { r.showYourThinking.prompt = ""; }, "prompt must be a non-empty string"],
    ["required term absent from prompt", (r) => { r.showYourThinking.requiredTerms = ["subduction"]; }, 'does not contain required term "subduction"'],
    ["malformed required terms", (r) => { r.showYourThinking.requiredTerms = [""]; }, "requiredTerms must be an array of non-empty strings"],
    ["unknown Show Your Thinking field", (r) => { r.showYourThinking.rubric = "x"; }, 'showYourThinking unknown field "rubric"'],
    ["malformed feedback", (r) => { r.items[0].feedback = ""; }, "feedback must be null or a non-empty string"],
    ["malformed directions", (r) => { r.directions = ""; }, "directions must be null or a non-empty string"],
  ])("%s", (_label, mutate, message) => {
    const r = adaptedThreeChoice();
    mutate(r);
    expectFailure(r, message);
  });

  test("canonical language forbids adapted Show Your Thinking and feedback", () => {
    const r = canonicalThreeChoice();
    r.showYourThinking = adaptedThreeChoice().showYourThinking;
    r.items[0].feedback = "adapted";
    const result = validate(r);
    expect(result.failures.join("\n")).toContain("showYourThinking must be null when traits.language is canonical");
    expect(result.failures.join("\n")).toContain("feedback must be null when traits.language is canonical");
  });

  test("displayed answer positions must meet the Slice 1 quality standard", () => {
    const r = adaptedThreeChoice();
    for (const item of r.items) {
      const correct = item.displayedOptions.find((o) => CANONICAL_CORRECT.includes(o.optionId) && o.optionId === canonicalPayload().items.find((c) => c.itemId === item.itemId).correctOptionId);
      item.displayedOptions = [correct, ...item.displayedOptions.filter((o) => o !== correct)];
    }
    expectFailure(r, "displayed answer positions: POSITION_NEVER_CORRECT");
  });
});

describe("retained record files", () => {
  test("a correctly named, canonically serialized record verifies", () => {
    const root = repo();
    const id = retain(root, adaptedThreeChoice());
    const result = AP.verifyRetainedRecords({ repoRoot: root });
    expect(result.failures).toEqual([]);
    expect(result.count).toBe(1);
    expect(AP.verifyRetainedRecord(`${id}.json`, { repoRoot: root }).ok).toBe(true);
  });

  test("content that does not match its id fails", () => {
    const root = repo();
    retain(root, adaptedThreeChoice(), `ap${"0".repeat(64)}.json`);
    expect(AP.verifyRetainedRecords({ repoRoot: root }).failures.join("\n")).toContain("content hashes to ap");
  });

  test("non-canonical bytes fail even when the parsed content matches", () => {
    const root = repo();
    const record = adaptedThreeChoice();
    const id = AP.assessmentPresentationRevisionIdFor(record);
    fs.mkdirSync(AP.retainedRecordDir(root), { recursive: true });
    fs.writeFileSync(path.join(AP.retainedRecordDir(root), `${id}.json`), JSON.stringify(record, null, 2));
    expect(AP.verifyRetainedRecords({ repoRoot: root }).failures.join("\n")).toContain("not the canonical serialization");
  });

  test("misnamed and stray files fail", () => {
    const root = repo();
    retain(root, adaptedThreeChoice(), "earths-layers.json");
    fs.writeFileSync(path.join(AP.retainedRecordDir(root), "notes.txt"), "x");
    const failures = AP.verifyRetainedRecords({ repoRoot: root }).failures.join("\n");
    expect(failures).toContain("must be named ap<sha256>.json");
    expect(failures).toContain("unexpected file");
  });

  test("the repository retains exactly the owner-certified Earth's Layers presentation, and it verifies cleanly", () => {
    // F5.3 Slice 6B: the first real retained record. Records are add-only.
    const result = AP.verifyRetainedRecords();
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(fs.readdirSync(AP.retainedRecordDir())).toEqual([`${EARTHS_LAYERS_AP}.json`]);
    const checked = AP.checkCertifiedPresentation(EARTHS_LAYERS_AP, {
      lessonSlug: "earths-layers",
      assessmentRevisionId: "assessment_earths-layers__r1",
    });
    expect(checked.failures).toEqual([]);
  });
});

describe("human certification review", () => {
  const record = adaptedThreeChoice();
  const id = AP.assessmentPresentationRevisionIdFor(record);

  test("an approved review with generic reviewer identity validates", () => {
    const r = AP.validateReview(approvedReview(record, id), record, id);
    expect(r.failures).toEqual([]);
    expect(r.approved).toBe(true);
  });

  test("criteria applicability follows the presentation's traits", () => {
    expect([...AP.applicableCriteria(adaptedThreeChoice())].sort()).toEqual([...AP.REVIEW_CRITERIA].sort());
    const canon3 = AP.applicableCriteria(canonicalThreeChoice());
    expect(canon3.has("omittedDistractorAppropriate")).toBe(true);
    expect(canon3.has("showYourThinkingEquivalence")).toBe(false);
    expect(canon3.has("explanationEquivalence")).toBe(false);
    expect(AP.applicableCriteria(adaptedFourChoice()).has("omittedDistractorAppropriate")).toBe(false);
  });

  test.each([
    ["wrong presentation id", (v) => { v.assessmentPresentationRevisionId = `ap${"1".repeat(64)}`; }, "review certifies"],
    ["missing reviewer id", (v) => { v.reviewer = { role: "scienceContentReviewer" }; }, "reviewer must be { role, reviewerId }"],
    ["bad timestamp", (v) => { v.reviewedAt = "yesterday"; }, "reviewedAt must be an ISO-8601 UTC timestamp"],
    ["unknown determination", (v) => { v.determination = "ok"; }, "determination must be one of"],
    ["applicable criterion marked notApplicable", (v) => { v.criteria.noAnswerCueing.result = "notApplicable"; }, "criteria.noAnswerCueing applies"],
    ["missing criterion", (v) => { delete v.criteria.scientificAccuracy; }, "criteria.scientificAccuracy must be"],
    ["uncovered item", (v) => { v.items.pop(); }, "review does not cover item(s) q10"],
    ["approved despite a failed criterion", (v) => { v.criteria.cognitiveDemandPreserved.result = "fail"; }, "an approved review cannot contain a failed criterion"],
  ])("malformed review: %s", (_label, mutate, message) => {
    const review = approvedReview(record, id);
    mutate(review);
    const r = AP.validateReview(review, record, id);
    expect(r.approved).toBe(false);
    expect(r.failures.join("\n")).toContain(message);
  });

  test("a well-formed changesRequested review is valid but not an approval", () => {
    const review = approvedReview(record, id);
    review.determination = "changesRequested";
    review.criteria.noAnswerCueing.result = "fail";
    const r = AP.validateReview(review, record, id);
    expect(r.ok).toBe(true);
    expect(r.approved).toBe(false);
  });
});

describe("variant manifest binding", () => {
  test("the real manifest's pre-F5.3 entry stays unbound and valid, the bound entry is certified, and it reserializes byte-identically", () => {
    const entries = manifestMod.readManifest();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    const historical = entries.find((e) => e.presentationRevisionId === HISTORICAL_PR);
    expect(historical).toBeDefined();
    expect(historical.assessmentRevisionId).toBeUndefined();
    expect(historical.assessmentPresentationRevisionId).toBeUndefined();
    const bound = entries.find((e) => e.assessmentPresentationRevisionId === EARTHS_LAYERS_AP);
    expect(bound).toMatchObject({ lessonSlug: "earths-layers", variantKey: "reading-adapted", assessmentRevisionId: "assessment_earths-layers__r1" });
    expect(bound.presentationRevisionId).not.toBe(HISTORICAL_PR);
    for (const e of entries) expect(AP.verifyManifestBinding(e)).toEqual([]);
    const real = fs.readFileSync(manifestMod.resolveManifestPath(), "utf8");
    expect(manifestMod.serializeManifest(entries)).toBe(real);
    expect(manifestMod.verifyRetention({}).ok).toBe(true);
  });

  test("an unbound entry keeps its F5.2 meaning and verifies", () => {
    const root = repo();
    manifestMod.appendEntry(variantEntry(root), { repoRoot: root });
    expect(manifestMod.verifyRetention({ repoRoot: root })).toEqual({ ok: true, failures: [] });
    expect(manifestMod.serializeManifest(manifestMod.readManifest(root))).not.toContain("assessmentPresentationRevisionId");
  });

  function boundRepo(reviewMutate) {
    const root = repo();
    const record = adaptedThreeChoice();
    const apId = retain(root, record);
    const review = approvedReview(record, apId);
    if (reviewMutate) reviewMutate(review);
    if (review) writeReview(root, review);
    const entry = variantEntry(root, { assessmentRevisionId: REVISION_ID, assessmentPresentationRevisionId: apId });
    return { root, apId, entry };
  }

  test("a bound entry with a retained, valid, approved presentation verifies", () => {
    const { root, entry } = boundRepo();
    const { appended } = manifestMod.appendEntry(entry, { repoRoot: root });
    expect(appended).toBe(true);
    expect(manifestMod.verifyRetention({ repoRoot: root })).toEqual({ ok: true, failures: [] });
    const text = fs.readFileSync(manifestMod.resolveManifestPath(root), "utf8");
    expect(text).toContain('"assessmentPresentationRevisionId"');
    // Append-only idempotency covers the binding fields.
    expect(manifestMod.appendEntry(entry, { repoRoot: root }).appended).toBe(false);
    expect(() => manifestMod.appendEntry({ ...entry, assessmentRevisionId: `assessment_${SLUG}__r2` }, { repoRoot: root })).toThrow("immutability violation");
  });

  test("a bound presentation without a review fails", () => {
    const root = repo();
    const apId = retain(root, adaptedThreeChoice());
    manifestMod.appendEntry(variantEntry(root, { assessmentRevisionId: REVISION_ID, assessmentPresentationRevisionId: apId }), { repoRoot: root });
    expect(manifestMod.verifyRetention({ repoRoot: root }).failures.join("\n")).toContain("has no human certification review record");
  });

  test("a bound presentation whose review is not an approval fails", () => {
    const { root, entry } = boundRepo((v) => { v.determination = "changesRequested"; });
    manifestMod.appendEntry(entry, { repoRoot: root });
    expect(manifestMod.verifyRetention({ repoRoot: root }).failures.join("\n")).toContain('is not approved (determination "changesRequested")');
  });

  test("a bound presentation that is not retained fails", () => {
    const root = repo();
    manifestMod.appendEntry(variantEntry(root, { assessmentRevisionId: REVISION_ID, assessmentPresentationRevisionId: `ap${"c".repeat(64)}` }), { repoRoot: root });
    expect(manifestMod.verifyRetention({ repoRoot: root }).failures.join("\n")).toContain("is not retained");
  });

  test("a binding to a different assessment revision than the presentation fails", () => {
    const { root, apId } = boundRepo();
    fs.writeFileSync(path.join(AP.canonicalPayloadDir(root), `${SLUG}.r2.json`), JSON.stringify(canonicalPayload({ revisionOrdinal: 2 })));
    const entry = variantEntry(root, { assessmentRevisionId: `assessment_${SLUG}__r2`, assessmentPresentationRevisionId: apId });
    manifestMod.appendEntry(entry, { repoRoot: root });
    expect(manifestMod.verifyRetention({ repoRoot: root }).failures.join("\n")).toContain(`maps to ${REVISION_ID}, not assessment_${SLUG}__r2`);
  });

  test("half a binding, a malformed id, an unknown field, or another lesson's revision is refused at append", () => {
    const root = repo();
    expect(() => manifestMod.appendEntry(variantEntry(root, { assessmentRevisionId: REVISION_ID }), { repoRoot: root })).toThrow("must carry assessmentRevisionId and assessmentPresentationRevisionId together");
    expect(() => manifestMod.appendEntry(variantEntry(root, { assessmentRevisionId: REVISION_ID, assessmentPresentationRevisionId: "ap123" }), { repoRoot: root })).toThrow("must be ap<sha256>");
    expect(() => manifestMod.appendEntry(variantEntry(root, { choiceCount: 3 }), { repoRoot: root })).toThrow('unknown field "choiceCount"');
    expect(() => manifestMod.appendEntry(variantEntry(root, { assessmentRevisionId: "assessment_other__r1", assessmentPresentationRevisionId: `ap${"d".repeat(64)}` }), { repoRoot: root })).toThrow(`must be a revision of assessment_${SLUG}`);
  });
});
