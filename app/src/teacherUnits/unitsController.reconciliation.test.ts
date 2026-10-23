import * as fs from "fs";
import * as path from "path";
import { TeacherUnitsCompatibilityError } from "./compatibilityError";
import { createTeacherUnitCreateAttemptStore } from "./createAttemptStore";
import { normalizeTeacherUnitError } from "./errors";
import {
  createPendingMutationRegistry,
  GUARDS_MAX,
  PENDING_MAX,
  UNCERTAINTY_MAX,
  UNIT_EVIDENCE_MAX,
  type PendingMutationRegistry,
} from "./pendingMutations";
import { getPlaceableResources } from "./placeableResources";
import type { TeacherUnit, TeacherUnitsCallables } from "./types";
import {
  createTeacherUnitsController,
  createTeacherUnitsSurfaceSeam,
  type TeacherUnitsController,
  type UnitMutationResult,
} from "./unitsController";

// A3-4 S2: client-side reconciliation of uncertain non-create mutations.
// Every uncertain outcome is sent exactly once, never resent, read at most
// once automatically, and reported as present state only. Records live
// above the controller (one registry per surface seam), scoped to the
// teacher and school.

const A = { teacherId: "teacherA", schoolId: "schoolA" };
const B = { teacherId: "teacherB", schoolId: "schoolA" };
const [R1, R2] = getPlaceableResources().filter((r) => r.grade === "7");
const tick = () => new Promise((r) => setTimeout(r, 0));

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const MUTATIONS = ["update", "archive", "restore", "setResources", "reorder", "create"] as const;
type Kind = "list" | "get" | (typeof MUTATIONS)[number];
type Call = { req: Record<string, unknown>; d: Deferred<unknown> };
function scripted() {
  const calls: Record<Kind, Call[]> = {
    list: [], get: [], update: [], archive: [], restore: [], setResources: [], reorder: [], create: [],
  };
  const queue = (k: Kind) =>
    jest.fn((req: Record<string, unknown> = {}) => {
      const d = deferred<unknown>();
      calls[k].push({ req, d });
      return d.promise;
    });
  const c = {
    create: queue("create"), list: queue("list"), get: queue("get"), update: queue("update"),
    archive: queue("archive"), restore: queue("restore"), setResources: queue("setResources"), reorder: queue("reorder"),
  };
  return { c, calls };
}
type S = ReturnType<typeof scripted>;
const last = (s: S, k: Kind) => s.calls[k][s.calls[k].length - 1];
const mutationCalls = (s: S) => MUTATIONS.reduce((n, k) => n + s.c[k].mock.calls.length, 0);

let seq = 0;
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: `Rec${String(++seq).padStart(17, "0")}`,
  grade: "7",
  title: "Plants",
  description: "",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: seq,
  updatedAtMillis: seq,
  resourceIds: [R1.id],
  sortOrder: 0,
  revision: 3,
  ...over,
});
const at = (u: TeacherUnit, over: Partial<TeacherUnit>): TeacherUnit => ({ ...u, ...over });

const ctx: { current: { teacherId: string; schoolId: string } | null } = { current: A };
beforeEach(() => {
  window.localStorage.clear();
  ctx.current = A;
});

async function mount(
  s: S,
  units: TeacherUnit[],
  opts: { registry?: PendingMutationRegistry; session?: typeof A } = {},
): Promise<TeacherUnitsController> {
  const session = opts.session ?? A;
  const ctl = createTeacherUnitsController({
    callables: s.c as unknown as TeacherUnitsCallables,
    session,
    readCurrentContext: () => ctx.current,
    store: createTeacherUnitCreateAttemptStore(session, () => window.localStorage),
    initialGrade: "7",
    ...(opts.registry ? { pendingRegistry: opts.registry } : {}),
  });
  last(s, "list").d.resolve({ units });
  await tick();
  return ctl;
}

const err = (code: string) => ({ details: { code } });
const fb = (code: string) => Object.assign(new Error("server text"), { code });

type Op = {
  readonly name: string;
  readonly kind: "update" | "archive" | "restore" | "setResources";
  readonly start: (u: TeacherUnit) => TeacherUnit;
  readonly run: (ctl: TeacherUnitsController, u: TeacherUnit) => Promise<UnitMutationResult>;
  // The unit's state when the request's result holds.
  readonly holds: (u: TeacherUnit) => Partial<TeacherUnit>;
};
const OPS: ReadonlyArray<Op> = [
  { name: "update", kind: "update", start: (u) => u, run: (c, u) => c.updateUnit(u.unitId, { title: "Seeds" }), holds: () => ({ title: "Seeds" }) },
  { name: "archive", kind: "archive", start: (u) => u, run: (c, u) => c.archiveUnit(u.unitId), holds: () => ({ status: "archived", archivedAtMillis: 9 }) },
  {
    name: "restore",
    kind: "restore",
    start: (u) => at(u, { status: "archived", archivedAtMillis: 9 }),
    run: (c, u) => c.restoreUnit(u.unitId),
    holds: () => ({ status: "active", archivedAtMillis: null }),
  },
  { name: "setResources", kind: "setResources", start: (u) => u, run: (c, u) => c.addResources(u.unitId, [R2.id]), holds: () => ({ resourceIds: [R1.id, R2.id] }) },
];

const UNCERTAIN: ReadonlyArray<[string, () => unknown]> = [
  ["responseUnavailable", () => err("teacherUnits.responseUnavailable")],
  ["network (unavailable)", () => fb("unavailable")],
  ["network (deadline-exceeded)", () => fb("functions/deadline-exceeded")],
  ["unexpected", () => fb("functions/internal")],
  ["A3 availability refusal", () => err("teacherUnits.availabilityClosed")],
  ["A3 policy refusal", () => err("teacherUnits.policyChanged")],
  ["writeConflict", () => err("teacherUnits.writeConflict")],
  ["invalidStatus", () => err("teacherUnits.invalidStatus")],
];

// Shows the archived units too, so an archived unit is listed and held.
async function setup(op: Op, registry?: PendingMutationRegistry) {
  const s = scripted();
  const u = op.start(unit());
  const ctl = await mount(s, [u], registry ? { registry } : {});
  return { s, u, ctl };
}

