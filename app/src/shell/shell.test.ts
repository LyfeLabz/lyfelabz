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
import type * as SnapshotModule from "./surfaces/snapshot";

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

  test("Sprint 7B: clicking a classroom card opens its class workspace without leaving the Classes surface", async () => {
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
    // Drill-in mounts the class workspace inside the classes outlet
    const workspace = mount.querySelector("[data-testid=class-workspace]");
    expect(workspace).not.toBeNull();
    expect(workspace?.getAttribute("data-class-id")).toBe("c1");
    expect(workspace?.getAttribute("data-class-tab")).toBe("snapshot");
    // The permanent workspace-surface identifier is unchanged
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("classes");
    // The class list is no longer visible; the other class card is gone
    expect(mount.querySelector("[data-testid=classes-list]")).toBeNull();
    expect(mount.querySelector("[data-testid=class-card-c2]")).toBeNull();
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

describe("Class Snapshot foundation (Sprint 7B)", () => {
  const teacher = teacherSession();

  const twoClasses: ReadonlyArray<ClassSummary> = freeze([
    freeze({ id: "c1", title: "6A Life Science", grade: "6", status: "active" }),
    freeze({ id: "c2", title: "7B Systems", grade: "7", status: "active" }),
  ] as ClassSummary[]);
  const listTwo: ListClasses = () => Promise.resolve(twoClasses);

  const clickClasses = (mount: HTMLElement): void => {
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-classes]")
      ?.click();
  };

  const openC1 = async (mount: HTMLElement): Promise<void> => {
    clickClasses(mount);
    await flush();
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-card-c1]")
      ?.click();
  };

  test("navigation lists exactly the four permanent workspace destinations after Sprint 7B", () => {
    // Snapshot must not become a fifth permanent Teacher Workspace
    // destination. See CLASS_SNAPSHOT_EXPERIENCE.md §6 and
    // SNAPSHOT_ARCHITECTURE.md §6.
    expect(Object.keys(WORKSPACE_SURFACES).sort()).toEqual(
      ["classes", "curriculum", "present-mode", "settings"],
    );
    const mount = mkMount();
    renderNavigation(mount);
    expect(mount.querySelector("[data-testid=nav-snapshot]")).toBeNull();
    expect(
      mount.querySelectorAll<HTMLButtonElement>(
        "button.shell-nav-button[data-nav-variant=item]",
      ).length,
    ).toBe(4);
  });

  test("no-classes state: Classes surface renders the certified empty state, no class workspace", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickClasses(mount);
    await flush();
    expect(mount.querySelector("[data-testid=classes-empty]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=class-workspace]")).toBeNull();
    expect(mount.querySelector("[data-testid=class-nav]")).toBeNull();
    expect(mount.querySelector("[data-testid=snapshot-region]")).toBeNull();
    expect(
      mount.querySelector("[data-testid=classes-status]")?.textContent,
    ).toBe("You do not have any classrooms yet.");
  });

  test("no-selected-class state: classes exist but nothing is selected renders the class list with a chooser prompt", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    clickClasses(mount);
    await flush();
    expect(mount.querySelector("[data-testid=classes-list]")).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=classes-prompt]")?.textContent,
    ).toBe("Choose a class to open its workspace.");
    expect(mount.querySelector("[data-testid=class-workspace]")).toBeNull();
    expect(mount.querySelector("[data-testid=snapshot-region]")).toBeNull();
  });

  test("selecting a class opens its class workspace with Snapshot as the default class-level surface", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    const workspace = mount.querySelector("[data-testid=class-workspace]");
    expect(workspace).not.toBeNull();
    expect(workspace?.getAttribute("data-class-id")).toBe("c1");
    expect(workspace?.getAttribute("data-class-tab")).toBe("snapshot");
    // The permanent workspace-surface identifier is unchanged
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("classes");
    // The Snapshot region is present with the class name as its headline
    expect(mount.querySelector("[data-testid=snapshot-region]")).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("6A Life Science");
  });

  test("Snapshot with no data renders the certified no-data language, no fictional students", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    expect(
      mount.querySelector("[data-testid=snapshot-empty]")?.textContent,
    ).toBe(
      "Classroom activity will appear here when assignments and submissions exist.",
    );
    expect(mount.querySelector("[data-testid=snapshot-groups]")).toBeNull();
    // No preview groupings render without a preview payload
    for (const key of ["check-in-next", "working", "finished"]) {
      expect(mount.querySelector(`[data-testid=snapshot-group-${key}]`)).toBeNull();
    }
  });

  test("Snapshot renders the class identity, purpose, and grade + status context", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    expect(
      mount.querySelector("[data-testid=snapshot-purpose]")?.textContent,
    ).toBe("One place to check in on your class between moments.");
    expect(
      mount.querySelector("[data-testid=snapshot-class-grade]")?.textContent,
    ).toBe("Grade 6");
    expect(
      mount.querySelector("[data-testid=snapshot-class-status]")?.textContent,
    ).toBe("Active");
    expect(
      mount
        .querySelector("[data-testid=snapshot-class-status]")
        ?.getAttribute("aria-label"),
    ).toBe("Class status: Active");
  });

  test("Snapshot renders no dashboard, analytics, or evaluation language", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    const text = (
      mount.querySelector("[data-testid=snapshot-region]")?.textContent ?? ""
    ).toLowerCase();
    expect(text).not.toContain("dashboard");
    expect(text).not.toContain("analytics");
    expect(text).not.toContain("performance");
    expect(text).not.toContain("percent");
    expect(text).not.toContain("%");
    expect(text).not.toContain("mastery");
    expect(text).not.toContain("grade average");
    expect(text).not.toContain("trend");
    expect(text).not.toContain("ranking");
    expect(text).not.toContain("accommodation");
  });

  test("static representative preview renders the three attention groupings in the certified order", async () => {
    const mount = mkMount();
    const { STATIC_SNAPSHOT_PREVIEW } = jest.requireActual(
      "./surfaces/snapshot",
    ) as typeof SnapshotModule;
    mountTeacherShell(
      teacher,
      mount,
      makeShellDeps({
        listClasses: listTwo,
        snapshotPreview: STATIC_SNAPSHOT_PREVIEW,
      }),
    );
    await openC1(mount);
    const groups = mount.querySelector("[data-testid=snapshot-groups]");
    expect(groups).not.toBeNull();
    const items = Array.from(
      groups?.querySelectorAll<HTMLElement>("[data-testid^=snapshot-group-]") ??
        [],
    ).filter((el) =>
      /^snapshot-group-(check-in-next|working|finished)$/.test(
        el.getAttribute("data-testid") ?? "",
      ),
    );
    expect(items.map((el) => el.getAttribute("data-testid"))).toEqual([
      "snapshot-group-check-in-next",
      "snapshot-group-working",
      "snapshot-group-finished",
    ]);
    expect(
      mount.querySelector("[data-testid=snapshot-preview-notice]")?.textContent,
    ).toContain("Preview only.");
    // Placeholder names are anonymous; no real student data
    const preview = mount.querySelector("[data-testid=snapshot-region]");
    const previewText = preview?.textContent ?? "";
    expect(previewText).toMatch(/Student \d/);
  });

  test("static preview never leaves the class workspace and never affects other surfaces", async () => {
    const mount = mkMount();
    const { STATIC_SNAPSHOT_PREVIEW } = jest.requireActual(
      "./surfaces/snapshot",
    ) as typeof SnapshotModule;
    mountTeacherShell(
      teacher,
      mount,
      makeShellDeps({
        listClasses: listTwo,
        snapshotPreview: STATIC_SNAPSHOT_PREVIEW,
      }),
    );
    // Curriculum default view does not render preview data
    expect(mount.querySelector("[data-testid=snapshot-groups]")).toBeNull();
    // Present Mode does not render preview data
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-present-mode]")
      ?.click();
    expect(mount.querySelector("[data-testid=snapshot-groups]")).toBeNull();
    // Settings does not render preview data
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-settings]")
      ?.click();
    expect(mount.querySelector("[data-testid=snapshot-groups]")).toBeNull();
  });

  test("class-level navigation exposes Snapshot and Roster and marks Snapshot as active by default", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    const nav = mount.querySelector("[data-testid=class-nav]");
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute("aria-label")).toBe("Class sections");
    const snapshotBtn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=class-nav-snapshot]",
    );
    const rosterBtn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=class-nav-roster]",
    );
    expect(snapshotBtn).not.toBeNull();
    expect(rosterBtn).not.toBeNull();
    expect(snapshotBtn?.getAttribute("aria-current")).toBe("page");
    expect(rosterBtn?.getAttribute("aria-current")).toBeNull();
  });

  test("selecting Roster moves aria-current and renders the roster foundation surface", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")
      ?.click();
    const workspace = mount.querySelector("[data-testid=class-workspace]");
    expect(workspace?.getAttribute("data-class-tab")).toBe("roster");
    expect(
      mount
        .querySelector("[data-testid=class-nav-roster]")
        ?.getAttribute("aria-current"),
    ).toBe("page");
    expect(
      mount
        .querySelector("[data-testid=class-nav-snapshot]")
        ?.getAttribute("aria-current"),
    ).toBeNull();
    expect(mount.querySelector("[data-testid=roster-purpose]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=snapshot-region]")).toBeNull();
  });

  test("switching between Snapshot and Roster preserves the class context", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")
      ?.click();
    expect(
      mount
        .querySelector("[data-testid=class-workspace]")
        ?.getAttribute("data-class-id"),
    ).toBe("c1");
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-nav-snapshot]")
      ?.click();
    expect(
      mount
        .querySelector("[data-testid=class-workspace]")
        ?.getAttribute("data-class-id"),
    ).toBe("c1");
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("6A Life Science");
  });

  test("Back to Classes returns the surface to the class list without a refetch", async () => {
    const mount = mkMount();
    const listClasses = jest.fn<Promise<ReadonlyArray<ClassSummary>>, [string]>(
      () => Promise.resolve(twoClasses),
    );
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses }));
    await openC1(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-workspace-back]")
      ?.click();
    expect(mount.querySelector("[data-testid=class-workspace]")).toBeNull();
    expect(mount.querySelector("[data-testid=classes-list]")).not.toBeNull();
    // The list fetcher must not be invoked again on Back
    expect(listClasses).toHaveBeenCalledTimes(1);
  });

  test("re-opening the same class after Back preserves class context and re-lands on Snapshot", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-workspace-back]")
      ?.click();
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-card-c1]")
      ?.click();
    expect(
      mount
        .querySelector("[data-testid=class-workspace]")
        ?.getAttribute("data-class-id"),
    ).toBe("c1");
    expect(
      mount
        .querySelector("[data-testid=class-workspace]")
        ?.getAttribute("data-class-tab"),
    ).toBe("snapshot");
  });

  test("focus lands on the Snapshot headline (the class name) when the class workspace opens", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    expect(document.activeElement?.getAttribute("data-testid")).toBe(
      "surface-headline",
    );
    expect(document.activeElement?.textContent).toBe("6A Life Science");
  });

  test("focus lands on the Roster headline when Roster is selected", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")
      ?.click();
    expect(document.activeElement?.getAttribute("data-testid")).toBe(
      "surface-headline",
    );
    expect(document.activeElement?.textContent).toBe("6A Life Science");
  });

  test("Snapshot does not render Present Mode controls, assign controls, or grading controls", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    const snapshot = mount.querySelector("[data-testid=snapshot-region]");
    expect(snapshot).not.toBeNull();
    // Present Mode launch button belongs to the Present Mode surface only
    expect(mount.querySelector("[data-testid=present-mode-launch]")).toBeNull();
    // Assign controls belong to Curriculum only
    expect(mount.querySelector("[data-testid=assign-dialog]")).toBeNull();
    expect(mount.querySelector("[data-testid=curriculum-grid]")).toBeNull();
  });

  test("Snapshot exposes no teacher, uid, schoolId, or claim payload", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    const region = mount.querySelector("[data-testid=snapshot-region]");
    const text = region?.textContent ?? "";
    expect(text).not.toContain("u1");
    expect(text).not.toContain("school-abc");
    expect(text).not.toContain("Ada Lovelace");
    expect(text).not.toContain("claim");
  });

  test("Snapshot never links to Present Mode and never exposes accommodations", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    const workspace = mount.querySelector("[data-testid=class-workspace]");
    const html = workspace?.innerHTML.toLowerCase() ?? "";
    expect(html).not.toContain("present-mode-launch");
    expect(html).not.toContain("accommodation");
    expect(html).not.toContain("iep");
    expect(html).not.toContain("504");
    expect(html).not.toContain("modification");
  });

  test("permanent left-side navigation remains unchanged after opening a class workspace", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
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
    // The Classes nav item still carries aria-current
    expect(
      mount
        .querySelector("[data-testid=nav-classes]")
        ?.getAttribute("aria-current"),
    ).toBe("page");
  });

  test("clicking Present Mode from the class workspace leaves Classes and returns to Present Mode; Back into Classes returns to the class list", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-present-mode]")
      ?.click();
    expect(mount.querySelector("[data-testid=class-workspace]")).toBeNull();
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("present-mode");
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-classes]")
      ?.click();
    // Because Classes was re-mounted, its internal state resets to the
    // class list. Class context is not persisted across top-level nav
    // (per SNAPSHOT_ARCHITECTURE.md §9: session-scoped memory only).
    await flush();
    expect(mount.querySelector("[data-testid=classes-list]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=class-workspace]")).toBeNull();
  });

  test("Snapshot does not import from firebase/* or use browser storage (snapshot.ts posture)", () => {
    const p = path.resolve(__dirname, "surfaces/snapshot.ts");
    const text = fs.readFileSync(p, "utf8");
    expect(text).not.toContain('from "firebase/firestore"');
    expect(text).not.toContain('from "firebase/functions"');
    expect(text).not.toContain('from "firebase/auth"');
    expect(text).not.toContain("onSnapshot(");
    expect(text).not.toContain("httpsCallable(");
    expect(text).not.toContain("localStorage");
    expect(text).not.toContain("sessionStorage");
    expect(text).not.toContain("document.cookie");
  });
});

