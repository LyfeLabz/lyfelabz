/**
 * @jest-environment jsdom
 *
 * Student Support Access (PDR-032) on the Classes surface:
 *   - a support educator's "Shared students" list opens the SAME Student
 *     Detail renderer, read-only, through the student-scoped attempts read
 *     (never the owner-only class-wide list);
 *   - read-only Student Detail withholds the grade-update Undo but keeps the
 *     history, Show Your Thinking, and question review;
 *   - the owner's Class settings carry the "Share Student Progress" section;
 *   - owners get the same question review on their own Student Detail.
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ClassesSurfaceDeps } from "./classes";
import type {
  AttemptGetForTeacherCallable,
  CompletedAttemptSummary,
  TeacherVisibleAttempt,
} from "../../assignments/detail/attempts-wire";
import type { AssessmentStudentAssignmentsForClassCallable } from "../../assignments/detail/studentAssignments-wire";
import type { GradeImprovementsSeam } from "../../assignments/gradeImprovements/types";
import { installGradeImprovementsSeam } from "../../assignments/gradeImprovements/session";
import type { SharedStudent, StudentSupportSeam, SupportGrant } from "../../supportAccess/types";
import { renderClassesSurface } from "./classes";
import { readFileSync } from "fs";
import { join } from "path";

const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0));
};

const teacher: Extract<Session, { kind: "activeTeacher" }> = Object.freeze({
  kind: "activeTeacher",
  uid: "teacher-support",
  schoolId: "school-t",
  displayName: "Support Teacher",
});

const OWN_CLASS = "class-own";
const SHARED_CLASS = "class-shared";
const ownClasses: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({ id: OWN_CLASS, title: "(A) Science", status: "active", grade: "7", block: "A", isLmsLinked: false }),
] as ClassSummary[]);

const SHARED: SharedStudent = {
  grantId: `${SHARED_CLASS}__s-ada__teacher-support`,
  classId: SHARED_CLASS,
  classTitle: "Science 7B",
  studentId: "s-ada",
  studentDisplayName: "Ada Lovelace",
  ownerDisplayName: "Ms. Owner",
  classBlock: "B",
};

const REV = "assessment_earths-layers__r1";
const attempt = (attemptId: string, studentId: string, n: number, percentage: number): CompletedAttemptSummary => ({
  attemptId,
  studentId,
  studentDisplayName: "x",
  assignmentId: "a1",
  attemptNumber: n,
  score: Math.round(percentage / 10),
  maxScore: 10,
  percentage,
  submittedAt: Date.UTC(2026, 9, 1 + n),
});

const detailFor = (attemptId: string, studentId: string): TeacherVisibleAttempt => ({
  attemptId,
  studentId,
  assignmentId: "a1",
  attemptNumber: 1,
  percentage: 50,
  assessmentRevisionId: REV,
  canonicalContent: true,
  writtenResponse: "Convection moves the plates.",
  itemResults: [
    { itemId: "q1", isCorrect: false, correctOptionId: "B", studentResponse: "A", explanation: "Outer core is liquid." },
    { itemId: "q2", isCorrect: true, correctOptionId: "A", studentResponse: "A", explanation: null },
  ],
});

const history = {
  assignmentId: "a1",
  studentId: "s-ada",
  effective: { eventId: "e000001", percentage: 90, attemptId: "att-ada-2" },
  events: [
    { eventId: "e000001", type: "acknowledged" as const, percentage: 90, attemptId: "att-ada-2", baselinePercentage: 50, targetEventId: null, createdAt: Date.UTC(2026, 9, 5), byCaller: false },
  ],
};

function harness() {
  const classWideCalls: string[] = [];
  const studentScopedCalls: Array<{ classId: string; studentId: string }> = [];
  const detailCalls: string[] = [];
  const grantCalls: unknown[] = [];
  const revokeCalls: string[] = [];
  const reverse = jest.fn();
  let grants: SupportGrant[] = [
    { grantId: "g1", classId: OWN_CLASS, studentId: "s-ben", studentDisplayName: "Ben Baker", granteeDisplayName: "Mr. Para", granteeEmail: "para@school.org" },
  ];

  const seam: StudentSupportSeam = {
    listShared: async () => [SHARED],
    listForClass: async () => grants,
    grantMany: async (input) => {
      grantCalls.push(input);
      return [];
    },
    revoke: async (grantId) => {
      revokeCalls.push(grantId);
      grants = grants.filter((g) => g.grantId !== grantId);
    },
    revokeMany: async (grantIds) => {
      revokeCalls.push(...grantIds);
      return [];
    },
    listAttemptsForStudent: async (input) => {
      studentScopedCalls.push(input);
      return { classId: input.classId, studentId: input.studentId, attempts: [attempt("att-ada-1", "s-ada", 1, 50), attempt("att-ada-2", "s-ada", 2, 90)] };
    },
    revisionContent: async (revisionId) => ({
      revisionId,
      items: [
        { itemId: "q1", stem: "Which layer is liquid?", options: [{ optionId: "A", text: "Inner core" }, { optionId: "B", text: "Outer core" }] },
        { itemId: "q2", stem: "Which layer is thinnest?", options: [{ optionId: "A", text: "Crust" }, { optionId: "B", text: "Mantle" }] },
      ],
    }),
  };
  const attemptDetail: AttemptGetForTeacherCallable = async ({ attemptId }) => {
    detailCalls.push(attemptId);
    return detailFor(attemptId, attemptId.startsWith("att-ada") ? "s-ada" : "s-ben");
  };
  const expected: AssessmentStudentAssignmentsForClassCallable = async (input) => ({
    classId: input.classId,
    studentId: input.studentId,
    assignments: [{ assignmentId: "a1", hasLiveSession: false }],
  });
  const gradeSeam: GradeImprovementsSeam = {
    listForAssignment: async () => [],
    listForStudent: async (input) => [{ ...history, studentId: input.studentId }],
    acknowledge: jest.fn(),
    reverse,
  };
  installGradeImprovementsSeam(gradeSeam);
  const deps: ClassesSurfaceDeps = {
    listClasses: async () => ownClasses,
    loadRoster: () => async (input: { classId: string }) => ({
      classId: input.classId,
      students: [
        { studentId: "s-ben", studentDisplayName: "Ben Baker" },
        { studentId: "s-cara", studentDisplayName: "Cara Cole" },
      ],
    }),
    loadAttempts: () => async (input: { classId: string }) => {
      classWideCalls.push(input.classId);
      return { classId: input.classId, attempts: [attempt("att-ben-1", "s-ben", 1, 50)] };
    },
    loadExpectedAssignments: () => expected,
    loadAttemptDetail: () => attemptDetail,
    studentSupport: seam,
  };
  return { deps, classWideCalls, studentScopedCalls, detailCalls, grantCalls, revokeCalls, reverse };
}

const q = (root: ParentNode, sel: string) => root.querySelector<HTMLElement>(sel);
const qa = (root: ParentNode, sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));

async function mountSurface(h: ReturnType<typeof harness>) {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  renderClassesSurface(mount, teacher, h.deps);
  await settle();
  return mount;
}

afterEach(() => {
  installGradeImprovementsSeam(null);
  document.body.replaceChildren();
});

describe("Shared students (support educator)", () => {
  it("lists shared students beneath the teacher's own classes", async () => {
    const h = harness();
    const mount = await mountSurface(h);
    const section = q(mount, "[data-testid=classes-shared-students]")!;
    expect(section).not.toBeNull();
    expect(section.textContent).toContain("Shared students");
    const button = q(section, "[data-testid=classes-shared-student]")!;
    expect(button.textContent).toContain("Ada Lovelace");
    expect(button.textContent).toContain("Ms. Owner · Science 7B");
    expect(q(mount, `[data-testid=class-card-${OWN_CLASS}]`)).not.toBeNull();
  });

  it("opens the existing Student Detail read-only through the student-scoped read only", async () => {
    const h = harness();
    const mount = await mountSurface(h);
    q(mount, "[data-testid=classes-shared-student]")!.click();
    await settle();

    expect(q(mount, "[data-testid=student-detail]")).not.toBeNull();
    expect(q(mount, "[data-testid=student-detail-name]")!.textContent).toBe("Ada Lovelace");
    expect(q(mount, "[data-testid=student-detail-shared-context]")!.textContent).toBe(
      "Ms. Owner · Science 7B",
    );
    expect(h.studentScopedCalls).toEqual([{ classId: SHARED_CLASS, studentId: "s-ada" }]);
    expect(h.classWideCalls).toEqual([]);
    // No roster: no Previous/Next.
    expect(q(mount, "[data-testid=student-detail-nav]")).toBeNull();

    // Same cards and metrics as the owner view.
    const card = q(mount, "[data-testid=student-detail-assignments] > li")!;
    expect(card.getAttribute("data-assignment-status")).toBe("completed");
    expect(q(card, "[data-testid=student-detail-metrics]")).not.toBeNull();

    // Grade-update history is shown, Undo is not.
    expect(q(card, "[data-testid=student-detail-grade-update-status-a1]")).not.toBeNull();
    expect(q(card, "[data-testid=student-detail-grade-update-undo-a1]")).toBeNull();
    expect(qa(mount, "button").some((b) => b.textContent === "Undo")).toBe(false);

    // Show Your Thinking and question review both work for the grantee.
    q(card, "[data-testid=student-detail-thinking-toggle]")!.click();
    await settle();
    expect(q(card, "[data-testid=student-detail-thinking-text]")!.textContent).toBe("Convection moves the plates.");
    q(card, "[data-testid=student-detail-review-toggle]")!.click();
    await settle();
    expect(q(card, "[data-testid=student-detail-review-summary]")!.textContent).toBe("1 of 2 correct");
    expect(q(card, "[data-testid=student-detail-review-student-answer]")!.textContent).toBe("A. Inner core");
    expect(q(card, "[data-testid=student-detail-review-correct-answer]")!.textContent).toBe("B. Outer core");
    expect(h.detailCalls.every((id) => id.startsWith("att-ada"))).toBe(true);
    expect(h.reverse).not.toHaveBeenCalled();
  });

  it("gives the grantee the same Review answers action, defaults and repeated misses", async () => {
    const h = harness();
    const mount = await mountSurface(h);
    q(mount, "[data-testid=classes-shared-student]")!.click();
    await settle();
    const card = q(mount, "[data-testid=student-detail-assignments] > li")!;
    const toggle = q(card, "[data-testid=student-detail-review-toggle]")!;
    // Latest attempt (att-ada-2) scored 9 of 10.
    expect(toggle.textContent).toBe("Review answers · 1 incorrect");
    q(card, "[data-testid=student-detail-thinking-toggle]")!.click();
    await settle();
    toggle.click();
    await settle();
    const select = q(card, "[data-testid=student-detail-review-select]") as HTMLSelectElement;
    expect(select.selectedOptions[0]!.textContent).toMatch(/^Latest attempt · 90% · /);
    expect(Array.from(select.options).map((o) => o.textContent!.split(" · ")[0])).toEqual([
      "Latest attempt",
      "Previous attempt 1",
    ]);
    expect((q(card, "[data-testid=student-detail-review-incorrect-only]") as HTMLInputElement).checked).toBe(true);
    expect(qa(card, ".shell-student-detail-review-item").filter((li) => !li.hidden).map((li) => li.getAttribute("data-status"))).toEqual([
      "incorrect",
    ]);
    const repeat = qa(card, "[data-testid=student-detail-repeat-item]");
    expect(repeat).toHaveLength(1);
    expect(q(repeat[0]!, "[data-testid=student-detail-repeat-count]")!.textContent).toBe("Missed 2 of 2 attempts");
    expect(q(repeat[0]!, "[data-testid=student-detail-repeat-stem]")!.textContent).toBe("Which layer is liquid?");
    // Show Your Thinking, the review and the repeated-miss check share one
    // read per attempt, all through the grantee's authorized callable.
    expect([...h.detailCalls].sort()).toEqual(["att-ada-1", "att-ada-2"]);
  });

  it("returns to the Classes list and re-reads the shared list", async () => {
    const h = harness();
    const mount = await mountSurface(h);
    q(mount, "[data-testid=classes-shared-student]")!.click();
    await settle();
    const back = q(mount, "[data-testid=student-detail-back]")!;
    expect(back.textContent).toBe("Back to Shared students");
    back.click();
    await settle();
    expect(q(mount, "[data-testid=student-detail]")).toBeNull();
    expect(q(mount, "[data-testid=classes-shared-students]")).not.toBeNull();
  });

  it("renders no shared section when nothing is shared", async () => {
    const h = harness();
    (h.deps as { studentSupport: StudentSupportSeam }).studentSupport = {
      ...h.deps.studentSupport!,
      listShared: async () => [],
    };
    const mount = await mountSurface(h);
    expect(q(mount, "[data-testid=classes-shared-students]")).toBeNull();
  });
});

describe("Owner Student Detail", () => {
  it("keeps Undo for the owner and adds the same question review", async () => {
    const h = harness();
    const mount = await mountSurface(h);
    q(mount, `[data-testid=class-card-${OWN_CLASS}]`)!.click();
    await settle();
    q(mount, "[data-testid=class-nav-roster]")!.click();
    await settle();
    q(mount, '[data-student-id="s-ben"]')!.click();
    await settle();
    expect(h.classWideCalls).toEqual([OWN_CLASS]);
    expect(h.studentScopedCalls).toEqual([]);
    expect(q(mount, "[data-testid=student-detail-back]")!.textContent).toBe("Back to Students");
    expect(q(mount, "[data-testid=student-detail-shared-context]")).toBeNull();
    const card = q(mount, "[data-testid=student-detail-assignments] > li")!;
    expect(q(card, "[data-testid=student-detail-grade-update-undo-a1]")).not.toBeNull();
    q(card, "[data-testid=student-detail-review-toggle]")!.click();
    await settle();
    expect(q(card, "[data-testid=student-detail-review-summary]")!.textContent).toBe("1 of 2 correct");
    expect(q(card, "[data-testid=student-detail-review-stem]")!.textContent).toBe("Which layer is liquid?");
    // One attempt: Latest attempt, its own incorrect count, no repeated-miss section.
    expect(q(card, "[data-testid=student-detail-review-toggle]")!.textContent).toBe("Review answers · 5 incorrect");
    expect(q(card, "[data-testid=student-detail-review-attempt-label]")!.textContent).toMatch(/^Latest attempt · 50% · /);
    expect(q(card, "[data-testid=student-detail-repeat]")).toBeNull();
  });
});

describe("Class settings (owner)", () => {
  it("no longer hosts Share Student Progress; sharing lives in Settings > Student Services", async () => {
    const h = harness();
    const mount = await mountSurface(h);
    q(mount, `[data-testid=class-card-settings-${OWN_CLASS}]`)!.click();
    await settle();
    const dialog = q(document.body, "[data-testid=classes-settings-dialog]")!;
    expect(q(dialog, "[data-testid=classes-settings-title-input]")).not.toBeNull();
    expect(q(dialog, "[data-testid=classes-settings-grade]")).not.toBeNull();
    expect(q(dialog, "[data-testid=classes-settings-support]")).toBeNull();
    expect(dialog.textContent ?? "").not.toContain("Share Student Progress");
    expect(h.grantCalls).toEqual([]);
  });
});

describe("Classes landing with and without shared students", () => {
  it("a teacher with no classes but shared students sees Shared students, not the add-a-class prompt", async () => {
    const h = harness();
    (h.deps as { listClasses: () => Promise<ReadonlyArray<ClassSummary>> }).listClasses = async () => [];
    const mount = await mountSurface(h);
    expect(q(mount, "[data-testid=classes-shared-students]")).not.toBeNull();
    expect(q(mount, "[data-testid=classes-empty]")).toBeNull();
    expect(q(mount, "[data-testid=classes-go-to-settings]")).toBeNull();
    expect(mount.textContent).not.toContain("No classes yet.");
    expect(q(mount, "#surface-headline")!.textContent).toBe("Classes");
  });

  it("a teacher with classes and shared students sees both", async () => {
    const h = harness();
    const mount = await mountSurface(h);
    expect(q(mount, `[data-testid=class-card-${OWN_CLASS}]`)).not.toBeNull();
    expect(q(mount, "[data-testid=classes-shared-students]")).not.toBeNull();
    expect(q(mount, "[data-testid=classes-status]")!.textContent).toBe("1 class");
  });

  function deferredShared(h: ReturnType<typeof harness>, ownedClasses: ReadonlyArray<ClassSummary>) {
    let resolve!: (students: SharedStudent[]) => void;
    let reject!: (err: Error) => void;
    (h.deps as { listClasses: () => Promise<ReadonlyArray<ClassSummary>> }).listClasses = async () => ownedClasses;
    (h.deps as { studentSupport: StudentSupportSeam }).studentSupport = {
      ...h.deps.studentSupport!,
      listShared: () =>
        new Promise((res, rej) => {
          resolve = res;
          reject = rej;
        }),
    };
    return { resolve: (s: SharedStudent[]) => resolve(s), reject: (e: Error) => reject(e) };
  }

  it("a zero-class teacher never sees the add-a-class prompt while shared students load", async () => {
    const h = harness();
    const shared = deferredShared(h, []);
    const mount = await mountSurface(h);
    expect(q(mount, "[data-testid=classes-status]")!.textContent).toBe("Loading classes");
    expect(q(mount, "[data-testid=classes-empty]")).toBeNull();
    expect(mount.textContent).not.toContain("No classes yet.");
    shared.resolve([SHARED]);
    await settle();
    expect(q(mount, "[data-testid=classes-shared-students]")).not.toBeNull();
    expect(q(mount, "[data-testid=classes-empty]")).toBeNull();
    expect(mount.textContent).not.toContain("No classes yet.");
    expect(mount.textContent).not.toContain("Loading classes");
  });

  it("a zero-class teacher sees the empty state only once the shared read confirms none", async () => {
    const h = harness();
    const shared = deferredShared(h, []);
    const mount = await mountSurface(h);
    expect(q(mount, "[data-testid=classes-empty]")).toBeNull();
    shared.resolve([]);
    await settle();
    expect(q(mount, "[data-testid=classes-status]")!.textContent).toBe("No classes yet.");
    expect(q(mount, "[data-testid=classes-empty]")).not.toBeNull();
    expect(q(mount, "[data-testid=classes-shared-students]")).toBeNull();
  });

  it("a failed shared read leaves loading for a neutral retry, not the zero-class onboarding", async () => {
    const h = harness();
    const shared = deferredShared(h, []);
    const mount = await mountSurface(h);
    shared.reject(new Error("unavailable"));
    await settle();
    expect(mount.textContent).not.toContain("Loading classes");
    expect(q(mount, "[data-testid=workspace-unresolved]")).not.toBeNull();
    expect(q(mount, "[data-testid=classes-empty]")).toBeNull();
    expect(q(mount, "[data-testid=classes-shared-students]")).toBeNull();
  });

  it("a teacher with classes sees them immediately, and shared students once loaded", async () => {
    const h = harness();
    const shared = deferredShared(h, ownClasses);
    const mount = await mountSurface(h);
    expect(q(mount, `[data-testid=class-card-${OWN_CLASS}]`)).not.toBeNull();
    expect(q(mount, "[data-testid=classes-status]")!.textContent).toBe("1 class");
    shared.resolve([SHARED]);
    await settle();
    expect(q(mount, `[data-testid=class-card-${OWN_CLASS}]`)).not.toBeNull();
    expect(q(mount, "[data-testid=classes-shared-students]")).not.toBeNull();
  });

  it("a teacher with classes and nothing shared sees only the classes", async () => {
    const h = harness();
    const shared = deferredShared(h, ownClasses);
    const mount = await mountSurface(h);
    shared.resolve([]);
    await settle();
    expect(q(mount, `[data-testid=class-card-${OWN_CLASS}]`)).not.toBeNull();
    expect(q(mount, "[data-testid=classes-shared-students]")).toBeNull();
  });

  it("a teacher with neither keeps the existing zero-class empty state", async () => {
    const h = harness();
    (h.deps as { listClasses: () => Promise<ReadonlyArray<ClassSummary>> }).listClasses = async () => [];
    (h.deps as { studentSupport: StudentSupportSeam }).studentSupport = {
      ...h.deps.studentSupport!,
      listShared: async () => [],
    };
    const mount = await mountSurface(h);
    expect(q(mount, "[data-testid=classes-shared-students]")).toBeNull();
    expect(q(mount, "[data-testid=classes-status]")!.textContent).toBe("No classes yet.");
    expect(q(mount, "[data-testid=classes-empty]")!.textContent).toBe("Add or import a class in Settings.");
  });
});

describe("Not started assignment cards", () => {
  it("keep the Not started status, invent no metrics, and use the neutral style for owners and grantees", async () => {
    const h = harness();
    const expectedNotStarted: AssessmentStudentAssignmentsForClassCallable = async (input) => ({
      classId: input.classId,
      studentId: input.studentId,
      assignments: [{ assignmentId: "a9", hasLiveSession: false }],
    });
    (h.deps as { loadExpectedAssignments: () => AssessmentStudentAssignmentsForClassCallable }).loadExpectedAssignments =
      () => expectedNotStarted;
    const mount = await mountSurface(h);
    q(mount, "[data-testid=classes-shared-student]")!.click();
    await settle();
    const card = q(mount, '[data-testid=student-detail-assignments] > li[data-assignment-id="a9"]')!;
    expect(card.getAttribute("data-assignment-status")).toBe("not-started");
    expect(card.classList.contains("shell-student-detail-assignment-not-started")).toBe(true);
    expect(q(card, ".shell-student-detail-assignment-status")!.textContent).toBe("Not started");
    expect(q(card, "[data-testid=student-detail-metrics]")).toBeNull();
    expect(q(card, "[data-testid=student-detail-review-toggle]")).toBeNull();

    const css = readFileSync(join(__dirname, "../../../index.html"), "utf8");
    const box = css.match(/\.shell-student-detail-assignment-not-started \{[^}]*\}/)![0];
    expect(box).toContain("background: var(--tw-surface-alt);");
    expect(box).toContain("border-color: var(--tw-hairline);");
    const label = css.match(/\.shell-student-detail-assignment-not-started \.shell-student-detail-assignment-status \{[^}]*\}/)![0];
    expect(label).toContain("color: var(--tw-ink-muted);");
    expect(`${box}${label}`).not.toMatch(/220, 61, 61|153, 30, 30|#a33a3a/);
  });
});