describe.each(OPS)("$name: uncertain outcomes", (op) => {
  test.each(UNCERTAIN)("%s: sent once, one automatic reread, pending, never resent", async (_label, failure) => {
    const { s, u, ctl } = await setup(op);
    const result = op.run(ctl, u);
    await tick();
    expect(s.c[op.kind]).toHaveBeenCalledTimes(1);
    expect(ctl.getState().pending).toMatchObject([{ status: "inFlight", record: { unitId: u.unitId, expectedRevision: 3 } }]);
    expect(ctl.getState().busyUnitIds.has(u.unitId)).toBe(true);
    last(s, op.kind).d.reject(failure());
    await tick();
    expect(s.c.get).toHaveBeenCalledTimes(1);
    expect(last(s, "get").req).toEqual({ unitId: u.unitId });
    last(s, "get").d.resolve({ unit: u });
    const r = await result;
    expect(["uncertain", "conflict", "archived"]).toContain(r.kind);
    const [entry] = ctl.getState().pending;
    expect(entry).toMatchObject({ status: "uncertain", record: { intent: { op: op.kind } } });
    expect(entry.evaluation).toEqual({ finding: "notInEffectNow", basis: "sameRevision", observedRevision: 3, commit: "undetermined" });
    // Nothing further is ever sent, however long we wait.
    await tick();
    await tick();
    expect(s.c[op.kind]).toHaveBeenCalledTimes(1);
    expect(mutationCalls(s)).toBe(1);
    expect(s.c.get).toHaveBeenCalledTimes(1);
  });

  test("a concurrent change that matches the request: consistent, never attributed", async () => {
    const { s, u, ctl } = await setup(op);
    const result = op.run(ctl, u);
    await tick();
    last(s, op.kind).d.reject(fb("unavailable"));
    await tick();
    last(s, "get").d.resolve({ unit: at(u, { ...op.holds(u), revision: 7 }) });
    await result;
    expect(ctl.getState().pending[0].evaluation).toMatchObject({ finding: "consistentWithRequest", basis: "newerRevision", commit: "undetermined" });
    expect(mutationCalls(s)).toBe(1);
  });

  test("a concurrent change that does not match: changed since", async () => {
    const { s, u, ctl } = await setup(op);
    const result = op.run(ctl, u);
    await tick();
    last(s, op.kind).d.reject(err("teacherUnits.writeConflict"));
    await tick();
    const otherwise: Partial<TeacherUnit> =
      op.kind === "update" ? { title: "Theirs" }
      : op.kind === "archive" ? { title: "Theirs" }
      : op.kind === "restore" ? { title: "Theirs" }
      : { resourceIds: [] };
    last(s, "get").d.resolve({ unit: at(u, { ...otherwise, revision: 4 }) });
    await result;
    expect(ctl.getState().pending[0].evaluation.finding).toBe("changedSince");
  });

  test("the reread fails: unknown, retained, and a deliberate check reads (never mutates)", async () => {
    const { s, u, ctl } = await setup(op);
    const result = op.run(ctl, u);
    await tick();
    last(s, op.kind).d.reject(err("teacherUnits.responseUnavailable"));
    await tick();
    last(s, "get").d.reject(fb("unavailable"));
    const r = await result;
    expect(r).toMatchObject({ latest: null });
    expect(ctl.getState().pending[0].evaluation).toMatchObject({ finding: "unknown", basis: "readUnavailable" });
    const check = ctl.checkPendingMutation(ctl.getState().pending[0].record.id);
    await tick();
    expect(ctl.getState().pending[0].checking).toBe(true);
    expect(s.c.get).toHaveBeenCalledTimes(2);
    last(s, "get").d.resolve({ unit: at(u, { ...op.holds(u), revision: 4 }) });
    await check;
    expect(ctl.getState().pending[0]).toMatchObject({ checking: false, evaluation: { finding: "consistentWithRequest" } });
    expect(mutationCalls(s)).toBe(1);
  });

  test("the reread finds the unit gone: unknown (not found)", async () => {
    const { s, u, ctl } = await setup(op);
    const result = op.run(ctl, u);
    await tick();
    last(s, op.kind).d.reject(fb("unavailable"));
    await tick();
    last(s, "get").d.reject(err("teacherUnits.notFound"));
    await result;
    expect(ctl.getState().pending[0].evaluation).toMatchObject({ finding: "unknown", basis: "notFound" });
  });

  test("a confirmed success closes the record", async () => {
    const { s, u, ctl } = await setup(op);
    const result = op.run(ctl, u);
    await tick();
    last(s, op.kind).d.resolve({ unit: at(u, { ...op.holds(u), revision: 4 }), noop: false });
    expect((await result).kind).toBe("saved");
    expect(ctl.getState().pending).toEqual([]);
    expect(s.c.get).not.toHaveBeenCalled();
  });

  test("an account refusal stays uncertain without an automatic read", async () => {
    const { s, u, ctl } = await setup(op);
    const result = op.run(ctl, u);
    await tick();
    last(s, op.kind).d.reject(fb("permission-denied"));
    expect((await result).kind).toBe("error");
    expect(ctl.getState().pending[0]).toMatchObject({ status: "uncertain", evaluation: { basis: "notChecked" } });
    expect(s.c.get).not.toHaveBeenCalled();
  });

  test("a request that was never sent (compatibility) or refused in validation is not pending", async () => {
    for (const failure of [() => new TeacherUnitsCompatibilityError(), () => err("teacherUnits.invalidRequest")]) {
      const { s, u, ctl } = await setup(op);
      const result = op.run(ctl, u);
      await tick();
      last(s, op.kind).d.reject(failure());
      expect((await result).kind).toBe("error");
      expect(ctl.getState().pending).toEqual([]);
      expect(s.c.get).not.toHaveBeenCalled();
      expect(mutationCalls(s)).toBe(1);
    }
  });

  test("a definite placement refusal keeps its definite classification", async () => {
    if (op.kind !== "setResources") return;
    const { s, u, ctl } = await setup(op);
    const result = op.run(ctl, u);
    await tick();
    last(s, op.kind).d.reject({ details: { code: "teacherUnits.duplicateResource", resourceId: R2.id } });
    await tick();
    // The existing read after a placement refusal is preserved.
    last(s, "get").d.resolve({ unit: u });
    expect(await result).toMatchObject({ kind: "error", error: { category: "resourceRejected" } });
    expect(ctl.getState().pending).toEqual([]);
  });
});

describe("lifecycle above the controller (approved decision D1)", () => {
  test("navigation while in flight: the record survives, the remounted controller shows it, takes the single read, and never resends", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const first = await mount(s, [u], { registry });
    const pending = first.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    first.dispose(); // the teacher left Curriculum
    const second = await mount(s, [u], { registry });
    expect(second.getState().pending).toMatchObject([{ status: "inFlight", record: { intent: { op: "update", title: "Seeds" } } }]);
    expect(second.getState().busyUnitIds.has(u.unitId)).toBe(true);
    // A deliberate new change is refused while the original has no response.
    expect(await second.updateUnit(u.unitId, { title: "Again" })).toEqual({ kind: "busy" });
    // The late response reaches the record (the scope is unchanged), not the
    // disposed controller's view.
    s.calls.update[0].d.reject(fb("unavailable"));
    expect((await pending).kind).toBe("stale");
    await tick();
    expect(second.getState().pending[0].status).toBe("uncertain");
    expect(s.c.get).toHaveBeenCalledTimes(1);
    last(s, "get").d.resolve({ unit: at(u, { title: "Seeds", revision: 4 }) });
    await tick();
    expect(second.getState().pending[0].evaluation.finding).toBe("consistentWithRequest");
    expect(second.getState().busyUnitIds.has(u.unitId)).toBe(false);
    expect(s.c.update).toHaveBeenCalledTimes(1);
    expect(mutationCalls(s)).toBe(1);
  });

  test("remount after the read: the finding is restored without another automatic read", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const first = await mount(s, [u], { registry });
    const r = first.archiveUnit(u.unitId);
    await tick();
    last(s, "archive").d.reject(err("teacherUnits.responseUnavailable"));
    await tick();
    last(s, "get").d.resolve({ unit: u });
    await r;
    first.dispose();
    const second = await mount(s, [u], { registry });
    expect(second.getState().pending[0].evaluation.finding).toBe("notInEffectNow");
    await tick();
    expect(s.c.get).toHaveBeenCalledTimes(1);
    // Dismissal is explicit and sends nothing.
    expect(second.dismissPendingMutation(second.getState().pending[0].record.id)).toBe(true);
    expect(second.getState().pending).toEqual([]);
    expect(mutationCalls(s)).toBe(1);
  });

  test("a later list read re-evaluates the finding; an overlapping earlier read does not", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u], { registry });
    const r = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    void ctl.refresh(); // dispatched while the update is in flight
    const overlapping = last(s, "list");
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    last(s, "get").d.reject(fb("unavailable"));
    await r;
    overlapping.d.resolve({ units: [u] });
    await tick();
    expect(ctl.getState().pending[0].evaluation.basis).toBe("readUnavailable");
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [at(u, { title: "Other", revision: 5 })] });
    await tick();
    expect(ctl.getState().pending[0].evaluation.finding).toBe("changedSince");
  });

  test("an account change: no write reaches the new scope, and the old scope's records are cleared", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const first = await mount(s, [u], { registry });
    const r = first.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    ctx.current = B;
    first.dispose();
    const other = await mount(s, [], { registry, session: B });
    expect(other.getState().pending).toEqual([]);
    s.calls.update[0].d.reject(fb("unavailable"));
    expect((await r).kind).toBe("stale");
    await tick();
    expect(other.getState().pending).toEqual([]);
    expect(s.c.get).not.toHaveBeenCalled();
    // Back to the first teacher: nothing from before is shown.
    ctx.current = A;
    const again = await mount(s, [u], { registry });
    expect(again.getState().pending).toEqual([]);
  });

  test("a late response after the canonical context changed is ignored entirely", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u], { registry });
    const r = ctl.archiveUnit(u.unitId);
    await tick();
    ctx.current = null; // signed out
    s.calls.archive[0].d.reject(fb("unavailable"));
    expect((await r).kind).toBe("stale");
    expect(s.c.get).not.toHaveBeenCalled();
    // The record could not be written as settled or uncertain.
    expect(registry.forScope(A, () => true).list()[0].status).toBe("inFlight");
  });

  test("the surface seam owns one registry for every controller it creates", async () => {
    const s = scripted();
    const u = unit();
    const seam = createTeacherUnitsSurfaceSeam({
      callables: s.c as unknown as TeacherUnitsCallables,
      readFirebaseUid: () => "teacherA",
      readActiveTeacher: () => ({ uid: "teacherA", schoolId: "schoolA" }),
      createStore: (scope) => createTeacherUnitCreateAttemptStore(scope, () => window.localStorage),
    });
    const first = seam.createController({ uid: "teacherA", schoolId: "schoolA", initialGrade: "7" });
    last(s, "list").d.resolve({ units: [u] });
    await tick();
    const r = first.restoreUnit(u.unitId);
    await tick();
    last(s, "restore").d.reject(fb("functions/internal"));
    await tick();
    last(s, "get").d.reject(fb("unavailable"));
    await r;
    first.dispose();
    const second = seam.createController({ uid: "teacherA", schoolId: "schoolA", initialGrade: "7" });
    expect(second.getState().pending).toHaveLength(1);
    // A new bootstrap run builds a new seam: it starts empty (as does a reload).
    const nextRun = createTeacherUnitsSurfaceSeam({
      callables: s.c as unknown as TeacherUnitsCallables,
      readFirebaseUid: () => "teacherA",
      readActiveTeacher: () => ({ uid: "teacherA", schoolId: "schoolA" }),
      createStore: (scope) => createTeacherUnitCreateAttemptStore(scope, () => window.localStorage),
    });
    expect(nextRun.createController({ uid: "teacherA", schoolId: "schoolA", initialGrade: "7" }).getState().pending).toEqual([]);
    // Non-create teacher text is never written to browser storage.
    expect(JSON.stringify(Object.entries(window.localStorage))).not.toContain(u.unitId);
  });
});

