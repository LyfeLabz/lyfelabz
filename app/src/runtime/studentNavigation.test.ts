/**
 * @jest-environment node
 */

jest.mock("firebase/app", () => ({ getApps: () => [], initializeApp: jest.fn() }));
jest.mock("firebase/auth", () => ({
  connectAuthEmulator: jest.fn(),
  getAuth: jest.fn(),
  onAuthStateChanged: jest.fn(),
}));
jest.mock("firebase/functions", () => ({
  connectFunctionsEmulator: jest.fn(),
  getFunctions: jest.fn(),
  httpsCallable: jest.fn(),
}));

import * as fs from "fs";
import * as path from "path";
import * as vm from "vm";
import { JSDOM, VirtualConsole } from "jsdom";

import { createBrowserLaunchExecuteDeps } from "../assignments/studentList/browserLaunch";
import {
  EXPLORE_CATALOG_PATH,
  MY_SCIENCE_PATH,
  STUDENT_NAV_MODE_KEY,
  clearStudentNavigation,
  enterAssignmentDelivery,
  enterStudentExploration,
  readStudentNavigation,
} from "../assignments/studentList/deliveryContext";
import { executeLaunch } from "../assignments/studentList/launchRouting";
import { renderDeepLinkArrival } from "../assignments/deepLink/arrival";
import { createRouteTable } from "../router/routes";
import type { SurfaceDeps } from "../router/surfaces";
import type { Session } from "../session/types";
import { __internal } from "./entry";
import { createAssessmentRuntime } from "./orchestrator";
import type { FinalizeResult, RuntimeCallables } from "./types";

// Student navigation has two explicit per-tab modes (deliveryContext.ts):
//
//   assignment delivery: the assigned lesson's existing header return link
//     becomes Back to My Science (no added control), guarded by the approved
//     unfinished-work warning;
//   exploration: My Science -> Explore LyfeLabz -> the public catalog, which
//     offers Back to My Science; topics and lessons keep normal navigation.
//
// The shared runtime shim (assets/lyfelabz-assessment-runtime.js) is evaluated
// against REAL generated pages with a fake location (jsdom cannot navigate) and
// jsdom's own sessionStorage. Finalize-state tests drive the REAL active-bundle
// adapter (entry.ts installLessonQuiz) over the real orchestrator against that
// same shim state, so "finalized" is the canonical runtime state, never page
// text. The catalog tests run index.html's own inline exploration script.

const REPO_ROOT = path.resolve(__dirname, "../../..");
const read = (rel: string): string => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");
const SHIM_SOURCE = read("assets/lyfelabz-assessment-runtime.js");
const APP_LESSON = read("app/lessons/lesson_water-cycle.html");
const PUBLIC_LESSON = read("lesson_water-cycle.html");
const CATALOG = read("index.html");
const ORIGIN = "https://lyfelabz-staging.web.app";
const LESSON_URL = `${ORIGIN}/app/lessons/lesson_water-cycle.html`;
const ASSIGNED_URL = `${LESSON_URL}#assignment=asg-1&launchRef=${"a".repeat(32)}`;
const PRESENT_KEY = "lyfelabz.presentMode.returnContext";
const PRESENT_VALUE = '{"version":1,"returnSurface":"curriculum"}';
const EXIT = '[data-testid="back-to-my-science"]';
const ASSIGNMENT_TAB = { [STUDENT_NAV_MODE_KEY]: "assignment" };
const EXPLORE_TAB = { [STUDENT_NAV_MODE_KEY]: "explore" };

type Win = {
  location: Record<string, unknown>;
  document: Document;
  sessionStorage: Storage;
  lyfelabz?: Record<string, any>;
  [k: string]: unknown;
};

type Harness = {
  dom: JSDOM;
  doc: Document;
  win: Win;
  assign: jest.Mock;
  click(selector: string, init?: MouseEventInit): MouseEvent;
  key(key: string, init?: KeyboardEventInit): KeyboardEvent;
  back(): HTMLAnchorElement;
  exit(): HTMLAnchorElement | null;
  dialog(): Element | null;
};

