// Sprint 24B certification seed script - targets local emulators only
// Run: node seed-emulator.js
// Requires: firebase-admin installed in platform/functions

process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

const PROJECT_ID = "lyfelabz-prod";
const TEACHER_UID = "cert-teacher-001";
const TEACHER_EMAIL = "cert-teacher@lyfelabz-cert.example";
const TEACHER_DISPLAY_NAME = "Cert Teacher";
const DISTRICT_ID = "district-beta";
const SCHOOL_ID = "school-beta";
// Synthetic, non-sensitive provider uid. Emulator certification only. This is
// not a real Google account id; it exists solely so the fixed cert teacher
// carries a google.com provider link in the Auth Emulator.
const CERT_GOOGLE_PROVIDER_UID = "cert-google-000000000000000001";

// Second, isolated certification teacher. Provisioned for the remaining
// readonly-connection scenarios (runbook §1.6 "or use a second test teacher";
// §5 B13/B14/B15/B22 each need a FRESH readonly-only connection). It exists so
// those scenarios never have to un-widen or otherwise disturb cert-teacher-001,
// which carries the accumulated B4b/B7/B8/B9/B11/B12 evidence. It shares the
// same school/district so org fixtures are reused, but is a fully independent
// identity: its own Auth record, its own unique synthetic google.com provider
// uid, and NO LMS state of any kind (no connection, no token bundle, no class
// link, no OAuth state, no assignments, no publications). The real Google
// readonly connection for this teacher is established later, by the operator,
// through the app - never by this seed.
const TEACHER2_UID = "cert-teacher-002";
const TEACHER2_EMAIL = "cert-teacher-002@lyfelabz-cert.example";
const TEACHER2_DISPLAY_NAME = "Cert Teacher Two";
// Unique synthetic provider uid. MUST NOT collide with cert-teacher-001's
// (cert-google-000000000000000001). Same convention, different fixed value.
const CERT2_GOOGLE_PROVIDER_UID = "cert-google-000000000000000002";

// Third, isolated certification teacher. Provisioned specifically for the
// remaining fresh-readonly-only consent scenarios (runbook §5 step 6 / matrix
// line 352: B13/B14/B15/B22), which require a connection that holds ONLY the
// initial readonly scopes at the start of the flow.
//
// PRESERVATION (Sprint 25 B13 Attempt 1). cert-teacher-003 is now IMMUTABLE
// historical certification evidence. Its readonly-only fixture was valid, but
// its B13 attempt completed the consent flow instead of cancelling it, so B13
// was ATTEMPTED / NOT PASSED; the connection widened and real Google Classroom
// coursework 874805966316 was created. Do NOT treat CT-003 as a disposable
// failed fixture: do not reconnect, disconnect, overwrite, or delete its
// connection, token bundle, class link, assignment, publication, OAuth states,
// or audit events, and do not clear/reseed/restart the emulator without first
// exporting and preserving the live state. B13 Attempt 2 uses cert-teacher-004
// instead. See docs/platform/SPRINT_25_B13_CERTIFICATION_FINDINGS.md.
//
// Why a third teacher rather than reusing cert-teacher-002: cert-teacher-002's
// readonly reconnect was performed with the SAME real Google account already
// used by cert-teacher-001 ("Chris Breezy"). Because the authorization URL sets
// include_granted_scopes=true (adapter.ts), Google returned that account's
// previously-granted coursework/topics scopes even though only readonly scopes
// were requested, so cert-teacher-002's connection carries
// classroom.coursework.students and is unusable as a readonly-only fixture.
// The correct remedy is a genuinely different real Google account
// ("labzlyfe") that has never granted LyfeLabz the coursework scope; a fresh
// authorization by that account therefore yields a true readonly-only
// connection. cert-teacher-003 is the isolated LyfeLabz identity that account
// connects through. Reusing cert-teacher-002 would overwrite its deterministic
// connection doc and destroy the append-only evidence of the
// include_granted_scopes pitfall, so a fresh identity is used instead.
//
// Like cert-teacher-002 it shares the same school/district (org fixtures are
// reused) but is a fully independent identity with NO LMS state of any kind.
// The real labzlyfe Google account is NEVER encoded here: this is only the
// LyfeLabz/Auth-emulator identity, carrying a synthetic google.com provider
// uid. The real readonly connection is established later, by the operator,
// through the app - never by this seed.
const TEACHER3_UID = "cert-teacher-003";
const TEACHER3_EMAIL = "cert-teacher-003@lyfelabz-cert.example";
const TEACHER3_DISPLAY_NAME = "Cert Teacher Three";
// Unique synthetic provider uid. MUST NOT collide with cert-teacher-001's
// (...0001) or cert-teacher-002's (...0002). Same convention, next fixed value.
const CERT3_GOOGLE_PROVIDER_UID = "cert-google-000000000000000003";

