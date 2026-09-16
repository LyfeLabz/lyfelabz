/**
 * @jest-environment jsdom
 *
 * Student Progress & Assignment Membership Phase A, Slice 3: end-to-end
 * (real shell) coverage of the two navigation chains the required
 * correction locks in:
 *
 *   Assignment Detail -> Student A -> Next -> Next -> Back
 *     returns to the exact originating Assignment Detail.
 *
 *   Students -> Student A -> Next -> Back
 *     returns to the plain Students list.
 *
 * The Assignment Detail surface itself is a faithful stub (same shape
 * index.ts wires): it captures the shell's outlet controller AND its
 * student-selection controller, and its stub roster exposes one button per
 * student that calls the captured student-selection controller exactly as
 * `AssignmentDetailDeps.onSelectStudent` -> `renderReady`'s bound callback
 * would in the real `detail.ts`. This proves the shell-level wiring
 * (`classesStudentIntent`, `setStudentSelectionController`,
 * `navigateTo("classes")`) without re-testing `detail.ts`'s own roster
 * rendering, which is already covered in detail.test.ts.
 */
import { mountTeacherShell, type ShellDeps } from "./shell";
import type {
  CurriculumAssignmentDetailSeam,
  TeacherShellOutletController,
  TeacherShellStudentSelectionController,
  AssignmentDetailOpenOptions,
} from "./surfaces/curriculum";
import type { AssignmentDetailMetadata } from "../assignments/detail/types";
import type {
  AssignmentSummary,
  AssignmentSummaryCallable,
} from "../assignments/summary/types";
import type { AttemptsListForClassCallable } from "../assignments/detail/attempts-wire";
import type { Session } from "../session/types";
import type { ClassSummary } from "../classes/types";
import { _resetActiveAssignmentsSessionStateForTest } from "./surfaces/shared/activeAssignments";

const teacher = (): Extract<Session, { kind: "activeTeacher" }> =>
  Object.freeze({
    kind: "activeTeacher",
    uid: "u1",
    schoolId: "school-abc",
    displayName: "Ada Lovelace",
  }) as Extract<Session, { kind: "activeTeacher" }>;

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  div.id = "app-root";
  document.body.appendChild(div);
  return div;
};

const oneClass: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({
    id: "c1",
    title: "6A Life Science",
    status: "active" as const,
    grade: "6",
    block: "A",
  }),
]);

const registry: ReadonlyArray<AssignmentDetailMetadata> = Object.freeze([
  Object.freeze({
    assignmentId: "a1",
    title: "Engineering Design",
    status: "published" as const,
    className: "6A Life Science",
    classId: "c1",
    lessonSlug: "engineering-design",
    publishedAt: 3000,
  }),
]);

const STUDENT_A = { studentId: "s-alice", studentDisplayName: "Alice Adams" };
const STUDENT_B = { studentId: "s-bob", studentDisplayName: "Bob Baker" };
const STUDENT_C = { studentId: "s-carla", studentDisplayName: "Carla Chen" };

const summaryCallable: AssignmentSummaryCallable = async ({ assignmentId }) => {
  const s: AssignmentSummary = {
    assignmentId,
    classId: "c1",
    totalStudents: 3,
    completedStudents: 0,
    inProgressStudents: 0,
    notStartedStudents: 3,
    completionPercentage: 0,
    averagePercentage: 0,
    highestPercentage: 0,
    lowestPercentage: 0,
    perfectScoreStudents: 0,
  };
  return s;
};

const mockLoadRoster = async (input: { classId: string }) => ({
  classId: input.classId,
  students: [STUDENT_A, STUDENT_B, STUDENT_C],
});

const noAttempts: AttemptsListForClassCallable = async (input) => ({
  classId: input.classId,
  attempts: [],
});

