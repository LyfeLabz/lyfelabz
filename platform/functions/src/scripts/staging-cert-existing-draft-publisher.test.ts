import {
  ASTRA004,
  ASTRA004_ADMIN_APP_NAME,
  ASTRA004_ASSIGNMENT,
  ASTRA004_EXISTING_DRAFT,
  STAGING_PROJECT_ID,
  type Astra004AuthUser,
  type Astra004ExistingDraftPublisherDeps,
  formatAstra004Failure,
  parseAstra004ExistingDraftPublisherCliArgs,
  publishAstra004ExistingDraft,
  runAstra004ExistingDraftPublisherCliEntryPoint,
} from "./staging-cert-driver";
import { loadInitialRecipientPopulation } from "../assignments/assignment-recipients";
import { enrollmentsCollectionRef } from "../shared";

jest.mock("../shared", () => ({
  assignmentRecipientDocRef: jest.fn(),
  enrollmentsCollectionRef: jest.fn(),
}));

type Harness = {
  readonly docs: Map<string, Record<string, unknown>>;
  readonly deps: Astra004ExistingDraftPublisherDeps;
  readonly invoke: jest.Mock;
  readonly reads: jest.Mock;
  readonly queries: jest.Mock;
  readonly listRecipients: jest.Mock;
  readonly listEnrollments: jest.Mock;
  readonly listAssignments: jest.Mock;
};

const timestamp = (seconds: number): Record<string, unknown> => ({
  seconds,
  nanoseconds: 0,
});

function draftAssignment(): Record<string, unknown> {
  return {
    classId: ASTRA004.classId,
    teacherId: ASTRA004.teacherUid,
    schoolId: ASTRA004.studentSchoolId,
    lessonSlug: ASTRA004_ASSIGNMENT.lessonSlug,
    mode: ASTRA004_ASSIGNMENT.mode,
    title: ASTRA004_ASSIGNMENT.title,
    status: "draft",
    createdAt: timestamp(1),
  };
}

function activeClass(): Record<string, unknown> {
  return {
    teacherId: ASTRA004.teacherUid,
    schoolId: ASTRA004.studentSchoolId,
    title: ASTRA004.classTitle,
    grade: ASTRA004.classGrade,
    block: ASTRA004.classBlock,
    joinCode: "A1B2C3D4",
    status: "active",
    createdAt: timestamp(1),
  };
}

function studentUser(): Record<string, unknown> {
  return {
    authUid: ASTRA004.uid,
    email: ASTRA004.email,
    displayName: "Ninety Ballard",
    status: "active",
    role: "student",
    schoolId: ASTRA004.studentSchoolId,
    createdAt: timestamp(1),
  };
}

function studentAuth(): Astra004AuthUser {
  return {
    uid: ASTRA004.uid,
    email: ASTRA004.email,
    disabled: false,
    providerData: [{ providerId: "google.com", uid: "provider-90" }],
    customClaims: {
      role: "student",
      schoolId: ASTRA004.studentSchoolId,
      districtId: ASTRA004.districtId,
    },
  };
}

function teacherAuth(): Astra004AuthUser {
  return {
    uid: ASTRA004.teacherUid,
    email: "teacher@staging-cert.invalid",
    disabled: false,
    providerData: [],
    customClaims: {
      role: "teacher",
      schoolId: ASTRA004.studentSchoolId,
      districtId: ASTRA004.districtId,
    },
  };
}

