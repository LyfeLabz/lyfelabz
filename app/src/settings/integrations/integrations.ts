import type {
  IntegrationsConnection,
  IntegrationsDeps,
  IntegrationsProvider,
} from "./types";

// Teacher Integrations surface, Settings > Integrations.
//
// Sprint 24B Phase 1 narrows this surface to account-level connection
// management only, per SPRINT_24B_ARCHITECTURAL_BLUEPRINT.md §3.2 and
// §4.1. Every class-workflow control (Import a class, course picker,
// Imported classes list, per-link refresh) has been relocated to the
// Classes surface, which is now the single teacher entry point for
// class creation and class import.
//
// This surface retains only:
//   - provider listing
//   - Google Classroom connection workflow (begin, complete) - the
//     Reconnect / Connect action
//   - connection status (describe)
//   - disconnect
//   - loading, empty, error, and provider-unavailable states
//
// The surface consumes only the certified callable surface and is a
// pure DOM builder: it opens no Firestore listener, imports no
// firebase/* module, and holds no OAuth token material. The
// `importClass`, `refreshClass`, `discoverClasses`, `listClassTopics`,
// and `publishAssignment` callables on IntegrationsCallables remain
// available for other surfaces (Assign Experience, and future Classes
// surface orchestration in Phase 2); Settings > Integrations no longer
// calls any of them.

type ViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly providers: readonly IntegrationsProvider[];
      readonly connections: readonly IntegrationsConnection[];
    };

type Notice =
  | { readonly kind: "info"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }
  | null;

export type IntegrationsRenderOptions = {
  readonly onExit: () => void;
};

