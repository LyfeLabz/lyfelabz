import type { StudentSupportSeam } from "./types";

// Session-scoped holder for the Student Support Access seam (PDR-032),
// following the Grade Improvements holder pattern. The entry point installs it
// for an active-teacher session and clears it otherwise; the Classes surface
// reads it when its own deps do not supply one (tests pass it through deps).
// In-memory only; never persisted.

let current: StudentSupportSeam | null = null;

export function installStudentSupportSeam(seam: StudentSupportSeam | null): void {
  current = seam;
}

export function readStudentSupportSeam(): StudentSupportSeam | null {
  return current;
}
