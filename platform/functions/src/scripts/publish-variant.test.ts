import {
  configureEmulatorEnv,
  ensureTargetSafe,
  main,
  parseArgs,
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
    expect(parseArgs(["--target=staging", "--lesson=x", "--variant=y"]).ok).toBe(false);
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
