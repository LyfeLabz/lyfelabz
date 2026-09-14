import { FieldValue } from "firebase-admin/firestore";
import { type CallableRequest } from "firebase-functions/v2/https";

import {
  classesCollectionRef,
  log,
  platformCallable,
  PlatformError,
  requireDistrictContext,
  teacherPreferencesDocRef,
  teacherPreferencesUpdateDocRef,
  type TeacherClassOrderSetWrite,
} from "../shared";

// teacherClassOrderUpdate
//
// Sprint 30A.1 UX correction. Owns the canonical write path for the
// teacher's own class display order, persisted additively on the existing
// `users/{uid}/preferences/teacher` subdoc (`classOrder`) alongside the
// pre-existing, independent `defaultGrade` preference. Kept as a
// dedicated callable rather than folded into `teacherPreferencesUpdate`
// because this write requires server-side class-ownership validation that
// the narrow grade-enum validator has no reason to carry.
//
// Contract summary:
//   - The caller must be an active teacher (via requireDistrictContext).
//   - `classOrder` must be a non-empty array of URL-safe class id tokens,
//     each appearing at most once.
//   - Every id in the payload MUST resolve to a class this teacher owns
//     (`classes/{id}.teacherId === caller.uid`); an unknown, deleted, or
//     cross-teacher id rejects the entire request with
//     `teacherClassOrder.unknownClassId` rather than silently dropping it.
//   - The payload need not name every class the teacher owns - a class
//     omitted from the array is simply "not yet ordered" and every reader
//     appends it after the ordered ids (see the field comment on
//     `TeacherPreferencesDoc.classOrder`). This keeps a partial reorder
//     (e.g. dragging one row) a valid, safe request.
//   - The write is a NON-DESTRUCTIVE MERGE, not a blind overwrite: ids
//     already present in the stored `classOrder` that are absent from
//     this request (e.g. an archived class not shown in the surface the
//     teacher reordered from) are preserved, appended after the
//     submitted ids in their prior relative order. This is what makes a
//     partial reorder from a narrower view (the Assign dialog only shows
//     active classes) safe to persist without silently forgetting
//     ordering data for classes outside that view.
//   - The write is a plain `{merge: true}` set, matching
//     `teacherPreferencesUpdate`'s existing pattern - no CAS/revision
//     scheme, since a teacher reordering their own classes has no
//     concurrent-writer hazard worth the complexity (Firestore's own
//     last-write-wins is sufficient, and a same-value replay is a safe
//     no-op).
//   - The callable only ever writes to the caller's own preference
//     document. Cross-teacher writes are impossible by construction (uid
//     comes from the verified auth context, never from the request body).

export type TeacherClassOrderUpdateRequest = {
  readonly classOrder: readonly string[];
};

export type TeacherClassOrderUpdateResponse = {
  readonly ok: true;
  readonly classOrder: readonly string[];
};

const CLASS_ID_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9_-]{0,62}[a-zA-Z0-9])?$/;
const MAX_CLASS_ORDER_LENGTH = 200;

function validateRequest(data: unknown): readonly string[] {
  if (data === null || typeof data !== "object") {
    throw new PlatformError(
      "teacherClassOrder.invalidRequest",
      "Request payload must be a structured object.",
    );
  }
  const payload = data as Record<string, unknown>;
  const raw = payload.classOrder;
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new PlatformError(
      "teacherClassOrder.invalidClassOrder",
      "classOrder must be a non-empty array of class ids.",
    );
  }
  if (raw.length > MAX_CLASS_ORDER_LENGTH) {
    throw new PlatformError(
      "teacherClassOrder.invalidClassOrder",
      `classOrder must not exceed ${MAX_CLASS_ORDER_LENGTH} entries.`,
    );
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !CLASS_ID_PATTERN.test(entry)) {
      throw new PlatformError(
        "teacherClassOrder.invalidClassOrder",
        "classOrder entries must be URL-safe class id tokens.",
      );
    }
    if (seen.has(entry)) {
      throw new PlatformError(
        "teacherClassOrder.duplicateClassId",
        `classOrder contains a duplicate class id: "${entry}".`,
      );
    }
    seen.add(entry);
    out.push(entry);
  }
  return out;
}

function safeLog(fn: () => void): void {
  try {
    fn();
  } catch {
    // Logging is observability, not lifecycle.
  }
}

async function teacherClassOrderUpdateHandler(
  request: CallableRequest<unknown>,
): Promise<TeacherClassOrderUpdateResponse> {
  const context = await requireDistrictContext(request);
  if (context.role !== "teacher") {
    throw new PlatformError(
      "role-forbidden",
      "Caller must be an active teacher.",
    );
  }

  const classOrder = validateRequest(request.data);

  // Server-side ownership verification: every submitted id must belong to
  // this teacher. Reading the teacher's own class ids once and checking
  // membership avoids N individual document reads and, more importantly,
  // never trusts the client's claim that an id is theirs to reorder.
  const ownedSnapshot = await classesCollectionRef()
    .where("teacherId", "==", context.uid)
    .get();
  const ownedClassIds = new Set(ownedSnapshot.docs.map((d) => d.id));
  for (const id of classOrder) {
    if (!ownedClassIds.has(id)) {
      throw new PlatformError(
        "teacherClassOrder.unknownClassId",
        `classOrder contains a class id the caller does not own: "${id}".`,
      );
    }
  }

  // Non-destructive merge: preserve any previously-ordered id this
  // request does not mention, appended after the submitted ids in their
  // prior relative order, so a partial reorder from a narrower view never
  // erases ordering data for classes outside that view.
  const existingSnapshot = await teacherPreferencesDocRef(context.uid).get();
  const existingOrder = existingSnapshot.data()?.classOrder ?? [];
  const submitted = new Set(classOrder);
  const preserved = existingOrder.filter((id) => !submitted.has(id));
  const mergedOrder = [...classOrder, ...preserved];

  const write: TeacherClassOrderSetWrite = {
    classOrder: mergedOrder,
    updatedAt: FieldValue.serverTimestamp(),
  };
  await teacherPreferencesUpdateDocRef(context.uid).set(write, {
    merge: true,
  });

  safeLog(() =>
    log.info("teacherClassOrder.updated", {
      uid: context.uid,
      classCount: mergedOrder.length,
    }),
  );

  return { ok: true, classOrder: mergedOrder };
}

export const teacherClassOrderUpdate = platformCallable(
  teacherClassOrderUpdateHandler,
);

// Exported for direct unit testing without going through the callable
// wrapper. Not part of the public callable surface.
export const __teacherClassOrderUpdateHandler = teacherClassOrderUpdateHandler;
