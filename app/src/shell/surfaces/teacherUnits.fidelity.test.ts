/**
 * @jest-environment jsdom
 *
 * U2.3 fifth certification: message fidelity and durable outcome notices.
 *
 * Models the real server contract: a membership write commits the list the
 * client sent at `expectedRevision + 1`, and the response is a separate
 * post-commit read that may already show later writes by another session.
 * The effect of a write is therefore what was sent, never the difference
 * between the pre-request list and the post-commit record.
 *
 * Covers finding B (addition and removal messages) and finding C (an
 * outcome notice for a unit whose card is no longer shown stays attached,
 * visible, and announced).
 */
import { renderTeacherUnitsPanel } from "./teacherUnitsPanel";
import { createTeacherUnitCreateAttemptStore } from "../../teacherUnits/createAttemptStore";
import { createTeacherUnitsController, type TeacherUnitsController } from "../../teacherUnits/unitsController";
import { getPlaceableResources } from "../../teacherUnits/placeableResources";
import type { TeacherUnitCreateContext } from "../../teacherUnits/saveCoordination";
import type { TeacherUnit, TeacherUnitsCallables } from "../../teacherUnits/types";

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const tick = () => new Promise((r) => setTimeout(r, 0));
const q = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const [R1, R2] = getPlaceableResources().filter((r) => r.grade === "7");

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

let seq = 0;
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: `Fid${String(++seq).padStart(17, "0")}`,
  grade: "7",
  title: "Earth Systems",
  description: "",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: seq,
  updatedAtMillis: seq,
  resourceIds: [],
  sortOrder: 0,
  revision: 1,
  ...over,
});
const archived = (u: TeacherUnit, revision: number, over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  ...u,
  status: "archived",
  archivedAtMillis: 9,
  revision,
  ...over,
});

type Call<T> = { req: Record<string, unknown>; d: Deferred<T> };
function scripted() {
  const calls = {
    list: [] as Array<Call<{ units: TeacherUnit[] }>>,
    get: [] as Array<Call<{ unit: TeacherUnit }>>,
    setResources: [] as Array<Call<{ unit: TeacherUnit; noop: boolean }>>,
    archive: [] as Array<Call<{ unit: TeacherUnit; noop: boolean }>>,
  };
  const queue = (k: keyof typeof calls) =>
    jest.fn((req: Record<string, unknown>) => {
      const d = deferred<unknown>();
      (calls[k] as unknown as Array<Call<unknown>>).push({ req, d });
      return d.promise;
    });
  const c = {
    create: jest.fn(),
    list: queue("list"),
    get: queue("get"),
    update: jest.fn(),
    archive: queue("archive"),
    restore: jest.fn(),
    setResources: queue("setResources"),
    reorder: jest.fn(),
  };
  return { c, calls };
}

async function panel(units: TeacherUnit[], ctx: () => TeacherUnitCreateContext | null = () => SCOPE) {
  const h = scripted();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ctl: TeacherUnitsController = createTeacherUnitsController({
    callables: h.c as unknown as TeacherUnitsCallables,
    session: SCOPE,
    readCurrentContext: ctx,
    store: createTeacherUnitCreateAttemptStore(SCOPE),
    initialGrade: "7",
  });
  renderTeacherUnitsPanel(host, ctl);
  h.calls.list[0].d.resolve({ units });
  await tick();
  return { ...h, host, ctl };
}
type H = Awaited<ReturnType<typeof panel>>;

const status = (host: HTMLElement) => q(host, "units-status")?.textContent ?? "";
const lastList = (h: H) => h.calls.list[h.calls.list.length - 1];
const refreshWith = async (h: H, units: TeacherUnit[]) => {
  void h.ctl.refresh();
  lastList(h).d.resolve({ units });
  await tick();
};
// A full check (archived included), then its automatic active-only load.
const checkWith = async (h: H, units: TeacherUnit[]) => {
  const p = h.ctl.checkRecovery();
  lastList(h).d.resolve({ units });
  await p;
  lastList(h).d.resolve({ units: units.filter((u) => u.status === "active") });
  await tick();
};
const addVia = (h: H, u: TeacherUnit, ids: string[]) => {
  (q(h.host, `units-resources-add-${u.unitId}`) as HTMLButtonElement).click();
  for (const id of ids) (q(h.host, `units-picker-option-${u.unitId}-${id}`) as HTMLInputElement).click();
  (q(h.host, `units-picker-${u.unitId}`) as HTMLFormElement).dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
};
const clickRemove = (h: H, u: TeacherUnit, id: string) =>
  (q(h.host, `units-resource-remove-${u.unitId}-${id}`) as HTMLButtonElement).click();
