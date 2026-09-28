/*
 * F5.3 Slice 9A - Committed assessment revisions: discovery, identity, and
 * canonical-revision resolution.
 *
 * Each committed payload
 *
 *   platform/functions/src/scripts/assessments/<slug>.r<N>.json
 *
 * is the authority for its own assessment revision
 * (DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md section 21.3,
 * PDR-031). A lesson may commit more than one revision; payloads are
 * add-only and immutable. This module is the ONE repository-side place that
 * discovers them and proves each one's identity, so no tool assumes one
 * payload per lesson, a fixed r1, or "the first matching file".
 *
 * Identity. For a committed file `<slug>.r<N>.json` (lowercase kebab-case
 * slug, canonical positive ordinal with no leading zero):
 *
 *   payload.activityId      === slug
 *   payload.revisionOrdinal === N          (an integer of 1 or more)
 *   assessmentId            =  assessment_<slug>
 *   assessmentRevisionId    =  assessment_<slug>__r<N>
 *
 * mirroring the platform grammar in
 * platform/functions/src/shared/assessment-identifiers.ts. Across the whole
 * directory, file names, revision ids, and (slug, declared ordinal) pairs are
 * unique, and a lesson's ordinals are exactly 1..N (add-only: a gap means a
 * committed revision went missing). Any other `.json` file in the directory,
 * an unreadable payload, or a disagreement fails closed.
 *
 * Canonical revision. The unversioned canonical lesson source represents one
 * committed revision, declared by the optional lesson-config field
 * `canonicalAssessmentRevisionId` (addendum 21.3: "the lesson config declares
 * which revision the unversioned canonical page renders"). When the field is
 * absent, the lesson resolves to r1 only when r1 is its single committed
 * revision (every lesson today), so no config needs editing. A lesson with
 * more than one committed revision must declare it; an undeclared, malformed,
 * foreign, or uncommitted declaration fails closed. The deployed Firestore
 * `assessments/{id}.currentRevisionId` is never consulted: the repository is
 * the build authority.
 *
 * Reads only; writes nothing.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const LESSON_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PAYLOAD_FILE_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.r([1-9][0-9]*)\.json$/;
const REVISION_ID_PATTERN = /^assessment_([a-z0-9]+(?:-[a-z0-9]+)*)__r([1-9][0-9]*)$/;
const ASSESSMENT_ID_PREFIX = "assessment_";
const CONFIG_FIELD = "canonicalAssessmentRevisionId";

function fail(message) {
  throw new Error(`[assessment-revisions] ${message}`);
}

function isPositiveOrdinal(n) {
  return typeof n === "number" && Number.isSafeInteger(n) && n >= 1;
}

function assertSlug(slug) {
  if (typeof slug !== "string" || !LESSON_SLUG_PATTERN.test(slug)) {
    fail(`malformed lesson slug ${JSON.stringify(slug)}`);
  }
}

function assertOrdinal(ordinal) {
  if (!isPositiveOrdinal(ordinal)) {
    fail(`revision ordinal must be an integer of 1 or more, got ${JSON.stringify(ordinal)}`);
  }
}

// -- Identifier grammar ----------------------------------------------------

function assessmentIdFor(slug) {
  assertSlug(slug);
  return `${ASSESSMENT_ID_PREFIX}${slug}`;
}

function revisionIdFor(slug, ordinal) {
  assertOrdinal(ordinal);
  return `${assessmentIdFor(slug)}__r${ordinal}`;
}

function payloadFileNameFor(slug, ordinal) {
  assertSlug(slug);
  assertOrdinal(ordinal);
  return `${slug}.r${ordinal}.json`;
}

// { slug, ordinal } for a strict `<slug>.r<N>.json` name, else null.
function parsePayloadFileName(fileName) {
  const m = PAYLOAD_FILE_PATTERN.exec(String(fileName));
  if (!m) return null;
  const ordinal = Number(m[2]);
  return isPositiveOrdinal(ordinal) ? { slug: m[1], ordinal } : null;
}

// { slug, ordinal } for a strict `assessment_<slug>__r<N>` id, else null.
function parseRevisionId(revisionId) {
  const m = REVISION_ID_PATTERN.exec(String(revisionId));
  if (!m) return null;
  const ordinal = Number(m[2]);
  return isPositiveOrdinal(ordinal) ? { slug: m[1], ordinal } : null;
}

// The committed file name for a revision id, or null when the id is
// malformed.
function payloadFileNameForRevisionId(revisionId) {
  const parsed = parseRevisionId(revisionId);
  return parsed === null ? null : payloadFileNameFor(parsed.slug, parsed.ordinal);
}

// -- Identity of one committed payload -------------------------------------

// Pure. Returns { entry, problems }. `entry` is null when the file name is
// not a strict payload name; otherwise it carries the identity the FILE NAME
// asserts, and `problems` lists every way the payload disagrees with it.
function describeRevision(fileName, payload) {
  const problems = [];
  const parsed = parsePayloadFileName(fileName);
  if (parsed === null) {
    problems.push(`${fileName}: not a committed assessment payload name; expected <slug>.r<N>.json (lowercase kebab-case slug, N an integer of 1 or more without a leading zero)`);
    return { entry: null, problems };
  }
  const { slug, ordinal } = parsed;
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    problems.push(`${fileName}: payload must be a JSON object`);
  } else {
    if (payload.activityId !== slug) {
      problems.push(`${fileName}: payload activityId ${JSON.stringify(payload.activityId)} does not match the file's lesson "${slug}"`);
    }
    if (!isPositiveOrdinal(payload.revisionOrdinal)) {
      problems.push(`${fileName}: payload revisionOrdinal ${JSON.stringify(payload.revisionOrdinal)} must be an integer of 1 or more`);
    } else if (payload.revisionOrdinal !== ordinal) {
      problems.push(`${fileName}: payload revisionOrdinal ${payload.revisionOrdinal} (${ASSESSMENT_ID_PREFIX}${slug}__r${payload.revisionOrdinal}) does not match the file's revision r${ordinal}`);
    }
  }
  return {
    entry: {
      file: fileName,
      slug,
      revisionOrdinal: ordinal,
      assessmentId: assessmentIdFor(slug),
      assessmentRevisionId: revisionIdFor(slug, ordinal),
      payload,
    },
    problems,
  };
}

function compareEntries(a, b) {
  if (a.slug !== b.slug) return a.slug < b.slug ? -1 : 1;
  if (a.revisionOrdinal !== b.revisionOrdinal) return a.revisionOrdinal - b.revisionOrdinal;
  return a.file < b.file ? -1 : a.file > b.file ? 1 : 0;
}

// Pure. Cross-revision rules over a set of described entries: unique file
// names, unique revision ids, unique declared (activityId, revisionOrdinal)
// pairs, and contiguous ordinals 1..N per lesson.
function validateRevisionSet(entries) {
  const problems = [];
  const seen = (label) => {
    const set = new Map();
    return (key, file) => {
      if (set.has(key)) problems.push(`duplicate ${label} ${key} (${set.get(key)} and ${file})`);
      else set.set(key, file);
    };
  };
  const byFile = seen("payload file");
  const byRevision = seen("assessment revision id");
  const byDeclared = seen("declared revision ordinal");
  const ordinalsBySlug = new Map();
  for (const e of entries) {
    byFile(e.file, e.file);
    byRevision(e.assessmentRevisionId, e.file);
    const p = e.payload;
    if (p && typeof p === "object" && typeof p.activityId === "string" && isPositiveOrdinal(p.revisionOrdinal)) {
      byDeclared(`${p.activityId} r${p.revisionOrdinal}`, e.file);
    }
    if (!ordinalsBySlug.has(e.slug)) ordinalsBySlug.set(e.slug, new Set());
    ordinalsBySlug.get(e.slug).add(e.revisionOrdinal);
  }
  for (const [slug, set] of [...ordinalsBySlug].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const max = Math.max(...set);
    const missing = [];
    for (let n = 1; n <= max; n += 1) if (!set.has(n)) missing.push(`r${n}`);
    if (missing.length > 0) {
      problems.push(`lesson "${slug}" commits r${max} but is missing ${missing.join(", ")}; committed revisions are add-only and contiguous from r1`);
    }
  }
  return problems;
}

// -- Directory discovery ---------------------------------------------------

function defaultRepoRoot() {
  return path.resolve(__dirname, "..", "..", "..");
}

function payloadDirectory(repoRoot = defaultRepoRoot()) {
  return path.join(repoRoot, "platform", "functions", "src", "scripts", "assessments");
}

// Discovers every committed revision. Every `.json` file in the directory is
// a claimed payload (the directory also holds TypeScript helpers, which are
// ignored). Returns { revisions, bySlug, failures }: `revisions` sorted by
// slug then numeric ordinal (discovery order never matters), `bySlug` a Map
// of slug -> ordered entries. `io` is injectable for tests.
function discoverRevisions({ repoRoot = defaultRepoRoot(), io = null } = {}) {
  const dir = payloadDirectory(repoRoot);
  const listFiles = io ? io.listFiles : () => fs.readdirSync(dir);
  const readFile = io ? io.readFile : (name) => fs.readFileSync(path.join(dir, name), "utf8");
  const failures = [];
  const entries = [];
  const names = [...listFiles()].filter((name) => name.endsWith(".json")).sort();
  for (const name of names) {
    let payload;
    try {
      payload = JSON.parse(readFile(name));
    } catch (err) {
      failures.push(`${name}: not readable as JSON (${err.message})`);
      continue;
    }
    const { entry, problems } = describeRevision(name, payload);
    failures.push(...problems);
    if (entry !== null) entries.push(entry);
  }
  failures.push(...validateRevisionSet(entries));
  entries.sort(compareEntries);
  const bySlug = new Map();
  for (const e of entries) {
    if (!bySlug.has(e.slug)) bySlug.set(e.slug, []);
    bySlug.get(e.slug).push(e);
  }
  return { revisions: entries, bySlug, failures };
}

// Fail-closed wrapper: any identity problem anywhere in the directory stops.
function loadRevisions(options = {}) {
  const result = discoverRevisions(options);
  if (result.failures.length > 0) {
    fail(`committed assessment revisions are inconsistent:\n  - ${result.failures.join("\n  - ")}`);
  }
  return result;
}

// Ordered committed revisions of one lesson (possibly empty).
function revisionsForLesson(slug, options = {}) {
  assertSlug(slug);
  return loadRevisions(options).bySlug.get(slug) || [];
}

// One committed revision by id, or null when it is not committed.
function findRevision(assessmentRevisionId, options = {}) {
  const parsed = parseRevisionId(assessmentRevisionId);
  if (parsed === null) return null;
  return revisionsForLesson(parsed.slug, options).find((e) => e.revisionOrdinal === parsed.ordinal) || null;
}

// -- Canonical revision ----------------------------------------------------

// Shape check for the optional config field (no filesystem access).
function validateConfigDeclaration(cfg, slug) {
  const declared = cfg ? cfg[CONFIG_FIELD] : undefined;
  if (declared === undefined) return;
  const parsed = parseRevisionId(declared);
  if (parsed === null) {
    fail(`${slug}: ${CONFIG_FIELD} must be assessment_<slug>__r<N> with N an integer of 1 or more, got ${JSON.stringify(declared)}`);
  }
  if (parsed.slug !== slug) {
    fail(`${slug}: ${CONFIG_FIELD} ${declared} belongs to lesson "${parsed.slug}"`);
  }
}

// The committed revision the unversioned canonical lesson represents.
// `revisions` are the lesson's committed entries (revisionsForLesson).
function resolveCanonicalRevision(cfg, revisions) {
  if (!cfg || typeof cfg.slug !== "string") fail("resolveCanonicalRevision needs a lesson config with a slug");
  const slug = cfg.slug;
  assertSlug(slug);
  validateConfigDeclaration(cfg, slug);
  const list = Array.isArray(revisions) ? revisions : [];
  for (const e of list) {
    if (e.slug !== slug) fail(`${slug}: revision ${e.assessmentRevisionId} does not belong to this lesson`);
  }
  if (list.length === 0) fail(`${slug}: no committed assessment revision (${slug}.r1.json)`);
  const declared = cfg[CONFIG_FIELD];
  if (declared === undefined) {
    if (list.length === 1 && list[0].revisionOrdinal === 1) return list[0];
    fail(`${slug}: ${list.length} committed assessment revisions (${list.map((e) => `r${e.revisionOrdinal}`).join(", ")}); the lesson config must declare ${CONFIG_FIELD} to name the revision the canonical lesson represents`);
  }
  const match = list.filter((e) => e.assessmentRevisionId === declared);
  if (match.length !== 1) {
    fail(`${slug}: ${CONFIG_FIELD} ${declared} is not a committed revision (committed: ${list.map((e) => e.assessmentRevisionId).join(", ")})`);
  }
  return match[0];
}

module.exports = {
  CONFIG_FIELD,
  LESSON_SLUG_PATTERN,
  PAYLOAD_FILE_PATTERN,
  REVISION_ID_PATTERN,
  assessmentIdFor,
  revisionIdFor,
  payloadFileNameFor,
  parsePayloadFileName,
  parseRevisionId,
  payloadFileNameForRevisionId,
  describeRevision,
  validateRevisionSet,
  payloadDirectory,
  discoverRevisions,
  loadRevisions,
  revisionsForLesson,
  findRevision,
  validateConfigDeclaration,
  resolveCanonicalRevision,
};
