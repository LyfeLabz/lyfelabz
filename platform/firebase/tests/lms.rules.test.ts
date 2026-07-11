import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import {
  collection,
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

// Sprint 8D.1 Firestore Rules coverage for the four LMS collections added
// by Sprint 8. Each collection is exercised end-to-end:
//   - owner-scoped reads succeed
//   - cross-teacher reads fail
//   - unauthenticated reads fail
//   - every client write (create, update, delete) fails
// This is the direct positive/negative coverage the Sprint 8D.1
// specification requires; it is intentionally focused so a future
// Rules regression cannot silently open the collections.

const OWNER_UID = "teacher-owner-uid";
const OTHER_TEACHER_UID = "teacher-other-uid";
const CONNECTION_ID = "googleclassroom__teacher-owner-uid";
const OTHER_CONNECTION_ID = "googleclassroom__teacher-other-uid";
const LINK_ID = "class-owner-1__googleclassroom__link-hash";
const OTHER_LINK_ID = "class-other-1__googleclassroom__link-hash";
const PUBLICATION_ID = "assign-owner-1__googleclassroom__pubhash";
const OTHER_PUBLICATION_ID = "assign-other-1__googleclassroom__pubhash";
const PROVIDER_ID = "googleClassroom";

describe("Firestore Rules: LMS collections (Sprint 8D.1)", () => {
  let testEnv: RulesTestEnvironment;

  beforeAll(async () => {
    testEnv = await createTestEnvironment();
  });

  afterAll(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      // Provider directory (reference data; readable by any signed-in caller).
      await setDoc(doc(db, "lmsProviders", PROVIDER_ID), {
        providerId: PROVIDER_ID,
        displayName: "Google Classroom",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
      // Owner's connection.
      await setDoc(doc(db, "lmsConnections", CONNECTION_ID), {
        teacherId: OWNER_UID,
        schoolId: "school-a",
        providerId: PROVIDER_ID,
        status: "active",
        scopes: ["classroom.courses.readonly"],
        tokenRef: "opaque-server-only",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
      // Other teacher's connection.
      await setDoc(doc(db, "lmsConnections", OTHER_CONNECTION_ID), {
        teacherId: OTHER_TEACHER_UID,
        schoolId: "school-a",
        providerId: PROVIDER_ID,
        status: "active",
        scopes: ["classroom.courses.readonly"],
        tokenRef: "opaque-server-only-2",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
      // Owner's class link.
      await setDoc(doc(db, "lmsClassLinks", LINK_ID), {
        classId: "class-owner-1",
        ownerUid: OWNER_UID,
        schoolId: "school-a",
        providerId: PROVIDER_ID,
        connectionId: CONNECTION_ID,
        lmsClassId: "gc-course-1",
        status: "linked",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
      // Other teacher's class link.
      await setDoc(doc(db, "lmsClassLinks", OTHER_LINK_ID), {
        classId: "class-other-1",
        ownerUid: OTHER_TEACHER_UID,
        schoolId: "school-a",
        providerId: PROVIDER_ID,
        connectionId: OTHER_CONNECTION_ID,
        lmsClassId: "gc-course-2",
        status: "linked",
        createdAt: new Date("2026-08-15T00:00:00Z"),
      });
      // Owner's publication.
      await setDoc(doc(db, "lmsAssignmentPublications", PUBLICATION_ID), {
        assignmentId: "assign-owner-1",
        classId: "class-owner-1",
        ownerUid: OWNER_UID,
        schoolId: "school-a",
        providerId: PROVIDER_ID,
        connectionId: CONNECTION_ID,
        lmsClassId: "gc-course-1",
        status: "succeeded",
        lmsAssignmentId: "gc-assign-1",
        publishedAt: new Date("2026-08-15T00:00:00Z"),
      });
      // Other teacher's publication.
      await setDoc(
        doc(db, "lmsAssignmentPublications", OTHER_PUBLICATION_ID),
        {
          assignmentId: "assign-other-1",
          classId: "class-other-1",
          ownerUid: OTHER_TEACHER_UID,
          schoolId: "school-a",
          providerId: PROVIDER_ID,
          connectionId: OTHER_CONNECTION_ID,
          lmsClassId: "gc-course-2",
          status: "failed",
          errorCode: "lms.publishFailed",
          publishedAt: new Date("2026-08-15T00:00:00Z"),
        },
      );
    });
  });

  describe("lmsProviders (reference data)", () => {
    it("any signed-in caller may get a provider", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertSucceeds(getDoc(doc(db, "lmsProviders", PROVIDER_ID)));
    });

    it("any signed-in caller may list providers", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertSucceeds(getDocs(collection(db, "lmsProviders")));
    });

    it("denies unauthenticated get and list", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "lmsProviders", PROVIDER_ID)));
      await assertFails(getDocs(collection(db, "lmsProviders")));
    });

    it("denies every client write", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        setDoc(doc(db, "lmsProviders", "canvas"), {
          providerId: "canvas",
          displayName: "Canvas",
        }),
      );
      await assertFails(
        updateDoc(doc(db, "lmsProviders", PROVIDER_ID), {
          displayName: "Rewritten",
        }),
      );
      await assertFails(deleteDoc(doc(db, "lmsProviders", PROVIDER_ID)));
    });
  });

  describe("lmsConnections", () => {
    it("owning teacher may get their own connection", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertSucceeds(getDoc(doc(db, "lmsConnections", CONNECTION_ID)));
    });

    it("owning teacher may list their own connections filtered by teacherId", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertSucceeds(
        getDocs(
          query(
            collection(db, "lmsConnections"),
            where("teacherId", "==", OWNER_UID),
          ),
        ),
      );
    });

    it("denies a different teacher from getting a connection they do not own", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(getDoc(doc(db, "lmsConnections", CONNECTION_ID)));
    });

    it("denies an unscoped connections list", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDocs(collection(db, "lmsConnections")));
    });

    it("denies a cross-teacher list", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        getDocs(
          query(
            collection(db, "lmsConnections"),
            where("teacherId", "==", OTHER_TEACHER_UID),
          ),
        ),
      );
    });

    it("denies unauthenticated get and list", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "lmsConnections", CONNECTION_ID)));
      await assertFails(getDocs(collection(db, "lmsConnections")));
    });

    it("denies every client write, including a self-owned create", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        setDoc(doc(db, "lmsConnections", "would-be-mine"), {
          teacherId: OWNER_UID,
          schoolId: "school-a",
          providerId: PROVIDER_ID,
          status: "active",
          scopes: [],
          tokenRef: "x",
          createdAt: new Date(),
        }),
      );
      await assertFails(
        updateDoc(doc(db, "lmsConnections", CONNECTION_ID), {
          status: "revoked",
        }),
      );
      await assertFails(
        deleteDoc(doc(db, "lmsConnections", CONNECTION_ID)),
      );
    });
  });

  describe("lmsClassLinks", () => {
    it("owning teacher may get their own class link", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertSucceeds(getDoc(doc(db, "lmsClassLinks", LINK_ID)));
    });

    it("owning teacher may list their own links filtered by ownerUid", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertSucceeds(
        getDocs(
          query(
            collection(db, "lmsClassLinks"),
            where("ownerUid", "==", OWNER_UID),
          ),
        ),
      );
    });

    it("denies a different teacher from getting a link they do not own", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(getDoc(doc(db, "lmsClassLinks", LINK_ID)));
    });

    it("denies an unscoped links list and a cross-teacher list", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDocs(collection(db, "lmsClassLinks")));
      await assertFails(
        getDocs(
          query(
            collection(db, "lmsClassLinks"),
            where("ownerUid", "==", OTHER_TEACHER_UID),
          ),
        ),
      );
    });

    it("denies unauthenticated get and list", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(getDoc(doc(db, "lmsClassLinks", LINK_ID)));
      await assertFails(getDocs(collection(db, "lmsClassLinks")));
    });

    it("denies every client write, including a self-owned create", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        setDoc(doc(db, "lmsClassLinks", "would-be-mine"), {
          classId: "class-owner-1",
          ownerUid: OWNER_UID,
          schoolId: "school-a",
          providerId: PROVIDER_ID,
          connectionId: CONNECTION_ID,
          lmsClassId: "x",
          status: "linked",
          createdAt: new Date(),
        }),
      );
      await assertFails(
        updateDoc(doc(db, "lmsClassLinks", LINK_ID), {
          status: "unlinked",
        }),
      );
      await assertFails(deleteDoc(doc(db, "lmsClassLinks", LINK_ID)));
    });
  });

  describe("lmsAssignmentPublications", () => {
    it("owning teacher may get a publication they authored", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertSucceeds(
        getDoc(doc(db, "lmsAssignmentPublications", PUBLICATION_ID)),
      );
    });

    it("owning teacher may list their own publications filtered by ownerUid", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertSucceeds(
        getDocs(
          query(
            collection(db, "lmsAssignmentPublications"),
            where("ownerUid", "==", OWNER_UID),
          ),
        ),
      );
    });

    it("denies a different teacher from getting a publication they did not author", async () => {
      const db = testEnv.authenticatedContext(OTHER_TEACHER_UID).firestore();
      await assertFails(
        getDoc(doc(db, "lmsAssignmentPublications", PUBLICATION_ID)),
      );
    });

    it("denies an unscoped list and a cross-teacher list", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        getDocs(collection(db, "lmsAssignmentPublications")),
      );
      await assertFails(
        getDocs(
          query(
            collection(db, "lmsAssignmentPublications"),
            where("ownerUid", "==", OTHER_TEACHER_UID),
          ),
        ),
      );
    });

    it("denies unauthenticated get and list", async () => {
      const db = testEnv.unauthenticatedContext().firestore();
      await assertFails(
        getDoc(doc(db, "lmsAssignmentPublications", PUBLICATION_ID)),
      );
      await assertFails(
        getDocs(collection(db, "lmsAssignmentPublications")),
      );
    });

    it("denies every client write, including a self-owned create", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(
        setDoc(
          doc(db, "lmsAssignmentPublications", "would-be-mine"),
          {
            assignmentId: "assign-owner-1",
            classId: "class-owner-1",
            ownerUid: OWNER_UID,
            schoolId: "school-a",
            providerId: PROVIDER_ID,
            connectionId: CONNECTION_ID,
            lmsClassId: "x",
            status: "succeeded",
            publishedAt: new Date(),
          },
        ),
      );
      await assertFails(
        updateDoc(
          doc(db, "lmsAssignmentPublications", PUBLICATION_ID),
          { status: "failed" },
        ),
      );
      await assertFails(
        deleteDoc(doc(db, "lmsAssignmentPublications", PUBLICATION_ID)),
      );
    });
  });

  describe("default-deny remains intact", () => {
    it("denies get and list against an unknown top-level collection", async () => {
      const db = testEnv.authenticatedContext(OWNER_UID).firestore();
      await assertFails(getDocs(collection(db, "lmsRosterLinks")));
      await assertFails(
        getDoc(doc(db, "lmsRosterLinks", "nonexistent-id")),
      );
    });
  });
});
