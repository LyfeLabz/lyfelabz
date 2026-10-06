// Quiz progress visibility: the summary wire sends the opt-in flag only when
// asked, and re-projects per-student progress rows to counts only.

const mockRequests: unknown[] = [];
let mockResponse: Record<string, unknown> = {};

jest.mock("firebase/functions", () => ({
  httpsCallable: () => async (data: unknown) => {
    mockRequests.push(data);
    return { data: mockResponse };
  },
}));

import type { Functions } from "firebase/functions";

import { createAssignmentSummaryCallable } from "./wire";

const AGGREGATE = {
  assignmentId: "assign-1",
  classId: "class-1",
  totalStudents: 3,
  completedStudents: 1,
  inProgressStudents: 1,
  notStartedStudents: 1,
  completionPercentage: 33,
  averagePercentage: 80,
  highestPercentage: 80,
  lowestPercentage: 80,
  perfectScoreStudents: 0,
};

const callable = () => createAssignmentSummaryCallable({} as Functions);

beforeEach(() => {
  mockRequests.length = 0;
  mockResponse = { ...AGGREGATE };
});

test("the default request is unchanged and carries no progress", async () => {
  const summary = await callable()({ assignmentId: "assign-1" });
  expect(mockRequests).toEqual([{ assignmentId: "assign-1" }]);
  expect("studentProgress" in summary).toBe(false);
});

test("the opt-in request returns count-only progress rows", async () => {
  mockResponse = {
    ...AGGREGATE,
    studentProgress: [
      { studentId: "stu-1", answered: 4, total: 10, retake: false, responses: ["A"] },
      { studentId: "stu-2", answered: 1, total: null, retake: true },
    ],
  };
  const summary = await callable()({ assignmentId: "assign-1", includeStudentProgress: true });
  expect(mockRequests).toEqual([{ assignmentId: "assign-1", includeStudentProgress: true }]);
  expect(summary.studentProgress).toEqual([
    { studentId: "stu-1", answered: 4, total: 10, retake: false },
    { studentId: "stu-2", answered: 1, total: null, retake: true },
  ]);
});

test("a malformed progress row fails loudly", async () => {
  mockResponse = { ...AGGREGATE, studentProgress: [{ studentId: "stu-1", answered: "4", total: 10, retake: false }] };
  await expect(
    callable()({ assignmentId: "assign-1", includeStudentProgress: true }),
  ).rejects.toThrow("unexpected shape");
});
