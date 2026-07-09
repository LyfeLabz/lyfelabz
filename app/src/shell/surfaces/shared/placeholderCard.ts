// Non-interactive placeholder card. Previews a future capability on the
// Home surface without committing to a delivery date. Never focusable,
// never activatable. See SPRINT_3_STEP_5_SPECIFICATION.md §6.4.
export type PlaceholderCardInput = {
  readonly title: string;
  readonly purpose: string;
  readonly testId: string;
};

export function renderPlaceholderCard(
  doc: Document,
  input: PlaceholderCardInput,
): HTMLElement {
  const card = doc.createElement("article");
  card.className = "shell-card shell-placeholder-card";
  card.setAttribute("data-testid", input.testId);
  card.setAttribute("aria-disabled", "true");

  const h3 = doc.createElement("h3");
  h3.className = "shell-placeholder-title";
  h3.textContent = input.title;
  card.appendChild(h3);

  const purpose = doc.createElement("p");
  purpose.className = "shell-placeholder-purpose";
  purpose.textContent = input.purpose;
  card.appendChild(purpose);

  const status = doc.createElement("p");
  status.className = "shell-placeholder-status";
  const em = doc.createElement("em");
  em.textContent = "Coming in a future sprint.";
  status.appendChild(em);
  card.appendChild(status);

  return card;
}
