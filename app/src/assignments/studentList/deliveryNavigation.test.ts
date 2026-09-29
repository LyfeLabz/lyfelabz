import {
  DELIVERY_PREPARATION_REQUEST_INIT,
  DELIVERY_PREPARATION_TIMEOUT_MS,
  attachDeliveryNewTabPreparation,
  deliveryPreparationRequestUrl,
  prepareDeliveryNavigation,
  type DeliveryPreparationDeps,
} from "./deliveryNavigation";

// Policy E cache transition. Firebase Hosting omits custom security headers
// (Content-Security-Policy, Referrer-Policy) on 304 Not Modified responses, and
// Policy E changed only headers, not lesson bytes or ETags. A browser holding a
// `/app/lessons/**` page cached before Policy E would revalidate to a headerless
// 304 and keep running Google Analytics there. These tests pin the transition
// mechanism that protects such browsers: an unconditional same-origin GET with
// cache mode "reload" whose full 200 replaces the cached copy before navigation.

const ORIGIN = "https://lyfelabz-staging.web.app";
const SHELL = `${ORIGIN}/app/student`;

type FetchCall = { readonly url: string; readonly init: RequestInit };

function okResponse(status = 200): { response: Response; bodyRead: () => boolean } {
  let read = false;
  const response = {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: () => {
      read = true;
      return Promise.resolve(new ArrayBuffer(8));
    },
  } as unknown as Response;
  return { response, bodyRead: () => read };
}

function makeDeps(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  over: Partial<DeliveryPreparationDeps> = {},
): { deps: DeliveryPreparationDeps; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  return {
    calls,
    deps: {
      fetch: (url, init) => {
        calls.push({ url, init });
        return fetchImpl(url, init);
      },
      baseUrl: SHELL,
      setTimeout: (cb, ms) => setTimeout(cb, ms),
      clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
      ...over,
    },
  };
}

describe("deliveryPreparationRequestUrl - which navigations are prepared", () => {
  test.each([
    ["/app/lessons/lesson_earths-layers.html", `${ORIGIN}/app/lessons/lesson_earths-layers.html`],
    [
      "/app/lessons/assessment-revisions/lesson_earths-layers__r1.html#assignment=a1",
      `${ORIGIN}/app/lessons/assessment-revisions/lesson_earths-layers__r1.html`,
    ],
    [
      `/app/lessons/variants/lesson_earths-layers__pr${"a".repeat(64)}.html#assignment=a1&launchRef=${"b".repeat(32)}`,
      `${ORIGIN}/app/lessons/variants/lesson_earths-layers__pr${"a".repeat(64)}.html`,
    ],
    // Legacy query-form links keep their query: it is part of the cache key.
    [
      "/app/lessons/lesson_earths-layers.html?assignment=a1#x",
      `${ORIGIN}/app/lessons/lesson_earths-layers.html?assignment=a1`,
    ],
    [`${ORIGIN}/app/lessons/index.html`, `${ORIGIN}/app/lessons/index.html`],
  ])("prepares %s as %s (fragment removed, query kept)", (target, expected) => {
    expect(deliveryPreparationRequestUrl(target, SHELL)).toBe(expected);
  });

  test("resolves relative targets against the current document", () => {
    expect(
      deliveryPreparationRequestUrl("lesson_gravity.html#vocab", `${ORIGIN}/app/lessons/lesson_eclipses.html`),
    ).toBe(`${ORIGIN}/app/lessons/lesson_gravity.html`);
  });

  test.each([
    // Public root pages keep their analytics and are never prepared.
    "/lesson_earths-layers.html",
    "/",
    // Other application routes are not the delivery zone.
    "/app/",
    "/app/a/asg-1",
    "/app/lessonsx/lesson_a.html",
    "/app/lessons",
    // Dot segments (plain and percent-encoded) are normalized before the check.
    "/app/lessons/../a/asg-1",
    "/app/lessons/%2e%2e/student",
    // Other origins and schemes.
    "https://evil.example/app/lessons/lesson_a.html",
    "//evil.example/app/lessons/lesson_a.html",
    "https://lyfelabz.com/app/lessons/lesson_a.html",
    "javascript:alert(1)",
    "data:text/html,x",
    "mailto:x@example.com",
  ])("does not prepare %s", (target) => {
    expect(deliveryPreparationRequestUrl(target, SHELL)).toBeNull();
  });

  test("an unparseable base prepares nothing", () => {
    expect(deliveryPreparationRequestUrl("/app/lessons/a.html", "not a url")).toBeNull();
  });
});

