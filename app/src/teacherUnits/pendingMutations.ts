// A3-4 S2 - memory-only owner of pending (uncertain) non-create Teacher
// Units mutations and of the authoritative unit evidence they are judged
// against, above the disposable My Units panel and controller
// (docs/platform/TEACHER_UNITS.md "A3-4 S2").
//
// Lifetime (approved decision D1). One registry belongs to one Teacher
// Units surface seam, which the app builds once per authenticated bootstrap
// run (index.ts) and drops on sign-out, account switch, or re-bootstrap after
// a school change. Records therefore survive Curriculum navigation and panel
// remounts within that run, and never a full browser reload: nothing here is
// written to browser storage, so teacher-authored text from a non-create
// request is never persisted. A reload simply starts with no records; it
// never reports a pending outcome as resolved.
//
// Scope isolation. Records are held per teacher and school. Binding a scope
// clears every other scope's records and makes their bound views inert, so a
// late callback from an earlier account or school writes nowhere visible.
// Writers additionally pass a live `isCurrent` guard (the controller's own
// canonical-context check) on every write.
//
// Ordering. One logical clock per registry (`stamp`) is the clock of every
// controller bound to it, so evidence from a replaced controller and from
// the current one is ordered alike. A read is stamped when it is
// dispatched; a confirmed write when its response is received. Stamps order
// client events only; they never attribute a change to anyone.
// - Records are revision-monotonic per unit: a lower revision never replaces
//   a higher one, whatever its stamp or completion order.
// - An equal revision with the same content raises the stamp at which that
//   content was last observed. An equal revision with DIFFERENT content is a
//   conflict: the stamp does not advance, the retained record is not treated
//   as freshly observed, findings for the unit become unknown
//   ("inconsistent"), and the D3 guard is not released, until a higher
//   revision is observed.
// - Authoritative absence (a `notFound` read, or omission from a complete
//   list; see unitsController.ts) is shared too, stamped when its read was
//   dispatched and when it was received. A record outranks an absence only
//   when it was observed by a read dispatched after the absence was
//   received, or its revision was first seen by a read dispatched after the
//   absent read was (a newer revision than anything known when that read
//   began). Otherwise the unit is absent now: an overlapping read of the
//   same revision never hides a later-arriving absence, and a stale absence
//   never hides a newer revision (`isPresent`).
// Pending findings are re-derived from this evidence on every change.
//
// Uncertainty and the D3 guard (fourth remediation). Each unit whose change
// had an uncertain outcome keeps an uncertainty record: the request's base
// revision (its floor) and the evidence metadata the verdict needs. Whether
// that record currently BLOCKS new changes is never stored as a decision: it
// is re-derived from the same verdict as the finding (`verdictSince`) every
// time the unit's evidence changes, so later conflicting, below-base or
// otherwise inconsistent evidence blocks again. A record is discarded only
// when the uncertainty is genuinely settled for eligibility: a later change
// to the unit, sent from eligible state, was confirmed by the server (the
// old request can no longer commit over it), or the scope ends. Dismissing a
// notice never discards it.
//
// Capacity (bounded memory). At most PENDING_MAX entries (in flight or
// uncertain), GUARDS_MAX currently blocking units, and UNCERTAINTY_MAX
// retained uncertainty records are tracked per scope. None is ever evicted:
// at capacity a new request is refused before it is sent (`atCapacity`), so
// no record needed to prevent a stale send is lost. A record that starts
// blocking again counts at once; it can push the blocking count past
// GUARDS_MAX, which only means new requests are refused. Unit evidence is bounded by UNIT_EVIDENCE_MAX; evidence no entry or
// guard refers to is pruned oldest first (a controller re-reads it). At most
// RESOLUTIONS_MAX late resolutions are kept.
//
// Nothing here dispatches, schedules, or resends a mutation.

import type { TeacherUnitError } from "./errors";
import {
  createPendingUnitMutationRecord,
  NOT_CHECKED,
  evaluateUnitReconciliation,
  type PendingMutationScope,
  type PendingUnitMutationIntent,
  type PendingUnitMutationRecord,
  type ReconciliationEvaluation,
  type UnitObservation,
} from "./mutationReconciliation";
import type { TeacherUnit } from "./types";

