/**
 * @jest-environment jsdom
 *
 * U2.5 accessibility and UX remediation (TEACHER_UNITS.md "U2.5").
 *
 * Focus ownership before, during and after asynchronous operations; card
 * departure; stable card rendering; Refresh units; operation-specific
 * uncertainty and neutral conflict wording; field error associations; and
 * the panel-scoped forced-colors focus style. Every callable is a manually
 * settled deferred, so each interleaving is explicit.
 */
import * as fs from "fs";
import * as path from "path";
import { renderTeacherUnitsPanel } from "./teacherUnitsPanel";
// These suites exercise an open unit; collapse is covered by teacherUnits.compact.test.ts.
const EXPANDED = { unitsInitiallyExpanded: true } as const;
import { createTeacherUnitCreateAttemptStore } from "../../teacherUnits/createAttemptStore";
import { createTeacherUnitsController, type TeacherUnitsController } from "../../teacherUnits/unitsController";
import { getPlaceableResources } from "../../teacherUnits/placeableResources";
import type { TeacherUnit, TeacherUnitsCallables } from "../../teacherUnits/types";

const SCOPE = { teacherId: "teacherF", schoolId: "schoolF" };
const OTHER = { teacherId: "teacherG", schoolId: "schoolF" };
const tick = () => new Promise((r) => setTimeout(r, 0));
const q = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const [R1, R2, R3] = getPlaceableResources().filter((r) => r.grade === "7");

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
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => {
  const n = ++seq;
  return {
    unitId: `Foc${String(n).padStart(17, "0")}`,
    grade: "7",
    title: `Unit ${n}`,
    description: "",
    status: "active",
    archivedAtMillis: null,
    createdAtMillis: n,
    updatedAtMillis: n,
    resourceIds: [R1.id, R2.id],
    sortOrder: n,
    revision: 1,
    ...over,
  };
};
const next = (u: TeacherUnit, over: Partial<TeacherUnit>): TeacherUnit => ({ ...u, revision: u.revision + 1, ...over });
const archivedOf = (u: TeacherUnit): TeacherUnit => next(u, { status: "archived", archivedAtMillis: 9 });

type Call = { req: Record<string, unknown>; d: Deferred<unknown> };
const KINDS = ["create", "list", "get", "update", "archive", "restore", "setResources", "reorder"] as const;
type Kind = (typeof KINDS)[number];

async function panel(units: TeacherUnit[]) {
  const calls = Object.fromEntries(KINDS.map((k) => [k, [] as Call[]])) as Record<Kind, Call[]>;
  const c = Object.fromEntries(
    KINDS.map((k) => [
      k,
      jest.fn((req: Record<string, unknown> = {}) => {
        const d = deferred<unknown>();
        calls[k].push({ req, d });
        return d.promise;
      }),
    ]),
  ) as unknown as Record<Kind, jest.Mock>;
  let context = SCOPE;
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ctl: TeacherUnitsController = createTeacherUnitsController({
    callables: c as unknown as TeacherUnitsCallables,
    session: SCOPE,
    readCurrentContext: () => context,
    store: createTeacherUnitCreateAttemptStore(SCOPE),
    initialGrade: "7",
  });
  renderTeacherUnitsPanel(host, ctl, EXPANDED);
  calls.list[0].d.resolve({ units });
  await tick();
  return {
    c,
    calls,
    host,
    ctl,
    switchAccount: () => {
      context = OTHER;
    },
  };
}
type H = Awaited<ReturnType<typeof panel>>;

const last = (h: H, k: Kind) => h.calls[k][h.calls[k].length - 1];
const btn = (h: H, id: string) => q(h.host, id) as HTMLButtonElement;
// Milestone 2B: one keyboard move through the drag handle (pick up, arrow, drop).
const moveStep = (h: H, unitId: string, id: string, dir: "up" | "down") => {
  const handle = btn(h, `units-resource-handle-${unitId}-${id}`);
  handle.focus();
  for (const k of [" ", dir === "up" ? "ArrowUp" : "ArrowDown", " "]) {
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
  }
};
const status = (h: H) => q(h.host, "units-status")?.textContent ?? "";
const LOST = () => Object.assign(new Error("lost"), { code: "unavailable" });
const CONFLICT = () => ({ details: { code: "teacherUnits.writeConflict" } });
const press = (b: HTMLElement) => {
  b.focus();
  b.click();
};
const checkChanges = async (h: H, units: TeacherUnit[]) => {
  press(btn(h, "units-check-changes"));
  last(h, "list").d.resolve({ units });
  await tick();
};
const noticeOf = (h: H, u: TeacherUnit) => h.host.querySelector<HTMLElement>(`[data-testid="units-card-${u.unitId}"] > .shell-units-notice`);

beforeEach(() => {
  document.body.textContent = "";
  localStorage.clear();
});

