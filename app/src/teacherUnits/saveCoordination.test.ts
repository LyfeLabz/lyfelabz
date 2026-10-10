import {
  classifyCreateFailure,
  createUnitCreateCoordinator,
  defaultMintIdempotencyKey,
  type TeacherUnitCreateContext,
  type TeacherUnitCreatePayload,
} from "./saveCoordination";
import { normalizeTeacherUnitError } from "./errors";
import type { TeacherUnit, TeacherUnitsCreateRequest, TeacherUnitsCreateResponse } from "./types";

const httpsError = (fbCode: string, code?: string) =>
  Object.assign(new Error("server text"), { code: fbCode, details: code ? { code } : undefined });

const CTX: TeacherUnitCreateContext = { teacherId: "t1", schoolId: "s1" };
const PAYLOAD: TeacherUnitCreatePayload = { grade: "7", title: "Earth Systems", description: "" };

const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: "AbCdEfGhIjKlMnOpQrSt",
  grade: "7",
  title: "Earth Systems",
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

// A scripted create callable: each call consumes the next scripted result.
function scripted(results: Array<TeacherUnitsCreateResponse | Error>) {
  const calls: TeacherUnitsCreateRequest[] = [];
  const create = jest.fn(async (req: TeacherUnitsCreateRequest) => {
    calls.push(req);
    const next = results.shift();
    if (next === undefined) throw new Error("unscripted call");
    if (next instanceof Error) throw next;
    return next;
  });
  return { create, calls };
}

// Mutable "live session" the injected reader returns at dispatch time.
let session: TeacherUnitCreateContext | null = CTX;

function coordinator(
  create: (req: TeacherUnitsCreateRequest) => Promise<TeacherUnitsCreateResponse>,
  mint = keys(),
) {
  return createUnitCreateCoordinator({ create, readSessionContext: () => session, mint });
}

beforeEach(() => {
  session = CTX;
});

function keys() {
  let n = 0;
  return jest.fn(() => `key-000000${++n}`);
}

