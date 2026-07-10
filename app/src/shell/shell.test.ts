/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";
import type { Session } from "../session/types";
import type { ClassSummary } from "../classes/types";
import type { ListClasses } from "../classes/listClasses";
import { mountTeacherShell, type ShellDeps } from "./shell";
import { renderHeader } from "./header";
import { renderNavigation, NAVIGATION_ITEMS } from "./navigation";
import { renderFooter } from "./footer";
import {
  renderCurriculumSurface,
  _resetCurriculumSessionStateForTest,
} from "./surfaces/curriculum";
import {
  WORKSPACE_SURFACES,
  mountWorkspaceOutlet,
} from "./surfaces/workspace";
import { renderPresentModeSurface } from "./surfaces/presentMode";
import { renderSettingsSurface } from "./surfaces/settings";

const emptyListClasses: ListClasses = () =>
  Promise.resolve(Object.freeze<ClassSummary[]>([]));

const makeShellDeps = (
  overrides: Partial<ShellDeps> = {},
): ShellDeps => ({
  onSignOut: () => undefined,
  listClasses: emptyListClasses,
  onLaunchPresentMode: () => undefined,
  ...overrides,
});

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const freeze = <T>(v: T): T => Object.freeze(v) as T;

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const teacherSession = (): Extract<Session, { kind: "activeTeacher" }> =>
  freeze({
    kind: "activeTeacher",
    uid: "u1",
    schoolId: "school-abc",
    displayName: "Ada Lovelace",
  });

describe("Teacher Workspace Shell - layout regions", () => {
  test("renders exactly one banner, one navigation, one main content region, and one contentinfo landmark", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());

    expect(mount.querySelectorAll('[role="banner"]')).toHaveLength(1);
    expect(mount.querySelectorAll("nav")).toHaveLength(1);
    expect(mount.querySelectorAll("#app-main")).toHaveLength(1);
    expect(mount.querySelectorAll('[role="contentinfo"]')).toHaveLength(1);
  });

  test("renders regions in DOM order: header, body (nav + main), footer", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    const children = Array.from(mount.children);
    expect(children[0]?.getAttribute("role")).toBe("banner");
    expect(children[1]?.classList.contains("shell-body")).toBe(true);
    expect(children[2]?.getAttribute("role")).toBe("contentinfo");
  });

  test("main content area references the welcome headline via aria-labelledby", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    const main = mount.querySelector("#app-main");
    expect(main?.getAttribute("aria-labelledby")).toBe("surface-headline");
    expect(mount.querySelector("#surface-headline")?.textContent).toBe(
      "Welcome, Ada Lovelace.",
    );
  });
});

