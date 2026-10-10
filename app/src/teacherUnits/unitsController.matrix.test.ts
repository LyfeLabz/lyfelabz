/**
 * U2.3 fourth certification: exhaustive interleaving matrix.
 *
 * Each scenario has three operations. Every operation is three events:
 * the client DISPATCHES it, the server EXECUTES it atomically (reading or
 * writing its state), and the client RECEIVES the response; an external
 * change (another session) is a server execution only. Every interleaving
 * that respects dispatch < execute < receive is run against the real
 * controller with a model server.
 *
 * The oracle is independent of the controller's clock. Evidence e1 is
 * DEFINITELY newer than e2 only when e1 was dispatched after e2 was
 * received. Over the evidence the controller accepted (superseded list
 * requests are ignored by design), with M = the evidence nothing is
 * definitely newer than:
 * - when every member of M agrees on visibility, the list must agree;
 * - when a confirmed write in M disagrees with a read that overlapped it,
 *   the write's visibility must win (the read may predate the commit);
 * - the held record's revision is the highest accepted revision;
 * - a list dispatched after everything shows the server's truth.
 */
import { createTeacherUnitsController, type TeacherUnitsController } from "./unitsController";
import { createTeacherUnitCreateAttemptStore } from "./createAttemptStore";
import { getPlaceableResources } from "./placeableResources";
import type { TeacherUnit, TeacherUnitsCallables } from "./types";

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const [R1] = getPlaceableResources()
  .filter((r) => r.grade === "7")
  .map((r) => r.id);
// Drains the controller's promise continuations without timers.
const settle = async () => {
  for (let i = 0; i < 25; i++) await Promise.resolve();
};

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as unknown as Storage;
}

const base = (unitId: string, over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId,
  grade: "7",
  title: unitId,
  description: "",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: 1,
  updatedAtMillis: 1,
  resourceIds: [],
  sortOrder: 0,
  revision: 1,
  ...over,
});

type Pending = { name: string; resolve: (v: unknown) => void; reject: (e: unknown) => void };

// ---------- Model server and harness ----------

type Server = Map<string, TeacherUnit>;
const bump = (s: Server, id: string, patch: Partial<TeacherUnit>): TeacherUnit => {
  const u = s.get(id) as TeacherUnit;
  const next = { ...u, ...patch, revision: u.revision + 1 };
  s.set(id, next);
  return next;
};
const activeOf = (s: Server) => Array.from(s.values()).filter((u) => u.status === "active");

type Evidence = {
  readonly op: number;
  readonly write: boolean;
  readonly record: TeacherUnit | null; // the unit as returned (null: omitted)
  readonly listOp: boolean;
};

type Op =
  | { readonly kind: "external"; readonly exec: (s: Server) => void }
  | {
      readonly kind: "client";
      readonly write: boolean;
      readonly list: boolean;
      readonly dispatch: (ctl: TeacherUnitsController) => void;
      readonly exec: (s: Server) => { value: unknown; record: TeacherUnit | null };
    };

const refresh = (target: string): Op => ({
  kind: "client",
  write: false,
  list: true,
  dispatch: (ctl) => void ctl.refresh(),
  exec: (s) => {
    const units = activeOf(s);
    return { value: { units }, record: units.find((u) => u.unitId === target) ?? null };
  },
});
const write = (
  target: string,
  dispatch: (ctl: TeacherUnitsController) => void,
  patch: Partial<TeacherUnit>,
): Op => ({
  kind: "client",
  write: true,
  list: false,
  dispatch,
  exec: (s) => {
    const unit = bump(s, target, patch);
    return { value: { unit, noop: false }, record: unit };
  },
});

type Scenario = {
  readonly name: string;
  readonly target: string;
  readonly server: () => Server;
  // Brings the controller to the scenario's starting knowledge.
  readonly setup: (h: Harness) => Promise<void>;
  readonly ops: ReadonlyArray<Op>;
};

type Harness = {
  readonly ctl: TeacherUnitsController;
  readonly pending: Pending[];
  readonly server: Server;
};

function harness(server: Server): Harness {
  const pending: Pending[] = [];
  const call = (name: string) => () =>
    new Promise((resolve, reject) => {
      pending.push({ name, resolve, reject });
    });
  const c = {
    create: jest.fn(call("create")),
    list: jest.fn(call("list")),
    get: jest.fn(call("get")),
    update: jest.fn(call("update")),
    archive: jest.fn(call("archive")),
    restore: jest.fn(call("restore")),
    setResources: jest.fn(call("setResources")),
    reorder: jest.fn(),
  };
  const ctl = createTeacherUnitsController({
    callables: c as unknown as TeacherUnitsCallables,
    session: SCOPE,
    readCurrentContext: () => SCOPE,
    store: createTeacherUnitCreateAttemptStore(SCOPE, ((st) => () => st)(memoryStorage())),
    initialGrade: "7",
  });
  return { ctl, pending, server };
}

