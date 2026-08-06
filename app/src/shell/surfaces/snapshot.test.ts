/**
 * @jest-environment jsdom
 */
import { renderSnapshotSurface } from "./snapshot";
import type { ClassSummary } from "../../classes/types";

// Sprint 24B Phase 2B.1 unit coverage for the Snapshot surface's safe
// handling of the extended `ClassStatus` union. Snapshot chose the
// safe-render path (Reader Audit §5 C8) so a class opened mid-setup
// does not render an `undefined` label or crash reading `grade`. Any
// re-routing of needsSetup classes to the setup form is a Phase 2B.4
// concern and is not asserted here.

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

describe("renderSnapshotSurface needsSetup safety", () => {
  it("renders the Setup needed pill without crashing on absent grade", () => {
    const mount = mkMount();
    const summary: ClassSummary = Object.freeze({
      id: "c-setup",
      title: "Imported Period 4",
      status: "needsSetup" as const,
    });
    renderSnapshotSurface(mount, { summary, preview: null });

    const pill = mount.querySelector<HTMLElement>(
      "[data-testid=snapshot-class-status]",
    );
    expect(pill).not.toBeNull();
    expect(pill!.textContent).toBe("Setup needed");
    expect(pill!.getAttribute("aria-label")).toBe(
      "Class status: Setup needed",
    );

    // No grade element is rendered for a needsSetup class.
    expect(
      mount.querySelector("[data-testid=snapshot-class-grade]"),
    ).toBeNull();
  });

  it("renders grade and Active pill for an active summary", () => {
    const mount = mkMount();
    const summary: ClassSummary = Object.freeze({
      id: "c-active",
      title: "Period 1",
      status: "active" as const,
      grade: "7",
    });
    renderSnapshotSurface(mount, { summary, preview: null });

    const grade = mount.querySelector<HTMLElement>(
      "[data-testid=snapshot-class-grade]",
    );
    expect(grade).not.toBeNull();
    expect(grade!.textContent).toBe("Grade 7");

    const pill = mount.querySelector<HTMLElement>(
      "[data-testid=snapshot-class-status]",
    );
    expect(pill!.textContent).toBe("Active");
  });
});
