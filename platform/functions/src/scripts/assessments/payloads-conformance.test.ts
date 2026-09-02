import * as fs from "fs";
import * as path from "path";

// Sprint 29G.1 - Committed assessment payload conformance coverage.
//
// Every committed `*.r1.json` assessment payload in this directory is a
// canonical `AssessmentDeploymentInput` (the exact shape the administrative
// deploy CLI, `scripts/deploy-assessment.ts`, feeds to the certified
// `deployAssessmentRevision` pipeline). Before Sprint 29G.1 only the bounded
// certification subset and synthetic cases were exercised through the real
// validator; the full committed set was never run through it in CI. This
// suite closes that gap: it discovers all committed payloads and drives each
// one through the SAME production deployment entry point
// (`deployAssessmentRevision`), so any structural drift that the production
// validator would reject is caught locally, before a release attempt.
//
// Production safety. This test invokes the real `deployAssessmentRevision`,
// but the `../shared` module (its only Firestore-touching dependency) is
// mocked exactly as the deployment unit test mocks it: `runFirestoreTransaction`
// is replaced with an in-memory fake whose `get` always reports a
// not-yet-existing document and whose `create`/`set` are inert. No
// firebase-admin, no Firestore, no network, and no credentials are involved.
// The validator (`validateDeploymentInput`, defined in
// `assessment-deployment.ts` and NOT mocked) runs for real; only the write
// boundary is stubbed. The payload files are read but never written.

const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
}));

// A no-op transaction: every document reports as absent, so the deployment
// takes the first-publication (create) path, and the create/set writes are
// inert jest fns. This exercises the full real code path of
// `deployAssessmentRevision` - validation AND the transaction body - without
// any Firestore side effect.
const mockRunTransaction = jest.fn(
  async (fn: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      get: () => ({
        exists: false,
        data: () => undefined,
      }),
      create: jest.fn(),
      set: jest.fn(),
    };
    return fn(tx);
  },
);

jest.mock("../../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../../shared/errors/platform-error",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    ASSESSMENT_SCHEMA_VERSION_V1: 1,
    runFirestoreTransaction: (fn: (tx: unknown) => Promise<unknown>) =>
      mockRunTransaction(fn),
    assessmentDocRef: (id: string) => ({ __kind: "assessment", id }),
    assessmentRevisionDocRef: (id: string) => ({ __kind: "revision", id }),
    assessmentAnswerKeyDocRef: (id: string) => ({ __kind: "answerKey", id }),
    assessmentDeploymentDocRef: (id: string) => ({
      __kind: "assessmentDeployment",
      id,
    }),
    assessmentRevisionDeploymentDocRef: (id: string) => ({
      __kind: "revisionDeployment",
      id,
    }),
    assessmentAnswerKeyDeploymentDocRef: (id: string) => ({
      __kind: "answerKeyDeployment",
      id,
    }),
    assessmentIdForLessonSlug: (slug: string) => `assessment_${slug}`,
    revisionIdForOrdinal: (assessmentId: string, ordinal: number) =>
      `${assessmentId}__r${String(ordinal)}`,
    parseRevisionOrdinalFromRevisionId: (revisionId: string) => {
      const m = /__r(\d+)$/.exec(revisionId);
      if (!m) return undefined;
      const ordinal = Number(m[1]);
      if (
        !Number.isFinite(ordinal) ||
        !Number.isInteger(ordinal) ||
        ordinal < 1
      ) {
        return undefined;
      }
      return ordinal;
    },
  };
});

import { deployAssessmentRevision } from "../../assessments/assessment-deployment";

// The committed payloads live beside this test file. Discovery is by
// filesystem so an added or removed payload is caught without editing an
// enumeration by hand. Sorted for deterministic ordering.
const PAYLOAD_SUFFIX = ".r1.json";
const PAYLOAD_DIR = __dirname;

// Guardrail count. The committed set is 49 as of Sprint 29G.1. Asserting the
// exact count is deliberate: a payload silently lost (a bad merge, an errant
// delete) or a payload silently added (an uncertified file) should force a
// conscious update to this constant and a human review, rather than passing
// unnoticed because the loop simply iterated a different number of files.
const EXPECTED_PAYLOAD_COUNT = 49;

function discoverPayloadFiles(): string[] {
  return fs
    .readdirSync(PAYLOAD_DIR)
    .filter((name) => name.endsWith(PAYLOAD_SUFFIX))
    .sort();
}

const payloadFiles = discoverPayloadFiles();

describe("committed r1 assessment payload conformance", () => {
  it(`discovers exactly ${String(EXPECTED_PAYLOAD_COUNT)} committed r1 payloads`, () => {
    expect(payloadFiles.length).toBe(EXPECTED_PAYLOAD_COUNT);
  });

  // Every committed payload must parse as JSON and pass the real production
  // deployment validation path. A malformed file fails its own case (never
  // silently skipped) with the filename in the test name; a structurally
  // invalid payload fails with the deployment error code and the offending
  // file, without dumping the payload contents.
  it.each(payloadFiles)(
    "%s passes the production deployment validator",
    async (fileName) => {
      const fullPath = path.join(PAYLOAD_DIR, fileName);
      const raw = fs.readFileSync(fullPath, "utf8");

      let payload: unknown;
      try {
        payload = JSON.parse(raw);
      } catch (err) {
        throw new Error(
          `${fileName}: not valid JSON: ${(err as Error).message}`,
        );
      }

      try {
        const result = await deployAssessmentRevision(payload);
        // Sanity: the validator resolved the payload to a canonical identity.
        expect(result.assessmentId).toMatch(/^assessment_/);
        expect(result.revisionOrdinal).toBeGreaterThanOrEqual(1);
      } catch (err) {
        const code = (err as { code?: unknown }).code;
        const message = (err as Error).message ?? String(err);
        throw new Error(
          `${fileName}: rejected by production deployment validator` +
            `${typeof code === "string" ? ` [${code}]` : ""}: ${message}`,
        );
      }
    },
  );
});
