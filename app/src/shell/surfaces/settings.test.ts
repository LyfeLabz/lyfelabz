/**
 * @jest-environment jsdom
 */
import { renderSettingsSurface } from "./settings";
import type { Session } from "../../session/types";
import type { TeacherDefaultGrade } from "../../teacherPreferences";

// Sprint 24B Phase 2B.2 - Settings surface: default-grade preference row.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

const teacher: ActiveTeacher = Object.freeze({
  kind: "activeTeacher",
  uid: "teacher-1",
  schoolId: "school-1",
  displayName: "Ms. Teacher",
});

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("Settings default-grade preference row", () => {
  test("renders the row with the current preference selected", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, {
      integrations: null,
      defaultGrade: "8",
      updateDefaultGrade: async () => undefined,
    });
    const select = mount.querySelector<HTMLSelectElement>(
      "[data-testid=settings-default-grade-select]",
    )!;
    expect(select).not.toBeNull();
    expect(select.value).toBe("8");
  });

  test("renders 'No default' when no preference is stored", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, {
      integrations: null,
      defaultGrade: null,
      updateDefaultGrade: async () => undefined,
    });
    const select = mount.querySelector<HTMLSelectElement>(
      "[data-testid=settings-default-grade-select]",
    )!;
    expect(select.value).toBe("");
  });

  test("invokes the update callable when the teacher picks a grade", async () => {
    const mount = mkMount();
    const calls: Array<TeacherDefaultGrade | null> = [];
    renderSettingsSurface(mount, teacher, {
      integrations: null,
      defaultGrade: null,
      updateDefaultGrade: async (next) => {
        calls.push(next);
      },
    });
    const select = mount.querySelector<HTMLSelectElement>(
      "[data-testid=settings-default-grade-select]",
    )!;
    select.value = "6";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    await flush();
    expect(calls).toEqual(["6"]);
    const status = mount.querySelector(
      "[data-testid=settings-default-grade-status]",
    )!;
    expect(status.textContent).toBe("Saved");
  });

  test("clears the preference when the teacher selects 'No default'", async () => {
    const mount = mkMount();
    const calls: Array<TeacherDefaultGrade | null> = [];
    renderSettingsSurface(mount, teacher, {
      integrations: null,
      defaultGrade: "7",
      updateDefaultGrade: async (next) => {
        calls.push(next);
      },
    });
    const select = mount.querySelector<HTMLSelectElement>(
      "[data-testid=settings-default-grade-select]",
    )!;
    select.value = "";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    await flush();
    expect(calls).toEqual([null]);
    const status = mount.querySelector(
      "[data-testid=settings-default-grade-status]",
    )!;
    expect(status.textContent).toBe("Cleared");
  });

  test("shows an error status when the update rejects and restores the prior value", async () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, {
      integrations: null,
      defaultGrade: "7",
      updateDefaultGrade: async () => {
        throw new Error("nope");
      },
    });
    const select = mount.querySelector<HTMLSelectElement>(
      "[data-testid=settings-default-grade-select]",
    )!;
    select.value = "6";
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    await flush();
    const status = mount.querySelector(
      "[data-testid=settings-default-grade-status]",
    )!;
    expect(status.textContent).toBe("Could not save. Try again.");
    expect(select.value).toBe("7");
  });

  test("does not render a default-block control", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, {
      integrations: null,
      defaultGrade: null,
      updateDefaultGrade: async () => undefined,
    });
    expect(
      mount.querySelector("[data-testid=settings-default-block-select]"),
    ).toBeNull();
  });

  test("disables the control when no update seam is injected", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher, {
      integrations: null,
      defaultGrade: "7",
    });
    const select = mount.querySelector<HTMLSelectElement>(
      "[data-testid=settings-default-grade-select]",
    )!;
    expect(select.disabled).toBe(true);
  });
});