describe("card departure", () => {
  test("a unit archived elsewhere leaves the list: focus moves to the card now in its place", async () => {
    const [a, b, c] = [unit(), unit(), unit()];
    const h = await panel([a, b, c]);
    btn(h, `units-edit-${b.unitId}`).focus();
    // A read started elsewhere (here directly) finds the unit gone.
    void h.ctl.refresh();
    last(h, "list").d.resolve({ units: [a, c] });
    await tick();
    expect(q(h.host, `units-card-${b.unitId}`)).toBeNull();
    expect(document.activeElement).toBe(btn(h, `units-resources-add-${c.unitId}`));
    expect((document.activeElement as HTMLElement).isConnected).toBe(true);
    // Refresh units itself keeps its own focus while a card leaves.
    await checkChanges(h, [c]);
    expect(document.activeElement).toBe(btn(h, "units-check-changes"));
  });

  test("the last card leaving focuses the card before it", async () => {
    const [a, b] = [unit(), unit()];
    const h = await panel([a, b]);
    btn(h, `units-edit-${b.unitId}`).focus();
    void h.ctl.refresh();
    last(h, "list").d.resolve({ units: [a] });
    await tick();
    expect(document.activeElement).toBe(btn(h, `units-resources-add-${a.unitId}`));
  });

  test("the only card leaving with a retained notice focuses that notice's Dismiss", async () => {
    const a = unit();
    const h = await panel([a]);
    btn(h, `units-resource-remove-${a.unitId}-${R1.id}`).click();
    last(h, "setResources").d.reject(CONFLICT());
    await tick();
    last(h, "get").d.resolve({ unit: next(a, { title: "Theirs" }) });
    await tick();
    expect(noticeOf(h, a)?.hidden).toBe(false);
    btn(h, `units-edit-${a.unitId}`).focus();
    void h.ctl.refresh();
    last(h, "list").d.resolve({ units: [] });
    await tick();
    const dismiss = h.host.querySelector<HTMLElement>(`[data-unit-id="${a.unitId}"] [data-testid^="units-outcome-dismiss-"]`);
    expect(dismiss).not.toBeNull();
    expect(document.activeElement).toBe(dismiss);
  });

  test("authoritative absence (archived units shown) and grade filtering never leave focus on a detached node", async () => {
    const [a, b] = [unit(), unit()];
    const h = await panel([a, b]);
    h.ctl.setShowArchived(true);
    last(h, "list").d.resolve({ units: [a, b] });
    await tick();
    btn(h, `units-edit-${a.unitId}`).focus();
    void h.ctl.refresh();
    last(h, "list").d.resolve({ units: [b] });
    await tick();
    expect(document.activeElement).toBe(btn(h, `units-resources-add-${b.unitId}`));
    h.ctl.setGrade("8");
    last(h, "list").d.resolve({ units: [] });
    await tick();
    expect(document.activeElement).toBe(q(h.host, "units-heading") ?? h.host.querySelector("#units-heading"));
  });

  test("an external archive found by a refused remove: focus never stays on the detached card", async () => {
    const [a, b] = [unit(), unit()];
    const h = await panel([a, b]);
    press(btn(h, `units-resource-remove-${a.unitId}-${R1.id}`));
    last(h, "setResources").d.reject({ details: { code: "teacherUnits.invalidStatus" } });
    await tick();
    last(h, "get").d.resolve({ unit: archivedOf(a) });
    await tick();
    expect(q(h.host, `units-card-${a.unitId}`)).toBeNull();
    expect(document.activeElement).toBe(btn(h, `units-resources-add-${b.unitId}`));
  });
});

describe("own archive and restore", () => {
  test("archive with archived units hidden: focus moves to the next card, and the settle does not move it again", async () => {
    const [a, b] = [unit(), unit()];
    const h = await panel([a, b]);
    press(btn(h, `units-archive-${a.unitId}`));
    last(h, "archive").d.resolve({ unit: archivedOf(a), noop: false });
    await tick();
    expect(document.activeElement).toBe(btn(h, `units-resources-add-${b.unitId}`));
    expect(status(h)).toBe(`Archived: "${a.title}".`);
  });

  test("archive and restore with archived units shown: focus moves to the replacing control", async () => {
    const a = unit();
    const h = await panel([a]);
    h.ctl.setShowArchived(true);
    last(h, "list").d.resolve({ units: [a] });
    await tick();
    press(btn(h, `units-archive-${a.unitId}`));
    last(h, "archive").d.resolve({ unit: archivedOf(a), noop: false });
    await tick();
    expect(document.activeElement).toBe(btn(h, `units-restore-${a.unitId}`));
    press(btn(h, `units-restore-${a.unitId}`));
    last(h, "restore").d.resolve({ unit: next(archivedOf(a), { status: "active", archivedAtMillis: null }), noop: false });
    await tick();
    expect(document.activeElement).toBe(btn(h, `units-archive-${a.unitId}`));
  });
});

