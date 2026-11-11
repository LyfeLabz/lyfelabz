/** Production session boundary and real Assign/cache paths; no test reset seam. */
import { readFileSync } from "fs";
import { getSurfaceableLessons } from "../../curriculum/curriculumManifest";
import { resolve } from "path";
import type { Session } from "../../session/types";
import type { ClassSummary } from "../../classes/types";
import type { IntegrationsDeps, IntegrationsClassLink, IntegrationsLmsTopic } from "../../settings/integrations/types";
import type { AssignmentsCallables, AssignmentsLifecycleStateOutput } from "../../settings/integrations/types";
import {
  renderCurriculumSurface,
  openLessonAssignDialog,
  invalidateCurriculumSession,
  invalidateCurriculumClassCache,
  _resetCurriculumSessionStateForTest,
  type CurriculumSurfaceDeps,
} from "./curriculum";
import {
  invalidateLmsPublicationSession,
  lmsPublicationSessionScope,
  readConnectionReconnectNeeded,
  readLmsPublicationRetryContext,
} from "./shared/lmsPublication";

type Teacher = Extract<Session, { kind: "activeTeacher" }>;
const teacher = (uid = "A", schoolId = "school"): Teacher => ({ kind: "activeTeacher", uid, schoolId, displayName: uid });
const cls = (id = "c1", title = id): ClassSummary => ({ id, title, grade: "6", status: "active", isLmsLinked: true });
const link = (providerId = "google-classroom"): IntegrationsClassLink => ({ classId: "c1", linkId: "same-link", providerId, lmsClassId: "gc1" });
const topics = (name: string): ReadonlyArray<IntegrationsLmsTopic> => [{ lmsTopicId: name, name }];
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
};
const settle = async (): Promise<void> => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); };
const get = <T extends HTMLElement = HTMLElement>(id: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`Missing ${id}`);
  return el;
};
const start = (session: Teacher, deps: CurriculumSurfaceDeps): HTMLElement => {
  const mount = document.createElement("div");
  document.body.append(mount);
  renderCurriculumSurface(mount, session, deps);
  return mount;
};
const open = async (mount: HTMLElement, slug = "earths-layers"): Promise<void> => {
  get<HTMLButtonElement>(`lesson-assign-${slug}`, mount).click();
  await settle();
};
const cancel = (): void => get<HTMLButtonElement>("assign-cancel").click();
const input = (id: string, value: string): void => {
  const el = get<HTMLInputElement>(id); el.value = value; el.dispatchEvent(new Event("input", { bubbles: true }));
};
const integrations = (readTopics = jest.fn().mockResolvedValue(topics("Unit A")), readLinks = jest.fn().mockResolvedValue([link()])): IntegrationsDeps => ({
  listClassLinks: readLinks,
  callables: { listClassTopics: readTopics, describeConnections: jest.fn().mockResolvedValue([]) },
} as unknown as IntegrationsDeps);
const lifecycle = () => ({ state: "neverAssigned" as const, candidates: [], currentAssignmentId: null, currentAssignmentResolution: "unresolved" as const });
const assignments = (read = jest.fn().mockResolvedValue(lifecycle())): AssignmentsCallables => ({ lifecycleState: read } as unknown as AssignmentsCallables);

beforeEach(() => { invalidateCurriculumSession(); document.body.innerHTML = ""; });
afterEach(() => { invalidateCurriculumSession(); document.body.innerHTML = ""; });

test("entry point revokes Curriculum at bootstrap start, before waits, for every session kind", () => {
  const source = readFileSync(resolve(__dirname, "../../index.ts"), "utf8");
  const rerun = source.slice(source.indexOf("const rerun = async"));
  expect(rerun.indexOf("invalidateCurriculumSession();")).toBeGreaterThan(rerun.indexOf("++currentRunToken"));
  expect(rerun.indexOf("invalidateCurriculumSession();")).toBeLessThan(rerun.indexOf("await "));
});

test("sign-out closes old Assign and B cannot inherit A's grading, due date, scheduling or topic preference", async () => {
  const deps = { listClasses: jest.fn().mockResolvedValue([cls()]), integrations: integrations() };
  const a = start(teacher(), deps);
  await open(a);
  get<HTMLInputElement>("assign-shared-grading-graded").click();
  input("assign-shared-points", "37");
  input("assign-shared-due-date", "2099-03-12");
  get<HTMLInputElement>("assign-row-timing-scheduled-c1").click();
  input("assign-row-date-c1", "2099-03-11");
  input("assign-row-time-c1", "14:35");
  const topic = get<HTMLSelectElement>("assign-row-lms-topic-c1");
  topic.value = "Unit A"; topic.dispatchEvent(new Event("change"));
  get<HTMLButtonElement>("assign-confirm").click();
  await open(a);
  expect(get<HTMLInputElement>("assign-shared-points").value).toBe("37");
  expect(get<HTMLSelectElement>("assign-row-lms-topic-c1").value).toBe("Unit A");
  const obsoleteConfirm = get<HTMLButtonElement>("assign-confirm");
  invalidateCurriculumSession(); // real bootstrap/sign-out boundary
  expect(document.querySelector('[data-testid="assign-overlay"]')).toBeNull();
  const b = start(teacher("B"), deps);
  await open(b);
  obsoleteConfirm.click(); // detached old handlers cannot write B's settings
  expect(get<HTMLInputElement>("assign-shared-grading-ungraded").checked).toBe(true);
  expect(get<HTMLInputElement>("assign-shared-points").value).not.toBe("37");
  expect(get<HTMLInputElement>("assign-shared-due-date").value).toBe("");
  expect(get<HTMLInputElement>("assign-row-timing-now-c1").checked).toBe(true);
  expect(get<HTMLInputElement>("assign-row-time-c1").value).not.toBe("14:35");
  expect(get<HTMLSelectElement>("assign-row-lms-topic-c1").value).toBe("");
  expect(deps.listClasses).toHaveBeenCalledTimes(2);
});

