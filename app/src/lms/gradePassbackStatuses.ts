import type { Firestore } from "firebase/firestore";
import { collection, getDocs, query, where } from "firebase/firestore";

// Sprint 30A.2 - Google Classroom best-score grade-passback: read-only
// status projection for the teacher-facing Assignment Detail roster.
//
// Firestore reader for the teacher's own `lmsGradePassbacks` records,
// scoped to one assignment. Authorized entirely by the certified Rules
// block (`ownerUid == request.auth.uid`, mirroring the `lmsClassLinks` /
// `lmsAssignmentPublications` list convention) - no callable is required
// for this read. Only the coarse `status` value is projected out per
// student; no lease/generation state, no submission id, no error code,
// and no raw provider account id ever reaches this module.
export type GradePassbackStatus = "pending" | "syncing" | "synced" | "failed";

export type ReadGradePassbackStatuses = (input: {
  readonly assignmentId: string;
}) => Promise<ReadonlyMap<string, GradePassbackStatus>>;

const VALID_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "syncing",
  "synced",
  "failed",
]);

function readString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function createReadGradePassbackStatuses(
  db: Firestore,
  uid: string,
): ReadGradePassbackStatuses {
  return async (input) => {
    const q = query(
      collection(db, "lmsGradePassbacks"),
      where("ownerUid", "==", uid),
      where("assignmentId", "==", input.assignmentId),
    );
    const snap = await getDocs(q);
    const out = new Map<string, GradePassbackStatus>();
    snap.forEach((doc) => {
      const data = doc.data() as Readonly<Record<string, unknown>>;
      const studentId = readString(data.studentId);
      const status = data.status;
      if (studentId && typeof status === "string" && VALID_STATUSES.has(status)) {
        out.set(studentId, status as GradePassbackStatus);
      }
    });
    return out;
  };
}
