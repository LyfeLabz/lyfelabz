import {
  configureEmulatorEnv,
  ensureTargetSafe,
  main,
  parseArgs,
  type CliDeps,
} from "./deploy-assessment";

// Sprint 17 Slice 5A. The CLI is exercised through its injection seams so
// firebase-admin never enters the test process. Emulator-safe defaults and
// production refusals are asserted directly. Actual deployment success is
// re-covered by the certified `deployAssessmentRevision` unit tests
// (../assessments/assessment-deployment.test.ts), which the CLI calls
// through the injected `deploy` seam without duplicating validation.

const PILOT = JSON.stringify({
  activityId: "earths-layers",
  revisionOrdinal: 1,
  itemOrderingRule: "authoredOrder",
  schemaVersion: 1,
  publishedBy: "test",
  items: [
    {
      itemId: "q1",
      itemType: "singleChoice",
      stem: "?",
      options: [
        { optionId: "A", text: "a" },
        { optionId: "B", text: "b" },
      ],
      points: 1,
      correctOptionId: "A",
      explanation: "e",
    },
  ],
});

function makeDeps(overrides: Partial<CliDeps> = {}): CliDeps & {
  logs: string[];
  errors: string[];
  envMutations: Record<string, string>;
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const envMutations: Record<string, string> = {};
  const env: NodeJS.ProcessEnv = { ...(overrides.env ?? {}) };
  return {
    logs,
    errors,
    envMutations,
    env,
    readFile: overrides.readFile ?? (() => PILOT),
    deploy:
      overrides.deploy ??
      (() =>
        Promise.resolve({
          assessmentId: "assessment_earths-layers",
          revisionId: "assessment_earths-layers__r1",
          revisionOrdinal: 1,
          assessmentCreated: true,
        })),
    setEnv:
      overrides.setEnv ??
      ((k, v) => {
        env[k] = v;
        envMutations[k] = v;
      }),
    log: overrides.log ?? ((m) => logs.push(m)),
    logError: overrides.logError ?? ((m) => errors.push(m)),
  };
}

describe("parseArgs", () => {
  it("defaults target to emulator and requires --file", () => {
    expect(parseArgs(["--file=x.json"])).toEqual({
      ok: true,
      args: { target: "emulator", file: "x.json", iKnowProduction: false },
    });
    expect(parseArgs([]).ok).toBe(false);
  });

  it("rejects unknown or malformed arguments", () => {
    expect(parseArgs(["--target=staging", "--file=x.json"]).ok).toBe(false);
    expect(parseArgs(["--nope=1"]).ok).toBe(false);
    expect(parseArgs(["positional"]).ok).toBe(false);
    expect(parseArgs(["--i-know=maybe"]).ok).toBe(false);
  });

  it("accepts production with the explicit second flag", () => {
    expect(
      parseArgs(["--target=production", "--file=x.json", "--i-know=production"]),
    ).toEqual({
      ok: true,
      args: { target: "production", file: "x.json", iKnowProduction: true },
    });
  });
});

describe("ensureTargetSafe", () => {
  it("permits emulator without any additional flags or env", () => {
    expect(
      ensureTargetSafe(
        { target: "emulator", file: "x.json", iKnowProduction: false },
        {},
      ),
    ).toBeNull();
  });

  it("refuses production without --i-know=production", () => {
    expect(
      ensureTargetSafe(
        { target: "production", file: "x.json", iKnowProduction: false },
        { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/creds" },
      ),
    ).toMatch(/--i-know/);
  });

  it("refuses production while FIRESTORE_EMULATOR_HOST is set", () => {
    expect(
      ensureTargetSafe(
        { target: "production", file: "x.json", iKnowProduction: true },
        {
          FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
          GOOGLE_APPLICATION_CREDENTIALS: "/tmp/creds",
        },
      ),
    ).toMatch(/FIRESTORE_EMULATOR_HOST/);
  });

  it("refuses production when GOOGLE_APPLICATION_CREDENTIALS is unset", () => {
    expect(
      ensureTargetSafe(
        { target: "production", file: "x.json", iKnowProduction: true },
        {},
      ),
    ).toMatch(/GOOGLE_APPLICATION_CREDENTIALS/);
  });
});

describe("configureEmulatorEnv", () => {
  it("stamps default emulator host and project when unset", () => {
    const env: NodeJS.ProcessEnv = {};
    const applied: Record<string, string> = {};
    configureEmulatorEnv(env, (k, v) => {
      env[k] = v;
      applied[k] = v;
    });
    expect(applied.FIRESTORE_EMULATOR_HOST).toBe("127.0.0.1:8080");
    expect(applied.GCLOUD_PROJECT).toBe("lyfelabz-prod");
  });

  it("does not overwrite an existing emulator host", () => {
    const env: NodeJS.ProcessEnv = {
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:9999",
      GOOGLE_CLOUD_PROJECT: "other",
    };
    const applied: Record<string, string> = {};
    configureEmulatorEnv(env, (k, v) => {
      env[k] = v;
      applied[k] = v;
    });
    expect(applied.FIRESTORE_EMULATOR_HOST).toBeUndefined();
    expect(applied.GCLOUD_PROJECT).toBeUndefined();
  });
});

describe("main", () => {
  it("deploys in emulator mode by default and prints the outcome", async () => {
    const deps = makeDeps();
    const code = await main(["--file=pilot.json"], deps);
    expect(code).toBe(0);
    expect(deps.logs[0]).toContain("assessment_earths-layers__r1");
    expect(deps.envMutations.FIRESTORE_EMULATOR_HOST).toBe("127.0.0.1:8080");
    expect(deps.errors).toEqual([]);
  });

  it("exits with 2 on missing --file", async () => {
    const deps = makeDeps();
    const code = await main([], deps);
    expect(code).toBe(2);
    expect(deps.errors[0]).toContain("--file");
  });

  it("exits with 2 when production is requested without --i-know", async () => {
    const deps = makeDeps({
      env: { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/creds" },
    });
    const code = await main(
      ["--target=production", "--file=pilot.json"],
      deps,
    );
    expect(code).toBe(2);
    expect(deps.errors[0]).toContain("--i-know");
  });

  it("exits with 2 on malformed JSON without calling deploy", async () => {
    const deploy = jest.fn();
    const deps = makeDeps({ readFile: () => "{not json", deploy });
    const code = await main(["--file=pilot.json"], deps);
    expect(code).toBe(2);
    expect(deploy).not.toHaveBeenCalled();
  });

  it("exits with 1 on deployment failure and surfaces the error code", async () => {
    const deploy = jest.fn().mockRejectedValue(
      Object.assign(new Error("Revision \"r1\" already exists."), {
        code: "assessmentDeployment.duplicateRevision",
      }),
    );
    const deps = makeDeps({ deploy });
    const code = await main(["--file=pilot.json"], deps);
    expect(code).toBe(1);
    expect(deps.errors[0]).toContain("assessmentDeployment.duplicateRevision");
  });

  it("does not configure emulator env in production mode", async () => {
    const deps = makeDeps({
      env: {
        GOOGLE_APPLICATION_CREDENTIALS: "/tmp/creds",
      },
    });
    const code = await main(
      [
        "--target=production",
        "--file=pilot.json",
        "--i-know=production",
      ],
      deps,
    );
    expect(code).toBe(0);
    expect(deps.envMutations.FIRESTORE_EMULATOR_HOST).toBeUndefined();
  });
});
