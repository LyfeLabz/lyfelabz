import * as fs from "fs";
import * as os from "os";
import { join } from "path";
import { Timestamp } from "@google-cloud/firestore";
import { UserRefreshClient, type Impersonated } from "google-auth-library";

import earthsLayers from "./assessments/earths-layers.r1.json";
import whatIsLife from "./assessments/what-is-life.r1.json";
import {
  LessonResolutionError,
  STAGING_PROJECT_ID,
  assertLessonPlanIdentity,
  committedPayloadDirectory,
  createStagingImpersonatedClient,
  ensureStagingSafe,
  main,
  makeRepositoryFidelityVerifier,
  makeRepositoryLessonResolver,
  parseArgs,
  repoRootFromCompiled,
  resolveCommittedLessonPayload,
  type CliDeps,
  type DocumentObservation,
  type ResolvedLessonPayload,
} from "./deploy-assessment-staging";
import { planAssessmentRevision } from "../assessments/assessment-deployment";

// The general staging deployer is exercised through its injection seams: no
// credential, IAM, or Firestore call leaves the jest process. The shared
// impersonation and direct-Firestore binding are covered in depth by
// deploy-what-is-life-staging.test.ts, which now runs through this module.

const SAFE_ENV: NodeJS.ProcessEnv = {};
const EL_ASSESSMENT = "assessment_earths-layers";
const EL_REVISION = "assessment_earths-layers__r1";
const EL_ARGS = ["--project=lyfelabz-staging", "--lesson=earths-layers"];

function syntheticImpersonatedClient(): Impersonated {
  const client = createStagingImpersonatedClient(
    new UserRefreshClient({
      clientId: "synthetic-client-id",
      clientSecret: "synthetic-client-secret",
      refreshToken: "synthetic-refresh-token",
    }),
  );
  client.credentials.expiry_date = Date.now() + 900_000;
  client.getAccessToken = jest.fn(() => Promise.resolve({ token: "synthetic" }));
  return client;
}

function resolved(
  payload: unknown = earthsLayers,
  overrides: Partial<ResolvedLessonPayload> = {},
): ResolvedLessonPayload {
  return {
    slug: "earths-layers",
    revisionOrdinal: 1,
    fileName: "earths-layers.r1.json",
    payload,
    ...overrides,
  };
}

function absent(): DocumentObservation {
  return { exists: false };
}

function canonicalObservations(payload: unknown = earthsLayers): readonly DocumentObservation[] {
  const plan = planAssessmentRevision(payload);
  const publishedAt = Timestamp.fromMillis(1_789_000_000_000);
  return [
    { exists: true, data: { ...plan.assessmentWrite } },
    { exists: true, data: { ...plan.revisionWrite, publishedAt } },
    { exists: true, data: { ...plan.answerKeyWrite, publishedAt } },
  ];
}

function makeDeps(
  options: {
    readonly observations?: readonly DocumentObservation[];
    readonly resolve?: CliDeps["resolveLessonPayload"];
    readonly verifyFidelity?: CliDeps["verifyFidelity"];
  } = {},
) {
  const logs: string[] = [];
  const errors: string[] = [];
  const readDocuments = jest
    .fn()
    .mockResolvedValue(options.observations ?? [absent(), absent(), absent()]);
  const deploy = jest.fn().mockResolvedValue({
    assessmentId: EL_ASSESSMENT,
    revisionId: EL_REVISION,
    revisionOrdinal: 1,
    assessmentCreated: true,
  });
  const initializeRuntime = jest.fn().mockResolvedValue({ readDocuments, deploy });
  const acquireImpersonatedCredential = jest
    .fn()
    .mockResolvedValue(syntheticImpersonatedClient());
  const resolveLessonPayload = jest.fn(options.resolve ?? (() => resolved()));
  const verifyFidelity = jest.fn(
    options.verifyFidelity ?? (() => ({ canonicalQuestionCount: earthsLayers.items.length })),
  );
  const deps: CliDeps = {
    acquireImpersonatedCredential,
    resolveLessonPayload,
    verifyFidelity,
    initializeRuntime,
    log: (message) => logs.push(message),
    logError: (message) => errors.push(message),
  };
  return {
    deps,
    logs,
    errors,
    readDocuments,
    deploy,
    initializeRuntime,
    acquireImpersonatedCredential,
    resolveLessonPayload,
    verifyFidelity,
  };
}

