/** @jest-environment jsdom */
import { renderTeacherUnitsPanel, type UnitsCapability } from "./teacherUnitsPanel";
// These suites exercise an open unit; collapse is covered by teacherUnits.compact.test.ts.
// Explicit test substitution; compiler production availability stays closed.
const enabledCapability = {
  getSnapshot: () => ({ status: "enabled" as const }),
  subscribe: () => () => undefined,
  refresh: async () => undefined,
  enter: async () => undefined,
  revalidate: async () => undefined,
  invalidate: () => undefined,
  dispose: () => undefined,
} as unknown as UnitsCapability;
const EXPANDED = { unitsInitiallyExpanded: true, capability: enabledCapability } as const;
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
  color: null,
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
const toGrade = async (h: H, g: "6" | "7", units: TeacherUnit[]) => {
  h.ctl.setGrade(g);
  last(h.calls.list).d.resolve({ units });
  await tick();
};
const CONFLICT = () => ({ details: { code: "teacherUnits.writeConflict" } });
const DENIED = () => ({ code: "functions/permission-denied", details: { code: "permission-denied" } });
const cardNotice = (h: H, u: TeacherUnit) =>
  q(h.host, `units-card-${u.unitId}`)?.querySelector<HTMLElement>(":scope > p.shell-units-notice") ?? null;

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


