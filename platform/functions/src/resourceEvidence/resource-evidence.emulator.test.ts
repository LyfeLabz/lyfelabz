// RA-3A emulator-backed persistence proofs.
//
// Runs against the REAL Firestore emulator (`npm run test:emulator`, which
// wraps jest in `firebase emulators:exec` with the offline `demo-bootstrap`
// project). Identity, entitlement, and the Current-occurrence rule run
// through the real shared helpers and real Firestore reads; transactions,
// `create` semantics, and contention are real. Only the two integration
// ports that have no platform implementation yet (the frozen
// completion-definition version and the published definition store) are
// test fixtures here (RA-3B's real Firestore adapters are proven in
// `assignments/frozen-completion-publication.emulator.test.ts`). Fixture
// ports still go through the canonical verifier, so every fixture record
// and binding is built with the real RA-3B record and binding helpers. The
// Gravity Wells DRAFT definition is used as a fixture here only;
// production code never registers it.
//
// Every record below is synthetic emulator data. Nothing contacts a live
// project. Skips when the emulator host is absent.

import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";

import {
  GRAVITY_WELLS_COMPLETION_DEFINITION,
  GRAVITY_WELLS_RESOURCE_ID,
  buildAssignmentCompletionBinding,
  prepareCompletionDefinitionRecord,
  verifyCompletionDefinitionRecord,
  type CompletionDefinition,
} from "../resourceCompletion";
import {
  PRODUCTION_RESOURCE_EVIDENCE_DEPS,
  RUN_VERIFICATION_LIMITS,
  getOwnResourceEvidence,
  readSubmittedSnapshot,
  recordResourceOutcomeRun,
  resourceEvidenceRecordId,
  saveWorkingResourceEvidence,
  submitResourceEvidence,
  type ResourceEvidenceDeps,
} from "./index";
import { log, type LogPayload } from "../shared/logging/logger";

const PROJECT = "demo-bootstrap";
const hasEmulator = !!process.env.FIRESTORE_EMULATOR_HOST;
const d = hasEmulator ? describe : describe.skip;

if (hasEmulator) {
  const envProject = process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT ?? PROJECT;
  for (const p of [PROJECT, envProject]) {
    if (p === "lyfelabz-prod" || p === "lyfelabz-staging" || !p.startsWith("demo-")) {
      throw new Error(`Refusing to run emulator tests against "${p}"; a demo project is required.`);
    }
  }
  if (getApps().length === 0) initializeApp({ projectId: PROJECT });
}
const db = hasEmulator ? getFirestore() : (undefined as never);

const REVISION_R1 = GRAVITY_WELLS_COMPLETION_DEFINITION.assessmentRevisionId;
// Same resource, revision, and version, different content (so a different
// hash): what an unauthorized rewrite of a frozen definition would look like.
const ALTERED_DEFINITION: CompletionDefinition = {
  ...GRAVITY_WELLS_COMPLETION_DEFINITION,
  evidence: [{ ...GRAVITY_WELLS_COMPLETION_DEFINITION.evidence[0], prompt: "Explain orbits." }],
};

function definitionRecord(def: CompletionDefinition): Record<string, unknown> {
  const prepared = prepareCompletionDefinitionRecord(def, {
    resourceId: def.resourceId,
    resourceType: def.resourceType,
    assessmentRevisionId: def.assessmentRevisionId,
    publishedBy: "emulator-fixture",
  });
  if (!prepared.ok) throw new Error(`fixture definition refused: ${prepared.issue}`);
  return { ...prepared.write, publishedAt: Timestamp.now() };
}

function bindingFor(assignmentId: string, classId: string, def: CompletionDefinition) {
  const verified = verifyCompletionDefinitionRecord(def.assessmentRevisionId, definitionRecord(def), {
    resourceId: def.resourceId,
    resourceType: def.resourceType,
  });
  if (!verified.ok) throw new Error(`fixture record refused: ${verified.issue}`);
  return buildAssignmentCompletionBinding({ assignmentId, classId }, verified);
}

const GRAVITY_WELLS_HASH = bindingFor("fixture", "fixture", GRAVITY_WELLS_COMPLETION_DEFINITION).definitionHash;

// Fixture ports: `frozen` stands in for the binding publication freezes on
// the assignment, `stored` for `completionDefinitions/{revisionId}`.
const frozen = new Map<string, unknown>();
let stored = new Map<string, unknown>();
const DEPS: ResourceEvidenceDeps = {
  bindingSource: { frozenBinding: (id) => Promise.resolve(frozen.get(id) ?? null) },
  definitionStore: {
    publishedDefinition: (revisionId) => Promise.resolve(stored.get(revisionId) ?? null),
  },
};

function launch(massKey: string, speed: number, degrees: number, observedInvocations = 3600) {
  const a = (degrees * Math.PI) / 180;
  return { massKey, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, observedInvocations };
}
// Outcomes observed against the page script in RA-2's parity tests.
const EARTH_ORBIT = launch("earth", 2, 75); // earth-orbit
const EARTH_CRASH = launch("earth", 0.5, 0); // nothing
const SUN_ESCAPE = launch("sun", 5.5, 0); // sun-escape, flyby
const JUPITER_ORBIT = launch("jupiter", 2.5, 75); // jupiter-orbit
// RA-2 parity case: the Black Hole flyby is detected on call 84,428 (after
// step 84,427), beyond the earlier 80,000-call per-run cap.
const LATE_BLACK_HOLE = { massKey: "blackhole", vx: -6.250529833461967, vy: 4.420815000592066, observedInvocations: 100_000 };
// A stable Earth orbit observed far longer than any run may be verified.
const endlessOrbit = (degrees: number) => launch("earth", 2, degrees, 4_000_001);

const EXPLANATION = "The probe needs enough sideways speed to keep missing the planet as it falls.";

type World = {
  readonly ns: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly classId: string;
  readonly teacher: string;
  readonly studentA: string;
  readonly studentB: string;
  readonly assignmentId: string;
};

