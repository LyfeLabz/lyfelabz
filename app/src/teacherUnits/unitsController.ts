import { createTeacherUnitsCapabilityState, type TeacherUnitsCapabilityState } from "./capabilityState";
import { requireTeacherUnitsAvailable } from "./releaseAvailability";
import type { TeacherUnitColor } from "./unitColor";
import { normalizeTeacherUnitError, type TeacherUnitError } from "./errors";
import type { CreateAttemptStore, FormerSchoolAttempt } from "./createAttemptStore";
import {
  createMutationGate,
  createUnitCreateCoordinator,
  runTeacherUnitMutation,
  type CreateAttemptBlocked,
  type CreateAttemptState,
  type CreateUnitCreateCoordinator,
  type PersistedCreateAttempt,
  type ReadTeacherUnitCreateContext,
  type TeacherUnitCreateContext,
  type TeacherUnitCreatePayload,
} from "./saveCoordination";
import { validateUnitDescription, validateUnitTitle } from "./fieldRules";
import { getPlaceableResourceById } from "./placeableResources";
import { moveIdByStep, moveIndex } from "./unitOrderMath";
import {
  isUncertainMutationFailure,
  shouldRereadAfter,
  type PendingUnitMutationIntent,
} from "./mutationReconciliation";
import {
  createPendingMutationRegistry,
  isPresent,
  type PendingMutationEntry,
  type PendingMutationRegistry,
  type PendingMutationResolution,
  type CapacityReason,
} from "./pendingMutations";
import {
  compareTeacherUnits,
  TEACHER_UNIT_RESOURCES_MAX,
  type TeacherUnit,
  type TeacherUnitGrade,
  type TeacherUnitsCallables,
} from "./types";

// U2.2 - My Units controller (docs/platform/TEACHER_UNITS.md "U2.2").
//
// Firebase-free and DOM-free. It owns one teacher's My Units state for one
// mounted panel: the grade's unit list, single-unit mutations, and the
// durable create attempt. The server stays authoritative: every displayed
// unit is a server response, every mutation carries the last server
// revision the controller holds, and a conflict is never replayed.
//
// Lifetime guard. The controller is bound to the shell session it was
// mounted for. Every asynchronous continuation re-checks `alive()`: the
// controller is not disposed AND the live canonical context
// (`readCurrentContext`, which reads the current Firebase uid and the
// active-teacher session) still equals that session. A late response for
// a previous account or a replaced controller therefore never reaches the
// UI. The create coordinator still settles its own durable record, which
// is scoped to the originating teacher and school, so that record stays
// truthful.

export type UnitsListState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly units: ReadonlyArray<TeacherUnit> }
  | { readonly kind: "error"; readonly error: TeacherUnitError };

// Whether create-recovery storage could be listed.
export type CreateStorageState =
  | { readonly kind: "ok" }
  // Storage threw or is missing: create is blocked (nothing can be saved
  // before dispatch).
  | { readonly kind: "unavailable" };

// Result of the authoritative check (all grades, archived included) run
// before an attempt that cannot be replayed may be set aside, or an
// unreadable record discarded.
export type CreateRecoveryCheck =
  | { readonly kind: "none" }
  | { readonly kind: "checking" }
  | { readonly kind: "checked"; readonly units: ReadonlyArray<TeacherUnit> }
  | { readonly kind: "error"; readonly error: TeacherUnitError };

type RecoveryAttemptState = Extract<
  CreateAttemptState,
  { readonly kind: "inFlight" | "unresolved" | "abandoned" }
>;

// One create attempt whose outcome is not confirmed: restored from storage
// (this tab earlier, a reload, or another tab), or the form's own attempt.
export type CreateRecoveryEntry = {
  readonly key: string;
  readonly state: RecoveryAttemptState;
  // True for the form's own attempt (as opposed to a restored one).
  readonly own: boolean;
};

export type FormerSchoolNotices =
  | {
      readonly kind: "ok";
      readonly attempts: ReadonlyArray<FormerSchoolAttempt>;
      readonly unreadable: number;
    }
  | { readonly kind: "unavailable" };

const NO_FORMER_SCHOOL: FormerSchoolNotices = Object.freeze({
  kind: "ok",
  attempts: Object.freeze([]),
  unreadable: 0,
});

// Controller-level create refusals, in addition to the coordinator's.
export type CreateBlockedReason =
  | CreateAttemptBlocked
  // Unconfirmed or unreadable attempts must be resolved first.
  | "recoveryPending"
  // An authoritative check is required first.
  | "checkRequired";

export type TeacherUnitsViewState = {
  readonly grade: TeacherUnitGrade;
  readonly showArchived: boolean;
  readonly list: UnitsListState;
  // The create form's own attempt.
  readonly create: CreateAttemptState;
  readonly createBlocked: CreateBlockedReason | null;
  readonly storage: CreateStorageState;
  // Every unconfirmed attempt, oldest first.
  readonly recoveries: ReadonlyArray<CreateRecoveryEntry>;
  // Storage keys of records that could not be validated.
  readonly unreadable: ReadonlyArray<string>;
  readonly recoveryCheck: CreateRecoveryCheck;
  // Read-only notices: this teacher's unconfirmed attempts saved in this
  // browser under a school other than the mounted one. Never replayed,
  // reconciled, restored, or discarded from here, and never blocking.
  readonly formerSchool: FormerSchoolNotices;
  // The most recent attempt confirmed by reconciliation (restored or own).
  readonly lastConfirmed: { readonly unit: TeacherUnit; readonly replayed: boolean } | null;
  // Units with a mutation in flight: this controller's own, plus requests
  // an earlier controller of this teacher and school dispatched that have
  // no response yet (A3-4 S2).
  readonly busyUnitIds: ReadonlySet<string>;
  // A3-4 S2: this teacher and school's uncertain (and still in-flight)
  // non-create mutations, oldest first, with each one's latest present-state
  // finding. Memory only: kept across Curriculum navigation and panel
  // remounts in one signed-in session, never across a browser reload.
  readonly pending: ReadonlyArray<PendingMutationEntry>;
  // Ids of the `pending` entries this controller dispatched that have no
  // response yet. The sending card already shows them as in progress, so
  // they are not unconfirmed; entries another controller sent are not here.
  readonly ownInFlight: ReadonlySet<string>;
  // A3-4 S2: requests whose response arrived after the controller that sent
  // them was replaced, oldest first (bounded). Announced once by the panel.
  readonly resolutions: ReadonlyArray<PendingMutationResolution>;
};

// What the latest accepted evidence says about one unit.
export type UnitStateView =
  // Returned by the newest evidence; `unit` is the full record (highest
  // revision), resources included, whether or not it is shown.
  | { readonly kind: "active" | "archived"; readonly unit: TeacherUnit }
  // Omitted by a newer active-only list: archived or gone; contents unknown.
  | { readonly kind: "notActive" }
  // Not found, or omitted by a newer list that included archived units.
  | { readonly kind: "absent" }
  // Never observed by this controller.
  | { readonly kind: "unknown" };

const UNKNOWN_UNIT: UnitStateView = Object.freeze({ kind: "unknown" });
const ABSENT_UNIT: UnitStateView = Object.freeze({ kind: "absent" });
const NOT_ACTIVE_UNIT: UnitStateView = Object.freeze({ kind: "notActive" });

export type ResourceMoveDirection = "up" | "down";

export type UnitEdit = {
  readonly title?: string;
  readonly description?: string;
  // A palette token, or null for the neutral default.
  readonly color?: TeacherUnitColor | null;
};

// What a confirmed membership write committed, known from the request
// itself: the server compares `expectedRevision` and writes exactly the sent
// list at `expectedRevision + 1`. The response `unit` is a separate
// post-commit read and may already show later changes made elsewhere, so it
// is never used to infer what this write did.
export type MembershipCommit = {
  readonly revision: number;
  readonly previous: ReadonlyArray<string>;
  readonly resourceIds: ReadonlyArray<string>;
};

