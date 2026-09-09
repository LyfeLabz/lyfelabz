import { spawnSync } from "child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import ts from "typescript";

import {
  ASTRA004,
  ASTRA004_ASSIGNMENT,
  ASTRA004_ADMIN_APP_NAME,
  SIGNING_SERVICE_ACCOUNT,
  STAGING_PROJECT_ID,
  type Astra004AdminApp,
  type Astra004AssignmentPreparationDeps,
  type Astra004AuthUser,
  type Astra004PreparationDeps,
  assertAstra004Environment,
  assertStagingProject,
  callableUrl,
  claimsWillBeRepairedByStudentOnboarding,
  createAstra004StagingIdToken,
  createAstra004AssignmentId,
  createAstra004AdminContext,
  createAstra004TokenExchangeDeps,
  extractAstra004StagingWebApiKey,
  formatAstra004Failure,
  parseAstra004AssignmentCliArgs,
  parseAstra004CliArgs,
  prepareAstra004Assignment,
  prepareAstra004Student,
  redact,
  resolveAstra004AdminApp,
  resolveAstra004Mode,
  runAstra004AssignmentCliEntryPoint,
  runAstra004CliEntryPoint,
} from "./staging-cert-driver";
import { computeExternalIdentityDocId } from "../shared/identity/external-identity-doc-id";

// Pure exports only; firebase-admin/network never enter the test process.

const ASTRA004_NODE_PRELOAD = String.raw`
const fs = require("fs");
const Module = require("module");

const tracePath = process.env.ASTRA004_TEST_TRACE_PATH;
const record = (event) => {
  if (tracePath) fs.appendFileSync(tracePath, event + "\n");
};
const productionApp = {
  name: "[DEFAULT]",
  options: { projectId: "lyfelabz-prod" },
};
const stagingApp = {
  name: "prepare-astra004-staging",
  options: { projectId: "lyfelabz-staging" },
};
const stoppedAuth = {
  getUser: async () => {
    const error = new Error("local mocked auth read stopped");
    error.code = "mock/read-stopped";
    throw error;
  },
  getUserByEmail: async () => {
    const error = new Error("local mocked auth read stopped");
    error.code = "mock/read-stopped";
    throw error;
  },
};
const originalLoad = Module._load;
class RefreshTokenCredential {}

Module._load = function (request, parent, isMain) {
  if (request === "firebase-admin/app") {
    if (process.env.ASTRA004_TEST_IMPORT_FAILURE === "1") {
      throw new Error(
        "SECRET_CANARY_123 Authorization: Bearer SECRET_TOKEN private_key=SECRET_VALUE",
      );
    }
    return {
      applicationDefault: () => new RefreshTokenCredential(),
      getApps: () => [productionApp],
      initializeApp: (_options, name) => {
        record("initializeApp:" + name);
        return stagingApp;
      },
    };
  }
  if (request === "firebase-admin/auth") {
    return {
      getAuth: (...args) => {
        record("getAuth:" + args.length + ":" + (args[0] && args[0].name));
        return stoppedAuth;
      },
    };
  }
  if (request === "firebase-admin/firestore") {
    return {
      getFirestore: (...args) => {
        record("getFirestore:" + args.length + ":" + (args[0] && args[0].name));
        return {};
      },
    };
  }
  if (request.endsWith("shared/identity/external-identity-doc-id")) {
    return { computeExternalIdentityDocId: () => "mock-external-identity" };
  }
  if (request.endsWith("shared/assessment-identifiers")) {
    return {
      assessmentIdForLessonSlug: (slug) => "assessment_" + slug,
      parseAssessmentIdFromRevisionId: (id) => {
        const match = /^(assessment_.+)__r[1-9][0-9]*$/.exec(id);
        return match && match[1] || undefined;
      },
      parseRevisionOrdinalFromRevisionId: (id) => {
        const match = /__r([1-9][0-9]*)$/.exec(id);
        return match ? Number(match[1]) : undefined;
      },
      revisionIdForOrdinal: (assessmentId, ordinal) =>
        assessmentId + "__r" + ordinal,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};
`;

