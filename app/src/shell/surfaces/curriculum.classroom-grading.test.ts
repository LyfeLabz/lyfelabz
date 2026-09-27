/**
 * @jest-environment jsdom
 *
 * Sprint 30A.1 - Assign dialog Classroom grading configuration tests.
 *
 * Human review rejected the original per-class-row grading design and
 * required a corrected information architecture: ONE shared grading
 * configuration for the whole Assign action (Graded/Ungraded + Points),
 * applied identically to every selected class, with class cards retaining
 * only genuinely class-specific controls (inclusion, topic, schedule).
 * This file supersedes the original per-row version of these tests.
 *
 * Mirrors the harness conventions already established in
 * curriculum.lms-publish.test.ts (a fresh, self-contained copy per this
 * file's existing sibling-test convention, not a shared helper module).
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type {
  AssignmentsCallables,
  AssignmentsCreateDraftInput,
  IntegrationsCallables,
  IntegrationsClassLink,
  IntegrationsDeps,
  IntegrationsPublicationOutcome,
} from "../../settings/integrations/types";
import {
  renderCurriculumSurface,
  _resetCurriculumSessionStateForTest,
} from "./curriculum";

const freeze = <T>(v: T): T => Object.freeze(v) as T;
const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 8; i += 1) await flush();
};

const teacher: Extract<Session, { kind: "activeTeacher" }> = freeze({
  kind: "activeTeacher",
  uid: "u-teacher",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

// Four eligible classes, matching the Scenario A/B counts in the human-
// review prompt. c1 and c3 are LMS-linked (different upstream courses);
// c2 and c4 are plain LyfeLabz classes with no Classroom link.
const fourClasses: ReadonlyArray<ClassSummary> = freeze([
  freeze({ id: "c1", title: "A Science", grade: "6", status: "active" }),
  freeze({ id: "c2", title: "C Science", grade: "6", status: "active" }),
  freeze({ id: "c3", title: "E Science", grade: "7", status: "active" }),
  freeze({ id: "c4", title: "G Science", grade: "7", status: "active" }),
] as ClassSummary[]);
const listFour: ListClasses = () => Promise.resolve(fourClasses);

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const okAssignments = (): {
  seam: AssignmentsCallables;
  draftInputs: AssignmentsCreateDraftInput[];
} => {
  const draftInputs: AssignmentsCreateDraftInput[] = [];
  return {
    draftInputs,
    seam: {
      createDraft: async (input) => {
        draftInputs.push(input);
        return { assignmentId: input.assignmentId, status: "draft", alreadyCreated: false };
      },
      publish: async (input) => {
        return { assignmentId: input.assignmentId, status: "published", alreadyPublished: false };
      },
      lifecycleState: async () => ({
        state: "neverAssigned" as const,
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [],
      }),
      currentSet: async (input) => ({
        classId: input.classId,
        lessonSlug: input.lessonSlug,
        assignmentId: input.assignmentId,
        changed: true,
      }),
      currentRecipientsReconcile: async (input) => ({
        classId: input.classId,
        lessonSlug: input.lessonSlug,
        assignmentId: "",
        added: 0,
        alreadyCurrent: 0,
      }),
      recipientsReconcile: async (input) => ({
        assignmentId: input.assignmentId,
        added: 0,
        alreadyCurrent: 0,
      }),
    },
  };
};

const makeIntegrations = (): {
  deps: IntegrationsDeps;
  publishCalls: {
    assignmentId: string;
    linkId: string;
    lmsTopicId?: string;
    dueDate?: string;
    scheduledTime?: string;
  }[];
} => {
  // Two LMS-linked classes on two distinct upstream courses/links, so a
  // topic-ID mixup between them is structurally detectable.
  const links: ReadonlyArray<IntegrationsClassLink> = freeze([
    freeze({
      linkId: "link-c1",
      classId: "c1",
      providerId: "google-classroom",
      lmsClassId: "gc-c1",
    }),
    freeze({
      linkId: "link-c3",
      classId: "c3",
      providerId: "google-classroom",
      lmsClassId: "gc-c3",
    }),
  ]);
  const publishCalls: {
    assignmentId: string;
    linkId: string;
    lmsTopicId?: string;
    dueDate?: string;
    scheduledTime?: string;
  }[] = [];
  const callables = {
    listProviders: async () => [],
    describeConnections: async () => [],
    beginConnection: async () => ({ authorizationUrl: "https://consent/auth", state: "st-1" }),
    completeConnection: async () => ({
      connectionId: "conn-1",
      alreadyConnected: false,
      consentOutcome: "widened" as const,
    }),
    disconnect: async () => ({ alreadyRevoked: false }),
    discoverClasses: async () => [],
    importClass: async () => ({ linkId: "l", classId: "c", lmsClassId: "g", alreadyLinked: false }),
    listClassTopics: async (input: { linkId: string }) => {
      // Distinct topic catalogs per link so a cross-course leak is
      // observable rather than accidentally matching.
      if (input.linkId === "link-c1") {
        return [{ lmsTopicId: "topic-c1-unit1", name: "Unit 1" }];
      }
      if (input.linkId === "link-c3") {
        return [{ lmsTopicId: "topic-c3-unitA", name: "Unit A" }];
      }
      return [];
    },
    refreshClass: async () => ({
      linkId: "l",
      classId: "c",
      lmsClassId: "g",
      providerId: "google-classroom",
      status: "healthy" as const,
      changed: false,
    }),
    publishAssignment: async (input: {
      assignmentId: string;
      linkId: string;
      lmsTopicId?: string;
      dueDate?: string;
      scheduledTime?: string;
    }): Promise<IntegrationsPublicationOutcome> => {
      publishCalls.push({
        assignmentId: input.assignmentId,
        linkId: input.linkId,
        ...(input.lmsTopicId !== undefined ? { lmsTopicId: input.lmsTopicId } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.scheduledTime !== undefined ? { scheduledTime: input.scheduledTime } : {}),
      });
      return { publicationId: "pub", status: "succeeded" as const, lmsAssignmentId: "gc-1" };
    },
  } as unknown as IntegrationsCallables;

  return {
    publishCalls,
    deps: {
      callables,
      openOAuth: async () => ({ code: "auth-code", state: "st-1" }),
      listTeacherClasses: async () => [],
      redirectUri: "https://app/app/lms-callback.html",
      listClassLinks: async () => links,
    },
  };
};

const openDialogFor = async (mount: HTMLElement, slug: string): Promise<void> => {
  mount
    .querySelector<HTMLButtonElement>(`[data-testid=lesson-assign-${slug}]`)
    ?.click();
  await settle();
};

const confirm = (): void => {
  document
    .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
    ?.click();
};

// Sprint 30A.1 FINAL UI POLISH (human review): the single ambiguous
// "Graded in Google Classroom" checkbox was replaced with an explicit
// two-state Ungraded/Graded radio pair. `gradedRadio().checked` still
// reports the dialog's current Graded/Ungraded state (mirroring the old
// `gradedRadio().checked` helper), but setting it now means "select the
// Graded option" - clicking it a second time is a no-op (native radios
// do not un-check themselves), so tests that need to return to Ungraded
// click `ungradedRadio()` instead of clicking the same control twice.
const gradedRadio = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>("[data-testid=assign-shared-grading-graded]")!;
const ungradedRadio = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>("[data-testid=assign-shared-grading-ungraded]")!;
const pointsInput = (): HTMLInputElement =>
  document.querySelector<HTMLInputElement>("[data-testid=assign-shared-points]")!;
const confirmButton = (): HTMLButtonElement =>
  document.querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")!;
const selectedCount = (): string =>
  document.querySelector<HTMLElement>("[data-testid=assign-selected-count]")?.textContent ?? "";
const rowEnabled = (classId: string): HTMLInputElement =>
  document.querySelector<HTMLInputElement>(`[data-testid=assign-row-enabled-${classId}]`)!;

const setPoints = (value: string): void => {
  const input = pointsInput();
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
};

describe("Assign dialog - shared Classroom grading configuration (Sprint 30A.1 UX correction)", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  // Regression test for the human-review finding: a rendered screenshot
  // showed Points and "Also publish to Google Classroom" repeated inside
  // every class card despite an earlier report claiming they had been
  // moved to shared settings. The root cause was a stale, never-rebuilt
  // `app/dist/bundle.js` the preview served instead of current source
  // (see the final report, §2) - not a defect in this source file. This
  // test exercises the SAME authoritative render path
  // (`renderCurriculumSurface`, imported directly from source) any future
  // build bundles, so a regression here fails a test immediately rather
  // than silently reappearing behind a stale artifact.
  test("REGRESSION: with four classes, exactly one Points input and one Ungraded/Graded control pair exist; no class row carries Points or a publish control; the old ambiguous checkbox is gone", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    // Exactly one shared grading control of each kind, dialog-wide.
    expect(document.querySelectorAll("[data-testid=assign-shared-grading-ungraded]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-testid=assign-shared-grading-graded]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-testid=assign-shared-points]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-testid=assign-shared-settings]")).toHaveLength(1);
    // Sprint 30A.1 FINAL UI POLISH: the original single "Graded in Google
    // Classroom" checkbox never renders anywhere, and its ambiguous
    // wording does not appear as text either.
    expect(document.querySelector("[data-testid=assign-shared-graded]")).toBeNull();
    const dialogText =
      document.querySelector("[data-testid=assign-dialog]")?.textContent ?? "";
    expect(dialogText).not.toContain("Graded in Google Classroom");
    // Exactly four compact class rows, all selected by default.
    const rows = document.querySelectorAll("[data-testid^=assign-row-enabled-]");
    expect(rows).toHaveLength(4);
    for (const id of ["c1", "c2", "c3", "c4"]) {
      // No per-row grading control of any kind, for any class - LMS-linked
      // (c1, c3) or not (c2, c4).
      expect(
        document.querySelector(`[data-testid=assign-row-lms-graded-${id}]`),
      ).toBeNull();
      expect(
        document.querySelector(`[data-testid=assign-row-points-${id}]`),
      ).toBeNull();
      // The removed "Also publish to Google Classroom" control does not
      // exist anywhere, for any class.
      expect(
        document.querySelector(`[data-testid=assign-row-lms-publish-${id}]`),
      ).toBeNull();
      // Every row still carries its own class-specific controls: date and
      // time always; the Classroom topic selector only for the two
      // LMS-linked classes (c1, c3).
      expect(document.querySelector(`[data-testid=assign-row-date-${id}]`)).not.toBeNull();
      expect(document.querySelector(`[data-testid=assign-row-time-${id}]`)).not.toBeNull();
    }
    expect(document.querySelector("[data-testid=assign-row-lms-topic-c1]")).not.toBeNull();
    expect(document.querySelector("[data-testid=assign-row-lms-topic-c3]")).not.toBeNull();
    expect(document.querySelector("[data-testid=assign-row-lms-topic-c2]")).toBeNull();
    expect(document.querySelector("[data-testid=assign-row-lms-topic-c4]")).toBeNull();
  });

  test("default is Ungraded, and Points is inactive until Graded is checked", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    expect(ungradedRadio().checked).toBe(true);
    expect(gradedRadio().checked).toBe(false);
    expect(pointsInput().disabled).toBe(true);

    gradedRadio().click();
    expect(gradedRadio().checked).toBe(true);
    expect(ungradedRadio().checked).toBe(false);
    expect(pointsInput().disabled).toBe(false);
  });

  test("Scenario A: 4 eligible classes selected by default, Graded 20 points sends the same config to all 4", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    // All four are selected by default.
    for (const id of ["c1", "c2", "c3", "c4"]) {
      expect(rowEnabled(id).checked).toBe(true);
    }

    gradedRadio().click();
    setPoints("20");
    confirm();
    await settle();

    expect(asn.draftInputs).toHaveLength(4);
    for (const id of ["c1", "c2", "c3", "c4"]) {
      const draft = asn.draftInputs.find((d) => d.classId === id);
      expect(draft?.classroomGrading).toEqual({ mode: "graded", maxPoints: 20 });
    }
  });

  test("Scenario B: deselecting two classes excludes them from the operation entirely; the remaining two get the shared config", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    rowEnabled("c2").click();
    rowEnabled("c4").click();
    gradedRadio().click();
    setPoints("15");
    confirm();
    await settle();

    expect(asn.draftInputs).toHaveLength(2);
    expect(asn.draftInputs.map((d) => d.classId).sort()).toEqual(["c1", "c3"]);
    for (const id of ["c1", "c3"]) {
      const draft = asn.draftInputs.find((d) => d.classId === id);
      expect(draft?.classroomGrading).toEqual({ mode: "graded", maxPoints: 15 });
    }
    // No draft request was ever made for the deselected classes - they
    // are excluded from the operation itself, not created-then-suppressed.
    expect(asn.draftInputs.some((d) => d.classId === "c2")).toBe(false);
    expect(asn.draftInputs.some((d) => d.classId === "c4")).toBe(false);
  });

  test("Scenario C: Ungraded sends { mode: \"ungraded\" } to every selected class, never a maxPoints value", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    // Leave Graded unchecked (default).
    confirm();
    await settle();

    expect(asn.draftInputs).toHaveLength(4);
    for (const draft of asn.draftInputs) {
      expect(draft.classroomGrading).toEqual({ mode: "ungraded" });
      expect(draft.classroomGrading).not.toHaveProperty("maxPoints");
    }
  });

  test("Scenario D: invalid Points while Graded blocks the entire Assign action - no requests at all", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    gradedRadio().click();
    setPoints("0");

    expect(confirmButton().disabled).toBe(true);
    expect(
      document.querySelector<HTMLElement>("[data-testid=assign-shared-points-invalid]")?.hidden,
    ).toBe(false);

    confirm();
    await settle();
    expect(asn.draftInputs).toHaveLength(0);

    // Fixing the value unblocks the operation for every selected class.
    setPoints("25");
    expect(confirmButton().disabled).toBe(false);
    confirm();
    await settle();
    expect(asn.draftInputs).toHaveLength(4);
    for (const draft of asn.draftInputs) {
      expect(draft.classroomGrading).toEqual({ mode: "graded", maxPoints: 25 });
    }
  });

  test("Scenario D variants: negative, fractional, and missing Points all block submission", async () => {
    for (const bad of ["-5", "2.5", ""]) {
      // Each iteration opens a fresh dialog; remove any prior overlay
      // first so the querySelector helpers below act on the dialog this
      // iteration just opened, not a stale one left over from the last.
      document
        .querySelectorAll("[data-testid=assign-overlay]")
        .forEach((el) => el.remove());
      const asn = okAssignments();
      const it = makeIntegrations();
      const mount = mkMount();
      renderCurriculumSurface(mount, teacher, {
        listClasses: listFour,
        assignments: asn.seam,
        integrations: it.deps,
      });
      await openDialogFor(mount, "earths-layers");
      gradedRadio().click();
      setPoints(bad);
      expect(confirmButton().disabled).toBe(true);
      confirm();
      await settle();
      expect(asn.draftInputs).toHaveLength(0);
    }
  });

  test("Scenario E: deselecting every class blocks the Assign action - no requests at all", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    for (const id of ["c1", "c2", "c3", "c4"]) rowEnabled(id).click();
    expect(confirmButton().disabled).toBe(true);

    confirm();
    await settle();
    expect(asn.draftInputs).toHaveLength(0);

    // Reselecting one class restores its eligibility and unblocks Assign.
    rowEnabled("c1").click();
    expect(confirmButton().disabled).toBe(false);
    confirm();
    await settle();
    expect(asn.draftInputs).toHaveLength(1);
    expect(asn.draftInputs[0]?.classId).toBe("c1");
  });

  test("a stale Points value from a prior Graded session never leaks into an Ungraded submission", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    // Select Graded, set a points value, then select Ungraded again before
    // confirming - the remembered value must not resurrect itself as an
    // active maxPoints once the action is Ungraded again.
    gradedRadio().click();
    setPoints("42");
    ungradedRadio().click();

    confirm();
    await settle();

    expect(asn.draftInputs.length).toBeGreaterThan(0);
    for (const draft of asn.draftInputs) {
      expect(draft.classroomGrading).toEqual({ mode: "ungraded" });
    }
  });
});

describe("Assign dialog - per-class topic isolation (Sprint 30A.1 UX correction)", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("each LMS-linked class card offers only its own course's topics, and different classes can select different topics", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    const c1Topic = document.querySelector<HTMLSelectElement>(
      "[data-testid=assign-row-lms-topic-c1]",
    )!;
    const c3Topic = document.querySelector<HTMLSelectElement>(
      "[data-testid=assign-row-lms-topic-c3]",
    )!;
    // c1's select never receives c3's topic option and vice versa.
    const c1OptionValues = Array.from(c1Topic.options).map((o) => o.value);
    const c3OptionValues = Array.from(c3Topic.options).map((o) => o.value);
    expect(c1OptionValues).toContain("topic-c1-unit1");
    expect(c1OptionValues).not.toContain("topic-c3-unitA");
    expect(c3OptionValues).toContain("topic-c3-unitA");
    expect(c3OptionValues).not.toContain("topic-c1-unit1");

    c1Topic.value = "topic-c1-unit1";
    c1Topic.dispatchEvent(new Event("change"));
    c3Topic.value = "topic-c3-unitA";
    c3Topic.dispatchEvent(new Event("change"));

    confirm();
    await settle();

    // Sprint 30A.1 second human-review correction: both LMS-linked classes
    // are selected by default, so both auto-publish - each with its own
    // chosen topic, never the other's.
    expect(it.publishCalls).toHaveLength(2);
    const c1Publish = it.publishCalls.find((p) => p.linkId === "link-c1");
    const c3Publish = it.publishCalls.find((p) => p.linkId === "link-c3");
    expect(c1Publish?.lmsTopicId).toBe("topic-c1-unit1");
    expect(c3Publish?.lmsTopicId).toBe("topic-c3-unitA");
  });

  test("a deselected class's topic configuration produces no publication work", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    const c1Topic = document.querySelector<HTMLSelectElement>(
      "[data-testid=assign-row-lms-topic-c1]",
    )!;
    c1Topic.value = "topic-c1-unit1";
    c1Topic.dispatchEvent(new Event("change"));

    // Deselect c1 entirely after configuring its topic - no publish toggle
    // to click anymore; selection alone governs publication.
    rowEnabled("c1").click();

    confirm();
    await settle();

    expect(asn.draftInputs.some((d) => d.classId === "c1")).toBe(false);
    // c3 remains selected and LMS-linked, so it still auto-publishes; only
    // c1's publication work is what must be absent.
    expect(it.publishCalls.some((p) => p.linkId === "link-c1")).toBe(false);
  });
});

describe("Assign dialog - per-class schedule isolation (Sprint 30A.1 UX correction)", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("two selected classes can carry different scheduled release times independently", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    const c1Time = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-time-c1]",
    )!;
    const c3Time = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-time-c3]",
    )!;
    c1Time.value = "07:45";
    c1Time.dispatchEvent(new Event("input"));
    c3Time.value = "13:15";
    c3Time.dispatchEvent(new Event("input"));

    expect(c1Time.value).toBe("07:45");
    expect(c3Time.value).toBe("13:15");
    // Setting one class's time never overwrote the other's.
    expect(c1Time.value).not.toBe(c3Time.value);
  });

  test("a deselected class's schedule configuration produces no request", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    const c2Time = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-time-c2]",
    )!;
    c2Time.value = "16:00";
    c2Time.dispatchEvent(new Event("input"));
    rowEnabled("c2").click();

    confirm();
    await settle();

    expect(asn.draftInputs.some((d) => d.classId === "c2")).toBe(false);
  });
});

// Scheduled Classroom publication hardening: every class row carries an
// EXPLICIT Post now / Schedule choice (RowConfig.publishTiming). Post now is
// the default and never sends `availableAt`, whatever the hidden date/time
// inputs hold; Schedule makes that row's resolved date+time the one
// authoritative `availableAt` (which lmsAssignmentsPublish turns into
// Classroom's native `scheduledTime`). This replaces the former implicit
// `scheduleTouched` rule, under which a visibly future date/time could
// still publish immediately.
describe("Assign dialog - explicit Post now / Schedule per class", () => {
  // Only Date is faked, so the harness's setTimeout-based `settle()` keeps
  // working while "now" is pinned for deterministic schedule validation.
  const NOW = new Date(2031, 8, 22, 7, 0, 0, 0).getTime(); // Mon Sep 22 2031, 07:00 local
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
    jest.useFakeTimers({
      now: NOW,
      doNotFake: [
        "setTimeout",
        "clearTimeout",
        "setInterval",
        "clearInterval",
        "setImmediate",
        "clearImmediate",
        "queueMicrotask",
        "nextTick",
        "hrtime",
        "performance",
      ],
    });
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  const byTestId = <T extends HTMLElement>(id: string): T | null =>
    document.querySelector<T>(`[data-testid=${id}]`);
  const chooseSchedule = (classId: string): void => {
    byTestId<HTMLInputElement>(`assign-row-timing-scheduled-${classId}`)!.click();
  };
  const choosePostNow = (classId: string): void => {
    byTestId<HTMLInputElement>(`assign-row-timing-now-${classId}`)!.click();
  };
  const setField = (id: string, value: string): void => {
    const el = byTestId<HTMLInputElement>(id)!;
    el.value = value;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  const setSchedule = (classId: string, date: string, time: string): void => {
    setField(`assign-row-date-${classId}`, date);
    setField(`assign-row-time-${classId}`, time);
  };
  const localIso = (date: string, time: string): string =>
    new Date(`${date}T${time}`).toISOString();

  const openFor = async (
    publishOutcome?: (linkId: string) => Partial<IntegrationsPublicationOutcome>,
  ) => {
    const asn = okAssignments();
    const it = makeIntegrations();
    if (publishOutcome) {
      const base = it.deps.callables.publishAssignment;
      (it.deps.callables as { publishAssignment: unknown }).publishAssignment = async (
        input: { linkId: string },
      ) => ({ ...(await base(input as never)), ...publishOutcome(input.linkId) });
    }
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");
    return { asn, it, mount };
  };
  const draftFor = (asn: ReturnType<typeof okAssignments>, id: string) =>
    asn.draftInputs.find((d) => d.classId === id);

  test("every class defaults to Post now; the date/time controls are hidden, not implied", async () => {
    await openFor();
    for (const id of ["c1", "c2", "c3", "c4"]) {
      expect(byTestId<HTMLInputElement>(`assign-row-timing-now-${id}`)?.checked).toBe(true);
      expect(byTestId<HTMLInputElement>(`assign-row-timing-scheduled-${id}`)?.checked).toBe(false);
      expect(byTestId<HTMLElement>(`assign-row-schedule-${id}`)?.hidden).toBe(true);
      expect(byTestId(`assign-row-${id}`)?.getAttribute("data-publish-timing")).toBe("now");
    }
    const headers = Array.from(
      document.querySelectorAll<HTMLElement>(".shell-assign-rows-header span"),
    ).map((el) => el.textContent);
    expect(headers).toEqual(["", "Class", "Topic", "Posting"]);
  });

  test("1. Post now sends no availableAt and no scheduledTime for any class", async () => {
    const { asn, it } = await openFor();
    confirm();
    await settle();
    expect(asn.draftInputs).toHaveLength(4);
    for (const input of asn.draftInputs) expect(input).not.toHaveProperty("availableAt");
    expect(it.publishCalls.length).toBe(2);
    for (const call of it.publishCalls) expect(call).not.toHaveProperty("scheduledTime");
  });

  test("3. a pre-filled or previously entered future time never schedules a Post now class", async () => {
    const { asn } = await openFor();
    // Enter a real future schedule, then return to Post now: the values stay
    // in the (hidden) inputs but must not be honored.
    chooseSchedule("c1");
    setSchedule("c1", "2031-09-29", "08:00");
    choosePostNow("c1");
    expect(byTestId<HTMLElement>("assign-row-schedule-c1")?.hidden).toBe(true);
    // Writing into a Post now row's hidden inputs is likewise inert.
    setSchedule("c3", "2031-09-30", "09:00");
    confirm();
    await settle();
    expect(draftFor(asn, "c1")).not.toHaveProperty("availableAt");
    expect(draftFor(asn, "c3")).not.toHaveProperty("availableAt");
  });

  test("2 + 4. choosing Schedule makes that row's resolved date/time the authoritative availableAt", async () => {
    const { asn, it } = await openFor();
    chooseSchedule("c1");
    expect(byTestId<HTMLElement>("assign-row-schedule-c1")?.hidden).toBe(false);
    setSchedule("c1", "2031-09-29", "08:00");
    confirm();
    await settle();
    expect(draftFor(asn, "c1")?.availableAt).toBe(localIso("2031-09-29", "08:00"));
    // The publish request itself carries no schedule: the server derives
    // Classroom scheduledTime from the stored availableAt.
    const c1Publish = it.publishCalls.find((p) => p.linkId === "link-c1");
    expect(c1Publish).toBeDefined();
    expect(c1Publish).not.toHaveProperty("scheduledTime");
  });

  test("5 + 6. Post now A, Schedule B 8:00, Schedule C 9:00: each class keeps its own timing", async () => {
    const { asn } = await openFor();
    // c1 stays Post now.
    chooseSchedule("c2");
    setSchedule("c2", "2031-09-29", "08:00");
    chooseSchedule("c3");
    setSchedule("c3", "2031-09-29", "09:00");
    chooseSchedule("c4");
    setSchedule("c4", "2031-09-30", "08:00");
    confirm();
    await settle();
    expect(draftFor(asn, "c1")).not.toHaveProperty("availableAt");
    expect(draftFor(asn, "c2")?.availableAt).toBe(localIso("2031-09-29", "08:00"));
    expect(draftFor(asn, "c3")?.availableAt).toBe(localIso("2031-09-29", "09:00"));
    expect(draftFor(asn, "c4")?.availableAt).toBe(localIso("2031-09-30", "08:00"));
  });

  test("the first selected class's schedule never leaks into another row", async () => {
    const { asn } = await openFor();
    chooseSchedule("c1");
    setSchedule("c1", "2031-09-29", "08:00");
    // c3 chooses Schedule AFTER c1 was edited: it must seed from its own
    // pre-filled values, never from c1's.
    chooseSchedule("c3");
    const c3Date = byTestId<HTMLInputElement>("assign-row-date-c3")!.value;
    const c3Time = byTestId<HTMLInputElement>("assign-row-time-c3")!.value;
    expect(`${c3Date}T${c3Time}`).not.toBe("2031-09-29T08:00");
    confirm();
    await settle();
    expect(draftFor(asn, "c3")?.availableAt).toBe(localIso(c3Date, c3Time));
    expect(draftFor(asn, "c3")?.availableAt).not.toBe(draftFor(asn, "c1")?.availableAt);
    expect(draftFor(asn, "c2")).not.toHaveProperty("availableAt");
  });

  test("choosing Schedule when the remembered time has already passed today seeds tomorrow, and shows the resolved posting time", async () => {
    // Now is 07:00; set the clock to 09:00 so today's 07:45 default is past.
    jest.setSystemTime(new Date(2031, 8, 22, 9, 0, 0, 0));
    const { asn } = await openFor();
    chooseSchedule("c1");
    expect(byTestId<HTMLInputElement>("assign-row-date-c1")?.value).toBe("2031-09-23");
    expect(byTestId<HTMLInputElement>("assign-row-time-c1")?.value).toBe("07:45");
    const preview = byTestId<HTMLElement>("assign-row-schedule-preview-c1")?.textContent ?? "";
    expect(preview).toMatch(/^Posts Tue, Sep 23 at 7:45 AM \S+$/);
    expect(byTestId<HTMLElement>("assign-row-schedule-invalid-c1")?.hidden).toBe(true);
    confirm();
    await settle();
    expect(draftFor(asn, "c1")?.availableAt).toBe(localIso("2031-09-23", "07:45"));
  });

  test("choosing Schedule while today's remembered time is still ahead seeds today", async () => {
    const { asn } = await openFor(); // now 07:00, default 07:45
    chooseSchedule("c1");
    expect(byTestId<HTMLInputElement>("assign-row-date-c1")?.value).toBe("2031-09-22");
    confirm();
    await settle();
    expect(draftFor(asn, "c1")?.availableAt).toBe(localIso("2031-09-22", "07:45"));
  });

  test("7. a scheduled class with a missing date or time blocks Assign with a clear message and sends nothing", async () => {
    const { asn } = await openFor();
    chooseSchedule("c1");
    setField("assign-row-date-c1", "");
    const invalid = byTestId<HTMLElement>("assign-row-schedule-invalid-c1")!;
    expect(invalid.hidden).toBe(false);
    expect(invalid.textContent).toBe("Choose a posting date and time.");
    expect(byTestId<HTMLInputElement>("assign-row-date-c1")?.getAttribute("aria-invalid")).toBe("true");
    expect(confirmButton().disabled).toBe(true);
    confirm();
    await settle();
    expect(asn.draftInputs).toHaveLength(0);
  });

  test("8. a scheduled time already in the past is rejected, never silently posted now", async () => {
    const { asn } = await openFor();
    chooseSchedule("c1");
    setSchedule("c1", "2031-09-22", "06:30");
    expect(byTestId<HTMLElement>("assign-row-schedule-invalid-c1")?.textContent).toBe(
      "Choose a time at least 2 minutes from now, or choose Post now.",
    );
    expect(confirmButton().disabled).toBe(true);
    confirm();
    await settle();
    expect(asn.draftInputs).toHaveLength(0);
  });

  test("9. near-now: 1 minute ahead is rejected (the server would post it immediately); 2 minutes ahead is accepted", async () => {
    const { asn } = await openFor(); // now is exactly 07:00:00
    chooseSchedule("c1");
    setSchedule("c1", "2031-09-22", "07:01");
    expect(byTestId<HTMLElement>("assign-row-schedule-invalid-c1")?.hidden).toBe(false);
    expect(confirmButton().disabled).toBe(true);
    setSchedule("c1", "2031-09-22", "07:02");
    expect(byTestId<HTMLElement>("assign-row-schedule-invalid-c1")?.hidden).toBe(true);
    expect(confirmButton().disabled).toBe(false);
    confirm();
    await settle();
    expect(draftFor(asn, "c1")?.availableAt).toBe(localIso("2031-09-22", "07:02"));
  });

  test("a schedule that was valid when entered but has since passed is re-checked at Assign time and refused", async () => {
    const { asn } = await openFor();
    chooseSchedule("c1");
    setSchedule("c1", "2031-09-22", "07:10");
    expect(confirmButton().disabled).toBe(false);
    // The teacher leaves the dialog open past the chosen time.
    jest.setSystemTime(new Date(2031, 8, 22, 7, 9, 30, 0));
    confirm();
    await settle();
    expect(asn.draftInputs).toHaveLength(0);
    expect(byTestId<HTMLElement>("assign-row-schedule-invalid-c1")?.hidden).toBe(false);
    expect(confirmButton().disabled).toBe(true);
    expect(byTestId("assign-dialog")).not.toBeNull();
  });

  test("a posting time after the end of the due date is rejected; one earlier that day is accepted", async () => {
    const { asn } = await openFor();
    setField("assign-shared-due-date", "2031-09-29");
    chooseSchedule("c1");
    setSchedule("c1", "2031-09-30", "08:00");
    expect(byTestId<HTMLElement>("assign-row-schedule-invalid-c1")?.textContent).toBe(
      "Choose a posting time before the due date.",
    );
    expect(confirmButton().disabled).toBe(true);
    setSchedule("c1", "2031-09-29", "23:59");
    expect(confirmButton().disabled).toBe(true);
    setSchedule("c1", "2031-09-29", "20:00");
    expect(confirmButton().disabled).toBe(false);
    // Moving the due date re-validates every scheduled row immediately.
    setField("assign-shared-due-date", "2031-09-28");
    expect(byTestId<HTMLElement>("assign-row-schedule-invalid-c1")?.hidden).toBe(false);
    expect(confirmButton().disabled).toBe(true);
    setField("assign-shared-due-date", "2031-09-29");
    confirm();
    await settle();
    expect(draftFor(asn, "c1")?.availableAt).toBe(localIso("2031-09-29", "20:00"));
    expect(draftFor(asn, "c1")?.dueDate).toBe("2031-09-29");
  });

  test("a deselected scheduled class shows no validation message and never blocks Assign", async () => {
    const { asn } = await openFor();
    chooseSchedule("c1");
    setField("assign-row-date-c1", "");
    expect(confirmButton().disabled).toBe(true);
    rowEnabled("c1").click();
    expect(byTestId<HTMLElement>("assign-row-schedule-invalid-c1")?.hidden).toBe(true);
    expect(confirmButton().disabled).toBe(false);
    expect(byTestId<HTMLInputElement>("assign-row-timing-scheduled-c1")?.disabled).toBe(true);
    confirm();
    await settle();
    expect(draftFor(asn, "c1")).toBeUndefined();
  });

  test("a scheduled class with no Classroom link still delays LyfeLabz availability", async () => {
    const { asn, it } = await openFor();
    chooseSchedule("c2");
    setSchedule("c2", "2031-09-29", "08:00");
    confirm();
    await settle();
    expect(draftFor(asn, "c2")?.availableAt).toBe(localIso("2031-09-29", "08:00"));
    expect(it.publishCalls.find((p) => p.linkId === "link-c2")).toBeUndefined();
  });

  test("the remembered release time is learned only from a class that was actually scheduled", async () => {
    const first = await openFor();
    // A Post now row's hidden time is inert and must not become the default.
    setField("assign-row-time-c1", "10:10");
    chooseSchedule("c3");
    setSchedule("c3", "2031-09-29", "08:20");
    confirm();
    await settle();
    expect(draftFor(first.asn, "c3")?.availableAt).toBe(localIso("2031-09-29", "08:20"));
    first.mount
      .querySelector<HTMLButtonElement>("[data-testid=lesson-assign-what-is-life]")
      ?.click();
    await settle();
    // Newly offered rows seed from the scheduled class's time, and still
    // default to Post now.
    expect(byTestId<HTMLInputElement>("assign-row-time-c2")?.value).toBe("08:20");
    expect(byTestId<HTMLInputElement>("assign-row-timing-now-c2")?.checked).toBe(true);
  });

  test("result wording: all scheduled says Scheduled in Google Classroom, never that it was published", async () => {
    const { mount } = await openFor(() => ({ lmsInitialState: "draft" }));
    chooseSchedule("c1");
    setSchedule("c1", "2031-09-29", "08:00");
    chooseSchedule("c3");
    setSchedule("c3", "2031-09-29", "09:00");
    confirm();
    await settle();
    const text = mount.querySelector("[data-testid=assign-success]")?.textContent ?? "";
    expect(text).toContain("Scheduled in Google Classroom for 2 classes.");
    expect(text).not.toContain("Publishing to Google Classroom succeeded");
  });

  test("result wording: one immediate and one scheduled Classroom class are reported separately", async () => {
    const { mount } = await openFor((linkId) => ({
      lmsInitialState: linkId === "link-c3" ? "draft" : "published",
    }));
    chooseSchedule("c3");
    setSchedule("c3", "2031-09-29", "09:00");
    confirm();
    await settle();
    const text = mount.querySelector("[data-testid=assign-success]")?.textContent ?? "";
    expect(text).toContain("Published to Google Classroom for 1 class and scheduled for 1 class.");
  });

  test("result wording: the server decides - a schedule the server posted immediately is reported as published", async () => {
    const { mount } = await openFor(() => ({ lmsInitialState: "published" }));
    chooseSchedule("c1");
    setSchedule("c1", "2031-09-29", "08:00");
    confirm();
    await settle();
    const text = mount.querySelector("[data-testid=assign-success]")?.textContent ?? "";
    expect(text).toContain("Publishing to Google Classroom succeeded.");
    expect(text).not.toContain("Scheduled");
  });
});

describe("Assign dialog - shared Due Date (Sprint 30A.3)", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  const dueDateInput = (): HTMLInputElement =>
    document.querySelector<HTMLInputElement>(
      "[data-testid=assign-shared-due-date]",
    )!;

  test("Due Date is a single shared field, not one per class row", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    expect(
      document.querySelectorAll("[data-testid=assign-shared-due-date]"),
    ).toHaveLength(1);
  });

  test("setting a Due Date stores it identically on every selected class's draft; publish requests carry none (server derives it)", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    dueDateInput().value = "2026-09-23";
    dueDateInput().dispatchEvent(new Event("input"));

    confirm();
    await settle();

    // Durable assignment configuration: every selected class's draft
    // (LMS-linked or not) carries the same canonical "YYYY-MM-DD" value.
    expect(asn.draftInputs.length).toBe(4);
    for (const input of asn.draftInputs) {
      expect(input.dueDate).toBe("2026-09-23");
    }
    // lmsAssignmentsPublish reads it from the stored assignment, so the
    // client is not authoritative for it at publication time.
    expect(it.publishCalls.length).toBeGreaterThan(0);
    for (const call of it.publishCalls) {
      expect(call).not.toHaveProperty("dueDate");
    }
  });

  test("leaving Due Date empty stores no dueDate on any draft and sends none", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    confirm();
    await settle();

    expect(asn.draftInputs.length).toBeGreaterThan(0);
    for (const input of asn.draftInputs) {
      expect(input).not.toHaveProperty("dueDate");
    }
    expect(it.publishCalls.length).toBeGreaterThan(0);
    for (const call of it.publishCalls) {
      expect(call).not.toHaveProperty("dueDate");
    }
  });
});

// Sprint 30A.1 FINAL UI POLISH (human review): the column heading above
// the per-row Google Classroom topic control changed from "Google
// Classroom topic" to the shorter "Topic" - the teacher already knows
// this is an Assign dialog for their Classroom-integrated workspace, so
// repeating "Google Classroom" in the heading was redundant.
describe("Assign dialog - Topic column heading (Sprint 30A.1 final UI polish)", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("the topic column heading reads 'Topic', never the old 'Google Classroom topic'", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    const headerCells = Array.from(
      document.querySelectorAll<HTMLElement>(".shell-assign-rows-header span"),
    ).map((el) => el.textContent);
    expect(headerCells).toContain("Topic");
    expect(headerCells).not.toContain("Google Classroom topic");
    expect(headerCells).not.toContain("GOOGLE CLASSROOM TOPIC");

    const dialogText =
      document.querySelector("[data-testid=assign-dialog]")?.textContent ?? "";
    expect(dialogText).not.toContain("Google Classroom topic");
  });
});

// Sprint 30A.1 FINAL UI POLISH (human review): deselecting a class must
// visibly dim its row, disable its Topic/Date/Time controls, keep the
// class name rendered and readable, never remove the row, and never
// disturb the canonical class order.
describe("Assign dialog - deselected row state (Sprint 30A.1 final UI polish)", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("deselecting a class disables its Topic/Date/Time controls, keeps the row and its class name, and preserves order", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    const orderBefore = Array.from(
      document.querySelectorAll<HTMLElement>(".shell-assign-class-row"),
    ).map((el) => el.getAttribute("data-class-id"));

    const row = document.querySelector<HTMLElement>("[data-testid=assign-row-c1]")!;
    rowEnabled("c1").click();

    // Row is dimmed, not removed.
    expect(document.querySelector("[data-testid=assign-row-c1]")).not.toBeNull();
    expect(row.classList.contains("shell-assign-row-disabled")).toBe(true);
    // Topic/Date/Time controls are disabled.
    expect(
      document.querySelector<HTMLSelectElement>("[data-testid=assign-row-lms-topic-c1]")
        ?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>("[data-testid=assign-row-date-c1]")?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLInputElement>("[data-testid=assign-row-time-c1]")?.disabled,
    ).toBe(true);
    // The class name still renders, in the same row.
    expect(
      document.querySelector("[data-testid=assign-row-c1] .shell-assign-row-identity")
        ?.textContent,
    ).toContain("A Science");

    // Canonical order (row position among all four) is unchanged by
    // deselection - only the checkbox state and disabled controls
    // changed.
    const orderAfter = Array.from(
      document.querySelectorAll<HTMLElement>(".shell-assign-class-row"),
    ).map((el) => el.getAttribute("data-class-id"));
    expect(orderAfter).toEqual(orderBefore);
  });
});

// Sprint 30A.1 FINAL UI POLISH (human review): a compact "N classes
// selected" status near the footer's Cancel/Assign controls, updating
// live as checkboxes change, with correct 0/1/plural wording.
describe("Assign dialog - selected-class count (Sprint 30A.1 final UI polish)", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("the count reflects 4 selected by default, updates live, and uses correct singular/plural/zero wording", async () => {
    const asn = okAssignments();
    const it = makeIntegrations();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFour,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    expect(selectedCount()).toBe("4 classes selected");

    rowEnabled("c1").click();
    expect(selectedCount()).toBe("3 classes selected");

    rowEnabled("c2").click();
    rowEnabled("c3").click();
    expect(selectedCount()).toBe("1 class selected");

    rowEnabled("c4").click();
    expect(selectedCount()).toBe("0 classes selected");
    expect(confirmButton().disabled).toBe(true);

    rowEnabled("c4").click();
    expect(selectedCount()).toBe("1 class selected");
    expect(confirmButton().disabled).toBe(false);
  });
});
