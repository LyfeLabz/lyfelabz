'use strict';
// A3-3 capability transport through the real Functions/Auth/Firestore emulators.
//
// The A2 schema 1 / teacher-units-v1 positive transport is retired (approved A3-3
// decision record, Decision 1). Production exports resolve runtime identity with no
// emulator profile, so they refuse before any tenant read. The fixture endpoint is
// built by the A3-3 handler factory with an injected demo-bootstrap profile, but the
// Functions emulator sets K_SERVICE and K_REVISION, and the committed A3-2 resolver
// refuses those execution labels in emulator mode. Positive A3 discovery is
// therefore proven by the Firestore-emulator jest suite (teacher-units.emulator.test.ts),
// which binds the real resolver; this harness proves the transport-level refusals.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
// Refuse before loading Admin SDK unless all storage/auth destinations are local demo emulators.
assert.equal(process.env.GCLOUD_PROJECT, 'demo-bootstrap');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST, '127.0.0.1:19199');
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:18080');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const app = initializeApp({projectId:'demo-bootstrap'});
const auth = getAuth(app), db = getFirestore(app);
const base = 'http://127.0.0.1:15001/demo-bootstrap/us-central1';
const production = `${base}/teacherUnitsCapabilities`;
const fixture = `${base}/teacherUnitsCapabilitiesFixture`;
const v2 = {schemaVersion:2,nonce:'transport_nonce_0123456789',clientContractVersion:'teacher-units-v2'};
const v1 = {schemaVersion:1,nonce:'transport_nonce_0123456789',clientContractVersion:'teacher-units-v1'};
const profile = {environment:'emulator',projectId:'demo-bootstrap',projectNumber:'0',localProfile:{fingerprint:'f'.repeat(64),authOrigin:'http://127.0.0.1:19199',firestoreHost:'127.0.0.1:18080',functionsOrigin:'http://127.0.0.1:15001'}};
let teacherToken, studentToken;
async function seed(uid, role, status = 'active') {
  const email = `${uid}@example.test`;
  await auth.createUser({uid,email,password:'emulator-password'});
  await auth.setCustomUserClaims(uid,{role,schoolId:'school-a2',districtId:'district-a2'});
  await db.doc(`users/${uid}`).set({role,status,schoolId:'school-a2'});
  const res = await fetch('http://127.0.0.1:19199/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'emulator-password',returnSecureToken:true})});
  assert.equal(res.status,200); return (await res.json()).idToken;
}
async function invoke(endpoint, token, data = v2) {
  const res = await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',...(token ? {authorization:`Bearer ${token}`} : {})},body:JSON.stringify({data}),signal:AbortSignal.timeout(10000)});
  return {status:res.status,body:await res.json()};
}
function assertIdentityRefusal(res) {
  assert.equal(res.status,503);
  assert.equal(res.body.error.status,'UNAVAILABLE');
  assert.deepEqual(res.body.error.details,{code:'teacherUnits.runtimeIdentityUnavailable'});
  assert.equal('result' in res.body,false);
}
before(async () => {
  await db.doc('schools/school-a2').set({districtId:'district-a2'});
  teacherToken = await seed('teacher-a2','teacher');
  studentToken = await seed('student-a2','student');
});
after(async () => { await db.terminate(); await deleteApp(app); });
test('production export refuses v2, legacy v1 and caller-supplied profiles before tenant reads', async () => {
  for (const data of [v2, v1, {...v2, emulatorProfile: profile}]) assertIdentityRefusal(await invoke(production, teacherToken, data));
  // Runtime identity precedes canonical authorization: a student is refused the same way.
  assertIdentityRefusal(await invoke(production, studentToken));
});
test('fixture endpoint with an injected demo profile is refused under Functions emulator execution labels', async () => {
  for (const data of [v2, v1]) assertIdentityRefusal(await invoke(fixture, teacherToken, data));
});
test('missing and invalid tokens reach the handler and are refused by runtime identity first', async () => {
  // The Functions emulator does not reject a malformed token at the transport; under A2
  // the 401 came from canonical authentication, which now follows runtime identity.
  for (const token of [undefined, 'invalid-token']) {
    assertIdentityRefusal(await invoke(production, token));
    assertIdentityRefusal(await invoke(fixture, token));
  }
});
test('capability calls leave unit, receipt, audit and policy collections untouched', async () => {
  await invoke(production, teacherToken); await invoke(fixture, teacherToken);
  for (const collection of ['teacherUnits','teacherUnitCreateReceipts','auditEvents','teacherUnitsBackendReleases','teacherUnitsReleaseEvidence']) assert.equal((await db.collection(collection).get()).size,0);
  assert.equal((await db.doc('platformConfig/teacherUnitsAvailability').get()).exists,false);
});
