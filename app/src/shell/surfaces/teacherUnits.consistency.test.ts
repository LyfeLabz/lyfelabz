/**
 * @jest-environment jsdom
 *
 * U2.3 fourth certification: what membership messages may claim.
 *
 * An independent harness (manually settled deferreds). Each message must
 * follow from two pieces of evidence only: what the server response proves
 * (a write, or a no-op that wrote nothing) and what the latest accepted
 * state of the WHOLE unit holds now (active, archived, hidden, or no longer
 * known). A hidden card is never treated as proof of anything. Assertions
 * read the rendered live region and card alerts.
 */
import { renderTeacherUnitsPanel } from "./teacherUnitsPanel";
import { createTeacherUnitCreateAttemptStore } from "../../teacherUnits/createAttemptStore";
import { createTeacherUnitsController, type TeacherUnitsController } from "../../teacherUnits/unitsController";
import { getPlaceableResources } from "../../teacherUnits/placeableResources";
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
  unitId: `Msg${String(++seq).padStart(17, "0")}`,
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

function scripted() {
  const calls = {
    list: [] as Array<Deferred<{ units: TeacherUnit[] }>>,
    get: [] as Array<Deferred<{ unit: TeacherUnit }>>,
    setResources: [] as Array<Deferred<{ unit: TeacherUnit; noop: boolean }>>,
  };
  const queue = (k: keyof typeof calls) =>
    jest.fn(() => {
      const d = deferred<unknown>();
      (calls[k] as unknown as Array<Deferred<unknown>>).push(d);
      return d.promise;
    });
  const c = {
    create: jest.fn(),
    list: queue("list"),
    get: queue("get"),
    update: jest.fn(),
    archive: jest.fn(),
    restore: jest.fn(),
    setResources: queue("setResources"),
    reorder: jest.fn(),
  };
  return { c, calls };
}

async function panel(units: TeacherUnit[]) {
  const h = scripted();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ctl: TeacherUnitsController = createTeacherUnitsController({
    callables: h.c as unknown as TeacherUnitsCallables,
    session: SCOPE,
    readCurrentContext: () => SCOPE,
    store: createTeacherUnitCreateAttemptStore(SCOPE),
    initialGrade: "7",
  });
  renderTeacherUnitsPanel(host, ctl);
  h.calls.list[0].resolve({ units });
  await tick();
  return { ...h, host, ctl };
}
type H = Awaited<ReturnType<typeof panel>>;

const status = (host: HTMLElement) => q(host, "units-status")?.textContent ?? "";
const noticeOf = (host: HTMLElement, unitId: string) =>
  q(host, `units-card-${unitId}`)?.querySelector<HTMLElement>(":scope > .shell-units-notice") as HTMLElement;
const lastList = (h: H) => h.calls.list[h.calls.list.length - 1];
// A newer authoritative read: an active-grade refresh.
const refreshWith = async (h: H, units: TeacherUnit[]) => {
  void h.ctl.refresh();
  lastList(h).resolve({ units });
  await tick();
};
// A newer authoritative read of every unit, archived included.
const checkWith = async (h: H, units: TeacherUnit[]) => {
  const p = h.ctl.checkRecovery();
  lastList(h).resolve({ units });
  await p;
  lastList(h).resolve({ units: units.filter((u) => u.status === "active") }); // follow-up load
  await tick();
};
const clickRemove = (h: H, u: TeacherUnit, id: string) =>
  (q(h.host, `units-resource-remove-${u.unitId}-${id}`) as HTMLButtonElement).click();
const addVia = (h: H, u: TeacherUnit, id: string) => {
  (q(h.host, `units-resources-add-${u.unitId}`) as HTMLButtonElement).click();
  (q(h.host, `units-picker-option-${u.unitId}-${id}`) as HTMLInputElement).click();
  (q(h.host, `units-picker-${u.unitId}`) as HTMLFormElement).dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
};
const repairVia = (h: H, u: TeacherUnit) => {
  (q(h.host, `units-retired-remove-${u.unitId}`) as HTMLButtonElement).click();
  (q(h.host, `units-retired-confirm-${u.unitId}`) as HTMLButtonElement).click();
};

