const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
}));

const mockRunTransaction = jest.fn();

// The doc-ref helpers and transaction runner are stubbed so no firebase-admin
// app is required; the identifier grammar is reimplemented here exactly as in
// assessment-deployment.test.ts. cert-lessons.test.ts separately proves that
// certAssessmentIdentifiers() produces these very id strings through the real
// shared grammar, so this suite's literal-id assertions bind the committed
// payloads to the canonical cert identifiers.
jest.mock("../../shared", () => {
  const { PlatformError } = jest.requireActual("../../shared/errors/platform-error");
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
    assessmentDeploymentDocRef: (id: string) => ({ __kind: "assessmentDeployment", id }),
    assessmentRevisionDeploymentDocRef: (id: string) => ({ __kind: "revisionDeployment", id }),
    assessmentAnswerKeyDeploymentDocRef: (id: string) => ({ __kind: "answerKeyDeployment", id }),
    assessmentIdForLessonSlug: (slug: string) => `assessment_${slug}`,
    revisionIdForOrdinal: (assessmentId: string, ordinal: number) =>
      `${assessmentId}__r${String(ordinal)}`,
    parseRevisionOrdinalFromRevisionId: (revisionId: string) => {
      const m = /__r(\d+)$/.exec(revisionId);
      if (!m) return undefined;
      const ordinal = Number(m[1]);
      if (!Number.isFinite(ordinal) || !Number.isInteger(ordinal) || ordinal < 1) {
        return undefined;
      }
      return ordinal;
    },
  };
});

import { deployAssessmentRevision } from "../../assessments/assessment-deployment";
import { CERT_LESSONS } from "./cert-lessons";

import whatIsLife from "./what-is-life.r1.json";
import cellTypes from "./cell-types.r1.json";
import biologicalEvolution from "./biological-evolution.r1.json";

const PAYLOADS: Record<string, unknown> = {
  "what-is-life": whatIsLife,
  "cell-types": cellTypes,
  "biological-evolution": biologicalEvolution,
};

const txWrites: Array<{ ref: { __kind: string; id: string }; data: Record<string, unknown> }> = [];

function makeSnap(exists: boolean, data?: () => unknown) {
  return { exists, data: data ?? (() => undefined) };
}

beforeEach(() => {
  txWrites.length = 0;
  mockRunTransaction.mockReset();
  mockRunTransaction.mockImplementation((fn: (tx: unknown) => unknown) => {
    // Fresh deployment: nothing pre-exists, so validation + first-publication
    // paths run in full against the committed payload.
    const tx = {
      get: () => makeSnap(false),
      set: (ref: { __kind: string; id: string }, data: Record<string, unknown>) => {
        txWrites.push({ ref, data });
      },
      create: (ref: { __kind: string; id: string }, data: Record<string, unknown>) => {
        txWrites.push({ ref, data });
      },
      delete: () => undefined,
    };
    return fn(tx);
  });
});

describe("committed cert payloads deploy through the certified pipeline", () => {
  for (const lesson of CERT_LESSONS) {
    it(`${lesson.slug} deploys to the canonical cert assessment records`, async () => {
      const payload = PAYLOADS[lesson.slug];
      const assessmentId = `assessment_${lesson.slug}`;
      const revisionId = `${assessmentId}__r1`;

      const result = await deployAssessmentRevision(payload);

      expect(result).toEqual({
        assessmentId,
        revisionId,
        revisionOrdinal: 1,
        assessmentCreated: true,
      });

      // Exactly the three deployment documents were written.
      expect(txWrites).toHaveLength(3);
      const byKind = Object.fromEntries(txWrites.map((w) => [w.ref.__kind, w]));

      expect(byKind.revisionDeployment.ref.id).toBe(revisionId);
      expect(byKind.answerKeyDeployment.ref.id).toBe(revisionId);
      expect(byKind.assessmentDeployment.ref.id).toBe(assessmentId);

      // The root assessment points at the deployed revision - exactly what
      // resolveCurrentAssessmentRevisionId reads on the publish path.
      expect(byKind.assessmentDeployment.data).toEqual({
        assessmentId,
        activityId: lesson.slug,
        currentRevisionId: revisionId,
      });

      const items = (payload as { items: unknown[] }).items;
      expect(byKind.revisionDeployment.data.items).toHaveLength(items.length);
      expect(byKind.answerKeyDeployment.data.items).toHaveLength(items.length);
      expect(byKind.revisionDeployment.data.schemaVersion).toBe(1);
    });
  }
});