describe("focus while busy", () => {
  test("a pending archive keeps focus on the same, aria-disabled control and refuses a second activation", async () => {
    const a = unit();
    const h = await panel([a]);
    const archive = btn(h, `units-archive-${a.unitId}`);
    press(archive);
    await tick();
    expect(document.activeElement).toBe(archive);
    expect(archive.isConnected).toBe(true);
    expect(archive.disabled).toBe(false);
    expect(archive.getAttribute("aria-disabled")).toBe("true");
    archive.click();
    btn(h, `units-edit-${a.unitId}`).click();
    expect(h.c.archive).toHaveBeenCalledTimes(1);
    expect(q(h.host, `units-edit-title-${a.unitId}`)).toBeNull();
    last(h, "archive").d.reject(LOST());
    await tick();
    expect(archive.getAttribute("aria-disabled")).toBeNull();
    expect(document.activeElement).toBe(archive);
  });

  test("a pending remove keeps focus on the pressed Remove (single resource)", async () => {
    const a = unit({ resourceIds: [R1.id] });
    const h = await panel([a]);
    const remove = btn(h, `units-resource-remove-${a.unitId}-${R1.id}`);
    press(remove);
    await tick();
    expect(document.activeElement).toBe(remove);
    remove.click();
    expect(h.c.setResources).toHaveBeenCalledTimes(1);
  });

  test("a pending save keeps focus in the editor and a repeated submit sends nothing", async () => {
    const a = unit();
    const h = await panel([a]);
    btn(h, `units-edit-${a.unitId}`).click();
    const title = q(h.host, `units-edit-title-${a.unitId}`) as HTMLInputElement;
    title.value = "Renamed";
    const save = btn(h, `units-edit-save-${a.unitId}`);
    press(save);
    await tick();
    expect(document.activeElement).toBe(save);
    expect(save.getAttribute("aria-disabled")).toBe("true");
    save.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    expect(h.c.update).toHaveBeenCalledTimes(1);
    last(h, "update").d.resolve({ unit: next(a, { title: "Renamed" }), noop: false });
    await tick();
    expect(document.activeElement).toBe(btn(h, `units-edit-${a.unitId}`));
  });

  test("a pending create keeps focus in the form and refuses a second submit", async () => {
    const h = await panel([]);
    press(btn(h, "units-create-open"));
    const title = q(h.host, "units-create-title") as HTMLInputElement;
    expect(document.activeElement).toBe(title);
    title.value = "Weather";
    const form = q(h.host, "units-create-form") as HTMLFormElement;
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    expect(document.activeElement).toBe(title);
    expect(title.disabled).toBe(false);
    expect(title.readOnly).toBe(true);
    expect(btn(h, "units-create-submit").getAttribute("aria-disabled")).toBe("true");
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
    expect(h.c.create).toHaveBeenCalledTimes(1);
    const created = unit({ title: "Weather", resourceIds: [] });
    last(h, "create").d.resolve({ unit: created, replayed: false });
    await tick();
    // Milestone 1: the form closes and focus moves to the new unit's card.
    expect(form.hidden).toBe(true);
    expect(document.activeElement).toBe(btn(h, `units-toggle-${created.unitId}`));
  });
});

describe("no focus theft", () => {
  test("an archive that settles after the teacher moved to another card leaves focus there", async () => {
    const [a, b] = [unit(), unit()];
    const h = await panel([a, b]);
    press(btn(h, `units-archive-${a.unitId}`));
    const edit = btn(h, `units-edit-${b.unitId}`);
    edit.focus();
    last(h, "archive").d.resolve({ unit: archivedOf(a), noop: false });
    await tick();
    expect(document.activeElement).toBe(edit);
    expect(edit.isConnected).toBe(true);
  });

  test("remove, move and add settling while the teacher is elsewhere do not move focus", async () => {
    const [a, b] = [unit({ resourceIds: [R1.id, R2.id, R3.id] }), unit()];
    const h = await panel([a, b]);
    const elsewhere = btn(h, `units-edit-${b.unitId}`);
    press(btn(h, `units-resource-remove-${a.unitId}-${R1.id}`));
    elsewhere.focus();
    last(h, "setResources").d.resolve({ unit: next(a, { resourceIds: [R2.id, R3.id] }), noop: false });
    await tick();
    expect(document.activeElement).toBe(elsewhere);
    moveStep(h, a.unitId, R2.id, "down");
    elsewhere.focus();
    last(h, "setResources").d.resolve({ unit: next(next(a, {}), { resourceIds: [R3.id, R2.id] }), noop: false });
    await tick();
    expect(document.activeElement).toBe(elsewhere);
  });

  test("the departure destination stays put when the departing unit's operation settles", async () => {
    const [a, b] = [unit(), unit()];
    const h = await panel([a, b]);
    press(btn(h, `units-archive-${a.unitId}`));
    // Another read drops the unit while its archive is pending.
    void h.ctl.refresh();
    last(h, "list").d.resolve({ units: [b] });
    await tick();
    const parked = document.activeElement;
    expect(parked).toBe(btn(h, `units-resources-add-${b.unitId}`));
    last(h, "archive").d.resolve({ unit: archivedOf(a), noop: false });
    await tick();
    expect(document.activeElement).toBe(parked);
  });
});

