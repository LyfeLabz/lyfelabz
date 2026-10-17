/**
 * @jest-environment jsdom
 *
 * Grade Improvements V1: Student Detail grade-update status, history, and
 * Undo. Built on a card DOM shaped like `classes.ts` Student Detail cards
 * (li[data-assignment-id] > dl[data-testid=student-detail-metrics] + Show
 * Your Thinking toggle).
 */
import { decorateStudentDetailGradeHistory, describeGradeStatus } from "./student-history";
import type { GradeImprovementHistory, GradeImprovementsSeam } from "./types";

const flush = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 10; i += 1) await flush();
};

const OCT_17 = new Date(2026, 9, 17, 14, 5).getTime();
const OCT_18 = new Date(2026, 9, 18, 9, 30).getTime();

const ACKED: GradeImprovementHistory = {
  assignmentId: "a1",
  studentId: "s1",
  effective: { eventId: "e000001", percentage: 90, attemptId: "t3" },
  events: [
    { eventId: "e000001", type: "acknowledged", percentage: 90, attemptId: "t3", baselinePercentage: 60, targetEventId: null, createdAt: OCT_17, byCaller: true },
  ],
};

const UNDONE: GradeImprovementHistory = {
  assignmentId: "a1",
  studentId: "s1",
  effective: null,
  events: [
    { eventId: "e000002", type: "reversed", percentage: 90, attemptId: "t3", baselinePercentage: null, targetEventId: "e000001", createdAt: OCT_18, byCaller: true },
    ACKED.events[0]!,
  ],
};

function buildList(): HTMLElement {
  const list = document.createElement("ul");
  list.innerHTML = `
    <li data-assignment-id="a1"><h3>Earth's Layers</h3>
      <dl data-testid="student-detail-metrics"><div><dt>Best score</dt><dd data-testid="student-detail-best-score">90%</dd></div></dl>
      <button data-testid="student-detail-thinking-toggle">Show Your Thinking</button>
    </li>
    <li data-assignment-id="a2"><h3>Water Cycle</h3>
      <dl data-testid="student-detail-metrics"><div><dt>Best score</dt><dd>70%</dd></div></dl>
    </li>
    <li data-assignment-id="a3"><p>Not started</p></li>`;
  document.body.appendChild(list);
  return list;
}

function seam(records: GradeImprovementHistory[], overrides: Partial<GradeImprovementsSeam> = {}) {
  return {
    listForAssignment: jest.fn(),
    listForStudent: jest.fn(async () => records),
    acknowledge: jest.fn(),
    reverse: jest.fn(async () => ({ status: "reversed" as const, pending: null, history: UNDONE })),
    ...overrides,
  };
}

async function decorate(list: HTMLElement, s: GradeImprovementsSeam, occurrences?: (id: string) => string[]) {
  await decorateStudentDetailGradeHistory(list, {
    classId: "c1",
    studentId: "s1",
    seam: s,
    occurrencesForCard: occurrences ?? ((id) => [id]),
    occurrenceLabel: (id) => `Assigned ${id}`,
  });
  await settle();
}