// Resolve the next pending call (in order) with the server's answer now.
async function answerNext(h: Harness, answer: (s: Server) => unknown) {
  const p = h.pending.shift() as Pending;
  p.resolve(answer(h.server));
  await settle();
}

const listed = (ctl: TeacherUnitsController, id: string) => {
  const s = ctl.getState();
  return s.list.kind === "ready" ? s.list.units.find((u) => u.unitId === id) ?? null : null;
};

// Every sequence of event indices respecting D < X < R per operation.
function interleavings(ops: ReadonlyArray<Op>): Array<Array<{ op: number; ev: "D" | "X" | "R" }>> {
  const out: Array<Array<{ op: number; ev: "D" | "X" | "R" }>> = [];
  const events = ops.map((o) => (o.kind === "external" ? (["X"] as const) : (["D", "X", "R"] as const)));
  const next = ops.map(() => 0);
  const seq: Array<{ op: number; ev: "D" | "X" | "R" }> = [];
  const total = events.reduce((n, e) => n + e.length, 0);
  const walk = () => {
    if (seq.length === total) {
      out.push(seq.slice());
      return;
    }
    for (let i = 0; i < ops.length; i++) {
      if (next[i] >= events[i].length) continue;
      seq.push({ op: i, ev: events[i][next[i]] });
      next[i]++;
      walk();
      next[i]--;
      seq.pop();
    }
  };
  walk();
  return out;
}

const visibleIn = (u: TeacherUnit | null) => u !== null && u.status === "active" && u.grade === "7";

async function runOne(sc: Scenario, order: Array<{ op: number; ev: "D" | "X" | "R" }>) {
  const h = harness(sc.server());
  await sc.setup(h);
  const dispatchedAt = new Map<number, number>();
  const receivedAt = new Map<number, number>();
  const mine = new Map<number, Pending>();
  const answers = new Map<number, { value: unknown; record: TeacherUnit | null }>();
  let step = 0;
  for (const { op, ev } of order) {
    step++;
    const o = sc.ops[op];
    if (o.kind === "external") {
      o.exec(h.server);
      continue;
    }
    if (ev === "D") {
      const before = h.pending.length;
      o.dispatch(h.ctl);
      await settle();
      expect(h.pending.length).toBe(before + 1);
      mine.set(op, h.pending.pop() as Pending);
      dispatchedAt.set(op, step);
    } else if (ev === "X") {
      answers.set(op, o.exec(h.server));
    } else {
      (mine.get(op) as Pending).resolve((answers.get(op) as { value: unknown }).value);
      await settle();
      receivedAt.set(op, step);
    }
  }
  // Accepted evidence: a list response is ignored when a later list was
  // dispatched before it arrived (list request sequencing).
  const clientOps = sc.ops.map((o, i) => ({ o, i })).filter((x) => x.o.kind === "client");
  const evidence: Evidence[] = [];
  for (const { o, i } of clientOps) {
    if (o.kind !== "client") continue;
    if (o.list) {
      const superseded = clientOps.some(
        (x) => x.o.kind === "client" && x.o.list && x.i !== i &&
          (dispatchedAt.get(x.i) as number) > (dispatchedAt.get(i) as number) &&
          (dispatchedAt.get(x.i) as number) < (receivedAt.get(i) as number),
      );
      if (superseded) continue;
    }
    evidence.push({ op: i, write: o.write, record: (answers.get(i) as { record: TeacherUnit | null }).record, listOp: o.list });
  }
  const newer = (a: Evidence, b: Evidence) => (dispatchedAt.get(a.op) as number) > (receivedAt.get(b.op) as number);
  const maximal = evidence.filter((e) => !evidence.some((f) => f !== e && newer(f, e)));
  const shown = listed(h.ctl, sc.target) !== null;
  const label = `${sc.name} :: ${order.map((e) => `${e.ev}${e.op}`).join(" ")}`;
  const votes = new Set(maximal.map((e) => visibleIn(e.record)));
  if (votes.size === 1) {
    expect([label, shown]).toEqual([label, Array.from(votes)[0]]);
  } else {
    const w = maximal.find((e) => e.write);
    if (w !== undefined) expect([label, shown]).toEqual([label, visibleIn(w.record)]);
  }
  // Content never moves backwards.
  const revs = evidence.map((e) => e.record?.revision ?? 0);
  const held = h.ctl.getKnownUnit(sc.target);
  if (revs.some((r) => r > 0)) expect([label, held?.revision]).toEqual([label, Math.max(...revs, held?.revision ?? 0)]);
  // Convergence: a list dispatched after everything shows the truth.
  void h.ctl.refresh();
  await answerNext(h, (s) => ({ units: activeOf(s) }));
  const truth = activeOf(h.server).map((u) => u.unitId).sort();
  const s = h.ctl.getState();
  expect([label, s.list.kind === "ready" ? s.list.units.map((u) => u.unitId).sort() : null]).toEqual([label, truth]);
}

