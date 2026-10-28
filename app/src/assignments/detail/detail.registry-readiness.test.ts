/**
 * @jest-environment jsdom
 *
 * Performance Operation 1 (audit correction 4): Assignment Detail, opened
 * while the assignment registry hydrates in the background, distinguishes a
 * pending registry (loading), a failed one (an accurate "could not load"
 * state whose Try again re-requests enumeration and recovers the intended
 * assignment), and a successful load without the assignment (the genuine
 * "could not find" state). Uses the real Detail surface, metadata reader,
 * registry, and hydration controller with a held enumeration response.
 */
import { renderAssignmentDetail } from "./detail";
import { createAssignmentDetailRegistry } from "./registry";
import { createAssignmentRegistryHydration } from "./hydration";
import { createAssignmentDetailMetadataReader } from "./wire";
import type { AssignmentDetailMetadata } from "./types";
import type { AssignmentSummaryCallable } from "../summary/types";

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
const deferred = <T>(): Deferred<T> => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 4; i += 1) await flush();
};

const a1: AssignmentDetailMetadata = Object.freeze({
  assignmentId: "a1",
  title: "Waves and Signals Check",
  status: "published" as const,
  className: "7A Science",
  classId: "c1",
  lessonSlug: "waves",
});

const summaryCallable: AssignmentSummaryCallable = () => new Promise(() => undefined);

const q = (root: ParentNode, id: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(`[data-testid=${id}]`);

const openDetail = () => {
  const registry = createAssignmentDetailRegistry();
  const hydration = createAssignmentRegistryHydration(registry);
  const responses: Array<Deferred<ReadonlyArray<AssignmentDetailMetadata>>> = [];
  const list = jest.fn(() => {
    const d = deferred<ReadonlyArray<AssignmentDetailMetadata>>();
    responses.push(d);
    return d.promise;
  });
  hydration.start({ uid: "t1", schoolId: "s1", generation: 1, isCurrent: () => true }, list);
  // The workspace around Detail; it must never be remounted by recovery.
  const workspace = document.createElement("div");
  workspace.setAttribute("data-testid", "workspace");
  const mount = document.createElement("div");
  workspace.appendChild(mount);
  document.body.appendChild(workspace);
  renderAssignmentDetail(mount, {
    assignmentId: "a1",
    loadMetadata: createAssignmentDetailMetadataReader(registry, hydration.readiness),
    summaryCallable,
  });
  return { mount, workspace, list, responses };
};

beforeEach(() => {
  document.body.textContent = "";
});

describe("Assignment Detail opened while the registry hydrates", () => {
  test("pending: loading, never 'could not find'", async () => {
    const { mount } = openDetail();
    await settle();
    expect(q(mount, "assignment-detail-loading")).not.toBeNull();
    expect(q(mount, "assignment-detail-empty")).toBeNull();
  });

  test("success: the assignment renders", async () => {
    const { mount, responses } = openDetail();
    responses[0]!.resolve([a1]);
    await settle();
    expect(q(mount, "assignment-detail-loading")).toBeNull();
    expect(q(mount, "assignment-detail-empty")).toBeNull();
    expect(mount.textContent).toContain("Waves and Signals Check");
  });

  test("failure: an accurate unavailable state; Try again re-requests and recovers in place", async () => {
    const { mount, workspace, list, responses } = openDetail();
    responses[0]!.reject(new Error("outage"));
    await settle();
    expect(q(mount, "assignment-detail-empty")).toBeNull();
    const error = q(mount, "assignment-detail-error");
    expect(error).not.toBeNull();
    expect(error!.textContent).toContain("We could not load this assignment right now.");
    expect(mount.textContent).not.toContain("We could not find this assignment.");

    (q(mount, "assignment-detail-retry") as HTMLButtonElement).click();
    expect(list).toHaveBeenCalledTimes(2);
    await flush();
    expect(q(mount, "assignment-detail-loading")).not.toBeNull();
    responses[1]!.resolve([a1]);
    await settle();
    expect(mount.textContent).toContain("Waves and Signals Check");
    // Same workspace element, never remounted.
    expect(q(document, "workspace")).toBe(workspace);
    expect(workspace.contains(mount)).toBe(true);
  });

  test("a retry that fails again stays on the unavailable state", async () => {
    const { mount, responses } = openDetail();
    responses[0]!.reject(new Error("outage"));
    await settle();
    (q(mount, "assignment-detail-retry") as HTMLButtonElement).click();
    responses[1]!.reject(new Error("outage again"));
    await settle();
    expect(q(mount, "assignment-detail-error")).not.toBeNull();
    expect(q(mount, "assignment-detail-empty")).toBeNull();
  });

  test("genuine not-found: a successful load without the assignment shows 'could not find'", async () => {
    const { mount, responses } = openDetail();
    responses[0]!.resolve([]);
    await settle();
    expect(q(mount, "assignment-detail-error")).toBeNull();
    expect(q(mount, "assignment-detail-empty")).not.toBeNull();
  });
});
