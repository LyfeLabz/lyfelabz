import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { onCall, type CallableRequest } from "firebase-functions/v2/https";

import {
  PlatformError,
  assessmentAnswerKeyDocRef,
  assessmentRevisionDocRef,
  assessmentSessionDocRef,
  attemptCreationDocRef,
  attemptDocRef,
  attemptsCollectionRef,
  log,
  requireDistrictContext,
  runFirestoreTransaction,
  writeAuditEvent,
  ASSESSMENT_SCHEMA_VERSION_V1,
  type AssessmentAnswerKeyRecord,
  type AssessmentAttemptCreationWrite,
  type AssessmentAttemptItemResult,
  type AssessmentAttemptRecord,
  type AssessmentRevisionRecord,
  type AssessmentSessionRecord,
  type AssessmentSessionResponse,
} from "../shared";

// Client-supplied request payload for assessmentAttemptsFinalize per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §8, §21 and
// ASSESSMENT_SCORING_CONTRACT.md §16. The authenticated student supplies
// only the target `sessionId` and a stable `idempotencyKey` per §8
// idempotency semantics. Every scoring artifact (score, per-item
// correctness, points earned, correct-answer value, explanation) is
// server-owned; a client that attempts to supply any of those on the
// request is refused with `assessmentAttempts.invalidRequest`. Responses
// are read from the session document that autosave persisted, never from
// the request payload.
export type AssessmentAttemptsFinalizeRequest = {
  readonly sessionId: string;
  readonly idempotencyKey: string;
};

// Return payload of a successful finalize call per
// ASSESSMENT_SCORING_CONTRACT.md §10.4. The permitted feedback subset
// (attemptId, attemptNumber, score, maxScore, percentage, itemResults) is
// delivered; no answer-key material outside `itemResults` (each of whose
// `correctOptionId` and `explanation` are the permitted per-item fields)
// crosses the callable boundary. `replay` is `true` when the call is an
// idempotent replay per §8 and returns the existing attempt payload
// unchanged.
export type AssessmentAttemptsFinalizeResponse = {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly score: number;
  readonly maxScore: number;
  readonly percentage: number;
  readonly itemResults: readonly AssessmentAttemptItemResult[];
  readonly replay: boolean;
};

const SESSION_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,254}[a-zA-Z0-9])?$/;
const IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,126}[a-zA-Z0-9])?$/;

// Forbidden top-level keys on the finalize request payload. Every scoring
// artifact is server-owned; a request-shape refusal is preferred to
// silently ignoring the field so a broken client is surfaced quickly and
// no laundering path exists per ASSESSMENT_SCORING_CONTRACT.md §7.
const FORBIDDEN_REQUEST_KEYS: readonly string[] = [
  "score",
  "correctness",
  "isCorrect",
  "correctAnswer",
  "correctAnswers",
  "pointsEarned",
  "points",
  "explanation",
  "explanations",
  "rubric",
  "feedback",
  "itemResults",
  "maxScore",
  "percentage",
  "responses",
  "attemptNumber",
  "attemptId",
  "assessmentRevisionId",
  "studentId",
  "assignmentId",
  "classId",
  "teacherId",
  "schoolId",
  "districtId",
];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function assertActiveStudentInDistrict(
  request: CallableRequest<unknown>,
): Promise<{
  readonly uid: string;
  readonly schoolId: string;
  readonly districtId: string;
}> {
  const context = await requireDistrictContext(request);
  if (context.role !== "student") {
    throw new PlatformError(
      "role-forbidden",
      "Caller must be an active student.",
    );
  }
  return {
    uid: context.uid,
    schoolId: context.schoolId,
    districtId: context.districtId,
  };
}

function validateRequest(data: unknown): {
  readonly sessionId: string;
  readonly idempotencyKey: string;
} {
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new PlatformError(
      "assessmentAttempts.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  for (const key of FORBIDDEN_REQUEST_KEYS) {
    if (key in payload) {
      throw new PlatformError(
        "assessmentAttempts.invalidRequest",
        `Server-owned field "${key}" is not permitted on the request.`,
      );
    }
  }
  if (!isNonEmptyString(payload.sessionId)) {
    throw new PlatformError(
      "assessmentAttempts.invalidSessionId",
      "sessionId must be a non-empty string.",
    );
  }
  const sessionId = payload.sessionId.trim();
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new PlatformError(
      "assessmentAttempts.invalidSessionId",
      "sessionId must be a URL-safe token.",
    );
  }
  if (!isNonEmptyString(payload.idempotencyKey)) {
    throw new PlatformError(
      "assessmentAttempts.invalidIdempotencyKey",
      "idempotencyKey must be a non-empty string.",
    );
  }
  const idempotencyKey = payload.idempotencyKey.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    throw new PlatformError(
      "assessmentAttempts.invalidIdempotencyKey",
      "idempotencyKey must be a URL-safe token.",
    );
  }
  return { sessionId, idempotencyKey };
}

