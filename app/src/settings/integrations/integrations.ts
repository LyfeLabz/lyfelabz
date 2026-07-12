import type {
  IntegrationsClassHealthStatus,
  IntegrationsClassLink,
  IntegrationsConnection,
  IntegrationsDeps,
  IntegrationsLmsClass,
  IntegrationsLyfeLabzClass,
  IntegrationsProvider,
} from "./types";

// Teacher Integrations surface, Settings > Integrations, per
// LMS_EXPERIENCE.md §3 and §4. The surface consumes only the Sprint 8B
// callable surface named in LMS_INTEGRATION_ARCHITECTURE.md and is a
// pure DOM builder: it opens no Firestore listener, imports no
// firebase/* module, and holds no OAuth token material. See PDR-020c
// for the initial scope authorized by this sprint.
//
// Sprint 8C authorized capabilities:
//   - provider listing
//   - Google Classroom connection workflow (begin, complete)
//   - connection status (describe)
//   - disconnect
//   - available classroom discovery
//   - selective classroom import (links an existing LyfeLabz class to
//     the chosen LMS class per Sprint 8B's classes-import contract)
//   - loading, empty, error, and provider-unavailable states
//
// Sprint 8C explicitly excludes assignment publishing, roster sync,
// grade sync, refresh, Present Mode integration, analytics, background
// synchronization, notifications, and second-provider adapters.

