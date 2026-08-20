/*
 * Sprint 28 Phase 5B - Assessment answer-key fidelity tooling.
 *
 * The canonical lesson quiz is the single authority for every assessment
 * revision payload. This module extracts a lesson's quiz DETERMINISTICALLY
 * and STATICALLY from its canonical source, transforms it into the
 * production assessment-deployment payload shape, and independently
 * validates a committed payload against a fresh extraction.
 *
 * SAFETY: the extractor never executes lesson JavaScript. It parses the
 * lesson's inline <script> blocks with acorn into an AST and STATICALLY
 * evaluates only the `<prefix>QuizQuestions` array literal, walking a fixed
 * set of literal node types (string / number / boolean / null literals,
 * array literals, object literals, no-expression template literals, and a
 * unary minus on a numeric literal). Any other node type (a call, an
 * identifier reference, a string concatenation, a template literal with an
 * interpolation) throws, so an ambiguous or non-static quiz literal STOPS
 * that lesson rather than being guessed. No `eval`, no `Function`, no `vm`,
 * no DOM, no lesson runtime behavior.
 *
 * The payload schema mirrored here is the production schema enforced by
 * `platform/functions/src/assessments/assessment-deployment.ts`
 * (`validateDeploymentInput`). That function remains the deployment-time
 * authority (Sprint 29); the checks below are a faithful, documented mirror
 * used for repository-side authoring and fidelity validation only. The
 * transform is intentionally the ONLY place canonical quiz semantics become
 * a payload, so the authoring path and the validation path derive expected
 * semantics from the same canonical source independently of any committed
 * file.
 */

const acorn = require("acorn");

// -- Canonical quiz extraction (static AST, no execution) -----------------

// Isolate every inline <script> body from the lesson HTML. Only the script
// text is handed to acorn; nothing runs.
function extractScriptBodies(html) {
  const bodies = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    // Skip external scripts (src=...) which carry no inline body.
    const openTag = m[0].slice(0, m[0].indexOf(">") + 1);
    if (/\bsrc\s*=/i.test(openTag)) continue;
    bodies.push(m[1]);
  }
  return bodies;
}

// Statically evaluate a literal AST node into a plain JS value. Throws on
// any non-literal node so a non-static quiz literal is rejected, not
// guessed.
function staticEval(node, ctx) {
  switch (node.type) {
    case "Literal":
      // string | number | boolean | null | RegExp. Reject RegExp (not a
      // valid quiz value) by requiring a primitive.
      if (
        typeof node.value === "string" ||
        typeof node.value === "number" ||
        typeof node.value === "boolean" ||
        node.value === null
      ) {
        return node.value;
      }
      throw new Error(`${ctx}: unsupported literal value`);
    case "TemplateLiteral":
      if (node.expressions.length !== 0) {
        throw new Error(`${ctx}: template literal has interpolation (non-static)`);
      }
      // Cooked value of the single quasi. Concatenate quasis defensively
      // (a no-expression template literal has exactly one).
      return node.quasis.map((q) => q.value.cooked).join("");
    case "ArrayExpression":
      return node.elements.map((el, i) => {
        if (el === null) throw new Error(`${ctx}[${i}]: sparse array hole`);
        return staticEval(el, `${ctx}[${i}]`);
      });
    case "ObjectExpression": {
      const obj = {};
      for (const prop of node.properties) {
        if (prop.type !== "Property" || prop.computed || prop.kind !== "init") {
          throw new Error(`${ctx}: unsupported object member`);
        }
        const key =
          prop.key.type === "Identifier"
            ? prop.key.name
            : prop.key.type === "Literal"
              ? String(prop.key.value)
              : null;
        if (key === null) throw new Error(`${ctx}: unsupported property key`);
        obj[key] = staticEval(prop.value, `${ctx}.${key}`);
      }
      return obj;
    }
    case "UnaryExpression":
      if (node.operator === "-" && node.argument.type === "Literal" && typeof node.argument.value === "number") {
        return -node.argument.value;
      }
      throw new Error(`${ctx}: unsupported unary expression`);
    default:
      throw new Error(`${ctx}: non-static node type "${node.type}"`);
  }
}