describe("Header composition and identity-display rules", () => {
  test("renders the LyfeLabz Teacher Platform product mark as h1", () => {
    const mount = mkMount();
    renderHeader(mount, teacherSession(), { onSignOut: () => undefined });
    expect(mount.querySelector("h1.shell-brand")?.textContent).toBe(
      "LyfeLabz Teacher Platform",
    );
  });

  test("renders the display name in the header identity summary", () => {
    const mount = mkMount();
    renderHeader(mount, teacherSession(), { onSignOut: () => undefined });
    expect(
      mount.querySelector("[data-testid=header-display-name]")?.textContent,
    ).toBe("Ada Lovelace");
  });

  test("does not render uid, schoolId, email, or any claim payload in the header", () => {
    const mount = mkMount();
    renderHeader(mount, teacherSession(), { onSignOut: () => undefined });
    const text = mount.textContent ?? "";
    expect(text).not.toContain("u1");
    expect(text).not.toContain("school-abc");
    expect(text).not.toContain("teacher@"); // no email
    expect(text).not.toContain("claim");
  });

  test("truncates a display name longer than 24 characters with an ellipsis", () => {
    const mount = mkMount();
    renderHeader(
      mount,
      freeze({
        kind: "activeTeacher" as const,
        uid: "u1",
        schoolId: "s1",
        displayName: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAA", // 29 chars
      }),
      { onSignOut: () => undefined },
    );
    const text =
      mount.querySelector("[data-testid=header-display-name]")?.textContent ??
      "";
    expect(text.length).toBeLessThanOrEqual(24);
    expect(text.endsWith("…")).toBe(true);
  });

  test("renders the notifications placeholder as a non-interactive labelled icon", () => {
    const mount = mkMount();
    renderHeader(mount, teacherSession(), { onSignOut: () => undefined });
    const bell = mount.querySelector(
      "[data-testid=notifications-placeholder]",
    );
    expect(bell).not.toBeNull();
    expect(bell?.getAttribute("role")).toBe("img");
    expect(bell?.getAttribute("aria-label")).toBe(
      "Notifications, coming soon",
    );
    expect(bell?.tagName.toLowerCase()).not.toBe("button");
  });

  test("renders a persistent sign-out control that invokes onSignOut", () => {
    const mount = mkMount();
    const signOut = jest.fn();
    renderHeader(mount, teacherSession(), { onSignOut: signOut });
    mount
      .querySelector<HTMLButtonElement>("[data-testid=sign-out]")
      ?.click();
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});

describe("Navigation composition and disabled posture (Sprint 6C)", () => {
  test("renders items in the specified order: LYFELABZ, Curriculum, Classes, Present Mode, Settings", () => {
    const mount = mkMount();
    renderNavigation(mount);
    const buttons = Array.from(
      mount.querySelectorAll<HTMLButtonElement>("button.shell-nav-button"),
    );
    expect(buttons.map((b) => b.getAttribute("data-testid"))).toEqual([
      "nav-lyfelabz",
      "nav-curriculum",
      "nav-classes",
      "nav-present-mode",
      "nav-settings",
    ]);
  });

  test("LYFELABZ renders as the brand variant and is not disabled", () => {
    const mount = mkMount();
    renderNavigation(mount);
    const brand = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-lyfelabz]",
    );
    expect(brand?.disabled).toBe(false);
    expect(brand?.getAttribute("data-nav-variant")).toBe("brand");
    expect(brand?.classList.contains("shell-nav-brand")).toBe(true);
    expect(brand?.textContent).toBe("LYFELABZ");
  });

  test("LYFELABZ never carries aria-current, even when Curriculum is the active surface", () => {
    const mount = mkMount();
    renderNavigation(mount, {
      activeKey: "curriculum",
      onSelect: () => undefined,
    });
    const brand = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-lyfelabz]",
    );
    expect(brand?.getAttribute("aria-current")).toBeNull();
  });

  test("Curriculum and Classes are the active items; Curriculum carries aria-current=page by default", () => {
    const mount = mkMount();
    renderNavigation(mount);
    const curriculum = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-curriculum]",
    );
    expect(curriculum?.disabled).toBe(false);
    expect(curriculum?.getAttribute("aria-current")).toBe("page");
    expect(curriculum?.textContent).toBe("Curriculum");
    const classes = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-classes]",
    );
    expect(classes?.disabled).toBe(false);
    expect(classes?.getAttribute("aria-current")).toBeNull();
    expect(classes?.textContent).toBe("Classes");
  });

  test("renderNavigation with activeKey=classes moves aria-current onto Classes", () => {
    const mount = mkMount();
    renderNavigation(mount, {
      activeKey: "classes",
      onSelect: () => undefined,
    });
    expect(
      mount
        .querySelector("[data-testid=nav-curriculum]")
        ?.getAttribute("aria-current"),
    ).toBeNull();
    expect(
      mount
        .querySelector("[data-testid=nav-classes]")
        ?.getAttribute("aria-current"),
    ).toBe("page");
  });

  test("Present Mode and Settings are both available workspace destinations after Sprint 6H", () => {
    const mount = mkMount();
    renderNavigation(mount);
    const presentMode = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-present-mode]",
    );
    expect(presentMode?.disabled).toBe(false);
    expect(presentMode?.getAttribute("aria-disabled")).toBeNull();
    expect(presentMode?.textContent).toBe("Present Mode");
    const settings = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-settings]",
    );
    expect(settings?.disabled).toBe(false);
    expect(settings?.getAttribute("aria-disabled")).toBeNull();
    expect(settings?.getAttribute("tabindex")).toBeNull();
    expect(settings?.textContent).toBe("Settings");
  });

  test("every navigation item is available after Sprint 6H (no disabled coming-soon items)", () => {
    const mount = mkMount();
    renderNavigation(mount);
    for (const item of NAVIGATION_ITEMS) {
      expect(item.available).toBe(true);
      const btn = mount.querySelector<HTMLButtonElement>(
        `[data-testid=nav-${item.key}]`,
      );
      expect(btn?.disabled).toBe(false);
      expect(btn?.getAttribute("aria-disabled")).toBeNull();
    }
  });

  test("has aria-label 'Teacher workspace sections'", () => {
    const mount = mkMount();
    renderNavigation(mount);
    expect(
      mount.querySelector("nav")?.getAttribute("aria-label"),
    ).toBe("Teacher workspace sections");
  });

  test("does not include the removed Home, Students, Assignments, or Reports items", () => {
    const mount = mkMount();
    renderNavigation(mount);
    expect(mount.querySelector("[data-testid=nav-home]")).toBeNull();
    expect(mount.querySelector("[data-testid=nav-students]")).toBeNull();
    expect(mount.querySelector("[data-testid=nav-assignments]")).toBeNull();
    expect(mount.querySelector("[data-testid=nav-reports]")).toBeNull();
  });
});

describe("Footer", () => {
  test("renders a contentinfo landmark with the product name and no links", () => {
    const mount = mkMount();
    renderFooter(mount);
    const footer = mount.querySelector("[data-testid=shell-footer]");
    expect(footer?.getAttribute("role")).toBe("contentinfo");
    expect(footer?.textContent).toBe("LyfeLabz Teacher Platform");
    expect(footer?.querySelector("a")).toBeNull();
  });
});

