/**
 * @jest-environment jsdom
 */
import * as fs from "fs";
import * as path from "path";
import {
  PRESENT_MODE_RETURN_CONTEXT_KEY,
  createReturnContext,
} from "./launchContext";
import {
  RETURN_CONTROL_LABEL,
  RETURN_CONTROL_TESTID,
  renderReturnControl,
  returnUrlFor,
} from "./returnControl";
import type {
  ReturnContextStorage,
  LaunchNavigator,
} from "./launchContext";

const makeStorage = (
  seed?: string,
): ReturnContextStorage & { store: Map<string, string> } => {
  const store = new Map<string, string>();
  if (typeof seed === "string") {
    store.set(PRESENT_MODE_RETURN_CONTEXT_KEY, seed);
  }
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

const makeNav = (): LaunchNavigator & { calls: string[] } => {
  const calls: string[] = [];
  return {
    calls,
    assign: (url) => {
      calls.push(url);
    },
  };
};

const freshDoc = (): Document => {
  document.body.innerHTML = "";
  return document;
};

describe("returnControl reference implementation", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("injects no control when the marker is absent", () => {
    const el = renderReturnControl(freshDoc(), {
      storage: makeStorage(),
      navigator: makeNav(),
    });
    expect(el).toBeNull();
    expect(
      document.querySelector(`[data-testid=${RETURN_CONTROL_TESTID}]`),
    ).toBeNull();
  });

  test("injects no control when the marker is malformed JSON", () => {
    const el = renderReturnControl(freshDoc(), {
      storage: makeStorage("{ not json"),
      navigator: makeNav(),
    });
    expect(el).toBeNull();
  });

  test("injects no control when the marker has an unsupported version", () => {
    const el = renderReturnControl(freshDoc(), {
      storage: makeStorage(
        JSON.stringify({ version: 2, returnSurface: "curriculum" }),
      ),
      navigator: makeNav(),
    });
    expect(el).toBeNull();
  });

  test("injects no control when the marker has an unsupported returnSurface", () => {
    const el = renderReturnControl(freshDoc(), {
      storage: makeStorage(
        JSON.stringify({ version: 1, returnSurface: "classes" }),
      ),
      navigator: makeNav(),
    });
    expect(el).toBeNull();
  });

  test("with a valid marker, renders a semantic button with the certified label", () => {
    const el = renderReturnControl(freshDoc(), {
      storage: makeStorage(JSON.stringify(createReturnContext())),
      navigator: makeNav(),
    });
    expect(el).not.toBeNull();
    expect(el?.tagName.toLowerCase()).toBe("button");
    expect(el?.getAttribute("type")).toBe("button");
    expect(el?.textContent).toBe(RETURN_CONTROL_LABEL);
    expect(el?.getAttribute("aria-label")).toBe(RETURN_CONTROL_LABEL);
  });

  test("does not render any teacher, class, or student identifiers", () => {
    renderReturnControl(freshDoc(), {
      storage: makeStorage(JSON.stringify(createReturnContext())),
      navigator: makeNav(),
    });
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/uid|email|school|class|student|assignment|claim/i);
  });

  test("clicking the control navigates back to the Teacher Workspace entry URL and clears the marker", () => {
    const storage = makeStorage(JSON.stringify(createReturnContext()));
    const nav = makeNav();
    const el = renderReturnControl(freshDoc(), { storage, navigator: nav });
    el?.click();
    expect(nav.calls).toEqual([returnUrlFor("curriculum")]);
    expect(storage.getItem(PRESENT_MODE_RETURN_CONTEXT_KEY)).toBeNull();
  });

  test("`curriculum` maps to /app/teacher", () => {
    expect(returnUrlFor("curriculum")).toBe("/app/teacher");
  });
});

describe("assets/present-mode-return.js plain-JS artifact", () => {
  const scriptPath = path.resolve(
    __dirname,
    "..",
    "..",
    "..",
    "assets",
    "present-mode-return.js",
  );

  const runScript = (): void => {
    const source = fs.readFileSync(scriptPath, "utf8");
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    new Function(source).call(window);
  };

  const setMarker = (raw: string | null): void => {
    if (raw === null) window.sessionStorage.removeItem(PRESENT_MODE_RETURN_CONTEXT_KEY);
    else window.sessionStorage.setItem(PRESENT_MODE_RETURN_CONTEXT_KEY, raw);
  };

  beforeEach(() => {
    document.body.innerHTML = "";
    window.sessionStorage.clear();
  });

  test("file exists and is loadable", () => {
    expect(fs.existsSync(scriptPath)).toBe(true);
  });

  test("does not import Firebase SDKs or reach for authenticated APIs", () => {
    const src = fs.readFileSync(scriptPath, "utf8");
    expect(src).not.toMatch(/firebase\/(auth|firestore|functions)/);
    expect(src).not.toMatch(/getAuth|onAuthStateChanged|httpsCallable|onSnapshot/);
  });

  test("no-op without a marker: injects no button and does not mutate the DOM", () => {
    const before = document.body.innerHTML;
    runScript();
    expect(
      document.querySelector(`[data-testid=${RETURN_CONTROL_TESTID}]`),
    ).toBeNull();
    expect(document.body.innerHTML).toBe(before);
  });

  test("no-op with a malformed marker", () => {
    setMarker("{ not json");
    runScript();
    expect(
      document.querySelector(`[data-testid=${RETURN_CONTROL_TESTID}]`),
    ).toBeNull();
  });

  test("no-op with an unsupported version", () => {
    setMarker(JSON.stringify({ version: 2, returnSurface: "curriculum" }));
    runScript();
    expect(
      document.querySelector(`[data-testid=${RETURN_CONTROL_TESTID}]`),
    ).toBeNull();
  });

  test("no-op with an unsupported returnSurface", () => {
    setMarker(JSON.stringify({ version: 1, returnSurface: "settings" }));
    runScript();
    expect(
      document.querySelector(`[data-testid=${RETURN_CONTROL_TESTID}]`),
    ).toBeNull();
  });

  test("renders the certified button when a valid marker is present", () => {
    setMarker(JSON.stringify(createReturnContext()));
    runScript();
    const btn = document.querySelector<HTMLButtonElement>(
      `[data-testid=${RETURN_CONTROL_TESTID}]`,
    );
    expect(btn).not.toBeNull();
    expect(btn?.tagName.toLowerCase()).toBe("button");
    expect(btn?.textContent).toBe(RETURN_CONTROL_LABEL);
    expect(btn?.getAttribute("aria-label")).toBe(RETURN_CONTROL_LABEL);
  });

  test("clicking the button clears the marker and same-tab navigates to /app/teacher", () => {
    setMarker(JSON.stringify(createReturnContext()));
    const calls: string[] = [];
    const originalLocation = window.location;
    const stub = {
      assign: (url: string) => {
        calls.push(url);
      },
    };
    Object.defineProperty(window, "location", {
      configurable: true,
      writable: true,
      value: stub,
    });
    try {
      runScript();
      const btn = document.querySelector<HTMLButtonElement>(
        `[data-testid=${RETURN_CONTROL_TESTID}]`,
      );
      btn?.click();
      expect(calls).toEqual(["/app/teacher"]);
      expect(
        window.sessionStorage.getItem(PRESENT_MODE_RETURN_CONTEXT_KEY),
      ).toBeNull();
    } finally {
      Object.defineProperty(window, "location", {
        configurable: true,
        writable: true,
        value: originalLocation,
      });
    }
  });
});
