/**
 * Performance Operation 1 (Sol certification, HIGH): a teacher bootstrap
 * superseded at the await handoff must not install obsolete shared state.
 *
 * The defect: a currency check made BEFORE the awaiting caller resumes (a
 * helper that checked, then returned a Boolean snapshot) leaves a microtask
 * gap. Another bootstrap can start inside that gap, and the obsolete caller
 * then trusts the stale snapshot and installs shared dependencies.
 *
 * `app/src/index.ts` boots Firebase on import, so the teacher branch of its
 * `rerun` is driven here through a harness that performs the same steps in
 * the same order: take the next run token synchronously, await the session
 * bootstrap and check, await the Functions import, then (production) check
 * the LIVE token in the caller's own continuation before installing the
 * shared dependencies, starting the REAL hydration controller, recording the
 * active teacher, rebuilding the surface seam, and dispatching.
 * `hydration.entrypoint.test.ts` pins that the entry point's teacher branch
 * has exactly this shape (the import is its only await, the live check is
 * the first statement after it, and every installation follows the check).
 *
 * The harness also runs the replaced snapshot pattern against the same
 * interleaving, proving the regression test detects the defect.
 */
import { createAssignmentDetailRegistry } from "../assignments/detail/registry";
import { createAssignmentRegistryHydration } from "../assignments/detail/hydration";
import type { AssignmentDetailMetadata } from "../assignments/detail/types";

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
const deferred = <T>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0));
};

type Teacher = { readonly uid: string; readonly schoolId: string };
type FunctionsModule = { readonly owner: string };

const meta = (assignmentId: string): AssignmentDetailMetadata =>
  Object.freeze({
    assignmentId,
    title: assignmentId,
    className: "6A",
    status: "published" as const,
    lessonSlug: "earths-layers",
    classId: "c1",
  });

// The guard placement under test.
//  - "live": production. The caller awaits the import, then reads the live
//    token itself before anything else.
//  - "snapshot": the replaced pattern. A helper awaited the import, checked
//    currency, and returned a Boolean the caller trusted after resuming.
type Guard = "live" | "snapshot";

const entryPointModel = (guard: Guard) => {
  let currentRunToken = 0;
  const registry = createAssignmentDetailRegistry();
  const hydration = createAssignmentRegistryHydration(registry);
  const enumerations: string[] = [];
  // Every externally observable write, in order, tagged with its run.
  const writes: string[] = [];
  // Shared dependencies, as the entry point's module-level `let`s.
  const deps = {
    functions: null as FunctionsModule | null,
    integrations: null as string | null,
    assignments: null as string | null,
    teacherUnits: null as string | null,
    importFromClassroom: null as string | null,
    activeTeacher: null as Teacher | null,
    seam: null as string | null,
  };
  // Lets a test act inside the snapshot helper's handoff gap: called right
  // after the helper found the run current, before its caller resumes.
  let onSnapshotTaken: (() => void) | null = null;

  const snapshotHelper = async <T>(
    step: () => Promise<T>,
    isCurrent: () => boolean,
  ): Promise<{ current: boolean; value?: T }> => {
    const value = await step();
    const current = isCurrent();
    const hook = onSnapshotTaken;
    onSnapshotTaken = null;
    if (hook !== null) queueMicrotask(hook);
    return current ? { current, value } : { current };
  };

  const rerunTeacher = async (
    teacher: Teacher,
    functionsImport: Promise<FunctionsModule>,
  ): Promise<void> => {
    const runToken = ++currentRunToken;
    await Promise.resolve(); // bootstrapSession
    if (runToken !== currentRunToken) return;
    let functions: FunctionsModule;
    if (guard === "live") {
      functions = await functionsImport;
      if (runToken !== currentRunToken) return;
    } else {
      const loaded = await snapshotHelper(
        () => functionsImport,
        () => runToken === currentRunToken,
      );
      if (!loaded.current) return;
      functions = loaded.value as FunctionsModule;
    }
    const tag = teacher.uid;
    deps.functions = functions;
    deps.integrations = tag;
    deps.assignments = tag;
    deps.teacherUnits = tag;
    writes.push(`${tag}:dependencies`);
    if (runToken !== currentRunToken) return;
    deps.importFromClassroom = tag;
    hydration.start(
      {
        uid: teacher.uid,
        schoolId: teacher.schoolId,
        generation: runToken,
        isCurrent: () => runToken === currentRunToken,
      },
      async () => {
        enumerations.push(tag);
        return [meta(`${tag}-assignment`)];
      },
    );
    writes.push(`${tag}:hydration`);
    deps.activeTeacher = teacher;
    writes.push(`${tag}:session`);
    if (runToken !== currentRunToken) return;
    deps.seam = tag;
    writes.push(`${tag}:seam`);
    if (runToken !== currentRunToken) return;
    writes.push(`${tag}:dispatch`);
  };

  return {
    rerunTeacher,
    registry,
    hydration,
    enumerations,
    writes,
    deps,
    isCurrentToken: (token: number) => token === currentRunToken,
    currentToken: () => currentRunToken,
    setOnSnapshotTaken: (hook: () => void) => {
      onSnapshotTaken = hook;
    },
  };
};

const teacherA: Teacher = { uid: "teacher-A", schoolId: "school-1" };
const teacherB: Teacher = { uid: "teacher-B", schoolId: "school-1" };

