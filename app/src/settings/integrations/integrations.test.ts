/**
 * @jest-environment jsdom
 */
import { renderIntegrationsSurface } from "./integrations";
import type {
  IntegrationsCallables,
  IntegrationsConnection,
  IntegrationsDeps,
  IntegrationsProvider,
} from "./types";

// Sprint 24B Phase 1: Settings > Integrations is narrowed to account-
// level connection management only. Every class-workflow control has
// moved to the Classes surface.

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

const mkMount = (): HTMLElement => {
  const div = document.createElement("div");
  document.body.appendChild(div);
  return div;
};

const googleProvider: IntegrationsProvider = Object.freeze({
  providerId: "googleClassroom",
  displayName: "Google Classroom",
});

const activeConnection: IntegrationsConnection = Object.freeze({
  connectionId: "conn-1",
  providerId: "googleClassroom",
  status: "active",
  scopes: Object.freeze([]),
});

function makeDeps(
  overrides: Partial<IntegrationsCallables> = {},
): IntegrationsDeps {
  const base: IntegrationsCallables = {
    listProviders: async () => Object.freeze([googleProvider]),
    describeConnections: async () => Object.freeze([activeConnection]),
    beginConnection: async () => ({ authorizationUrl: "", state: "" }),
    completeConnection: async () => ({
      connectionId: "",
      alreadyConnected: false,
    }),
    disconnect: async () => ({ alreadyRevoked: false }),
    discoverClasses: async () => Object.freeze([]),
    importClass: async () => ({
      linkId: "",
      classId: "",
      lmsClassId: "",
      alreadyLinked: false,
    }),
    listClassTopics: async () => Object.freeze([]),
    refreshClass: async () =>
      Object.freeze({
        linkId: "",
        classId: "",
        lmsClassId: "",
        providerId: "googleClassroom",
        status: "healthy" as const,
        changed: false,
      }),
    publishAssignment: async () =>
      Object.freeze({ publicationId: "", status: "succeeded" as const }),
    ...overrides,
  };
  return {
    callables: base,
    openOAuth: async () => ({ code: "", state: "" }),
    listTeacherClasses: async () => Object.freeze([]),
    redirectUri: "https://example.test/app/lms-callback.html",
  };
}

