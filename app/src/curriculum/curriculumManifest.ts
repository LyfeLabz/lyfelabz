// Typed selector over the generated canonical curriculum manifest.
//
// This module is the ONLY authoritative curriculum accessor for the
// teacher application. It reads from `curriculum.manifest.json`, which
// is generated deterministically from the authored curriculum registry
// (`curriculum.registry.json`) by
// `app/scripts/build-curriculum-manifest.cjs`. Curriculum metadata is
// never hand-authored in TypeScript. See:
//
//   - TEACHER_EXPERIENCE_PHILOSOPHY.md §3.9 (one canonical curriculum)
//   - PRESENT_MODE_ARCHITECTURE.md §12
//   - PDR-007 (canonical experience)
//   - docs/platform/SPRINT_6D_0_SPECIFICATION.md
//
// To update curriculum metadata, edit `curriculum.registry.json` (and,
// during migration, the matching card in the root `index.html`) and run
// `npm run curriculum:build` inside `app/`. Drift tests enforce that the
// checked-in manifest matches the registry and that the homepage presents
// exactly the registered curriculum; do not edit the manifest directly.

import manifestJson from "./curriculum.manifest.json";
import resourceTypePolicyJson from "./curriculum.resource-types.json";

export type LessonTopic =
  | "life-science"
  | "earth-space"
  | "physical-science"
  | "tech-engineering"
  | "behavioral-science";

export type LessonGrade = "6" | "7";

// Types a curriculum unit may own (policy placement "unit").
export type UnitResourceType =
  | "lesson"
  | "simulation"
  | "investigation"
  | "extension"
  | "challenge"
  | "activity"
  | "game"
  | "map"
  | "disease";

// Types that live in the manifest's top-level `sharedResources` (policy
// placement "shared"). No unit owns them.
export type SharedResourceType = "tool";

export type ResourceType = UnitResourceType | SharedResourceType;

// Canonical code-level resource-type policy, read from
// `curriculum.resource-types.json` (shared with the registry build).
export type ResourceTypePolicy = {
  readonly filenamePrefix: string;
  readonly ulinkClass: string | null;
  readonly placement: "unit" | "shared";
  readonly formal: boolean;
  readonly teacherVisible: boolean;
  readonly assignable: boolean;
};

export const RESOURCE_TYPE_POLICY: Readonly<
  Record<ResourceType, ResourceTypePolicy>
> = resourceTypePolicyJson.types as unknown as Record<
  ResourceType,
  ResourceTypePolicy
>;

export type CurriculumResource = {
  readonly type: UnitResourceType;
  readonly href: string;
  readonly filename: string;
  readonly label: string;
  readonly displayOrder: number;
};

export type CurriculumUnit = {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly grade: LessonGrade;
  readonly topic: LessonTopic;
  readonly gated: boolean;
  readonly displayOrder: number;
  readonly inGroupOrder: number;
  readonly resources: ReadonlyArray<CurriculumResource>;
};

export type CurriculumTopicGroup = {
  readonly topic: LessonTopic;
  readonly label: string;
  readonly gated: boolean;
  readonly displayOrder: number;
  readonly units: ReadonlyArray<CurriculumUnit>;
};

// A top-level registry resource no unit owns (e.g. a reusable tool).
// `relatedUnits` is a conceptual relationship to unit slugs; it implies
// no homepage nesting and no Teacher Workspace placement.
export type CurriculumSharedResource = {
  readonly id: string;
  readonly type: SharedResourceType;
  readonly href: string;
  readonly filename: string;
  readonly label: string;
  readonly description: string;
  readonly relatedUnits: ReadonlyArray<string>;
  readonly displayOrder: number;
};

export type CurriculumOrphanUnit = {
  readonly topic: LessonTopic;
  readonly grade: LessonGrade;
  readonly gated: boolean;
};