describe("ownInFlight: the sending controller's own requests that have no response yet", () => {
  test("listed while its own request is outstanding, never after a response, never for another controller's request", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const v = unit();
    const ctl = await mount(s, [u, v], { registry });
    const seen: string[][] = [];
    ctl.subscribe(() => {
      const st = ctl.getState();
      // Every render that lists an in-flight entry of this controller's own
      // unit already marks it as its own: never a frame where it is not.
      for (const e of st.pending) {
        if (e.status === "inFlight" && e.record.unitId === u.unitId) seen.push([e.record.id, String(st.ownInFlight.has(e.record.id))]);
      }
    });
    const saved = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    const [entry] = ctl.getState().pending;
    expect(entry.status).toBe("inFlight");
    expect(ctl.getState().ownInFlight).toEqual(new Set([entry.record.id]));
    last(s, "update").d.resolve({ unit: at(u, { title: "Seeds", revision: 4 }), noop: false });
    expect((await saved).kind).toBe("saved");
    expect(ctl.getState().pending).toEqual([]);
    expect(ctl.getState().ownInFlight.size).toBe(0);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(([, own]) => own === "true")).toBe(true);

    // An uncertain outcome is no longer in flight, so it is never own.
    const lost = ctl.archiveUnit(v.unitId);
    await tick();
    expect(ctl.getState().ownInFlight.size).toBe(1);
    last(s, "archive").d.reject(fb("unavailable"));
    await tick();
    expect(ctl.getState().pending[0].status).toBe("uncertain");
    expect(ctl.getState().ownInFlight.size).toBe(0);
    last(s, "get").d.resolve({ unit: v });
    await lost;

    // Another controller's in-flight request is shown to this one, not as its own.
    const w = unit();
    const sender = await mount(s, [w], { registry });
    void sender.updateUnit(w.unitId, { title: "Theirs" });
    await tick();
    const receiver = await mount(s, [w], { registry });
    const theirs = receiver.getState().pending.find((e) => e.record.unitId === w.unitId)!;
    expect(theirs.status).toBe("inFlight");
    expect(receiver.getState().ownInFlight.has(theirs.record.id)).toBe(false);
    expect(sender.getState().ownInFlight.has(theirs.record.id)).toBe(true);
  });
});

describe("no automatic resend (structural)", () => {
  const src = fs.readFileSync(path.join(__dirname, "unitsController.ts"), "utf8");
  const coord = fs.readFileSync(path.join(__dirname, "saveCoordination.ts"), "utf8");
  const errors = fs.readFileSync(path.join(__dirname, "errors.ts"), "utf8");

  test("no resend signal exists", () => {
    for (const text of [src, coord, errors]) {
      expect(text).not.toMatch(/\bcanResend\b/);
      expect(text).not.toMatch(/\bisSafeToResend\b/);
    }
  });

  test("each revision-guarded callable is invoked from exactly one dispatch closure", () => {
    for (const name of ["update", "archive", "restore", "setResources"]) {
      const sites = src.match(new RegExp(`deps\\.callables\\.${name}\\(`, "g")) ?? [];
      expect({ name, sites: sites.length }).toEqual({ name, sites: 1 });
      expect(src).toMatch(new RegExp(`send: \\(\\) => deps\\.callables\\.${name}\\(`));
    }
    // The controller has no reorder consumer.
    expect(src).not.toMatch(/deps\.callables\.reorder\(/);
  });

  test("the only dispatch site of a mutation is the gate in `mutate`, which runs once", () => {
    expect(src.match(/runTeacherUnitMutation\(step\.send\)/g) ?? []).toHaveLength(1);
  });
});

// ---------- Independent certification remediation (P2-1 to P2-4) ----------

describe.each(OPS)("P2-1 D3 guard: $name", (op) => {
  test("a failed reread never permits a new send; a fresh read does, and the new send carries the read revision", async () => {
    const { s, u, ctl } = await setup(op);
    const first = op.run(ctl, u);
    await tick();
    last(s, op.kind).d.reject(fb("functions/deadline-exceeded"));
    await tick();
    last(s, "get").d.reject(fb("unavailable"));
    await first;
    // Repeated attempts are refused in the controller, without a call.
    expect(await op.run(ctl, u)).toEqual({ kind: "needsCheck" });
    expect(await op.run(ctl, u)).toEqual({ kind: "needsCheck" });
    expect(s.c[op.kind]).toHaveBeenCalledTimes(1);
    // Dismissing the notice is not a read: still refused.
    ctl.dismissPendingMutation(ctl.getState().pending[0].record.id);
    expect(await op.run(ctl, u)).toEqual({ kind: "needsCheck" });
    // A deliberate read-only recovery restores eligibility.
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [at(u, { revision: 6 })] });
    await tick();
    const next = op.run(ctl, u);
    await tick();
    expect(s.c[op.kind]).toHaveBeenCalledTimes(2);
    expect(last(s, op.kind).req).toMatchObject({ unitId: u.unitId, expectedRevision: 6 });
    last(s, op.kind).d.resolve({ unit: at(u, { ...op.holds(u), revision: 7 }), noop: false });
    expect((await next).kind).toBe("saved");
    expect(mutationCalls(s)).toBe(2);
  });
});

describe("P2-1 recovery through Check current state", () => {
  test("an unconfirmed edit, a failed reread, Check current state, then a deliberate Save", async () => {
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u]);
    const first = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    last(s, "get").d.reject(fb("unavailable"));
    await first;
    expect(await ctl.updateUnit(u.unitId, { title: "Seeds" })).toEqual({ kind: "needsCheck" });
    const check = ctl.checkPendingMutation(ctl.getState().pending[0].record.id);
    last(s, "get").d.resolve({ unit: u });
    await check;
    expect(ctl.getState().pending[0].evaluation.finding).toBe("notInEffectNow");
    const again = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    expect(s.c.update).toHaveBeenCalledTimes(2);
    last(s, "update").d.resolve({ unit: at(u, { title: "Seeds", revision: 4 }), noop: false });
    expect((await again).kind).toBe("saved");
  });

  test("an account refusal (no automatic read) also requires a read first", async () => {
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u]);
    const first = ctl.archiveUnit(u.unitId);
    await tick();
    last(s, "archive").d.reject(fb("permission-denied"));
    await first;
    expect(await ctl.restoreUnit(u.unitId)).toEqual({ kind: "needsCheck" });
    expect(await ctl.addResources(u.unitId, [R2.id])).toEqual({ kind: "needsCheck" });
    expect(mutationCalls(s)).toBe(1);
  });
});

describe("P2-2 findings follow every accepted change", () => {
  test("a later confirmed change re-evaluates an earlier consistent finding; the card state agrees", async () => {
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u]);
    const first = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    last(s, "get").d.resolve({ unit: at(u, { title: "Seeds", revision: 4 }) });
    await first;
    expect(ctl.getState().pending[0].evaluation.finding).toBe("consistentWithRequest");
    const later = ctl.updateUnit(u.unitId, { title: "Trees" });
    await tick();
    expect(last(s, "update").req).toMatchObject({ expectedRevision: 4 });
    last(s, "update").d.resolve({ unit: at(u, { title: "Trees", revision: 5 }), noop: false });
    await later;
    expect(ctl.getKnownUnit(u.unitId)?.title).toBe("Trees");
    expect(ctl.getState().pending[0].evaluation).toEqual({
      finding: "changedSince",
      basis: "newerRevision",
      observedRevision: 5,
      commit: "undetermined",
    });
  });
});

describe("P2-3 revision-monotonic evidence", () => {
  test("a revision 5 read, then a later-dispatched revision 3 list: neither the finding nor the unit regress", async () => {
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u]);
    const first = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    const reread = last(s, "get");
    void ctl.refresh(); // dispatched after the reread
    const list = last(s, "list");
    reread.d.resolve({ unit: at(u, { title: "Seeds", revision: 5 }) });
    await first;
    list.d.resolve({ units: [u] }); // older snapshot
    await tick();
    expect(ctl.getKnownUnit(u.unitId)?.revision).toBe(5);
    expect(ctl.getState().pending[0].evaluation).toMatchObject({ finding: "consistentWithRequest", observedRevision: 5 });
  });

  test("out-of-order completion: the higher revision wins whichever completes last", async () => {
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u]);
    const first = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    const reread = last(s, "get");
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [at(u, { title: "Seeds", revision: 6 })] });
    await tick();
    reread.d.resolve({ unit: at(u, { title: "Other", revision: 4 }) });
    await first;
    expect(ctl.getKnownUnit(u.unitId)).toMatchObject({ title: "Seeds", revision: 6 });
    expect(ctl.getState().pending[0].evaluation).toMatchObject({ finding: "consistentWithRequest", observedRevision: 6 });
  });

  test("an equal revision observed only before the outcome is not a finding; observed again after, it is", async () => {
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u]);
    const first = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    void ctl.refresh(); // overlaps the request
    const overlapping = last(s, "list");
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    last(s, "get").d.reject(fb("unavailable"));
    await first;
    overlapping.d.resolve({ units: [u] });
    await tick();
    expect(ctl.getState().pending[0].evaluation.basis).toBe("readUnavailable");
    expect(await ctl.updateUnit(u.unitId, { title: "Seeds" })).toEqual({ kind: "needsCheck" });
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [u] });
    await tick();
    expect(ctl.getState().pending[0].evaluation).toMatchObject({ finding: "notInEffectNow", basis: "sameRevision" });
  });
});