function load(
  pageUrl: string,
  opts: { html?: string; storage?: Record<string, string>; blockedStorage?: boolean } = {},
): Harness {
  const dom = new JSDOM(opts.html ?? APP_LESSON, { url: pageUrl, virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  for (const [k, v] of Object.entries(opts.storage ?? {})) dom.window.sessionStorage.setItem(k, v);
  const parsed = new URL(pageUrl);
  const assign = jest.fn();
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
    fetch: () => Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) }),
  } as unknown as Win;
  Object.defineProperty(win, "sessionStorage", {
    get(): Storage {
      if (opts.blockedStorage) throw new Error("blocked");
      return dom.window.sessionStorage;
    },
  });
  vm.runInContext(SHIM_SOURCE, vm.createContext({ window: win, URL, Promise, setTimeout, clearTimeout }));
  return {
    dom,
    doc,
    win,
    assign,
    click(selector, init = {}) {
      const el = doc.querySelector(selector);
      if (el === null) throw new Error(`missing element ${selector}`);
      const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
      el.dispatchEvent(event);
      return event;
    },
    key(key, init = {}) {
      const event = new dom.window.KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
      doc.dispatchEvent(event);
      return event;
    },
    back: () => doc.querySelector<HTMLAnchorElement>("nav a.nav-back")!,
    exit: () => doc.querySelector<HTMLAnchorElement>(EXIT),
    dialog: () => doc.querySelector('[role="dialog"]'),
  };
}

const visibleText = (el: Element): string =>
  Array.from(el.childNodes)
    .filter((n) => !(n.nodeType === 1 && (n as Element).getAttribute("aria-hidden") === "true"))
    .map((n) => n.textContent)
    .join("");

// A header left exactly as the page shipped it.
function expectNormalHeader(h: Harness, label: string, href: string): void {
  expect(h.exit()).toBeNull();
  expect(h.back().textContent).toBe(label);
  expect(h.back().getAttribute("href")).toBe(href);
  expect(h.doc.getElementById("lyfelabz-student-nav-style")).toBeNull();
}

// ── Mode transitions (deliveryContext.ts) ─────────────────────────────────────
describe("student navigation mode", () => {
  const tab = () => new JSDOM("", { url: `${ORIGIN}/app/student` });

  test("My Science assignment launch enters assignment mode before navigating", async () => {
    const dom = tab();
    enterStudentExploration(dom.window as unknown as Window);
    const events: string[] = [];
    const win = {
      sessionStorage: dom.window.sessionStorage,
      location: {
        assign: (u: string) => events.push(`assign ${u} mode=${dom.window.sessionStorage.getItem(STUDENT_NAV_MODE_KEY)}`),
      },
      fetch: () => Promise.reject(new Error("offline")),
    } as unknown as Window;
    await executeLaunch(
      { primaryUrl: "/app/lessons/lesson_gravity.html#assignment=a1", differentiated: false, canonicalUrl: "/app/lessons/lesson_gravity.html#assignment=a1", differentiatedRejected: false },
      createBrowserLaunchExecuteDeps(win),
    );
    // Exploration -> a later assignment launch is assignment delivery again.
    expect(events).toEqual(["assign /app/lessons/lesson_gravity.html#assignment=a1 mode=assignment"]);
  });

  test("/app/a/{id} arrival enters assignment mode through the same launch seam", async () => {
    const dom = new JSDOM("", { url: `${ORIGIN}/app/a/assign-1` });
    const assigned: string[] = [];
    const win = {
      sessionStorage: dom.window.sessionStorage,
      location: { assign: (u: string) => assigned.push(`${u} mode=${dom.window.sessionStorage.getItem(STUDENT_NAV_MODE_KEY)}`) },
      fetch: () => Promise.reject(new Error("offline")),
    } as unknown as Window;
    const launchDeps = createBrowserLaunchExecuteDeps(win);
    // The arrival surface renders through the global document.
    const g = globalThis as { document?: Document };
    g.document = dom.window.document;
    await renderDeepLinkArrival(dom.window.document.body, {
      assignmentId: "assign-1",
      resolve: jest.fn().mockResolvedValue({
        assignmentId: "assign-1",
        classId: "class-1",
        lessonSlug: "what-is-life",
        internalTarget: "assignmentLaunch",
        attemptContext: "authorized",
        assessmentRevisionId: "assessment_what-is-life__r1",
      }),
      navigate: launchDeps.navigate,
      onGoToMyAssignments: jest.fn(),
    });
    delete g.document;
    expect(assigned).toEqual(["/app/lessons/lesson_what-is-life.html#assignment=assign-1 mode=assignment"]);
  });

  test("explicit transitions overwrite each other; sign-out clears; nothing else is stored", () => {
    const dom = tab();
    const win = dom.window as unknown as Window;
    enterAssignmentDelivery(win);
    expect(readStudentNavigation(win)).toBe("assignment");
    enterStudentExploration(win);
    expect(readStudentNavigation(win)).toBe("explore");
    enterAssignmentDelivery(win);
    expect(readStudentNavigation(win)).toBe("assignment");
    expect(dom.window.sessionStorage.length).toBe(1);
    expect(dom.window.localStorage.length).toBe(0);
    clearStudentNavigation(win);
    expect(readStudentNavigation(win)).toBeNull();
    expect(dom.window.sessionStorage.length).toBe(0);
  });

  test("missing, unknown, or unreadable storage reads as no mode and never throws", () => {
    const dom = tab();
    const win = dom.window as unknown as Window;
    expect(readStudentNavigation(win)).toBeNull();
    dom.window.sessionStorage.setItem(STUDENT_NAV_MODE_KEY, "1");
    expect(readStudentNavigation(win)).toBeNull();
    const blocked = { get sessionStorage(): Storage { throw new Error("blocked"); } } as unknown as Window;
    expect(() => enterAssignmentDelivery(blocked)).not.toThrow();
    expect(() => enterStudentExploration(blocked)).not.toThrow();
    expect(() => clearStudentNavigation(blocked)).not.toThrow();
    expect(readStudentNavigation(blocked)).toBeNull();
  });

  test("the shim and catalog copies of the key, values, and destinations match the application module", () => {
    expect(SHIM_SOURCE).toContain(`var STUDENT_NAV_KEY = '${STUDENT_NAV_MODE_KEY}';`);
    expect(SHIM_SOURCE).toContain("var STUDENT_NAV_ASSIGNMENT = 'assignment';");
    expect(SHIM_SOURCE).toContain(`var MY_SCIENCE_PATH = '${MY_SCIENCE_PATH}';`);
    expect(CATALOG).toContain(`sessionStorage.getItem('${STUDENT_NAV_MODE_KEY}') === 'explore'`);
    // The static catalog links to the shell file (/app/), which renders My
    // Science for a signed-in student; /app/student is a Hosting rewrite.
    expect(CATALOG).toContain('href="/app/" class="nav-back" id="myScienceReturn"');
    expect(EXPLORE_CATALOG_PATH).toBe("/");
  });
});

