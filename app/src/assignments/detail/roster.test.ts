import { groupRoster, selectRepresentativeAttempts } from "./roster";

describe("selectRepresentativeAttempts", () => {
  test("picks the highest-percentage completed attempt per student", () => {
    const rep = selectRepresentativeAttempts([
      { studentId: "a", percentage: 60, attemptNumber: 1, submittedAt: 1 },
      { studentId: "a", percentage: 90, attemptNumber: 2, submittedAt: 2 },
      { studentId: "b", percentage: 50, attemptNumber: 1, submittedAt: 3 },
    ]);
    expect(rep.get("a")?.percentage).toBe(90);
    expect(rep.get("b")?.percentage).toBe(50);
  });

  test("breaks percentage ties by most recent submission then attemptNumber", () => {
    const rep = selectRepresentativeAttempts([
      { studentId: "a", percentage: 80, attemptNumber: 1, submittedAt: 1 },
      { studentId: "a", percentage: 80, attemptNumber: 2, submittedAt: 2 },
    ]);
    expect(rep.get("a")?.attemptNumber).toBe(2);
  });
});

describe("groupRoster", () => {
  const recipients = [
    { studentId: "a", studentDisplayName: "Ada" },
    { studentId: "b", studentDisplayName: "Bea" },
    { studentId: "c", studentDisplayName: "Cid" },
  ];

  test("empty when no recipients", () => {
    const g = groupRoster({
      recipients: [],
      completed: [],
      inProgressStudentCount: 0,
    });
    expect(g.submitted).toEqual([]);
    expect(g.inProgress).toEqual([]);
    expect(g.notStarted).toEqual([]);
  });

  test("all-not-started when no attempts and zero in progress", () => {
    const g = groupRoster({
      recipients,
      completed: [],
      inProgressStudentCount: 0,
    });
    expect(g.notStarted.map((r) => r.studentId)).toEqual(["a", "b", "c"]);
    expect(g.submitted).toEqual([]);
    expect(g.inProgress).toEqual([]);
  });

  test("mixed: one submitted, one in progress by arithmetic, one not started", () => {
    const g = groupRoster({
      recipients,
      completed: [
        { studentId: "a", percentage: 90, attemptNumber: 1, submittedAt: 1 },
      ],
      inProgressStudentCount: 1,
    });
    expect(g.submitted.map((r) => r.studentId)).toEqual(["a"]);
    expect(g.submitted[0]?.percentage).toBe(90);
    expect(g.inProgress.length).toBe(1);
    expect(g.notStarted.length).toBe(1);
  });

  test("in-progress count clamps to remaining non-submitted recipients", () => {
    const g = groupRoster({
      recipients,
      completed: [],
      inProgressStudentCount: 99,
    });
    expect(g.inProgress.length).toBe(3);
    expect(g.notStarted.length).toBe(0);
  });

  test("submitted row never leaks anything beyond name, percentage, and attempt count", () => {
    const g = groupRoster({
      recipients: [{ studentId: "a", studentDisplayName: "Ada" }],
      completed: [
        { studentId: "a", percentage: 80, attemptNumber: 1, submittedAt: 1 },
      ],
      inProgressStudentCount: 0,
    });
    expect(Object.keys(g.submitted[0] ?? {}).sort()).toEqual([
      "attemptCount",
      "percentage",
      "studentDisplayName",
      "studentId",
    ]);
  });
});