// Find the single `<prefix>QuizQuestions` declarator across all script
// bodies and statically evaluate its array initializer. Returns
// { prefix, questions } where questions is the raw canonical array.
function extractCanonicalQuizRaw(html, slug) {
  const bodies = extractScriptBodies(html);
  const found = [];
  for (const body of bodies) {
    let program;
    try {
      program = acorn.parse(body, { ecmaVersion: "latest" });
    } catch {
      // A script body that does not parse standalone (rare) is skipped;
      // the quiz declaration lives in a self-contained script body.
      continue;
    }
    for (const stmt of program.body) {
      if (stmt.type !== "VariableDeclaration") continue;
      for (const decl of stmt.declarations) {
        if (
          decl.id.type === "Identifier" &&
          /QuizQuestions$/.test(decl.id.name) &&
          decl.init &&
          decl.init.type === "ArrayExpression"
        ) {
          found.push({
            prefix: decl.id.name.replace(/QuizQuestions$/, ""),
            init: decl.init,
          });
        }
      }
    }
  }
  if (found.length === 0) {
    throw new Error(`[${slug}] no <prefix>QuizQuestions array literal found`);
  }
  if (found.length > 1) {
    throw new Error(
      `[${slug}] multiple QuizQuestions declarations found: ${found
        .map((f) => `${f.prefix}QuizQuestions`)
        .join(", ")}`,
    );
  }
  const questions = staticEval(found[0].init, `${slug}.${found[0].prefix}QuizQuestions`);
  return { prefix: found[0].prefix, questions };
}

// Normalize a canonical quiz into the fields the payload derives from.
// Enforces the shape each question must have; throws (STOP) on anything
// malformed or ambiguous.
function extractCanonicalQuiz(html, slug) {
  const { prefix, questions } = extractCanonicalQuizRaw(html, slug);
  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error(`[${slug}] quiz array is empty`);
  }
  const normalized = questions.map((q, i) => {
    const at = `[${slug}] question ${i + 1}`;
    if (q === null || typeof q !== "object" || Array.isArray(q)) {
      throw new Error(`${at} is not an object`);
    }
    if (typeof q.q !== "string" || q.q.trim().length === 0) {
      throw new Error(`${at} missing string .q (stem)`);
    }
    if (!Array.isArray(q.options) || q.options.length < 2) {
      throw new Error(`${at} must have >= 2 options`);
    }
    q.options.forEach((o, oi) => {
      if (typeof o !== "string" || o.trim().length === 0) {
        throw new Error(`${at} option ${oi} is not a non-empty string`);
      }
    });
    if (typeof q.correct !== "number" || !Number.isInteger(q.correct)) {
      throw new Error(`${at} missing integer .correct index`);
    }
    if (q.correct < 0 || q.correct >= q.options.length) {
      throw new Error(`${at} .correct index ${q.correct} out of range`);
    }
    if (typeof q.explanation !== "string" || q.explanation.trim().length === 0) {
      throw new Error(`${at} missing non-empty string .explanation`);
    }
    return {
      q: q.q,
      options: q.options.slice(),
      correct: q.correct,
      explanation: q.explanation,
    };
  });
  return { prefix, questions: normalized };
}

// -- Payload transform ----------------------------------------------------

// Deterministic option-id grammar: position 0 -> "A", 1 -> "B", ... This is
// the single place index-to-letter mapping is defined for both authoring
// and validation, so both sides agree by construction.
function optionIdForIndex(i) {
  return String.fromCharCode(65 + i);
}

// Build the production payload from a canonical quiz. The ONLY transform:
// itemId = q{n}, option letters by position, correctOptionId = letter of
// the canonical `correct` index. No wording, ordering, or answer change.
function buildPayload(slug, quiz, publishedBy) {
  return {
    activityId: slug,
    revisionOrdinal: 1,
    itemOrderingRule: "authoredOrder",
    schemaVersion: 1,
    publishedBy,
    items: quiz.questions.map((q, i) => ({
      itemId: `q${i + 1}`,
      itemType: "singleChoice",
      stem: q.q,
      options: q.options.map((text, oi) => ({
        optionId: optionIdForIndex(oi),
        text,
      })),
      points: 1,
      correctOptionId: optionIdForIndex(q.correct),
      explanation: q.explanation,
    })),
  };
}

// -- Schema validation (faithful mirror of validateDeploymentInput) -------

