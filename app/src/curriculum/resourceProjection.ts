// RA-1 shared flat resource projection.
//
// A derived, read-only, flat view of every canonical curriculum resource,
// one entry per resource identity. It is computed from the generated
// curriculum manifest and the resource-type policy through the selectors in
// `curriculumManifest.ts`; it is not a second registry and carries no
// hand-authored resource data. To change a resource, edit
// `curriculum.registry.json` and run `npm run curriculum:build`.
//
// The projection describes resources only. It never encodes teacher, grade
// organization, teacher-defined unit membership, class, or assignment
// occurrence. Placement eligibility and authenticated assignment support are
// independent: a resource may be placeable in a teacher-defined unit while
// it remains unassignable. Contract: docs/platform/FLAT_RESOURCE_PROJECTION.md.

import {
  getAllUnits,
  getSharedResources,
  RESOURCE_TYPE_POLICY,
  type CurriculumResource,
  type CurriculumUnit,
  type LessonGrade,
  type LessonTopic,
  type ResourceType,
} from "./curriculumManifest";

// "tool" is a reusable tool (policy placement "shared"): reachable on its
// own, never a member of a teacher-defined unit, and never required to have
// an assessment, completion definition, or assignment delivery.
export type FlatResourceKind = "instructional" | "tool";

// What the platform supports for this resource today. Planned support is
// not represented; each flag flips only when the capability actually ships.
export type FlatResourceCapabilities = {
  // Teachers can create and publish an authenticated assignment for it.
  // Mirrors the client assignment surface (policy `assignable`, unit not
  // gated); the server allowlist in
  // platform/functions/src/shared/activity-identifiers.ts stays the
  // enforcement boundary.
  readonly authenticatedAssignment: boolean;
  // Its assignments are scored by the certified server-side assessment
  // pipeline. Publication requires a deployed assessment, so today this
  // holds exactly when authenticated assignment does. A page quiz or a
  // legacy Apps Script submission does not count.
  readonly serverScoredAssessment: boolean;
  // Authenticated resource-specific evidence persisted independently of
  // assessment-attempt records. Optional "Show Your Thinking" responses that
  // lessons already store inside their assessment attempts do not count.
  // No registered resource supports this yet.
  readonly platformEvidence: boolean;
};

export type FlatResource = {
  // Canonical identifier. Lessons: the lesson slug. Simulations,
  // investigations, extensions, challenges: the assignment activity
  // identifier "<type>-<stem>" (app/scripts/activityIdentifiers.cjs).
  // Tools: the registry shared-resource id.
  readonly id: string;
  readonly type: ResourceType;
  readonly kind: FlatResourceKind;
  // Lessons use the unit title; every other resource uses its own label.
  readonly title: string;
  // Lessons and tools carry a registry description; other resources have
  // none (null, not an empty string).
  readonly description: string | null;
  // From the owning registry unit; null for tools, which have no grade or
  // topic in the registry.
  readonly grade: LessonGrade | null;
  readonly topic: LessonTopic | null;
  // Resource-type policy: part of the formal LyfeLabz curriculum.
  readonly formal: boolean;
  // The owning registry unit is gated (not surfaced to teachers).
  readonly gated: boolean;
  // The lesson whose catalog card lists this resource (a lesson lists
  // itself). Null for tools. Catalog grouping only, not teacher-defined
  // unit membership.
  readonly catalogLessonId: string | null;
  // Tools only: lessons the registry records a conceptual relationship to.
  readonly relatedLessonIds: ReadonlyArray<string>;
  // Existing open/practice route, unchanged.
  readonly openHref: string;
  // May be placed into a teacher-defined instructional unit. Independent
  // of `capabilities.authenticatedAssignment`.
  readonly unitPlaceable: boolean;
  readonly capabilities: FlatResourceCapabilities;
};

// Unit-owned types that carry a canonical identifier. Mirrors
// ACTIVITY_RESOURCE_TYPES in app/scripts/activityIdentifiers.cjs (a parity
// test keeps them in step). Unit-owned resources of any other type have no
// canonical identifier and are left out of the projection.
const IDENTIFIED_UNIT_TYPES: ReadonlySet<ResourceType> = new Set([
  "lesson",
  "simulation",
  "investigation",
  "extension",
  "challenge",
]);

