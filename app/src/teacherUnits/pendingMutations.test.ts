import { normalizeTeacherUnitError } from "./errors";
import {
  createPendingMutationRegistry,
  GUARDS_MAX,
  PENDING_MAX,
  RESOLUTIONS_MAX,
  UNCERTAINTY_MAX,
  UNIT_EVIDENCE_MAX,
} from "./pendingMutations";
import type { TeacherUnit } from "./types";

// A3-4 S2 Phase 4: the memory-only owner of pending records.

const A = { teacherId: "teacherA", schoolId: "schoolA" };
const B = { teacherId: "teacherB", schoolId: "schoolA" };
const A2 = { teacherId: "teacherA", schoolId: "schoolB" };
const LOST = normalizeTeacherUnitError({ code: "unavailable" });
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: "U1",
  grade: "7",
  title: "Plants",
  description: "",
  color: null,
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: 1,
  updatedAtMillis: 1,
  resourceIds: [],
  sortOrder: 0,
  revision: 2,
  ...over,
});
const begin = (p: ReturnType<ReturnType<typeof createPendingMutationRegistry>["forScope"]>) =>
  p.begin({ unitId: "U1", expectedRevision: 2, intent: { op: "update", title: "Seeds" }, titleAtRequest: "Plants" }) as string;