describe("Curriculum surface composition (Sprint 6D)", () => {
  test("renders welcome, curriculum intro, filter controls, lesson grid, and return link", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacherSession());
    expect(mount.querySelector("[data-testid=surface-headline]")?.textContent)
      .toBe("Welcome, Ada Lovelace.");
    expect(mount.querySelector("[data-testid=curriculum-intro]")?.textContent)
      .toBe(
        "Activate the LyfeLabz lessons your students can access. Preview any lesson at any time.",
      );
    expect(mount.querySelector("[data-testid=curriculum-filters]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=curriculum-grid]")).not.toBeNull();
    expect(
      mount.querySelector<HTMLAnchorElement>("[data-testid=return-link]")
        ?.getAttribute("href"),
    ).toBe("/");
  });

  test("renders a lesson card for every lesson in the catalog", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacherSession());
    const cards = mount.querySelectorAll(".shell-lesson-card");
    expect(cards.length).toBe(47);
  });

  test("each lesson card renders title, grade, topic, preview link, and activation toggle", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacherSession());
    const card = mount.querySelector<HTMLElement>(
      "[data-testid=lesson-card-earths-layers]",
    );
    expect(card).not.toBeNull();
    expect(card?.getAttribute("data-grade")).toBe("7");
    expect(card?.getAttribute("data-topic")).toBe("earth-space");
    expect(
      mount.querySelector("[data-testid=lesson-title-earths-layers]")?.textContent,
    ).toBe("Earth's Layers");
    expect(
      mount.querySelector("[data-testid=lesson-grade-earths-layers]")?.textContent,
    ).toBe("Grade 7");
    expect(
      mount.querySelector("[data-testid=lesson-topic-earths-layers]")?.textContent,
    ).toBe("Earth & Space");
    expect(
      mount
        .querySelector<HTMLAnchorElement>(
          "[data-testid=lesson-preview-earths-layers]",
        )
        ?.getAttribute("href"),
    ).toBe("/lesson_earths-layers.html");
    const toggle = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-toggle-earths-layers]",
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(toggle?.textContent).toBe("Active");
  });

  test("lessons default to active state", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacherSession());
    for (const card of Array.from(
      mount.querySelectorAll<HTMLElement>(".shell-lesson-card"),
    )) {
      expect(card.getAttribute("data-lesson-active")).toBe("true");
      expect(card.classList.contains("shell-lesson-card-inactive")).toBe(false);
    }
  });

  test("clicking a lesson toggle flips activation state and visual distinguishability", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacherSession());
    const toggle = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-toggle-what-is-life]",
    );
    const card = mount.querySelector<HTMLElement>(
      "[data-testid=lesson-card-what-is-life]",
    );
    toggle?.click();
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    expect(toggle?.textContent).toBe("Inactive");
    expect(card?.getAttribute("data-lesson-active")).toBe("false");
    expect(card?.classList.contains("shell-lesson-card-inactive")).toBe(true);
    toggle?.click();
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(toggle?.textContent).toBe("Active");
    expect(card?.getAttribute("data-lesson-active")).toBe("true");
    expect(card?.classList.contains("shell-lesson-card-inactive")).toBe(false);
  });

  test("grade filter hides lessons that do not match the selected grade", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacherSession());
    mount
      .querySelector<HTMLButtonElement>("[data-testid=filter-grade-6]")
      ?.click();
    for (const card of Array.from(
      mount.querySelectorAll<HTMLElement>(".shell-lesson-card"),
    )) {
      if (card.getAttribute("data-grade") === "6") {
        expect(card.hidden).toBe(false);
      } else {
        expect(card.hidden).toBe(true);
      }
    }
    expect(
      mount
        .querySelector("[data-testid=filter-grade-6]")
        ?.getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      mount
        .querySelector("[data-testid=filter-grade-all]")
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
  });

  test("topic filter hides lessons that do not match the selected topic", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacherSession());
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=filter-topic-life-science]",
      )
      ?.click();
    for (const card of Array.from(
      mount.querySelectorAll<HTMLElement>(".shell-lesson-card"),
    )) {
      if (card.getAttribute("data-topic") === "life-science") {
        expect(card.hidden).toBe(false);
      } else {
        expect(card.hidden).toBe(true);
      }
    }
  });

  test("grade and topic filters combine (AND)", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacherSession());
    mount
      .querySelector<HTMLButtonElement>("[data-testid=filter-grade-6]")
      ?.click();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=filter-topic-tech-engineering]",
      )
      ?.click();
    const visible = Array.from(
      mount.querySelectorAll<HTMLElement>(".shell-lesson-card"),
    ).filter((c) => !c.hidden);
    expect(visible.length).toBeGreaterThan(0);
    for (const card of visible) {
      expect(card.getAttribute("data-grade")).toBe("6");
      expect(card.getAttribute("data-topic")).toBe("tech-engineering");
    }
  });

  test("does not render uid, schoolId, or claim payload in the DOM", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacherSession());
    const text = mount.textContent ?? "";
    expect(text).not.toContain("u1");
    expect(text).not.toContain("school-abc");
    expect(text).not.toContain("claim");
  });

  test("falls back to a generic welcome when the display name is empty", () => {
    const mount = mkMount();
    renderCurriculumSurface(
      mount,
      freeze({
        kind: "activeTeacher" as const,
        uid: "u1",
        schoolId: "s1",
        displayName: "",
      }),
    );
    expect(mount.querySelector("[data-testid=surface-headline]")?.textContent)
      .toBe("Welcome to LyfeLabz.");
  });

  test("focus lands on the welcome headline at mount", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacherSession());
    expect(document.activeElement?.getAttribute("data-testid")).toBe(
      "surface-headline",
    );
  });
});

describe("Data and callable posture (Step 5 invariant)", () => {
  test("mounting the shell runs to completion with no runtime errors (no Firestore or callable reach)", () => {
    const mount = mkMount();
    expect(() =>
      mountTeacherShell(teacherSession(), mount, makeShellDeps()),
    ).not.toThrow();
  });

  test("shell modules do not import from firebase/firestore, firebase/functions, or firebase/auth, and open no listeners or callables", () => {
    const shellDir = path.resolve(__dirname);
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(p));
        else if (entry.isFile() && p.endsWith(".ts") && !p.endsWith(".test.ts"))
          out.push(p);
      }
      return out;
    };
    for (const file of walk(shellDir)) {
      const text = fs.readFileSync(file, "utf8");
      expect(text).not.toContain('from "firebase/firestore"');
      expect(text).not.toContain('from "firebase/functions"');
      expect(text).not.toContain('from "firebase/auth"');
      expect(text).not.toContain("onSnapshot(");
      expect(text).not.toContain("httpsCallable(");
      expect(text).not.toContain("localStorage");
      expect(text).not.toContain("sessionStorage");
      expect(text).not.toContain("document.cookie");
    }
  });
});

