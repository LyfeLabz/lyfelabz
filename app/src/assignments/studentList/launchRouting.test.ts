import * as fs from "fs";
import * as path from "path";

import {
  executeLaunch,
  isSafeLaunchRef,
  isSafeVariantPath,
  planAssignmentLaunch,
  planPracticeLaunch,
  type LaunchExecuteDeps,
} from "./launchRouting";
import type { AssignmentsListForStudentItem } from "./types";

// F5.2 §7.3 (Persistent Student Differentiation Slice 5) - client routing +
// launchRef transport + path safety + navigation-failure fallback. The server
// chooses the presentation; the client only transports that choice.

const REV = `pr${"a".repeat(64)}`;
// The authoritative server wire path (relative, no leading slash) - matches
// `variantRelativeOutputPath` / `assertActivateWriteConsistent`.
const SAFE_PATH = `app/lessons/variants/lesson_what-is-life__${REV}.html`;
// The canonical (v2-overridden) URL for what-is-life, no launchRef.
const CANONICAL_URL = "/app/lessons/lesson_what-is-life.html#assignment=asg-1";

const REF = "0123456789abcdef0123456789abcdef";

const mkItem = (
  over: Partial<AssignmentsListForStudentItem> = {},
): AssignmentsListForStudentItem =>
  Object.freeze({
    assignmentId: "asg-1",
    lessonSlug: "what-is-life",
    title: "What Is Life?",
    status: "published" as const,
    publishedAt: 1,
    // F5.3 Slice 9D: the server-derived frozen revision selects the page.
    assessmentRevisionId: "assessment_what-is-life__r1",
    ...over,
  });

const differentiatedItem = (
  over: Partial<AssignmentsListForStudentItem> = {},
): AssignmentsListForStudentItem =>
  mkItem({
    presentation: {
      variantKey: "reading-adapted",
      presentationRevisionId: REV,
      path: SAFE_PATH,
    },
    launchRef: REF,
    ...over,
  });

describe("planAssignmentLaunch - routing decision (F5.2 §7.3)", () => {
  test("canonical item routes to exactly the canonical URL, no launchRef", () => {
    const plan = planAssignmentLaunch(mkItem());
    expect(plan).toEqual({
      primaryUrl: CANONICAL_URL,
      canonicalUrl: CANONICAL_URL,
      differentiated: false,
      differentiatedRejected: false,
    });
    expect(plan?.primaryUrl).not.toContain("launchRef");
  });

  test("differentiated item routes to the EXACT server-selected path (T-K1)", () => {
    const plan = planAssignmentLaunch(differentiatedItem());
    expect(plan?.differentiated).toBe(true);
    // The path is used verbatim (server-selected), only made absolute same-origin.
    expect(plan?.primaryUrl).toBe(
      `/${SAFE_PATH}#assignment=asg-1&launchRef=${REF}`,
    );
    // The canonical fallback never carries the launchRef.
    expect(plan?.canonicalUrl).toBe(CANONICAL_URL);
    expect(plan?.canonicalUrl).not.toContain("launchRef");
  });

  test("canonicalFallback item (launchRef only) routes canonical WITH the ref (T-K2)", () => {
    const plan = planAssignmentLaunch(mkItem({ launchRef: REF }));
    expect(plan?.differentiated).toBe(false);
    expect(plan?.differentiatedRejected).toBe(false);
    expect(plan?.primaryUrl).toBe(`${CANONICAL_URL}&launchRef=${REF}`);
    // Fallback (and DOM attr) still never carries the ref.
    expect(plan?.canonicalUrl).toBe(CANONICAL_URL);
  });

  test("does NOT derive the variant path from lessonSlug - a server path for a different slug is used verbatim", () => {
    const otherPath = `app/lessons/variants/lesson_earths-layers__${REV}.html`;
    const plan = planAssignmentLaunch(
      differentiatedItem({
        presentation: {
          variantKey: "reading-adapted",
          presentationRevisionId: REV,
          path: otherPath,
        },
      }),
    );
    // The client transports the server path unchanged; it never reconstructs a
    // path from the item's own lessonSlug (what-is-life).
    expect(plan?.primaryUrl).toBe(
      `/${otherPath}#assignment=asg-1&launchRef=${REF}`,
    );
  });

  test("preserves the EXACT opaque launchRef without decoding or replacing it", () => {
    const plan = planAssignmentLaunch(differentiatedItem({ launchRef: REF }));
    // The exact token appears verbatim; it is never transformed.
    expect(plan?.primaryUrl.endsWith(`launchRef=${REF}`)).toBe(true);
  });

  test("returns null when the canonical lesson URL is unresolvable (malformed slug)", () => {
    expect(planAssignmentLaunch(mkItem({ lessonSlug: "../secret" }))).toBeNull();
    expect(planAssignmentLaunch(differentiatedItem({ lessonSlug: "" }))).toBeNull();
  });
});

