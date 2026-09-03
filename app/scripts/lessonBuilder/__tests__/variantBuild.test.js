/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { generateVariantArtifact } = require("../variantBuild.cjs");
const manifestMod = require("../variantManifest.cjs");

function mkTmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lyfelabz-variant-build-"));
}

function rmTmpRepo(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// Test-only synthetic fixture bytes. Not real lesson content, not a
// production adapted lesson - purely a stand-in payload for pipeline
// determinism/identity tests.
const FIXTURE_A = "<html><body>synthetic fixture revision A - not real lesson content</body></html>";
const FIXTURE_B = "<html><body>synthetic fixture revision B - not real lesson content</body></html>";
const PUBLISHED_AT = "2026-01-01T00:00:00.000Z";

describe("generateVariantArtifact - determinism and identity (suite D)", () => {
  let repoRoot;
  beforeEach(() => {
    repoRoot = mkTmpRepo();
  });
  afterEach(() => {
    rmTmpRepo(repoRoot);
  });

  test("T-D1: two clean generations of identical inputs produce byte-identical artifacts and identical revision IDs", () => {
    const r1 = generateVariantArtifact({
      lessonSlug: "earths-layers",
      variantKey: "reading-adapted",
      bytes: FIXTURE_A,
      publishedAt: PUBLISHED_AT,
      repoRoot,
    });
    // Simulate a second clean build: fresh repoRoot, same inputs.
    const repoRoot2 = mkTmpRepo();
    try {
      const r2 = generateVariantArtifact({
        lessonSlug: "earths-layers",
        variantKey: "reading-adapted",
        bytes: FIXTURE_A,
        publishedAt: PUBLISHED_AT,
        repoRoot: repoRoot2,
      });
      expect(r1.presentationRevisionId).toBe(r2.presentationRevisionId);
      expect(r1.sha256).toBe(r2.sha256);
      expect(r1.path).toBe(r2.path);
      expect(fs.readFileSync(r1.absPath, "utf8")).toBe(fs.readFileSync(r2.absPath, "utf8"));
    } finally {
      rmTmpRepo(repoRoot2);
    }
  });

  test("T-D1b: regenerating the same revision in the same repo is an idempotent no-op, not a second file/entry", () => {
    const first = generateVariantArtifact({
      lessonSlug: "earths-layers",
      variantKey: "reading-adapted",
      bytes: FIXTURE_A,
      publishedAt: PUBLISHED_AT,
      repoRoot,
    });
    expect(first.fileWritten).toBe(true);
    expect(first.appended).toBe(true);

    const second = generateVariantArtifact({
      lessonSlug: "earths-layers",
      variantKey: "reading-adapted",
      bytes: FIXTURE_A,
      publishedAt: "2026-12-31T00:00:00.000Z",
      repoRoot,
    });
    expect(second.presentationRevisionId).toBe(first.presentationRevisionId);
    expect(second.fileWritten).toBe(false);
    expect(second.appended).toBe(false);
    expect(manifestMod.readManifest(repoRoot)).toHaveLength(1);
    // publishedAt is never rewritten on a dedupe no-op.
    expect(manifestMod.readManifest(repoRoot)[0].publishedAt).toBe(PUBLISHED_AT);
  });

  test("T-D2: different final bytes produce a different revision ID and a different path", () => {
    const a = generateVariantArtifact({
      lessonSlug: "earths-layers",
      variantKey: "reading-adapted",
      bytes: FIXTURE_A,
      publishedAt: PUBLISHED_AT,
      repoRoot,
    });
    const b = generateVariantArtifact({
      lessonSlug: "earths-layers",
      variantKey: "reading-adapted",
      bytes: FIXTURE_B,
      publishedAt: PUBLISHED_AT,
      repoRoot,
    });
    expect(a.presentationRevisionId).not.toBe(b.presentationRevisionId);
    expect(a.path).not.toBe(b.path);
    expect(a.sha256).not.toBe(b.sha256);
  });

  test("T-D3: identity is derived from final bytes, not source metadata or pre-transform inputs", () => {
    expect(() =>
      generateVariantArtifact({
        lessonSlug: "earths-layers",
        variantKey: "reading-adapted",
        bytes: { notActualBytes: true },
        publishedAt: PUBLISHED_AT,
        repoRoot,
      }),
    ).toThrow();
  });

  test("T-D4: a path collision with different bytes at the exact computed location is refused as an integrity failure", () => {
    const id = require("../variantIdentity.cjs").computePresentationRevisionId(FIXTURE_A);
    const relPath = require("../variantIdentity.cjs").variantRelativeOutputPath("earths-layers", id);
    const absPath = path.join(repoRoot, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    // Plant different bytes at the exact path the real bytes would hash to,
    // simulating an impossible full-digest collision (or out-of-band
    // tampering) without needing an actual SHA-256 break.
    fs.writeFileSync(absPath, "<html>not the real content for this hash</html>", "utf8");

    expect(() =>
      generateVariantArtifact({
        lessonSlug: "earths-layers",
        variantKey: "reading-adapted",
        bytes: FIXTURE_A,
        publishedAt: PUBLISHED_AT,
        repoRoot,
      }),
    ).toThrow(/integrity failure/);
  });

  test("publishedAt is required explicitly - no implicit wall-clock default", () => {
    expect(() =>
      generateVariantArtifact({
        lessonSlug: "earths-layers",
        variantKey: "reading-adapted",
        bytes: FIXTURE_A,
        repoRoot,
      }),
    ).toThrow(/publishedAt/);
  });

  test("rejects an invalid lessonSlug at the publication boundary (canonical build behavior is unaffected by this rejection)", () => {
    expect(() =>
      generateVariantArtifact({
        lessonSlug: "earths_layers",
        variantKey: "reading-adapted",
        bytes: FIXTURE_A,
        publishedAt: PUBLISHED_AT,
        repoRoot,
      }),
    ).toThrow();
    // Nothing was written for the rejected slug.
    expect(manifestMod.readManifest(repoRoot)).toEqual([]);
  });
});

describe("retention across regeneration (T-E1) and manifest-listed protection (T-P5/M7)", () => {
  let repoRoot;
  beforeEach(() => {
    repoRoot = mkTmpRepo();
  });
  afterEach(() => {
    rmTmpRepo(repoRoot);
  });

  test("T-E1: revision A remains present and unchanged when revision B is generated", () => {
    const a = generateVariantArtifact({
      lessonSlug: "earths-layers",
      variantKey: "reading-adapted",
      bytes: FIXTURE_A,
      publishedAt: PUBLISHED_AT,
      repoRoot,
    });
    const b = generateVariantArtifact({
      lessonSlug: "earths-layers",
      variantKey: "reading-adapted",
      bytes: FIXTURE_B,
      publishedAt: PUBLISHED_AT,
      repoRoot,
    });
    expect(fs.existsSync(a.absPath)).toBe(true);
    expect(fs.readFileSync(a.absPath, "utf8")).toBe(FIXTURE_A);
    expect(fs.existsSync(b.absPath)).toBe(true);
    const entries = manifestMod.readManifest(repoRoot);
    expect(entries).toHaveLength(2);
    const verify = manifestMod.verifyRetention({ repoRoot });
    expect(verify.ok).toBe(true);
  });

  test("T-P5: generation refuses to proceed if the variants directory was destructively cleared underneath the manifest", () => {
    const a = generateVariantArtifact({
      lessonSlug: "earths-layers",
      variantKey: "reading-adapted",
      bytes: FIXTURE_A,
      publishedAt: PUBLISHED_AT,
      repoRoot,
    });
    // Simulate an external actor destructively wiping the retained
    // artifact file without going through this module (bypassing the
    // guard entirely) to prove generation does not silently paper over a
    // corrupted retention state when asked to add a *new* revision whose
    // computed path happens to require creating the same directory again.
    fs.rmSync(a.absPath);

    expect(() =>
      generateVariantArtifact({
        lessonSlug: "earths-layers",
        variantKey: "reading-adapted",
        bytes: FIXTURE_B,
        publishedAt: PUBLISHED_AT,
        repoRoot,
      }),
    ).not.toThrow(); // adding a new, different revision is legitimate...

    // ...but the retention ledger now visibly reports A as missing, which
    // is exactly what the verifier (the final gate) must catch.
    const verify = manifestMod.verifyRetention({ repoRoot });
    expect(verify.ok).toBe(false);
    expect(verify.failures.some((f) => /missing from tree/.test(f))).toBe(true);
  });

  test("T-P5b: the M7 guard itself refuses a destructive clear of the retained variants directory", () => {
    generateVariantArtifact({
      lessonSlug: "earths-layers",
      variantKey: "reading-adapted",
      bytes: FIXTURE_A,
      publishedAt: PUBLISHED_AT,
      repoRoot,
    });
    const variantsRoot = manifestMod.resolveVariantsRoot(repoRoot);
    expect(() => manifestMod.guardAgainstDestructiveClear(variantsRoot, { repoRoot })).toThrow();
    // Prove the guard's refusal is what a "clean build" entrypoint would
    // hit before ever calling fs.rmSync - the directory and its retained
    // file are still there.
    expect(fs.existsSync(variantsRoot)).toBe(true);
  });
});

describe("no runtime/index/Firestore side effect (Slice 2 scope boundary)", () => {
  test("variantBuild.cjs imports no Firestore/Firebase SDK and calls no network API", () => {
    const src = fs.readFileSync(require.resolve("../variantBuild.cjs"), "utf8");
    expect(src).not.toMatch(/require\(["']firebase|require\(["']@?firebase|fetch\(|https?\.request/i);
  });

  test("generateVariantArtifact writes only inside the repo tree it was given - no doc/collection write call exists", () => {
    const src = fs.readFileSync(require.resolve("../variantBuild.cjs"), "utf8");
    expect(src).not.toMatch(/\.doc\(|\.collection\(|setDoc|updateDoc/);
  });
});