// Response-value validator applied to the session's autosaved responses at
// the finalize boundary. Every v1 response value MUST be a string per
// ASSESSMENT_SCORING_CONTRACT.md §8.2, §8.3. The autosave-boundary
// validator (Sprint 11C Slice 2) permits opaque JSON values so future item
// types can widen without a shape transform (§15.4); the finalize
// boundary enforces the v1 narrowing here. A session that carries a
// non-string value (via a hypothetical bypass of the autosave validator)
// is refused rather than silently mis-scored.
function readCanonicalSessionResponses(
  session: AssessmentSessionRecord,
): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  const responses = session.responses ?? [];
  for (const entry of responses) {
    if (!entry || typeof entry.itemId !== "string" || entry.itemId.length === 0) {
      throw new PlatformError(
        "assessmentAttempts.malformedSession",
        "Session response element is malformed.",
      );
    }
    if (typeof entry.response !== "string") {
      throw new PlatformError(
        "assessmentAttempts.malformedSession",
        "Session response value must be a string in v1.",
      );
    }
    if (map.has(entry.itemId)) {
      throw new PlatformError(
        "assessmentAttempts.malformedSession",
        "Session responses contain a duplicate itemId.",
      );
    }
    map.set(entry.itemId, entry.response);
  }
  return map;
}

// Deterministic attempt identifier per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §12: `{assignmentId}__{studentId}__a{attemptNumber}`.
export function attemptIdFor(
  assignmentId: string,
  studentId: string,
  attemptNumber: number,
): string {
  return `${assignmentId}__${studentId}__a${attemptNumber}`;
}

// Round-half-to-even (banker's rounding) at two decimal places per
// ASSESSMENT_SCORING_CONTRACT.md §11.1. Implemented locally so scoring is
// deterministic across Node runtimes and independent of any `toFixed`
// rounding drift.
function roundHalfToEven2(value: number): number {
  const scaled = value * 100;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const EPS = 1e-9;
  let rounded: number;
  if (diff > 0.5 + EPS) {
    rounded = floor + 1;
  } else if (diff < 0.5 - EPS) {
    rounded = floor;
  } else {
    rounded = floor % 2 === 0 ? floor : floor + 1;
  }
  return rounded / 100;
}

type ScoringResult = {
  readonly score: number;
  readonly maxScore: number;
  readonly percentage: number;
  readonly itemResults: readonly AssessmentAttemptItemResult[];
};

