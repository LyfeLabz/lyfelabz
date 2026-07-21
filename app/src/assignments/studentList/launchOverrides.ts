// Sprint 18 pilot launcher path overrides.
//
// The Sprint 17 launcher (launch.ts) resolves every assignment to the
// public v1 URL `/lesson_<slug>.html`. Sprint 18 introduces a generated
// v2 artifact under `/app/lessons/<...>.html`. This module is the narrow
// data-driven seam that lets the launcher point Earth's Layers at its
// v2 URL without a lesson-name conditional inside the URL builder.
//
// Rollout is deliberate. Only lessons listed here take the v2 path;
// every other lesson continues to receive the v1 URL byte-for-byte.
//
// When a future sprint expands v2 to another lesson, add the slug here
// AFTER that lesson's generated v2 artifact has passed the full build,
// legacy-absence, instructional-equivalence, and runtime-integration
// checks - never before.

export type LessonLaunchOverride = {
  readonly path: string;
};

export const LESSON_LAUNCH_OVERRIDES: Readonly<
  Record<string, LessonLaunchOverride>
> = {
  "earths-layers": { path: "/app/lessons/lesson_earths-layers.html" },
  "plate-tectonics": { path: "/app/lessons/lesson_plate-tectonics.html" },
};
