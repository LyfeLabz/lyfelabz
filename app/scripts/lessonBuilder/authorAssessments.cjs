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
 * Usage:
 *   node app/scripts/lessonBuilder/authorAssessments.cjs [--write] [--force]
 *   (no flag = dry run; --write writes missing payloads; --force also
 *    rewrites existing ones IF still fidelity-valid, never silently.)
 */

const fs = require("fs");
const path = require("path");
const F = require("./assessmentFidelity.cjs");

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

function main() {
  const write = process.argv.includes("--write");
  const force = process.argv.includes("--force");
  let authored = 0;
  let skippedExisting = 0;
  let failed = 0;

  for (const batch of BATCHES) {
    console.log(`\n## ${batch.name}`);
    for (const slug of batch.slugs) {
      const srcPath = path.join(SRC_DIR, `lesson_${slug}.html`);
      const outPath = path.join(PAYLOAD_DIR, `${slug}.r1.json`);
      const exists = fs.existsSync(outPath);

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

      const payload = F.buildPayload(slug, quiz, PUBLISHED_BY);
      const schemaProblems = F.assertSchemaValid(payload, slug);
      const fidelityProblems = F.checkFidelity(slug, payload, quiz);

      if (schemaProblems.length > 0 || fidelityProblems.length > 0) {
        console.log(`  ! ${slug}: STOP - validation failed, NOT written`);
        [...schemaProblems, ...fidelityProblems].forEach((p) => console.log(`      ${p}`));
        failed++;
        continue;
      }

      if (exists && !force) {
        console.log(`  = ${slug}: exists (n=${quiz.questions.length}), preserved, not overwritten`);
        skippedExisting++;
        continue;
      }

      const json = JSON.stringify(payload, null, 2) + "\n";
      if (write || force) {
        fs.writeFileSync(outPath, json, "utf8");
        console.log(`  + ${slug}: authored ${quiz.questions.length} items -> ${path.relative(ROOT, outPath)}`);
      } else {
        console.log(`  ~ ${slug}: DRY RUN - would author ${quiz.questions.length} items (schema OK, fidelity OK)`);
      }
      authored++;
    }
  }

  console.log(
    `\n## Summary: ${authored} ${write || force ? "authored" : "would author"}, ` +
      `${skippedExisting} existing preserved, ${failed} STOPPED`,
  );
  if (failed > 0) process.exitCode = 1;
}

main();
