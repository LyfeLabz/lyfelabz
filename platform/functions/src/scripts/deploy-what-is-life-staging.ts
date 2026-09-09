/*
 * ASTRA-004 staging prerequisite: canonical what-is-life assessment.
 *
 * This command is intentionally narrower than the general assessment CLI:
 * it accepts only the literal staging project, reads only the three canonical
 * r1 documents, defaults to a zero-write dry-run, and requires --apply before
 * invoking the certified deployAssessmentRevision transaction.
 */

import * as fs from "fs";
import * as path from "path";
import {
  Firestore,
  Timestamp,
  type Settings as FirestoreSettings,
} from "@google-cloud/firestore";
import {
  DEFAULT_UNIVERSE,
  GoogleAuth,
  Impersonated,
  UserRefreshClient,
  type AuthClient,
  type ImpersonatedOptions,
} from "google-auth-library";

import {
  deployAssessmentRevision,
  planAssessmentRevision,
  type AssessmentDeploymentPlan,
  type AssessmentDeploymentResult,
} from "../assessments/assessment-deployment";

export const STAGING_PROJECT_ID = "lyfelabz-staging";
export const CANONICAL_ACTIVITY_ID = "what-is-life";
export const CANONICAL_ASSESSMENT_ID = "assessment_what-is-life";
export const CANONICAL_REVISION_ID = "assessment_what-is-life__r1";
// Repository-authoritative staging identity used by the staging driver and
// certification runbook. Matching this identity and project is a local
// consistency check only; IAM authorization is proven only by a live staging
// operation.
export const APPROVED_STAGING_SERVICE_ACCOUNT =
  "lyfelabz-staging@appspot.gserviceaccount.com";
export const FIRESTORE_OAUTH_SCOPE =
  "https://www.googleapis.com/auth/datastore";
export const IMPERSONATED_TOKEN_LIFETIME_SECONDS = 900;
export const STANDARD_IAM_CREDENTIALS_ENDPOINT =
  "https://iamcredentials.googleapis.com";
export const STANDARD_FIRESTORE_SERVICE_PATH = "firestore.googleapis.com";
export const STAGING_SOURCE_ADC_REJECTED = "STAGING_SOURCE_ADC_REJECTED";
export const STAGING_IMPERSONATION_FAILED = "STAGING_IMPERSONATION_FAILED";
export const STAGING_PREFLIGHT_READ_FAILED = "STAGING_PREFLIGHT_READ_FAILED";
export const STAGING_DEPLOYMENT_FAILED = "STAGING_DEPLOYMENT_FAILED";

const EMULATOR_ENV_KEYS = [
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIREBASE_DATABASE_EMULATOR_HOST",
  "FIREBASE_EMULATOR_HUB",
] as const;

const USAGE =
  "Usage: deploy-what-is-life-staging --project=lyfelabz-staging [--apply]";

export type CliArgs = {
  readonly project: string;
  readonly apply: boolean;
};

export type ParseResult =
  | { readonly ok: true; readonly args: CliArgs }
  | { readonly ok: false; readonly message: string };

export type DocumentObservation = {
  readonly exists: boolean;
  readonly data?: Readonly<Record<string, unknown>>;
};

export type CliRuntime = {
  readonly readDocuments: (
    paths: readonly string[],
  ) => Promise<readonly DocumentObservation[]>;
  readonly deploy: (payload: unknown) => Promise<AssessmentDeploymentResult>;
};

export type CliDeps = {
  readonly acquireImpersonatedCredential: () => Promise<Impersonated>;
  readonly readCanonicalPayload: () => unknown;
  readonly initializeRuntime: (
    credential: Impersonated,
  ) => Promise<CliRuntime>;
  readonly log: (message: string) => void;
  readonly logError: (message: string) => void;
};

export type ImpersonatedClientFactory = (
  options: ImpersonatedOptions,
) => Impersonated;

type BoundFirestoreSettings = FirestoreSettings & {
  readonly auth: GoogleAuth<Impersonated>;
  readonly universeDomain: typeof DEFAULT_UNIVERSE;
  readonly servicePath: typeof STANDARD_FIRESTORE_SERVICE_PATH;
};

