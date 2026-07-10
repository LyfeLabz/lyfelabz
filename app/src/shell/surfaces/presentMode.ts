import type { Session } from "../../session/types";

// Present Mode workspace surface. Sprint 6F establishes Present Mode as
// a real Teacher Workspace destination while the presentation engine
// itself remains deferred to a future sprint. See
// SPRINT_6F_SPECIFICATION and PRESENT_MODE_ARCHITECTURE.md.
//
// This surface is a preparation-focused foundation state. It renders no
// curriculum content, opens no Firestore listener, invokes no callable,
// and imports no firebase/* module. It loads no teacher-scoped or
// student-scoped data. The privacy posture of the eventual Present Mode
// projection surface (PRESENT_MODE_ARCHITECTURE.md sections 5 through 7)
// is preserved by construction because this surface loads nothing that
// would need to be hidden from a classroom projector.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

type PreparationStep = {
  readonly testId: string;
  readonly title: string;
  readonly body: string;
};

const PREPARATION_STEPS: ReadonlyArray<PreparationStep> = Object.freeze([
  Object.freeze({
    testId: "present-mode-step-choose",
    title: "Choose a lesson from Curriculum.",
    body: "Curriculum is your home base. Preview any lesson, activity, or investigation to decide what you want to teach.",
  }),
  Object.freeze({
    testId: "present-mode-step-open",
    title: "Open Present Mode when you are ready to teach.",
    body: "Present Mode is the moment your preparation reaches the classroom projector. It will always launch a clean, student-safe view of the LyfeLabz curriculum.",
  }),
  Object.freeze({
    testId: "present-mode-step-teach",
    title: "Teach without leaving your workflow.",
    body: "Future presentation tools will support classroom delivery and return you to the same workspace you started from.",
  }),
]);

export function renderPresentModeSurface(
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
  headline.textContent = "Present Mode";
  mount.appendChild(headline);
  try {
    headline.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  const intro = doc.createElement("p");
  intro.className = "shell-status shell-present-intro";
  intro.setAttribute("data-testid", "present-mode-intro");
  intro.textContent =
    "Present Mode is your preparation surface for teaching a LyfeLabz lesson in front of your class. It keeps the classroom projector focused on the curriculum without exposing teacher or student information.";
  mount.appendChild(intro);

  const prep = doc.createElement("p");
  prep.className = "shell-present-preparation";
  prep.setAttribute("data-testid", "present-mode-preparation");
  prep.textContent =
    "When you are getting ready to teach, prepare from Curriculum first. Present Mode is the moment your preparation reaches the projector.";
  mount.appendChild(prep);

  const stepsHeading = doc.createElement("h3");
  stepsHeading.className = "shell-present-steps-heading";
  stepsHeading.setAttribute("data-testid", "present-mode-steps-heading");
  stepsHeading.textContent = "How Present Mode fits your day";
  mount.appendChild(stepsHeading);

  const steps = doc.createElement("ol");
  steps.className = "shell-present-steps";
  steps.setAttribute("data-testid", "present-mode-steps");
  steps.setAttribute("aria-labelledby", stepsHeading.id || "");
  for (const step of PREPARATION_STEPS) {
    const li = doc.createElement("li");
    li.className = "shell-present-step";
    li.setAttribute("data-testid", step.testId);
    const title = doc.createElement("p");
    title.className = "shell-present-step-title";
    title.textContent = step.title;
    li.appendChild(title);
    const body = doc.createElement("p");
    body.className = "shell-present-step-body";
    body.textContent = step.body;
    li.appendChild(body);
    steps.appendChild(li);
  }
  mount.appendChild(steps);

  const futureNotice = doc.createElement("p");
  futureNotice.className = "shell-present-future";
  futureNotice.setAttribute("data-testid", "present-mode-future-notice");
  futureNotice.textContent =
    "Presentation controls will become available through future lesson selection and preparation workflows. Until then, prepare and preview lessons from Curriculum.";
  mount.appendChild(futureNotice);
}