// Fourth, isolated certification teacher. Provisioned for B13 Attempt 2.
//
// Why a fourth teacher rather than reusing cert-teacher-003: cert-teacher-003
// is now IMMUTABLE historical evidence of B13 Attempt 1. In that attempt CT-003
// began readonly-only, the first publish returned ACCESS_TOKEN_SCOPE_INSUFFICIENT,
// publication OAuth ran, Google authorized the additional scopes, the connection
// widened to four scopes, the token bundle rotated, LyfeLabz re-issued the
// publish exactly once, and real Google Classroom coursework 874805966316 was
// created in course "Cert 2 Lyfe Labz" (874767260810). B13 itself was
// ATTEMPTED / NOT PASSED because the cancellation condition was never exercised
// (see SPRINT_25_B13_CERTIFICATION_FINDINGS.md). Reusing CT-003 would overwrite
// its widened connection and destroy that append-only evidence, so B13 Attempt 2
// uses a fresh identity.
//
// B13 requires a connection that holds ONLY the initial readonly scopes at the
// start of the publish flow. CT-004 connects later, by the operator, through the
// app, using the real "labzlyfe" Google account AFTER that account's prior
// LyfeLabz authorization grant has been revoked - so a fresh initialConnect
// yields a true readonly-only connection (courses.readonly + rosters.readonly)
// with no carried-over coursework scope.
//
// Like CT-002 and CT-003 it shares the same school/district (org fixtures are
// reused) but is a fully independent identity with NO LMS state of any kind.
// The real labzlyfe Google account is NEVER encoded here: this is only the
// LyfeLabz/Auth-emulator identity, carrying a synthetic google.com provider uid.
// The real readonly connection is established later, by the operator, through the
// app - never by this seed.
const TEACHER4_UID = "cert-teacher-004";
const TEACHER4_EMAIL = "cert-teacher-004@lyfelabz-cert.example";
const TEACHER4_DISPLAY_NAME = "Cert Teacher Four";
// Unique synthetic provider uid. MUST NOT collide with cert-teacher-001's
// (...0001), cert-teacher-002's (...0002), or cert-teacher-003's (...0003).
// Same convention, next fixed value.
const CERT4_GOOGLE_PROVIDER_UID = "cert-google-000000000000000004";

