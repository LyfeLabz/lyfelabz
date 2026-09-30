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
 *      name, when the record supplies an adapted block, located by the
 *      shared quiz-prefix id convention (locateShowYourThinking); the rest
 *      of the component (for example supplied evidence) is never touched;
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
const invariance = require("./variantInvariance.cjs");
const { findTagEnd } = require("./variantLinks.cjs");

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

// Every `<prefix>QuizQuestions = [ ... ]` literal with its exact HTML
// offsets. Only classic inline scripts are parsed.
function findQuizLiterals(html) {
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
  return found;
}

// Locates the single `<prefix>QuizQuestions = [ ... ]` literal and returns its
// exact HTML offsets.
function locateQuizLiteral(html) {
  const found = findQuizLiterals(html);
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

// -- Show Your Thinking component locator ----------------------------------
//
// Every lesson's Show Your Thinking component follows one id convention keyed
// to its quiz prefix <p> (the prefix of `<p>QuizQuestions` and
// `<p>-quiz-questions`):
//
//   <div class="think-box | <p>-think-box" id="<p>-think">
//     ...                                              (untouched)
//     <p class="<family>think-prompt">PROMPT</p>
//     ...                                              (untouched)
//     <textarea id="<p>-thinking" class="<family>think-input ..." aria-label="LABEL">
//     <div class="<family>think-model" id="<p>-think-model">
//       <span class="tm-label">...</span>MODEL
//     </div>
//   </div>
//
// <family> is "" (unprefixed classes) or "<p>-", matching the box's own class.
// Discovery is scoped to the box, so same-family classes elsewhere in the
// lesson (for example a second `<p>-think-input` textarea in Explore) are
// never mistaken for the component. The model answer is either inline prose
// (text and inline prose tags) or a run of <p> paragraphs holding inline
// prose; that canonical kind decides which record form may be rendered into
// it (assessmentPresentation.modelAnswerKindEquivalence). Anything ambiguous,
// missing, or structurally unexpected throws.

const SYT_BOX_CLASS_RE = /^(?:([a-z][a-z0-9]*)-)?think-box$/;
const SYT_ID_RE = /(?:^|\s)id\s*=\s*(?:"([^"]*)"|'([^']*)')/i;
const SYT_ARIA_LABEL_RE = /\saria-label="([^"]*)"/g;

// The shared invariance tokenizer's contiguous token stream, with each
// token's [start, end) offset in `html`.
function positionedTokens(html) {
  let at = 0;
  const tokens = invariance.tokenize(html).map((t) => {
    const bytes = t.type === "open" || t.type === "close" ? t.raw : t.value;
    const start = at;
    at += bytes.length;
    return { ...t, start, end: at };
  });
  if (at !== html.length) fail("Show Your Thinking locator could not tokenize the lesson contiguously");
  return tokens;
}

function idOf(attrs) {
  const m = SYT_ID_RE.exec(attrs);
  return m ? (m[1] !== undefined ? m[1] : m[2]) : null;
}

function classesOf(attrs) {
  const m = /(?:^|\s)class\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  return m ? (m[1] !== undefined ? m[1] : m[2]).split(/\s+/).filter(Boolean) : [];
}

// The open tag's attributes of any open or raw element token.
function attrsOf(token) {
  if (token.type === "open") return token.attrs;
  if (token.type === "raw" && token.kind !== "comment" && token.kind !== "decl") {
    const open = token.value.slice(0, findTagEnd(token.value, 0));
    return open.replace(/^<[A-Za-z][A-Za-z0-9:-]*/, "").replace(/\/?>$/, "");
  }
  return null;
}

// Index of the close token matching the open token at `i`.
function closeIndex(tokens, i) {
  const tag = tokens[i].tag;
  let depth = 0;
  for (let j = i; j < tokens.length; j += 1) {
    const t = tokens[j];
    if (t.type === "open" && t.tag === tag && !t.selfClosing) depth += 1;
    else if (t.type === "close" && t.tag === tag) {
      depth -= 1;
      if (depth === 0) return j;
    }
  }
  return fail(`Show Your Thinking <${tag}> at offset ${tokens[i].start} is never closed`);
}

function isInlineProse(tokens, from, to) {
  for (let j = from; j < to; j += 1) {
    const t = tokens[j];
    if (t.type === "raw") return false;
    if ((t.type === "open" || t.type === "close") && !invariance.INLINE_PROSE_TAGS.has(t.tag)) return false;
  }
  return true;
}

