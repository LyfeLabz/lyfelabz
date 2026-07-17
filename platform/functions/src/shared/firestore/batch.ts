import type { WriteBatch } from "firebase-admin/firestore";

import { getAdminFirestore } from "./admin";

// Thin wrapper over `Firestore.batch()` so callers can express an atomic
// multi-document write region without reaching through to the admin-SDK
// Firestore instance directly. Used by `assignmentsPublish` to bind the
// `draft` -> `published` status write and the initial recipient snapshot
// writes into a single atomic commit per PDR-029h (initial-snapshot
// atomicity requirement). The wrapper preserves the admin-SDK contract
// exactly; there is no per-call retry override and no isolation-level
// override. Tests mock this helper to synthesize a batch object.
//
// Firestore batches are atomic: either every enqueued write is applied or
// none is. The admin-SDK batch size limit is 500 writes; the initial
// snapshot enqueues one publish write plus one recipient write per unique
// active enrolled student. Pilot classes remain far below the limit;
// callers that ever approach it must switch to a different atomic
// strategy under an explicit reconciliation notice.
export function createFirestoreBatch(): WriteBatch {
  return getAdminFirestore().batch();
}
