import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { CallableRequest } from "firebase-functions/v2/https";
const mockContext = jest.fn();
const mockGuard = jest.fn();
jest.mock("../shared/auth/require-district-context", () => ({ requireDistrictContext: (...args: unknown[]) => mockContext(...args) }));
jest.mock("./recipient-policy", () => ({ assertTeachingAllowed: (...args: unknown[]) => mockGuard(...args) }));
import { guardedTeachingCallable, teachingCallable } from "./teaching-callable";
import { PlatformError } from "../shared/errors/platform-error";

beforeEach(() => { jest.clearAllMocks(); mockContext.mockResolvedValue({ uid: "recipient", role: "teacher", schoolId: "school", districtId: "district" }); mockGuard.mockResolvedValue(undefined); });
test("public direct invocation denies a support recipient before a teaching side effect", async () => {
  mockGuard.mockRejectedValue(new PlatformError("supportAccess.forbidden", "forbidden"));
  const effect = jest.fn();
  await expect(teachingCallable(effect).run({ data: {} } as CallableRequest)).rejects.toMatchObject({ code: "permission-denied", details: { code: "supportAccess.forbidden" } });
  expect(effect).not.toHaveBeenCalled();
});
test("science-teacher operations retain their handler and response", async () => {
  const effect = jest.fn().mockResolvedValue({ saved: true });
  await expect(teachingCallable({ maxInstances: 20 }, effect).run({ data: { classId: "owned" } } as CallableRequest)).resolves.toEqual({ saved: true });
  expect(effect).toHaveBeenCalledTimes(1);
});
test("student operations retain their existing role-specific authorization", async () => {
  mockContext.mockResolvedValue({ uid: "student", role: "student" });
  const handler = jest.fn().mockRejectedValue(new PlatformError("role-forbidden", "original refusal"));
  await expect(teachingCallable(handler).run({ data: {} } as CallableRequest)).rejects.toMatchObject({ details: { code: "role-forbidden" } });
  expect(mockGuard).not.toHaveBeenCalled();
});
test("a domain preflight runs before any guard read and a refusal stops the guard and handler", async () => {
  const order: string[] = [];
  mockContext.mockImplementation(() => { order.push("context"); return Promise.resolve({ uid: "t", role: "teacher", schoolId: "s", districtId: "d" }); });
  mockGuard.mockImplementation(() => { order.push("guard"); return Promise.resolve(); });
  const handler = jest.fn(() => { order.push("handler"); return Promise.resolve({ ok: true }); });
  const preflight = jest.fn((): Promise<void> => { order.push("preflight"); return Promise.resolve(); });
  await expect(guardedTeachingCallable({ maxInstances: 20 }, handler, preflight).run({ data: {} } as CallableRequest)).resolves.toEqual({ ok: true });
  expect(order).toEqual(["preflight", "context", "guard", "handler"]);
  order.length = 0;
  preflight.mockRejectedValueOnce(new PlatformError("teacherUnits.runtimeIdentityUnavailable", "unverified"));
  await expect(guardedTeachingCallable({ maxInstances: 20 }, handler, preflight).run({ data: {} } as CallableRequest)).rejects.toMatchObject({ code: "unavailable", details: { code: "teacherUnits.runtimeIdentityUnavailable" } });
  expect(order).toEqual([]);
});
test("a domain preflight does not bypass the Student Support guard", async () => {
  mockGuard.mockRejectedValue(new PlatformError("supportAccess.forbidden", "forbidden"));
  const handler = jest.fn();
  await expect(guardedTeachingCallable({ maxInstances: 20 }, handler, () => Promise.resolve()).run({ data: {} } as CallableRequest)).rejects.toMatchObject({ code: "permission-denied", details: { code: "supportAccess.forbidden" } });
  expect(handler).not.toHaveBeenCalled();
});
test("all teaching-domain callable exports enlist the guard", () => {
  const root = resolve(__dirname, "..");
  for (const domain of ["classes", "assignments", "lms", "teacherUnits", "accommodations", "enrollments"]) {
    for (const file of readdirSync(resolve(root, domain)).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const source = readFileSync(resolve(root, domain, file), "utf8");
      expect({ file: `${domain}/${file}`, bypass: /export const \w+\s*=\s*platformCallable\(/.test(source) }).toEqual({ file: `${domain}/${file}`, bypass: false });
    }
  }
});
