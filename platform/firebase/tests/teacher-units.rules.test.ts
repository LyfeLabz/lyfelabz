import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";

import { createTestEnvironment } from "./setup";

// Rules tests for `teacherUnits/{unitId}`, the server-only
// `teacherUnitCreateReceipts/{receiptId}`, and every other Firestore path
// the A3-3 `teacherUnits*` callables read or write.
//
// Access model (A3-5 callable-only): every direct client read and write is
// denied for every role, including the owning active teacher. The
// `teacherUnits*` callables are the sole readers and writers (Admin SDK),
// so every management read passes the A3-3 transactional availability and
// release-authority enforcement. Before A3-5 the owning active teacher could
// get/list their own units directly; those cases are kept below as denials.

const OWNER_UID = "teacher-owner-uid";
const OTHER_TEACHER_UID = "teacher-other-uid";
const STUDENT_UID = "student-uid";
const OTHER_SCHOOL_TEACHER_UID = "teacher-other-school-uid";
const ADMIN_UID = "platform-admin-uid";
const SCHOOL_ID = "school-a";
const OTHER_SCHOOL_ID = "school-b";
const UNIT_ID = "unitOwnerAAAAAAAAAAA";
const OWNER_OTHER_SCHOOL_UNIT_ID = "unitOwnerOldSchoolAA";
const OTHER_TEACHER_UNIT_ID = "unitOtherTeacherAAAA";

function userDoc(uid: string, overrides: Record<string, unknown> = {}) {
  return {
    authUid: uid,
    status: "active",
    role: "teacher",
    schoolId: SCHOOL_ID,
    displayName: "Teacher",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides,
  };
}

function unitDoc(teacherId: string, schoolId: string, title = "Earth Systems") {
  return {
    teacherId,
    schoolId,
    grade: "7",
    title,
    description: "",
    status: "active",
    archivedAt: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    resourceIds: [],
    sortOrder: 0,
    revision: 1,
  };
}

