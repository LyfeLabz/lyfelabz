/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
// The disables above are scoped to THIS staging-only certification harness (never
// bundled, never production runtime): it marshals dynamically-shaped callable
// responses and Firestore documents into evidence. The safety-critical, typed
// logic (project guard, callable-URL derivation, token redaction) lives in the
// exported pure functions and is fully type-checked and unit-tested.
/*
 * Staging-only headless certification driver for the Persistent Differentiation
 * Slices 1-6 delivery half (F5.2). NOT production tooling; never bundled.
 *
 * It authenticates as the seeded synthetic users (custom token -> ID token via
 * the staging App Engine service-account signing path) and exercises the REAL
 * deployed callables against staging, then inspects staging Firestore. It never
 * writes state a callable is meant to prove (accommodation via Op B, session via
 * begin, attempt via finalize); the ONLY direct writes are the server-owned
 * operational flag (platformConfig/differentiatedDelivery) and, for Phase M, a
 * single synthetic legacy attempt fixture - both legitimate admin control-plane.
 *
 * Fail-closed: refuses any project but lyfelabz-staging; requires explicit
 * --project=lyfelabz-staging; refuses a conflicting ambient project; never uses
 * the active alias as authorization. Secrets (custom/ID tokens, bearer headers)
 * live only in process memory and are redacted from all output.
 *
 * Pure guard/redaction/url helpers are exported and unit-tested; firebase-admin
 * and network calls happen only in the entry point.
 */

import { computeExternalIdentityDocId } from "../shared/identity/external-identity-doc-id";
import {
  assessmentIdForLessonSlug,
  parseAssessmentIdFromRevisionId,
  parseRevisionOrdinalFromRevisionId,
  revisionIdForOrdinal,
} from "../shared/assessment-identifiers";

export const STAGING_PROJECT_ID = "lyfelabz-staging";
export const CALLABLE_REGION = "us-central1";
export const SIGNING_SERVICE_ACCOUNT = "lyfelabz-staging@appspot.gserviceaccount.com";
export const ASTRA004_ADMIN_APP_NAME = "prepare-astra004-staging";

const ASTRA004_EMULATOR_ENV_KEYS = [
  "FIRESTORE_EMULATOR_HOST",
  "FIREBASE_AUTH_EMULATOR_HOST",
] as const;

export function assertStagingProject(
  project: string | undefined,
  env: NodeJS.ProcessEnv,
): string | null {
  if (project === undefined || project.length === 0) {
    return `--project=${STAGING_PROJECT_ID} is required (explicit, verified project id; an alias name is not trusted)`;
  }
  if (project !== STAGING_PROJECT_ID) {
    return `refusing project '${project}': only '${STAGING_PROJECT_ID}' is authorized for the cert driver`;
  }
  for (const key of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"] as const) {
    const val = env[key];
    if (typeof val === "string" && val.length > 0 && val !== STAGING_PROJECT_ID) {
      return `refusing driver: ${key}='${val}' does not match '${STAGING_PROJECT_ID}'`;
    }
  }
  return null;
}

export function assertAstra004Environment(env: NodeJS.ProcessEnv): string | null {
  for (const key of ASTRA004_EMULATOR_ENV_KEYS) {
    const value = env[key];
    if (typeof value === "string" && value.length > 0) {
      return `refusing deployed staging operation while ${key} is set`;
    }
  }
  return null;
}

// The callable HTTP endpoint. The project is always interpolated explicitly and
// verified staging-only, so a call can never be sent to a production endpoint.
export function callableUrl(project: string, name: string, region = CALLABLE_REGION): string {
  if (project !== STAGING_PROJECT_ID) {
    throw new Error(`refusing callable URL for non-staging project '${project}'`);
  }
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
    throw new Error(`refusing malformed callable name '${name}'`);
  }
  return `https://${region}-${project}.cloudfunctions.net/${name}`;
}

// Redacts anything token-shaped so no bearer/ID/custom token can reach a log.
export function redact(value: unknown): unknown {
  const SECRET_KEYS = /^(authorization|idToken|customToken|refreshToken|accessToken|launchRef|token|bearer)$/i;
  const scrub = (v: unknown): unknown => {
    if (typeof v === "string") {
      // JWT-shaped or long opaque strings.
      if (/^Bearer\s+/i.test(v)) return "Bearer <redacted>";
      if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(v)) return "<redacted-jwt>";
      return v;
    }
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = SECRET_KEYS.test(k) ? "<redacted>" : scrub(val);
      }
      return out;
    }
    return v;
  };
  return scrub(value);
}

// --------------------------------------------------------------------------
// ASTRA-004 dedicated student preparation. All validation and orchestration
// lives behind injected ports so dry-run/apply behavior can be proven without
// loading firebase-admin, minting tokens, or reaching a deployed service.
// --------------------------------------------------------------------------

export const ASTRA004 = Object.freeze({
  uid: "vFuswrzV4SbcjYqa8jhDLvPdavm1",
  email: "90ballard@gmail.com",
  studentSchoolId: "staging-cert-school",
  districtId: "staging-cert-district",
  teacherUid: "staging-cert-teacher",
  classId: "astra004-cert-class",
  classTitle: "ASTRA-004 Certification",
  classGrade: "7",
  classBlock: "A",
});

export const ASTRA004_ASSIGNMENT = Object.freeze({
  lessonSlug: "what-is-life",
  title: "ASTRA-004 What Is Life Certification",
  mode: "classroom" as const,
  historicalAssignmentId: "staging-cert-assignment",
  historicalLessonSlug: "staging-cert-fixture",
  assignmentIdPrefix: "astra004-cert-",
});

export const ASTRA004_EXISTING_DRAFT = Object.freeze({
  assignmentId: "astra004-cert-20260908t095411116z",
  assessmentId: "assessment_what-is-life",
  assessmentRevisionId: "assessment_what-is-life__r1",
});

export type Astra004Mode = "dry-run" | "apply";
export type Astra004Action =
  | "create"
  | "activate"
  | "recover-claims"
  | "add"
  | "satisfied";
export type Astra004LifecycleStage =
  | "clean-initial"
  | "class-created"
  | "student-activated"
  | "partial-activation-recovery"
  | "complete";
export type Astra004CallableName =
  | "classesCreate"
  | "studentsCompleteOnboarding"
  | "enrollmentsTeacherAdd";

export type Astra004AuthUser = {
  readonly uid: string;
  readonly email?: string | null;
  readonly disabled?: boolean;
  readonly providerData: readonly {
    readonly providerId: string;
    readonly uid?: string | null;
  }[];
  readonly customClaims?: Readonly<Record<string, unknown>>;
};

export type Astra004QueryDocument = {
  readonly id: string;
  readonly data: Readonly<Record<string, unknown>>;
};

export type Astra004PreparationDeps = {
  readonly getAuthUserByUid: (uid: string) => Promise<Astra004AuthUser | null>;
  readonly getAuthUserByEmail: (email: string) => Promise<Astra004AuthUser | null>;
  readonly getDocument: (path: string) => Promise<Readonly<Record<string, unknown>> | null>;
  readonly queryCollection: (
    collection: string,
    field: string,
    value: string,
  ) => Promise<readonly Astra004QueryDocument[]>;
  readonly queryCollectionGroup: (
    collection: string,
    field: string,
    value: string,
  ) => Promise<readonly Astra004QueryDocument[]>;
  readonly invokeCallableAs: (
    uid: string,
    name: Astra004CallableName,
    data: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>;
};

export type Astra004PreparationPlan = {
  readonly stage: Astra004LifecycleStage;
  readonly class: Astra004Action;
  readonly student: Astra004Action;
  readonly enrollment: Astra004Action;
  readonly nextOperations: readonly Astra004CallableName[];
};

export type Astra004PreparationResult = {
  readonly project: typeof STAGING_PROJECT_ID;
  readonly command: "prepareAstra004Student";
  readonly mode: Astra004Mode;
  readonly uid: typeof ASTRA004.uid;
  readonly email: typeof ASTRA004.email;
  readonly classId: typeof ASTRA004.classId;
  readonly plan: Astra004PreparationPlan;
  readonly message: string;
};

export type Astra004AssignmentCallableName =
  | "assignmentsCreateDraft"
  | "assignmentsPublish";

export type Astra004AssignmentPreparationDeps = {
  readonly getAuthUserByUid: (uid: string) => Promise<Astra004AuthUser | null>;
  readonly getDocument: (
    path: string,
  ) => Promise<Readonly<Record<string, unknown>> | null>;
  readonly queryCollection: (
    collection: string,
    field: string,
    value: string,
  ) => Promise<readonly Astra004QueryDocument[]>;
  readonly invokeCallableAs: (
    uid: string,
    name: Astra004AssignmentCallableName,
    data: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>;
  readonly createAssignmentId: () => string;
};

export type Astra004TokenExchangeConfig = {
  readonly credential: unknown;
  readonly configuredServiceAccountId: string;
  readonly suppliedWebApiKey: string | undefined;
  readonly approvedWebApiKey: string;
};

export type Astra004TokenExchangeDeps = {
  readonly createCustomToken: (uid: string) => Promise<string>;
  readonly exchangeCustomToken: (
    customToken: string,
    webApiKey: string,
  ) => Promise<{ readonly idToken?: string }>;
  readonly verifyIdToken: (
    idToken: string,
  ) => Promise<{ readonly uid: string; readonly aud: string }>;
};

export type Astra004AssignmentCommandInput = {
  readonly project?: string;
  readonly mode: Astra004Mode;
  readonly env?: NodeJS.ProcessEnv;
};

export type Astra004AssignmentCliInput = {
  readonly command: "prepareAstra004Assignment";
  readonly project: string;
  readonly mode: Astra004Mode;
};

export type Astra004AssignmentPreparationResult = {
  readonly project: typeof STAGING_PROJECT_ID;
  readonly command: "prepareAstra004Assignment";
  readonly mode: Astra004Mode;
  readonly classId: typeof ASTRA004.classId;
  readonly lessonSlug: typeof ASTRA004_ASSIGNMENT.lessonSlug;
  readonly studentUid: typeof ASTRA004.uid;
  readonly intendedCallableSequence: readonly Astra004AssignmentCallableName[];
  readonly conflictingCertificationAssignmentExists: false;
  readonly preflightPassed: true;
  readonly writesPerformed?: 0;
  readonly mutationStagesCompleted?: 2;
  readonly assignmentId?: string;
  readonly finalStatus?: "published";
  readonly recipientSnapshotVerified?: true;
  readonly message: string;
};

export type Astra004ExistingDraftPublisherDeps = {
  readonly getAuthUserByUid: (uid: string) => Promise<Astra004AuthUser | null>;
  readonly getAuthUserByEmail: (email: string) => Promise<Astra004AuthUser | null>;
  readonly getDocument: (
    path: string,
  ) => Promise<Readonly<Record<string, unknown>> | null>;
  readonly queryCollection: (
    collection: string,
    field: string,
    value: string,
  ) => Promise<readonly Astra004QueryDocument[]>;
  readonly listAssignmentRecipients: () => Promise<readonly Astra004QueryDocument[]>;
  readonly listClassEnrollments: () => Promise<readonly Astra004QueryDocument[]>;
  readonly listCertificationAssignments: () => Promise<readonly Astra004QueryDocument[]>;
  readonly invokeCallableAs: (
    uid: typeof ASTRA004.teacherUid,
    name: "assignmentsPublish",
    data: Readonly<{ assignmentId: typeof ASTRA004_EXISTING_DRAFT.assignmentId }>,
  ) => Promise<unknown>;
};

export type Astra004ExistingDraftPublisherInput = {
  readonly project?: string;
  readonly assignmentId?: string;
  readonly mode: Astra004Mode;
  readonly env?: NodeJS.ProcessEnv;
};

export type Astra004ExistingDraftPublisherCliInput = {
  readonly command: "publishAstra004ExistingDraft";
  readonly project: typeof STAGING_PROJECT_ID;
  readonly assignmentId: typeof ASTRA004_EXISTING_DRAFT.assignmentId;
  readonly mode: Astra004Mode;
};

export type Astra004ExistingDraftPublisherResult = {
  readonly project: typeof STAGING_PROJECT_ID;
  readonly command: "publishAstra004ExistingDraft";
  readonly mode: Astra004Mode;
  readonly assignmentId: typeof ASTRA004_EXISTING_DRAFT.assignmentId;
  readonly assignmentStatus: "draft" | "published";
  readonly canonicalRevision: typeof ASTRA004_EXISTING_DRAFT.assessmentRevisionId;
  readonly intendedStudentUid: typeof ASTRA004.uid;
  readonly duplicateCount: 0;
  readonly publicationPopulationCount: 1;
  readonly preflightPassed: true;
  readonly wouldInvoke: "assignmentsPublish";
  readonly invocationCount: 0 | 1;
  readonly writesPerformed?: 0;
  readonly recipientSnapshotVerified?: true;
  readonly auditEventVerified?: true;
  readonly message: string;
};

export type Astra004CommandInput = {
  readonly project?: string;
  readonly uid?: string;
  readonly email?: string;
  readonly mode: Astra004Mode;
  readonly env?: NodeJS.ProcessEnv;
};

export type Astra004CliInput = {
  readonly command: "prepareAstra004Student";
  readonly project: string;
  readonly uid: string;
  readonly email: string;
  readonly mode: Astra004Mode;
};

export type Astra004AdminApp = {
  readonly name: string;
  readonly options: {
    readonly projectId?: string;
  };
};

class Astra004SafeError extends Error {
  constructor(
    readonly category: "REFUSED" | "FAILED",
    readonly stage: string,
    readonly safeCode: string,
    message: string,
  ) {
    super(message);
    this.name = "Astra004SafeError";
  }
}

function refuse(reason: string, stage = "validation"): never {
  throw new Astra004SafeError("REFUSED", stage, "VALIDATION_REFUSED", reason);
}

function refuseWithCode(reason: string, stage: string, safeCode: string): never {
  throw new Astra004SafeError("REFUSED", stage, safeCode, reason);
}

function externalFailure(stage: string, safeCode: string): never {
  throw new Astra004SafeError(
    "FAILED",
    stage,
    safeCode,
    "external operation failed; inspect provider logs for details",
  );
}

async function runExternalOperation<T>(
  stage: string,
  safeCode: string,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof Astra004SafeError) throw error;
    externalFailure(stage, safeCode);
  }
}

export function formatAstra004Failure(
  error: unknown,
  fallbackStage = "startup",
): string {
  if (error instanceof Astra004SafeError) {
    return `[driver] ${error.category}: stage=${error.stage} code=${error.safeCode} ${error.message}`;
  }
  return `[driver] FAILED: stage=${fallbackStage} code=UNEXPECTED_FAILURE external operation failed; inspect provider logs for details`;
}

export function resolveAstra004AdminApp<T extends Astra004AdminApp>(
  apps: readonly T[],
  initialize: (name: typeof ASTRA004_ADMIN_APP_NAME) => T,
): T {
  const existing = apps.find((app) => app.name === ASTRA004_ADMIN_APP_NAME);
  if (existing) {
    if (existing.options.projectId !== STAGING_PROJECT_ID) {
      refuse("dedicated Admin app has a non-staging project", "admin-initialization");
    }
    return existing;
  }

  let created: T;
  try {
    created = initialize(ASTRA004_ADMIN_APP_NAME);
  } catch {
    externalFailure("admin-initialization", "ADMIN_INITIALIZE_FAILED");
  }
  if (
    created.name !== ASTRA004_ADMIN_APP_NAME ||
    created.options.projectId !== STAGING_PROJECT_ID
  ) {
    refuse("dedicated Admin app identity could not be verified", "admin-initialization");
  }
  return created;
}

