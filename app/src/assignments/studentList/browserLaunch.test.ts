import * as fs from "fs";
import * as path from "path";

import { createBrowserLaunchExecuteDeps } from "./browserLaunch";
import { DELIVERY_PREPARATION_TIMEOUT_MS } from "./deliveryNavigation";
import {
  executeLaunch,
  planAssignmentLaunch,
  planPracticeLaunch,
  type LaunchPlan,
} from "./launchRouting";
import type { AssignmentsListForStudentItem } from "./types";
import { renderDeepLinkArrival } from "../deepLink/arrival";
import type { DeepLinkResolution } from "../deepLink/types";

// Policy E cache transition across every application launch path.
//
// Firebase Hosting omits custom security headers on 304 responses, so a browser
// holding a pre-Policy-E cached `/app/lessons/**` page would keep reusing it
// without the analytics-blocking CSP. Each launch therefore replaces the cached
// copy of its EXACT target (GET, cache "reload", body read) before navigating,
// and navigates with the unchanged URL (fragment and any query intact).
//
// These tests drive the real planners, executor, and arrival surface with the
// production browser wiring over a fake window, and record the order of the
// browser side effects.

const ORIGIN = "https://lyfelabz-staging.web.app";
const REF = "0123456789abcdef0123456789abcdef";
const PR = `pr${"c".repeat(64)}`;
const VARIANT = `app/lessons/variants/lesson_earths-layers__${PR}.html`;
const R1_PAGE = "/app/lessons/assessment-revisions/lesson_earths-layers__r1.html";
const R2_PAGE = "/app/lessons/assessment-revisions/lesson_earths-layers__r2.html";

type Fake = {
  readonly win: Window;
  readonly events: string[];
  readonly assign: jest.Mock;
};

function fakeWindow(opts: {
  readonly href?: string;
  readonly getFails?: boolean;
  readonly getHangs?: boolean;
  readonly headOk?: boolean;
} = {}): Fake {
  const events: string[] = [];
  const assign = jest.fn((url: string) => {
    events.push(`navigate ${url}`);
  });
  const win = {
    location: { href: opts.href ?? `${ORIGIN}/app/student`, assign },
    fetch: jest.fn((url: string, init: RequestInit) => {
      events.push(`${init.method} ${init.cache} ${url}`);
      if (init.method === "HEAD") {
        return Promise.resolve({ ok: opts.headOk ?? true } as Response);
      }
      if (opts.getHangs) return new Promise<Response>(() => undefined);
      if (opts.getFails) return Promise.reject(new TypeError("offline"));
      return Promise.resolve({
        ok: true,
        arrayBuffer: () => {
          events.push(`body read ${url}`);
          return Promise.resolve(new ArrayBuffer(0));
        },
      } as unknown as Response);
    }),
    setTimeout: (cb: () => void, ms: number) => setTimeout(cb, ms),
    clearTimeout: (h: number) => clearTimeout(h),
  } as unknown as Window;
  return { win, events, assign };
}

function item(over: Partial<AssignmentsListForStudentItem> = {}): AssignmentsListForStudentItem {
  return Object.freeze({
    assignmentId: "asg-1",
    lessonSlug: "earths-layers",
    title: "Earth's Layers",
    status: "published" as const,
    publishedAt: null,
    assessmentRevisionId: "assessment_earths-layers__r2",
    ...over,
  });
}

const presentation = Object.freeze({ variantKey: "k", presentationRevisionId: PR, path: VARIANT });

async function launch(plan: LaunchPlan | null, fake: Fake): Promise<void> {
  expect(plan).not.toBeNull();
  await executeLaunch(plan as LaunchPlan, createBrowserLaunchExecuteDeps(fake.win));
}

function prepared(pathname: string): string[] {
  return [`GET reload ${ORIGIN}${pathname}`, `body read ${ORIGIN}${pathname}`];
}

