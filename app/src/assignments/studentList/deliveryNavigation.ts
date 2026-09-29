// Policy E cache transition: prepare an educational-delivery target before the
// application navigates into it.
//
// Policy E (SECURITY_BACKLOG_LAUNCH_URL_ANALYTICS.md) governs `/app/lessons/**`
// through Firebase Hosting RESPONSE HEADERS (a Content-Security-Policy that
// blocks Google Analytics, plus `Referrer-Policy: strict-origin` on `/app/**`).
// The lesson bytes, and therefore their ETags, did not change. Firebase Hosting
// omits custom headers on 304 Not Modified responses, and a browser that
// revalidates a stored response keeps the headers it stored with it. A browser
// holding a representation cached before Policy E therefore keeps using it,
// without the CSP, for as long as the ETag matches, and Google Analytics runs.
//
// The invariant: before the application navigates into `/app/lessons/**`, the
// browser's reusable HTTP cache entry for that URL is replaced by a response
// governed by the current Hosting policy. The mechanism is one same-origin
// request per navigation:
//
//   GET <target without fragment>, cache: "reload", credentials: "same-origin"
//
// - `cache: "reload"` bypasses the stored entry, makes an UNCONDITIONAL request
//   (no If-None-Match, so the answer is a full 200 carrying the current
//   headers) and stores that response in the HTTP cache. "no-cache" is wrong:
//   it revalidates, receives the headerless 304, and keeps the stale headers.
//   "no-store" neither reads nor writes the cache. A HEAD request never
//   replaces a stored GET response.
// - The body is read to the end so the browser commits a complete cache entry.
// - Same-origin credentials match the navigation's cache key (Firefox keys
//   anonymous requests separately).
// - The fragment is removed: it is never part of the HTTP request or the cache
//   key, and the launch context it carries stays out of the request entirely.
//   The navigation that follows uses the ORIGINAL url, fragment and any legacy
//   query intact.
//
// The subsequent navigation finds a fresh entry (Hosting sends max-age=3600)
// with the current headers. A later revalidation of that entry returns a 304
// that only updates headers it carries, so the stored CSP persists.
//
// Preparation is best-effort and never blocks delivery: a failure or a slow
// network (DELIVERY_PREPARATION_TIMEOUT_MS) resolves and the navigation
// proceeds exactly as it did before this module existed. Targets outside
// `/app/lessons/**`, or on another origin, are not prepared at all.
//
// The lesson-side counterpart for ordinary links between `/app/lessons/**`
// pages lives in the shared runtime shim (assets/lyfelabz-assessment-runtime.js)
// and follows the same request contract.

export const DELIVERY_ZONE_PATH_PREFIX = "/app/lessons/";

// Upper bound on how long a launch waits for preparation before navigating
// anyway, so a slow network never strands a student on the launcher.
export const DELIVERY_PREPARATION_TIMEOUT_MS = 4000;

export type DeliveryPreparationOutcome =
  // The target is not a same-origin `/app/lessons/**` URL; nothing was done.
  | "not-delivery-zone"
  // A current response was fetched and its body fully read.
  | "prepared"
  // The request failed or returned a non-OK status.
  | "failed"
  // The timeout elapsed first; the caller navigates anyway.
  | "timed-out";

// The fetch init used for every preparation request. Exported so tests (and
// the runtime-shim contract test) pin the exact HTTP mechanism.
export const DELIVERY_PREPARATION_REQUEST_INIT: Readonly<RequestInit> = Object.freeze({
  method: "GET",
  cache: "reload",
  credentials: "same-origin",
  mode: "same-origin",
  redirect: "follow",
});

// The request URL to prepare for a navigation `target` resolved against
// `baseUrl` (the current document URL), or null when the target is not a
// same-origin http(s) URL under `/app/lessons/`. The URL parser normalizes
// dot segments (including percent-encoded ones) before the prefix check, so a
// path cannot escape the zone. The fragment is dropped.
export function deliveryPreparationRequestUrl(
  target: string,
  baseUrl: string,
): string | null {
  let base: URL;
  let url: URL;
  try {
    base = new URL(baseUrl);
    url = new URL(target, base);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.origin !== base.origin) return null;
  if (!url.pathname.startsWith(DELIVERY_ZONE_PATH_PREFIX)) return null;
  url.hash = "";
  return url.href;
}

export type DeliveryPreparationDeps = {
  readonly fetch: (input: string, init: RequestInit) => Promise<Response>;
  // The current document URL (window.location.href).
  readonly baseUrl: string;
  readonly setTimeout: (callback: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
  readonly timeoutMs?: number;
};

// Prepare one navigation target. Never rejects.
export function prepareDeliveryNavigation(
  target: string,
  deps: DeliveryPreparationDeps,
): Promise<DeliveryPreparationOutcome> {
  const requestUrl = deliveryPreparationRequestUrl(target, deps.baseUrl);
  if (requestUrl === null) return Promise.resolve("not-delivery-zone");

  return new Promise<DeliveryPreparationOutcome>((resolve) => {
    let settled = false;
    let timer: unknown = undefined;
    const settle = (outcome: DeliveryPreparationOutcome): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) deps.clearTimeout(timer);
      resolve(outcome);
    };
    timer = deps.setTimeout(
      () => settle("timed-out"),
      deps.timeoutMs ?? DELIVERY_PREPARATION_TIMEOUT_MS,
    );
    let request: Promise<Response>;
    try {
      request = deps.fetch(requestUrl, { ...DELIVERY_PREPARATION_REQUEST_INIT });
    } catch {
      settle("failed");
      return;
    }
    request
      .then(async (response) => {
        // Read the body to the end so the cache entry is committed complete,
        // even for a non-OK status, before reporting the outcome.
        await response.arrayBuffer();
        settle(response.ok ? "prepared" : "failed");
      })
      .catch(() => settle("failed"));
  });
}

// The browser wiring for prepareDeliveryNavigation.
export function browserDeliveryPreparationDeps(win: Window): DeliveryPreparationDeps {
  return {
    fetch: (input, init) => win.fetch(input, init),
    baseUrl: win.location.href,
    setTimeout: (callback, ms) => win.setTimeout(callback, ms),
    clearTimeout: (handle) => win.clearTimeout(handle as number),
  };
}

// Teacher Preview opens a `/app/lessons/**` page in a NEW tab from an ordinary
// `<a target="_blank" rel="noopener">`. A plain click is taken over so the
// target can be prepared first: a blank tab is opened synchronously inside the
// click (so popup blocking cannot apply), its opener is severed (the noopener
// guarantee), and it is navigated to the unchanged href once preparation
// settles. Modified clicks (open in background tab / window, download) and any
// click another handler already handled keep the native link behavior, as does
// a browser that refuses to open the tab.
export function attachDeliveryNewTabPreparation(
  anchor: HTMLAnchorElement,
  win: Window,
): void {
  anchor.addEventListener("click", (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = anchor.href;
    if (deliveryPreparationRequestUrl(href, win.location.href) === null) return;

    let tab: Window | null | undefined = null;
    try {
      tab = win.open("", "_blank");
    } catch {
      tab = null;
    }
    if (!tab) return;
    event.preventDefault();
    try {
      tab.opener = null;
    } catch {
      // Severing the opener is best-effort; the tab still opens our own page.
    }
    const opened = tab;
    void prepareDeliveryNavigation(href, browserDeliveryPreparationDeps(win)).then(() => {
      try {
        opened.location.replace(href);
      } catch {
        // The teacher closed the tab before preparation settled.
      }
    });
  });
}
