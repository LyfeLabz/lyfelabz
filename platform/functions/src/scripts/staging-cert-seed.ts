/*
 * Staging-only synthetic seed harness for the Persistent Differentiation
 * Slices 1-6 delivery-half certification (F5.2). NOT production tooling and
 * NEVER exported from the Cloud Functions bundle.
 *
 * It creates the minimum synthetic identities and records the certified
 * delivery-half proof needs, so the REAL server paths (accommodationsSet Op B,
 * assignmentsListForStudent / lmsDeepLinkResolve Op C + grant,
 * assessmentSessionsBegin freeze, submissionsFinalize) can be exercised against
 * staging with authentic authorization, CAS, and history behavior. It does NOT
 * seed studentAccommodations (that is activated through the real Op B callable)
 * and does NOT create sessions/attempts (those come from the real callables).
 *
 * Fail-closed safety (non-negotiable):
 *   - Refuses every project except exactly `lyfelabz-staging`.
 *   - Requires an explicit `--project=lyfelabz-staging`; never infers from
 *     `.firebaserc` and never defaults to the active Firebase CLI alias.
 *   - Refuses if an ambient GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT disagrees.
 *   - Only clearly synthetic identities; never real student data; no secrets.
 *
 * The pure guard/plan functions are exported and unit-tested; firebase-admin is
 * imported only below `require.main === module` so the jest process never loads
 * it (publish-variant.ts / deploy-assessment.ts convention).
 */

export const STAGING_PROJECT_ID = "lyfelabz-staging";

// Deterministic, unmistakably-synthetic identifiers. `.invalid` is the reserved
// never-resolvable TLD (RFC 6761), so these emails can never be a real account.
export const SEED = {
  districtId: "staging-cert-district",
  schoolId: "staging-cert-school",
  classId: "staging-cert-class",
  assignmentId: "staging-cert-assignment",
  // Matches the already-published staging variant index
  // presentationVariants/staging-cert-fixture__reading-adapted.
  lessonSlug: "staging-cert-fixture",
  variantKey: "reading-adapted",
  // Grammar: "assessment_" + lessonSlug + "__r" + ordinal
  // (shared/assessment-identifiers.ts). No deployed assessment revision doc is
  // required by begin - it parses this id and derives activityId = lessonSlug.
  assessmentRevisionId: "assessment_staging-cert-fixture__r1",
  teacher: {
    uid: "staging-cert-teacher",
    email: "staging-cert-teacher@staging-cert.invalid",
    displayName: "Staging Cert Teacher",
  },
  studentDiff: {
    uid: "staging-cert-student-diff",
    email: "staging-cert-student-diff@staging-cert.invalid",
    displayName: "Staging Cert Student (Differentiated)",
  },
  studentCanon: {
    uid: "staging-cert-student-canon",
    email: "staging-cert-student-canon@staging-cert.invalid",
    displayName: "Staging Cert Student (Canonical Control)",
  },
} as const;

// Fail closed on project identity. An alias name is never trusted: the explicit
// project must equal STAGING_PROJECT_ID, and any ambient project the Admin SDK
// would pick up must agree, so production can never be reached.
export function assertStagingProject(
  project: string | undefined,
  env: NodeJS.ProcessEnv,
): string | null {
  if (project === undefined || project.length === 0) {
    return `--project=${STAGING_PROJECT_ID} is required (explicit, verified project id; an alias name is not trusted)`;
  }
  if (project !== STAGING_PROJECT_ID) {
    return `refusing project '${project}': only '${STAGING_PROJECT_ID}' is authorized for the seed harness`;
  }
  for (const key of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"] as const) {
    const val = env[key];
    if (typeof val === "string" && val.length > 0 && val !== STAGING_PROJECT_ID) {
      return `refusing seed: ${key}='${val}' does not match the authorized staging project '${STAGING_PROJECT_ID}'`;
    }
  }
  return null;
}

export type SeedUserPlan = {
  readonly uid: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: "teacher" | "student";
};

export type SeedPlan = {
  readonly school: { readonly schoolId: string; readonly districtId: string; readonly name: string };
  readonly users: readonly SeedUserPlan[];
  readonly class: {
    readonly classId: string;
    readonly teacherUid: string;
    readonly schoolId: string;
    readonly districtId: string;
    readonly name: string;
  };
  readonly enrollments: readonly { readonly classId: string; readonly studentUid: string }[];
  readonly assignment: {
    readonly assignmentId: string;
    readonly classId: string;
    readonly teacherUid: string;
    readonly schoolId: string;
    readonly districtId: string;
    readonly lessonSlug: string;
    readonly assessmentRevisionId: string;
  };
  readonly recipients: readonly { readonly assignmentId: string; readonly studentUid: string; readonly classId: string }[];
};

