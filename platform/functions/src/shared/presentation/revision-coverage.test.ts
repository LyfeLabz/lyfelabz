// F5.3 Slice 9C-1 - the shared revision-aware coverage evaluator, and proof
// that launch resolution (Op C) and begin classify coverage identically
// through it (addendum 21.6 to 21.9; S9-D1, S9-D2, S9-U1).
//
// Everything here is in memory: the pure evaluator reads a fake store, and the
// real pure launch resolver and begin cores are driven through ports that call
// the same evaluator. Every r2 is synthetic except the final suite, which uses
// the real retained Earth's Layers r2 presentation. No Firestore, no writes.

import * as fs from "fs";
import * as path from "path";

import { PlatformError } from "../errors/platform-error";
import {
  evaluateLegacyRecord,
  evaluateScopedRecord,
  frozenRevisionOrdinal,
  readRevisionCoverage,
  usableFrozenAssessmentRevisionId,
  type CoverageDocRead,
  type RevisionCoverageReads,
} from "./revision-coverage";
import { revisionCoverageReads } from "./revision-coverage-deps";
import {
  createLaunchPresentationResolver,
  type LaunchPresentationTelemetryEvent,
  type MintGrantInput,
} from "./resolve-launch-presentation";
import { checkAssessmentPresentationDoc } from "./assessment-presentation-identity";
import {
  resolveBeginDelivery,
  type BeginDeliveryTelemetryEvent,
  type RawLaunchGrant,
} from "../../assessments/resolve-begin-delivery";

const SLUG = "earths-layers";
const KEY = "reading-adapted";
const R1 = `assessment_${SLUG}__r1`;
const R2 = `assessment_${SLUG}__r2`;
const PR90F = "pr90f52136d39f36d21bf1602d0af3901adf0eae32a046c522907c5e932f342189";
const PRFF01 = "prff01d9d2cf71210c491afc60cf98cd3d69b91d5c64cae51aff2463b50892375c";
const AP1FED = "ap1fed478c9e4ad8335946ff7f7b165df657bafc48e8c5990d922419581fa02c25";
const PR_OTHER = `pr${"c".repeat(64)}`;
const AP_OTHER = `ap${"d".repeat(64)}`;

function indexDoc(presentationRevisionId: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lessonSlug: SLUG,
    variantKey: KEY,
    currentPresentationRevisionId: presentationRevisionId,
    currentPath: `app/lessons/variants/lesson_${SLUG}__${presentationRevisionId}.html`,
    contentSha256: presentationRevisionId.slice(2),
    status: "active",
    updatedAt: {},
    publishedBy: "fixture",
    ...extra,
  };
}
// Staging C7 legacy document: pr90f... bound to ap1fed... for r1.
const LEGACY_BOUND_R1 = indexDoc(PR90F, { assessmentRevisionId: R1, assessmentPresentationRevisionId: AP1FED });
// Production C6 legacy document: prff01... unbound (no recorded revision).
const LEGACY_UNBOUND = indexDoc(PRFF01);
const scoped = (rev: string, extra: Record<string, unknown> = {}) => indexDoc(PR_OTHER, { assessmentRevisionId: rev, ...extra });

// In-memory store keyed by document id, with read accounting.
function store(docs: Record<string, unknown>, fail: string | null = null) {
  const readsLog: string[] = [];
  const read = (id: string): Promise<CoverageDocRead> => {
    readsLog.push(id);
    if (fail !== null && id === fail) return Promise.reject(new Error("unavailable"));
    return Promise.resolve(Object.prototype.hasOwnProperty.call(docs, id) ? { exists: true, data: docs[id] } : { exists: false });
  };
  const reads: RevisionCoverageReads = {
    readScoped: (s, k, n) => read(`${s}__${k}__r${String(n)}`),
    readLegacy: (s, k) => read(`${s}__${k}`),
  };
  return { reads, readsLog };
}
const LEGACY_ID = `${SLUG}__${KEY}`;
const SCOPED_R1_ID = `${SLUG}__${KEY}__r1`;
const SCOPED_R2_ID = `${SLUG}__${KEY}__r2`;

