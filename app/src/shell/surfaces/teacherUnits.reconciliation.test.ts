/**
 * @jest-environment jsdom
 *
 * A3-4 S2: teacher-facing reconciliation of uncertain non-create changes.
 * The Unconfirmed changes region states what was asked and what the unit
 * looks like now (present state only, decision D2), survives leaving and
 * reopening My Units (D1), and offers only a read (Check current state) or
 * an acknowledgment (Dismiss): never a resend (D3).
 */
import { renderTeacherUnitsPanel } from "./teacherUnitsPanel";
// These suites exercise an open unit; collapse is covered by teacherUnits.compact.test.ts.
const EXPANDED = { unitsInitiallyExpanded: true } as const;
import { createTeacherUnitCreateAttemptStore } from "../../teacherUnits/createAttemptStore";
import {
  createTeacherUnitsController,
  createTeacherUnitsSurfaceSeam,
  type TeacherUnitsSurfaceSeam,
} from "../../teacherUnits/unitsController";
import {
  createPendingMutationRegistry,
  GUARDS_MAX,
  PENDING_MAX,
  UNCERTAINTY_MAX,
} from "../../teacherUnits/pendingMutations";
import { normalizeTeacherUnitError } from "../../teacherUnits/errors";
import { getPlaceableResources } from "../../teacherUnits/placeableResources";
import type { TeacherUnit, TeacherUnitsCallables } from "../../teacherUnits/types";

const SCOPE = { teacherId: "teacherA", schoolId: "schoolA" };
const tick = () => new Promise((r) => setTimeout(r, 0));
const q = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const [R1] = getPlaceableResources().filter((r) => r.grade === "7");

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
const KINDS = ["create", "list", "get", "update", "archive", "restore", "setResources", "reorder"] as const;
type Kind = (typeof KINDS)[number];
const MUTATIONS: ReadonlyArray<Kind> = ["create", "update", "archive", "restore", "setResources", "reorder"];
function scripted() {
  const calls = Object.fromEntries(KINDS.map((k) => [k, [] as Array<{ req: unknown; d: Deferred<unknown> }>])) as Record<
    Kind,
    Array<{ req: unknown; d: Deferred<unknown> }>
  >;
  const c = Object.fromEntries(
    KINDS.map((k) => [
      k,
      jest.fn((req: unknown) => {
        const d = deferred<unknown>();
        calls[k].push({ req, d });
        return d.promise;
      }),
    ]),
  ) as Record<Kind, jest.Mock>;
  return { c, calls };
}

let seq = 0;
const unit = (over: Partial<TeacherUnit> = {}): TeacherUnit => ({
  unitId: `Pnl${String(++seq).padStart(17, "0")}`,
  grade: "7",
  title: "Plants",
  description: "",
  status: "active",
  archivedAtMillis: null,
  createdAtMillis: seq,
  updatedAtMillis: seq,
  resourceIds: [R1.id],
  sortOrder: 0,
  revision: 3,
  ...over,
});

beforeEach(() => {
  document.body.textContent = "";
  localStorage.clear();
});

function harness() {
  const s = scripted();
  const seam: TeacherUnitsSurfaceSeam = createTeacherUnitsSurfaceSeam({
    callables: s.c as unknown as TeacherUnitsCallables,
    readFirebaseUid: () => "teacherA",
    readActiveTeacher: () => ({ uid: "teacherA", schoolId: "schoolA" }),
    createStore: (scope) => createTeacherUnitCreateAttemptStore(scope),
  });
  const last = (k: Kind) => s.calls[k][s.calls[k].length - 1];
  const mutations = () => MUTATIONS.reduce((n, k) => n + s.c[k].mock.calls.length, 0);
  // One My Units mount (as Curriculum does it), listing `units`.
  const open = async (units: TeacherUnit[]) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const ctl = seam.createController({ uid: "teacherA", schoolId: "schoolA", initialGrade: "7" });
    const view = renderTeacherUnitsPanel(host, ctl, EXPANDED);
    last("list").d.resolve({ units });
    await tick();
    return { host, ctl, view };
  };
  return { s, last, mutations, open };
}
const LOST = () => Object.assign(new Error("lost"), { code: "unavailable" });
const region = (host: HTMLElement) => q(host, "units-pending") as HTMLElement;
const entries = (host: HTMLElement) =>
  Array.from(region(host).querySelectorAll<HTMLElement>("li[data-testid^=units-pending-]"));

