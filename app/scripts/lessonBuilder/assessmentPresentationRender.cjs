/*
 * F5.3 Slice 4 - build-time rendering of a certified assessment presentation
 * into a lesson artifact.
 *
 * Input: lesson HTML (the instruction-only variant build, already gated by
 * the F5.2 invariance / contract / quiz-identity checks) and the id of a
 * retained, certified Slice 3 assessment-presentation record. Output: the same
 * HTML with exactly these regions rewritten, deterministically:
 *
 *   1. the lesson's `<prefix>QuizQuestions` array literal, regenerated from the
 *      record: stem, the displayed choices in display order, the display index
 *      of the canonical correct option, and the record feedback (or the
 *      canonical explanation when feedback is null);
 *   2. the quiz section's `<p class="section-desc">` text, when the record
 *      supplies directions;
 *   3. the Show Your Thinking prompt, model answer, and textarea accessible
 *      name, when the record supplies an adapted block;
 *   4. one inserted, non-executable binding block
 *        <script type="application/json" id="lyfelabz-assessment-presentation">
 *      carrying lessonSlug, assessmentRevisionId,
 *      assessmentPresentationRevisionId, and, per item in canonical order, the
 *      canonical itemId and the canonical optionId of every displayed choice
 *      in display order. The browser runtime submits those optionIds
 *      (entry.ts); it never derives identity from a display letter. The block
 *      carries NO correctness data and is not authoritative: the server
 *      validates every response against the frozen revision (Slice 2) and,
 *      from Slice 6, against the frozen presentation.
 *
 * Deliberately excluded from the artifact: omitted options and their
 * rationale, review/certification metadata, traits, and any answer-key field.
 * The regenerated quiz literal keeps the lesson's existing `correct` index
 * (used by the lesson's own instant feedback), exactly as the canonical
 * lesson already does; that pre-existing exposure is backlog D7
 * (SECURITY_BACKLOG_LESSON_PAGE_ANSWER_DATA.md) and this renderer adds no new
 * correctness data beyond it.
 *
 * The artifact's own presentationRevisionId cannot be embedded (it is the
 * hash of these bytes); it is carried by the served path and the manifest.
 *
 * Every step fails closed: an uncertified or mismatched presentation, a lesson
 * whose canonical quiz is not faithful to the presentation's assessment
 * revision, an unsupported quiz literal shape, or a missing/duplicated anchor
 * throws, and the rendered output is re-verified before it is returned.
 */

"use strict";

const acorn = require("acorn");

const fidelity = require("./assessmentFidelity.cjs");
const AP = require("./assessmentPresentation.cjs");
const paths = require("./paths.cjs");

const BINDING_ELEMENT_ID = "lyfelabz-assessment-presentation";
const BINDING_SCHEMA_VERSION = 1;
const QUIZ_LITERAL_KEYS = Object.freeze(["correct", "explanation", "options", "q"]);

