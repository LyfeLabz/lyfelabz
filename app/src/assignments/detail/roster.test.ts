import { formatProgressStatus, groupRoster, selectRepresentativeAttempts } from "./roster";

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
      progress: [],
    });
    expect(g.submitted).toEqual([]);
    expect(g.inProgress).toEqual([]);
    expect(g.notStarted).toEqual([]);
  });

  test("all-not-started when no attempts and zero in progress", () => {
    const g = groupRoster({
      recipients,
      completed: [],
      progress: [],
    });
    expect(g.notStarted.map((r) => r.studentId)).toEqual(["a", "b", "c"]);
    expect(g.submitted).toEqual([]);
    expect(g.inProgress).toEqual([]);
  });

  test("mixed: one submitted, one in progress, one not started, matched by studentId", () => {
    const g = groupRoster({
      recipients,
      completed: [
        { studentId: "a", percentage: 90, attemptNumber: 1, submittedAt: 1 },
      ],
      // Cid (last by name) is the student with a live session; name order
      // must not decide who is in progress.
      progress: [{ studentId: "c", answered: 4, total: 10, retake: false }],
    });
    expect(g.submitted.map((r) => r.studentId)).toEqual(["a"]);
    expect(g.submitted[0]?.percentage).toBe(90);
    expect(g.inProgress).toEqual([
      { studentId: "c", studentDisplayName: "Cid", status: "In Progress · 4/10" },
    ]);
    expect(g.notStarted.map((r) => r.studentId)).toEqual(["b"]);
  });

  test("progress rows for students who are not recipients are ignored", () => {
    const g = groupRoster({
      recipients,
      completed: [],
      progress: [{ studentId: "zz", answered: 3, total: 10, retake: false }],
    });
    expect(g.inProgress).toEqual([]);
    expect(g.notStarted.length).toBe(3);
  });

  test("every live state carries its actual answered/total status", () => {
    const g = groupRoster({
      recipients,
      completed: [],
      progress: [
        { studentId: "a", answered: 0, total: 10, retake: false },
        { studentId: "b", answered: 7, total: 10, retake: false },
        { studentId: "c", answered: 10, total: 10, retake: false },
      ],
    });
    expect(new Map(g.inProgress.map((r) => [r.studentId, r.status]))).toEqual(
      new Map([
        ["a", "Started · 0/10"],
        ["b", "In Progress · 7/10"],
        ["c", "Ready to Submit · 10/10"],
      ]),
    );
    expect(g.notStarted).toEqual([]);
  });

  test("a submitted student who reopened the assignment shows a 0-answer retake", () => {
    const g = groupRoster({
      recipients,
      completed: [{ studentId: "b", percentage: 70, attemptNumber: 1, submittedAt: 1 }],
      progress: [{ studentId: "b", answered: 0, total: 10, retake: true }],
    });
    expect(g.submitted).toEqual([
      expect.objectContaining({
        studentId: "b",
        percentage: 70,
        retakeStatus: "Retake In Progress · 0/10",
      }),
    ]);
    expect(g.notStarted.map((r) => r.studentId).sort()).toEqual(["a", "c"]);
  });

  test("a retake stays Submitted with its best score and shows retake progress", () => {
    const g = groupRoster({
      recipients,
      completed: [
        { studentId: "a", percentage: 90, attemptNumber: 1, submittedAt: 1 },
        { studentId: "a", percentage: 60, attemptNumber: 2, submittedAt: 2 },
      ],
      progress: [{ studentId: "a", answered: 3, total: 10, retake: true }],
    });
    expect(g.submitted).toEqual([
      {
        studentId: "a",
        studentDisplayName: "Ada",
        percentage: 90,
        attemptCount: 2,
        retakeStatus: "Retake In Progress · 3/10",
      },
    ]);
    expect(g.inProgress).toEqual([]);
  });

  test("submitted row never leaks anything beyond name, percentage, and attempt count", () => {
    const g = groupRoster({
      recipients: [{ studentId: "a", studentDisplayName: "Ada" }],
      completed: [
        { studentId: "a", percentage: 80, attemptNumber: 1, submittedAt: 1 },
      ],
      progress: [],
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
    const g = groupRoster({ recipients, completed: [], progress: [] });
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
      progress: [],
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
      progress: [],
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
      progress: [],
    });
    expect(g.notStarted.map((r) => r.studentId)).toEqual(["s-1", "s-2"]);
  });

  test("defaults to last-name order and honors a first-name preference", () => {
    const recipients = [
      { studentId: "1", studentDisplayName: "Zoe Adams" },
      { studentId: "2", studentDisplayName: "Adrianna Blumberg" },
      { studentId: "3", studentDisplayName: "Name unavailable" },
    ];
    const base = { recipients, completed: [], progress: [] };
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
    const progress = [{ studentId: "1", answered: 5, total: 10, retake: false }];
    const last = groupRoster({ recipients, completed, progress });
    const first = groupRoster({ recipients, completed, progress, sortOrder: "firstName" });
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
    const recipients = [
      { studentId: "1", studentDisplayName: "Ann Zimmer" },
      { studentId: "2", studentDisplayName: "Bob Allen" },
      { studentId: "3", studentDisplayName: "Cy Moss" },
    ];
    const progress = [{ studentId: "1", answered: 2, total: 10, retake: false }];
    for (const sortOrder of ["lastName", "firstName"] as const) {
      const g = groupRoster({ recipients, completed: [], progress, sortOrder });
      expect(g.inProgress.map((r) => r.studentId)).toEqual(["1"]);
      expect(g.notStarted.map((r) => r.studentId).sort()).toEqual(["2", "3"]);
    }
  });
});

describe("formatProgressStatus", () => {
  test("labels each live state from answered and the frozen total", () => {
    expect(formatProgressStatus({ answered: 0, total: 10, retake: false })).toBe("Started · 0/10");
    expect(formatProgressStatus({ answered: 1, total: 10, retake: false })).toBe("In Progress · 1/10");
    expect(formatProgressStatus({ answered: 9, total: 10, retake: false })).toBe("In Progress · 9/10");
    expect(formatProgressStatus({ answered: 10, total: 10, retake: false })).toBe("Ready to Submit · 10/10");
    expect(formatProgressStatus({ answered: 6, total: 6, retake: false })).toBe("Ready to Submit · 6/6");
    expect(formatProgressStatus({ answered: 4, total: 10, retake: true })).toBe("Retake In Progress · 4/10");
  });

  test("never invents a total the server could not read", () => {
    expect(formatProgressStatus({ answered: 0, total: null, retake: false })).toBe("Started");
    expect(formatProgressStatus({ answered: 3, total: null, retake: false })).toBe("In Progress · 3 answered");
  });
});
