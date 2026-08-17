/**
 * @jest-environment jsdom
 *
 * Sprint 25 Phase 3 - B6 certification-found defect regression tests.
 *
 * Browser certification confirmed the Assign backend lifecycle succeeds but
 * the teacher perceived no visible success confirmation:
 *
 *   1. The quiet self-dismissing banner was rendered but the teacher, still
 *      scrolled near the assigned lesson card, never saw it. The banner is
 *      now a fixed toast anchored near the top of the viewport (visibility
 *      marked in the DOM by the `shell-curriculum-success-visible` class).
 *   2. `showSuccess()` created a new self-dismiss timeout on every call but
 *      never cleared the previous one, so the optimistic "Assigning..."
 *      timer could hide the final "Assigned" message early.
 *
 * These tests pin both fixes and confirm the ✓ Assigned badge still updates.
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type { AssignmentsCallables } from "../../settings/integrations/types";
import {
  renderCurriculumSurface,
  _resetCurriculumSessionStateForTest,
  _showSuccessForTest,
} from "./curriculum";

const freeze = <T>(v: T): T => Object.freeze(v) as T;
const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await flush();
};

const teacher: Extract<Session, { kind: "activeTeacher" }> = freeze({
  kind: "activeTeacher",
  uid: "u-teacher",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

const oneClass: ReadonlyArray<ClassSummary> = freeze([
  freeze({ id: "c1", title: "7A", grade: "7", status: "active" }),
] as ClassSummary[]);
const listOne: ListClasses = () => Promise.resolve(oneClass);

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const okAssignments = (): {
  seam: AssignmentsCallables;
  publishes: string[];
} => {
  const publishes: string[] = [];
  return {
    publishes,
    seam: {
      createDraft: async (input) => ({
        assignmentId: input.assignmentId,
        status: "draft",
        alreadyCreated: false,
      }),
      publish: async (input) => {
        publishes.push(input.assignmentId);
        return {
          assignmentId: input.assignmentId,
          status: "published",
          alreadyPublished: false,
        };
      },
    },
  };
};

const bannerEl = (mount: HTMLElement): HTMLElement | null =>
  mount.querySelector<HTMLElement>("[data-testid=assign-success]");

const assignAndConfirm = async (
  mount: HTMLElement,
  slug: string,
): Promise<void> => {
  mount
    .querySelector<HTMLButtonElement>(`[data-testid=lesson-assign-${slug}]`)
    ?.click();
  await settle();
  document
    .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
    ?.click();
  await settle();
};

describe("B6 success banner - visibility after successful assignment", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("banner is visible with the final summary after a successful assignment", async () => {
    const asn = okAssignments();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      integrations: null,
      assignments: asn.seam,
    });

    await assignAndConfirm(mount, "earths-layers");

    const banner = bannerEl(mount);
    expect(banner).not.toBeNull();
    // Backend actually published.
    expect(asn.publishes.length).toBe(1);
    // The banner is shown, not hidden at the bottom of the surface.
    expect(banner!.hidden).toBe(false);
    // The DOM marks it viewport-visible (the fixed toast anchor).
    expect(banner!.classList.contains("shell-curriculum-success-visible")).toBe(
      true,
    );
    // aria-live semantics preserved.
    expect(banner!.getAttribute("role")).toBe("status");
    expect(banner!.getAttribute("aria-live")).toBe("polite");
  });

  test("banner shows the final Assigned line, not the optimistic Assigning line", async () => {
    const asn = okAssignments();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      integrations: null,
      assignments: asn.seam,
    });

    await assignAndConfirm(mount, "earths-layers");

    const banner = bannerEl(mount);
    // The optimistic callback fired first, then the final outcome replaced
    // it. The visible text is the settled Assigned confirmation.
    expect(banner!.hidden).toBe(false);
    expect(banner!.textContent).toContain("Assigned");
    expect(banner!.textContent).not.toContain("Assigning");
  });

  test("successful assignment still lights the ✓ Assigned badge on the card", async () => {
    const asn = okAssignments();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      integrations: null,
      assignments: asn.seam,
    });

    await assignAndConfirm(mount, "earths-layers");

    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-assign-earths-layers]",
    );
    expect(btn?.getAttribute("data-assigned")).toBe("true");
    expect(btn?.textContent).toBe("✓ Assigned");
  });
});

describe("B6 success banner - self-dismiss timer correctness", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test("second showSuccess replaces the first timer; only the newest dismisses", () => {
    jest.useFakeTimers();
    const banner = document.createElement("p");
    document.body.appendChild(banner);
    banner.hidden = true;

    // Optimistic message installs timer T1 at t=0.
    _showSuccessForTest(banner, "Assigning earths-layers to 1 class.");
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain("Assigning");

    // 100ms later the final outcome replaces the optimistic line and
    // installs timer T2, clearing T1.
    jest.advanceTimersByTime(100);
    _showSuccessForTest(banner, "Assigned earths-layers to 1 class.");
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain("Assigned");

    // At t=4000, T1 would have fired under the old code and hidden the
    // final message. With T1 cleared, the banner stays visible.
    jest.advanceTimersByTime(3900);
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain("Assigned");

    // The banner self-dismisses only after the newest timer (t=4100).
    jest.advanceTimersByTime(100);
    expect(banner.hidden).toBe(true);
    expect(banner.textContent).toBe("");
  });

  test("banner remains visible for the full 4s after the newest message", () => {
    jest.useFakeTimers();
    const banner = document.createElement("p");
    document.body.appendChild(banner);
    banner.hidden = true;

    _showSuccessForTest(banner, "Assigning earths-layers to 1 class.");
    jest.advanceTimersByTime(500);
    _showSuccessForTest(banner, "Assigned earths-layers to 1 class.");

    // Just before the newest timer expires: still visible.
    jest.advanceTimersByTime(3999);
    expect(banner.hidden).toBe(false);

    // The moment it expires: dismissed.
    jest.advanceTimersByTime(1);
    expect(banner.hidden).toBe(true);
  });
});
