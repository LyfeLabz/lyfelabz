/*
 * F5.3 Slice 9B - canonical assessment revision declarations, revision-bound
 * canonical renditions, and the revision-to-path table
 * (DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md sections 21.3 to
 * 21.5, PDR-031).
 *
 * Declaration. Every canonical v1 and v2 artifact that loads the assessment
 * runtime, and every rendition, carries exactly one inert block
 *
 *   <script type="application/json" id="lyfelabz-assessment-revision">
 *     {"schemaVersion":1,"lessonSlug":"<slug>","assessmentRevisionId":"assessment_<slug>__r<N>"}
 *   </script>
 *
 * inserted immediately before the runtime <script> tag. It names the committed
 * revision the page displays and nothing else: no correctness, explanation,
 * accommodation, student, or assignment data. It is inserted only by the
 * canonical build path (index.cjs); the variant build path never calls this
 * module's insertion, so retained variant bytes are unaffected. AP-bound
 * variant pages keep declaring their revision through the existing
 * `lyfelabz-assessment-presentation` block, whose meaning is unchanged.
 *
 * Renditions. A lesson with more than one committed revision gets one v2
 * rendition per committed revision, including the configured canonical one,
 * at app/lessons/assessment-revisions/lesson_<slug>__r<N>.html. A rendition is
 * the current canonical v2 build (current instruction, chrome, and Show Your
 * Thinking) with ONLY the quiz literal regenerated from that revision's
 * immutable payload, relocated for its directory, and declared. The literal
 * carries exactly q, options, correct, and explanation (S9-E1), and a
 * revision is refused unless its item count and literal shape match the
 * lesson's quiz chrome (S9-D6); a literal with extra fields such as `visual`
 * is refused. Every rendition is re-extracted after rendering and must be
 * faithful to its own payload, or the build fails; nothing falls back to the
 * current quiz. A single-revision lesson produces no rendition.
 *
 * Path table. app/lessons/assessment-revisions/revision-paths.json maps every
 * configured lesson's committed revisions to the page that displays exactly
 * that revision: the unversioned v2 page for a single-revision lesson, each
 * rendition for a multi-revision lesson. It is derived only from committed
 * repository state (never Firestore), has deterministic ordering, and has no
 * default or "current" entry: an unknown revision has no path.
 */

"use strict";

const fidelity = require("./assessmentFidelity.cjs");
const revisions = require("./assessmentRevisions.cjs");
const render = require("./assessmentPresentationRender.cjs");
const { relocateHtml } = require("./variantLinks.cjs");

const DECLARATION_ELEMENT_ID = "lyfelabz-assessment-revision";
const DECLARATION_SCHEMA_VERSION = 1;
const DECLARATION_KEYS = Object.freeze(["assessmentRevisionId", "lessonSlug", "schemaVersion"]);
const RUNTIME_SCRIPT_TAG = '<script defer src="/assets/lyfelabz-assessment-runtime.js"></script>';
const RENDITION_DIR = "app/lessons/assessment-revisions";
const PATH_TABLE_FILE = `${RENDITION_DIR}/revision-paths.json`;
const PATH_TABLE_KIND = "lyfelabz.assessmentRevisionPaths";
const PATH_TABLE_SCHEMA_VERSION = 1;
const RENDITION_FILE_PATTERN = /^lesson_([a-z0-9]+(?:-[a-z0-9]+)*)__r([1-9][0-9]*)\.html$/;

function fail(message) {
  throw new Error(`[assessment-renditions] ${message}`);
}

function countOf(html, needle) {
  let n = 0;
  for (let i = html.indexOf(needle); i !== -1; i = html.indexOf(needle, i + needle.length)) n += 1;
  return n;
}

// -- Declaration -----------------------------------------------------------

function declarationFor(lessonSlug, assessmentRevisionId) {
  const parsed = revisions.parseRevisionId(assessmentRevisionId);
  if (parsed === null || parsed.slug !== lessonSlug) {
    fail(`cannot declare ${JSON.stringify(assessmentRevisionId)} for lesson ${JSON.stringify(lessonSlug)}`);
  }
  return { schemaVersion: DECLARATION_SCHEMA_VERSION, lessonSlug, assessmentRevisionId };
}

function declarationHtml(declaration) {
  return `<script type="application/json" id="${DECLARATION_ELEMENT_ID}">${render.scriptSafeJson(declaration)}</script>`;
}

const DECLARATION_RE = new RegExp(`<script\\b[^>]*\\bid=["']${DECLARATION_ELEMENT_ID}["'][^>]*>([\\s\\S]*?)</script>`, "g");

