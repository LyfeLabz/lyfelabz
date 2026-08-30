/**
 * @jest-environment jsdom
 *
 * Sprint 28.6D regression tests for the Curriculum lesson card's new
 * instructional-action architecture:
 *
 *   - Preview (Task 7): opens the current v2 lesson artifact via
 *     `buildLessonBasePath(slug)` with NO `?assignment` query, in a new
 *     tab, and creates no assignment/session/attempt state.
 *   - Resources (Task 8): a formal-resource disclosure sourced from the
 *     canonical curriculum manifest; games are excluded; a lesson with no
 *     formal resources shows no Resources control.
 *   - Compact grade tag (Task 5): "G6"/"G7" rather than "Grade 6".
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import {
  renderCurriculumSurface,
  formatResourceCountLabel,
} from "./curriculum";
import {
  getFormalResourcesForLesson,
  getSurfaceableLessons,
} from "../../curriculum/curriculumManifest";
import { buildLessonBasePath } from "../../assignments/studentList/launch";
import { LESSON_LAUNCH_OVERRIDES } from "../../assignments/studentList/launchOverrides";

const freeze = <T>(v: T): T => Object.freeze(v) as T;

const teacher: Extract<Session, { kind: "activeTeacher" }> = freeze({
  kind: "activeTeacher",
  uid: "u-teacher",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

const emptyListClasses: ListClasses = () =>
  Promise.resolve(Object.freeze<ClassSummary[]>([]));

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

// A lesson known to carry exactly one formal resource in the manifest
// (an investigation). Used to exercise the Resources disclosure.
const LESSON_WITH_RESOURCE = "what-is-life";
// A lesson known to carry NO formal resources (Grade 7 flagship).
const LESSON_WITHOUT_RESOURCE = "earths-layers";

describe("Curriculum Preview control (Sprint 28.6D Task 7)", () => {
  test("every surfaced lesson card renders a Preview control", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: emptyListClasses });
    for (const lesson of getSurfaceableLessons()) {
      const preview = mount.querySelector<HTMLAnchorElement>(
        `[data-testid=lesson-preview-${lesson.slug}]`,
      );
      expect(preview).not.toBeNull();
    }
  });

  test("Preview targets the current v2 artifact with no assignment context", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: emptyListClasses });
    const preview = mount.querySelector<HTMLAnchorElement>(
      `[data-testid=lesson-preview-${LESSON_WITHOUT_RESOURCE}]`,
    )!;
    const href = preview.getAttribute("href")!;
    // The href resolves through the same override-aware seam the student
    // launcher uses. For a migrated lesson it is the v2 path.
    expect(href).toBe(buildLessonBasePath(LESSON_WITHOUT_RESOURCE));
    expect(href).toBe(LESSON_LAUNCH_OVERRIDES[LESSON_WITHOUT_RESOURCE]?.path);
    expect(href.startsWith("/app/lessons/")).toBe(true);
    // No assignment context is ever appended.
    expect(href).not.toContain("?assignment");
    expect(href).not.toContain("assignment=");
  });

  test("Preview is a real link opening a new tab with safe rel semantics", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: emptyListClasses });
    const preview = mount.querySelector<HTMLAnchorElement>(
      `[data-testid=lesson-preview-${LESSON_WITHOUT_RESOURCE}]`,
    )!;
    expect(preview.tagName.toLowerCase()).toBe("a");
    expect(preview.getAttribute("target")).toBe("_blank");
    expect(preview.getAttribute("rel")).toBe("noopener");
    // Accessible name names the lesson and announces the new tab.
    expect(preview.getAttribute("aria-label")).toBe(
      "Preview Earth's Layers (opens in a new tab)",
    );
  });

  test("every surfaced lesson resolves to a v2 override (no legacy v1 preview)", () => {
    // Preview fidelity guard (Blueprint §7 edge): every previewable lesson
    // must have a v2 override so Preview never falls back to the legacy v1
    // artifact.
    for (const lesson of getSurfaceableLessons()) {
      const override = LESSON_LAUNCH_OVERRIDES[lesson.slug];
      expect(override).toBeDefined();
      expect(override!.path.startsWith("/app/lessons/")).toBe(true);
    }
  });

  test("rendering the Curriculum surface invokes no assignment callable", () => {
    // Preview creates nothing: mounting the surface (and the Preview links
    // it renders) never reaches an assignment/summary callable. The surface
    // is given no assignment callables at all and still renders Preview.
    const mount = mkMount();
    expect(() =>
      renderCurriculumSurface(mount, teacher, {
        listClasses: emptyListClasses,
      }),
    ).not.toThrow();
    // Clicking Preview does not create an overlay, dialog, or attempt UI.
    const preview = mount.querySelector<HTMLAnchorElement>(
      `[data-testid=lesson-preview-${LESSON_WITHOUT_RESOURCE}]`,
    )!;
    // jsdom does not navigate on an anchor click, but it must not spawn any
    // assignment/session surface either.
    preview.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(document.querySelector("[data-testid=assign-overlay]")).toBeNull();
    expect(mount.querySelector("[data-testid=curriculum-grid]")).not.toBeNull();
  });
});

describe("Curriculum Resources disclosure (Sprint 28.6D Task 8)", () => {
  test("a single-resource lesson renders the singular collapsed label", () => {
    // Sprint 28.6D.1 (Task 2): the collapsed disclosure is a quiet count
    // row with correct grammar, not the old large "Resources · N" pill.
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: emptyListClasses });
    const expected = getFormalResourcesForLesson(LESSON_WITH_RESOURCE);
    expect(expected.length).toBe(1);
    const toggle = mount.querySelector<HTMLButtonElement>(
      `[data-testid=lesson-resources-toggle-${LESSON_WITH_RESOURCE}]`,
    );
    expect(toggle).not.toBeNull();
    expect(toggle!.textContent).toBe("1 Resource");
    // The old bullet-separated pill label is gone.
    expect(toggle!.textContent).not.toContain("·");
    expect(toggle!.textContent).not.toContain("Resources ·");
  });

  test("the collapsed label uses correct singular/plural grammar (Task 2)", () => {
    // The surfaced manifest carries at most one formal resource per lesson,
    // so the plural branch is not reachable through the real surface; the
    // pure label helper is asserted directly so the grammar stays correct
    // if a lesson later gains multiple resources.
    expect(formatResourceCountLabel(1)).toBe("1 Resource");
    expect(formatResourceCountLabel(3)).toBe("3 Resources");
    expect(formatResourceCountLabel(2)).toBe("2 Resources");
  });

  test("a lesson with no formal resources shows no Resources control", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: emptyListClasses });
    expect(getFormalResourcesForLesson(LESSON_WITHOUT_RESOURCE).length).toBe(0);
    expect(
      mount.querySelector(
        `[data-testid=lesson-resources-${LESSON_WITHOUT_RESOURCE}]`,
      ),
    ).toBeNull();
    expect(
      mount.querySelector(
        `[data-testid=lesson-resources-toggle-${LESSON_WITHOUT_RESOURCE}]`,
      ),
    ).toBeNull();
  });

  test("the disclosure toggle exposes and updates its expanded state", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: emptyListClasses });
    const toggle = mount.querySelector<HTMLButtonElement>(
      `[data-testid=lesson-resources-toggle-${LESSON_WITH_RESOURCE}]`,
    )!;
    const panel = mount.querySelector<HTMLElement>(
      `#lesson-resources-panel-${LESSON_WITH_RESOURCE}`,
    )!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(
      `lesson-resources-panel-${LESSON_WITH_RESOURCE}`,
    );
    expect(panel.hidden).toBe(true);
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(panel.hidden).toBe(true);
  });

  test("each resource renders a type eyebrow, a title, and a secondary Open link (Task 4)", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: emptyListClasses });
    const resources = getFormalResourcesForLesson(LESSON_WITH_RESOURCE);
    resources.forEach((resource, index) => {
      const type = mount.querySelector<HTMLElement>(
        `[data-testid=lesson-resource-type-${LESSON_WITH_RESOURCE}-${index}]`,
      );
      const title = mount.querySelector<HTMLElement>(
        `[data-testid=lesson-resource-title-${LESSON_WITH_RESOURCE}-${index}]`,
      );
      const open = mount.querySelector<HTMLAnchorElement>(
        `[data-testid=lesson-resource-open-${LESSON_WITH_RESOURCE}-${index}]`,
      );
      // Type: small metadata eyebrow. Human-readable, never a raw
      // manifest key/filename. Casing is presentational (CSS uppercases).
      expect(type).not.toBeNull();
      expect(type!.textContent).toBe("Investigation");
      // Title: the primary content of the resource row.
      expect(title).not.toBeNull();
      expect(title!.textContent).toBe(resource.label);
      // Open: a distinct, quiet secondary action (not the title itself).
      expect(open).not.toBeNull();
      expect(open!.textContent).toBe("Open");
      // Opens the canonical manifest URL in a new tab, Open/Preview only.
      expect(open!.getAttribute("href")).toBe(resource.href);
      expect(open!.getAttribute("target")).toBe("_blank");
      expect(open!.getAttribute("rel")).toBe("noopener");
      // Discernible accessible name still carries the resource identity
      // and the resource type in text, even though the visible link word
      // is "Open".
      expect(open!.getAttribute("aria-label")).toContain(resource.label);
      expect(open!.getAttribute("aria-label")).toContain("investigation");
      expect(open!.getAttribute("aria-label")).toContain("opens in a new tab");
      // No filename or internal path leaks into visible text.
      expect(type!.textContent).not.toContain(".html");
      expect(title!.textContent).not.toContain(".html");
    });
  });

  test("legacy games never appear under Resources (manifest carries game: 0)", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: emptyListClasses });
    // No lesson exposes a game-typed resource: the formal filter drops them.
    for (const lesson of getSurfaceableLessons()) {
      for (const resource of getFormalResourcesForLesson(lesson.slug)) {
        expect(resource.type).not.toBe("game");
      }
    }
    // And nothing on the surface is labelled as a game resource.
    const html = mount.innerHTML.toLowerCase();
    expect(html).not.toContain("lesson-resource-type-game");
  });

  test("no resource is presented as independently assignable (Open/Preview only)", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: emptyListClasses });
    const panel = mount.querySelector<HTMLElement>(
      `#lesson-resources-panel-${LESSON_WITH_RESOURCE}`,
    )!;
    // The disclosure contains only Open links, never an assign control.
    expect(panel.querySelector("[data-testid^=lesson-assign-]")).toBeNull();
    expect(panel.querySelectorAll("a").length).toBeGreaterThan(0);
  });
});

describe("Curriculum compact grade tag (Sprint 28.6D Task 5)", () => {
  test("grade pill renders the compact G-prefixed tag, domain label retained", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: emptyListClasses });
    // Grade 6 lesson.
    expect(
      mount.querySelector(`[data-testid=lesson-grade-${LESSON_WITH_RESOURCE}]`)
        ?.textContent,
    ).toBe("G6");
    // Grade 7 lesson; the science-domain label remains.
    expect(
      mount.querySelector(
        `[data-testid=lesson-grade-${LESSON_WITHOUT_RESOURCE}]`,
      )?.textContent,
    ).toBe("G7");
    expect(
      mount.querySelector(
        `[data-testid=lesson-topic-${LESSON_WITHOUT_RESOURCE}]`,
      )?.textContent,
    ).toBe("Earth & Space");
  });
});
