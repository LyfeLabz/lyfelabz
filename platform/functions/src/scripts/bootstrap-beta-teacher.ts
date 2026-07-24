// Sprint 20 - Internal Beta Admin Bootstrap
//
// One-off script that turns a signed-in Google user into an active
// LyfeLabz teacher without going through the normal
// requestVerification -> platformAdministrator -> approveVerification
// dance. This is a beta-only shortcut owned by the repo owner and is
// NEVER exported from the Cloud Functions bundle.
//
// Prerequisites:
//   1. The target user has already signed in at least once at
//      https://lyfelabz-prod.web.app/app/ with the target Google
//      account. `authOnUserCreate` will have written a `provisioned`
//      users/{uid} document.
//   2. Application Default Credentials are available locally. The
//      easiest way is:
//        gcloud auth application-default login
//      (or set GOOGLE_APPLICATION_CREDENTIALS to a service-account
//      JSON key with Firebase Admin permissions on lyfelabz-prod).
//   3. Run from repo root:
//        npm --prefix platform/functions run build
//        node platform/functions/lib/scripts/bootstrap-beta-teacher.js \
//          --email cgbreezy7@gmail.com
//
// After running: the target user must SIGN OUT and back in so their
// ID token picks up the new custom claims.

import { initializeApp, applicationDefault, getApps } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

const PROJECT_ID = process.env.GCLOUD_PROJECT ?? "lyfelabz-prod";
export const BETA_DISTRICT_ID = "district-beta";
export const BETA_SCHOOL_ID = "school-beta";
// The canonical `requireDistrictContext` helper resolves a school's
// district by reading `schools/{schoolId}.districtId` (see
// `../shared/auth/require-district-context.ts` and its test suite). The
// Sprint 4A `schools-create` writer used the legacy `district` field
// name; the bootstrap deliberately writes the canonical `districtId`
// field so the beta school satisfies the shared district-context helper
// used by every callable in Sprint 20.
export const BETA_SCHOOL: {
  name: string;
  shortName: string;
  timezone: string;
  districtId: string;
} = {
  name: "LyfeLabz Beta School",
  shortName: "Beta",
  timezone: "America/New_York",
  districtId: BETA_DISTRICT_ID,
};

type Args = {
  email: string;
  displayName?: string;
};

function parseArgs(argv: readonly string[]): Args {
  const args: Partial<Args> = {};
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--email" && value) {
      args.email = value;
      i++;
    } else if (flag === "--name" && value) {
      args.displayName = value;
      i++;
    }
  }
  if (!args.email) {
    throw new Error("Missing required --email <address>");
  }
  return args as Args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
      projectId: PROJECT_ID,
    });
  }

  const auth = getAuth();
  const db = getFirestore();

  console.log(`[bootstrap] project=${PROJECT_ID} email=${args.email}`);

  const user = await auth.getUserByEmail(args.email).catch(() => null);
  if (!user) {
    throw new Error(
      `No Firebase Auth user found for ${args.email}. Sign in once at https://lyfelabz-prod.web.app/app/ first, then re-run.`,
    );
  }
  const uid = user.uid;
  const displayName =
    args.displayName ?? user.displayName ?? args.email.split("@")[0];

  console.log(`[bootstrap] uid=${uid} displayName="${displayName}"`);

  const schoolRef = db.collection("schools").doc(BETA_SCHOOL_ID);
  const schoolSnap = await schoolRef.get();
  if (!schoolSnap.exists) {
    await schoolRef.set({
      ...BETA_SCHOOL,
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log(`[bootstrap] created school schools/${BETA_SCHOOL_ID}`);
  } else {
    // Merge-repair existing beta schools that predate the canonical
    // `districtId` field. Safe on already-correct docs.
    await schoolRef.set(BETA_SCHOOL, { merge: true });
    console.log(
      `[bootstrap] repaired schools/${BETA_SCHOOL_ID} to canonical districtId shape`,
    );
  }

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  const payload: Record<string, unknown> = {
    authUid: uid,
    status: "active",
    role: "teacher",
    schoolId: BETA_SCHOOL_ID,
    displayName,
  };
  if (user.email) payload.email = user.email;

  if (userSnap.exists) {
    await userRef.set(payload, { merge: true });
    console.log(`[bootstrap] updated users/${uid} to active teacher`);
  } else {
    payload.createdAt = FieldValue.serverTimestamp();
    await userRef.set(payload);
    console.log(`[bootstrap] created users/${uid} as active teacher`);
  }

  await auth.setCustomUserClaims(uid, {
    role: "teacher",
    schoolId: BETA_SCHOOL_ID,
    districtId: BETA_DISTRICT_ID,
  });
  console.log(
    `[bootstrap] set custom claims { role: "teacher", schoolId: "${BETA_SCHOOL_ID}", districtId: "${BETA_DISTRICT_ID}" }`,
  );

  console.log("");
  console.log("[bootstrap] DONE. Next steps:");
  console.log("  1. Sign OUT at https://lyfelabz-prod.web.app/app/");
  console.log("  2. Sign back in with " + args.email);
  console.log("     (The new ID token will carry the teacher claims.)");
}

// Only execute when invoked directly (`node lib/scripts/bootstrap-beta-teacher.js`).
// Guarding preserves testability: unit tests can import the exported
// constants without initialising firebase-admin or attempting network I/O.
if (require.main === module) {
  main().catch((err) => {
    console.error("[bootstrap] FAILED:", err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
