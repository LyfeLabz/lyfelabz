/**
 * @jest-environment jsdom
 */

// Sprint 27 Phase 4: unit tests for the deep-link arrival surface. The surface
// is a pure DOM builder; the resolver, navigator, and My Assignments fallback
// are injected. No firebase/* is imported.

import { renderDeepLinkArrival } from "./arrival";
import type { DeepLinkResolution } from "./types";

// After Sprint 28 Phase 5A.1, every assignable lesson is v2-overridden, so a
// non-overridden slug is needed to exercise the v1 root-path launch assertions
// below. ragebaiting is a real but gated (non-surfaceable) lesson that is
// intentionally absent from LESSON_LAUNCH_OVERRIDES, so it stays on the v1 path.
const SLUG = "ragebaiting";
const ASSIGNMENT_ID = "assign-1";

function makeMount(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

function resolution(over: Partial<DeepLinkResolution> = {}): DeepLinkResolution {
  return Object.freeze({
    assignmentId: ASSIGNMENT_ID,
    classId: "class-1",
    lessonSlug: SLUG,
    internalTarget: "assignmentLaunch",
    attemptContext: "authorized",
    ...over,
  });
}

function makeDeps(over: Partial<Parameters<typeof renderDeepLinkArrival>[1]> = {}) {
  return {
    assignmentId: ASSIGNMENT_ID,
    resolve: jest.fn().mockResolvedValue(resolution()),
    navigate: jest.fn(),
    onGoToMyAssignments: jest.fn(),
    ...over,
  };
}

// A thrown callable-style error carrying a stable platform code in details.
function callableError(code: string): unknown {
  return { details: { code }, message: "callable failed" };
}

describe("renderDeepLinkArrival - silent handoff", () => {
  test("authorized classroom launch navigates to the assignment launch URL", async () => {
    const mount = makeMount();
    const deps = makeDeps();
    await renderDeepLinkArrival(mount, deps);
    expect(deps.navigate).toHaveBeenCalledTimes(1);
    expect(deps.navigate).toHaveBeenCalledWith(
      `/lesson_${SLUG}.html?assignment=${ASSIGNMENT_ID}`,
    );
    expect(deps.onGoToMyAssignments).not.toHaveBeenCalled();
  });

  test("practice mode navigates to the lesson base path (no assignment param)", async () => {
    const mount = makeMount();
    const deps = makeDeps({
      resolve: jest.fn().mockResolvedValue(
        resolution({
          internalTarget: "lessonPractice",
          attemptContext: "informational",
        }),
      ),
    });
    await renderDeepLinkArrival(mount, deps);
    expect(deps.navigate).toHaveBeenCalledWith(`/lesson_${SLUG}.html`);
  });
});

describe("renderDeepLinkArrival - informational and failure states", () => {
  test("informational renders a calm message and never navigates", async () => {
    const mount = makeMount();
    const deps = makeDeps({
      resolve: jest.fn().mockResolvedValue(
        resolution({
          internalTarget: "informational",
          attemptContext: "informational",
        }),
      ),
    });
    await renderDeepLinkArrival(mount, deps);
    expect(deps.navigate).not.toHaveBeenCalled();
    const surface = mount.querySelector(
      '[data-testid="deep-link-arrival-informational"]',
    );
    expect(surface).not.toBeNull();
    // Go to My Assignments works.
    const button = mount.querySelector(
      '[data-testid="deep-link-arrival-informational-action"]',
    ) as HTMLButtonElement;
    button.click();
    expect(deps.onGoToMyAssignments).toHaveBeenCalledTimes(1);
  });

  test("role-forbidden renders an account-unavailable state", async () => {
    const mount = makeMount();
    const deps = makeDeps({
      resolve: jest.fn().mockRejectedValue(callableError("role-forbidden")),
    });
    await renderDeepLinkArrival(mount, deps);
    expect(
      mount.querySelector('[data-testid="deep-link-arrival-unavailable"]'),
    ).not.toBeNull();
    expect(deps.navigate).not.toHaveBeenCalled();
  });

  test("enrollment-inactive renders the ask-your-teacher state", async () => {
    const mount = makeMount();
    const deps = makeDeps({
      resolve: jest.fn().mockRejectedValue(callableError("enrollment-inactive")),
    });
    await renderDeepLinkArrival(mount, deps);
    expect(
      mount.querySelector('[data-testid="deep-link-arrival-not-enrolled"]'),
    ).not.toBeNull();
  });

  test("assignment-archived renders a closed state", async () => {
    const mount = makeMount();
    const deps = makeDeps({
      resolve: jest.fn().mockRejectedValue(callableError("assignment-archived")),
    });
    await renderDeepLinkArrival(mount, deps);
    expect(
      mount.querySelector('[data-testid="deep-link-arrival-closed"]'),
    ).not.toBeNull();
  });

  test("assignment-not-found renders an unavailable state", async () => {
    const mount = makeMount();
    const deps = makeDeps({
      resolve: jest.fn().mockRejectedValue(callableError("assignment-not-found")),
    });
    await renderDeepLinkArrival(mount, deps);
    expect(
      mount.querySelector('[data-testid="deep-link-arrival-unavailable"]'),
    ).not.toBeNull();
  });

  test("no internal code is ever leaked into the rendered text", async () => {
    const mount = makeMount();
    const deps = makeDeps({
      resolve: jest.fn().mockRejectedValue(callableError("district-mismatch")),
    });
    await renderDeepLinkArrival(mount, deps);
    expect(mount.textContent).not.toContain("district-mismatch");
    expect(mount.textContent).not.toContain("mismatch");
  });
});

describe("renderDeepLinkArrival - retry", () => {
  test("a generic failure renders a retry that re-resolves and hands off", async () => {
    const mount = makeMount();
    const resolve = jest
      .fn()
      .mockRejectedValueOnce(callableError("unavailable-transport"))
      .mockResolvedValueOnce(resolution());
    const deps = makeDeps({ resolve });
    await renderDeepLinkArrival(mount, deps);
    const retry = mount.querySelector(
      '[data-testid="deep-link-arrival-error-action"]',
    ) as HTMLButtonElement;
    expect(retry).not.toBeNull();
    retry.click();
    // Allow the retry's async resolve to settle.
    await Promise.resolve();
    await Promise.resolve();
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(deps.navigate).toHaveBeenCalledWith(
      `/lesson_${SLUG}.html?assignment=${ASSIGNMENT_ID}`,
    );
  });
});
