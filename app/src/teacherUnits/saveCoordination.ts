// U2.1 - small save-coordination helpers for future U2 controllers.
// Firebase-free. Not a state-management framework.
//
// Provided here:
// - `createMutationGate`: at most one in-flight mutation per key. Use the
//   unitId for single-unit mutations and `grade:<g>` for unit ordering.
// - `createUnitCreateCoordinator`: one idempotency key per intended unit,
//   pinned to its payload and teacher/school context, discarded only after
//   a confirmed creation or a confirmed pre-commit rejection.
// - `runTeacherUnitMutation`: runs one mutation and returns either the
//   authoritative server result (no-op included, as success) or a
//   normalized error. It never retries or replays on its own.
//
// Left to the U2.2/U2.3 UI controllers: adopting the returned state into
// their view, issuing the refresh (get/list) after a conflict, preserving
// unsaved form contents, and disabling controls while a key is busy.

import { generateClassId } from "../classes/classId";
import {
  isSafeToResend,
  normalizeTeacherUnitError,
  type TeacherUnitError,
  type TeacherUnitRecovery,
} from "./errors";
import type { TeacherUnit, TeacherUnitGrade, TeacherUnitsCallables } from "./types";

export type MutationGate = {
  readonly isBusy: (key: string) => boolean;
  // Runs `fn` when `key` is idle; returns null without calling it when busy.
  readonly run: <T>(key: string, fn: () => Promise<T>) => Promise<T> | null;
};

export function createMutationGate(): MutationGate {
  const busy = new Set<string>();
  return Object.freeze({
    isBusy: (key: string) => busy.has(key),
    run: <T>(key: string, fn: () => Promise<T>): Promise<T> | null => {
      if (busy.has(key)) return null;
      busy.add(key);
      let p: Promise<T>;
      try {
        p = fn();
      } catch (err) {
        busy.delete(key);
        return Promise.reject(err);
      }
      return p.finally(() => {
        busy.delete(key);
      });
    },
  });
}

export function gradeOrderGateKey(grade: string): string {
  return `grade:${grade}`;
}

export type MutationOutcome<T> =
  | { readonly ok: true; readonly result: T }
  | {
      readonly ok: false;
      readonly error: TeacherUnitError;
      // Revision-guarded mutations only: true for network/unexpected
      // failures, where re-sending the identical request is safe. The caller
      // decides; nothing is resent here. Never used for create keys.
      readonly canResend: boolean;
    };

export async function runTeacherUnitMutation<T>(fn: () => Promise<T>): Promise<MutationOutcome<T>> {
  try {
    return Object.freeze({ ok: true as const, result: await fn() });
  } catch (err) {
    const error = normalizeTeacherUnitError(err);
    return Object.freeze({ ok: false as const, error, canResend: isSafeToResend(error) });
  }
}

// Reuses the shared firebase-free URL-safe id generator (20 characters of
// [a-z0-9], crypto.getRandomValues), which satisfies the server key grammar
// `[A-Za-z0-9_-]{8,64}`.
export function defaultMintIdempotencyKey(): string {
  return generateClassId();
}

