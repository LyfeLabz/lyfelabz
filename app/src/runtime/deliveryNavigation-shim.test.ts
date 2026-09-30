/**
 * @jest-environment node
 */

import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import { JSDOM, VirtualConsole } from "jsdom";

import { DELIVERY_PREPARATION_REQUEST_INIT } from "../assignments/studentList/deliveryNavigation";

// Policy E cache transition, lesson side: the shared runtime shim prepares the
// target of an ordinary link between `/app/lessons/**` pages before following it.
//
// Why this exists: Policy E governs `/app/lessons/**` with Hosting response
// headers, the lesson bytes and ETags did not change, and Firebase Hosting omits
// custom security headers on 304 responses. A browser holding a pre-Policy-E
// copy of a lesson would revalidate to a headerless 304 and keep running Google
// Analytics there. Lesson HTML is immutable, so the shim (loaded by every
// runtime-bearing delivery page) replaces the cached copy of a same-tab link
// target with one unconditional GET (cache "reload") before navigating.
//
// The shim is evaluated against a REAL generated v2 lesson page (read-only),
// with a fake location (jsdom cannot navigate) and a recording fetch.

const REPO_ROOT = path.resolve(__dirname, "../../..");
const SHIM_SOURCE = fs.readFileSync(path.join(REPO_ROOT, "assets/lyfelabz-assessment-runtime.js"), "utf8");
const LESSON_HTML = fs.readFileSync(path.join(REPO_ROOT, "app/lessons/lesson_earths-layers.html"), "utf8");
const ORIGIN = "https://lyfelabz-staging.web.app";
const LESSON_URL = `${ORIGIN}/app/lessons/lesson_earths-layers.html`;

type Harness = {
  readonly dom: JSDOM;
  readonly doc: Document;
  readonly events: string[];
  readonly fetchInits: RequestInit[];
  readonly assign: jest.Mock;
  readonly timers: Array<() => void>;
  readonly win: { lyfelabz?: { assessmentRuntime?: { mode?: string } } };
  click(selector: string, init?: MouseEventInit): MouseEvent;
  flush(): Promise<void>;
};