function makeHarness(): Harness {
  const docs = new Map<string, Record<string, unknown>>([
    [`assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}`, draftAssignment()],
    [`classes/${ASTRA004.classId}`, activeClass()],
    [`schools/${ASTRA004.studentSchoolId}`, {
      districtId: ASTRA004.districtId,
    }],
    [`users/${ASTRA004.uid}`, studentUser()],
    [`enrollments/${ASTRA004.classId}__${ASTRA004.uid}`, {
      studentId: ASTRA004.uid,
      classId: ASTRA004.classId,
      schoolId: ASTRA004.studentSchoolId,
      status: "active",
      enrolledAt: timestamp(1),
    }],
    [`users/${ASTRA004.teacherUid}`, {
      authUid: ASTRA004.teacherUid,
      role: "teacher",
      status: "active",
      schoolId: ASTRA004.studentSchoolId,
    }],
    [`assessments/${ASTRA004_EXISTING_DRAFT.assessmentId}`, {
      assessmentId: ASTRA004_EXISTING_DRAFT.assessmentId,
      activityId: ASTRA004_ASSIGNMENT.lessonSlug,
      currentRevisionId: ASTRA004_EXISTING_DRAFT.assessmentRevisionId,
    }],
    [`assessmentRevisions/${ASTRA004_EXISTING_DRAFT.assessmentRevisionId}`, {
      assessmentId: ASTRA004_EXISTING_DRAFT.assessmentId,
      activityId: ASTRA004_ASSIGNMENT.lessonSlug,
      revisionOrdinal: 1,
    }],
    [`assessmentAnswerKeys/${ASTRA004_EXISTING_DRAFT.assessmentRevisionId}`, {
      assessmentId: ASTRA004_EXISTING_DRAFT.assessmentId,
      revisionOrdinal: 1,
    }],
  ]);
  const currentStudentAuth = studentAuth();
  const reads = jest.fn((path: string) => Promise.resolve(docs.get(path) ?? null));
  const collectionDocuments = (collection: string) => {
    const prefix = `${collection}/`;
    return [...docs.entries()]
      .filter(([path]) =>
        path.startsWith(prefix) && path.slice(prefix.length).indexOf("/") === -1)
      .map(([path, data]) => ({ id: path.slice(prefix.length), data }));
  };
  const queries = jest.fn((collection: string, field: string, value: string) =>
    Promise.resolve(collectionDocuments(collection).filter((doc) =>
      doc.data[field] === value)));
  const listRecipients = jest.fn(() => {
    const prefix = `assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}/recipients/`;
    return Promise.resolve([...docs.entries()]
      .filter(([path]) =>
        path.startsWith(prefix) && path.slice(prefix.length).indexOf("/") === -1)
      .map(([path, data]) => ({ id: path.slice(prefix.length), data })));
  });
  const listEnrollments = jest.fn(() =>
    Promise.resolve(collectionDocuments("enrollments").filter((doc) =>
      doc.data.classId === ASTRA004.classId)));
  const listAssignments = jest.fn(() =>
    Promise.resolve(collectionDocuments("assignments")));
  const invoke = jest.fn((
    uid: string,
    name: string,
    data: Readonly<Record<string, unknown>>,
  ) => {
    expect(uid).toBe(ASTRA004.teacherUid);
    expect(name).toBe("assignmentsPublish");
    expect(data).toEqual({ assignmentId: ASTRA004_EXISTING_DRAFT.assignmentId });
    const path = `assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}`;
    docs.set(path, {
      ...docs.get(path),
      status: "published",
      publishedAt: timestamp(10),
      assessmentRevisionId: ASTRA004_EXISTING_DRAFT.assessmentRevisionId,
    });
    docs.set(`${path}/recipients/${ASTRA004.uid}`, {
      assignmentId: ASTRA004_EXISTING_DRAFT.assignmentId,
      studentId: ASTRA004.uid,
      classId: ASTRA004.classId,
      teacherId: ASTRA004.teacherUid,
      schoolId: ASTRA004.studentSchoolId,
      districtId: ASTRA004.districtId,
      assignedAt: timestamp(10),
      assignedBy: ASTRA004.teacherUid,
      source: "classPublication",
      status: "assigned",
    });
    docs.set("auditEvents/publish-event", {
      actorUserId: ASTRA004.teacherUid,
      actorRole: "teacher",
      action: "assignments.published",
      targetType: "assignment",
      targetId: ASTRA004_EXISTING_DRAFT.assignmentId,
      schoolId: ASTRA004.studentSchoolId,
      districtId: ASTRA004.districtId,
      occurredAt: timestamp(10),
      payload: {
        classId: ASTRA004.classId,
        lessonSlug: ASTRA004_ASSIGNMENT.lessonSlug,
        assessmentRevisionId: ASTRA004_EXISTING_DRAFT.assessmentRevisionId,
        recipientCount: 1,
      },
    });
    return Promise.resolve({
      assignmentId: ASTRA004_EXISTING_DRAFT.assignmentId,
      status: "published",
      alreadyPublished: false,
    });
  });
  return {
    docs,
    invoke,
    reads,
    queries,
    listRecipients,
    listEnrollments,
    listAssignments,
    deps: {
      getAuthUserByUid: jest.fn((uid: string) => {
        if (uid === ASTRA004.uid) return Promise.resolve(currentStudentAuth);
        if (uid === ASTRA004.teacherUid) return Promise.resolve(teacherAuth());
        return Promise.resolve(null);
      }),
      getAuthUserByEmail: jest.fn((email: string) =>
        Promise.resolve(email === ASTRA004.email ? currentStudentAuth : null)),
      getDocument: reads,
      queryCollection: queries,
      listAssignmentRecipients: listRecipients,
      listClassEnrollments: listEnrollments,
      listCertificationAssignments: listAssignments,
      invokeCallableAs: invoke,
    },
  };
}