describe("planAssignmentLaunch - path safety / open-redirect protection", () => {
  const rejected: ReadonlyArray<[string, string]> = [
    ["absolute external URL", "https://evil.example/app/lessons/variants/x.html"],
    ["protocol-relative external URL", "//evil.example/x.html"],
    ["javascript URL", "javascript:alert(1)"],
    ["data URL", "data:text/html,<script>alert(1)</script>"],
    ["leading-slash absolute", `/${SAFE_PATH}`],
    ["path traversal", `app/lessons/variants/../../etc/passwd`],
    ["wrong directory", `app/lessons/lesson_what-is-life__${REV}.html`],
    ["missing revision", `app/lessons/variants/lesson_what-is-life.html`],
    ["query smuggling", `${SAFE_PATH}?x=1`],
    ["uppercase slug", `app/lessons/variants/lesson_WhatIsLife__${REV}.html`],
    ["short digest", `app/lessons/variants/lesson_what-is-life__pr${"a".repeat(10)}.html`],
    ["empty", ""],
  ];

  test.each(rejected)(
    "rejects %s: never navigates to the unsafe target, falls back canonical",
    (_label, unsafe) => {
      const plan = planAssignmentLaunch(
        differentiatedItem({
          presentation: {
            variantKey: "reading-adapted",
            presentationRevisionId: REV,
            path: unsafe,
          },
        }),
      );
      // A rejected path never becomes a differentiated navigation target and
      // never appears in the plan; the launchRef is discarded (not on canonical).
      expect(plan?.differentiated).toBe(false);
      expect(plan?.differentiatedRejected).toBe(true);
      expect(plan?.primaryUrl).toBe(CANONICAL_URL);
      expect(plan?.canonicalUrl).toBe(CANONICAL_URL);
      expect(plan?.primaryUrl).not.toContain("evil");
      expect(plan?.primaryUrl).not.toContain("javascript");
      expect(plan?.primaryUrl).not.toContain("data:");
      expect(plan?.primaryUrl).not.toContain("launchRef");
    },
  );

  test("a valid same-origin revision path is accepted", () => {
    expect(isSafeVariantPath(SAFE_PATH)).toBe(true);
    expect(isSafeVariantPath(`/${SAFE_PATH}`)).toBe(false);
    expect(isSafeVariantPath("https://evil/x")).toBe(false);
  });

  test("a differentiated presentation with a MISSING launchRef is not routed differentiated", () => {
    const plan = planAssignmentLaunch(
      mkItem({
        presentation: {
          variantKey: "reading-adapted",
          presentationRevisionId: REV,
          path: SAFE_PATH,
        },
        // no launchRef
      }),
    );
    expect(plan?.differentiated).toBe(false);
    expect(plan?.differentiatedRejected).toBe(true);
    expect(plan?.primaryUrl).toBe(CANONICAL_URL);
  });

  test("an unsafe launchRef is refused", () => {
    expect(isSafeLaunchRef("has space")).toBe(false);
    expect(isSafeLaunchRef("a/b")).toBe(false);
    expect(isSafeLaunchRef("")).toBe(false);
    expect(isSafeLaunchRef(REF)).toBe(true);
  });
});