// The page's declaration, or null when it has none. Throws when there is
// more than one, or when the block is not exactly the closed schema.
function readDeclaration(html) {
  const matches = [...String(html).matchAll(DECLARATION_RE)];
  if (matches.length === 0) return null;
  if (matches.length > 1) fail(`page carries ${matches.length} assessment revision declarations; expected at most one`);
  if (!matches[0][0].startsWith(`<script type="application/json" id="${DECLARATION_ELEMENT_ID}">`)) {
    fail("assessment revision declaration must be an inert application/json block");
  }
  let parsed;
  try {
    parsed = JSON.parse(matches[0][1]);
  } catch {
    fail("assessment revision declaration is not valid JSON");
  }
  const keys = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed).sort() : null;
  if (!keys || keys.join("|") !== DECLARATION_KEYS.join("|") || parsed.schemaVersion !== DECLARATION_SCHEMA_VERSION) {
    fail(`assessment revision declaration must be exactly { schemaVersion: ${DECLARATION_SCHEMA_VERSION}, lessonSlug, assessmentRevisionId }`);
  }
  declarationFor(parsed.lessonSlug, parsed.assessmentRevisionId);
  return parsed;
}

// Canonical build path only. Inserts the declaration immediately before the
// page's single runtime script tag.
function insertDeclaration(html, lessonSlug, assessmentRevisionId) {
  const declaration = declarationFor(lessonSlug, assessmentRevisionId);
  if (readDeclaration(html) !== null) fail(`${lessonSlug}: page already carries an assessment revision declaration`);
  if (render.readBindingBlock(html) !== null) {
    fail(`${lessonSlug}: an assessment-presentation page declares its revision through its binding block, not a canonical declaration`);
  }
  const n = countOf(html, RUNTIME_SCRIPT_TAG);
  if (n !== 1) fail(`${lessonSlug}: expected exactly one assessment runtime script tag, found ${n}`);
  const at = html.indexOf(RUNTIME_SCRIPT_TAG);
  const out = `${html.slice(0, at)}${declarationHtml(declaration)}\n${html.slice(at)}`;
  const read = readDeclaration(out);
  if (JSON.stringify(read) !== JSON.stringify(declaration)) fail(`${lessonSlug}: declaration post-condition failed`);
  return out;
}

// -- Revision quiz ---------------------------------------------------------

// The canonical quiz literal questions for one committed payload: exactly
// q, options, correct, explanation, in authored order, verbatim (the payload
// was transcribed from a literal, so its strings are literal strings).
function questionsForPayload(slug, payload) {
  const items = payload && Array.isArray(payload.items) ? payload.items : [];
  if (items.length === 0) fail(`${slug}: payload has no items`);
  return items.map((item, i) => {
    const at = `${slug} item ${i + 1}`;
    if (item.itemType !== "singleChoice" || !Array.isArray(item.options) || item.options.length < 2) {
      fail(`${at}: only singleChoice items with at least two options can be rendered`);
    }
    const correct = item.options.findIndex((o) => o.optionId === item.correctOptionId);
    if (correct < 0) fail(`${at}: correct option is not among its options`);
    const q = {
      q: item.stem,
      options: item.options.map((o) => o.text),
      correct,
      explanation: item.explanation,
    };
    for (const text of [q.q, ...q.options, q.explanation]) {
      if (typeof text !== "string" || /<\/script|<!--/i.test(text)) {
        fail(`${at}: text cannot be embedded in an inline script`);
      }
    }
    return q;
  });
}

// Replaces the lesson's quiz literal with the literal for `entry` (a
// committed revision from assessmentRevisions.cjs) and proves the result.
function renderRevisionQuiz(html, lessonSlug, entry) {
  if (!entry || entry.slug !== lessonSlug) fail(`${lessonSlug}: revision does not belong to this lesson`);
  const literal = render.locateQuizLiteral(html);
  const questions = questionsForPayload(lessonSlug, entry.payload);
  if (literal.elements.length !== questions.length) {
    fail(`${lessonSlug}: ${entry.assessmentRevisionId} has ${questions.length} items but the lesson's quiz chrome has ${literal.elements.length}; renditions require compatible chrome (S9-D6)`);
  }
  const out = html.slice(0, literal.start) + render.literalSource(questions) + html.slice(literal.end);
  assertQuizIs(out, lessonSlug, entry, questions);
  return { html: out, questions };
}

// Post-condition: the page's re-extracted quiz is exactly the revision's
// quiz (no extra fields) and faithful to its payload.
function assertQuizIs(html, lessonSlug, entry, questions = questionsForPayload(lessonSlug, entry.payload)) {
  const raw = fidelity.extractCanonicalQuizRaw(html, lessonSlug).questions;
  if (JSON.stringify(raw) !== JSON.stringify(questions)) {
    fail(`${lessonSlug}: rendered quiz literal is not exactly ${entry.assessmentRevisionId}`);
  }
  const problems = fidelity.checkFidelity(lessonSlug, entry.payload, fidelity.extractCanonicalQuiz(html, lessonSlug));
  if (problems.length > 0) {
    fail(`${lessonSlug}: rendered quiz is not faithful to ${entry.file}:\n${problems.join("\n")}`);
  }
}

// -- Renditions ------------------------------------------------------------

function renditionRelativePath(lessonSlug, ordinal) {
  revisions.payloadFileNameFor(lessonSlug, ordinal);
  return `${RENDITION_DIR}/lesson_${lessonSlug}__r${ordinal}.html`;
}

