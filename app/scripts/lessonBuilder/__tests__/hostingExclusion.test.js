/*
 * Firebase Hosting exclusion of the retention manifest (F5.2 Slice 3;
 * resolves the Slice 2 carry-forward finding; suite Q privacy).
 *
 * Proves, against the real committed firebase.json and with the same
 * minimatch engine firebase-tools' glob uses for `hosting.ignore`, that:
 *   - manifest.json is NOT publicly served,
 *   - revision HTML artifacts ARE deployable,
 *   - the exclusion mechanism is a firebase.json ignore entry, not a rename.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const hostingExclusion = require("../hostingExclusion.cjs");
const { generateVariantArtifact } = require("../variantBuild.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

describe("retention manifest is excluded from Firebase Hosting (Slice 2 carry-forward)", () => {
  test("the committed firebase.json excludes manifest.json but not revision HTML", () => {
    const result = hostingExclusion.verifyManifestHostingExclusion({ repoRoot: REPO_ROOT });
    expect(result.failures).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("MANIFEST PUBLICLY HOSTED: NO - the manifest path is ignored by the real hosting config", () => {
    const ignore = hostingExclusion.readHostingIgnore(REPO_ROOT);
    expect(hostingExclusion.isHostingIgnored("app/lessons/variants/manifest.json", ignore)).toBe(true);
  });

  test("a representative revision artifact path is NOT ignored (remains deployable)", () => {
    const ignore = hostingExclusion.readHostingIgnore(REPO_ROOT);
    const revisionPath = `app/lessons/variants/lesson_earths-layers__pr${"b".repeat(64)}.html`;
    expect(hostingExclusion.isHostingIgnored(revisionPath, ignore)).toBe(false);
  });

  test("the exclusion is a hosting.ignore entry for the exact manifest path, not a rename", () => {
    const firebaseJson = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "firebase.json"), "utf8"));
    expect(firebaseJson.hosting.ignore).toContain("app/lessons/variants/manifest.json");
    // The manifest keeps its canonical name; the module and build tooling
    // still read app/lessons/variants/manifest.json locally.
    expect(hostingExclusion.MANIFEST_REL_PATH).toBe("app/lessons/variants/manifest.json");
  });

  test("a real retained artifact (built via the Slice 2 pipeline) would still be served", () => {
    // Build a fixture manifest+artifact in an isolated repoRoot that carries
    // a COPY of the real firebase.json, then confirm the retained .html is
    // hostable while its manifest.json is excluded.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lyfelabz-hosting-"));
    try {
      fs.copyFileSync(path.join(REPO_ROOT, "firebase.json"), path.join(tmpRoot, "firebase.json"));
      const built = generateVariantArtifact({
        lessonSlug: "earths-layers",
        variantKey: "reading-adapted",
        bytes: "<!doctype html><title>fixture</title>",
        publishedAt: "2026-09-03T00:00:00.000Z",
        repoRoot: tmpRoot,
      });

      const ignore = hostingExclusion.readHostingIgnore(tmpRoot);
      expect(hostingExclusion.isHostingIgnored(built.path, ignore)).toBe(false);
      expect(hostingExclusion.isHostingIgnored("app/lessons/variants/manifest.json", ignore)).toBe(true);

      const result = hostingExclusion.verifyManifestHostingExclusion({ repoRoot: tmpRoot });
      expect(result.failures).toEqual([]);
    } finally {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  test("build tmp siblings in the variants directory are already excluded (leading-dot ignore)", () => {
    const ignore = hostingExclusion.readHostingIgnore(REPO_ROOT);
    // paths.tmpSibling writes ".<base>.build-tmp.<pid>" - a dotfile, caught
    // by the existing "**/.*" ignore, so a crashed publish never leaks a
    // half-written artifact to Hosting.
    expect(
      hostingExclusion.isHostingIgnored("app/lessons/variants/.lesson_x__pr.html.build-tmp.123", ignore),
    ).toBe(true);
  });
});
