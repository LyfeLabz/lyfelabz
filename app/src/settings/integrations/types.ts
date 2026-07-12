// Client-side shapes for the Teacher Integrations experience. These
// mirror the Sprint 8B callable response shapes without importing
// server-side types; the client only names the fields it consumes so a
// server-side schema evolution cannot silently reshape the client.
//
// The provider identifier is intentionally kept as a plain string on the
// client. The closed set is enforced by the callable at runtime; the
// client renders whatever `lmsProvidersList` returns so the surface
// stays vendor-neutral per PDR-020f. See LMS_INTEGRATION_ARCHITECTURE.md
// §3.3 and LMS_EXPERIENCE.md §3.

export type IntegrationsProvider = {
  readonly providerId: string;
  readonly displayName: string;
};

export type IntegrationsConnectionStatus = "active" | "revoked";

export type IntegrationsConnection = {
  readonly connectionId: string;
  readonly providerId: string;
  readonly status: IntegrationsConnectionStatus;
  readonly scopes: readonly string[];
};

export type IntegrationsLmsClass = {
  readonly lmsClassId: string;
  readonly name: string;
  readonly section?: string;
};

// A topic on an LMS-linked class, resolved by lmsClassesListTopics per
// the Sprint 8D authorized scope expansion of PDR-020c. Topics are
// LMS-owned per PDR-020g and are not mirrored into Firestore; the
// callable resolves them on demand each time the Assignment Dialog
// opens the LMS-linked class row.
export type IntegrationsLmsTopic = {
  readonly lmsTopicId: string;
  readonly name: string;
};

// The response of an assignment publication attempt. LyfeLabz-side
// scheduling is authoritative per PDR-019d; the publication outcome is
// a side effect the confirmation surface names alongside the LyfeLabz
// outcome (ASSIGN_EXPERIENCE.md §7).
export type IntegrationsPublicationOutcome = {
  readonly publicationId: string;
  readonly status: "succeeded" | "failed";
  readonly lmsAssignmentId?: string;
  readonly lmsAssignmentUrl?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
};

// The client-side view of an LMS class link. Consumed by the Assign
// Experience so the Assignment Dialog can render the LMS-linked class
// row shape (topic selector, publication toggle) per
// ASSIGN_EXPERIENCE.md §5. Only the fields the dialog consumes are
// named; every other field on `lmsClassLinks/{linkId}` is intentionally
// omitted so the client cannot silently grow a dependency on
// server-managed data.
export type IntegrationsClassLink = {
  readonly linkId: string;
  readonly classId: string;
  readonly providerId: string;
  readonly lmsClassId: string;
};

// Sprint 8E manual refresh vocabulary. Health names track
// LMS_INTEGRATION_ARCHITECTURE.md Amendment §6 exactly. Every user-
// facing string that describes a state lives beside the surface that
// renders it so the callable never mints teacher-facing prose.
export type IntegrationsClassHealthStatus =
  | "healthy"
  | "disconnected"
  | "revoked"
  | "ownershipDrift"
  | "missingUpstream"
  | "reconnectRequired"
  | "providerUnavailable";

// The Teacher's own LyfeLabz classes as consumed by the Import step.
// Duplicates ClassSummary from src/classes/types.ts by shape but keeps
// the Integrations module independent of the Classes reader so the
// surface can consume either the shared reader or a bespoke fixture in
// tests.
export type IntegrationsLyfeLabzClass = {
  readonly id: string;
  readonly title: string;
  readonly grade: string;
};

