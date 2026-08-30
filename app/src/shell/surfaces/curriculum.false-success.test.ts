/**
 * @jest-environment jsdom
 *
 * Regression suite for the "Assign" false-success bug.
 *
 * Bug reproduced in production 2026-07-22: clicking Assign on the
 * Curriculum surface flipped the lesson card to "✓ Assigned" even
 * though the certified `assignmentsCreateDraft` / `assignmentsPublish`
 * callables never returned a persisted, `published` record. The card's
 * badge is now driven exclusively from an authoritative persisted
 * signal, so these tests lock the corrected behavior in place.
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
  } = {},
): {
  seam: AssignmentsCallables;
  drafts: AssignmentsCreateDraftInput[];
  publishes: AssignmentsPublishInput[];
} => {
  const drafts: AssignmentsCreateDraftInput[] = [];
  const publishes: AssignmentsPublishInput[] = [];
  return {
    drafts,
    publishes,
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

const assignBtn = (
  mount: HTMLElement,
  slug: string,
): HTMLButtonElement | null =>
  mount.querySelector<HTMLButtonElement>(`[data-testid=lesson-assign-${slug}]`);

// Sprint 28.6H (Finding 8): the visible "✓ Assigned" badge is removed - the
// Assign control always reads "Assign" and is always re-assignable. The
// assignment-history signal now lives on the card dataset
// (data-lesson-assigned), which still drives View Summary visibility. Tests
// assert that signal via the card that owns the Assign button.
const assignedState = (btn: HTMLButtonElement | null): string | null =>
  btn?.closest<HTMLElement>("[data-lesson-slug]")?.getAttribute(
    "data-lesson-assigned",
  ) ?? null;

describe("Assign false-success guard", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("card does not flip to ✓ Assigned until assignmentsPublish resolves", async () => {
    const publishGate = makeGate();
    const asn = makeAssignments({ publishGate });
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });

    clickAssign(mount, "earths-layers");
    await flush();
    clickConfirm();
    // Dialog closed; lifecycle in flight but not yet resolved.
    await flush();
    await flush();

    const btn = assignBtn(mount, "earths-layers");
    expect(btn?.textContent).toBe("Assign");
    expect(assignedState(btn)).toBe("false");

    // Now let publish resolve.
    publishGate.release();
    await flush();
    await flush();
    await flush();

    expect(assignedState(btn)).toBe("true");
    expect(btn?.textContent).toBe("Reassign");
    expect(assignedState(btn)).toBe("true");
    expect(asn.publishes.length).toBeGreaterThan(0);
  });

  test("assignmentsCreateDraft failure does not show ✓ Assigned", async () => {
    const asn = makeAssignments({ failCreateDraft: true });
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });

    clickAssign(mount, "earths-layers");
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();

    const btn = assignBtn(mount, "earths-layers");
    expect(btn?.textContent).toBe("Assign");
    expect(assignedState(btn)).toBe("false");
    expect(asn.publishes).toHaveLength(0);
    expect(detail.registered).toHaveLength(0);
  });

  test("assignmentsPublish failure does not show ✓ Assigned", async () => {
    const asn = makeAssignments({ failPublish: true });
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });

    clickAssign(mount, "earths-layers");
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();

    const btn = assignBtn(mount, "earths-layers");
    expect(btn?.textContent).toBe("Assign");
    expect(assignedState(btn)).toBe("false");
    expect(asn.drafts.length).toBeGreaterThan(0);
    expect(detail.registered).toHaveLength(0);
  });

  // Sprint 26 Phase 3 (Defect 2.A). Before Phase 3 this test asserted the
  // banner said the assignment "was not created" when publish failed. That
  // statement was false: `assignmentsCreateDraft` succeeded, so a durable
  // LyfeLabz draft exists. The corrected outcome model reports the
  // saved-but-not-published state truthfully and never claims nothing was
  // created. This test intentionally supersedes the old expectation.
  test("publish failure reports saved-but-not-published, never 'was not created'", async () => {
    const asn = makeAssignments({ failPublish: true });
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });

    clickAssign(mount, "earths-layers");
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();

    const banner = mount.querySelector<HTMLElement>(
      "[data-testid=assign-success]",
    );
    const text = banner?.textContent ?? "";
    // Both classes reached the durable draft; publish failed for both.
    expect(text).toMatch(/was saved for 2 classes/);
    expect(text).toMatch(/publishing did not complete/i);
    // The defect that this suite guards against: never say nothing was made.
    expect(text).not.toMatch(/was not created/);
    // The drafts survived, so no Assigned badge and no data loss claim.
    expect(asn.drafts.length).toBe(2);
    const btn = assignBtn(mount, "earths-layers");
    expect(assignedState(btn)).toBe("false");
  });

  test("draft-create failure reports the assignment could not be saved", async () => {
    const asn = makeAssignments({ failCreateDraft: true });
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      assignmentDetail: detail.seam,
    });

    clickAssign(mount, "earths-layers");
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();

    const banner = mount.querySelector<HTMLElement>(
      "[data-testid=assign-success]",
    );
    const text = banner?.textContent ?? "";
    // Nothing durable was saved: the message says so and does not imply a
    // recoverable draft exists.
    expect(text).toMatch(/could not be saved/i);
    expect(text).not.toMatch(/was saved/);
    expect(text).not.toMatch(/was not created/);
    // No publish and no Google Classroom step is attempted or claimed.
    expect(asn.publishes).toHaveLength(0);
    expect(text).not.toMatch(/Google Classroom/);
  });

  test("mixed outcome: one class publishes, one saves-but-does-not-publish", async () => {
    // c1 publish fails (saved but not published); c2 publishes.
    let publishCall = 0;
    const seam: AssignmentsCallables = {
      createDraft: async (input) => ({
        assignmentId: input.assignmentId,
        status: "draft" as const,
        alreadyCreated: false,
      }),
      publish: async (input) => {
        publishCall += 1;
        if (publishCall === 1) throw new Error("first publish failed");
        return {
          assignmentId: input.assignmentId,
          status: "published" as const,
          alreadyPublished: false,
        };
      },
    };
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: seam,
      assignmentDetail: detail.seam,
    });

    clickAssign(mount, "earths-layers");
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();

    const banner = mount.querySelector<HTMLElement>(
      "[data-testid=assign-success]",
    );
    const text = banner?.textContent ?? "";
    // The successful class is not downgraded by the other class's failure.
    expect(text).toMatch(/Assigned Earth's Layers to 1 of 2 classes/);
    // The saved-but-not-published class is reported truthfully.
    expect(text).toMatch(/saved but not published/);
    expect(text).not.toMatch(/was not created/);
    // One class published, so the badge is Assigned.
    const btn = assignBtn(mount, "earths-layers");
    expect(assignedState(btn)).toBe("true");
    expect(btn?.textContent).toBe("Reassign");
  });

  test("persisted assignment is rediscovered on remount (post-reload hydration)", () => {
    const hydrated: AssignmentDetailMetadata[] = [
      {
        assignmentId: "asn-earths-1",
        title: "Earth's Layers",
        className: "6A · Grade 6",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
    ];
    const detail = makeDetailSeam(hydrated);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });

    const btn = assignBtn(mount, "earths-layers");
    expect(assignedState(btn)).toBe("true");
    expect(btn?.textContent).toBe("Reassign");
    expect(assignedState(btn)).toBe("true");
  });

  test("partial success (one class publishes, one fails) shows ✓ Assigned", async () => {
    let publishCall = 0;
    const drafts: AssignmentsCreateDraftInput[] = [];
    const publishes: AssignmentsPublishInput[] = [];
    const seam: AssignmentsCallables = {
      createDraft: async (input) => {
        drafts.push(input);
        return {
          assignmentId: input.assignmentId,
          status: "draft" as const,
          alreadyCreated: false,
        };
      },
      publish: async (input) => {
        publishCall += 1;
        if (publishCall === 1) throw new Error("first publish failed");
        publishes.push(input);
        return {
          assignmentId: input.assignmentId,
          status: "published" as const,
          alreadyPublished: false,
        };
      },
    };
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: seam,
      assignmentDetail: detail.seam,
    });

    clickAssign(mount, "earths-layers");
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();

    const btn = assignBtn(mount, "earths-layers");
    expect(assignedState(btn)).toBe("true");
    expect(btn?.textContent).toBe("Reassign");
    expect(assignedState(btn)).toBe("true");
    expect(publishes.length).toBe(1);
  });

  test("hydration only lights up cards whose lessonSlug exactly matches", () => {
    const hydrated: AssignmentDetailMetadata[] = [
      {
        assignmentId: "asn-neighbor-1",
        title: "Neighboring Lesson",
        className: "6A",
        status: "published",
        lessonSlug: "earths-layers-intro",
        classId: "c1",
      },
    ];
    const detail = makeDetailSeam(hydrated);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });

    const btn = assignBtn(mount, "earths-layers");
    expect(btn?.textContent).toBe("Assign");
    expect(assignedState(btn)).toBe("false");
  });

  test("multiple classes assigned the same lesson still produce one stable Assigned state", () => {
    const hydrated: AssignmentDetailMetadata[] = [
      {
        assignmentId: "asn-earths-1",
        title: "Earth's Layers",
        className: "6A",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
      {
        assignmentId: "asn-earths-2",
        title: "Earth's Layers",
        className: "7B",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c2",
      },
    ];
    const detail = makeDetailSeam(hydrated);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });

    const buttons = mount.querySelectorAll<HTMLButtonElement>(
      "[data-testid=lesson-assign-earths-layers]",
    );
    expect(buttons.length).toBe(1);
    expect(assignedState(buttons[0])).toBe("true");
    expect(buttons[0]?.textContent).toBe("Reassign");
    expect(assignedState(buttons[0])).toBe("true");
  });

  test("empty hydration result does not flip a card to Assigned", () => {
    const detail = makeDetailSeam([]);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });

    const btn = assignBtn(mount, "earths-layers");
    expect(btn?.textContent).toBe("Assign");
    expect(assignedState(btn)).toBe("false");
  });
});

// ---------------------------------------------------------------------------
// Sprint 26 Phase 3 (Defect 2.A) - three-way multi-class outcome truthfulness.
// ---------------------------------------------------------------------------
describe("Assign outcome model - three-way multi-class mix", () => {
  const threeClasses: ReadonlyArray<ClassSummary> = freeze([
    freeze({ id: "c1", title: "6A", grade: "6", status: "active" }),
    freeze({ id: "c2", title: "7B", grade: "7", status: "active" }),
    freeze({ id: "c3", title: "7C", grade: "7", status: "active" }),
  ] as ClassSummary[]);
  const listThree: ListClasses = () => Promise.resolve(threeClasses);

  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("published + saved-not-published + draft-failed are each reported truthfully", async () => {
    // Deterministic ordering: createDraft is invoked in row order c1, c2,
    // c3; publish is invoked (for rows that saved a draft) in the same
    // relative order. So: c1 draft fails, c2 publish fails, c3 succeeds.
    let draftCall = 0;
    let publishCall = 0;
    const seam: AssignmentsCallables = {
      createDraft: async (input) => {
        draftCall += 1;
        if (draftCall === 1) throw new Error("first draft failed");
        return {
          assignmentId: input.assignmentId,
          status: "draft" as const,
          alreadyCreated: false,
        };
      },
      publish: async (input) => {
        publishCall += 1;
        if (publishCall === 1) throw new Error("first publish failed");
        return {
          assignmentId: input.assignmentId,
          status: "published" as const,
          alreadyPublished: false,
        };
      },
    };
    const detail = makeDetailSeam();
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listThree,
      assignments: seam,
      assignmentDetail: detail.seam,
    });

    clickAssign(mount, "earths-layers");
    await flush();
    clickConfirm();
    await flush();
    await flush();
    await flush();

    const banner = mount.querySelector<HTMLElement>(
      "[data-testid=assign-success]",
    );
    const text = banner?.textContent ?? "";
    // One class published; it is not downgraded by the two failures.
    expect(text).toMatch(/Assigned Earth's Layers to 1 of 3 classes/);
    // The saved-but-not-published class is not upgraded and not lost.
    expect(text).toMatch(/saved but not published/);
    // The genuinely-unsaved class is reported as unsaved, not recoverable.
    expect(text).toMatch(/could not be saved/);
    expect(text).not.toMatch(/was not created/);
    // A published class exists, so the badge is Assigned.
    const btn = assignBtn(mount, "earths-layers");
    expect(assignedState(btn)).toBe("true");
    expect(btn?.textContent).toBe("Reassign");
    // Exactly one draft was rejected; two drafts saved; one publish failed.
    expect(detail.registered).toHaveLength(1); // only the published class
  });
});

// ---------------------------------------------------------------------------
// Sprint 26 Phase 3 (Defect 2.B) - hydration/reload lesson-card semantics.
//
// A hydrated `draft` must not light the "Assigned" badge; a hydrated
// `published` or `closed` assignment must. Draft entries remain available to
// the legitimate View drafts control.
// ---------------------------------------------------------------------------
describe("Assigned badge - status-aware hydration (Defect 2.B)", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  const viewControl = (
    mount: HTMLElement,
    slug: string,
  ): HTMLButtonElement | null =>
    mount.querySelector<HTMLButtonElement>(
      `[data-testid=lesson-view-summary-${slug}]`,
    );

  test("hydrated draft leaves the card unassigned (no Assigned badge)", () => {
    const hydrated: AssignmentDetailMetadata[] = [
      {
        assignmentId: "asn-draft-1",
        title: "Earth's Layers",
        className: "6A · Grade 6",
        status: "draft",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
    ];
    const detail = makeDetailSeam(hydrated);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });

    const btn = assignBtn(mount, "earths-layers");
    expect(btn?.textContent).toBe("Assign");
    expect(assignedState(btn)).toBe("false");
    // Sprint 28.6D: the Curriculum-side per-assignment View drafts opener
    // was retired; a stranded draft never lights the Assigned badge and no
    // view-summary control appears (draft management lives under Classes).
    expect(viewControl(mount, "earths-layers")).toBeNull();
  });

  test("hydrated published lights the Assigned badge", () => {
    const hydrated: AssignmentDetailMetadata[] = [
      {
        assignmentId: "asn-pub-1",
        title: "Earth's Layers",
        className: "6A · Grade 6",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
    ];
    const detail = makeDetailSeam(hydrated);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });

    const btn = assignBtn(mount, "earths-layers");
    expect(assignedState(btn)).toBe("true");
    expect(btn?.textContent).toBe("Reassign");
    expect(assignedState(btn)).toBe("true");
  });

  test("hydrated closed also lights the Assigned badge", () => {
    const hydrated: AssignmentDetailMetadata[] = [
      {
        assignmentId: "asn-closed-1",
        title: "Earth's Layers",
        className: "6A · Grade 6",
        status: "closed",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
    ];
    const detail = makeDetailSeam(hydrated);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });

    const btn = assignBtn(mount, "earths-layers");
    expect(assignedState(btn)).toBe("true");
    expect(btn?.textContent).toBe("Reassign");
    expect(assignedState(btn)).toBe("true");
  });

  test("draft co-registered with a published assignment still lights Assigned (order-independent)", () => {
    // Draft listed first, published second: the published entry must win.
    const hydrated: AssignmentDetailMetadata[] = [
      {
        assignmentId: "asn-draft-2",
        title: "Earth's Layers",
        className: "7B",
        status: "draft",
        lessonSlug: "earths-layers",
        classId: "c2",
      },
      {
        assignmentId: "asn-pub-2",
        title: "Earth's Layers",
        className: "6A",
        status: "published",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
    ];
    const detail = makeDetailSeam(hydrated);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });

    const btn = assignBtn(mount, "earths-layers");
    expect(assignedState(btn)).toBe("true");
    expect(btn?.textContent).toBe("Reassign");
    expect(assignedState(btn)).toBe("true");
  });

  test("a draft-only lesson and a published lesson hydrate to independent card states", () => {
    const hydrated: AssignmentDetailMetadata[] = [
      {
        assignmentId: "asn-draft-3",
        title: "Earth's Layers",
        className: "6A",
        status: "draft",
        lessonSlug: "earths-layers",
        classId: "c1",
      },
      {
        assignmentId: "asn-pub-3",
        title: "What Is Life?",
        className: "7B",
        status: "published",
        lessonSlug: "what-is-life",
        classId: "c2",
      },
    ];
    const detail = makeDetailSeam(hydrated);
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignmentDetail: detail.seam,
    });

    const draftCard = assignBtn(mount, "earths-layers");
    expect(assignedState(draftCard)).toBe("false");
    const publishedCard = assignBtn(mount, "what-is-life");
    expect(assignedState(publishedCard)).toBe("true");
  });
});