test.each(["account", "school", "rebootstrap"])("%s boundary drops class, link, topic and lifecycle rows", async (transition) => {
  const readTopics = jest.fn().mockResolvedValue(topics("A private topic"));
  const readLinks = jest.fn().mockResolvedValue([link()]);
  const readLifecycle = jest.fn().mockResolvedValue(lifecycle());
  const deps = { listClasses: jest.fn().mockResolvedValue([cls()]), integrations: integrations(readTopics, readLinks), assignments: assignments(readLifecycle) };
  const a = start(teacher(), deps); await open(a); cancel();
  if (transition === "rebootstrap") invalidateCurriculumSession();
  readTopics.mockResolvedValue(topics("B topic"));
  const b = start(teacher(transition === "account" ? "B" : "A", transition === "school" ? "other" : "school"), deps);
  await open(b);
  expect(get("assign-dialog").textContent).not.toContain("A private topic");
  expect(get("assign-dialog").textContent).toContain("B topic");
  for (const read of [deps.listClasses, readLinks, readTopics, readLifecycle]) expect(read).toHaveBeenCalledTimes(2);
});

test("teacher-to-student bootstrap revokes teacher state even without another Curriculum render", async () => {
  const deps = { listClasses: jest.fn().mockResolvedValue([cls()]) };
  const a = start(teacher(), deps); await open(a);
  invalidateCurriculumSession(); // rerun runs this before resolving activeStudent
  expect(document.querySelector('[data-testid="assign-overlay"]')).toBeNull();
  await open(a); // obsolete teacher surface cannot reopen a dialog
  expect(document.querySelector('[data-testid="assign-overlay"]')).toBeNull();
  const next = start(teacher(), deps); await open(next);
  expect(deps.listClasses).toHaveBeenCalledTimes(2);
});

test.each(["resolve", "reject"] as const)("late A class/link %s cannot clear B's pending ownership or populate B", async (outcome) => {
  const aClasses = deferred<ReadonlyArray<ClassSummary>>();
  const bClasses = deferred<ReadonlyArray<ClassSummary>>();
  const aLinks = deferred<ReadonlyArray<IntegrationsClassLink>>();
  const bLinks = deferred<ReadonlyArray<IntegrationsClassLink>>();
  const a = start(teacher(), { listClasses: () => aClasses.promise, integrations: integrations(undefined, jest.fn(() => aLinks.promise)) });
  await open(a);
  const oldOverlay = get("assign-overlay");
  invalidateCurriculumSession();
  const readB = jest.fn(() => bClasses.promise); const readBLinks = jest.fn(() => bLinks.promise);
  const b = start(teacher("B"), { listClasses: readB, integrations: integrations(undefined, readBLinks) });
  if (outcome === "resolve") { aClasses.resolve([cls("a", "A private class")]); aLinks.resolve([link()]); }
  else { aClasses.reject(new Error("old failure")); aLinks.reject(new Error("old failure")); }
  await settle();
  await open(b);
  expect(readB).toHaveBeenCalledTimes(1); expect(readBLinks).toHaveBeenCalledTimes(1);
  expect(oldOverlay.isConnected).toBe(false);
  expect(oldOverlay.querySelector('[data-testid="assign-row-a"]')).toBeNull();
  bClasses.resolve([cls("b", "B class")]); bLinks.resolve([]); await settle();
  expect(get("assign-dialog").textContent).toContain("B class");
  expect(get("assign-dialog").textContent).not.toContain("A private class");
});

test.each(["resolve", "reject"] as const)("late A topic %s cannot overwrite B, clear B's request, or update old dialog", async (outcome) => {
  const old = deferred<ReadonlyArray<IntegrationsLmsTopic>>(); const fresh = deferred<ReadonlyArray<IntegrationsLmsTopic>>();
  const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), integrations: integrations(jest.fn(() => old.promise)) });
  await open(a); const oldSelect = get<HTMLSelectElement>("assign-row-lms-topic-c1");
  invalidateCurriculumSession();
  const read = jest.fn(() => fresh.promise);
  const deps = { listClasses: jest.fn().mockResolvedValue([cls()]), integrations: integrations(read) };
  const b = start(teacher("B"), deps); await open(b);
  if (outcome === "resolve") old.resolve(topics("A private topic")); else old.reject(new Error("permission"));
  await settle();
  expect(oldSelect.getAttribute("data-topic-state")).toBe("loading");
  cancel(); await open(b); expect(read).toHaveBeenCalledTimes(1);
  fresh.resolve(topics("B topic")); await settle();
  expect(get("assign-row-lms-topic-c1").textContent).toContain("B topic");
  expect(get("assign-row-lms-topic-c1").textContent).not.toContain("A private topic");
  cancel(); await open(b); expect(read).toHaveBeenCalledTimes(1);
});

test("late lifecycle response cannot seed B's cache or update A's dialog", async () => {
  const old = deferred<AssignmentsLifecycleStateOutput>();
  const depsA = { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: assignments(jest.fn(() => old.promise)) };
  const a = start(teacher(), depsA); await open(a); const oldDialog = get("assign-dialog");
  invalidateCurriculumSession();
  const readB = jest.fn().mockResolvedValue(lifecycle());
  const b = start(teacher("B"), { listClasses: depsA.listClasses, assignments: assignments(readB) });
  await open(b); cancel();
  old.resolve({ ...lifecycle(), state: "onePublishedFullyCurrent" }); await settle();
  await open(b);
  expect(readB).toHaveBeenCalledTimes(1);
  expect(oldDialog.querySelector('[data-testid="assign-row-c1"]')).toBeNull();
  expect(get<HTMLInputElement>("assign-row-enabled-c1").disabled).toBe(false);
});

