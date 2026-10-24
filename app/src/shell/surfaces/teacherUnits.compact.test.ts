/**
 * @jest-environment jsdom
 *
 * Teacher Units UX Milestone 1: the compact My Units panel. Create Unit opens
 * and closes the create form; units are compact expandable containers whose
 * resources use the shared full-width resource card; the archived view
 * replaces the Show archived units checkbox; the toolbar has no manual read and
 * returning to the tab refreshes automatically.
 */
import * as fs from "fs";
import * as path from "path";
import { renderTeacherUnitsPanel } from "./teacherUnitsPanel";
import { createTeacherUnitCreateAttemptStore } from "../../teacherUnits/createAttemptStore";
import { createTeacherUnitsController } from "../../teacherUnits/unitsController";
import { getPlaceableResources } from "../../teacherUnits/placeableResources";
import type { TeacherUnit, TeacherUnitsCallables } from "../../teacherUnits/types";

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const flush = () => new Promise((r) => setTimeout(r, 0));
const placeable = getPlaceableResources();
const LESSON = placeable.find((r) => r.type === "lesson" && r.grade === "7")!;
const OTHER = placeable.find((r) => r.type !== "lesson" && r.grade !== null && r.topic !== null)!;
const ORGANIZE_ONLY = placeable.find((r) => r.id === "simulation-gravity-wells");

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
  description: "Rocks and plates",
  color: null,
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: n,
  updatedAtMillis: n,
  resourceIds: [],
  sortOrder: 0,
  revision: 1,
  ...over,
});

async function panel(units: TeacherUnit[], create?: jest.Mock) {
  const c = {
    create: create ?? jest.fn(),
    list: jest.fn(async () => ({ units })),
    get: jest.fn(),
    update: jest.fn(),
    archive: jest.fn() as jest.Mock,
    restore: jest.fn(),
    setResources: jest.fn(),
    reorder: jest.fn(),
  };
  const host = document.createElement("div");
  document.body.appendChild(host);
  const storage = memoryStorage();
  const ctl = createTeacherUnitsController({
    callables: c as unknown as TeacherUnitsCallables,
    session: SCOPE,
    readCurrentContext: () => SCOPE,
    store: createTeacherUnitCreateAttemptStore(SCOPE, () => storage),
    initialGrade: "7",
    now: () => 1_700_000_000_000,
    mint: () => "key_00000001",
  });
  const view = renderTeacherUnitsPanel(host, ctl);
  await flush();
  return { host, ctl, c, view };
}
const q = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const press = (el: HTMLElement | null) => (el as HTMLButtonElement).click();

beforeEach(() => {
  document.body.textContent = "";
});

describe("page copy", () => {
  test("no intro sentence, no 'Create one above' empty state, and no Show archived units checkbox", async () => {
    const { host } = await panel([]);
    expect(host.textContent).not.toContain("Create your own units");
    expect(host.textContent).not.toContain("Create one above");
    expect(q(host, "units-list-state")?.textContent).toBe("No active Grade 7 units yet.");
    expect(q(host, "units-show-archived")).toBeNull();
    expect(host.textContent).not.toContain("Show archived units");
    expect(host.querySelector("input[type=checkbox]")).toBeNull();
  });

  test("Create Unit names no grade; the form heading and submit follow the selected grade without numbering the button", async () => {
    const { host, ctl } = await panel([]);
    const open = q(host, "units-create-open") as HTMLButtonElement;
    expect(open.textContent?.trim()).toBe("+ Create Unit");
    expect(open.textContent).not.toMatch(/\d/);
    expect(open.querySelector("[aria-hidden=true]")?.textContent).toBe("+");
    press(open);
    expect(q(host, "units-create-form")?.querySelector("h4")?.textContent).toBe("New Grade 7 unit");
    expect(q(host, "units-create-submit")?.textContent).toBe("Create unit");
    ctl.setGrade("8");
    await flush();
    expect(q(host, "units-create-form")?.querySelector("h4")?.textContent).toBe("New Grade 8 unit");
    expect(open.textContent).not.toMatch(/\d/);
  });

  test("the toolbar has no manual list read: grade filters and Create Unit only", async () => {
    const { host } = await panel([]);
    expect(q(host, "units-check-changes")).toBeNull();
    expect(host.querySelector(".shell-units-check-changes")).toBeNull();
    const toolbar = host.querySelector(".shell-units-toolbar") as HTMLElement;
    expect(toolbar.textContent).not.toMatch(/Refresh/);
    expect(q(host, "units-grade-6")).not.toBeNull();
    expect(q(host, "units-create-open")).not.toBeNull();
    // No notice is showing, so no contextual load action is either.
    for (const b of Array.from(host.querySelectorAll<HTMLElement>(".shell-units-read-action"))) expect(b.hidden).toBe(true);
  });
});

