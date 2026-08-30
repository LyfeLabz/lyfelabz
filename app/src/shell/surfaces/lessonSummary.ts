import type {
  LessonSummary,
  LessonSummaryCallable,
} from "../../assignments/summary/types";

// Sprint 28.6E: Curriculum-owned lesson-level View Summary surface.
//
// This surface answers the lesson-mastery question locked by Blueprint
// §10-11: "How has this lesson performed across the classes and
// assignments I own?" It is aggregate-only. It renders exactly the four
// locked v1 metrics - Classes Assigned, Students, Completion, and Average
// Best Score - plus the supporting completed/total fraction that makes the
// unique-student Completion denominator explicit. It never lists
// individual students, late recipients, per-class rosters, student names,
// or attempt tables; those operational views live under Classes.
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
  readonly lessonSummary: LessonSummaryCallable;
  readonly onBack: () => void;
};

// Maps any callable/network failure to calm, teacher-facing copy. Raw
// Firebase error messages, stack traces, and callable names are never
// exposed (Blueprint §16, Sprint 28.6E error contract).
function friendlyError(): string {
  return "We could not load this lesson summary. Try again in a moment.";
}

export function renderLessonSummarySurface(
  host: HTMLElement,
  input: LessonSummarySurfaceInput,
): void {
  const { doc, lessonTitle, lessonSlug, lessonSummary, onBack } = input;

  host.textContent = "";

  const section = doc.createElement("section");
  section.className = "shell-lesson-summary";
  section.setAttribute("data-testid", "lesson-summary-surface");
  section.setAttribute("data-lesson-slug", lessonSlug);
  section.setAttribute("aria-labelledby", "lesson-summary-heading");

  // Back to Curriculum - a real button, keyboard operable, first in the
  // focus order so return is always reachable.
  const back = doc.createElement("button");
  back.type = "button";
  back.className = "shell-lesson-summary-back";
  back.setAttribute("data-testid", "lesson-summary-back");
  back.textContent = "Back to Curriculum";
  back.addEventListener("click", () => {
    onBack();
  });
  section.appendChild(back);

  const heading = doc.createElement("h2");
  heading.id = "lesson-summary-heading";
  heading.className = "shell-lesson-summary-title";
  heading.tabIndex = -1;
  heading.setAttribute("data-testid", "lesson-summary-title");
  heading.textContent = lessonTitle;
  section.appendChild(heading);

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
    loading.textContent = "Loading lesson summary";
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

  const renderMetrics = (summary: LessonSummary): void => {
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

    // Sprint 28.6H.5 (Task B2): the Classes navigation instruction ("To see
    // which students still need to finish, open the class under Classes.") is
    // removed and NOT replaced - the teacher navigation already provides
    // Classes, and no in-surface navigation instruction or button is added.
  };

  let loadToken = 0;
  const load = async (): Promise<void> => {
    const token = ++loadToken;
    renderLoading();
    try {
      const summary = await lessonSummary({ lessonSlug });
      if (token !== loadToken) return;
      renderMetrics(summary);
    } catch {
      if (token !== loadToken) return;
      renderError();
    }
  };

  void load();
}