function renditionNotice(cfg, entry) {
  return `<!--
GENERATED FILE. DO NOT EDIT DIRECTLY.
Canonical source: ${cfg.canonicalSource}
Assessment revision: ${entry.assessmentRevisionId} (platform/functions/src/scripts/assessments/${entry.file})
Build target: v2 assessment-revision rendition
Regenerate: npm --prefix app run lessons:build -- --only=${cfg.slug}
-->
`;
}

// Pure. `v2Html` is the canonical v2 build of the current source with the
// rendition notice (see index.cjs) and no declaration.
function buildRendition(v2Html, lessonSlug, entry) {
  const relocated = relocateHtml(v2Html).html;
  if (relocateHtml(relocated).rewritten.length !== 0) fail(`${lessonSlug}: relocation post-condition failed`);
  const quiz = renderRevisionQuiz(relocated, lessonSlug, entry);
  const out = insertDeclaration(quiz.html, lessonSlug, entry.assessmentRevisionId);
  assertQuizIs(out, lessonSlug, entry, quiz.questions);
  return {
    lessonSlug,
    assessmentRevisionId: entry.assessmentRevisionId,
    path: renditionRelativePath(lessonSlug, entry.revisionOrdinal),
    bytes: out,
  };
}

// -- Revision-to-path table ------------------------------------------------

function v2UrlPath(cfg) {
  const rel = String(cfg.outputs && cfg.outputs.v2);
  if (!/^app\/lessons\/lesson_[a-z0-9]+(?:-[a-z0-9]+)*\.html$/.test(rel)) {
    fail(`${cfg.slug}: unexpected v2 output ${JSON.stringify(rel)}`);
  }
  return `/${rel}`;
}

// Pure. `configs` are loaded lesson configs; `revisionsBySlug` maps slug to
// its ordered committed revisions (assessmentRevisions.discoverRevisions).
function buildRevisionPathTable(configs, revisionsBySlug) {
  const lessons = {};
  const sorted = [...configs].sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const cfg of sorted) {
    if (Object.prototype.hasOwnProperty.call(lessons, cfg.slug)) fail(`duplicate lesson config ${cfg.slug}`);
    const list = revisionsBySlug.get(cfg.slug) || [];
    // Validates the configured canonical revision even for one revision.
    revisions.resolveCanonicalRevision(cfg, list);
    const map = {};
    for (const entry of list) {
      map[entry.assessmentRevisionId] =
        list.length === 1 ? v2UrlPath(cfg) : `/${renditionRelativePath(cfg.slug, entry.revisionOrdinal)}`;
    }
    lessons[cfg.slug] = map;
  }
  return { schemaVersion: PATH_TABLE_SCHEMA_VERSION, kind: PATH_TABLE_KIND, lessons };
}

function serializePathTable(table) {
  return `${JSON.stringify(table, null, 2)}\n`;
}

// The path that displays exactly (lessonSlug, assessmentRevisionId), or null.
// There is deliberately no fallback to any other revision or page.
function resolveRevisionPath(table, lessonSlug, assessmentRevisionId) {
  if (!table || table.kind !== PATH_TABLE_KIND || table.schemaVersion !== PATH_TABLE_SCHEMA_VERSION) return null;
  const lessons = table.lessons;
  if (!lessons || !Object.prototype.hasOwnProperty.call(lessons, lessonSlug)) return null;
  const map = lessons[lessonSlug];
  if (!Object.prototype.hasOwnProperty.call(map, assessmentRevisionId)) return null;
  return map[assessmentRevisionId];
}

// Rendition paths the table names (relative to the repository root).
function renditionPathsInTable(table) {
  const out = [];
  for (const [slug, map] of Object.entries((table && table.lessons) || {})) {
    for (const [revisionId, urlPath] of Object.entries(map)) {
      const parsed = revisions.parseRevisionId(revisionId);
      if (parsed === null || parsed.slug !== slug) fail(`path table entry ${revisionId} does not belong to ${slug}`);
      if (urlPath.startsWith(`/${RENDITION_DIR}/`)) {
        const rel = urlPath.slice(1);
        if (rel !== renditionRelativePath(slug, parsed.ordinal)) fail(`path table maps ${revisionId} to ${urlPath}`);
        out.push(rel);
      }
    }
  }
  return out.sort();
}

function isRenditionFileName(name) {
  return RENDITION_FILE_PATTERN.test(name);
}

module.exports = {
  DECLARATION_ELEMENT_ID,
  DECLARATION_SCHEMA_VERSION,
  RUNTIME_SCRIPT_TAG,
  RENDITION_DIR,
  PATH_TABLE_FILE,
  PATH_TABLE_KIND,
  declarationFor,
  declarationHtml,
  readDeclaration,
  insertDeclaration,
  questionsForPayload,
  renderRevisionQuiz,
  assertQuizIs,
  renditionRelativePath,
  renditionNotice,
  buildRendition,
  buildRevisionPathTable,
  serializePathTable,
  resolveRevisionPath,
  renditionPathsInTable,
  isRenditionFileName,
};
