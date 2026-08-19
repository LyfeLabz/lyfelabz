/**
 * Sprint 25 Phase 3 - publication attempt model unit tests.
 *
 * Covers the bounded one-attempt model (implementation plan §2.1-§2.7,
 * blueprint §7-§11): per-action attempt nonce, incremental consent with a
 * single automatic re-issue, consent-loop prevention, cancellation and
 * denial handling, reconnect routing, thrown-vs-resolved error
 * normalization, multi-row consent coordination, and the session-scoped
 * retry store that backs the detail-view retry entry point.
 */
import type {
  IntegrationsCallables,
  IntegrationsDeps,
  IntegrationsPublicationOutcome,
  OAuthHandoff,
} from "../../../settings/integrations/types";
import {
  clearConnectionReconnectNeeded,
  createConsentCoordinator,
  createDetailLmsRetrySeam,
  extractThrownErrorCode,
  readConnectionReconnectNeeded,
  readLmsPublicationRetryContext,
  recordConnectionReconnectNeeded,
  recordLmsPublicationRetryContext,
  runPublicationAction,
  _resetLmsPublicationStateForTest,
  type PublicationConsentSeam,
} from "./lmsPublication";

const succeeded = (
  lmsAssignmentId = "gc-1",
): IntegrationsPublicationOutcome =>
  Object.freeze({ publicationId: "pub-1", status: "succeeded", lmsAssignmentId });

const failedWith = (errorCode: string): IntegrationsPublicationOutcome =>
  Object.freeze({ publicationId: "pub-1", status: "failed", errorCode });

const insufficient = (): IntegrationsPublicationOutcome =>
  failedWith("lms.insufficientScope");

type ConsentSpy = {
  seam: PublicationConsentSeam;
  beginCalls: number;
  completeCalls: number;
  openCalls: number;
};

const makeConsent = (
  opts: {
    openOAuth?: OAuthHandoff;
    completeConnection?: IntegrationsCallables["completeConnection"];
  } = {},
): ConsentSpy => {
  const spy: ConsentSpy = {
    beginCalls: 0,
    completeCalls: 0,
    openCalls: 0,
    seam: undefined as unknown as PublicationConsentSeam,
  };
  const defaultOpen: OAuthHandoff = async () => ({
    code: "auth-code",
    state: "st-1",
  });
  const defaultComplete: IntegrationsCallables["completeConnection"] =
    async () => ({
      connectionId: "conn-1",
      alreadyConnected: false,
      consentOutcome: "widened" as const,
    });
  const open = opts.openOAuth ?? defaultOpen;
  const complete = opts.completeConnection ?? defaultComplete;
  // Each spy counter is incremented in exactly one place (the outer wrapper)
  // so a single call is counted once regardless of the injected behavior.
  spy.seam = {
    providerId: "google-classroom",
    beginConnection: async () => {
      spy.beginCalls += 1;
      return { authorizationUrl: "https://consent.example/auth", state: "st-1" };
    },
    completeConnection: async (input) => {
      spy.completeCalls += 1;
      return complete(input);
    },
    openOAuth: async (input) => {
      spy.openCalls += 1;
      return open(input);
    },
    redirectUri: "https://app.example/app/lms-callback.html",
  };
  return spy;
};

describe("runPublicationAction - basic outcomes", () => {
  beforeEach(() => {
    _resetLmsPublicationStateForTest();
  });

  test("passes the attempt nonce on the initial publish and returns succeeded", async () => {
    const nonces: string[] = [];
    const consent = makeConsent();
    const result = await runPublicationAction({
      nonce: "nonce-A",
      publish: async (n) => {
        nonces.push(n);
        return succeeded();
      },
      consent: consent.seam,
      coordinator: createConsentCoordinator(),
    });
    expect(result.kind).toBe("succeeded");
    expect(nonces).toEqual(["nonce-A"]);
    // Ordinary publication never touches the consent machinery.
    expect(consent.beginCalls).toBe(0);
    expect(consent.openCalls).toBe(0);
    expect(consent.completeCalls).toBe(0);
  });

  test("a resolved generic failure maps to failed and offers no consent", async () => {
    const consent = makeConsent();
    const result = await runPublicationAction({
      nonce: "n",
      publish: async () => failedWith("lms.upstreamCallFailed"),
      consent: consent.seam,
      coordinator: createConsentCoordinator(),
    });
    expect(result.kind).toBe("failed");
    expect(consent.beginCalls).toBe(0);
  });

  test("provider-temporarily-unavailable resolved failure maps to failed", async () => {
    const result = await runPublicationAction({
      nonce: "n",
      publish: async () => failedWith("lms.upstreamCallFailed"),
      consent: makeConsent().seam,
      coordinator: createConsentCoordinator(),
    });
    expect(result.kind).toBe("failed");
  });
});

