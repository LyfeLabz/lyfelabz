import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

// Sprint 29G.5P (Sprint 29 closeout) - client seam for the teacher Students
// tab. Calls the `enrollmentsListForClass` callable and defensively parses
// the minimal roster projection (studentId + resolved display name). No
// provider identity, hash, email, or other field is expected or surfaced.

export type ClassRosterStudent = {
  readonly studentId: string;
  readonly studentDisplayName: string;
};

export type ClassRosterResult = {
  readonly classId: string;
  readonly students: readonly ClassRosterStudent[];
};

export type LoadClassRoster = (input: {
  readonly classId: string;
}) => Promise<ClassRosterResult>;

// Sprint 29G.5P: a LAZY accessor for the roster loader. `LoadClassRoster` is
// created asynchronously at teacher functions-init, so the teacher-surface
// dependency chain must carry a getter that is resolved only when the Students
// surface actually renders (after init), instead of snapshotting a value during
// earlier router assembly (which captured `null`). Returns `null` while the
// loader is not yet initialized; the Students surface treats that as "not
// ready" (loading), never as a genuine empty roster.
export type LoadClassRosterAccessor = () => LoadClassRoster | null;

type CallableRecord = Readonly<Record<string, unknown>>;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function createLoadClassRoster(functions: Functions): LoadClassRoster {
  const callable = httpsCallable(functions, "enrollmentsListForClass");
  return async (input) => {
    const res = await callable({ classId: input.classId });
    const data = (res.data ?? {}) as CallableRecord;
    const rawStudents = Array.isArray(data.students) ? data.students : [];
    const students: ClassRosterStudent[] = [];
    for (const raw of rawStudents) {
      if (raw === null || typeof raw !== "object") continue;
      const r = raw as CallableRecord;
      if (!isNonEmptyString(r.studentId)) continue;
      students.push({
        studentId: r.studentId,
        studentDisplayName: isNonEmptyString(r.studentDisplayName)
          ? r.studentDisplayName
          : "Name unavailable",
      });
    }
    return {
      classId: isNonEmptyString(data.classId) ? data.classId : input.classId,
      students,
    };
  };
}
