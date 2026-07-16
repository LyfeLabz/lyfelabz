const SERVER_TIMESTAMP_SENTINEL = Symbol("serverTimestamp");

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
}));

const mockRunTransaction = jest.fn();

const mockAssessmentDocRef = jest.fn((id: string) => ({
  __kind: "assessment",
  id,
}));
const mockAssessmentRevisionDocRef = jest.fn((id: string) => ({
  __kind: "revision",
  id,
}));
const mockAssessmentAnswerKeyDocRef = jest.fn((id: string) => ({
  __kind: "answerKey",
  id,
}));
const mockAssessmentDeploymentDocRef = jest.fn((id: string) => ({
  __kind: "assessmentDeployment",
  id,
}));
const mockAssessmentRevisionDeploymentDocRef = jest.fn((id: string) => ({
  __kind: "revisionDeployment",
  id,
}));
const mockAssessmentAnswerKeyDeploymentDocRef = jest.fn((id: string) => ({
  __kind: "answerKeyDeployment",
  id,
}));

const mockLogInfo = jest.fn();
const mockLogWarn = jest.fn();
const mockLogError = jest.fn();

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return {
    platformCallable: (handler: unknown) => handler,
    PlatformError,
    log: { info: mockLogInfo, warn: mockLogWarn, error: mockLogError },
    ASSESSMENT_SCHEMA_VERSION_V1: 1,
    runFirestoreTransaction: (fn: (tx: unknown) => Promise<unknown>) =>
      mockRunTransaction(fn),
    assessmentDocRef: mockAssessmentDocRef,
    assessmentRevisionDocRef: mockAssessmentRevisionDocRef,
    assessmentAnswerKeyDocRef: mockAssessmentAnswerKeyDocRef,
    assessmentDeploymentDocRef: mockAssessmentDeploymentDocRef,
    assessmentRevisionDeploymentDocRef: mockAssessmentRevisionDeploymentDocRef,
    assessmentAnswerKeyDeploymentDocRef: mockAssessmentAnswerKeyDeploymentDocRef,
  };
});

import { PlatformError } from "../shared/errors/platform-error";
import {
  assessmentIdFor,
  deployAssessmentRevision,
  parseRevisionOrdinalFromId,
  revisionIdFor,
  type AssessmentDeploymentInput,
} from "./assessment-deployment";

const ACTIVITY_ID = "lesson_g7_earths-layers";
const ASSESSMENT_ID = `assessment_${ACTIVITY_ID}`;
const REVISION_ID_1 = `${ASSESSMENT_ID}__r1`;
const REVISION_ID_2 = `${ASSESSMENT_ID}__r2`;

function baseInput(overrides: Partial<AssessmentDeploymentInput> = {}): AssessmentDeploymentInput {
  return {
    activityId: ACTIVITY_ID,
    revisionOrdinal: 1,
    itemOrderingRule: "authoredOrder",
    schemaVersion: 1,
    publishedBy: "deployment",
    items: [
      {
        itemId: "q1",
        itemType: "singleChoice",
        stem: "What is the innermost layer?",
        options: [
          { optionId: "A", text: "Crust" },
          { optionId: "B", text: "Mantle" },
          { optionId: "C", text: "Inner core" },
        ],
        points: 1,
        correctOptionId: "C",
        explanation: "The inner core is the innermost layer.",
      },
      {
        itemId: "q2",
        itemType: "singleChoice",
        stem: "Which layer flows plastically?",
        options: [
          { optionId: "A", text: "Crust" },
          { optionId: "B", text: "Mantle" },
        ],
        points: 1,
        correctOptionId: "B",
        explanation: "The mantle flows plastically.",
      },
    ],
    ...overrides,
  };
}

type Fixture = {
  assessment?: { activityId: string; currentRevisionId: string; assessmentId: string };
  revision?: unknown;
  answerKey?: unknown;
};

const fixture: Fixture = {};
const txSets: Array<{ ref: unknown; data: unknown }> = [];
const txDeletes: unknown[] = [];

function makeSnap(exists: boolean, data?: () => unknown) {
  return { exists, data: data ?? (() => undefined) };
}

