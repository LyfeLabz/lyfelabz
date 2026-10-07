// Type-organized Curriculum browser: the Lessons | Investigations |
// Simulations | Extensions | Challenges tab row and the formal-resource
// views behind the non-Lesson tabs.
//
// Lessons stays the existing assignment-oriented lesson grid, which
// curriculum.ts owns and hands in as the Lessons tab panel. Every other tab
// is a read-only teacher browsing view over `getResourcesByType`: each
// resource renders once with its type, owning lesson, grade, topic, and an
// Open link (new tab, like the lesson card's Resources disclosure). Nothing
// here is assignable.
//
// Which resource tabs render is decided by the resource-type policy: a tab
// appears only when `getResourcesByType` (unit-placed, teacherVisible, not
// assignable, non-gated unit) yields at least one resource. Tools, games,
// activities, maps, and diseases are never tabs here.
//
// Tab semantics follow the Settings tab precedent (role=tablist / role=tab
// with aria-selected and a roving tabindex / a single rendered
// role=tabpanel), plus Left/Right/Home/End to move focus between tabs.
// Activation is manual (Enter/Space or click) because every activation is a
// browser-history entry. This module never touches history itself: user
// activations are reported through `onUserSelect`, and history restores call
// `select`, which never reports.

import {
  getResourcesByType,
  FORMAL_RESOURCE_LABEL,
  TOPIC_LABEL,
  type FormalResourceType,
  type LessonGrade,
  type LessonTopic,
  type SurfaceableUnitResource,
} from "../../curriculum/curriculumManifest";
import {
  CURRICULUM_RESOURCE_TABS,
  type CurriculumResourceTab,
  type CurriculumTab,
} from "../navigationHistory";

const TAB_RESOURCE_TYPE: Readonly<
  Record<CurriculumResourceTab, FormalResourceType>
> = Object.freeze({
  investigations: "investigation",
  simulations: "simulation",
  extensions: "extension",
  challenges: "challenge",
});

const TAB_LABEL: Readonly<Record<CurriculumTab, string>> = Object.freeze({
  lessons: "Lessons",
  investigations: "Investigations",
  simulations: "Simulations",
  extensions: "Extensions",
  challenges: "Challenges",
});

export type CurriculumFilterSelection = {
  readonly grade: "all" | LessonGrade;
  readonly topic: "all" | LessonTopic;
};

// The resource tabs the policy currently surfaces, in display order.
export function getSurfacedResourceTabs(): ReadonlyArray<CurriculumResourceTab> {
  return Object.freeze(
    CURRICULUM_RESOURCE_TABS.filter(
      (tab) => getResourcesByType(TAB_RESOURCE_TYPE[tab]).length > 0,
    ),
  );
}

export type CurriculumTabs = {
  readonly tablist: HTMLElement;
  readonly resourcePanel: HTMLElement;
  readonly active: () => CurriculumTab;
  // Show `tab` without reporting a user selection. Returns true when the
  // visible tab changed; false when it was already showing or is not
  // surfaced.
  readonly select: (tab: CurriculumTab) => boolean;
  // Re-apply the current grade/topic filters to the visible resource tab.
  readonly applyFilters: () => void;
};

