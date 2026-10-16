// A3-6 S2 artifact-pinned revocation list (decision record D5 R2). Synthetic references only.
import type { EnvironmentBinding } from "./a3-contracts";
import { PRODUCTION_REVOCATION_LIST, createRevocationList, isRevocationList, revocationStatus } from "./a3-revocation-list";

const STAGING: EnvironmentBinding = { environment: "staging", projectId: "lyfelabz-staging", projectNumber: "293337283840" };
const PRODUCTION: EnvironmentBinding = { environment: "production", projectId: "lyfelabz-prod", projectNumber: "182791689935" };
const EMULATOR: EnvironmentBinding = { environment: "emulator", projectId: "demo-a3-test", projectNumber: "0" };
const ref = (c: string): string => `teacherUnitsReleaseEvidence/${c.repeat(64)}`;
const entry = (r: string, identity: EnvironmentBinding = STAGING): Record<string, unknown> => ({ schemaVersion: 1, ...identity, revokedEvidenceRef: r });
const create = (entries: unknown, identity: unknown = STAGING) => createRevocationList(entries, identity);
const reason = (entries: unknown, identity: unknown = STAGING): string | undefined => { const r = create(entries, identity); return r.ok ? undefined : r.issue.reason; };

describe("production revocation list", () => {
  it("is empty, frozen and bound to the production identity", () => {
    expect(PRODUCTION_REVOCATION_LIST.entries).toEqual([]);
    expect(PRODUCTION_REVOCATION_LIST.identity).toEqual(PRODUCTION);
    expect(Object.isFrozen(PRODUCTION_REVOCATION_LIST)).toBe(true);
    expect(Object.isFrozen(PRODUCTION_REVOCATION_LIST.entries)).toBe(true);
    expect(Object.isFrozen(PRODUCTION_REVOCATION_LIST.identity)).toBe(true);
    expect(isRevocationList(PRODUCTION_REVOCATION_LIST)).toBe(true);
    expect(revocationStatus(PRODUCTION_REVOCATION_LIST, ref("a"), PRODUCTION)).toBe("notRevoked");
    expect(revocationStatus(PRODUCTION_REVOCATION_LIST, ref("a"), STAGING)).toBe("listUnrecognized");
  });
});

