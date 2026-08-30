// Shared DOM building blocks for every /app/** route surface. Introduces
// no new design system; renders plain semantic elements that inherit
// the canonical LyfeLabz typography from index.html. The card layout is
// centered by index.html body flex; each surface renders inside the
// existing #app-root mount node.

export type OnSignOut = () => void;

const doc = (mount: HTMLElement): Document => mount.ownerDocument;

export function clear(mount: HTMLElement): void {
  while (mount.firstChild) mount.removeChild(mount.firstChild);
}

export function renderHeader(mount: HTMLElement, text = "LYFELABZ"): HTMLElement {
  // Sprint 21: shared authentication surfaces render the canonical
  // LYFELABZ wordmark (gold Orbitron, mirroring the public homepage
  // nav-logo). The class name is intentionally distinct from the
  // authenticated Teacher Workspace `.shell-header` chrome so the
  // signed-out / provisioned / pending / error / student / admin
  // surfaces remain centered by the index.html body flex layout.
  const header = doc(mount).createElement("p");
  header.className = "auth-brand";
  header.textContent = text;
  header.setAttribute("aria-label", "LyfeLabz");
  mount.appendChild(header);
  return header;
}

export function renderHeadline(mount: HTMLElement, text: string): HTMLHeadingElement {
  const h1 = doc(mount).createElement("h1");
  h1.textContent = text;
  h1.tabIndex = -1;
  h1.setAttribute("data-testid", "surface-headline");
  mount.appendChild(h1);
  // Announce the surface change; focus is a best-effort call and never throws.
  try {
    h1.focus({ preventScroll: true });
  } catch {
    // ignored
  }
  return h1;
}

export function renderParagraph(mount: HTMLElement, text: string): HTMLElement {
  const p = doc(mount).createElement("p");
  p.textContent = text;
  mount.appendChild(p);
  return p;
}

export function renderPrimaryButton(
  mount: HTMLElement,
  label: string,
  onClick: () => void,
  testId?: string,
): HTMLButtonElement {
  const btn = doc(mount).createElement("button");
  btn.type = "button";
  btn.textContent = label;
  if (testId) btn.setAttribute("data-testid", testId);
  btn.addEventListener("click", () => onClick());
  mount.appendChild(btn);
  return btn;
}

export function renderReturnLink(mount: HTMLElement): HTMLAnchorElement {
  const a = doc(mount).createElement("a");
  a.href = "/";
  a.textContent = "Return to public lessons";
  a.setAttribute("data-testid", "return-link");
  a.className = "shell-return-link";
  mount.appendChild(a);
  return a;
}

// Sprint 29B: quiet tertiary legal links for the unauthenticated
// authentication surface. Rendered as a contentinfo footer so the Privacy
// Policy and Terms of Use are reachable from the /app sign-in entry point
// (and by a Google OAuth reviewer) without touching the locked Teacher
// Workspace navigation or shell footer. The links point to the stable
// public routes served by Firebase Hosting (/privacy, /terms).
export function renderLegalLinks(mount: HTMLElement): HTMLElement {
  const nav = doc(mount).createElement("nav");
  nav.className = "auth-legal-links";
  nav.setAttribute("aria-label", "Legal");
  nav.setAttribute("data-testid", "legal-links");

  const privacy = doc(mount).createElement("a");
  privacy.href = "/privacy";
  privacy.textContent = "Privacy Policy";
  privacy.setAttribute("data-testid", "legal-privacy");
  nav.appendChild(privacy);

  const sep = doc(mount).createElement("span");
  sep.setAttribute("aria-hidden", "true");
  sep.className = "auth-legal-sep";
  sep.textContent = " · ";
  nav.appendChild(sep);

  const terms = doc(mount).createElement("a");
  terms.href = "/terms";
  terms.textContent = "Terms of Use";
  terms.setAttribute("data-testid", "legal-terms");
  nav.appendChild(terms);

  mount.appendChild(nav);
  return nav;
}

export function renderSignOut(
  mount: HTMLElement,
  onSignOut: OnSignOut,
): HTMLButtonElement {
  const btn = doc(mount).createElement("button");
  btn.type = "button";
  btn.textContent = "Sign out";
  btn.className = "shell-signout";
  btn.setAttribute("data-testid", "sign-out");
  btn.addEventListener("click", () => onSignOut());
  mount.appendChild(btn);
  return btn;
}

export function renderErrorBanner(
  mount: HTMLElement,
  text: string,
): HTMLElement {
  const region = doc(mount).createElement("p");
  region.setAttribute("role", "alert");
  region.setAttribute("aria-live", "assertive");
  region.setAttribute("data-testid", "error-banner");
  region.textContent = text;
  mount.appendChild(region);
  return region;
}

export function renderLoadingIndicator(
  mount: HTMLElement,
  label: string,
): HTMLElement {
  const region = doc(mount).createElement("p");
  region.setAttribute("role", "status");
  region.setAttribute("aria-live", "polite");
  region.setAttribute("data-testid", "loading-indicator");
  region.textContent = label;
  mount.appendChild(region);
  return region;
}

export function setButtonPending(
  btn: HTMLButtonElement,
  label: string,
): void {
  btn.disabled = true;
  btn.textContent = label;
  btn.setAttribute("aria-busy", "true");
}

export function clearButtonPending(
  btn: HTMLButtonElement,
  label: string,
): void {
  btn.disabled = false;
  btn.textContent = label;
  btn.removeAttribute("aria-busy");
}