// ── Assignment delivery: the assigned lesson's header ─────────────────────────
describe("assignment delivery header", () => {
  test("the existing header return link becomes Back to My Science; no control is added", () => {
    const before = load(LESSON_URL);
    expectNormalHeader(before, "← Earth & Space", "index.html#geo");

    const h = load(ASSIGNED_URL, { storage: ASSIGNMENT_TAB });
    const exit = h.exit()!;
    // The SAME header element, transformed in place.
    expect(exit).toBe(h.back());
    expect(exit.classList.contains("nav-back")).toBe(true);
    expect(exit.parentElement!.tagName).toBe("NAV");
    expect(exit.getAttribute("href")).toBe("/app/student");
    expect(visibleText(exit)).toBe("Back to My Science");
    expect(exit.querySelector('[aria-hidden="true"]')!.textContent).toBe("←");
    expect(h.doc.querySelectorAll("a.nav-back")).toHaveLength(1);
    expect(h.doc.querySelectorAll(EXIT)).toHaveLength(1);
    // Nothing floating: no prototype pill, and the injected CSS positions only
    // the dialog overlay.
    expect(h.doc.querySelector(".lyfelabz-back-to-my-science, #lyfelabz-back-to-my-science")).toBeNull();
    const css = h.doc.getElementById("lyfelabz-student-nav-style")!.textContent!;
    expect(css).not.toContain("lyfelabz-back-to-my-science");
    expect(css).not.toMatch(/safe-area|z-index:990/);
    expect(css.match(/position:fixed/g)).toHaveLength(1);
    expect(css).toContain(".lyfelabz-leave-overlay{position:fixed");
    expect(SHIM_SOURCE).not.toMatch(/history\.(back|go)\(/);
    expect(SHIM_SOURCE).not.toMatch(/lyfelabz-back-to-my-science|z-index:990|safe-area-inset/);
  });

  test("the fragment alone is assignment evidence (reload, missing tab mode)", () => {
    expect(load(ASSIGNED_URL).exit()).not.toBeNull();
    expect(load(ASSIGNED_URL, { blockedStorage: true }).exit()).not.toBeNull();
  });

  test("the LYFELABZ wordmark leads to My Science through the same check", () => {
    const h = load(ASSIGNED_URL);
    expect(h.doc.querySelector("nav a.nav-logo")!.getAttribute("href")).toBe("/app/student");
    expect(h.click("nav a.nav-logo").defaultPrevented).toBe(true);
    expect(h.dialog()).not.toBeNull();
  });

  test("the legacy Back to My Assignments link is hidden so there is one student exit", () => {
    const h = load(ASSIGNED_URL);
    expect(h.doc.getElementById("back-to-assignments")).not.toBeNull();
    expect(h.doc.getElementById("lyfelabz-student-nav-style")!.textContent).toContain("#back-to-assignments{display:none!important}");
  });

  const RENDITIONS = [
    ...fs.readdirSync(path.join(REPO_ROOT, "app/lessons")).filter((f) => /^lesson_.*\.html$/.test(f)).map((f) => `app/lessons/${f}`),
    ...fs.readdirSync(path.join(REPO_ROOT, "app/lessons/variants")).filter((f) => f.endsWith(".html")).map((f) => `app/lessons/variants/${f}`),
    ...fs.readdirSync(path.join(REPO_ROOT, "app/lessons/assessment-revisions")).filter((f) => f.endsWith(".html")).map((f) => `app/lessons/assessment-revisions/${f}`),
  ];

  test("covers every app lesson, immutable variant, and assessment rendition without editing them", () => {
    expect(RENDITIONS.length).toBe(49 + 9 + 6);
  });

  test.each(RENDITIONS)("%s: assigned header becomes Back to My Science", (rel) => {
    const h = load(`${ORIGIN}/${rel}#assignment=asg-1`, { html: read(rel) });
    expect(h.exit()).not.toBeNull();
    expect(h.exit()).toBe(h.back());
    expect(h.exit()!.getAttribute("href")).toBe("/app/student");
  });
});

// ── Unfinished-work warning (approved behavior, unchanged) ─────────────────────
describe("unfinished work warning", () => {
  test("unfinished: warning appears, Stay closes it, focus returns, nothing navigates", () => {
    const h = load(ASSIGNED_URL);
    const event = h.click(EXIT);
    expect(event.defaultPrevented).toBe(true);
    const d = h.dialog()!;
    expect(d.getAttribute("aria-modal")).toBe("true");
    expect(d.getAttribute("aria-labelledby")).toBe("lyfelabz-leave-title");
    expect(d.textContent).toContain("You haven't submitted this assignment yet. If you leave now, your current work may not appear when you return.");
    expect(h.doc.activeElement!.textContent).toBe("Stay");
    h.click('[data-testid="leave-stay"]');
    expect(h.dialog()).toBeNull();
    expect(h.assign).not.toHaveBeenCalled();
    expect(h.doc.activeElement).toBe(h.exit());
  });

  test("Stay preserves visible page state", () => {
    const h = load(ASSIGNED_URL);
    const main = h.doc.getElementById("main")!.outerHTML;
    h.click(EXIT);
    h.click('[data-testid="leave-stay"]');
    expect(h.doc.getElementById("main")!.outerHTML).toBe(main);
  });

  test("Escape stays; focus is trapped between the two buttons", () => {
    const h = load(ASSIGNED_URL);
    h.click(EXIT);
    const stay = h.doc.querySelector<HTMLElement>('[data-testid="leave-stay"]')!;
    const go = h.doc.querySelector<HTMLElement>('[data-testid="leave-confirm"]')!;
    go.focus();
    expect(h.key("Tab").defaultPrevented).toBe(true);
    expect(h.doc.activeElement).toBe(stay);
    expect(h.key("Tab", { shiftKey: true }).defaultPrevented).toBe(true);
    expect(h.doc.activeElement).toBe(go);
    h.key("Escape");
    expect(h.dialog()).toBeNull();
    expect(h.doc.activeElement).toBe(h.exit());
    expect(h.assign).not.toHaveBeenCalled();
  });

  test("a second click while the warning is open does not stack dialogs", () => {
    const h = load(ASSIGNED_URL);
    h.click(EXIT);
    h.click(EXIT);
    expect(h.doc.querySelectorAll('[role="dialog"]')).toHaveLength(1);
  });

  test("confirming navigates to My Science, once", () => {
    const h = load(ASSIGNED_URL);
    h.click(EXIT);
    h.click('[data-testid="leave-confirm"]');
    expect(h.assign).toHaveBeenCalledTimes(1);
    expect(h.assign).toHaveBeenCalledWith("/app/student");
  });

  test("modified clicks (open in new tab) keep native behavior and do not warn", () => {
    const h = load(ASSIGNED_URL);
    expect(h.click(EXIT, { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(h.click(EXIT, { metaKey: true }).defaultPrevented).toBe(false);
    expect(h.dialog()).toBeNull();
  });
});

// ── Canonical finalize state, via the real active-bundle adapter ──────────────
const FINALIZE_RESULT: FinalizeResult = {
  attemptId: "asg-1__student-1__a1",
  attemptNumber: 1,
  score: 1,
  maxScore: 1,
  percentage: 100,
  itemResults: [],
  replay: false,
};

function wireAdapter(h: Harness, finalize: () => Promise<FinalizeResult>, calls: string[] = []) {
  const callables: RuntimeCallables = {
    begin: async () => {
      calls.push("begin");
      return { sessionId: "s", resumed: false } as never;
    },
    autosave: async () => {
      calls.push("autosave");
      return { persisted: true } as never;
    },
    finalize: async () => {
      calls.push("finalize");
      return finalize();
    },
    getAttempt: async () => ({}) as never,
  } as unknown as RuntimeCallables;
  const runtime = createAssessmentRuntime({
    version: "t",
    assignmentId: "asg-1",
    launchRef: null,
    callables,
    env: { randomId: () => "k" },
  } as never);
  __internal.installLessonQuiz(h.win as never, runtime, true);
  return h.win.lyfelabz!.lessonQuiz as { finalize: (s: ReadonlyArray<number | null>) => Promise<{ ok: boolean }> };
}

describe("finalization state", () => {
  test("a successful finalize latches finalized: navigation is immediate with no warning", async () => {
    const h = load(ASSIGNED_URL);
    const quiz = wireAdapter(h, async () => FINALIZE_RESULT);
    expect((await quiz.finalize([0])).ok).toBe(true);
    expect(h.win.lyfelabz!.deliveryNavigation.state()).toBe("finalized");
    expect(h.click(EXIT).defaultPrevented).toBe(false);
    expect(h.click("nav a.nav-logo").defaultPrevented).toBe(false);
    expect(h.dialog()).toBeNull();
  });

  test("a failed or refused finalize is still unfinished: warning appears", async () => {
    const h = load(ASSIGNED_URL);
    const quiz = wireAdapter(h, async () => {
      throw new Error("refused");
    });
    expect((await quiz.finalize([0])).ok).toBe(false);
    expect(h.win.lyfelabz!.deliveryNavigation.state()).toBe("open");
    expect(h.click(EXIT).defaultPrevented).toBe(true);
    expect(h.dialog()!.textContent).toContain("haven't submitted");
  });

  test("a finalize still in flight warns with truthful copy, and a later success is immediate", async () => {
    const h = load(ASSIGNED_URL);
    let release!: (r: FinalizeResult) => void;
    const quiz = wireAdapter(h, () => new Promise<FinalizeResult>((res) => (release = res)));
    const pending = quiz.finalize([0]);
    await new Promise((r) => setTimeout(r, 0));
    expect(h.win.lyfelabz!.deliveryNavigation.state()).toBe("submitting");
    h.click(EXIT);
    expect(h.dialog()!.textContent).toContain("Your assignment is still being submitted. If you leave now, it might not be recorded.");
    h.click('[data-testid="leave-stay"]');
    release(FINALIZE_RESULT);
    await pending;
    expect(h.click(EXIT).defaultPrevented).toBe(false);
  });

  test("a failure after an earlier success does not un-finalize", () => {
    const h = load(ASSIGNED_URL);
    const nav = h.win.lyfelabz!.deliveryNavigation;
    nav.finalizeStarted();
    nav.finalizeSettled(true);
    nav.finalizeStarted();
    nav.finalizeSettled(false);
    expect(nav.state()).toBe("finalized");
  });

  test("without the active bundle (never loaded) the state stays unfinished", () => {
    const h = load(ASSIGNED_URL);
    expect(h.win.lyfelabz!.deliveryNavigation.state()).toBe("open");
    expect(h.click(EXIT).defaultPrevented).toBe(true);
  });

  test("using the exit (warn, stay, leave) performs no assessment calls and no storage writes", () => {
    const h = load(ASSIGNED_URL, { storage: ASSIGNMENT_TAB });
    const calls: string[] = [];
    wireAdapter(h, async () => FINALIZE_RESULT, calls);
    const before = JSON.stringify({ ...h.dom.window.sessionStorage });
    h.click(EXIT);
    h.click('[data-testid="leave-stay"]');
    h.click("nav a.nav-logo");
    h.click('[data-testid="leave-stay"]');
    h.click(EXIT);
    h.click('[data-testid="leave-confirm"]');
    expect(calls).toEqual([]);
    expect(h.win.lyfelabz!.deliveryNavigation.state()).toBe("open");
    expect(JSON.stringify({ ...h.dom.window.sessionStorage })).toBe(before);
    expect(h.dom.window.localStorage.length).toBe(0);
    expect(h.win.location.hash).toBe(new URL(ASSIGNED_URL).hash);
  });
});

// ── Contexts that keep normal navigation ──────────────────────────────────────
describe("normal navigation outside assignment delivery", () => {
  test("Teacher Preview (fresh noopener tab: no fragment, no mode) keeps the topic link", () => {
    expectNormalHeader(load(LESSON_URL), "← Earth & Space", "index.html#geo");
  });

  test("Present Mode is unaffected, even with assignment evidence", () => {
    const present = { [PRESENT_KEY]: PRESENT_VALUE };
    expectNormalHeader(load(LESSON_URL, { storage: present }), "← Earth & Space", "index.html#geo");
    expectNormalHeader(load(ASSIGNED_URL, { storage: { ...present, ...ASSIGNMENT_TAB } }), "← Earth & Space", "index.html#geo");
  });

  test("public visitors and exploration on the root lessons keep normal hierarchy navigation", () => {
    for (const storage of [{}, EXPLORE_TAB, ASSIGNMENT_TAB]) {
      const h = load(`${ORIGIN}/lesson_water-cycle.html`, { html: PUBLIC_LESSON, storage });
      expectNormalHeader(h, "← Earth & Space", "index.html#geo");
    }
    // Even a stray fragment on a public page changes nothing.
    expectNormalHeader(load(`${ORIGIN}/lesson_water-cycle.html#assignment=asg-1`, { html: PUBLIC_LESSON }), "← Earth & Space", "index.html#geo");
  });

  test("exploration mode never turns an app page into assignment delivery", () => {
    expectNormalHeader(load(LESSON_URL, { storage: EXPLORE_TAB }), "← Earth & Space", "index.html#geo");
  });

  test("stale or foreign tab state fails safe (prototype marker, wrong value, blocked storage)", () => {
    expectNormalHeader(load(LESSON_URL, { storage: { "lyfelabz.studentDelivery.v1": "1" } }), "← Earth & Space", "index.html#geo");
    expectNormalHeader(load(LESSON_URL, { storage: { [STUDENT_NAV_MODE_KEY]: "true" } }), "← Earth & Space", "index.html#geo");
    expectNormalHeader(load(LESSON_URL, { blockedStorage: true }), "← Earth & Space", "index.html#geo");
  });
});

// ── Companion and connected pages reached from an assigned lesson ─────────────
describe("companion navigation in an assignment tab", () => {
  const companion = (file: string, storage: Record<string, string> = ASSIGNMENT_TAB) =>
    load(`${ORIGIN}/app/lessons/${file}`, { html: read(file), storage });

  test("a parent-lesson link stays local navigation, unchanged", () => {
    expectNormalHeader(companion("extension_fossil-hunt.html"), "← Layers of Time", "lesson_layers-of-time.html");
    expectNormalHeader(companion("simulation_eclipse-alignment.html"), "← Eclipses", "lesson_eclipses.html");
    expectNormalHeader(companion("game_photon-runner.html"), "← Wave Behavior Lesson", "lesson_wave-behavior.html");
  });

  test("a catalog link (the app shell under /app/lessons/) becomes Back to My Science, without a warning", () => {
    const h = companion("extension_hidden-world-of-matter.html");
    expect(h.exit()).toBe(h.back());
    expect(h.exit()!.getAttribute("href")).toBe("/app/student");
    expect(h.click(EXIT).defaultPrevented).toBe(false);
    expect(h.dialog()).toBeNull();
    // No assignment on the page: the wordmark and legacy link are untouched.
    expect(h.doc.querySelector("nav a.nav-logo")!.getAttribute("href")).toBe("index.html");
    expect(h.doc.getElementById("lyfelabz-student-nav-style")).toBeNull();
  });

  test("a connected lesson (no fragment) offers Back to My Science with no false warning", () => {
    const h = load(LESSON_URL, { storage: ASSIGNMENT_TAB });
    expect(h.exit()).toBe(h.back());
    expect(h.click(EXIT).defaultPrevented).toBe(false);
    expect(h.dialog()).toBeNull();
  });

  test("the same companions outside an assignment tab are untouched", () => {
    expectNormalHeader(companion("extension_hidden-world-of-matter.html", {}), "← Physical Science", "index.html#chem");
    expectNormalHeader(companion("extension_hidden-world-of-matter.html", EXPLORE_TAB), "← Physical Science", "index.html#chem");
  });
});

// ── Exploration: My Science -> Explore LyfeLabz -> catalog ────────────────────
function studentSession(): Session {
  return Object.freeze({ kind: "activeStudent", uid: "u1", schoolId: "s1", displayName: "Ben" }) as unknown as Session;
}

function renderMyScience(onEnterExploration: () => void) {
  const dom = new JSDOM('<div id="app-root"></div>', { url: `${ORIGIN}/app/student`, virtualConsole: new VirtualConsole() });
  const reject = () => Promise.reject(new Error("not wired"));
  const deps = {
    onSignOut: jest.fn(),
    onSignIn: reject,
    onRefreshSession: reject,
    onRequestVerification: reject,
    onActivatePilotTeacher: reject,
    listClasses: reject,
    onLaunchPresentMode: () => undefined,
    onEnterExploration,
  } as unknown as SurfaceDeps;
  const mount = dom.window.document.getElementById("app-root")!;
  createRouteTable(deps).activeStudent(studentSession(), mount);
  return { dom, mount };
}

function loadCatalog(storage: Record<string, string>) {
  const dom = new JSDOM(CATALOG, { url: `${ORIGIN}/`, runScripts: "outside-only", virtualConsole: new VirtualConsole() });
  for (const [k, v] of Object.entries(storage)) dom.window.sessionStorage.setItem(k, v);
  const script = Array.from(dom.window.document.scripts).find((s) => s.textContent!.includes(STUDENT_NAV_MODE_KEY));
  dom.window.eval(script!.textContent!);
  return dom.window.document.querySelector<HTMLAnchorElement>('[data-testid="catalog-back-to-my-science"]')!;
}

describe("exploration", () => {
  test("My Science shows exactly one Explore LyfeLabz pill, right of the title in the title bar", () => {
    const { mount } = renderMyScience(jest.fn());
    const actions = mount.querySelectorAll<HTMLAnchorElement>('[data-testid="explore-lyfelabz"]');
    expect(actions).toHaveLength(1);
    const link = actions[0];
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/");
    expect(link.className).toBe("student-explore-link");
    expect(visibleText(link)).toBe("Explore LyfeLabz");
    expect(link.querySelector('[aria-hidden="true"]')!.textContent).toBe("→");
    // In the title bar, after the "My Science" heading (which stays the h1).
    const titleBar = mount.querySelector('[data-testid="my-science-titlebar"]')!;
    expect(link.parentElement).toBe(titleBar);
    expect(titleBar.firstElementChild!.tagName).toBe("H1");
    expect(titleBar.firstElementChild!.textContent).toBe("My Science");
    expect(titleBar.lastElementChild).toBe(link);
    expect(mount.querySelectorAll("h1")).toHaveLength(1);
    // Not in the account row beside Sign out, not in the work panel, and the
    // old standalone link after the work panel is gone.
    expect(mount.querySelector('[data-testid="student-header"]')!.contains(link)).toBe(false);
    expect(mount.querySelector('[data-testid="my-science-panel"]')!.contains(link)).toBe(false);
    expect(mount.lastElementChild!.getAttribute("data-testid")).toBe("my-science-panel");
    // Navigation, never a primary launch control.
    expect(link.matches("button, [data-testid=assignments-launch]")).toBe(false);
  });

  test("the title bar wraps instead of overflowing; the pill is an outlined navigation pill", () => {
    const css = read("app/index.html");
    const rule = (selector: string): string => {
      const at = css.indexOf(`${selector} {`);
      expect(at).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf("}", at));
    };
    const scope = "body:not(:has(#app-root > .shell-header))";
    const bar = rule(`${scope} .my-science-titlebar`);
    expect(bar).toContain("display: flex;");
    expect(bar).toContain("flex-wrap: wrap;");
    expect(bar).toContain("justify-content: space-between;");
    const title = rule(`${scope} .my-science-titlebar h1`);
    expect(title).toContain("min-width: 0;");
    const pill = rule(`${scope} .student-explore-link`);
    expect(pill).toContain("border-radius: var(--tw-radius-pill);");
    expect(pill).toContain("background: transparent;");
    expect(pill).toContain("white-space: nowrap;");
    expect(pill).not.toContain("--tw-primary");
    expect(css).toContain(`${scope} .student-explore-link { min-height: 44px; }`);
  });

  test("choosing it records exploration, then the catalog shows Back to My Science", () => {
    const { dom, mount } = renderMyScience(() => enterStudentExploration(dom.window as unknown as Window));
    enterAssignmentDelivery(dom.window as unknown as Window);
    const link = mount.querySelector<HTMLAnchorElement>('[data-testid="explore-lyfelabz"]')!;
    const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    link.dispatchEvent(event);
    // Native navigation proceeds to the catalog.
    expect(event.defaultPrevented).toBe(false);
    expect(dom.window.sessionStorage.getItem(STUDENT_NAV_MODE_KEY)).toBe("explore");

    const back = loadCatalog({ [STUDENT_NAV_MODE_KEY]: dom.window.sessionStorage.getItem(STUDENT_NAV_MODE_KEY)! });
    expect(back.hidden).toBe(false);
    expect(back.getAttribute("href")).toBe("/app/");
    expect(visibleText(back)).toBe("Back to My Science");
    expect(back.closest("nav")).not.toBeNull();
  });

  test("a modified click (new tab) records nothing", () => {
    const onEnter = jest.fn();
    const { dom, mount } = renderMyScience(onEnter);
    const link = mount.querySelector('[data-testid="explore-lyfelabz"]')!;
    link.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, metaKey: true }));
    expect(onEnter).not.toHaveBeenCalled();
  });

  test("the catalog keeps its public appearance for everyone else", () => {
    expect(loadCatalog({}).hidden).toBe(true);
    expect(loadCatalog(ASSIGNMENT_TAB).hidden).toBe(true);
    expect(loadCatalog({ [STUDENT_NAV_MODE_KEY]: "1" }).hidden).toBe(true);
    // Normal catalog/topic navigation is all still there.
    const dom = new JSDOM(CATALOG);
    expect(dom.window.document.getElementById("geo")).not.toBeNull();
    expect(dom.window.document.querySelector('a[href="lesson_water-cycle.html"]')).not.toBeNull();
  });

  test("the catalog script fails safe when storage is unavailable", () => {
    const dom = new JSDOM(CATALOG, { url: `${ORIGIN}/`, runScripts: "outside-only", virtualConsole: new VirtualConsole() });
    Object.defineProperty(dom.window, "sessionStorage", { get() { throw new Error("blocked"); } });
    const script = Array.from(dom.window.document.scripts).find((s) => s.textContent!.includes(STUDENT_NAV_MODE_KEY))!;
    expect(() => dom.window.eval(script.textContent!)).not.toThrow();
    expect(dom.window.document.getElementById("myScienceReturn")!.hidden).toBe(true);
  });
});

