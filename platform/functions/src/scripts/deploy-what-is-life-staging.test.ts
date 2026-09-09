import * as fs from "fs";
import { join } from "path";
import { Timestamp, type Firestore } from "@google-cloud/firestore";
import {
  Compute,
  DEFAULT_UNIVERSE,
  GoogleAuth,
  IdentityPoolClient,
  Impersonated,
  JWT,
  OAuth2Client,
  UserRefreshClient,
  type ImpersonatedOptions,
} from "google-auth-library";

import whatIsLife from "./assessments/what-is-life.r1.json";
import {
  APPROVED_STAGING_SERVICE_ACCOUNT,
  CANONICAL_ASSESSMENT_ID,
  CANONICAL_REVISION_ID,
  FIRESTORE_OAUTH_SCOPE,
  IMPERSONATED_TOKEN_LIFETIME_SECONDS,
  ImpersonationCredentialError,
  STANDARD_FIRESTORE_SERVICE_PATH,
  STANDARD_IAM_CREDENTIALS_ENDPOINT,
  STAGING_IMPERSONATION_FAILED,
  STAGING_PREFLIGHT_READ_FAILED,
  STAGING_PROJECT_ID,
  STAGING_SOURCE_ADC_REJECTED,
  SourceAdcValidationError,
  acquireStagingImpersonatedCredential,
  canonicalDocumentPaths,
  createDirectStagingFirestore,
  createStagingImpersonatedClient,
  ensureStagingSafe,
  initializeDirectStagingRuntime,
  main,
  parseArgs,
  preflightStagingImpersonation,
  type CliDeps,
  type DocumentObservation,
  type ImpersonatedClientFactory,
} from "./deploy-what-is-life-staging";
import { planAssessmentRevision } from "../assessments/assessment-deployment";

const SAFE_ENV: NodeJS.ProcessEnv = {};
const TOKEN_CANARY = "synthetic-access-token-canary";
const PROVIDER_SECRET_CANARY = "provider-secret-canary";

function authorizedUserClient(): UserRefreshClient {
  return new UserRefreshClient({
    clientId: "synthetic-client-id",
    clientSecret: "synthetic-client-secret",
    refreshToken: "synthetic-refresh-token",
  });
}

function syntheticImpersonatedClient(): Impersonated {
  const client = createStagingImpersonatedClient(authorizedUserClient());
  client.credentials.expiry_date = Date.now() + 900_000;
  client.getAccessToken = jest.fn(() => Promise.resolve({
    token: TOKEN_CANARY,
  }));
  return client;
}

const SYNTHETIC_IMPERSONATED = syntheticImpersonatedClient();

function absent(): DocumentObservation {
  return { exists: false };
}

function canonicalObservations(
  publishedAt: unknown = Timestamp.fromMillis(1_789_000_000_000),
): readonly DocumentObservation[] {
  const plan = planAssessmentRevision(whatIsLife);
  return [
    { exists: true, data: { ...plan.assessmentWrite, futureMetadata: true } },
    { exists: true, data: { ...plan.revisionWrite, publishedAt } },
    { exists: true, data: { ...plan.answerKeyWrite, publishedAt } },
  ];
}

function makeDeps(
  observations: readonly DocumentObservation[] = [absent(), absent(), absent()],
): CliDeps & {
  readonly acquireImpersonatedCredential: jest.Mock;
  readonly deploy: jest.Mock;
  readonly readDocuments: jest.Mock;
  readonly initializeRuntime: jest.Mock;
  readonly logs: string[];
  readonly errors: string[];
} {
  const logs: string[] = [];
  const errors: string[] = [];
  const readDocuments = jest.fn().mockResolvedValue(observations);
  const deploy = jest.fn().mockResolvedValue({
    assessmentId: CANONICAL_ASSESSMENT_ID,
    revisionId: CANONICAL_REVISION_ID,
    revisionOrdinal: 1,
    assessmentCreated: true,
  });
  const initializeRuntime = jest.fn().mockResolvedValue({
    readDocuments,
    deploy,
  });
  const acquireImpersonatedCredential = jest
    .fn()
    .mockResolvedValue(SYNTHETIC_IMPERSONATED);
  return {
    logs,
    errors,
    acquireImpersonatedCredential,
    readCanonicalPayload: () => whatIsLife,
    readDocuments,
    deploy,
    initializeRuntime,
    log: (message) => logs.push(message),
    logError: (message) => errors.push(message),
  };
}

