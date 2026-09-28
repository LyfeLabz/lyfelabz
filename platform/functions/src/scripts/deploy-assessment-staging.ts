/*
 * Staging assessment deployment for any committed lesson payload.
 *
 *   node lib/scripts/deploy-assessment-staging.js \
 *     --project=lyfelabz-staging --lesson=<slug> \
 *     [--assessment-revision=assessment_<slug>__r<N>] [--apply]
 *
 * Generalizes the ASTRA-004 what-is-life staging deployer (which is now a thin
 * wrapper over this module) without widening its safety posture:
 *
 *   - Only the literal staging project is accepted. Ambient project,
 *     FIREBASE_CONFIG, emulator, and credential-file overrides are refused.
 *   - Authorized-user ADC impersonates the fixed staging service account; the
 *     Firestore client is constructed directly with the explicit staging
 *     projectId and that exact impersonated credential. The Firebase Admin SDK
 *     is never loaded, so no ambient project source can redirect it.
 *   - `--lesson=<slug>` resolves exactly one committed
 *     `scripts/assessments/<slug>.r<N>.json`. Unknown, malformed, or ambiguous
 *     lessons (zero candidates, several revisions, or any other file claiming
 *     the slug) are refused before any credential or network access.
 *   - Earth's Layers r2 (owner ruling R2-D5): `--assessment-revision=` names
 *     the one committed revision to deploy, as the repository's revision id
 *     `assessment_<slug>__r<N>` of the same lesson. It is required when the
 *     lesson commits several revisions; there is no "latest" or "current"
 *     default and no fallback. Without it, a single-revision lesson resolves
 *     exactly as before. A malformed or cross-lesson id is refused while
 *     parsing, and an uncommitted one while resolving, both before any
 *     credential or network access.
 *   - The payload is planned by the certified `planAssessmentRevision`, its
 *     identity is asserted against the slug and file revision, and it is
 *     checked for fidelity against the page that displays exactly that
 *     revision in the committed revision-path table: the canonical quiz in
 *     `lesson-sources/lesson_<slug>.html` when the table maps the revision to
 *     the unversioned page (a single-revision lesson), else the revision's
 *     rendition under `app/lessons/assessment-revisions/` (the one shared
 *     `assessmentFidelity.cjs` implementation), all locally.
 *   - Only the three canonical documents are read. Dry-run is the default and
 *     performs zero writes; `--apply` is required before the certified
 *     `deployAssessmentRevision` transaction runs, and only after an all-absent
 *     preflight, or (for a later revision) a preflight in which the lesson's
 *     parent assessment is at a lower revision of the same assessment and the
 *     selected revision and answer key are both absent. Equal existing
 *     documents are a zero-write no-op; any other partial or incompatible
 *     state fails closed. Revisions are never replaced.
 */

import * as fs from "fs";
import * as path from "path";
import { createRequire } from "module";
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
import {
  assessmentIdForLessonSlug,
  parseAssessmentIdFromRevisionId,
  parseRevisionOrdinalFromRevisionId,
  revisionIdForOrdinal,
} from "../shared/assessment-identifiers";
import {
  STAGING_PROJECT_ID,
  conflictingProjectEnvKey,
  hasFirebaseConfigOverride,
} from "./deployment-projects";

export { STAGING_PROJECT_ID };
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

// Lesson slugs are lowercase kebab-case, exactly as committed payload and
// canonical source filenames use them. Anything else (paths, dots, case
// variants, whitespace) is refused before the filesystem is consulted.
export const LESSON_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_LESSON_SLUG_LENGTH = 100;
// `<slug>.r<N>.json` with a canonical (no leading zero) positive ordinal.
const PAYLOAD_FILE_PATTERN = /^([a-z0-9]+(?:-[a-z0-9]+)*)\.r([1-9][0-9]*)\.json$/;

const EMULATOR_ENV_KEYS = [
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
  "FIREBASE_DATABASE_EMULATOR_HOST",
  "FIREBASE_EMULATOR_HUB",
] as const;

const USAGE =
  "Usage: deploy-assessment-staging --project=lyfelabz-staging --lesson=<slug> " +
  "[--assessment-revision=assessment_<slug>__r<N>] [--apply]";

