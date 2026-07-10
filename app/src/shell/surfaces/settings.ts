import type { Session } from "../../session/types";

// Settings workspace surface. Sprint 6H promotes Settings from a
// disabled coming-soon placeholder to a real Teacher Workspace
// destination that renders through the shared workspace outlet. See
// TEACHER_EXPERIENCE_PHILOSOPHY.md §3.3 and §4.4, and
// TEACHER_PLATFORM_DOMAIN_ROADMAP.md for the deferred teacher-
// preferences record.
//
// This surface is a foundation state. It renders no controls, opens no
// Firestore listener, invokes no callable, imports no firebase/*
// module, and loads no teacher-scoped or student-scoped data. The
// certified privacy posture of eventual teacher preferences is
// preserved by construction because this surface loads nothing that
// would need to be persisted or transmitted today.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

type FutureCategory = {
  readonly testId: string;
  readonly title: string;
  readonly body: string;
};

const FUTURE_CATEGORIES: ReadonlyArray<FutureCategory> = Object.freeze([
  Object.freeze({
    testId: "settings-category-classroom",
    title: "Classroom Preferences",
    body: "Defaults for how your classes are organized, ordered, and remembered.",
  }),
  Object.freeze({
    testId: "settings-category-present-mode",
    title: "Present Mode Preferences",
    body: "Defaults for how Present Mode behaves when you teach in front of your class.",
  }),
  Object.freeze({
    testId: "settings-category-notifications",
    title: "Notification Preferences",
    body: "How LyfeLabz reaches you when something needs your attention.",
  }),
  Object.freeze({
    testId: "settings-category-connected-services",
    title: "Connected Services",
    body: "Tools you connect to LyfeLabz so they work together with your workflow.",
  }),
  Object.freeze({
    testId: "settings-category-account",
    title: "Account Preferences",
    body: "How your LyfeLabz account itself is set up.",
  }),
]);

export function renderSettingsSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
): void {
  void session;
  const doc = mount.ownerDocument;

  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = "Settings";
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  const intro = doc.createElement("p");
  intro.className = "shell-status shell-settings-intro";
  intro.setAttribute("data-testid", "settings-intro");
  intro.textContent =
    "Settings is where you will manage how LyfeLabz works for you. It is the private, teacher-only surface for the preferences that shape your everyday workflow.";
  mount.appendChild(intro);

  const purpose = doc.createElement("p");
  purpose.className = "shell-settings-purpose";
  purpose.setAttribute("data-testid", "settings-purpose");
  purpose.textContent =
    "Settings is not a dashboard, an account console, or an administration surface. It is a calm place to make LyfeLabz feel like your own.";
  mount.appendChild(purpose);

  const categoriesHeading = doc.createElement("h3");
  categoriesHeading.id = "settings-categories-heading";
  categoriesHeading.className = "shell-settings-categories-heading";
  categoriesHeading.setAttribute("data-testid", "settings-categories-heading");
  categoriesHeading.textContent = "What Settings will organize";
  mount.appendChild(categoriesHeading);

  const list = doc.createElement("ul");
  list.className = "shell-settings-categories";
  list.setAttribute("data-testid", "settings-categories");
  list.setAttribute("aria-labelledby", "settings-categories-heading");
  for (const category of FUTURE_CATEGORIES) {
    const li = doc.createElement("li");
    li.className = "shell-settings-category";
    li.setAttribute("data-testid", category.testId);
    const title = doc.createElement("p");
    title.className = "shell-settings-category-title";
    title.textContent = category.title;
    li.appendChild(title);
    const body = doc.createElement("p");
    body.className = "shell-settings-category-body";
    body.textContent = category.body;
    li.appendChild(body);
    list.appendChild(li);
  }
  mount.appendChild(list);

  const growthNotice = doc.createElement("p");
  growthNotice.className = "shell-settings-growth";
  growthNotice.setAttribute("data-testid", "settings-growth-notice");
  growthNotice.textContent =
    "Additional preferences will appear here as the Teacher Platform grows. Each will be introduced in the workflow it belongs to, so Settings stays calm and easy to navigate.";
  mount.appendChild(growthNotice);
}