// Injected callable seam. Every callable is provided by the entry point
// so the shell/settings tree stays free of firebase/functions imports
// (see shell.test.ts data-and-callable-posture invariant).
export type IntegrationsCallables = {
  readonly listProviders: () => Promise<readonly IntegrationsProvider[]>;
  readonly describeConnections: () => Promise<readonly IntegrationsConnection[]>;
  readonly beginConnection: (input: {
    readonly providerId: string;
    readonly redirectUri: string;
  }) => Promise<{ readonly authorizationUrl: string; readonly state: string }>;
  readonly completeConnection: (input: {
    readonly providerId: string;
    readonly code: string;
    readonly state: string;
    readonly redirectUri: string;
  }) => Promise<{
    readonly connectionId: string;
    readonly alreadyConnected: boolean;
  }>;
  readonly disconnect: (input: {
    readonly connectionId: string;
  }) => Promise<{ readonly alreadyRevoked: boolean }>;
  readonly discoverClasses: (input: {
    readonly connectionId: string;
  }) => Promise<readonly IntegrationsLmsClass[]>;
  readonly importClass: (input: {
    readonly connectionId: string;
    readonly classId: string;
    readonly lmsClassId: string;
  }) => Promise<{
    readonly linkId: string;
    readonly classId: string;
    readonly lmsClassId: string;
    readonly alreadyLinked: boolean;
  }>;
  // Sprint 8D authorized scope expansion: topic listing and assignment
  // publication. Every other previously excluded capability remains
  // absent from this interface.
  readonly listClassTopics: (input: {
    readonly linkId: string;
  }) => Promise<readonly IntegrationsLmsTopic[]>;
  // Sprint 8E authorized manual refresh + reconciliation callable per
  // LMS_INTEGRATION_ARCHITECTURE.md Amendment §6. Verifies upstream
  // state for a single imported class and reconciles the mirror. Every
  // side effect (link "broken", connection "revoked", audit event) is
  // written server-side; the client only receives the resulting health
  // verdict.
  readonly refreshClass: (input: {
    readonly linkId: string;
  }) => Promise<{
    readonly linkId: string;
    readonly classId: string;
    readonly lmsClassId: string;
    readonly providerId: string;
    readonly status: IntegrationsClassHealthStatus;
    readonly changed: boolean;
  }>;
  readonly publishAssignment: (input: {
    readonly assignmentId: string;
    readonly linkId: string;
    readonly lyfelabzAssignmentUrl: string;
    readonly title?: string;
    readonly instructions?: string;
    readonly lmsTopicId?: string;
    readonly attemptNonce?: string;
  }) => Promise<IntegrationsPublicationOutcome>;
};

// Sprint 8D.1 authoritative assignment lifecycle seam. The Assign
// Experience must create and publish a persistent LyfeLabz assignment
// through these certified callables before any LMS-side publication is
// attempted. Injected separately from IntegrationsCallables because the
// lifecycle exists whether or not any of the teacher's classes are
// LMS-linked (ASSIGN_EXPERIENCE.md §5 preserves the non-LMS shape).
export type AssignmentsCreateDraftInput = {
  readonly assignmentId: string;
  readonly classId: string;
  readonly lessonSlug: string;
  readonly lessonVersion: string;
  readonly mode: "practice" | "classroom";
  readonly title?: string;
  readonly instructions?: string;
  readonly windowClosesAt?: string;
  readonly availableAt?: string;
};

export type AssignmentsCreateDraftOutput = {
  readonly assignmentId: string;
  readonly status: "draft";
  readonly alreadyCreated: boolean;
};

export type AssignmentsPublishInput = {
  readonly assignmentId: string;
};

export type AssignmentsPublishOutput = {
  readonly assignmentId: string;
  readonly status: "published";
  readonly alreadyPublished: boolean;
};

export type AssignmentsCallables = {
  readonly createDraft: (
    input: AssignmentsCreateDraftInput,
  ) => Promise<AssignmentsCreateDraftOutput>;
  readonly publish: (
    input: AssignmentsPublishInput,
  ) => Promise<AssignmentsPublishOutput>;
};

// OAuth browser handoff. The Integrations surface never opens a popup
// or listens for a postMessage directly; those side effects are wired at
// the entry point so the surface stays a pure DOM builder. The handoff
// resolves with the authorization code and state returned by the
// provider's consent screen, or rejects with a plain-language reason.
export type OAuthHandoff = (input: {
  readonly authorizationUrl: string;
  readonly redirectUri: string;
  readonly expectedState: string;
}) => Promise<{ readonly code: string; readonly state: string }>;

// Injected reader for the teacher's LyfeLabz classes. A callable-free
// seam so the settings tree does not import firebase/firestore. Tests
// pass an in-memory fixture; the entry point passes an adapter around
// the existing ClassSummary reader.
export type ListTeacherClasses = () => Promise<
  readonly IntegrationsLyfeLabzClass[]
>;

// Injected reader for the teacher's active LMS class links. The
// Assignment Dialog consumes it to detect which class rows should
// render the LMS-linked shape (topic selector, publication toggle) per
// ASSIGN_EXPERIENCE.md §5. The certified `lmsClassLinks` list rule
// scopes reads to the caller's uid (Firestore Rules Sprint 8B); the
// client must issue the query with a matching `ownerUid` filter for
// the rule to admit it.
export type ListClassLinks = () => Promise<readonly IntegrationsClassLink[]>;

export type IntegrationsDeps = {
  readonly callables: IntegrationsCallables;
  readonly openOAuth: OAuthHandoff;
  readonly listTeacherClasses: ListTeacherClasses;
  readonly redirectUri: string;
  // Sprint 8D authorized scope expansion: LMS-linked class discovery
  // for the Assignment Dialog. Absent-or-null keeps every non-LMS row
  // shape unchanged per ASSIGN_EXPERIENCE.md §5.
  readonly listClassLinks?: ListClassLinks;
};
