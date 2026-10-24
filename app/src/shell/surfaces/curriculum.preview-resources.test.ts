/**
 * @jest-environment jsdom
 *
 * Sprint 28.6D regression tests for the Curriculum lesson card's new
 * instructional-action architecture:
 *
 *   - Preview (Task 7): opens the current v2 lesson artifact via
 *     `buildLessonBasePath(slug)` with NO `?assignment` query, in a new
 *     tab, and creates no assignment/session/attempt state.
 *   - Resources: lesson cards carry no resource disclosure; every formal
 *     resource stays reachable through its Curriculum resource tab.
 *   - Compact grade tag (Task 5): "G6"/"G7" rather than "Grade 6".
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import { renderCurriculumSurface } from "./curriculum";
import {
  getFormalResourcesForLesson,
  getResourcesByType,
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
  // Policy E cache transition: Firebase Hosting omits custom security headers
  // on 304 responses, so a plain Preview click prepares the `/app/lessons/**`
  // target (GET, cache "reload") before the new tab loads it.
  test("a plain Preview click prepares the lesson before the new tab loads it", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: emptyListClasses });
    const preview = mount.querySelector<HTMLAnchorElement>(
      `[data-testid=lesson-preview-${LESSON_WITHOUT_RESOURCE}]`,
    )!;
    const tab = { opener: window as unknown, location: { replace: jest.fn() } };
    const open = jest.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const fetchMock = jest.fn(() =>
      Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) } as unknown as Response),
    );
    const originalFetch = (window as { fetch?: typeof fetch }).fetch;
    (window as { fetch?: unknown }).fetch = fetchMock;
    try {
      const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      preview.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(open).toHaveBeenCalledWith("", "_blank");
      expect(tab.opener).toBeNull();
      for (let i = 0; i < 5; i++) await Promise.resolve();
      expect(fetchMock).toHaveBeenCalledWith(
        preview.href,
        expect.objectContaining({ method: "GET", cache: "reload" }),
      );
      expect(tab.location.replace).toHaveBeenCalledWith(preview.href);
    } finally {
      open.mockRestore();
      (window as { fetch?: unknown }).fetch = originalFetch;
    }
  });

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
    // assignment/session surface either. jsdom has no window.open; stub it as a
    // refused tab so the click keeps the native link path.
    const open = jest.spyOn(window, "open").mockReturnValue(null);
    preview.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    open.mockRestore();
    expect(document.querySelector("[data-testid=assign-overlay]")).toBeNull();
    expect(mount.querySelector("[data-testid=curriculum-grid]")).not.toBeNull();
  });
});

describe("Curriculum lesson resources live in the resource tabs, not on lesson cards", () => {
  test("no lesson card renders a resource-count disclosure", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: emptyListClasses });
    expect(getFormalResourcesForLesson(LESSON_WITH_RESOURCE).length).toBe(1);
    expect(mount.querySelector("[data-testid^=lesson-resources-toggle-]")).toBeNull();
    expect(mount.querySelector("[data-testid^=lesson-resources-]")).toBeNull();
    expect(mount.querySelector(".shell-lesson-resources-toggle")).toBeNull();
    for (const card of Array.from(mount.querySelectorAll(".shell-lesson-card"))) {
      expect(card.textContent).not.toMatch(/\d+ Resources?/);
    }
  });

  test("every formal lesson resource stays reachable through its resource tab", () => {
    // Access must not be lost: each resource the old card disclosure listed
    // is surfaced by `getResourcesByType` (the resource tabs' source).
    for (const lesson of getSurfaceableLessons()) {
      for (const resource of getFormalResourcesForLesson(lesson.slug)) {
        expect(resource.type).not.toBe("game");
        const surfaced = getResourcesByType(resource.type).some(
          (e) => e.unit.slug === lesson.slug && e.resource.href === resource.href,
        );
        expect({ lesson: lesson.slug, href: resource.href, surfaced }).toEqual({
          lesson: lesson.slug,
          href: resource.href,
          surfaced: true,
        });
      }
    }
  });

  test("the owning lesson's resource renders with an Open link in its tab", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: emptyListClasses });
    const [resource] = getFormalResourcesForLesson(LESSON_WITH_RESOURCE);
    const tab = mount.querySelector<HTMLButtonElement>(
      `[data-testid=curriculum-tab-${resource.type}s]`,
    );
    expect(tab).not.toBeNull();
    tab!.click();
    const link = mount.querySelector<HTMLAnchorElement>(
      `.shell-curriculum-resource-panel a[href="${resource.href}"]`,
    );
    expect(link).not.toBeNull();
    expect(link!.target).toBe("_blank");
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
