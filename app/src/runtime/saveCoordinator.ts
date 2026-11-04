// Student autosave reliability: one save queue per lesson page.
//
// The page's selections and its Show Your Thinking text are two halves of
// ONE working state. Every change bumps a version; a single loop sends the
// LATEST state (both halves together), one write at a time, so an older save
// can never land after a newer one and a text save can never drop an answer
// (or the reverse). "Saved" is reported only once the backend has
// acknowledged the latest version.
//
// Failures: a transient failure is retried a bounded number of times with
// backoff, then reported as "failed" until the next change (or retryNow) starts
// the loop again. A permanent failure (the runtime refuses further calls until
// a reload) is reported as "blocked" and nothing more is sent. The page's own
// selections and text are never touched here.

import type { SessionResponse } from "./types";

export type SaveStatus =
  | "idle" // nothing to save yet
  | "pending" // a change is waiting (text debounce) or queued
  | "saving" // a write is in flight
  | "saved" // the backend acknowledged the latest change
  | "retrying" // a transient failure; another try is scheduled
  | "failed" // retries exhausted; the next change retries
  | "blocked"; // permanent failure; reload required

export type SaveResult = { readonly persisted: boolean } | null;

export type SaveCoordinatorOptions = {
  // Sends one complete working state. `writtenResponse` is undefined until the
  // page's text is known (typed or restored), so a save never erases text the
  // page has not seen.
  readonly send: (
    responses: readonly SessionResponse[],
    writtenResponse: string | undefined,
  ) => Promise<{ readonly persisted: boolean }>;
  readonly isPermanentFailure: (err: unknown) => boolean;
  readonly onStatus?: (status: SaveStatus) => void;
  readonly onError?: (err: unknown) => void;
  readonly textDebounceMs?: number;
  readonly retryDelaysMs?: readonly number[];
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (handle: unknown) => void;
};

export type SaveCoordinator = {
  // A selection change; saved immediately. Resolves with the outcome of the
  // first write that carries it (null when that write failed or was blocked).
  setResponses(responses: readonly SessionResponse[]): Promise<SaveResult>;
  // A text change; saved after the debounce.
  setWrittenResponse(text: string): void;
  // Text restored from the server: becomes the known text without a write.
  adoptWrittenResponse(text: string): void;
  // A new attempt starts from an empty page: forget the previous attempt's
  // state without sending anything.
  resetForNewAttempt(): void;
  // Sends any debounced change now (page hide, before submit).
  flush(): void;
  // Waits until no write is in flight and holds new writes until `resume`.
  pause(): Promise<void>;
  resume(): void;
  retryNow(): void;
  getStatus(): SaveStatus;
  hasUnsavedChanges(): boolean;
};

export const DEFAULT_TEXT_DEBOUNCE_MS = 1500;
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [2000, 5000, 10000];

type Waiter = { readonly version: number; readonly resolve: (r: SaveResult) => void };

