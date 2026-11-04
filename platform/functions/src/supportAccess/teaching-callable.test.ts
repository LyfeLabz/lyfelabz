import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { CallableRequest } from "firebase-functions/v2/https";
const mockContext = jest.fn();
const mockGuard = jest.fn();
jest.mock("../shared/auth/require-district-context", () => ({ requireDistrictContext: (...args: unknown[]) => mockContext(...args) }));
jest.mock("./recipient-policy", () => ({ assertTeachingAllowed: (...args: unknown[]) => mockGuard(...args) }));
import { teachingCallable } from "./teaching-callable";
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
test("all teaching-domain callable exports enlist the guard", () => {
  const root = resolve(__dirname, "..");
  for (const domain of ["classes", "assignments", "lms", "teacherUnits", "accommodations", "enrollments"]) {
    for (const file of readdirSync(resolve(root, domain)).filter(f => f.endsWith(".ts") && !f.endsWith(".test.ts"))) {
      const source = readFileSync(resolve(root, domain, file), "utf8");
      expect({ file: `${domain}/${file}`, bypass: /export const \w+\s*=\s*platformCallable\(/.test(source) }).toEqual({ file: `${domain}/${file}`, bypass: false });
    }
  }
});
