// F5.3 C7-E - staging-locked assessment-presentation negative-validation
// driver.
//
// Proves, against the REAL deployed staging callables, that the server
// refuses presentation-incompatible or provenance-forging client input while
// the one legitimate session survives for a later human submission (C7-F):
//
//   E1  legitimate begin (the student's already-issued launch grant) plus ONE
//       displayed-option autosave; the session must freeze the grant's
//       presentation provenance.
//   E2  autosave of the canonical distractor the certified presentation
//       OMITTED -> refused (`assessmentSessions.invalidResponses`).
//   E3  autosave of an option id that is not an option of the item -> refused.
//   E4  client-supplied provenance (`assessmentPresentationRevisionId`,
//       `displayedOptions`, `displayedOptionIds`, and on begin also
//       `assessmentRevisionId`, `accommodationConfigRevision`,
//       `presentationRevisionId`, `variantKey`) -> refused at begin and
//       autosave as a request-shape error.
//   E5  the same forbidden provenance at finalize -> refused before the
//       session is read. Every finalize payload this driver can build also
//       carries a MALFORMED idempotency key, so even a regressed
//       forbidden-key check could not score, create an attempt, or delete
//       the session: a well-formed finalize request is structurally
//       impossible here.
//
// After every refusal the driver re-reads the session and requires its
// document update time and responses to be unchanged. At the end it requires
// the student's attempts, the assignment's passbacks, the Current Assignment
// pointer, and the student's launch grants to be exactly as they were.
//
// Staging lock: the project must be supplied as the literal
// `--project=lyfelabz-staging` (aliases and defaults are never consulted),
// GCLOUD_PROJECT / GOOGLE_CLOUD_PROJECT may not name anything else, emulator
// variables are refused, and every callable URL is built by the staging-only
// `callableUrl`. There is no production flag. All of this is checked before
// any network activity.
//
// Authentication reuses the certified staging mechanism
// (`createAstra004StagingIdToken`): an Admin custom token for the student uid
// signed by the approved staging service account, exchanged for an ID token
// with the approved staging web API key (supplied at runtime as
// STAGING_WEB_API_KEY, never stored), and verified to carry that uid and the
// staging audience. Tokens and the launch reference are redacted from output.
//
// `plan` (default) performs Firestore READS only and prints the derived
// requests; it never mints a token or calls a callable. `--execute` is
// required for any callable call.
//
// Runbook: docs/platform/DIFFERENTIATION_F5_3_ASSESSMENT_ACCESSIBILITY_ADDENDUM.md
// section 18 (C7-E).

import {
  assertAstra004Environment,
  assertStagingProject,
  redact,
  STAGING_PROJECT_ID,
} from "./staging-cert-driver";
import { checkAssessmentPresentationDoc } from "../shared/presentation/assessment-presentation-identity";

export const F53_DRIVER_NAME = "staging-f53-assessment-negatives";

const ASSIGNMENT_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const UID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;
const GRANT_ID_PATTERN = /^[0-9a-f]{32}$/;
const ITEM_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,126}[a-zA-Z0-9])?$/;
// Mirrors the finalize boundary's URL-safe idempotency-key pattern. The
// driver's finalize key must FAIL it (see MALFORMED_IDEMPOTENCY_KEY).
const FINALIZE_IDEMPOTENCY_KEY_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,126}[a-zA-Z0-9])?$/;
export const MALFORMED_IDEMPOTENCY_KEY = "c7e negative: never a valid key!";
// A grant must stay valid for the whole run.
const GRANT_EXPIRY_MARGIN_MS = 10 * 60 * 1000;

export type F53Mode = "plan" | "execute";

export type F53Args = {
  readonly project: typeof STAGING_PROJECT_ID;
  readonly mode: F53Mode;
  readonly studentId: string;
  readonly assignmentId: string;
  readonly launchRef: string;
  readonly itemId: string | null;
};

export const F53_USAGE =
  `Usage: ${F53_DRIVER_NAME} --project=${STAGING_PROJECT_ID} --student=<uid> ` +
  "--assignment=<assignmentId> --launch-ref=<grantId> [--item=<itemId>] [--execute]";

