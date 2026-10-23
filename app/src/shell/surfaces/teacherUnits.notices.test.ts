/**
 * @jest-environment jsdom
 *
 * U2.3 ninth certification: notice fidelity. A retained notice keeps its
 * operation's historical fact, but nothing it says about the unit now (its
 * name and description, whether it still holds unavailable resources,
 * whether the account can make changes) may be a value fixed when the
 * operation settled:
 * A. an edit conflict never labels an older name or description "current";
 * B. a retired-resource notice never asks for a repair the latest accepted
 *    state no longer needs, or for any edit of an absent unit;
 * C. an authorization refusal never claims the account can't make changes
 *    now (a later write may have succeeded) nor that it can (one success
 *    or a read proves nothing about the next request).
 */
import { renderTeacherUnitsPanel } from "./teacherUnitsPanel";
// These suites exercise an open unit; collapse is covered by teacherUnits.compact.test.ts.
const EXPANDED = { unitsInitiallyExpanded: true } as const;
import { createTeacherUnitCreateAttemptStore } from "../../teacherUnits/createAttemptStore";
import { createTeacherUnitsController, type TeacherUnitsController } from "../../teacherUnits/unitsController";
import { getPlaceableResources } from "../../teacherUnits/placeableResources";
import type { TeacherUnit, TeacherUnitsCallables } from "../../teacherUnits/types";
import type { TeacherUnitCreateContext } from "../../teacherUnits/saveCoordination";

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
  unitId: `Ntc${String(++seq).padStart(17, "0")}`,
  grade: "7",
  title: "Plants",
  description: "Original description",
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