describe("P2-4 remount and late results", () => {
  test("a confirmed success after disposal reaches the remounted controller and is recorded once", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const first = await mount(s, [u], { registry });
    const r = first.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    first.dispose();
    const second = await mount(s, [u], { registry });
    last(s, "update").d.resolve({ unit: at(u, { title: "Seeds", revision: 4 }), noop: false });
    expect((await r).kind).toBe("stale");
    await tick();
    expect(second.getState().pending).toEqual([]);
    expect(second.getKnownUnit(u.unitId)).toMatchObject({ title: "Seeds", revision: 4 });
    const listed = second.getState().list;
    expect(listed.kind === "ready" && listed.units.map((x) => x.title)).toEqual(["Seeds"]);
    expect(second.getState().resolutions).toMatchObject([{ outcome: "saved", record: { intent: { op: "update", title: "Seeds" } } }]);
    // Eligible right away: the confirmed write is newer accepted state.
    const next = second.archiveUnit(u.unitId);
    await tick();
    expect(last(s, "archive").req).toMatchObject({ expectedRevision: 4 });
    last(s, "archive").d.resolve({ unit: at(u, { title: "Seeds", status: "archived", archivedAtMillis: 9, revision: 5 }), noop: false });
    await next;
    expect(mutationCalls(s)).toBe(2);
  });

  test("a definite refusal after disposal is recorded as not made, never as pending", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const first = await mount(s, [u], { registry });
    const r = first.archiveUnit(u.unitId);
    await tick();
    first.dispose();
    const second = await mount(s, [u], { registry });
    last(s, "archive").d.reject(new TeacherUnitsCompatibilityError());
    await r;
    await tick();
    expect(second.getState().pending).toEqual([]);
    expect(second.getState().resolutions).toMatchObject([{ outcome: "notMade" }]);
  });

  test.each([
    ["reread first, then the older remount list", true],
    ["remount list first, then the reread", false],
  ])("%s: the new controller holds the newer revision", async (_label, rereadFirst) => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const first = await mount(s, [u], { registry });
    const r = first.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    const reread = last(s, "get");
    first.dispose();
    // Mount without resolving its list yet.
    const second = createTeacherUnitsController({
      callables: s.c as unknown as TeacherUnitsCallables,
      session: A,
      readCurrentContext: () => ctx.current,
      store: createTeacherUnitCreateAttemptStore(A, () => window.localStorage),
      initialGrade: "7",
      pendingRegistry: registry,
    });
    const remountList = last(s, "list");
    if (rereadFirst) {
      reread.d.resolve({ unit: at(u, { title: "Seeds", revision: 4 }) });
      await r;
      remountList.d.resolve({ units: [u] });
    } else {
      remountList.d.resolve({ units: [u] });
      await tick();
      reread.d.resolve({ unit: at(u, { title: "Seeds", revision: 4 }) });
      await r;
    }
    await tick();
    expect(second.getKnownUnit(u.unitId)).toMatchObject({ title: "Seeds", revision: 4 });
    const listed = second.getState().list;
    expect(listed.kind === "ready" && listed.units.map((x) => x.revision)).toEqual([4]);
    expect(second.getState().pending[0].evaluation.finding).toBe("consistentWithRequest");
    // One automatic read in total, one mutation in total.
    expect(s.c.get).toHaveBeenCalledTimes(1);
    expect(mutationCalls(s)).toBe(1);
  });

  test("repeated remounts never add automatic reads or sends", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const first = await mount(s, [u], { registry });
    void first.restoreUnit(u.unitId);
    await tick();
    first.dispose();
    let ctl = await mount(s, [u], { registry });
    last(s, "restore").d.reject(fb("unavailable"));
    await tick();
    expect(s.c.get).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 3; i++) {
      ctl.dispose();
      ctl = await mount(s, [u], { registry });
      await tick();
    }
    expect(s.c.get).toHaveBeenCalledTimes(1);
    expect(mutationCalls(s)).toBe(1);
  });

  test("uid or school changes during late callbacks leak no state or evidence", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit({ title: "Private A" });
    const first = await mount(s, [u], { registry });
    const r = first.updateUnit(u.unitId, { title: "Secret A" });
    await tick();
    for (const other of [B, { teacherId: "teacherA", schoolId: "schoolB" }]) {
      ctx.current = other;
      const view = registry.forScope(other, () => true);
      // The late result of A's request lands after the switch.
      if (other === B) {
        last(s, "update").d.resolve({ unit: at(u, { title: "Secret A", revision: 4 }), noop: false });
        await r;
      }
      await tick();
      expect(view.list()).toEqual([]);
      expect(view.units()).toEqual([]);
      expect(view.resolutions()).toEqual([]);
      const ctl = await mount(s, [], { registry, session: other });
      expect(JSON.stringify(ctl.getState())).not.toMatch(/Secret A|Private A/);
      ctl.dispose();
    }
  });
});

// ---------- Second independent recertification (F1 to F3, F6) ----------

// An uncertain edit whose automatic reread fails: the D3 guard is active.
async function guarded(u: TeacherUnit, run: (c: TeacherUnitsController) => Promise<UnitMutationResult>, kind: Op["kind"]) {
  const s = scripted();
  const ctl = await mount(s, [u]);
  const first = run(ctl);
  await tick();
  last(s, kind).d.reject(fb("unavailable"));
  await tick();
  last(s, "get").d.reject(fb("unavailable"));
  await first;
  return { s, ctl };
}

describe("F1: no answer from held state while the guard is active", () => {
  test.each([
    ["an edit back to the cached title (local no-op)", (c: TeacherUnitsController, u: TeacherUnit) => c.updateUnit(u.unitId, { title: u.title })],
    ["an edit to the cached description (local no-op)", (c: TeacherUnitsController, u: TeacherUnit) => c.updateUnit(u.unitId, { description: u.description })],
    ["adding a resource the cache already holds", (c: TeacherUnitsController, u: TeacherUnit) => c.addResources(u.unitId, [R1.id])],
    ["removing a resource the cache does not hold", (c: TeacherUnitsController, u: TeacherUnit) => c.removeResource(u.unitId, R2.id)],
    ["a move at the cached boundary", (c: TeacherUnitsController, u: TeacherUnit) => c.moveResource(u.unitId, R1.id, "up")],
    ["a repair with no cached unavailable resources", (c: TeacherUnitsController, u: TeacherUnit) => c.removeRetiredResources(u.unitId)],
    ["an archive", (c: TeacherUnitsController, u: TeacherUnit) => c.archiveUnit(u.unitId)],
  ])("%s returns needsCheck, never saved or noop, and sends nothing", async (_label, attempt) => {
    const u = unit();
    const { s, ctl } = await guarded(u, (c) => c.updateUnit(u.unitId, { title: "Seeds" }), "update");
    expect(await attempt(ctl, u)).toEqual({ kind: "needsCheck" });
    expect(mutationCalls(s)).toBe(1);
    expect(ctl.getState().pending[0].status).toBe("uncertain");
  });

  test("an archived cache refusal is not given either: restore-only state is not trusted", async () => {
    const u = unit({ status: "archived", archivedAtMillis: 9 });
    const { s, ctl } = await guarded(u, (c) => c.restoreUnit(u.unitId), "restore");
    expect(await ctl.addResources(u.unitId, [R2.id])).toEqual({ kind: "needsCheck" });
    expect(await ctl.updateUnit(u.unitId, { title: "Plants" })).toEqual({ kind: "needsCheck" });
    expect(mutationCalls(s)).toBe(1);
  });

  test("while any change to the unit is in flight, a cached no-op is busy, not saved", async () => {
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u]);
    void ctl.archiveUnit(u.unitId);
    await tick();
    expect(await ctl.updateUnit(u.unitId, { title: u.title })).toEqual({ kind: "busy" });
    expect(await ctl.addResources(u.unitId, [R1.id])).toEqual({ kind: "busy" });
  });

  test("after an accepted fresh read, the local no-op answers again (from fresh state)", async () => {
    const u = unit();
    const { s, ctl } = await guarded(u, (c) => c.updateUnit(u.unitId, { title: "Seeds" }), "update");
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [u] });
    await tick();
    expect(await ctl.updateUnit(u.unitId, { title: u.title })).toMatchObject({ kind: "saved", noop: true });
    expect(mutationCalls(s)).toBe(1);
  });
});

