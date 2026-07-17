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
  // Sprint 13C: canonical lesson association so hydrated assignments can be
  // mapped back to the Curriculum lesson card that produced them. Absent on
  // pre-Sprint-13C registrations (backward compatible); present on every
  // hydrated assignment returned by the certified teacher-list retrieval
  // path.
  readonly lessonSlug?: string;
  // Sprint 13C: canonical class association so multiple assignments for the
  // same lesson (one per class) can be distinguished by the client-side
  // selection UI without leaking student, recipient, attempt, or session
  // identifiers.
  readonly classId?: string;
  // Sprint 13G scope completion: optional teacher-authored instructions for
  // the assignment. Absent when the draft has never been given
  // instructions, or when the value was not returned by the Sprint 13C
  // teacher-list projection (backward compatible). The field is
  // draft-editable through the certified `assignmentsUpdateDraft`
  // callable and is intentionally the only additional editable metadata
  // surfaced in Sprint 13G; availability windows and lesson-revision
  // references remain unsupported by the client until a canonical
  // client-side selector and date/time control convention exist.
  readonly instructions?: string;
};

// Sprint 13D: injected close-callable seam. The Assignment Detail
// surface never imports from firebase/*; the entry point wires the
// real `assignmentsClose` callable and tests inject an in-memory fake.
// The callable resolves on the canonical
// `{ assignmentId, status: "closed", alreadyClosed }` response and
// rejects on any failure. UI failure messaging never reveals Firestore,
// callable names, stack traces, or document paths.
export type AssignmentsCloseResult = {
  readonly assignmentId: string;
  readonly status: "closed";
  readonly alreadyClosed: boolean;
};

export type AssignmentsCloseCallable = (input: {
  readonly assignmentId: string;
}) => Promise<AssignmentsCloseResult>;

// Sprint 13E: injected reopen-callable seam. The Assignment Detail
// surface never imports from firebase/*; the entry point wires the
// real `assignmentsReopen` callable and tests inject an in-memory fake.
// The callable resolves on the canonical
// `{ assignmentId, status: "published", alreadyPublished }` response
// and rejects on any failure. UI failure messaging never reveals
// Firestore, callable names, stack traces, or document paths.
export type AssignmentsReopenResult = {
  readonly assignmentId: string;
  readonly status: "published";
  readonly alreadyPublished: boolean;
};

export type AssignmentsReopenCallable = (input: {
  readonly assignmentId: string;
}) => Promise<AssignmentsReopenResult>;

// Sprint 13G: injected update-draft callable seam. The Assignment Detail
// surface never imports from firebase/*; the entry point wires the real
// `assignmentsUpdateDraft` callable and tests inject an in-memory fake.
// The callable resolves on the canonical
// `{ assignmentId, alreadyUpdated }` response and rejects on any
// failure. UI failure messaging never reveals Firestore, callable names,
// stack traces, or document paths.
export type AssignmentsUpdateDraftInput = {
  readonly assignmentId: string;
  readonly title?: string;
  readonly instructions?: string;
};

export type AssignmentsUpdateDraftResult = {
  readonly assignmentId: string;
  readonly alreadyUpdated: boolean;
};

export type AssignmentsUpdateDraftCallable = (
  input: AssignmentsUpdateDraftInput,
) => Promise<AssignmentsUpdateDraftResult>;

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
