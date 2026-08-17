process.env.FIREBASE_AUTH_EMULATOR_HOST = "localhost:9099";
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";

const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

if (getApps().length === 0) initializeApp({ projectId: "lyfelabz-prod" });
const db = getFirestore();
const auth = getAuth();

async function main() {
  const cols = ["districts","schools","users","lmsProviders","classes","enrollments","lmsClassLinks","auditEvents","externalIdentities"];
  for (const col of cols) {
    const snap = await db.collection(col).get();
    console.log(col + ": " + snap.size + " doc(s)");
    snap.docs.forEach(d => console.log("  " + d.id + ":", JSON.stringify(d.data()).slice(0,120)));
  }
  const users = await auth.listUsers(10);
  console.log("\nAuth users: " + users.users.length);
  users.users.forEach(u => {
    const providers = u.providerData.map(p => p.providerId + "(" + p.uid + ")").join(",") || "none";
    console.log("  uid=" + u.uid + " email=" + u.email + " claims=" + JSON.stringify(u.customClaims) + " providers=[" + providers + "]");
  });
  const cert = users.users.find(u => u.uid === "cert-teacher-001");
  const certGoogle = cert && cert.providerData.some(p => p.providerId === "google.com");
  console.log("\ncert-teacher-001 google.com provider linked: " + (certGoogle ? "YES" : "NO"));

  // Certification assessment prerequisite (assign/publish path). Startup must
  // not silently proceed with an empty or malformed assessments collection:
  // that is the B6 environment defect (assignmentsPublish refuses a lesson
  // whose assessment was never deployed). For every cert lesson, verify the
  // deployed assessment, its current revision, and the revision/lesson
  // pairing production publication depends on.
  const ok = await verifyCertAssessments();
  if (!ok) process.exitCode = 1;
}

async function verifyCertAssessments() {
  let certLessons;
  try {
    certLessons = require("./lib/scripts/assessments/cert-lessons.js");
  } catch (e) {
    console.log("\ncert assessments: CANNOT VERIFY - build output missing " +
      "(run `npm --prefix platform/functions run build`): " + e.message);
    return false;
  }

  console.log("\ncert assessments (" + certLessons.CERT_LESSONS.length + " lesson(s)):");
  let allOk = true;
  for (const lesson of certLessons.CERT_LESSONS) {
    const ids = certLessons.certAssessmentIdentifiers(lesson.slug);
    const [assessmentSnap, revisionSnap, answerKeySnap] = await Promise.all([
      db.collection("assessments").doc(ids.assessmentId).get(),
      db.collection("assessmentRevisions").doc(ids.revisionId).get(),
      db.collection("assessmentAnswerKeys").doc(ids.revisionId).get(),
    ]);
    const verdict = certLessons.evaluateCertAssessment({
      slug: lesson.slug,
      assessmentExists: assessmentSnap.exists,
      assessmentData: assessmentSnap.exists ? assessmentSnap.data() : undefined,
      revisionExists: revisionSnap.exists,
      revisionData: revisionSnap.exists ? revisionSnap.data() : undefined,
      answerKeyExists: answerKeySnap.exists,
    });
    if (verdict.ok) {
      console.log("  OK   " + lesson.slug + " -> " + verdict.revisionId);
    } else {
      allOk = false;
      console.log("  FAIL " + lesson.slug + " (" + verdict.assessmentId + ")");
      verdict.problems.forEach(p => console.log("       - " + p));
    }
  }
  console.log("cert assessments: " + (allOk ? "ALL PRESENT" : "MISSING/MALFORMED - certification cannot proceed"));
  return allOk;
}

main().catch(e => { console.error(e.message); process.exitCode=1; });
