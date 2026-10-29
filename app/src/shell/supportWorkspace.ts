// Student Support Workspace (V2 P3, docs/platform/STUDENT_SUPPORT_ACCESS.md
// section 7). A teacher who owns zero classes of any status and has at least
// one student shared with them sees the simplified Student Support workspace:
// the same shell, with Classes presented as the Student Support landing and
// every teaching-only surface (Curriculum, My Units, Settings) hidden and
// refused.
//
// This is a presentation of the current server-authorized reads, never a
// role: nothing is persisted, claimed, or cached across page loads. Once a
// shell enters it, it stays for that shell's life (so revoking the last
// grant shows an empty Student Support page rather than a sudden switch to
// onboarding); the next page load re-evaluates from the reads alone. The
// server authorizes every call either way.

import type { SharedStudent } from "../supportAccess/types";

export type SupportWorkspaceSeam = {
  readonly isSupportOnly: () => boolean;
  // Idempotent. Called by whichever reader first proves the condition.
  readonly enterSupportOnly: () => void;
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
