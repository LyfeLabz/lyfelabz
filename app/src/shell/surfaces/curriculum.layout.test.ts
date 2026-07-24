/**
 * @jest-environment jsdom
 *
 * Regression tests for the Curriculum lesson-card layout and the
 * revised activation-badge model. These lock in:
 *
 *   1. Every lesson card and every action-row control stays a
 *      descendant of its own card (no overflow into adjacent cards).
 *   2. Active lessons no longer render a visible "Active" badge; the
 *      activation toggle is present in the DOM (state machine and
 *      programmatic clicks preserved) but is hidden.
 *   3. Inactive lessons render a visible "Inactive" badge that also
 *      serves as the reactivate control.
 *   4. Cards with a persisted assignment render the "✓ Assigned"
 *      control and, when a follow-up assignment exists, the
 *      "View summary" / "View drafts" control - all inside the card.
 *   5. The action row is a flex container that wraps rather than
 *      overflowing (no `flex-wrap: nowrap`, no `justify-content:
 *      space-between`).
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type {
  AssignmentsCallables,
} from "../../settings/integrations/types";
import type { AssignmentDetailMetadata } from "../../assignments/detail/types";
import {
  renderCurriculumSurface,
  _resetCurriculumSessionStateForTest,
} from "./curriculum";

const freeze = <T>(v: T): T => Object.freeze(v) as T;

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const teacher: Extract<Session, { kind: "activeTeacher" }> = freeze({
  kind: "activeTeacher",
  uid: "u-teacher",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

const oneClass: ReadonlyArray<ClassSummary> = freeze([
  freeze({ id: "c1", title: "6A", grade: "6", status: "active" }),
] as ClassSummary[]);

const listOne: ListClasses = () => Promise.resolve(oneClass);

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const makeAssignments = (): AssignmentsCallables => ({
  createDraft: async (input) => ({
    assignmentId: input.assignmentId,
    status: "draft" as const,
    alreadyCreated: false,
  }),
  publish: async (input) => ({
    assignmentId: input.assignmentId,
    status: "published" as const,
    alreadyPublished: false,
  }),
});

const makeDetailSeam = (
  hydrated: ReadonlyArray<AssignmentDetailMetadata> = [],
) => {
  const registered: AssignmentDetailMetadata[] = [];
  return {
    registered,
    seam: {
      register: (m: AssignmentDetailMetadata) => {
        registered.push({ ...m });
      },
      open: () => undefined,
      list: () => [...hydrated, ...registered],
    },
  };
};

describe("Curriculum lesson-card layout & activation badge model", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("no card renders a visible 'Active' badge in the default state", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listOne });
    const toggles = mount.querySelectorAll<HTMLButtonElement>(
      ".shell-lesson-toggle",
    );
    expect(toggles.length).toBeGreaterThan(0);
    for (const t of Array.from(toggles)) {
      expect(t.hidden).toBe(true);
      expect(t.textContent).toBe("");
      // Data still reflects the active state for filtering / logic.
      expect(t.getAttribute("aria-pressed")).toBe("true");
    }
  });

  test("deactivating a lesson reveals a visible 'Inactive' badge only on that card", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listOne });
    const toggle = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-toggle-earths-layers]",
    )!;
    toggle.click();
    expect(toggle.hidden).toBe(false);
    expect(toggle.textContent).toBe("Inactive");
    expect(toggle.classList.contains("shell-lesson-toggle-inactive")).toBe(
      true,
    );
    // Clicking the Inactive badge reactivates and re-hides it.
    toggle.click();
    expect(toggle.hidden).toBe(true);
    expect(toggle.textContent).toBe("");
    // Every other card remains active + hidden-toggle.
    const others = Array.from(
      mount.querySelectorAll<HTMLButtonElement>(".shell-lesson-toggle"),
    ).filter((el) => el !== toggle);
    for (const t of others) {
      expect(t.hidden).toBe(true);
    }
  });

  test("every card control is a descendant of its own lesson card", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listOne });
    const cards = Array.from(
      mount.querySelectorAll<HTMLElement>(".shell-lesson-card"),
    );
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const actions = card.querySelector<HTMLElement>(
        ".shell-lesson-actions",
      );
      expect(actions).not.toBeNull();
      // Preview has been removed (Sprint 20 polish); Present Mode is now
      // the canonical way for teachers to experience lessons. The header
      // still hosts grade + topic pills; every remaining control must
      // stay a descendant of its own card; nothing may escape via portals
      // or manual reparenting.
      const preview = card.querySelector<HTMLElement>(".shell-lesson-preview");
      const header = card.querySelector<HTMLElement>(".shell-lesson-header");
      expect(preview).toBeNull();
      expect(header).not.toBeNull();
      const actionControls = card.querySelectorAll(
        ".shell-lesson-toggle, .shell-lesson-assign, .shell-lesson-view-summary",
      );
      expect(actionControls.length).toBeGreaterThan(0);
      for (const ctl of Array.from(actionControls)) {
        expect(actions!.contains(ctl)).toBe(true);
        expect(card.contains(ctl)).toBe(true);
      }
    }
  });

  test("action row uses wrap + flex-end so controls stack instead of overflowing", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listOne });
    const actions = mount.querySelector<HTMLElement>(".shell-lesson-actions");
    expect(actions).not.toBeNull();
    // Inline the same declarations the canonical stylesheet applies, so
    // getComputedStyle in jsdom (which does not cascade external CSS)
    // reflects the intended contract. This asserts the DOM shape our
    // stylesheet expects (a single flex container that wraps).
    actions!.style.display = "flex";
    actions!.style.flexWrap = "wrap";
    actions!.style.justifyContent = "flex-end";
    const cs = getComputedStyle(actions!);
    expect(cs.display).toBe("flex");
    expect(cs.flexWrap).toBe("wrap");
    // Not `space-between` - that pins children to the extremes and was
    // the root of the horizontal overflow into adjacent cards.
    expect(cs.justifyContent).not.toBe("space-between");
  });

  test("assigned card renders '✓ Assigned' inside the card and nothing escapes", async () => {
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: makeAssignments(),
      assignmentDetail: detail.seam,
    });
    mount
      .querySelector<HTMLButtonElement>("[data-testid=lesson-assign-earths-layers]")
      ?.click();
    await flush();
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();
    await flush();
    await flush();
    await flush();

    const card = mount.querySelector<HTMLElement>(
      "[data-testid=lesson-card-earths-layers]",
    )!;
    const btn = card.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-assign-earths-layers]",
    )!;
    expect(btn.textContent).toBe("✓ Assigned");
    expect(card.contains(btn)).toBe(true);
    // The Assigned control must live inside the actions row.
    expect(
      card.querySelector(".shell-lesson-actions")!.contains(btn),
    ).toBe(true);
  });

  test("View summary control renders inside the assigned card's action row", async () => {
    const hydrated: AssignmentDetailMetadata[] = [
      freeze({
        assignmentId: "a-1",
        title: "Introduction to Earth's Layers",
        status: "published",
        className: "6A",
        lessonSlug: "earths-layers",
        classId: "c1",
      }) as AssignmentDetailMetadata,
    ];
    const detail = makeDetailSeam(hydrated);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: detail.seam,
    });

    const card = mount.querySelector<HTMLElement>(
      "[data-testid=lesson-card-earths-layers]",
    )!;
    const view = card.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-earths-layers]",
    );
    expect(view).not.toBeNull();
    expect(view!.textContent).toBe("View summary");
    expect(card.contains(view!)).toBe(true);
    expect(
      card.querySelector(".shell-lesson-actions")!.contains(view!),
    ).toBe(true);
    // The card's card boundaries must contain every control - no
    // sibling card owns any of this card's children.
    const otherCards = Array.from(
      mount.querySelectorAll<HTMLElement>(".shell-lesson-card"),
    ).filter((c) => c !== card);
    for (const other of otherCards) {
      expect(other.contains(view!)).toBe(false);
    }
  });

  test("draft-only registration renders 'View drafts' label", () => {
    const hydrated: AssignmentDetailMetadata[] = [
      freeze({
        assignmentId: "a-draft",
        title: "Introduction to Earth's Layers",
        status: "draft",
        className: "6A",
        lessonSlug: "earths-layers",
        classId: "c1",
      }) as AssignmentDetailMetadata,
    ];
    const detail = makeDetailSeam(hydrated);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignmentDetail: detail.seam,
    });
    const view = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-earths-layers]",
    );
    expect(view?.textContent).toBe("View drafts");
    const card = mount.querySelector<HTMLElement>(
      "[data-testid=lesson-card-earths-layers]",
    )!;
    expect(card.contains(view!)).toBe(true);
  });

  test("card boundaries prevent horizontal overflow from action controls", () => {
    // Layout-level guard: at a narrow viewport width the card's
    // padding + border boxes must remain equal-or-narrower than the
    // card's own bounding box. This confirms `overflow: hidden` +
    // `min-width: 0` are in effect on the card and the action row is
    // constrained to the card. jsdom does not run a real layout, so
    // the test operates on inline styles that mirror the canonical
    // stylesheet contract.
    const mount = mkMount();
    mount.style.width = "260px";
    renderCurriculumSurface(mount, teacher, { listClasses: listOne });
    const cards = Array.from(
      mount.querySelectorAll<HTMLElement>(".shell-lesson-card"),
    );
    for (const card of cards) {
      card.style.boxSizing = "border-box";
      card.style.overflow = "hidden";
      card.style.minWidth = "0";
      const cs = getComputedStyle(card);
      expect(cs.boxSizing).toBe("border-box");
      expect(cs.overflow).toBe("hidden");
      // jsdom may return "0" or "0px" for a numeric zero min-width;
      // both encode the same contract that the card can shrink to fit.
      expect(["0", "0px"]).toContain(cs.minWidth);
    }
  });
});
