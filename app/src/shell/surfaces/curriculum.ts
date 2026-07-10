import type { Session } from "../../session/types";
import { renderIdentityCard } from "./shared/identityCard";
import { renderPlaceholderCard } from "./shared/placeholderCard";

// Curriculum surface. The teacher-workspace landing surface after
// Sprint 6C. Behavior is a copy-only rename of the Sprint 6A/6B Home
// surface; the transitional status paragraph names the surface as
// transitional until Sprint 6D delivers the curriculum landing bridge.
// See SPRINT_6C_SPECIFICATION.md §6 and PHASE_2_ARCHITECTURE_PLANNING_REPORT.md §11.
//
// This surface performs zero Firestore reads, zero callable invocations,
// and opens zero listeners. It renders entirely from fields already
// present on the activeTeacher Session Object.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

const PLACEHOLDER_CARDS: ReadonlyArray<{
  readonly title: string;
  readonly purpose: string;
  readonly testId: string;
}> = Object.freeze([
  {
    title: "Classes",
    purpose: "Organize your classes and blocks.",
    testId: "placeholder-classes",
  },
  {
    title: "Students",
    purpose: "See your students and their progress.",
    testId: "placeholder-students",
  },
  {
    title: "Assignments",
    purpose: "Create and manage assignments.",
    testId: "placeholder-assignments",
  },
  {
    title: "Reports",
    purpose: "See how your students are doing.",
    testId: "placeholder-reports",
  },
  {
    title: "Settings",
    purpose: "Manage your account and preferences.",
    testId: "placeholder-settings",
  },
]);

export function renderCurriculumSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
): void {
  const doc = mount.ownerDocument;

  const welcome = doc.createElement("h2");
  welcome.id = "surface-headline";
  welcome.className = "shell-welcome";
  welcome.tabIndex = -1;
  welcome.setAttribute("data-testid", "surface-headline");
  const name = session.displayName;
  welcome.textContent =
    name && name.length > 0
      ? `Welcome, ${name}.`
      : "Welcome to LyfeLabz.";
  mount.appendChild(welcome);
  try {
    welcome.focus({ preventScroll: true });
  } catch {
    // ignored
  }

  const status = doc.createElement("p");
  status.className = "shell-status";
  status.setAttribute("data-testid", "platform-status");
  status.textContent =
    "The curriculum landing arrives in a future sprint. New capabilities will appear here as they are released.";
  mount.appendChild(status);

  mount.appendChild(
    renderIdentityCard(doc, {
      displayName: name ?? "",
      schoolName: null,
    }),
  );

  const grid = doc.createElement("div");
  grid.className = "shell-placeholder-grid";
  grid.setAttribute("data-testid", "placeholder-grid");
  for (const card of PLACEHOLDER_CARDS) {
    grid.appendChild(renderPlaceholderCard(doc, card));
  }
  mount.appendChild(grid);

  const returnLink = doc.createElement("a");
  returnLink.href = "/";
  returnLink.textContent = "Return to public lessons";
  returnLink.className = "shell-return-link";
  returnLink.setAttribute("data-testid", "return-link");
  mount.appendChild(returnLink);
}
