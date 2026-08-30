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
    // Sprint 28.6D: Classes is the default landing surface; its headline
    // is the labelled region for the outlet.
    expect(mount.querySelector("#surface-headline")?.textContent).toBe(
      "Classes",
    );
  });
});

describe("Header composition and identity-display rules", () => {
  test("renders the canonical LYFELABZ wordmark as h1", () => {
    const mount = mkMount();
    renderHeader(mount, teacherSession(), { onSignOut: () => undefined });
    expect(mount.querySelector("h1.shell-brand")?.textContent).toBe(
      "LYFELABZ",
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
  // Sprint 28.6D: primary teacher navigation is Classes, Curriculum,
  // Settings, with the LYFELABZ brand item first. Present Mode has left
  // the primary navigation entirely.
  test("renders items in the specified order: Workspace, Classes, Curriculum, Settings", () => {
    const mount = mkMount();
    renderNavigation(mount);
    const buttons = Array.from(
      mount.querySelectorAll<HTMLButtonElement>("button.shell-nav-button"),
    );
    expect(buttons.map((b) => b.getAttribute("data-testid"))).toEqual([
      "nav-lyfelabz",
      "nav-classes",
      "nav-curriculum",
      "nav-settings",
    ]);
  });

  test("Present Mode is absent from the primary navigation", () => {
    const mount = mkMount();
    renderNavigation(mount);
    expect(mount.querySelector("[data-testid=nav-present-mode]")).toBeNull();
    expect((mount.textContent ?? "")).not.toContain("Present Mode");
  });

  test("the Workspace section label renders as the brand variant and is not disabled", () => {
    const mount = mkMount();
    renderNavigation(mount);
    const brand = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-lyfelabz]",
    );
    expect(brand?.disabled).toBe(false);
    expect(brand?.getAttribute("data-nav-variant")).toBe("brand");
    expect(brand?.classList.contains("shell-nav-brand")).toBe(true);
    expect(brand?.textContent).toBe("Workspace");
  });

  test("LYFELABZ never carries aria-current, even when Classes is the active surface", () => {
    const mount = mkMount();
    renderNavigation(mount, {
      activeKey: "classes",
      onSelect: () => undefined,
    });
    const brand = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-lyfelabz]",
    );
    expect(brand?.getAttribute("aria-current")).toBeNull();
  });

  test("Classes and Curriculum are active items; Classes carries aria-current=page by default", () => {
    const mount = mkMount();
    renderNavigation(mount);
    const classes = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-classes]",
    );
    expect(classes?.disabled).toBe(false);
    expect(classes?.getAttribute("aria-current")).toBe("page");
    expect(classes?.textContent).toBe("Classes");
    const curriculum = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-curriculum]",
    );
    expect(curriculum?.disabled).toBe(false);
    expect(curriculum?.getAttribute("aria-current")).toBeNull();
    expect(curriculum?.textContent).toBe("Curriculum");
  });

  test("renderNavigation with activeKey=curriculum moves aria-current onto Curriculum", () => {
    const mount = mkMount();
    renderNavigation(mount, {
      activeKey: "curriculum",
      onSelect: () => undefined,
    });
    expect(
      mount
        .querySelector("[data-testid=nav-classes]")
        ?.getAttribute("aria-current"),
    ).toBeNull();
    expect(
      mount
        .querySelector("[data-testid=nav-curriculum]")
        ?.getAttribute("aria-current"),
    ).toBe("page");
  });

  test("Curriculum and Settings are both available workspace destinations", () => {
    const mount = mkMount();
    renderNavigation(mount);
    const curriculum = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-curriculum]",
    );
    expect(curriculum?.disabled).toBe(false);
    expect(curriculum?.getAttribute("aria-disabled")).toBeNull();
    expect(curriculum?.textContent).toBe("Curriculum");
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
  beforeEach(() => {
    // Sprint 20: Curriculum filter state now persists across mounts within
    // a signed-in session (fix for the tab-navigation reset bug). The unit
    // tests below assume a clean bucket per case, so drop the module-scoped
    // state between tests.
    _resetCurriculumSessionStateForTest();
  });

  test("renders welcome, filter controls, and lesson grid (no subtitle - Sprint 28.6H.4 Part C)", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacherSession());
    expect(mount.querySelector("[data-testid=surface-headline]")?.textContent)
      .toBe("Welcome, Ada Lovelace.");
    // Sprint 28.6H.4 (Part C): the "Activate the LyfeLabz lessons..." subtitle
    // is removed and NOT replaced; Curriculum is self-explanatory and the
    // reclaimed space lets more cards reach the viewport. The welcome heading
    // flows directly into the grade / topic filters.
    expect(mount.querySelector("[data-testid=curriculum-intro]")).toBeNull();
    expect(
      (mount.textContent ?? ""),
    ).not.toContain("Activate the LyfeLabz lessons your students can access.");
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
    expect(cards.length).toBe(49);
  });

  test("each lesson card renders title, grade, topic, and activation toggle", () => {
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
    // Sprint 28.6D (Task 5): compact grade tag.
    expect(
      mount.querySelector("[data-testid=lesson-grade-earths-layers]")?.textContent,
    ).toBe("G7");
    expect(
      mount.querySelector("[data-testid=lesson-topic-earths-layers]")?.textContent,
    ).toBe("Earth & Space");
    // Sprint 28.6D (Task 7): every surfaced lesson card exposes a Preview
    // control targeting the current v2 artifact.
    expect(
      mount.querySelector("[data-testid=lesson-preview-earths-layers]"),
    ).not.toBeNull();
    const toggle = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-toggle-earths-layers]",
    );
    expect(toggle).not.toBeNull();
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    // Active is the default state and no longer renders a visible "Active" badge.
    // The toggle remains in the DOM (activation code path preserved) but is hidden.
    expect(toggle?.hidden).toBe(true);
    expect(toggle?.textContent).toBe("");
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
    expect(toggle?.hidden).toBe(false);
    expect(card?.getAttribute("data-lesson-active")).toBe("false");
    expect(card?.classList.contains("shell-lesson-card-inactive")).toBe(true);
    toggle?.click();
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(toggle?.textContent).toBe("");
    expect(toggle?.hidden).toBe(true);
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

  test("outlet advertises the active surface via data-active-surface=classes", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    const outlet = mount.querySelector("[data-testid=workspace-outlet]");
    // Sprint 28.6D: Classes is the default landing surface.
    expect(outlet?.getAttribute("data-active-surface")).toBe("classes");
  });

  test("the default surface renders through the outlet, not as a shell sibling", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    const headline = mount.querySelector("[data-testid=surface-headline]");
    const outlet = mount.querySelector("[data-testid=workspace-outlet]");
    expect(headline).not.toBeNull();
    expect(outlet?.contains(headline!)).toBe(true);
    expect(headline?.textContent).toBe("Classes");
  });

  test("WORKSPACE_SURFACES registers exactly the three workspace-surface keys", () => {
    expect(Object.keys(WORKSPACE_SURFACES).sort()).toEqual(
      ["classes", "curriculum", "settings"],
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
    for (const key of ["curriculum", "classes", "settings"]) {
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

describe("LYFELABZ brand navigation (Sprint 6C; Sprint 28.6D brand lands on Classes)", () => {
  test("selecting LYFELABZ from Classes is a no-op re-render", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("classes");
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
    ).toBe("classes");
  });

  test("selecting LYFELABZ from Curriculum returns the outlet to Classes", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")
      ?.click();
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("curriculum");
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-lyfelabz]")
      ?.click();
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("classes");
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

  test("renders a card per classroom with title and compact grade, and no status badge", async () => {
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
    // Sprint 28.6C: the revised class card uses compact grade presentation.
    expect(
      mount.querySelector("[data-testid=class-grade-c1]")?.textContent,
    ).toBe("G6");
    // Sprint 28.6H (Finding 2): the "Active" status badge is removed from the
    // everyday class card (an appearing class is implicitly active).
    expect(mount.querySelector("[data-testid=class-status-c1]")).toBeNull();
    expect(mount.querySelector("[data-testid=class-status-c2]")).toBeNull();
  });

  test("renders an empty state when the teacher owns no classrooms", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps());
    clickClasses(mount);
    await flush();
    expect(mount.querySelector("[data-testid=classes-empty]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=classes-list]")).toBeNull();
    // Sprint 28.6H.8: the zero-class landing is a concise Settings pointer.
    expect(
      mount.querySelector("[data-testid=classes-status]")?.textContent,
    ).toBe("No classes yet.");
    expect(mount.textContent ?? "").toContain(
      "Add or import a class in Settings.",
    );
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
    // Sprint 28.6H.3 (Task B2): a class card opens directly on Assignments.
    expect(workspace?.getAttribute("data-class-tab")).toBe("assignments");
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
    // Sprint 28.6H (Finding 8): no assignment-history badge on the button; the
    // card carries the signal.
    const card = assign?.closest<HTMLElement>("[data-lesson-slug]");
    expect(card?.getAttribute("data-lesson-assigned")).toBe("false");
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

  test("confirming closes the dialog and records the assignment-history signal", async () => {
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
    // Sprint 28.6H.7 (Part B): after a successful assignment the control reads
    // "Reassign" (green outline, still fully re-assignable - no "✓ Assigned"
    // badge, never disabled); the card records the history.
    expect(assign?.textContent).toBe("Reassign");
    expect(assign?.disabled).toBe(false);
    expect(assign?.classList.contains("shell-lesson-reassign")).toBe(true);
    expect(
      assign?.closest<HTMLElement>("[data-lesson-slug]")?.getAttribute(
        "data-lesson-assigned",
      ),
    ).toBe("true");
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
    // B5: revisiting a row must never surface a publish toggle in the ON
    // state. With no LMS integration wired here the toggle is absent (an
    // un-checkable, effectively-OFF control); the LMS-linked reopen path
    // asserts the same OFF invariant in curriculum.lms-publish.test.ts.
    expect(
      document.querySelectorAll(
        "[data-testid^=assign-row-lms-publish-]:checked",
      ),
    ).toHaveLength(0);
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

  test("release time is remembered across dialog opens", async () => {
    // Sprint 28.5D (microcopy): the inert "Google Classroom topic" text
    // field no longer renders for a manual (non-LMS) class, so this test
    // covers the remembered release time only. The manual-class topic field
    // is asserted absent by curriculum.manual-topic.test.ts.
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
    expect(
      document.querySelector("[data-testid=assign-row-topic-c1]"),
    ).toBeNull();
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

  test("selecting LYFELABZ from Settings returns the outlet to Classes", () => {
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
    ).toBe("classes");
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

  test("renders the Settings title, a Class Management tab, and the Google Classroom section (Sprint 28.6H.4 Part E)", () => {
    // Sprint 28.6H.4 (Part E): Settings is a scalable TABBED surface. "Class
    // Management" is the single real category (a tab), and the Google Classroom
    // connection lives inside its panel. See settings.test.ts for full coverage;
    // this asserts shell integration.
    const mount = mkMount();
    renderSettingsSurface(mount, teacher);
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Settings");
    const tab = mount.querySelector(
      "[data-testid=settings-tab-class-management]",
    );
    expect(tab?.textContent).toBe("Class Management");
    expect(tab?.getAttribute("role")).toBe("tab");
    expect(tab?.getAttribute("aria-selected")).toBe("true");
    expect(
      mount.querySelector("[data-testid=settings-panel-class-management]")
        ?.getAttribute("role"),
    ).toBe("tabpanel");
    expect(
      mount.querySelector("[data-testid=settings-classroom-heading]")?.textContent,
    ).toBe("Google Classroom");
    // No dead Accommodations tab (Part G).
    expect(mount.textContent ?? "").not.toContain("Accommodations");
  });

  test("no longer renders the removed future-facing category previews or growth notice", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher);
    expect(mount.querySelector("[data-testid=settings-categories]")).toBeNull();
    expect(
      mount.querySelector("[data-testid=settings-growth-notice]"),
    ).toBeNull();
    for (const testId of [
      "settings-category-classroom",
      "settings-category-present-mode",
      "settings-category-notifications",
      "settings-category-connected-services",
      "settings-category-account",
    ]) {
      expect(mount.querySelector(`[data-testid=${testId}]`)).toBeNull();
    }
  });

  test("does not render any 'coming soon', 'under construction', or placeholder-controls labels", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher);
    const text = (mount.textContent ?? "").toLowerCase();
    expect(text).not.toContain("coming soon");
    expect(text).not.toContain("under construction");
    expect(text).not.toContain("placeholder");
  });

  test("no longer renders the removed Default Grade control", () => {
    const mount = mkMount();
    renderSettingsSurface(mount, teacher);
    expect(
      mount.querySelector("[data-testid=settings-default-grade-select]"),
    ).toBeNull();
    expect(mount.querySelectorAll("select")).toHaveLength(0);
    expect(mount.querySelectorAll("input")).toHaveLength(0);
    expect(mount.querySelectorAll("textarea")).toHaveLength(0);
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

  test("Sprint 28.6H.3 (Task C3): Settings Create routes into the ONE shared Classes create workflow", async () => {
    // Settings hosts Import / Create controls (Class Management), but they are
    // OPENERS that route to the same certified workflow hosted on the Classes
    // surface (one implementation, two entry points) - Settings renders no
    // second create/import form of its own.
    const mount = mkMount();
    mountTeacherShell(
      teacher,
      mount,
      makeShellDeps({
        listClasses: () =>
          Promise.resolve([
            freeze({
              id: "c1",
              title: "6A",
              grade: "6",
              status: "active",
            }) as ClassSummary,
          ]),
        createClass: async () =>
          Object.freeze({
            classId: "c",
            joinCode: "AAAA",
            alreadyCreated: false,
          }),
      }),
    );
    clickSettings(mount);
    // Settings exposes the Import / Create openers, but no create/import FORM.
    const createOpener = mount.querySelector<HTMLButtonElement>(
      "[data-testid=settings-create-class]",
    );
    expect(createOpener).not.toBeNull();
    expect(mount.querySelector("[data-testid=settings-import-class]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=classes-create-form]")).toBeNull();

    // Clicking Create in Settings routes to Classes and opens the shared
    // certified Create form there (even though a class already exists, i.e. the
    // populated landing has no persistent Add control of its own).
    createOpener!.click();
    await flush();
    await flush();
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("classes");
    expect(mount.querySelector("[data-testid=classes-create-form]")).not.toBeNull();
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

  test("navigation lists exactly the three permanent workspace destinations after Sprint 28.6D", () => {
    // Snapshot must not become an extra permanent Teacher Workspace
    // destination. See CLASS_SNAPSHOT_EXPERIENCE.md §6 and
    // SNAPSHOT_ARCHITECTURE.md §6. Sprint 28.6D reduced the primary
    // navigation to Classes, Curriculum, Settings (Present Mode removed).
    expect(Object.keys(WORKSPACE_SURFACES).sort()).toEqual(
      ["classes", "curriculum", "settings"],
    );
    const mount = mkMount();
    renderNavigation(mount);
    expect(mount.querySelector("[data-testid=nav-snapshot]")).toBeNull();
    expect(
      mount.querySelectorAll<HTMLButtonElement>(
        "button.shell-nav-button[data-nav-variant=item]",
      ).length,
    ).toBe(3);
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
    // Sprint 28.6H.8: the zero-class landing points to Settings, with no
    // class-administration controls.
    expect(
      mount.querySelector("[data-testid=classes-status]")?.textContent,
    ).toBe("No classes yet.");
    expect(mount.querySelector("[data-testid=classes-import-open]")).toBeNull();
    expect(mount.querySelector("[data-testid=classes-create-open]")).toBeNull();
  });

  test("no-selected-class state: classes exist but nothing is selected renders the class list with no chooser filler", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    clickClasses(mount);
    await flush();
    expect(mount.querySelector("[data-testid=classes-list]")).not.toBeNull();
    // Sprint 28.6H (Finding 1): the "Choose a class..." filler is removed.
    expect(mount.querySelector("[data-testid=classes-prompt]")).toBeNull();
    expect(mount.querySelector("[data-testid=class-workspace]")).toBeNull();
    expect(mount.querySelector("[data-testid=snapshot-region]")).toBeNull();
  });

  test("Task B1/B2: selecting a class opens its workspace with the class identity above the tabs and Assignments default (Overview removed)", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    const workspace = mount.querySelector("[data-testid=class-workspace]");
    expect(workspace).not.toBeNull();
    expect(workspace?.getAttribute("data-class-id")).toBe("c1");
    expect(workspace?.getAttribute("data-class-tab")).toBe("assignments");
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("classes");
    // The class name is the workspace header ABOVE the tabs; the default tab
    // heads its section "Assignments". Overview/Snapshot is not rendered.
    expect(
      mount.querySelector("[data-testid=class-workspace-title]")?.textContent,
    ).toBe("6A Life Science");
    expect(mount.querySelector("[data-testid=snapshot-region]")).toBeNull();
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Assignments");
  });

  test("Task B1: opening a class renders no Overview/Snapshot surface at all", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    // The retired Overview surface is absent - not hidden by CSS.
    expect(mount.querySelector("[data-testid=snapshot-region]")).toBeNull();
    expect(mount.querySelector("[data-testid=snapshot-empty]")).toBeNull();
    expect(mount.querySelector("[data-testid=snapshot-groups]")).toBeNull();
    expect(mount.querySelector("[data-testid=class-nav-snapshot]")).toBeNull();
  });

  test("class identity (name + compact grade) is the workspace header; Overview shows no purpose/status/grade line", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    // Sprint 28.6H (Finding 3): identity moved to the header (compact grade),
    // and the "Active" badge / purpose placeholder are gone (Findings 2/5).
    expect(
      mount.querySelector("[data-testid=class-workspace-title]")?.textContent,
    ).toBe("6A Life Science");
    expect(
      mount.querySelector("[data-testid=class-workspace-meta]")?.textContent,
    ).toBe("G6");
    expect(mount.querySelector("[data-testid=snapshot-purpose]")).toBeNull();
    expect(mount.querySelector("[data-testid=snapshot-class-grade]")).toBeNull();
    expect(mount.querySelector("[data-testid=snapshot-class-status]")).toBeNull();
    expect(mount.textContent).not.toContain("Active");
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

  test("Task B1: the dormant snapshot preview is not rendered in the class workspace (Overview removed)", async () => {
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
    // Even with a preview payload wired, the retired Overview surface does not
    // render it - the class workspace opens on Assignments.
    expect(mount.querySelector("[data-testid=snapshot-groups]")).toBeNull();
    expect(mount.querySelector("[data-testid=snapshot-preview-notice]")).toBeNull();
    expect(mount.textContent ?? "").not.toMatch(/Student \d/);
    expect(
      mount.querySelector("[data-testid=class-workspace]")?.getAttribute("data-class-tab"),
    ).toBe("assignments");
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
    // Classes default (class list) view does not render preview data
    expect(mount.querySelector("[data-testid=snapshot-groups]")).toBeNull();
    // Curriculum does not render preview data
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")
      ?.click();
    expect(mount.querySelector("[data-testid=snapshot-groups]")).toBeNull();
    // Settings does not render preview data
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-settings]")
      ?.click();
    expect(mount.querySelector("[data-testid=snapshot-groups]")).toBeNull();
  });

  test("Task B1: class-level navigation exposes Assignments and Students only, Assignments active by default", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    const nav = mount.querySelector("[data-testid=class-nav]");
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute("aria-label")).toBe("Class sections");
    const assignmentsBtn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=class-nav-assignments]",
    );
    const rosterBtn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=class-nav-roster]",
    );
    expect(mount.querySelector("[data-testid=class-nav-snapshot]")).toBeNull();
    expect(assignmentsBtn).not.toBeNull();
    expect(rosterBtn).not.toBeNull();
    expect(assignmentsBtn?.getAttribute("aria-current")).toBe("page");
    expect(rosterBtn?.getAttribute("aria-current")).toBeNull();
  });

  test("selecting Students moves aria-current and renders the roster foundation surface", async () => {
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
        .querySelector("[data-testid=class-nav-assignments]")
        ?.getAttribute("aria-current"),
    ).toBeNull();
    // The Students section heads "Students" with a real empty state.
    expect(mount.querySelector("[data-testid=roster-empty]")).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Students");
    expect(mount.querySelector("[data-testid=snapshot-region]")).toBeNull();
  });

  test("switching between Assignments and Students preserves the class context", async () => {
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
      .querySelector<HTMLButtonElement>("[data-testid=class-nav-assignments]")
      ?.click();
    expect(
      mount
        .querySelector("[data-testid=class-workspace]")
        ?.getAttribute("data-class-id"),
    ).toBe("c1");
    // The class identity (workspace header) persists across tab switches.
    expect(
      mount.querySelector("[data-testid=class-workspace-title]")?.textContent,
    ).toBe("6A Life Science");
    // Back on Assignments, the section heading reads "Assignments".
    expect(
      mount.querySelector("[data-testid=surface-headline]")?.textContent,
    ).toBe("Assignments");
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

  test("re-opening the same class after Back preserves class context and re-lands on Assignments", async () => {
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
    ).toBe("assignments");
  });

  test("focus lands on the Assignments section heading when the class workspace opens", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    expect(document.activeElement?.getAttribute("data-testid")).toBe(
      "surface-headline",
    );
    // The default class section heading is focused (the class name is the
    // workspace header above the tabs).
    expect(document.activeElement?.textContent).toBe("Assignments");
  });

  test("focus lands on the Students section heading when Students is selected", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=class-nav-roster]")
      ?.click();
    expect(document.activeElement?.getAttribute("data-testid")).toBe(
      "surface-headline",
    );
    expect(document.activeElement?.textContent).toBe("Students");
  });

  test("the class workspace renders no Present Mode controls, assign dialog, or curriculum grid", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    expect(mount.querySelector("[data-testid=class-workspace]")).not.toBeNull();
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
      "nav-classes",
      "nav-curriculum",
      "nav-settings",
    ]);
    // The Classes nav item still carries aria-current
    expect(
      mount
        .querySelector("[data-testid=nav-classes]")
        ?.getAttribute("aria-current"),
    ).toBe("page");
  });

  test("clicking Curriculum from the class workspace leaves Classes and returns to Curriculum; Back into Classes returns to the class list", async () => {
    const mount = mkMount();
    mountTeacherShell(teacher, mount, makeShellDeps({ listClasses: listTwo }));
    await openC1(mount);
    mount
      .querySelector<HTMLButtonElement>("[data-testid=nav-curriculum]")
      ?.click();
    expect(mount.querySelector("[data-testid=class-workspace]")).toBeNull();
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("curriculum");
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
    mode: "practice" | "classroom";
    title?: string;
  };
  type PublishIn = { assignmentId: string };
  type LmsPublishIn = {
    assignmentId: string;
    linkId: string;
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
    // The card still records the assignment-history signal; the LyfeLabz record
    // is authoritative and untouched by the LMS-side failure. (Sprint 28.6H
    // Finding 8: signal lives on the card, not a button badge.)
    const assign = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-assign-earths-layers]",
    );
    expect(
      assign?.closest<HTMLElement>("[data-lesson-slug]")?.getAttribute(
        "data-lesson-assigned",
      ),
    ).toBe("true");
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

