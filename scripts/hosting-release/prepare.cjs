'use strict';

// Prepare one paired Hosting release. Never deploys.
//
//   node scripts/hosting-release/prepare.cjs --project lyfelabz-prod [--expect-sha <sha>]
//   node scripts/hosting-release/prepare.cjs --project lyfelabz-staging [--allow-dirty] [--offline]
//
// Refuses an unsupported or missing project, a dirty checkout (staging may
// opt in with --allow-dirty), a SHA mismatch, catalog or staging-config
// drift, bad target mappings, failing app verification or Hosting tests, and
// a failing pair contract. Online (required for production) it records each
// site's live version as the rollback baseline, compares live routing config
// and bytes with the new artifacts, and prints the exact deploy command.
// Records go to dist/hosting-release/ (ignored; never commit them).

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const { buildPair } = require('./build-pair.cjs');
const {
  TARGETS,
  environmentForProject,
  loadContract,
  readConfigFile,
  readHostingTargets,
  readTargetSites,
  repositoryRoot,
  sameRouting,
  servedFiles
} = require('./contract.cjs');
const {
  compareLiveFiles,
  deployCommand,
  gitState,
  liveRelease,
  parseArgs,
  releaseMessage,
  rollbackCommand,
  shellQuote,
  writeRecord
} = require('./release.cjs');
const { checkStagingConfig } = require('./staging-config.cjs');

const HOSTING_TEST_FILES = Object.freeze([
  'scripts/app-hosting/build.test.cjs',
  'scripts/marketing-hosting/build.test.cjs',
  'scripts/marketing-hosting/delivery.test.cjs',
  'scripts/hosting-release/config.test.cjs',
  'scripts/hosting-release/pair.test.cjs',
  'scripts/hosting-release/release.test.cjs'
]);

// Source and configuration gates that need no build, network, or git writes.
function preflight({ project, expectSha, allowDirty, offline }, { git = gitState } = {}) {
  const contract = loadContract();
  const environment = environmentForProject(project, contract);
  const production = environment.name === 'production';
  if (production && allowDirty) throw new Error('[hosting-release] --allow-dirty is not permitted for production');
  if (production && offline) throw new Error('[hosting-release] production prepare must record live baselines; --offline is not permitted');
  const source = git();
  if (source.dirty && !allowDirty) {
    throw new Error(`[hosting-release] release checkout is not clean:\n${source.changes.join('\n')}`);
  }
  if (expectSha && expectSha !== source.sha) throw new Error(`[hosting-release] HEAD is ${source.sha}, expected ${expectSha}`);
  if (fs.existsSync(path.join(repositoryRoot, 'firebase.marketing.json'))) {
    throw new Error('[hosting-release] firebase.marketing.json must not exist; marketing deploys only as the firebase.json marketing target');
  }
  readHostingTargets(readConfigFile('firebase.json'));
  readHostingTargets(readConfigFile('firebase.staging.json'));
  if (!checkStagingConfig().ok) throw new Error('[hosting-release] firebase.staging.json drifted from firebase.json; regenerate it');
  const sites = readTargetSites(project);
  return { contract, environment, source, sites, message: releaseMessage(source.sha, source.dirty) };
}

function runChecks(log = console.log) {
  log('[hosting-release] npm --prefix app run verify');
  execFileSync('npm', ['--prefix', 'app', 'run', 'verify'], { cwd: repositoryRoot, stdio: 'inherit' });
  log('[hosting-release] Hosting tests');
  execFileSync(process.execPath, ['--test', ...HOSTING_TEST_FILES], { cwd: repositoryRoot, stdio: 'inherit' });
}