// The repository's assessment revision identifier, strict: a kebab-case slug
// and a canonical (no leading zero) positive ordinal.
const ASSESSMENT_REVISION_ID_PATTERN = /^assessment_([a-z0-9]+(?:-[a-z0-9]+)*)__r([1-9][0-9]*)$/;

export type CliArgs = {
  readonly project: string;
  readonly lesson: string;
  readonly apply: boolean;
  // The explicitly selected revision (`assessment_<lesson>__r<N>`), or null
  // when none was named (accepted only for a single-revision lesson).
  readonly assessmentRevisionId: string | null;
};

export type ParseResult =
  | { readonly ok: true; readonly args: CliArgs }
  | { readonly ok: false; readonly message: string };

export type DocumentObservation = {
  readonly exists: boolean;
  readonly data?: Readonly<Record<string, unknown>>;
};

// A committed payload resolved for exactly one lesson slug.
export type ResolvedLessonPayload = {
  readonly slug: string;
  readonly revisionOrdinal: number;
  readonly fileName: string;
  readonly payload: unknown;
};

export type FidelityReport = {
  readonly canonicalQuestionCount: number;
};

export type CliRuntime = {
  readonly readDocuments: (
    paths: readonly string[],
  ) => Promise<readonly DocumentObservation[]>;
  readonly deploy: (payload: unknown) => Promise<AssessmentDeploymentResult>;
};

export type CliDeps = {
  readonly acquireImpersonatedCredential: () => Promise<Impersonated>;
  // Throws LessonResolutionError for an unknown or ambiguous lesson, or for a
  // requested revision ordinal that is not committed. `requestedOrdinal` is
  // null when the operator named no revision.
  readonly resolveLessonPayload: (
    slug: string,
    requestedOrdinal: number | null,
  ) => ResolvedLessonPayload;
  // Throws when the payload does not exactly transcribe the quiz of the page
  // that displays `assessmentRevisionId`, or that page is missing.
  readonly verifyFidelity: (
    slug: string,
    payload: unknown,
    assessmentRevisionId: string,
  ) => FidelityReport;
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

export class LessonResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LessonResolutionError";
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
  let lesson: string | undefined;
  let assessmentRevisionId: string | undefined;
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
    if (raw.startsWith("--lesson=")) {
      if (lesson !== undefined) {
        return { ok: false, message: "--lesson may be supplied only once" };
      }
      lesson = raw.slice("--lesson=".length);
      continue;
    }
    if (raw.startsWith("--assessment-revision=")) {
      if (assessmentRevisionId !== undefined) {
        return { ok: false, message: "--assessment-revision may be supplied only once" };
      }
      assessmentRevisionId = raw.slice("--assessment-revision=".length);
      continue;
    }
    return { ok: false, message: `unknown argument: ${raw}` };
  }

  if (project === undefined || project.length === 0) {
    return { ok: false, message: `explicit --project=${STAGING_PROJECT_ID} is required` };
  }
  if (lesson === undefined || lesson.length === 0) {
    return { ok: false, message: "explicit --lesson=<slug> is required" };
  }
  if (lesson.length > MAX_LESSON_SLUG_LENGTH || !LESSON_SLUG_PATTERN.test(lesson)) {
    return {
      ok: false,
      message: `refusing malformed lesson slug ${JSON.stringify(lesson)}: expected lowercase kebab-case`,
    };
  }
  if (assessmentRevisionId !== undefined) {
    const match = ASSESSMENT_REVISION_ID_PATTERN.exec(assessmentRevisionId);
    if (match === null) {
      return {
        ok: false,
        message:
          `refusing malformed --assessment-revision ${JSON.stringify(assessmentRevisionId)}: ` +
          `expected assessment_${lesson}__r<N>`,
      };
    }
    if (match[1] !== lesson) {
      return {
        ok: false,
        message:
          `refusing --assessment-revision ${assessmentRevisionId}: it belongs to lesson ` +
          `'${match[1]}', not '${lesson}'`,
      };
    }
  }
  return {
    ok: true,
    args: { project, lesson, apply, assessmentRevisionId: assessmentRevisionId ?? null },
  };
}