// ---------- Create attempts ----------
//
// Server facts (platform/functions/src/teacherUnits/teacher-units-create.ts):
// - Request validation (grade, title, description, key grammar) runs before
//   any transaction. A validation refusal therefore proves nothing was
//   written and no receipt exists for the key.
// - The unit and its receipt commit atomically. The response is then read
//   in a SECOND authorized snapshot, so the call can fail with an
//   account/context refusal or `notFound` AFTER the unit exists.
// - Retrying the same key with the same normalized payload, under the same
//   teacher and school, replays the original unit (`replayed: true`).
// - `writeConflict` on create means contention; the server asks for a
//   retry with the same key.
// - `idempotencyKeyConflict` means the key's receipt belongs to a different
//   payload. Since this coordinator pins the payload to the key, that is
//   unexpected; it is kept unresolved rather than silently replaced.
//
// So the key is discarded only after a CONFIRMED creation or a CONFIRMED
// pre-commit rejection. Every other outcome leaves the attempt unresolved
// with its original key, payload, and teacher/school context. Nothing is
// ever resent automatically; the caller must call `reconcile` (same key,
// same payload, same context) or `abandon` (explicit new-unit intent).
//
// Lifecycle (one coordinator per create form):
//
//   idle --submit--> inFlight --> created | rejected | unresolved
//   unresolved --reconcile--> inFlight
//   unresolved --abandon--> abandoned
//   rejected --submit--> inFlight          (corrected form; see below)
//   created | abandoned | rejected --beginNewUnit--> idle
//
// - After `created`, a repeated `submit` is refused: a second unit needs an
//   explicit `beginNewUnit()` (new-unit intent). A double-clicked or
//   re-submitted completed form can never create a second unit.
// - After `abandon`, the abandoned attempt (key, payload, context, reason)
//   is kept in the `abandoned` state so the UI can warn that the unit may
//   already exist; a new create still needs `beginNewUnit()`.
// - `rejected` may `submit` again directly: a pre-commit validation refusal
//   proves no unit and no receipt exist, so a corrected form with a new key
//   cannot duplicate anything.
//
// Session-context contract. The coordinator never accepts a teacher/school
// context from a caller argument. It calls the injected
// `readSessionContext()` immediately before EVERY dispatch (submit and
// reconcile), and the U2.2 controller must implement that reader from the
// live canonical session (the current activeTeacher `uid` and `schoolId`),
// not from a value captured when the form opened. The coordinator then:
// - pins the context read at first dispatch to the attempt;
// - refuses to dispatch when the reader returns nothing (`noSession`);
// - refuses to reconcile when the current context differs from the pinned
//   one (`contextMismatch`), so an account or school switch can never replay
//   the key under a different receipt scope (which would create a new unit).
// Limits: this is a client-side consistency check, not proof of the current
// Firebase account. The reader can only be as fresh as the session state it
// reads, and the Firebase ID token actually sent with the callable is chosen
// by the Firebase SDK, not by this module. The server remains authoritative
// for identity, school, and receipt scope. `reauthorized: true` is likewise
// only the caller's acknowledgement that it re-established the session; it
// is not verified here.
//
// Durable recovery (U2.2). U2.1 kept coordinator state in memory only.
// U2.2 adds two optional hooks, `persistence` and `restore` (see
// `CreateAttemptPersistence` below); a caller that passes neither gets the
// certified U2.1 behavior unchanged. The original requirement:
// U2.2 MUST implement durable recovery for unresolved or interrupted create
// attempts across navigation, controller replacement and browser reload.
// The original idempotency key, exact payload, originating teacher/school
// context and attempt status must be preserved before dispatch. An
// interrupted in-flight request must be treated as potentially committed.
// No new key may be silently minted for the same intent.

export type TeacherUnitCreatePayload = {
  readonly grade: TeacherUnitGrade;
  readonly title: string;
  readonly description: string;
};

// The canonical session identity a create is dispatched under
// (activeTeacher session `uid` and `schoolId`). Receipts are scoped to it.
export type TeacherUnitCreateContext = {
  readonly teacherId: string;
  readonly schoolId: string;
};

// Must read the CURRENT canonical session at call time. Returns null when
// there is no active teacher session.
export type ReadTeacherUnitCreateContext = () => TeacherUnitCreateContext | null;

export type UnresolvedCreateReason =
  // Network, timeout, malformed response, or unknown failure.
  | "uncertain"
  // Account or context refusal; may have followed a committed create.
  | "unauthorized"
  // `notFound` from the post-commit read or replay.
  | "notFound"
  // Create contention; the server asks for a same-key retry.
  | "contention"
  // The key is already bound to a different payload.
  | "idempotencyKeyConflict"
  // U2.2: a restored attempt older than the replay window
  // (`CREATE_ATTEMPT_REPLAY_WINDOW_MS`). The server receipt may be gone, so
  // a same-key resend could create a second unit; reconciliation is
  // disabled and the teacher checks the authoritative list instead.
  | "replayExpired"
  // U2.2: a same-key RESEND was refused by pre-commit validation. That
  // refusal says nothing about the original dispatch (which may have
  // committed), so the attempt stays unresolved and is never treated as a
  // confirmed rejection or deleted.
  | "replayRefused";