beforeEach(() => {
  document.body.textContent = "";
  window.localStorage.clear();
});

describe("Remove", () => {
  test("confirmed write, current state agrees", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R2.id], revision: 2 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(`Removed "${R1.title}" from "${a.title}".`);
    expect(q(h.host, "units-status")?.getAttribute("aria-live")).toBe("polite");
  });

  test("no-op: nothing is claimed as saved", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    // Removed elsewhere already: the server wrote nothing.
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R2.id], revision: 2 }, noop: true });
    await tick();
    expect(status(h.host)).toBe(`"${R1.title}" isn't in "${a.title}", so nothing was changed.`);
    expect(status(h.host)).not.toMatch(/saved|Removed/);
  });

  test("no-op, then a newer state re-added it: says nothing changed and that it is there now", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    await refreshWith(h, [{ ...a, resourceIds: [R2.id, R1.id], revision: 3 }]);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R2.id], revision: 2 }, noop: true });
    await tick();
    expect(status(h.host)).toBe(
      `Nothing was changed. "${R1.title}" is in "${a.title}" because this unit changed somewhere else. Its current resources are shown.`,
    );
  });

  test("confirmed write, then a concurrent re-add", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    await refreshWith(h, [{ ...a, resourceIds: [R2.id, R1.id], revision: 3 }]);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R2.id], revision: 2 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(
      `Your removal was saved, but "${R1.title}" is in "${a.title}" again because this unit changed somewhere else. Its current resources are shown.`,
    );
  });

  test("hidden archived unit that still holds the resource is never reported as removed", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    // Newer state: re-added and archived elsewhere (hidden: archived units are not shown).
    await checkWith(h, [{ ...a, resourceIds: [R2.id, R1.id], status: "archived", archivedAtMillis: 5, revision: 4 }]);
    expect(q(h.host, `units-card-${a.unitId}`)).toBeNull();
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R2.id], revision: 2 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(
      `Your removal was saved, but "${R1.title}" is in "${a.title}" again because this unit changed somewhere else. "${a.title}" is archived.`,
    );
    expect(status(h.host)).not.toContain("Removed");
  });

  test("hidden archived unit, no-op: nothing changed, and it is still there", async () => {
    const a = unit({ resourceIds: [R1.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    await checkWith(h, [{ ...a, status: "archived", archivedAtMillis: 5, revision: 4 }]);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [], revision: 2 }, noop: true });
    await tick();
    expect(status(h.host)).toBe(
      `Nothing was changed. "${R1.title}" is in "${a.title}" because this unit changed somewhere else. "${a.title}" is archived.`,
    );
  });

  test("no-op for a unit a newer read no longer finds: neutral, points to refresh", async () => {
    const a = unit({ resourceIds: [R1.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    await checkWith(h, []);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [], revision: 2 }, noop: true });
    await tick();
    expect(status(h.host)).toBe("Nothing was changed. Refresh to see this unit's current resources.");
  });

  test("missing unit: the refusal is shown, nothing claimed", async () => {
    const a = unit({ resourceIds: [R1.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    h.calls.setResources[0].reject({ details: { code: "teacherUnits.notFound" } });
    await tick();
    expect(status(h.host)).toBe("");
    expect(h.c.setResources).toHaveBeenCalledTimes(1);
  });

  test("conflict and uncertain outcomes are not success", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    h.calls.setResources[0].reject({ details: { code: "teacherUnits.writeConflict" } });
    await tick();
    h.calls.get[0].resolve({ unit: { ...a, revision: 2 } });
    await tick();
    expect(status(h.host)).toBe("");
    expect(noticeOf(h.host, a.unitId).textContent).toContain("nothing was removed");
    clickRemove(h, a, R1.id);
    h.calls.setResources[1].reject(Object.assign(new Error("lost"), { code: "unavailable" }));
    await tick();
    h.calls.get[1].resolve({ unit: { ...a, revision: 2 } });
    await tick();
    expect(status(h.host)).toBe("");
    expect(noticeOf(h.host, a.unitId).textContent).toContain("couldn't confirm whether your change was saved");
    expect(h.c.setResources).toHaveBeenCalledTimes(2);
  });
});

