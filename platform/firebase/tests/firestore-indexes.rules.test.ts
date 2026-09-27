/**
 * Firestore index / TTL configuration contract for `firestore.indexes.json`.
 *
 * Production has TTL policies that must never be removed by a
 * `firebase deploy --only firestore:indexes`:
 *   - `lmsOAuthStates.expiresAt` (existing, created out of band), and
 *   - `launchGrants.expiresAt` (required before differentiated-delivery
 *     activation; F5.2 §3.6/§7.2 storage cleanup).
 *
 * firebase-tools treats every production field override that is not declared
 * in this file as a deletion candidate, and "deleting" an override clears its
 * `ttlConfig`. This suite runs the repository's own firebase-tools index
 * deploy decision logic offline (network client stubbed to record, never
 * execute) against production-shaped state, so a change to this file that
 * would drop either TTL fails CI. No emulator or network access is used.
 */

import { execFileSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

const SPEC_PATH = path.join(__dirname, "..", "firestore.indexes.json");
const PROJECT = "lyfelabz-prod";
const DEFAULT_TRIO = [
  { order: "ASCENDING", queryScope: "COLLECTION" },
  { order: "DESCENDING", queryScope: "COLLECTION" },
  { arrayConfig: "CONTAINS", queryScope: "COLLECTION" },
];

type Spec = {
  indexes: unknown[];
  fieldOverrides: Array<{ collectionGroup: string; fieldPath: string; ttl?: boolean; indexes: unknown[] }>;
};

function readSpec(): Spec {
  return JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
}

// Production-shaped field override as returned by the Firestore Admin API.
function ttlField(collectionGroup: string) {
  const idx = (mode: Record<string, string>) => ({
    queryScope: "COLLECTION",
    fields: [{ fieldPath: "expiresAt", ...mode }],
    state: "READY",
  });
  return {
    name: `projects/${PROJECT}/databases/(default)/collectionGroups/${collectionGroup}/fields/expiresAt`,
    indexConfig: {
      indexes: [idx({ order: "ASCENDING" }), idx({ order: "DESCENDING" }), idx({ arrayConfig: "CONTAINS" })],
      usesAncestorConfig: true,
    },
    ttlConfig: { state: "ACTIVE" },
  };
}

const RECIPIENTS_FIELD = {
  name: `projects/${PROJECT}/databases/(default)/collectionGroups/recipients/fields/studentId`,
  indexConfig: {
    indexes: [
      { queryScope: "COLLECTION_GROUP", fields: [{ fieldPath: "studentId", order: "ASCENDING" }], state: "READY" },
    ],
  },
};

// Runs the repository's firebase-tools deploy decision logic in plain Node
// (see tests/support/indexes-deploy-sim.cjs); returns the recorded calls.
function simulateDeploy(existingFields: unknown[], force: boolean): { valid: boolean; calls: string[] } {
  const out = execFileSync(
    process.execPath,
    [
      path.join(__dirname, "support", "indexes-deploy-sim.cjs"),
      JSON.stringify({ specPath: SPEC_PATH, project: PROJECT, force, existingFields }),
    ],
    { cwd: path.join(__dirname, ".."), encoding: "utf8" },
  );
  return JSON.parse(out);
}

describe("firestore.indexes.json TTL declarations", () => {
  test("parses and validates under the repository's firebase-tools", () => {
    expect(simulateDeploy([ttlField("lmsOAuthStates"), ttlField("launchGrants"), RECIPIENTS_FIELD], false).valid).toBe(true);
  });

  test.each(["lmsOAuthStates", "launchGrants"])("declares the %s.expiresAt TTL override", (collectionGroup) => {
    const override = readSpec().fieldOverrides.find(
      (f) => f.collectionGroup === collectionGroup && f.fieldPath === "expiresAt",
    );
    expect(override).toBeDefined();
    expect(override?.ttl).toBe(true);
    expect(override?.indexes).toEqual(DEFAULT_TRIO);
  });

  test("keeps the recipients.studentId collection-group override", () => {
    const override = readSpec().fieldOverrides.find(
      (f) => f.collectionGroup === "recipients" && f.fieldPath === "studentId",
    );
    expect(override?.indexes).toEqual([{ order: "ASCENDING", queryScope: "COLLECTION_GROUP" }]);
  });

  test("once both TTLs exist in production, an indexes deploy (even --force) is a no-op", () => {
    const existing = [ttlField("lmsOAuthStates"), ttlField("launchGrants"), RECIPIENTS_FIELD];
    expect(simulateDeploy(existing, false).calls).toEqual([]);
    expect(simulateDeploy(existing, true).calls).toEqual([]);
  });

  test("before launchGrants TTL exists, a deploy only creates it and never touches lmsOAuthStates", () => {
    const existing = [ttlField("lmsOAuthStates"), RECIPIENTS_FIELD];
    for (const force of [false, true]) {
      const { calls } = simulateDeploy(existing, force);
      expect(calls).toEqual([
        `PATCH /projects/${PROJECT}/databases/(default)/collectionGroups/launchGrants/fields/expiresAt`,
      ]);
    }
  });
});
