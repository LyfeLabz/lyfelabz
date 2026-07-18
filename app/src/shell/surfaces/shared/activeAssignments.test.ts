/**
 * @jest-environment jsdom
 */
import {
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
    expect(heading?.textContent).toBe("Active assignments");
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
    expect(card?.getAttribute("aria-label")).toContain("Earth's Layers");
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
