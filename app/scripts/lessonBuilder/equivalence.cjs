/*
 * Instructional-equivalence contract (Sprint 18 correction 9).
 *
 * Extracts a normalized description of a lesson's instructional content
 * from raw HTML bytes and compares two extractions. Everything a
 * student sees or interacts with pedagogically must be identical
 * between v1 and v2. Declared delivery differences (legacy classroom
 * markup, v1-only functions, the v2-only standalone completion
 * message) are the ONLY fields excluded.
 *
 * Extraction is intentionally string-based rather than DOM-based so the
 * builder has no runtime dependency on jsdom. Every extractor is a
 * targeted read against a well-defined selector or JS literal.
 *
 * Contract shape:
 *   {
 *     documentTitle, htmlLang,
 *     h1, h2s, h3s, sectionLabels,
 *     learningGoals: [ {text} ],
 *     vocabulary: [ {order, term, definition, ariaExpanded,
 *                    ariaLabel, role, id, classList} ],
 *     imgAccessibility: [ {src, alt} ],
 *     svgAccessibility: [ {role, ariaLabel, ariaHidden} ],
 *     showYourThinking: { prompt, modelAnswer },
 *     quiz: { questions: [ {q, options, correct, explanation} ] },
 *     scoringMessages: { perfect, high, mid, low },
 *     moreLearning: { intro, cards: [ {order, tag, href, ariaLabel,
 *                     name, description, category, status,
 *                     classList} ] },
 *     connections: { intro, cards: [ ...same shape as moreLearning ] },
 *     interactiveIds: [ ...sorted... ],
 *     scrollTargets: [ ...sorted unique target ids... ],
 *     scrollDestinations: [ {function, target, kind} ],
 *     runtimeInclude, lessonQuizCallSites: [...],
 *   }
 */

"use strict";

function normWs(s) {
  return s.replace(/\s+/g, " ").trim();
}

function stripTags(s) {
  return s.replace(/<[^>]+>/g, "");
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function textOf(s) {
  return normWs(decodeEntities(stripTags(s)));
}

function firstMatch(re, source) {
  const m = source.match(re);
  return m ? m[1] : null;
}

function extractDocumentTitle(html) {
  return textOf(firstMatch(/<title>([\s\S]*?)<\/title>/i, html) || "");
}

function extractHtmlLang(html) {
  return firstMatch(/<html[^>]*\blang="([^"]+)"/i, html) || "";
}

function extractAllHeadings(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "gi");
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(textOf(m[1]));
  return out;
}

function extractSectionLabels(html) {
  const re = /<span class="section-label">([\s\S]*?)<\/span>/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push(textOf(m[1]));
  return out;
}

function extractLearningGoals(html) {
  const openIdx = html.indexOf('id="goals"');
  if (openIdx === -1) return [];
  const start = html.lastIndexOf("<section", openIdx);
  const end = html.indexOf("</section>", openIdx);
  if (start === -1 || end === -1) return [];
  const slice = html.slice(start, end);
  const items = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/g;
  let m;
  while ((m = re.exec(slice))) items.push({ text: textOf(m[1]) });
  return items;
}

function extractVocabulary(html) {
  // Canonical glossary card: <button class="glossary-card [variants]"
  //   type="button" aria-expanded="..."> ... <span class="gc-term">TERM</span>
  //   ... <div class="gc-def">DEFINITION</div> ... </button>.
  // The card may also appear as a <div>; both are accepted. Order of
  // appearance is preserved. Every field a student can perceive on the
  // card (term text, definition text, ARIA state, class variant used to
  // theme and identify the card) is captured, plus any stable id.
  const cards = [];
  const re = /<(button|div)\b([^>]*\bclass="[^"]*\bglossary-card\b[^"]*"[^>]*)>([\s\S]*?)<\/\1>/g;
  let m;
  let index = 0;
  while ((m = re.exec(html))) {
    const attrs = m[2];
    const inner = m[3];
    // Skip anything that looks like a nested inner block.
    if (!/gc-term/.test(inner)) continue;
    const classAttr = firstMatch(/\bclass="([^"]*)"/, attrs) || "";
    const classes = classAttr.split(/\s+/).filter(Boolean).sort();
    const term = textOf(firstMatch(/<span[^>]*class="[^"]*\bgc-term\b[^"]*"[^>]*>([\s\S]*?)<\/span>/, inner) || "");
    const def = textOf(firstMatch(/<div[^>]*class="[^"]*\bgc-def\b[^"]*"[^>]*>([\s\S]*?)<\/div>/, inner) || "");
    if (!term && !def) continue;
    cards.push({
      order: index++,
      term,
      definition: def,
      ariaExpanded: firstMatch(/\baria-expanded="([^"]*)"/, attrs),
      ariaLabel: firstMatch(/\baria-label="([^"]*)"/, attrs),
      role: firstMatch(/\brole="([^"]*)"/, attrs),
      id: firstMatch(/\bid="([^"]*)"/, attrs),
      classList: classes,
    });
  }
  return cards;
}

