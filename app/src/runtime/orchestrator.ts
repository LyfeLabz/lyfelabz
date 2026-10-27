import type {
  AssessmentRevisionVerifier,
  AttemptSummary,
  FinalizeResult,
  PersistedSessionState,
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
// byte-identical payloads, and finalize reuses a single per-attempt
// idempotencyKey so a retry after transport failure lines up with the
// certified idempotency contract in the finalize callable.
//
// New attempts. A committed finalize deletes the server session, so a second
// attempt on the same page needs a new session. `restart()` waits for the
// previous submission to settle, discards every per-attempt value (session,
// idempotency key, cached result, autosave baseline) and begins again; the
// next finalize then writes a new attempt under a new key. A repeated
// finalize with the SAME responses is still the cached duplicate; different
// responses after a submission are refused, never answered with the earlier
// attempt's success.

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
  autosave(
    responses: readonly SessionResponse[],
    writtenResponse?: string,
  ): Promise<{ readonly persisted: boolean }>;
  finalize(
    responses: readonly SessionResponse[],
    writtenResponse?: string,
  ): Promise<FinalizeResult>;
  getAttempt(attemptId?: string): Promise<AttemptSummary>;
  // True once finalize has been called for the current attempt (in flight,
  // settled, or failed) until `restart()` starts the next one.
  hasSubmittedAttempt(): boolean;
  restart(): Promise<void>;
  destroy(): void;
};

export type CreateAssessmentRuntimeInput = {
  readonly version: string;
  readonly assignmentId: string | null;
  // F5.2 §7.3/§8 (Slice 5): the opaque launch-grant reference detected from the
  // launch URL, transported verbatim to `assessmentSessionsBegin`. Present only
  // for an accommodated launch (differentiated or canonicalFallback); null
  // otherwise, which keeps canonical begins byte-identical. Slice 6 enforces it
  // server-side; the runtime only forwards it and never inspects its meaning.
  readonly launchRef?: string | null;
  readonly callables: RuntimeCallables;
  readonly env: RuntimeEnv;
  // F5.3 Slice 9D (addendum 21.4): the page-revision integrity check. When
  // supplied, begin's frozen revision must match the page before the session
  // becomes active; on a mismatch the runtime enters the non-recoverable error
  // state and NOTHING is autosaved or finalized (S9-U3). The server revision
  // is authority; page metadata only verifies it.
  readonly verifyAssessmentRevision?: AssessmentRevisionVerifier;
  // Quiz session continuity: receives the persisted responses a begin
  // returned and answers which of them this page can display (and may
  // restore them into the page). The returned set is the baseline every later
  // autosave/finalize keeps for items the page has not answered yet, so a
  // reloaded page can never replace persisted progress with a smaller set.
  // Omitted: every persisted response is kept. Throwing keeps none.
  readonly adoptPersisted?: (state: PersistedSessionState) => readonly SessionResponse[];
};

// F5.3 Slice 9D: the page does not display the assignment's frozen assessment
// revision. Non-recoverable for this page load; recovery is a fresh launch.
// The message is student-facing and carries no internal identifiers.
export const ASSESSMENT_REVISION_MISMATCH_MESSAGE =
  "This assignment needs to be opened again, so your answers were not submitted. Go back to My Science and open the assignment again.";

export class AssessmentRevisionIntegrityError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(ASSESSMENT_REVISION_MISMATCH_MESSAGE);
    this.name = "AssessmentRevisionIntegrityError";
    this.reason = reason;
  }
}

// A finalize whose responses differ from the attempt this runtime already
// submitted. Its result is never reused for the new answers; the student
// starts a new attempt instead. Student-facing, no internal identifiers.
export const ATTEMPT_ALREADY_SUBMITTED_MESSAGE =
  "This attempt was already submitted, so these answers were not sent. Select Try Again to start a new attempt, then submit again.";

export class AttemptAlreadySubmittedError extends Error {
  constructor() {
    super(ATTEMPT_ALREADY_SUBMITTED_MESSAGE);
    this.name = "AttemptAlreadySubmittedError";
  }
}

function truncateIdempotencyKey(raw: string): string {
  if (raw.length <= IDEMPOTENCY_KEY_MAX_LENGTH) return raw;
  return raw.slice(0, IDEMPOTENCY_KEY_MAX_LENGTH);
}

// Coalescing key. A selection-only payload serializes exactly as before;
// a payload carrying a written response also keys on its text.
function serialize(
  responses: readonly SessionResponse[],
  writtenResponse: string | undefined,
): string {
  if (writtenResponse === undefined) return JSON.stringify(responses);
  return JSON.stringify({ responses, writtenResponse });
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

// The Firebase client reports callable failures as `functions/<code>`
// (FunctionsError); fakes and older call sites use the bare code.
function callableErrorCode(err: unknown): string | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== "string") return undefined;
  return code.startsWith("functions/") ? code.slice("functions/".length) : code;
}

function isRecoverable(err: unknown): boolean {
  const code = callableErrorCode(err);
  return code !== undefined && RECOVERABLE_ERROR_CODES.includes(code);
}

