import {
  STAGING_PROJECT_ID,
  SEED,
  assertStagingProject,
  buildSeedPlan,
  parseProjectArg,
} from "./staging-cert-seed";

// The harness is exercised through its pure exports so firebase-admin never
// enters the test process. The fail-closed project guard is the load-bearing
// safety property and is asserted exhaustively.

describe("assertStagingProject (fail-closed, production can never be reached)", () => {
  test("STAGING_PROJECT_ID is the hard literal lyfelabz-staging", () => {
    expect(STAGING_PROJECT_ID).toBe("lyfelabz-staging");
  });

  test("accepts exactly lyfelabz-staging with a clean env", () => {
    expect(assertStagingProject("lyfelabz-staging", {})).toBeNull();
  });

  test("requires an explicit project (no alias/default trusted)", () => {
    expect(assertStagingProject(undefined, {})).toContain("--project=lyfelabz-staging is required");
    expect(assertStagingProject("", {})).toContain("required");
  });

  test("refuses production explicitly", () => {
    expect(assertStagingProject("lyfelabz-prod", {})).toContain("refusing project 'lyfelabz-prod'");
  });

  test("refuses any non-staging project", () => {
    expect(assertStagingProject("some-other-project", {})).toContain("only 'lyfelabz-staging' is authorized");
  });

  test("refuses a conflicting ambient project the Admin SDK could pick up", () => {
    for (const key of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"] as const) {
      expect(assertStagingProject("lyfelabz-staging", { [key]: "lyfelabz-prod" })).toContain(`${key}='lyfelabz-prod'`);
    }
  });

  test("allows an ambient project that already equals staging", () => {
    expect(assertStagingProject("lyfelabz-staging", { GCLOUD_PROJECT: "lyfelabz-staging" })).toBeNull();
  });
});

describe("parseProjectArg", () => {
  test("extracts --project=", () => {
    expect(parseProjectArg(["--project=lyfelabz-staging", "--reset"])).toBe("lyfelabz-staging");
  });
  test("undefined when absent or empty", () => {
    expect(parseProjectArg(["--reset"])).toBeUndefined();
    expect(parseProjectArg(["--project="])).toBeUndefined();
  });
});

describe("buildSeedPlan (synthetic-only, minimal, contract-conformant)", () => {
  const plan = buildSeedPlan();

  test("every seeded email is unmistakably synthetic (.invalid TLD)", () => {
    for (const u of plan.users) {
      expect(u.email.endsWith("@staging-cert.invalid")).toBe(true);
    }
  });

  test("does NOT use the real Classroom test-user account", () => {
    for (const u of plan.users) {
      expect(u.email).not.toContain("weston.org");
      expect(u.email).not.toBe("brownc@weston.org");
    }
  });

  test("has one teacher, one differentiated student, one canonical control student", () => {
    const roles = plan.users.map((u) => u.role).sort();
    expect(roles).toEqual(["student", "student", "teacher"]);
    expect(plan.users.map((u) => u.uid)).toEqual([
      "staging-cert-teacher",
      "staging-cert-student-diff",
      "staging-cert-student-canon",
    ]);
  });

  test("assignment lessonSlug matches the published staging variant index", () => {
    expect(plan.assignment.lessonSlug).toBe("staging-cert-fixture");
    expect(SEED.variantKey).toBe("reading-adapted");
  });

  test("assessmentRevisionId follows the assessment-identifier grammar", () => {
    // "assessment_" + lessonSlug + "__r" + ordinal
    expect(plan.assignment.assessmentRevisionId).toBe("assessment_staging-cert-fixture__r1");
    expect(plan.assignment.assessmentRevisionId).toMatch(/^assessment_[a-z0-9-]+__r\d+$/);
  });

  test("both students are enrolled and are canonical recipients", () => {
    expect(plan.enrollments.map((e) => e.studentUid).sort()).toEqual([
      "staging-cert-student-canon",
      "staging-cert-student-diff",
    ]);
    expect(plan.recipients.map((r) => r.studentUid).sort()).toEqual([
      "staging-cert-student-canon",
      "staging-cert-student-diff",
    ]);
  });
});