export type DirectStagingRuntimeDeps = {
  readonly createFirestore: (settings: BoundFirestoreSettings) => Firestore;
  readonly deployAssessment: (
    payload: unknown,
    firestore: Firestore,
  ) => Promise<AssessmentDeploymentResult>;
};

export class SourceAdcValidationError extends Error {
  constructor() {
    super(STAGING_SOURCE_ADC_REJECTED);
    this.name = "SourceAdcValidationError";
  }
}

export class ImpersonationCredentialError extends Error {
  constructor() {
    super(STAGING_IMPERSONATION_FAILED);
    this.name = "ImpersonationCredentialError";
  }
}

export function createStagingImpersonatedClient(
  sourceClient: AuthClient,
  createImpersonatedClient: ImpersonatedClientFactory =
    (options) => new Impersonated(options),
): Impersonated {
  // The repository-approved local workflow uses gcloud-created authorized-user
  // ADC. The ADC JSON does not cryptographically establish the user's email;
  // current IAM authorization is intentionally deferred to token acquisition.
  if (!(sourceClient instanceof UserRefreshClient)) {
    throw new SourceAdcValidationError();
  }

  // Authorized-user ADC JSON can carry universe_domain. The installed
  // Impersonated implementation otherwise inherits that value from its source
  // and uses it to construct the IAM Credentials endpoint. Reject it before
  // construction, then also set both supported endpoint controls explicitly.
  if (sourceClient.universeDomain !== DEFAULT_UNIVERSE) {
    throw new SourceAdcValidationError();
  }

  return createImpersonatedClient({
    sourceClient,
    targetPrincipal: APPROVED_STAGING_SERVICE_ACCOUNT,
    targetScopes: [FIRESTORE_OAUTH_SCOPE],
    delegates: [],
    lifetime: IMPERSONATED_TOKEN_LIFETIME_SECONDS,
    universeDomain: DEFAULT_UNIVERSE,
    endpoint: STANDARD_IAM_CREDENTIALS_ENDPOINT,
  });
}

export async function preflightStagingImpersonation(
  impersonatedClient: Impersonated,
  now: () => number = Date.now,
): Promise<void> {
  try {
    const response = await impersonatedClient.getAccessToken();
    const expiry = impersonatedClient.credentials.expiry_date;
    if (
      typeof response.token !== "string" ||
      response.token.length === 0 ||
      typeof expiry !== "number" ||
      !Number.isFinite(expiry) ||
      expiry <= now()
    ) {
      throw new Error("invalid impersonated token response");
    }
  } catch {
    throw new ImpersonationCredentialError();
  }
}

export async function acquireStagingImpersonatedCredential(
  loadSourceClient: () => Promise<AuthClient> = async () =>
    new GoogleAuth().getClient(),
  createImpersonatedClient?: ImpersonatedClientFactory,
): Promise<Impersonated> {
  let sourceClient: AuthClient;
  try {
    sourceClient = await loadSourceClient();
  } catch {
    throw new SourceAdcValidationError();
  }

  const impersonatedClient = createStagingImpersonatedClient(
    sourceClient,
    createImpersonatedClient,
  );
  // Verify both current Token Creator authorization and token response shape
  // before the direct Firestore client can be created. No token is logged or
  // persisted; the credential retains only the library client's in-memory cache.
  await preflightStagingImpersonation(impersonatedClient);
  return impersonatedClient;
}

export function createDirectStagingFirestore(
  impersonatedClient: Impersonated,
  createFirestore: DirectStagingRuntimeDeps["createFirestore"] =
    (settings) => new Firestore(settings),
): Firestore {
  const auth = new GoogleAuth<Impersonated>({
    authClient: impersonatedClient,
    projectId: STAGING_PROJECT_ID,
    universeDomain: DEFAULT_UNIVERSE,
  });
  return createFirestore({
    projectId: STAGING_PROJECT_ID,
    auth,
    universeDomain: DEFAULT_UNIVERSE,
    servicePath: STANDARD_FIRESTORE_SERVICE_PATH,
  });
}

