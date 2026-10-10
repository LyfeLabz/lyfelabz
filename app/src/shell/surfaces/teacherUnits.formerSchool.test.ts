/**
 * @jest-environment jsdom
 *
 * U2.2 cross-school recovery visibility (TEACHER_UNITS.md "Former-school
 * notices"): a teacher's unconfirmed create attempt saved under school A
 * stays visible, read-only, after the teacher is authorized for school B.
 * Uses real jsdom localStorage, the real store, controller, and panel.
 */
import * as fs from "fs";
import * as path from "path";
import { renderTeacherUnitsPanel } from "./teacherUnitsPanel";
import {
  createAttemptStorageKey,
  createTeacherUnitCreateAttemptStore,
  legacyCreateAttemptStorageKey,
} from "../../teacherUnits/createAttemptStore";
import {
  createTeacherUnitsController,
  createTeacherUnitsSurfaceSeam,
  type TeacherUnitsController,
} from "../../teacherUnits/unitsController";
import type { PersistedCreateAttempt } from "../../teacherUnits/saveCoordination";
import type { TeacherUnit, TeacherUnitsCallables } from "../../teacherUnits/types";

const T0 = 1_700_000_000_000;
type Scope = { readonly teacherId: string; readonly schoolId: string };
const A: Scope = Object.freeze({ teacherId: "teacherA", schoolId: "schoolA" });
const B: Scope = Object.freeze({ teacherId: "teacherA", schoolId: "schoolB" });
const C: Scope = Object.freeze({ teacherId: "teacherA", schoolId: "school/C" });
const OTHER: Scope = Object.freeze({ teacherId: "teacherZ", schoolId: "schoolA" });
const flush = () => new Promise((r) => setTimeout(r, 0));
const q = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);

const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: "Unit0000000000000001",
  grade: "7",
  title: "Earth",
  description: "",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: 1,
  updatedAtMillis: 1,
  resourceIds: [],
  sortOrder: 0,
  revision: 1,
  ...over,
});

function callables(over: Partial<Record<keyof TeacherUnitsCallables, jest.Mock>> = {}) {
  return {
    create: jest.fn(),
    list: jest.fn(async () => ({ units: [] as TeacherUnit[] })),
    get: jest.fn(),
    update: jest.fn(),
    archive: jest.fn(),
    restore: jest.fn(),
    setResources: jest.fn(),
    reorder: jest.fn(),
    ...over,
  };
}

const record = (
  scope: Scope,
  key: string,
  over: Partial<PersistedCreateAttempt> = {},
): PersistedCreateAttempt => ({
  key,
  payload: { grade: "7", title: "Earth", description: "Secret notes" },
  context: scope,
  status: "inFlight",
  reason: null,
  createdAtMs: T0,
  ...over,
});

const seed = (scope: Scope, key: string, over: Partial<PersistedCreateAttempt> = {}) =>
  expect(createTeacherUnitCreateAttemptStore(scope).save(record(scope, key, over))).toBe("saved");

const snapshot = () => {
  const out: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i) as string;
    out[k] = localStorage.getItem(k) as string;
  }
  return out;
};

function mount(scope: Scope, opts: { c?: ReturnType<typeof callables>; mint?: () => string } = {}) {
  const c = opts.c ?? callables();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const ctl: TeacherUnitsController = createTeacherUnitsController({
    callables: c as unknown as TeacherUnitsCallables,
    session: scope,
    readCurrentContext: () => scope,
    store: createTeacherUnitCreateAttemptStore(scope),
    initialGrade: "7",
    now: () => T0 + 1000,
    mint: opts.mint ?? (() => "key_NEWNEWNEW"),
  });
  const view = renderTeacherUnitsPanel(host, ctl);
  return { host, ctl, c, view };
}

beforeEach(() => {
  document.body.textContent = "";
  localStorage.clear();
  jest.restoreAllMocks();
});