// Far beyond what one teacher resolves in a session; each entry is a notice
// the teacher must review. Reaching it refuses new changes (nothing is sent)
// until some are dismissed or resolved.
export const PENDING_MAX = 100;
// Units whose D3 guard is active (an unconfirmed outcome without a fresh
// read since). A guard outlives a dismissed notice, so it has its own bound.
export const GUARDS_MAX = 200;
// Retained uncertainty records (blocking or not). With PENDING_MAX entries
// they bound the evidence that can never be pruned to UNIT_EVIDENCE_MAX.
export const UNCERTAINTY_MAX = 900;
// The server's own list ceiling (teacherUnits.listLimitExceeded above 1000).
export const UNIT_EVIDENCE_MAX = 1000;
export const RESOLUTIONS_MAX = 20;

export type PendingMutationStatus =
  // Dispatched; no response has been received by any controller.
  | "inFlight"
  // The response was uncertain; never resent.
  | "uncertain";

export type PendingMutationEntry = {
  readonly record: PendingUnitMutationRecord;
  readonly status: PendingMutationStatus;
  // The uncertain failure's category and code (null while in flight).
  readonly failure: { readonly category: TeacherUnitError["category"]; readonly code: string } | null;
  // Present-state finding from the newest accepted evidence about the unit
  // that can speak to the time after the outcome became uncertain
  // (NOT_CHECKED until there is some).
  readonly evaluation: ReconciliationEvaluation;
  // A deliberate or automatic read of this unit is in progress.
  readonly checking: boolean;
};

// A request whose response arrived after the controller that sent it was
// replaced (for example the teacher left My Units). The current panel
// announces it once; it is never shown as pending.
export type PendingMutationResolution = {
  readonly seq: number;
  readonly record: PendingUnitMutationRecord;
  readonly outcome: "saved" | "noop" | "notMade";
};

// What the scope knows about one unit.
export type UnitEvidence = {
  readonly unitId: string;
  // The highest-revision record accepted (null: only absence observed).
  readonly unit: TeacherUnit | null;
  // Stamp of the newest observation consistent with `unit`.
  readonly at: number;
  // Stamp of the first observation of `unit`'s revision.
  readonly since: number;
  // An observation of the same revision had different content, and the
  // stamp of the first such observation (-1: none).
  readonly conflict: boolean;
  readonly conflictAt: number;
  // The newest authoritative absence: its read's dispatch stamp, and the
  // stamp taken when it was received (-1: none).
  readonly absentAt: number;
  readonly absentSeenAt: number;
};

// Whether the shared evidence says the unit is in the teacher's units now.
export const isPresent = (ev: UnitEvidence): boolean =>
  ev.unit !== null && (ev.absentAt < 0 || ev.at > ev.absentSeenAt || ev.since > ev.absentAt);