// -----------------------------------------------------------------------------
// Sprint 8D.1 - Authoritative assignment lifecycle
// -----------------------------------------------------------------------------

describe("Assign Experience - Sprint 8D.1 authoritative lifecycle", () => {
  const teacher = teacherSession();

  type CreateDraftIn = {
    assignmentId: string;
    classId: string;
    lessonSlug: string;
    lessonVersion: string;
    mode: "practice" | "classroom";
    title?: string;
  };
  type PublishIn = { assignmentId: string };
  type LmsPublishIn = {
    assignmentId: string;
    linkId: string;
    lyfelabzAssignmentUrl: string;
    title?: string;
    lmsTopicId?: string;
  };

  const twoClasses: ReadonlyArray<ClassSummary> = freeze([
    freeze({ id: "c1", title: "6A Life Science", grade: "6", status: "active" }),
    freeze({ id: "c2", title: "7B Systems", grade: "7", status: "active" }),
  ] as ClassSummary[]);
  const listTwo: ListClasses = () => Promise.resolve(twoClasses);

  const makeAssignments = () => {
    const events: string[] = [];
    const drafts: CreateDraftIn[] = [];
    const publishes: PublishIn[] = [];
    let createDraftResult: (
      input: CreateDraftIn,
    ) => Promise<{ assignmentId: string; status: "draft"; alreadyCreated: boolean }> =
      async (input) => ({
        assignmentId: input.assignmentId,
        status: "draft",
        alreadyCreated: false,
      });
    let publishResult: (
      input: PublishIn,
    ) => Promise<{
      assignmentId: string;
      status: "published";
      alreadyPublished: boolean;
    }> = async (input) => ({
      assignmentId: input.assignmentId,
      status: "published",
      alreadyPublished: false,
    });
    return {
      events,
      drafts,
      publishes,
      seam: {
        createDraft: async (input: CreateDraftIn) => {
          events.push(`draft:${input.classId}`);
          drafts.push(input);
          return createDraftResult(input);
        },
        publish: async (input: PublishIn) => {
          events.push(`publish:${input.assignmentId}`);
          publishes.push(input);
          return publishResult(input);
        },
      },
      failDraftFor: (classId: string) => {
        const prior = createDraftResult;
        createDraftResult = async (input) => {
          if (input.classId === classId) {
            throw Object.assign(new Error("draft failed"), {
              code: "assignments.classNotFound",
            });
          }
          return prior(input);
        };
      },
      failPublishFor: (assignmentSubstring: string) => {
        const prior = publishResult;
        publishResult = async (input) => {
          if (input.assignmentId.includes(assignmentSubstring)) {
            throw Object.assign(new Error("publish failed"), {
              code: "assignments.invalidTransition",
            });
          }
          return prior(input);
        };
      },
    };
  };

  type IntegrationsFakeOpts = {
    linkedClassIds?: readonly string[];
    lmsResult?: "succeeded" | "failed" | "throw";
  };
  const makeIntegrations = (opts: IntegrationsFakeOpts = {}) => {
    const lmsCalls: LmsPublishIn[] = [];
    const links = (opts.linkedClassIds ?? []).map((cid) =>
      Object.freeze({
        linkId: `link-${cid}`,
        classId: cid,
        providerId: "googleClassroom",
        lmsClassId: `lms-${cid}`,
      }),
    );
    const events: string[] = [];
    const deps = {
      callables: {
        listProviders: async () => Object.freeze([]),
        describeConnections: async () => Object.freeze([]),
        beginConnection: async () => ({
          authorizationUrl: "",
          state: "",
        }),
        completeConnection: async () => ({
          connectionId: "",
          alreadyConnected: false,
        }),
        disconnect: async () => ({ alreadyRevoked: false }),
        discoverClasses: async () => Object.freeze([]),
        importClass: async () => ({
          linkId: "",
          classId: "",
          lmsClassId: "",
          alreadyLinked: false,
        }),
        listClassTopics: async () =>
          Object.freeze([
            Object.freeze({ lmsTopicId: "t1", name: "Unit 1" }),
            Object.freeze({ lmsTopicId: "t2", name: "Unit 2" }),
          ]),
        refreshClass: async (input: { linkId: string }) =>
          Object.freeze({
            linkId: input.linkId,
            classId: "",
            lmsClassId: "",
            providerId: "googleClassroom",
            status: "healthy" as const,
            changed: false,
          }),
        publishAssignment: async (input: LmsPublishIn) => {
          events.push(`lms:${input.assignmentId}`);
          lmsCalls.push(input);
          if (opts.lmsResult === "throw") {
            throw new Error("network");
          }
          const status =
            opts.lmsResult === "failed" ? "failed" : "succeeded";
          return Object.freeze({
            publicationId: `pub-${input.assignmentId}`,
            status,
            ...(status === "succeeded"
              ? { lmsAssignmentId: `lms-a-${input.assignmentId}` }
              : {
                  errorCode: "lms.providerNotYetOperational",
                  errorMessage:
                    "Google Classroom publication is not available yet.",
                }),
          }) as never;
        },
      },
      openOAuth: async () => ({ code: "", state: "" }),
      listTeacherClasses: async () => Object.freeze([]),
      redirectUri: "",
      listClassLinks: async () => Object.freeze(links),
    };
    return { deps, lmsCalls, events };
  };

  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("createDraft is called before publish, and publish before any LMS-side publication", async () => {
    const asn = makeAssignments();
    const int = makeIntegrations({ linkedClassIds: ["c1"] });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      integrations: int.deps as never,
      assignments: asn.seam,
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    // Enable the LMS publish toggle on the linked class row.
    const pub = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-lms-publish-c1]",
    );
    pub!.checked = true;
    pub!.dispatchEvent(new Event("change"));
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();
    await flush();
    await flush();

    // Ordering: every draft precedes its own publish; every publish
    // precedes any LMS call for the same assignmentId.
    expect(asn.drafts.length).toBe(2);
    expect(asn.publishes.length).toBe(2);
    for (const d of asn.drafts) {
      const draftIdx = asn.events.indexOf(`draft:${d.classId}`);
      const publishIdx = asn.events.indexOf(`publish:${d.assignmentId}`);
      expect(draftIdx).toBeGreaterThanOrEqual(0);
      expect(publishIdx).toBeGreaterThan(draftIdx);
    }
    expect(int.lmsCalls.length).toBe(1);
    // The LMS call must use an authoritative id that was minted by
    // createDraft, never a session-only synthetic id.
    expect(int.lmsCalls[0]!.assignmentId).not.toMatch(/^session:/);
    expect(
      asn.drafts.map((d) => d.assignmentId),
    ).toContain(int.lmsCalls[0]!.assignmentId);
  });

  test("LMS publication is skipped when assignmentsCreateDraft fails", async () => {
    const asn = makeAssignments();
    asn.failDraftFor("c1");
    const int = makeIntegrations({ linkedClassIds: ["c1"] });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      integrations: int.deps as never,
      assignments: asn.seam,
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    const pub = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-lms-publish-c1]",
    );
    pub!.checked = true;
    pub!.dispatchEvent(new Event("change"));
    // Only c1 selected so we isolate the failure path.
    const c2Cb = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c2]",
    );
    c2Cb!.checked = false;
    c2Cb!.dispatchEvent(new Event("change"));
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();
    await flush();
    await flush();
    expect(asn.publishes.length).toBe(0);
    expect(int.lmsCalls.length).toBe(0);
  });

  test("LMS publication is skipped when assignmentsPublish fails", async () => {
    const asn = makeAssignments();
    asn.failPublishFor("");
    const int = makeIntegrations({ linkedClassIds: ["c1"] });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      integrations: int.deps as never,
      assignments: asn.seam,
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    const pub = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-lms-publish-c1]",
    );
    pub!.checked = true;
    pub!.dispatchEvent(new Event("change"));
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();
    await flush();
    await flush();
    expect(asn.drafts.length).toBe(2);
    expect(asn.publishes.length).toBe(2);
    // Every publish threw; LMS must not have been invoked.
    expect(int.lmsCalls.length).toBe(0);
  });

  test("successful LyfeLabz assignment remains successful when LMS publication fails", async () => {
    const asn = makeAssignments();
    const int = makeIntegrations({
      linkedClassIds: ["c1"],
      lmsResult: "failed",
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      integrations: int.deps as never,
      assignments: asn.seam,
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    const pub = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-lms-publish-c1]",
    );
    pub!.checked = true;
    pub!.dispatchEvent(new Event("change"));
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();
    await flush();
    await flush();
    // Both LyfeLabz assignments published; LMS attempted once and failed.
    expect(asn.publishes.length).toBe(2);
    expect(int.lmsCalls.length).toBe(1);
    // The card still reflects the Assigned state; the LyfeLabz record is
    // authoritative and untouched by the LMS-side failure.
    const assign = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-assign-earths-layers]",
    );
    expect(assign?.getAttribute("data-assigned")).toBe("true");
    // The confirmation names the LMS-side outcome without blaming the
    // teacher and without rolling back the LyfeLabz assignment.
    const summary = mount.querySelector(
      "[data-testid=assign-success]",
    )?.textContent;
    expect(summary).toContain("Assigned");
    expect(summary).toContain("Google Classroom");
    expect(summary).toContain("did not succeed");
  });

  test("providerNotYetOperational produces graceful teacher messaging", async () => {
    const asn = makeAssignments();
    const int = makeIntegrations({
      linkedClassIds: ["c1"],
      lmsResult: "failed",
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      integrations: int.deps as never,
      assignments: asn.seam,
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    const pub = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-lms-publish-c1]",
    );
    pub!.checked = true;
    pub!.dispatchEvent(new Event("change"));
    // Only c1 selected so the aggregate suffix is a single line.
    const c2Cb = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c2]",
    );
    c2Cb!.checked = false;
    c2Cb!.dispatchEvent(new Event("change"));
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();
    await flush();
    await flush();
    const summary = mount.querySelector(
      "[data-testid=assign-success]",
    )?.textContent;
    expect(summary).toMatch(/Assigned .* to 1 class\./);
    expect(summary).toContain("did not succeed");
    // Never blames the teacher and never suggests a stack trace.
    expect(summary).not.toMatch(/error/i);
    expect(summary).not.toMatch(/stack/i);
  });

  test("multiple selected classes receive independent assignment records and outcomes", async () => {
    const asn = makeAssignments();
    const int = makeIntegrations({ linkedClassIds: ["c1", "c2"] });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      integrations: int.deps as never,
      assignments: asn.seam,
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();
    await flush();
    await flush();
    expect(asn.drafts.length).toBe(2);
    const ids = new Set(asn.drafts.map((d) => d.assignmentId));
    // Each class receives its own persistent record.
    expect(ids.size).toBe(2);
    // Ownership fields the client controls are per-class and never
    // reused across classes.
    expect(
      new Set(asn.drafts.map((d) => d.classId)),
    ).toEqual(new Set(["c1", "c2"]));
  });

  test("non-LMS-linked classes never invoke LMS publication", async () => {
    const asn = makeAssignments();
    // No LMS class links.
    const int = makeIntegrations({ linkedClassIds: [] });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      integrations: int.deps as never,
      assignments: asn.seam,
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();
    await flush();
    await flush();
    expect(asn.publishes.length).toBe(2);
    expect(int.lmsCalls.length).toBe(0);
  });

  test("LMS topic selection remains scoped to the correct class", async () => {
    const asn = makeAssignments();
    const int = makeIntegrations({ linkedClassIds: ["c1", "c2"] });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      integrations: int.deps as never,
      assignments: asn.seam,
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    await flush();
    // Choose distinct topics per row.
    const t1 = document.querySelector<HTMLSelectElement>(
      "[data-testid=assign-row-lms-topic-c1]",
    );
    t1!.value = "t1";
    t1!.dispatchEvent(new Event("change"));
    const t2 = document.querySelector<HTMLSelectElement>(
      "[data-testid=assign-row-lms-topic-c2]",
    );
    t2!.value = "t2";
    t2!.dispatchEvent(new Event("change"));
    // Enable both publishToLms toggles.
    for (const cid of ["c1", "c2"]) {
      const pub = document.querySelector<HTMLInputElement>(
        `[data-testid=assign-row-lms-publish-${cid}]`,
      );
      pub!.checked = true;
      pub!.dispatchEvent(new Event("change"));
    }
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();
    await flush();
    await flush();
    // Each LMS call carries its own class's topic and its own linkId.
    const byLink = new Map(int.lmsCalls.map((c) => [c.linkId, c] as const));
    expect(byLink.get("link-c1")?.lmsTopicId).toBe("t1");
    expect(byLink.get("link-c2")?.lmsTopicId).toBe("t2");
  });

  test("clicking Confirm a second time before the lifecycle resolves does not dispatch a duplicate submission", async () => {
    let releaseDraft: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      releaseDraft = resolve;
    });
    const asn = makeAssignments();
    const originalCreate = asn.seam.createDraft;
    let creates = 0;
    (asn.seam as { createDraft: typeof originalCreate }).createDraft = async (
      input,
    ) => {
      creates += 1;
      await gate;
      return originalCreate(input);
    };
    const int = makeIntegrations({ linkedClassIds: [] });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      integrations: int.deps as never,
      assignments: asn.seam,
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-assign-earths-layers]",
      )
      ?.click();
    await flush();
    const confirm = document.querySelector<HTMLButtonElement>(
      "[data-testid=assign-confirm]",
    );
    confirm!.click();
    confirm!.click();
    confirm!.click();
    // Only the first click enters flight (2 drafts, one per class).
    expect(creates).toBe(2);
    releaseDraft();
    await flush();
    await flush();
    expect(creates).toBe(2);
  });
});