// Every visible, attached alert in the document.
const attachedAlerts = () =>
  Array.from(document.querySelectorAll<HTMLElement>("[role=alert]")).filter(
    (e) => e.isConnected && !e.hidden && (e.textContent ?? "").length > 0,
  );

beforeEach(() => {
  document.body.textContent = "";
  window.localStorage.clear();
});

// ---------- B: what a confirmed write proves ----------

describe("B: addition and removal messages follow the committed write", () => {
  test("add committed, then removed elsewhere before the post-commit read: never 'Added 0'", async () => {
    const a = unit();
    const h = await panel([a]);
    addVia(h, a, [R1.id]);
    expect(h.calls.setResources[0].req).toMatchObject({ expectedRevision: 1, resourceIds: [R1.id] });
    // Committed at revision 2; the post-commit read already sees revision 3.
    h.calls.setResources[0].d.resolve({ unit: { ...a, resourceIds: [], revision: 3 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(
      `Your addition was saved, but "${a.title}" changed somewhere else since, so not every resource you added is in it now. Its current resources are shown.`,
    );
    expect(status(h.host)).not.toMatch(/Added 0/);
  });

  test("add committed, then removed and re-added elsewhere: the resource is there", async () => {
    const a = unit();
    const h = await panel([a]);
    addVia(h, a, [R1.id]);
    h.calls.setResources[0].d.resolve({ unit: { ...a, resourceIds: [R1.id], revision: 4 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(`Added 1 resource to "${a.title}".`);
  });

  test("two added, one removed elsewhere before the read: no count is claimed for what is not there", async () => {
    const a = unit();
    const h = await panel([a]);
    addVia(h, a, [R1.id, R2.id]);
    h.calls.setResources[0].d.resolve({ unit: { ...a, resourceIds: [R2.id], revision: 3 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(
      `Your addition was saved, but "${a.title}" changed somewhere else since, so not every resource you added is in it now. Its current resources are shown.`,
    );
  });

  test("normal add, duplicate (no-op) add, archived since, and a stale response", async () => {
    const a = unit();
    const h = await panel([a]);
    addVia(h, a, [R1.id]);
    h.calls.setResources[0].d.resolve({ unit: { ...a, resourceIds: [R1.id], revision: 2 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(`Added 1 resource to "${a.title}".`);

    const b = unit({ title: "Water" });
    const h2 = await panel([b]);
    addVia(h2, b, [R1.id]);
    // Added elsewhere first: the server writes nothing (revision 2 is not ours).
    h2.calls.setResources[0].d.resolve({ unit: { ...b, resourceIds: [R1.id], revision: 2 }, noop: true });
    await tick();
    expect(status(h2.host)).toBe(`Those resources are already in "${b.title}", so nothing was changed.`);

    const c = unit({ title: "Air" });
    const h3 = await panel([c]);
    addVia(h3, c, [R1.id]);
    h3.calls.setResources[0].d.resolve({ unit: archived(c, 3, { resourceIds: [R1.id] }), noop: false });
    await tick();
    expect(status(h3.host)).toBe(`Added 1 resource to "${c.title}". "${c.title}" is archived.`);

    const d = unit({ title: "Rocks" });
    const h4 = await panel([d]);
    addVia(h4, d, [R1.id]);
    await refreshWith(h4, [{ ...d, resourceIds: [], revision: 3 }]); // newer than the response
    h4.calls.setResources[0].d.resolve({ unit: { ...d, resourceIds: [R1.id], revision: 2 }, noop: false });
    await tick();
    expect(status(h4.host)).toBe(
      `Your addition was saved, but "${d.title}" changed somewhere else since, so not every resource you added is in it now. Its current resources are shown.`,
    );
  });

  test("remove committed, then re-added elsewhere before the post-commit read: says so, not uncertain", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    expect(h.calls.setResources[0].req).toMatchObject({ expectedRevision: 1, resourceIds: [R2.id] });
    h.calls.setResources[0].d.resolve({ unit: { ...a, resourceIds: [R2.id, R1.id], revision: 3 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(
      `Your removal was saved, but "${R1.title}" is in "${a.title}" again because this unit changed somewhere else. Its current resources are shown.`,
    );
    expect(attachedAlerts().some((e) => (e.textContent ?? "").includes("couldn't confirm"))).toBe(false);
  });

  test("uncertain add: not success, one request only", async () => {
    const a = unit();
    const h = await panel([a]);
    addVia(h, a, [R1.id]);
    h.calls.setResources[0].d.reject(Object.assign(new Error("lost"), { code: "unavailable" }));
    await tick();
    h.calls.get[0].d.resolve({ unit: a });
    await tick();
    expect(status(h.host)).toBe("");
    expect(attachedAlerts().map((e) => e.textContent).join(" ")).toContain("couldn't confirm whether your change was saved");
    expect(h.c.setResources).toHaveBeenCalledTimes(1);
  });
});

// ---------- C: outcome notices survive the card ----------

describe("C: an outcome for a unit that is no longer shown stays attached and announced", () => {
  test("uncertain remove after the unit was archived elsewhere (card hidden)", async () => {
    const a = unit({ title: "Plants", resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    expect(status(h.host)).toBe(`Removing "${R1.title}" from "Plants"...`);
    await checkWith(h, [archived(a, 3)]);
    expect(q(h.host, `units-card-${a.unitId}`)).toBeNull();
    h.calls.setResources[0].d.reject(Object.assign(new Error("lost"), { code: "unavailable" }));
    await tick();
    h.calls.get[0].d.resolve({ unit: archived(a, 3) });
    await tick();
    expect(status(h.host)).toBe(""); // the pending message is cleared
    const alerts = attachedAlerts().filter((e) => (e.textContent ?? "").includes("Plants"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain("archived");
    expect(alerts[0].textContent).toContain("couldn't confirm whether your change was saved");
    expect(alerts[0].textContent).not.toMatch(/Removed "|Your removal was saved/);
  });

  test("a refusal for a unit no longer listed (refreshed away) is shown", async () => {
    const a = unit({ title: "Plants", resourceIds: [R1.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    await refreshWith(h, []);
    expect(q(h.host, `units-card-${a.unitId}`)).toBeNull();
    h.calls.setResources[0].d.reject({ code: "functions/permission-denied", details: { code: "permission-denied" } });
    await tick();
    await tick();
    expect(status(h.host)).toBe("");
    const alerts = attachedAlerts().filter((e) => (e.textContent ?? "").includes("Plants"));
    expect(alerts).toHaveLength(1);
  });

  test("a notice already shown in a card survives the refresh that removes the card", async () => {
    const a = unit({ title: "Plants", resourceIds: [R1.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    h.calls.setResources[0].d.reject({ details: { code: "teacherUnits.writeConflict" } });
    await tick();
    h.calls.get[0].d.resolve({ unit: { ...a, revision: 2 } });
    await tick();
    expect(attachedAlerts().filter((e) => (e.textContent ?? "").includes("nothing was removed"))).toHaveLength(1);
    await refreshWith(h, []); // archived elsewhere: the card leaves
    expect(q(h.host, `units-card-${a.unitId}`)).toBeNull();
    const alerts = attachedAlerts().filter((e) => (e.textContent ?? "").includes("nothing was removed"));
    expect(alerts).toHaveLength(1);
    expect(alerts[0].textContent).toContain("Plants");
  });

  test("a later outcome for another unit does not erase it; the pending message is owned", async () => {
    const a = unit({ title: "Plants", resourceIds: [R1.id] });
    const b = unit({ title: "Water", resourceIds: [R1.id] });
    const h = await panel([a, b]);
    clickRemove(h, a, R1.id);
    await checkWith(h, [archived(a, 3), b]);
    h.calls.setResources[0].d.reject(Object.assign(new Error("lost"), { code: "unavailable" }));
    await tick();
    h.calls.get[0].d.resolve({ unit: archived(a, 3) });
    await tick();
    clickRemove(h, b, R1.id);
    h.calls.setResources[1].d.resolve({ unit: { ...b, resourceIds: [], revision: 2 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(`Removed "${R1.title}" from "Water".`);
    expect(attachedAlerts().filter((e) => (e.textContent ?? "").includes("Plants"))).toHaveLength(1);
  });

  test("a teacher or school change: the late outcome is not shown anywhere", async () => {
    const a = unit({ title: "Plants", resourceIds: [R1.id] });
    let ctx: TeacherUnitCreateContext | null = SCOPE;
    const h = await panel([a], () => ctx);
    clickRemove(h, a, R1.id);
    ctx = { teacherId: "teacherA", schoolId: "schoolB" };
    h.calls.setResources[0].d.reject(Object.assign(new Error("lost"), { code: "unavailable" }));
    await tick();
    expect(h.c.get).not.toHaveBeenCalled();
    expect(attachedAlerts().filter((e) => (e.textContent ?? "").includes("Plants"))).toHaveLength(0);
  });
});

// ---------- Post-commit read: every interleaving ----------
//
// The real write is two server events: COMMIT (the sent list at
// expectedRevision + 1) and the separate post-commit READ that builds the
// response. Interleaved, in every order the contract allows, with another
// session's change and this client's refresh (dispatch, server read,
// receive). The message must never claim more than the server state the
// client accepted supports.

type Ev = { op: "w" | "x" | "r"; ev: string };
function orders(): Ev[][] {
  const seqs: Record<"w" | "x" | "r", string[]> = { w: ["D", "C", "P", "R"], x: ["X"], r: ["D", "X", "R"] };
  const out: Ev[][] = [];
  const pos = { w: 0, x: 0, r: 0 };
  const cur: Ev[] = [];
  const walk = () => {
    if (cur.length === 8) return void out.push(cur.slice());
    for (const k of ["w", "x", "r"] as const) {
      if (pos[k] >= seqs[k].length) continue;
      cur.push({ op: k, ev: seqs[k][pos[k]] });
      pos[k]++;
      walk();
      pos[k]--;
      cur.pop();
    }
  };
  walk();
  return out;
}

describe("post-commit read matrix (add vs another session's removal vs refresh)", () => {
  test("every interleaving: the announcement matches what the accepted state supports", async () => {
    const all = orders();
    expect(all).toHaveLength(280);
    for (const order of all) {
      document.body.textContent = "";
      const a = unit({ title: "Matrix" });
      const h = await panel([a]);
      let server: TeacherUnit = a;
      let committed = false;
      let response: TeacherUnit | null = null;
      let listed: TeacherUnit[] = [];
      let refreshCall: Call<{ units: TeacherUnit[] }> | null = null;
      let msg = "";
      let held: TeacherUnit | null = null;
      for (const { op, ev } of order) {
        if (op === "w" && ev === "D") addVia(h, a, [R1.id]);
        else if (op === "w" && ev === "C") {
          // expectedRevision 1 was sent; another session may have written first.
          if (server.revision === 1) {
            server = { ...server, resourceIds: [R1.id], revision: 2 };
            committed = true;
          }
        } else if (op === "w" && ev === "P") response = server;
        else if (op === "w" && ev === "R") {
          if (committed) h.calls.setResources[0].d.resolve({ unit: response as TeacherUnit, noop: false });
          else h.calls.setResources[0].d.reject({ details: { code: "teacherUnits.writeConflict" } });
          await tick();
          if (!committed) {
            h.calls.get[0].d.resolve({ unit: server });
            await tick();
          }
          // Judge the message against the state accepted when it was made.
          msg = status(h.host);
          held = h.ctl.getKnownUnit(a.unitId);
        } else if (op === "x") {
          // Another session removes everything (only meaningful after the add).
          server = { ...server, resourceIds: [], revision: server.revision + 1 };
        } else if (op === "r" && ev === "D") {
          void h.ctl.refresh();
          refreshCall = lastList(h);
        } else if (op === "r" && ev === "X") listed = [server];
        else if (op === "r" && ev === "R") {
          (refreshCall as Call<{ units: TeacherUnit[] }>).d.resolve({ units: listed });
          await tick();
        }
      }
      const label = order.map((e) => e.op + e.ev).join(" ");
      expect([label, /Added 0/.test(msg)]).toEqual([label, false]);
      if (msg.startsWith("Added 1 resource")) expect([label, held?.resourceIds.includes(R1.id)]).toEqual([label, true]);
      if (msg.startsWith("Your addition was saved")) {
        expect([label, committed, held?.resourceIds.includes(R1.id)]).toEqual([label, true, false]);
      }
      if (committed) {
        // A committed add is always reported as saved, never as uncertain.
        expect([label, /^(Added 1 resource|Your addition was saved)/.test(msg)]).toEqual([label, true]);
      } else {
        expect([label, msg]).toEqual([label, ""]);
      }
    }
  });
});