export function initializeDirectStagingRuntime(
  impersonatedClient: Impersonated,
  deps: DirectStagingRuntimeDeps = {
    createFirestore: (settings) => new Firestore(settings),
    deployAssessment: deployAssessmentRevision,
  },
): CliRuntime {
  const db = createDirectStagingFirestore(
    impersonatedClient,
    deps.createFirestore,
  );
  return {
    readDocuments: async (paths) => {
      const snapshots = await db.getAll(
        ...paths.map((documentPath) => db.doc(documentPath)),
      );
      return snapshots.map((snapshot) => ({
        exists: snapshot.exists,
        data: snapshot.exists ? snapshot.data() : undefined,
      }));
    },
    deploy: (payload) => deps.deployAssessment(payload, db),
  };
}

export function parseArgs(argv: readonly string[]): ParseResult {
  let project: string | undefined;
  let apply = false;

  for (const raw of argv) {
    if (raw === "--help" || raw === "-h") {
      return { ok: false, message: USAGE };
    }
    if (raw === "--apply") {
      if (apply) return { ok: false, message: "--apply may be supplied only once" };
      apply = true;
      continue;
    }
    if (raw.startsWith("--project=")) {
      if (project !== undefined) {
        return { ok: false, message: "--project may be supplied only once" };
      }
      project = raw.slice("--project=".length);
      continue;
    }
    return { ok: false, message: `unknown argument: ${raw}` };
  }

  if (project === undefined || project.length === 0) {
    return { ok: false, message: `explicit --project=${STAGING_PROJECT_ID} is required` };
  }
  return { ok: true, args: { project, apply } };
}

export function ensureStagingSafe(
  args: CliArgs,
  env: NodeJS.ProcessEnv,
): string | null {
  if (args.project !== STAGING_PROJECT_ID) {
    return `refusing project '${args.project}': only '${STAGING_PROJECT_ID}' is authorized`;
  }

  for (const key of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"] as const) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0 && value !== STAGING_PROJECT_ID) {
      return `refusing staging operation: ${key} conflicts with '${STAGING_PROJECT_ID}'`;
    }
  }

  for (const key of EMULATOR_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) {
      return `refusing staging operation while ${key} is set`;
    }
  }

  for (const key of [
    "GOOGLE_APPLICATION_CREDENTIALS",
    "google_application_credentials",
  ] as const) {
    if (env[key] !== undefined) {
      return `refusing staging operation: ${key} override is not permitted`;
    }
  }
  return null;
}

function isDeepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => isDeepEqual(value, right[index]));
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    isDeepEqual(leftKeys, rightKeys) &&
    leftKeys.every((key) => isDeepEqual(leftRecord[key], rightRecord[key]))
  );
}

function matchesParent(
  actual: Readonly<Record<string, unknown>>,
  expected: Readonly<Record<string, unknown>>,
): boolean {
  return Object.entries(expected).every(([key, value]) =>
    isDeepEqual(actual[key], value),
  );
}

function matchesImmutable(
  actual: Readonly<Record<string, unknown>>,
  expectedWithoutTimestamp: Readonly<Record<string, unknown>>,
): boolean {
  if (!(actual.publishedAt instanceof Timestamp)) return false;
  const withoutTimestamp = { ...actual };
  delete withoutTimestamp.publishedAt;
  return isDeepEqual(withoutTimestamp, expectedWithoutTimestamp);
}

function assertCanonicalPlan(plan: AssessmentDeploymentPlan): void {
  if (
    plan.input.activityId !== CANONICAL_ACTIVITY_ID ||
    plan.input.revisionOrdinal !== 1 ||
    plan.assessmentId !== CANONICAL_ASSESSMENT_ID ||
    plan.revisionId !== CANONICAL_REVISION_ID
  ) {
    throw new Error("repository payload does not resolve to canonical what-is-life r1 identity");
  }
}

type ExistingState = "absent" | "canonical" | "conflict";

export function classifyExistingState(
  observations: readonly DocumentObservation[],
  plan: AssessmentDeploymentPlan,
): ExistingState {
  if (observations.length !== 3) return "conflict";
  if (observations.every((observation) => !observation.exists)) return "absent";
  if (observations.some((observation) => !observation.exists || !observation.data)) {
    return "conflict";
  }

  const [assessment, revision, answerKey] = observations as readonly [
    DocumentObservation & { readonly data: Readonly<Record<string, unknown>> },
    DocumentObservation & { readonly data: Readonly<Record<string, unknown>> },
    DocumentObservation & { readonly data: Readonly<Record<string, unknown>> },
  ];

  return matchesParent(assessment.data, plan.assessmentWrite) &&
    matchesImmutable(revision.data, plan.revisionWrite) &&
    matchesImmutable(answerKey.data, plan.answerKeyWrite)
    ? "canonical"
    : "conflict";
}