test("same valid session reuses caches across navigation; class mutation refreshes rows and lifecycle but retains topics", async () => {
  const readTopics = jest.fn().mockResolvedValue(topics("Unit A")); const readLinks = jest.fn().mockResolvedValue([link()]);
  const readLifecycle = jest.fn().mockResolvedValue(lifecycle());
  const deps = { listClasses: jest.fn().mockResolvedValue([cls()]), integrations: integrations(readTopics, readLinks), assignments: assignments(readLifecycle) };
  const a = start(teacher(), deps); await open(a); cancel(); a.remove();
  const next = start(teacher(), deps); await open(next); cancel();
  for (const read of [deps.listClasses, readLinks, readTopics, readLifecycle]) expect(read).toHaveBeenCalledTimes(1);
  invalidateCurriculumClassCache(); await open(next);
  for (const read of [deps.listClasses, readLinks, readLifecycle]) expect(read).toHaveBeenCalledTimes(2);
  expect(readTopics).toHaveBeenCalledTimes(1);
});

test("class mutation revokes already pending class responses", async () => {
  const old = deferred<ReadonlyArray<ClassSummary>>();
  const read = jest.fn().mockImplementationOnce(() => old.promise).mockResolvedValue([cls("fresh")]);
  const a = start(teacher(), { listClasses: read });
  invalidateCurriculumClassCache(); await open(a);
  old.resolve([cls("old")]); await settle(); cancel(); await open(a);
  expect(get("assign-row-fresh")).toBeDefined();
  expect(document.querySelector('[data-testid="assign-row-old"]')).toBeNull();
  expect(read).toHaveBeenCalledTimes(2);
});

test("failed class, link, topic and lifecycle loads remain retryable", async () => {
  const readClasses = jest.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue([cls()]);
  const readLinks = jest.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue([link()]);
  const readTopics = jest.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(topics("Recovered"));
  const readLifecycle = jest.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValue(lifecycle());
  const a = start(teacher(), { listClasses: readClasses, integrations: integrations(readTopics, readLinks), assignments: assignments(readLifecycle) });
  await settle(); await open(a);
  get<HTMLButtonElement>("assign-row-retry-c1").click(); await settle();
  expect(readLifecycle).toHaveBeenCalledTimes(2);
  cancel(); await open(a); // topics failed on the first creation-row render
  cancel(); await open(a);
  expect(get("assign-row-lms-topic-c1").textContent).toContain("Recovered");
  expect(readClasses).toHaveBeenCalledTimes(2); expect(readLinks).toHaveBeenCalledTimes(2);
  expect(readTopics).toHaveBeenCalledTimes(2);
});

test("same-UID rebootstrap rejects an old row Retry completion", async () => {
  const delayed = deferred<AssignmentsLifecycleStateOutput>();
  const read = jest.fn().mockRejectedValueOnce(new Error("network")).mockImplementationOnce(() => delayed.promise).mockResolvedValue(lifecycle());
  const deps = { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: assignments(read) };
  const a = start(teacher(), deps); await open(a);
  const oldRow = get("assign-row-c1");
  get<HTMLButtonElement>("assign-row-retry-c1").click();
  invalidateCurriculumSession();
  const b = start(teacher(), deps); await open(b); cancel();
  delayed.resolve({ ...lifecycle(), state: "onePublishedFullyCurrent" }); await settle();
  await open(b);
  expect(get<HTMLInputElement>("assign-row-enabled-c1").disabled).toBe(false);
  expect(oldRow.querySelector('[data-testid="assign-row-retry-c1"]')?.textContent).toBe("Retrying…");
  expect(read).toHaveBeenCalledTimes(3);
});

test("old publication completion cannot register metadata, mark B assigned or show an old result", async () => {
  const published = deferred<unknown>();
  const register = jest.fn();
  const assignmentSeam = {
    lifecycleState: jest.fn().mockResolvedValue(lifecycle()),
    createDraft: jest.fn().mockResolvedValue({}), publish: jest.fn(() => published.promise),
  } as unknown as AssignmentsCallables;
  const deps = {
    listClasses: jest.fn().mockResolvedValue([cls()]), assignments: assignmentSeam,
    assignmentDetail: { register, list: () => [] } as unknown as NonNullable<CurriculumSurfaceDeps["assignmentDetail"]>,
  };
  const a = start(teacher(), deps); await open(a);
  get<HTMLButtonElement>("assign-confirm").click(); await settle();
  expect(assignmentSeam.publish).toHaveBeenCalledTimes(1);
  invalidateCurriculumSession();
  const b = start(teacher("B"), deps); await open(b);
  const before = b.textContent;
  published.resolve({}); await settle();
  expect(register).not.toHaveBeenCalled();
  expect(b.textContent).toBe(before);
  expect(get<HTMLButtonElement>("lesson-assign-earths-layers", b).textContent).toBe("Assign");
});

test("an invalidated pending lifecycle read cannot refill the mutation cache", async () => {
  const delayed = deferred<AssignmentsLifecycleStateOutput>();
  const read = jest.fn().mockImplementationOnce(() => delayed.promise).mockResolvedValue(lifecycle());
  const deps = { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: assignments(read) };
  const a = start(teacher(), deps); await open(a); cancel();
  invalidateCurriculumClassCache(); await open(a); cancel();
  delayed.resolve({ ...lifecycle(), state: "onePublishedFullyCurrent" }); await settle();
  await open(a);
  expect(get<HTMLInputElement>("assign-row-enabled-c1").disabled).toBe(false);
  expect(read).toHaveBeenCalledTimes(2);
});


