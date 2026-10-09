# Flat Resource Projection (RA-1)

Shared, read-only contract describing every canonical curriculum resource and
what the platform supports for it today. Owned by Resource Architecture;
intended for Curriculum and Units Modernization to consume.

Status: implemented as an accessor only. No existing surface consumes it yet.
Teacher-defined units and Gravity Wells authenticated assignments are **not**
implemented.

## Source of truth

The projection is derived; it is not a registry.

- Authored source: `app/src/curriculum/curriculum.registry.json`.
- Generated manifest: `curriculum.manifest.json` (`npm run curriculum:build`).
- Type policy: `curriculum.resource-types.json`.
- Read through the existing selectors in `curriculumManifest.ts`
  (`getAllUnits`, `getSharedResources`, `RESOURCE_TYPE_POLICY`).

To change a resource, edit the registry. Registry validation is unchanged.

## Accessor and type

Module: `app/src/curriculum/resourceProjection.ts`.

- `getFlatResources(): ReadonlyArray<FlatResource>`: every resource, in
  canonical registry order (topic group, unit, resource `displayOrder`, then
  shared resources). Frozen; gated resources included and flagged.
- `getFlatResourceById(id): FlatResource | null`.
- Types: `FlatResource`, `FlatResourceKind`, `FlatResourceCapabilities`.

| Field | Meaning |
| --- | --- |
| `id` | Canonical identifier. Lesson: lesson slug. Simulation, investigation, extension, challenge: activity identifier `<type>-<stem>` (`app/scripts/activityIdentifiers.cjs`). Tool: registry shared-resource `id`. |
| `type` | Registry resource type. |
| `kind` | `"instructional"` or `"tool"` (policy placement `shared`). |
| `title` | Lesson: unit title. Others: registry label. |
| `description` | Lesson: unit description. Tool: registry description. Others: `null` (none authored). |
| `grade`, `topic` | From the owning registry unit; `null` for tools. |
| `formal`, `gated` | Type policy `formal`; owning unit `gated`. |
| `catalogLessonId` | Lesson whose catalog card lists the resource (a lesson lists itself); `null` for tools. Catalog grouping only. |
| `relatedLessonIds` | Tools only: registry `relatedUnits`. |
| `openHref` | Existing open/practice route, unchanged. |
| `unitPlaceable` | May be placed in a teacher-defined unit. |
| `capabilities` | Current support only (below). |

## Placement eligibility

`unitPlaceable` is true when the type is teacher-visible in policy and the
owning unit is not gated. It is the same surfaceability the Curriculum
Lessons grid and resource tabs use, without the assignability split. It never
depends on assignment support: Gravity Wells (`simulation-gravity-wells`) is
placeable and unassignable.

## Capabilities (current, not planned)

- `authenticatedAssignment`: type policy `assignable` and unit not gated. This
  reproduces exactly the lessons `getSurfaceableLessons` offers today (49).
  It is a client description, not a gate. The enforcement boundary remains
  the server allowlist `ASSIGNABLE_RESOURCE_TYPES` in
  `platform/functions/src/shared/activity-identifiers.ts` (lessons only).
- `serverScoredAssessment`: assignments are scored by the certified server
  pipeline. Publication requires a deployed assessment, so today this equals
  `authenticatedAssignment`. A page quiz or legacy Apps Script submission
  does not count.
- `platformEvidence`: authenticated resource-specific evidence persisted
  independently of assessment-attempt records. Optional "Show Your Thinking"
  responses that lessons already store inside assessment attempts (and show
  to teachers) are part of the attempt, not independent evidence, so they do
  not set this flag. False for every registered resource today.

The open route (`openHref`) is the only delivery every resource has. No
authenticated non-lesson delivery exists, and the projection does not
construct assignment URLs. Question counts are not part of the contract: the
ten-question lesson format and the five-question non-lesson standard
(`LYFELABZ_NON_LESSON_ASSESSMENT_EVIDENCE_STANDARD.md`) stay with their
assessment definitions. Each flag changes only when the capability ships.

## Reusable tools

Tools stay in the registry's top-level `sharedResources`. They project with
`kind: "tool"`, `unitPlaceable: false`, and no capabilities, and need no
unit, assessment, completion definition, or assignment delivery. The Lab
Report Assistant (`lab-report-assistant`) is the reference case.

## Excluded

The projection carries no teacher, teacher-grade organization, unit id, unit
membership or ordering, class, assignment occurrence, or assignment unit
snapshot. Those belong to Curriculum and Units Modernization and are keyed
by the stable `id` here. Two teachers can organize the same `id`s
differently, and classes sharing an organization assign independently.

Unit-owned resources of types without an activity identifier (`game`,
`activity`, `map`, `disease`; none registered today) are left out rather than
given an invented id.

## Known gaps

- No standards metadata exists in the registry; the projection exposes none.
- No concept metadata exists for a future Unit Review Builder.
- Registry validation does not check tool ids against lesson slugs or
  activity identifiers. The projection does: `getFlatResources` and
  `getFlatResourceById` throw on a duplicate canonical id, naming the id and
  both routes, so lookup never silently returns one of two resources.
