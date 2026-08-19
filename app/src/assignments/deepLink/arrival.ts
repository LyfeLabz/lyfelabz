import { buildAssignmentLaunchUrl, buildLessonBasePath } from "../studentList/launch";
import type { DeepLinkResolution, DeepLinkResolveCallable } from "./types";

// Sprint 27 Phase 4 (blueprint §8.3, §8.5, §8.6): the Google Classroom
// deep-link arrival surface.
//
// A student arriving on `/app/a/{assignmentId}` (already authenticated as an
// active student by the bootstrap) lands here. This surface invokes the
// read-only server resolver and then either hands off silently to the
// existing assignment-aware runtime (PDR-024h silent arrival) or renders a
// calm, non-leaking state. It is a pure DOM builder: it imports no firebase/*
// and receives its resolver, its navigator, and its "go to My Assignments"
// fallback through injected deps.
//
// It NEVER constructs a Classroom destination, never accepts an arbitrary
// URL, and only ever navigates to an internal lesson path built by the
// certified `buildAssignmentLaunchUrl` / `buildLessonBasePath` helpers from
// the server-resolved lessonSlug. There is no open-redirect surface: the only
// input is the opaque assignmentId parsed from our own route, and the only
// navigation target is an internal `/lesson_*.html` or `/app/lessons/*` path.

export type DeepLinkArrivalDeps = {
  readonly assignmentId: string;
  // The certified resolver seam (wire.ts). Rejects on any resolver refusal.
  readonly resolve: DeepLinkResolveCallable;
  // Navigate the current tab to an internal lesson URL (window.location.assign
  // in production). Only ever called with a helper-built internal path.
  readonly navigate: (url: string) => void;
  // Render the student's My Assignments surface (the calm fallback for an
  // informational or non-retryable state).
  readonly onGoToMyAssignments: () => void;
};

// Extract the stable platform error code from a thrown callable error. A
// thrown PlatformError reaches the client as a Firebase callable error whose
// `details` carries `{ code }` (server translateThrown). The raw error, its
// message, and any Firebase internals are never surfaced to the student; only
// this stable code is inspected for routing to a calm message.
function extractErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    const details = (err as { details?: unknown }).details;
    if (details && typeof details === "object") {
      const code = (details as { code?: unknown }).code;
      if (typeof code === "string" && code.length > 0) return code;
    }
    const direct = (err as { code?: unknown }).code;
    if (typeof direct === "string" && direct.length > 0) return direct;
  }
  return undefined;
}

function clear(mount: HTMLElement): void {
  while (mount.firstChild) mount.removeChild(mount.firstChild);
}

function renderMessage(
  mount: HTMLElement,
  opts: {
    readonly testid: string;
    readonly heading: string;
    readonly body: string;
    readonly action?: { readonly label: string; readonly onClick: () => void };
  },
): void {
  clear(mount);
  const section = document.createElement("section");
  section.className = "deep-link-arrival";
  section.setAttribute("data-testid", opts.testid);
  section.setAttribute("role", "status");
  section.setAttribute("aria-live", "polite");

  const heading = document.createElement("h1");
  heading.className = "deep-link-arrival-heading";
  heading.textContent = opts.heading;
  section.appendChild(heading);

  const body = document.createElement("p");
  body.className = "deep-link-arrival-body";
  body.textContent = opts.body;
  section.appendChild(body);

  if (opts.action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "deep-link-arrival-action";
    button.setAttribute("data-testid", `${opts.testid}-action`);
    button.textContent = opts.action.label;
    button.addEventListener("click", opts.action.onClick);
    section.appendChild(button);
  }

  mount.appendChild(section);
}

function renderLoading(mount: HTMLElement): void {
  clear(mount);
  const section = document.createElement("section");
  section.className = "deep-link-arrival-loading";
  section.setAttribute("data-testid", "deep-link-arrival-loading");
  section.setAttribute("role", "status");
  section.setAttribute("aria-live", "polite");
  const p = document.createElement("p");
  p.textContent = "Opening your assignment...";
  section.appendChild(p);
  mount.appendChild(section);
}

