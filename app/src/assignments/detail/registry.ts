import type { AssignmentDetailMetadata } from "./types";

// Session-scoped registry of teacher-owned assignment metadata that has
// been made openable inside the current tab. The registry exists so
// the Sprint 13B Assignment Detail surface can resolve an
// `assignmentId` to a stored title, status, and class name without
// introducing a new backend contract or exposing any Firestore
// vocabulary at the surface layer.
//
// The registry is intentionally in-memory only. It is never persisted
// to Firestore, localStorage, or sessionStorage; it is cleared on
// sign-out (the entry point rebinds the active-teacher session, at
// which point `_resetForTest` is not necessary because the registry is
// reconstructed alongside every other per-session dependency).
//
// The stored metadata is strictly teacher-owned assignment metadata:
// title, status, class name. No student identifier, no recipient
// identifier, no attempt identifier, no session identifier, no raw
// score is ever registered here.

export type AssignmentDetailRegistry = {
  readonly register: (metadata: AssignmentDetailMetadata) => void;
  readonly lookup: (assignmentId: string) => AssignmentDetailMetadata | null;
  readonly clear: () => void;
};

export function createAssignmentDetailRegistry(): AssignmentDetailRegistry {
  const store = new Map<string, AssignmentDetailMetadata>();
  return Object.freeze({
    register: (metadata) => {
      store.set(metadata.assignmentId, metadata);
    },
    lookup: (assignmentId) => store.get(assignmentId) ?? null,
    clear: () => {
      store.clear();
    },
  });
}
