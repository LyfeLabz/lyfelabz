import type { RouteSurface } from "../router";
import type { ListClasses } from "../../classes/listClasses";
import type {
  AssignmentsCallables,
  IntegrationsDeps,
} from "../../settings/integrations/types";
import type { CurriculumAssignmentDetailSeam } from "../../shell/surfaces/curriculum";
import type { AssignmentSummaryCallable } from "../../assignments/summary/types";
import type {
  AssignmentsListForStudentCallable,
  AssignmentsListForStudentItem,
} from "../../assignments/studentList/types";
import { buildAssignmentLaunchUrl } from "../../assignments/studentList/launch";
import { mountTeacherShell } from "../../shell/shell";
import {
  clear,
  clearButtonPending,
  renderErrorBanner,
  renderHeader,
  renderHeadline,
  renderLoadingIndicator,
  renderParagraph,
  renderPrimaryButton,
  renderReturnLink,
  renderSignOut,
  setButtonPending,
  type OnSignOut,
} from "./shared";

// Route surface factory dependencies. Route surfaces receive these
// once from the entry point via createRouteTable so that the surfaces
// themselves stay pure DOM builders with no Firebase imports.
export type SurfaceDeps = {
  readonly onSignOut: OnSignOut;
  readonly onSignIn: () => Promise<void>;
  readonly onRefreshSession: () => Promise<void>;
  readonly onRequestVerification: (input: {
    readonly role: "teacher";
    readonly schoolId: string;
    readonly displayName: string;
  }) => Promise<void>;
  readonly listClasses: ListClasses;
  // Sprint 6G: injected launch handler. See
  // src/presentMode/launchContext.ts.
  readonly onLaunchPresentMode: () => void;
  // Sprint 8C: Teacher Integrations dependencies. Null in tests; the
  // real entry point wires the LMS callable seam. Accepts a getter so
  // the entry point can re-establish per-session state across reruns
  // without rebuilding the route table. See LMS_EXPERIENCE.md and
  // PDR-020c.
  readonly integrations?: IntegrationsDeps | null | (() => IntegrationsDeps | null);
  // Sprint 8D.1: authoritative assignment lifecycle callable seam. Same
  // getter pattern as `integrations` so per-session state can rebind
  // across reruns without rebuilding the route table.
  readonly assignments?:
    | AssignmentsCallables
    | null
    | (() => AssignmentsCallables | null);
  // Sprint 13B remediation. Same getter pattern as `integrations` /
  // `assignments` so per-session state (registry, opener) can rebind
  // across reruns without rebuilding the route table.
  readonly assignmentDetail?:
    | CurriculumAssignmentDetailSeam
    | null
    | (() => CurriculumAssignmentDetailSeam | null);
  // Sprint 15: certified `assessmentAssignmentSummary` seam consumed by
  // the Active Assignments dashboard for per-card progress counts.
  // Always supplied through a getter so per-session state can rebind
  // across reruns without rebuilding the route table; the callable
  // itself is a function, so the getter-form is required to keep the
  // type check unambiguous.
  readonly assignmentSummary?: () => AssignmentSummaryCallable | null;
  // Sprint 17 Slice 4: certified `assignmentsListForStudent` callable
  // seam consumed by the activeStudent surface. Always supplied through
  // a getter so per-session state can rebind across reruns without
  // rebuilding the route table; the callable itself is a function, so
  // the getter form is required to keep the type check unambiguous.
  readonly studentAssignmentsList?: () =>
    | AssignmentsListForStudentCallable
    | null;
  // Sprint 17 Slice 4: launch a lesson from the activeStudent surface.
  // Injected so tests can assert the exact URL without stubbing
  // window.location. The entry point wires window.location.assign; the
  // launcher URL is composed inside the surface from the certified item
  // fields so identifier leakage cannot be introduced at the wire.
  readonly onLaunchAssignment?: (url: string) => void;
};

// -----------------------------------------------------------------------------
// Signed-out
// -----------------------------------------------------------------------------

export const makeSignedOutSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (_session, mount) => {
    renderHeader(mount);
    renderHeadline(mount, "Sign in to LyfeLabz.");
    renderParagraph(
      mount,
      "Teachers sign in to reach the LyfeLabz teacher platform. Students sign in to reach the assignments their teacher has published. Everyone else can keep browsing the public lessons without signing in.",
    );
    const btn = renderPrimaryButton(
      mount,
      "Continue with Google",
      async () => {
        setButtonPending(btn, "Signing in");
        try {
          await deps.onSignIn();
          // On success the Auth state change re-runs the bootstrap and
          // the router will re-render. No local navigation is required.
        } catch (err) {
          clearButtonPending(btn, "Continue with Google");
          renderErrorBanner(mount, describeSignInError(err));
        }
      },
      "google-signin",
    );
    btn.setAttribute("aria-label", "Continue with Google");
    renderReturnLink(mount);
  };

