import { readFileSync } from "fs";
import * as path from "path";

import {
  allowedOptionIdsByItem,
  findInvalidResponse,
  narrowToDisplayedOptions,
} from "../assessments/response-validation";
import { computeAssessmentPresentationRevisionId } from "../shared/presentation/assessment-presentation-identity";
import type {
  F53Args,
  F53CallableOutcome,
  F53Doc,
  F53Ports} from "./staging-f53-assessment-negatives";
import {
  buildBeginNegatives,
  buildFinalizeNegatives,
  classifyRefusal,
  deriveNegativeOptions,
  F53_USAGE,
  MALFORMED_IDEMPOTENCY_KEY,
  parseF53Args,
  runF53Negatives,
} from "./staging-f53-assessment-negatives";

// Fixtures: the committed, owner-certified Earth's Layers presentation and
// its canonical r1 payload (read only; no network, no Firebase).
const SCRIPTS = path.resolve(__dirname);
const AP_ID = "ap1fed478c9e4ad8335946ff7f7b165df657bafc48e8c5990d922419581fa02c25";
const PR_ID = "pr90f52136d39f36d21bf1602d0af3901adf0eae32a046c522907c5e932f342189";
const RECORD = JSON.parse(readFileSync(path.join(SCRIPTS, "assessment-presentations", `${AP_ID}.json`), "utf8")) as Record<string, unknown>;
const REVISION = JSON.parse(readFileSync(path.join(SCRIPTS, "assessments", "earths-layers.r1.json"), "utf8")) as Record<string, unknown>;
const REV_ID = "assessment_earths-layers__r1";
const STUDENT = "studentUid000001";
const ASSIGNMENT = "a-earths-layers-class-teacher";
const GRANT = "0123456789abcdef0123456789abcdef";
const NOW = new Date("2026-09-28T01:00:00.000Z");
const STAGING_ENV = { GCLOUD_PROJECT: "lyfelabz-staging" } as NodeJS.ProcessEnv;

const ARGS = (over: Partial<F53Args> = {}): F53Args => ({
  project: "lyfelabz-staging",
  mode: "execute",
  studentId: STUDENT,
  assignmentId: ASSIGNMENT,
  launchRef: GRANT,
  itemId: null,
  ...over,
});

