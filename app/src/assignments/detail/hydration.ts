import type { AssignmentsTeacherListCallable } from "./hydrate";
import type { AssignmentDetailRegistry } from "./registry";
import type { AssignmentDetailMetadata } from "./types";

// Performance Operation 1: nonblocking assignment-registry hydration.
//
// The entry point used to await `assignmentsTeacherList` before mounting the
// Teacher Workspace, so a slow enumeration blocked Classes. This controller
// runs that enumeration in the background, once per bootstrap generation, and
// publishes a readiness status so assignment-dependent regions can show a
// genuine loading state instead of reading a pending registry as empty.
//
// Integrity rules:
//   - A response is applied only while its request is still the newest one,
//     for the same context, and that bootstrap generation is still current.
//     The check runs BEFORE any registry mutation.
//   - A new generation clears the registry, so its contents always belong to
//     the current teacher, school, and generation (an account switch or a
//     same-user school change never inherits the previous context's rows).
//   - Metadata written by the lifecycle path (publish, close, reopen, draft
//     update) during a generation is newer than any enumeration response for
//     that generation, so hydration never overwrites those assignment ids.
//   - Lifecycle writes go through a writer bound to the context that was
//     active when the writer was created (before any asynchronous work
//     began). A completion that lands after the context changed (sign-out,
//     account switch, same-user school change, a newer bootstrap) touches
//     neither the registry nor the lifecycle conflict-tracking set.
//
// The registry stays in memory only; nothing here is persisted.

export type AssignmentRegistryStatus = "pending" | "ready" | "unavailable";

// Read-only view handed to surfaces through the assignment-detail seam.
export type AssignmentRegistryReadiness = {
  readonly status: () => AssignmentRegistryStatus;
  // Called on every status transition. Returns an unsubscribe function.
  readonly subscribe: (listener: () => void) => () => void;
  // Resolves once the registry is no longer pending (ready or unavailable).
  readonly settled: () => Promise<void>;
  // Re-requests enumeration after a failure. A no-op while pending or ready.
  readonly retry: () => void;
};

export type AssignmentRegistryHydrationContext = {
  readonly uid: string;
  readonly schoolId: string;
  readonly generation: number;
  // True while this bootstrap generation is still the active one.
  readonly isCurrent: () => boolean;
};

export type AssignmentRegistryHydration = AssignmentRegistryReadiness & {
  readonly start: (
    context: AssignmentRegistryHydrationContext,
    list: AssignmentsTeacherListCallable,
  ) => void;
  // Non-teacher bootstrap or sign-out: supersede any request, clear the
  // registry, and drop every subscriber.
  readonly reset: () => void;
  // Lifecycle write path. Returns a writer bound to the context active NOW;
  // capture it before starting asynchronous lifecycle work. The writer
  // returns false (and writes nothing) once that context is no longer the
  // active one. An accepted write always wins over enumeration in its
  // generation.
  readonly writer: () => (metadata: AssignmentDetailMetadata) => boolean;
  readonly readiness: AssignmentRegistryReadiness;
};

export function createAssignmentRegistryHydration(
  registry: AssignmentDetailRegistry,
): AssignmentRegistryHydration {
  // No teacher context means nothing is loading; the empty registry is the
  // whole truth until a teacher generation starts.
  let status: AssignmentRegistryStatus = "ready";
  let context: AssignmentRegistryHydrationContext | null = null;
  let fetchList: AssignmentsTeacherListCallable | null = null;
  let requestToken = 0;
  let lifecycleWritten = new Set<string>();
  const listeners = new Set<() => void>();
  let waiters: Array<() => void> = [];

  const releaseWaiters = (): void => {
    const pending = waiters;
    waiters = [];
    for (const resolve of pending) resolve();
  };

  const setStatus = (next: AssignmentRegistryStatus): void => {
    status = next;
    if (next !== "pending") releaseWaiters();
    for (const listener of Array.from(listeners)) {
      try {
        listener();
      } catch {
        // A surface listener never breaks hydration or other listeners.
      }
    }
  };

  const request = (): void => {
    const ctx = context;
    const list = fetchList;
    if (ctx === null || list === null) return;
    const token = ++requestToken;
    const isLive = (): boolean =>
      token === requestToken && context === ctx && ctx.isCurrent();
    if (status !== "pending") setStatus("pending");
    let response: Promise<ReadonlyArray<AssignmentDetailMetadata>>;
    try {
      response = list();
    } catch (err) {
      response = Promise.reject(err);
    }
    response.then(
      (items) => {
        if (!isLive()) return;
        for (const item of items) {
          if (lifecycleWritten.has(item.assignmentId)) continue;
          registry.register(item);
        }
        setStatus("ready");
      },
      () => {
        if (!isLive()) return;
        setStatus("unavailable");
      },
    );
  };

  const readiness: AssignmentRegistryReadiness = Object.freeze({
    status: () => status,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    settled: () =>
      status !== "pending"
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            waiters.push(resolve);
          }),
    retry: () => {
      if (status !== "unavailable") return;
      if (context === null || !context.isCurrent()) return;
      request();
    },
  });

  return Object.freeze({
    ...readiness,
    readiness,
    start: (next, list) => {
      // An already-superseded bootstrap context never installs anything: it
      // is rejected before the registry is cleared, the active context is
      // replaced, the status changes, subscribers are touched, or any
      // enumeration starts.
      if (!next.isCurrent()) return;
      // One enumeration per bootstrap generation: a repeated start for the
      // generation already in hand (navigation, remount) is ignored.
      if (context !== null && context.generation === next.generation) return;
      // Surfaces from the previous generation are already torn down; their
      // subscriptions must not observe the new context. Waiters carry over
      // and resolve when this generation settles.
      listeners.clear();
      registry.clear();
      lifecycleWritten = new Set<string>();
      context = next;
      fetchList = list;
      status = "pending";
      request();
    },
    reset: () => {
      requestToken += 1;
      context = null;
      fetchList = null;
      lifecycleWritten = new Set<string>();
      listeners.clear();
      registry.clear();
      status = "ready";
      releaseWaiters();
    },
    writer: () => {
      const origin = context;
      return (metadata) => {
        // All three before any mutation: the origin context exists, it is
        // still the controller's context, and its bootstrap generation is
        // still current. The last closes the window after a newer bootstrap
        // run began but before it installed its own context (start/reset).
        if (origin === null || context !== origin || !origin.isCurrent()) return false;
        lifecycleWritten.add(metadata.assignmentId);
        registry.register(metadata);
        return true;
      };
    },
  });
}
