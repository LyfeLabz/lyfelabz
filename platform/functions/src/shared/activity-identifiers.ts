import { PlatformError } from "./errors/platform-error";
import type { AssignmentResourceType } from "./types/assignment";

// Server-side owner of the assignment activity-identifier contract
// (Resource Expansion Phase 1). An assignment's `lessonSlug` is its
// activity identifier for every resource type; the optional
// `resourceType` names the kind of activity and defaults to "lesson".
//
// Grammar:
//   lesson identifier    = the existing lesson slug, unchanged
//   resource identifier  = type "-" stem
//   stem                 = [a-z0-9]+ ("-" [a-z0-9]+)*
//
// Each non-lesson type's "<type>-" prefix is reserved: a lesson slug may
// never begin with one. The identifier therefore determines its own type,
// and the assessment that grades it (`assessment_<identifier>`, see
// `assessment-identifiers.ts`) inherits that type. The server never infers
// a type from the identifier: it verifies the claimed (or defaulted) type
// against it and refuses any disagreement.
//
// The build-side mapping from curriculum registry resources to these
// identifiers is `app/scripts/activityIdentifiers.cjs`; a parity test
// keeps the two in step.

export const ASSIGNMENT_RESOURCE_TYPES: readonly AssignmentResourceType[] =
  Object.freeze(["lesson", "simulation", "investigation", "extension", "challenge"]);

export const DEFAULT_ASSIGNMENT_RESOURCE_TYPE: AssignmentResourceType = "lesson";

type NonLessonResourceType = Exclude<AssignmentResourceType, "lesson">;

export const RESERVED_ACTIVITY_ID_PREFIXES: Readonly<Record<NonLessonResourceType, string>> =
  Object.freeze({
    simulation: "simulation-",
    investigation: "investigation-",
    extension: "extension-",
    challenge: "challenge-",
  });

// Non-lesson resources stay unassignable until their authenticated
// delivery and assessment infrastructure exists.
const ASSIGNABLE_RESOURCE_TYPES: ReadonlySet<AssignmentResourceType> = new Set(["lesson"]);

const RESOURCE_ACTIVITY_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ACTIVITY_ID_LENGTH = 128;

export function isAssignmentResourceType(value: unknown): value is AssignmentResourceType {
  return (
    typeof value === "string" &&
    (ASSIGNMENT_RESOURCE_TYPES as readonly string[]).includes(value)
  );
}

export function isResourceTypeAssignable(resourceType: AssignmentResourceType): boolean {
  return ASSIGNABLE_RESOURCE_TYPES.has(resourceType);
}

// The non-lesson type whose reserved prefix `activityId` begins with, or
// `undefined` when it begins with none (lesson grammar).
export function reservedResourceTypeForActivityId(
  activityId: string,
): NonLessonResourceType | undefined {
  for (const type of Object.keys(RESERVED_ACTIVITY_ID_PREFIXES) as NonLessonResourceType[]) {
    if (activityId.startsWith(RESERVED_ACTIVITY_ID_PREFIXES[type])) return type;
  }
  return undefined;
}

// Normalizes a request or stored `resourceType`. Absent means "lesson";
// any other non-supported value is refused rather than coerced.
export function parseAssignmentResourceType(value: unknown): AssignmentResourceType {
  if (value === undefined) return DEFAULT_ASSIGNMENT_RESOURCE_TYPE;
  if (!isAssignmentResourceType(value)) {
    throw new PlatformError(
      "assignments.invalidResourceType",
      `resourceType, when supplied, must be one of: ${ASSIGNMENT_RESOURCE_TYPES.join(", ")}.`,
    );
  }
  return value;
}

// Refuses an activity identifier that does not belong to `resourceType`:
// a lesson identifier carrying a reserved resource prefix, or a resource
// identifier that is not "<type>-<stem>" for exactly its own type. Lesson
// identifier character rules stay with the callers' existing patterns so
// every existing lesson slug remains valid.
export function assertActivityIdMatchesResourceType(
  activityId: string,
  resourceType: AssignmentResourceType,
): void {
  const reserved = reservedResourceTypeForActivityId(activityId);
  if (resourceType === "lesson") {
    if (reserved !== undefined) {
      throw new PlatformError(
        "assignments.resourceTypeMismatch",
        `Activity identifier "${activityId}" names a ${reserved}, not a lesson.`,
      );
    }
    return;
  }
  if (reserved !== resourceType) {
    throw new PlatformError(
      "assignments.resourceTypeMismatch",
      `Activity identifier "${activityId}" does not name a ${resourceType}.`,
    );
  }
  if (
    activityId.length > MAX_ACTIVITY_ID_LENGTH ||
    !RESOURCE_ACTIVITY_ID_PATTERN.test(activityId.slice(RESERVED_ACTIVITY_ID_PREFIXES[resourceType].length))
  ) {
    throw new PlatformError(
      "assignments.invalidLessonSlug",
      `A ${resourceType} activity identifier must be "${RESERVED_ACTIVITY_ID_PREFIXES[resourceType]}" followed by lowercase letters, digits, and single hyphens.`,
    );
  }
}

// Identifier/type gate: the identifier must belong to the type, and the
// type must be assignable today. Every draft creation and every draft ->
// published transition passes it; a draft update passes it only when it
// supplies a new `lessonSlug` (a supplied `resourceType` is separately
// checked against the record's). Type consistency only, not registry
// membership.
export function assertAssignableActivity(
  activityId: string,
  resourceType: AssignmentResourceType,
): void {
  assertActivityIdMatchesResourceType(activityId, resourceType);
  if (!isResourceTypeAssignable(resourceType)) {
    throw new PlatformError(
      "assignments.resourceTypeNotAssignable",
      `${resourceType} activities cannot be assigned yet.`,
    );
  }
}
