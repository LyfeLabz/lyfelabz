import { gradeSyncContextFor } from "./grade-sync-context";

describe("gradeSyncContextFor", () => {
  test("the viewed assignment is the valid Current: operational", () => {
    expect(gradeSyncContextFor("a4", { resolution: "valid", currentAssignmentId: "a4" })).toBe("operational");
  });
  test("a different assignment is the valid Current: superseded", () => {
    expect(gradeSyncContextFor("a2", { resolution: "valid", currentAssignmentId: "a4" })).toBe("superseded");
  });
  test("no Current pointer (legacy): the assignment is its own destination", () => {
    expect(gradeSyncContextFor("a1", { resolution: "unresolved", currentAssignmentId: null })).toBe("operational");
  });
  test.each(["inactive", "invalid"] as const)("%s Current: non-actionable, never resurrected", (resolution) => {
    expect(gradeSyncContextFor("a1", { resolution, currentAssignmentId: null })).toBe("nonActionable");
  });
  test("Current unknown: non-actionable (fail closed)", () => {
    expect(gradeSyncContextFor("a1", null)).toBe("nonActionable");
  });
});
