/**
 * @jest-environment jsdom
 *
 * Sprint 30A.1 Class Card Settings V1.
 *
 * Human review finalized the class-card interaction model: click opens
 * the class, a drag handle in the upper-right corner reorders it, and a
 * new settings gear in the lower-right corner opens a Class Settings
 * modal (display name, grade, block, color). This file covers:
 *   - the three controls are visually/behaviorally distinct and never
 *     trigger each other,
 *   - the settings modal populates, validates, saves, and fails
 *     correctly,
 *   - display name / grade / block / color each behave per spec,
 *   - editing settings never disturbs canonical class order.
 *
 * Reordering itself (drag, keyboard, persistence, failure state) is
 * covered by classes.class-reorder.test.ts and is not re-tested here.
 */
import { renderClassesSurface } from "./classes";
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { UpdateClassMetadataInput } from "../../classes/updateClassMetadata";
import type { ClassColorToken } from "../../classes/classColor";

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

const teacher: ActiveTeacher = Object.freeze({
  kind: "activeTeacher",
  uid: "teacher-1",
  schoolId: "school-1",
  displayName: "Ms. Teacher",
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await flush();
};

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const fourClasses: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({ id: "c1", title: "A Science", grade: "6", block: "A", status: "active" }),
  Object.freeze({ id: "c2", title: "C Science", grade: "6", block: "C", status: "active" }),
  Object.freeze({ id: "c3", title: "E Science", grade: "7", block: "E", status: "active" }),
  Object.freeze({ id: "c4", title: "G Science", grade: "7", block: "G", status: "active" }),
] as ClassSummary[]);
const listFour = async (): Promise<ReadonlyArray<ClassSummary>> => fourClasses;

const domOrder = (): string[] =>
  Array.from(document.querySelectorAll<HTMLElement>(".shell-classes-item")).map(
    (el) => el.getAttribute("data-class-id") ?? "",
  );

const openSettings = async (classId: string): Promise<void> => {
  document
    .querySelector<HTMLButtonElement>(`[data-testid=class-card-settings-${classId}]`)!
    .click();
  await flush();
};

const titleInput = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(
    "[data-testid=classes-settings-title-input]",
  )!;
const gradeSelect = (): HTMLSelectElement =>
  document.querySelector<HTMLSelectElement>("[data-testid=classes-settings-grade]")!;
const blockSelect = (): HTMLSelectElement =>
  document.querySelector<HTMLSelectElement>("[data-testid=classes-settings-block]")!;
const colorSwatch = (token: ClassColorToken | "none"): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>(
    `[data-testid=classes-settings-color-${token}]`,
  )!;
const saveButton = (): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>("[data-testid=classes-settings-save]")!;
const cancelButton = (): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>("[data-testid=classes-settings-cancel]")!;
const errorMessage = (): HTMLElement =>
  document.querySelector<HTMLElement>("[data-testid=classes-settings-error]")!;