function handleResolution(
  mount: HTMLElement,
  deps: DeepLinkArrivalDeps,
  resolution: DeepLinkResolution,
): void {
  if (
    resolution.attemptContext === "authorized" &&
    resolution.internalTarget === "assignmentLaunch"
  ) {
    // Silent arrival (PDR-024h): hand off to the existing assignment-aware
    // launch/runtime, exactly as the My Assignments launch control does. No
    // class or assignment picker is shown.
    const url = buildAssignmentLaunchUrl({
      assignmentId: resolution.assignmentId,
      lessonSlug: resolution.lessonSlug,
      title: "",
      status: "published",
      publishedAt: null,
    });
    if (url !== null) {
      deps.navigate(url);
      return;
    }
    // A missing launch URL means the resolved lessonSlug is unusable. Fail
    // closed to a calm retryable state rather than launching a broken URL.
    renderRetryable(mount, deps);
    return;
  }

  if (resolution.internalTarget === "lessonPractice") {
    const base = buildLessonBasePath(resolution.lessonSlug);
    if (base !== null) {
      deps.navigate(base);
      return;
    }
    renderRetryable(mount, deps);
    return;
  }

  // internalTarget === "informational": the caller is enrolled but cannot
  // begin an attempt right now (not a recipient, the window is closed, or the
  // assignment is closed). One calm, non-leaking message covers every case;
  // no recipient, roster, or lifecycle internal is exposed.
  renderMessage(mount, {
    testid: "deep-link-arrival-informational",
    heading: "This assignment isn't available for you yet",
    body: "This assignment isn't ready for you right now. Ask your teacher for help.",
    action: {
      label: "Go to My Assignments",
      onClick: deps.onGoToMyAssignments,
    },
  });
}

function renderRetryable(mount: HTMLElement, deps: DeepLinkArrivalDeps): void {
  renderMessage(mount, {
    testid: "deep-link-arrival-error",
    heading: "We couldn't open this assignment",
    body: "Something went wrong opening this assignment. Try again in a moment.",
    action: {
      label: "Try again",
      onClick: () => {
        void run(mount, deps);
      },
    },
  });
}

function handleFailure(
  mount: HTMLElement,
  deps: DeepLinkArrivalDeps,
  err: unknown,
): void {
  const code = extractErrorCode(err);
  switch (code) {
    case "role-forbidden":
      renderMessage(mount, {
        testid: "deep-link-arrival-unavailable",
        heading: "This assignment isn't available for your account",
        body: "This assignment isn't available for your account.",
        action: {
          label: "Go to My Assignments",
          onClick: deps.onGoToMyAssignments,
        },
      });
      return;
    case "district-mismatch":
    case "enrollment-inactive":
      renderMessage(mount, {
        testid: "deep-link-arrival-not-enrolled",
        heading: "This assignment isn't available for you yet",
        body: "This assignment isn't available for your account. Ask your teacher for help.",
        action: {
          label: "Go to My Assignments",
          onClick: deps.onGoToMyAssignments,
        },
      });
      return;
    case "assignment-archived":
      renderMessage(mount, {
        testid: "deep-link-arrival-closed",
        heading: "This assignment is closed",
        body: "This assignment is closed.",
        action: {
          label: "Go to My Assignments",
          onClick: deps.onGoToMyAssignments,
        },
      });
      return;
    case "assignment-not-found":
    case "assignment-not-published":
    case "deep-link-shape-invalid":
      renderMessage(mount, {
        testid: "deep-link-arrival-unavailable",
        heading: "This assignment isn't available",
        body: "This assignment isn't available right now.",
        action: {
          label: "Go to My Assignments",
          onClick: deps.onGoToMyAssignments,
        },
      });
      return;
    default:
      // Unauthenticated, account-inactive, claim staleness, transport, or any
      // unexpected failure: offer a retry. No raw code is ever shown.
      renderRetryable(mount, deps);
      return;
  }
}

async function run(mount: HTMLElement, deps: DeepLinkArrivalDeps): Promise<void> {
  renderLoading(mount);
  let resolution: DeepLinkResolution;
  try {
    resolution = await deps.resolve({ assignmentId: deps.assignmentId });
  } catch (err) {
    handleFailure(mount, deps, err);
    return;
  }
  handleResolution(mount, deps, resolution);
}

// Render the deep-link arrival surface into `mount`, invoke the resolver, and
// dispatch to the runtime or a calm state. Returns a promise that resolves
// when the initial resolution has been handled (so tests can await it).
export function renderDeepLinkArrival(
  mount: HTMLElement,
  deps: DeepLinkArrivalDeps,
): Promise<void> {
  return run(mount, deps);
}
