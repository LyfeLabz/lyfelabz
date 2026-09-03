import { detectLaunchRef } from "./launchParams";

// F5.2 §7.3/§8 (Slice 5): the launcher hands off the opaque launch-grant
// reference on the lesson URL; the runtime reads it verbatim and transports it
// to begin. This proves the read is opaque, bounded, and safe.

const REF = "0123456789abcdef0123456789abcdef";

function win(search: string, hash = ""): Window {
  return { location: { search, hash } } as unknown as Window;
}

describe("detectLaunchRef", () => {
  test("reads the launchRef from the query string verbatim", () => {
    expect(detectLaunchRef(win(`?assignment=a1&launchRef=${REF}`))).toBe(REF);
  });

  test("reads the launchRef from the hash fragment", () => {
    expect(detectLaunchRef(win("", `#assignment=a1&launchRef=${REF}`))).toBe(REF);
  });

  test("returns null for a canonical launch with no launchRef (byte-identical begin)", () => {
    expect(detectLaunchRef(win("?assignment=a1"))).toBeNull();
    expect(detectLaunchRef(win(""))).toBeNull();
  });

  test.each([
    ["empty value", "?launchRef="],
    ["whitespace", "?launchRef=%20has%20space"],
    ["slash smuggling", "?launchRef=a%2Fb"],
    ["over-long token", `?launchRef=${"a".repeat(200)}`],
  ])("refuses an unsafe launchRef value: %s", (_label, search) => {
    expect(detectLaunchRef(win(search))).toBeNull();
  });

  test("never throws on a malformed location", () => {
    const bad = { location: null } as unknown as Window;
    expect(detectLaunchRef(bad)).toBeNull();
  });
});
