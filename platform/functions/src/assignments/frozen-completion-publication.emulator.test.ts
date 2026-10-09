// RA-3B emulator-backed proofs: frozen completion-definition deployment,
// assignment publication binding and concurrency, and the RA-3A adapters.
//
// Runs against the REAL Firestore emulator (`npm run test:emulator`, which
// wraps jest in `firebase emulators:exec` with the offline `demo-bootstrap`
// project). Deployment, publication, draft update, and evidence resolution
// run through their real implementations, real transactions, and real
// `create` preconditions.
//
// Non-lesson publication is still refused by the production gate. Those
// cases use the explicit publication test seam (`__publishAssignmentWithPolicy`)
// with a policy that keeps the identifier/type check and allows the
// simulation type; the production policy is asserted unchanged.
//
// Every record is synthetic emulator data. Nothing contacts a live project.
// Skips when the emulator host is absent.

import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, Timestamp, getFirestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";

import { deployAssessmentRevision } from "../assessments/assessment-deployment";
import {
  GRAVITY_WELLS_COMPLETION_DEFINITION,
  type CompletionDefinition,
} from "../resourceCompletion";
import {
  FROZEN_PUBLICATION_RESOURCE_EVIDENCE_DEPS,
  PRODUCTION_RESOURCE_EVIDENCE_DEPS,
  getOwnResourceEvidence,
  resourceEvidenceRecordId,
  saveWorkingResourceEvidence,
} from "../resourceEvidence";
import { assertActivityIdMatchesResourceType } from "../shared/activity-identifiers";
import { log } from "../shared/logging/logger";
import {
  PRODUCTION_ASSIGNMENT_PUBLICATION_POLICY,
  __assignmentsPublishHandler,
  __publishAssignmentWithPolicy,
  type AssignmentPublicationPolicy,
} from "./assignments-publish";
import { __assignmentsUpdateDraftHandler } from "./assignments-update-draft";
import { __archiveAssignmentWithHooks, __assignmentsArchiveHandler } from "./assignments-archive";
import { __assignmentsReopenHandler, __reopenAssignmentWithHooks } from "./assignments-reopen";

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

const TEST_POLICY: AssignmentPublicationPolicy = {
  assertAssignable: (activityId, resourceType) => assertActivityIdMatchesResourceType(activityId, resourceType),
};

type World = {
  readonly ns: string;
  readonly schoolId: string;
  readonly districtId: string;
  readonly classId: string;
  readonly teacher: string;
  readonly students: readonly string[];
  readonly resourceId: string;
};

async function seedWorld(studentCount = 2): Promise<World> {
  const ns = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const w: World = {
    ns,
    schoolId: `school-${ns}`,
    districtId: `district-${ns}`,
    classId: `class-${ns}`,
    teacher: `teacher-${ns}`,
    students: Array.from({ length: studentCount }, (_, i) => `student-${String(i)}-${ns}`),
    // A per-test resource so assessment ordinals never collide across tests.
    resourceId: `simulation-gw${ns}`,
  };
  const batch = db.batch();
  batch.set(db.doc(`schools/${w.schoolId}`), { districtId: w.districtId, name: "Emulator School" });
  batch.set(db.doc(`users/${w.teacher}`), { status: "active", role: "teacher", schoolId: w.schoolId });
  for (const s of w.students) {
    batch.set(db.doc(`users/${s}`), { status: "active", role: "student", schoolId: w.schoolId });
    batch.set(db.doc(`enrollments/${w.classId}__${s}`), {
      classId: w.classId,
      studentId: s,
      schoolId: w.schoolId,
      status: "active",
    });
  }
  await batch.commit();
  return w;
}

function definitionFor(resourceId: string, ordinal: number, prompt?: string): CompletionDefinition {
  const base = GRAVITY_WELLS_COMPLETION_DEFINITION;
  return {
    ...base,
    resourceId,
    assessmentRevisionId: `assessment_${resourceId}__r${String(ordinal)}`,
    definitionVersion: ordinal,
    evidence: prompt === undefined ? base.evidence : [{ ...base.evidence[0], prompt }],
  };
}

function items(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    itemId: `q${String(i + 1)}`,
    itemType: "singleChoice" as const,
    stem: `Question ${String(i + 1)}?`,
    options: [
      { optionId: "A", text: "One" },
      { optionId: "B", text: "Two" },
    ],
    points: 1 as const,
    correctOptionId: "A",
    explanation: "Because.",
  }));
}

function deployResource(resourceId: string, ordinal: number, definition: unknown = definitionFor(resourceId, ordinal)) {
  return deployAssessmentRevision({
    activityId: resourceId,
    revisionOrdinal: ordinal,
    itemOrderingRule: "authoredOrder",
    schemaVersion: 1,
    publishedBy: "emulator",
    items: items(5),
    completionDefinition: definition,
  });
}

function deployLesson(lessonSlug: string, ordinal = 1) {
  return deployAssessmentRevision({
    activityId: lessonSlug,
    revisionOrdinal: ordinal,
    itemOrderingRule: "authoredOrder",
    schemaVersion: 1,
    publishedBy: "emulator",
    items: items(10),
  });
}

// An override of `undefined` omits the field (a lesson draft carries no
// `resourceType`, exactly as `assignmentsCreateDraft` writes it).
async function seedDraft(w: World, assignmentId: string, overrides: Record<string, unknown> = {}) {
  const record: Record<string, unknown> = {
    classId: w.classId,
    teacherId: w.teacher,
    schoolId: w.schoolId,
    lessonSlug: w.resourceId,
    resourceType: "simulation",
    mode: "classroom",
    status: "draft",
    createdAt: Timestamp.now(),
    ...overrides,
  };
  for (const key of Object.keys(record)) if (record[key] === undefined) delete record[key];
  await db.doc(`assignments/${assignmentId}`).set(record);
}

