import { createHash } from "node:crypto";

import type * as C from "./a3-contracts";
import { RUNTIME_PLACEMENT_FINGERPRINT } from "./a3-enforcement";
import type { RuntimeIdentity } from "./a3-runtime-identity";
import {
  STAGING_UX_TEST_EVIDENCE_REF,
  STAGING_UX_TEST_RELEASE_ID,
  isStagingUxTestPolicy,
  stagingUxTestEligible,
} from "./a3-staging-ux-test";
import { stubIdentity } from "./a3-test-support.test";

const STAGING = { environment: "staging", projectId: "lyfelabz-staging", projectNumber: "293337283840" } as const;
const identity = stubIdentity(STAGING);
const policy = {
  ...STAGING, schemaVersion: 1, policyInstanceId: "123e4567-e89b-42d3-a456-426614174000", region: "us-central1",
  databaseId: "(default)", mode: "enabled", generation: 1, backendReleaseEligibility: { releaseId: STAGING_UX_TEST_RELEASE_ID },
  acceptedClientContractVersions: ["teacher-units-v2"], placementFingerprint: RUNTIME_PLACEMENT_FINGERPRINT,
  activationEvidenceRef: STAGING_UX_TEST_EVIDENCE_REF, updatedAt: { seconds: 1, nanoseconds: 0 },
} as unknown as C.TeacherUnitsAvailabilityPolicyV1;
const eligible = (i: Partial<RuntimeIdentity>, p: Partial<Record<string, unknown>> = {}) =>
  stagingUxTestEligible({ ...identity, ...i } as RuntimeIdentity, { ...policy, ...p },
    RUNTIME_PLACEMENT_FINGERPRINT);

test("markers are stable published digests", () => {
  const digest = (label: string) => createHash("sha256").update(`lyfelabz.teacherUnits.stagingUxTest.v1:${label}`).digest("hex");
  expect(STAGING_UX_TEST_RELEASE_ID).toBe(digest("release"));
  expect(STAGING_UX_TEST_EVIDENCE_REF).toBe(`teacherUnitsReleaseEvidence/${digest("evidence")}`);
  expect(STAGING_UX_TEST_RELEASE_ID).toMatch(/^[a-f0-9]{64}$/);
  expect(STAGING_UX_TEST_EVIDENCE_REF).toMatch(/^teacherUnitsReleaseEvidence\/[a-f0-9]{64}$/);
});

test("eligible only for the exact staging cloud identity and an enabled staging marker policy", () => {
  expect(isStagingUxTestPolicy(policy)).toBe(true);
  expect(eligible({})).toBe(true);
  const refusals: [Partial<RuntimeIdentity>, Partial<Record<string, unknown>>][] = [
    [{ environment: "production", projectId: "lyfelabz-prod", projectNumber: "182791689935" } as never, {}],
    [{ projectNumber: "182791689935" } as never, {}],
    [{ projectId: "lyfelabz-prod" }, {}],
    [{ environment: "emulator" } as never, {}],
    [{ source: "explicit-local-profile" }, {}],
    [{ region: "europe-west1" } as never, {}],
    [{ databaseId: "other" } as never, {}],
    [{}, { mode: "closed" }],
    [{}, { environment: "production" }],
    [{}, { projectNumber: "0" }],
    [{}, { placementFingerprint: "e".repeat(64) }],
    [{}, { activationEvidenceRef: `teacherUnitsReleaseEvidence/${"d".repeat(64)}` }],
    [{}, { backendReleaseEligibility: { releaseId: "a".repeat(64) } }],
    [{}, { backendReleaseEligibility: null }],
  ];
  for (const [i, p] of refusals) expect([i, p, eligible(i, p)]).toEqual([i, p, false]);
});

test("a throwing accessor fails closed", () => {
  const hostile = new Proxy({}, { get() { throw new Error("hostile"); } }) as RuntimeIdentity;
  expect(stagingUxTestEligible(hostile, policy, RUNTIME_PLACEMENT_FINGERPRINT)).toBe(false);
});