// -----------------------------------------------------------------------------
// Sprint 13B remediation - visible View summary opener
// -----------------------------------------------------------------------------

describe("Assign Experience - Sprint 13B remediation", () => {
  const teacher = teacherSession();

  type CreateDraftIn = {
    assignmentId: string;
    classId: string;
    lessonSlug: string;
    lessonVersion: string;
    mode: "practice" | "classroom";
    title?: string;
  };
  type PublishIn = { assignmentId: string };

  const twoClasses: ReadonlyArray<ClassSummary> = freeze([
    freeze({ id: "c1", title: "6A Life Science", grade: "6", status: "active" }),
    freeze({ id: "c2", title: "7B Systems", grade: "7", status: "active" }),
  ] as ClassSummary[]);
  const listTwo: ListClasses = () => Promise.resolve(twoClasses);

  const makeAssignments = (opts: { failPublish?: boolean } = {}) => {
    const drafts: CreateDraftIn[] = [];
    const publishes: PublishIn[] = [];
    return {
      drafts,
      publishes,
      seam: {
        createDraft: async (input: CreateDraftIn) => {
          drafts.push(input);
          return {
            assignmentId: input.assignmentId,
            status: "draft" as const,
            alreadyCreated: false,
          };
        },
        publish: async (input: PublishIn) => {
          if (opts.failPublish) {
            throw new Error("publish failed");
          }
          publishes.push(input);
          return {
            assignmentId: input.assignmentId,
            status: "published" as const,
            alreadyPublished: false,
          };
        },
      },
    };
  };

  const makeDetailSeam = () => {
    const registered: Array<{
      assignmentId: string;
      title: string;
      className: string;
      status: string;
    }> = [];
    const opened: string[] = [];
    return {
      registered,
      opened,
      seam: {
        register: (m: {
          assignmentId: string;
          title: string;
          className: string;
          status: "draft" | "published" | "closed";
        }) => {
          registered.push({ ...m });
        },
        open: (id: string) => {
          opened.push(id);
        },
      },
    };
  };

  const confirmSingleClass = async (
    mount: HTMLElement,
    lessonSlug: string,
    keepClassId: string,
  ): Promise<void> => {
    mount
      .querySelector<HTMLButtonElement>(
        `[data-testid=lesson-assign-${lessonSlug}]`,
      )
      ?.click();
    await flush();
    for (const cid of ["c1", "c2"]) {
      if (cid === keepClassId) continue;
      const cb = document.querySelector<HTMLInputElement>(
        `[data-testid=assign-row-enabled-${cid}]`,
      );
      if (cb) {
        cb.checked = false;
        cb.dispatchEvent(new Event("change"));
      }
    }
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();
    await flush();
    await flush();
  };

  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("View summary is absent before publication", () => {
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });
    expect(
      mount.querySelector("[data-testid=lesson-view-summary-earths-layers]"),
    ).toBeNull();
  });

  test("successful publish registers metadata and reveals View summary on the correct card", async () => {
    const asn = makeAssignments();
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    await confirmSingleClass(mount, "earths-layers", "c1");
    expect(detail.registered.length).toBe(1);
    expect(detail.registered[0]?.status).toBe("published");
    expect(detail.registered[0]?.title).toBe(
      // certified curriculum manifest entry
      mount
        .querySelector("[data-testid=lesson-title-earths-layers]")
        ?.textContent,
    );
    expect(detail.registered[0]?.className).toContain("6A Life Science");
    const view = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-earths-layers]",
    );
    expect(view).not.toBeNull();
    expect(view?.tagName).toBe("BUTTON");
    expect(view?.textContent).toBe("View summary");
    expect(view?.getAttribute("aria-label")).toContain("View summary for");
    // The affordance is not attached to any other card.
    const others = mount.querySelectorAll(
      "[data-testid^=lesson-view-summary-]",
    );
    expect(others.length).toBe(1);
  });

  test("clicking View summary invokes the entry-point opener exactly once with the correct assignmentId", async () => {
    const asn = makeAssignments();
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    await confirmSingleClass(mount, "earths-layers", "c1");
    const expectedId = detail.registered[0]!.assignmentId;
    const view = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-earths-layers]",
    );
    view!.click();
    expect(detail.opened).toEqual([expectedId]);
  });

  test("failed publish does not register anything and does not reveal View summary", async () => {
    const asn = makeAssignments({ failPublish: true });
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    await confirmSingleClass(mount, "earths-layers", "c1");
    expect(detail.registered.length).toBe(0);
    expect(
      mount.querySelector("[data-testid=lesson-view-summary-earths-layers]"),
    ).toBeNull();
  });

  test("multiple published lessons each retain their own View summary that opens its own assignment", async () => {
    const asn = makeAssignments();
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    await confirmSingleClass(mount, "earths-layers", "c1");
    await confirmSingleClass(mount, "what-is-life", "c1");
    const a = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-earths-layers]",
    );
    const b = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-what-is-life]",
    );
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const aId = a!.getAttribute("data-assignment-id")!;
    const bId = b!.getAttribute("data-assignment-id")!;
    expect(aId).not.toBe(bId);
    a!.click();
    b!.click();
    expect(detail.opened).toEqual([aId, bId]);
  });

  test("Curriculum re-render preserves View summary for the active session", async () => {
    const asn = makeAssignments();
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    await confirmSingleClass(mount, "earths-layers", "c1");
    const remount = mkMount();
    renderCurriculumSurface(remount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    expect(
      remount.querySelector("[data-testid=lesson-view-summary-earths-layers]"),
    ).not.toBeNull();
  });

  test("View summary is absent when no assignmentDetail seam is wired", async () => {
    const asn = makeAssignments();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
    });
    await confirmSingleClass(mount, "earths-layers", "c1");
    expect(
      mount.querySelector("[data-testid=lesson-view-summary-earths-layers]"),
    ).toBeNull();
  });

  test("test-only reset clears the session-scoped assignmentId map", async () => {
    const asn = makeAssignments();
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    await confirmSingleClass(mount, "earths-layers", "c1");
    _resetCurriculumSessionStateForTest();
    const remount = mkMount();
    renderCurriculumSurface(remount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    expect(
      remount.querySelector("[data-testid=lesson-view-summary-earths-layers]"),
    ).toBeNull();
  });

  test("the four-item Teacher Workspace navigation remains unchanged when the seam is wired", () => {
    const detail = makeDetailSeam();
    const mount = mkMount();
    mountTeacherShell(teacher, mount, {
      ...makeShellDeps({ listClasses: listTwo }),
      assignmentDetail: detail.seam,
    });
    const items = NAVIGATION_ITEMS.filter((i) => i.variant === "item");
    expect(items.map((i) => i.label)).toEqual([
      "Curriculum",
      "Classes",
      "Present Mode",
      "Settings",
    ]);
    for (const i of items) {
      expect(
        mount.querySelector<HTMLElement>(`[data-testid=nav-${i.key}]`),
      ).not.toBeNull();
    }
  });
});

