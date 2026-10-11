/**
 * @jest-environment jsdom
 *
 * U2.3 sixth certification: outcome preservation and visibility-accurate
 * notices (independent harness, manually settled deferreds).
 *
 * B: outcomes of separate operations never erase one another: for
 *    different hidden units, for one unit across several operations, in
 *    either completion order; dismissal removes only the chosen notice.
 * C: a notice moved out of a card that leaves the list is reworded for
 *    where the unit now is; it never says its resources are "shown".
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
  unitId: `Out${String(++seq).padStart(17, "0")}`,
  grade: "7",
  title: "Plants",
  description: "",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: seq,
  updatedAtMillis: seq,
  resourceIds: [R1.id, R2.id],
  sortOrder: 0,
  revision: 1,
  ...over,
});
const archived = (u: TeacherUnit, revision: number): TeacherUnit => ({
  ...u,
  status: "archived",
  archivedAtMillis: 9,
  revision,
});

type Call<T> = { req: Record<string, unknown>; d: Deferred<T> };
function scripted() {
  const calls = {
    list: [] as Array<Call<{ units: TeacherUnit[] }>>,
    get: [] as Array<Call<{ unit: TeacherUnit }>>,
    setResources: [] as Array<Call<{ unit: TeacherUnit; noop: boolean }>>,
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
const checkWith = async (h: H, units: TeacherUnit[]) => {
  const p = h.ctl.checkRecovery();
  lastList(h).d.resolve({ units });
  await p;
  lastList(h).d.resolve({ units: units.filter((u) => u.status === "active") });
  await tick();
};
const clickRemove = (h: H, u: TeacherUnit, id: string) =>
  (q(h.host, `units-resource-remove-${u.unitId}-${id}`) as HTMLButtonElement).click();
const LOST = () => Object.assign(new Error("lost"), { code: "unavailable" });
const CONFLICT = () => ({ details: { code: "teacherUnits.writeConflict" } });
// Attached, visible elements of the panel outside the shared status region
// whose own text contains `text` (one per notice).
const notices = (h: H, text: string) =>
  Array.from(h.host.querySelectorAll<HTMLElement>("[role=alert], [role=status]")).filter(
    (e) =>
      e.isConnected &&
      !e.hidden &&
      e.getAttribute("data-testid") !== "units-status" &&
      (e.textContent ?? "").includes(text),
  );
// Confirmed removal written by the server (committed at revision `rev`).
const confirmRemove = async (h: H, i: number, u: TeacherUnit, ids: string[], rev: number) => {
  h.calls.setResources[i].d.resolve({ unit: { ...u, resourceIds: ids, revision: rev }, noop: false });
  await tick();
};
const lostThenRead = async (h: H, i: number, readAs: TeacherUnit) => {
  h.calls.setResources[i].d.reject(LOST());
  await tick();
  h.calls.get[h.calls.get.length - 1].d.resolve({ unit: readAs });
  await tick();
};

beforeEach(() => {
  document.body.textContent = "";
  window.localStorage.clear();
});

// ---------- B ----------

describe("B: outcomes of separate operations do not overwrite one another", () => {
  test.each([
    ["Plants first", false],
    ["Water first", true],
  ])("confirmed outcomes for two different hidden units both stay (%s)", async (_n, reversed) => {
    const a = unit({ title: "Plants" });
    const b = unit({ title: "Water" });
    const h = await panel([a, b]);
    clickRemove(h, a, R1.id);
    clickRemove(h, b, R1.id);
    // Both removals commit at revision 2, then both units are archived
    // elsewhere at revision 3 (hidden now).
    await checkWith(h, [archived({ ...a, resourceIds: [R2.id] }, 3), archived({ ...b, resourceIds: [R2.id] }, 3)]);
    const order: Array<[number, TeacherUnit]> = reversed ? [[1, b], [0, a]] : [[0, a], [1, b]];
    for (const [i, u] of order) await confirmRemove(h, i, u, [R2.id], 2);
    const msgA = `Removed "${R1.title}" from "Plants". "Plants" is archived.`;
    const msgB = `Removed "${R1.title}" from "Water". "Water" is archived.`;
    expect(notices(h, msgA)).toHaveLength(1);
    expect(notices(h, msgB)).toHaveLength(1);
    // The live region carries the latest; neither outcome is lost.
    expect(status(h.host)).toBe(reversed ? msgA : msgB);
  });

  test("one unit, two operations: a later confirmed operation keeps the earlier unresolved outcome", async () => {
    const a = unit();
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    await checkWith(h, [archived(a, 3)]);
    await lostThenRead(h, 0, archived(a, 3)); // op 1: uncertain while hidden
    expect(notices(h, "couldn't confirm whether your change was saved")).toHaveLength(1);
    await refreshWith(h, [{ ...a, revision: 4 }]); // restored elsewhere: visible again
    clickRemove(h, a, R2.id);
    await confirmRemove(h, 1, a, [R1.id], 5); // op 2: confirmed
    expect(status(h.host)).toBe(`Removed "${R2.title}" from "Plants".`);
    expect(notices(h, "couldn't confirm whether your change was saved")).toHaveLength(1);
  });

  test("one unit: a conflict notice moved out of its card keeps the earlier unresolved outcome", async () => {
    const a = unit();
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    await checkWith(h, [archived(a, 3)]);
    await lostThenRead(h, 0, archived(a, 3));
    await refreshWith(h, [{ ...a, revision: 4 }]);
    clickRemove(h, a, R2.id);
    h.calls.setResources[1].d.reject(CONFLICT());
    await tick();
    h.calls.get[1].d.resolve({ unit: { ...a, revision: 5 } });
    await tick();
    expect(notices(h, "nothing was removed")).toHaveLength(1);
    await refreshWith(h, []); // the card leaves; its notice moves
    expect(notices(h, "nothing was removed")).toHaveLength(1);
    expect(notices(h, "couldn't confirm whether your change was saved")).toHaveLength(1);
  });

  test("reversed completion across units: an unresolved and a confirmed outcome both stay", async () => {
    const a = unit({ title: "Plants" });
    const b = unit({ title: "Water" });
    const h = await panel([a, b]);
    clickRemove(h, a, R1.id);
    clickRemove(h, b, R1.id);
    await checkWith(h, [archived(a, 3), archived({ ...b, resourceIds: [R2.id] }, 3)]);
    await confirmRemove(h, 1, b, [R2.id], 2);
    await lostThenRead(h, 0, archived(a, 3));
    expect(notices(h, `from "Water"`)).toHaveLength(1);
    expect(notices(h, "couldn't confirm")).toHaveLength(1);
  });

  test("dismissing one notice removes only that notice and keeps focus in the panel", async () => {
    const a = unit({ title: "Plants" });
    const b = unit({ title: "Water" });
    const h = await panel([a, b]);
    clickRemove(h, a, R1.id);
    clickRemove(h, b, R1.id);
    await checkWith(h, [archived(a, 3), archived(b, 3)]);
    await lostThenRead(h, 0, archived(a, 3));
    await lostThenRead(h, 1, archived(b, 3));
    const plants = notices(h, `"Plants"`).filter((e) => e.getAttribute("role") === "alert");
    expect(plants).toHaveLength(1);
    (plants[0].querySelector("button") as HTMLButtonElement).click();
    expect(notices(h, `"Plants"`).filter((e) => e.getAttribute("role") === "alert")).toHaveLength(0);
    expect(notices(h, `"Water"`).filter((e) => e.getAttribute("role") === "alert")).toHaveLength(1);
    expect(h.host.contains(document.activeElement)).toBe(true);
  });
});

// ---------- C ----------

describe("C: a moved notice is reworded for where the unit is now", () => {
  async function visibleConflict() {
    const a = unit({ title: "Plants" });
    const b = unit({ title: "Water" });
    const h = await panel([a, b]);
    clickRemove(h, a, R1.id);
    h.calls.setResources[0].d.reject(CONFLICT());
    await tick();
    h.calls.get[0].d.resolve({ unit: { ...a, revision: 2 } });
    await tick();
    const inCard = notices(h, "nothing was removed");
    expect(inCard).toHaveLength(1);
    // While the card is shown, saying so is accurate.
    expect(inCard[0].textContent).toContain("Its current resources are shown.");
    return { h, a, b };
  }

  test("conflict, then archived elsewhere (hidden)", async () => {
    const { h, a, b } = await visibleConflict();
    await checkWith(h, [archived(a, 3), b]);
    const moved = notices(h, "nothing was removed");
    expect(moved).toHaveLength(1);
    expect(moved[0].textContent).not.toContain("Its current resources are shown");
    expect(moved[0].textContent).toContain(
      "This unit is archived, so it isn't shown. Turn on Show archived units to see its resources.",
    );
    expect(moved[0].textContent).toContain(`"Plants"`);
  });

  test("conflict, then found absent by a full check", async () => {
    const { h, b } = await visibleConflict();
    await checkWith(h, [b]);
    const moved = notices(h, "nothing was removed");
    expect(moved).toHaveLength(1);
    expect(moved[0].textContent).not.toContain("Its current resources are shown");
    expect(moved[0].textContent).toContain("This unit is no longer in your units.");
  });

  test("conflict, then omitted by a refresh", async () => {
    const { h, b } = await visibleConflict();
    await refreshWith(h, [b]);
    const moved = notices(h, "nothing was removed");
    expect(moved).toHaveLength(1);
    expect(moved[0].textContent).not.toContain("Its current resources are shown");
    expect(moved[0].textContent).toContain("This unit isn't in your current list. Refresh to see its resources.");
  });

  test("conflict moved while another unit's operation is pending; that operation's outcome is separate", async () => {
    const { h, a, b } = await visibleConflict();
    clickRemove(h, b, R1.id);
    expect(status(h.host)).toBe(`Removing "${R1.title}" from "Water"...`);
    await refreshWith(h, [b]);
    await confirmRemove(h, 1, b, [R2.id], 2);
    expect(status(h.host)).toBe(`Removed "${R1.title}" from "Water".`);
    const moved = notices(h, "nothing was removed");
    expect(moved).toHaveLength(1);
    expect(moved[0].textContent).not.toContain("Its current resources are shown");
    expect(a.unitId).toBeTruthy();
  });
});

describe("B: every completion order of three hidden-unit outcomes", () => {
  const perms = <T,>(xs: T[]): T[][] =>
    xs.length <= 1 ? [xs] : xs.flatMap((x, i) => perms([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));

  test("confirmed, unresolved, and conflict outcomes all stay, each once", async () => {
    for (const order of perms([0, 1, 2])) {
      document.body.textContent = "";
      const us = [unit({ title: "Plants" }), unit({ title: "Water" }), unit({ title: "Rocks" })];
      const h = await panel(us);
      for (const u of us) clickRemove(h, u, R1.id);
      await checkWith(h, [
        archived({ ...us[0], resourceIds: [R2.id] }, 3),
        archived(us[1], 3),
        archived(us[2], 3),
      ]);
      for (const i of order) {
        if (i === 0) await confirmRemove(h, 0, us[0], [R2.id], 2);
        else if (i === 1) await lostThenRead(h, 1, archived(us[1], 3));
        else {
          h.calls.setResources[2].d.reject(CONFLICT());
          await tick();
          h.calls.get[h.calls.get.length - 1].d.resolve({ unit: archived(us[2], 3) });
          await tick();
        }
      }
      const label = order.join(",");
      expect([label, notices(h, `Removed "${R1.title}" from "Plants"`).length]).toEqual([label, 1]);
      expect([label, notices(h, `"Water": LyfeLabz couldn't confirm`).length]).toEqual([label, 1]);
      expect([label, notices(h, `"Rocks": This unit is archived, so nothing was removed`).length]).toEqual([label, 1]);
      expect([label, notices(h, "Its current resources are shown").length]).toEqual([label, 0]);
    }
  });
});