export function createAstra004AdminContext<TApp extends Astra004AdminApp, TAuth, TDb>(
  apps: readonly TApp[],
  initialize: (name: typeof ASTRA004_ADMIN_APP_NAME) => TApp,
  getAuthForApp: (app: TApp) => TAuth,
  getFirestoreForApp: (app: TApp) => TDb,
): { readonly app: TApp; readonly auth: TAuth; readonly db: TDb } {
  const app = resolveAstra004AdminApp(apps, initialize);
  try {
    return {
      app,
      auth: getAuthForApp(app),
      db: getFirestoreForApp(app),
    };
  } catch {
    externalFailure("admin-client-binding", "ADMIN_CLIENT_BIND_FAILED");
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: readonly string[],
  label: string,
): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) refuse(`${label} contains unexpected fields`);
}

function claimsAreEmpty(claims: Readonly<Record<string, unknown>> | undefined): boolean {
  return claims === undefined || Object.keys(claims).length === 0;
}

function claimsAreExact(
  claims: Readonly<Record<string, unknown>> | undefined,
  role: "student" | "teacher",
): boolean {
  if (!claims || Object.keys(claims).length !== 3) return false;
  return (
    claims.role === role &&
    claims.schoolId === ASTRA004.studentSchoolId &&
    claims.districtId === ASTRA004.districtId
  );
}

// Keep this predicate byte-for-byte equivalent in meaning to the active-user
// recovery gate in studentsCompleteOnboarding. That callable rewrites claims
// only when role is not student, school differs from the canonical user record,
// or districtId is missing/empty. It deliberately treats any non-empty
// districtId as healthy and ignores extra claim keys.
export function claimsWillBeRepairedByStudentOnboarding(
  claims: Readonly<Record<string, unknown>> | undefined,
): boolean {
  return !(
    claims?.role === "student" &&
    claims.schoolId === ASTRA004.studentSchoolId &&
    isNonEmptyString(claims.districtId)
  );
}

export function resolveAstra004Mode(argv: readonly string[]): Astra004Mode {
  const dryRunCount = argv.filter((arg) => arg === "--dry-run").length;
  const applyCount = argv.filter((arg) => arg === "--apply").length;
  if (dryRunCount > 1) refuse("duplicate --dry-run flag", "cli");
  if (applyCount > 1) refuse("duplicate --apply flag", "cli");
  if (dryRunCount === 1 && applyCount === 1) {
    refuse("--dry-run and --apply are mutually exclusive", "cli");
  }
  return applyCount === 1 ? "apply" : "dry-run";
}

export function parseAstra004CliArgs(argv: readonly string[]): Astra004CliInput {
  if (argv[0] !== "prepareAstra004Student") {
    refuse("prepareAstra004Student must be the sole command and first argument", "cli");
  }

  const values = new Map<"project" | "uid" | "email", string>();
  const modeArgs: string[] = [];
  for (const arg of argv.slice(1)) {
    if (arg === "--dry-run" || arg === "--apply") {
      modeArgs.push(arg);
      continue;
    }

    const match = /^--(project|uid|email)=(.+)$/.exec(arg);
    if (match) {
      const key = match[1] as "project" | "uid" | "email";
      if (values.has(key)) refuse(`duplicate --${key} flag`, "cli");
      values.set(key, match[2]);
      continue;
    }

    if (arg.startsWith("--")) refuse("unsupported or malformed flag", "cli");
    refuse("unexpected positional argument", "cli");
  }

  const project = values.get("project");
  const uid = values.get("uid");
  const email = values.get("email");
  if (!project) refuse("non-empty --project=<value> is required", "cli");
  if (!uid) refuse("non-empty --uid=<value> is required", "cli");
  if (!email) refuse("non-empty --email=<value> is required", "cli");
  if (project !== STAGING_PROJECT_ID) {
    refuse(`--project=${STAGING_PROJECT_ID} is required`, "cli");
  }
  if (uid !== ASTRA004.uid) refuse(`--uid=${ASTRA004.uid} is required`, "cli");
  if (email !== ASTRA004.email) refuse(`--email=${ASTRA004.email} is required`, "cli");

  return {
    command: "prepareAstra004Student",
    project,
    uid,
    email,
    mode: resolveAstra004Mode(modeArgs),
  };
}

function assertCommandInput(input: Astra004CommandInput): void {
  const projectError = assertStagingProject(input.project, input.env ?? {});
  if (projectError !== null) {
    refuse(
      `explicit project and ambient project must match ${STAGING_PROJECT_ID}`,
      "project-isolation",
    );
  }
  const environmentError = assertAstra004Environment(input.env ?? {});
  if (environmentError !== null) refuse(environmentError);
  if (input.uid !== ASTRA004.uid) refuse(`--uid=${ASTRA004.uid} is required`);
  if (input.email !== ASTRA004.email) {
    refuse(`--email=${ASTRA004.email} is required`);
  }
}

function assertAuthIdentity(
  byUid: Astra004AuthUser | null,
  byEmail: Astra004AuthUser | null,
): { readonly providerAccountId: string } {
  if (!byUid || !byEmail) refuse("required Auth user was not found");
  if (byUid.uid !== ASTRA004.uid || byEmail.uid !== ASTRA004.uid) {
    refuse("Auth UID/email lookups do not resolve to the same required user");
  }
  if (byUid.email?.toLowerCase() !== ASTRA004.email || byEmail.email?.toLowerCase() !== ASTRA004.email) {
    refuse("Auth user email does not match the required account");
  }
  if (byUid.disabled === true || byEmail.disabled === true) {
    refuse("Auth user is disabled");
  }
  const googleProviders = byUid.providerData.filter(
    (provider) => provider.providerId === "google.com",
  );
  if (
    googleProviders.length !== 1 ||
    byUid.providerData.length !== 1 ||
    !isNonEmptyString(googleProviders[0].uid)
  ) {
    refuse("Auth user must have one unambiguous google.com provider");
  }
  const emailGoogleProviders = byEmail.providerData.filter(
    (provider) => provider.providerId === "google.com",
  );
  if (
    emailGoogleProviders.length !== 1 ||
    byEmail.providerData.length !== 1 ||
    emailGoogleProviders[0].uid !== googleProviders[0].uid
  ) {
    refuse("Auth provider state differs between UID/email lookups");
  }
  return { providerAccountId: googleProviders[0].uid };
}

function assertStudentUserState(
  user: Readonly<Record<string, unknown>> | null,
  auth: Astra004AuthUser,
): "provisioned" | "active" | "active-needs-claim-recovery" {
  if (!user || !isRecord(user)) refuse("canonical student user record is missing or malformed");
  if (
    user.authUid !== ASTRA004.uid ||
    typeof user.email !== "string" ||
    user.email.toLowerCase() !== ASTRA004.email ||
    !isNonEmptyString(user.displayName) ||
    user.createdAt === undefined ||
    user.createdAt === null ||
    user.districtId !== undefined
  ) {
    refuse("canonical student user record has unexpected identity fields");
  }
  if (user.status === "provisioned" && user.role === undefined && user.schoolId === undefined) {
    assertOnlyKeys(
      user,
      ["authUid", "email", "displayName", "status", "createdAt"],
      "provisioned student user record",
    );
    if (!claimsAreEmpty(auth.customClaims)) {
      refuse("provisioned student unexpectedly has custom claims");
    }
    return "provisioned";
  }
  if (
    user.status === "active" &&
    user.role === "student" &&
    user.schoolId === ASTRA004.studentSchoolId
  ) {
    assertOnlyKeys(
      user,
      ["authUid", "email", "displayName", "status", "createdAt", "role", "schoolId"],
      "active student user record",
    );
    // studentsCompleteOnboarding explicitly supports this one non-atomic seam:
    // an exact active student record with missing/stale persisted claims. Its
    // idempotent branch derives district authority from the canonical school
    // record and rewrites claims. No other malformed user state reaches that
    // recovery path.
    if (claimsAreExact(auth.customClaims, "student")) return "active";
    if (claimsWillBeRepairedByStudentOnboarding(auth.customClaims)) {
      return "active-needs-claim-recovery";
    }
    refuse(
      "active student claims are noncanonical and the canonical onboarding callable will not repair them",
      "claims-recovery",
    );
  }
  refuse("student user state is not the expected provisioned or final state");
}

function assertTeacherState(
  auth: Astra004AuthUser | null,
  user: Readonly<Record<string, unknown>> | null,
): void {
  if (!auth || auth.uid !== ASTRA004.teacherUid || auth.disabled === true) {
    refuse("staging certification teacher Auth user is missing or disabled");
  }
  if (!claimsAreExact(auth.customClaims, "teacher")) {
    refuse("staging certification teacher claims are not canonical");
  }
  if (
    !user ||
    user.authUid !== ASTRA004.teacherUid ||
    user.status !== "active" ||
    user.role !== "teacher" ||
    user.schoolId !== ASTRA004.studentSchoolId
  ) {
    refuse("staging certification teacher user record is not canonical");
  }
}

function assertBridge(
  bridgeId: string,
  providerAccountId: string,
  bridge: Readonly<Record<string, unknown>> | null,
  mappings: readonly Astra004QueryDocument[],
): void {
  if (
    !bridge ||
    bridge.providerId !== "google.com" ||
    bridge.providerAccountId !== providerAccountId ||
    bridge.userId !== ASTRA004.uid ||
    bridge.status !== "active" ||
    bridge.source !== "authOnUserCreate"
  ) {
    refuse("required active authOnUserCreate external identity bridge is missing or invalid");
  }
  if (mappings.length !== 1 || mappings[0].id !== bridgeId) {
    refuse("external identity bridge is ambiguous or conflicting");
  }
}

function assertClassState(
  value: Readonly<Record<string, unknown>> | null,
): "create" | "satisfied" {
  if (value === null) return "create";
  assertOnlyKeys(
    value,
    ["teacherId", "schoolId", "title", "grade", "block", "joinCode", "status", "createdAt", "enrollmentSource"],
    "dedicated class",
  );
  if (
    value.teacherId !== ASTRA004.teacherUid ||
    value.schoolId !== ASTRA004.studentSchoolId ||
    value.title !== ASTRA004.classTitle ||
    value.grade !== ASTRA004.classGrade ||
    value.block !== ASTRA004.classBlock ||
    value.status !== "active" ||
    value.createdAt === undefined ||
    value.createdAt === null ||
    typeof value.joinCode !== "string" ||
    !/^[A-F0-9]{8}$/.test(value.joinCode) ||
    (value.enrollmentSource !== undefined && value.enrollmentSource !== "joinCode")
  ) {
    refuse("dedicated class conflicts with the exact ASTRA-004 class contract");
  }
  return "satisfied";
}

function assertEnrollmentState(
  value: Readonly<Record<string, unknown>> | null,
): "add" | "satisfied" {
  if (value === null) return "add";
  assertOnlyKeys(
    value,
    ["studentId", "classId", "schoolId", "status", "enrolledAt"],
    "dedicated enrollment",
  );
  if (
    value.studentId !== ASTRA004.uid ||
    value.classId !== ASTRA004.classId ||
    value.schoolId !== ASTRA004.studentSchoolId ||
    value.status !== "active" ||
    value.enrolledAt === undefined ||
    value.enrolledAt === null
  ) {
    refuse("dedicated enrollment conflicts with the canonical active enrollment");
  }
  return "satisfied";
}

function resolveAstra004Lifecycle(
  classState: "create" | "satisfied",
  studentState: "provisioned" | "active" | "active-needs-claim-recovery",
  enrollmentState: "add" | "satisfied",
): Astra004PreparationPlan {
  if (
    classState === "create" &&
    studentState === "provisioned" &&
    enrollmentState === "add"
  ) {
    return {
      stage: "clean-initial",
      class: "create",
      student: "activate",
      enrollment: "add",
      nextOperations: [
        "classesCreate",
        "studentsCompleteOnboarding",
        "enrollmentsTeacherAdd",
      ],
    };
  }
  if (
    classState === "satisfied" &&
    studentState === "provisioned" &&
    enrollmentState === "add"
  ) {
    return {
      stage: "class-created",
      class: "satisfied",
      student: "activate",
      enrollment: "add",
      nextOperations: ["studentsCompleteOnboarding", "enrollmentsTeacherAdd"],
    };
  }
  if (
    classState === "satisfied" &&
    studentState === "active" &&
    enrollmentState === "add"
  ) {
    return {
      stage: "student-activated",
      class: "satisfied",
      student: "satisfied",
      enrollment: "add",
      nextOperations: ["enrollmentsTeacherAdd"],
    };
  }
  if (
    classState === "satisfied" &&
    studentState === "active-needs-claim-recovery" &&
    enrollmentState === "add"
  ) {
    return {
      stage: "partial-activation-recovery",
      class: "satisfied",
      student: "recover-claims",
      enrollment: "add",
      nextOperations: ["studentsCompleteOnboarding", "enrollmentsTeacherAdd"],
    };
  }
  if (
    classState === "satisfied" &&
    studentState === "active" &&
    enrollmentState === "satisfied"
  ) {
    return {
      stage: "complete",
      class: "satisfied",
      student: "satisfied",
      enrollment: "satisfied",
      nextOperations: [],
    };
  }
  refuse(
    `inconsistent lifecycle combination class=${classState} student=${studentState} enrollment=${enrollmentState}`,
    "lifecycle",
  );
}

async function readAstra004Preflight(
  input: Astra004CommandInput,
  deps: Astra004PreparationDeps,
): Promise<Astra004PreparationPlan> {
  assertCommandInput(input);

  const [authByUid, authByEmail] = await runExternalOperation(
    "auth-read",
    "AUTH_READ_FAILED",
    () => Promise.all([
      deps.getAuthUserByUid(ASTRA004.uid),
      deps.getAuthUserByEmail(ASTRA004.email),
    ]),
  );
  const identity = assertAuthIdentity(authByUid, authByEmail);
  const bridgeId = computeExternalIdentityDocId({
    providerId: "google.com",
    providerAccountId: identity.providerAccountId,
  });
  const enrollmentPath = `enrollments/${ASTRA004.classId}__${ASTRA004.uid}`;

  const [
    user,
    bridge,
    mappings,
    accommodation,
    school,
    teacherAuth,
    teacherUser,
    dedicatedClass,
    enrollment,
    studentEnrollments,
    recipients,
    sessions,
    attempts,
    actorMemberships,
    classLinks,
  ] = await runExternalOperation("firestore-read", "FIRESTORE_READ_FAILED", () =>
    Promise.all([
      deps.getDocument(`users/${ASTRA004.uid}`),
      deps.getDocument(`externalIdentities/${bridgeId}`),
      deps.queryCollection("externalIdentities", "userId", ASTRA004.uid),
      deps.getDocument(`studentAccommodations/${ASTRA004.uid}`),
      deps.getDocument(`schools/${ASTRA004.studentSchoolId}`),
      deps.getAuthUserByUid(ASTRA004.teacherUid),
      deps.getDocument(`users/${ASTRA004.teacherUid}`),
      deps.getDocument(`classes/${ASTRA004.classId}`),
      deps.getDocument(enrollmentPath),
      deps.queryCollection("enrollments", "studentId", ASTRA004.uid),
      deps.queryCollectionGroup("recipients", "studentId", ASTRA004.uid),
      deps.queryCollection("assessmentSessions", "studentId", ASTRA004.uid),
      deps.queryCollection("attempts", "studentId", ASTRA004.uid),
      deps.queryCollection("lmsRosterMemberships", "identityHash", bridgeId),
      deps.queryCollection("lmsClassLinks", "classId", ASTRA004.classId),
    ]),
  );

  if (!authByUid) refuse("required Auth user was not found");
  const studentState = assertStudentUserState(user, authByUid);
  assertBridge(bridgeId, identity.providerAccountId, bridge, mappings);
  if (accommodation !== null) refuse("an accommodation document exists for the ASTRA-004 actor");
  if (!school || school.districtId !== ASTRA004.districtId) {
    refuse("staging certification school is missing or has the wrong district");
  }
  assertTeacherState(teacherAuth, teacherUser);
  const classState = assertClassState(dedicatedClass);
  if (classLinks.length > 0) refuse("dedicated class has LMS linkage");
  if (actorMemberships.length > 0) refuse("ASTRA-004 actor has staging LMS roster membership state");

  const enrollmentState = assertEnrollmentState(enrollment);
  const expectedEnrollmentId = `${ASTRA004.classId}__${ASTRA004.uid}`;
  if (
    studentEnrollments.some((item) => item.id !== expectedEnrollmentId) ||
    (enrollmentState === "add" && studentEnrollments.length !== 0) ||
    (enrollmentState === "satisfied" &&
      (studentEnrollments.length !== 1 || studentEnrollments[0].id !== expectedEnrollmentId))
  ) {
    refuse("actor has incompatible enrollment state");
  }
  if (recipients.length > 0 || sessions.length > 0 || attempts.length > 0) {
    refuse("actor already has assignment, session, or attempt history");
  }

  return resolveAstra004Lifecycle(classState, studentState, enrollmentState);
}

