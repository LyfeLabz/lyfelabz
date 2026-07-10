// Typed selector over the generated canonical curriculum manifest.
//
// This module is the ONLY authoritative curriculum accessor for the
// teacher application. It reads from `curriculum.manifest.json`, which
// is generated deterministically from the root `index.html` by
// `app/scripts/build-curriculum-manifest.cjs`. Curriculum metadata is
// never hand-authored in TypeScript. See:
//
//   - TEACHER_EXPERIENCE_PHILOSOPHY.md §3.9 (one canonical curriculum)
//   - PRESENT_MODE_ARCHITECTURE.md §12
//   - PDR-007 (canonical experience)
//   - docs/platform/SPRINT_6D_0_SPECIFICATION.md
//
// To update curriculum metadata, edit the canonical `index.html` at the
// repository root and run `npm run curriculum:build` inside `app/`. A
// drift test enforces that the checked-in manifest matches the current
// canonical source; do not edit the JSON directly.

import manifestJson from "./curriculum.manifest.json";

export type LessonTopic =
  | "life-science"
  | "earth-space"
  | "physical-science"
  | "tech-engineering"
  | "behavioral-science";

export type LessonGrade = "6" | "7";

export type ResourceType =
  | "lesson"
  | "simulation"
  | "investigation"
  | "extension"
  | "challenge"
  | "activity"
  | "game"
  | "map"
  | "disease";

export type CurriculumResource = {
  readonly type: ResourceType;
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
    readonly resourceCountsByType: Readonly<Record<ResourceType, number>>;
    readonly unitsByGrade: Readonly<Record<LessonGrade, number>>;
    readonly unitsByTopic: Readonly<Record<LessonTopic, number>>;
    readonly unitsByTopicAndGrade: Readonly<Record<string, number>>;
  };
  readonly topicGroups: ReadonlyArray<CurriculumTopicGroup>;
  readonly orphanUnits: ReadonlyArray<CurriculumOrphanUnit>;
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

// Units that have at least one `lesson` resource and are not gated.
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
    const lesson = u.resources.find((r) => r.type === "lesson");
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

export function getOrphanUnits(): ReadonlyArray<CurriculumOrphanUnit> {
  return CURRICULUM_MANIFEST.orphanUnits;
}
