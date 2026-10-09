import type { WriteBatch } from "firebase-admin/firestore";

import { getAdminFirestore } from "./admin";

// Thin wrapper over `Firestore.batch()` so callers can express an atomic
// multi-document write region without reaching through to the admin-SDK
// Firestore instance directly. The wrapper preserves the admin-SDK contract
// exactly; there is no per-call retry override and no isolation-level
// override. Tests mock this helper to synthesize a batch object.
//
// RA-3B: `assignmentsPublish`, its former caller, now runs in a Firestore
// transaction (`runFirestoreTransaction`) so the publication reads and
// writes are one serializable unit; no production path calls this helper
// today.
//
// Firestore batches are atomic: either every enqueued write is applied or
// none is. Firestore no longer imposes a fixed 500-write maximum per batch
// or transaction; the binding limits are the 10 MiB API request size and
// the 1 MiB document size (Firestore "Usage and limits", checked
// 2026-10-09). Callers that could approach them must bound their writes
// under an explicit reconciliation notice.
export function createFirestoreBatch(): WriteBatch {
  return getAdminFirestore().batch();
}
