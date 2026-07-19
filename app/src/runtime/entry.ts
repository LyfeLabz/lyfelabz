import { getApps, initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, onAuthStateChanged } from "firebase/auth";
import type { User } from "firebase/auth";
import {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} from "firebase/functions";
import type { Functions } from "firebase/functions";

import { createAssessmentRuntime } from "./orchestrator";
import type { AssessmentRuntime } from "./orchestrator";
import type {
  AttemptItemResult,
  AttemptSummary,
  FinalizeResult,
  RuntimeCallables,
  SessionResponse,
} from "./types";

// Sprint 17 Slice 5 browser entry point for the certified assessment
// runtime. Bundled via esbuild into the single canonical asset served
// on every instructional page.
//
// This entry:
//   1. Detects the assignment context handed off by the certified
//      launcher (Sprint 17 Slice 4: `?assignment=<id>`).
//   2. In standalone mode (no assignment context), remains inert: no
//      Firebase initialization, no auth listener, no network traffic.
//   3. In assignment mode, initializes Firebase against the same
//      configuration the authenticated app shell uses, waits for the
//      Firebase Auth session that the certified sign-in flow (Slice 3)
//      already persisted, and installs the orchestrator on
//      window.lyfelabz.assessmentRuntime.
//
// The entry point never scores, never reads answer keys, never touches
// Firestore directly, never carries lesson-specific logic, and never
// exposes teacher-only data or backend identifiers beyond the minimum
// the certified callable responses already project.

const VERSION = "17.5.0";
const NAMESPACE = "lyfelabz";
const RUNTIME_KEY = "assessmentRuntime";
const LESSON_QUIZ_KEY = "lessonQuiz";
const OPTION_LETTERS = ["A", "B", "C", "D"] as const;

// Family A lesson-quiz adapter surface. Every Family A lesson
// (single-choice quiz, index-based selection state, A/B/C/D letters) is
// wired to the certified backend through this narrow helper so lessons
// never duplicate the response-shape mapping or the hasAssignmentContext
// guard. The types are declared here (not in `types.ts`) because they
// are not part of the certified callable contract; they are the pilot
// pattern the pilot lesson and every Slice-6 rollout lesson consume.
type LessonAutosaveResult = { readonly persisted: boolean } | null;
type LessonFinalizeResult =
  | { readonly ok: true; readonly result: FinalizeResult }
  | { readonly ok: false; readonly message: string; readonly recoverable: boolean }
  | null;
type LessonQuizGlobal = {
  readonly version: string;
  readonly optionLetters: readonly string[];
  hasAssignmentContext(): boolean;
  mapIndexSelectionsToResponses(
    indexSelections: ReadonlyArray<number | null | undefined>,
  ): readonly SessionResponse[];
  autosave(
    indexSelections: ReadonlyArray<number | null | undefined>,
  ): Promise<LessonAutosaveResult>;
  finalize(
    indexSelections: ReadonlyArray<number | null | undefined>,
  ): Promise<LessonFinalizeResult>;
};

import { getFirebaseClientConfig, isEmulatorHost as detectEmulatorHost } from "../firebase-config";

// Sprint 17 Slice 6: the runtime consumes the same shared client config
// module as the authenticated app shell (app/src/firebase.ts). Emulator
// hosts continue to receive the emulator-friendly placeholder; production
// hosts receive the injected certified project configuration. Neither
// the API key nor any other secret is embedded in this bundle.

type RuntimeGlobal = {
  version: string;
  mode: string;
  hasAssignmentContext: boolean;
  begin: () => Promise<void>;
  autosave: (responses: readonly SessionResponse[]) => Promise<{ readonly persisted: boolean }>;
  finalize: (responses: readonly SessionResponse[]) => Promise<FinalizeResult>;
  getAttempt: (attemptId?: string) => Promise<AttemptSummary>;
};

type WindowWithRuntime = Window & {
  [NAMESPACE]?: {
    [RUNTIME_KEY]?: RuntimeGlobal;
    [LESSON_QUIZ_KEY]?: LessonQuizGlobal;
  };
};