export type ScopedPendingMutations = {
  readonly scope: PendingMutationScope;
  // Oldest first.
  readonly list: () => ReadonlyArray<PendingMutationEntry>;
  readonly resolutions: () => ReadonlyArray<PendingMutationResolution>;
  readonly hasInFlight: (unitId: string) => boolean;
  // True when a new request for `unitId` would exceed a bound: it must not
  // be sent. `capacityReason` says which (fifth remediation P3), so the
  // teacher is only told about recovery actions that can actually help.
  readonly atCapacity: (unitId: string) => boolean;
  readonly capacityReason: (unitId: string) => CapacityReason | null;
  // The shared monotonic clock of every controller bound to this registry.
  readonly stamp: () => number;
  // Null when refused (capacity, or the scope is no longer current).
  readonly begin: (input: {
    readonly unitId: string;
    readonly expectedRevision: number;
    readonly intent: PendingUnitMutationIntent;
    readonly titleAtRequest: string;
    // Whether the controller that sent the request is still current. While
    // it is, only it makes the entry's single automatic read.
    readonly ownerActive?: () => boolean;
  }) => string | null;
  readonly ownerActive: (id: string) => boolean;
  // Confirmed success or a proven non-commit: the entry is removed. A
  // `late` outcome (the sending controller is gone) is kept as a one-time
  // resolution for the current panel to announce. `confirmedWrite` is the
  // response's own proof of a STATE-CHANGING write for this request (never a
  // no-op), `{ committedRevision }`. It settles the unit's earlier
  // uncertainty only when that proof meets the backend revision contract
  // (see `settlesEarlier`). Anything else, including a bare `true`, closes
  // only this entry: it never retires earlier uncertainty or frees retained
  // capacity (seventh remediation P3).
  readonly settle: (
    id: string,
    late?: PendingMutationResolution["outcome"],
    confirmedWrite?: WriteProof | boolean,
  ) => void;
  readonly markUncertain: (id: string, error: TeacherUnitError) => void;
  // Claims the single automatic reread for an uncertain entry. True once.
  readonly claimAutomaticRead: (id: string) => boolean;
  readonly setChecking: (id: string, checking: boolean) => void;
  // Accepts one authoritative record (read stamped at dispatch, confirmed
  // write at receipt).
  readonly accept: (unit: TeacherUnit, at: number) => void;
  // Authoritative absence observed by a read dispatched at `at`.
  readonly markAbsent: (unitId: string, at: number) => void;
  // A read of `unitId` dispatched at `at`: the record, not found, or failed.
  // A failed read never replaces a finding.
  readonly observe: (unitId: string, observation: UnitObservation, at: number) => void;
  readonly latest: (unitId: string) => UnitEvidence | null;
  // Every unit with an accepted record or absence.
  readonly units: () => ReadonlyArray<UnitEvidence>;
  // D3 guard: true while an uncertain outcome for `unitId` has no accepted,
  // non-conflicting record newer than its base revision or observed by a
  // read dispatched after the outcome became uncertain. Dismissing a notice
  // does not lift it; only accepted evidence does.
  readonly requiresFreshRead: (unitId: string) => boolean;
  // Explicit teacher acknowledgment. In-flight entries cannot be dismissed.
  readonly dismiss: (id: string) => boolean;
  readonly subscribe: (listener: () => void) => () => void;
};

// Sixth remediation: the mutation response's own revision for a confirmed
// state-changing write. Settlement proof is self-contained: it comes from
// this response alone, never from another read.
export type WriteProof = { readonly committedRevision: number };

// Which bound refused a new request:
// - pending: PENDING_MAX entries are listed (or in flight); resolving or
//   dismissing listed notices frees room.
// - blocking: GUARDS_MAX units are blocked by unconfirmed outcomes with no
//   qualifying current state; checking their current state frees room.
// - retained: UNCERTAINTY_MAX uncertainty records are kept for this session
//   even though none may block; reads and dismissals cannot free them, and
//   only the end of the session (a reload) does.
export type CapacityReason = "pending" | "blocking" | "retained";

export type PendingMutationRegistry = {
  readonly forScope: (scope: PendingMutationScope, isCurrent: () => boolean) => ScopedPendingMutations;
};

type Slot = {
  entry: PendingMutationEntry;
  // Stamp taken when the entry became uncertain (Infinity while in flight).
  uncertainAt: number;
  // The refusal itself reported the unit missing (its uncertainAt), else -1.
  missingAt: number;
  // Newest stamp of a failed read of the unit (-1: none).
  failedAt: number;
  // Newest stamp of a read dispatched after the outcome became uncertain
  // that returned a revision BELOW the request's base (-1: none).
  belowBaseAt: number;
  automaticRead: boolean;
  readonly ownerActive: () => boolean;
  // Stamp taken when the request was begun.
  readonly beganAt: number;
};

// A unit whose latest change has an unconfirmed outcome. `expectedRevision`
// is the revision floor the change was based on; it is kept here, not in
// the (prunable) unit evidence, so pruning can never lower it.
type Guard = {
  at: number;
  expectedRevision: number;
  belowBaseAt: number;
  missingAt: number;
  // Derived from the verdict whenever the unit's evidence changes; never set
  // any other way (see `refreshGuard`).
  blocking: boolean;
};

