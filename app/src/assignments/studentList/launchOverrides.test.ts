import { LESSON_LAUNCH_OVERRIDES } from "./launchOverrides";

describe("LESSON_LAUNCH_OVERRIDES", () => {
  test("contains exactly the 49 v2-migrated slugs (Sprint 28 Phase 5A + 5A.1)", () => {
    expect(Object.keys(LESSON_LAUNCH_OVERRIDES).sort()).toEqual([
      "biological-evolution",
      "body-systems",
      "carbon-cycle",
      "cell-types",
      "chemical-reactions",
      "choosing-materials",
      "communication-systems",
      "conducting-experiments",
      "continental-drift",
      "design-tradeoffs",
      "designing-to-scale",
      "digital-signals",
      "earthquakes",
      "earths-layers",
      "earths-place-in-the-universe",
      "eclipses",
      "ecosystem-stability",
      "energy-flow",
      "energy-transfer",
      "engineering-design",
      "engineering-systems",
      "forms-of-energy",
      "gravity",
      "heat-transfer",
      "hotspot-volcanoes",
      "human-impacts",
      "innovation-and-sustainability",
      "introduction-to-electricity",
      "layers-of-time",
      "measuring-matter",
      "nature-of-waves",
      "organelles",
      "parts-of-an-ecosystem",
      "phases-of-the-moon",
      "photosynthesis",
      "physical-properties",
      "plate-tectonics",
      "pure-substances-and-mixtures",
      "renewable-and-nonrenewable-resources",
      "reproductive-success",
      "structural-systems",
      "sun-earth-moon",
      "technology-and-society",
      "transportation-systems",
      "types-of-volcanoes",
      "water-cycle",
      "wave-behavior",
      "weathering-and-erosion",
      "what-is-life",
    ]);
  });

  test("earths-layers routes to the v2 artifact under /app/lessons/", () => {
    expect(LESSON_LAUNCH_OVERRIDES["earths-layers"]).toEqual({
      path: "/app/lessons/lesson_earths-layers.html",
    });
  });

  test("plate-tectonics routes to the v2 artifact under /app/lessons/", () => {
    expect(LESSON_LAUNCH_OVERRIDES["plate-tectonics"]).toEqual({
      path: "/app/lessons/lesson_plate-tectonics.html",
    });
  });

  test("water-cycle routes to the v2 artifact under /app/lessons/", () => {
    expect(LESSON_LAUNCH_OVERRIDES["water-cycle"]).toEqual({
      path: "/app/lessons/lesson_water-cycle.html",
    });
  });

  test("earthquakes routes to the v2 artifact under /app/lessons/", () => {
    expect(LESSON_LAUNCH_OVERRIDES["earthquakes"]).toEqual({
      path: "/app/lessons/lesson_earthquakes.html",
    });
  });

  test("every override path is an absolute in-site path (no protocol, no query, no fragment)", () => {
    for (const [slug, override] of Object.entries(LESSON_LAUNCH_OVERRIDES)) {
      expect(override.path.startsWith("/")).toBe(true);
      expect(override.path).not.toMatch(/[?#]/);
      expect(override.path).not.toMatch(/^\/\//);
      expect(override.path).not.toMatch(/^https?:/i);
      // Path must end in `lesson_<slug>.html` so the artifact identity
      // stays traceable from the override table alone.
      expect(override.path.endsWith(`/lesson_${slug}.html`)).toBe(true);
    }
  });
});
