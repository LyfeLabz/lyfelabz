/**
 * @jest-environment jsdom
 *
 * Teacher-controlled Google Classroom roster refresh in Class settings
 * ("Google Classroom roster" > "Refresh roster from Google Classroom").
 * Opening a class never refreshes the Classroom roster (see
 * classes.roster-prefetch.test.ts); this is the only ordinary path that does.
 */
import type { ClassSummary } from "../../classes/types";
import type { Session } from "../../session/types";
import type {
  RefreshRosterEnrollmentReconciliation,
  RefreshRosterResult,
} from "../../settings/integrations/types";
import {
  describeRosterRefreshError,
  describeRosterRefreshResult,
  renderClassesSurface,
} from "./classes";

type ActiveTeacher = Extract<Session, { kind: "activeTeacher" }>;
type RosterResult = {
  classId: string;
  students: ReadonlyArray<{ studentId: string; studentDisplayName: string }>;
};

const teacher: ActiveTeacher = Object.freeze({
  kind: "activeTeacher",
  uid: "teacher-1",
  schoolId: "school-1",
  displayName: "Ms. Teacher",
});

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await flush();
};

const LMS = "class-lms";
const NATIVE = "class-native";
const classes: ReadonlyArray<ClassSummary> = Object.freeze([
  Object.freeze({ id: LMS, title: "(B) Science", status: "active", grade: "7", block: "B", isLmsLinked: true }),
  Object.freeze({ id: NATIVE, title: "(C) Science", status: "active", grade: "7", block: "C", isLmsLinked: false }),
] as ClassSummary[]);

const reconciliation = (
  overrides: Partial<RefreshRosterEnrollmentReconciliation> = {},
): RefreshRosterEnrollmentReconciliation => ({
  added: 0,
  alreadyEnrolled: 20,
  reactivated: 0,
  awaitingFirstSignIn: 0,
  notReactivated: 0,
  notMatched: 0,
  withdrawn: 0,
  ...overrides,
});
const result = (
  overrides: Partial<RefreshRosterEnrollmentReconciliation> = {},
  upstreamRosterEmpty = false,
): RefreshRosterResult => ({
  classId: LMS,
  membersSeen: 20,
  added: 0,
  reaffirmed: 20,
  removed: 0,
  withdrawnEnrollments: 0,
  upstreamRosterEmpty,
  enrollmentReconciliation: reconciliation(overrides),
});

// A refresh whose outcome the test controls.
function controllableRefresh() {
  const pending: Array<{ resolve: (r: RefreshRosterResult) => void; reject: (e: unknown) => void }> = [];
  const refreshRoster = jest.fn(
    () =>
      new Promise<RefreshRosterResult>((resolve, reject) => {
        pending.push({ resolve, reject });
      }),
  );
  return { refreshRoster, pending };
}

const q = <T extends HTMLElement>(testid: string): T | null =>
  document.querySelector<T>(`[data-testid=${testid}]`);
const refreshButton = () => q<HTMLButtonElement>("classes-settings-roster-refresh");
const refreshStatus = () => q<HTMLElement>("classes-settings-roster-status");
const modal = () => q<HTMLElement>("classes-settings-overlay");

