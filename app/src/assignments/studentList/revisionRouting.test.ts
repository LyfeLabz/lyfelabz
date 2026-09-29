/**
 * @jest-environment jsdom
 */

// F5.3 Slice 9D (addendum 21.5): revision-bound routing for every
// assignment-associated launch, against a SYNTHETIC multi-revision table in
// which Earth's Layers has a current r2 and a historical r1 (each with its own
// rendition). Only the bundled table module is replaced; the real committed
// table and every artifact are untouched, and no r2 payload exists.

jest.mock("./assessment-revision-paths.json", () => ({
  schemaVersion: 1,
  kind: "lyfelabz.assessmentRevisionPaths",
  lessons: {
    "earths-layers": {
      "assessment_earths-layers__r1": "/app/lessons/assessment-revisions/lesson_earths-layers__r1.html",
      "assessment_earths-layers__r2": "/app/lessons/assessment-revisions/lesson_earths-layers__r2.html",
    },
    "what-is-life": {
      "assessment_what-is-life__r1": "/app/lessons/lesson_what-is-life.html",
    },
  },
}));

import { executeLaunch, planAssignmentLaunch, planPracticeLaunch } from "./launchRouting";
import type { AssignmentsListForStudentItem } from "./types";
import { renderDeepLinkArrival } from "../deepLink/arrival";
import type { DeepLinkResolution } from "../deepLink/types";

const EL = "earths-layers";
const R1 = `assessment_${EL}__r1`;
const R2 = `assessment_${EL}__r2`;
const R1_PAGE = `/app/lessons/assessment-revisions/lesson_${EL}__r1.html`;
const R2_PAGE = `/app/lessons/assessment-revisions/lesson_${EL}__r2.html`;
const PR90F = "pr90f52136d39f36d21bf1602d0af3901adf0eae32a046c522907c5e932f342189";
const VARIANT_PATH = `app/lessons/variants/lesson_${EL}__${PR90F}.html`;
const REF = "0123456789abcdef0123456789abcdef";

const item = (over: Partial<AssignmentsListForStudentItem> = {}): AssignmentsListForStudentItem =>
  Object.freeze({
    assignmentId: "a1",
    lessonSlug: EL,
    title: "Earth's Layers",
    status: "published" as const,
    publishedAt: 1,
    ...over,
  });

async function navigateFor(plan: ReturnType<typeof planAssignmentLaunch>, probe = true): Promise<string[]> {
  const navigated: string[] = [];
  if (plan === null) return navigated;
  await executeLaunch(plan, { navigate: (u) => navigated.push(u), probe: () => Promise.resolve(probe) });
  return navigated;
}

describe("canonical assignment routing (My Science)", () => {
  test("an r1 assignment routes to the r1 page while r2 is current", async () => {
    expect(await navigateFor(planAssignmentLaunch(item({ assessmentRevisionId: R1 })))).toEqual([`${R1_PAGE}#assignment=a1`]);
  });

  test("a synthetic r2 assignment routes to the r2 page", async () => {
    expect(await navigateFor(planAssignmentLaunch(item({ assessmentRevisionId: R2 })))).toEqual([`${R2_PAGE}#assignment=a1`]);
  });

  test.each([
    ["missing", undefined],
    ["unmapped", `assessment_${EL}__r3`],
    ["malformed", "r2"],
    ["foreign-lesson", "assessment_what-is-life__r1"],
  ])("a %s revision produces no plan (fail closed, no current fallback)", (_label, rev) => {
    expect(planAssignmentLaunch(item({ assessmentRevisionId: rev }))).toBeNull();
  });

  test("the launch URL never carries a revision the browser could alter", () => {
    const plan = planAssignmentLaunch(item({ assessmentRevisionId: R1 }))!;
    expect(plan.primaryUrl).not.toContain("assessment_");
  });
});