// Pure description of every record to create. All identities are synthetic.
export function buildSeedPlan(): SeedPlan {
  return {
    school: { schoolId: SEED.schoolId, districtId: SEED.districtId, name: "Staging Cert School" },
    users: [
      { uid: SEED.teacher.uid, email: SEED.teacher.email, displayName: SEED.teacher.displayName, role: "teacher" },
      { uid: SEED.studentDiff.uid, email: SEED.studentDiff.email, displayName: SEED.studentDiff.displayName, role: "student" },
      { uid: SEED.studentCanon.uid, email: SEED.studentCanon.email, displayName: SEED.studentCanon.displayName, role: "student" },
    ],
    class: {
      classId: SEED.classId,
      teacherUid: SEED.teacher.uid,
      schoolId: SEED.schoolId,
      districtId: SEED.districtId,
      name: "Staging Cert Class",
    },
    enrollments: [
      { classId: SEED.classId, studentUid: SEED.studentDiff.uid },
      { classId: SEED.classId, studentUid: SEED.studentCanon.uid },
    ],
    assignment: {
      assignmentId: SEED.assignmentId,
      classId: SEED.classId,
      teacherUid: SEED.teacher.uid,
      schoolId: SEED.schoolId,
      districtId: SEED.districtId,
      lessonSlug: SEED.lessonSlug,
      assessmentRevisionId: SEED.assessmentRevisionId,
    },
    recipients: [
      { assignmentId: SEED.assignmentId, studentUid: SEED.studentDiff.uid, classId: SEED.classId },
      { assignmentId: SEED.assignmentId, studentUid: SEED.studentCanon.uid, classId: SEED.classId },
    ],
  };
}

export function parseProjectArg(argv: readonly string[]): string | undefined {
  for (const raw of argv) {
    if (raw.startsWith("--project=")) {
      const v = raw.slice("--project=".length);
      return v.length > 0 ? v : undefined;
    }
  }
  return undefined;
}

