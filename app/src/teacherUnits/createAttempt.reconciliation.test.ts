import type { Functions } from "firebase/functions";

// A3-4 S2 Phase 6: the create boundary is unchanged. An uncertain first
// dispatch keeps its durable idempotency record; reconciliation is a
// deliberate same-key, same-payload, same-school resend carrying a FRESH
// compatibility permit; a compatibility refusal during reconciliation sends
// nothing and never erases the original uncertainty.

const invocations: Array<{ name: string; payload: Record<string, unknown> }> = [];
const outcomes: Array<() => unknown> = [];
jest.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => async (payload: Record<string, unknown>) => {
    invocations.push({ name, payload });
    const next = outcomes.shift();
    if (next === undefined) throw new Error("unscripted");
    // An outcome may be a promise, so a response can be held open while
    // other calls complete (sixth remediation adapter tests below).
    const value = next();
    return { data: value instanceof Promise ? await value : value };
  },
}));

import { createTeacherUnitCreateAttemptStore } from "./createAttemptStore";
import { createUnitCreateCoordinator } from "./saveCoordination";
import { createFirebaseTeacherUnitsCallables } from "./wire";
import { createPendingMutationRegistry } from "./pendingMutations";
import { createTeacherUnitsController } from "./unitsController";

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const envelope = (generation: number) =>
  Object.freeze({
    schemaVersion: 2 as const,
    clientContractVersion: "teacher-units-v3" as const,
    policyInstanceId: "0f8fad5b-d9cb-469f-a165-70867728950e",
    policyGeneration: generation,
    backendReleaseId: "a".repeat(64),
    placementFingerprint: "b".repeat(64),
  });
const created = {
  unit: {
    unitId: "AbCdEfGhIjKlMnOpQrSt",
    grade: "7",
    title: "Rocks",
    description: "",
    status: "active",
    archivedAtMillis: null,
    createdAtMillis: 1,
    updatedAtMillis: 1,
    resourceIds: [],
    sortOrder: 0,
    revision: 1,
  },
  replayed: true,
};
const lost = () => {
  throw Object.assign(new Error("lost"), { code: "unavailable" });
};

beforeEach(() => {
  invocations.length = 0;
  outcomes.length = 0;
  localStorage.clear();
});

function setup(permits: Array<() => Promise<() => ReturnType<typeof envelope>>>) {
  const verify = jest.fn(() => {
    const next = permits.shift();
    if (next === undefined) return Promise.reject(new Error("no permit"));
    return next();
  });
  const callables = createFirebaseTeacherUnitsCallables({} as Functions, verify);
  const store = createTeacherUnitCreateAttemptStore(SCOPE, () => localStorage);
  const coordinator = createUnitCreateCoordinator({
    create: callables.create,
    readSessionContext: () => SCOPE,
    persistence: store,
    mint: () => "KeyKeyKey0001",
  });
  return { verify, coordinator, store };
}
const permit = (generation: number) => async () => () => envelope(generation);
const refused = async (): Promise<() => ReturnType<typeof envelope>> => {
  throw new Error("discovery refused");
};

describe("create reconciliation identity and permits", () => {
  test("an uncertain first dispatch keeps its durable key; reconcile resends the same key, payload and school with a fresh permit", async () => {
    const { verify, coordinator, store } = setup([permit(3), permit(4)]);
    outcomes.push(lost);
    await coordinator.submit({ grade: "7", title: "Rocks", description: "" });
    expect(coordinator.state()).toMatchObject({ kind: "unresolved", reason: "uncertain", key: "KeyKeyKey0001" });
    const saved = store.list();
    expect(saved.kind === "ok" && saved.records.map((r) => r.key)).toEqual(["KeyKeyKey0001"]);
    // Nothing is resent on its own.
    await new Promise((r) => setTimeout(r, 0));
    expect(invocations).toHaveLength(1);

    outcomes.push(() => created);
    await coordinator.reconcile();
    expect(coordinator.state()).toMatchObject({ kind: "created", replayed: true });
    expect(verify).toHaveBeenCalledTimes(2);
    expect(invocations).toHaveLength(2);
    const [first, second] = invocations.map((i) => i.payload);
    for (const p of [first, second]) {
      expect(p).toMatchObject({ grade: "7", title: "Rocks", description: "", idempotencyKey: "KeyKeyKey0001", expectedSchoolId: "schoolA" });
    }
    // Each dispatch carries its own attempt's permit, never a reused one.
    expect((first.compatibility as { policyGeneration: number }).policyGeneration).toBe(3);
    expect((second.compatibility as { policyGeneration: number }).policyGeneration).toBe(4);
  });

  test("a compatibility refusal during reconciliation sends nothing and keeps the original uncertainty", async () => {
    const { coordinator, store } = setup([permit(3), refused, permit(5)]);
    outcomes.push(lost);
    await coordinator.submit({ grade: "7", title: "Rocks", description: "" });
    await coordinator.reconcile();
    expect(invocations).toHaveLength(1);
    expect(coordinator.state()).toMatchObject({ kind: "unresolved", reason: "uncertain", key: "KeyKeyKey0001" });
    const saved = store.list();
    expect(saved.kind === "ok" && saved.records.map((r) => [r.key, r.status])).toEqual([["KeyKeyKey0001", "unresolved"]]);
    // A later deliberate reconcile with a fresh valid permit still uses K.
    outcomes.push(() => created);
    await coordinator.reconcile();
    expect(invocations).toHaveLength(2);
    expect(invocations[1].payload).toMatchObject({ idempotencyKey: "KeyKeyKey0001", expectedSchoolId: "schoolA" });
    expect(coordinator.state().kind).toBe("created");
  });

  test("a compatibility refusal on the FIRST dispatch is a confirmed non-send (the key is discarded)", async () => {
    const { coordinator, store } = setup([refused]);
    await coordinator.submit({ grade: "7", title: "Rocks", description: "" });
    expect(invocations).toHaveLength(0);
    expect(coordinator.state().kind).toBe("rejected");
    const saved = store.list();
    expect(saved.kind === "ok" && saved.records).toEqual([]);
  });
});