function expectNoRemoteAccess(harness: ReturnType<typeof makeDeps>): void {
  expect(harness.acquireImpersonatedCredential).not.toHaveBeenCalled();
  expect(harness.initializeRuntime).not.toHaveBeenCalled();
  expect(harness.readDocuments).not.toHaveBeenCalled();
  expect(harness.deploy).not.toHaveBeenCalled();
}

describe("--lesson argument", () => {
  test("accepts the literal staging project and a kebab-case lesson, dry-run by default", () => {
    expect(parseArgs(EL_ARGS)).toEqual({
      ok: true,
      args: { project: STAGING_PROJECT_ID, lesson: "earths-layers", apply: false },
    });
    expect(parseArgs([...EL_ARGS, "--apply"])).toMatchObject({
      ok: true,
      args: { apply: true },
    });
  });

  test.each([
    ["missing lesson", ["--project=lyfelabz-staging"]],
    ["empty lesson", ["--project=lyfelabz-staging", "--lesson="]],
    ["bare lesson flag", ["--project=lyfelabz-staging", "--lesson"]],
    ["duplicate lesson", [...EL_ARGS, "--lesson=what-is-life"]],
    ["duplicate identical lesson", [...EL_ARGS, "--lesson=earths-layers"]],
    ["missing project", ["--lesson=earths-layers"]],
    ["lesson file override", [...EL_ARGS, "--file=earths-layers.r1.json"]],
    ["target override", [...EL_ARGS, "--target=production"]],
  ])("rejects %s", (_label, argv) => {
    expect(parseArgs(argv)).toMatchObject({ ok: false });
  });

  test.each([
    "../earths-layers",
    "earths-layers/../what-is-life",
    "Earths-Layers",
    "earths_layers",
    "earths-layers.r1",
    "earths-layers.r1.json",
    "lesson_earths-layers",
    "-earths-layers",
    "earths-layers-",
    "earths--layers",
    " earths-layers",
    "earths-layers ",
    "earths layers",
    "*",
    "a".repeat(101),
  ])("rejects malformed slug %j before any resolution", async (lesson) => {
    const harness = makeDeps();
    expect(await main(["--project=lyfelabz-staging", `--lesson=${lesson}`], SAFE_ENV, harness.deps)).toBe(2);
    expect(harness.resolveLessonPayload).not.toHaveBeenCalled();
    expectNoRemoteAccess(harness);
  });
});