describe("frozen revision grammar", () => {
  it("accepts only canonical revisions of this lesson", () => {
    expect(frozenRevisionOrdinal(SLUG, R1)).toBe(1);
    expect(frozenRevisionOrdinal(SLUG, `assessment_${SLUG}__r12`)).toBe(12);
    for (const bad of [undefined, null, 1, "", `assessment_${SLUG}__r0`, `assessment_${SLUG}__r01`, `assessment_${SLUG}__r`, "assessment_water-cycle__r1", `assessment_${SLUG}-x__r1`, `${R1} `]) {
      expect(frozenRevisionOrdinal(SLUG, bad)).toBeUndefined();
      expect(usableFrozenAssessmentRevisionId(SLUG, bad)).toBeUndefined();
    }
    expect(usableFrozenAssessmentRevisionId(SLUG, R2)).toBe(R2);
  });
});

describe("shared evaluator: scoped records", () => {
  it("valid scoped r1 coverage covers r1 and the legacy record is never read", async () => {
    const s = store({ [SCOPED_R1_ID]: scoped(R1), [LEGACY_ID]: LEGACY_BOUND_R1 });
    const res = await readRevisionCoverage(s.reads, { lessonSlug: SLUG, variantKey: KEY, assessmentRevisionId: R1 });
    expect(res).toMatchObject({ kind: "active", source: "scoped", presentationRevisionId: PR_OTHER });
    expect(s.readsLog).toEqual([SCOPED_R1_ID]);
  });

  it("scoped r1 coverage never satisfies r2 (and r2 never satisfies r1)", async () => {
    const onlyR1 = store({ [SCOPED_R1_ID]: scoped(R1) });
    expect(await readRevisionCoverage(onlyR1.reads, { lessonSlug: SLUG, variantKey: KEY, assessmentRevisionId: R2 })).toEqual({ kind: "absent" });
    expect(onlyR1.readsLog).toEqual([SCOPED_R2_ID, LEGACY_ID]);
    const onlyR2 = store({ [SCOPED_R2_ID]: scoped(R2) });
    expect(await readRevisionCoverage(onlyR2.reads, { lessonSlug: SLUG, variantKey: KEY, assessmentRevisionId: R1 })).toEqual({ kind: "absent" });
  });

  it("valid scoped coverage for a synthetic r2 covers r2, bound or unbound", async () => {
    const bound = scoped(R2, { assessmentPresentationRevisionId: AP_OTHER });
    for (const doc of [scoped(R2), bound]) {
      const s = store({ [SCOPED_R2_ID]: doc, [LEGACY_ID]: LEGACY_BOUND_R1 });
      const res = await readRevisionCoverage(s.reads, { lessonSlug: SLUG, variantKey: KEY, assessmentRevisionId: R2 });
      expect(res).toMatchObject({ kind: "active", source: "scoped" });
    }
    const res = await readRevisionCoverage(store({ [SCOPED_R2_ID]: bound }).reads, { lessonSlug: SLUG, variantKey: KEY, assessmentRevisionId: R2 });
    expect(res).toMatchObject({ assessmentBinding: { assessmentRevisionId: R2, assessmentPresentationRevisionId: AP_OTHER } });
  });

  it.each([
    ["naming another revision", scoped(R1)],
    ["with no recorded revision", indexDoc(PR_OTHER)],
    ["for another lesson", scoped(R2, { lessonSlug: "water-cycle" })],
    ["for another variant key", scoped(R2, { variantKey: "reading-other" })],
    ["with a tampered path", scoped(R2, { currentPath: "app/lessons/variants/x.html" })],
    ["with a hash that disagrees with its id", scoped(R2, { contentSha256: "e".repeat(64) })],
    ["with a malformed AP id", scoped(R2, { assessmentPresentationRevisionId: "ap123" })],
    ["with an unknown status", scoped(R2, { status: "paused" })],
    ["that is not an object", "garbage"],
  ])("a scoped record %s is malformed and never falls through to legacy", async (_label, doc) => {
    const s = store({ [SCOPED_R2_ID]: doc, [LEGACY_ID]: indexDoc(PR_OTHER, { assessmentRevisionId: R2, assessmentPresentationRevisionId: AP_OTHER }) });
    expect(await readRevisionCoverage(s.reads, { lessonSlug: SLUG, variantKey: KEY, assessmentRevisionId: R2 })).toEqual({ kind: "malformed" });
    expect(s.readsLog).toEqual([SCOPED_R2_ID]);
  });

  it("a retired scoped record decides alone (no fall-through to active legacy coverage)", async () => {
    const s = store({ [SCOPED_R1_ID]: scoped(R1, { status: "retired" }), [LEGACY_ID]: LEGACY_BOUND_R1 });
    expect(await readRevisionCoverage(s.reads, { lessonSlug: SLUG, variantKey: KEY, assessmentRevisionId: R1 })).toEqual({ kind: "retired" });
    expect(s.readsLog).toEqual([SCOPED_R1_ID]);
  });
});

