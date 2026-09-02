// Sprint 28.5F - Human acceptance (UX review) seed. Emulator only.
//
// Purpose: stand up a compact, deterministic local dataset so a human
// reviewer can personally click through the Teacher Workspace and the
// Student Workspace end to end. This is NOT certification tooling: it
// exists solely to make the frozen v1 UX easy to experience by hand.
//
// Boundary (Sprint 28.5F):
//   - Targets the LOCAL Firebase emulators only (Auth + Firestore).
//   - Uses obvious, clearly-labeled fake local identities ("UX Review
//     Teacher", "UX Review Student", "Late Review Student"). No real
//     Google account, no production project, no deploy, no OAuth, no
//     Google Classroom mutation.
//   - Reuses the certified `deployAssessmentRevision` transaction (the
//     sole legitimate writer of assessments/*) for the four assessments
//     this review needs. It invents no second assessment mechanism.
//
// Independence from the Sprint 24B certification seed: this script is
// fully self-contained. It provisions its own org (district-beta /
// school-beta), its own LMS provider document, its own users, classes,
// enrollments, assignments, recipients, and historical attempts. It
// never touches any cert-teacher-00N identity or its accumulated
// certification evidence. It is safe to run before or after
// seed-emulator.js.
//
// Idempotent by construction: every Firestore write uses a fixed
// document id with `set` (full overwrite), and every Auth user is
// delete-then-import against a fixed uid, so a re-run restores the exact
// same dataset with no duplicates. Re-running it is the supported
// re-seed path.
//
// Requires the functions build output (`npm --prefix platform/functions
// run build`) so the certified deployment pipeline is available under
// lib/.
//
// Usage:  node ux-review-seed.js   (with the emulators running)

process.env.FIREBASE_AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
process.env.FIRESTORE_EMULATOR_HOST =
  process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";

const fs = require("fs");
const path = require("path");

const { initializeApp, getApps } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue, Timestamp } = require("firebase-admin/firestore");

const PROJECT_ID = "lyfelabz-prod";

// Shared org (matches the certified seed's org so school -> district
// resolution in requireDistrictContext is satisfied identically).
const DISTRICT_ID = "district-beta";
const SCHOOL_ID = "school-beta";

// Sprint 29G.5C - emulator-only fixtures for reviewing the direct
// allowlisted pilot-teacher activation flow. These mirror the intended
// production Weston pilot (schoolId `weston-middle`, districtId
// `district-weston`, shortName `WMS`) but exist ONLY in the emulator seed;
// no production data is created here. The school is written directly (like
// school-beta) so it carries the canonical `districtId` the shared
// district-context helper reads.
const PILOT_DISTRICT_ID = "district-weston";
const PILOT_SCHOOL_ID = "weston-middle";

// Fake local identities. The google.com provider link is what makes each
// account appear in the Auth Emulator's Google account chooser so the
// reviewer can sign in with one click and no password.
const TEACHER = {
  uid: "ux-review-teacher",
  email: "ux-review-teacher@lyfelabz-cert.example",
  name: "UX Review Teacher",
  google: "ux-google-teacher-000000000001",
  role: "teacher",
};
const STUDENT = {
  uid: "ux-review-student",
  email: "ux-review-student@lyfelabz-cert.example",
  name: "UX Review Student",
  google: "ux-google-student-000000000001",
  role: "student",
};
const LATE_STUDENT = {
  uid: "ux-late-student",
  email: "ux-late-student@lyfelabz-cert.example",
  name: "Late Review Student",
  google: "ux-google-late-000000000001",
  role: "student",
};