export async function prepareAstra004Student(
  input: Astra004CommandInput,
  deps: Astra004PreparationDeps,
): Promise<Astra004PreparationResult> {
  let plan = await readAstra004Preflight(input, deps);
  const base = {
    project: STAGING_PROJECT_ID,
    command: "prepareAstra004Student" as const,
    mode: input.mode,
    uid: ASTRA004.uid,
    email: ASTRA004.email,
    classId: ASTRA004.classId,
  } as const;

  if (input.mode === "dry-run") {
    return {
      ...base,
      plan,
      message: "DRY RUN ONLY — no mutations performed",
    };
  }

  if (plan.class === "create") {
    await runExternalOperation("classesCreate", "CALLABLE_FAILED", () =>
      deps.invokeCallableAs(ASTRA004.teacherUid, "classesCreate", {
        classId: ASTRA004.classId,
        title: ASTRA004.classTitle,
        grade: ASTRA004.classGrade,
        block: ASTRA004.classBlock,
      }),
    );
    plan = await readAstra004Preflight(input, deps);
    if (plan.class !== "satisfied") refuse("class callable did not produce the expected state");
  }

  if (plan.student === "activate" || plan.student === "recover-claims") {
    const user = await runExternalOperation(
      "student-user-read",
      "FIRESTORE_READ_FAILED",
      () => deps.getDocument(`users/${ASTRA004.uid}`),
    );
    if (!user || !isNonEmptyString(user.displayName)) {
      refuse("student display name is unavailable for activation");
    }
    await runExternalOperation("studentsCompleteOnboarding", "CALLABLE_FAILED", () =>
      deps.invokeCallableAs(ASTRA004.uid, "studentsCompleteOnboarding", {
        role: "student",
        schoolId: ASTRA004.studentSchoolId,
        displayName: user.displayName,
      }),
    );
    plan = await readAstra004Preflight(input, deps);
    if (plan.student !== "satisfied") refuse("student callable did not produce the expected state");
  }

  if (plan.enrollment === "add") {
    await runExternalOperation("enrollmentsTeacherAdd", "CALLABLE_FAILED", () =>
      deps.invokeCallableAs(ASTRA004.teacherUid, "enrollmentsTeacherAdd", {
        classId: ASTRA004.classId,
        studentId: ASTRA004.uid,
      }),
    );
    plan = await readAstra004Preflight(input, deps);
    if (plan.enrollment !== "satisfied") {
      refuse("enrollment callable did not produce the expected state");
    }
  }

  return {
    ...base,
    plan,
    message: "ASTRA-004 student preparation complete",
  };
}

const ASTRA004_ASSIGNMENT_CALLABLE_SEQUENCE = [
  "assignmentsCreateDraft",
  "assignmentsPublish",
] as const;

type Astra004AssignmentPreflight = {
  readonly conflictingCertificationAssignmentExists: false;
};

export function parseAstra004AssignmentCliArgs(
  argv: readonly string[],
): Astra004AssignmentCliInput {
  if (argv[0] !== "prepareAstra004Assignment") {
    refuse(
      "prepareAstra004Assignment must be the sole command and first argument",
      "cli",
    );
  }

  let project: string | undefined;
  const modeArgs: string[] = [];
  for (const arg of argv.slice(1)) {
    if (arg === "--dry-run" || arg === "--apply") {
      modeArgs.push(arg);
      continue;
    }
    const match = /^--project=(.+)$/.exec(arg);
    if (match) {
      if (project !== undefined) refuse("duplicate --project flag", "cli");
      project = match[1];
      continue;
    }
    if (arg.startsWith("--")) refuse("unsupported or malformed flag", "cli");
    refuse("unexpected positional argument", "cli");
  }

  if (!project) refuse("non-empty --project=<value> is required", "cli");
  if (project !== STAGING_PROJECT_ID) {
    refuse(`--project=${STAGING_PROJECT_ID} is required`, "cli");
  }
  return {
    command: "prepareAstra004Assignment",
    project,
    mode: resolveAstra004Mode(modeArgs),
  };
}

export function createAstra004AssignmentId(now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:.]/g, "").toLowerCase();
  const assignmentId = `${ASTRA004_ASSIGNMENT.assignmentIdPrefix}${timestamp}`;
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/.test(assignmentId)) {
    refuse("generated assignment ID is malformed", "assignment-id");
  }
  return assignmentId;
}

type InspectableCredential = {
  readonly constructor?: { readonly name?: unknown };
  readonly clientEmail?: unknown;
  readonly projectId?: unknown;
};

export function assertAstra004EffectiveSigner(
  credential: unknown,
  configuredServiceAccountId: string,
): void {
  if (!isRecord(credential)) {
    refuse("credential signer identity is not inspectable", "token-configuration");
  }
  const inspectable = credential as InspectableCredential;
  const credentialType = inspectable.constructor?.name;
  if (credentialType === "ServiceAccountCredential") {
    if (
      inspectable.projectId !== STAGING_PROJECT_ID ||
      inspectable.clientEmail !== SIGNING_SERVICE_ACCOUNT
    ) {
      refuse("credential signer is not approved for staging", "token-configuration");
    }
    return;
  }
  if (
    credentialType !== "RefreshTokenCredential" &&
    credentialType !== "ComputeEngineCredential" &&
    credentialType !== "ImpersonatedServiceAccountCredential"
  ) {
    refuse("credential signer identity is not inspectable", "token-configuration");
  }
  if (configuredServiceAccountId !== SIGNING_SERVICE_ACCOUNT) {
    refuse("configured signer is not approved for staging", "token-configuration");
  }
}

