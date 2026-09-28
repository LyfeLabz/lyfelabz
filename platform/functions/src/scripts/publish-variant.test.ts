import {
  configureEmulatorEnv,
  configureProductionEnv,
  configureStagingEnv,
  ensureProductionTargetSafe,
  ensureStagingTargetSafe,
  ensureTargetSafe,
  main,
  makeStagingDeployHosting,
  parseArgs,
  PRODUCTION_HOSTING_ORIGINS,
  PRODUCTION_PROJECT_ID,
  STAGING_PROJECT_ID,
  type CliArgs,
  type CliDeps,
  type PublishContext,
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
      assessmentRevisionId: `assessment_${input.lessonSlug}__r1`,
      assessmentRevisionSource: "declared",
    },
    stagesCompleted: ["LOCAL_VERIFIED", "HOSTING_DEPLOYED", "HOSTED_BYTES_VERIFIED", "INDEX_UPDATED"],
    indexAdvanced: true,
    coverage: { docId: `${input.lessonSlug}__${input.variantKey}__r1`, action: "create" },
  };
}

function makeDeps(overrides: Partial<CliDeps> = {}): CliDeps & {
  logs: string[];
  errors: string[];
  publishCalls: PublishInput[];
  publishContexts: PublishContext[];
  retireCalls: RetireInput[];
  boundProjects: string[];
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const publishCalls: PublishInput[] = [];
  const publishContexts: PublishContext[] = [];
  const retireCalls: RetireInput[] = [];
  const boundProjects: string[] = [];
  const env: NodeJS.ProcessEnv = { ...(overrides.env ?? {}) };
  return {
    logs,
    errors,
    publishCalls,
    publishContexts,
    retireCalls,
    boundProjects,
    env,
    setEnv: (key, value) => {
      env[key] = value;
    },
    log: (m) => logs.push(m),
    logError: (m) => errors.push(m),
    publish:
      overrides.publish ??
      ((input: PublishInput, context: PublishContext) => {
        publishCalls.push(input);
        publishContexts.push(context);
        return Promise.resolve(okPublish(input));
      }),
    bindAdminProject:
      overrides.bindAdminProject ??
      ((projectId: string) => {
        boundProjects.push(projectId);
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

  test("retire does not require --revision but names the assessment revision (F5.3 Slice 9C-2)", () => {
    const r = parseArgs([
      "--op=retire",
      "--lesson=earths-layers",
      "--variant=reading-adapted",
      "--published-by=op",
      "--assessment-revision=assessment_earths-layers__r1",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.args).toMatchObject({ op: "retire", assessmentRevisionId: "assessment_earths-layers__r1" });
    const missing = parseArgs(["--op=retire", "--lesson=earths-layers", "--variant=reading-adapted", "--published-by=op"]);
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.message).toContain("--assessment-revision=assessment_<slug>__r<N> is required for --op=retire");
  });

  test("publish and rollback refuse an operator-supplied assessment revision (derived from provenance)", () => {
    for (const op of ["publish", "rollback"]) {
      const r = parseArgs([`--op=${op}`, "--lesson=earths-layers", "--variant=reading-adapted", "--published-by=op", `--revision=${REV}`, "--assessment-revision=assessment_earths-layers__r1"]);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("only accepted for --op=retire");
    }
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
    hostingOrigin: "https://app.lyfelabz.com",
    iKnowProduction: true,
    project: PRODUCTION_PROJECT_ID,
    assessmentRevisionId: null,
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
    assessmentRevisionId: null,
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
      ["--op=retire", "--lesson=earths-layers", "--variant=reading-adapted", "--published-by=op", "--assessment-revision=assessment_earths-layers__r1"],
      deps,
    );
    expect(code).toBe(0);
    expect(deps.retireCalls).toEqual([
      { lessonSlug: "earths-layers", variantKey: "reading-adapted", assessmentRevisionId: "assessment_earths-layers__r1", publishedBy: "op" },
    ]);
    expect(deps.publishCalls).toHaveLength(0);
  });

  test("retire failure -> exit 1", async () => {
    const deps = makeDeps({
      retire: () => Promise.resolve<RetireResult>({ ok: false, error: "boom" }),
    });
    const code = await main(
      ["--op=retire", "--lesson=earths-layers", "--variant=reading-adapted", "--published-by=op", "--assessment-revision=assessment_earths-layers__r1"],
      deps,
    );
    expect(code).toBe(1);
  });
});

describe("production target binding (fail-closed; ambient project resolution never trusted)", () => {
  const prodArgs: CliArgs = {
    op: "publish",
    target: "production",
    lessonSlug: "earths-layers",
    variantKey: "reading-adapted",
    presentationRevisionId: REV,
    publishedBy: "op",
    hostingOrigin: "https://app.lyfelabz.com",
    iKnowProduction: true,
    project: PRODUCTION_PROJECT_ID,
    assessmentRevisionId: null,
  };
  const okEnv = { GOOGLE_APPLICATION_CREDENTIALS: "/creds.json" };

  test("PRODUCTION_PROJECT_ID and the approved origins are hard literals", () => {
    expect(PRODUCTION_PROJECT_ID).toBe("lyfelabz-prod");
    expect(PRODUCTION_HOSTING_ORIGINS).toEqual(["https://app.lyfelabz.com", "https://lyfelabz-prod.web.app"]);
  });

  test("a fully specified production publish is safe", () => {
    expect(ensureProductionTargetSafe(prodArgs, okEnv)).toBeNull();
    expect(ensureTargetSafe(prodArgs, okEnv)).toBeNull();
  });

  test("still requires the explicit production acknowledgement", () => {
    expect(ensureProductionTargetSafe({ ...prodArgs, iKnowProduction: false }, okEnv)).toBe(
      "production target requires --i-know=production",
    );
  });

  test("requires an explicit --project", () => {
    expect(ensureProductionTargetSafe({ ...prodArgs, project: null }, okEnv)).toContain(
      `production target requires --project=${PRODUCTION_PROJECT_ID}`,
    );
  });

  test.each([STAGING_PROJECT_ID, "lyfelabz-prod-2", "LYFELABZ-PROD", "prod"])(
    "refuses project %s",
    (project) => {
      expect(ensureProductionTargetSafe({ ...prodArgs, project }, okEnv)).toContain(
        `production target refuses project '${project}'`,
      );
    },
  );

  test.each(["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "CLOUDSDK_CORE_PROJECT"])(
    "refuses a conflicting ambient %s (cannot silently target staging)",
    (key) => {
      expect(ensureProductionTargetSafe(prodArgs, { ...okEnv, [key]: STAGING_PROJECT_ID })).toContain(
        `${key}='${STAGING_PROJECT_ID}' does not match the authorized production project`,
      );
    },
  );

  test("allows ambient project variables that already equal production", () => {
    expect(
      ensureProductionTargetSafe(prodArgs, {
        ...okEnv,
        GCLOUD_PROJECT: PRODUCTION_PROJECT_ID,
        GOOGLE_CLOUD_PROJECT: PRODUCTION_PROJECT_ID,
      }),
    ).toBeNull();
  });

  test("refuses FIREBASE_CONFIG (it can supply another project to the Admin SDK)", () => {
    expect(
      ensureProductionTargetSafe(prodArgs, { ...okEnv, FIREBASE_CONFIG: '{"projectId":"lyfelabz-staging"}' }),
    ).toContain("FIREBASE_CONFIG is set");
  });

  test("still refuses the emulator and missing credentials", () => {
    expect(ensureProductionTargetSafe(prodArgs, { ...okEnv, FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" })).toBe(
      "refusing production publish while FIRESTORE_EMULATOR_HOST is set",
    );
    expect(ensureProductionTargetSafe(prodArgs, {})).toBe("production target requires GOOGLE_APPLICATION_CREDENTIALS");
  });

  test.each([
    "https://lyfelabz.com",
    "http://app.lyfelabz.com",
    "https://lyfelabz-staging.web.app",
    "https://app.lyfelabz.com.evil.test",
    "https://app.lyfelabz.com/app",
    "https://lyfelabz-marketing.web.app",
  ])("refuses unapproved hosting origin %s", (hostingOrigin) => {
    expect(ensureProductionTargetSafe({ ...prodArgs, hostingOrigin }, okEnv)).toContain(
      "is not an approved production origin",
    );
  });

  test.each(["https://app.lyfelabz.com", "https://lyfelabz-prod.web.app", "https://app.lyfelabz.com/"])(
    "accepts approved hosting origin %s",
    (hostingOrigin) => {
      expect(ensureProductionTargetSafe({ ...prodArgs, hostingOrigin }, okEnv)).toBeNull();
    },
  );

  test("refuses a LYFELABZ_HOSTING_ORIGIN that disagrees with --hosting-origin", () => {
    expect(
      ensureProductionTargetSafe(prodArgs, { ...okEnv, LYFELABZ_HOSTING_ORIGIN: "https://lyfelabz-staging.web.app" }),
    ).toContain("LYFELABZ_HOSTING_ORIGIN='https://lyfelabz-staging.web.app' disagrees");
    expect(
      ensureProductionTargetSafe(prodArgs, { ...okEnv, LYFELABZ_HOSTING_ORIGIN: "https://lyfelabz-prod.web.app" }),
    ).toContain("disagrees");
    expect(
      ensureProductionTargetSafe(prodArgs, { ...okEnv, LYFELABZ_HOSTING_ORIGIN: "https://app.lyfelabz.com/" }),
    ).toBeNull();
  });

  test("retire needs no origin, but a supplied origin must still be approved", () => {
    const retire = { ...prodArgs, op: "retire" as const, presentationRevisionId: null };
    expect(ensureProductionTargetSafe({ ...retire, hostingOrigin: null }, okEnv)).toBeNull();
    expect(ensureProductionTargetSafe({ ...retire, hostingOrigin: "https://evil.test" }, okEnv)).toContain(
      "is not an approved production origin",
    );
  });

  test("configureProductionEnv forces both project vars and refuses any other id", () => {
    const env: Record<string, string> = {};
    configureProductionEnv(PRODUCTION_PROJECT_ID, (k, v) => {
      env[k] = v;
    });
    expect(env).toEqual({ GCLOUD_PROJECT: PRODUCTION_PROJECT_ID, GOOGLE_CLOUD_PROJECT: PRODUCTION_PROJECT_ID });
    const untouched: Record<string, string> = {};
    expect(() =>
      configureProductionEnv(STAGING_PROJECT_ID, (k, v) => {
        untouched[k] = v;
      }),
    ).toThrow(/only 'lyfelabz-prod' is authorized/);
    expect(untouched).toEqual({});
  });
});

describe("main binds the Admin SDK and the liveness origin to the validated target", () => {
  const prodArgv = [
    "--target=production",
    "--i-know=production",
    "--project=lyfelabz-prod",
    "--lesson=earths-layers",
    "--variant=reading-adapted",
    "--revision=" + REV,
    "--published-by=op",
  ];

  test("production binds lyfelabz-prod BEFORE publishing and fetches from the validated origin", async () => {
    const order: string[] = [];
    const deps = makeDeps({
      env: { GOOGLE_APPLICATION_CREDENTIALS: "/creds.json", LYFELABZ_HOSTING_ORIGIN: "https://lyfelabz-prod.web.app/" },
      bindAdminProject: (p) => {
        order.push(`bind:${p}`);
      },
    });
    const origPublish = deps.publish;
    const code = await main([...prodArgv, "--hosting-origin=https://lyfelabz-prod.web.app"], {
      ...deps,
      publish: (input, ctx) => {
        order.push("publish");
        return origPublish(input, ctx);
      },
    });
    expect(code).toBe(0);
    expect(order).toEqual(["bind:lyfelabz-prod", "publish"]);
    expect(deps.publishContexts).toEqual([{ fetchOrigin: "https://lyfelabz-prod.web.app" }]);
    expect(deps.env.GCLOUD_PROJECT).toBe(PRODUCTION_PROJECT_ID);
    expect(deps.env.GOOGLE_CLOUD_PROJECT).toBe(PRODUCTION_PROJECT_ID);
  });

  test("the validated origin wins; a disagreeing environment origin refuses before any binding", async () => {
    const deps = makeDeps({
      env: { GOOGLE_APPLICATION_CREDENTIALS: "/creds.json", LYFELABZ_HOSTING_ORIGIN: "https://lyfelabz-staging.web.app" },
    });
    const code = await main([...prodArgv, "--hosting-origin=https://app.lyfelabz.com"], deps);
    expect(code).toBe(2);
    expect(deps.boundProjects).toEqual([]);
    expect(deps.publishCalls).toHaveLength(0);
  });

  test("ambient staging state (ADC-style env, no --project) cannot reach a production write", async () => {
    const deps = makeDeps({
      env: { GOOGLE_APPLICATION_CREDENTIALS: "/adc.json", GOOGLE_CLOUD_PROJECT: STAGING_PROJECT_ID },
    });
    const noProject = prodArgv.filter((a) => a !== "--project=lyfelabz-prod");
    expect(await main([...noProject, "--hosting-origin=https://app.lyfelabz.com"], deps)).toBe(2);
    expect(await main([...prodArgv, "--hosting-origin=https://app.lyfelabz.com"], deps)).toBe(2);
    expect(deps.boundProjects).toEqual([]);
    expect(deps.publishCalls).toHaveLength(0);
  });

  test("--project=lyfelabz-staging with --target=production is refused", async () => {
    const deps = makeDeps({ env: { GOOGLE_APPLICATION_CREDENTIALS: "/creds.json" } });
    const argv = prodArgv.map((a) => (a === "--project=lyfelabz-prod" ? "--project=lyfelabz-staging" : a));
    expect(await main([...argv, "--hosting-origin=https://app.lyfelabz.com"], deps)).toBe(2);
    expect(deps.publishCalls).toHaveLength(0);
  });

  test("a failed Admin SDK binding refuses before publishing", async () => {
    const deps = makeDeps({
      env: { GOOGLE_APPLICATION_CREDENTIALS: "/creds.json" },
      bindAdminProject: () => {
        throw new Error("default Admin SDK app is already bound to 'lyfelabz-staging'");
      },
    });
    const code = await main([...prodArgv, "--hosting-origin=https://app.lyfelabz.com"], deps);
    expect(code).toBe(2);
    expect(deps.publishCalls).toHaveLength(0);
    expect(deps.errors.join(" ")).toContain("could not bind the Admin SDK");
  });

  test("production retire binds lyfelabz-prod before retiring", async () => {
    const deps = makeDeps({ env: { GOOGLE_APPLICATION_CREDENTIALS: "/creds.json" } });
    const argv = [
      "--op=retire", "--assessment-revision=assessment_earths-layers__r1",
      "--target=production",
      "--i-know=production",
      "--project=lyfelabz-prod",
      "--lesson=earths-layers",
      "--variant=reading-adapted",
      "--published-by=op",
    ];
    expect(await main(argv, deps)).toBe(0);
    expect(deps.boundProjects).toEqual([PRODUCTION_PROJECT_ID]);
    expect(deps.retireCalls).toHaveLength(1);
  });

  test("staging still binds only lyfelabz-staging and fetches from its validated origin", async () => {
    const deps = makeDeps({
      env: { GOOGLE_APPLICATION_CREDENTIALS: "/creds.json", LYFELABZ_HOSTING_ORIGIN: "https://app.lyfelabz.com" },
    });
    const code = await main(
      [
        "--target=staging",
        "--project=lyfelabz-staging",
        "--hosting-origin=https://lyfelabz-staging.web.app",
        "--lesson=earths-layers",
        "--variant=reading-adapted",
        "--revision=" + REV,
        "--published-by=op",
      ],
      deps,
    );
    expect(code).toBe(0);
    expect(deps.boundProjects).toEqual([STAGING_PROJECT_ID]);
    expect(deps.publishContexts).toEqual([{ fetchOrigin: "https://lyfelabz-staging.web.app" }]);
  });

  test("the emulator binds nothing and keeps the LYFELABZ_HOSTING_ORIGIN behavior", async () => {
    const deps = makeDeps({ env: { LYFELABZ_HOSTING_ORIGIN: "http://127.0.0.1:5000" } });
    const code = await main(
      ["--lesson=earths-layers", "--variant=reading-adapted", "--revision=" + REV, "--published-by=op"],
      deps,
    );
    expect(code).toBe(0);
    expect(deps.boundProjects).toEqual([]);
    expect(deps.publishContexts).toEqual([{ fetchOrigin: "http://127.0.0.1:5000" }]);
  });
});