function mapIndexSelectionsToResponses(
  indexSelections: ReadonlyArray<number | null | undefined>,
): readonly SessionResponse[] {
  if (!indexSelections || typeof indexSelections.length !== "number") return [];
  const out: SessionResponse[] = [];
  for (let qi = 0; qi < indexSelections.length; qi++) {
    const idx = indexSelections[qi];
    if (idx === null || idx === undefined) continue;
    if (typeof idx !== "number" || idx < 0 || idx >= OPTION_LETTERS.length) continue;
    out.push({ itemId: `q${qi + 1}`, response: OPTION_LETTERS[idx]! });
  }
  return out;
}

// The lesson helper is a thin normalizer: pure mapping + soft error
// envelope. Recoverable Firebase errors surface `{ok:false,recoverable:true}`
// so the lesson can prompt the student to retry without a full reload.
// Non-recoverable errors surface `{ok:false,recoverable:false}` so the
// lesson can move on. Neither branch throws; lessons never need try/catch.
function isRecoverableFirebaseError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  if (typeof code !== "string") return false;
  return (
    code === "unavailable" ||
    code === "internal" ||
    code === "deadline-exceeded" ||
    code === "resource-exhausted" ||
    code === "cancelled"
  );
}

function installLessonQuiz(
  win: WindowWithRuntime,
  runtime: AssessmentRuntime | null,
): void {
  const helper: LessonQuizGlobal = {
    version: VERSION,
    optionLetters: OPTION_LETTERS,
    hasAssignmentContext: () => runtime !== null && runtime.hasAssignmentContext,
    mapIndexSelectionsToResponses,
    autosave: async (indexSelections) => {
      if (runtime === null || !runtime.hasAssignmentContext) return null;
      const responses = mapIndexSelectionsToResponses(indexSelections);
      if (responses.length === 0) return null;
      try {
        return await runtime.autosave(responses);
      } catch {
        // Autosave failure is soft by design (byte-identical coalesce
        // and later autosaves recover the payload). Do not surface it
        // to the lesson UX.
        return null;
      }
    },
    finalize: async (indexSelections) => {
      if (runtime === null || !runtime.hasAssignmentContext) return null;
      const responses = mapIndexSelectionsToResponses(indexSelections);
      try {
        const result = await runtime.finalize(responses);
        return { ok: true, result };
      } catch (err) {
        const message = (err as { message?: unknown }).message;
        return {
          ok: false,
          message: typeof message === "string" ? message : "submission failed",
          recoverable: isRecoverableFirebaseError(err),
        };
      }
    },
  };
  const ns = win[NAMESPACE] ?? {};
  ns[LESSON_QUIZ_KEY] = helper;
  win[NAMESPACE] = ns;
}

function detectAssignmentId(win: Window): string | null {
  try {
    const search = win.location.search ?? "";
    if (search.length > 0) {
      const params = new URLSearchParams(search);
      const raw = params.get("assignment");
      if (typeof raw === "string" && raw.length > 0) return raw;
    }
    const hash = win.location.hash ?? "";
    if (hash.length > 0) {
      const hashParams = new URLSearchParams(
        hash.startsWith("#") ? hash.slice(1) : hash,
      );
      const raw = hashParams.get("assignment");
      if (typeof raw === "string" && raw.length > 0) return raw;
    }
  } catch {
    return null;
  }
  return null;
}

function isEmulatorHost(win: Window): boolean {
  return detectEmulatorHost(win);
}

function waitForUser(auth: ReturnType<typeof getAuth>): Promise<User | null> {
  return new Promise((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        unsubscribe();
        resolve(user);
      },
      (err) => {
        unsubscribe();
        reject(err);
      },
    );
  });
}