describe("prepareDeliveryNavigation - the exact HTTP mechanism", () => {
  test("one unconditional same-origin GET with cache mode reload; body read before resolving", async () => {
    const { response, bodyRead } = okResponse();
    const { deps, calls } = makeDeps(() => Promise.resolve(response));
    const outcome = await prepareDeliveryNavigation(
      "/app/lessons/lesson_earths-layers.html#assignment=a1&launchRef=r1",
      deps,
    );
    expect(outcome).toBe("prepared");
    expect(bodyRead()).toBe(true);
    expect(calls).toEqual([
      {
        url: `${ORIGIN}/app/lessons/lesson_earths-layers.html`,
        init: {
          method: "GET",
          cache: "reload",
          credentials: "same-origin",
          mode: "same-origin",
          redirect: "follow",
        },
      },
    ]);
    // The launch context never enters the request.
    expect(calls[0]?.url).not.toContain("assignment");
    expect(calls[0]?.url).not.toContain("launchRef");
  });

  test("regression: 'no-cache' / 'no-store' / HEAD cannot replace a pre-policy cached copy", () => {
    // no-cache revalidates and receives the headerless 304; no-store never
    // writes the cache; HEAD never replaces a stored GET response. Only an
    // unconditional GET that stores its response establishes the invariant.
    expect(DELIVERY_PREPARATION_REQUEST_INIT.cache).toBe("reload");
    expect(DELIVERY_PREPARATION_REQUEST_INIT.method).toBe("GET");
    expect(DELIVERY_PREPARATION_REQUEST_INIT.credentials).toBe("same-origin");
    expect(Object.isFrozen(DELIVERY_PREPARATION_REQUEST_INIT)).toBe(true);
  });

  test("a non-delivery target makes no request", async () => {
    const { deps, calls } = makeDeps(() => Promise.reject(new Error("unexpected")));
    await expect(prepareDeliveryNavigation("/lesson_earths-layers.html", deps)).resolves.toBe(
      "not-delivery-zone",
    );
    expect(calls).toEqual([]);
  });

  test("a non-OK response is reported as failed after its body is read", async () => {
    const { response, bodyRead } = okResponse(404);
    const { deps } = makeDeps(() => Promise.resolve(response));
    await expect(prepareDeliveryNavigation("/app/lessons/missing.html", deps)).resolves.toBe("failed");
    expect(bodyRead()).toBe(true);
  });

  test("a rejected request resolves failed (never rejects)", async () => {
    const { deps } = makeDeps(() => Promise.reject(new TypeError("offline")));
    await expect(prepareDeliveryNavigation("/app/lessons/a.html", deps)).resolves.toBe("failed");
  });

  test("a synchronously throwing fetch resolves failed", async () => {
    const { deps } = makeDeps(() => {
      throw new TypeError("blocked");
    });
    await expect(prepareDeliveryNavigation("/app/lessons/a.html", deps)).resolves.toBe("failed");
  });

  test("a body read failure resolves failed", async () => {
    const response = { ok: true, arrayBuffer: () => Promise.reject(new Error("reset")) } as unknown as Response;
    const { deps } = makeDeps(() => Promise.resolve(response));
    await expect(prepareDeliveryNavigation("/app/lessons/a.html", deps)).resolves.toBe("failed");
  });

  test("a slow network times out at the bound and a late completion is ignored", async () => {
    jest.useFakeTimers();
    try {
      let finish: (r: Response) => void = () => undefined;
      const { deps } = makeDeps(() => new Promise<Response>((resolve) => { finish = resolve; }));
      const pending = prepareDeliveryNavigation("/app/lessons/a.html", deps);
      jest.advanceTimersByTime(DELIVERY_PREPARATION_TIMEOUT_MS);
      await expect(pending).resolves.toBe("timed-out");
      finish(okResponse().response);
      await Promise.resolve();
    } finally {
      jest.useRealTimers();
    }
  });

  test("the timer is cleared once the request settles", async () => {
    const cleared: unknown[] = [];
    const { deps } = makeDeps(() => Promise.resolve(okResponse().response), {
      setTimeout: () => "timer-1",
      clearTimeout: (h) => cleared.push(h),
    });
    await prepareDeliveryNavigation("/app/lessons/a.html", deps);
    expect(cleared).toEqual(["timer-1"]);
  });
});