describe("My Science launches prepare their exact target before navigating", () => {
  test("canonical (revision-bound r2 rendition)", async () => {
    const fake = fakeWindow();
    await launch(planAssignmentLaunch(item()), fake);
    expect(fake.events).toEqual([...prepared(R2_PAGE), `navigate ${R2_PAGE}#assignment=asg-1`]);
  });

  test("revision-bound r1 rendition", async () => {
    const fake = fakeWindow();
    await launch(planAssignmentLaunch(item({ assessmentRevisionId: "assessment_earths-layers__r1" })), fake);
    expect(fake.events).toEqual([...prepared(R1_PAGE), `navigate ${R1_PAGE}#assignment=asg-1`]);
  });

  test("unversioned canonical lesson page", async () => {
    const fake = fakeWindow();
    await launch(
      planAssignmentLaunch(item({ lessonSlug: "gravity", assessmentRevisionId: "assessment_gravity__r1" })),
      fake,
    );
    expect(fake.events).toEqual([
      ...prepared("/app/lessons/lesson_gravity.html"),
      "navigate /app/lessons/lesson_gravity.html#assignment=asg-1",
    ]);
  });

  test("canonicalFallback keeps the launchRef in the fragment only", async () => {
    const fake = fakeWindow();
    await launch(planAssignmentLaunch(item({ launchRef: REF })), fake);
    expect(fake.events).toEqual([
      ...prepared(R2_PAGE),
      `navigate ${R2_PAGE}#assignment=asg-1&launchRef=${REF}`,
    ]);
  });

  test("differentiated: HEAD probe, then the variant itself is prepared", async () => {
    const fake = fakeWindow();
    await launch(planAssignmentLaunch(item({ presentation, launchRef: REF })), fake);
    expect(fake.events).toEqual([
      `HEAD no-store /${VARIANT}#assignment=asg-1&launchRef=${REF}`,
      ...prepared(`/${VARIANT}`),
      `navigate /${VARIANT}#assignment=asg-1&launchRef=${REF}`,
    ]);
  });

  test("differentiated probe failure prepares and opens the canonical fallback (ref discarded)", async () => {
    const fake = fakeWindow({ headOk: false });
    await launch(planAssignmentLaunch(item({ presentation, launchRef: REF })), fake);
    expect(fake.events).toEqual([
      `HEAD no-store /${VARIANT}#assignment=asg-1&launchRef=${REF}`,
      ...prepared(R2_PAGE),
      `navigate ${R2_PAGE}#assignment=asg-1`,
    ]);
  });

  test("an unsafe differentiated path prepares and opens the canonical target", async () => {
    const fake = fakeWindow();
    await launch(
      planAssignmentLaunch(item({ presentation: { ...presentation, path: "https://evil.example/x.html" }, launchRef: REF })),
      fake,
    );
    expect(fake.events).toEqual([...prepared(R2_PAGE), `navigate ${R2_PAGE}#assignment=asg-1`]);
  });
});