describe("F2: conflicting content at one revision", () => {
  test("a conflicting reread keeps the guard, makes the finding unknown, and holds the earlier content", async () => {
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u]);
    const first = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    last(s, "get").d.resolve({ unit: at(u, { title: "Seeds" }) }); // same revision, different content
    await first;
    expect(ctl.getState().pending[0].evaluation).toMatchObject({ finding: "unknown", basis: "inconsistent" });
    expect(ctl.getKnownUnit(u.unitId)?.title).toBe("Plants");
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
    // Repeated conflicting and matching observations at that revision do not resolve it.
    for (const title of ["Other", "Plants", "Seeds"]) {
      void ctl.refresh();
      last(s, "list").d.resolve({ units: [at(u, { title })] });
      await tick();
      expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
    }
    // An older revision completing late changes nothing.
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [at(u, { revision: 2 })] });
    await tick();
    expect(ctl.getState().pending[0].evaluation.basis).toBe("inconsistent");
    // A higher revision resolves it.
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [at(u, { title: "Seeds", revision: 4 })] });
    await tick();
    expect(ctl.getState().pending[0].evaluation).toMatchObject({ finding: "consistentWithRequest", observedRevision: 4 });
    expect(ctl.getKnownUnit(u.unitId)).toMatchObject({ title: "Seeds", revision: 4 });
    const next = ctl.archiveUnit(u.unitId);
    await tick();
    expect(last(s, "archive").req).toMatchObject({ expectedRevision: 4 });
    last(s, "archive").d.resolve({ unit: at(u, { title: "Seeds", status: "archived", archivedAtMillis: 9, revision: 5 }), noop: false });
    await next;
    expect(mutationCalls(s)).toBe(2);
  });
});

describe("F3: authoritative absence", () => {
  async function consistentRename(registry = createPendingMutationRegistry()) {
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u], { registry });
    const first = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    last(s, "get").d.resolve({ unit: at(u, { title: "Seeds", revision: 4 }) });
    await first;
    return { s, u, ctl, registry };
  }

  test("a complete list (archived included) that omits the unit: card and finding agree it is gone", async () => {
    const { s, u, ctl } = await consistentRename();
    ctl.setShowArchived(true);
    last(s, "list").d.resolve({ units: [] });
    await tick();
    expect(ctl.getUnitState(u.unitId).kind).toBe("absent");
    const listed = ctl.getState().list;
    expect(listed.kind === "ready" && listed.units).toEqual([]);
    expect(ctl.getState().pending[0].evaluation).toMatchObject({ finding: "unknown", basis: "notFound", commit: "undetermined" });
  });

  test("an active-only list or a failed list is not absence evidence", async () => {
    const { s, ctl } = await consistentRename();
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [] }); // active-only: the unit may be archived
    await tick();
    expect(ctl.getState().pending[0].evaluation.finding).toBe("consistentWithRequest");
    ctl.setShowArchived(true);
    last(s, "list").d.reject(fb("unavailable"));
    await tick();
    expect(ctl.getState().pending[0].evaluation.finding).toBe("consistentWithRequest");
  });

  test("another grade's complete list never implies absence (a unit's grade never changes)", async () => {
    const { s, u, ctl } = await consistentRename();
    ctl.setShowArchived(true);
    last(s, "list").d.resolve({ units: [at(u, { title: "Seeds", revision: 4 })] });
    await tick();
    ctl.setGrade("6");
    last(s, "list").d.resolve({ units: [] });
    await tick();
    expect(ctl.getState().pending[0].evaluation.finding).toBe("consistentWithRequest");
  });

  test("concurrent live controllers adopt each other's absence", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const one = await mount(s, [u], { registry });
    const two = await mount(s, [u], { registry });
    const r = one.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    last(s, "get").d.reject(err("teacherUnits.notFound"));
    await r;
    await tick();
    // The sending controller made the single automatic read itself.
    expect(s.c.get).toHaveBeenCalledTimes(1);
    for (const ctl of [one, two]) {
      expect(ctl.getUnitState(u.unitId).kind).toBe("absent");
      const listed = ctl.getState().list;
      expect(listed.kind === "ready" && listed.units).toEqual([]);
    }
  });

  test.each([
    ["the remount list completes first", true],
    ["the late notFound completes first", false],
  ])("late notFound after remount (%s): the replacement shows the unit gone", async (_label, listFirst) => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const first = await mount(s, [u], { registry });
    const r = first.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    const reread = last(s, "get");
    first.dispose();
    const second = createTeacherUnitsController({
      callables: s.c as unknown as TeacherUnitsCallables,
      session: A,
      readCurrentContext: () => ctx.current,
      store: createTeacherUnitCreateAttemptStore(A, () => window.localStorage),
      initialGrade: "7",
      pendingRegistry: registry,
    });
    const remountList = last(s, "list");
    if (listFirst) {
      remountList.d.resolve({ units: [u] });
      await tick();
      reread.d.reject(err("teacherUnits.notFound"));
    } else {
      reread.d.reject(err("teacherUnits.notFound"));
      await tick();
      remountList.d.resolve({ units: [u] });
    }
    await r;
    await tick();
    expect(second.getUnitState(u.unitId).kind).toBe("absent");
    const listed = second.getState().list;
    expect(listed.kind === "ready" && listed.units).toEqual([]);
    expect(second.getState().pending[0].evaluation.basis).toBe("notFound");
    expect(s.c.get).toHaveBeenCalledTimes(1);
    expect(mutationCalls(s)).toBe(1);
  });

  test("a stale absence never hides a newer revision, and a later read restores presence", async () => {
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u]);
    const r = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    const staleGet = last(s, "get"); // dispatched first
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [at(u, { title: "Seeds", revision: 5 })] }); // a newer revision
    await tick();
    staleGet.d.reject(err("teacherUnits.notFound")); // arrives last
    await r;
    expect(ctl.getUnitState(u.unitId).kind).toBe("active");
    expect(ctl.getState().pending[0].evaluation).toMatchObject({ finding: "consistentWithRequest", observedRevision: 5 });
  });
});

describe("F6: bounded tracking fails closed", () => {
  test("at PENDING_MAX unconfirmed changes a new change is refused before sending; dismissing makes room", async () => {
    const registry = createPendingMutationRegistry();
    const view = registry.forScope(A, () => true);
    for (let i = 0; i < PENDING_MAX; i++) {
      const id = view.begin({ unitId: `Other${i}`, expectedRevision: 1, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
      view.markUncertain(id, normalizeTeacherUnitError(fb("unavailable")));
    }
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u], { registry });
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "capacity", reason: "pending" });
    expect(await ctl.updateUnit(u.unitId, { title: "Seeds" })).toEqual({ kind: "capacity", reason: "pending" });
    expect(mutationCalls(s)).toBe(0);
    expect(ctl.getState().pending).toHaveLength(PENDING_MAX);
    ctl.dismissPendingMutation(ctl.getState().pending[0].record.id);
    const next = ctl.archiveUnit(u.unitId);
    await tick();
    expect(mutationCalls(s)).toBe(1);
    last(s, "archive").d.resolve({ unit: at(u, { status: "archived", archivedAtMillis: 9, revision: 4 }), noop: false });
    expect((await next).kind).toBe("saved");
  });
});

// ---------- Third remediation (F1 to F4) ----------

describe("third remediation F1: a read below the base never releases the guard", () => {
  // A held revision 5 whose shared evidence was pruned, then an uncertain
  // rename based on it.
  async function prunedRevision5() {
    const registry = createPendingMutationRegistry();
    const view = registry.forScope(A, () => true);
    const s = scripted();
    const u = unit({ revision: 5 });
    const ctl = await mount(s, [u], { registry });
    for (let i = 0; i <= UNIT_EVIDENCE_MAX; i++) view.accept(unit({ unitId: `Prune${i}` }), view.stamp());
    expect(view.latest(u.unitId)).toBeNull();
    const first = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    expect(last(s, "update").req).toMatchObject({ expectedRevision: 5 });
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    return { s, u, ctl, view, first };
  }

  test("revision 5 then revision 3: inconsistent, guarded, nothing sent, however often it is read", async () => {
    const { s, u, ctl, view, first } = await prunedRevision5();
    last(s, "get").d.resolve({ unit: at(u, { revision: 3 }) });
    await first;
    expect(ctl.getState().pending[0].evaluation).toMatchObject({ finding: "unknown", basis: "inconsistent" });
    expect(ctl.getKnownUnit(u.unitId)?.revision).toBe(5);
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
    for (let i = 0; i < 2; i++) {
      const check = ctl.checkPendingMutation(ctl.getState().pending[0].record.id);
      last(s, "get").d.resolve({ unit: at(u, { revision: 3 }) });
      await check;
      void ctl.refresh();
      last(s, "list").d.resolve({ units: [at(u, { revision: 3 })] });
      await tick();
      expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
    }
    expect(view.requiresFreshRead(u.unitId)).toBe(true);
    expect(mutationCalls(s)).toBe(1);
  });

  test("revision 5 then revision 5 (same base, read after the outcome): a deliberate new change is allowed", async () => {
    const { s, u, ctl, first } = await prunedRevision5();
    last(s, "get").d.resolve({ unit: u });
    await first;
    expect(ctl.getState().pending[0].evaluation).toMatchObject({ finding: "notInEffectNow", commit: "undetermined" });
    const next = ctl.archiveUnit(u.unitId);
    await tick();
    expect(last(s, "archive").req).toMatchObject({ expectedRevision: 5 });
    last(s, "archive").d.resolve({ unit: at(u, { status: "archived", archivedAtMillis: 9, revision: 6 }), noop: false });
    await next;
  });

  test("revision 5 then revision 6: changed since, and the new change carries revision 6", async () => {
    const { s, u, ctl, first } = await prunedRevision5();
    last(s, "get").d.resolve({ unit: at(u, { title: "Other", revision: 6 }) });
    await first;
    expect(ctl.getState().pending[0].evaluation.finding).toBe("changedSince");
    void ctl.archiveUnit(u.unitId);
    await tick();
    expect(last(s, "archive").req).toMatchObject({ expectedRevision: 6 });
  });

  test("a failed read, or a conflicting read at the base, keeps the guard; a later consistent read releases it", async () => {
    const { s, u, ctl, first } = await prunedRevision5();
    last(s, "get").d.reject(fb("unavailable"));
    await first;
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [at(u, { title: "Conflicting" })] });
    await tick();
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
    expect(ctl.getState().pending[0].evaluation.basis).toBe("inconsistent");
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [at(u, { revision: 7 })] });
    await tick();
    void ctl.archiveUnit(u.unitId);
    await tick();
    expect(last(s, "archive").req).toMatchObject({ expectedRevision: 7 });
    expect(mutationCalls(s)).toBe(2);
  });
});