export function renderIntegrationsSurface(
  mount: HTMLElement,
  deps: IntegrationsDeps,
  opts: IntegrationsRenderOptions,
): void {
  const doc = mount.ownerDocument;

  let state: ViewState = { kind: "loading" };
  let notice: Notice = null;

  const container = doc.createElement("div");
  container.className = "shell-integrations";
  container.setAttribute("data-testid", "integrations-surface");
  mount.appendChild(container);

  const render = (): void => {
    container.textContent = "";

    const back = doc.createElement("button");
    back.type = "button";
    back.className = "shell-nav-button shell-integrations-back";
    back.setAttribute("data-testid", "integrations-back");
    back.textContent = "← Back to Settings";
    back.addEventListener("click", () => opts.onExit());
    container.appendChild(back);

    const headline = doc.createElement("h2");
    headline.id = "surface-headline";
    headline.className = "shell-welcome";
    headline.tabIndex = -1;
    headline.setAttribute("data-testid", "surface-headline");
    headline.textContent = "Integrations";
    container.appendChild(headline);
    try {
      headline.focus({ preventScroll: true });
    } catch {
      // ignored
    }

    const intro = doc.createElement("p");
    intro.className = "shell-status";
    intro.setAttribute("data-testid", "integrations-intro");
    intro.textContent =
      "Integrations is where you manage the accounts LyfeLabz connects to. Class creation and Google Classroom class import now live on your Classes surface.";
    container.appendChild(intro);

    // Sprint 24B §3.4: no URL-addressable Integrations deep link exists
    // and no persistent legacy entry point routes teachers here for a
    // class workflow, so no actionable redirect target exists to wire.
    // The transitional affordance is plain-language guidance, per the
    // blueprint's second authorized option. It is intentionally not
    // labeled a redirect because it performs no navigation.
    const guidance = doc.createElement("p");
    guidance.className = "shell-status shell-integrations-guidance";
    guidance.setAttribute("data-testid", "integrations-classes-guidance");
    guidance.textContent =
      "To import a class from Google Classroom or to create a LyfeLabz class, open Classes from the left-side navigation.";
    container.appendChild(guidance);

    if (notice) renderNotice(container, notice);

    switch (state.kind) {
      case "loading":
        renderLoading(container);
        break;
      case "unavailable":
        renderUnavailable(container, state.message);
        break;
      case "ready":
        renderReady(container, state.providers, state.connections);
        break;
    }
  };

  const renderNotice = (
    parent: HTMLElement,
    n: Exclude<Notice, null>,
  ): void => {
    const el = doc.createElement("p");
    el.className =
      n.kind === "error" ? "shell-integrations-error" : "shell-integrations-info";
    el.setAttribute(
      "data-testid",
      n.kind === "error" ? "integrations-error" : "integrations-info",
    );
    el.setAttribute("role", n.kind === "error" ? "alert" : "status");
    el.textContent = n.message;
    parent.appendChild(el);
  };

  const renderLoading = (parent: HTMLElement): void => {
    const p = doc.createElement("p");
    p.className = "shell-status";
    p.setAttribute("data-testid", "integrations-loading");
    p.setAttribute("role", "status");
    p.textContent = "Loading integrations...";
    parent.appendChild(p);
  };

  const renderUnavailable = (parent: HTMLElement, message: string): void => {
    const card = doc.createElement("section");
    card.className = "shell-card";
    card.setAttribute("data-testid", "integrations-unavailable");
    const h3 = doc.createElement("h3");
    h3.textContent = "Integrations are not available right now";
    h3.className = "shell-integrations-heading";
    card.appendChild(h3);
    const body = doc.createElement("p");
    body.className = "shell-status";
    body.textContent = message;
    card.appendChild(body);
    parent.appendChild(card);
  };

  const renderReady = (
    parent: HTMLElement,
    providers: readonly IntegrationsProvider[],
    connections: readonly IntegrationsConnection[],
  ): void => {
    if (providers.length === 0) {
      const empty = doc.createElement("p");
      empty.className = "shell-status";
      empty.setAttribute("data-testid", "integrations-empty");
      empty.textContent =
        "No integrations are registered yet. Check back after your school administrator enables one.";
      parent.appendChild(empty);
      return;
    }

    const list = doc.createElement("ul");
    list.className = "shell-integrations-list";
    list.setAttribute("data-testid", "integrations-providers");
    list.setAttribute("aria-label", "Available integrations");

    for (const provider of providers) {
      const connection = connections.find(
        (c) => c.providerId === provider.providerId && c.status === "active",
      );
      list.appendChild(renderProviderRow(provider, connection ?? null));
    }
    parent.appendChild(list);
  };

  const renderProviderRow = (
    provider: IntegrationsProvider,
    active: IntegrationsConnection | null,
  ): HTMLElement => {
    // Sprint 26 Phase 4 (definition §7.F). "Action needed" is derived only
    // from a condition LyfeLabz has actually observed this session (a
    // publication that found the connection unusable). It is never a
    // speculative health probe, and it applies only to a connection that is
    // still active - a revoked connection already renders "Not connected"
    // with a Connect action, which is itself a usable recovery path.
    const needsReconnect =
      active !== null &&
      (deps.connectionRecovery?.needsReconnect(provider.providerId) ?? false);

    const li = doc.createElement("li");
    li.className = "shell-card shell-integrations-row";
    li.setAttribute(
      "data-testid",
      `integrations-provider-${provider.providerId}`,
    );

    const header = doc.createElement("div");
    header.className = "shell-integrations-row-header";

    const title = doc.createElement("h3");
    title.className = "shell-integrations-heading";
    title.textContent = provider.displayName;
    header.appendChild(title);

    const status = doc.createElement("span");
    status.className = !active
      ? "shell-pill shell-integrations-pill-inactive"
      : needsReconnect
        ? "shell-pill shell-integrations-pill-attention"
        : "shell-pill shell-pill-verified";
    status.setAttribute(
      "data-testid",
      `integrations-status-${provider.providerId}`,
    );
    status.textContent = !active
      ? "Not connected"
      : needsReconnect
        ? "Connected, action needed"
        : "Connected";
    header.appendChild(status);
    li.appendChild(header);

    const description = doc.createElement("p");
    description.className = "shell-status";
    description.textContent = describeProvider(provider.providerId);
    li.appendChild(description);

    // Calm recovery explainer, shown only when LyfeLabz knows action is
    // needed. Plain language, no OAuth term, no account identifier, and no
    // implication of data loss - the teacher's assignments are unaffected.
    if (needsReconnect) {
      const recovery = doc.createElement("p");
      recovery.className = "shell-status shell-integrations-recovery";
      recovery.setAttribute(
        "data-testid",
        `integrations-recovery-${provider.providerId}`,
      );
      recovery.setAttribute("role", "status");
      recovery.textContent =
        "Reconnect to keep assigning to your Google Classroom classes. Your LyfeLabz assignments are safe.";
      li.appendChild(recovery);
    }

    const actions = doc.createElement("div");
    actions.className = "shell-integrations-actions";

    if (!active) {
      const connectBtn = doc.createElement("button");
      connectBtn.type = "button";
      connectBtn.className = "shell-lesson-toggle shell-lesson-toggle-active";
      connectBtn.setAttribute(
        "data-testid",
        `integrations-connect-${provider.providerId}`,
      );
      connectBtn.textContent = `Connect ${provider.displayName}`;
      connectBtn.addEventListener("click", () => {
        void onConnect(provider);
      });
      actions.appendChild(connectBtn);
    } else {
      // Reconnect is the primary recovery action, offered only in the
      // action-needed state so a healthy connection is not cluttered with a
      // maintenance control. It reuses the certified connect flow and never
      // disconnects first, so the durable connection is preserved if the
      // teacher abandons the reauthorization (definition §7.F, §9).
      if (needsReconnect) {
        const reconnectBtn = doc.createElement("button");
        reconnectBtn.type = "button";
        reconnectBtn.className = "shell-lesson-toggle shell-lesson-toggle-active";
        reconnectBtn.setAttribute(
          "data-testid",
          `integrations-reconnect-${provider.providerId}`,
        );
        reconnectBtn.textContent = "Reconnect";
        reconnectBtn.addEventListener("click", () => {
          void onReconnect(provider);
        });
        actions.appendChild(reconnectBtn);
      }

      const disconnectBtn = doc.createElement("button");
      disconnectBtn.type = "button";
      disconnectBtn.className = "shell-lesson-toggle shell-lesson-toggle-inactive";
      disconnectBtn.setAttribute(
        "data-testid",
        `integrations-disconnect-${provider.providerId}`,
      );
      disconnectBtn.textContent = "Disconnect";
      disconnectBtn.addEventListener("click", () => {
        void onDisconnect(active);
      });
      actions.appendChild(disconnectBtn);
    }

    li.appendChild(actions);
    return li;
  };

  // -------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------

  const load = async (): Promise<void> => {
    state = { kind: "loading" };
    notice = null;
    render();
    try {
      const [providers, connections] = await Promise.all([
        deps.callables.listProviders(),
        deps.callables.describeConnections(),
      ]);
      state = {
        kind: "ready",
        providers,
        connections,
      };
    } catch (err) {
      state = { kind: "unavailable", message: describeLoadError(err) };
    }
    render();
  };

  const onConnect = async (provider: IntegrationsProvider): Promise<void> => {
    notice = { kind: "info", message: `Opening ${provider.displayName}...` };
    render();
    try {
      const begin = await deps.callables.beginConnection({
        providerId: provider.providerId,
        redirectUri: deps.redirectUri,
      });
      const handoff = await deps.openOAuth({
        authorizationUrl: begin.authorizationUrl,
        redirectUri: deps.redirectUri,
        expectedState: begin.state,
      });
      await deps.callables.completeConnection({
        providerId: provider.providerId,
        code: handoff.code,
        state: handoff.state,
        redirectUri: deps.redirectUri,
      });
      notice = {
        kind: "info",
        message: `${provider.displayName} is now connected.`,
      };
      await refreshAfterMutation();
    } catch (err) {
      notice = { kind: "error", message: describeConnectError(err, provider) };
      render();
    }
  };

  // Sprint 26 Phase 4 (definition §7.F, §9), corrected by the Sprint 26
  // certification follow-up. Recovery reauthorization for a connection
  // LyfeLabz has observed to be unusable this session. It reuses the
  // certified begin/complete connect flow with the initial scope set and
  // never disconnects first, so the existing durable connection is preserved
  // if the teacher abandons the reauthorization. The `reconnect: true` signal
  // binds the explicit "reconnect" OAuth intent so completion actually
  // replaces the unusable credential on the active connection instead of
  // taking the idempotent duplicate-connect early return (which is what made
  // the earlier Reconnect action a no-op for an active-but-unusable
  // connection). On success the session-local "action needed" signal is
  // cleared so the row returns to plain "Connected".
  const onReconnect = async (
    provider: IntegrationsProvider,
  ): Promise<void> => {
    notice = { kind: "info", message: `Reconnecting ${provider.displayName}...` };
    render();
    try {
      const begin = await deps.callables.beginConnection({
        providerId: provider.providerId,
        redirectUri: deps.redirectUri,
        reconnect: true,
      });
      const handoff = await deps.openOAuth({
        authorizationUrl: begin.authorizationUrl,
        redirectUri: deps.redirectUri,
        expectedState: begin.state,
      });
      await deps.callables.completeConnection({
        providerId: provider.providerId,
        code: handoff.code,
        state: handoff.state,
        redirectUri: deps.redirectUri,
      });
      deps.connectionRecovery?.clear(provider.providerId);
      notice = {
        kind: "info",
        message: `${provider.displayName} is reconnected.`,
      };
      await refreshAfterMutation();
    } catch (err) {
      notice = { kind: "error", message: describeConnectError(err, provider) };
      render();
    }
  };

  const onDisconnect = async (
    connection: IntegrationsConnection,
  ): Promise<void> => {
    notice = { kind: "info", message: "Disconnecting..." };
    render();
    try {
      await deps.callables.disconnect({ connectionId: connection.connectionId });
      notice = {
        kind: "info",
        message: "Disconnected. Your LyfeLabz data is preserved.",
      };
      await refreshAfterMutation();
    } catch (err) {
      notice = { kind: "error", message: describeGenericError(err) };
      render();
    }
  };

  const refreshAfterMutation = async (): Promise<void> => {
    try {
      const [providers, connections] = await Promise.all([
        deps.callables.listProviders(),
        deps.callables.describeConnections(),
      ]);
      state = {
        kind: "ready",
        providers,
        connections,
      };
    } catch (err) {
      state = { kind: "unavailable", message: describeLoadError(err) };
    }
    render();
  };

  render();
  void load();
}

