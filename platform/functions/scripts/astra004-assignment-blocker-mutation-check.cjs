"use strict";

const { spawnSync } = require("child_process");
const { readFileSync, writeFileSync } = require("fs");
const { resolve } = require("path");

const functionsRoot = resolve(__dirname, "..");
const sourcePath = resolve(
  functionsRoot,
  "src/scripts/staging-cert-driver.ts",
);
const original = readFileSync(sourcePath, "utf8");

function replaceExact(source, from, to, mutationName) {
  const first = source.indexOf(from);
  const last = source.lastIndexOf(from);
  if (first === -1 || first !== last) {
    throw new Error(`${mutationName}: expected exactly one source match`);
  }
  return source.slice(0, first) + to + source.slice(first + from.length);
}

const mutations = [
  {
    name: "remove effective-signer validation",
    apply(source) {
      return replaceExact(
        source,
        `  assertAstra004EffectiveSigner(\n    config.credential,\n    config.configuredServiceAccountId,\n  );\n`,
        `  // MUTATION: effective signer validation removed.\n`,
        this.name,
      );
    },
  },
  {
    name: "allow unknown signer",
    apply(source) {
      return replaceExact(
        source,
        `  if (\n    credentialType !== "RefreshTokenCredential" &&\n    credentialType !== "ComputeEngineCredential" &&\n    credentialType !== "ImpersonatedServiceAccountCredential"\n  ) {\n    refuse("credential signer identity is not inspectable", "token-configuration");\n  }\n`,
        `  if (\n    credentialType !== "RefreshTokenCredential" &&\n    credentialType !== "ComputeEngineCredential" &&\n    credentialType !== "ImpersonatedServiceAccountCredential"\n  ) {\n    return; // MUTATION: unknown credential type accepted.\n  }\n`,
        this.name,
      );
    },
  },
  {
    name: "remove staging API-key equality check",
    apply(source) {
      return replaceExact(
        source,
        `  if (suppliedWebApiKey !== approvedWebApiKey) {\n    refuse("web API key is not approved for staging", "token-configuration");\n  }\n`,
        `  if (false && suppliedWebApiKey !== approvedWebApiKey) {\n    refuse("web API key is not approved for staging", "token-configuration");\n  }\n`,
        this.name,
      );
    },
  },
  {
    name: "move API-key validation after fetch",
    apply(source) {
      let mutated = replaceExact(
        source,
        `  assertAstra004WebApiKey(config.suppliedWebApiKey, config.approvedWebApiKey);\n  const webApiKey = config.suppliedWebApiKey;\n`,
        `  const webApiKey = config.suppliedWebApiKey as string;\n`,
        this.name,
      );
      mutated = replaceExact(
        mutated,
        `  const body = await runExternalOperation(\n    "token-exchange",\n    "TOKEN_EXCHANGE_FAILED",\n    () => deps.exchangeCustomToken(customToken, webApiKey),\n  );\n`,
        `  const body = await runExternalOperation(\n    "token-exchange",\n    "TOKEN_EXCHANGE_FAILED",\n    () => deps.exchangeCustomToken(customToken, webApiKey),\n  );\n  assertAstra004WebApiKey(config.suppliedWebApiKey, config.approvedWebApiKey);\n`,
        this.name,
      );
      return mutated;
    },
  },
  {
    name: "reduce revision verification to nonempty",
    apply(source) {
      return replaceExact(
        source,
        `  assertAstra004CanonicalAssessmentRevision(published, assessment, revision);\n`,
        `  void assertAstra004CanonicalAssessmentRevision;\n  void assessment;\n  void revision;\n  if (!isNonEmptyString(published.assessmentRevisionId)) {\n    refuse("published assignment has no assessment revision", "verify-assessment-revision");\n  }\n`,
        this.name,
      );
    },
  },
  {
    name: "remove canonical revision spelling equality",
    apply(source) {
      return replaceExact(
        source,
        `  if (revisionId !== revisionIdForOrdinal(expectedAssessmentId, revisionOrdinal)) {\n    refuse("published assignment revision ID is not canonical", "verify-assessment-revision");\n  }\n`,
        `  void revisionIdForOrdinal; // MUTATION: canonical spelling equality removed.\n`,
        this.name,
      );
    },
  },
  {
    name: "skip authoritative revision read",
    apply(source) {
      return replaceExact(
        source,
        `  const [assessment, revision] = await runExternalOperation(\n    "assessment-revision-read",\n    "FIRESTORE_READ_FAILED",\n    () => Promise.all([\n      deps.getDocument(\`assessments/\${assessmentId}\`),\n      deps.getDocument(\`assessmentRevisions/\${revisionId}\`),\n    ]),\n  );\n`,
        `  const assessment = {\n    assessmentId,\n    activityId: ASTRA004_ASSIGNMENT.lessonSlug,\n    currentRevisionId: revisionId,\n  };\n  const revision = {\n    assessmentId,\n    activityId: ASTRA004_ASSIGNMENT.lessonSlug,\n    revisionOrdinal: parseRevisionOrdinalFromRevisionId(revisionId),\n  };\n`,
        this.name,
      );
    },
  },
  {
    name: "allow unrelated lesson revision",
    apply(source) {
      let mutated = replaceExact(
        source,
        `  if (\n    revisionOrdinal === undefined ||\n    parsedAssessmentId !== expectedAssessmentId\n  ) {\n`,
        `  if (revisionOrdinal === undefined || (parsedAssessmentId !== undefined && false)) {\n`,
        this.name,
      );
      mutated = replaceExact(
        mutated,
        `    assessment.currentRevisionId !== revisionId ||\n    parseAssessmentIdFromRevisionId(String(assessment.currentRevisionId)) !==\n      expectedAssessmentId ||\n    parseRevisionOrdinalFromRevisionId(String(assessment.currentRevisionId)) ===\n      undefined\n`,
        `    assessment.currentRevisionId !== revisionId\n`,
        this.name,
      );
      mutated = replaceExact(
        mutated,
        `    !revision ||\n    revision.assessmentId !== expectedAssessmentId ||\n    revision.activityId !== ASTRA004_ASSIGNMENT.lessonSlug ||\n    revision.revisionOrdinal !== revisionOrdinal\n`,
        `    !revision ||\n    revision.revisionOrdinal !== revisionOrdinal\n`,
        this.name,
      );
      mutated = replaceExact(
        mutated,
        `  if (revisionId !== revisionIdForOrdinal(expectedAssessmentId, revisionOrdinal)) {\n    refuse("published assignment revision ID is not canonical", "verify-assessment-revision");\n  }\n`,
        `  void revisionIdForOrdinal;\n`,
        this.name,
      );
      return mutated;
    },
  },
  {
    name: "allow nonexistent revision",
    apply(source) {
      return replaceExact(
        source,
        `  if (\n    !revision ||\n    revision.assessmentId !== expectedAssessmentId ||\n    revision.activityId !== ASTRA004_ASSIGNMENT.lessonSlug ||\n    revision.revisionOrdinal !== revisionOrdinal\n  ) {\n`,
        `  if (\n    revision !== null && (\n      revision.assessmentId !== expectedAssessmentId ||\n      revision.activityId !== ASTRA004_ASSIGNMENT.lessonSlug ||\n      revision.revisionOrdinal !== revisionOrdinal\n    )\n  ) {\n`,
        this.name,
      );
    },
  },
];