test("shared My Units Assign entry establishes ownership without a Curriculum mount", async () => {
  const lesson = getSurfaceableLessons().find((l) => l.slug === "earths-layers")!;
  const listClasses = jest.fn().mockResolvedValue([cls()]);
  const onConfirm = jest.fn();
  const dialogInput = { doc: document, lesson, session: teacher(), listClasses,
    integrations: null, assignments: null, assignmentDetail: null, onConfirm };
  openLessonAssignDialog(dialogInput); await settle();
  expect(get("assign-row-c1")).toBeDefined();
  input("assign-shared-points", "37");
  get<HTMLButtonElement>("assign-confirm").click();
  invalidateCurriculumSession();
  openLessonAssignDialog({ ...dialogInput, session: teacher("B") }); await settle();
  expect(get<HTMLInputElement>("assign-shared-points").value).toBe("10");
  expect(listClasses).toHaveBeenCalledTimes(2);
});

// ---------------------------------------------------------------------------
// Sol re-audit: operation ownership, LMS state ownership, unknown lifecycle.
// ---------------------------------------------------------------------------

type PublishInput = { readonly assignmentId: string; readonly attemptNonce?: string };
const lmsOutcome = (status: "succeeded" | "failed", errorCode?: string) =>
  ({ publicationId: "p1", status, ...(errorCode !== undefined ? { errorCode } : { lmsAssignmentId: "gc-1" }) });
// Classroom-capable integrations whose publish/consent calls the test controls.
const lmsIntegrations = (over: Partial<Record<"publishAssignment" | "beginConnection" | "completeConnection", jest.Mock>> & { openOAuth?: jest.Mock } = {}) => {
  const callables = {
    listClassTopics: jest.fn().mockResolvedValue([]),
    describeConnections: jest.fn().mockResolvedValue([]),
    publishAssignment: over.publishAssignment ?? jest.fn().mockResolvedValue(lmsOutcome("succeeded")),
    beginConnection: over.beginConnection ?? jest.fn().mockResolvedValue({ authorizationUrl: "u", state: "s" }),
    completeConnection: over.completeConnection ?? jest.fn().mockResolvedValue({ connectionId: "c", alreadyConnected: true }),
  };
  const openOAuth = over.openOAuth ?? jest.fn().mockResolvedValue({ code: "c", state: "s" });
  return {
    callables,
    openOAuth,
    deps: {
      listClassLinks: jest.fn().mockResolvedValue([link()]),
      callables,
      openOAuth,
      redirectUri: "https://app.test/lms-callback",
    } as unknown as IntegrationsDeps,
  };
};
const lifecycleSeam = (over: Partial<Record<"createDraft" | "publish" | "lifecycleState", jest.Mock>> = {}) => ({
  lifecycleState: over.lifecycleState ?? jest.fn().mockResolvedValue(lifecycle()),
  createDraft: over.createDraft ?? jest.fn().mockResolvedValue({}),
  publish: over.publish ?? jest.fn().mockResolvedValue({}),
}) as unknown as AssignmentsCallables & Record<"createDraft" | "publish" | "lifecycleState", jest.Mock>;
// A same-UID bootstrap: the entry point revokes both session stores.
const rebootstrap = (): void => { invalidateCurriculumSession(); invalidateLmsPublicationSession(); };

describe("P1: an Assign operation is owned by its initiating session", () => {
  test.each(["sign-out", "same-UID rebootstrap", "school change"])(
    "delayed draft completion after %s publishes nothing", async (boundary) => {
      const draft = deferred<unknown>();
      const seam = lifecycleSeam({ createDraft: jest.fn(() => draft.promise) });
      const lms = lmsIntegrations();
      const register = jest.fn();
      const deps = { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam, integrations: lms.deps,
        assignmentDetail: { register, list: () => [] } as unknown as NonNullable<CurriculumSurfaceDeps["assignmentDetail"]> };
      const a = start(teacher(), deps); await open(a);
      get<HTMLButtonElement>("assign-confirm").click(); await settle();
      expect(seam.createDraft).toHaveBeenCalledTimes(1);
      if (boundary === "school change") start(teacher("A", "school-2"), deps);
      else { rebootstrap(); if (boundary === "same-UID rebootstrap") start(teacher(), deps); }
      draft.resolve({}); await settle();
      expect(seam.publish).not.toHaveBeenCalled();
      expect(lms.callables.publishAssignment).not.toHaveBeenCalled();
      expect(register).not.toHaveBeenCalled();
    });

  test("delayed LyfeLabz publish after invalidation never starts Classroom publication", async () => {
    const published = deferred<unknown>();
    const seam = lifecycleSeam({ publish: jest.fn(() => published.promise) });
    const lms = lmsIntegrations();
    const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam, integrations: lms.deps });
    await open(a);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(seam.publish).toHaveBeenCalledTimes(1);
    rebootstrap();
    published.resolve({}); await settle();
    expect(lms.callables.publishAssignment).not.toHaveBeenCalled();
  });

  test("delayed Classroom publish needing consent after invalidation starts no consent, re-issue or retry record", async () => {
    const publish = deferred<ReturnType<typeof lmsOutcome>>();
    let assignmentId = "";
    const lms = lmsIntegrations({ publishAssignment: jest.fn((i: PublishInput) => { assignmentId = i.assignmentId; return publish.promise; }) });
    const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: lifecycleSeam(), integrations: lms.deps });
    await open(a);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(lms.callables.publishAssignment).toHaveBeenCalledTimes(1);
    rebootstrap();
    const fresh = lmsPublicationSessionScope("A", "school");
    publish.resolve(lmsOutcome("failed", "lms.insufficientScope")); await settle();
    expect(lms.callables.beginConnection).not.toHaveBeenCalled();
    expect(lms.openOAuth).not.toHaveBeenCalled();
    expect(lms.callables.publishAssignment).toHaveBeenCalledTimes(1);
    expect(readLmsPublicationRetryContext(fresh, assignmentId)).toBeNull();
  });

  test("a consent already in its Google window cannot complete or re-issue after invalidation", async () => {
    const oauth = deferred<{ code: string; state: string }>();
    const openOAuth = jest.fn(() => oauth.promise);
    const lms = lmsIntegrations({ publishAssignment: jest.fn().mockResolvedValue(lmsOutcome("failed", "lms.insufficientScope")), openOAuth });
    const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: lifecycleSeam(), integrations: lms.deps });
    await open(a);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(openOAuth).toHaveBeenCalledTimes(1);
    rebootstrap();
    oauth.resolve({ code: "c", state: "s" }); await settle();
    expect(lms.callables.completeConnection).not.toHaveBeenCalled();
    expect(lms.callables.publishAssignment).toHaveBeenCalledTimes(1);
  });

  test("My Units Assign entry: delayed draft after invalidation publishes nothing", async () => {
    const lesson = getSurfaceableLessons().find((l) => l.slug === "earths-layers")!;
    const draft = deferred<unknown>();
    const seam = lifecycleSeam({ createDraft: jest.fn(() => draft.promise) });
    openLessonAssignDialog({ doc: document, lesson, session: teacher(), listClasses: jest.fn().mockResolvedValue([cls()]),
      integrations: null, assignments: seam, assignmentDetail: null, onConfirm: jest.fn() });
    await settle();
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(seam.createDraft).toHaveBeenCalledTimes(1);
    rebootstrap();
    draft.resolve({}); await settle();
    expect(seam.publish).not.toHaveBeenCalled();
  });

  test("the same valid session still creates, publishes, posts to Classroom and records retry state", async () => {
    let assignmentId = "";
    const lms = lmsIntegrations({ publishAssignment: jest.fn(async (i: PublishInput) => { assignmentId = i.assignmentId; return lmsOutcome("failed", "lms.connectionNotActive"); }) });
    const seam = lifecycleSeam();
    const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam, integrations: lms.deps });
    await open(a);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(seam.createDraft).toHaveBeenCalledTimes(1);
    expect(seam.publish).toHaveBeenCalledTimes(1);
    expect(lms.callables.publishAssignment).toHaveBeenCalledTimes(1);
    const scope = lmsPublicationSessionScope("A", "school");
    expect(readLmsPublicationRetryContext(scope, assignmentId)?.state).toBe("reconnectRequired");
    expect(readConnectionReconnectNeeded(scope, "google-classroom")).toBe(true);
  });
});