type PinnedAttempt = {
  readonly key: string;
  readonly payload: TeacherUnitCreatePayload;
  readonly context: TeacherUnitCreateContext;
};

type UnresolvedAttempt = PinnedAttempt & {
  readonly reason: UnresolvedCreateReason;
  readonly error: TeacherUnitError;
};

export type CreateAttemptState =
  | { readonly kind: "idle" }
  | ({ readonly kind: "inFlight" } & PinnedAttempt)
  | ({ readonly kind: "unresolved" } & UnresolvedAttempt)
  // Explicitly abandoned unresolved attempt. Kept so the UI can warn that
  // the unit may already exist.
  | ({ readonly kind: "abandoned" } & UnresolvedAttempt)
  // Confirmed: the server returned the unit (first create or replay).
  | { readonly kind: "created"; readonly unit: TeacherUnit; readonly replayed: boolean }
  // Confirmed pre-commit rejection. The key is discarded (no receipt exists).
  | { readonly kind: "rejected"; readonly error: TeacherUnitError };

export type CreateAttemptBlocked =
  | "inFlight"
  // An unresolved attempt exists; reconcile or abandon it first.
  | "unresolved"
  // After `created` or `abandoned`: call `beginNewUnit()` first.
  | "newUnitIntentRequired"
  // Nothing to reconcile.
  | "noUnresolvedAttempt"
  // `readSessionContext()` returned no usable context.
  | "noSession"
  // The current teacher/school differs from the attempt's pinned context.
  | "contextMismatch"
  // Unauthorized attempts reconcile only with `reauthorized: true`.
  | "awaitingReauthorization"
  // U2.2 persistence: the attempt could not be durably saved and verified
  // before dispatch, so nothing was sent.
  | "storageUnavailable"
  // U2.2 persistence: the teacher/school slot holds a different attempt
  // (for example one saved by another tab). Nothing was sent or replaced.
  | "pendingAttemptExists"
  // U2.2: replay is no longer known to be safe (see "replayExpired").
  | "replayExpired"
  // U2.2: the resend was refused (see "replayRefused"); resending again
  // cannot help.
  | "replayRefused";

export type CreateAttemptResult =
  | { readonly kind: "blocked"; readonly reason: CreateAttemptBlocked }
  | { readonly kind: "settled"; readonly state: CreateAttemptState };

// Validation codes the server checks before any transaction.
const PRE_COMMIT_REJECTION_CODES: ReadonlySet<string> = new Set([
  "teacherUnits.invalidRequest",
  "teacherUnits.invalidIdempotencyKey",
  "teacherUnits.invalidGrade",
  "teacherUnits.invalidTitle",
  "teacherUnits.invalidDescription",
]);

export function classifyCreateFailure(
  error: TeacherUnitError,
): { readonly kind: "rejected" } | { readonly kind: "unresolved"; readonly reason: UnresolvedCreateReason } {
  if (PRE_COMMIT_REJECTION_CODES.has(error.code)) return { kind: "rejected" };
  switch (error.category) {
    case "unauthorized":
      return { kind: "unresolved", reason: "unauthorized" };
    case "notFound":
      return { kind: "unresolved", reason: "notFound" };
    case "conflict":
      return { kind: "unresolved", reason: "contention" };
    case "idempotencyKeyConflict":
      return { kind: "unresolved", reason: "idempotencyKeyConflict" };
    default:
      return { kind: "unresolved", reason: "uncertain" };
  }
}