describe("shared evaluator: legacy records (scoped absent)", () => {
  it("staging C7 legacy bound pr90f.../ap1fed... covers r1 only", async () => {
    const s = store({ [LEGACY_ID]: LEGACY_BOUND_R1 });
    expect(await readRevisionCoverage(s.reads, { lessonSlug: SLUG, variantKey: KEY, assessmentRevisionId: R1 })).toEqual({
      kind: "active",
      source: "legacyBound",
      variantKey: KEY,
      presentationRevisionId: PR90F,
      path: `app/lessons/variants/lesson_${SLUG}__${PR90F}.html`,
      assessmentBinding: { assessmentRevisionId: R1, assessmentPresentationRevisionId: AP1FED },
    });
    expect(await readRevisionCoverage(s.reads, { lessonSlug: SLUG, variantKey: KEY, assessmentRevisionId: R2 })).toEqual({ kind: "assessmentMismatch" });
  });

  it("historical unbound prff01... covers r1 only, through the legacy-r1 rule", async () => {
    const s = store({ [LEGACY_ID]: LEGACY_UNBOUND });
    const r1 = await readRevisionCoverage(s.reads, { lessonSlug: SLUG, variantKey: KEY, assessmentRevisionId: R1 });
    expect(r1).toMatchObject({ kind: "active", source: "legacyUnboundR1", presentationRevisionId: PRFF01 });
    expect(r1).not.toHaveProperty("assessmentBinding");
    for (const rev of [R2, `assessment_${SLUG}__r3`]) {
      expect(await readRevisionCoverage(s.reads, { lessonSlug: SLUG, variantKey: KEY, assessmentRevisionId: rev })).toEqual({ kind: "assessmentMismatch" });
    }
  });

  it("no usable frozen revision is never guessed: no scoped read, legacy coverage never honored", async () => {
    for (const rev of [undefined, "assessment_water-cycle__r1", `assessment_${SLUG}__r01`]) {
      for (const doc of [LEGACY_BOUND_R1, LEGACY_UNBOUND]) {
        const s = store({ [LEGACY_ID]: doc, [SCOPED_R1_ID]: scoped(R1) });
        const input = { lessonSlug: SLUG, variantKey: KEY, ...(rev !== undefined ? { assessmentRevisionId: rev } : {}) };
        expect(await readRevisionCoverage(s.reads, input)).toEqual({ kind: "assessmentMismatch" });
        expect(s.readsLog).toEqual([LEGACY_ID]);
      }
      expect(await readRevisionCoverage(store({}).reads, { lessonSlug: SLUG, variantKey: KEY, ...(rev !== undefined ? { assessmentRevisionId: rev } : {}) })).toEqual({ kind: "absent" });
    }
  });

  it("keeps the pre-Slice-9 absent / retired / malformed classification", () => {
    expect(evaluateLegacyRecord({ ...LEGACY_UNBOUND, status: "retired", currentPath: "x" }, SLUG, KEY, R1)).toEqual({ kind: "retired" });
    expect(evaluateLegacyRecord({ ...LEGACY_UNBOUND, status: "weird" }, SLUG, KEY, R1)).toEqual({ kind: "malformed" });
    expect(evaluateLegacyRecord({ ...LEGACY_UNBOUND, lessonSlug: "other" }, SLUG, KEY, R1)).toEqual({ kind: "malformed" });
    expect(evaluateLegacyRecord(indexDoc(PR90F, { assessmentPresentationRevisionId: AP1FED }), SLUG, KEY, R1)).toEqual({ kind: "malformed" });
    expect(evaluateLegacyRecord(indexDoc(PR90F, { assessmentRevisionId: "assessment_water-cycle__r1", assessmentPresentationRevisionId: AP1FED }), SLUG, KEY, R1)).toEqual({ kind: "malformed" });
    expect(evaluateLegacyRecord(undefined, SLUG, KEY, R1)).toEqual({ kind: "malformed" });
    expect(evaluateScopedRecord(undefined, SLUG, KEY, R1)).toEqual({ kind: "malformed" });
  });

  it("a slug or key outside the variant charset is a coverage gap with no read", async () => {
    const s = store({});
    expect(await readRevisionCoverage(s.reads, { lessonSlug: "lesson_g7_earths-layers", variantKey: KEY, assessmentRevisionId: "assessment_lesson_g7_earths-layers__r1" })).toEqual({ kind: "absent" });
    expect(await readRevisionCoverage(s.reads, { lessonSlug: SLUG, variantKey: "reading__x", assessmentRevisionId: R1 })).toEqual({ kind: "absent" });
    expect(s.readsLog).toEqual([]);
  });

  it("an unavailable read propagates (callers apply their fail-safe direction)", async () => {
    await expect(readRevisionCoverage(store({}, SCOPED_R1_ID).reads, { lessonSlug: SLUG, variantKey: KEY, assessmentRevisionId: R1 })).rejects.toThrow("unavailable");
    await expect(readRevisionCoverage(store({}, LEGACY_ID).reads, { lessonSlug: SLUG, variantKey: KEY, assessmentRevisionId: R1 })).rejects.toThrow("unavailable");
  });

  it("the Firestore wiring reads the scoped id first, then the legacy id", async () => {
    const calls: string[] = [];
    const ref = (id: string, doc: unknown) => ({
      get: () => { calls.push(id); return Promise.resolve({ exists: doc !== undefined, data: () => doc }) as never; },
    });
    const reads = revisionCoverageReads({
      scopedRef: (s, k, n) => ref(`${s}__${k}__r${String(n)}`, undefined),
      legacyRef: (s, k) => ref(`${s}__${k}`, LEGACY_BOUND_R1),
    });
    const res = await readRevisionCoverage(reads, { lessonSlug: SLUG, variantKey: KEY, assessmentRevisionId: R1 });
    expect(res.kind).toBe("active");
    expect(calls).toEqual([SCOPED_R1_ID, LEGACY_ID]);
  });
});