const modal = (): HTMLElement | null =>
  document.querySelector<HTMLElement>("[data-testid=classes-settings-overlay]");

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Class card controls (Sprint 30A.1 Class Card Settings V1)", () => {
  test("each card has exactly one drag handle and one settings button, both inside the card", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    for (const id of ["c1", "c2", "c3", "c4"]) {
      const card = document.querySelector<HTMLElement>(`[data-testid=class-card-${id}]`)!;
      const handle = document.querySelector<HTMLElement>(
        `[data-testid=class-card-drag-${id}]`,
      )!;
      const gear = document.querySelector<HTMLElement>(
        `[data-testid=class-card-settings-${id}]`,
      )!;
      // Both controls are descendants of the card tile itself - not
      // floating siblings above/outside it.
      expect(card.contains(handle)).toBe(true);
      expect(card.contains(gear)).toBe(true);
      expect(handle).not.toBe(gear);
    }
    // Exactly one of each per card, dialog-wide.
    expect(document.querySelectorAll("[data-testid^=class-card-drag-]")).toHaveLength(4);
    expect(document.querySelectorAll("[data-testid^=class-card-settings-]")).toHaveLength(4);
  });

  test("no floating reorder control exists outside any card", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    // Every drag handle must be inside SOME .shell-class-card.
    const handles = Array.from(
      document.querySelectorAll<HTMLElement>("[data-testid^=class-card-drag-]"),
    );
    for (const handle of handles) {
      expect(handle.closest(".shell-class-card")).not.toBeNull();
    }
  });

  test("clicking the settings gear opens settings, not the class, and does not bubble to the card", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    await openSettings("c1");
    expect(modal()).not.toBeNull();
    // Still on the list - the class did not open.
    expect(document.querySelector("[data-testid=classes-list]")).not.toBeNull();
    expect(document.querySelector("[data-testid=class-nav-roster]")).toBeNull();
  });

  test("a bare click/keyboard activation of the drag handle never opens the class", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    document
      .querySelector<HTMLButtonElement>("[data-testid=class-card-drag-c1]")!
      .click();
    await flush();
    // Still on the list.
    expect(document.querySelector("[data-testid=classes-list]")).not.toBeNull();
  });

  test("the settings button has the correct accessible label", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    const gear = document.querySelector<HTMLElement>(
      "[data-testid=class-card-settings-c1]",
    )!;
    expect(gear.getAttribute("aria-label")).toBe("Class settings for A Science");
  });
});

describe("Class Settings modal (Sprint 30A.1 Class Card Settings V1)", () => {
  test("opens for the correct class and populates current values", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassMetadata: async (input: UpdateClassMetadataInput) => ({
        classId: input.classId,
        alreadyUpdated: false,
      }),
    });
    await flush();

    await openSettings("c3");
    expect(titleInput().value).toBe("E Science");
    expect(gradeSelect().value).toBe("7");
    expect(blockSelect().value).toBe("E");
  });

  test("Cancel makes no write and closes without mutating the card", async () => {
    let calls = 0;
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassMetadata: async (input: UpdateClassMetadataInput) => {
        calls += 1;
        return { classId: input.classId, alreadyUpdated: false };
      },
    });
    await flush();

    await openSettings("c1");
    titleInput().value = "Changed Name";
    titleInput().dispatchEvent(new Event("input"));
    cancelButton().click();
    await flush();

    expect(calls).toBe(0);
    expect(modal()).toBeNull();
    expect(
      document.querySelector("[data-testid=class-title-c1]")?.textContent,
    ).toBe("A Science");
  });

  test("Save sends only the fields that actually changed", async () => {
    const calls: UpdateClassMetadataInput[] = [];
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassMetadata: async (input: UpdateClassMetadataInput) => {
        calls.push(input);
        return { classId: input.classId, alreadyUpdated: false };
      },
    });
    await flush();

    await openSettings("c1");
    titleInput().value = "A Science";
    titleInput().dispatchEvent(new Event("input"));
    gradeSelect().value = "7";
    gradeSelect().dispatchEvent(new Event("change"));
    saveButton().click();
    await settle();

    expect(calls).toHaveLength(1);
    // Title unchanged, so it is NOT sent; only grade is.
    expect(calls[0]).toEqual({ classId: "c1", grade: "7" });
  });

  test("a successful save updates the card immediately and closes the modal", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassMetadata: async (input: UpdateClassMetadataInput) => ({
        classId: input.classId,
        alreadyUpdated: false,
      }),
    });
    await flush();

    await openSettings("c1");
    titleInput().value = "A Science Renamed";
    titleInput().dispatchEvent(new Event("input"));
    saveButton().click();
    await settle();

    expect(modal()).toBeNull();
    expect(
      document.querySelector("[data-testid=class-title-c1]")?.textContent,
    ).toBe("A Science Renamed");
  });

  test("a failed save keeps the modal open and shows a useful, non-technical error", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassMetadata: async () => {
        throw { code: "classes.forbidden" };
      },
    });
    await flush();

    await openSettings("c1");
    titleInput().value = "New Name";
    titleInput().dispatchEvent(new Event("input"));
    saveButton().click();
    await settle();

    expect(modal()).not.toBeNull();
    expect(errorMessage().hidden).toBe(false);
    expect(errorMessage().textContent).toMatch(/permission/i);
    // The card must NOT have been optimistically renamed on failure.
    expect(
      document.querySelector("[data-testid=class-title-c1]")?.textContent,
    ).toBe("A Science");
  });

  test("saving with no actual changes closes the modal without any write", async () => {
    let calls = 0;
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassMetadata: async () => {
        calls += 1;
        return { classId: "c1", alreadyUpdated: true };
      },
    });
    await flush();

    await openSettings("c1");
    saveButton().click();
    await settle();

    expect(calls).toBe(0);
    expect(modal()).toBeNull();
  });
});