// ── The transform touches only the header links ────────────────────────────────
describe("existing page contracts stay untouched", () => {
  test.each(["earths-layers", "conducting-experiments", "water-cycle"])(
    "%s: only the nav's return link and wordmark change; quiz, results, and sticky geometry are untouched",
    (slug) => {
      const html = read(`app/lessons/lesson_${slug}.html`);
      const baseline = load(`${ORIGIN}/app/lessons/lesson_${slug}.html`, { html });
      const assigned = load(`${ORIGIN}/app/lessons/lesson_${slug}.html#assignment=asg-1`, { html, storage: ASSIGNMENT_TAB });
      const navOf = (h: Harness) => Array.from(h.doc.querySelector("nav")!.children);
      const changed = navOf(assigned)
        .map((el, i) => (el.outerHTML === navOf(baseline)[i].outerHTML ? null : el.className))
        .filter((c) => c !== null);
      expect(changed.sort()).toEqual(["nav-back", "nav-logo"]);
      for (const h of [baseline, assigned]) {
        h.doc.querySelector("nav")!.remove();
        h.doc.getElementById("lyfelabz-student-nav-style")?.remove();
        // The pre-existing assignment-mode config loader is not part of this change.
        h.doc.querySelectorAll("script[data-lyfelabz-runtime]").forEach((n) => n.remove());
      }
      expect(assigned.doc.documentElement.outerHTML).toBe(baseline.doc.documentElement.outerHTML);
    },
  );
});