export function ensureStagingSafe(
  args: Pick<CliArgs, "project"> & Partial<CliArgs>,
  env: NodeJS.ProcessEnv,
): string | null {
  if (args.project !== STAGING_PROJECT_ID) {
    return `refusing project '${args.project}': only '${STAGING_PROJECT_ID}' is authorized`;
  }

  const conflictingKey = conflictingProjectEnvKey(env, STAGING_PROJECT_ID);
  if (conflictingKey !== null) {
    return `refusing staging operation: ${conflictingKey} conflicts with '${STAGING_PROJECT_ID}'`;
  }
  if (hasFirebaseConfigOverride(env)) {
    return "refusing staging operation while FIREBASE_CONFIG is set";
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

// Resolves `slug` to exactly one committed payload file. The listing is the
// complete committed payload directory; any file whose name claims the slug
// but is not the strict `<slug>.r<N>.json` form is ambiguous and refused
// rather than guessed. With `requestedOrdinal`, exactly that committed
// revision is returned or the request is refused; without it, a lesson with
// more than one committed revision is refused (never "latest" or "current").
export function resolveCommittedLessonPayload(
  slug: string,
  io: {
    readonly listPayloadFiles: () => readonly string[];
    readonly readPayloadFile: (fileName: string) => string;
  },
  requestedOrdinal: number | null = null,
): ResolvedLessonPayload {
  if (slug.length > MAX_LESSON_SLUG_LENGTH || !LESSON_SLUG_PATTERN.test(slug)) {
    throw new LessonResolutionError(`malformed lesson slug ${JSON.stringify(slug)}`);
  }

  const claiming = io
    .listPayloadFiles()
    .filter((fileName) => fileName.startsWith(`${slug}.`));
  if (claiming.length === 0) {
    throw new LessonResolutionError(`unknown lesson '${slug}': no committed assessment payload`);
  }
  const candidates = claiming.flatMap((fileName) => {
    const match = PAYLOAD_FILE_PATTERN.exec(fileName);
    return match !== null && match[1] === slug
      ? [{ fileName, revisionOrdinal: Number(match[2]) }]
      : [];
  });
  if (candidates.length !== claiming.length) {
    throw new LessonResolutionError(
      `ambiguous lesson '${slug}': expected only committed ${slug}.r<N>.json files, found [${claiming.join(", ")}]`,
    );
  }
  if (
    requestedOrdinal !== null &&
    (!Number.isSafeInteger(requestedOrdinal) || requestedOrdinal < 1)
  ) {
    throw new LessonResolutionError(`malformed requested revision ordinal ${String(requestedOrdinal)}`);
  }
  let selected: { readonly fileName: string; readonly revisionOrdinal: number };
  if (requestedOrdinal === null) {
    if (candidates.length !== 1) {
      throw new LessonResolutionError(
        `ambiguous lesson '${slug}': expected exactly one committed ${slug}.r<N>.json, found [${claiming.join(", ")}]; ` +
          `name the revision to deploy with --assessment-revision=assessment_${slug}__r<N>`,
      );
    }
    selected = candidates[0];
  } else {
    const match = candidates.filter((c) => c.revisionOrdinal === requestedOrdinal);
    if (match.length !== 1) {
      throw new LessonResolutionError(
        `revision assessment_${slug}__r${String(requestedOrdinal)} is not a committed revision of '${slug}' ` +
          `(committed: [${claiming.join(", ")}])`,
      );
    }
    selected = match[0];
  }

  const { fileName, revisionOrdinal } = selected;
  let payload: unknown;
  try {
    payload = JSON.parse(io.readPayloadFile(fileName));
  } catch (err) {
    throw new LessonResolutionError(
      `committed payload ${fileName} could not be read as JSON: ${(err as Error).message}`,
    );
  }
  return { slug, revisionOrdinal, fileName, payload };
}

// Asserts that the certified plan is exactly the lesson and revision the
// operator named and the committed filename declares, and that the answer key
// is structurally linked item-for-item to the student-visible revision.
export function assertLessonPlanIdentity(
  plan: AssessmentDeploymentPlan,
  resolved: ResolvedLessonPayload,
): void {
  const expectedAssessmentId = assessmentIdForLessonSlug(resolved.slug);
  const expectedRevisionId = revisionIdForOrdinal(
    expectedAssessmentId,
    resolved.revisionOrdinal,
  );
  if (plan.input.activityId !== resolved.slug) {
    throw new Error(
      `payload activityId '${plan.input.activityId}' does not match lesson '${resolved.slug}'`,
    );
  }
  if (plan.input.revisionOrdinal !== resolved.revisionOrdinal) {
    throw new Error(
      `payload revisionOrdinal ${String(plan.input.revisionOrdinal)} does not match ${resolved.fileName}`,
    );
  }
  if (plan.assessmentId !== expectedAssessmentId || plan.revisionId !== expectedRevisionId) {
    throw new Error(`plan identity does not resolve to ${expectedRevisionId}`);
  }

  const revisionItems = plan.revisionWrite.items;
  const answerKeyItems = plan.answerKeyWrite.items;
  if (
    plan.answerKeyWrite.assessmentId !== plan.assessmentId ||
    plan.answerKeyWrite.revisionOrdinal !== plan.input.revisionOrdinal ||
    answerKeyItems.length !== revisionItems.length ||
    revisionItems.length === 0
  ) {
    throw new Error("answer key is not linked to the planned revision");
  }
  answerKeyItems.forEach((keyItem, index) => {
    const item = revisionItems[index];
    if (
      keyItem.itemId !== item.itemId ||
      keyItem.points !== item.points ||
      !item.options.some((option) => option.optionId === keyItem.correctOptionId)
    ) {
      throw new Error(`answer key item ${String(index + 1)} does not match revision item '${item.itemId}'`);
    }
  });
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

// "advance" (Earth's Layers r2, R2-D5): the parent assessment is this
// lesson's, its currentRevisionId is a LOWER revision of the same assessment,
// and the selected revision and its answer key are both absent. This is
// exactly the state the certified deployAssessmentRevision transaction
// accepts for a later revision (it re-checks activityId and the strictly
// increasing ordinal inside the transaction); every other partial state is a
// conflict.
type ExistingState = "absent" | "advance" | "canonical" | "conflict";

function isLowerRevisionOfSameAssessment(
  parent: Readonly<Record<string, unknown>>,
  plan: AssessmentDeploymentPlan,
): boolean {
  const current = parent.currentRevisionId;
  if (typeof current !== "string") return false;
  const ordinal = parseRevisionOrdinalFromRevisionId(current);
  return (
    ordinal !== undefined &&
    parseAssessmentIdFromRevisionId(current) === plan.assessmentId &&
    current === revisionIdForOrdinal(plan.assessmentId, ordinal) &&
    ordinal < plan.input.revisionOrdinal
  );
}

export function classifyExistingState(
  observations: readonly DocumentObservation[],
  plan: AssessmentDeploymentPlan,
): ExistingState {
  if (observations.length !== 3) return "conflict";
  if (observations.every((observation) => !observation.exists)) return "absent";
  const [parent, revisionDoc, answerKeyDoc] = observations;
  if (
    parent.exists &&
    parent.data !== undefined &&
    !revisionDoc.exists &&
    !answerKeyDoc.exists &&
    parent.data.assessmentId === plan.assessmentId &&
    parent.data.activityId === plan.input.activityId &&
    isLowerRevisionOfSameAssessment(parent.data, plan)
  ) {
    return "advance";
  }
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

  // Everything below up to credential acquisition is local: an unknown,
  // ambiguous, invalid, or unfaithful payload never reaches IAM or Firestore.
  const requestedOrdinal =
    parsed.args.assessmentRevisionId === null
      ? null
      : parseRevisionOrdinalFromRevisionId(parsed.args.assessmentRevisionId) ?? null;
  if (parsed.args.assessmentRevisionId !== null && requestedOrdinal === null) {
    deps.logError("refusing lesson: malformed --assessment-revision");
    return 2;
  }
  let resolved: ResolvedLessonPayload;
  try {
    resolved = deps.resolveLessonPayload(parsed.args.lesson, requestedOrdinal);
    if (requestedOrdinal !== null && resolved.revisionOrdinal !== requestedOrdinal) {
      throw new LessonResolutionError(
        `resolved ${resolved.fileName}, not the requested ${String(parsed.args.assessmentRevisionId)}`,
      );
    }
  } catch (err) {
    deps.logError(
      err instanceof LessonResolutionError
        ? `refusing lesson: ${err.message}`
        : "refusing lesson: committed payload resolution failed",
    );
    return 2;
  }

  let plan: AssessmentDeploymentPlan;
  let fidelity: FidelityReport;
  try {
    plan = planAssessmentRevision(resolved.payload);
    assertLessonPlanIdentity(plan, resolved);
    fidelity = deps.verifyFidelity(resolved.slug, resolved.payload, plan.revisionId);
    if (fidelity.canonicalQuestionCount !== plan.revisionWrite.items.length) {
      throw new Error("canonical question count does not match the planned revision");
    }
  } catch (err) {
    deps.logError(`canonical source validation failed: ${(err as Error).message}`);
    return 1;
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

  const summary =
    `lesson=${resolved.slug} file=${resolved.fileName} ` +
    `assessment=${plan.assessmentId} revision=${plan.revisionId} ` +
    `items=${String(plan.revisionWrite.items.length)} ` +
    `answerKeyItems=${String(plan.answerKeyWrite.items.length)} fidelity=exact ` +
    `selection=${parsed.args.assessmentRevisionId === null ? "single-revision" : "explicit"}`;

  const state = classifyExistingState(observations, plan);
  if (state === "conflict") {
    deps.logError(
      "refusing deployment: canonical staging documents are partial or incompatible",
    );
    return 1;
  }
  if (state === "canonical") {
    deps.log(`no-op ${summary} state=canonical writes=0 target=staging`);
    return 0;
  }
  const stateLabel =
    state === "advance"
      ? `state=advance from=${String((observations[0].data ?? {}).currentRevisionId)}`
      : "state=absent";
  if (!parsed.args.apply) {
    deps.log(`dry-run ok ${summary} ${stateLabel} writes=0 target=staging`);
    return 0;
  }

  try {
    const result = await runtime.deploy(resolved.payload);
    deps.log(
      `applied lesson=${resolved.slug} assessment=${result.assessmentId} ` +
        `revision=${result.revisionId} ordinal=${String(result.revisionOrdinal)} ` +
        "writes=3 target=staging",
    );
    return 0;
  } catch {
    deps.logError(STAGING_DEPLOYMENT_FAILED);
    return 1;
  }
}

export function repoRootFromCompiled(): string {
  // lib/scripts (src/scripts under ts-jest) -> lib -> functions -> platform -> repo.
  return path.resolve(__dirname, "..", "..", "..", "..");
}

export function committedPayloadDirectory(repoRoot: string): string {
  return path.join(repoRoot, "platform", "functions", "src", "scripts", "assessments");
}

export function makeRepositoryLessonResolver(
  repoRoot: string,
): CliDeps["resolveLessonPayload"] {
  const directory = committedPayloadDirectory(repoRoot);
  return (slug, requestedOrdinal) =>
    resolveCommittedLessonPayload(
      slug,
      {
        listPayloadFiles: () => fs.readdirSync(directory),
        readPayloadFile: (fileName) => fs.readFileSync(path.join(directory, fileName), "utf8"),
      },
      requestedOrdinal,
    );
}

type AssessmentFidelityModule = {
  readonly extractCanonicalQuiz: (
    html: string,
    slug: string,
  ) => { readonly questions: readonly unknown[] };
  readonly checkFidelity: (
    slug: string,
    payload: unknown,
    quiz: { readonly questions: readonly unknown[] },
  ) => readonly string[];
};

// The committed F5.3 Slice 9B revision-path table (a build output drift-
// checked by `lessons:verify`), relative to the repository root.
export const REVISION_PATH_TABLE_FILE = path.join("app", "lessons", "assessment-revisions", "revision-paths.json");

// The repository file whose quiz students see for exactly this revision, per
// the committed revision-path table: the canonical source when the table maps
// the revision to the unversioned page (a single-revision lesson), else the
// revision's rendition. No entry, or an unexpected path, fails closed.
export function revisionDisplaySource(
  repoRoot: string,
  slug: string,
  assessmentRevisionId: string,
): string {
  const tablePath = path.join(repoRoot, REVISION_PATH_TABLE_FILE);
  if (!fs.existsSync(tablePath)) {
    throw new Error(`committed revision-path table ${REVISION_PATH_TABLE_FILE} not found`);
  }
  const table = JSON.parse(fs.readFileSync(tablePath, "utf8")) as {
    readonly lessons?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  };
  const revisions = table.lessons !== undefined && Object.prototype.hasOwnProperty.call(table.lessons, slug)
    ? table.lessons[slug]
    : undefined;
  const page = revisions !== undefined && Object.prototype.hasOwnProperty.call(revisions, assessmentRevisionId)
    ? revisions[assessmentRevisionId]
    : undefined;
  if (typeof page !== "string") {
    throw new Error(`the committed revision-path table has no page for ${assessmentRevisionId}`);
  }
  const ordinal = parseRevisionOrdinalFromRevisionId(assessmentRevisionId);
  if (page === `/app/lessons/lesson_${slug}.html`) {
    return path.join("lesson-sources", `lesson_${slug}.html`);
  }
  if (ordinal !== undefined && page === `/app/lessons/assessment-revisions/lesson_${slug}__r${String(ordinal)}.html`) {
    return page.slice(1);
  }
  throw new Error(`the committed revision-path table maps ${assessmentRevisionId} to an unexpected page ${page}`);
}

// Reuses the ONE canonical fidelity implementation (Sprint 28 Phase 5B
// assessmentFidelity.cjs, which the app fidelity suite also runs) through
// createRequire, as publish-variant does for variantManifest.cjs. It lives in
// the app package, so it needs that package's dependencies installed; any
// load failure fails closed as a validation failure.
export function makeRepositoryFidelityVerifier(
  repoRoot: string,
): CliDeps["verifyFidelity"] {
  return (slug, payload, assessmentRevisionId) => {
    const sourceRel = revisionDisplaySource(repoRoot, slug, assessmentRevisionId);
    const sourcePath = path.join(repoRoot, sourceRel);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(
        sourceRel.startsWith("lesson-sources")
          ? `canonical lesson source lesson-sources/lesson_${slug}.html not found`
          : `revision page ${sourceRel} not found`,
      );
    }
    const req = createRequire(__filename);
    const fidelity = req(
      path.join(repoRoot, "app", "scripts", "lessonBuilder", "assessmentFidelity.cjs"),
    ) as AssessmentFidelityModule;
    const quiz = fidelity.extractCanonicalQuiz(fs.readFileSync(sourcePath, "utf8"), slug);
    const problems = fidelity.checkFidelity(slug, payload, quiz);
    if (problems.length > 0) {
      throw new Error(
        `payload does not match the canonical quiz (${String(problems.length)} mismatch(es)): ${problems[0]}`,
      );
    }
    return { canonicalQuestionCount: quiz.questions.length };
  };
}

export function createRealCliDeps(): CliDeps {
  const repoRoot = repoRootFromCompiled();
  return {
    acquireImpersonatedCredential: acquireStagingImpersonatedCredential,
    resolveLessonPayload: makeRepositoryLessonResolver(repoRoot),
    verifyFidelity: makeRepositoryFidelityVerifier(repoRoot),
    initializeRuntime: (credential) => {
      // The exact preflighted impersonated client is bound into the GAPIC auth
      // layer. No Firebase Admin credential adapter or second ADC lookup exists.
      return Promise.resolve(initializeDirectStagingRuntime(credential));
    },
    log: (message) => process.stdout.write(`${message}\n`),
    logError: (message) => process.stderr.write(`${message}\n`),
  };
}

if (require.main === module) {
  void main(process.argv.slice(2), process.env, createRealCliDeps())
    .then((code) => process.exit(code))
    .catch(() => {
      process.stderr.write("UNEXPECTED_STAGING_DEPLOYMENT_ERROR\n");
      process.exit(1);
    });
}