describe("former-school notices", () => {
  test("an A attempt is visible after transfer to B, unchanged, never sent, and nothing is created in B", async () => {
    seed(A, "key_SCHOOLA1");
    const before = snapshot();
    const c = callables();
    const { host, ctl } = mount(B, { c });
    await flush();
    const former = q(host, "units-former-school") as HTMLElement;
    expect(former.hidden).toBe(false);
    expect(former.getAttribute("role")).toBe("region");
    expect(former.querySelector("h4")?.id).toBe(former.getAttribute("aria-labelledby"));
    expect(former.textContent).toContain("previous school");
    expect(former.textContent).toContain("may or may not have been created");
    expect(former.textContent).toContain("won't be created again here");
    expect(former.textContent).toContain("administrator");
    expect(former.textContent).toContain('"Earth" (Grade 7)');
    // No saved payload description or school id is shown.
    expect(former.textContent).not.toContain("Secret notes");
    expect(former.textContent).not.toContain("schoolA");
    expect(q(host, "units-status")?.textContent).toContain("from a previous school");
    // Not a same-school recovery: the B recovery list stays hidden.
    expect((q(host, "units-recovery") as HTMLElement).hidden).toBe(true);
    expect(ctl.getState().recoveries).toHaveLength(0);
    // Exercise every path that rescans: checkRecovery and refresh.
    await ctl.checkRecovery();
    await ctl.refresh();
    expect(c.create).not.toHaveBeenCalled();
    for (const call of c.list.mock.calls) expect(JSON.stringify(call)).not.toContain("schoolA");
    expect(snapshot()).toEqual(before);
  });

  test("a deliberate new unit in B uses a new key and leaves the A record intact", async () => {
    seed(A, "key_SCHOOLA1");
    const aRaw = localStorage.getItem(createAttemptStorageKey(A, "key_SCHOOLA1"));
    const created = unit({ title: "Water" });
    const c = callables({ create: jest.fn(async () => ({ unit: created, replayed: false })) });
    const { host } = mount(B, { c });
    await flush();
    expect((q(host, "units-create-submit") as HTMLButtonElement).disabled).toBe(false);
    const title = q(host, "units-create-title") as HTMLInputElement;
    title.value = "Water";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    (q(host, "units-create-form") as HTMLFormElement).dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await flush();
    expect(c.create).toHaveBeenCalledTimes(1);
    expect(c.create).toHaveBeenCalledWith({
      grade: "7",
      title: "Water",
      description: "",
      idempotencyKey: "key_NEWNEWNEW",
      expectedSchoolId: "schoolB",
    });
    expect(localStorage.getItem(createAttemptStorageKey(A, "key_SCHOOLA1"))).toBe(aRaw);
    expect((q(host, "units-former-school") as HTMLElement).hidden).toBe(false);
  });

  test("the notice has no controls at all (no replay, edit, restore, copy, or discard)", async () => {
    seed(A, "key_SCHOOLA1");
    localStorage.setItem(`${createAttemptStorageKey(A, "key_BROKEN01")}`, "{not json");
    const { host } = mount(B);
    await flush();
    const former = q(host, "units-former-school") as HTMLElement;
    expect(former.querySelectorAll("button, a, input, textarea, select, [tabindex]")).toHaveLength(0);
    expect(former.textContent).toContain("couldn't be read");
  });

  test("another teacher's attempts, in any school, stay invisible", async () => {
    seed(OTHER, "key_OTHER001");
    seed({ teacherId: "teacherZ", schoolId: "schoolC" }, "key_OTHER002");
    // A forged record under teacherZ's key that claims teacherA.
    localStorage.setItem(
      createAttemptStorageKey({ teacherId: "teacherZ", schoolId: "schoolD" }, "key_FORGED01"),
      JSON.stringify({ v: 2, key: "key_FORGED01", payload: { grade: "7", title: "X", description: "" }, context: A, status: "inFlight", reason: null, createdAtMs: T0 }),
    );
    // A uid that merely shares a prefix with teacherA.
    seed({ teacherId: "teacherAB", schoolId: "schoolC" }, "key_PREFIX01");
    const { host, ctl } = mount(B);
    await flush();
    expect(ctl.getState().formerSchool).toEqual({ kind: "ok", attempts: [], unreadable: 0 });
    expect((q(host, "units-former-school") as HTMLElement).hidden).toBe(true);
  });

  test("multiple former-school attempts are listed independently, oldest first", async () => {
    seed(A, "key_SCHOOLA2", { createdAtMs: T0 + 5, payload: { grade: "8", title: "Second", description: "" } });
    seed(A, "key_SCHOOLA1", { createdAtMs: T0, payload: { grade: "6", title: "First", description: "" } });
    seed(C, "key_SCHOOLC1", {
      createdAtMs: T0 + 9,
      status: "unresolved",
      reason: "uncertain",
      payload: { grade: "7", title: "Third", description: "" },
    });
    const { host, ctl } = mount(B);
    await flush();
    const s = ctl.getState().formerSchool;
    expect(s.kind === "ok" && s.attempts.map((a) => a.title)).toEqual(["First", "Second", "Third"]);
    expect(q(host, "units-former-school-item-0")?.textContent).toContain('"First" (Grade 6)');
    expect(q(host, "units-former-school-item-2")?.textContent).toContain('"Third" (Grade 7)');
    expect(q(host, "units-former-school")?.textContent).toContain("3 unit requests");
    expect(q(host, "units-former-school")?.querySelectorAll("h4")).toHaveLength(1);
  });

  test("malformed former-school entries are counted, never shown or deleted", async () => {
    const bad = {
      [createAttemptStorageKey(A, "key_BROKEN01")]: "{not json",
      // Valid JSON whose stored school disagrees with its key.
      [createAttemptStorageKey(A, "key_MISMATCH")]: JSON.stringify({
        v: 2, key: "key_MISMATCH", payload: { grade: "7", title: "Hidden", description: "" },
        context: { teacherId: "teacherA", schoolId: "schoolB" }, status: "inFlight", reason: null, createdAtMs: T0,
      }),
      // A non-canonical school segment.
      [`lyfelabz.teacherUnits.createAttempt.v2/teacherA/%E0%A4%A/key_BADSCHOOL`]: "{}",
      [legacyCreateAttemptStorageKey(A)]: "legacy",
    };
    for (const [k, v] of Object.entries(bad)) localStorage.setItem(k, v);
    const before = snapshot();
    const { host, ctl } = mount(B);
    await flush();
    const s = ctl.getState().formerSchool;
    expect(s).toEqual({ kind: "ok", attempts: [], unreadable: 4 });
    expect(q(host, "units-former-school")?.textContent).not.toContain("Hidden");
    expect(q(host, "units-former-school-unreadable")?.textContent).toContain("4 saved requests");
    // B's own create stays available; former-school entries never block.
    expect((q(host, "units-create-submit") as HTMLButtonElement).disabled).toBe(false);
    expect(snapshot()).toEqual(before);
  });

  test("storage failure keeps evidence and reports conservatively", async () => {
    seed(A, "key_SCHOOLA1");
    const before = snapshot();
    const proto = Object.getPrototypeOf(localStorage) as Storage;
    const get = jest.spyOn(proto, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const remove = jest.spyOn(proto, "removeItem");
    const { host, ctl } = mount(B);
    await flush();
    expect(ctl.getState().formerSchool).toEqual({ kind: "unavailable" });
    expect(ctl.getState().storage).toEqual({ kind: "unavailable" });
    expect((q(host, "units-former-school") as HTMLElement).hidden).toBe(true);
    expect(remove).not.toHaveBeenCalled();
    get.mockRestore();
    expect(snapshot()).toEqual(before);
  });

  test("same-school recovery is unchanged while a former-school notice is shown", async () => {
    seed(A, "key_SCHOOLA1");
    seed(B, "key_SCHOOLB1");
    const created = unit();
    const c = callables({ create: jest.fn(async () => ({ unit: created, replayed: true })) });
    const { host } = mount(B, { c });
    await flush();
    expect((q(host, "units-recovery") as HTMLElement).hidden).toBe(false);
    expect((q(host, "units-create-submit") as HTMLButtonElement).disabled).toBe(true);
    (q(host, "units-recovery-reconcile-key_SCHOOLB1") as HTMLButtonElement).click();
    await flush();
    expect(c.create).toHaveBeenCalledTimes(1);
    expect(c.create).toHaveBeenCalledWith({
      grade: "7", title: "Earth", description: "Secret notes", idempotencyKey: "key_SCHOOLB1", expectedSchoolId: "schoolB",
    });
    expect(localStorage.getItem(createAttemptStorageKey(B, "key_SCHOOLB1"))).toBeNull();
    expect(localStorage.getItem(createAttemptStorageKey(A, "key_SCHOOLA1"))).not.toBeNull();
    expect((q(host, "units-former-school") as HTMLElement).hidden).toBe(false);
    // Back at A, the same record is a normal same-school recovery, not a notice.
    document.body.textContent = "";
    const back = mount(A);
    await flush();
    expect(back.ctl.getState().recoveries.map((r) => r.key)).toEqual(["key_SCHOOLA1"]);
    expect((q(back.host, "units-former-school") as HTMLElement).hidden).toBe(true);
  });
});

describe("lifecycle", () => {
  const seamFor = () =>
    createTeacherUnitsSurfaceSeam({
      callables: callables() as unknown as TeacherUnitsCallables,
      readFirebaseUid: () => current,
      readActiveTeacher: () => (current === null ? null : { uid: current, schoolId: "schoolB" }),
      createStore: (scope) => createTeacherUnitCreateAttemptStore(scope),
    });
  let current: string | null = null;

  test("a teacher change shows only the new teacher's notices", async () => {
    seed(A, "key_SCHOOLA1");
    current = "teacherA";
    const seam = seamFor();
    const first = seam.createController({ uid: "teacherA", schoolId: "schoolB", initialGrade: "7" });
    const s1 = first.getState().formerSchool;
    expect(s1.kind === "ok" && s1.attempts).toHaveLength(1);
    current = "teacherZ";
    first.dispose();
    const second = seam.createController({ uid: "teacherZ", schoolId: "schoolB", initialGrade: "7" });
    expect(second.getState().formerSchool).toEqual({ kind: "ok", attempts: [], unreadable: 0 });
  });

  test("remount refreshes: survives reload, follows the authorized school, and clears once resolved at A", async () => {
    seed(A, "key_SCHOOLA1");
    let m = mount(B);
    await flush();
    expect((q(m.host, "units-former-school") as HTMLElement).hidden).toBe(false);
    m.view.dispose();
    // Reload at B: still discoverable.
    document.body.textContent = "";
    m = mount(B);
    await flush();
    expect((q(m.host, "units-former-school") as HTMLElement).hidden).toBe(false);
    m.view.dispose();
    // Authorized at A again: resolved through normal recovery there.
    document.body.textContent = "";
    const c = callables({ create: jest.fn(async () => ({ unit: unit(), replayed: true })) });
    m = mount(A, { c });
    await flush();
    await m.ctl.reconcileCreate("key_SCHOOLA1");
    expect(localStorage.getItem(createAttemptStorageKey(A, "key_SCHOOLA1"))).toBeNull();
    m.view.dispose();
    // Back at B: the notice is gone, with no misleading success message.
    document.body.textContent = "";
    m = mount(B);
    await flush();
    expect((q(m.host, "units-former-school") as HTMLElement).hidden).toBe(true);
    expect(q(m.host, "units-status")?.textContent).toBe("");
  });

  test("an attempt saved by another tab appears on the next rescan without duplicates", async () => {
    const m = mount(B);
    await flush();
    expect((q(m.host, "units-former-school") as HTMLElement).hidden).toBe(true);
    seed(A, "key_SCHOOLA1");
    await m.ctl.checkRecovery();
    await m.ctl.checkRecovery();
    expect(q(m.host, "units-former-school")?.querySelectorAll("li")).toHaveLength(1);
  });

  test("the former-school region is not displayed while hidden", async () => {
    const html = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
    const style = document.createElement("style");
    style.textContent = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)).map((x) => x[1]).join("\n");
    document.head.appendChild(style);
    try {
      const m = mount(B);
      await flush();
      expect(getComputedStyle(q(m.host, "units-former-school") as HTMLElement).display).toBe("none");
    } finally {
      style.remove();
    }
  });
});

