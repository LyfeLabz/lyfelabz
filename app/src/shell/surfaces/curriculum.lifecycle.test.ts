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

// Historical Assignment Resolution, Implementation Slice 13 (final
// certification, Phase 3 Case G): a single dialog spanning five classes,
// one per distinct lifecycle-state/Current-resolution combination that
// Slices 8-12 collectively define, proving cross-class independence in one
// place rather than only pairwise across the narrower Slice 10-12 tests.
const fiveClasses: ReadonlyArray<ClassSummary> = freeze([
  freeze({ id: "c1", title: "Never", grade: "6", status: "active" }),
  freeze({ id: "c2", title: "OnePublished", grade: "6", status: "active" }),
  freeze({ id: "c3", title: "MultiValid", grade: "7", status: "active" }),
  freeze({ id: "c4", title: "Historical", grade: "7", status: "active" }),
  freeze({ id: "c5", title: "Invalid", grade: "8", status: "active" }),
] as ClassSummary[]);

const listOne: ListClasses = () => Promise.resolve(oneClass);
const listTwo: ListClasses = () => Promise.resolve(twoClasses);
const listThree: ListClasses = () => Promise.resolve(threeClasses);
const listFive: ListClasses = () => Promise.resolve(fiveClasses);

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

// Historical Assignment Resolution, Implementation Slice 12.
const historicalCandidate = (
  overrides?: Partial<AssignmentCandidate>,
): AssignmentCandidate =>
  freeze({
    assignmentId: "a-old",
    title: "Earth's Layers",
    status: "closed",
    publishedAt: 1690000000000,
    recipientCount: 0,
    activeEnrollmentCount: 0,
    missingRecipientCount: 0,
    ...overrides,
  });

type LifecycleOverrides = Partial<{
  [classId: string]: AssignmentsLifecycleStateOutput;
}>;

type CurrentSetCall = {
  readonly classId: string;
  readonly lessonSlug: string;
  readonly assignmentId: string;
  readonly expectedCurrentAssignmentId: string | null;
};

