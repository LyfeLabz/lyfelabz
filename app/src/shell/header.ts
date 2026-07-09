import type { Session } from "../session/types";

// Shell header. Product mark on the left, identity summary in the
// center/right, notifications placeholder and sign-out on the far right.
// See spec §4. Displays displayName only; email, uid, schoolId, role
// label, and lifecycle status are deliberately withheld from the header
// per spec §7.

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;

export type HeaderDeps = {
  readonly onSignOut: () => void;
};

export function renderHeader(
  mount: HTMLElement,
  session: ActiveTeacher,
  deps: HeaderDeps,
): HTMLElement {
  const doc = mount.ownerDocument;
  const header = doc.createElement("header");
  header.setAttribute("role", "banner");
  header.className = "shell-header";
  header.setAttribute("data-testid", "shell-header");

  const brand = doc.createElement("h1");
  brand.className = "shell-brand";
  brand.setAttribute("data-testid", "shell-brand");
  brand.textContent = "LyfeLabz Teacher Platform";
  header.appendChild(brand);

  const identity = doc.createElement("div");
  identity.className = "shell-header-identity";
  identity.setAttribute("data-testid", "header-identity");

  const nameEl = doc.createElement("span");
  nameEl.className = "shell-header-name";
  nameEl.setAttribute("data-testid", "header-display-name");
  nameEl.textContent = truncate(session.displayName, 24);
  identity.appendChild(nameEl);

  header.appendChild(identity);

  const notifications = doc.createElement("span");
  notifications.className = "shell-notifications";
  notifications.setAttribute("role", "img");
  notifications.setAttribute("aria-label", "Notifications, coming soon");
  notifications.setAttribute("data-testid", "notifications-placeholder");
  notifications.textContent = "○"; // outline circle glyph; low-visibility placeholder
  header.appendChild(notifications);

  const signOut = doc.createElement("button");
  signOut.type = "button";
  signOut.className = "shell-signout";
  signOut.textContent = "Sign out";
  signOut.setAttribute("data-testid", "sign-out");
  signOut.addEventListener("click", () => deps.onSignOut());
  header.appendChild(signOut);

  mount.appendChild(header);
  return header;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
