// Sprint 18 pilot launcher path overrides, expanded by Sprint 28 Phase 5A.
//
// The Sprint 17 launcher (launch.ts) resolves every assignment to the
// public v1 URL `/lesson_<slug>.html`. Sprint 18 introduced a generated
// v2 artifact under `/app/lessons/<...>.html`. This module is the narrow
// data-driven seam that lets the launcher point a migrated lesson at its
// v2 URL without a lesson-name conditional inside the URL builder.
//
// Rollout is deliberate. Only lessons listed here take the v2 path;
// every other lesson continues to receive the v1 URL byte-for-byte.
//
// Sprint 28 Phase 5A migrated the remaining assignable Category B lessons
// onto the same hardened v2 assignment-aware contract (assignment-context
// runtime wiring, V1-ONLY legacy classroom apparatus, and the W2 results /
// return-navigation hardening), each added here only AFTER its generated v2
// artifact passed the full build, legacy-absence, instructional-equivalence,
// and W2 results-contract checks. Phase 5A.1 then unblocked and migrated
// nature-of-waves (the sole Phase 5A deferral) by removing the safe
// authoring-only SVG comments its quiz diagrams embedded inside a <script>
// template literal, which the marker scanner had rejected; the scanner was
// not weakened. All 49 assignable lessons now launch v2.

export type LessonLaunchOverride = {
  readonly path: string;
};

export const LESSON_LAUNCH_OVERRIDES: Readonly<
  Record<string, LessonLaunchOverride>
> = {
  "earths-layers": { path: "/app/lessons/lesson_earths-layers.html" },
  "plate-tectonics": { path: "/app/lessons/lesson_plate-tectonics.html" },
  "water-cycle": { path: "/app/lessons/lesson_water-cycle.html" },
  "earthquakes": { path: "/app/lessons/lesson_earthquakes.html" },
  "what-is-life": { path: "/app/lessons/lesson_what-is-life.html" },
  "cell-types": { path: "/app/lessons/lesson_cell-types.html" },
  "organelles": { path: "/app/lessons/lesson_organelles.html" },
  "body-systems": { path: "/app/lessons/lesson_body-systems.html" },
  "biological-evolution": { path: "/app/lessons/lesson_biological-evolution.html" },
  "layers-of-time": { path: "/app/lessons/lesson_layers-of-time.html" },
  "continental-drift": { path: "/app/lessons/lesson_continental-drift.html" },
  "gravity": { path: "/app/lessons/lesson_gravity.html" },
  "sun-earth-moon": { path: "/app/lessons/lesson_sun-earth-moon.html" },
  "phases-of-the-moon": { path: "/app/lessons/lesson_phases-of-the-moon.html" },
  "eclipses": { path: "/app/lessons/lesson_eclipses.html" },
  "earths-place-in-the-universe": { path: "/app/lessons/lesson_earths-place-in-the-universe.html" },
  "measuring-matter": { path: "/app/lessons/lesson_measuring-matter.html" },
  "physical-properties": { path: "/app/lessons/lesson_physical-properties.html" },
  "pure-substances-and-mixtures": { path: "/app/lessons/lesson_pure-substances-and-mixtures.html" },
  "chemical-reactions": { path: "/app/lessons/lesson_chemical-reactions.html" },
  "nature-of-waves": { path: "/app/lessons/lesson_nature-of-waves.html" },
  "wave-behavior": { path: "/app/lessons/lesson_wave-behavior.html" },
  "digital-signals": { path: "/app/lessons/lesson_digital-signals.html" },
  "conducting-experiments": { path: "/app/lessons/lesson_conducting-experiments.html" },
  "engineering-design": { path: "/app/lessons/lesson_engineering-design.html" },
  "choosing-materials": { path: "/app/lessons/lesson_choosing-materials.html" },
  "designing-to-scale": { path: "/app/lessons/lesson_designing-to-scale.html" },
  "types-of-volcanoes": { path: "/app/lessons/lesson_types-of-volcanoes.html" },
  "hotspot-volcanoes": { path: "/app/lessons/lesson_hotspot-volcanoes.html" },
  "weathering-and-erosion": { path: "/app/lessons/lesson_weathering-and-erosion.html" },
  "renewable-and-nonrenewable-resources": { path: "/app/lessons/lesson_renewable-and-nonrenewable-resources.html" },
  "parts-of-an-ecosystem": { path: "/app/lessons/lesson_parts-of-an-ecosystem.html" },
  "photosynthesis": { path: "/app/lessons/lesson_photosynthesis.html" },
  "energy-flow": { path: "/app/lessons/lesson_energy-flow.html" },
  "carbon-cycle": { path: "/app/lessons/lesson_carbon-cycle.html" },
  "ecosystem-stability": { path: "/app/lessons/lesson_ecosystem-stability.html" },
  "reproductive-success": { path: "/app/lessons/lesson_reproductive-success.html" },
  "human-impacts": { path: "/app/lessons/lesson_human-impacts.html" },
  "forms-of-energy": { path: "/app/lessons/lesson_forms-of-energy.html" },
  "energy-transfer": { path: "/app/lessons/lesson_energy-transfer.html" },
  "heat-transfer": { path: "/app/lessons/lesson_heat-transfer.html" },
  "introduction-to-electricity": { path: "/app/lessons/lesson_introduction-to-electricity.html" },
  "design-tradeoffs": { path: "/app/lessons/lesson_design-tradeoffs.html" },
  "structural-systems": { path: "/app/lessons/lesson_structural-systems.html" },
  "transportation-systems": { path: "/app/lessons/lesson_transportation-systems.html" },
  "communication-systems": { path: "/app/lessons/lesson_communication-systems.html" },
  "engineering-systems": { path: "/app/lessons/lesson_engineering-systems.html" },
  "technology-and-society": { path: "/app/lessons/lesson_technology-and-society.html" },
  "innovation-and-sustainability": { path: "/app/lessons/lesson_innovation-and-sustainability.html" },
};
