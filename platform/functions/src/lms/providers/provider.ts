import type { LmsProviderId } from "../../shared";

// Vendor-neutral LMS provider interface per LMS_INTEGRATION_ARCHITECTURE.md
// §2 ("vendor-neutral core, vendor-specific edges") and PDR-020f
// (provider neutrality is permanent). Every provider-specific concern
// lives inside its adapter implementation; every provider-neutral concern
// (callable signatures, mirror record shape, audit vocabulary, security
// rules) lives inside the core and speaks only in this interface.
//
// The interface exposes the operations required by the initial scope
// (PDR-020c: connection lifecycle, classroom discovery, class import)
// plus the assignment publication surface authorized by the Sprint 8D
// specification as an explicit subsequent-sprint expansion under the
// PDR-020c "Future Reconsideration" clause. Every other previously
// excluded capability (roster synchronization, refresh, grade sync, ...)
// remains absent by design; adding any of them requires its own sprint
// specification.

// -------------------- Connection lifecycle --------------------

// The OAuth authorization URL the client sends the teacher to, along with
// the opaque state token that the completion callable verifies against
// the pending request. The state token is minted by the adapter and never
// echoes any LyfeLabz identifier that a caller could forge.
export type LmsOAuthAuthorizationRequest = {
  readonly authorizationUrl: string;
  readonly state: string;
};

// The completed OAuth grant material, returned from the adapter's OAuth
// exchange. Access and refresh tokens are held server-side only per
// PDR-019e and are handed to the token store immediately by the calling
// callable; the tokens never cross the callable's response boundary.
export type LmsOAuthGrant = {
  readonly accessToken: string;
  readonly refreshToken?: string;
  readonly scopes: readonly string[];
  readonly expiresInSeconds?: number;
  readonly upstreamAccountIdentifier: string;
};

// -------------------- Discovery --------------------

// The minimum classroom identity the discovery surface exposes. The set
// is deliberately narrow: only the fields the teacher needs to see to
// decide whether to import a class, plus the upstream identifier the
// import callable uses to open a mirror. No roster, no assignment, no
// student PII, no LMS-authored artifact leaks through this boundary in
// the initial scope (PDR-020c, PDR-019k).
export type LmsDiscoveredClass = {
  readonly lmsClassId: string;
  readonly name: string;
  readonly section?: string;
  readonly ownerUpstreamAccountIdentifier: string;
};

// -------------------- Assignment publication --------------------

// A single topic in the upstream LMS class. Topics are the shallow
// grouping under which a class's assignments live. LyfeLabz reads the
// topic list so the teacher can choose one at publication time
// (ASSIGN_EXPERIENCE.md §5 "LMS-linked class row shape"). The set is
// deliberately narrow: no assignment counts, no student PII, no
// LMS-authored artifact leaks through this boundary.
export type LmsTopic = {
  readonly lmsTopicId: string;
  readonly name: string;
};

// The minimum LyfeLabz-authored publication payload a provider adapter
// needs to open an LMS-side pointer back at the LyfeLabz assignment.
// LyfeLabz never publishes an instructional artifact into the LMS; the
// LMS-side record is a pointer to the LyfeLabz surface where the actual
// work happens (LMS_INTEGRATION_ARCHITECTURE.md §7.3).
export type LmsPublishAssignmentInput = {
  readonly accessToken: string;
  readonly lmsClassId: string;
  readonly title: string;
  readonly instructions?: string;
  readonly lyfelabzAssignmentUrl: string;
  readonly lmsTopicId?: string;
};

// The outcome of a successful publication. The upstream assignment
// identifier is the LMS-side pointer; a LyfeLabz-side
// `lmsAssignmentPublications` record records this pointer alongside the
// success outcome so the confirmation surface (ASSIGN_EXPERIENCE.md §7)
// can name the publication succinctly.
export type LmsPublishedAssignment = {
  readonly lmsAssignmentId: string;
  readonly lmsAssignmentUrl?: string;
};

// -------------------- Provider adapter interface --------------------

export interface LmsProviderAdapter {
  readonly providerId: LmsProviderId;
  readonly displayName: string;

  // Begin the OAuth grant. The returned URL is opened by the client; the
  // returned state token is verified by the completion callable. The
  // scope set requested is the minimum required to list a teacher's
  // classes and inspect a class's roster per §5.2 of the architecture and
  // §10.3.8 of the operational readiness section.
  beginOAuth(input: {
    readonly teacherId: string;
    readonly redirectUri: string;
  }): Promise<LmsOAuthAuthorizationRequest>;

  // Complete the OAuth grant against the upstream provider. The adapter
  // exchanges the authorization code for access/refresh tokens and
  // reports the identifier of the upstream account so the callable can
  // enforce the "personal-account misconnection" mitigation named in
  // Amendment §6.1.
  completeOAuth(input: {
    readonly code: string;
    readonly state: string;
    readonly redirectUri: string;
  }): Promise<LmsOAuthGrant>;

  // Revoke the upstream grant. Every LMS interaction is reversible from
  // the teacher's side per PDR-019c; disconnect calls this method before
  // marking the connection `revoked` in the mirror.
  revokeGrant(input: {
    readonly accessToken: string;
    readonly refreshToken?: string;
  }): Promise<void>;

  // List classes the teacher is the teacher-of-record for at the upstream
  // provider. Ownership verification per §12 ("How should teacher
  // ownership be validated?") happens at import time; the discovery
  // surface only exposes candidates.
  listTeacherClasses(input: {
    readonly accessToken: string;
  }): Promise<readonly LmsDiscoveredClass[]>;

  // Fetch a single discovered class by its upstream identifier. Used by
  // the import callable to re-verify ownership at import time (Amendment
  // §6.4, §10.3.7) without re-listing every class.
  fetchClass(input: {
    readonly accessToken: string;
    readonly lmsClassId: string;
  }): Promise<LmsDiscoveredClass>;

  // List the topics available on the upstream class so the teacher can
  // choose one in the Assignment Dialog. Called by the topic-list
  // callable on demand; the result is not cached in the mirror because
  // topics are LMS-owned and change without notice (PDR-020g).
  listClassTopics(input: {
    readonly accessToken: string;
    readonly lmsClassId: string;
  }): Promise<readonly LmsTopic[]>;

  // Publish a LyfeLabz-authored assignment to the upstream class as a
  // pointer to the LyfeLabz surface where the work happens
  // (LMS_INTEGRATION_ARCHITECTURE.md §7.3). The LyfeLabz assignment
  // record is authoritative; the LMS-side record is a side effect per
  // PDR-019d.
  publishAssignment(
    input: LmsPublishAssignmentInput,
  ): Promise<LmsPublishedAssignment>;
}