type Bucket = {
  readonly key: string;
  live: boolean;
  readonly slots: Map<string, Slot>;
  readonly units: Map<string, UnitEvidence>;
  readonly guards: Map<string, Guard>;
  // How many guards currently block.
  blocking: number;
  resolutions: PendingMutationResolution[];
  readonly listeners: Set<() => void>;
};

const scopeKey = (s: PendingMutationScope): string => `${s.teacherId}\u0000${s.schoolId}`;

const sameIds = (a: ReadonlyArray<string>, b: ReadonlyArray<string>): boolean =>
  a.length === b.length && a.every((id, i) => id === b[i]);

// Server content of one revision (every field the server returns).
const sameContent = (a: TeacherUnit, b: TeacherUnit): boolean =>
  a.unitId === b.unitId &&
  a.revision === b.revision &&
  a.grade === b.grade &&
  a.title === b.title &&
  a.description === b.description &&
  a.status === b.status &&
  a.archivedAtMillis === b.archivedAtMillis &&
  a.createdAtMillis === b.createdAtMillis &&
  a.updatedAtMillis === b.updatedAtMillis &&
  a.sortOrder === b.sortOrder &&
  sameIds(a.resourceIds, b.resourceIds);

// A record that speaks to the time after the outcome became uncertain: a
// revision newer than the request's base (the unit has moved on since, by
// this request or anything else), or one observed by a read dispatched
// after the outcome became uncertain.
const recordSpeaksAfter = (ev: UnitEvidence | undefined, after: number, expectedRevision: number): boolean =>
  ev !== undefined && ev.unit !== null && (ev.unit.revision > expectedRevision || ev.at > after);

// What the accepted evidence establishes about a unit since an uncertain
// outcome. ONE rule for both the present-state finding and the D3 guard
// (third remediation F1):
// - absent: absent now (`isPresent`), by an absence received after the
//   outcome, or the refusal itself reported it missing and nothing since
//   shows it;
// - inconsistent: a read since the outcome returned a revision below the
//   request's base (impossible for a consistent server: the base was read
//   before the request was sent), and no newer accepted record supersedes
//   it; or the accepted record itself is below the base;
// - conflicting: content conflict at one revision (see `acceptUnit`);
// - unit: an accepted, consistent record at or above the base;
// - none: nothing since the outcome.
// Only `unit` and `absent` release a guard; timestamps never override
// revision validity.
type Since = {
  readonly after: number;
  readonly expectedRevision: number;
  readonly belowBaseAt: number;
  readonly missingAt: number;
};
type Verdict =
  | { readonly kind: "inconsistent" | "conflicting" | "none" }
  // Absent now. `qualifies` only when the absent read was DISPATCHED after
  // the outcome became uncertain (fourth remediation P2-2): a read that
  // began earlier is present-state evidence, never recovery, however late
  // its response arrives. The refusal's own notFound began before too.
  | { readonly kind: "absent"; readonly qualifies: boolean }
  | { readonly kind: "unit"; readonly unit: TeacherUnit };

function verdictSince(ev: UnitEvidence | undefined, since: Since): Verdict {
  const valid = recordSpeaksAfter(ev, since.after, since.expectedRevision);
  if (ev !== undefined && !isPresent(ev) && ev.absentSeenAt > since.after) {
    return { kind: "absent", qualifies: ev.absentAt > since.after };
  }
  if (since.missingAt >= 0 && !valid) return { kind: "absent", qualifies: false };
  if (since.belowBaseAt > since.after && (!valid || since.belowBaseAt > (ev as UnitEvidence).at)) {
    return { kind: "inconsistent" };
  }
  if (
    ev !== undefined &&
    ev.conflict &&
    ev.unit !== null &&
    ev.unit.revision >= since.expectedRevision &&
    (valid || ev.conflictAt > since.after)
  ) {
    return { kind: "conflicting" };
  }
  if (!valid) return { kind: "none" };
  const unit = (ev as UnitEvidence).unit as TeacherUnit;
  return unit.revision < since.expectedRevision ? { kind: "inconsistent" } : { kind: "unit", unit };
}