function req(w: World, uid: string, data: unknown, role = "teacher"): CallableRequest<unknown> {
  return {
    data,
    auth: { uid, token: { role, schoolId: w.schoolId, districtId: w.districtId } },
  } as unknown as CallableRequest<unknown>;
}

const publish = (w: World, assignmentId: string) =>
  __publishAssignmentWithPolicy(req(w, w.teacher, { assignmentId }), TEST_POLICY);

async function data(path: string): Promise<Record<string, unknown> | undefined> {
  const snap = await db.doc(path).get();
  return snap.exists ? (snap.data()) : undefined;
}

async function publishedAudits(assignmentId: string) {
  const snap = await db
    .collection("auditEvents")
    .where("targetId", "==", assignmentId)
    .where("action", "==", "assignments.published")
    .get();
  return snap.docs.map((doc) => doc.data());
}

async function archivedAudits(assignmentId: string) {
  const snap = await db
    .collection("auditEvents")
    .where("targetId", "==", assignmentId)
    .where("action", "==", "assignments.archived")
    .get();
  return snap.docs.map((doc) => doc.data());
}

async function recipients(assignmentId: string) {
  const snap = await db.collection(`assignments/${assignmentId}/recipients`).get();
  return snap.docs.map((doc) => doc.id).sort();
}

async function reopenedAudits(assignmentId: string) {
  const snap = await db
    .collection("auditEvents")
    .where("targetId", "==", assignmentId)
    .where("action", "==", "assignments.reopened")
    .get();
  return snap.docs.map((doc) => doc.data());
}

const settle = <T>(ps: Array<Promise<T>>) => Promise.allSettled(ps);

