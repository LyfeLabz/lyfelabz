/**
 * @jest-environment jsdom
 *
 * Results-first: when a teacher changes assignments from Results (Manage
 * Assignments -> the existing Assign dialog), the open Results re-reads the
 * existing lesson-summary callable only after a confirmed save. Pending and
 * failed saves never refresh it, and outcome messages are shown in Results.
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type {
  AssignmentsCallables,
  AssignmentsCreateDraftInput,
  AssignmentsPublishInput,
} from "../../settings/integrations/types";
import type { AssignmentDetailMetadata } from "../../assignments/detail/types";
import type { LessonSummaryCallable } from "../../assignments/summary/types";
import {
  renderCurriculumSurface,
  _resetCurriculumSessionStateForTest,
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

const twoClasses: ReadonlyArray<ClassSummary> = freeze([
  freeze({ id: "c1", title: "6A", grade: "6", status: "active" }),
  freeze({ id: "c2", title: "7B", grade: "7", status: "active" }),
] as ClassSummary[]);

const listTwo: ListClasses = () => Promise.resolve(twoClasses);

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

type Gate = {
  readonly wait: () => Promise<void>;
  readonly release: () => void;
};

const makeGate = (): Gate => {
  let resolveFn: () => void = () => undefined;
  const promise = new Promise<void>((r) => {
    resolveFn = r;
  });
  return {
    wait: () => promise,
    release: () => resolveFn(),
  };
};

const makeAssignments = (
  opts: {
    failCreateDraft?: boolean;
    failPublish?: boolean;
    createDraftGate?: Gate;
    publishGate?: Gate;
    // c1 already has a valid Current missing recipients, so the dialog saves
    // it as an update of the existing assignment rather than a new one.
    c1Existing?: boolean;
    failReconcile?: boolean;
    reconcileGate?: Gate;
  } = {},
): {
  seam: AssignmentsCallables;
  drafts: AssignmentsCreateDraftInput[];
  publishes: AssignmentsPublishInput[];
  reconciles: string[];
} => {
  const reconciles: string[] = [];
  const drafts: AssignmentsCreateDraftInput[] = [];
  const publishes: AssignmentsPublishInput[] = [];
  return {
    drafts,
    publishes,
    reconciles,
    seam: {
      createDraft: async (input) => {
        drafts.push(input);
        if (opts.createDraftGate) await opts.createDraftGate.wait();
        if (opts.failCreateDraft) throw new Error("createDraft failed");
        return {
          assignmentId: input.assignmentId,
          status: "draft" as const,
          alreadyCreated: false,
        };
      },
      publish: async (input) => {
        if (opts.publishGate) await opts.publishGate.wait();
        if (opts.failPublish) throw new Error("publish failed");
        publishes.push(input);
        return {
          assignmentId: input.assignmentId,
          status: "published" as const,
          alreadyPublished: false,
        };
      },
      lifecycleState: async (input) =>
        opts.c1Existing && input.classId === "c1"
          ? {
              state: "onePublishedMissingRecipients" as const,
              currentAssignmentId: "a-existing",
              currentAssignmentResolution: "valid" as const,
              candidates: [
                freeze({
                  assignmentId: "a-existing",
                  title: "Earth's Layers",
                  status: "published" as const,
                  publishedAt: 1700000000000,
                  recipientCount: 5,
                  activeEnrollmentCount: 6,
                  missingRecipientCount: 1,
                }),
              ],
            }
          : {
        state: "neverAssigned" as const,
        currentAssignmentId: null,
        currentAssignmentResolution: "unresolved" as const,
        candidates: [],
      },
      currentSet: async (input) => ({
        classId: input.classId,
        lessonSlug: input.lessonSlug,
        assignmentId: input.assignmentId,
        changed: true,
      }),
      currentRecipientsReconcile: async (input) => {
        reconciles.push(input.classId);
        if (opts.reconcileGate) await opts.reconcileGate.wait();
        if (opts.failReconcile) throw new Error("reconcile failed");
        return {
          classId: input.classId,
          lessonSlug: input.lessonSlug,
          assignmentId: "a-existing",
          added: 1,
          alreadyCurrent: 5,
        };
      },
      recipientsReconcile: async (input) => ({
        assignmentId: input.assignmentId,
        added: 0,
        alreadyCurrent: 0,
      }),
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


const SLUG = "earths-layers";

// Owned published history so the card reads Results.
const history: AssignmentDetailMetadata[] = [
  freeze({
    assignmentId: "a-existing",
    title: "Check for Understanding",
    className: "6A",
    status: "published",
    lessonSlug: SLUG,
  }) as AssignmentDetailMetadata,
];

const makeSummary = (): { callable: LessonSummaryCallable; calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    callable: (input) => {
      calls.push(input.lessonSlug);
      return Promise.resolve(
        freeze({
          lessonSlug: input.lessonSlug,
          classesAssigned: calls.length,
          students: 0,
          studentsCompleted: 0,
          completionPercentage: 0,
          averageBestPercentage: null,
          assignmentsConsidered: calls.length,
        }),
      );
    },
  };
};

const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await flush();
};

// Opens Results for SLUG, then Manage Assignments, then confirms the dialog.
const manageFromResults = async (
  opts: Parameters<typeof makeAssignments>[0],
) => {
  const asn = makeAssignments(opts);
  const detail = makeDetailSeam(history);
  const summary = makeSummary();
  const mount = mkMount();
  renderCurriculumSurface(mount, teacher, {
    listClasses: listTwo,
    assignments: asn.seam,
    assignmentDetail: detail.seam,
    lessonSummary: summary.callable,
  });
  const results = mount.querySelector<HTMLButtonElement>(
    `[data-testid=lesson-assign-${SLUG}]`,
  )!;
  expect(results.textContent).toBe("Results");
  results.click();
  await flush();
  expect(summary.calls).toHaveLength(1);
  mount
    .querySelector<HTMLButtonElement>("[data-testid=lesson-summary-manage]")!
    .click();
  await flush();
  document
    .querySelector<HTMLButtonElement>("[data-testid=assign-confirm]")!
    .click();
  return { mount, summary, asn };
};

const value = (mount: HTMLElement, key: string): string | null =>
  mount.querySelector(`[data-testid=lesson-summary-value-${key}]`)?.textContent ?? null;

describe("Results refreshes after a confirmed Manage Assignments save", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("a confirmed save re-reads the same callable once and updates the open Results in place", async () => {
    const { mount, summary, asn } = await manageFromResults({});
    await settle();
    expect(asn.publishes.length).toBeGreaterThan(0);
    // One initial read plus exactly one refresh; no polling.
    expect(summary.calls).toEqual([SLUG, SLUG]);
    expect(value(mount, "classes")).toBe("2");
    // Still on Results; the outcome message is visible there.
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).not.toBeNull();
    const status = mount.querySelector<HTMLElement>("[data-testid=lesson-summary-status]")!;
    expect(status.hidden).toBe(false);
    expect(status.getAttribute("role")).toBe("status");
    await settle();
    expect(summary.calls).toHaveLength(2);
  });

  test("a pending save does not refresh until it is confirmed", async () => {
    const publishGate = makeGate();
    const { mount, summary } = await manageFromResults({ publishGate });
    await settle();
    expect(summary.calls).toHaveLength(1);
    expect(value(mount, "classes")).toBe("1");
    publishGate.release();
    await settle();
    expect(summary.calls).toHaveLength(2);
  });

  test("a failed save never refreshes, and its failure message is shown in Results", async () => {
    const { mount, summary } = await manageFromResults({ failPublish: true });
    await settle();
    expect(summary.calls).toHaveLength(1);
    expect(value(mount, "classes")).toBe("1");
    const status = mount.querySelector<HTMLElement>("[data-testid=lesson-summary-status]")!;
    expect(status.hidden).toBe(false);
    expect(status.textContent).not.toBe("");
  });

  test("a save completing after leaving Results does not re-read or reopen it", async () => {
    const publishGate = makeGate();
    const { mount, summary } = await manageFromResults({ publishGate });
    await flush();
    mount.querySelector<HTMLButtonElement>("[data-testid=lesson-summary-back]")!.click();
    publishGate.release();
    await settle();
    expect(summary.calls).toHaveLength(1);
    expect(mount.querySelector("[data-testid=lesson-summary-surface]")).toBeNull();
  });

  test("a mixed save refreshes when new classes fail before a draft exists but the existing assignment updates", async () => {
    const { summary, asn } = await manageFromResults({
      c1Existing: true,
      failCreateDraft: true,
    });
    await settle();
    expect(asn.reconciles).toEqual(["c1"]);
    expect(summary.calls).toEqual([SLUG, SLUG]);
  });

  test("a mixed save refreshes when only the existing-assignment update succeeded", async () => {
    // c2 is new and fails; c1 is an existing assignment and saves.
    const { summary, asn } = await manageFromResults({
      c1Existing: true,
      failPublish: true,
    });
    await settle();
    expect(asn.reconciles).toEqual(["c1"]);
    expect(asn.drafts.map((d) => d.classId)).toEqual(["c2"]);
    expect(summary.calls).toEqual([SLUG, SLUG]);
  });

  test("a mixed save refreshes once, only after both halves settle", async () => {
    const reconcileGate = makeGate();
    const { summary, asn } = await manageFromResults({
      c1Existing: true,
      reconcileGate,
    });
    await settle();
    // New assignment published, existing update still pending: no refresh.
    expect(asn.publishes.length).toBe(1);
    expect(summary.calls).toHaveLength(1);
    reconcileGate.release();
    await settle();
    expect(summary.calls).toEqual([SLUG, SLUG]);
  });

  test("a mixed save where nothing succeeded never refreshes", async () => {
    const { summary } = await manageFromResults({
      c1Existing: true,
      failPublish: true,
      failReconcile: true,
    });
    await settle();
    expect(summary.calls).toHaveLength(1);
  });
});
