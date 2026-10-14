'use strict';
// Normal compiler output always remains closed-only. No controlled profile flag.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const { inventoryRuntimeArtifact, RUNTIME_BUILD_PATH } = require('../lib/teacherUnits/a3-runtime-artifact');
const { canonicalJSON } = require('../lib/teacherUnits/a3-canonical');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const inventory = inventoryRuntimeArtifact(root);
const record = { schemaVersion: 1, enforcementVersion: 'teacher-units-a3-v1', deploymentMode: 'closed-only',
  sourceSha: git(['rev-parse', 'HEAD']), sourceTree: git(['rev-parse', 'HEAD^{tree}']),
  sourceDirty: git(['status', '--porcelain', '--untracked-files=normal']) !== '',
  runtimePayloadFingerprint: inventory.runtimePayloadFingerprint, placementFingerprint: inventory.placementFingerprint,
  supportedClientContractVersions: ['teacher-units-v2'] };
fs.writeFileSync(path.join(root, RUNTIME_BUILD_PATH), canonicalJSON(record) + '\n');
console.log('A3 runtime build record written: closed-only; no approval or availability.');
