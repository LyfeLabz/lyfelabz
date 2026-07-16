import { FieldValue } from "firebase-admin/firestore";

import {
  PlatformError,
  assessmentAnswerKeyDeploymentDocRef,
  assessmentAnswerKeyDocRef,
  assessmentDeploymentDocRef,
  assessmentDocRef,
  assessmentRevisionDeploymentDocRef,
  assessmentRevisionDocRef,
  log,
  runFirestoreTransaction,
  ASSESSMENT_SCHEMA_VERSION_V1,
  type AssessmentAnswerKeyDeploymentWrite,
  type AssessmentAnswerKeyItem,
  type AssessmentDeploymentWrite,
  type AssessmentItemOrderingRule,
  type AssessmentItemType,
  type AssessmentRevisionDeploymentWrite,
  type AssessmentRevisionItem,
  type AssessmentRevisionItemOption,
  type AssessmentSchemaVersion,
} from "../shared";

// Canonical deployment input for a single assessment revision publication
// per ASSESSMENT_SCORING_CONTRACT.md §13 and
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §11, §12. The deployment pipeline
// authors the merged item shape (stem, options, correctOptionId,
// explanation, points) and the deployment entry point splits it into the
// paired `assessmentRevisions/{revisionId}` (scorable content, no
// correct-answer material) and `assessmentAnswerKeys/{revisionId}`
// (correct-answer material) documents before writing.
//
// The input is a plain data shape; every FieldValue-safe timestamp on the
// stored documents is stamped by the deployment transaction at the write
// boundary. `activityId` combines with the canonical
// `assessment_{activityId}` prefix (§12) to produce `assessmentId` and the
// deterministic `revisionId` composite `{assessmentId}__r{revisionOrdinal}`.
export type AssessmentDeploymentItemInput = {
  readonly itemId: string;
  readonly itemType: AssessmentItemType;
  readonly stem: string;
  readonly options: readonly AssessmentRevisionItemOption[];
  readonly points: 1;
  readonly correctOptionId: string;
  readonly explanation: string;
};

export type AssessmentDeploymentInput = {
  readonly activityId: string;
  readonly revisionOrdinal: number;
  readonly itemOrderingRule: AssessmentItemOrderingRule;
  readonly schemaVersion: AssessmentSchemaVersion;
  readonly publishedBy: string;
  readonly items: readonly AssessmentDeploymentItemInput[];
};

// Return payload of a successful deployment. Every identifier follows the
// deterministic construction in ASSESSMENT_IMPLEMENTATION_CONTRACT.md §12.
export type AssessmentDeploymentResult = {
  readonly assessmentId: string;
  readonly revisionId: string;
  readonly revisionOrdinal: number;
  readonly assessmentCreated: boolean;
};

const ACTIVITY_ID_PATTERN =
  /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,126}[a-zA-Z0-9])?$/;
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function assertIntegerAtLeast(
  value: unknown,
  min: number,
  field: string,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value < min
  ) {
    throw new PlatformError(
      "assessmentDeployment.invalidRevisionOrdinal",
      `${field} must be an integer >= ${String(min)}.`,
    );
  }
  return value;
}

// Deterministic canonical identifiers per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §12.
export function assessmentIdFor(activityId: string): string {
  return `assessment_${activityId}`;
}

export function revisionIdFor(
  assessmentId: string,
  revisionOrdinal: number,
): string {
  return `${assessmentId}__r${revisionOrdinal}`;
}

// Parses the `{assessmentId}__r{ordinal}` suffix into a numeric ordinal.
// Returns `undefined` if the identifier does not match the canonical
// construction so the deployment path can refuse advancement against an
// unparseable currentRevisionId rather than silently accepting a
// non-monotonic replacement.
export function parseRevisionOrdinalFromId(
  revisionId: string,
): number | undefined {
  const match = /__r(\d+)$/.exec(revisionId);
  if (!match) return undefined;
  const ordinal = Number(match[1]);
  if (!Number.isFinite(ordinal) || !Number.isInteger(ordinal) || ordinal < 1) {
    return undefined;
  }
  return ordinal;
}

