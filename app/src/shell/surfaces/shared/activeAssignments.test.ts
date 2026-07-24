/**
 * @jest-environment jsdom
 */
import {
  _resetActiveAssignmentsSessionStateForTest,
  compareCards,
  isRenderableCard,
  renderActiveAssignmentsSection,
} from "./activeAssignments";
import type { AssignmentDetailMetadata } from "../../../assignments/detail/types";

const meta = (
  overrides: Partial<AssignmentDetailMetadata> = {},
): AssignmentDetailMetadata => ({
  assignmentId: "a1",
  title: "Earth's Layers",
  className: "6A Life Science",
  status: "published",
  lessonSlug: "earths-layers",
  classId: "c1",
  ...overrides,
});

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const flush = (): Promise<void> =>
  new Promise((r) => setTimeout(r, 0));

describe("isRenderableCard", () => {
  test("accepts a well-formed published record", () => {
    expect(isRenderableCard(meta())).toBe(true);
  });
  test("accepts a well-formed closed record", () => {
    expect(isRenderableCard(meta({ status: "closed" }))).toBe(true);
  });
  test("rejects a draft record", () => {
    expect(isRenderableCard(meta({ status: "draft" }))).toBe(false);
  });
  test("rejects a record missing a title", () => {
    expect(isRenderableCard(meta({ title: "" }))).toBe(false);
  });
});

describe("compareCards ordering", () => {
  test("most recent publishedAt first", () => {
    const a = meta({ assignmentId: "old", publishedAt: 1000 });
    const b = meta({ assignmentId: "new", publishedAt: 2000 });
    expect([a, b].sort(compareCards)[0]?.assignmentId).toBe("new");
  });
  test("falls back to class name asc when publishedAt missing", () => {
    const a = meta({ assignmentId: "z", className: "6B" });
    const b = meta({ assignmentId: "y", className: "6A" });
    expect([a, b].sort(compareCards)[0]?.assignmentId).toBe("y");
  });
});

