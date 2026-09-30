/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * F5.3 Slice 9A - multi-revision assessment payload tooling.
 *
 * Proves, before any real second revision exists, that committed revisions
 * are discovered deterministically, that every revision's identity (file
 * name, lesson slug, assessment id, revision id, ordinal) is checked and
 * fails closed on disagreement, that the canonical lesson resolves to exactly
 * one configured revision, and that the answer-position debt register never
 * covers a later revision. Synthetic revisions are held in memory or in a
 * temporary directory; nothing is written to the repository.
 *
 * Earth's Layers r2 (authored 2026-09-28) is the first real second revision:
 * the repository-state tests below prove the real r1 + r2 pair, and that
 * every other lesson is still a single r1.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const R = require("../assessmentRevisions.cjs");
const F = require("../assessmentFidelity.cjs");
const Q = require("../assessmentQuality.cjs");
const configMod = require("../config.cjs");
const variantSource = require("../variantSource.cjs");
const author = require("../authorAssessments.cjs");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PAYLOAD_DIR = R.payloadDirectory(ROOT);
const EL = "earths-layers";

function realPayload(slug = EL, ordinal = 1) {
  return JSON.parse(fs.readFileSync(path.join(PAYLOAD_DIR, `${slug}.r${ordinal}.json`), "utf8"));
}
const EL_R1 = "assessment_earths-layers__r1";
const EL_R2 = "assessment_earths-layers__r2";

// A synthetic, internally consistent later revision: the r1 content with its
// correct answers moved so the quiz content genuinely differs.
function syntheticRevision(ordinal, base = realPayload()) {
  const p = JSON.parse(JSON.stringify(base));
  p.revisionOrdinal = ordinal;
  p.publishedBy = "slice-9a-synthetic-fixture";
  p.items.forEach((item, i) => {
    const target = item.options[(i + 1) % item.options.length];
    const current = item.options.find((o) => o.optionId === item.correctOptionId);
    const text = target.text;
    target.text = current.text;
    current.text = text;
    item.correctOptionId = target.optionId;
  });
  return p;
}

function entry(file, payload) {
  const { entry: e, problems } = R.describeRevision(file, payload);
  expect(problems).toEqual([]);
  return e;
}

function memoryIo(files) {
  return {
    listFiles: () => Object.keys(files),
    readFile: (name) => (typeof files[name] === "string" ? files[name] : JSON.stringify(files[name])),
  };
}

function tempRepo(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "slice9a-"));
  const dir = R.payloadDirectory(root);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof content === "string" ? content : JSON.stringify(content, null, 2) + "\n");
  }
  return root;
}

function copyCommittedPayloads() {
  const files = {};
  for (const name of fs.readdirSync(PAYLOAD_DIR).filter((n) => n.endsWith(".json"))) {
    files[name] = fs.readFileSync(path.join(PAYLOAD_DIR, name), "utf8");
  }
  return files;
}

describe("identifier grammar", () => {
  test("ordinals of 1 or more are accepted; the grammar matches the platform helpers", () => {
    expect(R.revisionIdFor(EL, 1)).toBe("assessment_earths-layers__r1");
    expect(R.revisionIdFor(EL, 12)).toBe("assessment_earths-layers__r12");
    expect(R.assessmentIdFor(EL)).toBe("assessment_earths-layers");
    expect(R.payloadFileNameFor(EL, 2)).toBe("earths-layers.r2.json");
    expect(R.parsePayloadFileName("earths-layers.r10.json")).toEqual({ slug: EL, ordinal: 10 });
    expect(R.parseRevisionId("assessment_earths-layers__r2")).toEqual({ slug: EL, ordinal: 2 });
    expect(R.payloadFileNameForRevisionId("assessment_earths-layers__r3")).toBe("earths-layers.r3.json");
  });

  test("malformed or non-positive ordinals and names are refused", () => {
    for (const bad of ["earths-layers.r0.json", "earths-layers.r01.json", "earths-layers.r-1.json", "earths-layers.rx.json", "earths-layers.json", "Earths-Layers.r1.json", "earths_layers.r1.json", "earths-layers.r1.json.bak", "earths-layers.r1.5.json"]) {
      expect(R.parsePayloadFileName(bad)).toBeNull();
    }
    for (const bad of ["assessment_earths-layers__r0", "assessment_earths-layers__r01", "assessment_earths-layers", "earths-layers__r1", "assessment_earths-layers__r1 ", "assessment___r1"]) {
      expect(R.parseRevisionId(bad)).toBeNull();
    }
    for (const bad of [0, -1, 1.5, "2", NaN, null, undefined]) {
      expect(() => R.revisionIdFor(EL, bad)).toThrow("integer of 1 or more");
    }
  });
});