// Structural validation per ASSESSMENT_SCORING_CONTRACT.md §4.3 (revision
// invariants), §5.3 (pairing invariants), §13.2 (pipeline-side validation).
// Every failure surfaces a distinguishable error identifier so the
// deployment pipeline can log the exact violation without leaking any
// correct-answer material into the error payload.
function validateDeploymentInput(input: unknown): AssessmentDeploymentInput {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new PlatformError(
      "assessmentDeployment.invalidInput",
      "Deployment input must be a structured object.",
    );
  }
  const raw = input as Record<string, unknown>;

  if (!isNonEmptyString(raw.activityId)) {
    throw new PlatformError(
      "assessmentDeployment.invalidActivityId",
      "activityId must be a non-empty string.",
    );
  }
  const activityId = raw.activityId.trim();
  if (!ACTIVITY_ID_PATTERN.test(activityId)) {
    throw new PlatformError(
      "assessmentDeployment.invalidActivityId",
      "activityId must be a URL-safe token.",
    );
  }

  const revisionOrdinal = assertIntegerAtLeast(
    raw.revisionOrdinal,
    1,
    "revisionOrdinal",
  );

  if (raw.itemOrderingRule !== "authoredOrder") {
    throw new PlatformError(
      "assessmentDeployment.invalidOrderingRule",
      'itemOrderingRule must be the literal "authoredOrder" in v1.',
    );
  }

  if (raw.schemaVersion !== ASSESSMENT_SCHEMA_VERSION_V1) {
    throw new PlatformError(
      "assessmentDeployment.invalidSchemaVersion",
      "schemaVersion must be the numeric literal 1 in v1.",
    );
  }

  if (!isNonEmptyString(raw.publishedBy)) {
    throw new PlatformError(
      "assessmentDeployment.invalidPublishedBy",
      "publishedBy must be a non-empty string.",
    );
  }

  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    throw new PlatformError(
      "assessmentDeployment.invalidItems",
      "items must be a non-empty array.",
    );
  }

  const seenItemIds = new Set<string>();
  const items: AssessmentDeploymentItemInput[] = [];
  for (const entry of raw.items) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new PlatformError(
        "assessmentDeployment.invalidItem",
        "Each item must be a structured object.",
      );
    }
    const item = entry as Record<string, unknown>;
    if (!isNonEmptyString(item.itemId)) {
      throw new PlatformError(
        "assessmentDeployment.invalidItemId",
        "itemId must be a non-empty string.",
      );
    }
    if (!IDENTIFIER_PATTERN.test(item.itemId)) {
      throw new PlatformError(
        "assessmentDeployment.invalidItemId",
        "itemId must be URL-safe.",
      );
    }
    if (seenItemIds.has(item.itemId)) {
      throw new PlatformError(
        "assessmentDeployment.duplicateItemId",
        `Duplicate itemId "${item.itemId}".`,
      );
    }
    seenItemIds.add(item.itemId);

    if (item.itemType !== "singleChoice") {
      throw new PlatformError(
        "assessmentDeployment.unsupportedItemType",
        `Item "${item.itemId}" has unsupported itemType.`,
      );
    }

    if (!isNonEmptyString(item.stem)) {
      throw new PlatformError(
        "assessmentDeployment.invalidStem",
        `Item "${item.itemId}" stem must be a non-empty string.`,
      );
    }

    if (item.points !== 1) {
      throw new PlatformError(
        "assessmentDeployment.invalidPoints",
        `Item "${item.itemId}" points must be the numeric literal 1 in v1.`,
      );
    }

    if (!Array.isArray(item.options) || item.options.length < 2) {
      throw new PlatformError(
        "assessmentDeployment.invalidOptions",
        `Item "${item.itemId}" must carry at least two options.`,
      );
    }
    const seenOptionIds = new Set<string>();
    const options: AssessmentRevisionItemOption[] = [];
    for (const optEntry of item.options) {
      if (!optEntry || typeof optEntry !== "object" || Array.isArray(optEntry)) {
        throw new PlatformError(
          "assessmentDeployment.invalidOption",
          `Item "${item.itemId}" option must be a structured object.`,
        );
      }
      const opt = optEntry as Record<string, unknown>;
      if (!isNonEmptyString(opt.optionId)) {
        throw new PlatformError(
          "assessmentDeployment.invalidOptionId",
          `Item "${item.itemId}" optionId must be a non-empty string.`,
        );
      }
      if (!IDENTIFIER_PATTERN.test(opt.optionId)) {
        throw new PlatformError(
          "assessmentDeployment.invalidOptionId",
          `Item "${item.itemId}" optionId must be URL-safe.`,
        );
      }
      if (seenOptionIds.has(opt.optionId)) {
        throw new PlatformError(
          "assessmentDeployment.duplicateOptionId",
          `Item "${item.itemId}" has duplicate optionId "${opt.optionId}".`,
        );
      }
      seenOptionIds.add(opt.optionId);
      if (!isNonEmptyString(opt.text)) {
        throw new PlatformError(
          "assessmentDeployment.invalidOptionText",
          `Item "${item.itemId}" option "${opt.optionId}" text must be a non-empty string.`,
        );
      }
      options.push({ optionId: opt.optionId, text: opt.text });
    }

    if (!isNonEmptyString(item.correctOptionId)) {
      throw new PlatformError(
        "assessmentDeployment.invalidCorrectOptionId",
        `Item "${item.itemId}" correctOptionId must be a non-empty string.`,
      );
    }
    if (!seenOptionIds.has(item.correctOptionId)) {
      throw new PlatformError(
        "assessmentDeployment.correctOptionIdNotInOptions",
        `Item "${item.itemId}" correctOptionId is not among the item's options.`,
      );
    }

    if (!isNonEmptyString(item.explanation)) {
      throw new PlatformError(
        "assessmentDeployment.invalidExplanation",
        `Item "${item.itemId}" explanation must be a non-empty string.`,
      );
    }

    items.push({
      itemId: item.itemId,
      itemType: "singleChoice",
      stem: item.stem,
      options,
      points: 1,
      correctOptionId: item.correctOptionId,
      explanation: item.explanation,
    });
  }

  return {
    activityId,
    revisionOrdinal,
    itemOrderingRule: "authoredOrder",
    schemaVersion: ASSESSMENT_SCHEMA_VERSION_V1,
    publishedBy: raw.publishedBy.trim(),
    items,
  };
}

