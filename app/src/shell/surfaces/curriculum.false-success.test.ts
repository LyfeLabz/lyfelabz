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
    expect(btn?.getAttribute("data-assigned")).toBe("false");

    // Now let publish resolve.
    publishGate.release();
    await flush();
    await flush();
    await flush();

    expect(btn?.textContent).toBe("✓ Assigned");
    expect(btn?.getAttribute("data-assigned")).toBe("true");
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
    expect(btn?.getAttribute("data-assigned")).toBe("false");
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
    expect(btn?.getAttribute("data-assigned")).toBe("false");
    expect(asn.drafts.length).toBeGreaterThan(0);
    expect(detail.registered).toHaveLength(0);
  });

  test("total-failure lifecycle surfaces a clear negative outcome message", async () => {
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
    expect(banner?.textContent ?? "").toMatch(/was not created/);
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
    expect(btn?.textContent).toBe("✓ Assigned");
    expect(btn?.getAttribute("data-assigned")).toBe("true");
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
    expect(btn?.textContent).toBe("✓ Assigned");
    expect(btn?.getAttribute("data-assigned")).toBe("true");
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
    expect(btn?.getAttribute("data-assigned")).toBe("false");
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
    expect(buttons[0]?.textContent).toBe("✓ Assigned");
    expect(buttons[0]?.getAttribute("data-assigned")).toBe("true");
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
    expect(btn?.getAttribute("data-assigned")).toBe("false");
  });
});
