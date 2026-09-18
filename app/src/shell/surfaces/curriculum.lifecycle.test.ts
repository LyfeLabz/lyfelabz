/**
 * @jest-environment jsdom
 *
 * Curriculum lifecycle UI slice tests. Exercises the five-state lifecycle
 * UX driven by assignmentsLifecycleState, the Update Assignment path
 * (recipientsReconcile), multiple-published disambiguation, error
 * handling, class invalidation, and the removal of "Reassign" terminology.
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type {
  AssignmentsCallables,
  AssignmentsLifecycleStateOutput,
  AssignmentCandidate,
} from "../../settings/integrations/types";
import type { AssignmentDetailMetadata } from "../../assignments/detail/types";
import {
  renderCurriculumSurface,
  _resetCurriculumSessionStateForTest,
  invalidateCurriculumClassCache,
} from "./curriculum";

const freeze = <T>(v: T): T => Object.freeze(v) as T;

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));

const teacher: Extract<Session, { kind: "activeTeacher" }> = freeze({
  kind: "activeTeacher",
  uid: "u-teacher",
  schoolId: "school-abc",
  displayName: "Ada Lovelace",
});

const oneClass: ReadonlyArray<ClassSummary> = freeze([
  freeze({ id: "c1", title: "6A", grade: "6", status: "active" }),
] as ClassSummary[]);

const twoClasses: ReadonlyArray<ClassSummary> = freeze([
  freeze({ id: "c1", title: "6A", grade: "6", status: "active" }),
  freeze({ id: "c2", title: "6B", grade: "6", status: "active" }),
] as ClassSummary[]);

const threeClasses: ReadonlyArray<ClassSummary> = freeze([
  freeze({ id: "c1", title: "6A", grade: "6", status: "active" }),
  freeze({ id: "c2", title: "6B", grade: "6", status: "active" }),
  freeze({ id: "c3", title: "7A", grade: "7", status: "active" }),
] as ClassSummary[]);

const listOne: ListClasses = () => Promise.resolve(oneClass);
const listTwo: ListClasses = () => Promise.resolve(twoClasses);
const listThree: ListClasses = () => Promise.resolve(threeClasses);

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const LESSON_SLUG = "earths-layers";

const publishedCandidate = (
  overrides?: Partial<AssignmentCandidate>,
): AssignmentCandidate =>
  freeze({
    assignmentId: "a-1",
    title: "Earth's Layers",
    status: "published",
    publishedAt: 1700000000000,
    recipientCount: 5,
    activeEnrollmentCount: 7,
    missingRecipientCount: 2,
    ...overrides,
  });

type LifecycleOverrides = Partial<{
  [classId: string]: AssignmentsLifecycleStateOutput;
}>;

const makeAssignments = (
  lcOverrides: LifecycleOverrides = {},
  opts: {
    reconcileAdded?: number;
    failReconcile?: boolean;
    // Historical Assignment Resolution, Implementation Slice 10.
    currentReconcileAdded?: number;
    failCurrentReconcile?: boolean;
  } = {},
): {
  seam: AssignmentsCallables;
  reconcileCalls: string[];
  currentReconcileCalls: Array<{ readonly classId: string; readonly lessonSlug: string }>;
  draftCalls: string[];
} => {
  const reconcileCalls: string[] = [];
  const currentReconcileCalls: Array<{ readonly classId: string; readonly lessonSlug: string }> = [];
  const draftCalls: string[] = [];
  return {
    reconcileCalls,
    currentReconcileCalls,
    draftCalls,
    seam: {
      createDraft: async (input) => {
        draftCalls.push(input.classId ?? input.assignmentId);
        return {
          assignmentId: input.assignmentId,
          status: "draft" as const,
          alreadyCreated: false,
        };
      },
      publish: async (input) => ({
        assignmentId: input.assignmentId,
        status: "published" as const,
        alreadyPublished: false,
      }),
      lifecycleState: async (input) => {
        const override = lcOverrides[input.classId];
        if (override) return override;
        return { state: "neverAssigned" as const, currentAssignmentId: null, currentAssignmentResolution: "unresolved" as const, candidates: [] };
      },
      // Historical Assignment Resolution, Implementation Slice 10. Models
      // the real server's own behavior: the request never carries an
      // assignmentId, and the "resolved" assignmentId returned is whatever
      // the fixture's own `currentAssignmentId` says Current is - exactly
      // as the real `assignmentsCurrentRecipientsReconcile` independently
      // resolves live Current server-side rather than trusting anything
      // the client sent.
      currentRecipientsReconcile: async (input) => {
        currentReconcileCalls.push({
          classId: input.classId,
          lessonSlug: input.lessonSlug,
        });
        if (opts.failCurrentReconcile) {
          throw new Error("current reconcile failed");
        }
        const resolvedAssignmentId =
          lcOverrides[input.classId]?.currentAssignmentId ?? "a-resolved";
        return {
          classId: input.classId,
          lessonSlug: input.lessonSlug,
          assignmentId: resolvedAssignmentId,
          added: opts.currentReconcileAdded ?? 0,
          alreadyCurrent: 0,
        };
      },
      recipientsReconcile: async (input) => {
        reconcileCalls.push(input.assignmentId);
        if (opts.failReconcile) throw new Error("reconcile failed");
        return {
          assignmentId: input.assignmentId,
          added: opts.reconcileAdded ?? 0,
          alreadyCurrent: 0,
        };
      },
    },
  };
};

const makeDetailSeam = (
  hydrated: ReadonlyArray<AssignmentDetailMetadata> = [],
) => {
  const registered: AssignmentDetailMetadata[] = [];
  return {
    registered,
    seam: {
      register: (m: AssignmentDetailMetadata) => {
        registered.push({ ...m });
      },
      open: () => undefined,
      list: () => [...hydrated, ...registered],
    },
  };
};

const makeFailingLifecycleSeam = (): AssignmentsCallables => ({
  createDraft: async (input) => ({
    assignmentId: input.assignmentId,
    status: "draft" as const,
    alreadyCreated: false,
  }),
  publish: async (input) => ({
    assignmentId: input.assignmentId,
    status: "published" as const,
    alreadyPublished: false,
  }),
  lifecycleState: async () => {
    throw new Error("network error");
  },
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
});

const clickAssign = (mount: HTMLElement, slug: string): void => {
  mount
    .querySelector<HTMLButtonElement>(`[data-testid=lesson-assign-${slug}]`)
    ?.click();
};

const clickConfirm = (): void => {
  document
    .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")
    ?.click();
};

describe("Curriculum lifecycle UI", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  // ---- 1. No "Reassign" text anywhere ----

  test("no button or element contains the word Reassign", () => {
    const asn = makeAssignments();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    const allText = mount.textContent ?? "";
    expect(allText).not.toContain("Reassign");
  });

  test("never-assigned lesson shows 'Assign' button text", () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, { listClasses: listOne });
    const btn = mount.querySelector<HTMLButtonElement>(
      `[data-testid=lesson-assign-${LESSON_SLUG}]`,
    )!;
    expect(btn.textContent).toBe("Assign");
  });

  test("previously-assigned lesson shows 'Update Assignment' button text", () => {
    const hydrated: AssignmentDetailMetadata[] = [
      freeze({
        assignmentId: "a-1",
        title: "Earth's Layers",
        status: "published",
        className: "6A",
        lessonSlug: LESSON_SLUG,
        classId: "c1",
      }) as AssignmentDetailMetadata,
    ];
    const detail = makeDetailSeam(hydrated);
    const asn = makeAssignments();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    const btn = mount.querySelector<HTMLButtonElement>(
      `[data-testid=lesson-assign-${LESSON_SLUG}]`,
    )!;
    expect(btn.textContent).toBe("Update Assignment");
    expect(btn.classList.contains("shell-lesson-assigned-action")).toBe(true);
    expect(btn.classList.contains("shell-lesson-reassign")).toBe(false);
  });

  // ---- 2. Five-state lifecycle rendering in dialog ----

  test("neverAssigned class row has no lifecycle badge", async () => {
    const asn = makeAssignments();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const badge = document.querySelector(
      "[data-testid=assign-row-lifecycle-c1]",
    );
    const row = document.querySelector("[data-class-id=c1]");
    expect(row?.getAttribute("data-lifecycle-state")).toBe("neverAssigned");
    expect(badge?.textContent).toBeFalsy();
  });

  test("onePublishedMissingRecipients row shows student count badge", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedMissingRecipients",
        currentAssignmentId: "a-1",
        currentAssignmentResolution: "valid" as const,
        candidates: [publishedCandidate({ missingRecipientCount: 3 })],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const badge = document.querySelector(
      "[data-testid=assign-row-lifecycle-c1]",
    );
    expect(badge?.textContent).toBe("3 students to add");
    const row = document.querySelector("[data-class-id=c1]");
    expect(row?.getAttribute("data-lifecycle-state")).toBe(
      "onePublishedMissingRecipients",
    );
  });

  test("onePublishedFullyCurrent row shows Up to date and is disabled", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedFullyCurrent",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ missingRecipientCount: 0 }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const badge = document.querySelector(
      "[data-testid=assign-row-lifecycle-c1]",
    );
    expect(badge?.textContent).toBe("Up to date");
    const checkbox = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c1]",
    );
    expect(checkbox?.disabled).toBe(true);
    expect(checkbox?.checked).toBe(false);
  });

  test("historicalOnly row shows 'Assign as new' badge", async () => {
    const asn = makeAssignments({
      c1: {
        state: "historicalOnly",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          freeze({
            assignmentId: "a-old",
            title: "Old",
            status: "closed",
            publishedAt: null,
            recipientCount: 0,
            activeEnrollmentCount: 0,
            missingRecipientCount: 0,
          }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const badge = document.querySelector(
      "[data-testid=assign-row-lifecycle-c1]",
    );
    expect(badge?.textContent).toBe("Assign as new");
  });

  test("multiplePublished row with valid Current is actionable with no radio group", async () => {
    // Historical Assignment Resolution, Implementation Slice 10: the old
    // disambiguation radio group is removed entirely. A multiplePublished
    // row whose Current pointer resolves to "valid" is auto-actionable -
    // Update Assignment targets the server-resolved Current directly, no
    // client-side selection of which historical assignment to update.
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-2",
        currentAssignmentResolution: "valid" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1" }),
          publishedCandidate({ assignmentId: "a-2", title: "Second" }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const row = document.querySelector("[data-class-id='c1']");
    expect(
      document.querySelector("[data-testid=assign-row-disambig-c1]"),
    ).toBeNull();
    expect(row?.querySelector('input[type="radio"]')).toBeNull();
    const checkbox = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c1]",
    );
    expect(checkbox?.disabled).toBe(false);
  });

  test("multiplePublished row with unresolved Current shows needs-resolution badge and is disabled", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1" }),
          publishedCandidate({ assignmentId: "a-2", title: "Second" }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    expect(
      document.querySelector("[data-testid=assign-row-disambig-c1]"),
    ).toBeNull();
    const badge = document.querySelector(
      "[data-testid=assign-row-lifecycle-c1]",
    );
    expect(badge?.textContent).toBe("Needs resolution before updating");
    const checkbox = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c1]",
    );
    expect(checkbox?.disabled).toBe(true);
    expect(checkbox?.checked).toBe(false);
  });

  test("multiplePublished row with invalid Current fails safe and is disabled", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "invalid" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1" }),
          publishedCandidate({ assignmentId: "a-2", title: "Second" }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    expect(
      document.querySelector("[data-testid=assign-row-disambig-c1]"),
    ).toBeNull();
    const checkbox = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c1]",
    );
    expect(checkbox?.disabled).toBe(true);
    expect(checkbox?.checked).toBe(false);
    const badge = document.querySelector(
      "[data-testid=assign-row-lifecycle-c1]",
    );
    expect(badge?.textContent).toBe("Current assignment could not be verified");
    // Never exposes internal resolver reasons to the teacher.
    expect(document.body.textContent).not.toMatch(
      /pointerMissing|pointerMalformed|assignmentMissing|CurrentAssignment/,
    );
  });

  // ---- 3. Update path calls recipientsReconcile only ----

  test("update row calls currentRecipientsReconcile, not createDraft, publish, or the old recipientsReconcile", async () => {
    const asn = makeAssignments(
      {
        c1: {
          state: "onePublishedMissingRecipients",
          currentAssignmentId: "a-1",
          currentAssignmentResolution: "valid" as const,
          candidates: [publishedCandidate()],
        },
      },
      { currentReconcileAdded: 2 },
    );
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();
    expect(asn.currentReconcileCalls).toEqual([
      { classId: "c1", lessonSlug: LESSON_SLUG },
    ]);
    expect(asn.reconcileCalls).toHaveLength(0);
    expect(asn.draftCalls).toHaveLength(0);
  });

  test("update row's currentRecipientsReconcile request contains only classId and lessonSlug (stale-client guarantee)", async () => {
    // Historical Assignment Resolution, Implementation Slice 10: the client
    // never sends an assignmentId/currentAssignmentId/expectedCurrentAssignmentId
    // for the normal Update Assignment path. The server independently
    // resolves live Current; a stale client can never point it at a
    // different assignment.
    const asn = makeAssignments({
      c1: {
        state: "onePublishedMissingRecipients",
        currentAssignmentId: "a-1",
        currentAssignmentResolution: "valid" as const,
        candidates: [publishedCandidate()],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();
    expect(asn.currentReconcileCalls).toHaveLength(1);
    expect(Object.keys(asn.currentReconcileCalls[0]).sort()).toEqual(
      ["classId", "lessonSlug"].sort(),
    );
  });

  test("creation row calls createDraft, not recipientsReconcile", async () => {
    const asn = makeAssignments();
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();
    expect(asn.draftCalls.length).toBeGreaterThan(0);
    expect(asn.reconcileCalls).toHaveLength(0);
  });

  // ---- 4. Mixed classes: creation + update in same dialog ----

  test("mixed dialog: creation class runs lifecycle, update class runs currentRecipientsReconcile", async () => {
    const asn = makeAssignments(
      {
        c2: {
          state: "onePublishedMissingRecipients",
          currentAssignmentId: "a-c2",
          currentAssignmentResolution: "valid" as const,
          candidates: [
            publishedCandidate({ assignmentId: "a-c2" }),
          ],
        },
      },
      { currentReconcileAdded: 1 },
    );
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();
    expect(asn.draftCalls.length).toBeGreaterThan(0);
    expect(asn.currentReconcileCalls).toEqual([
      { classId: "c2", lessonSlug: LESSON_SLUG },
    ]);
    expect(asn.reconcileCalls).toHaveLength(0);
  });

  test("multi-class dialog: one Assign, one valid Update, one unresolved blocked - each row independent", async () => {
    // Historical Assignment Resolution, Implementation Slice 10: Current
    // resolution is per-row/per-class. A dialog spanning three classes in
    // three different states must handle each independently: c1 is a
    // brand-new Assign, c2 has a valid Current and updates it, c3 has an
    // unresolved Current and must be blocked with no mutation.
    const asn = makeAssignments(
      {
        c2: {
          state: "onePublishedMissingRecipients",
          currentAssignmentId: "a-c2",
          currentAssignmentResolution: "valid" as const,
          candidates: [publishedCandidate({ assignmentId: "a-c2" })],
        },
        c3: {
          state: "onePublishedMissingRecipients",
          currentAssignmentId: null,
          currentAssignmentResolution: "unresolved" as const,
          candidates: [publishedCandidate({ assignmentId: "a-c3" })],
        },
      },
      { currentReconcileAdded: 1 },
    );
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listThree,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const c3Checkbox = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c3]",
    );
    expect(c3Checkbox?.disabled).toBe(true);
    clickConfirm();
    await flush();
    await flush();
    await flush();
    expect(asn.draftCalls).toContain("c1");
    expect(asn.currentReconcileCalls).toEqual([
      { classId: "c2", lessonSlug: LESSON_SLUG },
    ]);
    expect(asn.reconcileCalls).toHaveLength(0);
  });

  // ---- 5. Up-to-date class not included in confirm ----

  test("up-to-date class is excluded from confirm action", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedFullyCurrent",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ missingRecipientCount: 0 }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    expect(asn.reconcileCalls).toHaveLength(0);
    expect(asn.draftCalls).toHaveLength(0);
  });

  // ---- 6. Reconcile error handling ----

  test("reconcile failure produces a safe error summary", async () => {
    const asn = makeAssignments(
      {
        c1: {
          state: "onePublishedMissingRecipients",
          currentAssignmentId: "a-1",
          currentAssignmentResolution: "valid" as const,
          candidates: [publishedCandidate()],
        },
      },
      { failCurrentReconcile: true },
    );
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();
    const banner = mount.querySelector<HTMLElement>(
      "[data-testid=assign-success]",
    );
    expect(banner?.textContent).toContain("did not succeed");
  });

  // ---- 7. Lifecycle state loading failure - write-safe unresolved state ----

  test("lifecycle state load failure puts class in unresolved state, not neverAssigned", async () => {
    const seam = makeFailingLifecycleSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const row = document.querySelector("[data-class-id=c1]");
    expect(row?.getAttribute("data-lifecycle-state")).toBe("unresolved");
    expect(row?.getAttribute("data-lifecycle-state")).not.toBe("neverAssigned");
  });

  // ---- 8. Cache invalidation on class change ----

  test("invalidateCurriculumClassCache clears lifecycle cache", async () => {
    const calls: string[] = [];
    const seam: AssignmentsCallables = {
      createDraft: async (input) => ({
        assignmentId: input.assignmentId,
        status: "draft" as const,
        alreadyCreated: false,
      }),
      publish: async (input) => ({
        assignmentId: input.assignmentId,
        status: "published" as const,
        alreadyPublished: false,
      }),
      lifecycleState: async (input) => {
        calls.push(input.classId);
        return { state: "neverAssigned" as const, currentAssignmentId: null, currentAssignmentResolution: "unresolved" as const, candidates: [] };
      },
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
    };
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });

    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const firstCallCount = calls.length;
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-cancel]")
      ?.click();

    invalidateCurriculumClassCache();

    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    expect(calls.length).toBeGreaterThan(firstCallCount);
  });

  // ---- 9. No runAssignmentLifecycle for update ----

  test("update path never calls createDraft or publish", async () => {
    const asn = makeAssignments(
      {
        c1: {
          state: "onePublishedMissingRecipients",
          currentAssignmentId: "a-1",
          currentAssignmentResolution: "valid" as const,
          candidates: [publishedCandidate()],
        },
        c2: {
          state: "onePublishedMissingRecipients",
          currentAssignmentId: "a-2",
          currentAssignmentResolution: "valid" as const,
          candidates: [
            publishedCandidate({ assignmentId: "a-2" }),
          ],
        },
      },
      { currentReconcileAdded: 1 },
    );
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();
    expect(asn.draftCalls).toHaveLength(0);
    expect(asn.reconcileCalls).toHaveLength(0);
    expect(asn.currentReconcileCalls.length).toBe(2);
  });

  // ---- 10. Creation row still renders date/time controls ----

  test("neverAssigned row renders date and time inputs", async () => {
    const asn = makeAssignments();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    expect(
      document.querySelector("[data-testid=assign-row-date-c1]"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-time-c1]"),
    ).not.toBeNull();
  });

  test("update row does not render date and time inputs", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedMissingRecipients",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [publishedCandidate()],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    expect(
      document.querySelector("[data-testid=assign-row-date-c1]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-time-c1]"),
    ).toBeNull();
  });

  // ---- 11. Accessibility ----

  test("multiplePublished row with valid Current has descriptive checkbox aria-label", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-2",
        currentAssignmentResolution: "valid" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1" }),
          publishedCandidate({ assignmentId: "a-2" }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const checkbox = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c1]",
    );
    expect(checkbox?.getAttribute("aria-label")).toBe(
      "Update assignment for 6A",
    );
  });

  test("up-to-date checkbox has descriptive aria-label", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedFullyCurrent",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ missingRecipientCount: 0 }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const checkbox = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c1]",
    );
    expect(checkbox?.getAttribute("aria-label")).toContain("up to date");
  });

  // ---- 12. Singular student count ----

  test("single missing student shows singular form", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedMissingRecipients",
        currentAssignmentId: "a-1",
        currentAssignmentResolution: "valid" as const,
        candidates: [publishedCandidate({ missingRecipientCount: 1 })],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const badge = document.querySelector(
      "[data-testid=assign-row-lifecycle-c1]",
    );
    expect(badge?.textContent).toBe("1 student to add");
  });

  // ---- 13. Lifecycle state per row attribute ----

  test("each row has data-lifecycle-state attribute matching server state", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedMissingRecipients",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [publishedCandidate()],
      },
      c2: {
        state: "onePublishedFullyCurrent",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ missingRecipientCount: 0 }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    expect(
      document
        .querySelector("[data-class-id=c1]")
        ?.getAttribute("data-lifecycle-state"),
    ).toBe("onePublishedMissingRecipients");
    expect(
      document
        .querySelector("[data-class-id=c2]")
        ?.getAttribute("data-lifecycle-state"),
    ).toBe("onePublishedFullyCurrent");
  });

  // ---- 14. Assign as New uses creation lifecycle ----

  test("historicalOnly row runs creation lifecycle (createDraft called)", async () => {
    const asn = makeAssignments({
      c1: {
        state: "historicalOnly",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          freeze({
            assignmentId: "a-old",
            title: "Old",
            status: "closed",
            publishedAt: null,
            recipientCount: 0,
            activeEnrollmentCount: 0,
            missingRecipientCount: 0,
          }),
        ],
      },
    });
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();
    expect(asn.draftCalls.length).toBeGreaterThan(0);
    expect(asn.reconcileCalls).toHaveLength(0);
  });

  // ---- 15. Multi-published without selection does not reconcile ----

  test("multiplePublished row with unresolved Current triggers no mutation on confirm", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1" }),
          publishedCandidate({ assignmentId: "a-2" }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    expect(asn.reconcileCalls).toHaveLength(0);
    expect(asn.currentReconcileCalls).toHaveLength(0);
    expect(asn.draftCalls).toHaveLength(0);
  });

  // ---- 16. CSS class name updated from shell-lesson-reassign ----

  test("assigned card uses shell-lesson-assigned-action, not shell-lesson-reassign", async () => {
    const hydrated: AssignmentDetailMetadata[] = [
      freeze({
        assignmentId: "a-1",
        title: "Earth's Layers",
        status: "published",
        className: "6A",
        lessonSlug: LESSON_SLUG,
        classId: "c1",
      }) as AssignmentDetailMetadata,
    ];
    const detail = makeDetailSeam(hydrated);
    const asn = makeAssignments();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    const btn = mount.querySelector<HTMLButtonElement>(
      `[data-testid=lesson-assign-${LESSON_SLUG}]`,
    )!;
    expect(btn.classList.contains("shell-lesson-assigned-action")).toBe(true);
    expect(btn.classList.contains("shell-lesson-reassign")).toBe(false);
  });

  // ---- 17. Update aria-label says "Update assignment for" ----

  test("assigned card button has accessible update label", () => {
    const hydrated: AssignmentDetailMetadata[] = [
      freeze({
        assignmentId: "a-1",
        title: "Earth's Layers",
        status: "published",
        className: "6A",
        lessonSlug: LESSON_SLUG,
        classId: "c1",
      }) as AssignmentDetailMetadata,
    ];
    const detail = makeDetailSeam(hydrated);
    const asn = makeAssignments();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });
    const btn = mount.querySelector<HTMLButtonElement>(
      `[data-testid=lesson-assign-${LESSON_SLUG}]`,
    )!;
    expect(btn.getAttribute("aria-label")).toContain("Update assignment for");
  });

  // ---- 18. Loading text updates during lifecycle state fetch ----

  test("dialog shows 'Checking assignment status' while loading lifecycle state", async () => {
    const holder: { resolve: (() => void) | null } = { resolve: null };
    const seam: AssignmentsCallables = {
      createDraft: async (input) => ({
        assignmentId: input.assignmentId,
        status: "draft" as const,
        alreadyCreated: false,
      }),
      publish: async (input) => ({
        assignmentId: input.assignmentId,
        status: "published" as const,
        alreadyPublished: false,
      }),
      lifecycleState: () =>
        new Promise((resolve) => {
          holder.resolve = () =>
            resolve({ state: "neverAssigned" as const, currentAssignmentId: null, currentAssignmentResolution: "unresolved" as const, candidates: [] });
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
    };
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    const loading = document.querySelector(
      "[data-testid=assign-loading]",
    );
    expect(loading?.textContent).toBe("Checking assignment status");
    holder.resolve?.();
    await flush();
    expect(
      document.querySelector("[data-testid=assign-loading]"),
    ).toBeNull();
  });

  // ---- 19. Reconcile success summary ----

  test("successful reconcile shows added student count in summary", async () => {
    const asn = makeAssignments(
      {
        c1: {
          state: "onePublishedMissingRecipients",
          currentAssignmentId: "a-1",
          currentAssignmentResolution: "valid" as const,
          candidates: [publishedCandidate()],
        },
      },
      { currentReconcileAdded: 3 },
    );
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();
    const banner = mount.querySelector<HTMLElement>(
      "[data-testid=assign-success]",
    );
    expect(banner?.textContent).toContain("3 students");
  });

  // ---- 20. No callable seam: UI-only path still works ----

  test("dialog without callable seam still completes the UI-only path", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    clickConfirm();
    const banner = mount.querySelector<HTMLElement>(
      "[data-testid=assign-success]",
    );
    expect(banner?.textContent).toContain("Assigned");
  });

  // ==== WRITE-SAFETY TESTS (Fail-Safe Correction) ====

  // WS-1: lifecycle failure -> explicit unresolved state
  test("WS-1: lifecycle failure enters explicit error/unresolved state", async () => {
    const seam = makeFailingLifecycleSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const row = document.querySelector("[data-class-id=c1]");
    expect(row?.getAttribute("data-lifecycle-state")).toBe("unresolved");
  });

  // WS-2: lifecycle failure -> no creation controls
  test("WS-2: lifecycle failure does NOT render creation date/time/topic controls", async () => {
    const seam = makeFailingLifecycleSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    expect(document.querySelector("[data-testid=assign-row-date-c1]")).toBeNull();
    expect(document.querySelector("[data-testid=assign-row-time-c1]")).toBeNull();
  });

  // WS-3: lifecycle failure -> confirm performs ZERO createDraft calls
  test("WS-3: lifecycle failure - confirm performs ZERO createDraft calls", async () => {
    const draftCalls: string[] = [];
    const seam: AssignmentsCallables = {
      ...makeFailingLifecycleSeam(),
      createDraft: async (input) => {
        draftCalls.push(input.assignmentId);
        return { assignmentId: input.assignmentId, status: "draft" as const, alreadyCreated: false };
      },
    };
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    expect(draftCalls).toHaveLength(0);
  });

  // WS-4: lifecycle failure -> confirm performs ZERO publish calls
  test("WS-4: lifecycle failure - confirm performs ZERO publish calls", async () => {
    const publishCalls: string[] = [];
    const seam: AssignmentsCallables = {
      ...makeFailingLifecycleSeam(),
      publish: async (input) => {
        publishCalls.push(input.assignmentId);
        return { assignmentId: input.assignmentId, status: "published" as const, alreadyPublished: false };
      },
    };
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    expect(publishCalls).toHaveLength(0);
  });

  // WS-5: lifecycle failure -> confirm performs ZERO recipientsReconcile calls
  test("WS-5: lifecycle failure - confirm performs ZERO recipientsReconcile calls", async () => {
    const reconcileCalls: string[] = [];
    const seam: AssignmentsCallables = {
      ...makeFailingLifecycleSeam(),
      recipientsReconcile: async (input) => {
        reconcileCalls.push(input.assignmentId);
        return { assignmentId: input.assignmentId, added: 0, alreadyCurrent: 0 };
      },
    };
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    expect(reconcileCalls).toHaveLength(0);
  });

  // WS-6: lifecycle failure -> no Assign/Update/Assign-as-new action available
  test("WS-6: lifecycle failure - checkbox is disabled, no write action available", async () => {
    const seam = makeFailingLifecycleSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const checkbox = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c1]",
    );
    expect(checkbox?.disabled).toBe(true);
    expect(checkbox?.checked).toBe(false);
  });

  // WS-7: Retry is visible
  test("WS-7: lifecycle failure shows Retry button", async () => {
    const seam = makeFailingLifecycleSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const retryBtn = document.querySelector<HTMLButtonElement>(
      "[data-testid=assign-row-retry-c1]",
    );
    expect(retryBtn).not.toBeNull();
    expect(retryBtn?.textContent).toBe("Retry");
  });

  // WS-8: Retry calls lifecycleState again with exact classId + lessonSlug
  test("WS-8: Retry calls lifecycleState with exact classId and lessonSlug", async () => {
    const lcCalls: Array<{ classId: string; lessonSlug: string }> = [];
    let callCount = 0;
    const seam: AssignmentsCallables = {
      ...makeFailingLifecycleSeam(),
      lifecycleState: async (input) => {
        lcCalls.push({ classId: input.classId, lessonSlug: input.lessonSlug });
        callCount += 1;
        if (callCount <= 1) throw new Error("network error");
        return { state: "neverAssigned" as const, currentAssignmentId: null, currentAssignmentResolution: "unresolved" as const, candidates: [] };
      },
    };
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const initialCalls = lcCalls.length;
    const retryBtn = document.querySelector<HTMLButtonElement>(
      "[data-testid=assign-row-retry-c1]",
    );
    retryBtn?.click();
    await flush();
    await flush();
    expect(lcCalls.length).toBeGreaterThan(initialCalls);
    const retryCalled = lcCalls[lcCalls.length - 1];
    expect(retryCalled.classId).toBe("c1");
    expect(retryCalled.lessonSlug).toBe(LESSON_SLUG);
  });

  // WS-9: successful Retry to neverAssigned exposes creation state
  test("WS-9: successful Retry to neverAssigned exposes creation controls", async () => {
    let callCount = 0;
    const seam: AssignmentsCallables = {
      ...makeFailingLifecycleSeam(),
      lifecycleState: async () => {
        callCount += 1;
        if (callCount <= 1) throw new Error("network error");
        return { state: "neverAssigned" as const, currentAssignmentId: null, currentAssignmentResolution: "unresolved" as const, candidates: [] };
      },
    };
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    expect(document.querySelector("[data-testid=assign-row-date-c1]")).toBeNull();
    const retryBtn = document.querySelector<HTMLButtonElement>(
      "[data-testid=assign-row-retry-c1]",
    );
    retryBtn?.click();
    await flush();
    await flush();
    const row = document.querySelector("[data-class-id=c1]");
    expect(row?.getAttribute("data-lifecycle-state")).toBe("neverAssigned");
    expect(document.querySelector("[data-testid=assign-row-date-c1]")).not.toBeNull();
    expect(document.querySelector("[data-testid=assign-row-time-c1]")).not.toBeNull();
  });

  // WS-10: successful Retry to onePublishedMissingRecipients exposes Update
  test("WS-10: successful Retry to onePublishedMissingRecipients exposes Update", async () => {
    let callCount = 0;
    const seam: AssignmentsCallables = {
      ...makeFailingLifecycleSeam(),
      lifecycleState: async () => {
        callCount += 1;
        if (callCount <= 1) throw new Error("network error");
        return {
          state: "onePublishedMissingRecipients" as const,
          currentAssignmentId: "a-1",
          currentAssignmentResolution: "valid" as const,
          candidates: [publishedCandidate({ missingRecipientCount: 2 })],
        };
      },
    };
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    document.querySelector<HTMLButtonElement>("[data-testid=assign-row-retry-c1]")?.click();
    await flush();
    await flush();
    const row = document.querySelector("[data-class-id=c1]");
    expect(row?.getAttribute("data-lifecycle-state")).toBe("onePublishedMissingRecipients");
    const badge = document.querySelector("[data-testid=assign-row-lifecycle-c1]");
    expect(badge?.textContent).toBe("2 students to add");
  });

  // WS-11: successful Retry to onePublishedFullyCurrent shows Up to date
  test("WS-11: successful Retry to onePublishedFullyCurrent shows Up to date", async () => {
    let callCount = 0;
    const seam: AssignmentsCallables = {
      ...makeFailingLifecycleSeam(),
      lifecycleState: async () => {
        callCount += 1;
        if (callCount <= 1) throw new Error("network error");
        return {
          state: "onePublishedFullyCurrent" as const,
          currentAssignmentId: null,
          currentAssignmentResolution: "unresolved" as const,
          candidates: [publishedCandidate({ missingRecipientCount: 0 })],
        };
      },
    };
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    document.querySelector<HTMLButtonElement>("[data-testid=assign-row-retry-c1]")?.click();
    await flush();
    await flush();
    const badge = document.querySelector("[data-testid=assign-row-lifecycle-c1]");
    expect(badge?.textContent).toBe("Up to date");
    const row = document.querySelector("[data-class-id=c1]");
    expect(row?.getAttribute("data-lifecycle-state")).toBe("onePublishedFullyCurrent");
  });

  // WS-12: failed lifecycle lookup is NOT cached as neverAssigned
  test("WS-12: failed lifecycle lookup is NOT cached as neverAssigned", async () => {
    const lcCalls: string[] = [];
    const seam: AssignmentsCallables = {
      ...makeFailingLifecycleSeam(),
      lifecycleState: async (input) => {
        lcCalls.push(input.classId);
        throw new Error("network error");
      },
    };
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const firstCallCount = lcCalls.length;
    document.querySelector<HTMLButtonElement>("[data-testid=assign-cancel]")?.click();
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    expect(lcCalls.length).toBeGreaterThan(firstCallCount);
  });

  // WS-13: multiplePublished + no selection -> validation feedback
  // WS-13 (removed, Slice 10): the old "Choose the assignment you want to
  // update." validation message was tied to the removed radio-selection
  // mechanism. multiplePublished+unresolved no longer surfaces a selection
  // prompt at all - it renders a non-actionable "Needs resolution before
  // updating" badge and a disabled checkbox instead (see the
  // needs-resolution test above and DL-14).

  // WS-14: multiplePublished + no selection -> ZERO reconcile calls
  test("WS-14: multiplePublished without selection - ZERO recipientsReconcile", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1" }),
          publishedCandidate({ assignmentId: "a-2" }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    expect(asn.reconcileCalls).toHaveLength(0);
  });

  // WS-15: multiplePublished + no selection -> ZERO createDraft/publish
  test("WS-15: multiplePublished without selection - ZERO createDraft/publish", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1" }),
          publishedCandidate({ assignmentId: "a-2" }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    expect(asn.draftCalls).toHaveLength(0);
  });

  // WS-16 (removed, Slice 10): candidate selection via radio no longer
  // exists. Its replacement is "multiplePublished row with valid Current is
  // actionable with no radio group" above, which proves the exact
  // server-resolved Current is reconciled with no client-side selection
  // step at all.

  // ---- Dialog UI layout tests (production multiplePublished repair) ----

  // DL-1: multiplePublished renders a contained candidate-selection section
  // DL-1, DL-2, DL-3 (removed, Slice 10): these pinned the shape of the
  // removed radio-disambiguation block (`.shell-assign-row-disambig`,
  // `.shell-assign-disambig-option`). No client-side candidate-selection UI
  // exists any longer - see "old radio-disambiguation authority removed"
  // below, which proves the entire mechanism (markup, radios, and the
  // `data-selected-assignment` attribute) is gone.

  // DL-4: candidate content is NOT rendered as Topic/Date/Time controls
  test("DL-4: multiplePublished row does not contain date or time inputs", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1" }),
          publishedCandidate({ assignmentId: "a-2" }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const row = document.querySelector("[data-class-id='c1']");
    expect(row?.querySelector(".shell-assign-row-date")).toBeNull();
    expect(row?.querySelector(".shell-assign-row-time")).toBeNull();
    expect(row?.querySelector(".shell-assign-row-topic")).toBeNull();
  });

  // DL-5, DL-6, DL-7, DL-8 (removed, Slice 10): these pinned independent
  // per-class radio groups, cross-class selection isolation, the exact
  // selected ID reaching recipientsReconcile, and the no-selection
  // validation message - all part of the removed client-side selection
  // mechanism. The replacement behaviors:
  //   - independent per-class Current resolution: "multi-class dialog: one
  //     Assign, one valid Update, one unresolved blocked - each row
  //     independent" above.
  //   - the exact server-resolved Current (never a client selection)
  //     reaching currentRecipientsReconcile: "multiplePublished row with
  //     valid Current is actionable with no radio group" and "update row's
  //     currentRecipientsReconcile request contains only classId and
  //     lessonSlug" above.
  //   - no validation message for an unresolved/no-mutation row: "old
  //     radio-disambiguation authority removed" below.

  // DL-9: no selection produces zero reconcile/create/publish
  test("DL-9: no selection produces zero server calls", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1" }),
          publishedCandidate({ assignmentId: "a-2" }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    expect(asn.reconcileCalls).toHaveLength(0);
    expect(asn.draftCalls).toHaveLength(0);
  });

  // DL-10: neverAssigned layout/creation behavior remains intact
  test("DL-10: neverAssigned row shows date and time inputs", async () => {
    const asn = makeAssignments();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const row = document.querySelector("[data-class-id='c1']");
    expect(row?.querySelector(".shell-assign-row-date")).not.toBeNull();
    expect(row?.querySelector(".shell-assign-row-time")).not.toBeNull();
    expect(row?.querySelector(".shell-assign-row-disambig")).toBeNull();
  });

  // DL-11: onePublishedMissingRecipients Update behavior intact
  test("DL-11: onePublishedMissingRecipients shows Update badge, no disambig", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedMissingRecipients",
        currentAssignmentId: "a-1",
        currentAssignmentResolution: "valid" as const,
        candidates: [publishedCandidate({ missingRecipientCount: 3 })],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const badge = document.querySelector(
      "[data-testid=assign-row-lifecycle-c1]",
    );
    expect(badge?.textContent).toBe("3 students to add");
    const row = document.querySelector("[data-class-id='c1']");
    expect(row?.querySelector(".shell-assign-row-disambig")).toBeNull();
  });

  // DL-12: onePublishedFullyCurrent remains Up to date
  test("DL-12: onePublishedFullyCurrent shows Up to date, no disambig", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedFullyCurrent",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [publishedCandidate({ missingRecipientCount: 0 })],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const badge = document.querySelector(
      "[data-testid=assign-row-lifecycle-c1]",
    );
    expect(badge?.textContent).toBe("Up to date");
    expect(
      document.querySelector("[data-class-id='c1'] .shell-assign-row-disambig"),
    ).toBeNull();
  });

  // DL-13: historicalOnly remains Assign as new
  test("DL-13: historicalOnly shows Assign as new, has date/time", async () => {
    const asn = makeAssignments({
      c1: {
        state: "historicalOnly",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [publishedCandidate({ status: "closed" })],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const badge = document.querySelector(
      "[data-testid=assign-row-lifecycle-c1]",
    );
    expect(badge?.textContent).toBe("Assign as new");
    const row = document.querySelector("[data-class-id='c1']");
    expect(row?.querySelector(".shell-assign-row-date")).not.toBeNull();
    expect(row?.querySelector(".shell-assign-row-disambig")).toBeNull();
  });

  // DL-14: unresolved remains fail-closed with Retry
  test("DL-14: unresolved row has retry, no disambig", async () => {
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: makeFailingLifecycleSeam(),
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    const row = document.querySelector("[data-class-id='c1']");
    expect(row?.getAttribute("data-lifecycle-state")).toBe("unresolved");
    expect(row?.querySelector("[data-testid=assign-row-retry-c1]")).not.toBeNull();
    expect(row?.querySelector(".shell-assign-row-disambig")).toBeNull();
  });

  // DL-15, DL-16 (removed, Slice 10): accessible radiogroup semantics and
  // multi-class independent radio groups no longer apply - there is no
  // radiogroup. Replaced by the proof below that the entire mechanism is
  // gone, across several multiplePublished classes at once.

  test("old radio-disambiguation authority removed: no radiogroup, no radio inputs, no selection attribute anywhere in the dialog", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-2",
        currentAssignmentResolution: "valid" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1" }),
          publishedCandidate({ assignmentId: "a-2" }),
        ],
      },
      c2: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-3" }),
          publishedCandidate({ assignmentId: "a-4" }),
          publishedCandidate({ assignmentId: "a-5" }),
        ],
      },
      c3: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "invalid" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-6" }),
          publishedCandidate({ assignmentId: "a-7" }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listThree,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    // Scoped to the class rows themselves - the dialog's unrelated shared
    // grading control (Ungraded/Graded) is its own, pre-existing radiogroup
    // and is not part of the removed per-row disambiguation mechanism.
    for (const classId of ["c1", "c2", "c3"]) {
      const row = document.querySelector(`[data-class-id='${classId}']`);
      expect(row?.querySelectorAll('[role="radiogroup"]')).toHaveLength(0);
      expect(row?.querySelectorAll('input[type="radio"]')).toHaveLength(0);
      expect(row?.hasAttribute("data-selected-assignment")).toBe(false);
    }
    expect(
      document.querySelectorAll(".shell-assign-row-disambig"),
    ).toHaveLength(0);
    expect(
      document.querySelectorAll("[data-selected-assignment]"),
    ).toHaveLength(0);
    expect(
      document.querySelector("[data-testid=assign-validation]"),
    ).toBeNull();
  });
});
