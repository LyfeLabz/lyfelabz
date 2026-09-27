import {
  configureEmulatorEnv,
  ensureTargetSafe,
  main,
  parseArgs,
  type CliArgs,
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
    bindAdminProject: overrides.bindAdminProject ?? jest.fn(),
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
      args: { target: "emulator", file: "x.json", iKnowProduction: false, project: null, apply: false },
    });
    expect(parseArgs([]).ok).toBe(false);
  });

  it("rejects unknown or malformed arguments", () => {
    expect(parseArgs(["--target=staging", "--file=x.json"]).ok).toBe(false);
    expect(parseArgs(["--nope=1"]).ok).toBe(false);
    expect(parseArgs(["positional"]).ok).toBe(false);
    expect(parseArgs(["--i-know=maybe"]).ok).toBe(false);
  });

  it("accepts production with the explicit second flag, project, and apply", () => {
    expect(
      parseArgs(["--target=production", "--file=x.json", "--i-know=production"]),
    ).toEqual({
      ok: true,
      args: { target: "production", file: "x.json", iKnowProduction: true, project: null, apply: false },
    });
    expect(
      parseArgs([
        "--target=production",
        "--file=x.json",
        "--i-know=production",
        "--project=lyfelabz-prod",
        "--apply",
      ]),
    ).toEqual({
      ok: true,
      args: {
        target: "production",
        file: "x.json",
        iKnowProduction: true,
        project: "lyfelabz-prod",
        apply: true,
      },
    });
  });

  it.each([
    ["duplicate project", ["--target=production", "--file=x.json", "--project=lyfelabz-prod", "--project=lyfelabz-prod"]],
    ["empty project", ["--target=production", "--file=x.json", "--project="]],
    ["bare project flag", ["--target=production", "--file=x.json", "--project"]],
    ["duplicate apply", ["--target=production", "--file=x.json", "--apply", "--apply"]],
    ["apply with a value", ["--target=production", "--file=x.json", "--apply=true"]],
    ["project with the emulator target", ["--file=x.json", "--project=lyfelabz-prod"]],
  ])("rejects %s", (_label, argv) => {
    expect(parseArgs(argv).ok).toBe(false);
  });
});