let counter = 0;
function token(prefix: string): string {
  counter += 1;
  return `${prefix}-${String(counter).padStart(6, "0")}`;
}

async function seedWorld(): Promise<World> {
  const ns = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const w: World = {
    ns,
    schoolId: `school-${ns}`,
    districtId: `district-${ns}`,
    classId: `class-${ns}`,
    teacher: `teacher-${ns}`,
    studentA: `student-a-${ns}`,
    studentB: `student-b-${ns}`,
    assignmentId: `asg-${ns}`,
  };
  const batch = db.batch();
  batch.set(db.doc(`schools/${w.schoolId}`), { districtId: w.districtId, name: "Emulator School" });
  batch.set(db.doc(`users/${w.teacher}`), { status: "active", role: "teacher", schoolId: w.schoolId });
  for (const s of [w.studentA, w.studentB]) {
    batch.set(db.doc(`users/${s}`), { status: "active", role: "student", schoolId: w.schoolId });
    batch.set(db.doc(`enrollments/${w.classId}__${s}`), {
      classId: w.classId,
      studentId: s,
      schoolId: w.schoolId,
      status: "active",
    });
  }
  await batch.commit();
  await seedAssignment(w, w.assignmentId);
  return w;
}

async function seedAssignment(w: World, assignmentId: string, overrides: Record<string, unknown> = {}) {
  await db.doc(`assignments/${assignmentId}`).set({
    classId: w.classId,
    teacherId: w.teacher,
    schoolId: w.schoolId,
    lessonSlug: GRAVITY_WELLS_RESOURCE_ID,
    resourceType: "simulation",
    mode: "classroom",
    status: "published",
    createdAt: Timestamp.now(),
    assessmentRevisionId: REVISION_R1,
    ...overrides,
  });
  frozen.set(assignmentId, bindingFor(assignmentId, w.classId, GRAVITY_WELLS_COMPLETION_DEFINITION));
}

function req(w: World, uid: string, data: unknown, role = "student"): CallableRequest<unknown> {
  return {
    data,
    auth: { uid, token: { role, schoolId: w.schoolId, districtId: w.districtId } },
  } as unknown as CallableRequest<unknown>;
}

function save(w: World, uid: string, text: string, expectedWorkingRevision: number, operationId = token("save"), assignmentId = w.assignmentId) {
  return saveWorkingResourceEvidence(
    req(w, uid, {
      assignmentId,
      operationId,
      expectedWorkingRevision,
      working: { authored: [{ evidenceId: "orbit-speed-explanation", kind: "text", text }], attestations: [] },
    }),
    DEPS,
  );
}

function record(w: World, uid: string, parameters: unknown, flightId = token("flight"), operationId = token("run"), assignmentId = w.assignmentId) {
  return recordResourceOutcomeRun(req(w, uid, { assignmentId, operationId, flightId, parameters }), DEPS);
}

function submit(w: World, uid: string, expectedWorkingRevision: number, expectedRunsRevision: number, operationId = token("submit"), assignmentId = w.assignmentId) {
  return submitResourceEvidence(
    req(w, uid, { assignmentId, operationId, expectedWorkingRevision, expectedRunsRevision }),
    DEPS,
  );
}

function get(w: World, uid: string, assignmentId = w.assignmentId, deps = DEPS) {
  return getOwnResourceEvidence(req(w, uid, { assignmentId }), deps);
}

async function rawRecord(w: World, uid = w.studentA, assignmentId = w.assignmentId) {
  const snap = await db.doc(`resourceEvidence/${resourceEvidenceRecordId(assignmentId, uid)}`).get();
  return snap.exists ? snap.data() : undefined;
}

// Builds an eligible record: Earth orbit + Sun escape (+ flyby) + explanation.
async function eligibleRecord(w: World) {
  await record(w, w.studentA, EARTH_ORBIT);
  const runs = await record(w, w.studentA, SUN_ESCAPE);
  const saved = await save(w, w.studentA, EXPLANATION, 0);
  return { workingRevision: saved.workingRevision, runsRevision: runs.runsRevision };
}