// ---------------------------------------------------------------------------
// Launch and begin through the SAME evaluator
// ---------------------------------------------------------------------------

const STUDENT = "student-uid";
const ASSIGNMENT = "assign-1";
const GRANT_ID = "0123456789abcdef0123456789abcdef";
const AP1FED_RECORD: unknown = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "assessment-presentations", `${AP1FED}.json`), "utf8"),
);

function harness(docs: Record<string, unknown>, opts: { enabled?: boolean; fail?: string | null; apRecords?: Record<string, unknown> } = {}) {
  const s = store(docs, opts.fail ?? null);
  const minted: MintGrantInput[] = [];
  const launchEvents: LaunchPresentationTelemetryEvent[] = [];
  const beginEvents: BeginDeliveryTelemetryEvent[] = [];
  const launch = createLaunchPresentationResolver({
    readReading: () => Promise.resolve({ active: true, level: "adapted", configRevision: 1 }),
    isDeliveryEnabled: () => Promise.resolve(opts.enabled ?? true),
    readVariantIndex: (lessonSlug, variantKey, assessmentRevisionId) =>
      readRevisionCoverage(s.reads, { lessonSlug, variantKey, ...(assessmentRevisionId !== undefined ? { assessmentRevisionId } : {}) }),
    mintGrant: (input) => { minted.push(input); return Promise.resolve(GRANT_ID); },
    telemetry: (e) => launchEvents.push(e),
    variantKeyForReadingLevel: (level) => `reading-${level}`,
  });
  let grant: RawLaunchGrant | undefined;
  const beginPorts = {
    readGrant: () => Promise.resolve(grant),
    readAccommodation: () => Promise.resolve({ active: true as const, level: "adapted" as const }),
    isDeliveryEnabled: () => Promise.resolve(opts.enabled ?? true),
    readCoverage: async (lessonSlug: string, variantKey: string, assessmentRevisionId: string) =>
      (await readRevisionCoverage(s.reads, { lessonSlug, variantKey, assessmentRevisionId })).kind,
    variantKeyForReadingLevel: (level: string) => `reading-${level}`,
    isValidGrantId: (v: unknown) => typeof v === "string" && /^[0-9a-f]{32}$/.test(v),
    telemetry: (e: BeginDeliveryTelemetryEvent) => beginEvents.push(e),
    nowMs: () => 1_000,
    verifyAssessmentPresentation: (apId: string, expected: { lessonSlug: string; assessmentRevisionId: string }) => {
      const records = opts.apRecords ?? { [AP1FED]: AP1FED_RECORD };
      const check = checkAssessmentPresentationDoc(apId, records[apId], expected);
      return Promise.resolve(check.ok ? null : check.reason);
    },
  };
  return {
    readsLog: s.readsLog,
    minted,
    launchEvents,
    beginEvents,
    resolve: (assessmentRevisionId?: string) =>
      launch.resolve({ studentId: STUDENT, assignmentId: ASSIGNMENT, lessonSlug: SLUG, ...(assessmentRevisionId !== undefined ? { assessmentRevisionId } : {}) }),
    begin: (assessmentRevisionId: string, launchRef?: string) =>
      resolveBeginDelivery(beginPorts, { studentId: STUDENT, assignmentId: ASSIGNMENT, lessonSlug: SLUG, assessmentRevisionId, ...(launchRef !== undefined ? { launchRef } : {}) }),
    useGrantFrom: (input: MintGrantInput) => {
      grant = { ...input, expiresAt: { toMillis: () => 9_999_999 } };
    },
  };
}