export type CurriculumManifest = {
  readonly schemaVersion: 1;
  readonly generated: true;
  readonly generatedBy: string;
  readonly canonicalSource: string;
  readonly canonicalSourceRelativeToApp: string;
  readonly canonicalSourceSha256: string;
  readonly doNotEditByHand: string;
  readonly totals: {
    readonly unitCount: number;
    readonly gatedUnitCount: number;
    readonly resourceCountsByType: Readonly<Record<UnitResourceType, number>>;
    readonly unitsByGrade: Readonly<Record<LessonGrade, number>>;
    readonly unitsByTopic: Readonly<Record<LessonTopic, number>>;
    readonly unitsByTopicAndGrade: Readonly<Record<string, number>>;
  };
  readonly topicGroups: ReadonlyArray<CurriculumTopicGroup>;
  readonly orphanUnits: ReadonlyArray<CurriculumOrphanUnit>;
  readonly sharedResources: ReadonlyArray<CurriculumSharedResource>;
};

export const CURRICULUM_MANIFEST: CurriculumManifest =
  manifestJson as unknown as CurriculumManifest;

export const TOPIC_LABEL: Readonly<Record<LessonTopic, string>> = Object.freeze(
  Object.fromEntries(
    CURRICULUM_MANIFEST.topicGroups.map((g) => [g.topic, g.label]),
  ) as Record<LessonTopic, string>,
);

// Every unit surfaced by the canonical index, gated units included.
export function getAllUnits(): ReadonlyArray<CurriculumUnit> {
  const out: CurriculumUnit[] = [];
  for (const g of CURRICULUM_MANIFEST.topicGroups) {
    for (const u of g.units) out.push(u);
  }
  return out;
}

// Units that have an assignable (policy) resource, i.e. a `lesson`, and
// are not gated.
// This is the read-only bridge the Sprint 6D curriculum surface
// consumes; gated (behavioral-science) units remain in the manifest but
// are not surfaced by the teacher landing page. PDR-010 activation is
// still deferred to Phase 5; this getter is the shape-preserving
// replacement for the Sprint 6D `LESSON_CATALOG`.
export type SurfaceableLesson = {
  readonly slug: string;
  readonly title: string;
  readonly grade: LessonGrade;
  readonly topic: LessonTopic;
  readonly href: string;
};

export function getSurfaceableLessons(): ReadonlyArray<SurfaceableLesson> {
  const out: SurfaceableLesson[] = [];
  for (const u of getAllUnits()) {
    if (u.gated) continue;
    const lesson = u.resources.find(
      (r) => RESOURCE_TYPE_POLICY[r.type].assignable,
    );
    if (!lesson) continue;
    out.push(
      Object.freeze({
        slug: u.slug,
        title: u.title,
        grade: u.grade,
        topic: u.topic,
        href: lesson.href,
      }),
    );
  }
  return Object.freeze(out);
}

export function getTopicGroups(): ReadonlyArray<CurriculumTopicGroup> {
  return CURRICULUM_MANIFEST.topicGroups;
}

// Sprint 28.6D: formal LyfeLabz resource types. These are the four
// non-lesson instructional resource families surfaced under a Curriculum
// lesson card's Resources disclosure. Legacy `game` (and `activity`,
// `map`, `disease`) are deliberately excluded: games are not formal
// LyfeLabz curriculum (Blueprint §9) and the manifest already carries
// `game: 0`. Membership is decided by the resource-type policy
// (`teacherVisible`); this union and its labels must stay in step with it.
export type FormalResourceType =
  | "simulation"
  | "investigation"
  | "extension"
  | "challenge";

// Human-readable, teacher-facing labels for each formal resource type.
// Derived from the canonical type; never exposes a raw filename, path,
// or manifest key.
export const FORMAL_RESOURCE_LABEL: Readonly<
  Record<FormalResourceType, string>
> = Object.freeze({
  simulation: "Simulation",
  investigation: "Investigation",
  extension: "Extension",
  challenge: "Challenge",
});

// Resolve a single canonical unit by its slug, or null when the slug is
// not present in the manifest. Read-only accessor over the generated
// manifest; the manifest remains the sole source of truth.
export function getUnitBySlug(slug: string): CurriculumUnit | null {
  for (const u of getAllUnits()) {
    if (u.slug === slug) return u;
  }
  return null;
}

