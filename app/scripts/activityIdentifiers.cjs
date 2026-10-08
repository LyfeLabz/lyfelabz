/*
 * LyfeLabz assignment activity-identifier grammar (Resource Expansion
 * Phase 1).
 *
 * An assignment names the activity it delivers through its `lessonSlug`
 * field (kept under that name for backward compatibility). This module is
 * the build-side owner of the deterministic mapping from a canonical
 * curriculum registry resource (type + filename) to that activity
 * identifier:
 *
 *   lesson         lesson_<slug>.html        -> <slug>  (unchanged)
 *   simulation     simulation_<stem>.html    -> simulation-<stem>
 *   investigation  investigation_<stem>.html -> investigation-<stem>
 *   extension      extension_<stem>.html     -> extension-<stem>
 *   challenge      challenge_<stem>.html     -> challenge-<stem>
 *
 * Non-lesson identifiers are lowercase letters, digits, and single
 * hyphens. The `<type>-` prefixes are reserved: no lesson slug may begin
 * with one, so a lesson identifier can never collide with a resource
 * identifier and the identifier alone determines its resource type.
 *
 * The server-side verifier is
 * `platform/functions/src/shared/activity-identifiers.ts`; a parity test
 * there loads this module and the generated curriculum manifest so the two
 * packages cannot drift. Resource files and registry entries are never
 * renamed by this mapping. This module has no external dependencies.
 */

"use strict";

// Resource types that carry an assignment activity identifier, lesson
// first. Assignability is a separate, server-owned decision.
const ACTIVITY_RESOURCE_TYPES = Object.freeze([
  "lesson",
  "simulation",
  "investigation",
  "extension",
  "challenge",
]);

const RESERVED_ACTIVITY_ID_PREFIXES = Object.freeze(
  Object.fromEntries(
    ACTIVITY_RESOURCE_TYPES.filter((t) => t !== "lesson").map((t) => [t, `${t}-`]),
  ),
);

const RESOURCE_ACTIVITY_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_ACTIVITY_ID_LENGTH = 128;

// The non-lesson type whose reserved prefix `activityId` begins with, or
// null when it begins with none (lesson grammar).
function reservedTypeForActivityId(activityId) {
  for (const [type, prefix] of Object.entries(RESERVED_ACTIVITY_ID_PREFIXES)) {
    if (activityId.startsWith(prefix)) return type;
  }
  return null;
}

// The activity identifier for a registry resource, or null when the type
// carries no activity identifier or the filename does not yield a valid
// one (wrong prefix, underscores, uppercase, reserved lesson slug).
function activityIdForResource(type, filename) {
  if (!ACTIVITY_RESOURCE_TYPES.includes(type)) return null;
  if (typeof filename !== "string") return null;
  const prefix = `${type}_`;
  if (!filename.startsWith(prefix) || !filename.endsWith(".html")) return null;
  const stem = filename.slice(prefix.length, -".html".length);
  if (!RESOURCE_ACTIVITY_ID_PATTERN.test(stem)) return null;
  const activityId = type === "lesson" ? stem : `${type}-${stem}`;
  if (activityId.length > MAX_ACTIVITY_ID_LENGTH) return null;
  if (reservedTypeForActivityId(activityId) !== (type === "lesson" ? null : type)) {
    return null;
  }
  return activityId;
}

module.exports = {
  ACTIVITY_RESOURCE_TYPES,
  RESERVED_ACTIVITY_ID_PREFIXES,
  activityIdForResource,
  reservedTypeForActivityId,
};
