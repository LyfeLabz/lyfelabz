/**
 * @jest-environment jsdom
 *
 * Sprint 25 Phase 3 - assignment detail-view publication retry.
 *
 * The detail surface receives an opaque `lmsRetry` seam that owns the
 * bounded retry workflow (fresh nonce, at most one consent, at most one
 * re-issue). These tests prove the surface behavior: the calm status line,
 * the in-flight submit lock, the outcome update, the reconnect routing, and
 * that no LyfeLabz lifecycle callable is ever invoked by a publication
 * retry. The workflow internals are covered in shared/lmsPublication.test.ts.
 */
import { renderAssignmentDetail } from "./detail";
import type {
  AssignmentDetailMetadata,
  AssignmentLmsPublicationState,
  AssignmentLmsRetrySeam,
} from "./types";
import type { AssignmentSummary } from "../summary/types";

const flush = (): Promise<void> =>
  new Promise<void>((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await flush();
};

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const publishedMeta: AssignmentDetailMetadata = Object.freeze({
  assignmentId: "a1",
  title: "Earth's Layers",
  status: "published",
  className: "6A",
  classId: "c1",
  lessonSlug: "earths-layers",
});

const emptySummary: AssignmentSummary = Object.freeze({
  assignmentId: "a1",
  totalStudents: 0,
  completedStudents: 0,
  inProgressStudents: 0,
  notStartedStudents: 0,
  averagePercentage: null,
}) as unknown as AssignmentSummary;

type LifecycleSpy = {
  createDraft: number;
  publish: number;
  close: number;
};

const renderWithRetry = (
  seam: AssignmentLmsRetrySeam,
): { mount: HTMLElement; lifecycle: LifecycleSpy } => {
  const lifecycle: LifecycleSpy = { createDraft: 0, publish: 0, close: 0 };
  const mount = mkMount();
  renderAssignmentDetail(mount, {
    assignmentId: "a1",
    loadMetadata: async () => publishedMeta,
    summaryCallable: async () => emptySummary,
    // Wire a close/publish callable spy so a retry that (incorrectly)
    // re-ran the LyfeLabz lifecycle would be observable.
    closeCallable: async () => {
      lifecycle.close += 1;
      return { assignmentId: "a1", status: "closed", alreadyClosed: false };
    },
    publishCallable: async () => {
      lifecycle.publish += 1;
      return { assignmentId: "a1", status: "published", alreadyPublished: false };
    },
    lmsRetry: seam,
  });
  return { mount, lifecycle };
};

const statusLine = (mount: HTMLElement): string =>
  mount.querySelector<HTMLElement>("[data-testid=assignment-detail-lms-status]")
    ?.textContent ?? "";
const retryBtn = (mount: HTMLElement): HTMLButtonElement | null =>
  mount.querySelector<HTMLButtonElement>("[data-testid=assignment-detail-lms-retry]");

describe("assignment detail - LMS publication retry (Sprint 25 Phase 3)", () => {
  test("no lmsRetry seam: no publication panel renders (backward compatible)", async () => {
    const mount = mkMount();
    renderAssignmentDetail(mount, {
      assignmentId: "a1",
      loadMetadata: async () => publishedMeta,
      summaryCallable: async () => emptySummary,
    });
    await settle();
    expect(mount.querySelector("[data-testid=assignment-detail-lms]")).toBeNull();
  });

  test("failed state renders the calm did-not-succeed line and a retry control", async () => {
    const seam: AssignmentLmsRetrySeam = {
      initialState: "failed",
      retry: async () => "failed",
    };
    const { mount } = renderWithRetry(seam);
    await settle();
    expect(statusLine(mount)).toMatch(/did not succeed/);
    expect(retryBtn(mount)).not.toBeNull();
  });

  test("succeeded state renders the success line and no retry control", async () => {
    const seam: AssignmentLmsRetrySeam = {
      initialState: "succeeded",
      retry: async () => "succeeded",
    };
    const { mount } = renderWithRetry(seam);
    await settle();
    expect(statusLine(mount)).toMatch(/succeeded/);
    expect(retryBtn(mount)).toBeNull();
  });

  test("successful retry updates the displayed state to succeeded", async () => {
    let calls = 0;
    const seam: AssignmentLmsRetrySeam = {
      initialState: "failed",
      retry: async () => {
        calls += 1;
        return "succeeded";
      },
    };
    const { mount, lifecycle } = renderWithRetry(seam);
    await settle();
    retryBtn(mount)!.click();
    await settle();
    expect(calls).toBe(1);
    expect(statusLine(mount)).toMatch(/succeeded/);
    expect(retryBtn(mount)).toBeNull();
    // The LyfeLabz lifecycle is never re-run by a publication retry.
    expect(lifecycle.createDraft).toBe(0);
    expect(lifecycle.publish).toBe(0);
    expect(lifecycle.close).toBe(0);
  });

  test("failed retry keeps the retry control available", async () => {
    const seam: AssignmentLmsRetrySeam = {
      initialState: "failed",
      retry: async () => "failed",
    };
    const { mount } = renderWithRetry(seam);
    await settle();
    retryBtn(mount)!.click();
    await settle();
    expect(retryBtn(mount)).not.toBeNull();
    expect(statusLine(mount)).toMatch(/did not succeed/);
  });

  test("retry submit lock: a rapid double click dispatches exactly one retry", async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const seam: AssignmentLmsRetrySeam = {
      initialState: "failed",
      retry: async () => {
        calls += 1;
        await gate;
        return "succeeded";
      },
    };
    const { mount } = renderWithRetry(seam);
    await settle();
    const btn = retryBtn(mount)!;
    btn.click();
    await flush();
    // While in flight the control is disabled; a second click is a no-op.
    const btnDuring = retryBtn(mount);
    expect(btnDuring?.disabled).toBe(true);
    btnDuring?.click();
    release();
    await settle();
    expect(calls).toBe(1);
  });

  test("retry that needs permission shows the calm permission line and stays retryable", async () => {
    const states: AssignmentLmsPublicationState[] = ["permissionNotGranted"];
    let i = 0;
    const seam: AssignmentLmsRetrySeam = {
      initialState: "failed",
      retry: async () => states[i++] ?? "failed",
    };
    const { mount } = renderWithRetry(seam);
    await settle();
    retryBtn(mount)!.click();
    await settle();
    expect(statusLine(mount)).toMatch(/needs your permission/);
    expect(retryBtn(mount)).not.toBeNull();
  });

  test("reconnect state routes to Settings via onReconnect and still offers retry", async () => {
    let reconnectClicks = 0;
    const seam: AssignmentLmsRetrySeam = {
      initialState: "reconnectRequired",
      retry: async () => "succeeded",
      onReconnect: () => {
        reconnectClicks += 1;
      },
    };
    const { mount } = renderWithRetry(seam);
    await settle();
    expect(statusLine(mount)).toMatch(/needs to be reconnected in Settings/);
    const reconnect = mount.querySelector<HTMLButtonElement>(
      "[data-testid=assignment-detail-lms-reconnect]",
    );
    expect(reconnect).not.toBeNull();
    reconnect!.click();
    expect(reconnectClicks).toBe(1);
    // Retry remains available for use after reconnection.
    expect(retryBtn(mount)).not.toBeNull();
  });

  test("reconnect state without an onReconnect route renders the line and retry only", async () => {
    const seam: AssignmentLmsRetrySeam = {
      initialState: "reconnectRequired",
      retry: async () => "succeeded",
    };
    const { mount } = renderWithRetry(seam);
    await settle();
    expect(
      mount.querySelector("[data-testid=assignment-detail-lms-reconnect]"),
    ).toBeNull();
    expect(retryBtn(mount)).not.toBeNull();
  });

  test("no raw error code, token, or Google identity appears in the panel copy", async () => {
    const seam: AssignmentLmsRetrySeam = {
      initialState: "failed",
      retry: async () => "failed",
    };
    const { mount } = renderWithRetry(seam);
    await settle();
    const panel = mount.querySelector<HTMLElement>("[data-testid=assignment-detail-lms]");
    const text = panel?.textContent ?? "";
    expect(text).not.toMatch(/lms\./);
    expect(text).not.toMatch(/token/);
    expect(text).not.toMatch(/@/);
  });
});
