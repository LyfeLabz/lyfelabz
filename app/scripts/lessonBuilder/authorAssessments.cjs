/*
 * Sprint 28 Phase 5B - Assessment answer-key authoring CLI.
 *
 * Authors the missing `<slug>.r1.json` assessment revision payloads for the
 * 49 assignable lessons by deterministically extracting each lesson's quiz
 * from its canonical source (`lesson-sources/lesson_<slug>.html`) and
 * transforming it into the production payload shape. It NEVER overwrites an
 * existing payload, NEVER guesses, and refuses to write any payload that
 * fails schema validation or fidelity re-check against the canonical source.
 *
 * This is repository-only authoring tooling. It deploys nothing and mutates
 * no external state. Deployment is Sprint 29.
 *
 * F5.3 Slice 9A: committed revisions are immutable and add-only
 * (addendum section 21.3). The tool never rewrites a committed revision (the
 * former --force rewrite is refused), never assumes r1 for a lesson that
 * already has a committed revision, and authors a later revision only when
 * the operator names both the lesson and the exact next ordinal. After a new
 * revision is written, the lesson config must declare it as
 * `canonicalAssessmentRevisionId` (the fidelity suite fails closed until it
 * does); this tool never edits configs.
 *
 * Usage:
 *   node app/scripts/lessonBuilder/authorAssessments.cjs [--write]
 *     (no flag = dry run; --write writes the missing r1 payloads of the
 *      Sprint 28 batches below; existing revisions are always preserved.)
 *   node app/scripts/lessonBuilder/authorAssessments.cjs --lesson=<slug> --revision=<N> --published-by=<label> [--write]
 *     (authors <slug>.r<N>.json from the canonical source; N must be exactly
 *      one more than the lesson's highest committed revision, and the
 *      provenance label is explicit.)
 */

const fs = require("fs");
const path = require("path");
const F = require("./assessmentFidelity.cjs");
const R = require("./assessmentRevisions.cjs");
const Q = require("./assessmentQuality.cjs");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SRC_DIR = path.join(ROOT, "lesson-sources");
const PAYLOAD_DIR = path.join(
  ROOT,
  "platform",
  "functions",
  "src",
  "scripts",
  "assessments",
);
const PUBLISHED_BY = "sprint-28-phase-5b";

// The 45 lessons that need an authored answer key, grouped for review.
// (The 4 lessons with existing fidelity-valid payloads - earths-layers,
// what-is-life, cell-types, biological-evolution - are intentionally absent
// and are never rewritten by this tool.)
const BATCHES = [
  {
    name: "Batch 0 - Category A already-v2, keys pending",
    slugs: ["plate-tectonics", "water-cycle", "earthquakes"],
  },
  {
    name: "Batch 1 - Grade 6 Life Science",
    slugs: ["organelles", "body-systems"],
  },
  {
    name: "Batch 2 - Grade 6 Earth & Space",
    slugs: [
      "layers-of-time",
      "continental-drift",
      "gravity",
      "sun-earth-moon",
      "phases-of-the-moon",
      "eclipses",
      "earths-place-in-the-universe",
    ],
  },
  {
    name: "Batch 3 - Grade 6 Physical Science",
    slugs: [
      "measuring-matter",
      "physical-properties",
      "pure-substances-and-mixtures",
      "chemical-reactions",
      "nature-of-waves",
      "wave-behavior",
      "digital-signals",
    ],
  },
  {
    name: "Batch 4 - Grade 6 Tech & Engineering",
    slugs: [
      "conducting-experiments",
      "engineering-design",
      "choosing-materials",
      "designing-to-scale",
    ],
  },
  {
    name: "Batch 5 - Grade 7 Earth & Space",
    slugs: [
      "types-of-volcanoes",
      "hotspot-volcanoes",
      "weathering-and-erosion",
      "renewable-and-nonrenewable-resources",
    ],
  },
  {
    name: "Batch 6 - Grade 7 Life Science",
    slugs: [
      "parts-of-an-ecosystem",
      "photosynthesis",
      "energy-flow",
      "carbon-cycle",
      "ecosystem-stability",
      "reproductive-success",
      "human-impacts",
    ],
  },
  {
    name: "Batch 7 - Grade 7 Physical Science",
    slugs: [
      "forms-of-energy",
      "energy-transfer",
      "heat-transfer",
      "introduction-to-electricity",
    ],
  },
  {
    name: "Batch 8 - Grade 7 Tech & Engineering",
    slugs: [
      "design-tradeoffs",
      "structural-systems",
      "transportation-systems",
      "communication-systems",
      "engineering-systems",
      "technology-and-society",
      "innovation-and-sustainability",
    ],
  },
];

function parseArgs(argv) {
  const out = { write: false, lesson: null, revision: null, publishedBy: null, errors: [] };
  for (const arg of argv) {
    if (arg === "--write") out.write = true;
    else if (arg === "--force") out.errors.push("--force is refused: committed assessment revisions are immutable and are never rewritten");
    else if (arg.startsWith("--lesson=")) out.lesson = arg.slice("--lesson=".length);
    else if (arg.startsWith("--revision=")) out.revision = arg.slice("--revision=".length);
    else if (arg.startsWith("--published-by=")) out.publishedBy = arg.slice("--published-by=".length);
    else out.errors.push(`unknown argument ${JSON.stringify(arg)}`);
  }
  if ((out.lesson === null) !== (out.revision === null)) {
    out.errors.push("--lesson and --revision must be given together");
  }
  if (out.lesson !== null && (out.publishedBy === null || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(out.publishedBy))) {
    out.errors.push("--published-by=<kebab-case label> is required with --lesson and --revision");
  }
  if (out.lesson === null && out.publishedBy !== null) {
    out.errors.push("--published-by applies only with --lesson and --revision");
  }
  if (out.revision !== null) {
    if (!/^[1-9][0-9]*$/.test(out.revision)) out.errors.push(`--revision must be a positive integer, got ${JSON.stringify(out.revision)}`);
    else out.revision = Number(out.revision);
  }
  if (out.lesson !== null && !R.LESSON_SLUG_PATTERN.test(out.lesson)) {
    out.errors.push(`--lesson must be a lowercase kebab-case slug, got ${JSON.stringify(out.lesson)}`);
  }
  return out;
}