export type UnitMutationResult =
  | {
      readonly kind: "saved";
      readonly unit: TeacherUnit;
      readonly noop: boolean;
      // Membership writes only, and only when the server wrote (not noop).
      readonly committed?: MembershipCommit;
    }
  // Field validation before sending; nothing was sent.
  | { readonly kind: "invalid"; readonly field: "title" | "description"; readonly message: string }
  // Revision conflict. `latest` is the freshly fetched server state (null
  // when it could not be fetched). The refusal came from a transaction
  // attempt, so it does not prove this request saved nothing (A3-3 section
  // 5.1): an earlier SDK attempt may have committed. Edits are the caller's
  // to keep; `latest` is current state, not proof of either outcome.
  | { readonly kind: "conflict"; readonly latest: TeacherUnit | null; readonly error: TeacherUnitError }
  // The unit is archived (`latest` is the archived server state when
  // known). Like a conflict, this does not prove nothing was saved; edits
  // are the caller's to keep.
  | { readonly kind: "archived"; readonly latest: TeacherUnit | null; readonly error: TeacherUnitError }
  | { readonly kind: "error"; readonly error: TeacherUnitError }
  // The request may or may not have committed (lost response, malformed
  // response, or an A3-3 availability refusal or responseUnavailable).
  // `latest` is the authoritative unit fetched once afterwards (null when it
  // could not be fetched). Never resent. A3-4 S2: update, archive and
  // restore report this too, not only membership writes.
  | { readonly kind: "uncertain"; readonly latest: TeacherUnit | null; readonly error: TeacherUnitError }
  // Another mutation for this unit is in flight; nothing was sent.
  | { readonly kind: "busy" }
  // A3-4 S2: the scope already tracks the most unconfirmed changes it can
  // (pendingMutations.ts). Nothing was sent. `reason` names the bound, so
  // the teacher is only offered a recovery action that can help.
  | { readonly kind: "capacity"; readonly reason: CapacityReason }
  // A3-4 S2 (D3): an earlier change to this unit has an unconfirmed outcome
  // and no authoritative state has been accepted since, so nothing was sent.
  // This is also returned instead of any answer computed from held state
  // (a local no-op, an archived or unavailable-resource refusal).
  // A read (Check current state, a My Units list read) restores eligibility;
  // the teacher then decides again. Unsaved input is the caller's to keep.
  | { readonly kind: "needsCheck" }
  // The controller was disposed or the account changed; ignore.
  | { readonly kind: "stale" };

export type TeacherUnitsController = {
  readonly getState: () => TeacherUnitsViewState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setGrade: (grade: TeacherUnitGrade) => void;
  readonly setShowArchived: (show: boolean) => void;
  readonly refresh: () => Promise<void>;
  // Milestone 2B: one authoritative read of this teacher's active units in
  // every grade (`teacherUnitsList` without a grade), accepted through the
  // same evidence ordering as any list. It never changes the grade view.
  // Resolves true when the read succeeded and was applied.
  readonly loadActiveUnits: () => Promise<boolean>;
  // Every unit the latest accepted evidence holds as present and active, in
  // every grade, canonical order (grade, then unit order). Read-only
  // projections (Curriculum's unit-name pills) use it; it is never evidence.
  readonly activeUnits: () => ReadonlyArray<TeacherUnit>;
  // The last server state seen for a unit, even when it is not in the
  // current list (for example archived while archived units are hidden).
  readonly getKnownUnit: (unitId: string) => TeacherUnit | null;
  // Where the latest accepted evidence says a unit stands, independent of
  // what the current view shows. Status messages use this, never the list.
  readonly getUnitState: (unitId: string) => UnitStateView;
  readonly submitCreate: (payload: TeacherUnitCreatePayload) => Promise<void>;
  // Same-key, same-payload resend of one unconfirmed attempt.
  readonly reconcileCreate: (
    key: string,
    options?: { readonly reauthorized?: boolean },
  ) => Promise<void>;
  // Authoritative list (all grades, archived included), and a rescan for
  // attempts saved by other tabs.
  readonly checkRecovery: () => Promise<void>;
  // Explicit "set this attempt aside". Attempts that cannot be replayed
  // require a completed `checkRecovery` first. False when refused.
  readonly abandonCreate: (key: string) => boolean;
  // Explicit acknowledgment that ends an abandoned attempt's warning
  // (verified removal of its record). False when refused or unverified.
  readonly dismissAbandoned: (key: string) => boolean;
  // Explicit new-unit intent for the form after created / rejected /
  // abandoned.
  readonly beginNewUnit: () => boolean;
  // Explicit, acknowledged removal of ONE unreadable record after a
  // completed `checkRecovery`. False when refused or unverified.
  readonly discardUnreadableAttempt: (storageKey: string) => boolean;
  readonly updateUnit: (unitId: string, edit: UnitEdit) => Promise<UnitMutationResult>;
  readonly archiveUnit: (unitId: string) => Promise<UnitMutationResult>;
  readonly restoreUnit: (unitId: string) => Promise<UnitMutationResult>;
  // U2.3 membership (teacherUnitsSetResources). Both send the complete
  // list derived from the last server state held, with its revision.
  // Appends placeable ids not already in the unit, in the given order.
  readonly addResources: (
    unitId: string,
    resourceIds: ReadonlyArray<string>,
  ) => Promise<UnitMutationResult>;
  // Removes one id from this unit only.
  readonly removeResource: (unitId: string, resourceId: string) => Promise<UnitMutationResult>;
  // Removes every retired id (stored but no longer RA-1 unitPlaceable) from
  // this unit in one request, keeping the placeable ids in their order.
  // The server refuses any list that still names a retired id, so a unit
  // holding retired ids can only be repaired this way.
  readonly removeRetiredResources: (unitId: string) => Promise<UnitMutationResult>;
  // U2.4 ordering. Moves one resource a single position earlier ("up") or
  // later ("down") and sends the complete permutation of the held list
  // with its revision (teacherUnitsSetResources). Unknown ids, boundary
  // moves, and units with fewer than two resources are no-ops without a
  // call. Refused before sending while the unit holds retired ids (the
  // server would refuse the list) or is archived.
  readonly moveResource: (
    unitId: string,
    resourceId: string,
    direction: ResourceMoveDirection,
  ) => Promise<UnitMutationResult>;
  // Milestone 2B drag-and-drop: moves one resource to index `toIndex` of the
  // held list in one request (a permutation, same path and guards as
  // `moveResource`). Unknown ids, out-of-range indexes, and the resource's
  // own position are no-ops without a call.
  readonly moveResourceTo: (
    unitId: string,
    resourceId: string,
    toIndex: number,
  ) => Promise<UnitMutationResult>;
  // A3-4 S2: one deliberate authoritative read (a get, never a mutation) of
  // a pending entry's unit, re-evaluating its present-state finding.
  readonly checkPendingMutation: (id: string) => Promise<void>;
  // A3-4 S2: explicit acknowledgment that removes one uncertain entry. Never
  // sends anything. False for an in-flight or unknown entry.
  readonly dismissPendingMutation: (id: string) => boolean;
  readonly dispose: () => void;
};

export type TeacherUnitsControllerDeps = {
  readonly callables: TeacherUnitsCallables;
  // The active-teacher session this controller is mounted for.
  readonly session: TeacherUnitCreateContext;
  // Live canonical context, read at call time (current Firebase uid AND the
  // active-teacher session's uid/school). Null when they disagree.
  readonly readCurrentContext: ReadTeacherUnitCreateContext;
  readonly store: CreateAttemptStore;
  readonly initialGrade: TeacherUnitGrade;
  readonly mint?: () => string;
  readonly now?: () => number;
  // A3-4 S2: the owner of pending reconciliation records, above this
  // controller's lifetime (one per surface seam). Omitted: a private
  // registry that lives only as long as this controller.
  readonly pendingRegistry?: PendingMutationRegistry;
};

// A success response that contradicts the write contract (see `mutate`).
// Categorized "unexpected": uncertain, one automatic read, never resent.
const INCONSISTENT_WRITE_RESPONSE = normalizeTeacherUnitError(new Error("inconsistent write response"));

function sameContext(a: TeacherUnitCreateContext | null, b: TeacherUnitCreateContext): boolean {
  return a !== null && a.teacherId === b.teacherId && a.schoolId === b.schoolId;
}

// Field rules live in fieldRules.ts (shared with the attempt store).
export { validateUnitDescription, validateUnitTitle };

