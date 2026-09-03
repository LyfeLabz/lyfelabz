/*
 * Firebase Hosting exclusion verifier for the differentiated-presentation
 * retention manifest (F5.2 Slice 3; resolves the Slice 2 carry-forward
 * finding).
 *
 * WHY THIS EXISTS
 * ---------------
 * Slice 2 discovered that `app/lessons/variants/manifest.json` would be
 * served publicly by Firebase Hosting under the pre-Slice-3 `firebase.json`.
 * The manifest maps an opaque revision path back to its accommodation
 * `variantKey` (e.g. "reading-adapted"), which defeats the F5.2 path-opacity
 * privacy intent (§5.2/M4, §11). The required end state:
 *
 *   - revision-specific `.html` artifacts under app/lessons/variants/ remain
 *     hostable (they are the delivered student content),
 *   - `manifest.json` is NOT publicly served,
 *   - build/verify/publish tooling can still read the manifest locally.
 *
 * The fix is the smallest Firebase Hosting `ignore` entry - the exact path
 * `app/lessons/variants/manifest.json` - not a rename and not obscurity.
 * This module proves, deterministically and offline, that the committed
 * `firebase.json` actually excludes the manifest while still serving every
 * retained revision artifact.
 *
 * HOW IT MODELS HOSTING
 * ---------------------
 * `firebase-tools` enumerates the deployable file set with
 * `glob.sync("**\/*", { cwd, dot:true, follow:true, ignore, nodir:true,
 * posix:true })` (firebase-tools `listFiles`), where `ignore` is a small set
 * of built-in defaults concatenated with `hosting.ignore` from
 * `firebase.json`. `glob`'s `ignore` option is evaluated with `minimatch`.
 * We reproduce exactly that decision with `minimatch` (the same engine
 * `glob` uses), so a path is "would-be-served" iff `glob` would NOT ignore
 * it. We deliberately do not touch the filesystem or the network: the
 * question "is this relative path excluded by these patterns?" is a pure
 * function of the path and the ignore list.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const { minimatch } = require("minimatch");

const paths = require("./paths.cjs");
const manifestMod = require("./variantManifest.cjs");
const identity = require("./variantIdentity.cjs");

// firebase-tools `listFiles` always prepends these built-in ignores before
// the user's `hosting.ignore`. Kept here so the model matches deployment
// behavior exactly even though none of them touch the variants directory.
const FIREBASE_BUILTIN_IGNORES = ["**/firebase-debug.log", "**/firebase-debug.*.log", ".firebase/*"];

const MANIFEST_REL_PATH = "app/lessons/variants/manifest.json";

// A representative revision artifact path used to prove the general rule
// (revision HTML stays deployable) even before any real variant is
// published and listed in the manifest. The 64-hex digest is synthetic.
const SAMPLE_REVISION_REL_PATH = identity.variantRelativeOutputPath(
  "sample-lesson",
  `pr${"a".repeat(64)}`,
);

function fail(message) {
  throw new Error(`[hosting-exclusion] ${message}`);
}

// True iff `glob.sync(..., { ignore })` would exclude `relPosixPath`.
// glob compiles each ignore pattern with minimatch (dot:true here, matching
// listFiles' `dot:true`) and additionally treats a pattern as ignoring the
// children of any directory it names; we mirror both so a directory-style
// pattern and a file-style pattern are both evaluated faithfully.
function isHostingIgnored(relPosixPath, ignorePatterns) {
  return ignorePatterns.some((pattern) => {
    if (typeof pattern !== "string" || pattern.length === 0) return false;
    if (minimatch(relPosixPath, pattern, { dot: true })) return true;
    const asDirChildren = `${pattern.replace(/\/+$/, "")}/**`;
    return minimatch(relPosixPath, asDirChildren, { dot: true });
  });
}

function readHostingIgnore(repoRoot = paths.REPO_ROOT) {
  const firebaseJsonPath = path.join(repoRoot, "firebase.json");
  if (!fs.existsSync(firebaseJsonPath)) {
    fail(`firebase.json not found at ${firebaseJsonPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(firebaseJsonPath, "utf8"));
  } catch (err) {
    fail(`firebase.json is not valid JSON: ${err.message}`);
  }
  const hosting = parsed && parsed.hosting;
  if (!hosting || typeof hosting !== "object") {
    fail("firebase.json has no hosting configuration");
  }
  // A missing `public` other than the repo root would change what these
  // relative paths mean; the LyfeLabz site serves the repo root (".").
  if (hosting.public !== ".") {
    fail(
      `hosting.public is ${JSON.stringify(hosting.public)}; this verifier assumes the ` +
        'repo-root ("." ) hosting layout that maps app/lessons/variants/** to /app/lessons/variants/**',
    );
  }
  const ignore = Array.isArray(hosting.ignore) ? hosting.ignore : [];
  return FIREBASE_BUILTIN_IGNORES.concat(ignore);
}

// Deterministic, offline verification that:
//   1. the retention manifest would NOT be served by Hosting,
//   2. a representative revision HTML path WOULD be served,
//   3. every currently-retained revision artifact (manifest-listed) would be
//      served - so the exclusion never accidentally hides real student
//      content.
// Returns { ok, failures } like verifyRetention(); throws only on a
// structurally unreadable firebase.json.
function verifyManifestHostingExclusion({ repoRoot = paths.REPO_ROOT } = {}) {
  const ignore = readHostingIgnore(repoRoot);
  const failures = [];

  if (!isHostingIgnored(MANIFEST_REL_PATH, ignore)) {
    failures.push(
      `retention manifest "${MANIFEST_REL_PATH}" is NOT excluded by firebase.json hosting.ignore; ` +
        "it would be served publicly and would map opaque revision paths back to accommodation variantKeys " +
        "(F5.2 §5.2/§11 privacy violation). Add the exact path to hosting.ignore.",
    );
  }

  if (isHostingIgnored(SAMPLE_REVISION_REL_PATH, ignore)) {
    failures.push(
      `revision artifact path "${SAMPLE_REVISION_REL_PATH}" is excluded by firebase.json hosting.ignore; ` +
        "differentiated presentation artifacts must remain deployable. Loosen the exclusion so only " +
        "manifest.json (not the revision HTML) is ignored.",
    );
  }

  // Every real retained artifact must remain hostable. This makes the check
  // load-bearing once publication begins: an over-broad future ignore glob
  // that swept the .html files would fail here.
  let entries = [];
  try {
    entries = manifestMod.readManifest(repoRoot);
  } catch (err) {
    failures.push(`could not read manifest to confirm retained-artifact hostability: ${err.message}`);
  }
  for (const entry of entries) {
    if (entry && typeof entry.path === "string" && isHostingIgnored(entry.path, ignore)) {
      failures.push(
        `retained artifact "${entry.path}" is excluded from Hosting by firebase.json hosting.ignore; ` +
          "a published differentiated presentation would 404 for students.",
      );
    }
  }

  return { ok: failures.length === 0, failures };
}

module.exports = {
  FIREBASE_BUILTIN_IGNORES,
  MANIFEST_REL_PATH,
  SAMPLE_REVISION_REL_PATH,
  isHostingIgnored,
  readHostingIgnore,
  verifyManifestHostingExclusion,
};
