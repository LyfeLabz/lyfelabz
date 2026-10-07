'use strict';

// Generates the committed Hosting-only staging config (firebase.staging.json)
// from the production firebase.json hosting targets, substituting each
// production origin with its staging origin from the Hosting contract.
//
//   node scripts/hosting-release/staging-config.cjs          write
//   node scripts/hosting-release/staging-config.cjs --check  fail on drift

const fs = require('node:fs');
const path = require('node:path');

const {
  generateStagingConfig,
  productionConfigFile,
  readConfigFile,
  repositoryRoot,
  serializeConfig,
  stagingConfigFile
} = require('./contract.cjs');

function renderStagingConfig(repoRoot = repositoryRoot) {
  return serializeConfig(generateStagingConfig(readConfigFile(productionConfigFile, repoRoot)));
}

function checkStagingConfig(repoRoot = repositoryRoot) {
  const target = path.join(repoRoot, stagingConfigFile);
  const committed = fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null;
  return { ok: committed === renderStagingConfig(repoRoot), path: target };
}

if (require.main === module) {
  if (process.argv.includes('--check')) {
    const result = checkStagingConfig();
    if (!result.ok) {
      console.error(`[hosting-release] DRIFT: ${stagingConfigFile} does not match ${productionConfigFile}. Regenerate with \`node scripts/hosting-release/staging-config.cjs\`.`);
      process.exitCode = 1;
    } else {
      console.log(`[hosting-release] OK: ${stagingConfigFile} matches the generated staging config`);
    }
  } else {
    fs.writeFileSync(path.join(repositoryRoot, stagingConfigFile), renderStagingConfig(), 'utf8');
    console.log(`[hosting-release] wrote ${stagingConfigFile}`);
  }
}

module.exports = { checkStagingConfig, renderStagingConfig };