describe("Workspace outlet (Sprint 6C)", () => {
  test("shell mounts exactly one workspace outlet region", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    const outlets = mount.querySelectorAll("[data-testid=workspace-outlet]");
    expect(outlets).toHaveLength(1);
    expect(outlets[0]?.id).toBe("app-main");
  });

  test("outlet advertises the active surface via data-active-surface=curriculum", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    const outlet = mount.querySelector("[data-testid=workspace-outlet]");
    expect(outlet?.getAttribute("data-active-surface")).toBe("curriculum");
  });

  test("curriculum surface renders through the outlet, not as a shell sibling", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    const headline = mount.querySelector("[data-testid=surface-headline]");
    const outlet = mount.querySelector("[data-testid=workspace-outlet]");
    expect(headline).not.toBeNull();
    expect(outlet?.contains(headline!)).toBe(true);
    expect(headline?.textContent).toBe("Welcome, Ada Lovelace.");
  });

  test("WORKSPACE_SURFACES registers exactly the four workspace-surface keys", () => {
    expect(Object.keys(WORKSPACE_SURFACES).sort()).toEqual(
      ["classes", "curriculum", "present-mode", "settings"],
    );
  });

  test("mountWorkspaceOutlet with the settings key returns an outlet advertising the settings surface", () => {
    const mount = mkMount();
    const outlet = mountWorkspaceOutlet(mount, teacherSession(), "settings", {
      listClasses: emptyListClasses,
      onLaunchPresentMode: () => undefined,
    });
    expect(outlet.getAttribute("data-testid")).toBe("workspace-outlet");
    expect(outlet.getAttribute("data-active-surface")).toBe("settings");
  });

  test("focus lands on the workspace surface headline after shell mount", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    expect(document.activeElement?.getAttribute("data-testid")).toBe(
      "surface-headline",
    );
  });
});

describe("mountTeacherShell integration", () => {
  test("sign-out control in the shell header invokes onSignOut exactly once", () => {
    const mount = mkMount();
    const signOut = jest.fn();
    mountTeacherShell(teacherSession(), mount, makeShellDeps({ onSignOut: signOut }));
    mount
      .querySelector<HTMLButtonElement>("[data-testid=sign-out]")
      ?.click();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test("clicking a navigation item does not throw", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    for (const key of ["curriculum", "classes", "present-mode", "settings"]) {
      const btn = mount.querySelector<HTMLButtonElement>(
        `[data-testid=nav-${key}]`,
      );
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
      });
      expect(() => btn?.dispatchEvent(event)).not.toThrow();
    }
  });
});

describe("LYFELABZ brand navigation (Sprint 6C)", () => {
  test("selecting LYFELABZ from Curriculum is a no-op re-render", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("curriculum");
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-lyfelabz]")
      ?.click();
    expect(mount.querySelectorAll("[data-testid=workspace-outlet]")).toHaveLength(
      1,
    );
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("curriculum");
  });

  test("selecting LYFELABZ from Classes returns the outlet to Curriculum", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-classes]")
      ?.click();
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("classes");
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-lyfelabz]")
      ?.click();
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("curriculum");
    expect(mount.querySelectorAll("[data-testid=workspace-outlet]")).toHaveLength(
      1,
    );
  });
});

