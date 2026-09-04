import {
  configureEmulatorEnv,
  configureStagingEnv,
  ensureStagingTargetSafe,
  ensureTargetSafe,
  main,
  makeStagingDeployHosting,
  parseArgs,
  STAGING_PROJECT_ID,
  type CliArgs,
  type CliDeps,
} from "./publish-variant";
import type { PublishInput, PublishResult, RetireInput, RetireResult } from "../variants/variant-publication";

// F5.2 Slice 3. The CLI is exercised through its injection seams so
// firebase-admin never enters the test process. Arg parsing, emulator-safe
// defaults, production refusals, op routing, and result->exit-code mapping are
// asserted directly. The publication ordering / index-last guarantees are
// covered by the certified state machine tests (../variants/variant-
// publication.test.ts), which the CLI calls through the injected seams without
// duplicating that logic.

const REV = `pr${"a".repeat(64)}`;

function okPublish(input: PublishInput): PublishResult {
  return {
    ok: true,
    mode: input.mode,
    revision: {
      lessonSlug: input.lessonSlug,
      variantKey: input.variantKey,
      presentationRevisionId: input.presentationRevisionId,
      path: `app/lessons/variants/lesson_${input.lessonSlug}__${input.presentationRevisionId}.html`,
      sha256: "a".repeat(64),
    },
    stagesCompleted: ["LOCAL_VERIFIED", "HOSTING_DEPLOYED", "HOSTED_BYTES_VERIFIED", "INDEX_UPDATED"],
    indexAdvanced: true,
  };
}

function makeDeps(overrides: Partial<CliDeps> = {}): CliDeps & {
  logs: string[];
  errors: string[];
  publishCalls: PublishInput[];
  retireCalls: RetireInput[];
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const publishCalls: PublishInput[] = [];
  const retireCalls: RetireInput[] = [];
  const env: NodeJS.ProcessEnv = { ...(overrides.env ?? {}) };
  return {
    logs,
    errors,
    publishCalls,
    retireCalls,
    env,
    setEnv: (key, value) => {
      env[key] = value;
    },
    log: (m) => logs.push(m),
    logError: (m) => errors.push(m),
    publish:
      overrides.publish ??
      ((input: PublishInput) => {
        publishCalls.push(input);
        return Promise.resolve(okPublish(input));
      }),
    retire:
      overrides.retire ??
      ((input: RetireInput) => {
        retireCalls.push(input);
        return Promise.resolve<RetireResult>({ ok: true, retired: true, note: "retired" });
      }),
  };
}

