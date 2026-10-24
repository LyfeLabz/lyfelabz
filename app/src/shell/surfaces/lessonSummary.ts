import type {
  LessonClassResult,
  LessonResults,
  LessonResultsCallable,
} from "../../assignments/summary/lessonResults";

// Sprint 28.6E: Curriculum-owned lesson-level summary surface, presented to
// teachers as the lesson's Results (formerly "View Summary").
//
// This surface answers the lesson-mastery question locked by Blueprint
// §10-11: "How has this lesson performed across the classes and
// assignments I own?" It is aggregate-only. It renders exactly the four
// locked v1 metrics - Classes Assigned, Students, Completion, and Average
// Best Score - plus the supporting completed/total fraction that makes the
// unique-student Completion denominator explicit. Beneath them, Class
// Results breaks the same aggregates out per assigned class (the server's
// per-class `classes` rows, same semantics) with a View Results action into
// that class's EXISTING Assignment Detail. It never lists individual
// students, late recipients, student names, or attempt tables; those
// operational views live in Assignment Detail and under Classes.
//
// The surface is rendered into the Curriculum outlet host while the
// Teacher Workspace shell (header, navigation, footer) stays mounted, so
// Curriculum remains the active global navigation context. `onBack`
// restores the Curriculum lesson grid. No firebase/* import lives here;
// the certified `assessmentLessonSummary` callable is injected.

export type LessonSummarySurfaceInput = {
  readonly doc: Document;
  readonly lessonTitle: string;
  readonly lessonSlug: string;
  readonly lessonSummary: LessonResultsCallable;
  readonly onBack: () => void;
  // The in-app Back label; "Back to Curriculum" unless the owner opened
  // Results from elsewhere (My Units).
  readonly backLabel?: string;
  // Class Results row labels and actions. Absent: rows still render with a
  // generic label and no View Results action (no dead control).
  readonly classResults?: LessonClassResultsSeam;
  // Results-first: opens the EXISTING Curriculum assignment dialog for this
  // lesson (assign to more classes, settings, history, Classroom status).
  // Omitted when no assignment workflow is wired, so no dead control renders.
  readonly onManageAssignments?: () => void;
};

export type LessonClassResultsSeam = {
  // Settles once the teacher's class list (names + saved order) is known;
  // rows render after it so they never reshuffle. Rejection is tolerated.
  readonly ready?: Promise<unknown>;
  // The teacher's own class name and saved display position, or null when
  // the class is not in the loaded list.
  readonly describe: (classId: string) => {
    readonly name: string;
    readonly order: number;
  } | null;
  // Opens the class's existing Assignment Detail for this lesson.
  readonly onView?: (classId: string, className: string) => void;
};

// Participation, carried by visible text (never color alone).
function participationOf(row: LessonClassResult): {
  readonly key: "empty" | "none" | "partial" | "complete";
  readonly label: string;
} {
  if (row.students === 0) return { key: "empty", label: "No students assigned" };
  if (row.studentsCompleted === 0) return { key: "none", label: "No submissions yet" };
  if (row.studentsCompleted < row.students) return { key: "partial", label: "Partially complete" };
  return { key: "complete", label: "All students completed" };
}

// Maps any callable/network failure to calm, teacher-facing copy. Raw
// Firebase error messages, stack traces, and callable names are never
// exposed (Blueprint §16, Sprint 28.6E error contract).
function friendlyError(): string {
  return "We could not load these results. Try again in a moment.";
}

// Handle returned to the owner so a confirmed assignment change made from
// Manage Assignments can re-read the same certified callable in place.
export type LessonSummarySurfaceHandle = {
  readonly refresh: () => void;
  // Polite status region in the Results header, styled like the Curriculum
  // assignment banner. The owner writes assignment outcome messages here
  // while the Curriculum grid (and its own banner) is hidden.
  readonly status: HTMLElement;
};

