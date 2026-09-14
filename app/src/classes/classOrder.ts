import type { Firestore } from "firebase/firestore";
import { doc, getDoc } from "firebase/firestore";
import type { Functions } from "firebase/functions";
import { httpsCallable } from "firebase/functions";

import type { ClassSummary } from "./types";
import { isClassColorToken, type ClassColorToken } from "./classColor";

// Sprint 30A.1 UX correction - canonical teacher class order.
//
// LyfeLabz persists the teacher's own preferred class display order at
// `users/{uid}/preferences/teacher` (`classOrder`, an ordered array of
// class ids), written exclusively through the `teacherClassOrderUpdate`
// callable (server-side ownership validation; see
// platform/functions/src/teachers/teacher-class-order-update.ts). This is
// the SINGLE source of truth: both the Classes workspace and the Assign
// dialog's class list consume it through `createOrderedListClasses`
// below, so neither surface can drift into its own separate ordering
// preference. Reordering is a teacher preference, never per-assignment.
//
// Sprint 30A.1 human-review finalization: the pure ordering arithmetic
// (`computeFallbackClassOrder`, `applyCanonicalClassOrder`, `moveClassId`)
// now lives in the firebase-free `classOrderMath.ts` and is re-exported
// here unchanged, so this file's Firebase-dependent factories below
// (which import `firebase/firestore` / `firebase/functions` at module
// scope) are never dragged in by a consumer that only needs the pure
// logic - notably the Classes workspace, which carries a "no firebase/*
// import" invariant so it stays reachable from plain-node Jest suites.

export {
  computeFallbackClassOrder,
  applyCanonicalClassOrder,
  moveClassId,
} from "./classOrderMath";
import { applyCanonicalClassOrder } from "./classOrderMath";

export type ReadTeacherClassOrder = (
  uid: string,
) => Promise<ReadonlyArray<string> | null>;

export type UpdateTeacherClassOrder = (
  classOrder: ReadonlyArray<string>,
) => Promise<void>;

export function createFirestoreReadTeacherClassOrder(
  db: Firestore,
): ReadTeacherClassOrder {
  return async (uid) => {
    const ref = doc(db, "users", uid, "preferences", "teacher");
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const data = snap.data() as Readonly<Record<string, unknown>>;
    const raw = data.classOrder;
    if (!Array.isArray(raw)) return null;
    const ids = raw.filter((v): v is string => typeof v === "string");
    return ids.length > 0 ? Object.freeze(ids) : null;
  };
}

export function createFirebaseUpdateTeacherClassOrder(
  functions: Functions,
): UpdateTeacherClassOrder {
  const callable = httpsCallable(functions, "teacherClassOrderUpdate");
  return async (classOrder) => {
    await callable({ classOrder });
  };
}

// Sprint 30A.1 Class Settings V1. Reads the teacher's own per-class color
// accents from the SAME `users/{uid}/preferences/teacher` document
// `createFirestoreReadTeacherClassOrder` reads (a second field on that
// doc, not a second document) - written exclusively through the
// `teacherClassColorUpdate` callable. Malformed or unrecognized entries
// (a legacy value outside the current closed token set) are silently
// dropped rather than surfaced, matching `classOrder`'s own tolerance for
// stale/unrecognized data; a class id with no valid entry here simply
// has no color, and callers must render the neutral default.
export type ReadTeacherClassColors = (
  uid: string,
) => Promise<Readonly<Record<string, ClassColorToken>>>;

export function createFirestoreReadTeacherClassColors(
  db: Firestore,
): ReadTeacherClassColors {
  return async (uid) => {
    const ref = doc(db, "users", uid, "preferences", "teacher");
    const snap = await getDoc(ref);
    if (!snap.exists()) return Object.freeze({});
    const data = snap.data() as Readonly<Record<string, unknown>>;
    const raw = data.classColors;
    if (raw === null || typeof raw !== "object") return Object.freeze({});
    const out: Record<string, ClassColorToken> = {};
    for (const [classId, value] of Object.entries(
      raw as Record<string, unknown>,
    )) {
      if (isClassColorToken(value)) out[classId] = value;
    }
    return Object.freeze(out);
  };
}

// Composes a base `ListClasses` reader with the teacher's canonical
// order, so every consumer that receives this composed reader (the
// Classes workspace, the Assign dialog) sees the identical ordering
// without maintaining any ordering logic of its own. A failure reading
// the order preference (network, transient Firestore error) degrades to
// the deterministic fallback order rather than breaking the class list -
// ordering is a convenience, never a load-bearing read.
export function createOrderedListClasses(
  listClasses: (uid: string) => Promise<ReadonlyArray<ClassSummary>>,
  readClassOrder: ReadTeacherClassOrder,
): (uid: string) => Promise<ReadonlyArray<ClassSummary>> {
  return async (uid) => {
    const [classes, persistedOrder] = await Promise.all([
      listClasses(uid),
      readClassOrder(uid).catch(() => null),
    ]);
    return applyCanonicalClassOrder(classes, persistedOrder);
  };
}