describe("P2: Classroom responses from an obsolete session leave newer state alone", () => {
  test("a late reconnect outcome from the old session does not arm the new session's Settings signal", async () => {
    const publish = deferred<ReturnType<typeof lmsOutcome>>();
    const lms = lmsIntegrations({ publishAssignment: jest.fn(() => publish.promise) });
    const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: lifecycleSeam(), integrations: lms.deps });
    await open(a);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    rebootstrap();
    start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]) });
    const fresh = lmsPublicationSessionScope("A", "school");
    publish.resolve(lmsOutcome("failed", "lms.connectionNotFound")); await settle();
    expect(readConnectionReconnectNeeded(fresh, "google-classroom")).toBe(false);
  });
});

describe("P2: unknown lifecycle is never treated as never assigned", () => {
  const unresolved = (id = "c1"): boolean => get(`assign-row-${id}`).getAttribute("data-lifecycle-state") === "unresolved";

  test("invalidation while the dialog's lifecycle read is pending leaves rows unknown and creates nothing", async () => {
    const pending = deferred<AssignmentsLifecycleStateOutput>();
    const seam = lifecycleSeam({ lifecycleState: jest.fn().mockImplementationOnce(() => pending.promise).mockResolvedValue(lifecycle()) });
    const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam });
    await open(a);
    invalidateCurriculumClassCache();
    pending.resolve(lifecycle()); await settle();
    expect(unresolved()).toBe(true);
    expect(get<HTMLInputElement>("assign-row-enabled-c1").disabled).toBe(true);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(seam.createDraft).not.toHaveBeenCalled();
  });

  test("invalidation of an open dialog's results returns rows to Retry; a confirmed never-assigned retry allows creation", async () => {
    const seam = lifecycleSeam({ lifecycleState: jest.fn().mockResolvedValue({ ...lifecycle(), state: "onePublishedFullyCurrent", currentAssignmentResolution: "valid", currentAssignmentId: "x" }) });
    const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam });
    await open(a);
    expect(unresolved()).toBe(false);
    invalidateCurriculumClassCache();
    expect(unresolved()).toBe(true);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(seam.createDraft).not.toHaveBeenCalled();
    seam.lifecycleState.mockResolvedValue(lifecycle()); // server confirms: never assigned
    get<HTMLButtonElement>("assign-row-retry-c1").click(); await settle();
    expect(unresolved()).toBe(false);
    expect(get("assign-row-c1").getAttribute("data-lifecycle-state")).toBe("neverAssigned");
    const box = get<HTMLInputElement>("assign-row-enabled-c1");
    expect(box.disabled).toBe(false);
    if (!box.checked) box.click();
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(seam.createDraft).toHaveBeenCalledTimes(1);
    expect(seam.publish).toHaveBeenCalledTimes(1);
  });

  test("a Retry read invalidated mid-flight stays unknown and can be retried again", async () => {
    const delayed = deferred<AssignmentsLifecycleStateOutput>();
    const seam = lifecycleSeam({ lifecycleState: jest.fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockImplementationOnce(() => delayed.promise)
      .mockResolvedValue(lifecycle()) });
    const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam });
    await open(a);
    get<HTMLButtonElement>("assign-row-retry-c1").click();
    invalidateCurriculumClassCache();
    delayed.resolve(lifecycle()); await settle();
    expect(unresolved()).toBe(true);
    get<HTMLButtonElement>("assign-row-retry-c1").click(); await settle();
    expect(get("assign-row-c1").getAttribute("data-lifecycle-state")).toBe("neverAssigned");
    expect(seam.lifecycleState).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Sol second audit: pending mutations and per-lesson lifecycle validity.
