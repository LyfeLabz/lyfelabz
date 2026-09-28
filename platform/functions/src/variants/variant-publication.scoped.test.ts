import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

import {
  isDeployedRevisionRecord,
  planScopedCoverageWrite,
  publishRetainedRevision,
  retireVariant,
  scopedCoverageFor,
  verifyReadBackAgreement,
  type PublishDeps,
  type RetainedRevision,
  type ScopedCoverageRecord,
  type WriteScopedCoveragePort,
} from "./variant-publication";
import { assertScopedActivateWriteConsistent } from "../shared/types/presentation-variant";
import {
  readRevisionCoverage,
  type CoverageDocRead,
} from "../shared/presentation/revision-coverage";
import { makeLoadRetainedRevision } from "../scripts/publish-variant";

// F5.3 Slice 9C-2 - revision-scoped coverage publication. Pure machine with
// in-memory ports (no Hosting, no Firestore); every r2 is synthetic. The
// store below is also read back through the REAL 9C-1 evaluator, so the
// records the publisher writes are exactly the records launch and begin read.

const LESSON = "earths-layers";
const VARIANT = "reading-adapted";
const R1 = `assessment_${LESSON}__r1`;
const R2 = `assessment_${LESSON}__r2`;
const PR90F = "pr90f52136d39f36d21bf1602d0af3901adf0eae32a046c522907c5e932f342189";
const PRFF01 = "prff01d9d2cf71210c491afc60cf98cd3d69b91d5c64cae51aff2463b50892375c";
const AP1FED = "ap1fed478c9e4ad8335946ff7f7b165df657bafc48e8c5990d922419581fa02c25";
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const LEGACY_ID = `${LESSON}__${VARIANT}`;
const SCOPED = (n: number) => `${LESSON}__${VARIANT}__r${String(n)}`;

const hashBytes = (bytes: string | Buffer | Uint8Array): string =>
  crypto.createHash("sha256").update(bytes as crypto.BinaryLike).digest("hex");

function retained(bytes: string, assessmentRevisionId: string, extra: Partial<RetainedRevision> = {}): RetainedRevision {
  const sha = hashBytes(bytes);
  return {
    lessonSlug: LESSON,
    variantKey: VARIANT,
    presentationRevisionId: `pr${sha}`,
    path: `app/lessons/variants/lesson_${LESSON}__pr${sha}.html`,
    sha256: sha,
    assessmentRevisionId,
    assessmentRevisionSource: "declared",
    ...extra,
  };
}

// One Firestore-like store for every presentationVariants document, including
// a pre-existing LEGACY record that the publisher must never touch.
function makeStore(initial: Record<string, unknown> = {}) {
  const docs = new Map<string, unknown>(Object.entries(initial));
  const events: string[] = [];
  const hosted = new Map<string, string>();
  const deployed = new Set<string>([R1]);
  const writeScopedCoverage: WriteScopedCoveragePort = ({ key, record, publishedBy, mode }) => {
    events.push(`write:${key.docId}`);
    const plan = planScopedCoverageWrite(docs.get(key.docId), record, mode);
    if (plan.ok && plan.action !== "reconcile") docs.set(key.docId, { ...record, publishedBy });
    return Promise.resolve(plan);
  };
  const deps = (rev: RetainedRevision, overrides: Partial<PublishDeps> = {}): PublishDeps => ({
    loadRetainedRevision: () => Promise.resolve({ ok: true, revision: rev }),
    deployHosting: () => {
      events.push("deploy");
      return Promise.resolve({ ok: true });
    },
    fetchHosted: (p) => {
      events.push("fetch");
      const b = hosted.get(p);
      return Promise.resolve(b === undefined ? { ok: true, status: 404, redirected: false, bytes: "" } : { ok: true, status: 200, redirected: false, bytes: b });
    },
    hashBytes,
    isAssessmentRevisionDeployed: (id) => Promise.resolve(deployed.has(id)),
    readScopedCoverage: (key) =>
      Promise.resolve(docs.has(key.docId) ? { exists: true as const, data: docs.get(key.docId) } : { exists: false as const }),
    writeScopedCoverage,
    ...overrides,
  });
  const readCoverage = (frozen: string) =>
    readRevisionCoverage(
      {
        readScoped: (s, k, n): Promise<CoverageDocRead> => {
          const id = `${s}__${k}__r${String(n)}`;
          return Promise.resolve(docs.has(id) ? { exists: true, data: docs.get(id) } : { exists: false });
        },
        readLegacy: (s, k): Promise<CoverageDocRead> => {
          const id = `${s}__${k}`;
          return Promise.resolve(docs.has(id) ? { exists: true, data: docs.get(id) } : { exists: false });
        },
      },
      { lessonSlug: LESSON, variantKey: VARIANT, assessmentRevisionId: frozen },
    );
  return { docs, events, hosted, deployed, deps, readCoverage };
}