// Create-specific feedback for an unresolved attempt. The generic
// normalization describes revision-protected writes (for example a
// `writeConflict` there means "not saved"); on create the same codes do not
// establish non-execution, so the coordinator replaces the message and
// recovery while keeping the canonical code, category, and details. It
// never claims the unit was not created and never suggests a new key.
const UNCONFIRMED_CREATE = "We couldn't confirm whether this unit was created.";
const SAME_REQUEST =
  "Check again to confirm. LyfeLabz will reuse your original request, so the unit can't be created twice.";

const UNRESOLVED_CREATE_FEEDBACK: Readonly<
  Record<UnresolvedCreateReason, { readonly message: string; readonly recovery: TeacherUnitRecovery }>
> = Object.freeze({
  uncertain: { message: `${UNCONFIRMED_CREATE} ${SAME_REQUEST}`, recovery: "reconcileCreate" },
  contention: { message: `${UNCONFIRMED_CREATE} ${SAME_REQUEST}`, recovery: "reconcileCreate" },
  notFound: { message: `${UNCONFIRMED_CREATE} ${SAME_REQUEST}`, recovery: "reconcileCreate" },
  unauthorized: {
    message: `${UNCONFIRMED_CREATE} Sign in again, then check again. LyfeLabz will reuse your original request, so the unit can't be created twice.`,
    recovery: "signIn",
  },
  // Same-key reconciliation cannot settle this (the key is bound to another
  // payload); the teacher checks their units and decides deliberately.
  idempotencyKeyConflict: {
    message: `${UNCONFIRMED_CREATE} Refresh your units to check whether it already exists before creating a different unit.`,
    recovery: "refresh",
  },
  replayExpired: {
    message: `${UNCONFIRMED_CREATE} This request is too old to check again safely. Refresh your units to see whether it already exists before creating a different unit.`,
    recovery: "refresh",
  },
  replayRefused: {
    message: `${UNCONFIRMED_CREATE} LyfeLabz couldn't check it again because the request was refused, so it can't be checked automatically. Refresh your units to see whether it already exists before creating a different unit.`,
    recovery: "refresh",
  },
});

export function unresolvedCreateError(
  error: TeacherUnitError,
  reason: UnresolvedCreateReason,
): TeacherUnitError {
  const feedback = UNRESOLVED_CREATE_FEEDBACK[reason];
  return Object.freeze({ ...error, message: feedback.message, recovery: feedback.recovery });
}

// ---------- Durable persistence hooks (U2.2) ----------
//
// The server keeps a create receipt for approximately seven days after the
// transaction (TEACHER_UNITS.md §5.3: `expiresAt`, computed from the
// transaction attempt's clock). The record is saved BEFORE dispatch, so the
// transaction can only be later than `createdAtMs`. Six days leaves a full
// day of margin for clock skew and TTL behavior. Inside the window a
// same-key resend replays; outside it, replay safety cannot be
// established, which is NOT evidence that the create failed.
export const TEACHER_UNIT_CREATE_RECEIPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const CREATE_ATTEMPT_REPLAY_WINDOW_MS = 6 * 24 * 60 * 60 * 1000;
// A record dated further in the future than this is treated as untrusted.
export const CREATE_ATTEMPT_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function isCreateReplayEligible(createdAtMs: number, nowMs: number): boolean {
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(nowMs)) return false;
  const age = nowMs - createdAtMs;
  return age >= -CREATE_ATTEMPT_CLOCK_SKEW_MS && age <= CREATE_ATTEMPT_REPLAY_WINDOW_MS;
}

export type PersistedCreateAttemptStatus = "inFlight" | "unresolved" | "abandoned";

export type PersistedCreateAttempt = {
  readonly key: string;
  readonly payload: TeacherUnitCreatePayload;
  readonly context: TeacherUnitCreateContext;
  readonly status: PersistedCreateAttemptStatus;
  // Set for "unresolved" and "abandoned"; null while in flight.
  readonly reason: UnresolvedCreateReason | null;
  // Client clock when the attempt was first saved (before first dispatch).
  readonly createdAtMs: number;
};