// Provision the second, isolated certification teacher (cert-teacher-002).
//
// ADDITIVE and IDEMPOTENT by construction: it only ever touches cert-teacher-002
// and users/cert-teacher-002. It NEVER touches cert-teacher-001, its Auth record,
// its provider identity, its LMS connection, tokens, class link, OAuth states,
// assignments, publications, or audit events; and it NEVER writes any LMS
// document for cert-teacher-002. The delete-before-import affects only the
// cert-teacher-002 uid (so a rerun re-mints exactly one provider-linked record,
// same fixed uid, no duplicate) - a missing user is not an error.
//
// Because it is self-contained and additive, it is safe to run against a live
// certification emulator that already holds cert-teacher-001 evidence, via the
// SEED_CT002_ONLY isolated mode below.
async function provisionCertTeacher002(auth, db) {
  console.log("\n[seed] Provisioning isolated second cert teacher uid=" + TEACHER2_UID);

  try {
    await auth.getUser(TEACHER2_UID);
    await auth.deleteUser(TEACHER2_UID);
    console.log("[seed]    Removed pre-existing Auth user " + TEACHER2_UID + " (re-importing with provider link).");
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
  }

  const importResult = await auth.importUsers([
    {
      uid: TEACHER2_UID,
      email: TEACHER2_EMAIL,
      emailVerified: true,
      displayName: TEACHER2_DISPLAY_NAME,
      providerData: [
        {
          uid: CERT2_GOOGLE_PROVIDER_UID,
          providerId: "google.com",
          email: TEACHER2_EMAIL,
          displayName: TEACHER2_DISPLAY_NAME,
        },
      ],
    },
  ]);
  if (importResult.failureCount > 0) {
    throw new Error("importUsers (teacher2) failed: " + JSON.stringify(importResult.errors));
  }
  console.log("[seed]    Imported Auth user uid=" + TEACHER2_UID +
    " (success=" + importResult.successCount + ") with google.com provider uid=" + CERT2_GOOGLE_PROVIDER_UID);

  await auth.setCustomUserClaims(TEACHER2_UID, {
    role: "teacher",
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
  });
  console.log("[seed]    Set custom claims: role=teacher schoolId=" + SCHOOL_ID + " districtId=" + DISTRICT_ID);

  await db.collection("users").doc(TEACHER2_UID).set({
    authUid: TEACHER2_UID,
    status: "active",
    role: "teacher",
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
    displayName: TEACHER2_DISPLAY_NAME,
    email: TEACHER2_EMAIL,
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log("[seed]    Seeded users/" + TEACHER2_UID + " (no LMS state; readonly connection established later via the app).");
}

// Provision the third, isolated certification teacher (cert-teacher-003).
//
// ADDITIVE and IDEMPOTENT by construction, exactly like provisionCertTeacher002:
// it only ever touches cert-teacher-003 and users/cert-teacher-003. It NEVER
// touches cert-teacher-001 or cert-teacher-002 (their Auth records, provider
// identities, LMS connections, tokens, class links, OAuth states, assignments,
// publications, or audit events), and it NEVER writes any LMS document for
// cert-teacher-003. The delete-before-import affects only the cert-teacher-003
// uid, so a rerun re-mints exactly one provider-linked record (same fixed uid,
// no duplicate); a missing user is not an error.
//
// Because it is self-contained and additive, it is safe to run against a live
// certification emulator that already holds cert-teacher-001 and
// cert-teacher-002 evidence, via the SEED_CT003_ONLY isolated mode below.
async function provisionCertTeacher003(auth, db) {
  console.log("\n[seed] Provisioning isolated third cert teacher uid=" + TEACHER3_UID);

  try {
    await auth.getUser(TEACHER3_UID);
    await auth.deleteUser(TEACHER3_UID);
    console.log("[seed]    Removed pre-existing Auth user " + TEACHER3_UID + " (re-importing with provider link).");
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
  }

  const importResult = await auth.importUsers([
    {
      uid: TEACHER3_UID,
      email: TEACHER3_EMAIL,
      emailVerified: true,
      displayName: TEACHER3_DISPLAY_NAME,
      providerData: [
        {
          uid: CERT3_GOOGLE_PROVIDER_UID,
          providerId: "google.com",
          email: TEACHER3_EMAIL,
          displayName: TEACHER3_DISPLAY_NAME,
        },
      ],
    },
  ]);
  if (importResult.failureCount > 0) {
    throw new Error("importUsers (teacher3) failed: " + JSON.stringify(importResult.errors));
  }
  console.log("[seed]    Imported Auth user uid=" + TEACHER3_UID +
    " (success=" + importResult.successCount + ") with google.com provider uid=" + CERT3_GOOGLE_PROVIDER_UID);

  await auth.setCustomUserClaims(TEACHER3_UID, {
    role: "teacher",
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
  });
  console.log("[seed]    Set custom claims: role=teacher schoolId=" + SCHOOL_ID + " districtId=" + DISTRICT_ID);

  await db.collection("users").doc(TEACHER3_UID).set({
    authUid: TEACHER3_UID,
    status: "active",
    role: "teacher",
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
    displayName: TEACHER3_DISPLAY_NAME,
    email: TEACHER3_EMAIL,
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log("[seed]    Seeded users/" + TEACHER3_UID + " (no LMS state; readonly connection established later via the app with the labzlyfe Google account).");
}

// Provision the fourth, isolated certification teacher (cert-teacher-004).
//
// ADDITIVE and IDEMPOTENT by construction, exactly like provisionCertTeacher002
// and provisionCertTeacher003: it only ever touches cert-teacher-004 and
// users/cert-teacher-004. It NEVER touches cert-teacher-001, cert-teacher-002,
// or cert-teacher-003 (their Auth records, provider identities, LMS connections,
// tokens, class links, OAuth states, assignments, publications, or audit
// events), and it NEVER writes any LMS document for cert-teacher-004. The
// delete-before-import affects only the cert-teacher-004 uid, so a rerun
// re-mints exactly one provider-linked record (same fixed uid, no duplicate);
// a missing user is not an error.
//
// This is the safety-critical property for B13 Attempt 2: cert-teacher-003 holds
// the immutable B13 Attempt 1 evidence, and provisioning CT-004 must not disturb
// it. Because this function is self-contained and additive, it is safe to run
// against a live certification emulator that already holds cert-teacher-001,
// cert-teacher-002, and cert-teacher-003 evidence, via the SEED_CT004_ONLY
// isolated mode below.
async function provisionCertTeacher004(auth, db) {
  console.log("\n[seed] Provisioning isolated fourth cert teacher uid=" + TEACHER4_UID);

  try {
    await auth.getUser(TEACHER4_UID);
    await auth.deleteUser(TEACHER4_UID);
    console.log("[seed]    Removed pre-existing Auth user " + TEACHER4_UID + " (re-importing with provider link).");
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
  }

  const importResult = await auth.importUsers([
    {
      uid: TEACHER4_UID,
      email: TEACHER4_EMAIL,
      emailVerified: true,
      displayName: TEACHER4_DISPLAY_NAME,
      providerData: [
        {
          uid: CERT4_GOOGLE_PROVIDER_UID,
          providerId: "google.com",
          email: TEACHER4_EMAIL,
          displayName: TEACHER4_DISPLAY_NAME,
        },
      ],
    },
  ]);
  if (importResult.failureCount > 0) {
    throw new Error("importUsers (teacher4) failed: " + JSON.stringify(importResult.errors));
  }
  console.log("[seed]    Imported Auth user uid=" + TEACHER4_UID +
    " (success=" + importResult.successCount + ") with google.com provider uid=" + CERT4_GOOGLE_PROVIDER_UID);

  await auth.setCustomUserClaims(TEACHER4_UID, {
    role: "teacher",
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
  });
  console.log("[seed]    Set custom claims: role=teacher schoolId=" + SCHOOL_ID + " districtId=" + DISTRICT_ID);

  await db.collection("users").doc(TEACHER4_UID).set({
    authUid: TEACHER4_UID,
    status: "active",
    role: "teacher",
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
    displayName: TEACHER4_DISPLAY_NAME,
    email: TEACHER4_EMAIL,
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log("[seed]    Seeded users/" + TEACHER4_UID + " (no LMS state; readonly connection established later via the app with the labzlyfe Google account after its prior grant is revoked).");
}

async function main() {
  initializeApp({ projectId: PROJECT_ID });

  const auth = getAuth();
  const db = getFirestore();

  console.log("[seed] Project:", PROJECT_ID);
  console.log("[seed] Auth emulator:", process.env.FIREBASE_AUTH_EMULATOR_HOST);
  console.log("[seed] Firestore emulator:", process.env.FIRESTORE_EMULATOR_HOST);

  // Isolated mode: provision ONLY cert-teacher-002 and exit. This is the
  // supported way to add the second cert teacher to a LIVE certification
  // emulator without deleting/reimporting cert-teacher-001 or re-running the
  // (deliberately destructive) org/primary-teacher/assessment seeding. Run:
  //   SEED_CT002_ONLY=1 node seed-emulator.js
  if (process.env.SEED_CT002_ONLY) {
    console.log("[seed] SEED_CT002_ONLY set - provisioning only cert-teacher-002 (additive; cert-teacher-001 untouched).");
    await provisionCertTeacher002(auth, db);
    console.log("\n[seed] COMPLETE (isolated). Second cert teacher UID: " + TEACHER2_UID);
    return;
  }

  // Isolated mode: provision ONLY cert-teacher-003 and exit. Same additive
  // contract as SEED_CT002_ONLY: the supported way to add the third cert
  // teacher to a LIVE certification emulator without deleting/reimporting
  // cert-teacher-001 or cert-teacher-002 and without re-running the
  // (deliberately destructive) org/primary-teacher/assessment seeding. Run:
  //   SEED_CT003_ONLY=1 node seed-emulator.js
  if (process.env.SEED_CT003_ONLY) {
    console.log("[seed] SEED_CT003_ONLY set - provisioning only cert-teacher-003 (additive; cert-teacher-001 and cert-teacher-002 untouched).");
    await provisionCertTeacher003(auth, db);
    console.log("\n[seed] COMPLETE (isolated). Third cert teacher UID: " + TEACHER3_UID);
    return;
  }

  // Isolated mode: provision ONLY cert-teacher-004 and exit. Same additive
  // contract as SEED_CT002_ONLY / SEED_CT003_ONLY: the supported way to add the
  // fourth cert teacher to a LIVE certification emulator without deleting/
  // reimporting cert-teacher-001, cert-teacher-002, or cert-teacher-003, and
  // without re-running the (deliberately destructive) org/primary-teacher/
  // assessment seeding. This is the exact mode used to stage B13 Attempt 2
  // against the live emulator that holds the immutable cert-teacher-003 B13
  // Attempt 1 evidence. Run:
  //   SEED_CT004_ONLY=1 node seed-emulator.js
  if (process.env.SEED_CT004_ONLY) {
    console.log("[seed] SEED_CT004_ONLY set - provisioning only cert-teacher-004 (additive; cert-teacher-001, cert-teacher-002, and cert-teacher-003 untouched).");
    await provisionCertTeacher004(auth, db);
    console.log("\n[seed] COMPLETE (isolated). Fourth cert teacher UID: " + TEACHER4_UID);
    return;
  }

  // 1. Import Auth teacher user WITH a google.com provider link.
  //    createUser()/updateUser() cannot attach providerData, so the Auth
  //    Emulator Google IDP widget reports "No Google.com accounts exist" and the
  //    only alternative (Add New Account) would mint a random uid, breaking the
  //    fixed cert-teacher-001 Auth/Firestore mapping. importUsers() lets us
  //    attach a synthetic google.com providerData entry against the fixed uid.
  console.log("\n[seed] 1. Importing Auth teacher user uid=" + TEACHER_UID + " with google.com provider");

  // Existing-user handling: a prior createUser() seed may have created
  // cert-teacher-001 WITHOUT a google.com provider link. Delete first so the
  // re-import produces exactly the provider-linked record - no duplicates, same
  // fixed uid. Safe to rerun: a missing user is not an error.
  try {
    await auth.getUser(TEACHER_UID);
    await auth.deleteUser(TEACHER_UID);
    console.log("[seed]    Removed pre-existing Auth user (re-importing with provider link).");
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
  }

  const importResult = await auth.importUsers([
    {
      uid: TEACHER_UID,
      email: TEACHER_EMAIL,
      emailVerified: true,
      displayName: TEACHER_DISPLAY_NAME,
      providerData: [
        {
          uid: CERT_GOOGLE_PROVIDER_UID,
          providerId: "google.com",
          email: TEACHER_EMAIL,
          displayName: TEACHER_DISPLAY_NAME,
        },
      ],
    },
  ]);
  if (importResult.failureCount > 0) {
    throw new Error("importUsers failed: " + JSON.stringify(importResult.errors));
  }
  console.log("[seed]    Imported Auth user uid=" + TEACHER_UID +
    " (success=" + importResult.successCount + ") with google.com provider uid=" + CERT_GOOGLE_PROVIDER_UID);

  // 2. Set custom claims
  await auth.setCustomUserClaims(TEACHER_UID, {
    role: "teacher",
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
  });
  console.log("[seed]    Set custom claims: role=teacher schoolId=" + SCHOOL_ID + " districtId=" + DISTRICT_ID);

  // 3. Seed district
  console.log("\n[seed] 2. Seeding districts/" + DISTRICT_ID);
  await db.collection("districts").doc(DISTRICT_ID).set({
    name: "LyfeLabz Beta District",
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log("[seed]    Done.");

  // 4. Seed school
  console.log("\n[seed] 3. Seeding schools/" + SCHOOL_ID);
  await db.collection("schools").doc(SCHOOL_ID).set({
    name: "LyfeLabz Beta School",
    shortName: "Beta",
    timezone: "America/New_York",
    districtId: DISTRICT_ID,
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log("[seed]    Done.");

  // 5. Seed users/{teacherUid}
  console.log("\n[seed] 4. Seeding users/" + TEACHER_UID);
  await db.collection("users").doc(TEACHER_UID).set({
    authUid: TEACHER_UID,
    status: "active",
    role: "teacher",
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
    displayName: TEACHER_DISPLAY_NAME,
    email: TEACHER_EMAIL,
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log("[seed]    Done.");

  // 6. Seed lmsProviders/googleClassroom
  console.log("\n[seed] 5. Seeding lmsProviders/googleClassroom");
  await db.collection("lmsProviders").doc("googleClassroom").set({
    providerId: "googleClassroom",
    displayName: "Google Classroom",
    status: "available",
    enabled: true,
    createdAt: FieldValue.serverTimestamp(),
  });
  console.log("[seed]    Done.");

  // 7. Seed certification assessments (assign/publish prerequisite).
  //    assignmentsPublish refuses a draft -> published transition unless the
  //    referenced lesson already has a deployed assessment. The identity/org
  //    seed above leaves the assessments collection empty, so publication of
  //    the cert lessons fails before commit (the B6 environment defect). This
  //    reuses the already-initialized admin app and runs the certified
  //    deployment pipeline against the committed cert payloads. Idempotent.
  const { seedCertAssessments } = require("./seed-cert-assessments");
  await seedCertAssessments({ log: (m) => console.log(m) });

  // 7b. Provision the isolated second cert teacher (additive; no LMS state).
  await provisionCertTeacher002(auth, db);

  // 7c. Provision the isolated third cert teacher (additive; no LMS state).
  await provisionCertTeacher003(auth, db);

  // 7d. Provision the isolated fourth cert teacher (additive; no LMS state).
  await provisionCertTeacher004(auth, db);

  // 8. Verify state
  console.log("\n[seed] Verification:");
  const authUser = await auth.getUser(TEACHER_UID);
  console.log("[seed]   Auth uid=" + authUser.uid + " email=" + authUser.email);
  console.log("[seed]   Custom claims:", JSON.stringify(authUser.customClaims));
  console.log("[seed]   providerData:", JSON.stringify(authUser.providerData.map(p => ({ providerId: p.providerId, uid: p.uid }))));
  const hasGoogle = authUser.providerData.some(p => p.providerId === "google.com");
  console.log("[seed]   google.com provider linked: " + hasGoogle);

  const collections = ["districts", "schools", "users", "lmsProviders", "assessments", "assessmentRevisions"];
  for (const col of collections) {
    const snap = await db.collection(col).get();
    console.log("[seed]   " + col + ": " + snap.size + " document(s)");
  }

  console.log("\n[seed] COMPLETE. Teacher UIDs: " + TEACHER_UID + ", " + TEACHER2_UID + ", " + TEACHER3_UID + ", " + TEACHER4_UID);
  console.log("[seed] Sign in via the Auth Emulator Google IDP widget; all cert");
  console.log("[seed] teachers (" + TEACHER_EMAIL + ", " + TEACHER2_EMAIL + ", " + TEACHER3_EMAIL + ", " + TEACHER4_EMAIL + ") now appear in the account list.");
  console.log("[seed] Do NOT use 'Add new account' - it would mint a random uid.");
}

main().catch((err) => {
  console.error("[seed] FAILED:", err.message);
  process.exitCode = 1;
});