function extractImages(html) {
  const out = [];
  const re = /<img\b([^>]*?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    const src = firstMatch(/\bsrc="([^"]*)"/, attrs) || "";
    const alt = firstMatch(/\balt="([^"]*)"/, attrs);
    out.push({ src, alt: alt === null ? null : decodeEntities(alt) });
  }
  return out;
}

function extractSvgAccessibility(html) {
  const out = [];
  const re = /<svg\b([^>]*?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1];
    out.push({
      role: firstMatch(/\brole="([^"]*)"/, attrs),
      ariaLabel: firstMatch(/\baria-label="([^"]*)"/, attrs),
      ariaHidden: firstMatch(/\baria-hidden="([^"]*)"/, attrs),
    });
  }
  return out;
}

function extractShowYourThinking(html) {
  const box = firstMatch(/<div class="think-box"[^>]*id="el-think"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/, html);
  if (!box) return { prompt: "", modelAnswer: "" };
  const prompt = textOf(firstMatch(/<p class="think-prompt">([\s\S]*?)<\/p>/, box) || "");
  const modelAnswer = textOf(firstMatch(/<div class="think-model"[^>]*id="el-think-model">([\s\S]*?)<\/div>/, box) || "");
  return { prompt, modelAnswer };
}

function extractQuizArray(html) {
  // Isolate the JS literal `var elQuizQuestions = [ ... ];` and eval-
  // parse it inside a scoped Function so no other lesson code runs.
  const m = html.match(/var\s+elQuizQuestions\s*=\s*(\[[\s\S]*?\n\]);/);
  if (!m) return { questions: [] };
  const literal = m[1];
  let value;
  try {
    // eslint-disable-next-line no-new-func
    value = new Function(`return (${literal});`)();
  } catch (err) {
    throw new Error(`[equivalence] failed to parse elQuizQuestions literal: ${err.message}`);
  }
  if (!Array.isArray(value)) throw new Error("[equivalence] elQuizQuestions is not an array");
  const questions = value.map((q, i) => {
    if (typeof q.q !== "string") throw new Error(`[equivalence] question ${i} missing .q`);
    if (!Array.isArray(q.options)) throw new Error(`[equivalence] question ${i} missing .options`);
    if (typeof q.correct !== "number") throw new Error(`[equivalence] question ${i} missing .correct`);
    if (typeof q.explanation !== "string") throw new Error(`[equivalence] question ${i} missing .explanation`);
    return {
      q: normWs(q.q),
      options: q.options.map((o) => normWs(String(o))),
      correct: q.correct,
      explanation: normWs(q.explanation),
    };
  });
  return { questions };
}

function extractScoringMessages(html) {
  // The scoring-message ternary lives near the end of elSubmitQuiz. It
  // is a canonical instructional string set; changes here would be a
  // pedagogical regression.
  const m = html.match(/var\s+msg\s*=\s*pct === 100\s*\?\s*'([^']*)'\s*[\s\S]*?:\s*pct >= 80\s*\?\s*'([^']*)'\s*[\s\S]*?:\s*pct >= 60\s*\?\s*'([^']*)'\s*[\s\S]*?:\s*'([^']*)'/);
  if (!m) return null;
  return {
    perfect: normWs(m[1]),
    high: normWs(m[2]),
    mid: normWs(m[3]),
    low: normWs(m[4]),
  };
}

function extractSectionById(html, id) {
  const openIdx = html.indexOf(`id="${id}"`);
  if (openIdx === -1) return null;
  const start = html.lastIndexOf("<section", openIdx);
  if (start === -1) return null;
  // Find matching </section> by counting.
  const openRe = /<section\b/gi;
  const closeRe = /<\/section>/gi;
  openRe.lastIndex = start + 1;
  closeRe.lastIndex = start + 1;
  let depth = 1;
  while (depth > 0) {
    const o = openRe.exec(html);
    const c = closeRe.exec(html);
    if (!c) return null;
    if (o && o.index < c.index) {
      depth += 1;
      closeRe.lastIndex = o.index + 1;
    } else {
      depth -= 1;
      if (depth === 0) return html.slice(start, c.index + c[0].length);
      openRe.lastIndex = c.index + c[0].length;
      closeRe.lastIndex = c.index + c[0].length;
    }
  }
  return null;
}

