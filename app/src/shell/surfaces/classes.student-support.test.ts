/**
 * @jest-environment jsdom
 *
 * Student Support Access (PDR-032) on the Classes surface:
 *   - a support educator's "Shared students" list opens the SAME Student
 *     Detail renderer, read-only, through the student-scoped attempts read
 *     (never the owner-only class-wide list);
 *   - read-only Student Detail withholds the grade-update Undo but keeps the
 *     history, Show Your Thinking, and question review;
 *   - the owner's Class settings carry the "Support access" section;
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
    grant: async (input) => {
      grantCalls.push(input);
      const g: SupportGrant = { grantId: "g2", classId: input.classId, studentId: input.studentId, studentDisplayName: "Cara Cole", granteeDisplayName: "Ms. Sped", granteeEmail: input.granteeEmail };
      grants = [...grants, g];
      return g;
    },
    revoke: async (grantId) => {
      revokeCalls.push(grantId);
      grants = grants.filter((g) => g.grantId !== grantId);
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
    expect(button.textContent).toContain("Science 7B · Ms. Owner");
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
      "Science 7B · Shared by Ms. Owner · View only",
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

  it("returns to the Classes list and re-reads the shared list", async () => {
    const h = harness();
    const mount = await mountSurface(h);
    q(mount, "[data-testid=classes-shared-student]")!.click();
    await settle();
    const back = q(mount, "[data-testid=student-detail-back]")!;
    expect(back.textContent).toBe("Back to Classes");
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
  });
});

describe("Class settings > Support access (owner)", () => {
  async function openSettings(h: ReturnType<typeof harness>) {
    const mount = await mountSurface(h);
    q(mount, `[data-testid=class-card-settings-${OWN_CLASS}]`)!.click();
    await settle();
    return q(document.body, "[data-testid=classes-settings-support]")!;
  }

  it("lists active grants and revokes one", async () => {
    const h = harness();
    const section = await openSettings(h);
    const rows = qa(section, "[data-testid=classes-settings-support-grant-row]");
    expect(rows.map((r) => r.textContent)).toEqual(["Ben Baker: Mr. Para (para@school.org)Remove"]);
    q(rows[0]!, "[data-testid=classes-settings-support-revoke]")!.click();
    await settle();
    expect(h.revokeCalls).toEqual(["g1"]);
    expect(q(section, "[data-testid=classes-settings-support-empty]")).not.toBeNull();
    expect(q(section, "[data-testid=classes-settings-support-status]")!.textContent).toBe(
      "Removed Mr. Para's access to Ben Baker.",
    );
    // Revoking never closes or saves Class settings.
    expect(q(document.body, "[data-testid=classes-settings-dialog]")).not.toBeNull();
  });

  it("grants access to a chosen roster student by email, and Enter never saves the settings form", async () => {
    const h = harness();
    const section = await openSettings(h);
    const select = q(section, "[data-testid=classes-settings-support-student]") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(["Choose a student", "Ben Baker", "Cara Cole"]);
    select.value = "s-cara";
    const email = q(section, "[data-testid=classes-settings-support-email]") as HTMLInputElement;
    email.value = "sped@school.org";
    email.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    await settle();
    expect(h.grantCalls).toEqual([{ classId: OWN_CLASS, studentId: "s-cara", granteeEmail: "sped@school.org" }]);
    expect(q(section, "[data-testid=classes-settings-support-status]")!.textContent).toBe(
      "Ms. Sped can now view Cara Cole's results.",
    );
    expect(qa(section, "[data-testid=classes-settings-support-grant-row]")).toHaveLength(2);
    expect(q(document.body, "[data-testid=classes-settings-dialog]")).not.toBeNull();
  });

  it("explains the uniform refusal for an email that is not an active teacher at the school", async () => {
    const h = harness();
    (h.deps as { studentSupport: StudentSupportSeam }).studentSupport = {
      ...h.deps.studentSupport!,
      grant: async () => {
        throw Object.assign(new Error("not-found"), { details: { code: "supportAccess.granteeUnavailable" } });
      },
    };
    const section = await openSettings(h);
    (q(section, "[data-testid=classes-settings-support-student]") as HTMLSelectElement).value = "s-ben";
    (q(section, "[data-testid=classes-settings-support-email]") as HTMLInputElement).value = "someone@else.org";
    q(section, "[data-testid=classes-settings-support-grant]")!.click();
    await settle();
    expect(q(section, "[data-testid=classes-settings-support-status]")!.textContent).toBe(
      "No other active teacher at your school uses that email. Check the address and try again.",
    );
  });
});
