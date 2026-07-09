// Reusable verification pill. Informational only; never actionable.
// Rendered inside the identity summary card of the Home surface.
export function renderVerificationPill(doc: Document): HTMLElement {
  const pill = doc.createElement("span");
  pill.className = "shell-pill shell-pill-verified";
  pill.textContent = "Verified";
  pill.setAttribute("data-testid", "verification-pill");
  pill.setAttribute("aria-label", "Verification: Verified");
  return pill;
}
