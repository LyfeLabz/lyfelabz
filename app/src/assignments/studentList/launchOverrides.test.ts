import { LESSON_LAUNCH_OVERRIDES } from "./launchOverrides";

describe("LESSON_LAUNCH_OVERRIDES", () => {
  test("contains exactly the Sprint 18 pilot entry", () => {
    expect(Object.keys(LESSON_LAUNCH_OVERRIDES).sort()).toEqual(["earths-layers"]);
  });

  test("earths-layers routes to the v2 artifact under /app/lessons/", () => {
    expect(LESSON_LAUNCH_OVERRIDES["earths-layers"]).toEqual({
      path: "/app/lessons/lesson_earths-layers.html",
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
