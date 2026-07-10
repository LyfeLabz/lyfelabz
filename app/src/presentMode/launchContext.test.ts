/**
 * @jest-environment jsdom
 */
import {
  CERTIFIED_RETURN_SURFACES,
  PRESENT_MODE_LAUNCH_URL,
  PRESENT_MODE_RETURN_CONTEXT_KEY,
  PRESENT_MODE_RETURN_CONTEXT_VERSION,
  createLaunchPresentMode,
  createReturnContext,
  parseReturnContext,
  validateReturnContext,
  writeReturnContext,
  clearReturnContext,
  type LaunchNavigator,
  type ReturnContextStorage,
} from "./launchContext";

const makeStorage = (): ReturnContextStorage & { store: Map<string, string> } => {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => (store.has(k) ? store.get(k) ?? null : null),
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };
};

const makeNavigator = (): LaunchNavigator & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    assign: (url) => {
      calls.push(url);
    },
  };
};

describe("Present Mode certified contracts (Sprint 6G)", () => {
  test("storage key matches the certified value", () => {
    expect(PRESENT_MODE_RETURN_CONTEXT_KEY).toBe(
      "lyfelabz.presentMode.returnContext",
    );
  });

  test("schema version is the certified integer 1", () => {
    expect(PRESENT_MODE_RETURN_CONTEXT_VERSION).toBe(1);
  });

  test("initial certified returnSurface allowlist is exactly ['curriculum']", () => {
    expect([...CERTIFIED_RETURN_SURFACES]).toEqual(["curriculum"]);
  });

  test("certified launch target is '/'", () => {
    expect(PRESENT_MODE_LAUNCH_URL).toBe("/");
  });
});

describe("createReturnContext", () => {
  test("returns exactly the two certified fields with no teacher-scoped data", () => {
    const ctx = createReturnContext();
    expect(Object.keys(ctx).sort()).toEqual(["returnSurface", "version"]);
    expect(ctx.version).toBe(1);
    expect(ctx.returnSurface).toBe("curriculum");
  });

  test("is frozen so callers cannot mutate the certified schema in place", () => {
    const ctx = createReturnContext();
    expect(Object.isFrozen(ctx)).toBe(true);
  });
});

describe("validateReturnContext / parseReturnContext (safe failure)", () => {
  test("accepts a well-formed payload", () => {
    const ctx = validateReturnContext({ version: 1, returnSurface: "curriculum" });
    expect(ctx).not.toBeNull();
    expect(ctx?.returnSurface).toBe("curriculum");
  });

  test("rejects null", () => {
    expect(validateReturnContext(null)).toBeNull();
  });

  test("rejects a non-object", () => {
    expect(validateReturnContext("curriculum")).toBeNull();
    expect(validateReturnContext(42)).toBeNull();
  });

  test("rejects an unsupported version", () => {
    expect(
      validateReturnContext({ version: 2, returnSurface: "curriculum" }),
    ).toBeNull();
    expect(
      validateReturnContext({ version: "1", returnSurface: "curriculum" }),
    ).toBeNull();
  });

  test("rejects an unsupported returnSurface value", () => {
    expect(
      validateReturnContext({ version: 1, returnSurface: "classes" }),
    ).toBeNull();
    expect(
      validateReturnContext({ version: 1, returnSurface: "" }),
    ).toBeNull();
    expect(
      validateReturnContext({ version: 1, returnSurface: 5 }),
    ).toBeNull();
  });

  test("rejects a missing returnSurface field", () => {
    expect(validateReturnContext({ version: 1 })).toBeNull();
  });

  test("parseReturnContext returns null for malformed JSON", () => {
    expect(parseReturnContext("{ not json")).toBeNull();
  });

  test("parseReturnContext returns null for absent storage", () => {
    expect(parseReturnContext(null)).toBeNull();
  });

  test("parseReturnContext strips unrecognized extra fields", () => {
    const ctx = parseReturnContext(
      JSON.stringify({
        version: 1,
        returnSurface: "curriculum",
        teacherEmail: "leaked@example.com",
        uid: "u1",
      }),
    );
    expect(ctx).not.toBeNull();
    expect(Object.keys(ctx ?? {}).sort()).toEqual(["returnSurface", "version"]);
  });
});

describe("writeReturnContext / clearReturnContext", () => {
  test("writes only the certified two-field payload under the certified key", () => {
    const storage = makeStorage();
    writeReturnContext(storage, createReturnContext());
    const raw = storage.getItem(PRESENT_MODE_RETURN_CONTEXT_KEY);
    expect(raw).not.toBeNull();
    const decoded = JSON.parse(raw!) as Record<string, unknown>;
    expect(Object.keys(decoded).sort()).toEqual(["returnSurface", "version"]);
    expect(decoded.version).toBe(1);
    expect(decoded.returnSurface).toBe("curriculum");
  });

  test("clearReturnContext removes the marker", () => {
    const storage = makeStorage();
    writeReturnContext(storage, createReturnContext());
    clearReturnContext(storage);
    expect(storage.getItem(PRESENT_MODE_RETURN_CONTEXT_KEY)).toBeNull();
  });

  test("swallows storage failures (private-mode browser)", () => {
    const throwing: ReturnContextStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("quota");
      },
    };
    expect(() =>
      writeReturnContext(throwing, createReturnContext()),
    ).not.toThrow();
    expect(() => clearReturnContext(throwing)).not.toThrow();
  });
});

describe("createLaunchPresentMode", () => {
  test("writes the certified marker and calls navigator.assign('/') exactly once", () => {
    const storage = makeStorage();
    const nav = makeNavigator();
    const launch = createLaunchPresentMode(storage, nav);
    launch();
    expect(nav.calls).toEqual(["/"]);
    const raw = storage.getItem(PRESENT_MODE_RETURN_CONTEXT_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ version: 1, returnSurface: "curriculum" });
  });

  test("carries no teacher, class, or student identifiers in the stored payload", () => {
    const storage = makeStorage();
    const nav = makeNavigator();
    const launch = createLaunchPresentMode(storage, nav);
    launch();
    const raw = storage.getItem(PRESENT_MODE_RETURN_CONTEXT_KEY) ?? "";
    expect(raw).not.toMatch(/uid|email|school|class|student|assignment|claim/i);
  });

  test("still navigates when storage.setItem throws (safe failure)", () => {
    const throwing: ReturnContextStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => undefined,
    };
    const nav = makeNavigator();
    const launch = createLaunchPresentMode(throwing, nav);
    expect(() => launch()).not.toThrow();
    expect(nav.calls).toEqual(["/"]);
  });
});
