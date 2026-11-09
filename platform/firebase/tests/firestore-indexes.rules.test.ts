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

type CompositeSpec = {
  collectionGroup: string;
  queryScope: string;
  fields: Array<{ fieldPath: string; order?: string; arrayConfig?: string }>;
};

// The composite indexes declared in the spec (Student Support V2.1 adds five).
// Pinned by count so an unreviewed addition or removal fails this suite.
const EXPECTED_COMPOSITE_COUNT = 5;

function compositeName(collectionGroup: string, n: number) {
  return `projects/${PROJECT}/databases/(default)/collectionGroups/${collectionGroup}/indexes/CICAgI${n}`;
}

// Production-shaped composite index as returned by the Firestore Admin API
// (READY, with the server-appended `__name__` suffix field).
function remoteComposite(spec: CompositeSpec, n: number) {
  const lastOrder = [...spec.fields].reverse().find((f) => f.order)?.order ?? "ASCENDING";
  return {
    name: compositeName(spec.collectionGroup, n),
    state: "READY",
    queryScope: spec.queryScope,
    fields: [...spec.fields, { fieldPath: "__name__", order: lastOrder }],
  };
}

function specComposites(): CompositeSpec[] {
  return readSpec().indexes as CompositeSpec[];
}

function deployedComposites() {
  return specComposites().map((spec, n) => remoteComposite(spec, n));
}

function createCall(collectionGroup: string) {
  return `POST /projects/${PROJECT}/databases/(default)/collectionGroups/${collectionGroup}/indexes`;
}

// Runs the repository's firebase-tools deploy decision logic in plain Node
// (see tests/support/indexes-deploy-sim.cjs); returns the recorded calls.
function simulateDeploy(
  existingFields: unknown[],
  force: boolean,
  existingIndexes: unknown[] = deployedComposites(),
): { valid: boolean; calls: string[] } {
  const out = execFileSync(
    process.execPath,
    [
      path.join(__dirname, "support", "indexes-deploy-sim.cjs"),
      JSON.stringify({ specPath: SPEC_PATH, project: PROJECT, force, existingFields, existingIndexes }),
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

describe("firestore.indexes.json composite indexes", () => {
  const FIELDS = [ttlField("lmsOAuthStates"), ttlField("launchGrants"), RECIPIENTS_FIELD];

  test("declares exactly the reviewed composite indexes", () => {
    expect(specComposites()).toHaveLength(EXPECTED_COMPOSITE_COUNT);
  });

  test("when none are deployed, a deploy only creates each composite and never touches TTL overrides", () => {
    const expected = specComposites().map((s) => createCall(s.collectionGroup)).sort();
    for (const force of [false, true]) {
      const { calls } = simulateDeploy(FIELDS, force, []);
      expect([...calls].sort()).toEqual(expected);
      expect(calls.filter((c) => !c.startsWith("POST "))).toEqual([]);
    }
  });

  test("when one composite is missing, a deploy creates only that one", () => {
    const deployed = deployedComposites();
    const [missing] = deployed.splice(2, 1);
    const group = missing.name.split("/")[5];
    for (const force of [false, true]) {
      expect(simulateDeploy(FIELDS, force, deployed).calls).toEqual([createCall(group)]);
    }
  });

  // Without --force, firebase-tools refuses the whole non-interactive deploy
  // (before any create/delete) when a deployed composite is undeclared.
  const REFUSES_WITHOUT_FORCE = /Pass the --force flag/;

  test("an undeclared deployed composite refuses the deploy, and is deleted only under --force", () => {
    const stray = {
      name: compositeName("supportRemovalJobs", 99),
      state: "READY",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "attemptedAt", order: "ASCENDING" },
        { fieldPath: "__name__", order: "ASCENDING" },
      ],
    };
    const existing = [...deployedComposites(), stray];
    expect(() => simulateDeploy(FIELDS, false, existing)).toThrow(REFUSES_WITHOUT_FORCE);
    expect(simulateDeploy(FIELDS, true, existing).calls).toEqual([`DELETE /${stray.name}`]);
  });

  test("a deployed composite with a changed definition is never silently matched", () => {
    const deployed = deployedComposites();
    const changed = { ...deployed[0], fields: [...deployed[0].fields] };
    // Reverse the declared field order (excluding the __name__ suffix).
    const declared = changed.fields.slice(0, -1).reverse();
    changed.fields = [...declared, changed.fields[changed.fields.length - 1]];
    deployed[0] = changed;
    const group = changed.name.split("/")[5];
    expect(() => simulateDeploy(FIELDS, false, deployed)).toThrow(REFUSES_WITHOUT_FORCE);
    expect(simulateDeploy(FIELDS, true, deployed).calls).toEqual([createCall(group), `DELETE /${changed.name}`]);
  });
});