describe("stable rendering", () => {
  test("a change to one unit keeps every node of an unrelated card", async () => {
    const [a, b] = [unit(), unit()];
    const h = await panel([a, b]);
    const editA = btn(h, `units-edit-${a.unitId}`);
    const bodyA = editA.closest(".shell-units-card-body");
    editA.focus();
    btn(h, `units-resource-remove-${b.unitId}-${R1.id}`).click();
    last(h, "setResources").d.resolve({ unit: next(b, { resourceIds: [R2.id] }), noop: false });
    await tick();
    expect(btn(h, `units-edit-${a.unitId}`)).toBe(editA);
    expect(editA.closest(".shell-units-card-body")).toBe(bodyA);
    expect(document.activeElement).toBe(editA);
    // The changed card did update.
    expect(q(h.host, `units-resource-remove-${b.unitId}-${R1.id}`)).toBeNull();
  });

  test("busy state is applied in place; order, membership, title, labels and archive state still update", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    const edit = btn(h, `units-edit-${a.unitId}`);
    moveStep(h, a.unitId, R1.id, "down");
    expect(btn(h, `units-edit-${a.unitId}`)).toBe(edit);
    expect(edit.getAttribute("aria-disabled")).toBe("true");
    expect(q(h.host, `units-card-${a.unitId}`)?.getAttribute("aria-busy")).toBe("true");
    const moved = next(a, { resourceIds: [R2.id, R1.id] });
    last(h, "setResources").d.resolve({ unit: moved, noop: false });
    await tick();
    const rows = Array.from(h.host.querySelectorAll(`[data-testid="units-resource-list-${a.unitId}"] > li`));
    expect(rows.map((r) => r.getAttribute("data-resource-id"))).toEqual([R2.id, R1.id]);
    expect(btn(h, `units-edit-${a.unitId}`).getAttribute("aria-disabled")).toBeNull();
    await checkChanges(h, [next(moved, { title: "Renamed elsewhere" })]);
    expect(btn(h, `units-edit-${a.unitId}`).getAttribute("aria-label")).toBe("Edit Renamed elsewhere");
    h.ctl.setShowArchived(true);
    last(h, "list").d.resolve({ units: [archivedOf(next(moved, { title: "Renamed elsewhere" }))] });
    await tick();
    expect(q(h.host, `units-restore-${a.unitId}`)).not.toBeNull();
    expect(q(h.host, `units-card-${a.unitId}`)?.classList.contains("shell-units-card--archived")).toBe(true);
  });
});

describe("resource and editor focus", () => {
  test("remove focuses the row that took its place; move keeps the moved resource; add returns to Add resources", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    moveStep(h, a.unitId, R1.id, "down");
    const moved = next(a, { resourceIds: [R2.id, R1.id] });
    last(h, "setResources").d.resolve({ unit: moved, noop: false });
    await tick();
    expect(document.activeElement).toBe(btn(h, `units-resource-handle-${a.unitId}-${R1.id}`));
    press(btn(h, `units-resource-remove-${a.unitId}-${R2.id}`));
    const removed = next(moved, { resourceIds: [R1.id] });
    last(h, "setResources").d.resolve({ unit: removed, noop: false });
    await tick();
    expect(document.activeElement).toBe(btn(h, `units-resource-remove-${a.unitId}-${R1.id}`));
    btn(h, `units-resources-add-${a.unitId}`).click();
    const box = q(h.host, `units-picker-option-${a.unitId}-${R3.id}`) as HTMLInputElement;
    box.click();
    press(btn(h, `units-picker-submit-${a.unitId}`));
    last(h, "setResources").d.resolve({ unit: next(removed, { resourceIds: [R1.id, R3.id] }), noop: false });
    await tick();
    expect(document.activeElement).toBe(btn(h, `units-resources-add-${a.unitId}`));
  });

  test("Escape and Cancel still return focus to the opening control", async () => {
    const a = unit();
    const h = await panel([a]);
    btn(h, `units-edit-${a.unitId}`).click();
    const title = q(h.host, `units-edit-title-${a.unitId}`) as HTMLInputElement;
    title.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(document.activeElement).toBe(btn(h, `units-edit-${a.unitId}`));
    btn(h, `units-resources-add-${a.unitId}`).click();
    btn(h, `units-picker-cancel-${a.unitId}`).click();
    expect(document.activeElement).toBe(btn(h, `units-resources-add-${a.unitId}`));
  });
});