const INPUT = (rev: RetainedRevision, mode: "publish" | "rollback" = "publish") => ({
  lessonSlug: LESSON,
  variantKey: VARIANT,
  presentationRevisionId: rev.presentationRevisionId,
  publishedBy: "operator",
  mode,
});

// The staging C7 legacy record: must remain byte-for-byte untouched.
const LEGACY_RECORD = Object.freeze({
  lessonSlug: LESSON,
  variantKey: VARIANT,
  currentPresentationRevisionId: PR90F,
  currentPath: `app/lessons/variants/lesson_${LESSON}__${PR90F}.html`,
  contentSha256: PR90F.slice(2),
  status: "active",
  assessmentRevisionId: R1,
  assessmentPresentationRevisionId: AP1FED,
  publishedBy: "c7",
});

describe("scoped identity", () => {
  it("r1 coverage targets ...__r1 and r2 coverage targets ...__r2, each recording its revision", () => {
    const a = scopedCoverageFor(retained("<html>A</html>", R1));
    const b = scopedCoverageFor(retained("<html>B</html>", R2));
    expect(a.key).toEqual({ docId: SCOPED(1), lessonSlug: LESSON, variantKey: VARIANT, revisionOrdinal: 1 });
    expect(b.key.docId).toBe(SCOPED(2));
    expect(a.record.assessmentRevisionId).toBe(R1);
    expect(b.record.assessmentRevisionId).toBe(R2);
    expect(a.record).not.toHaveProperty("assessmentPresentationRevisionId");
  });

  it.each([
    ["another lesson's revision", "assessment_water-cycle__r1"],
    ["a non-canonical ordinal", `assessment_${LESSON}__r01`],
    ["a malformed revision", "r1"],
  ])("refuses %s", (_label, id) => {
    expect(() => scopedCoverageFor(retained("<html>A</html>", id))).toThrow();
  });

  it("refuses a document id that disagrees with its fields", () => {
    const { record } = scopedCoverageFor(retained("<html>A</html>", R1));
    expect(() => assertScopedActivateWriteConsistent(SCOPED(2), record)).toThrow("does not agree");
    expect(() => assertScopedActivateWriteConsistent(LEGACY_ID, record)).toThrow("does not agree");
  });
});

