/**
 * @jest-environment jsdom
 */

// `assessmentStudentAssignmentsForClass` wire: the additive Current
// occurrence `groups` are parsed strictly (a malformed entry is dropped, so
// its attempts fall back to their own card), and a response without `groups`
// (an older server) yields no `groups` at all.

let callableResponse: unknown = null;

jest.mock("firebase/functions", () => ({
  httpsCallable: () => () => Promise.resolve({ data: callableResponse }),
}));

import type { Functions } from "firebase/functions";
import { createAssessmentStudentAssignmentsForClassCallable } from "./studentAssignments-wire";

const call = () =>
  createAssessmentStudentAssignmentsForClassCallable({} as Functions)({
    classId: "c1",
    studentId: "s1",
  });

const validGroup = {
  resolution: "valid",
  lessonSlug: "lesson_engineering-design",
  operationalAssignmentId: "a4",
  assignmentIds: ["a1", "a4"],
  title: "Engineering Design",
  status: "published",
  publishedAt: 1700000000000,
  hasLiveSession: true,
  isOperationalRecipient: true,
};

describe("studentAssignments wire: groups", () => {
  test("parses valid, inactive, and unresolved groups", async () => {
    callableResponse = {
      classId: "c1",
      studentId: "s1",
      assignments: [{ assignmentId: "a4", hasLiveSession: true }],
      groups: [
        validGroup,
        { ...validGroup, resolution: "inactive", operationalAssignmentId: null, hasLiveSession: false, isOperationalRecipient: false },
        { ...validGroup, resolution: "unresolved", operationalAssignmentId: "u1", assignmentIds: ["u1"], title: null, publishedAt: null },
      ],
    };
    const out = await call();
    expect(out.groups).toEqual([
      validGroup,
      { ...validGroup, resolution: "inactive", operationalAssignmentId: null, hasLiveSession: false, isOperationalRecipient: false },
      { ...validGroup, resolution: "unresolved", operationalAssignmentId: "u1", assignmentIds: ["u1"], title: null, publishedAt: null },
    ]);
    expect(out.assignments).toEqual([{ assignmentId: "a4", hasLiveSession: true }]);
  });

  test("an older server without `groups` yields no groups (per-assignment fallback)", async () => {
    callableResponse = { classId: "c1", studentId: "s1", assignments: [] };
    const out = await call();
    expect(out).not.toHaveProperty("groups");
  });

  test.each([
    ["unknown resolution", { resolution: "guessed" }],
    ["valid without an operational id", { operationalAssignmentId: null }],
    ["operational id outside the group", { operationalAssignmentId: "zz" }],
    ["inactive WITH an operational id", { resolution: "inactive" }],
    ["empty assignmentIds", { assignmentIds: [] }],
    ["non-string assignment id", { assignmentIds: ["a4", 7] }],
    ["missing lessonSlug", { lessonSlug: "" }],
  ])("drops a malformed group (%s) rather than trusting it", async (_label, patch) => {
    callableResponse = { classId: "c1", studentId: "s1", assignments: [], groups: [{ ...validGroup, ...patch }, validGroup] };
    const out = await call();
    expect(out.groups).toEqual([validGroup]);
  });
});
