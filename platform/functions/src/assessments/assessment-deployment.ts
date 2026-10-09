import { FieldValue, type Firestore } from "firebase-admin/firestore";

import {
  PlatformError,
  assessmentAnswerKeyDeploymentDocRef,
  assessmentAnswerKeyDocRef,
  assessmentDeploymentDocRef,
  completionDefinitionCreationDocRef,
  completionDefinitionDocRef,
  assessmentDocRef,
  assessmentIdForLessonSlug,
  assessmentRevisionDeploymentDocRef,
  assessmentRevisionDocRef,
  log,
  parseRevisionOrdinalFromRevisionId,
  revisionIdForOrdinal,
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
  type CompletionDefinitionCreationWrite,
} from "../shared";
import { prepareCompletionDefinitionRecord } from "../resourceCompletion";
import {
  assertActivityIdMatchesResourceType,
  reservedResourceTypeForActivityId,
} from "../shared/activity-identifiers";

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

// RA-3B. `completionDefinition` is required for a non-lesson resource
// (an `activityId` carrying a reserved "<type>-" prefix) and refused for a
// lesson. It is authored data, validated with the RA-2 core and frozen in
// `completionDefinitions/{revisionId}` by the same transaction that writes
// the revision and its answer key. A non-lesson revision also carries
// exactly five items (standard D-A); lesson item rules are unchanged.
export type AssessmentDeploymentInput = {
  readonly activityId: string;
  readonly revisionOrdinal: number;
  readonly itemOrderingRule: AssessmentItemOrderingRule;
  readonly schemaVersion: AssessmentSchemaVersion;
  readonly publishedBy: string;
  readonly items: readonly AssessmentDeploymentItemInput[];
  readonly completionDefinition?: unknown;
};

// Exactly five objective, server-scored items for every non-lesson
// assessment revision (LYFELABZ_NON_LESSON_ASSESSMENT_EVIDENCE_STANDARD.md
// D-A, section 3). Not a registry-wide rule: lessons keep their own
// contract.
export const NON_LESSON_ASSESSMENT_ITEM_COUNT = 5;

// Return payload of a successful deployment. Every identifier follows the
// deterministic construction in ASSESSMENT_IMPLEMENTATION_CONTRACT.md §12.
export type AssessmentDeploymentResult = {
  readonly assessmentId: string;
  readonly revisionId: string;
  readonly revisionOrdinal: number;
  readonly assessmentCreated: boolean;
  // RA-3B. Present only for a non-lesson revision.
  readonly completionDefinitionHash?: string;
};

