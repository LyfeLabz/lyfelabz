import type { Firestore } from "firebase/firestore";
import { doc, getDoc } from "firebase/firestore";

import {
  isTeacherDefaultGrade,
  type ReadTeacherDefaultGrade,
  type TeacherDefaultGrade,
} from "./types";

// Sprint 24B Phase 2B.2 - Client reader for
// `users/{uid}/preferences/teacher`.
//
// Fail-closed behavior:
//   - Absent document: returns null.
//   - Present document without `defaultGrade`: returns null.
//   - Present document with malformed / out-of-set `defaultGrade`:
//     returns null. Reader never throws to the caller.
//   - Read failure (network, permission, malformed data): returns null.
//     A read failure must not block teacher login, Manual Create, or the
//     Settings surface. A single silent warn is written to the console so
//     the failure remains diagnosable without leaking to the UI.
//
// The reader is deliberately session-agnostic. Phase 2B.2 does not
// hydrate `defaultGrade` into `activeTeacher` (see completion report §5
// for the deferred decision). A focused per-caller reader is the least
// invasive correct option for Phase 2B.2 and unblocks Phase 2B.4's
// setup form without churning the Canonical Session Bootstrap.

export function createFirestoreReadTeacherDefaultGrade(
  db: Firestore,
  uid: string,
): ReadTeacherDefaultGrade {
  return async (): Promise<TeacherDefaultGrade | null> => {
    try {
      const ref = doc(db, "users", uid, "preferences", "teacher");
      const snap = await getDoc(ref);
      if (!snap.exists()) return null;
      const data = snap.data() as { defaultGrade?: unknown } | undefined;
      if (!data) return null;
      const raw = data.defaultGrade;
      if (raw === undefined) return null;
      if (isTeacherDefaultGrade(raw)) return raw;
      return null;
    } catch {
      return null;
    }
  };
}