async function liveComparison({ environment, sites, built, run }) {
  const config = readHostingTargets(readConfigFile(environment.config));
  const directories = { app: built.appDirectory, marketing: built.marketingDirectory };
  const surfaces = {};
  for (const target of TARGETS) {
    let baseline = null;
    try {
      baseline = liveRelease({ project: environment.project, site: sites[target], run });
    } catch (error) {
      if (environment.name === 'production') throw error;
      surfaces[target] = { site: sites[target], baseline: null, note: `no live baseline: ${error.message}` };
      continue;
    }
    const files = servedFiles(directories[target], config[target]);
    const bytes = await compareLiveFiles({ origin: environment.origins[target], directory: directories[target], files, entry: config[target] });
    surfaces[target] = {
      site: sites[target],
      baseline: { version: baseline.version, releaseTime: baseline.releaseTime, message: baseline.message },
      routingChanges: !sameRouting(config[target], baseline.config),
      bytes: { unchanged: bytes.unchanged.length, changed: bytes.changed, new: bytes.missing, redirected: bytes.redirected.length }
    };
  }
  return surfaces;
}

function summarize({ environment, source, message, built, surfaces }) {
  const lines = [
    '',
    `Hosting pair release prepared for ${environment.project} (${environment.name})`,
    `  source   ${source.sha}${source.dirty ? ' (UNCOMMITTED working tree)' : ''}`,
    `  pair     ${built.record.pair.identical}/${built.record.pair.shared} shared paths byte-identical; app ${built.record.pair.app} served, marketing ${built.record.pair.marketing} served`
  ];
  for (const target of TARGETS) {
    const surface = surfaces?.[target];
    if (!surface) {
      lines.push(`  ${target.padEnd(9)} live comparison skipped (--offline)`);
      continue;
    }
    if (!surface.baseline) {
      lines.push(`  ${target.padEnd(9)} ${surface.site}: ${surface.note}`);
      continue;
    }
    lines.push(`  ${target.padEnd(9)} ${surface.site} live ${surface.baseline.version} (${surface.baseline.releaseTime}, message: ${surface.baseline.message || 'none'})`);
    lines.push(`            routing config ${surface.routingChanges ? 'WOULD CHANGE' : 'unchanged'}; ${surface.bytes.changed.length} changed, ${surface.bytes.new.length} new, ${surface.bytes.unchanged} unchanged, ${surface.bytes.redirected} shadowed by redirects`);
    for (const file of [...surface.bytes.changed.map((f) => `changed ${f}`), ...surface.bytes.new.map((f) => `new     ${f}`)]) lines.push(`              ${file}`);
  }
  lines.push('', 'Deploy (separately authorized; NOT atomic across the two sites):', `  ${shellQuote(deployCommand(environment, message))}`);
  const baselines = TARGETS.filter((target) => surfaces?.[target]?.baseline);
  if (baselines.length > 0) {
    lines.push('', 'Paired rollback to the recorded baseline (restore BOTH sites):');
    for (const target of baselines) {
      lines.push(`  ${shellQuote(rollbackCommand(environment.project, surfaces[target].site, surfaces[target].baseline.version))}`);
    }
  }
  lines.push('', `Then certify: node scripts/hosting-release/certify.cjs --project ${environment.project}`);
  return lines.join('\n');
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv, { values: ['project', 'expect-sha'], flags: ['allow-dirty', 'offline'] });
  const gate = preflight({ project: args.project, expectSha: args['expect-sha'], allowDirty: Boolean(args['allow-dirty']), offline: Boolean(args.offline) });
  runChecks();
  const built = buildPair();
  const surfaces = args.offline ? null : await liveComparison({ environment: gate.environment, sites: gate.sites, built });
  const record = {
    kind: 'lyfelabz.hostingPreparedRelease',
    schemaVersion: 1,
    preparedAt: new Date().toISOString(),
    project: gate.environment.project,
    environment: gate.environment.name,
    source: { sha: gate.source.sha, dirty: gate.source.dirty },
    message: gate.message,
    sites: gate.sites,
    surfaces
  };
  const recordPath = writeRecord(`prepare-${gate.environment.project}.json`, record);
  console.log(summarize({ ...gate, built, surfaces }));
  console.log(`\nRecord: ${path.relative(repositoryRoot, recordPath)}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = { HOSTING_TEST_FILES, liveComparison, preflight, summarize };
