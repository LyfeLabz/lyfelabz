/**
 * @jest-environment jsdom
 *
 * U2.3 My Units resource membership UI (TEACHER_UNITS.md §9.5): the
 * per-unit resource list, the Add resources picker, Remove, and their
 * accessibility, pending, conflict, uncertainty, and archived behavior.
 */
import * as fs from "fs";
import * as path from "path";
import { renderTeacherUnitsPanel } from "./teacherUnitsPanel";
import { createTeacherUnitCreateAttemptStore } from "../../teacherUnits/createAttemptStore";
import { createTeacherUnitsController } from "../../teacherUnits/unitsController";
import { getPlaceableResources } from "../../teacherUnits/placeableResources";
import { getFlatResources } from "../../curriculum/resourceProjection";
import type { TeacherUnit, TeacherUnitGrade, TeacherUnitsCallables } from "../../teacherUnits/types";

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const flush = () => new Promise((r) => setTimeout(r, 0));
const q = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const placeable = getPlaceableResources();
const g7 = placeable.filter((r) => r.grade === "7");
const [R1, R2, R3] = g7;

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as unknown as Storage;
}

let n = 0;
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: `Unit${String(++n).padStart(16, "0")}`,
  grade: "7",
  title: "Earth Systems",
  description: "",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: n,
  updatedAtMillis: n,
  resourceIds: [],
  sortOrder: 0,
  revision: 1,
  ...over,
});

function server(initial: TeacherUnit[]) {
  const units = new Map(initial.map((u) => [u.unitId, u]));
  const c = {
    create: jest.fn(),
    list: jest.fn(async () => ({ units: Array.from(units.values()) })),
    get: jest.fn(async ({ unitId }: { unitId: string }) => ({ unit: units.get(unitId) as TeacherUnit })),
    update: jest.fn(),
    archive: jest.fn(),
    restore: jest.fn(),
    setResources: jest.fn(
      async (req: { unitId: string; expectedRevision: number; resourceIds: ReadonlyArray<string> }) => {
        const u = units.get(req.unitId) as TeacherUnit;
        if (u.revision !== req.expectedRevision) {
          throw { details: { code: "teacherUnits.writeConflict", currentRevision: u.revision } };
        }
        const next = { ...u, resourceIds: req.resourceIds.slice(), revision: u.revision + 1 };
        units.set(u.unitId, next);
        return { unit: next, noop: false };
      },
    ),
    reorder: jest.fn(),
  };
  return { units, c };
}

async function panel(initial: TeacherUnit[], grade: TeacherUnitGrade = "7") {
  const { units, c } = server(initial);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ctl = createTeacherUnitsController({
    callables: c as unknown as TeacherUnitsCallables,
    session: SCOPE,
    readCurrentContext: () => SCOPE,
    store: createTeacherUnitCreateAttemptStore(SCOPE, () => memoryStorage()),
    initialGrade: grade,
  });
  renderTeacherUnitsPanel(host, ctl);
  await flush();
  return { host, ctl, c, units };
}

const rowsOf = (host: HTMLElement, unitId: string) =>
  Array.from(host.querySelectorAll<HTMLElement>(`[data-testid="units-resource-list-${unitId}"] > li`));
const optionsOf = (host: HTMLElement, unitId: string) =>
  Array.from(
    host.querySelectorAll<HTMLInputElement>(`[data-testid="units-picker-options-${unitId}"] input[type=checkbox]`),
  );
