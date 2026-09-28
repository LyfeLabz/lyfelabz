/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * F5.3 Slice 9B - canonical revision declarations, revision-bound renditions,
 * the variant baseline, and the revision-to-path table.
 *
 * Multi-revision behavior is proven with a SYNTHETIC Earth's Layers r2 held
 * in memory (no payload, source, config, or artifact is written). The
 * synthetic "current r2" source is the real canonical source with only its
 * quiz literal replaced by r2's literal, as a real r2 authoring pass would
 * leave it.
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
const AP1FED = "ap1fed478c9e4ad8335946ff7f7b165df657bafc48e8c5990d922419581fa02c25";
const R1 = "assessment_earths-layers__r1";
const R2 = "assessment_earths-layers__r2";

const sha256 = (b) => crypto.createHash("sha256").update(b).digest("hex");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const elCfg = configMod.loadConfig(EL);
const elSource = read(elCfg.canonicalSource);
const r1Payload = JSON.parse(read(`platform/functions/src/scripts/assessments/${EL}.r1.json`));

// A synthetic r2 whose correct answers moved, so its quiz genuinely differs.
function r2Payload() {
  const p = JSON.parse(JSON.stringify(r1Payload));
  p.revisionOrdinal = 2;
  p.publishedBy = "slice-9b-synthetic-fixture";
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
  const d = R.describeRevision(file, payload);
  expect(d.problems).toEqual([]);
  return d.entry;
}
const e1 = () => entry(`${EL}.r1.json`, r1Payload);
const e2 = () => entry(`${EL}.r2.json`, r2Payload());
const bySlug = (list) => new Map([[EL, list]]);

// The canonical source after a (synthetic) r2 authoring pass.
function sourceAt(e) {
  const literal = render.locateQuizLiteral(elSource);
  return elSource.slice(0, literal.start) + render.literalSource(N.questionsForPayload(EL, e.payload)) + elSource.slice(literal.end);
}
const cfgAt = (id) => ({ ...elCfg, canonicalAssessmentRevisionId: id });