export type CreateAttemptSaveResult =
  // Written AND read back identical.
  | "saved"
  // Storage threw, is missing, or the read-back did not match.
  | "unavailable"
  // This attempt's own entry holds something other than this attempt
  // (a different payload or context, or unreadable contents). Never
  // replaced.
  | "occupied";

// Attempt-keyed persistence: each attempt is saved, verified, and removed
// under its own idempotency key, so one attempt can never overwrite or
// remove another (createAttemptStore.ts).
export type CreateAttemptPersistence = {
  // Save `record` under its own key, then verify it reads back identically.
  readonly save: (record: PersistedCreateAttempt) => CreateAttemptSaveResult;
  // Remove the entry for exactly `key` and verify it is gone. True when no
  // entry for `key` remains; false when removal could not be confirmed.
  readonly clear: (key: string) => boolean;
};

export type CreateUnitCreateCoordinator = {
  readonly state: () => CreateAttemptState;
  // Start a create from `idle` or `rejected`. Refused while in flight,
  // unresolved, created, or abandoned, so edited form fields can never be
  // sent under an unresolved key and a completed form cannot create twice.
  readonly submit: (payload: TeacherUnitCreatePayload) => Promise<CreateAttemptResult>;
  // Deliberately resend the unresolved attempt: original key, original
  // payload, and only when the current session context equals the pinned
  // one. An `unauthorized` attempt also requires `reauthorized: true`.
  readonly reconcile: (options?: { readonly reauthorized?: boolean }) => Promise<CreateAttemptResult>;
  // Explicitly give up on an unresolved attempt (-> `abandoned`). Returns
  // false and changes nothing in any other state, including in flight.
  readonly abandon: () => boolean;
  // Explicit new-unit intent: `created`, `abandoned`, `rejected` (or
  // `idle`) -> `idle`. Returns false and changes nothing while in flight or
  // unresolved.
  readonly beginNewUnit: () => boolean;
  // U2.2 persistence: true while a settled (created or rejected) attempt's
  // saved record could not be confirmed removed. Informational; a later
  // save may still replace it. Always false without `persistence`.
  readonly hasUnclearedRecord: () => boolean;
};

function isUsableContext(c: TeacherUnitCreateContext | null): c is TeacherUnitCreateContext {
  return (
    c !== null &&
    typeof c === "object" &&
    typeof c.teacherId === "string" &&
    c.teacherId.length > 0 &&
    typeof c.schoolId === "string" &&
    c.schoolId.length > 0
  );
}

function sameContext(a: TeacherUnitCreateContext, b: TeacherUnitCreateContext): boolean {
  return a.teacherId === b.teacherId && a.schoolId === b.schoolId;
}

// Rebuilds the state a saved attempt represents. An attempt saved as in
// flight was interrupted (reload, navigation, closed tab) and may have
// committed, so it becomes "uncertain" rather than failed. Any attempt
// outside the replay window becomes "replayExpired".
function restoredState(record: PersistedCreateAttempt, nowMs: number): CreateAttemptState {
  const pinned: PinnedAttempt = Object.freeze({
    key: record.key,
    payload: Object.freeze({ ...record.payload }),
    context: Object.freeze({ ...record.context }),
  });
  let reason: UnresolvedCreateReason =
    record.status === "inFlight" || record.reason === null ? "uncertain" : record.reason;
  if (record.status !== "abandoned" && !isCreateReplayEligible(record.createdAtMs, nowMs)) {
    reason = "replayExpired";
  }
  const error = unresolvedCreateError(normalizeTeacherUnitError(undefined), reason);
  return Object.freeze({
    kind: record.status === "abandoned" ? "abandoned" : "unresolved",
    ...pinned,
    reason,
    error,
  });
}

