'use strict';

// The one Hosting build. Both firebase.json targets use it as their predeploy,
// so every deploy (the normal two-target release or an emergency single-target
// deploy) builds and gates both artifacts from the same checkout:
//
//   1. the committed homepage catalog matches the curriculum registry;
//   2. the application bundle is built;
//   3. the app and marketing artifacts are built from their manifests;
//   4. the pair ownership/parity gate passes;
//   5. dist/hosting-release/pair-build.json records the source and file hashes.
//
// Before any of that, the U1B unit-placement parity gate must pass
// (scripts/unit-placement/check-parity.cjs): the server teacher-unit
// placement list must equal the RA-1 projection this bundle is built from.
// Its fingerprint is recorded with the pair.
//
// A two-target deploy runs this hook once per target. The second run is a
// deterministic rebuild of identical bytes (a few seconds), which is cheaper
// to trust than any skip-if-unchanged guard.

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { assertCatalogCurrent } = require('../../app/scripts/curriculumCatalog.cjs');
const { buildApplicationArtifact } = require('../app-hosting/build.cjs');
const { buildMarketingArtifact } = require('../marketing-hosting/build.cjs');
const { assertUnitPlacementParity } = require('../unit-placement/check-parity.cjs');
const {
  artifactFiles,
  productionConfigFile,
  readConfigFile,
  readHostingTargets,
  repositoryRoot,
  sha256,
  verifyPair
} = require('./contract.cjs');

const APP_BUNDLE_BUILD = Object.freeze(['npm', ['--prefix', 'app', 'run', 'build']]);
const recordDirectory = path.join(repositoryRoot, 'dist', 'hosting-release');
const pairRecordPath = path.join(recordDirectory, 'pair-build.json');

function gitSource(repoRoot = repositoryRoot) {
  try {
    const sha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
    const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], { cwd: repoRoot, encoding: 'utf8' });
    return { sha, dirty: status.trim().length > 0 };
  } catch {
    return { sha: null, dirty: null };
  }
}

function hashInventory(directory) {
  return Object.fromEntries(artifactFiles(directory).map((file) => [file, sha256(fs.readFileSync(path.join(directory, file)))]));
}

function buildPair({ runBundleBuild = true, log = console.log, placementParity = assertUnitPlacementParity } = {}) {
  const config = readConfigFile(productionConfigFile);
  const targets = readHostingTargets(config);
  assertCatalogCurrent();
  const unitPlacement = placementParity();
  if (runBundleBuild) {
    execFileSync(APP_BUNDLE_BUILD[0], APP_BUNDLE_BUILD[1], { cwd: repositoryRoot, stdio: 'inherit' });
  }
  const appDirectory = path.join(repositoryRoot, targets.app.public);
  const marketingDirectory = path.join(repositoryRoot, targets.marketing.public);
  const app = buildApplicationArtifact({ outputDirectory: appDirectory });
  const marketing = buildMarketingArtifact({ outputDirectory: marketingDirectory });
  const pair = verifyPair({ appDirectory, marketingDirectory, config });
  const record = {
    kind: 'lyfelabz.hostingPairBuild',
    schemaVersion: 1,
    builtAt: new Date().toISOString(),
    source: gitSource(),
    unitPlacement,
    pair,
    files: { app: hashInventory(appDirectory), marketing: hashInventory(marketingDirectory) }
  };
  fs.mkdirSync(recordDirectory, { recursive: true });
  fs.writeFileSync(pairRecordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  log(
    `[hosting-release] pair built: app ${app.files.length} files (${pair.app} served), ` +
      `marketing ${marketing.files.length} files (${pair.marketing} served), ` +
      `${pair.identical}/${pair.shared} shared paths byte-identical`,
  );
  return { record, appDirectory, marketingDirectory };
}

if (require.main === module) {
  try {
    buildPair();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

module.exports = { APP_BUNDLE_BUILD, buildPair, gitSource, pairRecordPath, recordDirectory };
