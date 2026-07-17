import { createAssignmentDetailRegistry } from "./registry";
import {
  hydrateAssignmentDetailRegistry,
  parseAssignmentsTeacherListItem,
} from "./hydrate";
import type { AssignmentDetailMetadata } from "./types";

describe("hydrateAssignmentDetailRegistry", () => {
  test("populates registry from callable result", async () => {
    const registry = createAssignmentDetailRegistry();
    const items: AssignmentDetailMetadata[] = [
      {
        assignmentId: "a1",
        title: "Earth's Layers",
        status: "published",
        className: "Block A",
        lessonSlug: "lesson_g7_earths-layers",
        classId: "class-a",
      },
    ];
    await hydrateAssignmentDetailRegistry(registry, async () => items);
    expect(registry.lookup("a1")).toEqual(items[0]);
    expect(registry.list()).toHaveLength(1);
  });

  test("failed retrieval does not throw or block", async () => {
    const registry = createAssignmentDetailRegistry();
    await expect(
      hydrateAssignmentDetailRegistry(registry, async () => {
        throw new Error("callable exploded");
      }),
    ).resolves.toBeUndefined();
    expect(registry.list()).toEqual([]);
  });

  test("deduplicates hydrated and republished entries by assignmentId", async () => {
    const registry = createAssignmentDetailRegistry();
    // Simulate hydration
    await hydrateAssignmentDetailRegistry(registry, async () => [
      {
        assignmentId: "a1",
        title: "Old Title",
        status: "published",
        className: "Block A",
        lessonSlug: "l",
        classId: "c",
      },
    ]);
    // Simulate current-session publish overwriting the hydrated entry
    registry.register({
      assignmentId: "a1",
      title: "New Title",
      status: "published",
      className: "Block A",
      lessonSlug: "l",
      classId: "c",
    });
    expect(registry.list()).toHaveLength(1);
    expect(registry.lookup("a1")?.title).toBe("New Title");
  });

  test("clear removes hydrated state", async () => {
    const registry = createAssignmentDetailRegistry();
    await hydrateAssignmentDetailRegistry(registry, async () => [
      {
        assignmentId: "a1",
        title: "T",
        status: "published",
        className: "C",
        lessonSlug: "l",
        classId: "c",
      },
    ]);
    registry.clear();
    expect(registry.lookup("a1")).toBeNull();
    expect(registry.list()).toEqual([]);
  });
});

describe("parseAssignmentsTeacherListItem - Sprint 13F draft support", () => {
  test("accepts a draft item", () => {
    const parsed = parseAssignmentsTeacherListItem({
      assignmentId: "d1",
      lessonSlug: "earths-layers",
      title: "Earth's Layers",
      classId: "c1",
      className: "6A",
      status: "draft",
    });
    expect(parsed?.status).toBe("draft");
    expect(parsed?.assignmentId).toBe("d1");
  });

  test("still accepts published and closed items unchanged", () => {
    for (const status of ["published", "closed"] as const) {
      const parsed = parseAssignmentsTeacherListItem({
        assignmentId: "a1",
        lessonSlug: "l",
        title: "T",
        classId: "c",
        className: "C",
        status,
      });
      expect(parsed?.status).toBe(status);
    }
  });

  test("still rejects unknown status values", () => {
    expect(
      parseAssignmentsTeacherListItem({
        assignmentId: "a1",
        lessonSlug: "l",
        title: "T",
        classId: "c",
        className: "C",
        status: "archived",
      }),
    ).toBeNull();
  });
});

describe("parseAssignmentsTeacherListItem - Sprint 13G scope completion", () => {
  test("parses instructions when present", () => {
    const parsed = parseAssignmentsTeacherListItem({
      assignmentId: "d1",
      lessonSlug: "earths-layers",
      title: "Earth's Layers",
      classId: "c1",
      className: "6A",
      status: "draft",
      instructions: "Read the intro.",
    });
    expect(parsed?.instructions).toBe("Read the intro.");
  });

  test("omits instructions when the projection does not carry the field", () => {
    const parsed = parseAssignmentsTeacherListItem({
      assignmentId: "d1",
      lessonSlug: "earths-layers",
      title: "Earth's Layers",
      classId: "c1",
      className: "6A",
      status: "draft",
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.instructions).toBeUndefined();
  });

  test("omits instructions when the projection carries an empty string", () => {
    const parsed = parseAssignmentsTeacherListItem({
      assignmentId: "d1",
      lessonSlug: "earths-layers",
      title: "Earth's Layers",
      classId: "c1",
      className: "6A",
      status: "draft",
      instructions: "",
    });
    expect(parsed?.instructions).toBeUndefined();
  });
});

describe("hydrateAssignmentDetailRegistry - Sprint 13F drafts", () => {
  test("registers a draft item so Detail can look it up after reload", async () => {
    const registry = createAssignmentDetailRegistry();
    const items: AssignmentDetailMetadata[] = [
      {
        assignmentId: "d1",
        title: "Earth's Layers",
        status: "draft",
        className: "6A",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
    ];
    await hydrateAssignmentDetailRegistry(registry, async () => items);
    expect(registry.lookup("d1")?.status).toBe("draft");
  });
});