describe("set-aside attempts (P1)", () => {
  test("an attempt set aside at A stays visible at B, unchanged, and is cleared only by its acknowledgment at A", async () => {
    // 1. A real unresolved attempt at A, set aside through the panel.
    const c = callables({ create: jest.fn().mockRejectedValue(new Error("network")) });
    let m = mount(A, { c, mint: () => "key_SETASIDE" });
    await flush();
    const title = q(m.host, "units-create-title") as HTMLInputElement;
    title.value = "Volcanoes";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    (q(m.host, "units-create-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(m.ctl.getState().create.kind).toBe("unresolved");
    expect(m.ctl.abandonCreate("key_SETASIDE")).toBe(true);
    expect(m.ctl.getState().create.kind).toBe("abandoned");
    const asideKey = createAttemptStorageKey(A, "key_SETASIDE");
    expect(JSON.parse(localStorage.getItem(asideKey) as string).status).toBe("abandoned");
    m.view.dispose();
    // A separate unresolved attempt at A.
    seed(A, "key_OPEN0001", { createdAtMs: T0 + 5000, payload: { grade: "8", title: "Rivers", description: "" } });
    // Another teacher's set-aside attempt and a malformed own entry.
    seed(OTHER, "key_OTHER001", { status: "abandoned", reason: "uncertain" });
    localStorage.setItem(createAttemptStorageKey(A, "key_BROKEN01"), "{oops");
    const before = snapshot();

    // 2-6. Transfer to B, then reload (remount) at B.
    for (let i = 0; i < 2; i++) {
      document.body.textContent = "";
      const cb = callables();
      m = mount(B, { c: cb });
      await flush();
      await m.ctl.checkRecovery();
      const s = m.ctl.getState().formerSchool;
      expect(s.kind === "ok" && s.attempts.map((a) => [a.title, a.status])).toEqual([
        ["Volcanoes", "abandoned"],
        ["Rivers", "inFlight"],
      ]);
      expect(s.kind === "ok" && s.unreadable).toBe(1);
      const former = q(m.host, "units-former-school") as HTMLElement;
      expect(former.hidden).toBe(false);
      expect(q(m.host, "units-former-school-item-0")?.textContent).toContain('"Volcanoes" (Grade 7)');
      expect(q(m.host, "units-former-school-item-0")?.textContent).toContain("set aside");
      expect(q(m.host, "units-former-school-item-1")?.textContent).toContain('"Rivers" (Grade 8)');
      expect(former.querySelectorAll("button, a, input, textarea, select, [tabindex]")).toHaveLength(0);
      expect(cb.create).not.toHaveBeenCalled();
      for (const call of cb.list.mock.calls) expect(JSON.stringify(call)).not.toContain("schoolA");
      expect(m.ctl.getState().recoveries).toHaveLength(0);
      expect(snapshot()).toEqual(before);
      m.view.dispose();
    }

    // 7. Back at A, the explicit acknowledgment clears the evidence; then B no longer shows it.
    document.body.textContent = "";
    m = mount(A);
    await flush();
    expect(m.ctl.dismissAbandoned("key_SETASIDE")).toBe(true);
    expect(localStorage.getItem(asideKey)).toBeNull();
    m.view.dispose();
    document.body.textContent = "";
    m = mount(B);
    await flush();
    const after = m.ctl.getState().formerSchool;
    expect(after.kind === "ok" && after.attempts.map((a) => a.title)).toEqual(["Rivers"]);
  });
});

describe("status announcements (P2)", () => {
  const status = (host: HTMLElement) => q(host, "units-status")?.textContent ?? "";

  test("0 -> 2 -> 1 -> 0 -> 0 always reports the current count, and unchanged rescans stay quiet", async () => {
    const m = mount(B);
    await flush();
    expect(status(m.host)).toBe("");
    seed(A, "key_SCHOOLA1");
    seed(C, "key_SCHOOLC1");
    await m.ctl.checkRecovery();
    expect(status(m.host)).toBe("2 unconfirmed unit requests from a previous school are listed in My Units.");
    localStorage.removeItem(createAttemptStorageKey(C, "key_SCHOOLC1"));
    await m.ctl.checkRecovery();
    expect(status(m.host)).toBe("One unconfirmed unit request from a previous school is listed in My Units.");
    expect(q(m.host, "units-former-school")?.textContent).toContain("a unit request");
    localStorage.removeItem(createAttemptStorageKey(A, "key_SCHOOLA1"));
    await m.ctl.checkRecovery();
    expect(status(m.host)).toBe("No unit requests from a previous school are listed now.");
    expect((q(m.host, "units-former-school") as HTMLElement).hidden).toBe(true);
    const node = q(m.host, "units-status") as HTMLElement;
    const writes = jest.fn();
    new MutationObserver(writes).observe(node, { childList: true, characterData: true, subtree: true });
    await m.ctl.checkRecovery();
    await m.ctl.refresh();
    await flush();
    expect(writes).not.toHaveBeenCalled();
    expect(status(m.host)).toBe("No unit requests from a previous school are listed now.");
  });

  test("an unchanged nonzero count is announced once", async () => {
    seed(A, "key_SCHOOLA1");
    const m = mount(B);
    await flush();
    expect(status(m.host)).toBe("One unconfirmed unit request from a previous school is listed in My Units.");
    const node = q(m.host, "units-status") as HTMLElement;
    const writes = jest.fn();
    new MutationObserver(writes).observe(node, { childList: true, characterData: true, subtree: true });
    await m.ctl.checkRecovery();
    await flush();
    expect(writes).not.toHaveBeenCalled();
  });

  test("a teacher change or school remount starts with a fresh status", async () => {
    seed(A, "key_SCHOOLA1");
    let m = mount(B);
    await flush();
    expect(status(m.host)).toContain("previous school");
    m.view.dispose();
    document.body.textContent = "";
    // Another teacher at B: none of teacherA's notices or announcement.
    m = mount({ teacherId: "teacherZ", schoolId: "schoolB" });
    await flush();
    expect(status(m.host)).toBe("");
    expect((q(m.host, "units-former-school") as HTMLElement).hidden).toBe(true);
    m.view.dispose();
    document.body.textContent = "";
    // Same teacher remounted at A: the record is a same-school recovery, no notice.
    m = mount(A);
    await flush();
    expect(status(m.host)).toBe("");
    expect((q(m.host, "units-former-school") as HTMLElement).hidden).toBe(true);
  });

  test("storage failure clears our announcement and never claims zero", async () => {
    seed(A, "key_SCHOOLA1");
    const m = mount(B);
    await flush();
    expect(status(m.host)).toContain("One unconfirmed");
    const proto = Object.getPrototypeOf(localStorage) as Storage;
    const get = jest.spyOn(proto, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    await m.ctl.checkRecovery();
    expect(m.ctl.getState().formerSchool).toEqual({ kind: "unavailable" });
    expect(status(m.host)).toBe("");
    expect(status(m.host)).not.toContain("No unit requests");
    get.mockRestore();
    expect(localStorage.getItem(createAttemptStorageKey(A, "key_SCHOOLA1"))).not.toBeNull();
  });

  test("other status messages are not erased or overwritten by a decrease", async () => {
    seed(A, "key_SCHOOLA1");
    seed(C, "key_SCHOOLC1");
    const created = unit({ title: "Water" });
    const c = callables({ create: jest.fn(async () => ({ unit: created, replayed: false })) });
    const m = mount(B, { c });
    await flush();
    expect(status(m.host)).toContain("2 unconfirmed");
    // A create success replaces the status; its submit also rescans.
    localStorage.removeItem(createAttemptStorageKey(C, "key_SCHOOLC1"));
    const title = q(m.host, "units-create-title") as HTMLInputElement;
    title.value = "Water";
    title.dispatchEvent(new Event("input", { bubbles: true }));
    (q(m.host, "units-create-form") as HTMLFormElement).dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await flush();
    expect(status(m.host)).toBe('Created "Water" in Grade 7.');
    // Decrease to zero leaves the success message alone.
    localStorage.removeItem(createAttemptStorageKey(A, "key_SCHOOLA1"));
    await m.ctl.checkRecovery();
    expect(status(m.host)).toBe('Created "Water" in Grade 7.');
    expect((q(m.host, "units-former-school") as HTMLElement).hidden).toBe(true);
    // A new former-school attempt is still announced.
    seed(A, "key_SCHOOLA2");
    await m.ctl.checkRecovery();
    expect(status(m.host)).toBe("One unconfirmed unit request from a previous school is listed in My Units.");
  });

  test("a visible-then-empty region is hidden under the application CSS", async () => {
    const html = fs.readFileSync(path.join(__dirname, "../../../index.html"), "utf8");
    const style = document.createElement("style");
    style.textContent = Array.from(html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)).map((x) => x[1]).join("\n");
    document.head.appendChild(style);
    try {
      seed(A, "key_SCHOOLA1");
      const m = mount(B);
      await flush();
      const region = q(m.host, "units-former-school") as HTMLElement;
      expect(getComputedStyle(region).display).not.toBe("none");
      localStorage.removeItem(createAttemptStorageKey(A, "key_SCHOOLA1"));
      await m.ctl.checkRecovery();
      expect(region.hidden).toBe(true);
      expect(getComputedStyle(region).display).toBe("none");
    } finally {
      style.remove();
    }
  });
});
