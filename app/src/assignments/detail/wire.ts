import type { AssignmentRegistryReadiness } from "./hydration";
import type { AssignmentDetailRegistry } from "./registry";
import type { AssignmentDetailMetadataReader } from "./types";

// Sprint 13B entry-point wire for the Assignment Detail metadata
// reader. Returns an `AssignmentDetailMetadataReader` backed by the
// injected session-scoped registry. The wire imports nothing from
// firebase/*; the underlying data source is a pure in-memory registry
// populated by the certified assignment lifecycle path.
//
// Performance Operation 1: registry hydration no longer blocks startup, so a
// direct-entry restore can open Detail before enumeration lands. The reader
// distinguishes the four registry outcomes:
//   - found (at any time):            the metadata;
//   - pending:                        waits (Detail keeps its loading state);
//   - ready and genuinely absent:     null (Detail's "could not find" state);
//   - unavailable (enumeration failed): rejects, so Detail shows its
//     accurate "could not load" state, whose Try again re-runs this reader.
// A read that starts while the registry is unavailable first re-requests
// enumeration (the controller dedupes), so Try again recovers the intended
// assignment without remounting anything else.
export class AssignmentRegistryUnavailableError extends Error {
  constructor() {
    super("Assignment metadata is unavailable.");
    this.name = "AssignmentRegistryUnavailableError";
  }
}

export function createAssignmentDetailMetadataReader(
  registry: AssignmentDetailRegistry,
  readiness?: AssignmentRegistryReadiness,
): AssignmentDetailMetadataReader {
  return async ({ assignmentId }) => {
    const hit = registry.lookup(assignmentId);
    if (hit !== null || readiness === undefined) return hit;
    if (readiness.status() === "ready") return null;
    if (readiness.status() === "unavailable") readiness.retry();
    await readiness.settled();
    const settled = registry.lookup(assignmentId);
    if (settled !== null) return settled;
    if (readiness.status() === "unavailable") throw new AssignmentRegistryUnavailableError();
    return null;
  };
}
