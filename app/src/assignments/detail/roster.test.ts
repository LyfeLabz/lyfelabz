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

  test("submitted row never leaks anything beyond name + percentage", () => {
    const g = groupRoster({
      recipients: [{ studentId: "a", studentDisplayName: "Ada" }],
      completed: [
        { studentId: "a", percentage: 80, attemptNumber: 1, submittedAt: 1 },
      ],
      inProgressStudentCount: 0,
    });
    expect(Object.keys(g.submitted[0] ?? {}).sort()).toEqual([
      "percentage",
      "studentDisplayName",
      "studentId",
    ]);
  });
});
