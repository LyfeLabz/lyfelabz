'use strict';
// D12: closed-only unless the operator explicitly selects policy-controlled for this build.
// The mode is fixed in compiled output at build time; nothing at runtime or request time reads
// these variables. A selectable build is never release approval, deployment approval or availability.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const RECORD = 'lib/teacherUnits/a3-runtime-build.json';
const SHA = /^[a-f0-9]{40}$/;

function selectProfile(env) {
  const profile = env.A3_BUILD_PROFILE;
  if (profile === undefined || profile === '') return 'closed-only';
  if (profile !== 'policy-controlled') throw new Error(`Unknown A3_BUILD_PROFILE: ${JSON.stringify(profile)}`);
  return profile;
}

/** Removes any previous record first, so a refused build never leaves stale output that looks current. */
function writeRuntimeBuild({ root, env, inventoryRuntimeArtifact, canonicalJSON, deriveBackendBuildId }) {
  const target = path.join(root, RECORD);
  fs.rmSync(target, { force: true });
  const mode = selectProfile(env);
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const sourceSha = git(['rev-parse', '--verify', 'HEAD^{commit}']), sourceTree = git(['rev-parse', '--verify', 'HEAD^{tree}']);
  if (!SHA.test(sourceSha) || !SHA.test(sourceTree)) throw new Error('Unresolvable Git HEAD or source tree');
  const sourceDirty = git(['status', '--porcelain', '--untracked-files=normal']) !== '';
  if (mode === 'policy-controlled') {
    const expected = env.A3_EXPECTED_SOURCE_SHA;
    if (typeof expected !== 'string' || !SHA.test(expected)) throw new Error('A3_EXPECTED_SOURCE_SHA must be 40 lowercase hexadecimal characters');
    if (sourceSha !== expected) throw new Error('HEAD does not match A3_EXPECTED_SOURCE_SHA');
    if (sourceDirty) throw new Error('Policy-controlled build requires a clean working tree (tracked and untracked)');
    if (fs.lstatSync(path.join(root, 'node_modules'), { throwIfNoEntry: false })?.isSymbolicLink())
      throw new Error('Policy-controlled build refuses symlinked node_modules');
  }
  const inventory = inventoryRuntimeArtifact(root);
  const record = { schemaVersion: 2, enforcementVersion: 'teacher-units-option-b-v1', deploymentMode: mode,
    sourceSha, sourceTree, sourceDirty,
    runtimePayloadFingerprint: inventory.runtimePayloadFingerprint, placementFingerprint: inventory.placementFingerprint,
    supportedClientContractVersions: ['teacher-units-v3'] };
  const derived = deriveBackendBuildId(record);
  if (!derived.ok) throw new Error(`Invalid Option B build: ${derived.issue.reason}`);
  record.backendBuildId = derived.value;
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, canonicalJSON(record) + '\n');
  fs.renameSync(temporary, target);
  return record;
}

module.exports = { writeRuntimeBuild, selectProfile, RECORD };

if (require.main === module) {
  const root = path.resolve(__dirname, '..');
  const { inventoryRuntimeArtifact, RUNTIME_BUILD_PATH } = require('../lib/teacherUnits/a3-runtime-artifact');
  const { deriveBackendBuildId } = require('../lib/teacherUnits/availability-runtime-build');
  const { canonicalJSON } = require('../lib/teacherUnits/a3-canonical');
  if (RUNTIME_BUILD_PATH !== RECORD) throw new Error('Runtime build path drift');
  try {
    const record = writeRuntimeBuild({ root, env: process.env, inventoryRuntimeArtifact, canonicalJSON, deriveBackendBuildId });
    console.log(`A3 runtime build record written: ${record.deploymentMode}; no approval or availability.`);
  } catch (error) {
    console.error(`A3 runtime build refused; no record written: ${error.message}`);
    process.exit(1);
  }
}
