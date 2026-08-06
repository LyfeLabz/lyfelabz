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
