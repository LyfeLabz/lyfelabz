/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

/*
 * F5.3 Slice 9C-2 - assessment-revision provenance of a retained variant for
 * publication (S9-D7). Real retained Earth's Layers artifacts prove the
 * certified paths; a temporary repository holding a SYNTHETIC committed r2
 * (payload + revision-path table) proves the multi-revision paths. Nothing is
 * written to the repository.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const P = require("../variantPublicationProvenance.cjs");
const manifestMod = require("../variantManifest.cjs");
const N = require("../assessmentRenditions.cjs");
const render = require("../assessmentPresentationRender.cjs");
const paths = require("../paths.cjs");
const { sha256Hex } = require("../hash.cjs");

const ROOT = paths.REPO_ROOT;
const EL = "earths-layers";
const R1 = `assessment_${EL}__r1`;
const R2 = `assessment_${EL}__r2`;
const PR90F = "pr90f52136d39f36d21bf1602d0af3901adf0eae32a046c522907c5e932f342189";
const PRFF01 = "prff01d9d2cf71210c491afc60cf98cd3d69b91d5c64cae51aff2463b50892375c";
const AP1FED = "ap1fed478c9e4ad8335946ff7f7b165df657bafc48e8c5990d922419581fa02c25";

const manifest = manifestMod.readManifest();
const entryOf = (pr) => manifest.find((e) => e.presentationRevisionId === pr);
const bytesOf = (pr) => fs.readFileSync(path.join(ROOT, entryOf(pr).path));
const r1Payload = JSON.parse(fs.readFileSync(path.join(ROOT, "platform/functions/src/scripts/assessments/earths-layers.r1.json"), "utf8"));

// A self-consistent manifest entry for arbitrary bytes (path/id/sha agree).
function newEntry(bytes, extra = {}, slug = EL) {
  const sha = sha256Hex(bytes);
  return {
    lessonSlug: slug,
    variantKey: "reading-adapted",
    presentationRevisionId: `pr${sha}`,
    path: `app/lessons/variants/lesson_${slug}__pr${sha}.html`,
    sha256: sha,
    publishedAt: "2026-09-28T00:00:00.000Z",
    ...extra,
  };
}

function r2Payload() {
  const p = JSON.parse(JSON.stringify(r1Payload));
  p.revisionOrdinal = 2;
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

function withQuiz(bytes, payload) {
  const html = bytes.toString("utf8");
  const lit = render.locateQuizLiteral(html);
  return html.slice(0, lit.start) + render.literalSource(N.questionsForPayload(EL, payload)) + html.slice(lit.end);
}

// Temporary repository: Earth's Layers r1 + a synthetic r2, the certified AP
// record and review, and a revision-path table naming the given revisions.
function tempRepo({ withR2 = true, tableRevisions = [R1, R2] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "slice9c2-"));
  const copy = (rel) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.copyFileSync(path.join(ROOT, rel), path.join(root, rel));
  };
  copy("platform/functions/src/scripts/assessments/earths-layers.r1.json");
  copy(`platform/functions/src/scripts/assessment-presentations/${AP1FED}.json`);
  copy(`lesson-sources/variants/reviews/${AP1FED}.json`);
  if (withR2) {
    fs.writeFileSync(path.join(root, "platform/functions/src/scripts/assessments/earths-layers.r2.json"), JSON.stringify(r2Payload(), null, 2) + "\n");
  }
  const lessons = { [EL]: Object.fromEntries(tableRevisions.map((id) => [id, `/app/lessons/assessment-revisions/lesson_${EL}__r${id.slice(-1)}.html`])) };
  fs.mkdirSync(path.join(root, N.RENDITION_DIR), { recursive: true });
  fs.writeFileSync(path.join(root, N.PATH_TABLE_FILE), N.serializePathTable({ schemaVersion: 1, kind: N.PATH_TABLE_KIND, lessons }));
  return root;
}
const cleanup = [];
afterAll(() => cleanup.forEach((r) => fs.rmSync(r, { recursive: true, force: true })));
const repo = (opts) => {
  const r = tempRepo(opts);
  cleanup.push(r);
  return r;
};

describe("certified Earth's Layers artifacts (real repository)", () => {
  test("pr90f... covers r1, provenance from the certified ap1fed... record", () => {
    expect(P.resolvePublicationProvenance({ entry: entryOf(PR90F), artifactBytes: bytesOf(PR90F) })).toEqual({
      ok: true,
      assessmentRevisionId: R1,
      source: "assessmentPresentation",
    });
  });

  test("historical prff01... covers r1 only through the pinned legacy-r1 rule", () => {
    expect(entryOf(PRFF01).assessmentRevisionId).toBeUndefined();
    expect(P.resolvePublicationProvenance({ entry: entryOf(PRFF01), artifactBytes: bytesOf(PRFF01) })).toEqual({
      ok: true,
      assessmentRevisionId: R1,
      source: "legacyR1",
    });
    expect(manifestMod.LEGACY_R1_UNBOUND_REVISIONS).toEqual([PRFF01]);
  });

  test("a NON-pinned revisionless unbound artifact is refused (no opt-in to the exception)", () => {
    const bytes = Buffer.from(bytesOf(PRFF01).toString("utf8") + "\n<!-- another build -->");
    const res = P.resolvePublicationProvenance({ entry: newEntry(bytes), artifactBytes: bytes });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("not a pinned historical legacy-r1 artifact");
  });

  test("an explicit unbound r1 declaration is accepted with no HTML revision declaration in the variant", () => {
    const bytes = Buffer.from(bytesOf(PRFF01).toString("utf8") + "\n<!-- new unbound build -->");
    expect(N.readDeclaration(bytes.toString("utf8"))).toBeNull();
    expect(P.resolvePublicationProvenance({ entry: newEntry(bytes, { assessmentRevisionId: R1 }), artifactBytes: bytes })).toEqual({
      ok: true,
      assessmentRevisionId: R1,
      source: "declared",
    });
  });

  test("AP/manifest disagreement is refused", () => {
    const res = P.resolvePublicationProvenance({ entry: { ...entryOf(PR90F), assessmentRevisionId: R2 }, artifactBytes: bytesOf(PR90F) });
    expect(res.ok).toBe(false);
    expect(res.error).toContain(`records ${R2} but its assessment presentation maps to ${R1}`);
  });

  test("an AP of another lesson, or an unretained (content-address mismatch) AP, is refused", () => {
    const bytes = bytesOf(PR90F);
    const foreign = newEntry(bytes, { assessmentRevisionId: "assessment_water-cycle__r1", assessmentPresentationRevisionId: AP1FED }, "water-cycle");
    expect(P.resolvePublicationProvenance({ entry: foreign, artifactBytes: bytes }).error).toContain('belongs to lesson "earths-layers"');
    const unretained = { ...entryOf(PR90F), assessmentPresentationRevisionId: `ap${"0".repeat(64)}` };
    expect(P.resolvePublicationProvenance({ entry: unretained, artifactBytes: bytes }).error).toContain("is not retained");
  });

  test("an AP-bound artifact whose rendered quiz differs from the certified rendering is refused", () => {
    const tampered = Buffer.from(bytesOf(PR90F).toString("utf8").replace(/(q: ")([^"])/, "$1X$2"));
    const res = P.resolvePublicationProvenance({ entry: entryOf(PR90F), artifactBytes: tampered });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("is not the rendering of");
  });

  test("an unbound entry whose artifact carries an assessment-presentation block is refused", () => {
    const bytes = bytesOf(PR90F);
    const res = P.resolvePublicationProvenance({ entry: newEntry(bytes, { assessmentRevisionId: R1 }), artifactBytes: bytes });
    expect(res.error).toContain("carries an assessment-presentation binding block");
  });

  test("a revision that is not committed, or of another lesson, is refused", () => {
    const bytes = Buffer.from(bytesOf(PRFF01).toString("utf8") + "\n<!-- x -->");
    expect(P.resolvePublicationProvenance({ entry: newEntry(bytes, { assessmentRevisionId: R2 }), artifactBytes: bytes }).error).toContain("is not a committed assessment revision");
    const malformed = newEntry(bytes, { assessmentRevisionId: "assessment_water-cycle__r1" });
    expect(P.resolvePublicationProvenance({ entry: malformed, artifactBytes: bytes }).error).toContain("must be a revision of assessment_earths-layers");
  });
});

describe("synthetic committed r2 (temporary repository)", () => {
  const legacyBytes = () => bytesOf(PRFF01);

  test("an unbound variant explicitly declaring r2 and rendering r2 is accepted", () => {
    const root = repo();
    const bytes = Buffer.from(withQuiz(legacyBytes(), r2Payload()));
    expect(P.resolvePublicationProvenance({ entry: newEntry(bytes, { assessmentRevisionId: R2 }), artifactBytes: bytes, repoRoot: root })).toEqual({
      ok: true,
      assessmentRevisionId: R2,
      source: "declared",
    });
  });

  test("a variant declaring one revision but rendering another is refused", () => {
    const root = repo();
    const r2Bytes = Buffer.from(withQuiz(legacyBytes(), r2Payload()));
    const wrong1 = P.resolvePublicationProvenance({ entry: newEntry(r2Bytes, { assessmentRevisionId: R1 }), artifactBytes: r2Bytes, repoRoot: root });
    expect(wrong1.error).toContain(`faithful to [${R2}], not exactly ${R1}`);
    const r1Bytes = legacyBytes();
    const wrong2 = P.resolvePublicationProvenance({ entry: newEntry(Buffer.from(r1Bytes.toString() + " "), { assessmentRevisionId: R2 }), artifactBytes: r1Bytes, repoRoot: root });
    expect(wrong2.error).toContain(`faithful to [${R1}], not exactly ${R2}`);
  });

  test("the pinned legacy artifact stays r1 even while r2 exists", () => {
    const root = repo();
    expect(P.resolvePublicationProvenance({ entry: entryOf(PRFF01), artifactBytes: legacyBytes(), repoRoot: root })).toMatchObject({
      ok: true,
      assessmentRevisionId: R1,
      source: "legacyR1",
    });
  });

  test("the certified ap1fed... variant still resolves to r1 while r2 exists", () => {
    const root = repo();
    expect(P.resolvePublicationProvenance({ entry: entryOf(PR90F), artifactBytes: bytesOf(PR90F), repoRoot: root })).toMatchObject({
      ok: true,
      assessmentRevisionId: R1,
    });
  });

  test("a committed revision with no canonical page in the revision-path table is refused", () => {
    const root = repo({ tableRevisions: [R1] });
    const bytes = Buffer.from(withQuiz(legacyBytes(), r2Payload()));
    const res = P.resolvePublicationProvenance({ entry: newEntry(bytes, { assessmentRevisionId: R2 }), artifactBytes: bytes, repoRoot: root });
    expect(res.error).toContain("has no canonical page");
  });
});

// F5.3 Slice 9D (addendum 21.4 "Legacy pages"): the runtime accepts a page with
// neither a revision declaration nor an assessment-presentation block ONLY for
// an r1 session. This proves every such retained artifact displays exactly r1.
describe("retained artifacts without any revision declaration display r1", () => {
  test("every retained no-declaration artifact is pinned legacy and faithful to r1 only", () => {
    const undeclared = manifest.filter((e) => {
      const html = fs.readFileSync(path.join(ROOT, e.path), "utf8");
      return N.readDeclaration(html) === null && render.readBindingBlock(html) === null;
    });
    expect(undeclared.map((e) => e.presentationRevisionId)).toEqual([PRFF01]);
    for (const e of undeclared) {
      expect(manifestMod.LEGACY_R1_UNBOUND_REVISIONS).toContain(e.presentationRevisionId);
      expect(P.resolvePublicationProvenance({ entry: e, artifactBytes: fs.readFileSync(path.join(ROOT, e.path)) })).toMatchObject({
        ok: true,
        assessmentRevisionId: `assessment_${e.lessonSlug}__r1`,
      });
    }
  });
});
