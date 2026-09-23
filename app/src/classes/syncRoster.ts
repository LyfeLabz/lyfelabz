import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import { classifyRosterSyncError } from "./rosterSyncError";

// The error vocabulary lives in the firebase-free `rosterSyncError` module so
// the shell can classify roster-refresh failures without importing this
// Firebase wrapper; re-exported here unchanged.
export {
  SyncRosterError,
  classifyRosterSyncError,
  type SyncRosterErrorKind,
} from "./rosterSyncError";

// Sprint 24B Phase 2B.8: client wrapper for the certified
// `lmsClassesSyncRoster` callable. This module lives outside
// `src/shell/**` so the shell "no firebase imports" invariant is
// preserved. See
// platform/functions/src/lms/classes-sync-roster.ts for the canonical
// server contract:
//
//   - Request: `{ classId }` only. The provider identifier, upstream
//     `lmsClassId`, connection identifier, and every OAuth credential
//     are derived server-side. A client can never inject them.
//   - Response: deterministic reconciliation counters only. No student
//     identifier, email, provider account id, or token ever appears.
//   - Server writes exactly one `lms.rosterSynchronized` audit event per
//     completed reconciliation.
//
// The wrapper is intentionally thin. It preserves the server error code
// so the shell can map platform error codes to teacher-facing UX copy
// (reconnect vs retry vs unavailable).

export type SyncRosterInput = {
  readonly classId: string;
};

// Canonical roster-sync counters returned by the server. Every value is
// a non-negative integer. `upstreamRosterEmpty` is a defensive signal
// the server sets when the upstream provider returned zero students so
// the client can distinguish "no students in the upstream course" from
// "no local enrollment changes."
export type SyncRosterCounters = {
  readonly added: number;
  readonly reactivated: number;
  readonly unchanged: number;
  readonly withdrawn: number;
  readonly unresolved: number;
  readonly skipped: number;
  readonly upstreamRosterEmpty: boolean;
};

export type SyncRosterResult = SyncRosterCounters & {
  readonly classId: string;
};

export type SyncRoster = (input: SyncRosterInput) => Promise<SyncRosterResult>;

// Server response shape as received on the wire. Every field is typed
// `unknown` at the boundary so the wrapper can validate the shape
// defensively without trusting the server's TS declaration.
type LmsClassesSyncRosterResponse = {
  readonly classId?: unknown;
  readonly added?: unknown;
  readonly reactivated?: unknown;
  readonly unchanged?: unknown;
  readonly withdrawn?: unknown;
  readonly unresolved?: unknown;
  readonly skipped?: unknown;
  readonly upstreamRosterEmpty?: unknown;
};

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function validateCounters(
  data: LmsClassesSyncRosterResponse,
): SyncRosterCounters {
  const counters = {
    added: isNonNegativeInt(data.added) ? data.added : 0,
    reactivated: isNonNegativeInt(data.reactivated) ? data.reactivated : 0,
    unchanged: isNonNegativeInt(data.unchanged) ? data.unchanged : 0,
    withdrawn: isNonNegativeInt(data.withdrawn) ? data.withdrawn : 0,
    unresolved: isNonNegativeInt(data.unresolved) ? data.unresolved : 0,
    skipped: isNonNegativeInt(data.skipped) ? data.skipped : 0,
    upstreamRosterEmpty: data.upstreamRosterEmpty === true,
  };
  return Object.freeze(counters);
}

export function createFirebaseSyncRoster(functions: Functions): SyncRoster {
  const callable = httpsCallable<
    { classId: string },
    LmsClassesSyncRosterResponse
  >(functions, "lmsClassesSyncRoster");
  return async (input) => {
    let data: LmsClassesSyncRosterResponse;
    try {
      const res = await callable({ classId: input.classId });
      data = res.data;
    } catch (err) {
      throw classifyRosterSyncError(err);
    }
    const returnedId =
      typeof data?.classId === "string" && data.classId.length > 0
        ? data.classId
        : input.classId;
    const counters = validateCounters(data);
    return Object.freeze({
      classId: returnedId,
      ...counters,
    });
  };
}
