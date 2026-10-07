'use strict';

// Certify a paired Hosting release after the deploy. Read-only.
//
//   node scripts/hosting-release/certify.cjs --project lyfelabz-prod
//
// Run from the same release checkout whose artifacts were deployed. Checks:
//   - the local artifacts still match dist/hosting-release/pair-build.json;
//   - both sites' live releases carry the expected `release <sha>` message,
//     differ from the prepare baseline, and serve the expected routing config;
//   - every served, non-redirected path on each live origin matches the local
//     artifact byte for byte (cache-busted), so shared runtime assets and both
//     homepage copies cannot be stale;
//   - both homepages are identical live;
//   - the contract's redirect and route samples, including marketing-only and
//     app-only behavior;
//   - catalog navigation from every public entry reaches current app lessons.
// Later phases add canonical and sitemap checks beside these.

const fs = require('node:fs');
const path = require('node:path');

const { certifyPublicEntry } = require('../marketing-hosting/certify-delivery.cjs');
const { pairRecordPath } = require('./build-pair.cjs');
const {
  TARGETS,
  artifactFiles,
  environmentForProject,
  loadContract,
  readConfigFile,
  readHostingTargets,
  readTargetSites,
  repositoryRoot,
  sameRouting,
  servedFiles,
  sha256
} = require('./contract.cjs');
const {
  checkSamples,
  compareLiveFiles,
  liveRelease,
  parseArgs,
  releaseMessage,
  rollbackCommand,
  shellQuote,
  writeRecord
} = require('./release.cjs');

function readJsonIfPresent(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

// The deployed artifacts must be exactly the recorded pair build.
function verifyLocalPair(record, directories) {
  if (!record || record.kind !== 'lyfelabz.hostingPairBuild') throw new Error('[hosting-release] no pair-build record; run prepare (or build-pair) in this checkout first');
  for (const target of TARGETS) {
    const recorded = record.files[target];
    const actual = Object.fromEntries(artifactFiles(directories[target]).map((file) => [file, sha256(fs.readFileSync(path.join(directories[target], file)))]));
    if (JSON.stringify(actual) !== JSON.stringify(recorded)) throw new Error(`[hosting-release] ${target} artifact changed since the recorded pair build`);
  }
}

async function certify({ project, fetchImpl = fetch, run, certifyEntry = certifyPublicEntry, log = console.log }) {
  const contract = loadContract();
  const environment = environmentForProject(project, contract);
  const config = readHostingTargets(readConfigFile(environment.config));
  const prodTargets = readHostingTargets(readConfigFile('firebase.json'));
  const directories = { app: path.join(repositoryRoot, prodTargets.app.public), marketing: path.join(repositoryRoot, prodTargets.marketing.public) };
  const pairRecord = readJsonIfPresent(pairRecordPath);
  verifyLocalPair(pairRecord, directories);
  const { sha, dirty } = pairRecord.source;
  if (environment.name === 'production' && dirty !== false) throw new Error('[hosting-release] production certification requires artifacts built from a clean checkout');
  const message = releaseMessage(sha, dirty);
  const prepared = readJsonIfPresent(path.join(repositoryRoot, 'dist', 'hosting-release', `prepare-${project}.json`));
  const sites = readTargetSites(project);
  const failures = [];
  const surfaces = {};

  for (const target of TARGETS) {
    const live = liveRelease({ project, site: sites[target], run });
    const previous = prepared && prepared.source?.sha === sha ? prepared.surfaces?.[target]?.baseline?.version ?? null : null;
    surfaces[target] = { site: sites[target], version: live.version, releaseTime: live.releaseTime, previous };
    if (live.message !== message) failures.push(`${target}: live release message is ${JSON.stringify(live.message)}, expected ${JSON.stringify(message)}`);
    if (previous && previous === live.version) failures.push(`${target}: live version ${live.version} is still the pre-release baseline`);
    if (!sameRouting(config[target], live.config)) failures.push(`${target}: live routing config differs from ${environment.config}`);
    const bytes = await compareLiveFiles({
      origin: environment.origins[target],
      directory: directories[target],
      files: servedFiles(directories[target], config[target]),
      entry: config[target],
      fetchImpl
    });
    for (const file of bytes.changed) failures.push(`${target}: live bytes differ for ${file}`);
    for (const file of bytes.missing) failures.push(`${target}: not served live: ${file}`);
    surfaces[target].bytes = { matched: bytes.unchanged.length, redirected: bytes.redirected.length };
    log(`[hosting-release] ${target} ${sites[target]} ${live.version}: ${bytes.unchanged.length} paths match, ${bytes.changed.length + bytes.missing.length} problems`);
  }

  const homepages = [];
  for (const origin of [environment.origins.app, environment.origins.marketing, ...environment.entryAliases]) {
    const response = await fetchImpl(`${origin}/?hosting-release=${Date.now().toString(36)}`, { headers: { 'Cache-Control': 'no-cache' } });
    homepages.push({ origin, status: response.status, sha256: sha256(Buffer.from(await response.arrayBuffer())) });
  }
  const expectedHome = sha256(fs.readFileSync(path.join(directories.marketing, 'index.html')));
  for (const home of homepages) {
    if (home.status !== 200 || home.sha256 !== expectedHome) failures.push(`homepage at ${home.origin} is not the released index.html (HTTP ${home.status})`);
  }

  failures.push(...(await checkSamples({ contract, origins: environment.origins, fetchImpl })));

  for (const entry of [environment.origins.marketing, ...environment.entryAliases]) {
    try {
      const result = await certifyEntry({ entry: `${entry}/`, canonical: environment.origins.app, artifact: directories.app });
      log(`[hosting-release] catalog navigation from ${entry}: ${result.checked} checks passed`);
    } catch (error) {
      failures.push(`catalog navigation from ${entry}: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    const rollback = TARGETS.filter((target) => surfaces[target].previous)
      .map((target) => `  ${shellQuote(rollbackCommand(project, surfaces[target].site, surfaces[target].previous))}`);
    throw new Error(`[hosting-release] certification FAILED for ${project}:\n${failures.join('\n')}` +
      (rollback.length ? `\n\nPaired rollback to the prepare baseline:\n${rollback.join('\n')}` : ''));
  }

  const record = {
    kind: 'lyfelabz.hostingCertifiedRelease',
    schemaVersion: 1,
    certifiedAt: new Date().toISOString(),
    project,
    source: { sha, dirty },
    message,
    app: surfaces.app,
    marketing: surfaces.marketing
  };
  return { record, recordPath: writeRecord(`certified-${project}-${sha}.json`, record) };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, { values: ['project'], flags: [] });
  const { record, recordPath } = await certify({ project: args.project });
  console.log(`\nCERTIFIED paired release for ${record.project}`);
  console.log(JSON.stringify({ sha: record.source.sha, app: record.app, marketing: record.marketing }, null, 2));
  console.log(`Record: ${path.relative(repositoryRoot, recordPath)} (add the pair to the release ledger; do not commit the record file)`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { certify, verifyLocalPair };