function evaluationFor(slot: Slot, ev: UnitEvidence | undefined): ReconciliationEvaluation {
  const record = slot.entry.record;
  const v = verdictSince(ev, {
    after: slot.uncertainAt,
    expectedRevision: record.expectedRevision,
    belowBaseAt: slot.belowBaseAt,
    missingAt: slot.missingAt,
  });
  switch (v.kind) {
    case "absent":
      return evaluateUnitReconciliation(record, { kind: "notFound" });
    case "inconsistent":
    case "conflicting":
      return evaluateUnitReconciliation(record, { kind: "conflicting" });
    case "unit":
      return evaluateUnitReconciliation(record, { kind: "unit", unit: v.unit });
    case "none":
      return slot.failedAt > slot.uncertainAt ? evaluateUnitReconciliation(record, { kind: "unavailable" }) : NOT_CHECKED;
  }
}

// Eligibility is the verdict: a consistent accepted record at or above the
// floor, or a qualifying (post-outcome) absence. Everything else blocks.
const guardBlocks = (g: Guard, ev: UnitEvidence | undefined): boolean => {
  const v = verdictSince(ev, { after: g.at, expectedRevision: g.expectedRevision, belowBaseAt: g.belowBaseAt, missingAt: g.missingAt });
  return !(v.kind === "unit" || (v.kind === "absent" && v.qualifies));
};

// Fifth remediation P2. Backend contract (platform/functions/src/teacherUnits/
// teacher-unit-mutation.ts, shared by update, archive, restore and
// setResources): a request whose result already holds is a NO-OP: nothing is
// written, the revision is unchanged, and `expectedRevision` is not even
// compared. A STATE-CHANGING write commits only when `expectedRevision`
// equals the stored revision, and writes revision `expectedRevision + 1`,
// atomically with its audit event. Revisions only increase.
//
// So a confirmed state-changing write W settles an earlier uncertain request
// R (base `g.expectedRevision`) for eligibility only when:
// - W was begun after R's outcome became uncertain (`g.at < beganAt`), so
//   it was sent from eligible state under the D3 guard;
// - W's base is at or above R's base (W was not built on older state);
// - W's OWN response proves the transition the contract guarantees: its
//   revision is exactly W's base + 1 (sixth remediation). Then the server
//   revision has moved above R's base and R can never commit afterwards.
// The proof is self-contained: an internally inconsistent response (a
// "write" whose revision did not advance, or advanced by more than one) is
// never repaired with revision evidence from a separate read, which may
// support findings and eligibility but is not this write's confirmation.
// The post-commit response is a second read, so a legitimate write can
// report more than base + 1 when another write landed in between; that
// write simply does not settle R (conservative: R's record, floor and
// capacity slot stay, and later conflicting evidence blocks again). A no-op
// never settles. A server success alone never says whether R committed.
//
// Only structured, response-specific proof counts. Shared registry evidence
// is never consulted, so a separate read can never stand in for it.
const settlesEarlier = (g: Guard, s: Slot, proof: unknown): boolean => {
  if (typeof proof !== "object" || proof === null) return false;
  const base = s.entry.record.expectedRevision;
  if (!(g.at < s.beganAt && base >= g.expectedRevision)) return false;
  const committed = (proof as { readonly committedRevision?: unknown }).committedRevision;
  return typeof committed === "number" && Number.isSafeInteger(committed) && committed === base + 1;
};

const sameEvaluation = (a: ReconciliationEvaluation, b: ReconciliationEvaluation): boolean =>
  a.finding === b.finding && a.basis === b.basis && a.observedRevision === b.observedRevision;

