/**
 * @jest-environment jsdom
 */

// Same-assignment class selector: the Assignment Detail renderer side. The
// class name beneath the title stays the static label unless the injected
// switcher offers another class, in which case it becomes a small disclosure
// whose options call back into the injected `select` seam. Navigation itself
// (and the Classes/shell history wiring) is covered by
// shell/shell.class-switcher.test.ts.

import { renderAssignmentDetail, type AssignmentDetailDeps } from "./detail";
import type {
  AssignmentDetailClassSwitcher,
  ClassSwitchOption,
} from "./class-switcher";
import type { AssignmentDetailMetadata } from "./types";
import type { AssignmentSummary, AssignmentSummaryCallable } from "../summary/types";

const flush = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await flush();
};

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

afterEach(() => {
  document.body.textContent = "";
});

const metaFor = (assignmentId: string, classId: string, className: string): AssignmentDetailMetadata =>
  Object.freeze({
    assignmentId,
    title: "The Carbon Cycle",
    status: "published" as const,
    className,
    classId,
    lessonSlug: "carbon-cycle",
  });

const SOURCE = metaFor("a-src", "c-src", "SYT Acceptance");

const summaryFor = (assignmentId: string, totalStudents = 3): AssignmentSummary => ({
  assignmentId,
  classId: "c",
  totalStudents,
  completedStudents: 1,
  inProgressStudents: 1,
  notStartedStudents: 1,
  completionPercentage: 33,
  averagePercentage: 70,
  highestPercentage: 90,
  lowestPercentage: 50,
  perfectScoreStudents: 0,
});

const summaryCallable: AssignmentSummaryCallable = async ({ assignmentId }) =>
  summaryFor(assignmentId);

const OPTIONS: ReadonlyArray<ClassSwitchOption> = [
  { classId: "c-2", className: "Period 2", target: { kind: "assignment", assignmentId: "a-2" } },
  { classId: "c-3", className: "Period 3", target: { kind: "assignment", assignmentId: "a-3" } },
];

function render(
  switcher: AssignmentDetailClassSwitcher | undefined,
  extra: Partial<AssignmentDetailDeps> = {},
  metadata: AssignmentDetailMetadata = SOURCE,
  mount: HTMLElement = mkMount(),
): HTMLElement {
  renderAssignmentDetail(mount, {
    assignmentId: metadata.assignmentId,
    loadMetadata: async () => metadata,
    summaryCallable,
    ...(switcher === undefined ? {} : { classSwitcher: switcher }),
    ...extra,
  });
  return mount;
}

const toggleOf = (mount: HTMLElement): HTMLButtonElement | null =>
  mount.querySelector<HTMLButtonElement>("[data-testid=assignment-detail-class-toggle]");
const listOf = (mount: HTMLElement): HTMLUListElement =>
  mount.querySelector<HTMLUListElement>("[data-testid=assignment-detail-class-options]")!;

describe("static class label", () => {
  test("without a switcher, the class label is the unchanged static paragraph", async () => {
    const mount = render(undefined);
    await settle();
    const label = mount.querySelector("[data-testid=assignment-detail-class-value]")!;
    expect(label.tagName).toBe("P");
    expect(label.className).toBe("shell-assignment-detail-class");
    expect(label.textContent).toBe("SYT Acceptance");
    expect(toggleOf(mount)).toBeNull();
  });

  test("with no other eligible class, the static label renders and no control exists", async () => {
    const mount = render({ options: () => [], select: async () => undefined });
    await settle();
    expect(mount.querySelector("[data-testid=assignment-detail-class-value]")!.tagName).toBe("P");
    expect(toggleOf(mount)).toBeNull();
    expect(mount.querySelector("[data-testid=assignment-detail-class-switcher]")).toBeNull();
  });

  test("while the class list is still loading, the static label renders and upgrades once ready", async () => {
    let known: ReadonlyArray<ClassSwitchOption> | null = null;
    let markReady: () => void = () => undefined;
    const ready = new Promise<void>((r) => {
      markReady = r;
    });
    const mount = render({ options: () => known, ready, select: async () => undefined });
    await settle();
    expect(toggleOf(mount)).toBeNull();
    expect(mount.querySelector("[data-testid=assignment-detail-class-value]")!.tagName).toBe("P");
    known = OPTIONS;
    markReady();
    await settle();
    expect(toggleOf(mount)).not.toBeNull();
    expect(mount.querySelectorAll("[data-testid=assignment-detail-class-value]")).toHaveLength(1);
  });

  test("a class list that loads with nothing to offer keeps the static label", async () => {
    let known: ReadonlyArray<ClassSwitchOption> | null = null;
    let markReady: () => void = () => undefined;
    const ready = new Promise<void>((r) => {
      markReady = r;
    });
    const mount = render({ options: () => known, ready, select: async () => undefined });
    await settle();
    known = [];
    markReady();
    await settle();
    expect(toggleOf(mount)).toBeNull();
  });
});