describe("renderActiveAssignmentsSection", () => {
  beforeEach(() => {
    _resetActiveAssignmentsSessionStateForTest();
  });
  test("section is absent when no published assignments are registered", () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [],
      open: () => undefined,
    });
    const section = mount.querySelector(
      "[data-testid=active-assignments-section]",
    ) as HTMLElement | null;
    expect(section?.hidden).toBe(true);
  });

  test("renders a card per published assignment with the correct fields", () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [meta({ assignmentId: "p1" }), meta({ assignmentId: "p2", title: "Waves" })],
      open: () => undefined,
    });
    const cards = mount.querySelectorAll("[data-testid^=active-assignment-card-]");
    expect(cards.length).toBe(2);
    expect(
      mount.querySelector("[data-testid=active-assignment-title-p1]")?.textContent,
    ).toBe("Earth's Layers");
    expect(
      mount.querySelector("[data-testid=active-assignment-state-p1]")?.textContent,
    ).toBe("Published");
    const heading = mount.querySelector(
      "[data-testid=active-assignments-title]",
    );
    expect(heading?.textContent).toBe("Active Assignments (2)");
  });

  test("Open assignment button invokes opener with the correct assignmentId", () => {
    const mount = mkMount();
    const opened: string[] = [];
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [meta({ assignmentId: "p1" })],
      open: (id) => {
        opened.push(id);
      },
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=active-assignment-open-p1]",
      )
      ?.click();
    expect(opened).toEqual(["p1"]);
  });

  test("card carries region a11y attributes", () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [meta({ assignmentId: "p1" })],
      open: () => undefined,
    });
    const section = mount.querySelector(
      "[data-testid=active-assignments-section]",
    );
    expect(section?.getAttribute("role")).toBe("region");
    expect(section?.getAttribute("aria-label")).toBe("Active assignments");
    const card = mount.querySelector(
      "[data-testid=active-assignment-card-p1]",
    );
    expect(card?.getAttribute("role")).toBe("group");
    // Sprint 16 Slice 6: the card's accessible name is delegated to the
    // visible title through aria-labelledby, not hand-composed aria-label.
    const titleId = card?.getAttribute("aria-labelledby");
    expect(titleId).toBe("active-assignment-title-p1");
    const title = mount.querySelector(`#${titleId}`);
    expect(title?.textContent).toBe("Earth's Layers");
    expect(card?.getAttribute("aria-label")).toBeNull();
  });

  test("Sprint 16 Slice 6: Open button accessible name includes the assignment title", () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [
        meta({ assignmentId: "p1", title: "Wave Behavior", className: "6A" }),
        meta({ assignmentId: "p2", title: "Digital Signals", className: "6A" }),
      ],
      open: () => undefined,
    });
    const open1 = mount.querySelector<HTMLButtonElement>(
      "[data-testid=active-assignment-open-p1]",
    );
    const open2 = mount.querySelector<HTMLButtonElement>(
      "[data-testid=active-assignment-open-p2]",
    );
    // Same visible label, distinct accessible names so screen-reader users
    // can distinguish two Open buttons on the same class.
    expect(open1?.textContent).toBe("Open assignment");
    expect(open2?.textContent).toBe("Open assignment");
    expect(open1?.getAttribute("aria-label")).toBe(
      "Open assignment Wave Behavior for 6A",
    );
    expect(open2?.getAttribute("aria-label")).toBe(
      "Open assignment Digital Signals for 6A",
    );
  });

  test("Sprint 16 Slice 6: Show closed exposes checked state and removes closed cards from the accessibility tree when off", () => {
    const mount = mkMount();
    const items: AssignmentDetailMetadata[] = [
      meta({ assignmentId: "p1" }),
      meta({ assignmentId: "c1", status: "closed", title: "Old" }),
    ];
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => items,
      open: () => undefined,
    });
    const toggle = mount.querySelector<HTMLInputElement>(
      "[data-testid=active-assignments-show-closed]",
    );
    // Native checkbox exposes checked state programmatically.
    expect(toggle?.type).toBe("checkbox");
    expect(toggle?.checked).toBe(false);
    // Closed card is absent from the DOM (not just visually hidden) while
    // the toggle is off, so it cannot be reached by assistive technology.
    expect(
      mount.querySelector("[data-testid=active-assignment-card-c1]"),
    ).toBeNull();
    toggle!.checked = true;
    toggle!.dispatchEvent(new Event("change"));
    expect(
      mount.querySelector("[data-testid=active-assignment-card-c1]"),
    ).not.toBeNull();
    // Accessible name remains stable across the toggle.
    expect(toggle?.getAttribute("aria-label")).toBe("Show closed assignments");
  });

  test("Sprint 16 Slice 6: card title ids and card aria-labelledby refs are unique across the rendered section", () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [
        meta({ assignmentId: "p1" }),
        meta({ assignmentId: "p2", title: "Waves" }),
        meta({ assignmentId: "p3", title: "Signals" }),
      ],
      open: () => undefined,
    });
    const ids = Array.from(
      mount.querySelectorAll<HTMLElement>(
        "[data-testid^=active-assignment-title-]",
      ),
    ).map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      // Every card's aria-labelledby target exists exactly once.
      expect(mount.querySelectorAll(`#${id}`).length).toBe(1);
    }
  });

  test("Show closed toggle appears only when closed records exist, and toggles their visibility", () => {
    const mount = mkMount();
    const items: AssignmentDetailMetadata[] = [
      meta({ assignmentId: "p1" }),
      meta({ assignmentId: "c1", status: "closed", title: "Old" }),
    ];
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => items,
      open: () => undefined,
    });
    const toggle = mount.querySelector<HTMLInputElement>(
      "[data-testid=active-assignments-show-closed]",
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.checked).toBe(false);
    // closed hidden by default
    expect(
      mount.querySelector("[data-testid=active-assignment-card-c1]"),
    ).toBeNull();
    // published visible
    expect(
      mount.querySelector("[data-testid=active-assignment-card-p1]"),
    ).not.toBeNull();
    // toggle on
    toggle!.checked = true;
    toggle!.dispatchEvent(new Event("change"));
    expect(
      mount.querySelector("[data-testid=active-assignment-card-c1]"),
    ).not.toBeNull();
  });

  test("progress line renders after the summary callable resolves", async () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [meta({ assignmentId: "p1" })],
      open: () => undefined,
      summaryCallable: async () => ({
        assignmentId: "p1",
        classId: "c1",
        totalStudents: 10,
        completedStudents: 3,
        inProgressStudents: 2,
        notStartedStudents: 5,
        completionPercentage: 30,
        averagePercentage: null,
        highestPercentage: null,
        lowestPercentage: null,
        perfectScoreStudents: 0,
      }),
    });
    await flush();
    await flush();
    const progress = mount.querySelector(
      "[data-testid=active-assignment-progress-p1]",
    );
    expect(progress?.textContent).toBe("3 submitted / 5 started / 10 total");
  });

  test("progress line shows unavailable message on callable failure", async () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [meta({ assignmentId: "p1" })],
      open: () => undefined,
      summaryCallable: () => Promise.reject(new Error("boom")),
    });
    await flush();
    await flush();
    const progress = mount.querySelector(
      "[data-testid=active-assignment-progress-p1]",
    );
    expect(progress?.textContent).toBe("Progress temporarily unavailable");
  });

  test("Sprint 16 Slice 1: refresh({ assignmentIds }) evicts only the specified card and re-fetches on the next render", async () => {
    const mount = mkMount();
    const registry: AssignmentDetailMetadata[] = [
      meta({ assignmentId: "p1" }),
      meta({ assignmentId: "p2", title: "Waves", classId: "c2" }),
    ];
    const calls: string[] = [];
    const summary = (assignmentId: string) => ({
      assignmentId,
      classId: assignmentId === "p2" ? "c2" : "c1",
      totalStudents: 10,
      completedStudents: 1,
      inProgressStudents: 2,
      notStartedStudents: 7,
      completionPercentage: 10,
      averagePercentage: null,
      highestPercentage: null,
      lowestPercentage: null,
      perfectScoreStudents: 0,
    });
    const controller = renderActiveAssignmentsSection(mount, {
      listRegistry: () => registry,
      open: () => undefined,
      summaryCallable: async ({ assignmentId }) => {
        calls.push(assignmentId);
        return summary(assignmentId);
      },
    });
    await flush();
    await flush();
    expect(calls.sort()).toEqual(["p1", "p2"]);
    calls.length = 0;

    // Untargeted refresh preserves cache for entries still present.
    controller.refresh();
    await flush();
    await flush();
    expect(calls).toEqual([]);

    // Targeted refresh evicts exactly the specified id.
    controller.refresh({ assignmentIds: ["p1"] });
    await flush();
    await flush();
    expect(calls).toEqual(["p1"]);
  });

  test("Sprint 16 Slice 1: refresh with an empty assignmentIds list is a no-op beyond re-render", async () => {
    const mount = mkMount();
    const calls: string[] = [];
    const controller = renderActiveAssignmentsSection(mount, {
      listRegistry: () => [meta({ assignmentId: "p1" })],
      open: () => undefined,
      summaryCallable: async ({ assignmentId }) => {
        calls.push(assignmentId);
        return {
          assignmentId,
          classId: "c1",
          totalStudents: 0,
          completedStudents: 0,
          inProgressStudents: 0,
          notStartedStudents: 0,
          completionPercentage: 0,
          averagePercentage: null,
          highestPercentage: null,
          lowestPercentage: null,
          perfectScoreStudents: 0,
        };
      },
    });
    await flush();
    await flush();
    calls.length = 0;
    controller.refresh({ assignmentIds: [] });
    await flush();
    await flush();
    expect(calls).toEqual([]);
  });

  test("Sprint 16 Slice 5: toggling Show closed on and off does not re-issue summary calls for already-cached cards", async () => {
    const mount = mkMount();
    const items: AssignmentDetailMetadata[] = [
      meta({ assignmentId: "p1" }),
      meta({ assignmentId: "c1", status: "closed", title: "Old", classId: "c1" }),
    ];
    const calls: string[] = [];
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => items,
      open: () => undefined,
      summaryCallable: async ({ assignmentId }) => {
        calls.push(assignmentId);
        return {
          assignmentId,
          classId: "c1",
          totalStudents: 5,
          completedStudents: 1,
          inProgressStudents: 1,
          notStartedStudents: 3,
          completionPercentage: 20,
          averagePercentage: null,
          highestPercentage: null,
          lowestPercentage: null,
          perfectScoreStudents: 0,
        };
      },
    });
    await flush();
    await flush();
    // Initial render fetches only visible cards (published). Closed cards
    // stay off-screen until the toggle is engaged.
    expect(calls.slice().sort()).toEqual(["p1"]);
    const toggle = mount.querySelector<HTMLInputElement>(
      "[data-testid=active-assignments-show-closed]",
    );
    toggle!.checked = true;
    toggle!.dispatchEvent(new Event("change"));
    await flush();
    await flush();
    // Turning the toggle on fetches the newly revealed closed card exactly
    // once; the already-cached published card is not re-fetched.
    expect(calls.slice().sort()).toEqual(["c1", "p1"]);
    calls.length = 0;
    // Turning the toggle off hides the closed card but must not evict the
    // cached snapshot. Turning it back on renders from cache without any
    // additional network work.
    toggle!.checked = false;
    toggle!.dispatchEvent(new Event("change"));
    await flush();
    await flush();
    toggle!.checked = true;
    toggle!.dispatchEvent(new Event("change"));
    await flush();
    await flush();
    expect(calls).toEqual([]);
  });

  test("Sprint 16 Slice 5: an untargeted refresh preserves cached summaries for cards still in the registry", async () => {
    const mount = mkMount();
    const registry: AssignmentDetailMetadata[] = [
      meta({ assignmentId: "p1" }),
      meta({ assignmentId: "p2", title: "Waves", classId: "c2" }),
    ];
    const calls: string[] = [];
    const controller = renderActiveAssignmentsSection(mount, {
      listRegistry: () => registry,
      open: () => undefined,
      summaryCallable: async ({ assignmentId }) => {
        calls.push(assignmentId);
        return {
          assignmentId,
          classId: assignmentId === "p2" ? "c2" : "c1",
          totalStudents: 10,
          completedStudents: 0,
          inProgressStudents: 0,
          notStartedStudents: 10,
          completionPercentage: 0,
          averagePercentage: null,
          highestPercentage: null,
          lowestPercentage: null,
          perfectScoreStudents: 0,
        };
      },
    });
    await flush();
    await flush();
    calls.length = 0;
    // An `onConfirm` after a fresh publish calls `refresh()` with no
    // argument. Cards already cached must not be re-fetched.
    controller.refresh();
    await flush();
    await flush();
    expect(calls).toEqual([]);
  });

  test("card renders published date when publishedAt is present", () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [
        meta({ assignmentId: "p1", publishedAt: new Date("2026-07-18T12:00:00Z").getTime() }),
      ],
      open: () => undefined,
    });
    const date = mount.querySelector(
      "[data-testid=active-assignment-date-p1]",
    );
    expect(date?.textContent).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("Sprint 20: Active Assignments accordion", () => {
  beforeEach(() => {
    _resetActiveAssignmentsSessionStateForTest();
  });

  const summaryFor = (id: string, completed: number, total: number) => ({
    assignmentId: id,
    classId: "c1",
    totalStudents: total,
    completedStudents: completed,
    inProgressStudents: 0,
    notStartedStudents: total - completed,
    completionPercentage: total === 0 ? 0 : (completed / total) * 100,
    averagePercentage: null,
    highestPercentage: null,
    lowestPercentage: null,
    perfectScoreStudents: 0,
  });

  test("zero active assignments hides the entire section", () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [],
      open: () => undefined,
    });
    const section = mount.querySelector<HTMLElement>(
      "[data-testid=active-assignments-section]",
    );
    expect(section?.hidden).toBe(true);
    expect(
      mount.querySelector("[data-testid=active-assignments-accordion-toggle]"),
    ).toBeNull();
  });

  test("one active assignment shows count 1 in the accordion header", () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [meta({ assignmentId: "p1" })],
      open: () => undefined,
    });
    const heading = mount.querySelector(
      "[data-testid=active-assignments-title]",
    );
    expect(heading?.textContent).toBe("Active Assignments (1)");
  });

  test("multiple active assignments show correct count and one summary per assignment", () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [
        meta({ assignmentId: "p1", title: "Earth's Layers", className: "Beta" }),
        meta({ assignmentId: "p2", title: "Waves", className: "6A" }),
        meta({ assignmentId: "p3", title: "Signals", className: "6B" }),
      ],
      open: () => undefined,
    });
    expect(
      mount.querySelector("[data-testid=active-assignments-title]")?.textContent,
    ).toBe("Active Assignments (3)");
    const summaries = mount.querySelectorAll(
      "[data-testid^=active-assignment-summary-]",
    );
    expect(summaries.length).toBe(3);
  });

  test("default state is collapsed: expanded panel is hidden, summaries are visible", () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [meta({ assignmentId: "p1" })],
      open: () => undefined,
    });
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=active-assignments-accordion-toggle]",
    );
    expect(btn?.getAttribute("aria-expanded")).toBe("false");
    const summaries = mount.querySelector<HTMLElement>(
      "[data-testid=active-assignments-summaries]",
    );
    const expanded = mount.querySelector<HTMLElement>(
      "[data-testid=active-assignments-expanded]",
    );
    expect(summaries?.hidden).toBe(false);
    expect(expanded?.hidden).toBe(true);
  });

  test("collapsed summary line reads 'title • class • X/Y submissions'", async () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [
        meta({
          assignmentId: "p1",
          title: "Earth's Layers",
          className: "Beta",
        }),
      ],
      open: () => undefined,
      summaryCallable: async ({ assignmentId }) =>
        summaryFor(assignmentId, 10, 22),
    });
    await flush();
    await flush();
    const summary = mount.querySelector(
      "[data-testid=active-assignment-summary-p1]",
    );
    expect(summary?.textContent).toBe(
      "Earth's Layers • Beta • 10/22 submissions",
    );
  });

  test("collapsed summary falls back to 'Submission count unavailable' on error", async () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [
        meta({ assignmentId: "p1", title: "Waves", className: "6A" }),
      ],
      open: () => undefined,
      summaryCallable: () => Promise.reject(new Error("boom")),
    });
    await flush();
    await flush();
    const summary = mount.querySelector(
      "[data-testid=active-assignment-summary-p1]",
    );
    expect(summary?.textContent).toBe(
      "Waves • 6A • Submission count unavailable",
    );
  });

  test("clicking the header reveals the existing assignment card and hides summaries", () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [meta({ assignmentId: "p1" })],
      open: () => undefined,
    });
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=active-assignments-accordion-toggle]",
    );
    btn!.click();
    expect(btn?.getAttribute("aria-expanded")).toBe("true");
    const expanded = mount.querySelector<HTMLElement>(
      "[data-testid=active-assignments-expanded]",
    );
    const summaries = mount.querySelector<HTMLElement>(
      "[data-testid=active-assignments-summaries]",
    );
    expect(expanded?.hidden).toBe(false);
    expect(summaries?.hidden).toBe(true);
    expect(
      expanded?.querySelector("[data-testid=active-assignment-card-p1]"),
    ).not.toBeNull();
  });

  test("clicking the header a second time collapses it again", () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [meta({ assignmentId: "p1" })],
      open: () => undefined,
    });
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=active-assignments-accordion-toggle]",
    );
    btn!.click();
    btn!.click();
    expect(btn?.getAttribute("aria-expanded")).toBe("false");
    expect(
      mount.querySelector<HTMLElement>(
        "[data-testid=active-assignments-expanded]",
      )?.hidden,
    ).toBe(true);
    expect(
      mount.querySelector<HTMLElement>(
        "[data-testid=active-assignments-summaries]",
      )?.hidden,
    ).toBe(false);
  });

  test("Open assignment button in the expanded card still works", () => {
    const mount = mkMount();
    const opened: string[] = [];
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [meta({ assignmentId: "p1" })],
      open: (id) => {
        opened.push(id);
      },
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=active-assignments-accordion-toggle]",
      )!
      .click();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=active-assignment-open-p1]",
      )!
      .click();
    expect(opened).toEqual(["p1"]);
  });

  test("keyboard: pressing Space on the header toggles expanded state", () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [meta({ assignmentId: "p1" })],
      open: () => undefined,
    });
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=active-assignments-accordion-toggle]",
    );
    // Native <button> semantics: Space and Enter fire a click. Assert the
    // element is a real button so the browser gives us that behavior for
    // free, then dispatch the click that Space/Enter would produce.
    expect(btn?.tagName).toBe("BUTTON");
    expect(btn?.type).toBe("button");
    btn!.click();
    expect(btn?.getAttribute("aria-expanded")).toBe("true");
  });

  test("accessibility: header exposes aria-expanded and aria-controls targeting the expanded panel", () => {
    const mount = mkMount();
    renderActiveAssignmentsSection(mount, {
      listRegistry: () => [meta({ assignmentId: "p1" })],
      open: () => undefined,
    });
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=active-assignments-accordion-toggle]",
    );
    const controlsId = btn?.getAttribute("aria-controls");
    expect(controlsId).toBeTruthy();
    expect(btn?.getAttribute("aria-expanded")).toBe("false");
    const panel = mount.querySelector(`#${controlsId}`);
    expect(panel).not.toBeNull();
    expect(
      panel?.getAttribute("data-testid"),
    ).toBe("active-assignments-expanded");
  });

  test("expanded state persists across re-renders (simulating workspace tab navigation)", () => {
    const mount1 = mkMount();
    renderActiveAssignmentsSection(mount1, {
      listRegistry: () => [meta({ assignmentId: "p1" })],
      open: () => undefined,
    });
    mount1
      .querySelector<HTMLButtonElement>(
        "[data-testid=active-assignments-accordion-toggle]",
      )!
      .click();
    // Navigate away by discarding the mount, then re-render into a fresh
    // mount as the shell would when the teacher returns to Curriculum.
    mount1.remove();
    const mount2 = mkMount();
    renderActiveAssignmentsSection(mount2, {
      listRegistry: () => [meta({ assignmentId: "p1" })],
      open: () => undefined,
    });
    const btn = mount2.querySelector<HTMLButtonElement>(
      "[data-testid=active-assignments-accordion-toggle]",
    );
    expect(btn?.getAttribute("aria-expanded")).toBe("true");
    expect(
      mount2.querySelector<HTMLElement>(
        "[data-testid=active-assignments-expanded]",
      )?.hidden,
    ).toBe(false);
  });
});