describe("pending mutation registry", () => {
  test("records survive a new binding of the same scope (remount) and stay in memory only", () => {
    const setItem = jest.spyOn(Storage.prototype, "setItem");
    const reg = createPendingMutationRegistry({ now: () => 42 });
    const first = reg.forScope(A, () => true);
    const id = begin(first);
    first.markUncertain(id, LOST);
    const second = reg.forScope(A, () => true);
    expect(second.list()).toHaveLength(1);
    expect(second.list()[0]).toMatchObject({ status: "uncertain", record: { requestedAtMillis: 42, scope: A } });
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  test.each([
    ["another teacher", B],
    ["the same teacher at another school", A2],
  ])("binding %s clears the previous scope and makes its views inert", (_label, other) => {
    const reg = createPendingMutationRegistry();
    const a = reg.forScope(A, () => true);
    const id = begin(a);
    const b = reg.forScope(other, () => true);
    expect(b.list()).toEqual([]);
    // A late callback of the earlier scope writes nowhere.
    a.markUncertain(id, LOST);
    expect(a.begin({ unitId: "U9", expectedRevision: 1, intent: { op: "archive" }, titleAtRequest: "x" })).toBeNull();
    expect(a.list()).toEqual([]);
    expect(b.list()).toEqual([]);
    // Returning to A starts empty: A's text never reappears for B or A.
    expect(reg.forScope(A, () => true).list()).toEqual([]);
  });

  test("writes are refused once the writer's canonical context is no longer current", () => {
    const reg = createPendingMutationRegistry();
    let current = true;
    const a = reg.forScope(A, () => current);
    const id = begin(a);
    current = false;
    a.markUncertain(id, LOST);
    a.settle(id);
    expect(a.list()[0].status).toBe("inFlight");
  });

  test("observations apply only to reads dispatched after the outcome became uncertain", () => {
    const reg = createPendingMutationRegistry();
    const a = reg.forScope(A, () => true);
    const id = begin(a);
    const early = a.stamp(); // a read dispatched while the request was in flight
    a.markUncertain(id, LOST);
    a.observe("U1", { kind: "unit", unit: unit({ revision: 2 }) }, early);
    expect(a.list()[0].evaluation.basis).toBe("notChecked");
    const later = a.stamp();
    a.observe("U1", { kind: "unit", unit: unit({ title: "Seeds", revision: 3 }) }, later);
    expect(a.list()[0].evaluation.finding).toBe("consistentWithRequest");
    // An older read landing late never replaces a newer finding.
    const between = later - 0.5;
    a.observe("U1", { kind: "unit", unit: unit({ revision: 2 }) }, between);
    expect(a.list()[0].evaluation.finding).toBe("consistentWithRequest");
  });

  test("a failed read never erases a finding an earlier read produced", () => {
    const reg = createPendingMutationRegistry();
    const a = reg.forScope(A, () => true);
    const id = begin(a);
    a.markUncertain(id, LOST);
    a.observe("U1", { kind: "unit", unit: unit({ revision: 5, title: "Other" }) }, a.stamp());
    a.observe("U1", { kind: "unavailable" }, a.stamp());
    expect(a.list()[0].evaluation.finding).toBe("changedSince");
  });

  test("the automatic read is claimed once; in-flight entries cannot be dismissed", () => {
    const reg = createPendingMutationRegistry();
    const a = reg.forScope(A, () => true);
    const id = begin(a);
    expect(a.claimAutomaticRead(id)).toBe(false);
    expect(a.dismiss(id)).toBe(false);
    expect(a.hasInFlight("U1")).toBe(true);
    a.markUncertain(id, LOST);
    expect(a.hasInFlight("U1")).toBe(false);
    expect(a.claimAutomaticRead(id)).toBe(true);
    expect(a.claimAutomaticRead(reg.forScope(A, () => true).list()[0].record.id)).toBe(false);
    expect(a.dismiss(id)).toBe(true);
    expect(a.list()).toEqual([]);
  });

  test("a notFound refusal is recorded as present evidence; settle removes the entry", () => {
    const reg = createPendingMutationRegistry();
    const a = reg.forScope(A, () => true);
    const id = begin(a);
    a.markUncertain(id, normalizeTeacherUnitError({ details: { code: "teacherUnits.notFound" } }));
    expect(a.list()[0].evaluation).toMatchObject({ finding: "unknown", basis: "notFound" });
    const other = begin(a);
    a.settle(other);
    expect(a.list().map((e) => e.record.id)).toEqual([id]);
  });
});

describe("certification remediation: shared, revision-monotonic evidence", () => {
  const setup = () => {
    const reg = createPendingMutationRegistry();
    const a = reg.forScope(A, () => true);
    const id = begin(a);
    a.markUncertain(id, LOST);
    return { reg, a, id };
  };

  test("P2-3: a lower revision never replaces a higher one, whatever its stamp", () => {
    const { a } = setup();
    a.accept(unit({ title: "Seeds", revision: 5 }), a.stamp());
    a.accept(unit({ revision: 3 }), a.stamp());
    expect(a.latest("U1")?.unit?.revision).toBe(5);
    expect(a.list()[0].evaluation).toMatchObject({ finding: "consistentWithRequest", observedRevision: 5 });
  });

  test("an equal revision with the same content only raises the stamp of the newest observation", () => {
    const { a } = setup();
    const before = a.stamp();
    a.accept(unit({ revision: 2 }), 0); // observed before the outcome: says nothing yet
    expect(a.list()[0].evaluation.basis).toBe("notChecked");
    const later = a.stamp();
    // The same content at the same revision (conflicting content at one
    // revision is covered under "second recertification" below).
    a.accept(unit({ revision: 2 }), later);
    expect(a.latest("U1")).toMatchObject({ unitId: "U1", unit: unit({ revision: 2 }), at: later, conflict: false, absentAt: -1 });
    expect(a.list()[0].evaluation).toMatchObject({ finding: "notInEffectNow", basis: "sameRevision" });
    expect(before).toBeLessThan(later);
  });

  test("P2-2: a later confirmed write re-evaluates the finding", () => {
    const { a } = setup();
    a.accept(unit({ title: "Seeds", revision: 3 }), a.stamp());
    expect(a.list()[0].evaluation.finding).toBe("consistentWithRequest");
    a.accept(unit({ title: "Trees", revision: 4 }), a.stamp());
    expect(a.list()[0].evaluation).toMatchObject({ finding: "changedSince", observedRevision: 4 });
  });

  test("not found after the record, then found again by a later read", () => {
    const { a } = setup();
    a.accept(unit({ revision: 3, title: "Seeds" }), a.stamp());
    a.observe("U1", { kind: "notFound" }, a.stamp());
    expect(a.list()[0].evaluation.basis).toBe("notFound");
    a.observe("U1", { kind: "unit", unit: unit({ revision: 3, title: "Seeds" }) }, a.stamp());
    expect(a.list()[0].evaluation.finding).toBe("consistentWithRequest");
  });

  test("P2-1 guard: lifted only by accepted evidence, never by a failed read or a dismissal", () => {
    const { a, id } = setup();
    expect(a.requiresFreshRead("U1")).toBe(true);
    a.observe("U1", { kind: "unavailable" }, a.stamp());
    expect(a.dismiss(id)).toBe(true);
    expect(a.requiresFreshRead("U1")).toBe(true);
    a.accept(unit({ revision: 2 }), 1); // stale: before the outcome, base revision
    expect(a.requiresFreshRead("U1")).toBe(true);
    a.accept(unit({ revision: 2 }), a.stamp());
    expect(a.requiresFreshRead("U1")).toBe(false);
    expect(a.requiresFreshRead("other")).toBe(false);
  });

  test("late resolutions are kept for announcement; scope changes clear evidence too", () => {
    const reg = createPendingMutationRegistry();
    const a = reg.forScope(A, () => true);
    const id = begin(a);
    a.accept(unit(), a.stamp());
    a.settle(id, "saved");
    expect(a.list()).toEqual([]);
    expect(a.resolutions()).toMatchObject([{ seq: 1, outcome: "saved", record: { unitId: "U1" } }]);
    const b = reg.forScope(B, () => true);
    expect(b.units()).toEqual([]);
    expect(b.resolutions()).toEqual([]);
    expect(a.units()).toEqual([]);
    a.accept(unit({ revision: 9 }), a.stamp());
    expect(b.latest("U1")).toBeNull();
  });
});

describe("second recertification: conflicts and bounds", () => {
  test("F2: equal revision with different content never advances freshness or lifts the guard", () => {
    const reg = createPendingMutationRegistry();
    const a = reg.forScope(A, () => true);
    a.accept(unit({ revision: 2 }), a.stamp());
    const id = begin(a);
    a.markUncertain(id, LOST);
    const before = a.latest("U1")!;
    for (let i = 0; i < 3; i++) a.observe("U1", { kind: "unit", unit: unit({ revision: 2, title: `Other ${i}` }) }, a.stamp());
    expect(a.latest("U1")).toMatchObject({ unit: before.unit, at: before.at, conflict: true });
    expect(a.requiresFreshRead("U1")).toBe(true);
    expect(a.list()[0].evaluation).toMatchObject({ finding: "unknown", basis: "inconsistent" });
    a.accept(unit({ revision: 1, title: "older" }), a.stamp());
    expect(a.latest("U1")?.conflict).toBe(true);
    a.accept(unit({ revision: 3, title: "Seeds" }), a.stamp());
    expect(a.latest("U1")).toMatchObject({ conflict: false, unit: { revision: 3 } });
    expect(a.requiresFreshRead("U1")).toBe(false);
    expect(a.list()[0].evaluation.finding).toBe("consistentWithRequest");
  });

  test("F6: at PENDING_MAX new entries are refused and nothing is evicted", () => {
    const a = createPendingMutationRegistry().forScope(A, () => true);
    const ids: string[] = [];
    for (let i = 0; i < PENDING_MAX + 50; i++) {
      const id = a.begin({ unitId: `U${i}`, expectedRevision: 1, intent: { op: "archive" }, titleAtRequest: "x" });
      if (id !== null) {
        ids.push(id);
        a.markUncertain(id, LOST);
      }
    }
    expect(ids).toHaveLength(PENDING_MAX);
    expect(a.list().map((e) => e.record.id)).toEqual(ids);
    expect(a.atCapacity("new")).toBe(true);
    expect(a.dismiss(ids[0])).toBe(true);
    expect(a.atCapacity("new")).toBe(false);
  });

  test("F6: at GUARDS_MAX unconfirmed units new requests are refused; guards survive dismissal and lift only on evidence", () => {
    const a = createPendingMutationRegistry().forScope(A, () => true);
    let refused = 0;
    for (let i = 0; i < GUARDS_MAX + 30; i++) {
      const id = a.begin({ unitId: `G${i}`, expectedRevision: 1, intent: { op: "archive" }, titleAtRequest: "x" });
      if (id === null) {
        refused++;
        continue;
      }
      a.markUncertain(id, LOST);
      a.dismiss(id);
    }
    expect(refused).toBe(30);
    expect(a.list()).toEqual([]);
    expect(a.requiresFreshRead("G0")).toBe(true);
    expect(a.requiresFreshRead(`G${GUARDS_MAX - 1}`)).toBe(true);
    expect(a.atCapacity("new")).toBe(true);
    a.accept(unit({ unitId: "G0", revision: 1 }), a.stamp());
    expect(a.requiresFreshRead("G0")).toBe(false);
    expect(a.atCapacity("new")).toBe(false);
  });

  test("F6: unit evidence stays within UNIT_EVIDENCE_MAX and never drops evidence an entry or guard needs", () => {
    const a = createPendingMutationRegistry().forScope(A, () => true);
    a.accept(unit({ unitId: "Needed", revision: 1 }), a.stamp());
    const id = a.begin({ unitId: "Needed", expectedRevision: 1, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
    a.markUncertain(id, LOST);
    for (let i = 0; i < UNIT_EVIDENCE_MAX + 100; i++) a.accept(unit({ unitId: `E${i}`, revision: 1 }), a.stamp());
    expect(a.units()).toHaveLength(UNIT_EVIDENCE_MAX);
    expect(a.latest("Needed")).not.toBeNull();
    expect(a.latest("E0")).toBeNull(); // oldest unreferenced evidence went first
    expect(a.latest(`E${UNIT_EVIDENCE_MAX + 99}`)).not.toBeNull();
  });

  test("F6: late resolutions are bounded", () => {
    const a = createPendingMutationRegistry().forScope(A, () => true);
    for (let i = 0; i < RESOLUTIONS_MAX + 10; i++) {
      const id = a.begin({ unitId: `R${i}`, expectedRevision: 1, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
      a.settle(id, "saved");
    }
    expect(a.resolutions()).toHaveLength(RESOLUTIONS_MAX);
    expect(a.resolutions()[0].record.unitId).toBe("R10");
  });
});

describe("fourth remediation: retained uncertainty, derived eligibility", () => {
  const E = LOST;
  const key = (i: number) => `K${i}`;
  const start = (a: ReturnType<ReturnType<typeof createPendingMutationRegistry>["forScope"]>, i: number) =>
    a.begin({ unitId: key(i), expectedRevision: 3, intent: { op: "archive" }, titleAtRequest: "x" });

  test("P2-2: a notFound read sent before the outcome never releases; one sent after does", () => {
    const a = createPendingMutationRegistry().forScope(A, () => true);
    a.accept(unit({ revision: 3 }), a.stamp());
    const id = a.begin({ unitId: "U1", expectedRevision: 3, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
    const early = a.stamp();
    a.markUncertain(id, E);
    a.observe("U1", { kind: "notFound" }, early);
    expect(a.requiresFreshRead("U1")).toBe(true);
    expect(a.list()[0].evaluation.basis).toBe("notFound"); // present state: absent now
    a.observe("U1", { kind: "notFound" }, a.stamp());
    expect(a.requiresFreshRead("U1")).toBe(false);
  });

  test("P2-2: the refusal's own notFound (sent before the outcome) does not release either", () => {
    const a = createPendingMutationRegistry().forScope(A, () => true);
    const id = a.begin({ unitId: "U1", expectedRevision: 3, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
    a.markUncertain(id, normalizeTeacherUnitError({ details: { code: "teacherUnits.notFound" } }));
    expect(a.list()[0].evaluation.basis).toBe("notFound");
    expect(a.requiresFreshRead("U1")).toBe(true);
  });

  test("P2-2 at capacity: 200 units with pre-outcome absences stay blocked; post-outcome absences free them", () => {
    const a = createPendingMutationRegistry().forScope(A, () => true);
    const early: number[] = [];
    for (let i = 0; i < GUARDS_MAX; i++) {
      a.accept(unit({ unitId: key(i), revision: 3 }), a.stamp());
      const id = start(a, i) as string;
      early.push(a.stamp());
      a.markUncertain(id, E);
      a.dismiss(id);
    }
    for (let i = 0; i < GUARDS_MAX; i++) a.markAbsent(key(i), early[i]);
    expect(a.atCapacity("new")).toBe(true);
    for (let i = 0; i < GUARDS_MAX; i++) a.markAbsent(key(i), a.stamp());
    expect(a.atCapacity("new")).toBe(false);
  });

  test("P2-1 capacity: released guards that start blocking again count at once (and may exceed the bound)", () => {
    const a = createPendingMutationRegistry().forScope(A, () => true);
    for (let i = 0; i < GUARDS_MAX; i++) {
      const id = start(a, i) as string;
      a.markUncertain(id, E);
      a.dismiss(id);
    }
    expect(a.atCapacity("new")).toBe(true);
    for (let i = 0; i < GUARDS_MAX; i++) a.accept(unit({ unitId: key(i), revision: 4 }), a.stamp());
    expect(a.atCapacity("new")).toBe(false);
    for (let i = 0; i < 10; i++) {
      const id = start(a, 1000 + i) as string;
      a.markUncertain(id, E);
      a.dismiss(id);
    }
    expect(a.atCapacity("new")).toBe(false);
    // Conflicting content at revision 4 for every earlier unit: all block again.
    for (let i = 0; i < GUARDS_MAX; i++) a.accept(unit({ unitId: key(i), revision: 4, title: "Conflict" }), a.stamp());
    expect(a.atCapacity("new")).toBe(true);
    for (let i = 0; i < GUARDS_MAX; i++) expect(a.requiresFreshRead(key(i))).toBe(true);
    expect(start(a, 2000)).toBeNull();
  });

  test("retained uncertainty records are bounded and never evicted", () => {
    const a = createPendingMutationRegistry().forScope(A, () => true);
    let made = 0;
    for (let i = 0; i < UNCERTAINTY_MAX + 50; i++) {
      const id = start(a, i);
      if (id === null) continue;
      made++;
      a.markUncertain(id, E);
      a.dismiss(id);
      a.accept(unit({ unitId: key(i), revision: 4 }), a.stamp()); // released, still retained
    }
    expect(made).toBe(UNCERTAINTY_MAX);
    expect(a.atCapacity("new")).toBe(true);
    // A retained record still re-blocks on later conflicting evidence.
    a.accept(unit({ unitId: key(0), revision: 4, title: "Conflict" }), a.stamp());
    expect(a.requiresFreshRead(key(0))).toBe(true);
  });
});

describe("fifth remediation: settlement eligibility and capacity reasons", () => {
  const view = () => createPendingMutationRegistry().forScope(A, () => true);
  // Unit U1 with an uncertain request based on revision 3, recovered at 3.
  const uncertainAt3 = () => {
    const a = view();
    a.accept(unit({ revision: 3 }), a.stamp());
    const id = a.begin({ unitId: "U1", expectedRevision: 3, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
    a.markUncertain(id, LOST);
    a.accept(unit({ revision: 3 }), a.stamp());
    expect(a.requiresFreshRead("U1")).toBe(false);
    return a;
  };
  const later = (a: ReturnType<typeof view>, base: number) =>
    a.begin({ unitId: "U1", expectedRevision: base, intent: { op: "restore" }, titleAtRequest: "x" }) as string;
  const stillProtected = (a: ReturnType<typeof view>) => {
    a.accept(unit({ revision: a.latest("U1")!.unit!.revision, title: "Conflict" }), a.stamp());
    expect(a.requiresFreshRead("U1")).toBe(true);
  };

  test("a server no-op (never reported as a confirmed write) settles nothing", () => {
    const a = uncertainAt3();
    a.settle(later(a, 3), undefined, false);
    stillProtected(a);
  });

  test("a 'confirmed' success whose revision never moved past its base settles nothing", () => {
    const a = uncertainAt3();
    a.settle(later(a, 3), undefined, true);
    stillProtected(a);
  });

  test("a confirmed write built on a base below the earlier floor settles nothing", () => {
    const a = uncertainAt3();
    const id = later(a, 2);
    a.accept(unit({ revision: 4 }), a.stamp());
    a.settle(id, undefined, true);
    stillProtected(a);
  });

  test("a confirmed state-changing write from eligible state, with its own committed revision as proof, settles", () => {
    const a = uncertainAt3();
    const id = later(a, 3);
    a.accept(unit({ revision: 4 }), a.stamp());
    // Seventh remediation P3: only structured, response-specific proof.
    a.settle(id, undefined, { committedRevision: 4 });
    a.accept(unit({ revision: 4, title: "Conflict" }), a.stamp());
    expect(a.requiresFreshRead("U1")).toBe(false);
  });

  test("seventh remediation P3: a bare true never settles, even with an accepted base + 1 record", () => {
    const a = uncertainAt3();
    const id = later(a, 3);
    a.accept(unit({ revision: 4 }), a.stamp());
    a.settle(id, undefined, true);
    stillProtected(a);
  });

  test("repeated no-ops leave the retained record (and its capacity) in place", () => {
    const a = view();
    for (let i = 0; i < UNCERTAINTY_MAX; i++) {
      a.accept(unit({ unitId: `R${i}`, revision: 3 }), a.stamp());
      const id = a.begin({ unitId: `R${i}`, expectedRevision: 3, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
      a.markUncertain(id, LOST);
      a.dismiss(id);
      a.accept(unit({ unitId: `R${i}`, revision: 3 }), a.stamp());
    }
    expect(a.capacityReason("new")).toBe("retained");
    for (let k = 0; k < 3; k++) {
      const id = a.begin({ unitId: "R0", expectedRevision: 3, intent: { op: "restore" }, titleAtRequest: "x" }) as string;
      a.settle(id, undefined, false);
    }
    expect(a.capacityReason("new")).toBe("retained");
    // A bare true (no response proof) frees nothing (seventh remediation P3).
    const bare = a.begin({ unitId: "R0", expectedRevision: 3, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
    a.accept(unit({ unitId: "R0", revision: 4, status: "archived", archivedAtMillis: 9 }), a.stamp());
    a.settle(bare, "saved", true);
    expect(a.capacityReason("new")).toBe("retained");
    const id = a.begin({ unitId: "R0", expectedRevision: 3, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
    a.settle(id, "saved", { committedRevision: 4 });
    expect(a.capacityReason("new")).toBeNull();
  });

  test("capacity reasons: pending, then blocking, then retained", () => {
    const p = view();
    for (let i = 0; i < PENDING_MAX; i++) p.begin({ unitId: `P${i}`, expectedRevision: 1, intent: { op: "archive" }, titleAtRequest: "x" });
    expect(p.capacityReason("new")).toBe("pending");
    const g = view();
    for (let i = 0; i < GUARDS_MAX; i++) {
      const id = g.begin({ unitId: `G${i}`, expectedRevision: 1, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
      g.markUncertain(id, LOST);
      g.dismiss(id);
    }
    expect(g.capacityReason("new")).toBe("blocking");
    expect(g.capacityReason("G0")).toBe(null); // its own unit already counts
  });
});

describe("sixth remediation: settlement proof is the response's own revision", () => {
  const view = (school = "schoolA") => createPendingMutationRegistry().forScope({ teacherId: "teacherA", schoolId: school }, () => true);
  const recovered = (a: ReturnType<typeof view>, unitId = "U1") => {
    a.accept(unit({ unitId, revision: 3 }), a.stamp());
    const id = a.begin({ unitId, expectedRevision: 3, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
    a.markUncertain(id, LOST);
    a.accept(unit({ unitId, revision: 3 }), a.stamp());
  };
  const write = (a: ReturnType<typeof view>, base: number, unitId = "U1") =>
    a.begin({ unitId, expectedRevision: base, intent: { op: "restore" }, titleAtRequest: "x" }) as string;
  const blocksAfterConflict = (a: ReturnType<typeof view>, unitId = "U1") => {
    const rev = a.latest(unitId)!.unit!.revision;
    a.accept(unit({ unitId, revision: rev, title: "Conflict" }), a.stamp());
    return a.requiresFreshRead(unitId);
  };

  test.each([
    ["valid: base 3, committed 4", { committedRevision: 4 }, false],
    ["did not advance: committed 3", { committedRevision: 3 }, true],
    ["skipped: committed 5", { committedRevision: 5 }, true],
    ["missing: NaN", { committedRevision: Number.NaN }, true],
    ["malformed: fractional", { committedRevision: 4.5 }, true],
    ["server no-op", false, true],
  ] as const)("%s", (_l, proof, stillProtected) => {
    const a = view();
    recovered(a);
    const id = write(a, 3);
    // A separate newer read is accepted before the response: never borrowed.
    a.accept(unit({ revision: 4, title: "Other read" }), a.stamp());
    a.settle(id, undefined, proof);
    expect(blocksAfterConflict(a)).toBe(stillProtected);
  });

  test("settlement is unit-scoped and school-scoped", () => {
    const a = view();
    recovered(a, "U1");
    recovered(a, "U2");
    const id = write(a, 3, "U1");
    a.settle(id, undefined, { committedRevision: 4 });
    a.accept(unit({ unitId: "U1", revision: 4 }), a.stamp());
    expect(blocksAfterConflict(a, "U1")).toBe(false);
    expect(blocksAfterConflict(a, "U2")).toBe(true);
    const reg = createPendingMutationRegistry();
    const s1 = reg.forScope({ teacherId: "teacherA", schoolId: "schoolA" }, () => true);
    recovered(s1);
    const pendingId = write(s1, 3);
    const s2 = reg.forScope({ teacherId: "teacherA", schoolId: "schoolB" }, () => true);
    s1.settle(pendingId, undefined, { committedRevision: 4 }); // old scope: refused
    recovered(s2);
    expect(blocksAfterConflict(s2)).toBe(true);
  });

  test("retained capacity: an invalid proof keeps the slot, a valid one frees it", () => {
    const a = view();
    for (let i = 0; i < UNCERTAINTY_MAX; i++) {
      recovered(a, `R${i}`);
      a.dismiss(a.list()[a.list().length - 1].record.id);
    }
    expect(a.capacityReason("new")).toBe("retained");
    a.settle(write(a, 3, "R0"), undefined, { committedRevision: 3 });
    a.settle(write(a, 3, "R0"), undefined, { committedRevision: 6 });
    expect(a.capacityReason("new")).toBe("retained");
    a.settle(write(a, 3, "R0"), undefined, { committedRevision: 4 });
    expect(a.capacityReason("new")).toBeNull();
  });
});