describe("class switcher disclosure", () => {
  test("renders the current class with a chevron in the class-label position, closed", async () => {
    const mount = render({ options: () => OPTIONS, select: async () => undefined });
    await settle();
    const identity = mount.querySelector("[data-testid=assignment-detail-identity]")!;
    const toggle = toggleOf(mount)!;
    expect(identity.contains(toggle)).toBe(true);
    // Directly beneath the title.
    expect(identity.children[0]!.getAttribute("data-testid")).toBe("assignment-detail-title");
    expect(identity.children[1]!.getAttribute("data-testid")).toBe("assignment-detail-class-switcher");
    expect(toggle.type).toBe("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(listOf(mount).id);
    expect(toggle.getAttribute("aria-label")).toBe(
      "SYT Acceptance. Switch class for this lesson",
    );
    expect(mount.querySelector("[data-testid=assignment-detail-class-value]")!.textContent).toBe(
      "SYT Acceptance",
    );
    // The chevron is CSS-only, so the button's text is exactly the class name.
    expect(toggle.textContent).toBe("SYT Acceptance");
    expect(listOf(mount).hidden).toBe(true);
  });

  test("activating the toggle opens and closes the list; options have clear accessible names", async () => {
    const mount = render({ options: () => OPTIONS, select: async () => undefined });
    await settle();
    const toggle = toggleOf(mount)!;
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(listOf(mount).hidden).toBe(false);
    const buttons = Array.from(listOf(mount).querySelectorAll("button"));
    expect(buttons.map((b) => b.textContent)).toEqual(["Period 2", "Period 3"]);
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open The Carbon Cycle for Period 2",
      "Open The Carbon Cycle for Period 3",
    ]);
    expect(buttons.every((b) => b.type === "button")).toBe(true);
    // The current class is never a selectable destination.
    expect(buttons.some((b) => b.textContent === "SYT Acceptance")).toBe(false);
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(listOf(mount).hidden).toBe(true);
  });

  test("Escape closes the open list and returns focus to the toggle", async () => {
    const mount = render({ options: () => OPTIONS, select: async () => undefined });
    await settle();
    const toggle = toggleOf(mount)!;
    toggle.click();
    const first = listOf(mount).querySelector("button")!;
    first.focus();
    first.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(listOf(mount).hidden).toBe(true);
    expect(document.activeElement).toBe(toggle);
  });

  test("Escape on a closed toggle does nothing", async () => {
    const mount = render({ options: () => OPTIONS, select: async () => undefined });
    await settle();
    const toggle = toggleOf(mount)!;
    const ev = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    toggle.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  test("clicking outside closes the list without moving focus into it", async () => {
    const mount = render({ options: () => OPTIONS, select: async () => undefined });
    await settle();
    const toggle = toggleOf(mount)!;
    toggle.click();
    expect(listOf(mount).hidden).toBe(false);
    mount.querySelector<HTMLElement>("[data-testid=assignment-detail-title]")!.click();
    expect(listOf(mount).hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  test("moving focus out of the disclosure closes it", async () => {
    const mount = render({ options: () => OPTIONS, select: async () => undefined });
    await settle();
    const toggle = toggleOf(mount)!;
    toggle.click();
    const outside = document.createElement("button");
    document.body.appendChild(outside);
    toggle.dispatchEvent(new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
    expect(listOf(mount).hidden).toBe(true);
  });

  test("selecting a class calls select once with that option, disabling the options while pending", async () => {
    let finish: () => void = () => undefined;
    const calls: ClassSwitchOption[] = [];
    let activeDuringSelect: boolean | null = null;
    const mount = render({
      options: () => OPTIONS,
      select: (option, context) => {
        calls.push(option);
        activeDuringSelect = context.isActive();
        return new Promise<void>((r) => {
          finish = r;
        });
      },
    });
    await settle();
    toggleOf(mount)!.click();
    const [first, second] = Array.from(listOf(mount).querySelectorAll("button"));
    first!.click();
    second!.click();
    expect(calls).toEqual([OPTIONS[0]]);
    expect(activeDuringSelect).toBe(true);
    expect(first!.disabled).toBe(true);
    expect(second!.disabled).toBe(true);
    expect(mount.querySelector("[data-testid=assignment-detail-class-switcher]")!.getAttribute("aria-busy")).toBe("true");
    finish();
    await settle();
    expect(first!.disabled).toBe(false);
    expect(mount.querySelector("[data-testid=assignment-detail-class-switcher]")!.hasAttribute("aria-busy")).toBe(false);
  });

  test("isActive reports false once this Detail has been replaced", async () => {
    let captured: (() => boolean) | null = null;
    const mount = render({
      options: () => OPTIONS,
      select: async (_option, context) => {
        captured = context.isActive;
      },
    });
    await settle();
    toggleOf(mount)!.click();
    listOf(mount).querySelector("button")!.click();
    mount.textContent = "";
    expect(captured!()).toBe(false);
  });

  test("a throwing options reader falls back to the static label", async () => {
    const mount = render({
      options: () => {
        throw new Error("boom");
      },
      select: async () => undefined,
    });
    await settle();
    expect(toggleOf(mount)).toBeNull();
    expect(mount.querySelector("[data-testid=assignment-detail-class-value]")!.textContent).toBe(
      "SYT Acceptance",
    );
  });
});

describe("replacing one Detail with another in the same outlet", () => {
  test("a late metadata response from the replaced Detail never renders", async () => {
    const host = mkMount();
    let resolveA: (m: AssignmentDetailMetadata) => void = () => undefined;
    renderAssignmentDetail(host, {
      assignmentId: "a-src",
      loadMetadata: () =>
        new Promise<AssignmentDetailMetadata>((r) => {
          resolveA = r;
        }),
      summaryCallable,
    });
    // The outlet controller clears the host and renders the destination.
    host.textContent = "";
    render(undefined, {}, metaFor("a-2", "c-2", "Period 2"), host);
    await settle();
    resolveA(SOURCE);
    await settle();
    const surfaces = host.querySelectorAll("[data-testid=assignment-detail]");
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0]!.getAttribute("data-assignment-id")).toBe("a-2");
    expect(host.querySelector("[data-testid=assignment-detail-class-value]")!.textContent).toBe(
      "Period 2",
    );
    expect(host.textContent).not.toContain("SYT Acceptance");
  });

  test("a late summary response for the replaced Detail does not reach the destination", async () => {
    const host = mkMount();
    const pending = new Map<string, (s: AssignmentSummary) => void>();
    const slowSummary: AssignmentSummaryCallable = ({ assignmentId }) =>
      new Promise<AssignmentSummary>((r) => {
        pending.set(assignmentId, r);
      });
    render(undefined, { summaryCallable: slowSummary }, SOURCE, host);
    await settle();
    host.textContent = "";
    render(undefined, { summaryCallable: slowSummary }, metaFor("a-2", "c-2", "Period 2"), host);
    await settle();
    pending.get("a-2")!(summaryFor("a-2", 7));
    await settle();
    pending.get("a-src")!(summaryFor("a-src", 99));
    await settle();
    const text = host.textContent ?? "";
    expect(text).not.toContain("99");
    expect(host.querySelectorAll("[data-testid=assignment-detail]")).toHaveLength(1);
  });
});
