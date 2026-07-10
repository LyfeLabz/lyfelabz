// Persistent teacher-workspace navigation. Sprint 6C replaces the
// Sprint 6A/6B top-nav shape with the permanent left-side panel defined
// in TEACHER_EXPERIENCE_PHILOSOPHY.md §3.3. The panel contains, in
// order: LYFELABZ, Curriculum, Classes, Present Mode, Settings.
// Curriculum and Classes are active surfaces. Present Mode and Settings
// remain disabled coming-soon items until their dedicated
// implementation sprints. See SPRINT_6C_SPECIFICATION.md §4.

// The workspace-surface keys are the identities of the outlet regions
// that renderNavigation can activate. LYFELABZ is a brand item that
// activates the Curriculum surface; it is not a surface identity.
export type WorkspaceSurfaceKey =
  | "curriculum"
  | "classes"
  | "present-mode"
  | "settings";

export type NavigationItemKey = "lyfelabz" | WorkspaceSurfaceKey;

// Retained for backwards compatibility with existing external references
// to the shell's navigation key type. Every NavigationKey value is a
// NavigationItemKey.
export type NavigationKey = NavigationItemKey;

export type NavigationVariant = "brand" | "item";

export type NavigationItem = {
  readonly key: NavigationItemKey;
  readonly label: string;
  readonly available: boolean;
  readonly targetSurface: WorkspaceSurfaceKey;
  readonly variant: NavigationVariant;
};

export const NAVIGATION_ITEMS: ReadonlyArray<NavigationItem> = Object.freeze([
  Object.freeze({
    key: "lyfelabz" as const,
    label: "LYFELABZ",
    available: true,
    targetSurface: "curriculum" as const,
    variant: "brand" as const,
  }),
  Object.freeze({
    key: "curriculum" as const,
    label: "Curriculum",
    available: true,
    targetSurface: "curriculum" as const,
    variant: "item" as const,
  }),
  Object.freeze({
    key: "classes" as const,
    label: "Classes",
    available: true,
    targetSurface: "classes" as const,
    variant: "item" as const,
  }),
  Object.freeze({
    key: "present-mode" as const,
    label: "Present Mode",
    available: false,
    targetSurface: "present-mode" as const,
    variant: "item" as const,
  }),
  Object.freeze({
    key: "settings" as const,
    label: "Settings",
    available: false,
    targetSurface: "settings" as const,
    variant: "item" as const,
  }),
]);

export type NavigationRenderInput = {
  readonly activeKey: WorkspaceSurfaceKey;
  readonly onSelect: (surface: WorkspaceSurfaceKey) => void;
};

export function renderNavigation(
  mount: HTMLElement,
  input: NavigationRenderInput = {
    activeKey: "curriculum",
    onSelect: () => undefined,
  },
): HTMLElement {
  const doc = mount.ownerDocument;
  const nav = doc.createElement("nav");
  nav.setAttribute("aria-label", "Teacher workspace sections");
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
    btn.setAttribute("data-nav-variant", item.variant);

    const baseClass =
      item.variant === "brand"
        ? "shell-nav-button shell-nav-brand"
        : "shell-nav-button";

    if (!item.available) {
      btn.className = `${baseClass} shell-nav-disabled`;
      btn.textContent = `${item.label} - Coming soon`;
      btn.disabled = true;
      btn.setAttribute("aria-disabled", "true");
      btn.setAttribute("tabindex", "-1");
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        // Disabled button; assistive-automation activation is logged and ignored.
        // eslint-disable-next-line no-console
        console.debug(`shell.nav: ${item.key} is not available in Sprint 6C`);
      });
    } else {
      const isActive =
        item.variant === "item" && item.targetSurface === input.activeKey;
      btn.textContent = item.label;
      btn.className = isActive ? `${baseClass} shell-nav-active` : baseClass;
      if (isActive) {
        btn.setAttribute("aria-current", "page");
      }
      btn.addEventListener("click", () => {
        input.onSelect(item.targetSurface);
      });
    }

    li.appendChild(btn);
    list.appendChild(li);
  }

  nav.appendChild(list);
  mount.appendChild(nav);
  return nav;
}