describe("parseArgs", () => {
  test("requires --lesson and --variant", () => {
    expect(parseArgs(["--variant=reading-adapted", "--revision=" + REV, "--published-by=op"])).toEqual({
      ok: false,
      message: "--lesson is required",
    });
    expect(parseArgs(["--lesson=earths-layers", "--revision=" + REV, "--published-by=op"])).toEqual({
      ok: false,
      message: "--variant is required",
    });
  });

  test("publish/rollback require --revision", () => {
    const r = parseArgs(["--lesson=earths-layers", "--variant=reading-adapted", "--published-by=op"]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("--revision is required for --op=publish");
  });

  test("retire does not require --revision", () => {
    const r = parseArgs([
      "--op=retire",
      "--lesson=earths-layers",
      "--variant=reading-adapted",
      "--published-by=op",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args.op).toBe("retire");
  });

  test("requires attribution via --published-by or LYFELABZ_PUBLISH_OPERATOR", () => {
    const missing = parseArgs(["--lesson=earths-layers", "--variant=reading-adapted", "--revision=" + REV]);
    expect(missing.ok).toBe(false);
    const fromEnv = parseArgs(
      ["--lesson=earths-layers", "--variant=reading-adapted", "--revision=" + REV],
      { LYFELABZ_PUBLISH_OPERATOR: "ci-operator" },
    );
    expect(fromEnv.ok).toBe(true);
    if (fromEnv.ok) expect(fromEnv.args.publishedBy).toBe("ci-operator");
  });

  test("defaults target to emulator and op to publish", () => {
    const r = parseArgs([
      "--lesson=earths-layers",
      "--variant=reading-adapted",
      "--revision=" + REV,
      "--published-by=op",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.args.target).toBe("emulator");
      expect(r.args.op).toBe("publish");
    }
  });

  test("rejects unknown args and bad enum values", () => {
    expect(parseArgs(["--nope=1"]).ok).toBe(false);
    expect(parseArgs(["--op=frobnicate", "--lesson=x", "--variant=y"]).ok).toBe(false);
    expect(parseArgs(["--target=prod", "--lesson=x", "--variant=y"]).ok).toBe(false);
  });

  test("accepts --target=staging and --project (validated later in ensureTargetSafe)", () => {
    const r = parseArgs([
      "--target=staging",
      "--project=lyfelabz-staging",
      "--lesson=earths-layers",
      "--variant=reading-adapted",
      "--revision=" + REV,
      "--published-by=op",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.args.target).toBe("staging");
      expect(r.args.project).toBe("lyfelabz-staging");
    }
  });
});

describe("ensureTargetSafe", () => {
  const baseArgs: CliArgs = {
    op: "publish",
    target: "production",
    lessonSlug: "earths-layers",
    variantKey: "reading-adapted",
    presentationRevisionId: REV,
    publishedBy: "op",
    hostingOrigin: "https://lyfelabz.com",
    iKnowProduction: true,
    project: null,
  };

  test("emulator target is always safe", () => {
    expect(ensureTargetSafe({ ...baseArgs, target: "emulator", iKnowProduction: false }, {})).toBeNull();
  });

  test("production requires --i-know=production", () => {
    expect(ensureTargetSafe({ ...baseArgs, iKnowProduction: false }, {})).toBe(
      "production target requires --i-know=production",
    );
  });

  test("production refuses when FIRESTORE_EMULATOR_HOST is set", () => {
    expect(
      ensureTargetSafe(baseArgs, {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        GOOGLE_APPLICATION_CREDENTIALS: "/creds.json",
      }),
    ).toBe("refusing production publish while FIRESTORE_EMULATOR_HOST is set");
  });

  test("production requires GOOGLE_APPLICATION_CREDENTIALS", () => {
    expect(ensureTargetSafe(baseArgs, {})).toBe("production target requires GOOGLE_APPLICATION_CREDENTIALS");
  });

  test("production publish requires --hosting-origin for the liveness fetch", () => {
    expect(
      ensureTargetSafe(
        { ...baseArgs, hostingOrigin: null },
        { GOOGLE_APPLICATION_CREDENTIALS: "/creds.json" },
      ),
    ).toBe("production --op=publish requires --hosting-origin=<https://...> for the liveness fetch");
  });

  test("production retire does not require --hosting-origin", () => {
    expect(
      ensureTargetSafe(
        { ...baseArgs, op: "retire", hostingOrigin: null, presentationRevisionId: null },
        { GOOGLE_APPLICATION_CREDENTIALS: "/creds.json" },
      ),
    ).toBeNull();
  });
});

describe("configureEmulatorEnv", () => {
  test("sets emulator host and project when unset", () => {
    const env: NodeJS.ProcessEnv = {};
    const mutations: Record<string, string> = {};
    configureEmulatorEnv(env, (k, v) => {
      mutations[k] = v;
    });
    expect(mutations.FIRESTORE_EMULATOR_HOST).toBe("127.0.0.1:8080");
    expect(mutations.GCLOUD_PROJECT).toBe("lyfelabz-prod");
  });
});

describe("ensureStagingTargetSafe (fail-closed, alias-name never trusted)", () => {
  const stagingArgs: CliArgs = {
    op: "publish",
    target: "staging",
    lessonSlug: "earths-layers",
    variantKey: "reading-adapted",
    presentationRevisionId: REV,
    publishedBy: "op",
    hostingOrigin: `https://${STAGING_PROJECT_ID}.web.app`,
    iKnowProduction: false,
    project: STAGING_PROJECT_ID,
  };
  const okEnv: NodeJS.ProcessEnv = { GOOGLE_APPLICATION_CREDENTIALS: "/staging-creds.json" };

  test("STAGING_PROJECT_ID is the hard literal lyfelabz-staging", () => {
    expect(STAGING_PROJECT_ID).toBe("lyfelabz-staging");
  });

  test("a fully specified staging publish is safe", () => {
    expect(ensureStagingTargetSafe(stagingArgs, okEnv)).toBeNull();
  });

  test("requires an explicit --project (no alias/default is trusted)", () => {
    const err = ensureStagingTargetSafe({ ...stagingArgs, project: null }, okEnv);
    expect(err).toContain("staging target requires --project=lyfelabz-staging");
  });

  test("refuses any project other than lyfelabz-staging (never production)", () => {
    const err = ensureStagingTargetSafe({ ...stagingArgs, project: "lyfelabz-prod" }, okEnv);
    expect(err).toContain("refuses project 'lyfelabz-prod'");
  });

  test("refuses when FIRESTORE_EMULATOR_HOST is set", () => {
    const err = ensureStagingTargetSafe(stagingArgs, {
      ...okEnv,
      FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    });
    expect(err).toContain("FIRESTORE_EMULATOR_HOST");
  });

  test("refuses when a conflicting project is already in the environment", () => {
    for (const key of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"] as const) {
      const err = ensureStagingTargetSafe(stagingArgs, { ...okEnv, [key]: "lyfelabz-prod" });
      expect(err).toContain(`${key}='lyfelabz-prod'`);
    }
  });

  test("allows an environment project that already equals staging", () => {
    expect(
      ensureStagingTargetSafe(stagingArgs, { ...okEnv, GCLOUD_PROJECT: STAGING_PROJECT_ID }),
    ).toBeNull();
  });

  test("requires GOOGLE_APPLICATION_CREDENTIALS", () => {
    const err = ensureStagingTargetSafe(stagingArgs, {});
    expect(err).toContain("GOOGLE_APPLICATION_CREDENTIALS");
  });

  test("publish requires --hosting-origin", () => {
    const err = ensureStagingTargetSafe({ ...stagingArgs, hostingOrigin: null }, okEnv);
    expect(err).toContain("requires --hosting-origin");
  });

  test("refuses a non-https hosting origin", () => {
    const err = ensureStagingTargetSafe(
      { ...stagingArgs, hostingOrigin: `http://${STAGING_PROJECT_ID}.web.app` },
      okEnv,
    );
    expect(err).toContain("must be https");
  });

  test("refuses a hosting origin that does not resolve to the staging site", () => {
    const err = ensureStagingTargetSafe(
      { ...stagingArgs, hostingOrigin: "https://lyfelabz.com" },
      okEnv,
    );
    expect(err).toContain("does not resolve to the 'lyfelabz-staging' hosting site");
  });

  test("retire does not require --hosting-origin", () => {
    expect(
      ensureStagingTargetSafe(
        { ...stagingArgs, op: "retire", hostingOrigin: null, presentationRevisionId: null },
        okEnv,
      ),
    ).toBeNull();
  });

  test("ensureTargetSafe routes staging to the staging gate, never the production branch", () => {
    // iKnowProduction is false here; a production-branch fall-through would
    // return the --i-know error. Staging must be validated on its own terms.
    expect(ensureTargetSafe(stagingArgs, okEnv)).toBeNull();
    expect(ensureTargetSafe({ ...stagingArgs, project: null }, okEnv)).toContain(
      "staging target requires --project",
    );
  });
});

describe("configureStagingEnv", () => {
  test("forces both Admin SDK project vars to the staging id", () => {
    const mutations: Record<string, string> = {};
    configureStagingEnv(STAGING_PROJECT_ID, (k, v) => {
      mutations[k] = v;
    });
    expect(mutations.GCLOUD_PROJECT).toBe(STAGING_PROJECT_ID);
    expect(mutations.GOOGLE_CLOUD_PROJECT).toBe(STAGING_PROJECT_ID);
  });

  test("throws (never mutates env) for any non-staging project", () => {
    expect(() => configureStagingEnv("lyfelabz-prod", () => undefined)).toThrow("lyfelabz-prod");
  });
});

describe("makeStagingDeployHosting (fail-closed deploy port)", () => {
  test("deploys only for the authorized staging project", async () => {
    const calls: string[] = [];
    const port = makeStagingDeployHosting(STAGING_PROJECT_ID, (p) => calls.push(p));
    const result = await port();
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual([STAGING_PROJECT_ID]);
  });

  test("refuses a non-staging project WITHOUT invoking the deploy runner", async () => {
    const calls: string[] = [];
    const port = makeStagingDeployHosting("lyfelabz-prod", (p) => calls.push(p));
    const result = await port();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("not the authorized staging project");
    expect(calls).toEqual([]); // never deployed
  });

  test("a failing deploy becomes { ok: false } (stops publication before the index)", async () => {
    const port = makeStagingDeployHosting(STAGING_PROJECT_ID, () => {
      throw new Error("firebase exited 1");
    });
    const result = await port();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("firebase exited 1");
  });
});

describe("main routing and exit codes", () => {
  test("bad args -> exit 2", async () => {
    const deps = makeDeps();
    const code = await main(["--nope"], deps);
    expect(code).toBe(2);
    expect(deps.publishCalls).toHaveLength(0);
  });

  test("production without --i-know -> exit 2, no publish", async () => {
    const deps = makeDeps();
    const code = await main(
      [
        "--target=production",
        "--lesson=earths-layers",
        "--variant=reading-adapted",
        "--revision=" + REV,
        "--published-by=op",
      ],
      deps,
    );
    expect(code).toBe(2);
    expect(deps.publishCalls).toHaveLength(0);
  });

  test("emulator publish success -> exit 0 and forwards trusted input", async () => {
    const deps = makeDeps();
    const code = await main(
      ["--lesson=earths-layers", "--variant=reading-adapted", "--revision=" + REV, "--published-by=op"],
      deps,
    );
    expect(code).toBe(0);
    expect(deps.publishCalls).toEqual([
      {
        lessonSlug: "earths-layers",
        variantKey: "reading-adapted",
        presentationRevisionId: REV,
        publishedBy: "op",
        mode: "publish",
      },
    ]);
  });

  test("publish failure -> exit 1, message notes index did not advance", async () => {
    const deps = makeDeps({
      publish: () =>
        Promise.resolve<PublishResult>({
          ok: false,
          failedStage: "HOSTED_BYTES_VERIFIED",
          error: "hosted bytes mismatch",
          stagesCompleted: ["LOCAL_VERIFIED", "HOSTING_DEPLOYED"],
          indexAdvanced: false,
        }),
    });
    const code = await main(
      ["--lesson=earths-layers", "--variant=reading-adapted", "--revision=" + REV, "--published-by=op"],
      deps,
    );
    expect(code).toBe(1);
    expect(deps.errors.join("\n")).toContain("index advanced: false");
  });

  test("rollback routes with mode=rollback", async () => {
    const deps = makeDeps();
    const code = await main(
      [
        "--op=rollback",
        "--lesson=earths-layers",
        "--variant=reading-adapted",
        "--revision=" + REV,
        "--published-by=op",
      ],
      deps,
    );
    expect(code).toBe(0);
    expect(deps.publishCalls[0]?.mode).toBe("rollback");
  });

  test("retire routes to the retire seam", async () => {
    const deps = makeDeps();
    const code = await main(
      ["--op=retire", "--lesson=earths-layers", "--variant=reading-adapted", "--published-by=op"],
      deps,
    );
    expect(code).toBe(0);
    expect(deps.retireCalls).toEqual([
      { lessonSlug: "earths-layers", variantKey: "reading-adapted", publishedBy: "op" },
    ]);
    expect(deps.publishCalls).toHaveLength(0);
  });

  test("retire failure -> exit 1", async () => {
    const deps = makeDeps({
      retire: () => Promise.resolve<RetireResult>({ ok: false, error: "boom" }),
    });
    const code = await main(
      ["--op=retire", "--lesson=earths-layers", "--variant=reading-adapted", "--published-by=op"],
      deps,
    );
    expect(code).toBe(1);
  });
});
