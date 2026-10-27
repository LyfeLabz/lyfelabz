'use strict';
// Local-only transport harness; generated configuration is disposable, never deployed.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const fixture = path.join(root, 'dist/a2-capability-emulators');
fs.mkdirSync(path.join(fixture, 'functions'), { recursive: true });
const dependencies = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).dependencies;
fs.writeFileSync(path.join(fixture, 'functions/package.json'), JSON.stringify({
  name: 'a2-capability-emulator-fixture', main: 'index.cjs', engines: { node: '22' },
  dependencies: { 'firebase-admin': dependencies['firebase-admin'], 'firebase-functions': dependencies['firebase-functions'] }
}));
// Reuse only this worktree's installed dependencies in the disposable fixture.
const fixtureModules = path.join(fixture, 'functions/node_modules');
const installedModules = path.join(root, 'node_modules');
if (!fs.existsSync(fixtureModules)) fs.symlinkSync(installedModules, fixtureModules, 'dir');
if (fs.realpathSync(fixtureModules) !== fs.realpathSync(installedModules)) throw new Error('Unexpected fixture dependency root');
// Load the real compiled production endpoint, plus a fixture-only endpoint built by the
// Option B handler factory with an explicitly injected demo-bootstrap local profile. The
// fixture exists only in this disposable directory; production exports accept no profile.
const lib = (relative) => JSON.stringify(path.join(root, 'lib', relative));
fs.writeFileSync(path.join(fixture, 'functions/index.cjs'), [
  `const capabilities = require(${lib('teacherUnits/teacher-units-capabilities.js')});`,
  `const enforcement = require(${lib('teacherUnits/a3-enforcement.js')});`,
  `const identity = require(${lib('teacherUnits/a3-runtime-identity.js')});`,
  `const { platformCallable } = require(${lib('shared/errors/https-callable.js')});`,
  `const profile = { environment: 'emulator', projectId: 'demo-bootstrap', projectNumber: '0', localProfile: { fingerprint: '${'f'.repeat(64)}', authOrigin: 'http://127.0.0.1:19199', firestoreHost: '127.0.0.1:18080', functionsOrigin: 'http://127.0.0.1:15001' } };`,
  `exports.teacherUnitsCapabilities = capabilities.teacherUnitsCapabilities;`,
  `exports.teacherUnitsCapabilitiesFixture = platformCallable({ region: 'us-central1' }, capabilities.createTeacherUnitsCapabilitiesHandler(Object.freeze({`,
  `  ...enforcement.PRODUCTION_TEACHER_UNITS_ENFORCEMENT,`,
  `  resolveIdentity: async () => { const result = await identity.resolveRuntimeIdentity(profile); return result.ok ? result.identity : null; },`,
  `})));`,
  '',
].join('\n'));
fs.writeFileSync(path.join(fixture, 'firebase.json'), JSON.stringify({
  functions:{source:'functions'},
  firestore:{rules:path.join(root,'../firebase/firestore.rules')},
  emulators:{auth:{host:'127.0.0.1',port:19199},functions:{host:'127.0.0.1',port:15001},firestore:{host:'127.0.0.1',port:18080},hub:{host:'127.0.0.1',port:14400},logging:{host:'127.0.0.1',port:14500},ui:{enabled:false},singleProjectMode:true}
}));
const test = path.join(__dirname, 'teacher-units-capabilities-transport.test.cjs');
const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
const result = spawnSync('firebase', ['emulators:exec','--only','auth,functions,firestore','--project','demo-bootstrap','--config',path.join(fixture,'firebase.json'),'--non-interactive', `node --test ${quote(test)}`], {cwd:fixture,stdio:'inherit',env:{...process.env,FIREBASE_CLI_DISABLE_UPDATE_CHECK:'true'}});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