const expectOnlyB = (m: ReturnType<typeof entryPointModel>): void => {
  expect(m.writes.filter((w) => w.startsWith("teacher-A"))).toEqual([]);
  expect(m.deps.functions).toEqual({ owner: "B" }); // dependencies not replaced
  expect(m.deps.integrations).toBe("teacher-B");
  expect(m.deps.assignments).toBe("teacher-B");
  expect(m.deps.teacherUnits).toBe("teacher-B");
  expect(m.deps.importFromClassroom).toBe("teacher-B");
  expect(m.deps.activeTeacher).toEqual(teacherB); // session not replaced
  expect(m.deps.seam).toBe("teacher-B"); // seam not replaced
  expect(m.enumerations).toEqual(["teacher-B"]); // no obsolete hydration
  expect(m.writes.filter((w) => w.endsWith(":dispatch"))).toEqual(["teacher-B:dispatch"]);
  expect(m.registry.list().map((x) => x.assignmentId)).toEqual(["teacher-B-assignment"]);
  expect(m.hydration.status()).toBe("ready");
};

describe("teacher bootstrap: supersession inside the await handoff", () => {
  test("A's import settles while A is current; B starts before A's caller resumes; A installs nothing", async () => {
    const m = entryPointModel("live");
    const importA = deferred<FunctionsModule>();

    // 1-2. A begins and awaits its asynchronous import.
    const runA = m.rerunTeacher(teacherA, importA.promise);
    await settle();
    const tokenA = m.currentToken();
    expect(m.writes).toEqual([]);

    // 3. The import settles while A is still current, queueing A's
    //    continuation. 4-5. In the same turn, before that continuation
    //    runs, B starts and invalidates A.
    importA.resolve({ owner: "A" });
    expect(m.isCurrentToken(tokenA)).toBe(true);
    const runB = m.rerunTeacher(teacherB, Promise.resolve({ owner: "B" }));
    expect(m.isCurrentToken(tokenA)).toBe(false);

    // 6. A's caller resumes (its continuation was queued first).
    await runA;
    // 7. A wrote nothing at all, before or after B completes.
    expect(m.writes).toEqual([]);
    await runB;
    await settle();
    expectOnlyB(m);
  });

  test("the replaced snapshot pattern, under the same handoff, installs A's dependencies (the defect)", async () => {
    const m = entryPointModel("snapshot");
    const importA = deferred<FunctionsModule>();
    const runA = m.rerunTeacher(teacherA, importA.promise);
    await settle();
    const tokenA = m.currentToken();

    // B starts inside the gap: after the helper found A current, before
    // A's caller resumes.
    let runB: Promise<void> | null = null;
    let aWasCurrentAtSnapshot: boolean | null = null;
    m.setOnSnapshotTaken(() => {
      aWasCurrentAtSnapshot = m.isCurrentToken(tokenA);
      runB = m.rerunTeacher(teacherB, Promise.resolve({ owner: "B" }));
    });
    importA.resolve({ owner: "A" });
    await runA;
    await runB;
    await settle();

    expect(aWasCurrentAtSnapshot).toBe(true);
    // The obsolete run mutated shared dependencies before a later check
    // stopped it. This is exactly what the live caller-side check prevents.
    expect(m.writes[0]).toBe("teacher-A:dependencies");
    // Later guards still kept A from dispatching (they were never the gap).
    expect(m.writes).not.toContain("teacher-A:dispatch");
  });

  test("B supersedes while A's import is still pending: A installs nothing", async () => {
    const m = entryPointModel("live");
    const importA = deferred<FunctionsModule>();
    const runA = m.rerunTeacher(teacherA, importA.promise);
    await settle();
    await m.rerunTeacher(teacherB, Promise.resolve({ owner: "B" }));
    await settle();
    importA.resolve({ owner: "A" });
    await runA;
    await settle();
    expectOnlyB(m);
  });

  test("a same-teacher school change in the handoff gap installs nothing for the old school", async () => {
    const m = entryPointModel("live");
    const schoolA = { uid: "teacher-1", schoolId: "school-A" };
    const schoolB = { uid: "teacher-1", schoolId: "school-B" };
    const importA = deferred<FunctionsModule>();
    const runA = m.rerunTeacher(schoolA, importA.promise);
    await settle();
    importA.resolve({ owner: "A" });
    const runB = m.rerunTeacher(schoolB, Promise.resolve({ owner: "B" }));
    await runA;
    await runB;
    await settle();
    expect(m.deps.activeTeacher).toEqual(schoolB);
    expect(m.deps.functions).toEqual({ owner: "B" });
    expect(m.writes.filter((w) => w.endsWith(":dependencies"))).toHaveLength(1);
    expect(m.enumerations).toHaveLength(1);
  });

  test("an uncontested bootstrap completes normally", async () => {
    const m = entryPointModel("live");
    await m.rerunTeacher(teacherA, Promise.resolve({ owner: "A" }));
    await settle();
    expect(m.writes).toEqual([
      "teacher-A:dependencies",
      "teacher-A:hydration",
      "teacher-A:session",
      "teacher-A:seam",
      "teacher-A:dispatch",
    ]);
    expect(m.deps.activeTeacher).toEqual(teacherA);
    expect(m.enumerations).toEqual(["teacher-A"]);
    expect(m.hydration.status()).toBe("ready");
  });
});