const makeAssignments = (
  lcOverrides: LifecycleOverrides = {},
  opts: {
    reconcileAdded?: number;
    failReconcile?: boolean;
    // Historical Assignment Resolution, Implementation Slice 10.
    currentReconcileAdded?: number;
    failCurrentReconcile?: boolean;
    // Historical Assignment Resolution, Implementation Slice 11.
    failCurrentSet?: boolean;
    currentSetChanged?: boolean;
    // Historical Assignment Resolution, Implementation Slice 13 (final
    // certification, Phase 10 failure-mode #9): makes `lifecycleState`
    // throw starting from its Nth call for one class, so a test can model
    // "the initial dialog load succeeds, but the refresh lifecycle read
    // triggered by a failed Set/Change also fails."
    failLifecycleFromCall?: { readonly classId: string; readonly callNumber: number };
  } = {},
): {
  seam: AssignmentsCallables;
  reconcileCalls: string[];
  currentReconcileCalls: Array<{ readonly classId: string; readonly lessonSlug: string }>;
  currentSetCalls: CurrentSetCall[];
  draftCalls: string[];
  lifecycleCallCount: (classId: string) => number;
} => {
  const reconcileCalls: string[] = [];
  const currentReconcileCalls: Array<{ readonly classId: string; readonly lessonSlug: string }> = [];
  const currentSetCalls: CurrentSetCall[] = [];
  const draftCalls: string[] = [];
  const lifecycleCallCounts = new Map<string, number>();
  // Historical Assignment Resolution, Implementation Slice 11. A mutable
  // live-state map seeded from the fixture's `lcOverrides`, so a
  // successful `currentSet` in one of these tests can be observed by a
  // SUBSEQUENT `lifecycleState` call - exactly like the real server, where
  // Set/Change Current genuinely changes what the next lifecycle read
  // reports. Tests that never call `currentSet` see no difference from the
  // prior, immutable `lcOverrides`-only behavior.
  const liveLifecycle = new Map<string, AssignmentsLifecycleStateOutput>(
    Object.entries(lcOverrides).filter(
      (entry): entry is [string, AssignmentsLifecycleStateOutput] =>
        entry[1] !== undefined,
    ),
  );
  return {
    reconcileCalls,
    currentReconcileCalls,
    currentSetCalls,
    draftCalls,
    lifecycleCallCount: (classId: string) => lifecycleCallCounts.get(classId) ?? 0,
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
        const callNumber =
          (lifecycleCallCounts.get(input.classId) ?? 0) + 1;
        lifecycleCallCounts.set(input.classId, callNumber);
        if (
          opts.failLifecycleFromCall &&
          opts.failLifecycleFromCall.classId === input.classId &&
          callNumber >= opts.failLifecycleFromCall.callNumber
        ) {
          throw new Error("lifecycle refresh failed");
        }
        const override = liveLifecycle.get(input.classId);
        if (override) return override;
        return { state: "neverAssigned" as const, currentAssignmentId: null, currentAssignmentResolution: "unresolved" as const, candidates: [] };
      },
      // Historical Assignment Resolution, Implementation Slice 11. Models
      // the real server's own behavior: a genuine change (`changed: true`)
      // updates what live Current is, so the row's own post-mutation
      // lifecycle reload (via `lifecycleState` above) observes it.
      currentSet: async (input) => {
        currentSetCalls.push({
          classId: input.classId,
          lessonSlug: input.lessonSlug,
          assignmentId: input.assignmentId,
          expectedCurrentAssignmentId: input.expectedCurrentAssignmentId,
        });
        if (opts.failCurrentSet) {
          throw new Error("current set failed");
        }
        const changed = opts.currentSetChanged ?? true;
        if (changed) {
          const existing = liveLifecycle.get(input.classId);
          liveLifecycle.set(input.classId, {
            state: existing?.state ?? "onePublishedFullyCurrent",
            candidates: existing?.candidates ?? [],
            currentAssignmentId: input.assignmentId,
            currentAssignmentResolution: "valid",
          });
        }
        return {
          classId: input.classId,
          lessonSlug: input.lessonSlug,
          assignmentId: input.assignmentId,
          changed,
        };
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
          liveLifecycle.get(input.classId)?.currentAssignmentId ?? "a-resolved";
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
        currentAssignmentId: "a-1",
        currentAssignmentResolution: "valid" as const,
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

  test("onePublishedFullyCurrent row with unresolved Current shows needs-resolution and offers Set as current assignment", async () => {
    // Historical Assignment Resolution, Implementation Slice 11. A class
    // can have exactly one published, fully-staffed assignment and STILL
    // have no Current pointer at all (legacy history predating this
    // feature) - recipient completeness and Current resolution are
    // independent dimensions, so this state is NOT "Up to date" the way
    // Slice 10 treated it unconditionally. The teacher must explicitly
    // resolve Current before Update becomes available.
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
    expect(badge?.textContent).toBe("Needs resolution before updating");
    const checkbox = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c1]",
    );
    expect(checkbox?.disabled).toBe(true);
    expect(
      document.querySelector("[data-testid=assign-row-set-current-c1]"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-change-current-c1]"),
    ).toBeNull();
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

  test("multiplePublished row with valid Current is actionable with no old-mechanism radio group", async () => {
    // Historical Assignment Resolution, Implementation Slice 10: the old
    // disambiguation radio group (used to pick an UPDATE target) is
    // removed entirely. A multiplePublished row whose Current pointer
    // resolves to "valid" is auto-actionable - Update Assignment targets
    // the server-resolved Current directly, no client-side selection of
    // which historical assignment to update.
    //
    // Slice 11 adds a DIFFERENT, deliberate radio group here: the
    // secondary "Change current assignment" disclosure, which starts
    // closed and is never read by Update Assignment. This test proves the
    // old mechanism specifically (its testid and its "update target"
    // reading) is gone, and separately proves the new control starts
    // closed with no candidate preselected.
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
    expect(
      document.querySelector("[data-testid=assign-row-disambig-c1]"),
    ).toBeNull();
    const checkbox = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c1]",
    );
    expect(checkbox?.disabled).toBe(false);
    // The new Change Current control exists but starts closed (its panel
    // is hidden until the teacher explicitly opens it) and nothing is
    // preselected.
    const changeBtn = document.querySelector<HTMLButtonElement>(
      "[data-testid=assign-row-change-current-c1]",
    );
    expect(changeBtn).not.toBeNull();
    const panel = document.querySelector<HTMLElement>(
      "[data-testid=assign-row-change-current-panel-c1]",
    );
    expect(panel?.hidden).toBe(true);
    for (const radio of Array.from(
      panel?.querySelectorAll<HTMLInputElement>('input[type="radio"]') ?? [],
    )) {
      expect(radio.checked).toBe(false);
    }
    // No Set Current control - Current is already valid.
    expect(
      document.querySelector("[data-testid=assign-row-set-current-c1]"),
    ).toBeNull();
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
        currentAssignmentId: "a-1",
        currentAssignmentResolution: "valid" as const,
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
          currentAssignmentId: "a-1",
          currentAssignmentResolution: "valid" as const,
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
        currentAssignmentId: "a-1",
        currentAssignmentResolution: "valid" as const,
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

  test("old Update-radio mutation authority removed: no old disambig markup, no selection attribute, anywhere in the dialog", async () => {
    // Historical Assignment Resolution, Implementation Slice 11. This test
    // no longer asserts "zero radio inputs anywhere" - Slice 11
    // legitimately introduces a NEW, different radio-based control (the
    // explicit Set/Change Current disclosure), which is expected to render
    // for c1 (valid, offers Change) and c2 (unresolved, offers Set). What
    // must remain permanently gone is the OLD mechanism specifically: its
    // container class/testid, its `data-selected-assignment` mutation-
    // authority attribute, and its role in ordinary Update Assignment. c3
    // (invalid) proves the fail-safe branch offers neither mechanism.
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
    // The old per-row disambig container, its testid naming, and its
    // mutation-authority attribute never appear for any row, in any state.
    expect(
      document.querySelectorAll(".shell-assign-row-disambig"),
    ).toHaveLength(0);
    for (const classId of ["c1", "c2", "c3"]) {
      expect(
        document.querySelector(`[data-testid=assign-row-disambig-${classId}]`),
      ).toBeNull();
    }
    expect(
      document.querySelectorAll("[data-selected-assignment]"),
    ).toHaveLength(0);
    expect(
      document.querySelector("[data-testid=assign-validation]"),
    ).toBeNull();

    // c1 (valid): the new Change Current control exists, closed, and its
    // own panel/radio testids use the NEW naming, never the old
    // `assign-disambig-*`/`assign-row-disambig-*` convention.
    const c1Row = document.querySelector("[data-class-id='c1']");
    expect(
      document.querySelector("[data-testid=assign-row-change-current-c1]"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-change-current-panel-c1]")
        ?.hasAttribute("hidden"),
    ).toBe(true);
    expect(c1Row?.querySelector('[data-testid^="assign-disambig-"]')).toBeNull();

    // c2 (unresolved): the new Set Current control exists, closed, and no
    // candidate is preselected.
    expect(
      document.querySelector("[data-testid=assign-row-set-current-c2]"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-set-current-panel-c2]")
        ?.hasAttribute("hidden"),
    ).toBe(true);

    // c3 (invalid): fails safe - neither mechanism is offered at all.
    const c3Row = document.querySelector("[data-class-id='c3']");
    expect(c3Row?.querySelectorAll('input[type="radio"]')).toHaveLength(0);
    expect(
      document.querySelector("[data-testid=assign-row-set-current-c3]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-change-current-c3]"),
    ).toBeNull();
  });

  // ---- Slice 11: explicit Set Current / Change Current workflow ----

  test("onePublishedMissingRecipients + unresolved: Set Current available, Update unavailable", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedMissingRecipients",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [publishedCandidate({ assignmentId: "a-1" })],
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
    expect(badge?.textContent).toBe("Needs resolution before updating");
    const checkbox = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c1]",
    );
    expect(checkbox?.disabled).toBe(true);
    expect(
      document.querySelector("[data-testid=assign-row-set-current-c1]"),
    ).not.toBeNull();
  });

  test("Set Current: rendering and opening the panel never mutates; confirming without a selection shows validation and makes no call", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedMissingRecipients",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [publishedCandidate({ assignmentId: "a-1" })],
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
    expect(asn.currentSetCalls).toHaveLength(0);
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-row-set-current-c1]")
      ?.click();
    await flush();
    expect(asn.currentSetCalls).toHaveLength(0);
    const panel = document.querySelector<HTMLElement>(
      "[data-testid=assign-row-set-current-panel-c1]",
    );
    expect(panel?.hidden).toBe(false);
    const radios = panel!.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]',
    );
    expect(radios.length).toBe(1);
    expect(radios[0]!.checked).toBe(false);
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-set-current-confirm-c1]",
      )
      ?.click();
    await flush();
    expect(asn.currentSetCalls).toHaveLength(0);
    const validation = document.querySelector<HTMLElement>(
      "[data-testid=assign-row-set-current-validation-c1]",
    );
    expect(validation?.hidden).toBe(false);
  });

  test("Set Current: multiple eligible candidates are shown with none preselected", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1" }),
          publishedCandidate({ assignmentId: "a-2", title: "Second" }),
          publishedCandidate({ assignmentId: "a-3", title: "Third" }),
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
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-row-set-current-c1]")
      ?.click();
    await flush();
    const panel = document.querySelector<HTMLElement>(
      "[data-testid=assign-row-set-current-panel-c1]",
    );
    const radios = Array.from(
      panel!.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
    );
    expect(radios.length).toBe(3);
    for (const radio of radios) {
      expect(radio.checked).toBe(false);
      expect(radio.disabled).toBe(false);
    }
  });

  // ---- Post-release UX patch: same-day historical candidates ----
  //
  // Production verification found classes with several historical
  // candidates sharing the same publication DATE and the same recipient
  // count (e.g. a morning batch and an afternoon batch published the same
  // day) - date-only labeling made them visually identical, so a teacher
  // could not make an informed explicit Set/Change Current selection.
  // `publishedAt` already carries full time-of-day precision; these tests
  // pin the fix (adding local clock time to the existing label) without
  // touching selection/mutation/ordering/eligibility behavior at all.

  test("Set Current candidate label shows publication date AND local time", async () => {
    const publishedAt = new Date(2026, 8, 16, 14, 16).getTime(); // Sep 16, 2026, 2:16 PM local
    const asn = makeAssignments({
      c1: {
        state: "onePublishedMissingRecipients",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [publishedCandidate({ assignmentId: "a-1", publishedAt })],
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
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-row-set-current-c1]")
      ?.click();
    await flush();
    const radio = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-current-option-c1-a-1]",
    )!;
    const label = radio.closest("label");
    expect(label?.textContent).toContain("Sep 16, 2026 · 2:16 PM");
  });

  test("two same-day, same-recipient-count candidates render distinguishably by publication time (core production regression)", async () => {
    const morning = new Date(2026, 8, 16, 9, 4).getTime();
    const afternoon = new Date(2026, 8, 16, 14, 16).getTime();
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({
            assignmentId: "a-morning",
            publishedAt: morning,
            recipientCount: 20,
          }),
          publishedCandidate({
            assignmentId: "a-afternoon",
            publishedAt: afternoon,
            recipientCount: 20,
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
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-row-set-current-c1]")
      ?.click();
    await flush();
    const morningLabel = document
      .querySelector<HTMLInputElement>(
        "[data-testid=assign-current-option-c1-a-morning]",
      )!
      .closest("label");
    const afternoonLabel = document
      .querySelector<HTMLInputElement>(
        "[data-testid=assign-current-option-c1-a-afternoon]",
      )!
      .closest("label");
    expect(morningLabel?.textContent).toContain("9:04 AM");
    expect(afternoonLabel?.textContent).toContain("2:16 PM");
    // Same date and same recipient count on both - the ONLY distinguishing
    // text is the time, which is exactly the production defect this patch
    // corrects.
    expect(morningLabel?.textContent).not.toBe(afternoonLabel?.textContent);
  });

  test("Change Current candidate rows use the same date+time identification convention", async () => {
    const publishedAt = new Date(2026, 8, 15, 13, 9).getTime(); // Sep 15, 2026, 1:09 PM local
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-1",
        currentAssignmentResolution: "valid" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1" }),
          publishedCandidate({
            assignmentId: "a-2",
            title: "Second",
            publishedAt,
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-change-current-c1]",
      )
      ?.click();
    await flush();
    const label = document
      .querySelector<HTMLInputElement>(
        "[data-testid=assign-current-option-c1-a-2]",
      )!
      .closest("label");
    expect(label?.textContent).toContain("Sep 15, 2026 · 1:09 PM");
  });

  test("Assignment history entries use the same date+time identification convention", async () => {
    const publishedAt = new Date(2026, 8, 16, 14, 16).getTime();
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1", publishedAt }),
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    const dateText = document.querySelector(
      "[data-testid=assign-row-history-item-c1-a-1] .shell-assign-row-history-date",
    );
    expect(dateText?.textContent).toBe("Sep 16, 2026 · 2:16 PM");
  });

  test("Set Current: a null publishedAt renders no fabricated time and falls back to the candidate title only", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedMissingRecipients",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1", publishedAt: null }),
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
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-row-set-current-c1]")
      ?.click();
    await flush();
    const label = document
      .querySelector<HTMLInputElement>(
        "[data-testid=assign-current-option-c1-a-1]",
      )!
      .closest("label");
    // No fabricated date/time text - the title-only fallback (no " · "
    // separator, since there is no publication timestamp to append).
    expect(label?.textContent).not.toContain(" · ");
    expect(label?.textContent).not.toMatch(/AM|PM|1970|NaN|Invalid Date/);
  });

  test("Assignment history: a null publishedAt keeps the existing safe status-label fallback, no fabricated time", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1" }),
          historicalCandidate({
            assignmentId: "a-draft",
            status: "draft",
            publishedAt: null,
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    const dateText = document.querySelector(
      "[data-testid=assign-row-history-item-c1-a-draft] .shell-assign-row-history-date",
    );
    expect(dateText?.textContent).toBe("Draft");
    expect(dateText?.textContent).not.toMatch(/AM|PM|1970|NaN|Invalid Date/);
  });

  test("Set Current success: sends expectedCurrentAssignmentId exactly null, reloads lifecycle, shows success feedback, and never runs an automatic reconcile/create/publish", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedMissingRecipients",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [publishedCandidate({ assignmentId: "a-1" })],
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
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-row-set-current-c1]")
      ?.click();
    await flush();
    const radio = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-current-option-c1-a-1]",
    )!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-set-current-confirm-c1]",
      )
      ?.click();
    await flush();
    await flush();
    await flush();
    expect(asn.currentSetCalls).toEqual([
      {
        classId: "c1",
        lessonSlug: LESSON_SLUG,
        assignmentId: "a-1",
        expectedCurrentAssignmentId: null,
      },
    ]);
    expect(asn.lifecycleCallCount("c1")).toBeGreaterThanOrEqual(2);
    expect(asn.reconcileCalls).toHaveLength(0);
    expect(asn.currentReconcileCalls).toHaveLength(0);
    expect(asn.draftCalls).toHaveLength(0);
    const banner = mount.querySelector<HTMLElement>(
      "[data-testid=assign-success]",
    );
    expect(banner?.textContent).toBe("Current assignment set.");
    const row = document.querySelector("[data-class-id='c1']");
    expect(row?.getAttribute("data-current-resolution")).toBe("valid");
  });

  test("Set Current failure: no fallback mutation, no false success, lifecycle refreshed for review", async () => {
    const asn = makeAssignments(
      {
        c1: {
          state: "onePublishedMissingRecipients",
          currentAssignmentId: null,
          currentAssignmentResolution: "unresolved" as const,
          candidates: [publishedCandidate({ assignmentId: "a-1" })],
        },
      },
      { failCurrentSet: true },
    );
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-row-set-current-c1]")
      ?.click();
    await flush();
    const radio = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-current-option-c1-a-1]",
    )!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-set-current-confirm-c1]",
      )
      ?.click();
    await flush();
    await flush();
    await flush();
    expect(asn.currentSetCalls).toHaveLength(1);
    expect(asn.reconcileCalls).toHaveLength(0);
    expect(asn.currentReconcileCalls).toHaveLength(0);
    expect(asn.draftCalls).toHaveLength(0);
    const banner = mount.querySelector<HTMLElement>(
      "[data-testid=assign-success]",
    );
    expect(banner?.textContent).toContain("could not be set");
    expect(banner?.textContent).not.toBe("Current assignment set.");
    expect(asn.lifecycleCallCount("c1")).toBeGreaterThanOrEqual(2);
    const row = document.querySelector("[data-class-id='c1']");
    expect(row?.getAttribute("data-current-resolution")).toBe("unresolved");
    expect(
      document.querySelector("[data-testid=assign-row-set-current-c1]"),
    ).not.toBeNull();
  });

  test("Set Current failure whose own recovery lifecycle refresh ALSO fails: falls back to the fetch-failure error row with Retry, still no fallback mutation", async () => {
    // Historical Assignment Resolution, Implementation Slice 13 (final
    // certification, Phase 10 failure-mode #9). The initial dialog load
    // succeeds (call #1 for c1), but the SECOND lifecycleState call - the
    // recovery refresh `renderSetOrChangeCurrentControl` performs after a
    // failed currentSet - also fails. This exercises the nested try/catch's
    // outer fallback branch, which is otherwise unreachable from any other
    // test in this file.
    const asn = makeAssignments(
      {
        c1: {
          state: "onePublishedMissingRecipients",
          currentAssignmentId: null,
          currentAssignmentResolution: "unresolved" as const,
          candidates: [publishedCandidate({ assignmentId: "a-1" })],
        },
      },
      {
        failCurrentSet: true,
        failLifecycleFromCall: { classId: "c1", callNumber: 2 },
      },
    );
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-row-set-current-c1]")
      ?.click();
    await flush();
    const radio = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-current-option-c1-a-1]",
    )!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-set-current-confirm-c1]",
      )
      ?.click();
    await flush();
    await flush();
    await flush();
    // Still exactly one currentSet attempt - no retry loop, no fallback
    // mutation of any kind.
    expect(asn.currentSetCalls).toHaveLength(1);
    expect(asn.reconcileCalls).toHaveLength(0);
    expect(asn.currentReconcileCalls).toHaveLength(0);
    expect(asn.draftCalls).toHaveLength(0);
    // The row falls back to the SAME fetch-failure error presentation the
    // initial-load-failure path uses: disabled checkbox, error badge,
    // Retry - never a silently stuck or misleading state.
    const row = document.querySelector("[data-class-id='c1']");
    expect(row?.getAttribute("data-lifecycle-state")).toBe("unresolved");
    expect(
      document.querySelector<HTMLInputElement>(
        "[data-testid=assign-row-enabled-c1]",
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector("[data-testid=assign-row-retry-c1]"),
    ).not.toBeNull();
    const banner = mount.querySelector<HTMLElement>(
      "[data-testid=assign-success]",
    );
    expect(banner?.textContent).toContain("could not be set");
  });

  test("Change Current: identifies the current candidate, disables it as a target, and confirming without a different selection makes no call", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-1",
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-change-current-c1]",
      )
      ?.click();
    await flush();
    const panel = document.querySelector<HTMLElement>(
      "[data-testid=assign-row-change-current-panel-c1]",
    );
    expect(panel?.hidden).toBe(false);
    const currentRadio = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-current-option-c1-a-1]",
    )!;
    expect(currentRadio.disabled).toBe(true);
    expect(
      document.querySelector("[data-testid=assign-current-marker-c1-a-1]")
        ?.textContent,
    ).toBe("Current");
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-change-current-confirm-c1]",
      )
      ?.click();
    await flush();
    expect(asn.currentSetCalls).toHaveLength(0);
    const validation = document.querySelector<HTMLElement>(
      "[data-testid=assign-row-change-current-validation-c1]",
    );
    expect(validation?.hidden).toBe(false);
  });

  // ---- Post-release UX patch: CURRENT marker far-right alignment ----
  //
  // Human verification found CURRENT rendering immediately after the
  // title/date/time, before the recipient count, reading as
  // "Title · date · time  CURRENT  N recipients" instead of the intended
  // "Title · date · time  N recipients  ...  CURRENT" with CURRENT pinned
  // to the row's far right. The fix is a DOM-order change (marker now
  // appended after recipient metadata, not before) plus a CSS
  // `margin-left: auto` on the marker so it is pushed to the end of the
  // flex row - no absolute positioning, no candidate-selection or
  // Current-authority change of any kind.

  test("CURRENT marker is the LAST child of the Current candidate row, structurally after recipient metadata", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-1",
        currentAssignmentResolution: "valid" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1", recipientCount: 20 }),
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-change-current-c1]",
      )
      ?.click();
    await flush();
    const currentRadio = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-current-option-c1-a-1]",
    )!;
    const currentLabel = currentRadio.closest("label")!;
    const children = Array.from(currentLabel.children);
    const meta = currentLabel.querySelector(".shell-assign-disambig-meta");
    const marker = currentLabel.querySelector(
      "[data-testid=assign-current-marker-c1-a-1]",
    );
    expect(meta).not.toBeNull();
    expect(marker).not.toBeNull();
    expect(meta?.textContent).toBe("20 recipients");
    expect(marker?.textContent).toBe("Current");
    // Structural far-right guarantee: the marker is the LAST element in
    // the row, after recipient metadata - combined with its CSS
    // `margin-left: auto` (pinned in the contrast/layout CSS test below),
    // this is what places it at the row's far right regardless of
    // viewport width or candidate text length.
    expect(children[children.length - 1]).toBe(marker);
    expect(children.indexOf(meta as Element)).toBeLessThan(
      children.indexOf(marker as Element),
    );
  });

  test("Change Current: the alternate (non-Current) candidate carries no CURRENT marker and remains enabled", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-1",
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-change-current-c1]",
      )
      ?.click();
    await flush();
    expect(
      document.querySelector("[data-testid=assign-current-marker-c1-a-2]"),
    ).toBeNull();
    const alternateRadio = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-current-option-c1-a-2]",
    )!;
    expect(alternateRadio.disabled).toBe(false);
    expect(
      alternateRadio
        .closest("label")
        ?.querySelector(".shell-assign-disambig-meta"),
    ).not.toBeNull();
  });

  test("Set Current: no candidate carries a CURRENT marker before any Current is resolved", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "b-1" }),
          publishedCandidate({ assignmentId: "b-2", title: "Second" }),
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
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-row-set-current-c1]")
      ?.click();
    await flush();
    const setPanel = document.querySelector<HTMLElement>(
      "[data-testid=assign-row-set-current-panel-c1]",
    )!;
    expect(
      setPanel.querySelector(".shell-assign-disambig-current-marker"),
    ).toBeNull();
    expect(
      setPanel.querySelectorAll('input[type="radio"]:not(:disabled)').length,
    ).toBe(2);
  });

  test("Change Current success: sends the exact observed Current as expectedCurrentAssignmentId, reloads lifecycle, and runs no automatic Update/create/publish", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-1",
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-change-current-c1]",
      )
      ?.click();
    await flush();
    const radio = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-current-option-c1-a-2]",
    )!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-change-current-confirm-c1]",
      )
      ?.click();
    await flush();
    await flush();
    await flush();
    expect(asn.currentSetCalls).toEqual([
      {
        classId: "c1",
        lessonSlug: LESSON_SLUG,
        assignmentId: "a-2",
        expectedCurrentAssignmentId: "a-1",
      },
    ]);
    expect(asn.currentReconcileCalls).toHaveLength(0);
    expect(asn.reconcileCalls).toHaveLength(0);
    expect(asn.draftCalls).toHaveLength(0);
    const banner = mount.querySelector<HTMLElement>(
      "[data-testid=assign-success]",
    );
    expect(banner?.textContent).toBe("Current assignment changed.");
    const row = document.querySelector("[data-class-id='c1']");
    expect(row?.getAttribute("data-current-resolution")).toBe("valid");
  });

  test("Change Current conflict/failure: sends only the originally observed expected value, never retries with a substituted value, and never falls back to another mutation", async () => {
    const asn = makeAssignments(
      {
        c1: {
          state: "multiplePublished",
          currentAssignmentId: "a-1",
          currentAssignmentResolution: "valid" as const,
          candidates: [
            publishedCandidate({ assignmentId: "a-1" }),
            publishedCandidate({ assignmentId: "a-2", title: "Second" }),
          ],
        },
      },
      { failCurrentSet: true },
    );
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listOne,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-change-current-c1]",
      )
      ?.click();
    await flush();
    const radio = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-current-option-c1-a-2]",
    )!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-change-current-confirm-c1]",
      )
      ?.click();
    await flush();
    await flush();
    await flush();
    // Exactly one call, with the exact originally-observed expected value -
    // never substituted with null or any other live-looking value, and
    // never retried.
    expect(asn.currentSetCalls).toEqual([
      {
        classId: "c1",
        lessonSlug: LESSON_SLUG,
        assignmentId: "a-2",
        expectedCurrentAssignmentId: "a-1",
      },
    ]);
    expect(asn.currentReconcileCalls).toHaveLength(0);
    expect(asn.reconcileCalls).toHaveLength(0);
    expect(asn.draftCalls).toHaveLength(0);
    const banner = mount.querySelector<HTMLElement>(
      "[data-testid=assign-success]",
    );
    expect(banner?.textContent).toContain("could not be changed");
    expect(asn.lifecycleCallCount("c1")).toBeGreaterThanOrEqual(2);
    // Fresh row re-rendered: the Change control is available again, closed.
    expect(
      document
        .querySelector("[data-testid=assign-row-change-current-panel-c1]")
        ?.hasAttribute("hidden"),
    ).toBe(true);
  });

  test("multi-class isolation: a Set Current selection and mutation in one row does not affect another row", async () => {
    const asn = makeAssignments({
      c1: {
        state: "onePublishedMissingRecipients",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [publishedCandidate({ assignmentId: "a-1" })],
      },
      c2: {
        state: "onePublishedMissingRecipients",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [publishedCandidate({ assignmentId: "b-1" })],
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
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-row-set-current-c1]")
      ?.click();
    await flush();
    const radioC1 = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-current-option-c1-a-1]",
    )!;
    radioC1.checked = true;
    radioC1.dispatchEvent(new Event("change", { bubbles: true }));
    await flush();
    // c2's control is untouched - closed, no selection.
    const c2Panel = document.querySelector<HTMLElement>(
      "[data-testid=assign-row-set-current-panel-c2]",
    );
    expect(c2Panel?.hidden).toBe(true);
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-set-current-confirm-c1]",
      )
      ?.click();
    await flush();
    await flush();
    await flush();
    expect(asn.currentSetCalls).toEqual([
      {
        classId: "c1",
        lessonSlug: LESSON_SLUG,
        assignmentId: "a-1",
        expectedCurrentAssignmentId: null,
      },
    ]);
    const c2Row = document.querySelector("[data-class-id='c2']");
    expect(c2Row?.getAttribute("data-current-resolution")).toBe("unresolved");
    expect(
      document.querySelector("[data-testid=assign-row-set-current-c2]"),
    ).not.toBeNull();
  });

  test("Set Current eligibility: only published candidates appear as selectable options", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-1" }),
          publishedCandidate({ assignmentId: "a-2", title: "Second" }),
          freeze({
            assignmentId: "a-closed",
            title: "Old closed one",
            status: "closed",
            publishedAt: null,
            recipientCount: 0,
            activeEnrollmentCount: 0,
            missingRecipientCount: 0,
          }) as AssignmentCandidate,
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
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-row-set-current-c1]")
      ?.click();
    await flush();
    const panel = document.querySelector<HTMLElement>(
      "[data-testid=assign-row-set-current-panel-c1]",
    );
    const radios = panel!.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]',
    );
    expect(radios.length).toBe(2);
    expect(
      document.querySelector("[data-testid=assign-current-option-c1-a-closed]"),
    ).toBeNull();
  });

  test("no Clear Current control exists anywhere in the dialog", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-1",
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-change-current-c1]",
      )
      ?.click();
    await flush();
    expect(document.body.textContent).not.toMatch(/clear current/i);
    expect(document.querySelector('[data-testid*="clear-current"]')).toBeNull();
  });

  test("neverAssigned + unresolved never offers Set Current", async () => {
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
      document.querySelector("[data-testid=assign-row-set-current-c1]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-change-current-c1]"),
    ).toBeNull();
  });

  test("historicalOnly + unresolved never offers Set Current (no eligible published candidate)", async () => {
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
          }) as AssignmentCandidate,
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
    expect(
      document.querySelector("[data-testid=assign-row-set-current-c1]"),
    ).toBeNull();
  });

  test("invalid Current: no Set, no Change, no Update - only Retry", async () => {
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
      document.querySelector("[data-testid=assign-row-set-current-c1]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-change-current-c1]"),
    ).toBeNull();
    const checkbox = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c1]",
    );
    expect(checkbox?.disabled).toBe(true);
    expect(
      document.querySelector("[data-testid=assign-row-retry-c1]"),
    ).not.toBeNull();
  });

  // ---- Slice 12: Assignment history (read-only disclosure) ----

  test("2+ candidates: Assignment history control is available", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-1",
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
    expect(
      document.querySelector("[data-testid=assign-row-history-toggle-c1]"),
    ).not.toBeNull();
  });

  test("neverAssigned (0 candidates): no Assignment history control", async () => {
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
      document.querySelector("[data-testid=assign-row-history-toggle-c1]"),
    ).toBeNull();
  });

  test("1 candidate (onePublishedFullyCurrent, valid): no separate Assignment history disclosure by default", async () => {
    // Historical Assignment Resolution, Implementation Slice 12. Fresh
    // reconnaissance found no existing per-assignment Assignment Detail
    // link from Curriculum (Sprint 28.6D deliberately retired the one that
    // existed, replacing it with a lesson-LEVEL View Summary), so there is
    // no compelling reason to override the preferred default here: a
    // single historical occurrence adds nothing a disclosure would clarify
    // beyond the badge already shown.
    const asn = makeAssignments({
      c1: {
        state: "onePublishedFullyCurrent",
        currentAssignmentId: "a-1",
        currentAssignmentResolution: "valid" as const,
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
    expect(
      document.querySelector("[data-testid=assign-row-history-toggle-c1]"),
    ).toBeNull();
  });

  test("1 candidate (historicalOnly, unresolved): no separate Assignment history disclosure by default", async () => {
    const asn = makeAssignments({
      c1: {
        state: "historicalOnly",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [historicalCandidate()],
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
      document.querySelector("[data-testid=assign-row-history-toggle-c1]"),
    ).toBeNull();
  });

  test("valid Current marks exactly the matching candidate, no others", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-y",
        currentAssignmentResolution: "valid" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-x", title: "X" }),
          publishedCandidate({ assignmentId: "a-y", title: "Y" }),
          publishedCandidate({ assignmentId: "a-z", title: "Z" }),
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    const panel = document.querySelector<HTMLElement>(
      "[data-testid=assign-row-history-c1]",
    )!;
    expect(
      panel.querySelectorAll("[data-testid=assign-row-history-current-c1]"),
    ).toHaveLength(1);
    const markedItem = panel.querySelector(
      "[data-testid=assign-row-history-item-c1-a-y]",
    );
    expect(
      markedItem?.querySelector("[data-testid=assign-row-history-current-c1]"),
    ).not.toBeNull();
    for (const id of ["a-x", "a-z"]) {
      const item = panel.querySelector(
        `[data-testid=assign-row-history-item-c1-${id}]`,
      );
      expect(
        item?.querySelector("[data-testid=assign-row-history-current-c1]"),
      ).toBeNull();
    }
  });

  test("unresolved Current: no candidate marked Current in history", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-x", title: "X" }),
          publishedCandidate({ assignmentId: "a-y", title: "Y" }),
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    expect(
      document.querySelector("[data-testid=assign-row-history-current-c1]"),
    ).toBeNull();
  });

  test("invalid Current: History does not bypass the fail-safe - no history control at all", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "invalid" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-x" }),
          publishedCandidate({ assignmentId: "a-y" }),
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
      document.querySelector("[data-testid=assign-row-history-toggle-c1]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-history-c1]"),
    ).toBeNull();
    // The Slice 10/11 fail-safe remains: Retry only.
    expect(
      document.querySelector("[data-testid=assign-row-retry-c1]"),
    ).not.toBeNull();
  });

  test("no-heuristic guarantee: a valid Current ID absent from candidates marks nothing", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-ghost",
        currentAssignmentResolution: "valid" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-x" }),
          publishedCandidate({ assignmentId: "a-y" }),
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    expect(
      document.querySelector("[data-testid=assign-row-history-current-c1]"),
    ).toBeNull();
  });

  test("candidates render in exactly the server-provided order", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-third", title: "Third" }),
          publishedCandidate({ assignmentId: "a-first", title: "First" }),
          publishedCandidate({ assignmentId: "a-second", title: "Second" }),
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    const items = Array.from(
      document.querySelectorAll("[data-testid^=assign-row-history-item-c1-]"),
    );
    expect(items.map((el) => el.getAttribute("data-testid"))).toEqual([
      "assign-row-history-item-c1-a-third",
      "assign-row-history-item-c1-a-first",
      "assign-row-history-item-c1-a-second",
    ]);
  });

  test("status is rendered as Published, Closed, and Draft", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-pub" }),
          publishedCandidate({
            assignmentId: "a-second-pub",
            title: "Second",
          }),
          historicalCandidate({ assignmentId: "a-closed", status: "closed" }),
          historicalCandidate({ assignmentId: "a-draft", status: "draft" }),
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    const published = document.querySelector(
      "[data-testid=assign-row-history-item-c1-a-pub] .shell-assign-row-history-status",
    );
    const closed = document.querySelector(
      "[data-testid=assign-row-history-item-c1-a-closed] .shell-assign-row-history-status",
    );
    const draft = document.querySelector(
      "[data-testid=assign-row-history-item-c1-a-draft] .shell-assign-row-history-status",
    );
    expect(published?.textContent).toBe("Published");
    expect(closed?.textContent).toBe("Closed");
    expect(draft?.textContent).toBe("Draft");
  });

  test("recipient count uses singular and plural forms correctly", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-one", recipientCount: 1 }),
          publishedCandidate({ assignmentId: "a-many", recipientCount: 9 }),
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    expect(
      document.querySelector(
        "[data-testid=assign-row-history-item-c1-a-one] .shell-assign-row-history-recipients",
      )?.textContent,
    ).toBe("1 recipient");
    expect(
      document.querySelector(
        "[data-testid=assign-row-history-item-c1-a-many] .shell-assign-row-history-recipients",
      )?.textContent,
    ).toBe("9 recipients");
  });

  test("a null publishedAt renders a safe neutral fallback, never an epoch or Invalid Date", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "a-pub" }),
          historicalCandidate({
            assignmentId: "a-draft",
            status: "draft",
            publishedAt: null,
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    const dateText = document.querySelector(
      "[data-testid=assign-row-history-item-c1-a-draft] .shell-assign-row-history-date",
    )?.textContent;
    expect(dateText).toBe("Draft");
    expect(dateText).not.toMatch(/^\d/);
    expect(dateText).not.toMatch(/1970|NaN|Invalid Date/);
  });

  test("history never displays a raw assignmentId", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "assignment-secret-id-111" }),
          publishedCandidate({
            assignmentId: "assignment-secret-id-222",
            title: "Second",
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    const panel = document.querySelector<HTMLElement>(
      "[data-testid=assign-row-history-c1]",
    )!;
    expect(panel.textContent).not.toContain("assignment-secret-id-111");
    expect(panel.textContent).not.toContain("assignment-secret-id-222");
  });

  test("opening Assignment history performs zero mutations", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-1",
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    await flush();
    expect(asn.currentSetCalls).toHaveLength(0);
    expect(asn.currentReconcileCalls).toHaveLength(0);
    expect(asn.reconcileCalls).toHaveLength(0);
    expect(asn.draftCalls).toHaveLength(0);
  });

  test("closing Assignment history performs zero mutations", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-1",
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
    const toggle = document.querySelector<HTMLButtonElement>(
      "[data-testid=assign-row-history-toggle-c1]",
    )!;
    toggle.click();
    await flush();
    toggle.click();
    await flush();
    expect(
      document
        .querySelector("[data-testid=assign-row-history-c1]")
        ?.hasAttribute("hidden"),
    ).toBe(true);
    expect(asn.currentSetCalls).toHaveLength(0);
    expect(asn.currentReconcileCalls).toHaveLength(0);
    expect(asn.reconcileCalls).toHaveLength(0);
    expect(asn.draftCalls).toHaveLength(0);
  });

  test("opening/selecting Assignment history does not alter a pending Set Current selection", async () => {
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
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-row-set-current-c1]")
      ?.click();
    await flush();
    const radio = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-current-option-c1-a-1]",
    )!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    // Now open and close History.
    const historyToggle = document.querySelector<HTMLButtonElement>(
      "[data-testid=assign-row-history-toggle-c1]",
    )!;
    historyToggle.click();
    await flush();
    historyToggle.click();
    await flush();
    // The Set Current selection survives untouched.
    expect(radio.checked).toBe(true);
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-set-current-confirm-c1]",
      )
      ?.click();
    await flush();
    await flush();
    await flush();
    expect(asn.currentSetCalls).toEqual([
      {
        classId: "c1",
        lessonSlug: LESSON_SLUG,
        assignmentId: "a-1",
        expectedCurrentAssignmentId: null,
      },
    ]);
  });

  test("opening Assignment history does not alter a pending Change Current selection", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-1",
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-change-current-c1]",
      )
      ?.click();
    await flush();
    const radio = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-current-option-c1-a-2]",
    )!;
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    const historyToggle = document.querySelector<HTMLButtonElement>(
      "[data-testid=assign-row-history-toggle-c1]",
    )!;
    historyToggle.click();
    await flush();
    expect(radio.checked).toBe(true);
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-change-current-confirm-c1]",
      )
      ?.click();
    await flush();
    await flush();
    await flush();
    expect(asn.currentSetCalls).toEqual([
      {
        classId: "c1",
        lessonSlug: LESSON_SLUG,
        assignmentId: "a-2",
        expectedCurrentAssignmentId: "a-1",
      },
    ]);
  });

  test("Assignment history presence does not alter the ordinary Update Assignment request", async () => {
    const asn = makeAssignments(
      {
        c1: {
          state: "onePublishedMissingRecipients",
          currentAssignmentId: "a-1",
          currentAssignmentResolution: "valid" as const,
          candidates: [
            publishedCandidate(),
            historicalCandidate({ assignmentId: "a-old" }),
          ],
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();
    expect(asn.currentReconcileCalls).toEqual([
      { classId: "c1", lessonSlug: LESSON_SLUG },
    ]);
    expect(asn.reconcileCalls).toHaveLength(0);
  });

  test("multi-class isolation: opening Class A's history does not open Class B's", async () => {
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
      c2: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          publishedCandidate({ assignmentId: "b-1" }),
          publishedCandidate({ assignmentId: "b-2", title: "Second" }),
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    await flush();
    expect(
      document
        .querySelector("[data-testid=assign-row-history-c1]")
        ?.hasAttribute("hidden"),
    ).toBe(false);
    expect(
      document
        .querySelector("[data-testid=assign-row-history-c2]")
        ?.hasAttribute("hidden"),
    ).toBe(true);
  });

  test("historicalOnly with 2+ candidates and unresolved Current: Assign as new preserved, history available, no Set Current", async () => {
    const asn = makeAssignments({
      c1: {
        state: "historicalOnly",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          historicalCandidate({ assignmentId: "a-old-1", status: "closed" }),
          historicalCandidate({ assignmentId: "a-old-2", status: "draft" }),
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
    expect(
      document.querySelector("[data-testid=assign-row-set-current-c1]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-history-toggle-c1]"),
    ).not.toBeNull();
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    expect(
      document.querySelector("[data-testid=assign-row-history-current-c1]"),
    ).toBeNull();
  });

  test("onePublishedMissingRecipients + unresolved (1 candidate): Set Current preserved, no unnecessary history disclosure", async () => {
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
      document.querySelector("[data-testid=assign-row-set-current-c1]"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-history-toggle-c1]"),
    ).toBeNull();
  });

  test("multiplePublished + unresolved: Set Current and Assignment history coexist with no shared selection authority", async () => {
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
      document.querySelector("[data-testid=assign-row-set-current-c1]"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-history-toggle-c1]"),
    ).not.toBeNull();
    // Opening history selects nothing in Set Current.
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    await flush();
    document
      .querySelector<HTMLButtonElement>("[data-testid=assign-row-set-current-c1]")
      ?.click();
    await flush();
    const radios = document.querySelectorAll<HTMLInputElement>(
      '[data-testid=assign-row-set-current-panel-c1] input[type="radio"]',
    );
    for (const radio of Array.from(radios)) {
      expect(radio.checked).toBe(false);
    }
  });

  test("multiplePublished + valid: Update, Change Current, and Assignment history coexist", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-1",
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
    const checkbox = document.querySelector<HTMLInputElement>(
      "[data-testid=assign-row-enabled-c1]",
    );
    expect(checkbox?.disabled).toBe(false);
    expect(
      document.querySelector("[data-testid=assign-row-change-current-c1]"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-history-toggle-c1]"),
    ).not.toBeNull();
  });

  test("Assignment history panel contains no mutation-control labels", async () => {
    const asn = makeAssignments({
      c1: {
        state: "multiplePublished",
        currentAssignmentId: "a-1",
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
    document
      .querySelector<HTMLButtonElement>(
        "[data-testid=assign-row-history-toggle-c1]",
      )
      ?.click();
    // Scoped strictly to the History panel itself - the same row legitimately
    // contains "Change current assignment" and "Update Assignment" elsewhere.
    const panel = document.querySelector<HTMLElement>(
      "[data-testid=assign-row-history-c1]",
    )!;
    const panelText = panel.textContent ?? "";
    expect(panelText).not.toContain("Set as current assignment");
    expect(panelText).not.toContain("Change current assignment");
    expect(panelText).not.toContain("Update Assignment");
    expect(panelText).not.toContain("Assign as new");
    expect(panelText).not.toContain("Clear Current");
    expect(panel.querySelectorAll("button")).toHaveLength(0);
    expect(panel.querySelectorAll('input[type="radio"]')).toHaveLength(0);
  });

  test("Assignment history control has accessible disclosure semantics", async () => {
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
    const toggle = document.querySelector<HTMLButtonElement>(
      "[data-testid=assign-row-history-toggle-c1]",
    )!;
    const panel = document.querySelector<HTMLElement>(
      "[data-testid=assign-row-history-c1]",
    )!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.hidden).toBe(true);
    expect(toggle.getAttribute("aria-label")?.length ?? 0).toBeGreaterThan(0);
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(panel.querySelector('[role="list"]')).not.toBeNull();
  });

  // ---- Slice 13: final certification, Phase 3 Case G ----

  test("Case G: five classes, five distinct lifecycle/Current combinations, fully independent in one dialog", async () => {
    const asn = makeAssignments({
      // c1: neverAssigned + unresolved (default - no override).
      c2: {
        state: "onePublishedMissingRecipients",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [publishedCandidate({ assignmentId: "c2-a1" })],
      },
      c3: {
        state: "multiplePublished",
        currentAssignmentId: "c3-a1",
        currentAssignmentResolution: "valid" as const,
        candidates: [
          publishedCandidate({ assignmentId: "c3-a1" }),
          publishedCandidate({ assignmentId: "c3-a2", title: "Second" }),
        ],
      },
      c4: {
        state: "historicalOnly",
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [
          historicalCandidate({ assignmentId: "c4-old1", status: "closed" }),
          historicalCandidate({ assignmentId: "c4-old2", status: "draft" }),
        ],
      },
      c5: {
        state: "multiplePublished",
        currentAssignmentId: null,
        currentAssignmentResolution: "invalid" as const,
        candidates: [
          publishedCandidate({ assignmentId: "c5-a1" }),
          publishedCandidate({ assignmentId: "c5-a2", title: "Second" }),
        ],
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listFive,
      assignments: asn.seam,
    });
    clickAssign(mount, LESSON_SLUG);
    await flush();
    await flush();

    // c1: neverAssigned - ordinary Assign creation row, no Set Current, no
    // History, checkbox enabled and date/time controls present.
    expect(
      document.querySelector("[data-testid=assign-row-lifecycle-c1]")
        ?.textContent,
    ).toBeFalsy();
    expect(
      document.querySelector<HTMLInputElement>(
        "[data-testid=assign-row-enabled-c1]",
      )?.disabled,
    ).toBe(false);
    expect(
      document.querySelector("[data-testid=assign-row-date-c1]"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-set-current-c1]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-history-toggle-c1]"),
    ).toBeNull();

    // c2: onePublishedMissingRecipients + unresolved - Set Current required,
    // Update blocked, no History (single candidate).
    expect(
      document.querySelector("[data-testid=assign-row-lifecycle-c2]")
        ?.textContent,
    ).toBe("Needs resolution before updating");
    expect(
      document.querySelector<HTMLInputElement>(
        "[data-testid=assign-row-enabled-c2]",
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector("[data-testid=assign-row-set-current-c2]"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-history-toggle-c2]"),
    ).toBeNull();

    // c3: multiplePublished + valid - Update available, Change Current
    // available, History available.
    expect(
      document.querySelector<HTMLInputElement>(
        "[data-testid=assign-row-enabled-c3]",
      )?.disabled,
    ).toBe(false);
    expect(
      document.querySelector("[data-testid=assign-row-change-current-c3]"),
    ).not.toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-set-current-c3]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-history-toggle-c3]"),
    ).not.toBeNull();

    // c4: historicalOnly + unresolved - Assign as new available, History
    // available (2 closed/draft candidates), no Set Current (no eligible
    // published target exists).
    expect(
      document.querySelector("[data-testid=assign-row-lifecycle-c4]")
        ?.textContent,
    ).toBe("Assign as new");
    expect(
      document.querySelector<HTMLInputElement>(
        "[data-testid=assign-row-enabled-c4]",
      )?.disabled,
    ).toBe(false);
    expect(
      document.querySelector("[data-testid=assign-row-set-current-c4]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-history-toggle-c4]"),
    ).not.toBeNull();

    // c5: invalid Current - fail-safe Retry only, no Set/Change/Update/
    // History, regardless of having 2 published candidates.
    expect(
      document.querySelector("[data-testid=assign-row-lifecycle-c5]")
        ?.textContent,
    ).toBe("Current assignment could not be verified");
    expect(
      document.querySelector<HTMLInputElement>(
        "[data-testid=assign-row-enabled-c5]",
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector("[data-testid=assign-row-set-current-c5]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-change-current-c5]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-history-toggle-c5]"),
    ).toBeNull();
    expect(
      document.querySelector("[data-testid=assign-row-retry-c5]"),
    ).not.toBeNull();

    // Confirming runs exactly the expected mixed lifecycle. Every row's
    // checkbox starts enabled by default UNLESS render-time gating force-
    // disabled it (c2 and c5 above). c1 (neverAssigned) and c4
    // (historicalOnly) are both legitimate creation rows and both remain
    // enabled, so both create; c3 (multiplePublished+valid) is the only
    // enabled update row and reconciles via Current-aware reconcile only.
    // c2 and c5 are disabled and contribute to neither bucket - no
    // createDraft, no currentSet, no reconcile of any kind for either.
    clickConfirm();
    await flush();
    await flush();
    await flush();
    expect(asn.draftCalls).toContain("c1");
    expect(asn.draftCalls).toContain("c4");
    expect(asn.draftCalls).not.toContain("c2");
    expect(asn.draftCalls).not.toContain("c5");
    expect(asn.currentReconcileCalls).toEqual([
      { classId: "c3", lessonSlug: LESSON_SLUG },
    ]);
    expect(asn.currentSetCalls).toHaveLength(0);
    expect(asn.reconcileCalls).toHaveLength(0);
  });
});