// A cont-card is either <a class="cont-card ..." href="..."> (a real
// lesson connection) or <div class="cont-card soon"> (a placeholder).
// Both variants are captured; classification is preserved by the sorted
// classList so a change from "lesson" to "soon" is a mismatch.
function extractContCards(sectionHtml) {
  const cards = [];
  const re = /<(a|div)\b([^>]*\bclass="[^"]*\bcont-card\b[^"]*"[^>]*)>([\s\S]*?)<\/\1>/g;
  let m;
  let index = 0;
  while ((m = re.exec(sectionHtml))) {
    const tag = m[1];
    const attrs = m[2];
    const inner = m[3];
    const classAttr = firstMatch(/\bclass="([^"]*)"/, attrs) || "";
    const classes = classAttr.split(/\s+/).filter(Boolean).sort();
    cards.push({
      order: index++,
      tag,
      href: firstMatch(/\bhref="([^"]*)"/, attrs),
      ariaLabel: firstMatch(/\baria-label="([^"]*)"/, attrs),
      name: textOf(firstMatch(/<div[^>]*class="[^"]*\bcont-name\b[^"]*"[^>]*>([\s\S]*?)<\/div>/, inner) || ""),
      description: textOf(firstMatch(/<div[^>]*class="[^"]*\bcont-desc\b[^"]*"[^>]*>([\s\S]*?)<\/div>/, inner) || ""),
      category: textOf(firstMatch(/<div[^>]*class="[^"]*\bcont-cat\b[^"]*"[^>]*>([\s\S]*?)<\/div>/, inner) || ""),
      status: textOf(firstMatch(/<span[^>]*class="[^"]*\bcont-status\b[^"]*"[^>]*>([\s\S]*?)<\/span>/, inner) || ""),
      classList: classes,
    });
  }
  return cards;
}

function extractContinue(html) {
  const sec = extractSectionById(html, "continue");
  if (!sec) return { intro: "", cards: [] };
  const intro = textOf(firstMatch(/<p[^>]*class="[^"]*\bcontinue-intro\b[^"]*"[^>]*>([\s\S]*?)<\/p>/, sec) || "");
  return { intro, cards: extractContCards(sec) };
}

function extractConnections(html) {
  const sec = extractSectionById(html, "connections");
  if (!sec) return { intro: "", cards: [] };
  const intro = textOf(
    firstMatch(/<p[^>]*class="[^"]*\bcontinue-intro\b[^"]*"[^>]*>([\s\S]*?)<\/p>/, sec) ||
      firstMatch(/<p[^>]*class="[^"]*\bsection-desc\b[^"]*"[^>]*>([\s\S]*?)<\/p>/, sec) ||
      "",
  );
  return { intro, cards: extractContCards(sec) };
}

function extractInteractiveIds(html) {
  // Every id under the quiz + STT + score-board that both artifacts
  // must expose so shared JS can bind to it. Restrict to the el-* / student-info /
  // score-board namespace so v1/v2 delivery-only ids do not distort
  // the comparison.
  const kept = new Set();
  const re = /\bid="(el-[a-z0-9-]+|score-board|el-score|el-think|el-think-model|el-thinking|el-progress|el-progress-text|el-quiz-questions|el-submit-btn|el-submit-status|el-score-num|el-score-msg|continue|connections|main|quiz)"/g;
  let m;
  while ((m = re.exec(html))) kept.add(m[1]);
  return [...kept].sort();
}