async function beginCode(p: Promise<unknown>): Promise<string> {
  try {
    const r = await p;
    return `ok:${(r as { deliveryOutcome: string }).deliveryOutcome}`;
  } catch (err) {
    return err instanceof PlatformError ? `refused:${err.code}` : "threw";
  }
}

describe("launch resolution through the shared evaluator", () => {
  it("operational disable wins before any coverage read", async () => {
    const h = harness({ [LEGACY_ID]: LEGACY_BOUND_R1 }, { enabled: false });
    expect(await h.resolve(R1)).toMatchObject({ kind: "canonicalFallback", reason: "operationalDisable" });
    expect(await h.begin(R1)).toEqual({ deliveryOutcome: "canonicalFallback" });
    expect(h.readsLog).toEqual([]);
  });

  it("an r1 assignment on staging C7 coverage resolves differentiated with ap1fed... provenance", async () => {
    const h = harness({ [LEGACY_ID]: LEGACY_BOUND_R1 });
    expect(await h.resolve(R1)).toMatchObject({ kind: "differentiated", presentation: { presentationRevisionId: PR90F } });
    expect(h.minted[0]).toMatchObject({ outcomeAtIssuance: "differentiated", presentationRevisionId: PR90F, assessmentPresentationRevisionId: AP1FED, accommodationConfigRevision: 1 });
  });

  it("a synthetic r2 assignment on the same r1 coverage is a truthful canonicalFallback", async () => {
    const h = harness({ [LEGACY_ID]: LEGACY_BOUND_R1 });
    expect(await h.resolve(R2)).toMatchObject({ kind: "canonicalFallback", reason: "coverageAssessmentMismatch" });
    expect(h.minted).toEqual([{ outcomeAtIssuance: "canonicalFallback", studentId: STUDENT, assignmentId: ASSIGNMENT, lessonSlug: SLUG }]);
    expect(h.launchEvents.map((e) => e.type)).toEqual(["coverageAssessmentMismatch"]);
  });

  it("historical prff01... serves an r1 assignment (unbound grant) and never r2", async () => {
    const h = harness({ [LEGACY_ID]: LEGACY_UNBOUND });
    expect(await h.resolve(R1)).toMatchObject({ kind: "differentiated", presentation: { presentationRevisionId: PRFF01 } });
    expect(h.minted[0]).not.toHaveProperty("assessmentPresentationRevisionId");
    expect(await h.resolve(R2)).toMatchObject({ kind: "canonicalFallback", reason: "coverageAssessmentMismatch" });
  });

  it("scoped r2 coverage resolves an r2 assignment while r1 keeps its legacy coverage", async () => {
    const h = harness({ [LEGACY_ID]: LEGACY_BOUND_R1, [SCOPED_R2_ID]: scoped(R2) });
    expect(await h.resolve(R2)).toMatchObject({ kind: "differentiated", presentation: { presentationRevisionId: PR_OTHER } });
    expect(await h.resolve(R1)).toMatchObject({ kind: "differentiated", presentation: { presentationRevisionId: PR90F } });
  });

  it("malformed scoped coverage keeps the certified row-5 result (fallback grant + anomaly), never legacy", async () => {
    const h = harness({ [LEGACY_ID]: LEGACY_BOUND_R1, [SCOPED_R1_ID]: scoped(R2) });
    expect(await h.resolve(R1)).toMatchObject({ kind: "canonicalFallback", reason: "coverageMalformed" });
  });

  it("an unavailable coverage read degrades launch to canonical with no grant", async () => {
    const h = harness({}, { fail: SCOPED_R1_ID });
    expect(await h.resolve(R1)).toEqual({ kind: "internalFailure" });
    expect(h.minted).toEqual([]);
  });
});

