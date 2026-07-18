// Sprint 16 Slice 4: narrow session-scoped Curriculum scroll guard.
//
// The teacher opens Assignment Detail from Curriculum, then returns
// through the Detail Back control. This guard captures the Curriculum
// scroll offset on the trip in and restores it on the trip out, clamped
// to the current document height. The snapshot is scoped to the active
// teacher uid so a sign-out or teacher swap invalidates it before it
// could restore against an unrelated surface.
//
// The guard is intentionally free of any persistent client store per
// Sprint 16 Cross-Slice Guardrails. It captures a single numeric offset
// in module-owned closure state.

export type CurriculumScrollGuard = {
  // Capture the current Curriculum scroll offset, scoped to the active
  // teacher uid. Overwrites any previously captured snapshot.
  readonly capture: (uid: string, scrollY: number) => void;
  // Consume and restore the captured offset if it matches the supplied
  // uid. The restoration is clamped to the document height reported by
  // the injected `maxScrollY` reader so a shorter document (for example
  // after a lifecycle-driven card removal) cannot scroll past its
  // bottom. Returns the applied offset or null when nothing was
  // restored.
  readonly restore: (uid: string) => number | null;
  // Invalidate the captured snapshot. Called on any bootstrap-driven
  // session transition (sign-out, teacher swap, full `rerun`).
  readonly invalidate: () => void;
  // Test-only accessor for the currently captured offset.
  readonly peek: () => { uid: string; scrollY: number } | null;
};

export type CurriculumScrollGuardIo = {
  readonly getMaxScrollY: () => number;
  readonly scrollTo: (scrollY: number) => void;
};

export function createCurriculumScrollGuard(
  io: CurriculumScrollGuardIo,
): CurriculumScrollGuard {
  let snapshot: { uid: string; scrollY: number } | null = null;
  return {
    capture: (uid, scrollY) => {
      const value = Number.isFinite(scrollY) ? Math.max(0, scrollY) : 0;
      snapshot = { uid, scrollY: value };
    },
    restore: (uid) => {
      const current = snapshot;
      if (current === null) return null;
      snapshot = null;
      if (current.uid !== uid) return null;
      const maxY = Math.max(0, io.getMaxScrollY());
      const clamped = Math.max(0, Math.min(current.scrollY, maxY));
      io.scrollTo(clamped);
      return clamped;
    },
    invalidate: () => {
      snapshot = null;
    },
    peek: () => (snapshot === null ? null : { ...snapshot }),
  };
}
