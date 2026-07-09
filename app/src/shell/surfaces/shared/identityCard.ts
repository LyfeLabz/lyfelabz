import { renderVerificationPill } from "./verificationPill";

// Identity summary card. Displays the minimum teacher identity required
// to confirm the caller is signed in as themselves at their school. Never
// renders uid, custom claim payloads, lifecycle status strings, or
// project identifiers. See SPRINT_3_STEP_5_SPECIFICATION.md §6.3, §7.
export type IdentityCardInput = {
  readonly displayName: string;
  readonly schoolName: string | null;
};

export function renderIdentityCard(
  doc: Document,
  input: IdentityCardInput,
): HTMLElement {
  const card = doc.createElement("section");
  card.className = "shell-card shell-identity-card";
  card.setAttribute("data-testid", "identity-card");
  card.setAttribute("aria-label", "Signed-in identity summary");

  const dl = doc.createElement("dl");
  dl.className = "shell-identity-list";

  appendRow(doc, dl, "Signed in as", input.displayName, "identity-name");
  if (input.schoolName !== null && input.schoolName !== "") {
    appendRow(doc, dl, "School", input.schoolName, "identity-school");
  }
  appendRow(doc, dl, "Role", "Teacher", "identity-role");

  const verificationRow = doc.createElement("div");
  verificationRow.className = "shell-identity-row";
  const vLabel = doc.createElement("dt");
  vLabel.textContent = "Verification";
  const vValue = doc.createElement("dd");
  vValue.appendChild(renderVerificationPill(doc));
  verificationRow.appendChild(vLabel);
  verificationRow.appendChild(vValue);
  dl.appendChild(verificationRow);

  card.appendChild(dl);
  return card;
}

function appendRow(
  doc: Document,
  dl: HTMLElement,
  label: string,
  value: string,
  testId: string,
): void {
  const row = doc.createElement("div");
  row.className = "shell-identity-row";
  const dt = doc.createElement("dt");
  dt.textContent = label;
  const dd = doc.createElement("dd");
  dd.textContent = value;
  dd.setAttribute("data-testid", testId);
  row.appendChild(dt);
  row.appendChild(dd);
  dl.appendChild(row);
}
