import type {
  AttemptSummary,
  FinalizeResult,
  RuntimeCallables,
  RuntimeEnv,
  RuntimeMode,
  RuntimeStatus,
  SessionResponse,
} from "./types";

// Sprint 17 Slice 5: pure certified-assessment orchestrator.
//
// Coordinates the begin -> autosave -> finalize -> getAttempt lifecycle
// against the certified callables (assessmentSessionsBegin,
// assessmentSessionsAutosave, assessmentAttemptsFinalize,
// assessmentAttemptGet). The orchestrator never scores, never persists
// state to Firestore directly, never contains lesson-specific logic,
// and never exposes ownership identifiers. Every backend interaction
// flows through the injected `RuntimeCallables` seam so the same
// orchestrator drives production (Firebase-backed callables in
// entry.ts) and tests (in-memory fakes).
//
// State machine per Sprint 17 Implementation Specification §5:
//
//   inert       - no assignment context; no backend work permitted.
//   pending     - assignment context detected; begin has not yet run.
//   active      - session has been established and accepts autosave.
//   finalized   - attempt has been written; results are available.
//   error       - unrecoverable session lifecycle failure; further
//                 backend calls refuse until a lesson reload.
//
// Idempotency and duplicate protection are enforced client-side in
// addition to the server-side invariants: begin caches its promise so
// concurrent callers observe the same result, autosave coalesces on
// byte-identical payloads, and finalize reuses a single per-runtime
// idempotencyKey so a retry after transport failure lines up with the
// certified idempotency contract in the finalize callable.

const IDEMPOTENCY_KEY_MAX_LENGTH = 128;

type FinalizedState = {
  readonly result: FinalizeResult;
  readonly idempotencyKey: string;
};

export type AssessmentRuntime = {
  readonly version: string;
  readonly hasAssignmentContext: boolean;
  getStatus(): RuntimeStatus;
  begin(): Promise<void>;
  autosave(responses: readonly SessionResponse[]): Promise<{ readonly persisted: boolean }>;
  finalize(responses: readonly SessionResponse[]): Promise<FinalizeResult>;
  getAttempt(attemptId?: string): Promise<AttemptSummary>;
  destroy(): void;
};

export type CreateAssessmentRuntimeInput = {
  readonly version: string;
  readonly assignmentId: string | null;
  readonly callables: RuntimeCallables;
  readonly env: RuntimeEnv;
};

function truncateIdempotencyKey(raw: string): string {
  if (raw.length <= IDEMPOTENCY_KEY_MAX_LENGTH) return raw;
  return raw.slice(0, IDEMPOTENCY_KEY_MAX_LENGTH);
}

function serialize(responses: readonly SessionResponse[]): string {
  return JSON.stringify(responses);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

// Recoverable errors leave the session in its previous mode so a caller
// can retry after a transient outage. Every other refusal transitions
// the runtime to `error`; the lesson may still render its instructional
// content but backend calls will refuse until the page is reloaded.
const RECOVERABLE_ERROR_CODES: ReadonlyArray<string> = [
  "unavailable",
  "internal",
  "deadline-exceeded",
  "resource-exhausted",
  "cancelled",
];

function isRecoverable(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== "string") return false;
  return RECOVERABLE_ERROR_CODES.includes(code);
}