export function canonicalDocumentPaths(plan: AssessmentDeploymentPlan): readonly string[] {
  return [
    `assessments/${plan.assessmentId}`,
    `assessmentRevisions/${plan.revisionId}`,
    `assessmentAnswerKeys/${plan.revisionId}`,
  ];
}

export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
  deps: CliDeps,
): Promise<number> {
  const parsed = parseArgs(argv);
  if (!parsed.ok) {
    deps.logError(parsed.message);
    return 2;
  }
  const safetyError = ensureStagingSafe(parsed.args, env);
  if (safetyError !== null) {
    deps.logError(safetyError);
    return 2;
  }

  let credential: Impersonated;
  try {
    credential = await deps.acquireImpersonatedCredential();
  } catch (err) {
    deps.logError(
      err instanceof SourceAdcValidationError
        ? STAGING_SOURCE_ADC_REJECTED
        : STAGING_IMPERSONATION_FAILED,
    );
    return 2;
  }

  let payload: unknown;
  let plan: AssessmentDeploymentPlan;
  try {
    payload = deps.readCanonicalPayload();
    plan = planAssessmentRevision(payload);
    assertCanonicalPlan(plan);
  } catch (err) {
    deps.logError(`canonical source validation failed: ${(err as Error).message}`);
    return 1;
  }

  let runtime: CliRuntime;
  try {
    runtime = await deps.initializeRuntime(credential);
  } catch {
    deps.logError("staging runtime initialization failed");
    return 1;
  }

  const paths = canonicalDocumentPaths(plan);
  let observations: readonly DocumentObservation[];
  try {
    observations = await runtime.readDocuments(paths);
  } catch {
    deps.logError(STAGING_PREFLIGHT_READ_FAILED);
    return 1;
  }

  const state = classifyExistingState(observations, plan);
  if (state === "conflict") {
    deps.logError(
      "refusing deployment: canonical staging documents are partial or incompatible",
    );
    return 1;
  }
  if (state === "canonical") {
    deps.log(
      `no-op assessment=${plan.assessmentId} revision=${plan.revisionId} ` +
        "state=canonical writes=0 target=staging",
    );
    return 0;
  }
  if (!parsed.args.apply) {
    deps.log(
      `dry-run ok assessment=${plan.assessmentId} revision=${plan.revisionId} ` +
        "state=absent writes=0 target=staging",
    );
    return 0;
  }

  try {
    const result = await runtime.deploy(payload);
    deps.log(
      `applied assessment=${result.assessmentId} revision=${result.revisionId} ` +
        `ordinal=${String(result.revisionOrdinal)} writes=3 target=staging`,
    );
    return 0;
  } catch {
    deps.logError(STAGING_DEPLOYMENT_FAILED);
    return 1;
  }
}

function repoRootFromCompiled(): string {
  return path.resolve(__dirname, "..", "..", "..", "..");
}

function canonicalSourcePath(): string {
  return path.join(
    repoRootFromCompiled(),
    "platform",
    "functions",
    "src",
    "scripts",
    "assessments",
    "what-is-life.r1.json",
  );
}

async function runRealCli(argv: readonly string[]): Promise<number> {
  return main(argv, process.env, {
    acquireImpersonatedCredential: acquireStagingImpersonatedCredential,
    readCanonicalPayload: () =>
      JSON.parse(fs.readFileSync(canonicalSourcePath(), "utf8")) as unknown,
    initializeRuntime: (credential) => {
      // The exact preflighted impersonated client is bound into the GAPIC auth
      // layer. No Firebase Admin credential adapter or second ADC lookup exists.
      return Promise.resolve(initializeDirectStagingRuntime(credential));
    },
    log: (message) => process.stdout.write(`${message}\n`),
    logError: (message) => process.stderr.write(`${message}\n`),
  });
}

if (require.main === module) {
  void runRealCli(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch(() => {
      process.stderr.write("UNEXPECTED_STAGING_DEPLOYMENT_ERROR\n");
      process.exit(1);
    });
}
