import type { Firestore } from "firebase/firestore";
import {
  collection,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import type { ClassStatus, ClassSummary } from "./types";

// Narrow client-side data seam for reading the authenticated teacher's
// classrooms. Sprint 6B does not add any new callable; the certified
// backend already opens a scoped teacher-owned list rule against
// `classes/{classId}` (Firestore Rules Sprint 4B):
//
//     allow list: if isSignedIn()
//       && resource.data.teacherId == request.auth.uid;
//
// The client must issue the query with a matching `where("teacherId",
// "==", uid)` filter for the rule to admit it, guaranteeing that no
// cross-teacher or cross-school enumeration is possible. See
// SPRINT_6B_SPECIFICATION.md §5.
//
// Only the fields consumed by the Classroom Workspace (`title`, `grade`,
// `status`) are read from the document. Every other server-managed
// field is intentionally ignored. Malformed documents (missing or
// wrong-typed `title` or `status`, or missing `grade` on a ready arm)
// are filtered out so a bad record cannot crash the workspace.
//
// Sprint 24B Phase 2B extends `ClassStatus` to include `needsSetup`.
// A needsSetup document retains its list row so the teacher can find
// the class and either complete setup (Phase 2B.4) or archive it. The
// needsSetup arm intentionally omits `grade`, `block`, and `joinCode`
// per Reader Audit §3. Any other unknown status continues to drop the
// row (defense in depth against a future lifecycle extension shipped
// server-first).

export type ListClasses = (uid: string) => Promise<ReadonlyArray<ClassSummary>>;

const isString = (v: unknown): v is string => typeof v === "string";

const isStatus = (v: unknown): v is ClassStatus =>
  v === "active" || v === "archived" || v === "needsSetup";

const toSummary = (
  id: string,
  data: Readonly<Record<string, unknown>>,
): ClassSummary | null => {
  const title = data.title;
  const status = data.status;
  if (!isString(title) || !isStatus(status)) return null;
  // Sprint 24B Phase 2B.8. `isLmsLinked` is derived from the server's
  // `enrollmentSource` field. Absence defaults to manual per the Data
  // Model default. Every arm (needsSetup / active / archived) may
  // legitimately carry `enrollmentSource: "lms"`.
  const isLmsLinked = data.enrollmentSource === "lms";
  if (status === "needsSetup") {
    return Object.freeze({
      id,
      title,
      status,
      isLmsLinked,
    });
  }
  const grade = data.grade;
  if (!isString(grade)) return null;
  const joinCode = isString(data.joinCode) ? data.joinCode : undefined;
  const block = isString(data.block) ? data.block : undefined;
  return Object.freeze({
    id,
    title,
    grade,
    status,
    isLmsLinked,
    ...(joinCode !== undefined ? { joinCode } : {}),
    ...(block !== undefined ? { block } : {}),
  });
};

export function createFirestoreListClasses(db: Firestore): ListClasses {
  return async (uid) => {
    const q = query(
      collection(db, "classes"),
      where("teacherId", "==", uid),
    );
    const snap = await getDocs(q);
    const rows: ClassSummary[] = [];
    snap.forEach((doc) => {
      const data = doc.data() as Readonly<Record<string, unknown>>;
      const summary = toSummary(doc.id, data);
      if (summary !== null) rows.push(summary);
    });
    return Object.freeze(rows);
  };
}