// The formal related resources for a lesson, ordered by the manifest's
// `displayOrder`. Returns only the four formal resource families; the
// parent `lesson` resource and any legacy `game`/`activity`/`map`/
// `disease` entries are excluded. An empty array means the lesson has no
// formal resources (the Curriculum card then omits the Resources control
// entirely rather than showing an empty disclosure).
export function getFormalResourcesForLesson(
  slug: string,
): ReadonlyArray<CurriculumResource> {
  const unit = getUnitBySlug(slug);
  if (unit === null) return Object.freeze([]);
  return Object.freeze(
    unit.resources
      .filter(
        (r) => r.type !== "lesson" && RESOURCE_TYPE_POLICY[r.type].teacherVisible,
      )
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder),
  );
}

export function getOrphanUnits(): ReadonlyArray<CurriculumOrphanUnit> {
  return CURRICULUM_MANIFEST.orphanUnits;
}

// Top-level shared resources (e.g. tools), in registry order. Read-only;
// no Teacher Workspace surface consumes these yet.
export function getSharedResources(): ReadonlyArray<CurriculumSharedResource> {
  return CURRICULUM_MANIFEST.sharedResources;
}

// Policy lookup that tolerates an arbitrary runtime string: an unknown
// type (or an inherited Object key) yields null rather than a policy.
function policyFor(type: string): ResourceTypePolicy | null {
  return Object.prototype.hasOwnProperty.call(RESOURCE_TYPE_POLICY, type)
    ? RESOURCE_TYPE_POLICY[type as ResourceType]
    : null;
}

// A unit-owned resource paired with its owning unit, for a future
// type-organized Teacher Workspace view. Both members are the manifest's
// own (read-only) objects; nothing is copied or re-derived.
export type SurfaceableUnitResource = {
  readonly resource: CurriculumResource;
  readonly unit: CurriculumUnit;
};

// Every teacher-surfaceable, non-assignable unit-owned resource of `type`,
// in canonical registry order (topic group, then unit, then the unit's
// resource `displayOrder`). Surfaceability is decided entirely by the
// resource-type policy: the type must be unit-placed, `teacherVisible`, and
// not `assignable` (assignable resources are surfaced, with their
// assignment semantics, by `getSurfaceableLessons`). Any other or unknown
// type yields an empty array. Gated units are skipped, consistent with
// `getSurfaceableLessons`.
export function getResourcesByType(
  type: UnitResourceType,
): ReadonlyArray<SurfaceableUnitResource> {
  const policy = policyFor(type);
  if (
    policy === null ||
    policy.placement !== "unit" ||
    !policy.teacherVisible ||
    policy.assignable
  ) {
    return Object.freeze([]);
  }
  const out: SurfaceableUnitResource[] = [];
  for (const unit of getAllUnits()) {
    if (unit.gated) continue;
    const owned = unit.resources
      .filter((r) => r.type === type)
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder);
    for (const resource of owned) out.push(Object.freeze({ resource, unit }));
  }
  return Object.freeze(out);
}

// Teacher-surfaceable shared resources of `type`, in registry order. Empty
// unless the type's policy is shared-placed and `teacherVisible`; tools are
// currently `teacherVisible: false`, so this returns nothing for them.
// `getSharedResources` remains the unfiltered canonical lookup.
export function getTeacherVisibleSharedResources(
  type: SharedResourceType,
): ReadonlyArray<CurriculumSharedResource> {
  const policy = policyFor(type);
  if (policy === null || policy.placement !== "shared" || !policy.teacherVisible) {
    return Object.freeze([]);
  }
  return Object.freeze(
    CURRICULUM_MANIFEST.sharedResources.filter((r) => r.type === type),
  );
}

// Resolve a shared resource's `relatedUnits` slugs to their canonical
// units, in the resource's declared order. Unknown slugs and gated units
// are omitted, consistent with `getSurfaceableLessons`.
export function getSurfaceableRelatedUnits(
  resource: CurriculumSharedResource,
): ReadonlyArray<CurriculumUnit> {
  const out: CurriculumUnit[] = [];
  for (const slug of resource.relatedUnits) {
    const unit = getUnitBySlug(slug);
    if (unit !== null && !unit.gated) out.push(unit);
  }
  return Object.freeze(out);
}
