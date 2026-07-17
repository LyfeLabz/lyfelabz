// Client-side shapes for the Sprint 13B Teacher Assignment Detail
// surface. The surface composes the certified Sprint 13A Assignment
// Summary card and layers a small header of already-known assignment
// metadata (title, status, class name). No new backend contract is
// introduced; metadata is supplied through an injected reader seam so
// the entry point can wire whichever source is available without
// coupling the surface to firebase/* or Firestore.
//
// Confidentiality: the header is limited to teacher-owned assignment
// metadata (title, status, class name). No student identifier, no
// recipient identifier, no attempt identifier, no session identifier,
// no raw score, and no answer information is named on this shape.

export type AssignmentStatus = "draft" | "published" | "closed";

export type AssignmentDetailMetadata = {
  readonly assignmentId: string;
  readonly title: string;
  readonly status: AssignmentStatus;
  readonly className: string;
};

// Injected reader seam. The detail surface never imports from
// firebase/* directly; the entry point wires the real reader and tests
// inject an in-memory fake. Mirrors the AssignmentSummaryCallable seam
// established by Sprint 13A.
//
// Resolves with the metadata for the requested assignment when it can
// be loaded. Resolves with null when the assignment metadata is
// unavailable through this reader (empty state). Rejects on any other
// failure (error state).
export type AssignmentDetailMetadataReader = (input: {
  readonly assignmentId: string;
}) => Promise<AssignmentDetailMetadata | null>;