describe("runPublicationAction - incremental consent and single re-issue", () => {
  beforeEach(() => {
    _resetLmsPublicationStateForTest();
  });

  test("reuses the same nonce after consent and succeeds on the single re-issue", async () => {
    const nonces: string[] = [];
    let call = 0;
    const consent = makeConsent();
    const result = await runPublicationAction({
      nonce: "nonce-Z",
      publish: async (n) => {
        nonces.push(n);
        call += 1;
        return call === 1 ? insufficient() : succeeded();
      },
      consent: consent.seam,
      coordinator: createConsentCoordinator(),
    });
    expect(result.kind).toBe("succeeded");
    // Same nonce on both the initial call and the re-issue.
    expect(nonces).toEqual(["nonce-Z", "nonce-Z"]);
    // Exactly one OAuth begin, one open, one completion.
    expect(consent.beginCalls).toBe(1);
    expect(consent.openCalls).toBe(1);
    expect(consent.completeCalls).toBe(1);
  });

  test("consent cancelled: no re-issue, permission not granted, one publish call", async () => {
    let call = 0;
    const consent = makeConsent({
      openOAuth: async () => {
        const err = new Error("cancelled");
        (err as { code?: string }).code = "cancelled";
        throw err;
      },
    });
    const result = await runPublicationAction({
      nonce: "n",
      publish: async () => {
        call += 1;
        return insufficient();
      },
      consent: consent.seam,
      coordinator: createConsentCoordinator(),
    });
    expect(result.kind).toBe("permissionNotGranted");
    expect(call).toBe(1); // no automatic re-issue
    expect(consent.beginCalls).toBe(1);
    expect(consent.completeCalls).toBe(0);
  });

  test("consent denied (popup error): permission not granted, no re-issue", async () => {
    let call = 0;
    const consent = makeConsent({
      openOAuth: async () => {
        const err = new Error("access_denied");
        (err as { code?: string }).code = "access_denied";
        throw err;
      },
    });
    const result = await runPublicationAction({
      nonce: "n",
      publish: async () => {
        call += 1;
        return insufficient();
      },
      consent: consent.seam,
      coordinator: createConsentCoordinator(),
    });
    expect(result.kind).toBe("permissionNotGranted");
    expect(call).toBe(1);
  });

  test("consent completes but scope still absent: stops without reopening OAuth", async () => {
    let call = 0;
    const consent = makeConsent();
    const result = await runPublicationAction({
      nonce: "n",
      publish: async () => {
        call += 1;
        return insufficient(); // both calls insufficient
      },
      consent: consent.seam,
      coordinator: createConsentCoordinator(),
    });
    expect(result.kind).toBe("permissionNotGranted");
    // Exactly one re-issue (two publish calls total), no second OAuth.
    expect(call).toBe(2);
    expect(consent.beginCalls).toBe(1);
    expect(consent.openCalls).toBe(1);
    expect(consent.completeCalls).toBe(1);
  });

  test("re-issue that fails for a non-scope reason maps to failed", async () => {
    let call = 0;
    const result = await runPublicationAction({
      nonce: "n",
      publish: async () => {
        call += 1;
        return call === 1 ? insufficient() : failedWith("lms.upstreamCallFailed");
      },
      consent: makeConsent().seam,
      coordinator: createConsentCoordinator(),
    });
    expect(result.kind).toBe("failed");
  });
});

describe("runPublicationAction - reconnect and thrown errors", () => {
  beforeEach(() => {
    _resetLmsPublicationStateForTest();
  });

  test("resolved failure with an inactive-connection code routes to reconnect", async () => {
    const result = await runPublicationAction({
      nonce: "n",
      publish: async () => failedWith("lms.connectionNotActive"),
      consent: makeConsent().seam,
      coordinator: createConsentCoordinator(),
    });
    expect(result.kind).toBe("reconnectRequired");
  });

  test("thrown callable error with reconnect code in details routes to reconnect", async () => {
    const result = await runPublicationAction({
      nonce: "n",
      publish: async () => {
        const err = new Error("failed-precondition");
        (err as { details?: unknown }).details = { code: "lms.connectionNotFound" };
        throw err;
      },
      consent: makeConsent().seam,
      coordinator: createConsentCoordinator(),
    });
    expect(result.kind).toBe("reconnectRequired");
  });

  test("thrown generic callable error (timeout/transport) maps to failed", async () => {
    const result = await runPublicationAction({
      nonce: "n",
      publish: async () => {
        const err = new Error("deadline-exceeded");
        (err as { code?: string }).code = "deadline-exceeded";
        throw err;
      },
      consent: makeConsent().seam,
      coordinator: createConsentCoordinator(),
    });
    expect(result.kind).toBe("failed");
  });

  test("extractThrownErrorCode reads details.code and never leaks a raw payload", () => {
    expect(
      extractThrownErrorCode({ details: { code: "lms.connectionNotActive" } }),
    ).toBe("lms.connectionNotActive");
    expect(extractThrownErrorCode({ code: "lms.linkNotActive" })).toBe(
      "lms.linkNotActive",
    );
    expect(extractThrownErrorCode({ code: "internal" })).toBeUndefined();
    expect(extractThrownErrorCode(new Error("boom"))).toBeUndefined();
  });
});

