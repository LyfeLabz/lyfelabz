// Present Mode launch and return context.
//
// Certified by PRESENT_MODE_ARCHITECTURE.md §14 and PLATFORM_CONTRACTS.md
// §4, §5, §6. This module owns:
//
//   - the certified sessionStorage key,
//   - the versioned return-context schema and its validator,
//   - the same-tab launch factory that writes the marker and calls
//     window.location.assign("/").
//
// The Teacher Workspace shell and the canonical instructional return
// script share this contract. The shell must not read sessionStorage
// directly (see shell.test.ts data-and-callable-posture invariant); it
// invokes the injected launch handler produced here instead.

// Certified sessionStorage key.
// PLATFORM_CONTRACTS.md §4 registry, PRESENT_MODE_ARCHITECTURE.md §14.2.
export const PRESENT_MODE_RETURN_CONTEXT_KEY =
  "lyfelabz.presentMode.returnContext";

// Certified schema version. PRESENT_MODE_ARCHITECTURE.md §14.2.
export const PRESENT_MODE_RETURN_CONTEXT_VERSION = 1 as const;

// Certified allowlist of `returnSurface` values. Extending this
// allowlist requires an architecture amendment (PRESENT_MODE_ARCHITECTURE
// §14.2, PLATFORM_CONTRACTS §6, §7).
export const CERTIFIED_RETURN_SURFACES = Object.freeze([
  "curriculum",
] as const);

export type CertifiedReturnSurface = (typeof CERTIFIED_RETURN_SURFACES)[number];

export type ReturnContext = {
  readonly version: typeof PRESENT_MODE_RETURN_CONTEXT_VERSION;
  readonly returnSurface: CertifiedReturnSurface;
};

// Certified launch target (PRESENT_MODE_ARCHITECTURE.md §14.3).
export const PRESENT_MODE_LAUNCH_URL = "/";

// Minimal storage seam. The real launcher uses window.sessionStorage;
// tests inject an in-memory fake.
export interface ReturnContextStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

// Minimal navigation seam. Only the same-tab assign call is exposed.
export interface LaunchNavigator {
  assign(url: string): void;
}

// Build the certified return context object. There is only one certified
// shape today; future values would each add an authorized surface here.
export function createReturnContext(
  returnSurface: CertifiedReturnSurface = "curriculum",
): ReturnContext {
  return Object.freeze({
    version: PRESENT_MODE_RETURN_CONTEXT_VERSION,
    returnSurface,
  });
}

function isCertifiedSurface(v: unknown): v is CertifiedReturnSurface {
  return (
    typeof v === "string" &&
    (CERTIFIED_RETURN_SURFACES as ReadonlyArray<string>).includes(v)
  );
}

// Validate a raw sessionStorage payload. Returns a certified
// ReturnContext or `null`. Fails safely on every ill-formed input.
export function parseReturnContext(raw: string | null): ReturnContext | null {
  if (raw === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return validateReturnContext(parsed);
}

export function validateReturnContext(value: unknown): ReturnContext | null {
  if (value === null || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  if (obj.version !== PRESENT_MODE_RETURN_CONTEXT_VERSION) return null;
  if (!isCertifiedSurface(obj.returnSurface)) return null;
  return Object.freeze({
    version: PRESENT_MODE_RETURN_CONTEXT_VERSION,
    returnSurface: obj.returnSurface,
  });
}

// Write the return-context marker into browser storage. Failures are
// swallowed so a private-mode browser never blocks navigation.
export function writeReturnContext(
  storage: ReturnContextStorage,
  ctx: ReturnContext,
): void {
  try {
    storage.setItem(PRESENT_MODE_RETURN_CONTEXT_KEY, JSON.stringify(ctx));
  } catch {
    // Safe failure: storage unavailable is not fatal.
  }
}

export function clearReturnContext(storage: ReturnContextStorage): void {
  try {
    storage.removeItem(PRESENT_MODE_RETURN_CONTEXT_KEY);
  } catch {
    // Safe failure.
  }
}

export type LaunchPresentMode = () => void;

// Build a launch handler that records the certified return context and
// then hands the tab to the canonical instructional experience. The
// storage and navigator seams are injected so the shell has no
// dependency on window globals.
export function createLaunchPresentMode(
  storage: ReturnContextStorage,
  navigator: LaunchNavigator,
): LaunchPresentMode {
  return () => {
    writeReturnContext(storage, createReturnContext("curriculum"));
    navigator.assign(PRESENT_MODE_LAUNCH_URL);
  };
}

// Convenience: the browser-backed launcher used by the entry point.
export function createBrowserLaunchPresentMode(
  win: Window = window,
): LaunchPresentMode {
  const storage: ReturnContextStorage = {
    getItem: (k) => win.sessionStorage.getItem(k),
    setItem: (k, v) => {
      win.sessionStorage.setItem(k, v);
    },
    removeItem: (k) => {
      win.sessionStorage.removeItem(k);
    },
  };
  const navigator: LaunchNavigator = {
    assign: (url) => {
      win.location.assign(url);
    },
  };
  return createLaunchPresentMode(storage, navigator);
}