// ---------------------------------------------------------------------------

const assigned = () => ({ ...lifecycle(), state: "onePublishedFullyCurrent" as const, currentAssignmentResolution: "valid" as const, currentAssignmentId: "x" });
const rowState = (id = "c1"): string | null => get(`assign-row-${id}`).getAttribute("data-lifecycle-state");
// The first lesson card other than Earth's Layers that this mount renders.
const otherLessonSlug = (mount: HTMLElement): string => {
  const button = Array.from(mount.querySelectorAll<HTMLButtonElement>('[data-testid^="lesson-assign-"]'))
    .find((b) => b.getAttribute("data-testid") !== "lesson-assign-earths-layers");
  if (!button) throw new Error("no second lesson card");
  return button.getAttribute("data-testid")!.slice("lesson-assign-".length);
};

describe("P2: status is unknown while an Assign mutation is unresolved", () => {
  test("reopening during a pending draft issues no read, offers no action and creates no duplicate; settlement reads fresh", async () => {
    const draft = deferred<unknown>();
    const seam = lifecycleSeam({ createDraft: jest.fn(() => draft.promise) });
    const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam });
    await open(a);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(seam.createDraft).toHaveBeenCalledTimes(1);
    seam.lifecycleState.mockResolvedValue(lifecycle()); // a stale "never assigned" answer
    await open(a);
    expect(rowState()).toBe("unresolved");
    expect(get<HTMLInputElement>("assign-row-enabled-c1").disabled).toBe(true);
    get<HTMLButtonElement>("assign-row-retry-c1").click(); await settle();
    expect(rowState()).toBe("unresolved");
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(seam.createDraft).toHaveBeenCalledTimes(1);
    expect(seam.lifecycleState).toHaveBeenCalledTimes(1);
    cancel();
    seam.lifecycleState.mockResolvedValue(assigned());
    draft.resolve({}); await settle();
    await open(a);
    expect(seam.lifecycleState).toHaveBeenCalledTimes(2);
    expect(rowState()).toBe("onePublishedFullyCurrent");
  });

  test("a dialog open when the mutation settles stays unknown until a fresh Retry read", async () => {
    const published = deferred<unknown>();
    const seam = lifecycleSeam({ publish: jest.fn(() => published.promise) });
    const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam });
    await open(a);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    await open(a);
    expect(rowState()).toBe("unresolved");
    seam.lifecycleState.mockResolvedValue(assigned());
    published.resolve({}); await settle();
    expect(rowState()).toBe("unresolved");
    get<HTMLButtonElement>("assign-row-retry-c1").click(); await settle();
    expect(rowState()).toBe("onePublishedFullyCurrent");
  });

  test("a failed draft settles too: the row is not left disabled and a confirmed never-assigned allows creation", async () => {
    const draft = deferred<unknown>();
    const seam = lifecycleSeam({ createDraft: jest.fn().mockImplementationOnce(() => draft.promise).mockResolvedValue({}) });
    const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam });
    await open(a);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    draft.reject(new Error("network")); await settle();
    await open(a);
    expect(rowState()).toBe("neverAssigned");
    const box = get<HTMLInputElement>("assign-row-enabled-c1");
    expect(box.disabled).toBe(false);
    if (!box.checked) box.click();
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(seam.createDraft).toHaveBeenCalledTimes(2);
  });

  // P3-2 changed this contract: the same teacher's next session keeps the
  // row unknown until the old request settles, then it is not left disabled.
  test("a session boundary during a pending draft keeps the same teacher's row unknown only until the draft settles", async () => {
    const draft = deferred<unknown>();
    const seam = lifecycleSeam({ createDraft: jest.fn(() => draft.promise) });
    const deps = { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam };
    const a = start(teacher(), deps); await open(a);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    rebootstrap();
    const b = start(teacher(), deps); await open(b);
    expect(rowState()).toBe("unresolved");
    draft.resolve({}); await settle();
    expect(seam.publish).not.toHaveBeenCalled();
    get<HTMLButtonElement>("assign-row-retry-c1").click(); await settle();
    expect(rowState()).toBe("neverAssigned");
    expect(get<HTMLInputElement>("assign-row-enabled-c1").disabled).toBe(false);
  });

  test("Set Current with a failed refresh drops the cached status, so reopening Assign reads fresh", async () => {
    const before = { state: "onePublishedMissingRecipients" as const, currentAssignmentId: null, currentAssignmentResolution: "unresolved" as const,
      candidates: [{ assignmentId: "a-1", title: "Earth's Layers", status: "published" as const, publishedAt: 1700000000000, recipientCount: 5, activeEnrollmentCount: 7, missingRecipientCount: 2 }] };
    const read = jest.fn().mockResolvedValueOnce(before).mockRejectedValueOnce(new Error("network")).mockResolvedValue(assigned());
    const seam = { ...lifecycleSeam({ lifecycleState: read }), currentSet: jest.fn().mockResolvedValue({ changed: true }) } as unknown as AssignmentsCallables;
    const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam });
    await open(a);
    get<HTMLButtonElement>("assign-row-set-current-c1").click(); await settle();
    const radio = get<HTMLInputElement>("assign-current-option-c1-a-1");
    radio.checked = true; radio.dispatchEvent(new Event("change", { bubbles: true }));
    get<HTMLButtonElement>("assign-row-set-current-confirm-c1").click(); await settle();
    expect(rowState()).toBe("unresolved"); // the refresh failed
    cancel();
    await open(a);
    expect(read).toHaveBeenCalledTimes(3);
    expect(rowState()).toBe("onePublishedFullyCurrent");
  });
});

