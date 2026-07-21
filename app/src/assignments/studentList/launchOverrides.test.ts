import { LESSON_LAUNCH_OVERRIDES } from "./launchOverrides";

describe("LESSON_LAUNCH_OVERRIDES", () => {
  test("contains exactly the v2-migrated slugs", () => {
    expect(Object.keys(LESSON_LAUNCH_OVERRIDES).sort()).toEqual([
      "earths-layers",
      "plate-tectonics",
      "water-cycle",
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