describe("staging-only CLI guard", () => {
  test("accepts the explicit literal staging project and defaults to dry-run", () => {
    expect(parseArgs(["--project=lyfelabz-staging"])).toEqual({
      ok: true,
      args: { project: STAGING_PROJECT_ID, apply: false },
    });
  });

  test.each([
    { argv: [] },
    { argv: ["--project=lyfelabz-prod"] },
    { argv: ["--project=production"] },
    { argv: ["--project=default"] },
  ])("missing, production, and alias projects are rejected: $argv", async ({ argv }) => {
    const deps = makeDeps();
    expect(await main(argv, SAFE_ENV, deps)).toBe(2);
    expect(deps.acquireImpersonatedCredential).not.toHaveBeenCalled();
    expect(deps.readDocuments).not.toHaveBeenCalled();
    expect(deps.deploy).not.toHaveBeenCalled();
  });

  test.each([
    ["duplicate project", ["--project=lyfelabz-staging", "--project=lyfelabz-staging"]],
    ["duplicate apply", ["--project=lyfelabz-staging", "--apply", "--apply"]],
    ["malformed project", ["--project"]],
    ["unknown flag", ["--project=lyfelabz-staging", "--target=staging"]],
    ["target override", ["--project=lyfelabz-staging", "--impersonate-service-account=other@example.invalid"]],
  ])("rejects %s CLI input", (_label, argv) => {
    expect(parseArgs(argv)).toMatchObject({ ok: false });
  });

  test.each(["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"] as const)(
    "rejects conflicting %s",
    (key) => {
      expect(
        ensureStagingSafe(
          { project: STAGING_PROJECT_ID, apply: false },
          { [key]: "lyfelabz-prod" },
        ),
      ).toContain(key);
    },
  );

  test.each([
    "FIRESTORE_EMULATOR_HOST",
    "FIREBASE_AUTH_EMULATOR_HOST",
    "FIREBASE_DATABASE_EMULATOR_HOST",
    "FIREBASE_EMULATOR_HUB",
  ] as const)("rejects emulator override %s", (key) => {
    expect(
      ensureStagingSafe(
        { project: STAGING_PROJECT_ID, apply: false },
        { [key]: "127.0.0.1:9999" },
      ),
    ).toContain(key);
  });

  test.each([
    ["GOOGLE_APPLICATION_CREDENTIALS", ""],
    ["GOOGLE_APPLICATION_CREDENTIALS", "/synthetic/key.json"],
    ["google_application_credentials", ""],
    ["google_application_credentials", "/synthetic/key.json"],
  ] as const)(
    "rejects credential discovery override %s (%#)",
    (key, value) => {
      expect(
        ensureStagingSafe(
          { project: STAGING_PROJECT_ID, apply: false },
          { [key]: value },
        ),
      ).toContain(key);
    },
  );

  test.each([
    "GOOGLE_APPLICATION_CREDENTIALS",
    "google_application_credentials",
  ] as const)("rejects %s before source ADC discovery", async (key) => {
    const deps = makeDeps();
    expect(
      await main(
        ["--project=lyfelabz-staging"],
        { [key]: "/synthetic/credential.json" },
        deps,
      ),
    ).toBe(2);
    expect(deps.acquireImpersonatedCredential).not.toHaveBeenCalled();
    expect(deps.initializeRuntime).not.toHaveBeenCalled();
    expect(deps.readDocuments).not.toHaveBeenCalled();
  });
});

