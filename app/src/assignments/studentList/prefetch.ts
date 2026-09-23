import type {
  AssignmentsListForStudentCallable,
  AssignmentsListForStudentResponse,
} from "./types";
import type {
  StudentResultsListCallable,
  StudentResultsListResponse,
} from "../studentResults/types";

// Latency optimization for the student landing (My Science).
//
// The two My Science reads (`assignmentsListForStudent`,
// `assessmentAttemptsList`) are independent of the session bootstrap's
// Firestore user-record read, but used to start only AFTER that bootstrap
// finished. When the locally cached ID token already carries the `student`
// role, both reads are started immediately, concurrently with the bootstrap.
//
// This is NOT an authorization decision. The claim only decides whether to
// START fetching early; both callables still authorize the caller entirely
// server-side, and the prefetched results are only ever handed to the My
// Science surface after the canonical bootstrap has independently resolved
// an `activeStudent` session for the SAME uid. Any other outcome (teacher,
// suspended, pending, different user, pending deep-link arrival) discards
// the prefetch unused. Nothing is cached beyond this single hand-off: the
// prefetched promise satisfies exactly the surface's FIRST read, and every
// later read (Retry, a return visit) calls the server again.

export type StudentPrefetch = {
  readonly uid: string;
  readonly assignments: Promise<AssignmentsListForStudentResponse>;
  readonly attempts: Promise<StudentResultsListResponse>;
};

export type StartStudentPrefetchDeps = {
  // Resolves the current auth user and its LOCALLY cached token claims
  // (no forced refresh), or null when signed out.
  readonly readCachedIdentity: () => Promise<{
    readonly uid: string;
    readonly claims: Readonly<Record<string, unknown>>;
  } | null>;
  // True when this bootstrap will not render My Science (e.g. a pending
  // `/app/a/{assignmentId}` deep-link arrival), so no prefetch is wasted.
  readonly skip: () => boolean;
  readonly createCallables: () => Promise<{
    readonly assignments: AssignmentsListForStudentCallable;
    readonly attempts: StudentResultsListCallable;
  }>;
};

export async function startStudentPrefetch(
  deps: StartStudentPrefetchDeps,
): Promise<StudentPrefetch | null> {
  if (deps.skip()) return null;
  let identity: Awaited<ReturnType<StartStudentPrefetchDeps["readCachedIdentity"]>>;
  try {
    identity = await deps.readCachedIdentity();
  } catch {
    return null;
  }
  if (identity === null || identity.claims.role !== "student") return null;
  let callables: Awaited<ReturnType<StartStudentPrefetchDeps["createCallables"]>>;
  try {
    callables = await deps.createCallables();
  } catch {
    return null;
  }
  const assignments = callables.assignments();
  const attempts = callables.attempts();
  // A prefetch that ends up unused must never surface as an unhandled
  // rejection; a consumer that does use it still observes the rejection
  // through the original promise.
  assignments.catch(() => undefined);
  attempts.catch(() => undefined);
  return { uid: identity.uid, assignments, attempts };
}

// Wraps a callable so its FIRST invocation returns an already-started
// request (when one exists) and every later invocation calls through.
export function withPrefetchedFirstCall<T>(
  callable: () => Promise<T>,
  prefetched: Promise<T> | null,
): () => Promise<T> {
  let pending = prefetched;
  return () => {
    if (pending !== null) {
      const first = pending;
      pending = null;
      return first;
    }
    return callable();
  };
}
