// Student Support Workspace V2.1: the server derives eligibility from active
// recipient relationships or valid legacy grants, with any class ownership
// preserving the full workspace. Support navigation offers Student Support
// and preview-only Curriculum. This is not an identity role or claim.
// The count helper below remains a compatibility fallback for V2 test seams;
// production consumes the server decision, including the zero-student state.

import type { SharedStudent } from "../supportAccess/types";

export type SupportWorkspaceSeam = {
  readonly isSupportOnly: () => boolean;
  // Idempotent. Called by whichever reader first proves the condition.
  readonly enterSupportOnly: () => void;
  // V2.1: ending the last recipient relationship ends the designation.
  // Backend teaching restrictions remain independently authoritative.
  readonly leaveSupportOnly?: () => void;
  // The shell's own shared read from resolving a direct link, handed over
  // once so the Classes surface does not repeat it. Null otherwise.
  // True while the Classes surface shows the unresolved workspace (zero
  // owned classes, failed shared read): the shell then hides all workspace
  // navigation and refuses every other surface until a retry resolves it.
  // Not a classification; cleared by the next successful read.
  readonly setUnresolved?: (unresolved: boolean) => void;
  readonly takePrimedShared?: () => Promise<ReadonlyArray<SharedStudent>> | null;
};

export function isSupportOnlyTeacher(ownedClassCount: number, sharedStudentCount: number): boolean {
  return ownedClassCount === 0 && sharedStudentCount > 0;
}