describe("createUnitCreateCoordinator", () => {
  test("1. post-commit account refusal keeps key K unresolved", async () => {
    const { create, calls } = scripted([httpsError("functions/x", "account-inactive")]);
    const c = coordinator(create);
    await c.submit(PAYLOAD);
    const s = c.state();
    expect(s).toMatchObject({ kind: "unresolved", reason: "unauthorized", key: "key-0000001" });
    expect(calls[0]?.idempotencyKey).toBe("key-0000001");
  });

  test("2. unauthorized blocks reconciliation without discarding K", async () => {
    const { create } = scripted([httpsError("functions/x", "account-inactive")]);
    const c = coordinator(create);
    await c.submit(PAYLOAD);
    expect(await c.reconcile()).toEqual({ kind: "blocked", reason: "awaitingReauthorization" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(c.state()).toMatchObject({ kind: "unresolved", key: "key-0000001" });
  });

  test("3. after re-authorization, reconcile replays K with the original payload", async () => {
    const { create, calls } = scripted([
      httpsError("functions/x", "account-inactive"),
      { unit: unit(), replayed: true },
    ]);
    const mint = keys();
    const c = coordinator(create, mint);
    await c.submit(PAYLOAD);
    const r = await c.reconcile({ reauthorized: true });
    expect(r).toMatchObject({ kind: "settled", state: { kind: "created", replayed: true } });
    expect(calls[1]).toEqual({ ...PAYLOAD, idempotencyKey: "key-0000001" });
    expect(mint).toHaveBeenCalledTimes(1);
  });

  test("4. network timeout preserves K and payload", async () => {
    const { create } = scripted([httpsError("functions/deadline-exceeded")]);
    const c = coordinator(create);
    await c.submit(PAYLOAD);
    expect(c.state()).toMatchObject({
      kind: "unresolved",
      reason: "uncertain",
      key: "key-0000001",
      payload: PAYLOAD,
      context: CTX,
    });
  });

  test("5. create contention keeps K for a same-key retry", async () => {
    const { create, calls } = scripted([
      httpsError("functions/already-exists", "teacherUnits.writeConflict"),
      { unit: unit(), replayed: false },
    ]);
    const c = coordinator(create);
    await c.submit(PAYLOAD);
    expect(c.state()).toMatchObject({ kind: "unresolved", reason: "contention" });
    await c.reconcile();
    expect(calls.map((x) => x.idempotencyKey)).toEqual(["key-0000001", "key-0000001"]);
    expect(c.state().kind).toBe("created");
  });

  test("6. idempotencyKeyConflict after an uncertain attempt does not mint K2", async () => {
    const { create, calls } = scripted([
      httpsError("functions/unavailable"),
      httpsError("functions/failed-precondition", "teacherUnits.idempotencyKeyConflict"),
    ]);
    const mint = keys();
    const c = coordinator(create, mint);
    await c.submit(PAYLOAD);
    await c.reconcile();
    expect(c.state()).toMatchObject({
      kind: "unresolved",
      reason: "idempotencyKeyConflict",
      key: "key-0000001",
    });
    expect(mint).toHaveBeenCalledTimes(1);
    expect(calls.map((x) => x.idempotencyKey)).toEqual(["key-0000001", "key-0000001"]);
  });

  test("7. edited form fields cannot change the payload bound to K", async () => {
    const { create, calls } = scripted([
      httpsError("functions/unavailable"),
      { unit: unit(), replayed: true },
    ]);
    const c = coordinator(create);
    const form = { ...PAYLOAD };
    await c.submit(form);
    form.title = "Edited title";
    expect(await c.submit(form)).toEqual({ kind: "blocked", reason: "unresolved" });
    await c.reconcile();
    expect(calls[1]?.title).toBe("Earth Systems");
    expect(calls).toHaveLength(2);
  });

  test("8. a different teacher or school cannot replay the attempt", async () => {
    const { create } = scripted([httpsError("functions/unavailable")]);
    const c = coordinator(create);
    await c.submit(PAYLOAD);
    session = { teacherId: "t2", schoolId: "s1" };
    expect(await c.reconcile()).toEqual({ kind: "blocked", reason: "contextMismatch" });
    session = { teacherId: "t1", schoolId: "s2" };
    expect(await c.reconcile({ reauthorized: true })).toEqual({
      kind: "blocked",
      reason: "contextMismatch",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(c.state()).toMatchObject({ kind: "unresolved", context: CTX });
  });

  test("9. confirmed success resolves the attempt; a repeat submit is refused", async () => {
    const { create, calls } = scripted([
      { unit: unit(), replayed: false },
      { unit: unit({ unitId: "ZyXwVuTsRqPoNmLkJiHg" }), replayed: false },
    ]);
    const mint = keys();
    const c = coordinator(create, mint);
    await c.submit(PAYLOAD);
    expect(c.state()).toMatchObject({ kind: "created", replayed: false });
    expect(await c.reconcile()).toEqual({ kind: "blocked", reason: "noUnresolvedAttempt" });
    expect(await c.submit(PAYLOAD)).toEqual({ kind: "blocked", reason: "newUnitIntentRequired" });
    expect(await c.submit({ ...PAYLOAD, title: "Second" })).toEqual({
      kind: "blocked",
      reason: "newUnitIntentRequired",
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(c.beginNewUnit()).toBe(true);
    await c.submit({ ...PAYLOAD, title: "Second" });
    expect(calls.map((x) => x.idempotencyKey)).toEqual(["key-0000001", "key-0000002"]);
  });

  test("9b. a replay with a confirmed unit also resolves the attempt", async () => {
    const { create } = scripted([
      httpsError("functions/unavailable"),
      { unit: unit(), replayed: true },
    ]);
    const c = coordinator(create);
    await c.submit(PAYLOAD);
    await c.reconcile();
    expect(c.state()).toMatchObject({ kind: "created", replayed: true });
  });

  test("10. a pre-commit validation refusal resolves as rejected (no receipt exists)", async () => {
    const { create, calls } = scripted([
      httpsError("functions/invalid-argument", "teacherUnits.invalidTitle"),
      { unit: unit(), replayed: false },
    ]);
    const c = coordinator(create);
    await c.submit({ ...PAYLOAD, title: " " });
    expect(c.state()).toMatchObject({ kind: "rejected" });
    await c.submit(PAYLOAD);
    expect(calls.map((x) => x.idempotencyKey)).toEqual(["key-0000001", "key-0000002"]);
  });

  test("11. no outcome triggers an automatic resend", async () => {
    for (const err of [
      httpsError("functions/unavailable"),
      httpsError("functions/internal"),
      httpsError("functions/already-exists", "teacherUnits.writeConflict"),
      httpsError("functions/x", "role-forbidden"),
      httpsError("functions/not-found", "teacherUnits.notFound"),
    ]) {
      const { create } = scripted([err]);
      const c = coordinator(create);
      await c.submit(PAYLOAD);
      expect(create).toHaveBeenCalledTimes(1);
      expect(c.state().kind).toBe("unresolved");
    }
  });

  test("12. a separate unit requires explicit abandon and new-unit intent", async () => {
    const { create, calls } = scripted([
      httpsError("functions/unavailable"),
      { unit: unit(), replayed: false },
    ]);
    const c = coordinator(create);
    await c.submit(PAYLOAD);
    expect(await c.submit({ ...PAYLOAD, title: "Other" })).toEqual({
      kind: "blocked",
      reason: "unresolved",
    });
    expect(c.beginNewUnit()).toBe(false);
    expect(c.abandon()).toBe(true);
    // The abandoned attempt stays visible so the UI can warn it may exist.
    expect(c.state()).toMatchObject({
      kind: "abandoned",
      key: "key-0000001",
      payload: PAYLOAD,
      context: CTX,
      reason: "uncertain",
    });
    expect(await c.submit({ ...PAYLOAD, title: "Other" })).toEqual({
      kind: "blocked",
      reason: "newUnitIntentRequired",
    });
    expect(await c.reconcile()).toEqual({ kind: "blocked", reason: "noUnresolvedAttempt" });
    expect(c.beginNewUnit()).toBe(true);
    expect(c.state().kind).toBe("idle");
    await c.submit({ ...PAYLOAD, title: "Other" });
    expect(calls.map((x) => x.idempotencyKey)).toEqual(["key-0000001", "key-0000002"]);
  });

  test("abandon and beginNewUnit do nothing in the wrong states", async () => {
    const { create } = scripted([{ unit: unit(), replayed: false }]);
    const c = coordinator(create);
    expect(c.abandon()).toBe(false);
    await c.submit(PAYLOAD);
    expect(c.abandon()).toBe(false);
    expect(c.state().kind).toBe("created");
  });

  test("rejected allows a corrected submit with a new key, or beginNewUnit", async () => {
    const { create } = scripted([httpsError("functions/invalid-argument", "teacherUnits.invalidTitle")]);
    const c = coordinator(create);
    await c.submit(PAYLOAD);
    expect(c.state().kind).toBe("rejected");
    expect(c.beginNewUnit()).toBe(true);
    expect(c.state().kind).toBe("idle");
  });

  test("dispatch reads the session at call time and refuses without one", async () => {
    const { create, calls } = scripted([
      httpsError("functions/unavailable"),
      { unit: unit(), replayed: true },
    ]);
    const c = coordinator(create);
    session = null;
    expect(await c.submit(PAYLOAD)).toEqual({ kind: "blocked", reason: "noSession" });
    session = { teacherId: "", schoolId: "s1" };
    expect(await c.submit(PAYLOAD)).toEqual({ kind: "blocked", reason: "noSession" });
    expect(create).not.toHaveBeenCalled();
    session = CTX;
    await c.submit(PAYLOAD);
    session = null;
    expect(await c.reconcile()).toEqual({ kind: "blocked", reason: "noSession" });
    session = { ...CTX };
    await c.reconcile();
    expect(calls).toHaveLength(2);
    expect(c.state().kind).toBe("created");
  });

  test("the context pinned at first dispatch is kept, not the later session", async () => {
    const { create } = scripted([httpsError("functions/x", "account-inactive")]);
    const c = coordinator(create);
    await c.submit(PAYLOAD);
    session = { teacherId: "t9", schoolId: "s9" };
    expect(c.state()).toMatchObject({ kind: "unresolved", context: CTX });
    expect(await c.reconcile({ reauthorized: true })).toEqual({
      kind: "blocked",
      reason: "contextMismatch",
    });
  });

  test("repeated reconciliation keeps the same key and payload", async () => {
    const { create, calls } = scripted([
      httpsError("functions/unavailable"),
      httpsError("functions/unavailable"),
      httpsError("functions/unavailable"),
      { unit: unit(), replayed: true },
    ]);
    const c = coordinator(create);
    await c.submit(PAYLOAD);
    await c.reconcile();
    await c.reconcile();
    await c.reconcile();
    expect(new Set(calls.map((x) => JSON.stringify(x))).size).toBe(1);
    expect(c.state().kind).toBe("created");
  });

  test("a second submit while in flight is blocked", async () => {
    let release!: (v: TeacherUnitsCreateResponse) => void;
    const create = jest.fn(
      () => new Promise<TeacherUnitsCreateResponse>((r) => (release = r)),
    );
    const c = coordinator(create);
    const first = c.submit(PAYLOAD);
    expect(await c.submit(PAYLOAD)).toEqual({ kind: "blocked", reason: "inFlight" });
    expect(c.abandon()).toBe(false);
    expect(c.beginNewUnit()).toBe(false);
    expect(c.state().kind).toBe("inFlight");
    release({ unit: unit(), replayed: false });
    await first;
    expect(create).toHaveBeenCalledTimes(1);
  });

  test("default keys satisfy the server grammar", () => {
    expect(defaultMintIdempotencyKey()).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });
});

describe("create-specific feedback for unresolved attempts", () => {
  const NON_EXECUTION = /not (been )?(saved|created)|was not|wasn't (saved|created)|failed|never/i;
  const NEW_KEY = /new (key|request)|create it again|start over/i;

  test("uncertain create, then contention on reconcile: same key, honest feedback, no auto retry", async () => {
    const { create, calls } = scripted([
      httpsError("functions/unavailable"),
      httpsError("functions/already-exists", "teacherUnits.writeConflict"),
    ]);
    const mint = keys();
    const c = coordinator(create, mint);
    await c.submit(PAYLOAD);
    await c.reconcile();
    const s = c.state();
    expect(s).toMatchObject({
      kind: "unresolved",
      reason: "contention",
      key: "key-0000001",
      payload: PAYLOAD,
      context: CTX,
    });
    if (s.kind !== "unresolved") throw new Error("unreachable");
    expect(s.error.code).toBe("teacherUnits.writeConflict");
    expect(s.error.category).toBe("conflict");
    expect(s.error.recovery).toBe("reconcileCreate");
    expect(s.error.message).toMatch(/couldn't confirm whether this unit was created/);
    expect(s.error.message).not.toMatch(NON_EXECUTION);
    expect(s.error.message).not.toMatch(NEW_KEY);
    expect(create).toHaveBeenCalledTimes(2);
    expect(mint).toHaveBeenCalledTimes(1);
    expect(calls.map((x) => x.idempotencyKey)).toEqual(["key-0000001", "key-0000001"]);
  });

  test.each([
    ["functions/unavailable", undefined, "reconcileCreate"],
    ["functions/internal", undefined, "reconcileCreate"],
    ["functions/not-found", "teacherUnits.notFound", "reconcileCreate"],
    ["functions/x", "account-inactive", "signIn"],
    ["functions/failed-precondition", "teacherUnits.idempotencyKeyConflict", "refresh"],
  ])("%s %s: unconfirmed wording, recovery %s", async (fb, code, recovery) => {
    const { create } = scripted([httpsError(fb, code)]);
    const c = coordinator(create);
    await c.submit(PAYLOAD);
    const s = c.state();
    if (s.kind !== "unresolved") throw new Error("expected unresolved");
    expect(s.error.recovery).toBe(recovery);
    expect(s.error.message).toMatch(/couldn't confirm whether this unit was created/);
    expect(s.error.message).not.toMatch(NON_EXECUTION);
    expect(s.error.message).not.toMatch(NEW_KEY);
    expect(s.error.message).not.toContain("\u2014");
  });

  test("ordinary revision-protected conflicts keep their not-saved wording", () => {
    const update = normalizeTeacherUnitError(
      httpsError("functions/already-exists", "teacherUnits.writeConflict"),
    );
    expect(update.recovery).toBe("refresh");
    expect(update.message).toMatch(/your change was not saved/);
    const reorder = normalizeTeacherUnitError(
      Object.assign(new Error("x"), {
        code: "functions/already-exists",
        details: { code: "teacherUnits.writeConflict", unitId: "AbCdEfGhIjKlMnOpQrSt", currentRevision: 4 },
      }),
    );
    expect(reorder.conflictUnitId).toBe("AbCdEfGhIjKlMnOpQrSt");
    expect(reorder.message).toMatch(/Refresh to load the latest version/);
  });
});

describe("classifyCreateFailure", () => {
  test.each([
    ["teacherUnits.invalidTitle", { kind: "rejected" }],
    ["teacherUnits.invalidDescription", { kind: "rejected" }],
    ["teacherUnits.invalidGrade", { kind: "rejected" }],
    ["teacherUnits.invalidIdempotencyKey", { kind: "rejected" }],
    ["teacherUnits.invalidRequest", { kind: "rejected" }],
    ["teacherUnits.writeConflict", { kind: "unresolved", reason: "contention" }],
    ["teacherUnits.idempotencyKeyConflict", { kind: "unresolved", reason: "idempotencyKeyConflict" }],
    ["teacherUnits.notFound", { kind: "unresolved", reason: "notFound" }],
    ["account-inactive", { kind: "unresolved", reason: "unauthorized" }],
    ["claim-state-mismatch", { kind: "unresolved", reason: "unauthorized" }],
    ["district-mismatch", { kind: "unresolved", reason: "unauthorized" }],
    ["functions/internal", { kind: "unresolved", reason: "uncertain" }],
  ])("%s", (code, expected) => {
    const err = code.startsWith("functions/") ? httpsError(code) : httpsError("functions/x", code);
    expect(classifyCreateFailure(normalizeTeacherUnitError(err))).toEqual(expected);
  });
});