// Sprint 29G.5C review identities for the direct pilot-activation flow.
// Both are provisioned (NOT active) with a google.com provider link so they
// appear in the Auth Emulator chooser. PILOT_TEACHER's email is on the
// emulator allowlist and activates directly; UNLISTED_TEACHER is not on the
// allowlist and must see the safe "Teacher access has not been enabled"
// message.
const PILOT_TEACHER = {
  uid: "ux-pilot-teacher",
  email: "ux-pilot-teacher@lyfelabz-cert.example",
  name: "UX Pilot Teacher",
  google: "ux-google-pilot-000000000001",
};
const UNLISTED_TEACHER = {
  uid: "ux-unlisted-teacher",
  email: "ux-unlisted-teacher@lyfelabz-cert.example",
  name: "UX Unlisted Teacher",
  google: "ux-google-unlisted-000000000001",
};

// Classes owned by the UX Review Teacher.
const MANUAL_CLASS_ID = "ux-class-science";
const LMS_CLASS_ID = "ux-class-classroom";

// The four assessments this review depends on. Every one has a committed
// canonical payload and a v2 lesson artifact. `what-is-life` is the
// designated live-completion assignment (the certified pilot); the other
// three carry seeded historical attempts so the student surface shows
// every derived status.
const REVIEW_LESSONS = [
  "what-is-life",
  "cell-types",
  "biological-evolution",
  "earths-layers",
];

// Canonical identifier grammar (shared/assessment-identifiers.ts):
//   assessmentId = "assessment_" + slug
//   revisionId   = assessmentId + "__r" + ordinal   (cert ordinal is 1)
function assessmentIdFor(slug) {
  return `assessment_${slug}`;
}
function revisionIdFor(slug) {
  return `${assessmentIdFor(slug)}__r1`;
}

function loadDeploy() {
  const deployPath = path.join(
    __dirname,
    "lib",
    "assessments",
    "assessment-deployment.js",
  );
  if (!fs.existsSync(deployPath)) {
    throw new Error(
      "Build output missing. Run `npm --prefix platform/functions run build` " +
        "before seeding (needs lib/assessments/assessment-deployment.js).",
    );
  }
  return require(deployPath).deployAssessmentRevision;
}