function describeSignInError(err: unknown): string {
  const code = (err && typeof err === "object" && "code" in err
    ? String((err as { code?: unknown }).code)
    : "") || "";
  if (code.includes("popup-closed") || code.includes("cancelled")) {
    return "Sign in was cancelled. Try again whenever you are ready.";
  }
  if (code.includes("network")) {
    return "We could not reach Google right now. Check your connection and try again.";
  }
  return "Google sign in did not complete. Try again in a moment.";
}

// -----------------------------------------------------------------------------
// Provisioned (welcome + request verification)
// -----------------------------------------------------------------------------

const TRANSITION_MESSAGE_MS = 600;

export const makeProvisionedSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (_session, mount) => {
    renderHeader(mount);
    renderHeadline(mount, "Welcome to the LyfeLabz teacher platform.");
    renderParagraph(
      mount,
      "Your account has been created. Before you can reach the teacher tools, a LyfeLabz administrator needs to verify that you are a teacher at your school.",
    );
    renderParagraph(
      mount,
      "Choose Request Verification below. We will send your request to the administrator. Verification usually takes one school day.",
    );
    renderParagraph(
      mount,
      "You can close this window and come back at any time. Sign in again with the same Google account to see your current status.",
    );

    // The Sprint 2 requestTeacherVerification callable requires role,
    // schoolId, and displayName. We do not extend the callable contract;
    // instead we collect the two missing inputs on this surface, per
    // Step 4 §5.3.
    const form = mount.ownerDocument.createElement("form");
    form.setAttribute("data-testid", "verification-form");
    form.className = "shell-form";

    const nameLabel = mount.ownerDocument.createElement("label");
    nameLabel.textContent = "Your name";
    const nameInput = mount.ownerDocument.createElement("input");
    nameInput.type = "text";
    nameInput.required = true;
    nameInput.autocomplete = "name";
    nameInput.setAttribute("data-testid", "display-name");
    nameLabel.appendChild(nameInput);

    const schoolLabel = mount.ownerDocument.createElement("label");
    schoolLabel.textContent = "School identifier";
    const schoolInput = mount.ownerDocument.createElement("input");
    schoolInput.type = "text";
    schoolInput.required = true;
    schoolInput.setAttribute("data-testid", "school-id");
    schoolLabel.appendChild(schoolInput);

    form.appendChild(nameLabel);
    form.appendChild(schoolLabel);
    mount.appendChild(form);

    const btn = renderPrimaryButton(
      mount,
      "Request Verification",
      async () => {
        const displayName = nameInput.value.trim();
        const schoolId = schoolInput.value.trim();
        if (!displayName || !schoolId) {
          renderErrorBanner(
            mount,
            "Enter your name and school identifier to request verification.",
          );
          return;
        }
        setButtonPending(btn, "Requesting verification");
        try {
          await deps.onRequestVerification({
            role: "teacher",
            schoolId,
            displayName,
          });
          setButtonPending(btn, "Request sent");
          window.setTimeout(() => {
            void deps.onRefreshSession();
          }, TRANSITION_MESSAGE_MS);
        } catch (err) {
          clearButtonPending(btn, "Request Verification");
          renderErrorBanner(mount, describeVerificationError(err));
        }
      },
      "request-verification",
    );

    renderSignOut(mount, deps.onSignOut);
  };

function describeVerificationError(err: unknown): string {
  const code =
    err && typeof err === "object" && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message)
      : "";
  if (code.includes("permission") || code.includes("unauthenticated")) {
    return "Your account is not eligible to request verification. Sign out and try again with your school Google account.";
  }
  if (code.includes("unavailable") || code.includes("network")) {
    return "We could not send your request. Check your connection and try again.";
  }
  if (message) {
    return message.slice(0, 240);
  }
  return "We could not send your request. Try again in a moment.";
}

// -----------------------------------------------------------------------------
// Pending verification
// -----------------------------------------------------------------------------

const AUTO_REFRESH_INTERVAL_MS = 60_000;