describe("staging-only binding", () => {
  test.each([
    ["production", "lyfelabz-prod"],
    ["alias", "default"],
    ["case variant", "LYFELABZ-STAGING"],
  ])("refuses the %s project", async (_label, project) => {
    const harness = makeDeps();
    expect(
      await main([`--project=${project}`, "--lesson=earths-layers"], SAFE_ENV, harness.deps),
    ).toBe(2);
    expect(harness.resolveLessonPayload).not.toHaveBeenCalled();
    expectNoRemoteAccess(harness);
  });

  test.each(["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT", "CLOUDSDK_CORE_PROJECT"])(
    "refuses a conflicting ambient %s",
    async (key) => {
      expect(ensureStagingSafe({ project: STAGING_PROJECT_ID }, { [key]: "lyfelabz-prod" })).toContain(key);
      expect(
        ensureStagingSafe({ project: STAGING_PROJECT_ID }, { [key]: STAGING_PROJECT_ID }),
      ).toBeNull();
      const harness = makeDeps();
      expect(await main(EL_ARGS, { [key]: "lyfelabz-prod" }, harness.deps)).toBe(2);
      expectNoRemoteAccess(harness);
    },
  );

  test.each([
    ["FIREBASE_CONFIG", JSON.stringify({ projectId: "lyfelabz-prod" })],
    ["FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080"],
    ["GOOGLE_APPLICATION_CREDENTIALS", "/synthetic/key.json"],
    ["google_application_credentials", ""],
  ])("refuses ambient redirection through %s", async (key, value) => {
    expect(ensureStagingSafe({ project: STAGING_PROJECT_ID }, { [key]: value })).toContain(key);
    const harness = makeDeps();
    expect(await main([...EL_ARGS, "--apply"], { [key]: value }, harness.deps)).toBe(2);
    expect(harness.resolveLessonPayload).not.toHaveBeenCalled();
    expectNoRemoteAccess(harness);
  });

  test("module source never loads the Firebase Admin SDK or a private-key credential", () => {
    const source = fs.readFileSync(join(__dirname, "deploy-assessment-staging.ts"), "utf8");
    expect(source).not.toMatch(/createPrivateKey|private_key|privateKey|\bcert\s*\(/);
    expect(source).not.toMatch(/readCredentialFile/);
    expect(source).not.toMatch(/firebase-admin|initializeApp|getFirestore/);
    expect(source).not.toMatch(/lyfelabz-prod/);
  });
});

describe("committed payload resolution", () => {
  function io(files: Record<string, string>) {
    return {
      listPayloadFiles: () => Object.keys(files),
      readPayloadFile: (fileName: string) => files[fileName],
    };
  }
  const EL_JSON = JSON.stringify(earthsLayers);

  test("resolves exactly one committed <slug>.r<N>.json", () => {
    const result = resolveCommittedLessonPayload(
      "earths-layers",
      io({
        "earths-layers.r1.json": EL_JSON,
        "earths-layers-extra.r1.json": "{}",
        "what-is-life.r1.json": "{}",
        "cert-lessons.ts": "",
      }),
    );
    expect(result).toEqual(resolved(earthsLayers));
  });

  test.each([
    ["unknown lesson", {}, /unknown lesson/],
    ["only a longer slug shares the prefix", { "earths-layers-extra.r1.json": EL_JSON }, /unknown lesson/],
    ["two committed revisions", { "earths-layers.r1.json": EL_JSON, "earths-layers.r2.json": EL_JSON }, /ambiguous/],
    ["a non-canonical ordinal", { "earths-layers.r01.json": EL_JSON }, /ambiguous/],
    ["a stray file claiming the slug", { "earths-layers.r1.json": EL_JSON, "earths-layers.r1.json.bak": EL_JSON }, /ambiguous/],
    ["an unrevisioned payload", { "earths-layers.json": EL_JSON }, /ambiguous/],
    ["unparseable JSON", { "earths-layers.r1.json": "{not json" }, /could not be read as JSON/],
  ])("refuses %s", (_label, files, message) => {
    expect(() => resolveCommittedLessonPayload("earths-layers", io(files))).toThrow(
      LessonResolutionError,
    );
    expect(() => resolveCommittedLessonPayload("earths-layers", io(files))).toThrow(message);
  });

  test("refuses a malformed slug even when called directly", () => {
    expect(() =>
      resolveCommittedLessonPayload("../earths-layers", io({ "earths-layers.r1.json": EL_JSON })),
    ).toThrow(/malformed lesson slug/);
  });

  test("the real repository resolver finds earths-layers r1 and refuses an unknown lesson", () => {
    const resolve = makeRepositoryLessonResolver(repoRootFromCompiled());
    const result = resolve("earths-layers");
    expect(result.fileName).toBe("earths-layers.r1.json");
    expect(result.revisionOrdinal).toBe(1);
    expect(result.payload).toEqual(earthsLayers);
    expect(() => resolve("no-such-lesson")).toThrow(/unknown lesson/);
  });

  test("every committed payload resolves uniquely and plans to its own identity", () => {
    const repoRoot = repoRootFromCompiled();
    const resolve = makeRepositoryLessonResolver(repoRoot);
    const slugs = fs
      .readdirSync(committedPayloadDirectory(repoRoot))
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => fileName.replace(/\.r\d+\.json$/, ""));
    expect(slugs.length).toBeGreaterThanOrEqual(49);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      const result = resolve(slug);
      expect(() => assertLessonPlanIdentity(planAssessmentRevision(result.payload), result)).not.toThrow();
    }
  });
});