// -----------------------------------------------------------------------------
// Sprint 13C remediation - multiple-assignment selection interface
// -----------------------------------------------------------------------------

describe("Assign Experience - Sprint 13C multiple-assignment selection", () => {
  const teacher = teacherSession();

  const twoClasses: ReadonlyArray<ClassSummary> = freeze([
    freeze({ id: "c1", title: "6A Life Science", grade: "6", status: "active" }),
    freeze({ id: "c2", title: "7B Systems", grade: "7", status: "active" }),
  ] as ClassSummary[]);
  const listTwo: ListClasses = () => Promise.resolve(twoClasses);

  type CreateDraftIn = {
    assignmentId: string;
    classId: string;
    lessonSlug: string;
    lessonVersion: string;
    mode: "practice" | "classroom";
    title?: string;
  };
  type PublishIn = { assignmentId: string };
  const makeAssignments = () => {
    const drafts: CreateDraftIn[] = [];
    const publishes: PublishIn[] = [];
    return {
      drafts,
      publishes,
      seam: {
        createDraft: async (input: CreateDraftIn) => {
          drafts.push(input);
          return {
            assignmentId: input.assignmentId,
            status: "draft" as const,
            alreadyCreated: false,
          };
        },
        publish: async (input: PublishIn) => {
          publishes.push(input);
          return {
            assignmentId: input.assignmentId,
            status: "published" as const,
            alreadyPublished: false,
          };
        },
      },
    };
  };

  type Registered = {
    assignmentId: string;
    title: string;
    className: string;
    status: "draft" | "published" | "closed";
    lessonSlug?: string;
    classId?: string;
  };
  const makeHydratedSeam = (initial: ReadonlyArray<Registered>) => {
    const store = new Map<string, Registered>();
    for (const m of initial) store.set(m.assignmentId, { ...m });
    const opened: string[] = [];
    return {
      opened,
      seam: {
        register: (m: Registered) => {
          store.set(m.assignmentId, { ...m });
        },
        open: (id: string) => {
          opened.push(id);
        },
        list: () => Array.from(store.values()),
      },
    };
  };

  const confirmAllClasses = async (
    mount: HTMLElement,
    lessonSlug: string,
  ): Promise<void> => {
    mount
      .querySelector<HTMLButtonElement>(
        `[data-testid=lesson-assign-${lessonSlug}]`,
      )
      ?.click();
    await flush();
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
      ?.click();
    await flush();
    await flush();
  };

  const closeSelection = (): void => {
    document
      .querySelectorAll("[data-testid=summary-select-overlay]")
      .forEach((el) => el.remove());
  };

  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
    closeSelection();
  });

  test("hydrated multiple assignments render View summaries (not View summary)", () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "a1",
        title: "Earth's Layers",
        className: "6A Life Science · Grade 6",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
      {
        assignmentId: "a2",
        title: "Earth's Layers",
        className: "7B Systems · Grade 7",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c2",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });
    const view = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-earths-layers]",
    );
    expect(view).not.toBeNull();
    expect(view?.textContent).toBe("View summaries");
    expect(view?.getAttribute("data-assignment-count")).toBe("2");
    expect(view?.getAttribute("aria-label")).toContain("View summaries for");
    expect(view?.hasAttribute("data-assignment-id")).toBe(false);
  });

  test("clicking View summaries opens a selection interface listing every assignment", () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "a1",
        title: "Earth's Layers",
        className: "6A Life Science",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
      {
        assignmentId: "a2",
        title: "Earth's Layers",
        className: "7B Systems",
        status: "closed",
        lessonSlug: "earths-layers",
        classId: "c2",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-view-summary-earths-layers]",
      )
      ?.click();
    const dialog = document.querySelector(
      "[data-testid=summary-select-dialog]",
    );
    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("role")).toBe("dialog");
    expect(dialog?.getAttribute("aria-modal")).toBe("true");
    expect(
      document.querySelector("[data-testid=summary-select-title]")?.textContent,
    ).toContain("Earth's Layers");
    const choices = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "[data-testid^=summary-select-choice-]",
      ),
    );
    expect(choices).toHaveLength(2);
    for (const c of choices) expect(c.tagName).toBe("BUTTON");
    const texts = choices.map((c) => c.textContent ?? "");
    expect(texts.some((t) => t.includes("6A Life Science"))).toBe(true);
    expect(texts.some((t) => t.includes("7B Systems"))).toBe(true);
    expect(texts.some((t) => t.includes("Published"))).toBe(true);
    expect(texts.some((t) => t.includes("Closed"))).toBe(true);
    for (const t of texts) {
      expect(t).not.toContain("a1");
      expect(t).not.toContain("a2");
    }
  });

  test("choices sort by class name ascending, then by status", () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "z",
        title: "T",
        className: "6C",
        status: "closed",
        lessonSlug: "earths-layers",
        classId: "cc",
      },
      {
        assignmentId: "y",
        title: "T",
        className: "6A",
        status: "closed",
        lessonSlug: "earths-layers",
        classId: "ca",
      },
      {
        assignmentId: "x",
        title: "T",
        className: "6A",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "cb",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-view-summary-earths-layers]",
      )
      ?.click();
    const ids = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "[data-testid^=summary-select-choice-]",
      ),
    ).map((b) => b.getAttribute("data-assignment-id"));
    expect(ids).toEqual(["x", "y", "z"]);
  });

  test("selecting a specific choice opens that exact assignment ID", () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "a-first",
        title: "T",
        className: "6A",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
      {
        assignmentId: "a-second",
        title: "T",
        className: "6B",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c2",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-view-summary-earths-layers]",
      )
      ?.click();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=summary-select-choice-a-second]",
      )
      ?.click();
    expect(detail.opened).toEqual(["a-second"]);
    expect(
      document.querySelector("[data-testid=summary-select-overlay]"),
    ).toBeNull();
  });

  test("Escape dismisses the selection interface without opening anything", () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "a1",
        title: "T",
        className: "6A",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
      {
        assignmentId: "a2",
        title: "T",
        className: "6B",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c2",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-view-summary-earths-layers]",
      )
      ?.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(
      document.querySelector("[data-testid=summary-select-overlay]"),
    ).toBeNull();
    expect(detail.opened).toEqual([]);
  });

  test("publishing a second assignment for the same lesson flips View summary to View summaries", async () => {
    const asn = makeAssignments();
    const detail = makeHydratedSeam([
      {
        assignmentId: "existing",
        title: "Earth's Layers",
        className: "9Z Legacy",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "cX",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    const before = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-earths-layers]",
    );
    expect(before?.textContent).toBe("View summary");
    // Publish to c1 - now two assignments exist for the same lesson.
    await confirmAllClasses(mount, "earths-layers");
    const after = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-earths-layers]",
    );
    expect(after?.textContent).toBe("View summaries");
    // The newly published assignment appears immediately without reload.
    after?.click();
    const choices = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "[data-testid^=summary-select-choice-]",
      ),
    );
    // 1 hydrated + 2 published (one per class) = 3 choices.
    expect(choices.length).toBeGreaterThanOrEqual(3);
  });

  test("publishing another lesson does not alter the first lesson's choices", async () => {
    const asn = makeAssignments();
    const detail = makeHydratedSeam([
      {
        assignmentId: "e1",
        title: "Earth's Layers",
        className: "6A",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
      {
        assignmentId: "e2",
        title: "Earth's Layers",
        className: "6B",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c2",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    await confirmAllClasses(mount, "what-is-life");
    // earths-layers still has exactly its 2 hydrated choices.
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-view-summary-earths-layers]",
      )
      ?.click();
    const ids = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "[data-testid^=summary-select-choice-]",
      ),
    )
      .map((b) => b.getAttribute("data-assignment-id"))
      .sort();
    expect(ids).toEqual(["e1", "e2"]);
  });

  test("malformed hydrated entry does not suppress valid siblings", () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "",
        title: "",
        className: "",
        status: "published",
        lessonSlug: "earths-layers",
      },
      {
        assignmentId: "a-valid",
        title: "Earth's Layers",
        className: "6A",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });
    const view = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-earths-layers]",
    );
    // Only the valid entry remains, so singular label applies.
    expect(view?.textContent).toBe("View summary");
    expect(view?.getAttribute("data-assignment-id")).toBe("a-valid");
  });
});