export function renderLessonSummarySurface(
  host: HTMLElement,
  input: LessonSummarySurfaceInput,
): LessonSummarySurfaceHandle {
  const { doc, lessonTitle, lessonSlug, lessonSummary, onBack, onManageAssignments } = input;
  const classResults = input.classResults ?? null;

  host.textContent = "";

  const section = doc.createElement("section");
  section.className = "shell-lesson-summary";
  section.setAttribute("data-testid", "lesson-summary-surface");
  section.setAttribute("data-lesson-slug", lessonSlug);
  section.setAttribute("aria-labelledby", "lesson-summary-eyebrow lesson-summary-heading");

  // Back to Curriculum - a real button, keyboard operable, first in the
  // focus order so return is always reachable.
  const back = doc.createElement("button");
  back.type = "button";
  back.className = "shell-back shell-lesson-summary-back";
  back.setAttribute("data-testid", "lesson-summary-back");
  back.textContent = input.backLabel ?? "Back to Curriculum";
  back.addEventListener("click", () => {
    onBack();
  });
  section.appendChild(back);

  // Results-first: the surface is presented as the lesson's Results. The
  // header pairs the "Results" eyebrow + lesson title with the secondary
  // Manage Assignments action.
  const header = doc.createElement("div");
  header.className = "shell-lesson-summary-header";
  header.setAttribute("data-testid", "lesson-summary-header");

  const titleGroup = doc.createElement("div");
  titleGroup.className = "shell-lesson-summary-title-group";

  const eyebrow = doc.createElement("p");
  eyebrow.id = "lesson-summary-eyebrow";
  eyebrow.className = "shell-lesson-summary-eyebrow";
  eyebrow.setAttribute("data-testid", "lesson-summary-eyebrow");
  eyebrow.textContent = "Results";
  titleGroup.appendChild(eyebrow);

  const heading = doc.createElement("h2");
  heading.id = "lesson-summary-heading";
  heading.className = "shell-lesson-summary-title";
  heading.tabIndex = -1;
  heading.setAttribute("data-testid", "lesson-summary-title");
  heading.textContent = lessonTitle;
  titleGroup.appendChild(heading);
  header.appendChild(titleGroup);

  if (onManageAssignments !== undefined) {
    const manage = doc.createElement("button");
    manage.type = "button";
    manage.className = "shell-lesson-summary-manage";
    manage.setAttribute("data-testid", "lesson-summary-manage");
    manage.textContent = "Manage Assignments";
    manage.setAttribute("aria-label", `Manage assignments for ${lessonTitle}`);
    manage.addEventListener("click", () => {
      onManageAssignments();
    });
    header.appendChild(manage);
  }
  section.appendChild(header);

  const status = doc.createElement("p");
  status.className = "shell-curriculum-success";
  status.setAttribute("data-testid", "lesson-summary-status");
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.hidden = true;
  section.appendChild(status);

  // Sprint 28.6H.5 (Task B1): the introductory sentence ("How this lesson has
  // performed across your classes and assignments.") is removed and NOT
  // replaced - the title and metric cards already establish the surface's
  // purpose. The heading flows directly into the metrics.

  // Content region swapped between loading / metrics / error states.
  const contentHost = doc.createElement("div");
  contentHost.className = "shell-lesson-summary-content";
  contentHost.setAttribute("data-testid", "lesson-summary-content");
  section.appendChild(contentHost);

  host.appendChild(section);

  try {
    heading.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  const renderLoading = (): void => {
    contentHost.textContent = "";
    const loading = doc.createElement("p");
    loading.className = "shell-lesson-summary-loading";
    loading.setAttribute("data-testid", "lesson-summary-loading");
    loading.setAttribute("role", "status");
    loading.setAttribute("aria-live", "polite");
    loading.textContent = "Loading results";
    contentHost.appendChild(loading);
  };

  const renderError = (): void => {
    contentHost.textContent = "";
    const alert = doc.createElement("div");
    alert.className = "shell-lesson-summary-error";
    alert.setAttribute("data-testid", "lesson-summary-error");
    alert.setAttribute("role", "alert");

    const message = doc.createElement("p");
    message.className = "shell-lesson-summary-error-message";
    message.textContent = friendlyError();
    alert.appendChild(message);

    const retry = doc.createElement("button");
    retry.type = "button";
    retry.className = "shell-lesson-summary-retry";
    retry.setAttribute("data-testid", "lesson-summary-retry");
    retry.textContent = "Try again";
    retry.addEventListener("click", () => {
      void load();
    });
    alert.appendChild(retry);

    contentHost.appendChild(alert);
    try {
      retry.focus({ preventScroll: true });
    } catch {
      // ignored
    }
  };

  const renderMetrics = (summary: LessonResults): void => {
    contentHost.textContent = "";

    const list = doc.createElement("dl");
    list.className = "shell-lesson-summary-metrics";
    list.setAttribute("data-testid", "lesson-summary-metrics");

    const addMetric = (
      key: string,
      label: string,
      value: string,
      detail?: string,
    ): void => {
      const group = doc.createElement("div");
      group.className = "shell-lesson-summary-metric";
      group.setAttribute("data-testid", `lesson-summary-metric-${key}`);

      const dt = doc.createElement("dt");
      dt.className = "shell-lesson-summary-metric-label";
      dt.textContent = label;
      group.appendChild(dt);

      const dd = doc.createElement("dd");
      dd.className = "shell-lesson-summary-metric-value";
      dd.setAttribute("data-testid", `lesson-summary-value-${key}`);
      dd.textContent = value;
      group.appendChild(dd);

      if (detail !== undefined) {
        const note = doc.createElement("p");
        note.className = "shell-lesson-summary-metric-detail";
        note.setAttribute("data-testid", `lesson-summary-detail-${key}`);
        note.textContent = detail;
        group.appendChild(note);
      }

      list.appendChild(group);
    };

    addMetric(
      "classes",
      "Classes Assigned",
      String(summary.classesAssigned),
    );
    addMetric("students", "Students", String(summary.students));
    // Completion shows the unique-student fraction alongside the percent so
    // the denominator is explicit ("X / Y students completed"), never a
    // bare percentage (Blueprint §11 label lock).
    addMetric(
      "completion",
      "Completion",
      `${summary.completionPercentage}%`,
      // Sprint 28.6H.5 (Task B3): the secondary line reads "X / Y completed"
      // (the word "students" is dropped - the analytics context makes the
      // unique-student population clear). Calculation/denominator unchanged.
      `${summary.studentsCompleted} / ${summary.students} completed`,
    );
    // Average Best Score is a lesson-mastery metric over completed students
    // only. `null` renders as a calm no-data note, never a misleading 0%.
    addMetric(
      "average",
      "Average Best Score",
      summary.averageBestPercentage === null
        ? "No completed scores yet"
        : `${summary.averageBestPercentage}%`,
    );

    contentHost.appendChild(list);
    contentHost.appendChild(renderClassResults(summary));

    // Sprint 28.6H.5 (Task B2): the Classes navigation instruction ("To see
    // which students still need to finish, open the class under Classes.") is
    // removed and NOT replaced - the teacher navigation already provides
    // Classes, and no in-surface navigation instruction or button is added.
  };

  // Class Results. Each state is explicit: a backend without the breakdown
  // (or a malformed one) says so instead of showing zero rows; an unassigned
  // lesson says it has no classes; an assigned class with no submissions
  // shows "No submissions yet", never a misleading 0% average.
  const renderClassResults = (summary: LessonResults): HTMLElement => {
    const block = doc.createElement("section");
    block.className = "shell-lesson-class-results";
    block.setAttribute("data-testid", "lesson-class-results");
    block.setAttribute("aria-labelledby", "lesson-class-results-heading");

    const title = doc.createElement("h3");
    title.id = "lesson-class-results-heading";
    title.className = "shell-lesson-class-results-heading";
    title.textContent = "Class Results";
    block.appendChild(title);

    const note = (testId: string, text: string): HTMLElement => {
      const p = doc.createElement("p");
      p.className = "shell-lesson-class-results-note";
      p.setAttribute("data-testid", testId);
      p.textContent = text;
      block.appendChild(p);
      return block;
    };

    const rows = summary.classes;
    if (rows === undefined || (rows.length === 0 && summary.classesAssigned > 0)) {
      return note("lesson-class-results-unavailable", "Class results are not available right now.");
    }
    if (rows.length === 0) {
      return note("lesson-class-results-empty", "This lesson has not been assigned to a class yet.");
    }

    const described = rows.map((row) => ({
      row,
      info: classResults?.describe(row.classId) ?? null,
    }));
    described.sort((a, b) => {
      const ao = a.info?.order ?? Number.MAX_SAFE_INTEGER;
      const bo = b.info?.order ?? Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      const an = a.info?.name ?? "";
      const bn = b.info?.name ?? "";
      if (an !== bn) return an < bn ? -1 : 1;
      return a.row.classId < b.row.classId ? -1 : 1;
    });

    const list = doc.createElement("ul");
    list.className = "shell-lesson-class-results-list";
    list.setAttribute("data-testid", "lesson-class-results-list");
    for (const { row, info } of described) {
      const name = info?.name ?? "Class";
      const participation = participationOf(row);
      const li = doc.createElement("li");
      li.className = "shell-lesson-class-result";
      li.setAttribute("data-testid", `lesson-class-result-${row.classId}`);
      li.setAttribute("data-participation", participation.key);

      const main = doc.createElement("div");
      main.className = "shell-lesson-class-result-main";
      const heading = doc.createElement("h4");
      heading.className = "shell-lesson-class-result-name";
      heading.textContent = name;
      main.appendChild(heading);
      const status = doc.createElement("p");
      status.className = "shell-lesson-class-result-status";
      status.setAttribute("data-testid", `lesson-class-result-status-${row.classId}`);
      status.textContent = participation.label;
      main.appendChild(status);
      li.appendChild(main);

      const stats = doc.createElement("dl");
      stats.className = "shell-lesson-class-result-stats";
      const addStat = (key: string, label: string, value: string): void => {
        const group = doc.createElement("div");
        group.className = "shell-lesson-class-result-stat";
        const dt = doc.createElement("dt");
        dt.textContent = label;
        const dd = doc.createElement("dd");
        dd.setAttribute("data-testid", `lesson-class-result-${key}-${row.classId}`);
        dd.textContent = value;
        group.append(dt, dd);
        stats.appendChild(group);
      };
      addStat("students", "Students", String(row.students));
      addStat(
        "completion",
        "Completed",
        row.students === 0
          ? "None"
          : `${row.studentsCompleted} / ${row.students} (${row.completionPercentage}%)`,
      );
      addStat(
        "average",
        "Average Best Score",
        row.averageBestPercentage === null ? "No completed scores yet" : `${row.averageBestPercentage}%`,
      );
      li.appendChild(stats);

      const onView = classResults?.onView;
      if (onView !== undefined && info !== null) {
        const view = doc.createElement("button");
        view.type = "button";
        view.className = "shell-lesson-class-result-view";
        view.setAttribute("data-testid", `lesson-class-result-view-${row.classId}`);
        view.textContent = "View Results";
        view.setAttribute("aria-label", `View ${name} results for ${lessonTitle}`);
        view.addEventListener("click", () => {
          onView(row.classId, name);
        });
        li.appendChild(view);
      }
      list.appendChild(li);
    }
    block.appendChild(list);
    return block;
  };

  let loadToken = 0;
  const load = async (): Promise<void> => {
    const token = ++loadToken;
    renderLoading();
    try {
      const [summary] = await Promise.all([
        lessonSummary({ lessonSlug }),
        classResults?.ready?.catch(() => undefined),
      ]);
      if (token !== loadToken) return;
      renderMetrics(summary);
    } catch {
      if (token !== loadToken) return;
      renderError();
    }
  };

  void load();

  return {
    // Re-reads the same callable. The load token discards any older
    // in-flight response, so a refresh never shows stale data.
    refresh: () => {
      void load();
    },
    status,
  };
}