describe("write planner (create-only publish; explicit rollback repoint)", () => {
  const { record } = scopedCoverageFor(retained("<html>A</html>", R1));
  const other: ScopedCoverageRecord = { ...record, currentPresentationRevisionId: `pr${"b".repeat(64)}` };

  it("absent -> create; identical -> reconcile (publish and rollback)", () => {
    expect(planScopedCoverageWrite(undefined, record, "publish")).toEqual({ ok: true, action: "create" });
    for (const mode of ["publish", "rollback"] as const) {
      expect(planScopedCoverageWrite({ ...record, publishedBy: "x", updatedAt: {} }, record, mode)).toEqual({ ok: true, action: "reconcile" });
    }
  });

  it("publish never overwrites a different or retired record; rollback repoints it", () => {
    for (const existing of [other, { ...record, status: "retired" }]) {
      expect(planScopedCoverageWrite(existing, record, "publish").ok).toBe(false);
      expect(planScopedCoverageWrite(existing, record, "rollback")).toEqual({ ok: true, action: "repoint" });
    }
  });

  it("a record of another lesson, variant key, or revision is never overwritten, even by rollback", () => {
    for (const existing of [{ ...record, assessmentRevisionId: R2 }, { ...record, lessonSlug: "x" }, { ...record, variantKey: "y" }, "garbage", null]) {
      for (const mode of ["publish", "rollback"] as const) {
        expect(planScopedCoverageWrite(existing, record, mode).ok).toBe(false);
      }
    }
  });
});

