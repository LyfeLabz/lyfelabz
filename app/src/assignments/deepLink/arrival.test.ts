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

// F5.2 §7.3 (Slice 5) - differentiated deep-link launch routing + fallback.
describe("renderDeepLinkArrival - differentiated routing", () => {
  const REV = `pr${"a".repeat(64)}`;
  const SAFE_PATH = `app/lessons/variants/lesson_${SLUG}__${REV}.html`;
  const REF = "0123456789abcdef0123456789abcdef";
  const presentation = {
    variantKey: "reading-adapted",
    presentationRevisionId: REV,
    path: SAFE_PATH,
  };

  test("authorized differentiated launch navigates to the exact server path with the launchRef", async () => {
    const mount = makeMount();
    const deps = makeDeps({
      resolve: jest.fn().mockResolvedValue(resolution({ presentation, launchRef: REF })),
      probe: jest.fn().mockResolvedValue(true),
    });
    await renderDeepLinkArrival(mount, deps);
    expect(deps.probe).toHaveBeenCalledTimes(1);
    expect(deps.navigate).toHaveBeenCalledWith(
      `/${SAFE_PATH}?assignment=${ASSIGNMENT_ID}&launchRef=${REF}`,
    );
  });

  test("authorized canonicalFallback launch navigates canonical WITH the fallback ref", async () => {
    const mount = makeMount();
    const deps = makeDeps({
      resolve: jest.fn().mockResolvedValue(resolution({ launchRef: REF })),
    });
    await renderDeepLinkArrival(mount, deps);
    expect(deps.navigate).toHaveBeenCalledWith(
      `/lesson_${SLUG}.html?assignment=${ASSIGNMENT_ID}&launchRef=${REF}`,
    );
  });

  test("differentiated load failure falls back to canonical (no ref) and emits the anomaly (T-Q1)", async () => {
    const mount = makeMount();
    const onVariantLoadFailure = jest.fn();
    const deps = makeDeps({
      resolve: jest.fn().mockResolvedValue(resolution({ presentation, launchRef: REF })),
      probe: jest.fn().mockResolvedValue(false),
      onVariantLoadFailure,
    });
    await renderDeepLinkArrival(mount, deps);
    expect(onVariantLoadFailure).toHaveBeenCalledTimes(1);
    expect(deps.navigate).toHaveBeenCalledWith(
      `/lesson_${SLUG}.html?assignment=${ASSIGNMENT_ID}`,
    );
    // The differentiated URL and the launchRef were never navigated.
    const navd = (deps.navigate as jest.Mock).mock.calls[0][0] as string;
    expect(navd).not.toContain("launchRef");
    expect(navd).not.toContain("variants");
  });

  test("differentiated practice routes to the adapted artifact with no assignment param or ref", async () => {
    const mount = makeMount();
    const deps = makeDeps({
      resolve: jest.fn().mockResolvedValue(
        resolution({
          internalTarget: "lessonPractice",
          attemptContext: "informational",
          presentation,
        }),
      ),
      probe: jest.fn().mockResolvedValue(true),
    });
    await renderDeepLinkArrival(mount, deps);
    expect(deps.navigate).toHaveBeenCalledWith(`/${SAFE_PATH}`);
    const navd = (deps.navigate as jest.Mock).mock.calls[0][0] as string;
    expect(navd).not.toContain("assignment");
    expect(navd).not.toContain("launchRef");
  });

  test("an informational state never navigates, even if presentation fields are present", async () => {
    const mount = makeMount();
    const deps = makeDeps({
      resolve: jest.fn().mockResolvedValue(
        resolution({
          internalTarget: "informational",
          attemptContext: "informational",
          presentation,
          launchRef: REF,
        }),
      ),
      probe: jest.fn().mockResolvedValue(true),
    });
    await renderDeepLinkArrival(mount, deps);
    expect(deps.navigate).not.toHaveBeenCalled();
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
    // Go to My Science works.
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
