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

const listOne: ListClasses = () => Promise.resolve(oneClass);
const listTwo: ListClasses = () => Promise.resolve(twoClasses);

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
  } = {},
): {
  seam: AssignmentsCallables;
  reconcileCalls: string[];
  draftCalls: string[];
} => {
  const reconcileCalls: string[] = [];
  const draftCalls: string[] = [];
  return {
    reconcileCalls,
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
        return { state: "neverAssigned" as const, candidates: [] };
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

  test("multiplePublished row shows disambiguation radio group", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
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
    const disambig = document.querySelector(
      "[data-testid=assign-row-disambig-c1]",
    );
    expect(disambig).not.toBeNull();
    expect(disambig?.getAttribute("role")).toBe("radiogroup");
    const radios = disambig?.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]',
    );
    expect(radios?.length).toBe(2);
  });

  // ---- 3. Update path calls recipientsReconcile only ----

  test("update row calls recipientsReconcile, not createDraft or publish", async () => {
    const asn = makeAssignments(
      {
        c1: {
          state: "onePublishedMissingRecipients",
          candidates: [publishedCandidate()],
        },
      },
      { reconcileAdded: 2 },
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
    expect(asn.reconcileCalls).toContain("a-1");
    expect(asn.draftCalls).toHaveLength(0);
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

  test("mixed dialog: creation class runs lifecycle, update class runs reconcile", async () => {
    const asn = makeAssignments(
      {
        c2: {
          state: "onePublishedMissingRecipients",
          candidates: [
            publishedCandidate({ assignmentId: "a-c2" }),
          ],
        },
      },
      { reconcileAdded: 1 },
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
    expect(asn.reconcileCalls).toContain("a-c2");
  });

  // ---- 5. Up-to-date class not included in confirm ----

  test("up-to-date class is excluded from confirm action", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedFullyCurrent",
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
          candidates: [publishedCandidate()],
        },
      },
      { failReconcile: true },
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
        return { state: "neverAssigned" as const, candidates: [] };
      },
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
          candidates: [publishedCandidate()],
        },
        c2: {
          state: "onePublishedMissingRecipients",
          candidates: [
            publishedCandidate({ assignmentId: "a-2" }),
          ],
        },
      },
      { reconcileAdded: 1 },
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
    expect(asn.reconcileCalls.length).toBe(2);
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

  test("disambiguation radio group has aria-label", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
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
    const group = document.querySelector(
      "[data-testid=assign-row-disambig-c1]",
    );
    expect(group?.getAttribute("aria-label")).toContain("6A");
  });

  test("up-to-date checkbox has descriptive aria-label", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedFullyCurrent",
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
        candidates: [publishedCandidate()],
      },
      c2: {
        state: "onePublishedFullyCurrent",
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

  test("multiplePublished row without selection does not trigger reconcile", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
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
            resolve({ state: "neverAssigned" as const, candidates: [] });
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
          candidates: [publishedCandidate()],
        },
      },
      { reconcileAdded: 3 },
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
        return { state: "neverAssigned" as const, candidates: [] };
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
        return { state: "neverAssigned" as const, candidates: [] };
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
  test("WS-13: multiplePublished without selection shows validation message on confirm", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
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
    const validation = document.querySelector("[data-testid=assign-validation]");
    expect(validation).not.toBeNull();
    expect(validation?.textContent).toBe("Choose the assignment you want to update.");
    expect(validation?.getAttribute("role")).toBe("alert");
  });

  // WS-14: multiplePublished + no selection -> ZERO reconcile calls
  test("WS-14: multiplePublished without selection - ZERO recipientsReconcile", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
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

  // WS-16: after candidate selection, validation clears and correct ID reconciled
  test("WS-16: after candidate selection, validation clears and exact ID reconciled", async () => {
    const asn = makeAssignments(
      {
        c1: {
          state: "multiplePublished",
          candidates: [
            publishedCandidate({ assignmentId: "a-1" }),
            publishedCandidate({ assignmentId: "a-2" }),
          ],
        },
      },
      { reconcileAdded: 1 },
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
    const validation = document.querySelector("[data-testid=assign-validation]");
    expect(validation?.textContent).toBe("Choose the assignment you want to update.");
    const radio = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-disambig-c1-a-2]",
    );
    if (radio) {
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();
    expect(asn.reconcileCalls).toContain("a-2");
    expect(asn.reconcileCalls).not.toContain("a-1");
  });
});