describe("third remediation F2: overlapping absence and positive reads", () => {
  // An uncertain rename; its automatic get and a later list overlap.
  async function overlapping(registry = createPendingMutationRegistry()) {
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u], { registry });
    const first = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    const get = last(s, "get");
    void ctl.refresh(); // dispatched after the get
    const list = last(s, "list");
    return { s, u, ctl, first, get, list, registry };
  }
  const agree = (ctl: TeacherUnitsController, unitId: string, kind: "active" | "absent", finding: string) => {
    expect(ctl.getUnitState(unitId).kind).toBe(kind);
    const listed = ctl.getState().list;
    expect(listed.kind === "ready" && listed.units.length).toBe(kind === "active" ? 1 : 0);
    expect(ctl.getState().pending[0].evaluation.finding).toBe(finding);
  };

  test.each([
    ["notFound first, then the newer revision", true],
    ["the newer revision first, then notFound", false],
  ])("a newer revision first seen by the later read wins (%s): card, record and finding agree", async (_l, absenceFirst) => {
    const { u, ctl, first, get, list } = await overlapping();
    const newer = { units: [at(u, { title: "Seeds", revision: 5 })] };
    if (absenceFirst) {
      get.d.reject(err("teacherUnits.notFound"));
      await first;
      list.d.resolve(newer);
    } else {
      list.d.resolve(newer);
      await tick();
      get.d.reject(err("teacherUnits.notFound"));
      await first;
    }
    await tick();
    agree(ctl, u.unitId, "active", "consistentWithRequest");
  });

  test.each([
    ["notFound first", true],
    ["the overlapping same-revision list first", false],
  ])("an overlapping read of an already-known revision never hides the absence (%s)", async (_l, absenceFirst) => {
    const { s, u, ctl, first, get, list } = await overlapping();
    if (absenceFirst) {
      get.d.reject(err("teacherUnits.notFound"));
      await first;
      list.d.resolve({ units: [u] });
    } else {
      list.d.resolve({ units: [u] });
      await tick();
      get.d.reject(err("teacherUnits.notFound"));
      await first;
    }
    await tick();
    agree(ctl, u.unitId, "absent", "unknown");
    // A read dispatched after the absence was received is newer evidence.
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [u] });
    await tick();
    agree(ctl, u.unitId, "active", "notInEffectNow");
  });

  test("concurrent controllers and a remount reach the same verdict", async () => {
    const registry = createPendingMutationRegistry();
    const { s, u, ctl, first, get, list } = await overlapping(registry);
    const other = await mount(s, [u], { registry });
    get.d.reject(err("teacherUnits.notFound"));
    await first;
    list.d.resolve({ units: [at(u, { title: "Seeds", revision: 5 })] });
    await tick();
    agree(ctl, u.unitId, "active", "consistentWithRequest");
    expect(other.getUnitState(u.unitId).kind).toBe("active");
    ctl.dispose();
    other.dispose();
    const remounted = await mount(s, [at(u, { title: "Seeds", revision: 5 })], { registry });
    agree(remounted, u.unitId, "active", "consistentWithRequest");
  });

  test("a scope switch carries no absence or record across", async () => {
    const registry = createPendingMutationRegistry();
    const { s, u, first, get } = await overlapping(registry);
    get.d.reject(err("teacherUnits.notFound"));
    await first;
    ctx.current = B;
    const view = registry.forScope(B, () => true);
    expect(view.units()).toEqual([]);
    const ctl = await mount(s, [], { registry, session: B });
    expect(ctl.getUnitState(u.unitId).kind).toBe("unknown");
  });
});

describe("third remediation F3: guards release as soon as qualifying evidence arrives", () => {
  const guardUnits = (registry: PendingMutationRegistry, n: number, from = 0) => {
    const view = registry.forScope(A, () => true);
    for (let i = from; i < from + n; i++) {
      const id = view.begin({ unitId: `Guard${i}`, expectedRevision: 3, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
      view.markUncertain(id, normalizeTeacherUnitError(fb("unavailable")));
      view.dismiss(id);
    }
    return view;
  };
  const listed = (n: number, revision: number, from = 0) =>
    Array.from({ length: n }, (_, i) => unit({ unitId: `Guard${i + from}`, revision }));

  test("one complete refresh releases every eligible guard; a new unit's change is then sent", async () => {
    const registry = createPendingMutationRegistry();
    guardUnits(registry, GUARDS_MAX);
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u], { registry });
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "capacity", reason: "blocking" });
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [u, ...listed(GUARDS_MAX, 3)] }); // same base, read after the outcomes
    await tick();
    void ctl.archiveUnit(u.unitId);
    await tick();
    expect(s.c.archive).toHaveBeenCalledTimes(1);
  });

  test("partial, repeated, failed and conflicting refreshes release exactly the qualifying guards", async () => {
    const registry = createPendingMutationRegistry();
    const view = guardUnits(registry, GUARDS_MAX);
    for (let i = 0; i < GUARDS_MAX; i++) view.accept(unit({ unitId: `Guard${i}`, revision: 3, title: "Before" }), 0);
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u], { registry });
    // Failed list: nothing released.
    void ctl.refresh();
    last(s, "list").d.reject(fb("unavailable"));
    await tick();
    expect(view.atCapacity(u.unitId)).toBe(true);
    // Conflicting content at the base (different title, same revision): not released.
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [u, ...listed(10, 3)] });
    await tick();
    expect(view.requiresFreshRead("Guard0")).toBe(true);
    expect(view.atCapacity(u.unitId)).toBe(true);
    // Below the base: not released.
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [u, ...listed(10, 2, 10)] });
    await tick();
    expect(view.requiresFreshRead("Guard10")).toBe(true);
    // Partial newer refresh: exactly those 5 released, repeated twice with
    // identical content (different content would be a conflict and block).
    const newer = listed(5, 4, 20);
    for (let k = 0; k < 2; k++) {
      void ctl.refresh();
      last(s, "list").d.resolve({ units: [u, ...newer] });
      await tick();
    }
    expect(view.atCapacity(u.unitId)).toBe(false);
    expect(view.requiresFreshRead("Guard20")).toBe(false);
    expect(view.requiresFreshRead("Guard25")).toBe(true);
    expect(view.requiresFreshRead("Guard0")).toBe(true);
  });

  test("a scope change drops the old scope's guards entirely", () => {
    const registry = createPendingMutationRegistry();
    const view = guardUnits(registry, GUARDS_MAX);
    expect(view.atCapacity("new")).toBe(true);
    const other = registry.forScope(B, () => true);
    expect(other.atCapacity("new")).toBe(false);
    expect(other.requiresFreshRead("Guard0")).toBe(false);
    expect(registry.forScope(A, () => true).atCapacity("new")).toBe(false);
  });
});

describe("third remediation F4: controller bookkeeping stays bounded", () => {
  test("many sequential settled and uncertain operations leave no per-request state behind", async () => {
    const s = scripted();
    let u = unit();
    const ctl = await mount(s, [u]);
    for (let i = 0; i < 300; i++) {
      const r = ctl.updateUnit(u.unitId, { title: `T${i}` });
      await tick();
      if (i % 3 === 0) {
        last(s, "update").d.reject(fb("unavailable"));
        await tick();
        u = at(u, { title: `T${i}`, revision: u.revision + 1 });
        last(s, "get").d.resolve({ unit: u });
        await r;
        ctl.dismissPendingMutation(ctl.getState().pending[0].record.id);
      } else {
        u = at(u, { title: `T${i}`, revision: u.revision + 1 });
        last(s, "update").d.resolve({ unit: u, noop: false });
        await r;
      }
    }
    expect(ctl.getState().pending).toEqual([]);
    expect(ctl.getState().busyUnitIds.size).toBe(0);
    expect(s.c.update).toHaveBeenCalledTimes(300);
    expect(s.c.get).toHaveBeenCalledTimes(100);
    const src = fs.readFileSync(path.join(__dirname, "unitsController.ts"), "utf8");
    expect(src).not.toMatch(/ownEntries/);
  });
});