describe("identity of one committed payload", () => {
  test("every committed payload validates: 49 r1 payloads plus Earth's Layers and Water Cycle r2", () => {
    const { revisions, failures } = R.discoverRevisions({ repoRoot: ROOT });
    expect(failures).toEqual([]);
    expect(revisions).toHaveLength(51);
    expect(revisions.filter((e) => e.revisionOrdinal !== 1).map((e) => e.file)).toEqual(["earths-layers.r2.json", "water-cycle.r2.json"]);
    expect(revisions.filter((e) => e.revisionOrdinal === 1)).toHaveLength(49);
    for (const e of revisions) {
      expect(R.describeRevision(e.file, e.payload).problems).toEqual([]);
    }
  });

  test("the real Earth's Layers r2 is a distinct revision with the same shape and scoring scale as r1", () => {
    const r1 = realPayload(EL, 1);
    const r2 = realPayload(EL, 2);
    expect(entry("earths-layers.r2.json", r2)).toMatchObject({ slug: EL, revisionOrdinal: 2, assessmentRevisionId: EL_R2 });
    expect(r2.items.map((it) => it.itemId)).toEqual(r1.items.map((it) => it.itemId));
    for (const it of r2.items) {
      expect(it.itemType).toBe("singleChoice");
      expect(it.points).toBe(1);
      expect(it.options.map((o) => o.optionId)).toEqual(["A", "B", "C", "D"]);
    }
    // Real content change, not a relabel: every stem differs from r1.
    r2.items.forEach((it, i) => expect(it.stem).not.toBe(r1.items[i].stem));
  });

  test("an internally consistent synthetic r2 is accepted", () => {
    const e = entry("earths-layers.r2.json", syntheticRevision(2));
    expect(e).toMatchObject({
      slug: EL,
      revisionOrdinal: 2,
      assessmentId: "assessment_earths-layers",
      assessmentRevisionId: "assessment_earths-layers__r2",
    });
    expect(F.assertSchemaValid(e.payload, EL)).toEqual([]);
  });

  test("an r2 file carrying the r1 revision is rejected", () => {
    const { problems } = R.describeRevision("earths-layers.r2.json", realPayload());
    expect(problems.join("\n")).toContain("revisionOrdinal 1 (assessment_earths-layers__r1) does not match the file's revision r2");
  });

  test("an r1 file carrying ordinal 2 is rejected", () => {
    const { problems } = R.describeRevision("earths-layers.r1.json", syntheticRevision(2));
    expect(problems.join("\n")).toContain("does not match the file's revision r1");
  });

  test("a payload whose lesson disagrees with its file name is rejected", () => {
    const p = syntheticRevision(2);
    p.activityId = "plate-tectonics";
    expect(R.describeRevision("earths-layers.r2.json", p).problems.join("\n")).toContain('activityId "plate-tectonics" does not match the file\'s lesson "earths-layers"');
  });

  test("malformed or non-positive payload ordinals are rejected", () => {
    for (const bad of [0, -2, 1.5, "2", null]) {
      const p = syntheticRevision(2);
      p.revisionOrdinal = bad;
      expect(R.describeRevision("earths-layers.r2.json", p).problems.join("\n")).toContain("must be an integer of 1 or more");
      expect(F.assertSchemaValid(p, EL)).toContain(`[${EL}] revisionOrdinal must be an integer of 1 or more`);
    }
  });

  test("a non-object payload and a malformed file name are rejected", () => {
    expect(R.describeRevision("earths-layers.r2.json", [1]).problems.join("\n")).toContain("must be a JSON object");
    const { entry: e, problems } = R.describeRevision("earths-layers.r02.json", syntheticRevision(2));
    expect(e).toBeNull();
    expect(problems.join("\n")).toContain("not a committed assessment payload name");
  });
});

