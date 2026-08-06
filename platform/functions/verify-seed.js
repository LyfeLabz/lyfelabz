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
  users.users.forEach(u => console.log("  uid=" + u.uid + " email=" + u.email + " claims=" + JSON.stringify(u.customClaims)));
}
main().catch(e => { console.error(e.message); process.exitCode=1; });