describe("Add", () => {
  test("confirmed write, current state agrees", async () => {
    const a = unit();
    const h = await panel([a]);
    addVia(h, a, R1.id);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R1.id], revision: 2 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(`Added 1 resource to "${a.title}".`);
  });

  test("confirmed write, then a concurrent removal: never claims the resource is there", async () => {
    const a = unit();
    const h = await panel([a]);
    addVia(h, a, R1.id);
    await refreshWith(h, [{ ...a, resourceIds: [], revision: 3 }]);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R1.id], revision: 2 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(
      `Your addition was saved, but "${a.title}" changed somewhere else since, so not every resource you added is in it now. Its current resources are shown.`,
    );
    expect(status(h.host)).not.toContain("Added");
  });

  test("no-op, current state agrees", async () => {
    const a = unit();
    const h = await panel([a]);
    addVia(h, a, R1.id);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R1.id], revision: 2 }, noop: true });
    await tick();
    expect(status(h.host)).toBe(`Those resources are already in "${a.title}", so nothing was changed.`);
  });

  test("no-op, but a newer state removed them: no presence claim", async () => {
    const a = unit();
    const h = await panel([a]);
    addVia(h, a, R1.id);
    await refreshWith(h, [{ ...a, resourceIds: [], revision: 3 }]);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R1.id], revision: 2 }, noop: true });
    await tick();
    expect(status(h.host)).toBe(
      `Nothing was changed. "${a.title}" changed somewhere else since, so not every resource you chose is in it now. Its current resources are shown.`,
    );
    expect(status(h.host)).not.toContain("already");
  });

  test("a confirmed add to a unit archived since: says it is archived", async () => {
    const a = unit();
    const h = await panel([a]);
    addVia(h, a, R1.id);
    await checkWith(h, [{ ...a, resourceIds: [R1.id], status: "archived", archivedAtMillis: 5, revision: 3 }]);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R1.id], revision: 2 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(`Added 1 resource to "${a.title}". "${a.title}" is archived.`);
  });
});

describe("Remove unavailable resources (bulk repair)", () => {
  test("confirmed write", async () => {
    const a = unit({ resourceIds: ["retired-a", R1.id] });
    const h = await panel([a]);
    repairVia(h, a);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R1.id], revision: 2 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(`Removed 1 unavailable resource from "${a.title}".`);
  });

  test("no-op: nothing is claimed as saved", async () => {
    const a = unit({ resourceIds: ["retired-a", R1.id] });
    const h = await panel([a]);
    repairVia(h, a);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R1.id], revision: 2 }, noop: true });
    await tick();
    expect(status(h.host)).toBe(`"${a.title}" has no unavailable resources, so nothing was changed.`);
  });

  test("no-op for a unit a newer read no longer finds: neutral", async () => {
    const a = unit({ resourceIds: ["retired-a"] });
    const h = await panel([a]);
    repairVia(h, a);
    await checkWith(h, []);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [], revision: 2 }, noop: true });
    await tick();
    expect(status(h.host)).toBe("Nothing was changed. Refresh to see this unit's current resources.");
  });

  test("uncertain: never stated as removed, no retry", async () => {
    const a = unit({ resourceIds: ["retired-a"] });
    const h = await panel([a]);
    repairVia(h, a);
    h.calls.setResources[0].reject(Object.assign(new Error("lost"), { code: "unavailable" }));
    await tick();
    h.calls.get[0].resolve({ unit: a });
    await tick();
    expect(status(h.host)).toBe("");
    expect(noticeOf(h.host, a.unitId).textContent).toContain("couldn't confirm whether your change was saved");
    expect(h.c.setResources).toHaveBeenCalledTimes(1);
  });
});
