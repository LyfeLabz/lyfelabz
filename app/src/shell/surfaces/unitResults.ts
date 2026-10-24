import type {
  LessonClassResult,
  LessonResults,
  LessonResultsBatch,
} from "../../assignments/summary/lessonResults";
import type { TeacherUnit } from "../../teacherUnits/types";

// Unit Results: one teacher unit's lessons with each lesson's EXISTING
// Results figures (the certified `assessmentLessonSummary` callable, batch
// form, one request per open). It consolidates what lesson Results already
// shows; it is not a unit assessment, a unit grade, or a new gradebook
// calculation, and it never combines lessons into one unit percentage (the
// lessons can have different classes, students, and denominators).
//
// The unit's CURRENT membership is the lesson list (its resourceIds order);
// nothing about the lessons, their assignments, or the unit is changed here.
// "All classes" shows each lesson's own lesson-wide figures; choosing a class
// shows that class's row for each lesson, or that the lesson is not assigned
// to it. Every state is explicit text: not assigned, assigned with no
// submissions, partial, complete, unavailable, and failed loads.

export type UnitResultsLesson = {
  readonly slug: string;
  readonly title: string;
};

export type UnitResultsInput = {
  readonly doc: Document;
  readonly unit: TeacherUnit;
  // The unit's lessons, in unit order.
  readonly lessons: ReadonlyArray<UnitResultsLesson>;
  // Resources in the unit that have no lesson results (investigations,
  // simulations, ...), counted for a quiet note.
  readonly otherResources: number;
  readonly batch: LessonResultsBatch;
  // The teacher's own class names and saved order (see Class Results).
  readonly classes: {
    readonly ready?: Promise<unknown>;
    readonly describe: (classId: string) => { readonly name: string; readonly order: number } | null;
  };
  readonly onLessonResults: (slug: string) => void;
  readonly onBack: () => void;
  // The class filter to start on (kept by the host across Back/Forward), and
  // each change of it. An initial class no longer present falls back to All.
  readonly initialClassId?: string;
  readonly onClassChange?: (classId: string) => void;
};

export type UnitResultsHandle = {
  readonly refresh: () => void;
};

const ALL = "all";

// The status line under a lesson. Once students have submitted, the
// Completed stat already says how many, so no subtitle repeats it.
function participation(students: number, completed: number): string {
  if (students === 0) return "No students assigned";
  if (completed === 0) return "No submissions yet";
  return "";
}

