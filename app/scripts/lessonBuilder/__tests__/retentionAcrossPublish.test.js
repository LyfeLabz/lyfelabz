/*
 * Retention across deploys / publish-tooling wiring (F5.2 §6, T-E2/T-E4,
 * Slice 3).
 *
 * These reconfirm, with the REAL Slice 2 modules (no mocks), the retention
 * half of the publication contract that the Slice 3 publish tooling depends
 * on:
 *   - T-E2: publish A, regenerate to B, then a "clean build" + verifier - A
 *     persists byte-identical while B is also retained (the index pointing to
 *     B is proven separately by the pure state-machine tests).
 *   - T-E4: the retention verifier is wired into the `verify` chain (CI) and
 *     is the mandatory local gate the publish tool runs before trusting the
 *     manifest.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const { generateVariantArtifact } = require("../variantBuild.cjs");
const manifestMod = require("../variantManifest.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

function freshRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lyfelabz-retention-"));
}

describe("retention across regeneration + verifier gate (T-E2 / T-E4)", () => {
  test("T-E2: A persists byte-identical after regenerating B; a clean verifier pass sees both", () => {
    const repoRoot = freshRepo();
    try {
      const a = generateVariantArtifact({
        lessonSlug: "earths-layers",
        variantKey: "reading-adapted",
        bytes: "<!doctype html><title>A</title>",
        publishedAt: "2026-09-03T00:00:00.000Z",
        repoRoot,
      });
      const aBytes = fs.readFileSync(path.join(repoRoot, a.path));

      const b = generateVariantArtifact({
        lessonSlug: "earths-layers",
        variantKey: "reading-adapted",
        bytes: "<!doctype html><title>B</title>",
        publishedAt: "2026-09-03T01:00:00.000Z",
        repoRoot,
      });

      expect(a.presentationRevisionId).not.toBe(b.presentationRevisionId);
      expect(a.path).not.toBe(b.path);

      // "Clean build" == re-run the verifier over the committed tree state.
      const verify = manifestMod.verifyRetention({ repoRoot });
      expect(verify.failures).toEqual([]);
      expect(verify.ok).toBe(true);

      // A remains byte-identical and manifest-listed alongside B.
      expect(fs.readFileSync(path.join(repoRoot, a.path)).equals(aBytes)).toBe(true);
      const entries = manifestMod.readManifest(repoRoot);
      expect(entries.map((e) => e.path)).toEqual([a.path, b.path]);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("T-E4: publish tooling's local gate - verifier fails an altered tree, so publish would refuse", () => {
    const repoRoot = freshRepo();
    try {
      const a = generateVariantArtifact({
        lessonSlug: "earths-layers",
        variantKey: "reading-adapted",
        bytes: "<!doctype html><title>A</title>",
        publishedAt: "2026-09-03T00:00:00.000Z",
        repoRoot,
      });
      // Tamper with the retained artifact out of band.
      fs.writeFileSync(path.join(repoRoot, a.path), "<!doctype html><title>TAMPERED</title>");
      const verify = manifestMod.verifyRetention({ repoRoot });
      expect(verify.ok).toBe(false);
      expect(verify.failures.join(" ")).toMatch(/altered/);
    } finally {
      fs.rmSync(repoRoot, { recursive: true, force: true });
    }
  });

  test("T-E4: the retention + hosting-exclusion verifier is wired into the app `verify` chain (CI)", () => {
    const appPkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "app", "package.json"), "utf8"));
    expect(appPkg.scripts.verify).toContain("variants:verify");
    expect(appPkg.scripts["variants:verify"]).toBe("node scripts/verify-variants.cjs");
  });
});
