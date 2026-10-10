import type { Functions } from "firebase/functions";

const invocations: Array<{ name: string; payload: unknown }> = [];
const created: string[] = [];
let nextResponse: unknown = null;
let nextError: unknown = null;
// When true, each invocation returns a pending promise resolved by `release`.
let deferMode = false;
let release: ((data: unknown) => void) | null = null;

jest.mock("firebase/functions", () => ({
  httpsCallable: (_functions: unknown, name: string) => {
    created.push(name);
    return async (payload: unknown) => {
      invocations.push({ name, payload });
      if (deferMode) {
        return new Promise((resolve) => {
          release = (data: unknown) => resolve({ data });
        });
      }
      if (nextError !== null) throw nextError;
      return { data: nextResponse };
    };
  },
}));

import {
  TEACHER_UNITS_CALLABLE_NAMES,
  TeacherUnitsResponseError,
  createFirebaseTeacherUnitsCallables,
} from "./wire";

const FUNCTIONS = {} as Functions;
const UNIT_A = "AbCdEfGhIjKlMnOpQrSt";
const UNIT_B = "ZyXwVuTsRqPoNmLkJiHg";

const unit = (over: Record<string, unknown> = {}) => ({
  unitId: "AbCdEfGhIjKlMnOpQrSt",
  grade: "7",
  title: "Earth Systems",
  description: "",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: 1000,
  updatedAtMillis: 2000,
  resourceIds: ["earths-layers", "simulation-gravity-wells", "plate-tectonics"],
  sortOrder: 0,
  revision: 3,
  ...over,
});

beforeEach(() => {
  invocations.length = 0;
  created.length = 0;
  nextResponse = null;
  nextError = null;
  deferMode = false;
  release = null;
});