// Canonical model-answer kind of the content tokens (from, to): "inline" or
// "paragraphs". Throws on anything else.
function modelKindOf(tokens, from, to, label) {
  let paragraphs = 0;
  let looseText = false;
  let other = false;
  for (let j = from; j < to; j += 1) {
    const t = tokens[j];
    if (t.type === "text") {
      if (t.value.trim() !== "") looseText = true;
    } else if (t.type === "open" && t.tag === "p") {
      const end = closeIndex(tokens, j);
      if (end >= to || !isInlineProse(tokens, j + 1, end)) other = true;
      paragraphs += 1;
      j = end;
    } else if (t.type === "open" && invariance.INLINE_PROSE_TAGS.has(t.tag)) {
      looseText = true;
      if (!t.selfClosing) {
        const end = closeIndex(tokens, j);
        if (end >= to || !isInlineProse(tokens, j + 1, end)) other = true;
        j = end;
      }
    } else {
      other = true;
    }
  }
  if (!other && paragraphs > 0 && !looseText) return "paragraphs";
  if (!other && paragraphs === 0 && looseText) return "inline";
  return fail(`${label} has an unsupported model-answer structure; expected inline prose or <p> paragraphs of inline prose`);
}

// Locates the one Show Your Thinking component, or returns null when the
// lesson has none. Offsets are content ranges: prompt inner HTML, the
// textarea aria-label value, and the model content after its tm-label span.
function locateShowYourThinking(html) {
  const tokens = positionedTokens(html);
  const boxes = [];
  tokens.forEach((t, i) => {
    if (t.type === "open" && t.classes.some((c) => SYT_BOX_CLASS_RE.test(c))) boxes.push(i);
  });
  if (boxes.length === 0) return null;
  if (boxes.length !== 1) fail(`lesson has ${boxes.length} Show Your Thinking components (think-box); expected exactly one`);

  const bi = boxes[0];
  const box = tokens[bi];
  const boxId = idOf(box.attrs);
  const idMatch = /^([a-z][a-z0-9]*)-think$/.exec(boxId || "");
  if (box.tag !== "div" || !idMatch) {
    fail(`Show Your Thinking component must be a <div id="<prefix>-think"> (found <${box.tag}> ${boxId === null ? "with no id" : `id="${boxId}"`})`);
  }
  const prefix = idMatch[1];
  const familyClasses = box.classes.filter((c) => SYT_BOX_CLASS_RE.test(c));
  let family = null;
  if (familyClasses.length === 1 && familyClasses[0] === "think-box") family = "";
  if (familyClasses.length === 1 && familyClasses[0] === `${prefix}-think-box`) family = `${prefix}-`;
  if (family === null) {
    fail(`#${prefix}-think class "${familyClasses.join(" ")}" does not match its prefix; expected think-box or ${prefix}-think-box`);
  }
  const box$ = `#${prefix}-think`;

  const literals = findQuizLiterals(html);
  if (literals.length !== 1) fail(`${box$} needs exactly one <prefix>QuizQuestions literal to confirm its prefix, found ${literals.length}`);
  if (literals[0].prefix !== prefix) fail(`${box$} prefix "${prefix}" does not match the quiz literal prefix "${literals[0].prefix}"`);

  const inputId = `${prefix}-thinking`;
  const modelId = `${prefix}-think-model`;
  const idCounts = new Map();
  for (const t of tokens) {
    const attrs = attrsOf(t);
    const id = attrs === null ? null : idOf(attrs);
    if (id !== null) idCounts.set(id, (idCounts.get(id) || 0) + 1);
  }
  for (const id of [`${prefix}-think`, inputId, modelId]) {
    if (idCounts.get(id) !== 1) fail(`id "${id}" must appear exactly once in the lesson (found ${idCounts.get(id) || 0})`);
  }

  const be = closeIndex(tokens, bi);
  const inside = [];
  for (let j = bi + 1; j < be; j += 1) inside.push(j);

  // Prompt.
  const promptClass = `${family}think-prompt`;
  const prompts = inside.filter((j) => tokens[j].type === "open" && tokens[j].tag === "p" && tokens[j].classes.includes(promptClass));
  if (prompts.length !== 1) fail(`lesson has ${prompts.length} ${promptClass} anchor(s) inside ${box$}; expected exactly one`);
  const pe = closeIndex(tokens, prompts[0]);

  // Textarea (the only one in the component).
  const areas = inside.filter((j) => tokens[j].type === "raw" && tokens[j].kind === "textarea");
  if (areas.length !== 1) fail(`${box$} contains ${areas.length} textarea(s); expected exactly one, #${inputId}`);
  const area = tokens[areas[0]];
  const areaAttrs = attrsOf(area);
  if (idOf(areaAttrs) !== inputId) fail(`the ${box$} textarea must be #${inputId}`);
  if (!classesOf(areaAttrs).includes(`${family}think-input`)) fail(`#${inputId} must carry class ${family}think-input`);
  const areaOpen = area.value.slice(0, findTagEnd(area.value, 0));
  const labels = [...areaOpen.matchAll(SYT_ARIA_LABEL_RE)];
  if (labels.length !== 1 || labels[0][1].trim() === "") fail(`#${inputId} must carry exactly one non-empty double-quoted aria-label`);
  const labelStart = area.start + labels[0].index + ' aria-label="'.length;

  // Model answer: tm-label span first, then the answer itself.
  const models = inside.filter((j) => tokens[j].type === "open" && tokens[j].tag === "div" && idOf(tokens[j].attrs) === modelId);
  if (models.length !== 1) fail(`#${modelId} must be inside ${box$}`);
  const mi = models[0];
  if (!tokens[mi].classes.includes(`${family}think-model`)) fail(`#${modelId} must carry class ${family}think-model`);
  const me = closeIndex(tokens, mi);
  let si = mi + 1;
  while (si < me && tokens[si].type === "text" && tokens[si].value.trim() === "") si += 1;
  if (si >= me || tokens[si].type !== "open" || tokens[si].tag !== "span" || !tokens[si].classes.includes("tm-label")) {
    fail(`#${modelId} must begin with its <span class="tm-label">`);
  }
  const se = closeIndex(tokens, si);
  if (se !== si + 2 || tokens[si + 1].type !== "text") fail(`#${modelId} tm-label must hold plain text only`);
  const kind = modelKindOf(tokens, se + 1, me, `#${modelId}`);

  const prompt = { start: tokens[prompts[0]].end, end: tokens[pe].start };
  const ariaLabel = { start: labelStart, end: labelStart + labels[0][1].length };
  const model = { start: tokens[se].end, end: tokens[me].start, kind };
  return {
    prefix,
    family,
    box: { start: box.start, end: tokens[be].end },
    prompt,
    ariaLabel,
    model,
    text: {
      prompt: htmlToText(html.slice(prompt.start, prompt.end)),
      modelAnswer: htmlToText(html.slice(model.start, model.end)),
      ariaLabel: htmlToText(html.slice(ariaLabel.start, ariaLabel.end)),
    },
  };
}