function projectRevisionItems(
  items: readonly AssessmentDeploymentItemInput[],
): readonly AssessmentRevisionItem[] {
  return items.map((item) => ({
    itemId: item.itemId,
    itemType: item.itemType,
    stem: item.stem,
    options: item.options,
    points: item.points,
  }));
}

function projectAnswerKeyItems(
  items: readonly AssessmentDeploymentItemInput[],
): readonly AssessmentAnswerKeyItem[] {
  return items.map((item) => ({
    itemId: item.itemId,
    correctOptionId: item.correctOptionId,
    points: item.points,
    explanation: item.explanation,
  }));
}

// Canonical deployment entry point per
// ASSESSMENT_SCORING_CONTRACT.md §13 and
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §11, §12, §16.
//
// Sole writer of `assessments/{assessmentId}`,
// `assessmentRevisions/{revisionId}`, and `assessmentAnswerKeys/{revisionId}`.
// The three writes occur inside a single Firestore transaction so partial
// publication is impossible per §13.1. Every field is server-validated
// before any write; a validation failure refuses the entire publication.
//
// Immutability discipline:
//   - `assessmentRevisions/{revisionId}` and `assessmentAnswerKeys/{revisionId}`
//     are refused when the deterministic identifier collides with an
//     existing document (§6, §14). No revision is ever rewritten.
//   - `assessments/{assessmentId}` is created on first publication and its
//     `currentRevisionId` is advanced on subsequent publications. The new
//     ordinal MUST be strictly greater than the ordinal encoded in the
//     current revisionId (§13.2).
//   - No callable outside this deployment path writes to any of the three
//     collections (§11).
export async function deployAssessmentRevision(
  rawInput: unknown,
): Promise<AssessmentDeploymentResult> {
  const input = validateDeploymentInput(rawInput);
  const assessmentId = assessmentIdFor(input.activityId);
  const revisionId = revisionIdFor(assessmentId, input.revisionOrdinal);

  const outcome = await runFirestoreTransaction<AssessmentDeploymentResult>(
    async (tx) => {
      const assessmentRef = assessmentDocRef(assessmentId);
      const revisionRef = assessmentRevisionDocRef(revisionId);
      const answerKeyRef = assessmentAnswerKeyDocRef(revisionId);

      const [assessmentSnap, revisionSnap, answerKeySnap] = await Promise.all([
        tx.get(assessmentRef),
        tx.get(revisionRef),
        tx.get(answerKeyRef),
      ]);

      if (revisionSnap.exists) {
        throw new PlatformError(
          "assessmentDeployment.duplicateRevision",
          `Revision "${revisionId}" already exists.`,
        );
      }
      if (answerKeySnap.exists) {
        throw new PlatformError(
          "assessmentDeployment.duplicateAnswerKey",
          `Answer key "${revisionId}" already exists.`,
        );
      }

      const assessmentCreated = !assessmentSnap.exists;
      if (assessmentSnap.exists) {
        const existing = assessmentSnap.data();
        if (!existing) {
          throw new PlatformError(
            "assessmentDeployment.assessmentEmpty",
            "Existing assessment document is empty.",
          );
        }
        if (existing.activityId !== input.activityId) {
          throw new PlatformError(
            "assessmentDeployment.activityMismatch",
            "Existing assessment activityId does not match the deployment input.",
          );
        }
        const currentOrdinal = parseRevisionOrdinalFromId(
          existing.currentRevisionId,
        );
        if (currentOrdinal === undefined) {
          throw new PlatformError(
            "assessmentDeployment.currentRevisionUnparseable",
            "Existing currentRevisionId does not match the canonical identifier construction.",
          );
        }
        if (input.revisionOrdinal <= currentOrdinal) {
          throw new PlatformError(
            "assessmentDeployment.nonMonotonicRevisionOrdinal",
            `revisionOrdinal ${String(input.revisionOrdinal)} is not strictly greater than the current ordinal ${String(currentOrdinal)}.`,
          );
        }
      }

      const revisionWrite: AssessmentRevisionDeploymentWrite = {
        assessmentId,
        revisionOrdinal: input.revisionOrdinal,
        activityId: input.activityId,
        itemOrderingRule: input.itemOrderingRule,
        items: projectRevisionItems(input.items),
        publishedAt: FieldValue.serverTimestamp(),
        publishedBy: input.publishedBy,
        schemaVersion: input.schemaVersion,
      };

      const answerKeyWrite: AssessmentAnswerKeyDeploymentWrite = {
        assessmentId,
        revisionOrdinal: input.revisionOrdinal,
        items: projectAnswerKeyItems(input.items),
        publishedAt: FieldValue.serverTimestamp(),
        publishedBy: input.publishedBy,
        schemaVersion: input.schemaVersion,
      };

      const assessmentWrite: AssessmentDeploymentWrite = {
        assessmentId,
        activityId: input.activityId,
        currentRevisionId: revisionId,
      };

      // Sprint 11D I-2. Use `create` for the two immutable revision
      // documents. The transactional read above already refuses a
      // duplicate; the `create` write adds a server-enforced
      // "must-not-exist" precondition so that even a hypothetical
      // concurrent second commit that beat the transaction's retry logic
      // could not silently overwrite an immutable revision. The parent
      // `assessments/{assessmentId}` document is legitimately created OR
      // updated (its `currentRevisionId` advances on republication) and
      // therefore remains a `set`.
      tx.create(assessmentRevisionDeploymentDocRef(revisionId), revisionWrite);
      tx.create(assessmentAnswerKeyDeploymentDocRef(revisionId), answerKeyWrite);
      tx.set(assessmentDeploymentDocRef(assessmentId), assessmentWrite);

      return {
        assessmentId,
        revisionId,
        revisionOrdinal: input.revisionOrdinal,
        assessmentCreated,
      };
    },
  );

  try {
    log.info("assessmentDeployment.published", {
      assessmentId: outcome.assessmentId,
      revisionId: outcome.revisionId,
      revisionOrdinal: outcome.revisionOrdinal,
      assessmentCreated: outcome.assessmentCreated,
      publishedBy: input.publishedBy,
    });
  } catch {
    // Logging is observability, not lifecycle.
  }

  return outcome;
}