// --------------------------------------------------------------------------
// Entry point. firebase-admin is imported only here so importing this module in
// tests never loads it. Run (from repo root, after `npm --prefix
// platform/functions run build`):
//   GOOGLE_APPLICATION_CREDENTIALS=<adc> \
//   node platform/functions/lib/scripts/staging-cert-seed.js --project=lyfelabz-staging [--reset]
// --------------------------------------------------------------------------
if (require.main === module) {
  void (async () => {
    const argv = process.argv.slice(2);
    const project = parseProjectArg(argv);
    const guardErr = assertStagingProject(project, process.env);
    if (guardErr !== null) {
      process.stderr.write(`[seed] REFUSED: ${guardErr}\n`);
      process.exit(2);
      return;
    }
    // Force the Admin SDK to the verified staging project; never a default.
    process.env.GCLOUD_PROJECT = STAGING_PROJECT_ID;
    process.env.GOOGLE_CLOUD_PROJECT = STAGING_PROJECT_ID;
    const reset = argv.includes("--reset");

    const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const { getFirestore, FieldValue, Timestamp } = await import("firebase-admin/firestore");

    if (getApps().length === 0) {
      initializeApp({ credential: applicationDefault(), projectId: STAGING_PROJECT_ID });
    }
    const auth = getAuth();
    const db = getFirestore();
    const plan = buildSeedPlan();
    const log = (m: string) => process.stdout.write(`[seed] ${m}\n`);
    log(`project=${STAGING_PROJECT_ID} reset=${reset}`);

    if (reset) {
      // Cleanup: delete only the synthetic records/users this harness creates.
      await db.collection("assignments").doc(plan.assignment.assignmentId).collection("recipients").doc(SEED.studentDiff.uid).delete().catch(() => undefined);
      await db.collection("assignments").doc(plan.assignment.assignmentId).collection("recipients").doc(SEED.studentCanon.uid).delete().catch(() => undefined);
      await db.collection("assignments").doc(plan.assignment.assignmentId).delete().catch(() => undefined);
      for (const e of plan.enrollments) await db.collection("enrollments").doc(`${e.classId}__${e.studentUid}`).delete().catch(() => undefined);
      await db.collection("classes").doc(plan.class.classId).delete().catch(() => undefined);
      for (const u of plan.users) {
        await db.collection("users").doc(u.uid).delete().catch(() => undefined);
        await auth.deleteUser(u.uid).catch(() => undefined);
      }
      // Accommodation state created by Op B during certification.
      await db.collection("studentAccommodations").doc(SEED.studentDiff.uid).delete().catch(() => undefined);
      await db.collection("assessmentRevisions").doc(SEED.assessmentRevisionId).delete().catch(() => undefined);
      await db.collection("assessmentAnswerKeys").doc(SEED.assessmentRevisionId).delete().catch(() => undefined);
      log("reset complete (synthetic seed records + users removed)");
      process.exit(0);
      return;
    }

    // School.
    await db.collection("schools").doc(plan.school.schoolId).set(
      { name: plan.school.name, shortName: "StgCert", timezone: "America/New_York", districtId: plan.school.districtId, createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    log(`school schools/${plan.school.schoolId}`);

    // Users: Auth record + custom claims + users/{uid} profile.
    for (const u of plan.users) {
      try {
        await auth.createUser({ uid: u.uid, email: u.email, displayName: u.displayName, emailVerified: true });
        log(`auth user created uid=${u.uid}`);
      } catch (e) {
        if ((e as { code?: string }).code === "auth/uid-already-exists" || (e as { code?: string }).code === "auth/email-already-exists") {
          await auth.updateUser(u.uid, { email: u.email, displayName: u.displayName }).catch(() => undefined);
          log(`auth user exists uid=${u.uid}`);
        } else {
          throw e;
        }
      }
      await auth.setCustomUserClaims(u.uid, { role: u.role, schoolId: SEED.schoolId, districtId: SEED.districtId });
      await db.collection("users").doc(u.uid).set(
        { authUid: u.uid, status: "active", role: u.role, schoolId: SEED.schoolId, districtId: SEED.districtId, displayName: u.displayName, email: u.email, createdAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      log(`users/${u.uid} role=${u.role}`);
    }

    // Class (active, owned by the synthetic teacher).
    await db.collection("classes").doc(plan.class.classId).set(
      { classId: plan.class.classId, name: plan.class.name, teacherId: plan.class.teacherUid, schoolId: plan.class.schoolId, districtId: plan.class.districtId, status: "active", enrollmentSource: "joinCode", joinCode: "STGCERT", createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    log(`classes/${plan.class.classId}`);

    // Enrollments (active).
    for (const e of plan.enrollments) {
      const id = `${e.classId}__${e.studentUid}`;
      await db.collection("enrollments").doc(id).set(
        { classId: e.classId, studentId: e.studentUid, schoolId: SEED.schoolId, districtId: SEED.districtId, status: "active", role: "student", createdAt: FieldValue.serverTimestamp() },
        { merge: true },
      );
      log(`enrollments/${id}`);
    }

    // Assignment (published, classroom mode) with a frozen assessmentRevisionId.
    const now = Timestamp.now();
    const past = Timestamp.fromMillis(now.toMillis() - 3600_000);
    const future = Timestamp.fromMillis(now.toMillis() + 365 * 24 * 3600_000);
    await db.collection("assignments").doc(plan.assignment.assignmentId).set(
      {
        assignmentId: plan.assignment.assignmentId,
        classId: plan.assignment.classId,
        teacherId: plan.assignment.teacherUid,
        schoolId: plan.assignment.schoolId,
        districtId: plan.assignment.districtId,
        lessonSlug: plan.assignment.lessonSlug,
        assessmentRevisionId: plan.assignment.assessmentRevisionId,
        title: "Staging Cert Assignment",
        mode: "classroom",
        status: "published",
        availableAt: past,
        windowClosesAt: future,
        publishedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
    log(`assignments/${plan.assignment.assignmentId}`);

    // Recipients (canonical, status "assigned").
    for (const r of plan.recipients) {
      await db.collection("assignments").doc(r.assignmentId).collection("recipients").doc(r.studentUid).set(
        { assignmentId: r.assignmentId, studentId: r.studentUid, classId: r.classId, teacherId: plan.assignment.teacherUid, schoolId: SEED.schoolId, districtId: SEED.districtId, assignedAt: FieldValue.serverTimestamp(), assignedBy: plan.assignment.teacherUid, status: "assigned" },
        { merge: true },
      );
      log(`assignments/${r.assignmentId}/recipients/${r.studentUid}`);
    }

    // Minimal deployed assessment revision + confidential answer key so the
    // REAL finalize scorer can produce attempts. This is a synthetic scoring
    // fixture (one single-choice item), NOT the differentiation path under test;
    // it stands in for the assessment-deployment pipeline (own test coverage).
    const revId = SEED.assessmentRevisionId; // assessment_staging-cert-fixture__r1
    const assessmentId = `assessment_${SEED.lessonSlug}`;
    await db.collection("assessmentRevisions").doc(revId).set(
      {
        assessmentId,
        revisionOrdinal: 1,
        activityId: SEED.lessonSlug,
        itemOrderingRule: "authoredOrder",
        items: [
          { itemId: "q1", itemType: "singleChoice", stem: "Staging cert item (synthetic).", options: [{ optionId: "a", text: "A" }, { optionId: "b", text: "B" }], points: 1 },
        ],
        publishedAt: FieldValue.serverTimestamp(),
        publishedBy: "staging-cert",
        schemaVersion: 1,
      },
      { merge: true },
    );
    await db.collection("assessmentAnswerKeys").doc(revId).set(
      {
        assessmentId,
        revisionOrdinal: 1,
        items: [{ itemId: "q1", correctOptionId: "a", points: 1, explanation: "Synthetic staging cert answer key." }],
        publishedAt: FieldValue.serverTimestamp(),
        publishedBy: "staging-cert",
        schemaVersion: 1,
      },
      { merge: true },
    );
    log(`assessmentRevisions/${revId} + assessmentAnswerKeys/${revId}`);

    log("seed complete");
    process.exit(0);
  })().catch((err) => {
    process.stderr.write(`[seed] FAILED: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