function executeActualAstra004NodeCli(options: {
  readonly importFailure?: boolean;
  readonly command?: "prepareAstra004Student" | "prepareAstra004Assignment";
} = {}): {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly trace: string;
} {
  const directory = mkdtempSync(join(tmpdir(), "astra004-node-cli-"));
  try {
    const sourcePath = join(__dirname, "staging-cert-driver.ts");
    const driverPath = join(directory, "staging-cert-driver.js");
    const preloadPath = join(directory, "firebase-admin-preload.cjs");
    const tracePath = join(directory, "sdk-trace.txt");
    const transpiled = ts.transpileModule(readFileSync(sourcePath, "utf8"), {
      compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: sourcePath,
    });
    writeFileSync(driverPath, transpiled.outputText);
    writeFileSync(preloadPath, ASTRA004_NODE_PRELOAD);

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ASTRA004_TEST_TRACE_PATH: tracePath,
      ASTRA004_TEST_IMPORT_FAILURE: options.importFailure ? "1" : "0",
    };
    delete env.GCLOUD_PROJECT;
    delete env.GOOGLE_CLOUD_PROJECT;
    delete env.FIRESTORE_EMULATOR_HOST;
    delete env.FIREBASE_AUTH_EMULATOR_HOST;

    const command = options.command ?? "prepareAstra004Student";
    const commandArgs = command === "prepareAstra004Student"
      ? [
        command,
        `--project=${STAGING_PROJECT_ID}`,
        `--uid=${ASTRA004.uid}`,
        `--email=${ASTRA004.email}`,
        "--dry-run",
      ]
      : [command, `--project=${STAGING_PROJECT_ID}`, "--dry-run"];
    const result = spawnSync(
      process.execPath,
      [
        "--require",
        preloadPath,
        driverPath,
        ...commandArgs,
      ],
      { encoding: "utf8", env, timeout: 10_000 },
    );
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      trace: existsSync(tracePath) ? readFileSync(tracePath, "utf8") : "",
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

describe("assertStagingProject (fail-closed)", () => {
  test("accepts exactly lyfelabz-staging", () => {
    expect(assertStagingProject("lyfelabz-staging", {})).toBeNull();
  });
  test("requires explicit project", () => {
    expect(assertStagingProject(undefined, {})).toContain("required");
  });
  test("refuses production", () => {
    expect(assertStagingProject("lyfelabz-prod", {})).toContain("refusing project 'lyfelabz-prod'");
  });
  test("refuses a conflicting ambient project", () => {
    expect(assertStagingProject("lyfelabz-staging", { GCLOUD_PROJECT: "lyfelabz-prod" })).toContain("lyfelabz-prod");
    expect(assertStagingProject("lyfelabz-staging", { GOOGLE_CLOUD_PROJECT: "other" })).toContain("other");
  });
});

describe("prepareAstra004Student CLI and Admin isolation", () => {
  const exactArgs = [
    "prepareAstra004Student",
    `--project=${STAGING_PROJECT_ID}`,
    `--uid=${ASTRA004.uid}`,
    `--email=${ASTRA004.email}`,
  ] as const;

  test("actual entry-point parser accepts only explicit apply and defaults safely", () => {
    expect(parseAstra004CliArgs(exactArgs).mode).toBe("dry-run");
    expect(parseAstra004CliArgs([...exactArgs, "--dry-run"]).mode).toBe("dry-run");
    expect(parseAstra004CliArgs([...exactArgs, "--apply"]).mode).toBe("apply");
  });

  const invalidArgv: readonly (readonly string[])[] = [
    [...exactArgs, "--dry-run=true", "--apply"],
    [...exactArgs, "--apply=true"],
    [...exactArgs, "--dry-run", "--dry-run"],
    [...exactArgs, "--apply", "--apply"],
    [...exactArgs, "--dry-run", "--apply"],
    [...exactArgs, `--project=${STAGING_PROJECT_ID}`],
    [...exactArgs, `--uid=${ASTRA004.uid}`],
    [...exactArgs, `--email=${ASTRA004.email}`],
    [...exactArgs, "--unknown=value"],
    [...exactArgs, "garbage"],
    [...exactArgs, "anotherCommand"],
    ["--dry-run", ...exactArgs],
    exactArgs.filter((arg) => !arg.startsWith("--email=")),
    ["prepareAstra004Student", "--project=", `--uid=${ASTRA004.uid}`, `--email=${ASTRA004.email}`],
    ["prepareAstra004Student", "--project=lyfelabz-prod", `--uid=${ASTRA004.uid}`, `--email=${ASTRA004.email}`],
    ["prepareAstra004Student", `--project=${STAGING_PROJECT_ID}`, "--uid=wrong", `--email=${ASTRA004.email}`],
    ["prepareAstra004Student", `--project=${STAGING_PROJECT_ID}`, `--uid=${ASTRA004.uid}`, "--email=wrong@example.com"],
  ];

  test.each(invalidArgv.map((argv) => [argv]))(
    "strict parser refuses ambiguous invocation %#",
    (argv) => {
    expect(() => parseAstra004CliArgs(argv)).toThrow();
    },
  );

  test("emulator overrides refuse without changing the environment", () => {
    const firestoreEnv = { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" };
    const authEnv = { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" };
    expect(assertAstra004Environment(firestoreEnv)).toContain("FIRESTORE_EMULATOR_HOST");
    expect(assertAstra004Environment(authEnv)).toContain("FIREBASE_AUTH_EMULATOR_HOST");
    expect(firestoreEnv).toEqual({ FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" });
    expect(authEnv).toEqual({ FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" });
  });

  const app = (name: string, projectId: string): Astra004AdminApp => ({
    name,
    options: { projectId },
  });

  test("production default or unrelated named apps cannot receive ASTRA-004 clients", () => {
    for (const existing of [
      app("[DEFAULT]", "lyfelabz-prod"),
      app("unrelated", "other-project"),
    ]) {
      const staging = app(ASTRA004_ADMIN_APP_NAME, STAGING_PROJECT_ID);
      const initialize = jest.fn(() => staging);
      expect(resolveAstra004AdminApp([existing], initialize)).toBe(staging);
      expect(initialize).toHaveBeenCalledWith(ASTRA004_ADMIN_APP_NAME);
    }
  });

  test("binds Auth and Firestore explicitly to the verified staging app", () => {
    const productionDefault = app("[DEFAULT]", "lyfelabz-prod");
    const staging = app(ASTRA004_ADMIN_APP_NAME, STAGING_PROJECT_ID);
    const getAuthForApp = jest.fn(() => ({ service: "auth" }));
    const getFirestoreForApp = jest.fn(() => ({ service: "firestore" }));
    const context = createAstra004AdminContext(
      [productionDefault],
      () => staging,
      getAuthForApp,
      getFirestoreForApp,
    );
    expect(context.app).toBe(staging);
    expect(getAuthForApp).toHaveBeenCalledWith(staging);
    expect(getFirestoreForApp).toHaveBeenCalledWith(staging);
    expect(getAuthForApp).not.toHaveBeenCalledWith(productionDefault);
    expect(getFirestoreForApp).not.toHaveBeenCalledWith(productionDefault);
  });

  test("reuses only the verified dedicated staging app and refuses its mismatch", () => {
    const staging = app(ASTRA004_ADMIN_APP_NAME, STAGING_PROJECT_ID);
    const initialize = jest.fn(() => staging);
    expect(resolveAstra004AdminApp([staging], initialize)).toBe(staging);
    expect(initialize).not.toHaveBeenCalled();

    expect(() => resolveAstra004AdminApp([
      app(ASTRA004_ADMIN_APP_NAME, "lyfelabz-prod"),
    ], initialize)).toThrow("non-staging project");
  });

  test("initialization and arbitrary provider failures never expose secret text", () => {
    const canary = "access_token=CANARY_INITIALIZATION_SECRET";
    let error: unknown;
    try {
      resolveAstra004AdminApp([], () => {
        throw new Error(canary);
      });
    } catch (caught) {
      error = caught;
    }
    const rendered = formatAstra004Failure(error, "startup");
    expect(rendered).toContain("stage=admin-initialization");
    expect(rendered).toContain("ADMIN_INITIALIZE_FAILED");
    expect(rendered).not.toContain(canary);
    expect(formatAstra004Failure(new Error(canary), "auth-read")).not.toContain(canary);
  });
});

describe("callableUrl (staging-only endpoint derivation)", () => {
  test("builds the staging endpoint with the project interpolated", () => {
    expect(callableUrl("lyfelabz-staging", "assessmentSessionsBegin")).toBe(
      "https://us-central1-lyfelabz-staging.cloudfunctions.net/assessmentSessionsBegin",
    );
  });
  test("refuses a non-staging project", () => {
    expect(() => callableUrl("lyfelabz-prod", "x")).toThrow("non-staging");
  });
  test("refuses a malformed callable name", () => {
    expect(() => callableUrl("lyfelabz-staging", "../evil")).toThrow("malformed");
  });
});

describe("redact (no token ever reaches a log)", () => {
  test("redacts secret-named keys", () => {
    const r = redact({ authorization: "Bearer abc", idToken: "x", launchRef: "g", nested: { refreshToken: "y", safe: "keep" } }) as any;
    expect(r.authorization).toBe("<redacted>");
    expect(r.idToken).toBe("<redacted>");
    expect(r.launchRef).toBe("<redacted>");
    expect(r.nested.refreshToken).toBe("<redacted>");
    expect(r.nested.safe).toBe("keep");
  });
  test("redacts a bearer string and a JWT-shaped value", () => {
    expect(redact("Bearer eyJhbGciOi")).toBe("Bearer <redacted>");
    expect(redact("eyJhbGciOiJSUzI1NiIsImtpZCI6.eyJpc3MiOiJodHRw.SIGNATUREPART_xxxxx")).toBe("<redacted-jwt>");
  });
  test("leaves ordinary evidence untouched", () => {
    const ev = { deliveryOutcome: "differentiated", variantKey: "reading-adapted", presentationRevisionId: "prabc" };
    expect(redact(ev)).toEqual(ev);
  });
  test("STAGING_PROJECT_ID literal", () => {
    expect(STAGING_PROJECT_ID).toBe("lyfelabz-staging");
  });
});

const PROVIDER_ACCOUNT_ID = "google-provider-account-90";
const BRIDGE_ID = computeExternalIdentityDocId({
  providerId: "google.com",
  providerAccountId: PROVIDER_ACCOUNT_ID,
});

type MutableHarness = {
  studentAuth: Astra004AuthUser;
  teacherAuth: Astra004AuthUser;
  docs: Map<string, Record<string, unknown>>;
  deps: Astra004PreparationDeps;
  invoke: jest.Mock;
};

function provisionedUser(): Record<string, unknown> {
  return {
    authUid: ASTRA004.uid,
    email: ASTRA004.email,
    displayName: "Ninety Ballard",
    status: "provisioned",
    createdAt: { seconds: 1 },
  };
}

function finalUser(): Record<string, unknown> {
  return {
    ...provisionedUser(),
    status: "active",
    role: "student",
    schoolId: ASTRA004.studentSchoolId,
  };
}

function dedicatedClass(): Record<string, unknown> {
  return {
    teacherId: ASTRA004.teacherUid,
    schoolId: ASTRA004.studentSchoolId,
    title: ASTRA004.classTitle,
    grade: ASTRA004.classGrade,
    block: ASTRA004.classBlock,
    joinCode: "A1B2C3D4",
    status: "active",
    createdAt: { seconds: 2 },
  };
}

function dedicatedEnrollment(): Record<string, unknown> {
  return {
    studentId: ASTRA004.uid,
    classId: ASTRA004.classId,
    schoolId: ASTRA004.studentSchoolId,
    status: "active",
    enrolledAt: { seconds: 3 },
  };
}

function makeHarness(): MutableHarness {
  const harness = {} as MutableHarness;
  harness.studentAuth = {
    uid: ASTRA004.uid,
    email: ASTRA004.email,
    disabled: false,
    providerData: [{ providerId: "google.com", uid: PROVIDER_ACCOUNT_ID }],
    customClaims: {},
  };
  harness.teacherAuth = {
    uid: ASTRA004.teacherUid,
    email: "teacher@staging-cert.invalid",
    disabled: false,
    providerData: [],
    customClaims: {
      role: "teacher",
      schoolId: ASTRA004.studentSchoolId,
      districtId: ASTRA004.districtId,
    },
  };
  harness.docs = new Map<string, Record<string, unknown>>([
    [`users/${ASTRA004.uid}`, provisionedUser()],
    [`users/${ASTRA004.teacherUid}`, {
      authUid: ASTRA004.teacherUid,
      role: "teacher",
      status: "active",
      schoolId: ASTRA004.studentSchoolId,
      displayName: "Staging Cert Teacher",
      createdAt: { seconds: 1 },
    }],
    [`schools/${ASTRA004.studentSchoolId}`, {
      districtId: ASTRA004.districtId,
    }],
    [`externalIdentities/${BRIDGE_ID}`, {
      providerId: "google.com",
      providerAccountId: PROVIDER_ACCOUNT_ID,
      userId: ASTRA004.uid,
      status: "active",
      source: "authOnUserCreate",
      createdAt: { seconds: 1 },
      updatedAt: { seconds: 1 },
    }],
  ]);

  const collectionDocs = (collection: string): { id: string; data: Record<string, unknown> }[] => {
    const prefix = `${collection}/`;
    return [...harness.docs.entries()]
      .filter(([path]) => path.startsWith(prefix) && path.slice(prefix.length).indexOf("/") === -1)
      .map(([path, data]) => ({ id: path.slice(prefix.length), data }));
  };
  const query = (collection: string, field: string, value: string) =>
    Promise.resolve(collectionDocs(collection).filter((doc) => doc.data[field] === value));

  harness.invoke = jest.fn((
    uid: string,
    name: string,
    data: Readonly<Record<string, unknown>>,
  ) => {
    if (name === "classesCreate") {
      expect(uid).toBe(ASTRA004.teacherUid);
      expect(data).toEqual({
        classId: ASTRA004.classId,
        title: ASTRA004.classTitle,
        grade: ASTRA004.classGrade,
        block: ASTRA004.classBlock,
      });
      harness.docs.set(`classes/${ASTRA004.classId}`, dedicatedClass());
      return Promise.resolve({ classId: ASTRA004.classId });
    }
    if (name === "studentsCompleteOnboarding") {
      expect(uid).toBe(ASTRA004.uid);
      expect(data).toEqual({
        role: "student",
        schoolId: ASTRA004.studentSchoolId,
        displayName: "Ninety Ballard",
      });
      const currentUser = harness.docs.get(`users/${ASTRA004.uid}`);
      if (
        currentUser?.status === "provisioned" ||
        claimsWillBeRepairedByStudentOnboarding(harness.studentAuth.customClaims)
      ) {
        harness.docs.set(`users/${ASTRA004.uid}`, finalUser());
        harness.studentAuth = {
          ...harness.studentAuth,
          customClaims: {
            role: "student",
            schoolId: ASTRA004.studentSchoolId,
            districtId: ASTRA004.districtId,
          },
        };
      }
      return Promise.resolve({ uid: ASTRA004.uid });
    }
    if (name === "enrollmentsTeacherAdd") {
      expect(uid).toBe(ASTRA004.teacherUid);
      expect(data).toEqual({
        classId: ASTRA004.classId,
        studentId: ASTRA004.uid,
      });
      harness.docs.set(
        `enrollments/${ASTRA004.classId}__${ASTRA004.uid}`,
        dedicatedEnrollment(),
      );
      return Promise.resolve({ studentId: ASTRA004.uid });
    }
    return Promise.reject(new Error("unexpected callable"));
  });

  harness.deps = {
    getAuthUserByUid: jest.fn((uid: string) => {
      if (uid === ASTRA004.uid) return Promise.resolve(harness.studentAuth);
      if (uid === ASTRA004.teacherUid) return Promise.resolve(harness.teacherAuth);
      return Promise.resolve(null);
    }),
    getAuthUserByEmail: jest.fn((email: string) =>
      Promise.resolve(email === ASTRA004.email ? harness.studentAuth : null)),
    getDocument: jest.fn((path: string) => Promise.resolve(harness.docs.get(path) ?? null)),
    queryCollection: jest.fn(query),
    queryCollectionGroup: jest.fn((collection: string, field: string, value: string) => {
      if (collection !== "recipients") return Promise.resolve([]);
      return Promise.resolve([...harness.docs.entries()]
        .filter(([path, data]) => path.includes("/recipients/") && data[field] === value)
        .map(([path, data]) => ({ id: path.split("/").at(-1) ?? "", data })));
    }),
    invokeCallableAs: harness.invoke,
  };
  return harness;
}

const baseInput = (overrides: Partial<{
  project: string;
  uid: string;
  email: string;
  mode: "dry-run" | "apply";
  env: NodeJS.ProcessEnv;
}> = {}) => ({
  project: STAGING_PROJECT_ID,
  uid: ASTRA004.uid,
  email: ASTRA004.email,
  mode: "dry-run" as const,
  env: {},
  ...overrides,
});

function setClassCreated(harness: MutableHarness): void {
  harness.docs.set(`classes/${ASTRA004.classId}`, dedicatedClass());
}

function setStudentActive(
  harness: MutableHarness,
  claims: Readonly<Record<string, unknown>> = {
    role: "student",
    schoolId: ASTRA004.studentSchoolId,
    districtId: ASTRA004.districtId,
  },
): void {
  harness.docs.set(`users/${ASTRA004.uid}`, finalUser());
  harness.studentAuth = { ...harness.studentAuth, customClaims: claims };
}

function setEnrollmentCreated(harness: MutableHarness): void {
  harness.docs.set(
    `enrollments/${ASTRA004.classId}__${ASTRA004.uid}`,
    dedicatedEnrollment(),
  );
}

describe("prepareAstra004Student real CLI entry point", () => {
  const exactDryRunArgs = [
    "prepareAstra004Student",
    `--project=${STAGING_PROJECT_ID}`,
    `--uid=${ASTRA004.uid}`,
    `--email=${ASTRA004.email}`,
    "--dry-run",
  ] as const;

  test("actual require.main SDK wrapper binds clients to the dedicated staging app", () => {
    const result = executeActualAstra004NodeCli();

    expect(result.status).toBe(1);
    expect(result.trace).toContain(`initializeApp:${ASTRA004_ADMIN_APP_NAME}`);
    expect(result.trace).toContain(`getAuth:1:${ASTRA004_ADMIN_APP_NAME}`);
    expect(result.trace).toContain(`getFirestore:1:${ASTRA004_ADMIN_APP_NAME}`);
    expect(result.trace).not.toContain("getAuth:0:");
    expect(result.trace).not.toContain("getFirestore:0:");
  });

  test("actual require.main outer startup catch sanitizes SDK import failures", () => {
    const canaries = [
      "SECRET_CANARY_123",
      "Authorization: Bearer SECRET_TOKEN",
      "private_key=SECRET_VALUE",
    ];
    const result = executeActualAstra004NodeCli({ importFailure: true });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("code=UNEXPECTED_FAILURE");
    for (const canary of canaries) {
      expect(result.stdout).not.toContain(canary);
      expect(result.stderr).not.toContain(canary);
    }
  });

  test("actual CLI wiring binds both clients to the dedicated staging app", async () => {
    const harness = makeHarness();
    const production = {
      name: "[DEFAULT]",
      options: { projectId: "lyfelabz-prod" },
    };
    const staging = {
      name: ASTRA004_ADMIN_APP_NAME,
      options: { projectId: STAGING_PROJECT_ID },
    };
    const productionAuth = { project: "production-auth" };
    const productionDb = { project: "production-firestore" };
    const stagingAuth = { project: "staging-auth" };
    const stagingDb = { project: "staging-firestore" };
    const getAuth = jest.fn((selected?: typeof staging) =>
      selected === staging ? stagingAuth : productionAuth);
    const getFirestore = jest.fn((selected?: typeof staging) =>
      selected === staging ? stagingDb : productionDb);
    const stdout: string[] = [];
    const stderr: string[] = [];

    const exitCode = await runAstra004CliEntryPoint(exactDryRunArgs, {
      env: {},
      getApps: () => [production],
      initializeApp: () => staging,
      getAuth,
      getFirestore,
      createPreparationDeps: (auth, db) => {
        expect(auth).toBe(stagingAuth);
        expect(db).toBe(stagingDb);
        return harness.deps;
      },
      writeStdout: (value) => stdout.push(value),
      writeStderr: (value) => stderr.push(value),
    });

    expect(exitCode).toBe(0);
    expect(getAuth).toHaveBeenCalledWith(staging);
    expect(getFirestore).toHaveBeenCalledWith(staging);
    expect(getAuth).not.toHaveBeenCalledWith();
    expect(getFirestore).not.toHaveBeenCalledWith();
    expect(harness.invoke).not.toHaveBeenCalled();
    expect(stdout.join("\n")).toContain("DRY RUN ONLY");
    expect(stderr).toEqual([]);
  });

  test("actual top-level CLI path sanitizes arbitrary startup failures", async () => {
    const canaries = [
      "SECRET_CANARY_123",
      "Authorization: Bearer SECRET_TOKEN",
      "private_key=SECRET_VALUE",
    ];
    const stdout: string[] = [];
    const stderr: string[] = [];
    const exitCode = await runAstra004CliEntryPoint(exactDryRunArgs, {
      env: {},
      getApps: () => {
        throw new Error(canaries.join(" "));
      },
      initializeApp: () => {
        throw new Error("must not initialize after getApps failure");
      },
      getAuth: () => ({ service: "auth" }),
      getFirestore: () => ({ service: "firestore" }),
      createPreparationDeps: () => makeHarness().deps,
      writeStdout: (value) => stdout.push(value),
      writeStderr: (value) => stderr.push(value),
    });

    const renderedStdout = stdout.join("\n");
    const renderedStderr = stderr.join("\n");
    expect(exitCode).toBe(1);
    expect(renderedStderr).toContain("code=UNEXPECTED_FAILURE");
    for (const canary of canaries) {
      expect(renderedStdout).not.toContain(canary);
      expect(renderedStderr).not.toContain(canary);
    }
  });
});

describe("ASTRA-004 claims recovery matches studentsCompleteOnboarding", () => {
  test.each([
    [undefined, true],
    [{}, true],
    [{ role: "teacher", schoolId: ASTRA004.studentSchoolId, districtId: ASTRA004.districtId }, true],
    [{ role: "student", schoolId: "wrong-school", districtId: ASTRA004.districtId }, true],
    [{ role: "student", schoolId: ASTRA004.studentSchoolId }, true],
    [{ role: "student", schoolId: ASTRA004.studentSchoolId, districtId: "" }, true],
    [{ role: "student", schoolId: ASTRA004.studentSchoolId, districtId: "   " }, true],
    [{ role: "student", schoolId: ASTRA004.studentSchoolId, districtId: "wrong-nonempty" }, false],
    [{
      role: "student",
      schoolId: ASTRA004.studentSchoolId,
      districtId: ASTRA004.districtId,
      extraClaim: true,
    }, false],
  ])("mirrors canonical claimsHealthy negation for %p", (claims, expected) => {
    expect(claimsWillBeRepairedByStudentOnboarding(claims)).toBe(expected);
  });
});

describe("prepareAstra004Student command guards", () => {
  test("defaults to dry-run and requires explicit --apply", () => {
    expect(resolveAstra004Mode([])).toBe("dry-run");
    expect(resolveAstra004Mode(["--dry-run"])).toBe("dry-run");
    expect(resolveAstra004Mode(["--apply"])).toBe("apply");
    expect(() => resolveAstra004Mode(["--dry-run", "--apply"])).toThrow("mutually exclusive");
  });

  test.each([
    [{ project: undefined }, "project"],
    [{ project: "lyfelabz-prod" }, "project"],
    [{ project: "other" }, "project"],
    [{ env: { GCLOUD_PROJECT: "lyfelabz-prod" } }, "project"],
    [{ env: { GOOGLE_CLOUD_PROJECT: "other" } }, "project"],
    [{ env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" } }, "FIRESTORE_EMULATOR_HOST"],
    [{ env: { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" } }, "FIREBASE_AUTH_EMULATOR_HOST"],
    [{ uid: "wrong-uid" }, `--uid=${ASTRA004.uid}`],
    [{ email: "wrong@example.com" }, `--email=${ASTRA004.email}`],
  ])("refuses invalid command input %p", async (overrides, expected) => {
    const harness = makeHarness();
    await expect(
      prepareAstra004Student(baseInput(overrides), harness.deps),
    ).rejects.toThrow(expected);
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  test("refuses UID/email lookup mismatch", async () => {
    const harness = makeHarness();
    const deps: Astra004PreparationDeps = {
      ...harness.deps,
      getAuthUserByEmail: jest.fn(() => Promise.resolve({
        ...harness.studentAuth,
        uid: "another-uid",
      })),
    };
    await expect(prepareAstra004Student(baseInput(), deps)).rejects.toThrow("lookups");
  });

  test("refuses disabled Auth user", async () => {
    const harness = makeHarness();
    harness.studentAuth = { ...harness.studentAuth, disabled: true };
    await expect(prepareAstra004Student(baseInput(), harness.deps)).rejects.toThrow("disabled");
  });

  test("refuses missing or malformed Google provider", async () => {
    const harness = makeHarness();
    harness.studentAuth = { ...harness.studentAuth, providerData: [] };
    await expect(prepareAstra004Student(baseInput(), harness.deps)).rejects.toThrow("google.com");
  });

  test("refuses provisioned student persisted claims", async () => {
    const harness = makeHarness();
    harness.studentAuth = {
      ...harness.studentAuth,
      customClaims: { role: "student" },
    };
    await expect(prepareAstra004Student(baseInput(), harness.deps)).rejects.toThrow(
      "unexpectedly has custom claims",
    );
  });

  test("independently refuses teacher Auth, record, and persisted-claims defects", async () => {
    const missingAuth = makeHarness();
    missingAuth.teacherAuth = { ...missingAuth.teacherAuth, uid: "wrong-teacher" };
    await expect(prepareAstra004Student(baseInput(), missingAuth.deps)).rejects.toThrow(
      "teacher Auth user",
    );

    const badRecord = makeHarness();
    badRecord.docs.get(`users/${ASTRA004.teacherUid}`)!.role = "student";
    await expect(prepareAstra004Student(baseInput(), badRecord.deps)).rejects.toThrow(
      "teacher user record",
    );

    const badClaims = makeHarness();
    badClaims.teacherAuth = {
      ...badClaims.teacherAuth,
      customClaims: { role: "teacher", schoolId: ASTRA004.studentSchoolId },
    };
    await expect(prepareAstra004Student(baseInput(), badClaims.deps)).rejects.toThrow(
      "teacher claims",
    );
  });

  test("refuses missing bridge and bridge pointing to another UID", async () => {
    const missing = makeHarness();
    missing.docs.delete(`externalIdentities/${BRIDGE_ID}`);
    await expect(prepareAstra004Student(baseInput(), missing.deps)).rejects.toThrow("bridge");

    const wrong = makeHarness();
    wrong.docs.get(`externalIdentities/${BRIDGE_ID}`)!.userId = "another-uid";
    await expect(prepareAstra004Student(baseInput(), wrong.deps)).rejects.toThrow("bridge");
  });

  test("refuses unexpected role and wrong school", async () => {
    const role = makeHarness();
    role.docs.get(`users/${ASTRA004.uid}`)!.role = "teacher";
    await expect(prepareAstra004Student(baseInput(), role.deps)).rejects.toThrow("user state");

    const school = makeHarness();
    school.docs.get(`schools/${ASTRA004.studentSchoolId}`)!.districtId = "wrong-district";
    await expect(prepareAstra004Student(baseInput(), school.deps)).rejects.toThrow("school");
  });

  test("refuses any accommodation document, including inactive", async () => {
    const harness = makeHarness();
    harness.docs.set(`studentAccommodations/${ASTRA004.uid}`, {
      studentId: ASTRA004.uid,
      readingAccessibility: { status: "inactive" },
    });
    await expect(prepareAstra004Student(baseInput(), harness.deps)).rejects.toThrow("accommodation");
  });

  test("refuses conflicting or LMS-linked dedicated class", async () => {
    const conflict = makeHarness();
    conflict.docs.set(`classes/${ASTRA004.classId}`, {
      ...dedicatedClass(),
      teacherId: "wrong-teacher",
    });
    await expect(prepareAstra004Student(baseInput(), conflict.deps)).rejects.toThrow("class");

    const linked = makeHarness();
    linked.docs.set(`classes/${ASTRA004.classId}`, dedicatedClass());
    linked.docs.set("lmsClassLinks/link-1", {
      classId: ASTRA004.classId,
      status: "linked",
    });
    await expect(prepareAstra004Student(baseInput(), linked.deps)).rejects.toThrow("LMS linkage");
  });

  test("refuses actor LMS roster membership independently", async () => {
    const harness = makeHarness();
    harness.docs.set("lmsRosterMemberships/link__actor", {
      identityHash: BRIDGE_ID,
      status: "removed",
    });
    await expect(prepareAstra004Student(baseInput(), harness.deps)).rejects.toThrow(
      "LMS roster membership",
    );
  });

  test("refuses conflicting enrollment and actor history", async () => {
    const enrollment = makeHarness();
    enrollment.docs.set("enrollments/other-class__student", {
      studentId: ASTRA004.uid,
      classId: "other-class",
      schoolId: ASTRA004.studentSchoolId,
      status: "active",
      enrolledAt: { seconds: 1 },
    });
    await expect(prepareAstra004Student(baseInput(), enrollment.deps)).rejects.toThrow("enrollment");

    const history = makeHarness();
    history.docs.set("attempts/a1", { studentId: ASTRA004.uid });
    await expect(prepareAstra004Student(baseInput(), history.deps)).rejects.toThrow("history");
  });

  test("external read errors are categorized without secret-bearing messages", async () => {
    const harness = makeHarness();
    const canary = "Authorization: Bearer CANARY_READ_SECRET";
    const deps: Astra004PreparationDeps = {
      ...harness.deps,
      getDocument: jest.fn(() => Promise.reject(new Error(canary))),
    };
    let error: unknown;
    try {
      await prepareAstra004Student(baseInput(), deps);
    } catch (caught) {
      error = caught;
    }
    const rendered = formatAstra004Failure(error);
    expect(rendered).toContain("FIRESTORE_READ_FAILED");
    expect(rendered).not.toContain(canary);
    expect((error as Error).message).not.toContain(canary);
  });
});

describe("prepareAstra004Student dry-run and apply orchestration", () => {
  test("clean provisioned state produces the exact zero-mutation dry-run plan", async () => {
    const harness = makeHarness();
    const result = await prepareAstra004Student(baseInput(), harness.deps);
    expect(result.plan).toEqual({
      stage: "clean-initial",
      class: "create",
      student: "activate",
      enrollment: "add",
      nextOperations: [
        "classesCreate",
        "studentsCompleteOnboarding",
        "enrollmentsTeacherAdd",
      ],
    });
    expect(result.message).toBe("DRY RUN ONLY — no mutations performed");
    expect(harness.invoke).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toMatch(/token|authorization|credential/i);
  });

  test("exact final state is accepted idempotently", async () => {
    const harness = makeHarness();
    setClassCreated(harness);
    setStudentActive(harness);
    setEnrollmentCreated(harness);
    const result = await prepareAstra004Student(baseInput(), harness.deps);
    expect(result.plan).toEqual({
      stage: "complete",
      class: "satisfied",
      student: "satisfied",
      enrollment: "satisfied",
      nextOperations: [],
    });
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  test("apply invokes canonical callables in order and re-verifies final state", async () => {
    const harness = makeHarness();
    const result = await prepareAstra004Student(
      baseInput({ mode: "apply" }),
      harness.deps,
    );
    expect(harness.invoke.mock.calls.map((call) => call[1])).toEqual([
      "classesCreate",
      "studentsCompleteOnboarding",
      "enrollmentsTeacherAdd",
    ]);
    expect(harness.invoke).toHaveBeenNthCalledWith(1, ASTRA004.teacherUid, "classesCreate", {
      classId: ASTRA004.classId,
      title: ASTRA004.classTitle,
      grade: ASTRA004.classGrade,
      block: ASTRA004.classBlock,
    });
    expect(harness.invoke).toHaveBeenNthCalledWith(
      2,
      ASTRA004.uid,
      "studentsCompleteOnboarding",
      {
        role: "student",
        schoolId: ASTRA004.studentSchoolId,
        displayName: "Ninety Ballard",
      },
    );
    expect(harness.invoke).toHaveBeenNthCalledWith(
      3,
      ASTRA004.teacherUid,
      "enrollmentsTeacherAdd",
      {
        classId: ASTRA004.classId,
        studentId: ASTRA004.uid,
      },
    );
    expect(result.plan).toEqual({
      stage: "complete",
      class: "satisfied",
      student: "satisfied",
      enrollment: "satisfied",
      nextOperations: [],
    });
  });

  test("recognizes every successful lifecycle prefix with exact next operations", async () => {
    const classCreated = makeHarness();
    setClassCreated(classCreated);
    await expect(prepareAstra004Student(baseInput(), classCreated.deps)).resolves.toMatchObject({
      plan: {
        stage: "class-created",
        nextOperations: ["studentsCompleteOnboarding", "enrollmentsTeacherAdd"],
      },
    });

    const activated = makeHarness();
    setClassCreated(activated);
    setStudentActive(activated);
    await expect(prepareAstra004Student(baseInput(), activated.deps)).resolves.toMatchObject({
      plan: {
        stage: "student-activated",
        nextOperations: ["enrollmentsTeacherAdd"],
      },
    });
  });

  test("refuses lifecycle combinations that are not a successful sequence prefix", async () => {
    const enrollmentWithoutClass = makeHarness();
    setEnrollmentCreated(enrollmentWithoutClass);
    await expect(
      prepareAstra004Student(baseInput(), enrollmentWithoutClass.deps),
    ).rejects.toThrow("inconsistent lifecycle combination");

    const activeWithoutClass = makeHarness();
    setStudentActive(activeWithoutClass);
    await expect(
      prepareAstra004Student(baseInput(), activeWithoutClass.deps),
    ).rejects.toThrow("inconsistent lifecycle combination");

    const enrollmentWhileProvisioned = makeHarness();
    setClassCreated(enrollmentWhileProvisioned);
    setEnrollmentCreated(enrollmentWhileProvisioned);
    await expect(
      prepareAstra004Student(baseInput(), enrollmentWhileProvisioned.deps),
    ).rejects.toThrow("inconsistent lifecycle combination");
  });

  test("uses canonical onboarding to recover the exact active-user claims split", async () => {
    const recoverableClaims: readonly (
      Readonly<Record<string, unknown>> | undefined
    )[] = [
      undefined,
      {},
      { role: "teacher", schoolId: ASTRA004.studentSchoolId, districtId: ASTRA004.districtId },
      { role: "student", schoolId: "wrong-school", districtId: ASTRA004.districtId },
      { role: "student", schoolId: ASTRA004.studentSchoolId },
      { role: "student", schoolId: ASTRA004.studentSchoolId, districtId: "" },
    ];
    for (const claims of recoverableClaims) {
      const dryRunHarness = makeHarness();
      setClassCreated(dryRunHarness);
      setStudentActive(dryRunHarness, claims ?? {});
      dryRunHarness.studentAuth = { ...dryRunHarness.studentAuth, customClaims: claims };
      const dryRun = await prepareAstra004Student(baseInput(), dryRunHarness.deps);
      expect(dryRun.plan).toEqual({
        stage: "partial-activation-recovery",
        class: "satisfied",
        student: "recover-claims",
        enrollment: "add",
        nextOperations: ["studentsCompleteOnboarding", "enrollmentsTeacherAdd"],
      });
      expect(dryRunHarness.invoke).not.toHaveBeenCalled();
    }

    const harness = makeHarness();
    setClassCreated(harness);
    setStudentActive(harness, {});
    const applied = await prepareAstra004Student(
      baseInput({ mode: "apply" }),
      harness.deps,
    );
    expect(harness.invoke.mock.calls.map((call) => call[1])).toEqual([
      "studentsCompleteOnboarding",
      "enrollmentsTeacherAdd",
    ]);
    expect(applied.plan.stage).toBe("complete");
  });

  test("refuses claims the canonical onboarding callable considers healthy but noncanonical", async () => {
    for (const claims of [
      {
        role: "student",
        schoolId: ASTRA004.studentSchoolId,
        districtId: "wrong-nonempty-district",
      },
      {
        role: "student",
        schoolId: ASTRA004.studentSchoolId,
        districtId: ASTRA004.districtId,
        extraClaim: "unsupported",
      },
    ]) {
      const harness = makeHarness();
      setClassCreated(harness);
      setStudentActive(harness, claims);
      await expect(prepareAstra004Student(baseInput(), harness.deps)).rejects.toThrow(
        "will not repair",
      );
      expect(harness.invoke).not.toHaveBeenCalled();
    }
  });

  test.each(["classesCreate", "studentsCompleteOnboarding", "enrollmentsTeacherAdd"])(
    "stops immediately when %s fails",
    async (failingName) => {
      const harness = makeHarness();
      const ordinaryInvoke = harness.deps.invokeCallableAs;
      harness.invoke = jest.fn((...args: Parameters<Astra004PreparationDeps["invokeCallableAs"]>) => {
        if (args[1] === failingName) return Promise.reject(new Error(`${failingName} failed`));
        return ordinaryInvoke(...args);
      });
      const deps: Astra004PreparationDeps = {
        ...harness.deps,
        invokeCallableAs: harness.invoke,
      };
      let error: unknown;
      try {
        await prepareAstra004Student(baseInput({ mode: "apply" }), deps);
      } catch (caught) {
        error = caught;
      }
      expect(formatAstra004Failure(error)).toContain(`stage=${failingName}`);
      expect(formatAstra004Failure(error)).not.toContain(`${failingName} failed`);
      const names = harness.invoke.mock.calls.map((call) => call[1]);
      expect(names.at(-1)).toBe(failingName);
      if (failingName !== "enrollmentsTeacherAdd") {
        expect(names).not.toContain("enrollmentsTeacherAdd");
      }
    },
  );
});

const ASTRA004_ASSIGNMENT_ID = "astra004-cert-20260908t120000000z";

type AssignmentHarness = {
  docs: Map<string, Record<string, unknown>>;
  deps: Astra004AssignmentPreparationDeps;
  invoke: jest.Mock;
  reads: jest.Mock;
  queries: jest.Mock;
};

function makeAssignmentHarness(): AssignmentHarness {
  const docs = new Map<string, Record<string, unknown>>([
    [`classes/${ASTRA004.classId}`, dedicatedClass()],
    [`schools/${ASTRA004.studentSchoolId}`, {
      districtId: ASTRA004.districtId,
    }],
    [`users/${ASTRA004.uid}`, finalUser()],
    [`enrollments/${ASTRA004.classId}__${ASTRA004.uid}`, dedicatedEnrollment()],
    [`users/${ASTRA004.teacherUid}`, {
      authUid: ASTRA004.teacherUid,
      role: "teacher",
      status: "active",
      schoolId: ASTRA004.studentSchoolId,
    }],
    ["assessments/assessment_what-is-life", {
      assessmentId: "assessment_what-is-life",
      activityId: ASTRA004_ASSIGNMENT.lessonSlug,
      currentRevisionId: "assessment_what-is-life__r1",
    }],
    ["assessmentRevisions/assessment_what-is-life__r1", {
      assessmentId: "assessment_what-is-life",
      activityId: ASTRA004_ASSIGNMENT.lessonSlug,
      revisionOrdinal: 1,
    }],
  ]);
  const teacherAuth: Astra004AuthUser = {
    uid: ASTRA004.teacherUid,
    disabled: false,
    providerData: [],
    customClaims: {
      role: "teacher",
      schoolId: ASTRA004.studentSchoolId,
      districtId: ASTRA004.districtId,
    },
  };
  const reads = jest.fn((path: string) => Promise.resolve(docs.get(path) ?? null));
  const queries = jest.fn((collection: string, field: string, value: string) => {
    const prefix = `${collection}/`;
    return Promise.resolve([...docs.entries()]
      .filter(([path, data]) =>
        path.startsWith(prefix) &&
        path.slice(prefix.length).indexOf("/") === -1 &&
        data[field] === value)
      .map(([path, data]) => ({ id: path.slice(prefix.length), data })));
  });
  const invoke = jest.fn((
    uid: string,
    name: string,
    data: Readonly<Record<string, unknown>>,
  ) => {
    expect(uid).toBe(ASTRA004.teacherUid);
    if (name === "assignmentsCreateDraft") {
      expect(data).toEqual({
        assignmentId: ASTRA004_ASSIGNMENT_ID,
        classId: ASTRA004.classId,
        lessonSlug: ASTRA004_ASSIGNMENT.lessonSlug,
        mode: "classroom",
        title: ASTRA004_ASSIGNMENT.title,
      });
      docs.set(`assignments/${ASTRA004_ASSIGNMENT_ID}`, {
        classId: ASTRA004.classId,
        teacherId: ASTRA004.teacherUid,
        schoolId: ASTRA004.studentSchoolId,
        lessonSlug: ASTRA004_ASSIGNMENT.lessonSlug,
        mode: "classroom",
        title: ASTRA004_ASSIGNMENT.title,
        status: "draft",
        createdAt: { seconds: 10 },
      });
      return Promise.resolve({
        assignmentId: ASTRA004_ASSIGNMENT_ID,
        status: "draft",
        alreadyCreated: false,
      });
    }
    if (name === "assignmentsPublish") {
      expect(data).toEqual({ assignmentId: ASTRA004_ASSIGNMENT_ID });
      const current = docs.get(`assignments/${ASTRA004_ASSIGNMENT_ID}`);
      docs.set(`assignments/${ASTRA004_ASSIGNMENT_ID}`, {
        ...current,
        status: "published",
        assessmentRevisionId: "assessment_what-is-life__r1",
      });
      docs.set(
        `assignments/${ASTRA004_ASSIGNMENT_ID}/recipients/${ASTRA004.uid}`,
        {
          assignmentId: ASTRA004_ASSIGNMENT_ID,
          studentId: ASTRA004.uid,
          classId: ASTRA004.classId,
          teacherId: ASTRA004.teacherUid,
          schoolId: ASTRA004.studentSchoolId,
          districtId: ASTRA004.districtId,
          status: "assigned",
          source: "classPublication",
        },
      );
      return Promise.resolve({
        assignmentId: ASTRA004_ASSIGNMENT_ID,
        status: "published",
        alreadyPublished: false,
      });
    }
    return Promise.reject(new Error("unexpected noncanonical callable"));
  });
  return {
    docs,
    reads,
    queries,
    invoke,
    deps: {
      getAuthUserByUid: jest.fn((uid: string) =>
        Promise.resolve(uid === ASTRA004.teacherUid ? teacherAuth : null)),
      getDocument: reads,
      queryCollection: queries,
      invokeCallableAs: invoke,
      createAssignmentId: jest.fn(() => ASTRA004_ASSIGNMENT_ID),
    },
  };
}

const assignmentInput = (overrides: Partial<{
  project: string;
  mode: "dry-run" | "apply";
  env: NodeJS.ProcessEnv;
}> = {}) => ({
  project: STAGING_PROJECT_ID,
  mode: "dry-run" as const,
  env: {},
  ...overrides,
});

describe("prepareAstra004Assignment token exchange isolation", () => {
  const approvedKey = "AIzaSyntheticStagingKeyForOfflineTests";

  class ServiceAccountCredential {
    constructor(
      readonly projectId: string,
      readonly clientEmail: string,
      readonly privateMaterial = "credential-private-canary",
    ) {}
  }

  class RefreshTokenCredential {}
  class UnknownCredential {
    readonly secret = "unknown-credential-canary";
  }

  function makeTokenHarness() {
    const createCustomToken = jest.fn(() => Promise.resolve("custom-token-canary"));
    const verifyIdToken = jest.fn(() => Promise.resolve({
      uid: ASTRA004.teacherUid,
      aud: STAGING_PROJECT_ID,
    }));
    const fetchMock = jest.fn(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ idToken: "id-token-canary" }),
    } as Response));
    const auth = { createCustomToken, verifyIdToken };
    return {
      auth,
      createCustomToken,
      verifyIdToken,
      fetchMock,
      deps: createAstra004TokenExchangeDeps(
        auth,
        fetchMock,
      ),
    };
  }

  const config = (
    credential: unknown,
    suppliedWebApiKey: string | undefined,
  ) => ({
    credential,
    configuredServiceAccountId: SIGNING_SERVICE_ACCOUNT,
    suppliedWebApiKey,
    approvedWebApiKey: approvedKey,
  });

  test("extracts exactly the staging key from the approved repository config shape", () => {
    const source = `
      var config = isStaging ? {
        apiKey: '${approvedKey}',
        projectId: 'lyfelabz-staging'
      } : {
        apiKey: 'AIzaSyntheticProductionKey',
        projectId: 'lyfelabz-prod'
      };
    `;
    expect(extractAstra004StagingWebApiKey(source)).toBe(approvedKey);
  });

  test.each([
    [
      "direct staging service-account signer",
      new ServiceAccountCredential(STAGING_PROJECT_ID, SIGNING_SERVICE_ACCOUNT),
    ],
    [
      "known ADC type with explicitly pinned staging IAM signer",
      new RefreshTokenCredential(),
    ],
  ])("%s plus the staging key may reach the real fetch adapter", async (_label, credential) => {
    const harness = makeTokenHarness();
    await expect(createAstra004StagingIdToken(
      ASTRA004.teacherUid,
      config(credential, approvedKey),
      harness.deps,
    )).resolves.toBe("id-token-canary");
    expect(harness.createCustomToken).toHaveBeenCalledTimes(1);
    expect(harness.fetchMock).toHaveBeenCalledTimes(1);
    expect(harness.verifyIdToken).toHaveBeenCalledTimes(1);
  });

  test.each([
    [
      "wrong signer",
      new ServiceAccountCredential("other-project", "other-project@example.invalid"),
      approvedKey,
    ],
    ["ambiguous signer", new UnknownCredential(), approvedKey],
    [
      "wrong API key",
      new ServiceAccountCredential(STAGING_PROJECT_ID, SIGNING_SERVICE_ACCOUNT),
      "AIzaSyntheticWrongKey",
    ],
    [
      "missing API key",
      new ServiceAccountCredential(STAGING_PROJECT_ID, SIGNING_SERVICE_ACCOUNT),
      undefined,
    ],
    [
      "wrong signer and wrong API key",
      new ServiceAccountCredential("other-project", "other-project@example.invalid"),
      "AIzaSyntheticWrongKey",
    ],
  ])("rejects %s before custom-token creation or fetch", async (
    _label,
    credential,
    suppliedKey,
  ) => {
    const harness = makeTokenHarness();
    await expect(createAstra004StagingIdToken(
      ASTRA004.teacherUid,
      config(credential, suppliedKey),
      harness.deps,
    )).rejects.toThrow();
    expect(harness.createCustomToken).not.toHaveBeenCalled();
    expect(harness.fetchMock).not.toHaveBeenCalled();
    expect(harness.verifyIdToken).not.toHaveBeenCalled();
  });

  test("configuration refusals sanitize credential and API-key material", async () => {
    const harness = makeTokenHarness();
    const secretKey = "AIzaSecretKeyCanaryThatMustNotAppear";
    let error: unknown;
    try {
      await createAstra004StagingIdToken(
        ASTRA004.teacherUid,
        config(new UnknownCredential(), secretKey),
        harness.deps,
      );
    } catch (caught) {
      error = caught;
    }
    const rendered = formatAstra004Failure(error);
    expect(rendered).not.toContain(secretKey);
    expect(rendered).not.toContain("unknown-credential-canary");
    expect(rendered).not.toContain("credential-private-canary");
    expect(rendered).not.toContain(SIGNING_SERVICE_ACCOUNT);
    expect(harness.fetchMock).not.toHaveBeenCalled();
  });
});

describe("prepareAstra004Assignment CLI and project isolation", () => {
  const exactArgs = [
    "prepareAstra004Assignment",
    `--project=${STAGING_PROJECT_ID}`,
  ] as const;

  test("parses default dry-run and explicit modes", () => {
    expect(parseAstra004AssignmentCliArgs(exactArgs).mode).toBe("dry-run");
    expect(parseAstra004AssignmentCliArgs([...exactArgs, "--dry-run"]).mode).toBe("dry-run");
    expect(parseAstra004AssignmentCliArgs([...exactArgs, "--apply"]).mode).toBe("apply");
  });

  test("derives a fresh callable-safe ID from the apply instant", () => {
    expect(createAstra004AssignmentId(new Date("2026-09-08T12:00:00.000Z"))).toBe(
      ASTRA004_ASSIGNMENT_ID,
    );
  });

  const invalidAssignmentArgv: readonly (readonly string[])[] = [
    ["prepareAstra004Assignment"],
    ["prepareAstra004Assignment", "--project=lyfelabz-prod"],
    [...exactArgs, "--dry-run", "--apply"],
    [...exactArgs, "--apply", "--apply"],
    [...exactArgs, `--project=${STAGING_PROJECT_ID}`],
    [...exactArgs, "--project="],
    [...exactArgs, "--apply=true"],
    [...exactArgs, "--uid=unexpected"],
    [...exactArgs, "unexpected"],
    ["otherCommand", `--project=${STAGING_PROJECT_ID}`],
  ];
  test.each(invalidAssignmentArgv.map((argv) => [argv]))(
    "rejects malformed, duplicate, conflicting, or unexpected CLI input %#",
    (argv) => {
      expect(() => parseAstra004AssignmentCliArgs(argv)).toThrow();
    },
  );

  test.each([
    [{ project: undefined }, "project"],
    [{ project: "lyfelabz-prod" }, "project"],
    [{ env: { GCLOUD_PROJECT: "lyfelabz-prod" } }, "project"],
    [{ env: { GOOGLE_CLOUD_PROJECT: "other" } }, "project"],
    [{ env: { FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080" } }, "FIRESTORE_EMULATOR_HOST"],
    [{ env: { FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" } }, "FIREBASE_AUTH_EMULATOR_HOST"],
  ])("refuses unsafe project or emulator input %p", async (overrides, expected) => {
    const harness = makeAssignmentHarness();
    await expect(
      prepareAstra004Assignment(assignmentInput(overrides), harness.deps),
    ).rejects.toThrow(expected);
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  test("process entry point binds assignment clients only to the named staging app", () => {
    const result = executeActualAstra004NodeCli({
      command: "prepareAstra004Assignment",
    });
    expect(result.status).toBe(1);
    expect(result.trace).toContain(`initializeApp:${ASTRA004_ADMIN_APP_NAME}`);
    expect(result.trace).toContain(`getAuth:1:${ASTRA004_ADMIN_APP_NAME}`);
    expect(result.trace).toContain(`getFirestore:1:${ASTRA004_ADMIN_APP_NAME}`);
    expect(result.trace).not.toContain("getAuth:0:");
    expect(result.trace).not.toContain("getFirestore:0:");
  });

  test("CLI dry-run reports the redacted zero-write plan", async () => {
    const harness = makeAssignmentHarness();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const staging = {
      name: ASTRA004_ADMIN_APP_NAME,
      options: { projectId: STAGING_PROJECT_ID },
    };
    const exitCode = await runAstra004AssignmentCliEntryPoint(
      [...exactArgs, "--dry-run"],
      {
        env: {},
        getApps: () => [staging],
        initializeApp: () => staging,
        getAuth: () => ({ staging: "auth" }),
        getFirestore: () => ({ staging: "firestore" }),
        createPreparationDeps: () => harness.deps,
        writeStdout: (value) => stdout.push(value),
        writeStderr: (value) => stderr.push(value),
      },
    );
    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain('"writesPerformed":0');
    expect(stdout.join("\n")).toContain('"preflightPassed":true');
    expect(stdout.join("\n")).toContain('"conflictingCertificationAssignmentExists":false');
    expect(stderr).toEqual([]);
    expect(harness.invoke).not.toHaveBeenCalled();
  });
});

describe("prepareAstra004Assignment preflight and protected targets", () => {
  test("requires the dedicated active manual class and district", async () => {
    for (const mutate of [
      (h: AssignmentHarness) => h.docs.delete(`classes/${ASTRA004.classId}`),
      (h: AssignmentHarness) => {
        h.docs.get(`classes/${ASTRA004.classId}`)!.status = "archived";
      },
      (h: AssignmentHarness) => {
        h.docs.get(`classes/${ASTRA004.classId}`)!.teacherId = "other-teacher";
      },
      (h: AssignmentHarness) => {
        h.docs.get(`schools/${ASTRA004.studentSchoolId}`)!.districtId = "other-district";
      },
    ]) {
      const harness = makeAssignmentHarness();
      mutate(harness);
      await expect(
        prepareAstra004Assignment(assignmentInput(), harness.deps),
      ).rejects.toThrow(/class|district/);
      expect(harness.invoke).not.toHaveBeenCalled();
    }
  });

  test("rejects every class LMS or Classroom authority signal", async () => {
    const sourced = makeAssignmentHarness();
    sourced.docs.get(`classes/${ASTRA004.classId}`)!.enrollmentSource = "lms";
    await expect(
      prepareAstra004Assignment(assignmentInput(), sourced.deps),
    ).rejects.toThrow("LMS");

    const provider = makeAssignmentHarness();
    provider.docs.get(`classes/${ASTRA004.classId}`)!.lmsProviderRef = "googleClassroom";
    await expect(
      prepareAstra004Assignment(assignmentInput(), provider.deps),
    ).rejects.toThrow("LMS");

    const link = makeAssignmentHarness();
    link.docs.set("lmsClassLinks/link-1", {
      classId: ASTRA004.classId,
      status: "linked",
    });
    await expect(
      prepareAstra004Assignment(assignmentInput(), link.deps),
    ).rejects.toThrow("Classroom/LMS");
  });

  test("requires the canonical active student and exact active enrollment", async () => {
    const student = makeAssignmentHarness();
    student.docs.get(`users/${ASTRA004.uid}`)!.role = "teacher";
    await expect(
      prepareAstra004Assignment(assignmentInput(), student.deps),
    ).rejects.toThrow("student canonical user");

    const enrollment = makeAssignmentHarness();
    enrollment.docs.delete(`enrollments/${ASTRA004.classId}__${ASTRA004.uid}`);
    await expect(
      prepareAstra004Assignment(assignmentInput(), enrollment.deps),
    ).rejects.toThrow("enrollment");
  });

  test("rejects any accommodation document", async () => {
    const harness = makeAssignmentHarness();
    harness.docs.set(`studentAccommodations/${ASTRA004.uid}`, {
      status: "inactive",
    });
    await expect(
      prepareAstra004Assignment(assignmentInput(), harness.deps),
    ).rejects.toThrow("accommodation");
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  test("ignores and never touches the historical assignment fixture", async () => {
    const harness = makeAssignmentHarness();
    harness.docs.set(`assignments/${ASTRA004_ASSIGNMENT.historicalAssignmentId}`, {
      classId: ASTRA004.classId,
      lessonSlug: ASTRA004_ASSIGNMENT.historicalLessonSlug,
      status: "published",
    });
    const result = await prepareAstra004Assignment(assignmentInput(), harness.deps);
    expect(result.preflightPassed).toBe(true);
    expect(harness.invoke).not.toHaveBeenCalled();
    expect(harness.docs.get(
      `assignments/${ASTRA004_ASSIGNMENT.historicalAssignmentId}`,
    )).toEqual({
      classId: ASTRA004.classId,
      lessonSlug: ASTRA004_ASSIGNMENT.historicalLessonSlug,
      status: "published",
    });
  });

  test("rejects active conflicting certification assignments", async () => {
    const harness = makeAssignmentHarness();
    harness.docs.set("assignments/astra004-cert-old", {
      classId: ASTRA004.classId,
      lessonSlug: ASTRA004_ASSIGNMENT.lessonSlug,
      title: ASTRA004_ASSIGNMENT.title,
      status: "published",
    });
    await expect(
      prepareAstra004Assignment(assignmentInput(), harness.deps),
    ).rejects.toThrow("ambiguous");
    expect(harness.invoke).not.toHaveBeenCalled();
  });
});

describe("prepareAstra004Assignment canonical callable orchestration", () => {
  function mutatePublishedState(
    harness: AssignmentHarness,
    mutate: () => void,
  ): void {
    const invoke = harness.invoke.getMockImplementation()!;
    harness.invoke.mockImplementation((
      ...args: Parameters<Astra004AssignmentPreparationDeps["invokeCallableAs"]>
    ) => {
      const response = invoke(...args);
      if (args[1] === "assignmentsPublish") mutate();
      return response;
    });
  }

  test("dry-run performs reads but zero mutation, token minting, or ID creation", async () => {
    const harness = makeAssignmentHarness();
    const result = await prepareAstra004Assignment(assignmentInput(), harness.deps);
    expect(result).toMatchObject({
      project: STAGING_PROJECT_ID,
      classId: ASTRA004.classId,
      lessonSlug: "what-is-life",
      studentUid: ASTRA004.uid,
      intendedCallableSequence: ["assignmentsCreateDraft", "assignmentsPublish"],
      conflictingCertificationAssignmentExists: false,
      preflightPassed: true,
      writesPerformed: 0,
    });
    expect(harness.invoke).not.toHaveBeenCalled();
    expect(harness.deps.createAssignmentId).not.toHaveBeenCalled();
  });

  test("apply creates before publishing, uses the returned exact ID, and verifies final state", async () => {
    const harness = makeAssignmentHarness();
    const result = await prepareAstra004Assignment(
      assignmentInput({ mode: "apply" }),
      harness.deps,
    );
    expect(harness.invoke.mock.calls.map((call) => call[1])).toEqual([
      "assignmentsCreateDraft",
      "assignmentsPublish",
    ]);
    expect(harness.invoke.mock.calls[1][2]).toEqual({
      assignmentId: ASTRA004_ASSIGNMENT_ID,
    });
    expect(result).toMatchObject({
      assignmentId: ASTRA004_ASSIGNMENT_ID,
      finalStatus: "published",
      recipientSnapshotVerified: true,
      mutationStagesCompleted: 2,
    });
    expect(harness.reads).toHaveBeenCalledWith(
      `assignments/${ASTRA004_ASSIGNMENT_ID}/recipients/${ASTRA004.uid}`,
    );
    expect(harness.invoke.mock.calls.flat().join(" ")).not.toMatch(/Classroom|lms/i);
  });

  test("refuses a staging-cert-fixture draft and does not publish it", async () => {
    const harness = makeAssignmentHarness();
    harness.invoke.mockImplementationOnce((
      _uid: string,
      _name: string,
      data: Readonly<Record<string, unknown>>,
    ) => {
      harness.docs.set(`assignments/${ASTRA004_ASSIGNMENT_ID}`, {
        classId: ASTRA004.classId,
        teacherId: ASTRA004.teacherUid,
        schoolId: ASTRA004.studentSchoolId,
        lessonSlug: ASTRA004_ASSIGNMENT.historicalLessonSlug,
        mode: "classroom",
        title: ASTRA004_ASSIGNMENT.title,
        status: "draft",
      });
      return Promise.resolve({
        assignmentId: data.assignmentId,
        status: "draft",
        alreadyCreated: false,
      });
    });
    await expect(
      prepareAstra004Assignment(assignmentInput({ mode: "apply" }), harness.deps),
    ).rejects.toThrow("draft verification");
    expect(harness.invoke).toHaveBeenCalledTimes(1);
  });

  test("uses the callable-returned assignment ID as a strict publication gate", async () => {
    const harness = makeAssignmentHarness();
    harness.invoke.mockResolvedValueOnce({
      assignmentId: ASTRA004_ASSIGNMENT.historicalAssignmentId,
      status: "draft",
    });
    await expect(
      prepareAstra004Assignment(assignmentInput({ mode: "apply" }), harness.deps),
    ).rejects.toThrow("unexpected assignment");
    expect(harness.invoke).toHaveBeenCalledTimes(1);
  });

  test("refuses an idempotent replay instead of treating it as a fresh assignment", async () => {
    const harness = makeAssignmentHarness();
    harness.invoke.mockResolvedValueOnce({
      assignmentId: ASTRA004_ASSIGNMENT_ID,
      status: "draft",
      alreadyCreated: true,
    });
    await expect(
      prepareAstra004Assignment(assignmentInput({ mode: "apply" }), harness.deps),
    ).rejects.toThrow("unexpected assignment");
    expect(harness.invoke).toHaveBeenCalledTimes(1);
  });

  test("refuses failed final assignment or recipient verification", async () => {
    const wrongFinal = makeAssignmentHarness();
    const normalInvoke = wrongFinal.invoke.getMockImplementation()!;
    wrongFinal.invoke.mockImplementation((...args: unknown[]) => {
      const response = normalInvoke(...args);
      if (args[1] === "assignmentsPublish") {
        wrongFinal.docs.get(`assignments/${ASTRA004_ASSIGNMENT_ID}`)!.lessonSlug = "changed";
      }
      return response;
    });
    await expect(
      prepareAstra004Assignment(assignmentInput({ mode: "apply" }), wrongFinal.deps),
    ).rejects.toThrow("published verification");

    const noRecipient = makeAssignmentHarness();
    const publish = noRecipient.invoke.getMockImplementation()!;
    noRecipient.invoke.mockImplementation((...args: unknown[]) => {
      const response = publish(...args);
      if (args[1] === "assignmentsPublish") {
        noRecipient.docs.delete(
          `assignments/${ASTRA004_ASSIGNMENT_ID}/recipients/${ASTRA004.uid}`,
        );
      }
      return response;
    });
    await expect(
      prepareAstra004Assignment(assignmentInput({ mode: "apply" }), noRecipient.deps),
    ).rejects.toThrow("recipient snapshot");
  });

  test.each([
    [
      "fixture revision",
      "assessment_staging-cert-fixture__r1",
      "assessment_staging-cert-fixture__r1",
      {
        assessmentId: "assessment_staging-cert-fixture",
        activityId: ASTRA004_ASSIGNMENT.historicalLessonSlug,
        revisionOrdinal: 1,
      },
    ],
    [
      "valid revision ID for another lesson",
      "assessment_other-lesson__r1",
      "assessment_other-lesson__r1",
      {
        assessmentId: "assessment_other-lesson",
        activityId: "other-lesson",
        revisionOrdinal: 1,
      },
    ],
    [
      "nonexistent revision",
      "assessment_what-is-life__r404",
      "assessment_what-is-life__r404",
      null,
    ],
    [
      "malformed revision ID",
      "not-a-revision",
      "not-a-revision",
      null,
    ],
    [
      "zero-padded r01 revision ID",
      "assessment_what-is-life__r01",
      "assessment_what-is-life__r01",
      {
        assessmentId: "assessment_what-is-life",
        activityId: ASTRA004_ASSIGNMENT.lessonSlug,
        revisionOrdinal: 1,
      },
    ],
    [
      "zero-padded r001 revision ID",
      "assessment_what-is-life__r001",
      "assessment_what-is-life__r001",
      {
        assessmentId: "assessment_what-is-life",
        activityId: ASTRA004_ASSIGNMENT.lessonSlug,
        revisionOrdinal: 1,
      },
    ],
  ])("rejects a final assignment carrying a %s", async (
    _label,
    assignmentRevisionId,
    canonicalRevisionId,
    revision,
  ) => {
    const harness = makeAssignmentHarness();
    mutatePublishedState(harness, () => {
      harness.docs.get(`assignments/${ASTRA004_ASSIGNMENT_ID}`)!
        .assessmentRevisionId = assignmentRevisionId;
      harness.docs.get("assessments/assessment_what-is-life")!
        .currentRevisionId = canonicalRevisionId;
      if (revision) {
        harness.docs.set(`assessmentRevisions/${assignmentRevisionId}`, revision);
      }
    });
    await expect(
      prepareAstra004Assignment(assignmentInput({ mode: "apply" }), harness.deps),
    ).rejects.toThrow(/revision|canonical|lesson/);
  });

  test("rejects a valid revision document whose authoritative lesson metadata is unrelated", async () => {
    const harness = makeAssignmentHarness();
    harness.docs.get("assessmentRevisions/assessment_what-is-life__r1")!
      .activityId = "other-lesson";
    await expect(
      prepareAstra004Assignment(assignmentInput({ mode: "apply" }), harness.deps),
    ).rejects.toThrow("another lesson");
  });

  test("rejects a published assignment that mismatches the canonical current revision", async () => {
    const harness = makeAssignmentHarness();
    harness.docs.set("assessmentRevisions/assessment_what-is-life__r2", {
      assessmentId: "assessment_what-is-life",
      activityId: ASTRA004_ASSIGNMENT.lessonSlug,
      revisionOrdinal: 2,
    });
    harness.docs.get("assessments/assessment_what-is-life")!
      .currentRevisionId = "assessment_what-is-life__r2";
    await expect(
      prepareAstra004Assignment(assignmentInput({ mode: "apply" }), harness.deps),
    ).rejects.toThrow("canonical assessment revision");
  });

  test("acceptance path reads both authoritative assessment records", async () => {
    const harness = makeAssignmentHarness();
    await expect(
      prepareAstra004Assignment(assignmentInput({ mode: "apply" }), harness.deps),
    ).resolves.toMatchObject({ finalStatus: "published" });
    expect(harness.reads).toHaveBeenCalledWith(
      "assessments/assessment_what-is-life",
    );
    expect(harness.reads).toHaveBeenCalledWith(
      "assessmentRevisions/assessment_what-is-life__r1",
    );
  });

  test("stops after a failed stage and sanitizes external errors", async () => {
    const harness = makeAssignmentHarness();
    const canary = "Authorization: Bearer SUPER_SECRET_TOKEN";
    harness.invoke.mockRejectedValueOnce(new Error(canary));
    let error: unknown;
    try {
      await prepareAstra004Assignment(
        assignmentInput({ mode: "apply" }),
        harness.deps,
      );
    } catch (caught) {
      error = caught;
    }
    const rendered = formatAstra004Failure(error);
    expect(rendered).toContain("stage=assignmentsCreateDraft");
    expect(rendered).toContain("CALLABLE_FAILED");
    expect(rendered).not.toContain(canary);
    expect(harness.invoke).toHaveBeenCalledTimes(1);
  });

  test("dependency boundary exposes no direct assignment writes or LMS calls", () => {
    const harness = makeAssignmentHarness();
    expect(Object.keys(harness.deps).sort()).toEqual([
      "createAssignmentId",
      "getAuthUserByUid",
      "getDocument",
      "invokeCallableAs",
      "queryCollection",
    ]);
    expect(String(prepareAstra004Assignment)).not.toMatch(/\.set\(|\.update\(|\.commit\(/);
    expect(String(prepareAstra004Assignment)).not.toMatch(/googleClassroom|lmsAssignments/i);
  });
});
