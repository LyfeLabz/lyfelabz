// Sprint 17 Slice 5: client-side shapes for the certified assessment
// runtime lifecycle. The types name only the fields the runtime consumes
// or forwards to lesson pages. Every ownership identifier the callables
// stamp onto the persisted records (studentId, teacherId, schoolId,
// districtId, classId, activityId, assessmentId, assessmentRevisionId,
// answer keys, teacher-only rollups) is intentionally excluded so the
// browser cannot silently grow a dependency on data the callable does
// not authorize to leave the backend.

// Session response tuple accepted by autosave and forwarded by finalize.
// The runtime never scores, never assigns correctness, and never
// interprets the response value. The backend rejects any scoring
// artifact per assessment-sessions-autosave FORBIDDEN_RESPONSE_KEYS.
export type SessionResponse = {
  readonly itemId: string;
  readonly response: unknown;
};

// Per-item feedback returned by the certified finalize + get callables.
// Fields mirror the certified projection; nothing else is available and
// nothing else may be added on the client boundary.
export type AttemptItemResult = {
  readonly itemId: string;
  readonly isCorrect: boolean;
  readonly pointsEarned: number;
  readonly correctOptionId: string;
  readonly explanation: string;
  readonly studentResponse: string | null;
};

export type FinalizeResult = {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly score: number;
  readonly maxScore: number;
  readonly percentage: number;
  readonly itemResults: readonly AttemptItemResult[];
  readonly replay: boolean;
};

export type AttemptSummary = {
  readonly attemptId: string;
  readonly attemptNumber: number;
  readonly score: number;
  readonly maxScore: number;
  readonly percentage: number;
  readonly itemResults: readonly AttemptItemResult[];
};

// Injected callable seams. Every backend call the runtime makes goes
// through one of these. Real implementations (entry.ts) forward to the
// certified callables; tests inject in-memory fakes so the orchestrator
// stays lesson-independent and Firebase-free.
export type BeginCallable = (
  assignmentId: string,
) => Promise<{ readonly sessionId: string; readonly alreadyLive: boolean }>;

export type AutosaveCallable = (
  sessionId: string,
  responses: readonly SessionResponse[],
) => Promise<{ readonly persisted: boolean }>;

export type FinalizeCallable = (
  sessionId: string,
  idempotencyKey: string,
) => Promise<FinalizeResult>;

export type GetAttemptCallable = (
  attemptId: string,
) => Promise<AttemptSummary>;

export type RuntimeCallables = {
  readonly begin: BeginCallable;
  readonly autosave: AutosaveCallable;
  readonly finalize: FinalizeCallable;
  readonly getAttempt: GetAttemptCallable;
};

export type RuntimeMode =
  | "inert"
  | "pending"
  | "active"
  | "finalized"
  | "error";

// Externally observable status projection. Deliberately narrow: no
// sessionId, no assignmentId, no ownership fields, and no error object
// leak out. Lessons and Slice 6 diagnostics need mode + a boolean flag,
// nothing more.
export type RuntimeStatus = {
  readonly mode: RuntimeMode;
  readonly hasAssignmentContext: boolean;
};

export type RuntimeEnv = {
  readonly randomId: () => string;
};