// ---------- Fourth remediation (P2-1 re-blocking, P2-2 pre-outcome absence) ----------

describe("fourth remediation P2-1: eligibility is re-derived from every later observation", () => {
  // An uncertain rename (base 3) whose automatic read qualifies at revision 4.
  async function qualified(registry = createPendingMutationRegistry()) {
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u], { registry });
    const first = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    const v4 = at(u, { title: "Seeds", revision: 4 });
    last(s, "get").d.resolve({ unit: v4 });
    await first;
    expect(ctl.getState().pending[0].evaluation.finding).toBe("consistentWithRequest");
    return { s, u, v4, ctl, registry };
  }
  const listWith = async (s: S, ctl: TeacherUnitsController, units: TeacherUnit[]) => {
    void ctl.refresh();
    last(s, "list").d.resolve({ units });
    await tick();
  };

  test("qualifying revision 4, then conflicting revision 4: blocked again, nothing sent", async () => {
    const { s, v4, ctl } = await qualified();
    await listWith(s, ctl, [at(v4, { title: "Conflicting" })]);
    expect(ctl.getState().pending[0].evaluation).toMatchObject({ finding: "unknown", basis: "inconsistent" });
    expect(await ctl.archiveUnit(v4.unitId)).toEqual({ kind: "needsCheck" });
    expect(await ctl.updateUnit(v4.unitId, { title: "Seeds" })).toEqual({ kind: "needsCheck" });
    expect(mutationCalls(s)).toBe(1);
  });

  test("qualifying, then a below-base read: blocked again; a later higher revision recovers", async () => {
    const { s, u, v4, ctl } = await qualified();
    await listWith(s, ctl, [at(u, { revision: 2 })]);
    expect(await ctl.archiveUnit(v4.unitId)).toEqual({ kind: "needsCheck" });
    await listWith(s, ctl, [at(v4, { revision: 5 })]);
    void ctl.archiveUnit(v4.unitId);
    await tick();
    expect(last(s, "archive").req).toMatchObject({ expectedRevision: 5 });
  });

  test("a failed read after qualifying changes nothing; dismissal never bypasses a later conflict", async () => {
    const { s, v4, ctl } = await qualified();
    const check = ctl.checkPendingMutation(ctl.getState().pending[0].record.id);
    last(s, "get").d.reject(fb("unavailable"));
    await check;
    expect(ctl.getState().pending[0].evaluation.finding).toBe("consistentWithRequest");
    ctl.dismissPendingMutation(ctl.getState().pending[0].record.id);
    expect(ctl.getState().pending).toEqual([]);
    await listWith(s, ctl, [at(v4, { title: "Conflicting" })]);
    expect(await ctl.archiveUnit(v4.unitId)).toEqual({ kind: "needsCheck" });
    expect(mutationCalls(s)).toBe(1);
  });

  test("repeated recovery and conflict cycles block exactly while the evidence is inconsistent", async () => {
    const { s, v4, ctl } = await qualified();
    let rev = 4;
    for (let k = 0; k < 4; k++) {
      await listWith(s, ctl, [at(v4, { title: `Conflict ${k}`, revision: rev })]);
      expect(await ctl.archiveUnit(v4.unitId)).toEqual({ kind: "needsCheck" });
      rev++;
      await listWith(s, ctl, [at(v4, { title: `Recovered ${k}`, revision: rev })]);
      expect(ctl.getState().pending[0].evaluation.finding).toBe("changedSince");
    }
    expect(mutationCalls(s)).toBe(1);
    const next = ctl.archiveUnit(v4.unitId);
    await tick();
    expect(last(s, "archive").req).toMatchObject({ expectedRevision: rev });
    last(s, "archive").d.resolve({ unit: at(v4, { status: "archived", archivedAtMillis: 9, revision: rev + 1 }), noop: false });
    await next;
  });

  test("a confirmed later change settles the uncertainty: no permanent false blocking", async () => {
    const { s, v4, ctl, registry } = await qualified();
    const next = ctl.archiveUnit(v4.unitId);
    await tick();
    const v5 = at(v4, { status: "archived", archivedAtMillis: 9, revision: 5 });
    last(s, "archive").d.resolve({ unit: v5, noop: false });
    await next;
    // Even different content at the confirmed revision no longer blocks for
    // the settled request; the unit's own finding entry still says what it saw.
    ctl.setShowArchived(true);
    last(s, "list").d.resolve({ units: [at(v5, { title: "Odd" })] });
    await tick();
    expect(registry.forScope(A, () => true).requiresFreshRead(v4.unitId)).toBe(false);
    void ctl.restoreUnit(v4.unitId);
    await tick();
    expect(s.c.restore).toHaveBeenCalledTimes(1);
  });

  test("a disposal, remount and scope change keep or drop the re-blocking with the scope", async () => {
    const registry = createPendingMutationRegistry();
    const { s, v4, ctl } = await qualified(registry);
    ctl.dispose();
    const remounted = await mount(s, [v4], { registry });
    await listWith(s, remounted, [at(v4, { title: "Conflicting" })]);
    expect(await remounted.archiveUnit(v4.unitId)).toEqual({ kind: "needsCheck" });
    remounted.dispose();
    ctx.current = B;
    const other = await mount(s, [at(v4, {})], { registry, session: B });
    expect(registry.forScope(B, () => true).requiresFreshRead(v4.unitId)).toBe(false);
    other.dispose();
    expect(mutationCalls(s)).toBe(1);
  });
});

describe("fourth remediation P2-2: only post-outcome absence qualifies", () => {
  test("a complete list sent while the request was in flight, omitting the unit: absent now, still blocked", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u], { registry });
    const first = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    ctl.setShowArchived(true); // complete list, dispatched before the outcome
    const early = last(s, "list");
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    early.d.resolve({ units: [] }); // arrives after the outcome
    await tick();
    expect(ctl.getUnitState(u.unitId).kind).toBe("absent");
    last(s, "get").d.reject(fb("unavailable"));
    await first;
    expect(ctl.getState().pending[0].evaluation.basis).toBe("notFound");
    expect(registry.forScope(A, () => true).requiresFreshRead(u.unitId)).toBe(true);
  });

  test("the same omission from a list sent after the outcome qualifies, and nothing is sent for the gone unit", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u], { registry });
    const first = ctl.updateUnit(u.unitId, { title: "Seeds" });
    await tick();
    last(s, "update").d.reject(fb("unavailable"));
    await tick();
    last(s, "get").d.reject(fb("unavailable"));
    await first;
    expect(registry.forScope(A, () => true).requiresFreshRead(u.unitId)).toBe(true);
    ctl.setShowArchived(true);
    last(s, "list").d.resolve({ units: [] });
    await tick();
    expect(registry.forScope(A, () => true).requiresFreshRead(u.unitId)).toBe(false);
    expect(await ctl.archiveUnit(u.unitId)).toMatchObject({ kind: "error", error: { category: "notFound" } });
    expect(mutationCalls(s)).toBe(1);
  });
});