// The variant-load-failure anomaly is an intentional console.warn.
beforeEach(() => {
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("failure never blocks delivery", () => {
  test("a failed preparation still navigates exactly once", async () => {
    const fake = fakeWindow({ getFails: true });
    await launch(planAssignmentLaunch(item({ launchRef: REF })), fake);
    expect(fake.assign).toHaveBeenCalledTimes(1);
    expect(fake.assign).toHaveBeenCalledWith(`${R2_PAGE}#assignment=asg-1&launchRef=${REF}`);
  });

  test("a hung preparation navigates at the timeout bound", async () => {
    jest.useFakeTimers();
    try {
      const fake = fakeWindow({ getHangs: true });
      const pending = launch(planAssignmentLaunch(item()), fake);
      await Promise.resolve();
      expect(fake.assign).not.toHaveBeenCalled();
      jest.advanceTimersByTime(DELIVERY_PREPARATION_TIMEOUT_MS);
      await pending;
      expect(fake.assign).toHaveBeenCalledTimes(1);
      expect(fake.assign).toHaveBeenCalledWith(`${R2_PAGE}#assignment=asg-1`);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe("URL compatibility", () => {
  const plan = (primaryUrl: string): LaunchPlan => ({
    primaryUrl,
    canonicalUrl: primaryUrl,
    differentiated: false,
    differentiatedRejected: false,
  });

  test("a legacy query-form target is prepared and opened with its query unchanged", async () => {
    const fake = fakeWindow();
    await launch(plan("/app/lessons/lesson_gravity.html?assignment=asg-1"), fake);
    expect(fake.events).toEqual([
      ...prepared("/app/lessons/lesson_gravity.html?assignment=asg-1"),
      "navigate /app/lessons/lesson_gravity.html?assignment=asg-1",
    ]);
  });

  test("a public root lesson target is navigated without any preparation request", async () => {
    const fake = fakeWindow();
    await launch(plan("/lesson_gravity.html#assignment=asg-1"), fake);
    expect(fake.events).toEqual(["navigate /lesson_gravity.html#assignment=asg-1"]);
  });
});

describe("/app/a/{id} arrival handoff prepares its target", () => {
  function resolution(over: Partial<DeepLinkResolution> = {}): DeepLinkResolution {
    return Object.freeze({
      assignmentId: "asg-1",
      classId: "class-1",
      lessonSlug: "earths-layers",
      internalTarget: "assignmentLaunch" as const,
      attemptContext: "authorized" as const,
      assessmentRevisionId: "assessment_earths-layers__r1",
      ...over,
    });
  }

  async function arrive(res: DeepLinkResolution, fake: Fake): Promise<void> {
    const deps = createBrowserLaunchExecuteDeps(fake.win);
    const mount = document.createElement("div");
    await renderDeepLinkArrival(mount, {
      assignmentId: "asg-1",
      resolve: () => Promise.resolve(res),
      navigate: deps.navigate,
      probe: deps.probe,
      onVariantLoadFailure: deps.onVariantLoadFailure,
      prepareNavigation: deps.prepareNavigation,
      onGoToMyAssignments: () => undefined,
    });
  }

  test("assignment launch (canonical r1 rendition)", async () => {
    const fake = fakeWindow({ href: `${ORIGIN}/app/a/asg-1` });
    await arrive(resolution(), fake);
    expect(fake.events).toEqual([...prepared(R1_PAGE), `navigate ${R1_PAGE}#assignment=asg-1`]);
  });

  test("differentiated assignment launch", async () => {
    const fake = fakeWindow({ href: `${ORIGIN}/app/a/asg-1` });
    await arrive(resolution({ presentation, launchRef: REF }), fake);
    expect(fake.events).toEqual([
      `HEAD no-store /${VARIANT}#assignment=asg-1&launchRef=${REF}`,
      ...prepared(`/${VARIANT}`),
      `navigate /${VARIANT}#assignment=asg-1&launchRef=${REF}`,
    ]);
  });

  test("practice (no assignment context)", async () => {
    const fake = fakeWindow({ href: `${ORIGIN}/app/a/asg-1` });
    await arrive(resolution({ internalTarget: "lessonPractice", attemptContext: "informational" }), fake);
    expect(fake.events).toEqual([...prepared(R1_PAGE), `navigate ${R1_PAGE}`]);
  });

  test("differentiated practice", async () => {
    const fake = fakeWindow({ href: `${ORIGIN}/app/a/asg-1` });
    const plan = planPracticeLaunch("earths-layers", presentation, "assessment_earths-layers__r1");
    await launch(plan, fake);
    expect(fake.events).toEqual([
      `HEAD no-store /${VARIANT}`,
      ...prepared(`/${VARIANT}`),
      `navigate /${VARIANT}`,
    ]);
  });
});

describe("entry-point wiring", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../index.ts"), "utf8");

  test("My Science launches use the prepared browser deps", () => {
    expect(source).toContain("void executeLaunch(plan, createBrowserLaunchExecuteDeps(window));");
  });

  test("the deep-link arrival passes the same preparation through", () => {
    expect(source).toMatch(/prepareNavigation: launchDeps\.prepareNavigation,/);
  });

  test("no other full-page navigation into the delivery zone exists in the entry point", () => {
    expect(source.match(/location\.assign\(/g) ?? []).toHaveLength(0);
  });
});