function readPayload(slug) {
  const p = path.join(
    __dirname,
    "src",
    "scripts",
    "assessments",
    `${slug}.r1.json`,
  );
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

// The deployment transaction throws these codes when the deterministic
// revision / answer-key already exist. On a re-seed that means "already
// present", not an error.
const ALREADY_DEPLOYED_CODES = new Set([
  "assessmentDeployment.duplicateRevision",
  "assessmentDeployment.duplicateAnswerKey",
]);

async function deployReviewAssessments(log) {
  const deploy = loadDeploy();
  log("\n[ux-seed] Deploying review assessments via deployAssessmentRevision");
  for (const slug of REVIEW_LESSONS) {
    const payload = readPayload(slug);
    try {
      const out = await deploy(payload);
      log(
        `[ux-seed]   deployed ${out.assessmentId} revision=${out.revisionId} ` +
          `(created=${out.assessmentCreated})`,
      );
    } catch (err) {
      if (err && ALREADY_DEPLOYED_CODES.has(err.code)) {
        log(`[ux-seed]   already deployed (idempotent): ${assessmentIdFor(slug)}`);
        continue;
      }
      throw err;
    }
  }
}

// Provision one fake local user: Auth record with a synthetic google.com
// provider link, canonical custom claims, and the users/{uid} record that
// requireDistrictContext reads. Delete-then-import keeps the fixed uid
// stable across re-runs with no duplicate.
async function provisionUser(auth, db, u, log) {
  try {
    await auth.getUser(u.uid);
    await auth.deleteUser(u.uid);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
  }

  const importResult = await auth.importUsers([
    {
      uid: u.uid,
      email: u.email,
      emailVerified: true,
      displayName: u.name,
      providerData: [
        {
          uid: u.google,
          providerId: "google.com",
          email: u.email,
          displayName: u.name,
        },
      ],
    },
  ]);
  if (importResult.failureCount > 0) {
    throw new Error(
      `importUsers (${u.uid}) failed: ${JSON.stringify(importResult.errors)}`,
    );
  }

  await auth.setCustomUserClaims(u.uid, {
    role: u.role,
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
  });

  await db.collection("users").doc(u.uid).set({
    authUid: u.uid,
    status: "active",
    role: u.role,
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
    displayName: u.name,
    email: u.email,
    createdAt: FieldValue.serverTimestamp(),
  });

  log(`[ux-seed]   provisioned ${u.role} ${u.uid} (${u.name})`);
}

// Sprint 29G.5C - create a google-linked account whose users/{uid} record
// is in the `provisioned` state (no role, no schoolId, no custom claims),
// exactly the state authOnUserCreate leaves after first sign-in. Used to
// review the direct pilot-activation transition (provisioned -> active
// teacher) end to end. Emulator only.
async function provisionProvisionedTeacher(auth, db, u, log) {
  try {
    await auth.getUser(u.uid);
    await auth.deleteUser(u.uid);
  } catch (err) {
    if (err.code !== "auth/user-not-found") throw err;
  }

  const importResult = await auth.importUsers([
    {
      uid: u.uid,
      email: u.email,
      emailVerified: true,
      displayName: u.name,
      providerData: [
        {
          uid: u.google,
          providerId: "google.com",
          email: u.email,
          displayName: u.name,
        },
      ],
    },
  ]);
  if (importResult.failureCount > 0) {
    throw new Error(
      `importUsers (${u.uid}) failed: ${JSON.stringify(importResult.errors)}`,
    );
  }

  // No custom claims: a provisioned account carries none until activation.
  await db.collection("users").doc(u.uid).set({
    authUid: u.uid,
    status: "provisioned",
    displayName: u.name,
    email: u.email,
    createdAt: FieldValue.serverTimestamp(),
  });

  log(`[ux-seed]   provisioned (pre-activation) ${u.uid} (${u.name})`);
}

// Sprint 29G.5C - seed the canonical Weston pilot school + district and the
// protected teacher pilot configuration for the emulator. The school is
// written directly (like school-beta) with the canonical `districtId`; the
// same `{ name, shortName: "WMS", timezone, districtId }` shape is also
// accepted by the `schoolsCreate` callable after the 29G.5C-R1 shortName
// fix, so production can seed Weston through that callable. The allowlist
// names exactly the PILOT_TEACHER email plus the canonical `pilotSchoolId`.
// Emulator only.
async function seedPilotConfig(db, log) {
  log("\n[ux-seed] Seeding Weston pilot school + protected pilot allowlist");
  await db.collection("districts").doc(PILOT_DISTRICT_ID).set({
    name: "Weston Public Schools",
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection("schools").doc(PILOT_SCHOOL_ID).set({
    name: "Weston Middle School",
    shortName: "WMS",
    timezone: "America/New_York",
    districtId: PILOT_DISTRICT_ID,
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection("platformConfig").doc("teacherPilotAllowlist").set({
    emails: [PILOT_TEACHER.email],
    pilotSchoolId: PILOT_SCHOOL_ID,
  });
  log(
    `[ux-seed]   schools/${PILOT_SCHOOL_ID} + platformConfig/teacherPilotAllowlist (1 email, pilotSchoolId=${PILOT_SCHOOL_ID})`,
  );
}

// Restore a deterministic baseline for the review student. Completing the
// live what-is-life assessment (or retrying any of the seeded ones) writes
// immutable attempt and session documents whose ids are NOT the fixed ids
// this seed manages, so a plain re-seed would leave them behind. Deleting
// the student's attempts and sessions up front lets a re-seed restore the
// exact original state: what-is-life back to "Ready to Begin" and the other
// three back to their single seeded historical attempt. Scoped strictly to
// the review student's own documents.
async function resetReviewStudentAssessmentState(db, log) {
  log("\n[ux-seed] Clearing prior attempts/sessions for the review student");
  let removed = 0;
  const attempts = await db
    .collection("attempts")
    .where("studentId", "==", STUDENT.uid)
    .get();
  for (const doc of attempts.docs) {
    await doc.ref.delete();
    removed += 1;
  }
  const sessions = await db
    .collection("assessmentSessions")
    .where("studentId", "==", STUDENT.uid)
    .get();
  for (const doc of sessions.docs) {
    await doc.ref.delete();
    removed += 1;
  }
  log(`[ux-seed]   removed ${removed} prior attempt/session document(s)`);
}

async function seedOrg(db, log) {
  log("\n[ux-seed] Seeding org (district-beta / school-beta) + LMS provider");
  await db.collection("districts").doc(DISTRICT_ID).set({
    name: "LyfeLabz Beta District",
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection("schools").doc(SCHOOL_ID).set({
    name: "LyfeLabz Beta School",
    shortName: "Beta",
    timezone: "America/New_York",
    districtId: DISTRICT_ID,
    createdAt: FieldValue.serverTimestamp(),
  });
  await db.collection("lmsProviders").doc("googleClassroom").set({
    providerId: "googleClassroom",
    displayName: "Google Classroom",
    status: "available",
    enabled: true,
    createdAt: FieldValue.serverTimestamp(),
  });
}

async function seedClasses(db, log) {
  log("\n[ux-seed] Seeding classes");
  // Manual class: carries a join code (manual enrollment source).
  await db.collection("classes").doc(MANUAL_CLASS_ID).set({
    teacherId: TEACHER.uid,
    schoolId: SCHOOL_ID,
    title: "UX Review Science",
    grade: "6",
    block: "A",
    joinCode: "UXSCI6",
    status: "active",
    createdAt: FieldValue.serverTimestamp(),
  });
  log(`[ux-seed]   manual class ${MANUAL_CLASS_ID} (UX Review Science, join code UXSCI6)`);

  // LMS-shaped class: enrollmentSource "lms", provider ref, NO join code
  // (the Sprint 24B Phase 2B.7 join-code invariant). This demonstrates
  // the Classroom-linked card treatment without any real Google API.
  await db.collection("classes").doc(LMS_CLASS_ID).set({
    teacherId: TEACHER.uid,
    schoolId: SCHOOL_ID,
    title: "UX Review Classroom",
    grade: "6",
    block: "B",
    status: "active",
    enrollmentSource: "lms",
    lmsProviderRef: "googleClassroom",
    createdAt: FieldValue.serverTimestamp(),
  });
  log(`[ux-seed]   LMS-shaped class ${LMS_CLASS_ID} (UX Review Classroom, Google Classroom linked)`);
}

async function seedEnrollment(db, classId, student, log) {
  const id = `${classId}__${student.uid}`;
  await db.collection("enrollments").doc(id).set({
    studentId: student.uid,
    classId,
    schoolId: SCHOOL_ID,
    status: "active",
    enrolledAt: FieldValue.serverTimestamp(),
    displayNameOverride: student.name,
  });
  log(`[ux-seed]   enrolled ${student.name} in ${classId}`);
}

// Seed one published, classroom-mode assignment directly (the frozen
// snapshot model: a published assignment carries assessmentRevisionId and
// publishedAt). Recipient documents are written separately.
async function seedAssignment(db, assignmentId, lessonSlug, title, instructions, log) {
  await db.collection("assignments").doc(assignmentId).set({
    classId: MANUAL_CLASS_ID,
    teacherId: TEACHER.uid,
    schoolId: SCHOOL_ID,
    lessonSlug,
    mode: "classroom",
    status: "published",
    assessmentRevisionId: revisionIdFor(lessonSlug),
    title,
    instructions,
    createdAt: FieldValue.serverTimestamp(),
    publishedAt: FieldValue.serverTimestamp(),
  });
  log(`[ux-seed]   published assignment ${assignmentId} -> ${lessonSlug} ("${title}")`);
}

async function seedRecipient(db, assignmentId, student, log) {
  await db
    .collection("assignments")
    .doc(assignmentId)
    .collection("recipients")
    .doc(student.uid)
    .set({
      assignmentId,
      studentId: student.uid,
      classId: MANUAL_CLASS_ID,
      teacherId: TEACHER.uid,
      schoolId: SCHOOL_ID,
      districtId: DISTRICT_ID,
      assignedAt: FieldValue.serverTimestamp(),
      assignedBy: TEACHER.uid,
      source: "classPublication",
      status: "assigned",
    });
  log(`[ux-seed]   recipient ${student.name} on ${assignmentId}`);
}

// Seed one immutable historical attempt for the UX Review Student. Mirrors
// the finalize writer's record shape so the caller-scoped attempts list and
// the student-results aggregate derive the intended status. `daysAgo`
// staggers submittedAt so My Results ordering looks natural.
async function seedAttempt(db, assignmentId, lessonSlug, score, daysAgo, log) {
  const payload = readPayload(lessonSlug);
  const items = payload.items;
  const maxScore = items.reduce((sum, it) => sum + (it.points || 1), 0);
  const percentage = Math.round((score / maxScore) * 100);

  // First `score` items correct, remainder incorrect (each item is 1 pt).
  const itemResults = items.map((it, i) => {
    const isCorrect = i < score;
    const firstOption = it.options && it.options[0] ? it.options[0].optionId : null;
    return {
      itemId: it.itemId,
      isCorrect,
      pointsEarned: isCorrect ? it.points || 1 : 0,
      correctOptionId: it.correctOptionId,
      explanation: it.explanation,
      studentResponse: isCorrect ? it.correctOptionId : firstOption,
    };
  });
  const responses = itemResults.map((r) => ({
    itemId: r.itemId,
    response: r.studentResponse,
  }));

  const submittedAt = Timestamp.fromDate(
    new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000),
  );
  const attemptId = `ux-attempt-${lessonSlug}`;

  await db.collection("attempts").doc(attemptId).set({
    studentId: STUDENT.uid,
    assignmentId,
    classId: MANUAL_CLASS_ID,
    teacherId: TEACHER.uid,
    schoolId: SCHOOL_ID,
    districtId: DISTRICT_ID,
    activityId: lessonSlug,
    assessmentId: assessmentIdFor(lessonSlug),
    assessmentRevisionId: revisionIdFor(lessonSlug),
    attemptNumber: 1,
    score,
    maxScore,
    percentage,
    responses,
    itemResults,
    idempotencyKey: `ux-seed-${lessonSlug}-1`,
    submittedAt,
  });
  log(
    `[ux-seed]   attempt ${attemptId} score=${score}/${maxScore} (${percentage}%)`,
  );
}

async function main() {
  if (getApps().length === 0) initializeApp({ projectId: PROJECT_ID });
  const auth = getAuth();
  const db = getFirestore();
  const log = (m) => console.log(m);

  log("[ux-seed] Project: " + PROJECT_ID);
  log("[ux-seed] Auth emulator: " + process.env.FIREBASE_AUTH_EMULATOR_HOST);
  log("[ux-seed] Firestore emulator: " + process.env.FIRESTORE_EMULATOR_HOST);

  await deployReviewAssessments(log);
  await seedOrg(db, log);
  await seedPilotConfig(db, log);

  log("\n[ux-seed] Provisioning fake local users");
  await provisionUser(auth, db, TEACHER, log);
  await provisionUser(auth, db, STUDENT, log);
  await provisionUser(auth, db, LATE_STUDENT, log);
  // Sprint 29G.5C: provisioned (pre-activation) teachers for the direct
  // pilot-activation review.
  await provisionProvisionedTeacher(auth, db, PILOT_TEACHER, log);
  await provisionProvisionedTeacher(auth, db, UNLISTED_TEACHER, log);

  await seedClasses(db, log);
  await resetReviewStudentAssessmentState(db, log);

  log("\n[ux-seed] Seeding enrollments");
  await seedEnrollment(db, MANUAL_CLASS_ID, STUDENT, log);
  // Late Review Student is enrolled in the manual class but is deliberately
  // NOT a recipient of the what-is-life assignment, so the teacher can see
  // "Students not yet assigned" -> "Add to assignment" -> success.
  await seedEnrollment(db, MANUAL_CLASS_ID, LATE_STUDENT, log);
  await seedEnrollment(db, LMS_CLASS_ID, STUDENT, log);

  log("\n[ux-seed] Seeding published assignments");
  const A_WIL = "ux-asgn-what-is-life";
  const A_CT = "ux-asgn-cell-types";
  const A_BE = "ux-asgn-biological-evolution";
  const A_EL = "ux-asgn-earths-layers";
  await seedAssignment(db, A_WIL, "what-is-life", "What Is Life? - Check for Understanding", "Answer all ten questions. You can try again to improve your score.", log);
  await seedAssignment(db, A_CT, "cell-types", "Cell Types - Check for Understanding", "Answer all ten questions.", log);
  await seedAssignment(db, A_BE, "biological-evolution", "Biological Evolution - Check for Understanding", "Answer all ten questions.", log);
  await seedAssignment(db, A_EL, "earths-layers", "Earth's Layers - Check for Understanding", "Answer all ten questions.", log);

  log("\n[ux-seed] Seeding recipients (UX Review Student on all four)");
  await seedRecipient(db, A_WIL, STUDENT, log);
  await seedRecipient(db, A_CT, STUDENT, log);
  await seedRecipient(db, A_BE, STUDENT, log);
  await seedRecipient(db, A_EL, STUDENT, log);

  log("\n[ux-seed] Seeding historical attempts (mixed derived statuses)");
  // what-is-life: no attempt -> "Ready to Begin" (the live-completion one).
  await seedAttempt(db, A_CT, "cell-types", 6, 3, log); //  60% -> Improving
  await seedAttempt(db, A_BE, "biological-evolution", 9, 2, log); // 90% -> Well Done!
  await seedAttempt(db, A_EL, "earths-layers", 10, 1, log); // 100% -> Perfect Score

  // Verification summary.
  log("\n[ux-seed] Verification:");
  for (const col of ["classes", "enrollments", "assignments", "attempts"]) {
    const snap = await db.collection(col).get();
    log(`[ux-seed]   ${col}: ${snap.size} document(s)`);
  }
  const t = await auth.getUser(TEACHER.uid);
  const s = await auth.getUser(STUDENT.uid);
  log(`[ux-seed]   teacher google-linked: ${t.providerData.some((p) => p.providerId === "google.com")}`);
  log(`[ux-seed]   student google-linked: ${s.providerData.some((p) => p.providerId === "google.com")}`);

  log("\n[ux-seed] COMPLETE.");
  log("[ux-seed]   Teacher: UX Review Teacher (" + TEACHER.email + ")");
  log("[ux-seed]   Student: UX Review Student (" + STUDENT.email + ")");
  log("[ux-seed]   Late:    Late Review Student (" + LATE_STUDENT.email + ")");
  log("[ux-seed]   Pilot (allowlisted, provisioned): " + PILOT_TEACHER.email + " -> Continue as Teacher activates directly");
  log("[ux-seed]   Unlisted (provisioned): " + UNLISTED_TEACHER.email + " -> Continue as Teacher shows 'access not enabled'");
  log("[ux-seed]   Sign in via the Auth Emulator Google chooser; do NOT use 'Add new account'.");
}

main().catch((err) => {
  console.error("[ux-seed] FAILED:", err && err.message ? err.message : err);
  process.exitCode = 1;
});
