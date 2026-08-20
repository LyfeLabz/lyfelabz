import type { Session } from "../../session/types";
import type { IntegrationsDeps } from "../../settings/integrations/types";
import { renderIntegrationsSurface } from "../../settings/integrations/integrations";
import {
  TEACHER_DEFAULT_GRADE_VALUES,
  type TeacherDefaultGrade,
  type UpdateTeacherDefaultGrade,
} from "../../teacherPreferences/types";

// Settings workspace surface. Sprint 6H promoted Settings from a
// placeholder to a real workspace destination. Sprint 8C promotes the
// Connected Services category into a live entry point for the Teacher
// Integrations experience described in LMS_EXPERIENCE.md §3, per
// PDR-020c's authorized initial scope. Every other future category
// remains an informational preview.
//
// The Settings surface holds no OAuth token, opens no Firestore
// listener, imports no firebase/* module, and invokes no callable
// directly. Integrations receive their callable seam through the
// injected IntegrationsDeps wired at the client entry point.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

type FutureCategory = {
  readonly key: string;
  readonly testId: string;
  readonly title: string;
  readonly body: string;
  readonly available: boolean;
};

const FUTURE_CATEGORIES: ReadonlyArray<FutureCategory> = Object.freeze([
  Object.freeze({
    key: "classroom",
    testId: "settings-category-classroom",
    title: "Classroom Preferences",
    body: "Defaults for how your classes are organized, ordered, and remembered.",
    available: false,
  }),
  Object.freeze({
    key: "present-mode",
    testId: "settings-category-present-mode",
    title: "Present Mode Preferences",
    body: "Defaults for how Present Mode behaves when you teach in front of your class.",
    available: false,
  }),
  Object.freeze({
    key: "notifications",
    testId: "settings-category-notifications",
    title: "Notification Preferences",
    body: "How LyfeLabz reaches you when something needs your attention.",
    available: false,
  }),
  Object.freeze({
    key: "connected-services",
    testId: "settings-category-connected-services",
    title: "Connected Services",
    body: "Manage the accounts LyfeLabz is connected to. Class import and class creation now live on your Classes surface.",
    available: true,
  }),
  Object.freeze({
    key: "account",
    testId: "settings-category-account",
    title: "Account Preferences",
    body: "How your LyfeLabz account itself is set up.",
    available: false,
  }),
]);

export type SettingsDeps = {
  readonly integrations: IntegrationsDeps | null;
  // Sprint 24B Phase 2B.2: current `defaultGrade` convenience
  // preference and best-effort update seam. When update is null the
  // control still renders the current value but does not accept
  // changes (tests / unwired harnesses).
  readonly defaultGrade?: TeacherDefaultGrade | null;
  readonly updateDefaultGrade?: UpdateTeacherDefaultGrade | null;
};

