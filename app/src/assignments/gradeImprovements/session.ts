import type { GradeImprovementsSeam } from "./types";

// Session-scoped holder for the Grade Improvements seam. The entry point
// installs it for an active-teacher session and clears it on sign-out; the
// Assignment Detail and Student Detail surfaces read it when their own deps
// do not supply one (tests pass the seam through deps directly).
//
// Kept as a holder rather than threaded through the workspace/router deps so
// this feature touches as few shared shell files as possible while Units
// Modernization work is in flight. In-memory only; never persisted.

let current: GradeImprovementsSeam | null = null;

export function installGradeImprovementsSeam(seam: GradeImprovementsSeam | null): void {
  current = seam;
}

export function readGradeImprovementsSeam(): GradeImprovementsSeam | null {
  return current;
}
