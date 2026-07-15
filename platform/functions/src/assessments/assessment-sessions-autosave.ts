import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  platformCallable,
  PlatformError,
  assessmentSessionAutosaveDocRef,
  assessmentSessionDocRef,
  log,
  requireDistrictContext,
  type AssessmentSessionAutosaveWrite,
  type AssessmentSessionRecord,
  type AssessmentSessionResponse,
} from "../shared";

// Client-supplied request payload for assessmentSessionsAutosave per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §21. The authenticated student
// supplies the target `sessionId` and the current in-progress `responses`
// snapshot. Ownership fields, `sessionOrdinal`, `status`, and `startedAt`
// are never carried on the request; they were frozen at session creation
// per §6 and are structurally excluded from the write shape via
// `AssessmentSessionAutosaveWrite`. Scoring artifacts (score, correctness,
// points earned, explanation payloads) are likewise never accepted and are
// rejected with `assessmentSessions.invalidResponses` when present on any
// response element (§6, §15).
export type AssessmentSessionsAutosaveRequest = {
  readonly sessionId: string;
  readonly responses: readonly AssessmentSessionResponse[];
};

// Return payload of a successful autosave call. `persisted` is `true` when
// this call wrote a new autosave document and `false` when the call was
// coalesced against the currently stored responses per the idempotency
// invariant in §21 (autosave is idempotent under identical payload). Even
// a coalesced call is a successful acknowledgement that the server holds
// the current answers; the client MUST NOT interpret `persisted: false`
// as a failure.
export type AssessmentSessionsAutosaveResponse = {
  readonly sessionId: string;
  readonly persisted: boolean;
};

const SESSION_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,254}[a-zA-Z0-9])?$/;
const ITEM_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,126}[a-zA-Z0-9])?$/;

// Hard cap on the number of response elements a single autosave call may
// carry. Sized generously above the largest LyfeLabz assessment item count
// (10-question canonical quiz, extended engineering-challenge rubrics) so
// that a well-behaved client is never truncated, while still bounding the
// Firestore document size and the server-side validation cost.
const MAX_RESPONSES = 200;

// Response-value serialized-size ceiling per session. Autosave carries the
// full working state on every call; capping the serialized payload keeps a
// runaway client from writing arbitrarily large documents inside a single
// autosave and keeps the session comfortably under the Firestore
// 1 MiB document limit.
const MAX_SERIALIZED_RESPONSES_BYTES = 64 * 1024;

// Forbidden keys per response element. `score`, `correctness`,
// `isCorrect`, `correctAnswer`, `pointsEarned`, `points`, and
// `explanation` are scoring artifacts that only the scorer produces
// against the server-confidential answer key (§8, §15). A client that
// attempts to smuggle any of these onto a response element is rejected;
// the answer key never crosses this callable and no client-authoritative
// scoring value is ever accepted onto a session document (§6).
const FORBIDDEN_RESPONSE_KEYS: readonly string[] = [
  "score",
  "correctness",
  "isCorrect",
  "correct",
  "correctAnswer",
  "correctAnswers",
  "pointsEarned",
  "points",
  "explanation",
  "explanations",
  "rubric",
  "feedback",
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

// Deep structural validation of a single response value. Autosave values
// are opaque to the server (the scorer interprets them against the paired
// answer key at finalize time), so this walk enforces only the shape
// invariants that keep the collection safe: JSON-serializable data,
// bounded depth, no forbidden scoring keys, no function or symbol values.
// Rejecting non-serializable inputs at the boundary prevents Firestore
// write-time surprises and preserves the "sessions carry answers only"
// invariant in §6.
function validateResponseValue(value: unknown, depth: number): void {
  if (depth > 6) {
    throw new PlatformError(
      "assessmentSessions.invalidResponses",
      "response value nested too deeply.",
    );
  }
  if (value === null) return;
  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    if (t === "number" && !Number.isFinite(value)) {
      throw new PlatformError(
        "assessmentSessions.invalidResponses",
        "response value must be a finite number.",
      );
    }
    return;
  }
  if (t === "undefined" || t === "function" || t === "symbol" || t === "bigint") {
    throw new PlatformError(
      "assessmentSessions.invalidResponses",
      "response value must be a JSON-serializable primitive, array, or object.",
    );
  }
  if (Array.isArray(value)) {
    for (const element of value) {
      validateResponseValue(element, depth + 1);
    }
    return;
  }
  if (t === "object") {
    const object = value as Record<string, unknown>;
    for (const key of Object.keys(object)) {
      if (FORBIDDEN_RESPONSE_KEYS.includes(key)) {
        throw new PlatformError(
          "assessmentSessions.invalidResponses",
          `Scoring artifact "${key}" is not permitted on a session response.`,
        );
      }
      validateResponseValue(object[key], depth + 1);
    }
    return;
  }
  throw new PlatformError(
    "assessmentSessions.invalidResponses",
    "response value has an unsupported type.",
  );
}