export function createAssessmentRuntime(
  input: CreateAssessmentRuntimeInput,
): AssessmentRuntime {
  const { version, callables, env } = input;
  const assignmentId =
    isNonEmptyString(input.assignmentId) ? input.assignmentId : null;

  let mode: RuntimeMode = assignmentId === null ? "inert" : "pending";
  let destroyed = false;
  let sessionId: string | null = null;
  let beginPromise: Promise<void> | null = null;
  let lastAutosaveSerialized: string | null = null;
  let inflightAutosave: Promise<{ readonly persisted: boolean }> | null = null;
  let finalizeIdempotencyKey: string | null = null;
  let finalizePromise: Promise<FinalizeResult> | null = null;
  let finalizedState: FinalizedState | null = null;

  function guardActive(): void {
    if (destroyed) {
      throw new Error("assessment runtime has been destroyed");
    }
    if (assignmentId === null) {
      throw new Error("assessment runtime is inert without assignment context");
    }
    if (mode === "error") {
      throw new Error("assessment runtime is in an error state");
    }
  }

  async function ensureBegun(): Promise<void> {
    if (mode === "active" || mode === "finalized") return;
    if (mode === "error") {
      throw new Error("assessment runtime is in an error state");
    }
    if (assignmentId === null) return;
    if (beginPromise !== null) {
      await beginPromise;
      return;
    }
    beginPromise = (async (): Promise<void> => {
      try {
        const outcome = await callables.begin(assignmentId);
        if (destroyed) return;
        if (!isNonEmptyString(outcome.sessionId)) {
          throw new Error("callable returned an empty sessionId");
        }
        sessionId = outcome.sessionId;
        mode = "active";
      } catch (err) {
        if (!destroyed) {
          if (!isRecoverable(err)) {
            mode = "error";
          }
          beginPromise = null;
        }
        throw err;
      }
    })();
    await beginPromise;
  }

  async function begin(): Promise<void> {
    if (destroyed) return;
    if (assignmentId === null) return;
    if (mode === "finalized") return;
    if (mode === "error") {
      throw new Error("assessment runtime is in an error state");
    }
    await ensureBegun();
  }

  async function autosave(
    responses: readonly SessionResponse[],
  ): Promise<{ readonly persisted: boolean }> {
    if (destroyed) return { persisted: false };
    if (assignmentId === null) return { persisted: false };
    if (mode === "finalized") return { persisted: false };
    guardActive();
    await ensureBegun();
    if (sessionId === null) {
      throw new Error("session was not established");
    }
    const serialized = serialize(responses);
    if (lastAutosaveSerialized === serialized) {
      return { persisted: false };
    }
    if (inflightAutosave !== null) {
      await inflightAutosave;
    }
    const activeSessionId = sessionId;
    inflightAutosave = (async () => {
      try {
        const result = await callables.autosave(activeSessionId, responses);
        if (!destroyed) {
          lastAutosaveSerialized = serialized;
        }
        return result;
      } catch (err) {
        if (!destroyed && !isRecoverable(err)) {
          mode = "error";
        }
        throw err;
      } finally {
        inflightAutosave = null;
      }
    })();
    return inflightAutosave;
  }

  async function finalize(
    responses: readonly SessionResponse[],
  ): Promise<FinalizeResult> {
    if (destroyed) {
      throw new Error("assessment runtime has been destroyed");
    }
    if (assignmentId === null) {
      throw new Error("assessment runtime is inert without assignment context");
    }
    if (mode === "error") {
      throw new Error("assessment runtime is in an error state");
    }
    if (finalizedState !== null) {
      return finalizedState.result;
    }
    if (finalizePromise !== null) {
      return finalizePromise;
    }
    finalizePromise = (async (): Promise<FinalizeResult> => {
      await ensureBegun();
      if (sessionId === null) {
        throw new Error("session was not established");
      }
      // Ensure the last autosaved payload matches the responses about to
      // be finalized so the certified scorer reads the caller's intended
      // responses out of the session document. Byte-identical payload is
      // coalesced by the autosave path; only a real change makes a
      // second write.
      await autosave(responses);
      if (finalizeIdempotencyKey === null) {
        finalizeIdempotencyKey = truncateIdempotencyKey(env.randomId());
      }
      const key = finalizeIdempotencyKey;
      const activeSessionId = sessionId;
      try {
        const result = await callables.finalize(activeSessionId, key);
        if (!destroyed) {
          finalizedState = { result, idempotencyKey: key };
          mode = "finalized";
        }
        return result;
      } catch (err) {
        if (!destroyed) {
          if (!isRecoverable(err)) {
            mode = "error";
          }
          finalizePromise = null;
        }
        throw err;
      }
    })();
    return finalizePromise;
  }

  async function getAttempt(attemptId?: string): Promise<AttemptSummary> {
    if (destroyed) {
      throw new Error("assessment runtime has been destroyed");
    }
    if (assignmentId === null) {
      throw new Error("assessment runtime is inert without assignment context");
    }
    let id = attemptId;
    if (!isNonEmptyString(id)) {
      if (finalizedState === null) {
        throw new Error("no attemptId available");
      }
      id = finalizedState.result.attemptId;
    }
    return callables.getAttempt(id);
  }

  function destroy(): void {
    destroyed = true;
    beginPromise = null;
    inflightAutosave = null;
    finalizePromise = null;
  }

  return {
    version,
    hasAssignmentContext: assignmentId !== null,
    getStatus: () => Object.freeze({ mode, hasAssignmentContext: assignmentId !== null }),
    begin,
    autosave,
    finalize,
    getAttempt,
    destroy,
  };
}

// Exported for the entry-point bootstrap so it can seed a fresh
// idempotency key on retries. Not part of the public runtime API.
export const __internal = {
  IDEMPOTENCY_KEY_MAX_LENGTH,
  truncateIdempotencyKey,
  isRecoverable,
};
