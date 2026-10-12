'use strict';
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
// Refuse before loading Admin SDK unless all storage/auth destinations are local demo emulators.
assert.equal(process.env.GCLOUD_PROJECT, 'demo-bootstrap');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:19199');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const { createHash } = require('node:crypto');
const manifest = require('../lib/teacherUnits/unit-placeable-resources.json');
const app = initializeApp({projectId:'demo-bootstrap'});
const auth = getAuth(app), db = getFirestore(app);
const endpoint = 'http://127.0.0.1:15001/demo-bootstrap/us-central1/teacherUnitsCapabilities';
const payload = {schemaVersion:1,nonce:'transport_nonce_0123456789',clientContractVersion:'teacher-units-v1'};
let teacherToken, studentToken, suspendedToken;
async function seed(uid, role, status = 'active') {
  const email = `${uid}@example.test`;
  await auth.createUser({uid,email,password:'emulator-password'});
  await auth.setCustomUserClaims(uid,{role,schoolId:'school-a2',districtId:'district-a2'});
  await db.doc(`users/${uid}`).set({role,status,schoolId:'school-a2'});
  const res = await fetch('http://127.0.0.1:19199/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'emulator-password',returnSecureToken:true})});
  assert.equal(res.status,200); return (await res.json()).idToken;
}
async function invoke(token, data = payload) {
  const res = await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',...(token ? {authorization:`Bearer ${token}`} : {})},body:JSON.stringify({data}),signal:AbortSignal.timeout(10000)});
  return {status:res.status,body:await res.json()};
}
before(async () => {
  await db.doc('schools/school-a2').set({districtId:'district-a2'});
  teacherToken = await seed('teacher-a2','teacher');
  studentToken = await seed('student-a2','student');
  suspendedToken = await seed('suspended-a2','teacher','suspended');
});
after(async () => { await db.terminate(); await deleteApp(app); });
test('authenticated callable transport returns canonical caller, identity and fingerprint', async () => {
  const res = await invoke(teacherToken); assert.equal(res.status,200);
  assert.deepEqual(res.body.result.caller,{uid:'teacher-a2',role:'teacher',schoolId:'school-a2',districtId:'district-a2'});
  assert.deepEqual(res.body.result.backend,{projectId:'demo-bootstrap',environment:'emulator',region:'us-central1'});
  assert.equal(res.body.result.nonce,payload.nonce);
  assert.equal(res.body.result.teacherUnits.placementFingerprint,createHash('sha256').update(JSON.stringify(manifest.resourceIds)).digest('hex'));
  assert.equal(res.body.result.teacherUnits.supportedOperations.length,8);
  assert.equal('availability' in res.body.result.teacherUnits,false);
});
test('missing and invalid tokens are refused through the actual callable transport', async () => {
  for (const token of [undefined,'invalid-token']) { const res = await invoke(token); assert.equal(res.status,401); assert.equal(res.body.error.status,'UNAUTHENTICATED'); }
});
test('student and suspended account are refused through canonical authorization', async () => {
  for (const token of [studentToken,suspendedToken]) { const res = await invoke(token); assert.equal(res.status,403); assert.equal(res.body.error.status,'PERMISSION_DENIED'); }
});
test('closed request schema rejects unknown project identity and unsupported versions', async () => {
  for (const data of [{...payload,projectId:'lyfelabz-prod'},{...payload,schemaVersion:2},{...payload,clientContractVersion:'v2'}]) { const res = await invoke(teacherToken,data); assert.equal(res.status,400); assert.equal(res.body.error.details.code,'teacherUnits.invalidRequest'); }
});
test('canonical district change refuses a formerly valid token', async () => {
  await db.doc('schools/school-a2').update({districtId:'other-district'});
  try { const res = await invoke(teacherToken); assert.equal(res.status,403); assert.equal(res.body.error.details.code,'district-mismatch'); }
  finally { await db.doc('schools/school-a2').update({districtId:'district-a2'}); }
});
test('capability calls leave unit, receipt and audit collections empty', async () => {
  await invoke(teacherToken);
  for (const collection of ['teacherUnits','teacherUnitCreateReceipts','auditEvents']) assert.equal((await db.collection(collection).get()).size,0);
});

test('emulator limitation: altered token audience is decoded without production verification', async () => {
  const parts = teacherToken.split('.');
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  claims.aud = 'demo-other-project'; claims.iss = 'https://securetoken.google.com/demo-other-project';
  const wrongProjectToken = `${parts[0]}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.${parts[2]}`;
  const res = await invoke(wrongProjectToken);
  // Functions emulator decodes unsigned local tokens without enforcing audience.
  // This is evidence of the emulator boundary, not production token verification.
  assert.equal(res.status,200); assert.equal(res.body.result.backend.projectId,'demo-bootstrap');
});
test('canonical school change refuses a formerly valid school claim', async () => {
  await db.doc('schools/school-other-a2').set({districtId:'district-a2'});
  await db.doc('users/teacher-a2').update({schoolId:'school-other-a2'});
  try { const res = await invoke(teacherToken); assert.equal(res.status,403); assert.equal(res.body.error.details.code,'claim-state-mismatch'); }
  finally { await db.doc('users/teacher-a2').update({schoolId:'school-a2'}); }
});
