import { createHash } from "crypto";

import {
  buildAssignmentCompletionBinding,
  canonicalCompletionDefinitionJson,
  computeCompletionDefinitionHash,
  parseAssignmentCompletionBinding,
  prepareCompletionDefinitionRecord,
  verifyCompletionDefinitionRecord,
  verifyFrozenCompletionBinding,
} from "./completion-definition-record";
import type { CompletionDefinition } from "./completion-definition";
import { GRAVITY_WELLS_COMPLETION_DEFINITION, GRAVITY_WELLS_RESOURCE_ID } from "./gravity-wells-completion-definition";

// RA-3B frozen completion-definition identity: canonicalization, hashing,
// stored-record verification, and assignment binding verification. Pure.

const GW = GRAVITY_WELLS_RESOURCE_ID;
const GW_R1 = `assessment_${GW}__r1`;
const GW_R2 = `assessment_${GW}__r2`;
const GW_EXPECTED = { resourceId: GW, resourceType: "simulation" as const };

// A small, self-contained definition whose hash is pinned below. It is
// independent of the Gravity Wells DRAFT constant, so the pin guards the
// canonicalization and hashing procedure itself: if this hash changes,
// every stored definition hash would stop reproducing.
const PINNED: CompletionDefinition = {
  schemaVersion: 1,
  resourceId: "investigation-protein-pathway",
  resourceType: "investigation",
  assessmentRevisionId: "assessment_investigation-protein-pathway__r3",
  definitionVersion: 3,
  stages: [
    { stageId: "observe", required: true, requirement: { kind: "evidence", evidenceId: "notes" } },
  ],
  evidence: [
    { evidenceId: "notes", stageId: "observe", kind: "text", purpose: "observation", prompt: "What did you notice?" },
  ],
  outcomes: [],
  attestations: [],
};
const PINNED_HASH = "aab6a48ed2d6420f1180ff0a884ead9a515d696f4b2aef4d086d07f52fadd901";

function prepare(def: unknown, revisionId = GW_R1, publishedBy = "unit-test") {
  const d = def as CompletionDefinition;
  return prepareCompletionDefinitionRecord(def, {
    resourceId: d.resourceId,
    resourceType: d.resourceType,
    assessmentRevisionId: revisionId,
    publishedBy,
  });
}

function record(def: CompletionDefinition = GRAVITY_WELLS_COMPLETION_DEFINITION): Record<string, unknown> {
  const p = prepare(def, def.assessmentRevisionId);
  if (!p.ok) throw new Error(p.issue);
  return { ...p.write, publishedAt: { seconds: 1, nanoseconds: 0 } };
}

