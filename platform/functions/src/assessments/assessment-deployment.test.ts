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

const mockCompletionDefinitionDocRef = jest.fn((id: string) => ({
  __kind: "completionDefinition",
  id,
}));
const mockCompletionDefinitionCreationDocRef = jest.fn((id: string) => ({
  __kind: "completionDefinitionCreation",
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
    runFirestoreTransaction: (
      fn: (tx: unknown) => Promise<unknown>,
      firestore: unknown,
    ) => mockRunTransaction(fn, firestore),
    assessmentDocRef: mockAssessmentDocRef,
    assessmentRevisionDocRef: mockAssessmentRevisionDocRef,
    assessmentAnswerKeyDocRef: mockAssessmentAnswerKeyDocRef,
    assessmentDeploymentDocRef: mockAssessmentDeploymentDocRef,
    assessmentRevisionDeploymentDocRef: mockAssessmentRevisionDeploymentDocRef,
    assessmentAnswerKeyDeploymentDocRef: mockAssessmentAnswerKeyDeploymentDocRef,
    completionDefinitionDocRef: mockCompletionDefinitionDocRef,
    completionDefinitionCreationDocRef: mockCompletionDefinitionCreationDocRef,
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

import { PlatformError } from "../shared/errors/platform-error";
import type { Firestore } from "firebase-admin/firestore";
import {
  GRAVITY_WELLS_COMPLETION_DEFINITION,
  computeCompletionDefinitionHash,
  verifyCompletionDefinitionRecord,
  type CompletionDefinition,
} from "../resourceCompletion";
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
  completionDefinition?: unknown;
};

const fixture: Fixture = {};
const txSets: Array<{ ref: unknown; data: unknown; options?: unknown }> = [];
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
        if (ref.__kind === "completionDefinition") {
          return makeSnap(
            fixture.completionDefinition !== undefined,
            () => fixture.completionDefinition,
          );
        }
        throw new Error(`Unexpected ref: ${JSON.stringify(ref)}`);
      },
      set: (ref: unknown, data: unknown, options?: unknown) => {
        txSets.push({ ref, data, options });
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
    fixture.completionDefinition = undefined;
    mockCompletionDefinitionDocRef.mockClear();
    mockCompletionDefinitionCreationDocRef.mockClear();
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
          set: (ref: unknown, data: unknown, options?: unknown) => {
            observedTxSize += 1;
            txSets.push({ ref, data, options });
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

  it("threads an explicitly supplied Firestore instance through every transaction reference", async () => {
    const firestore = { exact: "staging-firestore" } as unknown as Firestore;
    await deployAssessmentRevision(baseInput(), firestore);

    expect(mockRunTransaction.mock.calls[0][1]).toBe(firestore);
    expect(mockAssessmentDocRef).toHaveBeenCalledWith(ASSESSMENT_ID, firestore);
    expect(mockAssessmentRevisionDocRef).toHaveBeenCalledWith(
      REVISION_ID_1,
      firestore,
    );
    expect(mockAssessmentAnswerKeyDocRef).toHaveBeenCalledWith(
      REVISION_ID_1,
      firestore,
    );
    expect(mockAssessmentDeploymentDocRef).toHaveBeenCalledWith(
      ASSESSMENT_ID,
      firestore,
    );
    expect(mockAssessmentRevisionDeploymentDocRef).toHaveBeenCalledWith(
      REVISION_ID_1,
      firestore,
    );
    expect(mockAssessmentAnswerKeyDeploymentDocRef).toHaveBeenCalledWith(
      REVISION_ID_1,
      firestore,
    );
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

  // Sprint 11E I-2. On republication the parent
  // `assessments/{assessmentId}` document must NOT lose fields the
  // deployment writer does not own. The pre-Sprint-11E full-document
  // `set(...)` would silently erase such fields; the merged set narrows
  // the write to the three deployment-owned fields
  // (`assessmentId`, `activityId`, `currentRevisionId`) so any future
  // non-deployment metadata on the parent document is preserved. This
  // test asserts the merged set option is present on the parent write
  // and the deployment payload carries only the three deployment-owned
  // fields.
  it("I-2 (Sprint 11E): republication merges the parent assessment write rather than overwriting future fields", async () => {
    fixture.assessment = {
      assessmentId: ASSESSMENT_ID,
      activityId: ACTIVITY_ID,
      currentRevisionId: REVISION_ID_1,
    };
    await deployAssessmentRevision(baseInput({ revisionOrdinal: 2 }));

    const parentWrite = txSets[2];
    expect(parentWrite.ref).toEqual({
      __kind: "assessmentDeployment",
      id: ASSESSMENT_ID,
    });
    expect(parentWrite.options).toEqual({ merge: true });
    // Deployment writer owns exactly these three fields; nothing else
    // is projected onto the parent document by this path.
    expect(parentWrite.data).toEqual({
      assessmentId: ASSESSMENT_ID,
      activityId: ACTIVITY_ID,
      currentRevisionId: REVISION_ID_2,
    });
    expect(Object.keys(parentWrite.data as Record<string, unknown>)).toEqual([
      "assessmentId",
      "activityId",
      "currentRevisionId",
    ]);
  });

  // RA-3B: non-lesson revisions freeze a completion definition in the same
  // transaction; lessons are unchanged.
  describe("non-lesson completion definitions (RA-3B)", () => {
    const GW = "simulation-gravity-wells";
    const GW_R1 = `assessment_${GW}__r1`;

    function fiveItems() {
      return [1, 2, 3, 4, 5].map((n) => ({
        itemId: `q${String(n)}`,
        itemType: "singleChoice" as const,
        stem: `Question ${String(n)}?`,
        options: [
          { optionId: "A", text: "One" },
          { optionId: "B", text: "Two" },
        ],
        points: 1 as const,
        correctOptionId: "A",
        explanation: "Because.",
      }));
    }

    function gwInput(overrides: Record<string, unknown> = {}): AssessmentDeploymentInput {
      return {
        ...baseInput(),
        activityId: GW,
        items: fiveItems(),
        completionDefinition: GRAVITY_WELLS_COMPLETION_DEFINITION,
        ...overrides,
      };
    }

    function definitionWrite() {
      return txSets.find(
        (w) => (w.ref as { __kind: string }).__kind === "completionDefinitionCreation",
      );
    }

    it("creates the revision, answer key, and completion definition in one transaction", async () => {
      const result = await deployAssessmentRevision(gwInput());

      expect(mockRunTransaction).toHaveBeenCalledTimes(1);
      expect(mockCompletionDefinitionDocRef).toHaveBeenCalledWith(GW_R1, undefined);
      expect(txSets.map((w) => (w.ref as { __kind: string }).__kind).sort()).toEqual([
        "answerKeyDeployment",
        "assessmentDeployment",
        "completionDefinitionCreation",
        "revisionDeployment",
      ]);
      const write = definitionWrite()?.data as Record<string, unknown>;
      expect(write).toMatchObject({
        recordSchemaVersion: 1,
        assessmentId: `assessment_${GW}`,
        assessmentRevisionId: GW_R1,
        revisionOrdinal: 1,
        resourceId: GW,
        resourceType: "simulation",
        definitionSchemaVersion: 1,
        definitionVersion: 1,
        validators: [{ validatorId: "gravity-wells.orbit", validatorVersion: 1 }],
        publishedBy: "deployment",
        publishedAt: SERVER_TIMESTAMP_SENTINEL,
      });
      expect(write.definitionHash).toBe(computeCompletionDefinitionHash(write.definitionJson as string));
      expect(result).toEqual({
        assessmentId: `assessment_${GW}`,
        revisionId: GW_R1,
        revisionOrdinal: 1,
        assessmentCreated: true,
        completionDefinitionHash: write.definitionHash,
      });
      // The written record verifies on read, once the server has resolved
      // the timestamp sentinel into a stored timestamp.
      const stored = { ...write, publishedAt: { seconds: 1, nanoseconds: 0 } };
      const verified = verifyCompletionDefinitionRecord(GW_R1, stored, { resourceId: GW, resourceType: "simulation" });
      expect(verified.ok).toBe(true);
    });

    it("hashes the canonical definition, independent of authored key order", async () => {
      await deployAssessmentRevision(gwInput());
      const first = (definitionWrite()?.data as { definitionHash: string }).definitionHash;
      txSets.length = 0;
      const reordered = Object.fromEntries(
        Object.entries(GRAVITY_WELLS_COMPLETION_DEFINITION).reverse(),
      );
      await deployAssessmentRevision(gwInput({ completionDefinition: reordered }));
      expect((definitionWrite()?.data as { definitionHash: string }).definitionHash).toBe(first);
    });

    it("refuses a duplicate completion definition and writes nothing", async () => {
      fixture.completionDefinition = { any: "existing" };
      await expect(deployAssessmentRevision(gwInput())).rejects.toMatchObject({
        code: "assessmentDeployment.duplicateCompletionDefinition",
      });
      expect(txSets).toHaveLength(0);
    });

    it("requires a completion definition for a non-lesson resource", async () => {
      await expect(
        deployAssessmentRevision(gwInput({ completionDefinition: undefined })),
      ).rejects.toMatchObject({ code: "assessmentDeployment.missingCompletionDefinition" });
      expect(mockRunTransaction).not.toHaveBeenCalled();
    });

    it.each([4, 6, 10])("requires exactly five items for a non-lesson resource (%i refused)", async (count) => {
      const items = Array.from({ length: count }, (_, i) => ({ ...fiveItems()[0], itemId: `q${String(i + 1)}` }));
      await expect(deployAssessmentRevision(gwInput({ items }))).rejects.toMatchObject({
        code: "assessmentDeployment.invalidItemCount",
      });
      expect(mockRunTransaction).not.toHaveBeenCalled();
    });

    it("keeps lesson deployments unchanged: no item-count rule, no definition read or write", async () => {
      await deployAssessmentRevision(baseInput());
      expect(mockCompletionDefinitionDocRef).not.toHaveBeenCalled();
      expect(definitionWrite()).toBeUndefined();
    });

    it("refuses a completion definition on a lesson", async () => {
      await expect(
        deployAssessmentRevision(baseInput({ completionDefinition: GRAVITY_WELLS_COMPLETION_DEFINITION })),
      ).rejects.toMatchObject({ code: "assessmentDeployment.unexpectedCompletionDefinition" });
    });

    it("refuses a non-canonical resource identifier", async () => {
      await expect(
        deployAssessmentRevision(gwInput({ activityId: "simulation-Gravity_Wells" })),
      ).rejects.toMatchObject({ code: "assessmentDeployment.invalidActivityId" });
    });

    const gwWith = (patch: Partial<CompletionDefinition>) => ({ ...GRAVITY_WELLS_COMPLETION_DEFINITION, ...patch });
    it.each([
      ["an unregistered validator version", gwWith({ outcomes: GRAVITY_WELLS_COMPLETION_DEFINITION.outcomes.map((o) => ({ ...o, validatorVersion: 2 })) }), "unregisteredValidator"],
      ["an unsupported schema version", { ...GRAVITY_WELLS_COMPLETION_DEFINITION, schemaVersion: 2 }, "unsupportedDefinitionSchema"],
      ["a definition for another revision", gwWith({ assessmentRevisionId: `assessment_${GW}__r2` }), "revisionMismatch"],
      ["a definition version that is not the revision ordinal", gwWith({ definitionVersion: 2 }), "versionMismatch"],
      ["a definition for another resource", gwWith({ resourceId: "simulation-eclipse-alignment", assessmentRevisionId: "assessment_simulation-eclipse-alignment__r1" }), "resourceMismatch"],
      ["a structurally invalid definition", gwWith({ stages: [] }), "invalidDefinition"],
      ["a non-NFC prompt", gwWith({ evidence: [{ ...GRAVITY_WELLS_COMPLETION_DEFINITION.evidence[0], prompt: "Cafe\u0301 orbit" }] }), "invalidDefinition"],
    ])("refuses %s before any transaction", async (_label, definition, issue) => {
      await expect(deployAssessmentRevision(gwInput({ completionDefinition: definition }))).rejects.toMatchObject({
        code: "assessmentDeployment.invalidCompletionDefinition",
        details: expect.objectContaining({ issue }),
      });
      expect(mockRunTransaction).not.toHaveBeenCalled();
    });

    it("performs no partial write when the transaction fails after the definition is enqueued", async () => {
      mockRunTransaction.mockImplementationOnce(async (fn: (tx: unknown) => unknown) => {
        const staged: unknown[] = [];
        const tx = {
          get: () => makeSnap(false),
          set: (ref: unknown) => staged.push(ref),
          create: (ref: unknown) => staged.push(ref),
          delete: () => {},
        };
        await fn(tx);
        expect(staged).toHaveLength(4);
        throw new Error("commit failed"); // nothing staged is applied
      });
      await expect(deployAssessmentRevision(gwInput())).rejects.toThrow("commit failed");
      expect(txSets).toHaveLength(0);
    });
  });
});