const ACTIVITY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function assertSchemaValid(payload, slug) {
  const problems = [];
  const push = (m) => problems.push(`[${slug}] ${m}`);

  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    push("payload must be a structured object");
    return problems;
  }
  if (typeof payload.activityId !== "string" || !ACTIVITY_ID_PATTERN.test(payload.activityId)) {
    push("activityId must be a URL-safe non-empty string");
  }
  if (payload.revisionOrdinal !== 1) push("revisionOrdinal must be 1 (r1)");
  if (payload.itemOrderingRule !== "authoredOrder") push('itemOrderingRule must be "authoredOrder"');
  if (payload.schemaVersion !== 1) push("schemaVersion must be the numeric literal 1");
  if (typeof payload.publishedBy !== "string" || payload.publishedBy.trim().length === 0) {
    push("publishedBy must be a non-empty string");
  }
  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    push("items must be a non-empty array");
    return problems;
  }
  const seenItemIds = new Set();
  payload.items.forEach((item, idx) => {
    const at = `item ${idx} (${item && item.itemId})`;
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      push(`${at} must be an object`);
      return;
    }
    if (typeof item.itemId !== "string" || !IDENTIFIER_PATTERN.test(item.itemId)) {
      push(`${at} itemId must be URL-safe`);
    }
    if (seenItemIds.has(item.itemId)) push(`${at} duplicate itemId`);
    seenItemIds.add(item.itemId);
    if (item.itemType !== "singleChoice") push(`${at} itemType must be "singleChoice"`);
    if (typeof item.stem !== "string" || item.stem.trim().length === 0) push(`${at} stem must be non-empty`);
    if (item.points !== 1) push(`${at} points must be 1`);
    if (!Array.isArray(item.options) || item.options.length < 2) {
      push(`${at} must have >= 2 options`);
      return;
    }
    const seenOptionIds = new Set();
    item.options.forEach((opt, oi) => {
      if (opt === null || typeof opt !== "object" || Array.isArray(opt)) {
        push(`${at} option ${oi} must be an object`);
        return;
      }
      if (typeof opt.optionId !== "string" || !IDENTIFIER_PATTERN.test(opt.optionId)) {
        push(`${at} option ${oi} optionId must be URL-safe`);
      }
      if (seenOptionIds.has(opt.optionId)) push(`${at} option ${oi} duplicate optionId`);
      seenOptionIds.add(opt.optionId);
      if (typeof opt.text !== "string" || opt.text.trim().length === 0) {
        push(`${at} option ${oi} text must be non-empty`);
      }
    });
    if (typeof item.correctOptionId !== "string" || item.correctOptionId.length === 0) {
      push(`${at} correctOptionId must be non-empty`);
    } else if (!seenOptionIds.has(item.correctOptionId)) {
      push(`${at} correctOptionId not among options`);
    }
    if (typeof item.explanation !== "string" || item.explanation.trim().length === 0) {
      push(`${at} explanation must be non-empty`);
    }
  });
  return problems;
}

// -- Fidelity validation (independent, canonical-derived) -----------------

// Compare a committed payload field-by-field against an INDEPENDENT fresh
// extraction of the canonical quiz. This is not "file equals itself": the
// expected semantics are re-derived from the lesson source, not from the
// payload. Returns an array of human-readable mismatch strings (empty =
// exact fidelity).
function checkFidelity(slug, payload, quiz) {
  const problems = [];
  const push = (m) => problems.push(`[${slug}] ${m}`);

  if (payload.activityId !== slug) {
    push(`activityId "${payload.activityId}" != slug "${slug}"`);
  }
  const canonicalCount = quiz.questions.length;
  const payloadCount = Array.isArray(payload.items) ? payload.items.length : -1;
  if (payloadCount !== canonicalCount) {
    push(`question count ${payloadCount} != canonical ${canonicalCount}`);
    return problems; // count mismatch makes per-question mapping meaningless
  }
  quiz.questions.forEach((cq, i) => {
    const item = payload.items[i];
    const at = `q${i + 1}`;
    if (item.stem !== cq.q) {
      push(`${at} stem mismatch\n  canonical: ${JSON.stringify(cq.q)}\n  payload:   ${JSON.stringify(item.stem)}`);
    }
    const payloadOptTexts = Array.isArray(item.options) ? item.options.map((o) => o.text) : [];
    if (payloadOptTexts.length !== cq.options.length) {
      push(`${at} choice count ${payloadOptTexts.length} != canonical ${cq.options.length}`);
    } else {
      cq.options.forEach((text, oi) => {
        if (payloadOptTexts[oi] !== text) {
          push(
            `${at} choice ${oi} (${optionIdForIndex(oi)}) mismatch\n  canonical: ${JSON.stringify(text)}\n  payload:   ${JSON.stringify(payloadOptTexts[oi])}`,
          );
        }
        // Option ids must be positional letters.
        if (item.options[oi] && item.options[oi].optionId !== optionIdForIndex(oi)) {
          push(`${at} option ${oi} id "${item.options[oi].optionId}" != expected "${optionIdForIndex(oi)}"`);
        }
      });
    }
    const expectedCorrect = optionIdForIndex(cq.correct);
    if (item.correctOptionId !== expectedCorrect) {
      push(
        `${at} correct answer mismatch\n  canonical index ${cq.correct} -> "${expectedCorrect}"\n  payload correctOptionId: "${item.correctOptionId}"`,
      );
    }
    if (item.explanation !== cq.explanation) {
      push(`${at} explanation mismatch\n  canonical: ${JSON.stringify(cq.explanation)}\n  payload:   ${JSON.stringify(item.explanation)}`);
    }
    if (item.points !== 1) push(`${at} points ${item.points} != 1 (scoring)`);
    if (item.itemType !== "singleChoice") push(`${at} itemType != singleChoice (scoring)`);
  });
  return problems;
}

module.exports = {
  extractScriptBodies,
  extractCanonicalQuiz,
  buildPayload,
  assertSchemaValid,
  checkFidelity,
  optionIdForIndex,
};
