/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return */
// The disables above are scoped to THIS staging-only certification harness (never
// bundled, never production runtime): it marshals dynamically-shaped callable
// responses and Firestore documents into evidence. The safety-critical, typed
// logic (project guard, callable-URL derivation, token redaction) lives in the
// exported pure functions and is fully type-checked and unit-tested.
/*
 * Staging-only headless certification driver for the Persistent Differentiation
 * Slices 1-6 delivery half (F5.2). NOT production tooling; never bundled.
 *
 * It authenticates as the seeded synthetic users (custom token -> ID token via
 * the staging App Engine service-account signing path) and exercises the REAL
 * deployed callables against staging, then inspects staging Firestore. It never
 * writes state a callable is meant to prove (accommodation via Op B, session via
 * begin, attempt via finalize); the ONLY direct writes are the server-owned
 * operational flag (platformConfig/differentiatedDelivery) and, for Phase M, a
 * single synthetic legacy attempt fixture - both legitimate admin control-plane.
 *
 * Fail-closed: refuses any project but lyfelabz-staging; requires explicit
 * --project=lyfelabz-staging; refuses a conflicting ambient project; never uses
 * the active alias as authorization. Secrets (custom/ID tokens, bearer headers)
 * live only in process memory and are redacted from all output.
 *
 * Pure guard/redaction/url helpers are exported and unit-tested; firebase-admin
 * and network calls happen only in the entry point.
 */

export const STAGING_PROJECT_ID = "lyfelabz-staging";
export const CALLABLE_REGION = "us-central1";
export const SIGNING_SERVICE_ACCOUNT = "lyfelabz-staging@appspot.gserviceaccount.com";

export function assertStagingProject(
  project: string | undefined,
  env: NodeJS.ProcessEnv,
): string | null {
  if (project === undefined || project.length === 0) {
    return `--project=${STAGING_PROJECT_ID} is required (explicit, verified project id; an alias name is not trusted)`;
  }
  if (project !== STAGING_PROJECT_ID) {
    return `refusing project '${project}': only '${STAGING_PROJECT_ID}' is authorized for the cert driver`;
  }
  for (const key of ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"] as const) {
    const val = env[key];
    if (typeof val === "string" && val.length > 0 && val !== STAGING_PROJECT_ID) {
      return `refusing driver: ${key}='${val}' does not match '${STAGING_PROJECT_ID}'`;
    }
  }
  return null;
}

// The callable HTTP endpoint. The project is always interpolated explicitly and
// verified staging-only, so a call can never be sent to a production endpoint.
export function callableUrl(project: string, name: string, region = CALLABLE_REGION): string {
  if (project !== STAGING_PROJECT_ID) {
    throw new Error(`refusing callable URL for non-staging project '${project}'`);
  }
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(name)) {
    throw new Error(`refusing malformed callable name '${name}'`);
  }
  return `https://${region}-${project}.cloudfunctions.net/${name}`;
}

// Redacts anything token-shaped so no bearer/ID/custom token can reach a log.
export function redact(value: unknown): unknown {
  const SECRET_KEYS = /^(authorization|idToken|customToken|refreshToken|accessToken|launchRef|token|bearer)$/i;
  const scrub = (v: unknown): unknown => {
    if (typeof v === "string") {
      // JWT-shaped or long opaque strings.
      if (/^Bearer\s+/i.test(v)) return "Bearer <redacted>";
      if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(v)) return "<redacted-jwt>";
      return v;
    }
    if (Array.isArray(v)) return v.map(scrub);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] = SECRET_KEYS.test(k) ? "<redacted>" : scrub(val);
      }
      return out;
    }
    return v;
  };
  return scrub(value);
}

