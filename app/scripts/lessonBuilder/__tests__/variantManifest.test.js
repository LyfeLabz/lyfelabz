/**
 * @jest-environment node
 */
/* eslint-disable */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const manifestMod = require("../variantManifest.cjs");
const identity = require("../variantIdentity.cjs");

function mkTmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "lyfelabz-variant-manifest-"));
}

function rmTmpRepo(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function makeEntry({ lessonSlug = "earths-layers", variantKey = "reading-adapted", bytes = "<html>a</html>", publishedAt = "2026-01-01T00:00:00.000Z" } = {}) {
  const presentationRevisionId = identity.computePresentationRevisionId(bytes);
  const sha256 = presentationRevisionId.slice(2);
  const relPath = identity.variantRelativeOutputPath(lessonSlug, presentationRevisionId);
  return { lessonSlug, variantKey, presentationRevisionId, path: relPath, sha256, publishedAt, bytes };
}

function writeArtifactForEntry(repoRoot, entry) {
  const abs = path.join(repoRoot, entry.path);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, entry.bytes, "utf8");
}

describe("manifest read/append (append-only ledger)", () => {
  let repoRoot;
  beforeEach(() => {
    repoRoot = mkTmpRepo();
  });
  afterEach(() => {
    rmTmpRepo(repoRoot);
  });

  test("readManifest returns [] when no manifest exists yet", () => {
    expect(manifestMod.readManifest(repoRoot)).toEqual([]);
  });

  test("appendEntry writes the file and reading it back returns the entry", () => {
    const entry = makeEntry();
    writeArtifactForEntry(repoRoot, entry);
    const { entry: written, appended } = manifestMod.appendEntry(entry, { repoRoot });
    expect(appended).toBe(true);
    expect(written.presentationRevisionId).toBe(entry.presentationRevisionId);
    const entries = manifestMod.readManifest(repoRoot);
    expect(entries).toHaveLength(1);
    expect(entries[0].path).toBe(entry.path);
  });

  test("manifest is deterministically serialized (stable field order, 2-space indent, trailing newline)", () => {
    const entry = makeEntry();
    writeArtifactForEntry(repoRoot, entry);
    manifestMod.appendEntry(entry, { repoRoot });
    const raw = fs.readFileSync(manifestMod.resolveManifestPath(repoRoot), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    const reserialized = manifestMod.serializeManifest(manifestMod.readManifest(repoRoot));
    expect(raw).toBe(reserialized);
    expect(Object.keys(JSON.parse(raw)[0])).toEqual([
      "lessonSlug",
      "variantKey",
      "presentationRevisionId",
      "path",
      "sha256",
      "publishedAt",
    ]);
  });

  test("re-appending an identical entry is a harmless no-op and keeps the original publishedAt (idempotent dedupe)", () => {
    const entry = makeEntry({ publishedAt: "2026-01-01T00:00:00.000Z" });
    writeArtifactForEntry(repoRoot, entry);
    manifestMod.appendEntry(entry, { repoRoot });
    const retryEntry = { ...entry, publishedAt: "2026-06-01T00:00:00.000Z" };
    const { appended, entry: result } = manifestMod.appendEntry(retryEntry, { repoRoot });
    expect(appended).toBe(false);
    expect(result.publishedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(manifestMod.readManifest(repoRoot)).toHaveLength(1);
  });

  test("appendEntry refuses to alter an existing entry at the same path with different content identity", () => {
    const entry = makeEntry();
    writeArtifactForEntry(repoRoot, entry);
    manifestMod.appendEntry(entry, { repoRoot });
    const conflicting = { ...entry, variantKey: "reading-simplified" };
    expect(() => manifestMod.appendEntry(conflicting, { repoRoot })).toThrow(/refusing to alter|immutability/);
    expect(manifestMod.readManifest(repoRoot)).toHaveLength(1);
  });

  test("appendEntry rejects a malformed entry (missing field)", () => {
    const entry = makeEntry();
    const { bytes, ...rest } = entry;
    delete rest.sha256;
    expect(() => manifestMod.appendEntry(rest, { repoRoot })).toThrow();
  });

  test("appendEntry rejects an entry whose path does not match the identity formula", () => {
    const entry = makeEntry();
    const tampered = { ...entry, path: "app/lessons/variants/lesson_other__" + entry.presentationRevisionId + ".html" };
    expect(() => manifestMod.appendEntry(tampered, { repoRoot })).toThrow(/identity formula/);
  });

  test("appendEntry rejects an invalid-charset lessonSlug", () => {
    const bytes = "<html>bad slug</html>";
    const presentationRevisionId = identity.computePresentationRevisionId(bytes);
    const entry = {
      lessonSlug: "bad_slug",
      variantKey: "reading-adapted",
      presentationRevisionId,
      path: `app/lessons/variants/lesson_bad_slug__${presentationRevisionId}.html`,
      sha256: presentationRevisionId.slice(2),
      publishedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(() => manifestMod.appendEntry(entry, { repoRoot })).toThrow();
  });

  test("appending a second, different revision preserves the first entry unchanged (T-E1)", () => {
    const a = makeEntry({ bytes: "<html>revision A</html>" });
    writeArtifactForEntry(repoRoot, a);
    manifestMod.appendEntry(a, { repoRoot });

    const b = makeEntry({ bytes: "<html>revision B</html>" });
    writeArtifactForEntry(repoRoot, b);
    manifestMod.appendEntry(b, { repoRoot });

    const entries = manifestMod.readManifest(repoRoot);
    expect(entries).toHaveLength(2);
    const aEntry = entries.find((e) => e.presentationRevisionId === a.presentationRevisionId);
    expect(aEntry).toBeTruthy();
    expect(aEntry.sha256).toBe(a.sha256);
    expect(fs.readFileSync(path.join(repoRoot, aEntry.path), "utf8")).toBe(a.bytes);
  });
});

describe("guardAgainstDestructiveClear (M7)", () => {
  let repoRoot;
  beforeEach(() => {
    repoRoot = mkTmpRepo();
  });
  afterEach(() => {
    rmTmpRepo(repoRoot);
  });

  test("no-op when the manifest has no retained entries yet", () => {
    const variantsRoot = manifestMod.resolveVariantsRoot(repoRoot);
    expect(() => manifestMod.guardAgainstDestructiveClear(variantsRoot, { repoRoot })).not.toThrow();
  });

  test("refuses to clear the variants root itself once artifacts are retained", () => {
    const entry = makeEntry();
    writeArtifactForEntry(repoRoot, entry);
    manifestMod.appendEntry(entry, { repoRoot });
    const variantsRoot = manifestMod.resolveVariantsRoot(repoRoot);
    expect(() => manifestMod.guardAgainstDestructiveClear(variantsRoot, { repoRoot })).toThrow(/M7|retained/);
  });

  test("refuses to clear an ancestor of the variants root (e.g. app/lessons)", () => {
    const entry = makeEntry();
    writeArtifactForEntry(repoRoot, entry);
    manifestMod.appendEntry(entry, { repoRoot });
    const ancestor = path.join(repoRoot, "app", "lessons");
    expect(() => manifestMod.guardAgainstDestructiveClear(ancestor, { repoRoot })).toThrow();
  });

  test("does not block clearing an unrelated directory", () => {
    const entry = makeEntry();
    writeArtifactForEntry(repoRoot, entry);
    manifestMod.appendEntry(entry, { repoRoot });
    const unrelated = path.join(repoRoot, "some", "tmp", "build-scratch");
    fs.mkdirSync(unrelated, { recursive: true });
    expect(() => manifestMod.guardAgainstDestructiveClear(unrelated, { repoRoot })).not.toThrow();
  });
});

describe("verifyRetention (deterministic verifier)", () => {
  let repoRoot;
  beforeEach(() => {
    repoRoot = mkTmpRepo();
  });
  afterEach(() => {
    rmTmpRepo(repoRoot);
  });

  test("passes trivially with no manifest at all", () => {
    const result = manifestMod.verifyRetention({ repoRoot });
    expect(result.ok).toBe(true);
    expect(result.failures).toEqual([]);
  });

  test("passes with one valid, intact retained entry", () => {
    const entry = makeEntry();
    writeArtifactForEntry(repoRoot, entry);
    manifestMod.appendEntry(entry, { repoRoot });
    const result = manifestMod.verifyRetention({ repoRoot });
    expect(result.ok).toBe(true);
  });

  test("fails when a manifest-listed artifact is missing from the tree", () => {
    const entry = makeEntry();
    writeArtifactForEntry(repoRoot, entry);
    manifestMod.appendEntry(entry, { repoRoot });
    fs.rmSync(path.join(repoRoot, entry.path));
    const result = manifestMod.verifyRetention({ repoRoot });
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => /missing from tree/.test(f))).toBe(true);
  });

  test("fails when a manifest-listed artifact's bytes were altered on disk", () => {
    const entry = makeEntry();
    writeArtifactForEntry(repoRoot, entry);
    manifestMod.appendEntry(entry, { repoRoot });
    fs.writeFileSync(path.join(repoRoot, entry.path), "<html>tampered</html>", "utf8");
    const result = manifestMod.verifyRetention({ repoRoot });
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => /altered/.test(f))).toBe(true);
  });

  test("fails when a manifest entry was removed while its artifact file was left behind (orphan file)", () => {
    const a = makeEntry({ bytes: "<html>rev A</html>" });
    const b = makeEntry({ bytes: "<html>rev B</html>" });
    writeArtifactForEntry(repoRoot, a);
    writeArtifactForEntry(repoRoot, b);
    manifestMod.appendEntry(a, { repoRoot });
    manifestMod.appendEntry(b, { repoRoot });

    // Simulate an external edit that dropped b's manifest entry (never
    // touch fields, just rewrite the ledger with b removed).
    const manifestPath = manifestMod.resolveManifestPath(repoRoot);
    const remaining = manifestMod.readManifest(repoRoot).filter((e) => e.presentationRevisionId !== b.presentationRevisionId);
    fs.writeFileSync(manifestPath, manifestMod.serializeManifest(remaining), "utf8");

    const result = manifestMod.verifyRetention({ repoRoot });
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => /no manifest entry/.test(f))).toBe(true);
  });

  test("fails when a manifest entry's own presentationRevisionId disagrees with its sha256 (altered entry)", () => {
    const entry = makeEntry();
    writeArtifactForEntry(repoRoot, entry);
    manifestMod.appendEntry(entry, { repoRoot });
    const manifestPath = manifestMod.resolveManifestPath(repoRoot);
    const entries = manifestMod.readManifest(repoRoot);
    entries[0].presentationRevisionId = "pr" + "0".repeat(64);
    fs.writeFileSync(manifestPath, JSON.stringify(entries, null, 2) + "\n", "utf8");
    const result = manifestMod.verifyRetention({ repoRoot });
    expect(result.ok).toBe(false);
    expect(result.failures.some((f) => /does not match|self-consistency/.test(f))).toBe(true);
  });

  test("fails on an invalid-charset lessonSlug smuggled directly into the manifest file", () => {
    const entry = makeEntry();
    writeArtifactForEntry(repoRoot, entry);
    manifestMod.appendEntry(entry, { repoRoot });
    const manifestPath = manifestMod.resolveManifestPath(repoRoot);
    const entries = manifestMod.readManifest(repoRoot);
    entries[0].lessonSlug = "bad_slug";
    fs.writeFileSync(manifestPath, JSON.stringify(entries, null, 2) + "\n", "utf8");
    const result = manifestMod.verifyRetention({ repoRoot });
    expect(result.ok).toBe(false);
  });

  test("fails when two entries share a presentationRevisionId but disagree on sha256 (collision integrity check)", () => {
    const entry = makeEntry();
    writeArtifactForEntry(repoRoot, entry);
    manifestMod.appendEntry(entry, { repoRoot });
    const manifestPath = manifestMod.resolveManifestPath(repoRoot);
    const entries = manifestMod.readManifest(repoRoot);
    const forged = { ...entry, path: entry.path.replace("earths-layers", "other-lesson"), sha256: "0".repeat(64) };
    // Bypass appendEntry's own self-consistency guard to simulate a
    // corrupted ledger reaching the verifier directly.
    fs.writeFileSync(manifestPath, JSON.stringify([...entries, forged], null, 2) + "\n", "utf8");
    const result = manifestMod.verifyRetention({ repoRoot });
    expect(result.ok).toBe(false);
  });
});

describe("Slice 2 has no runtime/index/Firestore side effect", () => {
  test("variantManifest.cjs imports no Firestore/Firebase SDK and calls no network API", () => {
    const src = fs.readFileSync(require.resolve("../variantManifest.cjs"), "utf8");
    expect(src).not.toMatch(/require\(["']firebase|require\(["']@?firebase|fetch\(|https?\.request/i);
  });

  test("variantManifest.cjs performs no destructive recursive delete of its own", () => {
    const src = fs.readFileSync(require.resolve("../variantManifest.cjs"), "utf8");
    expect(src).not.toMatch(/rmSync|rmdirSync|rm -rf/);
  });
});
