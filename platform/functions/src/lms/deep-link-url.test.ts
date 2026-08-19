// Sprint 27 Phase 4 unit tests for the deep-link URL builder (PDR-027 §8,
// §25). All identifiers are fictional.

jest.mock("../shared", () => {
  const { PlatformError } = jest.requireActual(
    "../shared/errors/platform-error",
  );
  return { PlatformError };
});

import { PlatformError } from "../shared/errors/platform-error";
import {
  CANONICAL_APP_ORIGIN,
  buildAssignmentDeepLinkUrl,
} from "./deep-link-url";

describe("buildAssignmentDeepLinkUrl (Sprint 27 Phase 4)", () => {
  it("emits the canonical app.lyfelabz.com deep-link shape", () => {
    expect(buildAssignmentDeepLinkUrl("assign-abc123")).toBe(
      "https://app.lyfelabz.com/app/a/assign-abc123",
    );
  });

  it("uses the production host, never the legacy apex", () => {
    expect(CANONICAL_APP_ORIGIN).toBe("https://app.lyfelabz.com");
    const url = buildAssignmentDeepLinkUrl("x1");
    expect(url.startsWith("https://app.lyfelabz.com/app/a/")).toBe(true);
    // Never emits the doubled /app/app/ mistake and never the bare apex.
    expect(url).not.toContain("/app/app/");
    expect(url).not.toContain("://lyfelabz.com/");
  });

  it("builds the shape for a variety of canonical ids", () => {
    for (const id of ["a", "A9", "abc", "a-b_c", "teacher__lesson__class__n"]) {
      expect(buildAssignmentDeepLinkUrl(id)).toBe(
        `https://app.lyfelabz.com/app/a/${id}`,
      );
    }
  });

  it("refuses an empty id", () => {
    expect(() => buildAssignmentDeepLinkUrl("")).toThrow(PlatformError);
    try {
      buildAssignmentDeepLinkUrl("");
    } catch (e) {
      expect((e as PlatformError).code).toBe("deep-link-shape-invalid");
    }
  });

  it("refuses ids that would smuggle a query, fragment, path, host, or scheme", () => {
    const hostile = [
      "id?x=1", // query parameter
      "id#frag", // fragment
      "id/extra", // second path segment
      "a/../b", // traversal
      "http://evil", // scheme + host
      "evil.example/a", // alternate host
      "id with space", // whitespace
      "a.b", // dot (no lesson slug or extension smuggling)
      "-lead", // leading hyphen
      "trail-", // trailing hyphen
    ];
    for (const id of hostile) {
      expect(() => buildAssignmentDeepLinkUrl(id)).toThrow(PlatformError);
      try {
        buildAssignmentDeepLinkUrl(id);
        throw new Error(`expected ${id} to be refused`);
      } catch (e) {
        expect((e as PlatformError).code).toBe("deep-link-shape-invalid");
      }
    }
  });

  it("refuses a non-string id", () => {
    expect(() =>
      buildAssignmentDeepLinkUrl(undefined as unknown as string),
    ).toThrow(PlatformError);
  });
});