// -----------------------------------------------------------------------------
// Copy helpers
// -----------------------------------------------------------------------------

function describeProvider(providerId: string): string {
  switch (providerId) {
    case "googleClassroom":
      return "Keep your Google Classroom account connected so you can import classes from the Classes surface. Your rosters, streams, and comments in Google Classroom are never modified.";
    default:
      return "Connect this integration so it stays available to the workflows that use it.";
  }
}

function extractCode(err: unknown): string {
  if (err && typeof err === "object" && "code" in err) {
    return String((err as { code?: unknown }).code ?? "");
  }
  return "";
}

function describeLoadError(err: unknown): string {
  const code = extractCode(err);
  if (
    code.includes("unauthenticated") ||
    code.includes("permission-denied") ||
    code.includes("forbidden")
  ) {
    return "Integrations are only available to a verified teacher on your account. Sign out and back in to refresh your session.";
  }
  if (code.includes("unavailable") || code.includes("network")) {
    return "We could not reach LyfeLabz just now. Check your connection and try again in a moment.";
  }
  return "Integrations are being prepared and are not available yet. Check back after your school administrator finishes setting them up.";
}

function describeConnectError(
  err: unknown,
  provider: IntegrationsProvider,
): string {
  const code = extractCode(err);
  if (code.includes("cancelled") || code.includes("cancel")) {
    return "Connection was cancelled. Try again whenever you are ready.";
  }
  if (code.includes("state") || code.includes("csrf")) {
    return "The Google sign-in did not match the request LyfeLabz opened. Try connecting again.";
  }
  if (code.includes("popup")) {
    return "Your browser blocked the sign-in window. Allow pop-ups for LyfeLabz and try again.";
  }
  if (code.includes("unavailable") || code.includes("network")) {
    return `We could not reach ${provider.displayName}. Try again in a moment.`;
  }
  if (code.includes("unknownProvider")) {
    return `${provider.displayName} is not yet available. Check back after your school administrator enables it.`;
  }
  return `We could not connect ${provider.displayName} just now. Try again in a moment.`;
}

function describeGenericError(err: unknown): string {
  const code = extractCode(err);
  if (code.includes("unavailable") || code.includes("network")) {
    return "We could not reach LyfeLabz just now. Try again in a moment.";
  }
  return "Something did not work. Try again in a moment.";
}