type ViewState =
  | { readonly kind: "loading" }
  | { readonly kind: "unavailable"; readonly message: string }
  | {
      readonly kind: "ready";
      readonly providers: readonly IntegrationsProvider[];
      readonly connections: readonly IntegrationsConnection[];
      readonly links: readonly IntegrationsClassLink[];
      readonly teacherClasses: readonly IntegrationsLyfeLabzClass[];
      readonly healthByLinkId: ReadonlyMap<string, IntegrationsClassHealthStatus>;
      readonly refreshingLinkId: string | null;
    }
  | {
      readonly kind: "importing";
      readonly providers: readonly IntegrationsProvider[];
      readonly connections: readonly IntegrationsConnection[];
      readonly links: readonly IntegrationsClassLink[];
      readonly teacherClasses: readonly IntegrationsLyfeLabzClass[];
      readonly healthByLinkId: ReadonlyMap<string, IntegrationsClassHealthStatus>;
      readonly connectionId: string;
      readonly candidates: readonly IntegrationsLmsClass[];
      readonly targetClasses: readonly IntegrationsLyfeLabzClass[];
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
      "Connect the tools you already use so LyfeLabz slots into your workflow. Integrations are opt-in. Connecting a service never posts, messages, or grades on your behalf.";
    container.appendChild(intro);

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
        renderImportedClasses(container, state);
        break;
      case "importing":
        renderImporting(container, state);
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
    status.className = active
      ? "shell-pill shell-pill-verified"
      : "shell-pill shell-integrations-pill-inactive";
    status.setAttribute(
      "data-testid",
      `integrations-status-${provider.providerId}`,
    );
    status.textContent = active ? "Connected" : "Not connected";
    header.appendChild(status);
    li.appendChild(header);

    const description = doc.createElement("p");
    description.className = "shell-status";
    description.textContent = describeProvider(provider.providerId);
    li.appendChild(description);

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
      const importBtn = doc.createElement("button");
      importBtn.type = "button";
      importBtn.className = "shell-lesson-toggle shell-lesson-toggle-active";
      importBtn.setAttribute(
        "data-testid",
        `integrations-import-${provider.providerId}`,
      );
      importBtn.textContent = "Import a class";
      importBtn.addEventListener("click", () => {
        void onImportBegin(active);
      });
      actions.appendChild(importBtn);

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

  const renderImportedClasses = (
    parent: HTMLElement,
    s: Extract<ViewState, { kind: "ready" }>,
  ): void => {
    if (s.links.length === 0) return;
    const section = doc.createElement("section");
    section.className = "shell-card shell-integrations-imported";
    section.setAttribute("data-testid", "integrations-imported-classes");

    const h3 = doc.createElement("h3");
    h3.className = "shell-integrations-heading";
    h3.textContent = "Imported classes";
    section.appendChild(h3);

    const intro = doc.createElement("p");
    intro.className = "shell-status";
    intro.textContent =
      "Refresh a class to check that LyfeLabz can still reach it. Refresh runs on demand. LyfeLabz never modifies your Google Classroom roster, stream, or comments.";
    section.appendChild(intro);

    const list = doc.createElement("ul");
    list.className = "shell-integrations-imported-list";
    list.setAttribute("aria-label", "Imported classes");

    const classById = new Map<string, IntegrationsLyfeLabzClass>();
    for (const c of s.teacherClasses) classById.set(c.id, c);

    for (const link of s.links) {
      list.appendChild(renderImportedRow(link, classById.get(link.classId) ?? null, s));
    }
    section.appendChild(list);
    parent.appendChild(section);
  };

  const renderImportedRow = (
    link: IntegrationsClassLink,
    lyfelabzClass: IntegrationsLyfeLabzClass | null,
    s: Extract<ViewState, { kind: "ready" }>,
  ): HTMLElement => {
    const li = doc.createElement("li");
    li.className = "shell-integrations-imported-row";
    li.setAttribute("data-testid", `integrations-imported-${link.linkId}`);

    const label = doc.createElement("div");
    label.className = "shell-integrations-imported-label";
    const name = doc.createElement("p");
    name.className = "shell-integrations-candidate-name";
    name.textContent = lyfelabzClass
      ? lyfelabzClass.title
      : "LyfeLabz class no longer available";
    label.appendChild(name);
    if (lyfelabzClass) {
      const grade = doc.createElement("p");
      grade.className = "shell-integrations-candidate-section";
      grade.textContent = `Grade ${lyfelabzClass.grade}`;
      label.appendChild(grade);
    }
    li.appendChild(label);

    const health = s.healthByLinkId.get(link.linkId) ?? null;
    const badge = doc.createElement("span");
    badge.className = `shell-pill ${healthPillClass(health)}`;
    badge.setAttribute(
      "data-testid",
      `integrations-imported-health-${link.linkId}`,
    );
    badge.setAttribute("role", "status");
    badge.textContent = healthPillLabel(health);
    li.appendChild(badge);

    if (health !== null) {
      const guidance = doc.createElement("p");
      guidance.className = "shell-status shell-integrations-imported-guidance";
      guidance.setAttribute(
        "data-testid",
        `integrations-imported-guidance-${link.linkId}`,
      );
      guidance.textContent = healthGuidance(health);
      li.appendChild(guidance);
    }

    const controls = doc.createElement("div");
    controls.className = "shell-integrations-imported-controls";

    const refreshBtn = doc.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "shell-lesson-toggle shell-lesson-toggle-active";
    refreshBtn.setAttribute(
      "data-testid",
      `integrations-refresh-${link.linkId}`,
    );
    const busy = s.refreshingLinkId === link.linkId;
    refreshBtn.disabled = busy;
    refreshBtn.textContent = busy ? "Checking..." : "Refresh";
    refreshBtn.addEventListener("click", () => {
      void onRefreshLink(link);
    });
    controls.appendChild(refreshBtn);
    li.appendChild(controls);
    return li;
  };

  const renderImporting = (
    parent: HTMLElement,
    s: Extract<ViewState, { kind: "importing" }>,
  ): void => {
    const card = doc.createElement("section");
    card.className = "shell-card";
    card.setAttribute("data-testid", "integrations-import-panel");

    const h3 = doc.createElement("h3");
    h3.className = "shell-integrations-heading";
    h3.textContent = "Import a class from Google Classroom";
    card.appendChild(h3);

    const explain = doc.createElement("p");
    explain.className = "shell-status";
    explain.textContent =
      "Choose the LyfeLabz class you want to link to a class you already teach in Google Classroom. Importing does not send any message to your students.";
    card.appendChild(explain);

    if (s.candidates.length === 0) {
      const empty = doc.createElement("p");
      empty.className = "shell-integrations-empty";
      empty.setAttribute("data-testid", "integrations-import-empty");
      empty.textContent =
        "Google Classroom did not return any classes you teach. Check that you are the teacher of at least one active class in Google Classroom.";
      card.appendChild(empty);
    } else if (s.targetClasses.length === 0) {
      const empty = doc.createElement("p");
      empty.className = "shell-integrations-empty";
      empty.setAttribute("data-testid", "integrations-import-no-target");
      empty.textContent =
        "Create a LyfeLabz class first from your Classes surface. Only an existing active LyfeLabz class can be linked to a Google Classroom class.";
      card.appendChild(empty);
    } else {
      card.appendChild(renderImportTable(s));
    }

    const closeBtn = doc.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "shell-lesson-toggle shell-lesson-toggle-inactive";
    closeBtn.setAttribute("data-testid", "integrations-import-close");
    closeBtn.textContent = "Done";
    closeBtn.addEventListener("click", () => {
      state = {
        kind: "ready",
        providers: s.providers,
        connections: s.connections,
        links: s.links,
        teacherClasses: s.teacherClasses,
        healthByLinkId: s.healthByLinkId,
        refreshingLinkId: null,
      };
      // Refresh imported-class list to pick up newly linked class.
      void refreshAfterMutation();
      render();
    });
    card.appendChild(closeBtn);
    parent.appendChild(card);
  };

  const renderImportTable = (
    s: Extract<ViewState, { kind: "importing" }>,
  ): HTMLElement => {
    const list = doc.createElement("ul");
    list.className = "shell-integrations-candidates";
    list.setAttribute("data-testid", "integrations-candidates");
    list.setAttribute("aria-label", "Available Google Classroom classes");

    for (const candidate of s.candidates) {
      const li = doc.createElement("li");
      li.className = "shell-integrations-candidate";
      li.setAttribute(
        "data-testid",
        `integrations-candidate-${candidate.lmsClassId}`,
      );

      const label = doc.createElement("div");
      label.className = "shell-integrations-candidate-label";
      const name = doc.createElement("p");
      name.className = "shell-integrations-candidate-name";
      name.textContent = candidate.name;
      label.appendChild(name);
      if (candidate.section) {
        const section = doc.createElement("p");
        section.className = "shell-integrations-candidate-section";
        section.textContent = `Section ${candidate.section}`;
        label.appendChild(section);
      }
      li.appendChild(label);

      const controls = doc.createElement("div");
      controls.className = "shell-integrations-candidate-controls";

      const selectId = `integrations-target-${candidate.lmsClassId}`;
      const selLabel = doc.createElement("label");
      selLabel.className = "shell-integrations-select-label";
      selLabel.setAttribute("for", selectId);
      selLabel.textContent = "LyfeLabz class";
      controls.appendChild(selLabel);

      const select = doc.createElement("select");
      select.id = selectId;
      select.className = "shell-integrations-select";
      select.setAttribute(
        "data-testid",
        `integrations-target-${candidate.lmsClassId}`,
      );
      const placeholder = doc.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Choose a LyfeLabz class...";
      select.appendChild(placeholder);
      for (const target of s.targetClasses) {
        const opt = doc.createElement("option");
        opt.value = target.id;
        opt.textContent = `${target.title} (Grade ${target.grade})`;
        select.appendChild(opt);
      }
      controls.appendChild(select);

      const btn = doc.createElement("button");
      btn.type = "button";
      btn.className = "shell-lesson-toggle shell-lesson-toggle-active";
      btn.setAttribute(
        "data-testid",
        `integrations-import-action-${candidate.lmsClassId}`,
      );
      btn.textContent = "Link";
      btn.addEventListener("click", () => {
        const targetId = select.value;
        if (!targetId) {
          notice = {
            kind: "error",
            message: "Choose a LyfeLabz class to link to this Google Classroom class.",
          };
          render();
          return;
        }
        void onImportConfirm(s, candidate, targetId, btn);
      });
      controls.appendChild(btn);
      li.appendChild(controls);
      list.appendChild(li);
    }
    return list;
  };

  // -------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------

  const load = async (): Promise<void> => {
    state = { kind: "loading" };
    notice = null;
    render();
    try {
      const [providers, connections, links, teacherClasses] = await Promise.all([
        deps.callables.listProviders(),
        deps.callables.describeConnections(),
        deps.listClassLinks
          ? deps.listClassLinks()
          : Promise.resolve(Object.freeze<IntegrationsClassLink[]>([])),
        deps.listTeacherClasses(),
      ]);
      state = {
        kind: "ready",
        providers,
        connections,
        links,
        teacherClasses,
        healthByLinkId: new Map(),
        refreshingLinkId: null,
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

  const onImportBegin = async (
    connection: IntegrationsConnection,
  ): Promise<void> => {
    notice = { kind: "info", message: "Loading your Google Classroom classes..." };
    render();
    try {
      const [candidates, targetClasses] = await Promise.all([
        deps.callables.discoverClasses({ connectionId: connection.connectionId }),
        deps.listTeacherClasses(),
      ]);
      const providers =
        state.kind === "ready" || state.kind === "importing"
          ? state.providers
          : [];
      const connections =
        state.kind === "ready" || state.kind === "importing"
          ? state.connections
          : [];
      const links =
        state.kind === "ready" || state.kind === "importing"
          ? state.links
          : Object.freeze<IntegrationsClassLink[]>([]);
      const priorTeacherClasses =
        state.kind === "ready" || state.kind === "importing"
          ? state.teacherClasses
          : targetClasses;
      const healthByLinkId =
        state.kind === "ready" || state.kind === "importing"
          ? state.healthByLinkId
          : new Map<string, IntegrationsClassHealthStatus>();
      state = {
        kind: "importing",
        providers,
        connections,
        links,
        teacherClasses: priorTeacherClasses,
        healthByLinkId,
        connectionId: connection.connectionId,
        candidates,
        targetClasses,
      };
      notice = null;
      render();
    } catch (err) {
      notice = { kind: "error", message: describeGenericError(err) };
      render();
    }
  };

  const onImportConfirm = async (
    s: Extract<ViewState, { kind: "importing" }>,
    candidate: IntegrationsLmsClass,
    lyfelabzClassId: string,
    trigger: HTMLButtonElement,
  ): Promise<void> => {
    trigger.disabled = true;
    trigger.textContent = "Linking...";
    try {
      const result = await deps.callables.importClass({
        connectionId: s.connectionId,
        classId: lyfelabzClassId,
        lmsClassId: candidate.lmsClassId,
      });
      notice = {
        kind: "info",
        message: result.alreadyLinked
          ? `${candidate.name} is already linked to a LyfeLabz class.`
          : `${candidate.name} was linked. Open the class from your Classes surface.`,
      };
      const remaining = s.candidates.filter(
        (c) => c.lmsClassId !== candidate.lmsClassId,
      );
      state = { ...s, candidates: remaining };
      render();
    } catch (err) {
      trigger.disabled = false;
      trigger.textContent = "Link";
      notice = { kind: "error", message: describeImportError(err) };
      render();
    }
  };

  const refreshAfterMutation = async (): Promise<void> => {
    try {
      const [providers, connections, links, teacherClasses] = await Promise.all([
        deps.callables.listProviders(),
        deps.callables.describeConnections(),
        deps.listClassLinks
          ? deps.listClassLinks()
          : Promise.resolve(Object.freeze<IntegrationsClassLink[]>([])),
        deps.listTeacherClasses(),
      ]);
      const priorHealth =
        state.kind === "ready" || state.kind === "importing"
          ? state.healthByLinkId
          : new Map<string, IntegrationsClassHealthStatus>();
      state = {
        kind: "ready",
        providers,
        connections,
        links,
        teacherClasses,
        healthByLinkId: priorHealth,
        refreshingLinkId: null,
      };
    } catch (err) {
      state = { kind: "unavailable", message: describeLoadError(err) };
    }
    render();
  };

  const onRefreshLink = async (
    link: IntegrationsClassLink,
  ): Promise<void> => {
    if (state.kind !== "ready") return;
    const priorState = state;
    state = { ...priorState, refreshingLinkId: link.linkId };
    render();
    try {
      const result = await deps.callables.refreshClass({ linkId: link.linkId });
      const nextHealth = new Map(priorState.healthByLinkId);
      nextHealth.set(link.linkId, result.status);

      // If the reconciliation transitioned a link or connection, refetch
      // the underlying lists so the surface stays consistent with the
      // server view without a full page reload.
      let nextLinks = priorState.links;
      let nextConnections = priorState.connections;
      if (result.changed) {
        try {
          const [links, connections] = await Promise.all([
            deps.listClassLinks
              ? deps.listClassLinks()
              : Promise.resolve(priorState.links),
            deps.callables.describeConnections(),
          ]);
          nextLinks = links;
          nextConnections = connections;
        } catch {
          // Best-effort refetch. The health verdict from the callable is
          // still displayed even if the follow-up read is unavailable.
        }
      }

      state = {
        ...priorState,
        links: nextLinks,
        connections: nextConnections,
        healthByLinkId: nextHealth,
        refreshingLinkId: null,
      };
      notice = {
        kind: result.status === "healthy" ? "info" : "error",
        message: healthNotice(result.status),
      };
      render();
    } catch (err) {
      state = { ...priorState, refreshingLinkId: null };
      notice = { kind: "error", message: describeGenericError(err) };
      render();
    }
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
      return "Bring the classes you already teach in Google Classroom into LyfeLabz. Your rosters, streams, and comments in Google Classroom are never modified.";
    default:
      return "Connect this integration to bring existing classes into LyfeLabz.";
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

function describeImportError(err: unknown): string {
  const code = extractCode(err);
  if (code.includes("ownershipDrift")) {
    return "Google Classroom does not list you as the teacher of this class. Ask the teacher of record to add you, then try again.";
  }
  if (code.includes("alreadyLinked")) {
    return "This class is already linked. Open it from your Classes surface.";
  }
  if (code.includes("classNotActive")) {
    return "The LyfeLabz class you chose is archived. Choose an active LyfeLabz class instead.";
  }
  if (code.includes("classNotFound")) {
    return "That LyfeLabz class could not be found. Refresh the page and try again.";
  }
  return "We could not link this class right now. Try again in a moment.";
}

function describeGenericError(err: unknown): string {
  const code = extractCode(err);
  if (code.includes("unavailable") || code.includes("network")) {
    return "We could not reach LyfeLabz just now. Try again in a moment.";
  }
  return "Something did not work. Try again in a moment.";
}

// -----------------------------------------------------------------------------
// Health copy helpers (Sprint 8E)
// -----------------------------------------------------------------------------
//
// Every health string is stored beside the surface that renders it so
// the reconciliation callable never mints teacher-facing prose. The
// callable returns the neutral health enum; the client renders the
// matching plain-language label, guidance, and notice.

function healthPillLabel(status: IntegrationsClassHealthStatus | null): string {
  switch (status) {
    case null:
      return "Not checked yet";
    case "healthy":
      return "Healthy";
    case "disconnected":
      return "Disconnected";
    case "revoked":
      return "Access revoked";
    case "ownershipDrift":
      return "Ownership changed";
    case "missingUpstream":
      return "Class removed";
    case "reconnectRequired":
      return "Reconnect required";
    case "providerUnavailable":
      return "Provider unavailable";
  }
}

function healthPillClass(status: IntegrationsClassHealthStatus | null): string {
  switch (status) {
    case "healthy":
      return "shell-pill-verified";
    case null:
    case "providerUnavailable":
      return "shell-integrations-pill-inactive";
    default:
      return "shell-integrations-pill-attention";
  }
}

function healthGuidance(status: IntegrationsClassHealthStatus): string {
  switch (status) {
    case "healthy":
      return "This class is linked and reachable from Google Classroom.";
    case "disconnected":
      return "Google Classroom is no longer connected. Reconnect Google Classroom from the provider list above to keep this class linked.";
    case "revoked":
      return "Google Classroom told LyfeLabz your access was revoked. Reconnect Google Classroom to restore this class.";
    case "ownershipDrift":
      return "Google Classroom no longer lists you as the teacher of this class. Ask the teacher of record to add you back, then re-import the class.";
    case "missingUpstream":
      return "The Google Classroom class was removed or archived. Re-import a different Google Classroom class if you want to keep this LyfeLabz class linked.";
    case "reconnectRequired":
      return "This class's connection needs a fresh sign-in. Reconnect Google Classroom from the provider list above.";
    case "providerUnavailable":
      return "Google Classroom did not answer this time. Try refreshing again in a moment.";
  }
}

function healthNotice(status: IntegrationsClassHealthStatus): string {
  switch (status) {
    case "healthy":
      return "This class is healthy.";
    case "disconnected":
      return "Google Classroom is disconnected. Reconnect to restore this class.";
    case "revoked":
      return "Google Classroom access was revoked. Reconnect to restore this class.";
    case "ownershipDrift":
      return "Google Classroom no longer lists you as the teacher of this class.";
    case "missingUpstream":
      return "That Google Classroom class was removed or archived.";
    case "reconnectRequired":
      return "This class's connection needs a fresh sign-in.";
    case "providerUnavailable":
      return "Google Classroom did not answer. Try refreshing again in a moment.";
  }
}