export function renderSettingsSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
  deps: SettingsDeps = { integrations: null },
): void {
  void session;
  let subview: "root" | "integrations" = "root";
  // Phase 2B.2: local mutable copy of the preference so the control
  // reflects the teacher's most recent choice without a full session
  // rehydrate. Repaired to `deps.defaultGrade` on every full remount.
  let currentDefaultGrade: TeacherDefaultGrade | null =
    deps.defaultGrade ?? null;

  const doc = mount.ownerDocument;
  const container = doc.createElement("div");
  container.className = "shell-settings-container";
  container.setAttribute("data-testid", "settings-container");
  mount.appendChild(container);

  const draw = (): void => {
    container.textContent = "";
    if (subview === "integrations" && deps.integrations) {
      renderIntegrationsSurface(container, deps.integrations, {
        onExit: () => {
          subview = "root";
          draw();
        },
      });
      return;
    }
    drawRoot();
  };

  const renderDefaultGradeControl = (): HTMLElement => {
    // Sprint 24B Phase 2B.2 - Default grade for new classes.
    //
    // Narrow account-level convenience preference. Not the teacher's
    // grade, not the account grade, not the Google Classroom grade.
    // Individual classes may choose a different grade at creation. See
    // docs/platform/ADR_TEACHER_DEFAULT_CLASS_METADATA.md.
    const section = doc.createElement("section");
    section.className = "shell-settings-default-grade";
    section.setAttribute("data-testid", "settings-default-grade");
    section.setAttribute("aria-labelledby", "settings-default-grade-heading");

    const heading = doc.createElement("h3");
    heading.id = "settings-default-grade-heading";
    heading.className = "shell-settings-default-grade-heading";
    heading.textContent = "Default grade for new classes";
    section.appendChild(heading);

    const explainer = doc.createElement("p");
    explainer.className = "shell-settings-default-grade-body";
    explainer.setAttribute("data-testid", "settings-default-grade-body");
    explainer.textContent =
      "The starting grade for new class setup. You can change the grade for each class you create.";
    section.appendChild(explainer);

    const canUpdate = deps.updateDefaultGrade !== null &&
      deps.updateDefaultGrade !== undefined;

    const controlRow = doc.createElement("div");
    controlRow.className = "shell-settings-default-grade-controls";

    const label = doc.createElement("label");
    label.className = "shell-settings-default-grade-label";
    label.textContent = "Grade";

    const select = doc.createElement("select");
    select.setAttribute("data-testid", "settings-default-grade-select");
    select.disabled = !canUpdate;

    const none = doc.createElement("option");
    none.value = "";
    none.textContent = "No default";
    if (currentDefaultGrade === null) none.selected = true;
    select.appendChild(none);

    for (const g of TEACHER_DEFAULT_GRADE_VALUES) {
      const opt = doc.createElement("option");
      opt.value = g;
      opt.textContent = `Grade ${g}`;
      if (g === currentDefaultGrade) opt.selected = true;
      select.appendChild(opt);
    }

    label.appendChild(select);
    controlRow.appendChild(label);

    const status = doc.createElement("p");
    status.className = "shell-settings-default-grade-status";
    status.setAttribute("data-testid", "settings-default-grade-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "";
    controlRow.appendChild(status);

    section.appendChild(controlRow);

    if (!canUpdate) {
      return section;
    }

    select.addEventListener("change", () => {
      const raw = select.value;
      const next: TeacherDefaultGrade | null =
        raw === "6" || raw === "7" || raw === "8" ? raw : null;
      status.textContent = "Saving";
      select.disabled = true;
      const update = deps.updateDefaultGrade;
      if (!update) return;
      update(next)
        .then(() => {
          currentDefaultGrade = next;
          status.textContent = next === null ? "Cleared" : "Saved";
          select.disabled = false;
        })
        .catch(() => {
          status.textContent = "Could not save. Try again.";
          // Restore select to the last-known value so the display
          // reflects persisted state, not the failed intent.
          for (const opt of Array.from(select.options)) {
            opt.selected =
              (opt.value === "" && currentDefaultGrade === null) ||
              opt.value === currentDefaultGrade;
          }
          select.disabled = false;
        });
    });

    return section;
  };

  const drawRoot = (): void => {
    const headline = doc.createElement("h2");
    headline.id = "surface-headline";
    headline.className = "shell-welcome";
    headline.tabIndex = -1;
    headline.setAttribute("data-testid", "surface-headline");
    headline.textContent = "Settings";
    container.appendChild(headline);
    try {
      headline.focus({ preventScroll: true });
    } catch {
      // ignored
    }

    const intro = doc.createElement("p");
    intro.className = "shell-status shell-settings-intro";
    intro.setAttribute("data-testid", "settings-intro");
    // Sprint 28.5D (microcopy): the intro was trimmed from two future-facing
    // philosophical paragraphs to a single sentence so the live control
    // (Default grade) and Connected Services are easier to find. The
    // information architecture (the preference categories below) is
    // unchanged.
    intro.textContent =
      "Manage your LyfeLabz preferences. This is your private, teacher-only space for the settings that shape your everyday workflow.";
    container.appendChild(intro);

    const categoriesHeading = doc.createElement("h3");
    categoriesHeading.id = "settings-categories-heading";
    categoriesHeading.className = "shell-settings-categories-heading";
    categoriesHeading.setAttribute(
      "data-testid",
      "settings-categories-heading",
    );
    categoriesHeading.textContent = "What Settings will organize";
    container.appendChild(categoriesHeading);

    const list = doc.createElement("ul");
    list.className = "shell-settings-categories";
    list.setAttribute("data-testid", "settings-categories");
    list.setAttribute("aria-labelledby", "settings-categories-heading");
    for (const category of FUTURE_CATEGORIES) {
      const isConnected =
        category.key === "connected-services" && deps.integrations !== null;
      const li = doc.createElement("li");
      li.className = "shell-settings-category";
      li.setAttribute("data-testid", category.testId);
      if (isConnected) {
        const btn = doc.createElement("button");
        btn.type = "button";
        btn.className = "shell-settings-category-button";
        btn.setAttribute(
          "data-testid",
          "settings-open-integrations",
        );
        const title = doc.createElement("p");
        title.className = "shell-settings-category-title";
        title.textContent = category.title;
        btn.appendChild(title);
        const body = doc.createElement("p");
        body.className = "shell-settings-category-body";
        body.textContent = category.body;
        btn.appendChild(body);
        const hint = doc.createElement("p");
        hint.className = "shell-settings-category-hint";
        hint.textContent = "Open Integrations →";
        btn.appendChild(hint);
        btn.addEventListener("click", () => {
          subview = "integrations";
          draw();
        });
        li.appendChild(btn);
      } else {
        const title = doc.createElement("p");
        title.className = "shell-settings-category-title";
        title.textContent = category.title;
        li.appendChild(title);
        const body = doc.createElement("p");
        body.className = "shell-settings-category-body";
        body.textContent = category.body;
        li.appendChild(body);
      }
      list.appendChild(li);
    }
    container.appendChild(list);

    container.appendChild(renderDefaultGradeControl());

    const growthNotice = doc.createElement("p");
    growthNotice.className = "shell-settings-growth";
    growthNotice.setAttribute("data-testid", "settings-growth-notice");
    growthNotice.textContent =
      "Additional preferences will appear here as the Teacher Platform grows. Each will be introduced in the workflow it belongs to, so Settings stays calm and easy to navigate.";
    container.appendChild(growthNotice);
  };

  draw();
}