// Callable-response narrowing. The certified callables return the shapes
// established by the finalize/get contracts; a hostile or degraded server
// response is rejected at the client boundary so a malformed payload can
// not silently propagate to lesson code.
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function parseItemResult(raw: unknown): AttemptItemResult | null {
  if (!isRecord(raw)) return null;
  const {
    itemId,
    isCorrect,
    pointsEarned,
    correctOptionId,
    explanation,
    studentResponse,
  } = raw;
  if (typeof itemId !== "string" || itemId.length === 0) return null;
  if (typeof isCorrect !== "boolean") return null;
  if (typeof pointsEarned !== "number" || !Number.isFinite(pointsEarned)) return null;
  if (typeof correctOptionId !== "string") return null;
  if (typeof explanation !== "string") return null;
  if (studentResponse !== null && typeof studentResponse !== "string") return null;
  return {
    itemId,
    isCorrect,
    pointsEarned,
    correctOptionId,
    explanation,
    studentResponse,
  };
}

function parseItemResults(raw: unknown): readonly AttemptItemResult[] {
  if (!Array.isArray(raw)) return [];
  const out: AttemptItemResult[] = [];
  for (const entry of raw) {
    const item = parseItemResult(entry);
    if (item !== null) out.push(item);
  }
  return out;
}

function parseFinalizeResult(raw: unknown): FinalizeResult {
  if (!isRecord(raw)) throw new Error("finalize returned an invalid payload");
  const { attemptId, attemptNumber, score, maxScore, percentage, replay } = raw;
  if (typeof attemptId !== "string" || attemptId.length === 0) {
    throw new Error("finalize returned an invalid attemptId");
  }
  if (typeof attemptNumber !== "number" || !Number.isFinite(attemptNumber)) {
    throw new Error("finalize returned an invalid attemptNumber");
  }
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error("finalize returned an invalid score");
  }
  if (typeof maxScore !== "number" || !Number.isFinite(maxScore)) {
    throw new Error("finalize returned an invalid maxScore");
  }
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) {
    throw new Error("finalize returned an invalid percentage");
  }
  return {
    attemptId,
    attemptNumber,
    score,
    maxScore,
    percentage,
    itemResults: parseItemResults(raw.itemResults),
    replay: replay === true,
  };
}

function parseAttemptSummary(raw: unknown): AttemptSummary {
  const attempt = isRecord(raw) && isRecord(raw.attempt) ? raw.attempt : raw;
  if (!isRecord(attempt)) throw new Error("getAttempt returned an invalid payload");
  const { attemptId, attemptNumber, score, maxScore, percentage } = attempt;
  if (typeof attemptId !== "string" || attemptId.length === 0) {
    throw new Error("getAttempt returned an invalid attemptId");
  }
  if (typeof attemptNumber !== "number" || !Number.isFinite(attemptNumber)) {
    throw new Error("getAttempt returned an invalid attemptNumber");
  }
  if (typeof score !== "number" || !Number.isFinite(score)) {
    throw new Error("getAttempt returned an invalid score");
  }
  if (typeof maxScore !== "number" || !Number.isFinite(maxScore)) {
    throw new Error("getAttempt returned an invalid maxScore");
  }
  if (typeof percentage !== "number" || !Number.isFinite(percentage)) {
    throw new Error("getAttempt returned an invalid percentage");
  }
  return {
    attemptId,
    attemptNumber,
    score,
    maxScore,
    percentage,
    itemResults: parseItemResults(attempt.itemResults),
  };
}

function createBackedCallables(functions: Functions): RuntimeCallables {
  const begin = httpsCallable(functions, "assessmentSessionsBegin");
  const autosave = httpsCallable(functions, "assessmentSessionsAutosave");
  const finalize = httpsCallable(functions, "assessmentAttemptsFinalize");
  const getAttempt = httpsCallable(functions, "assessmentAttemptGet");
  return {
    begin: async (assignmentId) => {
      const res = await begin({ assignmentId });
      const data = isRecord(res.data) ? res.data : {};
      const sessionId = data.sessionId;
      if (typeof sessionId !== "string" || sessionId.length === 0) {
        throw new Error("begin returned an invalid sessionId");
      }
      return { sessionId, alreadyLive: data.alreadyLive === true };
    },
    autosave: async (sessionId, responses) => {
      const res = await autosave({ sessionId, responses });
      const data = isRecord(res.data) ? res.data : {};
      return { persisted: data.persisted === true };
    },
    finalize: async (sessionId, idempotencyKey) => {
      const res = await finalize({ sessionId, idempotencyKey });
      return parseFinalizeResult(res.data);
    },
    getAttempt: async (attemptId) => {
      const res = await getAttempt({ attemptId });
      return parseAttemptSummary(res.data);
    },
  };
}