// Pure, timestamp-free projection of a deployment candidate. Administrative
// tooling uses this to validate and inspect the exact documents the canonical
// transaction would author without performing a Firestore write. Keeping this
// projection here prevents dry-run tooling from growing a second assessment
// schema implementation.
export type AssessmentDeploymentPlan = {
  readonly input: AssessmentDeploymentInput;
  readonly assessmentId: string;
  readonly revisionId: string;
  readonly assessmentWrite: AssessmentDeploymentWrite;
  readonly revisionWrite: Omit<AssessmentRevisionDeploymentWrite, "publishedAt">;
  readonly answerKeyWrite: Omit<AssessmentAnswerKeyDeploymentWrite, "publishedAt">;
  // RA-3B. Present exactly when the activity is a non-lesson resource.
  readonly completionDefinitionWrite?: Omit<CompletionDefinitionCreationWrite, "publishedAt">;
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
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §12. The identifier grammar is
// owned by `shared/assessment-identifiers.ts`; the deployment path uses
// `activityId` as its lesson slug parameter (they are the same string in
// v1). These re-exports keep the deployment API stable for callers that
// name `assessmentIdFor` / `revisionIdFor` explicitly.
export function assessmentIdFor(activityId: string): string {
  return assessmentIdForLessonSlug(activityId);
}

export function revisionIdFor(
  assessmentId: string,
  revisionOrdinal: number,
): string {
  return revisionIdForOrdinal(assessmentId, revisionOrdinal);
}

export function parseRevisionOrdinalFromId(
  revisionId: string,
): number | undefined {
  return parseRevisionOrdinalFromRevisionId(revisionId);
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

  // RA-3B. A reserved "<type>-" prefix makes this a non-lesson resource,
  // whose identifier must follow the resource grammar exactly.
  const resourceType = reservedResourceTypeForActivityId(activityId);
  if (resourceType !== undefined) {
    try {
      assertActivityIdMatchesResourceType(activityId, resourceType);
    } catch {
      throw new PlatformError(
        "assessmentDeployment.invalidActivityId",
        `activityId must be a canonical ${resourceType} identifier.`,
      );
    }
    if (raw.completionDefinition === undefined) {
      throw new PlatformError(
        "assessmentDeployment.missingCompletionDefinition",
        "A non-lesson assessment revision requires a completion definition.",
      );
    }
  } else if (raw.completionDefinition !== undefined) {
    throw new PlatformError(
      "assessmentDeployment.unexpectedCompletionDefinition",
      "A lesson assessment revision does not carry a completion definition.",
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

  if (resourceType !== undefined && items.length !== NON_LESSON_ASSESSMENT_ITEM_COUNT) {
    throw new PlatformError(
      "assessmentDeployment.invalidItemCount",
      `A non-lesson assessment revision must carry exactly ${String(NON_LESSON_ASSESSMENT_ITEM_COUNT)} items.`,
    );
  }

  return {
    activityId,
    revisionOrdinal,
    itemOrderingRule: "authoredOrder",
    schemaVersion: ASSESSMENT_SCHEMA_VERSION_V1,
    publishedBy: raw.publishedBy.trim(),
    items,
    ...(resourceType !== undefined ? { completionDefinition: raw.completionDefinition } : {}),
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

export function planAssessmentRevision(
  rawInput: unknown,
): AssessmentDeploymentPlan {
  const input = validateDeploymentInput(rawInput);
  const assessmentId = assessmentIdFor(input.activityId);
  const revisionId = revisionIdFor(assessmentId, input.revisionOrdinal);

  // RA-3B. Validate the completion definition against the exact revision it
  // will be frozen with (RA-2 core, registered validators, resource and
  // revision identity, definitionVersion == revisionOrdinal) and project the
  // immutable record with its content hash.
  let completionDefinitionWrite: AssessmentDeploymentPlan["completionDefinitionWrite"];
  const resourceType = reservedResourceTypeForActivityId(input.activityId);
  if (resourceType !== undefined) {
    const prepared = prepareCompletionDefinitionRecord(input.completionDefinition, {
      resourceId: input.activityId,
      resourceType,
      assessmentRevisionId: revisionId,
      publishedBy: input.publishedBy,
    });
    if (!prepared.ok) {
      throw new PlatformError(
        "assessmentDeployment.invalidCompletionDefinition",
        `Completion definition refused: ${prepared.issue}.`,
        undefined,
        { issue: prepared.issue, issues: [...prepared.details] },
      );
    }
    completionDefinitionWrite = prepared.write;
  }

  return {
    input,
    assessmentId,
    revisionId,
    assessmentWrite: {
      assessmentId,
      activityId: input.activityId,
      currentRevisionId: revisionId,
    },
    revisionWrite: {
      assessmentId,
      revisionOrdinal: input.revisionOrdinal,
      activityId: input.activityId,
      itemOrderingRule: input.itemOrderingRule,
      items: projectRevisionItems(input.items),
      publishedBy: input.publishedBy,
      schemaVersion: input.schemaVersion,
    },
    answerKeyWrite: {
      assessmentId,
      revisionOrdinal: input.revisionOrdinal,
      items: projectAnswerKeyItems(input.items),
      publishedBy: input.publishedBy,
      schemaVersion: input.schemaVersion,
    },
    ...(completionDefinitionWrite !== undefined ? { completionDefinitionWrite } : {}),
  };
}

// Canonical deployment entry point per
// ASSESSMENT_SCORING_CONTRACT.md §13 and
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §11, §12, §16.
//
// Sole writer of `assessments/{assessmentId}`,
// `assessmentRevisions/{revisionId}`, `assessmentAnswerKeys/{revisionId}`,
// and (RA-3B, non-lesson resources only) `completionDefinitions/{revisionId}`.
// Every write occurs inside a single Firestore transaction so partial
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
  firestore?: Firestore,
): Promise<AssessmentDeploymentResult> {
  const plan = planAssessmentRevision(rawInput);
  const { input, assessmentId, revisionId } = plan;

  const outcome = await runFirestoreTransaction<AssessmentDeploymentResult>(
    async (tx) => {
      const assessmentRef = assessmentDocRef(assessmentId, firestore);
      const revisionRef = assessmentRevisionDocRef(revisionId, firestore);
      const answerKeyRef = assessmentAnswerKeyDocRef(revisionId, firestore);

      const [assessmentSnap, revisionSnap, answerKeySnap] = await Promise.all([
        tx.get(assessmentRef),
        tx.get(revisionRef),
        tx.get(answerKeyRef),
      ]);
      // RA-3B. A non-lesson revision also reads its completion-definition
      // slot; every read precedes every write in this transaction.
      const completionDefinitionSnap = plan.completionDefinitionWrite
        ? await tx.get(completionDefinitionDocRef(revisionId, firestore))
        : undefined;

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
      if (completionDefinitionSnap?.exists) {
        throw new PlatformError(
          "assessmentDeployment.duplicateCompletionDefinition",
          `Completion definition "${revisionId}" already exists.`,
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
        ...plan.revisionWrite,
        publishedAt: FieldValue.serverTimestamp(),
      };

      const answerKeyWrite: AssessmentAnswerKeyDeploymentWrite = {
        ...plan.answerKeyWrite,
        publishedAt: FieldValue.serverTimestamp(),
      };

      const assessmentWrite = plan.assessmentWrite;

      // Sprint 11D I-2. Use `create` for the two immutable revision
      // documents. The transactional read above already refuses a
      // duplicate; the `create` write adds a server-enforced
      // "must-not-exist" precondition so that even a hypothetical
      // concurrent second commit that beat the transaction's retry logic
      // could not silently overwrite an immutable revision.
      //
      // Sprint 11E I-2. The parent `assessments/{assessmentId}` document
      // is legitimately created OR updated (its `currentRevisionId`
      // advances on republication). The pre-Sprint-11E write was a
      // full-document `set(...)` that would silently erase any non-
      // deployment field a future revision may add to the parent
      // assessment document. The deployment path owns only the three
      // fields projected onto `AssessmentDeploymentWrite`
      // (`assessmentId`, `activityId`, `currentRevisionId`); every other
      // field is out-of-scope for this writer. Switching to a merged
      // set narrows the write to those three fields so a republication
      // preserves any future metadata the parent doc carries. The
      // deterministic assessmentId keeps the create-on-first-publication
      // semantics intact (merge creates the document if it is absent).
      tx.create(
        assessmentRevisionDeploymentDocRef(revisionId, firestore),
        revisionWrite,
      );
      tx.create(
        assessmentAnswerKeyDeploymentDocRef(revisionId, firestore),
        answerKeyWrite,
      );
      // RA-3B. The frozen completion definition is created in the same
      // transaction as the revision and answer key, with the same
      // must-not-exist `create` precondition. It is never updated.
      if (plan.completionDefinitionWrite) {
        const completionDefinitionWrite: CompletionDefinitionCreationWrite = {
          ...plan.completionDefinitionWrite,
          publishedAt: FieldValue.serverTimestamp(),
        };
        tx.create(
          completionDefinitionCreationDocRef(revisionId, firestore),
          completionDefinitionWrite,
        );
      }
      tx.set(assessmentDeploymentDocRef(assessmentId, firestore), assessmentWrite, {
        merge: true,
      });

      return {
        assessmentId,
        revisionId,
        revisionOrdinal: input.revisionOrdinal,
        assessmentCreated,
        ...(plan.completionDefinitionWrite
          ? { completionDefinitionHash: plan.completionDefinitionWrite.definitionHash }
          : {}),
      };
    },
    firestore,
  );

  try {
    log.info("assessmentDeployment.published", {
      assessmentId: outcome.assessmentId,
      revisionId: outcome.revisionId,
      revisionOrdinal: outcome.revisionOrdinal,
      assessmentCreated: outcome.assessmentCreated,
      publishedBy: input.publishedBy,
      ...(outcome.completionDefinitionHash
        ? { completionDefinitionHash: outcome.completionDefinitionHash }
        : {}),
    });
  } catch {
    // Logging is observability, not lifecycle.
  }

  return outcome;
}
