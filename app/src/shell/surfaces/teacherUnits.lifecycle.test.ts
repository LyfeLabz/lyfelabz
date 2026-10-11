/**
 * @jest-environment jsdom
 *
 * U2.3 seventh certification: notice lifecycle (independent harness,
 * manually settled deferreds).
 *
 * A retained notice keeps its operation's historical outcome, but every
 * statement about where the unit is now (shown, archived and hidden,
 * outside the selected grade, no longer in the teacher's units) follows the
 * current accepted state and view, through archive, Show archived,
 * restoration, positive reads, absence, and grade changes. Automatic
 * eviction never strands keyboard focus.
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

const LOCATION_CLAIMS = {
  hidden: "isn't shown",
  archived: "is archived",
  absent: "no longer in your units",
  notInList: "isn't in your current list",
  shown: "Its current resources are shown",
} as const;
// Every retained notice (card notice or outcome entry) mentioning `text`.
const retained = (h: H, text: string) => notices(h, text);
// The single retained conflict notice for unit "Plants".
const plantsConflict = (h: H) => {
  const all = retained(h, "nothing was removed");
  expect(all).toHaveLength(1);
  return all[0];
};
const cardShown = (h: H, u: TeacherUnit) => q(h.host, `units-card-${u.unitId}`) !== null;
const toggleArchived = async (h: H, on: boolean, units: TeacherUnit[]) => {
  h.ctl.setShowArchived(on);
  lastList(h).d.resolve({ units });
  await tick();
};
const toGrade = async (h: H, g: "6" | "7", units: TeacherUnit[]) => {
  h.ctl.setGrade(g);
  lastList(h).d.resolve({ units });
  await tick();
};

// A conflict notice for "Plants" while its card is shown.
async function visibleConflict(extra: TeacherUnit[] = []) {
  const a = unit({ title: "Plants" });
  const h = await panel([a, ...extra]);
  clickRemove(h, a, R1.id);
  h.calls.setResources[0].d.reject(CONFLICT());
  await tick();
  h.calls.get[0].d.resolve({ unit: { ...a, revision: 2 } });
  await tick();
  expect(plantsConflict(h).textContent).toContain(LOCATION_CLAIMS.shown);
  return { h, a: { ...a, revision: 2 } };
}

describe("notice context follows the current state and view", () => {
  test("A+B: archived (hidden) -> Show archived (shown) -> restored by a positive read (active)", async () => {
    const { h, a } = await visibleConflict();
    const arch = archived(a, 3);
    await checkWith(h, [arch]); // archived elsewhere: hidden
    expect(cardShown(h, a)).toBe(false);
    let n = plantsConflict(h);
    const id = n.getAttribute("data-testid");
    expect(n.textContent).toContain(LOCATION_CLAIMS.archived);
    expect(n.textContent).toContain(LOCATION_CLAIMS.hidden);
    await toggleArchived(h, true, [arch]); // the card reappears
    expect(cardShown(h, a)).toBe(true);
    n = plantsConflict(h);
    expect(n.getAttribute("data-testid")).toBe(id); // same notice, not a new one
    expect(n.textContent).not.toContain(LOCATION_CLAIMS.hidden);
    await refreshWith(h, [{ ...a, revision: 4 }]); // restored elsewhere, read positively
    n = plantsConflict(h);
    expect(n.textContent).not.toContain(LOCATION_CLAIMS.archived);
    expect(n.textContent).not.toContain(LOCATION_CLAIMS.hidden);
    // The historical fact is unchanged throughout.
    expect(n.textContent).toContain("This unit changed somewhere else, so nothing was removed.");
  });

  test("C: authoritative absence, then positive evidence", async () => {
    const { h, a } = await visibleConflict();
    await checkWith(h, []);
    expect(plantsConflict(h).textContent).toContain(LOCATION_CLAIMS.absent);
    await checkWith(h, [{ ...a, revision: 4 }]);
    expect(cardShown(h, a)).toBe(true);
    const n = plantsConflict(h);
    expect(n.textContent).not.toContain(LOCATION_CLAIMS.absent);
    expect(n.textContent).not.toContain(LOCATION_CLAIMS.notInList);
  });

  test("D: away under the grade filter, then back", async () => {
    const { h, a } = await visibleConflict();
    await toGrade(h, "6", []);
    expect(cardShown(h, a)).toBe(false);
    let n = plantsConflict(h);
    expect(n.textContent).not.toContain(LOCATION_CLAIMS.shown);
    expect(n.textContent).not.toContain(LOCATION_CLAIMS.absent);
    expect(n.textContent).not.toContain(LOCATION_CLAIMS.archived);
    await toGrade(h, "7", [a]);
    expect(cardShown(h, a)).toBe(true);
    n = plantsConflict(h);
    expect(n.textContent).not.toContain(LOCATION_CLAIMS.hidden);
    expect(n.textContent).not.toContain(LOCATION_CLAIMS.notInList);
  });

  test("E: two retained notices for one unit both follow it", async () => {
    const a = unit({ title: "Plants" });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    await checkWith(h, [archived(a, 3)]);
    await lostThenRead(h, 0, archived(a, 3)); // notice 1: unresolved, hidden
    await toggleArchived(h, true, [archived(a, 3)]);
    await refreshWith(h, [{ ...a, revision: 4 }]); // active again
    await toggleArchived(h, false, [{ ...a, revision: 4 }]);
    clickRemove(h, a, R2.id);
    h.calls.setResources[1].d.reject(CONFLICT());
    await tick();
    h.calls.get[1].d.resolve({ unit: { ...a, revision: 5 } });
    await tick(); // notice 2: conflict in the card
    await checkWith(h, [archived(a, 6)]); // archived again: both hidden
    const both = [...retained(h, "couldn't confirm"), ...retained(h, "nothing was removed")];
    expect(both).toHaveLength(2);
    for (const n of both) expect(n.textContent).toContain(LOCATION_CLAIMS.archived);
    await toggleArchived(h, true, [archived(a, 6)]);
    for (const n of [...retained(h, "couldn't confirm"), ...retained(h, "nothing was removed")]) {
      expect(n.textContent).not.toContain(LOCATION_CLAIMS.hidden);
    }
  });

  test("F: units in different states are worded independently", async () => {
    const b = unit({ title: "Water" });
    const { h, a } = await visibleConflict([b]);
    clickRemove(h, b, R1.id);
    h.calls.setResources[1].d.reject(CONFLICT());
    await tick();
    h.calls.get[1].d.resolve({ unit: { ...b, revision: 2 } });
    await tick();
    await checkWith(h, [archived(a, 3), { ...b, revision: 2 }]);
    const [pn] = retained(h, `"Plants"`).filter((e) => (e.textContent ?? "").includes("nothing was removed"));
    expect(pn.textContent).toContain(LOCATION_CLAIMS.archived);
    const wn = retained(h, "nothing was removed").filter((e) => !(e.textContent ?? "").includes(`"Plants"`));
    expect(wn).toHaveLength(1);
    expect(wn[0].textContent).toContain(LOCATION_CLAIMS.shown);
    expect(wn[0].textContent).not.toContain(LOCATION_CLAIMS.archived);
  });

  test("hidden-unit confirmations follow the unit too", async () => {
    const a = unit({ title: "Plants" });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    await checkWith(h, [archived({ ...a, resourceIds: [R2.id] }, 3)]);
    await confirmRemove(h, 0, a, [R2.id], 2);
    let [c] = retained(h, `Removed "${R1.title}" from "Plants"`);
    expect(c.textContent).toContain(LOCATION_CLAIMS.archived);
    await refreshWith(h, [{ ...a, resourceIds: [R2.id], revision: 4 }]); // restored
    [c] = retained(h, `Removed "${R1.title}" from "Plants"`);
    expect(c.textContent).not.toContain(LOCATION_CLAIMS.archived);
  });

  test("G: dismissal after the wording changed removes only that notice", async () => {
    const b = unit({ title: "Water" });
    const { h, a } = await visibleConflict([b]);
    clickRemove(h, b, R1.id);
    h.calls.setResources[1].d.reject(CONFLICT());
    await tick();
    h.calls.get[1].d.resolve({ unit: { ...b, revision: 2 } });
    await tick();
    await checkWith(h, [archived(a, 3), archived(b, 3)]);
    await toggleArchived(h, true, [archived(a, 3), archived(b, 3)]);
    await toggleArchived(h, false, []);
    const plants = retained(h, "nothing was removed").find((e) => (e.textContent ?? "").includes(`"Plants"`)) as HTMLElement;
    expect(plants.textContent).toContain(LOCATION_CLAIMS.archived);
    (plants.querySelector("button") as HTMLButtonElement).click();
    const left = retained(h, "nothing was removed");
    expect(left).toHaveLength(1);
    expect(left[0].textContent).toContain(`"Water"`);
  });
});

describe("automatic eviction keeps keyboard focus in the panel", () => {
  test("the focused oldest confirmation is evicted: focus moves to a remaining notice", async () => {
    const us = Array.from({ length: 9 }, (_, i) => unit({ title: `Unit ${i + 1}` }));
    const h = await panel(us);
    for (const u of us) clickRemove(h, u, R1.id);
    await checkWith(h, us.map((u) => archived({ ...u, resourceIds: [R2.id] }, 3)));
    for (let i = 0; i < 8; i++) await confirmRemove(h, i, us[i], [R2.id], 2);
    const oldest = retained(h, `from "Unit 1"`).find((e) => e.getAttribute("role") === "status") as HTMLElement;
    (oldest.querySelector("button") as HTMLButtonElement).focus();
    expect(document.activeElement?.textContent).toBe("Dismiss");
    await confirmRemove(h, 8, us[8], [R2.id], 2); // the ninth evicts the oldest
    expect(retained(h, `from "Unit 1"`).filter((e) => e.getAttribute("role") === "status")).toHaveLength(0);
    expect(document.activeElement).not.toBe(document.body);
    expect(h.host.contains(document.activeElement)).toBe(true);
  });
});