describe("Display name (Sprint 30A.1 Class Card Settings V1)", () => {
  test("a valid rename succeeds and whitespace is trimmed", async () => {
    const calls: UpdateClassMetadataInput[] = [];
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassMetadata: async (input: UpdateClassMetadataInput) => {
        calls.push(input);
        return { classId: input.classId, alreadyUpdated: false };
      },
    });
    await flush();

    await openSettings("c1");
    titleInput().value = "   Trimmed Name   ";
    titleInput().dispatchEvent(new Event("input"));
    saveButton().click();
    await settle();

    expect(calls).toEqual([{ classId: "c1", title: "Trimmed Name" }]);
  });

  test("an empty display name is rejected client-side, with no write", async () => {
    let calls = 0;
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassMetadata: async () => {
        calls += 1;
        return { classId: "c1", alreadyUpdated: false };
      },
    });
    await flush();

    await openSettings("c1");
    titleInput().value = "   ";
    titleInput().dispatchEvent(new Event("input"));
    saveButton().click();
    await settle();

    expect(calls).toBe(0);
    expect(modal()).not.toBeNull();
    expect(errorMessage().hidden).toBe(false);
  });

  test("an overlong display name is rejected client-side, with no write", async () => {
    let calls = 0;
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassMetadata: async () => {
        calls += 1;
        return { classId: "c1", alreadyUpdated: false };
      },
    });
    await flush();

    await openSettings("c1");
    titleInput().value = "x".repeat(500);
    titleInput().dispatchEvent(new Event("input"));
    saveButton().click();
    await settle();

    expect(calls).toBe(0);
    expect(modal()).not.toBeNull();
  });

  test("renaming an LMS-linked class never touches Google Classroom - only classesUpdateMetadata is called", async () => {
    const linkedClasses: ReadonlyArray<ClassSummary> = Object.freeze([
      Object.freeze({
        id: "c1",
        title: "A Science",
        grade: "6",
        block: "A",
        status: "active",
        isLmsLinked: true,
      }),
    ] as ClassSummary[]);
    const calls: UpdateClassMetadataInput[] = [];
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: async () => linkedClasses,
      updateClassMetadata: async (input: UpdateClassMetadataInput) => {
        calls.push(input);
        return { classId: input.classId, alreadyUpdated: false };
      },
    });
    await flush();

    await openSettings("c1");
    titleInput().value = "A Science Renamed";
    titleInput().dispatchEvent(new Event("input"));
    saveButton().click();
    await settle();

    // Only the LyfeLabz metadata callable was invoked. No Classroom
    // callable exists on this deps object at all - there is nothing here
    // that COULD call Google Classroom, by construction.
    expect(calls).toEqual([{ classId: "c1", title: "A Science Renamed" }]);
    expect(
      document.querySelector("[data-testid=class-title-c1]")?.textContent,
    ).toBe("A Science Renamed");
  });
});