function isRecoveryState(s: CreateAttemptState): s is RecoveryAttemptState {
  return s.kind === "inFlight" || s.kind === "unresolved" || s.kind === "abandoned";
}

// Attempts that can no longer be resent require an authoritative check
// before they may be set aside.
function requiresCheck(s: RecoveryAttemptState): boolean {
  return (
    s.kind === "unresolved" &&
    (s.reason === "replayExpired" ||
      s.reason === "replayRefused" ||
      s.reason === "idempotencyKeyConflict" ||
      s.reason === "schoolContextChanged")
  );
}

export function createTeacherUnitsController(deps: TeacherUnitsControllerDeps): TeacherUnitsController {
  requireTeacherUnitsAvailable();
  const session = Object.freeze({ ...deps.session });
  const listeners = new Set<() => void>();
  const gate = createMutationGate();
  const known = new Map<string, TeacherUnit>();
  let disposed = false;
  let loadSeq = 0;

  // The live canonical context is still the one this controller was
  // mounted for (whether or not it is disposed).
  const scopeCurrent = (): boolean => {
    let current: TeacherUnitCreateContext | null = null;
    try {
      current = deps.readCurrentContext();
    } catch {
      current = null;
    }
    return sameContext(current, session);
  };
  const alive = (): boolean => !disposed && scopeCurrent();

  // A3-4 S2 pending reconciliation records. Bound to this teacher and
  // school; binding clears any other scope's records. Writes are refused
  // once the canonical context changes, so a late response of this
  // controller can settle its own record after a panel remount, but never
  // reaches another account or school.
  const pending = (deps.pendingRegistry ?? createPendingMutationRegistry(deps.now ? { now: deps.now } : {})).forScope(
    session,
    scopeCurrent,
  );
  // This controller's own in-flight units (see `busyUnitIds`).
  const ownBusy = new Set<string>();
  // Registry writes this controller makes while it is applying evidence
  // itself: its own listener ignores them (the controller updates its view
  // right after), so it never re-renders half-applied state.
  let ownWrite = 0;
  const quietly = <T>(write: () => T): T => {
    ownWrite++;
    try {
      return write();
    } finally {
      ownWrite--;
    }
  };

  // Re-read immediately before every dispatch; refuses another account.
  const readSessionContext = (): TeacherUnitCreateContext | null => {
    if (disposed) return null;
    const current = deps.readCurrentContext();
    return sameContext(current, session) ? current : null;
  };

  const coordinatorFor = (restore: PersistedCreateAttempt | null): CreateUnitCreateCoordinator =>
    createUnitCreateCoordinator({
      create: deps.callables.create,
      readSessionContext,
      persistence: deps.store,
      restore,
      ...(deps.mint ? { mint: deps.mint } : {}),
      ...(deps.now ? { now: deps.now } : {}),
    });

  // The form's own attempt, plus one independent coordinator per restored
  // or discovered record (keyed by idempotency key).
  const primary = coordinatorFor(null);
  const restored = new Map<string, CreateUnitCreateCoordinator>();
  // Keys the form's coordinator has dispatched in this controller; their
  // records are already represented by `primary`.
  const ownKeys = new Set<string>();
  let storage: CreateStorageState = { kind: "ok" };
  let unreadable: ReadonlyArray<string> = [];
  let formerSchool: FormerSchoolNotices = NO_FORMER_SCHOOL;

  // Adopt every stored attempt this controller does not already track, and
  // refresh the read-only former-school notices.
  const scan = (): void => {
    try {
      const former = deps.store.listFormerSchools();
      formerSchool =
        former.kind === "ok"
          ? Object.freeze({ kind: "ok", attempts: former.attempts, unreadable: former.unreadable })
          : Object.freeze({ kind: "unavailable" });
    } catch {
      formerSchool = Object.freeze({ kind: "unavailable" });
    }
    const listed = deps.store.list();
    if (listed.kind === "unavailable") {
      storage = { kind: "unavailable" };
      return;
    }
    storage = { kind: "ok" };
    unreadable = listed.unreadable;
    for (const record of listed.records) {
      if (restored.has(record.key) || ownKeys.has(record.key)) continue;
      restored.set(record.key, coordinatorFor(record));
    }
  };
  scan();

  const recoveries = (): ReadonlyArray<CreateRecoveryEntry> => {
    const entries: CreateRecoveryEntry[] = [];
    for (const [key, c] of restored) {
      const s = c.state();
      if (isRecoveryState(s)) entries.push(Object.freeze({ key, state: s, own: false }));
    }
    const p = primary.state();
    if (p.kind === "unresolved" || p.kind === "abandoned") {
      entries.push(Object.freeze({ key: p.key, state: p, own: true }));
    }
    return Object.freeze(entries);
  };

  let state: TeacherUnitsViewState = Object.freeze<TeacherUnitsViewState>({
    grade: deps.initialGrade,
    showArchived: false,
    list: { kind: "loading" },
    create: primary.state(),
    createBlocked: null,
    storage,
    recoveries: recoveries(),
    unreadable,
    recoveryCheck: { kind: "none" },
    formerSchool,
    lastConfirmed: null,
    busyUnitIds: new Set<string>(),
    pending: pending.list(),
    ownInFlight: new Set<string>(),
    resolutions: pending.resolutions(),
  });

  // The units the last completed Check my units returned (its own result).
  let checkedIds: ReadonlyArray<string> = [];

  const busyNow = (): ReadonlySet<string> => {
    const ids = new Set(ownBusy);
    for (const e of pending.list()) if (e.status === "inFlight") ids.add(e.record.unitId);
    const prev = state.busyUnitIds;
    return prev.size === ids.size && Array.from(ids).every((id) => prev.has(id)) ? prev : ids;
  };
  // Derived, never tracked per request (third remediation F4): a unit has
  // at most one in-flight entry (`mutate` refuses while any controller has
  // one), so while this controller's own request for a unit is outstanding
  // that unit's in-flight entry is the one it sent.
  const ownInFlightNow = (): ReadonlySet<string> => {
    const ids = new Set<string>();
    for (const e of pending.list()) if (e.status === "inFlight" && ownBusy.has(e.record.unitId)) ids.add(e.record.id);
    const prev = state.ownInFlight;
    return prev.size === ids.size && Array.from(ids).every((id) => prev.has(id)) ? prev : ids;
  };

  const set = (patch: Partial<TeacherUnitsViewState>): void => {
    const recoveryCheck = patch.recoveryCheck ?? state.recoveryCheck;
    state = Object.freeze({
      ...state,
      ...patch,
      busyUnitIds: busyNow(),
      pending: pending.list(),
      ownInFlight: ownInFlightNow(),
      resolutions: pending.resolutions(),
      create: primary.state(),
      storage,
      recoveries: recoveries(),
      unreadable,
      formerSchool,
      // A completed check reports exactly the units ITS response returned
      // (never a unit it omitted, even if a later or overlapping active-only
      // load lists one), each shown with its latest accepted record so a
      // rename since is reflected; a unit found absent since is dropped.
      recoveryCheck:
        recoveryCheck.kind === "checked"
          ? Object.freeze({ kind: "checked", units: checkedUnits() })
          : recoveryCheck,
    });
    for (const l of Array.from(listeners)) {
      try {
        l();
      } catch {
        // A listener failure never breaks the controller.
      }
    }
  };

  const visible = (u: TeacherUnit): boolean =>
    u.grade === state.grade && (state.showArchived || u.status === "active");

  // ---------- State consistency model (U2.3, TEACHER_UNITS.md) ----------
  //
  // One logical `clock` orders client events. Every request reads it when
  // it is DISPATCHED; a confirmed write also reads it when its response is
  // RECEIVED. Evidence about a unit is stamped by what it can prove:
  // - Reads (list, get, Check my units, a create REPLAY, and any no-op
  //   response, which wrote nothing) observed the server at some moment
  //   after dispatch, so they carry their dispatch stamp. A response never
  //   gains authority by arriving late.
  // - A confirmed write (first create, update, archive, restore, membership
  //   change) committed before its response was received, so it carries
  //   its receipt stamp: only a read dispatched AFTER the confirmation can
  //   outrank it. A read that overlapped the write may have observed the
  //   server before the commit and never hides or rolls it back.
  // Per unit the controller keeps:
  // - `known`: the full authoritative record with the HIGHEST revision
  //   seen (status, title, and resources included, even when hidden).
  //   Revisions are server-monotonic, so content never moves backwards.
  //   Records and presence are ordered independently: a record is kept
  //   even while the newest evidence says the unit is absent (callers then
  //   see no held unit), so a later read can never lower its revision.
  // - `presence`: the newest evidence of where the unit stands, with its
  //   stamp: "present" (returned by a read or write), "notActive" (omitted
  //   by an active-only list it was in scope for: archived, or gone; its
  //   current contents are unknown), or "absent" (`notFound`, or omitted by
  //   a list that includes archived units). Older evidence never replaces
  //   newer evidence; any newer evidence does, so nothing is tombstoned.
  // The visible list is a projection: "present" units of the selected grade
  // (and status). It is never evidence about a unit; `getUnitState` is.
  // This is client ordering only. Authorization and `expectedRevision`
  // stay server-enforced; nothing here is ever resent.
  // A3-4 S2 (P2-4): the clock is the registry's, shared by every controller
  // of this teacher and school, so evidence a replaced controller accepted
  // is ordered against this controller's own reads.
  const tick = (): number => pending.stamp();
  type Presence = { readonly at: number; readonly kind: "present" | "notActive" | "absent" };
  const presence = new Map<string, Presence>();
  // A list is evidence about its whole scope, including units this
  // controller has never seen (for example one a delayed create replay is
  // about to return). The newest list per scope is kept.
  type ListScope = {
    readonly at: number;
    readonly grade: TeacherUnitGrade | null; // null: every grade
    readonly includeArchived: boolean;
    readonly ids: ReadonlySet<string>;
  };
  const scopes = new Map<string, ListScope>();
  // Combines two pieces of evidence. The newer one wins, except that an
  // active-only omission ("archived, or gone") and a full-scope absence are
  // consistent, and the absence is the more informative: in either order
  // the unit stays "absent" (as of the newer stamp). Only a positive read
  // restores presence.
  const merged = (prev: Presence | undefined, next: Presence): Presence => {
    if (prev === undefined) return next;
    const newer = prev.at > next.at ? prev : next;
    const kinds = new Set([prev.kind, next.kind]);
    return kinds.has("absent") && kinds.has("notActive") ? { at: newer.at, kind: "absent" } : newer;
  };
  const recordScope = (scope: ListScope): void => {
    const key = `${scope.grade ?? "*"}:${scope.includeArchived}`;
    const prev = scopes.get(key);
    if (prev === undefined || prev.at < scope.at) scopes.set(key, scope);
  };
  // The newest list omission of `u` dispatched after `after`, if any. An
  // active-only list says nothing new about a unit whose newest record is
  // already archived (the same rule `acceptList` applies to held units).
  const omissionAfter = (u: TeacherUnit, after: number): Presence | null => {
    const newest = known.get(u.unitId) ?? u;
    let found: Presence | null = null;
    for (const sc of scopes.values()) {
      if (sc.at <= after || (found !== null && sc.at <= found.at)) continue;
      if ((sc.grade !== null && sc.grade !== u.grade) || sc.ids.has(u.unitId)) continue;
      if (!sc.includeArchived && newest.status !== "active") continue;
      found = { at: sc.at, kind: sc.includeArchived ? "absent" : "notActive" };
    }
    return found;
  };

  const unitsWhere = (kinds: ReadonlyArray<Presence["kind"]>): TeacherUnit[] =>
    Array.from(known.values()).filter((u) => {
      const p = presence.get(u.unitId);
      return p !== undefined && kinds.includes(p.kind);
    });

  const listedNow = (): UnitsListState =>
    Object.freeze({
      kind: "ready",
      units: Object.freeze(unitsWhere(["present"]).filter(visible).sort(compareTeacherUnits)),
    });

  // Record one unit returned by a request whose evidence stamp is `at`.
  // Returns the record now held (which may be newer), or null when newer
  // evidence says the unit is not there.
  const accept = (unit: TeacherUnit, at: number): TeacherUnit | null => {
    let p = presence.get(unit.unitId);
    const omitted = omissionAfter(unit, p?.at ?? -1);
    if (omitted !== null) {
      p = merged(p, omitted);
      presence.set(unit.unitId, p);
    }
    // Content only moves forward, whatever the presence evidence: a record
    // is kept even when newer evidence says the unit is absent, so a later
    // read that finds it again can never lower its revision.
    const held = known.get(unit.unitId);
    if (held === undefined || unit.revision > held.revision) known.set(unit.unitId, unit);
    // Shared with every controller of this scope (revision-monotonic).
    quietly(() => pending.accept(unit, at));
    const now = known.get(unit.unitId) as TeacherUnit;
    if (p !== undefined && p.at > at && p.kind === "absent") {
      // Third remediation F2: absence and records are ordered by ONE rule,
      // the registry's (`isPresent`): a record outranks an absence it
      // overlapped only when its revision was first seen after the absent
      // read began. When that rule says present, so does this controller.
      const ev = pending.latest(unit.unitId);
      if (ev === null || !isPresent(ev)) return null;
      presence.set(unit.unitId, { at: p.at, kind: "present" });
      relist();
      return now;
    }
    if (p !== undefined && p.at > at && p.kind === "notActive") {
      return now.status === "archived" ? now : null;
    }
    if (p === undefined || p.at <= at) presence.set(unit.unitId, { at, kind: "present" });
    return now;
  };

  // The record callers may act on: none while the newest evidence says the
  // unit is absent (as if never held), the highest revision otherwise.
  const heldUnit = (unitId: string): TeacherUnit | undefined =>
    presence.get(unitId)?.kind === "absent" ? undefined : known.get(unitId);

  const checkedUnits = (): ReadonlyArray<TeacherUnit> =>
    Object.freeze(
      checkedIds
        .filter((id) => presence.get(id)?.kind !== "absent")
        .map((id) => known.get(id))
        .filter((u): u is TeacherUnit => u !== undefined)
        .sort(compareTeacherUnits),
    );

  const relist = (): void => {
    if (state.list.kind === "ready") set({ list: listedNow() });
  };

  const adopt = (unit: TeacherUnit, at: number): TeacherUnit | null => {
    const held = accept(unit, at);
    relist();
    return held;
  };

  // `notFound` observed by a request dispatched at `at`. Presence only: the
  // highest-revision record seen stays (see `accept`).
  const drop = (unitId: string, at: number, share = true): void => {
    // Authoritative absence is shared with every controller of the scope.
    if (share) quietly(() => pending.markAbsent(unitId, at));
    const p = presence.get(unitId);
    if (p !== undefined && p.at > at) return;
    presence.set(unitId, { at, kind: "absent" });
    relist();
  };

  // Apply a list dispatched at `at`. A held unit within its scope that the
  // response omits is recorded `omitted` ("notActive" for an active-only
  // list, "absent" when archived units were included).
  const acceptList = (
    units: ReadonlyArray<TeacherUnit>,
    at: number,
    scope: { readonly grade: TeacherUnitGrade | null; readonly includeArchived: boolean },
  ): void => {
    const ids = new Set(units.map((u) => u.unitId));
    const omitted = scope.includeArchived ? "absent" : "notActive";
    const inScope = (u: TeacherUnit): boolean =>
      (scope.grade === null || u.grade === scope.grade) && (scope.includeArchived || u.status === "active");
    for (const u of units) accept(u, at);
    recordScope({ at, ...scope, ids });
    for (const [unitId, u] of known) {
      if (ids.has(unitId) || !inScope(u)) continue;
      presence.set(unitId, merged(presence.get(unitId), { at, kind: omitted }));
      // Complete for absence: archived units were included, and a unit's
      // grade never changes (see `publishListAbsence`).
      if (scope.includeArchived) quietly(() => pending.markAbsent(unitId, at));
    }
  };

  const load = async (): Promise<void> => {
    if (!alive()) return;
    const seq = ++loadSeq;
    const at = tick();
    const grade = state.grade;
    const includeArchived = state.showArchived;
    set({ list: { kind: "loading" } });
    const outcome = await runTeacherUnitMutation(() => deps.callables.list({ grade, includeArchived }));
    // A replaced controller still shares what its read established. A live
    // one applies it locally first (which shares it), so its own evidence
    // never comes back to it as another controller's.
    if (!alive()) {
      if (outcome.ok) shareList(outcome.result.units, at, { grade, includeArchived });
      return;
    }
    if (seq !== loadSeq) return;
    if (outcome.ok) {
      acceptList(outcome.result.units, at, { grade, includeArchived });
      quietly(() => publishListAbsence(outcome.result.units, at, { grade, includeArchived }));
      set({ list: listedNow() });
    } else {
      set({ list: { kind: "error", error: outcome.error } });
    }
  };

  const busy = (unitId: string, on: boolean): void => {
    if (on) ownBusy.add(unitId);
    else ownBusy.delete(unitId);
    set({});
  };

  // When a successful list is COMPLETE for absence: it included archived
  // units (an active-only list omits archived units, so its omissions prove
  // nothing), and it covered every grade or the unit's own grade (the
  // server stamps a unit's grade at creation and never changes it). The
  // server refuses a list above its ceiling (listLimitExceeded) instead of
  // truncating it, so a successful list is never partial. A unit in scope
  // that such a list omits is not in this teacher's units now. Failed lists
  // say nothing. Units known only from the shared registry are covered too.
  const publishListAbsence = (
    units: ReadonlyArray<TeacherUnit>,
    at: number,
    scope: { readonly grade: TeacherUnitGrade | null | undefined; readonly includeArchived: boolean | undefined },
  ): void => {
    if (scope.includeArchived !== true) return;
    const listed = new Set(units.map((u) => u.unitId));
    for (const ev of pending.units()) {
      if (listed.has(ev.unitId) || ev.unit === null) continue;
      if (scope.grade !== null && scope.grade !== undefined && ev.unit.grade !== scope.grade) continue;
      pending.markAbsent(ev.unitId, at);
    }
  };

  // A replaced controller's list result: records and complete-list absence.
  const shareList = (
    units: ReadonlyArray<TeacherUnit>,
    at: number,
    scope: { readonly grade: TeacherUnitGrade | null | undefined; readonly includeArchived: boolean | undefined },
  ): void => {
    for (const u of units) pending.accept(u, at);
    publishListAbsence(units, at, scope);
  };

  // Adopts the scope's shared evidence (P2-4): records another controller
  // of this teacher and school accepted, including a replaced controller's
  // late reread or confirmed write. Each keeps the stamp it was accepted
  // with, so the controller's own ordering (revision-monotonic content,
  // newest-evidence presence) decides, never arrival order.
  // True when this controller adopted anything.
  const syncShared = (): boolean => {
    let changed = false;
    for (const ev of pending.units()) {
      if (ev.unit !== null) {
        const held = known.get(ev.unitId);
        const p = presence.get(ev.unitId);
        const skip =
          (held !== undefined && held.revision > ev.unit.revision) ||
          (held !== undefined && held.revision === ev.unit.revision && p !== undefined && p.at >= ev.at);
        if (!skip) {
          accept(ev.unit, ev.at);
          changed = true;
        }
      }
      // Shared authoritative absence (a late notFound of a replaced
      // controller, another controller's complete list), as the registry
      // orders it against records (`isPresent`). Adopted at the stamp it was
      // received, so a read that overlapped it never hides it; and released
      // the moment the same rule says a record outranks it (F2).
      if (ev.absentAt >= 0) {
        const p = presence.get(ev.unitId);
        if (!isPresent(ev) && (p === undefined || p.kind !== "absent")) {
          drop(ev.unitId, ev.absentSeenAt, false);
          changed = true;
        } else if (isPresent(ev) && p !== undefined && p.kind === "absent" && known.has(ev.unitId)) {
          presence.set(ev.unitId, { at: Math.max(p.at, ev.at), kind: "present" });
          changed = true;
        }
      }
    }
    return changed;
  };

  // D3 (P2-1, F1): checked before ANY answer that relies on held state,
  // including local no-ops and archived or unavailable-resource refusals,
  // so a cached value is never reported as saved or as needing no change
  // while an earlier change to the unit is unconfirmed.
  const heldStateBlock = (unitId: string): UnitMutationResult | null => {
    if (!alive()) return { kind: "stale" };
    if (pending.hasInFlight(unitId)) return { kind: "busy" };
    if (pending.requiresFreshRead(unitId)) return { kind: "needsCheck" };
    return null;
  };

  // Read one unit (a get, never a mutation); returns the unit now held (null
  // when it could not be read or no longer exists). The observation reaches
  // pending entries even when this controller was replaced meanwhile.
  const reread = async (unitId: string): Promise<TeacherUnit | null | "stale"> => {
    const at = tick();
    const fresh = await runTeacherUnitMutation(() => deps.callables.get({ unitId }));
    pending.observe(
      unitId,
      fresh.ok
        ? { kind: "unit", unit: fresh.result.unit }
        : fresh.error.category === "notFound"
          ? { kind: "notFound" }
          : { kind: "unavailable" },
      at,
    );
    if (!alive()) return "stale";
    if (fresh.ok) return adopt(fresh.result.unit, at);
    if (fresh.error.category === "notFound") drop(unitId, at);
    return null;
  };

  // A pending entry's read: marks it checking while the get is outstanding.
  const readForEntry = async (entry: PendingMutationEntry): Promise<TeacherUnit | null | "stale"> => {
    const id = entry.record.id;
    pending.setChecking(id, true);
    try {
      return await reread(entry.record.unitId);
    } finally {
      pending.setChecking(id, false);
    }
  };

  // The single automatic reread of uncertain entries this controller did not
  // dispatch: their own controller was replaced before it could read (for
  // example the teacher left My Units while the request was in flight).
  const claimAutomaticReads = (): void => {
    if (!alive()) return;
    for (const e of pending.list()) {
      if (e.status !== "uncertain" || e.failure === null) continue;
      // The sending controller is still current: the read is its own.
      if (pending.ownerActive(e.record.id)) continue;
      if (!shouldRereadAfter(e.failure)) continue;
      if (pending.claimAutomaticRead(e.record.id)) void readForEntry(e);
    }
  };

  // Shared handling for revision-guarded single-unit mutations. `plan`
  // builds the request from the record held at dispatch and states what it
  // asks for (the pending record's intent).
  //
  // A3-4 S2. The request is sent exactly once. Its pending record is opened
  // at dispatch and closed only by a confirmed success or a proven non-commit
  // (isUncertainMutationFailure). Every other failure keeps the record as
  // uncertain and, where useful (shouldRereadAfter), performs at most one
  // automatic authoritative get. Nothing here ever resends the request.
  const mutate = async (
    unitId: string,
    plan: (current: TeacherUnit) => {
      readonly intent: PendingUnitMutationIntent;
      readonly send: () => Promise<{ readonly unit: TeacherUnit; readonly noop: boolean }>;
    },
  ): Promise<UnitMutationResult> => {
    if (!alive()) return { kind: "stale" };
    // An earlier controller's request for this unit has no response yet.
    if (pending.hasInFlight(unitId)) return { kind: "busy" };
    // D3 (P2-1): after an unconfirmed outcome, nothing is sent from state
    // held before it. An accepted authoritative read since (or a newer
    // revision) is required first; a failed read never counts.
    if (pending.requiresFreshRead(unitId)) return { kind: "needsCheck" };
    const current = heldUnit(unitId);
    if (current === undefined) {
      return { kind: "error", error: normalizeTeacherUnitError({ details: { code: "teacherUnits.notFound" } }) };
    }
    // Mutation eligibility. A retained record is not evidence the unit can
    // be changed: when the newest evidence (an active-only omission) says
    // it is no longer active but the record still says active, nothing is
    // sent. The unit is read instead (a read, never a resend) and reported
    // like a server refusal, so the teacher decides again with fresh state.
    if (presence.get(unitId)?.kind === "notActive" && current.status === "active") {
      const latest = await reread(unitId);
      if (latest === "stale") return { kind: "stale" };
      if (latest !== null && latest.status === "archived") {
        return {
          kind: "archived",
          latest,
          error: normalizeTeacherUnitError({ details: { code: "teacherUnits.invalidStatus" } }),
        };
      }
      return {
        kind: "conflict",
        latest,
        error: normalizeTeacherUnitError({ details: { code: "teacherUnits.writeConflict" } }),
      };
    }
    if (gate.isBusy(unitId)) return { kind: "busy" };
    // Bounded tracking (pendingMutations.ts): at capacity nothing is sent,
    // so no record or guard is ever dropped to make room.
    const full = pending.capacityReason(unitId);
    if (full !== null) return { kind: "capacity", reason: full };
    const at = tick();
    const step = plan(current);
    // Opened quietly: this controller renders it only once its unit is
    // marked busy below, so the sending panel never lists its own request
    // as unconfirmed. Other controllers are still notified.
    const entryId = quietly(() =>
      pending.begin({
        unitId,
        expectedRevision: current.revision,
        intent: step.intent,
        titleAtRequest: current.title,
        ownerActive: alive,
      }),
    );
    // Never sent without its record (scope changed, or capacity reached).
    if (entryId === null) {
      return alive() ? { kind: "capacity", reason: pending.capacityReason(unitId) ?? "pending" } : { kind: "stale" };
    }
    // The record this request is based on is shared as its revision floor
    // (after `begin`, so the entry protects it from pruning): evidence pruned
    // earlier can never let an older read, or different content at the
    // base, count as a recovery (third remediation F1). Its original stamp
    // is kept, so it is not mistaken for a fresh read.
    quietly(() => pending.accept(current, presence.get(unitId)?.at ?? 0));
    const dispatched = gate.run(unitId, () => runTeacherUnitMutation(step.send));
    if (dispatched === null) {
      pending.settle(entryId);
      return { kind: "busy" };
    }
    busy(unitId, true);
    const raw = await dispatched;
    // Seventh remediation P2. Backend contract (teacher-unit-mutation.ts): a
    // state-changing write commits `expectedRevision + 1` and its response is
    // a later read, so its revision is ABOVE this request's base (it may be
    // more than base + 1 when another write landed in between; that is
    // valid). A non-no-op success at or below the base cannot be this
    // request's commit: it is internally inconsistent. It is handled exactly
    // like any other uncertain result (pending record kept, never resent,
    // never announced as saved, input kept), and its unit is not accepted as
    // evidence. Nothing is claimed about whether the server committed. Its
    // automatic read is not made here (a response that just contradicted the
    // contract is not followed by an immediate read; the teacher's Check
    // current state is the recovery), so at most one automatic read can
    // still happen, by a replacement controller.
    const outcome =
      raw.ok && !raw.result.noop && !(raw.result.unit.revision > current.revision)
        ? Object.freeze({ ok: false as const, error: INCONSISTENT_WRITE_RESPONSE })
        : raw;
    // Settled before the lifetime check: a replaced controller still closes
    // or keeps its own record, and shares a confirmed result, while the
    // canonical context is unchanged (the registry refuses otherwise). It
    // never touches a newer panel directly: the current controller adopts
    // the shared evidence (P2-4).
    const id: string | null = entryId;
    const live = alive();
    const uncertain = !outcome.ok && isUncertainMutationFailure(outcome.error);
    // A no-op wrote nothing: it is a read. A write is stamped on receipt.
    const resultAt = outcome.ok && !outcome.result.noop ? tick() : at;
    if (outcome.ok) pending.accept(outcome.result.unit, resultAt);
    if (id !== null) {
      if (uncertain) pending.markUncertain(id, outcome.error as TeacherUnitError);
      else {
        pending.settle(
          id,
          live ? undefined : outcome.ok ? (outcome.result.noop ? "noop" : "saved") : "notMade",
          // Only a confirmed STATE-CHANGING write can settle the unit's
          // earlier uncertainty; a no-op never does (fifth remediation P2).
          // The proof is this response's own revision, never the registry's
          // current record (sixth remediation; checked against this
          // request's base in pendingMutations.ts `settlesEarlier`).
          outcome.ok && !outcome.result.noop ? { committedRevision: outcome.result.unit.revision } : false,
        );
      }
    }
    if (!alive()) return { kind: "stale" };
    busy(unitId, false);
    if (outcome.ok) {
      adopt(outcome.result.unit, resultAt);
      return { kind: "saved", unit: outcome.result.unit, noop: outcome.result.noop };
    }
    const error = outcome.error;
    if (error.category === "notFound") {
      drop(unitId, at);
      return { kind: "error", error };
    }
    if (!uncertain || !shouldRereadAfter(error)) return { kind: "error", error };
    if (outcome !== raw) return { kind: "uncertain", latest: null, error };
    // The single automatic reread: fetch the authoritative unit; never
    // resend the request. The read shows current state only: it cannot
    // prove whether this request (or an earlier SDK attempt of it)
    // committed.
    const reads = id === null || pending.claimAutomaticRead(id);
    const latest = reads ? await reread(unitId) : null;
    if (latest === "stale") return { kind: "stale" };
    if (error.category === "conflict" || error.category === "invalidStatus") {
      if (latest !== null && latest.status === "archived") return { kind: "archived", latest, error };
      if (error.category === "invalidStatus") return { kind: "archived", latest, error };
      return { kind: "conflict", latest, error };
    }
    return { kind: "uncertain", latest, error };
  };

  // U2.3 membership. Archived units are refused before sending (the server
  // refuses them too, TEACHER_UNITS.md §9.1). A failure whose outcome is
  // unknown (network, malformed response) is reconciled by reading the
  // unit, never by resending: a later deliberate attempt carries the
  // re-read revision, so it cannot overwrite another session's change.
  const setMembership = async (
    unitId: string,
    purpose: "add" | "remove" | "move" | "repair",
    next: (current: TeacherUnit) => ReadonlyArray<string> | null,
  ): Promise<UnitMutationResult> => {
    const blocked = heldStateBlock(unitId);
    if (blocked !== null) return blocked;
    const held = heldUnit(unitId);
    if (held !== undefined && held.status !== "active") {
      return {
        kind: "archived",
        latest: held,
        error: normalizeTeacherUnitError({ details: { code: "teacherUnits.invalidStatus" } }),
      };
    }
    if (held !== undefined && next(held) === null) return { kind: "saved", unit: held, noop: true };
    let sent: MembershipCommit | null = null;
    const result = await mutate(unitId, (u) => {
      const resourceIds = next(u) ?? u.resourceIds;
      sent = Object.freeze({ revision: u.revision + 1, previous: u.resourceIds, resourceIds });
      return {
        intent: { op: "setResources", purpose, resourceIds },
        send: () => deps.callables.setResources({ unitId, expectedRevision: u.revision, resourceIds }),
      };
    });
    if (result.kind === "saved" && !result.noop && sent !== null) return { ...result, committed: sent };
    if (result.kind !== "error" || result.error.category !== "resourceRejected") return result;
    // A placement refusal is definitive (decided in request validation,
    // nothing written) but means the held list may be stale: show the
    // authoritative unit with the refusal. A read, never a resend.
    const latest = await reread(unitId);
    if (latest === "stale") return { kind: "stale" };
    return result;
  };

  // Retired = stored in the unit but not RA-1 unitPlaceable in this client.
  const isRetired = (id: string): boolean => getPlaceableResourceById(id) === null;
  const retiredIds = (u: TeacherUnit): ReadonlyArray<string> => u.resourceIds.filter(isRetired);

  // A list the server would refuse (it still names a retired id) is not
  // sent. `removing` is the one id the request drops, if any.
  const retiredBlock = (unitId: string, removing: string | null): UnitMutationResult | null => {
    const held = heldUnit(unitId);
    if (held === undefined || held.status !== "active") return null;
    const remaining = retiredIds(held).filter((id) => id !== removing);
    if (remaining.length === 0) return null;
    return {
      kind: "error",
      error: Object.freeze({
        ...normalizeTeacherUnitError({ details: { code: "teacherUnits.resourceNotPlaceable", resourceIds: remaining } }),
        message:
          "This unit has resources that are no longer available. Remove them first, then change this unit's resources.",
      }),
    };
  };

  const coordinatorForKey = (key: string): CreateUnitCreateCoordinator | null => {
    const r = restored.get(key);
    if (r !== undefined) return r;
    const p = primary.state();
    return "key" in p && p.key === key ? primary : null;
  };

  // A create that committed now (`replayed: false`) is a write, stamped on
  // receipt; a replay returns the unit's current state as read by the
  // server after dispatch, so it is a read stamped at dispatch.
  const createdAt = (replayed: boolean, dispatchedAt: number): number =>
    replayed ? dispatchedAt : tick();

  // A restored attempt that reconciled to a confirmed unit leaves the
  // recovery list; its unit is adopted.
  const settleRestored = (key: string, dispatchedAt: number): void => {
    const c = restored.get(key);
    if (c === undefined) return;
    const s = c.state();
    if (s.kind === "created") {
      restored.delete(key);
      adopt(s.unit, createdAt(s.replayed, dispatchedAt));
      set({ lastConfirmed: { unit: s.unit, replayed: s.replayed } });
    }
  };

  const controller: TeacherUnitsController = Object.freeze({
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setGrade: (grade: TeacherUnitGrade) => {
      if (!alive() || grade === state.grade) return;
      set({ grade });
      void load();
    },
    setShowArchived: (show: boolean) => {
      if (!alive() || show === state.showArchived) return;
      set({ showArchived: show });
      void load();
    },
    refresh: () => load(),
    loadActiveUnits: async () => {
      if (!alive()) return false;
      const at = tick();
      const scope = { grade: null, includeArchived: false } as const;
      const outcome = await runTeacherUnitMutation(() => deps.callables.list({ includeArchived: false }));
      if (!alive()) {
        if (outcome.ok) shareList(outcome.result.units, at, scope);
        return false;
      }
      if (!outcome.ok) return false;
      acceptList(outcome.result.units, at, scope);
      if (state.list.kind === "ready") set({ list: listedNow() });
      else set({});
      return true;
    },
    activeUnits: () =>
      Object.freeze(
        unitsWhere(["present"])
          .filter((u) => u.status === "active")
          .sort((a, b) => (a.grade === b.grade ? compareTeacherUnits(a, b) : a.grade < b.grade ? -1 : 1)),
      ),
    getKnownUnit: (unitId: string) => heldUnit(unitId) ?? null,
    getUnitState: (unitId: string): UnitStateView => {
      const p = presence.get(unitId);
      const u = known.get(unitId);
      if (p === undefined) return UNKNOWN_UNIT;
      if (p.kind === "absent") return ABSENT_UNIT;
      if (p.kind === "notActive" || u === undefined) return NOT_ACTIVE_UNIT;
      return Object.freeze({ kind: u.status === "archived" ? "archived" : "active", unit: u });
    },
    submitCreate: async (payload) => {
      if (!alive()) return;
      // Discover attempts saved since mount (for example by another tab).
      // A UX guard only: attempts that race past it still each keep their
      // own durable record.
      scan();
      const pending = recoveries().some((e) => !e.own) || unreadable.length > 0;
      if (pending) {
        set({ createBlocked: "recoveryPending" });
        return;
      }
      const dispatchedAt = tick();
      const result = primary.submit(payload);
      const s = primary.state();
      if (s.kind === "inFlight") ownKeys.add(s.key);
      set({ createBlocked: null, lastConfirmed: null });
      const settled = await result;
      if (!alive()) return;
      if (settled.kind === "blocked") {
        set({ createBlocked: settled.reason });
        return;
      }
      const after = primary.state();
      if (after.kind === "created") adopt(after.unit, createdAt(after.replayed, dispatchedAt));
      set({ createBlocked: null, recoveryCheck: { kind: "none" } });
    },
    reconcileCreate: async (key, options) => {
      if (!alive()) return;
      const c = coordinatorForKey(key);
      if (c === null) return;
      const dispatchedAt = tick();
      const result = c.reconcile(options);
      set({ createBlocked: null });
      const settled = await result;
      if (!alive()) return;
      if (settled.kind === "blocked") {
        set({ createBlocked: settled.reason });
        return;
      }
      if (c === primary) {
        const after = primary.state();
        if (after.kind === "created") {
          adopt(after.unit, createdAt(after.replayed, dispatchedAt));
          set({ lastConfirmed: { unit: after.unit, replayed: after.replayed } });
        }
      } else {
        settleRestored(key, dispatchedAt);
      }
      set({ createBlocked: null });
    },
    checkRecovery: async () => {
      if (!alive()) return;
      scan();
      set({ recoveryCheck: { kind: "checking" } });
      const at = tick();
      // Every grade and status: the unit may have been archived since.
      const outcome = await runTeacherUnitMutation(() =>
        deps.callables.list({ includeArchived: true }),
      );
      // Every grade and status was in scope: an omitted unit is not in this
      // teacher's units now (shared; see `load` for the order).
      const all = { grade: null, includeArchived: true } as const;
      if (!alive()) {
        if (outcome.ok) shareList(outcome.result.units, at, all);
        return;
      }
      if (!outcome.ok) {
        set({ recoveryCheck: { kind: "error", error: outcome.error } });
        return;
      }
      acceptList(outcome.result.units, at, all);
      quietly(() => publishListAbsence(outcome.result.units, at, all));
      checkedIds = Object.freeze(outcome.result.units.map((u) => u.unitId));
      // `units` is projected from the latest accepted state on every update
      // (see `set`), so recovery hints never show an older title.
      set({ recoveryCheck: { kind: "checked", units: Object.freeze([]) } });
      void load();
    },
    abandonCreate: (key) => {
      if (!alive()) return false;
      const c = coordinatorForKey(key);
      if (c === null) return false;
      const s = c.state();
      if (s.kind !== "unresolved") return false;
      if (requiresCheck(s) && state.recoveryCheck.kind !== "checked") {
        set({ createBlocked: "checkRequired" });
        return false;
      }
      const ok = c.abandon();
      set({ createBlocked: null });
      return ok;
    },
    dismissAbandoned: (key) => {
      if (!alive()) return false;
      const c = restored.get(key);
      if (c === undefined || c.state().kind !== "abandoned") return false;
      const ok = c.beginNewUnit();
      if (ok) restored.delete(key);
      set({ createBlocked: ok ? null : "storageUnavailable" });
      return ok;
    },
    beginNewUnit: () => {
      if (!alive()) return false;
      const ok = primary.beginNewUnit();
      set({
        createBlocked: ok ? null : "storageUnavailable",
        recoveryCheck: { kind: "none" },
        lastConfirmed: null,
      });
      return ok;
    },
    discardUnreadableAttempt: (storageKey) => {
      if (!alive() || !unreadable.includes(storageKey)) return false;
      if (state.recoveryCheck.kind !== "checked") {
        set({ createBlocked: "checkRequired" });
        return false;
      }
      const ok = deps.store.discardUnreadable(storageKey);
      if (ok) unreadable = unreadable.filter((k) => k !== storageKey);
      set({ createBlocked: ok ? null : "storageUnavailable" });
      return ok;
    },
    updateUnit: async (unitId, edit) => {
      const current = heldUnit(unitId);
      const request: { title?: string; description?: string; color?: TeacherUnitColor | null } = {};
      if (edit.title !== undefined) {
        const msg = validateUnitTitle(edit.title);
        if (msg !== null) return { kind: "invalid", field: "title", message: msg };
        if (current === undefined || edit.title.trim() !== current.title) request.title = edit.title.trim();
      }
      if (edit.description !== undefined) {
        const msg = validateUnitDescription(edit.description);
        if (msg !== null) return { kind: "invalid", field: "description", message: msg };
        if (current === undefined || edit.description.trim() !== current.description) {
          request.description = edit.description.trim();
        }
      }
      if (edit.color !== undefined && (current === undefined || edit.color !== current.color)) {
        request.color = edit.color;
      }
      const blocked = heldStateBlock(unitId);
      if (blocked !== null) return blocked;
      if (
        current !== undefined &&
        request.title === undefined &&
        request.description === undefined &&
        request.color === undefined
      ) {
        return { kind: "saved", unit: current, noop: true };
      }
      return mutate(unitId, (u) => ({
        intent: { op: "update", ...request },
        send: () => deps.callables.update({ unitId, expectedRevision: u.revision, ...request }),
      }));
    },
    archiveUnit: (unitId) =>
      mutate(unitId, (u) => ({
        intent: { op: "archive" },
        send: () => deps.callables.archive({ unitId, expectedRevision: u.revision }),
      })),
    restoreUnit: (unitId) =>
      mutate(unitId, (u) => ({
        intent: { op: "restore" },
        send: () => deps.callables.restore({ unitId, expectedRevision: u.revision }),
      })),
    addResources: (unitId, resourceIds) => {
      const guarded = heldStateBlock(unitId);
      if (guarded !== null) return Promise.resolve(guarded);
      const blocked = retiredBlock(unitId, null);
      if (blocked !== null) return Promise.resolve(blocked);
      for (const id of resourceIds) {
        if (getPlaceableResourceById(id) === null) {
          return Promise.resolve<UnitMutationResult>({
            kind: "error",
            error: normalizeTeacherUnitError({
              details: { code: "teacherUnits.resourceNotPlaceable", resourceIds: [id] },
            }),
          });
        }
      }
      // Duplicates are filtered against the held server list; the server
      // still refuses any duplicate it sees (`duplicateResource`).
      const appended = (u: TeacherUnit): ReadonlyArray<string> | null => {
        const present = new Set(u.resourceIds);
        const added: string[] = [];
        for (const id of resourceIds) {
          if (present.has(id)) continue;
          present.add(id);
          added.push(id);
        }
        return added.length === 0 ? null : [...u.resourceIds, ...added];
      };
      const held = heldUnit(unitId);
      const next = held === undefined ? null : appended(held);
      if (next !== null && next.length > TEACHER_UNIT_RESOURCES_MAX) {
        return Promise.resolve<UnitMutationResult>({
          kind: "error",
          error: Object.freeze({
            ...normalizeTeacherUnitError({ details: { code: "teacherUnits.invalidResourceIds" } }),
            message: `A unit can hold up to ${TEACHER_UNIT_RESOURCES_MAX} resources. Remove some before adding more.`,
          }),
        });
      }
      return setMembership(unitId, "add", appended);
    },
    removeResource: (unitId, resourceId) => {
      const guarded = heldStateBlock(unitId);
      if (guarded !== null) return Promise.resolve(guarded);
      const blocked = retiredBlock(unitId, resourceId);
      if (blocked !== null) return Promise.resolve(blocked);
      return setMembership(unitId, "remove", (u) =>
        u.resourceIds.includes(resourceId) ? u.resourceIds.filter((id) => id !== resourceId) : null,
      );
    },
    removeRetiredResources: (unitId) =>
      setMembership(unitId, "repair", (u) =>
        retiredIds(u).length === 0 ? null : u.resourceIds.filter((id) => !isRetired(id)),
      ),
    moveResource: (unitId, resourceId, direction) => {
      const guarded = heldStateBlock(unitId);
      if (guarded !== null) return Promise.resolve(guarded);
      const blocked = retiredBlock(unitId, null);
      if (blocked !== null) return Promise.resolve(blocked);
      // Computed from the record held at dispatch, so the permutation and
      // its expectedRevision come from the same snapshot: a resource added
      // or removed elsewhere means a newer revision, and the server refuses
      // the stale list instead of dropping it.
      return setMembership(unitId, "move", (u) => {
        const next = moveIdByStep(u.resourceIds, resourceId, direction === "up" ? -1 : 1);
        return next === u.resourceIds ? null : next;
      });
    },
    moveResourceTo: (unitId, resourceId, toIndex) => {
      const guarded = heldStateBlock(unitId);
      if (guarded !== null) return Promise.resolve(guarded);
      const blocked = retiredBlock(unitId, null);
      if (blocked !== null) return Promise.resolve(blocked);
      // Computed from the record held at dispatch, like `moveResource`.
      return setMembership(unitId, "move", (u) => {
        const next = moveIndex(u.resourceIds, u.resourceIds.indexOf(resourceId), toIndex);
        return next === u.resourceIds ? null : next;
      });
    },
    checkPendingMutation: async (id) => {
      if (!alive()) return;
      const entry = pending.list().find((e) => e.record.id === id);
      if (entry === undefined || entry.status !== "uncertain" || entry.checking) return;
      await readForEntry(entry);
    },
    dismissPendingMutation: (id) => {
      if (!alive()) return false;
      return pending.dismiss(id);
    },
    dispose: () => {
      disposed = true;
      unsubscribePending();
      listeners.clear();
    },
  });

  // Another controller of this teacher and school settled, observed, or
  // dismissed a pending entry: show it, and take over any automatic reread
  // that controller could no longer make.
  const unsubscribePending = pending.subscribe(() => {
    if (!alive() || ownWrite > 0) return;
    // Only evidence this controller did not already hold re-projects the
    // list; its own acceptance never does more than it did before.
    if (syncShared() && state.list.kind === "ready") set({ list: listedNow() });
    else set({});
    claimAutomaticReads();
  });

  // Start from what this scope already established (a remount), before
  // this controller's own first read, which is newer evidence.
  syncShared();
  void load();
  claimAutomaticReads();
  return controller;
}

