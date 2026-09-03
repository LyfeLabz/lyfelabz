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
const CANONICAL_URL = "/app/lessons/lesson_what-is-life.html?assignment=asg-1";

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
      `/${SAFE_PATH}?assignment=asg-1&launchRef=${REF}`,
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
      `/${otherPath}?assignment=asg-1&launchRef=${REF}`,
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
    const plan = planPracticeLaunch("what-is-life");
    expect(plan).toEqual({
      primaryUrl: "/app/lessons/lesson_what-is-life.html",
      canonicalUrl: "/app/lessons/lesson_what-is-life.html",
      differentiated: false,
      differentiatedRejected: false,
    });
  });

  test("differentiated practice routes to the adapted artifact, still no query or launchRef", () => {
    const plan = planPracticeLaunch("what-is-life", { path: SAFE_PATH });
    expect(plan?.differentiated).toBe(true);
    expect(plan?.primaryUrl).toBe(`/${SAFE_PATH}`);
    expect(plan?.primaryUrl).not.toContain("launchRef");
    expect(plan?.primaryUrl).not.toContain("assignment");
  });

  test("unsafe practice path falls back to canonical practice base", () => {
    const plan = planPracticeLaunch("what-is-life", {
      path: "https://evil.example/x.html",
    });
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
