import { TEACHER_UNIT_DESCRIPTION_MAX_LENGTH, TEACHER_UNIT_TITLE_MAX_LENGTH } from "./types";

// U2.2 - client mirror of the server field rules
// (platform/functions/src/teacherUnits/teacher-unit-access.ts readTitle /
// readDescription; TEACHER_UNITS.md §3). Used for immediate form feedback
// and for strict validation of persisted create attempts. The server
// re-validates everything; these never replace it.

// C0 controls and DEL. Titles admit none; descriptions admit tab, line
// feed, and carriage return only (same sets as the server).
// eslint-disable-next-line no-control-regex
const TITLE_FORBIDDEN = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const DESCRIPTION_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

function codePoints(s: string): number {
  return Array.from(s).length;
}

export function validateUnitTitle(raw: string): string | null {
  const t = raw.trim();
  if (t.length === 0) return "Enter a unit name.";
  if (codePoints(t) > TEACHER_UNIT_TITLE_MAX_LENGTH) {
    return `Unit names can be up to ${TEACHER_UNIT_TITLE_MAX_LENGTH} characters.`;
  }
  if (TITLE_FORBIDDEN.test(t)) return "Unit names can't include special control characters.";
  return null;
}

export function validateUnitDescription(raw: string): string | null {
  const d = raw.trim();
  if (codePoints(d) > TEACHER_UNIT_DESCRIPTION_MAX_LENGTH) {
    return `Descriptions can be up to ${TEACHER_UNIT_DESCRIPTION_MAX_LENGTH} characters.`;
  }
  if (DESCRIPTION_FORBIDDEN.test(d)) return "Descriptions can't include special control characters.";
  return null;
}
