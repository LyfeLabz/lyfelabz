'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('../../platform/functions/node_modules/typescript');
const E = require('./option-b-evidence.cjs');
const F = require('./fixtures/synthetic-option-b.cjs');
// Compile only this adapter's source dependency closure into a private temporary
// directory. Never run the Functions build/writer or replace existing lib bytes.
const compiled = fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-b1b-source-'));
const source = path.resolve(__dirname, '../../platform/functions/src/teacherUnits/availability-runtime-build.ts');
const program = ts.createProgram([source], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  strict: true, noUnusedLocals: true, noUnusedParameters: true, esModuleInterop: true, skipLibCheck: true,
  types: ['node'], typeRoots: [path.resolve(__dirname, '../../platform/functions/node_modules/@types')], outDir: compiled });
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  fs.rmSync(compiled, { recursive: true, force: true });
  throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => process.cwd(), getCanonicalFileName: s => s, getNewLine: () => '\n',
  }));
}
program.emit();
const activeBuild = require(path.join(compiled, 'availability-runtime-build.js'));
const legacyBuild = require(path.join(compiled, 'a3-runtime-artifact.js'));
const canonical = require(path.join(compiled, 'a3-canonical.js'));
const inspect = E.createEvidenceInspector({ activeBuild, legacyBuild, canonical });
const roots = [];
test.after(() => { for (const root of [...roots, compiled]) fs.rmSync(root, { recursive: true, force: true }); });
function artifact({ historical = false, mode = 'closed-only' } = {}) {
  const f = F.buildFixture({ build: activeBuild, canonical, mode });
  if (historical) {
    delete f.record.backendBuildId;
    Object.assign(f.record, { schemaVersion: 1, enforcementVersion: 'teacher-units-a3-v1', supportedClientContractVersions: ['teacher-units-v2'] });
    f.files[F.BUILD_PATH] = `${canonical.canonicalJSON(f.record)}\n`;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lyfelabz-b1b-evidence-')); roots.push(root);
  for (const [name, body] of Object.entries(f.files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true }); fs.writeFileSync(path.join(root, name), body);
  }
  return { root, ...f };
}
test('synthetic source inputs and outputs do not claim provider verification or authorization', () => {
  const f = artifact({ mode: 'policy-controlled' }); const r = inspect({ format: E.OPTION_B_FORMAT, artifactRoot: f.root });
  assert.equal(f.provenance, 'synthetic, not provider-verified'); assert.match(fs.readFileSync(path.join(__dirname, 'fixtures/synthetic-option-b.cjs'), 'utf8'), /SYNTHETIC FIXTURE - NOT PROVIDER-VERIFIED/);
  assert.equal(r.kind, 'teacher-units-option-b-build-evidence-v1'); assert.equal(r.schemaVersion, 1);
  assert.equal(r.scope, 'application-content-consistency-only'); assert.equal(r.authority, 'none'); assert.equal(r.operationalVerification, 'unverified');
  for (const field of ['authorized', 'eligible', 'certified', 'providerVerified', 'availability']) assert.equal(Object.hasOwn(r, field), false);
  assert.deepEqual(r.build, f.record);
});
test('historical schema 1/v2 inspection stays explicit, deterministic and non-authorizing', () => {
  const f = artifact({ historical: true }); const request = { format: E.HISTORICAL_FORMAT, artifactRoot: f.root };
  const before = fs.readFileSync(path.join(f.root, F.BUILD_PATH)); const a = inspect(request), b = inspect(request);
  assert.equal(canonical.canonicalJSON(a), canonical.canonicalJSON(b)); assert.deepEqual(fs.readFileSync(path.join(f.root, F.BUILD_PATH)), before);
  assert.equal(a.scope, 'historical-inspection-only'); assert.equal(a.kind, 'teacher-units-historical-build-inspection-v1');
  assert.equal(a.authority, 'none'); assert.deepEqual(a.build, legacyBuild.inspectRuntimeArtifact(f.root).build);
  assert.equal(a.build.schemaVersion, 1); assert.deepEqual(a.build.supportedClientContractVersions, ['teacher-units-v2']);
});
test('explicit wrong format never sniffs, falls back or upgrades a record', () => {
  const old = artifact({ historical: true }), active = artifact();
  assert.throws(() => inspect({ format: E.OPTION_B_FORMAT, artifactRoot: old.root }));
  assert.throws(() => inspect({ format: E.HISTORICAL_FORMAT, artifactRoot: active.root }));
  for (const format of [undefined, null, '', 'auto', 'teacher-units-option-b-runtime-build-v3']) {
    assert.throws(() => inspect({ format, artifactRoot: active.root }), /unknown explicit evidence format/);
    assert.throws(() => E.inspectEvidence({ format, artifactRoot: active.root }), /unknown explicit evidence format/);
  }
});
test('exact local input rejects metadata overrides, accessors, relative roots and symbols', () => {
  const root = artifact().root;
  for (const input of [null, [], {}, { format: E.OPTION_B_FORMAT }, { format: E.OPTION_B_FORMAT, artifactRoot: root, authorized: true },
    { format: E.OPTION_B_FORMAT, artifactRoot: 'relative' }, { format: E.OPTION_B_FORMAT, artifactRoot: root, [Symbol('extra')]: true }])
    assert.throws(() => inspect(input), /REFUSED/);
  let calls = 0; const getter = { artifactRoot: root }; Object.defineProperty(getter, 'format', { enumerable: true, get: () => { calls++; return E.OPTION_B_FORMAT; } });
  assert.throws(() => inspect(getter), /REFUSED/); assert.equal(calls, 0);
});
test('mixed, malformed, duplicate-key and unknown stored records fail both explicit routes', () => {
  const f = artifact();
  for (const r of [{ ...f.record, schemaVersion: 3 }, { ...f.record, supportedClientContractVersions: ['teacher-units-v2'] },
    { ...f.record, enforcementVersion: 'teacher-units-a3-v1' }, { ...f.record, extra: true }, { ...f.record, backendBuildId: 'bad' }]) {
    fs.writeFileSync(path.join(f.root, F.BUILD_PATH), canonical.canonicalJSON(r));
    for (const format of [E.OPTION_B_FORMAT, E.HISTORICAL_FORMAT]) assert.throws(() => inspect({ format, artifactRoot: f.root }));
  }
  for (const bytes of ['{"schemaVersion":2,"schemaVersion":2}', 'not-json']) {
    fs.writeFileSync(path.join(f.root, F.BUILD_PATH), bytes); assert.throws(() => inspect({ format: E.OPTION_B_FORMAT, artifactRoot: f.root }));
  }
});
test('supplied payload and exact record path are independently checked', () => {
  const f = artifact(); fs.writeFileSync(path.join(f.root, 'lib/index.js'), '// changed');
  assert.throws(() => inspect({ format: E.OPTION_B_FORMAT, artifactRoot: f.root }), /content mismatch/);
  const missing = artifact(); fs.renameSync(path.join(missing.root, F.BUILD_PATH), path.join(missing.root, 'lib/teacherUnits/other.json'));
  assert.throws(() => inspect({ format: E.OPTION_B_FORMAT, artifactRoot: missing.root }));
});
test('legacy route needs no active module and active route never invokes the historical reader', () => {
  const old = artifact({ historical: true }), active = artifact(); const trap = () => { throw new Error('wrong reader invoked'); };
  const historicalOnly = E.createEvidenceInspector({ activeBuild: { inspectAvailabilityRuntimeArtifact: trap }, legacyBuild, canonical });
  assert.equal(historicalOnly({ format: E.HISTORICAL_FORMAT, artifactRoot: old.root }).build.schemaVersion, 1);
  const activeOnly = E.createEvidenceInspector({ activeBuild, legacyBuild: { inspectRuntimeArtifact: trap }, canonical });
  assert.equal(activeOnly({ format: E.OPTION_B_FORMAT, artifactRoot: active.root }).build.schemaVersion, 2);
});