// Deterministic local scorer per ASSESSMENT_SCORING_CONTRACT.md §9, §10,
// §11, §12. Verifies the revision + answer-key pairing invariants and
// applies the v1 strict-equality singleChoice rule. Integrity failures
// surface as distinguishable error identifiers per §12.2 so the caller's
// session is left Live and a corrected revision publication can produce a
// valid attempt on retry.
function scoreAttempt(
  revision: AssessmentRevisionRecord,
  answerKey: AssessmentAnswerKeyRecord,
  responsesByItemId: ReadonlyMap<string, string>,
): ScoringResult {
  if (revision.schemaVersion !== ASSESSMENT_SCHEMA_VERSION_V1) {
    throw new PlatformError(
      "assessmentAttempts.answerKeyIntegrity",
      "Revision schemaVersion is not v1.",
    );
  }
  if (answerKey.schemaVersion !== ASSESSMENT_SCHEMA_VERSION_V1) {
    throw new PlatformError(
      "assessmentAttempts.answerKeyIntegrity",
      "Answer key schemaVersion is not v1.",
    );
  }
  if (!revision.items || revision.items.length === 0) {
    throw new PlatformError(
      "assessmentAttempts.answerKeyIntegrity",
      "Revision items are missing or empty.",
    );
  }
  if (!answerKey.items || answerKey.items.length === 0) {
    throw new PlatformError(
      "assessmentAttempts.answerKeyIntegrity",
      "Answer key items are missing or empty.",
    );
  }

  const revisionItemById = new Map<
    string,
    AssessmentRevisionRecord["items"][number]
  >();
  for (const item of revision.items) {
    if (item.itemType !== "singleChoice") {
      throw new PlatformError(
        "assessmentAttempts.answerKeyIntegrity",
        `Revision item "${item.itemId}" has unsupported itemType.`,
      );
    }
    revisionItemById.set(item.itemId, item);
  }

  const answerKeyItemIds = new Set(answerKey.items.map((i) => i.itemId));
  if (answerKeyItemIds.size !== revisionItemById.size) {
    throw new PlatformError(
      "assessmentAttempts.answerKeyIntegrity",
      "Answer key and revision item sets differ.",
    );
  }
  for (const id of revisionItemById.keys()) {
    if (!answerKeyItemIds.has(id)) {
      throw new PlatformError(
        "assessmentAttempts.answerKeyIntegrity",
        "Answer key and revision item sets differ.",
      );
    }
  }

  const itemResults: AssessmentAttemptItemResult[] = [];
  let score = 0;
  let maxScore = 0;

  for (const keyItem of answerKey.items) {
    const revItem = revisionItemById.get(keyItem.itemId);
    if (!revItem) {
      throw new PlatformError(
        "assessmentAttempts.answerKeyIntegrity",
        `Answer key item "${keyItem.itemId}" is not in the revision.`,
      );
    }
    if (keyItem.points !== 1) {
      throw new PlatformError(
        "assessmentAttempts.answerKeyIntegrity",
        `Answer key item "${keyItem.itemId}" has non-unit points.`,
      );
    }
    const revOptionIds = revItem.options.map((o) => o.optionId);
    if (!revOptionIds.includes(keyItem.correctOptionId)) {
      throw new PlatformError(
        "assessmentAttempts.answerKeyIntegrity",
        `Answer key item "${keyItem.itemId}" correctOptionId is not among the revision options.`,
      );
    }
    maxScore += keyItem.points;

    const studentResponse = responsesByItemId.get(keyItem.itemId);
    if (studentResponse === undefined) {
      itemResults.push({
        itemId: keyItem.itemId,
        isCorrect: false,
        pointsEarned: 0,
        correctOptionId: keyItem.correctOptionId,
        explanation: keyItem.explanation,
        studentResponse: null,
      });
      continue;
    }
    const isCorrect = studentResponse === keyItem.correctOptionId;
    const pointsEarned = isCorrect ? keyItem.points : 0;
    score += pointsEarned;
    itemResults.push({
      itemId: keyItem.itemId,
      isCorrect,
      pointsEarned,
      correctOptionId: keyItem.correctOptionId,
      explanation: keyItem.explanation,
      studentResponse,
    });
  }

  if (maxScore === 0) {
    throw new PlatformError(
      "assessmentAttempts.answerKeyIntegrity",
      "Answer key produced a zero maxScore.",
    );
  }

  const percentage = roundHalfToEven2((score / maxScore) * 100);
  return { score, maxScore, percentage, itemResults };
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// Feedback payload projected from an existing attempt record so an
// idempotent replay returns the same shape the successful path returned
// per ASSESSMENT_IMPLEMENTATION_CONTRACT.md §8 idempotency semantics and
// ASSESSMENT_SCORING_CONTRACT.md §10.4 feedback payload.
function feedbackFromAttempt(
  attemptId: string,
  attempt: AssessmentAttemptRecord,
): AssessmentAttemptsFinalizeResponse {
  return {
    attemptId,
    attemptNumber: attempt.attemptNumber,
    score: attempt.score,
    maxScore: attempt.maxScore,
    percentage: attempt.percentage,
    itemResults: attempt.itemResults,
    replay: true,
  };
}

async function findAttemptByIdempotencyKey(
  studentId: string,
  assignmentId: string,
  idempotencyKey: string,
  tx: Transaction,
): Promise<{ id: string; data: AssessmentAttemptRecord } | undefined> {
  const query = attemptsCollectionRef()
    .where("studentId", "==", studentId)
    .where("assignmentId", "==", assignmentId)
    .where("idempotencyKey", "==", idempotencyKey)
    .limit(1);
  const snap = await tx.get(query);
  if (snap.empty) return undefined;
  const doc = snap.docs[0];
  return { id: doc.id, data: doc.data() };
}

async function countExistingAttempts(
  studentId: string,
  assignmentId: string,
  tx: Transaction,
): Promise<number> {
  const query = attemptsCollectionRef()
    .where("studentId", "==", studentId)
    .where("assignmentId", "==", assignmentId);
  const snap = await tx.get(query);
  return snap.size;
}

type FinalizeInternalResult = {
  readonly response: AssessmentAttemptsFinalizeResponse;
  readonly wroteAttempt: boolean;
  readonly attemptId: string;
  readonly session: AssessmentSessionRecord;
  readonly scoring?: ScoringResult;
  readonly attemptNumber: number;
};

// assessmentAttemptsFinalize
//
// Canonical transition of a Live assessment session into an immutable
// authoritative attempt per ASSESSMENT_IMPLEMENTATION_CONTRACT.md §7, §8,
// §11, §21 (PDR-026a, PDR-026c) and ASSESSMENT_SCORING_CONTRACT.md §7,
// §9, §10, §11, §12, §16.
//
// Sole writer of `attempts/{attemptId}`. Sole deleter of the referenced
// `assessmentSessions/{sessionId}` document on successful commit. The
// session read, the attempt write, and the session delete occur inside a
// single Firestore transaction per §8. On any pre-commit failure the
// session is left Live and the caller receives a distinguishable error
// identifier per §22.
//
// Ownership and authorization enforcement:
//   - `requireDistrictContext(request)` gates authentication, active
//     status, canonical claims, and district agreement (PDR-025).
//   - non-student callers are refused with `role-forbidden`.
//   - `studentId` on the session MUST equal the caller's uid.
//   - `districtId` on the session MUST equal the caller's verified claim
//     (else canonical `district-mismatch`).
//   - `schoolId` on the session MUST equal the caller's canonical claim.
//   - `status` on the session MUST equal `live` (else `sessionNotLive`).
//
// Server-owned data:
//   - Score, per-item correctness, points earned, correct-answer material,
//     and explanations are computed only by this callable's scorer against
//     the server-confidential `assessmentAnswerKeys/{revisionId}` document
//     (§7, §15).
//   - The client MUST NOT supply any of those fields; a request-shape
//     refusal is preferred over silent ignore.
//   - The attempt record's ownership fields are copied from the session's
//     frozen ownership fields; no client input reaches the attempt.
//
// Idempotency (§8):
//   - The client supplies an idempotency marker. A commit that matches an
//     existing attempt with the same marker returns the existing attempt
//     payload without a second write and without a second audit event.
//
// Audit (§24):
//   - Exactly one `assessment.attemptFinalized` event is emitted per
//     successful attempt. No event is emitted on integrity failure. No
//     event is emitted on idempotent replay.
async function assessmentAttemptsFinalizeHandler(
  request: CallableRequest<unknown>,
): Promise<AssessmentAttemptsFinalizeResponse> {
  const actor = await assertActiveStudentInDistrict(request);
  const input = validateRequest(request.data);

  const outcome = await runFirestoreTransaction<FinalizeInternalResult>(
    async (tx) => {
      const sessionRef = assessmentSessionDocRef(input.sessionId);
      const sessionSnap = await tx.get(sessionRef);
      if (!sessionSnap.exists) {
        throw new PlatformError(
          "assessmentAttempts.sessionNotFound",
          "Referenced session was not found.",
        );
      }
      const session = sessionSnap.data();
      if (!session) {
        throw new PlatformError(
          "assessmentAttempts.sessionNotFound",
          "Referenced session record was empty.",
        );
      }

      if (session.studentId !== actor.uid) {
        throw new PlatformError(
          "assessmentAttempts.notOwned",
          "Caller does not own the referenced session.",
        );
      }
      if (session.districtId !== actor.districtId) {
        throw new PlatformError(
          "district-mismatch",
          "Caller does not have access to this session.",
        );
      }
      if (session.schoolId !== actor.schoolId) {
        throw new PlatformError(
          "assessmentAttempts.forbidden",
          "Caller does not have access to this session.",
        );
      }
      if (session.status !== "live") {
        throw new PlatformError(
          "assessmentAttempts.sessionNotLive",
          "Session is not in a finalizable state.",
        );
      }

      // Idempotency: an existing attempt with the same idempotency marker
      // is returned unchanged per §8. The stored attempt itself is the
      // canonical replay payload; no second attempt is written.
      const existing = await findAttemptByIdempotencyKey(
        actor.uid,
        session.assignmentId,
        input.idempotencyKey,
        tx,
      );
      if (existing) {
        return {
          response: feedbackFromAttempt(existing.id, existing.data),
          wroteAttempt: false,
          attemptId: existing.id,
          session,
          attemptNumber: existing.data.attemptNumber,
        };
      }

      // Revision and answer key are resolved from the session's frozen
      // assessmentRevisionId per ASSESSMENT_SCORING_CONTRACT.md §12.1.
      const revisionRef = assessmentRevisionDocRef(
        session.assessmentRevisionId,
      );
      const answerKeyRef = assessmentAnswerKeyDocRef(
        session.assessmentRevisionId,
      );
      const [revisionSnap, answerKeySnap] = await Promise.all([
        tx.get(revisionRef),
        tx.get(answerKeyRef),
      ]);
      if (!revisionSnap.exists) {
        throw new PlatformError(
          "assessmentAttempts.revisionMissing",
          "Assessment revision is not published.",
        );
      }
      if (!answerKeySnap.exists) {
        throw new PlatformError(
          "assessmentAttempts.answerKeyMissing",
          "Assessment answer key is not published.",
        );
      }
      const revision = revisionSnap.data();
      const answerKey = answerKeySnap.data();
      if (!revision || !answerKey) {
        throw new PlatformError(
          "assessmentAttempts.answerKeyIntegrity",
          "Revision or answer-key document is empty.",
        );
      }

      const responsesByItemId = readCanonicalSessionResponses(session);
      const scoring = scoreAttempt(revision, answerKey, responsesByItemId);

      const priorCount = await countExistingAttempts(
        actor.uid,
        session.assignmentId,
        tx,
      );
      const attemptNumber = priorCount + 1;
      const attemptId = attemptIdFor(
        session.assignmentId,
        actor.uid,
        attemptNumber,
      );

      const attemptExistingSnap = await tx.get(attemptDocRef(attemptId));
      if (attemptExistingSnap.exists) {
        throw new PlatformError(
          "assessmentAttempts.writeConflict",
          "Derived attemptId already exists.",
        );
      }

      const responses: readonly AssessmentSessionResponse[] =
        session.responses ?? [];

      const attemptWrite: AssessmentAttemptCreationWrite = {
        studentId: session.studentId,
        assignmentId: session.assignmentId,
        classId: session.classId,
        teacherId: session.teacherId,
        schoolId: session.schoolId,
        districtId: session.districtId,
        activityId: session.activityId,
        assessmentId: session.assessmentId,
        assessmentRevisionId: session.assessmentRevisionId,
        attemptNumber,
        score: scoring.score,
        maxScore: scoring.maxScore,
        percentage: scoring.percentage,
        responses,
        itemResults: scoring.itemResults,
        idempotencyKey: input.idempotencyKey,
        submittedAt: FieldValue.serverTimestamp(),
      };

      tx.set(attemptCreationDocRef(attemptId), attemptWrite);
      tx.delete(sessionRef);

      return {
        response: {
          attemptId,
          attemptNumber,
          score: scoring.score,
          maxScore: scoring.maxScore,
          percentage: scoring.percentage,
          itemResults: scoring.itemResults,
          replay: false,
        },
        wroteAttempt: true,
        attemptId,
        session,
        scoring,
        attemptNumber,
      };
    },
  );

  if (outcome.wroteAttempt) {
    await writeAuditEvent({
      actorUserId: actor.uid,
      actorRole: "student",
      action: "assessment.attemptFinalized",
      targetType: "attempt",
      targetId: outcome.attemptId,
      schoolId: actor.schoolId,
      payload: {
        assignmentId: outcome.session.assignmentId,
        classId: outcome.session.classId,
        activityId: outcome.session.activityId,
        assessmentId: outcome.session.assessmentId,
        assessmentRevisionId: outcome.session.assessmentRevisionId,
        attemptNumber: outcome.attemptNumber,
        score: outcome.scoring?.score ?? 0,
        maxScore: outcome.scoring?.maxScore ?? 0,
        percentage: outcome.scoring?.percentage ?? 0,
        districtId: outcome.session.districtId,
      },
    });

    safeLog(() =>
      log.info("assessmentAttempts.finalized", {
        actorUserId: actor.uid,
        attemptId: outcome.attemptId,
        assignmentId: outcome.session.assignmentId,
        attemptNumber: outcome.attemptNumber,
      }),
    );
  } else {
    safeLog(() =>
      log.info("assessmentAttempts.finalizeIdempotent", {
        actorUserId: actor.uid,
        attemptId: outcome.attemptId,
      }),
    );
  }

  return outcome.response;
}

export const assessmentAttemptsFinalize = onCall(
  assessmentAttemptsFinalizeHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assessmentAttemptsFinalizeHandler =
  assessmentAttemptsFinalizeHandler;