function installTransactionRunner() {
  mockRunTransaction.mockImplementation((fn: (tx: unknown) => unknown) => {
    const tx = {
      get: (ref: { __kind: string; id: string }) => {
        if (ref.__kind === "assessment") {
          return makeSnap(fixture.assessment !== undefined, () => fixture.assessment);
        }
        if (ref.__kind === "revision") {
          return makeSnap(fixture.revision !== undefined, () => fixture.revision);
        }
        if (ref.__kind === "answerKey") {
          return makeSnap(fixture.answerKey !== undefined, () => fixture.answerKey);
        }
        throw new Error(`Unexpected ref: ${JSON.stringify(ref)}`);
      },
      set: (ref: unknown, data: unknown) => {
        txSets.push({ ref, data });
      },
      create: (ref: unknown, data: unknown) => {
        // Sprint 11D I-2. `deployAssessmentRevision` now uses tx.create()
        // for the immutable revision and answer-key writes so a
        // concurrent second commit cannot overwrite an already-published
        // revision. The mocked transaction records creates alongside
        // sets so the ordering assertions in this suite continue to
        // observe every write.
        txSets.push({ ref, data });
      },
      delete: (ref: unknown) => {
        txDeletes.push(ref);
      },
    };
    return fn(tx);
  });
}