// Registry validation guarantees a lesson's identifier equals its unit
// slug and every other identified filename is "<type>_<stem>.html" with a
// valid stem; this applies the same mapping without re-validating.
function canonicalId(unit: CurriculumUnit, resource: CurriculumResource): string {
  if (resource.type === "lesson") return unit.slug;
  const stem = resource.filename.slice(
    `${resource.type}_`.length,
    -".html".length,
  );
  return `${resource.type}-${stem}`;
}

const NO_CAPABILITIES: FlatResourceCapabilities = Object.freeze({
  authenticatedAssignment: false,
  serverScoredAssessment: false,
  platformEvidence: false,
});

function projectUnitResource(
  unit: CurriculumUnit,
  resource: CurriculumResource,
): FlatResource {
  const policy = RESOURCE_TYPE_POLICY[resource.type];
  const assignable = policy.assignable && !unit.gated;
  const isLesson = resource.type === "lesson";
  return Object.freeze({
    id: canonicalId(unit, resource),
    type: resource.type,
    kind: "instructional",
    title: isLesson ? unit.title : resource.label,
    description: isLesson ? unit.description : null,
    grade: unit.grade,
    topic: unit.topic,
    formal: policy.formal,
    gated: unit.gated,
    catalogLessonId: unit.slug,
    relatedLessonIds: Object.freeze([]),
    openHref: resource.href,
    unitPlaceable: policy.teacherVisible && !unit.gated,
    capabilities: assignable
      ? Object.freeze({
          authenticatedAssignment: true,
          serverScoredAssessment: true,
          platformEvidence: false,
        })
      : NO_CAPABILITIES,
  });
}

function buildProjection(): ReadonlyArray<FlatResource> {
  const out: FlatResource[] = [];
  for (const unit of getAllUnits()) {
    const owned = unit.resources
      .filter((r) => IDENTIFIED_UNIT_TYPES.has(r.type))
      .slice()
      .sort((a, b) => a.displayOrder - b.displayOrder);
    for (const resource of owned) out.push(projectUnitResource(unit, resource));
  }
  for (const shared of getSharedResources()) {
    out.push(
      Object.freeze({
        id: shared.id,
        type: shared.type,
        kind: "tool",
        title: shared.label,
        description: shared.description,
        grade: null,
        topic: null,
        formal: RESOURCE_TYPE_POLICY[shared.type].formal,
        gated: false,
        catalogLessonId: null,
        relatedLessonIds: Object.freeze(shared.relatedUnits.slice()),
        openHref: shared.href,
        unitPlaceable: false,
        capabilities: NO_CAPABILITIES,
      }),
    );
  }
  assertUniqueIds(out);
  return Object.freeze(out);
}

// Registry validation keeps unit-owned activity identifiers unique and
// shared-resource ids unique, but not one set against the other. A tool id
// equal to a lesson slug or activity identifier would make lookup ambiguous,
// so the projection refuses to build.
function assertUniqueIds(resources: ReadonlyArray<FlatResource>): void {
  const seen = new Map<string, FlatResource>();
  for (const r of resources) {
    const prior = seen.get(r.id);
    if (prior !== undefined) {
      throw new Error(
        `Duplicate canonical resource id "${r.id}": ${prior.openHref} (${prior.type}) and ${r.openHref} (${r.type}). Rename one in curriculum.registry.json.`,
      );
    }
    seen.set(r.id, r);
  }
}

let projection: ReadonlyArray<FlatResource> | null = null;

// Every canonical resource, in canonical registry order: topic group, unit,
// the unit's resource `displayOrder`, then shared resources in registry
// order. Gated resources are included and flagged. Throws when two
// resources share a canonical id.
export function getFlatResources(): ReadonlyArray<FlatResource> {
  if (projection === null) projection = buildProjection();
  return projection;
}

// The resource with canonical identifier `id`, or null. Throws, like
// `getFlatResources`, when the projection has a duplicate id.
export function getFlatResourceById(id: string): FlatResource | null {
  return getFlatResources().find((r) => r.id === id) ?? null;
}