describe("construction", () => {
  it("accepts sorted, unique, environment-bound references and freezes a private copy", () => {
    const input = [entry(ref("1")), entry(ref("a"))];
    const result = create(input);
    if (!result.ok) throw new Error(result.issue.reason);
    expect(result).toMatchObject({ scope: "structure-only", operationalVerification: "unverified" });
    const list = result.value;
    expect(list.entries).toEqual(input);
    expect(list.entries).not.toBe(input);
    expect(list.entries[0]).not.toBe(input[0]);
    input[0].revokedEvidenceRef = ref("2");
    expect(list.entries[0].revokedEvidenceRef).toBe(ref("1"));
    for (const value of [list, list.entries, list.identity, ...list.entries]) expect(Object.isFrozen(value)).toBe(true);
    expect(revocationStatus(list, ref("a"), STAGING)).toBe("revoked");
    expect(revocationStatus(list, ref("b"), STAGING)).toBe("notRevoked");
  });

  it("refuses duplicate and unsorted entries", () => {
    expect(reason([entry(ref("a")), entry(ref("a"))])).toBe("canonical unique ordering required");
    expect(reason([entry(ref("b")), entry(ref("a"))])).toBe("canonical unique ordering required");
  });

  it("refuses cross-environment and cross-project entries", () => {
    expect(reason([entry(ref("a"), PRODUCTION)])).toBe("entry environment mismatch");
    expect(reason([entry(ref("a"), { ...STAGING, projectNumber: "182791689935" } as unknown as EnvironmentBinding)])).toBe("entry environment mismatch");
    expect(reason([entry(ref("a"), EMULATOR)])).toBe("entry environment mismatch");
    expect(reason([entry(ref("a"), { environment: "emulator", projectId: "demo-a3-other", projectNumber: "0" })], EMULATOR)).toBe("entry environment mismatch");
    expect(create([entry(ref("a"), EMULATOR)], EMULATOR).ok).toBe(true);
  });

  it("refuses an unpinned or untrusted list identity", () => {
    for (const identity of [{ ...STAGING, projectId: "lyfelabz-prod" }, { ...PRODUCTION, projectNumber: "1" },
      { environment: "emulator", projectId: "lyfelabz-prod", projectNumber: "0" }, { environment: "emulator", projectId: "demo-x", projectNumber: "1" },
      { ...STAGING, extra: true }, null, "staging"])
      expect(create([], identity).ok).toBe(false);
  });

  it("refuses malformed references", () => {
    for (const r of [`teacherUnitsBackendReleases/${"a".repeat(64)}`, `teacherUnitsAvailabilityHistory/${"a".repeat(64)}`,
      `teacherUnitsReleaseEvidence/${"A".repeat(64)}`, `teacherUnitsReleaseEvidence/${"a".repeat(63)}`,
      `teacherUnitsReleaseEvidence/${"a".repeat(64)}/x`, "teacherUnitsReleaseEvidence/latest", "", 7, null])
      expect(create([entry(r as string)]).ok).toBe(false);
  });

  it("refuses unexpected, missing and wrongly typed fields", () => {
    expect(create([{ ...entry(ref("a")), reason: "compromised" }]).ok).toBe(false);
    for (const key of Object.keys(entry(ref("a")))) {
      const e = entry(ref("a")); delete e[key]; expect(create([e]).ok).toBe(false);
    }
    expect(create([{ ...entry(ref("a")), schemaVersion: 2 }]).ok).toBe(false);
    expect(create([{ ...entry(ref("a")), schemaVersion: "1" }]).ok).toBe(false);
    for (const input of [null, undefined, {}, "x", [null], [[]]]) expect(create(input).ok).toBe(false);
  });

  it("reads input once and refuses accessors without invoking them", () => {
    let reads = 0;
    const e = entry(ref("a"));
    Object.defineProperty(e, "revokedEvidenceRef", { enumerable: true, get: () => { reads += 1; return ref("a"); } });
    expect(create([e]).ok).toBe(false);
    const identity = { ...STAGING };
    Object.defineProperty(identity, "environment", { enumerable: true, get: () => { reads += 1; return "staging"; } });
    expect(create([], identity).ok).toBe(false);
    expect(reads).toBe(0);
  });
});

describe("lookup", () => {
  it("recognizes only lists produced by createRevocationList, for the same identity", () => {
    const forged = Object.freeze({ identity: STAGING, entries: Object.freeze([entry(ref("a"))]) });
    expect(isRevocationList(forged)).toBe(false);
    expect(revocationStatus(forged, ref("a"), STAGING)).toBe("listUnrecognized");
    expect(revocationStatus(null, ref("a"), STAGING)).toBe("listUnrecognized");
    const result = create([entry(ref("a"))]);
    if (!result.ok) throw new Error(result.issue.reason);
    expect(revocationStatus(result.value, ref("a"), PRODUCTION)).toBe("listUnrecognized");
    expect(revocationStatus(result.value, ref("a"), { ...STAGING, projectNumber: "1" })).toBe("listUnrecognized");
  });
});

