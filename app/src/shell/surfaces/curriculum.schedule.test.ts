/**
 * @jest-environment jsdom
 *
 * Scheduled Classroom publication hardening - the pure posting-timing
 * helpers behind the Assign dialog's per-class Post now / Schedule control.
 * These run in a pinned US Eastern browser timezone so the browser-local ->
 * UTC conversion, DST behavior, and the preview's zone label are asserted
 * against concrete instants rather than whatever zone the test host uses.
 */
process.env.TZ = "America/New_York";

import {
  SCHEDULE_MIN_LEAD_MS,
  formatPostingPreview,
  localDateTimeToInstant,
  resolveRowSchedule,
} from "./curriculum";

const NOW = Date.UTC(2031, 8, 22, 11, 0, 0); // Mon Sep 22 2031, 07:00 EDT

describe("localDateTimeToInstant (browser-local wall clock -> UTC instant)", () => {
  test("10. converts a browser-local date/time to the exact UTC instant (EDT, UTC-4)", () => {
    expect(localDateTimeToInstant("2031-09-29", "08:00")?.toISOString()).toBe(
      "2031-09-29T12:00:00.000Z",
    );
  });

  test("uses the standard-time offset in winter (EST, UTC-5)", () => {
    expect(localDateTimeToInstant("2031-12-01", "08:00")?.toISOString()).toBe(
      "2031-12-01T13:00:00.000Z",
    );
  });

  test("DST spring-forward: a nonexistent local time resolves to the real instant the browser uses", () => {
    // 2031-03-09 02:30 does not exist in New York (clocks jump 02:00 -> 03:00).
    const instant = localDateTimeToInstant("2031-03-09", "02:30");
    expect(instant).not.toBeNull();
    expect(instant!.toISOString()).toBe(
      new Date(2031, 2, 9, 2, 30).toISOString(),
    );
    // The preview is formatted from that same instant, so it shows the
    // time that will actually be stored, not the one typed.
    expect(formatPostingPreview(instant!, NOW)).toBe(
      `Posts Sun, Mar 9 at 3:30 AM EDT`,
    );
  });

  test("DST fall-back: an ambiguous local time takes a single, stable instant", () => {
    const instant = localDateTimeToInstant("2031-11-02", "01:30");
    expect(instant).not.toBeNull();
    expect(instant!.toISOString()).toBe(new Date(2031, 10, 2, 1, 30).toISOString());
  });

  test("rejects missing, malformed, and roll-over values instead of guessing", () => {
    expect(localDateTimeToInstant("", "08:00")).toBeNull();
    expect(localDateTimeToInstant("2031-09-29", "")).toBeNull();
    expect(localDateTimeToInstant("2031-02-30", "08:00")).toBeNull();
    expect(localDateTimeToInstant("2031-13-01", "08:00")).toBeNull();
    expect(localDateTimeToInstant("2031-09-29", "24:00")).toBeNull();
    expect(localDateTimeToInstant("09/29/2031", "08:00")).toBeNull();
  });
});

describe("resolveRowSchedule (the single source for preview, validation, and availableAt)", () => {
  const base = { date: "2031-09-29", time: "08:00", dueDate: "", nowMs: NOW } as const;

  test("Post now always resolves to now, whatever date/time are held", () => {
    expect(resolveRowSchedule({ ...base, publishTiming: "now" })).toEqual({ kind: "now" });
    expect(
      resolveRowSchedule({ ...base, publishTiming: "now", date: "", time: "" }),
    ).toEqual({ kind: "now" });
  });

  test("Schedule resolves to the exact local instant", () => {
    const r = resolveRowSchedule({ ...base, publishTiming: "scheduled" });
    expect(r.kind).toBe("scheduled");
    if (r.kind === "scheduled") {
      expect(r.instant.toISOString()).toBe("2031-09-29T12:00:00.000Z");
    }
  });

  test("missing date or time is invalid", () => {
    expect(resolveRowSchedule({ ...base, publishTiming: "scheduled", date: "" })).toEqual({
      kind: "invalid",
      reason: "missing",
    });
    expect(resolveRowSchedule({ ...base, publishTiming: "scheduled", time: "" })).toEqual({
      kind: "invalid",
      reason: "missing",
    });
  });

  test("the minimum lead exceeds the server's 60-second publish-now window", () => {
    expect(SCHEDULE_MIN_LEAD_MS).toBeGreaterThan(60_000);
  });

  test("past, just-ahead, and exactly-at-lead boundaries", () => {
    const at = (time: string) =>
      resolveRowSchedule({ ...base, publishTiming: "scheduled", date: "2031-09-22", time });
    expect(at("06:59")).toEqual({ kind: "invalid", reason: "tooSoon" });
    expect(at("07:00")).toEqual({ kind: "invalid", reason: "tooSoon" });
    expect(at("07:01")).toEqual({ kind: "invalid", reason: "tooSoon" });
    expect(at("07:02").kind).toBe("scheduled");
  });

  test("a posting time at or after 11:59 PM on the due date is invalid; earlier is valid", () => {
    const withDue = (date: string, time: string) =>
      resolveRowSchedule({
        ...base,
        publishTiming: "scheduled",
        date,
        time,
        dueDate: "2031-09-29",
      });
    expect(withDue("2031-09-29", "23:58").kind).toBe("scheduled");
    expect(withDue("2031-09-29", "23:59")).toEqual({ kind: "invalid", reason: "afterDue" });
    expect(withDue("2031-09-30", "07:00")).toEqual({ kind: "invalid", reason: "afterDue" });
  });

  test("no due date means no due-date constraint", () => {
    expect(
      resolveRowSchedule({ ...base, publishTiming: "scheduled", date: "2032-06-01" }).kind,
    ).toBe("scheduled");
  });
});

describe("formatPostingPreview", () => {
  test("names weekday, date, time, and zone for this year's dates", () => {
    expect(formatPostingPreview(new Date("2031-09-29T12:00:00.000Z"), NOW)).toBe(
      "Posts Mon, Sep 29 at 8:00 AM EDT",
    );
    expect(formatPostingPreview(new Date("2031-12-01T13:30:00.000Z"), NOW)).toBe(
      "Posts Mon, Dec 1 at 8:30 AM EST",
    );
  });

  test("adds the year only when it differs from the current year", () => {
    expect(formatPostingPreview(new Date("2032-01-05T13:00:00.000Z"), NOW)).toBe(
      "Posts Mon, Jan 5, 2032 at 8:00 AM EST",
    );
  });
});