describe("staging lock and argument validation (before any network)", () => {
  const base = [`--student=${STUDENT}`, `--assignment=${ASSIGNMENT}`, `--launch-ref=${GRANT}`];

  test("accepts only the literal staging project and defaults to plan mode", () => {
    const r = parseF53Args(["--project=lyfelabz-staging", ...base], STAGING_ENV);
    expect(r).toEqual({ ok: true, args: ARGS({ mode: "plan" }) });
    const e = parseF53Args(["--project=lyfelabz-staging", ...base, "--execute"], {});
    expect(e.ok && e.args.mode).toBe("execute");
  });

  test.each([
    ["missing project", base, {}],
    ["production project", ["--project=lyfelabz-prod", ...base], {}],
    ["alias instead of project id", ["--project=staging", ...base], {}],
    ["default alias", ["--project=default", ...base], {}],
    ["production in GCLOUD_PROJECT", ["--project=lyfelabz-staging", ...base], { GCLOUD_PROJECT: "lyfelabz-prod" }],
    ["production in GOOGLE_CLOUD_PROJECT", ["--project=lyfelabz-staging", ...base], { GOOGLE_CLOUD_PROJECT: "lyfelabz-prod" }],
    ["Firestore emulator", ["--project=lyfelabz-staging", ...base], { FIRESTORE_EMULATOR_HOST: "localhost:8080" }],
    ["Auth emulator", ["--project=lyfelabz-staging", ...base], { FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099" }],
    ["a production override flag", ["--project=lyfelabz-staging", ...base, "--i-know=production"], {}],
    ["a target flag", ["--project=lyfelabz-staging", ...base, "--target=production"], {}],
    ["a duplicated project", ["--project=lyfelabz-staging", "--project=lyfelabz-prod", ...base], {}],
    ["a duplicated --execute", ["--project=lyfelabz-staging", ...base, "--execute", "--execute"], {}],
  ])("refuses %s", (_label, argv, env) => {
    const r = parseF53Args(argv, env);
    expect(r.ok).toBe(false);
  });

  test.each([
    ["student", [`--assignment=${ASSIGNMENT}`, `--launch-ref=${GRANT}`]],
    ["assignment", [`--student=${STUDENT}`, `--launch-ref=${GRANT}`]],
    ["launch ref", [`--student=${STUDENT}`, `--assignment=${ASSIGNMENT}`]],
    ["malformed launch ref", [`--student=${STUDENT}`, `--assignment=${ASSIGNMENT}`, "--launch-ref=not-a-grant"]],
    ["malformed item", [...base, "--item=q 1"]],
  ])("refuses missing or malformed %s", (_label, rest) => {
    expect(parseF53Args(["--project=lyfelabz-staging", ...(rest)], {}).ok).toBe(false);
  });

  test("usage names only staging and offers no production option", () => {
    expect(F53_USAGE).toContain("--project=lyfelabz-staging");
    expect(F53_USAGE).not.toMatch(/prod|--target|--i-know/);
  });
});

describe("omitted-option derivation from the certified record", () => {
  test("the fixture record is the certified content-addressed presentation", () => {
    expect(computeAssessmentPresentationRevisionId(RECORD)).toBe(AP_ID);
  });

  test("defaults to the first item with an omission and never guesses by position", () => {
    const d = deriveNegativeOptions(RECORD, REVISION, null);
    expect(d).toEqual({ itemId: "q1", displayedOptionIds: ["B", "C", "D"], omittedOptionId: "A", unknownOptionId: "Z", legitimateOptionId: "B" });
  });

  test("an explicit item uses that item's recorded omission", () => {
    const d = deriveNegativeOptions(RECORD, REVISION, "q9");
    expect(d.omittedOptionId).toBe("C");
    expect(d.displayedOptionIds).toEqual(["A", "B", "D"]);
  });

  test("refuses an unknown item or a record inconsistent with the canonical revision", () => {
    expect(() => deriveNegativeOptions(RECORD, REVISION, "q99")).toThrow("no item q99");
    const broken = JSON.parse(JSON.stringify(RECORD)) as { items: { omittedOptions: { optionId: string }[] }[] };
    broken.items[0].omittedOptions[0].optionId = "Q";
    expect(() => deriveNegativeOptions(broken, REVISION, "q1")).toThrow("not canonical");
  });
});

describe("request construction", () => {
  test("begin negatives never carry a launch reference and each forges exactly one server-owned field", () => {
    const reqs = buildBeginNegatives(ASSIGNMENT, AP_ID, PR_ID);
    expect(reqs.map((r) => r.expectMessageIncludes)).toEqual([
      "assessmentPresentationRevisionId", "displayedOptions", "displayedOptionIds", "assessmentRevisionId",
      "accommodationConfigRevision", "presentationRevisionId", "variantKey",
    ]);
    for (const r of reqs) {
      expect(r.data).not.toHaveProperty("launchRef");
      expect(Object.keys(r.data)).toEqual(["assignmentId", r.expectMessageIncludes]);
    }
  });

  test("every finalize negative carries a malformed idempotency key, so no scorable finalize can be built", () => {
    const reqs = buildFinalizeNegatives("session-1", AP_ID, REV_ID);
    expect(reqs.length).toBeGreaterThanOrEqual(4);
    for (const r of reqs) expect(r.data.idempotencyKey).toBe(MALFORMED_IDEMPOTENCY_KEY);
    expect(/^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,126}[a-zA-Z0-9])?$/.test(MALFORMED_IDEMPOTENCY_KEY)).toBe(false);
  });

  test("refusal classification requires the exact status, code, and refused field", () => {
    const [req] = buildFinalizeNegatives("session-1", AP_ID, REV_ID);
    const refused = (code: string, message: string): F53CallableOutcome => ({ ok: false, status: "INVALID_ARGUMENT", code, message });
    expect(classifyRefusal(refused("assessmentAttempts.invalidRequest", `Server-owned field "${String(req.expectMessageIncludes)}" is not permitted on the request.`), req).pass).toBe(true);
    expect(classifyRefusal(refused("assessmentAttempts.invalidIdempotencyKey", "idempotencyKey must be a URL-safe token."), req).pass).toBe(false);
    expect(classifyRefusal(refused("assessmentAttempts.invalidRequest", 'Server-owned field "studentId" is not permitted on the request.'), req).pass).toBe(false);
    expect(classifyRefusal({ ok: true, data: {} }, req).pass).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// In-memory staging model. Autosave admissibility uses the REAL product
// validators; request-shape refusals mirror the deployed callable contracts.
// ---------------------------------------------------------------------------

type Faults = { acceptOmitted?: boolean; persistOnRefusal?: boolean; finalizeSkipsForbiddenCheck?: boolean; wrongFrozenAp?: boolean };

function makeStaging(opts: { faults?: Faults; grantExpiresAt?: Date; grantStudent?: string; existingResponses?: { itemId: string; response: string }[] } = {}) {
  const faults = opts.faults ?? {};
  let clock = 0;
  const tick = () => `2026-09-28T01:00:${String(++clock).padStart(2, "0")}.000Z`;
  const docs = new Map<string, F53Doc>();
  const put = (p: string, data: Record<string, unknown>) => docs.set(p, { data, updateTime: tick() });
  put(`launchGrants/${GRANT}`, {
    grantId: GRANT, studentId: opts.grantStudent ?? STUDENT, assignmentId: ASSIGNMENT, lessonSlug: "earths-layers",
    outcomeAtIssuance: "differentiated", variantKey: "reading-adapted", presentationRevisionId: PR_ID,
    assessmentPresentationRevisionId: AP_ID, accommodationConfigRevision: 1,
    issuedAt: new Date("2026-09-28T00:20:00Z"), expiresAt: opts.grantExpiresAt ?? new Date("2026-09-28T06:20:00Z"),
  });
  put(`assignments/${ASSIGNMENT}`, { lessonSlug: "earths-layers", assessmentRevisionId: REV_ID, classId: "class-1", status: "published" });
  put(`assessmentPresentations/${AP_ID}`, RECORD);
  put(`presentationVariants/earths-layers__reading-adapted`, {
    status: "active", currentPresentationRevisionId: PR_ID, assessmentRevisionId: REV_ID, assessmentPresentationRevisionId: AP_ID,
  });
  put(`assessmentRevisions/${REV_ID}`, REVISION);
  put("classes/class-1/assignmentsCurrent/earths-layers", { assignmentId: ASSIGNMENT });
  put(`attempts/${ASSIGNMENT}__${STUDENT}__a1`, { studentId: STUDENT, presentationRevisionId: "prff01", percentage: 20 });
  const sessionPath = `assessmentSessions/${ASSIGNMENT}__${STUDENT}__1`;
  if (opts.existingResponses) {
    put(sessionPath, {
      studentId: STUDENT, assignmentId: ASSIGNMENT, status: "live", assessmentRevisionId: REV_ID, deliveryOutcome: "differentiated",
      variantKey: "reading-adapted", presentationRevisionId: PR_ID, assessmentPresentationRevisionId: AP_ID,
      accommodationConfigRevision: 1, responses: opts.existingResponses,
    });
  }
  const calls: { name: string; data: Record<string, unknown> }[] = [];
  const refuse = (code: string, message: string): F53CallableOutcome => ({ ok: false, status: code === "BEGIN_REQUIRES_LAUNCH" ? "UNAVAILABLE" : "INVALID_ARGUMENT", code, message });
  const forbidden = (data: Record<string, unknown>, keys: readonly string[]) => keys.find((k) => k in data);
  const BEGIN_FORBIDDEN = ["variantKey", "presentationRevisionId", "assessmentPresentationRevisionId", "accommodationConfigRevision", "assessmentRevisionId", "displayedOptions", "displayedOptionIds", "studentId", "configRevision"];
  const AUTOSAVE_FORBIDDEN = ["assessmentPresentationRevisionId", "displayedOptions", "displayedOptionIds"];
  const FINALIZE_FORBIDDEN = ["assessmentPresentationRevisionId", "accommodationConfigRevision", "displayedOptions", "displayedOptionIds", "assessmentRevisionId", "responses"];

  const invokeCallable = (name: string, data: Record<string, unknown>): Promise<F53CallableOutcome> => {
    calls.push({ name, data });
    const result = ((): F53CallableOutcome => {
      if (name === "assessmentSessionsBegin") {
        const k = forbidden(data, BEGIN_FORBIDDEN);
        if (k) return refuse("assessmentSessions.invalidRequest", `Server-owned field "${k}" is not permitted on the request.`);
        if (data.launchRef === undefined) return refuse("BEGIN_REQUIRES_LAUNCH", "launch required");
        if (docs.has(sessionPath)) return { ok: true, data: { sessionId: sessionPath.split("/")[1], alreadyLive: true } };
        put(sessionPath, {
          studentId: STUDENT, assignmentId: ASSIGNMENT, status: "live", assessmentRevisionId: REV_ID, deliveryOutcome: "differentiated",
          variantKey: "reading-adapted", presentationRevisionId: PR_ID,
          assessmentPresentationRevisionId: faults.wrongFrozenAp ? "ap" + "0".repeat(64) : AP_ID,
          accommodationConfigRevision: 1, responses: [],
        });
        return { ok: true, data: { sessionId: sessionPath.split("/")[1], alreadyLive: false } };
      }
      if (name === "assessmentSessionsAutosave") {
        const k = forbidden(data, AUTOSAVE_FORBIDDEN);
        if (k) return refuse("assessmentSessions.invalidRequest", `Server-owned field "${k}" is not permitted on the request.`);
        const responses = data.responses as { itemId: string; response: unknown }[];
        const displayed = new Map((RECORD.items as { itemId: string; displayedOptions: { optionId: string }[] }[])
          .map((it) => [it.itemId, new Set(it.displayedOptions.map((o) => o.optionId))] as const));
        const allowed = narrowToDisplayedOptions(allowedOptionIdsByItem(REVISION), displayed);
        const invalid = findInvalidResponse(responses, faults.acceptOmitted ? allowedOptionIdsByItem(REVISION) : allowed);
        if (invalid) {
          if (faults.persistOnRefusal) put(sessionPath, { ...docs.get(sessionPath)!.data, responses });
          return refuse("assessmentSessions.invalidResponses", "response is not admissible");
        }
        put(sessionPath, { ...docs.get(sessionPath)!.data, responses });
        return { ok: true, data: { sessionId: data.sessionId, persisted: true } };
      }
      if (name === "assessmentAttemptsFinalize") {
        const k = faults.finalizeSkipsForbiddenCheck ? undefined : forbidden(data, FINALIZE_FORBIDDEN);
        if (k) return refuse("assessmentAttempts.invalidRequest", `Server-owned field "${k}" is not permitted on the request.`);
        if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,126}[a-zA-Z0-9])?$/.test(String(data.idempotencyKey))) {
          return refuse("assessmentAttempts.invalidIdempotencyKey", "idempotencyKey must be a URL-safe token.");
        }
        // A scorable finalize: creates an attempt and consumes the session.
        put(`attempts/${ASSIGNMENT}__${STUDENT}__a2`, { studentId: STUDENT });
        docs.delete(sessionPath);
        return { ok: true, data: { attemptId: "a2" } };
      }
      throw new Error(`unexpected callable ${name}`);
    })();
    return Promise.resolve(result);
  };

  const log: string[] = [];
  const ports: F53Ports = {
    readDoc: (p) => Promise.resolve(docs.get(p) ?? null),
    queryDocs: (collection, equals) => Promise.resolve([...docs.entries()]
      .filter(([p]) => p.startsWith(`${collection}/`) && p.split("/").length === 2)
      .filter(([, d]) => equals.every(([f, v]) => d.data[f] === v))
      .map(([p, d]) => ({ id: p.split("/")[1], ...d }))),
    invokeCallable: jest.fn(invokeCallable),
    now: () => NOW,
    log: (line) => log.push(line),
  };
  return { ports, docs, calls, log, sessionPath };
}

describe("plan mode (reads only)", () => {
  test("never invokes a callable and redacts the launch reference", async () => {
    const s = makeStaging();
    const report = await runF53Negatives(ARGS({ mode: "plan" }), s.ports);
    expect(report.ok).toBe(true);
    expect(s.ports.invokeCallable).not.toHaveBeenCalled();
    expect(s.log.join("\n")).not.toContain(GRANT);
    expect(s.log.join("\n")).toContain("STAGING");
    expect(s.docs.has(s.sessionPath)).toBe(false);
  });
});

describe("execute mode against a correct staging model", () => {
  test("E1-E5 all pass, one legitimate response persists, and nothing is scored", async () => {
    const s = makeStaging();
    const before = [...s.docs.keys()].filter((k) => k.startsWith("attempts/")).sort();
    const report = await runF53Negatives(ARGS(), s.ports);
    expect(report.checks.filter((c) => !c.pass)).toEqual([]);
    expect(report.ok).toBe(true);
    const ids = report.checks.map((c) => c.id);
    for (const id of ["E1-begin", "E1-frozen-provenance", "E1-autosave", "E1-readback", "E2-autosave-omitted-distractor",
      "E3-autosave-unknown-option", "E4-autosave-assessmentPresentationRevisionId", "E4-begin-assessmentPresentationRevisionId",
      "E5-finalize-assessmentPresentationRevisionId", "INV-attempts-unchanged", "INV-one-live-session"]) {
      expect(ids).toContain(id);
    }
    expect(s.docs.get(s.sessionPath)?.data.responses).toEqual([{ itemId: "q1", response: "B" }]);
    expect([...s.docs.keys()].filter((k) => k.startsWith("attempts/")).sort()).toEqual(before);
    for (const c of s.calls.filter((x) => x.name === "assessmentAttemptsFinalize")) {
      expect(c.data.idempotencyKey).toBe(MALFORMED_IDEMPOTENCY_KEY);
    }
    const legit = s.calls.filter((c) => c.name === "assessmentSessionsBegin" && "launchRef" in c.data);
    expect(legit).toHaveLength(1);
  });

  test("an existing session's responses are kept as the baseline, never overwritten", async () => {
    const s = makeStaging({ existingResponses: [{ itemId: "q3", response: "C" }] });
    const report = await runF53Negatives(ARGS(), s.ports);
    expect(report.ok).toBe(true);
    expect(s.calls.filter((c) => c.name === "assessmentSessionsAutosave" && !("assessmentPresentationRevisionId" in c.data))
      .every((c) => JSON.stringify(c.data.responses).includes('"itemId":"q3"'))).toBe(true);
    expect(s.docs.get(s.sessionPath)?.data.responses).toEqual([{ itemId: "q3", response: "C" }]);
  });
});

describe("regressions are detected, and none can consume the session", () => {
  test("a server that accepts the omitted distractor fails E2 and its unchanged read-back", async () => {
    const s = makeStaging({ faults: { acceptOmitted: true } });
    const report = await runF53Negatives(ARGS(), s.ports);
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => c.id === "E2-autosave-omitted-distractor")?.pass).toBe(false);
    expect(report.checks.find((c) => c.id === "E2-autosave-omitted-distractor-unchanged")?.pass).toBe(false);
  });

  test("a refusal that still writes is caught by the unchanged read-back", async () => {
    const s = makeStaging({ faults: { persistOnRefusal: true } });
    const report = await runF53Negatives(ARGS(), s.ports);
    expect(report.checks.find((c) => c.id === "E3-autosave-unknown-option")?.pass).toBe(true);
    expect(report.checks.find((c) => c.id === "E3-autosave-unknown-option-unchanged")?.pass).toBe(false);
  });

  test("a finalize without its forbidden-key check fails E5 but still cannot score or delete the session", async () => {
    const s = makeStaging({ faults: { finalizeSkipsForbiddenCheck: true } });
    const report = await runF53Negatives(ARGS(), s.ports);
    expect(report.checks.find((c) => c.id === "E5-finalize-assessmentPresentationRevisionId")?.pass).toBe(false);
    expect(s.docs.has(s.sessionPath)).toBe(true);
    expect(s.docs.has(`attempts/${ASSIGNMENT}__${STUDENT}__a2`)).toBe(false);
    expect(report.checks.find((c) => c.id === "INV-attempts-unchanged")?.pass).toBe(true);
    expect(report.checks.find((c) => c.id === "INV-one-live-session")?.pass).toBe(true);
  });

  test("wrong frozen provenance stops the run before any negative is sent", async () => {
    const s = makeStaging({ faults: { wrongFrozenAp: true } });
    const report = await runF53Negatives(ARGS(), s.ports);
    expect(report.ok).toBe(false);
    expect(report.checks[report.checks.length - 1].id).toBe("E1-frozen-provenance");
    expect(s.calls.some((c) => c.name === "assessmentSessionsAutosave" || c.name === "assessmentAttemptsFinalize")).toBe(false);
  });
});

describe("preconditions refuse before any callable", () => {
  test.each([
    ["a grant close to expiry", { grantExpiresAt: new Date(NOW.getTime() + 5 * 60 * 1000) }, "P0-grant-ttl"],
    ["another student's grant", { grantStudent: "someoneElse0001" }, "P0-grant"],
  ])("%s", async (_label, opts, failedId) => {
    const s = makeStaging(opts);
    const report = await runF53Negatives(ARGS(), s.ports);
    expect(report.ok).toBe(false);
    expect(report.checks.find((c) => !c.pass)?.id).toBe(failedId);
    expect(s.ports.invokeCallable).not.toHaveBeenCalled();
  });
});