describe("Refresh units", () => {
  test("uses one list read, keeps unsaved create and edit input, and announces the result", async () => {
    const a = unit();
    const h = await panel([a]);
    (q(h.host, "units-create-title") as HTMLInputElement).value = "Draft unit";
    btn(h, `units-edit-${a.unitId}`).click();
    const title = q(h.host, `units-edit-title-${a.unitId}`) as HTMLInputElement;
    title.value = "My draft";
    const check = btn(h, "units-check-changes");
    press(check);
    expect(status(h)).toBe("Refreshing your units...");
    expect(check.getAttribute("aria-disabled")).toBe("true");
    check.click();
    expect(h.c.list).toHaveBeenCalledTimes(2);
    expect(last(h, "list").req).toEqual({ grade: "7", includeArchived: false });
    last(h, "list").d.resolve({ units: [next(a, { title: "Theirs" })] });
    await tick();
    expect(status(h)).toBe("Your units were refreshed.");
    expect(check.getAttribute("aria-disabled")).toBeNull();
    expect(document.activeElement).toBe(check);
    expect((q(h.host, "units-create-title") as HTMLInputElement).value).toBe("Draft unit");
    expect(q(h.host, `units-edit-title-${a.unitId}`)).toBe(title);
    expect(title.value).toBe("My draft");
    expect(h.c.update).not.toHaveBeenCalled();
  });

  test("shows membership changed elsewhere", async () => {
    const a = unit({ resourceIds: [R1.id] });
    const h = await panel([a]);
    await checkChanges(h, [next(a, { resourceIds: [R1.id, R2.id] })]);
    expect(q(h.host, `units-resource-remove-${a.unitId}-${R2.id}`)).not.toBeNull();
  });

  test("an older read never replaces a newer accepted record", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    press(btn(h, "units-check-changes"));
    const read = last(h, "list");
    btn(h, `units-resource-remove-${a.unitId}-${R1.id}`).click();
    last(h, "setResources").d.resolve({ unit: next(a, { resourceIds: [R2.id] }), noop: false });
    await tick();
    read.d.resolve({ units: [a] });
    await tick();
    expect(q(h.host, `units-resource-remove-${a.unitId}-${R1.id}`)).toBeNull();
    expect(q(h.host, `units-resource-remove-${a.unitId}-${R2.id}`)).not.toBeNull();
  });

  test("after an unconfirmed remove: points to Refresh units, then reports from the newer record, never resending", async () => {
    const a = unit();
    const h = await panel([a]);
    press(btn(h, `units-resource-remove-${a.unitId}-${R1.id}`));
    last(h, "setResources").d.reject(LOST());
    await tick();
    last(h, "get").d.reject(LOST());
    await tick();
    const notice = noticeOf(h, a) as HTMLElement;
    expect(notice.textContent).toContain("Choose Refresh units before trying again.");
    // No unsupported "Refresh" instruction: only the Refresh units control is named.
    expect(notice.textContent).not.toMatch(/\bRefresh\b(?! units\b)/);
    await checkChanges(h, [next(a, { resourceIds: [R2.id] })]);
    expect(notice.textContent).toContain("couldn't confirm whether your change was saved");
    expect(notice.textContent).not.toContain("Choose Refresh units before trying again.");
    expect(h.c.setResources).toHaveBeenCalledTimes(1);
  });

  test("A3-3: responseUnavailable after a remove reads as unconfirmed, never resent", async () => {
    const a = unit();
    const h = await panel([a]);
    press(btn(h, `units-resource-remove-${a.unitId}-${R1.id}`));
    last(h, "setResources").d.reject(Object.assign(new Error("x"), {
      code: "unavailable",
      details: { code: "teacherUnits.responseUnavailable", outcome: "unconfirmed", operation: "setResources" },
    }));
    await tick();
    last(h, "get").d.reject(LOST());
    await tick();
    const notice = noticeOf(h, a) as HTMLElement;
    expect(notice.textContent).toContain("Choose Refresh units before trying again.");
    expect(h.c.setResources).toHaveBeenCalledTimes(1);
  });

  test("A3-3: an availability refusal on a check names availability, not the connection", async () => {
    const a = unit();
    const h = await panel([a]);
    press(btn(h, "units-check-changes"));
    last(h, "list").d.reject(Object.assign(new Error("x"), {
      code: "failed-precondition",
      details: { code: "teacherUnits.availabilityClosed" },
    }));
    await tick();
    const alert = q(h.host, "units-list-state")?.querySelector("[role=alert]")?.textContent ?? "";
    expect(alert).toContain("because Teacher Units isn't available right now");
    expect(alert).not.toContain("connection");
  });

  test("a failed check shows the list alert, clears its pending message, and announces no success", async () => {
    const a = unit();
    const h = await panel([a]);
    press(btn(h, "units-check-changes"));
    last(h, "list").d.reject(LOST());
    await tick();
    expect(q(h.host, "units-list-state")?.querySelector("[role=alert]")?.textContent).toContain("Your units couldn't be loaded");
    expect(status(h)).toBe("");
    expect(btn(h, "units-check-changes").getAttribute("aria-disabled")).toBeNull();
    expect(q(h.host, `units-card-${a.unitId}`)).not.toBeNull();
  });

  test("an account change during the check accepts nothing and announces nothing", async () => {
    const a = unit();
    const h = await panel([a]);
    press(btn(h, "units-check-changes"));
    h.switchAccount();
    last(h, "list").d.resolve({ units: [next(a, { title: "Other account" })] });
    await tick();
    expect(h.host.textContent).not.toContain("Other account");
    expect(status(h)).not.toBe("Your units were refreshed.");
  });
});

