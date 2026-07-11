import type { Session } from "../../session/types";
import type { IntegrationsDeps } from "../../settings/integrations/types";
import { renderIntegrationsSurface } from "../../settings/integrations/integrations";

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
    body: "Tools you connect to LyfeLabz so they work together with your workflow.",
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
};

export function renderSettingsSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
  deps: SettingsDeps = { integrations: null },
): void {
  void session;
  let subview: "root" | "integrations" = "root";

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
    intro.textContent =
      "Settings is where you will manage how LyfeLabz works for you. It is the private, teacher-only surface for the preferences that shape your everyday workflow.";
    container.appendChild(intro);

    const purpose = doc.createElement("p");
    purpose.className = "shell-settings-purpose";
    purpose.setAttribute("data-testid", "settings-purpose");
    purpose.textContent =
      "Settings is not a dashboard, an account console, or an administration surface. It is a calm place to make LyfeLabz feel like your own.";
    container.appendChild(purpose);

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

    const growthNotice = doc.createElement("p");
    growthNotice.className = "shell-settings-growth";
    growthNotice.setAttribute("data-testid", "settings-growth-notice");
    growthNotice.textContent =
      "Additional preferences will appear here as the Teacher Platform grows. Each will be introduced in the workflow it belongs to, so Settings stays calm and easy to navigate.";
    container.appendChild(growthNotice);
  };

  draw();
}