describe("authorized-user ADC impersonation", () => {
  test("accepts authorized-user ADC and fixes target, scope, delegates, and lifetime", () => {
    const optionsSeen: ImpersonatedOptions[] = [];
    const source = authorizedUserClient();
    const factory: ImpersonatedClientFactory = (options) => {
      optionsSeen.push(options);
      return new Impersonated(options);
    };

    const client = createStagingImpersonatedClient(
      source,
      factory,
    );
    expect(optionsSeen).toEqual([
      expect.objectContaining({
        sourceClient: expect.any(UserRefreshClient),
        targetPrincipal: APPROVED_STAGING_SERVICE_ACCOUNT,
        targetScopes: [FIRESTORE_OAUTH_SCOPE],
        delegates: [],
        lifetime: IMPERSONATED_TOKEN_LIFETIME_SECONDS,
        universeDomain: DEFAULT_UNIVERSE,
        endpoint: STANDARD_IAM_CREDENTIALS_ENDPOINT,
      }),
    ]);
    expect(client.getTargetPrincipal()).toBe(APPROVED_STAGING_SERVICE_ACCOUNT);
    expect(optionsSeen[0]?.sourceClient).toBe(source);
  });

  test.each([
    ["service account", new JWT()],
    ["external account", new IdentityPoolClient({
      type: "external_account",
      audience:
        "//iam.googleapis.com/projects/123/locations/global/" +
        "workloadIdentityPools/pool/providers/provider",
      subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
      token_url: "https://sts.googleapis.com/v1/token",
      credential_source: { file: "/synthetic/never-read" },
    })],
    ["compute", new Compute()],
    ["generic OAuth", new OAuth2Client()],
  ])("rejects %s source credentials before impersonation", (_label, source) => {
    const factory = jest.fn();
    expect(() =>
      createStagingImpersonatedClient(source, factory),
    ).toThrow(SourceAdcValidationError);
    expect(factory).not.toHaveBeenCalled();
  });

  test("accepts an authorized_user client produced by the installed GoogleAuth parser", () => {
    const source = new GoogleAuth().fromJSON({
      type: "authorized_user",
      client_id: "synthetic-client-id",
      client_secret: "synthetic-client-secret",
      refresh_token: "synthetic-refresh-token",
    });
    expect(source).toBeInstanceOf(UserRefreshClient);
    expect(() => createStagingImpersonatedClient(source)).not.toThrow();
  });

  test("rejects malicious authorized_user universe metadata before construction", () => {
    const source = new GoogleAuth().fromJSON({
      type: "authorized_user",
      client_id: "synthetic-client-id",
      client_secret: "synthetic-client-secret",
      refresh_token: "synthetic-refresh-token",
      universe_domain: "attacker.invalid",
    });
    const factory = jest.fn();
    expect(source).toBeInstanceOf(UserRefreshClient);
    expect(source.universeDomain).toBe("attacker.invalid");
    expect(() => createStagingImpersonatedClient(source, factory)).toThrow(
      SourceAdcValidationError,
    );
    expect(factory).not.toHaveBeenCalled();
  });

  test("the installed Impersonated client can request only the fixed Google IAM endpoint", async () => {
    const source = authorizedUserClient();
    const sourceAccess = jest.fn(() => Promise.resolve({
      token: "synthetic-source-token",
    }));
    source.getAccessToken = sourceAccess;
    const sourceRequest = jest.spyOn(source, "request").mockResolvedValue({
      data: {
        accessToken: TOKEN_CANARY,
        expireTime: new Date(Date.now() + 900_000).toISOString(),
      },
    } as never);
    const client = createStagingImpersonatedClient(source);

    await expect(preflightStagingImpersonation(client)).resolves.toBeUndefined();
    expect(sourceAccess).toHaveBeenCalledTimes(1);
    expect(sourceRequest).toHaveBeenCalledWith(expect.objectContaining({
      method: "POST",
      url:
        `${STANDARD_IAM_CREDENTIALS_ENDPOINT}/v1/projects/-/serviceAccounts/` +
        `${APPROVED_STAGING_SERVICE_ACCOUNT}:generateAccessToken`,
      data: {
        delegates: [],
        scope: [FIRESTORE_OAUTH_SCOPE],
        lifetime: `${String(IMPERSONATED_TOKEN_LIFETIME_SECONDS)}s`,
      },
    }));
    expect(JSON.stringify(sourceRequest.mock.calls)).not.toContain("attacker.invalid");
  });

  test("verifies the short-lived impersonated token before returning the credential", async () => {
    const client = syntheticImpersonatedClient();
    const getAccessToken = client.getAccessToken as jest.Mock;
    const acquired = await acquireStagingImpersonatedCredential(
      () => Promise.resolve(authorizedUserClient()),
      () => client,
    );
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(acquired).toBe(client);
  });

  test("sanitizes source ADC discovery failure", async () => {
    await expect(
      acquireStagingImpersonatedCredential(() =>
        Promise.reject(new Error(`ADC load failed ${PROVIDER_SECRET_CANARY}`)),
      ),
    ).rejects.toThrow(STAGING_SOURCE_ADC_REJECTED);
  });

  test.each([
    ["provider rejection", () => Promise.reject(new Error(PROVIDER_SECRET_CANARY)), Date.now() + 900_000],
    ["missing token", () => Promise.resolve({ token: null }), Date.now() + 900_000],
    ["expired token", () => Promise.resolve({ token: TOKEN_CANARY }), Date.now() - 1],
  ])("sanitizes %s", async (_label, getAccessToken, expiry) => {
    const client = createStagingImpersonatedClient(authorizedUserClient());
    client.credentials.expiry_date = expiry;
    Object.defineProperty(client, "getAccessToken", { value: getAccessToken });
    let rendered = "";
    try {
      await preflightStagingImpersonation(client);
    } catch (err) {
      rendered = String(err);
    }
    expect(rendered).toContain(STAGING_IMPERSONATION_FAILED);
    expect(rendered).not.toContain(PROVIDER_SECRET_CANARY);
    expect(rendered).not.toContain(TOKEN_CANARY);
  });

  test("environment values cannot redirect the fixed impersonation target", async () => {
    const deps = makeDeps();
    const env = {
      GOOGLE_IMPERSONATE_SERVICE_ACCOUNT: "production@example.invalid",
      CLOUDSDK_AUTH_IMPERSONATE_SERVICE_ACCOUNT: "other@example.invalid",
    };
    expect(await main(["--project=lyfelabz-staging"], env, deps)).toBe(0);
    expect(deps.acquireImpersonatedCredential).toHaveBeenCalledTimes(1);
  });

  test("the acquired impersonated client is the exact runtime initializer input", async () => {
    const deps = makeDeps();
    expect(await main(["--project=lyfelabz-staging"], SAFE_ENV, deps)).toBe(0);
    expect(deps.initializeRuntime).toHaveBeenCalledWith(SYNTHETIC_IMPERSONATED);
  });

  test.each([
    [new SourceAdcValidationError(), STAGING_SOURCE_ADC_REJECTED],
    [new ImpersonationCredentialError(), STAGING_IMPERSONATION_FAILED],
    [new Error(PROVIDER_SECRET_CANARY), STAGING_IMPERSONATION_FAILED],
  ])("authentication failure is classified and --apply remains unreachable", async (error, expected) => {
    const deps = makeDeps();
    deps.acquireImpersonatedCredential.mockRejectedValue(error);
    expect(
      await main(["--project=lyfelabz-staging", "--apply"], SAFE_ENV, deps),
    ).toBe(2);
    expect(deps.errors).toEqual([expected]);
    expect(JSON.stringify(deps.errors)).not.toContain(PROVIDER_SECRET_CANARY);
    expect(deps.initializeRuntime).not.toHaveBeenCalled();
    expect(deps.readDocuments).not.toHaveBeenCalled();
    expect(deps.deploy).not.toHaveBeenCalled();
  });

  test("wrapper source contains no private-key credential reader or cert adapter", () => {
    const source = fs.readFileSync(
      join(__dirname, "deploy-what-is-life-staging.ts"),
      "utf8",
    );
    expect(source).not.toMatch(/createPrivateKey|private_key|privateKey|\bcert\s*\(/);
    expect(source).not.toMatch(/readCredentialFile/);
    expect(source).not.toMatch(/firebase-admin\/app|initializeApp|getFirestore/);
  });
});

describe("canonical deployment preparation", () => {
  test("dry-run reads only the three canonical paths and performs zero writes", async () => {
    const deps = makeDeps();
    expect(await main(["--project=lyfelabz-staging"], SAFE_ENV, deps)).toBe(0);
    expect(deps.readDocuments).toHaveBeenCalledWith([
      `assessments/${CANONICAL_ASSESSMENT_ID}`,
      `assessmentRevisions/${CANONICAL_REVISION_ID}`,
      `assessmentAnswerKeys/${CANONICAL_REVISION_ID}`,
    ]);
    expect(deps.deploy).not.toHaveBeenCalled();
    expect(deps.logs[0]).toContain("writes=0");
  });

  test.each([
    ["dry-run", []],
    ["apply", ["--apply"]],
  ])("sanitizes initial Firestore read failure in %s mode", async (_label, modeArgs) => {
    const deps = makeDeps();
    deps.readDocuments.mockRejectedValue(
      new Error(`upstream SDK detail ${PROVIDER_SECRET_CANARY} ${TOKEN_CANARY}`),
    );

    const code = await main(
      ["--project=lyfelabz-staging", ...modeArgs],
      SAFE_ENV,
      deps,
    );
    expect(code).toBe(1);
    expect(deps.errors).toEqual([STAGING_PREFLIGHT_READ_FAILED]);
    expect(deps.logs).toEqual([]);
    expect(deps.deploy).not.toHaveBeenCalled();
    expect(JSON.stringify(deps.errors)).not.toContain(PROVIDER_SECRET_CANARY);
    expect(JSON.stringify(deps.errors)).not.toContain(TOKEN_CANARY);
  });

  test("canonical identity and answer-key linkage come from the shared plan", () => {
    const plan = planAssessmentRevision(whatIsLife);
    expect(plan.assessmentId).toBe(CANONICAL_ASSESSMENT_ID);
    expect(plan.input.activityId).toBe("what-is-life");
    expect(plan.input.revisionOrdinal).toBe(1);
    expect(plan.revisionId).toBe(CANONICAL_REVISION_ID);
    expect(plan.answerKeyWrite.assessmentId).toBe(plan.assessmentId);
    expect(plan.answerKeyWrite.revisionOrdinal).toBe(plan.input.revisionOrdinal);
    expect(plan.answerKeyWrite.items).toHaveLength(plan.revisionWrite.items.length);
    expect(canonicalDocumentPaths(plan)[2]).toBe(
      `assessmentAnswerKeys/${CANONICAL_REVISION_ID}`,
    );
  });

  test("apply invokes the certified deployer only after an all-absent preflight", async () => {
    const deps = makeDeps();
    expect(
      await main(["--project=lyfelabz-staging", "--apply"], SAFE_ENV, deps),
    ).toBe(0);
    expect(deps.deploy).toHaveBeenCalledTimes(1);
    expect(deps.deploy).toHaveBeenCalledWith(whatIsLife);
  });

  test("equal canonical artifacts are an idempotent zero-write no-op", async () => {
    const deps = makeDeps(canonicalObservations());
    expect(
      await main(["--project=lyfelabz-staging", "--apply"], SAFE_ENV, deps),
    ).toBe(0);
    expect(deps.deploy).not.toHaveBeenCalled();
    expect(deps.logs[0]).toContain("state=canonical writes=0");
  });

  test.each([
    false,
    0,
    "invalid",
    {},
    { seconds: 1, nanoseconds: 0 },
    { toMillis: () => 1_000 },
    { seconds: "1", nanoseconds: -1, toMillis: () => 1_000 },
  ])("rejects incompatible publishedAt value %#", async (publishedAt) => {
    const deps = makeDeps(canonicalObservations(publishedAt));
    expect(
      await main(["--project=lyfelabz-staging", "--apply"], SAFE_ENV, deps),
    ).toBe(1);
    expect(deps.deploy).not.toHaveBeenCalled();
  });

  test("accepts any genuine Firestore Timestamp instant as a zero-write no-op", async () => {
    const deps = makeDeps(canonicalObservations(Timestamp.fromDate(
      new Date("2042-03-04T05:06:07.890Z"),
    )));
    expect(
      await main(["--project=lyfelabz-staging", "--apply"], SAFE_ENV, deps),
    ).toBe(0);
    expect(deps.deploy).not.toHaveBeenCalled();
  });

  test("partial or incompatible existing state fails closed", async () => {
    const partial = makeDeps([absent(), canonicalObservations()[1], absent()]);
    expect(
      await main(["--project=lyfelabz-staging", "--apply"], SAFE_ENV, partial),
    ).toBe(1);
    expect(partial.deploy).not.toHaveBeenCalled();

    const incompatible = canonicalObservations().map((observation) => ({
      ...observation,
      data: observation.data ? { ...observation.data } : undefined,
    }));
    (incompatible[0].data as Record<string, unknown>).activityId = "other";
    const conflict = makeDeps(incompatible);
    expect(
      await main(["--project=lyfelabz-staging", "--apply"], SAFE_ENV, conflict),
    ).toBe(1);
    expect(conflict.deploy).not.toHaveBeenCalled();
  });
});

describe("direct Firestore impersonated-auth binding", () => {
  test("binds the fixed project and exact impersonated client into Firestore settings", () => {
    const client = syntheticImpersonatedClient();
    const db = { kind: "synthetic-firestore" } as unknown as Firestore;
    const createFirestore = jest.fn((settings: {
      readonly auth: GoogleAuth<Impersonated>;
      readonly projectId?: string;
      readonly universeDomain?: string;
      readonly servicePath?: string;
    }) => {
      expect(settings).toMatchObject({
        projectId: STAGING_PROJECT_ID,
        universeDomain: DEFAULT_UNIVERSE,
        servicePath: STANDARD_FIRESTORE_SERVICE_PATH,
      });
      expect(settings.auth.cachedCredential).toBe(client);
      return db;
    });

    expect(createDirectStagingFirestore(client, createFirestore)).toBe(db);
    expect(createFirestore).toHaveBeenCalledTimes(1);
    expect(createFirestore.mock.calls[0][0].auth).toBeInstanceOf(GoogleAuth);
  });

  test("the installed Firestore/GAX boundary uses the supplied auth and creates no replacement GoogleAuth", async () => {
    const client = syntheticImpersonatedClient();
    const db = createDirectStagingFirestore(client);
    type InspectableFirestore = Firestore & {
      readonly _settings: {
        readonly auth: GoogleAuth<Impersonated>;
        readonly projectId: string;
        readonly universeDomain: string;
        readonly servicePath: string;
      };
      readonly _clientPool: {
        acquire: (tag: string, requiresGrpc: boolean) => {
          readonly auth: GoogleAuth<Impersonated>;
          readonly apiEndpoint: string;
          readonly universeDomain: string;
        };
        release: (tag: string, client: unknown) => Promise<void>;
      };
    };
    const internal = db as InspectableFirestore;
    expect((db as unknown as { readonly projectId: string }).projectId).toBe(
      STAGING_PROJECT_ID,
    );
    expect(internal._settings.auth.cachedCredential).toBe(client);
    expect(internal._settings.universeDomain).toBe(DEFAULT_UNIVERSE);
    expect(internal._settings.servicePath).toBe(STANDARD_FIRESTORE_SERVICE_PATH);

    const gapicClient = internal._clientPool.acquire("astra-004", false);
    expect(gapicClient.auth).toBe(internal._settings.auth);
    expect(gapicClient.auth.cachedCredential).toBe(client);
    await expect(gapicClient.auth.getClient()).resolves.toBe(client);
    expect(gapicClient.apiEndpoint).toBe(STANDARD_FIRESTORE_SERVICE_PATH);
    expect(gapicClient.universeDomain).toBe(DEFAULT_UNIVERSE);
    await internal._clientPool.release("astra-004", gapicClient);
    await db.terminate();
  });

  test("the runtime gives deployAssessmentRevision the exact direct Firestore instance", async () => {
    const db = {
      doc: jest.fn(),
      getAll: jest.fn(),
    } as unknown as Firestore;
    const deployAssessment = jest.fn().mockResolvedValue({
      assessmentId: CANONICAL_ASSESSMENT_ID,
      revisionId: CANONICAL_REVISION_ID,
      revisionOrdinal: 1,
      assessmentCreated: true,
    });
    const runtime = initializeDirectStagingRuntime(SYNTHETIC_IMPERSONATED, {
      createFirestore: () => db,
      deployAssessment,
    });
    const payload = { synthetic: true };

    await expect(runtime.deploy(payload)).resolves.toMatchObject({
      revisionId: CANONICAL_REVISION_ID,
    });
    expect(deployAssessment).toHaveBeenCalledWith(payload, db);
  });

  test("main stops before reads or mutation when direct Firestore initialization fails", async () => {
    const base = makeDeps();
    const deps: CliDeps = {
      ...base,
      initializeRuntime: () => Promise.reject(new Error(PROVIDER_SECRET_CANARY)),
    };

    expect(
      await main(["--project=lyfelabz-staging", "--apply"], SAFE_ENV, deps),
    ).toBe(1);
    expect(base.errors).toEqual(["staging runtime initialization failed"]);
    expect(JSON.stringify(base.errors)).not.toContain(PROVIDER_SECRET_CANARY);
    expect(base.readDocuments).not.toHaveBeenCalled();
    expect(base.deploy).not.toHaveBeenCalled();
  });
});