// Reads the lesson's Show Your Thinking wording as plain text, with the
// canonical model-answer kind, or null when the lesson has no Show Your
// Thinking component. Throws when the component is ambiguous or malformed.
function readShowYourThinking(html) {
  const located = locateShowYourThinking(html);
  if (located === null) return null;
  return {
    prompt: located.text.prompt,
    modelAnswer: located.text.modelAnswer,
    ariaLabel: located.text.ariaLabel,
    modelKind: located.model.kind,
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

// The exact bytes an adapted block writes into the three located ranges.
// Record text is always escaped; the only markup is the renderer's own
// constant <strong> and <p> tags. The string model answer keeps its original
// single-run emission, byte for byte.
function showYourThinkingFragments(syt) {
  const body =
    typeof syt.modelAnswer === "string"
      ? escapeHtml(syt.modelAnswer)
      : syt.modelAnswer.paragraphs
        .map((p) => `<p>${p.lead !== null ? `<strong>${escapeHtml(p.lead)}</strong> ` : ""}${escapeHtml(p.text)}</p>`)
        .join("\n        ");
  return {
    prompt: boldRequiredTerms(escapeHtml(syt.prompt), syt.requiredTerms),
    model: `\n        ${body}\n      `,
    ariaLabel: escapeHtml(syt.prompt),
  };
}

function renderShowYourThinking(html, syt) {
  const located = locateShowYourThinking(html);
  if (located === null) {
    fail("lesson has 0 think-prompt anchor(s) (no Show Your Thinking component); an adapted Show Your Thinking block needs exactly one");
  }
  const kinds = AP.modelAnswerKindEquivalence(syt, { modelKind: located.model.kind });
  if (!kinds.ok) fail(`Show Your Thinking model answer cannot be rendered:\n  - ${kinds.failures.join("\n  - ")}`);
  const fragments = showYourThinkingFragments(syt);
  const edits = [
    [located.prompt, fragments.prompt],
    [located.ariaLabel, fragments.ariaLabel],
    [located.model, fragments.model],
  ].sort((a, b) => b[0].start - a[0].start);
  let out = html;
  for (const [range, bytes] of edits) out = out.slice(0, range.start) + bytes + out.slice(range.end);
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
  if (record.showYourThinking !== null) {
    const located = locateShowYourThinking(html);
    const expected = showYourThinkingFragments(record.showYourThinking);
    const at = (range) => html.slice(range.start, range.end);
    if (
      located === null ||
      at(located.prompt) !== expected.prompt ||
      at(located.ariaLabel) !== expected.ariaLabel ||
      at(located.model) !== expected.model
    ) {
      fail("rendered Show Your Thinking does not match the presentation");
    }
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
  locateShowYourThinking,
  showYourThinkingFragments,
  renderShowYourThinking,
  readShowYourThinking,
  readQuizDirections,
  renderAssessmentPresentation,
  renderCertifiedAssessmentPresentation,
};
