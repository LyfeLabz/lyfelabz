import type { Session } from "../../session/types";
import { renderIdentityCard } from "./shared/identityCard";
import { renderPlaceholderCard } from "./shared/placeholderCard";

// Home surface. The authenticated landing page inside the shell.
// Performs zero Firestore reads, zero callable invocations, and opens
// zero listeners. Renders entirely from fields already present on the
// activeTeacher Session Object. See spec §6.

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

export function renderHomeSurface(
  mount: HTMLElement,
  session: ActiveTeacher,
): void {
  const doc = mount.ownerDocument;

  // Welcome message (h2 per spec §8.1). Focus lands here at mount time
  // per spec §8.1 to preserve the surface-dispatch focus rule.
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
    "The teacher platform is being built. New capabilities will appear here as they are released.";
  mount.appendChild(status);

  // Identity card. Session model does not include a distinct schoolName
  // field today; per architecture constraint the Session model is not
  // modified in Step 5. When a schoolName field is added in a future
  // sprint, pass it in here. Until then the School row is omitted to
  // avoid rendering the opaque schoolId (spec §7.2).
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