describe("revision set", () => {
  const r1 = () => entry("earths-layers.r1.json", realPayload());
  const r2 = () => entry("earths-layers.r2.json", syntheticRevision(2));

  test("contiguous revisions of several lessons are accepted", () => {
    expect(R.validateRevisionSet([r1(), r2(), entry("water-cycle.r1.json", realPayload("water-cycle"))])).toEqual([]);
  });

  test("duplicate revision ids are rejected", () => {
    expect(R.validateRevisionSet([r1(), r2(), r2()]).join("\n")).toContain("duplicate assessment revision id assessment_earths-layers__r2");
  });

  test("duplicate ordinals for one assessment are rejected", () => {
    // Two files both declaring r1 of the same assessment.
    const bad = R.describeRevision("earths-layers.r2.json", realPayload()).entry;
    const problems = R.validateRevisionSet([r1(), bad]);
    expect(problems.join("\n")).toContain("duplicate declared revision ordinal earths-layers r1");
  });

  test("a gap in the ordinals (a missing earlier revision) is rejected", () => {
    const r3 = entry("earths-layers.r3.json", syntheticRevision(3));
    expect(R.validateRevisionSet([r1(), r3]).join("\n")).toContain('lesson "earths-layers" commits r3 but is missing r2');
    expect(R.validateRevisionSet([r2()]).join("\n")).toContain("is missing r1");
  });
});