// ---------- Surface seam ----------
//
// What the Curriculum surface receives when the feature gate is open (null
// otherwise). The shell never touches Firebase or storage: the entry point
// binds the callables, the Firebase uid reader, and the scoped store here.
export type TeacherUnitsSurfaceSeam = {
  readonly capability?: TeacherUnitsCapabilityState;
  readonly dispose?: () => void;
  readonly createController: (input: {
    readonly uid: string;
    readonly schoolId: string;
    readonly initialGrade: TeacherUnitGrade;
  }) => TeacherUnitsController;
};

// The seam's `readActiveTeacher` for ONE bootstrap run (U2.3 remediation).
// It names that run's own resolved session, and only while that run is
// still current AND the app's active-teacher slot holds that same session
// object. A cached teacher from an earlier run (for example the same uid
// at a former school, still held while a new run is finishing) therefore
// never makes a controller current, and every new run, sign-out, or
// account switch makes earlier controllers stale. The server re-verifies
// identity and school on every call regardless.
export function bootstrapActiveTeacherReader<
  S extends { readonly uid: string; readonly schoolId: string },
>(run: {
  readonly runToken: number;
  readonly session: S;
  readonly readCurrentRunToken: () => number;
  readonly readActiveSession: () => S | null;
}): () => { readonly uid: string; readonly schoolId: string } | null {
  const identity = Object.freeze({ uid: run.session.uid, schoolId: run.session.schoolId });
  return () =>
    run.readCurrentRunToken() === run.runToken && run.readActiveSession() === run.session ? identity : null;
}

