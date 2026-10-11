/**
 * @jest-environment jsdom
 *
 * U2.3 eighth certification: archive-refusal notices. The historical fact
 * (the removal was refused and nothing was removed, because the unit was
 * archived when it was checked) stays; whether the unit is archived now,
 * and whether Restore is the next step, follows the current state.
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


beforeEach(() => {
  document.body.textContent = "";
  window.localStorage.clear();
});

const INVALID = () => ({ details: { code: "teacherUnits.invalidStatus" } });
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
const refusal = (h: H) => {
  const all = notices(h, "nothing was removed");
  expect(all).toHaveLength(1);
  return all[0];
};
// Remove -> invalidStatus -> reconciliation get says archived.
async function archiveRefusal(extra: TeacherUnit[] = []) {
  const a = unit({ title: "Plants" });
  const h = await panel([a, ...extra]);
  clickRemove(h, a, R1.id);
  h.calls.setResources[0].d.reject(INVALID());
  await tick();
  const arch = archived(a, 2);
  h.calls.get[0].d.resolve({ unit: arch });
  await tick();
  const n = refusal(h);
  expect(n.textContent).toContain("nothing was removed");
  expect(n.textContent).toContain("Restore");
  return { h, a, arch, active: { ...a, revision: 3 } };
}
const STALE = ["Restore it", "is archived", "Restore the unit"];
const expectNotArchivedClaims = (n: HTMLElement) => {
  for (const t of STALE) expect(n.textContent).not.toContain(t);
  expect(n.textContent).toContain("nothing was removed");
};

describe("archive-refusal notices follow the unit's current state", () => {
  test("A: a later positive active list", async () => {
    const { h, a, active } = await archiveRefusal();
    const id = refusal(h).getAttribute("data-testid");
    await refreshWith(h, [active]);
    expect(q(h.host, `units-card-${a.unitId}`)).not.toBeNull();
    const n = refusal(h);
    expect(n.getAttribute("data-testid")).toBe(id);
    expectNotArchivedClaims(n);
  });

  test("B: Show archived on (still archived), then active", async () => {
    const { h, arch, active } = await archiveRefusal();
    await toggleArchived(h, true, [arch]);
    expect(refusal(h).textContent).toContain("Restore");
    expect(refusal(h).textContent).not.toContain("isn't shown");
    await refreshWith(h, [active]);
    expectNotArchivedClaims(refusal(h));
    await toggleArchived(h, false, [active]);
    expectNotArchivedClaims(refusal(h));
  });

  test("C: active, then Grade 6, then Grade 7", async () => {
    const { h, active } = await archiveRefusal();
    await refreshWith(h, [active]);
    await toGrade(h, "6", []);
    let n = refusal(h);
    expectNotArchivedClaims(n);
    expect(n.textContent).not.toContain("no longer in your units");
    await toGrade(h, "7", [active]);
    n = refusal(h);
    expectNotArchivedClaims(n);
    expect(n.textContent).not.toContain("isn't shown");
  });

  test("D: several notices for one unit stay independent", async () => {
    const { h, a, active } = await archiveRefusal();
    await refreshWith(h, [active]);
    clickRemove(h, a, R2.id);
    h.calls.setResources[1].d.reject(CONFLICT());
    await tick();
    h.calls.get[1].d.resolve({ unit: { ...active, revision: 4 } });
    await tick();
    const all = notices(h, "nothing was removed");
    expect(all).toHaveLength(2);
    for (const n of all) for (const t of STALE) expect(n.textContent).not.toContain(t);
    await checkWith(h, [archived({ ...active, revision: 4 }, 5)]);
    const after = notices(h, "nothing was removed");
    expect(after).toHaveLength(2);
    for (const n of after) expect(n.textContent).toContain("archived");
  });

  test("E: then authoritative absence", async () => {
    const { h } = await archiveRefusal();
    await checkWith(h, []);
    const n = refusal(h);
    expect(n.textContent).toContain("no longer in your units");
    expect(n.textContent).not.toContain("Restore it");
    expect(n.textContent).not.toContain("Its current resources are shown");
  });

  test("F: a positive get restores the active state", async () => {
    const { h, a, active } = await archiveRefusal();
    // Make it actionable again first, then a conflict re-read (a get) brings the newer active record.
    await refreshWith(h, [active]);
    clickRemove(h, a, R1.id);
    h.calls.setResources[1].d.reject(CONFLICT());
    await tick();
    h.calls.get[1].d.resolve({ unit: { ...active, revision: 4 } });
    await tick();
    const all = notices(h, "nothing was removed");
    expect(all).toHaveLength(2);
    for (const n of all) for (const t of STALE) expect(n.textContent).not.toContain(t);
    expect(all.some((n) => (n.textContent ?? "").includes("This unit was archived, so nothing was removed."))).toBe(true);
  });

  test("dismissal still removes only that notice, and unchanged refreshes do not rewrite it", async () => {
    const { h, active } = await archiveRefusal();
    await refreshWith(h, [active]);
    const n = refusal(h);
    const p = n.querySelector("p") ?? n;
    let writes = 0;
    new MutationObserver(() => writes++).observe(p, { childList: true, characterData: true, subtree: true });
    await refreshWith(h, [active]);
    await refreshWith(h, [active]);
    await tick();
    expect(writes).toBe(0);
    const btn = n.querySelector("button");
    if (btn !== null) {
      btn.click();
      expect(notices(h, "nothing was removed")).toHaveLength(0);
    }
  });
});