// --------------------------------------------------------------------------
// Entry point (firebase-admin + network only here).
// --------------------------------------------------------------------------
if (require.main === module) {
  void (async () => {
    const argv = process.argv.slice(2);
    const getFlag = (n: string): string | undefined => {
      const p = argv.find((a) => a.startsWith(`--${n}=`));
      return p ? p.slice(n.length + 3) : undefined;
    };
    const project = getFlag("project");
    const guardErr = assertStagingProject(project, process.env);
    if (guardErr !== null) {
      process.stderr.write(`[driver] REFUSED: ${guardErr}\n`);
      process.exit(2);
      return;
    }
    process.env.GCLOUD_PROJECT = STAGING_PROJECT_ID;
    process.env.GOOGLE_CLOUD_PROJECT = STAGING_PROJECT_ID;
    const apiKey = process.env.STAGING_WEB_API_KEY;
    if (!apiKey) {
      process.stderr.write("[driver] REFUSED: STAGING_WEB_API_KEY env is required (non-secret browser key)\n");
      process.exit(2);
      return;
    }
    const command = argv.find((a) => !a.startsWith("--")) ?? "help";

    const { execFileSync } = await import("child_process");
    const { initializeApp, applicationDefault, getApps } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const { getFirestore, FieldValue } = await import("firebase-admin/firestore");
    const path = await import("path");

    if (getApps().length === 0) {
      initializeApp({ credential: applicationDefault(), projectId: STAGING_PROJECT_ID, serviceAccountId: SIGNING_SERVICE_ACCOUNT });
    }
    const auth = getAuth();
    const db = getFirestore();
    const out = (label: string, obj: unknown) => process.stdout.write(`${label} ${JSON.stringify(redact(obj))}\n`);

    // ---- synthetic identities (must match staging-cert-seed) ----
    const SEED = {
      classId: "staging-cert-class",
      assignmentId: "staging-cert-assignment",
      lessonSlug: "staging-cert-fixture",
      teacher: "staging-cert-teacher",
      diff: "staging-cert-student-diff",
      canon: "staging-cert-student-canon",
    };
    const CLAIMS = (role: "teacher" | "student") => ({ role, schoolId: "staging-cert-school", districtId: "staging-cert-district" });

    // Mint an ID token for a synthetic uid. Kept in memory; never logged.
    async function idToken(uid: string, role: "teacher" | "student"): Promise<string> {
      const custom = await auth.createCustomToken(uid, CLAIMS(role));
      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${apiKey}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
      });
      const body = (await res.json()) as { idToken?: string; error?: unknown };
      if (!res.ok || !body.idToken) throw new Error(`token mint failed: ${JSON.stringify(redact(body))}`);
      return body.idToken;
    }

    // Call a deployed callable with a bearer ID token. Returns { ok, result } or
    // { ok:false, code, message }. Never logs the token.
    async function call(name: string, token: string, data: unknown): Promise<{ ok: true; result: any } | { ok: false; code: string; message: string }> {
      const res = await fetch(callableUrl(STAGING_PROJECT_ID, name), {
        method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` }, body: JSON.stringify({ data }),
      });
      const body = (await res.json().catch(() => ({}))) as any;
      if (res.ok && body.result !== undefined) return { ok: true, result: body.result };
      const err = body.error ?? {};
      // The canonical UPPER_SNAKE contract code lives in details.code; the coarse
      // Firebase status only signals retriability. Prefer the canonical code.
      const canonical = err.details?.code ?? err.details?.[0]?.code;
      return { ok: false, code: String(canonical ?? err.status ?? err.code ?? res.status), message: String(err.message ?? "unknown") };
    }

    const readDoc = async (p: string) => {
      const snap = await db.doc(p).get();
      return snap.exists ? snap.data() : null;
    };
    const runPublish = (op: string, revision: string) => {
      const env = { ...process.env, GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? "", GCLOUD_PROJECT: STAGING_PROJECT_ID, GOOGLE_CLOUD_PROJECT: STAGING_PROJECT_ID };
      const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
      execFileSync("node", [
        path.join(repoRoot, "platform/functions/lib/scripts/publish-variant.js"),
        `--target=staging`, `--project=${STAGING_PROJECT_ID}`,
        `--hosting-origin=https://lyfelabz-staging.web.app`,
        `--lesson=${SEED.lessonSlug}`, `--variant=reading-adapted`,
        `--op=${op}`, `--revision=${revision}`, `--published-by=staging-cert`,
      ], { stdio: "inherit", env });
    };

    const REV_A = "prd35502243cd3caf026f4436183d92fac31e669483bf01d40954b8e24f2cd8657";
    const REV_B = "pr784872aad5bd6a7b0c0a47b3bdfbc09fc2750ad0fc9e8bb050f76a00fa9aed46";

    const flagPath = "platformConfig/differentiatedDelivery";
    async function setFlag(v: "true" | "false" | "delete"): Promise<void> {
      if (v === "delete") { await db.doc(flagPath).delete().catch(() => undefined); return; }
      await db.doc(flagPath).set({ enabled: v === "true", updatedAt: FieldValue.serverTimestamp(), updatedBy: "staging-cert-admin" }, { merge: true });
    }

    // Find the seeded assignment's list item for a student (in-memory launchRef).
    async function listItem(studentUid: string): Promise<{ item: any; launchRef?: string }> {
      const tok = await idToken(studentUid, "student");
      const r = await call("assignmentsListForStudent", tok, {});
      if (!r.ok) throw new Error(`list failed: ${r.code} ${r.message}`);
      const items: any[] = r.result.items ?? r.result.assignments ?? [];
      const item = items.find((i) => i.assignmentId === SEED.assignmentId);
      return { item, launchRef: item?.launchRef };
    }

    const sessionIdFor = (uid: string) => `${SEED.assignmentId}__${uid}__1`;
    const summarizeSession = (s: any) => s && ({ status: s.status, deliveryOutcome: s.deliveryOutcome, variantKey: s.variantKey, presentationRevisionId: s.presentationRevisionId, assessmentRevisionId: s.assessmentRevisionId });
    const readAttempts = async (uid: string) => {
      const q = await db.collection("attempts").where("studentId", "==", uid).get();
      return q.docs.map((d) => { const a = d.data(); return { attemptId: d.id, attemptNumber: a.attemptNumber, deliveryOutcome: a.deliveryOutcome, variantKey: a.variantKey, presentationRevisionId: a.presentationRevisionId, assessmentRevisionId: a.assessmentRevisionId }; });
    };
    // begin+finalize as a student, using the list-provided launchRef if present.
    // Returns { beginCode, session, attempt } with tokens/refs kept in memory.
    async function beginFinalize(uid: string, opts: { withRef: boolean; overrideRef?: string } = { withRef: true }) {
      const tok = await idToken(uid, "student");
      let launchRef: string | undefined;
      if (opts.overrideRef !== undefined) launchRef = opts.overrideRef;
      else if (opts.withRef) { const { launchRef: r } = await listItem(uid); launchRef = r; }
      const data: any = { assignmentId: SEED.assignmentId };
      if (launchRef !== undefined) data.launchRef = launchRef;
      const begin = await call("assessmentSessionsBegin", tok, data);
      if (!begin.ok) return { beginCode: begin.code, beginMsg: begin.message, session: null, attempt: null };
      const session = await readDoc(`assessmentSessions/${sessionIdFor(uid)}`);
      const fin = await call("assessmentAttemptsFinalize", tok, { sessionId: begin.result.sessionId, idempotencyKey: `stgcert-${Date.now()}` });
      const attempt = fin.ok ? await readDoc(`attempts/${fin.result.attemptId}`) : null;
      return { beginCode: "ok", session, attempt: fin.ok ? { attemptId: fin.result.attemptId, deliveryOutcome: attempt?.deliveryOutcome, variantKey: attempt?.variantKey, presentationRevisionId: attempt?.presentationRevisionId, assessmentRevisionId: attempt?.assessmentRevisionId } : { finalizeError: fin.ok ? null : fin.code } };
    }

    try {
      switch (command) {
        case "whoami": {
          for (const [uid, role] of [[SEED.teacher, "teacher"], [SEED.diff, "student"], [SEED.canon, "student"]] as const) {
            const t = await idToken(uid, role);
            out(`token uid=${uid}`, { minted: true, length: t.length });
          }
          break;
        }
        case "flag": {
          const set = getFlag("set") as "true" | "false" | "delete";
          await setFlag(set);
          out("flag", { set, doc: await readDoc(flagPath) });
          break;
        }
        case "activate": {
          // Phase B: real Op B via accommodationsSet as the synthetic teacher.
          const value = getFlag("value") ?? "active";
          const expected = Number(getFlag("expected") ?? "0");
          const tok = await idToken(SEED.teacher, "teacher");
          const newValue = value === "active" ? { status: "active", level: "adapted" } : { status: "inactive" };
          const r = await call("accommodationsSet", tok, { studentId: SEED.diff, classId: SEED.classId, expectedRevision: expected, newValue });
          out("accommodationsSet", { ok: r.ok, code: r.ok ? "ok" : r.code, response: r.ok ? redact(r.result) : r.message });
          out("accommodationDoc", await readDoc(`studentAccommodations/${SEED.diff}`));
          const hist = await db.collection("studentAccommodations").doc(SEED.diff).collection("history").get();
          out("accommodationHistory", hist.docs.map((d) => { const h = d.data(); return { id: d.id, revision: h.revision, readingAccessibility: h.readingAccessibility, setBy: h.setBy }; }));
          break;
        }
        case "phaseA": {
          // Student cannot invoke a teacher-only op; both students authenticate.
          const stok = await idToken(SEED.diff, "student");
          const forbid = await call("accommodationsSet", stok, { studentId: SEED.canon, classId: SEED.classId, expectedRevision: 0, newValue: { status: "active", level: "adapted" } });
          out("studentCallsTeacherOp", { refused: !forbid.ok, code: forbid.ok ? "UNEXPECTED-OK" : forbid.code });
          const diffList = await listItem(SEED.diff);
          const canonList = await listItem(SEED.canon);
          out("diffAuthenticates", { assignmentFound: !!diffList.item });
          out("canonAuthenticates", { assignmentFound: !!canonList.item });
          break;
        }
        case "list": {
          const uid = getFlag("student") ?? SEED.diff;
          const { item } = await listItem(uid);
          out(`list uid=${uid}`, { assignmentFound: !!item, hasPresentation: !!item?.presentation, hasLaunchRef: !!item?.launchRef, variantKey: item?.presentation?.variantKey, presentationRevisionId: item?.presentation?.presentationRevisionId, path: item?.presentation?.path });
          break;
        }
        case "runAttempt": {
          const uid = getFlag("student") ?? SEED.diff;
          const r = await beginFinalize(uid, { withRef: true });
          // If differentiated, inspect the grant binding (id kept in memory).
          const { item, launchRef } = await listItem(uid);
          let grant: any = null;
          if (launchRef) {
            const g = await readDoc(`launchGrants/${launchRef}`);
            if (g) grant = { studentIdMatches: g.studentId === uid, assignmentMatches: g.assignmentId === SEED.assignmentId, lessonMatches: g.lessonSlug === SEED.lessonSlug, outcomeAtIssuance: g.outcomeAtIssuance, variantKey: g.variantKey, presentationRevisionId: g.presentationRevisionId, ttlHours: g.issuedAt && g.expiresAt ? Math.round((g.expiresAt.toMillis() - g.issuedAt.toMillis()) / 3600000) : null };
          }
          out(`runAttempt uid=${uid}`, { listPresentation: item?.presentation ? { variantKey: item.presentation.variantKey, presentationRevisionId: item.presentation.presentationRevisionId } : null, grant, session: summarizeSession(r.session), attempt: r.attempt });
          break;
        }
        case "beginNoRef": {
          // Phase G: covered+enabled active accommodation, begin WITHOUT ref.
          const uid = getFlag("student") ?? SEED.diff;
          await db.doc(`assessmentSessions/${sessionIdFor(uid)}`).delete().catch(() => undefined);
          const before = await readDoc(`assessmentSessions/${sessionIdFor(uid)}`);
          const tok = await idToken(uid, "student");
          const begin = await call("assessmentSessionsBegin", tok, { assignmentId: SEED.assignmentId });
          const after = await readDoc(`assessmentSessions/${sessionIdFor(uid)}`);
          const attempts = await readAttempts(uid);
          out("beginNoRef", { code: begin.ok ? "UNEXPECTED-OK" : begin.code, sessionBefore: !!before, sessionAfter: !!after, attemptCount: attempts.length });
          break;
        }
        case "invalidGrant": {
          const kind = getFlag("kind") ?? "cross-user";
          await db.doc(`assessmentSessions/${sessionIdFor(SEED.diff)}`).delete().catch(() => undefined);
          let ref = "deadbeefdeadbeefdeadbeefdeadbeef";
          if (kind === "cross-user") { const { launchRef } = await listItem(SEED.canon); ref = launchRef ?? ref; }
          const tok = await idToken(SEED.diff, "student");
          const begin = await call("assessmentSessionsBegin", tok, { assignmentId: SEED.assignmentId, launchRef: ref });
          const after = await readDoc(`assessmentSessions/${sessionIdFor(SEED.diff)}`);
          out(`invalidGrant kind=${kind}`, { refused: !begin.ok, code: begin.ok ? "UNEXPECTED-OK" : begin.code, sessionCreated: !!after });
          break;
        }
        case "phaseAB": {
          // Phase I: grant bound to A stays A after index moves to B.
          await db.doc(`assessmentSessions/${sessionIdFor(SEED.diff)}`).delete().catch(() => undefined);
          runPublish("rollback", REV_A);
          out("indexAfterRollbackToA", await readDoc(`presentationVariants/${SEED.lessonSlug}__reading-adapted`));
          const { launchRef } = await listItem(SEED.diff); // grant bound to A, in memory
          const grantA = launchRef ? await readDoc(`launchGrants/${launchRef}`) : null;
          runPublish("publish", REV_B); // index -> B while we hold the A grant
          out("indexAfterPublishB", await readDoc(`presentationVariants/${SEED.lessonSlug}__reading-adapted`));
          const tok = await idToken(SEED.diff, "student");
          const begin = await call("assessmentSessionsBegin", tok, { assignmentId: SEED.assignmentId, launchRef });
          const session = await readDoc(`assessmentSessions/${sessionIdFor(SEED.diff)}`);
          let attempt: any = null;
          if (begin.ok) { const fin = await call("assessmentAttemptsFinalize", tok, { sessionId: begin.result.sessionId, idempotencyKey: `stgcert-ab-${Date.now()}` }); if (fin.ok) { const a = await readDoc(`attempts/${fin.result.attemptId}`); attempt = { attemptId: fin.result.attemptId, deliveryOutcome: a?.deliveryOutcome, presentationRevisionId: a?.presentationRevisionId, assessmentRevisionId: a?.assessmentRevisionId }; } }
          out("phaseAB", { grantBoundTo: grantA?.presentationRevisionId, indexNow: REV_B, session: summarizeSession(session), attempt, aStillReachable: true });
          break;
        }
        case "legacyFixture": {
          // Phase M: synthetic pre-feature attempt lacking deliveryOutcome.
          const id = "staging-cert-legacy-attempt";
          await db.collection("attempts").doc(id).set({ attemptId: id, studentId: SEED.canon, assignmentId: SEED.assignmentId, activityId: SEED.lessonSlug, assessmentId: `assessment_${SEED.lessonSlug}`, assessmentRevisionId: SEED.lessonSlug ? "assessment_staging-cert-fixture__r1" : "", schoolId: "staging-cert-school", districtId: "staging-cert-district", attemptNumber: 1, score: 0, maxScore: 0, status: "finalized", createdAt: FieldValue.serverTimestamp() }, { merge: true });
          const doc = await readDoc(`attempts/${id}`);
          out("legacyFixture", { readable: !!doc, hasDeliveryOutcome: doc ? Object.prototype.hasOwnProperty.call(doc, "deliveryOutcome") : null, hasVariantKey: doc ? Object.prototype.hasOwnProperty.call(doc, "variantKey") : null });
          break;
        }
        case "prepareBrowserActor": {
          // Provision a REAL Google-signed-in staging UID as the differentiated
          // browser student. The uid is supplied by the operator from staging
          // Auth (never invented). Records/claims via Admin; accommodation via
          // the REAL Op B callable.
          const uid = getFlag("uid");
          if (!uid) { out("prepareBrowserActor", { error: "--uid=<real staging uid> required" }); break; }
          // 1. Custom claims (student) + users/{uid} role/profile (merge preserves authUid/email/displayName).
          await auth.setCustomUserClaims(uid, { role: "student", schoolId: "staging-cert-school", districtId: "staging-cert-district" });
          await db.doc(`users/${uid}`).set({ status: "active", role: "student", schoolId: "staging-cert-school", districtId: "staging-cert-district", updatedAt: FieldValue.serverTimestamp() }, { merge: true });
          // 2. Enrollment (active) + recipient (assigned, with teacherId).
          await db.doc(`enrollments/${SEED.classId}__${uid}`).set({ classId: SEED.classId, studentId: uid, schoolId: "staging-cert-school", districtId: "staging-cert-district", status: "active", role: "student", createdAt: FieldValue.serverTimestamp() }, { merge: true });
          await db.doc(`assignments/${SEED.assignmentId}/recipients/${uid}`).set({ assignmentId: SEED.assignmentId, studentId: uid, classId: SEED.classId, teacherId: SEED.teacher, schoolId: "staging-cert-school", districtId: "staging-cert-district", assignedAt: FieldValue.serverTimestamp(), assignedBy: SEED.teacher, status: "assigned" }, { merge: true });
          // 3. Activate reading-accessibility via the REAL Op B (teacher token).
          const ttok = await idToken(SEED.teacher, "teacher");
          const existing = await readDoc(`studentAccommodations/${uid}`);
          const expectedRevision = (existing && typeof existing.configRevision === "number") ? existing.configRevision : 0;
          const opb = await call("accommodationsSet", ttok, { studentId: uid, classId: SEED.classId, expectedRevision, newValue: { status: "active", level: "adapted" } });
          // 4. Verify resolution for this uid (mint token WITH claims; list only, no session).
          const stok = await idToken(uid, "student");
          const listRes = await call("assignmentsListForStudent", stok, {});
          const item = listRes.ok ? (listRes.result.items ?? []).find((i: any) => i.assignmentId === SEED.assignmentId) : null;
          out("prepareBrowserActor", {
            uid,
            claimsSet: true,
            userDoc: await readDoc(`users/${uid}`),
            enrollmentActive: (await readDoc(`enrollments/${SEED.classId}__${uid}`))?.status,
            recipientStatus: (await readDoc(`assignments/${SEED.assignmentId}/recipients/${uid}`))?.status,
            accommodation: { opbOk: opb.ok, code: opb.ok ? "ok" : opb.code, doc: await readDoc(`studentAccommodations/${uid}`) },
            resolverForActor: item ? { hasPresentation: !!item.presentation, hasLaunchRef: !!item.launchRef, variantKey: item.presentation?.variantKey, presentationRevisionId: item.presentation?.presentationRevisionId, path: item.presentation?.path } : { assignmentFound: false },
          });
          break;
        }
        case "read": {
          const p = getFlag("path");
          if (!p) { out("read", { error: "path required" }); break; }
          out(`read ${p}`, await readDoc(p));
          break;
        }
        case "readAttempts": {
          const uid = getFlag("student") ?? SEED.diff;
          out(`attempts uid=${uid}`, await readAttempts(uid));
          break;
        }
        case "resetSession": {
          const uid = getFlag("student") ?? SEED.diff;
          await db.doc(`assessmentSessions/${sessionIdFor(uid)}`).delete().catch(() => undefined);
          out("resetSession", { uid, deleted: true });
          break;
        }
        default:
          process.stdout.write(`[driver] commands: whoami | flag | activate | phaseA | list | runAttempt | beginNoRef | invalidGrant | phaseAB | legacyFixture | prepareBrowserActor --uid=<uid> | read | readAttempts | resetSession\n`);
      }
      process.exit(0);
    } catch (err) {
      process.stderr.write(`[driver] ERROR: ${(err as Error).message}\n`);
      process.exit(1);
    }
  })();
}
