const mockAdd = jest.fn();
const mockAuditCollectionRef = jest.fn(() => ({ add: mockAdd }));

jest.mock("../firestore/typed-ref", () => ({
  auditEventsCollectionRef: () => mockAuditCollectionRef(),
}));

const SERVER_TIMESTAMP_SENTINEL = { __sentinel: "serverTimestamp" };

jest.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: () => SERVER_TIMESTAMP_SENTINEL,
  },
}));

import { PlatformError } from "../errors/platform-error";
import { writeAuditEvent, type WriteAuditEventInput } from "./write-audit-event";

function validInput(
  overrides: Partial<WriteAuditEventInput> = {},
): WriteAuditEventInput {
  return {
    actorUserId: "user-abc",
    actorRole: "student",
    action: "students.activated",
    targetType: "user",
    targetId: "user-abc",
    schoolId: "school-123",
    ...overrides,
  };
}

describe("writeAuditEvent", () => {
  beforeEach(() => {
    mockAdd.mockReset();
    mockAuditCollectionRef.mockClear();
  });

  it("writes the canonical shape with a server timestamp and returns the event id", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-1" });

    const result = await writeAuditEvent(validInput());

    expect(mockAuditCollectionRef).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd).toHaveBeenCalledWith({
      actorUserId: "user-abc",
      actorRole: "student",
      action: "students.activated",
      targetType: "user",
      targetId: "user-abc",
      schoolId: "school-123",
      occurredAt: SERVER_TIMESTAMP_SENTINEL,
    });
    expect(result).toEqual({
      eventId: "evt-1",
      record: {
        actorUserId: "user-abc",
        actorRole: "student",
        action: "students.activated",
        targetType: "user",
        targetId: "user-abc",
        schoolId: "school-123",
      },
    });
  });

  it("includes payload when supplied and omits it otherwise", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-2" });
    await writeAuditEvent(
      validInput({ payload: { reason: "personal-account" } }),
    );
    expect(mockAdd.mock.calls[0][0].payload).toEqual({
      reason: "personal-account",
    });

    mockAdd.mockResolvedValueOnce({ id: "evt-3" });
    await writeAuditEvent(validInput());
    expect(mockAdd.mock.calls[1][0]).not.toHaveProperty("payload");
  });

  it("includes correlationId when supplied and omits it otherwise", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-4" });
    await writeAuditEvent(validInput({ correlationId: "corr-xyz" }));
    expect(mockAdd.mock.calls[0][0].correlationId).toBe("corr-xyz");

    mockAdd.mockResolvedValueOnce({ id: "evt-5" });
    await writeAuditEvent(validInput());
    expect(mockAdd.mock.calls[1][0]).not.toHaveProperty("correlationId");
  });

  it("generates occurredAt via FieldValue.serverTimestamp (callers cannot backdate)", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-6" });

    await writeAuditEvent(validInput());

    expect(mockAdd.mock.calls[0][0].occurredAt).toBe(SERVER_TIMESTAMP_SENTINEL);
  });

  it("writes only the canonical fields (ignores extraneous input fields)", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-7" });

    const extraneous = {
      ...validInput(),
      severity: "high",
      raw: { junk: true },
    } as unknown as WriteAuditEventInput;
    await writeAuditEvent(extraneous);

    const written = mockAdd.mock.calls[0][0];
    expect(Object.keys(written).sort()).toEqual([
      "action",
      "actorRole",
      "actorUserId",
      "occurredAt",
      "schoolId",
      "targetId",
      "targetType",
    ]);
  });

  it.each([
    ["actorUserId"],
    ["targetType"],
    ["targetId"],
    ["schoolId"],
  ] as const)("rejects an empty %s with the corresponding invalid code", async (field) => {
    const input = validInput({ [field]: "" });
    await expect(writeAuditEvent(input)).rejects.toBeInstanceOf(PlatformError);
    await expect(writeAuditEvent(input)).rejects.toMatchObject({
      code: `audit.invalid${field.charAt(0).toUpperCase()}${field.slice(1)}`,
    });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only required field", async () => {
    await expect(
      writeAuditEvent(validInput({ actorUserId: "   " })),
    ).rejects.toMatchObject({ code: "audit.invalidActorUserId" });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("rejects an invalid actorRole", async () => {
    await expect(
      writeAuditEvent(
        // @ts-expect-error - deliberately invalid Role
        validInput({ actorRole: "parent" }),
      ),
    ).rejects.toMatchObject({ code: "audit.invalidActorRole" });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("rejects an action outside the canonical vocabulary", async () => {
    await expect(
      writeAuditEvent(
        // @ts-expect-error - deliberately non-canonical action
        validInput({ action: "students.somethingElse" }),
      ),
    ).rejects.toMatchObject({ code: "audit.invalidAction" });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("accepts every canonical action value", async () => {
    mockAdd.mockResolvedValue({ id: "evt-any" });

    const actions = [
      "auth.userProvisioned",
      "auth.activationRejected",
      "students.activated",
      "teachers.verificationRequested",
      "teachers.verificationApproved",
      "teachers.verificationDenied",
      "schools.created",
    ] as const;
    for (const action of actions) {
      await writeAuditEvent(validInput({ action, actorRole: "teacher" }));
    }
    expect(mockAdd).toHaveBeenCalledTimes(actions.length);
  });

  it("rejects an empty correlationId when supplied", async () => {
    await expect(
      writeAuditEvent(validInput({ correlationId: "" })),
    ).rejects.toMatchObject({ code: "audit.invalidCorrelationId" });
    await expect(
      writeAuditEvent(validInput({ correlationId: "   " })),
    ).rejects.toMatchObject({ code: "audit.invalidCorrelationId" });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("rejects a non-object payload", async () => {
    await expect(
      writeAuditEvent(
        // @ts-expect-error - deliberately invalid payload
        validInput({ payload: "nope" }),
      ),
    ).rejects.toMatchObject({ code: "audit.invalidPayload" });
    await expect(
      writeAuditEvent(
        // @ts-expect-error - deliberately invalid payload
        validInput({ payload: [] }),
      ),
    ).rejects.toMatchObject({ code: "audit.invalidPayload" });
    await expect(
      writeAuditEvent(
        // @ts-expect-error - deliberately invalid payload
        validInput({ payload: null }),
      ),
    ).rejects.toMatchObject({ code: "audit.invalidPayload" });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("system-actor event: writes without schoolId when schoolId is omitted", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-sys-1" });

    const result = await writeAuditEvent({
      actorUserId: "uid-new",
      actorRole: "system",
      action: "auth.userProvisioned",
      targetType: "user",
      targetId: "uid-new",
    });

    expect(mockAdd).toHaveBeenCalledTimes(1);
    const written = mockAdd.mock.calls[0][0];
    expect(written).toEqual({
      actorUserId: "uid-new",
      actorRole: "system",
      action: "auth.userProvisioned",
      targetType: "user",
      targetId: "uid-new",
      occurredAt: SERVER_TIMESTAMP_SENTINEL,
    });
    expect(Object.prototype.hasOwnProperty.call(written, "schoolId")).toBe(false);
    expect(result.record).not.toHaveProperty("schoolId");
  });

  it("system-actor event: rejects an empty-string schoolId if explicitly supplied", async () => {
    await expect(
      writeAuditEvent({
        actorUserId: "uid-new",
        actorRole: "system",
        action: "auth.userProvisioned",
        targetType: "user",
        targetId: "uid-new",
        schoolId: "",
      }),
    ).rejects.toMatchObject({ code: "audit.invalidSchoolId" });

    await expect(
      writeAuditEvent({
        actorUserId: "uid-new",
        actorRole: "system",
        action: "auth.userProvisioned",
        targetType: "user",
        targetId: "uid-new",
        schoolId: "   ",
      }),
    ).rejects.toMatchObject({ code: "audit.invalidSchoolId" });

    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("system-actor event: preserves schoolId when a resolvable school is supplied", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-sys-2" });

    await writeAuditEvent({
      actorUserId: "uid-new",
      actorRole: "system",
      action: "auth.userProvisioned",
      targetType: "user",
      targetId: "uid-new",
      schoolId: "school-123",
    });

    expect(mockAdd.mock.calls[0][0].schoolId).toBe("school-123");
  });

  it("user-actor event: still requires schoolId when schoolId is omitted entirely", async () => {
    await expect(
      writeAuditEvent({
        actorUserId: "user-abc",
        actorRole: "student",
        action: "students.activated",
        targetType: "user",
        targetId: "user-abc",
      }),
    ).rejects.toMatchObject({ code: "audit.invalidSchoolId" });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("wraps a downstream Firestore failure as audit.writeFailed and preserves the cause", async () => {
    const downstream = new Error("firestore unavailable");
    mockAdd.mockRejectedValueOnce(downstream);

    let thrown: unknown;
    try {
      await writeAuditEvent(validInput());
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(PlatformError);
    expect(thrown).toMatchObject({ code: "audit.writeFailed" });
    expect((thrown as PlatformError).cause).toBe(downstream);
  });
});
