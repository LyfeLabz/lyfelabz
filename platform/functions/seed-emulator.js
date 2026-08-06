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

async function main() {
  initializeApp({ projectId: PROJECT_ID });

  const auth = getAuth();
  const db = getFirestore();

  console.log("[seed] Project:", PROJECT_ID);
  console.log("[seed] Auth emulator:", process.env.FIREBASE_AUTH_EMULATOR_HOST);
  console.log("[seed] Firestore emulator:", process.env.FIRESTORE_EMULATOR_HOST);

  // 1. Create Auth teacher user
  console.log("\n[seed] 1. Creating Auth teacher user uid=" + TEACHER_UID);
  try {
    await auth.getUser(TEACHER_UID);
    console.log("[seed]    Auth user already exists, updating...");
    await auth.updateUser(TEACHER_UID, {
      email: TEACHER_EMAIL,
      displayName: TEACHER_DISPLAY_NAME,
      emailVerified: true,
    });
  } catch (err) {
    if (err.code === "auth/user-not-found") {
      await auth.createUser({
        uid: TEACHER_UID,
        email: TEACHER_EMAIL,
        displayName: TEACHER_DISPLAY_NAME,
        emailVerified: true,
      });
      console.log("[seed]    Created Auth user uid=" + TEACHER_UID);
    } else {
      throw err;
    }
  }

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

  // 7. Verify state
  console.log("\n[seed] Verification:");
  const authUser = await auth.getUser(TEACHER_UID);
  console.log("[seed]   Auth uid=" + authUser.uid + " email=" + authUser.email);
  console.log("[seed]   Custom claims:", JSON.stringify(authUser.customClaims));

  const collections = ["districts", "schools", "users", "lmsProviders"];
  for (const col of collections) {
    const snap = await db.collection(col).get();
    console.log("[seed]   " + col + ": " + snap.size + " document(s)");
  }

  console.log("\n[seed] COMPLETE. Teacher UID: " + TEACHER_UID);
  console.log("[seed] Sign in via Auth Emulator as: " + TEACHER_EMAIL);
  console.log("[seed] OR use the emulator UI to sign in as cert-teacher-001");
}

main().catch((err) => {
  console.error("[seed] FAILED:", err.message);
  process.exitCode = 1;
});