function normalizeResponse(raw: unknown, index: number): AssessmentSessionResponse {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PlatformError(
      "assessmentSessions.invalidResponses",
      `responses[${index}] must be a structured object.`,
    );
  }
  const entry = raw as Record<string, unknown>;
  if (!isNonEmptyString(entry.itemId)) {
    throw new PlatformError(
      "assessmentSessions.invalidResponses",
      `responses[${index}].itemId must be a non-empty string.`,
    );
  }
  const itemId = entry.itemId.trim();
  if (!ITEM_ID_PATTERN.test(itemId)) {
    throw new PlatformError(
      "assessmentSessions.invalidResponses",
      `responses[${index}].itemId must be a URL-safe token.`,
    );
  }
  if (!("response" in entry)) {
    throw new PlatformError(
      "assessmentSessions.invalidResponses",
      `responses[${index}].response is required.`,
    );
  }
  for (const key of Object.keys(entry)) {
    if (key === "itemId" || key === "response") continue;
    throw new PlatformError(
      "assessmentSessions.invalidResponses",
      `responses[${index}] carries unexpected key "${key}".`,
    );
  }
  validateResponseValue(entry.response, 0);
  return { itemId, response: entry.response };
}

function validateRequest(data: unknown): {
  readonly sessionId: string;
  readonly responses: readonly AssessmentSessionResponse[];
} {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "assessmentSessions.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  if (!isNonEmptyString(payload.sessionId)) {
    throw new PlatformError(
      "assessmentSessions.invalidSessionId",
      "sessionId must be a non-empty string.",
    );
  }
  const sessionId = payload.sessionId.trim();
  if (!SESSION_ID_PATTERN.test(sessionId)) {
    throw new PlatformError(
      "assessmentSessions.invalidSessionId",
      "sessionId must be a URL-safe token.",
    );
  }
  if (!Array.isArray(payload.responses)) {
    throw new PlatformError(
      "assessmentSessions.invalidResponses",
      "responses must be an array.",
    );
  }
  if (payload.responses.length > MAX_RESPONSES) {
    throw new PlatformError(
      "assessmentSessions.invalidResponses",
      `responses may not exceed ${MAX_RESPONSES} elements.`,
    );
  }
  const seen = new Set<string>();
  const responses: AssessmentSessionResponse[] = [];
  payload.responses.forEach((raw, index) => {
    const normalized = normalizeResponse(raw, index);
    if (seen.has(normalized.itemId)) {
      throw new PlatformError(
        "assessmentSessions.invalidResponses",
        `responses[${index}].itemId "${normalized.itemId}" is duplicated.`,
      );
    }
    seen.add(normalized.itemId);
    responses.push(normalized);
  });
  const serializedBytes = Buffer.byteLength(JSON.stringify(responses), "utf8");
  if (serializedBytes > MAX_SERIALIZED_RESPONSES_BYTES) {
    throw new PlatformError(
      "assessmentSessions.invalidResponses",
      `responses exceed the ${MAX_SERIALIZED_RESPONSES_BYTES}-byte autosave cap.`,
    );
  }
  return { sessionId, responses };
}

async function loadLiveSession(
  sessionId: string,
): Promise<AssessmentSessionRecord> {
  const snapshot = await assessmentSessionDocRef(sessionId).get();
  if (!snapshot.exists) {
    throw new PlatformError(
      "assessmentSessions.sessionNotFound",
      "Referenced session was not found.",
    );
  }
  const data = snapshot.data();
  if (!data) {
    throw new PlatformError(
      "assessmentSessions.sessionNotFound",
      "Referenced session record was empty.",
    );
  }
  return data;
}