d("RA-3A resource evidence persistence (Firestore emulator)", () => {
  let w: World;
  // Every service log goes through the shared `log` object; capture what
  // would be emitted (and keep the test output quiet).
  const logged: string[] = [];
  beforeAll(() => {
    for (const method of ["info", "warn", "error"] as const) {
      jest.spyOn(log, method).mockImplementation((event: string, payload: LogPayload) => {
        logged.push(`${event} ${JSON.stringify(payload)}`);
      });
    }
  });
  afterAll(() => jest.restoreAllMocks());
  beforeEach(async () => {
    stored = new Map([[REVISION_R1, definitionRecord(GRAVITY_WELLS_COMPLETION_DEFINITION)]]);
    w = await seedWorld();
  });

  it("never logs student text or run parameters", async () => {
    logged.length = 0;
    const { workingRevision, runsRevision } = await eligibleRecord(w);
    await submit(w, w.studentA, workingRevision, runsRevision);
    expect(logged.some((l) => l.includes("resourceEvidence.submitted"))).toBe(true);
    const all = logged.join("\n");
    expect(all).not.toContain(EXPLANATION.slice(0, 20));
    expect(all).not.toContain(String(EARTH_ORBIT.vx));
    expect(all).not.toContain(String(EARTH_ORBIT.vy));
  });

  describe("authentication and authorization", () => {
    it("refuses an unauthenticated caller", async () => {
      const request = { data: { assignmentId: w.assignmentId }, auth: undefined } as unknown as CallableRequest<unknown>;
      await expect(getOwnResourceEvidence(request, DEPS)).rejects.toMatchObject({ code: "unauthenticated" });
    });

    it("refuses a teacher, even the assignment's own", async () => {
      await expect(
        getOwnResourceEvidence(req(w, w.teacher, { assignmentId: w.assignmentId }, "teacher"), DEPS),
      ).rejects.toMatchObject({ code: "role-forbidden" });
    });

    it("refuses forged claims that disagree with the canonical user record", async () => {
      const forged = {
        data: { assignmentId: w.assignmentId },
        auth: { uid: w.studentA, token: { role: "student", schoolId: w.schoolId, districtId: "district-other" } },
      } as unknown as CallableRequest<unknown>;
      await expect(getOwnResourceEvidence(forged, DEPS)).rejects.toMatchObject({ code: "district-mismatch" });
    });

    it("keeps each student's evidence separate (wrong student)", async () => {
      await save(w, w.studentA, EXPLANATION, 0);
      // Student B is enrolled in the same class and sees only an empty record.
      await expect(get(w, w.studentB)).resolves.toEqual({ exists: false, workingRevision: 0, runsRevision: 0 });
      // A student outside the class is refused without learning anything.
      const outsider = `outsider-${w.ns}`;
      await db.doc(`users/${outsider}`).set({ status: "active", role: "student", schoolId: w.schoolId });
      await expect(get(w, outsider)).rejects.toMatchObject({ code: "resourceEvidence.forbidden" });
      await expect(save(w, outsider, "x", 0)).rejects.toMatchObject({ code: "resourceEvidence.forbidden" });
      // A withdrawn student is refused.
      await db.doc(`enrollments/${w.classId}__${w.studentB}`).update({ status: "withdrawn" });
      await expect(get(w, w.studentB)).rejects.toMatchObject({ code: "resourceEvidence.forbidden" });
    });

    it.each([
      ["unknown assignment", null],
      ["lesson assignment", { lessonSlug: "earths-layers", resourceType: undefined, assessmentRevisionId: "assessment_earths-layers__r1" }],
      ["draft assignment", { status: "draft" }],
      ["archived assignment", { status: "archived" }],
      ["practice mode", { mode: "practice" }],
      ["another school", { schoolId: "school-elsewhere" }],
      ["resource type disagreeing with its identifier (wrong resource)", { resourceType: "investigation" }],
    ])("refuses the %s uniformly", async (_label, overrides) => {
      const id = `asg-x-${w.ns}`;
      if (overrides) {
        const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
        await seedAssignment(w, id, clean);
        if ("resourceType" in overrides && overrides.resourceType === undefined) {
          await db.doc(`assignments/${id}`).update({ resourceType: FieldValue.delete() });
        }
      }
      await expect(get(w, w.studentA, id)).rejects.toMatchObject({ code: "resourceEvidence.forbidden" });
      await expect(save(w, w.studentA, EXPLANATION, 0, token("save"), id)).rejects.toMatchObject({
        code: "resourceEvidence.forbidden",
      });
      expect(await rawRecord(w, w.studentA, id)).toBeUndefined();
    });
  });

  describe("frozen revision and completion binding", () => {
    it("production deps refuse a fully entitled student and write nothing", async () => {
      await expect(get(w, w.studentA, w.assignmentId, PRODUCTION_RESOURCE_EVIDENCE_DEPS)).rejects.toMatchObject({
        code: "resourceEvidence.completionBindingUnavailable",
      });
      await expect(
        saveWorkingResourceEvidence(
          req(w, w.studentA, {
            assignmentId: w.assignmentId,
            operationId: token("save"),
            expectedWorkingRevision: 0,
            working: { authored: [], attestations: [] },
          }),
          PRODUCTION_RESOURCE_EVIDENCE_DEPS,
        ),
      ).rejects.toMatchObject({ code: "resourceEvidence.completionBindingUnavailable" });
      expect(await rawRecord(w)).toBeUndefined();
    });

    it("refuses an assignment with no frozen definition version", async () => {
      frozen.delete(w.assignmentId);
      await expect(save(w, w.studentA, EXPLANATION, 0)).rejects.toMatchObject({
        code: "resourceEvidence.completionBindingUnavailable",
      });
    });

    it("refuses a wrong or missing assessment revision", async () => {
      const id = `asg-rev-${w.ns}`;
      await seedAssignment(w, id, { assessmentRevisionId: "assessment_simulation-eclipse-alignment__r1" });
      await expect(get(w, w.studentA, id)).rejects.toMatchObject({ code: "resourceEvidence.completionBindingUnavailable" });
      await seedAssignment(w, id, { assessmentRevisionId: "assessment_simulation-gravity-wells__r2" });
      // No definition is published for r2, and the store never substitutes r1.
      await expect(get(w, w.studentA, id)).rejects.toMatchObject({ code: "resourceEvidence.completionBindingUnavailable" });
    });

    it("refuses a store that returns a definition for a different binding", async () => {
      const lying: ResourceEvidenceDeps = {
        bindingSource: DEPS.bindingSource,
        definitionStore: { publishedDefinition: () => Promise.resolve(definitionRecord(ALTERED_DEFINITION)) },
      };
      await expect(get(w, w.studentA, w.assignmentId, lying)).rejects.toMatchObject({
        code: "resourceEvidence.completionBindingUnavailable",
        details: { issue: "bindingHashMismatch" },
      });
    });

    it("refuses a rebound definition (different hash) without touching stored evidence", async () => {
      await save(w, w.studentA, EXPLANATION, 0);
      const before = await rawRecord(w);
      stored.set(REVISION_R1, definitionRecord(ALTERED_DEFINITION));
      frozen.set(w.assignmentId, bindingFor(w.assignmentId, w.classId, ALTERED_DEFINITION));
      await expect(save(w, w.studentA, "changed", 1)).rejects.toMatchObject({ code: "resourceEvidence.bindingMismatch" });
      await expect(record(w, w.studentA, EARTH_ORBIT)).rejects.toMatchObject({ code: "resourceEvidence.bindingMismatch" });
      await expect(get(w, w.studentA)).rejects.toMatchObject({ code: "resourceEvidence.bindingMismatch" });
      expect(await rawRecord(w)).toEqual(before);
    });

    it("stamps ownership and binding from server records only", async () => {
      await save(w, w.studentA, EXPLANATION, 0);
      const stored = await rawRecord(w);
      expect(stored).toMatchObject({
        studentId: w.studentA,
        assignmentId: w.assignmentId,
        classId: w.classId,
        teacherId: w.teacher,
        schoolId: w.schoolId,
        districtId: w.districtId,
        resourceId: GRAVITY_WELLS_RESOURCE_ID,
        resourceType: "simulation",
        assessmentRevisionId: REVISION_R1,
        definitionVersion: 1,
        definitionHash: GRAVITY_WELLS_HASH,
        status: "working",
        evidenceEligibleAt: null,
      });
    });
  });

  describe("evidence validation", () => {
    it("records a valid unsuccessful launch as evidence with no credit", async () => {
      const r = await record(w, w.studentA, EARTH_CRASH);
      expect(r).toMatchObject({ disposition: "accepted", outcomes: [], verifiedOutcomeIds: [], runsRevision: 1 });
    });

    it("records a valid successful launch with server-recomputed outcomes", async () => {
      const r = await record(w, w.studentA, SUN_ESCAPE);
      expect(r).toMatchObject({ disposition: "accepted", outcomes: ["sun-escape", "flyby"] });
      expect([...r.verifiedOutcomeIds].sort()).toEqual(["flyby", "sun-escape"]);
    });

    it("refuses forged mission success and leaves accepted evidence intact", async () => {
      await record(w, w.studentA, EARTH_ORBIT);
      const before = await rawRecord(w);
      await expect(
        record(w, w.studentA, { ...EARTH_CRASH, success: true, missions: ["earth-orbit", "sun-escape"] }),
      ).rejects.toMatchObject({ code: "resourceEvidence.invalidEvidence" });
      await expect(
        recordResourceOutcomeRun(
          req(w, w.studentA, {
            assignmentId: w.assignmentId,
            operationId: token("run"),
            flightId: token("flight"),
            parameters: EARTH_CRASH,
            outcomes: ["sun-escape"],
          }),
          DEPS,
        ),
      ).rejects.toMatchObject({ code: "resourceEvidence.invalidRequest" });
      expect(await rawRecord(w)).toEqual(before);
    });

    it.each([
      ["non-finite velocity", { ...EARTH_ORBIT, vx: Number.POSITIVE_INFINITY }],
      ["speed above the page maximum", { ...EARTH_ORBIT, vx: 50 }],
      ["zero observed calls", { ...EARTH_ORBIT, observedInvocations: 0 }],
      ["unknown mass", { ...EARTH_ORBIT, massKey: "pluto" }],
      ["not an object", "orbit"],
    ])("refuses a malformed run (%s) without damaging evidence", async (_label, parameters) => {
      await record(w, w.studentA, EARTH_ORBIT);
      await save(w, w.studentA, EXPLANATION, 0);
      const before = await rawRecord(w);
      await expect(record(w, w.studentA, parameters)).rejects.toMatchObject({
        code: expect.stringMatching(/^resourceEvidence\.(invalidEvidence|invalidRequest)$/) as unknown,
      });
      expect(await rawRecord(w)).toEqual(before);
    });

    it("refuses malformed or excessive working evidence without damaging evidence", async () => {
      await save(w, w.studentA, EXPLANATION, 0);
      const before = await rawRecord(w);
      await expect(save(w, w.studentA, "x".repeat(20_001), 1)).rejects.toMatchObject({
        code: "resourceEvidence.invalidEvidence",
      });
      await expect(
        saveWorkingResourceEvidence(
          req(w, w.studentA, {
            assignmentId: w.assignmentId,
            operationId: token("save"),
            expectedWorkingRevision: 1,
            working: {
              authored: [
                { evidenceId: "orbit-speed-explanation", kind: "text", text: "a" },
                { evidenceId: "orbit-speed-explanation", kind: "text", text: "b" },
              ],
              attestations: [],
            },
          }),
          DEPS,
        ),
      ).rejects.toMatchObject({ code: "resourceEvidence.invalidEvidence" });
      await expect(
        saveWorkingResourceEvidence(
          req(w, w.studentA, {
            assignmentId: w.assignmentId,
            operationId: token("save"),
            expectedWorkingRevision: 1,
            working: { authored: [{ evidenceId: "not-declared", kind: "text", text: "a" }], attestations: [{ attestationId: "x", affirmed: true }] },
          }),
          DEPS,
        ),
      ).rejects.toMatchObject({ code: "resourceEvidence.invalidEvidence" });
      expect(await rawRecord(w)).toEqual(before);
    });

    it("credits the Black Hole flyby exactly at its terminal boundary", async () => {
      const reset = await record(w, w.studentA, { ...LATE_BLACK_HOLE, observedInvocations: 84_427 });
      expect(reset).toMatchObject({ outcomes: ["black-hole-survival"], truncated: false, undetermined: false });
      const seen = await record(w, w.studentA, { ...LATE_BLACK_HOLE, observedInvocations: 84_428 });
      expect(seen).toMatchObject({ outcomes: ["black-hole-survival", "flyby"], truncated: false, undetermined: false });
      const runs = (await rawRecord(w))?.runs as Array<Record<string, unknown>>;
      expect(runs.map((r) => r.cost)).toEqual([84_427, 84_427]);
    });

    it("credits a late flyby beyond the previous 80,000-call cap", async () => {
      const r = await record(w, w.studentA, LATE_BLACK_HOLE);
      expect(r).toMatchObject({ truncated: false, undetermined: false });
      expect(r.outcomes).toContain("flyby");
      const run = ((await rawRecord(w))?.runs as Array<Record<string, string>>)[0];
      expect(run.parametersJson).toBe(run.reportedParametersJson);
    });

    it("keeps verifying later runs after a very long observation", async () => {
      // Uncapped, this orbit would spend RA-2's whole shared budget and
      // leave every later run undetermined.
      const long = await record(w, w.studentA, { ...EARTH_ORBIT, observedInvocations: 4_000_001 });
      expect(long).toMatchObject({ truncated: true, undetermined: true, outcomes: ["earth-orbit"] });
      const later = await record(w, w.studentA, SUN_ESCAPE);
      expect(later.outcomes).toEqual(["sun-escape", "flyby"]);
      const saved = await save(w, w.studentA, EXPLANATION, 0);
      await expect(submit(w, w.studentA, saved.workingRevision, later.runsRevision)).resolves.toMatchObject({ persisted: true });
    });
  });

  describe("idempotency and flight correlation", () => {
    it("acknowledges a duplicate run operation without storing it twice", async () => {
      const first = await record(w, w.studentA, EARTH_ORBIT, "flight-000a", "op-run-0001");
      const again = await record(w, w.studentA, EARTH_ORBIT, "flight-000a", "op-run-0001");
      expect(first.disposition).toBe("accepted");
      expect(again).toMatchObject({ disposition: "replay", runsRevision: 1, outcomes: ["earth-orbit"] });
      expect((await rawRecord(w))?.runs).toHaveLength(1);
    });

    it("refuses an operation id reused with a different payload", async () => {
      await record(w, w.studentA, EARTH_ORBIT, "flight-000a", "op-run-0001");
      await save(w, w.studentA, EXPLANATION, 0, "op-save-0001");
      const before = await rawRecord(w);
      await expect(record(w, w.studentA, JUPITER_ORBIT, "flight-000b", "op-run-0001")).rejects.toMatchObject({
        code: "resourceEvidence.operationConflict",
      });
      await expect(save(w, w.studentA, "something else", 0, "op-save-0001")).rejects.toMatchObject({
        code: "resourceEvidence.operationConflict",
      });
      expect(await rawRecord(w)).toEqual(before);
    });

    it("collapses repeated terminal callbacks for one flight", async () => {
      await record(w, w.studentA, SUN_ESCAPE, "flight-sun1");
      // The page fires its terminal handling again for the same flight.
      const repeat = await record(w, w.studentA, SUN_ESCAPE, "flight-sun1");
      expect(repeat).toMatchObject({ disposition: "duplicate", runsRevision: 1 });
      // A different flight with identical parameters cannot add credit.
      const same = await record(w, w.studentA, SUN_ESCAPE, "flight-sun2");
      expect(same).toMatchObject({ disposition: "duplicate", runsRevision: 1 });
      // The same flight id with different parameters is not a new flight.
      await expect(record(w, w.studentA, EARTH_ORBIT, "flight-sun1")).rejects.toMatchObject({
        code: "resourceEvidence.flightConflict",
      });
      expect((await rawRecord(w))?.runs).toHaveLength(1);
    });

    it("acknowledges a retried save and submit after a lost response", async () => {
      const s1 = await save(w, w.studentA, EXPLANATION, 0, "op-save-0001");
      const s1again = await save(w, w.studentA, EXPLANATION, 0, "op-save-0001");
      expect(s1).toEqual({ workingRevision: 1, persisted: true });
      expect(s1again).toEqual({ workingRevision: 1, persisted: false });
      await record(w, w.studentA, EARTH_ORBIT);
      const runs = await record(w, w.studentA, SUN_ESCAPE);
      const first = await submit(w, w.studentA, 1, runs.runsRevision, "op-submit-001");
      const retry = await submit(w, w.studentA, 1, runs.runsRevision, "op-submit-001");
      expect(first.persisted).toBe(true);
      expect(retry.persisted).toBe(false);
      expect([...retry.verifiedOutcomeIds].sort()).toEqual([...first.verifiedOutcomeIds].sort());
      // The same submit operation id with different revisions is refused.
      await expect(submit(w, w.studentA, 0, runs.runsRevision, "op-submit-001")).rejects.toMatchObject({
        code: "resourceEvidence.operationConflict",
      });
    });
  });

  describe("concurrency", () => {
    it("refuses a stale working revision", async () => {
      await save(w, w.studentA, EXPLANATION, 0);
      await save(w, w.studentA, `${EXPLANATION} More.`, 1);
      await expect(save(w, w.studentA, "from a stale tab", 1)).rejects.toMatchObject({
        code: "resourceEvidence.writeConflict",
        details: { workingRevision: 2 },
      });
      expect(JSON.parse((await rawRecord(w))?.workingJson as string)).toMatchObject({
        authored: [{ text: `${EXPLANATION} More.` }],
      });
    });

    it("lets exactly one of two concurrent saves at one revision win", async () => {
      await save(w, w.studentA, EXPLANATION, 0);
      const results = await Promise.allSettled([
        save(w, w.studentA, "tab one", 1),
        save(w, w.studentA, "tab two", 1),
      ]);
      const ok = results.filter((r) => r.status === "fulfilled");
      const failed = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      expect(ok).toHaveLength(1);
      expect(failed).toHaveLength(1);
      expect(failed[0].reason).toMatchObject({ code: "resourceEvidence.writeConflict" });
      const stored = await rawRecord(w);
      expect(stored?.workingRevision).toBe(2);
      const winner = JSON.parse(stored?.workingJson as string) as { authored: { text: string }[] };
      expect(["tab one", "tab two"]).toContain(winner.authored[0].text);
    });

    it("loses no run when several are recorded concurrently", async () => {
      const launches = [EARTH_ORBIT, EARTH_CRASH, SUN_ESCAPE, JUPITER_ORBIT, launch("blackhole", 4.25, 90)];
      const results = await Promise.all(launches.map((p) => record(w, w.studentA, p)));
      expect(results.every((r) => r.disposition === "accepted")).toBe(true);
      const stored = await rawRecord(w);
      expect(stored?.runs).toHaveLength(5);
      expect(stored?.runsRevision).toBe(5);
    });

    it("keeps save and submit consistent when they race", async () => {
      const { workingRevision, runsRevision } = await eligibleRecord(w);
      const [saved, submitted] = await Promise.allSettled([
        save(w, w.studentA, "edited during submit", workingRevision),
        submit(w, w.studentA, workingRevision, runsRevision),
      ]);
      const stored = await rawRecord(w);
      const snapshot = await readSubmittedSnapshot(resourceEvidenceRecordId(w.assignmentId, w.studentA));
      if (submitted.status === "fulfilled") {
        // Submit won: the snapshot is exactly the pre-race text, and the
        // racing save was refused.
        expect(saved.status).toBe("rejected");
        expect(stored?.status).toBe("submitted");
        expect(JSON.parse(snapshot?.snapshotJson as string).authored[0].text).toBe(EXPLANATION);
      } else {
        // Save won: submission was refused as stale and nothing was frozen.
        expect(saved.status).toBe("fulfilled");
        expect(submitted.reason).toMatchObject({ code: "resourceEvidence.writeConflict" });
        expect(stored?.status).toBe("working");
        expect(snapshot).toBeUndefined();
      }
    });
  });

  describe("submission and immutability", () => {
    it("refuses submission while required work is missing, and freezes nothing", async () => {
      await record(w, w.studentA, EARTH_ORBIT);
      const saved = await save(w, w.studentA, EXPLANATION, 0);
      await expect(submit(w, w.studentA, saved.workingRevision, 1)).rejects.toMatchObject({
        code: "resourceEvidence.requirementsUnmet",
        details: { unmetRequiredStageIds: ["orbit-missions"] },
      });
      // A blank explanation is not present evidence.
      const blank = await save(w, w.studentA, "   ", saved.workingRevision);
      const runs = await record(w, w.studentA, SUN_ESCAPE);
      await expect(submit(w, w.studentA, blank.workingRevision, runs.runsRevision)).rejects.toMatchObject({
        code: "resourceEvidence.requirementsUnmet",
        details: { unmetRequiredStageIds: ["orbit-explanation"] },
      });
      expect((await rawRecord(w))?.status).toBe("working");
      expect(await readSubmittedSnapshot(resourceEvidenceRecordId(w.assignmentId, w.studentA))).toBeUndefined();
    });

    it("refuses submission with nothing stored", async () => {
      await expect(submit(w, w.studentA, 0, 0)).rejects.toMatchObject({ code: "resourceEvidence.notStarted" });
    });

    it("freezes an immutable snapshot and refuses every later mutation", async () => {
      const { workingRevision, runsRevision } = await eligibleRecord(w);
      const result = await submit(w, w.studentA, workingRevision, runsRevision);
      expect([...result.verifiedOutcomeIds].sort()).toEqual(["earth-orbit", "flyby", "sun-escape"]);

      const recordId = resourceEvidenceRecordId(w.assignmentId, w.studentA);
      const snapshot = await readSubmittedSnapshot(recordId);
      const stored = await rawRecord(w);
      expect(stored).toMatchObject({ status: "submitted" });
      expect(stored?.evidenceEligibleAt).toBeInstanceOf(Timestamp);
      expect(snapshot).toMatchObject({
        studentId: w.studentA,
        assignmentId: w.assignmentId,
        resourceId: GRAVITY_WELLS_RESOURCE_ID,
        assessmentRevisionId: REVISION_R1,
        definitionVersion: 1,
        eligible: true,
        workingRevision,
        runsRevision,
      });
      const evidence = JSON.parse(snapshot?.snapshotJson as string);
      expect(evidence.authored[0].text).toBe(EXPLANATION);
      expect(evidence.outcomeRuns).toHaveLength(2);

      await expect(save(w, w.studentA, "rewrite after submit", workingRevision)).rejects.toMatchObject({
        code: "resourceEvidence.alreadySubmitted",
      });
      await expect(record(w, w.studentA, JUPITER_ORBIT)).rejects.toMatchObject({
        code: "resourceEvidence.alreadySubmitted",
      });
      await expect(submit(w, w.studentA, workingRevision, runsRevision)).rejects.toMatchObject({
        code: "resourceEvidence.alreadySubmitted",
      });
      expect(await readSubmittedSnapshot(recordId)).toEqual(snapshot);
      expect(await rawRecord(w)).toEqual(stored);
    });

    it("keeps submitted evidence readable after the window closes, but closes writes", async () => {
      const { workingRevision, runsRevision } = await eligibleRecord(w);
      await db.doc(`assignments/${w.assignmentId}`).update({ windowClosesAt: Timestamp.fromMillis(Date.now() - 1000) });
      await expect(submit(w, w.studentA, workingRevision, runsRevision)).rejects.toMatchObject({
        code: "resourceEvidence.assignmentClosed",
      });
      await expect(get(w, w.studentA)).resolves.toMatchObject({ exists: true, status: "working" });
    });

    it("acknowledges a retried submit after the window closes", async () => {
      const { workingRevision, runsRevision } = await eligibleRecord(w);
      await submit(w, w.studentA, workingRevision, runsRevision, "op-submit-late");
      await db.doc(`assignments/${w.assignmentId}`).update({ windowClosesAt: Timestamp.fromMillis(Date.now() - 1000) });
      await expect(submit(w, w.studentA, workingRevision, runsRevision, "op-submit-late")).resolves.toMatchObject({
        persisted: false,
      });
    });
  });

  describe("assignment occurrences and quiz independence", () => {
    it("does not carry evidence or eligibility into a new assignment occurrence", async () => {
      const { workingRevision, runsRevision } = await eligibleRecord(w);
      await submit(w, w.studentA, workingRevision, runsRevision);

      const second = `asg-second-${w.ns}`;
      await seedAssignment(w, second);
      await expect(get(w, w.studentA, second)).resolves.toEqual({ exists: false, workingRevision: 0, runsRevision: 0 });
      await expect(submit(w, w.studentA, 0, 0, token("submit"), second)).rejects.toMatchObject({
        code: "resourceEvidence.notStarted",
      });
      // The new occurrence becomes Current: the old one stays readable but
      // can gather no new evidence.
      await db.doc(`classes/${w.classId}/assignmentsCurrent/${GRAVITY_WELLS_RESOURCE_ID}`).set({
        classId: w.classId,
        lessonSlug: GRAVITY_WELLS_RESOURCE_ID,
        assignmentId: second,
        teacherId: w.teacher,
        schoolId: w.schoolId,
        setAt: Timestamp.now(),
        setBy: w.teacher,
        source: "publish",
      });
      await expect(get(w, w.studentA)).resolves.toMatchObject({ exists: true, status: "submitted" });
      await expect(save(w, w.studentB, EXPLANATION, 0)).rejects.toMatchObject({ code: "resourceEvidence.assignmentClosed" });
      await expect(record(w, w.studentA, EARTH_ORBIT, token("flight"), token("run"), second)).resolves.toMatchObject({
        disposition: "accepted",
      });
      const fresh = await rawRecord(w, w.studentA, second);
      expect(fresh).toMatchObject({ status: "working", evidenceEligibleAt: null, runsRevision: 1 });
    });

    it("never reads or writes quiz sessions or attempts, so retakes cannot touch evidence", async () => {
      const attemptPath = `attempts/attempt-${w.ns}`;
      const sessionPath = `assessmentSessions/${w.assignmentId}__${w.studentA}__1`;
      await db.doc(attemptPath).set({ studentId: w.studentA, assignmentId: w.assignmentId, score: 3 });
      await db.doc(sessionPath).set({ studentId: w.studentA, assignmentId: w.assignmentId, status: "live" });
      const attemptBefore = (await db.doc(attemptPath).get()).data();
      const sessionBefore = (await db.doc(sessionPath).get()).data();

      const { workingRevision, runsRevision } = await eligibleRecord(w);
      await submit(w, w.studentA, workingRevision, runsRevision);
      expect((await db.doc(attemptPath).get()).data()).toEqual(attemptBefore);
      expect((await db.doc(sessionPath).get()).data()).toEqual(sessionBefore);

      // A quiz retake (a second attempt) leaves the evidence untouched.
      const evidenceBefore = await rawRecord(w);
      const snapshotBefore = await readSubmittedSnapshot(resourceEvidenceRecordId(w.assignmentId, w.studentA));
      await db.doc(`attempts/attempt-retake-${w.ns}`).set({ studentId: w.studentA, assignmentId: w.assignmentId, score: 5 });
      await db.doc(attemptPath).delete();
      expect(await rawRecord(w)).toEqual(evidenceBefore);
      expect(await readSubmittedSnapshot(resourceEvidenceRecordId(w.assignmentId, w.studentA))).toEqual(snapshotBefore);
    });
  });

  describe("shared verification budget", () => {
    it("survives exhaustion by extreme runs: later runs keep their floor, undetermined runs earn nothing late", async () => {
      const L = RUN_VERIFICATION_LIMITS;
      // Three extreme runs take the maximum each; the fourth gets what the
      // pool has left; every later run gets exactly the guaranteed floor.
      const results = [];
      for (const degrees of [70, 71, 72, 73, 74]) results.push(await record(w, w.studentA, endlessOrbit(degrees)));
      expect(results.every((r) => r.truncated && r.undetermined)).toBe(true);
      let runs = (await rawRecord(w))?.runs as Array<{ cost: number }>;
      expect(runs.map((r) => r.cost)).toEqual([L.maxUnitsPerRun, L.maxUnitsPerRun, L.maxUnitsPerRun, 80_000, L.guaranteedUnitsPerRun]);

      // The late flyby now falls outside its 20,000-call window: undetermined,
      // and the flyby is neither credited nor refuted.
      const late = await record(w, w.studentA, LATE_BLACK_HOLE);
      expect(late).toMatchObject({ truncated: true, undetermined: true, outcomes: ["black-hole-survival"] });
      expect(late.verifiedOutcomeIds).not.toContain("flyby");

      // Required missions are still earnable inside the floor.
      await record(w, w.studentA, SUN_ESCAPE);
      const saved = await save(w, w.studentA, EXPLANATION, 0);
      const stored = await rawRecord(w);
      runs = stored?.runs as Array<{ cost: number }>;
      const total = runs.reduce((sum, r) => sum + r.cost, 0);
      expect(total).toBeLessThanOrEqual(L.totalUnits - L.guaranteedUnitsPerRun * (L.runSlots - runs.length));

      // The whole snapshot re-verifies inside the RA-2 budget.
      const result = await submit(w, w.studentA, saved.workingRevision, stored?.runsRevision as number);
      expect([...result.verifiedOutcomeIds].sort()).toEqual(["black-hole-survival", "earth-orbit", "flyby", "sun-escape"]);
      const snapshot = await readSubmittedSnapshot(resourceEvidenceRecordId(w.assignmentId, w.studentA));
      expect(snapshot?.undeterminedRunIndexes).toEqual([0, 1, 2, 3, 4, 5]);
      await expect(get(w, w.studentA)).resolves.toMatchObject({
        runs: expect.arrayContaining([expect.objectContaining({ undetermined: true, truncated: true })]) as unknown,
      });
    }, 120_000);

    it("keeps the budget invariant when extreme runs race for the pool", async () => {
      const L = RUN_VERIFICATION_LIMITS;
      const launches = [70, 71, 72, 73, 74].map(endlessOrbit);
      const settled = await Promise.allSettled(launches.map((p, i) => record(w, w.studentA, p, `flight-race-${i}`, `op-race-000${i}`)));
      // A run that lost the pool too often is refused as a conflict and
      // can be retried with the same ids.
      for (const [i, r] of settled.entries()) {
        if (r.status === "rejected") {
          expect(r.reason).toMatchObject({ code: "resourceEvidence.writeConflict" });
          await record(w, w.studentA, launches[i], `flight-race-${i}`, `op-race-000${i}`);
        }
      }
      const runs = (await rawRecord(w))?.runs as Array<{ cost: number; flightId: string }>;
      expect(new Set(runs.map((r) => r.flightId)).size).toBe(5);
      for (const r of runs) {
        expect(r.cost).toBeGreaterThanOrEqual(L.guaranteedUnitsPerRun);
        expect(r.cost).toBeLessThanOrEqual(L.maxUnitsPerRun);
      }
      const total = runs.reduce((sum, r) => sum + r.cost, 0);
      expect(total).toBeLessThanOrEqual(L.totalUnits - L.guaranteedUnitsPerRun * (L.runSlots - runs.length));
    }, 120_000);

    it("acknowledges duplicate terminal callbacks without spending budget", async () => {
      await record(w, w.studentA, endlessOrbit(70), "flight-long1");
      const before = await rawRecord(w);
      const repeat = await record(w, w.studentA, endlessOrbit(70), "flight-long1");
      expect(repeat).toMatchObject({ disposition: "duplicate", undetermined: true });
      expect(await rawRecord(w)).toEqual(before);
    });
  });

  describe("post-close retries", () => {
    it("acknowledges retries of a run and a save that landed, and refuses anything new", async () => {
      await record(w, w.studentA, EARTH_ORBIT, "flight-close1", "op-run-close1");
      await save(w, w.studentA, EXPLANATION, 0, "op-save-close1");
      await db.doc(`assignments/${w.assignmentId}`).update({ windowClosesAt: Timestamp.fromMillis(Date.now() - 1000) });
      const before = await rawRecord(w);
      await expect(record(w, w.studentA, EARTH_ORBIT, "flight-close1", "op-run-close1")).resolves.toMatchObject({
        disposition: "replay",
      });
      await expect(save(w, w.studentA, EXPLANATION, 0, "op-save-close1")).resolves.toEqual({
        workingRevision: 1,
        persisted: false,
      });
      // A changed payload under a used id is still a conflict.
      await expect(record(w, w.studentA, SUN_ESCAPE, "flight-close1", "op-run-close1")).rejects.toMatchObject({
        code: "resourceEvidence.operationConflict",
      });
      // New work is refused: a new run, a repeated flight under a new id,
      // and a new save.
      await expect(record(w, w.studentA, SUN_ESCAPE)).rejects.toMatchObject({ code: "resourceEvidence.assignmentClosed" });
      await expect(record(w, w.studentA, EARTH_ORBIT, "flight-close1")).rejects.toMatchObject({
        code: "resourceEvidence.assignmentClosed",
      });
      await expect(save(w, w.studentA, "new text", 1)).rejects.toMatchObject({ code: "resourceEvidence.assignmentClosed" });
      expect(await rawRecord(w)).toEqual(before);
    });

    it("acknowledges a retried run on a superseded occurrence and refuses new runs there", async () => {
      await record(w, w.studentA, EARTH_ORBIT, "flight-sup1", "op-run-sup01");
      const second = `asg-current-${w.ns}`;
      await seedAssignment(w, second);
      await db.doc(`classes/${w.classId}/assignmentsCurrent/${GRAVITY_WELLS_RESOURCE_ID}`).set({
        classId: w.classId,
        lessonSlug: GRAVITY_WELLS_RESOURCE_ID,
        assignmentId: second,
        teacherId: w.teacher,
        schoolId: w.schoolId,
        setAt: Timestamp.now(),
        setBy: w.teacher,
        source: "publish",
      });
      await expect(record(w, w.studentA, EARTH_ORBIT, "flight-sup1", "op-run-sup01")).resolves.toMatchObject({
        disposition: "replay",
      });
      await expect(record(w, w.studentA, SUN_ESCAPE)).rejects.toMatchObject({ code: "resourceEvidence.assignmentClosed" });
    });
  });

  describe("evidence capacity", () => {
    it("reserves capacity so failed launches cannot block a remaining mission", async () => {
      // 45 distinct crashes fill every slot not reserved for the five
      // still-unverified missions.
      for (let i = 0; i < 45; i++) {
        const r = await record(w, w.studentA, launch("earth", 0.3 + i * 0.001, i));
        expect(r.outcomes).toEqual([]);
      }
      await expect(record(w, w.studentA, launch("earth", 0.25, 50))).rejects.toMatchObject({
        code: "resourceEvidence.runCapacityReached",
      });
      // A launch that earns a new mission still fits.
      await expect(record(w, w.studentA, EARTH_ORBIT)).resolves.toMatchObject({ outcomes: ["earth-orbit"] });
      await expect(record(w, w.studentA, SUN_ESCAPE)).resolves.toMatchObject({ outcomes: ["sun-escape", "flyby"] });
      expect((await rawRecord(w))?.runs).toHaveLength(47);
    }, 60_000);

    it("stays bounded once full, keeps every accepted run, and still allows submission", async () => {
      for (let i = 0; i < 45; i++) await record(w, w.studentA, launch("earth", 0.3 + i * 0.001, i));
      await record(w, w.studentA, EARTH_ORBIT);
      await record(w, w.studentA, SUN_ESCAPE);
      await record(w, w.studentA, JUPITER_ORBIT);
      await record(w, w.studentA, launch("blackhole", 4.25, 90));
      // Every declared outcome is verified, so the last slot is free for
      // any run; after that the record is full.
      await record(w, w.studentA, launch("earth", 0.25, 50));
      const full = await rawRecord(w);
      expect(full?.runs).toHaveLength(RUN_VERIFICATION_LIMITS.runSlots);
      await expect(record(w, w.studentA, launch("earth", 0.26, 51))).rejects.toMatchObject({
        code: "resourceEvidence.runCapacityReached",
      });
      await expect(record(w, w.studentA, launch("jupiter", 2.5, 80))).rejects.toMatchObject({
        code: "resourceEvidence.runCapacityReached",
      });
      // Refusals discard nothing already accepted.
      expect(await rawRecord(w)).toEqual(full);
      const saved = await save(w, w.studentA, EXPLANATION, 0);
      await expect(submit(w, w.studentA, saved.workingRevision, full?.runsRevision as number)).resolves.toMatchObject({
        persisted: true,
      });
      const snapshot = await readSubmittedSnapshot(resourceEvidenceRecordId(w.assignmentId, w.studentA));
      expect(JSON.parse(snapshot?.snapshotJson as string).outcomeRuns).toHaveLength(RUN_VERIFICATION_LIMITS.runSlots);
    }, 120_000);
  });
});