function randomIdempotencyKey(): string {
  const crypto = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (crypto && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID().replace(/-/g, "");
  }
  const rand = Math.random().toString(36).slice(2);
  return `ik${Date.now().toString(36)}${rand}`;
}

function installInertRuntime(win: WindowWithRuntime, hasContext: boolean): RuntimeGlobal {
  const runtime: RuntimeGlobal = {
    version: VERSION,
    mode: hasContext ? "pending" : "inert",
    hasAssignmentContext: hasContext,
    begin: async () => {},
    autosave: async () => ({ persisted: false }),
    finalize: async () => {
      throw new Error("assessment runtime is not yet available");
    },
    getAttempt: async () => {
      throw new Error("assessment runtime is not yet available");
    },
  };
  const ns = win[NAMESPACE] ?? {};
  ns[RUNTIME_KEY] = runtime;
  win[NAMESPACE] = ns;
  installLessonQuiz(win, null);
  return runtime;
}

function attachRuntimeAdapter(
  win: WindowWithRuntime,
  runtime: AssessmentRuntime,
): void {
  const wrapper: RuntimeGlobal = {
    version: runtime.version,
    get mode() {
      return runtime.getStatus().mode;
    },
    hasAssignmentContext: runtime.hasAssignmentContext,
    begin: () => runtime.begin(),
    autosave: (responses) => runtime.autosave(responses),
    finalize: (responses) => runtime.finalize(responses),
    getAttempt: (attemptId) => runtime.getAttempt(attemptId),
  };
  const ns = win[NAMESPACE] ?? {};
  ns[RUNTIME_KEY] = wrapper;
  win[NAMESPACE] = ns;
  installLessonQuiz(win, runtime);
}

async function bootstrap(win: Window): Promise<void> {
  const assignmentId = detectAssignmentId(win);
  const runtimeWin = win as WindowWithRuntime;

  if (assignmentId === null) {
    installInertRuntime(runtimeWin, false);
    return;
  }

  installInertRuntime(runtimeWin, true);

  const existingApp = getApps()[0];
  const app = existingApp ?? initializeApp(getFirebaseClientConfig(win));
  const auth = getAuth(app);
  const functions = getFunctions(app);

  if (isEmulatorHost(win)) {
    try {
      connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    } catch {
      // Already connected on a prior init.
    }
    try {
      connectFunctionsEmulator(functions, "127.0.0.1", 5001);
    } catch {
      // Already connected on a prior init.
    }
  }

  const user = await waitForUser(auth);
  if (user === null) {
    // No authenticated student. Leave the inert stub in place so
    // callers observe a stable API surface; the assignment launcher is
    // responsible for routing unauthenticated visitors through the
    // certified sign-in flow.
    return;
  }

  const callables = createBackedCallables(functions);
  const runtime = createAssessmentRuntime({
    version: VERSION,
    assignmentId,
    callables,
    env: { randomId: randomIdempotencyKey },
  });
  attachRuntimeAdapter(runtimeWin, runtime);
}

// Fire the bootstrap immediately. The IIFE bundle produced by esbuild
// executes synchronously on <script> load; the async body only awaits
// Firebase auth state resolution. Errors during bootstrap are swallowed
// after being logged so a Firebase runtime failure never prevents the
// standalone lesson experience from rendering.
if (typeof window !== "undefined") {
  const w = window as WindowWithRuntime;
  const existing = w[NAMESPACE]?.[RUNTIME_KEY];
  if (!existing || existing.version !== VERSION) {
    void bootstrap(window).catch((err) => {
      try {
        // eslint-disable-next-line no-console
        console.warn("[lyfelabz] assessment runtime bootstrap failed", err);
      } catch {
        // ignore
      }
    });
  }
}