// A3-4 S2: the seam owns the pending reconciliation registry, so records
// outlive any one panel and controller (Curriculum navigation, remounts) and
// end with the seam itself, which the app rebuilds for every bootstrap run.
export function createTeacherUnitsSurfaceSeam(deps: {
  readonly capability?: TeacherUnitsCapabilityState;
  readonly callables: TeacherUnitsCallables;
  // The current Firebase Auth uid (null when signed out), read at call time.
  readonly readFirebaseUid: () => string | null;
  // The canonical active-teacher session the app currently holds (uid and
  // school from bootstrap), or null once it is gone or being replaced (a
  // sign-out, account switch, or new bootstrap after a school transfer).
  // Read at call time.
  readonly readActiveTeacher: () => { readonly uid: string; readonly schoolId: string } | null;
  readonly createStore: (scope: TeacherUnitCreateContext) => CreateAttemptStore;
}): TeacherUnitsSurfaceSeam {
  requireTeacherUnitsAvailable();
  const pendingRegistry = createPendingMutationRegistry();
  const capability = deps.capability ?? createTeacherUnitsCapabilityState();
  return Object.freeze({
    capability,
    dispose: () => capability.dispose(),
    createController: ({ uid, schoolId, initialGrade }) => {
      const session = Object.freeze({ teacherId: uid, schoolId });
      return createTeacherUnitsController({
        callables: deps.callables,
        session,
        // Both the Firebase uid and the canonical session's teacher AND
        // school must still be the mounted ones. A client-side guard only:
        // the server re-verifies identity and school on every call.
        readCurrentContext: () => {
          if (deps.readFirebaseUid() !== uid) return null;
          const active = deps.readActiveTeacher();
          return active !== null && active.uid === uid && active.schoolId === schoolId ? session : null;
        },
        store: deps.createStore(session),
        initialGrade,
        pendingRegistry,
      });
    },
  });
}