describe("Sprint 30 roster polish - teacher sort preference", () => {
  const names = (rows: ReadonlyArray<{ studentDisplayName: string }>) =>
    rows.map((r) => r.studentDisplayName);
  const done = (studentId: string, percentage: number, attemptNumber = 1) => ({
    studentId,
    percentage,
    attemptNumber,
    submittedAt: attemptNumber,
  });

  test("orders by last name, then first name, while names display as First Last", () => {
    const recipients = [
      { studentId: "1", studentDisplayName: "Zoe Adams" },
      { studentId: "2", studentDisplayName: "Adrianna Blumberg" },
      { studentId: "3", studentDisplayName: "Aaron Carter" },
      { studentId: "4", studentDisplayName: "Ben Adams" },
    ];
    const g = groupRoster({ recipients, completed: [], inProgressStudentCount: 0 });
    expect(names(g.notStarted)).toEqual([
      "Ben Adams",
      "Zoe Adams",
      "Adrianna Blumberg",
      "Aaron Carter",
    ]);
  });

  test("score and attempt count never influence order", () => {
    const recipients = [
      { studentId: "a", studentDisplayName: "Amy Young" },
      { studentId: "b", studentDisplayName: "Zed Baker" },
      { studentId: "c", studentDisplayName: "Max Moss" },
    ];
    const g = groupRoster({
      recipients,
      completed: [
        done("a", 100),
        done("b", 20),
        done("b", 30, 2),
        done("b", 40, 3),
        done("c", 60),
      ],
      inProgressStudentCount: 0,
    });
    expect(names(g.submitted)).toEqual(["Zed Baker", "Max Moss", "Amy Young"]);
  });

  test("attemptCount counts every completed attempt; the score stays the representative best", () => {
    const g = groupRoster({
      recipients: [
        { studentId: "a", studentDisplayName: "Ada Lovelace" },
        { studentId: "b", studentDisplayName: "Bea Smith" },
      ],
      completed: [done("a", 90), done("a", 60, 2), done("b", 75)],
      inProgressStudentCount: 0,
    });
    const byId = new Map(g.submitted.map((r) => [r.studentId, r]));
    expect(byId.get("a")).toMatchObject({ percentage: 90, attemptCount: 2 });
    expect(byId.get("b")).toMatchObject({ percentage: 75, attemptCount: 1 });
  });

  test("duplicate full names are ordered deterministically by studentId", () => {
    const g = groupRoster({
      recipients: [
        { studentId: "s-2", studentDisplayName: "Sam Lee" },
        { studentId: "s-1", studentDisplayName: "Sam Lee" },
      ],
      completed: [],
      inProgressStudentCount: 0,
    });
    expect(g.notStarted.map((r) => r.studentId)).toEqual(["s-1", "s-2"]);
  });

  test("defaults to last-name order and honors a first-name preference", () => {
    const recipients = [
      { studentId: "1", studentDisplayName: "Zoe Adams" },
      { studentId: "2", studentDisplayName: "Adrianna Blumberg" },
      { studentId: "3", studentDisplayName: "Name unavailable" },
    ];
    const base = { recipients, completed: [], inProgressStudentCount: 0 };
    expect(names(groupRoster(base).notStarted)).toEqual([
      "Zoe Adams",
      "Adrianna Blumberg",
      "Name unavailable",
    ]);
    expect(names(groupRoster({ ...base, sortOrder: "firstName" }).notStarted)).toEqual([
      "Adrianna Blumberg",
      "Zoe Adams",
      "Name unavailable",
    ]);
  });

  test("a first-name preference changes order only, never group membership, score, or attempts", () => {
    const recipients = [
      { studentId: "1", studentDisplayName: "Ann Zimmer" },
      { studentId: "2", studentDisplayName: "Bob Allen" },
      { studentId: "3", studentDisplayName: "Cy Moss" },
      { studentId: "4", studentDisplayName: "Di Brown" },
    ];
    const completed = [done("4", 80), done("4", 90, 2), done("3", 50)];
    const last = groupRoster({ recipients, completed, inProgressStudentCount: 1 });
    const first = groupRoster({ recipients, completed, inProgressStudentCount: 1, sortOrder: "firstName" });
    const ids = (rows: ReadonlyArray<{ studentId: string }>) => rows.map((r) => r.studentId).sort();
    expect(ids(first.submitted)).toEqual(ids(last.submitted));
    expect(ids(first.inProgress)).toEqual(ids(last.inProgress));
    expect(ids(first.notStarted)).toEqual(ids(last.notStarted));
    expect(names(last.submitted)).toEqual(["Di Brown", "Cy Moss"]);
    expect(names(first.submitted)).toEqual(["Cy Moss", "Di Brown"]);
    expect(first.submitted.find((r) => r.studentId === "4")).toMatchObject({
      percentage: 90,
      attemptCount: 2,
    });
  });

  test("which students are in progress vs not started is unchanged by the display order", () => {
    // The in-progress split is arithmetic over display-name order; display
    // by last name must not move a student between the two groups.
    const recipients = [
      { studentId: "1", studentDisplayName: "Ann Zimmer" },
      { studentId: "2", studentDisplayName: "Bob Allen" },
      { studentId: "3", studentDisplayName: "Cy Moss" },
    ];
    const g = groupRoster({ recipients, completed: [], inProgressStudentCount: 1 });
    expect(g.inProgress.map((r) => r.studentId)).toEqual(["1"]);
    expect(names(g.notStarted)).toEqual(["Bob Allen", "Cy Moss"]);
  });
});