describe("messages", () => {
  test("unconfirmed edit, archive and restore name their own operation, never resources", async () => {
    const a = unit();
    const h = await panel([a]);
    btn(h, `units-edit-${a.unitId}`).click();
    (q(h.host, `units-edit-title-${a.unitId}`) as HTMLInputElement).value = "X";
    press(btn(h, `units-edit-save-${a.unitId}`));
    last(h, "update").d.reject(LOST());
    await tick();
    // A3-4 S2: one automatic reread; here it fails, so nothing is known now.
    last(h, "get").d.reject(LOST());
    await tick();
    let text = noticeOf(h, a)?.textContent ?? "";
    expect(text).toContain("LyfeLabz couldn't confirm whether your changes were saved.");
    expect(text).toContain("Your edits are still here.");
    expect(text).toContain("Choose Refresh units");
    expect(text).not.toMatch(/resource/i);
    btn(h, `units-edit-cancel-${a.unitId}`).click();
    // A3-4 S2 (D3): after the unconfirmed edit and its failed read, a new
    // change needs the unit's current state first.
    await checkChanges(h, [a]);
    press(btn(h, `units-archive-${a.unitId}`));
    last(h, "archive").d.reject(LOST());
    await tick();
    last(h, "get").d.reject(LOST());
    await tick();
    text = noticeOf(h, a)?.textContent ?? "";
    expect(text).toContain("LyfeLabz couldn't confirm whether this unit was archived.");
    expect(text).not.toMatch(/resource/i);
    // A newer record then says where the unit is, without rewriting history.
    h.ctl.setShowArchived(true);
    last(h, "list").d.resolve({ units: [archivedOf(a)] });
    await tick();
    text = noticeOf(h, a)?.textContent ?? "";
    expect(text).toBe("LyfeLabz couldn't confirm whether this unit was archived. It is archived now.");
    press(btn(h, `units-restore-${a.unitId}`));
    last(h, "restore").d.reject(LOST());
    await tick();
    last(h, "get").d.reject(LOST());
    await tick();
    text = noticeOf(h, a)?.textContent ?? "";
    expect(text).toContain("LyfeLabz couldn't confirm whether this unit was restored.");
    expect(text).not.toMatch(/resource/i);
  });

  test("conflict and archived-refusal wording does not say who or where", async () => {
    const a = unit();
    const h = await panel([a]);
    btn(h, `units-edit-${a.unitId}`).click();
    (q(h.host, `units-edit-title-${a.unitId}`) as HTMLInputElement).value = "Mine";
    press(btn(h, `units-edit-save-${a.unitId}`));
    last(h, "update").d.reject(CONFLICT());
    await tick();
    last(h, "get").d.resolve({ unit: next(a, { title: "Theirs" }) });
    await tick();
    const text = noticeOf(h, a)?.textContent ?? "";
    expect(text).toContain("This unit changed since it was loaded here, so LyfeLabz couldn't confirm whether your change was saved.");
    expect(h.host.textContent).not.toMatch(/somewhere else|another (person|teacher|session)/);
  });

  test("unconfirmed create wording uses the LyfeLabz voice without request mechanics", async () => {
    const h = await panel([]);
    (q(h.host, "units-create-title") as HTMLInputElement).value = "Rocks";
    btn(h, "units-create-submit").click();
    last(h, "create").d.reject(LOST());
    await tick();
    const rec = q(h.host, "units-recovery")?.textContent ?? "";
    expect(rec).toContain("LyfeLabz couldn't confirm whether this unit was created. Choose Check again.");
    expect(rec + status(h)).not.toMatch(/\bWe\b|original request|Refresh/);
  });
});

describe("field error associations", () => {
  test("create: the invalid field is marked and described by the error, and cleared when fixed", async () => {
    const h = await panel([]);
    btn(h, "units-create-submit").click();
    const title = q(h.host, "units-create-title") as HTMLInputElement;
    const error = q(h.host, "units-create-error") as HTMLElement;
    expect(error.textContent).toBe("Enter a unit name.");
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(title.getAttribute("aria-describedby")).toBe(error.id);
    expect(error.id).not.toBe("");
    expect(document.activeElement).toBe(title);
    expect(q(h.host, "units-create-description")?.hasAttribute("aria-invalid")).toBe(false);
    title.value = "Fixed";
    btn(h, "units-create-submit").click();
    expect(title.hasAttribute("aria-invalid")).toBe(false);
    expect(title.hasAttribute("aria-describedby")).toBe(false);
  });

  test("edit: the invalid field is marked and focused; a new submit clears it", async () => {
    const a = unit();
    const h = await panel([a]);
    btn(h, `units-edit-${a.unitId}`).click();
    const title = q(h.host, `units-edit-title-${a.unitId}`) as HTMLInputElement;
    title.value = "   ";
    press(btn(h, `units-edit-save-${a.unitId}`));
    await tick();
    const error = title.form!.querySelector<HTMLElement>(".shell-units-error") as HTMLElement;
    expect(error.hidden).toBe(false);
    expect(title.getAttribute("aria-invalid")).toBe("true");
    expect(title.getAttribute("aria-describedby")).toBe(error.id);
    expect(document.activeElement).toBe(title);
    title.value = "Good";
    press(btn(h, `units-edit-save-${a.unitId}`));
    expect(title.hasAttribute("aria-invalid")).toBe(false);
  });
});

