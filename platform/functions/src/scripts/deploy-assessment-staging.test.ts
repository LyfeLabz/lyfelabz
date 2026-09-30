import * as fs from "fs";
import * as os from "os";
import { join } from "path";
import { Timestamp } from "@google-cloud/firestore";
import { UserRefreshClient, type Impersonated } from "google-auth-library";

import earthsLayers from "./assessments/earths-layers.r1.json";
import earthsLayersR2 from "./assessments/earths-layers.r2.json";
import whatIsLife from "./assessments/what-is-life.r1.json";
import {
  LessonResolutionError,
  STAGING_PROJECT_ID,
  assertLessonPlanIdentity,
  classifyExistingState,
  committedPayloadDirectory,
  createStagingImpersonatedClient,
  ensureStagingSafe,
  main,
  makeRepositoryFidelityVerifier,
  makeRepositoryLessonResolver,
  parseArgs,
  repoRootFromCompiled,
  resolveCommittedLessonPayload,
  revisionDisplaySource,
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
      args: { project: STAGING_PROJECT_ID, lesson: "earths-layers", apply: false, assessmentRevisionId: null },
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

  test("the real repository resolver finds what-is-life r1 and refuses an unknown lesson", () => {
    const resolve = makeRepositoryLessonResolver(repoRootFromCompiled());
    const result = resolve("what-is-life", null);
    expect(result.fileName).toBe("what-is-life.r1.json");
    expect(result.revisionOrdinal).toBe(1);
    expect(result.payload).toEqual(whatIsLife);
    expect(() => resolve("no-such-lesson", null)).toThrow(/unknown lesson/);
  });

  // Earth's Layers r2 authoring (2026-09-28): the first lesson with two
  // committed revisions. This lesson-level deployer resolves exactly one
  // committed payload per lesson, so it fails closed for Earth's Layers
  // rather than guessing a revision. Deploying r2 to staging needs a
  // revision-explicit deploy path first (owner decision; not part of the
  // local authoring pass).
  test("without a named revision, the real repository resolver refuses Earth's Layers (r1 + r2 committed) as ambiguous", () => {
    const resolve = makeRepositoryLessonResolver(repoRootFromCompiled());
    expect(() => resolve("earths-layers", null)).toThrow(LessonResolutionError);
    expect(() => resolve("earths-layers", null)).toThrow(
      "ambiguous lesson 'earths-layers': expected exactly one committed earths-layers.r<N>.json, found [earths-layers.r1.json, earths-layers.r2.json]; " +
        "name the revision to deploy with --assessment-revision=assessment_earths-layers__r<N>",
    );
  });

  test("every single-revision payload resolves uniquely and plans to its own identity; only Earth's Layers and Water Cycle have several", () => {
    const repoRoot = repoRootFromCompiled();
    const resolve = makeRepositoryLessonResolver(repoRoot);
    const all = fs
      .readdirSync(committedPayloadDirectory(repoRoot))
      .filter((fileName) => fileName.endsWith(".json"))
      .map((fileName) => fileName.replace(/\.r\d+\.json$/, ""));
    const multi = [...new Set(all.filter((slug, i) => all.indexOf(slug) !== i))];
    expect(multi).toEqual(["earths-layers", "water-cycle"]);
    const slugs = all.filter((slug) => !multi.includes(slug));
    expect(slugs.length).toBeGreaterThanOrEqual(47);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) {
      const result = resolve(slug, null);
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
    expect(harness.resolveLessonPayload).toHaveBeenCalledWith("earths-layers", null);
    expect(harness.verifyFidelity).toHaveBeenCalledWith("earths-layers", earthsLayers, EL_REVISION);
    expect(harness.readDocuments).toHaveBeenCalledTimes(1);
    expect(harness.readDocuments).toHaveBeenCalledWith([
      `assessments/${EL_ASSESSMENT}`,
      `assessmentRevisions/${EL_REVISION}`,
      `assessmentAnswerKeys/${EL_REVISION}`,
    ]);
    expect(harness.deploy).not.toHaveBeenCalled();
    expect(harness.logs).toEqual([
      `dry-run ok lesson=earths-layers file=earths-layers.r1.json assessment=${EL_ASSESSMENT} ` +
        `revision=${EL_REVISION} items=10 answerKeyItems=10 fidelity=exact selection=single-revision state=absent writes=0 target=staging`,
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
    writeTable({ "earths-layers": { [EL_REVISION]: "/app/lessons/lesson_earths-layers.html" } });
  });
  function writeTable(lessons: Record<string, Record<string, string>>): void {
    fs.mkdirSync(join(root, "app", "lessons", "assessment-revisions"), { recursive: true });
    fs.writeFileSync(
      join(root, "app", "lessons", "assessment-revisions", "revision-paths.json"),
      JSON.stringify({ schemaVersion: 1, kind: "lyfelabz.assessmentRevisionPaths", lessons }),
    );
  }
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("refuses a lesson with no canonical source", () => {
    const verify = makeRepositoryFidelityVerifier(root);
    expect(() => verify("earths-layers", earthsLayers, EL_REVISION)).toThrow(
      "canonical lesson source lesson-sources/lesson_earths-layers.html not found",
    );
  });

  test("reports the canonical question count on exact fidelity", () => {
    fs.writeFileSync(
      join(root, "lesson-sources", "lesson_earths-layers.html"),
      JSON.stringify({ questions: new Array(10).fill({}) }),
    );
    expect(makeRepositoryFidelityVerifier(root)("earths-layers", earthsLayers, EL_REVISION)).toEqual({
      canonicalQuestionCount: 10,
    });
  });

  test("refuses on any fidelity mismatch", () => {
    fs.writeFileSync(
      join(root, "lesson-sources", "lesson_earths-layers.html"),
      JSON.stringify({ questions: new Array(9).fill({}) }),
    );
    expect(() => makeRepositoryFidelityVerifier(root)("earths-layers", earthsLayers, EL_REVISION)).toThrow(
      /does not match the canonical quiz \(1 mismatch\(es\)\): \[earths-layers\] question count mismatch/,
    );
  });

  // Earth's Layers r2 (R2-D5): a multi-revision lesson checks each revision
  // against the rendition the table maps it to, never the mutable source.
  test("a multi-revision lesson checks the selected revision against its own rendition", () => {
    const R2 = "assessment_earths-layers__r2";
    writeTable({
      "earths-layers": {
        [EL_REVISION]: "/app/lessons/assessment-revisions/lesson_earths-layers__r1.html",
        [R2]: "/app/lessons/assessment-revisions/lesson_earths-layers__r2.html",
      },
    });
    fs.writeFileSync(join(root, "lesson-sources", "lesson_earths-layers.html"), JSON.stringify({ questions: [] }));
    const dir = join(root, "app", "lessons", "assessment-revisions");
    fs.writeFileSync(join(dir, "lesson_earths-layers__r1.html"), JSON.stringify({ questions: new Array(10).fill({}) }));
    const verify = makeRepositoryFidelityVerifier(root);
    expect(verify("earths-layers", earthsLayers, EL_REVISION)).toEqual({ canonicalQuestionCount: 10 });
    expect(() => verify("earths-layers", earthsLayersR2, R2)).toThrow(
      "revision page app/lessons/assessment-revisions/lesson_earths-layers__r2.html not found",
    );
    fs.writeFileSync(join(dir, "lesson_earths-layers__r2.html"), JSON.stringify({ questions: new Array(9).fill({}) }));
    expect(() => verify("earths-layers", earthsLayersR2, R2)).toThrow(/does not match the canonical quiz/);
  });

  test("a revision with no table page, or an unexpected page, is refused", () => {
    writeTable({ "earths-layers": { [EL_REVISION]: "https://example.com/x.html" } });
    expect(() => makeRepositoryFidelityVerifier(root)("earths-layers", earthsLayers, EL_REVISION)).toThrow("unexpected page");
    expect(() => makeRepositoryFidelityVerifier(root)("earths-layers", earthsLayers, "assessment_earths-layers__r3")).toThrow(
      "the committed revision-path table has no page for assessment_earths-layers__r3",
    );
    fs.rmSync(join(root, "app", "lessons", "assessment-revisions", "revision-paths.json"));
    expect(() => makeRepositoryFidelityVerifier(root)("earths-layers", earthsLayers, EL_REVISION)).toThrow("revision-path table");
  });
});

// Earth's Layers r2 (owner ruling R2-D5): explicit revision selection. The
// revision id is the repository's own `assessment_<slug>__r<N>`; there is no
// "latest" or "current" default, no ordinal guessing, and no fallback.
describe("explicit assessment revision (--assessment-revision)", () => {
  const EL_R2 = "assessment_earths-layers__r2";
  const elResolver = () => makeRepositoryLessonResolver(repoRootFromCompiled());
  const withRev = (id: string) => [...EL_ARGS, `--assessment-revision=${id}`];

  test("parses only a well-formed revision id of the named lesson", () => {
    expect(parseArgs(withRev(EL_R2))).toEqual({
      ok: true,
      args: { project: STAGING_PROJECT_ID, lesson: "earths-layers", apply: false, assessmentRevisionId: EL_R2 },
    });
    expect(parseArgs([...withRev(EL_REVISION), "--apply"])).toMatchObject({ ok: true, args: { apply: true, assessmentRevisionId: EL_REVISION } });
  });

  test.each([
    ["an empty id", ""],
    ["a bare ordinal", "2"],
    ["a short form", "r2"],
    ["a leading-zero ordinal", "assessment_earths-layers__r02"],
    ["ordinal zero", "assessment_earths-layers__r0"],
    ["a missing ordinal", "assessment_earths-layers__r"],
    ["a file name", "earths-layers.r2.json"],
    ["surrounding whitespace", " assessment_earths-layers__r2"],
    ["a case variant", "Assessment_earths-layers__r2"],
    ["a latest alias", "latest"],
    ["a current alias", "current"],
  ])("refuses %s while parsing, before resolution or remote access", async (_label, id) => {
    expect(parseArgs(withRev(id))).toMatchObject({ ok: false });
    const harness = makeDeps();
    expect(await main([...withRev(id), "--apply"], SAFE_ENV, harness.deps)).toBe(2);
    expect(harness.resolveLessonPayload).not.toHaveBeenCalled();
    expectNoRemoteAccess(harness);
  });

  test("refuses another lesson's revision while parsing", async () => {
    expect(parseArgs(withRev("assessment_what-is-life__r1"))).toEqual({
      ok: false,
      message: "refusing --assessment-revision assessment_what-is-life__r1: it belongs to lesson 'what-is-life', not 'earths-layers'",
    });
    const harness = makeDeps();
    expect(await main([...withRev("assessment_what-is-life__r1"), "--apply"], SAFE_ENV, harness.deps)).toBe(2);
    expect(harness.resolveLessonPayload).not.toHaveBeenCalled();
    expectNoRemoteAccess(harness);
  });

  test("refuses a duplicated flag", () => {
    expect(parseArgs([...withRev(EL_R2), `--assessment-revision=${EL_R2}`])).toMatchObject({
      ok: false,
      message: "--assessment-revision may be supplied only once",
    });
  });

  test("resolves exactly the named committed revision: r1 and r2 of Earth's Layers", () => {
    const r1 = elResolver()("earths-layers", 1);
    expect(r1).toMatchObject({ slug: "earths-layers", revisionOrdinal: 1, fileName: "earths-layers.r1.json" });
    expect(r1.payload).toEqual(earthsLayers);
    const r2 = elResolver()("earths-layers", 2);
    expect(r2).toMatchObject({ slug: "earths-layers", revisionOrdinal: 2, fileName: "earths-layers.r2.json" });
    expect(r2.payload).toEqual(earthsLayersR2);
    expect(planAssessmentRevision(r1.payload).revisionId).toBe(EL_REVISION);
    expect(planAssessmentRevision(r2.payload).revisionId).toBe(EL_R2);
  });

  test("a revision that is not committed is refused", () => {
    expect(() => elResolver()("earths-layers", 3)).toThrow(
      "revision assessment_earths-layers__r3 is not a committed revision of 'earths-layers' (committed: [earths-layers.r1.json, earths-layers.r2.json])",
    );
    expect(() => elResolver()("what-is-life", 2)).toThrow("is not a committed revision of 'what-is-life'");
  });

  test("a single-revision lesson resolves the same with or without the explicit id", () => {
    expect(elResolver()("what-is-life", 1)).toEqual(elResolver()("what-is-life", null));
  });

  test("the resolver still refuses strays and malformed ordinals with an explicit revision", () => {
    const io = (files: Record<string, string>) => ({ listPayloadFiles: () => Object.keys(files), readPayloadFile: (f: string) => files[f] });
    const el = JSON.stringify(earthsLayers);
    expect(() => resolveCommittedLessonPayload("earths-layers", io({ "earths-layers.r1.json": el, "earths-layers.r1.json.bak": el }), 1)).toThrow(/ambiguous/);
    expect(() => resolveCommittedLessonPayload("earths-layers", io({ "earths-layers.r1.json": el }), 0)).toThrow(/malformed requested revision/);
    expect(() => resolveCommittedLessonPayload("earths-layers", io({ "earths-layers.r1.json": el }), 1.5)).toThrow(/malformed requested revision/);
  });

  test("the committed table maps each Earth's Layers revision to its own rendition, and a single-revision lesson to its source", () => {
    const root = repoRootFromCompiled();
    expect(revisionDisplaySource(root, "earths-layers", EL_REVISION)).toBe("app/lessons/assessment-revisions/lesson_earths-layers__r1.html");
    expect(revisionDisplaySource(root, "earths-layers", EL_R2)).toBe("app/lessons/assessment-revisions/lesson_earths-layers__r2.html");
    expect(revisionDisplaySource(root, "what-is-life", "assessment_what-is-life__r1")).toBe("lesson-sources/lesson_what-is-life.html");
    expect(() => revisionDisplaySource(root, "earths-layers", "assessment_earths-layers__r3")).toThrow("has no page");
  });

  test("main without a revision refuses Earth's Layers with an operator error, before any remote access", async () => {
    const harness = makeDeps({ resolve: (slug, ordinal) => elResolver()(slug, ordinal) });
    expect(await main([...EL_ARGS, "--apply"], SAFE_ENV, harness.deps)).toBe(2);
    expect(harness.errors[0]).toContain("name the revision to deploy with --assessment-revision=assessment_earths-layers__r<N>");
    expectNoRemoteAccess(harness);
  });

  test("main refuses an uncommitted revision before any remote access", async () => {
    const harness = makeDeps({ resolve: (slug, ordinal) => elResolver()(slug, ordinal) });
    expect(await main([...withRev("assessment_earths-layers__r3"), "--apply"], SAFE_ENV, harness.deps)).toBe(2);
    expect(harness.errors[0]).toContain("is not a committed revision");
    expectNoRemoteAccess(harness);
  });

  test("main refuses a resolver that returns a different revision than requested", async () => {
    const harness = makeDeps({ resolve: () => resolved() });
    expect(await main([...withRev(EL_R2)], SAFE_ENV, harness.deps)).toBe(2);
    expect(harness.errors[0]).toContain("not the requested assessment_earths-layers__r2");
    expectNoRemoteAccess(harness);
  });

  test("r1 selected explicitly: dry-run reads exactly the r1 documents and writes nothing", async () => {
    const harness = makeDeps({ resolve: (slug, ordinal) => elResolver()(slug, ordinal) });
    expect(await main(withRev(EL_REVISION), SAFE_ENV, harness.deps)).toBe(0);
    expect(harness.resolveLessonPayload).toHaveBeenCalledWith("earths-layers", 1);
    expect(harness.verifyFidelity).toHaveBeenCalledWith("earths-layers", earthsLayers, EL_REVISION);
    expect(harness.readDocuments).toHaveBeenCalledWith([
      `assessments/${EL_ASSESSMENT}`,
      `assessmentRevisions/${EL_REVISION}`,
      `assessmentAnswerKeys/${EL_REVISION}`,
    ]);
    expect(harness.deploy).not.toHaveBeenCalled();
    expect(harness.logs[0]).toContain("file=earths-layers.r1.json");
    expect(harness.logs[0]).toContain("selection=explicit");
  });

  test("r2 selected explicitly over a parent at r1: dry-run plans an advance and writes nothing; --apply deploys exactly r2 once", async () => {
    const r1Plan = planAssessmentRevision(earthsLayers);
    const parentAtR1: DocumentObservation = { exists: true, data: { ...r1Plan.assessmentWrite } };
    const observations = [parentAtR1, absent(), absent()];
    const dry = makeDeps({ observations, resolve: (slug, ordinal) => elResolver()(slug, ordinal), verifyFidelity: () => ({ canonicalQuestionCount: 10 }) });
    expect(await main(withRev(EL_R2), SAFE_ENV, dry.deps)).toBe(0);
    expect(dry.readDocuments).toHaveBeenCalledWith([
      `assessments/${EL_ASSESSMENT}`,
      `assessmentRevisions/${EL_R2}`,
      `assessmentAnswerKeys/${EL_R2}`,
    ]);
    expect(dry.verifyFidelity).toHaveBeenCalledWith("earths-layers", earthsLayersR2, EL_R2);
    expect(dry.deploy).not.toHaveBeenCalled();
    expect(dry.logs).toEqual([
      `dry-run ok lesson=earths-layers file=earths-layers.r2.json assessment=${EL_ASSESSMENT} revision=${EL_R2} ` +
        `items=10 answerKeyItems=10 fidelity=exact selection=explicit state=advance from=${EL_REVISION} writes=0 target=staging`,
    ]);
    const apply = makeDeps({ observations, resolve: (slug, ordinal) => elResolver()(slug, ordinal), verifyFidelity: () => ({ canonicalQuestionCount: 10 }) });
    expect(await main([...withRev(EL_R2), "--apply"], SAFE_ENV, apply.deps)).toBe(0);
    expect(apply.deploy).toHaveBeenCalledTimes(1);
    expect(apply.deploy).toHaveBeenCalledWith(earthsLayersR2);
  });

  test("the staging-only protections are unchanged with an explicit revision", async () => {
    for (const argv of [
      ["--project=lyfelabz-prod", "--lesson=earths-layers", `--assessment-revision=${EL_R2}`, "--apply"],
      ["--lesson=earths-layers", `--assessment-revision=${EL_R2}`, "--apply"],
    ]) {
      const harness = makeDeps();
      expect(await main(argv, SAFE_ENV, harness.deps)).toBe(2);
      expect(harness.resolveLessonPayload).not.toHaveBeenCalled();
      expectNoRemoteAccess(harness);
    }
    const env = makeDeps();
    expect(await main([...withRev(EL_R2), "--apply"], { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" }, env.deps)).toBe(2);
    expectNoRemoteAccess(env);
  });
});

describe("preflight classification for a later revision", () => {
  const r1Plan = planAssessmentRevision(earthsLayers);
  const r2Plan = planAssessmentRevision(earthsLayersR2);
  const parent = (currentRevisionId: string, extra: Record<string, unknown> = {}): DocumentObservation => ({
    exists: true,
    data: { assessmentId: EL_ASSESSMENT, activityId: "earths-layers", currentRevisionId, ...extra },
  });
  const present = (data: Record<string, unknown>): DocumentObservation => ({
    exists: true,
    data: { ...data, publishedAt: Timestamp.fromMillis(1) },
  });

  test("r2 over a parent at r1 with r2 absent is an advance", () => {
    expect(classifyExistingState([parent(EL_REVISION), absent(), absent()], r2Plan)).toBe("advance");
  });

  test.each([
    ["the parent already at r2 with r2 absent", [parent("assessment_earths-layers__r2"), absent(), absent()]],
    ["the parent at a higher revision", [parent("assessment_earths-layers__r3"), absent(), absent()]],
    ["the parent of another assessment", [parent("assessment_what-is-life__r1", { assessmentId: "assessment_what-is-life" }), absent(), absent()]],
    ["the parent with another activityId", [parent(EL_REVISION, { activityId: "what-is-life" }), absent(), absent()]],
    ["a malformed current revision", [parent("assessment_earths-layers__r01"), absent(), absent()]],
    ["a foreign current revision", [parent("assessment_what-is-life__r1"), absent(), absent()]],
    ["r2 revision present without its key", [parent(EL_REVISION), present({ ...r2Plan.revisionWrite }), absent()]],
    ["r2 key present without its revision", [parent(EL_REVISION), absent(), present({ ...r2Plan.answerKeyWrite })]],
    ["no parent but a revision", [absent(), present({ ...r2Plan.revisionWrite }), absent()]],
  ])("%s is a conflict", (_label, observations) => {
    expect(classifyExistingState(observations, r2Plan)).toBe("conflict");
  });

  test("a fully deployed r2 is canonical; r1 over a parent at r2 stays a conflict (never re-pointed)", () => {
    expect(classifyExistingState([parent("assessment_earths-layers__r2"), present({ ...r2Plan.revisionWrite }), present({ ...r2Plan.answerKeyWrite })], r2Plan)).toBe("canonical");
    expect(classifyExistingState([parent("assessment_earths-layers__r2"), present({ ...r1Plan.revisionWrite }), present({ ...r1Plan.answerKeyWrite })], r1Plan)).toBe("conflict");
  });
});
