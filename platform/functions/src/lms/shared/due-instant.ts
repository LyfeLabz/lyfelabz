import { PlatformError } from "../../shared/errors/platform-error";

// LMS due moment for a LyfeLabz due date.
//
// LyfeLabz stores an assignment's due date as a plain calendar date
// ("YYYY-MM-DD", `AssignmentRecord.dueDate`) and has no teacher-facing due
// time. Google Classroom, however, only accepts a due date as an absolute
// moment: its CourseWork contract says `dueTime` "must be specified if
// `dueDate` is specified", and both are UTC ("To specify a due date, set the
// `dueDate` and `dueTime` fields to the corresponding UTC time"). Sending the
// LyfeLabz calendar date on its own is therefore not a valid Classroom
// request, and sending it verbatim as a UTC date would also shift the due day
// for any school west of UTC.
//
// Convention: a LyfeLabz due date means "due by the END of that day in the
// school's own timezone" - 11:59 PM local, the same default Google Classroom
// itself applies when a teacher picks a due date without a time. The school's
// IANA `timezone` (a required field on `schools/{schoolId}`) is the
// authoritative zone; no browser or guessed zone is involved, so an initial
// publish and every later retry resolve to the identical instant.
export const LMS_DUE_LOCAL_HOUR = 23;
export const LMS_DUE_LOCAL_MINUTE = 59;

const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertValidTimeZone(timeZone: unknown): string {
  if (typeof timeZone !== "string" || timeZone.trim().length === 0) {
    throw new PlatformError(
      "lms.assignmentNotPublishable",
      "School timezone is unavailable; the Classroom due date cannot be resolved.",
    );
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new PlatformError(
      "lms.assignmentNotPublishable",
      "School timezone is not recognized; the Classroom due date cannot be resolved.",
    );
  }
  return timeZone;
}

// Offset (local wall clock minus UTC, in ms) of `timeZone` at `instantMs`.
function zoneOffsetMs(instantMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instantMs));
  const get = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((p) => p.type === type)?.value);
  const wallAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return wallAsUtc - Math.floor(instantMs / 1000) * 1000;
}

// The absolute instant of 11:59 PM on `isoDate` in `timeZone`, as an
// RFC3339 UTC string. The offset is re-evaluated at the candidate instant so
// a date on which the zone changes offset (DST) still resolves to that day's
// real 11:59 PM. A malformed date or unusable timezone fails closed.
export function lmsDueInstantFor(isoDate: string, timeZone: unknown): string {
  const match = ISO_DATE_PATTERN.exec(isoDate);
  if (!match) {
    throw new PlatformError(
      "lms.assignmentNotPublishable",
      "Assignment due date is malformed; publication is not available.",
    );
  }
  const zone = assertValidTimeZone(timeZone);
  const wallAsUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    LMS_DUE_LOCAL_HOUR,
    LMS_DUE_LOCAL_MINUTE,
  );
  let instant = wallAsUtc - zoneOffsetMs(wallAsUtc, zone);
  for (let i = 0; i < 2; i += 1) {
    const next = wallAsUtc - zoneOffsetMs(instant, zone);
    if (next === instant) break;
    instant = next;
  }
  return new Date(instant).toISOString();
}