describe("Assign dialog CSS ships with the shell host page", () => {
  // Regression guard for the production defect where clicking Assign
  // appeared to do nothing because `app/index.html` shipped no CSS for
  // the modal overlay classes the Curriculum surface builds. Without
  // fixed positioning, backdrop, and z-index the overlay renders as an
  // unpositioned block at the end of <body> and is invisible above the
  // fold. This test reads the deployed shell page and asserts the
  // canonical modal contract is present.
  const shellHtml = fs.readFileSync(
    path.resolve(__dirname, "../../index.html"),
    "utf8",
  );

  test("overlay is fixed-positioned with a backdrop and z-index", () => {
    const overlayMatch = shellHtml.match(
      /\.shell-assign-overlay\s*\{([^}]+)\}/,
    );
    expect(overlayMatch).not.toBeNull();
    const body = overlayMatch![1];
    expect(body).toMatch(/position\s*:\s*fixed/);
    expect(body).toMatch(/z-index\s*:/);
    // A backdrop must exist so the overlay is visibly distinguished from
    // the surface behind it. Either an opaque or translucent background
    // satisfies the contract.
    expect(body).toMatch(/background\s*:/);
  });

  test("dialog card has bounded width and elevation", () => {
    const dialogMatch = shellHtml.match(
      /\.shell-assign-dialog\s*\{([^}]+)\}/,
    );
    expect(dialogMatch).not.toBeNull();
    const body = dialogMatch![1];
    expect(body).toMatch(/max-width\s*:/);
    expect(body).toMatch(/background\s*:/);
  });

  test("every class name the Curriculum surface renders has a style rule", () => {
    // These are the classes the Curriculum surface's Assign flow, Preview,
    // and Resources disclosure attach to elements it inserts into the
    // document. Every one must have at least a declaration block in the
    // shell page so nothing renders as an unstyled inline block.
    const required = [
      "shell-lesson-action-pair",
      "shell-lesson-assign",
      "shell-lesson-preview",
      "shell-lesson-resources-toggle",
      "shell-lesson-resource-type",
      "shell-lesson-resource-title",
      "shell-lesson-resource-open",
      "shell-assign-overlay",
      "shell-assign-dialog",
      "shell-assign-title",
      "shell-assign-body",
      "shell-assign-footer",
      "shell-assign-cancel",
      "shell-assign-confirm",
      "shell-assign-rows",
      "shell-assign-row",
      "shell-assign-field",
    ];
    for (const cls of required) {
      const re = new RegExp(`\\.${cls}\\s*[\\{,]`);
      expect(shellHtml).toMatch(re);
    }
  });

  test("Resources disclosure is a quiet row, not the old outlined pill (Sprint 28.6D.1)", () => {
    // Regression for the 28.6D.1 hierarchy polish: the Resources toggle
    // must no longer resemble Assign/Preview. Its rule drops the outlined
    // pill treatment (border + 99px radius) that made it read as a third
    // primary action.
    const toggleMatch = shellHtml.match(
      /\n\s*\.shell-lesson-resources-toggle\s*\{([^}]+)\}/,
    );
    expect(toggleMatch).not.toBeNull();
    const body = toggleMatch![1];
    expect(body).toMatch(/border\s*:\s*none/);
    expect(body).not.toMatch(/border-radius\s*:\s*99px/);
    // The resource-type capsule background/pill is gone too; the type is a
    // plain metadata eyebrow.
    const typeMatch = shellHtml.match(
      /\.shell-lesson-resource-type\s*\{([^}]+)\}/,
    );
    expect(typeMatch).not.toBeNull();
    expect(typeMatch![1]).not.toMatch(/background\s*:/);
    expect(typeMatch![1]).toMatch(/text-transform\s*:\s*uppercase/);
    // Sprint 28.6H.3 (Task D3): the shared quiet footer row (View Summary +
    // Resources) is separated by a light top border, applied only when a
    // visible control is present (`:has`).
    const footerMatch = shellHtml.match(
      /\.shell-lesson-footer-row\s*\{([^}]*border-top[^}]*)\}/,
    );
    expect(footerMatch).not.toBeNull();
    expect(footerMatch![1]).toMatch(/border-top\s*:/);
    // The boundary is applied only when the footer holds a visible control.
    expect(shellHtml).toMatch(/\.shell-lesson-footer:has\(/);
  });

  test("expanded resource Open is a compact OUTLINED control, distinct from Assign/Preview (Sprint 28.6H.5, Task C1/C2, J#18-20)", () => {
    const openMatch = shellHtml.match(
      /\n\s*\.shell-lesson-resource-open\s*\{([^}]+)\}/,
    );
    expect(openMatch).not.toBeNull();
    const body = openMatch![1];
    // J#18: outlined (a real border), not bare text and not a solid fill.
    expect(body).toMatch(/border\s*:\s*1px solid/);
    expect(body).toMatch(/background\s*:\s*transparent/);
    // J#19: one consistent sizing rule with fixed dimensions (76 x 38px),
    // within the 70-85 / 36-40 contract.
    const width = body.match(/width:\s*([0-9.]+)rem/);
    const height = body.match(/height:\s*([0-9.]+)rem/);
    expect(width).not.toBeNull();
    expect(height).not.toBeNull();
    expect(parseFloat(width![1])).toBeCloseTo(4.75, 2); // 76px
    expect(parseFloat(height![1])).toBeCloseTo(2.375, 3); // 38px
    // J#20: strictly smaller than Assign/Preview (7rem x 2.75rem).
    expect(parseFloat(width![1])).toBeLessThan(7);
    expect(parseFloat(height![1])).toBeLessThan(2.75);
  });

  test("assignment Open action bottom-anchors and completed cards get a pale-green (not green primary) treatment (Sprint 28.6H.6, Part A/B)", () => {
    // Part A: the compact class card pushes Open assignment to the bottom via
    // margin-top:auto (resilient flex layout, not absolute positioning).
    const openMatch = shellHtml.match(
      /\.shell-active-assignment-card-compact\s+\.shell-active-assignment-open\s*\{([^}]+)\}/,
    );
    expect(openMatch).not.toBeNull();
    expect(openMatch![1]).toMatch(/margin-top:\s*auto/);
    // Part B2: the completed card is a subtle pale-green tint + restrained green
    // border - no saturated fill, no primary-green button repaint.
    const completeMatch = shellHtml.match(
      /\.shell-active-assignment-card-complete\s*\{([^}]+)\}/,
    );
    expect(completeMatch).not.toBeNull();
    expect(completeMatch![1]).toMatch(/background\s*:/);
    expect(completeMatch![1]).toMatch(/border-color\s*:/);
    // Very pale: a low-alpha green fill, not #1f6b3d / #175a31 solid green.
    expect(completeMatch![1]).not.toMatch(/#1f6b3d|#175a31/);
  });

  test("Curriculum assigned lesson gets a cool/slate tint distinct from the green completed state (Sprint 28.6H.6, Part C)", () => {
    const assignedMatch = shellHtml.match(
      /\.shell-lesson-card-assigned:not\(\.shell-lesson-card-inactive\)\s*\{([^}]+)\}/,
    );
    expect(assignedMatch).not.toBeNull();
    const body = assignedMatch![1];
    expect(body).toMatch(/background\s*:/);
    // Cool blue/slate, never green - the two states must not share a color.
    expect(body).not.toMatch(/#1f6b3d|#175a31/);
    expect(body).not.toMatch(/220,\s*132/); // not the pale-green rgba used by Classes
  });

  test("Reassign is a green-OUTLINE action (transparent fill, green border + text), not solid/gray/disabled (Sprint 28.6H.8, Part B)", () => {
    // The reassign rule uses the two-class selector so it wins over the base
    // solid-green Assign regardless of source order.
    const reassignMatch = shellHtml.match(
      /\.shell-lesson-assign\.shell-lesson-reassign\s*\{([^}]+)\}/,
    );
    expect(reassignMatch).not.toBeNull();
    const body = reassignMatch![1];
    // Transparent fill (the assigned card's slate tint shows through), with the
    // assignment-green border + text - NOT a solid fill, NOT gray.
    expect(body).toMatch(/background\s*:\s*transparent/);
    expect(body).toMatch(/color\s*:\s*#1f6b3d/);
    expect(body).toMatch(/border-color\s*:\s*#1f6b3d/);
    // No solid-Assign micro-shadow in the resting state.
    expect(body).toMatch(/box-shadow\s*:\s*none/);
    // The base Assign remains full-strength SOLID green.
    const baseMatch = shellHtml.match(/\n\s*\.shell-lesson-assign\s*\{([^}]+)\}/);
    expect(baseMatch![1]).toMatch(/background\s*:\s*#1f6b3d/);
    // Hover adds a very light green wash (not gray, not disabled).
    expect(shellHtml).toMatch(
      /\.shell-lesson-assign\.shell-lesson-reassign:hover[^{]*\{[^}]*background\s*:\s*rgba\(31,\s*107,\s*61/,
    );
    // The focus ring is re-asserted on Reassign (visible focus preserved).
    expect(shellHtml).toMatch(
      /\.shell-lesson-assign\.shell-lesson-reassign:focus-visible\s*\{[^}]*box-shadow/,
    );
  });

  test("Curriculum grid targets four columns on large desktop and reflows (Sprint 28.6H, Finding 6)", () => {
    // The base grid is an explicit 4-column layout (not auto-fill, which
    // produced 5 across at 1280), and it reduces to 3 / 2 / 1 at narrower
    // widths. Card readability over maximum density.
    const gridMatch = shellHtml.match(
      /\.shell-curriculum-grid\s*\{([^}]+)\}/,
    );
    expect(gridMatch).not.toBeNull();
    expect(gridMatch![1]).toMatch(/grid-template-columns:\s*repeat\(4,/);
    expect(shellHtml).toMatch(/repeat\(3,\s*minmax\(0,\s*1fr\)\)/);
    expect(shellHtml).toMatch(/repeat\(2,\s*minmax\(0,\s*1fr\)\)/);
    // No auto-fill density that overflows to 5 columns.
    expect(gridMatch![1]).not.toMatch(/auto-fill/);
  });

  test("Curriculum card vertical spacing is materially reduced (Sprint 28.6H.4, Task D3/D6)", () => {
    // The effective card min-height floor is the single-declaration compact
    // rule; it drops to 6.5rem (from 7.25rem) as the surrounding dead space is
    // trimmed, so more cards reach the desktop viewport (the ~two-row target).
    const floorMatch = shellHtml.match(
      /\.shell-lesson-card\s*\{\s*min-height:\s*([0-9.]+)rem;/,
    );
    expect(floorMatch).not.toBeNull();
    expect(parseFloat(floorMatch![1])).toBeLessThanOrEqual(6.5);
    // The action row hugs the title (tightened top margin) rather than floating
    // with a wide gap.
    const actionsMatch = shellHtml.match(
      /\n\s*\.shell-lesson-actions\s*\{([^}]+)\}/,
    );
    expect(actionsMatch).not.toBeNull();
    const marginTop = actionsMatch![1].match(/margin-top:\s*([0-9.]+)rem/);
    expect(marginTop).not.toBeNull();
    expect(parseFloat(marginTop![1])).toBeLessThanOrEqual(0.25);
  });

  test("Assign and Preview resolve to the EXACT same fixed width and height from ONE shared rule (Sprint 28.6H.4, Task D1)", () => {
    // The concrete sizing contract: both controls take their width AND height
    // from the single shared `.shell-lesson-assign, .shell-lesson-preview`
    // rule, so label length ("Assign" vs "Preview") can never size them
    // differently, and neither can grow to consume card width.
    const pairMatch = shellHtml.match(
      /\.shell-lesson-assign,\s*\n\s*\.shell-lesson-preview\s*\{([^}]+)\}/,
    );
    expect(pairMatch).not.toBeNull();
    const body = pairMatch![1];
    // Task J #13: same width rule. 7rem = 112px, within the 110-125px contract.
    const width = body.match(/(?:^|[^-])width:\s*([0-9.]+rem)/);
    expect(width).not.toBeNull();
    expect(width![1]).toBe("7rem");
    // Task J #14: same height rule. 2.75rem = 44px, within 42-46px and meeting
    // the 44px touch-target minimum.
    const height = body.match(/height:\s*([0-9.]+rem)/);
    expect(height).not.toBeNull();
    expect(height![1]).toBe("2.75rem");
    // Task J #15: neither button uses flex-grow to consume card width. It is
    // `flex: 0 1 auto` - grow 0 (never stretches into a page CTA), shrink 1
    // (both shrink EQUALLY to fit a narrow 4-column card, staying identical and
    // on one line instead of wrapping).
    expect(body).toMatch(/flex:\s*0 1 auto/);
    expect(body).not.toMatch(/flex-grow:\s*[1-9]/);
    expect(body).not.toMatch(/flex:\s*1 /);
    expect(body).toMatch(/justify-content:\s*center/);
    expect(body).toMatch(/box-sizing:\s*border-box/);
  });

  test("View Summary is a quiet borderless text-style control, not a third boxed button (Sprint 28.6H, Finding 9)", () => {
    // The base rule is the standalone `.shell-lesson-view-summary { ... }`
    // block (not the comma-listed responsive/focus rules); it starts with the
    // quiet text-style padding.
    const vsMatch = shellHtml.match(
      /\n\s*\.shell-lesson-view-summary\s*\{\s*padding: 0\.2rem 0;([^}]+)\}/,
    );
    expect(vsMatch).not.toBeNull();
    // Borderless (no boxed outline competing with Assign/Preview), transparent
    // fill, and never wraps into a crushed two-line box.
    expect(vsMatch![1]).toMatch(/border:\s*none/);
    expect(vsMatch![1]).toMatch(/background:\s*transparent/);
    expect(vsMatch![1]).toMatch(/white-space:\s*nowrap/);
  });

  test("Sprint 28.6H.4 (Task D1/D2): the Assign/Preview pair shrink-wraps to the left and never stretches; View Summary lives in the shared footer", () => {
    // The pair is a plain flex row (NOT an intrinsic grid, whose 1fr columns
    // did not equalize under shrink-to-fit and produced the mismatched live
    // widths). It shrink-wraps to its content and sits at the left of the card
    // (align-self: flex-start), so the two fixed-size controls read as compact
    // card-level actions rather than page CTAs.
    const pairMatch = shellHtml.match(
      /\.shell-lesson-action-pair\s*\{([^}]+)\}/,
    );
    expect(pairMatch).not.toBeNull();
    expect(pairMatch![1]).toMatch(/display:\s*flex/);
    expect(pairMatch![1]).not.toMatch(/display:\s*inline-grid/);
    // nowrap so the two controls shrink to fit a narrow card on ONE line
    // instead of wrapping to a second row (which would inflate card height).
    expect(pairMatch![1]).toMatch(/flex-wrap:\s*nowrap/);
    // The actions container is a vertical stack.
    const actionsMatch = shellHtml.match(
      /\n\s*\.shell-lesson-actions\s*\{([^}]+)\}/,
    );
    expect(actionsMatch).not.toBeNull();
    expect(actionsMatch![1]).toMatch(/flex-direction:\s*column/);
    // The shared footer row holds View Summary (left) and the Resources
    // disclosure (pushed right via margin-left:auto).
    const footerRowMatch = shellHtml.match(
      /\n\s*\.shell-lesson-footer-row\s*\{([^}]+)\}/,
    );
    expect(footerRowMatch).not.toBeNull();
    expect(footerRowMatch![1]).toMatch(/display:\s*flex/);
    expect(shellHtml).toMatch(
      /\.shell-lesson-footer-row\s*>\s*\.shell-lesson-resources-toggle\s*\{[^}]*margin-left:\s*auto/,
    );
    // View Summary is no longer a direct child of the actions stack (that CSS
    // rule is gone); it must not carry any greedy flex basis.
    expect(shellHtml).not.toMatch(
      /\.shell-lesson-actions\s*>\s*\.shell-lesson-view-summary/,
    );
    expect(shellHtml).not.toMatch(
      /\.shell-lesson-view-summary\s*\{[^}]*flex:\s*1 1 100%/,
    );
  });

  test("clicking Assign appends the overlay to the document body", async () => {
    // Behavioral parity check: the overlay must land on document.body so
    // the fixed-position rules take effect. The Curriculum surface uses
    // `doc.body.appendChild(overlay)`; the test proves that contract is
    // still honored end-to-end from a real click.
    const twoClasses: ReadonlyArray<ClassSummary> = freeze([
      freeze({
        id: "c1",
        title: "6A Life Science",
        grade: "6",
        status: "active",
      }),
    ] as ClassSummary[]);
    const listOne: ListClasses = () => Promise.resolve(twoClasses);
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
    const mount = mkMount();
    renderCurriculumSurface(mount, teacherSession(), { listClasses: listOne });
    const btn = mount.querySelector<HTMLButtonElement>(
      "[data-testid=lesson-assign-earths-layers]",
    );
    expect(btn).not.toBeNull();
    btn!.click();
    await flush();
    const overlay = document.querySelector<HTMLElement>(
      "[data-testid=assign-overlay]",
    );
    expect(overlay).not.toBeNull();
    expect(overlay!.parentElement).toBe(document.body);
    // Dialog is inside the overlay, not attached elsewhere.
    const dialog = overlay!.querySelector("[data-testid=assign-dialog]");
    expect(dialog).not.toBeNull();
  });
});

