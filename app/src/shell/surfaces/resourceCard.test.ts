/**
 * @jest-environment jsdom
 *
 * Teacher Units UX Milestone 1: the shared full-width resource card
 * (resourceCard.ts) and its use by Curriculum. The card owns structure only;
 * every existing Curriculum control (Assign, Preview, View Summary,
 * Resources, Open) stays the surface's own and keeps its behavior.
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type { LessonSummaryCallable } from "../../assignments/summary/types";
import { getSurfaceableLessons, TOPIC_LABEL } from "../../curriculum/curriculumManifest";
import { renderCurriculumSurface, _resetCurriculumSessionStateForTest } from "./curriculum";
import { getSurfacedResourceTabs } from "./curriculumResourceTabs";
import {
  buildLessonPreviewLink,
  buildResourceCard,
  buildResourceOpenLink,
  setResourceCardStatus,
} from "./resourceCard";

const teacher: Extract<Session, { kind: "activeTeacher" }> = Object.freeze({
  kind: "activeTeacher",
  uid: "teacherA",
  schoolId: "schoolA",
  displayName: "Ada",
});
const listClasses: ListClasses = () => Promise.resolve(Object.freeze<ClassSummary[]>([]));
const lessonSummary = (async () => ({})) as unknown as LessonSummaryCallable;
const q = (root: ParentNode, id: string) => root.querySelector<HTMLElement>(`[data-testid="${id}"]`);

beforeEach(() => {
  document.body.textContent = "";
  _resetCurriculumSessionStateForTest?.();
});

describe("buildResourceCard", () => {
  test("main (badges, type, title), actions, no empty status; status can be set and removed", () => {
    const row = buildResourceCard(document, {
      className: "ctx",
      grade: "7",
      topic: "earth-space",
      typeLabel: "Simulation",
      title: "Plate Boundaries",
      titleTag: "h3",
      testIds: { title: "t" },
    });
    expect(row.card.tagName).toBe("ARTICLE");
    expect(row.card.className).toBe("ctx shell-resource-row");
    expect(Array.from(row.card.children)).toEqual([row.main, row.actions]);
    expect(Array.from(row.header.children).map((c) => c.textContent)).toEqual(["G7", TOPIC_LABEL["earth-space"], "Simulation"]);
    expect(row.header.querySelector(".shell-lesson-topic-earth-space")).not.toBeNull();
    expect(row.title.tagName).toBe("H3");
    expect(row.title.getAttribute("data-testid")).toBe("t");
    expect(row.main.querySelector(".shell-resource-row-status")).toBeNull();
    setResourceCardStatus(row, "Assigned to 2 classes");
    setResourceCardStatus(row, "Assigned to 3 classes");
    expect(row.main.querySelectorAll(".shell-resource-row-status")).toHaveLength(1);
    expect(row.main.querySelector(".shell-resource-row-status")?.textContent).toBe("Assigned to 3 classes");
    setResourceCardStatus(row, null);
    expect(row.main.querySelector(".shell-resource-row-status")).toBeNull();
  });

  test("no header at all when there is nothing to badge", () => {
    const row = buildResourceCard(document, {
      className: "ctx", tag: "div", grade: null, topic: null, typeLabel: null, title: "Gone", titleTag: "span",
    });
    expect(row.card.tagName).toBe("DIV");
    expect(row.main.querySelector(".shell-lesson-header")).toBeNull();
  });

  test("Preview opens the inert lesson page in a new tab; Open opens the resource page", () => {
    const lesson = getSurfaceableLessons()[0];
    const preview = buildLessonPreviewLink(document, lesson, "p") as HTMLAnchorElement;
    expect(preview.target).toBe("_blank");
    expect(preview.rel).toBe("noopener");
    expect(preview.getAttribute("href")).not.toContain("assignment");
    expect(preview.getAttribute("aria-label")).toBe(`Preview ${lesson.title} (opens in a new tab)`);
    expect(buildLessonPreviewLink(document, { slug: "../bad", title: "x" }, "p")).toBeNull();
    const open = buildResourceOpenLink(document, "/simulation_x.html", "Open x", "o");
    expect([open.textContent, open.target, open.getAttribute("href")]).toEqual(["Open", "_blank", "/simulation_x.html"]);
  });
});

describe("Curriculum uses the shared row", () => {
  function render(): HTMLElement {
    const mount = document.createElement("div");
    document.body.appendChild(mount);
    renderCurriculumSurface(mount, teacher, { listClasses, lessonSummary });
    return mount;
  }

  test("every lesson card is one shared row with all existing controls in its actions", () => {
    const mount = render();
    const grid = q(mount, "curriculum-grid") as HTMLElement;
    const cards = Array.from(grid.querySelectorAll<HTMLElement>(".shell-lesson-card"));
    expect(cards.length).toBe(getSurfaceableLessons().length);
    for (const card of cards) {
      const slug = card.getAttribute("data-lesson-slug") as string;
      expect(card.classList.contains("shell-resource-row")).toBe(true);
      expect(card.getAttribute("role")).toBe("listitem");
      const actions = card.querySelector(":scope > .shell-resource-row-actions") as HTMLElement;
      expect(actions.contains(q(card, `lesson-assign-${slug}`))).toBe(true);
      expect(actions.contains(q(card, `lesson-preview-${slug}`))).toBe(true);
      const main = card.querySelector(":scope > .shell-resource-row-main") as HTMLElement;
      expect(main.contains(q(card, `lesson-title-${slug}`))).toBe(true);
      expect(main.querySelector(".shell-lesson-resource-type")?.textContent).toBe("Lesson");
      // View Summary keeps its control (hidden until assignment history).
      expect(q(card, `lesson-view-summary-${slug}`)).not.toBeNull();
      const footer = q(card, `lesson-footer-${slug}`);
      if (footer) expect(footer.classList.contains("shell-resource-row-footer")).toBe(true);
    }
  });

  test("resource-tab cards are shared rows with their lesson line and Open action", () => {
    const tabs = getSurfacedResourceTabs();
    if (tabs.length === 0) return;
    const mount = render();
    (q(mount, `curriculum-tab-${tabs[0]}`) as HTMLButtonElement).click();
    const card = mount.querySelector<HTMLElement>(".shell-resource-card:not([hidden])") as HTMLElement;
    expect(card.classList.contains("shell-resource-row")).toBe(true);
    const main = card.querySelector(":scope > .shell-resource-row-main") as HTMLElement;
    const actions = card.querySelector(":scope > .shell-resource-row-actions") as HTMLElement;
    expect(main.contains(q(card, "resource-lesson"))).toBe(true);
    expect(main.contains(q(card, "resource-type"))).toBe(true);
    expect(actions.contains(q(card, "resource-open"))).toBe(true);
    expect(card.querySelector(".shell-lesson-assign")).toBeNull();
  });
});
