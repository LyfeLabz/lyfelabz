import type { Firestore, Transaction } from "firebase-admin/firestore";

import { getAdminFirestore } from "./admin";

// Thin wrapper over `Firestore.runTransaction` so callers can express a
// transactional read/write region without reaching through to the
// admin-SDK Firestore instance directly. Used by
// `assessmentAttemptsFinalize` to satisfy the ASSESSMENT_IMPLEMENTATION_
// CONTRACT.md §8 requirement that the session read, session delete, and
// attempt write are one atomic operation. The wrapper preserves the
// admin-SDK contract exactly; there is no per-call retry override and no
// isolation-level override. Tests mock this helper to synthesize a
// transaction object.
export async function runFirestoreTransaction<T>(
  fn: (tx: Transaction) => Promise<T>,
  firestore: Firestore = getAdminFirestore(),
): Promise<T> {
  return firestore.runTransaction(fn);
}

// gRPC ABORTED. The admin SDK retries a transaction whose commit loses to
// concurrent writes; this is what surfaces when every attempt lost. Callers
// translate it into a stable, retryable PlatformError of their own.
const FIRESTORE_ABORTED = 10;

export function isTransactionContention(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const code = (err as { code?: unknown }).code;
  return code === FIRESTORE_ABORTED || code === "aborted" || code === "ABORTED";
}