// Sprint 26 Phase 4 (definition §7.E, §7.B). A completion-time identity
// mismatch must be a distinct recovery outcome, not flattened into the
// generic permission-not-granted decline, so the surfaces can render
// same-account recovery guidance. The mismatch reaches the client as a
// thrown callable error at the consent completion step.
describe("runPublicationAction - identity mismatch classification", () => {
  beforeEach(() => {
    _resetLmsPublicationStateForTest();
  });

  const identityMismatchThrow = (): never => {
    const err = new Error("failed-precondition");
    (err as { details?: unknown }).details = { code: "lms.identityMismatch" };
    throw err;
  };

  test("consent completing against a different account maps to identityMismatch, not permissionNotGranted", async () => {
    let call = 0;
    const consent = makeConsent({
      completeConnection: async () => identityMismatchThrow(),
    });
    const result = await runPublicationAction({
      nonce: "n",
      publish: async () => {
        call += 1;
        return insufficient();
      },
      consent: consent.seam,
      coordinator: createConsentCoordinator(),
    });
    expect(result.kind).toBe("identityMismatch");
    // Distinct from a generic decline.
    expect(result.kind).not.toBe("permissionNotGranted");
    // No automatic re-issue: the wrong account can never publish, and the
    // durable connection was not mutated (backend hard-rejects first).
    expect(call).toBe(1);
    expect(consent.beginCalls).toBe(1);
    expect(consent.openCalls).toBe(1);
    expect(consent.completeCalls).toBe(1);
  });

  test("a generic decline (cancelled) still maps to permissionNotGranted, keeping the two states separate", async () => {
    const consent = makeConsent({
      openOAuth: async () => {
        const err = new Error("cancelled");
        (err as { code?: string }).code = "cancelled";
        throw err;
      },
    });
    const result = await runPublicationAction({
      nonce: "n",
      publish: async () => insufficient(),
      consent: consent.seam,
      coordinator: createConsentCoordinator(),
    });
    expect(result.kind).toBe("permissionNotGranted");
  });

  test("the coordinator latches identityMismatch so a second row reuses it without reopening OAuth", async () => {
    const consent = makeConsent({
      completeConnection: async () => identityMismatchThrow(),
    });
    const coordinator = createConsentCoordinator();
    const first = await coordinator.ensureConsent(consent.seam);
    const second = await coordinator.ensureConsent(consent.seam);
    expect(first).toBe("identityMismatch");
    expect(second).toBe("identityMismatch");
    // One OAuth begin/open/complete across both rows (no consent loop).
    expect(consent.beginCalls).toBe(1);
    expect(consent.openCalls).toBe(1);
    expect(consent.completeCalls).toBe(1);
  });
});

describe("consent coordinator - multi-row coordination", () => {
  beforeEach(() => {
    _resetLmsPublicationStateForTest();
  });

  test("one completed consent is reused across two rows; OAuth opens once", async () => {
    const consent = makeConsent();
    const coordinator = createConsentCoordinator();
    const run = (nonce: string) => {
      let call = 0;
      return runPublicationAction({
        nonce,
        publish: async () => {
          call += 1;
          return call === 1 ? insufficient() : succeeded();
        },
        consent: consent.seam,
        coordinator,
      });
    };
    const [a, b] = await Promise.all([run("row-1"), run("row-2")]);
    expect(a.kind).toBe("succeeded");
    expect(b.kind).toBe("succeeded");
    // One shared OAuth flow for both rows.
    expect(consent.beginCalls).toBe(1);
    expect(consent.openCalls).toBe(1);
    expect(consent.completeCalls).toBe(1);
  });

  test("a declined consent latches for the action: the second row does not reopen OAuth", async () => {
    const consent = makeConsent({
      openOAuth: async () => {
        const err = new Error("cancelled");
        (err as { code?: string }).code = "cancelled";
        throw err;
      },
    });
    const coordinator = createConsentCoordinator();
    const run = (nonce: string) =>
      runPublicationAction({
        nonce,
        publish: async () => insufficient(),
        consent: consent.seam,
        coordinator,
      });
    const [a, b] = await Promise.all([run("row-1"), run("row-2")]);
    expect(a.kind).toBe("permissionNotGranted");
    expect(b.kind).toBe("permissionNotGranted");
    expect(consent.beginCalls).toBe(1);
    expect(consent.openCalls).toBe(1);
  });
});