describe("begin through the shared evaluator", () => {
  it("no-ref begin with coverage for the frozen revision still requires a launch (P1)", async () => {
    expect(await beginCode(harness({ [LEGACY_ID]: LEGACY_BOUND_R1 }).begin(R1))).toBe("refused:BEGIN_REQUIRES_LAUNCH");
    expect(await beginCode(harness({ [SCOPED_R2_ID]: scoped(R2) }).begin(R2))).toBe("refused:BEGIN_REQUIRES_LAUNCH");
  });

  it("no-ref begin with coverage only for another revision is a truthful canonicalFallback (S9-U1)", async () => {
    for (const doc of [LEGACY_BOUND_R1, LEGACY_UNBOUND]) {
      const h = harness({ [LEGACY_ID]: doc });
      expect(await h.begin(R2)).toEqual({ deliveryOutcome: "canonicalFallback" });
      expect(h.beginEvents).toEqual([
        { type: "noRefFallback", studentId: STUDENT, assignmentId: ASSIGNMENT, lessonSlug: SLUG, variantKey: KEY, reason: "coverageAssessmentMismatch" },
      ]);
    }
  });

  it("no-ref begin: retired scoped coverage is canonicalFallback; malformed or unavailable refuses", async () => {
    expect(await beginCode(harness({ [SCOPED_R1_ID]: scoped(R1, { status: "retired" }), [LEGACY_ID]: LEGACY_BOUND_R1 }).begin(R1))).toBe("ok:canonicalFallback");
    expect(await beginCode(harness({ [SCOPED_R1_ID]: scoped(R2), [LEGACY_ID]: LEGACY_BOUND_R1 }).begin(R1))).toBe("refused:BEGIN_VALIDATION_UNAVAILABLE");
    expect(await beginCode(harness({}, { fail: LEGACY_ID }).begin(R1))).toBe("refused:BEGIN_VALIDATION_UNAVAILABLE");
  });

  it("a launchRef differentiated r1 grant (pr90f.../ap1fed...) begins differentiated for r1", async () => {
    const h = harness({ [LEGACY_ID]: LEGACY_BOUND_R1 });
    await h.resolve(R1);
    h.useGrantFrom(h.minted[0]);
    expect(await h.begin(R1, GRANT_ID)).toEqual({
      deliveryOutcome: "differentiated",
      variantKey: KEY,
      presentationRevisionId: PR90F,
      assessmentPresentationRevisionId: AP1FED,
      accommodationConfigRevision: 1,
    });
  });

  it("the ap1fed... grant is refused for an r2 session, and a missing, altered, or foreign AP record is refused", async () => {
    const h = harness({ [LEGACY_ID]: LEGACY_BOUND_R1 });
    await h.resolve(R1);
    h.useGrantFrom(h.minted[0]);
    expect(await beginCode(h.begin(R2, GRANT_ID))).toBe("refused:LAUNCH_REF_INVALID");
    const altered = { ...(AP1FED_RECORD as Record<string, unknown>), lessonSlug: "water-cycle" };
    for (const records of [{}, { [AP1FED]: altered }]) {
      const g = harness({ [LEGACY_ID]: LEGACY_BOUND_R1 }, { apRecords: records });
      await g.resolve(R1);
      g.useGrantFrom(g.minted[0]);
      expect(await beginCode(g.begin(R1, GRANT_ID))).toBe("refused:LAUNCH_REF_INVALID");
    }
    expect(checkAssessmentPresentationDoc(AP1FED, AP1FED_RECORD, { lessonSlug: "water-cycle", assessmentRevisionId: R1 })).toEqual({ ok: false, reason: "lessonMismatch" });
    expect(checkAssessmentPresentationDoc(AP1FED, AP1FED_RECORD, { lessonSlug: SLUG, assessmentRevisionId: R2 })).toEqual({ ok: false, reason: "assessmentRevisionMismatch" });
  });

  it("a canonicalFallback grant from an r2 mismatch launch begins canonicalFallback", async () => {
    const h = harness({ [LEGACY_ID]: LEGACY_BOUND_R1 });
    await h.resolve(R2);
    h.useGrantFrom(h.minted[0]);
    expect(await h.begin(R2, GRANT_ID)).toEqual({ deliveryOutcome: "canonicalFallback" });
  });
});