export function renderUnitResultsSurface(
  host: HTMLElement,
  input: UnitResultsInput,
): UnitResultsHandle {
  const { doc, unit, lessons } = input;
  host.textContent = "";

  const section = doc.createElement("section");
  section.className = "shell-unit-results";
  section.setAttribute("data-testid", "unit-results-surface");
  section.setAttribute("data-unit-id", unit.unitId);
  section.setAttribute("data-unit-color", unit.color ?? "none");
  section.setAttribute("aria-labelledby", "unit-results-eyebrow unit-results-heading");

  const back = doc.createElement("button");
  back.type = "button";
  back.className = "shell-back shell-lesson-summary-back";
  back.setAttribute("data-testid", "unit-results-back");
  back.textContent = "Back to My Units";
  back.addEventListener("click", () => input.onBack());
  section.appendChild(back);

  const header = doc.createElement("div");
  header.className = "shell-lesson-summary-header";
  const titleGroup = doc.createElement("div");
  titleGroup.className = "shell-lesson-summary-title-group";
  const eyebrow = doc.createElement("p");
  eyebrow.id = "unit-results-eyebrow";
  eyebrow.className = "shell-lesson-summary-eyebrow";
  eyebrow.textContent = "Unit Results";
  titleGroup.appendChild(eyebrow);
  const heading = doc.createElement("h2");
  heading.id = "unit-results-heading";
  heading.className = "shell-lesson-summary-title shell-unit-results-title";
  heading.tabIndex = -1;
  heading.setAttribute("data-testid", "unit-results-title");
  const swatch = doc.createElement("span");
  swatch.className = "shell-units-card-swatch";
  swatch.setAttribute("aria-hidden", "true");
  heading.append(swatch, doc.createTextNode(unit.title));
  titleGroup.appendChild(heading);
  header.appendChild(titleGroup);
  section.appendChild(header);

  // Class filter: only the classes that actually hold assignments of this
  // unit's lessons, in the teacher's saved order.
  const filterRow = doc.createElement("div");
  filterRow.className = "shell-unit-results-filter";
  const filterLabel = doc.createElement("label");
  filterLabel.className = "shell-units-field-label";
  filterLabel.htmlFor = "unit-results-class";
  filterLabel.textContent = "Class";
  const select = doc.createElement("select");
  select.id = "unit-results-class";
  select.className = "shell-units-input shell-unit-results-select";
  select.setAttribute("data-testid", "unit-results-class");
  filterRow.append(filterLabel, select);
  filterRow.hidden = true;
  section.appendChild(filterRow);

  const content = doc.createElement("div");
  content.setAttribute("data-testid", "unit-results-content");
  section.appendChild(content);
  host.appendChild(section);
  try {
    heading.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  let results: ReadonlyArray<LessonResults> | null = null;
  const nameOf = (classId: string): string => input.classes.describe(classId)?.name ?? "Class";

  const renderLoading = (): void => {
    content.textContent = "";
    const p = doc.createElement("p");
    p.className = "shell-lesson-summary-loading";
    p.setAttribute("data-testid", "unit-results-loading");
    p.setAttribute("role", "status");
    p.setAttribute("aria-live", "polite");
    p.textContent = "Loading results";
    content.appendChild(p);
  };

  const renderError = (): void => {
    content.textContent = "";
    const alert = doc.createElement("div");
    alert.className = "shell-lesson-summary-error";
    alert.setAttribute("data-testid", "unit-results-error");
    alert.setAttribute("role", "alert");
    const msg = doc.createElement("p");
    msg.className = "shell-lesson-summary-error-message";
    msg.textContent = "We could not load these results. Try again in a moment.";
    const retry = doc.createElement("button");
    retry.type = "button";
    retry.className = "shell-lesson-summary-retry";
    retry.setAttribute("data-testid", "unit-results-retry");
    retry.textContent = "Try again";
    retry.addEventListener("click", () => void load());
    alert.append(msg, retry);
    content.appendChild(alert);
  };

  const buildFilter = (rows: ReadonlyArray<LessonResults>): void => {
    const previous = select.value || input.initialClassId || ALL;
    const ids = new Set<string>();
    for (const r of rows) for (const c of r.classes ?? []) ids.add(c.classId);
    const ordered = Array.from(ids).sort((a, b) => {
      const ao = input.classes.describe(a)?.order ?? Number.MAX_SAFE_INTEGER;
      const bo = input.classes.describe(b)?.order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      const an = nameOf(a);
      const bn = nameOf(b);
      return an === bn ? (a < b ? -1 : 1) : an < bn ? -1 : 1;
    });
    select.textContent = "";
    const all = doc.createElement("option");
    all.value = ALL;
    all.textContent = "All classes";
    select.appendChild(all);
    for (const id of ordered) {
      const o = doc.createElement("option");
      o.value = id;
      o.textContent = nameOf(id);
      select.appendChild(o);
    }
    select.value = ordered.includes(previous) ? previous : ALL;
    filterRow.hidden = ordered.length === 0;
  };

  const stat = (
    parent: HTMLElement,
    key: string,
    slug: string,
    label: string,
    value: string,
  ): void => {
    const group = doc.createElement("div");
    group.className = "shell-lesson-class-result-stat";
    const dt = doc.createElement("dt");
    dt.textContent = label;
    const dd = doc.createElement("dd");
    dd.setAttribute("data-testid", `unit-results-${key}-${slug}`);
    dd.textContent = value;
    group.append(dt, dd);
    parent.appendChild(group);
  };

  const renderRows = (): void => {
    const rows = results;
    if (rows === null) return;
    content.textContent = "";
    const classId = select.value || ALL;
    const bySlug = new Map(rows.map((r) => [r.lessonSlug, r]));

    if (lessons.length === 0) {
      const p = doc.createElement("p");
      p.className = "shell-lesson-class-results-note";
      p.setAttribute("data-testid", "unit-results-empty");
      p.textContent = "This unit has no lessons yet, so there are no results to show.";
      content.appendChild(p);
    } else {
      const list = doc.createElement("ul");
      list.className = "shell-lesson-class-results-list";
      list.setAttribute("data-testid", "unit-results-list");
      for (const lesson of lessons) {
        const r = bySlug.get(lesson.slug);
        const li = doc.createElement("li");
        li.className = "shell-lesson-class-result";
        li.setAttribute("data-testid", `unit-results-lesson-${lesson.slug}`);
        const main = doc.createElement("div");
        main.className = "shell-lesson-class-result-main";
        const h = doc.createElement("h3");
        h.className = "shell-lesson-class-result-name";
        h.textContent = lesson.title;
        const status = doc.createElement("p");
        status.className = "shell-lesson-class-result-status";
        status.setAttribute("data-testid", `unit-results-status-${lesson.slug}`);
        main.append(h, status);
        li.appendChild(main);
        const stats = doc.createElement("dl");
        stats.className = "shell-lesson-class-result-stats";

        let state = "unavailable";
        if (r === undefined) {
          status.textContent = "Results are not available right now.";
        } else if (r.classesAssigned === 0) {
          state = "unassigned";
          status.textContent = "Not assigned";
        } else if (classId === ALL) {
          state = "assigned";
          status.textContent = participation(r.students, r.studentsCompleted);
          stat(stats, "classes", lesson.slug, "Classes", String(r.classesAssigned));
          stat(
            stats,
            "completion",
            lesson.slug,
            "Completed",
            r.students === 0
              ? "None"
              : `${r.studentsCompleted} / ${r.students} (${r.completionPercentage}%)`,
          );
          stat(
            stats,
            "average",
            lesson.slug,
            "Average Best Score",
            r.averageBestPercentage === null ? "No completed scores yet" : `${r.averageBestPercentage}%`,
          );
        } else if (r.classes === undefined) {
          status.textContent = "Class results are not available right now.";
        } else {
          const c: LessonClassResult | undefined = r.classes.find((x) => x.classId === classId);
          if (c === undefined) {
            state = "unassignedClass";
            status.textContent = `Not assigned to ${nameOf(classId)}`;
          } else {
            state = "assigned";
            status.textContent = participation(c.students, c.studentsCompleted);
            stat(
              stats,
              "completion",
              lesson.slug,
              "Completed",
              c.students === 0
                ? "None"
                : `${c.studentsCompleted} / ${c.students} (${c.completionPercentage}%)`,
            );
            stat(
              stats,
              "average",
              lesson.slug,
              "Average Best Score",
              c.averageBestPercentage === null ? "No completed scores yet" : `${c.averageBestPercentage}%`,
            );
          }
        }
        status.hidden = status.textContent === "";
        li.setAttribute("data-state", state);
        li.appendChild(stats);
        if (r !== undefined && r.classesAssigned > 0) {
          // The destination is always the lesson's existing (all-class)
          // Results page. Under a class filter where this lesson is not
          // assigned to that class, the label says so rather than implying
          // class-specific results.
          const allClass = state === "unassignedClass";
          const open = doc.createElement("button");
          open.type = "button";
          open.className = "shell-lesson-class-result-view";
          open.setAttribute("data-testid", `unit-results-open-${lesson.slug}`);
          open.textContent = allClass ? "View All-Class Results" : "Results";
          open.setAttribute(
            "aria-label",
            allClass ? `View all-class Results for ${lesson.title}` : `Results for ${lesson.title}`,
          );
          open.addEventListener("click", () => input.onLessonResults(lesson.slug));
          li.appendChild(open);
        }
        list.appendChild(li);
      }
      content.appendChild(list);
    }

    if (input.otherResources > 0) {
      const p = doc.createElement("p");
      p.className = "shell-lesson-class-results-note";
      p.setAttribute("data-testid", "unit-results-other");
      const n = input.otherResources;
      p.textContent = `${n} other ${n === 1 ? "resource" : "resources"} in this unit ${n === 1 ? "has" : "have"} no lesson results.`;
      content.appendChild(p);
    }
  };

  select.addEventListener("change", () => {
    input.onClassChange?.(select.value || ALL);
    renderRows();
  });

  let token = 0;
  const load = async (): Promise<void> => {
    const mine = ++token;
    if (lessons.length === 0) {
      results = [];
      renderRows();
      return;
    }
    renderLoading();
    try {
      const [rows] = await Promise.all([
        input.batch({ lessonSlugs: lessons.map((l) => l.slug) }),
        input.classes.ready?.catch(() => undefined),
      ]);
      if (mine !== token) return;
      results = rows;
      buildFilter(rows);
      renderRows();
    } catch {
      if (mine !== token) return;
      results = null;
      filterRow.hidden = true;
      renderError();
    }
  };
  void load();

  return {
    refresh: () => void load(),
  };
}
