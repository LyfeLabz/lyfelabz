import { openGradeConfirmDialog } from "./confirm-dialog";
import {
  isStaleGradeImprovementError,
  type GradeImprovementPending,
  type GradeImprovementsSeam,
} from "./types";

// Assignment Detail roster: an "Update Grade" pill beside the attempt count of
// each Completed row whose student has a pending improvement on THIS
// assignment occurrence. Best-effort and additive: the roster is already
// rendered; a failed read renders nothing and never changes the roster.

const PILL_CLASS = "shell-assignment-detail-roster-grade-update";
// On the roster groups host while any pill is shown: gives every row the same
// fourth column so scores and attempt counts stay aligned (see index.html).
const HAS_PILLS_CLASS = "shell-assignment-detail-roster-has-grade-updates";

// Attribute-selector value escaping (ids are URL-safe tokens; this is
// defense in depth and avoids depending on `CSS.escape`).
function attr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

export function formatGradePercent(value: number): string {
  // Same rounding as the roster score cell.
  return `${Math.round(value * 10) / 10}%`;
}

export async function mountGradeImprovementPills(
  host: HTMLElement,
  assignmentId: string,
  seam: GradeImprovementsSeam,
): Promise<void> {
  let pending: ReadonlyArray<GradeImprovementPending>;
  try {
    pending = await seam.listForAssignment({ assignmentId });
  } catch {
    return;
  }
  applyPills(host, assignmentId, seam, pending);
}

function applyPills(
  host: HTMLElement,
  assignmentId: string,
  seam: GradeImprovementsSeam,
  pending: ReadonlyArray<GradeImprovementPending>,
): void {
  if (!host.isConnected) return;
  for (const old of Array.from(host.querySelectorAll(`.${PILL_CLASS}`))) old.remove();
  for (const p of pending) {
    if (p.assignmentId !== assignmentId) continue;
    const summary = host.querySelector<HTMLElement>(
      `[data-testid="assignment-detail-roster-summary-${attr(p.studentId)}"]`,
    );
    if (summary === null) continue;
    summary.appendChild(createPill(host, assignmentId, seam, p));
  }
  syncLayoutClass(host);
}

function syncLayoutClass(host: HTMLElement): void {
  host.classList.toggle(HAS_PILLS_CLASS, host.querySelector(`.${PILL_CLASS}`) !== null);
}

function createPill(
  host: HTMLElement,
  assignmentId: string,
  seam: GradeImprovementsSeam,
  p: GradeImprovementPending,
): HTMLButtonElement {
  const doc = host.ownerDocument;
  const row = host.querySelector<HTMLElement>(`[data-student-id="${attr(p.studentId)}"]`);
  const name = row?.getAttribute("data-student-name") ?? "this student";
  const from = formatGradePercent(p.baselinePercentage);
  const to = formatGradePercent(p.bestPercentage);

  const pill = doc.createElement("button");
  pill.type = "button";
  pill.className = PILL_CLASS;
  pill.setAttribute("data-testid", `assignment-detail-roster-grade-update-${p.studentId}`);
  pill.setAttribute("aria-label", `Update Grade: ${name} improved from ${from} to ${to}`);
  pill.setAttribute("aria-haspopup", "dialog");
  pill.textContent = "Update Grade";

  pill.addEventListener("click", () => {
    openGradeConfirmDialog(doc, {
      testid: "assignment-detail-grade-update-dialog",
      title: "Mark Grade as Updated?",
      body: `Have you updated ${name}'s PowerSchool grade from ${from} to ${to}?`,
      confirmLabel: "Yes, Updated",
      returnFocusTo: pill,
      onConfirm: async () => {
        try {
          const result = await seam.acknowledge({
            assignmentId,
            studentId: p.studentId,
            attemptId: p.bestAttemptId,
            percentage: p.bestPercentage,
          });
          replacePending(host, assignmentId, seam, p.studentId, result.pending);
          return { ok: true };
        } catch (err) {
          if (isStaleGradeImprovementError(err)) {
            // The score changed after this dialog opened. Nothing was
            // marked; refresh so the teacher reviews the newer score.
            void mountGradeImprovementPills(host, assignmentId, seam);
            return {
              ok: false,
              message: "This student's score changed. Nothing was marked. Close this and review the new score.",
              allowRetry: false,
            };
          }
          return { ok: false, message: "We couldn't save this. Please try again.", allowRetry: true };
        }
      },
      onClose: (confirmed) => {
        if (!confirmed) return;
        // The pill is gone; keep focus on the student's row.
        const nameControl = row?.querySelector<HTMLElement>("button.shell-assignment-detail-roster-name");
        try {
          nameControl?.focus({ preventScroll: true });
        } catch {
          // ignored
        }
      },
    });
  });
  return pill;
}

function replacePending(
  host: HTMLElement,
  assignmentId: string,
  seam: GradeImprovementsSeam,
  studentId: string,
  next: GradeImprovementPending | null,
): void {
  const existing = host.querySelector(
    `[data-testid="assignment-detail-roster-grade-update-${attr(studentId)}"]`,
  );
  existing?.remove();
  if (next !== null) {
    const summary = host.querySelector<HTMLElement>(
      `[data-testid="assignment-detail-roster-summary-${attr(studentId)}"]`,
    );
    summary?.appendChild(createPill(host, assignmentId, seam, next));
  }
  syncLayoutClass(host);
}