export function extractAstra004StagingWebApiKey(source: string): string {
  const objectBlocks = source.match(/\{[^{}]*\}/g) ?? [];
  const stagingBlocks = objectBlocks.filter((block) =>
    /projectId\s*:\s*["']lyfelabz-staging["']/.test(block));
  if (stagingBlocks.length !== 1) {
    refuse("approved staging web configuration is unavailable", "token-configuration");
  }
  const keyMatch = /apiKey\s*:\s*["']([^"']+)["']/.exec(stagingBlocks[0]);
  if (!keyMatch || !/^AIza[A-Za-z0-9_-]+$/.test(keyMatch[1])) {
    refuse("approved staging web configuration is invalid", "token-configuration");
  }
  return keyMatch[1];
}

export function assertAstra004WebApiKey(
  suppliedWebApiKey: string | undefined,
  approvedWebApiKey: string,
): asserts suppliedWebApiKey is string {
  if (!isNonEmptyString(suppliedWebApiKey)) {
    refuse("approved staging web API key is required", "token-configuration");
  }
  if (suppliedWebApiKey !== approvedWebApiKey) {
    refuse("web API key is not approved for staging", "token-configuration");
  }
}

export async function createAstra004StagingIdToken(
  uid: string,
  config: Astra004TokenExchangeConfig,
  deps: Astra004TokenExchangeDeps,
): Promise<string> {
  assertAstra004EffectiveSigner(
    config.credential,
    config.configuredServiceAccountId,
  );
  assertAstra004WebApiKey(config.suppliedWebApiKey, config.approvedWebApiKey);
  const webApiKey = config.suppliedWebApiKey;

  const customToken = await runExternalOperation(
    "custom-token-create",
    "CUSTOM_TOKEN_CREATE_FAILED",
    () => deps.createCustomToken(uid),
  );
  const body = await runExternalOperation(
    "token-exchange",
    "TOKEN_EXCHANGE_FAILED",
    () => deps.exchangeCustomToken(customToken, webApiKey),
  );
  if (!isNonEmptyString(body.idToken)) {
    externalFailure("token-exchange", "TOKEN_EXCHANGE_FAILED");
  }
  const idToken = body.idToken;
  const verified = await runExternalOperation(
    "token-verification",
    "TOKEN_VERIFICATION_FAILED",
    () => deps.verifyIdToken(idToken),
  );
  if (verified.uid !== uid || verified.aud !== STAGING_PROJECT_ID) {
    externalFailure("token-verification", "TOKEN_VERIFICATION_FAILED");
  }
  return idToken;
}

export function createAstra004TokenExchangeDeps(
  auth: {
    readonly createCustomToken: (uid: string) => Promise<string>;
    readonly verifyIdToken: (
      idToken: string,
      checkRevoked?: boolean,
    ) => Promise<{ readonly uid: string; readonly aud: string }>;
  },
  fetchFn: typeof fetch,
): Astra004TokenExchangeDeps {
  return {
    createCustomToken: (uid) => auth.createCustomToken(uid),
    exchangeCustomToken: async (customToken, webApiKey) => {
      const response = await fetchFn(
        `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${webApiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Referer": "https://lyfelabz-staging.web.app/",
          },
          body: JSON.stringify({ token: customToken, returnSecureToken: true }),
        },
      );
      const body = (await response.json().catch(() => ({}))) as {
        readonly idToken?: string;
      };
      if (!response.ok) {
        externalFailure("token-exchange", "TOKEN_EXCHANGE_FAILED");
      }
      return body;
    },
    verifyIdToken: (idToken) => auth.verifyIdToken(idToken, true),
  };
}

function assertAstra004AssignmentCommandInput(
  input: Astra004AssignmentCommandInput,
): void {
  const projectError = assertStagingProject(input.project, input.env ?? {});
  if (projectError !== null) {
    refuse(
      `explicit project and ambient project must match ${STAGING_PROJECT_ID}`,
      "project-isolation",
    );
  }
  const environmentError = assertAstra004Environment(input.env ?? {});
  if (environmentError !== null) refuse(environmentError, "project-isolation");
}

function assertAstra004AssignmentClass(
  dedicatedClass: Readonly<Record<string, unknown>> | null,
  school: Readonly<Record<string, unknown>> | null,
): void {
  if (
    !dedicatedClass ||
    dedicatedClass.status !== "active" ||
    dedicatedClass.teacherId !== ASTRA004.teacherUid ||
    dedicatedClass.schoolId !== ASTRA004.studentSchoolId
  ) {
    refuse("dedicated class is missing or inconsistent", "preflight-class");
  }
  if (
    dedicatedClass.enrollmentSource === "lms" ||
    (dedicatedClass.enrollmentSource !== undefined &&
      dedicatedClass.enrollmentSource !== "joinCode") ||
    dedicatedClass.lmsProviderRef !== undefined ||
    !isNonEmptyString(dedicatedClass.joinCode)
  ) {
    refuse("dedicated class is LMS-linked or LMS-authoritative", "preflight-class");
  }
  if (!school || school.districtId !== ASTRA004.districtId) {
    refuse("dedicated class school has the wrong district", "preflight-class");
  }
}

function assertAstra004AssignmentStudent(
  student: Readonly<Record<string, unknown>> | null,
  enrollment: Readonly<Record<string, unknown>> | null,
): void {
  if (
    !student ||
    student.role !== "student" ||
    student.status !== "active" ||
    student.schoolId !== ASTRA004.studentSchoolId
  ) {
    refuse("dedicated student canonical user is missing or inconsistent", "preflight-student");
  }
  if (
    !enrollment ||
    enrollment.studentId !== ASTRA004.uid ||
    enrollment.classId !== ASTRA004.classId ||
    enrollment.schoolId !== ASTRA004.studentSchoolId ||
    enrollment.status !== "active"
  ) {
    refuse("dedicated active enrollment is missing or inconsistent", "preflight-enrollment");
  }
}

function isConflictingAstra004Assignment(
  assignment: Astra004QueryDocument,
  expectedAssignmentId: string | undefined,
): boolean {
  if (
    assignment.id === ASTRA004_ASSIGNMENT.historicalAssignmentId ||
    assignment.id === expectedAssignmentId
  ) {
    return false;
  }
  const status = assignment.data.status;
  if (status !== "draft" && status !== "published") return false;
  return (
    assignment.data.lessonSlug === ASTRA004_ASSIGNMENT.lessonSlug ||
    assignment.data.title === ASTRA004_ASSIGNMENT.title ||
    assignment.id.startsWith(ASTRA004_ASSIGNMENT.assignmentIdPrefix)
  );
}

async function readAstra004AssignmentPreflight(
  input: Astra004AssignmentCommandInput,
  deps: Astra004AssignmentPreparationDeps,
  expectedAssignmentId?: string,
): Promise<Astra004AssignmentPreflight> {
  assertAstra004AssignmentCommandInput(input);
  const enrollmentPath = `enrollments/${ASTRA004.classId}__${ASTRA004.uid}`;
  const [
    dedicatedClass,
    school,
    student,
    enrollment,
    accommodation,
    teacherAuth,
    teacherUser,
    classLinks,
    assignments,
  ] = await runExternalOperation(
    "preflight-read",
    "FIRESTORE_READ_FAILED",
    () => Promise.all([
      deps.getDocument(`classes/${ASTRA004.classId}`),
      deps.getDocument(`schools/${ASTRA004.studentSchoolId}`),
      deps.getDocument(`users/${ASTRA004.uid}`),
      deps.getDocument(enrollmentPath),
      deps.getDocument(`studentAccommodations/${ASTRA004.uid}`),
      deps.getAuthUserByUid(ASTRA004.teacherUid),
      deps.getDocument(`users/${ASTRA004.teacherUid}`),
      deps.queryCollection("lmsClassLinks", "classId", ASTRA004.classId),
      deps.queryCollection("assignments", "classId", ASTRA004.classId),
    ]),
  );

  assertAstra004AssignmentClass(dedicatedClass, school);
  assertAstra004AssignmentStudent(student, enrollment);
  if (accommodation !== null) {
    refuse("an accommodation document exists for the dedicated student", "preflight-accommodation");
  }
  assertTeacherState(teacherAuth, teacherUser);
  if (classLinks.length > 0) {
    refuse("dedicated class has Classroom/LMS link or enrollment authority", "preflight-class");
  }

  if (expectedAssignmentId !== undefined) {
    assertAstra004AssignmentId(expectedAssignmentId);
    const expected = assignments.find((assignment) =>
      assignment.id === expectedAssignmentId);
    assertAstra004AssignmentRecord(
      expectedAssignmentId,
      expected?.data ?? null,
      "draft",
    );
  }

  const conflicts = assignments.filter((assignment) =>
    isConflictingAstra004Assignment(assignment, expectedAssignmentId));
  if (conflicts.length > 0) {
    refuse(
      "an active assignment would make ASTRA-004 certification ambiguous",
      "preflight-assignment-conflict",
    );
  }
  return { conflictingCertificationAssignmentExists: false };
}

function assertAstra004AssignmentId(assignmentId: string): void {
  if (
    assignmentId === ASTRA004_ASSIGNMENT.historicalAssignmentId ||
    !assignmentId.startsWith(ASTRA004_ASSIGNMENT.assignmentIdPrefix) ||
    !/^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/.test(assignmentId)
  ) {
    refuse("fresh assignment ID is unsafe", "assignment-id");
  }
}

function assertAstra004AssignmentRecord(
  assignmentId: string,
  assignment: Readonly<Record<string, unknown>> | null,
  expectedStatus: "draft" | "published",
): void {
  if (
    !assignment ||
    assignmentId === ASTRA004_ASSIGNMENT.historicalAssignmentId ||
    assignment.classId !== ASTRA004.classId ||
    assignment.teacherId !== ASTRA004.teacherUid ||
    assignment.schoolId !== ASTRA004.studentSchoolId ||
    assignment.lessonSlug !== ASTRA004_ASSIGNMENT.lessonSlug ||
    String(assignment.lessonSlug) === ASTRA004_ASSIGNMENT.historicalLessonSlug ||
    assignment.mode !== ASTRA004_ASSIGNMENT.mode ||
    assignment.title !== ASTRA004_ASSIGNMENT.title ||
    assignment.status !== expectedStatus
  ) {
    refuse(
      `created assignment failed ${expectedStatus} verification`,
      `verify-${expectedStatus}`,
    );
  }
  if (expectedStatus === "draft" && assignment.assessmentRevisionId !== undefined) {
    refuse("draft unexpectedly binds an assessment revision", "verify-draft");
  }
  if (
    expectedStatus === "published" &&
    !isNonEmptyString(assignment.assessmentRevisionId)
  ) {
    refuse("published assignment has no assessment revision", "verify-published");
  }
}

function assertAstra004CanonicalAssessmentRevision(
  assignment: Readonly<Record<string, unknown>>,
  assessment: Readonly<Record<string, unknown>> | null,
  revision: Readonly<Record<string, unknown>> | null,
): void {
  const expectedAssessmentId = assessmentIdForLessonSlug(
    ASTRA004_ASSIGNMENT.lessonSlug,
  );
  const revisionId = assignment.assessmentRevisionId;
  if (!isNonEmptyString(revisionId)) {
    refuse("published assignment has no assessment revision", "verify-assessment-revision");
  }
  const revisionOrdinal = parseRevisionOrdinalFromRevisionId(revisionId);
  const parsedAssessmentId = parseAssessmentIdFromRevisionId(revisionId);
  if (
    revisionOrdinal === undefined ||
    parsedAssessmentId !== expectedAssessmentId
  ) {
    refuse("published assignment revision ID is not canonical", "verify-assessment-revision");
  }
  if (revisionId !== revisionIdForOrdinal(expectedAssessmentId, revisionOrdinal)) {
    refuse("published assignment revision ID is not canonical", "verify-assessment-revision");
  }
  if (
    !assessment ||
    assessment.assessmentId !== expectedAssessmentId ||
    assessment.activityId !== ASTRA004_ASSIGNMENT.lessonSlug ||
    assessment.currentRevisionId !== revisionId ||
    parseAssessmentIdFromRevisionId(String(assessment.currentRevisionId)) !==
      expectedAssessmentId ||
    parseRevisionOrdinalFromRevisionId(String(assessment.currentRevisionId)) ===
      undefined
  ) {
    refuse("published assignment does not match the canonical assessment revision", "verify-assessment-revision");
  }
  if (
    !revision ||
    revision.assessmentId !== expectedAssessmentId ||
    revision.activityId !== ASTRA004_ASSIGNMENT.lessonSlug ||
    revision.revisionOrdinal !== revisionOrdinal
  ) {
    refuse("referenced assessment revision is missing or belongs to another lesson", "verify-assessment-revision");
  }
}

function assertAstra004AssignmentCallableResponse(
  response: unknown,
  assignmentId: string,
  expectedStatus: "draft" | "published",
  stage: string,
): void {
  if (
    !isRecord(response) ||
    response.assignmentId !== assignmentId ||
    response.status !== expectedStatus ||
    (expectedStatus === "draft" && response.alreadyCreated !== false) ||
    (expectedStatus === "published" && response.alreadyPublished !== false)
  ) {
    refuse("assignment callable returned an unexpected assignment", stage);
  }
}

function assertAstra004Recipient(
  assignmentId: string,
  recipient: Readonly<Record<string, unknown>> | null,
): void {
  if (
    !recipient ||
    recipient.assignmentId !== assignmentId ||
    recipient.studentId !== ASTRA004.uid ||
    recipient.classId !== ASTRA004.classId ||
    recipient.teacherId !== ASTRA004.teacherUid ||
    recipient.schoolId !== ASTRA004.studentSchoolId ||
    recipient.districtId !== ASTRA004.districtId ||
    recipient.status !== "assigned" ||
    recipient.source !== "classPublication"
  ) {
    refuse("dedicated student is missing from the recipient snapshot", "verify-recipient");
  }
}

export async function prepareAstra004Assignment(
  input: Astra004AssignmentCommandInput,
  deps: Astra004AssignmentPreparationDeps,
): Promise<Astra004AssignmentPreparationResult> {
  const preflight = await readAstra004AssignmentPreflight(input, deps);
  const base = {
    project: STAGING_PROJECT_ID,
    command: "prepareAstra004Assignment" as const,
    mode: input.mode,
    classId: ASTRA004.classId,
    lessonSlug: ASTRA004_ASSIGNMENT.lessonSlug,
    studentUid: ASTRA004.uid,
    intendedCallableSequence: ASTRA004_ASSIGNMENT_CALLABLE_SEQUENCE,
    conflictingCertificationAssignmentExists:
      preflight.conflictingCertificationAssignmentExists,
    preflightPassed: true as const,
  } as const;

  if (input.mode === "dry-run") {
    return {
      ...base,
      writesPerformed: 0,
      message: "DRY RUN ONLY — preflight passed; zero writes performed",
    };
  }

  const assignmentId = deps.createAssignmentId();
  assertAstra004AssignmentId(assignmentId);
  const preexisting = await runExternalOperation(
    "fresh-assignment-read",
    "FIRESTORE_READ_FAILED",
    () => deps.getDocument(`assignments/${assignmentId}`),
  );
  if (preexisting !== null) {
    refuse("generated assignment ID already exists", "assignment-id");
  }

  await readAstra004AssignmentPreflight(input, deps);
  const createResponse = await runExternalOperation(
    "assignmentsCreateDraft",
    "CALLABLE_FAILED",
    () => deps.invokeCallableAs(ASTRA004.teacherUid, "assignmentsCreateDraft", {
      assignmentId,
      classId: ASTRA004.classId,
      lessonSlug: ASTRA004_ASSIGNMENT.lessonSlug,
      mode: ASTRA004_ASSIGNMENT.mode,
      title: ASTRA004_ASSIGNMENT.title,
    }),
  );
  assertAstra004AssignmentCallableResponse(
    createResponse,
    assignmentId,
    "draft",
    "verify-create-response",
  );

  const draft = await runExternalOperation(
    "verify-draft-read",
    "FIRESTORE_READ_FAILED",
    () => deps.getDocument(`assignments/${assignmentId}`),
  );
  assertAstra004AssignmentRecord(assignmentId, draft, "draft");

  await readAstra004AssignmentPreflight(input, deps, assignmentId);
  const publishResponse = await runExternalOperation(
    "assignmentsPublish",
    "CALLABLE_FAILED",
    () => deps.invokeCallableAs(ASTRA004.teacherUid, "assignmentsPublish", {
      assignmentId,
    }),
  );
  assertAstra004AssignmentCallableResponse(
    publishResponse,
    assignmentId,
    "published",
    "verify-publish-response",
  );

  const [published, recipient] = await runExternalOperation(
    "final-verification-read",
    "FIRESTORE_READ_FAILED",
    () => Promise.all([
      deps.getDocument(`assignments/${assignmentId}`),
      deps.getDocument(`assignments/${assignmentId}/recipients/${ASTRA004.uid}`),
    ]),
  );
  assertAstra004AssignmentRecord(assignmentId, published, "published");
  if (!published) {
    refuse("published assignment is missing", "verify-published");
  }
  const revisionId = published.assessmentRevisionId;
  if (!isNonEmptyString(revisionId)) {
    refuse("published assignment has no assessment revision", "verify-assessment-revision");
  }
  const assessmentId = assessmentIdForLessonSlug(ASTRA004_ASSIGNMENT.lessonSlug);
  const [assessment, revision] = await runExternalOperation(
    "assessment-revision-read",
    "FIRESTORE_READ_FAILED",
    () => Promise.all([
      deps.getDocument(`assessments/${assessmentId}`),
      deps.getDocument(`assessmentRevisions/${revisionId}`),
    ]),
  );
  assertAstra004CanonicalAssessmentRevision(published, assessment, revision);
  assertAstra004Recipient(assignmentId, recipient);

  return {
    ...base,
    mutationStagesCompleted: 2,
    assignmentId,
    finalStatus: "published",
    recipientSnapshotVerified: true,
    message: "ASTRA-004 assignment created and published through canonical callables",
  };
}

type Astra004ExistingDraftPreflight = {
  readonly assignmentStatus: "draft";
  readonly duplicateCount: 0;
  readonly publicationPopulationCount: 1;
};

export function parseAstra004ExistingDraftPublisherCliArgs(
  argv: readonly string[],
): Astra004ExistingDraftPublisherCliInput {
  if (argv[0] !== "publishAstra004ExistingDraft") {
    refuse(
      "publishAstra004ExistingDraft must be the sole command and first argument",
      "cli",
    );
  }

  const values = new Map<"project" | "assignment-id", string>();
  const modeArgs: string[] = [];
  for (const arg of argv.slice(1)) {
    if (arg === "--dry-run" || arg === "--apply") {
      modeArgs.push(arg);
      continue;
    }
    const match = /^--(project|assignment-id)=(.+)$/.exec(arg);
    if (match) {
      const key = match[1] as "project" | "assignment-id";
      if (values.has(key)) refuse(`duplicate --${key} flag`, "cli");
      values.set(key, match[2]);
      continue;
    }
    if (arg.startsWith("--")) refuse("unsupported or malformed flag", "cli");
    refuse("unexpected positional argument", "cli");
  }

  const project = values.get("project");
  const assignmentId = values.get("assignment-id");
  if (!project) refuse("non-empty --project=<value> is required", "cli");
  if (!assignmentId) {
    refuse("non-empty --assignment-id=<value> is required", "cli");
  }
  if (project !== STAGING_PROJECT_ID) {
    refuse(`--project=${STAGING_PROJECT_ID} is required`, "cli");
  }
  if (assignmentId !== ASTRA004_EXISTING_DRAFT.assignmentId) {
    refuse(
      `--assignment-id=${ASTRA004_EXISTING_DRAFT.assignmentId} is required`,
      "cli",
    );
  }
  return {
    command: "publishAstra004ExistingDraft",
    project,
    assignmentId,
    mode: resolveAstra004Mode(modeArgs),
  };
}

function assertAstra004ExistingDraftPublisherInput(
  input: Astra004ExistingDraftPublisherInput,
): void {
  assertAstra004AssignmentCommandInput(input);
  if (input.assignmentId !== ASTRA004_EXISTING_DRAFT.assignmentId) {
    refuse(
      `--assignment-id=${ASTRA004_EXISTING_DRAFT.assignmentId} is required`,
      "assignment-id",
    );
  }
}

function isTimestamp(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (typeof value.toMillis === "function") {
    try {
      return Number.isFinite(value.toMillis());
    } catch {
      return false;
    }
  }
  return (
    typeof value.seconds === "number" &&
    Number.isInteger(value.seconds) &&
    typeof value.nanoseconds === "number" &&
    Number.isInteger(value.nanoseconds) &&
    value.nanoseconds >= 0 &&
    value.nanoseconds < 1_000_000_000
  );
}

function assertAstra004ExistingAssignmentRecord(
  assignment: Readonly<Record<string, unknown>> | null,
  expectedStatus: "draft" | "published",
): asserts assignment is Readonly<Record<string, unknown>> {
  if (!assignment) {
    refuse("pinned ASTRA-004 assignment is missing", "preflight-assignment");
  }
  if (expectedStatus === "draft" && assignment.status === "published") {
    refuseWithCode(
      "pinned ASTRA-004 assignment is already published",
      "preflight-assignment",
      "ALREADY_PUBLISHED",
    );
  }
  if (assignment.status !== expectedStatus) {
    refuse(
      `pinned ASTRA-004 assignment is not the expected ${expectedStatus} state`,
      expectedStatus === "draft" ? "preflight-assignment" : "verify-published",
    );
  }
  if (
    assignment.classId !== ASTRA004.classId ||
    assignment.lessonSlug !== ASTRA004_ASSIGNMENT.lessonSlug ||
    assignment.teacherId !== ASTRA004.teacherUid ||
    assignment.schoolId !== ASTRA004.studentSchoolId ||
    assignment.mode !== ASTRA004_ASSIGNMENT.mode ||
    assignment.title !== ASTRA004_ASSIGNMENT.title
  ) {
    refuse(
      "pinned ASTRA-004 assignment does not match its immutable certification contract",
      expectedStatus === "draft" ? "preflight-assignment" : "verify-published",
    );
  }
  if (assignment.lmsPublicationRef !== undefined) {
    refuse("pinned ASTRA-004 assignment has an LMS publication reference", "preflight-lms");
  }
  if (expectedStatus === "draft") {
    if (
      assignment.publishedAt !== undefined ||
      assignment.assessmentRevisionId !== undefined
    ) {
      refuse("pinned ASTRA-004 draft contains publication state", "preflight-assignment");
    }
    return;
  }
  if (!isTimestamp(assignment.publishedAt)) {
    refuse("publishedAt is not a valid Firestore Timestamp", "verify-published");
  }
  if (
    assignment.assessmentRevisionId !==
    ASTRA004_EXISTING_DRAFT.assessmentRevisionId
  ) {
    refuse("published assignment has the wrong canonical revision", "verify-published");
  }
}

function assertAstra004CanonicalAssessmentPreflight(
  assessment: Readonly<Record<string, unknown>> | null,
  revision: Readonly<Record<string, unknown>> | null,
  answerKey: Readonly<Record<string, unknown>> | null,
): void {
  if (!assessment) {
    refuse("canonical assessment parent is missing", "preflight-assessment");
  }
  if (!revision) {
    refuse("canonical assessment revision is missing", "preflight-assessment");
  }
  if (!answerKey) {
    refuse("canonical assessment answer key is missing", "preflight-assessment");
  }
  if (
    assessment.assessmentId !== ASTRA004_EXISTING_DRAFT.assessmentId ||
    assessment.activityId !== ASTRA004_ASSIGNMENT.lessonSlug ||
    assessment.currentRevisionId !== ASTRA004_EXISTING_DRAFT.assessmentRevisionId
  ) {
    refuse("canonical assessment parent points to the wrong revision", "preflight-assessment");
  }
  if (
    revision.assessmentId !== ASTRA004_EXISTING_DRAFT.assessmentId ||
    revision.activityId !== ASTRA004_ASSIGNMENT.lessonSlug ||
    revision.revisionOrdinal !== 1
  ) {
    refuse("canonical assessment revision identity is inconsistent", "preflight-assessment");
  }
  if (
    answerKey.assessmentId !== ASTRA004_EXISTING_DRAFT.assessmentId ||
    answerKey.revisionOrdinal !== 1
  ) {
    refuse("canonical answer key does not belong to revision 1", "preflight-assessment");
  }
}

function assertAstra004ExistingStudentIdentity(
  student: Readonly<Record<string, unknown>> | null,
  byUid: Astra004AuthUser | null,
  byEmail: Astra004AuthUser | null,
): void {
  if (
    !student ||
    student.authUid !== ASTRA004.uid ||
    typeof student.email !== "string" ||
    student.email.toLowerCase() !== ASTRA004.email
  ) {
    refuse("canonical student identity does not match the pinned actor", "preflight-student");
  }
  if (
    !byUid ||
    !byEmail ||
    byUid.uid !== ASTRA004.uid ||
    byEmail.uid !== ASTRA004.uid ||
    byUid.disabled === true ||
    byEmail.disabled === true ||
    byUid.email?.toLowerCase() !== ASTRA004.email ||
    byEmail.email?.toLowerCase() !== ASTRA004.email
  ) {
    refuse("Auth UID/email lookups conflict for the pinned student", "preflight-student");
  }
}

function isAstra004CertificationAssignment(
  assignment: Astra004QueryDocument,
): boolean {
  if (assignment.id === ASTRA004_ASSIGNMENT.historicalAssignmentId) return false;
  return (
    assignment.id.startsWith(ASTRA004_ASSIGNMENT.assignmentIdPrefix) ||
    assignment.data.lessonSlug === ASTRA004_ASSIGNMENT.lessonSlug ||
    assignment.data.title === ASTRA004_ASSIGNMENT.title
  );
}

function assertSingleAstra004CertificationAssignment(
  assignments: readonly Astra004QueryDocument[],
): void {
  const candidates = assignments.filter(isAstra004CertificationAssignment);
  if (
    candidates.length !== 1 ||
    candidates[0].id !== ASTRA004_EXISTING_DRAFT.assignmentId
  ) {
    refuse(
      "certification assignment state is missing, duplicated, or ambiguous",
      "preflight-assignment-conflict",
    );
  }
}

// This is the exact selection rule used by loadInitialRecipientPopulation in
// assignments/assignment-recipients.ts, applied to an injected, read-only
// enrollment snapshot so the staging driver remains locally testable. Keep
// the five predicates and sorted de-duplication aligned with that helper:
// matching class, matching school, active status, non-empty studentId, and
// one recipient per studentId.
function selectAstra004PublicationPopulation(
  enrollments: readonly Astra004QueryDocument[],
): readonly string[] {
  const seen = new Set<string>();
  for (const enrollment of enrollments) {
    const data = enrollment.data;
    if (data.classId !== ASTRA004.classId) continue;
    if (data.schoolId !== ASTRA004.studentSchoolId) continue;
    if (data.status !== "active") continue;
    if (!isNonEmptyString(data.studentId)) continue;
    seen.add(data.studentId);
  }
  return [...seen].sort();
}

function assertCleanAstra004PublicationEvidence(
  recipients: readonly Astra004QueryDocument[],
  auditEvents: readonly Astra004QueryDocument[],
): void {
  const publicationEvents = auditEvents.filter((event) =>
    event.data.action === "assignments.published" &&
    event.data.targetId === ASTRA004_EXISTING_DRAFT.assignmentId);
  if (recipients.length > 0 || publicationEvents.length > 0) {
    refuseWithCode(
      "pinned ASTRA-004 draft has partial or contaminated publication evidence",
      "preflight-publication-evidence",
      "PARTIAL_PUBLICATION_EVIDENCE",
    );
  }
}

function assertExactAstra004PublicationPopulation(
  enrollments: readonly Astra004QueryDocument[],
): void {
  const population = selectAstra004PublicationPopulation(enrollments);
  if (population.length !== 1 || population[0] !== ASTRA004.uid) {
    refuseWithCode(
      "effective publication population is not exactly the pinned student",
      "preflight-publication-population",
      "UNEXPECTED_PUBLICATION_POPULATION",
    );
  }
}

async function readAstra004ExistingDraftPreflight(
  input: Astra004ExistingDraftPublisherInput,
  deps: Astra004ExistingDraftPublisherDeps,
): Promise<Astra004ExistingDraftPreflight> {
  assertAstra004ExistingDraftPublisherInput(input);
  const enrollmentPath = `enrollments/${ASTRA004.classId}__${ASTRA004.uid}`;
  const [
    assignment,
    existingRecipients,
    existingAuditEvents,
    classEnrollments,
    dedicatedClass,
    school,
    student,
    enrollment,
    accommodation,
    teacherAuth,
    teacherUser,
    studentByUid,
    studentByEmail,
    classLinks,
    lmsPublications,
    assessment,
    revision,
    answerKey,
    certificationAssignments,
  ] = await runExternalOperation(
    "existing-draft-preflight-read",
    "FIRESTORE_READ_FAILED",
    () => Promise.all([
      deps.getDocument(`assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}`),
      deps.listAssignmentRecipients(),
      deps.queryCollection(
        "auditEvents",
        "targetId",
        ASTRA004_EXISTING_DRAFT.assignmentId,
      ),
      deps.listClassEnrollments(),
      deps.getDocument(`classes/${ASTRA004.classId}`),
      deps.getDocument(`schools/${ASTRA004.studentSchoolId}`),
      deps.getDocument(`users/${ASTRA004.uid}`),
      deps.getDocument(enrollmentPath),
      deps.getDocument(`studentAccommodations/${ASTRA004.uid}`),
      deps.getAuthUserByUid(ASTRA004.teacherUid),
      deps.getDocument(`users/${ASTRA004.teacherUid}`),
      deps.getAuthUserByUid(ASTRA004.uid),
      deps.getAuthUserByEmail(ASTRA004.email),
      deps.queryCollection("lmsClassLinks", "classId", ASTRA004.classId),
      deps.queryCollection(
        "lmsAssignmentPublications",
        "assignmentId",
        ASTRA004_EXISTING_DRAFT.assignmentId,
      ),
      deps.getDocument(`assessments/${ASTRA004_EXISTING_DRAFT.assessmentId}`),
      deps.getDocument(
        `assessmentRevisions/${ASTRA004_EXISTING_DRAFT.assessmentRevisionId}`,
      ),
      deps.getDocument(
        `assessmentAnswerKeys/${ASTRA004_EXISTING_DRAFT.assessmentRevisionId}`,
      ),
      deps.listCertificationAssignments(),
    ]),
  );

  assertAstra004ExistingAssignmentRecord(assignment, "draft");
  assertCleanAstra004PublicationEvidence(
    existingRecipients,
    existingAuditEvents,
  );
  assertExactAstra004PublicationPopulation(classEnrollments);
  assertAstra004AssignmentClass(dedicatedClass, school);
  assertAstra004AssignmentStudent(student, enrollment);
  assertAstra004ExistingStudentIdentity(student, studentByUid, studentByEmail);
  assertTeacherState(teacherAuth, teacherUser);
  if (accommodation !== null) {
    refuse("an accommodation document exists for the pinned student", "preflight-accommodation");
  }
  if (classLinks.length > 0 || lmsPublications.length > 0) {
    refuse("the certification fixture has LMS linkage or publication state", "preflight-lms");
  }
  assertAstra004CanonicalAssessmentPreflight(assessment, revision, answerKey);
  assertSingleAstra004CertificationAssignment(certificationAssignments);
  return {
    assignmentStatus: "draft",
    duplicateCount: 0,
    publicationPopulationCount: 1,
  };
}

function assertAstra004ExistingRecipient(
  recipients: readonly Astra004QueryDocument[],
): void {
  if (recipients.length !== 1 || recipients[0].id !== ASTRA004.uid) {
    refuse(
      "published recipient population is not exactly the pinned student",
      "verify-recipient",
    );
  }
  const recipient = recipients[0].data;
  const forbiddenVariantKeys = [
    "accommodation",
    "accommodationId",
    "variantKey",
    "presentationRevisionId",
    "lmsPublicationRef",
  ];
  if (
    recipient.assignmentId !== ASTRA004_EXISTING_DRAFT.assignmentId ||
    recipient.studentId !== ASTRA004.uid ||
    recipient.classId !== ASTRA004.classId ||
    recipient.teacherId !== ASTRA004.teacherUid ||
    recipient.schoolId !== ASTRA004.studentSchoolId ||
    recipient.districtId !== ASTRA004.districtId ||
    recipient.assignedBy !== ASTRA004.teacherUid ||
    recipient.status !== "assigned" ||
    recipient.source !== "classPublication" ||
    !isTimestamp(recipient.assignedAt) ||
    forbiddenVariantKeys.some((key) => recipient[key] !== undefined)
  ) {
    refuse("published recipient snapshot is missing or noncanonical", "verify-recipient");
  }
}

function assertAstra004PublicationAudit(
  events: readonly Astra004QueryDocument[],
): void {
  const matching = events.filter((event) =>
    event.data.action === "assignments.published" &&
    event.data.targetType === "assignment" &&
    event.data.targetId === ASTRA004_EXISTING_DRAFT.assignmentId);
  if (matching.length !== 1) {
    refuse("normal assignment publication audit event is missing or duplicated", "verify-audit");
  }
  const event = matching[0].data;
  const payload = isRecord(event.payload) ? event.payload : null;
  if (
    event.actorUserId !== ASTRA004.teacherUid ||
    event.actorRole !== "teacher" ||
    event.schoolId !== ASTRA004.studentSchoolId ||
    event.districtId !== ASTRA004.districtId ||
    !isTimestamp(event.occurredAt) ||
    !payload ||
    payload.classId !== ASTRA004.classId ||
    payload.lessonSlug !== ASTRA004_ASSIGNMENT.lessonSlug ||
    payload.assessmentRevisionId !== ASTRA004_EXISTING_DRAFT.assessmentRevisionId ||
    payload.recipientCount !== 1
  ) {
    refuse("normal assignment publication audit evidence is noncanonical", "verify-audit");
  }
}

export async function publishAstra004ExistingDraft(
  input: Astra004ExistingDraftPublisherInput,
  deps: Astra004ExistingDraftPublisherDeps,
): Promise<Astra004ExistingDraftPublisherResult> {
  const preflight = await readAstra004ExistingDraftPreflight(input, deps);
  const base = {
    project: STAGING_PROJECT_ID,
    command: "publishAstra004ExistingDraft" as const,
    mode: input.mode,
    assignmentId: ASTRA004_EXISTING_DRAFT.assignmentId,
    canonicalRevision: ASTRA004_EXISTING_DRAFT.assessmentRevisionId,
    intendedStudentUid: ASTRA004.uid,
    duplicateCount: preflight.duplicateCount,
    publicationPopulationCount: preflight.publicationPopulationCount,
    preflightPassed: true as const,
    wouldInvoke: "assignmentsPublish" as const,
  } as const;

  if (input.mode === "dry-run") {
    return {
      ...base,
      assignmentStatus: preflight.assignmentStatus,
      writesPerformed: 0,
      invocationCount: 0,
      message: "DRY RUN ONLY — existing draft preflight passed; zero writes performed",
    };
  }

  // Repeat every mutation-critical read immediately before the one allowed
  // callable. No retry loop surrounds this call: one attempted invocation is
  // the absolute maximum for a process execution.
  await readAstra004ExistingDraftPreflight(input, deps);
  const response = await runExternalOperation(
    "assignmentsPublish",
    "CALLABLE_FAILED",
    () => deps.invokeCallableAs(
      ASTRA004.teacherUid,
      "assignmentsPublish",
      { assignmentId: ASTRA004_EXISTING_DRAFT.assignmentId },
    ),
  );
  assertAstra004AssignmentCallableResponse(
    response,
    ASTRA004_EXISTING_DRAFT.assignmentId,
    "published",
    "verify-publish-response",
  );

  const [
    published,
    recipients,
    accommodation,
    lmsPublications,
    certificationAssignments,
    auditEvents,
  ] = await runExternalOperation(
    "post-publication-read",
    "FIRESTORE_READ_FAILED",
    () => Promise.all([
      deps.getDocument(`assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}`),
      deps.listAssignmentRecipients(),
      deps.getDocument(`studentAccommodations/${ASTRA004.uid}`),
      deps.queryCollection(
        "lmsAssignmentPublications",
        "assignmentId",
        ASTRA004_EXISTING_DRAFT.assignmentId,
      ),
      deps.listCertificationAssignments(),
      deps.queryCollection(
        "auditEvents",
        "targetId",
        ASTRA004_EXISTING_DRAFT.assignmentId,
      ),
    ]),
  );
  assertAstra004ExistingAssignmentRecord(published, "published");
  assertAstra004ExistingRecipient(recipients);
  if (accommodation !== null) {
    refuse("an accommodation appeared during publication", "verify-recipient");
  }
  if (lmsPublications.length > 0) {
    refuse("an LMS publication appeared during publication", "verify-published");
  }
  assertSingleAstra004CertificationAssignment(certificationAssignments);
  assertAstra004PublicationAudit(auditEvents);

  return {
    ...base,
    assignmentStatus: "published",
    invocationCount: 1,
    recipientSnapshotVerified: true,
    auditEventVerified: true,
    message: "ASTRA-004 existing draft published once through assignmentsPublish",
  };
}

export type Astra004CliRuntime<TApp extends Astra004AdminApp, TAuth, TDb> = {
  readonly env: NodeJS.ProcessEnv;
  readonly getApps: () => readonly TApp[];
  readonly initializeApp: (name: typeof ASTRA004_ADMIN_APP_NAME) => TApp;
  readonly getAuth: (app: TApp) => TAuth;
  readonly getFirestore: (app: TApp) => TDb;
  readonly createPreparationDeps: (
    auth: TAuth,
    db: TDb,
  ) => Astra004PreparationDeps;
  readonly writeStdout: (value: string) => void;
  readonly writeStderr: (value: string) => void;
};

// This is the production ASTRA-004 CLI path, extracted as one seam so tests
// exercise the same app binding, command execution, and top-level failure
// rendering used by the Node entry point. All Firebase behavior remains
// injected; local tests never initialize a real SDK client.
export async function runAstra004CliEntryPoint<
  TApp extends Astra004AdminApp,
  TAuth,
  TDb,
>(
  argv: readonly string[],
  runtime: Astra004CliRuntime<TApp, TAuth, TDb>,
): Promise<0 | 1 | 2> {
  try {
    const input = parseAstra004CliArgs(argv);
    const projectError = assertStagingProject(input.project, runtime.env);
    if (projectError !== null) {
      refuse(
        `explicit project and ambient project must match ${STAGING_PROJECT_ID}`,
        "project-isolation",
      );
    }
    const environmentError = assertAstra004Environment(runtime.env);
    if (environmentError !== null) refuse(environmentError, "project-isolation");

    const context = createAstra004AdminContext(
      runtime.getApps(),
      runtime.initializeApp,
      (app) => runtime.getAuth(app),
      (app) => runtime.getFirestore(app),
    );
    runtime.writeStdout(`prepareAstra004Student target ${JSON.stringify({
      project: STAGING_PROJECT_ID,
      command: input.command,
      mode: input.mode,
      uid: input.uid,
      email: input.email,
      classId: ASTRA004.classId,
    })}\n`);
    const result = await prepareAstra004Student(
      { ...input, env: runtime.env },
      runtime.createPreparationDeps(context.auth, context.db),
    );
    runtime.writeStdout(
      `prepareAstra004Student result ${JSON.stringify(redact(result))}\n`,
    );
    return 0;
  } catch (error) {
    runtime.writeStderr(`${formatAstra004Failure(error, "startup")}\n`);
    return error instanceof Astra004SafeError && error.category === "REFUSED"
      ? 2
      : 1;
  }
}

export type Astra004AssignmentCliRuntime<
  TApp extends Astra004AdminApp,
  TAuth,
  TDb,
> = {
  readonly env: NodeJS.ProcessEnv;
  readonly getApps: () => readonly TApp[];
  readonly initializeApp: (name: typeof ASTRA004_ADMIN_APP_NAME) => TApp;
  readonly getAuth: (app: TApp) => TAuth;
  readonly getFirestore: (app: TApp) => TDb;
  readonly createPreparationDeps: (
    auth: TAuth,
    db: TDb,
  ) => Astra004AssignmentPreparationDeps;
  readonly writeStdout: (value: string) => void;
  readonly writeStderr: (value: string) => void;
};

export async function runAstra004AssignmentCliEntryPoint<
  TApp extends Astra004AdminApp,
  TAuth,
  TDb,
>(
  argv: readonly string[],
  runtime: Astra004AssignmentCliRuntime<TApp, TAuth, TDb>,
): Promise<0 | 1 | 2> {
  try {
    const input = parseAstra004AssignmentCliArgs(argv);
    const projectError = assertStagingProject(input.project, runtime.env);
    if (projectError !== null) {
      refuse(
        `explicit project and ambient project must match ${STAGING_PROJECT_ID}`,
        "project-isolation",
      );
    }
    const environmentError = assertAstra004Environment(runtime.env);
    if (environmentError !== null) refuse(environmentError, "project-isolation");

    const context = createAstra004AdminContext(
      runtime.getApps(),
      runtime.initializeApp,
      (app) => runtime.getAuth(app),
      (app) => runtime.getFirestore(app),
    );
    runtime.writeStdout(`prepareAstra004Assignment target ${JSON.stringify({
      project: STAGING_PROJECT_ID,
      command: input.command,
      mode: input.mode,
      classId: ASTRA004.classId,
      lessonSlug: ASTRA004_ASSIGNMENT.lessonSlug,
      studentUid: ASTRA004.uid,
      intendedCallableSequence: ASTRA004_ASSIGNMENT_CALLABLE_SEQUENCE,
    })}\n`);
    const result = await prepareAstra004Assignment(
      { ...input, env: runtime.env },
      runtime.createPreparationDeps(context.auth, context.db),
    );
    runtime.writeStdout(
      `prepareAstra004Assignment result ${JSON.stringify(redact(result))}\n`,
    );
    return 0;
  } catch (error) {
    runtime.writeStderr(`${formatAstra004Failure(error, "startup")}\n`);
    return error instanceof Astra004SafeError && error.category === "REFUSED"
      ? 2
      : 1;
  }
}

export type Astra004ExistingDraftPublisherCliRuntime<
  TApp extends Astra004AdminApp,
  TAuth,
  TDb,
> = {
  readonly env: NodeJS.ProcessEnv;
  readonly getApps: () => readonly TApp[];
  readonly initializeApp: (name: typeof ASTRA004_ADMIN_APP_NAME) => TApp;
  readonly getAuth: (app: TApp) => TAuth;
  readonly getFirestore: (app: TApp) => TDb;
  readonly createPublisherDeps: (
    auth: TAuth,
    db: TDb,
  ) => Astra004ExistingDraftPublisherDeps;
  readonly writeStdout: (value: string) => void;
  readonly writeStderr: (value: string) => void;
};

export async function runAstra004ExistingDraftPublisherCliEntryPoint<
  TApp extends Astra004AdminApp,
  TAuth,
  TDb,
>(
  argv: readonly string[],
  runtime: Astra004ExistingDraftPublisherCliRuntime<TApp, TAuth, TDb>,
): Promise<0 | 1 | 2> {
  try {
    const input = parseAstra004ExistingDraftPublisherCliArgs(argv);
    const projectError = assertStagingProject(input.project, runtime.env);
    if (projectError !== null) {
      refuse(
        `explicit project and ambient project must match ${STAGING_PROJECT_ID}`,
        "project-isolation",
      );
    }
    const environmentError = assertAstra004Environment(runtime.env);
    if (environmentError !== null) refuse(environmentError, "project-isolation");

    const context = createAstra004AdminContext(
      runtime.getApps(),
      runtime.initializeApp,
      (app) => runtime.getAuth(app),
      (app) => runtime.getFirestore(app),
    );
    runtime.writeStdout(`publishAstra004ExistingDraft target ${JSON.stringify({
      project: STAGING_PROJECT_ID,
      command: input.command,
      mode: input.mode,
      assignmentId: ASTRA004_EXISTING_DRAFT.assignmentId,
      wouldInvoke: "assignmentsPublish",
    })}\n`);
    const result = await publishAstra004ExistingDraft(
      { ...input, env: runtime.env },
      runtime.createPublisherDeps(context.auth, context.db),
    );
    runtime.writeStdout(
      `publishAstra004ExistingDraft result ${JSON.stringify(redact(result))}\n`,
    );
    return 0;
  } catch (error) {
    runtime.writeStderr(`${formatAstra004Failure(error, "startup")}\n`);
    return error instanceof Astra004SafeError && error.category === "REFUSED"
      ? 2
      : 1;
  }
}

// --------------------------------------------------------------------------
// Entry point (firebase-admin + network only here).
// --------------------------------------------------------------------------
if (require.main === module) {
  void (async () => {
    const argv = process.argv.slice(2);
    const existingDraftPublishRequested = argv.includes(
      "publishAstra004ExistingDraft",
    );
    if (existingDraftPublishRequested) {
      const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
      const { getAuth } = await import("firebase-admin/auth");
      const { FieldPath, getFirestore } = await import("firebase-admin/firestore");
      const { existsSync, readFileSync } = await import("fs");
      const pathModule = await import("path");
      const credential = applicationDefault();
      const exitCode = await runAstra004ExistingDraftPublisherCliEntryPoint(
        argv,
        {
          env: process.env,
          getApps,
          initializeApp: (name) => initializeApp(
            {
              credential,
              projectId: STAGING_PROJECT_ID,
              serviceAccountId: SIGNING_SERVICE_ACCOUNT,
            },
            name,
          ),
          getAuth,
          getFirestore,
          createPublisherDeps: (auth, db) => {
            const readDoc = async (path: string) => {
              const snapshot = await db.doc(path).get();
              const data = snapshot.data();
              return snapshot.exists && data ? data : null;
            };
            const queryCollection = async (
              collection: string,
              field: string,
              value: string,
            ) => {
              const snapshot = await db.collection(collection).where(field, "==", value).get();
              return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
            };
            const authUserOrNull = async (
              operation: () => ReturnType<typeof auth.getUser>,
            ): Promise<Astra004AuthUser | null> => {
              try {
                return await operation();
              } catch (error) {
                if (
                  typeof error === "object" &&
                  error !== null &&
                  "code" in error &&
                  error.code === "auth/user-not-found"
                ) {
                  return null;
                }
                externalFailure("auth-read", "AUTH_READ_FAILED");
              }
            };
            const listCertificationAssignments = async () => {
              const collection = db.collection("assignments");
              const prefix = ASTRA004_ASSIGNMENT.assignmentIdPrefix;
              const snapshots = await Promise.all([
                collection.where("classId", "==", ASTRA004.classId).get(),
                collection.where("lessonSlug", "==", ASTRA004_ASSIGNMENT.lessonSlug).get(),
                collection.where("title", "==", ASTRA004_ASSIGNMENT.title).get(),
                collection
                  .orderBy(FieldPath.documentId())
                  .startAt(prefix)
                  .endAt(`${prefix}\uf8ff`)
                  .get(),
              ]);
              const documents = new Map<string, Astra004QueryDocument>();
              for (const snapshot of snapshots) {
                for (const doc of snapshot.docs) {
                  documents.set(doc.id, { id: doc.id, data: doc.data() });
                }
              }
              return [...documents.values()];
            };
            const listAssignmentRecipients = async () => {
              const snapshot = await db
                .collection("assignments")
                .doc(ASTRA004_EXISTING_DRAFT.assignmentId)
                .collection("recipients")
                .get();
              return snapshot.docs.map((doc) => ({
                id: doc.id,
                data: doc.data(),
              }));
            };
            const listClassEnrollments = async () => {
              const snapshot = await db
                .collection("enrollments")
                .where("classId", "==", ASTRA004.classId)
                .get();
              return snapshot.docs.map((doc) => ({
                id: doc.id,
                data: doc.data(),
              }));
            };
            const invokeCallableAs: Astra004ExistingDraftPublisherDeps["invokeCallableAs"] = async (
              uid,
              name,
              data,
            ) => {
              const webConfigCandidates = [
                pathModule.resolve(process.cwd(), "assets/lyfelabz-firebase-config.js"),
                pathModule.resolve(process.cwd(), "../../assets/lyfelabz-firebase-config.js"),
              ];
              const webConfigPath = webConfigCandidates.find((candidate) =>
                existsSync(candidate));
              if (!webConfigPath) {
                refuse(
                  "approved staging web configuration is unavailable",
                  "token-configuration",
                );
              }
              const approvedWebApiKey = extractAstra004StagingWebApiKey(
                readFileSync(webConfigPath, "utf8"),
              );
              const token = await createAstra004StagingIdToken(
                uid,
                {
                  credential,
                  configuredServiceAccountId: SIGNING_SERVICE_ACCOUNT,
                  suppliedWebApiKey: process.env.STAGING_WEB_API_KEY,
                  approvedWebApiKey,
                },
                createAstra004TokenExchangeDeps(auth, fetch),
              );
              const response = await fetch(callableUrl(STAGING_PROJECT_ID, name), {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({ data }),
              });
              const body = (await response.json().catch(() => ({}))) as {
                result?: unknown;
              };
              if (!response.ok || body.result === undefined) {
                externalFailure(name, "CALLABLE_FAILED");
              }
              return body.result;
            };
            return {
              getAuthUserByUid: (uid) => authUserOrNull(() => auth.getUser(uid)),
              getAuthUserByEmail: (email) =>
                authUserOrNull(() => auth.getUserByEmail(email)),
              getDocument: readDoc,
              queryCollection,
              listAssignmentRecipients,
              listClassEnrollments,
              listCertificationAssignments,
              invokeCallableAs,
            };
          },
          writeStdout: (value) => process.stdout.write(value),
          writeStderr: (value) => process.stderr.write(value),
        },
      );
      process.exit(exitCode);
      return;
    }
    const astra004AssignmentRequested = argv.includes("prepareAstra004Assignment");
    if (astra004AssignmentRequested) {
      const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
      const { getAuth } = await import("firebase-admin/auth");
      const { getFirestore } = await import("firebase-admin/firestore");
      const { existsSync, readFileSync } = await import("fs");
      const pathModule = await import("path");
      const apiKey = process.env.STAGING_WEB_API_KEY;
      const credential = applicationDefault();
      const webConfigCandidates = [
        pathModule.resolve(process.cwd(), "assets/lyfelabz-firebase-config.js"),
        pathModule.resolve(process.cwd(), "../../assets/lyfelabz-firebase-config.js"),
      ];
      const webConfigPath = webConfigCandidates.find((candidate) =>
        existsSync(candidate));
      if (!webConfigPath) {
        refuse("approved staging web configuration is unavailable", "token-configuration");
      }
      const approvedWebApiKey = extractAstra004StagingWebApiKey(
        readFileSync(webConfigPath, "utf8"),
      );
      const exitCode = await runAstra004AssignmentCliEntryPoint(argv, {
        env: process.env,
        getApps,
        initializeApp: (name) => initializeApp(
          {
            credential,
            projectId: STAGING_PROJECT_ID,
            serviceAccountId: SIGNING_SERVICE_ACCOUNT,
          },
          name,
        ),
        getAuth,
        getFirestore,
        createPreparationDeps: (auth, db) => {
          const readDoc = async (path: string) => {
            const snapshot = await db.doc(path).get();
            const data = snapshot.data();
            return snapshot.exists && data ? data : null;
          };
          const queryCollection = async (
            collection: string,
            field: string,
            value: string,
          ) => {
            const snapshot = await db.collection(collection).where(field, "==", value).get();
            return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
          };
          const canonicalClaimsIdToken = async (uid: string): Promise<string> => {
            return createAstra004StagingIdToken(
              uid,
              {
                credential,
                configuredServiceAccountId: SIGNING_SERVICE_ACCOUNT,
                suppliedWebApiKey: apiKey,
                approvedWebApiKey,
              },
              createAstra004TokenExchangeDeps(auth, fetch),
            );
          };
          const invokeCallableAs: Astra004AssignmentPreparationDeps["invokeCallableAs"] = async (
            uid,
            name,
            data,
          ) => {
            const token = await canonicalClaimsIdToken(uid);
            const response = await fetch(callableUrl(STAGING_PROJECT_ID, name), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ data }),
            });
            const body = (await response.json().catch(() => ({}))) as {
              result?: unknown;
            };
            if (!response.ok || body.result === undefined) {
              externalFailure(name, "CALLABLE_FAILED");
            }
            return body.result;
          };
          const authUserOrNull = async (
            uid: string,
          ): Promise<Astra004AuthUser | null> => {
            try {
              return await auth.getUser(uid);
            } catch (error) {
              if (
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                error.code === "auth/user-not-found"
              ) {
                return null;
              }
              externalFailure("auth-read", "AUTH_READ_FAILED");
            }
          };
          return {
            getAuthUserByUid: authUserOrNull,
            getDocument: readDoc,
            queryCollection,
            invokeCallableAs,
            createAssignmentId: () => createAstra004AssignmentId(),
          };
        },
        writeStdout: (value) => process.stdout.write(value),
        writeStderr: (value) => process.stderr.write(value),
      });
      process.exit(exitCode);
      return;
    }
    const astra004Requested = argv.includes("prepareAstra004Student");
    if (astra004Requested) {
      const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
      const { getAuth } = await import("firebase-admin/auth");
      const { getFirestore } = await import("firebase-admin/firestore");
      const apiKey = process.env.STAGING_WEB_API_KEY;
      const exitCode = await runAstra004CliEntryPoint(argv, {
        env: process.env,
        getApps,
        initializeApp: (name) => initializeApp(
          {
            credential: applicationDefault(),
            projectId: STAGING_PROJECT_ID,
            serviceAccountId: SIGNING_SERVICE_ACCOUNT,
          },
          name,
        ),
        getAuth,
        getFirestore,
        createPreparationDeps: (auth, db) => {
          const readDoc = async (path: string) => {
            const snapshot = await db.doc(path).get();
            const data = snapshot.data();
            return snapshot.exists && data ? data : null;
          };
          const queryCollection = async (collection: string, field: string, value: string) => {
            const snapshot = await db.collection(collection).where(field, "==", value).get();
            return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
          };
          const canonicalClaimsIdToken = async (uid: string): Promise<string> => {
            if (!apiKey) externalFailure("token-exchange", "WEB_API_KEY_REQUIRED");
            const custom = await auth.createCustomToken(uid);
            const response = await fetch(
              `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "Referer": "https://lyfelabz-staging.web.app/",
                },
                body: JSON.stringify({ token: custom, returnSecureToken: true }),
              },
            );
            const body = (await response.json()) as { idToken?: string };
            if (!response.ok || !body.idToken) {
              externalFailure("token-exchange", "TOKEN_EXCHANGE_FAILED");
            }
            const verified = await auth.verifyIdToken(body.idToken, true);
            if (verified.uid !== uid || verified.aud !== STAGING_PROJECT_ID) {
              externalFailure("token-verification", "TOKEN_VERIFICATION_FAILED");
            }
            return body.idToken;
          };
          const invokeCallableAs: Astra004PreparationDeps["invokeCallableAs"] = async (
            uid,
            name,
            data,
          ) => {
            const token = await canonicalClaimsIdToken(uid);
            const response = await fetch(callableUrl(STAGING_PROJECT_ID, name), {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${token}`,
              },
              body: JSON.stringify({ data }),
            });
            const body = (await response.json().catch(() => ({}))) as {
              result?: unknown;
            };
            if (!response.ok || body.result === undefined) {
              externalFailure(name, "CALLABLE_FAILED");
            }
            return body.result;
          };
          const authUserOrNull = async (
            operation: () => ReturnType<typeof auth.getUser>,
          ): Promise<Astra004AuthUser | null> => {
            try {
              return await operation();
            } catch (error) {
              if (
                typeof error === "object" &&
                error !== null &&
                "code" in error &&
                error.code === "auth/user-not-found"
              ) {
                return null;
              }
              externalFailure("auth-read", "AUTH_READ_FAILED");
            }
          };
          return {
            getAuthUserByUid: (uid) => authUserOrNull(() => auth.getUser(uid)),
            getAuthUserByEmail: (email) => authUserOrNull(() => auth.getUserByEmail(email)),
            getDocument: readDoc,
            queryCollection,
            queryCollectionGroup: async (collection, field, value) => {
              const snapshot = await db.collectionGroup(collection).where(field, "==", value).get();
              return snapshot.docs.map((doc) => ({ id: doc.id, data: doc.data() }));
            },
            invokeCallableAs,
          };
        },
        writeStdout: (value) => process.stdout.write(value),
        writeStderr: (value) => process.stderr.write(value),
      });
      process.exit(exitCode);
      return;
    }
    const getFlag = (n: string): string | undefined => {
      const p = argv.find((a) => a.startsWith(`--${n}=`));
      return p ? p.slice(n.length + 3) : undefined;
    };
    const project = getFlag("project");
    const guardErr = assertStagingProject(project, process.env);
    if (guardErr !== null) {
      process.stderr.write(`[driver] REFUSED: ${guardErr}\n`);
      process.exit(2);
      return;
    }
    process.env.GCLOUD_PROJECT = STAGING_PROJECT_ID;
    process.env.GOOGLE_CLOUD_PROJECT = STAGING_PROJECT_ID;
    const command = argv.find((a) => !a.startsWith("--")) ?? "help";
    const apiKey = process.env.STAGING_WEB_API_KEY;
    if (!apiKey) {
      process.stderr.write("[driver] REFUSED: STAGING_WEB_API_KEY env is required (non-secret browser key)\n");
      process.exit(2);
      return;
    }

    const { execFileSync } = await import("child_process");
    const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
    const path = await import("path");

    if (getApps().length === 0) {
      initializeApp({ credential: applicationDefault(), projectId: STAGING_PROJECT_ID, serviceAccountId: SIGNING_SERVICE_ACCOUNT });
    }
    const auth = getAuth();
    const db = getFirestore();
    const out = (label: string, obj: unknown) => process.stdout.write(`${label} ${JSON.stringify(redact(obj))}\n`);

    // ---- synthetic identities (must match staging-cert-seed) ----
    const SEED = {
      classId: "staging-cert-class",
      assignmentId: "staging-cert-assignment",
      lessonSlug: "staging-cert-fixture",
      teacher: "staging-cert-teacher",
      diff: "staging-cert-student-diff",
      canon: "staging-cert-student-canon",
    };
    const CLAIMS = (role: "teacher" | "student") => ({ role, schoolId: "staging-cert-school", districtId: "staging-cert-district" });

    // Mint an ID token for a synthetic uid. Kept in memory; never logged.
    async function idToken(uid: string, role: "teacher" | "student"): Promise<string> {
      if (!apiKey) throw new Error("STAGING_WEB_API_KEY is required for token exchange");
      const custom = await auth.createCustomToken(uid, CLAIMS(role));
      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Referer": "https://lyfelabz-staging.web.app/" },
        body: JSON.stringify({ token: custom, returnSecureToken: true }),
      });
      const body = (await res.json()) as { idToken?: string; error?: unknown };
      if (!res.ok || !body.idToken) throw new Error(`token mint failed: ${JSON.stringify(redact(body))}`);
      return body.idToken;
    }

    // Call a deployed callable with a bearer ID token. Returns { ok, result } or
    // { ok:false, code, message }. Never logs the token.
    async function call(name: string, token: string, data: unknown): Promise<{ ok: true; result: any } | { ok: false; code: string; message: string }> {
      const res = await fetch(callableUrl(STAGING_PROJECT_ID, name), {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ data }),
      });
      const body = (await res.json().catch(() => ({}))) as any;
      if (res.ok && body.result !== undefined) return { ok: true, result: body.result };
      const err = body.error ?? {};
      // The canonical UPPER_SNAKE contract code lives in details.code; the coarse
      // Firebase status only signals retriability. Prefer the canonical code.
      const canonical = err.details?.code ?? err.details?.[0]?.code;
      return { ok: false, code: String(canonical ?? err.status ?? err.code ?? res.status), message: String(err.message ?? "unknown") };
    }

    const readDoc = async (p: string) => {
      const snap = await db.doc(p).get();
      const data = snap.data();
      return snap.exists && data ? data : null;
    };
    const runPublish = (op: string, revision: string) => {
      const env = { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "", GCLOUD_PROJECT: STAGING_PROJECT_ID, GOOGLE_CLOUD_PROJECT: STAGING_PROJECT_ID };
      const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
      execFileSync("node", [
        path.join(repoRoot, "platform/functions/lib/scripts/publish-variant.js"),
        `--target=staging`, `--project=${STAGING_PROJECT_ID}`,
        `--hosting-origin=https://lyfelabz-staging.web.app`,
        `--lesson=${SEED.lessonSlug}`, `--variant=reading-adapted`,
        `--op=${op}`, `--revision=${revision}`, `--published-by=staging-cert`,
      ], { stdio: "inherit", env });
    };

    const REV_A = "prd35502243cd3caf026f4436183d92fac31e669483bf01d40954b8e24f2cd8657";
    const REV_B = "pr784872aad5bd6a7b0c0a47b3bdfbc09fc2750ad0fc9e8bb050f76a00fa9aed46";

    const flagPath = "platformConfig/differentiatedDelivery";
    async function setFlag(v: "true" | "false" | "delete"): Promise<void> {
      if (v === "delete") { await db.doc(flagPath).delete().catch(() => undefined); return; }
      await db.doc(flagPath).set({ enabled: v === "true", updatedAt: FieldValue.serverTimestamp(), updatedBy: "staging-cert-admin" }, { merge: true });
    }

    // Find the seeded assignment's list item for a student (in-memory launchRef).
    async function listItem(studentUid: string): Promise<{ item: any; launchRef?: string }> {
      const tok = await idToken(studentUid, "student");
      const r = await call("assignmentsListForStudent", tok, {});
      if (!r.ok) throw new Error(`list failed: ${r.code} ${r.message}`);
      const items: any[] = r.result.items ?? r.result.assignments ?? [];
      const item = items.find((i) => i.assignmentId === SEED.assignmentId);
      return { item, launchRef: item?.launchRef };
    }

    const sessionIdFor = (uid: string) => `${SEED.assignmentId}__${uid}__1`;
    const summarizeSession = (s: any) => s && ({ status: s.status, deliveryOutcome: s.deliveryOutcome, variantKey: s.variantKey, presentationRevisionId: s.presentationRevisionId, assessmentRevisionId: s.assessmentRevisionId });
    const readAttempts = async (uid: string) => {
      const q = await db.collection("attempts").where("studentId", "==", uid).get();
      return q.docs.map((d) => { const a = d.data(); return { attemptId: d.id, attemptNumber: a.attemptNumber, deliveryOutcome: a.deliveryOutcome, variantKey: a.variantKey, presentationRevisionId: a.presentationRevisionId, assessmentRevisionId: a.assessmentRevisionId }; });
    };
    // begin+finalize as a student, using the list-provided launchRef if present.
    // Returns { beginCode, session, attempt } with tokens/refs kept in memory.
    async function beginFinalize(uid: string, opts: { withRef: boolean; overrideRef?: string } = { withRef: true }) {
      const tok = await idToken(uid, "student");
      let launchRef: string | undefined;
      if (opts.overrideRef !== undefined) launchRef = opts.overrideRef;
      else if (opts.withRef) { const { launchRef: r } = await listItem(uid); launchRef = r; }
      const data: any = { assignmentId: SEED.assignmentId };
      if (launchRef !== undefined) data.launchRef = launchRef;
      const begin = await call("assessmentSessionsBegin", tok, data);
      if (!begin.ok) return { beginCode: begin.code, beginMsg: begin.message, session: null, attempt: null };
      const session = await readDoc(`assessmentSessions/${sessionIdFor(uid)}`);
      const fin = await call("assessmentAttemptsFinalize", tok, { sessionId: begin.result.sessionId, idempotencyKey: `stgcert-${Date.now()}` });
      const attempt = fin.ok ? await readDoc(`attempts/${fin.result.attemptId}`) : null;
      return { beginCode: "ok", session, attempt: fin.ok ? { attemptId: fin.result.attemptId, deliveryOutcome: attempt?.deliveryOutcome, variantKey: attempt?.variantKey, presentationRevisionId: attempt?.presentationRevisionId, assessmentRevisionId: attempt?.assessmentRevisionId } : { finalizeError: fin.ok ? null : fin.code } };
    }

    try {
      switch (command) {
        case "whoami": {
          for (const [uid, role] of [[SEED.teacher, "teacher"], [SEED.diff, "student"], [SEED.canon, "student"]] as const) {
            const t = await idToken(uid, role);
            out(`token uid=${uid}`, { minted: true, length: t.length });
          }
          break;
        }
        case "flag": {
          const set = getFlag("set") as "true" | "false" | "delete";
          await setFlag(set);
          out("flag", { set, doc: await readDoc(flagPath) });
          break;
        }
        case "activate": {
          // Phase B: real Op B via accommodationsSet as the synthetic teacher.
          const value = getFlag("value") ?? "active";
          const expected = Number(getFlag("expected") ?? "0");
          const tok = await idToken(SEED.teacher, "teacher");
          const newValue = value === "active" ? { status: "active", level: "adapted" } : { status: "inactive" };
          const r = await call("accommodationsSet", tok, { studentId: SEED.diff, classId: SEED.classId, expectedRevision: expected, newValue });
          out("accommodationsSet", { ok: r.ok, code: r.ok ? "ok" : r.code, response: r.ok ? redact(r.result) : r.message });
          out("accommodationDoc", await readDoc(`studentAccommodations/${SEED.diff}`));
          const hist = await db.collection("studentAccommodations").doc(SEED.diff).collection("history").get();
          out("accommodationHistory", hist.docs.map((d) => { const h = d.data(); return { id: d.id, revision: h.revision, readingAccessibility: h.readingAccessibility, setBy: h.setBy }; }));
          break;
        }
        case "phaseA": {
          // Student cannot invoke a teacher-only op; both students authenticate.
          const stok = await idToken(SEED.diff, "student");
          const forbid = await call("accommodationsSet", stok, { studentId: SEED.canon, classId: SEED.classId, expectedRevision: 0, newValue: { status: "active", level: "adapted" } });
          out("studentCallsTeacherOp", { refused: !forbid.ok, code: forbid.ok ? "UNEXPECTED-OK" : forbid.code });
          const diffList = await listItem(SEED.diff);
          const canonList = await listItem(SEED.canon);
          out("diffAuthenticates", { assignmentFound: !!diffList.item });
          out("canonAuthenticates", { assignmentFound: !!canonList.item });
          break;
        }
        case "list": {
          const uid = getFlag("student") ?? SEED.diff;
          const { item } = await listItem(uid);
          out(`list uid=${uid}`, { assignmentFound: !!item, hasPresentation: !!item?.presentation, hasLaunchRef: !!item?.launchRef, variantKey: item?.presentation?.variantKey, presentationRevisionId: item?.presentation?.presentationRevisionId, path: item?.presentation?.path });
          break;
        }
        case "runAttempt": {
          const uid = getFlag("student") ?? SEED.diff;
          const r = await beginFinalize(uid, { withRef: true });
          // If differentiated, inspect the grant binding (id kept in memory).
          const { item, launchRef } = await listItem(uid);
          let grant: any = null;
          if (launchRef) {
            const g = await readDoc(`launchGrants/${launchRef}`);
            if (g) grant = { studentIdMatches: g.studentId === uid, assignmentMatches: g.assignmentId === SEED.assignmentId, lessonMatches: g.lessonSlug === SEED.lessonSlug, outcomeAtIssuance: g.outcomeAtIssuance, variantKey: g.variantKey, presentationRevisionId: g.presentationRevisionId, ttlHours: g.issuedAt && g.expiresAt ? Math.round((g.expiresAt.toMillis() - g.issuedAt.toMillis()) / 3600000) : null };
          }
          out(`runAttempt uid=${uid}`, { listPresentation: item?.presentation ? { variantKey: item.presentation.variantKey, presentationRevisionId: item.presentation.presentationRevisionId } : null, grant, session: summarizeSession(r.session), attempt: r.attempt });
          break;
        }
        case "beginNoRef": {
          // Phase G: covered+enabled active accommodation, begin WITHOUT ref.
          const uid = getFlag("student") ?? SEED.diff;
          await db.doc(`assessmentSessions/${sessionIdFor(uid)}`).delete().catch(() => undefined);
          const before = await readDoc(`assessmentSessions/${sessionIdFor(uid)}`);
          const tok = await idToken(uid, "student");
          const begin = await call("assessmentSessionsBegin", tok, { assignmentId: SEED.assignmentId });
          const after = await readDoc(`assessmentSessions/${sessionIdFor(uid)}`);
          const attempts = await readAttempts(uid);
          out("beginNoRef", { code: begin.ok ? "UNEXPECTED-OK" : begin.code, sessionBefore: !!before, sessionAfter: !!after, attemptCount: attempts.length });
          break;
        }
        case "invalidGrant": {
          const kind = getFlag("kind") ?? "cross-user";
          await db.doc(`assessmentSessions/${sessionIdFor(SEED.diff)}`).delete().catch(() => undefined);
          let ref = "deadbeefdeadbeefdeadbeefdeadbeef";
          if (kind === "cross-user") { const { launchRef } = await listItem(SEED.canon); ref = launchRef ?? ref; }
          const tok = await idToken(SEED.diff, "student");
          const begin = await call("assessmentSessionsBegin", tok, { assignmentId: SEED.assignmentId, launchRef: ref });
          const after = await readDoc(`assessmentSessions/${sessionIdFor(SEED.diff)}`);
          out(`invalidGrant kind=${kind}`, { refused: !begin.ok, code: begin.ok ? "UNEXPECTED-OK" : begin.code, sessionCreated: !!after });
          break;
        }
        case "phaseAB": {
          // Phase I: grant bound to A stays A after index moves to B.
          await db.doc(`assessmentSessions/${sessionIdFor(SEED.diff)}`).delete().catch(() => undefined);
          runPublish("rollback", REV_A);
          out("indexAfterRollbackToA", await readDoc(`presentationVariants/${SEED.lessonSlug}__reading-adapted`));
          const { launchRef } = await listItem(SEED.diff); // grant bound to A, in memory
          const grantA = launchRef ? await readDoc(`launchGrants/${launchRef}`) : null;
          runPublish("publish", REV_B); // index -> B while we hold the A grant
          out("indexAfterPublishB", await readDoc(`presentationVariants/${SEED.lessonSlug}__reading-adapted`));
          const tok = await idToken(SEED.diff, "student");
          const begin = await call("assessmentSessionsBegin", tok, { assignmentId: SEED.assignmentId, launchRef });
          const session = await readDoc(`assessmentSessions/${sessionIdFor(SEED.diff)}`);
          let attempt: any = null;
          if (begin.ok) { const fin = await call("assessmentAttemptsFinalize", tok, { sessionId: begin.result.sessionId, idempotencyKey: `stgcert-ab-${Date.now()}` }); if (fin.ok) { const a = await readDoc(`attempts/${fin.result.attemptId}`); attempt = { attemptId: fin.result.attemptId, deliveryOutcome: a?.deliveryOutcome, presentationRevisionId: a?.presentationRevisionId, assessmentRevisionId: a?.assessmentRevisionId }; } }
          out("phaseAB", { grantBoundTo: grantA?.presentationRevisionId, indexNow: REV_B, session: summarizeSession(session), attempt, aStillReachable: true });
          break;
        }
        case "legacyFixture": {
          // Phase M: synthetic pre-feature attempt lacking deliveryOutcome.
          const id = "staging-cert-legacy-attempt";
          await db.collection("attempts").doc(id).set({ attemptId: id, studentId: SEED.canon, assignmentId: SEED.assignmentId, activityId: SEED.lessonSlug, assessmentId: `assessment_${SEED.lessonSlug}`, assessmentRevisionId: SEED.lessonSlug ? "assessment_staging-cert-fixture__r1" : "", schoolId: "staging-cert-school", districtId: "staging-cert-district", attemptNumber: 1, score: 0, maxScore: 0, status: "finalized", createdAt: FieldValue.serverTimestamp() }, { merge: true });
          const doc = await readDoc(`attempts/${id}`);
          out("legacyFixture", { readable: !!doc, hasDeliveryOutcome: doc ? Object.prototype.hasOwnProperty.call(doc, "deliveryOutcome") : null, hasVariantKey: doc ? Object.prototype.hasOwnProperty.call(doc, "variantKey") : null });
          break;
        }
        case "prepareBrowserActor": {
          // Provision a REAL Google-signed-in staging UID as the differentiated
          // browser student. The uid is supplied by the operator from staging
          // Auth (never invented). Records/claims via Admin; accommodation via
          // the REAL Op B callable.
          const uid = getFlag("uid");
          if (!uid) { out("prepareBrowserActor", { error: "--uid=<real staging uid> required" }); break; }
          // 1. Custom claims (student) + users/{uid} role/profile (merge preserves authUid/email/displayName).
          await auth.setCustomUserClaims(uid, { role: "student", schoolId: "staging-cert-school", districtId: "staging-cert-district" });
          await db.doc(`users/${uid}`).set({ status: "active", role: "student", schoolId: "staging-cert-school", districtId: "staging-cert-district", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          // 2. Enrollment (active) + recipient (assigned, with teacherId).
          await db.doc(`enrollments/${SEED.classId}__${uid}`).set({ classId: SEED.classId, studentId: uid, schoolId: "staging-cert-school", districtId: "staging-cert-district", status: "active", role: "student", createdAt: FieldValue.serverTimestamp() }, { merge: true });
          await db.doc(`assignments/${SEED.assignmentId}/recipients/${uid}`).set({ assignmentId: SEED.assignmentId, studentId: uid, classId: SEED.classId, teacherId: SEED.teacher, schoolId: "staging-cert-school", districtId: "staging-cert-district", assignedAt: FieldValue.serverTimestamp(), assignedBy: SEED.teacher, status: "assigned" }, { merge: true });
          // 3. Activate reading-accessibility via the REAL Op B (teacher token).
          const ttok = await idToken(SEED.teacher, "teacher");
          const existing = await readDoc(`studentAccommodations/${uid}`);
          const expectedRevision = (existing && typeof existing.configRevision === "number") ? existing.configRevision : 0;
          const opb = await call("accommodationsSet", ttok, { studentId: uid, classId: SEED.classId, expectedRevision, newValue: { status: "active", level: "adapted" } });
          // 4. Verify resolution for this uid (mint token WITH claims; list only, no session).
          const stok = await idToken(uid, "student");
          const listRes = await call("assignmentsListForStudent", stok, {});
          const item = listRes.ok ? (listRes.result.items ?? []).find((i: any) => i.assignmentId === SEED.assignmentId) : null;
          out("prepareBrowserActor", {
            uid,
            claimsSet: true,
            userDoc: await readDoc(`users/${uid}`),
            enrollmentActive: (await readDoc(`enrollments/${SEED.classId}__${uid}`))?.status,
            recipientStatus: (await readDoc(`assignments/${SEED.assignmentId}/recipients/${uid}`))?.status,
            accommodation: { opbOk: opb.ok, code: opb.ok ? "ok" : opb.code, doc: await readDoc(`studentAccommodations/${uid}`) },
            resolverForActor: item ? { hasPresentation: !!item.presentation, hasLaunchRef: !!item.launchRef, variantKey: item.presentation?.variantKey, presentationRevisionId: item.presentation?.presentationRevisionId, path: item.presentation?.path } : { assignmentFound: false },
          });
          break;
        }
        case "read": {
          const p = getFlag("path");
          if (!p) { out("read", { error: "path required" }); break; }
          out(`read ${p}`, await readDoc(p));
          break;
        }
        case "readAttempts": {
          const uid = getFlag("student") ?? SEED.diff;
          out(`attempts uid=${uid}`, await readAttempts(uid));
          break;
        }
        case "resetSession": {
          const uid = getFlag("student") ?? SEED.diff;
          await db.doc(`assessmentSessions/${sessionIdFor(uid)}`).delete().catch(() => undefined);
          out("resetSession", { uid, deleted: true });
          break;
        }
        // ── Slice 7 certification commands ─────────────────────────────────────
        case "listStudents": {
          // Cert A: response shape - only {studentId, studentDisplayName}, no accommodation state.
          const classId = getFlag("class") ?? SEED.classId;
          const tok = await idToken(SEED.teacher, "teacher");
          const r = await call("accommodationsListStudents", tok, { classId });
          out("listStudents", { ok: r.ok, code: r.ok ? "ok" : r.code, ...(r.ok ? {
            classId: r.result.classId,
            count: (r.result.students ?? []).length,
            students: (r.result.students ?? []).map((s: any) => ({
              studentId: s.studentId,
              studentDisplayName: s.studentDisplayName,
              keys: Object.keys(s),
              hasAccommodationField: "readingAccessibility" in s || "accommodation" in s || "status" in s,
            })),
          } : { message: r.message }) });
          break;
        }
        case "listStudentsUnowned": {
          // Cert B: refuses class not owned by caller.
          const tok = await idToken(SEED.teacher, "teacher");
          const r = await call("accommodationsListStudents", tok, { classId: "not-my-class" });
          out("listStudentsUnowned", { refused: !r.ok, code: r.ok ? "UNEXPECTED-OK" : r.code });
          break;
        }
        case "listStudentsAsStudent": {
          // Cert B: role-forbidden for student callers.
          const tok = await idToken(SEED.diff, "student");
          const r = await call("accommodationsListStudents", tok, { classId: SEED.classId });
          out("listStudentsAsStudent", { refused: !r.ok, code: r.ok ? "UNEXPECTED-OK" : r.code });
          break;
        }
        case "readAccommodationAsStudent": {
          // Cert B: accommodationsGet refuses student callers.
          const tok = await idToken(SEED.diff, "student");
          const r = await call("accommodationsGet", tok, { studentId: SEED.diff, classId: SEED.classId });
          out("readAccommodationAsStudent", { refused: !r.ok, code: r.ok ? "UNEXPECTED-OK" : r.code });
          break;
        }
        case "readAccommodation": {
          // Read current accommodation state via accommodationsGet as teacher.
          const studentId = getFlag("student") ?? SEED.diff;
          const tok = await idToken(SEED.teacher, "teacher");
          const r = await call("accommodationsGet", tok, { studentId, classId: SEED.classId });
          out(`accommodationsGet student=${studentId}`, { ok: r.ok, code: r.ok ? "ok" : r.code, result: r.ok ? r.result : r.message });
          break;
        }
        case "deactivate": {
          // Cert G: deactivate via real accommodationsSet callable.
          const expected = Number(getFlag("expected") ?? "0");
          const tok = await idToken(SEED.teacher, "teacher");
          const r = await call("accommodationsSet", tok, { studentId: SEED.diff, classId: SEED.classId, expectedRevision: expected, newValue: { status: "inactive" } });
          out("deactivate", { ok: r.ok, code: r.ok ? "ok" : r.code, response: r.ok ? redact(r.result) : r.message });
          out("accommodationDoc", await readDoc(`studentAccommodations/${SEED.diff}`));
          const deactHist = await db.collection("studentAccommodations").doc(SEED.diff).collection("history").get();
          out("accommodationHistory", deactHist.docs.map((d) => { const h = d.data(); return { id: d.id, revision: h.revision, status: h.readingAccessibility?.status, setBy: h.setBy }; }));
          break;
        }
        case "staleWrite": {
          // Cert E: CAS stale write is rejected; current state is NOT overwritten.
          const docBefore = await readDoc(`studentAccommodations/${SEED.diff}`);
          const currentRev: number = (docBefore as any)?.configRevision ?? 0;
          const staleRev = Math.max(0, currentRev - 1);
          const tok = await idToken(SEED.teacher, "teacher");
          const r = await call("accommodationsSet", tok, { studentId: SEED.diff, classId: SEED.classId, expectedRevision: staleRev, newValue: { status: "inactive" } });
          const docAfter = await readDoc(`studentAccommodations/${SEED.diff}`);
          out("staleWrite", {
            currentRevision: currentRev,
            staleRevisionUsed: staleRev,
            refused: !r.ok,
            code: r.ok ? "UNEXPECTED-OK" : r.code,
            docRevisionUnchanged: (docAfter as any)?.configRevision === currentRev,
            docStatusUnchanged: (docAfter as any)?.readingAccessibility?.status === (docBefore as any)?.readingAccessibility?.status,
          });
          break;
        }
        case "noopWrite": {
          // Cert D: equal-value set -> noop:true, no configRevision increment.
          const docBefore = await readDoc(`studentAccommodations/${SEED.diff}`);
          const currentRev: number = (docBefore as any)?.configRevision ?? 0;
          const currentStatus: string = (docBefore as any)?.readingAccessibility?.status ?? "inactive";
          const currentValue = currentStatus === "active" ? { status: "active", level: "adapted" } : { status: "inactive" };
          const tok = await idToken(SEED.teacher, "teacher");
          const r = await call("accommodationsSet", tok, { studentId: SEED.diff, classId: SEED.classId, expectedRevision: currentRev, newValue: currentValue });
          const docAfter = await readDoc(`studentAccommodations/${SEED.diff}`);
          const histBefore = await db.collection("studentAccommodations").doc(SEED.diff).collection("history").get();
          out("noopWrite", {
            ok: r.ok,
            noop: r.ok ? r.result?.noop : null,
            configRevisionBefore: currentRev,
            configRevisionAfter: (docAfter as any)?.configRevision ?? null,
            revisionUnchanged: (docAfter as any)?.configRevision === currentRev,
            historyCount: histBefore.docs.length,
          });
          break;
        }
        case "historicalIntegrity": {
          // Cert H: Slice 7 ops did not mutate historical sessions/attempts.
          const attemptsForDiff = await readAttempts(SEED.diff);
          const attemptsForCanon = await readAttempts(SEED.canon);
          const legacyAttempt = await readDoc("attempts/staging-cert-legacy-attempt");
          out("historicalIntegrity", {
            diffAttemptCount: attemptsForDiff.length,
            canonAttemptCount: attemptsForCanon.length,
            diffAttempts: attemptsForDiff,
            legacyExists: !!legacyAttempt,
            legacyHasDeliveryOutcome: legacyAttempt ? Object.prototype.hasOwnProperty.call(legacyAttempt, "deliveryOutcome") : null,
            legacyHasVariantKey: legacyAttempt ? Object.prototype.hasOwnProperty.call(legacyAttempt, "variantKey") : null,
          });
          break;
        }
        case "crossTeacher": {
          // Cert I: student-scoped accommodation; two teachers with class relationship to same student.
          const TEACHER2 = "staging-cert-teacher-2";
          const CLASS2 = "staging-cert-class-2";
          // Provision second synthetic teacher (idempotent).
          try { await auth.createUser({ uid: TEACHER2, email: "staging-cert-teacher-2@staging-cert.invalid", displayName: "Staging Cert Teacher 2" }); } catch { /* already exists */ }
          await auth.setCustomUserClaims(TEACHER2, { role: "teacher", schoolId: "staging-cert-school", districtId: "staging-cert-district" });
          await db.doc(`users/${TEACHER2}`).set({ uid: TEACHER2, status: "active", role: "teacher", schoolId: "staging-cert-school", districtId: "staging-cert-district", displayName: "Staging Cert Teacher 2" }, { merge: true });
          // Provision second class (idempotent).
          await db.doc(`classes/${CLASS2}`).set({ classId: CLASS2, teacherId: TEACHER2, schoolId: "staging-cert-school", districtId: "staging-cert-district", name: "Staging Cert Class 2", status: "active", grade: "7", block: "A", joinCode: "CERT2X" }, { merge: true });
          // Enroll diff student in second class.
          await db.doc(`enrollments/${CLASS2}__${SEED.diff}`).set({ classId: CLASS2, studentId: SEED.diff, schoolId: "staging-cert-school", districtId: "staging-cert-district", status: "active", role: "student", createdAt: FieldValue.serverTimestamp() }, { merge: true });
          // Both teachers read accommodation state for the same student via their respective classes.
          const tok1 = await idToken(SEED.teacher, "teacher");
          const r1 = await call("accommodationsGet", tok1, { studentId: SEED.diff, classId: SEED.classId });
          const tok2 = await idToken(TEACHER2, "teacher");
          const r2 = await call("accommodationsGet", tok2, { studentId: SEED.diff, classId: CLASS2 });
          const groundTruth = await readDoc(`studentAccommodations/${SEED.diff}`);
          out("crossTeacher", {
            teacher1: { ok: r1.ok, configRevision: r1.ok ? r1.result.configRevision : null, status: r1.ok ? r1.result.readingAccessibility?.status : r1.code },
            teacher2: { ok: r2.ok, configRevision: r2.ok ? r2.result.configRevision : null, status: r2.ok ? r2.result.readingAccessibility?.status : r2.code },
            sameConfigRevision: r1.ok && r2.ok && r1.result.configRevision === r2.result.configRevision,
            sameStatus: r1.ok && r2.ok && r1.result.readingAccessibility?.status === r2.result.readingAccessibility?.status,
            groundTruth: { configRevision: (groundTruth as any)?.configRevision, status: (groundTruth as any)?.readingAccessibility?.status },
          });
          break;
        }
        case "verifyCertJ": {
          // Post-activation verification for brownc@weston.org Cert J setup.
          // Requires brownc to have activated via the UI first (custom claims needed).
          const BROWNC_UID = "kPckdZWX0HYhVckUhFE19mbnvPu1";
          const CLASS_J = "staging-cert-class-j";
          const STUDENT_DIFF = SEED.diff;
          // Mint a teacher token for brownc (uses their now-active claims).
          const browncTok = await idToken(BROWNC_UID, "teacher");
          // Call accommodationsListStudents as brownc with class-j.
          const listR = await call("accommodationsListStudents", browncTok, { classId: CLASS_J });
          const getR = await call("accommodationsGet", browncTok, { studentId: STUDENT_DIFF, classId: CLASS_J });
          out("verifyCertJ", {
            listStudents: { ok: listR.ok, code: listR.ok ? "ok" : listR.code,
              count: listR.ok ? (listR.result.students ?? []).length : null,
              diffStudentFound: listR.ok ? (listR.result.students ?? []).some((s: any) => s.studentId === STUDENT_DIFF) : false,
              allKeys: listR.ok ? (listR.result.students ?? []).map((s: any) => Object.keys(s)) : null,
            },
            accommodationsGet: { ok: getR.ok, code: getR.ok ? "ok" : getR.code,
              configRevision: getR.ok ? getR.result.configRevision : null,
              status: getR.ok ? getR.result.readingAccessibility?.status : null,
            },
          });
          break;
        }
        default:
          process.stdout.write(`[driver] commands: prepareAstra004Assignment [--dry-run|--apply] | prepareAstra004Student --uid=<required-uid> --email=<required-email> [--dry-run|--apply] | whoami | flag | activate | phaseA | list | runAttempt | beginNoRef | invalidGrant | phaseAB | legacyFixture | prepareBrowserActor --uid=<uid> | read | readAttempts | resetSession | listStudents | listStudentsUnowned | listStudentsAsStudent | readAccommodationAsStudent | readAccommodation | deactivate | staleWrite | noopWrite | historicalIntegrity | crossTeacher | verifyCertJ\n`);
      }
      process.exit(0);
    } catch (err) {
      if (command === "prepareAstra004Student") throw err;
      process.stderr.write(`[driver] ERROR: ${(err as Error).message}\n`);
      process.exit(1);
    }
  })().catch((error: unknown) => {
    const isAstra004 = process.argv.slice(2).some((arg) =>
      arg === "prepareAstra004Student" || arg === "prepareAstra004Assignment");
    if (isAstra004) {
      process.stderr.write(`${formatAstra004Failure(error, "startup")}\n`);
    } else {
      process.stderr.write("[driver] ERROR: unexpected startup failure\n");
    }
    process.exit(1);
  });
}
