'use strict';

// U1B unit-placement parity gate: the gate refuses drift, and every
// supported release entry point actually invokes it.
//
//   node --test scripts/unit-placement/check-parity.test.cjs

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  assertUnitPlacementParity,
  canonicalPlaceableIds,
  placementFingerprint,
  serverManifestPath,
} = require('./check-parity.cjs');

const repositoryRoot = path.resolve(__dirname, '..', '..');
const gate = path.join(__dirname, 'check-parity.cjs');
const canonical = canonicalPlaceableIds();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'unit-placement-'));

function manifestWith(value) {
  const file = path.join(tmp, `m-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
}
const withIds = (resourceIds) => manifestWith({ description: 'x', resourceIds });
const refuses = (options) =>
  assert.throws(() => assertUnitPlacementParity({ checkCurriculum: false, ...options }), /\[unit-placement\]/);

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

test('the committed server manifest matches the real RA-1 projection', () => {
  const result = assertUnitPlacementParity();
  assert.equal(result.count, canonical.length);
  assert.equal(result.fingerprint, placementFingerprint(canonical));
  execFileSync(process.execPath, [gate], { stdio: 'pipe' });
});

test('canonical ids come from RA-1 and keep the approved decisions', () => {
  assert.ok(canonical.includes('simulation-gravity-wells'));
  assert.ok(!canonical.includes('lab-report-assistant'));
  assert.ok(!canonical.includes('ragebaiting'));
});

test('refuses a noncanonical id', () => refuses({ manifestPath: withIds([...canonical, 'not-a-resource']) }));
test('refuses a non-placeable canonical id (tool, gated)', () => {
  refuses({ manifestPath: withIds([...canonical, 'lab-report-assistant']) });
  refuses({ manifestPath: withIds([...canonical, 'ragebaiting']) });
});
test('refuses a missing (stale) id', () => refuses({ manifestPath: withIds(canonical.slice(1)) }));
test('refuses a reordered list', () => refuses({ manifestPath: withIds([...canonical].reverse()) }));
test('refuses a duplicated id', () => refuses({ manifestPath: withIds([...canonical, canonical[0]]) }));
test('refuses an empty list', () => refuses({ manifestPath: withIds([]) }));
test('refuses zero canonical placeable resources, even with an empty server list', () => {
  assert.throws(
    () => assertUnitPlacementParity({ checkCurriculum: false, canonicalIds: [], manifestPath: withIds([]) }),
    /zero unit-placeable resources/,
  );
});
test('refuses a missing file, invalid JSON, and an unexpected shape', () => {
  refuses({ manifestPath: path.join(tmp, 'absent.json') });
  refuses({ manifestPath: manifestWith('{ not json') });
  refuses({ manifestPath: manifestWith({ description: 'x', resourceIds: canonical, extra: true }) });
  refuses({ manifestPath: manifestWith({ description: 'x', resourceIds: 'earths-layers' }) });
});
test('refuses an app-only RA-1 change the server list does not carry', () => {
  // The committed server file, against a projection that gained an id.
  refuses({ canonicalIds: [...canonical, 'simulation-new-thing'] });
  refuses({ canonicalIds: canonical.slice(0, -1) });
});

test('the Hosting pair build invokes the gate first and refuses drift', () => {
  const { buildPair } = require('../hosting-release/build-pair.cjs');
  const drifted = withIds([...canonical, 'not-a-resource']);
  let bundleBuilt = false;
  assert.throws(
    () =>
      buildPair({
        runBundleBuild: false,
        log: () => {
          bundleBuilt = true;
        },
        placementParity: () => assertUnitPlacementParity({ manifestPath: drifted, checkCurriculum: false }),
      }),
    /\[unit-placement\]/,
  );
  assert.equal(bundleBuilt, false);
  const source = fs.readFileSync(path.join(repositoryRoot, 'scripts', 'hosting-release', 'build-pair.cjs'), 'utf8');
  assert.match(source, /placementParity = assertUnitPlacementParity\b/);
  assert.match(source, /assertCatalogCurrent\(\);\n\s+const unitPlacement = placementParity\(\);/);
});

test('every Hosting target deploys through the pair build (production and staging)', () => {
  for (const file of ['firebase.json', 'firebase.staging.json']) {
    const config = JSON.parse(fs.readFileSync(path.join(repositoryRoot, file), 'utf8'));
    for (const target of config.hosting) {
      assert.deepEqual(target.predeploy, ['node scripts/hosting-release/build-pair.cjs'], `${file} ${target.target}`);
    }
  }
});

test('every Functions build and deploy runs the gate as prebuild', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'platform', 'functions', 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.prebuild, 'node ../../scripts/unit-placement/check-parity.cjs');
  const config = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'firebase.json'), 'utf8'));
  const functions = Array.isArray(config.functions) ? config.functions : [config.functions];
  for (const codebase of functions) {
    assert.ok(codebase.predeploy.some((step) => /run build$/.test(step)), 'functions predeploy must run `npm run build`');
  }
  const staging = JSON.parse(fs.readFileSync(path.join(repositoryRoot, 'firebase.staging.json'), 'utf8'));
  assert.equal(staging.functions, undefined, 'a staging functions block would need the same predeploy');
});

// Runs the REAL `npm run prebuild` from a copy of platform/functions/
// package.json, laid out so its `../../scripts/unit-placement/check-parity.cjs`
// resolves to a copy of the gate that reads the real app tree and a chosen
// server manifest. The valid case proves the harness itself passes, so the
// drift failure is the gate's refusal and nothing else.
function runNpmPrebuild(resourceIds) {
  const root = fs.mkdtempSync(path.join(tmp, 'npm-'));
  const functionsDir = path.join(root, 'platform', 'functions');
  const gateDir = path.join(root, 'scripts', 'unit-placement');
  fs.mkdirSync(functionsDir, { recursive: true });
  fs.mkdirSync(gateDir, { recursive: true });
  fs.copyFileSync(path.join(repositoryRoot, 'platform', 'functions', 'package.json'), path.join(functionsDir, 'package.json'));
  const manifest = withIds(resourceIds);
  const source = fs
    .readFileSync(gate, 'utf8')
    .replace("const repositoryRoot = path.resolve(__dirname, '..', '..');", `const repositoryRoot = ${JSON.stringify(repositoryRoot)};`)
    .replace(/const serverManifestPath = path\.join\([\s\S]*?\);/, `const serverManifestPath = ${JSON.stringify(manifest)};`);
  fs.writeFileSync(path.join(gateDir, 'check-parity.cjs'), source);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    const stdout = execFileSync(npm, ['run', 'prebuild', '--silent'], { cwd: functionsDir, stdio: 'pipe', encoding: 'utf8' });
    return { status: 0, output: stdout };
  } catch (error) {
    return { status: error.status, output: `${error.stdout ?? ''}${error.stderr ?? ''}` };
  }
}

test('npm run prebuild (the Functions build and predeploy hook) passes on parity and refuses drift', () => {
  const ok = runNpmPrebuild(canonical);
  assert.equal(ok.status, 0, ok.output);
  const drifted = runNpmPrebuild([...canonical, 'not-a-resource']);
  assert.notEqual(drifted.status, 0);
  assert.match(drifted.output, /drifted from the RA-1 projection/);
});

test('the gate command exits non-zero on drift when run directly with node', () => {
  const drifted = withIds([...canonical, 'not-a-resource']);
  const copy = path.join(__dirname, `.check-parity-drift-${process.pid}.cjs`);
  fs.writeFileSync(
    copy,
    fs.readFileSync(gate, 'utf8').replace(
      /const serverManifestPath = path\.join\([\s\S]*?\);/,
      `const serverManifestPath = ${JSON.stringify(drifted)};`,
    ),
  );
  try {
    assert.throws(() => execFileSync(process.execPath, [copy], { stdio: 'pipe' }), (error) => error.status === 1);
  } finally {
    fs.rmSync(copy, { force: true });
  }
});

test('Platform CI runs the gate and triggers on its app-side and server inputs', () => {
  const workflow = fs.readFileSync(path.join(repositoryRoot, '.github', 'workflows', 'platform-ci.yml'), 'utf8');
  assert.match(workflow, /node \.\.\/\.\.\/scripts\/unit-placement\/check-parity\.cjs/);
  assert.match(workflow, /node --test \.\.\/\.\.\/scripts\/unit-placement\/check-parity\.test\.cjs/);
  for (const input of [
    "'platform/**'",
    "'app/src/curriculum/**'",
    "'app/scripts/build-curriculum-manifest.cjs'",
    "'app/scripts/curriculumRegistry.cjs'",
    "'app/scripts/curriculumParser.cjs'",
    "'app/scripts/activityIdentifiers.cjs'",
    "'scripts/unit-placement/**'",
  ]) {
    assert.equal(workflow.split(`- ${input}`).length - 1, 2, `${input} must trigger both pull_request and push`);
  }
});

test('Hosting release prepare runs this suite and app verify', () => {
  const { HOSTING_TEST_FILES, checkCommands } = require('../hosting-release/prepare.cjs');
  assert.ok(HOSTING_TEST_FILES.includes('scripts/unit-placement/check-parity.test.cjs'));
  assert.ok(checkCommands().some(([, args]) => args.join(' ') === '--prefix app run verify'));
});