// Rewrites a record's content and recomputes every derived field, as a
// writer with direct database access could. Used to prove which layer
// catches which change.
function rehashed(base: Record<string, unknown>, mutate: (d: Record<string, unknown>) => void): Record<string, unknown> {
  const content = JSON.parse(base.definitionJson as string) as Record<string, unknown>;
  mutate(content);
  const keys = Object.keys(content).sort();
  const json = `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJsonOf(content[k])}`).join(",")}}`;
  return { ...base, definitionJson: json, definitionHash: computeCompletionDefinitionHash(json) };
}
function canonicalJsonOf(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJsonOf).join(",")}]`;
  if (v !== null && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${canonicalJsonOf(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

describe("canonicalization and hashing", () => {
  it("pins the canonical hash of a fixed definition (historical reproducibility)", () => {
    const p = prepare(PINNED, PINNED.assessmentRevisionId);
    expect(p.ok && p.write.definitionHash).toBe(PINNED_HASH);
  });

  it("hashes exactly the stored canonical JSON with SHA-256", () => {
    const r = record();
    expect(r.definitionHash).toBe(createHash("sha256").update(r.definitionJson as string, "utf8").digest("hex"));
    expect(r.definitionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is independent of authored key order at every level", () => {
    const reorder = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(reorder);
      if (v !== null && typeof v === "object") {
        return Object.fromEntries(Object.entries(v as Record<string, unknown>).reverse().map(([k, x]) => [k, reorder(x)]));
      }
      return v;
    };
    const a = prepare(GRAVITY_WELLS_COMPLETION_DEFINITION);
    const b = prepare(reorder(GRAVITY_WELLS_COMPLETION_DEFINITION));
    expect(a.ok && b.ok && a.write.definitionHash === b.write.definitionHash).toBe(true);
  });

  it("stores sorted-key JSON that round-trips to the normalized definition", () => {
    const r = record();
    const json = r.definitionJson as string;
    expect(json).toBe(canonicalCompletionDefinitionJson(JSON.parse(json) as CompletionDefinition));
    expect(json.startsWith('{"assessmentRevisionId":')).toBe(true);
  });

  it("changes the hash when any requirement changes", () => {
    const changed = { ...GRAVITY_WELLS_COMPLETION_DEFINITION, evidence: [{ ...GRAVITY_WELLS_COMPLETION_DEFINITION.evidence[0], prompt: "Explain orbits." }] };
    expect(record(changed).definitionHash).not.toBe(record().definitionHash);
  });

  it("records the distinct validators, sorted", () => {
    expect(record().validators).toEqual([{ validatorId: "gravity-wells.orbit", validatorVersion: 1 }]);
    expect(record(PINNED).validators).toEqual([]);
  });
});

describe("deployment-side record preparation", () => {
  it.each([
    ["definitionVersion differs from the revision ordinal", { ...GRAVITY_WELLS_COMPLETION_DEFINITION, definitionVersion: 2 }, GW_R1, "versionMismatch"],
    ["the definition names another revision", GRAVITY_WELLS_COMPLETION_DEFINITION, GW_R2, "revisionMismatch"],
    ["the revision belongs to another assessment", GRAVITY_WELLS_COMPLETION_DEFINITION, "assessment_simulation-eclipse-alignment__r1", "revisionMismatch"],
    ["the revision id is not canonical", GRAVITY_WELLS_COMPLETION_DEFINITION, `assessment_${GW}`, "revisionMismatch"],
    ["an unregistered validator", { ...GRAVITY_WELLS_COMPLETION_DEFINITION, outcomes: GRAVITY_WELLS_COMPLETION_DEFINITION.outcomes.map((o) => ({ ...o, validatorId: "gravity-wells.orbit-x" })) }, GW_R1, "unregisteredValidator"],
    ["an unsupported schema", { ...GRAVITY_WELLS_COMPLETION_DEFINITION, schemaVersion: 2 }, GW_R1, "unsupportedDefinitionSchema"],
    ["a non-NFC string", { ...GRAVITY_WELLS_COMPLETION_DEFINITION, evidence: [{ ...GRAVITY_WELLS_COMPLETION_DEFINITION.evidence[0], prompt: "Café" }] }, GW_R1, "invalidDefinition"],
    ["an extra field", { ...GRAVITY_WELLS_COMPLETION_DEFINITION, note: "x" }, GW_R1, "invalidDefinition"],
  ])("refuses when %s", (_label, def, revisionId, issue) => {
    const p = prepare(def, revisionId);
    expect(p.ok).toBe(false);
    expect(!p.ok && p.issue).toBe(issue);
  });

  it("refuses a resource whose identifier does not belong to its type", () => {
    const p = prepareCompletionDefinitionRecord(GRAVITY_WELLS_COMPLETION_DEFINITION, {
      resourceId: GW,
      resourceType: "investigation",
      assessmentRevisionId: GW_R1,
      publishedBy: "x",
    });
    expect(!p.ok && p.issue).toBe("resourceMismatch");
  });
});

describe("stored record verification (fail closed)", () => {
  const verify = (raw: unknown, revisionId = GW_R1, expected = GW_EXPECTED) =>
    verifyCompletionDefinitionRecord(revisionId, raw, expected);
  const issueOf = (raw: unknown, revisionId = GW_R1, expected = GW_EXPECTED) => {
    const v = verify(raw, revisionId, expected);
    return v.ok ? "ok" : v.issue;
  };

  it("accepts the record deployment wrote", () => {
    const v = verify(record());
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.definition).toEqual(GRAVITY_WELLS_COMPLETION_DEFINITION);
      expect(v.definitionHash).toBe(record().definitionHash);
    }
  });

  it.each([
    ["absent (deleted)", undefined, "missing"],
    ["null", null, "missing"],
    ["an array", [], "malformed"],
    ["missing a field", (() => { const r = record(); delete r.validators; return r; })(), "malformed"],
    ["carrying an extra field", { ...record(), latest: true }, "malformed"],
    ["an unsupported record schema", { ...record(), recordSchemaVersion: 2 }, "unsupportedRecordSchema"],
    ["a malformed hash", { ...record(), definitionHash: "abc" }, "malformed"],
    ["missing its publication timestamp (null)", { ...record(), publishedAt: null }, "malformed"],
    ["carrying a non-timestamp publishedAt", { ...record(), publishedAt: "2026-10-09" }, "malformed"],
    ["carrying a fractional timestamp", { ...record(), publishedAt: { seconds: 1.5, nanoseconds: 0 } }, "malformed"],
    ["a hash that does not match its content", { ...record(), definitionHash: "0".repeat(64) }, "hashMismatch"],
    ["content edited without rehashing", { ...record(), definitionJson: (record().definitionJson as string).replace("sideways", "upward") }, "hashMismatch"],
  ])("refuses a record that is %s", (_label, raw, issue) => {
    expect(issueOf(raw)).toBe(issue);
  });

  it("refuses unparseable or non-canonical content even when the hash matches", () => {
    const broken = "{not json";
    expect(issueOf({ ...record(), definitionJson: broken, definitionHash: computeCompletionDefinitionHash(broken) })).toBe("corrupt");
    const spaced = JSON.stringify(JSON.parse(record().definitionJson as string), null, 2);
    expect(issueOf({ ...record(), definitionJson: spaced, definitionHash: computeCompletionDefinitionHash(spaced) })).toBe("corrupt");
  });

  it("re-validates rehashed content: unsupported schema and unregistered validators fail closed", () => {
    expect(issueOf(rehashed(record(), (d) => { d.schemaVersion = 2; }))).toBe("unsupportedDefinitionSchema");
    expect(
      issueOf(rehashed(record(), (d) => {
        d.outcomes = (d.outcomes as Array<Record<string, unknown>>).map((o) => ({ ...o, validatorVersion: 9 }));
      })),
    ).toBe("unregisteredValidator");
  });

  it("refuses identity disagreements", () => {
    expect(issueOf(record(), GW_R2)).toBe("revisionMismatch");
    expect(issueOf(record(), GW_R1, { resourceId: GW, resourceType: "investigation" as never })).toBe("resourceMismatch");
    expect(issueOf(record(), GW_R1, { resourceId: "simulation-eclipse-alignment", resourceType: "simulation" })).toBe("revisionMismatch");
    expect(issueOf({ ...record(), resourceId: "simulation-eclipse-alignment" })).toBe("identityMismatch");
    expect(issueOf({ ...record(), assessmentRevisionId: GW_R2 })).toBe("identityMismatch");
    expect(issueOf({ ...record(), revisionOrdinal: 2 })).toBe("identityMismatch");
    expect(issueOf({ ...record(), definitionVersion: 2 })).toBe("identityMismatch");
    expect(issueOf({ ...record(), publishedBy: "" })).toBe("identityMismatch");
    expect(issueOf({ ...record(), validators: [] })).toBe("validatorMismatch");
    expect(issueOf({ ...record(), validators: [{ validatorId: "gravity-wells.orbit", validatorVersion: 2 }] })).toBe("validatorMismatch");
  });

  it("refuses rehashed content whose version is not its revision ordinal", () => {
    expect(issueOf(rehashed(record(), (d) => { d.definitionVersion = 2; }))).toBe("versionMismatch");
  });
});

describe("assignment completion binding", () => {
  const occurrence = { assignmentId: "asg-1", classId: "class-1" };
  function verified(def: CompletionDefinition = GRAVITY_WELLS_COMPLETION_DEFINITION) {
    const v = verifyCompletionDefinitionRecord(def.assessmentRevisionId, record(def), {
      resourceId: def.resourceId,
      resourceType: def.resourceType,
    });
    if (!v.ok) throw new Error(v.issue);
    return v;
  }
  const binding = () => buildAssignmentCompletionBinding(occurrence, verified());
  const check = (overrides: Record<string, unknown> = {}, raw: unknown = record()) => {
    const v = verifyFrozenCompletionBinding({
      assignmentId: "asg-1",
      classId: "class-1",
      resourceId: GW,
      resourceType: "simulation",
      assessmentRevisionId: GW_R1,
      binding: { ...binding(), ...overrides },
      record: raw,
      ...(overrides.__input as object | undefined),
    });
    return v.ok ? "ok" : v.issue;
  };

  it("builds a binding carrying identity, hash, schema, version, and validators", () => {
    expect(binding()).toEqual({
      bindingSchemaVersion: 1,
      assignmentId: "asg-1",
      classId: "class-1",
      resourceId: GW,
      resourceType: "simulation",
      assessmentRevisionId: GW_R1,
      definitionSchemaVersion: 1,
      definitionVersion: 1,
      definitionHash: record().definitionHash,
      validators: [{ validatorId: "gravity-wells.orbit", validatorVersion: 1 }],
    });
  });

  it("parses a stored binding strictly", () => {
    expect(parseAssignmentCompletionBinding(binding())).toEqual({ ok: true, binding: binding() });
    const issue = (raw: unknown) => {
      const p = parseAssignmentCompletionBinding(raw);
      return p.ok ? "ok" : p.issue;
    };
    expect(issue(undefined)).toBe("bindingMissing");
    expect(issue(null)).toBe("bindingMissing");
    expect(issue("x")).toBe("bindingMalformed");
    expect(issue({ ...binding(), bindingSchemaVersion: 2 })).toBe("bindingUnsupportedSchema");
    expect(issue({ ...binding(), extra: 1 })).toBe("bindingMalformed");
    const missing: Record<string, unknown> = { ...binding() };
    delete missing.classId;
    expect(issue(missing)).toBe("bindingMalformed");
    expect(issue({ ...binding(), definitionHash: "ABC" })).toBe("bindingMalformed");
    expect(issue({ ...binding(), definitionVersion: 0 })).toBe("bindingMalformed");
    expect(issue({ ...binding(), validators: [{ validatorId: "v" }] })).toBe("bindingMalformed");
  });

  it("verifies a binding against its occurrence and record", () => {
    expect(check()).toBe("ok");
  });

  it.each([
    ["another assignment occurrence", { assignmentId: "asg-2" }, "bindingAssignmentMismatch"],
    ["another class", { classId: "class-2" }, "bindingAssignmentMismatch"],
    ["another resource", { resourceId: "simulation-eclipse-alignment" }, "bindingResourceMismatch"],
    ["another type", { resourceType: "investigation" }, "bindingResourceMismatch"],
    ["another assessment revision", { assessmentRevisionId: GW_R2 }, "bindingRevisionMismatch"],
    ["a substituted hash", { definitionHash: "f".repeat(64) }, "bindingHashMismatch"],
    ["another definition version", { definitionVersion: 2 }, "bindingVersionMismatch"],
    ["another schema version", { definitionSchemaVersion: 2 }, "bindingVersionMismatch"],
    ["another validator set", { validators: [] }, "bindingValidatorMismatch"],
  ])("refuses a binding naming %s", (_label, overrides, issue) => {
    expect(check(overrides)).toBe(issue);
  });

  it("refuses when the frozen definition is missing, corrupted, or rewritten", () => {
    expect(check({}, null)).toBe("missing");
    expect(check({}, { ...record(), definitionHash: "0".repeat(64) })).toBe("hashMismatch");
    // A record rewritten and rehashed in place verifies as a record, but no
    // longer matches the hash frozen on the assignment.
    const rewritten = rehashed(record(), (d) => {
      d.evidence = [{ ...(d.evidence as Array<Record<string, unknown>>)[0], prompt: "Explain orbits." }];
    });
    expect(verifyCompletionDefinitionRecord(GW_R1, rewritten, GW_EXPECTED).ok).toBe(true);
    expect(check({}, rewritten)).toBe("bindingHashMismatch");
  });

  it("keeps a historical binding valid after a newer revision is deployed, and never substitutes it", () => {
    const r2Definition = {
      ...GRAVITY_WELLS_COMPLETION_DEFINITION,
      assessmentRevisionId: GW_R2,
      definitionVersion: 2,
      evidence: [{ ...GRAVITY_WELLS_COMPLETION_DEFINITION.evidence[0], prompt: "Explain orbits with evidence." }],
    };
    const r2Record = record(r2Definition);
    // The r1 occurrence still verifies against its own r1 record.
    expect(check()).toBe("ok");
    // Handing it the newer r2 record is refused, not accepted as "latest".
    expect(check({}, r2Record)).toBe("revisionMismatch");
    // An r2 occurrence binds to r2 and cannot read r1.
    const r2Binding = buildAssignmentCompletionBinding(occurrence, verified(r2Definition));
    expect(r2Binding.definitionHash).not.toBe(binding().definitionHash);
    expect(
      verifyFrozenCompletionBinding({
        assignmentId: "asg-1",
        classId: "class-1",
        resourceId: GW,
        resourceType: "simulation",
        assessmentRevisionId: GW_R2,
        binding: r2Binding,
        record: record(),
      }),
    ).toEqual({ ok: false, issue: "revisionMismatch" });
  });
});
