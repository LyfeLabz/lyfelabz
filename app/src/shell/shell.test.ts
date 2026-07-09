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
import { renderHomeSurface } from "./surfaces/home";
import {
  WORKSPACE_SURFACES,
  mountWorkspaceOutlet,
} from "./surfaces/workspace";

const emptyListClasses: ListClasses = () =>
  Promise.resolve(Object.freeze<ClassSummary[]>([]));

const makeShellDeps = (
  overrides: Partial<ShellDeps> = {},
): ShellDeps => ({
  onSignOut: () => undefined,
  listClasses: emptyListClasses,
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

describe("Teacher Platform Shell - layout regions", () => {
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

describe("Navigation composition and disabled posture", () => {
  test("renders items in the specified order: Home, Classes, Students, Assignments, Settings", () => {
    const mount = mkMount();
    renderNavigation(mount);
    const buttons = Array.from(
      mount.querySelectorAll<HTMLButtonElement>("button.shell-nav-button"),
    );
    expect(buttons.map((b) => b.getAttribute("data-testid"))).toEqual([
      "nav-home",
      "nav-classes",
      "nav-students",
      "nav-assignments",
      "nav-settings",
    ]);
  });

  test("Home and Classes are the enabled items; Home carries aria-current=page by default", () => {
    const mount = mkMount();
    renderNavigation(mount);
    const home = mount.querySelector<HTMLButtonElement>("[data-testid=nav-home]");
    expect(home?.disabled).toBe(false);
    expect(home?.getAttribute("aria-current")).toBe("page");
    expect(home?.textContent).toBe("Home");
    const classes = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-classes]",
    );
    expect(classes?.disabled).toBe(false);
    expect(classes?.getAttribute("aria-current")).toBeNull();
    expect(classes?.textContent).toBe("Classes");
  });

  test("renderNavigation with activeKey=classes moves aria-current onto Classes", () => {
    const mount = mkMount();
    renderNavigation(mount, { activeKey: "classes", onSelect: () => undefined });
    expect(
      mount
        .querySelector("[data-testid=nav-home]")
        ?.getAttribute("aria-current"),
    ).toBeNull();
    expect(
      mount
        .querySelector("[data-testid=nav-classes]")
        ?.getAttribute("aria-current"),
    ).toBe("page");
  });

  test("every future navigation item is disabled, marked coming-soon, and not in the tab order", () => {
    const mount = mkMount();
    renderNavigation(mount);
    for (const item of NAVIGATION_ITEMS) {
      if (item.available) continue;
      const btn = mount.querySelector<HTMLButtonElement>(
        `[data-testid=nav-${item.key}]`,
      );
      expect(btn?.disabled).toBe(true);
      expect(btn?.getAttribute("aria-disabled")).toBe("true");
      expect(btn?.getAttribute("tabindex")).toBe("-1");
      expect(btn?.textContent).toBe(`${item.label} - Coming soon`);
    }
  });

  test("has aria-label 'Teacher platform sections'", () => {
    const mount = mkMount();
    renderNavigation(mount);
    expect(
      mount.querySelector("nav")?.getAttribute("aria-label"),
    ).toBe("Teacher platform sections");
  });

  test("does not include Reports in the navigation", () => {
    const mount = mkMount();
    renderNavigation(mount);
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

describe("Home surface composition", () => {
  test("renders welcome message, platform status sentence, identity card, five placeholder cards, and return link", () => {
    const mount = mkMount();
    renderHomeSurface(mount, teacherSession());
    expect(mount.querySelector("[data-testid=surface-headline]")?.textContent)
      .toBe("Welcome, Ada Lovelace.");
    expect(mount.querySelector("[data-testid=platform-status]")?.textContent)
      .toBe(
        "The teacher platform is being built. New capabilities will appear here as they are released.",
      );
    expect(mount.querySelector("[data-testid=identity-card]")).not.toBeNull();
    const grid = mount.querySelector("[data-testid=placeholder-grid]");
    expect(grid?.children.length).toBe(5);
    expect(
      mount.querySelector<HTMLAnchorElement>("[data-testid=return-link]")
        ?.getAttribute("href"),
    ).toBe("/");
  });

  test("renders the placeholder cards in the specified order", () => {
    const mount = mkMount();
    renderHomeSurface(mount, teacherSession());
    const cards = Array.from(
      mount.querySelectorAll("[data-testid^=placeholder-]"),
    ).filter((el) => el.getAttribute("data-testid") !== "placeholder-grid");
    expect(cards.map((c) => c.getAttribute("data-testid"))).toEqual([
      "placeholder-classes",
      "placeholder-students",
      "placeholder-assignments",
      "placeholder-reports",
      "placeholder-settings",
    ]);
  });

  test("every placeholder card reads 'Coming in a future sprint.' and is aria-disabled", () => {
    const mount = mkMount();
    renderHomeSurface(mount, teacherSession());
    const cards = mount.querySelectorAll(".shell-placeholder-card");
    expect(cards.length).toBe(5);
    for (const card of Array.from(cards)) {
      expect(card.getAttribute("aria-disabled")).toBe("true");
      expect(card.textContent ?? "").toContain("Coming in a future sprint.");
    }
  });

  test("identity card renders display name, Teacher role, and Verified pill", () => {
    const mount = mkMount();
    renderHomeSurface(mount, teacherSession());
    expect(mount.querySelector("[data-testid=identity-name]")?.textContent)
      .toBe("Ada Lovelace");
    expect(mount.querySelector("[data-testid=identity-role]")?.textContent)
      .toBe("Teacher");
    const pill = mount.querySelector("[data-testid=verification-pill]");
    expect(pill?.textContent).toBe("Verified");
    expect(pill?.getAttribute("aria-label")).toBe(
      "Verification: Verified",
    );
  });

  test("does not render uid, schoolId, or claim payload in the DOM", () => {
    const mount = mkMount();
    renderHomeSurface(mount, teacherSession());
    const text = mount.textContent ?? "";
    expect(text).not.toContain("u1");
    expect(text).not.toContain("school-abc");
    expect(text).not.toContain("claim");
  });

  test("falls back to a generic welcome when the display name is empty", () => {
    const mount = mkMount();
    renderHomeSurface(
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
    renderHomeSurface(mount, teacherSession());
    expect(document.activeElement?.getAttribute("data-testid")).toBe(
      "surface-headline",
    );
  });
});

describe("Data and callable posture (spec §6.6, §11.2)", () => {
  // These assertions document the Step 5 invariant: the shell reads only
  // fields already present on the Session Object. It never reaches for
  // Firestore or callables at mount, at navigation, or on refresh.

  test("mounting the shell runs to completion with no runtime errors (no Firestore or callable reach)", () => {
    const mount = mkMount();
    expect(() =>
      mountTeacherShell(teacherSession(), mount, makeShellDeps()),
    ).not.toThrow();
  });

  test("shell modules do not import from firebase/firestore, firebase/functions, or firebase/auth, and open no listeners or callables", () => {
    // Static assertion via source text. Documents the Step 5 invariant
    // that the shell reads only fields already present on the Session.
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

describe("Workspace outlet (Sprint 6A)", () => {
  test("shell mounts exactly one workspace outlet region", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    const outlets = mount.querySelectorAll("[data-testid=workspace-outlet]");
    expect(outlets).toHaveLength(1);
    expect(outlets[0]?.id).toBe("app-main");
  });

  test("outlet advertises the active surface via data-active-surface=home", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    const outlet = mount.querySelector("[data-testid=workspace-outlet]");
    expect(outlet?.getAttribute("data-active-surface")).toBe("home");
  });

  test("home surface renders through the outlet, not as a shell sibling", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    const headline = mount.querySelector("[data-testid=surface-headline]");
    const outlet = mount.querySelector("[data-testid=workspace-outlet]");
    expect(headline).not.toBeNull();
    expect(outlet?.contains(headline!)).toBe(true);
    expect(headline?.textContent).toBe("Welcome, Ada Lovelace.");
  });

  test("WORKSPACE_SURFACES registers exactly the five navigation keys", () => {
    expect(Object.keys(WORKSPACE_SURFACES).sort()).toEqual(
      ["assignments", "classes", "home", "settings", "students"],
    );
  });

  test("mountWorkspaceOutlet with a not-yet-implemented key still returns an outlet (contract completeness)", () => {
    // Sprint 6B activates Home and Classes. Every other nav item remains
    // disabled and its outlet render path is unreachable through the shell.
    // This test only asserts the contract shape: the outlet renderer is
    // total across NavigationKey.
    const mount = mkMount();
    const outlet = mountWorkspaceOutlet(mount, teacherSession(), "students", {
      listClasses: emptyListClasses,
    });
    expect(outlet.getAttribute("data-testid")).toBe("workspace-outlet");
    expect(outlet.getAttribute("data-active-surface")).toBe("students");
  });

  test("disabled navigation buttons do not change the outlet's active surface", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    const before = mount.querySelector("[data-testid=workspace-outlet]")
      ?.getAttribute("data-active-surface");
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    for (const key of ["students", "assignments", "settings"]) {
      const btn = mount.querySelector<HTMLButtonElement>(
        `[data-testid=nav-${key}]`,
      );
      expect(() => btn?.dispatchEvent(event)).not.toThrow();
    }
    const after = mount.querySelector("[data-testid=workspace-outlet]")
      ?.getAttribute("data-active-surface");
    expect(after).toBe(before);
    expect(after).toBe("home");
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

  test("clicking a disabled navigation item does not throw and does not navigate", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, makeShellDeps());
    const students = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-students]",
    );
    // Disabled buttons in jsdom do not fire click; explicitly dispatch to
    // simulate assistive-tech automation.
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(() => students?.dispatchEvent(event)).not.toThrow();
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("home");
  });
});

describe("Classroom Workspace surface (Sprint 6B)", () => {
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
    mount.querySelector<HTMLButtonElement>("[data-testid=nav-home]")?.click();
    expect(mount.querySelectorAll("[data-testid=workspace-outlet]")).toHaveLength(
      1,
    );
    expect(
      mount
        .querySelector("[data-testid=workspace-outlet]")
        ?.getAttribute("data-active-surface"),
    ).toBe("home");
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