d("RA-3B frozen completion-definition publication (Firestore emulator)", () => {
  beforeAll(() => {
    for (const method of ["info", "warn", "error"] as const) {
      jest.spyOn(log, method).mockImplementation(() => undefined);
    }
  });
  afterAll(() => jest.restoreAllMocks());

  describe("atomic assessment deployment", () => {
    it("creates the revision, answer key, completion definition, and pointer together", async () => {
      const w = await seedWorld(0);
      const r1 = `assessment_${w.resourceId}__r1`;
      const result = await deployResource(w.resourceId, 1);

      const def = await data(`completionDefinitions/${r1}`);
      expect(await data(`assessmentRevisions/${r1}`)).toBeDefined();
      expect(await data(`assessmentAnswerKeys/${r1}`)).toBeDefined();
      expect(await data(`assessments/assessment_${w.resourceId}`)).toMatchObject({ currentRevisionId: r1 });
      expect(def).toMatchObject({
        assessmentRevisionId: r1,
        resourceId: w.resourceId,
        resourceType: "simulation",
        definitionVersion: 1,
        definitionHash: result.completionDefinitionHash,
      });
      expect(def?.publishedAt).toBeInstanceOf(Timestamp);
    });

    it("refuses a duplicate deployment and leaves the original definition untouched", async () => {
      const w = await seedWorld(0);
      const r1 = `assessment_${w.resourceId}__r1`;
      await deployResource(w.resourceId, 1);
      const before = await data(`completionDefinitions/${r1}`);

      await expect(deployResource(w.resourceId, 1, definitionFor(w.resourceId, 1, "Explain orbits."))).rejects.toMatchObject({
        code: "assessmentDeployment.duplicateRevision",
      });
      expect(await data(`completionDefinitions/${r1}`)).toEqual(before);
    });

    it("a failed deployment leaves no partial revision or definition", async () => {
      const w = await seedWorld(0);
      const r1 = `assessment_${w.resourceId}__r1`;
      // An orphan definition already occupies the slot: the transaction must
      // refuse before writing the revision or answer key.
      await db.doc(`completionDefinitions/${r1}`).set({ orphan: true });

      await expect(deployResource(w.resourceId, 1)).rejects.toMatchObject({
        code: "assessmentDeployment.duplicateCompletionDefinition",
      });
      expect(await data(`assessmentRevisions/${r1}`)).toBeUndefined();
      expect(await data(`assessmentAnswerKeys/${r1}`)).toBeUndefined();
      expect(await data(`assessments/assessment_${w.resourceId}`)).toBeUndefined();
      expect(await data(`completionDefinitions/${r1}`)).toEqual({ orphan: true });
    });

    it("lets exactly one of two concurrent deployments of the same revision win", async () => {
      const w = await seedWorld(0);
      const r1 = `assessment_${w.resourceId}__r1`;
      const results = await settle([
        deployResource(w.resourceId, 1),
        deployResource(w.resourceId, 1, definitionFor(w.resourceId, 1, "Explain orbits.")),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const winner = results.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ completionDefinitionHash?: string }>;
      expect((await data(`completionDefinitions/${r1}`))?.definitionHash).toBe(winner.value.completionDefinitionHash);
    });

    it("keeps lesson deployment unchanged: no completion definition is written", async () => {
      const w = await seedWorld(0);
      const lesson = `emu-lesson-${w.ns}`;
      await deployLesson(lesson);
      expect(await data(`completionDefinitions/assessment_${lesson}__r1`)).toBeUndefined();
    });
  });

  describe("publication binding", () => {
    it("the production policy still refuses non-lesson publication", async () => {
      const w = await seedWorld();
      await deployResource(w.resourceId, 1);
      await seedDraft(w, `asg-prod-${w.ns}`);
      expect(PRODUCTION_ASSIGNMENT_PUBLICATION_POLICY.assertAssignable).toBeDefined();
      await expect(__assignmentsPublishHandler(req(w, w.teacher, { assignmentId: `asg-prod-${w.ns}` }))).rejects.toMatchObject({
        code: "assignments.resourceTypeNotAssignable",
      });
      expect(await data(`assignments/asg-prod-${w.ns}`)).toMatchObject({ status: "draft" });
      expect(await recipients(`asg-prod-${w.ns}`)).toEqual([]);
    });

    it("freezes the verified binding with status, revision, recipients, pointer, and audit", async () => {
      const w = await seedWorld();
      const r1 = `assessment_${w.resourceId}__r1`;
      const { completionDefinitionHash } = await deployResource(w.resourceId, 1);
      const id = `asg-bind-${w.ns}`;
      await seedDraft(w, id);

      await expect(publish(w, id)).resolves.toEqual({ assignmentId: id, status: "published", alreadyPublished: false });

      const a = await data(`assignments/${id}`);
      expect(a).toMatchObject({
        status: "published",
        assessmentRevisionId: r1,
        completionBinding: {
          bindingSchemaVersion: 1,
          assignmentId: id,
          classId: w.classId,
          resourceId: w.resourceId,
          resourceType: "simulation",
          assessmentRevisionId: r1,
          definitionSchemaVersion: 1,
          definitionVersion: 1,
          definitionHash: completionDefinitionHash,
          validators: [{ validatorId: "gravity-wells.orbit", validatorVersion: 1 }],
        },
      });
      expect(await recipients(id)).toEqual([...w.students].sort());
      expect(await data(`classes/${w.classId}/assignmentsCurrent/${w.resourceId}`)).toMatchObject({ assignmentId: id, source: "publish" });
      const audits = await publishedAudits(id);
      expect(audits).toHaveLength(1);
      expect(audits[0].payload).toMatchObject({ assessmentRevisionId: r1, completionDefinitionHash, recipientCount: w.students.length });
    });

    it.each([
      ["a missing definition", async (r1: string) => db.doc(`completionDefinitions/${r1}`).delete(), "missing"],
      ["a corrupted definition", async (r1: string) => db.doc(`completionDefinitions/${r1}`).update({ definitionHash: "0".repeat(64) }), "hashMismatch"],
      ["an edited definition", async (r1: string) => db.doc(`completionDefinitions/${r1}`).update({ definitionVersion: 2 }), "identityMismatch"],
    ])("refuses publication over %s and writes nothing", async (_label, damage, issue) => {
      const w = await seedWorld();
      const r1 = `assessment_${w.resourceId}__r1`;
      await deployResource(w.resourceId, 1);
      await damage(r1);
      const id = `asg-bad-${w.ns}`;
      await seedDraft(w, id);

      await expect(publish(w, id)).rejects.toMatchObject({
        code: "assignments.completionDefinitionUnavailable",
        details: { issue },
      });
      const a = await data(`assignments/${id}`);
      expect(a?.status).toBe("draft");
      expect(a?.completionBinding).toBeUndefined();
      expect(a?.assessmentRevisionId).toBeUndefined();
      expect(await recipients(id)).toEqual([]);
      expect(await publishedAudits(id)).toHaveLength(0);
      expect(await data(`classes/${w.classId}/assignmentsCurrent/${w.resourceId}`)).toBeUndefined();
    });

    it("publishes a lesson through the production handler with no completion binding", async () => {
      const w = await seedWorld();
      const lesson = `emu-lesson-${w.ns}`;
      await deployLesson(lesson);
      const id = `asg-lesson-${w.ns}`;
      await seedDraft(w, id, { lessonSlug: lesson, resourceType: undefined });

      await expect(__assignmentsPublishHandler(req(w, w.teacher, { assignmentId: id }))).resolves.toMatchObject({ alreadyPublished: false });
      const a = await data(`assignments/${id}`);
      expect(a).toMatchObject({ status: "published", assessmentRevisionId: `assessment_${lesson}__r1` });
      expect(a && "completionBinding" in a).toBe(false);
    });
  });

  describe("publication concurrency", () => {
    it("lets exactly one of many concurrent publications win; the rest are idempotent", async () => {
      const w = await seedWorld(3);
      const r1 = `assessment_${w.resourceId}__r1`;
      await deployResource(w.resourceId, 1);
      const id = `asg-race-${w.ns}`;
      await seedDraft(w, id);

      const results = await settle(Array.from({ length: 6 }, () => publish(w, id)));
      const fulfilled = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<{ alreadyPublished: boolean }>).value);
      const rejected = results.filter((r) => r.status === "rejected").map((r) => (r).reason as { code?: string });
      expect(fulfilled.filter((v) => !v.alreadyPublished)).toHaveLength(1);
      // A loser either observed the winner or exhausted contention retries
      // with the stable conflict code; nothing else is acceptable.
      for (const reason of rejected) expect(reason.code).toBe("assignments.publishConflict");

      expect(await publishedAudits(id)).toHaveLength(1);
      expect(await recipients(id)).toEqual([...w.students].sort());
      const a = await data(`assignments/${id}`);
      expect(a?.assessmentRevisionId).toBe(r1);
      expect((a?.completionBinding as { assessmentRevisionId: string }).assessmentRevisionId).toBe(r1);
      expect(await data(`classes/${w.classId}/assignmentsCurrent/${w.resourceId}`)).toMatchObject({ assignmentId: id });
    });

    it("repeated publication after a new revision never replaces the frozen revision, binding, or recipients", async () => {
      const w = await seedWorld(2);
      await deployResource(w.resourceId, 1);
      const id = `asg-repeat-${w.ns}`;
      await seedDraft(w, id);
      await publish(w, id);
      const before = await data(`assignments/${id}`);
      const pointerBefore = await data(`classes/${w.classId}/assignmentsCurrent/${w.resourceId}`);

      // A newer revision is deployed and the class gains a student.
      await deployResource(w.resourceId, 2, definitionFor(w.resourceId, 2, "Explain orbits with evidence."));
      await db.doc(`enrollments/${w.classId}__late-${w.ns}`).set({ classId: w.classId, studentId: `late-${w.ns}`, schoolId: w.schoolId, status: "active" });

      await expect(publish(w, id)).resolves.toMatchObject({ alreadyPublished: true });
      expect(await data(`assignments/${id}`)).toEqual(before);
      expect(await recipients(id)).toEqual([...w.students].sort());
      expect(await publishedAudits(id)).toHaveLength(1);
      expect(await data(`classes/${w.classId}/assignmentsCurrent/${w.resourceId}`)).toEqual(pointerBefore);
    });

    it("a draft update racing publication never lands on the published record", async () => {
      for (let trial = 0; trial < 4; trial++) {
        const w = await seedWorld(1);
        const lessonA = `emu-a-${w.ns}`;
        const lessonB = `emu-b-${w.ns}`;
        await Promise.all([deployLesson(lessonA), deployLesson(lessonB)]);
        const id = `asg-upd-${w.ns}`;
        await seedDraft(w, id, { lessonSlug: lessonA, resourceType: undefined });
  
        const [pub, upd] = await Promise.allSettled([
          __assignmentsPublishHandler(req(w, w.teacher, { assignmentId: id })),
          __assignmentsUpdateDraftHandler(req(w, w.teacher, { assignmentId: id, lessonSlug: lessonB })),
        ] as const);
        expect(pub.status).toBe("fulfilled");
        if (upd.status === "rejected") {
          expect(["assignments.invalidStatus", "assignments.updateConflict"]).toContain((upd.reason as { code?: string }).code);
        }

        // Whatever order won, the frozen revision, the Current pointer, and
        // the audit event all describe the lesson the record now names.
        const a = await data(`assignments/${id}`);
        const slug = a?.lessonSlug as string;
        expect(a?.status).toBe("published");
        expect(a?.assessmentRevisionId).toBe(`assessment_${slug}__r1`);
        expect(slug).toBe(upd.status === "fulfilled" ? lessonB : lessonA);
        expect(await data(`classes/${w.classId}/assignmentsCurrent/${slug}`)).toMatchObject({ assignmentId: id });
        const audits = await publishedAudits(id);
        expect(audits).toHaveLength(1);
        expect(audits[0].payload).toMatchObject({ lessonSlug: slug, assessmentRevisionId: `assessment_${slug}__r1` });
      }
    });

    it("refuses a draft update after publication", async () => {
      const w = await seedWorld(1);
      await deployResource(w.resourceId, 1);
      const id = `asg-late-upd-${w.ns}`;
      await seedDraft(w, id);
      await publish(w, id);
      await expect(
        __assignmentsUpdateDraftHandler(req(w, w.teacher, { assignmentId: id, title: "Late" })),
      ).rejects.toMatchObject({ code: "assignments.invalidStatus" });
      expect((await data(`assignments/${id}`))?.title).toBeUndefined();
    });
  });

  describe("RA-3A adapters and historical reproducibility", () => {
    const EXPLANATION = "The probe needs enough sideways speed to keep missing the planet as it falls.";
    const saveWith = (w: World, assignmentId: string, deps = FROZEN_PUBLICATION_RESOURCE_EVIDENCE_DEPS, text = EXPLANATION, expected = 0) =>
      saveWorkingResourceEvidence(
        req(w, w.students[0], {
          assignmentId,
          operationId: `op-${Math.random().toString(36).slice(2, 12)}`,
          expectedWorkingRevision: expected,
          working: { authored: [{ evidenceId: "orbit-speed-explanation", kind: "text", text }], attestations: [] },
        }, "student"),
        deps,
      );
    const getWith = (w: World, assignmentId: string, deps = FROZEN_PUBLICATION_RESOURCE_EVIDENCE_DEPS) =>
      getOwnResourceEvidence(req(w, w.students[0], { assignmentId }, "student"), deps);

    async function published(w: World, id: string) {
      await seedDraft(w, id);
      await publish(w, id);
      return data(`assignments/${id}`);
    }

    it("resolves the exact frozen definition and stamps its hash on evidence", async () => {
      const w = await seedWorld(1);
      const { completionDefinitionHash } = await deployResource(w.resourceId, 1);
      const id = `asg-ev-${w.ns}`;
      await published(w, id);

      await expect(saveWith(w, id)).resolves.toMatchObject({ workingRevision: 1 });
      expect(await data(`resourceEvidence/${resourceEvidenceRecordId(id, w.students[0])}`)).toMatchObject({
        resourceId: w.resourceId,
        assessmentRevisionId: `assessment_${w.resourceId}__r1`,
        definitionVersion: 1,
        definitionHash: completionDefinitionHash,
      });
      // Production deps stay fail-closed for the same entitled student.
      await expect(getWith(w, id, PRODUCTION_RESOURCE_EVIDENCE_DEPS)).rejects.toMatchObject({
        code: "resourceEvidence.completionBindingUnavailable",
      });
    });

    it("keeps a historical occurrence on its own revision after a newer one is published", async () => {
      const w = await seedWorld(1);
      const r1 = await deployResource(w.resourceId, 1);
      const older = `asg-old-${w.ns}`;
      await published(w, older);
      await saveWith(w, older);

      const r2 = await deployResource(w.resourceId, 2, definitionFor(w.resourceId, 2, "Explain orbits with evidence."));
      const newer = `asg-new-${w.ns}`;
      await published(w, newer);

      const oldA = await data(`assignments/${older}`);
      const newA = await data(`assignments/${newer}`);
      expect((oldA?.completionBinding as { definitionHash: string }).definitionHash).toBe(r1.completionDefinitionHash);
      expect((newA?.completionBinding as { definitionHash: string }).definitionHash).toBe(r2.completionDefinitionHash);
      // The older occurrence still resolves (reads stay available after
      // supersession) against r1, never the newer r2.
      await expect(getWith(w, older)).resolves.toMatchObject({ exists: true });
      expect(await data(`resourceEvidence/${resourceEvidenceRecordId(older, w.students[0])}`)).toMatchObject({
        assessmentRevisionId: `assessment_${w.resourceId}__r1`,
        definitionHash: r1.completionDefinitionHash,
      });
      await expect(saveWith(w, newer)).resolves.toMatchObject({ workingRevision: 1 });
      expect(await data(`resourceEvidence/${resourceEvidenceRecordId(newer, w.students[0])}`)).toMatchObject({
        assessmentRevisionId: `assessment_${w.resourceId}__r2`,
        definitionHash: r2.completionDefinitionHash,
      });
    });

    it.each([
      ["a deleted definition", async (_w: World, _id: string, r1: string) => db.doc(`completionDefinitions/${r1}`).delete(), "missing"],
      ["a corrupted definition", async (_w: World, _id: string, r1: string) => db.doc(`completionDefinitions/${r1}`).update({ definitionHash: "1".repeat(64) }), "hashMismatch"],
      ["a missing published binding", async (_w: World, id: string) => db.doc(`assignments/${id}`).update({ completionBinding: FieldValue.delete() }), "bindingMissing"],
      ["a substituted binding hash", async (_w: World, id: string) => db.doc(`assignments/${id}`).update({ "completionBinding.definitionHash": "2".repeat(64) }), "bindingHashMismatch"],
      ["a binding for another revision", async (w: World, id: string) => db.doc(`assignments/${id}`).update({ "completionBinding.assessmentRevisionId": `assessment_${w.resourceId}__r2` }), "bindingRevisionMismatch"],
    ])("refuses evidence over %s", async (_label, damage, issue) => {
      const w = await seedWorld(1);
      await deployResource(w.resourceId, 1);
      const id = `asg-dmg-${w.ns}`;
      await published(w, id);
      await damage(w, id, `assessment_${w.resourceId}__r1`);
      await expect(saveWith(w, id)).rejects.toMatchObject({
        code: "resourceEvidence.completionBindingUnavailable",
        details: { issue },
      });
      expect(await data(`resourceEvidence/${resourceEvidenceRecordId(id, w.students[0])}`)).toBeUndefined();
    });

    it("refuses a binding copied from another assignment occurrence", async () => {
      const w = await seedWorld(1);
      await deployResource(w.resourceId, 1);
      const a = `asg-src-${w.ns}`;
      const b = `asg-dst-${w.ns}`;
      const source = await published(w, a);
      await published(w, b);
      await db.doc(`assignments/${b}`).update({ completionBinding: source?.completionBinding });
      await expect(saveWith(w, b)).rejects.toMatchObject({
        code: "resourceEvidence.completionBindingUnavailable",
        details: { issue: "bindingAssignmentMismatch" },
      });
    });

    it("refuses evidence recorded under a different definition revision", async () => {
      const w = await seedWorld(1);
      await deployResource(w.resourceId, 1);
      const id = `asg-rebind-${w.ns}`;
      await published(w, id);
      await saveWith(w, id);
      // An unauthorized in-place rebind to a newer revision's definition is
      // detected against the evidence already stamped with r1's hash.
      const r2 = await deployResource(w.resourceId, 2, definitionFor(w.resourceId, 2, "Explain orbits with evidence."));
      const binding = (await data(`assignments/${id}`))?.completionBinding as Record<string, unknown>;
      await db.doc(`assignments/${id}`).update({
        assessmentRevisionId: `assessment_${w.resourceId}__r2`,
        completionBinding: {
          ...binding,
          assessmentRevisionId: `assessment_${w.resourceId}__r2`,
          definitionVersion: 2,
          definitionHash: r2.completionDefinitionHash,
        },
      });
      await expect(getWith(w, id)).rejects.toMatchObject({ code: "resourceEvidence.bindingMismatch" });
    });
  });

  // RA-3B certification correction: archive reads, validates, transitions,
  // and audits in one transaction. Interleavings are forced with the
  // archive test hooks (awaited inside the transaction), not with sleeps.
  describe("archive lifecycle concurrency", () => {
    const archive = (w: World, id: string) => __assignmentsArchiveHandler(req(w, w.teacher, { assignmentId: id }));

    async function lessonDraft(w: World, id: string) {
      const lesson = `emu-arch-${w.ns}`;
      await deployLesson(lesson);
      await seedDraft(w, id, { lessonSlug: lesson, resourceType: undefined });
      return lesson;
    }

    it("A: a publication started after archive read the draft cannot commit before the archive", async () => {
      const w = await seedWorld(1);
      const id = `asg-arch-a-${w.ns}`;
      await lessonDraft(w, id);
      let publication: Promise<unknown> | undefined;
      const seen: string[] = [];

      const result = await __archiveAssignmentWithHooks(req(w, w.teacher, { assignmentId: id }), {
        afterRead: async (attempt) => {
          seen.push(`read#${String(attempt)}:${String((await data(`assignments/${id}`))?.status)}`);
          // Barrier: launch the competing publication while this transaction
          // holds its read of the draft. Not awaited here.
          if (attempt === 1) publication = __assignmentsPublishHandler(req(w, w.teacher, { assignmentId: id }));
        },
      });
      expect(result).toEqual({ assignmentId: id, status: "archived", alreadyArchived: false });
      // The publication observes the archived record and is refused.
      await expect(publication).rejects.toMatchObject({ code: "assignments.invalidTransition" });

      const a = await data(`assignments/${id}`);
      expect(a?.status).toBe("archived");
      expect(a?.assessmentRevisionId).toBeUndefined();
      expect(a?.publishedAt).toBeUndefined();
      expect(await publishedAudits(id)).toHaveLength(0);
      expect(await recipients(id)).toEqual([]);
      const audits = await archivedAudits(id);
      expect(audits).toHaveLength(1);
      // The audit names the state the archive actually transitioned from.
      expect(audits[0].payload).toEqual({ classId: w.classId, previousStatus: "draft" });
      expect(seen[0]).toBe("read#1:draft");
    });

    it("B and I: publication commits first; archive records published and preserves the frozen revision and binding", async () => {
      const w = await seedWorld(1);
      await deployResource(w.resourceId, 1);
      const id = `asg-arch-b-${w.ns}`;
      await seedDraft(w, id);
      await publish(w, id);
      const before = await data(`assignments/${id}`);
      const pointerBefore = await data(`classes/${w.classId}/assignmentsCurrent/${w.resourceId}`);
      const readStatuses: unknown[] = [];

      await __archiveAssignmentWithHooks(req(w, w.teacher, { assignmentId: id }), {
        afterRead: async () => {
          readStatuses.push((await data(`assignments/${id}`))?.status);
        },
      });

      expect(readStatuses).toEqual(["published"]);
      const after = await data(`assignments/${id}`);
      expect(after).toEqual({ ...before, status: "archived" });
      expect(after?.completionBinding).toEqual(before?.completionBinding);
      expect(after?.assessmentRevisionId).toBe(before?.assessmentRevisionId);
      expect(await data(`classes/${w.classId}/assignmentsCurrent/${w.resourceId}`)).toEqual(pointerBefore);
      const audits = await archivedAudits(id);
      expect(audits).toHaveLength(1);
      expect(audits[0].payload).toEqual({ classId: w.classId, previousStatus: "published" });
    });

    it("C and H: archive commits first; publication is refused and writes nothing", async () => {
      const w = await seedWorld(1);
      await deployResource(w.resourceId, 1);
      const id = `asg-arch-c-${w.ns}`;
      await seedDraft(w, id);
      await archive(w, id);

      await expect(publish(w, id)).rejects.toMatchObject({ code: "assignments.invalidTransition" });
      await expect(__assignmentsPublishHandler(req(w, w.teacher, { assignmentId: id }))).rejects.toMatchObject({
        code: "assignments.invalidTransition",
      });
      const a = await data(`assignments/${id}`);
      expect(a?.status).toBe("archived");
      expect(a?.completionBinding).toBeUndefined();
      expect(await publishedAudits(id)).toHaveLength(0);
      expect(await recipients(id)).toEqual([]);
      expect(await data(`classes/${w.classId}/assignmentsCurrent/${w.resourceId}`)).toBeUndefined();
    });

    it("D: two concurrent archives produce exactly one transition and one audit", async () => {
      const w = await seedWorld(1);
      const id = `asg-arch-d-${w.ns}`;
      await lessonDraft(w, id);
      const results = await settle([archive(w, id), archive(w, id), archive(w, id)]);
      const values = results.filter((r) => r.status === "fulfilled").map((r) => (r as PromiseFulfilledResult<{ alreadyArchived: boolean }>).value);
      const reasons = results.filter((r) => r.status === "rejected").map((r) => ((r).reason as { code?: string }).code);
      expect(values.filter((v) => !v.alreadyArchived)).toHaveLength(1);
      for (const code of reasons) expect(code).toBe("assignments.archiveConflict");
      expect(await archivedAudits(id)).toHaveLength(1);
      expect((await data(`assignments/${id}`))?.status).toBe("archived");
    });

    it("E: a failure after the transition and audit are staged leaves no status or audit change", async () => {
      const w = await seedWorld(1);
      const id = `asg-arch-e-${w.ns}`;
      await lessonDraft(w, id);
      const before = await data(`assignments/${id}`);

      await expect(
        __archiveAssignmentWithHooks(req(w, w.teacher, { assignmentId: id }), {
          afterWrites: () => Promise.reject(new Error("audit write failed")),
        }),
      ).rejects.toThrow("audit write failed");
      expect(await data(`assignments/${id}`)).toEqual(before);
      expect(await archivedAudits(id)).toHaveLength(0);
    });

    it("G: an already-archived assignment is idempotent with no second audit", async () => {
      const w = await seedWorld(1);
      const id = `asg-arch-g-${w.ns}`;
      await lessonDraft(w, id);
      await expect(archive(w, id)).resolves.toMatchObject({ alreadyArchived: false });
      const after = await data(`assignments/${id}`);
      await expect(archive(w, id)).resolves.toEqual({ assignmentId: id, status: "archived", alreadyArchived: true });
      expect(await data(`assignments/${id}`)).toEqual(after);
      expect(await archivedAudits(id)).toHaveLength(1);
    });

    it("J: lesson archive is unchanged: only status changes, the Current pointer is untouched, and ownership is enforced", async () => {
      const w = await seedWorld(1);
      const id = `asg-arch-j-${w.ns}`;
      const lesson = await lessonDraft(w, id);
      await __assignmentsPublishHandler(req(w, w.teacher, { assignmentId: id }));
      const before = await data(`assignments/${id}`);
      const pointerBefore = await data(`classes/${w.classId}/assignmentsCurrent/${lesson}`);

      await expect(
        __assignmentsArchiveHandler(req(w, w.students[0], { assignmentId: id }, "student")),
      ).rejects.toMatchObject({ code: "role-forbidden" });
      await expect(archive(w, id)).resolves.toEqual({ assignmentId: id, status: "archived", alreadyArchived: false });

      expect(await data(`assignments/${id}`)).toEqual({ ...before, status: "archived" });
      expect(await data(`classes/${w.classId}/assignmentsCurrent/${lesson}`)).toEqual(pointerBefore);
      const audits = await archivedAudits(id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({ actorUserId: w.teacher, actorRole: "teacher", targetType: "assignment", targetId: id });
    });
  });

  // RA-3C: reopen reads, validates, transitions, and audits in one
  // transaction. Interleavings are forced with the reopen and archive test
  // hooks (awaited inside the transaction), not with sleeps. Assertions are
  // on committed outcomes; no particular transaction winner is assumed.
  describe("reopen lifecycle concurrency", () => {
    const reopen = (w: World, id: string) => __assignmentsReopenHandler(req(w, w.teacher, { assignmentId: id }));
    const archive = (w: World, id: string) => __assignmentsArchiveHandler(req(w, w.teacher, { assignmentId: id }));

    // A legacy `closed` occurrence. `assignmentsClose` can no longer write
    // `closed`, so the legacy state is seeded directly after a real publish.
    async function closedLesson(w: World, id: string) {
      const lesson = `emu-reo-${w.ns}`;
      await deployLesson(lesson);
      await seedDraft(w, id, { lessonSlug: lesson, resourceType: undefined });
      await __assignmentsPublishHandler(req(w, w.teacher, { assignmentId: id }));
      await db.doc(`assignments/${id}`).update({ status: "closed" });
      return lesson;
    }

    // Archive must be terminal and the audit trail must describe one
    // serial history, whichever transaction committed first.
    async function expectSerializableArchivedHistory(id: string, classId: string, reopenResult: PromiseSettledResult<unknown>) {
      expect((await data(`assignments/${id}`))?.status).toBe("archived");
      const archived = await archivedAudits(id);
      const reopened = await reopenedAudits(id);
      expect(archived).toHaveLength(1);
      if (reopenResult.status === "fulfilled") {
        expect(reopenResult.value).toMatchObject({ alreadyPublished: false });
        expect(reopened).toHaveLength(1);
        expect(reopened[0].payload).toEqual({ classId, previousStatus: "closed" });
        expect(archived[0].payload).toEqual({ classId, previousStatus: "published" });
      } else {
        expect(["assignments.invalidTransition", "assignments.reopenConflict"]).toContain(
          (reopenResult.reason as { code?: string }).code,
        );
        expect(reopened).toHaveLength(0);
        expect(archived[0].payload).toEqual({ classId, previousStatus: "closed" });
      }
    }

    it("A and O: reopen reads closed, then a concurrent archive commits; the archive is never resurrected", async () => {
      const w = await seedWorld(1);
      const id = `asg-reo-a-${w.ns}`;
      await closedLesson(w, id);
      let archiving: Promise<unknown> | undefined;
      const reads: string[] = [];

      const reopenResult = (await settle([
        __reopenAssignmentWithHooks(req(w, w.teacher, { assignmentId: id }), {
          afterRead: async (attempt) => {
            reads.push(String((await data(`assignments/${id}`))?.status));
            // Barrier: start the archive while this transaction holds its
            // read of `closed`. Not awaited here.
            if (attempt === 1) archiving = archive(w, id);
          },
        }),
      ]))[0];
      await expect(archiving).resolves.toMatchObject({ status: "archived", alreadyArchived: false });

      expect(reads[0]).toBe("closed");
      await expectSerializableArchivedHistory(id, w.classId, reopenResult);
    });

    it("A' and O: archive reads closed, then a concurrent reopen commits; the final state is still archived", async () => {
      const w = await seedWorld(1);
      const id = `asg-reo-a2-${w.ns}`;
      await closedLesson(w, id);
      let reopening: Promise<unknown> | undefined;

      await __archiveAssignmentWithHooks(req(w, w.teacher, { assignmentId: id }), {
        afterRead: (attempt) => {
          if (attempt === 1) reopening = reopen(w, id);
          return Promise.resolve();
        },
      });
      const reopenResult = (await settle([reopening as Promise<unknown>]))[0];
      await expectSerializableArchivedHistory(id, w.classId, reopenResult);
    });

    it("B and F: archive commits before reopen reads; reopen is refused and writes nothing", async () => {
      const w = await seedWorld(1);
      const id = `asg-reo-b-${w.ns}`;
      await closedLesson(w, id);
      await archive(w, id);
      const before = await data(`assignments/${id}`);

      await expect(reopen(w, id)).rejects.toMatchObject({ code: "assignments.invalidTransition" });
      expect(await data(`assignments/${id}`)).toEqual(before);
      expect(await reopenedAudits(id)).toHaveLength(0);
    });

    it("C: reopen commits first, then archive; both audits describe the real history", async () => {
      const w = await seedWorld(1);
      const id = `asg-reo-c-${w.ns}`;
      await closedLesson(w, id);

      await expect(reopen(w, id)).resolves.toEqual({ assignmentId: id, status: "published", alreadyPublished: false });
      await expect(archive(w, id)).resolves.toMatchObject({ alreadyArchived: false });
      await expectSerializableArchivedHistory(id, w.classId, { status: "fulfilled", value: { alreadyPublished: false } });
      await expect(reopen(w, id)).rejects.toMatchObject({ code: "assignments.invalidTransition" });
      expect((await data(`assignments/${id}`))?.status).toBe("archived");
    });

    it("D: concurrent reopens produce exactly one transition and one audit", async () => {
      const w = await seedWorld(1);
      const id = `asg-reo-d-${w.ns}`;
      await closedLesson(w, id);
      const results = await settle([reopen(w, id), reopen(w, id), reopen(w, id)]);
      const values = results
        .filter((r) => r.status === "fulfilled")
        .map((r) => (r as PromiseFulfilledResult<{ alreadyPublished: boolean }>).value);
      const reasons = results.filter((r) => r.status === "rejected").map((r) => (r.reason as { code?: string }).code);
      expect(values.filter((v) => !v.alreadyPublished)).toHaveLength(1);
      for (const code of reasons) expect(code).toBe("assignments.reopenConflict");
      expect(await reopenedAudits(id)).toHaveLength(1);
      expect((await data(`assignments/${id}`))?.status).toBe("published");
    });

    it("E: reopening an already-published assignment is idempotent with no write and no audit", async () => {
      const w = await seedWorld(1);
      const id = `asg-reo-e-${w.ns}`;
      await closedLesson(w, id);
      await reopen(w, id);
      const after = await data(`assignments/${id}`);
      await expect(reopen(w, id)).resolves.toEqual({ assignmentId: id, status: "published", alreadyPublished: true });
      expect(await data(`assignments/${id}`)).toEqual(after);
      expect(await reopenedAudits(id)).toHaveLength(1);
    });

    it("H: a failure after the transition and audit are staged leaves no status or audit change", async () => {
      const w = await seedWorld(1);
      const id = `asg-reo-h-${w.ns}`;
      await closedLesson(w, id);
      const before = await data(`assignments/${id}`);

      await expect(
        __reopenAssignmentWithHooks(req(w, w.teacher, { assignmentId: id }), {
          afterWrites: () => Promise.reject(new Error("audit write failed")),
        }),
      ).rejects.toThrow("audit write failed");
      expect(await data(`assignments/${id}`)).toEqual(before);
      expect(await reopenedAudits(id)).toHaveLength(0);
    });

    it("I: a competing write during the reopen transaction never yields a duplicate transition or audit", async () => {
      const w = await seedWorld(1);
      const id = `asg-reo-i-${w.ns}`;
      await closedLesson(w, id);
      const attempts: number[] = [];
      let competing: Promise<unknown> | undefined;

      const result = await __reopenAssignmentWithHooks(req(w, w.teacher, { assignmentId: id }), {
        afterRead: (attempt) => {
          attempts.push(attempt);
          // A competing non-transactional write to the record this
          // transaction read. Not awaited: the emulator decides ordering.
          if (attempt === 1) competing = db.doc(`assignments/${id}`).update({ status: "closed" });
          return Promise.resolve();
        },
      });
      await competing;

      // Whatever ordering the emulator chose, exactly one committed
      // transition and one audit exist.
      expect(result).toMatchObject({ status: "published" });
      const a = await data(`assignments/${id}`);
      const audits = await reopenedAudits(id);
      if (a?.status === "published") {
        expect(result).toMatchObject({ alreadyPublished: false });
        expect(audits).toHaveLength(1);
      } else {
        // The competing write landed after the reopen committed.
        expect(a?.status).toBe("closed");
        expect(audits).toHaveLength(1);
      }
      expect(attempts[0]).toBe(1);
    });

    it("K: a different teacher and a student cannot reopen", async () => {
      const w = await seedWorld(1);
      const id = `asg-reo-k-${w.ns}`;
      await closedLesson(w, id);
      const before = await data(`assignments/${id}`);
      const other = `teacher-other-${w.ns}`;
      await db.doc(`users/${other}`).set({ status: "active", role: "teacher", schoolId: w.schoolId });

      await expect(__assignmentsReopenHandler(req(w, other, { assignmentId: id }))).rejects.toMatchObject({
        code: "assignments.forbidden",
      });
      await expect(
        __assignmentsReopenHandler(req(w, w.students[0], { assignmentId: id }, "student")),
      ).rejects.toMatchObject({ code: "role-forbidden" });
      expect(await data(`assignments/${id}`)).toEqual(before);
      expect(await reopenedAudits(id)).toHaveLength(0);
    });

    it("L and M: reopen preserves the frozen revision, completion binding, recipients, and Current pointer", async () => {
      const w = await seedWorld(2);
      await deployResource(w.resourceId, 1);
      const id = `asg-reo-l-${w.ns}`;
      await seedDraft(w, id);
      await publish(w, id);
      await db.doc(`assignments/${id}`).update({ status: "closed" });
      const before = await data(`assignments/${id}`);
      const recipientsBefore = await recipients(id);
      const pointerBefore = await data(`classes/${w.classId}/assignmentsCurrent/${w.resourceId}`);
      expect(before?.completionBinding).toBeDefined();

      await expect(reopen(w, id)).resolves.toMatchObject({ alreadyPublished: false });

      expect(await data(`assignments/${id}`)).toEqual({ ...before, status: "published" });
      expect(await recipients(id)).toEqual(recipientsBefore);
      expect(recipientsBefore).toHaveLength(2);
      expect(await data(`classes/${w.classId}/assignmentsCurrent/${w.resourceId}`)).toEqual(pointerBefore);
    });

    it("N: lesson reopen is unchanged: only status changes and the audit carries the established fields", async () => {
      const w = await seedWorld(1);
      const id = `asg-reo-n-${w.ns}`;
      const lesson = await closedLesson(w, id);
      const before = await data(`assignments/${id}`);
      const pointerBefore = await data(`classes/${w.classId}/assignmentsCurrent/${lesson}`);

      await expect(reopen(w, id)).resolves.toEqual({ assignmentId: id, status: "published", alreadyPublished: false });
      expect(await data(`assignments/${id}`)).toEqual({ ...before, status: "published" });
      expect(await data(`classes/${w.classId}/assignmentsCurrent/${lesson}`)).toEqual(pointerBefore);
      const audits = await reopenedAudits(id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        actorUserId: w.teacher,
        actorRole: "teacher",
        targetType: "assignment",
        targetId: id,
        schoolId: w.schoolId,
        districtId: w.districtId,
        payload: { classId: w.classId, previousStatus: "closed" },
      });
    });
  });
});