// Deep structural equality for the currently stored `responses` array
// against the incoming autosave payload. Both arrays share the canonical
// `{itemId, response}` element shape; ordering is significant because the
// server does not reorder responses. Used to satisfy the §21 invariant
// that autosave is idempotent under identical payload without incurring
// a second Firestore write.
function responsesEqual(
  incoming: readonly AssessmentSessionResponse[],
  existing: readonly AssessmentSessionResponse[] | undefined,
): boolean {
  if (!existing) return incoming.length === 0;
  if (incoming.length !== existing.length) return false;
  for (let i = 0; i < incoming.length; i += 1) {
    const a = incoming[i];
    const b = existing[i];
    if (a.itemId !== b.itemId) return false;
    if (JSON.stringify(a.response) !== JSON.stringify(b.response)) return false;
  }
  return true;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

// assessmentSessionsAutosave
//
// Persists in-progress `responses` to the caller's Live session per
// ASSESSMENT_IMPLEMENTATION_CONTRACT.md §6, §14, §21 (PDR-026). Callable
// by an authenticated student whose canonical custom claims resolve to an
// active student in the same district as the referenced session.
//
// Ownership and lifecycle enforcement:
//   - `studentId` on the session MUST equal the caller's uid; any other
//     student receives `assessmentSessions.notOwned`
//   - `districtId` on the session MUST equal the caller's verified
//     districtId claim per PDR-025 §17
//   - `schoolId` on the session MUST equal the caller's canonical
//     schoolId claim, preventing a caller whose district was rehomed
//     from writing to a session stamped with the previous school
//   - session `status` MUST be `live`; archived sessions are refused with
//     `assessmentSessions.sessionNotLive` and MUST be re-opened by
//     `assessmentSessionsRecover` (deferred slice) rather than by autosave
//
// Frozen-field enforcement is structural rather than diffed: the write
// shape (`AssessmentSessionAutosaveWrite`) exposes only `responses` and
// `lastActivityAt`. Ownership fields, `sessionOrdinal`, `status`, and
// `startedAt` are unreachable from this callable. This mirrors the
// narrow-write pattern used across the certified callable set.
//
// Idempotency (§21 autosave is idempotent under identical payload):
// a repeat call whose `responses` array is byte-identical to the stored
// array returns `persisted: false` without a second Firestore write and
// without a second `lastActivityAt` stamp. The server-side coalesce
// satisfies the §31 G-10A-4 throttle recommendation for the common case
// of a well-behaved client that resends the current working state.
//
// Audit discipline (§24): autosave writes are NOT audited per event.
// A sampled `assessment.sessionAutosaveSampled` event MAY be emitted at
// a bounded rate for observability in a later slice; this callable does
// not emit an audit event.
async function assessmentSessionsAutosaveHandler(
  request: CallableRequest<unknown>,
): Promise<AssessmentSessionsAutosaveResponse> {
  const actor = await assertActiveStudentInDistrict(request);
  const input = validateRequest(request.data);

  const session = await loadLiveSession(input.sessionId);

  if (session.studentId !== actor.uid) {
    throw new PlatformError(
      "assessmentSessions.notOwned",
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
      "assessmentSessions.forbidden",
      "Caller does not have access to this session.",
    );
  }
  if (session.status !== "live") {
    throw new PlatformError(
      "assessmentSessions.sessionNotLive",
      "Session is not accepting autosave writes.",
    );
  }

  if (responsesEqual(input.responses, session.responses)) {
    safeLog(() =>
      log.info("assessmentSessions.autosaveCoalesced", {
        actorUserId: actor.uid,
        sessionId: input.sessionId,
        responseCount: input.responses.length,
      }),
    );
    return { sessionId: input.sessionId, persisted: false };
  }

  const write: AssessmentSessionAutosaveWrite = {
    responses: input.responses,
    lastActivityAt: FieldValue.serverTimestamp(),
  };

  await assessmentSessionAutosaveDocRef(input.sessionId).update(write);

  safeLog(() =>
    log.info("assessmentSessions.autosaved", {
      actorUserId: actor.uid,
      sessionId: input.sessionId,
      responseCount: input.responses.length,
    }),
  );

  return { sessionId: input.sessionId, persisted: true };
}

export const assessmentSessionsAutosave = platformCallable(
  assessmentSessionsAutosaveHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __assessmentSessionsAutosaveHandler =
  assessmentSessionsAutosaveHandler;
