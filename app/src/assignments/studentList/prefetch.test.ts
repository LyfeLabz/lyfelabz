/**
 * @jest-environment node
 */
import * as fs from "fs";
import * as path from "path";

import { startStudentPrefetch, withPrefetchedFirstCall } from "./prefetch";

const listResponse = { items: [], supersededAssignmentIds: [], historyOnlyGroups: [] };
const attemptsResponse = { attempts: [] };

function deps(overrides: Partial<Parameters<typeof startStudentPrefetch>[0]> = {}) {
  const assignments = jest.fn(() => Promise.resolve(listResponse));
  const attempts = jest.fn(() => Promise.resolve(attemptsResponse));
  return {
    assignments,
    attempts,
    input: {
      readCachedIdentity: async () => ({ uid: "stu-1", claims: { role: "student" } }),
      skip: () => false,
      createCallables: async () => ({ assignments, attempts }),
      ...overrides,
    },
  };
}

describe("startStudentPrefetch", () => {
  test("cached student claim: starts BOTH reads concurrently, before either resolves", async () => {
    const releases: Array<() => void> = [];
    const pending = <T,>(v: T) => new Promise<T>((resolve) => releases.push(() => resolve(v)));
    const assignments = jest.fn(() => pending(listResponse));
    const attempts = jest.fn(() => pending(attemptsResponse));
    const prefetch = await startStudentPrefetch({
      readCachedIdentity: async () => ({ uid: "stu-1", claims: { role: "student" } }),
      skip: () => false,
      createCallables: async () => ({ assignments, attempts }),
    });
    expect(prefetch?.uid).toBe("stu-1");
    expect(assignments).toHaveBeenCalledTimes(1);
    expect(attempts).toHaveBeenCalledTimes(1);
    releases.forEach((r) => r());
    await expect(prefetch?.assignments).resolves.toBe(listResponse);
    await expect(prefetch?.attempts).resolves.toBe(attemptsResponse);
  });

  test.each([
    ["teacher", { role: "teacher" }],
    ["no role claim", {}],
    ["administrator", { role: "platformAdministrator" }],
  ])("%s token: no request is started", async (_label, claims) => {
    const d = deps({ readCachedIdentity: async () => ({ uid: "u", claims }) });
    expect(await startStudentPrefetch(d.input)).toBeNull();
    expect(d.assignments).not.toHaveBeenCalled();
    expect(d.attempts).not.toHaveBeenCalled();
  });

  test("signed out: no request is started", async () => {
    const d = deps({ readCachedIdentity: async () => null });
    expect(await startStudentPrefetch(d.input)).toBeNull();
    expect(d.assignments).not.toHaveBeenCalled();
  });

  test("pending deep-link arrival: skipped (My Science will not render)", async () => {
    const d = deps({ skip: () => true });
    expect(await startStudentPrefetch(d.input)).toBeNull();
    expect(d.assignments).not.toHaveBeenCalled();
  });

  test("an unused, failed prefetch never becomes an unhandled rejection", async () => {
    const onUnhandled = jest.fn();
    process.on("unhandledRejection", onUnhandled);
    try {
      await startStudentPrefetch(
        deps({
          createCallables: async () => ({
            assignments: () => Promise.reject(new Error("offline")),
            attempts: () => Promise.reject(new Error("offline")),
          }),
        }).input,
      );
      await new Promise((r) => setTimeout(r, 0));
      expect(onUnhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
  });
});

describe("withPrefetchedFirstCall", () => {
  test("the surface's FIRST read consumes the prefetched request (no second network call)", async () => {
    const callable = jest.fn(() => Promise.resolve("fresh"));
    const read = withPrefetchedFirstCall(callable, Promise.resolve("prefetched"));
    await expect(read()).resolves.toBe("prefetched");
    expect(callable).not.toHaveBeenCalled();
  });

  test("every later read (Retry, return visit) calls the server again", async () => {
    const callable = jest.fn(() => Promise.resolve("fresh"));
    const read = withPrefetchedFirstCall(callable, Promise.resolve("prefetched"));
    await read();
    await expect(read()).resolves.toBe("fresh");
    await expect(read()).resolves.toBe("fresh");
    expect(callable).toHaveBeenCalledTimes(2);
  });

  test("a failed prefetch surfaces its error once; Retry then calls fresh", async () => {
    const callable = jest.fn(() => Promise.resolve("fresh"));
    const read = withPrefetchedFirstCall(callable, Promise.reject(new Error("cold")));
    await expect(read()).rejects.toThrow("cold");
    await expect(read()).resolves.toBe("fresh");
  });

  test("no prefetch: calls through from the first read", async () => {
    const callable = jest.fn(() => Promise.resolve("fresh"));
    await withPrefetchedFirstCall(callable, null)();
    expect(callable).toHaveBeenCalledTimes(1);
  });
});

describe("entry point wiring (regression pin)", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../../index.ts"), "utf8");

  test("the prefetch starts before bootstrapSession is awaited", () => {
    const start = source.indexOf("const studentPrefetch = startStudentPrefetch(");
    const bootstrap = source.indexOf("const session = await bootstrapSession(");
    expect(start).toBeGreaterThan(-1);
    expect(bootstrap).toBeGreaterThan(start);
  });

  test("the prefetch is used only for the same uid as the canonical activeStudent session", () => {
    expect(source).toMatch(/prefetch !== null && prefetch\.uid === session\.uid/);
  });
});