// Locate every top-level `function NAME(...)` in a script body and
// return their (name, start, end) ranges. End is the position just
// past the balanced closing brace. Only well-formed named function
// declarations are recognized; IIFEs and anonymous functions do not
// classify scroll destinations and their calls receive a null owner.
function findNamedFunctions(script) {
  const out = [];
  const re = /\bfunction\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = re.exec(script))) {
    const openBrace = m.index + m[0].length - 1;
    let depth = 1;
    let i = openBrace + 1;
    let inStr = null;
    let inLine = false;
    let inBlock = false;
    while (i < script.length && depth > 0) {
      const ch = script[i];
      const nx = script[i + 1];
      if (inLine) {
        if (ch === "\n") inLine = false;
      } else if (inBlock) {
        if (ch === "*" && nx === "/") { inBlock = false; i++; }
      } else if (inStr) {
        if (ch === "\\") i++;
        else if (ch === inStr) inStr = null;
      } else {
        if (ch === "/" && nx === "/") { inLine = true; i++; }
        else if (ch === "/" && nx === "*") { inBlock = true; i++; }
        else if (ch === '"' || ch === "'" || ch === "`") inStr = ch;
        else if (ch === "{") depth++;
        else if (ch === "}") depth--;
      }
      i++;
    }
    out.push({ name: m[1], start: m.index, end: i });
  }
  return out;
}

function enclosingFunctionName(fns, pos) {
  let best = null;
  for (const f of fns) {
    if (pos >= f.start && pos < f.end) {
      if (!best || f.start > best.start) best = f;
    }
  }
  return best ? best.name : null;
}

// Extract every scrollIntoView destination, resolving variable-bound
// receivers back to the getElementById('...') that produced them or
// to the querySelector href they were derived from. Each record ties
// a normalized target to the enclosing named function so a rename or
// re-wire of an instructional destination is detectable.
function extractScrollDestinations(html) {
  const scriptBodies = [];
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let sm;
  while ((sm = scriptRe.exec(html))) scriptBodies.push(sm[1]);
  const records = [];
  for (const body of scriptBodies) {
    const fns = findNamedFunctions(body);
    const callRe = /\.scrollIntoView\s*\(/g;
    let m;
    while ((m = callRe.exec(body))) {
      const dotPos = m.index;
      // Walk backward to isolate the receiver expression preceding
      // `.scrollIntoView`. Two forms are recognized: an identifier
      // (possibly dotted) or a parenthesized call ending immediately
      // before the dot, e.g. `document.getElementById('x')`.
      let raw = "";
      let j = dotPos - 1;
      if (j >= 0 && body[j] === ")") {
        let depth = 1;
        let k = j - 1;
        while (k >= 0 && depth > 0) {
          const ch = body[k];
          if (ch === ")") depth++;
          else if (ch === "(") depth--;
          k--;
        }
        // k+1 now points at the matching '('. Include the identifier
        // preceding the '('.
        let idEnd = k;
        let idStart = idEnd;
        while (idStart >= 0 && /[A-Za-z_$0-9.]/.test(body[idStart])) idStart--;
        raw = body.slice(idStart + 1, j + 1);
      } else {
        let k = j;
        while (k >= 0 && /[A-Za-z_$0-9.]/.test(body[k])) k--;
        raw = body.slice(k + 1, j + 1);
      }
      raw = raw.trim();
      const pos = m.index;
      const fn = enclosingFunctionName(fns, pos);
      let target = null;
      let kind = null;
      const inlineId = raw.match(/getElementById\(\s*'([^']+)'\s*\)$/);
      const inlineQs = raw.match(/querySelector\(\s*'([^']+)'\s*\)$/);
      if (inlineId) {
        target = inlineId[1];
        kind = "id";
      } else if (inlineQs) {
        target = inlineQs[1];
        kind = "selector";
      } else if (/^[A-Za-z_$][\w$]*$/.test(raw)) {
        const varName = raw;
        const preceding = body.slice(0, pos);
        const varIdRe = new RegExp(
          `\\bvar\\s+${varName}\\s*=\\s*document\\.getElementById\\(\\s*'([^']+)'\\s*\\)`,
          "g",
        );
        let vm; let lastId = null;
        while ((vm = varIdRe.exec(preceding))) lastId = vm[1];
        if (lastId !== null) {
          target = lastId;
          kind = "id";
        } else {
          const qsRe = new RegExp(
            `\\bvar\\s+${varName}\\s*=\\s*[^;]*getAttribute\\(\\s*'href'\\s*\\)`,
          );
          if (qsRe.test(preceding)) {
            const link = preceding.match(
              /document\.querySelector\(\s*'[^']*\[href="([^"]+)"\][^']*'\s*\)/,
            );
            if (link) {
              target = link[1];
              kind = "href";
            }
          }
        }
      }
      records.push({ function: fn, target, kind });
    }
  }
  records.sort((a, b) => {
    const fa = a.function || "";
    const fb = b.function || "";
    if (fa !== fb) return fa < fb ? -1 : 1;
    const ta = a.target || "";
    const tb = b.target || "";
    if (ta !== tb) return ta < tb ? -1 : 1;
    return (a.kind || "").localeCompare(b.kind || "");
  });
  return records;
}