export const makePendingSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (_session, mount) => {
    renderHeader(mount);
    renderHeadline(mount, "Your verification is pending.");
    renderParagraph(
      mount,
      "Your request has been sent to a LyfeLabz administrator. Verification usually takes one school day.",
    );
    renderParagraph(
      mount,
      "You will be able to reach the teacher tools as soon as the administrator approves your request.",
    );
    renderParagraph(
      mount,
      "You do not need to keep this page open. Sign in again anytime to check your status.",
    );

    const btn = renderPrimaryButton(
      mount,
      "Check status now",
      async () => {
        setButtonPending(btn, "Checking status");
        try {
          await deps.onRefreshSession();
          // If the bootstrap kept us on pendingVerification, the router
          // has already re-rendered the surface. The listener code path
          // updates the timestamp on the fresh render.
        } catch {
          clearButtonPending(btn, "Check status now");
          renderErrorBanner(
            mount,
            "We could not check your status. Try again in a moment.",
          );
        }
      },
      "check-status",
    );

    const lastCheckedLine = mount.ownerDocument.createElement("p");
    lastCheckedLine.className = "shell-small";
    lastCheckedLine.setAttribute("data-testid", "last-checked");
    lastCheckedLine.textContent = `Last checked at ${formatTime(new Date())}`;
    mount.appendChild(lastCheckedLine);

    // Visibility-gated 60s auto refresh. The interval is registered on
    // the mount so a subsequent surface re-render disposes it via the
    // router's `clear` step (the interval is attached to the mount node
    // and cleared when the mount is torn down).
    const doc = mount.ownerDocument;
    let intervalId: number | null = null;
    let hidden = doc.visibilityState === "hidden";

    const tick = (): void => {
      if (hidden) return;
      void deps.onRefreshSession();
    };

    const start = (): void => {
      if (intervalId !== null) return;
      intervalId = window.setInterval(tick, AUTO_REFRESH_INTERVAL_MS);
    };
    const stop = (): void => {
      if (intervalId === null) return;
      window.clearInterval(intervalId);
      intervalId = null;
    };

    const onVisibilityChange = (): void => {
      hidden = doc.visibilityState === "hidden";
      if (hidden) stop();
      else start();
    };
    doc.addEventListener("visibilitychange", onVisibilityChange);
    if (!hidden) start();

    // When the mount is later cleared by the router, MutationObserver
    // fires with the removal and we clean up. This avoids leaking timers
    // across surface transitions without exposing internals.
    const mo = new MutationObserver(() => {
      if (!mount.contains(btn)) {
        stop();
        doc.removeEventListener("visibilitychange", onVisibilityChange);
        mo.disconnect();
      }
    });
    mo.observe(mount, { childList: true });

    renderSignOut(mount, deps.onSignOut);
  };