describe("Sprint 24B Phase 1: Settings > Integrations account-level scope", () => {
  test("exposes no class-workflow controls when a connection is active", async () => {
    const mount = mkMount();
    renderIntegrationsSurface(mount, makeDeps(), { onExit: () => undefined });
    await flush();
    await flush();

    // Class-workflow controls that used to live in Settings must be
    // absent. Each testid was owned by a Phase 1-removed control.
    expect(
      mount.querySelector("[data-testid=integrations-import-googleClassroom]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-import-panel]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-imported-classes]"),
    ).toBeNull();
    expect(mount.querySelector("[data-testid=integrations-candidates]")).toBeNull();

    // Account-level controls that Settings still owns.
    expect(
      mount.querySelector("[data-testid=integrations-disconnect-googleClassroom]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-status-googleClassroom]"),
    ).not.toBeNull();

    // Transitional guidance sentence pointing teachers to Classes.
    // Blueprint §3.4 authorizes plain-language guidance as an option
    // because no URL-addressable Integrations deep link exists. The
    // sentence is intentionally not a redirect: it performs no
    // navigation, only informs.
    const guidance = mount.querySelector<HTMLElement>(
      "[data-testid=integrations-classes-guidance]",
    );
    expect(guidance).not.toBeNull();
    expect(guidance!.textContent).toMatch(/Classes/);
    // The prior redirect testid must not linger.
    expect(
      mount.querySelector("[data-testid=integrations-classes-redirect]"),
    ).toBeNull();
  });

  test("account-level capability matrix: connected row exposes exactly Status and Disconnect", async () => {
    // Blueprint §3.2 restricts Settings > Integrations to account-level
    // connection management. The certified describeConnections response
    // exposes connectionId, providerId, status, and scopes; the account
    // email and last successful synchronization timestamp are not in the
    // certified client contract and cannot be rendered in Phase 1
    // without expanding the callable shape (Preservation Mode +
    // Blueprint §4.1 forbid that here). This test locks the account-
    // level surface to exactly the controls the certified contract can
    // support today.
    const mount = mkMount();
    renderIntegrationsSurface(mount, makeDeps(), { onExit: () => undefined });
    await flush();
    await flush();

    // Connection status pill and Disconnect action are present.
    expect(
      mount.querySelector("[data-testid=integrations-status-googleClassroom]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-disconnect-googleClassroom]"),
    ).not.toBeNull();

    // Class-workflow controls that were previously here must be absent.
    expect(
      mount.querySelector("[data-testid=integrations-imported-classes]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-imported-refresh]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-import-panel]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-link-health]"),
    ).toBeNull();
  });

  test("Reconnect entry point today is the Connect action, which the certified OAuth pair drives", async () => {
    // Blueprint §3.2 names Reconnect as an account-level action. Today
    // "Reconnect" and "Connect" are the same DOM control: it invokes
    // lmsConnectionsBegin + lmsConnectionsComplete. It is only rendered
    // when no active connection exists. Blueprint §4.4/§5 introduce a
    // distinct expiredRefresh status pill and a Reconnect label in
    // Phase 5, at which point the callable contract will surface the
    // status. In Phase 1 the same DOM affordance covers both scenarios.
    const mount = mkMount();
    renderIntegrationsSurface(
      mount,
      makeDeps({ describeConnections: async () => Object.freeze([]) }),
      { onExit: () => undefined },
    );
    await flush();
    await flush();
    const connect = mount.querySelector<HTMLButtonElement>(
      "[data-testid=integrations-connect-googleClassroom]",
    );
    expect(connect).not.toBeNull();
    expect(connect!.textContent).toMatch(/Connect Google Classroom/);
  });

  test("shows Connect action and no import affordance when disconnected", async () => {
    const mount = mkMount();
    renderIntegrationsSurface(
      mount,
      makeDeps({ describeConnections: async () => Object.freeze([]) }),
      { onExit: () => undefined },
    );
    await flush();
    await flush();

    expect(
      mount.querySelector("[data-testid=integrations-connect-googleClassroom]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-import-googleClassroom]"),
    ).toBeNull();
  });

  // Sprint 26 Phase 4 (definition §7.F). The Settings reconnect dead-end is
  // removed by an "action needed" state driven only by a session-local
  // signal LyfeLabz actually observed. These tests cover the state matrix and
  // the non-destructive reconnect action.
  test("active connection with a known recovery condition shows action-needed and a Reconnect action", async () => {
    const mount = mkMount();
    const deps: IntegrationsDeps = {
      ...makeDeps(),
      connectionRecovery: {
        needsReconnect: () => true,
        clear: () => undefined,
      },
    };
    renderIntegrationsSurface(mount, deps, { onExit: () => undefined });
    await flush();
    await flush();

    const status = mount.querySelector<HTMLElement>(
      "[data-testid=integrations-status-googleClassroom]",
    );
    expect(status).not.toBeNull();
    expect(status!.textContent).toBe("Connected, action needed");
    expect(status!.className).toMatch(/shell-integrations-pill-attention/);

    // A real recovery control exists (the removed dead-end), and Disconnect
    // remains available as the secondary action.
    expect(
      mount.querySelector("[data-testid=integrations-reconnect-googleClassroom]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-disconnect-googleClassroom]"),
    ).not.toBeNull();

    // Calm recovery explainer, no raw code / OAuth term / account identifier.
    const recovery = mount.querySelector<HTMLElement>(
      "[data-testid=integrations-recovery-googleClassroom]",
    );
    expect(recovery).not.toBeNull();
    expect(recovery!.textContent).toMatch(/Reconnect/);
    expect(recovery!.textContent).not.toMatch(
      /token|scope|OAuth|identity|lms\./i,
    );
  });

  test("active connection with no known problem stays plain Connected with no Reconnect action", async () => {
    const mount = mkMount();
    const deps: IntegrationsDeps = {
      ...makeDeps(),
      connectionRecovery: {
        needsReconnect: () => false,
        clear: () => undefined,
      },
    };
    renderIntegrationsSurface(mount, deps, { onExit: () => undefined });
    await flush();
    await flush();

    const status = mount.querySelector<HTMLElement>(
      "[data-testid=integrations-status-googleClassroom]",
    );
    expect(status!.textContent).toBe("Connected");
    expect(status!.className).toMatch(/shell-pill-verified/);
    expect(
      mount.querySelector("[data-testid=integrations-reconnect-googleClassroom]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-recovery-googleClassroom]"),
    ).toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-disconnect-googleClassroom]"),
    ).not.toBeNull();
  });

  test("no recovery seam wired: connected row is unchanged (backward compatible)", async () => {
    const mount = mkMount();
    renderIntegrationsSurface(mount, makeDeps(), { onExit: () => undefined });
    await flush();
    await flush();
    const status = mount.querySelector<HTMLElement>(
      "[data-testid=integrations-status-googleClassroom]",
    );
    expect(status!.textContent).toBe("Connected");
    expect(
      mount.querySelector("[data-testid=integrations-reconnect-googleClassroom]"),
    ).toBeNull();
  });

  test("a not-connected provider never shows action-needed even if the signal is armed", async () => {
    const mount = mkMount();
    const deps: IntegrationsDeps = {
      ...makeDeps({ describeConnections: async () => Object.freeze([]) }),
      connectionRecovery: {
        needsReconnect: () => true,
        clear: () => undefined,
      },
    };
    renderIntegrationsSurface(mount, deps, { onExit: () => undefined });
    await flush();
    await flush();
    const status = mount.querySelector<HTMLElement>(
      "[data-testid=integrations-status-googleClassroom]",
    );
    expect(status!.textContent).toBe("Not connected");
    expect(
      mount.querySelector("[data-testid=integrations-connect-googleClassroom]"),
    ).not.toBeNull();
    expect(
      mount.querySelector("[data-testid=integrations-reconnect-googleClassroom]"),
    ).toBeNull();
  });

  test("Reconnect reuses the connect flow, never disconnects first, and clears the signal on success", async () => {
    const calls: string[] = [];
    const cleared: string[] = [];
    const beginInputs: Array<Record<string, unknown>> = [];
    const deps: IntegrationsDeps = {
      ...makeDeps({
        beginConnection: async (input) => {
          calls.push("begin");
          beginInputs.push(input as Record<string, unknown>);
          return { authorizationUrl: "https://consent.test/a", state: "st" };
        },
        completeConnection: async () => {
          calls.push("complete");
          return { connectionId: "conn-1", alreadyConnected: false };
        },
        disconnect: async () => {
          calls.push("disconnect");
          return { alreadyRevoked: false };
        },
      }),
      openOAuth: async () => {
        calls.push("oauth");
        return { code: "c", state: "st" };
      },
      connectionRecovery: {
        needsReconnect: () => true,
        clear: (providerId) => cleared.push(providerId),
      },
    };
    const mount = mkMount();
    renderIntegrationsSurface(mount, deps, { onExit: () => undefined });
    await flush();
    await flush();

    const reconnect = mount.querySelector<HTMLButtonElement>(
      "[data-testid=integrations-reconnect-googleClassroom]",
    );
    expect(reconnect).not.toBeNull();
    reconnect!.click();
    await flush();
    await flush();
    await flush();

    // The certified connect pair ran; no disconnect was issued first.
    expect(calls).toEqual(["begin", "oauth", "complete"]);
    // The session-local signal was cleared for this provider.
    expect(cleared).toEqual(["googleClassroom"]);
    // Sprint 26 certification follow-up: Reconnect must carry the explicit
    // reconnect signal so completion actually replaces the unusable
    // credential instead of taking the idempotent duplicate-connect early
    // return. Without this flag the button was a no-op for an active-but-
    // unusable connection.
    expect(beginInputs).toHaveLength(1);
    expect(beginInputs[0]).toMatchObject({
      providerId: "googleClassroom",
      reconnect: true,
    });
    expect(beginInputs[0]).not.toHaveProperty("capability");
  });

  test("plain Connect does not carry the reconnect signal", async () => {
    const beginInputs: Array<Record<string, unknown>> = [];
    const deps: IntegrationsDeps = {
      ...makeDeps({
        describeConnections: async () => Object.freeze([]),
        beginConnection: async (input) => {
          beginInputs.push(input as Record<string, unknown>);
          return { authorizationUrl: "https://consent.test/a", state: "st" };
        },
        completeConnection: async () => ({
          connectionId: "conn-1",
          alreadyConnected: false,
        }),
      }),
      openOAuth: async () => ({ code: "c", state: "st" }),
    };
    const mount = mkMount();
    renderIntegrationsSurface(mount, deps, { onExit: () => undefined });
    await flush();
    await flush();

    const connect = mount.querySelector<HTMLButtonElement>(
      "[data-testid=integrations-connect-googleClassroom]",
    );
    expect(connect).not.toBeNull();
    connect!.click();
    await flush();
    await flush();
    await flush();

    expect(beginInputs).toHaveLength(1);
    expect(beginInputs[0]).not.toHaveProperty("reconnect");
  });

  test("never invokes discoverClasses, importClass, or refreshClass during load or connect flow", async () => {
    const calls: string[] = [];
    const spyDeps = makeDeps({
      discoverClasses: async () => {
        calls.push("discover");
        return Object.freeze([]);
      },
      importClass: async () => {
        calls.push("import");
        return {
          linkId: "",
          classId: "",
          lmsClassId: "",
          alreadyLinked: false,
        };
      },
      refreshClass: async () => {
        calls.push("refresh");
        return Object.freeze({
          linkId: "",
          classId: "",
          lmsClassId: "",
          providerId: "googleClassroom",
          status: "healthy" as const,
          changed: false,
        });
      },
    });
    const mount = mkMount();
    renderIntegrationsSurface(mount, spyDeps, { onExit: () => undefined });
    await flush();
    await flush();
    expect(calls).toEqual([]);
  });
});