describe("Create Unit", () => {
  test("Cancel and Escape close the form and return focus to Create Unit", async () => {
    const { host } = await panel([]);
    const open = q(host, "units-create-open") as HTMLButtonElement;
    const form = q(host, "units-create-form") as HTMLFormElement;
    expect(open.getAttribute("aria-controls")).toBe(form.id);
    press(open);
    expect(form.hidden).toBe(false);
    press(q(host, "units-create-cancel"));
    expect(form.hidden).toBe(true);
    expect(open.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(open);
    press(open);
    form.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(form.hidden).toBe(true);
    expect(document.activeElement).toBe(open);
  });

  test("a rejected create keeps the form open with its message", async () => {
    const create = jest.fn().mockRejectedValue(
      Object.assign(new Error("x"), { code: "invalid-argument", details: { code: "teacherUnits.invalidRequest", field: "title" } }),
    );
    const { host } = await panel([], create);
    press(q(host, "units-create-open"));
    (q(host, "units-create-title") as HTMLInputElement).value = "Weather";
    (q(host, "units-create-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect((q(host, "units-create-form") as HTMLFormElement).hidden).toBe(false);
    expect((q(host, "units-create-error") as HTMLElement).hidden).toBe(false);
  });

  test("after a create, Create Unit begins a new unit with an empty form", async () => {
    const created = unit({ title: "Weather" });
    const { host, c } = await panel([], jest.fn(async () => ({ unit: created, replayed: false })));
    press(q(host, "units-create-open"));
    (q(host, "units-create-title") as HTMLInputElement).value = "Weather";
    (q(host, "units-create-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect((q(host, "units-create-form") as HTMLFormElement).hidden).toBe(true);
    press(q(host, "units-create-open"));
    expect((q(host, "units-create-title") as HTMLInputElement).value).toBe("");
    expect((q(host, "units-create-submit") as HTMLButtonElement).disabled).toBe(false);
    expect(c.create).toHaveBeenCalledTimes(1);
  });
});

describe("compact unit containers", () => {
  test("units start collapsed: one header row with the title, no resource count; expanding shows resources", async () => {
    const u = unit({ title: "Plants", resourceIds: [LESSON.id, OTHER.id] });
    const empty = unit({ title: "Empty" });
    const { host, ctl } = await panel([u, empty]);
    const toggle = q(host, `units-toggle-${u.unitId}`) as HTMLButtonElement;
    const details = q(host, `units-details-${u.unitId}`) as HTMLElement;
    const header = toggle.closest(".shell-units-card-title-row") as HTMLElement;
    expect(header.querySelector("h3")?.textContent).toBe("Plants");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(details.id);
    expect(toggle.getAttribute("aria-label")).toBe("Show resources in Plants");
    expect(details.hidden).toBe(true);
    // No resource counts next to the title, and no "Resources (N)" heading.
    expect(q(host, `units-count-${u.unitId}`)).toBeNull();
    expect(header.textContent).not.toMatch(/\d+ resources?|No resources/i);
    expect(
      q(host, `units-toggle-${empty.unitId}`)?.closest(".shell-units-card-title-row")?.textContent,
    ).not.toMatch(/\d+ resources?|No resources/i);
    // The management menu sits in the header row, separate from the chevron.
    const menu = q(host, `units-menu-${u.unitId}`) as HTMLButtonElement;
    expect(header.contains(menu)).toBe(true);
    expect(menu).not.toBe(toggle);
    expect(header.contains(q(host, `units-edit-${u.unitId}`))).toBe(true);
    expect(details.querySelector(".shell-units-actions")).toBeNull();
    press(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(details.hidden).toBe(false);
    expect(details.textContent).toContain("Rocks and plates");
    expect(details.textContent).not.toContain("Resources (");
    press(toggle);
    expect(details.hidden).toBe(true);
    // Expansion is the teacher's: a list refresh keeps it.
    press(toggle);
    await ctl.refresh();
    await flush();
    expect(q(host, `units-details-${u.unitId}`)?.hidden).toBe(false);
    expect(q(host, `units-toggle-${u.unitId}`)?.getAttribute("aria-expanded")).toBe("true");
  });

  test("a card leaving the list hands focus to the next collapsed card's header menu, never into hidden details", async () => {
    const [a, b] = [unit({ title: "A" }), unit({ title: "B" })];
    const archivedA = { ...a, status: "archived" as const, archivedAtMillis: 9, revision: 2 };
    const { host, c } = await panel([a, b]);
    c.archive.mockResolvedValue({ unit: archivedA, noop: false });
    press(q(host, `units-toggle-${a.unitId}`));
    const archive = q(host, `units-archive-${a.unitId}`) as HTMLButtonElement;
    archive.focus();
    press(archive);
    await flush();
    await flush();
    expect(q(host, `units-card-${a.unitId}`)).toBeNull();
    expect(q(host, `units-details-${b.unitId}`)?.hidden).toBe(true);
    expect(document.activeElement).toBe(q(host, `units-menu-${b.unitId}`));
  });

  test("resources use the shared full-width card: badges, type, title, Preview or Open, and membership controls", async () => {
    const ids = [LESSON.id, OTHER.id, ...(ORGANIZE_ONLY ? [ORGANIZE_ONLY.id] : [])];
    const u = unit({ resourceIds: ids });
    const { host } = await panel([u]);
    press(q(host, `units-toggle-${u.unitId}`));
    const rows = Array.from(host.querySelectorAll<HTMLElement>(`[data-testid="units-resource-list-${u.unitId}"] > li`));
    expect(rows).toHaveLength(ids.length);
    const [lessonRow, otherRow] = rows;
    const lessonCard = lessonRow.querySelector(".shell-resource-row") as HTMLElement;
    expect(lessonCard).not.toBeNull();
    expect(lessonCard.querySelector(".shell-lesson-grade")?.textContent).toBe("G7");
    expect(lessonCard.querySelector(".shell-lesson-topic")).not.toBeNull();
    expect(lessonCard.querySelector(".shell-lesson-resource-type")?.textContent).toBe("Lesson");
    // Milestone 2B: as in Curriculum, the type label follows the title.
    expect(lessonCard.querySelector(".shell-lesson-title-row > .shell-lesson-resource-type")?.textContent).toBe("Lesson");
    expect(lessonCard.querySelector(".shell-lesson-header > .shell-lesson-resource-type")).toBeNull();
    expect(lessonCard.querySelector(".shell-lesson-title")?.textContent).toBe(LESSON.title);
    const preview = q(lessonRow, `units-resource-preview-${u.unitId}-${LESSON.id}`) as HTMLAnchorElement;
    expect(preview.textContent).toBe("Preview");
    expect(preview.target).toBe("_blank");
    expect(preview.getAttribute("href")).not.toContain("assignment");
    const open = q(otherRow, `units-resource-open-${u.unitId}-${OTHER.id}`) as HTMLAnchorElement;
    expect(open.textContent).toBe("Open");
    expect(open.getAttribute("href")).toBe(OTHER.openHref);
    // Membership controls live in the card's actions; nothing assigns here.
    const actions = lessonCard.querySelector(".shell-resource-row-actions") as HTMLElement;
    expect(actions.contains(q(host, `units-resource-remove-${u.unitId}-${LESSON.id}`))).toBe(true);
    // Milestone 2B: the drag handle leads the row, outside the card's actions.
    const handle = q(host, `units-resource-handle-${u.unitId}-${LESSON.id}`) as HTMLElement;
    expect(lessonRow.firstElementChild).toBe(handle);
    expect(actions.contains(handle)).toBe(false);
    expect(host.querySelector(".shell-lesson-assign")).toBeNull();
    expect(host.textContent).not.toMatch(/\bAssign\b/);
    if (ORGANIZE_ONLY) {
      expect(rows[2].querySelector(".shell-resource-row-status")?.textContent).toBe("Not assignable");
    }
    // Server order is kept.
    expect(rows.map((r) => r.getAttribute("data-resource-id"))).toEqual(ids);
  });

  test("a retired resource is a titled card with no badges or links", async () => {
    const u = unit({ resourceIds: ["lesson-no-longer-here"] });
    const { host } = await panel([u]);
    const row = host.querySelector<HTMLElement>(`[data-testid="units-resource-list-${u.unitId}"] > li`)!;
    expect(row.querySelector(".shell-lesson-title")?.textContent).toBe("A resource that is no longer available");
    expect(row.querySelector(".shell-lesson-header")).toBeNull();
    expect(row.querySelector("a")).toBeNull();
  });
});

describe("archived view", () => {
  test("shown only while archived units are included; leaving it calls back and returns focus to Create Unit", async () => {
    const onArchivedViewExit = jest.fn();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const ctl = createTeacherUnitsController({
      callables: {
        create: jest.fn(), list: jest.fn(async () => ({ units: [] })), get: jest.fn(), update: jest.fn(),
        archive: jest.fn(), restore: jest.fn(), setResources: jest.fn(), reorder: jest.fn(),
      } as unknown as TeacherUnitsCallables,
      session: SCOPE,
      readCurrentContext: () => SCOPE,
      store: createTeacherUnitCreateAttemptStore(SCOPE, () => memoryStorage()),
      initialGrade: "7",
    });
    renderTeacherUnitsPanel(host, ctl, { onArchivedViewExit });
    await flush();
    const region = q(host, "units-archived-view") as HTMLElement;
    expect(region.hidden).toBe(true);
    ctl.setShowArchived(true);
    await flush();
    expect(region.hidden).toBe(false);
    expect(region.getAttribute("role")).toBe("region");
    expect(region.textContent).toContain("Archived Grade 7 units are shown");
    expect(q(host, "units-list-state")?.textContent).toBe("No Grade 7 units yet.");
    press(q(host, "units-archived-exit"));
    expect(ctl.getState().showArchived).toBe(false);
    expect(onArchivedViewExit).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(q(host, "units-create-open"));
  });
});

describe("automatic freshness", () => {
  const setVisibility = (state: "visible" | "hidden") => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
    document.dispatchEvent(new Event("visibilitychange"));
  };
  afterEach(() => {
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  test("returning to the tab refreshes the list silently, at most once per 30 seconds; never after disposal", async () => {
    const now = jest.spyOn(Date, "now");
    let t = 1_000_000;
    now.mockImplementation(() => t);
    const { host, c, view } = await panel([unit()]);
    expect(c.list).toHaveBeenCalledTimes(1);
    setVisibility("hidden");
    setVisibility("visible");
    await flush();
    expect(c.list).toHaveBeenCalledTimes(1);
    t += 30_000;
    setVisibility("hidden");
    expect(c.list).toHaveBeenCalledTimes(1);
    setVisibility("visible");
    await flush();
    expect(c.list).toHaveBeenCalledTimes(2);
    expect(q(host, "units-status")?.textContent).toBe("");
    view.dispose();
    t += 60_000;
    setVisibility("visible");
    await flush();
    expect(c.list).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });
});

describe("styles", () => {
  test("hidden details and the closed form are not displayed; resource rows are grid cards", async () => {
    const html = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
    const css = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)).map((m) => m[1]).join("\n");
    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
    try {
      const u = unit({ resourceIds: [LESSON.id] });
      const { host } = await panel([u]);
      expect(getComputedStyle(q(host, `units-details-${u.unitId}`) as HTMLElement).display).toBe("none");
      expect(getComputedStyle(q(host, "units-create-form") as HTMLElement).display).toBe("none");
      press(q(host, `units-toggle-${u.unitId}`));
      const card = host.querySelector<HTMLElement>(".shell-units-resource-card")!;
      expect(getComputedStyle(card).display).toBe("grid");
    } finally {
      style.remove();
    }
  });

  test("no em dashes in the new modules", () => {
    for (const f of ["teacherUnitsPanel.ts", "resourceCard.ts", "myUnits.ts"]) {
      expect(fs.readFileSync(path.join(__dirname, f), "utf8").includes("\u2014")).toBe(false);
    }
  });
});
