// Persistent teacher-platform navigation. Home is the only functional
// item in Step 5. Every other item is a coming-soon placeholder that
// must not read as clickable-but-broken. See spec §5.

export type NavigationItem = {
  readonly key: "home" | "classes" | "students" | "assignments" | "settings";
  readonly label: string;
  readonly available: boolean;
};

export const NAVIGATION_ITEMS: ReadonlyArray<NavigationItem> = Object.freeze([
  { key: "home", label: "Home", available: true },
  { key: "classes", label: "Classes", available: false },
  { key: "students", label: "Students", available: false },
  { key: "assignments", label: "Assignments", available: false },
  { key: "settings", label: "Settings", available: false },
]);

export function renderNavigation(mount: HTMLElement): HTMLElement {
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
    btn.className = item.available
      ? "shell-nav-button shell-nav-active"
      : "shell-nav-button shell-nav-disabled";
    btn.setAttribute("data-testid", `nav-${item.key}`);

    if (item.available) {
      btn.textContent = item.label;
      btn.setAttribute("aria-current", "page");
      btn.addEventListener("click", () => {
        // Home is the current surface; activation is a no-op. See spec §5.4.
      });
    } else {
      btn.textContent = `${item.label} - Coming soon`;
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
      btn.setAttribute("tabindex", "-1");
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        // Disabled button; assistive-automation activation is logged and ignored.
        // eslint-disable-next-line no-console
        console.debug(`shell.nav: ${item.key} is not available in Step 5`);
      });
    }

    li.appendChild(btn);
    list.appendChild(li);
  }

  nav.appendChild(list);
  mount.appendChild(nav);
  return nav;
}
