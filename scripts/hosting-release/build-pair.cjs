'use strict';

// The one Hosting build. Both firebase.json targets use it as their predeploy,
// so every deploy (the normal two-target release or an emergency single-target
// deploy) builds and gates both artifacts from the same checkout:
//
//   1. the committed homepage catalog matches the curriculum registry;
//   2. the application bundle is built;
//   3. Teacher Units intent alone rebuilds Functions for backend comparison;
//   4. the app and marketing artifacts are built from their manifests;
//   5. the pair ownership/parity gate passes;
//   6. dist/hosting-release/pair-build.json records the source and file hashes.
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

const FUNCTIONS_BUILD = Object.freeze(['npm', ['--prefix', 'platform/functions', 'run', 'build']]);
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

function buildPair({ intent, runBundleBuild = true, runFunctionsBuild = true, log = console.log, placementParity = assertUnitPlacementParity } = {}) {
  const config = readConfigFile(productionConfigFile);
  const targets = readHostingTargets(config);
  assertCatalogCurrent();
  const unitPlacement = placementParity();
  require('./backend-state.cjs').releaseIntent(intent);
  if (runBundleBuild) {
    // Same controlled builder used by npm app build; explicit intent changes evidence, never availability.
    execFileSync(process.execPath, [path.join(repositoryRoot, 'app/scripts/build-application.cjs'), '--build', repositoryRoot, intent], { cwd:repositoryRoot, stdio:['ignore','ignore','inherit'] });
  }
  if (intent === 'teacher-units' && runFunctionsBuild) {
    // Rebuild the packaged runtime locally, without deploying Functions.
    fs.rmSync(path.join(repositoryRoot, 'platform/functions/lib'), { recursive: true, force: true });
    execFileSync(FUNCTIONS_BUILD[0], FUNCTIONS_BUILD[1], { cwd: repositoryRoot, stdio: 'inherit' });
  }
  const appDirectory = path.join(repositoryRoot, targets.app.public);
  const marketingDirectory = path.join(repositoryRoot, targets.marketing.public);
  const app = buildApplicationArtifact({ outputDirectory: appDirectory });
  const marketing = buildMarketingArtifact({ outputDirectory: marketingDirectory });
  const pair = verifyPair({ appDirectory, marketingDirectory, config });
  const record = {
    kind: 'lyfelabz.hostingPairBuild',
    schemaVersion: 3,
    releaseIntent: intent,
    builtAt: new Date().toISOString(),
    source: gitSource(),
    unitPlacement,
    pair,
    files: { app: hashInventory(appDirectory), marketing: hashInventory(marketingDirectory) }
  };
  record.candidate = require('./backend-state.cjs').releaseCandidate(record);
  if (intent === 'teacher-units') record.backendCandidate = record.candidate;
  fs.mkdirSync(recordDirectory, { recursive: true });
  fs.writeFileSync(pairRecordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  log(
    `[hosting-release] pair built: app ${app.files.length} files (${pair.app} served), ` +
      `marketing ${marketing.files.length} files (${pair.marketing} served), ` +
      `${pair.identical}/${pair.shared} shared paths byte-identical`,
  );
  return { record, appDirectory, marketingDirectory };
}

// Validate prepared bytes before any rebuild can erase mutation evidence.
function verifyPreparedPair({prepared, project, read, candidateFor, directories}) {
  const existing = read(pairRecordPath);
  const targets = readHostingTargets(readConfigFile(productionConfigFile));
  const actualDirectories = directories || Object.fromEntries(Object.entries(targets).map(([target, config]) => [target, path.join(repositoryRoot, config.public)]));
  require('./certify.cjs').verifyLocalPair(existing, actualDirectories);
  const candidate = candidateFor(existing);
  if (require('./backend-state.cjs').canonical(existing.candidate) !== require('./backend-state.cjs').canonical(candidate)) throw new Error('[hosting-release] prepared pair candidate changed');
  require('./backend-state.cjs').verifyPrepared(prepared, project, candidate);
}

// Firebase invokes this hook for EACH target. The online preparation record
// supplies the explicit intent; missing/old/offline/mismatched records refuse.
// Rebuild and verify the same pair. There is no environment-variable bypass.
async function hostingPredeploy({ project = process.env.GCLOUD_PROJECT, build = buildPair,
  verify = require('./backend-state.cjs').verifyBackend, write = require('./release.cjs').writeRecord,
  read = file => JSON.parse(fs.readFileSync(file, 'utf8')), candidateFor = require('./backend-state.cjs').releaseCandidate,
  discover = require('./release.cjs').liveRelease, verifyExisting = verifyPreparedPair } = {}) {
  const {environmentForProject,readTargetSites} = require('./contract.cjs');
  const {releaseIntent,verifyPrepared,assertFresh,assertCompatible,canonical} = require('./backend-state.cjs');
  environmentForProject(project);
  let prepared;
  try { prepared = read(path.join(recordDirectory, `prepare-${project}.json`)); }
  catch { throw new Error('[hosting-release] missing or malformed online prepare evidence; prepare with explicit --intent first'); }
  const intent = releaseIntent(prepared?.releaseIntent);
  verifyPrepared(prepared, project, prepared.candidate);
  verifyExisting({prepared, project, read, candidateFor});
  const built = build({intent});
  if (built.record.schemaVersion !== 3 || built.record.releaseIntent !== intent) throw new Error('[hosting-release] rebuilt pair intent/schema differs from preparation');
  const candidate = candidateFor(built.record);
  verifyPrepared(prepared, project, candidate);
  if (environmentForProject(project).name === 'production' && candidate.source.dirty !== false) throw new Error('[hosting-release] production requires a clean candidate');
  // Independently prove project/site membership even for a general release.
  const hosting = Object.fromEntries(Object.entries(readTargetSites(project)).map(([target,site]) => [target,discover({project,site})]));
  const backend = intent === 'teacher-units' ? await verify({project,pair:built.record}) : null;
  if (intent === 'teacher-units') {
    if (!backend || canonical(backend.candidate) !== canonical(candidate)) throw new Error('[hosting-release] missing or changed Teacher Units backend candidate');
    assertFresh(backend.evidence, project);
    assertCompatible(candidate, backend.evidence);
  }
  const result = { releaseIntent:intent, candidate, hosting, backend,
    teacherUnitsReadiness:backend ? 'compatible-backend-observed' : 'not-evaluated' };
  write(`predeploy-${project}.json`, result);
  return result;
}
if (require.main === module) {
  hostingPredeploy().catch(error => { console.error(error.message); process.exitCode = 1; });
}

module.exports = { APP_BUNDLE_BUILD, FUNCTIONS_BUILD, buildPair, hostingPredeploy, verifyPreparedPair, gitSource, pairRecordPath, recordDirectory };
