// Sprint 27 Phase 4: unit tests for the deep-link route parser
// (`/app/a/{assignmentId}`). Pure function; no DOM or firebase needed.

import { isDeepLinkArrivalPath, parseDeepLinkAssignmentId } from "./route";

describe("parseDeepLinkAssignmentId", () => {
  test("parses a canonical deep-link path", () => {
    expect(parseDeepLinkAssignmentId("/app/a/assign-123")).toBe("assign-123");
  });

  test("tolerates a single trailing slash", () => {
    expect(parseDeepLinkAssignmentId("/app/a/assign-123/")).toBe("assign-123");
  });

  test("parses a compound canonical id", () => {
    const id = "teacher__lesson__class__nonce";
    expect(parseDeepLinkAssignmentId(`/app/a/${id}`)).toBe(id);
  });

  test.each([
    ["not a deep link", "/app/student"],
    ["My Assignments route", "/app/a"],
    ["missing id", "/app/a/"],
    ["second path segment", "/app/a/assign-1/extra"],
    ["nested traversal", "/app/a/../teacher"],
    ["wrong prefix", "/a/assign-1"],
    ["query smuggled into segment", "/app/a/assign-1%2F..%2Fx"],
    ["leading hyphen id", "/app/a/-bad"],
    ["trailing hyphen id", "/app/a/bad-"],
    ["empty string", ""],
  ])("returns null for %s", (_label, pathname) => {
    expect(parseDeepLinkAssignmentId(pathname)).toBeNull();
  });

  test("ignores query and fragment (they are never part of the pathname)", () => {
    // A real browser exposes these via window.location.search/hash, never in
    // pathname; the parser reads only the pathname, so authorization state can
    // never ride in on a query or fragment.
    expect(parseDeepLinkAssignmentId("/app/a/assign-9")).toBe("assign-9");
  });

  test("isDeepLinkArrivalPath agrees with the parser", () => {
    expect(isDeepLinkArrivalPath("/app/a/assign-1")).toBe(true);
    expect(isDeepLinkArrivalPath("/app/student")).toBe(false);
  });
});