function runFocusedTests() {
  return spawnSync(
    process.execPath,
    [
      resolve(functionsRoot, "node_modules/jest/bin/jest.js"),
      "--runInBand",
      "--runTestsByPath",
      "src/scripts/staging-cert-driver.test.ts",
    ],
    {
      cwd: functionsRoot,
      encoding: "utf8",
      env: process.env,
    },
  );
}

function parseJestResult(run) {
  const output = `${run.stdout || ""}\n${run.stderr || ""}`;
  const failedMatch = /Tests:\s+(\d+) failed(?:,|\n)/.exec(output);
  const passedMatch = /Tests:\s+(?:(?:\d+) skipped,\s+)?(\d+) passed,\s+(\d+) total/.exec(output);
  const hasJestSummary =
    /Test Suites:\s+/.test(output) &&
    /Tests:\s+/.test(output) &&
    /Ran all test suites/.test(output);
  return {
    output,
    failedTests: failedMatch ? Number(failedMatch[1]) : 0,
    passedTests: passedMatch ? Number(passedMatch[1]) : 0,
    totalTests: passedMatch ? Number(passedMatch[2]) : 0,
    hasJestSummary,
  };
}

function isInfrastructureFailure(run, parsed) {
  return Boolean(
    run.error ||
    run.signal ||
    run.status === null ||
    !parsed.hasJestSummary ||
    (run.status !== 0 && parsed.failedTests === 0),
  );
}

const baselineRun = runFocusedTests();
const baseline = parseJestResult(baselineRun);
if (
  isInfrastructureFailure(baselineRun, baseline) ||
  baselineRun.status !== 0 ||
  baseline.failedTests !== 0 ||
  baseline.passedTests === 0 ||
  baseline.passedTests !== baseline.totalTests
) {
  process.stderr.write("baseline: INFRASTRUCTURE FAILURE; mutation checks stopped\n");
  process.exitCode = 1;
} else {
  process.stdout.write(`baseline: PASS; passedTests=${baseline.passedTests}\n`);
  const results = [];
  try {
    for (const mutation of mutations) {
      let run;
      let runnerFailed = false;
      try {
        const mutated = mutation.apply(original);
        writeFileSync(sourcePath, mutated);
        run = runFocusedTests();
      } catch {
        runnerFailed = true;
      } finally {
        writeFileSync(sourcePath, original);
        if (readFileSync(sourcePath, "utf8") !== original) {
          throw new Error("source restoration verification failed");
        }
      }

      if (runnerFailed || !run) {
        results.push({
          name: mutation.name,
          classification: "INFRASTRUCTURE FAILURE",
          failedTests: 0,
        });
        process.stdout.write(
          `${mutation.name}: INFRASTRUCTURE FAILURE; failingTests=0\n`,
        );
        break;
      }

      const parsed = parseJestResult(run);
      let classification;
      if (isInfrastructureFailure(run, parsed)) {
        classification = "INFRASTRUCTURE FAILURE";
      } else if (run.status !== 0 && parsed.failedTests > 0) {
        classification = "CAUGHT";
      } else if (run.status === 0 && parsed.failedTests === 0) {
        classification = "NOT CAUGHT";
      } else {
        classification = "INFRASTRUCTURE FAILURE";
      }
      results.push({
        name: mutation.name,
        classification,
        failedTests: parsed.failedTests,
      });
      process.stdout.write(
        `${mutation.name}: ${classification}; failingTests=${parsed.failedTests}\n`,
      );
      if (classification === "INFRASTRUCTURE FAILURE") break;
    }
  } finally {
    writeFileSync(sourcePath, original);
  }

  if (readFileSync(sourcePath, "utf8") !== original) {
    throw new Error("source restoration verification failed");
  }
  if (results.some((result) => result.classification !== "CAUGHT")) {
    process.exitCode = 1;
  }
}