export function createPendingMutationRegistry(deps: { readonly now?: () => number } = {}): PendingMutationRegistry {
  const now = deps.now ?? (() => Date.now());
  const buckets = new Map<string, Bucket>();
  let clock = 0;
  let idSeq = 0;
  let resolutionSeq = 0;

  const notify = (b: Bucket): void => {
    for (const l of Array.from(b.listeners)) {
      try {
        l();
      } catch {
        // A listener failure never breaks the registry.
      }
    }
  };

  return Object.freeze({
    forScope: (scope: PendingMutationScope, isCurrent: () => boolean): ScopedPendingMutations => {
      const frozenScope = Object.freeze({ teacherId: scope.teacherId, schoolId: scope.schoolId });
      const key = scopeKey(frozenScope);
      // A different teacher or school: every other scope's records go.
      for (const [k, b] of buckets) {
        if (k === key) continue;
        b.live = false;
        b.slots.clear();
        b.units.clear();
        b.guards.clear();
        b.blocking = 0;
        b.resolutions = [];
        b.listeners.clear();
        buckets.delete(k);
      }
      let bucket = buckets.get(key);
      if (bucket === undefined) {
        bucket = {
          key,
          live: true,
          slots: new Map(),
          units: new Map(),
          guards: new Map(),
          blocking: 0,
          resolutions: [],
          listeners: new Set(),
        };
        buckets.set(key, bucket);
      }
      const b = bucket;
      const writable = (): boolean => {
        if (!b.live || buckets.get(key) !== b) return false;
        try {
          return isCurrent();
        } catch {
          return false;
        }
      };
      // Re-derives whether the unit's uncertainty record blocks, from the
      // current verdict (released and re-blocked alike). True when changed.
      const refreshGuard = (unitId: string): boolean => {
        const g = b.guards.get(unitId);
        if (g === undefined) return false;
        const blocking = guardBlocks(g, b.units.get(unitId));
        if (blocking === g.blocking) return false;
        g.blocking = blocking;
        b.blocking += blocking ? 1 : -1;
        return true;
      };
      const dropGuard = (unitId: string): void => {
        const g = b.guards.get(unitId);
        if (g === undefined) return;
        if (g.blocking) b.blocking--;
        b.guards.delete(unitId);
      };
      // Re-derives the finding of every uncertain entry for `unitId`, and
      // releases its guard as soon as accepted evidence qualifies (third
      // remediation F3: no visit to the unit is needed; O(entries) per
      // accepted record, bounded by PENDING_MAX).
      const reevaluate = (unitId: string): boolean => {
        let changed = false;
        const ev = b.units.get(unitId);
        if (refreshGuard(unitId)) changed = true;
        for (const s of b.slots.values()) {
          if (s.entry.record.unitId !== unitId || s.entry.status !== "uncertain") continue;
          const next = evaluationFor(s, ev);
          if (sameEvaluation(next, s.entry.evaluation)) continue;
          s.entry = Object.freeze({ ...s.entry, evaluation: next });
          changed = true;
        }
        return changed;
      };
      const update = (id: string, patch: (s: Slot) => void): void => {
        if (!writable()) return;
        const s = b.slots.get(id);
        if (s === undefined) return;
        patch(s);
        notify(b);
      };
      const referenced = (unitId: string): boolean =>
        b.guards.has(unitId) || Array.from(b.slots.values()).some((s) => s.entry.record.unitId === unitId);
      // Keeps unit evidence within UNIT_EVIDENCE_MAX by dropping the oldest
      // evidence nothing refers to. Referenced evidence (bounded by
      // PENDING_MAX + GUARDS_MAX) is never dropped.
      const prune = (): void => {
        if (b.units.size <= UNIT_EVIDENCE_MAX) return;
        const candidates = Array.from(b.units.values())
          .filter((ev) => !referenced(ev.unitId))
          .sort((x, y) => Math.max(x.at, x.absentSeenAt) - Math.max(y.at, y.absentSeenAt));
        for (const ev of candidates) {
          if (b.units.size <= UNIT_EVIDENCE_MAX) break;
          b.units.delete(ev.unitId);
        }
      };
      const put = (ev: UnitEvidence): void => {
        b.units.set(ev.unitId, Object.freeze(ev));
        prune();
      };
      // Revision-monotonic acceptance; true when anything changed.
      const acceptUnit = (unit: TeacherUnit, at: number): boolean => {
        // A read since an uncertain outcome that returned a revision below
        // that request's base: inconsistent evidence (never a recovery).
        let below = false;
        for (const s of b.slots.values()) {
          if (s.entry.record.unitId !== unit.unitId || s.entry.status !== "uncertain") continue;
          if (unit.revision < s.entry.record.expectedRevision && at > s.uncertainAt && at > s.belowBaseAt) {
            s.belowBaseAt = at;
            below = true;
          }
        }
        const guard = b.guards.get(unit.unitId);
        if (guard !== undefined && unit.revision < guard.expectedRevision && at > guard.at && at > guard.belowBaseAt) {
          guard.belowBaseAt = at;
          below = true;
        }
        if (below) reevaluate(unit.unitId);
        const held = b.units.get(unit.unitId);
        if (held === undefined || held.unit === null) {
          put({
            unitId: unit.unitId,
            unit,
            at,
            since: at,
            conflict: false,
            conflictAt: -1,
            absentAt: held?.absentAt ?? -1,
            absentSeenAt: held?.absentSeenAt ?? -1,
          });
        } else if (held.unit.revision > unit.revision) {
          return below;
        } else if (held.unit.revision === unit.revision) {
          if (!sameContent(held.unit, unit)) {
            // Conflicting content at one revision: keep the record, never
            // advance its freshness, and mark it uninterpretable.
            if (held.conflict) return below;
            put({ ...held, conflict: true, conflictAt: at });
          } else {
            if (held.at >= at) return below;
            put({ ...held, at });
          }
        } else {
          put({ ...held, unit, at, since: at, conflict: false, conflictAt: -1 });
        }
        reevaluate(unit.unitId);
        return true;
      };
      const absent = (unitId: string, at: number): boolean => {
        const held = b.units.get(unitId);
        if (held !== undefined && held.absentAt >= at) return false;
        const seen = ++clock;
        put(
          held === undefined
            ? { unitId, unit: null, at: -1, since: -1, conflict: false, conflictAt: -1, absentAt: at, absentSeenAt: seen }
            : { ...held, absentAt: at, absentSeenAt: seen },
        );
        reevaluate(unitId);
        return true;
      };
      // A new request may become a blocking record for its unit (and, if the
      // unit has none yet, a new retained record), as may every request in
      // flight: count them before sending. O(PENDING_MAX).
      const capacityReason = (unitId: string): CapacityReason | null => {
        if (b.slots.size >= PENDING_MAX) return "pending";
        const extraBlocking = new Set<string>();
        const extraRetained = new Set<string>();
        const consider = (id: string): void => {
          const g = b.guards.get(id);
          if (g === undefined) extraRetained.add(id);
          if (g === undefined || !g.blocking) extraBlocking.add(id);
        };
        for (const s of b.slots.values()) if (s.entry.status === "inFlight") consider(s.entry.record.unitId);
        consider(unitId);
        if (b.blocking + extraBlocking.size > GUARDS_MAX) return "blocking";
        if (b.guards.size + extraRetained.size > UNCERTAINTY_MAX) return "retained";
        return null;
      };
      const atCapacity = (unitId: string): boolean => capacityReason(unitId) !== null;
      return Object.freeze({
        scope: frozenScope,
        list: () => (b.live ? Object.freeze(Array.from(b.slots.values(), (s) => s.entry)) : Object.freeze([])),
        resolutions: () => (b.live ? Object.freeze(b.resolutions.slice()) : Object.freeze([])),
        hasInFlight: (unitId: string) =>
          b.live && Array.from(b.slots.values()).some((s) => s.entry.status === "inFlight" && s.entry.record.unitId === unitId),
        atCapacity: (unitId: string) => b.live && atCapacity(unitId),
        capacityReason: (unitId: string) => (b.live ? capacityReason(unitId) : null),
        stamp: () => ++clock,
        begin: (input) => {
          if (!writable() || atCapacity(input.unitId)) return null;
          const id = `pending-${++idSeq}`;
          const record = createPendingUnitMutationRecord({
            id,
            scope: frozenScope,
            unitId: input.unitId,
            expectedRevision: input.expectedRevision,
            intent: input.intent,
            titleAtRequest: input.titleAtRequest,
            requestedAtMillis: now(),
          });
          b.slots.set(id, {
            entry: Object.freeze({ record, status: "inFlight", failure: null, evaluation: NOT_CHECKED, checking: false }),
            uncertainAt: Number.POSITIVE_INFINITY,
            missingAt: -1,
            failedAt: -1,
            belowBaseAt: -1,
            automaticRead: false,
            ownerActive: input.ownerActive ?? (() => false),
            beganAt: ++clock,
          });
          notify(b);
          return id;
        },
        settle: (id, late, confirmedWrite) => {
          if (!writable()) return;
          const s = b.slots.get(id);
          if (s === undefined) return;
          b.slots.delete(id);
          const unitId = s.entry.record.unitId;
          const g = b.guards.get(unitId);
          if (g !== undefined && settlesEarlier(g, s, confirmedWrite)) {
            dropGuard(unitId);
          }
          if (late !== undefined) {
            b.resolutions = [...b.resolutions, Object.freeze({ seq: ++resolutionSeq, record: s.entry.record, outcome: late })].slice(
              -RESOLUTIONS_MAX,
            );
          }
          notify(b);
        },
        markUncertain: (id, error) =>
          update(id, (s) => {
            s.uncertainAt = ++clock;
            // A refusal that itself reports the unit missing is present
            // evidence; every other failure leaves the state unchecked.
            if (error.category === "notFound") s.missingAt = s.uncertainAt;
            s.entry = Object.freeze({
              ...s.entry,
              status: "uncertain",
              failure: Object.freeze({ category: error.category, code: error.code }),
            });
            const unitId = s.entry.record.unitId;
            const prev = b.guards.get(unitId);
            if (prev?.blocking === true) b.blocking--;
            b.guards.set(unitId, {
              at: s.uncertainAt,
              expectedRevision: Math.max(prev?.expectedRevision ?? -1, s.entry.record.expectedRevision),
              belowBaseAt: -1,
              missingAt: s.missingAt,
              blocking: false,
            });
            refreshGuard(unitId);
            s.entry = Object.freeze({ ...s.entry, evaluation: evaluationFor(s, b.units.get(unitId)) });
          }),
        ownerActive: (id) => {
          const s = b.slots.get(id);
          if (s === undefined) return false;
          try {
            return s.ownerActive();
          } catch {
            return false;
          }
        },
        claimAutomaticRead: (id) => {
          if (!writable()) return false;
          const s = b.slots.get(id);
          if (s === undefined || s.entry.status !== "uncertain" || s.automaticRead) return false;
          s.automaticRead = true;
          return true;
        },
        setChecking: (id, checking) =>
          update(id, (s) => {
            if (s.entry.checking !== checking) s.entry = Object.freeze({ ...s.entry, checking });
          }),
        accept: (unit, at) => {
          if (!writable()) return;
          if (acceptUnit(unit, at)) notify(b);
        },
        markAbsent: (unitId, at) => {
          if (!writable()) return;
          if (absent(unitId, at)) notify(b);
        },
        observe: (unitId, observation, at) => {
          if (!writable()) return;
          let changed = false;
          if (observation.kind === "unit") {
            changed = acceptUnit(observation.unit, at);
          } else if (observation.kind === "notFound") {
            changed = absent(unitId, at);
          } else if (observation.kind === "unavailable") {
            for (const s of b.slots.values()) {
              if (s.entry.record.unitId === unitId) s.failedAt = Math.max(s.failedAt, at);
            }
            changed = reevaluate(unitId);
          }
          if (changed) notify(b);
        },
        latest: (unitId) => (b.live ? b.units.get(unitId) ?? null : null),
        units: () => (b.live ? Object.freeze(Array.from(b.units.values())) : Object.freeze([])),
        requiresFreshRead: (unitId) => {
          if (!b.live) return false;
          // Re-derived on demand too, so the answer always equals the verdict.
          refreshGuard(unitId);
          return b.guards.get(unitId)?.blocking === true;
        },
        dismiss: (id) => {
          if (!writable()) return false;
          const s = b.slots.get(id);
          if (s === undefined || s.entry.status !== "uncertain") return false;
          b.slots.delete(id);
          prune();
          notify(b);
          return true;
        },
        subscribe: (listener) => {
          if (!b.live) return () => undefined;
          b.listeners.add(listener);
          return () => {
            b.listeners.delete(listener);
          };
        },
      });
    },
  });
}