describe("launch and no-ref begin always agree (one evaluator)", () => {
  const stores: Array<[string, Record<string, unknown>]> = [
    ["no coverage", {}],
    ["legacy bound r1 (C7)", { [LEGACY_ID]: LEGACY_BOUND_R1 }],
    ["legacy unbound (C6)", { [LEGACY_ID]: LEGACY_UNBOUND }],
    ["legacy retired", { [LEGACY_ID]: { ...LEGACY_UNBOUND, status: "retired" } }],
    ["scoped r2 + legacy r1", { [LEGACY_ID]: LEGACY_BOUND_R1, [SCOPED_R2_ID]: scoped(R2) }],
    ["scoped r1 retired + legacy r1", { [LEGACY_ID]: LEGACY_BOUND_R1, [SCOPED_R1_ID]: scoped(R1, { status: "retired" }) }],
    ["scoped r1 malformed", { [SCOPED_R1_ID]: scoped(R2) }],
  ];
  const expected: Record<string, string> = {
    differentiated: "refused:BEGIN_REQUIRES_LAUNCH",
    "canonicalFallback:coverageAbsent": "ok:canonicalFallback",
    "canonicalFallback:coverageRetired": "ok:canonicalFallback",
    "canonicalFallback:coverageAssessmentMismatch": "ok:canonicalFallback",
    "canonicalFallback:coverageMalformed": "refused:BEGIN_VALIDATION_UNAVAILABLE",
  };
  it.each(stores.flatMap(([label, docs]) => [R1, R2].map((rev) => [label, rev, docs] as const)))(
    "%s, frozen %s",
    async (_label, rev, docs) => {
      const launch = await harness(docs).resolve(rev);
      const key = launch.kind === "canonicalFallback" ? `${launch.kind}:${launch.reason}` : launch.kind;
      expect(Object.keys(expected)).toContain(key);
      expect(await beginCode(harness(docs).begin(rev))).toBe(expected[key]);
    },
  );
});

