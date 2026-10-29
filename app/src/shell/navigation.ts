// Persistent teacher-workspace navigation. Sprint 6C established the
// permanent left-side panel defined in TEACHER_EXPERIENCE_PHILOSOPHY.md
// §3.3. Sprint 28.6D performs the teacher information-architecture
// transition (Blueprint §4): the panel now contains, in order, LYFELABZ,
// Classes, Curriculum, Settings. Teacher Units UX Milestone 1 adds My Units
// between Curriculum and Settings, rendered only when the shell holds an
// enabled Teacher Units seam (never in a closed release, so the closed
// navigation is unchanged). Classes is the operational home and the
// default landing surface; the LYFELABZ brand item lands on Classes.
// Present Mode leaves the primary navigation - its former "show students
// the lesson" purpose is met faithfully by lesson Preview - and the
// `presentMode` surface module plus `app/src/presentMode/*` remain
// dormant in the tree (not deleted) for a future genuine
// classroom-presentation tool.

// The workspace-surface keys are the identities of the outlet regions
// that renderNavigation can activate. LYFELABZ is a brand item that
// activates the Classes surface; it is not a surface identity.
export type WorkspaceSurfaceKey =
  | "curriculum"
  | "classes"
  | "units"
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
    units:
      "M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12 M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17",
    classes:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75",
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
    // Sprint 20 (Visual Identity Refinement): the sidebar section
    // heading is a subtle "Workspace" label rather than a brand mark.
    // The canonical LYFELABZ wordmark now lives once in the header.
    // The internal key + testid remain "lyfelabz" so the certified
    // navigation contract and every routing test are preserved.
    key: "lyfelabz" as const,
    label: "Workspace",
    available: true,
    targetSurface: "classes" as const,
    variant: "brand" as const,
  }),
  Object.freeze({
    key: "classes" as const,
    label: "Classes",
    available: true,
    targetSurface: "classes" as const,
    variant: "item" as const,
  }),
  Object.freeze({
    key: "curriculum" as const,
    label: "Curriculum",
    available: true,
    targetSurface: "curriculum" as const,
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

// Teacher Units UX Milestone 1: the My Units item. Not part of
// NAVIGATION_ITEMS, which stays the closed-release navigation; it is
// inserted after Curriculum only when `unitsEnabled` is true.
export const MY_UNITS_NAVIGATION_ITEM: NavigationItem = Object.freeze({
  key: "units" as const,
  label: "My Units",
  available: true,
  targetSurface: "units" as const,
  variant: "item" as const,
});

// Student Support Workspace (V2 P3): a support-only teacher's navigation.
// The Classes surface is presented as the Student Support landing; every
// teaching-only item (Curriculum, My Units, Settings) is absent. Sign out
// stays in the header.
export const SUPPORT_NAVIGATION_ITEMS: ReadonlyArray<NavigationItem> = Object.freeze([
  NAVIGATION_ITEMS[0]!,
  Object.freeze({
    key: "classes" as const,
    label: "Student Support",
    available: true,
    targetSurface: "classes" as const,
    variant: "item" as const,
  }),
]);

export function navigationItemsFor(
  unitsEnabled: boolean,
  supportOnly = false,
): ReadonlyArray<NavigationItem> {
  if (supportOnly) return SUPPORT_NAVIGATION_ITEMS;
  if (!unitsEnabled) return NAVIGATION_ITEMS;
  const items: NavigationItem[] = [];
  for (const item of NAVIGATION_ITEMS) {
    items.push(item);
    if (item.key === "curriculum") items.push(MY_UNITS_NAVIGATION_ITEM);
  }
  return Object.freeze(items);
}

export type NavigationRenderInput = {
  readonly activeKey: WorkspaceSurfaceKey;
  readonly onSelect: (surface: WorkspaceSurfaceKey) => void;
  // True only when the shell holds an enabled Teacher Units seam.
  readonly unitsEnabled?: boolean;
  // True for a support-only teacher (see supportWorkspace.ts).
  readonly supportOnly?: boolean;
};

export function renderNavigation(
  mount: HTMLElement,
  input: NavigationRenderInput = {
    activeKey: "classes",
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

  for (const item of navigationItemsFor(input.unitsEnabled === true, input.supportOnly === true)) {
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
