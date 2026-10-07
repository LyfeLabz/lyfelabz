/**
 * @jest-environment jsdom
 *
 * Type-organized Curriculum browser: Lessons | Investigations | Simulations |
 * Extensions | Challenges. Lessons stays the existing assignment-oriented
 * lesson grid (default); the other tabs are read-only teacher browsing views
 * over the policy-driven `getResourcesByType` accessor, with Open only.
 * Browser-history and primary-navigation behavior is covered against the real
 * shell in shell.navigation-history.nested-pages.test.ts.
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type { LessonSummaryCallable } from "../../assignments/summary/types";
import {
  renderCurriculumSurface,
  _resetCurriculumSessionStateForTest,
} from "./curriculum";
import * as manifest from "../../curriculum/curriculumManifest";
import {
  getResourcesByType,
  getSurfaceableLessons,
  RESOURCE_TYPE_POLICY,
  TOPIC_LABEL,
  type UnitResourceType,
} from "../../curriculum/curriculumManifest";
import { getSurfacedResourceTabs } from "./curriculumResourceTabs";

const freeze = <T>(v: T): T => Object.freeze(v) as T;

const teacher: Extract<Session, { kind: "activeTeacher" }> = freeze({
  kind: "activeTeacher",
  uid: "u-tabs",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

const emptyListClasses: ListClasses = () =>
  Promise.resolve(Object.freeze<ClassSummary[]>([]));

const lessonSummary: LessonSummaryCallable = async (input) => ({
  lessonSlug: input.lessonSlug,
  classesAssigned: 0,
  students: 0,
  studentsCompleted: 0,
  completionPercentage: 0,
  averageBestPercentage: null,
  assignmentsConsidered: 0,
});

const TAB_TYPES = [
  ["investigations", "investigation", "Investigation"],
  ["simulations", "simulation", "Simulation"],
  ["extensions", "extension", "Extension"],
  ["challenges", "challenge", "Challenge"],
] as const;

function mount(): HTMLElement {
  const div = document.createElement("div");
  document.body.appendChild(div);
  renderCurriculumSurface(div, teacher, {
    listClasses: emptyListClasses,
    lessonSummary,
  });
  return div;
}

const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, testid: string): T | null =>
  root.querySelector<T>(`[data-testid=${testid}]`);

const tabButtons = (root: HTMLElement): HTMLButtonElement[] =>
  Array.from(root.querySelectorAll<HTMLButtonElement>("[data-testid=curriculum-tabs] [role=tab]"));

const visibleResourceCards = (root: HTMLElement): HTMLElement[] =>
  Array.from(root.querySelectorAll<HTMLElement>(".shell-resource-card")).filter((c) => !c.hidden);

beforeEach(() => {
  document.body.textContent = "";
  _resetCurriculumSessionStateForTest();
});

describe("Curriculum tabs", () => {
  test("exactly the five expected tabs render, Lessons first and selected by default", () => {
    const root = mount();
    const tablist = q(root, "curriculum-tabs")!;
    expect(tablist.getAttribute("role")).toBe("tablist");
    expect(tablist.getAttribute("aria-label")).toBeTruthy();
    expect(tabButtons(root).map((b) => b.textContent)).toEqual([
      "Lessons",
      "Investigations",
      "Simulations",
      "Extensions",
      "Challenges",
    ]);
    const lessons = q<HTMLButtonElement>(root, "curriculum-tab-lessons")!;
    expect(lessons.getAttribute("aria-selected")).toBe("true");
    expect(lessons.tabIndex).toBe(0);
    for (const b of tabButtons(root).slice(1)) {
      expect(b.getAttribute("aria-selected")).toBe("false");
      expect(b.tabIndex).toBe(-1);
    }
    const lessonsPanel = q(root, "curriculum-panel-lessons")!;
    expect(lessonsPanel.getAttribute("role")).toBe("tabpanel");
    expect(lessonsPanel.getAttribute("aria-labelledby")).toBe("curriculum-tab-lessons");
    expect(lessonsPanel.hidden).toBe(false);
    expect(lessons.getAttribute("aria-controls")).toBe(lessonsPanel.id);
    expect(q(root, "curriculum-grid")!.closest("[role=tabpanel]")).toBe(lessonsPanel);
  });

  test("Tools, games, activities, maps, and diseases are never tabs", () => {
    const root = mount();
    const text = tabButtons(root).map((b) => (b.textContent ?? "").toLowerCase());
    for (const hidden of ["tool", "game", "activit", "map", "disease"]) {
      expect(text.some((t) => t.includes(hidden))).toBe(false);
    }
    expect(RESOURCE_TYPE_POLICY.tool.teacherVisible).toBe(false);
    expect(RESOURCE_TYPE_POLICY.tool.assignable).toBe(false);
    expect(root.textContent).not.toMatch(/Lab Report Assistant/);
  });

  test("tabs are driven by the policy accessor: a type with no surfaceable resources gets no tab", () => {
    const real = manifest.getResourcesByType;
    const spy = jest
      .spyOn(manifest, "getResourcesByType")
      .mockImplementation((type: UnitResourceType) => (type === "challenge" ? [] : real(type)));
    try {
      expect(getSurfacedResourceTabs()).toEqual(["investigations", "simulations", "extensions"]);
      const root = mount();
      expect(q(root, "curriculum-tab-challenges")).toBeNull();
      expect(tabButtons(root)).toHaveLength(4);
    } finally {
      spy.mockRestore();
    }
  });

  test("clicking a tab selects it, swaps the panel, and keeps one tab in the tab order", () => {
    const root = mount();
    q<HTMLButtonElement>(root, "curriculum-tab-simulations")!.click();
    const sims = q<HTMLButtonElement>(root, "curriculum-tab-simulations")!;
    expect(sims.getAttribute("aria-selected")).toBe("true");
    expect(sims.classList.contains("shell-curriculum-tab-active")).toBe(true);
    expect(tabButtons(root).filter((b) => b.tabIndex === 0)).toEqual([sims]);
    expect(q(root, "curriculum-panel-lessons")!.hidden).toBe(true);
    const panel = q(root, "curriculum-panel-simulations")!;
    expect(panel.hidden).toBe(false);
    expect(panel.getAttribute("role")).toBe("tabpanel");
    expect(panel.getAttribute("aria-labelledby")).toBe("curriculum-tab-simulations");
    expect(sims.getAttribute("aria-controls")).toBe(panel.id);
  });

  test("Arrow/Home/End move focus between tabs without activating; Enter/click activates", () => {
    const root = mount();
    const tabs = tabButtons(root);
    tabs[0]!.focus();
    const key = (el: HTMLElement, k: string): KeyboardEvent => {
      const ev = new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true });
      el.dispatchEvent(ev);
      return ev;
    };
    expect(key(tabs[0]!, "ArrowRight").defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(tabs[1]);
    expect(tabs[1]!.tabIndex).toBe(0);
    expect(tabs[0]!.tabIndex).toBe(-1);
    // Focus movement alone never changes the selected tab.
    expect(tabs[0]!.getAttribute("aria-selected")).toBe("true");
    key(tabs[1]!, "End");
    expect(document.activeElement).toBe(tabs[4]);
    key(tabs[4]!, "ArrowRight");
    expect(document.activeElement).toBe(tabs[0]);
    key(tabs[0]!, "ArrowLeft");
    expect(document.activeElement).toBe(tabs[4]);
    key(tabs[4]!, "Home");
    expect(document.activeElement).toBe(tabs[0]);
    // Unrelated keys are left alone.
    expect(key(tabs[0]!, "a").defaultPrevented).toBe(false);
    // Buttons activate with Enter/Space natively (a click on the focused tab).
    tabs[2]!.focus();
    tabs[2]!.click();
    expect(tabs[2]!.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(tabs[2]);
  });
});

describe("formal-resource tabs", () => {
  test.each(TAB_TYPES)("%s lists every policy-surfaced %s once, with title/type/lesson/grade/topic/Open", (tab, type, label) => {
    const root = mount();
    q<HTMLButtonElement>(root, `curriculum-tab-${tab}`)!.click();
    const expected = getResourcesByType(type);
    expect(expected.length).toBeGreaterThan(0);
    const panel = q(root, `curriculum-panel-${tab}`)!;
    const cards = Array.from(panel.querySelectorAll<HTMLElement>(".shell-resource-card"));
    expect(cards).toHaveLength(expected.length);
    expect(new Set(cards.map((c) => c.getAttribute("data-testid"))).size).toBe(cards.length);
    expected.forEach(({ resource, unit }, i) => {
      const card = cards[i]!;
      expect(card.getAttribute("data-resource-type")).toBe(type);
      expect(q(card, "resource-title")!.textContent).toBe(resource.label);
      expect(q(card, "resource-type")!.textContent).toBe(label);
      expect(q(card, "resource-lesson")!.textContent).toBe(`Lesson: ${unit.title}`);
      expect(q(card, "resource-grade")!.textContent).toBe(`G${unit.grade}`);
      expect(q(card, "resource-topic")!.textContent).toBe(TOPIC_LABEL[unit.topic]);
      const open = q<HTMLAnchorElement>(card, "resource-open")!;
      expect(open.tagName).toBe("A");
      expect(open.getAttribute("href")).toBe(resource.href);
      expect(open.target).toBe("_blank");
      expect(open.rel).toBe("noopener");
      expect(open.getAttribute("aria-label")).toContain(resource.label);
    });
    // Nothing assignment- or lesson-shaped on a formal-resource view.
    expect(panel.querySelector("[data-testid^=lesson-assign]")).toBeNull();
    expect(panel.querySelector("[data-testid^=lesson-view-summary]")).toBeNull();
    expect(panel.querySelector("[data-testid^=lesson-preview]")).toBeNull();
    expect(panel.querySelector("button")).toBeNull();
    expect(panel.textContent).not.toMatch(/Assign|Update Assignment|View Summary|Assigned/);
  });
});

describe("filtering", () => {
  test("the shared grade/topic filters narrow the resource tab and keep their stored semantics", () => {
    const root = mount();
    q<HTMLButtonElement>(root, "curriculum-tab-investigations")!.click();
    const all = getResourcesByType("investigation");
    expect(visibleResourceCards(root)).toHaveLength(all.length);

    q<HTMLButtonElement>(root, "filter-grade-7")!.click();
    const g7 = all.filter((e) => e.unit.grade === "7");
    expect(visibleResourceCards(root)).toHaveLength(g7.length);
    for (const c of visibleResourceCards(root)) expect(c.getAttribute("data-grade")).toBe("7");

    // Switching tabs keeps the shared filter applied, and the Lessons grid
    // honors the same selection on return.
    q<HTMLButtonElement>(root, "curriculum-tab-lessons")!.click();
    const lessonCards = Array.from(root.querySelectorAll<HTMLElement>(".shell-lesson-card"));
    expect(lessonCards.filter((c) => !c.hidden).every((c) => c.getAttribute("data-grade") === "7")).toBe(true);
    expect(lessonCards.filter((c) => !c.hidden)).toHaveLength(
      getSurfaceableLessons().filter((l) => l.grade === "7").length,
    );
  });

  test("a resource tab with no matching resources shows a concise empty state", () => {
    const root = mount();
    q<HTMLButtonElement>(root, "curriculum-tab-challenges")!.click();
    const empty = q(root, "curriculum-resource-empty")!;
    expect(empty.hidden).toBe(true);
    // Find a grade/topic pair with no challenges (data-independent).
    const challenges = getResourcesByType("challenge");
    const topics = ["life-science", "earth-space", "physical-science", "tech-engineering"] as const;
    const pair = (["6", "7"] as const)
      .flatMap((g) => topics.map((t) => [g, t] as const))
      .find(([g, t]) => !challenges.some((e) => e.unit.grade === g && e.unit.topic === t));
    expect(pair).toBeDefined();
    q<HTMLButtonElement>(root, `filter-grade-${pair![0]}`)!.click();
    q<HTMLButtonElement>(root, `filter-topic-${pair![1]}`)!.click();
    expect(visibleResourceCards(root)).toHaveLength(0);
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toMatch(/No challenges match the current filters/);
    q<HTMLButtonElement>(root, "filter-topic-all")!.click();
    q<HTMLButtonElement>(root, "filter-grade-all")!.click();
    expect(empty.hidden).toBe(true);
  });
});

describe("Lessons regression", () => {
  test("Lessons keeps Assign, Preview, Resources, View Summary, and Lesson Summary after a tab round trip", () => {
    const root = mount();
    q<HTMLButtonElement>(root, "curriculum-tab-extensions")!.click();
    q<HTMLButtonElement>(root, "curriculum-tab-lessons")!.click();
    const lessonsPanel = q(root, "curriculum-panel-lessons")!;
    expect(lessonsPanel.hidden).toBe(false);
    const resourcePanel = root.querySelector<HTMLElement>(".shell-curriculum-resource-panel")!;
    expect(resourcePanel.hidden).toBe(true);
    expect(resourcePanel.childElementCount).toBe(0);
    const lessons = getSurfaceableLessons();
    expect(lessonsPanel.querySelectorAll(".shell-lesson-card")).toHaveLength(lessons.length);

    const slug = "what-is-life";
    expect(q<HTMLButtonElement>(lessonsPanel, `lesson-assign-${slug}`)!.textContent).toMatch(/Assign/);
    expect(q<HTMLAnchorElement>(lessonsPanel, `lesson-preview-${slug}`)!.target).toBe("_blank");

    const toggle = q<HTMLButtonElement>(lessonsPanel, `lesson-resources-toggle-${slug}`)!;
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(q(lessonsPanel, `lesson-resources-${slug}`)!.hidden).toBe(false);

    q<HTMLButtonElement>(lessonsPanel, `lesson-view-summary-${slug}`)!.click();
    expect(q(root, "lesson-summary-surface")).not.toBeNull();
    expect(q(root, "curriculum-view")!.hidden).toBe(true);
    q<HTMLButtonElement>(root, "lesson-summary-back")!.click();
    expect(q(root, "lesson-summary-surface")).toBeNull();
    expect(q(root, "curriculum-view")!.hidden).toBe(false);
    expect(q<HTMLButtonElement>(root, "curriculum-tab-lessons")!.getAttribute("aria-selected")).toBe("true");
  });

  test("Lessons remains the only assignable type", () => {
    const assignable = (Object.keys(RESOURCE_TYPE_POLICY) as Array<keyof typeof RESOURCE_TYPE_POLICY>).filter(
      (t) => RESOURCE_TYPE_POLICY[t].assignable,
    );
    expect(assignable).toEqual(["lesson"]);
    expect(getResourcesByType("lesson")).toHaveLength(0);
  });
});