describe("directory discovery", () => {
  const files = {
    "earths-layers.r10.json": syntheticRevision(10),
    "earths-layers.r2.json": syntheticRevision(2),
    "water-cycle.r1.json": realPayload("water-cycle"),
    "earths-layers.r1.json": realPayload(),
    "cert-lessons.ts": "not a payload",
  };
  for (let n = 3; n <= 9; n += 1) files[`earths-layers.r${n}.json`] = syntheticRevision(n);

  test("discovery is deterministic, numerically ordered, and independent of listing order", () => {
    const names = Object.keys(files);
    const a = R.discoverRevisions({ io: memoryIo(files) });
    const reversed = Object.fromEntries(names.reverse().map((n) => [n, files[n]]));
    const b = R.discoverRevisions({ io: memoryIo(reversed) });
    expect(a.failures).toEqual([]);
    expect(b.failures).toEqual([]);
    expect(a.revisions.map((e) => e.file)).toEqual(b.revisions.map((e) => e.file));
    expect(a.bySlug.get(EL).map((e) => e.revisionOrdinal)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(a.revisions.map((e) => e.slug)).toEqual([...Array(10).fill(EL), "water-cycle"]);
  });

  test("a stray or non-canonical JSON name in the payload directory fails closed", () => {
    for (const stray of ["earths-layers.r01.json", "earths-layers.json", "notes.json", "earths-layers.r1.backup.json"]) {
      const r = R.discoverRevisions({ io: memoryIo({ ...files, [stray]: realPayload() }) });
      expect(r.failures.join("\n")).toContain(`${stray}: not a committed assessment payload name`);
    }
  });

  test("an unreadable payload fails closed", () => {
    const r = R.discoverRevisions({ io: memoryIo({ ...files, "earths-layers.r11.json": "{ not json" }) });
    expect(r.failures.join("\n")).toContain("earths-layers.r11.json: not readable as JSON");
  });

  test("loadRevisions and revisionsForLesson throw on any inconsistency", () => {
    const io = memoryIo({ "earths-layers.r1.json": realPayload(), "earths-layers.r2.json": realPayload() });
    expect(() => R.loadRevisions({ io })).toThrow("committed assessment revisions are inconsistent");
    expect(() => R.revisionsForLesson(EL, { io })).toThrow("does not match the file's revision r2");
  });

  test("findRevision returns only committed revisions", () => {
    expect(R.findRevision("assessment_earths-layers__r1", { repoRoot: ROOT }).file).toBe("earths-layers.r1.json");
    expect(R.findRevision(EL_R2, { repoRoot: ROOT }).file).toBe("earths-layers.r2.json");
    expect(R.findRevision("assessment_earths-layers__r3", { repoRoot: ROOT })).toBeNull();
    expect(R.findRevision("assessment_earths-layers__r01", { repoRoot: ROOT })).toBeNull();
  });
});

describe("canonical revision resolution", () => {
  const cfg = (extra = {}) => ({ slug: EL, ...extra });
  const r1 = () => entry("earths-layers.r1.json", realPayload());
  const r2 = () => entry("earths-layers.r2.json", syntheticRevision(2));

  test("a single committed r1 resolves without any config declaration (all lessons except Earth's Layers and Water Cycle)", () => {
    expect(R.resolveCanonicalRevision(cfg(), [r1()]).assessmentRevisionId).toBe(EL_R1);
    for (const slug of configMod.listConfiguredSlugs().filter((s) => s !== EL && s !== "water-cycle")) {
      const c = configMod.loadConfig(slug);
      expect(c.canonicalAssessmentRevisionId).toBeUndefined();
      expect(R.resolveCanonicalRevision(c, R.revisionsForLesson(slug, { repoRoot: ROOT })).revisionOrdinal).toBe(1);
    }
  });

  test("the real Earth's Layers config declares r1 (Stage A) or r2 (Stage B), which resolves among its committed r1 and r2", () => {
    const c = configMod.loadConfig(EL);
    const committed = R.revisionsForLesson(EL, { repoRoot: ROOT });
    expect(committed.map((e) => e.assessmentRevisionId)).toEqual([EL_R1, EL_R2]);
    expect([EL_R1, EL_R2]).toContain(c.canonicalAssessmentRevisionId);
    expect(R.resolveCanonicalRevision(c, committed).assessmentRevisionId).toBe(c.canonicalAssessmentRevisionId);
    const { canonicalAssessmentRevisionId: _declared, ...undeclared } = c;
    expect(() => R.resolveCanonicalRevision(undeclared, committed)).toThrow("must declare canonicalAssessmentRevisionId");
  });

  test("several committed revisions without a declaration are ambiguous and fail closed", () => {
    expect(() => R.resolveCanonicalRevision(cfg(), [r1(), r2()])).toThrow("2 committed assessment revisions (r1, r2); the lesson config must declare canonicalAssessmentRevisionId");
  });

  test("an explicit declaration selects exactly that committed revision", () => {
    expect(R.resolveCanonicalRevision(cfg({ canonicalAssessmentRevisionId: "assessment_earths-layers__r2" }), [r1(), r2()]).file).toBe("earths-layers.r2.json");
    expect(R.resolveCanonicalRevision(cfg({ canonicalAssessmentRevisionId: "assessment_earths-layers__r1" }), [r1(), r2()]).file).toBe("earths-layers.r1.json");
  });

  test("a declaration that is not committed, malformed, or foreign fails closed", () => {
    expect(() => R.resolveCanonicalRevision(cfg({ canonicalAssessmentRevisionId: "assessment_earths-layers__r3" }), [r1(), r2()])).toThrow("is not a committed revision");
    expect(() => R.resolveCanonicalRevision(cfg({ canonicalAssessmentRevisionId: "assessment_earths-layers__r2" }), [r1()])).toThrow("is not a committed revision");
    for (const bad of ["earths-layers.r2.json", "assessment_earths-layers__r0", "r2", 2, ""]) {
      expect(() => R.resolveCanonicalRevision(cfg({ canonicalAssessmentRevisionId: bad }), [r1(), r2()])).toThrow("must be assessment_<slug>__r<N>");
    }
    expect(() => R.resolveCanonicalRevision(cfg({ canonicalAssessmentRevisionId: "assessment_water-cycle__r1" }), [r1()])).toThrow('belongs to lesson "water-cycle"');
  });

  test("a lesson with no committed revision, or given another lesson's revisions, fails closed", () => {
    expect(() => R.resolveCanonicalRevision(cfg(), [])).toThrow("no committed assessment revision");
    expect(() => R.resolveCanonicalRevision(cfg(), [entry("water-cycle.r1.json", realPayload("water-cycle"))])).toThrow("does not belong to this lesson");
  });

  test("the lesson config validator refuses a malformed or foreign declaration", () => {
    const base = configMod.loadConfig(EL);
    expect(() => configMod.validateConfigShape({ ...base, canonicalAssessmentRevisionId: "assessment_earths-layers__r2" }, EL)).not.toThrow();
    expect(() => configMod.validateConfigShape({ ...base, canonicalAssessmentRevisionId: "assessment_earths-layers__r0" }, EL)).toThrow("must be assessment_<slug>__r<N>");
    expect(() => configMod.validateConfigShape({ ...base, canonicalAssessmentRevisionId: "assessment_water-cycle__r2" }, EL)).toThrow('belongs to lesson "water-cycle"');
  });
});

describe("canonical source fidelity against the configured revision", () => {
  const html = fs.readFileSync(path.join(ROOT, "lesson-sources", `lesson_${EL}.html`), "utf8");
  const base = configMod.loadConfig(EL);
  const both = () => [entry("earths-layers.r1.json", realPayload(EL, 1)), entry("earths-layers.r2.json", realPayload(EL, 2))];
  // The verbatim r2 literal lives in the authored variant source (both release
  // stages); the Stage B canonical source is the real source carrying it.
  const render = require("../assessmentPresentationRender.cjs");
  const literalOf = (h) => { const l = render.locateQuizLiteral(h); return h.slice(l.start, l.end); };
  const withLiteral = (h, lit) => { const l = render.locateQuizLiteral(h); return h.slice(0, l.start) + lit + h.slice(l.end); };
  const r2Html = withLiteral(html, literalOf(fs.readFileSync(path.join(ROOT, base.variants["reading-adapted"].source), "utf8")));
  const otherRevision = base.canonicalAssessmentRevisionId === EL_R1 ? EL_R2 : EL_R1;

  test("the source is proven faithful to the revision the config declares", () => {
    const r = F.checkCanonicalRevisionFidelity(base, html, both());
    expect(r.revision.assessmentRevisionId).toBe(base.canonicalAssessmentRevisionId);
    expect(r.problems).toEqual([]);
  });

  test("declaring a revision the source does not transcribe is a fidelity failure", () => {
    const r = F.checkCanonicalRevisionFidelity({ ...base, canonicalAssessmentRevisionId: otherRevision }, html, both());
    expect(r.revision.assessmentRevisionId).toBe(otherRevision);
    expect(r.problems.join("\n")).toContain("correct answer mismatch");
  });

  test("an undeclared multi-revision lesson cannot be checked and fails closed", () => {
    const { canonicalAssessmentRevisionId: _declared, ...undeclared } = base;
    expect(() => F.checkCanonicalRevisionFidelity(undeclared, html, both())).toThrow("must declare canonicalAssessmentRevisionId");
  });

  test("buildPayload needs an explicit ordinal and stamps it", () => {
    const quiz = F.extractCanonicalQuiz(r2Html, EL);
    expect(() => F.buildPayload(EL, quiz, "x")).toThrow("explicit revision ordinal");
    expect(() => F.buildPayload(EL, quiz, "x", 0)).toThrow("explicit revision ordinal");
    expect(F.buildPayload(EL, quiz, "x", 2).revisionOrdinal).toBe(2);
    // The authoring CLI's transform reproduces the committed r2 exactly.
    expect(F.buildPayload(EL, quiz, realPayload(EL, 2).publishedBy, 2)).toEqual(realPayload(EL, 2));
  });
});

describe("answer-position quality is per revision", () => {
  test("recorded r1 debt never excuses a synthetic r2, even with identical content", () => {
    const r2 = realPayload();
    r2.revisionOrdinal = 2;
    const root = tempRepo({ ...copyCommittedPayloads(), "earths-layers.r2.json": r2 });
    try {
      const result = Q.verifyRepository({ repoRoot: root });
      expect(result.ok).toBe(false);
      expect(result.failures.every((f) => f.startsWith("earths-layers.r2.json: "))).toBe(true);
      expect(result.failures.map((f) => f.split(" - ")[0]).sort()).toEqual([
        "earths-layers.r2.json: POSITION_NEVER_CORRECT",
        "earths-layers.r2.json: POSITION_OVER_CAP",
        "earths-layers.r2.json: RUN_TOO_LONG",
        "earths-layers.r2.json: SPREAD_TOO_WIDE",
      ]);
      // r1 stays attributed to r1 as recorded debt.
      expect(result.debt.some((d) => d.startsWith("earths-layers.r1.json: "))).toBe(true);
      expect(result.debt.some((d) => d.startsWith("earths-layers.r2.json: "))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("a compliant synthetic r2 passes on its own while r1 keeps its debt", () => {
    const r2 = realPayload();
    r2.revisionOrdinal = 2;
    const target = "ABCDBCADCB";
    r2.items.forEach((item, i) => {
      const want = item.options.find((o) => o.optionId === target[i]);
      const current = item.options.find((o) => o.optionId === item.correctOptionId);
      const text = want.text;
      want.text = current.text;
      current.text = text;
      item.correctOptionId = want.optionId;
    });
    expect(Q.evaluatePayload(r2).hard).toEqual([]);
    const root = tempRepo({ ...copyCommittedPayloads(), "earths-layers.r2.json": r2 });
    try {
      const result = Q.verifyRepository({ repoRoot: root });
      expect(result.failures).toEqual([]);
      expect(result.audit.map((a) => a.file)).toContain("earths-layers.r2.json");
      expect(result.debt.filter((d) => d.startsWith("earths-layers.r1.json: ")).length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("an allowlist entry for r2 is refused even with r1's recorded sequence", () => {
    const e = entry("earths-layers.r2.json", Object.assign(realPayload(), { revisionOrdinal: 2 }));
    const audit = Q.auditRevisionEntries([e]);
    const out = Q.checkAllowlist(audit, [{ payload: "earths-layers.r2.json", correctSequence: "CBBBBABABB", findings: ["x"], reason: "inherit" }]);
    expect(out.failures.join("\n")).toContain("only legacy r1 payloads can be debt");
  });

  test("an inconsistent payload identity fails the quality gate instead of being skipped", () => {
    const files = copyCommittedPayloads();
    const root = tempRepo({ ...files, "earths-layers.r2.json": realPayload(), "earths-layers.r02.json": realPayload() });
    try {
      const result = Q.verifyRepository({ repoRoot: root });
      expect(result.ok).toBe(false);
      const text = result.failures.join("\n");
      expect(text).toContain("earths-layers.r2.json: payload revisionOrdinal 1");
      expect(text).toContain("earths-layers.r02.json: not a committed assessment payload name");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("today's audit: 49 r1 payloads and Earth's Layers and Water Cycle r2, 14 recorded r1 debts, no failures", () => {
    const result = Q.verifyRepository();
    expect(result.failures).toEqual([]);
    expect(result.audit).toHaveLength(51);
    expect(result.audit.filter((a) => !a.file.endsWith(".r1.json")).map((a) => a.file)).toEqual(["earths-layers.r2.json", "water-cycle.r2.json"]);
    expect(new Set(result.debt.map((d) => d.split(":")[0])).size).toBe(14);
    for (const file of ["earths-layers.r2.json", "water-cycle.r2.json"]) {
      expect(result.debt.some((d) => d.startsWith(file))).toBe(false);
    }
  });

  test("the real Earth's Layers r2 meets the answer-position target with no allowlist entry", () => {
    const r2 = Q.evaluatePayload(realPayload(EL, 2));
    expect(r2.hard).toEqual([]);
    expect(r2.warnings).toEqual([]);
    expect(r2.spread).toBeLessThanOrEqual(1);
    expect(r2.counts.every((c) => c > 0)).toBe(true);
    // r1 keeps its recorded, frozen debt; r2 never inherits or clears it.
    expect(Q.evaluatePayload(realPayload(EL, 1)).hard.length).toBeGreaterThan(0);
  });
});

describe("variant payload loading", () => {
  test("loads every committed revision of the lesson in ordinal order", () => {
    const root = tempRepo({ "earths-layers.r1.json": realPayload(), "earths-layers.r2.json": syntheticRevision(2), "water-cycle.r1.json": realPayload("water-cycle") });
    try {
      expect(variantSource.loadAssessmentPayloads(EL, root).map((p) => p.name)).toEqual(["earths-layers.r1.json", "earths-layers.r2.json"]);
      expect(variantSource.loadAssessmentPayloads("plate-tectonics", root)).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("an inconsistent payload directory fails closed instead of being filtered", () => {
    const root = tempRepo({ "earths-layers.r1.json": realPayload(), "earths-layers.r2.json": realPayload() });
    try {
      expect(() => variantSource.loadAssessmentPayloads(EL, root)).toThrow("inconsistent");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  test("the real Earth's Layers lesson loads exactly its committed r1 and r2, in order", () => {
    expect(variantSource.loadAssessmentPayloads(EL).map((p) => p.name)).toEqual(["earths-layers.r1.json", "earths-layers.r2.json"]);
  });
});

describe("authoring tool target selection", () => {
  const r1 = () => entry("earths-layers.r1.json", realPayload());
  const r2 = () => entry("earths-layers.r2.json", syntheticRevision(2));

  test("batch mode authors r1 only for a lesson with no committed revision", () => {
    expect(author.planTarget("new-lesson", [], null)).toEqual({ ordinal: 1 });
    expect(author.planTarget(EL, [r1()], null).preserved).toContain("never rewritten");
    expect(author.planTarget(EL, [r1(), r2()], null).preserved).toContain("earths-layers.r2.json");
  });

  test("an explicit revision must be exactly the next one, never an existing one", () => {
    expect(author.planTarget(EL, [r1()], 2)).toEqual({ ordinal: 2 });
    expect(author.planTarget(EL, [r1(), r2()], 3)).toEqual({ ordinal: 3 });
    expect(author.planTarget(EL, [r1()], 1).refused).toContain("already committed");
    expect(author.planTarget(EL, [r1(), r2()], 2).refused).toContain("already committed");
    expect(author.planTarget(EL, [r1()], 3).refused).toContain("only r2 may be authored");
  });

  test("rewriting is refused and an explicit target needs lesson, revision, and provenance", () => {
    expect(author.parseArgs(["--force"]).errors.join("\n")).toContain("--force is refused");
    expect(author.parseArgs(["--lesson=earths-layers"]).errors.join("\n")).toContain("must be given together");
    expect(author.parseArgs(["--revision=2"]).errors.join("\n")).toContain("must be given together");
    expect(author.parseArgs(["--lesson=earths-layers", "--revision=2"]).errors.join("\n")).toContain("--published-by");
    expect(author.parseArgs(["--lesson=earths-layers", "--revision=02", "--published-by=x"]).errors.join("\n")).toContain("positive integer");
    expect(author.parseArgs(["--lesson=Earths", "--revision=2", "--published-by=x"]).errors.join("\n")).toContain("kebab-case slug");
    const ok = author.parseArgs(["--lesson=earths-layers", "--revision=2", "--published-by=f5-3-r2", "--write"]);
    expect(ok).toMatchObject({ errors: [], lesson: EL, revision: 2, publishedBy: "f5-3-r2", write: true });
    expect(author.parseArgs([]).errors).toEqual([]);
  });
});