describe("attachDeliveryNewTabPreparation - Teacher Preview", () => {
  type FakeTab = { opener: unknown; location: { replace: jest.Mock } };

  function setup(opts: { href: string; openResult?: "tab" | "null" | "throw"; fetchImpl?: () => Promise<Response> }) {
    const anchor = document.createElement("a");
    // Absolute, because the jsdom document URL is not the fake shell origin.
    anchor.href = `${ORIGIN}${opts.href}`;
    anchor.target = "_blank";
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    const tab: FakeTab = { opener: "teacher-window", location: { replace: jest.fn() } };
    const fetchCalls: string[] = [];
    const win = {
      location: { href: `${ORIGIN}/app/teacher` },
      open: jest.fn(() => {
        if (opts.openResult === "throw") throw new Error("blocked");
        return opts.openResult === "null" ? null : tab;
      }),
      fetch: jest.fn((url: string) => {
        fetchCalls.push(url);
        return (opts.fetchImpl ?? (() => Promise.resolve(okResponse().response)))();
      }),
      setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
      clearTimeout: (h: number) => clearTimeout(h),
    } as unknown as Window;
    attachDeliveryNewTabPreparation(anchor, win);
    return { anchor, tab, win, fetchCalls };
  }

  function click(anchor: HTMLAnchorElement, init: MouseEventInit = {}): MouseEvent {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
    anchor.dispatchEvent(event);
    return event;
  }

  const flush = async (): Promise<void> => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test("a plain click opens the tab synchronously, severs the opener, prepares, then loads the unchanged href", async () => {
    const { anchor, tab, win, fetchCalls } = setup({ href: "/app/lessons/lesson_gravity.html" });
    const event = click(anchor);
    expect(event.defaultPrevented).toBe(true);
    expect(win.open).toHaveBeenCalledWith("", "_blank");
    expect(tab.opener).toBeNull();
    expect(tab.location.replace).not.toHaveBeenCalled();
    await flush();
    expect(fetchCalls).toEqual([`${ORIGIN}/app/lessons/lesson_gravity.html`]);
    expect(tab.location.replace).toHaveBeenCalledTimes(1);
    expect(tab.location.replace).toHaveBeenCalledWith(`${ORIGIN}/app/lessons/lesson_gravity.html`);
  });

  test("failed preparation still loads the preview", async () => {
    const { anchor, tab } = setup({
      href: "/app/lessons/lesson_gravity.html",
      fetchImpl: () => Promise.reject(new TypeError("offline")),
    });
    click(anchor);
    await flush();
    expect(tab.location.replace).toHaveBeenCalledWith(`${ORIGIN}/app/lessons/lesson_gravity.html`);
  });

  test.each([
    [{ metaKey: true }],
    [{ ctrlKey: true }],
    [{ shiftKey: true }],
    [{ altKey: true }],
    [{ button: 1 }],
  ])("a modified or non-primary click keeps native behavior %p", (init) => {
    const { anchor, win, fetchCalls } = setup({ href: "/app/lessons/lesson_gravity.html" });
    const event = click(anchor, init as MouseEventInit);
    expect(event.defaultPrevented).toBe(false);
    expect(win.open).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
  });

  test.each(["null", "throw"] as const)("a refused tab (%s) falls back to the native link", (openResult) => {
    const { anchor, fetchCalls } = setup({ href: "/app/lessons/lesson_gravity.html", openResult });
    const event = click(anchor);
    expect(event.defaultPrevented).toBe(false);
    expect(fetchCalls).toEqual([]);
  });

  test("a public root lesson link is untouched", () => {
    const { anchor, win } = setup({ href: "/lesson_gravity.html" });
    const event = click(anchor);
    expect(event.defaultPrevented).toBe(false);
    expect(win.open).not.toHaveBeenCalled();
  });

  test("a click another handler already handled is untouched", () => {
    const { anchor, win } = setup({ href: "/app/lessons/lesson_gravity.html" });
    const handled = (e: Event): void => e.preventDefault();
    document.addEventListener("click", handled, { capture: true });
    try {
      click(anchor);
    } finally {
      document.removeEventListener("click", handled, { capture: true });
    }
    expect(win.open).not.toHaveBeenCalled();
  });
});