function addPublicationAuditEvidence(harness: Harness, id = "prior-publish"): void {
  harness.docs.set(`auditEvents/${id}`, {
    action: "assignments.published",
    targetType: "assignment",
    targetId: ASTRA004_EXISTING_DRAFT.assignmentId,
  });
}

function addQualifyingEnrollment(harness: Harness, studentId: string): void {
  harness.docs.set(`enrollments/${ASTRA004.classId}__${studentId}`, {
    studentId,
    classId: ASTRA004.classId,
    schoolId: ASTRA004.studentSchoolId,
    status: "active",
    enrolledAt: timestamp(2),
  });
}

function addCertificationDuplicate(
  harness: Harness,
  status: unknown,
  id = "astra004-cert-duplicate",
): void {
  const duplicate = draftAssignment();
  if (status === undefined) delete duplicate.status;
  else duplicate.status = status;
  harness.docs.set(`assignments/${id}`, duplicate);
}

function mutateOnSecondPreflight(
  harness: Harness,
  mutation: () => void,
): void {
  const ordinary = harness.listRecipients.getMockImplementation()!;
  let calls = 0;
  harness.listRecipients.mockImplementation(() => {
    calls += 1;
    if (calls === 2) mutation();
    return ordinary();
  });
}

const input = (overrides: Partial<{
  project: string;
  assignmentId: string;
  mode: "dry-run" | "apply";
  env: NodeJS.ProcessEnv;
}> = {}) => ({
  project: STAGING_PROJECT_ID,
  assignmentId: ASTRA004_EXISTING_DRAFT.assignmentId,
  mode: "dry-run" as const,
  env: {},
  ...overrides,
});

describe("publishAstra004ExistingDraft strict CLI", () => {
  const exact = [
    "publishAstra004ExistingDraft",
    `--project=${STAGING_PROJECT_ID}`,
    `--assignment-id=${ASTRA004_EXISTING_DRAFT.assignmentId}`,
  ] as const;

  it("accepts only the pinned command shape and defaults to dry-run", () => {
    expect(parseAstra004ExistingDraftPublisherCliArgs(exact)).toEqual({
      command: "publishAstra004ExistingDraft",
      project: STAGING_PROJECT_ID,
      assignmentId: ASTRA004_EXISTING_DRAFT.assignmentId,
      mode: "dry-run",
    });
    expect(parseAstra004ExistingDraftPublisherCliArgs([...exact, "--dry-run"]).mode)
      .toBe("dry-run");
    expect(parseAstra004ExistingDraftPublisherCliArgs([...exact, "--apply"]).mode)
      .toBe("apply");
  });

  const invalidArgv: readonly (readonly string[])[] = [
    [],
    ["publishAstra004ExistingDraft"],
    ["publishAstra004ExistingDraft", `--assignment-id=${ASTRA004_EXISTING_DRAFT.assignmentId}`],
    ["publishAstra004ExistingDraft", `--project=${STAGING_PROJECT_ID}`],
    ["publishAstra004ExistingDraft", "--project=lyfelabz-prod", `--assignment-id=${ASTRA004_EXISTING_DRAFT.assignmentId}`],
    ["publishAstra004ExistingDraft", "--project=staging", `--assignment-id=${ASTRA004_EXISTING_DRAFT.assignmentId}`],
    ["publishAstra004ExistingDraft", `--project=${STAGING_PROJECT_ID}`, "--assignment-id=other"],
    [...exact, `--project=${STAGING_PROJECT_ID}`],
    [...exact, `--assignment-id=${ASTRA004_EXISTING_DRAFT.assignmentId}`],
    [...exact, "--dry-run", "--apply"],
    [...exact, "--dry-run", "--dry-run"],
    [...exact, "--apply", "--apply"],
    [...exact, "--project="],
    [...exact, "--assignment-id="],
    [...exact, "--apply=true"],
    [...exact, "--unknown"],
    [...exact, "unexpected"],
    ["prepareAstra004Assignment", `--project=${STAGING_PROJECT_ID}`, `--assignment-id=${ASTRA004_EXISTING_DRAFT.assignmentId}`],
  ];
  it.each(invalidArgv.map((argv) => [argv]))(
    "rejects unsafe or malformed argv %#",
    (argv) => {
    expect(() => parseAstra004ExistingDraftPublisherCliArgs(argv)).toThrow();
    },
  );
});

