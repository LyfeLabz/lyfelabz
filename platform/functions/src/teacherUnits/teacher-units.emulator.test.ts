// U1A/U1B emulator-backed proofs for the `teacherUnits*` callables.
//
// Runs against the REAL Firestore emulator (`npm run test:emulator`, which
// wraps jest in `firebase emulators:exec` with the offline `demo-bootstrap`
// project). Every handler runs its real authorization (`requireDistrictContext`
// reads the seeded `users` and `schools` records), real transactions, and
// real `create` preconditions. Every record is synthetic emulator data.
// Skips when the emulator host is absent.

import { getApps, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import type { CallableRequest } from "firebase-functions/v2/https";

import { log } from "../shared/logging/logger";
import { readOwnedTeacherUnit, type TeacherUnitActor } from "./teacher-unit-access";
import { mutateOwnedTeacherUnit } from "./teacher-unit-mutation";
import { __teacherUnitsArchiveHandler } from "./teacher-units-archive";
import {
  __teacherUnitsCreateHandler,
  createTeacherUnit,
  teacherUnitCreateReceiptId,
} from "./teacher-units-create";
import { __teacherUnitsGetHandler } from "./teacher-units-get";
import { __teacherUnitsListHandler, listOwnedTeacherUnits } from "./teacher-units-list";
import { __teacherUnitsReorderHandler, reorderTeacherUnits } from "./teacher-units-reorder";
import { __teacherUnitsRestoreHandler } from "./teacher-units-restore";
import { __teacherUnitsSetResourcesHandler } from "./teacher-units-set-resources";
import { __teacherUnitsUpdateHandler } from "./teacher-units-update";

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

type World = {
  readonly schoolId: string;
  readonly otherSchoolId: string;
  readonly districtId: string;
  readonly teacher: string;
  readonly otherTeacher: string;
  readonly crossSchoolTeacher: string;
  readonly student: string;
  readonly suspendedTeacher: string;
};

async function seedWorld(): Promise<World> {
  const ns = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const w: World = {
    schoolId: `school-${ns}`,
    otherSchoolId: `school-other-${ns}`,
    districtId: `district-${ns}`,
    teacher: `teacher-${ns}`,
    otherTeacher: `teacher-other-${ns}`,
    crossSchoolTeacher: `teacher-cross-${ns}`,
    student: `student-${ns}`,
    suspendedTeacher: `teacher-suspended-${ns}`,
  };
  const batch = db.batch();
  batch.set(db.doc(`schools/${w.schoolId}`), { districtId: w.districtId, name: "Emulator School" });
  batch.set(db.doc(`schools/${w.otherSchoolId}`), { districtId: w.districtId, name: "Other School" });
  batch.set(db.doc(`users/${w.teacher}`), { status: "active", role: "teacher", schoolId: w.schoolId });
  batch.set(db.doc(`users/${w.otherTeacher}`), { status: "active", role: "teacher", schoolId: w.schoolId });
  batch.set(db.doc(`users/${w.crossSchoolTeacher}`), {
    status: "active",
    role: "teacher",
    schoolId: w.otherSchoolId,
  });
  batch.set(db.doc(`users/${w.student}`), { status: "active", role: "student", schoolId: w.schoolId });
  batch.set(db.doc(`users/${w.suspendedTeacher}`), {
    status: "suspended",
    role: "teacher",
    schoolId: w.schoolId,
  });
  await batch.commit();
  return w;
}

function req(
  w: World,
  uid: string | null,
  data: unknown,
  token: Record<string, unknown> = {},
): CallableRequest<unknown> {
  const schoolId = uid === w.crossSchoolTeacher ? w.otherSchoolId : w.schoolId;
  const role = uid === w.student ? "student" : "teacher";
  return {
    data,
    auth:
      uid === null
        ? undefined
        : { uid, token: { role, schoolId, districtId: w.districtId, ...token } },
  } as unknown as CallableRequest<unknown>;
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<Record<string, unknown>> {
  try {
    await promise;
  } catch (err) {
    expect((err as { code?: unknown }).code).toBe(code);
    return ((err as { details?: Record<string, unknown> }).details ?? {});
  }
  throw new Error(`Expected refusal with code ${code}, but the call succeeded.`);
}

async function unitData(unitId: string): Promise<Record<string, unknown> | undefined> {
  const snap = await db.doc(`teacherUnits/${unitId}`).get();
  return snap.exists ? snap.data() : undefined;
}

async function unitIdsOwnedBy(uid: string): Promise<string[]> {
  const snap = await db.collection("teacherUnits").where("teacherId", "==", uid).get();
  return snap.docs.map((doc) => doc.id).sort();
}

async function auditsFor(unitId: string): Promise<Record<string, unknown>[]> {
  const snap = await db.collection("auditEvents").where("targetId", "==", unitId).get();
  return snap.docs.map((doc) => doc.data());
}

let keySeq = 0;
function freshKey(): string {
  keySeq += 1;
  return `key-${Date.now().toString(36)}-${String(keySeq)}`;
}
// Adds a fresh idempotencyKey unless the payload names one.
function withKey(data: unknown): unknown {
  if (data && typeof data === "object" && !Array.isArray(data) && !("idempotencyKey" in data)) {
    return { ...(data as Record<string, unknown>), idempotencyKey: freshKey() };
  }
  return data;
}
const create = (w: World, uid: string, data: unknown) =>
  __teacherUnitsCreateHandler(req(w, uid, withKey(data)));
const update = (w: World, uid: string, data: unknown) =>
  __teacherUnitsUpdateHandler(req(w, uid, data));
const archive = (w: World, uid: string, data: unknown) =>
  __teacherUnitsArchiveHandler(req(w, uid, data));
const restore = (w: World, uid: string, data: unknown) =>
  __teacherUnitsRestoreHandler(req(w, uid, data));
const get = (w: World, uid: string, data: unknown) => __teacherUnitsGetHandler(req(w, uid, data));
const list = (w: World, uid: string, data: unknown = {}) =>
  __teacherUnitsListHandler(req(w, uid, data));
const setResources = (w: World, uid: string, data: unknown) =>
  __teacherUnitsSetResourcesHandler(req(w, uid, data));
const reorder = (w: World, uid: string, data: unknown) =>
  __teacherUnitsReorderHandler(req(w, uid, data));

async function createUnit(w: World, title = "Earth Systems", grade = "7", uid = w.teacher) {
  const { unit } = await create(w, uid, { grade, title });
  return unit;
}

d("U1A teacher units (emulator)", () => {
  let w: World;

  beforeAll(() => {
    jest.spyOn(log, "info").mockImplementation(() => undefined);
  });

  beforeEach(async () => {
    w = await seedWorld();
  });

  describe("create", () => {
    it("creates an active unit stamped with the caller's authoritative identity", async () => {
      const { unit } = await create(w, w.teacher, {
        grade: "7",
        title: "  Earth Systems  ",
        description: "Rocks, water,\nand air.",
      });
      expect(unit).toMatchObject({
        grade: "7",
        title: "Earth Systems",
        description: "Rocks, water,\nand air.",
        status: "active",
        archivedAtMillis: null,
        resourceIds: [],
        sortOrder: 0,
        revision: 1,
      });
      expect(unit.unitId).toMatch(/^[A-Za-z0-9]{20}$/);
      expect(typeof unit.createdAtMillis).toBe("number");
      expect(unit.updatedAtMillis).toBe(unit.createdAtMillis);

      const stored = await unitData(unit.unitId);
      expect(stored).toMatchObject({
        teacherId: w.teacher,
        schoolId: w.schoolId,
        grade: "7",
        status: "active",
        archivedAt: null,
        resourceIds: [],
        sortOrder: 0,
        revision: 1,
      });
      expect(Object.keys(stored ?? {}).sort()).toEqual(
        [
          "archivedAt",
          "createdAt",
          "description",
          "grade",
          "resourceIds",
          "revision",
          "schoolId",
          "sortOrder",
          "status",
          "teacherId",
          "title",
          "updatedAt",
        ].sort(),
      );

      const audits = await auditsFor(unit.unitId);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        action: "teacherUnits.created",
        actorUserId: w.teacher,
        actorRole: "teacher",
        targetType: "teacherUnit",
        schoolId: w.schoolId,
        districtId: w.districtId,
        payload: { grade: "7", revision: 1 },
      });
      expect(JSON.stringify(audits[0])).not.toContain("Earth Systems");
    });

    it("defaults description to an empty string and generates distinct stable ids", async () => {
      const a = await createUnit(w, "Unit A");
      const b = await createUnit(w, "Unit A");
      expect(a.description).toBe("");
      expect(a.unitId).not.toBe(b.unitId);
      const fetched = await get(w, w.teacher, { unitId: a.unitId });
      expect(fetched.unit.unitId).toBe(a.unitId);
    });

    it.each(["6", "7", "8"])("accepts supported grade %s", async (grade) => {
      const unit = await createUnit(w, "Grade unit", grade);
      expect(unit.grade).toBe(grade);
    });

    it.each([["5"], ["9"], ["K"], [""], [7], [null], ["07"], [" 7"]])(
      "rejects unsupported grade %p without writing",
      async (grade) => {
        await expectCode(create(w, w.teacher, { grade, title: "Bad" }), "teacherUnits.invalidGrade");
        expect(await unitIdsOwnedBy(w.teacher)).toEqual([]);
      },
    );

    it.each([
      ["teacherId"],
      ["schoolId"],
      ["status"],
      ["revision"],
      ["resourceIds"],
      ["sortOrder"],
      ["archivedAt"],
      ["createdAt"],
      ["unitId"],
      ["somethingElse"],
    ])("rejects the server-owned or unknown field %s without writing", async (field) => {
      await expectCode(
        create(w, w.teacher, { grade: "7", title: "Spoof", [field]: "x" }),
        "teacherUnits.invalidRequest",
      );
      expect(await unitIdsOwnedBy(w.teacher)).toEqual([]);
      expect(await unitIdsOwnedBy("x")).toEqual([]);
    });

    it("never lets a client-supplied teacherId create a unit for someone else", async () => {
      await expectCode(
        create(w, w.teacher, { grade: "7", title: "Spoof", teacherId: w.otherTeacher }),
        "teacherUnits.invalidRequest",
      );
      expect(await unitIdsOwnedBy(w.otherTeacher)).toEqual([]);
    });

    it.each([
      [{ grade: "7" }, "teacherUnits.invalidTitle"],
      [{ grade: "7", title: "" }, "teacherUnits.invalidTitle"],
      [{ grade: "7", title: "   " }, "teacherUnits.invalidTitle"],
      [{ grade: "7", title: 42 }, "teacherUnits.invalidTitle"],
      [{ grade: "7", title: "x".repeat(121) }, "teacherUnits.invalidTitle"],
      [{ grade: "7", title: "Line\nbreak" }, "teacherUnits.invalidTitle"],
      [{ grade: "7", title: "ok", description: 5 }, "teacherUnits.invalidDescription"],
      [{ grade: "7", title: "ok", description: "y".repeat(1001) }, "teacherUnits.invalidDescription"],
      [{ grade: "7", title: "ok", description: "bell\u0007" }, "teacherUnits.invalidDescription"],
      [[], "teacherUnits.invalidRequest"],
      ["string", "teacherUnits.invalidRequest"],
    ])("rejects invalid input %p", async (data, code) => {
      await expectCode(create(w, w.teacher, data), code);
      expect(await unitIdsOwnedBy(w.teacher)).toEqual([]);
    });

    it("accepts the maximum title and description lengths (code points)", async () => {
      const { unit } = await create(w, w.teacher, {
        grade: "6",
        title: "🌍".repeat(120),
        description: "d".repeat(1000),
      });
      expect([...unit.title]).toHaveLength(120);
      expect(unit.description).toHaveLength(1000);
    });
  });

  describe("authorization", () => {
    it("refuses unauthenticated callers", async () => {
      await expectCode(
        __teacherUnitsCreateHandler(req(w, null, { grade: "7", title: "x" })),
        "unauthenticated",
      );
      await expectCode(__teacherUnitsListHandler(req(w, null, {})), "unauthenticated");
    });

    it("refuses students", async () => {
      await expectCode(create(w, w.student, { grade: "7", title: "x" }), "role-forbidden");
      await expectCode(list(w, w.student), "role-forbidden");
    });

    it("refuses an inactive (suspended) teacher holding a stale token", async () => {
      await expectCode(create(w, w.suspendedTeacher, { grade: "7", title: "x" }), "account-inactive");
      await expectCode(list(w, w.suspendedTeacher), "account-inactive");
      expect(await unitIdsOwnedBy(w.suspendedTeacher)).toEqual([]);
    });

    it("refuses a token whose school claim disagrees with the canonical record", async () => {
      await expectCode(
        __teacherUnitsCreateHandler(
          req(w, w.teacher, { grade: "7", title: "x" }, { schoolId: w.otherSchoolId }),
        ),
        "claim-state-mismatch",
      );
      expect(await unitIdsOwnedBy(w.teacher)).toEqual([]);
    });

    it("re-verifies the canonical teacher inside the mutation transaction", async () => {
      const unit = await createUnit(w);
      // The pre-check passed earlier; the teacher is suspended before the
      // transaction runs.
      await db.doc(`users/${w.teacher}`).update({ status: "suspended" });
      await expectCode(
        mutateOwnedTeacherUnit(
          { uid: w.teacher, schoolId: w.schoolId, districtId: w.districtId },
          unit.unitId,
          1,
          () => ({ fields: { title: "Late" }, action: "teacherUnits.updated", changedFields: ["title"] }),
        ),
        "account-inactive",
      );
      expect(await unitData(unit.unitId)).toMatchObject({ title: "Earth Systems", revision: 1 });
    });

    it("hides another teacher's unit from get and every mutation, leaving it untouched", async () => {
      const unit = await createUnit(w, "Owner Unit");
      const before = await unitData(unit.unitId);
      for (const uid of [w.otherTeacher, w.crossSchoolTeacher]) {
        await expectCode(get(w, uid, { unitId: unit.unitId }), "teacherUnits.notFound");
        await expectCode(
          update(w, uid, { unitId: unit.unitId, expectedRevision: 1, title: "Hijack" }),
          "teacherUnits.notFound",
        );
        await expectCode(archive(w, uid, { unitId: unit.unitId, expectedRevision: 1 }), "teacherUnits.notFound");
        await expectCode(restore(w, uid, { unitId: unit.unitId, expectedRevision: 1 }), "teacherUnits.notFound");
      }
      expect(await unitData(unit.unitId)).toEqual(before);
      expect(await auditsFor(unit.unitId)).toHaveLength(1);
    });

    it("denies the owner a unit stamped with a school that is no longer theirs", async () => {
      const unit = await createUnit(w, "Before Transfer");
      await db.doc(`users/${w.teacher}`).update({ schoolId: w.otherSchoolId });
      const moved = (r: unknown) =>
        req(w, w.teacher, r, { schoolId: w.otherSchoolId });
      await expectCode(__teacherUnitsGetHandler(moved({ unitId: unit.unitId })), "teacherUnits.notFound");
      await expectCode(
        __teacherUnitsUpdateHandler(moved({ unitId: unit.unitId, expectedRevision: 1, title: "x" })),
        "teacherUnits.notFound",
      );
      const listed = await __teacherUnitsListHandler(moved({ includeArchived: true }));
      expect(listed.units).toEqual([]);
    });

    it("reports a missing unit and a malformed id distinctly from each other", async () => {
      await expectCode(get(w, w.teacher, { unitId: "A".repeat(20) }), "teacherUnits.notFound");
      await expectCode(get(w, w.teacher, { unitId: "../users/x" }), "teacherUnits.invalidUnitId");
      await expectCode(get(w, w.teacher, {}), "teacherUnits.invalidUnitId");
      await expectCode(get(w, w.teacher, { unitId: "A".repeat(20), teacherId: w.teacher }), "teacherUnits.invalidRequest");
    });
  });

  describe("list", () => {
    it("lists only the caller's own active units in canonical order", async () => {
      const first = await createUnit(w, "First");
      const second = await createUnit(w, "Second", "8");
      const archived = await createUnit(w, "Archived");
      await archive(w, w.teacher, { unitId: archived.unitId, expectedRevision: 1 });
      await createUnit(w, "Not mine", "7", w.otherTeacher);

      const active = await list(w, w.teacher);
      expect(active.units.map((u) => u.unitId)).toEqual([first.unitId, second.unitId]);

      const all = await list(w, w.teacher, { includeArchived: true });
      expect(all.units.map((u) => u.unitId)).toEqual([first.unitId, second.unitId, archived.unitId]);

      const grade8 = await list(w, w.teacher, { grade: "8" });
      expect(grade8.units.map((u) => u.unitId)).toEqual([second.unitId]);
    });

    it("validates list options", async () => {
      await expectCode(list(w, w.teacher, { includeArchived: "yes" }), "teacherUnits.invalidRequest");
      await expectCode(list(w, w.teacher, { grade: "5" }), "teacherUnits.invalidGrade");
      await expectCode(list(w, w.teacher, { teacherId: w.otherTeacher }), "teacherUnits.invalidRequest");
    });
  });

  describe("update (rename and description)", () => {
    it("renames with revision increment and a field-name-only audit", async () => {
      const unit = await createUnit(w);
      const result = await update(w, w.teacher, {
        unitId: unit.unitId,
        expectedRevision: 1,
        title: "Earth's Systems",
      });
      expect(result.noop).toBe(false);
      expect(result.unit).toMatchObject({ unitId: unit.unitId, title: "Earth's Systems", revision: 2 });
      const audits = (await auditsFor(unit.unitId)).filter((a) => a.action === "teacherUnits.updated");
      expect(audits).toHaveLength(1);
      expect(audits[0].payload).toEqual({
        grade: "7",
        previousRevision: 1,
        revision: 2,
        changedFields: ["title"],
      });
      expect(JSON.stringify(audits[0])).not.toContain("Earth's Systems");
    });

    it("edits and clears the description, keeping identity fields fixed", async () => {
      const unit = await createUnit(w);
      const before = await unitData(unit.unitId);
      await update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, description: "New" });
      const cleared = await update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 2, description: "" });
      expect(cleared.unit).toMatchObject({ description: "", revision: 3 });
      const after = await unitData(unit.unitId);
      for (const key of ["teacherId", "schoolId", "grade", "createdAt", "resourceIds", "sortOrder", "title", "status"]) {
        expect(after?.[key]).toEqual(before?.[key]);
      }
    });

    it("updates title and description together as one revision", async () => {
      const unit = await createUnit(w);
      const result = await update(w, w.teacher, {
        unitId: unit.unitId,
        expectedRevision: 1,
        title: "T2",
        description: "D2",
      });
      expect(result.unit).toMatchObject({ title: "T2", description: "D2", revision: 2 });
      const audit = (await auditsFor(unit.unitId)).find((a) => a.action === "teacherUnits.updated");
      expect((audit?.payload as { changedFields: string[] }).changedFields).toEqual(["title", "description"]);
    });

    it("treats an equal-value update as a no-op (no write, no revision, no audit)", async () => {
      const unit = await createUnit(w);
      const before = await unitData(unit.unitId);
      const result = await update(w, w.teacher, {
        unitId: unit.unitId,
        expectedRevision: 1,
        title: "  Earth Systems ",
      });
      expect(result.noop).toBe(true);
      expect(result.unit.revision).toBe(1);
      expect(await unitData(unit.unitId)).toEqual(before);
      expect(await auditsFor(unit.unitId)).toHaveLength(1);
    });

    it("rejects a stale revision without overwriting newer data", async () => {
      const unit = await createUnit(w);
      await update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, title: "Newer" });
      const before = await unitData(unit.unitId);
      const details = await expectCode(
        update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, title: "Stale", description: "x" }),
        "teacherUnits.writeConflict",
      );
      expect(details).toEqual({ currentRevision: 2 });
      expect(await unitData(unit.unitId)).toEqual(before);
      await expectCode(
        update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 5, title: "Future" }),
        "teacherUnits.writeConflict",
      );
      expect(await unitData(unit.unitId)).toEqual(before);
    });

    it.each([
      [{ expectedRevision: 1 }, "teacherUnits.invalidRequest"],
      [{ expectedRevision: 1, grade: "8" }, "teacherUnits.invalidRequest"],
      [{ expectedRevision: 1, title: "x", status: "archived" }, "teacherUnits.invalidRequest"],
      [{ expectedRevision: 1, title: "x", resourceIds: ["lesson_x"] }, "teacherUnits.invalidRequest"],
      [{ expectedRevision: 1, title: "x", sortOrder: 3 }, "teacherUnits.invalidRequest"],
      [{ expectedRevision: 1, title: "x", revision: 9 }, "teacherUnits.invalidRequest"],
      [{ expectedRevision: 0, title: "x" }, "teacherUnits.invalidExpectedRevision"],
      [{ expectedRevision: 1.5, title: "x" }, "teacherUnits.invalidExpectedRevision"],
      [{ expectedRevision: "1", title: "x" }, "teacherUnits.invalidExpectedRevision"],
      [{ title: "x" }, "teacherUnits.invalidExpectedRevision"],
      [{ expectedRevision: 1, title: "" }, "teacherUnits.invalidTitle"],
    ])("rejects invalid update %p and preserves the record", async (extra, code) => {
      const unit = await createUnit(w);
      const before = await unitData(unit.unitId);
      await expectCode(update(w, w.teacher, { unitId: unit.unitId, ...extra }), code);
      expect(await unitData(unit.unitId)).toEqual(before);
    });

    it("refuses to edit an archived unit", async () => {
      const unit = await createUnit(w);
      await archive(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1 });
      const before = await unitData(unit.unitId);
      await expectCode(
        update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 2, title: "Edited" }),
        "teacherUnits.invalidStatus",
      );
      expect(await unitData(unit.unitId)).toEqual(before);
    });
  });

  describe("archive and restore", () => {
    it("archives and restores the same unit, preserving every identity and content field", async () => {
      const unit = await createUnit(w, "Water Systems", "8");
      await update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, description: "Cycle" });
      // Simulate U1B-populated membership and ordering to prove preservation.
      await db.doc(`teacherUnits/${unit.unitId}`).update({ resourceIds: ["lesson_water-cycle"], sortOrder: 4 });
      const before = await unitData(unit.unitId);

      const archived = await archive(w, w.teacher, { unitId: unit.unitId, expectedRevision: 2 });
      expect(archived.noop).toBe(false);
      expect(archived.unit).toMatchObject({ unitId: unit.unitId, status: "archived", revision: 3 });
      expect(typeof archived.unit.archivedAtMillis).toBe("number");
      const afterArchive = await unitData(unit.unitId);
      expect(afterArchive).toBeDefined();
      for (const key of ["teacherId", "schoolId", "grade", "title", "description", "resourceIds", "sortOrder", "createdAt"]) {
        expect(afterArchive?.[key]).toEqual(before?.[key]);
      }

      const restored = await restore(w, w.teacher, { unitId: unit.unitId, expectedRevision: 3 });
      expect(restored.unit).toMatchObject({
        unitId: unit.unitId,
        status: "active",
        archivedAtMillis: null,
        revision: 4,
        resourceIds: ["lesson_water-cycle"],
        sortOrder: 4,
      });
      const afterRestore = await unitData(unit.unitId);
      for (const key of ["teacherId", "schoolId", "grade", "title", "description", "resourceIds", "sortOrder", "createdAt"]) {
        expect(afterRestore?.[key]).toEqual(before?.[key]);
      }
      expect(afterRestore?.archivedAt).toBeNull();

      const actions = (await auditsFor(unit.unitId)).map((a) => a.action).sort();
      expect(actions).toEqual(
        ["teacherUnits.archived", "teacherUnits.created", "teacherUnits.restored", "teacherUnits.updated"].sort(),
      );
    });

    it("is idempotent: repeat archive and repeat restore are no-ops", async () => {
      const unit = await createUnit(w);
      await archive(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1 });
      const archivedState = await unitData(unit.unitId);

      // A retry carrying the pre-archive revision (lost response) succeeds
      // as a no-op and keeps the original archivedAt.
      const again = await archive(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1 });
      expect(again.noop).toBe(true);
      expect(again.unit.revision).toBe(2);
      expect(await unitData(unit.unitId)).toEqual(archivedState);

      await restore(w, w.teacher, { unitId: unit.unitId, expectedRevision: 2 });
      const restoredState = await unitData(unit.unitId);
      const againRestore = await restore(w, w.teacher, { unitId: unit.unitId, expectedRevision: 2 });
      expect(againRestore.noop).toBe(true);
      expect(againRestore.unit.revision).toBe(3);
      expect(await unitData(unit.unitId)).toEqual(restoredState);

      expect((await auditsFor(unit.unitId)).map((a) => a.action).filter((a) => a !== "teacherUnits.created"))
        .toHaveLength(2);
    });

    it("rejects a state-changing archive or restore at a stale revision", async () => {
      const unit = await createUnit(w);
      await update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, title: "Renamed" });
      const before = await unitData(unit.unitId);
      await expectCode(archive(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1 }), "teacherUnits.writeConflict");
      expect(await unitData(unit.unitId)).toEqual(before);

      await archive(w, w.teacher, { unitId: unit.unitId, expectedRevision: 2 });
      const archivedState = await unitData(unit.unitId);
      await expectCode(restore(w, w.teacher, { unitId: unit.unitId, expectedRevision: 2 }), "teacherUnits.writeConflict");
      expect(await unitData(unit.unitId)).toEqual(archivedState);
    });

    it("rejects unexpected lifecycle fields", async () => {
      const unit = await createUnit(w);
      await expectCode(
        archive(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, archivedAt: 0 }),
        "teacherUnits.invalidRequest",
      );
      await expectCode(
        restore(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, status: "active" }),
        "teacherUnits.invalidRequest",
      );
      expect(await unitData(unit.unitId)).toMatchObject({ status: "active", revision: 1 });
    });
  });

  describe("concurrency", () => {
    it("accepts exactly one of several simultaneous writers at the same revision", async () => {
      const unit = await createUnit(w);
      const writers = Array.from({ length: 6 }, (_, i) =>
        update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, title: `Writer ${String(i)}` }),
      );
      const settled = await Promise.allSettled(writers);
      const accepted = settled.filter((s) => s.status === "fulfilled");
      const refused = settled.filter((s): s is PromiseRejectedResult => s.status === "rejected");
      expect(accepted).toHaveLength(1);
      expect(refused).toHaveLength(5);
      for (const r of refused) {
        expect((r.reason as { code?: unknown }).code).toBe("teacherUnits.writeConflict");
      }
      const stored = await unitData(unit.unitId);
      expect(stored?.revision).toBe(2);
      const winner = (accepted[0] as PromiseFulfilledResult<{ unit: { title: string } }>).value.unit.title;
      expect(stored?.title).toBe(winner);
      expect((await auditsFor(unit.unitId)).filter((a) => a.action === "teacherUnits.updated")).toHaveLength(1);
    });

    it("serializes a simultaneous archive and rename at the same revision", async () => {
      const unit = await createUnit(w);
      const settled = await Promise.allSettled([
        archive(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1 }),
        update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, title: "Racing" }),
      ]);
      const accepted = settled.filter((s) => s.status === "fulfilled");
      expect(accepted).toHaveLength(1);
      const refused = settled.find((s): s is PromiseRejectedResult => s.status === "rejected");
      expect(["teacherUnits.writeConflict", "teacherUnits.invalidStatus"]).toContain(
        (refused?.reason as { code?: unknown }).code,
      );
      const stored = await unitData(unit.unitId);
      expect(stored?.revision).toBe(2);
      const archivedWon = settled[0].status === "fulfilled";
      expect(stored?.status).toBe(archivedWon ? "archived" : "active");
      expect(stored?.title).toBe(archivedWon ? "Earth Systems" : "Racing");
    });

    it("lets concurrent creates each produce a distinct unit", async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) => create(w, w.teacher, { grade: "7", title: `C${String(i)}` })),
      );
      const ids = new Set(results.map((r) => r.unit.unitId));
      expect(ids.size).toBe(5);
      expect(await unitIdsOwnedBy(w.teacher)).toHaveLength(5);
    });
  });

  describe("preservation of unrelated data", () => {
    it("never touches classes, assignments, or other teachers' units", async () => {
      const classPath = `classes/class-${w.teacher}`;
      const assignmentPath = `assignments/assignment-${w.teacher}`;
      await db.doc(classPath).set({ teacherId: w.teacher, schoolId: w.schoolId, status: "active", title: "Class" });
      await db.doc(assignmentPath).set({ teacherId: w.teacher, classId: `class-${w.teacher}`, status: "published" });
      const other = await createUnit(w, "Other", "7", w.otherTeacher);
      const snapshot = async () => ({
        cls: await db.doc(classPath).get().then((s) => s.data()),
        asg: await db.doc(assignmentPath).get().then((s) => s.data()),
        other: await unitData(other.unitId),
      });
      const before = await snapshot();

      const unit = await createUnit(w);
      await update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, title: "R" });
      await archive(w, w.teacher, { unitId: unit.unitId, expectedRevision: 2 });
      await restore(w, w.teacher, { unitId: unit.unitId, expectedRevision: 3 });

      expect(await snapshot()).toEqual(before);
      expect(await unitData(unit.unitId)).toBeDefined();
    });
  });

  // ---------- Certification remediation (Sol 6.1) ----------

  const actorOf = (uid: string = w.teacher, schoolId: string = w.schoolId): TeacherUnitActor => ({
    uid,
    schoolId,
    districtId: w.districtId,
  });

  async function receiptsOwnedBy(uid: string): Promise<Record<string, unknown>[]> {
    const snap = await db.collection("teacherUnitCreateReceipts").where("teacherId", "==", uid).get();
    return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  // Each revocation is committed AFTER the caller's pre-transaction
  // authorization (`assertActiveTeacher`) and BEFORE the transaction that
  // reads or writes unit data. The helpers are called with the actor that
  // pre-check produced, which is exactly the state the original defect
  // trusted.
  const REVOCATIONS: readonly [string, (w: World) => Promise<unknown>, string][] = [
    ["teacher suspended", (x) => db.doc(`users/${x.teacher}`).update({ status: "suspended" }), "account-inactive"],
    ["teacher role changed", (x) => db.doc(`users/${x.teacher}`).update({ role: "student" }), "role-forbidden"],
    [
      "teacher transferred to another school",
      (x) => db.doc(`users/${x.teacher}`).update({ schoolId: x.otherSchoolId }),
      "claim-state-mismatch",
    ],
    ["school deleted", (x) => db.doc(`schools/${x.schoolId}`).delete(), "school-district-mismatch"],
    [
      "school reassigned to another district",
      (x) => db.doc(`schools/${x.schoolId}`).update({ districtId: `${x.districtId}-other` }),
      "district-mismatch",
    ],
    [
      "school district removed",
      (x) => db.doc(`schools/${x.schoolId}`).update({ districtId: FieldValue.delete() }),
      "district-unassigned",
    ],
  ];

  describe("authorization snapshot (P1/P2)", () => {
    it.each(REVOCATIONS)("get refuses after %s", async (_label, revoke, code) => {
      const unit = await createUnit(w);
      await revoke(w);
      await expectCode(readOwnedTeacherUnit(actorOf(), unit.unitId), code);
    });

    it.each(REVOCATIONS)("list refuses after %s", async (_label, revoke, code) => {
      await createUnit(w);
      await revoke(w);
      await expectCode(listOwnedTeacherUnits(actorOf(), { includeArchived: true, grade: undefined }), code);
    });

    it.each(REVOCATIONS)("mutation refuses after %s and writes nothing", async (_label, revoke, code) => {
      const unit = await createUnit(w);
      const before = await unitData(unit.unitId);
      await revoke(w);
      await expectCode(
        mutateOwnedTeacherUnit(actorOf(), unit.unitId, 1, () => ({
          fields: { title: "Late" },
          action: "teacherUnits.updated",
          changedFields: ["title"],
        })),
        code,
      );
      expect(await unitData(unit.unitId)).toEqual(before);
      expect(await auditsFor(unit.unitId)).toHaveLength(1);
    });

    it.each(REVOCATIONS)("create refuses after %s and writes nothing", async (_label, revoke, code) => {
      await revoke(w);
      await expectCode(
        createTeacherUnit(actorOf(), { grade: "7", title: "Late", description: "", idempotencyKey: freshKey() }),
        code,
      );
      expect(await unitIdsOwnedBy(w.teacher)).toEqual([]);
      expect(await receiptsOwnedBy(w.teacher)).toEqual([]);
    });

    it("refuses a replay for a teacher suspended after the original create", async () => {
      const idempotencyKey = freshKey();
      await create(w, w.teacher, { grade: "7", title: "Earth", idempotencyKey });
      await db.doc(`users/${w.teacher}`).update({ status: "suspended" });
      await expectCode(
        createTeacherUnit(actorOf(), { grade: "7", title: "Earth", description: "", idempotencyKey }),
        "account-inactive",
      );
    });

    it("attributes audit events to the district read inside the transaction", async () => {
      const unit = await createUnit(w);
      await update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, title: "R" });
      const audits = await auditsFor(unit.unitId);
      expect(audits).toHaveLength(2);
      for (const a of audits) {
        expect(a).toMatchObject({ actorUserId: w.teacher, schoolId: w.schoolId, districtId: w.districtId });
      }
    });
  });

  describe("post-commit response reads", () => {
    it("refuses the mutation response when authorization is revoked after the commit", async () => {
      const unit = await createUnit(w);
      await expectCode(
        mutateOwnedTeacherUnit(
          actorOf(),
          unit.unitId,
          1,
          () => ({ fields: { title: "Committed" }, action: "teacherUnits.updated", changedFields: ["title"] }),
          { afterCommit: () => db.doc(`users/${w.teacher}`).update({ status: "suspended" }).then(() => undefined) },
        ),
        "account-inactive",
      );
      // The write itself committed (with its audit); only the response was refused.
      expect(await unitData(unit.unitId)).toMatchObject({ title: "Committed", revision: 2 });
      expect(await auditsFor(unit.unitId)).toHaveLength(2);
    });

    it("refuses the create response after a post-commit revocation; the same key later replays the unit", async () => {
      const idempotencyKey = freshKey();
      const input = { grade: "7" as const, title: "Ambiguous", description: "", idempotencyKey };
      await expectCode(
        createTeacherUnit(actorOf(), input, {
          afterCommit: () => db.doc(`users/${w.teacher}`).update({ status: "suspended" }).then(() => undefined),
        }),
        "account-inactive",
      );
      const ids = await unitIdsOwnedBy(w.teacher);
      expect(ids).toHaveLength(1);
      await db.doc(`users/${w.teacher}`).update({ status: "active" });
      const replay = await create(w, w.teacher, { grade: "7", title: "Ambiguous", idempotencyKey });
      expect(replay).toMatchObject({ replayed: true, unit: { unitId: ids[0] } });
      expect(await unitIdsOwnedBy(w.teacher)).toEqual(ids);
      expect(await auditsFor(ids[0])).toHaveLength(1);
    });
  });

  describe("create retry safety (P2)", () => {
    it("replays a matching retry with the original unit and no new write or audit", async () => {
      const idempotencyKey = freshKey();
      const first = await create(w, w.teacher, { grade: "7", title: "Earth", idempotencyKey });
      expect(first.replayed).toBe(false);
      // The first response is "lost"; the client retries with the same key.
      const retry = await create(w, w.teacher, { grade: "7", title: "Earth", idempotencyKey });
      expect(retry).toEqual({ replayed: true, unit: first.unit });
      expect(await unitIdsOwnedBy(w.teacher)).toEqual([first.unit.unitId]);
      expect(await auditsFor(first.unit.unitId)).toHaveLength(1);
      expect(await receiptsOwnedBy(w.teacher)).toHaveLength(1);
    });

    it("treats the normalized request as the identity (trim, default description)", async () => {
      const idempotencyKey = freshKey();
      const first = await create(w, w.teacher, { grade: "7", title: " Earth ", idempotencyKey });
      const retry = await create(w, w.teacher, { grade: "7", title: "Earth", description: "", idempotencyKey });
      expect(retry).toMatchObject({ replayed: true, unit: { unitId: first.unit.unitId } });
    });

    it("returns the original unit's current state after it changed", async () => {
      const idempotencyKey = freshKey();
      const first = await create(w, w.teacher, { grade: "7", title: "Earth", idempotencyKey });
      await update(w, w.teacher, { unitId: first.unit.unitId, expectedRevision: 1, title: "Renamed" });
      const retry = await create(w, w.teacher, { grade: "7", title: "Earth", idempotencyKey });
      expect(retry).toMatchObject({ replayed: true, unit: { unitId: first.unit.unitId, title: "Renamed", revision: 2 } });
      expect(await unitIdsOwnedBy(w.teacher)).toHaveLength(1);
    });

    it.each([
      [{ grade: "8", title: "Earth" }],
      [{ grade: "7", title: "Earth 2" }],
      [{ grade: "7", title: "Earth", description: "different" }],
    ])("refuses a key reused with different content %p", async (changed) => {
      const idempotencyKey = freshKey();
      const first = await create(w, w.teacher, { grade: "7", title: "Earth", idempotencyKey });
      await expectCode(create(w, w.teacher, { ...changed, idempotencyKey }), "teacherUnits.idempotencyKeyConflict");
      expect(await unitIdsOwnedBy(w.teacher)).toEqual([first.unit.unitId]);
      expect(await auditsFor(first.unit.unitId)).toHaveLength(1);
    });

    it("never deduplicates by title: distinct keys create distinct units", async () => {
      const a = await create(w, w.teacher, { grade: "7", title: "Same" });
      const b = await create(w, w.teacher, { grade: "7", title: "Same" });
      expect(a.unit.unitId).not.toBe(b.unit.unitId);
      expect(await unitIdsOwnedBy(w.teacher)).toHaveLength(2);
    });

    it("admits exactly one unit for simultaneous requests with one key", async () => {
      const idempotencyKey = freshKey();
      const settled = await Promise.allSettled(
        Array.from({ length: 5 }, () => create(w, w.teacher, { grade: "7", title: "Race", idempotencyKey })),
      );
      const fulfilled = settled
        .filter((r): r is PromiseFulfilledResult<Awaited<ReturnType<typeof create>>> => r.status === "fulfilled")
        .map((r) => r.value);
      const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === "rejected");
      for (const r of rejected) expect((r.reason as { code?: unknown }).code).toBe("teacherUnits.writeConflict");
      expect(fulfilled.length).toBeGreaterThan(0);
      const ids = await unitIdsOwnedBy(w.teacher);
      expect(ids).toHaveLength(1);
      for (const r of fulfilled) expect(r.unit.unitId).toBe(ids[0]);
      expect(fulfilled.filter((r) => !r.replayed).length).toBeLessThanOrEqual(1);
      expect(await auditsFor(ids[0])).toHaveLength(1);
      expect(await receiptsOwnedBy(w.teacher)).toHaveLength(1);
    });

    it("scopes keys to the teacher: another teacher's identical key creates their own unit", async () => {
      const idempotencyKey = freshKey();
      const mine = await create(w, w.teacher, { grade: "7", title: "Earth", idempotencyKey });
      const theirs = await create(w, w.otherTeacher, { grade: "7", title: "Earth", idempotencyKey });
      const crossSchool = await create(w, w.crossSchoolTeacher, { grade: "7", title: "Earth", idempotencyKey });
      expect(theirs.replayed).toBe(false);
      expect(crossSchool.replayed).toBe(false);
      expect(new Set([mine.unit.unitId, theirs.unit.unitId, crossSchool.unit.unitId]).size).toBe(3);
      expect(await unitIdsOwnedBy(w.teacher)).toEqual([mine.unit.unitId]);
    });

    it("scopes keys to the school: after a transfer the old key cannot reach the old unit", async () => {
      const idempotencyKey = freshKey();
      const original = await create(w, w.teacher, { grade: "7", title: "Earth", idempotencyKey });
      await db.doc(`users/${w.teacher}`).update({ schoolId: w.otherSchoolId });
      const moved = await __teacherUnitsCreateHandler(
        req(w, w.teacher, { grade: "7", title: "Earth", idempotencyKey }, { schoolId: w.otherSchoolId }),
      );
      expect(moved.replayed).toBe(false);
      expect(moved.unit.unitId).not.toBe(original.unit.unitId);
      expect((await unitData(moved.unit.unitId))?.schoolId).toBe(w.otherSchoolId);
    });

    it.each([[undefined], [""], ["short"], ["has/slash-key"], ["x".repeat(65)], [12345678]])(
      "rejects idempotencyKey %p with no write",
      async (idempotencyKey) => {
        await expectCode(
          __teacherUnitsCreateHandler(req(w, w.teacher, { grade: "7", title: "Earth", idempotencyKey })),
          "teacherUnits.invalidIdempotencyKey",
        );
        expect(await unitIdsOwnedBy(w.teacher)).toEqual([]);
      },
    );

    it("stores a minimal, scoped, expiring receipt", async () => {
      const idempotencyKey = freshKey();
      const { unit } = await create(w, w.teacher, { grade: "7", title: "Secret title", idempotencyKey });
      const [receipt] = await receiptsOwnedBy(w.teacher);
      expect(receipt.id).toBe(teacherUnitCreateReceiptId(w.teacher, w.schoolId, idempotencyKey));
      expect(Object.keys(receipt).sort()).toEqual(
        ["createdAt", "expiresAt", "id", "requestHash", "schoolId", "teacherId", "unitId"].sort(),
      );
      expect(receipt).toMatchObject({ teacherId: w.teacher, schoolId: w.schoolId, unitId: unit.unitId });
      expect(receipt.requestHash).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(receipt)).not.toContain("Secret title");
      expect(JSON.stringify(receipt)).not.toContain(idempotencyKey);
      const created = (receipt.createdAt as { toMillis: () => number }).toMillis();
      const expires = (receipt.expiresAt as { toMillis: () => number }).toMillis();
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      expect(Math.abs(expires - created - sevenDays)).toBeLessThan(60_000);
    });
  });

  describe("school-scoped listing (P2)", () => {
    async function transferTeacherWithUnits(oldCount: number, newCount: number) {
      for (let i = 0; i < oldCount; i += 1) await createUnit(w, `Old ${String(i)}`);
      await db.doc(`users/${w.teacher}`).update({ schoolId: w.otherSchoolId });
      const newIds: string[] = [];
      for (let i = 0; i < newCount; i += 1) {
        const r = await __teacherUnitsCreateHandler(
          req(w, w.teacher, { grade: "7", title: `New ${String(i)}`, idempotencyKey: freshKey() }, { schoolId: w.otherSchoolId }),
        );
        newIds.push(r.unit.unitId);
      }
      return newIds;
    }

    it("never reads units from the teacher's previous school", async () => {
      const newIds = await transferTeacherWithUnits(2, 2);
      const listed = await __teacherUnitsListHandler(
        req(w, w.teacher, { includeArchived: true }, { schoolId: w.otherSchoolId }),
      );
      expect(listed.units.map((u) => u.unitId)).toEqual(newIds);
    });

    it("applies the overflow ceiling to the current school only", async () => {
      // 3 old-school + 2 current-school units with a ceiling of 2: a
      // teacher-only query would read 5 and overflow.
      const newIds = await transferTeacherWithUnits(3, 2);
      const units = await listOwnedTeacherUnits(actorOf(w.teacher, w.otherSchoolId), {
        includeArchived: true,
        grade: undefined,
        max: 2,
      });
      expect(units.map((u) => u.unitId)).toEqual(newIds);
    });

    it("lists exactly the ceiling and refuses one more, counting archived units", async () => {
      const a = await createUnit(w, "A");
      const b = await createUnit(w, "B");
      const opts = { includeArchived: false, grade: undefined, max: 2 } as const;
      expect((await listOwnedTeacherUnits(actorOf(), opts)).map((u) => u.unitId)).toEqual([a.unitId, b.unitId]);
      const c = await createUnit(w, "C");
      await archive(w, w.teacher, { unitId: c.unitId, expectedRevision: 1 });
      await expectCode(listOwnedTeacherUnits(actorOf(), opts), "teacherUnits.listLimitExceeded");
      await expectCode(listOwnedTeacherUnits(actorOf(), { ...opts, grade: "8" }), "teacherUnits.listLimitExceeded");
    });
  });

  describe("no-op contract at a stale revision", () => {
    it("returns the current revision and writes nothing for a stale no-op; enforces conflicts for real changes", async () => {
      const unit = await createUnit(w);
      await update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, title: "R" });
      const noop = await update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, title: "R" });
      expect(noop).toMatchObject({ noop: true, unit: { title: "R", revision: 2 } });

      await archive(w, w.teacher, { unitId: unit.unitId, expectedRevision: 2 });
      const archivedAt = (await unitData(unit.unitId))?.archivedAt;
      const again = await archive(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1 });
      expect(again).toMatchObject({ noop: true, unit: { status: "archived", revision: 3 } });
      expect((await unitData(unit.unitId))?.archivedAt).toEqual(archivedAt);

      await expectCode(restore(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1 }), "teacherUnits.writeConflict");
      expect(await unitData(unit.unitId)).toMatchObject({ status: "archived", revision: 3 });
      expect((await auditsFor(unit.unitId)).map((a) => a.action).sort()).toEqual(
        ["teacherUnits.archived", "teacherUnits.created", "teacherUnits.updated"].sort(),
      );
    });

    it("authorizes before deciding a no-op", async () => {
      const unit = await createUnit(w);
      await db.doc(`schools/${w.schoolId}`).update({ districtId: `${w.districtId}-other` });
      await expectCode(
        mutateOwnedTeacherUnit(actorOf(), unit.unitId, 1, () => null),
        "district-mismatch",
      );
    });
  });

  // ---------- U1B resource membership and ordering ----------

  // Canonical ids from the RA-1 projection: two placeable lessons, the
  // placeable-but-unassignable Gravity Wells simulation, the gated lesson,
  // and the tool.
  const LESSON_A = "earths-layers";
  const LESSON_B = "water-cycle";
  const GRAVITY_WELLS = "simulation-gravity-wells";
  const GATED_LESSON = "ragebaiting";
  const TOOL = "lab-report-assistant";

  describe("U1B resource membership", () => {
    it("adds, reorders, and removes resources, one revision and audit per accepted change", async () => {
      const unit = await createUnit(w);
      const added = await setResources(w, w.teacher, {
        unitId: unit.unitId,
        expectedRevision: 1,
        resourceIds: [LESSON_A, GRAVITY_WELLS],
      });
      expect(added).toMatchObject({ noop: false, unit: { resourceIds: [LESSON_A, GRAVITY_WELLS], revision: 2 } });
      const reordered = await setResources(w, w.teacher, {
        unitId: unit.unitId,
        expectedRevision: 2,
        resourceIds: [GRAVITY_WELLS, LESSON_B, LESSON_A],
      });
      expect(reordered.unit).toMatchObject({ resourceIds: [GRAVITY_WELLS, LESSON_B, LESSON_A], revision: 3 });
      const removed = await setResources(w, w.teacher, {
        unitId: unit.unitId,
        expectedRevision: 3,
        resourceIds: [LESSON_B],
      });
      expect(removed.unit).toMatchObject({ resourceIds: [LESSON_B], revision: 4 });
      expect(await unitData(unit.unitId)).toMatchObject({
        resourceIds: [LESSON_B],
        revision: 4,
        title: "Earth Systems",
        sortOrder: 0,
        teacherId: w.teacher,
        schoolId: w.schoolId,
        grade: "7",
      });
      const audits = (await auditsFor(unit.unitId)).filter((a) => a.action === "teacherUnits.resourcesUpdated");
      expect(audits.map((a) => a.payload).sort((a, b) => (a as { revision: number }).revision - (b as { revision: number }).revision)).toEqual([
        { grade: "7", previousRevision: 1, revision: 2, previousResourceCount: 0, resourceCount: 2 },
        { grade: "7", previousRevision: 2, revision: 3, previousResourceCount: 2, resourceCount: 3 },
        { grade: "7", previousRevision: 3, revision: 4, previousResourceCount: 3, resourceCount: 1 },
      ]);
      expect(audits[0]).toMatchObject({ targetType: "teacherUnit", schoolId: w.schoolId, districtId: w.districtId });
    });

    it.each([
      ["a gated lesson", [LESSON_A, GATED_LESSON], "teacherUnits.resourceNotPlaceable"],
      ["a reusable tool", [TOOL], "teacherUnits.resourceNotPlaceable"],
      ["an unknown id", [LESSON_A, "not-a-resource"], "teacherUnits.resourceNotPlaceable"],
      ["a duplicate id", [LESSON_A, LESSON_B, LESSON_A], "teacherUnits.duplicateResource"],
      ["a non-string id", [LESSON_A, 7], "teacherUnits.invalidResourceIds"],
      ["a non-array", LESSON_A, "teacherUnits.invalidResourceIds"],
    ])("rejects %s atomically", async (_label, resourceIds, code) => {
      const unit = await createUnit(w);
      await setResources(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, resourceIds: [LESSON_B] });
      const before = await unitData(unit.unitId);
      await expectCode(
        setResources(w, w.teacher, { unitId: unit.unitId, expectedRevision: 2, resourceIds }),
        code,
      );
      expect(await unitData(unit.unitId)).toEqual(before);
      expect(await auditsFor(unit.unitId)).toHaveLength(2);
    });

    it("names every non-placeable id in the refusal", async () => {
      const unit = await createUnit(w);
      const details = await expectCode(
        setResources(w, w.teacher, {
          unitId: unit.unitId,
          expectedRevision: 1,
          resourceIds: [GATED_LESSON, LESSON_A, TOOL],
        }),
        "teacherUnits.resourceNotPlaceable",
      );
      expect(details).toMatchObject({ resourceIds: [GATED_LESSON, TOOL] });
    });

    it("allows one resource in several units (no cross-unit uniqueness)", async () => {
      const first = await createUnit(w, "First");
      const second = await createUnit(w, "Second");
      const coTeacherUnit = await createUnit(w, "Co-teacher", "7", w.otherTeacher);
      for (const [uid, unitId] of [
        [w.teacher, first.unitId],
        [w.teacher, second.unitId],
        [w.otherTeacher, coTeacherUnit.unitId],
      ] as const) {
        await setResources(w, uid, { unitId, expectedRevision: 1, resourceIds: [GRAVITY_WELLS, LESSON_A] });
      }
      for (const unitId of [first.unitId, second.unitId, coTeacherUnit.unitId]) {
        expect((await unitData(unitId))?.resourceIds).toEqual([GRAVITY_WELLS, LESSON_A]);
      }
    });

    it("refuses an archived unit, and archive and restore preserve membership and ordering", async () => {
      const unit = await createUnit(w);
      await setResources(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, resourceIds: [LESSON_B, LESSON_A] });
      await reorder(w, w.teacher, { grade: "7", units: [{ unitId: unit.unitId, expectedRevision: 2 }] });
      await archive(w, w.teacher, { unitId: unit.unitId, expectedRevision: 3 });
      await expectCode(
        setResources(w, w.teacher, { unitId: unit.unitId, expectedRevision: 4, resourceIds: [LESSON_A] }),
        "teacherUnits.invalidStatus",
      );
      expect(await unitData(unit.unitId)).toMatchObject({ status: "archived", revision: 4, resourceIds: [LESSON_B, LESSON_A], sortOrder: 1 });
      const restored = await restore(w, w.teacher, { unitId: unit.unitId, expectedRevision: 4 });
      expect(restored.unit).toMatchObject({
        unitId: unit.unitId,
        status: "active",
        resourceIds: [LESSON_B, LESSON_A],
        sortOrder: 1,
        revision: 5,
      });
    });

    it("is a no-op for the stored list, even at a stale revision, and conflicts on a real change", async () => {
      const unit = await createUnit(w);
      await setResources(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, resourceIds: [LESSON_A, LESSON_B] });
      const noop = await setResources(w, w.teacher, {
        unitId: unit.unitId,
        expectedRevision: 1,
        resourceIds: [LESSON_A, LESSON_B],
      });
      expect(noop).toMatchObject({ noop: true, unit: { revision: 2 } });
      const details = await expectCode(
        setResources(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, resourceIds: [LESSON_B, LESSON_A] }),
        "teacherUnits.writeConflict",
      );
      expect(details).toMatchObject({ currentRevision: 2 });
      expect(await unitData(unit.unitId)).toMatchObject({ resourceIds: [LESSON_A, LESSON_B], revision: 2 });
      expect(await auditsFor(unit.unitId)).toHaveLength(2);
    });

    it("accepts exactly one of several simultaneous membership edits at the same revision", async () => {
      const unit = await createUnit(w);
      const lists = [[LESSON_A], [LESSON_B], [GRAVITY_WELLS], [LESSON_A, LESSON_B], [LESSON_B, GRAVITY_WELLS]];
      const settled = await Promise.allSettled(
        lists.map((resourceIds) => setResources(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, resourceIds })),
      );
      const accepted = settled.filter(
        (s): s is PromiseFulfilledResult<Awaited<ReturnType<typeof setResources>>> => s.status === "fulfilled",
      );
      expect(accepted).toHaveLength(1);
      for (const s of settled.filter((x): x is PromiseRejectedResult => x.status === "rejected")) {
        expect((s.reason as { code?: unknown }).code).toBe("teacherUnits.writeConflict");
      }
      const stored = await unitData(unit.unitId);
      expect(stored).toMatchObject({ revision: 2, resourceIds: accepted[0].value.unit.resourceIds });
      expect((await auditsFor(unit.unitId)).filter((a) => a.action === "teacherUnits.resourcesUpdated")).toHaveLength(1);
    });

    it("turns an identical concurrent membership edit into one write and one authorized no-op", async () => {
      const unit = await createUnit(w);
      const results = await Promise.all(
        [1, 2].map(() =>
          setResources(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, resourceIds: [LESSON_A, LESSON_B] }),
        ),
      );
      expect(results.map((r) => r.noop).sort()).toEqual([false, true]);
      expect(await unitData(unit.unitId)).toMatchObject({ revision: 2, resourceIds: [LESSON_A, LESSON_B] });
      expect((await auditsFor(unit.unitId)).filter((a) => a.action === "teacherUnits.resourcesUpdated")).toHaveLength(1);
    });

    it("serializes a simultaneous membership edit and archive at the same revision", async () => {
      const unit = await createUnit(w);
      const settled = await Promise.allSettled([
        setResources(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, resourceIds: [LESSON_A] }),
        archive(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1 }),
      ]);
      expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
      const stored = await unitData(unit.unitId);
      expect(stored?.revision).toBe(2);
      if (settled[0].status === "fulfilled") {
        expect(stored).toMatchObject({ status: "active", resourceIds: [LESSON_A] });
      } else {
        expect(stored).toMatchObject({ status: "archived", resourceIds: [] });
      }
    });

    it("hides another teacher's unit and refuses non-teachers", async () => {
      const unit = await createUnit(w);
      await expectCode(
        setResources(w, w.otherTeacher, { unitId: unit.unitId, expectedRevision: 1, resourceIds: [LESSON_A] }),
        "teacherUnits.notFound",
      );
      await expectCode(
        setResources(w, w.crossSchoolTeacher, { unitId: unit.unitId, expectedRevision: 1, resourceIds: [LESSON_A] }),
        "teacherUnits.notFound",
      );
      await expectCode(
        setResources(w, w.student, { unitId: unit.unitId, expectedRevision: 1, resourceIds: [LESSON_A] }),
        "role-forbidden",
      );
      expect(await unitData(unit.unitId)).toMatchObject({ resourceIds: [], revision: 1 });
    });

    it("rejects server-owned fields beside resourceIds", async () => {
      const unit = await createUnit(w);
      for (const field of ["teacherId", "schoolId", "grade", "sortOrder", "revision", "status"]) {
        await expectCode(
          setResources(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, resourceIds: [LESSON_A], [field]: "x" }),
          "teacherUnits.invalidRequest",
        );
      }
      // U1A operations still refuse membership and ordering fields.
      await expectCode(
        update(w, w.teacher, { unitId: unit.unitId, expectedRevision: 1, title: "x", resourceIds: [LESSON_A] }),
        "teacherUnits.invalidRequest",
      );
      expect(await unitData(unit.unitId)).toMatchObject({ resourceIds: [], revision: 1 });
    });

    it.each(REVOCATIONS)("refuses after %s and writes nothing", async (_label, revoke, code) => {
      const unit = await createUnit(w);
      const before = await unitData(unit.unitId);
      const actor = actorOf();
      await revoke(w);
      await expectCode(
        mutateOwnedTeacherUnit(actor, unit.unitId, 1, () => ({
          fields: { resourceIds: [LESSON_A] },
          action: "teacherUnits.resourcesUpdated",
          changedFields: ["resourceIds"],
        })),
        code,
      );
      expect(await unitData(unit.unitId)).toEqual(before);
      expect(await auditsFor(unit.unitId)).toHaveLength(1);
    });
  });

  describe("U1B unit ordering", () => {
    async function seedOrganization(): Promise<{ a: string; b: string; c: string }> {
      const a = (await createUnit(w, "A")).unitId;
      const b = (await createUnit(w, "B")).unitId;
      const c = (await createUnit(w, "C")).unitId;
      return { a, b, c };
    }
    const at = (unitId: string, expectedRevision = 1) => ({ unitId, expectedRevision });

    it("orders the grade organization, writing and auditing only moved units", async () => {
      const { a, b, c } = await seedOrganization();
      const first = await reorder(w, w.teacher, { grade: "7", units: [at(c), at(a), at(b)] });
      expect(first.noop).toBe(false);
      expect(first.units.map((u) => [u.unitId, u.sortOrder, u.revision])).toEqual([
        [c, 1, 2],
        [a, 2, 2],
        [b, 3, 2],
      ]);
      expect((await list(w, w.teacher, { grade: "7" })).units.map((u) => u.unitId)).toEqual([c, a, b]);

      // Swap the last two; `c` keeps position 1 and is not written.
      const second = await reorder(w, w.teacher, { grade: "7", units: [at(c, 2), at(b, 2), at(a, 2)] });
      expect(second.units.map((u) => [u.unitId, u.sortOrder, u.revision])).toEqual([
        [c, 1, 2],
        [b, 2, 3],
        [a, 3, 3],
      ]);
      const reorderedAudits = async (id: string) =>
        (await auditsFor(id)).filter((x) => x.action === "teacherUnits.reordered");
      expect(await reorderedAudits(c)).toHaveLength(1);
      expect(await reorderedAudits(a)).toHaveLength(2);
      expect((await reorderedAudits(b)).map((x) => x.payload)).toEqual(
        expect.arrayContaining([
          { grade: "7", previousRevision: 2, revision: 3, previousSortOrder: 3, sortOrder: 2 },
        ]),
      );
      expect(await unitData(a)).toMatchObject({ title: "A", resourceIds: [], status: "active" });
    });

    it("is a no-op when the order already holds, even at stale revisions", async () => {
      const { a, b, c } = await seedOrganization();
      await reorder(w, w.teacher, { grade: "7", units: [at(a), at(b), at(c)] });
      const noop = await reorder(w, w.teacher, { grade: "7", units: [at(a), at(b), at(c)] });
      expect(noop.noop).toBe(true);
      expect(noop.units.map((u) => u.revision)).toEqual([2, 2, 2]);
    });

    it("refuses a stale revision and an incomplete organization, writing nothing", async () => {
      const { a, b, c } = await seedOrganization();
      await update(w, w.teacher, { unitId: b, expectedRevision: 1, title: "B2" });
      const before = await Promise.all([a, b, c].map(unitData));
      const details = await expectCode(
        reorder(w, w.teacher, { grade: "7", units: [at(c), at(b), at(a)] }),
        "teacherUnits.writeConflict",
      );
      expect(details).toMatchObject({ unitId: b, currentRevision: 2 });
      await expectCode(
        reorder(w, w.teacher, { grade: "7", units: [at(c), at(a)] }),
        "teacherUnits.writeConflict",
      );
      expect(await Promise.all([a, b, c].map(unitData))).toEqual(before);
    });

    it.each(["other teacher", "other grade", "archived", "missing"])(
      "refuses a %s unit with the uniform notFound",
      async (kind) => {
        const { a, b, c } = await seedOrganization();
        let extra: string;
        if (kind === "other teacher") extra = (await createUnit(w, "X", "7", w.otherTeacher)).unitId;
        else if (kind === "other grade") extra = (await createUnit(w, "X", "6")).unitId;
        else if (kind === "archived") {
          extra = (await createUnit(w, "X")).unitId;
          await archive(w, w.teacher, { unitId: extra, expectedRevision: 1 });
        } else extra = "A".repeat(20);
        await expectCode(
          reorder(w, w.teacher, { grade: "7", units: [at(c), at(b), at(a), at(extra)] }),
          "teacherUnits.notFound",
        );
        expect((await Promise.all([a, b, c].map(unitData))).map((u) => u?.sortOrder)).toEqual([0, 0, 0]);
      },
    );

    it("keeps co-teacher and per-grade organizations independent", async () => {
      const { a, b } = { a: (await createUnit(w, "A")).unitId, b: (await createUnit(w, "B")).unitId };
      const grade6 = (await createUnit(w, "G6", "6")).unitId;
      const coA = (await createUnit(w, "CoA", "7", w.otherTeacher)).unitId;
      const coB = (await createUnit(w, "CoB", "7", w.otherTeacher)).unitId;
      await reorder(w, w.teacher, { grade: "7", units: [at(b), at(a)] });
      await reorder(w, w.otherTeacher, { grade: "7", units: [at(coA), at(coB)] });
      expect((await list(w, w.teacher, { grade: "7" })).units.map((u) => u.unitId)).toEqual([b, a]);
      expect((await list(w, w.otherTeacher, { grade: "7" })).units.map((u) => u.unitId)).toEqual([coA, coB]);
      expect(await unitData(grade6)).toMatchObject({ sortOrder: 0, revision: 1 });
    });

    it("never writes archived units; a restored unit keeps its preserved position", async () => {
      const { a, b, c } = await seedOrganization();
      await reorder(w, w.teacher, { grade: "7", units: [at(c), at(b), at(a)] });
      await archive(w, w.teacher, { unitId: b, expectedRevision: 2 });
      const archivedBefore = await unitData(b);
      await reorder(w, w.teacher, { grade: "7", units: [at(a, 2), at(c, 2)] });
      expect(await unitData(b)).toEqual(archivedBefore);
      await restore(w, w.teacher, { unitId: b, expectedRevision: 3 });
      // a=1, c=2, and b keeps its preserved 2, tying with c; b was created
      // first, so the canonical tie-break places it ahead of c.
      expect((await list(w, w.teacher, { grade: "7" })).units.map((u) => [u.unitId, u.sortOrder])).toEqual([
        [a, 1],
        [b, 2],
        [c, 2],
      ]);
    });

    it("sorts a unit created after the last reorder first, until it is placed", async () => {
      const { a, b, c } = await seedOrganization();
      await reorder(w, w.teacher, { grade: "7", units: [at(a), at(b), at(c)] });
      const d4 = (await createUnit(w, "D")).unitId;
      expect((await list(w, w.teacher, { grade: "7" })).units.map((u) => u.unitId)).toEqual([d4, a, b, c]);
      await expectCode(
        reorder(w, w.teacher, { grade: "7", units: [at(a, 2), at(b, 2), at(c, 2)] }),
        "teacherUnits.writeConflict",
      );
      await reorder(w, w.teacher, { grade: "7", units: [at(a, 2), at(b, 2), at(c, 2), at(d4)] });
      expect((await list(w, w.teacher, { grade: "7" })).units.map((u) => u.unitId)).toEqual([a, b, c, d4]);
    });

    it("accepts exactly one of several simultaneous conflicting reorders", async () => {
      const { a, b, c } = await seedOrganization();
      const orders = [
        [c, b, a],
        [b, c, a],
        [b, a, c],
        [c, a, b],
      ];
      const settled = await Promise.allSettled(
        orders.map((order) => reorder(w, w.teacher, { grade: "7", units: order.map((id) => at(id)) })),
      );
      const accepted = settled
        .map((s, i) => ({ s, order: orders[i] }))
        .filter((x) => x.s.status === "fulfilled");
      expect(accepted).toHaveLength(1);
      for (const s of settled.filter((x): x is PromiseRejectedResult => x.status === "rejected")) {
        expect((s.reason as { code?: unknown }).code).toBe("teacherUnits.writeConflict");
      }
      expect((await list(w, w.teacher, { grade: "7" })).units.map((u) => u.unitId)).toEqual(accepted[0].order);
      const stored = await Promise.all([a, b, c].map(unitData));
      expect(new Set(stored.map((u) => u?.sortOrder))).toEqual(new Set([1, 2, 3]));
      expect(stored.every((u) => u?.revision === 2)).toBe(true);
    });

    it("turns identical concurrent reorders into one write and one authorized no-op", async () => {
      const { a, b, c } = await seedOrganization();
      const results = await Promise.all(
        [1, 2].map(() => reorder(w, w.teacher, { grade: "7", units: [at(c), at(b), at(a)] })),
      );
      expect(results.map((r) => r.noop).sort()).toEqual([false, true]);
      expect((await Promise.all([a, b, c].map(unitData))).map((u) => [u?.sortOrder, u?.revision])).toEqual([
        [3, 2],
        [2, 2],
        [1, 2],
      ]);
    });

    it("lets independent operations both succeed: reorders of two grades and a create in a third", async () => {
      const g7 = [(await createUnit(w, "A")).unitId, (await createUnit(w, "B")).unitId];
      const g6 = [(await createUnit(w, "C", "6")).unitId, (await createUnit(w, "D", "6")).unitId];
      const [r7, r6, created] = await Promise.all([
        reorder(w, w.teacher, { grade: "7", units: [at(g7[1]), at(g7[0])] }),
        reorder(w, w.teacher, { grade: "6", units: [at(g6[1]), at(g6[0])] }),
        createUnit(w, "New", "8"),
      ]);
      expect([r7.noop, r6.noop]).toEqual([false, false]);
      expect(await unitData(created.unitId)).toMatchObject({ sortOrder: 0, revision: 1 });
      expect((await unitData(g6[1]))?.sortOrder).toBe(1);
    });

    it("refuses a reorder whose organization gained a same-grade unit before the reorder began (sequential, fails closed, no write)", async () => {
      const { a, b } = { a: (await createUnit(w, "A")).unitId, b: (await createUnit(w, "B")).unitId };
      await createUnit(w, "Concurrent");
      await expectCode(
        reorder(w, w.teacher, { grade: "7", units: [at(b), at(a)] }),
        "teacherUnits.writeConflict",
      );
      expect((await Promise.all([a, b].map(unitData))).map((u) => [u?.sortOrder, u?.revision])).toEqual([
        [0, 1],
        [0, 1],
      ]);
    });

    it("serializes a genuinely concurrent same-grade create and reorder into one valid outcome", async () => {
      const { a, b } = { a: (await createUnit(w, "A")).unitId, b: (await createUnit(w, "B")).unitId };
      const [reordered, created] = await Promise.allSettled([
        reorder(w, w.teacher, { grade: "7", units: [at(b), at(a)] }),
        createUnit(w, "Racing"),
      ]);
      // The create never conflicts with a reorder.
      expect(created.status).toBe("fulfilled");
      const newId = (created as PromiseFulfilledResult<{ unitId: string }>).value.unitId;
      expect(await unitData(newId)).toMatchObject({ sortOrder: 0, revision: 1 });
      const stored = await Promise.all([a, b].map(unitData));
      if (reordered.status === "fulfilled") {
        // Reorder serialized first: it ordered the two units it named.
        expect(stored.map((u) => [u?.sortOrder, u?.revision])).toEqual([[2, 2], [1, 2]]);
      } else {
        // Create serialized first: the reorder no longer named the whole
        // organization and wrote nothing.
        expect((reordered.reason as { code?: unknown }).code).toBe("teacherUnits.writeConflict");
        expect(stored.map((u) => [u?.sortOrder, u?.revision])).toEqual([[0, 1], [0, 1]]);
      }
    });

    it("lets an edit to an unmoved unit succeed alongside a reorder", async () => {
      const { a, b, c } = await seedOrganization();
      await reorder(w, w.teacher, { grade: "7", units: [at(a), at(b), at(c)] });
      // Swap b and c; a stays at position 1 and is not written by the reorder.
      const settled = await Promise.allSettled([
        reorder(w, w.teacher, { grade: "7", units: [at(a, 2), at(c, 2), at(b, 2)] }),
        update(w, w.teacher, { unitId: a, expectedRevision: 2, title: "A renamed" }),
      ]);
      const [reorderResult, renameResult] = settled;
      expect(renameResult.status).toBe("fulfilled");
      // The reorder compares every named revision, so it succeeds only if it
      // serialized before the rename; it never overwrites the rename.
      const storedA = await unitData(a);
      expect(storedA).toMatchObject({ title: "A renamed", sortOrder: 1, revision: 3 });
      if (reorderResult.status === "fulfilled") {
        expect((await list(w, w.teacher, { grade: "7" })).units.map((u) => u.unitId)).toEqual([a, c, b]);
      } else {
        expect((reorderResult.reason as { code?: unknown }).code).toBe("teacherUnits.writeConflict");
      }
    });

    it("serializes a reorder and a membership edit at the same revision", async () => {
      const { a, b } = { a: (await createUnit(w, "A")).unitId, b: (await createUnit(w, "B")).unitId };
      const settled = await Promise.allSettled([
        reorder(w, w.teacher, { grade: "7", units: [at(b), at(a)] }),
        setResources(w, w.teacher, { unitId: b, expectedRevision: 1, resourceIds: [LESSON_A] }),
      ]);
      expect(settled.filter((s) => s.status === "fulfilled")).toHaveLength(1);
      const storedB = await unitData(b);
      expect(storedB?.revision).toBe(2);
      if (settled[0].status === "fulfilled") {
        expect(storedB).toMatchObject({ sortOrder: 1, resourceIds: [] });
        expect(await unitData(a)).toMatchObject({ sortOrder: 2, revision: 2 });
      } else {
        expect(storedB).toMatchObject({ sortOrder: 0, resourceIds: [LESSON_A] });
        expect(await unitData(a)).toMatchObject({ sortOrder: 0, revision: 1 });
      }
    });

    it.each([
      ["an empty list", []],
      ["a duplicate unit", "dup"],
      ["a malformed entry", [{ unitId: "A".repeat(20) }]],
    ])("rejects %s before any read", async (_label, units) => {
      const { a } = { a: (await createUnit(w, "A")).unitId };
      const payload = units === "dup" ? [at(a), at(a)] : units;
      await expect(reorder(w, w.teacher, { grade: "7", units: payload })).rejects.toBeDefined();
      expect(await unitData(a)).toMatchObject({ sortOrder: 0, revision: 1 });
    });

    it.each(REVOCATIONS)("refuses after %s and writes nothing", async (_label, revoke, code) => {
      const { a, b, c } = await seedOrganization();
      const before = await Promise.all([a, b, c].map(unitData));
      const actor = actorOf();
      await revoke(w);
      await expectCode(
        reorderTeacherUnits(actor, { grade: "7", units: [at(c), at(b), at(a)] }),
        code,
      );
      expect(await Promise.all([a, b, c].map(unitData))).toEqual(before);
    });

    it("refuses the response, not the write, after a post-commit revocation", async () => {
      const { a, b } = { a: (await createUnit(w, "A")).unitId, b: (await createUnit(w, "B")).unitId };
      await expectCode(
        reorderTeacherUnits(
          actorOf(),
          { grade: "7", units: [at(b), at(a)] },
          { afterCommit: async () => { await db.doc(`users/${w.teacher}`).update({ status: "suspended" }); } },
        ),
        "account-inactive",
      );
      expect(await unitData(b)).toMatchObject({ sortOrder: 1, revision: 2 });
    });
  });
});
