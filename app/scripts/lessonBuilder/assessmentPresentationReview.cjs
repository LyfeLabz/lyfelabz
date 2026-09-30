/*
 * F5.3 Slice 6A - owner-review tooling for a DRAFT assessment presentation.
 *
 * A draft is a presentation record (the closed Slice 3 schema) authored at
 * lesson-sources/variants/<slug>.<variantKey>.assessment.json, never served.
 * Its identity is computed exactly as a retained record's would be
 * (assessmentPresentation.cjs), so the id the owner reviews is the id a
 * certification must later name. Nothing here writes a retained record, a
 * review record, a manifest entry, or a lesson config.
 *
 * analyzeDraft() runs, against the committed canonical payload and the
 * generated canonical lesson:
 *   - the one Slice 3 validator (schema, identity inputs, option integrity,
 *     displayed answer positions, and the Slice 6A answer-cue heuristics);
 *   - required-term equivalence against BOTH Show Your Thinking prompts;
 *   - the model-answer form (string or paragraphs) against the canonical
 *     model's kind;
 *   - identical-to-canonical text findings (review information only);
 *   - the owner's display-position target (spread <= 1, no run of 3, no
 *     cycle: no hard finding and no warning from the Slice 1 standard);
 *   - the repository style rule (no em dash in any authored string);
 *   - authoring-notes integrity (see below).
 *
 * Authoring notes (optional file <draft>.notes.json beside the draft) hold
 * what the closed record schema deliberately does not: per item, the
 * author's statement of correct-answer meaning and the misconception each
 * retained distractor represents; for Show Your Thinking, the evidence
 * comparison and the causal-chain steps to trace; and optional reasons for
 * strings kept identical to canonical. Notes are author claims for the
 * reviewer. They are not part of the presentation identity, never reach a
 * student, and are not authoritative scoring data. The tool checks them for
 * coverage and staleness only (for example, a misconception listed for an
 * option that is not a displayed distractor fails).
 *
 * renderPacket() turns an analysis into a Markdown owner-review packet for
 * the exact draft id. The packet shows which option is correct: it is an
 * owner-review artifact and must never be placed in Hosting output.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const AP = require("./assessmentPresentation.cjs");
const render = require("./assessmentPresentationRender.cjs");
const quality = require("./assessmentQuality.cjs");
const revisions = require("./assessmentRevisions.cjs");
const configMod = require("./config.cjs");
const paths = require("./paths.cjs");
const { sha256Hex } = require("./hash.cjs");

const NOTES_KIND = "lyfelabz.assessmentPresentationAuthoringNotes";
const NOTES_KEYS = Object.freeze(["schemaVersion", "kind", "lessonSlug", "assessmentRevisionId", "items", "showYourThinking", "unchanged"]);
const NOTES_ITEM_KEYS = Object.freeze(["itemId", "correctMeaning", "distractorMisconceptions"]);
const NOTES_SYT_KEYS = Object.freeze(["evidenceComparison", "causalChain"]);
const NOTES_STEP_KEYS = Object.freeze(["step", "terms"]);
const EM_DASH = "\u2014";

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function unknownKeys(obj, allowed) {
  return Object.keys(obj).filter((k) => !allowed.includes(k));
}

// Draft file conventions: <slug>.<variantKey>.assessment.json, notes beside it.
function parseDraftFileName(file) {
  const m = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.([a-z0-9]+(?:-[a-z0-9]+)*)\.assessment\.json$/.exec(path.basename(file));
  return m ? { lessonSlug: m[1], variantKey: m[2] } : null;
}

function notesPathFor(draftPath) {
  return draftPath.replace(/\.json$/, ".notes.json");
}

// Canonical lesson wording the payload does not hold: the quiz directions
// and the Show Your Thinking prompt / model answer, read from the generated
// canonical v2 lesson (kept equal to its source by lessons:verify).
function loadCanonicalLesson(lessonSlug, { repoRoot = paths.REPO_ROOT } = {}) {
  const cfg = configMod.loadConfig(lessonSlug);
  const rel = cfg.outputs.v2;
  const html = fs.readFileSync(path.join(repoRoot, rel), "utf8");
  return {
    path: rel,
    sha256: sha256Hex(html),
    directions: render.readQuizDirections(html),
    showYourThinking: render.readShowYourThinking(html),
  };
}

function collectStrings(value, at, out) {
  if (typeof value === "string") out.push({ at, value });
  else if (Array.isArray(value)) value.forEach((v, i) => collectStrings(v, `${at}[${i}]`, out));
  else if (isPlainObject(value)) for (const k of Object.keys(value)) collectStrings(value[k], `${at}.${k}`, out);
  return out;
}

// Pure: authoring-notes integrity against the record and canonical payload.
function validateNotes(notes, record, canonicalPayload, identical) {
  const failures = [];
  const fail = (m) => failures.push(`notes: ${m}`);
  if (!isPlainObject(notes)) return { ok: false, failures: ["notes: must be a JSON object"] };
  for (const k of unknownKeys(notes, NOTES_KEYS)) fail(`unknown field "${k}"`);
  if (notes.schemaVersion !== 1) fail("schemaVersion must be 1");
  if (notes.kind !== NOTES_KIND) fail(`kind must be "${NOTES_KIND}"`);
  if (notes.lessonSlug !== record.lessonSlug) fail(`lessonSlug "${notes.lessonSlug}" does not match the draft ("${record.lessonSlug}")`);
  if (notes.assessmentRevisionId !== record.assessmentRevisionId) fail(`assessmentRevisionId does not match the draft`);

  const byId = new Map(canonicalPayload.items.map((it) => [it.itemId, it]));
  const items = Array.isArray(notes.items) ? notes.items : null;
  if (!items) fail("items must be an array");
  else {
    const ids = items.map((it) => (isPlainObject(it) ? it.itemId : undefined));
    const expected = record.items.map((it) => it.itemId);
    if (ids.join("|") !== expected.join("|")) fail(`items must cover ${expected.join(", ")} in order`);
    items.forEach((n, i) => {
      if (!isPlainObject(n)) return;
      for (const k of unknownKeys(n, NOTES_ITEM_KEYS)) fail(`items[${i}] unknown field "${k}"`);
      const item = record.items.find((it) => it.itemId === n.itemId);
      const canon = byId.get(n.itemId);
      if (!item || !canon) return;
      if (!isNonEmptyString(n.correctMeaning)) fail(`${n.itemId}.correctMeaning must be a non-empty string`);
      const retained = item.displayedOptions.map((o) => o.optionId).filter((id) => id !== canon.correctOptionId).sort();
      const dm = isPlainObject(n.distractorMisconceptions) ? n.distractorMisconceptions : null;
      if (!dm) {
        fail(`${n.itemId}.distractorMisconceptions must be an object keyed by retained distractor optionId`);
        return;
      }
      const keys = Object.keys(dm).sort();
      if (keys.join("|") !== retained.join("|")) {
        fail(`${n.itemId}.distractorMisconceptions must name exactly the displayed distractors (${retained.join(", ")}), found ${keys.join(", ") || "none"}`);
      }
      for (const k of keys) if (!isNonEmptyString(dm[k])) fail(`${n.itemId}.distractorMisconceptions.${k} must be a non-empty string`);
    });
  }

  if (record.showYourThinking === null) {
    if (notes.showYourThinking !== null && notes.showYourThinking !== undefined) fail("showYourThinking must be null when the draft has none");
  } else if (!isPlainObject(notes.showYourThinking)) {
    fail("showYourThinking must be { evidenceComparison, causalChain }");
  } else {
    const s = notes.showYourThinking;
    for (const k of unknownKeys(s, NOTES_SYT_KEYS)) fail(`showYourThinking unknown field "${k}"`);
    if (!isNonEmptyString(s.evidenceComparison)) fail("showYourThinking.evidenceComparison must be a non-empty string");
    if (!Array.isArray(s.causalChain) || s.causalChain.length === 0) fail("showYourThinking.causalChain must be a non-empty array");
    else {
      s.causalChain.forEach((step, i) => {
        if (!isPlainObject(step)) return fail(`showYourThinking.causalChain[${i}] must be an object`);
        for (const k of unknownKeys(step, NOTES_STEP_KEYS)) fail(`showYourThinking.causalChain[${i}] unknown field "${k}"`);
        if (!isNonEmptyString(step.step)) fail(`showYourThinking.causalChain[${i}].step must be a non-empty string`);
        if (!Array.isArray(step.terms) || step.terms.length === 0 || !step.terms.every(isNonEmptyString)) {
          fail(`showYourThinking.causalChain[${i}].terms must be a non-empty array of strings`);
        }
      });
    }
  }

  const unchanged = notes.unchanged === undefined ? {} : notes.unchanged;
  if (!isPlainObject(unchanged)) fail("unchanged must be an object { field: reason }");
  else {
    const identicalFields = new Set(identical.map((f) => f.field));
    for (const [field, reason] of Object.entries(unchanged)) {
      if (!identicalFields.has(field)) fail(`unchanged.${field} is stale: that string is not identical to canonical`);
      if (!isNonEmptyString(reason)) fail(`unchanged.${field} must give a reason`);
    }
  }
  return { ok: failures.length === 0, failures };
}

// Causal-chain trace: which steps' terms appear in each Show Your Thinking
// text. Deterministic keyword presence only; equivalence is a human call.
function traceCausalChain(chain, texts) {
  return (chain || []).map((step) => {
    const row = { step: step.step, terms: step.terms };
    for (const [name, text] of Object.entries(texts)) {
      const lower = String(text || "").toLowerCase();
      row[name] = step.terms.filter((t) => lower.includes(t.toLowerCase()));
    }
    return row;
  });
}

// Pure core of the analysis (inputs already loaded).
function analyze({ record, draftBytes = null, canonicalPayload, canonicalLesson, notes = null }) {
  const hardFailures = [];
  const warnings = [];
  const apId = AP.assessmentPresentationRevisionIdFor(record);
  const validation = AP.validateAssessmentPresentation(record, canonicalPayload);
  hardFailures.push(...validation.failures);
  warnings.push(...validation.warnings);

  const byId = new Map(canonicalPayload.items.map((it) => [it.itemId, it]));
  const structurallyUsable = Array.isArray(record.items) && record.items.every(
    (it) => isPlainObject(it) && byId.has(it.itemId) && Array.isArray(it.displayedOptions) && Array.isArray(it.omittedOptions),
  );

  const requiredTerms = isPlainObject(record.showYourThinking)
    ? AP.requiredTermEquivalence(record.showYourThinking, canonicalLesson.showYourThinking)
    : { ok: true, failures: [], terms: [] };
  hardFailures.push(...requiredTerms.failures);
  if (isPlainObject(record.showYourThinking)) {
    hardFailures.push(...AP.modelAnswerKindEquivalence(record.showYourThinking, canonicalLesson.showYourThinking).failures);
  }

  const cues = structurallyUsable ? AP.answerCueFindings(record, canonicalPayload) : null;
  const identical = structurallyUsable ? AP.identicalTextFindings(record, canonicalPayload, canonicalLesson) : [];
  const unchangedReasons = notes && isPlainObject(notes.unchanged) ? notes.unchanged : {};
  for (const f of identical) f.reason = unchangedReasons[f.field] || null;

  // Display-position target (owner requirement for this slice).
  let distribution = null;
  if (structurallyUsable && record.items.every((it) => it.displayedOptions.some((o) => o.optionId === byId.get(it.itemId).correctOptionId))) {
    const positions = record.items.map((it) => it.displayedOptions.findIndex((o) => o.optionId === byId.get(it.itemId).correctOptionId));
    const k = record.traits.choiceCount;
    const evaluated = quality.evaluateDistribution(positions, k);
    const counts = new Array(k).fill(0);
    for (const p of positions) counts[p] += 1;
    distribution = {
      positions,
      sequence: positions.map((p) => String.fromCharCode(65 + p)).join(""),
      counts,
      spread: Math.max(...counts) - Math.min(...counts),
      hard: evaluated.hard,
      warnings: evaluated.warnings,
    };
    distribution.targetMet = distribution.hard.length === 0 && distribution.warnings.length === 0 && distribution.spread <= 1;
    if (!distribution.targetMet) hardFailures.push(`display positions ${distribution.sequence} do not meet the target (spread <= 1, no run of 3, no cycle)`);
  }

  const style = collectStrings(record, "record", [])
    .concat(notes ? collectStrings(notes, "notes", []) : [])
    .filter((s) => s.value.includes(EM_DASH))
    .map((s) => `${s.at} contains an em dash (repository style: use a spaced hyphen)`);
  hardFailures.push(...style);

  let notesCheck = { ok: false, failures: ["notes: no authoring notes file; the packet cannot show misconceptions or equivalence claims"] };
  if (notes !== null && structurallyUsable) notesCheck = validateNotes(notes, record, canonicalPayload, identical);
  hardFailures.push(...notesCheck.failures);

  const syt = record.showYourThinking;
  const chain = syt && notes && isPlainObject(notes.showYourThinking)
    ? traceCausalChain(notes.showYourThinking.causalChain, {
      canonicalPrompt: canonicalLesson.showYourThinking && canonicalLesson.showYourThinking.prompt,
      adaptedPrompt: syt.prompt,
      canonicalModelAnswer: canonicalLesson.showYourThinking && canonicalLesson.showYourThinking.modelAnswer,
      adaptedModelAnswer: AP.modelAnswerText(syt.modelAnswer),
    })
    : [];

  return {
    assessmentPresentationRevisionId: apId,
    canonicalBytes: AP.serializeRecord(record),
    draftSha256: draftBytes === null ? null : sha256Hex(draftBytes),
    record,
    notes,
    canonicalPayload,
    canonicalLesson,
    validation,
    requiredTerms,
    cues,
    identical,
    distribution,
    notesCheck,
    chain,
    hardFailures,
    warnings,
    ok: hardFailures.length === 0,
  };
}

// Repository wrapper: loads a draft (and its notes when present) and the
// canonical inputs it maps onto.
function analyzeDraft(draftPath, { repoRoot = paths.REPO_ROOT, notesPath = null } = {}) {
  const draftBytes = fs.readFileSync(draftPath, "utf8");
  const record = JSON.parse(draftBytes);
  const canonicalPayload = AP.loadCanonicalPayload(record.assessmentRevisionId, { repoRoot });
  if (!canonicalPayload) throw new Error(`[assessment-review] no committed canonical payload for ${record.assessmentRevisionId}`);
  const canonicalLesson = loadCanonicalLesson(record.lessonSlug, { repoRoot });
  const np = notesPath || notesPathFor(draftPath);
  const notes = fs.existsSync(np) ? JSON.parse(fs.readFileSync(np, "utf8")) : null;
  const payloadFile = path.join(AP.canonicalPayloadDir(repoRoot), revisions.payloadFileNameForRevisionId(record.assessmentRevisionId));
  const result = analyze({ record, draftBytes, canonicalPayload, canonicalLesson, notes });
  result.draftPath = path.relative(repoRoot, draftPath);
  result.notesPath = notes === null ? null : path.relative(repoRoot, np);
  result.canonicalPayloadPath = path.relative(repoRoot, payloadFile);
  result.canonicalPayloadSha256 = sha256Hex(fs.readFileSync(payloadFile));
  return result;
}

// ---------------------------------------------------------------------------
// Owner-review packet (Markdown)
// ---------------------------------------------------------------------------

function md(text) {
  return String(text === null || text === undefined ? "" : text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function findingLines(list) {
  return list.length === 0 ? ["none"] : list.map((f) => `${f.code}: ${f.detail}`);
}

function renderPacket(a, { preview = null } = {}) {
  const r = a.record;
  const byId = new Map(a.canonicalPayload.items.map((it) => [it.itemId, it]));
  const notesById = new Map(((a.notes && a.notes.items) || []).map((n) => [n.itemId, n]));
  const identicalByField = new Map(a.identical.map((f) => [f.field, f]));
  const L = [];
  const pos = (i) => String.fromCharCode(65 + i);

  L.push(`# Owner review packet: ${r.lessonSlug} assessment presentation (DRAFT)`);
  L.push("");
  L.push("**Status: UNCERTIFIED DRAFT.** This packet is an owner-review artifact. It is not student content, not a certification record, and not scoring data. It shows which option is correct, so it must never be placed in Hosting output.");
  L.push("");
  L.push("| Field | Value |");
  L.push("|---|---|");
  L.push(`| Draft \`assessmentPresentationRevisionId\` | \`${a.assessmentPresentationRevisionId}\` |`);
  L.push(`| Draft file | \`${a.draftPath || "(in memory)"}\`${a.draftSha256 ? ` (sha256 \`${a.draftSha256}\`)` : ""} |`);
  L.push(`| Authoring notes | ${a.notesPath ? `\`${a.notesPath}\`` : "none"} (not part of the identity) |`);
  L.push(`| Canonical assessment revision | \`${r.assessmentRevisionId}\` (\`${a.canonicalPayloadPath || ""}\`, sha256 \`${a.canonicalPayloadSha256 || ""}\`) |`);
  L.push(`| Canonical lesson read | \`${a.canonicalLesson.path || ""}\` |`);
  L.push(`| Traits | language \`${r.traits.language}\`, choiceCount \`${r.traits.choiceCount}\` |`);
  if (preview) {
    L.push(`| Instructional base (retained) | \`${preview.instructionPresentationRevisionId}\` |`);
    L.push(`| Projected bound artifact id (NOT generated) | \`${preview.projectedPresentationRevisionId}\` |`);
  }
  L.push("");

  L.push("## Automated results");
  L.push("");
  L.push(`- Overall: **${a.ok ? "PASS" : "FAIL"}** (${a.hardFailures.length} hard failure(s), ${a.warnings.length} warning(s))`);
  for (const f of a.hardFailures) L.push(`  - FAIL: ${f}`);
  for (const w of a.warnings) L.push(`  - WARN: ${w}`);
  if (a.distribution) {
    L.push(`- Correct display positions: \`${a.distribution.sequence}\` (counts ${a.distribution.counts.map((c, i) => `${pos(i)}${c}`).join(" ")}, spread ${a.distribution.spread}); target ${a.distribution.targetMet ? "met" : "NOT met"}`);
  }
  for (const t of a.requiredTerms.terms) {
    L.push(`- Required term \`${t.term}\`: canonical prompt ${t.canonicalPrompt ? "yes" : "NO"}, adapted prompt ${t.adaptedPrompt ? "yes" : "NO"}; canonical model answer ${t.canonicalModelAnswer ? "yes" : "no"}, adapted model answer ${t.adaptedModelAnswer ? "yes" : "no"}`);
  }
  if (a.cues) {
    const hard = a.cues.items.reduce((n, it) => n + it.presentation.hard.length, 0);
    const warn = a.cues.items.reduce((n, it) => n + it.presentation.warnings.length, 0);
    L.push(`- Answer cues (as displayed): ${hard} hard, ${warn} warning(s); assessment level: ${a.cues.assessment.length ? a.cues.assessment.map((f) => f.code).join(", ") : "none"}. Correct choice uniquely longest on ${a.cues.longestCount} item(s) (canonical: ${a.cues.canonicalLongestCount}).`);
  }
  L.push(`- Identical-to-canonical strings: ${a.identical.length} (listed per question below; review information, never a failure)`);
  L.push("");

  L.push("## Directions");
  L.push("");
  L.push(`- Canonical: ${a.canonicalLesson.directions || "(none)"}`);
  L.push(`- Adapted: ${r.directions === null ? "(null: canonical directions shown)" : r.directions}`);
  const dirSame = identicalByField.get("directions");
  if (dirSame) L.push(`- Identical-text: ${dirSame.kind}${dirSame.reason ? ` (author reason: ${dirSame.reason})` : ""}`);
  L.push("");

  for (const item of r.items) {
    const c = byId.get(item.itemId);
    const n = notesById.get(item.itemId) || {};
    const omitted = new Map(item.omittedOptions.map((o) => [o.optionId, o.rationale]));
    const adaptedById = new Map(item.displayedOptions.map((o, i) => [o.optionId, { text: o.text, position: i }]));
    const correct = adaptedById.get(c.correctOptionId);
    const cue = a.cues ? a.cues.items.find((x) => x.itemId === item.itemId) : null;

    L.push(`## ${item.itemId}`);
    L.push("");
    L.push(`- Canonical stem: ${c.stem}`);
    L.push(`- Adapted stem: ${item.stem}`);
    L.push("");
    L.push("| Canonical option | Canonical text | Role | Adapted text | Displayed as | Misconception (author) |");
    L.push("|---|---|---|---|---|---|");
    for (const o of c.options) {
      const isCorrect = o.optionId === c.correctOptionId;
      const shown = adaptedById.get(o.optionId);
      const role = isCorrect ? "**CORRECT**" : shown ? "retained distractor" : "omitted distractor";
      const miscon = !isCorrect && shown && n.distractorMisconceptions ? n.distractorMisconceptions[o.optionId] : "";
      L.push(`| ${o.optionId} | ${md(o.text)} | ${role} | ${shown ? md(shown.text) : "(not shown)"} | ${shown ? pos(shown.position) : "-"} | ${md(miscon)} |`);
    }
    L.push("");
    L.push(`- Display order: ${item.displayedOptions.map((o, i) => `${pos(i)} = canonical ${o.optionId}`).join(", ")}`);
    L.push(`- Correct: canonical ${c.correctOptionId}, displayed at position **${correct ? pos(correct.position) : "?"}**`);
    L.push(`- Canonical correct meaning: ${c.options.find((o) => o.optionId === c.correctOptionId).text}`);
    L.push(`- Adapted correct meaning: ${correct ? correct.text : "(missing)"}`);
    L.push(`- Equivalence (author claim, reviewer decides): ${n.correctMeaning || "(no author note)"}`);
    for (const [id, rationale] of omitted) {
      L.push(`- Omitted: canonical ${id} "${c.options.find((o) => o.optionId === id).text}". Rationale: ${rationale}`);
    }
    L.push(`- Canonical explanation: ${c.explanation}`);
    L.push(`- Adapted feedback: ${item.feedback === null ? "(null: canonical explanation shown)" : item.feedback}`);
    if (cue) {
      L.push(`- Answer cues, as displayed: ${findingLines([...cue.presentation.hard.map((f) => ({ ...f, code: `HARD ${f.code}` })), ...cue.presentation.warnings]).join("; ")}`);
      L.push(`- Answer cues, canonical four-choice baseline: ${findingLines([...cue.canonical.hard.map((f) => ({ ...f, code: `HARD ${f.code}` })), ...cue.canonical.warnings]).join("; ")}`);
    }
    const same = a.identical.filter((f) => f.field.startsWith(`${item.itemId}.`));
    L.push(`- Identical-to-canonical: ${same.length === 0 ? "none" : same.map((f) => `${f.field.slice(item.itemId.length + 1)} ${f.kind} "${f.text}"${f.reason ? ` (author reason: ${f.reason})` : " (no author reason; reviewer decision)"}`).join("; ")}`);
    L.push("");
  }

  L.push("## Show Your Thinking");
  L.push("");
  const csyt = a.canonicalLesson.showYourThinking;
  const syt = r.showYourThinking;
  L.push(`- Canonical prompt: ${csyt ? csyt.prompt : "(none)"}`);
  L.push(`- Adapted prompt: ${syt ? syt.prompt : "(null: canonical prompt shown)"}`);
  L.push(`- Canonical model answer: ${csyt ? csyt.modelAnswer : "(none)"}`);
  L.push(`- Adapted model answer: ${syt ? AP.modelAnswerText(syt.modelAnswer) : "(null)"}`);
  L.push(`- Required terms: ${syt ? syt.requiredTerms.join(", ") : "(none)"}; equivalence ${a.requiredTerms.ok ? "PASS" : "FAIL"}`);
  for (const f of ["showYourThinking.prompt", "showYourThinking.modelAnswer"]) {
    const same = identicalByField.get(f);
    if (same) L.push(`- Identical-text: ${f} ${same.kind}${same.reason ? ` (author reason: ${same.reason})` : ""}`);
  }
  if (a.chain.length > 0) {
    L.push("");
    L.push("Causal chain trace (keyword presence; equivalence is the reviewer's call):");
    L.push("");
    L.push("| Step | Canonical prompt | Adapted prompt | Canonical model | Adapted model |");
    L.push("|---|---|---|---|---|");
    const cell = (v) => (v && v.length ? md(v.join(", ")) : "-");
    for (const s of a.chain) {
      L.push(`| ${md(s.step)} | ${cell(s.canonicalPrompt)} | ${cell(s.adaptedPrompt)} | ${cell(s.canonicalModelAnswer)} | ${cell(s.adaptedModelAnswer)} |`);
    }
  }
  if (a.notes && a.notes.showYourThinking) {
    L.push("");
    L.push(`Evidence comparison (author claim): ${a.notes.showYourThinking.evidenceComparison}`);
  }
  L.push("");
  L.push("## Human certification still required");
  L.push("");
  L.push(`Mechanical checks cannot establish: ${AP.REVIEW_CRITERIA.join(", ")}. An approved review record naming exactly \`${a.assessmentPresentationRevisionId}\` is required before this presentation can be retained, bound, or published; any content change produces a new id.`);
  L.push("");
  return L.join("\n");
}

module.exports = {
  NOTES_KIND,
  parseDraftFileName,
  notesPathFor,
  loadCanonicalLesson,
  validateNotes,
  traceCausalChain,
  analyze,
  analyzeDraft,
  renderPacket,
};
