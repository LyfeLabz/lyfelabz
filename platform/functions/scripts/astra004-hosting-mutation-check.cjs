#!/usr/bin/env node
// Local regression checks only. Each mutation is restored byte-for-byte before
// the next test run. Tests replace all transport and forbid other processes.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { createHash } = require('crypto');
const root = path.resolve(__dirname, '..');
const sourcePath = path.join(root, 'src/scripts/astra004-hosting-prepare.ts');
const testPath = path.join(root, 'src/scripts/astra004-hosting-prepare.test.ts');
const original = fs.readFileSync(sourcePath);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'astra004-mutations-'));
const mutations = [
  ['remove main environment guard', (s) => s.replace('const guardError = assertSafeEnvironment(parsed.args, env);', 'const guardError: string | null = null; void env;')],
  ['replace fixed staging origin', (s) => s.replace('export const STAGING_ORIGIN = "https://lyfelabz-staging.web.app";', 'export const STAGING_ORIGIN = "https://example.invalid";')],
  ['redirect manual -> follow', (s) => s.replace('redirect: "manual"', 'redirect: "follow"')],
  ['remove approved-manifest assertion', (s) => s.replace('  assertApprovedManifest(manifest);', '  void manifest;')],
  ['remove final only-shim/hash assertion', (s) => s.replace('    await assertOnlyShimChanged(publicPath, actual, baselineHashes, overlayShimHash);', '    void actual;')],
  ['accept SPA shell as canonical lesson', (s) => s.replace(/    if \(lesson && \([\s\S]*?\)\) fail\("canonical lesson identity"\);/, '    void lesson;')],
  ['accept HTML as JavaScript', (s) => s.replace(/    if \(looksHtml \|\|[^\n]+fail\("JavaScript\/non-HTML"\);/, '    void looksHtml;')],
  ['remove empty-body rejection', (s) => s.replace(/  if \(result\.body\.length === 0\) \{[\s\S]*?\n  \}/, '')],
  ['remove download secret scanner invocation', (s) => s.replace('      assertSecretSafe(relativePath, result.body);', '')],
  ['add unsafe Functions configuration', (s) => s.replace('export function makeHostingConfig(): Record<string, unknown> {\n  return {', 'export function makeHostingConfig(): Record<string, unknown> {\n  return { functions: {},')],
  ['remove exact public-path equality', (s) => s.replace(/  if \(JSON.stringify\(actual\) !== JSON.stringify\(expected\)\) \{[\s\S]*?\n  \}/, '  void expected;')],
  ['remove artifact symlink rejection', (s) => s.replace(/    if \(entry.isSymbolicLink\(\)\) \{[\s\S]*?\n    \}/, '')],
  ['add an unapproved subprocess', (s) => s.replace('    const repoRoot = repoRootFromCompiled();', '    execFileSync(process.execPath, ["--version"]);\n    const repoRoot = repoRootFromCompiled();')],
  ['secret: disable bracket-property credential detection', (s) => s.replace(
    /  const bracketPropertyCredential = new RegExp\([\s\S]*?\n  \)\.test\(credentialSyntax\);/,
    '  const bracketPropertyCredential = false;',
  )],
  ['secret: disable comment and parenthesized credential detection', (s) => s.replace(
    /  const credentialSyntax = text\n    \.replace\([\s\S]*?\n    \.replace\(\/\\\/\\\/\[\^\\r\\n\]\*\/g, " "\);/,
    '  const credentialSyntax = text;',
  ).replace('const credentialValue = String.raw`(?:\\(\\s*)*', 'const credentialValue = String.raw`')],
  ['secret: make credential names case-sensitive', (s) => s.replace('const credentialFlags = "im";', 'const credentialFlags = "m";')],
  ['secret: disable global Google/Firebase API-key detection', (s) => s.replace(
    'const hasGoogleFirebaseApiKey = /\\bAIza[0-9A-Za-z_-]{35}\\b/.test(text);',
    'const hasGoogleFirebaseApiKey = false;',
  )],
  ['secret: remove public Firebase config path restriction', (s) => s.replace(
    'relativePath === publicFirebaseConfigPath &&\n    sha256(bytes) === approvedBaselineHash(publicFirebaseConfigPath);',
    'sha256(bytes) === approvedBaselineHash(publicFirebaseConfigPath);',
  )],
  ['secret: remove public Firebase config hash restriction', (s) => s.replace(
    'relativePath === publicFirebaseConfigPath &&\n    sha256(bytes) === approvedBaselineHash(publicFirebaseConfigPath);',
    'relativePath === publicFirebaseConfigPath;',
  )],
];
function run(label) {
  const report = path.join(directory, 'result.json');
  fs.rmSync(report, { force: true });
  const child = spawnSync(process.execPath, [require.resolve('jest/bin/jest'), '--config', path.join(root, 'jest.config.js'),
    '--runInBand', '--no-cache', '--runTestsByPath', testPath, '--json', '--outputFile', report], {
    cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 8 * 1024 * 1024,
  });
  if (!fs.existsSync(report)) throw new Error(`${label}: test runner did not produce a report (diagnostics suppressed)`);
  const result = JSON.parse(fs.readFileSync(report, 'utf8'));
  return { exitCode: child.status, passed: result.numPassedTests, failed: result.numFailedTests,
    runtimeErrors: result.numRuntimeErrorTestSuites };
}
const results = [];
try {
  const baseline = run('baseline');
  console.log(JSON.stringify({ baseline }));
  if (baseline.exitCode !== 0 || baseline.failed || baseline.runtimeErrors) throw new Error('Baseline tests must pass before mutation testing');
  const selectedMutations = process.argv.includes('--secret-only') ?
    mutations.filter(([name]) => name.startsWith('secret:')) : mutations;
  for (const [name, mutate] of selectedMutations) {
    const changed = mutate(original.toString());
    if (changed === original.toString()) throw new Error(`Mutation did not match: ${name}`);
    let outcome;
    try {
      fs.writeFileSync(sourcePath, changed);
      outcome = run(name);
    } finally {
      fs.writeFileSync(sourcePath, original);
    }
    const result = { mutation: name, status: outcome.failed > 0 && !outcome.runtimeErrors ? 'CAUGHT' : 'NOT CAUGHT', failingTests: outcome.failed };
    results.push(result);
    console.log(JSON.stringify(result));
    if (result.status !== 'CAUGHT') throw new Error('Stop condition: mutation not caught by a focused test');
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(sourcePath, original);
  console.log(JSON.stringify({ sourceRestored: digest(fs.readFileSync(sourcePath)) === digest(original), completedMutations: results.length }));
  fs.rmSync(directory, { recursive: true, force: true });
}
