/**
 * @jest-environment jsdom
 *
 * U2.3 second-certification regressions (My Units panel).
 *
 * An independent harness: setResources, get, list, and update are manually
 * settled deferreds, so each test fixes the arrival order. Covers removal
 * and add announcements against the current authoritative state (P2), the
 * open Add picker when retired ids arrive (P2), and recovery hints using
 * the latest accepted title (P2).
 */
import { renderTeacherUnitsPanel } from "./teacherUnitsPanel";
import { createTeacherUnitCreateAttemptStore } from "../../teacherUnits/createAttemptStore";
import { createTeacherUnitsController, type TeacherUnitsController } from "../../teacherUnits/unitsController";
import { getPlaceableResources } from "../../teacherUnits/placeableResources";
import type { PersistedCreateAttempt, TeacherUnitCreateContext } from "../../teacherUnits/saveCoordination";
import type { TeacherUnit, TeacherUnitsCallables } from "../../teacherUnits/types";

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const FORMER = { teacherId: "teacherA", schoolId: "schoolB" };
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
  unitId: `Panel${String(++seq).padStart(15, "0")}`,
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
    update: [] as Array<Deferred<{ unit: TeacherUnit; noop: boolean }>>,
  };
  const queue = (k: keyof typeof calls) => () => {
    const d = deferred<unknown>();
    (calls[k] as unknown as Array<Deferred<unknown>>).push(d);
    return d.promise;
  };
  const c = {
    create: jest.fn(() => new Promise(() => undefined)),
    list: jest.fn(queue("list")),
    get: jest.fn(queue("get")),
    update: jest.fn(queue("update")),
    archive: jest.fn(),
    restore: jest.fn(),
    setResources: jest.fn(queue("setResources")),
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
  h.calls.list[0].resolve({ units });
  await tick();
  return { ...h, host, ctl };
}

const status = (host: HTMLElement) => q(host, "units-status")?.textContent ?? "";
const noticeOf = (host: HTMLElement, unitId: string) =>
  q(host, `units-card-${unitId}`)?.querySelector<HTMLElement>(":scope > .shell-units-notice") as HTMLElement;
const rowIds = (host: HTMLElement, unitId: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(`[data-testid="units-resource-list-${unitId}"] > li`)).map((r) =>
    r.getAttribute("data-resource-id"),
  );
const refresh = async (h: { ctl: TeacherUnitsController; calls: ReturnType<typeof scripted>["calls"] }, units: TeacherUnit[]) => {
  void h.ctl.refresh();
  h.calls.list[h.calls.list.length - 1].resolve({ units });
  await tick();
};

beforeEach(() => {
  document.body.textContent = "";
  window.localStorage.clear();
});