const statusText = (h: H) => q(h.host, "units-status")?.textContent ?? "";
const addVia = (h: H, u: TeacherUnit) => {
  (q(h.host, `units-resources-add-${u.unitId}`) as HTMLButtonElement).click();
  (q(h.host, `units-picker-option-${u.unitId}-${R1.id}`) as HTMLInputElement).click();
  (q(h.host, `units-picker-${u.unitId}`) as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
};
const repairVia = (h: H, u: TeacherUnit) => {
  (q(h.host, `units-retired-remove-${u.unitId}`) as HTMLButtonElement).click();
  (q(h.host, `units-retired-confirm-${u.unitId}`) as HTMLButtonElement).click();
};

describe("notice contract: immutable outcome, live membership", () => {
  test.each([false, true])("removal (noop=%s) follows later re-add, removal, and rename", async noop => {
    const a = unit({ resourceIds: [R1.id, R2.id] });
    const h = await panel([a]);
    clickRemove(h, a, R1.id);
    last(h.calls.setResources).d.resolve({ unit: { ...a, resourceIds: [R2.id], revision: 2 }, noop });
    await tick();
    await refreshWith(h, [{ ...a, title: "Renamed", revision: 3 }]);
    expect(statusText(h)).not.toContain(`"${R1.title}" isn't in`);
    expect(statusText(h)).toContain('"Renamed"');
    expect(statusText(h)).toContain(noop ? "No change was needed when this request was checked" : "saved");
    await refreshWith(h, [{ ...a, title: "Renamed", resourceIds: [R2.id], revision: 4 }]);
    expect(statusText(h)).not.toMatch(/is in .*again|is in .*because/);
    expect(statusText(h)).toContain(noop ? "No change was needed when this request was checked" : "Removed");
  });
  test.each([false, true])("addition (noop=%s) follows later removal and re-add", async noop => {
    const a = unit({ resourceIds: [R2.id] });
    const h = await panel([a]);
    addVia(h, a);
    last(h.calls.setResources).d.resolve({ unit: { ...a, resourceIds: [R2.id, R1.id], revision: 2 }, noop });
    await tick();
    await refreshWith(h, [{ ...a, revision: 3 }]);
    expect(statusText(h)).not.toMatch(/are already in/);
    expect(statusText(h)).toContain("not every resource");
    expect(statusText(h)).toContain(noop ? "No change was needed when this request was checked" : "saved");
    await refreshWith(h, [{ ...a, resourceIds: [R2.id, R1.id], revision: 4 }]);
    expect(statusText(h)).not.toContain("not every resource");
  });
  test.each([false, true])("repair (noop=%s) follows newly unavailable membership, partial and complete repair", async noop => {
    const a = unit({ resourceIds: [R1.id, "retired-a", "retired-b"] });
    const h = await panel([a]);
    repairVia(h, a);
    last(h.calls.setResources).d.resolve({ unit: { ...a, resourceIds: [R1.id], revision: 2 }, noop });
    await tick();
    await refreshWith(h, [{ ...a, revision: 3 }]);
    expect(statusText(h)).not.toContain("has no unavailable resources");
    expect(statusText(h)).toContain("has unavailable resources");
    await refreshWith(h, [{ ...a, resourceIds: [R1.id, "retired-b"], revision: 4 }]);
    expect(statusText(h)).toContain("has unavailable resources");
    await refreshWith(h, [{ ...a, resourceIds: [R1.id], revision: 5 }]);
    expect(statusText(h)).not.toContain("has unavailable resources");
  });
  test("superseding post-commit response is reworded after later removal", async () => {
    const a = unit(); const h = await panel([a]);
    clickRemove(h, a, R1.id);
    last(h.calls.setResources).d.resolve({ unit: { ...a, revision: 3 }, noop: false });
    await tick(); expect(statusText(h)).toContain("is in");
    await refreshWith(h, [{ ...a, revision: 4, resourceIds: [R2.id] }]);
    expect(statusText(h)).not.toContain("is in");
    expect(statusText(h)).toContain("Removed");
  });
  test("durable confirmations retain identity and dismissal across membership, archive, absence, and restore", async () => {
    const a = unit(); const h = await panel([a]);
    clickRemove(h, a, R1.id);
    await checkWith(h, [archived(a, 3)]);
    last(h.calls.setResources).d.resolve({ unit: { ...a, revision: 2, resourceIds: [R2.id] }, noop: true });
    await tick();
    const e = h.host.querySelector<HTMLElement>('[data-outcome-kind="confirmed"]')!;
    const id = e.dataset.testid; const dismiss = e.querySelector<HTMLButtonElement>('button')!;
    await refreshWith(h, [{ ...a, revision: 4, resourceIds: [R2.id] }]);
    expect(e.textContent).not.toMatch(/is in .*because/);
    await checkWith(h, []);
    expect(e.textContent).toContain("no longer in your units");
    expect(e.textContent).not.toMatch(/Refresh|Restore|try again/);
    await refreshWith(h, [{ ...a, revision: 5 }]);
    expect(e.dataset.testid).toBe(id); expect(e.querySelector('button')).toBe(dismiss);
    dismiss.focus(); dismiss.click(); expect(e.isConnected).toBe(false);
  });
});

describe("accepted authority reconciles while display is unavailable", () => {
  test.each(["loading", "error"])("absence accepted while display %s removes stale instructions", async display => {
    const a = unit(); const h = await panel([a]);
    clickRemove(h, a, R1.id); last(h.calls.setResources).d.reject(DENIED()); await tick();
    const check = h.ctl.checkRecovery(); last(h.calls.list).d.resolve({ units: [] }); await check;
    if (display === "error") { last(h.calls.list).d.reject({ code: "unavailable" }); await tick(); }
    expect(h.ctl.getUnitState(a.unitId).kind).toBe("absent");
    const n = cardNotice(h, a)!;
    expect(n.textContent).toContain("no longer in your units");
    expect(n.textContent).not.toMatch(/Check this unit|trying again|sign in again|Restore/);
  });
  test.each(["loading", "error"])("new record accepted while display %s updates conflict values", async display => {
    const a = unit(); const h = await panel([a]);
    await editConflict(h, a, { ...a, title: "Old reconciliation", revision: 2 });
    const check = h.ctl.checkRecovery();
    last(h.calls.list).d.resolve({ units: [{ ...a, title: "Newest accepted", description: "Newest description", revision: 3 }] });
    await check;
    if (display === "error") { last(h.calls.list).d.reject({ code: "unavailable" }); await tick(); }
    const n = cardNotice(h, a)!;
    expect(n.textContent).toContain("Newest accepted"); expect(n.textContent).toContain("Newest description");
    expect(n.textContent).not.toContain("Old reconciliation");
  });
  test("durable outcome and status reconcile absence before failed follow-up display", async () => {
    const a = unit(); const h = await panel([a]); clickRemove(h, a, R1.id);
    await checkWith(h, [archived(a, 3)]);
    last(h.calls.setResources).d.resolve({ unit: { ...a, revision: 2, resourceIds: [R2.id] }, noop: true }); await tick();
    const e = h.host.querySelector<HTMLElement>('[data-outcome-kind="confirmed"]')!;
    const p = h.ctl.checkRecovery(); last(h.calls.list).d.resolve({ units: [] }); await p;
    last(h.calls.list).d.reject({ code: "unavailable" }); await tick();
    expect(e.textContent).toContain("no longer in your units");
    expect(statusText(h)).toContain("no longer in your units");
    expect(e.textContent).not.toMatch(/is archived|Refresh|Restore/);
  });
  test("same accepted meaning does not rewrite notice nodes or labels", async () => {
    const a = unit(); const h = await panel([a]); clickRemove(h, a, R1.id);
    await checkWith(h, [archived(a, 3)]);
    last(h.calls.setResources).d.resolve({ unit: { ...a, revision: 2, resourceIds: [R2.id] }, noop: true }); await tick();
    const e = h.host.querySelector<HTMLElement>('[data-outcome-kind="confirmed"]')!;
    const mutations: MutationRecord[] = [];
    const observer = new MutationObserver(rs => mutations.push(...rs));
    observer.observe(e, { childList: true, characterData: true, attributes: true, subtree: true });
    h.ctl.setGrade("7"); h.ctl.setShowArchived(false); await tick();
    observer.disconnect(); expect(mutations).toHaveLength(0);
  });
});

describe("operation-specific wording", () => {
  test("authorization failure does not assert which server phase failed", async () => {
    const a = unit(); const h = await panel([a]); clickRemove(h, a, R1.id);
    last(h.calls.setResources).d.reject(DENIED()); await tick();
    expect(cardNotice(h, a)?.textContent).not.toMatch(/wasn't allowed to make this change|was rejected|Your change was saved\./);
    expect(cardNotice(h, a)?.textContent).toContain("couldn't confirm whether");
  });
  test("duplicate refusal describes repeated submitted IDs", async () => {
    const a = unit(); const h = await panel([a]); clickRemove(h, a, R1.id);
    last(h.calls.setResources).d.reject({ details: { code: "teacherUnits.duplicateResource" } }); await tick();
    last(h.calls.get).d.resolve({ unit: { ...a, revision: 2, resourceIds: [] } }); await tick();
    expect(cardNotice(h, a)?.textContent).toContain("repeated resource");
    expect(cardNotice(h, a)?.textContent).not.toContain("already in this unit");
  });
  test.each(["unavailable", "unexpected", "teacherUnits.invalidRequest"])("Check my units %s failure is read-specific", async code => {
    const a = unit(); const h = await panel([a]);
    const p = h.ctl.submitCreate({ grade: "7", title: "Unconfirmed", description: "" }); await p;
    const check = h.ctl.checkRecovery(); last(h.calls.list).d.reject({ code, details: { code } }); await check;
    expect(q(h.host, "units-recovery")?.textContent).not.toContain("saved");
    expect(q(h.host, "units-recovery")?.textContent).toContain("couldn't check");
  });
  test("grade filter distinguishes the pinned editor from the filtered list", async () => {
    const a = unit(); const h = await panel([a]); await editConflict(h, a, { ...a, revision: 2 });
    await toGrade(h, "6", []);
    expect(q(h.host, `units-edit-title-${a.unitId}`)?.isConnected).toBe(true);
    expect(cardNotice(h, a)?.textContent).toContain("editor is still open");
    expect(cardNotice(h, a)?.textContent).toContain("Grade 6 list");
    expect(cardNotice(h, a)?.textContent).not.toContain("isn't shown in Grade 6");
  });
});

describe("internal falsification: presentation acceptance and live-region equality", () => {
  test.each(["notFound", "conflict"])("a %s result accepted after display failure updates existing retained notices", async failure => {
    const a = unit(); const h = await panel([a]);
    clickRemove(h, a, R1.id); last(h.calls.setResources).d.reject(DENIED()); await tick();
    await toGrade(h, "6", []); // First operation is now durable.
    const e = h.host.querySelector<HTMLElement>('[data-outcome-kind="error"]')!;
    await toGrade(h, "7", [a]);
    clickRemove(h, a, R1.id);
    const p = h.ctl.refresh(); last(h.calls.list).d.reject({ code: "unavailable" }); await p;
    if (failure === "notFound") last(h.calls.setResources).d.reject({ details: { code: "teacherUnits.notFound" } });
    else {
      last(h.calls.setResources).d.reject(CONFLICT()); await tick();
      last(h.calls.get).d.resolve({ unit: { ...a, title: "Newly accepted", status: "archived", archivedAtMillis: 1, revision: 3 } });
    }
    await tick();
    expect(e.textContent).toContain(failure === "notFound" ? "no longer in your units" : "Newly accepted");
    expect(e.textContent).not.toContain("Check this unit before trying again");
    expect(q(h.host, `units-resource-remove-${a.unitId}-${R1.id}`)).toBeNull();
  });
  test("unchanged accepted state does not rewrite shared membership status during refresh", async () => {
    const a = unit(); const h = await panel([a]); clickRemove(h, a, R1.id);
    const saved = { ...a, resourceIds: [R2.id], revision: 2 };
    last(h.calls.setResources).d.resolve({ unit: saved, noop: true }); await tick();
    const records: MutationRecord[] = []; const observer = new MutationObserver(rs => records.push(...rs));
    observer.observe(q(h.host, "units-status")!, { childList: true, characterData: true, subtree: true });
    await refreshWith(h, [saved]); await refreshWith(h, [saved]); observer.disconnect();
    expect(records).toHaveLength(0);
  });
  test("unchanged list authorization error is not recreated on unrelated mutation state", async () => {
    const a = unit(); const h = await panel([a]);
    const p = h.ctl.refresh(); last(h.calls.list).d.reject(DENIED()); await p;
    const box = q(h.host, "units-list-state")!.querySelector('[role=alert]')!;
    const records: MutationRecord[] = []; const observer = new MutationObserver(rs => records.push(...rs));
    observer.observe(q(h.host, "units-list-state")!, { childList: true, characterData: true, subtree: true });
    clickRemove(h, a, R1.id); await tick(); observer.disconnect();
    expect(q(h.host, "units-list-state")!.querySelector('[role=alert]')).toBe(box);
    expect(records).toHaveLength(0);
  });
  test("open picker label follows accepted rename", async () => {
    const a = unit({ resourceIds: [] }); const h = await panel([a]);
    (q(h.host, `units-resources-add-${a.unitId}`) as HTMLButtonElement).click();
    const picker = q(h.host, `units-picker-${a.unitId}`)!;
    await refreshWith(h, [{ ...a, title: "New picker name", revision: 2 }]);
    expect(picker.querySelector('h4')?.textContent).toContain("New picker name");
  });
  test.each([false, true])("two simultaneous confirmations remain independent (reverse=%s)", async reverse => {
    const a = unit(); const b = unit({ title: "Other" }); const h = await panel([a, b]);
    clickRemove(h, a, R1.id); clickRemove(h, b, R1.id);
    await checkWith(h, [archived(a, 3), archived(b, 3)]);
    const order = reverse ? [1, 0] : [0, 1];
    for (const i of order) {
      const u = i === 0 ? a : b;
      h.calls.setResources[i].d.resolve({ unit: { ...u, resourceIds: [R2.id], revision: 2 }, noop: true }); await tick();
    }
    const entries = Array.from(h.host.querySelectorAll<HTMLElement>('[data-outcome-kind="confirmed"]'));
    const ids = entries.map(e => e.dataset.testid);
    await checkWith(h, [{ ...a, revision: 4, resourceIds: [R2.id] }, { ...b, revision: 4 }]);
    expect(entries[order.indexOf(0)].textContent).toContain("isn't in");
    expect(entries[order.indexOf(1)].textContent).toContain("is in");
    expect(entries.map(e => e.dataset.testid)).toEqual(ids);
    entries[0].querySelector<HTMLButtonElement>('button')!.click();
    expect(entries[0].isConnected).toBe(false); expect(entries[1].isConnected).toBe(true);
  });
});


test.each(["add", "remove", "repair"] as const)("a confirmed %s remains historical even when loaded contents don't establish its effect", async action => {
  const a = unit({ resourceIds: action === "add" ? [R2.id] : action === "repair" ? [R1.id, "retired"] : [R1.id, R2.id] });
  const h = await panel([a]);
  if (action === "add") addVia(h, a);
  else if (action === "repair") repairVia(h, a);
  else clickRemove(h, a, R1.id);
  // This inconsistent read does not prove a subsequent mutation, but the
  // saved result still confirms what the revision-guarded request committed.
  last(h.calls.setResources).d.resolve({ unit: { ...a, revision: 2 }, noop: false }); await tick();
  expect(statusText(h)).toContain(action === "add" ? "Added 1 resource" : "Removed");
  expect(statusText(h)).toContain("Your change was saved, but the latest loaded resources don't show it yet.");
  expect(statusText(h)).not.toContain("couldn't confirm whether your change was saved");
  expect(statusText(h)).not.toMatch(/can't tell|whether this request took effect/);
  expect(cardNotice(h, a)?.hidden).toBe(true);
  await refreshWith(h, [{ ...a, resourceIds: action === "add" ? [R2.id, R1.id] : [R2.id], revision: 3 }]);
  expect(statusText(h)).toContain(action === "add" ? "Added 1 resource" : "Removed");
  expect(statusText(h)).not.toContain("don't establish");
  expect(statusText(h)).not.toContain("don't show it yet");
});


test("a retained no-op follows this panel's later successful add/remove without inventing an external author", async () => {
  const a = unit(); const h = await panel([a]); clickRemove(h, a, R1.id);
  await checkWith(h, [archived(a, 3)]);
  last(h.calls.setResources).d.resolve({ unit: { ...a, revision: 2, resourceIds: [R2.id] }, noop: true }); await tick();
  const entry = h.host.querySelector<HTMLElement>('[data-outcome-kind="confirmed"]')!;
  const id = entry.dataset.testid;
  const active = { ...a, revision: 4, resourceIds: [R2.id] };
  await refreshWith(h, [active]);
  addVia(h, active);
  last(h.calls.setResources).d.resolve({ unit: { ...a, revision: 5 }, noop: false }); await tick();
  expect(entry.textContent).toContain("is in");
  expect(entry.textContent).not.toContain("somewhere else");
  expect(entry.textContent).toContain("No change was needed when this request was checked");
  clickRemove(h, a, R1.id);
  last(h.calls.setResources).d.resolve({ unit: { ...a, revision: 6, resourceIds: [R2.id] }, noop: false }); await tick();
  expect(entry.textContent).toContain("isn't in");
  expect(entry.dataset.testid).toBe(id);
  expect(entry.textContent).toContain("No change was needed when this request was checked");
});