async function mountWith(deps: Partial<Parameters<typeof renderClassesSurface>[2]>) {
  const mount = document.createElement("div");
  document.body.appendChild(mount);
  renderClassesSurface(mount, teacher, { listClasses: async () => classes, ...deps });
  await settle();
  return mount;
}
const openSettings = async (classId: string) => {
  q<HTMLButtonElement>(`class-card-settings-${classId}`)!.click();
  await flush();
};

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("Class settings: Google Classroom roster section", () => {
  test("shown for an active Classroom-linked class, with a non-submit action", async () => {
    await mountWith({ refreshRoster: jest.fn() });
    await openSettings(LMS);
    const section = q("classes-settings-roster")!;
    expect(section).not.toBeNull();
    expect(section.textContent).toContain("Google Classroom roster");
    expect(refreshButton()!.textContent).toBe("Refresh roster from Google Classroom");
    expect(refreshButton()!.type).toBe("button");
  });

  test("hidden for a LyfeLabz-native (not Classroom-linked) class", async () => {
    await mountWith({ refreshRoster: jest.fn() });
    await openSettings(NATIVE);
    expect(modal()).not.toBeNull();
    expect(q("classes-settings-roster")).toBeNull();
  });

  test("hidden when the refresh callable is not wired", async () => {
    await mountWith({});
    await openSettings(LMS);
    expect(q("classes-settings-roster")).toBeNull();
  });

  test("one click makes exactly one reconciling refresh for that class; clicks while busy do nothing", async () => {
    const { refreshRoster, pending } = controllableRefresh();
    await mountWith({ refreshRoster });
    await openSettings(LMS);

    refreshButton()!.click();
    expect(refreshRoster).toHaveBeenCalledTimes(1);
    expect(refreshRoster).toHaveBeenCalledWith({ classId: LMS, reconcileEnrollments: true });
    // Busy: disabled, aria-busy, progress label.
    expect(refreshButton()!.disabled).toBe(true);
    expect(refreshButton()!.getAttribute("aria-busy")).toBe("true");
    expect(refreshButton()!.textContent).toBe("Refreshing roster…");

    refreshButton()!.click();
    refreshButton()!.dispatchEvent(new MouseEvent("click"));
    expect(refreshRoster).toHaveBeenCalledTimes(1);

    pending[0]!.resolve(result());
    await settle();
    expect(refreshButton()!.disabled).toBe(false);
    expect(refreshButton()!.hasAttribute("aria-busy")).toBe(false);
    expect(refreshButton()!.textContent).toBe("Refresh roster from Google Classroom");
    expect(refreshStatus()!.textContent).toBe(
      "Roster refreshed from Google Classroom. No changes were needed.",
    );
  });

  test("never submits or saves class settings, and the dialog stays open", async () => {
    const updateClassMetadata = jest.fn(async () => undefined);
    const updateClassColor = jest.fn(async () => undefined);
    const { refreshRoster, pending } = controllableRefresh();
    await mountWith({
      refreshRoster,
      updateClassMetadata: updateClassMetadata as never,
      updateClassColor: updateClassColor as never,
    });
    await openSettings(LMS);
    const submitted = jest.fn();
    modal()!.querySelector("form")!.addEventListener("submit", submitted);

    refreshButton()!.click();
    pending[0]!.resolve(result({ added: 1 }));
    await settle();

    expect(submitted).not.toHaveBeenCalled();
    expect(updateClassMetadata).not.toHaveBeenCalled();
    expect(updateClassColor).not.toHaveBeenCalled();
    expect(modal()).not.toBeNull();
    expect(q<HTMLButtonElement>("classes-settings-save")!.disabled).toBe(false);
  });

  test.each([
    ["Cancel", () => q<HTMLButtonElement>("classes-settings-cancel")!.click()],
    ["Escape", () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))],
  ])("%s still closes the dialog during a refresh, with no save", async (_label, dismiss) => {
    const updateClassMetadata = jest.fn(async () => undefined);
    const { refreshRoster, pending } = controllableRefresh();
    await mountWith({ refreshRoster, updateClassMetadata: updateClassMetadata as never });
    await openSettings(LMS);
    refreshButton()!.click();
    dismiss();
    await flush();
    expect(modal()).toBeNull();
    pending[0]!.resolve(result());
    await settle();
    expect(updateClassMetadata).not.toHaveBeenCalled();
    expect(modal()).toBeNull();
  });

  test("a failure shows recovery guidance, never claims the roster is unchanged, and can be retried", async () => {
    const { refreshRoster, pending } = controllableRefresh();
    await mountWith({ refreshRoster });
    await openSettings(LMS);
    refreshButton()!.click();
    pending[0]!.reject({ code: "functions/failed-precondition", details: { code: "lms.connectionNotActive" } });
    await settle();
    expect(refreshStatus()!.textContent).toBe(
      "Google Classroom access needs to be reconnected. Open Settings to reconnect, then try again.",
    );
    expect(refreshStatus()!.textContent).not.toMatch(/unchanged/i);
    expect(refreshButton()!.disabled).toBe(false);
    refreshButton()!.click();
    expect(refreshRoster).toHaveBeenCalledTimes(2);
  });

  test("after a refresh, the class's next roster read fetches the updated LyfeLabz enrollments", async () => {
    let roster: RosterResult = {
      classId: LMS,
      students: [{ studentId: "s1", studentDisplayName: "Ann" }],
    };
    const loader = jest.fn(async () => roster);
    const { refreshRoster, pending } = controllableRefresh();
    const mount = await mountWith({ refreshRoster, loadRoster: () => loader });

    // Open the class (roster read #1), then return to the Classes list.
    q<HTMLButtonElement>(`class-card-${LMS}`)!.click();
    await settle();
    q<HTMLButtonElement>("class-workspace-back")!.click();
    await settle();

    await openSettings(LMS);
    refreshButton()!.click();
    roster = {
      classId: LMS,
      students: [
        { studentId: "s1", studentDisplayName: "Ann" },
        { studentId: "s2", studentDisplayName: "Cal" },
      ],
    };
    pending[0]!.resolve(result({ added: 1 }));
    await settle();
    q<HTMLButtonElement>("classes-settings-cancel")!.click();
    await flush();

    q<HTMLButtonElement>(`class-card-${LMS}`)!.click();
    await settle();
    q<HTMLButtonElement>("class-nav-roster")!.click();
    await settle();
    expect(loader).toHaveBeenCalledTimes(2);
    const names = Array.from(mount.querySelectorAll(".shell-roster-student-name")).map(
      (n) => n.textContent,
    );
    expect(names).toEqual(["Ann", "Cal"]);
  });
});