export function createCurriculumTabs(input: {
  readonly doc: Document;
  // The existing lesson grid region, shown only on the Lessons tab.
  readonly lessonsPanel: HTMLElement;
  readonly getFilters: () => CurriculumFilterSelection;
  readonly onUserSelect: (tab: CurriculumTab) => void;
}): CurriculumTabs {
  const { doc, lessonsPanel } = input;
  const tabs: ReadonlyArray<CurriculumTab> = [
    "lessons",
    ...getSurfacedResourceTabs(),
  ];
  let current: CurriculumTab = "lessons";

  const tablist = doc.createElement("div");
  tablist.className = "shell-curriculum-tabs";
  tablist.setAttribute("data-testid", "curriculum-tabs");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Curriculum resource types");

  lessonsPanel.id = "curriculum-panel-lessons";
  lessonsPanel.setAttribute("role", "tabpanel");
  lessonsPanel.setAttribute("aria-labelledby", "curriculum-tab-lessons");
  lessonsPanel.setAttribute("data-testid", "curriculum-panel-lessons");

  const resourcePanel = doc.createElement("div");
  resourcePanel.className = "shell-curriculum-resource-panel";
  resourcePanel.setAttribute("role", "tabpanel");
  resourcePanel.hidden = true;

  const buttons = new Map<CurriculumTab, HTMLButtonElement>();
  for (const tab of tabs) {
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.id = `curriculum-tab-${tab}`;
    btn.className = "shell-curriculum-tab";
    btn.setAttribute("data-testid", `curriculum-tab-${tab}`);
    btn.setAttribute("role", "tab");
    btn.textContent = TAB_LABEL[tab];
    btn.addEventListener("click", () => {
      if (select(tab)) input.onUserSelect(tab);
    });
    btn.addEventListener("keydown", (ev: KeyboardEvent) => {
      const i = tabs.indexOf(tab);
      let target: number | null = null;
      if (ev.key === "ArrowRight") target = (i + 1) % tabs.length;
      else if (ev.key === "ArrowLeft") target = (i - 1 + tabs.length) % tabs.length;
      else if (ev.key === "Home") target = 0;
      else if (ev.key === "End") target = tabs.length - 1;
      if (target === null) return;
      ev.preventDefault();
      const next = buttons.get(tabs[target]!);
      for (const b of buttons.values()) b.tabIndex = b === next ? 0 : -1;
      try {
        next?.focus({ preventScroll: true });
      } catch {
        // ignored
      }
    });
    buttons.set(tab, btn);
    tablist.appendChild(btn);
  }

  const syncTabs = (): void => {
    const panelId =
      current === "lessons" ? lessonsPanel.id : `curriculum-panel-${current}`;
    for (const [tab, btn] of buttons) {
      const selected = tab === current;
      btn.setAttribute("aria-selected", selected ? "true" : "false");
      btn.classList.toggle("shell-curriculum-tab-active", selected);
      btn.tabIndex = selected ? 0 : -1;
      // Only the active panel is shown, so every tab points at it (the
      // Settings single-panel convention).
      btn.setAttribute("aria-controls", panelId);
    }
  };

  const renderResourcePanel = (tab: CurriculumResourceTab): void => {
    resourcePanel.textContent = "";
    resourcePanel.id = `curriculum-panel-${tab}`;
    resourcePanel.setAttribute("aria-labelledby", `curriculum-tab-${tab}`);
    resourcePanel.setAttribute("data-testid", `curriculum-panel-${tab}`);

    const list = doc.createElement("div");
    list.className = "shell-curriculum-grid shell-curriculum-resource-grid";
    list.setAttribute("data-testid", "curriculum-resource-grid");
    list.setAttribute("role", "list");
    for (const entry of getResourcesByType(TAB_RESOURCE_TYPE[tab])) {
      list.appendChild(renderResourceCard(doc, entry));
    }
    resourcePanel.appendChild(list);

    const empty = doc.createElement("p");
    empty.className = "shell-curriculum-empty";
    empty.setAttribute("data-testid", "curriculum-resource-empty");
    empty.hidden = true;
    empty.textContent = `No ${TAB_LABEL[tab].toLowerCase()} match the current filters. Adjust a filter to see more.`;
    resourcePanel.appendChild(empty);

    applyFilters();
  };

  const applyFilters = (): void => {
    if (current === "lessons") return;
    const { grade, topic } = input.getFilters();
    let visible = 0;
    for (const card of Array.from(
      resourcePanel.querySelectorAll<HTMLElement>(".shell-resource-card"),
    )) {
      const match =
        (grade === "all" || card.getAttribute("data-grade") === grade) &&
        (topic === "all" || card.getAttribute("data-topic") === topic);
      card.hidden = !match;
      if (match) visible += 1;
    }
    const empty = resourcePanel.querySelector<HTMLElement>(
      "[data-testid=curriculum-resource-empty]",
    );
    if (empty) empty.hidden = visible > 0;
  };

  const select = (tab: CurriculumTab): boolean => {
    if (tab === current || !buttons.has(tab)) return false;
    current = tab;
    if (tab === "lessons") {
      resourcePanel.hidden = true;
      resourcePanel.textContent = "";
      lessonsPanel.hidden = false;
    } else {
      lessonsPanel.hidden = true;
      renderResourcePanel(tab);
      resourcePanel.hidden = false;
    }
    syncTabs();
    return true;
  };

  syncTabs();

  return {
    tablist,
    resourcePanel,
    active: () => current,
    select,
    applyFilters,
  };
}

// A formal resource card: the lesson card's grade/topic header and title
// language, with a single Open action. No assignment controls, no summary.
function renderResourceCard(
  doc: Document,
  entry: SurfaceableUnitResource,
): HTMLElement {
  const { resource, unit } = entry;
  const typeLabel = FORMAL_RESOURCE_LABEL[resource.type as FormalResourceType];

  const card = doc.createElement("article");
  card.className = "shell-card shell-resource-card";
  card.setAttribute("data-testid", `resource-card-${resource.filename}`);
  card.setAttribute("data-resource-type", resource.type);
  card.setAttribute("data-grade", unit.grade);
  card.setAttribute("data-topic", unit.topic);
  card.setAttribute("role", "listitem");

  const header = doc.createElement("div");
  header.className = "shell-lesson-header";
  const gradePill = doc.createElement("span");
  gradePill.className = "shell-lesson-badge shell-lesson-grade";
  gradePill.setAttribute("data-testid", "resource-grade");
  gradePill.textContent = `G${unit.grade}`;
  header.appendChild(gradePill);
  const topicPill = doc.createElement("span");
  topicPill.className = `shell-lesson-badge shell-lesson-topic shell-lesson-topic-${unit.topic}`;
  topicPill.setAttribute("data-testid", "resource-topic");
  topicPill.textContent = TOPIC_LABEL[unit.topic];
  header.appendChild(topicPill);
  card.appendChild(header);

  const type = doc.createElement("span");
  type.className = "shell-lesson-resource-type";
  type.setAttribute("data-testid", "resource-type");
  type.textContent = typeLabel;
  card.appendChild(type);

  const title = doc.createElement("h3");
  title.className = "shell-lesson-title";
  title.setAttribute("data-testid", "resource-title");
  title.textContent = resource.label;
  card.appendChild(title);

  const footer = doc.createElement("div");
  footer.className = "shell-resource-card-footer";

  const lesson = doc.createElement("p");
  lesson.className = "shell-resource-card-lesson";
  lesson.setAttribute("data-testid", "resource-lesson");
  lesson.textContent = `Lesson: ${unit.title}`;
  footer.appendChild(lesson);

  const open = doc.createElement("a");
  open.className = "shell-lesson-resource-open";
  open.setAttribute("data-testid", "resource-open");
  open.href = resource.href;
  open.target = "_blank";
  open.rel = "noopener";
  open.textContent = "Open";
  open.setAttribute(
    "aria-label",
    `Open ${typeLabel.toLowerCase()}: ${resource.label} (opens in a new tab)`,
  );
  footer.appendChild(open);

  card.appendChild(footer);
  return card;
}
