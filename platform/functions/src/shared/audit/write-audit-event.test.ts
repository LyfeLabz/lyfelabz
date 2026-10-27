const mockAdd = jest.fn();
const mockDoc = jest.fn(() => ({ id: "evt-doc-1" }));
const mockAuditCollectionRef = jest.fn(() => ({ add: mockAdd, doc: mockDoc }));

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
import { AUDIT_ACTIONS } from "../types/audit-event";
import {
  buildAuditEventWrite,
  writeAuditEvent,
  writeAuditEventInTransaction,
  type WriteAuditEventInput,
} from "./write-audit-event";

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

  // Named regression assertions for the three actions that had drifted
  // between the AuditAction type union and the removed VALID_ACTIONS
  // allowlist prior to the Sprint 24B Phase 2B.6 single-source-of-truth
  // refactor. Kept alongside the exhaustive AUDIT_ACTIONS iteration
  // below so any future regression surfaces both a named signal and an
  // aggregate signal.
  it("regression (Sprint 24B Phase 2B.6): accepts classes.activated", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-cls-act" });
    await writeAuditEvent(
      validInput({ action: "classes.activated", actorRole: "teacher" }),
    );
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][0].action).toBe("classes.activated");
  });

  it("regression (Sprint 24B Phase 2B.6): accepts assignments.reopened", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-a-reop" });
    await writeAuditEvent(
      validInput({ action: "assignments.reopened", actorRole: "teacher" }),
    );
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][0].action).toBe("assignments.reopened");
  });

  it("regression (Sprint 24B Phase 2B.6): accepts assignments.recipientAdded", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-a-recip" });
    await writeAuditEvent(
      validInput({ action: "assignments.recipientAdded", actorRole: "teacher" }),
    );
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][0].action).toBe("assignments.recipientAdded");
  });

  it("regression (Sprint 26 Phase 1): accepts lms.connectionScopesWidened", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-scopes-widened" });
    await writeAuditEvent(
      validInput({ action: "lms.connectionScopesWidened", actorRole: "teacher" }),
    );
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][0].action).toBe("lms.connectionScopesWidened");
  });

  it("regression (Sprint 26 Phase 1): accepts lms.connectionWideningRejected", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-widening-rejected" });
    await writeAuditEvent(
      validInput({
        action: "lms.connectionWideningRejected",
        actorRole: "teacher",
      }),
    );
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][0].action).toBe(
      "lms.connectionWideningRejected",
    );
  });

  it("regression (Sprint 26 follow-up): accepts lms.connectionRecovered", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-conn-recovered" });
    await writeAuditEvent(
      validInput({ action: "lms.connectionRecovered", actorRole: "teacher" }),
    );
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][0].action).toBe("lms.connectionRecovered");
  });

  it("regression (Sprint 26 follow-up): accepts lms.connectionRecoveryRejected", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-conn-recovery-rejected" });
    await writeAuditEvent(
      validInput({
        action: "lms.connectionRecoveryRejected",
        actorRole: "teacher",
      }),
    );
    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockAdd.mock.calls[0][0].action).toBe(
      "lms.connectionRecoveryRejected",
    );
  });

  // Exhaustive by construction: iterates the canonical AUDIT_ACTIONS tuple
  // that is the single source of truth for both the AuditAction type and
  // the runtime validator. Any new action added to AUDIT_ACTIONS is exercised
  // here on the next test run, and any action present in the type union but
  // absent from the runtime allowlist would fail this test with an
  // audit.invalidAction rejection. That closes the Sprint 24B Phase 2B.6
  // certification defect where `classes.activated` (and, historically,
  // `assignments.reopened` and `assignments.recipientAdded`) had been added
  // to the type union but not to the runtime allowlist.
  it("accepts every action in the canonical AUDIT_ACTIONS tuple", async () => {
    mockAdd.mockResolvedValue({ id: "evt-any" });

    for (const action of AUDIT_ACTIONS) {
      await writeAuditEvent(action === "teacherUnits.availabilityChanged" ? operatorInput() : validInput({ action, actorRole: "teacher" }));
    }
    expect(mockAdd).toHaveBeenCalledTimes(AUDIT_ACTIONS.length);
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

  // Sprint 11D I-5. Every district-relevant audit event MUST carry a
  // top-level `districtId` field per DISTRICT_SECURITY_BOUNDARY_
  // IMPLEMENTATION_CONTRACT.md §7. The writer must accept it, validate
  // it as a non-empty string when supplied, and persist it verbatim.
  it("I-5: persists a supplied districtId at the top level of the audit record", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-district" });
    const result = await writeAuditEvent(
      validInput({ districtId: "district-42" }),
    );
    expect(result.record).toMatchObject({ districtId: "district-42" });
    const written = mockAdd.mock.calls[0][0] as { districtId?: string };
    expect(written.districtId).toBe("district-42");
  });

  it("I-5: refuses an empty-string districtId", async () => {
    await expect(
      writeAuditEvent(validInput({ districtId: "" })),
    ).rejects.toMatchObject({ code: "audit.invalidDistrictId" });
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it("I-5: permits an omitted districtId for legacy pre-district events", async () => {
    mockAdd.mockResolvedValueOnce({ id: "evt-legacy" });
    const result = await writeAuditEvent(validInput());
    expect(result.record).not.toHaveProperty("districtId");
    const written = mockAdd.mock.calls[0][0] as Record<string, unknown>;
    expect(written).not.toHaveProperty("districtId");
  });
});

describe("writeAuditEventInTransaction", () => {
  beforeEach(() => {
    mockAdd.mockReset();
    mockDoc.mockClear();
    mockAuditCollectionRef.mockClear();
  });

  it("enlists the canonical write via tx.set on a fresh doc ref and returns its id", () => {
    const txSet = jest.fn();
    const tx = { set: txSet } as never;

    const result = writeAuditEventInTransaction(tx, validInput());

    expect(mockDoc).toHaveBeenCalledTimes(1);
    expect(mockAdd).not.toHaveBeenCalled();
    expect(txSet).toHaveBeenCalledTimes(1);
    const [ref, write] = txSet.mock.calls[0];
    expect(ref).toEqual({ id: "evt-doc-1" });
    expect(write).toEqual({
      actorUserId: "user-abc",
      actorRole: "student",
      action: "students.activated",
      targetType: "user",
      targetId: "user-abc",
      schoolId: "school-123",
      occurredAt: SERVER_TIMESTAMP_SENTINEL,
    });
    expect(result.eventId).toBe("evt-doc-1");
  });

  it("validates synchronously and never touches the transaction on invalid input", () => {
    const txSet = jest.fn();
    const tx = { set: txSet } as never;
    expect(() =>
      writeAuditEventInTransaction(tx, validInput({ actorUserId: "  " })),
    ).toThrow(PlatformError);
    expect(txSet).not.toHaveBeenCalled();
  });

  it("accepts the users.suspended action with school/district context and payload", () => {
    const txSet = jest.fn();
    const tx = { set: txSet } as never;
    writeAuditEventInTransaction(
      tx,
      validInput({
        actorRole: "platformAdministrator",
        action: "users.suspended",
        targetType: "user",
        targetId: "uid-teacher",
        schoolId: "school-1",
        districtId: "district-1",
        payload: { previousStatus: "active", role: "teacher" },
      }),
    );
    const [, write] = txSet.mock.calls[0];
    expect(write.action).toBe("users.suspended");
    expect(write.districtId).toBe("district-1");
    expect(write.payload).toEqual({ previousStatus: "active", role: "teacher" });
  });
});

// B1d validates supplied server attribution only. These invented subjects are
// not authenticated credentials; B1e must verify and bind the real context.
type MutableAuditInput = { -readonly [K in keyof WriteAuditEventInput]: WriteAuditEventInput[K] };
function operatorInput(): MutableAuditInput {
  return { actorUserId: "principal:synthetic-owner", actorRole: "operator", action: "teacherUnits.availabilityChanged",
    targetType: "teacherUnitsAvailability", targetId: "platformConfig/teacherUnitsAvailability",
    correlationId: "00000000-0000-4000-8000-000000000001", payload: {
      transition: "enable", policyInstanceId: "00000000-0000-4000-8000-000000000002", generation: 3,
      mode: "enabled", approvedBackendBuildId: "a".repeat(64), placementFingerprint: "b".repeat(64),
      operator: { principalSubject: "principal:synthetic-owner", credentialSubject: "credential:synthetic-service", delegationSubject: "delegation:synthetic-owner" },
      reason: "Synthetic approved transition", approvalRef: "synthetic-owner-decision",
    } };
}
function operatorPatch(path: string[], value: unknown): MutableAuditInput {
  const input = operatorInput(); let cursor = input as unknown as Record<string, any>;
  for (const key of path.slice(0, -1)) cursor = cursor[key];
  cursor[path[path.length - 1]] = value; return input;
}
function expectInvalidOperator(input: WriteAuditEventInput): void {
  const txSet = jest.fn();
  expect(() => buildAuditEventWrite(input)).toThrow(PlatformError);
  expect(() => writeAuditEventInTransaction({ set: txSet } as never, input)).toThrow(PlatformError);
  expect(txSet).not.toHaveBeenCalled();
}
describe("narrow My Units operator audit contract", () => {
  beforeEach(() => { mockAdd.mockReset(); mockDoc.mockClear(); mockAuditCollectionRef.mockClear(); });
  it("uses the canonical server timestamp, exact global fields and a detached payload", async () => {
    const input = operatorInput(); const built = buildAuditEventWrite(input);
    expect(built.record).toEqual(input); expect(built.write.occurredAt).toBe(SERVER_TIMESTAMP_SENTINEL);
    expect(built.record).not.toHaveProperty("schoolId"); expect(built.record).not.toHaveProperty("districtId");
    expect(built.record).not.toHaveProperty("authenticated");
    expect(Object.isFrozen(built.record.payload)).toBe(true);
    expect(built.record.payload).not.toBe(input.payload);
    mockAdd.mockResolvedValueOnce({ id: "evt-operator" });
    expect((await writeAuditEvent(input)).eventId).toBe("evt-operator");
    const txSet = jest.fn(); const staged = writeAuditEventInTransaction({ set: txSet } as never, input);
    expect(staged.eventId).toBe("evt-doc-1"); expect(txSet).toHaveBeenCalledTimes(1);
    expect(txSet.mock.calls[0][1]).toEqual(built.write);
    expect(staged).not.toHaveProperty("committed"); // Enlistment is not proof of commit or policy change.
  });
  it.each(["initialize", "prepare", "enable", "close", "recoverClosed"])("valid %s event shape", transition => {
    const input = operatorPatch(["payload", "transition"], transition);
    if (transition !== "enable") input.payload = { ...input.payload, mode: "closed", approvalRef: null };
    if (transition === "initialize" || transition === "recoverClosed") input.payload = { ...input.payload, generation: 1, approvedBackendBuildId: null };
    expect(buildAuditEventWrite(input).record).toEqual(input);
  });
  it.each([
    [["actorUserId"], ""], [["actorUserId"], "other-principal"], [["actorRole"], "teacher"], [["actorRole"], "student"], [["actorRole"], "system"],
    [["actorRole"], "platformAdministrator"], [["actorRole"], "unknown"], [["action"], "teacherUnits.updated"],
    [["action"], "assignments.published"], [["action"], "unknown.action"], [["targetType"], "teacherUnit"],
    [["targetId"], "platformConfig/other"], [["correlationId"], null], [["correlationId"], "not-uuid"],
    [["schoolId"], undefined], [["schoolId"], "school-a"], [["districtId"], undefined], [["districtId"], "district-a"],
    [["occurredAt"], "client-time"], [["authenticated"], true], [["extra"], true],
    [["payload"], null], [["payload"], []], [["payload"], "text"], [["payload", "extra"], true],
    [["payload", "operator", "extra"], true], [["payload", "operator"], {}], [["payload", "operator", "credentialSubject"], null],
    [["payload", "operator", "principalSubject"], "other"], [["payload", "operator", "delegationSubject"], 1],
    [["payload", "policyInstanceId"], "00000000-0000-4000-8000-00000000000A"], [["payload", "placementFingerprint"], "bad"],
    [["payload", "approvedBackendBuildId"], "A".repeat(64)], [["payload", "approvedBackendBuildId"], null],
    [["payload", "generation"], 0], [["payload", "generation"], -1], [["payload", "generation"], -0],
    [["payload", "generation"], 1.5], [["payload", "generation"], Number.MAX_SAFE_INTEGER + 1],
    [["payload", "generation"], NaN], [["payload", "generation"], Infinity], [["payload", "generation"], "3"],
    [["payload", "transition"], "shutdown"], [["payload", "mode"], "closed"], [["payload", "approvalRef"], null],
    [["payload", "reason"], " padded "], [["payload", "reason"], ""], [["payload", "reason"], "line\nbreak"],
    [["payload", "approvalRef"], " padded "], [["payload", "approvalRef"], "a".repeat(257)],
    [["payload", "reason"], "a".repeat(1001)], [["payload", "operator", "credentialSubject"], "a".repeat(257)],
    [["payload", "operator", "principalSubject"], "\ud800"], [["payload", "operator", "delegationSubject"], "\u0000"],
    [["payload", "reason"], "control\u0085text"], [["payload", "operator", "credentialSubject"], "control\u009ftext"],
  ] as [string[], unknown][])("invalid operator tuple/payload %# refuses before transaction enlistment", (path, value) => {
    expectInvalidOperator(operatorPatch(path, value)); expect(mockDoc).not.toHaveBeenCalled();
  });
  it("every operator input, payload and nested attribution field is required", () => {
    for (const path of [[], ["payload"], ["payload", "operator"]]) {
      const source = operatorInput() as unknown as Record<string, any>; let target = source;
      for (const key of path) target = target[key];
      for (const key of Object.keys(target)) {
        const candidate = operatorInput() as unknown as Record<string, any>; let container = candidate;
        for (const p of path) container = container[p]; delete container[key];
        expectInvalidOperator(candidate as WriteAuditEventInput);
      }
    }
  });
  it.each(["initialize", "recoverClosed"])("%s cannot use an existing generation, enabled mode or prepared build", transition => {
    for (const patch of [{ generation: 2, mode: "closed", approvedBackendBuildId: null },
      { generation: 1, mode: "enabled" }, { generation: 1, mode: "closed", approvedBackendBuildId: "a".repeat(64) }]) {
      const input = operatorInput(); input.payload = { ...input.payload, transition, ...patch }; expectInvalidOperator(input);
    }
  });
  it.each(["prepare", "close"])("%s refuses enabled metadata and permits null build while closed", transition => {
    expectInvalidOperator(operatorPatch(["payload", "transition"], transition));
    const input = operatorInput(); input.payload = { ...input.payload, transition, mode: "closed", approvedBackendBuildId: null, approvalRef: null };
    expect(buildAuditEventWrite(input).record).toEqual(input);
  });
  it("MAX generation does not imply closure; generation CAS and verified shutdown remain B1e responsibilities", () => {
    const input = operatorPatch(["payload", "generation"], Number.MAX_SAFE_INTEGER);
    expect(buildAuditEventWrite(input).record.payload).toMatchObject({ mode: "enabled", generation: Number.MAX_SAFE_INTEGER });
  });
  it("rejects accessors, hidden fields, symbols, classes and cycles without accepting arbitrary payloads", () => {
    const input = operatorInput(); const getter = jest.fn(() => "principal:synthetic-owner");
    Object.defineProperty(input.payload, "operator", { enumerable: true, get: getter }); expectInvalidOperator(input); expect(getter).not.toHaveBeenCalled();
    const hidden = operatorInput(); Object.defineProperty(hidden.payload, "secret", { value: true }); expectInvalidOperator(hidden);
    const symbol = operatorInput(); (symbol.payload as Record<symbol, unknown>)[Symbol("secret")] = true; expectInvalidOperator(symbol);
    expectInvalidOperator(operatorPatch(["payload", "operator"], new Date()));
    const cycle = operatorInput(); cycle.payload = { ...cycle.payload, extra: cycle }; expectInvalidOperator(cycle);
  });
  it("bounded Unicode is counted in code points and delegation may be null", () => {
    const input = operatorInput(); const principal = "😀".repeat(256);
    input.actorUserId = principal; input.payload = { ...input.payload, reason: "😀".repeat(1000), approvalRef: "😀".repeat(256),
      operator: { principalSubject: principal, credentialSubject: "verified-credential-shape", delegationSubject: null } };
    expect(buildAuditEventWrite(input).record).toEqual(input);
  });
  it.each(["teacher", "student", "platformAdministrator"] as const)("%s still requires school context for existing actions", actorRole => {
    expect(() => buildAuditEventWrite({ ...validInput({ actorRole }), schoolId: undefined })).toThrow(PlatformError);
    expect(buildAuditEventWrite(validInput({ actorRole })).record.schoolId).toBe("school-123");
  });
});
