import type { CurrentAssignmentResolution } from "../../settings/integrations/types";

// Which grade-sync presentation the Assignment Detail roster uses for the
// assignment being viewed. Grade passback records are keyed to one
// assignment occurrence, but the Classroom grade DESTINATION is the class +
// lesson family's Current (see `platform/functions/src/lms/grade-passback/
// engine.ts`). A Retry is an operational action, so it belongs only where
// the viewed assignment is the operational destination. Historical records
// are never hidden, deleted, or rewritten here; they are presented as
// history.
//
//   operational   - the viewed assignment is the valid Current, or the family
//                   has no Current pointer at all (legacy: the backend keeps
//                   the assignment itself as its destination). Status + Retry.
//   superseded    - a different assignment is the valid Current. A failed
//                   record is shown as muted history; no Retry.
//   nonActionable - Current is managed but inactive, the pointer is invalid,
//                   or Current could not be determined. Status without Retry:
//                   fail closed, never resurrect an older assignment.
export type GradeSyncContext = "operational" | "superseded" | "nonActionable";

export type CurrentForFamily = {
  readonly resolution: CurrentAssignmentResolution;
  readonly currentAssignmentId: string | null;
};

// `current === null` means Current could not be determined.
export function gradeSyncContextFor(
  viewedAssignmentId: string,
  current: CurrentForFamily | null,
): GradeSyncContext {
  if (current === null) return "nonActionable";
  switch (current.resolution) {
    case "valid":
      return current.currentAssignmentId === viewedAssignmentId
        ? "operational"
        : "superseded";
    case "unresolved":
      return "operational";
    case "inactive":
    case "invalid":
      return "nonActionable";
  }
}