describe("fifth remediation P2: a server no-op never settles earlier uncertainty", () => {
  // Archive at revision 3 becomes uncertain; the automatic read returns
  // active revision 3 (qualifying, same base).
  async function recoveredAtBase(registry = createPendingMutationRegistry()) {
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u], { registry });
    const first = ctl.archiveUnit(u.unitId);
    await tick();
    last(s, "archive").d.reject(fb("unavailable"));
    await tick();
    last(s, "get").d.resolve({ unit: u });
    await first;
    expect(ctl.getState().pending[0].evaluation.finding).toBe("notInEffectNow");
    return { s, u, ctl, registry };
  }
  const restoreNoop = async (s: S, ctl: TeacherUnitsController, u: TeacherUnit) => {
    const r = ctl.restoreUnit(u.unitId);
    await tick();
    expect(last(s, "restore").req).toMatchObject({ expectedRevision: u.revision });
    last(s, "restore").d.resolve({ unit: u, noop: true });
    expect(await r).toMatchObject({ kind: "saved", noop: true });
  };
  const conflictAt = async (s: S, ctl: TeacherUnitsController, u: TeacherUnit) => {
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [at(u, { title: "Conflicting" })] });
    await tick();
  };

  test("no-op at the same revision, then a conflict: blocked again, nothing sent", async () => {
    const { s, u, ctl } = await recoveredAtBase();
    await restoreNoop(s, ctl, u);
    await conflictAt(s, ctl, u);
    expect(ctl.getState().pending[0].evaluation).toMatchObject({ finding: "unknown", basis: "inconsistent" });
    expect(await ctl.updateUnit(u.unitId, { title: "New intent" })).toEqual({ kind: "needsCheck" });
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
    expect(s.c.update).not.toHaveBeenCalled();
    expect(s.c.archive).toHaveBeenCalledTimes(1);
  });

  test("repeated no-ops and a dismissed notice change nothing", async () => {
    const { s, u, ctl } = await recoveredAtBase();
    for (let k = 0; k < 3; k++) await restoreNoop(s, ctl, u);
    ctl.dismissPendingMutation(ctl.getState().pending[0].record.id);
    await conflictAt(s, ctl, u);
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
    expect(s.c.archive).toHaveBeenCalledTimes(1);
  });

  test("no-op, then a higher revision read: eligible, but still re-blocked by a later conflict", async () => {
    const { s, u, ctl } = await recoveredAtBase();
    await restoreNoop(s, ctl, u);
    const v5 = at(u, { title: "Elsewhere", revision: 5 });
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [v5] });
    await tick();
    expect(ctl.getState().pending[0].evaluation.finding).toBe("changedSince");
    expect(ctl.getState().pending.length).toBe(1);
    await conflictAt(s, ctl, v5);
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
  });

  test("a confirmed state-changing write after eligible recovery settles it: no false blocking later", async () => {
    const { s, u, ctl, registry } = await recoveredAtBase();
    const r = ctl.updateUnit(u.unitId, { title: "Renamed" });
    await tick();
    const v4 = at(u, { title: "Renamed", revision: 4 });
    last(s, "update").d.resolve({ unit: v4, noop: false });
    await r;
    await conflictAt(s, ctl, v4);
    expect(registry.forScope(A, () => true).requiresFreshRead(u.unitId)).toBe(false);
    void ctl.archiveUnit(u.unitId);
    await tick();
    expect(s.c.archive).toHaveBeenCalledTimes(2);
  });

  test("a no-op from a remounted or concurrent controller settles nothing either", async () => {
    const registry = createPendingMutationRegistry();
    const { s, u, ctl } = await recoveredAtBase(registry);
    ctl.dispose();
    const remounted = await mount(s, [u], { registry });
    const other = await mount(s, [u], { registry });
    await restoreNoop(s, remounted, u);
    await conflictAt(s, other, u);
    expect(await remounted.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
    expect(await other.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
    ctx.current = B;
    expect(registry.forScope(B, () => true).requiresFreshRead(u.unitId)).toBe(false);
  });
});

describe("fifth remediation P3: the capacity result names its bound", () => {
  test("retained records: reads and dismissals cannot free them; nothing is sent", async () => {
    const registry = createPendingMutationRegistry();
    const view = registry.forScope(A, () => true);
    for (let i = 0; i < UNCERTAINTY_MAX; i++) {
      view.accept(unit({ unitId: `Ret${i}`, revision: 3 }), view.stamp());
      const id = view.begin({ unitId: `Ret${i}`, expectedRevision: 3, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
      view.markUncertain(id, normalizeTeacherUnitError(fb("unavailable")));
      view.dismiss(id);
      view.accept(unit({ unitId: `Ret${i}`, revision: 4 }), view.stamp());
    }
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u], { registry });
    expect(ctl.getState().pending).toEqual([]);
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "capacity", reason: "retained" });
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [u] });
    await tick();
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "capacity", reason: "retained" });
    expect(mutationCalls(s)).toBe(0);
  });
});

describe("sixth remediation: an inconsistent write response never settles earlier uncertainty", () => {
  async function recoveredAtBase(registry = createPendingMutationRegistry()) {
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u], { registry });
    const first = ctl.archiveUnit(u.unitId);
    await tick();
    last(s, "archive").d.reject(fb("unavailable"));
    await tick();
    last(s, "get").d.resolve({ unit: u });
    await first;
    return { s, u, ctl, registry };
  }
  const conflict4 = async (s: S, ctl: TeacherUnitsController, u: TeacherUnit) => {
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [at(u, { title: "Conflicting 4", revision: 4 })] });
    await tick();
  };

  test.each([
    ["a separate newer read by this controller", false],
    ["a newer read by a concurrent controller", true],
  ])("non-advancing write plus %s: still protected, nothing sent", async (_l, concurrent) => {
    const registry = createPendingMutationRegistry();
    const { s, u, ctl } = await recoveredAtBase(registry);
    const other = concurrent ? await mount(s, [u], { registry }) : ctl;
    const update = ctl.updateUnit(u.unitId, { title: "Renamed" });
    await tick();
    const pendingUpdate = last(s, "update");
    void other.refresh();
    last(s, "list").d.resolve({ units: [at(u, { title: "Another writer", revision: 4 })] });
    await tick();
    pendingUpdate.d.resolve({ unit: at(u, { title: "Renamed", revision: 3 }), noop: false });
    await update;
    await conflict4(s, ctl, u);
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
    expect(s.c.archive).toHaveBeenCalledTimes(1);
  });

  test("a valid write followed by another read: settled, no false blocking", async () => {
    const { s, u, ctl, registry } = await recoveredAtBase();
    const update = ctl.updateUnit(u.unitId, { title: "Renamed" });
    await tick();
    last(s, "update").d.resolve({ unit: at(u, { title: "Renamed", revision: 4 }), noop: false });
    await update;
    await conflict4(s, ctl, u);
    expect(registry.forScope(A, () => true).requiresFreshRead(u.unitId)).toBe(false);
  });

  test("a client-side cached no-op sends nothing and settles nothing", async () => {
    const { s, u, ctl } = await recoveredAtBase();
    expect(await ctl.updateUnit(u.unitId, { title: u.title })).toMatchObject({ kind: "saved", noop: true });
    expect(s.c.update).not.toHaveBeenCalled();
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [at(u, { title: "Conflicting" })] });
    await tick();
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
  });
});

describe("seventh remediation P2: a non-advancing write response is uncertain, never saved", () => {
  describe.each(OPS)("$name", (op) => {
    test("3 -> 3: uncertain, pending kept, no automatic read, nothing resent, next change blocked", async () => {
      const { s, u, ctl } = await setup(op);
      const r = op.run(ctl, u);
      await tick();
      last(s, op.kind).d.resolve({ unit: at(u, op.holds(u)), noop: false }); // revision unchanged at 3
      expect(await r).toMatchObject({ kind: "uncertain", latest: null, error: { category: "unexpected" } });
      expect(ctl.getState().pending).toMatchObject([{ status: "uncertain", failure: { category: "unexpected" } }]);
      expect(ctl.getKnownUnit(u.unitId)?.revision).toBe(3);
      expect(s.c.get).not.toHaveBeenCalled();
      expect(await ctl.updateUnit(u.unitId, { title: "Next" })).toEqual({ kind: "needsCheck" });
      await tick();
      expect(mutationCalls(s)).toBe(1);
    });

    test("3 -> 4 and 3 -> 5 are valid saves (a later read may show a newer revision)", async () => {
      for (const revision of [4, 5]) {
        const { s, u, ctl } = await setup(op);
        const r = op.run(ctl, u);
        await tick();
        last(s, op.kind).d.resolve({ unit: at(u, { ...op.holds(u), revision }), noop: false });
        expect(await r).toMatchObject({ kind: "saved", noop: false });
        expect(ctl.getState().pending).toEqual([]);
        expect(ctl.getKnownUnit(u.unitId)?.revision).toBe(revision);
      }
    });
  });

  test("3 -> 5 is saved but does not settle an earlier uncertainty (conservative settlement rule)", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const ctl = await mount(s, [u], { registry });
    const first = ctl.archiveUnit(u.unitId);
    await tick();
    last(s, "archive").d.reject(fb("unavailable"));
    await tick();
    last(s, "get").d.resolve({ unit: u });
    await first;
    const r = ctl.updateUnit(u.unitId, { title: "Renamed" });
    await tick();
    last(s, "update").d.resolve({ unit: at(u, { title: "Renamed", revision: 5 }), noop: false });
    expect((await r).kind).toBe("saved");
    void ctl.refresh();
    last(s, "list").d.resolve({ units: [at(u, { title: "Conflicting", revision: 5 })] });
    await tick();
    expect(await ctl.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
  });

  test("after a remount, the replacement takes the single automatic read; concurrent controllers stay blocked", async () => {
    const registry = createPendingMutationRegistry();
    const s = scripted();
    const u = unit();
    const first = await mount(s, [u], { registry });
    const r = first.updateUnit(u.unitId, { title: "Renamed" });
    await tick();
    first.dispose();
    const second = await mount(s, [u], { registry });
    const other = await mount(s, [u], { registry });
    last(s, "update").d.resolve({ unit: u, noop: false });
    expect((await r).kind).toBe("stale");
    await tick();
    expect(second.getState().pending[0]).toMatchObject({ status: "uncertain" });
    expect(s.c.get).toHaveBeenCalledTimes(1);
    expect(await other.archiveUnit(u.unitId)).toEqual({ kind: "needsCheck" });
    for (let i = 0; i < 3; i++) {
      second.dispose();
      await mount(s, [u], { registry });
      await tick();
    }
    expect(s.c.get).toHaveBeenCalledTimes(1);
    expect(mutationCalls(s)).toBe(1);
  });
});