const q = <T extends HTMLElement = HTMLElement>(id: string) => document.querySelector<T>(`[data-testid="${id}"]`);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("Student Detail grade-update history", () => {
  test("shows a teacher-marked status beneath the score tiles, before Show Your Thinking", async () => {
    const list = buildList();
    await decorate(list, seam([ACKED]));
    const block = q("student-detail-grade-update-a1")!;
    const card = list.querySelector('li[data-assignment-id="a1"]')!;
    expect(card.querySelector("[data-testid=student-detail-metrics]")!.nextElementSibling).toBe(block);
    expect(block.nextElementSibling).toBe(q("student-detail-thinking-toggle"));
    expect(q("student-detail-grade-update-status-a1")!.textContent).toBe("Grade marked updated to 90% on Oct 17, 2026");
    // Never claims LyfeLabz verified PowerSchool.
    expect(block.textContent).not.toMatch(/verified|synced|PowerSchool/i);
  });

  test("existing score tiles are unchanged", async () => {
    const list = buildList();
    await decorate(list, seam([ACKED]));
    expect(q("student-detail-best-score")!.textContent).toBe("90%");
  });

  test("renders nothing for cards without history, or when the read fails", async () => {
    const list = buildList();
    await decorate(list, seam([ACKED]));
    expect(q("student-detail-grade-update-a2")).toBeNull();
    expect(list.querySelectorAll(".shell-student-detail-grade-update")).toHaveLength(1);

    document.body.innerHTML = "";
    const list2 = buildList();
    await decorate(list2, seam([], { listForStudent: jest.fn(async () => Promise.reject(new Error("x"))) }));
    expect(list2.querySelector(".shell-student-detail-grade-update")).toBeNull();
  });

  test("history disclosure lists events newest first with type, score, time, and teacher", async () => {
    const list = buildList();
    await decorate(list, seam([UNDONE]));
    expect(q("student-detail-grade-update-status-a1")!.textContent).toBe("Grade update undone on Oct 18, 2026");
    const toggle = q<HTMLButtonElement>("student-detail-grade-update-toggle-a1")!;
    const panel = q("student-detail-grade-update-history-a1")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.hidden).toBe(true);
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    const items = Array.from(panel.querySelectorAll("li")).map((li) => li.textContent);
    expect(items).toEqual([
      "Undid mark at 90% · Oct 18, 2026, 9:30 AM · by you",
      "Marked updated to 90% · Oct 17, 2026, 2:05 PM · by you",
    ]);
    // No Undo when nothing is in effect.
    expect(q("student-detail-grade-update-undo-a1")).toBeNull();
  });

  test("Undo requires confirmation; Cancel does nothing", async () => {
    const list = buildList();
    const s = seam([ACKED]);
    await decorate(list, s);
    q<HTMLButtonElement>("student-detail-grade-update-undo-a1")!.click();
    expect(q("student-detail-grade-undo-dialog")).not.toBeNull();
    expect(q("student-detail-grade-undo-dialog-body")!.textContent).toContain("updated to 90%");
    q<HTMLButtonElement>("student-detail-grade-undo-dialog-cancel")!.click();
    expect(q("student-detail-grade-undo-dialog")).toBeNull();
    expect(s.reverse).not.toHaveBeenCalled();
  });

  test("confirmed Undo reverses the effective event and re-renders the history", async () => {
    const list = buildList();
    const s = seam([ACKED]);
    await decorate(list, s);
    q<HTMLButtonElement>("student-detail-grade-update-undo-a1")!.click();
    q<HTMLButtonElement>("student-detail-grade-undo-dialog-confirm")!.click();
    await settle();
    expect(s.reverse).toHaveBeenCalledWith({ assignmentId: "a1", studentId: "s1", eventId: "e000001" });
    expect(q("student-detail-grade-undo-dialog")).toBeNull();
    expect(q("student-detail-grade-update-status-a1")!.textContent).toBe("Grade update undone on Oct 18, 2026");
    expect(q("student-detail-grade-update-undo-a1")).toBeNull();
  });

  test("confirmed Undo moves focus to the re-rendered history toggle, never body", async () => {
    const list = buildList();
    await decorate(list, seam([ACKED]));
    const undo = q<HTMLButtonElement>("student-detail-grade-update-undo-a1")!;
    undo.focus();
    undo.click();
    q<HTMLButtonElement>("student-detail-grade-undo-dialog-confirm")!.click();
    // While saving, focus stays inside the modal.
    expect(q("student-detail-grade-undo-dialog")!.contains(document.activeElement)).toBe(true);
    await settle();
    // The original Undo button was removed by the re-render.
    expect(undo.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(q("student-detail-grade-update-toggle-a1"));
  });

  test("Cancel and Escape return focus to the Undo button", async () => {
    const list = buildList();
    await decorate(list, seam([ACKED]));
    const undo = q<HTMLButtonElement>("student-detail-grade-update-undo-a1")!;
    undo.focus();
    undo.click();
    expect(document.activeElement).toBe(q("student-detail-grade-undo-dialog-cancel"));
    q<HTMLButtonElement>("student-detail-grade-undo-dialog-cancel")!.click();
    expect(document.activeElement).toBe(undo);
    undo.click();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(q("student-detail-grade-undo-dialog")).toBeNull();
    expect(document.activeElement).toBe(undo);
  });

  test("focus outside the open Undo dialog is pulled back in", async () => {
    const list = buildList();
    await decorate(list, seam([ACKED]));
    q<HTMLButtonElement>("student-detail-grade-update-undo-a1")!.click();
    q<HTMLButtonElement>("student-detail-grade-update-toggle-a1")!.focus();
    expect(q("student-detail-grade-undo-dialog")!.contains(document.activeElement)).toBe(true);
  });

  test("a stale Undo undoes nothing and refreshes the block", async () => {
    const newer: GradeImprovementHistory = {
      ...ACKED,
      effective: { eventId: "e000002", percentage: 100, attemptId: "t4" },
      events: [
        { eventId: "e000002", type: "acknowledged", percentage: 100, attemptId: "t4", baselinePercentage: 90, targetEventId: null, createdAt: OCT_18, byCaller: true },
        ACKED.events[0]!,
      ],
    };
    const staleErr = Object.assign(new Error("stale"), { details: { code: "gradeImprovements.stale" } });
    const list = buildList();
    const s = seam([ACKED], {
      listForStudent: jest.fn().mockResolvedValueOnce([ACKED]).mockResolvedValue([newer]),
      reverse: jest.fn(async () => Promise.reject(staleErr)),
    });
    await decorate(list, s);
    q<HTMLButtonElement>("student-detail-grade-update-undo-a1")!.click();
    q<HTMLButtonElement>("student-detail-grade-undo-dialog-confirm")!.click();
    await settle();
    expect(q("student-detail-grade-undo-dialog-error")!.textContent).toContain("Nothing was undone");
    expect(q("student-detail-grade-update-status-a1")!.textContent).toBe("Grade marked updated to 100% on Oct 18, 2026");
  });

  test("a group card shows one labeled block per occurrence with history", async () => {
    const list = buildList();
    await decorate(list, seam([ACKED, { ...ACKED, assignmentId: "a0" }]), (id) => (id === "a1" ? ["a0", "a1"] : [id]));
    const blocks = list.querySelectorAll('li[data-assignment-id="a1"] .shell-student-detail-grade-update');
    expect(blocks).toHaveLength(2);
    expect(q("student-detail-grade-update-status-a0")!.textContent).toBe("Assigned a0: Grade marked updated to 90% on Oct 17, 2026");
  });

  test("describeGradeStatus returns null with no events", () => {
    expect(describeGradeStatus({ assignmentId: "a", studentId: "s", effective: null, events: [] })).toBeNull();
  });
});
