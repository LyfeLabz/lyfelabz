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
  readonly busyUnitIds: ReadonlySet<string>;
};

export type UnitEdit = { readonly title?: string; readonly description?: string };

export type UnitMutationResult =
  | { readonly kind: "saved"; readonly unit: TeacherUnit; readonly noop: boolean }
  // Field validation before sending; nothing was sent.
  | { readonly kind: "invalid"; readonly field: "title" | "description"; readonly message: string }
  // Revision conflict. `latest` is the freshly fetched server state (null
  // when it could not be fetched). Nothing was saved; edits are the
  // caller's to keep.
  | { readonly kind: "conflict"; readonly latest: TeacherUnit | null; readonly error: TeacherUnitError }
  // The unit is archived (`latest` is the archived server state when
  // known). Nothing was saved; edits are the caller's to keep.
  | { readonly kind: "archived"; readonly latest: TeacherUnit | null; readonly error: TeacherUnitError }
  | { readonly kind: "error"; readonly error: TeacherUnitError }
  // U2.3 membership only: the request may or may not have committed (lost
  // response, malformed response, or a refusal that names resources).
  // `latest` is the authoritative unit fetched afterwards (null when it
  // could not be fetched). Never resent automatically.
  | { readonly kind: "uncertain"; readonly latest: TeacherUnit | null; readonly error: TeacherUnitError }
  // Another mutation for this unit is in flight; nothing was sent.
  | { readonly kind: "busy" }
  // The controller was disposed or the account changed; ignore.
  | { readonly kind: "stale" };