describe("session-scoped retry store and detail seam", () => {
  beforeEach(() => {
    _resetLmsPublicationStateForTest();
  });

  test("record and read are uid-scoped", () => {
    recordLmsPublicationRetryContext("u1", {
      assignmentId: "a1",
      linkId: "l1",
      providerId: "google-classroom",
      title: "T",
      state: "failed",
    });
    expect(readLmsPublicationRetryContext("u1", "a1")?.state).toBe("failed");
    // A different uid never sees the prior teacher's context.
    expect(readLmsPublicationRetryContext("u2", "a1")).toBeNull();
  });

  test("createDetailLmsRetrySeam returns null when there is no context or it succeeded", () => {
    const integrations = {} as unknown as IntegrationsDeps;
    expect(
      createDetailLmsRetrySeam({ uid: "u1", assignmentId: "a1", integrations }),
    ).toBeNull();
    recordLmsPublicationRetryContext("u1", {
      assignmentId: "a1",
      linkId: "l1",
      providerId: "google-classroom",
      title: "T",
      state: "succeeded",
    });
    expect(
      createDetailLmsRetrySeam({ uid: "u1", assignmentId: "a1", integrations }),
    ).toBeNull();
  });

  test("detail retry uses a fresh nonce, only calls publishAssignment, and updates state", async () => {
    const publishNonces: string[] = [];
    let call = 0;
    const integrations = {
      redirectUri: "https://app/app/lms-callback.html",
      openOAuth: async () => ({ code: "c", state: "s" }),
      callables: {
        beginConnection: async () => ({ authorizationUrl: "u", state: "s" }),
        completeConnection: async () => ({
          connectionId: "conn",
          alreadyConnected: false,
        }),
        publishAssignment: async (input: { attemptNonce?: string }) => {
          publishNonces.push(input.attemptNonce ?? "");
          call += 1;
          return call === 1 ? insufficient() : succeeded();
        },
      },
    } as unknown as IntegrationsDeps;

    recordLmsPublicationRetryContext("u1", {
      assignmentId: "a1",
      linkId: "l1",
      providerId: "google-classroom",
      title: "Earth's Layers",
      state: "failed",
    });

    const seam = createDetailLmsRetrySeam({
      uid: "u1",
      assignmentId: "a1",
      integrations,
    });
    expect(seam).not.toBeNull();
    expect(seam!.initialState).toBe("failed");

    const next = await seam!.retry();
    expect(next).toBe("succeeded");
    // Fresh nonce (not empty), reused across the consent re-issue.
    expect(publishNonces).toHaveLength(2);
    expect(publishNonces[0]).not.toBe("");
    expect(publishNonces[0]).toBe(publishNonces[1]);
    // The recorded state is updated so a re-open reflects success.
    expect(readLmsPublicationRetryContext("u1", "a1")?.state).toBe("succeeded");
  });

  test("a fresh explicit retry mints a different nonce from a previous action", async () => {
    const seen: string[] = [];
    const integrations = {
      redirectUri: "r",
      openOAuth: async () => ({ code: "c", state: "s" }),
      callables: {
        beginConnection: async () => ({ authorizationUrl: "u", state: "s" }),
        completeConnection: async () => ({ connectionId: "conn", alreadyConnected: false }),
        publishAssignment: async (input: { attemptNonce?: string }) => {
          seen.push(input.attemptNonce ?? "");
          return failedWith("lms.upstreamCallFailed");
        },
      },
    } as unknown as IntegrationsDeps;
    recordLmsPublicationRetryContext("u1", {
      assignmentId: "a1",
      linkId: "l1",
      providerId: "google-classroom",
      title: "T",
      state: "failed",
    });
    const seam = createDetailLmsRetrySeam({ uid: "u1", assignmentId: "a1", integrations })!;
    await seam.retry();
    await seam.retry();
    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toBe(seen[1]); // distinct logical actions
  });
});

