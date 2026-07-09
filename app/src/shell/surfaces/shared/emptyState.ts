// Generic "coming soon" empty state for workspace surfaces that are
// registered in the WorkspaceSurface contract but not yet active. In
// Sprint 6A this renderer is unreachable through the shell: Home is
// the only navigable surface and every other navigation key is
// disabled. The renderer exists so the outlet contract is complete
// for future sprints. See SPRINT_6A_SPECIFICATION.md.

export type ComingSoonInput = {
  readonly title: string;
};

export function renderComingSoonSurface(
  mount: HTMLElement,
  input: ComingSoonInput,
): void {
  const doc = mount.ownerDocument;

  const headline = doc.createElement("h2");
  headline.id = "surface-headline";
  headline.className = "shell-welcome";
  headline.tabIndex = -1;
  headline.setAttribute("data-testid", "surface-headline");
  headline.textContent = input.title;
  mount.appendChild(headline);

  const status = doc.createElement("p");
  status.className = "shell-status";
  status.setAttribute("data-testid", "platform-status");
  status.textContent = "Coming in a future sprint.";
  mount.appendChild(status);
}