describe("plan identity and answer-key linkage", () => {
  test("earths-layers r1 plans to its canonical ids with a linked answer key", () => {
    const plan = planAssessmentRevision(earthsLayers);
    expect(() => assertLessonPlanIdentity(plan, resolved())).not.toThrow();
    expect(plan.assessmentId).toBe(EL_ASSESSMENT);
    expect(plan.revisionId).toBe(EL_REVISION);
    expect(plan.answerKeyWrite.items.map((item) => item.itemId)).toEqual(
      plan.revisionWrite.items.map((item) => item.itemId),
    );
  });

  test.each([
    ["another lesson's payload", whatIsLife, {}, /activityId 'what-is-life'/],
    ["a payload whose ordinal disagrees with its file", { ...earthsLayers, revisionOrdinal: 2 }, {}, /revisionOrdinal 2/],
    ["a file revision the payload does not declare", earthsLayers, { revisionOrdinal: 2, fileName: "earths-layers.r2.json" }, /revisionOrdinal 1/],
  ])("refuses %s before any credential access", async (_label, payload, overrides, message) => {
    const harness = makeDeps({ resolve: () => resolved(payload, overrides) });
    expect(await main([...EL_ARGS, "--apply"], SAFE_ENV, harness.deps)).toBe(1);
    expect(harness.errors[0]).toMatch(message);
    expectNoRemoteAccess(harness);
  });

  test("refuses a payload the certified validator rejects", async () => {
    const invalid = { ...earthsLayers, items: [] };
    const harness = makeDeps({ resolve: () => resolved(invalid) });
    expect(await main([...EL_ARGS, "--apply"], SAFE_ENV, harness.deps)).toBe(1);
    expect(harness.errors[0]).toContain("canonical source validation failed");
    expectNoRemoteAccess(harness);
  });
});

describe("main flow", () => {
  test("unknown or ambiguous lessons exit 2 before credentials, reads, or writes", async () => {
    const harness = makeDeps({
      resolve: () => {
        throw new LessonResolutionError("unknown lesson 'no-such-lesson': no committed assessment payload");
      },
    });
    expect(
      await main(["--project=lyfelabz-staging", "--lesson=no-such-lesson", "--apply"], SAFE_ENV, harness.deps),
    ).toBe(2);
    expect(harness.errors).toEqual([
      "refusing lesson: unknown lesson 'no-such-lesson': no committed assessment payload",
    ]);
    expectNoRemoteAccess(harness);
  });

  test("a fidelity failure stops before credentials, reads, or writes", async () => {
    const harness = makeDeps({
      verifyFidelity: () => {
        throw new Error("payload does not match the canonical quiz (1 mismatch(es)): [earths-layers] q3 stem mismatch");
      },
    });
    expect(await main([...EL_ARGS, "--apply"], SAFE_ENV, harness.deps)).toBe(1);
    expect(harness.errors[0]).toContain("q3 stem mismatch");
    expectNoRemoteAccess(harness);
  });

  test("a canonical question count that disagrees with the plan stops the run", async () => {
    const harness = makeDeps({ verifyFidelity: () => ({ canonicalQuestionCount: 9 }) });
    expect(await main([...EL_ARGS, "--apply"], SAFE_ENV, harness.deps)).toBe(1);
    expectNoRemoteAccess(harness);
  });

  test("dry-run reads only the three earths-layers r1 documents and writes nothing", async () => {
    const harness = makeDeps();
    expect(await main(EL_ARGS, SAFE_ENV, harness.deps)).toBe(0);
    expect(harness.resolveLessonPayload).toHaveBeenCalledWith("earths-layers");
    expect(harness.verifyFidelity).toHaveBeenCalledWith("earths-layers", earthsLayers);
    expect(harness.readDocuments).toHaveBeenCalledTimes(1);
    expect(harness.readDocuments).toHaveBeenCalledWith([
      `assessments/${EL_ASSESSMENT}`,
      `assessmentRevisions/${EL_REVISION}`,
      `assessmentAnswerKeys/${EL_REVISION}`,
    ]);
    expect(harness.deploy).not.toHaveBeenCalled();
    expect(harness.logs).toEqual([
      `dry-run ok lesson=earths-layers file=earths-layers.r1.json assessment=${EL_ASSESSMENT} ` +
        `revision=${EL_REVISION} items=10 answerKeyItems=10 fidelity=exact state=absent writes=0 target=staging`,
    ]);
  });

  test("--apply deploys the resolved payload once, only after an all-absent preflight", async () => {
    const harness = makeDeps();
    expect(await main([...EL_ARGS, "--apply"], SAFE_ENV, harness.deps)).toBe(0);
    expect(harness.deploy).toHaveBeenCalledTimes(1);
    expect(harness.deploy).toHaveBeenCalledWith(earthsLayers);
    expect(harness.readDocuments.mock.invocationCallOrder[0]).toBeLessThan(
      harness.deploy.mock.invocationCallOrder[0],
    );
  });

  test("an identical existing revision is a zero-write no-op, even with --apply", async () => {
    const harness = makeDeps({ observations: canonicalObservations() });
    expect(await main([...EL_ARGS, "--apply"], SAFE_ENV, harness.deps)).toBe(0);
    expect(harness.deploy).not.toHaveBeenCalled();
    expect(harness.logs[0]).toContain("state=canonical writes=0");
  });

  test("an existing r1 with different content is never replaced", async () => {
    const drifted = canonicalObservations().map((observation) => ({ ...observation }));
    const revisionData = drifted[1].data as Record<string, unknown>;
    drifted[1] = {
      exists: true,
      data: { ...revisionData, publishedBy: "someone-else" },
    };
    const harness = makeDeps({ observations: drifted });
    expect(await main([...EL_ARGS, "--apply"], SAFE_ENV, harness.deps)).toBe(1);
    expect(harness.deploy).not.toHaveBeenCalled();
  });

  test("a parent assessment that already points at another revision fails closed", async () => {
    const harness = makeDeps({
      observations: [
        {
          exists: true,
          data: {
            assessmentId: EL_ASSESSMENT,
            activityId: "earths-layers",
            currentRevisionId: "assessment_earths-layers__r2",
          },
        },
        absent(),
        absent(),
      ],
    });
    expect(await main([...EL_ARGS, "--apply"], SAFE_ENV, harness.deps)).toBe(1);
    expect(harness.deploy).not.toHaveBeenCalled();
  });
});