// Sprint 26 Phase 4 (definition §7.F, §8). The session-local connection-
// recovery signal is the only "action needed" evidence LyfeLabz can honestly
// hold: it records an observed reconnect-required condition, is uid-scoped,
// and is never persisted (a reload forgets it, and the next attempt re-derives
// it). Identity mismatch never arms it.
describe("session-scoped connection-recovery signal", () => {
  beforeEach(() => {
    _resetLmsPublicationStateForTest();
  });

  test("record then read is uid- and provider-scoped; clear removes it", () => {
    expect(readConnectionReconnectNeeded("u1", "google-classroom")).toBe(false);
    recordConnectionReconnectNeeded("u1", "google-classroom");
    expect(readConnectionReconnectNeeded("u1", "google-classroom")).toBe(true);
    // A different teacher never sees another teacher's signal.
    expect(readConnectionReconnectNeeded("u2", "google-classroom")).toBe(false);
    // A different provider is unaffected.
    expect(readConnectionReconnectNeeded("u1", "other")).toBe(false);
    clearConnectionReconnectNeeded("u1", "google-classroom");
    expect(readConnectionReconnectNeeded("u1", "google-classroom")).toBe(false);
  });

  test("a fresh session (reset) forgets the signal - it is not persisted", () => {
    recordConnectionReconnectNeeded("u1", "google-classroom");
    expect(readConnectionReconnectNeeded("u1", "google-classroom")).toBe(true);
    _resetLmsPublicationStateForTest();
    expect(readConnectionReconnectNeeded("u1", "google-classroom")).toBe(false);
  });

  test("a detail retry that stays reconnect-required arms the signal for Settings", async () => {
    const integrations = {
      redirectUri: "r",
      openOAuth: async () => ({ code: "c", state: "s" }),
      callables: {
        beginConnection: async () => ({ authorizationUrl: "u", state: "s" }),
        completeConnection: async () => ({ connectionId: "conn", alreadyConnected: false }),
        publishAssignment: async () => failedWith("lms.connectionNotActive"),
      },
    } as unknown as IntegrationsDeps;
    recordLmsPublicationRetryContext("u1", {
      assignmentId: "a1",
      linkId: "l1",
      providerId: "google-classroom",
      title: "T",
      state: "failed",
    });
    const seam = createDetailLmsRetrySeam({ uid: "u1", assignmentId: "a1", integrations })!;
    const next = await seam.retry();
    expect(next).toBe("reconnectRequired");
    expect(readConnectionReconnectNeeded("u1", "google-classroom")).toBe(true);
  });

  test("a detail retry that succeeds clears a previously armed signal", async () => {
    recordConnectionReconnectNeeded("u1", "google-classroom");
    const integrations = {
      redirectUri: "r",
      openOAuth: async () => ({ code: "c", state: "s" }),
      callables: {
        beginConnection: async () => ({ authorizationUrl: "u", state: "s" }),
        completeConnection: async () => ({ connectionId: "conn", alreadyConnected: false }),
        publishAssignment: async () => succeeded(),
      },
    } as unknown as IntegrationsDeps;
    recordLmsPublicationRetryContext("u1", {
      assignmentId: "a1",
      linkId: "l1",
      providerId: "google-classroom",
      title: "T",
      state: "reconnectRequired",
    });
    const seam = createDetailLmsRetrySeam({ uid: "u1", assignmentId: "a1", integrations })!;
    const next = await seam.retry();
    expect(next).toBe("succeeded");
    expect(readConnectionReconnectNeeded("u1", "google-classroom")).toBe(false);
  });

  test("a detail retry that hits identity mismatch does NOT arm the Settings signal", async () => {
    const integrations = {
      redirectUri: "r",
      openOAuth: async () => ({ code: "c", state: "s" }),
      callables: {
        beginConnection: async () => ({ authorizationUrl: "u", state: "s" }),
        completeConnection: async () => {
          const err = new Error("failed-precondition");
          (err as { details?: unknown }).details = { code: "lms.identityMismatch" };
          throw err;
        },
        publishAssignment: async () => insufficient(),
      },
    } as unknown as IntegrationsDeps;
    recordLmsPublicationRetryContext("u1", {
      assignmentId: "a1",
      linkId: "l1",
      providerId: "google-classroom",
      title: "T",
      state: "failed",
    });
    const seam = createDetailLmsRetrySeam({ uid: "u1", assignmentId: "a1", integrations })!;
    const next = await seam.retry();
    expect(next).toBe("identityMismatch");
    // Identity mismatch recovery lives in the publication surface (same-account
    // retry), so Settings must not be armed as a required destination.
    expect(readConnectionReconnectNeeded("u1", "google-classroom")).toBe(false);
  });
});