// Decides the one revision a run may author for a lesson, or why it may not.
// Pure: `committed` is the lesson's committed revisions, `requested` the
// explicit --revision (or null in batch mode).
function planTarget(slug, committed, requested) {
  const highest = committed.length === 0 ? 0 : committed[committed.length - 1].revisionOrdinal;
  if (requested === null) {
    if (highest === 0) return { ordinal: 1 };
    return { preserved: `${committed.map((e) => e.file).join(", ")} committed; preserved, never rewritten` };
  }
  if (committed.some((e) => e.revisionOrdinal === requested)) {
    return { refused: `${R.payloadFileNameFor(slug, requested)} is already committed; committed revisions are immutable` };
  }
  if (requested !== highest + 1) {
    return { refused: `r${requested} is not the next revision; the highest committed revision is r${highest}, so only r${highest + 1} may be authored` };
  }
  return { ordinal: requested };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.errors.length > 0) {
    for (const e of args.errors) console.log(`  ! ${e}`);
    process.exitCode = 1;
    return;
  }
  const write = args.write;
  const batches = args.lesson === null ? BATCHES : [{ name: `Explicit revision ${args.lesson} r${args.revision}`, slugs: [args.lesson] }];
  const committed = R.loadRevisions().bySlug;
  let authored = 0;
  let skippedExisting = 0;
  let failed = 0;

  for (const batch of batches) {
    console.log(`\n## ${batch.name}`);
    for (const slug of batch.slugs) {
      const target = planTarget(slug, committed.get(slug) || [], args.revision);
      if (target.preserved) {
        console.log(`  = ${slug}: ${target.preserved}`);
        skippedExisting++;
        continue;
      }
      if (target.refused) {
        console.log(`  ! ${slug}: STOP - ${target.refused}`);
        failed++;
        continue;
      }
      const srcPath = path.join(SRC_DIR, `lesson_${slug}.html`);
      const outPath = path.join(PAYLOAD_DIR, R.payloadFileNameFor(slug, target.ordinal));

      let html;
      try {
        html = fs.readFileSync(srcPath, "utf8");
      } catch (err) {
        console.log(`  ! ${slug}: STOP - cannot read canonical source (${err.message})`);
        failed++;
        continue;
      }

      let quiz;
      try {
        quiz = F.extractCanonicalQuiz(html, slug);
      } catch (err) {
        console.log(`  ! ${slug}: STOP - ${err.message}`);
        failed++;
        continue;
      }

      const payload = F.buildPayload(slug, quiz, args.publishedBy || PUBLISHED_BY, target.ordinal);
      const schemaProblems = F.assertSchemaValid(payload, slug);
      const fidelityProblems = F.checkFidelity(slug, payload, quiz);
      const revisionProblems = R.describeRevision(path.basename(outPath), payload).problems;
      // A later revision must carry changed quiz content and must meet the
      // answer-position standard on its own: r2 or later can never be debt.
      if (target.ordinal > 1) {
        for (const e of committed.get(slug) || []) {
          if (F.checkFidelity(slug, e.payload, quiz).length === 0) {
            revisionProblems.push(`[${slug}] the canonical quiz is still faithful to committed ${e.file}; a new revision needs changed quiz content`);
          }
        }
        const quality = Q.evaluatePayload(payload);
        for (const f of quality.hard) revisionProblems.push(`[${slug}] answer-position ${f.code}: ${f.detail}`);
        for (const f of quality.warnings) console.log(`    warning: answer-position ${f.code}: ${f.detail}`);
      }

      if (schemaProblems.length > 0 || fidelityProblems.length > 0 || revisionProblems.length > 0) {
        console.log(`  ! ${slug}: STOP - validation failed, NOT written`);
        [...schemaProblems, ...fidelityProblems, ...revisionProblems].forEach((p) => console.log(`      ${p}`));
        failed++;
        continue;
      }

      // Re-check immediately before writing: never replace a file.
      if (fs.existsSync(outPath)) {
        console.log(`  ! ${slug}: STOP - ${path.basename(outPath)} appeared on disk; not overwritten`);
        failed++;
        continue;
      }

      const json = JSON.stringify(payload, null, 2) + "\n";
      if (write) {
        fs.writeFileSync(outPath, json, { encoding: "utf8", flag: "wx" });
        console.log(`  + ${slug}: authored ${quiz.questions.length} items -> ${path.relative(ROOT, outPath)}`);
        if (target.ordinal > 1) {
          console.log(`    next: declare canonicalAssessmentRevisionId: "${R.revisionIdFor(slug, target.ordinal)}" in the lesson config`);
        }
      } else {
        console.log(`  ~ ${slug}: DRY RUN - would author r${target.ordinal} with ${quiz.questions.length} items (schema OK, fidelity OK)`);
      }
      authored++;
    }
  }

  console.log(
    `\n## Summary: ${authored} ${write ? "authored" : "would author"}, ` +
      `${skippedExisting} existing preserved, ${failed} STOPPED`,
  );
  if (failed > 0) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { parseArgs, planTarget };