describe("P2: lifecycle invalidation is scoped to the affected lesson and class", () => {
  test("lesson B's mutation does not discard lesson A's valid pending read; A's own mutation does", async () => {
    const pendingA = deferred<AssignmentsLifecycleStateOutput>();
    const read = jest.fn()
      .mockImplementationOnce(() => pendingA.promise) // lesson A, first open
      .mockResolvedValue(lifecycle());
    const seam = lifecycleSeam({ lifecycleState: read });
    const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam });
    await open(a); cancel(); // A's read continues after the dialog closes
    const other = otherLessonSlug(a);
    await open(a, other);
    get<HTMLButtonElement>("assign-confirm").click(); await settle(); // mutation on lesson B
    expect(seam.createDraft).toHaveBeenCalledTimes(1);
    pendingA.resolve(assigned()); await settle();
    const readsBefore = read.mock.calls.length;
    await open(a);
    expect(read.mock.calls.length).toBe(readsBefore); // served from A's still-valid result
    expect(rowState()).toBe("onePublishedFullyCurrent");
    cancel();

    // Lesson A's own invalidation still rejects A's in-flight read.
    const pendingA2 = deferred<AssignmentsLifecycleStateOutput>();
    rebootstrap();
    const fresh = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam });
    read.mockReset();
    read.mockImplementationOnce(() => pendingA2.promise).mockResolvedValue(lifecycle());
    await open(fresh); cancel();
    await open(fresh); // second open issues another read (A not cached yet)
    get<HTMLButtonElement>("assign-confirm").click(); await settle(); // mutation on lesson A, c1
    pendingA2.resolve(assigned()); await settle(); // stale: started before A's mutation
    read.mockResolvedValue(lifecycle());
    await open(fresh);
    expect(read).toHaveBeenCalledTimes(3);
    expect(rowState()).toBe("neverAssigned");
  });

  test("an open dialog ignores another lesson's invalidation", async () => {
    const seam = lifecycleSeam();
    const a = start(teacher(), { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam });
    const other = otherLessonSlug(a);
    // Start a lesson B mutation, then open lesson A while it is pending.
    const draft = deferred<unknown>();
    seam.createDraft.mockImplementationOnce(() => draft.promise);
    await open(a, other);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    await open(a);
    expect(rowState()).toBe("neverAssigned");
    draft.resolve({}); await settle(); // lesson B settles and invalidates B/c1
    expect(rowState()).toBe("neverAssigned");
  });
});

// ---------------------------------------------------------------------------
// Checkpoint 6C-2 (P3-2): a creation request already sent by an obsolete
// session stays unresolved for the SAME teacher and school only.
// ---------------------------------------------------------------------------

