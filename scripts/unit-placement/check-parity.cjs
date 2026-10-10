'use strict';

// U1B unit-placement parity gate. Fails closed.
//
//   node scripts/unit-placement/check-parity.cjs
//
// `teacherUnitsSetResources` validates membership against a server copy of
// the RA-1 `unitPlaceable` ids
// (platform/functions/src/teacherUnits/unit-placeable-resources.json). This
// gate proves that copy equals the canonical projection, ids and order:
//
//   1. the generated curriculum manifest is current with the registry
//      (`build-curriculum-manifest.cjs --check`), because RA-1 reads it;
//   2. the REAL RA-1 accessor (app/src/curriculum/resourceProjection.ts) is
//      bundled with the app's esbuild and evaluated, not re-derived here;
//   3. the canonical list must be non-empty (the server loader refuses an
//      empty list), and the server file must parse, have exactly
//      { description, resourceIds }, and list exactly
//      getFlatResources().filter(unitPlaceable) ids.
//
// Any missing input (file, app dependencies, esbuild) is a failure, never a
// skip. Required by: the Functions `prebuild` (every `npm run build`, and
// therefore every Functions deploy predeploy and CI build), the Hosting
// pair build (every Hosting deploy predeploy, production and staging), and
// Platform CI. Source-tree parity only: it does not prove which list a
// deployed Functions or Hosting artifact carries (see
// docs/platform/TEACHER_UNITS.md section 9.3).

const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.join(repositoryRoot, 'app');
const projectionEntry = path.join(appRoot, 'src', 'curriculum', 'resourceProjection.ts');
const curriculumCheck = path.join(appRoot, 'scripts', 'build-curriculum-manifest.cjs');
const serverManifestPath = path.join(
  repositoryRoot, 'platform', 'functions', 'src', 'teacherUnits', 'unit-placeable-resources.json',
);

function fail(message) {
  throw new Error(`[unit-placement] ${message}`);
}

function assertCurriculumManifestCurrent() {
  try {
    execFileSync(process.execPath, [curriculumCheck, '--check'], { cwd: appRoot, stdio: 'pipe' });
  } catch (error) {
    const detail = error.stderr ? String(error.stderr).trim() : error.message;
    fail(`generated curriculum manifest is not current with the registry: ${detail}`);
  }
}

function loadEsbuild() {
  try {
    return Module.createRequire(path.join(appRoot, 'package.json'))('esbuild');
  } catch {
    return fail('app dependencies are missing (esbuild). Run `npm --prefix app ci` before building or deploying.');
  }
}

// The canonical ids, from the real RA-1 accessor.
function canonicalPlaceableIds() {
  const esbuild = loadEsbuild();
  const result = esbuild.buildSync({
    entryPoints: [projectionEntry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    write: false,
    logLevel: 'silent',
  });
  const mod = new Module(projectionEntry);
  mod.filename = projectionEntry;
  mod._compile(result.outputFiles[0].text, projectionEntry);
  const resources = mod.exports.getFlatResources();
  if (!Array.isArray(resources) || resources.length === 0) fail('RA-1 projection returned no resources.');
  return resources.filter((r) => r.unitPlaceable === true).map((r) => r.id);
}

function readServerIds(manifestPath) {
  if (!fs.existsSync(manifestPath)) fail(`server manifest missing: ${path.relative(repositoryRoot, manifestPath)}`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    return fail(`server manifest is not valid JSON: ${error.message}`);
  }
  const keys = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.keys(parsed).sort() : [];
  if (keys.join(',') !== 'description,resourceIds' || !Array.isArray(parsed.resourceIds)) {
    fail('server manifest must contain exactly "description" and a "resourceIds" array.');
  }
  return parsed.resourceIds;
}

function placementFingerprint(ids) {
  return crypto.createHash('sha256').update(JSON.stringify(ids), 'utf8').digest('hex');
}

// Throws on any drift. Returns { count, fingerprint } on success.
function assertUnitPlacementParity({
  manifestPath = serverManifestPath,
  canonicalIds = undefined,
  checkCurriculum = true,
} = {}) {
  if (checkCurriculum) assertCurriculumManifestCurrent();
  const expected = canonicalIds ?? canonicalPlaceableIds();
  // The server loader refuses an empty list, so an empty canonical result
  // must fail here rather than pass parity with an empty server file.
  if (!Array.isArray(expected) || expected.length === 0) {
    fail('the RA-1 projection reports zero unit-placeable resources; refusing an empty placement list.');
  }
  const actual = readServerIds(manifestPath);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    const extra = actual.filter((id) => !expected.includes(id));
    const missing = expected.filter((id) => !actual.includes(id));
    fail(
      `server unit-placeable manifest drifted from the RA-1 projection ` +
        `(noncanonical or stale: ${JSON.stringify(extra)}; missing: ${JSON.stringify(missing)}` +
        `${extra.length === 0 && missing.length === 0 ? '; order or duplicates differ' : ''}). ` +
        `Replace "resourceIds" in ${path.relative(repositoryRoot, manifestPath)} with:\n${JSON.stringify(expected, null, 2)}`,
    );
  }
  return { count: expected.length, fingerprint: placementFingerprint(expected) };
}

if (require.main === module) {
  try {
    const { count, fingerprint } = assertUnitPlacementParity();
    console.log(`[unit-placement] OK: server manifest matches RA-1 (${count} placeable ids, sha256 ${fingerprint})`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = {
  assertUnitPlacementParity,
  canonicalPlaceableIds,
  placementFingerprint,
  serverManifestPath,
};
