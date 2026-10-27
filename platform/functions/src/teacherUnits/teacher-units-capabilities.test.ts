// A3-3 schema 3 discovery request parsing (approved decision record, Decision 1).
// Transactional discovery behavior, availability declarations and production
// wiring are covered in teacher-units.test.ts against the hermetic Firestore
// stand-in. The A2 schema 1 / teacher-units-v1 protocol is retired: legacy
// requests are refused and no schema 1 response exists.
import { createHash } from "node:crypto";

import { PlatformError } from "../shared";
import * as capabilities from "./teacher-units-capabilities";
import { RUNTIME_PLACEMENT_FINGERPRINT } from "./a3-enforcement";
import { UNIT_PLACEABLE_RESOURCE_ID_LIST } from "./unit-placeable-resources";

const { TEACHER_UNITS_OPERATIONS, readCapabilityRequest } = capabilities;
const valid = { schemaVersion: 3, nonce: "0123456789abcdef", clientContractVersion: "teacher-units-v3" };

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(PlatformError);
    return (err as PlatformError).code;
  }
  return "accepted";
}

test("accepts exactly the schema 3 / teacher-units-v3 request", () => {
  expect(readCapabilityRequest({ ...valid })).toEqual(valid);
});

test.each([
  ["exact A2 v1 request", { schemaVersion: 1, nonce: valid.nonce, clientContractVersion: "teacher-units-v1" }],
  ["schema 3 with v1 contract", { ...valid, clientContractVersion: "teacher-units-v1" }],
  ["schema 1 with v2 contract", { ...valid, schemaVersion: 1 }],
  ["unknown contract", { ...valid, clientContractVersion: "v2" }],
  ["schema 3", { ...valid, schemaVersion: 2 }],
])("refuses %s as contractUnsupported", (_label, data) => {
  expect(codeOf(() => readCapabilityRequest(data))).toBe("teacherUnits.contractUnsupported");
});

test.each([
  ["null", null],
  ["array", []],
  ["string", "schema 3"],
  ["empty object", {}],
  ["unknown field", { ...valid, projectId: "lyfelabz-prod" }],
  ["missing nonce", { schemaVersion: 3, clientContractVersion: "teacher-units-v3" }],
  ["short nonce", { ...valid, nonce: "short" }],
  ["nonce with spaces", { ...valid, nonce: "0123456789 abcdef" }],
])("refuses %s as invalidRequest", (_label, data) => {
  expect(codeOf(() => readCapabilityRequest(data))).toBe("teacherUnits.invalidRequest");
});

test("retires the A2 identity helper and keeps the canonical operation order", () => {
  expect("capabilityRuntimeIdentity" in capabilities).toBe(false);
  expect(TEACHER_UNITS_OPERATIONS).toEqual(["create", "list", "get", "update", "archive", "restore", "setResources", "reorder"]);
});

test("placement fingerprint keeps the existing ordered resourceIds digest bytes", () => {
  expect(RUNTIME_PLACEMENT_FINGERPRINT).toBe(
    createHash("sha256").update(JSON.stringify(UNIT_PLACEABLE_RESOURCE_ID_LIST), "utf8").digest("hex"),
  );
});