describe("r1 and r2 coexist; the legacy record is never written", () => {
  it("publishing r2 leaves r1 and the legacy record untouched, and each revision reads back to its own coverage", async () => {
    const s = makeStore({ [LEGACY_ID]: LEGACY_RECORD });
    s.deployed.add(R2);
    const a = retained("<html>A</html>", R1);
    const b = retained("<html>B</html>", R2);
    s.hosted.set(a.path, "<html>A</html>");
    s.hosted.set(b.path, "<html>B</html>");

    const ra = await publishRetainedRevision(INPUT(a), s.deps(a));
    expect(ra.ok && ra.coverage).toEqual({ docId: SCOPED(1), action: "create" });
    const r1Doc = s.docs.get(SCOPED(1));
    const rb = await publishRetainedRevision(INPUT(b), s.deps(b));
    expect(rb.ok && rb.coverage).toEqual({ docId: SCOPED(2), action: "create" });
    expect(s.docs.get(SCOPED(1))).toBe(r1Doc);

    // Reconciling r1 does not alter r2 either.
    const r2Doc = s.docs.get(SCOPED(2));
    const again = await publishRetainedRevision(INPUT(a), s.deps(a));
    expect(again.ok && again.coverage.action).toBe("reconcile");
    expect(s.docs.get(SCOPED(2))).toBe(r2Doc);

    expect(s.docs.get(LEGACY_ID)).toBe(LEGACY_RECORD);
    expect([...s.docs.keys()].sort()).toEqual([LEGACY_ID, SCOPED(1), SCOPED(2)]);
    expect(s.events.filter((e) => e.startsWith("write:")).every((e) => /__r\d+$/.test(e))).toBe(true);

    expect(await s.readCoverage(R1)).toMatchObject({ kind: "active", source: "scoped", presentationRevisionId: a.presentationRevisionId });
    expect(await s.readCoverage(R2)).toMatchObject({ kind: "active", source: "scoped", presentationRevisionId: b.presentationRevisionId });
  });

  it("an r1 record never satisfies r2; without r2 coverage, r2 falls to the legacy rules (mismatch)", async () => {
    const s = makeStore({ [LEGACY_ID]: LEGACY_RECORD });
    const a = retained("<html>A</html>", R1);
    s.hosted.set(a.path, "<html>A</html>");
    await publishRetainedRevision(INPUT(a), s.deps(a));
    expect(await s.readCoverage(R2)).toEqual({ kind: "assessmentMismatch" });
  });

  it("scoped retirement is authoritative and never falls through to the active legacy record", async () => {
    const s = makeStore({ [LEGACY_ID]: LEGACY_RECORD });
    const a = retained("<html>A</html>", R1);
    s.hosted.set(a.path, "<html>A</html>");
    await publishRetainedRevision(INPUT(a), s.deps(a));
    const res = await retireVariant(
      { lessonSlug: LESSON, variantKey: VARIANT, assessmentRevisionId: R1, publishedBy: "op" },
      {
        readScopedCoverage: (key) => Promise.resolve(s.docs.has(key.docId) ? { exists: true as const, data: s.docs.get(key.docId) } : { exists: false as const }),
        writeScopedRetire: ({ key }) => {
          s.docs.set(key.docId, { ...(s.docs.get(key.docId) as object), status: "retired" });
          return Promise.resolve();
        },
      },
    );
    expect(res).toEqual({ ok: true, retired: true, note: "retired" });
    expect(await s.readCoverage(R1)).toEqual({ kind: "retired" });
    expect(s.docs.get(LEGACY_ID)).toBe(LEGACY_RECORD);
  });

  it("the publisher module has no path to the legacy unscoped document", () => {
    const cli = fs.readFileSync(path.join(__dirname, "..", "scripts", "publish-variant.ts"), "utf8");
    const machine = fs.readFileSync(path.join(__dirname, "variant-publication.ts"), "utf8");
    const refs = fs.readFileSync(path.join(__dirname, "..", "shared", "firestore", "typed-ref.ts"), "utf8");
    expect(cli).not.toMatch(/presentationVariantIndex(Activate|Retire)?DocRef\b/);
    expect(machine).not.toMatch(/presentationVariantIndexDocId\(/);
    expect(refs).not.toMatch(/export function presentationVariantIndex(Activate|Retire)DocRef/);
  });
});

describe("read/write agreement with the 9C-1 evaluator", () => {
  it("every emitted record reads back as exactly its coverage", () => {
    const unbound = scopedCoverageFor(retained("<html>A</html>", R1)).record;
    const bound: ScopedCoverageRecord = { ...scopedCoverageFor(retained("<html>B</html>", R2)).record, assessmentPresentationRevisionId: `ap${"d".repeat(64)}` };
    expect(verifyReadBackAgreement(unbound)).toBeNull();
    expect(verifyReadBackAgreement(bound)).toBeNull();
    expect(verifyReadBackAgreement({ ...unbound, currentPath: "app/lessons/variants/x.html" })).toContain("would not read back");
  });
});

describe("deployment authority", () => {
  it("recognizes only a revision document with exactly this identity", () => {
    const ok = { assessmentId: `assessment_${LESSON}`, activityId: LESSON, revisionOrdinal: 2 };
    expect(isDeployedRevisionRecord(R2, ok)).toBe(true);
    expect(isDeployedRevisionRecord(R1, ok)).toBe(false);
    expect(isDeployedRevisionRecord(R2, { ...ok, assessmentId: "assessment_x" })).toBe(false);
    expect(isDeployedRevisionRecord(R2, { ...ok, activityId: "x" })).toBe(false);
    expect(isDeployedRevisionRecord(R2, undefined)).toBe(false);
    expect(isDeployedRevisionRecord("assessment_water-cycle__r01", ok)).toBe(false);
  });

  it("a deployed non-current revision publishes; an undeployed or unknown one is refused before any side effect", async () => {
    const s = makeStore();
    const old = retained("<html>A</html>", R1); // r1 deployed, r2 imagined current
    s.hosted.set(old.path, "<html>A</html>");
    expect((await publishRetainedRevision(INPUT(old), s.deps(old))).ok).toBe(true);
    for (const id of [R2, `assessment_${LESSON}__r7`]) {
      const t = makeStore();
      const rev = retained("<html>C</html>", id);
      const res = await publishRetainedRevision(INPUT(rev), t.deps(rev));
      expect(res).toMatchObject({ ok: false, failedStage: "LOCAL_VERIFIED" });
      expect((res as { error: string }).error).toContain("is not deployed");
      expect(t.events).toEqual([]);
    }
  });
});

describe("failure atomicity: invalid local provenance never reaches a side effect", () => {
  it.each([
    ["a revision of another lesson", retained("<html>A</html>", "assessment_water-cycle__r1")],
    ["a malformed revision", retained("<html>A</html>", "assessment_earths-layers__r0")],
    ["a binding whose revision disagrees with provenance", retained("<html>A</html>", R1, {
      assessmentBinding: { assessmentRevisionId: R2, assessmentPresentationRevisionId: AP1FED, record: {} },
    })],
  ])("%s", async (_label, rev) => {
    const s = makeStore({ [LEGACY_ID]: LEGACY_RECORD });
    const res = await publishRetainedRevision(INPUT(rev), s.deps(rev, { ensureAssessmentPresentation: () => Promise.resolve({ ok: true, created: true }) }));
    expect(res).toMatchObject({ ok: false, failedStage: "LOCAL_VERIFIED", indexAdvanced: false });
    expect(s.events).toEqual([]);
    expect(s.docs.get(LEGACY_ID)).toBe(LEGACY_RECORD);
  });

  it("a contradictory existing scoped record is refused before Hosting (preflight), and again at the write", async () => {
    const s = makeStore();
    const a = retained("<html>A</html>", R1);
    s.docs.set(SCOPED(1), { ...scopedCoverageFor(retained("<html>Z</html>", R1)).record });
    const res = await publishRetainedRevision(INPUT(a), s.deps(a));
    expect(res).toMatchObject({ ok: false, failedStage: "LOCAL_VERIFIED" });
    expect(s.events).toEqual([]);
    // A record appearing after the preflight is caught by the transactional write.
    const t = makeStore();
    t.hosted.set(a.path, "<html>A</html>");
    const raced = await publishRetainedRevision(INPUT(a), t.deps(a, {
      deployHosting: () => {
        t.docs.set(SCOPED(1), { ...scopedCoverageFor(retained("<html>Z</html>", R1)).record });
        return Promise.resolve({ ok: true });
      },
    }));
    expect(raced).toMatchObject({ ok: false, failedStage: "INDEX_UPDATED", indexAdvanced: false });
  });
});

describe("certified Earth's Layers metadata (real loader; nothing is published)", () => {
  const load = makeLoadRetainedRevision(REPO_ROOT);

  it("pr90f... + ap1fed... would publish exactly the bound r1 scoped record", async () => {
    const loaded = await load({ lessonSlug: LESSON, variantKey: VARIANT, presentationRevisionId: PR90F });
    expect(loaded.ok).toBe(true);
    const rev = (loaded as { revision: RetainedRevision }).revision;
    const { key, record } = scopedCoverageFor(rev);
    expect(key.docId).toBe(SCOPED(1));
    expect(record).toEqual({
      lessonSlug: LESSON,
      variantKey: VARIANT,
      currentPresentationRevisionId: PR90F,
      currentPath: `app/lessons/variants/lesson_${LESSON}__${PR90F}.html`,
      contentSha256: PR90F.slice(2),
      status: "active",
      assessmentRevisionId: R1,
      assessmentPresentationRevisionId: AP1FED,
    });
    expect(verifyReadBackAgreement(record)).toBeNull();
  });

  it("historical prff01... would publish an unbound r1 scoped record through the pinned legacy rule", async () => {
    const loaded = await load({ lessonSlug: LESSON, variantKey: VARIANT, presentationRevisionId: PRFF01 });
    const rev = (loaded as { revision: RetainedRevision }).revision;
    expect(rev.assessmentRevisionSource).toBe("legacyR1");
    const { key, record } = scopedCoverageFor(rev);
    expect(key.docId).toBe(SCOPED(1));
    expect(record.assessmentRevisionId).toBe(R1);
    expect(record).not.toHaveProperty("assessmentPresentationRevisionId");
  });

  it("the retained artifacts still hash to their ids", () => {
    for (const id of [PR90F, PRFF01]) {
      const bytes = fs.readFileSync(path.join(REPO_ROOT, `app/lessons/variants/lesson_${LESSON}__${id}.html`));
      expect(`pr${hashBytes(bytes)}`).toBe(id);
    }
  });
});