describe("executeLaunch - navigation + failure fallback (F5.2 §7.3, T-Q1)", () => {
  function deps(over: Partial<LaunchExecuteDeps> = {}) {
    const navigated: string[] = [];
    const probed: string[] = [];
    const anomalies: number[] = [];
    const d: LaunchExecuteDeps = {
      navigate: (u) => navigated.push(u),
      probe: async (u) => {
        probed.push(u);
        return true;
      },
      onVariantLoadFailure: () => anomalies.push(1),
      ...over,
    };
    return {
      d,
      navigated,
      probed,
      anomalyCount: () => anomalies.length,
    };
  }

  test("canonical plan navigates directly, never probes, no anomaly", async () => {
    const h = deps();
    await executeLaunch(planAssignmentLaunch(mkItem())!, h.d);
    expect(h.navigated).toEqual([CANONICAL_URL]);
    expect(h.probed).toEqual([]);
    expect(h.anomalyCount()).toBe(0);
  });

  test("differentiated plan probes then navigates the differentiated URL on success", async () => {
    const h = deps();
    const plan = planAssignmentLaunch(differentiatedItem())!;
    await executeLaunch(plan, h.d);
    expect(h.probed).toEqual([plan.primaryUrl]);
    expect(h.navigated).toEqual([plan.primaryUrl]);
    expect(h.anomalyCount()).toBe(0);
  });

  test("differentiated load failure falls back to canonical, discards the ref, emits the anomaly (T-Q1)", async () => {
    const h = deps({ probe: async () => false });
    const plan = planAssignmentLaunch(differentiatedItem())!;
    await executeLaunch(plan, h.d);
    // Landed VISUALLY on the canonical target - which carries NO launchRef.
    expect(h.navigated).toEqual([CANONICAL_URL]);
    expect(h.navigated[0]).not.toContain("launchRef");
    // The differentiated URL was never navigated.
    expect(h.navigated).not.toContain(plan.primaryUrl);
    expect(h.anomalyCount()).toBe(1);
  });

  test("a probe that throws is treated as a load failure (fail safe to canonical)", async () => {
    const h = deps({
      probe: async () => {
        throw new Error("network");
      },
    });
    const plan = planAssignmentLaunch(differentiatedItem())!;
    await executeLaunch(plan, h.d);
    expect(h.navigated).toEqual([CANONICAL_URL]);
    expect(h.anomalyCount()).toBe(1);
  });

  test("a build-time rejected differentiated path yields canonical + anomaly, no probe, no arbitrary navigation", async () => {
    const h = deps();
    const plan = planAssignmentLaunch(
      differentiatedItem({
        presentation: {
          variantKey: "reading-adapted",
          presentationRevisionId: REV,
          path: "https://evil.example/x.html",
        },
      }),
    )!;
    await executeLaunch(plan, h.d);
    expect(h.probed).toEqual([]);
    expect(h.navigated).toEqual([CANONICAL_URL]);
    expect(h.navigated[0]).not.toContain("evil");
    expect(h.anomalyCount()).toBe(1);
  });

  test("onVariantLoadFailure is optional - executor is safe when omitted", async () => {
    const navigated: string[] = [];
    const d: LaunchExecuteDeps = {
      navigate: (u) => navigated.push(u),
      probe: async () => false,
    };
    await expect(
      executeLaunch(planAssignmentLaunch(differentiatedItem())!, d),
    ).resolves.toBeUndefined();
    expect(navigated).toEqual([CANONICAL_URL]);
  });
});

describe("planPracticeLaunch (F5.2 §9)", () => {
  test("canonical practice routes to the base path with no assignment query and no launchRef", () => {
    const plan = planPracticeLaunch("what-is-life", undefined, "assessment_what-is-life__r1");
    expect(plan).toEqual({
      primaryUrl: "/app/lessons/lesson_what-is-life.html",
      canonicalUrl: "/app/lessons/lesson_what-is-life.html",
      differentiated: false,
      differentiatedRejected: false,
    });
  });

  test("differentiated practice routes to the adapted artifact, still no query or launchRef", () => {
    const plan = planPracticeLaunch("what-is-life", { path: SAFE_PATH }, "assessment_what-is-life__r1");
    expect(plan?.differentiated).toBe(true);
    expect(plan?.primaryUrl).toBe(`/${SAFE_PATH}`);
    expect(plan?.primaryUrl).not.toContain("launchRef");
    expect(plan?.primaryUrl).not.toContain("assignment");
  });

  test("unsafe practice path falls back to canonical practice base", () => {
    const plan = planPracticeLaunch("what-is-life", {
      path: "https://evil.example/x.html",
    }, "assessment_what-is-life__r1");
    expect(plan?.differentiated).toBe(false);
    expect(plan?.differentiatedRejected).toBe(true);
    expect(plan?.primaryUrl).toBe("/app/lessons/lesson_what-is-life.html");
  });
});

