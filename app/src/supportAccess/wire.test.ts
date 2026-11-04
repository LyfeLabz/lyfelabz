const mockCalls = new Map<string, jest.Mock>();
jest.mock("firebase/functions", () => ({ httpsCallable: (_functions: unknown, name: string) => {
  if (!mockCalls.has(name)) mockCalls.set(name, jest.fn());
  return mockCalls.get(name);
} }));
import { createStudentSupportSeam } from "./wire";
import type { Functions } from "firebase/functions";

beforeEach(() => mockCalls.clear());
const create = () => {
  const seam = createStudentSupportSeam({} as Functions, null);
  mockCalls.get("supportAccessReconcileMine")!.mockResolvedValue({ data: { remaining: false, cursor: null } });
  return seam;
};
const legacyStudent = { grantId: "legacy", classId: "class", studentId: "student", studentDisplayName: "Synthetic" };
const response = { data: { students: [legacyStudent], workspace: { supportOnly: true } } };

test.each(["no Google binding", "transient failure", "successful reconciliation"])(
  "canonical grants remain available during %s", async scenario => {
    const seam = create();
    const reconcile = mockCalls.get("supportAccessReconcileMine")!;
    let finish!: (value: unknown) => void;
    let fail!: (reason: Error) => void;
    reconcile.mockImplementationOnce(() => new Promise((resolve, reject) => { finish = resolve; fail = reject; }));
    mockCalls.get("supportAccessListMine")!.mockResolvedValue(response);
    const reconciliation = seam.reconcilePending!();
    const observed = reconciliation.catch(error => error);
    expect(await seam.listShared()).toEqual([expect.objectContaining(legacyStudent)]);
    expect(seam.isSupportWorkspaceEligible!()).toBe(true);
    if (scenario === "transient failure") {
      fail(new Error("offline"));
      expect(await observed).toEqual(new Error("offline"));
    } else {
      finish({ data: { remaining: false, cursor: null } });
      await observed;
    }
  },
);

test("a baseline backend retains legacy reads but cannot receive a V2.1 write", async () => {
  const seam = create();
  mockCalls.get("supportAccessListMine")!.mockResolvedValue({ data: { students: [legacyStudent] } });
  mockCalls.get("supportAccessMutationGeneration")!.mockRejectedValue({ code: "functions/not-found" });
  mockCalls.get("supportAccessListForClass")!.mockResolvedValue({ data: { grants: [] } });
  expect(await seam.listShared()).toHaveLength(1);
  await seam.listForClass("class");
  await expect(seam.grantMany({ classId: "class", studentIds: ["student"], granteeEmails: ["para@weston.org"] })).rejects.toThrow("Refresh LyfeLabz");
  expect(mockCalls.get("supportAccessV21GrantMany")).not.toHaveBeenCalled();
});

test("versioned pending sharing keeps its operation ID across transport retries", async () => {
  const seam = create();
  mockCalls.get("supportAccessMutationGeneration")!.mockResolvedValue({ data: { generation: 4 } });
  mockCalls.get("supportAccessListForClass")!.mockResolvedValue({ data: { grants: [] } });
  await seam.listForClass("class");
  const call = mockCalls.get("supportAccessV21GrantMany")!;
  const row = { studentId: "student", granteeEmail: "para@weston.org", outcome: "pending", reason: null };
  call.mockRejectedValueOnce(new Error("transport")).mockResolvedValueOnce({ data: { results: [row] } });
  const input = { classId: "class", studentIds: ["student"], granteeEmails: ["para@weston.org"] };
  await expect(seam.grantMany(input)).rejects.toThrow("transport");
  expect(await seam.grantMany(input)).toEqual([row]);
  expect(call.mock.calls[0]).toEqual(call.mock.calls[1]);
  expect(call.mock.calls[0][0]).toMatchObject({ expectedGeneration: 4, operationId: expect.any(String) });
});

test("an open tab fails closed when versioned mutations become unavailable", async () => {
  const seam = create();
  mockCalls.get("supportAccessMutationGeneration")!.mockResolvedValue({ data: { generation: 0 } });
  mockCalls.get("supportAccessListForClass")!.mockResolvedValue({ data: { grants: [legacyStudent] } });
  await seam.listForClass("class");
  mockCalls.get("supportAccessV21RevokeAuthorization")!.mockRejectedValue({ code: "functions/not-found" });
  await expect(seam.revoke("legacy")).rejects.toThrow("Refresh LyfeLabz");
});

test("legacy students survive workspace maintenance failure and invitation cancellation uses its own intent", async () => {
  const seam = create();
  const students = Array.from({ length: 205 }, (_, i) => ({ ...legacyStudent, studentId: `student-${i}` }));
  mockCalls.get("supportAccessListMine")!.mockResolvedValue({ data: {
    students, workspace: { supportOnly: true, recognizedRecipient: false },
  } });
  expect(await seam.listShared()).toHaveLength(205);
  expect(seam.isSupportWorkspaceEligible!()).toBe(true);
  mockCalls.get("supportAccessMutationGeneration")!.mockResolvedValue({ data: { generation: 7 } });
  mockCalls.get("supportAccessListForClass")!.mockResolvedValue({ data: { grants: [] } });
  await seam.listForClass("class");
  const remove = mockCalls.get("supportAccessV21RemoveRecipient")!;
  remove.mockResolvedValue({ data: {} });
  await seam.removeRecipient!("invitation", undefined, true);
  expect(remove).toHaveBeenCalledWith({
    relationshipId: "invitation", cancelInvitation: true, expectedGeneration: 7, operationId: expect.any(String),
  });
});

test("pending cancellation targets its authorization and requires a revoke acknowledgement", async () => {
  const seam = create();
  const pending = { ...legacyStudent, grantId: "pending", authorizationId: "pending", status: "pending" };
  mockCalls.get("supportAccessMutationGeneration")!.mockResolvedValue({ data: { generation: 3 } });
  mockCalls.get("supportAccessListForClass")!.mockResolvedValue({ data: { grants: [pending] } });
  await seam.listForClass("class");
  const revoke = mockCalls.get("supportAccessV21RevokeAuthorization")!;
  revoke.mockResolvedValue({ data: { status: "superseded" } });
  await expect(seam.revokeMany(["pending"])).rejects.toThrow("Refresh LyfeLabz");
  expect(revoke).toHaveBeenCalledWith({
    authorizationId: "pending", operationId: expect.any(String), expectedGeneration: 3,
  });
  revoke.mockResolvedValue({ data: { status: "revoked" } });
  await expect(seam.revokeMany(["pending"])).resolves.toEqual([{ grantId: "pending", outcome: "revoked" }]);
});