export function createAssessmentRuntime(
  input: CreateAssessmentRuntimeInput,
): AssessmentRuntime {
  const { version, callables, env } = input;
  const assignmentId =
    isNonEmptyString(input.assignmentId) ? input.assignmentId : null;
  // Transport-only: forwarded verbatim to begin, never decoded or defaulted.
  const launchRef = isNonEmptyString(input.launchRef) ? input.launchRef : undefined;

  let mode: RuntimeMode = assignmentId === null ? "inert" : "pending";
  let destroyed = false;
  let sessionId: string | null = null;
  let beginPromise: Promise<void> | null = null;
  let lastAutosaveSerialized: string | null = null;
  let inflightAutosave: Promise<{ readonly persisted: boolean }> | null = null;
  let finalizeIdempotencyKey: string | null = null;
  let finalizePromise: Promise<FinalizeResult> | null = null;
  let finalizedState: FinalizedState | null = null;
  let integrityError: AssessmentRevisionIntegrityError | null = null;
  // The refusal that moved the runtime to `error`, rethrown by later calls so
  // the lesson reports the actual cause rather than a generic guard error.
  let fatalError: unknown = null;
  // Serialized responses of the current attempt's finalize; set when finalize
  // is called and cleared by `restart()`.
  let submittedPayload: string | null = null;
  let restartPromise: Promise<void> | null = null;
  // A new attempt starts from an empty page, so its begin must not restore the
  // previous attempt's answers into it.
  let adoptOnBegin = true;
  // Persisted responses this page adopted from the Live session (see
  // `adoptPersisted`). Cleared once the session is finalized.
  let persisted: readonly SessionResponse[] = [];

  function enterError(err: unknown): void {
    mode = "error";
    fatalError = err;
  }

  function errorStateError(): unknown {
    return integrityError ?? fatalError ?? new Error("assessment runtime is in an error state");
  }

  // Only yields while a restart is pending, so a call made with none pending
  // claims its attempt synchronously (before a same-tick restart can look).
  async function settledRestart(): Promise<void> {
    await restartPromise?.catch(() => undefined);
  }

  function adoptPersisted(state: PersistedSessionState): void {
    if (state.responses.length === 0) {
      persisted = [];
      return;
    }
    try {
      persisted =
        input.adoptPersisted === undefined
          ? state.responses
          : input.adoptPersisted(state);
    } catch {
      persisted = [];
    }
  }

  // The page's current responses plus every adopted persisted response for an
  // item the page has not answered. The page's own answer always wins.
  function withPersisted(
    responses: readonly SessionResponse[],
  ): readonly SessionResponse[] {
    if (persisted.length === 0) return responses;
    const answered = new Set(responses.map((r) => r.itemId));
    const missing = persisted.filter((r) => !answered.has(r.itemId));
    return missing.length === 0 ? responses : [...responses, ...missing];
  }

  function verifyRevision(serverRevision: unknown): void {
    if (input.verifyAssessmentRevision === undefined) return;
    const verdict = input.verifyAssessmentRevision(
      isNonEmptyString(serverRevision) ? serverRevision : undefined,
    );
    if (!verdict.ok) {
      integrityError = new AssessmentRevisionIntegrityError(verdict.reason);
      mode = "error";
      throw integrityError;
    }
  }

  function guardActive(): void {
    if (destroyed) {
      throw new Error("assessment runtime has been destroyed");
    }
    if (assignmentId === null) {
      throw new Error("assessment runtime is inert without assignment context");
    }
    if (mode === "error") {
      throw errorStateError();
    }
  }

  async function ensureBegun(): Promise<void> {
    if (mode === "active" || mode === "finalized") return;
    if (mode === "error") {
      throw errorStateError();
    }
    if (assignmentId === null) return;
    if (beginPromise !== null) {
      await beginPromise;
      return;
    }
    beginPromise = (async (): Promise<void> => {
      try {
        const outcome = await callables.begin(assignmentId, launchRef);
        if (destroyed) return;
        if (!isNonEmptyString(outcome.sessionId)) {
          throw new Error("callable returned an empty sessionId");
        }
        // F5.3 Slice 9D: the integrity gate runs BEFORE the session becomes
        // active, so no autosave or finalize can be sent for a page that does
        // not display the frozen revision.
        verifyRevision(outcome.assessmentRevisionId);
        sessionId = outcome.sessionId;
        mode = "active";
        if (adoptOnBegin) {
          adoptPersisted({
            responses: outcome.responses ?? [],
            ...(isNonEmptyString(outcome.assessmentPresentationRevisionId)
              ? { assessmentPresentationRevisionId: outcome.assessmentPresentationRevisionId }
              : {}),
          });
        }
      } catch (err) {
        if (err instanceof AssessmentRevisionIntegrityError) throw err;
        if (!destroyed) {
          if (!isRecoverable(err)) {
            enterError(err);
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
      throw errorStateError();
    }
    await ensureBegun();
  }

  async function autosave(
    responses: readonly SessionResponse[],
    writtenResponse?: string,
  ): Promise<{ readonly persisted: boolean }> {
    if (destroyed) return { persisted: false };
    if (assignmentId === null) return { persisted: false };
    if (restartPromise !== null) await settledRestart();
    return writeAutosave(responses, writtenResponse);
  }

  // The autosave body. finalize calls it directly: a restart waits for an
  // in-flight finalize, so finalize must not in turn wait for the restart.
  async function writeAutosave(
    responses: readonly SessionResponse[],
    writtenResponse: string | undefined,
  ): Promise<{ readonly persisted: boolean }> {
    if (destroyed) return { persisted: false };
    if (mode === "finalized") return { persisted: false };
    guardActive();
    await ensureBegun();
    if (sessionId === null) {
      throw new Error("session was not established");
    }
    const payload = withPersisted(responses);
    const serialized = serialize(payload, writtenResponse);
    if (lastAutosaveSerialized === serialized) {
      return { persisted: false };
    }
    if (inflightAutosave !== null) {
      await inflightAutosave;
    }
    const activeSessionId = sessionId;
    inflightAutosave = (async () => {
      try {
        const result =
          writtenResponse === undefined
            ? await callables.autosave(activeSessionId, payload)
            : await callables.autosave(activeSessionId, payload, writtenResponse);
        if (!destroyed) {
          lastAutosaveSerialized = serialized;
        }
        return result;
      } catch (err) {
        if (!destroyed && !isRecoverable(err)) {
          enterError(err);
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
    writtenResponse?: string,
  ): Promise<FinalizeResult> {
    if (destroyed) {
      throw new Error("assessment runtime has been destroyed");
    }
    if (assignmentId === null) {
      throw new Error("assessment runtime is inert without assignment context");
    }
    if (restartPromise !== null) await settledRestart();
    if (mode === "error") {
      throw errorStateError();
    }
    // A duplicate submit of the same answers shares the one finalize (cached
    // or in flight). Different answers after a submission belong to a new
    // attempt and must never be answered with this attempt's result.
    const requestPayload = serialize(responses, writtenResponse);
    if (finalizedState !== null || finalizePromise !== null) {
      if (submittedPayload !== requestPayload) {
        throw new AttemptAlreadySubmittedError();
      }
      if (finalizedState !== null) return finalizedState.result;
      if (finalizePromise !== null) return finalizePromise;
    }
    // A retry after a failed finalize reuses the key only for the same
    // answers, so a commit whose response was lost replays as that attempt
    // and never as the result for different answers.
    if (submittedPayload !== null && submittedPayload !== requestPayload) {
      finalizeIdempotencyKey = null;
    }
    submittedPayload = requestPayload;
    finalizePromise = (async (): Promise<FinalizeResult> => {
      await ensureBegun();
      if (sessionId === null) {
        throw new Error("session was not established");
      }
      // Ensure the last autosaved payload matches the responses about to
      // be finalized so the certified scorer reads the caller's intended
      // responses out of the session document. Byte-identical payload is
      // coalesced by the autosave path; only a real change makes a
      // second write. The Show Your Thinking text rides the same final
      // autosave so finalize freezes it from the session onto the attempt.
      await writeAutosave(responses, writtenResponse);
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
          persisted = [];
        }
        return result;
      } catch (err) {
        if (!destroyed) {
          if (!isRecoverable(err)) {
            enterError(err);
          }
          finalizePromise = null;
        }
        throw err;
      }
    })();
    return finalizePromise;
  }

  // Starts a genuine new attempt (see the header). An integrity or other
  // non-recoverable error is terminal for this page load and is rethrown.
  async function restart(): Promise<void> {
    if (destroyed) return;
    if (assignmentId === null) return;
    // Concurrent callers (several quick answers) share one restart.
    let pending = restartPromise;
    if (pending === null) {
      const run = (async (): Promise<void> => {
        // The previous attempt's submission settles first, so its outcome is
        // never attributed to the new attempt.
        if (finalizePromise !== null) await finalizePromise.catch(() => undefined);
        if (inflightAutosave !== null) await inflightAutosave.catch(() => undefined);
        if (destroyed) return;
        if (mode === "error") throw errorStateError();
        // A committed finalize deleted the session; an uncommitted one may
        // still be Live. Either way begin answers with the deterministic
        // session id (a new session, or an idempotent replay of the live one).
        sessionId = null;
        beginPromise = null;
        mode = "pending";
        finalizeIdempotencyKey = null;
        finalizePromise = null;
        finalizedState = null;
        submittedPayload = null;
        lastAutosaveSerialized = null;
        persisted = [];
        adoptOnBegin = false;
        await ensureBegun();
      })();
      restartPromise = run;
      pending = run;
      void run
        .catch(() => undefined)
        .then(() => {
          if (restartPromise === run) restartPromise = null;
        });
    }
    await pending;
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
    restartPromise = null;
  }

  return {
    version,
    hasAssignmentContext: assignmentId !== null,
    getStatus: () => Object.freeze({ mode, hasAssignmentContext: assignmentId !== null }),
    begin,
    autosave,
    finalize,
    getAttempt,
    hasSubmittedAttempt: () => submittedPayload !== null,
    restart,
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

// Shared with the lesson adapter so both classify callable failures alike.
export { isRecoverable as isRecoverableCallableError };
