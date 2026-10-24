// Class Results + Unit Results: the lesson-results wire sends exactly one
// request shape per call and validates every response through the parser.

const mockRequests: unknown[] = [];
let mockResponse: Record<string, unknown> = {};

jest.mock("firebase/functions", () => ({
  httpsCallable: () => async (data: unknown) => {
    mockRequests.push(data);
    return { data: mockResponse };
  },
}));

import type { Functions } from "firebase/functions";

import { createLessonResultsCallable } from "./lessonResultsWire";

const LESSON = {
  lessonSlug: "earths-layers",
  classesAssigned: 1,
  students: 2,
  studentsCompleted: 1,
  completionPercentage: 50,
  averageBestPercentage: 80,
  assignmentsConsidered: 1,
  classes: [
    {
      classId: "c1",
      students: 2,
      studentsCompleted: 1,
      completionPercentage: 50,
      averageBestPercentage: 80,
      assignmentsConsidered: 1,
    },
  ],
};

const callable = () => createLessonResultsCallable({} as Functions);

beforeEach(() => {
  mockRequests.length = 0;
});

test("the single request carries only lessonSlug and keeps class rows", async () => {
  mockResponse = { ...LESSON };
  const res = await callable()({ lessonSlug: "earths-layers" });
  expect(mockRequests).toEqual([{ lessonSlug: "earths-layers" }]);
  expect(res.classes).toEqual(LESSON.classes);
});

test("the batch request carries only lessonSlugs and parses each lesson", async () => {
  mockResponse = { lessons: [LESSON, { ...LESSON, lessonSlug: "photosynthesis", classes: [] }] };
  const res = await callable().batch!({ lessonSlugs: ["earths-layers", "photosynthesis"] });
  expect(mockRequests).toEqual([{ lessonSlugs: ["earths-layers", "photosynthesis"] }]);
  expect(res.map((l) => l.lessonSlug)).toEqual(["earths-layers", "photosynthesis"]);
  expect(res[1]?.classes).toEqual([]);
});

test("a batch response without lessons fails loudly", async () => {
  mockResponse = { ...LESSON };
  await expect(callable().batch!({ lessonSlugs: ["earths-layers"] })).rejects.toThrow();
});