function extractScrollTargets(html) {
  const set = new Set();
  for (const r of extractScrollDestinations(html)) {
    if (r.target) set.add(r.target);
  }
  return [...set].sort();
}

function extractRuntimeInclude(html) {
  return (
    firstMatch(/(<script defer src="\/assets\/lyfelabz-assessment-runtime\.js"><\/script>)/, html) || ""
  );
}

function extractLessonQuizCallSites(html) {
  const sites = [];
  const re = /window\.lyfelabz\.lessonQuiz\.(autosave|finalize|hasAssignmentContext|mapIndexSelectionsToResponses)\s*\(/g;
  let m;
  while ((m = re.exec(html))) sites.push(m[1]);
  return sites.sort();
}

function buildContract(html, exclusions) {
  const excl = exclusions || {};
  const idExcl = new Set(excl.interactiveIds || []);
  const scrollExcl = new Set(excl.scrollTargets || []);
  const filteredIds = extractInteractiveIds(html).filter((id) => !idExcl.has(id));
  const filteredScroll = extractScrollTargets(html).filter((t) => !scrollExcl.has(t));
  const filteredDestinations = extractScrollDestinations(html).filter(
    (d) => !scrollExcl.has(d.target),
  );
  return {
    documentTitle: extractDocumentTitle(html),
    htmlLang: extractHtmlLang(html),
    h1: extractAllHeadings(html, "h1"),
    h2s: extractAllHeadings(html, "h2"),
    h3s: extractAllHeadings(html, "h3"),
    sectionLabels: extractSectionLabels(html),
    learningGoals: extractLearningGoals(html),
    vocabulary: extractVocabulary(html),
    imgAccessibility: extractImages(html),
    svgAccessibility: extractSvgAccessibility(html),
    showYourThinking: extractShowYourThinking(html),
    quiz: extractQuizArray(html),
    scoringMessages: extractScoringMessages(html),
    moreLearning: extractContinue(html),
    connections: extractConnections(html),
    interactiveIds: filteredIds,
    scrollTargets: filteredScroll,
    scrollDestinations: filteredDestinations,
    runtimeInclude: extractRuntimeInclude(html),
    lessonQuizCallSites: extractLessonQuizCallSites(html),
  };
}

function diff(a, b, pathParts = []) {
  const mismatches = [];
  if (a === b) return mismatches;
  const aType = a === null ? "null" : Array.isArray(a) ? "array" : typeof a;
  const bType = b === null ? "null" : Array.isArray(b) ? "array" : typeof b;
  if (aType !== bType) {
    mismatches.push({ path: pathParts.join("."), v1: a, v2: b, kind: "type-mismatch" });
    return mismatches;
  }
  if (aType === "array") {
    if (a.length !== b.length) {
      mismatches.push({
        path: pathParts.join("."),
        v1: `array length ${a.length}`,
        v2: `array length ${b.length}`,
        kind: "length-mismatch",
      });
    }
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) mismatches.push(...diff(a[i], b[i], [...pathParts, `[${i}]`]));
    return mismatches;
  }
  if (aType === "object") {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of [...keys].sort()) mismatches.push(...diff(a[k], b[k], [...pathParts, k]));
    return mismatches;
  }
  mismatches.push({ path: pathParts.join("."), v1: a, v2: b, kind: "value-mismatch" });
  return mismatches;
}

function assertEquivalent(v1Html, v2Html, exclusions) {
  const c1 = buildContract(v1Html, exclusions);
  const c2 = buildContract(v2Html, exclusions);
  const mismatches = diff(c1, c2);
  if (mismatches.length === 0) return { ok: true, contract: c1 };
  const lines = mismatches.slice(0, 20).map((m) => {
    const v1 = typeof m.v1 === "string" ? JSON.stringify(m.v1) : JSON.stringify(m.v1);
    const v2 = typeof m.v2 === "string" ? JSON.stringify(m.v2) : JSON.stringify(m.v2);
    return `  - ${m.path} (${m.kind})\n      v1: ${v1}\n      v2: ${v2}`;
  });
  const extra = mismatches.length > 20 ? `\n  ...and ${mismatches.length - 20} more` : "";
  throw new Error(
    `[lesson-equivalence] instructional contract mismatch (${mismatches.length} field(s)):\n${lines.join("\n")}${extra}`,
  );
}

module.exports = { buildContract, assertEquivalent, diff };