describe("deployAssessmentRevision", () => {
  beforeEach(() => {
    mockRunTransaction.mockReset();
    mockAssessmentDocRef.mockClear();
    mockAssessmentRevisionDocRef.mockClear();
    mockAssessmentAnswerKeyDocRef.mockClear();
    mockAssessmentDeploymentDocRef.mockClear();
    mockAssessmentRevisionDeploymentDocRef.mockClear();
    mockAssessmentAnswerKeyDeploymentDocRef.mockClear();
    mockLogInfo.mockReset();
    mockLogWarn.mockReset();
    mockLogError.mockReset();
    txSets.length = 0;
    txDeletes.length = 0;
    fixture.assessment = undefined;
    fixture.revision = undefined;
    fixture.answerKey = undefined;
    installTransactionRunner();
  });

  it("derives canonical identifiers per §12", () => {
    expect(assessmentIdFor(ACTIVITY_ID)).toBe(ASSESSMENT_ID);
    expect(revisionIdFor(ASSESSMENT_ID, 3)).toBe(`${ASSESSMENT_ID}__r3`);
    expect(parseRevisionOrdinalFromId(REVISION_ID_2)).toBe(2);
    expect(parseRevisionOrdinalFromId("no-suffix")).toBeUndefined();
    expect(parseRevisionOrdinalFromId(`${ASSESSMENT_ID}__r0`)).toBeUndefined();
  });

  it("publishes a first revision atomically and creates the root assessment", async () => {
    const result = await deployAssessmentRevision(baseInput());

    expect(result).toEqual({
      assessmentId: ASSESSMENT_ID,
      revisionId: REVISION_ID_1,
      revisionOrdinal: 1,
      assessmentCreated: true,
    });
    expect(mockRunTransaction).toHaveBeenCalledTimes(1);
    expect(txSets).toHaveLength(3);
    expect(txDeletes).toHaveLength(0);

    const [revisionSet, answerKeySet, assessmentSet] = txSets;
    expect(revisionSet.ref).toEqual({ __kind: "revisionDeployment", id: REVISION_ID_1 });
    expect(answerKeySet.ref).toEqual({ __kind: "answerKeyDeployment", id: REVISION_ID_1 });
    expect(assessmentSet.ref).toEqual({ __kind: "assessmentDeployment", id: ASSESSMENT_ID });

    expect(revisionSet.data).toEqual({
      assessmentId: ASSESSMENT_ID,
      revisionOrdinal: 1,
      activityId: ACTIVITY_ID,
      itemOrderingRule: "authoredOrder",
      items: [
        {
          itemId: "q1",
          itemType: "singleChoice",
          stem: "What is the innermost layer?",
          options: [
            { optionId: "A", text: "Crust" },
            { optionId: "B", text: "Mantle" },
            { optionId: "C", text: "Inner core" },
          ],
          points: 1,
        },
        {
          itemId: "q2",
          itemType: "singleChoice",
          stem: "Which layer flows plastically?",
          options: [
            { optionId: "A", text: "Crust" },
            { optionId: "B", text: "Mantle" },
          ],
          points: 1,
        },
      ],
      publishedAt: SERVER_TIMESTAMP_SENTINEL,
      publishedBy: "deployment",
      schemaVersion: 1,
    });

    expect(answerKeySet.data).toEqual({
      assessmentId: ASSESSMENT_ID,
      revisionOrdinal: 1,
      items: [
        { itemId: "q1", correctOptionId: "C", points: 1, explanation: "The inner core is the innermost layer." },
        { itemId: "q2", correctOptionId: "B", points: 1, explanation: "The mantle flows plastically." },
      ],
      publishedAt: SERVER_TIMESTAMP_SENTINEL,
      publishedBy: "deployment",
      schemaVersion: 1,
    });

    expect(assessmentSet.data).toEqual({
      assessmentId: ASSESSMENT_ID,
      activityId: ACTIVITY_ID,
      currentRevisionId: REVISION_ID_1,
    });
  });

  it("advances currentRevisionId on subsequent publications", async () => {
    fixture.assessment = {
      assessmentId: ASSESSMENT_ID,
      activityId: ACTIVITY_ID,
      currentRevisionId: REVISION_ID_1,
    };
    const result = await deployAssessmentRevision(
      baseInput({ revisionOrdinal: 2 }),
    );
    expect(result.revisionId).toBe(REVISION_ID_2);
    expect(result.assessmentCreated).toBe(false);
    const assessmentSet = txSets[2];
    expect(assessmentSet.data).toEqual({
      assessmentId: ASSESSMENT_ID,
      activityId: ACTIVITY_ID,
      currentRevisionId: REVISION_ID_2,
    });
  });

  it("refuses a duplicate revision publication", async () => {
    fixture.assessment = {
      assessmentId: ASSESSMENT_ID,
      activityId: ACTIVITY_ID,
      currentRevisionId: REVISION_ID_1,
    };
    fixture.revision = { assessmentId: ASSESSMENT_ID, revisionOrdinal: 1 };
    await expect(deployAssessmentRevision(baseInput())).rejects.toMatchObject({
      code: "assessmentDeployment.duplicateRevision",
    });
    expect(txSets).toHaveLength(0);
  });

  it("refuses a duplicate answer-key publication", async () => {
    fixture.answerKey = { assessmentId: ASSESSMENT_ID, revisionOrdinal: 1 };
    await expect(deployAssessmentRevision(baseInput())).rejects.toMatchObject({
      code: "assessmentDeployment.duplicateAnswerKey",
    });
    expect(txSets).toHaveLength(0);
  });

  it("refuses a non-monotonic revisionOrdinal", async () => {
    fixture.assessment = {
      assessmentId: ASSESSMENT_ID,
      activityId: ACTIVITY_ID,
      currentRevisionId: REVISION_ID_2,
    };
    await expect(
      deployAssessmentRevision(baseInput({ revisionOrdinal: 2 })),
    ).rejects.toMatchObject({
      code: "assessmentDeployment.nonMonotonicRevisionOrdinal",
    });
    expect(txSets).toHaveLength(0);
  });

  it("refuses when the assessment activityId disagrees with the input", async () => {
    fixture.assessment = {
      assessmentId: ASSESSMENT_ID,
      activityId: "some-other-activity",
      currentRevisionId: REVISION_ID_1,
    };
    await expect(
      deployAssessmentRevision(baseInput({ revisionOrdinal: 2 })),
    ).rejects.toMatchObject({ code: "assessmentDeployment.activityMismatch" });
    expect(txSets).toHaveLength(0);
  });

  it("refuses when the existing currentRevisionId is unparseable", async () => {
    fixture.assessment = {
      assessmentId: ASSESSMENT_ID,
      activityId: ACTIVITY_ID,
      currentRevisionId: "not-canonical",
    };
    await expect(
      deployAssessmentRevision(baseInput({ revisionOrdinal: 2 })),
    ).rejects.toMatchObject({
      code: "assessmentDeployment.currentRevisionUnparseable",
    });
    expect(txSets).toHaveLength(0);
  });

  it("refuses when items array is empty", async () => {
    await expect(
      deployAssessmentRevision(baseInput({ items: [] })),
    ).rejects.toMatchObject({ code: "assessmentDeployment.invalidItems" });
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });

  it("refuses duplicate itemIds within a revision", async () => {
    const dup = baseInput();
    const items = [...dup.items];
    items[1] = { ...items[1], itemId: items[0].itemId };
    await expect(
      deployAssessmentRevision({ ...dup, items }),
    ).rejects.toMatchObject({ code: "assessmentDeployment.duplicateItemId" });
  });

  it("refuses duplicate optionIds within an item", async () => {
    const dup = baseInput();
    const items = dup.items.map((item, i) =>
      i === 0
        ? {
            ...item,
            options: [
              { optionId: "A", text: "A" },
              { optionId: "A", text: "A dup" },
            ],
            correctOptionId: "A",
          }
        : item,
    );
    await expect(
      deployAssessmentRevision({ ...dup, items }),
    ).rejects.toMatchObject({ code: "assessmentDeployment.duplicateOptionId" });
  });

  it("refuses when fewer than two options are supplied", async () => {
    const items = baseInput().items.map((item, i) =>
      i === 0
        ? {
            ...item,
            options: [{ optionId: "A", text: "Only" }],
            correctOptionId: "A",
          }
        : item,
    );
    await expect(
      deployAssessmentRevision(baseInput({ items })),
    ).rejects.toMatchObject({ code: "assessmentDeployment.invalidOptions" });
  });

  it("refuses when correctOptionId is not among the item's options", async () => {
    const items = baseInput().items.map((item, i) =>
      i === 0 ? { ...item, correctOptionId: "Z" } : item,
    );
    await expect(
      deployAssessmentRevision(baseInput({ items })),
    ).rejects.toMatchObject({
      code: "assessmentDeployment.correctOptionIdNotInOptions",
    });
  });

  it("refuses an unsupported itemType", async () => {
    const items = baseInput().items.map((item, i) =>
      i === 0 ? { ...item, itemType: "multiSelect" as never } : item,
    );
    await expect(
      deployAssessmentRevision(baseInput({ items })),
    ).rejects.toMatchObject({
      code: "assessmentDeployment.unsupportedItemType",
    });
  });

  it("refuses a non-v1 schemaVersion", async () => {
    await expect(
      deployAssessmentRevision(baseInput({ schemaVersion: 2 as never })),
    ).rejects.toMatchObject({
      code: "assessmentDeployment.invalidSchemaVersion",
    });
  });

  it("refuses a non-authoredOrder itemOrderingRule", async () => {
    await expect(
      deployAssessmentRevision(
        baseInput({ itemOrderingRule: "randomized" as never }),
      ),
    ).rejects.toMatchObject({
      code: "assessmentDeployment.invalidOrderingRule",
    });
  });

  it("refuses a revisionOrdinal less than 1", async () => {
    await expect(
      deployAssessmentRevision(baseInput({ revisionOrdinal: 0 })),
    ).rejects.toMatchObject({
      code: "assessmentDeployment.invalidRevisionOrdinal",
    });
  });

  it("refuses non-integer revisionOrdinal", async () => {
    await expect(
      deployAssessmentRevision(baseInput({ revisionOrdinal: 1.5 })),
    ).rejects.toMatchObject({
      code: "assessmentDeployment.invalidRevisionOrdinal",
    });
  });

  it("refuses an empty publishedBy", async () => {
    await expect(
      deployAssessmentRevision(baseInput({ publishedBy: "  " })),
    ).rejects.toMatchObject({
      code: "assessmentDeployment.invalidPublishedBy",
    });
  });

  it("refuses a non-URL-safe activityId", async () => {
    await expect(
      deployAssessmentRevision(baseInput({ activityId: "bad id!" })),
    ).rejects.toMatchObject({
      code: "assessmentDeployment.invalidActivityId",
    });
  });

  it("refuses a non-object input", async () => {
    await expect(
      deployAssessmentRevision(null),
    ).rejects.toMatchObject({ code: "assessmentDeployment.invalidInput" });
    await expect(
      deployAssessmentRevision([]),
    ).rejects.toMatchObject({ code: "assessmentDeployment.invalidInput" });
    await expect(
      deployAssessmentRevision("string"),
    ).rejects.toMatchObject({ code: "assessmentDeployment.invalidInput" });
  });

  it("refuses a non-unit points value", async () => {
    const items = baseInput().items.map((item, i) =>
      i === 0 ? { ...item, points: 2 as never } : item,
    );
    await expect(
      deployAssessmentRevision(baseInput({ items })),
    ).rejects.toMatchObject({ code: "assessmentDeployment.invalidPoints" });
  });

  it("does not emit any audit event for a successful publication", async () => {
    // Deployment audit vocabulary is not certified in
    // ASSESSMENT_IMPLEMENTATION_CONTRACT.md §24; per the sprint's rule
    // (implement only certified deployment audit events; do not invent new
    // vocabulary) no audit event is emitted here. This test locks that
    // invariant so a future edit does not smuggle a new audit-action into
    // the vocabulary through the deployment path.
    await deployAssessmentRevision(baseInput());
    expect(mockLogInfo).toHaveBeenCalledWith(
      "assessmentDeployment.published",
      expect.objectContaining({ assessmentId: ASSESSMENT_ID }),
    );
  });

  it("performs no partial write when validation throws inside the transaction", async () => {
    fixture.revision = { assessmentId: ASSESSMENT_ID, revisionOrdinal: 1 };
    let raised: PlatformError | undefined;
    try {
      await deployAssessmentRevision(baseInput());
    } catch (err) {
      raised = err as PlatformError;
    }
    expect(raised).toBeInstanceOf(PlatformError);
    expect(raised?.code).toBe("assessmentDeployment.duplicateRevision");
    expect(txSets).toHaveLength(0);
    expect(txDeletes).toHaveLength(0);
  });

  it("keeps all three writes inside the same transaction", async () => {
    let observedTxSize = 0;
    mockRunTransaction.mockImplementationOnce(
      (fn: (tx: unknown) => unknown) => {
        const localTx = {
          get: (ref: { __kind: string }) => {
            if (ref.__kind === "assessment") return makeSnap(false);
            if (ref.__kind === "revision") return makeSnap(false);
            if (ref.__kind === "answerKey") return makeSnap(false);
            throw new Error("unexpected");
          },
          set: (ref: unknown, data: unknown) => {
            observedTxSize += 1;
            txSets.push({ ref, data });
          },
          create: (ref: unknown, data: unknown) => {
            observedTxSize += 1;
            txSets.push({ ref, data });
          },
          delete: (ref: unknown) => {
            txDeletes.push(ref);
          },
        };
        return fn(localTx);
      },
    );
    await deployAssessmentRevision(baseInput());
    expect(observedTxSize).toBe(3);
  });

  // Sprint 11D I-2. The revision + answer-key writes now use tx.create()
  // so a concurrent second commit whose transactional read observed the
  // revision as absent cannot silently overwrite the already-committed
  // immutable revision. The write layer refuses the second commit with
  // ALREADY_EXISTS. This test asserts the write-boundary "must not
  // exist" precondition is invoked on the two immutable refs.
  it("I-2: uses tx.create for the immutable revision and answer-key writes", async () => {
    const created: Array<unknown> = [];
    mockRunTransaction.mockImplementationOnce(
      (fn: (tx: unknown) => unknown) => {
        const localTx = {
          get: (ref: { __kind: string }) => {
            if (ref.__kind === "assessment") return makeSnap(false);
            if (ref.__kind === "revision") return makeSnap(false);
            if (ref.__kind === "answerKey") return makeSnap(false);
            throw new Error("unexpected");
          },
          set: (ref: unknown) => {
            // parent assessment doc may be created or updated by set().
            void ref;
          },
          create: (ref: unknown) => {
            created.push(ref);
          },
          delete: () => {},
        };
        return fn(localTx);
      },
    );
    await deployAssessmentRevision(baseInput());
    // Both the revision and answer-key immutable writes went through
    // tx.create(); parent assessment went through tx.set().
    expect(created).toHaveLength(2);
  });
});