function formatTime(d: Date): string {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

// -----------------------------------------------------------------------------
// Active teacher
// -----------------------------------------------------------------------------

export const makeActiveTeacherSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (session, mount) => {
    if (session.kind !== "activeTeacher") return;
    // Step 5: minimal Step 4 body replaced by the Teacher Platform Shell.
    // The router still owns dispatch; the shell owns layout and Home.
    const integrations =
      typeof deps.integrations === "function"
        ? deps.integrations()
        : (deps.integrations ?? null);
    const assignments =
      typeof deps.assignments === "function"
        ? deps.assignments()
        : (deps.assignments ?? null);
    const assignmentDetail =
      typeof deps.assignmentDetail === "function"
        ? deps.assignmentDetail()
        : (deps.assignmentDetail ?? null);
    const assignmentSummary =
      deps.assignmentSummary !== undefined
        ? deps.assignmentSummary()
        : null;
    mountTeacherShell(session, mount, {
      onSignOut: deps.onSignOut,
      listClasses: deps.listClasses,
      onLaunchPresentMode: deps.onLaunchPresentMode,
      integrations,
      assignments,
      assignmentDetail,
      assignmentSummary,
    });
  };

// -----------------------------------------------------------------------------
// Active student stub
// -----------------------------------------------------------------------------

// Sprint 17 Slice 4: authenticated student landing surface. Consumes the
// certified `assignmentsListForStudent` callable and presents the
// student's published assignments with a launch control. The surface
// never prompts for credentials, never reads role/schoolId/districtId
// from the browser, never issues a Firestore read, and never begins an
// assessment session (session lifecycle is Slice 5 - the runtime).
//
// Four states are supported: loading, populated, empty, and recoverable
// error. Each state preserves the calm-software conventions (welcome,
// return-to-lessons, sign-out).
export const makeActiveStudentSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (session, mount) => {
    if (session.kind !== "activeStudent") return;
    renderHeader(mount);
    renderHeadline(mount, `Welcome, ${session.displayName}.`);
    renderParagraph(
      mount,
      "You are signed in to LyfeLabz. Assignments your teacher has published will appear here.",
    );

    const listRegion = mount.ownerDocument.createElement("div");
    listRegion.setAttribute("data-testid", "assignments-region");
    mount.appendChild(listRegion);

    renderReturnLink(mount);
    renderSignOut(mount, deps.onSignOut);

    const callable =
      typeof deps.studentAssignmentsList === "function"
        ? deps.studentAssignmentsList()
        : null;
    const launch = deps.onLaunchAssignment;

    const load = (): void => {
      clear(listRegion);
      if (callable === null) {
        // The callable seam is unavailable (for example the entry point
        // has not yet wired it, or the session transition raced the
        // route table). Fall back to a calm empty state; do not prompt
        // for retry against a missing dependency.
        renderAssignmentsEmpty(listRegion);
        return;
      }
      renderLoadingIndicator(listRegion, "Loading your assignments");
      callable().then(
        (response) => {
          clear(listRegion);
          const items = filterLaunchableItems(response.items);
          if (items.length === 0) {
            renderAssignmentsEmpty(listRegion);
            return;
          }
          renderAssignmentsList(listRegion, items, launch);
        },
        () => {
          clear(listRegion);
          renderAssignmentsError(listRegion, load);
        },
      );
    };

    load();
  };

function filterLaunchableItems(
  items: ReadonlyArray<AssignmentsListForStudentItem>,
): ReadonlyArray<AssignmentsListForStudentItem> {
  // Belt-and-suspenders: wire.ts already discards malformed items, but
  // the launcher URL builder is the last gate before an identifier is
  // encoded into a URL. Any item that cannot produce a valid launch URL
  // is dropped here so no button can render without a working target.
  const out: AssignmentsListForStudentItem[] = [];
  for (const item of items) {
    if (buildAssignmentLaunchUrl(item) !== null) out.push(item);
  }
  return out;
}

function renderAssignmentsEmpty(mount: HTMLElement): void {
  const p = mount.ownerDocument.createElement("p");
  p.setAttribute("data-testid", "assignments-empty");
  p.textContent =
    "No assignments are open for you right now. Check back after your teacher publishes one.";
  mount.appendChild(p);
}

function renderAssignmentsError(
  mount: HTMLElement,
  onRetry: () => void,
): void {
  const banner = renderErrorBanner(
    mount,
    "We could not load your assignments. Check your connection and try again.",
  );
  banner.setAttribute("data-testid", "assignments-error");
  const retry = renderPrimaryButton(
    mount,
    "Try again",
    () => {
      onRetry();
    },
    "assignments-retry",
  );
  retry.setAttribute("aria-label", "Try again");
}

function renderAssignmentsList(
  mount: HTMLElement,
  items: ReadonlyArray<AssignmentsListForStudentItem>,
  launch: ((url: string) => void) | undefined,
): void {
  const doc = mount.ownerDocument;
  const list = doc.createElement("ul");
  list.setAttribute("data-testid", "assignments-list");
  list.className = "shell-list";
  for (const item of items) {
    const url = buildAssignmentLaunchUrl(item);
    if (url === null) continue;
    const li = doc.createElement("li");
    li.setAttribute("data-testid", "assignments-item");

    const heading = doc.createElement("h2");
    heading.setAttribute("data-testid", "assignments-item-title");
    // Titles are user-authored content routed through Element.textContent
    // (never innerHTML). No launch URL is constructed from the title.
    heading.textContent = item.title;
    li.appendChild(heading);

    const btn = doc.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-testid", "assignments-launch");
    btn.setAttribute("data-assignment-launch-url", url);
    btn.textContent = "Open assignment";
    btn.addEventListener("click", () => {
      if (launch) launch(url);
    });
    li.appendChild(btn);

    list.appendChild(li);
  }
  mount.appendChild(list);
}

// -----------------------------------------------------------------------------
// Active administrator stub
// -----------------------------------------------------------------------------

export const makeActiveAdministratorSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (_session, mount) => {
    renderHeader(mount);
    renderHeadline(mount, "You are signed in as a platform administrator.");
    renderParagraph(
      mount,
      "Administrator tools are not yet available in this build.",
    );
    renderSignOut(mount, deps.onSignOut);
  };

// -----------------------------------------------------------------------------
// Suspended
// -----------------------------------------------------------------------------

export const makeSuspendedSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (_session, mount) => {
    renderHeader(mount);
    renderHeadline(mount, "Your account is not available right now.");
    renderParagraph(
      mount,
      "Your LyfeLabz account has been temporarily suspended. You will not be able to reach the teacher tools until this is resolved.",
    );
    renderParagraph(
      mount,
      "If you believe this is a mistake, contact your school administrator or LyfeLabz support at teachers@lyfelabz.example.",
    );
    renderSignOut(mount, deps.onSignOut);
  };

// -----------------------------------------------------------------------------
// Archived
// -----------------------------------------------------------------------------

export const makeArchivedSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (_session, mount) => {
    renderHeader(mount);
    renderHeadline(mount, "This account has been archived.");
    renderParagraph(
      mount,
      "This LyfeLabz account is no longer active. You will not be able to reach the teacher tools with this account.",
    );
    renderParagraph(
      mount,
      "If you need to return to LyfeLabz, contact your school administrator to have a new account provisioned.",
    );
    renderSignOut(mount, deps.onSignOut);
  };

// -----------------------------------------------------------------------------
// Error surface
// -----------------------------------------------------------------------------

type ErrorCopy = {
  readonly headline: string;
  readonly body: string;
  readonly showRetry: boolean;
  readonly showRefresh: boolean;
  readonly showSignOut: boolean;
  readonly showSupport: boolean;
};

const ERROR_COPY: Readonly<
  Record<
    "authInitFailed"
    | "userRecordUnreadable"
    | "userRecordMissing"
    | "recordShapeInvalid"
    | "networkUnavailable",
    ErrorCopy
  >
> = Object.freeze({
  authInitFailed: {
    headline: "We could not start your sign-in session.",
    body: "Something went wrong before we could confirm who you are. Refresh the page and try again. If this keeps happening, sign out and sign back in.",
    showRetry: false,
    showRefresh: true,
    showSignOut: true,
    showSupport: true,
  },
  userRecordUnreadable: {
    headline: "We could not load your account.",
    body: "Your account exists, but we could not read your account record right now. This is usually a temporary connection problem.",
    showRetry: true,
    showRefresh: false,
    showSignOut: true,
    showSupport: false,
  },
  userRecordMissing: {
    headline: "Your account record was not found.",
    body: "You are signed in, but we do not have an account record for you yet. If you just requested access, wait a moment and try again. If the problem persists, contact your school administrator.",
    showRetry: true,
    showRefresh: false,
    showSignOut: true,
    showSupport: true,
  },
  recordShapeInvalid: {
    headline: "Your account record needs attention.",
    body: "We found your account record but it is not in the expected shape. This is a platform issue, not something you caused. Please contact support and include your email address.",
    showRetry: false,
    showRefresh: false,
    showSignOut: true,
    showSupport: true,
  },
  networkUnavailable: {
    headline: "You appear to be offline.",
    body: "We could not reach LyfeLabz. Check your connection and try again.",
    showRetry: true,
    showRefresh: false,
    showSignOut: false,
    showSupport: false,
  },
});

export const makeErrorSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (session, mount) => {
    if (session.kind !== "error") return;
    const copy = ERROR_COPY[session.reason];
    renderHeader(mount);
    renderHeadline(mount, copy.headline);
    renderParagraph(mount, copy.body);

    if (copy.showRetry) {
      const retry = renderPrimaryButton(
        mount,
        "Try again",
        async () => {
          setButtonPending(retry, "Trying");
          try {
            await deps.onRefreshSession();
          } catch {
            clearButtonPending(retry, "Try again");
          }
        },
        "retry",
      );
    }
    if (copy.showRefresh) {
      renderPrimaryButton(
        mount,
        "Refresh",
        () => {
          window.location.reload();
        },
        "refresh",
      );
    }
    if (copy.showSignOut) {
      renderSignOut(mount, deps.onSignOut);
    }
    if (copy.showSupport) {
      const support = mount.ownerDocument.createElement("p");
      support.className = "shell-small";
      support.textContent =
        "Contact support at teachers@lyfelabz.example with your email address.";
      mount.appendChild(support);
    }
  };

// -----------------------------------------------------------------------------
// Loading surface (shared indicator inside the shell)
// -----------------------------------------------------------------------------

export function renderLoadingSurface(mount: HTMLElement): void {
  clear(mount);
  renderHeader(mount);
  renderLoadingIndicator(mount, "Loading your account");
}

export type { RouteSurface } from "../router";