function fail(message) {
  throw new Error(`[assessment-presentation-render] ${message}`);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON for embedding inside <script type="application/json">: no "<" may
// appear raw, so the block can never terminate its element early.
function scriptSafeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

// Locates the single `<prefix>QuizQuestions = [ ... ]` literal and returns its
// exact HTML offsets. Only classic inline scripts are parsed.
function locateQuizLiteral(html) {
  const found = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    if (/\bsrc\s*=/.test(attrs) || /\btype\s*=\s*["']application\/json["']/.test(attrs)) continue;
    const bodyStart = m.index + m[0].indexOf(">") + 1;
    let program;
    try {
      program = acorn.parse(m[2], { ecmaVersion: "latest" });
    } catch {
      continue;
    }
    for (const stmt of program.body) {
      if (stmt.type !== "VariableDeclaration") continue;
      for (const decl of stmt.declarations) {
        if (decl.id.type === "Identifier" && /QuizQuestions$/.test(decl.id.name) && decl.init && decl.init.type === "ArrayExpression") {
          found.push({
            prefix: decl.id.name.replace(/QuizQuestions$/, ""),
            start: bodyStart + decl.init.start,
            end: bodyStart + decl.init.end,
            elements: decl.init.elements,
          });
        }
      }
    }
  }
  if (found.length !== 1) fail(`expected exactly one <prefix>QuizQuestions literal, found ${found.length}`);
  const literal = found[0];
  literal.elements.forEach((el, i) => {
    const keys = el && el.type === "ObjectExpression"
      ? el.properties.map((p) => (p.key && (p.key.name || p.key.value))).sort()
      : null;
    if (!keys || keys.join("|") !== QUIZ_LITERAL_KEYS.join("|")) {
      fail(`quiz question ${i + 1} has an unsupported literal shape (keys ${keys ? keys.join(", ") : "n/a"}); only { q, options, correct, explanation } can be regenerated`);
    }
  });
  return literal;
}

function countOf(html, needle) {
  let n = 0;
  for (let i = html.indexOf(needle); i !== -1; i = html.indexOf(needle, i + needle.length)) n += 1;
  return n;
}

// Pure: the quiz questions and the correctness-free option map a record
// produces against its canonical payload.
function buildPresentationQuiz(record, canonicalPayload) {
  const byId = new Map(canonicalPayload.items.map((it) => [it.itemId, it]));
  const questions = [];
  const items = [];
  for (const item of record.items) {
    const canonical = byId.get(item.itemId);
    const optionIds = item.displayedOptions.map((o) => o.optionId);
    const correct = optionIds.indexOf(canonical.correctOptionId);
    if (correct < 0) fail(`item ${item.itemId} does not display its canonical correct option`);
    questions.push({
      q: escapeHtml(item.stem),
      options: item.displayedOptions.map((o) => escapeHtml(o.text)),
      correct,
      explanation: escapeHtml(item.feedback !== null ? item.feedback : canonical.explanation),
    });
    items.push({ itemId: item.itemId, optionIds });
  }
  return { questions, items };
}

function literalSource(questions) {
  const body = questions
    .map(
      (q) =>
        "  {\n" +
        `    q: ${JSON.stringify(q.q)},\n` +
        `    options: [${q.options.map((o) => JSON.stringify(o)).join(", ")}],\n` +
        `    correct: ${q.correct},\n` +
        `    explanation: ${JSON.stringify(q.explanation)}\n` +
        "  }",
    )
    .join(",\n");
  return `[\n${body}\n]`;
}

function bindingBlockFor(record, assessmentPresentationRevisionId, items) {
  const binding = {
    schemaVersion: BINDING_SCHEMA_VERSION,
    lessonSlug: record.lessonSlug,
    assessmentRevisionId: record.assessmentRevisionId,
    assessmentPresentationRevisionId,
    items,
  };
  return {
    binding,
    html: `<script type="application/json" id="${BINDING_ELEMENT_ID}">${scriptSafeJson(binding)}</script>`,
  };
}

// Reads and parses the binding block from rendered HTML (verification and
// tests). Returns null when absent.
function readBindingBlock(html) {
  const re = new RegExp(`<script type="application/json" id="${BINDING_ELEMENT_ID}">([\\s\\S]*?)</script>`, "g");
  const matches = [...html.matchAll(re)];
  if (matches.length === 0) return null;
  if (matches.length > 1) fail("more than one assessment-presentation binding block");
  return JSON.parse(matches[0][1]);
}

function boldRequiredTerms(escapedPrompt, requiredTerms) {
  let out = escapedPrompt;
  for (const term of requiredTerms) {
    const escapedTerm = escapeHtml(term);
    const at = out.toLowerCase().indexOf(escapedTerm.toLowerCase());
    if (at === -1) fail(`Show Your Thinking prompt lost required term "${term}" during rendering`);
    out = `${out.slice(0, at)}<strong>${out.slice(at, at + escapedTerm.length)}</strong>${out.slice(at + escapedTerm.length)}`;
  }
  return out;
}

const THINK_PROMPT_RE = /(<p class="think-prompt">)([\s\S]*?)(<\/p>)/g;
const THINK_MODEL_RE = /(<div class="think-model"[^>]*>\s*<span class="tm-label">[^<]*<\/span>)([\s\S]*?)(<\/div>)/g;
const THINK_INPUT_RE = /(<textarea class="think-input"[^>]*\saria-label=")([^"]*)(")/g;

const NAMED_ENTITIES = Object.freeze({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", middot: "·", rsquo: "’", lsquo: "‘" });

// Plain text of an HTML fragment (tags removed, entities decoded, whitespace
// collapsed). Used only to read canonical wording for comparison.
function htmlToText(fragment) {
  return String(fragment)
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (all, ent) => {
      if (ent[0] === "#") {
        const code = ent[1] === "x" || ent[1] === "X" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : all;
      }
      return NAMED_ENTITIES[ent.toLowerCase()] !== undefined ? NAMED_ENTITIES[ent.toLowerCase()] : all;
    })
    .replace(/\s+/g, " ")
    .trim();
}

// Reads the lesson's Show Your Thinking wording as plain text, or null when
// the lesson has no think box. Throws when the anchors are ambiguous.
function readShowYourThinking(html) {
  const prompts = [...html.matchAll(THINK_PROMPT_RE)];
  if (prompts.length === 0) return null;
  const models = [...html.matchAll(THINK_MODEL_RE)];
  const inputs = [...html.matchAll(THINK_INPUT_RE)];
  if (prompts.length !== 1 || models.length !== 1 || inputs.length !== 1) {
    fail(`lesson has ${prompts.length} think-prompt, ${models.length} think-model, ${inputs.length} think-input anchor(s); expected exactly one each`);
  }
  return {
    prompt: htmlToText(prompts[0][2]),
    modelAnswer: htmlToText(models[0][2]),
    ariaLabel: htmlToText(inputs[0][2]),
  };
}

// Reads the quiz section's directions (its one plain section-desc) as plain
// text, or null when the lesson has no such paragraph.
function readQuizDirections(html) {
  const quizAt = html.indexOf('<section id="quiz"');
  if (quizAt === -1) return null;
  const end = html.indexOf("</section>", quizAt);
  const segment = html.slice(quizAt, end === -1 ? undefined : end);
  const matches = [...segment.matchAll(/<p class="section-desc">([^<]*)<\/p>/g)];
  return matches.length === 1 ? htmlToText(matches[0][1]) : null;
}

function renderShowYourThinking(html, syt) {
  const promptRe = THINK_PROMPT_RE;
  const modelRe = THINK_MODEL_RE;
  const inputRe = THINK_INPUT_RE;
  for (const [re, name] of [[promptRe, "think-prompt"], [modelRe, "think-model"], [inputRe, "think-input aria-label"]]) {
    const n = [...html.matchAll(re)].length;
    if (n !== 1) fail(`lesson has ${n} ${name} anchor(s); an adapted Show Your Thinking block needs exactly one`);
  }
  const prompt = boldRequiredTerms(escapeHtml(syt.prompt), syt.requiredTerms);
  let out = html.replace(promptRe, (_all, open, _old, close) => `${open}${prompt}${close}`);
  out = out.replace(modelRe, (_all, open, _old, close) => `${open}\n        ${escapeHtml(syt.modelAnswer)}\n      ${close}`);
  out = out.replace(inputRe, (_all, open, _old, close) => `${open}${escapeHtml(syt.prompt)}${close}`);
  return out;
}

function renderDirections(html, directions, containerAt) {
  const quizAt = html.indexOf('<section id="quiz"');
  if (quizAt === -1 || quizAt > containerAt) fail("lesson has no quiz section before the quiz questions container");
  const segment = html.slice(quizAt, containerAt);
  const re = /<p class="section-desc">[^<]*<\/p>/g;
  const matches = [...segment.matchAll(re)];
  if (matches.length !== 1) fail(`quiz section has ${matches.length} plain section-desc paragraph(s); directions need exactly one`);
  const at = quizAt + matches[0].index;
  const replacement = `<p class="section-desc">${escapeHtml(directions)}</p>`;
  return html.slice(0, at) + replacement + html.slice(at + matches[0][0].length);
}

// Pure render: html + a validated record + its canonical payload. The caller
// is responsible for certification (renderCertifiedAssessmentPresentation).
function renderAssessmentPresentation(html, { record, assessmentPresentationRevisionId, canonicalPayload }) {
  if (readBindingBlock(html) !== null) fail("lesson already carries an assessment-presentation binding block");
  const validation = AP.validateAssessmentPresentation(record, canonicalPayload);
  if (!validation.ok) fail(`presentation is invalid:\n  - ${validation.failures.join("\n  - ")}`);
  if (AP.assessmentPresentationRevisionIdFor(record) !== assessmentPresentationRevisionId) {
    fail(`record content hashes to ${AP.assessmentPresentationRevisionIdFor(record)}, not ${assessmentPresentationRevisionId}`);
  }

  // The lesson's own quiz must be the canonical quiz of the presentation's
  // assessment revision (item, option, and answer identity all agree).
  const canonicalQuiz = fidelity.extractCanonicalQuiz(html, record.lessonSlug);
  const problems = fidelity.checkFidelity(record.lessonSlug, canonicalPayload, canonicalQuiz);
  if (problems.length > 0) {
    fail(`lesson quiz is not the canonical quiz of ${record.assessmentRevisionId}:\n${problems.join("\n")}`);
  }

  const literal = locateQuizLiteral(html);
  if (literal.elements.length !== record.items.length) {
    fail(`lesson quiz has ${literal.elements.length} questions; the presentation has ${record.items.length} items`);
  }
  const containerTag = `<div id="${literal.prefix}-quiz-questions">`;
  if (countOf(html, containerTag) !== 1) fail(`expected exactly one ${containerTag}`);

  // Section 9.2: every required term must be in BOTH prompts. The html is the
  // instruction-only build, whose Show Your Thinking is locked to canonical
  // by the F5.2 invariance gate, so its prompt is the canonical prompt.
  // A lesson with no think box is refused below by the anchor check.
  const canonicalSyt = record.showYourThinking !== null ? readShowYourThinking(html) : null;
  if (canonicalSyt !== null) {
    const terms = AP.requiredTermEquivalence(record.showYourThinking, canonicalSyt);
    if (!terms.ok) fail(`Show Your Thinking required terms are not equivalent:\n  - ${terms.failures.join("\n  - ")}`);
  }

  const { questions, items } = buildPresentationQuiz(record, canonicalPayload);
  const block = bindingBlockFor(record, assessmentPresentationRevisionId, items);

  // Each step re-locates its anchor in the current output, so no stale
  // offsets are ever reused.
  let out = html.slice(0, literal.start) + literalSource(questions) + html.slice(literal.end);
  const containerAt = out.indexOf(containerTag);
  out = `${out.slice(0, containerAt)}${block.html}\n    ${out.slice(containerAt)}`;
  if (record.directions !== null) out = renderDirections(out, record.directions, out.indexOf(containerTag));
  if (record.showYourThinking !== null) out = renderShowYourThinking(out, record.showYourThinking);

  verifyRendered(out, { record, questions, binding: block.binding });
  return { html: out, binding: block.binding };
}

// Post-condition: re-read what was written, independently of how it was
// written. Any disagreement fails the build.
function verifyRendered(html, { record, questions, binding }) {
  const quiz = fidelity.extractCanonicalQuiz(html, record.lessonSlug);
  if (JSON.stringify(quiz.questions) !== JSON.stringify(questions)) fail("rendered quiz literal does not match the presentation");
  if (JSON.stringify(readBindingBlock(html)) !== JSON.stringify(binding)) fail("rendered binding block does not match the presentation");
  for (const item of record.items) {
    for (const om of item.omittedOptions) {
      if (html.includes(escapeHtml(om.rationale))) fail(`omitted-option rationale for ${item.itemId} leaked into the artifact`);
    }
  }
  if (record.showYourThinking !== null && !html.includes(escapeHtml(record.showYourThinking.modelAnswer))) {
    fail("rendered Show Your Thinking model answer is missing");
  }
}

// Build entry point: certification first (the ONE Slice 3 check), then render.
function renderCertifiedAssessmentPresentation(html, { assessmentPresentationRevisionId, lessonSlug, repoRoot = paths.REPO_ROOT }) {
  const checked = AP.checkCertifiedPresentation(assessmentPresentationRevisionId, { repoRoot, lessonSlug });
  if (checked.failures.length > 0) {
    fail(`assessment presentation ${assessmentPresentationRevisionId} cannot be rendered:\n  - ${checked.failures.join("\n  - ")}`);
  }
  const canonicalPayload = AP.loadCanonicalPayload(checked.record.assessmentRevisionId, { repoRoot });
  return renderAssessmentPresentation(html, {
    record: checked.record,
    assessmentPresentationRevisionId,
    canonicalPayload,
  });
}

module.exports = {
  BINDING_ELEMENT_ID,
  BINDING_SCHEMA_VERSION,
  QUIZ_LITERAL_KEYS,
  escapeHtml,
  scriptSafeJson,
  locateQuizLiteral,
  literalSource,
  htmlToText,
  buildPresentationQuiz,
  readBindingBlock,
  readShowYourThinking,
  readQuizDirections,
  renderAssessmentPresentation,
  renderCertifiedAssessmentPresentation,
};
