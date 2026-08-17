// Sprint 25 Phase 4 - Certification assessment prerequisite seed.
//
// Deploys the bounded set of cert-lesson assessments the Sprint 25 browser
// certification must be able to assign AND publish. Without these,
// assignmentsPublish refuses the draft -> published transition with
// assessments.notDeployed (the referenced assessment document does not
// exist), which is the primary B6 environment defect.
//
// This script does NOT invent a simplified assessment shape. It runs the
// certified `deployAssessmentRevision` transaction (the sole legitimate
// writer of assessments/*, assessmentRevisions/*, and assessmentAnswerKeys/*)
// against the committed canonical payloads, so the emulator ends up with the
// exact deployed-assessment state production expects. There is no bypass
// around resolveCurrentAssessmentRevisionId and no certification-only branch
// inside any callable.
//
// Emulator only. Idempotent: a re-run against already-deployed cert
// assessments is a no-op (the deployment transaction refuses a duplicate
// revision; this script treats that as "already seeded").
//
// Requires the functions build output (`npm --prefix platform/functions run
// build`) so the certified deployment pipeline is available under lib/.
//
// Usage (standalone):   node seed-cert-assessments.js
// Or imported by seed-emulator.js after the identity/org seed, reusing the
// already-initialized firebase-admin app.

const fs = require("fs");
const path = require("path");

// Idempotency: the deployment transaction throws these codes when the
// deterministic revision / answer-key documents already exist. On a reseed
// that means the cert assessment is already present - not an error.
const ALREADY_DEPLOYED_CODES = new Set([
  "assessmentDeployment.duplicateRevision",
  "assessmentDeployment.duplicateAnswerKey",
]);

function loadCertModule() {
  const modPath = path.join(__dirname, "lib", "scripts", "assessments", "cert-lessons.js");
  const deployPath = path.join(__dirname, "lib", "assessments", "assessment-deployment.js");
  if (!fs.existsSync(modPath) || !fs.existsSync(deployPath)) {
    throw new Error(
      "Build output missing. Run `npm --prefix platform/functions run build` " +
        "before seeding cert assessments (needs lib/assessments/assessment-deployment.js " +
        "and lib/scripts/assessments/cert-lessons.js).",
    );
  }
  return {
    certLessons: require(modPath),
    deployAssessmentRevision: require(deployPath).deployAssessmentRevision,
  };
}

function readPayload(payloadFile) {
  const payloadPath = path.join(
    __dirname,
    "src",
    "scripts",
    "assessments",
    payloadFile,
  );
  const raw = fs.readFileSync(payloadPath, "utf8");
  return JSON.parse(raw);
}

// Seed every cert-lesson assessment. Assumes a firebase-admin app is already
// initialized and bound to the emulator (the caller sets the emulator env and
// initializeApp). Returns a summary array for logging/verification.
async function seedCertAssessments(deps = {}) {
  const log = deps.log || ((m) => console.log(m));
  const { certLessons, deployAssessmentRevision } =
    deps.module || loadCertModule();
  const deploy = deps.deploy || deployAssessmentRevision;

  const results = [];
  log("\n[cert-seed] Deploying certification assessments (" +
    certLessons.CERT_LESSONS.length + " lesson(s)) via deployAssessmentRevision");

  for (const lesson of certLessons.CERT_LESSONS) {
    const ids = certLessons.certAssessmentIdentifiers(lesson.slug);
    const payload = readPayload(lesson.payloadFile);
    try {
      const outcome = await deploy(payload);
      log(
        "[cert-seed]   deployed " +
          outcome.assessmentId +
          " revision=" +
          outcome.revisionId +
          " ordinal=" +
          outcome.revisionOrdinal +
          " (created=" +
          outcome.assessmentCreated +
          ")",
      );
      results.push({ slug: lesson.slug, ...ids, status: "deployed" });
    } catch (err) {
      const code = err && err.code;
      if (ALREADY_DEPLOYED_CODES.has(code)) {
        log(
          "[cert-seed]   already deployed (idempotent): " +
            ids.assessmentId +
            " revision=" +
            ids.revisionId,
        );
        results.push({ slug: lesson.slug, ...ids, status: "alreadyDeployed" });
        continue;
      }
      throw err;
    }
  }

  log("[cert-seed] Done. " + results.length + " cert assessment(s) present.");
  return results;
}

module.exports = { seedCertAssessments, ALREADY_DEPLOYED_CODES };

// Standalone entry point. Binds firebase-admin to the emulator and seeds.
if (require.main === module) {
  process.env.FIREBASE_AUTH_EMULATOR_HOST =
    process.env.FIREBASE_AUTH_EMULATOR_HOST || "localhost:9099";
  process.env.FIRESTORE_EMULATOR_HOST =
    process.env.FIRESTORE_EMULATOR_HOST || "localhost:8080";

  const { initializeApp, getApps } = require("firebase-admin/app");
  if (getApps().length === 0) initializeApp({ projectId: "lyfelabz-prod" });

  console.log("[cert-seed] Firestore emulator:", process.env.FIRESTORE_EMULATOR_HOST);

  seedCertAssessments()
    .then((results) => {
      console.log(
        "\n[cert-seed] COMPLETE. Assessments: " +
          results.map((r) => r.assessmentId).join(", "),
      );
    })
    .catch((err) => {
      console.error("[cert-seed] FAILED:", err.message);
      process.exitCode = 1;
    });
}