describe("roster refresh feedback reports exactly what the server did", () => {
  test("no changes", () => {
    expect(describeRosterRefreshResult(result())).toBe(
      "Roster refreshed from Google Classroom. No changes were needed.",
    );
  });

  test("existing LyfeLabz students enrolled (singular / plural)", () => {
    expect(describeRosterRefreshResult(result({ added: 1 }))).toBe(
      "Roster refreshed from Google Classroom. 1 student added to this class.",
    );
    expect(describeRosterRefreshResult(result({ added: 3 }))).toBe(
      "Roster refreshed from Google Classroom. 3 students added to this class.",
    );
  });

  test("students awaiting first sign-in are never described as added", () => {
    const one = describeRosterRefreshResult(result({ awaitingFirstSignIn: 1 }));
    expect(one).toBe(
      "Roster refreshed from Google Classroom. 1 student will join after signing in to LyfeLabz for the first time.",
    );
    expect(one).not.toContain("added");
    expect(describeRosterRefreshResult(result({ awaitingFirstSignIn: 2 }))).toContain(
      "2 students will join after signing in to LyfeLabz for the first time.",
    );
  });

  test("withdrawn students are removed from the class with work kept, never 'deleted'", () => {
    const one = describeRosterRefreshResult(result({ withdrawn: 1 }));
    expect(one).toBe(
      "Roster refreshed from Google Classroom. 1 student no longer in Google Classroom was removed from this class. Their work is kept.",
    );
    expect(describeRosterRefreshResult(result({ withdrawn: 2 }))).toContain(
      "2 students no longer in Google Classroom were removed from this class. Their work is kept.",
    );
    expect(one).not.toMatch(/delet/i);
  });

  test("an empty Classroom roster reports that no one was removed", () => {
    expect(describeRosterRefreshResult(result({}, true))).toBe(
      "Roster refreshed from Google Classroom. Google Classroom returned no students, so no one was removed.",
    );
  });

  test("students who returned to Classroom are reported as restored, never as added or new (singular / plural)", () => {
    const one = describeRosterRefreshResult(result({ reactivated: 1 }));
    expect(one).toBe(
      "Roster refreshed from Google Classroom. 1 student who returned to Google Classroom was restored to this class.",
    );
    expect(one).not.toMatch(/added|new/i);
    expect(describeRosterRefreshResult(result({ reactivated: 3 }))).toBe(
      "Roster refreshed from Google Classroom. 3 students who returned to Google Classroom were restored to this class.",
    );
  });

  test("new and restored students are counted separately", () => {
    expect(describeRosterRefreshResult(result({ added: 1, reactivated: 2 }))).toBe(
      "Roster refreshed from Google Classroom. 1 student added to this class. 2 students who returned to Google Classroom were restored to this class.",
    );
  });

  test("students who could not be restored or matched are reported, singular and plural", () => {
    expect(describeRosterRefreshResult(result({ notReactivated: 1, notMatched: 2 }))).toBe(
      "Roster refreshed from Google Classroom. 1 student previously removed from this class could not be restored automatically. 2 Google Classroom accounts could not be matched to a student in this school.",
    );
    expect(describeRosterRefreshResult(result({ notReactivated: 2, notMatched: 1 }))).toBe(
      "Roster refreshed from Google Classroom. 2 students previously removed from this class could not be restored automatically. 1 Google Classroom account could not be matched to a student in this school.",
    );
  });

  test("combined outcome lists every change", () => {
    expect(
      describeRosterRefreshResult(
        result({ added: 2, reactivated: 1, awaitingFirstSignIn: 1, withdrawn: 1 }),
      ),
    ).toBe(
      "Roster refreshed from Google Classroom. 2 students added to this class. 1 student who returned to Google Classroom was restored to this class. 1 student will join after signing in to LyfeLabz for the first time. 1 student no longer in Google Classroom was removed from this class. Their work is kept.",
    );
  });

  test.each([
    ["lms.connectionNotActive", "Google Classroom access needs to be reconnected. Open Settings to reconnect, then try again."],
    ["lms.upstreamAuthorizationFailed", "Google Classroom access needs to be reconnected. Open Settings to reconnect, then try again."],
    ["lms.classNotLinked", "This class's Google Classroom course could not be reached. Confirm the course is still available and try again."],
    ["lms.classNotActive", "This class is no longer active, so its roster cannot be refreshed."],
    ["lms.upstreamTemporarilyUnavailable", "We could not reach Google Classroom just now. It is safe to try again in a moment."],
    ["something.else", "The roster refresh did not finish. It is safe to try again."],
  ])("error %s maps to the existing Classroom guidance", (code, message) => {
    expect(describeRosterRefreshError({ code: "functions/x", details: { code } })).toBe(message);
  });
});