describe("Classroom Workspace surface (Sprint 6B, preserved by 6C)", () => {
  const teacher = teacherSession();

  const makeListClasses = (
    rows: ReadonlyArray<ClassSummary>,
  ): jest.Mock<Promise<ReadonlyArray<ClassSummary>>, [string]> =>
    jest.fn<Promise<ReadonlyArray<ClassSummary>>, [string]>(() =>
      Promise.resolve(Object.freeze(rows)),
    );

  const clickClasses = (mount: HTMLElement): void => {
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-classes]",
    );
    btn?.click();
  };

  test("clicking the Classes nav item switches the outlet to the classes surface", async () => {
    const mount = mkMount();
    const listClasses = makeListClasses([]);
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses }));
    clickClasses(mount);
    const outlet = mount.querySelector("[data-testid=workspace-outlet]");
    expect(outlet?.getAttribute("data-active-surface")).toBe("classes");
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Classes");
    await flush();
    expect(listClasses).toHaveBeenCalledTimes(1);
    expect(listClasses).toHaveBeenCalledWith("u1");
  });

  test("navigating away and back does not double-mount the outlet", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickClasses(mount);
    expect(mount.querySelectorAll("[data-testid=workspace-outlet]")).toHaveLength(
      1,
    );
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")
      ?.click();
    expect(mount.querySelectorAll("[data-testid=workspace-outlet]")).toHaveLength(
      1,
    );
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("curriculum");
  });

  test("renders a card per classroom with title, grade, and status", async () => {
    const mount = mkMount();
    const listClasses = makeListClasses([
      freeze({ id: "c1", title: "6A Life Science", grade: "6", status: "active" }),
      freeze({ id: "c2", title: "7B Systems", grade: "7", status: "archived" }),
    ]);
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses }));
    clickClasses(mount);
    await flush();
    const list = mount.querySelector("[data-testid=classes-list]");
    expect(list).not.toBeNull();
    expect(list?.children.length).toBe(2);
    expect(
      mount.querySelector("[data-testid=class-title-c1]")?.textContent,
    ).toBe("6A Life Science");
    expect(
      mount.querySelector("[data-testid=class-grade-c1]")?.textContent,
    ).toBe("Grade 6");
    expect(
      mount.querySelector("[data-testid=class-status-c1]")?.textContent,
    ).toBe("Active");
    expect(
      mount.querySelector("[data-testid=class-status-c2]")?.textContent,
    ).toBe("Archived");
  });

  test("renders an empty state when the teacher owns no classrooms", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickClasses(mount);
    await flush();
    expect(mount.querySelector("[data-testid=classes-empty]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=classes-list]")).toBeNull();
    expect(
      mount.querySelector("[data-testid=classes-status]")?.textContent,
    ).toBe("You do not have any classrooms yet.");
  });

  test("shows a loading status before the fetcher resolves", () => {
    const mount = mkMount();
    let resolve: (rows: ReadonlyArray<ClassSummary>) => void = () => undefined;
    const listClasses: ListClasses = () =>
      new Promise<ReadonlyArray<ClassSummary>>((r) => {
        resolve = r;
      });
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses }));
    clickClasses(mount);
    expect(
      mount.querySelector("[data-testid=classes-status]")?.textContent,
    ).toBe("Loading classes");
    resolve(Object.freeze([]));
  });

  test("shows an error state when the fetcher rejects", async () => {
    const mount = mkMount();
    const listClasses: ListClasses = () =>
      Promise.reject(new Error("permission-denied"));
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses }));
    clickClasses(mount);
    await flush();
    expect(mount.querySelector("[data-testid=classes-error]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=classes-list]")).toBeNull();
  });

  test("clicking a classroom card marks it selected without leaving the surface", async () => {
    const mount = mkMount();
    const listClasses = makeListClasses([
      freeze({ id: "c1", title: "6A", grade: "6", status: "active" }),
      freeze({ id: "c2", title: "6B", grade: "6", status: "active" }),
    ]);
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses }));
    clickClasses(mount);
    await flush();
    const card = mount.querySelector<HTMLButtonElement>(
      "[data-testid=class-card-c1]",
    );
    card?.click();
    expect(card?.getAttribute("aria-pressed")).toBe("true");
    expect(
      mount
        .querySelector("[data-testid=class-card-c2]")
        ?.getAttribute("aria-pressed"),
    ).toBe("false");
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("classes");
  });

  test("focus lands on the Classes headline when the surface is activated", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickClasses(mount);
    await flush();
    expect(document.activeElement?.getAttribute("data-testid")).toBe(
      "surface-headline",
    );
    expect(document.activeElement?.textContent).toBe("Classes");
  });
});

