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
// Durable recovery (release-blocking U2.2 requirement; not implemented in
// U2.1, which keeps coordinator state in memory only):
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
  | "idempotencyKeyConflict";

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
  | "awaitingReauthorization";

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
});

export function unresolvedCreateError(
  error: TeacherUnitError,
  reason: UnresolvedCreateReason,
): TeacherUnitError {
  const feedback = UNRESOLVED_CREATE_FEEDBACK[reason];
  return Object.freeze({ ...error, message: feedback.message, recovery: feedback.recovery });
}

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

export function createUnitCreateCoordinator(deps: {
  readonly create: TeacherUnitsCallables["create"];
  readonly readSessionContext: ReadTeacherUnitCreateContext;
  readonly mint?: () => string;
}): CreateUnitCreateCoordinator {
  const mint = deps.mint ?? defaultMintIdempotencyKey;
  let state: CreateAttemptState = { kind: "idle" };

  const readContext = (): TeacherUnitCreateContext | null => {
    const c = deps.readSessionContext();
    return isUsableContext(c)
      ? Object.freeze({ teacherId: c.teacherId, schoolId: c.schoolId })
      : null;
  };

  const send = async (attempt: PinnedAttempt): Promise<CreateAttemptResult> => {
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
    } else {
      const c = classifyCreateFailure(outcome.error);
      state =
        c.kind === "rejected"
          ? Object.freeze({ kind: "rejected", error: outcome.error })
          : Object.freeze({
              kind: "unresolved",
              ...attempt,
              reason: c.reason,
              error: unresolvedCreateError(outcome.error, c.reason),
            });
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
      return send({
        key: mint(),
        payload: Object.freeze({
          grade: payload.grade,
          title: payload.title,
          description: payload.description,
        }),
        context,
      });
    },
    reconcile: async (options = {}) => {
      if (state.kind === "inFlight") return blocked("inFlight");
      if (state.kind !== "unresolved") return blocked("noUnresolvedAttempt");
      const current = readContext();
      if (current === null) return blocked("noSession");
      if (!sameContext(state.context, current)) return blocked("contextMismatch");
      if (state.reason === "unauthorized" && options.reauthorized !== true) {
        return blocked("awaitingReauthorization");
      }
      return send({ key: state.key, payload: state.payload, context: state.context });
    },
    abandon: () => {
      if (state.kind !== "unresolved") return false;
      const { key, payload, context, reason, error } = state;
      state = Object.freeze({ kind: "abandoned", key, payload, context, reason, error });
      return true;
    },
    beginNewUnit: () => {
      if (state.kind === "inFlight" || state.kind === "unresolved") return false;
      state = { kind: "idle" };
      return true;
    },
  });
}