// ---------- Scenarios ----------

const A = "UnitAAAAAAAAAAAAAAAA";
const B = "UnitBBBBBBBBBBBBBBBB";

const initialList = async (h: Harness) => answerNext(h, (s) => ({ units: activeOf(s) }));
// Learn an archived unit through the archived view, then return to active.
const learnArchived = async (h: Harness) => {
  await initialList(h);
  h.ctl.setShowArchived(true);
  await settle();
  await answerNext(h, (s) => ({ units: Array.from(s.values()) }));
  h.ctl.setShowArchived(false);
  await settle();
  await answerNext(h, (s) => ({ units: activeOf(s) }));
};
// Leave the form's own create unresolved (lost response) for a replay.
const lostCreate = async (h: Harness) => {
  await initialList(h);
  void h.ctl.submitCreate({ grade: "7", title: B, description: "" });
  await settle();
  (h.pending.shift() as Pending).reject(Object.assign(new Error("lost"), { code: "unavailable" }));
  await settle();
};
const replayOf = (key: () => string): Op => ({
  kind: "client",
  write: false,
  list: false,
  dispatch: (ctl) => void ctl.reconcileCreate(key()),
  exec: (s) => {
    const unit = s.get(B) as TeacherUnit;
    return { value: { unit, replayed: true }, record: unit };
  },
});

let replayKey = "";
const scenarios: Scenario[] = [
  {
    name: "restore vs two lists",
    target: A,
    server: () => new Map([[A, base(A, { status: "archived", archivedAtMillis: 5, revision: 2 })]]),
    setup: learnArchived,
    ops: [write(A, (ctl) => void ctl.restoreUnit(A), { status: "active", archivedAtMillis: null }), refresh(A), refresh(A)],
  },
  {
    name: "archive vs two lists",
    target: A,
    server: () => new Map([[A, base(A)]]),
    setup: initialList,
    ops: [write(A, (ctl) => void ctl.archiveUnit(A), { status: "archived", archivedAtMillis: 5 }), refresh(A), refresh(A)],
  },
  {
    name: "membership write vs list vs external archive",
    target: A,
    server: () => new Map([[A, base(A)]]),
    setup: initialList,
    ops: [
      write(A, (ctl) => void ctl.addResources(A, [R1]), { resourceIds: [R1] }),
      refresh(A),
      { kind: "external", exec: (s) => void bump(s, A, { status: "archived", archivedAtMillis: 9 }) },
    ],
  },
  {
    name: "restore vs list vs external re-archive",
    target: A,
    server: () => new Map([[A, base(A, { status: "archived", archivedAtMillis: 5, revision: 2 })]]),
    setup: learnArchived,
    ops: [
      write(A, (ctl) => void ctl.restoreUnit(A), { status: "active", archivedAtMillis: null }),
      refresh(A),
      { kind: "external", exec: (s) => void bump(s, A, { status: "archived", archivedAtMillis: 9 }) },
    ],
  },
  {
    name: "create replay vs list vs external archive",
    target: B,
    server: () => new Map([[B, base(B)]]),
    setup: async (h) => {
      await lostCreate(h);
      const own = h.ctl.getState().recoveries.find((e) => e.own);
      replayKey = own?.key ?? "";
    },
    ops: [
      replayOf(() => replayKey),
      refresh(B),
      { kind: "external", exec: (s) => void bump(s, B, { status: "archived", archivedAtMillis: 9 }) },
    ],
  },
  {
    name: "create replay vs two lists",
    target: B,
    server: () => new Map([[B, base(B)]]),
    setup: async (h) => {
      await lostCreate(h);
      replayKey = h.ctl.getState().recoveries.find((e) => e.own)?.key ?? "";
    },
    ops: [replayOf(() => replayKey), refresh(B), refresh(B)],
  },
  {
    name: "first create vs two lists",
    target: B,
    server: () => new Map(),
    setup: initialList,
    ops: [
      {
        kind: "client",
        write: true,
        list: false,
        dispatch: (ctl) => void ctl.submitCreate({ grade: "7", title: B, description: "" }),
        exec: (s) => {
          const unit = base(B);
          s.set(B, unit);
          return { value: { unit, replayed: false }, record: unit };
        },
      },
      refresh(B),
      refresh(B),
    ],
  },
];

describe("adversarial interleaving matrix", () => {
  test.each(scenarios.map((s) => [s.name, s] as const))("%s: every interleaving", async (_n, sc) => {
    const orders = interleavings(sc.ops);
    expect(orders.length).toBeGreaterThan(10);
    for (const order of orders) await runOne(sc, order);
  });
});
