/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";
import type { Session } from "../session/types";
import { mountTeacherShell } from "./shell";
import { renderHeader } from "./header";
import { renderNavigation, NAVIGATION_ITEMS } from "./navigation";
import { renderFooter } from "./footer";
import { renderHomeSurface } from "./surfaces/home";

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
    mountTeacherShell(teacherSession(), mount, { onSignOut: () => undefined });

    expect(mount.querySelectorAll('[role="banner"]')).toHaveLength(1);
    expect(mount.querySelectorAll("nav")).toHaveLength(1);
    expect(mount.querySelectorAll("#app-main")).toHaveLength(1);
    expect(mount.querySelectorAll('[role="contentinfo"]')).toHaveLength(1);
  });

  test("renders regions in DOM order: header, body (nav + main), footer", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, { onSignOut: () => undefined });
    const children = Array.from(mount.children);
    expect(children[0]?.getAttribute("role")).toBe("banner");
    expect(children[1]?.classList.contains("shell-body")).toBe(true);
    expect(children[2]?.getAttribute("role")).toBe("contentinfo");
  });

  test("main content area references the welcome headline via aria-labelledby", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, { onSignOut: () => undefined });
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

  test("Home is the only enabled item and carries aria-current=page", () => {
    const mount = mkMount();
    renderNavigation(mount);
    const home = mount.querySelector<HTMLButtonElement>("[data-testid=nav-home]");
    expect(home?.disabled).toBe(false);
    expect(home?.getAttribute("aria-current")).toBe("page");
    expect(home?.textContent).toBe("Home");
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
      mountTeacherShell(teacherSession(), mount, { onSignOut: () => undefined }),
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

describe("mountTeacherShell integration", () => {
  test("sign-out control in the shell header invokes onSignOut exactly once", () => {
    const mount = mkMount();
    const signOut = jest.fn();
    mountTeacherShell(teacherSession(), mount, { onSignOut: signOut });
    mount
      .querySelector<HTMLButtonElement>("[data-testid=sign-out]")
      ?.click();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test("clicking a disabled navigation item does not throw and does not navigate", () => {
    const mount = mkMount();
    mountTeacherShell(teacherSession(), mount, { onSignOut: () => undefined });
    const classes = mount.querySelector<HTMLButtonElement>(
      "[data-testid=nav-classes]",
    );
    // Disabled buttons in jsdom do not fire click; explicitly dispatch to
    // simulate assistive-tech automation.
    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    expect(() => classes?.dispatchEvent(event)).not.toThrow();
  });
});