describe("no client-side accommodation logic / no Firestore lookup", () => {
  test("the routing module never reads accommodation state, an index, a manifest, or launchGrants, and never derives a variant", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "launchRouting.ts"), "utf8");
    for (const forbidden of [
      "firebase",
      "firestore",
      "launchGrants",
      "studentAccommodations",
      "presentationVariants",
      "readingAccessibility",
      "variantKeyForReadingLevel",
      "reading-adapted",
      "manifest",
    ]) {
      expect(src).not.toContain(forbidden);
    }
  });
});

// Earth's Layers r2 authoring: the real committed revision-path table now
// holds r1 and r2 (r2 current). No synthetic table; the same routing code the
// bundle ships.
describe("real Earth's Layers r1 + r2 routing (committed table)", () => {
  const EL = "earths-layers";
  const R1 = `assessment_${EL}__r1`;
  const R2 = `assessment_${EL}__r2`;
  const R1_PAGE = `/app/lessons/assessment-revisions/lesson_${EL}__r1.html`;
  const R2_PAGE = `/app/lessons/assessment-revisions/lesson_${EL}__r2.html`;
  const PR90F = "pr90f52136d39f36d21bf1602d0af3901adf0eae32a046c522907c5e932f342189";
  const PR90F_PATH = `app/lessons/variants/lesson_${EL}__${PR90F}.html`;
  const el = (over: Partial<AssignmentsListForStudentItem>) => mkItem({ lessonSlug: EL, title: "Earth's Layers", ...over });

  test("an r1 assignment (canonical) opens the r1 rendition although r2 is current", () => {
    expect(planAssignmentLaunch(el({ assessmentRevisionId: R1 }))?.primaryUrl).toBe(`${R1_PAGE}#assignment=asg-1`);
  });

  test("an r1 differentiated launch opens retained pr90f..., and its load-failure fallback is the r1 rendition", () => {
    const plan = planAssignmentLaunch(el({
      assessmentRevisionId: R1,
      launchRef: REF,
      presentation: { variantKey: "reading-adapted", presentationRevisionId: PR90F, path: PR90F_PATH },
    }));
    expect(plan?.primaryUrl).toBe(`/${PR90F_PATH}#assignment=asg-1&launchRef=${REF}`);
    expect(plan?.canonicalUrl).toBe(`${R1_PAGE}#assignment=asg-1`);
  });

  test("an r2 assignment opens the r2 rendition", () => {
    expect(planAssignmentLaunch(el({ assessmentRevisionId: R2 }))?.primaryUrl).toBe(`${R2_PAGE}#assignment=asg-1`);
  });

  test("a future r2 differentiated launch opens retained pr6b7c..., and its load-failure fallback is the r2 rendition", () => {
    const PR6B7C = "pr6b7c74fe84fb20a9b05d4b2d6e006c21ed2bc02d58dcfbefc925dbd4c400e948";
    const PR6B7C_PATH = `app/lessons/variants/lesson_${EL}__${PR6B7C}.html`;
    const plan = planAssignmentLaunch(el({
      assessmentRevisionId: R2,
      launchRef: REF,
      presentation: { variantKey: "reading-adapted", presentationRevisionId: PR6B7C, path: PR6B7C_PATH },
    }));
    expect(plan?.primaryUrl).toBe(`/${PR6B7C_PATH}#assignment=asg-1&launchRef=${REF}`);
    expect(plan?.canonicalUrl).toBe(`${R2_PAGE}#assignment=asg-1`);
  });

  test("r2 without differentiated coverage (canonicalFallback grant) opens canonical r2, never r1 or a variant", () => {
    const plan = planAssignmentLaunch(el({ assessmentRevisionId: R2, launchRef: REF }));
    expect(plan?.primaryUrl).toBe(`${R2_PAGE}#assignment=asg-1&launchRef=${REF}`);
    expect(plan?.differentiated).toBe(false);
  });

  test("assignment-tied practice follows the frozen revision (r1 and r2)", () => {
    expect(planPracticeLaunch(EL, undefined, R1)?.primaryUrl).toBe(R1_PAGE);
    expect(planPracticeLaunch(EL, undefined, R2)?.primaryUrl).toBe(R2_PAGE);
  });

  test("an uncommitted revision has no launch (no current fallback)", () => {
    expect(planAssignmentLaunch(el({ assessmentRevisionId: `assessment_${EL}__r3` }))).toBeNull();
  });
});

