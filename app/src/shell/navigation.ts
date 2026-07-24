// Persistent teacher-workspace navigation. Sprint 6C established the
// permanent left-side panel defined in TEACHER_EXPERIENCE_PHILOSOPHY.md
// §3.3. The panel contains, in order: LYFELABZ, Curriculum, Classes,
// Present Mode, Settings. Sprint 6F promoted Present Mode to a real
// workspace destination. Sprint 6H promotes Settings from a disabled
// coming-soon placeholder to a real workspace destination that renders
// a foundation state through the shared workspace outlet. Every
// permanent left-side navigation item is now an available workspace
// destination.

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

// Lucide-family outline icon paths. Inline SVG keeps the shell free of
// any icon-library dependency. Icons render at 18px, stroke inherits
// currentColor, and are marked aria-hidden so screen readers announce
// only the visible label.
const NAV_ICON_PATHS: Readonly<Record<WorkspaceSurfaceKey, string>> =
  Object.freeze({
    curriculum:
      "M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5V4.5Z M4 19.5A2.5 2.5 0 0 1 6.5 17H20",
    classes:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
    "present-mode":
      "M2 3h20v14H2z M8 21h8 M12 17v4",
    settings:
      "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z",
  });

function buildNavIcon(doc: Document, surface: WorkspaceSurfaceKey): SVGElement {
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = doc.createElementNS(svgNS, "svg");
  svg.setAttribute("class", "shell-nav-icon");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.75");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = doc.createElementNS(svgNS, "path");
  path.setAttribute("d", NAV_ICON_PATHS[surface]);
  svg.appendChild(path);
  return svg;
}

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
    available: true,
    targetSurface: "present-mode" as const,
    variant: "item" as const,
  }),
  Object.freeze({
    key: "settings" as const,
    label: "Settings",
    available: true,
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
      if (item.variant === "item") {
        btn.appendChild(buildNavIcon(doc, item.targetSurface));
        const labelSpan = doc.createElement("span");
        labelSpan.className = "shell-nav-label";
        labelSpan.textContent = item.label;
        btn.appendChild(labelSpan);
      } else {
        btn.textContent = item.label;
      }
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