// Sixth remediation: settlement proof through the REAL response adapter
// (wire.ts parsing and validation), for non-create writes.
describe("self-contained settlement proof through the real response adapter", () => {
  const base = {
    unitId: "AbCdEfGhIjKlMnOpQrSt",
    grade: "7",
    title: "Plants",
    description: "",
    status: "active",
    archivedAtMillis: null,
    createdAtMillis: 1,
    updatedAtMillis: 1,
    resourceIds: [] as string[],
    sortOrder: 0,
    revision: 3,
  };
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const lostErr = () => {
    throw Object.assign(new Error("lost"), { code: "unavailable" });
  };
  function held<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
  }
  // An archive based on revision 3 became uncertain and was recovered at 3.
  async function recovered() {
    const registry = createPendingMutationRegistry();
    const view = registry.forScope(SCOPE, () => true);
    const callables = createFirebaseTeacherUnitsCallables({} as Functions, async () => () => envelope(3));
    outcomes.push(() => ({ units: [base] }));
    const ctl = createTeacherUnitsController({
      callables,
      session: SCOPE,
      readCurrentContext: () => SCOPE,
      store: createTeacherUnitCreateAttemptStore(SCOPE, () => localStorage),
      initialGrade: "7",
      pendingRegistry: registry,
    });
    await tick();
    outcomes.push(lostErr, () => ({ unit: base }));
    await ctl.archiveUnit(base.unitId);
    expect(view.requiresFreshRead(base.unitId)).toBe(false);
    return { ctl, view };
  }
  const writes = () => invocations.filter((i) => i.name !== "teacherUnitsList" && i.name !== "teacherUnitsGet").length;

  test.each([
    ["a 'write' whose revision did not advance (3)", 3],
    ["a 'write' that skipped a revision (5)", 5],
  ])("%s, with a separate newer read already accepted, settles nothing; a later conflict blocks", async (_l, revision) => {
    const { ctl, view } = await recovered();
    const response = held<unknown>();
    outcomes.push(() => response.promise);
    const update = ctl.updateUnit(base.unitId, { title: "Renamed" });
    await tick();
    outcomes.push(() => ({ units: [{ ...base, title: "Another writer", revision: 4 }] }));
    await ctl.refresh();
    response.resolve({ unit: { ...base, title: "Renamed", revision }, noop: false });
    await update;
    // The response itself is present-state evidence (revision 4 or 5 is
    // the newest accepted); conflicting content at that newest revision must
    // block, because the response settled nothing.
    const newest = view.latest(base.unitId)?.unit?.revision ?? 0;
    view.accept({ ...base, title: "Conflicting", revision: newest } as never, view.stamp());
    expect(view.requiresFreshRead(base.unitId)).toBe(true);
    expect(await ctl.archiveUnit(base.unitId)).toEqual({ kind: "needsCheck" });
    expect(writes()).toBe(2);
  });

  test("a valid write (base 3, committed 4) settles; a later read conflict does not re-block it", async () => {
    const { ctl, view } = await recovered();
    outcomes.push(() => ({ unit: { ...base, title: "Renamed", revision: 4 }, noop: false }));
    expect((await ctl.updateUnit(base.unitId, { title: "Renamed" })).kind).toBe("saved");
    view.accept({ ...base, title: "Conflicting 4", revision: 4 } as never, view.stamp());
    expect(view.requiresFreshRead(base.unitId)).toBe(false);
  });

  test("a response with no revision is rejected by the adapter: uncertain, never settlement", async () => {
    const { ctl, view } = await recovered();
    const { revision: _omit, ...noRevision } = base;
    void _omit;
    outcomes.push(() => ({ unit: noRevision, noop: false }), lostErr);
    const r = await ctl.updateUnit(base.unitId, { title: "Renamed" });
    expect(r.kind).toBe("uncertain");
    expect(view.requiresFreshRead(base.unitId)).toBe(true);
    expect(writes()).toBe(2);
  });

  test("seventh remediation: a non-advancing write through the adapter is uncertain, not saved, with no read or resend", async () => {
    const { ctl, view } = await recovered();
    outcomes.push(() => ({ unit: { ...base, title: "Renamed" }, noop: false })); // still revision 3
    const r = await ctl.updateUnit(base.unitId, { title: "Renamed" });
    expect(r).toMatchObject({ kind: "uncertain", latest: null });
    expect(ctl.getKnownUnit(base.unitId)?.title).toBe("Plants");
    expect(view.requiresFreshRead(base.unitId)).toBe(true);
    expect(await ctl.archiveUnit(base.unitId)).toEqual({ kind: "needsCheck" });
    expect(invocations.filter((i) => i.name === "teacherUnitsGet")).toHaveLength(1); // only the earlier recovery read
    expect(writes()).toBe(2);
  });
});
