import { createCurriculumScrollGuard } from "./curriculumScrollGuard";

describe("createCurriculumScrollGuard", () => {
  const mkIo = (maxY: number) => {
    const calls: Array<number> = [];
    return {
      io: {
        getMaxScrollY: () => maxY,
        scrollTo: (y: number) => {
          calls.push(y);
        },
      },
      calls,
    };
  };

  test("captures and restores the offset for the same teacher uid", () => {
    const { io, calls } = mkIo(2000);
    const guard = createCurriculumScrollGuard(io);
    guard.capture("uid-1", 420);
    const applied = guard.restore("uid-1");
    expect(applied).toBe(420);
    expect(calls).toEqual([420]);
  });

  test("does not restore when the teacher uid changes between capture and restore", () => {
    const { io, calls } = mkIo(2000);
    const guard = createCurriculumScrollGuard(io);
    guard.capture("uid-1", 420);
    const applied = guard.restore("uid-2");
    expect(applied).toBeNull();
    expect(calls).toEqual([]);
  });

  test("restore consumes the snapshot so a subsequent call is a no-op", () => {
    const { io, calls } = mkIo(2000);
    const guard = createCurriculumScrollGuard(io);
    guard.capture("uid-1", 420);
    guard.restore("uid-1");
    expect(guard.restore("uid-1")).toBeNull();
    expect(calls).toEqual([420]);
  });

  test("invalidate drops the pending snapshot", () => {
    const { io, calls } = mkIo(2000);
    const guard = createCurriculumScrollGuard(io);
    guard.capture("uid-1", 420);
    guard.invalidate();
    expect(guard.restore("uid-1")).toBeNull();
    expect(calls).toEqual([]);
  });

  test("restoration clamps to the current document height", () => {
    const { io, calls } = mkIo(100);
    const guard = createCurriculumScrollGuard(io);
    guard.capture("uid-1", 999);
    const applied = guard.restore("uid-1");
    expect(applied).toBe(100);
    expect(calls).toEqual([100]);
  });

  test("negative or non-finite capture values fall back to zero", () => {
    const { io } = mkIo(1000);
    const guard = createCurriculumScrollGuard(io);
    guard.capture("uid-1", -50);
    expect(guard.peek()?.scrollY).toBe(0);
    guard.capture("uid-1", Number.NaN);
    expect(guard.peek()?.scrollY).toBe(0);
  });

  test("restoration clamps below zero when the document has no scrollable range", () => {
    const { io, calls } = mkIo(-10);
    const guard = createCurriculumScrollGuard(io);
    guard.capture("uid-1", 200);
    const applied = guard.restore("uid-1");
    expect(applied).toBe(0);
    expect(calls).toEqual([0]);
  });
});
