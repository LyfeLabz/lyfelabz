// LMS due moment for a LyfeLabz calendar due date: 11:59 PM on that day in
// the school's own IANA timezone, as an RFC3339 UTC instant (Google Classroom
// requires `dueDate` + `dueTime` together, both UTC).

import { PlatformError } from "../../shared/errors/platform-error";
import { lmsDueInstantFor } from "./due-instant";

describe("lmsDueInstantFor", () => {
  it("resolves 11:59 PM EDT (UTC-4), rolling the UTC date forward", () => {
    expect(lmsDueInstantFor("2026-09-23", "America/New_York")).toBe(
      "2026-09-24T03:59:00.000Z",
    );
  });

  it("resolves 11:59 PM EST (UTC-5) in winter", () => {
    expect(lmsDueInstantFor("2026-12-01", "America/New_York")).toBe(
      "2026-12-02T04:59:00.000Z",
    );
  });

  it("uses the day's real offset on DST transition days", () => {
    // Spring forward (Mar 8 2026): by 11:59 PM the zone is on EDT.
    expect(lmsDueInstantFor("2026-03-08", "America/New_York")).toBe(
      "2026-03-09T03:59:00.000Z",
    );
    // Fall back (Nov 1 2026): by 11:59 PM the zone is on EST.
    expect(lmsDueInstantFor("2026-11-01", "America/New_York")).toBe(
      "2026-11-02T04:59:00.000Z",
    );
  });

  it("honors other school timezones, including ones east of UTC", () => {
    expect(lmsDueInstantFor("2026-09-23", "America/Los_Angeles")).toBe(
      "2026-09-24T06:59:00.000Z",
    );
    expect(lmsDueInstantFor("2026-09-23", "UTC")).toBe("2026-09-23T23:59:00.000Z");
    expect(lmsDueInstantFor("2026-09-23", "Asia/Tokyo")).toBe(
      "2026-09-23T14:59:00.000Z",
    );
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["non-string", 42],
    ["unrecognized", "Mars/Olympus"],
  ])("fails closed for a %s timezone", (_label, zone) => {
    expect(() => lmsDueInstantFor("2026-09-23", zone)).toThrow(PlatformError);
  });

  it("fails closed for a malformed date", () => {
    expect(() => lmsDueInstantFor("09/23/2026", "America/New_York")).toThrow(
      PlatformError,
    );
  });
});