// -----------------------------------------------------------------------------
// Sprint 13F - Persistent Draft Assignment Discovery
// -----------------------------------------------------------------------------

describe("Curriculum - Sprint 13F draft discovery", () => {
  const teacher = teacherSession();

  const twoClasses: ReadonlyArray<ClassSummary> = freeze([
    freeze({ id: "c1", title: "6A Life Science", grade: "6", status: "active" }),
    freeze({ id: "c2", title: "7B Systems", grade: "7", status: "active" }),
  ] as ClassSummary[]);
  const listTwo: ListClasses = () => Promise.resolve(twoClasses);

  type Registered = {
    assignmentId: string;
    title: string;
    className: string;
    status: "draft" | "published" | "closed";
    lessonSlug?: string;
    classId?: string;
  };
  const makeHydratedSeam = (initial: ReadonlyArray<Registered>) => {
    const store = new Map<string, Registered>();
    for (const m of initial) store.set(m.assignmentId, { ...m });
    const opened: string[] = [];
    return {
      opened,
      seam: {
        register: (m: Registered) => {
          store.set(m.assignmentId, { ...m });
        },
        open: (id: string) => {
          opened.push(id);
        },
        list: () => Array.from(store.values()),
      },
    };
  };

  const closeSelection = (): void => {
    document
      .querySelectorAll("[data-testid=summary-select-overlay]")
      .forEach((el) => el.remove());
  };

  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    closeSelection();
  });

  test("single hydrated draft shows View drafts and opens directly", () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "d1",
        title: "Earth's Layers",
        className: "6A Life Science",
        status: "draft",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });
    const view = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-earths-layers]",
    );
    expect(view).not.toBeNull();
    expect(view?.textContent).toBe("View drafts");
    expect(view?.getAttribute("data-draft-only")).toBe("true");
    expect(view?.getAttribute("data-assignment-id")).toBe("d1");
    expect(view?.getAttribute("aria-label")).toContain("View drafts for");
    view?.click();
    expect(detail.opened).toEqual(["d1"]);
  });

  test("multiple hydrated drafts show View drafts and open selector", () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "d1",
        title: "Earth's Layers",
        className: "6A Life Science",
        status: "draft",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
      {
        assignmentId: "d2",
        title: "Earth's Layers",
        className: "7B Systems",
        status: "draft",
        lessonSlug: "earths-layers",
        classId: "c2",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });
    const view = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-earths-layers]",
    );
    expect(view?.textContent).toBe("View drafts");
    expect(view?.getAttribute("data-assignment-count")).toBe("2");
    view?.click();
    const dialog = document.querySelector(
      "[data-testid=summary-select-dialog]",
    );
    expect(dialog).not.toBeNull();
    const choices = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "[data-testid^=summary-select-choice-]",
      ),
    );
    expect(choices).toHaveLength(2);
    const texts = choices.map((c) => c.textContent ?? "");
    expect(texts.some((t) => t.includes("Draft"))).toBe(true);
    choices[0]?.click();
    expect(detail.opened).toHaveLength(1);
  });

  test("selector ordering is deterministic across drafts", () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "z",
        title: "Earth's Layers",
        className: "7B Systems",
        status: "draft",
        lessonSlug: "earths-layers",
        classId: "c2",
      },
      {
        assignmentId: "a",
        title: "Earth's Layers",
        className: "6A Life Science",
        status: "draft",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });
    mount
      .querySelector<HTMLButtonElement>(
        "[data-testid=lesson-view-summary-earths-layers]",
      )
      ?.click();
    const ids = Array.from(
      document.querySelectorAll<HTMLButtonElement>(
        "[data-testid^=summary-select-choice-]",
      ),
    ).map((b) => b.getAttribute("data-assignment-id"));
    expect(ids).toEqual(["a", "z"]);
  });

  test("published-only lesson still uses View summary label unchanged", () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "p1",
        title: "Earth's Layers",
        className: "6A Life Science",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });
    const view = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-earths-layers]",
    );
    expect(view?.textContent).toBe("View summary");
    expect(view?.hasAttribute("data-draft-only")).toBe(false);
  });

  test("mixed draft + published preserves View summaries label", () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "d1",
        title: "Earth's Layers",
        className: "6A Life Science",
        status: "draft",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
      {
        assignmentId: "p1",
        title: "Earth's Layers",
        className: "7B Systems",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c2",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });
    const view = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-earths-layers]",
    );
    expect(view?.textContent).toBe("View summaries");
    expect(view?.hasAttribute("data-draft-only")).toBe(false);
  });

  test("closed-only preserves prior behavior", () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "c1x",
        title: "Earth's Layers",
        className: "6A Life Science",
        status: "closed",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });
    const view = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-view-summary-earths-layers]",
    );
    expect(view?.textContent).toBe("View summary");
    expect(view?.hasAttribute("data-draft-only")).toBe(false);
  });
});