type Mut = { unit: TeacherUnit; noop: boolean };
type Call<T> = { req: Record<string, unknown>; d: Deferred<T> };
function scripted() {
  const calls = {
    list: [] as Array<Call<{ units: TeacherUnit[] }>>,
    get: [] as Array<Call<{ unit: TeacherUnit }>>,
    update: [] as Array<Call<Mut>>,
    archive: [] as Array<Call<Mut>>,
    restore: [] as Array<Call<Mut>>,
    setResources: [] as Array<Call<Mut>>,
  };
  const queue = (k: keyof typeof calls) =>
    jest.fn((req: Record<string, unknown>) => {
      const d = deferred<unknown>();
      (calls[k] as unknown as Array<Call<unknown>>).push({ req, d });
      return d.promise;
    });
  const c = {
    create: jest.fn(() => Promise.reject(Object.assign(new Error("lost"), { code: "unavailable" }))),
    list: queue("list"),
    get: queue("get"),
    update: queue("update"),
    archive: queue("archive"),
    restore: queue("restore"),
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
  renderTeacherUnitsPanel(host, ctl, EXPANDED);
  h.calls.list[0].d.resolve({ units });
  await tick();
  return { ...h, host, ctl };
}
type H = Awaited<ReturnType<typeof panel>>;

const last = <T>(xs: T[]): T => xs[xs.length - 1];
const refreshWith = async (h: H, units: TeacherUnit[]) => {
  void h.ctl.refresh();
  last(h.calls.list).d.resolve({ units });
  await tick();
};
// Check my units: a list of every grade with archived units (authoritative
// absence for anything it omits), then the reload of the current view.
const checkWith = async (h: H, units: TeacherUnit[]) => {
  const p = h.ctl.checkRecovery();
  last(h.calls.list).d.resolve({ units });
  await p;
  last(h.calls.list).d.resolve({ units: units.filter((u) => u.status === "active") });
  await tick();
};
const toggleArchived = async (h: H, on: boolean, units: TeacherUnit[]) => {
  h.ctl.setShowArchived(on);
  last(h.calls.list).d.resolve({ units });
  await tick();
};
const toGrade = async (h: H, g: "6" | "7", units: TeacherUnit[]) => {
  h.ctl.setGrade(g);
  last(h.calls.list).d.resolve({ units });
  await tick();
};
const CONFLICT = () => ({ details: { code: "teacherUnits.writeConflict" } });
const DENIED = () => ({ code: "functions/permission-denied", details: { code: "permission-denied" } });
const NOT_PLACEABLE = (ids: string[]) => ({ details: { code: "teacherUnits.resourceNotPlaceable", resourceIds: ids } });

// Every visible notice (card notice or outcome entry) outside the shared
// status region whose text contains `text`.
const notices = (h: H, text: string) =>
  Array.from(h.host.querySelectorAll<HTMLElement>("[role=alert], [role=status]")).filter(
    (e) =>
      e.isConnected &&
      !e.hidden &&
      e.getAttribute("data-testid") !== "units-status" &&
      (e.textContent ?? "").includes(text),
  );
const one = (h: H, text: string): HTMLElement => {
  const found = notices(h, text);
  expect(found).toHaveLength(1);
  return found[0];
};
const cardNotice = (h: H, u: TeacherUnit) =>
  q(h.host, `units-card-${u.unitId}`)?.querySelector<HTMLElement>(":scope > p.shell-units-notice") ?? null;
// The unit's visible notices, found by identity rather than wording: its
// card notice when shown, plus its entries in the outcome region.
const noticesFor = (h: H, u: TeacherUnit): HTMLElement[] => {
  const card = cardNotice(h, u);
  return [
    ...(card !== null && !card.hidden ? [card] : []),
    ...Array.from(
      h.host.querySelectorAll<HTMLElement>(`[data-testid="units-outcomes"] [data-unit-id="${u.unitId}"]`),
    ),
  ];
};

const editTitle = async (h: H, u: TeacherUnit, title: string) => {
  (q(h.host, `units-edit-${u.unitId}`) as HTMLButtonElement).click();
  const input = q(h.host, `units-edit-title-${u.unitId}`) as HTMLInputElement;
  input.value = title;
  input.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await tick();
};
// An edit refused for a revision conflict, reconciled by reading `theirs`.
const editConflict = async (h: H, u: TeacherUnit, theirs: TeacherUnit) => {
  await editTitle(h, u, "My draft");
  last(h.calls.update).d.reject(CONFLICT());
  await tick();
  last(h.calls.get).d.resolve({ unit: theirs });
  await tick();
};
const clickRemove = (h: H, u: TeacherUnit, id: string) =>
  (q(h.host, `units-resource-remove-${u.unitId}-${id}`) as HTMLButtonElement).click();

beforeEach(() => {
  document.body.textContent = "";
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// A. Edit-conflict snapshot fidelity
// ---------------------------------------------------------------------------
describe("A: an edit conflict never labels an older name or description current", () => {
  const CONFLICT_TEXT = "changed since it was loaded here";

  test("the reconciled values are shown while they are the latest accepted record", async () => {
    const a = unit({ revision: 2 });
    const h = await panel([a]);
    await editConflict(h, a, { ...a, title: "Theirs", description: "Their description", revision: 3 });
    const n = one(h, CONFLICT_TEXT);
    expect(n.textContent).toContain('"Theirs"');
    expect(n.textContent).toContain('"Their description"');
    expect(n.textContent).toContain("Your edits are still here");
  });

  test("conflict followed by a rename (positive list): the newer name, never the older one", async () => {
    const a = unit({ revision: 2 });
    const h = await panel([a]);
    await editConflict(h, a, { ...a, title: "Theirs", revision: 3 });
    await refreshWith(h, [{ ...a, title: "Renamed", revision: 4 }]);
    const n = one(h, CONFLICT_TEXT);
    expect(n.textContent).toContain('"Renamed"');
    expect(n.textContent).not.toContain('"Theirs"');
  });

  test("conflict followed by a description change (positive get)", async () => {
    const a = unit({ revision: 2 });
    const b = unit({ title: "Rocks", revision: 1 });
    const h = await panel([a, b]);
    await editConflict(h, a, { ...a, description: "Their description", revision: 3 });
    // A second conflict on the same unit is reconciled by a get (positive
    // read) that returns a newer description; the edit is retried and
    // refused again, so the notice is the second conflict's. Its values must
    // be the latest the get returned.
    (q(h.host, `units-edit-title-${a.unitId}`) as HTMLInputElement).form?.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await tick();
    last(h.calls.update).d.reject(CONFLICT());
    await tick();
    last(h.calls.get).d.resolve({ unit: { ...a, description: "Newest description", revision: 5 } });
    await tick();
    const n = one(h, CONFLICT_TEXT);
    expect(n.textContent).toContain('"Newest description"');
    expect(n.textContent).not.toContain('"Their description"');
  });

  test("a retained conflict follows a later positive get made for another operation", async () => {
    const a = unit({ revision: 2 });
    const h = await panel([a]);
    await editConflict(h, a, { ...a, description: "Their description", revision: 3 });
    // Cancel would clear the notice; instead the editor stays open and the
    // unit is read again positively through an archive refusal elsewhere is
    // not possible while editing, so read it via the gate: an active-only
    // omission, then a mutation, makes the controller read (never send).
    await refreshWith(h, []);
    expect(q(h.host, `units-card-${a.unitId}`)).not.toBeNull(); // pinned by its editor
    void h.ctl.archiveUnit(a.unitId);
    await tick();
    last(h.calls.get).d.resolve({ unit: { ...a, description: "Read since", revision: 6 } });
    await tick();
    const n = one(h, CONFLICT_TEXT);
    expect(n.textContent).toContain('"Read since"');
    expect(n.textContent).not.toContain('"Their description"');
    expect(h.calls.archive).toHaveLength(0);
  });

  test("conflict followed by an archive: no save-again instruction while archived", async () => {
    const a = unit({ revision: 2 });
    const h = await panel([a]);
    await editConflict(h, a, { ...a, title: "Theirs", revision: 3 });
    await checkWith(h, [archived({ ...a, title: "Theirs" }, 4)]);
    const n = one(h, CONFLICT_TEXT);
    expect(n.textContent).toContain("archived");
    expect(n.textContent).not.toContain("save again");
  });

  test("conflict followed by authoritative absence: no name or description is claimed", async () => {
    const a = unit({ revision: 2 });
    const h = await panel([a]);
    await editConflict(h, a, { ...a, title: "Theirs", description: "Their description", revision: 3 });
    await checkWith(h, []);
    const n = one(h, CONFLICT_TEXT);
    expect(n.textContent).not.toContain('"Theirs"');
    expect(n.textContent).not.toContain("Their description");
    expect(n.textContent).toContain("no longer in your units");
    expect(n.textContent).not.toContain("save again");
  });

  test("absence then a positive list: the values come back from the newer record", async () => {
    const a = unit({ revision: 2 });
    const h = await panel([a]);
    await editConflict(h, a, { ...a, title: "Theirs", revision: 3 });
    await checkWith(h, []);
    await refreshWith(h, [{ ...a, title: "Back again", revision: 7 }]);
    const n = one(h, CONFLICT_TEXT);
    expect(n.textContent).toContain('"Back again"');
    expect(n.textContent).not.toContain('"Theirs"');
    expect(n.textContent).not.toContain("no longer in your units");
  });

  test("reversed refresh and reconciliation: whichever arrives last, the newest record is named", async () => {
    for (const order of ["refresh-last", "reread-last"] as const) {
      document.body.textContent = "";
      const a = unit({ revision: 2 });
      const h = await panel([a]);
      await editTitle(h, a, "My draft");
      void h.ctl.refresh();
      const list = last(h.calls.list);
      last(h.calls.update).d.reject(CONFLICT());
      await tick();
      const get = last(h.calls.get);
      if (order === "refresh-last") {
        get.d.resolve({ unit: { ...a, title: "Older read", revision: 3 } });
        await tick();
        list.d.resolve({ units: [{ ...a, title: "Newer list", revision: 4 }] });
      } else {
        list.d.resolve({ units: [{ ...a, title: "Newer list", revision: 4 }] });
        await tick();
        get.d.resolve({ unit: { ...a, title: "Older read", revision: 3 } });
      }
      await tick();
      const n = one(h, CONFLICT_TEXT);
      expect(n.textContent).toContain('"Newer list"');
      expect(n.textContent).not.toContain('"Older read"');
    }
  });

  test("multiple retained conflict notices each follow their own unit", async () => {
    const a = unit({ title: "Plants", revision: 2 });
    const b = unit({ title: "Rocks", revision: 2 });
    const h = await panel([a, b]);
    await editConflict(h, a, { ...a, title: "Plants theirs", revision: 3 });
    await editConflict(h, b, { ...b, title: "Rocks theirs", revision: 3 });
    await refreshWith(h, [
      { ...a, title: "Plants newest", revision: 4 },
      { ...b, title: "Rocks theirs", revision: 3 },
    ]);
    const na = cardNotice(h, a) as HTMLElement;
    const nb = cardNotice(h, b) as HTMLElement;
    expect(na.textContent).toContain('"Plants newest"');
    expect(na.textContent).not.toContain('"Plants theirs"');
    expect(nb.textContent).toContain('"Rocks theirs"');
    expect(notices(h, CONFLICT_TEXT)).toHaveLength(2);
  });

  test("grade-filter changes keep the latest values and say where the unit is", async () => {
    const a = unit({ revision: 2 });
    const h = await panel([a]);
    await editConflict(h, a, { ...a, title: "Theirs", revision: 3 });
    await toGrade(h, "6", []);
    let n = one(h, CONFLICT_TEXT);
    expect(n.textContent).toContain("Grade 7 unit");
    expect(n.textContent).toContain('"Theirs"');
    await toGrade(h, "7", [{ ...a, title: "Renamed in 7", revision: 5 }]);
    n = one(h, CONFLICT_TEXT);
    expect(n.textContent).toContain('"Renamed in 7"');
    expect(n.textContent).not.toContain("Grade 7 unit");
  });

  test("a conflict whose latest version couldn't be loaded uses a newer record read later", async () => {
    const a = unit({ revision: 2 });
    const h = await panel([a]);
    await editTitle(h, a, "My draft");
    last(h.calls.update).d.reject(CONFLICT());
    await tick();
    last(h.calls.get).d.reject(Object.assign(new Error("x"), { code: "unavailable" }));
    await tick();
    expect(one(h, CONFLICT_TEXT).textContent).toContain("couldn't be loaded");
    // The held record is the pre-conflict one: it is never named as current.
    expect(one(h, CONFLICT_TEXT).textContent).not.toContain('"Plants"');
    await refreshWith(h, [{ ...a, title: "Loaded later", revision: 4 }]);
    const n = one(h, CONFLICT_TEXT);
    expect(n.textContent).toContain('"Loaded later"');
    expect(n.textContent).not.toMatch(/Refresh, then try again|Refresh units, then try again/);
  });

  test("an archive refused for a conflict (no editor) never mentions edits", async () => {
    const a = unit({ revision: 2 });
    const h = await panel([a]);
    (q(h.host, `units-archive-${a.unitId}`) as HTMLButtonElement).click();
    await tick();
    last(h.calls.archive).d.reject(CONFLICT());
    await tick();
    last(h.calls.get).d.resolve({ unit: { ...a, title: "Theirs", revision: 3 } });
    await tick();
    const n = one(h, CONFLICT_TEXT);
    expect(n.textContent).not.toContain("Your edits");
    expect(n.textContent).toContain('"Theirs"');
  });
});

// ---------------------------------------------------------------------------
// B. Retired-resource notices
// ---------------------------------------------------------------------------
describe("B: retired-resource notices follow the latest accepted membership", () => {
  const CLOSED = "adding resources was closed";
  const REPAIR = "Remove the unavailable resources first";

  // Opens the picker, then a refresh delivers retired ids: the picker closes
  // with its notice.
  const closedByRetired = async (a: TeacherUnit, retired: string[]) => {
    const h = await panel([a]);
    (q(h.host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    await refreshWith(h, [{ ...a, resourceIds: [...retired, R1.id], revision: 2 }]);
    expect(q(h.host, `units-picker-${a.unitId}`)).toBeNull();
    expect(one(h, CLOSED).textContent).toContain(REPAIR);
    return h;
  };

  test("complete repair in another session (positive list): no repair instruction remains", async () => {
    const a = unit();
    const h = await closedByRetired(a, ["retired-x", "retired-y"]);
    await refreshWith(h, [{ ...a, resourceIds: [R1.id], revision: 3 }]);
    expect(q(h.host, `units-retired-${a.unitId}`)).toBeNull();
    const n = one(h, CLOSED);
    expect(n.textContent).not.toContain(REPAIR);
    expect(n.textContent).not.toMatch(/are no longer available/);
    expect(n.textContent).not.toMatch(/repaired|were removed/i);
  });

  test("partial repair: the instruction stays while any unavailable resource remains", async () => {
    const a = unit();
    const h = await closedByRetired(a, ["retired-x", "retired-y"]);
    await refreshWith(h, [{ ...a, resourceIds: ["retired-y", R1.id], revision: 3 }]);
    expect(one(h, CLOSED).textContent).toContain(REPAIR);
    await refreshWith(h, [{ ...a, resourceIds: [R1.id], revision: 4 }]);
    expect(one(h, CLOSED).textContent).not.toContain(REPAIR);
  });

  test("repair confirmed here clears the card notice (existing behavior)", async () => {
    const a = unit();
    const h = await closedByRetired(a, ["retired-x"]);
    (q(h.host, `units-retired-remove-${a.unitId}`) as HTMLButtonElement).click();
    (q(h.host, `units-retired-confirm-${a.unitId}`) as HTMLButtonElement).click();
    await tick();
    last(h.calls.setResources).d.resolve({ unit: { ...a, resourceIds: [R1.id], revision: 3 }, noop: false });
    await tick();
    expect(notices(h, CLOSED)).toHaveLength(0);
  });

  test("a notice moved out of its card follows a repair seen by a positive get", async () => {
    const a = unit();
    const h = await closedByRetired(a, ["retired-x"]);
    // Archived elsewhere and hidden: the notice moves to the outcome region.
    await refreshWith(h, []);
    expect(q(h.host, `units-card-${a.unitId}`)).toBeNull();
    // Shown again (archived), then a restore refused for a conflict reads
    // the unit: repaired and active.
    await toggleArchived(h, true, [archived({ ...a, resourceIds: ["retired-x", R1.id] }, 3)]);
    (q(h.host, `units-restore-${a.unitId}`) as HTMLButtonElement).click();
    await tick();
    last(h.calls.restore).d.reject(CONFLICT());
    await tick();
    last(h.calls.get).d.resolve({ unit: { ...a, resourceIds: [R1.id], revision: 5 } });
    await tick();
    const n = one(h, CLOSED);
    expect(n.getAttribute("data-testid")).toMatch(/^units-outcome-/);
    expect(n.textContent).not.toContain(REPAIR);
  });

  test("authoritative absence: never asks to edit the unit's resources", async () => {
    const a = unit();
    const h = await closedByRetired(a, ["retired-x"]);
    await checkWith(h, []);
    const n = one(h, CLOSED);
    expect(n.textContent).toContain("no longer in your units");
    expect(n.textContent).not.toContain(REPAIR);
    expect(n.textContent).not.toMatch(/add resources again/);
  });

  test("archive and restore: restore first while archived; repair again once active with retired ids", async () => {
    const a = unit();
    const h = await closedByRetired(a, ["retired-x"]);
    await toggleArchived(h, true, [archived({ ...a, resourceIds: ["retired-x", R1.id] }, 3)]);
    let n = one(h, CLOSED);
    expect(n.textContent).toContain("archived");
    expect(n.textContent).not.toContain(REPAIR);
    await refreshWith(h, [{ ...a, resourceIds: ["retired-x", R1.id], revision: 4 }]);
    n = one(h, CLOSED);
    expect(n.textContent).toContain(REPAIR);
    expect(n.textContent).not.toContain("archived");
  });

  test("grade filter: a hidden unit is never described as deleted, and the instruction follows its record", async () => {
    const a = unit();
    const h = await closedByRetired(a, ["retired-x"]);
    await toGrade(h, "6", []);
    let n = one(h, CLOSED);
    expect(n.textContent).toContain("Choose Grade 7 to see it");
    expect(n.textContent).not.toMatch(/no longer in your units|deleted/);
    expect(n.textContent).toContain(REPAIR);
    // Repaired elsewhere, seen by a full check (still a Grade 7 unit).
    await checkWith(h, [{ ...a, resourceIds: [R1.id], revision: 3 }]);
    n = one(h, CLOSED);
    expect(n.textContent).not.toContain(REPAIR);
    expect(n.textContent).toContain("Choose Grade 7 to see it");
  });

  test("a server refusal naming unavailable resources follows a later repair", async () => {
    const a = unit({ resourceIds: [R1.id] });
    const h = await panel([a]);
    (q(h.host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    (q(h.host, `units-picker-option-${a.unitId}-${R2.id}`) as HTMLInputElement).click();
    (q(h.host, `units-picker-${a.unitId}`) as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await tick();
    last(h.calls.setResources).d.reject(NOT_PLACEABLE(["retired-x"]));
    await tick();
    last(h.calls.get).d.resolve({ unit: { ...a, resourceIds: ["retired-x", R1.id], revision: 2 } });
    await tick();
    const REFUSED = "no longer";
    expect(notices(h, REFUSED).length).toBeGreaterThan(0);
    await refreshWith(h, [{ ...a, resourceIds: [R1.id], revision: 3 }]);
    for (const n of notices(h, "")) {
      expect(n.textContent).not.toMatch(/Remove them|Remove the unavailable resources first/);
    }
  });
});

// ---------------------------------------------------------------------------
// C. Authorization notices
// ---------------------------------------------------------------------------
describe("C: authorization notices are historical and never assert current access", () => {
  const NOW_DENIED = /can't make changes right now/;
  const NOW_ALLOWED = /you can make changes|now allowed|have access|full access/i;

  const refuseRemoval = async (h: H, u: TeacherUnit) => {
    refused = u;
    clickRemove(h, u, R1.id);
    await tick();
    last(h.calls.setResources).d.reject(DENIED());
    await tick();
  };
  // Unit A's one notice, by identity (the refusal is on A).
  let refused: TeacherUnit;
  const authNotice = (h: H): HTMLElement => {
    const found = noticesFor(h, refused);
    expect(found).toHaveLength(1);
    return found[0];
  };

  test("refusal followed by a successful membership write elsewhere", async () => {
    const a = unit({ title: "Plants" });
    const b = unit({ title: "Rocks" });
    const h = await panel([a, b]);
    await refuseRemoval(h, a);
    clickRemove(h, b, R1.id);
    await tick();
    last(h.calls.setResources).d.resolve({ unit: { ...b, resourceIds: [R2.id], revision: 2 }, noop: false });
    await tick();
    const n = authNotice(h);
    expect(n.textContent).not.toMatch(NOW_DENIED);
    expect(n.textContent).not.toMatch(NOW_ALLOWED);
    expect(q(h.host, "units-status")?.textContent).toContain('Removed "');
  });

  test("refusal followed by a successful edit elsewhere", async () => {
    const a = unit({ title: "Plants" });
    const b = unit({ title: "Rocks" });
    const h = await panel([a, b]);
    await refuseRemoval(h, a);
    await editTitle(h, b, "Rocks and minerals");
    last(h.calls.update).d.resolve({ unit: { ...b, title: "Rocks and minerals", revision: 2 }, noop: false });
    await tick();
    const n = authNotice(h);
    expect(n.textContent).not.toMatch(NOW_DENIED);
    expect(n.textContent).not.toMatch(NOW_ALLOWED);
  });

  test("an edit refused for authorization is worded historically too", async () => {
    const a = unit({ title: "Plants" });
    const h = await panel([a]);
    refused = a;
    await editTitle(h, a, "New name");
    last(h.calls.update).d.reject(DENIED());
    await tick();
    const n = authNotice(h);
    expect(n.textContent).not.toMatch(NOW_DENIED);
    expect(n.textContent).toContain("couldn't confirm whether");
  });

  test("refusal followed by a positive read only: no access is claimed either way", async () => {
    const a = unit({ title: "Plants" });
    const h = await panel([a]);
    await refuseRemoval(h, a);
    await refreshWith(h, [{ ...a }]);
    const n = authNotice(h);
    expect(n.textContent).not.toMatch(NOW_DENIED);
    expect(n.textContent).not.toMatch(NOW_ALLOWED);
  });

  test("refusal followed by unit absence: says where the unit is, never to check it in the list", async () => {
    const a = unit({ title: "Plants" });
    const h = await panel([a]);
    await refuseRemoval(h, a);
    await checkWith(h, []);
    const n = authNotice(h);
    expect(n.textContent).toContain("no longer in your units");
    expect(n.textContent).not.toMatch(NOW_DENIED);
  });

  test.each(["school change", "sign-out"] as const)(
    "refusal followed by a %s: later responses change nothing and nothing claims current access",
    async (kind) => {
      let ctx: TeacherUnitCreateContext | null = SCOPE;
      const a = unit({ title: "Plants" });
      const b = unit({ title: "Rocks" });
      const h = await panel([a, b], () => ctx);
      await refuseRemoval(h, a);
      clickRemove(h, b, R1.id);
      await tick();
      ctx = kind === "sign-out" ? null : { teacherId: SCOPE.teacherId, schoolId: "schoolB" };
      last(h.calls.setResources).d.resolve({ unit: { ...b, resourceIds: [R2.id], revision: 2 }, noop: false });
      await tick();
      expect(q(h.host, "units-status")?.textContent ?? "").not.toContain('Removed "');
      const n = authNotice(h);
      expect(n.textContent).not.toMatch(NOW_DENIED);
      expect(n.textContent).not.toMatch(NOW_ALLOWED);
      expect(noticesFor(h, b)).toHaveLength(0);
    },
  );

  test("concurrent refusal and success, in both completion orders", async () => {
    for (const order of ["refusal-first", "success-first"] as const) {
      document.body.textContent = "";
      const a = unit({ title: "Plants" });
      const b = unit({ title: "Rocks" });
      const h = await panel([a, b]);
      refused = a;
      clickRemove(h, a, R1.id);
      await tick();
      const ra = last(h.calls.setResources);
      clickRemove(h, b, R1.id);
      await tick();
      const rb = last(h.calls.setResources);
      const refuse = async () => {
        ra.d.reject(DENIED());
        await tick();
      };
      const succeed = async () => {
        rb.d.resolve({ unit: { ...b, resourceIds: [R2.id], revision: 2 }, noop: false });
        await tick();
      };
      if (order === "refusal-first") {
        await refuse();
        await succeed();
      } else {
        await succeed();
        await refuse();
      }
      const n = authNotice(h);
      expect(n.textContent).not.toMatch(NOW_DENIED);
      expect(n.textContent).not.toMatch(NOW_ALLOWED);
      expect(cardNotice(h, b)?.hidden).toBe(true);
    }
  });

  test("an authorization failure loading the list never claims the account can't make changes", async () => {
    const a = unit({ title: "Plants" });
    const h = await panel([a]);
    void h.ctl.refresh();
    last(h.calls.list).d.reject(DENIED());
    await tick();
    const box = q(h.host, "units-list-state") as HTMLElement;
    expect(box.textContent).not.toMatch(NOW_DENIED);
    expect(box.textContent).toMatch(/couldn't be loaded/);
  });
});

// ---------------------------------------------------------------------------
// Audit: the other retained notices with wording about the unit now
// ---------------------------------------------------------------------------
describe("audit: every retained notice derives its current-state wording", () => {
  const lost = () => Object.assign(new Error("lost"), { code: "unavailable" });

  test("uncertain write whose unit couldn't be read: worded from a newer record once one is read", async () => {
    const a = unit();
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    await tick();
    last(h.calls.setResources).d.reject(lost());
    await tick();
    last(h.calls.get).d.reject(lost());
    await tick();
    const [n0] = noticesFor(h, a);
    expect(n0.textContent).toContain("couldn't be loaded");
    await refreshWith(h, [{ ...a, resourceIds: [R2.id], revision: 2 }]);
    const [n] = noticesFor(h, a);
    expect(n.textContent).toContain("couldn't confirm whether your change was saved");
    expect(n.textContent).not.toContain("couldn't be loaded");
    expect(n.textContent).toContain("The resources shown are the latest version LyfeLabz has loaded");
  });

  test("uncertain write followed by absence: no instruction to check or retry the unit", async () => {
    const a = unit();
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    await tick();
    last(h.calls.setResources).d.reject(lost());
    await tick();
    last(h.calls.get).d.resolve({ unit: { ...a, revision: 2 } });
    await tick();
    await checkWith(h, []);
    const [n] = noticesFor(h, a);
    expect(n.textContent).toContain("no longer in your units");
    expect(n.textContent).not.toMatch(/Check before trying again|Refresh before trying again|Refresh units before trying again/);
  });

  test("not found, then found again by a positive read: no claim it may be gone", async () => {
    const a = unit();
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    await tick();
    last(h.calls.setResources).d.reject({ details: { code: "teacherUnits.notFound" } });
    await tick();
    expect(noticesFor(h, a)).toHaveLength(1);
    await refreshWith(h, [{ ...a, revision: 2 }]);
    const found = noticesFor(h, a);
    expect(found).toHaveLength(1);
    expect(found[0].textContent).not.toMatch(/may no longer be available|no longer in your units/);
    expect(found[0].textContent).toContain("couldn't find this unit when you tried");
    expect(found[0].textContent).toContain("found in your units again");
  });

  test("duplicate refusal is historical: no claim the resource is in the unit now", async () => {
    const a = unit({ resourceIds: [R1.id] });
    const h = await panel([a]);
    (q(h.host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    (q(h.host, `units-picker-option-${a.unitId}-${R2.id}`) as HTMLInputElement).click();
    (q(h.host, `units-picker-${a.unitId}`) as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await tick();
    last(h.calls.setResources).d.reject({ details: { code: "teacherUnits.duplicateResource", resourceId: R2.id } });
    await tick();
    last(h.calls.get).d.resolve({ unit: { ...a, resourceIds: [R1.id, R2.id], revision: 2 } });
    await tick();
    expect(noticesFor(h, a)).toHaveLength(1);
    await refreshWith(h, [{ ...a, resourceIds: [R1.id], revision: 3 }]);
    const [n] = noticesFor(h, a);
    expect(n.textContent).not.toMatch(/is already in this unit/);
    expect(n.textContent).toContain("contained repeated resource IDs");
  });

  test("the status region's location claim is re-derived while it is still showing", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    await tick();
    // Committed at revision 2; the post-commit read already holds another
    // session's re-add (revision 3).
    last(h.calls.setResources).d.resolve({ unit: { ...a, resourceIds: [R1.id, R2.id], revision: 3 }, noop: false });
    await tick();
    const status = q(h.host, "units-status") as HTMLElement;
    expect(status.textContent).toContain("Its current resources are shown.");
    await toGrade(h, "6", []);
    expect(status.textContent).toContain("is in");
    expect(status.textContent).not.toContain("Its current resources are shown");
    // Another announcement replaces it and is never rewritten.
    await toGrade(h, "7", [{ ...a, resourceIds: [R1.id, R2.id], revision: 3 }]);
    expect(status.textContent).toContain("Its current resources are shown.");
  });

  test("an authorization refusal of Check my units is worded as what happened then", async () => {
    const h = await panel([]);
    (q(h.host, "units-create-title") as HTMLInputElement).value = "Forces";
    (q(h.host, "units-create-form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await tick();
    await tick();
    (q(h.host, "units-recovery-check") as HTMLButtonElement).click();
    last(h.calls.list).d.reject(DENIED());
    await tick();
    const rec = q(h.host, "units-recovery") as HTMLElement;
    expect(rec.textContent).not.toMatch(/can't make changes right now/);
    expect(rec.textContent).toContain("an authorization check failed when LyfeLabz tried");
  });

  test("combined: several notices coexist; each follows only its own unit; identity, order, and dismissal hold", async () => {
    const a = unit({ title: "Edited", revision: 2 });
    const b = unit({ title: "Retired" });
    const c = unit({ title: "Refused" });
    const d = unit({ title: "Other" });
    const h = await panel([a, b, c, d]);
    // A: edit conflict (editor stays open).
    await editConflict(h, a, { ...a, title: "Edited theirs", revision: 3 });
    // B: picker closed by retired ids.
    (q(h.host, `units-resources-add-${b.unitId}`) as HTMLButtonElement).click();
    const withRetired = { ...b, resourceIds: ["retired-x", R1.id], revision: 2 };
    await refreshWith(h, [{ ...a, title: "Edited theirs", revision: 3 }, withRetired, c, d]);
    // C: authorization refusal.
    clickRemove(h, c, R1.id);
    await tick();
    last(h.calls.setResources).d.reject(DENIED());
    await tick();
    // B and C move to the outcome region (Grade 6), A stays pinned by its editor.
    await toGrade(h, "6", []);
    const outcomes = q(h.host, "units-outcomes") as HTMLElement;
    const ids = () => Array.from(outcomes.children).map((e) => e.getAttribute("data-testid"));
    const before = ids();
    expect(before).toHaveLength(2);
    expect(Array.from(outcomes.children).map((e) => e.getAttribute("data-unit-id"))).toEqual([b.unitId, c.unitId]);
    const textOf = (u: TeacherUnit) => noticesFor(h, u).map((n) => n.textContent ?? "");
    const REFUSAL = "An authorization check failed during this request";
    expect(textOf(c)[0]).toContain(REFUSAL);
    expect(textOf(c)[0]).toContain("Choose Grade 7 to see it");
    // Unit state changes: A renamed, B repaired, a write on D succeeds.
    await toGrade(h, "7", [{ ...a, title: "Edited newest", revision: 4 }, { ...b, resourceIds: [R1.id], revision: 3 }, c, d]);
    clickRemove(h, d, R1.id);
    await tick();
    last(h.calls.setResources).d.resolve({ unit: { ...d, resourceIds: [R2.id], revision: 2 }, noop: false });
    await tick();
    expect(ids()).toEqual(before);
    expect(textOf(a)[0]).toContain('"Edited newest"');
    expect(textOf(a)[0]).not.toContain('"Edited theirs"');
    expect(textOf(b)[0]).not.toContain("Remove the unavailable resources first");
    expect(textOf(b)[0]).toContain("no unavailable resources now");
    // C keeps its historical refusal; only where its unit is was reworded.
    expect(textOf(c)[0]).toContain(REFUSAL);
    expect(textOf(c)[0]).not.toContain("Choose Grade 7 to see it");
    expect(textOf(c)[0]).not.toMatch(/can't make changes right now/);
    // Dismissing B leaves C (and A's card notice) untouched; focus moves to C's Dismiss.
    const cText = textOf(c)[0];
    const dismissB = q(h.host, before[0]!.replace("units-outcome-", "units-outcome-dismiss-")) as HTMLButtonElement;
    dismissB.focus();
    dismissB.click();
    expect(ids()).toEqual([before[1]]);
    expect(document.activeElement).toBe(q(h.host, before[1]!.replace("units-outcome-", "units-outcome-dismiss-")));
    expect(textOf(c)[0]).toBe(cText);
    expect(textOf(a)[0]).toContain('"Edited newest"');
  });
});