describe("repository fidelity verifier wiring", () => {
  // A hermetic stand-in for the app package's assessmentFidelity.cjs so this
  // suite does not depend on the app package's installed dependencies. The
  // real module is exercised against every committed payload by
  // app/scripts/lessonBuilder/__tests__/assessment-fidelity.test.js.
  let root: string;
  beforeEach(() => {
    root = fs.mkdtempSync(join(os.tmpdir(), "stage-fidelity-"));
    fs.mkdirSync(join(root, "app", "scripts", "lessonBuilder"), { recursive: true });
    fs.mkdirSync(join(root, "lesson-sources"));
    fs.writeFileSync(
      join(root, "app", "scripts", "lessonBuilder", "assessmentFidelity.cjs"),
      [
        "module.exports = {",
        "  extractCanonicalQuiz: (html, slug) => ({ questions: JSON.parse(html).questions }),",
        "  checkFidelity: (slug, payload, quiz) =>",
        "    payload.items.length === quiz.questions.length ? [] : [`[${slug}] question count mismatch`],",
        "};",
      ].join("\n"),
    );
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("refuses a lesson with no canonical source", () => {
    const verify = makeRepositoryFidelityVerifier(root);
    expect(() => verify("earths-layers", earthsLayers)).toThrow(
      "canonical lesson source lesson-sources/lesson_earths-layers.html not found",
    );
  });

  test("reports the canonical question count on exact fidelity", () => {
    fs.writeFileSync(
      join(root, "lesson-sources", "lesson_earths-layers.html"),
      JSON.stringify({ questions: new Array(10).fill({}) }),
    );
    expect(makeRepositoryFidelityVerifier(root)("earths-layers", earthsLayers)).toEqual({
      canonicalQuestionCount: 10,
    });
  });

  test("refuses on any fidelity mismatch", () => {
    fs.writeFileSync(
      join(root, "lesson-sources", "lesson_earths-layers.html"),
      JSON.stringify({ questions: new Array(9).fill({}) }),
    );
    expect(() => makeRepositoryFidelityVerifier(root)("earths-layers", earthsLayers)).toThrow(
      /does not match the canonical quiz \(1 mismatch\(es\)\): \[earths-layers\] question count mismatch/,
    );
  });
});
