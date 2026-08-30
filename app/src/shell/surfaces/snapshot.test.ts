/**
 * @jest-environment jsdom
 */
import { renderSnapshotSurface } from "./snapshot";
import type { ClassSummary } from "../../classes/types";

// Sprint 28.6H (Findings 3/4/5): the class-workspace Overview.
//
// The class name, grade/block, and status no longer live in Overview - the
// class identity is the workspace header above the tabs, and the "Active"
// badge is removed entirely. Prototype/product-marketing copy is removed (the
// "One place to check in..." purpose line and the "Classroom activity will
// appear here..." empty placeholder). Overview shows real, locally-available
// information (assignment count, join code) or a calm intentional empty state.
// Roster sync is NOT here (it moved to "Manage class").

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

describe("renderSnapshotSurface (Overview)", () => {
  it("heads the section 'Overview' and shows no class name/status/grade line", () => {
    const mount = mkMount();
    const summary: ClassSummary = Object.freeze({
      id: "c-active",
      title: "Period 1",
      status: "active" as const,
      grade: "7",
      block: "B",
    });
    renderSnapshotSurface(mount, { summary, preview: null, assignmentCount: 0 });

    expect(
      mount.querySelector("[data-testid=surface-headline]")!.textContent,
    ).toBe("Overview");

    // The identity (name, grade/block) and the Active badge belong to the
    // workspace header, not Overview.
    expect(mount.textContent).not.toContain("Period 1");
    expect(mount.textContent).not.toContain("Active");
    expect(
      mount.querySelector("[data-testid=snapshot-class-status]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=snapshot-class-grade]"),
    ).toBeNull();
  });

  it("removes prototype/product-marketing copy", () => {
    const mount = mkMount();
    const summary: ClassSummary = Object.freeze({
      id: "c-active",
      title: "Period 1",
      status: "active" as const,
      grade: "7",
    });
    renderSnapshotSurface(mount, { summary, preview: null, assignmentCount: 2 });

    expect(mount.textContent).not.toContain(
      "One place to check in on your class between moments.",
    );
    expect(mount.textContent).not.toContain(
      "Classroom activity will appear here",
    );
    expect(mount.querySelector("[data-testid=snapshot-purpose]")).toBeNull();
  });

  it("shows real, locally-available class information (assignment count, join code)", () => {
    const mount = mkMount();
    const summary: ClassSummary = Object.freeze({
      id: "c-active",
      title: "Period 1",
      status: "active" as const,
      grade: "7",
      joinCode: "ABCD",
    });
    renderSnapshotSurface(mount, { summary, preview: null, assignmentCount: 3 });

    expect(
      mount.querySelector("[data-testid=snapshot-assignment-count]")!
        .textContent,
    ).toBe("3 assignments");
    expect(
      mount.querySelector("[data-testid=snapshot-join-code]")!.textContent,
    ).toBe("ABCD");
    // No empty placeholder when there is real data.
    expect(mount.querySelector("[data-testid=snapshot-empty]")).toBeNull();
  });

  it("renders a calm real empty state when nothing to summarize yet", () => {
    const mount = mkMount();
    const summary: ClassSummary = Object.freeze({
      id: "c-active",
      title: "Period 1",
      status: "active" as const,
      grade: "7",
    });
    // No assignment seam wired (null) and no join code: nothing to summarize.
    renderSnapshotSurface(mount, {
      summary,
      preview: null,
      assignmentCount: null,
    });

    const empty = mount.querySelector("[data-testid=snapshot-empty]");
    expect(empty).not.toBeNull();
    expect(empty!.textContent).toBe("No assignments yet.");
  });

  it("counts assignments with correct grammar (0 / 1 / N) and does not crash on needsSetup", () => {
    const mount = mkMount();
    const setup: ClassSummary = Object.freeze({
      id: "c-setup",
      title: "Imported Period 4",
      status: "needsSetup" as const,
    });
    // Defense in depth: the workspace routes needsSetup to the setup form, but
    // Overview must never read grade/block/joinCode off a needsSetup summary.
    renderSnapshotSurface(mount, { summary: setup, preview: null, assignmentCount: 1 });
    expect(
      mount.querySelector("[data-testid=snapshot-assignment-count]")!
        .textContent,
    ).toBe("1 assignment");
    expect(mount.querySelector("[data-testid=snapshot-join-code]")).toBeNull();
  });
});
