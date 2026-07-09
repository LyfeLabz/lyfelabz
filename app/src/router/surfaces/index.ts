import type { RouteSurface } from "../router";
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
};

// -----------------------------------------------------------------------------
// Signed-out
// -----------------------------------------------------------------------------

export const makeSignedOutSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (_session, mount) => {
    renderHeader(mount);
    renderHeadline(mount, "Sign in to your teacher account.");
    renderParagraph(
      mount,
      "Teachers sign in with a Google account to reach the LyfeLabz teacher platform. Students should continue using the public lessons and do not need to sign in.",
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
    mountTeacherShell(session, mount, { onSignOut: deps.onSignOut });
  };

// -----------------------------------------------------------------------------
// Active student stub
// -----------------------------------------------------------------------------

export const makeActiveStudentSurface =
  (deps: SurfaceDeps): RouteSurface =>
  (_session, mount) => {
    renderHeader(mount);
    renderHeadline(mount, "You are signed in as a student.");
    renderParagraph(mount, "Return to lessons to keep learning.");
    renderReturnLink(mount);
    renderSignOut(mount, deps.onSignOut);
  };

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