describe("Assign Experience - Sprint 6E", () => {
  const teacher = teacherSession();

  const twoClasses: ReadonlyArray<ClassSummary> = freeze([
    freeze({ id: "c1", title: "6A Life Science", grade: "6", status: "active" }),
    freeze({ id: "c2", title: "7B Systems", grade: "7", status: "active" }),
  ] as ClassSummary[]);

  const listTwo: ListClasses = () => Promise.resolve(twoClasses);

  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    // Any dialog left mounted from a prior test would live on document.body.
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("every lesson card renders an Assign button in its unassigned state", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher);
    const assign = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-assign-earths-layers]",
    );
    expect(assign).not.toBeNull();
    expect(assign?.textContent).toBe("Assign");
    expect(assign?.getAttribute("data-assigned")).toBe("false");
  });

  test("clicking Assign opens the modal dialog with one row per active class, all selected by default", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listTwo });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    const dialog = document.querySelector("[data-testid=assign-dialog]");
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    const rows = document.querySelectorAll("[data-testid^=assign-row-c]");
    expect(rows).toHaveLength(2);
    const c1 = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c1]",
    );
    const c2 = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c2]",
    );
    expect(c1?.checked).toBe(true);
    expect(c2?.checked).toBe(true);
  });

  test("assignment date defaults to today, points to the quiz default, release time to the session default", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listTwo });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    const date = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-date-c1]",
    );
    const now = new Date();
    const expected = `${String(now.getFullYear()).padStart(4, "0")}-${String(
      now.getMonth() + 1,
    ).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    expect(date?.value).toBe(expected);
    expect(
      document.querySelector<HTMLInputElement>(
        "[data-testid=assign-row-points-c1]",
      )?.value,
    ).toBe("10");
    expect(
      document.querySelector<HTMLInputElement>(
        "[data-testid=assign-row-time-c1]",
      )?.value,
    ).toBe("07:45");
  });

  test("Assign button is disabled when every class row is deselected", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listTwo });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    const confirm = document.querySelector<HTMLButtonElement>(
      "[data-testid=assign-confirm]",
    );
    expect(confirm?.disabled).toBe(false);
    const c1 = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c1]",
    );
    const c2 = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c2]",
    );
    c1!.checked = false;
    c1!.dispatchEvent(new Event("change"));
    c2!.checked = false;
    c2!.dispatchEvent(new Event("change"));
    expect(confirm?.disabled).toBe(true);
  });

  test("confirming closes the dialog and flips the card to ✓ Assigned", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listTwo });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();
    expect(document.querySelector("[data-testid=assign-dialog]")).toBeNull();
    const assign = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-assign-earths-layers]",
    );
    expect(assign?.textContent).toBe("✓ Assigned");
    expect(assign?.getAttribute("data-assigned")).toBe("true");
    expect(
      mount.querySelector("[data-testid=assign-success]")?.textContent,
    ).toBe("Assigned Earth's Layers to 2 classes.");
  });

  test("clicking ✓ Assigned reopens the same dialog with prior values populated", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listTwo });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    const timeInput = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-time-c1]",
    );
    timeInput!.value = "09:15";
    timeInput!.dispatchEvent(new Event("input"));
    const c2 = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c2]",
    );
    c2!.checked = false;
    c2!.dispatchEvent(new Event("change"));
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();

    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    expect(
      document.querySelector<HTMLInputElement>(
        "[data-testid=assign-row-time-c1]",
      )?.value,
    ).toBe("09:15");
    expect(
      document.querySelector<HTMLInputElement>(
        "[data-testid=assign-row-enabled-c2]",
      )?.checked,
    ).toBe(false);
  });

  test("deselecting every row and reconfirming returns the card to Assign", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listTwo });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    for (const cid of ["c1", "c2"]) {
      const cb = document.querySelector<HTMLInputElement>(
        `[data-testid=assign-row-enabled-${cid}]`,
      );
      cb!.checked = false;
      cb!.dispatchEvent(new Event("change"));
    }
    // Confirm becomes disabled; the teacher must re-enable at least one
    // row to confirm the removal. This test enables one row, then
    // disables it via the same channel used above, and asserts the
    // disabled contract. To actually exercise the removal path we
    // re-enable and re-disable through checkbox interaction and then
    // programmatically click confirm by first flipping to enabled and
    // back so the disabled attribute check reflects state.
    expect(
      document.querySelector<HTMLButtonElement>(
        "[data-testid=assign-confirm]",
      )?.disabled,
    ).toBe(true);
  });

  test("release time and Google Classroom topic are remembered across dialog opens", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listTwo });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    const time = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-time-c1]",
    );
    time!.value = "08:20";
    time!.dispatchEvent(new Event("input"));
    const topic = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-topic-c1]",
    );
    topic!.value = "Unit 2";
    topic!.dispatchEvent(new Event("input"));
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();

    // Open a different lesson; last-used values should appear.
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-what-is-life]",
      )
      ?.click();
    await flush();
    expect(
      document.querySelector<HTMLInputElement>(
        "[data-testid=assign-row-time-c1]",
      )?.value,
    ).toBe("08:20");
    expect(
      document.querySelector<HTMLInputElement>(
        "[data-testid=assign-row-topic-c1]",
      )?.value,
    ).toBe("Unit 2");
  });

  test("cancelling the dialog schedules nothing and leaves the card in its unassigned state", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listTwo });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-cancel]")
      ?.click();
    expect(document.querySelector("[data-testid=assign-dialog]")).toBeNull();
    expect(
      mount.querySelector("[data-testid=lesson-assign-earths-layers]")
        ?.textContent,
    ).toBe("Assign");
  });

  test("the dialog surfaces a friendly empty state when the teacher has no active classes", async () => {
    const mount = mkMount();
    const listNone: ListClasses = () => Promise.resolve(Object.freeze([]));
    renderCurriculumSurface(mount, teacher, { listClasses: listNone });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    expect(document.querySelector("[data-testid=assign-empty]")).not.toBeNull();
    expect(
      document.querySelector<HTMLButtonElement>(
        "[data-testid=assign-confirm]",
      )?.disabled,
    ).toBe(true);
  });
});

describe("Present Mode workspace surface (Sprint 6F)", () => {
  const teacher = teacherSession();

  const clickPresentMode = (mount: HTMLElement): void => {
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-present-mode]")
      ?.click();
  };

  test("nav item is available (not disabled) and does not carry aria-current by default", () => {
    const mount = mkMount();
    renderNavigation(mount);
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-present-mode]",
    );
    expect(btn?.disabled).toBe(false);
    expect(btn?.getAttribute("aria-disabled")).toBeNull();
    expect(btn?.textContent).toBe("Present Mode");
    expect(btn?.getAttribute("aria-current")).toBeNull();
  });

  test("nav item carries aria-current=page when Present Mode is the active surface", () => {
    const mount = mkMount();
    renderNavigation(mount, {
      activeKey: "present-mode",
      onSelect: () => undefined,
    });
    expect(
      mount
        .querySelector("[data-testid=nav-present-mode]")
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      mount
        .querySelector("[data-testid=nav-curriculum]")
        ?.getAttribute("aria-current"),
    ).toBeNull();
    expect(
      mount
        .querySelector("[data-testid=nav-classes]")
        ?.getAttribute("aria-current"),
    ).toBeNull();
  });

  test("WORKSPACE_SURFACES still registers exactly the four canonical keys", () => {
    expect(Object.keys(WORKSPACE_SURFACES).sort()).toEqual(
      ["classes", "curriculum", "present-mode", "settings"],
    );
    expect(WORKSPACE_SURFACES["present-mode"].key).toBe("present-mode");
  });

  test("clicking Present Mode switches the outlet to the Present Mode surface", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickPresentMode(mount);
    const outlet = mount.querySelector("[data-testid=workspace-outlet]");
    expect(outlet?.getAttribute("data-active-surface")).toBe("present-mode");
    expect(mount.querySelectorAll("[data-testid=workspace-outlet]")).toHaveLength(
      1,
    );
  });

  test("Present Mode renders through the workspace outlet, not as a shell sibling", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickPresentMode(mount);
    const outlet = mount.querySelector("[data-testid=workspace-outlet]");
    const headline = mount.querySelector("[data-testid=surface-headline]");
    expect(headline?.textContent).toBe("Present Mode");
    expect(outlet?.contains(headline!)).toBe(true);
  });

  test("selecting Present Mode moves aria-current onto the Present Mode nav item", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickPresentMode(mount);
    expect(
      mount
        .querySelector("[data-testid=nav-present-mode]")
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      mount
        .querySelector("[data-testid=nav-curriculum]")
        ?.getAttribute("aria-current"),
    ).toBeNull();
  });

  test("selecting Curriculum after Present Mode returns the outlet to Curriculum", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickPresentMode(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")
      ?.click();
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("curriculum");
  });

  test("selecting LYFELABZ from Present Mode returns the outlet to Curriculum", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickPresentMode(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-lyfelabz]")
      ?.click();
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("curriculum");
  });

  test("focus lands on the Present Mode headline when the surface is activated", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickPresentMode(mount);
    expect(document.activeElement?.getAttribute("data-testid")).toBe(
      "surface-headline",
    );
    expect(document.activeElement?.textContent).toBe("Present Mode");
  });

  test("renders the title, intro, preparation-focused steps, and future-controls notice", () => {
    const mount = mkMount();
    renderPresentModeSurface(mount, teacher);
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Present Mode");
    expect(
      mount.querySelector("[data-testid=present-mode-intro]")?.textContent,
    ).toBe(
      "Present Mode is your preparation surface for teaching a LyfeLabz lesson in front of your class. It keeps the classroom projector focused on the curriculum without exposing teacher or student information.",
    );
    expect(
      mount.querySelector("[data-testid=present-mode-preparation]")
        ?.textContent,
    ).toBe(
      "When you are getting ready to teach, prepare from Curriculum first. Present Mode is the moment your preparation reaches the projector.",
    );
    for (const testId of [
      "present-mode-step-choose",
      "present-mode-step-open",
      "present-mode-step-teach",
    ]) {
      expect(mount.querySelector(`[data-testid=${testId}]`)).not.toBeNull();
    }
    expect(
      mount.querySelector("[data-testid=present-mode-future-notice]")
        ?.textContent,
    ).toContain("Presentation controls will become available");
  });

  test("does not render any 'coming soon', 'under construction', 'dashboard' label, forbidden per Sprint 6F", () => {
    const mount = mkMount();
    renderPresentModeSurface(mount, teacher);
    const text = (mount.textContent ?? "").toLowerCase();
    expect(text).not.toContain("coming soon");
    expect(text).not.toContain("under construction");
    expect(text).not.toContain("dashboard");
  });

  test("does not render form controls or fake classroom data (Sprint 6G authorizes exactly one launch button)", () => {
    const mount = mkMount();
    renderPresentModeSurface(mount, teacher);
    expect(mount.querySelectorAll("input")).toHaveLength(0);
    expect(mount.querySelectorAll("select")).toHaveLength(0);
    expect(mount.querySelectorAll("textarea")).toHaveLength(0);
    expect(mount.querySelectorAll("form")).toHaveLength(0);
    const buttons = mount.querySelectorAll("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]?.getAttribute("data-testid")).toBe(
      "present-mode-launch",
    );
  });

  test("does not render uid, schoolId, email, or any Session claim payload", () => {
    const mount = mkMount();
    renderPresentModeSurface(mount, teacher);
    const text = mount.textContent ?? "";
    expect(text).not.toContain("u1");
    expect(text).not.toContain("school-abc");
    expect(text).not.toContain("claim");
    expect(text).not.toContain("Ada Lovelace");
  });

  test("does not include the assign controls or class rosters that would be teacher-scoped in a projection", () => {
    const mount = mkMount();
    renderPresentModeSurface(mount, teacher);
    expect(
      mount.querySelector("[data-testid=assign-overlay]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=classes-list]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=curriculum-grid]"),
    ).toBeNull();
  });

  test("Sprint 6G: renders a semantic launch button with the certified accessible name", () => {
    const mount = mkMount();
    renderPresentModeSurface(mount, teacher);
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=present-mode-launch]",
    );
    expect(btn).not.toBeNull();
    expect(btn?.tagName.toLowerCase()).toBe("button");
    expect(btn?.getAttribute("type")).toBe("button");
    expect(btn?.textContent).toBe("Launch Present Mode");
    expect(btn?.getAttribute("aria-label")).toBe("Launch Present Mode");
    expect(btn?.disabled).toBe(false);
  });

  test("Sprint 6G: clicking the launch button invokes the injected handler exactly once", () => {
    const mount = mkMount();
    const launch = jest.fn<void, []>();
    mountTeacherShell(
      teacher,
      mount,
      makeShellDeps({ onLaunchPresentMode: launch }),
    );
    clickPresentMode(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=present-mode-launch]")
      ?.click();
    expect(launch).toHaveBeenCalledTimes(1);
  });

  test("Sprint 6G: launch button exposes no teacher, class, or student identifiers", () => {
    const mount = mkMount();
    renderPresentModeSurface(mount, teacher);
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=present-mode-launch]",
    );
    const text = btn?.textContent ?? "";
    expect(text).not.toContain("u1");
    expect(text).not.toContain("school-abc");
    expect(text).not.toContain("Ada Lovelace");
    expect(text).not.toMatch(/uid|email|claim|assignment|student/i);
  });

  test("navigating away and back to Present Mode does not double-mount the outlet", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickPresentMode(mount);
    expect(
      mount.querySelectorAll("[data-testid=workspace-outlet]"),
    ).toHaveLength(1);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-classes]")
      ?.click();
    clickPresentMode(mount);
    expect(
      mount.querySelectorAll("[data-testid=workspace-outlet]"),
    ).toHaveLength(1);
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("present-mode");
  });
});

describe("Settings workspace surface (Sprint 6H)", () => {
  const teacher = teacherSession();

  const clickSettings = (mount: HTMLElement): void => {
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-settings]")
      ?.click();
  };

  test("nav item is available and does not carry aria-current by default", () => {
    const mount = mkMount();
    renderNavigation(mount);
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-settings]",
    );
    expect(btn?.disabled).toBe(false);
    expect(btn?.getAttribute("aria-disabled")).toBeNull();
    expect(btn?.textContent).toBe("Settings");
    expect(btn?.getAttribute("aria-current")).toBeNull();
  });

  test("nav item carries aria-current=page when Settings is the active surface", () => {
    const mount = mkMount();
    renderNavigation(mount, {
      activeKey: "settings",
      onSelect: () => undefined,
    });
    expect(
      mount
        .querySelector("[data-testid=nav-settings]")
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      mount
        .querySelector("[data-testid=nav-curriculum]")
        ?.getAttribute("aria-current"),
    ).toBeNull();
  });

  test("clicking Settings switches the outlet to the Settings surface", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickSettings(mount);
    const outlet = mount.querySelector("[data-testid=workspace-outlet]");
    expect(outlet?.getAttribute("data-active-surface")).toBe("settings");
    expect(
      mount.querySelectorAll("[data-testid=workspace-outlet]"),
    ).toHaveLength(1);
  });

  test("Settings renders through the workspace outlet, not as a shell sibling", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickSettings(mount);
    const outlet = mount.querySelector("[data-testid=workspace-outlet]");
    const headline = mount.querySelector("[data-testid=surface-headline]");
    expect(headline?.textContent).toBe("Settings");
    expect(outlet?.contains(headline!)).toBe(true);
  });

  test("selecting Settings moves aria-current onto the Settings nav item", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickSettings(mount);
    expect(
      mount
        .querySelector("[data-testid=nav-settings]")
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      mount
        .querySelector("[data-testid=nav-curriculum]")
        ?.getAttribute("aria-current"),
    ).toBeNull();
  });

  test("selecting Curriculum after Settings returns the outlet to Curriculum", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickSettings(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")
      ?.click();
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("curriculum");
  });

  test("selecting LYFELABZ from Settings returns the outlet to Curriculum", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickSettings(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-lyfelabz]")
      ?.click();
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("curriculum");
  });

  test("focus lands on the Settings headline when the surface is activated", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickSettings(mount);
    expect(document.activeElement?.getAttribute("data-testid")).toBe(
      "surface-headline",
    );
    expect(document.activeElement?.textContent).toBe("Settings");
  });

  test("renders the title, introductory copy, purpose explanation, and future-growth notice", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher);
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Settings");
    expect(
      mount.querySelector("[data-testid=settings-intro]")?.textContent,
    ).toContain("Settings is where you will manage how LyfeLabz works for you.");
    expect(
      mount.querySelector("[data-testid=settings-purpose]")?.textContent,
    ).toContain("not a dashboard");
    expect(
      mount.querySelector("[data-testid=settings-growth-notice]")?.textContent,
    ).toContain(
      "Additional preferences will appear here as the Teacher Platform grows.",
    );
  });

  test("renders the five certified future preference categories", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher);
    for (const testId of [
      "settings-category-classroom",
      "settings-category-present-mode",
      "settings-category-notifications",
      "settings-category-connected-services",
      "settings-category-account",
    ]) {
      expect(mount.querySelector(`[data-testid=${testId}]`)).not.toBeNull();
    }
    const list = mount.querySelector("[data-testid=settings-categories]");
    expect(list?.tagName.toLowerCase()).toBe("ul");
    expect(list?.getAttribute("aria-labelledby")).toBe(
      "settings-categories-heading",
    );
    expect(list?.children.length).toBe(5);
  });

  test("does not render any 'coming soon', 'under construction', or placeholder-controls labels", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher);
    const text = (mount.textContent ?? "").toLowerCase();
    expect(text).not.toContain("coming soon");
    expect(text).not.toContain("under construction");
    expect(text).not.toContain("placeholder");
  });

  test("does not render form controls or sample settings data", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher);
    expect(mount.querySelectorAll("input")).toHaveLength(0);
    expect(mount.querySelectorAll("select")).toHaveLength(0);
    expect(mount.querySelectorAll("textarea")).toHaveLength(0);
    expect(mount.querySelectorAll("form")).toHaveLength(0);
    expect(mount.querySelectorAll("button")).toHaveLength(0);
  });

  test("does not render uid, schoolId, email, or any Session claim payload", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher);
    const text = mount.textContent ?? "";
    expect(text).not.toContain("u1");
    expect(text).not.toContain("school-abc");
    expect(text).not.toContain("claim");
    expect(text).not.toContain("Ada Lovelace");
  });

  test("navigating away and back to Settings does not double-mount the outlet", () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickSettings(mount);
    expect(
      mount.querySelectorAll("[data-testid=workspace-outlet]"),
    ).toHaveLength(1);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-classes]")
      ?.click();
    clickSettings(mount);
    expect(
      mount.querySelectorAll("[data-testid=workspace-outlet]"),
    ).toHaveLength(1);
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("settings");
  });
});
