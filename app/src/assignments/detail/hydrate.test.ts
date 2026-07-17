import { createAssignmentDetailRegistry } from "./registry";
import { hydrateAssignmentDetailRegistry } from "./hydrate";
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
