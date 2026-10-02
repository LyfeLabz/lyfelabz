/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * F5.3 Slice 9B - canonical revision declarations, revision-bound renditions,
 * the variant baseline, and the revision-to-path table.
 *
 * Multi-revision behavior is proven with the REAL Earth's Layers pair: the
 * committed r1 and r2 (authored and owner-approved 2026-09-28), the retained
 * r1 presentations (prff01..., pr90f... and its Quiz Results Polish successor
 * pr7718..., both bound + ap1fed...) and the retained r2 presentations
 * (pr6b7c... and its successor pr8996..., both + ap515838...).
 *
 * The Quiz Results Polish changed the canonical source's presentation (style
 * and script), so today's sources build the successors pr7718... (from the
 * historical r1 variant source) and pr8996... (from the authored source), in
 * either stage and byte for byte, and can no longer rebuild pr90f..., prff01...
 * or pr6b7c.... Those stay immutable and hash-pinned ("protected historical
 * bytes"), and new bytes can never claim the pinned legacy-r1 provenance.
 *
 * The repository moves through two release states (addendum 21.12): Stage A
 * declares r1 as the canonical current revision, Stage B declares r2. Every
 * test here holds in BOTH states. Each state's canonical source is rebuilt in
 * memory from two immutable byte anchors: the verbatim r1 quiz literal carried
 * by retained prff01... (an unbound variant whose literal is the canonical
 * r1 literal) and the verbatim r2 literal carried by the authored variant
 * source. Nothing here writes a payload, source, config, or artifact.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const R = require("../assessmentRevisions.cjs");
const N = require("../assessmentRenditions.cjs");
const F = require("../assessmentFidelity.cjs");
const render = require("../assessmentPresentationRender.cjs");
const builder = require("../index.cjs");
const configMod = require("../config.cjs");
const variantSource = require("../variantSource.cjs");
const paths = require("../paths.cjs");

const ROOT = paths.REPO_ROOT;
const EL = "earths-layers";
const PR90F = "pr90f52136d39f36d21bf1602d0af3901adf0eae32a046c522907c5e932f342189";
const PRFF01 = "prff01d9d2cf71210c491afc60cf98cd3d69b91d5c64cae51aff2463b50892375c";
const PR6B7C = "pr6b7c74fe84fb20a9b05d4b2d6e006c21ed2bc02d58dcfbefc925dbd4c400e948";
// The retained r2-bound revision today's sources build (Quiz Results Polish).
const PR8996 = "pr8996a455b762c209c8a74c20954521cd93313df920923292aa334161560f6e11";
// The retained r1-bound revision the historical r1 variant source builds today
// (Quiz Results Polish successor of pr90f..., same ap1fed... binding).
const PR7718 = "pr7718b6fb29e40df7a338ea6896071229f232b884e9301f01c223181051071667";
const AP1FED = "ap1fed478c9e4ad8335946ff7f7b165df657bafc48e8c5990d922419581fa02c25";
const AP5158 = "ap51583824375c58be36627f047f280510b0cde98e9aba2fbec7ef058ad2fc4903";
const R1 = "assessment_earths-layers__r1";
const R2 = "assessment_earths-layers__r2";

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const elCfg = configMod.loadConfig(EL);
const elSource = read(elCfg.canonicalSource);
const r1Payload = JSON.parse(read(`platform/functions/src/scripts/assessments/${EL}.r1.json`));
// The real, committed r2 (a fresh copy per call, so a test may mutate it).
const r2Payload = () => JSON.parse(read(`platform/functions/src/scripts/assessments/${EL}.r2.json`));

function entry(file, payload) {
  const d = R.describeRevision(file, payload);
  expect(d.problems).toEqual([]);
  return d.entry;
}
const e1 = () => entry(`${EL}.r1.json`, r1Payload);
const e2 = () => entry(`${EL}.r2.json`, r2Payload());
const bySlug = (list) => new Map([[EL, list]]);

// Quiz literal bytes of a page, and a page with its literal replaced.
const literalOf = (html) => {
  const l = render.locateQuizLiteral(html);
  return html.slice(l.start, l.end);
};
const withLiteral = (html, literal) => {
  const l = render.locateQuizLiteral(html);
  return html.slice(0, l.start) + literal + html.slice(l.end);
};
// The two immutable literal anchors (see the header). A variant's literal
// must be a byte copy of the canonical one, so a regenerated literal would not
// do.
const variantBytes = read(elCfg.variants["reading-adapted"].source);
const R1_LITERAL = literalOf(read(`app/lessons/variants/lesson_${EL}__${PRFF01}.html`));
const R2_LITERAL = literalOf(variantBytes);
// Stage A (r1 current) and Stage B (r2 current) canonical sources.
const r1CurrentSource = () => withLiteral(elSource, R1_LITERAL);
const r2CurrentSource = () => withLiteral(elSource, R2_LITERAL);
// The authored variant source as it stood for pr90f... and prff01...
const r1VariantSource = () => withLiteral(variantBytes, R1_LITERAL);
const cfgAt = (id) => ({ ...elCfg, canonicalAssessmentRevisionId: id });
const stageSource = (id) => (id === R1 ? r1CurrentSource() : r2CurrentSource());
const CURRENT = elCfg.canonicalAssessmentRevisionId;
const undeclared = (cfg) => {
  const { canonicalAssessmentRevisionId: _declared, ...rest } = cfg;
  return rest;
};

describe("the real Earth's Layers r1 + r2 pair", () => {
  test("the config declares r1 (Stage A) or r2 (Stage B), and the source is exactly that stage's source", () => {
    expect([R1, R2]).toContain(CURRENT);
    expect(R.revisionsForLesson(EL).map((e) => e.assessmentRevisionId)).toEqual([R1, R2]);
    expect(elSource).toBe(stageSource(CURRENT));
    const quiz = F.extractCanonicalQuiz(elSource, EL);
    const [current, other] = CURRENT === R1 ? [r1Payload, r2Payload()] : [r2Payload(), r1Payload];
    expect(F.checkFidelity(EL, current, quiz)).toEqual([]);
    expect(F.checkFidelity(EL, other, quiz).length).toBeGreaterThan(0);
  });

  test("the two literal anchors are exactly r1 and exactly r2", () => {
    const quiz = (literal) => F.extractCanonicalQuiz(withLiteral(elSource, literal), EL);
    expect(F.checkFidelity(EL, r1Payload, quiz(R1_LITERAL))).toEqual([]);
    expect(F.checkFidelity(EL, r2Payload(), quiz(R2_LITERAL))).toEqual([]);
  });

  test("r1 is byte-unchanged (immutable baseline)", () => {
    expect(sha256(fs.readFileSync(path.join(ROOT, `platform/functions/src/scripts/assessments/${EL}.r1.json`)))).toBe("1ecb141a629aedb414190892995a6e4a4d0e8114622b56a966aac2f0c26474b3");
  });

  test("the committed r1 rendition displays exactly the quiz the r1-current canonical page displayed", () => {
    const r1Rendition = read("app/lessons/assessment-revisions/lesson_earths-layers__r1.html");
    const whileR1Current = builder.buildAllTargets(cfgAt(R1), r1CurrentSource(), bySlug([e1()]));
    expect(F.extractCanonicalQuiz(r1Rendition, EL)).toEqual(F.extractCanonicalQuiz(whileR1Current.v2.bytes, EL));
    expect(N.readDeclaration(r1Rendition).assessmentRevisionId).toBe(R1);
  });
});

describe("canonical revision declaration", () => {
  test("every committed canonical v1 and v2 artifact declares exactly its configured revision", () => {
    for (const slug of configMod.listConfiguredSlugs()) {
      const cfg = configMod.loadConfig(slug);
      const configured = cfg.canonicalAssessmentRevisionId || `assessment_${slug}__r1`;
      expect(configured).toBe(slug === EL ? CURRENT : ["water-cycle", "renewable-and-nonrenewable-resources"].includes(slug) ? `assessment_${slug}__r2` : `assessment_${slug}__r1`);
      for (const target of ["v1", "v2"]) {
        const html = read(cfg.outputs[target]);
        expect(N.readDeclaration(html)).toEqual({ schemaVersion: 1, lessonSlug: slug, assessmentRevisionId: configured });
        const block = N.declarationHtml(N.declarationFor(slug, configured));
        expect(html.indexOf(`${block}\n${N.RUNTIME_SCRIPT_TAG}`)).toBeGreaterThan(-1);
      }
    }
  });

  test("the block is exactly the closed, correctness-free schema", () => {
    const html = N.declarationHtml(N.declarationFor(EL, R1));
    expect(html).toBe('<script type="application/json" id="lyfelabz-assessment-revision">{"schemaVersion":1,"lessonSlug":"earths-layers","assessmentRevisionId":"assessment_earths-layers__r1"}</script>');
    expect(html).not.toMatch(/correct|explanation|accommodat|variant|student|assignment/i);
  });

  test("insertion is deterministic, single, and fails closed", () => {
    const page = `<head>\n${N.RUNTIME_SCRIPT_TAG}\n</head>`;
    const once = N.insertDeclaration(page, EL, R1);
    expect(N.insertDeclaration(page, EL, R1)).toBe(once);
    expect(() => N.insertDeclaration(once, EL, R1)).toThrow("already carries");
    expect(() => N.insertDeclaration("<head></head>", EL, R1)).toThrow("exactly one assessment runtime script tag");
    expect(() => N.insertDeclaration(page + page, EL, R1)).toThrow("found 2");
    expect(() => N.insertDeclaration(page, EL, "assessment_water-cycle__r1")).toThrow("cannot declare");
    expect(() => N.insertDeclaration(page, EL, "assessment_earths-layers__r0")).toThrow("cannot declare");
    const apPage = `<script type="application/json" id="${render.BINDING_ELEMENT_ID}">{}</script>\n${page}`;
    expect(() => N.insertDeclaration(apPage, EL, R1)).toThrow("binding block");
  });

  test("a malformed, extra-field, or duplicated declaration is refused when read", () => {
    const tag = (json) => `<script type="application/json" id="lyfelabz-assessment-revision">${json}</script>`;
    expect(() => N.readDeclaration(tag('{"schemaVersion":1,"lessonSlug":"earths-layers","assessmentRevisionId":"assessment_earths-layers__r1","correct":2}'))).toThrow("exactly");
    expect(() => N.readDeclaration(tag("{nope"))).toThrow("not valid JSON");
    const ok = tag('{"schemaVersion":1,"lessonSlug":"earths-layers","assessmentRevisionId":"assessment_earths-layers__r1"}');
    expect(() => N.readDeclaration(ok + ok)).toThrow("2 assessment revision declarations");
    expect(() => N.readDeclaration(ok.replace('type="application/json" ', ""))).toThrow("inert application/json");
  });

  test("a missing, malformed, or uncommitted configured revision fails the canonical build", () => {
    expect(() => builder.buildAllTargets(undeclared(elCfg), elSource, bySlug([e1(), e2()]))).toThrow("must declare canonicalAssessmentRevisionId");
    expect(() => builder.buildAllTargets(cfgAt("assessment_earths-layers__r3"), elSource, bySlug([e1(), e2()]))).toThrow("is not a committed revision");
    expect(() => builder.buildAllTargets(cfgAt("assessment_earths-layers__rx"), elSource, bySlug([e1()]))).toThrow("must be assessment_<slug>__r<N>");
    expect(() => builder.buildAllTargets(undeclared(elCfg), elSource, bySlug([]))).toThrow("no committed assessment revision");
  });

  test("the canonical build fails when the source is not faithful to the configured revision", () => {
    expect(() => builder.buildAllTargets(cfgAt(R2), r1CurrentSource(), bySlug([e1(), e2()]))).toThrow("not faithful to its configured revision earths-layers.r2.json");
    expect(() => builder.buildAllTargets(cfgAt(R1), r2CurrentSource(), bySlug([e1(), e2()]))).toThrow("not faithful to its configured revision earths-layers.r1.json");
  });

  test("retained variant bytes never carry the canonical declaration", () => {
    for (const id of [PR90F, PRFF01, PR6B7C, PR8996, PR7718]) {
      expect(N.readDeclaration(read(`app/lessons/variants/lesson_${EL}__${id}.html`))).toBeNull();
    }
  });
});

describe("revision-bound renditions (real r1 + r2)", () => {
  const built = builder.buildAllTargets(elCfg, elSource, bySlug([e1(), e2()]));

  test("the unversioned pages declare the configured current revision", () => {
    expect(N.readDeclaration(built.v1.bytes).assessmentRevisionId).toBe(CURRENT);
    expect(N.readDeclaration(built.v2.bytes).assessmentRevisionId).toBe(CURRENT);
  });

  test("Stage A and Stage B ship identical renditions and table; only the unversioned pages differ", () => {
    const stageA = builder.buildAllTargets(cfgAt(R1), r1CurrentSource(), bySlug([e1(), e2()]));
    const stageB = builder.buildAllTargets(cfgAt(R2), r2CurrentSource(), bySlug([e1(), e2()]));
    expect(stageA.renditions.map((r) => r.bytes)).toEqual(stageB.renditions.map((r) => r.bytes));
    expect(N.serializePathTable(N.buildRevisionPathTable([cfgAt(R1)], bySlug([e1(), e2()])))).toBe(
      N.serializePathTable(N.buildRevisionPathTable([cfgAt(R2)], bySlug([e1(), e2()]))),
    );
    expect(N.readDeclaration(stageA.v2.bytes).assessmentRevisionId).toBe(R1);
    expect(N.readDeclaration(stageB.v2.bytes).assessmentRevisionId).toBe(R2);
    expect(F.checkFidelity(EL, r1Payload, F.extractCanonicalQuiz(stageA.v2.bytes, EL))).toEqual([]);
    expect(F.checkFidelity(EL, r2Payload(), F.extractCanonicalQuiz(stageB.v2.bytes, EL))).toEqual([]);
  });

  test("the build is exactly the committed pages and renditions", () => {
    expect(built.v1.bytes).toBe(read(elCfg.outputs.v1));
    expect(built.v2.bytes).toBe(read(elCfg.outputs.v2));
    for (const r of built.renditions) expect(r.bytes).toBe(read(r.path));
  });

  test("one rendition per committed revision, at distinct revision paths", () => {
    expect(built.renditions.map((r) => [r.assessmentRevisionId, r.path])).toEqual([
      [R1, "app/lessons/assessment-revisions/lesson_earths-layers__r1.html"],
      [R2, "app/lessons/assessment-revisions/lesson_earths-layers__r2.html"],
    ]);
  });

  test("each rendition declares and is faithful to exactly its own payload", () => {
    for (const [r, e] of [[built.renditions[0], e1()], [built.renditions[1], e2()]]) {
      expect(N.readDeclaration(r.bytes)).toEqual({ schemaVersion: 1, lessonSlug: EL, assessmentRevisionId: e.assessmentRevisionId });
      expect(F.checkFidelity(EL, e.payload, F.extractCanonicalQuiz(r.bytes, EL))).toEqual([]);
      expect(() => N.assertQuizIs(r.bytes, EL, e)).not.toThrow();
      expect(render.readBindingBlock(r.bytes)).toBeNull();
    }
    expect(F.checkFidelity(EL, r1Payload, F.extractCanonicalQuiz(built.renditions[1].bytes, EL)).length).toBeGreaterThan(0);
  });

  test("renditions keep the current instruction and change only the quiz literal", () => {
    const strip = (html) => {
      const lit = render.locateQuizLiteral(html);
      return html.slice(0, lit.start) + html.slice(lit.end);
    };
    const [a, b] = built.renditions.map((r) => strip(r.bytes).replace(/Assessment revision: [^\n]*\n/, "").replace(/lesson_earths-layers__r\d|earths-layers__r\d/g, "X"));
    expect(a).toBe(b);
    expect(built.renditions[0].bytes).toContain("GENERATED FILE. DO NOT EDIT DIRECTLY.");
    expect(built.renditions[0].bytes).not.toMatch(/(?:href|src)="(?!\/|#|https?:|mailto:|data:)[^"]+"/);
  });

  test("the rebuild is byte-identical and independent of revision discovery order", () => {
    const again = builder.buildAllTargets(elCfg, elSource, bySlug([e2(), e1()].sort((a, b) => a.revisionOrdinal - b.revisionOrdinal)));
    expect(again.renditions.map((r) => r.bytes)).toEqual(built.renditions.map((r) => r.bytes));
    expect(again.v2.bytes).toBe(built.v2.bytes);
  });

  test("the historical r1 rendition is unchanged whichever revision is current", () => {
    for (const id of [R1, R2]) {
      const atStage = builder.buildAllTargets(cfgAt(id), stageSource(id), bySlug([e1(), e2()]));
      expect(atStage.renditions.map((r) => r.bytes)).toEqual(built.renditions.map((r) => r.bytes));
    }
  });

  test("a revision can never be rendered with another lesson's or revision's content", () => {
    const water = entry("water-cycle.r1.json", JSON.parse(read("platform/functions/src/scripts/assessments/water-cycle.r1.json")));
    expect(() => N.renderRevisionQuiz(built.v2.bytes, EL, water)).toThrow("does not belong");
    expect(() => N.assertQuizIs(built.renditions[0].bytes, EL, e2())).toThrow("is not exactly assessment_earths-layers__r2");
  });

  test("incompatible chrome (item count) and unrenderable text are refused (S9-D6)", () => {
    const short = r2Payload();
    short.items = short.items.slice(0, 9);
    expect(() => N.renderRevisionQuiz(built.v2.bytes, EL, entry(`${EL}.r2.json`, short))).toThrow("renditions require compatible chrome");
    const script = r2Payload();
    script.items[0].stem = "Close </script> here";
    expect(() => N.renderRevisionQuiz(built.v2.bytes, EL, entry(`${EL}.r2.json`, script))).toThrow("cannot be embedded");
  });

  test("a quiz literal carrying extra fields (Nature of Waves `visual`) is refused, not guessed", () => {
    const now = configMod.loadConfig("nature-of-waves");
    const v2 = read(now.outputs.v2);
    const payload = JSON.parse(read("platform/functions/src/scripts/assessments/nature-of-waves.r1.json"));
    expect(() => N.renderRevisionQuiz(v2, "nature-of-waves", entry("nature-of-waves.r1.json", payload))).toThrow("unsupported literal shape");
  });

  test("a single-revision lesson produces no rendition", () => {
    const singleCfg = configMod.loadConfig("plate-tectonics");
    const revisions = R.revisionsForLesson(singleCfg.slug);
    expect(revisions.map((r) => r.revisionOrdinal)).toEqual([1]);
    const single = builder.buildAllTargets(singleCfg, read(singleCfg.canonicalSource), new Map([[singleCfg.slug, revisions]]));
    expect(single.renditions).toEqual([]);
    expect(single.v2.bytes).toBe(read(singleCfg.outputs.v2));
    expect(single.v1.bytes).toBe(read(singleCfg.outputs.v1));
  });
});

describe("variant baseline", () => {
  const baseVariant = (() => {
    const { assessmentPresentationRevisionId: _ap, assessmentRevisionId: _rev, ...v } = elCfg.variants["reading-adapted"];
    return v;
  })();
  const withVariant = (base, extra) => ({ ...base, variants: { "reading-adapted": { ...baseVariant, ...extra } } });
  const r1Bound = (base, extra = {}) => withVariant(base, { assessmentPresentationRevisionId: AP1FED, ...extra });
  const r2Bound = (base, extra = {}) => withVariant(base, { assessmentPresentationRevisionId: AP5158, ...extra });
  const unbound = (base, extra = {}) => withVariant(base, extra);
  const buildAt = (cfg, canonicalSourceBytes, variantSourceBytes = variantBytes) =>
    variantSource.buildVariantArtifact({
      cfg,
      variantKey: "reading-adapted",
      canonicalSourceBytes,
      variantSourceBytes,
      assessmentPayloads: [e1(), e2()].map((e) => ({ name: e.file, payload: e.payload })),
    });

  test("the configured variant binds the certified r2 presentation", () => {
    expect(elCfg.variants["reading-adapted"].assessmentPresentationRevisionId).toBe(AP5158);
  });

  test.each([["Stage A (r1 current)", R1], ["Stage B (r2 current)", R2]])(
    "%s: the r2-bound variant builds to retained pr8996..., bound to r2 + ap515838...",
    (_label, current) => {
      const r = buildAt(r2Bound(cfgAt(current)), stageSource(current));
      expect(r.presentationRevisionId).toBe(PR8996);
      expect(r.assessmentBinding).toEqual({ assessmentRevisionId: R2, assessmentPresentationRevisionId: AP5158 });
      expect(r.assessmentRevisions).toEqual([`${EL}.r2.json`]);
      expect(r.assessmentRevisionBasis).toBe("assessmentPresentation");
    },
  );

  test.each([["Stage A (r1 current)", R1], ["Stage B (r2 current)", R2]])(
    "%s: the historical r1 variant source reproduces retained pr7718... (r1 + ap1fed...) byte-for-byte, and legacy provenance fails closed",
    (_label, current) => {
      const bound = buildAt(r1Bound(cfgAt(current)), stageSource(current), r1VariantSource());
      expect(bound.presentationRevisionId).toBe(PR7718);
      expect(bound.bytes).toBe(read(`app/lessons/variants/lesson_${EL}__${PR7718}.html`));
      expect(bound.assessmentBinding).toEqual({ assessmentRevisionId: R1, assessmentPresentationRevisionId: AP1FED });
      expect(bound.assessmentRevisionBasis).toBe("assessmentPresentation");
      // New bytes can never claim the pinned legacy-r1 provenance of prff01....
      expect(() => buildAt(unbound(cfgAt(current)), stageSource(current), r1VariantSource())).toThrow("is not a pinned historical legacy-r1 artifact");
    },
  );

  test("the real repository state builds exactly the retained pr8996...", () => {
    const repo = variantSource.buildVariantArtifact({
      cfg: elCfg, variantKey: "reading-adapted", canonicalSourceBytes: elSource, variantSourceBytes: variantBytes,
      assessmentPayloads: variantSource.loadAssessmentPayloads(EL),
    });
    expect(repo.presentationRevisionId).toBe(PR8996);
  });

  test("a variant cannot silently inherit or claim the wrong revision", () => {
    const src = stageSource(CURRENT);
    // The r2 presentation on the r1 variant source, and the r1 presentation on the r2 variant source.
    expect(() => buildAt(r2Bound(cfgAt(CURRENT)), src, r1VariantSource())).toThrow(/variant quiz is not exactly assessment_earths-layers__r2|script blocks are not byte-identical|variant quiz differs/);
    expect(() => buildAt(r1Bound(cfgAt(CURRENT)), src, variantBytes)).toThrow(/variant quiz is not exactly assessment_earths-layers__r1|script blocks are not byte-identical|variant quiz differs/);
    // Unbound, undeclared (legacy r1) variant whose quiz is r2.
    expect(() => buildAt(unbound(cfgAt(CURRENT)), src, variantBytes)).toThrow(/variant quiz is not exactly assessment_earths-layers__r1|script blocks are not byte-identical|not a pinned historical legacy-r1 artifact/);
    // A declaration that disagrees with the bound presentation, or is not committed.
    expect(() => buildAt(r1Bound(cfgAt(CURRENT), { assessmentRevisionId: R2 }), src, r1VariantSource())).toThrow("maps to assessment_earths-layers__r1");
    expect(() => buildAt(r2Bound(cfgAt(CURRENT), { assessmentRevisionId: R1 }), src)).toThrow("maps to assessment_earths-layers__r2");
    expect(() => buildAt(unbound(cfgAt(CURRENT), { assessmentRevisionId: "assessment_earths-layers__r3" }), src)).toThrow("is not a committed revision");
  });

  // Owner ruling S9-D7 (9B closure): variant revision provenance.
  describe("variant revision provenance (S9-D7)", () => {
    const src = () => stageSource(CURRENT);

    test("the pinned legacy-r1 list is exactly the historical prff01... artifact", () => {
      expect(variantSource.LEGACY_R1_UNBOUND_REVISIONS).toEqual([PRFF01]);
    });

    test("AP-bound provenance comes from the certified presentation record, and an agreeing declaration is accepted", () => {
      for (const cfg of [r2Bound(cfgAt(CURRENT)), r2Bound(cfgAt(CURRENT), { assessmentRevisionId: R2 })]) {
        const r = buildAt(cfg, src());
        expect(r.assessmentRevisionBasis).toBe("assessmentPresentation");
        expect(r.presentationRevisionId).toBe(PR8996);
      }
      const r1 = buildAt(r1Bound(cfgAt(CURRENT), { assessmentRevisionId: R1 }), src(), r1VariantSource());
      expect(r1.assessmentBinding).toEqual({ assessmentRevisionId: R1, assessmentPresentationRevisionId: AP1FED });
      expect(r1.presentationRevisionId).toBe(PR7718);
    });

    test("an explicit variant assessmentRevisionId supplies provenance for a new unbound variant", () => {
      const r1 = buildAt(unbound(cfgAt(CURRENT), { assessmentRevisionId: R1 }), src(), r1VariantSource());
      expect(r1.assessmentRevisionBasis).toBe("declared");
      expect(r1.assessmentRevisions).toEqual([`${EL}.r1.json`]);
      expect(N.readDeclaration(r1.bytes)).toBeNull();
      const r2 = buildAt(unbound(cfgAt(CURRENT), { assessmentRevisionId: R2 }), src(), variantBytes);
      expect(r2.assessmentRevisionBasis).toBe("declared");
      expect(r2.assessmentRevisions).toEqual([`${EL}.r2.json`]);
      expect(F.checkFidelity(EL, e2().payload, F.extractCanonicalQuiz(r2.bytes, EL))).toEqual([]);
      expect(N.readDeclaration(r2.bytes)).toBeNull();
    });

    test("a newly authored unbound variant without explicit provenance never silently receives r1", () => {
      // An unbound variant whose bytes are not the pinned historical artifact
      // (here: the unadapted canonical source as a new variant).
      expect(() => buildAt(unbound(cfgAt(R1)), r1CurrentSource(), r1CurrentSource())).toThrow("is not a pinned historical legacy-r1 artifact");
      expect(() => buildAt(unbound(cfgAt(R2)), r2CurrentSource(), r2CurrentSource())).toThrow(/not exactly assessment_earths-layers__r1|not a pinned historical legacy-r1 artifact/);
    });

    test("conflicting or unknown provenance fails closed", () => {
      expect(() => buildAt(r1Bound(cfgAt(CURRENT), { assessmentRevisionId: R2 }), src(), r1VariantSource())).toThrow("maps to assessment_earths-layers__r1");
      expect(() => buildAt(unbound(cfgAt(CURRENT), { assessmentRevisionId: "assessment_earths-layers__r9" }), src())).toThrow("is not a committed revision");
      expect(() => buildAt(unbound(cfgAt(CURRENT), { assessmentRevisionId: R1 }), src(), variantBytes)).toThrow();
    });
  });

  test("the variant config refuses a malformed or foreign variant revision", () => {
    const withRev = (id) => ({ ...elCfg, variants: { "reading-adapted": { ...elCfg.variants["reading-adapted"], assessmentRevisionId: id } } });
    expect(() => configMod.validateConfigShape(withRev(R2), EL)).not.toThrow();
    expect(() => configMod.validateConfigShape(withRev("assessment_water-cycle__r1"), EL)).toThrow("must be assessment_earths-layers__r<N>");
    expect(() => configMod.validateConfigShape(withRev("r1"), EL)).toThrow("must be assessment_earths-layers__r<N>");
  });

  test("variants:verify finds pr8996... as the retained current build; the manifest only appended it", () => {
    const res = variantSource.checkAuthoredVariants();
    expect(res.failures).toEqual([]);
    // Other lessons may declare retained variants too; every one must be retained.
    expect(res.checked.every((c) => c.retained)).toBe(true);
    expect(res.checked.filter((c) => c.label.startsWith(`${EL}/`))).toEqual([{ label: `${EL}/reading-adapted`, presentationRevisionId: PR8996, retained: true }]);
    const manifest = JSON.parse(read("app/lessons/variants/manifest.json"));
    // Append-only: the original Earth's Layers history stays the manifest
    // prefix, and the Quiz Results Polish successors (r2, then r1) were
    // appended after it.
    expect(manifest.slice(0, 3).map((e) => e.presentationRevisionId)).toEqual([PRFF01, PR90F, PR6B7C]);
    expect(manifest.filter((e) => e.lessonSlug === EL).map((e) => e.presentationRevisionId)).toEqual([PRFF01, PR90F, PR6B7C, PR8996, PR7718]);
    expect(manifest.find((e) => e.presentationRevisionId === PR8996)).toMatchObject({ assessmentRevisionId: R2, assessmentPresentationRevisionId: AP5158 });
    expect(manifest.find((e) => e.presentationRevisionId === PR7718)).toMatchObject({ assessmentRevisionId: R1, assessmentPresentationRevisionId: AP1FED });
    expect(manifest[2]).toMatchObject({ assessmentRevisionId: R2, assessmentPresentationRevisionId: AP5158 });
    expect(manifest[1]).toMatchObject({ assessmentRevisionId: R1, assessmentPresentationRevisionId: AP1FED });
    expect(manifest[0].assessmentRevisionId).toBeUndefined();
  });
});

describe("protected historical bytes", () => {
  test("retained variant artifacts still hash to their presentation revision ids", () => {
    for (const id of [PR90F, PRFF01, PR6B7C, PR8996, PR7718]) {
      expect(`pr${sha256(fs.readFileSync(path.join(ROOT, `app/lessons/variants/lesson_${EL}__${id}.html`)))}`).toBe(id);
    }
  });

  test("the ap1fed... record and its review record are byte-unchanged", () => {
    expect(sha256(fs.readFileSync(path.join(ROOT, `platform/functions/src/scripts/assessment-presentations/${AP1FED}.json`)))).toBe("c64210977f2f892a2950d64b97cb879f6c10402317ab7739684e6ed0be5d1117");
    expect(sha256(fs.readFileSync(path.join(ROOT, `lesson-sources/variants/reviews/${AP1FED}.json`)))).toBe("4670e1994b8b2185cde248028017158e913988dabd7bc88bb8fd63deb83675a6");
  });
});

describe("revision-to-path table", () => {
  test("the committed table is the deterministic build of today's repository", () => {
    const a = N.serializePathTable(builder.buildPathTable());
    const b = N.serializePathTable(builder.buildPathTable());
    expect(a).toBe(b);
    expect(read(N.PATH_TABLE_FILE)).toBe(a);
    // F5.3 Slice 9D: the client bundles a byte-identical copy.
    expect(read(N.CLIENT_PATH_TABLE_FILE)).toBe(a);
  });

  test("single-revision lessons use unversioned pages; Earth's Layers, Water Cycle, and Renewable Resources use r1 and r2 renditions", () => {
    const table = builder.buildPathTable();
    expect(Object.keys(table.lessons)).toEqual(configMod.listConfiguredSlugs());
    for (const slug of configMod.listConfiguredSlugs().filter((s) => s !== EL && s !== "water-cycle" && s !== "renewable-and-nonrenewable-resources")) {
      expect(table.lessons[slug]).toEqual({ [`assessment_${slug}__r1`]: `/app/lessons/lesson_${slug}.html` });
    }
    expect(table.lessons[EL]).toEqual({
      [R1]: "/app/lessons/assessment-revisions/lesson_earths-layers__r1.html",
      [R2]: "/app/lessons/assessment-revisions/lesson_earths-layers__r2.html",
    });
    expect(table.lessons["water-cycle"]).toEqual({
      "assessment_water-cycle__r1": "/app/lessons/assessment-revisions/lesson_water-cycle__r1.html",
      "assessment_water-cycle__r2": "/app/lessons/assessment-revisions/lesson_water-cycle__r2.html",
    });
    // No multi-revision entry points at the unversioned (current) page.
    for (const slug of [EL, "water-cycle", "renewable-and-nonrenewable-resources"]) {
      expect(Object.values(table.lessons[slug])).not.toContain(`/app/lessons/lesson_${slug}.html`);
    }
    expect(N.renditionPathsInTable(table)).toEqual([
      "app/lessons/assessment-revisions/lesson_earths-layers__r1.html",
      "app/lessons/assessment-revisions/lesson_earths-layers__r2.html",
      "app/lessons/assessment-revisions/lesson_renewable-and-nonrenewable-resources__r1.html",
      "app/lessons/assessment-revisions/lesson_renewable-and-nonrenewable-resources__r2.html",
      "app/lessons/assessment-revisions/lesson_water-cycle__r1.html",
      "app/lessons/assessment-revisions/lesson_water-cycle__r2.html",
    ]);
    expect(JSON.stringify(table)).not.toMatch(/correct|explanation|accommodat|variant/i);
  });

  test("a synthetic multi-revision lesson maps each revision to its own rendition", () => {
    const configs = [cfgAt(R2), configMod.loadConfig("water-cycle")];
    const map = new Map([[EL, [e2(), e1()].sort((a, b) => a.revisionOrdinal - b.revisionOrdinal)], ["water-cycle", R.revisionsForLesson("water-cycle")]]);
    const table = N.buildRevisionPathTable([...configs].reverse(), map);
    expect(N.serializePathTable(table)).toBe(N.serializePathTable(N.buildRevisionPathTable(configs, map)));
    expect(N.resolveRevisionPath(table, EL, R1)).toBe("/app/lessons/assessment-revisions/lesson_earths-layers__r1.html");
    expect(N.resolveRevisionPath(table, EL, R2)).toBe("/app/lessons/assessment-revisions/lesson_earths-layers__r2.html");
    expect(N.resolveRevisionPath(table, "water-cycle", "assessment_water-cycle__r1")).toBe("/app/lessons/assessment-revisions/lesson_water-cycle__r1.html");
    expect(N.resolveRevisionPath(table, "water-cycle", "assessment_water-cycle__r2")).toBe("/app/lessons/assessment-revisions/lesson_water-cycle__r2.html");
    expect(N.renditionPathsInTable(table)).toEqual([
      "app/lessons/assessment-revisions/lesson_earths-layers__r1.html",
      "app/lessons/assessment-revisions/lesson_earths-layers__r2.html",
      "app/lessons/assessment-revisions/lesson_water-cycle__r1.html",
      "app/lessons/assessment-revisions/lesson_water-cycle__r2.html",
    ]);
  });

  test("an unknown revision or lesson has no path and no current fallback", () => {
    const table = builder.buildPathTable();
    expect(N.resolveRevisionPath(table, EL, R1)).toBe("/app/lessons/assessment-revisions/lesson_earths-layers__r1.html");
    expect(N.resolveRevisionPath(table, EL, R2)).toBe("/app/lessons/assessment-revisions/lesson_earths-layers__r2.html");
    expect(N.resolveRevisionPath(table, EL, "assessment_earths-layers__r3")).toBeNull();
    expect(N.resolveRevisionPath(table, EL, "assessment_earths-layers__r01")).toBeNull();
    expect(N.resolveRevisionPath(table, "unknown-lesson", "assessment_unknown-lesson__r1")).toBeNull();
    expect(N.resolveRevisionPath(table, EL, "")).toBeNull();
    expect(N.resolveRevisionPath({ ...table, kind: "other" }, EL, R1)).toBeNull();
  });

  test("an ambiguous multi-revision lesson cannot enter the table", () => {
    expect(() => N.buildRevisionPathTable([undeclared(elCfg)], bySlug([e1(), e2()]))).toThrow("must declare canonicalAssessmentRevisionId");
  });

  test("the rendition tree holds the table and exactly the Earth's Layers, Water Cycle, and Renewable Resources r1 and r2 renditions", () => {
    expect(builder.verifyRenditionTree()).toMatchObject({ renditions: 6 });
    expect(fs.readdirSync(paths.RENDITION_OUTPUT_ROOT).sort()).toEqual([
      "lesson_earths-layers__r1.html",
      "lesson_earths-layers__r2.html",
      "lesson_renewable-and-nonrenewable-resources__r1.html",
      "lesson_renewable-and-nonrenewable-resources__r2.html",
      "lesson_water-cycle__r1.html",
      "lesson_water-cycle__r2.html",
      "revision-paths.json",
    ]);
  });
});