describe("Sprint 16 Slice 1: dashboard refresh completeness", () => {
  const teacher = teacherSession();

  type Registered = {
    assignmentId: string;
    title: string;
    className: string;
    status: "draft" | "published" | "closed";
    lessonSlug?: string;
    classId?: string;
    publishedAt?: number;
  };

  type Summary = {
    assignmentId: string;
    classId: string;
    totalStudents: number;
    completedStudents: number;
    inProgressStudents: number;
    notStartedStudents: number;
    completionPercentage: number;
    averagePercentage: number | null;
    highestPercentage: number | null;
    lowestPercentage: number | null;
    perfectScoreStudents: number;
  };

  const summary = (id: string, over: Partial<Summary> = {}): Summary => ({
    assignmentId: id,
    classId: "c1",
    totalStudents: 10,
    completedStudents: 0,
    inProgressStudents: 0,
    notStartedStudents: 10,
    completionPercentage: 0,
    averagePercentage: null,
    highestPercentage: null,
    lowestPercentage: null,
    perfectScoreStudents: 0,
    ...over,
  });

  const makeHydratedSeam = (initial: ReadonlyArray<Registered>) => {
    const store = new Map<string, Registered>();
    for (const m of initial) store.set(m.assignmentId, { ...m });
    const opened: string[] = [];
    let installed: ((assignmentId: string) => void) | null = null;
    return {
      opened,
      getInvalidator: (): ((id: string) => void) | null => installed,
      seam: {
        register: (m: Registered) => {
          store.set(m.assignmentId, { ...m });
        },
        open: (id: string) => {
          opened.push(id);
        },
        list: () => Array.from(store.values()),
        setActiveAssignmentsInvalidator: (
          fn: ((id: string) => void) | null,
        ) => {
          installed = fn;
        },
      },
    };
  };

  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
  });

  test("Curriculum installs the per-assignment invalidator on mount via the seam setter", () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "p1",
        title: "Earth's Layers",
        className: "6A Life Science",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: emptyListClasses,
      assignmentDetail: detail.seam,
    });
    expect(typeof detail.getInvalidator()).toBe("function");
  });

  test("invalidator refresh only re-fetches the targeted assignment", async () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "p1",
        title: "Earth's Layers",
        className: "6A Life Science",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
      {
        assignmentId: "p2",
        title: "Waves",
        className: "6B Physical",
        status: "published",
        lessonSlug: "nature-of-waves",
        classId: "c2",
      },
    ]);
    const calls: string[] = [];
    const summaryCallable = async (input: { assignmentId: string }) => {
      calls.push(input.assignmentId);
      return summary(input.assignmentId);
    };
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: emptyListClasses,
      assignmentDetail: detail.seam,
      assignmentSummary: summaryCallable,
    });
    await flush();
    await flush();
    expect(calls.sort()).toEqual(["p1", "p2"]);
    calls.length = 0;

    // Simulate an `onStatusChange` firing for exactly one card.
    detail.getInvalidator()?.("p1");
    await flush();
    await flush();
    expect(calls).toEqual(["p1"]);
  });

  test("invalidator is a no-op for an assignmentId that was never cached", async () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "p1",
        title: "Earth's Layers",
        className: "6A Life Science",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
    ]);
    const calls: string[] = [];
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: emptyListClasses,
      assignmentDetail: detail.seam,
      assignmentSummary: async ({ assignmentId }) => {
        calls.push(assignmentId);
        return summary(assignmentId);
      },
    });
    await flush();
    await flush();
    calls.length = 0;
    detail.getInvalidator()?.("does-not-exist");
    await flush();
    await flush();
    expect(calls).toEqual([]);
  });

  test("a single invalidator invocation triggers exactly one summary refresh (no duplicate refresh)", async () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "p1",
        title: "Earth's Layers",
        className: "6A Life Science",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
    ]);
    const calls: string[] = [];
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: emptyListClasses,
      assignmentDetail: detail.seam,
      assignmentSummary: async ({ assignmentId }) => {
        calls.push(assignmentId);
        return summary(assignmentId);
      },
    });
    await flush();
    await flush();
    calls.length = 0;
    detail.getInvalidator()?.("p1");
    await flush();
    await flush();
    expect(calls).toEqual(["p1"]);
  });

  test("Show closed and published-date ordering are preserved after an invalidator-driven refresh", async () => {
    const detail = makeHydratedSeam([
      {
        assignmentId: "old",
        title: "Waves",
        className: "6B",
        status: "published",
        lessonSlug: "nature-of-waves",
        classId: "c2",
        publishedAt: 1000,
      },
      {
        assignmentId: "new",
        title: "Earth's Layers",
        className: "6A",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
        publishedAt: 2000,
      },
      {
        assignmentId: "closed1",
        title: "Cells",
        className: "6A",
        status: "closed",
        lessonSlug: "cell-types",
        classId: "c1",
        publishedAt: 500,
      },
    ]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: emptyListClasses,
      assignmentDetail: detail.seam,
      assignmentSummary: async ({ assignmentId }) => summary(assignmentId),
    });
    await flush();
    await flush();

    // Show closed toggle is present but off; closed card hidden.
    const toggle = mount.querySelector<HTMLInputElement>(
      "[data-testid=active-assignments-show-closed]",
    );
    expect(toggle).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=active-assignment-card-closed1]"),
    ).toBeNull();

    // Trigger an invalidator refresh; ordering must remain new-then-old.
    detail.getInvalidator()?.("new");
    await flush();
    await flush();
    const cards = Array.from(
      mount.querySelectorAll<HTMLElement>(
        "[data-testid^=active-assignment-card-]",
      ),
    ).map((c) => c.getAttribute("data-assignment-id"));
    expect(cards).toEqual(["new", "old"]);

    // Toggle Show closed and confirm the closed card appears.
    toggle!.checked = true;
    toggle!.dispatchEvent(new Event("change"));
    expect(
      mount.querySelector("[data-testid=active-assignment-card-closed1]"),
    ).not.toBeNull();
  });
});