describe("panel styles", () => {
  const css = fs.readFileSync(path.resolve(__dirname, "../../../index.html"), "utf8");
  test("forced colors: My Units controls get a system-color outline (panel-scoped)", () => {
    const block = css.match(/@media \(forced-colors: active\) \{([\s\S]*?)\n {2}\}/)?.[1] ?? "";
    expect(block).toContain(".shell-units .shell-btn:focus-visible");
    expect(block).toContain(".shell-units-heading:focus");
    expect(block).toMatch(/outline: 2px solid CanvasText/);
  });
  test("the heading shows focus, and pending controls read as unavailable", () => {
    expect(css).not.toContain(".shell-units-heading:focus { outline: none; }");
    expect(css).toMatch(/\.shell-units-heading:focus \{ outline: var\(--tw-focus-outline\)/);
    expect(css).toContain('.shell-units .shell-btn[aria-disabled="true"]');
  });
});

// ---------- U2.5 certification remediation (F1-F3) ----------

const CHECKED = "Your units were refreshed.";

describe("F1: Refresh units announces only its own accepted read", () => {
  test("superseded by another list read that settles first: no success announcement", async () => {
    const a = unit();
    const h = await panel([a]);
    press(btn(h, "units-check-changes"));
    const mine = last(h, "list");
    void h.ctl.refresh();
    const newer = last(h, "list");
    newer.d.resolve({ units: [next(a, { title: "Newer" })] });
    await tick();
    mine.d.resolve({ units: [a] });
    await tick();
    expect(status(h)).not.toBe(CHECKED);
    expect(h.host.textContent).toContain("Newer");
  });

  test("superseded by a grade change: no success announcement in either settle order", async () => {
    for (const newerFirst of [true, false]) {
      document.body.textContent = "";
      const a = unit();
      const h = await panel([a]);
      press(btn(h, "units-check-changes"));
      const mine = last(h, "list");
      h.ctl.setGrade("8");
      const newer = last(h, "list");
      if (newerFirst) {
        newer.d.resolve({ units: [] });
        await tick();
        mine.d.resolve({ units: [a] });
      } else {
        mine.d.resolve({ units: [a] });
        await tick();
        newer.d.resolve({ units: [] });
      }
      await tick();
      expect([newerFirst, status(h)]).not.toEqual([newerFirst, CHECKED]);
    }
  });

  test("superseded by the archived view toggle: no success announcement", async () => {
    const a = unit();
    const h = await panel([a]);
    press(btn(h, "units-check-changes"));
    const mine = last(h, "list");
    h.ctl.setShowArchived(true);
    last(h, "list").d.resolve({ units: [a] });
    await tick();
    mine.d.resolve({ units: [a] });
    await tick();
    expect(status(h)).not.toBe(CHECKED);
  });

  test("an account change before dispatch sends nothing and announces nothing", async () => {
    const a = unit();
    const h = await panel([a]);
    h.switchAccount();
    press(btn(h, "units-check-changes"));
    await tick();
    expect(h.c.list).toHaveBeenCalledTimes(1);
    expect(status(h)).not.toBe(CHECKED);
  });

  test("an account change during the read, settled after a newer list: no announcement", async () => {
    const a = unit();
    const h = await panel([a]);
    press(btn(h, "units-check-changes"));
    const mine = last(h, "list");
    h.switchAccount();
    mine.d.resolve({ units: [next(a, { title: "Other" })] });
    await tick();
    expect(status(h)).not.toBe(CHECKED);
    expect(h.host.textContent).not.toContain("Other");
  });

  test("a completion after the panel is torn down announces nothing", async () => {
    const a = unit();
    const h = await panel([a]);
    press(btn(h, "units-check-changes"));
    const statusEl = q(h.host, "units-status") as HTMLElement;
    h.host.remove();
    // The controller is released on the next render of a detached panel.
    void h.ctl.refresh();
    h.calls.list.forEach((c) => c.d.resolve({ units: [a] }));
    await tick();
    expect(statusEl.textContent).not.toBe(CHECKED);
  });

  test("the unsuperseded read still announces, and a failure never does", async () => {
    const a = unit();
    const h = await panel([a]);
    await checkChanges(h, [a]);
    expect(status(h)).toBe(CHECKED);
    press(btn(h, "units-check-changes"));
    last(h, "list").d.reject(LOST());
    await tick();
    expect(status(h)).toBe("");
  });
});

describe("F2: create completion respects focus ownership", () => {
  const startCreate = async (h: H, title: string) => {
    press(btn(h, "units-create-open"));
    const input = q(h.host, "units-create-title") as HTMLInputElement;
    input.value = title;
    input.focus();
    (q(h.host, "units-create-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await tick();
  };

  test("focus moved to another unit while pending stays there; the creation is still announced", async () => {
    const a = unit();
    const h = await panel([a]);
    await startCreate(h, "Weather");
    const edit = btn(h, `units-edit-${a.unitId}`);
    edit.focus();
    last(h, "create").d.resolve({ unit: unit({ title: "Weather", resourceIds: [] }), replayed: false });
    await tick();
    expect(document.activeElement).toBe(edit);
    expect(status(h)).toBe('Created "Weather" in Grade 7.');
  });

  test("focus moved to the grade filter (Tab away) while pending stays there", async () => {
    const h = await panel([]);
    await startCreate(h, "Weather");
    const pill = btn(h, "units-grade-6");
    pill.focus();
    last(h, "create").d.resolve({ unit: unit({ title: "Weather", resourceIds: [] }), replayed: false });
    await tick();
    expect(document.activeElement).toBe(pill);
  });

  test("an unconfirmed create while focus is elsewhere keeps that focus and keeps the recovery", async () => {
    const a = unit();
    const h = await panel([a]);
    await startCreate(h, "Rocks");
    const edit = btn(h, `units-edit-${a.unitId}`);
    edit.focus();
    last(h, "create").d.reject(LOST());
    await tick();
    expect(document.activeElement).toBe(edit);
    expect(q(h.host, "units-recovery")?.textContent).toContain("LyfeLabz couldn't confirm whether this unit was created.");
    expect(status(h)).toContain("LyfeLabz couldn't confirm whether this unit was created.");
  });

  test("focus still in the create form moves to the new unit's card (Milestone 1)", async () => {
    const h = await panel([]);
    await startCreate(h, "Weather");
    const created = unit({ title: "Weather", resourceIds: [] });
    last(h, "create").d.resolve({ unit: created, replayed: false });
    await tick();
    expect(document.activeElement).toBe(btn(h, `units-toggle-${created.unitId}`));
  });

  test("a completion after an account change moves no focus", async () => {
    const a = unit();
    const h = await panel([a]);
    await startCreate(h, "Weather");
    const edit = btn(h, `units-edit-${a.unitId}`);
    edit.focus();
    h.switchAccount();
    last(h, "create").d.resolve({ unit: unit({ title: "Weather", resourceIds: [] }), replayed: false });
    await tick();
    expect(document.activeElement).toBe(edit);
  });
});

describe("F3: confirmed and uncertain membership outcomes stay distinct", () => {
  test("a confirmed write whose loaded record lags is reported as saved, never as uncertain", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    press(btn(h, `units-resource-remove-${a.unitId}-${R1.id}`));
    // The response record does not reflect the committed list.
    last(h, "setResources").d.resolve({ unit: { ...a, revision: 2 }, noop: false });
    await tick();
    expect(status(h)).toContain(`Removed "${R1.title}" from "${a.title}".`);
    expect(status(h)).toContain("Your change was saved, but the latest loaded resources don't show it yet.");
    expect(status(h)).not.toMatch(/couldn't confirm|can't tell|whether this request took effect/);
  });

  test("a confirmed write followed by a failed Refresh units stays confirmed", async () => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    btn(h, `units-resource-remove-${a.unitId}-${R1.id}`).click();
    last(h, "setResources").d.resolve({ unit: next(a, { resourceIds: [R2.id] }), noop: false });
    await tick();
    const text = status(h);
    expect(text).toBe(`Removed "${R1.title}" from "${a.title}".`);
    press(btn(h, "units-check-changes"));
    last(h, "list").d.reject(LOST());
    await tick();
    expect(h.host.textContent).not.toMatch(/couldn't confirm whether your change/);
  });

  test("a lost response is still reported as unconfirmed", async () => {
    const a = unit();
    const h = await panel([a]);
    press(btn(h, `units-resource-remove-${a.unitId}-${R1.id}`));
    last(h, "setResources").d.reject(LOST());
    await tick();
    last(h, "get").d.resolve({ unit: a });
    await tick();
    expect(noticeOf(h, a)?.textContent).toContain("LyfeLabz couldn't confirm whether your change was saved.");
  });
});

// A3-3 section 5.1 (Option A): writeConflict and invalidStatus come from a
// transaction attempt. An earlier SDK attempt of the SAME request may already
// have committed, so the panel must not claim the change was not saved, and
// must never resend. Reproduces the certification probes.
describe("A3-3 transaction-attempt refusals after an earlier committed attempt", () => {
  const editTo = (h: H, a: TeacherUnit, value: string) => {
    btn(h, `units-edit-${a.unitId}`).click();
    (q(h.host, `units-edit-title-${a.unitId}`) as HTMLInputElement).value = value;
    press(btn(h, `units-edit-save-${a.unitId}`));
  };

  test("writeConflict: the reread shows the committed rename, the notice says unconfirmed, nothing is resent", async () => {
    const a = unit();
    const h = await panel([a]);
    editTo(h, a, "Renamed");
    await tick();
    last(h, "update").d.reject(CONFLICT());
    await tick();
    // The earlier attempt committed: the authoritative read holds the rename.
    last(h, "get").d.resolve({ unit: next(a, { title: "Renamed" }) });
    await tick();
    const text = noticeOf(h, a)?.textContent ?? "";
    expect(text).toContain("so LyfeLabz couldn't confirm whether your change was saved");
    expect(text).not.toMatch(/wasn't saved|was not saved|weren't saved|nothing was/);
    expect(text).toContain('"Renamed"');
    expect(h.c.update).toHaveBeenCalledTimes(1);
    expect(h.ctl.getKnownUnit(a.unitId)?.title).toBe("Renamed");
  });

  test("invalidStatus: the reread shows the committed rename on an archived unit, unconfirmed, nothing is resent", async () => {
    const a = unit();
    const h = await panel([a]);
    editTo(h, a, "Renamed");
    await tick();
    last(h, "update").d.reject({ details: { code: "teacherUnits.invalidStatus" } });
    await tick();
    last(h, "get").d.resolve({ unit: archivedOf(next(a, { title: "Renamed" })) });
    await tick();
    const card = q(h.host, `units-card-${a.unitId}`)?.textContent ?? "";
    expect(card).toContain("This unit was archived, so LyfeLabz couldn't confirm whether your changes were saved.");
    expect(card).not.toMatch(/wasn't saved|was not saved|weren't saved/);
    expect(h.c.update).toHaveBeenCalledTimes(1);
    expect(h.ctl.getKnownUnit(a.unitId)).toMatchObject({ status: "archived", title: "Renamed" });
  });

  test("a no-op response is not reported as the whole request changing nothing", async () => {
    const a = unit();
    const h = await panel([a]);
    editTo(h, a, "Renamed");
    await tick();
    last(h, "update").d.resolve({ unit: next(a, { title: "Renamed" }), noop: true });
    await tick();
    expect(status(h)).toBe("No change was needed when this request was checked.");
    expect(status(h)).not.toMatch(/made no changes|Nothing was changed/);
    expect(h.c.update).toHaveBeenCalledTimes(1);
  });
});