// Earth's Layers r2 (2026-09-28): the REAL retained r2 presentation pr6b7c...
// bound to the owner-certified ap515838... can later be published as scoped r2
// coverage beside the certified r1 coverage (C8 scoped pr90f.../ap1fed...,
// plus the staging legacy record) without changing any r1 resolution.
describe("real Earth's Layers r2 coverage beside r1 (pr6b7c... + ap515838...)", () => {
  const PR6B7C = "pr6b7c74fe84fb20a9b05d4b2d6e006c21ed2bc02d58dcfbefc925dbd4c400e948";
  const AP5158 = "ap51583824375c58be36627f047f280510b0cde98e9aba2fbec7ef058ad2fc4903";
  const AP5158_RECORD: unknown = JSON.parse(
    fs.readFileSync(path.join(__dirname, "..", "..", "scripts", "assessment-presentations", `${AP5158}.json`), "utf8"),
  );
  const SCOPED_R1 = indexDoc(PR90F, { assessmentRevisionId: R1, assessmentPresentationRevisionId: AP1FED });
  const SCOPED_R2 = indexDoc(PR6B7C, { assessmentRevisionId: R2, assessmentPresentationRevisionId: AP5158 });
  const records = { [AP1FED]: AP1FED_RECORD, [AP5158]: AP5158_RECORD };
  const withoutR2 = { [LEGACY_ID]: LEGACY_BOUND_R1, [SCOPED_R1_ID]: SCOPED_R1 };
  const withR2 = { ...withoutR2, [SCOPED_R2_ID]: SCOPED_R2 };

  it("the retained r2 record verifies for r2 only", () => {
    expect(checkAssessmentPresentationDoc(AP5158, AP5158_RECORD, { lessonSlug: SLUG, assessmentRevisionId: R2 })).toMatchObject({ ok: true });
    expect(checkAssessmentPresentationDoc(AP5158, AP5158_RECORD, { lessonSlug: SLUG, assessmentRevisionId: R1 })).toEqual({ ok: false, reason: "assessmentRevisionMismatch" });
  });

  it("scoped r2 coverage resolves an r2 assignment to pr6b7c.../ap515838... and begins differentiated for r2", async () => {
    const h = harness(withR2, { apRecords: records });
    expect(await h.resolve(R2)).toMatchObject({ kind: "differentiated", presentation: { presentationRevisionId: PR6B7C } });
    expect(h.minted[0]).toMatchObject({ outcomeAtIssuance: "differentiated", presentationRevisionId: PR6B7C, assessmentPresentationRevisionId: AP5158 });
    h.useGrantFrom(h.minted[0]);
    expect(await h.begin(R2, GRANT_ID)).toEqual({
      deliveryOutcome: "differentiated",
      variantKey: KEY,
      presentationRevisionId: PR6B7C,
      assessmentPresentationRevisionId: AP5158,
      accommodationConfigRevision: 1,
    });
  });

  it("adding scoped r2 coverage leaves r1 resolution byte-for-byte unchanged", async () => {
    const before = harness(withoutR2, { apRecords: records });
    const after = harness(withR2, { apRecords: records });
    expect(await after.resolve(R1)).toEqual(await before.resolve(R1));
    expect(after.minted).toEqual(before.minted);
    expect(after.minted[0]).toMatchObject({ presentationRevisionId: PR90F, assessmentPresentationRevisionId: AP1FED });
    expect(after.readsLog).toEqual([SCOPED_R1_ID]);
  });

  it("the r2 grant is refused for an r1 session, and the r1 grant for an r2 session", async () => {
    const r2 = harness(withR2, { apRecords: records });
    await r2.resolve(R2);
    r2.useGrantFrom(r2.minted[0]);
    expect(await beginCode(r2.begin(R1, GRANT_ID))).toBe("refused:LAUNCH_REF_INVALID");
    const r1 = harness(withR2, { apRecords: records });
    await r1.resolve(R1);
    r1.useGrantFrom(r1.minted[0]);
    expect(await beginCode(r1.begin(R2, GRANT_ID))).toBe("refused:LAUNCH_REF_INVALID");
  });

  it("before r2 coverage is published, an r2 assignment is a truthful canonicalFallback; an unknown r3 never resolves", async () => {
    const h = harness(withoutR2, { apRecords: records });
    expect(await h.resolve(R2)).toMatchObject({ kind: "canonicalFallback", reason: "coverageAssessmentMismatch" });
    expect(h.minted).toEqual([{ outcomeAtIssuance: "canonicalFallback", studentId: STUDENT, assignmentId: ASSIGNMENT, lessonSlug: SLUG }]);
    const r3 = harness(withR2, { apRecords: records });
    expect(await r3.resolve(`assessment_${SLUG}__r3`)).toMatchObject({ kind: "canonicalFallback" });
    expect(r3.minted[0]).not.toHaveProperty("presentationRevisionId");
  });
});