export function createSaveCoordinator(options: SaveCoordinatorOptions): SaveCoordinator {
  const debounceMs = options.textDebounceMs ?? DEFAULT_TEXT_DEBOUNCE_MS;
  const retryDelays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer =
    options.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let responses: readonly SessionResponse[] = [];
  let writtenResponse: string | undefined;
  // `version` counts changes that must reach the server; `queued` is the
  // highest version released for sending (a debounced text change is counted
  // but not yet released); `acked` is the highest acknowledged version.
  let version = 0;
  let queued = 0;
  let acked = 0;
  let status: SaveStatus = "idle";
  let running = false;
  let paused = false;
  let blocked = false;
  let retryIndex = 0;
  let debounceHandle: unknown = null;
  let retryHandle: unknown = null;
  let idleWaiters: Array<() => void> = [];
  let waiters: Waiter[] = [];

  function setStatus(next: SaveStatus): void {
    if (status === next) return;
    status = next;
    try {
      options.onStatus?.(next);
    } catch {
      // A status sink must never break saving.
    }
  }

  function settleWaiters(upTo: number, result: SaveResult): void {
    const keep: Waiter[] = [];
    for (const w of waiters) {
      if (w.version <= upTo) w.resolve(result);
      else keep.push(w);
    }
    waiters = keep;
  }

  function notifyIdle(): void {
    const pending = idleWaiters;
    idleWaiters = [];
    for (const fn of pending) fn();
  }

  function clearRetry(): void {
    if (retryHandle !== null) {
      clearTimer(retryHandle);
      retryHandle = null;
    }
  }

  function kick(): void {
    if (running || paused || blocked || retryHandle !== null) return;
    if (acked >= queued) return;
    running = true;
    void loop();
  }

  async function loop(): Promise<void> {
    try {
      while (!paused && !blocked && acked < queued) {
        const sending = queued;
        const snapshotResponses = responses;
        const snapshotText = writtenResponse;
        setStatus("saving");
        try {
          const result = await options.send(snapshotResponses, snapshotText);
          acked = Math.max(acked, sending);
          retryIndex = 0;
          settleWaiters(sending, result);
        } catch (err) {
          try {
            options.onError?.(err);
          } catch {
            // Diagnostics only.
          }
          settleWaiters(sending, null);
          if (options.isPermanentFailure(err)) {
            blocked = true;
            settleWaiters(Number.POSITIVE_INFINITY, null);
            setStatus("blocked");
            return;
          }
          if (retryIndex < retryDelays.length) {
            const delay = retryDelays[retryIndex]!;
            retryIndex += 1;
            setStatus("retrying");
            retryHandle = setTimer(() => {
              retryHandle = null;
              kick();
            }, delay);
          } else {
            setStatus("failed");
          }
          return;
        }
      }
    } finally {
      running = false;
      if (!blocked && retryHandle === null && status !== "failed") {
        if (acked >= version) setStatus("saved");
        else if (debounceHandle !== null || paused) setStatus("pending");
      }
      if (!running) notifyIdle();
    }
  }

  function release(): void {
    queued = version;
    // A new change restarts a failed or retrying save from a fresh budget.
    if (status === "failed" || retryHandle !== null) {
      clearRetry();
      retryIndex = 0;
    }
    kick();
    if (!running && !blocked && acked < version) setStatus("pending");
  }

  function cancelDebounce(): void {
    if (debounceHandle !== null) {
      clearTimer(debounceHandle);
      debounceHandle = null;
    }
  }

  return {
    setResponses(next) {
      responses = next;
      if (blocked) return Promise.resolve(null);
      version += 1;
      const mine = version;
      // A pending text change rides along with this write.
      cancelDebounce();
      const result = new Promise<SaveResult>((resolve) => {
        waiters.push({ version: mine, resolve });
      });
      release();
      return result;
    },
    setWrittenResponse(text) {
      if (text === writtenResponse) return;
      writtenResponse = text;
      if (blocked) return;
      version += 1;
      cancelDebounce();
      if (!running) setStatus("pending");
      debounceHandle = setTimer(() => {
        debounceHandle = null;
        release();
      }, debounceMs);
    },
    adoptWrittenResponse(text) {
      writtenResponse = text;
    },
    resetForNewAttempt() {
      cancelDebounce();
      clearRetry();
      retryIndex = 0;
      responses = [];
      writtenResponse = undefined;
      acked = version;
      queued = version;
      settleWaiters(Number.POSITIVE_INFINITY, null);
      if (!blocked) setStatus("idle");
    },
    flush() {
      if (debounceHandle === null) return;
      cancelDebounce();
      release();
    },
    pause() {
      paused = true;
      cancelDebounce();
      if (!running) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
    resume() {
      paused = false;
      if (version > queued) queued = version;
      kick();
    },
    retryNow() {
      if (blocked) return;
      clearRetry();
      retryIndex = 0;
      queued = Math.max(queued, version);
      kick();
    },
    getStatus: () => status,
    hasUnsavedChanges: () => acked < version,
  };
}