describe("P3-2: an unresolved creation across a same-teacher session boundary", () => {
  // Session 1 confirms Assign; its LyfeLabz publish request is held open.
  const publishInFlight = async (lms = lmsIntegrations()) => {
    const published = deferred<unknown>();
    const seam = lifecycleSeam({ publish: jest.fn(() => published.promise) });
    const deps = { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam, integrations: lms.deps };
    const a = start(teacher(), deps); await open(a);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(seam.publish).toHaveBeenCalledTimes(1);
    seam.lifecycleState.mockClear();
    // The server has not committed the publish yet: a read would say never assigned.
    seam.lifecycleState.mockResolvedValue(lifecycle());
    return { published, seam, deps, lms };
  };

  test("same teacher, same school: sign-out and sign-in during publication offers no duplicate and sends no read", async () => {
    const { published, seam, deps, lms } = await publishInFlight();
    rebootstrap();
    const next = start(teacher(), deps); await open(next);
    expect(rowState()).toBe("unresolved");
    expect(get<HTMLInputElement>("assign-row-enabled-c1").disabled).toBe(true);
    // Repeated clicks and retries while the old request is unresolved.
    for (let i = 0; i < 3; i++) {
      get<HTMLButtonElement>("assign-row-retry-c1").click(); await settle();
      get<HTMLButtonElement>("assign-confirm").click(); await settle();
    }
    expect(rowState()).toBe("unresolved");
    expect(seam.lifecycleState).not.toHaveBeenCalled();
    expect(seam.createDraft).toHaveBeenCalledTimes(1);
    published.resolve({}); await settle();
    // The obsolete session sends nothing further.
    expect(lms.callables.publishAssignment).not.toHaveBeenCalled();
  });

  test("publication success after revocation: the open dialog stays unknown, then a fresh read shows it assigned", async () => {
    const { published, seam, deps } = await publishInFlight();
    rebootstrap();
    const next = start(teacher(), deps); await open(next);
    seam.lifecycleState.mockResolvedValue(assigned());
    published.resolve({}); await settle();
    expect(rowState()).toBe("unresolved");
    expect(seam.lifecycleState).not.toHaveBeenCalled();
    get<HTMLButtonElement>("assign-row-retry-c1").click(); await settle();
    expect(rowState()).toBe("onePublishedFullyCurrent");
    cancel(); await open(next);
    expect(rowState()).toBe("onePublishedFullyCurrent");
    expect(seam.createDraft).toHaveBeenCalledTimes(1);
  });

  test("publication failure after revocation: the hold is released and a confirmed never-assigned allows creation", async () => {
    const { published, seam, deps } = await publishInFlight();
    rebootstrap();
    const next = start(teacher(), deps);
    published.reject(new Error("deadline-exceeded")); await settle();
    await open(next);
    expect(seam.lifecycleState).toHaveBeenCalledTimes(1);
    expect(rowState()).toBe("neverAssigned");
    const box = get<HTMLInputElement>("assign-row-enabled-c1");
    expect(box.disabled).toBe(false);
    if (!box.checked) box.click();
    seam.publish.mockResolvedValue({});
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(seam.createDraft).toHaveBeenCalledTimes(2);
  });

  test("unknown status during reconciliation is never treated as never assigned", async () => {
    const { published, seam, deps } = await publishInFlight();
    rebootstrap();
    const next = start(teacher(), deps); await open(next);
    published.resolve({}); await settle();
    seam.lifecycleState.mockRejectedValueOnce(new Error("unavailable"));
    get<HTMLButtonElement>("assign-row-retry-c1").click(); await settle();
    expect(rowState()).toBe("unresolved");
    expect(get<HTMLInputElement>("assign-row-enabled-c1").disabled).toBe(true);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(seam.createDraft).toHaveBeenCalledTimes(1);
  });

  test("a different teacher signing in while publication is pending never sees the hold", async () => {
    const { published, seam, deps } = await publishInFlight();
    rebootstrap();
    const other = start(teacher("B"), deps); await open(other);
    expect(seam.lifecycleState).toHaveBeenCalledTimes(1);
    expect(rowState()).toBe("neverAssigned");
    expect(get<HTMLInputElement>("assign-row-enabled-c1").disabled).toBe(false);
    // A's settlement does not touch B's lifecycle state or open dialog.
    published.resolve({}); await settle();
    expect(rowState()).toBe("neverAssigned");
    cancel(); await open(other);
    expect(seam.lifecycleState).toHaveBeenCalledTimes(1);
  });

  test("the same teacher in another school context never sees the hold", async () => {
    const { published, seam, deps } = await publishInFlight();
    const otherSchool = start(teacher("A", "school-2"), deps); await open(otherSchool);
    expect(seam.lifecycleState).toHaveBeenCalledTimes(1);
    expect(rowState()).toBe("neverAssigned");
    expect(get<HTMLInputElement>("assign-row-enabled-c1").disabled).toBe(false);
    published.resolve({}); await settle();
    expect(rowState()).toBe("neverAssigned");
  });

  test("no permanent pending state: after settlement later sessions read normally", async () => {
    const { published, seam, deps } = await publishInFlight();
    rebootstrap();
    start(teacher(), deps);
    rebootstrap(); // a second boundary while still unresolved
    const third = start(teacher(), deps); await open(third);
    expect(rowState()).toBe("unresolved");
    cancel();
    published.resolve({}); await settle();
    rebootstrap();
    const fourth = start(teacher(), deps); await open(fourth);
    expect(seam.lifecycleState).toHaveBeenCalledTimes(1);
    expect(rowState()).toBe("neverAssigned");
    expect(get<HTMLInputElement>("assign-row-enabled-c1").disabled).toBe(false);
  });

  test("entry point: the hold is not cleared by the session boundary but is released on every creation outcome", () => {
    const source = readFileSync(resolve(__dirname, "curriculum.ts"), "utf8");
    const boundary = source.slice(source.indexOf("export function invalidateCurriculumSession"));
    expect(boundary.slice(0, boundary.indexOf("\n}\n"))).not.toContain("unresolvedCreations");
    const lifecycleRun = source.slice(source.indexOf("async function runAssignmentLifecycle"));
    const hold = lifecycleRun.indexOf("holdUnresolvedCreation(owner, row.classId, lesson.slug)");
    expect(hold).toBeGreaterThan(0);
    expect(hold).toBeLessThan(lifecycleRun.indexOf("await assignments.createDraft("));
    // Draft failed, draft left unpublished, publish succeeded, publish failed.
    const step = lifecycleRun.slice(hold, lifecycleRun.indexOf("// Publication did not complete"));
    expect(step.match(/releaseCreation\(\);/g)?.length).toBe(3);
    // The publish release sits outside the try that classifies the outcome.
    const publishStep = step.slice(step.indexOf("await assignments.publish("));
    expect(publishStep.indexOf("releaseCreation();")).toBeGreaterThan(publishStep.indexOf("} catch {"));
  });
});

// ---------------------------------------------------------------------------
// Checkpoint 6C-4 (N1, N2).
// ---------------------------------------------------------------------------

describe("6C-4: hold release cannot change outcomes; test reset clears holds", () => {
  test("N1: a throwing open-dialog listener during release keeps a successful publish published and still posts to Classroom", async () => {
    const published = deferred<unknown>();
    const seam = lifecycleSeam({ publish: jest.fn(() => published.promise) });
    const lms = lmsIntegrations();
    const deps = { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam, integrations: lms.deps };
    const a = start(teacher(), deps); await open(a);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    expect(seam.publish).toHaveBeenCalledTimes(1);
    // Same session: reopen Assign so its lifecycle listener is registered,
    // then make that listener's re-render throw during the release.
    await open(a);
    expect(rowState()).toBe("unresolved");
    const replaceWith = jest.spyOn(Element.prototype, "replaceWith").mockImplementation(() => {
      throw new Error("listener failure");
    });
    try {
      published.resolve({}); await settle();
      expect(replaceWith).toHaveBeenCalled();
    } finally {
      replaceWith.mockRestore();
    }
    // Successful publish stayed published: the Classroom step still ran.
    expect(lms.callables.publishAssignment).toHaveBeenCalledTimes(1);
    expect(seam.createDraft).toHaveBeenCalledTimes(1);
  });

  test("N2: the test-only reset removes a pending hold that a session boundary keeps", async () => {
    const published = deferred<unknown>();
    const seam = lifecycleSeam({ publish: jest.fn(() => published.promise) });
    const deps = { listClasses: jest.fn().mockResolvedValue([cls()]), assignments: seam };
    const a = start(teacher(), deps); await open(a);
    get<HTMLButtonElement>("assign-confirm").click(); await settle();
    rebootstrap();
    const b = start(teacher(), deps); await open(b);
    expect(rowState()).toBe("unresolved"); // production boundary keeps the hold
    cancel();
    seam.lifecycleState.mockClear();
    _resetCurriculumSessionStateForTest();
    const c = start(teacher(), deps); await open(c);
    expect(seam.lifecycleState).toHaveBeenCalledTimes(1);
    expect(rowState()).toBe("neverAssigned");
    published.resolve({}); await settle();
  });
});