export type TeacherUnitsController = {
  readonly getState: () => TeacherUnitsViewState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly setGrade: (grade: TeacherUnitGrade) => void;
  readonly setShowArchived: (show: boolean) => void;
  readonly refresh: () => Promise<void>;
  // The last server state seen for a unit, even when it is not in the
  // current list (for example archived while archived units are hidden).
  readonly getKnownUnit: (unitId: string) => TeacherUnit | null;
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
};

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
  const session = Object.freeze({ ...deps.session });
  const listeners = new Set<() => void>();
  const gate = createMutationGate();
  const known = new Map<string, TeacherUnit>();
  let disposed = false;
  let loadSeq = 0;

  const alive = (): boolean => {
    if (disposed) return false;
    let current: TeacherUnitCreateContext | null = null;
    try {
      current = deps.readCurrentContext();
    } catch {
      current = null;
    }
    return sameContext(current, session);
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
  });

  const set = (patch: Partial<TeacherUnitsViewState>): void => {
    const recoveryCheck = patch.recoveryCheck ?? state.recoveryCheck;
    state = Object.freeze({
      ...state,
      ...patch,
      create: primary.state(),
      storage,
      recoveries: recoveries(),
      unreadable,
      formerSchool,
      // A completed check reports the units the latest accepted state holds
      // (every grade and status), not the response as it arrived: a rename,
      // refresh, or out-of-order response since then is reflected.
      recoveryCheck:
        recoveryCheck.kind === "checked"
          ? Object.freeze({ kind: "checked", units: Object.freeze(presentUnits().sort(compareTeacherUnits)) })
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

  // ---------- Response ordering (U2.3 remediation) ----------
  //
  // Responses can arrive in any order. Every request takes the next `clock`
  // stamp when it is sent, and two rules keep an older response from
  // overwriting newer state:
  // - Revision monotonicity: the server increments `revision` on every
  //   accepted change to a unit, so the held unit is replaced only by a
  //   HIGHER revision. Equal revisions are the same server state.
  // - Presence: whether a unit belongs in the list is decided by the most
  //   recently SENT request that observed it. A unit read or written, a
  //   unit included in a list, a unit a list omitted while it was within
  //   that list's scope (grade and status), and a `notFound` each record
  //   presence with their request's stamp. A response sent before that
  //   record never changes it: an older single-unit read cannot bring back
  //   a unit a newer list omitted, and an older list cannot hide a unit
  //   confirmed since. Nothing is tombstoned: any later request that sees
  //   the unit again lists it again.
  // This is client ordering only. Authorization and `expectedRevision`
  // stay server-enforced; nothing here is ever resent.
  let clock = 0;
  const presence = new Map<string, { readonly at: number; readonly present: boolean }>();

  // Units the latest evidence says exist for this teacher and school.
  const presentUnits = (): TeacherUnit[] =>
    Array.from(known.values()).filter((u) => presence.get(u.unitId)?.present === true);

  const listedNow = (): UnitsListState =>
    Object.freeze({
      kind: "ready",
      units: Object.freeze(presentUnits().filter(visible).sort(compareTeacherUnits)),
    });

  // Record one authoritative unit read or written by a request sent at
  // `at`. Returns the unit now held (which may be newer), or null when a
  // request sent after `at` found the unit absent.
  const accept = (unit: TeacherUnit, at: number): TeacherUnit | null => {
    const p = presence.get(unit.unitId);
    if (p !== undefined && p.at > at && !p.present) return null;
    const held = known.get(unit.unitId);
    if (held === undefined || unit.revision > held.revision) known.set(unit.unitId, unit);
    if (p === undefined || p.at <= at) presence.set(unit.unitId, { at, present: true });
    return known.get(unit.unitId) ?? null;
  };

  const relist = (): void => {
    if (state.list.kind === "ready") set({ list: listedNow() });
  };

  // Adopt one authoritative unit (the list shows it only while it belongs
  // to this view; it stays known either way). Default: received now.
  const adopt = (unit: TeacherUnit, at: number = ++clock): TeacherUnit | null => {
    const held = accept(unit, at);
    relist();
    return held;
  };

  // `notFound` for a request sent at `at`; ignored when a request sent
  // after that observed the unit.
  const drop = (unitId: string, at: number): void => {
    const p = presence.get(unitId);
    if (p !== undefined && p.at > at) return;
    known.delete(unitId);
    presence.set(unitId, { at, present: false });
    relist();
  };

  // Apply a list response requested at `at` whose scope is `inScope`: a
  // held unit within that scope that the response omits is recorded absent.
  const acceptList = (
    units: ReadonlyArray<TeacherUnit>,
    at: number,
    inScope: (u: TeacherUnit) => boolean,
  ): void => {
    const ids = new Set<string>();
    for (const u of units) {
      ids.add(u.unitId);
      accept(u, at);
    }
    for (const [unitId, u] of known) {
      if (ids.has(unitId) || !inScope(u)) continue;
      const p = presence.get(unitId);
      if (p !== undefined && p.at > at) continue;
      presence.set(unitId, { at, present: false });
    }
  };

  const load = async (): Promise<void> => {
    if (!alive()) return;
    const seq = ++loadSeq;
    const at = ++clock;
    const grade = state.grade;
    const includeArchived = state.showArchived;
    set({ list: { kind: "loading" } });
    const outcome = await runTeacherUnitMutation(() => deps.callables.list({ grade, includeArchived }));
    if (!alive() || seq !== loadSeq) return;
    if (outcome.ok) {
      acceptList(
        outcome.result.units,
        at,
        (u) => u.grade === grade && (includeArchived || u.status === "active"),
      );
      set({ list: listedNow() });
    } else {
      set({ list: { kind: "error", error: outcome.error } });
    }
  };

  const busy = (unitId: string, on: boolean): void => {
    const next = new Set(state.busyUnitIds);
    if (on) next.add(unitId);
    else next.delete(unitId);
    set({ busyUnitIds: next });
  };

  // Read one unit after a failed mutation; returns the unit now held (null
  // when it could not be read or no longer exists).
  const reread = async (unitId: string): Promise<TeacherUnit | null | "stale"> => {
    const at = ++clock;
    const fresh = await runTeacherUnitMutation(() => deps.callables.get({ unitId }));
    if (!alive()) return "stale";
    if (fresh.ok) return adopt(fresh.result.unit, at);
    if (fresh.error.category === "notFound") drop(unitId, at);
    return null;
  };

  // Shared handling for revision-guarded single-unit mutations.
  const mutate = async (
    unitId: string,
    run: (current: TeacherUnit) => Promise<{ readonly unit: TeacherUnit; readonly noop: boolean }>,
  ): Promise<UnitMutationResult> => {
    if (!alive()) return { kind: "stale" };
    const current = known.get(unitId);
    if (current === undefined) {
      return { kind: "error", error: normalizeTeacherUnitError({ details: { code: "teacherUnits.notFound" } }) };
    }
    const at = ++clock;
    const pending = gate.run(unitId, () => runTeacherUnitMutation(() => run(current)));
    if (pending === null) return { kind: "busy" };
    busy(unitId, true);
    const outcome = await pending;
    if (!alive()) return { kind: "stale" };
    busy(unitId, false);
    if (outcome.ok) {
      adopt(outcome.result.unit, at);
      return { kind: "saved", unit: outcome.result.unit, noop: outcome.result.noop };
    }
    const error = outcome.error;
    if (error.category === "notFound") {
      drop(unitId, at);
      return { kind: "error", error };
    }
    if (error.category === "conflict" || error.category === "invalidStatus") {
      // Fetch the authoritative unit; never resend the stale request.
      const latest = await reread(unitId);
      if (latest === "stale") return { kind: "stale" };
      if (latest !== null && latest.status === "archived") return { kind: "archived", latest, error };
      if (error.category === "invalidStatus") return { kind: "archived", latest, error };
      return { kind: "conflict", latest, error };
    }
    return { kind: "error", error };
  };

  // U2.3 membership. Archived units are refused before sending (the server
  // refuses them too, TEACHER_UNITS.md §9.1). A failure whose outcome is
  // unknown (network, malformed response) is reconciled by reading the
  // unit, never by resending: a later deliberate attempt carries the
  // re-read revision, so it cannot overwrite another session's change.
  const setMembership = async (
    unitId: string,
    next: (current: TeacherUnit) => ReadonlyArray<string> | null,
  ): Promise<UnitMutationResult> => {
    if (!alive()) return { kind: "stale" };
    const held = known.get(unitId);
    if (held !== undefined && held.status !== "active") {
      return {
        kind: "archived",
        latest: held,
        error: normalizeTeacherUnitError({ details: { code: "teacherUnits.invalidStatus" } }),
      };
    }
    if (held !== undefined && next(held) === null) return { kind: "saved", unit: held, noop: true };
    const result = await mutate(unitId, (u) => {
      const resourceIds = next(u) ?? u.resourceIds;
      return deps.callables.setResources({ unitId, expectedRevision: u.revision, resourceIds });
    });
    if (
      result.kind !== "error" ||
      (result.error.category !== "network" &&
        result.error.category !== "unexpected" &&
        result.error.category !== "resourceRejected")
    ) {
      return result;
    }
    // A placement refusal is definitive (nothing written) but means the held
    // list may be stale: show the authoritative unit with the refusal.
    const latest = await reread(unitId);
    if (latest === "stale") return { kind: "stale" };
    if (result.error.category === "resourceRejected") return result;
    return { kind: "uncertain", latest, error: result.error };
  };

  // Retired = stored in the unit but not RA-1 unitPlaceable in this client.
  const isRetired = (id: string): boolean => getPlaceableResourceById(id) === null;
  const retiredIds = (u: TeacherUnit): ReadonlyArray<string> => u.resourceIds.filter(isRetired);

  // A list the server would refuse (it still names a retired id) is not
  // sent. `removing` is the one id the request drops, if any.
  const retiredBlock = (unitId: string, removing: string | null): UnitMutationResult | null => {
    const held = known.get(unitId);
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

  // A restored attempt that reconciled to a confirmed unit leaves the
  // recovery list; its unit is adopted.
  const settleRestored = (key: string): void => {
    const c = restored.get(key);
    if (c === undefined) return;
    const s = c.state();
    if (s.kind === "created") {
      restored.delete(key);
      adopt(s.unit);
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
    getKnownUnit: (unitId: string) => known.get(unitId) ?? null,
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
      if (after.kind === "created") adopt(after.unit);
      set({ createBlocked: null, recoveryCheck: { kind: "none" } });
    },
    reconcileCreate: async (key, options) => {
      if (!alive()) return;
      const c = coordinatorForKey(key);
      if (c === null) return;
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
          adopt(after.unit);
          set({ lastConfirmed: { unit: after.unit, replayed: after.replayed } });
        }
      } else {
        settleRestored(key);
      }
      set({ createBlocked: null });
    },
    checkRecovery: async () => {
      if (!alive()) return;
      scan();
      set({ recoveryCheck: { kind: "checking" } });
      const at = ++clock;
      // Every grade and status: the unit may have been archived since.
      const outcome = await runTeacherUnitMutation(() =>
        deps.callables.list({ includeArchived: true }),
      );
      if (!alive()) return;
      if (!outcome.ok) {
        set({ recoveryCheck: { kind: "error", error: outcome.error } });
        return;
      }
      // Every grade and status is in scope.
      acceptList(outcome.result.units, at, () => true);
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
      const current = known.get(unitId);
      const request: { title?: string; description?: string } = {};
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
      if (current !== undefined && request.title === undefined && request.description === undefined) {
        return { kind: "saved", unit: current, noop: true };
      }
      return mutate(unitId, (u) =>
        deps.callables.update({ unitId, expectedRevision: u.revision, ...request }),
      );
    },
    archiveUnit: (unitId) =>
      mutate(unitId, (u) => deps.callables.archive({ unitId, expectedRevision: u.revision })),
    restoreUnit: (unitId) =>
      mutate(unitId, (u) => deps.callables.restore({ unitId, expectedRevision: u.revision })),
    addResources: (unitId, resourceIds) => {
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
      const held = known.get(unitId);
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
      return setMembership(unitId, appended);
    },
    removeResource: (unitId, resourceId) => {
      const blocked = retiredBlock(unitId, resourceId);
      if (blocked !== null) return Promise.resolve(blocked);
      return setMembership(unitId, (u) =>
        u.resourceIds.includes(resourceId) ? u.resourceIds.filter((id) => id !== resourceId) : null,
      );
    },
    removeRetiredResources: (unitId) =>
      setMembership(unitId, (u) =>
        retiredIds(u).length === 0 ? null : u.resourceIds.filter((id) => !isRetired(id)),
      ),
    dispose: () => {
      disposed = true;
      listeners.clear();
    },
  });

  void load();
  return controller;
}

// ---------- Surface seam ----------
//
// What the Curriculum surface receives when the feature gate is open (null
// otherwise). The shell never touches Firebase or storage: the entry point
// binds the callables, the Firebase uid reader, and the scoped store here.
export type TeacherUnitsSurfaceSeam = {
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

export function createTeacherUnitsSurfaceSeam(deps: {
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
  return Object.freeze({
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
      });
    },
  });
}
