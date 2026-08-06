/**
 * @jest-environment jsdom
 *
 * Sprint 25 Phase 3 - Assign dialog publication integration tests.
 *
 * Exercises the LMS-linked class row through the one Assign dialog: the
 * off-by-default toggle, the per-row attempt nonce on the publish call, the
 * topic behavior, the incremental-consent handoff, reconnect routing,
 * multi-class independence, the confirmation read-back copy, and the
 * privacy boundary. The deep attempt-model unit tests live in
 * shared/lmsPublication.test.ts; these prove the wiring through the surface.
 */
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { ListClasses } from "../../classes/listClasses";
import type {
  AssignmentsCallables,
  IntegrationsCallables,
  IntegrationsClassLink,
  IntegrationsDeps,
  IntegrationsLmsTopic,
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

// One LMS-linked class (c1) and one plain class (c2).
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

const okAssignments = (): {
  seam: AssignmentsCallables;
  drafts: string[];
  publishes: string[];
} => {
  const drafts: string[] = [];
  const publishes: string[] = [];
  return {
    drafts,
    publishes,
    seam: {
      createDraft: async (input) => {
        drafts.push(input.assignmentId);
        return { assignmentId: input.assignmentId, status: "draft", alreadyCreated: false };
      },
      publish: async (input) => {
        publishes.push(input.assignmentId);
        return { assignmentId: input.assignmentId, status: "published", alreadyPublished: false };
      },
    },
  };
};

type PublishInput = {
  assignmentId: string;
  linkId: string;
  lyfelabzAssignmentUrl: string;
  title?: string;
  lmsTopicId?: string;
  attemptNonce?: string;
};

type IntegrationsHarness = {
  deps: IntegrationsDeps;
  publishCalls: PublishInput[];
  beginCalls: number;
  openCalls: number;
};

const makeIntegrations = (opts: {
  links?: ReadonlyArray<IntegrationsClassLink>;
  topics?: ReadonlyArray<IntegrationsLmsTopic>;
  publish?: (input: PublishInput, call: number) => Promise<IntegrationsPublicationOutcome>;
  openOAuthRejects?: boolean;
}): IntegrationsHarness => {
  const publishCalls: PublishInput[] = [];
  const harness: IntegrationsHarness = {
    publishCalls,
    beginCalls: 0,
    openCalls: 0,
    deps: undefined as unknown as IntegrationsDeps,
  };
  const links =
    opts.links ??
    freeze([
      freeze({
        linkId: "link-c1",
        classId: "c1",
        providerId: "google-classroom",
        lmsClassId: "gc-c1",
      }),
    ] as IntegrationsClassLink[]);
  let publishCall = 0;
  const callables = {
    listProviders: async () => [],
    describeConnections: async () => [],
    beginConnection: async () => {
      harness.beginCalls += 1;
      return { authorizationUrl: "https://consent/auth", state: "st-1" };
    },
    completeConnection: async () => ({
      connectionId: "conn-1",
      alreadyConnected: false,
      consentOutcome: "widened" as const,
    }),
    disconnect: async () => ({ alreadyRevoked: false }),
    discoverClasses: async () => [],
    importClass: async () => ({ linkId: "l", classId: "c", lmsClassId: "g", alreadyLinked: false }),
    listClassTopics: async () => opts.topics ?? [],
    refreshClass: async () => ({
      linkId: "l",
      classId: "c",
      lmsClassId: "g",
      providerId: "google-classroom",
      status: "healthy" as const,
      changed: false,
    }),
    publishAssignment: async (input: PublishInput) => {
      publishCalls.push(input);
      publishCall += 1;
      if (opts.publish) return opts.publish(input, publishCall);
      return { publicationId: "pub", status: "succeeded" as const, lmsAssignmentId: "gc-1" };
    },
  } as unknown as IntegrationsCallables;

  harness.deps = {
    callables,
    openOAuth: async () => {
      harness.openCalls += 1;
      if (opts.openOAuthRejects) {
        const err = new Error("cancelled");
        (err as { code?: string }).code = "cancelled";
        throw err;
      }
      return { code: "auth-code", state: "st-1" };
    },
    listTeacherClasses: async () => [],
    redirectUri: "https://app/app/lms-callback.html",
    listClassLinks: async () => links,
  };
  return harness;
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

const banner = (mount: HTMLElement): string =>
  mount.querySelector<HTMLElement>("[data-testid=assign-success]")?.textContent ?? "";

describe("Assign dialog - LMS publication wiring (Sprint 25 Phase 3)", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document
      .querySelectorAll("[data-testid=assign-overlay]")
      .forEach((el) => el.remove());
  });

  test("LMS-linked row shows the topic selector and publish toggle; non-LMS row shows neither", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({ topics: [{ lmsTopicId: "t1", name: "Unit 1" }] });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");

    expect(document.querySelector("[data-testid=assign-row-lms-topic-c1]")).not.toBeNull();
    expect(document.querySelector("[data-testid=assign-row-lms-publish-c1]")).not.toBeNull();
    // Non-LMS class c2 has neither control.
    expect(document.querySelector("[data-testid=assign-row-lms-topic-c2]")).toBeNull();
    expect(document.querySelector("[data-testid=assign-row-lms-publish-c2]")).toBeNull();
  });

  test("publish toggle is off by default: publishAssignment is not called", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({});
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");
    confirm();
    await settle();
    expect(it.publishCalls).toHaveLength(0);
    expect(banner(mount)).not.toMatch(/Google Classroom/);
  });

  test("toggle on: publishAssignment is called with a non-empty attempt nonce after publish", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({});
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");
    // Deselect the non-LMS class so only the linked class is assigned.
    document.querySelector<HTMLInputElement>("[data-testid=assign-row-enabled-c2]")!.click();
    document.querySelector<HTMLInputElement>("[data-testid=assign-row-lms-publish-c1]")!.click();
    confirm();
    await settle();

    expect(asn.drafts.length).toBeGreaterThan(0);
    expect(it.publishCalls).toHaveLength(1);
    const call = it.publishCalls[0]!;
    expect(typeof call.attemptNonce).toBe("string");
    expect(call.attemptNonce!.length).toBeGreaterThan(0);
    expect(call.linkId).toBe("link-c1");
    expect(banner(mount)).toMatch(/Publishing to Google Classroom succeeded\./);
  });

  test("No topic selected: publish omits lmsTopicId; a chosen topic is passed", async () => {
    // Case 1: no topic.
    {
      const asn = okAssignments();
      const it = makeIntegrations({ topics: [{ lmsTopicId: "t1", name: "Unit 1" }] });
      const mount = mkMount();
      renderCurriculumSurface(mount, teacher, {
        listClasses: listTwo,
        assignments: asn.seam,
        integrations: it.deps,
      });
      await openDialogFor(mount, "earths-layers");
      document.querySelector<HTMLInputElement>("[data-testid=assign-row-enabled-c2]")!.click();
      document.querySelector<HTMLInputElement>("[data-testid=assign-row-lms-publish-c1]")!.click();
      confirm();
      await settle();
      expect(it.publishCalls[0]!.lmsTopicId).toBeUndefined();
    }
    _resetCurriculumSessionStateForTest();
    document.querySelectorAll("[data-testid=assign-overlay]").forEach((el) => el.remove());
    // Case 2: chosen topic.
    {
      const asn = okAssignments();
      const it = makeIntegrations({ topics: [{ lmsTopicId: "t1", name: "Unit 1" }] });
      const mount = mkMount();
      renderCurriculumSurface(mount, teacher, {
        listClasses: listTwo,
        assignments: asn.seam,
        integrations: it.deps,
      });
      await openDialogFor(mount, "earths-layers");
      document.querySelector<HTMLInputElement>("[data-testid=assign-row-enabled-c2]")!.click();
      const select = document.querySelector<HTMLSelectElement>(
        "[data-testid=assign-row-lms-topic-c1]",
      )!;
      select.value = "t1";
      select.dispatchEvent(new Event("change"));
      document.querySelector<HTMLInputElement>("[data-testid=assign-row-lms-publish-c1]")!.click();
      confirm();
      await settle();
      expect(it.publishCalls[0]!.lmsTopicId).toBe("t1");
    }
  });

  test("insufficient scope triggers consent and a single re-issue that succeeds", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({
      publish: async (_input, call) =>
        call === 1
          ? { publicationId: "p", status: "failed", errorCode: "lms.insufficientScope" }
          : { publicationId: "p", status: "succeeded", lmsAssignmentId: "gc" },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");
    document.querySelector<HTMLInputElement>("[data-testid=assign-row-enabled-c2]")!.click();
    document.querySelector<HTMLInputElement>("[data-testid=assign-row-lms-publish-c1]")!.click();
    confirm();
    await settle();
    expect(it.beginCalls).toBe(1);
    expect(it.openCalls).toBe(1);
    expect(it.publishCalls).toHaveLength(2);
    expect(banner(mount)).toMatch(/Publishing to Google Classroom succeeded\./);
  });

  test("consent cancelled: assignment scheduled, calm permission line, retry not looped", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({
      openOAuthRejects: true,
      publish: async () => ({
        publicationId: "p",
        status: "failed",
        errorCode: "lms.insufficientScope",
      }),
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");
    document.querySelector<HTMLInputElement>("[data-testid=assign-row-enabled-c2]")!.click();
    document.querySelector<HTMLInputElement>("[data-testid=assign-row-lms-publish-c1]")!.click();
    confirm();
    await settle();
    expect(it.publishCalls).toHaveLength(1); // no automatic re-issue
    expect(banner(mount)).toMatch(/needs your permission/);
    // The LyfeLabz assignment is authoritative regardless.
    expect(banner(mount)).toMatch(/Assigned Earth's Layers/);
  });

  test("inactive connection (thrown) routes to the reconnect line", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({
      publish: async () => {
        const err = new Error("failed-precondition");
        (err as { details?: unknown }).details = { code: "lms.connectionNotActive" };
        throw err;
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");
    document.querySelector<HTMLInputElement>("[data-testid=assign-row-enabled-c2]")!.click();
    document.querySelector<HTMLInputElement>("[data-testid=assign-row-lms-publish-c1]")!.click();
    confirm();
    await settle();
    expect(it.beginCalls).toBe(0); // reconnect is not a consent flow
    expect(banner(mount)).toMatch(/needs to be reconnected in Settings/);
  });

  test("thrown callable failure maps to did-not-succeed without leaking a code", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({
      publish: async () => {
        const err = new Error("deadline-exceeded");
        (err as { code?: string }).code = "deadline-exceeded";
        throw err;
      },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");
    document.querySelector<HTMLInputElement>("[data-testid=assign-row-enabled-c2]")!.click();
    document.querySelector<HTMLInputElement>("[data-testid=assign-row-lms-publish-c1]")!.click();
    confirm();
    await settle();
    expect(banner(mount)).toMatch(/Publishing to Google Classroom did not succeed\./);
  });

  test("multi-class partial success: one LMS row succeeds, another fails, both LyfeLabz assignments stand", async () => {
    const links = freeze([
      freeze({ linkId: "link-c1", classId: "c1", providerId: "google-classroom", lmsClassId: "gc-c1" }),
      freeze({ linkId: "link-c2", classId: "c2", providerId: "google-classroom", lmsClassId: "gc-c2" }),
    ] as IntegrationsClassLink[]);
    const asn = okAssignments();
    const it = makeIntegrations({
      links,
      publish: async (input) =>
        input.linkId === "link-c1"
          ? { publicationId: "p1", status: "succeeded", lmsAssignmentId: "g1" }
          : { publicationId: "p2", status: "failed", errorCode: "lms.upstreamCallFailed" },
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");
    document.querySelector<HTMLInputElement>("[data-testid=assign-row-lms-publish-c1]")!.click();
    document.querySelector<HTMLInputElement>("[data-testid=assign-row-lms-publish-c2]")!.click();
    confirm();
    await settle();
    // Two distinct publish calls, distinct nonces, distinct assignmentIds.
    expect(it.publishCalls).toHaveLength(2);
    const [a, b] = it.publishCalls;
    expect(a!.attemptNonce).not.toBe(b!.attemptNonce);
    expect(a!.assignmentId).not.toBe(b!.assignmentId);
    expect(banner(mount)).toMatch(/succeeded for 1 class and did not succeed for 1/);
    expect(asn.publishes).toHaveLength(2); // both LyfeLabz assignments published
  });

  test("no token, scope string, Google identity, or raw error code reaches the rendered copy", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({
      publish: async () => ({
        publicationId: "p",
        status: "failed",
        errorCode: "lms.upstreamCallFailed",
        errorMessage: "raw upstream 403 token=secret teacher@example.com",
      }),
    });
    const mount = mkMount();
    renderCurriculumSurface(mount, teacher, {
      listClasses: listTwo,
      assignments: asn.seam,
      integrations: it.deps,
    });
    await openDialogFor(mount, "earths-layers");
    document.querySelector<HTMLInputElement>("[data-testid=assign-row-enabled-c2]")!.click();
    document.querySelector<HTMLInputElement>("[data-testid=assign-row-lms-publish-c1]")!.click();
    confirm();
    await settle();
    const text = mount.textContent ?? "";
    expect(text).not.toMatch(/lms\./);
    expect(text).not.toMatch(/token=/);
    expect(text).not.toMatch(/@example\.com/);
    expect(text).not.toMatch(/403/);
  });
});