// The second source is a synthetic local copy matching the documented kind of
// drift. It is not captured deployed Rules or owner-approved equivalence proof.
describe.each(["repository", "synthetic-missing-explicit-unit-denies"] as const)("Firestore Rules: teacherUnits/{unitId} (%s)", (sourceKind) => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    if (sourceKind === "repository") {
      testEnv = await createTestEnvironment();
    } else {
      const original = readFileSync(resolve(__dirname, "..", "firestore.rules"), "utf8");
      let synthetic = original;
      for (const block of [
        "    match /teacherUnits/{unitId} {\n      allow read, write: if false;\n    }",
        "    match /teacherUnitCreateReceipts/{receiptId} {\n      allow read, write: if false;\n    }",
      ]) {
        if (!synthetic.includes(block)) throw new Error("Expected explicit deny block missing from local source");
        synthetic = synthetic.replace(block, "");
      }
      if (!synthetic.includes("match /{document=**}")) throw new Error("Terminal default-deny must remain");
      const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
      if (host !== "127.0.0.1" && host !== "localhost") throw new Error("Local emulator required");
      testEnv = await initializeTestEnvironment({
        projectId: "lyfelabz-rules-test",
        firestore: { host, port: Number(port), rules: synthetic },
      });
    }
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      await setDoc(doc(db, "users", OWNER_UID), userDoc(OWNER_UID));
      await setDoc(doc(db, "users", OTHER_TEACHER_UID), userDoc(OTHER_TEACHER_UID));
      await setDoc(doc(db, "users", STUDENT_UID), userDoc(STUDENT_UID, { role: "student" }));
      await setDoc(
        doc(db, "users", OTHER_SCHOOL_TEACHER_UID),
        userDoc(OTHER_SCHOOL_TEACHER_UID, { schoolId: OTHER_SCHOOL_ID }),
      );
      await setDoc(
        doc(db, "users", ADMIN_UID),
        userDoc(ADMIN_UID, { role: "platformAdministrator" }),
      );
      await setDoc(doc(db, "teacherUnits", UNIT_ID), unitDoc(OWNER_UID, SCHOOL_ID));
      // A unit the owner created at a previous school (the owner has since
      // moved to SCHOOL_ID).
      await setDoc(
        doc(db, "teacherUnits", OWNER_OTHER_SCHOOL_UNIT_ID),
        unitDoc(OWNER_UID, OTHER_SCHOOL_ID, "Old School Unit"),
      );
      await setDoc(
        doc(db, "teacherUnits", OTHER_TEACHER_UNIT_ID),
        unitDoc(OTHER_TEACHER_UID, SCHOOL_ID, "Other Teacher Unit"),
      );
    });
  });

  async function setOwnerRecord(overrides: Record<string, unknown>): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", OWNER_UID), userDoc(OWNER_UID, overrides));
    });
  }

  function ownQuery(db: ReturnType<ReturnType<RulesTestEnvironment["authenticatedContext"]>["firestore"]>) {
    return query(
      collection(db, "teacherUnits"),
      where("teacherId", "==", OWNER_UID),
      where("schoolId", "==", SCHOOL_ID),
    );
  }

  describe("get", () => {
    // A3-5: previously allowed. The owner must read through
    // `teacherUnitsGet` / `teacherUnitsList`.
    it("denies the owning active teacher getting their own unit (A3-5 callable-only)", async () => {
      const db = testEnv
        .authenticatedContext(OWNER_UID, { role: "teacher", schoolId: SCHOOL_ID })
        .firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies another teacher in the same school", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies the owner a unit from a school that is no longer theirs", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", OWNER_OTHER_SCHOOL_UNIT_ID)));
    });

    it("denies a suspended owner holding a stale teacher token", async () => {
      await setOwnerRecord({ status: "suspended" });
      const db = testEnv
        .authenticatedContext(OWNER_UID, { role: "teacher", schoolId: SCHOOL_ID })
        .firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies an owner whose canonical role is no longer teacher", async () => {
      await setOwnerRecord({ role: "platformAdministrator" });
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies an owner with no canonical user record", async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await deleteDoc(doc(ctx.firestore(), "users", OWNER_UID));
      });
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies a student", async () => {
      const db = testEnv.authenticatedContext(STUDENT_UID).firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies an unauthenticated caller", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "teacherUnits", UNIT_ID)));
    });
  });

  describe("list", () => {
    // A3-5: previously allowed (the admissible scoped query).
    it("denies the owner listing own units scoped by teacherId and schoolId (A3-5 callable-only)", async () => {
      const db = testEnv
        .authenticatedContext(OWNER_UID, { role: "teacher", schoolId: SCHOOL_ID })
        .firestore();
      await assertFails(getDocs(ownQuery(db)));
    });

    it("denies a list scoped only by teacherId (could include another school's units)", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        getDocs(query(collection(db, "teacherUnits"), where("teacherId", "==", OWNER_UID))),
      );
    });

    it("denies an unscoped collection list", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDocs(collection(db, "teacherUnits")));
    });

    it("denies a list scoped only by schoolId (would enumerate other teachers)", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        getDocs(query(collection(db, "teacherUnits"), where("schoolId", "==", SCHOOL_ID))),
      );
    });

    it("denies a teacher listing another teacher's units", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(getDocs(ownQuery(db)));
    });

    it("denies a list of the owner's units at another school", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "teacherUnits"),
            where("teacherId", "==", OWNER_UID),
            where("schoolId", "==", OTHER_SCHOOL_ID),
          ),
        ),
      );
    });

    it("denies a suspended owner from listing", async () => {
      await setOwnerRecord({ status: "suspended" });
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDocs(ownQuery(db)));
    });

    it("denies an unauthenticated list", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDocs(ownQuery(db)));
    });
  });

  describe("direct client writes", () => {
    it("denies the owner creating a unit", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        setDoc(doc(db, "teacherUnits", "unitNewAAAAAAAAAAAAA"), unitDoc(OWNER_UID, SCHOOL_ID)),
      );
    });

    it("denies the owner updating their own unit (title)", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(updateDoc(doc(db, "teacherUnits", UNIT_ID), { title: "Renamed" }));
    });

    it("denies the owner updating identity fields", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(updateDoc(doc(db, "teacherUnits", UNIT_ID), { teacherId: OTHER_TEACHER_UID }));
      await assertFails(updateDoc(doc(db, "teacherUnits", UNIT_ID), { grade: "8" }));
      await assertFails(updateDoc(doc(db, "teacherUnits", UNIT_ID), { revision: 99 }));
    });

    // U1B: membership and ordering are written only by
    // `teacherUnitsSetResources` and `teacherUnitsReorder`.
    it("denies the owner writing resource membership or ordering directly", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        updateDoc(doc(db, "teacherUnits", UNIT_ID), { resourceIds: ["simulation-gravity-wells"] }),
      );
      await assertFails(updateDoc(doc(db, "teacherUnits", UNIT_ID), { resourceIds: ["not-a-resource"] }));
      await assertFails(updateDoc(doc(db, "teacherUnits", UNIT_ID), { sortOrder: 3 }));
      await assertFails(
        updateDoc(doc(db, "teacherUnits", UNIT_ID), { sortOrder: 1, revision: 2, resourceIds: [] }),
      );
    });

    it("denies another teacher writing membership or ordering of the owner's unit", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(updateDoc(doc(db, "teacherUnits", UNIT_ID), { resourceIds: ["earths-layers"] }));
      await assertFails(updateDoc(doc(db, "teacherUnits", UNIT_ID), { sortOrder: 1 }));
    });

    it("denies the owner deleting their own unit", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(deleteDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies another teacher writing the owner's unit", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(updateDoc(doc(db, "teacherUnits", UNIT_ID), { title: "Hijacked" }));
      await assertFails(deleteDoc(doc(db, "teacherUnits", UNIT_ID)));
    });

    it("denies unauthenticated writes", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        setDoc(doc(db, "teacherUnits", "unitNewAAAAAAAAAAAAA"), unitDoc(OWNER_UID, SCHOOL_ID)),
      );
      await assertFails(deleteDoc(doc(db, "teacherUnits", UNIT_ID)));
    });
  });

  describe("teacherUnitCreateReceipts/{receiptId} (server-only)", () => {
    const RECEIPT_ID = "a".repeat(64);

    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        await setDoc(doc(ctx.firestore(), "teacherUnitCreateReceipts", RECEIPT_ID), {
          teacherId: OWNER_UID,
          schoolId: SCHOOL_ID,
          unitId: UNIT_ID,
          requestHash: "b".repeat(64),
          createdAt: new Date("2026-10-01T00:00:00Z"),
          expiresAt: new Date("2026-10-08T00:00:00Z"),
        });
      });
    });

    it("denies the owning teacher reading or listing their own receipt", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDoc(doc(db, "teacherUnitCreateReceipts", RECEIPT_ID)));
      await assertFails(
        getDocs(query(collection(db, "teacherUnitCreateReceipts"), where("teacherId", "==", OWNER_UID))),
      );
    });

    it("denies every client write, including the owner", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        setDoc(doc(db, "teacherUnitCreateReceipts", "c".repeat(64)), {
          teacherId: OWNER_UID,
          schoolId: SCHOOL_ID,
          unitId: UNIT_ID,
        }),
      );
      await assertFails(updateDoc(doc(db, "teacherUnitCreateReceipts", RECEIPT_ID), { unitId: "x" }));
      await assertFails(deleteDoc(doc(db, "teacherUnitCreateReceipts", RECEIPT_ID)));
    });

    it("denies unauthenticated access", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "teacherUnitCreateReceipts", RECEIPT_ID)));
    });
  });

  // A3-5 callable-only matrix: every role, every operation, every Teacher
  // Units path the A3-3 callables touch, plus nested and collection-group
  // access. Seeded documents exist so a denial is a Rules decision, not a
  // missing document.
  describe("A3-5 callable-only matrix", () => {
    const HEX = "d".repeat(64);
    const HEX2 = "e".repeat(64);
    const AUDIT_ID = "auditTeacherUnitAAAA";

    type Caller = {
      readonly name: string;
      readonly ctx: () => ReturnType<RulesTestEnvironment["unauthenticatedContext"]>;
    };
    const callers: readonly Caller[] = [
      { name: "unauthenticated", ctx: () => testEnv.unauthenticatedContext() },
      {
        name: "owning active teacher",
        ctx: () => testEnv.authenticatedContext(OWNER_UID, { role: "teacher", schoolId: SCHOOL_ID }),
      },
      {
        name: "other teacher, same school",
        ctx: () =>
          testEnv.authenticatedContext(OTHER_TEACHER_UID, { role: "teacher", schoolId: SCHOOL_ID }),
      },
      {
        name: "teacher, different school",
        ctx: () =>
          testEnv.authenticatedContext(OTHER_SCHOOL_TEACHER_UID, {
            role: "teacher",
            schoolId: OTHER_SCHOOL_ID,
          }),
      },
      {
        name: "suspended owner with stale teacher token",
        ctx: () => testEnv.authenticatedContext(OWNER_UID, { role: "teacher", schoolId: SCHOOL_ID }),
      },
      {
        name: "student",
        ctx: () => testEnv.authenticatedContext(STUDENT_UID, { role: "student", schoolId: SCHOOL_ID }),
      },
      {
        name: "platform administrator",
        ctx: () =>
          testEnv.authenticatedContext(ADMIN_UID, { role: "platformAdministrator", schoolId: SCHOOL_ID }),
      },
    ];

    // [collection path, seeded document id]
    const paths: ReadonlyArray<readonly [string, string]> = [
      ["teacherUnits", UNIT_ID],
      ["teacherUnitCreateReceipts", HEX],
      ["auditEvents", AUDIT_ID],
      ["platformConfig", "teacherUnitsAvailability"],
      ["teacherUnitsBackendReleases", HEX],
      ["teacherUnitsReleaseEvidence", HEX],
      ["teacherUnitsAvailabilityHistory", "00000000-0000-4000-8000-000000000001"],
      ["unmatchedOptionBDefaultDeny", "probe"],
      ["teacherUnits/" + UNIT_ID + "/revisions", "r1"],
      ["teacherUnits/" + UNIT_ID + "/anything", "x1"],
    ];

    beforeEach(async () => {
      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        const owned = { teacherId: OWNER_UID, schoolId: SCHOOL_ID };
        await setDoc(doc(db, "teacherUnitCreateReceipts", HEX), { ...owned, unitId: UNIT_ID });
        await setDoc(doc(db, "auditEvents", AUDIT_ID), {
          ...owned,
          actorUid: OWNER_UID,
          action: "teacherUnits.created",
          targetId: UNIT_ID,
        });
        await setDoc(doc(db, "platformConfig", "teacherUnitsAvailability"), {
          schemaVersion: 1,
          state: "closed",
        });
        await setDoc(doc(db, "teacherUnitsBackendReleases", HEX), { ...owned, releaseId: HEX });
        await setDoc(doc(db, "teacherUnitsReleaseEvidence", HEX), { ...owned, kind: "teacher-units-activation" });
        await setDoc(doc(db, "teacherUnitsAvailabilityHistory", "00000000-0000-4000-8000-000000000001"), {
          schemaVersion: 2, command: "close", generation: 2, ...owned,
        });
        await setDoc(doc(db, "unmatchedOptionBDefaultDeny", "probe"), { serverOnly: true });
        await setDoc(doc(db, "teacherUnits", UNIT_ID, "revisions", "r1"), { ...owned, revision: 1 });
        await setDoc(doc(db, "teacherUnits", UNIT_ID, "anything", "x1"), owned);
      });
    });

    for (const caller of callers) {
      describe(caller.name, () => {
        beforeEach(async () => {
          if (caller.name.startsWith("suspended")) await setOwnerRecord({ status: "suspended" });
        });

        for (const [path, id] of paths) {
          it(`denies get, list, create, update and delete on ${path}`, async () => {
            const db = caller.ctx().firestore();
            const col = collection(db, path);
            await assertFails(getDoc(doc(col, id)));
            await assertFails(getDocs(col));
            await assertFails(getDocs(query(col, where("teacherId", "==", OWNER_UID))));
            await assertFails(
              getDocs(
                query(col, where("teacherId", "==", OWNER_UID), where("schoolId", "==", SCHOOL_ID)),
              ),
            );
            await assertFails(setDoc(doc(col, HEX2), { teacherId: OWNER_UID, schoolId: SCHOOL_ID }));
            await assertFails(setDoc(doc(col, id), { teacherId: OWNER_UID, schoolId: SCHOOL_ID }));
            await assertFails(updateDoc(doc(col, id), { schoolId: SCHOOL_ID, title: "x" }));
            await assertFails(deleteDoc(doc(col, id)));
          });
        }

        it("keeps existing own-profile access independent of server-only Option B records", async () => {
          const db = caller.ctx().firestore();
          const ownUid = caller.name === "unauthenticated" ? null :
            caller.name.startsWith("suspended") || caller.name === "owning active teacher" ? OWNER_UID :
            caller.name === "other teacher, same school" ? OTHER_TEACHER_UID :
            caller.name === "teacher, different school" ? OTHER_SCHOOL_TEACHER_UID :
            caller.name === "student" ? STUDENT_UID : ADMIN_UID;
          if (ownUid === null) await assertFails(getDoc(doc(db, "users", OWNER_UID)));
          else await assertSucceeds(getDoc(doc(db, "users", ownUid)));
        });

        it("denies collection-group queries over every Teacher Units collection", async () => {
          const db = caller.ctx().firestore();
          for (const group of [
            "teacherUnits",
            "teacherUnitCreateReceipts",
            "teacherUnitsBackendReleases",
            "teacherUnitsReleaseEvidence",
            "teacherUnitsAvailabilityHistory",
            "platformConfig",
            "auditEvents",
            "unmatchedOptionBDefaultDeny",
            "revisions",
            "anything",
          ]) {
            await assertFails(getDocs(collectionGroup(db, group)));
            await assertFails(
              getDocs(
                query(
                  collectionGroup(db, group),
                  where("teacherId", "==", OWNER_UID),
                  where("schoolId", "==", SCHOOL_ID),
                ),
              ),
            );
          }
        });
      });
    }
  });
});
