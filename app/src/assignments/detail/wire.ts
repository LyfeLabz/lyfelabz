import type { AssignmentDetailRegistry } from "./registry";
import type { AssignmentDetailMetadataReader } from "./types";

// Sprint 13B entry-point wire for the Assignment Detail metadata
// reader. Returns an `AssignmentDetailMetadataReader` backed by the
// injected session-scoped registry. The wire imports nothing from
// firebase/*; the underlying data source is a pure in-memory registry
// populated by the certified assignment lifecycle path.
export function createAssignmentDetailMetadataReader(
  registry: AssignmentDetailRegistry,
): AssignmentDetailMetadataReader {
  return ({ assignmentId }) =>
    Promise.resolve(registry.lookup(assignmentId));
}
