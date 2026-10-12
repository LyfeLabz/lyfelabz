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
// Load the real compiled endpoint and its dependencies; no mock auth or callable wrapper.
fs.writeFileSync(path.join(fixture, 'functions/index.cjs'), `exports.teacherUnitsCapabilities = require(${JSON.stringify(path.join(root, 'lib/teacherUnits/teacher-units-capabilities.js'))}).teacherUnitsCapabilities;\n`);
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