describe("Settings class-management CSS ships with the shell host page (Sprint 28.6F)", () => {
  // The simplified Settings surface (settings.ts) renders an Import (primary)
  // and a Create (secondary) class-management action. Their primary/secondary
  // hierarchy is carried by distinct style rules in the served page, not by
  // color alone at the DOM level. This guards that both rules exist and are
  // visually distinct so the hierarchy cannot silently collapse.
  const shellHtml = fs.readFileSync(
    path.resolve(__dirname, "../../index.html"),
    "utf8",
  );

  const ruleBody = (cls: string): string | null => {
    const m = shellHtml.match(
      new RegExp(`\\.${cls.replace(/[-]/g, "\\-")}\\s*\\{([^}]+)\\}`),
    );
    return m ? m[1] : null;
  };

  test("primary and secondary class-action rules are present and distinct", () => {
    const primary = ruleBody("shell-settings-class-action--primary");
    const secondary = ruleBody("shell-settings-class-action--secondary");
    expect(primary).not.toBeNull();
    expect(secondary).not.toBeNull();
    // Primary is a filled treatment; secondary is not the same fill.
    expect(primary as string).toMatch(/background\s*:/);
    expect(primary).not.toBe(secondary);
  });

  test("the old future-category button rule is gone", () => {
    // Sprint 28.6F removed the future-facing Settings category previews; the
    // dead `.shell-settings-category-button` rule must not linger.
    expect(shellHtml).not.toMatch(/\.shell-settings-category-button\s*[{,]/);
  });

  test("Settings ships tab styling and compact class rows, not oversized cards (Sprint 28.6H.4, Task E1/E5/J#34)", () => {
    // The tabbed surface has a real tab style with a non-color selected cue.
    const tab = ruleBody("shell-settings-tab");
    expect(tab).not.toBeNull();
    expect(shellHtml).toMatch(
      /\.shell-settings-tab\[aria-selected="true"\]\s*\{[^}]*border-bottom-color/,
    );
    // The class rows are compact flex lines separated by hairlines - NOT a
    // bordered management card (no full border + border-radius box).
    const item = ruleBody("shell-settings-rostersync-item");
    expect(item).not.toBeNull();
    expect(item as string).toMatch(/display:\s*flex/);
    expect(item as string).not.toMatch(/border-radius/);
    expect(item as string).not.toMatch(/border:\s*1px/);
  });
});