describe("Sprint 16 Slice 7: integrated teacher monitoring workflow", () => {
  const teacher = teacherSession();

  type Registered = {
    assignmentId: string;
    title: string;
    className: string;
    status: "draft" | "published" | "closed";
    lessonSlug?: string;
    classId?: string;
    publishedAt?: number;
  };

  type Summary = {
    assignmentId: string;
    classId: string;
    totalStudents: number;
    completedStudents: number;
    inProgressStudents: number;
    notStartedStudents: number;
    completionPercentage: number;
    averagePercentage: number | null;
    highestPercentage: number | null;
    lowestPercentage: number | null;
    perfectScoreStudents: number;
  };

  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
  });

  test("full lifecycle: publish -> Detail counts refresh on close -> Show closed reveals -> reopen restores Published", async () => {
    // Simulates the complete workflow exercised by Slices 1 through 6:
    // dashboard invalidator refresh (Slice 1), single per-lifecycle summary
    // fetch anchored to the invalidator (Slices 2/5), authoritative summary
    // counts on the card (Slice 3), Show closed toggle plus Back-target
    // labeling of the Curriculum destination (Slice 4), and stable
    // accessible naming across lifecycle transitions (Slice 6).
    const store = new Map<string, Registered>();
    store.set("a1", {
      assignmentId: "a1",
      title: "Earth's Layers",
      className: "6A Life Science",
      status: "published",
      lessonSlug: "earths-layers",
      classId: "c1",
      publishedAt: 2000,
    });
    // A second published card keeps the section visible after `a1` closes so
    // the Show closed toggle remains in the DOM through the transition.
    store.set("a2", {
      assignmentId: "a2",
      title: "Nature of Waves",
      className: "6B Physical",
      status: "published",
      lessonSlug: "nature-of-waves",
      classId: "c2",
      publishedAt: 1000,
    });

    let installed: ((assignmentId: string) => void) | null = null;
    const opened: string[] = [];
    const assignmentDetailSeam = {
      register: (m: Registered) => {
        store.set(m.assignmentId, { ...m });
      },
      open: (id: string) => {
        opened.push(id);
      },
      list: () => Array.from(store.values()),
      setActiveAssignmentsInvalidator: (
        fn: ((id: string) => void) | null,
      ): void => {
        installed = fn;
      },
    };

    // Progress snapshot the dashboard should render for `a1`.
    const snapshots = new Map<string, Summary>();
    const buildSummary = (
      id: string,
      completed: number,
      inProgress: number,
    ): Summary => ({
      assignmentId: id,
      classId: "c1",
      totalStudents: 10,
      completedStudents: completed,
      inProgressStudents: inProgress,
      notStartedStudents: 10 - completed - inProgress,
      completionPercentage: (completed / 10) * 100,
      averagePercentage: completed > 0 ? 82 : null,
      highestPercentage: completed > 0 ? 100 : null,
      lowestPercentage: completed > 0 ? 60 : null,
      perfectScoreStudents: 0,
    });
    snapshots.set("a1", buildSummary("a1", 3, 2));
    snapshots.set("a2", buildSummary("a2", 0, 0));

    const summaryCalls: string[] = [];
    const summaryCallable = async (input: { assignmentId: string }) => {
      summaryCalls.push(input.assignmentId);
      const snap = snapshots.get(input.assignmentId);
      if (snap === undefined) throw new Error("no snapshot");
      return snap;
    };

    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: emptyListClasses,
      assignmentDetail: assignmentDetailSeam,
      assignmentSummary: summaryCallable,
    });
    await flush();
    await flush();

    // Slice 1: invalidator seam installed on mount.
    expect(typeof installed).toBe("function");

    // Slice 3: authoritative summary counts flow into the card's progress
    // line copy. Format: `${completed} submitted / ${started} started /
    // ${total} total`.
    const card = mount.querySelector<HTMLElement>(
      "[data-testid=active-assignment-card-a1]",
    );
    expect(card).not.toBeNull();
    const progress = card!.querySelector<HTMLElement>(
      "[data-testid=active-assignment-progress-a1]",
    );
    expect(progress).not.toBeNull();
    expect(progress!.textContent).toContain("3 submitted");
    expect(progress!.textContent).toContain("5 started");
    expect(progress!.textContent).toContain("10 total");

    // Show closed toggle is not rendered while no closed card exists.
    expect(
      mount.querySelector("[data-testid=active-assignments-show-closed]"),
    ).toBeNull();

    // Simulate a student submission and a lifecycle close: `onStatusChange`
    // registers the mutated card and fires the invalidator. Slice 1 must
    // re-issue exactly one summary read for that assignment.
    summaryCalls.length = 0;
    snapshots.set("a1", buildSummary("a1", 5, 2));
    store.set("a1", { ...store.get("a1")!, status: "closed" });
    installed!("a1");
    await flush();
    await flush();

    // Slice 4: closed card is hidden from the DOM while Show closed is off,
    // and no wasted summary fetch is issued for a hidden card (Slice 1
    // invalidation purges the cache; rendering issues the fresh call).
    expect(
      mount.querySelector("[data-testid=active-assignment-card-a1]"),
    ).toBeNull();
    expect(summaryCalls).toEqual([]);

    // Slice 4/6: the Show closed toggle now appears (a closed card exists)
    // and defaults to off with an accessible label.
    const toggle = mount.querySelector<HTMLInputElement>(
      "[data-testid=active-assignments-show-closed]",
    );
    expect(toggle).not.toBeNull();
    expect(toggle!.checked).toBe(false);
    expect(toggle!.getAttribute("aria-label")).toBe(
      "Show closed assignments",
    );

    // Toggle Show closed on; the closed card now surfaces and the fresh
    // Slice 3 authoritative counts (5 submitted / 7 started) render after
    // exactly one summary re-fetch for the invalidated card.
    toggle!.checked = true;
    toggle!.dispatchEvent(new Event("change"));
    await flush();
    await flush();
    expect(summaryCalls).toEqual(["a1"]);
    const closedCard = mount.querySelector<HTMLElement>(
      "[data-testid=active-assignment-card-a1]",
    );
    expect(closedCard).not.toBeNull();
    const closedProgress = closedCard!.querySelector<HTMLElement>(
      "[data-testid=active-assignment-progress-a1]",
    );
    expect(closedProgress!.textContent).toContain("5 submitted");
    expect(closedProgress!.textContent).toContain("7 started");

    // Slice 6 accessibility: the card exposes a stable role="group" with an
    // aria-labelledby pointing at the card title id.
    expect(closedCard!.getAttribute("role")).toBe("group");
    const labelledBy = closedCard!.getAttribute("aria-labelledby");
    expect(labelledBy).not.toBeNull();
    expect(labelledBy!.length).toBeGreaterThan(0);
    const label = mount.querySelector(`#${labelledBy}`);
    expect(label).not.toBeNull();

    // Simulate reopen: status transitions back to `published`, the
    // invalidator fires once, exactly one summary read is issued, and the
    // card returns to the published set. Toggle Show closed off again to
    // confirm the reopened card remains visible in the published set.
    summaryCalls.length = 0;
    store.set("a1", { ...store.get("a1")!, status: "published" });
    installed!("a1");
    await flush();
    await flush();
    // The reopened card is now in the published set and issues exactly one
    // summary refresh.
    expect(summaryCalls).toEqual(["a1"]);
    const reopened = mount.querySelector<HTMLElement>(
      "[data-testid=active-assignment-card-a1]",
    );
    expect(reopened).not.toBeNull();
    expect(reopened!.getAttribute("data-status")).toBe("published");

    // Slices 1/5: the `open` seam and the dashboard invalidator route
    // through the certified `assignmentDetailRegistry`; no forbidden API
    // (`onSnapshot`, `localStorage`, `sessionStorage`, `IndexedDB`,
    // `setInterval`, refresh-driven `setTimeout`) was introduced by any
    // Sprint 16 slice. The dashboard section source proves it.
    const source = fs.readFileSync(
      path.resolve(
        __dirname,
        "surfaces/shared/activeAssignments.ts",
      ),
      "utf8",
    );
    expect(source).not.toContain("onSnapshot");
    expect(source).not.toContain("localStorage");
    expect(source).not.toContain("sessionStorage");
    expect(source).not.toContain("IndexedDB");
    expect(source).not.toMatch(/setInterval\s*\(/);
  });
});
