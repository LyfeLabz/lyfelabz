import { openGradeConfirmDialog } from "./confirm-dialog";
import { formatGradePercent } from "./roster-pill";
import {
  isStaleGradeImprovementError,
  type GradeImprovementEvent,
  type GradeImprovementHistory,
  type GradeImprovementsSeam,
} from "./types";

// Student Detail: a discreet grade-update status beneath a card's score
// tiles, with "View update history" and an Undo for the acknowledgment in
// effect. Rendered only for an assignment occurrence that has history; a
// card with none gets nothing. Wording always says the TEACHER marked the
// grade updated; LyfeLabz never verifies PowerSchool.

export type StudentGradeHistoryOptions = {
  readonly classId: string;
  readonly studentId: string;
  readonly seam: GradeImprovementsSeam;
  // Student Support Access (PDR-032): a support educator's read-only Student
  // Detail shows status and history but never the Undo control.
  readonly readOnly?: boolean;
  // The assignment occurrences a card covers (one, or a whole Current
  // occurrence group). Keyed by the card's `data-assignment-id`.
  readonly occurrencesForCard: (cardAssignmentId: string) => ReadonlyArray<string>;
  // Optional short label for an occurrence, used only when a card shows
  // history for more than one occurrence.
  readonly occurrenceLabel?: (assignmentId: string) => string | null;
};

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatDateTime(ms: number): string {
  const d = new Date(ms);
  return `${formatDate(ms)}, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
}

export function describeGradeStatus(history: GradeImprovementHistory): string | null {
  if (history.events.length === 0) return null;
  const effective = history.effective;
  if (effective !== null) {
    const event = history.events.find((e) => e.eventId === effective.eventId);
    const when = event?.createdAt != null ? ` on ${formatDate(event.createdAt)}` : "";
    return `Grade marked updated to ${formatGradePercent(effective.percentage)}${when}`;
  }
  const latest = history.events[0]!;
  const when = latest.createdAt != null ? ` on ${formatDate(latest.createdAt)}` : "";
  return `Grade update undone${when}`;
}

function describeEvent(e: GradeImprovementEvent): string {
  const parts = [
    e.type === "acknowledged"
      ? `Marked updated to ${formatGradePercent(e.percentage)}`
      : `Undid mark at ${formatGradePercent(e.percentage)}`,
  ];
  if (e.createdAt !== null) parts.push(formatDateTime(e.createdAt));
  // The caller's own actions carry no attribution; byCaller stays in the
  // audit record either way.
  if (!e.byCaller) parts.push("by another teacher");
  return parts.join(" · ");
}

export async function decorateStudentDetailGradeHistory(
  list: HTMLElement,
  opts: StudentGradeHistoryOptions,
): Promise<void> {
  let records: ReadonlyArray<GradeImprovementHistory>;
  try {
    records = await opts.seam.listForStudent({ classId: opts.classId, studentId: opts.studentId });
  } catch {
    return;
  }
  if (!list.isConnected) return;
  const byAssignment = new Map(records.filter((r) => r.studentId === opts.studentId).map((r) => [r.assignmentId, r]));
  if (byAssignment.size === 0) return;
  for (const card of Array.from(list.querySelectorAll<HTMLElement>("li[data-assignment-id]"))) {
    const grid = card.querySelector<HTMLElement>("[data-testid=student-detail-metrics]");
    if (grid === null) continue;
    const cardId = card.getAttribute("data-assignment-id") ?? "";
    const histories = opts
      .occurrencesForCard(cardId)
      .map((id) => byAssignment.get(id))
      .filter((h): h is GradeImprovementHistory => h !== undefined && h.events.length > 0);
    let anchor: Element = grid;
    for (const history of histories) {
      const label = histories.length > 1 ? (opts.occurrenceLabel?.(history.assignmentId) ?? null) : null;
      const block = card.ownerDocument.createElement("div");
      renderBlock(block, history, label, opts);
      anchor.after(block);
      anchor = block;
    }
  }
}

function renderBlock(
  block: HTMLElement,
  history: GradeImprovementHistory,
  label: string | null,
  opts: StudentGradeHistoryOptions,
): void {
  const doc = block.ownerDocument;
  const id = history.assignmentId;
  block.replaceChildren();
  block.className = "shell-student-detail-grade-update";
  block.setAttribute("data-testid", `student-detail-grade-update-${id}`);

  const status = describeGradeStatus(history);
  if (status === null) {
    block.remove();
    return;
  }
  const line = doc.createElement("p");
  line.className = "shell-student-detail-grade-update-status";
  line.setAttribute("data-testid", `student-detail-grade-update-status-${id}`);
  line.setAttribute("role", "status");
  line.textContent = label === null ? status : `${label}: ${status}`;
  block.appendChild(line);

  const controls = doc.createElement("div");
  controls.className = "shell-student-detail-grade-update-controls";
  block.appendChild(controls);

  const panelId = `student-detail-grade-update-history-${id}`;
  const toggle = doc.createElement("button");
  toggle.type = "button";
  toggle.className = "shell-student-detail-grade-update-toggle";
  toggle.setAttribute("data-testid", `student-detail-grade-update-toggle-${id}`);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panelId);
  toggle.textContent = "View update history";
  controls.appendChild(toggle);

  const effective = history.effective;
  if (effective !== null && opts.readOnly !== true) {
    const undo = doc.createElement("button");
    undo.type = "button";
    undo.className = "shell-student-detail-grade-update-undo";
    undo.setAttribute("data-testid", `student-detail-grade-update-undo-${id}`);
    undo.setAttribute("aria-haspopup", "dialog");
    undo.setAttribute("aria-label", `Undo grade marked updated to ${formatGradePercent(effective.percentage)}`);
    undo.textContent = "Undo";
    undo.addEventListener("click", () => {
      openGradeConfirmDialog(doc, {
        testid: "student-detail-grade-undo-dialog",
        title: "Undo Grade Update?",
        body: `This removes your mark that the grade was updated to ${formatGradePercent(effective.percentage)}. If the improvement still needs a PowerSchool update, Update Grade will appear again. Quiz scores are not changed.`,
        confirmLabel: "Undo",
        returnFocusTo: undo,
        // A successful Undo re-renders the block and removes this button, so
        // focus moves to the new history toggle. Done on close, after the
        // dialog's focus trap is gone; focusing earlier is pulled back into
        // the dialog and then lost to body when the overlay is removed.
        onClose: (confirmed) => {
          if (!confirmed) return;
          const toggle = block.isConnected
            ? block.querySelector<HTMLElement>(".shell-student-detail-grade-update-toggle")
            : null;
          toggle?.focus({ preventScroll: true });
        },
        onConfirm: async () => {
          try {
            const result = await opts.seam.reverse({
              assignmentId: id,
              studentId: opts.studentId,
              eventId: effective.eventId,
            });
            renderBlock(block, result.history, label, opts);
            return { ok: true };
          } catch (err) {
            if (isStaleGradeImprovementError(err)) {
              void refreshBlock(block, id, label, opts);
              return {
                ok: false,
                message: "This grade update changed. Nothing was undone. Close this to see the latest history.",
                allowRetry: false,
              };
            }
            return { ok: false, message: "We couldn't undo this. Please try again.", allowRetry: true };
          }
        },
      });
    });
    controls.appendChild(undo);
  }

  const panel = doc.createElement("ol");
  panel.id = panelId;
  panel.className = "shell-student-detail-grade-update-history";
  panel.setAttribute("data-testid", `student-detail-grade-update-history-${id}`);
  panel.hidden = true;
  for (const e of history.events) {
    const item = doc.createElement("li");
    item.className = "shell-student-detail-grade-update-event";
    item.setAttribute("data-event-type", e.type);
    item.textContent = describeEvent(e);
    panel.appendChild(item);
  }
  block.appendChild(panel);

  toggle.addEventListener("click", () => {
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.textContent = open ? "Hide update history" : "View update history";
    panel.hidden = !open;
  });
}

async function refreshBlock(
  block: HTMLElement,
  assignmentId: string,
  label: string | null,
  opts: StudentGradeHistoryOptions,
): Promise<void> {
  try {
    const records = await opts.seam.listForStudent({ classId: opts.classId, studentId: opts.studentId });
    const next = records.find((r) => r.assignmentId === assignmentId);
    if (next !== undefined && block.isConnected) renderBlock(block, next, label, opts);
  } catch {
    // Keep the current block; the dialog already told the teacher.
  }
}

// Exported for tests.
export const __test = { describeEvent };