describe("canonical revision declaration", () => {
  test("every committed canonical v1 and v2 artifact declares exactly its configured revision", () => {
    for (const slug of configMod.listConfiguredSlugs()) {
      const cfg = configMod.loadConfig(slug);
      for (const target of ["v1", "v2"]) {
        const html = read(cfg.outputs[target]);
        expect(N.readDeclaration(html)).toEqual({ schemaVersion: 1, lessonSlug: slug, assessmentRevisionId: `assessment_${slug}__r1` });
        const block = N.declarationHtml(N.declarationFor(slug, `assessment_${slug}__r1`));
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
    expect(() => builder.buildAllTargets(elCfg, elSource, bySlug([e1(), e2()]))).toThrow("must declare canonicalAssessmentRevisionId");
    expect(() => builder.buildAllTargets(cfgAt("assessment_earths-layers__r3"), elSource, bySlug([e1(), e2()]))).toThrow("is not a committed revision");
    expect(() => builder.buildAllTargets(cfgAt("assessment_earths-layers__rx"), elSource, bySlug([e1()]))).toThrow("must be assessment_<slug>__r<N>");
    expect(() => builder.buildAllTargets(elCfg, elSource, bySlug([]))).toThrow("no committed assessment revision");
  });

  test("the canonical build fails when the source is not faithful to the configured revision", () => {
    expect(() => builder.buildAllTargets(cfgAt(R2), elSource, bySlug([e1(), e2()]))).toThrow("not faithful to its configured revision earths-layers.r2.json");
    expect(() => builder.buildAllTargets(cfgAt(R1), sourceAt(e2()), bySlug([e1(), e2()]))).toThrow("not faithful to its configured revision earths-layers.r1.json");
  });

  test("retained variant bytes never carry the canonical declaration", () => {
    for (const id of [PR90F, PRFF01]) {
      expect(N.readDeclaration(read(`app/lessons/variants/lesson_${EL}__${id}.html`))).toBeNull();
    }
  });
});

describe("revision-bound renditions (synthetic r1 + r2)", () => {
  const built = builder.buildAllTargets(cfgAt(R2), sourceAt(e2()), bySlug([e1(), e2()]));

  test("the unversioned pages declare the configured current revision", () => {
    expect(N.readDeclaration(built.v1.bytes).assessmentRevisionId).toBe(R2);
    expect(N.readDeclaration(built.v2.bytes).assessmentRevisionId).toBe(R2);
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
    const again = builder.buildAllTargets(cfgAt(R2), sourceAt(e2()), bySlug([e1(), e2()]));
    expect(again.renditions.map((r) => r.bytes)).toEqual(built.renditions.map((r) => r.bytes));
    expect(again.v2.bytes).toBe(built.v2.bytes);
  });

  test("the historical r1 rendition is unchanged whichever revision is current", () => {
    const whileR1Current = builder.buildAllTargets(cfgAt(R1), elSource, bySlug([e1(), e2()]));
    expect(whileR1Current.renditions.map((r) => r.bytes)).toEqual(built.renditions.map((r) => r.bytes));
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
    const single = builder.buildAllTargets(elCfg, elSource, bySlug([e1()]));
    expect(single.renditions).toEqual([]);
    expect(single.v2.bytes).toBe(read(elCfg.outputs.v2));
    expect(single.v1.bytes).toBe(read(elCfg.outputs.v1));
  });
});

describe("variant baseline", () => {
  const variantBytes = read(elCfg.variants["reading-adapted"].source);
  const unbound = (cfg, extra = {}) => {
    const { assessmentPresentationRevisionId: _ap, ...v } = cfg.variants["reading-adapted"];
    return { ...cfg, variants: { "reading-adapted": { ...v, ...extra } } };
  };
  const buildAt = (cfg, canonicalSourceBytes, variantSourceBytes = variantBytes) =>
    variantSource.buildVariantArtifact({
      cfg,
      variantKey: "reading-adapted",
      canonicalSourceBytes,
      variantSourceBytes,
      assessmentPayloads: [e1(), e2()].map((e) => ({ name: e.file, payload: e.payload })),
    });

  test("the AP-bound r1 variant still reproduces pr90f... after the current revision advances to r2", () => {
    const r = buildAt(cfgAt(R2), sourceAt(e2()));
    expect(r.presentationRevisionId).toBe(PR90F);
    expect(r.assessmentBinding).toEqual({ assessmentRevisionId: R1, assessmentPresentationRevisionId: AP1FED });
    expect(r.assessmentRevisions).toEqual([`${EL}.r1.json`]);
  });

  test("the legacy unbound variant stays tied to r1 and reproduces prff01...", () => {
    const r = buildAt(unbound(cfgAt(R2)), sourceAt(e2()));
    expect(r.presentationRevisionId).toBe(PRFF01);
    expect(r.assessmentRevisions).toEqual([`${EL}.r1.json`]);
  });

  test("today (r1 current) both retained revisions reproduce unchanged", () => {
    const repo = (cfg) => variantSource.buildVariantArtifact({
      cfg, variantKey: "reading-adapted", canonicalSourceBytes: elSource, variantSourceBytes: variantBytes,
      assessmentPayloads: variantSource.loadAssessmentPayloads(EL),
    });
    expect(repo(elCfg).presentationRevisionId).toBe(PR90F);
    expect(repo(unbound(elCfg)).presentationRevisionId).toBe(PRFF01);
  });

  test("a variant cannot silently inherit the wrong revision", () => {
    // Unbound variant declared r2 but still carrying the r1 quiz: its quiz
    // script differs from the r2 baseline.
    expect(() => buildAt(unbound(cfgAt(R2), { assessmentRevisionId: R2 }), sourceAt(e2()))).toThrow(/script blocks are not byte-identical|variant quiz differs|not faithful to earths-layers.r2.json/);
    // Unbound, undeclared (legacy r1) variant whose quiz was moved to r2.
    const variantAtR2 = (() => {
      const lit = render.locateQuizLiteral(variantBytes);
      return variantBytes.slice(0, lit.start) + render.literalSource(N.questionsForPayload(EL, e2().payload)) + variantBytes.slice(lit.end);
    })();
    expect(() => buildAt(unbound(cfgAt(R2)), sourceAt(e2()), variantAtR2)).toThrow("variant quiz is not exactly assessment_earths-layers__r1");
    // A declaration that disagrees with the bound presentation, or is not committed.
    expect(() => buildAt({ ...cfgAt(R2), variants: { "reading-adapted": { ...elCfg.variants["reading-adapted"], assessmentRevisionId: R2 } } }, sourceAt(e2()))).toThrow("maps to assessment_earths-layers__r1");
    expect(() => buildAt(unbound(cfgAt(R2), { assessmentRevisionId: "assessment_earths-layers__r3" }), sourceAt(e2()))).toThrow("is not a committed revision");
  });

  // Owner ruling S9-D7 (9B closure): variant revision provenance.
  describe("variant revision provenance (S9-D7)", () => {
    const variantAtR2 = () => {
      const lit = render.locateQuizLiteral(variantBytes);
      return variantBytes.slice(0, lit.start) + render.literalSource(N.questionsForPayload(EL, e2().payload)) + variantBytes.slice(lit.end);
    };

    test("the pinned legacy-r1 list is exactly the historical prff01... artifact", () => {
      expect(variantSource.LEGACY_R1_UNBOUND_REVISIONS).toEqual([PRFF01]);
    });

    test("AP-bound provenance comes from the certified presentation record, and an agreeing declaration is accepted", () => {
      const agreeing = { ...cfgAt(R2), variants: { "reading-adapted": { ...elCfg.variants["reading-adapted"], assessmentRevisionId: R1 } } };
      for (const cfg of [cfgAt(R2), agreeing]) {
        const r = buildAt(cfg, sourceAt(e2()));
        expect(r.assessmentRevisionBasis).toBe("assessmentPresentation");
        expect(r.presentationRevisionId).toBe(PR90F);
      }
    });

    test("historical prff01... is valid only through the pinned legacy-r1 path", () => {
      const r = buildAt(unbound(cfgAt(R2)), sourceAt(e2()));
      expect(r.assessmentRevisionBasis).toBe("legacy-r1");
      expect(r.presentationRevisionId).toBe(PRFF01);
    });

    test("an explicit variant assessmentRevisionId supplies provenance for a new unbound variant", () => {
      const r1 = buildAt(unbound(cfgAt(R2), { assessmentRevisionId: R1 }), sourceAt(e2()));
      expect(r1.assessmentRevisionBasis).toBe("declared");
      expect(r1.assessmentRevisions).toEqual([`${EL}.r1.json`]);
      expect(N.readDeclaration(r1.bytes)).toBeNull();
      const r2 = buildAt(unbound(cfgAt(R2), { assessmentRevisionId: R2 }), sourceAt(e2()), variantAtR2());
      expect(r2.assessmentRevisionBasis).toBe("declared");
      expect(r2.assessmentRevisions).toEqual([`${EL}.r2.json`]);
      expect(F.checkFidelity(EL, e2().payload, F.extractCanonicalQuiz(r2.bytes, EL))).toEqual([]);
      expect(N.readDeclaration(r2.bytes)).toBeNull();
    });

    test("a newly authored unbound variant without explicit provenance never silently receives r1", () => {
      // An unbound variant whose bytes are not the pinned historical artifact
      // (here: the unadapted canonical source as a new variant).
      expect(() => buildAt(unbound(cfgAt(R1)), elSource, elSource)).toThrow("is not a pinned historical legacy-r1 artifact");
      expect(() => buildAt(unbound(cfgAt(R2)), sourceAt(e2()), sourceAt(e2()))).toThrow(/not exactly assessment_earths-layers__r1|not a pinned historical legacy-r1 artifact/);
    });

    test("conflicting or unknown provenance fails closed", () => {
      const conflicting = { ...cfgAt(R2), variants: { "reading-adapted": { ...elCfg.variants["reading-adapted"], assessmentRevisionId: R2 } } };
      expect(() => buildAt(conflicting, sourceAt(e2()))).toThrow("maps to assessment_earths-layers__r1");
      expect(() => buildAt(unbound(cfgAt(R2), { assessmentRevisionId: "assessment_earths-layers__r9" }), sourceAt(e2()))).toThrow("is not a committed revision");
      expect(() => buildAt(unbound(cfgAt(R2), { assessmentRevisionId: R2 }), sourceAt(e2()))).toThrow();
    });
  });

  test("the variant config refuses a malformed or foreign variant revision", () => {
    const withRev = (id) => ({ ...elCfg, variants: { "reading-adapted": { ...elCfg.variants["reading-adapted"], assessmentRevisionId: id } } });
    expect(() => configMod.validateConfigShape(withRev(R1), EL)).not.toThrow();
    expect(() => configMod.validateConfigShape(withRev("assessment_water-cycle__r1"), EL)).toThrow("must be assessment_earths-layers__r<N>");
    expect(() => configMod.validateConfigShape(withRev("r1"), EL)).toThrow("must be assessment_earths-layers__r<N>");
  });

  test("variants:verify still finds pr90f... as the retained build with no new manifest entry", () => {
    const res = variantSource.checkAuthoredVariants();
    expect(res.failures).toEqual([]);
    expect(res.checked).toEqual([{ label: `${EL}/reading-adapted`, presentationRevisionId: PR90F, retained: true }]);
    const manifest = JSON.parse(read("app/lessons/variants/manifest.json"));
    expect(manifest.map((e) => e.presentationRevisionId)).toEqual([PRFF01, PR90F]);
  });
});

describe("protected historical bytes", () => {
  test("retained variant artifacts still hash to their presentation revision ids", () => {
    for (const id of [PR90F, PRFF01]) {
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

  test("every single-revision lesson maps r1 to its unversioned v2 page", () => {
    const table = builder.buildPathTable();
    expect(Object.keys(table.lessons)).toEqual(configMod.listConfiguredSlugs());
    for (const slug of configMod.listConfiguredSlugs()) {
      expect(table.lessons[slug]).toEqual({ [`assessment_${slug}__r1`]: `/app/lessons/lesson_${slug}.html` });
    }
    expect(N.renditionPathsInTable(table)).toEqual([]);
    expect(JSON.stringify(table)).not.toMatch(/correct|explanation|accommodat|variant/i);
  });

  test("a synthetic multi-revision lesson maps each revision to its own rendition", () => {
    const configs = [cfgAt(R2), configMod.loadConfig("water-cycle")];
    const map = new Map([[EL, [e2(), e1()].sort((a, b) => a.revisionOrdinal - b.revisionOrdinal)], ["water-cycle", R.revisionsForLesson("water-cycle")]]);
    const table = N.buildRevisionPathTable([...configs].reverse(), map);
    expect(N.serializePathTable(table)).toBe(N.serializePathTable(N.buildRevisionPathTable(configs, map)));
    expect(N.resolveRevisionPath(table, EL, R1)).toBe("/app/lessons/assessment-revisions/lesson_earths-layers__r1.html");
    expect(N.resolveRevisionPath(table, EL, R2)).toBe("/app/lessons/assessment-revisions/lesson_earths-layers__r2.html");
    expect(N.resolveRevisionPath(table, "water-cycle", "assessment_water-cycle__r1")).toBe("/app/lessons/lesson_water-cycle.html");
    expect(N.renditionPathsInTable(table)).toEqual([
      "app/lessons/assessment-revisions/lesson_earths-layers__r1.html",
      "app/lessons/assessment-revisions/lesson_earths-layers__r2.html",
    ]);
  });

  test("an unknown revision or lesson has no path and no current fallback", () => {
    const table = builder.buildPathTable();
    expect(N.resolveRevisionPath(table, EL, R2)).toBeNull();
    expect(N.resolveRevisionPath(table, EL, "assessment_earths-layers__r01")).toBeNull();
    expect(N.resolveRevisionPath(table, "unknown-lesson", "assessment_unknown-lesson__r1")).toBeNull();
    expect(N.resolveRevisionPath(table, EL, "")).toBeNull();
    expect(N.resolveRevisionPath({ ...table, kind: "other" }, EL, R1)).toBeNull();
  });

  test("an ambiguous multi-revision lesson cannot enter the table", () => {
    expect(() => N.buildRevisionPathTable([elCfg], bySlug([e1(), e2()]))).toThrow("must declare canonicalAssessmentRevisionId");
  });

  test("the rendition tree holds only the table today", () => {
    expect(builder.verifyRenditionTree()).toMatchObject({ renditions: 0 });
    expect(fs.readdirSync(paths.RENDITION_OUTPUT_ROOT)).toEqual(["revision-paths.json"]);
  });
});