const check = (box: HTMLInputElement | null) => {
  (box as HTMLInputElement).click();
};
const submit = (form: HTMLElement | null) =>
  (form as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
const status = (host: HTMLElement) => q(host, "units-status")?.textContent ?? "";

beforeEach(() => {
  document.body.textContent = "";
});

describe("unit contents", () => {
  test("shows the unit's resources in server order with Curriculum labels and an empty state", async () => {
    const a = unit({ resourceIds: [R3.id, R1.id] });
    const b = unit();
    const { host } = await panel([a, b]);
    const rows = rowsOf(host, a.unitId);
    expect(rows.map((r) => r.getAttribute("data-resource-id"))).toEqual([R3.id, R1.id]);
    expect(rows[0].textContent).toContain(R3.title);
    expect(rows[0].textContent).toContain("Lesson");
    expect(rows[0].querySelector("button")?.getAttribute("aria-label")).toBe(
      `Remove ${R3.title} from ${a.title}`,
    );
    expect(q(host, `units-resources-${a.unitId}`)?.textContent).toContain("Resources (2)");
    expect(q(host, `units-resources-${b.unitId}`)?.textContent).toContain("No resources in this unit yet.");
  });

  test("a stored id that is no longer placeable is shown and removable", async () => {
    const a = unit({ resourceIds: ["retired-resource"] });
    const { host, c } = await panel([a]);
    expect(rowsOf(host, a.unitId)[0].textContent).toContain("no longer available");
    (q(host, `units-resource-remove-${a.unitId}-retired-resource`) as HTMLButtonElement).click();
    await flush();
    expect(c.setResources).toHaveBeenCalledWith(expect.objectContaining({ resourceIds: [] }));
  });

  test("archived units keep their resources, read-only, with a restore hint", async () => {
    const a = unit({ status: "archived", archivedAtMillis: 3, resourceIds: [R1.id] });
    const { host, ctl } = await panel([a]);
    ctl.setShowArchived(true);
    await flush();
    expect(rowsOf(host, a.unitId)).toHaveLength(1);
    expect(q(host, `units-resources-add-${a.unitId}`)).toBeNull();
    expect(host.querySelector(`[data-testid^="units-resource-remove-${a.unitId}"]`)).toBeNull();
    expect(q(host, `units-resources-${a.unitId}`)?.textContent).toContain("Restore this unit to add or remove resources.");
  });
});

describe("Add resources picker", () => {
  test("lists only placeable resources of the unit's grade, with canonical ids and present ones disabled", async () => {
    const a = unit({ resourceIds: [R1.id] });
    const { host } = await panel([a]);
    const add = q(host, `units-resources-add-${a.unitId}`) as HTMLButtonElement;
    expect(add.getAttribute("aria-expanded")).toBe("false");
    add.click();
    const search = q(host, `units-picker-search-${a.unitId}`);
    expect(document.activeElement).toBe(search);
    expect(q(host, `units-resources-add-${a.unitId}`)?.getAttribute("aria-expanded")).toBe("true");
    const boxes = optionsOf(host, a.unitId);
    expect(boxes.map((b) => b.value)).toEqual(g7.map((r) => r.id));
    const placeableIds = new Set(placeable.map((r) => r.id));
    for (const r of getFlatResources()) {
      if (!r.unitPlaceable) expect(boxes.some((b) => b.value === r.id)).toBe(false);
    }
    expect(boxes.every((b) => placeableIds.has(b.value))).toBe(true);
    const present = boxes.find((b) => b.value === R1.id) as HTMLInputElement;
    expect(present.disabled).toBe(true);
    expect(present.checked).toBe(true);
    expect(present.closest("label")?.textContent).toContain("Already in this unit");
  });

  test("organize-only resources are offered and labelled; assignability is not required", async () => {
    const a = unit({ grade: "6" });
    const { host } = await panel([a], "6");
    (q(host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    const boxes = optionsOf(host, a.unitId);
    const gw = boxes.find((b) => b.value === "simulation-gravity-wells");
    expect(gw).toBeDefined();
    expect(gw?.closest("label")?.textContent).toContain("Can be organized here, not assigned");
  });

  test("Grade 8 has no invented resources: empty state, nothing selectable", async () => {
    const a = unit({ grade: "8" });
    const { host } = await panel([a], "8");
    (q(host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    expect(optionsOf(host, a.unitId)).toHaveLength(0);
    expect(q(host, `units-picker-options-${a.unitId}`)?.textContent).toContain(
      "There are no LyfeLabz resources for Grade 8 units yet.",
    );
    expect((q(host, `units-picker-submit-${a.unitId}`) as HTMLButtonElement).disabled).toBe(true);
  });

  test("search filters; selections survive filtering", async () => {
    const a = unit();
    const { host } = await panel([a]);
    (q(host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    check(optionsOf(host, a.unitId).find((b) => b.value === R2.id) ?? null);
    const search = q(host, `units-picker-search-${a.unitId}`) as HTMLInputElement;
    search.value = "zzzz-no-match";
    search.dispatchEvent(new Event("input"));
    expect(q(host, `units-picker-options-${a.unitId}`)?.textContent).toContain("No resources match your search.");
    search.value = "";
    search.dispatchEvent(new Event("input"));
    expect(optionsOf(host, a.unitId).find((b) => b.value === R2.id)?.checked).toBe(true);
    expect(q(host, `units-picker-submit-${a.unitId}`)?.textContent).toBe("Add selected (1)");
  });

  test("adds the selection in canonical order, announces pending then success, closes, focuses Add resources", async () => {
    const a = unit({ resourceIds: [R3.id] });
    const { host, c } = await panel([a]);
    (q(host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    const submitBtn = q(host, `units-picker-submit-${a.unitId}`) as HTMLButtonElement;
    expect(submitBtn.disabled).toBe(true);
    check(optionsOf(host, a.unitId).find((b) => b.value === R2.id) ?? null);
    check(optionsOf(host, a.unitId).find((b) => b.value === R1.id) ?? null);
    submit(q(host, `units-picker-${a.unitId}`));
    expect(status(host)).toBe(`Adding 2 resources to "${a.title}"...`);
    expect(q(host, `units-card-${a.unitId}`)?.getAttribute("aria-busy")).toBe("true");
    expect(rowsOf(host, a.unitId)).toHaveLength(1); // nothing claimed before the server confirms
    await flush();
    expect(c.setResources).toHaveBeenCalledWith({
      unitId: a.unitId,
      expectedRevision: 1,
      resourceIds: [R3.id, R1.id, R2.id],
    });
    expect(status(host)).toBe(`Added 2 resources to "${a.title}".`);
    expect(q(host, `units-picker-${a.unitId}`)).toBeNull();
    expect(document.activeElement).toBe(q(host, `units-resources-add-${a.unitId}`));
    expect(rowsOf(host, a.unitId).map((r) => r.getAttribute("data-resource-id"))).toEqual([R3.id, R1.id, R2.id]);
  });

  test("rapid repeated submits send one request", async () => {
    const a = unit();
    const { host, c } = await panel([a]);
    (q(host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    check(optionsOf(host, a.unitId)[0]);
    const form = q(host, `units-picker-${a.unitId}`);
    submit(form);
    submit(form);
    submit(form);
    await flush();
    expect(c.setResources).toHaveBeenCalledTimes(1);
  });

  test("Escape and Cancel close the picker and return focus to Add resources", async () => {
    const a = unit();
    const { host } = await panel([a]);
    (q(host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    q(host, `units-picker-search-${a.unitId}`)?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    expect(q(host, `units-picker-${a.unitId}`)).toBeNull();
    expect(document.activeElement).toBe(q(host, `units-resources-add-${a.unitId}`));
    (q(host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    (q(host, `units-picker-cancel-${a.unitId}`) as HTMLButtonElement).click();
    expect(q(host, `units-picker-${a.unitId}`)).toBeNull();
    expect(document.activeElement).toBe(q(host, `units-resources-add-${a.unitId}`));
  });

  test("conflict: picker and selection stay, current resources shown, no pending message left", async () => {
    const a = unit();
    const { host, c, units } = await panel([a]);
    (q(host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    check(optionsOf(host, a.unitId).find((b) => b.value === R1.id) ?? null);
    check(optionsOf(host, a.unitId).find((b) => b.value === R2.id) ?? null);
    // Another tab added R2.
    units.set(a.unitId, { ...a, resourceIds: [R2.id], revision: 2 });
    submit(q(host, `units-picker-${a.unitId}`));
    await flush();
    await flush();
    expect(c.setResources).toHaveBeenCalledTimes(1);
    const notice = q(host, `units-card-${a.unitId}`)?.querySelector(".shell-units-notice") as HTMLElement;
    expect(notice.hidden).toBe(false);
    expect(notice.getAttribute("role")).toBe("alert");
    expect(notice.textContent).toContain("nothing was added");
    expect(status(host)).toBe("");
    expect(rowsOf(host, a.unitId).map((r) => r.getAttribute("data-resource-id"))).toEqual([R2.id]);
    expect(q(host, `units-picker-${a.unitId}`)).not.toBeNull();
    expect(optionsOf(host, a.unitId).find((b) => b.value === R1.id)?.checked).toBe(true);
    expect(optionsOf(host, a.unitId).find((b) => b.value === R2.id)?.disabled).toBe(true);
    expect(q(host, `units-picker-submit-${a.unitId}`)?.textContent).toBe("Add selected (1)");
    // A deliberate second submit uses the fresh revision.
    submit(q(host, `units-picker-${a.unitId}`));
    await flush();
    expect(c.setResources).toHaveBeenLastCalledWith({
      unitId: a.unitId,
      expectedRevision: 2,
      resourceIds: [R2.id, R1.id],
    });
  });

  test("lost response: uncertainty is stated, the unit re-read, nothing resent", async () => {
    const a = unit();
    const { host, c, units } = await panel([a]);
    c.setResources.mockImplementationOnce(async () => {
      units.set(a.unitId, { ...a, resourceIds: [R1.id], revision: 2 });
      throw Object.assign(new Error("lost"), { code: "unavailable" });
    });
    (q(host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    check(optionsOf(host, a.unitId).find((b) => b.value === R1.id) ?? null);
    submit(q(host, `units-picker-${a.unitId}`));
    await flush();
    await flush();
    const notice = q(host, `units-card-${a.unitId}`)?.querySelector(".shell-units-notice") as HTMLElement;
    expect(notice.textContent).toContain("couldn't confirm whether your change was saved");
    expect(status(host)).toBe("");
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(rowsOf(host, a.unitId).map((r) => r.getAttribute("data-resource-id"))).toEqual([R1.id]);
  });
});

describe("Remove", () => {
  test("removes from this unit only, announces, and moves focus to the next row", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id, R3.id] });
    const b = unit({ resourceIds: [R2.id] });
    const { host, c } = await panel([a, b]);
    const remove = q(host, `units-resource-remove-${a.unitId}-${R2.id}`) as HTMLButtonElement;
    remove.focus();
    remove.click();
    expect(status(host)).toBe(`Removing "${R2.title}" from "${a.title}"...`);
    await flush();
    expect(c.setResources).toHaveBeenCalledTimes(1);
    expect(status(host)).toBe(`Removed "${R2.title}" from "${a.title}".`);
    expect(rowsOf(host, a.unitId).map((r) => r.getAttribute("data-resource-id"))).toEqual([R1.id, R3.id]);
    expect(rowsOf(host, b.unitId).map((r) => r.getAttribute("data-resource-id"))).toEqual([R2.id]);
    expect(document.activeElement).toBe(q(host, `units-resource-remove-${a.unitId}-${R3.id}`));
  });

  test("removing the last resource moves focus to Add resources and shows the empty state", async () => {
    const a = unit({ resourceIds: [R1.id] });
    const { host } = await panel([a]);
    (q(host, `units-resource-remove-${a.unitId}-${R1.id}`) as HTMLButtonElement).click();
    await flush();
    expect(document.activeElement).toBe(q(host, `units-resources-add-${a.unitId}`));
    expect(q(host, `units-resources-${a.unitId}`)?.textContent).toContain("No resources in this unit yet.");
  });

  test("an authorization failure is shown as an alert and nothing is removed", async () => {
    const a = unit({ resourceIds: [R1.id] });
    const { host, c } = await panel([a]);
    c.setResources.mockRejectedValueOnce({ details: { code: "role-forbidden" } });
    (q(host, `units-resource-remove-${a.unitId}-${R1.id}`) as HTMLButtonElement).click();
    await flush();
    const notice = q(host, `units-card-${a.unitId}`)?.querySelector(".shell-units-notice") as HTMLElement;
    expect(notice.hidden).toBe(false);
    expect(status(host)).toBe("");
    expect(rowsOf(host, a.unitId)).toHaveLength(1);
    expect(c.get).not.toHaveBeenCalled();
  });
});

describe("styles and copy", () => {
  test("a hidden notice inside the new resource UI is not displayed", async () => {
    const html = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
    const css = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g))
      .map((m) => m[1])
      .join("\n");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    try {
      const a = unit({ resourceIds: [R1.id] });
      const { host } = await panel([a]);
      const notice = q(host, `units-card-${a.unitId}`)?.querySelector(".shell-units-notice") as HTMLElement;
      expect(notice.hidden).toBe(true);
      expect(getComputedStyle(notice).display).toBe("none");
      expect(getComputedStyle(rowsOf(host, a.unitId)[0]).display).toBe("flex");
    } finally {
      style.remove();
    }
  });

  test("panel copy and styles contain no em dashes", () => {
    const src = fs.readFileSync(path.join(__dirname, "teacherUnitsPanel.ts"), "utf8");
    expect(src.includes("\u2014")).toBe(false);
  });
});