export function parseF53Args(
  argv: readonly string[],
  env: NodeJS.ProcessEnv,
): { readonly ok: true; readonly args: F53Args } | { readonly ok: false; readonly message: string } {
  const values = new Map<string, string>();
  let execute = false;
  for (const raw of argv) {
    if (raw === "--execute") {
      if (execute) return { ok: false, message: "--execute may be supplied only once" };
      execute = true;
      continue;
    }
    const m = /^--(project|student|assignment|launch-ref|item)=(.*)$/.exec(raw);
    if (!m) return { ok: false, message: `unknown argument: ${raw}` };
    if (values.has(m[1])) return { ok: false, message: `--${m[1]} may be supplied only once` };
    values.set(m[1], m[2]);
  }
  const projectError = assertStagingProject(values.get("project"), env);
  if (projectError !== null) return { ok: false, message: projectError };
  const envError = assertAstra004Environment(env);
  if (envError !== null) return { ok: false, message: envError };

  const studentId = values.get("student") ?? "";
  if (!UID_PATTERN.test(studentId)) return { ok: false, message: "--student=<uid> is required" };
  const assignmentId = values.get("assignment") ?? "";
  if (!ASSIGNMENT_ID_PATTERN.test(assignmentId)) {
    return { ok: false, message: "--assignment=<assignmentId> is required" };
  }
  const launchRef = values.get("launch-ref") ?? "";
  if (!GRANT_ID_PATTERN.test(launchRef)) {
    return { ok: false, message: "--launch-ref=<32-hex grant id> is required" };
  }
  const item = values.get("item");
  if (item !== undefined && !ITEM_ID_PATTERN.test(item)) {
    return { ok: false, message: "--item must be an item id" };
  }
  return {
    ok: true,
    args: {
      project: STAGING_PROJECT_ID,
      mode: execute ? "execute" : "plan",
      studentId,
      assignmentId,
      launchRef,
      itemId: item ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Ports
// ---------------------------------------------------------------------------

export type F53Doc = { readonly data: Record<string, unknown>; readonly updateTime: string };

export type F53CallableOutcome =
  | { readonly ok: true; readonly data: Record<string, unknown> }
  | { readonly ok: false; readonly status: string; readonly code: string | null; readonly message: string };

export type F53Ports = {
  readonly readDoc: (path: string) => Promise<F53Doc | null>;
  readonly queryDocs: (
    collection: string,
    equals: readonly (readonly [string, string])[],
  ) => Promise<readonly (F53Doc & { readonly id: string })[]>;
  // Bound to the student identity; only reached in execute mode.
  readonly invokeCallable: (name: string, data: Record<string, unknown>) => Promise<F53CallableOutcome>;
  readonly now: () => Date;
  readonly log: (line: string) => void;
};

// ---------------------------------------------------------------------------
// Pure derivation and request construction
// ---------------------------------------------------------------------------

type PresentationItem = {
  readonly itemId: string;
  readonly displayedOptions: readonly { readonly optionId: string }[];
  readonly omittedOptions: readonly { readonly optionId: string }[];
};

export type F53Derived = {
  readonly itemId: string;
  readonly displayedOptionIds: readonly string[];
  readonly omittedOptionId: string;
  readonly unknownOptionId: string;
  readonly legitimateOptionId: string;
};

// Selects the omitted canonical distractor and an unknown option id for one
// item from the VERIFIED presentation record and the deployed canonical
// revision. Nothing positional is guessed. The legitimate response is the
// first displayed option: chosen by display order only, never by
// correctness (the driver never reads an answer key).
export function deriveNegativeOptions(
  presentation: Record<string, unknown>,
  revision: Record<string, unknown>,
  itemId: string | null,
): F53Derived {
  const items = Array.isArray(presentation.items) ? (presentation.items as PresentationItem[]) : [];
  const withOmission = items.filter((it) => Array.isArray(it.omittedOptions) && it.omittedOptions.length > 0);
  const item = itemId === null ? withOmission[0] : items.find((it) => it.itemId === itemId);
  if (!item) throw new Error(itemId === null ? "presentation omits no option on any item" : `presentation has no item ${itemId}`);
  if (!item.omittedOptions || item.omittedOptions.length === 0) throw new Error(`item ${item.itemId} omits no option`);
  const revItems = Array.isArray(revision.items) ? (revision.items as { itemId?: unknown; options?: unknown }[]) : [];
  const revItem = revItems.find((it) => it.itemId === item.itemId);
  const canonicalIds = revItem && Array.isArray(revItem.options)
    ? (revItem.options as { optionId?: unknown }[]).map((o) => String(o.optionId))
    : [];
  if (canonicalIds.length === 0) throw new Error(`canonical revision has no options for ${item.itemId}`);
  const displayedOptionIds = item.displayedOptions.map((o) => o.optionId);
  const omittedOptionId = item.omittedOptions[0].optionId;
  if (!canonicalIds.includes(omittedOptionId)) throw new Error(`omitted option ${omittedOptionId} is not canonical`);
  if (displayedOptionIds.includes(omittedOptionId)) throw new Error(`omitted option ${omittedOptionId} is displayed`);
  for (const id of displayedOptionIds) {
    if (!canonicalIds.includes(id)) throw new Error(`displayed option ${id} is not canonical`);
  }
  const unknownOptionId = ["Z", "ZZ", "UNKNOWN"].find((c) => !canonicalIds.includes(c));
  if (unknownOptionId === undefined) throw new Error("no unknown option id available");
  return { itemId: item.itemId, displayedOptionIds, omittedOptionId, unknownOptionId, legitimateOptionId: displayedOptionIds[0] };
}

export type F53Request = {
  readonly id: string;
  readonly callable: "assessmentSessionsBegin" | "assessmentSessionsAutosave" | "assessmentAttemptsFinalize";
  readonly data: Record<string, unknown>;
  readonly expectStatus: "INVALID_ARGUMENT";
  readonly expectCode: string;
  readonly expectMessageIncludes: string | null;
};

// Begin negatives carry NO launchRef: if a forbidden-key check ever
// regressed, begin would still refuse with BEGIN_REQUIRES_LAUNCH on a covered
// lesson rather than create a session.
export function buildBeginNegatives(assignmentId: string, ap: string, pr: string): F53Request[] {
  const forged: readonly (readonly [string, unknown])[] = [
    ["assessmentPresentationRevisionId", ap],
    ["displayedOptions", [{ itemId: "q1", optionIds: ["A", "B", "C"] }]],
    ["displayedOptionIds", ["A", "B", "C"]],
    ["assessmentRevisionId", "assessment_forged__r9"],
    ["accommodationConfigRevision", 1],
    ["presentationRevisionId", pr],
    ["variantKey", "reading-adapted"],
  ];
  return forged.map(([key, value]) => ({
    id: `E4-begin-${key}`,
    callable: "assessmentSessionsBegin" as const,
    data: { assignmentId, [key]: value },
    expectStatus: "INVALID_ARGUMENT" as const,
    expectCode: "assessmentSessions.invalidRequest",
    expectMessageIncludes: key,
  }));
}

function withItemResponse(
  baseline: readonly { readonly itemId: string; readonly response: unknown }[],
  itemId: string,
  response: string,
): { itemId: string; response: unknown }[] {
  return [...baseline.filter((r) => r.itemId !== itemId), { itemId, response }];
}

export function buildAutosaveNegatives(
  sessionId: string,
  baseline: readonly { readonly itemId: string; readonly response: unknown }[],
  derived: F53Derived,
  ap: string,
): F53Request[] {
  const keep = baseline.map((r) => ({ itemId: r.itemId, response: r.response }));
  return [
    {
      id: "E2-autosave-omitted-distractor",
      callable: "assessmentSessionsAutosave",
      data: { sessionId, responses: withItemResponse(keep, derived.itemId, derived.omittedOptionId) },
      expectStatus: "INVALID_ARGUMENT",
      expectCode: "assessmentSessions.invalidResponses",
      expectMessageIncludes: null,
    },
    {
      id: "E3-autosave-unknown-option",
      callable: "assessmentSessionsAutosave",
      data: { sessionId, responses: withItemResponse(keep, derived.itemId, derived.unknownOptionId) },
      expectStatus: "INVALID_ARGUMENT",
      expectCode: "assessmentSessions.invalidResponses",
      expectMessageIncludes: null,
    },
    ...([
      ["assessmentPresentationRevisionId", ap],
      ["displayedOptions", [{ itemId: derived.itemId, optionIds: [...derived.displayedOptionIds, derived.omittedOptionId] }]],
      ["displayedOptionIds", [...derived.displayedOptionIds, derived.omittedOptionId]],
    ] as const).map(([key, value]) => ({
      id: `E4-autosave-${key}`,
      callable: "assessmentSessionsAutosave" as const,
      data: { sessionId, responses: keep, [key]: value },
      expectStatus: "INVALID_ARGUMENT" as const,
      expectCode: "assessmentSessions.invalidRequest",
      expectMessageIncludes: key,
    })),
  ];
}

// Every finalize payload carries MALFORMED_IDEMPOTENCY_KEY. The assertion
// makes a well-formed (scorable) finalize request impossible to build here.
export function buildFinalizeNegatives(sessionId: string, ap: string, revisionId: string): F53Request[] {
  if (FINALIZE_IDEMPOTENCY_KEY_PATTERN.test(MALFORMED_IDEMPOTENCY_KEY)) {
    throw new Error("finalize negative key must be malformed");
  }
  const forged: readonly (readonly [string, unknown])[] = [
    ["assessmentPresentationRevisionId", ap],
    ["displayedOptions", [{ itemId: "q1", optionIds: ["A", "B", "C"] }]],
    ["displayedOptionIds", ["A", "B", "C"]],
    ["accommodationConfigRevision", 1],
    ["assessmentRevisionId", revisionId],
  ];
  return forged.map(([key, value]) => ({
    id: `E5-finalize-${key}`,
    callable: "assessmentAttemptsFinalize" as const,
    data: { sessionId, idempotencyKey: MALFORMED_IDEMPOTENCY_KEY, [key]: value },
    expectStatus: "INVALID_ARGUMENT" as const,
    expectCode: "assessmentAttempts.invalidRequest",
    expectMessageIncludes: key,
  }));
}

export function classifyRefusal(outcome: F53CallableOutcome, req: F53Request): { readonly pass: boolean; readonly detail: string } {
  if (outcome.ok) return { pass: false, detail: "ACCEPTED (expected a refusal)" };
  const statusOk = outcome.status === req.expectStatus;
  const codeOk = outcome.code === req.expectCode;
  const messageOk = req.expectMessageIncludes === null || outcome.message.includes(`"${req.expectMessageIncludes}"`);
  const detail = `${outcome.status} ${outcome.code ?? "(no code)"}`;
  return { pass: statusOk && codeOk && messageOk, detail: statusOk && codeOk && !messageOk ? `${detail} (refused for another field)` : detail };
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type F53Check = { readonly id: string; readonly pass: boolean; readonly detail: string };
export type F53Report = { readonly mode: F53Mode; readonly ok: boolean; readonly checks: readonly F53Check[] };

type Snapshot = {
  readonly attempts: string;
  readonly passbacks: string;
  readonly current: string;
  readonly grants: string;
};

const fingerprint = (docs: readonly (F53Doc & { readonly id: string })[]): string =>
  docs.map((d) => `${d.id}@${d.updateTime}`).sort().join("|");

export async function runF53Negatives(args: F53Args, ports: F53Ports): Promise<F53Report> {
  const checks: F53Check[] = [];
  const check = (id: string, pass: boolean, detail: string): boolean => {
    checks.push({ id, pass, detail });
    ports.log(`[${F53_DRIVER_NAME}] STAGING ${pass ? "PASS" : "FAIL"} ${id}: ${detail}`);
    return pass;
  };
  const done = (): F53Report => ({ mode: args.mode, ok: checks.every((c) => c.pass), checks });
  ports.log(`[${F53_DRIVER_NAME}] STAGING project=${args.project} mode=${args.mode} (${JSON.stringify(redact({ launchRef: args.launchRef }))})`);

  // P0 preconditions (reads only).
  const grant = await ports.readDoc(`launchGrants/${args.launchRef}`);
  const g = grant?.data ?? {};
  const expiresAt = typeof (g.expiresAt as { toDate?: unknown })?.toDate === "function"
    ? (g.expiresAt as { toDate: () => Date }).toDate()
    : new Date(String(g.expiresAt));
  if (!check("P0-grant", grant !== null && g.studentId === args.studentId && g.assignmentId === args.assignmentId &&
    g.outcomeAtIssuance === "differentiated" && typeof g.presentationRevisionId === "string" &&
    typeof g.assessmentPresentationRevisionId === "string" && typeof g.accommodationConfigRevision === "number",
  "grant belongs to the student and assignment and carries differentiated presentation provenance")) return done();
  if (!check("P0-grant-ttl", expiresAt.getTime() - ports.now().getTime() > GRANT_EXPIRY_MARGIN_MS,
    `grant expires ${expiresAt.toISOString()} (needs > 10 min remaining)`)) return done();
  const ap = String(g.assessmentPresentationRevisionId);
  const pr = String(g.presentationRevisionId);

  const assignment = await ports.readDoc(`assignments/${args.assignmentId}`);
  const a = assignment?.data ?? {};
  const revisionId = typeof a.assessmentRevisionId === "string" ? a.assessmentRevisionId : "";
  if (!check("P0-assignment", assignment !== null && a.lessonSlug === g.lessonSlug && revisionId !== "",
    `assignment lesson ${String(a.lessonSlug)} frozen to ${revisionId}`)) return done();

  const apDoc = await ports.readDoc(`assessmentPresentations/${ap}`);
  const apCheck = checkAssessmentPresentationDoc(ap, apDoc?.data, { lessonSlug: String(a.lessonSlug), assessmentRevisionId: revisionId });
  if (!check("P0-presentation-record", apCheck.ok, apCheck.ok ? `${ap} verified against ${revisionId}` : `refused: ${apCheck.reason}`)) return done();

  const index = await ports.readDoc(`presentationVariants/${String(a.lessonSlug)}__${String(g.variantKey)}`);
  const ix = index?.data ?? {};
  if (!check("P0-index", ix.status === "active" && ix.currentPresentationRevisionId === pr &&
    ix.assessmentPresentationRevisionId === ap && ix.assessmentRevisionId === revisionId,
  "active index is bound to the grant's presentation and the assignment's revision")) return done();

  const revision = await ports.readDoc(`assessmentRevisions/${revisionId}`);
  let derived: F53Derived;
  try {
    derived = deriveNegativeOptions(apDoc?.data ?? {}, revision?.data ?? {}, args.itemId);
  } catch (err) {
    check("P0-derive", false, (err as Error).message);
    return done();
  }
  check("P0-derive", true, `item ${derived.itemId}: displayed ${derived.displayedOptionIds.join("")}, omitted ${derived.omittedOptionId}, unknown ${derived.unknownOptionId}`);

  const sessionsBefore = await ports.queryDocs("assessmentSessions", [["studentId", args.studentId], ["assignmentId", args.assignmentId]]);
  if (!check("P0-sessions", sessionsBefore.length <= 1, `${sessionsBefore.length} existing session(s) for this student and assignment`)) return done();
  const takeSnapshot = async (): Promise<Snapshot> => ({
    attempts: fingerprint(await ports.queryDocs("attempts", [["studentId", args.studentId]])),
    passbacks: fingerprint(await ports.queryDocs("lmsGradePassbacks", [["assignmentId", args.assignmentId]])),
    current: (await ports.readDoc(`classes/${String(a.classId)}/assignmentsCurrent/${String(a.lessonSlug)}`))?.updateTime ?? "absent",
    grants: fingerprint(await ports.queryDocs("launchGrants", [["studentId", args.studentId]])),
  });
  const before = await takeSnapshot();

  const beginNegatives = buildBeginNegatives(args.assignmentId, ap, pr);
  if (args.mode === "plan") {
    const sessionIdHint = sessionsBefore[0]?.id ?? "<from E1 begin>";
    const planned = [
      ...beginNegatives,
      { id: "E1-begin", callable: "assessmentSessionsBegin", data: { assignmentId: args.assignmentId, launchRef: "<redacted>" } },
      { id: "E1-autosave", callable: "assessmentSessionsAutosave", data: { sessionId: sessionIdHint, responses: [{ itemId: derived.itemId, response: derived.legitimateOptionId }] } },
      ...buildAutosaveNegatives(sessionIdHint, [{ itemId: derived.itemId, response: derived.legitimateOptionId }], derived, ap),
      ...buildFinalizeNegatives(sessionIdHint, ap, revisionId),
    ];
    for (const p of planned) ports.log(`[${F53_DRIVER_NAME}] STAGING PLAN ${p.id} ${p.callable} ${JSON.stringify(redact(p.data))}`);
    check("PLAN", true, `${planned.length} request(s) planned; no callable was invoked (re-run with --execute)`);
    return done();
  }

  const runRefusal = async (req: F53Request): Promise<boolean> => {
    const outcome = await ports.invokeCallable(req.callable, req.data);
    const c = classifyRefusal(outcome, req);
    return check(req.id, c.pass, c.detail);
  };

  // E4 at begin (before any session is written by this run).
  for (const req of beginNegatives) await runRefusal(req);
  const sessionsAfterBeginNegatives = await ports.queryDocs("assessmentSessions", [["studentId", args.studentId], ["assignmentId", args.assignmentId]]);
  if (!check("E4-begin-no-session-created", sessionsAfterBeginNegatives.length === sessionsBefore.length,
    `${sessionsAfterBeginNegatives.length} session(s)`)) return done();

  // E1 legitimate begin with the student's own grant.
  const begin = await ports.invokeCallable("assessmentSessionsBegin", { assignmentId: args.assignmentId, launchRef: args.launchRef });
  if (!check("E1-begin", begin.ok && typeof begin.data.sessionId === "string",
    begin.ok ? `sessionId issued (alreadyLive=${String(begin.data.alreadyLive)})` : `${begin.status} ${begin.code ?? ""}`)) return done();
  const sessionId = String((begin as { data: Record<string, unknown> }).data.sessionId);
  const readSession = () => ports.readDoc(`assessmentSessions/${sessionId}`);
  let session = await readSession();
  const s = session?.data ?? {};
  if (!check("E1-frozen-provenance", session !== null && s.status === "live" && s.studentId === args.studentId &&
    s.assignmentId === args.assignmentId && s.assessmentRevisionId === revisionId && s.deliveryOutcome === "differentiated" &&
    s.variantKey === g.variantKey && s.presentationRevisionId === pr && s.assessmentPresentationRevisionId === ap &&
    s.accommodationConfigRevision === g.accommodationConfigRevision,
  `session froze ${String(s.presentationRevisionId)}, ${String(s.assessmentPresentationRevisionId)}, configRevision ${String(s.accommodationConfigRevision)}, ${String(s.assessmentRevisionId)}`)) return done();

  let baseline = (Array.isArray(s.responses) ? s.responses : []) as { itemId: string; response: unknown }[];
  if (baseline.length === 0) {
    const legit = [{ itemId: derived.itemId, response: derived.legitimateOptionId }];
    const saved = await ports.invokeCallable("assessmentSessionsAutosave", { sessionId, responses: legit });
    if (!check("E1-autosave", saved.ok, saved.ok ? `one displayed response saved (persisted=${String(saved.data.persisted)})` : `${saved.status} ${saved.code ?? ""}`)) return done();
    session = await readSession();
    baseline = (Array.isArray(session?.data.responses) ? session?.data.responses : []) as { itemId: string; response: unknown }[];
    if (!check("E1-readback", JSON.stringify(baseline) === JSON.stringify(legit), `stored responses ${JSON.stringify(baseline)}`)) return done();
  } else {
    check("E1-autosave", true, `session already holds ${baseline.length} response(s); kept as the baseline (not overwritten)`);
  }

  // E2-E5: each refusal must leave the session document untouched.
  const refusals = [...buildAutosaveNegatives(sessionId, baseline, derived, ap), ...buildFinalizeNegatives(sessionId, ap, revisionId)];
  for (const req of refusals) {
    const reference = session;
    await runRefusal(req);
    const after = await readSession();
    check(`${req.id}-unchanged`, after !== null && reference !== null && after.updateTime === reference.updateTime &&
      JSON.stringify(after.data.responses ?? []) === JSON.stringify(baseline),
    after === null ? "SESSION MISSING" : `session update time ${after.updateTime}`);
  }

  const afterSnap = await takeSnapshot();
  check("INV-attempts-unchanged", afterSnap.attempts === before.attempts, "no attempt created or modified");
  check("INV-passbacks-unchanged", afterSnap.passbacks === before.passbacks, "no passback created");
  check("INV-current-unchanged", afterSnap.current === before.current, "Current Assignment pointer untouched");
  check("INV-grants-unchanged", afterSnap.grants === before.grants, "no launch grant created or modified");
  const sessionsFinal = await ports.queryDocs("assessmentSessions", [["studentId", args.studentId], ["assignmentId", args.assignmentId]]);
  check("INV-one-live-session", sessionsFinal.length === 1 && sessionsFinal[0].id === sessionId && sessionsFinal[0].data.status === "live",
    `${sessionsFinal.length} session(s); legitimate session preserved for submission`);
  return done();
}

// ---------------------------------------------------------------------------
// Entry point (real SDK and network only here)
// ---------------------------------------------------------------------------

if (require.main === module) {
  void (async () => {
    const parsed = parseF53Args(process.argv.slice(2), process.env);
    if (!parsed.ok) {
      process.stderr.write(`[${F53_DRIVER_NAME}] REFUSED: ${parsed.message}\n${F53_USAGE}\n`);
      process.exit(2);
    }
    const args = parsed.args;
    process.env.GCLOUD_PROJECT = STAGING_PROJECT_ID;
    process.env.GOOGLE_CLOUD_PROJECT = STAGING_PROJECT_ID;
    const { initializeApp, applicationDefault } = await import("firebase-admin/app");
    const { getAuth } = await import("firebase-admin/auth");
    const { getFirestore } = await import("firebase-admin/firestore");
    const { existsSync, readFileSync } = await import("fs");
    const pathModule = await import("path");
    const driver = await import("./staging-cert-driver");
    const credential = applicationDefault();
    const app = initializeApp(
      { credential, projectId: STAGING_PROJECT_ID, serviceAccountId: driver.SIGNING_SERVICE_ACCOUNT },
      F53_DRIVER_NAME,
    );
    if (app.options.projectId !== STAGING_PROJECT_ID) throw new Error("Admin app is not bound to staging");
    const db = getFirestore(app);
    const toDoc = (snap: FirebaseFirestore.DocumentSnapshot): F53Doc | null =>
      snap.exists ? { data: snap.data() ?? {}, updateTime: snap.updateTime?.toDate().toISOString() ?? "" } : null;

    let idToken: string | null = null;
    const studentToken = async (): Promise<string> => {
      if (idToken !== null) return idToken;
      const webConfig = [
        pathModule.resolve(process.cwd(), "assets/lyfelabz-firebase-config.js"),
        pathModule.resolve(process.cwd(), "../../assets/lyfelabz-firebase-config.js"),
      ].find((p) => existsSync(p));
      if (!webConfig) throw new Error("approved staging web configuration is unavailable");
      idToken = await driver.createAstra004StagingIdToken(
        args.studentId,
        {
          credential,
          configuredServiceAccountId: driver.SIGNING_SERVICE_ACCOUNT,
          suppliedWebApiKey: process.env.STAGING_WEB_API_KEY,
          approvedWebApiKey: driver.extractAstra004StagingWebApiKey(readFileSync(webConfig, "utf8")),
        },
        driver.createAstra004TokenExchangeDeps(getAuth(app), fetch),
      );
      return idToken;
    };

    const ports: F53Ports = {
      readDoc: async (p) => toDoc(await db.doc(p).get()),
      queryDocs: async (collection, equals) => {
        let q: FirebaseFirestore.Query = db.collection(collection);
        for (const [field, value] of equals) q = q.where(field, "==", value);
        return (await q.get()).docs.map((d) => ({ id: d.id, ...(toDoc(d) as F53Doc) }));
      },
      invokeCallable: async (name, data) => {
        if (args.mode !== "execute") throw new Error("callables are only invoked with --execute");
        const response = await fetch(driver.callableUrl(STAGING_PROJECT_ID, name), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${await studentToken()}` },
          body: JSON.stringify({ data }),
        });
        const body = (await response.json().catch(() => ({}))) as {
          result?: Record<string, unknown>;
          error?: { status?: string; message?: string; details?: { code?: string } };
        };
        if (response.ok && body.result !== undefined) return { ok: true, data: body.result };
        return {
          ok: false,
          status: String(body.error?.status ?? response.status),
          code: body.error?.details?.code ?? null,
          message: String(body.error?.message ?? ""),
        };
      },
      now: () => new Date(),
      log: (line) => process.stdout.write(`${line}\n`),
    };
    const report = await runF53Negatives(args, ports);
    process.stdout.write(`[${F53_DRIVER_NAME}] STAGING ${report.ok ? "PASS" : "FAIL"}: ${report.checks.filter((c) => c.pass).length}/${report.checks.length} check(s), mode=${report.mode}\n`);
    process.exit(report.ok ? 0 : 1);
  })().catch((err: unknown) => {
    process.stderr.write(`[${F53_DRIVER_NAME}] ERROR: ${String(redact((err as Error)?.message ?? "unexpected failure"))}\n`);
    process.exit(1);
  });
}