describe("lookup fails closed on the query (F1)", () => {
  const list = (() => { const r = create([entry(ref("a"))]); if (!r.ok) throw new Error(r.issue.reason); return r.value; })();

  it("valid references: present is revoked, absent is notRevoked", () => {
    expect(revocationStatus(list, ref("a"), STAGING)).toBe("revoked");
    expect(revocationStatus(list, ref("b"), STAGING)).toBe("notRevoked");
    expect(revocationStatus(PRODUCTION_REVOCATION_LIST, ref("a"), PRODUCTION)).toBe("notRevoked");
    // An ExpectedEnvironment with a local profile compares by identity only.
    const emulator = create([entry(ref("a"), EMULATOR)], EMULATOR);
    if (!emulator.ok) throw new Error(emulator.issue.reason);
    expect(revocationStatus(emulator.value, ref("a"), { ...EMULATOR, localProfile: { fingerprint: "f".repeat(64),
      authOrigin: "http://127.0.0.1:9099", firestoreHost: "127.0.0.1:8080", functionsOrigin: "http://127.0.0.1:5001" } })).toBe("revoked");
  });

  it.each([
    ["empty", ""], ["uppercase digest", ref("A")], ["short digest", `teacherUnitsReleaseEvidence/${"a".repeat(63)}`],
    ["long digest", `teacherUnitsReleaseEvidence/${"a".repeat(65)}`], ["nested path", `${ref("a")}/child`],
    ["leading slash", `/${ref("a")}`], ["padded", ` ${ref("a")}`], ["trailing newline", `${ref("a")}\n`],
    ["bare digest", "a".repeat(64)], ["alias", "teacherUnitsReleaseEvidence/latest"],
    ["release collection", `teacherUnitsBackendReleases/${"a".repeat(64)}`],
    ["history collection", `teacherUnitsAvailabilityHistory/${"a".repeat(64)}`],
    ["policy path", "platformConfig/teacherUnitsAvailability"], ["URL", `https://example.test/${ref("a")}`],
    ["lone surrogate", `${ref("a")}\ud800`],
  ])("a malformed %s reference is inputMismatch, never notRevoked", (_label, query) => {
    expect(revocationStatus(list, query, STAGING)).toBe("inputMismatch");
    expect(revocationStatus(PRODUCTION_REVOCATION_LIST, query, PRODUCTION)).toBe("inputMismatch");
  });

  it.each([["null", null], ["undefined", undefined], ["number", 7], ["boolean", true], ["object", { ref: ref("a") }],
    ["array", [ref("a")]], ["boxed string", Object(ref("a"))], ["symbol", Symbol("ref")], ["bigint", 1n]])(
    "a non-string %s query is inputMismatch", (_label, query) => {
      expect(revocationStatus(list, query, STAGING)).toBe("inputMismatch");
    });

  it("accessor-based queries and identities are refused without invoking getters", () => {
    let reads = 0;
    const query = {}; Object.defineProperty(query, "toString", { enumerable: true, get: () => { reads += 1; return () => ref("a"); } });
    expect(revocationStatus(list, query, STAGING)).toBe("inputMismatch");
    const identity = { ...STAGING }; Object.defineProperty(identity, "projectId", { enumerable: true, get: () => { reads += 1; return STAGING.projectId; } });
    expect(revocationStatus(list, ref("a"), identity)).toBe("inputMismatch");
    expect(reads).toBe(0);
  });

  it("a malformed expected identity is inputMismatch; another identity is listUnrecognized", () => {
    for (const identity of [null, undefined, "staging", {}, { environment: "staging", projectId: "lyfelabz-staging" },
      { ...STAGING, projectNumber: 293337283840 }, { ...STAGING, environment: "test" }])
      expect(revocationStatus(list, ref("a"), identity)).toBe("inputMismatch");
    expect(revocationStatus(list, ref("a"), PRODUCTION)).toBe("listUnrecognized");
    expect(revocationStatus(list, ref("a"), { ...STAGING, projectNumber: "1" })).toBe("listUnrecognized");
  });

  it("a reference revoked in another environment's list does not leak across lists", () => {
    expect(revocationStatus(PRODUCTION_REVOCATION_LIST, ref("a"), PRODUCTION)).toBe("notRevoked");
    expect(revocationStatus(list, ref("a"), PRODUCTION)).toBe("listUnrecognized");
  });
});