// Launch-URL hardening (security backlog SECURITY_BACKLOG_LAUNCH_URL_ANALYTICS.md):
// every URL the launcher builds carries `assignment` and `launchRef` ONLY in the
// fragment, never in the query string, so neither reaches an HTTP request, a
// Referer header, or the lesson pages' analytics page location.
describe("launch context rides in the fragment, never the query string", () => {
  const EL = "earths-layers";
  const R1 = `assessment_${EL}__r1`;
  const R2 = `assessment_${EL}__r2`;
  const PR90F = "pr90f52136d39f36d21bf1602d0af3901adf0eae32a046c522907c5e932f342189";
  const PR90F_PATH = `app/lessons/variants/lesson_${EL}__${PR90F}.html`;
  const parse = (u: string) => {
    const url = new URL(u, "https://lyfelabz.test");
    return { path: url.pathname, search: url.search, fragment: Object.fromEntries(new URLSearchParams(url.hash.slice(1))) };
  };
  const el = (over: Partial<AssignmentsListForStudentItem>) => mkItem({ lessonSlug: EL, title: "Earth's Layers", ...over });

  test.each([
    ["canonical (unversioned single-revision page)", mkItem(), { assignment: "asg-1" }],
    ["revision-bound canonical r1", el({ assessmentRevisionId: R1 }), { assignment: "asg-1" }],
    ["revision-bound canonical r2", el({ assessmentRevisionId: R2 }), { assignment: "asg-1" }],
    ["canonicalFallback (launchRef only)", el({ assessmentRevisionId: R2, launchRef: REF }), { assignment: "asg-1", launchRef: REF }],
    [
      "differentiated",
      el({ assessmentRevisionId: R1, launchRef: REF, presentation: { variantKey: "reading-adapted", presentationRevisionId: PR90F, path: PR90F_PATH } }),
      { assignment: "asg-1", launchRef: REF },
    ],
  ])("%s: primary URL has no query and the exact fragment context", (_label, item, fragment) => {
    const plan = planAssignmentLaunch(item)!;
    const primary = parse(plan.primaryUrl);
    expect(primary.search).toBe("");
    expect(primary.fragment).toEqual(fragment);
    // The canonical target (DOM attribute and every fallback) never carries a launchRef.
    const canonical = parse(plan.canonicalUrl);
    expect(canonical.search).toBe("");
    expect(canonical.fragment).toEqual({ assignment: "asg-1" });
  });

  test("the differentiated load-failure fallback navigates the canonical page with the assignment only", async () => {
    const plan = planAssignmentLaunch(el({
      assessmentRevisionId: R1,
      launchRef: REF,
      presentation: { variantKey: "reading-adapted", presentationRevisionId: PR90F, path: PR90F_PATH },
    }))!;
    const navigated: string[] = [];
    await executeLaunch(plan, { navigate: (u) => navigated.push(u), probe: () => Promise.resolve(false) });
    expect(navigated).toHaveLength(1);
    expect(parse(navigated[0]!)).toEqual({ path: `/app/lessons/assessment-revisions/lesson_${EL}__r1.html`, search: "", fragment: { assignment: "asg-1" } });
  });

  test("a rejected differentiated path falls back canonical with no query and no launchRef", () => {
    const plan = planAssignmentLaunch(el({
      assessmentRevisionId: R1,
      launchRef: REF,
      presentation: { variantKey: "reading-adapted", presentationRevisionId: PR90F, path: "https://evil.example/x.html" },
    }))!;
    expect(plan.differentiatedRejected).toBe(true);
    expect(parse(plan.primaryUrl)).toEqual({ path: `/app/lessons/assessment-revisions/lesson_${EL}__r1.html`, search: "", fragment: { assignment: "asg-1" } });
  });

  test("assignment-tied practice carries no launch context at all", () => {
    for (const rev of [R1, R2]) {
      const plan = planPracticeLaunch(EL, undefined, rev)!;
      expect(parse(plan.primaryUrl)).toEqual({ path: `/app/lessons/assessment-revisions/lesson_${EL}__r${rev.slice(-1)}.html`, search: "", fragment: {} });
    }
  });

  test("an assignment id with reserved characters is encoded inside the fragment and never opens a query", () => {
    const plan = planAssignmentLaunch(mkItem({ assignmentId: "a?b=c&d#e", launchRef: REF }))!;
    const primary = parse(plan.primaryUrl);
    expect(primary.search).toBe("");
    expect(primary.fragment).toEqual({ assignment: "a?b=c&d#e", launchRef: REF });
  });
});