function load(pageUrl: string, opts: { fetchMode?: "ok" | "reject" | "hang" | "throw"; html?: string } = {}): Harness {
  const dom = new JSDOM(opts.html ?? LESSON_HTML, { url: pageUrl, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  const events: string[] = [];
  const fetchInits: RequestInit[] = [];
  const timers: Array<() => void> = [];
  const parsed = new URL(pageUrl);
  const assign = jest.fn((url: string) => {
    events.push(`navigate ${url}`);
  });
  const win = {
    location: {
      href: parsed.href,
      pathname: parsed.pathname,
      search: parsed.search,
      hash: parsed.hash,
      hostname: parsed.hostname,
      assign,
    },
    document: doc,
    fetch: (url: string, init: RequestInit) => {
      events.push(`${init.method} ${init.cache} ${url}`);
      fetchInits.push(init);
      switch (opts.fetchMode ?? "ok") {
        case "reject":
          return Promise.reject(new TypeError("offline"));
        case "hang":
          return new Promise(() => undefined);
        case "throw":
          throw new TypeError("blocked");
        default:
          return Promise.resolve({
            ok: true,
            arrayBuffer: () => {
              events.push(`body read ${url}`);
              return Promise.resolve(new ArrayBuffer(0));
            },
          });
      }
    },
  };
  const context = vm.createContext({
    window: win,
    URL,
    Promise,
    // Timers are captured so the timeout path is driven explicitly.
    setTimeout: (cb: () => void) => {
      timers.push(cb);
      return timers.length;
    },
    clearTimeout: () => undefined,
  });
  vm.runInContext(SHIM_SOURCE, context);

  return {
    dom,
    doc,
    events,
    fetchInits,
    assign,
    timers,
    win: win as Harness["win"],
    click(selector, init = {}) {
      const el = doc.querySelector(selector);
      if (el === null) throw new Error(`missing element ${selector}`);
      const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
      el.dispatchEvent(event);
      return event;
    },
    async flush() {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    },
  };
}

describe("runtime shim - in-lesson navigation preparation (Policy E cache transition)", () => {
  test("a Connections link is held, its target prepared, then followed with the unchanged href", async () => {
    const h = load(LESSON_URL);
    const event = h.click('a[href="lesson_plate-tectonics.html"]');
    expect(event.defaultPrevented).toBe(true);
    expect(h.assign).not.toHaveBeenCalled();
    await h.flush();
    const target = `${ORIGIN}/app/lessons/lesson_plate-tectonics.html`;
    expect(h.events).toEqual([`GET reload ${target}`, `body read ${target}`, `navigate ${target}`]);
  });

  test("the shim request contract is identical to the application helper's", () => {
    const h = load(LESSON_URL);
    h.click('a[href="lesson_earthquakes.html"]');
    expect(h.fetchInits).toEqual([{ ...DELIVERY_PREPARATION_REQUEST_INIT }]);
  });

  test("companion and home links in the zone are prepared; a link fragment is kept for navigation only", async () => {
    const h = load(LESSON_URL);
    h.click('a[href="index.html#geo"]');
    h.click('a[href="about_privacy.html"]');
    await h.flush();
    expect(h.events).toEqual([
      `GET reload ${ORIGIN}/app/lessons/index.html`,
      `GET reload ${ORIGIN}/app/lessons/about_privacy.html`,
      `body read ${ORIGIN}/app/lessons/index.html`,
      `body read ${ORIGIN}/app/lessons/about_privacy.html`,
      // Only the most recent choice navigates: never two navigations.
      `navigate ${ORIGIN}/app/lessons/about_privacy.html`,
    ]);
  });

  test("assignment launch context in the current page never enters the request", async () => {
    const h = load(`${LESSON_URL}#assignment=asg-1&launchRef=${"a".repeat(32)}`);
    h.click('a[href="lesson_earthquakes.html"]');
    await h.flush();
    expect(h.events[0]).toBe(`GET reload ${ORIGIN}/app/lessons/lesson_earthquakes.html`);
    expect(h.events.join(" ")).not.toMatch(/assignment|launchRef/);
  });

  test.each(["#vocab", "#quiz", "#main", "#connections"])("in-page fragment link %s is untouched", (href) => {
    const h = load(LESSON_URL);
    const event = h.click(`a[href="${href}"]`);
    expect(event.defaultPrevented).toBe(false);
    expect(h.events).toEqual([]);
  });

  test("a bare '#' link and a same-page fragment link are untouched", () => {
    const h = load(LESSON_URL);
    const a = h.doc.createElement("a");
    a.setAttribute("href", "#");
    a.id = "bare";
    const b = h.doc.createElement("a");
    b.setAttribute("href", "lesson_earths-layers.html#explore");
    b.id = "same";
    h.doc.body.append(a, b);
    expect(h.click("#bare").defaultPrevented).toBe(false);
    expect(h.click("#same").defaultPrevented).toBe(false);
    expect(h.events).toEqual([]);
  });

  test("the application shell link (/app/) keeps native behavior", () => {
    const h = load(LESSON_URL);
    expect(h.click('a[href="/app/"]').defaultPrevented).toBe(false);
    expect(h.events).toEqual([]);
  });

  test.each([
    "https://example.org/x.html",
    `https://lyfelabz.com/app/lessons/lesson_gravity.html`,
    "/lesson_gravity.html",
    "mailto:x@example.org",
  ])("an external, cross-origin, or public root link (%s) is untouched", (href) => {
    const h = load(LESSON_URL);
    const a = h.doc.createElement("a");
    a.setAttribute("href", href);
    a.id = "x";
    h.doc.body.append(a);
    expect(h.click("#x").defaultPrevented).toBe(false);
    expect(h.events).toEqual([]);
  });

  test.each([
    [{ metaKey: true }],
    [{ ctrlKey: true }],
    [{ shiftKey: true }],
    [{ altKey: true }],
    [{ button: 1 }],
  ])("modified or non-primary clicks keep native behavior %p", (init) => {
    const h = load(LESSON_URL);
    expect(h.click('a[href="lesson_earthquakes.html"]', init as MouseEventInit).defaultPrevented).toBe(false);
    expect(h.events).toEqual([]);
  });

  test("links with a target or download attribute keep native behavior", () => {
    const h = load(LESSON_URL);
    const a = h.doc.createElement("a");
    a.setAttribute("href", "lesson_gravity.html");
    a.setAttribute("target", "_blank");
    a.id = "t";
    const d = h.doc.createElement("a");
    d.setAttribute("href", "lesson_gravity.html");
    d.setAttribute("download", "");
    d.id = "d";
    h.doc.body.append(a, d);
    expect(h.click("#t").defaultPrevented).toBe(false);
    expect(h.click("#d").defaultPrevented).toBe(false);
    expect(h.events).toEqual([]);
  });

  test("a click a lesson handler already handled is untouched", () => {
    const h = load(LESSON_URL);
    h.doc.querySelector('a[href="lesson_earthquakes.html"]')!.addEventListener("click", (e) => e.preventDefault());
    h.click('a[href="lesson_earthquakes.html"]');
    expect(h.events).toEqual([]);
  });

  test("quiz controls and other buttons are never touched", () => {
    const h = load(LESSON_URL);
    const buttons = Array.from(h.doc.querySelectorAll("button"));
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      const event = new h.dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
      button.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(h.events).toEqual([]);
  });

  test("a click on content inside a link is handled like the link", async () => {
    const h = load(LESSON_URL);
    const a = h.doc.querySelector('a[href="lesson_hotspot-volcanoes.html"]')!;
    const inner = h.doc.createElement("span");
    a.appendChild(inner);
    const event = new h.dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    inner.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await h.flush();
    expect(h.assign).toHaveBeenCalledWith(`${ORIGIN}/app/lessons/lesson_hotspot-volcanoes.html`);
  });

  test.each(["reject", "throw"] as const)("failed preparation (%s) still follows the link exactly once", async (fetchMode) => {
    const h = load(LESSON_URL, { fetchMode });
    h.click('a[href="lesson_earthquakes.html"]');
    await h.flush();
    expect(h.assign).toHaveBeenCalledTimes(1);
    expect(h.assign).toHaveBeenCalledWith(`${ORIGIN}/app/lessons/lesson_earthquakes.html`);
  });

  test("a hung preparation follows the link when the timeout fires", async () => {
    const h = load(LESSON_URL, { fetchMode: "hang" });
    h.click('a[href="lesson_earthquakes.html"]');
    await h.flush();
    expect(h.assign).not.toHaveBeenCalled();
    expect(h.timers).toHaveLength(1);
    h.timers[0]!();
    await h.flush();
    expect(h.assign).toHaveBeenCalledTimes(1);
  });

  test.each([
    "app/lessons/assessment-revisions/lesson_earths-layers__r1.html",
    "app/lessons/assessment-revisions/lesson_earths-layers__r2.html",
    ...fs
      .readdirSync(path.join(REPO_ROOT, "app/lessons/variants"))
      .filter((f) => f.endsWith(".html"))
      .map((f) => `app/lessons/variants/${f}`),
  ])("retained variant / rendition page %s is covered without modification", async (relative) => {
    const html = fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
    const h = load(`${ORIGIN}/${relative}#assignment=a&launchRef=${"f".repeat(32)}`, { html });
    // Each retained page is exercised through its own first relocated
    // in-lesson link (every retained lesson has one), to another lesson.
    const own = /lesson_([a-z0-9-]+?)(?:__|\.html)/.exec(path.basename(relative))![1];
    const href = h.doc.querySelector('a[href^="/app/lessons/lesson_"]')?.getAttribute("href");
    expect(href).toMatch(/^\/app\/lessons\/lesson_[a-z0-9-]+\.html$/);
    expect(href).not.toBe(`/app/lessons/lesson_${own}.html`);
    const event = h.click(`a[href="${href}"]`);
    expect(event.defaultPrevented).toBe(true);
    await h.flush();
    const target = `${ORIGIN}${href}`;
    expect(h.events).toEqual([`GET reload ${target}`, `body read ${target}`, `navigate ${target}`]);
  });
});

describe("runtime shim - public root pages are unaffected", () => {
  test("on /lesson_*.html nothing is installed", () => {
    const h = load(`${ORIGIN}/lesson_earths-layers.html`);
    const a = h.doc.createElement("a");
    a.setAttribute("href", "/app/lessons/lesson_gravity.html");
    a.id = "z";
    h.doc.body.append(a);
    expect(h.click('a[href="lesson_plate-tectonics.html"]').defaultPrevented).toBe(false);
    expect(h.click("#z").defaultPrevented).toBe(false);
    expect(h.events).toEqual([]);
  });

  test("practice mode stays inert: runtime stub installed, no request until a link is followed", () => {
    const h = load(LESSON_URL);
    expect(h.win.lyfelabz?.assessmentRuntime?.mode).toBe("inert");
    expect(h.events).toEqual([]);
  });
});