describe("differentiated and canonicalFallback routing", () => {
  test("an r1 differentiated launch routes to the server-selected retained variant", async () => {
    const plan = planAssignmentLaunch(item({
      assessmentRevisionId: R1,
      launchRef: REF,
      presentation: { variantKey: "reading-adapted", presentationRevisionId: PR90F, path: VARIANT_PATH },
    }));
    expect(await navigateFor(plan)).toEqual([`/${VARIANT_PATH}#assignment=a1&launchRef=${REF}`]);
    // Its load-failure fallback is the frozen revision's canonical page.
    expect(plan!.canonicalUrl).toBe(`${R1_PAGE}#assignment=a1`);
    expect(await navigateFor(plan, false)).toEqual([`${R1_PAGE}#assignment=a1`]);
  });

  test("canonicalFallback on a synthetic r2 (only r1 differentiated coverage) routes to the r2 page", async () => {
    const plan = planAssignmentLaunch(item({ assessmentRevisionId: R2, launchRef: REF }));
    expect(await navigateFor(plan)).toEqual([`${R2_PAGE}#assignment=a1&launchRef=${REF}`]);
  });

  test("canonicalFallback on r1 routes to the r1 page, never the current r2", async () => {
    expect(await navigateFor(planAssignmentLaunch(item({ assessmentRevisionId: R1, launchRef: REF })))).toEqual([
      `${R1_PAGE}#assignment=a1&launchRef=${REF}`,
    ]);
  });

  test("a differentiated launch without a usable frozen revision is not launched at all", () => {
    expect(planAssignmentLaunch(item({
      launchRef: REF,
      presentation: { variantKey: "reading-adapted", presentationRevisionId: PR90F, path: VARIANT_PATH },
    }))).toBeNull();
  });
});

describe("assignment-associated practice", () => {
  test("practice routes to the frozen revision's page with no assignment query", () => {
    expect(planPracticeLaunch(EL, undefined, R1)?.primaryUrl).toBe(R1_PAGE);
    expect(planPracticeLaunch(EL, undefined, R2)?.primaryUrl).toBe(R2_PAGE);
  });

  test("practice without a usable frozen revision fails closed", () => {
    expect(planPracticeLaunch(EL, undefined, undefined)).toBeNull();
    expect(planPracticeLaunch(EL, undefined, "assessment_what-is-life__r1")).toBeNull();
  });
});

describe("Classroom deep-link arrival (/app/a/{assignmentId})", () => {
  function resolution(over: Partial<DeepLinkResolution>): DeepLinkResolution {
    return Object.freeze({
      assignmentId: "a1",
      classId: "c1",
      lessonSlug: EL,
      internalTarget: "assignmentLaunch",
      attemptContext: "authorized",
      ...over,
    }) as DeepLinkResolution;
  }
  async function arrive(res: DeepLinkResolution): Promise<{ navigate: jest.Mock; mount: HTMLElement }> {
    const mount = document.createElement("div");
    const navigate = jest.fn();
    await renderDeepLinkArrival(mount, {
      assignmentId: "a1",
      resolve: jest.fn().mockResolvedValue(res),
      navigate,
      probe: () => Promise.resolve(true),
      onGoToMyAssignments: jest.fn(),
    });
    return { navigate, mount };
  }

  test("the Classroom handoff carries the launch context in the fragment only (launch-URL hardening)", async () => {
    const { navigate } = await arrive(resolution({ assessmentRevisionId: R1, launchRef: REF }));
    const url = new URL(navigate.mock.calls[0][0] as string, "https://lyfelabz.test");
    expect(url.search).toBe("");
    expect(Object.fromEntries(new URLSearchParams(url.hash.slice(1)))).toEqual({ assignment: "a1", launchRef: REF });
  });

  test("an old r1 Classroom link still reaches r1 after r2 becomes current", async () => {
    const { navigate } = await arrive(resolution({ assessmentRevisionId: R1 }));
    expect(navigate).toHaveBeenCalledWith(`${R1_PAGE}#assignment=a1`);
  });

  test("the resolver's revision controls the destination (r2)", async () => {
    const { navigate } = await arrive(resolution({ assessmentRevisionId: R2, launchRef: REF }));
    expect(navigate).toHaveBeenCalledWith(`${R2_PAGE}#assignment=a1&launchRef=${REF}`);
  });

  test("assignment-associated lessonPractice arrives on the frozen revision", async () => {
    const { navigate } = await arrive(resolution({ internalTarget: "lessonPractice", attemptContext: "informational", assessmentRevisionId: R2 }));
    expect(navigate).toHaveBeenCalledWith(R2_PAGE);
  });

  test("a resolution without a usable revision does not navigate (retryable state)", async () => {
    const { navigate, mount } = await arrive(resolution({}));
    expect(navigate).not.toHaveBeenCalled();
    expect(mount.textContent).not.toContain("assessment_");
    const practice = await arrive(resolution({ internalTarget: "lessonPractice", attemptContext: "informational" }));
    expect(practice.navigate).not.toHaveBeenCalled();
  });
});