describe("publishAstra004ExistingDraft read-only preflight", () => {
  it("returns safe metadata and performs zero writes or callable invocations", async () => {
    const harness = makeHarness();
    const result = await publishAstra004ExistingDraft(input(), harness.deps);
    expect(result).toMatchObject({
      project: STAGING_PROJECT_ID,
      assignmentId: ASTRA004_EXISTING_DRAFT.assignmentId,
      assignmentStatus: "draft",
      canonicalRevision: ASTRA004_EXISTING_DRAFT.assessmentRevisionId,
      intendedStudentUid: ASTRA004.uid,
      duplicateCount: 0,
      preflightPassed: true,
      writesPerformed: 0,
      wouldInvoke: "assignmentsPublish",
      invocationCount: 0,
    });
    expect(harness.invoke).not.toHaveBeenCalled();
    expect(harness.docs.get(`assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}`))
      .toEqual(draftAssignment());
  });

  it.each([
    [{ project: "lyfelabz-prod" }, "project"],
    [{ project: "staging" }, "project"],
    [{ assignmentId: "another" }, "assignment-id"],
    [{ env: { GCLOUD_PROJECT: "lyfelabz-prod" } }, "project"],
    [{ env: { GOOGLE_CLOUD_PROJECT: "lyfelabz-prod" } }, "project"],
    [{ env: { FIRESTORE_EMULATOR_HOST: "localhost:8080" } }, "FIRESTORE_EMULATOR_HOST"],
    [{ env: { FIREBASE_AUTH_EMULATOR_HOST: "localhost:9099" } }, "FIREBASE_AUTH_EMULATOR_HOST"],
  ])("fails closed for isolated target violation %p", async (overrides, message) => {
    const harness = makeHarness();
    await expect(publishAstra004ExistingDraft(input(overrides), harness.deps))
      .rejects.toThrow(message);
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it.each([
    ["classId", "wrong-class"],
    ["lessonSlug", "wrong-lesson"],
    ["teacherId", "wrong-teacher"],
  ])("rejects a draft with wrong %s", async (field, value) => {
    const harness = makeHarness();
    harness.docs.get(`assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}`)![field] = value;
    await expect(publishAstra004ExistingDraft(input(), harness.deps))
      .rejects.toThrow("immutable certification contract");
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("rejects already-published before the callable with a safe classification", async () => {
    const harness = makeHarness();
    harness.docs.get(`assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}`)!.status = "published";
    let error: unknown;
    try {
      await publishAstra004ExistingDraft(input({ mode: "apply" }), harness.deps);
    } catch (caught) {
      error = caught;
    }
    expect(formatAstra004Failure(error)).toContain("ALREADY_PUBLISHED");
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("rejects missing, closed, archived, or publication-tainted assignment state", async () => {
    for (const mutation of [
      (h: Harness) => h.docs.delete(`assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}`),
      (h: Harness) => {
        h.docs.get(`assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}`)!.status = "closed";
      },
      (h: Harness) => {
        h.docs.get(`assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}`)!.status = "archived";
      },
      (h: Harness) => {
        h.docs.get(`assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}`)!.publishedAt = timestamp(2);
      },
      (h: Harness) => {
        h.docs.get(`assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}`)!.assessmentRevisionId = ASTRA004_EXISTING_DRAFT.assessmentRevisionId;
      },
      (h: Harness) => {
        h.docs.get(`assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}`)!.lmsPublicationRef = "lms-pub";
      },
    ]) {
      const harness = makeHarness();
      mutation(harness);
      await expect(publishAstra004ExistingDraft(input(), harness.deps)).rejects.toThrow();
      expect(harness.invoke).not.toHaveBeenCalled();
    }
  });

  it.each([
    `assessments/${ASTRA004_EXISTING_DRAFT.assessmentId}`,
    `assessmentRevisions/${ASTRA004_EXISTING_DRAFT.assessmentRevisionId}`,
    `assessmentAnswerKeys/${ASTRA004_EXISTING_DRAFT.assessmentRevisionId}`,
  ])("rejects missing canonical prerequisite %s", async (path) => {
    const harness = makeHarness();
    harness.docs.delete(path);
    await expect(publishAstra004ExistingDraft(input(), harness.deps))
      .rejects.toThrow(/assessment|revision|answer key/);
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("rejects a parent pointing to any revision except canonical r1", async () => {
    const harness = makeHarness();
    harness.docs.get(`assessments/${ASTRA004_EXISTING_DRAFT.assessmentId}`)!
      .currentRevisionId = "assessment_what-is-life__r2";
    await expect(publishAstra004ExistingDraft(input(), harness.deps))
      .rejects.toThrow("wrong revision");
  });

  it("rejects duplicate certification assignments", async () => {
    const harness = makeHarness();
    harness.docs.set("assignments/astra004-cert-duplicate", {
      ...draftAssignment(),
      status: "published",
    });
    await expect(publishAstra004ExistingDraft(input(), harness.deps))
      .rejects.toThrow("ambiguous");
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("rejects wrong student identity or inactive enrollment", async () => {
    const student = makeHarness();
    student.docs.get(`users/${ASTRA004.uid}`)!.email = "other@example.com";
    await expect(publishAstra004ExistingDraft(input(), student.deps))
      .rejects.toThrow("identity");

    const enrollment = makeHarness();
    enrollment.docs.get(`enrollments/${ASTRA004.classId}__${ASTRA004.uid}`)!
      .status = "inactive";
    await expect(publishAstra004ExistingDraft(input(), enrollment.deps))
      .rejects.toThrow("publication population");
  });

  it("rejects accommodation, class LMS linkage, or assignment LMS publication state", async () => {
    const accommodation = makeHarness();
    accommodation.docs.set(`studentAccommodations/${ASTRA004.uid}`, { status: "active" });
    await expect(publishAstra004ExistingDraft(input(), accommodation.deps))
      .rejects.toThrow("accommodation");

    const classLink = makeHarness();
    classLink.docs.set("lmsClassLinks/link", { classId: ASTRA004.classId });
    await expect(publishAstra004ExistingDraft(input(), classLink.deps))
      .rejects.toThrow("LMS");

    const publication = makeHarness();
    publication.docs.set("lmsAssignmentPublications/pub", {
      assignmentId: ASTRA004_EXISTING_DRAFT.assignmentId,
    });
    await expect(publishAstra004ExistingDraft(input(), publication.deps))
      .rejects.toThrow("LMS");
  });

  it("rejects a draft with any existing recipient as partial publication evidence", async () => {
    const harness = makeHarness();
    harness.docs.set(
      `assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}/recipients/${ASTRA004.uid}`,
      { assignmentId: ASTRA004_EXISTING_DRAFT.assignmentId },
    );
    let error: unknown;
    try {
      await publishAstra004ExistingDraft(input({ mode: "apply" }), harness.deps);
    } catch (caught) {
      error = caught;
    }
    expect(formatAstra004Failure(error)).toContain("PARTIAL_PUBLICATION_EVIDENCE");
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("rejects a draft with prior assignments.published audit evidence", async () => {
    const harness = makeHarness();
    addPublicationAuditEvidence(harness);
    let error: unknown;
    try {
      await publishAstra004ExistingDraft(input({ mode: "apply" }), harness.deps);
    } catch (caught) {
      error = caught;
    }
    expect(formatAstra004Failure(error)).toContain("PARTIAL_PUBLICATION_EVIDENCE");
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("accepts exactly the pinned student as the sole qualifying population", async () => {
    const harness = makeHarness();
    await expect(publishAstra004ExistingDraft(input(), harness.deps))
      .resolves.toMatchObject({
        publicationPopulationCount: 1,
        intendedStudentUid: ASTRA004.uid,
        writesPerformed: 0,
        invocationCount: 0,
      });
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("rejects an additional active student who would be populated by assignmentsPublish", async () => {
    const harness = makeHarness();
    addQualifyingEnrollment(harness, "second-active-student");
    await expect(publishAstra004ExistingDraft(input({ mode: "apply" }), harness.deps))
      .rejects.toThrow("publication population");
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("matches assignmentsPublish eligibility semantics for the certification fixture", async () => {
    const harness = makeHarness();
    // Same student twice is de-duplicated. Non-active, wrong-school,
    // wrong-class, and empty-student rows are ineligible exactly as in
    // loadInitialRecipientPopulation.
    const rows: readonly Record<string, unknown>[] = [{
      studentId: ASTRA004.uid,
      classId: ASTRA004.classId,
      schoolId: ASTRA004.studentSchoolId,
      status: "active",
    }, {
      studentId: "inactive-other",
      classId: ASTRA004.classId,
      schoolId: ASTRA004.studentSchoolId,
      status: "inactive",
    }, {
      studentId: "wrong-school",
      classId: ASTRA004.classId,
      schoolId: "other-school",
      status: "active",
    }, {
      studentId: "wrong-class",
      classId: "other-class",
      schoolId: ASTRA004.studentSchoolId,
      status: "active",
    }, {
      studentId: " ",
      classId: ASTRA004.classId,
      schoolId: ASTRA004.studentSchoolId,
      status: "active",
    }];
    rows.forEach((row, index) => {
      harness.docs.set(`enrollments/eligibility-${String(index)}`, row);
    });
    const get = jest.fn().mockResolvedValue({
      docs: [
        { data: () => harness.docs.get(`enrollments/${ASTRA004.classId}__${ASTRA004.uid}`) },
        ...rows.map((row) => ({ data: () => row })),
      ],
    });
    (enrollmentsCollectionRef as jest.Mock).mockReturnValue({
      where: (field: string, operator: string, value: string) => {
        expect([field, operator, value]).toEqual([
          "classId",
          "==",
          ASTRA004.classId,
        ]);
        return { get };
      },
    });
    const productionPopulation = await loadInitialRecipientPopulation(
      ASTRA004.classId,
      ASTRA004.studentSchoolId,
    );
    expect(productionPopulation).toEqual([ASTRA004.uid]);
    await expect(publishAstra004ExistingDraft(input(), harness.deps))
      .resolves.toMatchObject({ publicationPopulationCount: 1 });
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it.each([
    "closed",
    "archived",
    "malformed-status",
    undefined,
  ])("rejects a second certification assignment with lifecycle %s", async (status) => {
    const harness = makeHarness();
    addCertificationDuplicate(harness, status);
    await expect(publishAstra004ExistingDraft(input({ mode: "apply" }), harness.deps))
      .rejects.toThrow("ambiguous");
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("accepts exactly one lifecycle-independent certification match: the pinned assignment", async () => {
    const harness = makeHarness();
    harness.docs.set(`assignments/${ASTRA004_ASSIGNMENT.historicalAssignmentId}`, {
      classId: ASTRA004.classId,
      lessonSlug: ASTRA004_ASSIGNMENT.historicalLessonSlug,
      status: "archived",
    });
    await expect(publishAstra004ExistingDraft(input(), harness.deps))
      .resolves.toMatchObject({ duplicateCount: 0, writesPerformed: 0 });
  });
});

describe("publishAstra004ExistingDraft one-shot apply", () => {
  it("invokes assignmentsPublish exactly once and verifies assignment, recipient, and audit", async () => {
    const harness = makeHarness();
    const result = await publishAstra004ExistingDraft(
      input({ mode: "apply" }),
      harness.deps,
    );
    expect(harness.invoke).toHaveBeenCalledTimes(1);
    expect(harness.invoke).toHaveBeenCalledWith(
      ASTRA004.teacherUid,
      "assignmentsPublish",
      { assignmentId: ASTRA004_EXISTING_DRAFT.assignmentId },
    );
    expect(result).toMatchObject({
      assignmentStatus: "published",
      invocationCount: 1,
      recipientSnapshotVerified: true,
      auditEventVerified: true,
    });
    expect(harness.listAssignments).toHaveBeenCalledTimes(3);
  });

  it("never invokes assignment creation and has no direct-write dependency", async () => {
    const harness = makeHarness();
    await publishAstra004ExistingDraft(input({ mode: "apply" }), harness.deps);
    expect(harness.invoke.mock.calls.map((call) => call[1]))
      .toEqual(["assignmentsPublish"]);
    expect(Object.keys(harness.deps).sort()).toEqual([
      "getAuthUserByEmail",
      "getAuthUserByUid",
      "getDocument",
      "invokeCallableAs",
      "listAssignmentRecipients",
      "listCertificationAssignments",
      "listClassEnrollments",
      "queryCollection",
    ]);
    expect(String(publishAstra004ExistingDraft)).not.toMatch(/\.set\(|\.update\(|\.commit\(/);
    expect(String(publishAstra004ExistingDraft)).not.toContain("assignmentsCreateDraft");
  });

  it("does not retry a failed callable and sanitizes provider details", async () => {
    const harness = makeHarness();
    const canary = "Authorization: Bearer SECRET_TOKEN refresh_token=SECRET";
    harness.invoke.mockRejectedValueOnce(new Error(canary));
    let error: unknown;
    try {
      await publishAstra004ExistingDraft(input({ mode: "apply" }), harness.deps);
    } catch (caught) {
      error = caught;
    }
    expect(harness.invoke).toHaveBeenCalledTimes(1);
    const rendered = formatAstra004Failure(error);
    expect(rendered).toContain("stage=assignmentsPublish");
    expect(rendered).toContain("CALLABLE_FAILED");
    expect(rendered).not.toContain(canary);
  });

  it("fails post-publication verification for a wrong revision", async () => {
    const harness = makeHarness();
    const ordinary = harness.invoke.getMockImplementation()!;
    harness.invoke.mockImplementation((...args: unknown[]) => {
      const response = ordinary(...args);
      harness.docs.get(`assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}`)!
        .assessmentRevisionId = "assessment_what-is-life__r2";
      return response;
    });
    await expect(publishAstra004ExistingDraft(input({ mode: "apply" }), harness.deps))
      .rejects.toThrow("wrong canonical revision");
    expect(harness.invoke).toHaveBeenCalledTimes(1);
  });

  it("fails post-publication verification for duplicate recipient evidence", async () => {
    const harness = makeHarness();
    const ordinary = harness.invoke.getMockImplementation()!;
    harness.invoke.mockImplementation((...args: unknown[]) => {
      const response = ordinary(...args);
      harness.docs.set(
        `assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}/recipients/other-student`,
        {
        assignmentId: ASTRA004_EXISTING_DRAFT.assignmentId,
        studentId: "other-student",
        },
      );
      return response;
    });
    await expect(publishAstra004ExistingDraft(input({ mode: "apply" }), harness.deps))
      .rejects.toThrow("not exactly");
    expect(harness.invoke).toHaveBeenCalledTimes(1);
  });

  it("fails post-publication verification when normal audit evidence is absent", async () => {
    const harness = makeHarness();
    const ordinary = harness.invoke.getMockImplementation()!;
    harness.invoke.mockImplementation((...args: unknown[]) => {
      const response = ordinary(...args);
      harness.docs.delete("auditEvents/publish-event");
      return response;
    });
    await expect(publishAstra004ExistingDraft(input({ mode: "apply" }), harness.deps))
      .rejects.toThrow("audit event");
  });

  it.each([
    [
      "recipient evidence",
      (harness: Harness) => {
        harness.docs.set(
          `assignments/${ASTRA004_EXISTING_DRAFT.assignmentId}/recipients/${ASTRA004.uid}`,
          { assignmentId: ASTRA004_EXISTING_DRAFT.assignmentId },
        );
      },
      "partial or contaminated",
    ],
    [
      "publication audit evidence",
      (harness: Harness) => addPublicationAuditEvidence(harness),
      "partial or contaminated",
    ],
    [
      "an extra qualifying student",
      (harness: Harness) => addQualifyingEnrollment(harness, "late-active-student"),
      "publication population",
    ],
    [
      "a duplicate certification assignment",
      (harness: Harness) => addCertificationDuplicate(harness, "closed"),
      "ambiguous",
    ],
  ])("immediate pre-apply recheck catches %s", async (
    _label,
    mutation,
    expected,
  ) => {
    const harness = makeHarness();
    mutateOnSecondPreflight(harness, () => mutation(harness));
    await expect(publishAstra004ExistingDraft(input({ mode: "apply" }), harness.deps))
      .rejects.toThrow(expected);
    expect(harness.invoke).not.toHaveBeenCalled();
    expect(String(harness.invoke.mock.calls)).not.toContain("assignmentsCreateDraft");
  });
});

describe("publishAstra004ExistingDraft CLI orchestration", () => {
  it("reports a redacted zero-write dry-run without invoking publication", async () => {
    const harness = makeHarness();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const staging = {
      name: ASTRA004_ADMIN_APP_NAME,
      options: { projectId: STAGING_PROJECT_ID },
    };
    const exitCode = await runAstra004ExistingDraftPublisherCliEntryPoint(
      [
        "publishAstra004ExistingDraft",
        `--project=${STAGING_PROJECT_ID}`,
        `--assignment-id=${ASTRA004_EXISTING_DRAFT.assignmentId}`,
      ],
      {
        env: {},
        getApps: () => [staging],
        initializeApp: () => staging,
        getAuth: () => ({ kind: "auth" }),
        getFirestore: () => ({ kind: "firestore" }),
        createPublisherDeps: () => harness.deps,
        writeStdout: (value) => stdout.push(value),
        writeStderr: (value) => stderr.push(value),
      },
    );
    expect(exitCode).toBe(0);
    expect(stdout.join("\n")).toContain('"writesPerformed":0');
    expect(stdout.join("\n")).toContain('"invocationCount":0');
    expect(stderr).toEqual([]);
    expect(harness.invoke).not.toHaveBeenCalled();
  });

  it("does not fall back to production when ambient project conflicts", async () => {
    const harness = makeHarness();
    const stdout: string[] = [];
    const stderr: string[] = [];
    const staging = {
      name: ASTRA004_ADMIN_APP_NAME,
      options: { projectId: STAGING_PROJECT_ID },
    };
    const exitCode = await runAstra004ExistingDraftPublisherCliEntryPoint(
      [
        "publishAstra004ExistingDraft",
        `--project=${STAGING_PROJECT_ID}`,
        `--assignment-id=${ASTRA004_EXISTING_DRAFT.assignmentId}`,
        "--apply",
      ],
      {
        env: { GCLOUD_PROJECT: "lyfelabz-prod" },
        getApps: () => [staging],
        initializeApp: () => staging,
        getAuth: () => ({ kind: "auth" }),
        getFirestore: () => ({ kind: "firestore" }),
        createPublisherDeps: () => harness.deps,
        writeStdout: (value) => stdout.push(value),
        writeStderr: (value) => stderr.push(value),
      },
    );
    expect(exitCode).toBe(2);
    expect(stdout).toEqual([]);
    expect(stderr.join("\n")).toContain("project-isolation");
    expect(harness.invoke).not.toHaveBeenCalled();
  });
});