describe("ensureTargetSafe", () => {
  it("permits emulator without any additional flags or env", () => {
    expect(
      ensureTargetSafe(
        { target: "emulator", file: "x.json", iKnowProduction: false, project: null, apply: false },
        {},
      ),
    ).toBeNull();
  });

  it("refuses production without --i-know=production", () => {
    expect(
      ensureTargetSafe(
        { target: "production", file: "x.json", iKnowProduction: false, project: "lyfelabz-prod", apply: false },
        { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/creds" },
      ),
    ).toMatch(/--i-know/);
  });

  it("refuses production while FIRESTORE_EMULATOR_HOST is set", () => {
    expect(
      ensureTargetSafe(
        { target: "production", file: "x.json", iKnowProduction: true, project: "lyfelabz-prod", apply: false },
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
        { target: "production", file: "x.json", iKnowProduction: true, project: "lyfelabz-prod", apply: false },
        {},
      ),
    ).toMatch(/GOOGLE_APPLICATION_CREDENTIALS/);
  });
});

describe("ensureTargetSafe production project binding", () => {
  const PROD_ARGS: CliArgs = {
    target: "production",
    file: "x.json",
    iKnowProduction: true,
    project: "lyfelabz-prod",
    apply: true,
  };
  const CREDS = { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/creds" };

  it("accepts the explicit production project with matching or absent ambient projects", () => {
    expect(ensureTargetSafe(PROD_ARGS, CREDS)).toBeNull();
    expect(
      ensureTargetSafe(PROD_ARGS, {
        ...CREDS,
        GCLOUD_PROJECT: "lyfelabz-prod",
        GOOGLE_CLOUD_PROJECT: "lyfelabz-prod",
        CLOUDSDK_CORE_PROJECT: "lyfelabz-prod",
      }),
    ).toBeNull();
  });

  it("requires an explicit --project for production", () => {
    expect(ensureTargetSafe({ ...PROD_ARGS, project: null }, CREDS)).toMatch(
      /--project=lyfelabz-prod/,
    );
  });

  it.each(["lyfelabz-staging", "production", "default", "LYFELABZ-PROD", "lyfelabz-prod "])(
    "refuses any project other than the literal production id: %j",
    (project) => {
      expect(ensureTargetSafe({ ...PROD_ARGS, project }, CREDS)).toMatch(/only 'lyfelabz-prod'/);
    },
  );

  it.each(["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "CLOUDSDK_CORE_PROJECT"])(
    "refuses a conflicting ambient %s",
    (key) => {
      expect(
        ensureTargetSafe(PROD_ARGS, { ...CREDS, [key]: "lyfelabz-staging" }),
      ).toContain(key);
    },
  );

  it("refuses FIREBASE_CONFIG, which can supply another project to the Admin SDK", () => {
    expect(
      ensureTargetSafe(PROD_ARGS, {
        ...CREDS,
        FIREBASE_CONFIG: JSON.stringify({ projectId: "lyfelabz-staging" }),
      }),
    ).toMatch(/FIREBASE_CONFIG/);
  });

  it("applies the same gate to a production dry-run", () => {
    expect(
      ensureTargetSafe({ ...PROD_ARGS, apply: false }, { ...CREDS, GCLOUD_PROJECT: "other" }),
    ).toMatch(/GCLOUD_PROJECT/);
    expect(ensureTargetSafe({ ...PROD_ARGS, apply: false, iKnowProduction: false }, CREDS)).toMatch(
      /--i-know/,
    );
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
        "--project=lyfelabz-prod",
        "--apply",
      ],
      deps,
    );
    expect(code).toBe(0);
    expect(deps.envMutations.FIRESTORE_EMULATOR_HOST).toBeUndefined();
  });

  it("never binds the Admin SDK in emulator mode", async () => {
    const bindAdminProject = jest.fn();
    const deps = makeDeps({ bindAdminProject });
    expect(await main(["--file=pilot.json"], deps)).toBe(0);
    expect(bindAdminProject).not.toHaveBeenCalled();
  });
});

describe("main production binding and dry-run", () => {
  const PROD = ["--target=production", "--file=pilot.json", "--i-know=production", "--project=lyfelabz-prod"];
  const CREDS = { GOOGLE_APPLICATION_CREDENTIALS: "/tmp/creds" };

  it("defaults to a local zero-write dry-run: no bind, no deploy, no env mutation", async () => {
    const deploy = jest.fn();
    const bindAdminProject = jest.fn();
    const deps = makeDeps({ env: CREDS, deploy, bindAdminProject });
    expect(await main(PROD, deps)).toBe(0);
    expect(deploy).not.toHaveBeenCalled();
    expect(bindAdminProject).not.toHaveBeenCalled();
    expect(deps.envMutations).toEqual({});
    expect(deps.logs[0]).toContain("dry-run ok");
    expect(deps.logs[0]).toContain("revision=assessment_earths-layers__r1");
    expect(deps.logs[0]).toContain("writes=0");
    expect(deps.logs[0]).toContain("project=lyfelabz-prod");
  });

  it("dry-run refuses an invalid payload with the certified validator's code", async () => {
    const deploy = jest.fn();
    const invalid = JSON.stringify({ ...JSON.parse(PILOT), revisionOrdinal: 0 });
    const deps = makeDeps({ env: CREDS, deploy, readFile: () => invalid });
    expect(await main(PROD, deps)).toBe(2);
    expect(deps.errors[0]).toContain("payload validation failed");
    expect(deploy).not.toHaveBeenCalled();
  });

  it("--apply binds the default Admin SDK app to lyfelabz-prod before deploying", async () => {
    const order: string[] = [];
    const bindAdminProject = jest.fn((projectId: string) => {
      order.push(`bind:${projectId}`);
    });
    const deploy = jest.fn(() => {
      order.push("deploy");
      return Promise.resolve({
        assessmentId: "assessment_earths-layers",
        revisionId: "assessment_earths-layers__r1",
        revisionOrdinal: 1,
        assessmentCreated: true,
      });
    });
    const deps = makeDeps({ env: CREDS, deploy, bindAdminProject });
    expect(await main([...PROD, "--apply"], deps)).toBe(0);
    expect(order).toEqual(["bind:lyfelabz-prod", "deploy"]);
    expect(deps.envMutations).toEqual({
      GCLOUD_PROJECT: "lyfelabz-prod",
      GOOGLE_CLOUD_PROJECT: "lyfelabz-prod",
    });
  });

  it("--apply refuses to deploy when the Admin SDK cannot be bound to lyfelabz-prod", async () => {
    const deploy = jest.fn();
    const bindAdminProject = jest.fn(() => {
      throw new Error("default Admin SDK app is already bound to 'lyfelabz-staging', not 'lyfelabz-prod'");
    });
    const deps = makeDeps({ env: CREDS, deploy, bindAdminProject });
    expect(await main([...PROD, "--apply"], deps)).toBe(2);
    expect(deps.errors[0]).toContain("could not bind the Admin SDK");
    expect(deploy).not.toHaveBeenCalled();
  });

  it.each([
    ["no --project", ["--target=production", "--file=pilot.json", "--i-know=production", "--apply"], CREDS],
    ["staging --project", ["--target=production", "--file=pilot.json", "--i-know=production", "--project=lyfelabz-staging", "--apply"], CREDS],
    ["conflicting GOOGLE_CLOUD_PROJECT", [...PROD, "--apply"], { ...CREDS, GOOGLE_CLOUD_PROJECT: "lyfelabz-staging" }],
    ["conflicting CLOUDSDK_CORE_PROJECT", [...PROD, "--apply"], { ...CREDS, CLOUDSDK_CORE_PROJECT: "lyfelabz-staging" }],
    ["FIREBASE_CONFIG", [...PROD, "--apply"], { ...CREDS, FIREBASE_CONFIG: "{}" }],
    ["emulator host", [...PROD, "--apply"], { ...CREDS, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }],
    ["no credentials", [...PROD, "--apply"], {}],
    ["no acknowledgement", ["--target=production", "--file=pilot.json", "--project=lyfelabz-prod", "--apply"], CREDS],
  ])("refuses %s before reading, binding, or deploying", async (_label, argv, env) => {
    const readFile = jest.fn(() => PILOT);
    const deploy = jest.fn();
    const bindAdminProject = jest.fn();
    const deps = makeDeps({ env, readFile, deploy, bindAdminProject });
    expect(await main(argv, deps)).toBe(2);
    expect(readFile).not.toHaveBeenCalled();
    expect(bindAdminProject).not.toHaveBeenCalled();
    expect(deploy).not.toHaveBeenCalled();
    expect(deps.envMutations).toEqual({});
  });
});