describe("Grade (Sprint 30A.1 Class Card Settings V1)", () => {
  test("shows the current grade and offers only the existing closed vocabulary", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    await openSettings("c1");
    expect(gradeSelect().value).toBe("6");
    const options = Array.from(gradeSelect().options).map((o) => o.value);
    expect(options).toEqual(["6", "7", "8"]);
  });

  test("a valid grade update succeeds", async () => {
    const calls: UpdateClassMetadataInput[] = [];
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassMetadata: async (input: UpdateClassMetadataInput) => {
        calls.push(input);
        return { classId: input.classId, alreadyUpdated: false };
      },
    });
    await flush();

    await openSettings("c1");
    gradeSelect().value = "8";
    gradeSelect().dispatchEvent(new Event("change"));
    saveButton().click();
    await settle();

    expect(calls).toEqual([{ classId: "c1", grade: "8" }]);
  });
});

describe("Block (Sprint 30A.1 Class Card Settings V1)", () => {
  test("shows the current block", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    await openSettings("c3");
    expect(blockSelect().value).toBe("E");
  });

  test("a block update succeeds", async () => {
    const calls: UpdateClassMetadataInput[] = [];
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassMetadata: async (input: UpdateClassMetadataInput) => {
        calls.push(input);
        return { classId: input.classId, alreadyUpdated: false };
      },
    });
    await flush();

    await openSettings("c1");
    blockSelect().value = "D";
    blockSelect().dispatchEvent(new Event("change"));
    saveButton().click();
    await settle();

    expect(calls).toEqual([{ classId: "c1", block: "D" }]);
  });
});

describe("Color (Sprint 30A.1 Class Card Settings V1)", () => {
  test("the curated tokens render as swatches, plus a None option", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassColor: async () => undefined,
    });
    await flush();

    await openSettings("c1");
    for (const token of ["blue", "teal", "green", "purple", "orange", "rose", "slate", "none"]) {
      expect(colorSwatch(token as ClassColorToken | "none")).not.toBeNull();
    }
  });

  test("the selected swatch is marked programmatically, not by color alone - default is None", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    await openSettings("c1");
    // Default (no saved color): None is selected, every curated token is not.
    expect(colorSwatch("none").getAttribute("aria-pressed")).toBe("true");
    expect(
      colorSwatch("none").classList.contains("shell-classes-settings-color-selected"),
    ).toBe(true);
    for (const token of ["blue", "teal", "green", "purple", "orange", "rose", "slate"]) {
      expect(colorSwatch(token as ClassColorToken).getAttribute("aria-pressed")).toBe(
        "false",
      );
      expect(
        colorSwatch(token as ClassColorToken).classList.contains(
          "shell-classes-settings-color-selected",
        ),
      ).toBe(false);
    }
  });

  test("changing selection moves the selected indicator to the newly clicked swatch", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassColor: async () => undefined,
    });
    await flush();

    await openSettings("c1");
    colorSwatch("blue").click();
    expect(colorSwatch("blue").getAttribute("aria-pressed")).toBe("true");
    expect(colorSwatch("none").getAttribute("aria-pressed")).toBe("false");

    colorSwatch("rose").click();
    expect(colorSwatch("rose").getAttribute("aria-pressed")).toBe("true");
    expect(colorSwatch("blue").getAttribute("aria-pressed")).toBe("false");
    expect(
      colorSwatch("blue").classList.contains("shell-classes-settings-color-selected"),
    ).toBe(false);
  });

  test("selecting None from a previously-colored state clears the prior selection just as unmistakably", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      readClassColors: async () => ({ c1: "purple" }),
      updateClassColor: async () => undefined,
    });
    await settle();

    await openSettings("c1");
    expect(colorSwatch("purple").getAttribute("aria-pressed")).toBe("true");

    colorSwatch("none").click();
    expect(colorSwatch("none").getAttribute("aria-pressed")).toBe("true");
    expect(
      colorSwatch("none").classList.contains("shell-classes-settings-color-selected"),
    ).toBe(true);
    expect(colorSwatch("purple").getAttribute("aria-pressed")).toBe("false");
    expect(
      colorSwatch("purple").classList.contains("shell-classes-settings-color-selected"),
    ).toBe(false);
  });

  test("accessible names use the mapped palette labels, not raw tokens", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, { listClasses: listFour });
    await flush();

    await openSettings("c1");
    expect(colorSwatch("none").getAttribute("aria-label")).toBe("Color: None");
    expect(colorSwatch("teal").getAttribute("aria-label")).toBe("Color: Teal");
    expect(colorSwatch("rose").getAttribute("aria-label")).toBe("Color: Rose");
    // No visible color-name text is rendered anywhere in the picker.
    const picker = document.querySelector<HTMLElement>(
      ".shell-classes-settings-color-picker",
    )!;
    expect(picker.textContent).toBe("");
  });

  test("every swatch remains a focusable, keyboard-reachable button", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassColor: async () => undefined,
    });
    await flush();

    await openSettings("c1");
    for (const token of ["none", "blue", "teal", "green", "purple", "orange", "rose", "slate"]) {
      const swatch = colorSwatch(token as ClassColorToken | "none");
      expect(swatch.tagName).toBe("BUTTON");
      swatch.focus();
      expect(document.activeElement).toBe(swatch);
    }
  });

  test("selecting a color and saving persists it through updateClassColor", async () => {
    const calls: Array<{ classId: string; color: ClassColorToken | "none" }> = [];
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassColor: async (classId, color) => {
        calls.push({ classId, color });
      },
    });
    await flush();

    await openSettings("c1");
    colorSwatch("teal").click();
    saveButton().click();
    await settle();

    expect(calls).toEqual([{ classId: "c1", color: "teal" }]);
  });

  test("with no saved color, the card keeps neutral styling (no data-class-color attribute)", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      readClassColors: async () => ({}),
    });
    await flush();

    const card = document.querySelector<HTMLElement>("[data-testid=class-card-c1]")!;
    expect(card.hasAttribute("data-class-color")).toBe(false);
  });

  test("a saved color produces a subtle card accent (data-class-color attribute)", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      readClassColors: async () => ({ c1: "rose" }),
    });
    await settle();

    const card = document.querySelector<HTMLElement>("[data-testid=class-card-c1]")!;
    expect(card.getAttribute("data-class-color")).toBe("rose");
  });

  test("choosing None clears a previously-saved color", async () => {
    const calls: Array<{ classId: string; color: ClassColorToken | "none" }> = [];
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      readClassColors: async () => ({ c1: "blue" }),
      updateClassColor: async (classId, color) => {
        calls.push({ classId, color });
      },
    });
    await settle();

    await openSettings("c1");
    colorSwatch("none").click();
    saveButton().click();
    await settle();

    expect(calls).toEqual([{ classId: "c1", color: "none" }]);
  });
});