// A faithful seam mirroring both TeacherShellOutletController AND
// TeacherShellStudentSelectionController registration, exactly as
// index.ts wires the real Assignment Detail surface. The stub Detail
// renders one "select student" button per fixture student; clicking it
// calls the captured student-selection controller with the same payload
// shape `renderReady`'s bound `onSelectStudent` callback builds in the
// real detail.ts.
const makeSeam = (): {
  seam: CurriculumAssignmentDetailSeam;
} => {
  let outlet: TeacherShellOutletController | null = null;
  let studentSelection: TeacherShellStudentSelectionController | null = null;
  const seam: CurriculumAssignmentDetailSeam = {
    register: () => undefined,
    list: () => registry,
    open: (id, options?: AssignmentDetailOpenOptions) => {
      const render = (host: HTMLElement): void => {
        const el = host.ownerDocument.createElement("section");
        el.setAttribute("data-testid", "detail-stub");
        el.setAttribute("data-assignment-id", id);
        const back = host.ownerDocument.createElement("button");
        back.setAttribute("data-testid", "detail-back");
        back.textContent = options?.backLabel ?? "Back to Curriculum";
        back.addEventListener("click", () => options?.onBack?.());
        el.appendChild(back);
        for (const student of [STUDENT_A, STUDENT_B, STUDENT_C]) {
          const btn = host.ownerDocument.createElement("button");
          btn.setAttribute(
            "data-testid",
            `detail-select-student-${student.studentId}`,
          );
          btn.addEventListener("click", () => {
            studentSelection?.selectStudent({
              classId: "c1",
              studentId: student.studentId,
              studentDisplayName: student.studentDisplayName,
              returnToAssignmentId: id,
            });
          });
          el.appendChild(btn);
        }
        host.appendChild(el);
      };
      outlet?.show(render);
    },
    setOutletController: (c) => {
      outlet = c;
    },
    setStudentSelectionController: (c) => {
      studentSelection = c;
    },
  };
  return { seam };
};

const makeDeps = (seam: CurriculumAssignmentDetailSeam): ShellDeps => ({
  onSignOut: () => undefined,
  listClasses: async () => oneClass,
  onLaunchPresentMode: () => undefined,
  assignmentDetail: seam,
  assignmentSummary: summaryCallable,
  loadRoster: () => mockLoadRoster,
  loadAttempts: () => noAttempts,
});

const click = (mount: HTMLElement, testid: string): void => {
  mount.querySelector<HTMLButtonElement>(`[data-testid=${testid}]`)!.click();
};

beforeEach(() => {
  _resetActiveAssignmentsSessionStateForTest();
});

describe("Student Progress & Assignment Membership Phase A, Slice 3 - navigation chains", () => {
  test("Assignment Detail -> Student A -> Next -> Next -> Back returns to the exact originating Assignment Detail", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    mountTeacherShell(teacher(), mount, makeDeps(seam));

    // Open Assignment Detail directly (Curriculum-origin path, no options -
    // the assignment-origin chain does not depend on how Detail itself was
    // reached, only on how the student was selected from within it).
    seam.open("a1");
    expect(mount.querySelector("[data-testid=detail-stub]")).not.toBeNull();

    click(mount, `detail-select-student-${STUDENT_A.studentId}`);
    await flush();
    await flush();

    // Landed on Student Detail for Alice, in the class workspace.
    let name = mount.querySelector<HTMLElement>(
      "[data-testid=student-detail-name]",
    );
    expect(name?.textContent).toBe(STUDENT_A.studentDisplayName);
    expect(mount.querySelector("[data-testid=detail-stub]")).toBeNull();

    // Next -> Bob.
    click(mount, "student-detail-next");
    await flush();
    name = mount.querySelector<HTMLElement>("[data-testid=student-detail-name]");
    expect(name?.textContent).toBe(STUDENT_B.studentDisplayName);

    // Next -> Carla.
    click(mount, "student-detail-next");
    await flush();
    name = mount.querySelector<HTMLElement>("[data-testid=student-detail-name]");
    expect(name?.textContent).toBe(STUDENT_C.studentDisplayName);

    // Back returns to the exact originating assignment (a1), not the
    // Students list, despite two intervening Next clicks.
    click(mount, "student-detail-back");
    await flush();

    const detail = mount.querySelector("[data-testid=detail-stub]");
    expect(detail).not.toBeNull();
    expect(detail?.getAttribute("data-assignment-id")).toBe("a1");
    expect(mount.querySelector("[data-testid=roster-list]")).toBeNull();
  });

  test("Students -> Student A -> Next -> Back returns to the plain Students list", async () => {
    const mount = mkMount();
    const { seam } = makeSeam();
    mountTeacherShell(teacher(), mount, makeDeps(seam));

    click(mount, "nav-classes");
    await flush();
    click(mount, "class-card-c1");
    click(mount, "class-nav-roster");
    await flush();
    await flush();

    click(mount, "roster-student"); // Alice is first alphabetically.
    await flush();
    expect(
      mount.querySelector("[data-testid=student-detail-name]")?.textContent,
    ).toBe(STUDENT_A.studentDisplayName);

    click(mount, "student-detail-next");
    await flush();
    expect(
      mount.querySelector("[data-testid=student-detail-name]")?.textContent,
    ).toBe(STUDENT_B.studentDisplayName);

    click(mount, "student-detail-back");
    await flush();

    expect(mount.querySelector("[data-testid=roster-list]")).not.toBeNull();
    expect(mount.querySelector("[data-testid=student-detail]")).toBeNull();
  });
});