// Policy E cache transition: Firebase Hosting omits custom security headers on
// 304 responses, so the executor prepares (replaces the browser's cached copy
// of) every navigation target before navigating to it.
describe("executeLaunch - Policy E target preparation", () => {
  const record = () => {
    const events: string[] = [];
    const deps: LaunchExecuteDeps = {
      navigate: (u) => {
        events.push(`navigate ${u}`);
      },
      probe: () => Promise.resolve(true),
      prepareNavigation: async (u) => {
        events.push(`prepare ${u}`);
      },
    };
    return { events, deps };
  };

  test("canonical: prepare the exact URL, then navigate it", async () => {
    const { events, deps } = record();
    await executeLaunch(planAssignmentLaunch(mkItem())!, deps);
    expect(events).toEqual([`prepare ${CANONICAL_URL}`, `navigate ${CANONICAL_URL}`]);
  });

  test("differentiated: probe, prepare the variant, navigate it", async () => {
    const { events, deps } = record();
    const plan = planAssignmentLaunch(mkItem({ presentation: { variantKey: "k", presentationRevisionId: REV, path: SAFE_PATH }, launchRef: REF }))!;
    await executeLaunch(plan, deps);
    expect(events).toEqual([`prepare ${plan.primaryUrl}`, `navigate ${plan.primaryUrl}`]);
  });

  test("probe failure: prepare and navigate the canonical fallback only", async () => {
    const { events, deps } = record();
    const plan = planAssignmentLaunch(mkItem({ presentation: { variantKey: "k", presentationRevisionId: REV, path: SAFE_PATH }, launchRef: REF }))!;
    await executeLaunch(plan, { ...deps, probe: () => Promise.resolve(false) });
    expect(events).toEqual([`prepare ${CANONICAL_URL}`, `navigate ${CANONICAL_URL}`]);
  });

  test("rejected differentiated path: prepare and navigate canonical", async () => {
    const { events, deps } = record();
    const plan = planAssignmentLaunch(mkItem({ presentation: { variantKey: "k", presentationRevisionId: REV, path: "//evil" }, launchRef: REF }))!;
    await executeLaunch(plan, deps);
    expect(events).toEqual([`prepare ${CANONICAL_URL}`, `navigate ${CANONICAL_URL}`]);
  });

  test("a rejected preparation still navigates exactly once", async () => {
    const navigated: string[] = [];
    await executeLaunch(planAssignmentLaunch(mkItem({ launchRef: REF }))!, {
      navigate: (u) => navigated.push(u),
      probe: () => Promise.resolve(true),
      prepareNavigation: () => Promise.reject(new Error("offline")),
    });
    expect(navigated).toEqual([`${CANONICAL_URL}&launchRef=${REF}`]);
  });
});