describe("P2: removal is announced only when the current state reflects it", () => {
  test("a removal confirmed after a newer state re-added the resource is not announced as removed", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    (q(h.host, `units-resource-remove-${a.unitId}-${R1.id}`) as HTMLButtonElement).click();
    expect(status(h.host)).toBe(`Removing "${R1.title}" from "${a.title}"...`);
    // Elsewhere: our removal committed (rev 2), then R1 was added back (rev 3).
    await refresh(h, [{ ...a, resourceIds: [R2.id, R1.id], revision: 3 }]);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R2.id], revision: 2 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(
      `Your removal was saved, but "${R1.title}" is in "${a.title}" again because this unit changed somewhere else. Its current resources are shown.`,
    );
    expect(status(h.host)).not.toContain("Removed");
    expect(q(h.host, "units-status")?.getAttribute("aria-live")).toBe("polite");
    expect(rowIds(h.host, a.unitId)).toEqual([R2.id, R1.id]);
    expect(h.c.setResources).toHaveBeenCalledTimes(1);
  });

  test("an ordinary removal is still announced as removed", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    (q(h.host, `units-resource-remove-${a.unitId}-${R1.id}`) as HTMLButtonElement).click();
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R2.id], revision: 2 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(`Removed "${R1.title}" from "${a.title}".`);
    expect(rowIds(h.host, a.unitId)).toEqual([R2.id]);
  });

  test("an older success arriving after the unit was renamed names the current title", async () => {
    const a = unit({ title: "Old Name", resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    (q(h.host, `units-resource-remove-${a.unitId}-${R1.id}`) as HTMLButtonElement).click();
    await refresh(h, [{ ...a, title: "New Name", resourceIds: [R2.id], revision: 3 }]);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R2.id], revision: 2 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(`Removed "${R1.title}" from "New Name".`);
  });

  test("an uncertain removal stays uncertain and is not retried", async () => {
    const a = unit({ resourceIds: [R1.id] });
    const h = await panel([a]);
    (q(h.host, `units-resource-remove-${a.unitId}-${R1.id}`) as HTMLButtonElement).click();
    h.calls.setResources[0].reject(Object.assign(new Error("lost"), { code: "unavailable" }));
    await tick();
    h.calls.get[0].resolve({ unit: a });
    await tick();
    expect(status(h.host)).toBe("");
    expect(noticeOf(h.host, a.unitId).textContent).toContain("couldn't confirm whether your change was saved");
    expect(rowIds(h.host, a.unitId)).toEqual([R1.id]);
    expect(h.c.setResources).toHaveBeenCalledTimes(1);
  });

  test("an add confirmed before a rename names the current title", async () => {
    const a = unit({ title: "Old Name" });
    const h = await panel([a]);
    (q(h.host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    (q(h.host, `units-picker-option-${a.unitId}-${R1.id}`) as HTMLInputElement).click();
    (q(h.host, `units-picker-${a.unitId}`) as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await refresh(h, [{ ...a, title: "New Name", resourceIds: [R1.id], revision: 3 }]);
    h.calls.setResources[0].resolve({ unit: { ...a, resourceIds: [R1.id], revision: 2 }, noop: false });
    await tick();
    expect(status(h.host)).toBe(`Added 1 resource to "New Name".`);
  });
});

describe("P2: an open Add picker follows the current unit", () => {
  const openWithSelection = async (a: TeacherUnit, ctx?: () => TeacherUnitCreateContext | null) => {
    const h = await panel([a], ctx);
    (q(h.host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    const box = q(h.host, `units-picker-option-${a.unitId}-${R1.id}`) as HTMLInputElement;
    box.click();
    box.focus();
    const form = q(h.host, `units-picker-${a.unitId}`) as HTMLFormElement;
    expect((q(h.host, `units-picker-submit-${a.unitId}`) as HTMLButtonElement).disabled).toBe(false);
    return { ...h, form };
  };

  test("retired ids arriving close the picker, explain why, keep the repair, and move focus to it", async () => {
    const a = unit();
    const h = await openWithSelection(a);
    await refresh(h, [{ ...a, resourceIds: ["retired-x"], revision: 2 }]);
    expect(q(h.host, `units-picker-${a.unitId}`)).toBeNull();
    expect(h.form.isConnected).toBe(false);
    expect(noticeOf(h.host, a.unitId).hidden).toBe(false);
    expect(noticeOf(h.host, a.unitId).textContent).toBe(
      "Some resources in this unit are no longer available, so adding resources was closed. Remove the unavailable resources first, then add resources again.",
    );
    const repair = q(h.host, `units-retired-remove-${a.unitId}`) as HTMLButtonElement;
    expect(repair.disabled).toBe(false);
    expect(document.activeElement).toBe(repair);
    const add = q(h.host, `units-resources-add-${a.unitId}`) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    expect(add.getAttribute("aria-expanded")).toBe("false");
    // The detached form's stale submit sends nothing.
    h.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    expect(h.c.setResources).not.toHaveBeenCalled();
    // The bulk repair still works.
    repair.click();
    (q(h.host, `units-retired-confirm-${a.unitId}`) as HTMLButtonElement).click();
    expect(h.c.setResources).toHaveBeenCalledWith({ unitId: a.unitId, expectedRevision: 2, resourceIds: [] });
  });

  test("a unit archived elsewhere closes the open picker and moves focus out of it", async () => {
    const a = unit();
    const h = await openWithSelection(a);
    h.ctl.setShowArchived(true);
    h.calls.list[1].resolve({ units: [{ ...a, status: "archived", archivedAtMillis: 9, revision: 2 }] });
    await tick();
    expect(q(h.host, `units-picker-${a.unitId}`)).toBeNull();
    h.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    expect(h.c.setResources).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(q(h.host, `units-restore-${a.unitId}`));
  });

  test("after a school change the open picker sends nothing and announces nothing", async () => {
    const a = unit();
    let ctx: TeacherUnitCreateContext | null = SCOPE;
    const h = await openWithSelection(a, () => ctx);
    ctx = { teacherId: "teacherA", schoolId: "schoolB" };
    h.form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    expect(h.c.setResources).not.toHaveBeenCalled();
    expect(status(h.host)).toBe("");
  });
});

describe("P2: recovery hints use the latest accepted title", () => {
  const record = (scope: typeof SCOPE, key: string, title: string): PersistedCreateAttempt => ({
    key,
    payload: { grade: "7", title, description: "" },
    context: scope,
    status: "unresolved",
    reason: "replayExpired",
    createdAtMs: Date.now(),
  });

  test("a rename while Check my units is pending is reflected; a later refresh is too", async () => {
    expect(createTeacherUnitCreateAttemptStore(SCOPE).save(record(SCOPE, "key_OWN0001", "Plants"))).toBe("saved");
    expect(createTeacherUnitCreateAttemptStore(FORMER).save(record(FORMER, "key_FORMER01", "Plants"))).toBe("saved");
    const x = unit({ title: "Plants" });
    const h = await panel([x]);
    const item = () => q(h.host, "units-recovery-item-key_OWN0001") as HTMLElement;
    (q(h.host, "units-recovery-check") as HTMLButtonElement).click();
    const rename = h.ctl.updateUnit(x.unitId, { title: "Animals" });
    await tick();
    h.calls.update[0].resolve({ unit: { ...x, title: "Animals", revision: 2 }, noop: false });
    await rename;
    h.calls.list[1].resolve({ units: [x] }); // the check, sent before the rename
    await tick();
    expect(q(h.host, `units-card-${x.unitId}`)?.querySelector(".shell-units-card-title")?.textContent).toBe("Animals");
    expect(item().textContent).toContain(
      `No Grade 7 unit named "Plants" was found. It may still be finishing, so check again before creating it again.`,
    );
    expect(item().textContent).not.toContain("Found 1");
    // The follow-up load after the check, then a refresh with another title.
    h.calls.list[2].resolve({ units: [{ ...x, title: "Animals", revision: 2 }] });
    await tick();
    await refresh(h, [{ ...x, title: "Plants", revision: 3 }]);
    expect(item().textContent).toContain(`Found 1 Grade 7 unit named "Plants". Review it in your units.`);
    // The durable evidence is unchanged: the attempt's own title, and the
    // former-school notice as stored.
    expect(item().textContent).toContain(`"Plants" (Grade 7)`);
    expect(q(h.host, "units-former-school-item-0")?.textContent).toContain(`"Plants" (Grade 7)`);
  });
});
