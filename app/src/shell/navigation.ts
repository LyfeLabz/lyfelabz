// Persistent teacher-platform navigation. Sprint 6B activates the
// Classes item alongside Home. Every other item remains a coming-soon
// placeholder that must not read as clickable-but-broken. See
// SPRINT_6B_SPECIFICATION.md §7.

export type NavigationKey =
  | "home"
  | "classes"
  | "students"
  | "assignments"
  | "settings";

export type NavigationItem = {
  readonly key: NavigationKey;
  readonly label: string;
  readonly available: boolean;
};

export const NAVIGATION_ITEMS: ReadonlyArray<NavigationItem> = Object.freeze([
  { key: "home", label: "Home", available: true },
  { key: "classes", label: "Classes", available: true },
  { key: "students", label: "Students", available: false },
  { key: "assignments", label: "Assignments", available: false },
  { key: "settings", label: "Settings", available: false },
]);

export type NavigationRenderInput = {
  readonly activeKey: NavigationKey;
  readonly onSelect: (key: NavigationKey) => void;
};

export function renderNavigation(
  mount: HTMLElement,
  input: NavigationRenderInput = { activeKey: "home", onSelect: () => undefined },
): HTMLElement {
  const doc = mount.ownerDocument;
  const nav = doc.createElement("nav");
  nav.setAttribute("aria-label", "Teacher platform sections");
  nav.className = "shell-nav";
  nav.setAttribute("data-testid", "shell-nav");

  const list = doc.createElement("ul");
  list.className = "shell-nav-list";

  for (const item of NAVIGATION_ITEMS) {
    const li = doc.createElement("li");
    li.className = "shell-nav-item";
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-testid", `nav-${item.key}`);

    if (!item.available) {
      btn.className = "shell-nav-button shell-nav-disabled";
      btn.textContent = `${item.label} - Coming soon`;
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
      btn.setAttribute("tabindex", "-1");
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        // Disabled button; assistive-automation activation is logged and ignored.
        // eslint-disable-next-line no-console
        console.debug(`shell.nav: ${item.key} is not available in Sprint 6B`);
      });
    } else {
      const isActive = item.key === input.activeKey;
      btn.textContent = item.label;
      btn.className = isActive
        ? "shell-nav-button shell-nav-active"
        : "shell-nav-button";
      if (isActive) {
        btn.setAttribute("aria-current", "page");
      }
      btn.addEventListener("click", () => {
        input.onSelect(item.key);
      });
    }

    li.appendChild(btn);
    list.appendChild(li);
  }

  nav.appendChild(list);
  mount.appendChild(nav);
  return nav;
}