export function createUnitCreateCoordinator(deps: {
  readonly create: TeacherUnitsCallables["create"];
  readonly readSessionContext: ReadTeacherUnitCreateContext;
  readonly mint?: () => string;
  // U2.2 optional hooks. Without `persistence` the coordinator is the
  // certified in-memory U2.1 state machine. With it, the attempt is saved
  // and verified BEFORE first dispatch (a failed save blocks the create and
  // sends nothing), and every later transition is saved best-effort: a
  // failed later save never discards the key from memory, and a stored
  // in-flight record restores as unresolved, so it is always conservative.
  readonly persistence?: CreateAttemptPersistence;
  // A saved attempt for THIS teacher/school, read by the caller from the
  // same scoped slot `persistence` writes. Requires `persistence`.
  readonly restore?: PersistedCreateAttempt | null;
  readonly now?: () => number;
}): CreateUnitCreateCoordinator {
  const mint = deps.mint ?? defaultMintIdempotencyKey;
  const now = deps.now ?? (() => Date.now());
  const persistence = deps.persistence ?? null;
  let state: CreateAttemptState = { kind: "idle" };
  // The key of the attempt entry this coordinator has saved (and not yet
  // confirmed removed), and the current attempt's first-save time.
  let slotKey: string | null = null;
  let attemptCreatedAtMs = 0;
  let uncleared = false;
  if (persistence !== null && deps.restore) {
    state = restoredState(deps.restore, now());
    slotKey = deps.restore.key;
    attemptCreatedAtMs = deps.restore.createdAtMs;
  }

  const persist = (
    attempt: PinnedAttempt,
    status: PersistedCreateAttemptStatus,
    reason: UnresolvedCreateReason | null,
  ): CreateAttemptSaveResult | null => {
    if (persistence === null) return null;
    let result: CreateAttemptSaveResult;
    try {
      result = persistence.save(
        Object.freeze({
          key: attempt.key,
          payload: attempt.payload,
          context: attempt.context,
          status,
          reason,
          createdAtMs: attemptCreatedAtMs,
        }),
      );
    } catch {
      result = "unavailable";
    }
    if (result === "saved") slotKey = attempt.key;
    return result;
  };

  // Settled attempts (created, rejected) no longer need their record. A
  // failed removal is remembered, never assumed to have succeeded.
  const clearSettled = (key: string): boolean => {
    if (persistence === null || slotKey !== key) return true;
    let ok = false;
    try {
      ok = persistence.clear(key);
    } catch {
      ok = false;
    }
    if (ok) slotKey = null;
    uncleared = !ok;
    return ok;
  };

  const readContext = (): TeacherUnitCreateContext | null => {
    const c = deps.readSessionContext();
    return isUsableContext(c)
      ? Object.freeze({ teacherId: c.teacherId, schoolId: c.schoolId })
      : null;
  };

  // `isResend`: a same-key reconcile of an attempt that was already
  // dispatched once (or restored), whose first outcome is unknown.
  const send = async (attempt: PinnedAttempt, isResend = false): Promise<CreateAttemptResult> => {
    state = Object.freeze({ kind: "inFlight", ...attempt });
    const outcome = await runTeacherUnitMutation(() =>
      deps.create({
        grade: attempt.payload.grade,
        title: attempt.payload.title,
        description: attempt.payload.description,
        idempotencyKey: attempt.key,
      }),
    );
    if (outcome.ok) {
      state = Object.freeze({
        kind: "created",
        unit: outcome.result.unit,
        replayed: outcome.result.replayed,
      });
      clearSettled(attempt.key);
    } else {
      const classified = classifyCreateFailure(outcome.error);
      // A pre-commit refusal of a RESEND proves only that the resend did not
      // commit; the original dispatch may have. Keep it unresolved.
      const c: ReturnType<typeof classifyCreateFailure> =
        isResend && classified.kind === "rejected"
          ? { kind: "unresolved", reason: "replayRefused" }
          : classified;
      state =
        c.kind === "rejected"
          ? Object.freeze({ kind: "rejected", error: outcome.error })
          : Object.freeze({
              kind: "unresolved",
              ...attempt,
              reason: c.reason,
              error: unresolvedCreateError(outcome.error, c.reason),
            });
      if (c.kind === "rejected") {
        clearSettled(attempt.key);
      } else {
        // Best-effort. On failure the saved record still holds this key as
        // in flight, which restores as unresolved: never lost, never new.
        persist(attempt, "unresolved", c.reason);
      }
    }
    return Object.freeze({ kind: "settled", state });
  };

  const blocked = (reason: CreateAttemptBlocked): CreateAttemptResult =>
    Object.freeze({ kind: "blocked", reason });

  return Object.freeze({
    state: () => state,
    submit: async (payload) => {
      switch (state.kind) {
        case "inFlight":
          return blocked("inFlight");
        case "unresolved":
          return blocked("unresolved");
        case "created":
        case "abandoned":
          return blocked("newUnitIntentRequired");
        case "idle":
        case "rejected":
          break;
      }
      const context = readContext();
      if (context === null) return blocked("noSession");
      const attempt: PinnedAttempt = Object.freeze({
        key: mint(),
        payload: Object.freeze({
          grade: payload.grade,
          title: payload.title,
          description: payload.description,
        }),
        context,
      });
      if (persistence !== null) {
        // Saved and verified before dispatch, or nothing is sent.
        const previousCreatedAt = attemptCreatedAtMs;
        attemptCreatedAtMs = now();
        const saved = persist(attempt, "inFlight", null);
        if (saved !== "saved") {
          attemptCreatedAtMs = previousCreatedAt;
          return blocked(saved === "occupied" ? "pendingAttemptExists" : "storageUnavailable");
        }
        uncleared = false;
      }
      return send(attempt);
    },
    reconcile: async (options = {}) => {
      if (state.kind === "inFlight") return blocked("inFlight");
      if (state.kind !== "unresolved") return blocked("noUnresolvedAttempt");
      const current = readContext();
      if (current === null) return blocked("noSession");
      if (!sameContext(state.context, current)) return blocked("contextMismatch");
      if (state.reason === "replayExpired") return blocked("replayExpired");
      if (state.reason === "replayRefused") return blocked("replayRefused");
      if (persistence !== null && !isCreateReplayEligible(attemptCreatedAtMs, now())) {
        const { key, payload, context } = state;
        state = Object.freeze({
          kind: "unresolved",
          key,
          payload,
          context,
          reason: "replayExpired" as const,
          error: unresolvedCreateError(state.error, "replayExpired"),
        });
        persist({ key, payload, context }, "unresolved", "replayExpired");
        return blocked("replayExpired");
      }
      if (state.reason === "unauthorized" && options.reauthorized !== true) {
        return blocked("awaitingReauthorization");
      }
      const attempt: PinnedAttempt = { key: state.key, payload: state.payload, context: state.context };
      // Best-effort: a same-key resend cannot create a second unit, and the
      // key stays in memory and in the existing record either way.
      persist(attempt, "inFlight", null);
      return send(attempt, true);
    },
    abandon: () => {
      if (state.kind !== "unresolved") return false;
      const { key, payload, context, reason, error } = state;
      state = Object.freeze({ kind: "abandoned", key, payload, context, reason, error });
      // Best-effort; a failed save leaves the record unresolved, which
      // restores as unresolved (more conservative than abandoned).
      persist({ key, payload, context }, "abandoned", reason);
      return true;
    },
    beginNewUnit: () => {
      if (state.kind === "inFlight" || state.kind === "unresolved") return false;
      if (state.kind === "abandoned" && persistence !== null && slotKey === state.key) {
        // The abandoned warning must not vanish unless its record is
        // confirmed removed.
        let ok = false;
        try {
          ok = persistence.clear(state.key);
        } catch {
          ok = false;
        }
        if (!ok) return false;
        slotKey = null;
      }
      state = { kind: "idle" };
      return true;
    },
    hasUnclearedRecord: () => uncleared,
  });
}
