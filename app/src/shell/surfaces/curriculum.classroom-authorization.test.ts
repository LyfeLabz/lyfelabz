/**
 * @jest-environment jsdom
 *
 * Unified onboarding authorization (October 2026 incident follow-up).
 *
 * A teacher whose Google Classroom connection carried only the read-only
 * roster permissions saw an apparently empty topic list, and four
 * assignments were created in LyfeLabz but never reached Classroom: the
 * publish-time consent window opened only after several network round
 * trips, outside the click, where popup blockers stop it.
 *
 * These tests prove the Assign dialog now:
 *   - tells the teacher up front when Classroom access is missing, and asks
 *     for it from a direct click;
 *   - never shows a permission, reconnect, or network failure as "No topic";
 *   - creates nothing for a Classroom-linked class until access is granted;
 *   - leaves teachers who already have access, or whose server predates the
 *     flag, completely uninterrupted.
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


type Harness = {
  deps: IntegrationsDeps;
  publishCalls: Array<{ assignmentId: string; attemptNonce?: string; lmsTopicId?: string }>;
  beginInputs: Array<Record<string, unknown>>;
  openCalls: number;
  completeCalls: number;
  topicCalls: number;
};

type TopicBehavior =
  | { kind: "ok"; topics: ReadonlyArray<IntegrationsLmsTopic> }
  | { kind: "reject"; code?: string; firebaseCode?: string };

const callableError = (lmsCode: string | undefined, firebaseCode = "functions/failed-precondition"): Error => {
  const err = new Error(firebaseCode);
  (err as { code?: string }).code = firebaseCode;
  if (lmsCode !== undefined) (err as { details?: unknown }).details = { code: lmsCode };
  return err;
};

const makeIntegrations = (opts: {
  publicationAuthorized?: boolean;
  // Topic behavior before and after a granted authorization.
  topicsBefore?: TopicBehavior;
  topicsAfter?: TopicBehavior;
  openOAuthErrorCode?: string;
  completeGrants?: boolean;
  publish?: () => Promise<IntegrationsPublicationOutcome>;
  links?: ReadonlyArray<IntegrationsClassLink>;
}): Harness => {
  let authorized = opts.publicationAuthorized;
  const harness: Harness = {
    deps: undefined as unknown as IntegrationsDeps,
    publishCalls: [],
    beginInputs: [],
    openCalls: 0,
    completeCalls: 0,
    topicCalls: 0,
  };
  const links =
    opts.links ??
    freeze([
      freeze({
        linkId: "link-c1",
        classId: "c1",
        providerId: "googleClassroom",
        lmsClassId: "gc-c1",
      }),
    ] as IntegrationsClassLink[]);
  const callables = {
    listProviders: async () => [],
    describeConnections: async () => [
      {
        connectionId: "conn-1",
        providerId: "googleClassroom",
        status: "active" as const,
        scopes: [],
        ...(authorized !== undefined ? { publicationAuthorized: authorized } : {}),
      },
    ],
    beginConnection: async (input: Record<string, unknown>) => {
      harness.beginInputs.push(input);
      return { authorizationUrl: "https://consent/auth", state: "st-1" };
    },
    completeConnection: async () => {
      harness.completeCalls += 1;
      const granted = opts.completeGrants ?? true;
      if (granted) authorized = true;
      return {
        connectionId: "conn-1",
        alreadyConnected: true,
        consentOutcome: granted ? ("widened" as const) : ("alreadyAuthorized" as const),
        publicationAuthorized: granted,
      };
    },
    disconnect: async () => ({ alreadyRevoked: false }),
    discoverClasses: async () => [],
    importClass: async () => ({ linkId: "l", classId: "c", lmsClassId: "g", alreadyLinked: false }),
    listClassTopics: async () => {
      harness.topicCalls += 1;
      const behavior =
        authorized === true && opts.topicsAfter !== undefined
          ? opts.topicsAfter
          : (opts.topicsBefore ?? { kind: "ok", topics: [] });
      if (behavior.kind === "ok") return behavior.topics;
      throw callableError(behavior.code, behavior.firebaseCode);
    },
    refreshClass: async () => {
      throw new Error("unused");
    },
    publishAssignment: async (input: { assignmentId: string; attemptNonce?: string; lmsTopicId?: string }) => {
      harness.publishCalls.push(input);
      if (opts.publish) return opts.publish();
      return { publicationId: "pub", status: "succeeded" as const, lmsAssignmentId: "gc-1" };
    },
  } as unknown as IntegrationsCallables;
  harness.deps = {
    callables,
    openOAuth: async () => {
      harness.openCalls += 1;
      if (opts.openOAuthErrorCode !== undefined) {
        const err = new Error(opts.openOAuthErrorCode);
        (err as { code?: string }).code = opts.openOAuthErrorCode;
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

const $ = <T extends HTMLElement>(testid: string): T | null =>
  document.querySelector<T>(`[data-testid=${testid}]`);

const open = async (
  it: Harness,
  asn: ReturnType<typeof okAssignments>,
): Promise<HTMLElement> => {
  const mount = mkMount();
  renderCurriculumSurface(mount, teacher, {
    listClasses: listTwo,
    assignments: asn.seam,
    integrations: it.deps,
  });
  mount
    .querySelector<HTMLButtonElement>("[data-testid=lesson-assign-earths-layers]")
    ?.click();
  await settle();
  return mount;
};

const notice = (): HTMLElement => $("assign-classroom-access")!;
const noticeText = (): string => $("assign-classroom-access-message")?.textContent ?? "";
const topicSelect = (): HTMLSelectElement => $<HTMLSelectElement>("assign-row-lms-topic-c1")!;
const selectedTopicText = (): string => {
  const s = topicSelect();
  return s.options[s.selectedIndex]?.textContent ?? "";
};

describe("Assign dialog - unified Google Classroom authorization", () => {
  beforeEach(() => {
    _resetCurriculumSessionStateForTest();
    document.querySelectorAll("[data-testid=assign-overlay]").forEach((el) => el.remove());
  });

  test("existing teacher with complete permissions: no notice, no Google window, publishes once", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({
      publicationAuthorized: true,
      topicsBefore: { kind: "ok", topics: [{ lmsTopicId: "t1", name: "Carbon Cycle" }] },
    });
    await open(it, asn);
    expect(notice().hidden).toBe(true);
    expect(topicSelect().getAttribute("data-topic-state")).toBe("loaded");
    $<HTMLButtonElement>("assign-confirm")!.click();
    await settle();
    expect(it.openCalls).toBe(0);
    expect(it.beginInputs).toHaveLength(0);
    expect(it.publishCalls).toHaveLength(1);
  });

  test("roster-only connection: notice is shown and topics say they need access instead of 'No topic'", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({
      publicationAuthorized: false,
      topicsBefore: { kind: "reject", code: "lms.insufficientScope" },
    });
    await open(it, asn);
    expect(notice().hidden).toBe(false);
    expect(notice().getAttribute("data-access-state")).toBe("needed");
    expect(noticeText()).toMatch(/needs your permission/);
    expect($("assign-classroom-access-allow")!.hidden).toBe(false);
    expect(topicSelect().getAttribute("data-topic-state")).toBe("permission");
    expect(selectedTopicText()).toBe("Needs Classroom access");
    expect(selectedTopicText()).not.toBe("No topic");
    // Nothing was requested from Google just by opening the dialog.
    expect(it.openCalls).toBe(0);
  });

  test("Allow access from the notice upgrades once, then loads the real topics", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({
      publicationAuthorized: false,
      topicsBefore: { kind: "reject", code: "lms.insufficientScope" },
      topicsAfter: { kind: "ok", topics: [{ lmsTopicId: "t9", name: "Carbon Cycle" }] },
    });
    await open(it, asn);
    $<HTMLButtonElement>("assign-classroom-access-allow")!.click();
    await settle();
    expect(it.beginInputs).toEqual([
      expect.objectContaining({ capability: "publication", providerId: "googleClassroom" }),
    ]);
    expect(it.openCalls).toBe(1);
    expect(notice().getAttribute("data-access-state")).toBe("granted");
    expect($("assign-classroom-access-allow")!.hidden).toBe(true);
    expect(topicSelect().getAttribute("data-topic-state")).toBe("loaded");
    expect(Array.from(topicSelect().options).map((o) => o.textContent)).toEqual([
      "No topic",
      "Carbon Cycle",
    ]);
    // Nothing was created by authorizing.
    expect(asn.drafts).toHaveLength(0);
    // Confirming now publishes without any further Google window.
    $<HTMLButtonElement>("assign-confirm")!.click();
    await settle();
    expect(it.openCalls).toBe(1);
    expect(it.publishCalls).toHaveLength(1);
  });

  test("confirming with access missing asks first, then creates and publishes exactly once", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({
      publicationAuthorized: false,
      topicsBefore: { kind: "reject", code: "lms.insufficientScope" },
    });
    await open(it, asn);
    $<HTMLInputElement>("assign-row-enabled-c2")!.click();
    const confirmBtn = $<HTMLButtonElement>("assign-confirm")!;
    confirmBtn.click();
    // A second click while Google is open must not start a second request.
    confirmBtn.click();
    await settle();
    expect(it.beginInputs).toHaveLength(1);
    expect(it.openCalls).toBe(1);
    expect(asn.drafts).toHaveLength(1);
    expect(it.publishCalls).toHaveLength(1);
    expect($("assign-overlay")).toBeNull();
  });

  test.each([
    [
      "declined (permissions left unchecked)",
      { completeGrants: false },
      "declined",
      /not fully approved/,
    ],
    [
      "declined on Google's screen",
      { openOAuthErrorCode: "access_denied" },
      "declined",
      /not fully approved/,
    ],
    ["popup blocked", { openOAuthErrorCode: "popup-blocked" }, "popupBlocked", /blocked the Google window/],
    ["window closed", { openOAuthErrorCode: "cancelled" }, "cancelled", /closed before access was approved/],
  ] as const)(
    "%s: nothing is created, the dialog stays open with specific guidance",
    async (_label, extra, state, message) => {
      const asn = okAssignments();
      const it = makeIntegrations({
        publicationAuthorized: false,
        topicsBefore: { kind: "reject", code: "lms.insufficientScope" },
        ...extra,
      });
      await open(it, asn);
      $<HTMLButtonElement>("assign-confirm")!.click();
      await settle();
      expect(asn.drafts).toHaveLength(0);
      expect(asn.publishes).toHaveLength(0);
      expect(it.publishCalls).toHaveLength(0);
      expect($("assign-overlay")).not.toBeNull();
      expect(notice().getAttribute("data-access-state")).toBe(state);
      expect(noticeText()).toMatch(message);
      expect($("assign-classroom-access-allow")!.hidden).toBe(false);
      // No raw technical vocabulary reaches the teacher.
      expect(noticeText()).not.toMatch(/scope|oauth|403|lms\.|token/i);
    },
  );

  test("deselecting the Classroom-linked class lets the teacher assign without Google", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({
      publicationAuthorized: false,
      topicsBefore: { kind: "reject", code: "lms.insufficientScope" },
    });
    await open(it, asn);
    $<HTMLInputElement>("assign-row-enabled-c1")!.click();
    $<HTMLButtonElement>("assign-confirm")!.click();
    await settle();
    expect(it.openCalls).toBe(0);
    expect(asn.drafts).toHaveLength(1);
    expect(it.publishCalls).toHaveLength(0);
  });

  test("a network failure loading topics is distinct from a permission failure and from an empty list", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({
      publicationAuthorized: true,
      topicsBefore: { kind: "reject", firebaseCode: "functions/unavailable" },
    });
    await open(it, asn);
    expect(topicSelect().getAttribute("data-topic-state")).toBe("unavailable");
    expect(selectedTopicText()).toBe("Topics did not load");
    expect(notice().hidden).toBe(true);
  });

  test("a connection that needs reconnecting says so in the topic selector", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({
      publicationAuthorized: true,
      topicsBefore: { kind: "reject", code: "lms.reconnectRequired" },
    });
    await open(it, asn);
    expect(topicSelect().getAttribute("data-topic-state")).toBe("reconnect");
    expect(selectedTopicText()).toBe("Reconnect to see topics");
  });

  test("a class with genuinely no topics still shows 'No topic' and is marked empty", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({
      publicationAuthorized: true,
      topicsBefore: { kind: "ok", topics: [] },
    });
    await open(it, asn);
    expect(topicSelect().getAttribute("data-topic-state")).toBe("empty");
    expect(selectedTopicText()).toBe("No topic");
    expect(Array.from(topicSelect().options).map((o) => o.textContent)).toEqual(["No topic"]);
  });

  test("unknown authorization (server predates the flag) keeps the earlier publish-time consent fallback", async () => {
    const asn = okAssignments();
    let call = 0;
    const it = makeIntegrations({
      publicationAuthorized: undefined,
      publish: async () => {
        call += 1;
        return call === 1
          ? {
              publicationId: "pub",
              status: "failed" as const,
              errorCode: "lms.insufficientScope",
            }
          : { publicationId: "pub", status: "succeeded" as const, lmsAssignmentId: "gc-1" };
      },
    });
    await open(it, asn);
    expect(notice().hidden).toBe(true);
    $<HTMLInputElement>("assign-row-enabled-c2")!.click();
    $<HTMLButtonElement>("assign-confirm")!.click();
    await settle();
    expect(asn.drafts).toHaveLength(1);
    expect(it.openCalls).toBe(1);
    expect(it.publishCalls).toHaveLength(2);
    // The re-issue reuses the same attempt nonce (server-side duplicate guard).
    expect(it.publishCalls[0]!.attemptNonce).toBe(it.publishCalls[1]!.attemptNonce);
  });

  test("a failed Classroom publish is reported, never as published", async () => {
    const asn = okAssignments();
    const it = makeIntegrations({
      publicationAuthorized: true,
      publish: async () => ({
        publicationId: "pub",
        status: "failed" as const,
        errorCode: "lms.upstreamCallFailed",
      }),
    });
    const mount = await open(it, asn);
    $<HTMLInputElement>("assign-row-enabled-c2")!.click();
    $<HTMLButtonElement>("assign-confirm")!.click();
    await settle();
    const text =
      mount.querySelector<HTMLElement>("[data-testid=assign-success]")?.textContent ?? "";
    expect(text).not.toMatch(/Publishing to Google Classroom succeeded/);
    expect(text).toMatch(/Google Classroom/);
  });

  describe("authorization window reservation (PDR-030i)", () => {
    const withReserver = (it: Harness) => {
      const order: string[] = [];
      const reservation = { popup: {} as Window, close: jest.fn(() => order.push("close")) };
      const begin = it.deps.callables.beginConnection;
      const openOAuth = it.deps.openOAuth;
      const handed: unknown[] = [];
      it.deps = {
        ...it.deps,
        reserveOAuthWindow: () => {
          order.push("reserve");
          return reservation;
        },
        openOAuth: async (input) => {
          handed.push(input.reservation);
          return openOAuth(input);
        },
        callables: {
          ...it.deps.callables,
          beginConnection: async (input) => {
            order.push("begin");
            return begin(input);
          },
        },
      };
      return { order, reservation, handed };
    };

    test("Allow access reserves synchronously from the click, before the server request", async () => {
      const asn = okAssignments();
      const it = makeIntegrations({
        publicationAuthorized: false,
        topicsBefore: { kind: "reject", code: "lms.insufficientScope" },
      });
      const r = withReserver(it);
      await open(it, asn);
      $<HTMLButtonElement>("assign-classroom-access-allow")!.click();
      expect(r.order).toEqual(["reserve", "begin"]);
      await settle();
      expect(r.handed[0]).toBe(r.reservation);
      expect(notice().getAttribute("data-access-state")).toBe("granted");
    });

    test("Assign with access missing reserves synchronously from the click", async () => {
      const asn = okAssignments();
      const it = makeIntegrations({
        publicationAuthorized: false,
        topicsBefore: { kind: "reject", code: "lms.insufficientScope" },
      });
      const r = withReserver(it);
      await open(it, asn);
      $<HTMLButtonElement>("assign-confirm")!.click();
      expect(r.order).toEqual(["reserve", "begin"]);
      await settle();
      expect(it.publishCalls).toHaveLength(1);
    });

    test("an already-authorized teacher never gets a reserved window", async () => {
      const asn = okAssignments();
      const it = makeIntegrations({ publicationAuthorized: true });
      const r = withReserver(it);
      await open(it, asn);
      $<HTMLButtonElement>("assign-confirm")!.click();
      await settle();
      expect(r.order).toEqual([]);
      expect(it.publishCalls).toHaveLength(1);
    });

    test("a failed server request releases the reserved window and creates nothing", async () => {
      const asn = okAssignments();
      const it = makeIntegrations({
        publicationAuthorized: false,
        topicsBefore: { kind: "reject", code: "lms.insufficientScope" },
      });
      const r = withReserver(it);
      it.deps = {
        ...it.deps,
        callables: {
          ...it.deps.callables,
          beginConnection: async () => {
            r.order.push("begin");
            throw callableError(undefined, "functions/unavailable");
          },
        },
      };
      await open(it, asn);
      $<HTMLButtonElement>("assign-confirm")!.click();
      await settle();
      expect(r.order).toEqual(["reserve", "begin", "close"]);
      expect(asn.drafts).toHaveLength(0);
      expect(notice().getAttribute("data-access-state")).toBe("failed");
    });
  });

  describe("explicit LyfeLabz-only choice (PDR-030i)", () => {
    const three: ReadonlyArray<ClassSummary> = freeze([
      freeze({ id: "c1", title: "6A", grade: "6", status: "active" }),
      freeze({ id: "c2", title: "7B", grade: "7", status: "active" }),
      freeze({ id: "c3", title: "7C", grade: "7", status: "active" }),
    ] as ClassSummary[]);
    const twoLinks = freeze([
      freeze({ linkId: "link-c1", classId: "c1", providerId: "googleClassroom", lmsClassId: "gc-c1" }),
      freeze({ linkId: "link-c2", classId: "c2", providerId: "googleClassroom", lmsClassId: "gc-c2" }),
    ] as IntegrationsClassLink[]);

    const openWith = async (
      it: Harness,
      classes: ReadonlyArray<ClassSummary> = twoClassesForChoice,
    ) => {
      const asn = okAssignments();
      const draftInputs: Array<{ classId: string; availableAt?: string }> = [];
      const createDraft = asn.seam.createDraft;
      const seam: AssignmentsCallables = {
        ...asn.seam,
        createDraft: async (input) => {
          draftInputs.push(input as unknown as { classId: string; availableAt?: string });
          return createDraft(input);
        },
      };
      const mount = mkMount();
      renderCurriculumSurface(mount, teacher, {
        listClasses: () => Promise.resolve(classes),
        assignments: seam,
        integrations: it.deps,
      });
      mount
        .querySelector<HTMLButtonElement>("[data-testid=lesson-assign-earths-layers]")
        ?.click();
      await settle();
      return { asn, mount, draftInputs };
    };
    const twoClassesForChoice = twoClasses;
    const bannerText = (mount: HTMLElement): string =>
      mount.querySelector<HTMLElement>("[data-testid=assign-success]")?.textContent ?? "";
    const missing = (extra: Parameters<typeof makeIntegrations>[0] = {}) =>
      makeIntegrations({
        publicationAuthorized: false,
        topicsBefore: { kind: "reject", code: "lms.insufficientScope" },
        ...extra,
      });

    test("the three choices are offered while access is missing, with a clear explanation", async () => {
      const it = missing();
      await openWith(it);
      expect($("assign-classroom-access-allow")!.hidden).toBe(false);
      expect($("assign-classroom-access-lyfelabz-only")!.hidden).toBe(false);
      expect($("assign-classroom-access-cancel")!.hidden).toBe(false);
      expect($("assign-classroom-access-lyfelabz-only-note")!.textContent).toMatch(
        /will not appear in Google Classroom/,
      );
    });

    test("permission granted: normal Classroom publishing, and the alternative disappears", async () => {
      const it = missing();
      const { asn } = await openWith(it);
      $<HTMLButtonElement>("assign-confirm")!.click();
      await settle();
      expect(asn.drafts).toHaveLength(2);
      expect(it.publishCalls).toHaveLength(1);
    });

    test("permission declined: nothing is created until the teacher chooses", async () => {
      const it = missing({ completeGrants: false });
      const { asn } = await openWith(it);
      $<HTMLButtonElement>("assign-confirm")!.click();
      await settle();
      expect(asn.drafts).toHaveLength(0);
      expect(notice().getAttribute("data-access-state")).toBe("declined");
      expect($("assign-classroom-access-lyfelabz-only")!.hidden).toBe(false);
    });

    test("declined, then LyfeLabz only: assigns every class with no Classroom call and says so", async () => {
      const it = missing({ completeGrants: false });
      const { asn, mount } = await openWith(it);
      $<HTMLButtonElement>("assign-confirm")!.click();
      await settle();
      const beginsBefore = it.beginInputs.length;
      $<HTMLButtonElement>("assign-classroom-access-lyfelabz-only")!.click();
      await settle();
      expect(asn.drafts).toHaveLength(2);
      expect(asn.publishes).toHaveLength(2);
      expect(it.publishCalls).toHaveLength(0);
      expect(it.beginInputs).toHaveLength(beginsBefore);
      expect($("assign-overlay")).toBeNull();
      const text = bannerText(mount);
      expect(text).toMatch(/Assigned in LyfeLabz only for 1 Google Classroom class\. It will not appear in Google Classroom\./);
      expect(text).not.toMatch(/Publishing to Google Classroom succeeded/);
      expect(text).not.toMatch(/needs your permission/);
    });

    test("LyfeLabz only can be chosen up front: no Google window, no Classroom call", async () => {
      const it = missing();
      const { asn } = await openWith(it);
      $<HTMLButtonElement>("assign-classroom-access-lyfelabz-only")!.click();
      await settle();
      expect(it.openCalls).toBe(0);
      expect(it.beginInputs).toHaveLength(0);
      expect(it.publishCalls).toHaveLength(0);
      expect(asn.drafts).toHaveLength(2);
    });

    test("Cancel closes the dialog and creates nothing", async () => {
      const it = missing({ completeGrants: false });
      const { asn } = await openWith(it);
      $<HTMLButtonElement>("assign-confirm")!.click();
      await settle();
      $<HTMLButtonElement>("assign-classroom-access-cancel")!.click();
      await settle();
      expect($("assign-overlay")).toBeNull();
      expect(asn.drafts).toHaveLength(0);
      expect(it.publishCalls).toHaveLength(0);
    });

    test("mixed selection: LyfeLabz only applies to every linked class in the action, never a subset", async () => {
      const it = missing({ links: twoLinks });
      const { asn, mount } = await openWith(it, three);
      $<HTMLButtonElement>("assign-classroom-access-lyfelabz-only")!.click();
      await settle();
      expect(asn.drafts).toHaveLength(3);
      expect(it.publishCalls).toHaveLength(0);
      expect(bannerText(mount)).toMatch(/Assigned in LyfeLabz only for 2 Google Classroom classes\. They will not appear in Google Classroom\./);
    });

    test("mixed selection with access granted: every linked class publishes", async () => {
      const it = missing({ links: twoLinks });
      const { asn } = await openWith(it, three);
      $<HTMLButtonElement>("assign-confirm")!.click();
      await settle();
      expect(asn.drafts).toHaveLength(3);
      expect(it.publishCalls.map((c) => (c as { linkId?: string }).linkId).sort()).toEqual([
        "link-c1",
        "link-c2",
      ]);
    });

    test("scheduled class keeps its schedule when assigned in LyfeLabz only", async () => {
      const it = missing();
      const { draftInputs } = await openWith(it);
      const d = new Date();
      d.setDate(d.getDate() + 3);
      const pad = (n: number): string => String(n).padStart(2, "0");
      const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      $<HTMLInputElement>("assign-row-timing-scheduled-c1")!.click();
      for (const [id, value] of [
        ["assign-row-date-c1", date],
        ["assign-row-time-c1", "08:30"],
      ] as const) {
        const el = $<HTMLInputElement>(id)!;
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      $<HTMLButtonElement>("assign-classroom-access-lyfelabz-only")!.click();
      await settle();
      const c1 = draftInputs.find((x) => x.classId === "c1");
      expect(c1?.availableAt).toBe(new Date(`${date}T08:30`).toISOString());
      const c2 = draftInputs.find((x) => x.classId === "c2");
      expect(c2).not.toHaveProperty("availableAt");
      expect(it.publishCalls).toHaveLength(0);
    });

    test("complete access: no choice is shown and publishing is unchanged", async () => {
      const it = makeIntegrations({ publicationAuthorized: true });
      await openWith(it);
      expect(notice().hidden).toBe(true);
    });
  });
});