async function uncertainRename(h: ReturnType<typeof harness>, u: TeacherUnit) {
  const p = await h.open([u]);
  (q(p.host, `units-edit-${u.unitId}`) as HTMLButtonElement).click();
  const title = q(p.host, `units-edit-title-${u.unitId}`) as HTMLInputElement;
  title.value = "Seeds";
  (q(p.host, `units-edit-description-${u.unitId}`) as HTMLTextAreaElement).value = "Typed by me";
  (q(p.host, `units-edit-save-${u.unitId}`) as HTMLButtonElement).click();
  await tick();
  h.last("update").d.reject({ details: { code: "teacherUnits.responseUnavailable" } });
  await tick();
  return p;
}

describe("Unconfirmed changes: present-state findings (D2)", () => {
  test.each([
    ["the same revision", (u: TeacherUnit) => u, "notInEffectNow", "Your requested change isn't in effect now."],
    [
      "a newer matching revision",
      (u: TeacherUnit) => ({ ...u, title: "Seeds", description: "Typed by me", revision: 4 }),
      "consistentWithRequest",
      "Its current details match what you asked for. That may be from your request or from another change.",
    ],
    [
      "a newer different revision",
      (u: TeacherUnit) => ({ ...u, title: "Theirs", revision: 5 }),
      "changedSince",
      "This unit has changed since your request, and its current state doesn't match it.",
    ],
  ])("reread showing %s", async (_label, read, finding, sentence) => {
    const h = harness();
    const u = unit();
    const p = await uncertainRename(h, u);
    h.last("get").d.resolve({ unit: read(u) });
    await tick();
    const [li] = entries(p.host);
    expect(li.getAttribute("data-finding")).toBe(finding);
    const text = li.textContent ?? "";
    expect(text).toContain(`You asked to rename "Plants" to "Seeds" and change its description.`);
    expect(text).toContain("This change wasn't confirmed.");
    expect(text).toContain(sentence);
    expect(text).not.toMatch(/was saved|wasn't saved|was not saved|failed/);
    // The original teacher input is never overwritten.
    expect((q(p.host, `units-edit-title-${u.unitId}`) as HTMLInputElement).value).toBe("Seeds");
    expect((q(p.host, `units-edit-description-${u.unitId}`) as HTMLTextAreaElement).value).toBe("Typed by me");
    expect(h.mutations()).toBe(1);
  });

  test("an unavailable reread: unable to check, with a read-only control", async () => {
    const h = harness();
    const u = unit();
    const p = await uncertainRename(h, u);
    h.last("get").d.reject(LOST());
    await tick();
    const [li] = entries(p.host);
    expect(li.getAttribute("data-finding")).toBe("unknown");
    expect(li.textContent).toContain("LyfeLabz couldn't check its current state.");
    // The reload limitation is stated where recovery is offered (D1).
    expect(region(p.host).textContent).toContain("Reloading the page clears it, but doesn't confirm or undo anything.");
    // Check current state reads; it never sends the change again.
    (q(p.host, `units-pending-check-${li.getAttribute("data-testid")!.slice("units-pending-".length)}`) as HTMLButtonElement).click();
    await tick();
    expect(h.s.c.get).toHaveBeenCalledTimes(2);
    expect(entries(p.host)[0].textContent).toContain("Checking its current state...");
    h.last("get").d.resolve({ unit: { ...u, revision: 3 } });
    await tick();
    expect(entries(p.host)[0].getAttribute("data-finding")).toBe("notInEffectNow");
    expect(h.mutations()).toBe(1);
  });

  test("no control in the region resends: every button only reads or dismisses", async () => {
    const h = harness();
    const u = unit();
    const p = await uncertainRename(h, u);
    h.last("get").d.reject(LOST());
    await tick();
    const buttons = Array.from(region(p.host).querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Check current state", "Dismiss"]);
    for (const b of buttons) b.click();
    await tick();
    expect(h.mutations()).toBe(1);
    expect(region(p.host).hidden).toBe(true);
    expect(document.activeElement === document.body || p.host.contains(document.activeElement)).toBe(true);
  });
});

describe("Unconfirmed changes across navigation (D1)", () => {
  test("leaving My Units mid-request and reopening restores the notice; the late result fills it in", async () => {
    const h = harness();
    const u = unit();
    const first = await h.open([u]);
    (q(first.host, `units-archive-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    first.host.remove();
    first.view.dispose();
    const second = await h.open([u]);
    const [waiting] = entries(second.host);
    expect(waiting.getAttribute("data-status")).toBe("inFlight");
    expect(waiting.textContent).toContain(`You asked to archive "Plants". LyfeLabz is still waiting for a response`);
    expect(waiting.querySelectorAll("button")).toHaveLength(0);
    h.last("archive").d.reject(LOST());
    await tick();
    expect(h.s.c.get).toHaveBeenCalledTimes(1);
    h.last("get").d.resolve({ unit: { ...u, status: "archived", archivedAtMillis: 9, revision: 4 } });
    await tick();
    const [li] = entries(second.host);
    expect(li.getAttribute("data-finding")).toBe("consistentWithRequest");
    expect(li.textContent).toContain("It is archived now. That may be from your request or from another change.");
    expect(h.s.c.archive).toHaveBeenCalledTimes(1);
    expect(h.mutations()).toBe(1);
  });

  test("a settled finding is still shown after reopening, without another read", async () => {
    const h = harness();
    const u = unit();
    const first = await uncertainRename(h, u);
    h.last("get").d.resolve({ unit: { ...u, title: "Theirs", revision: 6 } });
    await tick();
    first.host.remove();
    first.view.dispose();
    const second = await h.open([{ ...u, title: "Theirs", revision: 6 }]);
    expect(entries(second.host)[0].getAttribute("data-finding")).toBe("changedSince");
    expect(h.s.c.get).toHaveBeenCalledTimes(1);
    expect(h.mutations()).toBe(1);
  });
});

describe("certification remediation: panel behavior", () => {
  const liveStatus = (host: HTMLElement) => q(host, "units-pending-status") as HTMLElement;

  test("P2-1: a repeated Save after a failed read is not sent, keeps the edits, and a read-only check restores it", async () => {
    const h = harness();
    const u = unit();
    const p = await uncertainRename(h, u);
    h.last("get").d.reject(LOST());
    await tick();
    (q(p.host, `units-edit-save-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    expect(h.s.c.update).toHaveBeenCalledTimes(1);
    const notice = p.host.querySelector(`[data-testid="units-card-${u.unitId}"] > .shell-units-notice`)?.textContent ?? "";
    expect(notice).toContain("An earlier change to this unit wasn't confirmed, so LyfeLabz didn't send this one.");
    expect(notice).toContain("Your edits are still here.");
    expect((q(p.host, `units-edit-title-${u.unitId}`) as HTMLInputElement).value).toBe("Seeds");
    expect((q(p.host, `units-edit-description-${u.unitId}`) as HTMLTextAreaElement).value).toBe("Typed by me");
    const id = entries(p.host)[0].getAttribute("data-testid")!.slice("units-pending-".length);
    (q(p.host, `units-pending-check-${id}`) as HTMLButtonElement).click();
    await tick();
    h.last("get").d.resolve({ unit: u });
    await tick();
    (q(p.host, `units-edit-save-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    expect(h.s.c.update).toHaveBeenCalledTimes(2);
    expect(h.last("update").req).toMatchObject({ title: "Seeds", description: "Typed by me", expectedRevision: 3 });
  });

  test("P2-5: a persistent polite status line; the panel's own first outcome is left to the card alert", async () => {
    const h = harness();
    const u = unit();
    const p = await uncertainRename(h, u);
    const status = liveStatus(p.host);
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(region(p.host).contains(status)).toBe(true);
    h.last("get").d.resolve({ unit: { ...u, title: "Seeds", description: "Typed by me", revision: 4 } });
    await tick();
    expect(status.textContent).toBe("");
    // A later change of the finding is news, and the same element carries it.
    void p.ctl.refresh();
    h.last("list").d.resolve({ units: [{ ...u, title: "Later", revision: 6 }] });
    await tick();
    expect(liveStatus(p.host)).toBe(status);
    expect(status.textContent).toContain("This unit has changed since your request");
    expect(status.textContent).not.toContain("Reloading");
  });

  test("P2-5 after remount: the summary, then the late finding, are announced", async () => {
    const h = harness();
    const u = unit();
    const first = await h.open([u]);
    (q(first.host, `units-archive-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    first.host.remove();
    first.view.dispose();
    const second = await h.open([u]);
    const status = liveStatus(second.host);
    expect(status.textContent).toBe("One change is waiting for a response.");
    h.last("archive").d.reject(LOST());
    await tick();
    expect(status.textContent).toContain("You asked to archive \"Plants\". This change wasn't confirmed.");
    h.last("get").d.resolve({ unit: { ...u, status: "archived", archivedAtMillis: 9, revision: 4 } });
    await tick();
    expect(status.textContent).toBe(
      "You asked to archive \"Plants\". This change wasn't confirmed. It is archived now. That may be from your request or from another change.",
    );
  });

  test("P2-4/P2-5: a confirmed save after remount updates the card and is announced, never silently dropped", async () => {
    const h = harness();
    const u = unit();
    const first = await h.open([u]);
    (q(first.host, `units-edit-${u.unitId}`) as HTMLButtonElement).click();
    (q(first.host, `units-edit-title-${u.unitId}`) as HTMLInputElement).value = "Seeds";
    (q(first.host, `units-edit-save-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    first.host.remove();
    first.view.dispose();
    const second = await h.open([u]);
    h.last("update").d.resolve({ unit: { ...u, title: "Seeds", revision: 4 }, noop: false });
    await tick();
    expect(entries(second.host)).toHaveLength(0);
    expect(q(second.host, `units-card-${u.unitId}`)?.textContent).toContain("Seeds");
    expect(liveStatus(second.host).textContent).toBe(`You asked to rename "Plants" to "Seeds". This change was saved.`);
    expect(region(second.host).hidden).toBe(false);
    expect(h.mutations()).toBe(1);
  });
});

describe("second recertification: panel behavior", () => {
  const liveStatus = (host: HTMLElement) => q(host, "units-pending-status") as HTMLElement;
  // Counts every DOM mutation of the live status line (F5), not only its
  // final text. jsdom only: not a screen-reader verification.
  // Records are counted as delivered (and any still queued), so neither an
  // early delivery nor a late one can hide a mutation.
  const watch = (el: HTMLElement) => {
    let n = 0;
    const observer = new MutationObserver((records) => {
      n += records.length;
    });
    observer.observe(el, { childList: true, characterData: true, subtree: true });
    return () => {
      n += observer.takeRecords().length;
      observer.disconnect();
      return n;
    };
  };
  async function remountedConsistent(h: ReturnType<typeof harness>, u: TeacherUnit) {
    const first = await h.open([u]);
    (q(first.host, `units-edit-${u.unitId}`) as HTMLButtonElement).click();
    (q(first.host, `units-edit-title-${u.unitId}`) as HTMLInputElement).value = "Seeds";
    (q(first.host, `units-edit-save-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    first.host.remove();
    first.view.dispose();
    const second = await h.open([u]);
    h.last("update").d.reject(LOST());
    await tick();
    h.last("get").d.resolve({ unit: { ...u, title: "Seeds", revision: 4 } });
    await tick();
    return second;
  }

  test("F1: saving the old cached title while the rename is unconfirmed keeps the editor and sends nothing", async () => {
    const h = harness();
    const u = unit();
    const p = await uncertainRename(h, u);
    h.last("get").d.reject(LOST());
    await tick();
    (q(p.host, `units-edit-title-${u.unitId}`) as HTMLInputElement).value = "Plants";
    (q(p.host, `units-edit-description-${u.unitId}`) as HTMLTextAreaElement).value = "";
    (q(p.host, `units-edit-save-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    expect(q(p.host, `units-edit-title-${u.unitId}`)).not.toBeNull();
    expect((q(p.host, `units-edit-title-${u.unitId}`) as HTMLInputElement).value).toBe("Plants");
    expect(q(p.host, "units-status")?.textContent).not.toContain("No change was needed");
    expect(p.host.querySelector(`[data-testid="units-card-${u.unitId}"] > .shell-units-notice`)?.textContent).toContain(
      "didn't send this one",
    );
    expect(entries(p.host)).toHaveLength(1);
    expect(h.mutations()).toBe(1);
  });

  test("F4: dismissing withdraws the present-state status; a later different change never revives it", async () => {
    const h = harness();
    const u = unit();
    const p = await remountedConsistent(h, u);
    expect(liveStatus(p.host).textContent).toContain("Its current details match what you asked for");
    const id = entries(p.host)[0].getAttribute("data-testid")!.slice("units-pending-".length);
    (q(p.host, `units-pending-dismiss-${id}`) as HTMLButtonElement).click();
    await tick();
    expect(liveStatus(p.host).textContent).toBe("");
    expect(region(p.host).hidden).toBe(true);
    void p.ctl.refresh();
    h.last("list").d.resolve({ units: [{ ...u, title: "Trees", revision: 5 }] });
    await tick();
    expect(region(p.host).textContent).not.toContain("match what you asked for");
    expect(region(p.host).hidden).toBe(true);
  });

  test("F5: identical findings and ordinary re-renders cause no live-region mutation; a genuine change causes one", async () => {
    const h = harness();
    const u = unit();
    const p = await remountedConsistent(h, u);
    const status = liveStatus(p.host);
    const text = status.textContent;
    let mutations = watch(status);
    void p.ctl.refresh();
    h.last("list").d.resolve({ units: [{ ...u, title: "Seeds", revision: 4 }] });
    await tick();
    void p.ctl.refresh();
    h.last("list").d.resolve({ units: [{ ...u, title: "Seeds", description: "Elsewhere", revision: 5 }] });
    await tick();
    p.ctl.setGrade("8");
    h.last("list").d.resolve({ units: [] });
    await tick();
    p.ctl.setGrade("7");
    h.last("list").d.resolve({ units: [{ ...u, title: "Seeds", description: "Elsewhere", revision: 5 }] });
    await tick();
    expect(status.textContent).toBe(text);
    expect(mutations()).toBe(0);
    mutations = watch(status);
    void p.ctl.refresh();
    h.last("list").d.resolve({ units: [{ ...u, title: "Trees", revision: 6 }] });
    await tick();
    expect(mutations()).toBeGreaterThan(0);
    expect(status.textContent).toContain("This unit has changed since your request");
  });

  test("F3 after remount: a late notFound removes the card and the finding says not found", async () => {
    const h = harness();
    const u = unit();
    const first = await h.open([u]);
    (q(first.host, `units-archive-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    h.last("archive").d.reject(LOST());
    await tick();
    first.host.remove();
    first.view.dispose();
    const second = await h.open([u]);
    expect(q(second.host, `units-card-${u.unitId}`)).not.toBeNull();
    h.last("get").d.reject({ details: { code: "teacherUnits.notFound" } });
    await tick();
    expect(q(second.host, `units-card-${u.unitId}`)).toBeNull();
    expect(entries(second.host)[0].textContent).toContain("LyfeLabz couldn't find this unit when it checked.");
    expect(liveStatus(second.host).textContent).toContain("couldn't find this unit");
  });
});

describe("fifth remediation: panel", () => {
  test("P2: after a same-revision no-op and a later conflict, a typed edit is not sent and stays", async () => {
    const h = harness();
    const u = unit();
    const p = await h.open([u]);
    (q(p.host, `units-archive-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    h.last("archive").d.reject(LOST());
    await tick();
    h.last("get").d.resolve({ unit: u });
    await tick();
    const restore = p.ctl.restoreUnit(u.unitId);
    await tick();
    h.last("restore").d.resolve({ unit: u, noop: true });
    await restore;
    void p.ctl.refresh();
    h.last("list").d.resolve({ units: [{ ...u, title: "Conflicting" }] });
    await tick();
    (q(p.host, `units-edit-${u.unitId}`) as HTMLButtonElement).click();
    (q(p.host, `units-edit-title-${u.unitId}`) as HTMLInputElement).value = "Typed new intent";
    (q(p.host, `units-edit-save-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    expect(h.s.c.update).not.toHaveBeenCalled();
    expect((q(p.host, `units-edit-title-${u.unitId}`) as HTMLInputElement).value).toBe("Typed new intent");
    expect(p.host.querySelector(`[data-testid="units-card-${u.unitId}"] > .shell-units-notice`)?.textContent).toContain(
      "didn't send this one",
    );
  });
});

describe("fifth remediation P3: capacity guidance names only an action that can help", () => {
  const lostErr = normalizeTeacherUnitError({ code: "unavailable" });
  // A panel on a controller whose registry is prefilled by `fill`.
  async function panelWith(fill: (v: ReturnType<ReturnType<typeof createPendingMutationRegistry>["forScope"]>) => void) {
    const registry = createPendingMutationRegistry();
    fill(registry.forScope(SCOPE, () => true));
    const s = scripted();
    const u = unit();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const ctl = createTeacherUnitsController({
      callables: s.c as unknown as TeacherUnitsCallables,
      session: SCOPE,
      readCurrentContext: () => SCOPE,
      store: createTeacherUnitCreateAttemptStore(SCOPE),
      initialGrade: "7",
      pendingRegistry: registry,
    });
    renderTeacherUnitsPanel(host, ctl, EXPANDED);
    s.calls.list[s.calls.list.length - 1].d.resolve({ units: [u] });
    await tick();
    (q(host, `units-edit-${u.unitId}`) as HTMLButtonElement).click();
    (q(host, `units-edit-title-${u.unitId}`) as HTMLInputElement).value = "Typed";
    (q(host, `units-edit-save-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    const notice = host.querySelector(`[data-testid="units-card-${u.unitId}"] > .shell-units-notice`)?.textContent ?? "";
    const sent = MUTATIONS.reduce((n, k) => n + s.c[k].mock.calls.length, 0);
    const cardNotice = host.querySelector(`[data-testid="units-card-${u.unitId}"] > .shell-units-notice`);
    // The refusal is the card's alert; the reconciliation status line is not
    // rewritten for it (no duplicate announcement).
    const live = q(host, "units-pending-status") as HTMLElement;
    const liveUnchanged = cardNotice?.getAttribute("role") === "alert" && (live.textContent ?? "") === "";
    return { notice, sent, input: (q(host, `units-edit-title-${u.unitId}`) as HTMLInputElement).value, liveUnchanged };
  }
  const guard = (v: ReturnType<ReturnType<typeof createPendingMutationRegistry>["forScope"]>, id: string, release: boolean) => {
    v.accept({ ...unit({ unitId: id }), revision: 3 }, v.stamp());
    const e = v.begin({ unitId: id, expectedRevision: 3, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
    v.markUncertain(e, lostErr);
    v.dismiss(e);
    if (release) v.accept({ ...unit({ unitId: id }), revision: 4 }, v.stamp());
  };

  test("retained records: no dismissal or read advice; the reload trade-off is stated; input kept", async () => {
    const r = await panelWith((v) => {
      for (let i = 0; i < UNCERTAINTY_MAX; i++) guard(v, `Ret${String(i).padStart(17, "0")}`, true);
    });
    expect(r.notice).toContain("reached its limit for keeping track of earlier unconfirmed changes");
    expect(r.notice).toContain("Refreshing your units or dismissing notices won't make room.");
    expect(r.notice).toContain("doesn't confirm or undo any earlier change");
    // Sixth remediation: reloading never cancels requests already sent.
    expect(r.notice).toContain("it doesn't cancel changes already sent, which may still finish");
    expect(r.notice).not.toMatch(/reload\w* (?:to|will) (?:undo|cancel|reverse)/i);
    expect(r.liveUnchanged).toBe(true);
    expect(r.notice).not.toMatch(/Review the changes|dismiss the ones/);
    expect(r.input).toBe("Typed");
    expect(r.sent).toBe(0);
  });

  test("blocking guards: check current state, never dismissal", async () => {
    const r = await panelWith((v) => {
      for (let i = 0; i < GUARDS_MAX; i++) guard(v, `Blk${String(i).padStart(17, "0")}`, false);
    });
    expect(r.notice).toContain("Choose Refresh units");
    expect(r.notice).not.toMatch(/dismiss/i);
    expect(r.sent).toBe(0);
  });

  test("pending entries: dismissal only when there is something to dismiss", async () => {
    const waiting = await panelWith((v) => {
      for (let i = 0; i < PENDING_MAX; i++) v.begin({ unitId: `W${i}`, expectedRevision: 1, intent: { op: "archive" }, titleAtRequest: "x" });
    });
    expect(waiting.notice).toContain("still waiting for responses");
    expect(waiting.notice).not.toMatch(/dismiss/i);
    const listed = await panelWith((v) => {
      for (let i = 0; i < PENDING_MAX; i++) {
        const e = v.begin({ unitId: `L${i}`, expectedRevision: 1, intent: { op: "archive" }, titleAtRequest: "x" }) as string;
        v.markUncertain(e, lostErr);
      }
    });
    expect(listed.notice).toContain("dismiss the ones you've checked");
    expect(waiting.sent + listed.sent).toBe(0);
  });
});

describe("seventh remediation P2: panel never says Saved for a non-advancing write", () => {
  test("the typed rename stays in the open editor, no Saved, nothing resent, the next change is blocked", async () => {
    const h = harness();
    const u = unit();
    const p = await h.open([u]);
    (q(p.host, `units-edit-${u.unitId}`) as HTMLButtonElement).click();
    (q(p.host, `units-edit-title-${u.unitId}`) as HTMLInputElement).value = "Teacher intent";
    (q(p.host, `units-edit-save-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    h.last("update").d.resolve({ unit: u, noop: false });
    await tick();
    await tick();
    expect(p.host.textContent).not.toMatch(/Saved:/);
    expect(q(p.host, "units-status")?.textContent).not.toMatch(/Saved/);
    expect((q(p.host, `units-edit-title-${u.unitId}`) as HTMLInputElement).value).toBe("Teacher intent");
    const notice = p.host.querySelector(`[data-testid="units-card-${u.unitId}"] > .shell-units-notice`)?.textContent ?? "";
    expect(notice).toContain("LyfeLabz couldn't confirm whether your changes were saved.");
    expect(notice).not.toMatch(/wasn't saved|failed/);
    expect(entries(p.host)).toHaveLength(1);
    expect(h.s.c.get).not.toHaveBeenCalled();
    (q(p.host, `units-edit-save-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    expect(h.s.c.update).toHaveBeenCalledTimes(1);
    expect(h.mutations()).toBe(1);
  });
});

describe("in-flight requests are never shown as unconfirmed", () => {
  const liveStatus = (host: HTMLElement) => q(host, "units-pending-status") as HTMLElement;
  const UNCONFIRMED = /Unconfirmed changes|couldn't confirm/;

  test("this panel's own request: nothing is listed while it waits, its controls are busy, and success leaves nothing behind", async () => {
    const h = harness();
    const u = unit();
    const p = await h.open([u]);
    (q(p.host, `units-archive-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    expect(h.s.c.archive).toHaveBeenCalledTimes(1);
    // The request is outstanding: the card shows it as in progress, and the
    // region neither appears nor announces anything.
    expect(p.ctl.getState().pending.map((e) => e.status)).toEqual(["inFlight"]);
    expect(region(p.host).hidden).toBe(true);
    expect(entries(p.host)).toHaveLength(0);
    expect(p.host.textContent).not.toMatch(UNCONFIRMED);
    expect(liveStatus(p.host).textContent).toBe("");
    expect(q(p.host, `units-archive-${u.unitId}`)!.getAttribute("aria-disabled")).toBe("true");
    h.last("archive").d.resolve({ unit: { ...u, status: "archived", archivedAtMillis: 9, revision: 4 }, noop: false });
    await tick();
    expect(region(p.host).hidden).toBe(true);
    expect(p.host.textContent).not.toMatch(UNCONFIRMED);
    expect(liveStatus(p.host).textContent).toBe("");
    expect(h.mutations()).toBe(1);
  });

  test("this panel's own request becomes an unconfirmed change only when its outcome is uncertain", async () => {
    const h = harness();
    const u = unit();
    const p = await h.open([u]);
    (q(p.host, `units-archive-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    expect(region(p.host).hidden).toBe(true);
    h.last("archive").d.reject(LOST());
    await tick();
    expect(region(p.host).hidden).toBe(false);
    expect(region(p.host).getAttribute("aria-label")).toBe("Unconfirmed changes");
    expect(region(p.host).querySelector("h4")?.textContent).toBe("Unconfirmed changes");
    expect(region(p.host).textContent).toContain("LyfeLabz couldn't confirm these changes.");
    const [li] = entries(p.host);
    expect(li.getAttribute("data-status")).toBe("uncertain");
    expect(li.textContent).toContain(`You asked to archive "Plants". This change wasn't confirmed.`);
    expect(h.mutations()).toBe(1);
  });

  test("a request an earlier panel sent is listed as waiting, never introduced as unconfirmed, until its outcome is uncertain", async () => {
    const h = harness();
    const u = unit();
    const first = await h.open([u]);
    (q(first.host, `units-archive-${u.unitId}`) as HTMLButtonElement).click();
    await tick();
    first.host.remove();
    first.view.dispose();
    const second = await h.open([u]);
    const box = region(second.host);
    expect(box.hidden).toBe(false);
    expect(box.getAttribute("aria-label")).toBe("Changes waiting for a response");
    expect(Array.from(box.querySelectorAll("h4"), (x) => x.textContent)).toEqual(["Changes waiting for a response"]);
    expect(box.textContent).not.toMatch(UNCONFIRMED);
    expect(liveStatus(second.host).textContent).toBe("One change is waiting for a response.");
    const [waiting] = entries(second.host);
    expect(waiting.getAttribute("data-status")).toBe("inFlight");
    expect(q(second.host, "units-waiting-list")!.contains(waiting)).toBe(true);
    expect(waiting.querySelectorAll("button")).toHaveLength(0);
    h.last("archive").d.reject(LOST());
    await tick();
    expect(box.getAttribute("aria-label")).toBe("Unconfirmed changes");
    expect(Array.from(box.querySelectorAll("h4"), (x) => x.textContent)).toEqual(["Unconfirmed changes"]);
    expect(box.textContent).toContain("LyfeLabz couldn't confirm these changes.");
    expect(q(second.host, "units-waiting-list")).toBeNull();
    expect(h.mutations()).toBe(1);
  });

  test("mixed: unconfirmed and waiting entries are listed apart; this panel's own request is not listed at all", async () => {
    const h = harness();
    const a = unit({ title: "Alpha" });
    const b = unit({ title: "Beta" });
    const c = unit({ title: "Gamma" });
    const first = await h.open([a, b, c]);
    (q(first.host, `units-archive-${a.unitId}`) as HTMLButtonElement).click();
    (q(first.host, `units-archive-${b.unitId}`) as HTMLButtonElement).click();
    await tick();
    h.s.calls.archive[0].d.reject(LOST());
    await tick();
    h.last("get").d.resolve({ unit: a });
    await tick();
    first.host.remove();
    first.view.dispose();
    const second = await h.open([a, b, c]);
    expect(liveStatus(second.host).textContent).toBe(
      "One change is listed under Unconfirmed changes. One change is waiting for a response.",
    );
    (q(second.host, `units-archive-${c.unitId}`) as HTMLButtonElement).click();
    await tick();
    const box = region(second.host);
    expect(Array.from(box.querySelectorAll("h4"), (x) => x.textContent)).toEqual([
      "Unconfirmed changes",
      "Changes waiting for a response",
    ]);
    expect(entries(second.host).map((li) => [li.getAttribute("data-unit-id"), li.getAttribute("data-status")])).toEqual([
      [a.unitId, "uncertain"],
      [b.unitId, "inFlight"],
    ]);
    expect(box.textContent).not.toContain("Gamma");
    expect(h.mutations()).toBe(3);
  });
});