describe("Canonical order preservation (Sprint 30A.1 Class Card Settings V1)", () => {
  test("saving settings for one class never changes canonical card order", async () => {
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassMetadata: async (input: UpdateClassMetadataInput) => ({
        classId: input.classId,
        alreadyUpdated: false,
      }),
      updateClassColor: async () => undefined,
    });
    await flush();

    const before = domOrder();
    await openSettings("c3");
    titleInput().value = "Renamed";
    titleInput().dispatchEvent(new Event("input"));
    gradeSelect().value = "8";
    gradeSelect().dispatchEvent(new Event("change"));
    colorSwatch("purple").click();
    saveButton().click();
    await settle();

    expect(domOrder()).toEqual(before);
    // c3 (renamed) stays in its original position, third.
    expect(domOrder()[2]).toBe("c3");
  });

  test("no updateClassOrder call is made as a side effect of a settings save", async () => {
    let orderCalls = 0;
    const mount = mkMount();
    renderClassesSurface(mount, teacher, {
      listClasses: listFour,
      updateClassOrder: async () => {
        orderCalls += 1;
      },
      updateClassMetadata: async (input: UpdateClassMetadataInput) => ({
        classId: input.classId,
        alreadyUpdated: false,
      }),
    });
    await flush();

    await openSettings("c1");
    titleInput().value = "Renamed";
    titleInput().dispatchEvent(new Event("input"));
    saveButton().click();
    await settle();

    expect(orderCalls).toBe(0);
  });
});