describe("teacherUnits wire", () => {
  test("exposes exactly the eight certified callable names", () => {
    expect(Object.values(TEACHER_UNITS_CALLABLE_NAMES).sort()).toEqual(
      [
        "teacherUnitsArchive",
        "teacherUnitsCreate",
        "teacherUnitsGet",
        "teacherUnitsList",
        "teacherUnitsReorder",
        "teacherUnitsRestore",
        "teacherUnitsSetResources",
        "teacherUnitsUpdate",
      ].sort(),
    );
  });

  test("constructing the adapter invokes nothing", () => {
    createFirebaseTeacherUnitsCallables(FUNCTIONS);
    expect(invocations).toEqual([]);
    expect(created.sort()).toEqual(Object.values(TEACHER_UNITS_CALLABLE_NAMES).sort());
  });

  test("create sends allowlisted keys and returns unit + replayed", async () => {
    const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
    nextResponse = { unit: unit({ revision: 1 }), replayed: true };
    const res = await c.create({ grade: "7", title: "Earth Systems", idempotencyKey: "key-12345678" });
    expect(invocations).toEqual([
      {
        name: "teacherUnitsCreate",
        payload: { grade: "7", title: "Earth Systems", idempotencyKey: "key-12345678" },
      },
    ]);
    expect(res.replayed).toBe(true);
    expect(res.unit.revision).toBe(1);
  });

  test("create includes description only when given", async () => {
    const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
    nextResponse = { unit: unit({ grade: "6" }), replayed: false };
    await c.create({ grade: "6", title: "T", description: "", idempotencyKey: "key-12345678" });
    expect(invocations[0]?.payload).toEqual({
      grade: "6",
      title: "T",
      description: "",
      idempotencyKey: "key-12345678",
    });
  });

  test("create sends expectedSchoolId only when given (U2.2, additive)", async () => {
    const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
    nextResponse = { unit: unit({ revision: 1 }), replayed: false };
    await c.create({ grade: "7", title: "T", idempotencyKey: "key-12345678", expectedSchoolId: "school-a" });
    await c.create({ grade: "7", title: "T", idempotencyKey: "key-12345679" });
    expect(invocations.map((i) => i.payload)).toEqual([
      { grade: "7", title: "T", idempotencyKey: "key-12345678", expectedSchoolId: "school-a" },
      { grade: "7", title: "T", idempotencyKey: "key-12345679" },
    ]);
  });

  test("list sends only provided options and keeps server order", async () => {
    const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
    nextResponse = {
      units: [
        unit({ unitId: "b".repeat(20), sortOrder: 1 }),
        unit({ unitId: "a".repeat(20), sortOrder: 2 }),
      ],
    };
    const res = await c.list();
    expect(invocations[0]).toEqual({ name: "teacherUnitsList", payload: {} });
    expect(res.units.map((u) => u.unitId)).toEqual(["b".repeat(20), "a".repeat(20)]);
    nextResponse = { units: [] };
    await c.list({ includeArchived: true, grade: "8" });
    expect(invocations[1]?.payload).toEqual({ includeArchived: true, grade: "8" });
  });

  test("get returns the unit with exact resource order", async () => {
    const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
    nextResponse = { unit: unit() };
    const res = await c.get({ unitId: "AbCdEfGhIjKlMnOpQrSt" });
    expect(invocations[0]).toEqual({
      name: "teacherUnitsGet",
      payload: { unitId: "AbCdEfGhIjKlMnOpQrSt" },
    });
    expect(res.unit.resourceIds).toEqual([
      "earths-layers",
      "simulation-gravity-wells",
      "plate-tectonics",
    ]);
  });

  test("update sends only changed fields and preserves noop + revision", async () => {
    const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
    nextResponse = { unit: unit({ revision: 3 }), noop: true };
    const res = await c.update({ unitId: UNIT_A, expectedRevision: 3, title: "New" });
    expect(invocations[0]).toEqual({
      name: "teacherUnitsUpdate",
      payload: { unitId: UNIT_A, expectedRevision: 3, title: "New" },
    });
    expect(res).toEqual({ unit: expect.objectContaining({ revision: 3 }), noop: true });
  });

  test.each([
    ["archive", "teacherUnitsArchive"],
    ["restore", "teacherUnitsRestore"],
  ] as const)("%s sends unitId + expectedRevision", async (op, name) => {
    const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
    nextResponse = { unit: unit({ revision: 5 }), noop: false };
    const res = await c[op]({ unitId: UNIT_A, expectedRevision: 4 });
    expect(invocations[0]).toEqual({
      name,
      payload: { unitId: UNIT_A, expectedRevision: 4 },
    });
    expect(res.noop).toBe(false);
    expect(res.unit.revision).toBe(5);
  });

  test("setResources sends the complete ordered list", async () => {
    const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
    nextResponse = { unit: unit({ revision: 4 }), noop: false };
    const ids = ["plate-tectonics", "earths-layers"];
    await c.setResources({ unitId: UNIT_A, expectedRevision: 3, resourceIds: ids });
    expect(invocations[0]).toEqual({
      name: "teacherUnitsSetResources",
      payload: { unitId: UNIT_A, expectedRevision: 3, resourceIds: ids },
    });
  });

  test("reorder sends grade + entries and returns units + noop", async () => {
    const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
    nextResponse = {
      units: [unit({ unitId: "b".repeat(20), sortOrder: 1 }), unit({ unitId: "a".repeat(20), sortOrder: 2 })],
      noop: false,
    };
    const res = await c.reorder({
      grade: "7",
      units: [
        { unitId: "b".repeat(20), expectedRevision: 2 },
        { unitId: "a".repeat(20), expectedRevision: 9 },
      ],
    });
    expect(invocations[0]).toEqual({
      name: "teacherUnitsReorder",
      payload: {
        grade: "7",
        units: [
          { unitId: "b".repeat(20), expectedRevision: 2 },
          { unitId: "a".repeat(20), expectedRevision: 9 },
        ],
      },
    });
    expect(res.units.map((u) => u.sortOrder)).toEqual([1, 2]);
    expect(res.noop).toBe(false);
  });

  test("server errors propagate unchanged", async () => {
    const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
    const err = Object.assign(new Error("conflict"), {
      code: "functions/already-exists",
      details: { code: "teacherUnits.writeConflict", currentRevision: 7 },
    });
    nextError = err;
    await expect(
      c.setResources({ unitId: UNIT_A, expectedRevision: 3, resourceIds: [] }),
    ).rejects.toBe(err);
  });

  test("malformed responses throw instead of succeeding", async () => {
    const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
    nextResponse = { unit: unit() }; // missing noop
    await expect(c.archive({ unitId: UNIT_A, expectedRevision: 1 })).rejects.toBeInstanceOf(
      TeacherUnitsResponseError,
    );
    nextResponse = { unit: unit({ revision: 0 }), noop: false };
    await expect(c.restore({ unitId: UNIT_A, expectedRevision: 1 })).rejects.toBeInstanceOf(
      TeacherUnitsResponseError,
    );
    nextResponse = null;
    await expect(c.list()).rejects.toBeInstanceOf(TeacherUnitsResponseError);
  });

  describe("runtime validation of authoritative state", () => {
    const get = async (u: Record<string, unknown>) => {
      const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
      nextResponse = { unit: u };
      return c.get({ unitId: "AbCdEfGhIjKlMnOpQrSt" });
    };
    const rejects = (u: Record<string, unknown>) =>
      expect(get(u)).rejects.toBeInstanceOf(TeacherUnitsResponseError);

    test.each([
      ["short unitId", { unitId: "abc" }],
      ["unitId with separator", { unitId: "AbCdEfGhIj-lMnOpQrSt" }],
      ["empty title", { title: "" }],
      ["untrimmed title", { title: " Earth" }],
      ["oversized title", { title: "x".repeat(121) }],
      ["control char in title", { title: "a\u0007b" }],
      ["oversized description", { description: "x".repeat(1001) }],
      ["non-string description", { description: null }],
      ["duplicate resource ids", { resourceIds: ["earths-layers", "earths-layers"] }],
      ["too many resource ids", { resourceIds: Array.from({ length: 101 }, (_, i) => `r${i}`) }],
      ["empty resource id", { resourceIds: [""] }],
      ["non-array resourceIds", { resourceIds: "earths-layers" }],
      ["fractional sortOrder", { sortOrder: 1.5 }],
      ["negative sortOrder", { sortOrder: -1 }],
      ["NaN sortOrder", { sortOrder: Number.NaN }],
      ["infinite sortOrder", { sortOrder: Number.POSITIVE_INFINITY }],
      ["unsafe sortOrder", { sortOrder: 2 ** 53 }],
      ["zero revision", { revision: 0 }],
      ["fractional revision", { revision: 1.5 }],
      ["unsafe revision", { revision: Number.MAX_SAFE_INTEGER + 2 }],
      ["string revision", { revision: "3" }],
      ["bad status", { status: "deleted" }],
      ["bad grade", { grade: "9" }],
      ["numeric grade", { grade: 7 }],
      ["active with archivedAt", { archivedAtMillis: 5 }],
      ["archived without archivedAt", { status: "archived", archivedAtMillis: null }],
      ["fractional createdAt", { createdAtMillis: 1.5 }],
      ["string updatedAt", { updatedAtMillis: "2000" }],
      ["negative createdAt", { createdAtMillis: -1 }],
      ["empty teacherId", { teacherId: "" }],
      ["numeric schoolId", { schoolId: 3 }],
    ])("rejects %s", async (_label, over) => {
      await rejects(unit(over));
    });

    test("rejects a non-object unit", async () => {
      await rejects(null as unknown as Record<string, unknown>);
      await rejects([] as unknown as Record<string, unknown>);
    });

    test("accepts stored ids that are no longer placeable or unknown", async () => {
      const res = await get(unit({ resourceIds: ["ragebaiting", "retired-lesson", "earths-layers"] }));
      expect(res.unit.resourceIds).toEqual(["ragebaiting", "retired-lesson", "earths-layers"]);
    });

    test("accepts an archived unit with archivedAt and the documented maxima", async () => {
      const res = await get(
        unit({
          status: "archived",
          archivedAtMillis: 3000,
          title: "x".repeat(120),
          description: "line one\n\tline two".padEnd(1000, "y"),
          resourceIds: Array.from({ length: 100 }, (_, i) => `r${i}`),
          teacherId: "t1",
          schoolId: "s1",
        }),
      );
      expect(res.unit.status).toBe("archived");
      expect(res.unit.resourceIds).toHaveLength(100);
    });

    test("rejects malformed envelopes and flags", async () => {
      const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
      const req = { unitId: UNIT_A, expectedRevision: 1 };
      for (const bad of [[], "ok", { unit: unit(), noop: "false" }, { unit: unit(), noop: 0 }]) {
        nextResponse = bad;
        await expect(c.update({ ...req, title: "x" })).rejects.toBeInstanceOf(
          TeacherUnitsResponseError,
        );
      }
      nextResponse = { unit: unit(), replayed: "yes" };
      await expect(
        c.create({ grade: "7", title: "T", idempotencyKey: "key-12345678" }),
      ).rejects.toBeInstanceOf(TeacherUnitsResponseError);
      nextResponse = { unit: unit() };
      await expect(
        c.create({ grade: "7", title: "T", idempotencyKey: "key-12345678" }),
      ).rejects.toBeInstanceOf(TeacherUnitsResponseError);
      nextResponse = { units: {} };
      await expect(c.list()).rejects.toBeInstanceOf(TeacherUnitsResponseError);
    });

    test("rejects list results that violate the request or canonical order", async () => {
      const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
      nextResponse = { units: [unit({ unitId: "a".repeat(20) }), unit({ unitId: "a".repeat(20) })] };
      await expect(c.list({ includeArchived: true })).rejects.toBeInstanceOf(TeacherUnitsResponseError);
      nextResponse = { units: [unit({ grade: "6" })] };
      await expect(c.list({ grade: "7" })).rejects.toBeInstanceOf(TeacherUnitsResponseError);
      nextResponse = { units: [unit({ status: "archived", archivedAtMillis: 1 })] };
      await expect(c.list()).rejects.toBeInstanceOf(TeacherUnitsResponseError);
      nextResponse = {
        units: [unit({ unitId: "b".repeat(20), sortOrder: 2 }), unit({ unitId: "a".repeat(20), sortOrder: 1 })],
      };
      await expect(c.list()).rejects.toBeInstanceOf(TeacherUnitsResponseError);
    });

    test("rejects invalid reorder results", async () => {
      const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
      const req = { grade: "7" as const, units: [{ unitId: "a".repeat(20), expectedRevision: 1 }] };
      for (const bad of [
        { units: [unit({ unitId: "a".repeat(20), grade: "6" })], noop: false },
        { units: [unit({ unitId: "a".repeat(20), status: "archived", archivedAtMillis: 1 })], noop: false },
        { units: [unit({ unitId: "a".repeat(20) }), unit({ unitId: "a".repeat(20) })], noop: false },
        {
          units: [unit({ unitId: "b".repeat(20), sortOrder: 2 }), unit({ unitId: "a".repeat(20), sortOrder: 1 })],
          noop: false,
        },
        { units: [unit({ unitId: "a".repeat(20) })] },
        { units: [unit({ unitId: "a".repeat(20) })], noop: null },
      ]) {
        nextResponse = bad;
        await expect(c.reorder(req)).rejects.toBeInstanceOf(TeacherUnitsResponseError);
      }
    });
  });

  describe("response correlation", () => {
    test("get A returning B is rejected", async () => {
      const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
      nextResponse = { unit: unit({ unitId: UNIT_B }) };
      await expect(c.get({ unitId: UNIT_A })).rejects.toBeInstanceOf(TeacherUnitsResponseError);
    });

    test.each(["update", "archive", "restore", "setResources"] as const)(
      "%s A returning B is rejected (noop or not)",
      async (op) => {
        const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
        const base = { unitId: UNIT_A, expectedRevision: 1 };
        const req =
          op === "update"
            ? { ...base, title: "x" }
            : op === "setResources"
              ? { ...base, resourceIds: [] }
              : base;
        for (const noop of [false, true]) {
          nextResponse = { unit: unit({ unitId: UNIT_B }), noop };
          await expect(
            (c[op] as (r: typeof req) => Promise<unknown>)(req),
          ).rejects.toBeInstanceOf(TeacherUnitsResponseError);
        }
      },
    );

    test("create Grade 7 returning a Grade 6 unit is rejected", async () => {
      const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
      for (const replayed of [false, true]) {
        nextResponse = { unit: unit({ grade: "6" }), replayed };
        await expect(
          c.create({ grade: "7", title: "Earth Systems", idempotencyKey: "key-12345678" }),
        ).rejects.toBeInstanceOf(TeacherUnitsResponseError);
      }
    });

    test("matching identity with legitimately changed mutable fields is accepted", async () => {
      const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
      nextResponse = {
        unit: unit({
          title: "Renamed elsewhere",
          description: "Edited concurrently",
          resourceIds: ["plate-tectonics"],
          sortOrder: 4,
          revision: 12,
        }),
        noop: false,
      };
      const res = await c.update({ unitId: UNIT_A, expectedRevision: 3, title: "Mine" });
      expect(res.unit).toMatchObject({ unitId: UNIT_A, title: "Renamed elsewhere", revision: 12 });
      nextResponse = { unit: unit({ status: "active", archivedAtMillis: null }), noop: false };
      await expect(c.archive({ unitId: UNIT_A, expectedRevision: 3 })).resolves.toMatchObject({
        unit: { unitId: UNIT_A, status: "active" },
      });
    });

    test("create replay returning the original unit's current state is accepted", async () => {
      const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
      nextResponse = {
        unit: unit({
          title: "Renamed since",
          status: "archived",
          archivedAtMillis: 9000,
          resourceIds: ["earths-layers"],
          revision: 6,
        }),
        replayed: true,
      };
      const res = await c.create({ grade: "7", title: "Earth Systems", idempotencyKey: "key-12345678" });
      expect(res).toMatchObject({ replayed: true, unit: { unitId: UNIT_A, title: "Renamed since" } });
    });
  });

  describe("immutable request correlation (caller mutates req while pending)", () => {
    // Dispatch with a pending response, mutate the caller-owned request,
    // then resolve. Correlation must use the dispatched values.
    async function dispatchMutateResolve<R>(
      run: () => Promise<R>,
      mutate: () => void,
      response: unknown,
    ): Promise<R> {
      deferMode = true;
      const p = run();
      mutate();
      expect(release).not.toBeNull();
      release!(response);
      return p;
    }

    const c = () => createFirebaseTeacherUnitsCallables(FUNCTIONS);

    test("get: original id accepted, mutated id rejected", async () => {
      const req = { unitId: UNIT_A };
      await expect(
        dispatchMutateResolve(() => c().get(req), () => (req.unitId = UNIT_B), { unit: unit() }),
      ).resolves.toMatchObject({ unit: { unitId: UNIT_A } });
      const req2 = { unitId: UNIT_A };
      await expect(
        dispatchMutateResolve(() => c().get(req2), () => (req2.unitId = UNIT_B), {
          unit: unit({ unitId: UNIT_B }),
        }),
      ).rejects.toBeInstanceOf(TeacherUnitsResponseError);
    });

    test.each(["update", "archive", "restore", "setResources"] as const)(
      "%s: original id accepted, mutated id rejected",
      async (op) => {
        const make = () => ({
          unitId: UNIT_A,
          expectedRevision: 1,
          title: "x",
          resourceIds: ["earths-layers"],
        });
        // Each adapter sends only its own allowlisted keys from `r`.
        const run = (r: ReturnType<typeof make>) =>
          (c()[op] as (x: ReturnType<typeof make>) => Promise<unknown>)(r);
        const req = make();
        await expect(
          dispatchMutateResolve(() => run(req), () => (req.unitId = UNIT_B), {
            unit: unit(),
            noop: false,
          }),
        ).resolves.toMatchObject({ unit: { unitId: UNIT_A } });
        const req2 = make();
        await expect(
          dispatchMutateResolve(() => run(req2), () => (req2.unitId = UNIT_B), {
            unit: unit({ unitId: UNIT_B }),
            noop: false,
          }),
        ).rejects.toBeInstanceOf(TeacherUnitsResponseError);
      },
    );

    test("create: original grade accepted, mutated grade rejected", async () => {
      const make = (): { grade: "6" | "7"; title: string; idempotencyKey: string } => ({
        grade: "7",
        title: "Earth Systems",
        idempotencyKey: "key-12345678",
      });
      const req = make();
      await expect(
        dispatchMutateResolve(() => c().create(req), () => (req.grade = "6"), {
          unit: unit(),
          replayed: false,
        }),
      ).resolves.toMatchObject({ unit: { grade: "7" } });
      const req2 = make();
      await expect(
        dispatchMutateResolve(() => c().create(req2), () => (req2.grade = "6"), {
          unit: unit({ grade: "6" }),
          replayed: false,
        }),
      ).rejects.toBeInstanceOf(TeacherUnitsResponseError);
      expect(invocations[0]?.payload).toMatchObject({ grade: "7" });
    });

    test("list: dispatched grade and includeArchived govern validation", async () => {
      const req: { grade?: "6" | "7"; includeArchived?: boolean } = { grade: "7" };
      await expect(
        dispatchMutateResolve(
          () => c().list(req),
          () => {
            req.grade = "6";
            req.includeArchived = true;
          },
          { units: [unit()] },
        ),
      ).resolves.toMatchObject({ units: [{ grade: "7" }] });
      const req2: { grade?: "6" | "7"; includeArchived?: boolean } = { grade: "7" };
      await expect(
        dispatchMutateResolve(() => c().list(req2), () => (req2.grade = "6"), {
          units: [unit({ grade: "6" })],
        }),
      ).rejects.toBeInstanceOf(TeacherUnitsResponseError);
      const req3: { grade?: "6" | "7"; includeArchived?: boolean } = {};
      await expect(
        dispatchMutateResolve(() => c().list(req3), () => (req3.includeArchived = true), {
          units: [unit({ status: "archived", archivedAtMillis: 1 })],
        }),
      ).rejects.toBeInstanceOf(TeacherUnitsResponseError);
    });

    test("reorder: original grade accepted, mutated grade rejected", async () => {
      const make = (): { grade: "6" | "7"; units: Array<{ unitId: string; expectedRevision: number }> } => ({
        grade: "7",
        units: [{ unitId: UNIT_A, expectedRevision: 1 }],
      });
      const req = make();
      await expect(
        dispatchMutateResolve(() => c().reorder(req), () => (req.grade = "6"), {
          units: [unit()],
          noop: true,
        }),
      ).resolves.toMatchObject({ noop: true });
      const req2 = make();
      await expect(
        dispatchMutateResolve(() => c().reorder(req2), () => (req2.grade = "6"), {
          units: [unit({ grade: "6" })],
          noop: true,
        }),
      ).rejects.toBeInstanceOf(TeacherUnitsResponseError);
    });

    test("nested resourceIds mutation cannot reach the dispatched payload", async () => {
      const req = { unitId: UNIT_A, expectedRevision: 1, resourceIds: ["earths-layers"] };
      await dispatchMutateResolve(
        () => c().setResources(req),
        () => {
          req.resourceIds.push("plate-tectonics");
          req.resourceIds[0] = "changed";
        },
        { unit: unit(), noop: false },
      );
      expect(invocations[0]?.payload).toEqual({
        unitId: UNIT_A,
        expectedRevision: 1,
        resourceIds: ["earths-layers"],
      });
    });

    test("nested reorder units mutation cannot reach the dispatched payload", async () => {
      const req = {
        grade: "7" as const,
        units: [{ unitId: UNIT_A, expectedRevision: 1 }],
      };
      await dispatchMutateResolve(
        () => c().reorder(req),
        () => {
          req.units[0]!.unitId = UNIT_B;
          req.units[0]!.expectedRevision = 99;
          req.units.push({ unitId: UNIT_B, expectedRevision: 2 });
        },
        { units: [unit()], noop: false },
      );
      expect(invocations[0]?.payload).toEqual({
        grade: "7",
        units: [{ unitId: UNIT_A, expectedRevision: 1 }],
      });
    });
  });

  describe("accessor-backed request mutation during payload construction", () => {
    const makeReq = () =>
      ({
        grade: "6",
        get title() {
          (this as { grade: string }).grade = "7";
          return "T";
        },
        idempotencyKey: "original-key",
      }) as unknown as { grade: "6" | "7"; title: string; idempotencyKey: string };

    test("dispatches Grade 6 and accepts a Grade 6 response", async () => {
      const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
      nextResponse = { unit: unit({ grade: "6" }), replayed: false };
      const res = await c.create(makeReq());
      expect(invocations[0]?.payload).toEqual({
        grade: "6",
        title: "T",
        idempotencyKey: "original-key",
      });
      expect(res.unit.grade).toBe("6");
    });

    test("rejects a Grade 7 response", async () => {
      const c = createFirebaseTeacherUnitsCallables(FUNCTIONS);
      nextResponse = { unit: unit({ grade: "7" }), replayed: false };
      await expect(c.create(makeReq())).rejects.toBeInstanceOf(TeacherUnitsResponseError);
      expect(invocations[0]?.payload).toMatchObject({ grade: "6" });
    });
  });
});
